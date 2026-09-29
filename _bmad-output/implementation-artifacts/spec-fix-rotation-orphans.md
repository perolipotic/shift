---
title: 'A never-assigned rotation pattern can be removed, a failed save cleans up after itself, the rotation read is bounded, and moving the anchor by whole cycles changes nothing'
type: 'bugfix'
created: '2026-09-29'
status: 'done'
review_loop_iteration: 0
baseline_commit: '11267d188a378c034f10dcf8376434d53a918811'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The deferred-work triage on 2026-09-27 put three entries into "package 2c". All are still open on main.
1. **Orphan patterns** ("Patterns and steps have no delete path…"). A failed or abandoned rotation save leaves a pattern, possibly with steps. No session can remove it, and every member reads it. A wrong step added before the first assignment cannot be taken back.
2. **Unbounded read** ("The rotation snapshot embeds every pattern, step and assignment the organization ever had…"). The single read under `ROTATION_KEY` grows with every save.
3. **Whole-cycle anchor move** ("The assignment 'changes the value' rule compares pattern, offset step and anchor literally…"). Moving the anchor by a whole number of cycles, with the same offset, writes a new version that projects exactly the same shifts.

**Approach:**
- **Removal.** Add a delete policy that lets an active admin of the organization delete a pattern, and its steps, only while no assignment (`team_rotation` version or equivalent) references that pattern. Enforce this in the policy predicate or in a trigger, so a referenced pattern can never be removed. Steps of such a pattern can be deleted too.
  - The builder's save flow, on a failure after it has created a pattern, deletes that pattern best-effort before reporting the refusal, and keeps what the admin entered. A failed cleanup is logged and never turns the refusal into something else.
- **Bounded read.** Limit the `ROTATION_KEY` read to:
  - assignments in force today or scheduled after today, in the organization's timezone;
  - the patterns and steps those assignments reference;
  - any pattern that no assignment references yet, which the builder may still need.

  Every consumer must keep working: the builder prefill, the phone stepper, the 2.5 warnings, 2.6's from-a-date changes, and the 3.5c disposition, if it reads through this key. If any of them needs older history, keep that history and record why.
- **Equivalent anchor.** Treat two assignments as the same value when they have the same pattern, the same offset step, and anchors that differ by a whole multiple of the pattern's cycle length in days. Such a save is refused with the existing "unchanged" outcome, exactly like a literal no-op. Apply this where the rule lives today (`0016` around line 417, and the `packages/domain` rule and client preflight if they mirror it), so client and database agree.
- **Migration.** Write one forward migration, numbered after main's latest; that is 0025 at the time of writing.

## Boundaries & Constraints

**Always:**
- **Live-DB tests:**
  - A never-assigned pattern and its steps can be deleted by an admin.
  - A referenced pattern cannot be deleted by an admin or by a member.
  - A member cannot delete any pattern.
  - Another organization's pattern cannot be deleted.
- **Other tests:**
  - A unit or E2E test for the save-failure cleanup: after a held or forced failure, no orphan remains.
  - A unit test for the bounded read's selection, plus an E2E test that the builder, the stepper and the warnings still work.
  - Domain and DB tests for the equivalent anchor: a move by +1, +2 or −1 cycles is unchanged; a move by a non-multiple is a change; a change of pattern or offset is a change.
- Existing rotation, calendar and 3.5 tests keep passing.
- `supabase db reset` passes, and the migration is idempotent in the repo's style.
- Grants follow the repo pattern: revoke EXECUTE on any new function from `anon`, `authenticated` and `service_role` unless it is called directly.
- New or changed name checks use `private.name_key`, per the spine.
- Mutation-prove every new test.
- Remove the three deferred-work entries this closes.

**Ask First:**
- Any change to the non-atomic save design, which was decided by the human on 2026-09-25.
- Bounding that would drop history a consumer needs.
- Any UI change beyond the cleanup, and any new text.

