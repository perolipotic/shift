---
title: 'Concurrent admin, status and membership writes are serialized per organization, and a rename is decided against the stored username'
type: 'bugfix'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a28c62688bb886065a517f6bdf45cec6f22eb715'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The deferred-work triage (2026-09-27) put five entries into "package 2a". All are still open on main:
1. **Two admins deleted concurrently.** Entry: "Two concurrent transactions each deleting a different admin can both commit under READ COMMITTED, leaving an organization with zero admins". `refuse_organization_with_no_admin()` checks against its own snapshot.
2. **Status versions not serialized.** Entry: "Status-version writes are not serialized…". The never-zero-active-admins and date-order rules live in `member_status_versions` policies with no lock, so two admins deactivating each other can leave zero active admins.
3. **Membership versions not serialized.** Entry: "Two concurrent inserts into `team_membership_versions` for one member on different future dates can both commit…". Migration `0010` carries a KNOWN GAP comment for this.
4. **TRUNCATE bypasses the trigger.** Entry: "`truncate members` bypasses the zero-admins trigger entirely…". Only row triggers exist.
5. **Rename decided against a cached row.** Entry: "The rename decision is made against a cached member row…". `usernameChanged(member.username, edits.username)` compares against the cached list row, so a concurrent rename by another admin can be skipped.

**Approach:**
- **Serialize writes per organization.** Take one transaction-scoped advisory lock per organization, e.g. `pg_advisory_xact_lock` on a stable hash of a namespace plus `organization_id`, through one `security definer` helper. Call it from a BEFORE trigger (row or statement level, whichever the implementer proves correct) on:
  - `members` (insert, update of `role`, delete);
  - `member_status_versions` (insert, update, delete);
  - `team_membership_versions` (insert, update, delete).

  The deferred zero-admins check runs after the lock and re-reads committed state. Its row readers are volatile, so under READ COMMITTED they take a fresh snapshot. Verify this, and if a policy's subquery would still see a stale snapshot, move that invariant into the locked trigger.
- **Refuse TRUNCATE.** Add a `before truncate` statement trigger on `members`, `member_status_versions` and `team_membership_versions` that raises a named code.
- **Decide renames on the stored username.** In `members/services/write.ts`, decide it against the username the database holds at save time, not the cached row. Either read it fresh just before deciding, or send the expected old username to `admin-auth` and let the server compare. Pick the smaller correct change, and keep the refusal codes and messages unchanged.
- **One migration,** numbered next after main's latest (0023 at the time of writing). Remove 0010's KNOWN GAP comment only if the new migration closes it, and name the migration that does.

## Boundaries & Constraints

**Always:**
- **Race tests** run in `test/` against the live stack with two real connections, ordered deterministically:
  1. T1 begins and writes;
  2. T2 begins and its write blocks on the lock, which the test proves by `pg_locks`, or by T2 not finishing before T1 commits;
  3. T1 commits;
  4. T2 is refused, or proceeds correctly.

  Cover each of items 1–3, plus a positive case: two writes to different organizations do not block each other.
- **A TRUNCATE test** asserts the named refusal.
- **A rename test,** unit or boundary: a stale cached username with a changed stored username still moves the identity.
- Every existing RLS, provisioning and zero-admin test keeps passing.
- `supabase db reset` passes, and the migration is idempotent in the repo's style. Grant EXECUTE on the new function only to what needs it, and revoke from `anon`, `authenticated` and `service_role` as 0003/0020 do, if it is not called directly.
- Mutation-prove every new test: remove the lock call, drop the truncate trigger, revert the rename decision.
- Remove the deferred-work entries this closes, and update 0010's KNOWN GAP note.

**Ask First:**
- Changing the isolation level of any connection or session.
- Any change to RLS policy predicates beyond moving an invariant into the locked trigger.
- Any change to `admin-auth`'s request or response shape.

