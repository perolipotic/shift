---
title: '18.2 A loan is a recorded exception'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_commit: '61976e774844c48e91a5796b18a0fd3767cbbd23'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-18-1-the-loan-rule-in-the-domain.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 18.1 put the loan rule (R11) in `@shift/domain`, but nothing stores a loan and the browser snapshot feeds the rule none. FR-88 needs a loan to be an attributable, removable exception that the database itself keeps consistent (AD-3), that only an admin writes (Q2, D7), and that every roster the browser derives follows.

**Approach:** Migration `0062_team_loans.sql` creates `team_loans`, shaped like `leave_records`: organization first, a `daterange`, a required reason, AD-11 attribution, soft removal, an overlap exclusion on live loans, an admin-only insert policy that also refuses a loan to an archived team or to the member's home team on any covered date, AD-3's two audit triggers, and a definer read `calendar_team_loans()` for every active member (no reason, no author). The calendar snapshot reads it as a fourth rpc and puts each member's live loans on their `members` entry and on the viewer, so every web mapper follows a loan through 18.1's fallback.

## Boundaries & Constraints

**Always:**
- A live loan is one with `removed_at is null`. Removed loans never reach the snapshot. Ending early is 18.4's amend: the old row is removed and a shorter replacement inserted, so past dates stay covered.
- A refused write is schema shape, a policy conjunct, a key, a check or the exclusion. No new trigger except the two audit triggers.
- The table's select is an active admin's (it holds `reason`, `created_by`, `removed_by`). Every active member reads live loans through `calendar_team_loans()`, which returns `id, member_id, team_id, starts_on, ends_on` only.
- No loan anywhere ⇒ every snapshot-derived figure is unchanged: members carry `loans: []`, which 18.1's digests proved identical.
- `DEVICE_SNAPSHOT_SHAPE` is bumped, because the persisted calendar entry's mapped shape changes.
- Never apply the migration locally, never run a DB-connecting root test or e2e locally (STRICT DATABASE RULE). Update their pins unrun; CI is the gate.

**Ask First:** none (the founder approved v2 and asked for decisions to be recorded, not asked).

