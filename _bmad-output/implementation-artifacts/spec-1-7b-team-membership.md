---
title: 'Story 1.7b: An admin moves a member between teams from a chosen date'
type: 'feature'
created: '2026-09-24'
status: 'done'
review_loop_iteration: 0
baseline_commit: '5155b57be7697ac35f1582cbf47f8612aa4a10c3'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Teams exist (1.7a) but nobody is on one. AD-2 classifies team membership as **versioned**, so "which team was this member on at date D" must stay answerable after a move, and a member with no team must be stated, not blank.

**Approach:** Add `team_membership_versions`, reusing 1.6's `member_status_versions` rules unchanged: one row per change, effective from a date, never updated. `team_id` null means "no team from that date", and no rows at all means no team. An admin assigns, moves, removes or cancels from the member edit screen. The member list states each member's team today in words. Archiving a team that anyone is on today, or is scheduled to join, is refused. Epics.md story 1.7 clauses 2 and 3 (CAP-6, AD-2, UX-DR20).

## Boundaries & Constraints

**Always:**
- Copy 1.6's date rules, decided 2026-09-24:
  - `effective_from` is today or later in the organization's timezone, finite, and before year 10000.
  - Versions append in date order.
  - Each version changes the team: `team_id is distinct from` the latest state.
  - At most one version may be dated after today.
  - Only that one may be cancelled, by DELETE, while it is still in the future.
  - There is no update policy.
- The team as at date D is the row with the greatest `effective_from <= D`, and none means no team. One SQL reading, `member_team_on(member, date)`, serves the policies and the tests. The SPA derives the same thing from the embedded versions.
- `team_id` references `teams(organization_id, id)` through a composite FK, so a team from another organization cannot be referenced. An insert naming an archived team is refused.
- **Archive refusal:** the teams update policy's WITH CHECK refuses `archived = true` while any version for that team is in effect today or dated after today. It does not matter whether the member is active. The change is made with `alter policy` in the new migration; 0009 is never edited.
- Column-level INSERT grant on the fact columns only, so attribution cannot be forged. Revoke update, truncate, references and trigger, and strip `anon` (the 0008 precedent).
- Deactivation status and team are independent: neither blocks or rewrites the other. An admin may set their own team.
- "No team" is said in positive words ("Bez smjene"), never with `Nema`. Every string goes through `t()`. Team words live under `smjene.*`. Every control is `h-11`. A refused save names the problem and keeps the picked team and date.

**Ask First:**
- Editing a scheduled version in place, cancelling one already in effect, or a past effective date.
- Archiving that silently ends memberships instead of refusing.

**Never:**
- No `team_id` column on `members`. No membership row required at member creation. Seed and provisioning stay untouched.
- No team filter on the member list; it is deferred in deferred-work.md.
- No schedule or conflict derivation. Epic 3 re-asserts "no team → empty schedule, no conflicts".
- No new trigger, route, dependency or Edge Function operation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Assign today | Member with no team, active team A, date = org today | Row inserted, on A from today | N/A |
| Move from a date | On A, move to B dated D > today | On A before D, on B from D; A's row unchanged | N/A |
| Past team | Moved A→B from D | Team as at any date < D is A | N/A |
| Remove | On A, `team_id` null from D | No team from D | N/A |
| No versions | Fresh member | No team; list and edit say "Bez smjene" | N/A |
| Past date | Org yesterday | Refused, nothing written | Named refusal, values kept |
| Same date / out of order | Dated on or before latest version | Refused | Named refusal |
| Unchanged | Same team as latest state, or null while already no team | Refused | Named refusal |
| Second scheduled | A future version already exists | Refused; screen offers only cancel | Named refusal |
| Cancel scheduled | Latest version dated after today | Deleted; prior team continues | N/A |
| Cancel in effect | Dated today or earlier | Refused, row kept | Named refusal |
| Archived target | Insert naming an archived team | Refused | Named refusal |
| Foreign team or member | Other org's id | Refused | FK / RLS |
| Archive in use | Someone on T today, or scheduled onto T | Archive refused, team stays active | `smjene` in-use refusal naming the rule |
| Archive after move-off | Only past versions reference T | Archive admitted; past versions still read T | N/A |
| Member-role or foreign admin | Insert or delete via PostgREST | Refused | RLS |
| Member-role read | Own org | Sees all versions | N/A |
| Unbounded date | `infinity` or year 10000 | Refused by the table | N/A |