**Never:**
- No update grant on patterns or steps; they stay immutable.
- No change to what projects on any date.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0016_*` (rotation) -- patterns, steps, assignments, their policies, and the literal "changes the value" rule (~417).
- `packages/domain` -- the rotation rule and projection (`projection.ts`); any mirrored "unchanged" rule.
- `apps/web/src/features/rotation/{services,hooks,utils}` -- `ROTATION_KEY`, snapshot read, builder save flow, prefill, warnings, stepper.
- `apps/web/src/features/calendar/services/snapshot.ts` -- the calendar's own read; confirm it does not depend on `ROTATION_KEY`.
- `supabase/migrations/0022_shift_type_override_disposition.sql` -- 3.5c; check what it reads.
- `test/rls-isolation.test.ts` -- live-DB patterns; `e2e/tests/rotation/`.

## Tasks & Acceptance

**Execution:**
- [x] Migration: delete policy (or trigger) for never-referenced patterns and their steps; equivalent-anchor rule.
- [x] Builder save-failure cleanup.
- [x] Bounded `ROTATION_KEY` read.
- [x] Domain and client unchanged-rule alignment.
- [x] Tests, then deferred-work cleanup.

**Acceptance Criteria:**
- Given each fix reverted, when the new tests run, then they fail.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `supabase db reset` + `pnpm test` (after a web build) and `pnpm test:e2e` run, then all pass.

## Spec Change Log

- **2026-09-29, implementation.** Migration number 0025 (`0025_rotation_orphans.sql`); main and every worktree held nothing above 0024.
- **"Referenced" is any existing assignment row, in any version** (`rotation_pattern_in_use`, 0016's reader). Enforced twice: the new delete policies' `not public.rotation_pattern_in_use(...)` (a delete of a referenced pattern or step matches no row), and 0016's NO ACTION `rotation_assignments_pattern_fkey` (a pattern an assignment names can never be deleted, concurrently or not). The step key does not cascade (0016's no-cascade guard kept), so the cleanup deletes steps, then the pattern.
- **Existing tests changed, not relaxed:** 2.3a's "delete a pattern / delete a step" of the seeded (referenced) pattern expected 42501 (no grant); with 0025's grant and policy they now assert zero rows removed, in SQL and over PostgREST. The policy inventories (`test/rls-isolation.test.ts`, `test/supabase-scaffold.test.ts`), the privilege pins and function grantee lists (`test/provisioning.test.ts`) and the write-module delete guards (`write.test.ts`, `apps/web/src/pages/prijava.test.ts`: two deletes, the cancel and the cleanup) name the additions.
- **The bound is computed in SQL**, as two PostgREST computed relationships (`rotation_assignments_in_view`, `rotation_steps_in_view`, SECURITY INVOKER STABLE SQL) the one read embeds, so the read stays one request under one key. The "unit test for the selection" is therefore a live-DB test (`test/rls-isolation.test.ts`, "the builder read embeds what is in force from the horizon on"), plus unit tests of the client side (`list.test.ts`, "the bounded read (0025)").
- **Older history kept, as the spec's Approach allows (no history dropped, so not Ask First):**
  - the horizon per team is `least(today, earliest LIVE override date)`, because 3.5c projects a pending override's date, which may lie before today under an older version;
  - the attribution columns of every version (id, team, pattern, effective date, author, save time; no offset, anchor or step) are still read whole, as a third embed `rotation_history`, because 2.6's history lists every saved change (previous ones included) and 3.5c's pending rule reads every version's save time.
- **The cycle-equivalence rule lives in 0025's `alter policy rotation_assignments_insert_by_own_active_admin`** (anchors differ by a multiple of the pattern's step count). The domain mirror is `sameRotationValue` in `packages/domain/src/projection.ts` (exported, tested; the app does not call it, because the builder always saves a new pattern). The client preflight `draftUnchangedOf` already judged by projection and so already agrees; a test now pins that agreement.
- **Known gap recorded, not closed:** a step delete (like 0016's step insert) and a concurrent first assignment of the same pattern can both pass under READ COMMITTED. New deferred-work entry; attaching 0023's lock to the rotation tables would also change `test/concurrent-writes.test.ts`'s pinned trigger list.
- The cleanup's outcome shape and texts are unchanged (`afterPattern` still says "nothing changed"); the only UI-file change is the typed table seam in `rotation-section.tsx`.
- **2026-09-29, review round (2c patches).** Supersedes the horizon and domain-mirror bullets above:
  - **The horizon comes from PENDING overrides only**, and has **a day of margin**: per team `least(organization_today - 1, earliest pending override date)`. Pending is 3.5c's rule: the governing version (greatest `effective_from` on or before the date) was saved after `coalesce(confirmed_at, created_at)`. An override in force, a removed one, and one no version governs keep no older version; a future one is later than yesterday, so `least` ignores it. The margin covers a device clock behind the server's at midnight: its "today" is still yesterday, and the version in force then is read.
  - **The overrides embed is bounded too**, by a third computed relationship `rotation_overrides_in_view` (live and pending, an ungoverned one included, so the admin can still discard it). The builder reads no override in force; nothing in it used them.
  - **The cleanup never races an unknown outcome**: `discardUnassignedPattern` runs only after a definite failure (a refusal the database answered, or a failure at the pattern or steps stage). An assignment insert that threw, or answered malformed rows, may still commit, so nothing is removed after it.
  - **The cleanup is time-boxed** (`ROTATION_CLEANUP_TIMEOUT_MS`, 5 s for both deletes): past it the request in flight is aborted through `abortSignal`, nothing further is sent, and the refusal is answered unchanged.
  - **`sameRotationValue` is removed** from `packages/domain` (export and tests): nothing called it, and the builder's own no-op is judged by projection (`draftUnchangedOf`). The draft test now claims only that.
  - **A strict-subset unit test** (`list.test.ts`, "every consumer over a strictly bounded snapshot (0025)") feeds the selection 0025 makes, and the full set, through the disposition rows, the version in force and the prefill, the scheduled and cancel helpers, the save refusals and the 2.5 warnings; each answers the same from the horizon on. (The 2.5 warnings read the draft and the shift types, not the assignments, so their check pins only that the bound does not reach them.)
  - **The E2E cleanup check** counts the one pattern the failing save created (by the id its insert answered) and its steps, not every unassigned pattern of the organization.
  - **Still linear, recorded in deferred-work**: the `rotation_history` embed (attribution columns of every version), and a pending override left undisposed keeps every version from its date on.

## Verification

**Mutation proof** (each planted, the named tests failed, then restored; scripts in the session scratchpad `rotation-orphans/`):

| # | Mutation | Failed |
|---|---|---|
| M1 | pattern delete policy without `not rotation_pattern_in_use(id)` | rls: referenced pattern refused (both fixtures) |
| M2 | step delete policy without `not rotation_pattern_in_use(pattern_id)` | rls: referenced pattern refused (both) |
| M3 | step delete policy without `member_role = 'admin'` | rls: member refused (both) |
| M4 | no `grant delete` on patterns and steps | rls: all 8 removal cases |
| M5 | 0016's literal anchor comparison back | rls: whole-cycle refusal (both) |
| M6 | `rotation_assignments_in_view` unbounded | rls: bounded selection (both) |
| M7 | horizon ignores overrides | rls: bounded selection (both) |
| M8 | `rotation_steps_in_view` drops never-assigned patterns | rls: bounded selection (both) |
| M9 | horizon counts removed overrides | rls: bounded selection (both) |
| T1 | save does not clean up after a failure | `write.test.ts` 2 tests; E2E "a save that fails after its pattern…" |
| T2 | cleanup deletes the pattern before its steps | `write.test.ts` 3 tests |
| T3 | a failed cleanup turns the refusal into "unavailable" | `write.test.ts` 1 test |
| T4 | a failed cleanup (zero patterns) is not logged | `write.test.ts` 1 test |
| T5 | history read from the bounded assignments | `list.test.ts` 2 tests |
| T6 | kept versions not checked against the history | `list.test.ts` 1 test |
| T7 | the plain `rotation_steps(` embed back | `list.test.ts` 2 tests |
| T8 | `draftUnchangedOf` compares over no dates | `draft.test.ts` "agrees with 0025" |
| D1 | `sameRotationValue` literal on the anchor | domain 2 tests |
| D2 | `sameRotationValue` ignores the offset step | domain 2 tests |
| D3 | `sameRotationValue` ignores the pattern | domain 2 tests (function since removed, review round) |

**Review round (2c patches)**, each planted, run and restored (`sqlmut.py`, `tsmut.py`, `e2emut.py`; SQL mutants applied to the live stack under the E2E lock):

| # | Mutation | Failed |
|---|---|---|
| M10 | horizon from every live override (pending rule dropped) | rls: bounded selection (both fixtures) |
| M11 | horizon ignores pending overrides | rls: bounded selection (both) |
| M12 | an override date always wins over yesterday (a future pending override moves the horizon) | rls: bounded selection (both) |
| M13 | no day of margin (horizon today) | rls: bounded selection (both) |
| M14 | `rotation_overrides_in_view` keeps every live override | rls: bounded selection (both), PostgREST embed (both) |
| M15 | `rotation_overrides_in_view` drops a pending override no version governs | rls: bounded selection (both) |
| T9 | cleanup runs after an assignment insert that threw | `write.test.ts` "an assignment insert whose outcome is unknown removes nothing" |
| T10 | no time box on the cleanup | `write.test.ts` "a cleanup that hangs is aborted at its time box" |
| T11 | the cleanup passes a signal nothing aborts | `write.test.ts` "a cleanup that hangs…" |
| T12 | the time box is never cleared | `write.test.ts` "a cleanup that hangs…" |
| T8′ | `draftUnchangedOf` compares over no dates | `draft.test.ts` "judges by projection…" (reworded), and 4 more |
| T13 | a pending row projects through the team's first version | `list.test.ts` strict subset: disposition rows |
| T14 | the prefill reads a version from before the horizon | `list.test.ts` strict subset: version in force and prefill |
| T15 | the cancel expects every version up to the scheduled date | `list.test.ts` strict subset: scheduled, cancel, refusals |
| T16 | the scheduled date is the earliest version before today | `list.test.ts` strict subset: scheduled, and "flags a version scheduled after today" |
| T17 | the version in force is judged over the team's first two versions | `list.test.ts` strict subset: 2 tests |
| E1 | no cleanup after a refused save | E2E "a save that fails after its pattern…" (the one pattern's rows counted) |
| E2 | the cleanup removes the steps but not the pattern | E2E "a save that fails after its pattern…" |

The 2.5 warnings read the draft and the shift types, never the assignments, so no subset mutant can reach them; the strict-subset test pins only that they agree.

**Review-round run:** `pnpm typecheck`, `pnpm lint` exit 0; `supabase db reset` + web build + `pnpm test`: domain 268, web 2908, root 3303 passed; `pnpm test:e2e`: 107 passed.

**Commands:**
- `pnpm typecheck`, `pnpm lint` -- expected: exit 0.
- `pnpm exec supabase db reset`, then `pnpm test` -- expected: pass.
- `pnpm test:e2e` -- expected: pass.

## Suggested Review Order

1. `supabase/migrations/0025_rotation_orphans.sql` -- the two delete policies and grants, the altered assignment insert policy (whole cycles), and the three computed relationships with the horizon rule (pending overrides, a day of margin).
2. `apps/web/src/features/rotation/services/list.ts` -- the bounded embeds, the unbounded attribution-only `rotation_history` embed, and the subset check.
3. `apps/web/src/features/rotation/services/write.ts` -- `discardUnassignedPattern` (time-boxed) and `failedAfterPattern` in `saveRotation`, skipped after an unknown assignment outcome.
4. `apps/web/src/features/rotation/services/list.test.ts` -- "every consumer over a strictly bounded snapshot (0025)": the subset the bound selects answers every consumer as the full set does.
5. `test/rls-isolation.test.ts` -- the four 0025 describes, and the changed 2.3a removal expectations.
6. `apps/web/src/features/rotation/services/{write,list}.test.ts`, `utils/draft.test.ts`, `packages/domain/test/projection.test.ts` -- unit coverage.
7. `e2e/tests/rotation/rotation.spec.ts`, `e2e/utils/database-helper.ts` -- the save-failure cleanup E2E.
8. `test/supabase-scaffold.test.ts`, `test/provisioning.test.ts` -- guard and catalogue updates.
9. `_bmad-output/implementation-artifacts/deferred-work.md` -- three entries removed, two added (the rotation write serialization gap; the linear history embed).