**Never:** no UI, no `hr.json` keys, no notification, no update/delete grant or policy, no remove/amend function (18.3, 18.4). No change to `@shift/domain`. No history wording (18.5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin lends | active admin inserts member, other active team, range, reason | row stored, `created_by` = caller, one audit INSERT event | none |
| Overlap | a second live loan of the member sharing a date | refused | 23P01 `team_loans_no_overlap` |
| Removed then again | first loan soft-removed (owner SQL), same dates inserted | stored | none |
| Home team | loan team is the member's team on any covered date | refused | 42501 (policy) |
| Archived team | loan team archived | refused | 42501 (policy) |
| Teamless member | member with no team lent | stored | none |
| Member role | member-role session inserts, updates or deletes | refused | 42501 / zero rows |
| Member reads | member-role session selects the table / calls the read | no rows / every live loan of the org, no reason | none |
| Bad shape | reversed, empty, infinite, out-of-years range; blank or >200-char reason; forged `created_by`; other tenant's member or team | refused | 22000 / 23514 / 22008 / 42501 / 23503 |
| Snapshot | read answers a loan of member M | M's `members` entry and (if viewer) `viewer` carry it; rosters follow | malformed answer, unknown team, overlap ⇒ `CALENDAR_UNAVAILABLE` |

## Epic AC Deviations

- AC 2, "it can read only its own loans": reinterpreted. A member reads every live loan of their organization's members, without reason or author, through `calendar_team_loans()`, and reads nothing from the table itself. R11.2 needs every member's loans to derive any roster the member is shown (the calendar shows them every team), and FR-92 makes the reason admin-only. The facts returned are exactly what the derived rosters already reveal. The table itself is admin-only.
- AC 3, "`member_schedule_inputs` (if 16.2 has shipped) ... parity test": 16.2 has not shipped (sprint status `backlog`), so there is no server read to compare. Deferred to 16.2 in `deferred-work.md`.
- AC 1, "an audit trigger": met as AD-3's two audit triggers, as AD-11 requires.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0062_team_loans.sql` -- new. Copy the shapes of `0028_leave_records.sql` (range checks, exclusion, policies, grants), `0036` (reason `btrim` code-point list, `reason_length`), `0019` (archived `not exists` conjunct; definer calendar read and its grants) and `0061` (trigger shape; `revoke truncate ... from anon, authenticated, service_role`).
- `apps/web/src/features/calendar/services/snapshot.ts` -- `CALENDAR_TEAM_LOANS_FUNCTION`, fourth rpc in `readCalendar` (:510-517), `loansOf` validator (shape of `rosterOverridesOf` :698; group by member, `checkLoans` per member, team in `teamIds`, ignore unknown member as `versionsByMemberOf` does), `loans` on `CalendarMember` (:257, built :675-681) and `CalendarViewer` (:269, built in `viewerOf` :1042). `CalendarRefusal` gains `'loan'`. Header doc block names the fourth rpc.
- `apps/web/src/features/rotation/rotation.fixture.ts` -- `calendarTableOf` (:458) gains a `loans` answer (default none) and `calendarLoanRow`, `loansAnswerOf`.
- `apps/web/src/features/calendar/services/snapshot.test.ts` -- rpc sequence (:139-146), rpc count pin (:1471, 3→4), deep-equals of members/viewer (`loans: []`), stub at :1049, new loan read cases.
- `apps/web/src/lib/offline/persistence.ts` -- `DEVICE_SNAPSHOT_SHAPE` 2→3, note why.
- Mappers (deferral input; each stays unchanged, proven by a loan-bearing test in `apps/web/src/features/calendar/services/loans-follow.test.ts`): `calendar/utils/month.ts` (`memberScheduleInputOf` :1039 and the person month that calls it; `snapshotScheduleInputOf` passes `members: snapshot.members` unfiltered), `calendar/utils/change-preview.ts:128`, `calendar/utils/day-detail.ts:984`, `calendar/utils/replacement-candidates.ts:178`, `members/services/deactivation-consequence.ts:88`, `members/services/team-move-preview.ts:100`, `swaps/services/swap-proposal.ts:356`. Deliberately left: `members/services/member-erasures.ts` (spreads `...member`, keeps `loans`); `collisionInputOf`, `staffingInputOf`, `memberHoursInputOf` (spread `snapshotScheduleInputOf`); `day-detail.ts:319/744`, `replacement-candidates.ts:139-140`, `deactivation-consequence.ts:107-108`, `replacement-effect.ts:137`, `month.ts:710/1246` (pass `snapshot.members` whole). No web caller narrows `members` by home team.
- `e2e/utils/database-helper.ts` -- delete `team_loans` (and outbox rows whose `subject_id` is one) before members are deleted (`removeFormerMemberInSql` :200, `removeLeaveMemberInSql` :407, `removeOfflineMemberInSql` :680) and before a team is (`removeTeamInSql` :1691), same transaction.
- `test/supabase-scaffold.test.ts` -- `AUDITED_TABLES` (:3527) gains `team_loans`; the 21-table message; the declared-policy list (:487, sixty-one → sixty-three); a 0062 shape block.
- `test/provisioning.test.ts` (unrun) -- RLS table list (:695-735), `AUDITED` (:2254), `ACCESS_CONTROL_FUNCTIONS` + `calendar_team_loans` argumentCount 0 (:2492), a `team_loans` privilege/constraint block after leave_allowances' (:1652).
- `test/rls-isolation.test.ts` (unrun) -- policy-name list (:972), a `team_loans` behaviour block modelled on the 13.3 block (:26559).
- `_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md` -- AD-2 Loan row, AD-11 amended (22 audited tables), CAP-24 row count, Core entities.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0062_team_loans.sql` -- table, checks, exclusion, indexes, two policies, grants, `calendar_team_loans()`, audit triggers, TRUNCATE revoke -- FR-88, AD-2/3/11.
- [x] `test/supabase-scaffold.test.ts` -- audit set, policy list, 0062 shape pins -- run locally.
- [x] `test/provisioning.test.ts`, `test/rls-isolation.test.ts` -- pins and behaviour for every matrix row -- unrun, CI.
- [x] `apps/web/src/features/calendar/services/snapshot.ts` + `rotation.fixture.ts` + `snapshot.test.ts` -- the loans read and its validation.
- [x] `apps/web/src/features/calendar/services/loans-follow.test.ts` -- one loan-bearing test per mapper above (R11.6-shaped: the lent member's shift on a covered date is the loan team's).
- [x] `apps/web/src/lib/offline/persistence.ts` -- bump the shape.
- [x] `e2e/utils/database-helper.ts` -- cleanup order.
- [x] `ARCHITECTURE-SPINE.md` -- `Amended 2026-11-20 (story 18.2)` clauses on AD-2 and AD-11.
- [x] `deferred-work.md` -- mark the 18.2 entry RESOLVED; add entries for 16.2 (parity), 18.3 (reason field in the dialog, UX-DR58), 18.4 (archiving a team with live loans; removal/amend definers).
- [x] `sprint-status.yaml` -- 18.1 `done`; 18.2 `review` (built, CI pending).

**Acceptance Criteria:**
- Given no `team_loans` row, when the calendar snapshot is read and every figure derived, then the result equals the result before this change except `loans: []` on each member and the viewer.
- Given a live loan in the read, when any of the seven mappers runs for the lent member on a covered date, then it follows the loan team.
- Given the DB-free root tests, web and domain suites, typecheck and lint, when run locally, then they pass.

## Design Notes

1. **Home-team refusal as a policy conjunct.** A membership version `v` of the member to the loan team is in effect on some date of `[lower, upper)` iff `v.effective_from < upper(during)` and no LATER version of the member (any one starting after `v`) starts on or before `lower(during)`. Two versions of one member on one date are impossible (0010's key on `(member_id, effective_from)`), so "later" is strict. One `not exists` over `team_membership_versions`, which an admin reads. A team move written after the loan can still make it point home; the domain derives that as the home team (R11.3).
2. **Reason required**, 1–200 code points after the 0036 trim, because FR-88 records it. UX-DR58 has no reason field yet; 18.3 adds one (deferred entry).
3. **No length cap** on the range: a loan "for a while" has no stated limit, unlike leave's 366 days.
4. **No serialization trigger.** Like `leave_records`, the policy decides on the statement's snapshot; a team archived concurrently is a residual race.

## Verification

**Commands:**
- `pnpm --filter @shift/domain build && pnpm typecheck` -- clean.
- `pnpm lint` -- clean.
- `pnpm --filter ./apps/web test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- pass.
- Not run locally: the migration, `test/provisioning.test.ts`, `test/rls-isolation.test.ts`, e2e (STRICT DATABASE RULE). They fail locally only because 0062 is unapplied; CI is the gate.

**Results (2026-11-20, after the review patches):** typecheck and lint clean; domain 17 files, 886 passed; web 173 files, 6520 passed; DB-free root 2 files, 1979 passed. Every DB row of the matrix is covered by `test/rls-isolation.test.ts`, the Snapshot row by `snapshot.test.ts`; the DB rows run in CI only.

## Review Triage Log

### 2026-11-20 — Review pass
- Layers: blind, edge-case, verification-gap, epic AC (4 of 4).
- intent_gap 0, bad_spec 0, patch 9 (low/medium), defer 2 (to 18.5, in `deferred-work.md`), the rest rejected.
- Patched: the shape-2 snapshot discard and `DEVICE_SNAPSHOT_SHAPE = 3` pinned; `loansOf`'s three-way sort; refusal cases for non-text ids, teams and dates; the swap case on a date the home team works; the replacement case asserting A's and C's rosters; a viewer-lent case; the policy comment ("any later version"); claim-pin cases for `calendar_team_loans()` (other tenant, none, blank).
- Deferred to 18.5: a teamless lent member reads as unscheduled on *Danas* and in leave costing; `team_loans` events show as record `other` in the history.
- Rejected: a team created between the select and the loans rpc refusing the read (the same strictness as roster overrides); an rpc row cap (shared by every calendar rpc); lending an inactive member (the domain puts them on no roster); member deletion order (as `leave_records`, and the e2e cleanups delete loans first); a `team_id` index and a date window (pilot scale, unwindowed snapshot by design); outbox cleanup by loan subject (prepared for 18.3); the RESOLVED prefix format (the house rule's).
- The epic AC auditor found no unlisted deviation.

### 2026-11-20 — Second review pass (security focus, unattended)
- Layers: blind, edge-case, verification-gap, acceptance + epic AC (5 of 5; artifact renderer not applicable, no generated file). Focus: 0062's RLS, grants, definer read, exclusion, audit triggers; the snapshot and shape bump; the e2e cleanup order; the unrun DB tests' codes and messages.
- intent_gap 0, bad_spec 0, patch 3, defer 1, the rest rejected.
- Patched: (1) **the unrun `rls-isolation` test expected 22008 for an `infinity`/`-infinity` bound; 0062 answers 23514.** Postgres keeps an infinite date bound as it is when canonicalizing; 0028's 22008 came from its 366-day check (`upper - lower` of an infinite date, checked first by name order), which `team_loans` lacks. The test now expects 23514 and that the message names `team_loans_during_in_years`; 0062's header and in-years comments are corrected (CI would have failed on every fixture). (2) `snapshot.test.ts`'s bad-loans case asserted the `'loan'` log once after the loop; it now asserts that each case alone logs exactly `'loan'`. (3) The scaffold's "15 attributed tables" message says it counts the tables 0061 backfilled.
- Verified sound: `calendar_team_loans()` is 0019's definer shape (`search_path = ''`, claim pin with `nullif`, `current_member_access()` active check, `removed_at is null`, five columns, execute revoked from public/anon/service_role); both policies pin claim and fresh helper as an active admin; column-level insert grant of the five facts, no update/delete, TRUNCATE revoked from every session role; the home-team conjunct (traced for every case in the test, including a version starting inside the range and a later teamless version); the exclusion (as 0028; member ids are global uuids); the audit triggers (0061's exact shape; `audit_events` is admin-only); the composite keys refuse another tenant's member or team with 23503; the e2e helpers delete loans and their outbox rows before members and teams in the same transaction; every other expected code, constraint name and provisioning pin.
- Deferred to 18.4 (appended to its `deferred-work.md` entry): whether `team_loans` takes 0023's organization lock and 0035's stale-admin refusal (an admin demoted mid-insert can still commit a loan, as for leave records); 18.2's spec allowed no trigger but the audit pair.
- Rejected: the member-wide read (the recorded AC 2 reinterpretation, still for the founder to confirm); a loan team archived later breaking the snapshot (`teamIds` includes archived teams); the exclusion without `organization_id` (as 0028); deploy order of web before migration (the same for every rpc the calendar has added); the shape bump costing the offline blob (required by the spec, documented in `persistence.ts`); the RESOLVED prefix keeping the old text (house rule); 18.1 `done` (#323 is merged); spec `status: done` beside sprint `review` (the build workflow's convention, explained in Auto Run Result); spine count errata and CAP-27 (the spine's capability table stops at CAP-24); no direct loan test for collisions, staffing and hours (they spread `snapshotScheduleInputOf`, which passes `members` whole); an extra trigger-count pin (the AUDITED loop counts both); an unused `afterEach` restore (harmless); comment wording on the index and "one `not exists`".
- Results after the patches: typecheck and lint clean; domain 17 files, 886 passed; web 173 files, 6520 passed; DB-free root 2 files, 1979 passed. The DB tests and e2e remain unrun locally (CI).

## Auto Run Result

Status: done (built; sprint status `review`, CI pending).

**Residual risks:**
- `test/provisioning.test.ts`, `test/rls-isolation.test.ts` and e2e have never run against 0062; their expected codes and constraint texts were reasoned, so CI may need small fixes.
- A team archived concurrently with a loan insert can slip past the policy; archiving a team with live loans is not refused (18.4).
- Members read every live loan of their organization (no reason, no author): the recorded AC 2 reinterpretation, for the founder to confirm.