</frozen-after-approval>

## Code Map

Baseline `5155b57`. Run the suite there first and record the counts. `nvm use` (24.19.0), then `pnpm build` before `pnpm test`.

**Database:** new `supabase/migrations/0010_team_membership.sql`. The numbering must stay contiguous (`supabase-scaffold.test.ts:80-107`).
- Copy the table shape from `0008:64-109`: the member composite FK with cascade `:90-93`, the finite check `:95-96`, `unique (member_id, effective_from)` `:100-101`, the tenant index. The team FK is `(organization_id, team_id) → teams(organization_id, id)` (`0009:51`) with no cascade. MATCH SIMPLE admits a null `team_id`.
- Helpers are security invoker, **volatile** plpgsql with `search_path = ''`. Copy the reasoning at `0008:113-122` and the grants at `:235-253`. Reuse `organization_today`.
  - `member_team_on(member, date) returns uuid`: modelled on `member_active_on` `:169-186`.
  - `member_team_has_version(member)`: needed because null is ambiguous.
  - `team_membership_latest_version(member)`: modelled on `:216-229`.
  - `team_in_use(team)`.
- Insert policy: copy `0008:437-459` without the self and admin clauses. Changes-something is `team_id is distinct from member_team_on(member_id, 'infinity')`, plus a clause admitting a null `team_id` only when a version exists. Add the non-archived team clause.
- Delete policy: copy `:492-510` without the self and admin clauses.
- Grants: copy `:543-553`, with insert on `(organization_id, member_id, team_id, effective_from)`.
- `alter policy teams_update_by_own_active_admin ... with check (<0009:121-129 predicate> and (not archived or not public.team_in_use(id)))`. Use ALTER rather than re-creating, so the scaffold policy regex and count (`:317-352`, `:705`) stay valid.
- Banned text in migrations (`supabase-scaffold.test.ts:208-226`): fixture and organization names, IANA zones, `dan|noć|slobodno`, "four teams". Avoid "create constraint trigger" (`provisioning.test.ts:604-632`).

**DB tests**
- `rls-isolation.test.ts`:
  - Public policy list `:952-976` (twelve → fifteen, message `:957`).
  - Function list `:978-1000`.
  - `OWN_ORGANIZATION_READS` `:218-221` and count `:876`.
  - Team cleanup `:808-810` must delete membership rows before teams.
  - Put the new block after the 1.7a block (`:6689`, helpers `insertTeam` `:6719`). Copy the patterns from 1.6's helpers (`insertVersion` `:4899`, `cancelVersion` `:5355`, `organizationDay` `:4887`), and use `actAs` `:555` and `inRolledBackTransaction` `:233`.
- `supabase-scaffold.test.ts`: policy names `:296-352` (title and list), and a verbs block modelled on `:660-693`.
- `provisioning.test.ts`:
  - RLS tables `:758,765-770`.
  - Privilege matrix modelled on `:779-805`.
  - Tenant index modelled on `:865`.
  - Invoker grantees `:986-1024`.
- `seed.sql:37`: align the comment's table name only.

**Surface**
- `members/list.ts`:
  - `MEMBERS_COLUMNS` `:107-109`: add `team_membership_versions(team_id,effective_from,teams(name))`, which keeps the list at one query (`prijava.test.ts:2269-2288`). Reword the comment at `:104-105`.
  - Add a `teamVersionsIn` parser modelled on `:288`, with a malformed field in `memberRowOutcomeOf` `:480`.
  - Add `MemberListRow.teamVersions`.
  - Add `memberTeamOf(member, today)` → `{ team: {id,name}|null, scheduled: {team|null, from}|null }`, modelled on `memberStatusOf` `:398`.
  - Add a team column in `MEMBER_COLUMNS` `:816`, with `MemberColumnKey`/`MemberColumnLabel` `:704,:712`. `routes/ljudi.tsx` `cellContent` `:164` renders it.