**Never:**
- No UI changes.
- No new i18n text.
- No change to what a single, non-concurrent write accepts or refuses.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0002_organizations_and_members.sql`, `0008_member_status.sql` -- `refuse_organization_with_no_admin`, the constraint trigger.
- `supabase/migrations/0008_member_status.sql` -- `member_status_versions` policies and the volatile row readers.
- `supabase/migrations/0010_*` -- `team_membership_versions` and its KNOWN GAP comment.
- `test/rls-isolation.test.ts`, `test/provisioning.test.ts` -- the existing live-DB patterns (`connect`, `actAs`, claims injection).
- `apps/web/src/features/members/services/write.ts` (~535, `usernameChanged`) and `supabase/functions/admin-auth/operations.ts` (`updateUserById`).
- `test/admin-auth-boundary.test.ts` -- the boundary test pattern.

## Tasks & Acceptance

**Execution:**
- [x] Migration: lock helper, lock triggers, TRUNCATE triggers.
- [x] Race, TRUNCATE and positive tests.
- [x] Rename decided against the stored username, with its test.
- [x] Deferred-work and 0010 note cleanup.

**Acceptance Criteria:**
- Given each fix reverted, when the new tests run, then they fail.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `supabase db reset` followed by `pnpm test` (after a web build), and `pnpm test:e2e` run, then all pass.

## Spec Change Log

- **2026-09-28, the lock alone left a stale read, so an AFTER trigger re-checks it.** Under READ COMMITTED a statement's snapshot is taken before its BEFORE trigger waits, so after the lock only VOLATILE readers see T1's commit. 0008's date-order rules read through volatile readers, and so do all of 0010's. The last-admin conjunct of 0008's insert and delete policies reads `members` inline, however, and `current_member_access()` is STABLE, so both use the stale statement snapshot. The spec says to move such an invariant into the locked trigger. Moving it into the BEFORE lock trigger would pre-empt the policy's 42501 on every single write, which the Never list forbids. It is therefore RE-CHECKED: `refuse_status_version_leaving_no_admin()`, an AFTER ROW insert/delete trigger, asks the policy's question again, as the owner and with fresh reads. No policy predicate changed, and AD-3's one constraint trigger is still the only one.
- **2026-09-28, review triage item 1: the rename needs an edited field AND a different stored value.** The first fix compared the entered username against the stored one alone. The form defaults the field to the cached username, so an email-only edit after another admin's rename silently renamed the member back. Now `saveMember` renames only when `usernameChanged(cached, entered)` and `usernameChanged(stored, entered)` both hold. An untouched field lets the other admin's rename stand. An edited field renames even with a stale cache. An edited field that the database already holds calls nothing. The deferred entry's "skipped rename" scenario (entered equals cached, stored differs) is therefore deliberately NOT a rename: the field was not edited. `MEMBER_EDIT_COLUMNS` is pinned to include `username`. `admin-auth` is unchanged.
- **2026-09-28, review triage item 2: the lock moved to a BEFORE STATEMENT trigger, keyed on the JWT claim, for request sessions only.** The first design (BEFORE ROW, every role, keyed on the row) fired after an UPDATE/DELETE row was already locked and before an INSERT's FK KEY SHARE. So a request write could hold the advisory lock while waiting on a tuple that an owner cascade held, while the cascade waited on the advisory lock: 40P01. A test reproduces this against the old design. Now the lock is taken before the statement touches any row, only when `role` is `authenticated`, and keyed on `auth.jwt() ->> 'organization_id'` (every policy pins the row to that claim). A missing or malformed claim takes no lock. Owner, seed, demo, cascade and `service_role` writes take no lock, so they can never be waited on for it, and no wait-for cycle runs through it. Re-verified what each check sees: the statement's snapshot still predates the wait, so inline reads stay stale. WITH CHECK, the DELETE scan's USING (which now also runs after the lock), the volatile readers, the deferred zero-admins check and the AFTER re-check all read fresh. The race cases now write through request sessions; case 1 has each admin delete their own row, which the delete policy admits.
- **2026-09-28, review triage item 3: the AFTER trigger also re-reads the caller.** It now first asks `current_member_access()` again, in a fresh query, whether the caller is still an active admin of the row's organization, and raises 42501 if not. A policy-admitted single write already has such a caller, so no single-write outcome changes. The gate is now stated precisely: the trigger runs when the session role is `authenticated` and the statement is top level (`pg_trigger_depth() = 1`, so a cascade from a self-delete is not re-checked). It keys on the role and cannot tell whether a policy actually governed the write.
- **2026-09-28, review triage item 4: 0010 is restored byte for byte.** It is forward-only. The narrowed KNOWN GAP (only the archive-and-assign race is left open) is recorded in 0023's header and in deferred-work.
- **2026-09-28, review triage items 5 and 6.** 0023's header now states that correctness relies on READ COMMITTED, with no behaviour change, and names `member_team_on` (0010) as well as `member_team_version_on` (0015) among the readers.
- **2026-09-28, final re-review: the status path maps the re-check's 23514.** `statusFailureOf` read every class-23 error other than 23505 as `MEMBER_WRITE_INVALID`, so the re-check's `ORGANIZATION_WOULD_HAVE_NO_ADMIN` would have shown "correct a value". It now checks `message` and `details` for that code first, as `editFailureOf` does, and returns the existing last-admin failure with no new text. `teamFailureOf` needs nothing: the only triggers on `team_membership_versions` are the lock, which never raises, and the TRUNCATE refusal, which no API write reaches. The 0023 header now says that "never refuses what the policy admitted" holds for single-row statements; a multi-row direct API insert can be stricter, because the AFTER ROW re-check sees every row the statement wrote. It also says that `admin-auth` writes as `authenticated`: its member insert takes the lock, and its username update does not.
- **2026-09-28, the membership deferred-work entry was narrowed, not removed.** Its archive-and-assign half is not closed, because `teams` takes no lock and is outside the spec's table list. New deferred entries: a demoted caller on the other two tables, unserialized owner writes, future definer RPCs, and the unasserted isolation level.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint` -- expected: exit 0.
- `pnpm exec supabase db reset`, then `pnpm test` -- expected: pass.
- `pnpm test:e2e` -- expected: pass.