- `members/write.ts` + `wire.ts`: mirror the status path.
  - `TeamOffer` / `teamOfferOf` (`:863,:902`) with no own-row exclusion. The options are the active teams minus the current one, plus "Bez smjene" when the member is on a team. A scheduled change offers only cancel, and the minimum date comes from the same rule.
  - Preflight modelled on `:951`, failure mapping modelled on `statusFailureOf` `:1022`, send modelled on `sendStatus` `:1052`.
  - Codes `MEMBER_TEAM_*` go in `wire.ts` next to `:138-160`, the failure union `:252`, and `memberWriteMessageKey` `:492`.
  - Stage and confirmation are modelled on `:1160-1220`. `EVERY_FAILURE` goes in `write.test.ts:396`.
- `teams/write.ts`: an archive refused by WITH CHECK (`42501` with an admin on screen) maps to a new `TEAM_IN_USE` → `smjene.error.inUse`, with the exhaustive switch extended.
- `routes/ljudi.$id.tsx`: add the team block after `renderStatus` `:768-815`, with its own ref, pending and armed state. The picker reads `TEAMS_LIST_KEY`/`readTeams` → `splitTeams().active` (`teams/list.ts:27,123,194`). Invalidate `MEMBERS_LIST_KEY`.
- Gates:
  - `prijava.test.ts`: `expectedControls` `:287,:308`, `IN_FLIGHT_HANDLERS` `:437` and length `:3285`, `KEY_SOURCES` counts `:1194-1319`.
  - `resource-hygiene.test.ts`: `SANCTIONED_SCREEN_KEYS` `:422-451`, imperative pins `:675-748`. Keys stay under `smjene.membership.*` so the `smjen` rule `:490-502` holds unchanged.
  - `localization-applied.test.ts`: `AUTHORED_VOCABULARY` `:435-758` for new capitalised words. `Nema` stays banned `:776`.

**Status:** `sprint-status.yaml` gets `1-7b-team-membership` under the 1.7 split comment. When it lands, the `1-7-…` parent is done.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0010_team_membership.sql` -- table, helpers, policies, grants, archive WITH CHECK -- the whole enforcement.
- [x] `test/rls-isolation.test.ts`, `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts` -- every matrix row over both fixtures (SQL plus one live REST path per verb, including the shipped `MEMBERS_COLUMNS` select as admin and member); forged `created_by`/`created_at` refused; inventories moved -- the matrix is proven where it is enforced.
- [x] `apps/web/src/members/list.ts`, `members/write.ts`, `members/wire.ts`, `teams/write.ts` (+ tests) -- parse, derive today's and scheduled team, offer, preflight, send, refusal mapping, archive in-use mapping -- logic runs without a browser (AD-15).
- [x] `apps/web/src/routes/ljudi.$id.tsx`, `routes/ljudi.tsx`, `hr.json` + gate tests -- the team block and the list column in words.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml`, `supabase/seed.sql` comment -- keys and alignment.

**Acceptance Criteria:**
- Given a move A→B from D, when the table is inspected, then one new row exists and A's row is byte-identical.
- Given versions spanning several changes, when the team is asked for every date across the period, then SQL `member_team_on` and the SPA derivation agree on every date.
- Given the member edit and list screens at phone width, when used, then every control clears 44 px and the page does not scroll horizontally.

## Design Notes

**Why archive refuses rather than ends memberships:** an archive that ended memberships would be a write to another table hidden inside an update. Without a trigger, it would need a function, and AD-3/AD-5 forbid both. Refusal keeps "no derivation meets an archived team for today or later" provable from the policy alone. Past versions may still point at an archived team, which is R7.6's point: it stays readable.

**Concurrency:** a concurrent archive and assign under READ COMMITTED can both pass. This is the same class as the 1.6 entry in `deferred-work.md` and is not closed here.

## Verification

**Commands:**
- `pnpm exec supabase db reset` -- exit 0.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `git diff --stat package.json pnpm-lock.yaml apps/web/package.json` -- empty.
- Mutation probes, each of which must fail the suite:
  - drop the today-or-later check
  - admit an out-of-order or unchanged version
  - allow a second future version
  - let delete remove an in-effect version
  - drop the archived-target clause
  - drop the archive WITH CHECK
  - have `team_in_use` ignore scheduled versions
  - read today in UTC
  - map `TEAM_IN_USE` to the generic message
  - misspell the embed in `MEMBERS_COLUMNS`

## Suggested Review Order