**Results (2026-09-28, after the review triage):**
- `pnpm typecheck` and `pnpm lint`: exit 0.
- `supabase db reset` (0023 applied), `pnpm build`, `pnpm test`: exit 0, with 268 + 2847 workspace tests and 3232 root tests. The baseline on `a28c626` was 268 + 2842 and 3208. The difference is 5 rename unit tests, 18 cases in `test/concurrent-writes.test.ts` and 6 grant/security cases in `test/provisioning.test.ts`.
- `pnpm test:e2e`: 106 passed.
- Idempotence: 0023 was re-applied over itself (and over each mutant) seven times, with no error.

**Mutation proof.** Each mutant was planted live, the file run, then restored by re-applying 0023 or the source file. Scripts are in `scratchpad/concurrent-writes/`. `concurrent-writes.test.ts` has 18 cases; `write.test.ts` has 197.

| Mutant | Failed | Which, and why |
|---|---|---|
| Lock trigger takes no lock | 12 / 18 | every race and control ("T2 finished without waiting on the lock"), both lock-verb cases, and the positive control ("T1 took no lock on X") |
| One key for every organization | 12 / 18 | the positive control, plus every race case, because `waitUntilBlocked` matches this organization's key and T2 waited on another |
| The first design: BEFORE ROW, every role, row key | 3 / 18 | member-cascade deadlock case (`[ '40P01', 'ok' ]`), the `pg_trigger` level check, and the cancel-while-scheduled-out race (USING ran before a row-level lock, so the stale scan admitted the delete) |
| AFTER re-check trigger dropped | 4 / 18 | demote-then-deactivate, caller-demoted, cancel-while-demoted, `pg_trigger` check |
| Re-check without the caller branch | 1 / 18 | caller-demoted |
| Re-check without the last-admin branch | 2 / 18 | demote-then-deactivate, cancel-while-demoted (the DELETE branch) |
| TRUNCATE triggers dropped | 4 / 18 | all three TRUNCATE cases and the `pg_trigger` check |
| Rename without the cached-field condition | 1 / 197 | untouched field plus concurrent rename |
| Rename without the stored-value condition | 1 / 197 | edited field the database already holds |
| `username` removed from `MEMBER_EDIT_COLUMNS` | 1 / 197 | the column pin |
| `statusFailureOf` without the last-admin check | 2 / 199 | both 23514 cases (message and details) |
| `statusFailureOf` reading `message` only | 1 / 199 | the 23514 case carried in `details` |
| All restored | 0 | 18 / 18, and 397 / 397 in `members/services` |

The BEFORE placement of the lock (and so its deadlock-freedom) is also pinned by the catalog check, "declares each trigger on the events and level it is proved for", which asserts each trigger's `tgtype` bits: the lock is BEFORE (2) and statement level (no row bit), and the TRUNCATE triggers are BEFORE TRUNCATE (2 | 32).

After the final re-review (comments only in 0023, no `db reset`): `pnpm typecheck` and `pnpm lint` exit 0, and `apps/web` `src/features/members/services` passes 397 / 397.

## Suggested Review Order

1. `supabase/migrations/0023_serialize_organization_writes.sql`. Read the header's lock section (why the claim, why only `authenticated`, why it cannot deadlock) and "what each check sees" first. Then the statement-level lock function, then the re-check's gate, caller branch and last-admin branch, then the TRUNCATE triggers and the revokes.
2. `test/concurrent-writes.test.ts`. Read `advisoryKeyLock`, `waitUntilBlocked` and `race` (the ordering and the cleanup). Then the demote-and-deactivate, caller-demoted and cancel-while-demoted cases, which need the re-check. Then the two owner-cascade cases, the ones the first design deadlocked on.
3. `apps/web/src/features/members/services/write.ts` (`storedUsernameOf`, the two-condition rename in `saveMember`) and its cases in `write.test.ts`.
4. `test/provisioning.test.ts`: 0023's functions in the grantee, definer and invoker inventories.
5. `DEPLOY.md` §6 (the TRUNCATE maintenance procedure) and `_bmad-output/implementation-artifacts/deferred-work.md` (four entries removed, one narrowed, four added).