**Enforcement: the versioned table and its rules**

- Entry point: append-only versions; null `team_id` means no team from that date.
  [`0010_team_membership.sql:53`](../../supabase/migrations/0010_team_membership.sql#L53)

- Insert policy: today-or-later, date order, one future, changes something, live team.
  [`0010_team_membership.sql:252`](../../supabase/migrations/0010_team_membership.sql#L252)

- Cancellation: only the latest version, only while still in the future.
  [`0010_team_membership.sql:284`](../../supabase/migrations/0010_team_membership.sql#L284)

- Archive refusal via ALTER POLICY, so 0009 stays untouched and inventories hold.
  [`0010_team_membership.sql:304`](../../supabase/migrations/0010_team_membership.sql#L304)

- No update, attribution unforgeable, `anon` stripped — the 0008 precedent.
  [`0010_team_membership.sql:323`](../../supabase/migrations/0010_team_membership.sql#L323)

**Reading the team as at a date**

- The one SQL reading: latest version on or before the date, none means no team.
  [`0010_team_membership.sql:118`](../../supabase/migrations/0010_team_membership.sql#L118)

- In use = in effect today or scheduled, both in the organization's own today.
  [`0010_team_membership.sql:181`](../../supabase/migrations/0010_team_membership.sql#L181)

- The SPA's twin of `member_team_on`, asserted against the same written-out answers.
  [`list.ts:369`](../../apps/web/src/members/list.ts#L369)

- One shared history both suites read, so the two readings provably agree.
  [`team-history.fixture.ts:1`](../../apps/web/src/members/team-history.fixture.ts#L1)

**Member list: the team in words**

- One read still: the team history and its names arrive embedded.
  [`list.ts:113`](../../apps/web/src/members/list.ts#L113)

- A version whose team name did not arrive refuses the row, never says "no team".
  [`list.ts:326`](../../apps/web/src/members/list.ts#L326)

- Team column sorts by today's team; "Bez smjene" in words, never blank.
  [`ljudi.tsx:178`](../../apps/web/src/routes/ljudi.tsx#L178)

**Edit screen: assign, move, remove, cancel**

- The offer: active teams minus current, no-team only when on one, cancel-only when scheduled.
  [`write.ts:1317`](../../apps/web/src/members/write.ts#L1317)

- Named refusals preflighted, then read against what was sent after a 42501.
  [`write.ts:1431`](../../apps/web/src/members/write.ts#L1431)

- History key includes team names, so a rename clears a stale confirmation.
  [`write.ts:1542`](../../apps/web/src/members/write.ts#L1542)

- Arming never goes unanswered: an unread or vanished pick reads as stale.
  [`ljudi.$id.tsx:327`](../../apps/web/src/routes/ljudi.$id.tsx#L327)

- An armed or pending confirmation outlives its offer across a refetch.
  [`ljudi.$id.tsx:1119`](../../apps/web/src/routes/ljudi.$id.tsx#L1119)

- Archive's 42501 can only be the in-use clause: USING already passed the same predicate.
  [`teams/write.ts:129`](../../apps/web/src/teams/write.ts#L129)

**Peripherals: proofs and inventories**

- The matrix over both fixtures, SQL first.
  [`rls-isolation.test.ts:7364`](../../test/rls-isolation.test.ts#L7364)

- AC 2: `member_team_on` against the shared history's answers, every date.
  [`rls-isolation.test.ts:7469`](../../test/rls-isolation.test.ts#L7469)

- Archive refusal: today, scheduled, inactive member, organization timezone.
  [`rls-isolation.test.ts:8136`](../../test/rls-isolation.test.ts#L8136)

- An archived team's name still reaches both readers through the shipped select.
  [`rls-isolation.test.ts:8346`](../../test/rls-isolation.test.ts#L8346)

- Team sort through the narrowing itself, not just `sortValue`.
  [`list.test.ts:775`](../../apps/web/src/members/list.test.ts#L775)

- Privilege matrix and RLS table inventory grow by the new table.
  [`provisioning.test.ts:849`](../../test/provisioning.test.ts#L849)

- Policy-name inventory: three new policies, the teams update altered not re-created.
  [`supabase-scaffold.test.ts:349`](../../test/supabase-scaffold.test.ts#L349)
