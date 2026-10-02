---
title: 'A recorded resolution takes its conflict off every unresolved surface (5.4a)'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_commit: '8598ea3eab45c6239eead69e93137c0684371c67'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing can record a decision on a conflict yet. "Unresolved" therefore means every derived collision on the Raspored queue and its count, on the calendar marks, on the *Sati*/*Moji sati* count and in the `.xlsx` (5.3b NARROWED, ledger "Story 5.4 collisionKeyOf filter").

**Approach:** Migration `0031` stores resolutions keyed by `(organization_id, member_id, date, team_id)`, with attribution. One pure domain filter drops each collision that has a live resolution, and every surface reads resolutions and applies that one filter. 5.4b–d (ledgered on 2026-10-02) add the screen and the three outcomes on top.

## Boundaries & Constraints

**Always:**
- **Table `conflict_resolutions`.** Follows the 0028 pattern:
  - `organization_id` first, `id`, and composite FKs to `members (organization_id, id)` and `teams (organization_id, id)`.
  - `date`, and `kind` checked in (`accept_uncovered`, `replace_member`, `amend_leave`). The word "uncovered" alone already means hour-band coverage in the code.
  - `created_by default auth.uid()`, `created_at default now()`, and `removed_by`/`removed_at` set together or not at all.
  - A partial unique index gives one live row per `(organization_id, member_id, date, team_id) where removed_at is null`.
- **Access.**
  - RLS select and insert are for the organization's active admin only, with `WITH CHECK (created_by = auth.uid())` and the claim pinned. Column-grant insert covers `(organization_id, member_id, date, team_id, kind)`. Nothing else is granted, and anon gets nothing.
  - A member reads their own live rows through the definer `my_conflict_resolutions()`. It returns `member_id, date, team_id, kind` with no author columns, in the 0030 shape and with the same four grant lines.
- **Lifetime (human, 2026-10-02).** A resolution lives while a live leave record of that member covers its date. Both changes run in the same transaction as the leave change, and `removed_by` is the acting admin.
  - `remove_leave_record` soft-removes the member's live resolutions dated in the removed range.
  - `amend_leave_record` soft-removes only those dated in the old range but not the new one. Resolutions on dates that stay covered survive with no change.
  - Nothing else removes a resolution: not time, not any other data change.
- **One filter.** `unresolvedCollisionsOf(collisions, resolutions)` in `packages/domain/src/collisions.ts` matches by `collisionKeyOf`, keeps order, and is pure. It has node tests against both fixtures. The queue, the calendar marks and the hours conflict count all derive through it, and the count still equals the queue's row count.
- **Reads.**
  - An admin reads the table under `ORGANIZATION_CONFLICT_RESOLUTIONS_KEY`, and a member reads the definer function under `MY_CONFLICT_RESOLUTIONS_KEY`. Both are role-gated by `enabled` the way the leave reads are.
  - A parser returns `null` on a bad row, an unknown member or team, or a duplicate live key. `null` becomes the existing no-retry refusal. A failed read gives the existing unavailable notice with a retry, and a surface never shows counts derived without resolutions.
  - Leave writes invalidate both keys (`LEAVE_WRITE_DEPENDENTS`), and every retry covers them.

**Ask First:**
- Any change to `domain/hours` or to the hours figures, any UI string, or any second migration.

**Never:**
- No resolution screen, no outcome writes from the SPA, no leave hours, no uncovered mark, and no bulk anything. Those belong to 5.4b–d.
- A resolution is never keyed on `leave_record_id`. No database routine derives collisions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Resolved | 3 collisions, 1 resolved | queue shows 2, count 2; that calendar mark gone; *Sati* row 2, xlsx 2 | N/A |
| Two teams | override puts member on 2 teams that date, one resolved | the other team's collision stays | N/A |
| Amend shrink | resolved 12.09; leave 10–14.09 amended to 10–11.09 | resolution soft-removed | N/A |
| Amend keep | resolved 12.09; leave amended to 12–16.09 | resolution survives; 12.09 stays resolved | N/A |
| Remove then re-add | resolved 12.09, leave removed, new leave over 12.09 | conflict shows unresolved | N/A |
| Member own | member with 1 of 2 own collisions resolved | *Moji sati* count 1; reads no one else's rows | N/A |
| Duplicate live | second insert, same key | refused (23505) | DB |
| Non-admin / forged author / other org | insert | refused (42501) | DB |
| Bad row | unknown team id in answer | refusal, no retry | parser |
| Read fails | network error on resolutions | unavailable notice, retry restores | retry |

## Epic AC Deviations

- **MET:** "recorded against `(organization, member, date, team)` with the acting admin and a timestamp, and the conflict no longer derives as unresolved" (storage and filter; the SPA write is 5.4b–d).
- **MET:** "no conflict expires, auto-clears or is suppressed". **NARROWED:** a resolution ends when its leave stops covering its date (human, 2026-10-02). That is a change to the leave the conflict came from, not unrelated data.
- **MET (vacuously):** no bulk affordance exists.
- **DEFERRED to 5.4b:** three radio cards in fixed order, unranked; the consequence strip; leave hours; the `Notice`; ‹ ›.
- **DEFERRED to 5.4c:** replace-candidate grouping with rank and position.
- **DEFERRED to 5.4d:** the computed amend start date. Each has a `deferred-work.md` entry (2026-10-02).

</frozen-after-approval>

## Code Map

- `packages/domain/src/collisions.ts` -- `Collision` (:69, carries `leaveRecordId`; ignore it), `collisionKeyOf` (:85), `collisionsOf` (:157). Add the filter and a `CollisionResolution` type (`memberId, date, teamId`), and export them from `index.ts`. Tests: `packages/domain/test/collisions.test.ts` `FIXTURES` (:41, `describe.each`). `purity.test.ts` applies.
- `supabase/migrations/0028_leave_records.sql` -- the DDL, policy and grant pattern. `0026_roster_overrides.sql` -- the partial unique live key and composite team FK. `0029_amend_remove_leave_record.sql` -- `remove_leave_record` (:74) and `amend_leave_record` (:121); amend soft-removes and inserts a new row. Re-create both in `0031` with `create or replace`, keeping their bodies and refusals. `0030_my_leave_records.sql` -- the definer read.
- `apps/web/src/features/leave/services/leave-list.ts` -- the read and trust pattern: query options (:354, :438), `rowsOfAnswer` (:297), and the `…Of(rows, ids) | null` parsers (:94, :466).
- `apps/web/src/features/conflicts/services/conflicts-queue.ts` -- `collisionInputOf` (:107), the derive point in `conflictsQueueViewOf` (:153), `conflictsQueueOf` sources and gating (:229). Hook: `hooks/use-conflicts-queue.ts` (queries and retry).
- `apps/web/src/features/calendar/services/marks.ts` -- `calendarMarksOf` (:102 derive), `calendarMarksStateOf` (:112), `readsOrganizationLeave` (:60). Hook: `hooks/use-calendar-screen.ts` (:101–129, retry :200).
- `apps/web/src/features/hours/services/hours-conflicts.ts` -- `hoursCollisionsOf` (:65, member :73, admin :88) and `hoursConflictsStateOf` (:101). This also covers *Moji sati*, the table and the export. Hook: `hooks/use-hours.ts` (:69–97, retry :110 `cancelRefetch:false`).
- `apps/web/src/features/teams/services/dependents.ts:90` `LEAVE_WRITE_DEPENDENTS`, with `dependents.test.ts:212`.
- Registries:
  - `eslint.config.js` `FEATURE_PUBLIC` (~:117), for the new resolutions module that calendar and hours import.
  - `conflicts-screen.fixture.ts` exempt lists.
  - `test/supabase-scaffold.test.ts`: :91 numbering, :306 policy-name list and its title count, :1430 `columnsOf`, plus a static block like :2189–2391.
  - `test/rls-isolation.test.ts`: :1081 policies, :1158 functions, and a new 5.4a block like :17572.
  - `test/provisioning.test.ts`: :781 RLS tables, :1423 privileges, :1698, :1762.
- e2e:
  - `e2e/utils/database-helper.ts`: add `seedConflictResolution` beside `seedLeaveRecord` (:313). `removeFormerMemberInSql` (`run-fixture.ts:197`) must delete the member's resolutions first, because the member FK does not cascade.
  - Specs: `conflicts/conflicts-queue.spec.ts` (:74, :202), `calendar/calendar-conflicts.spec.ts` (:109, :282), `hours/hours.spec.ts` (:623, :738, :302).

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/collisions.ts`, `index.ts`, `test/collisions.test.ts` -- the filter and its type, tested against both fixtures: order kept, a key on another team is not dropped, and a resolution with no collision has no effect.
- [x] `supabase/migrations/0031_conflict_resolutions.sql` -- the table, index, RLS, grants, `my_conflict_resolutions()`, and the lifetime rule inside the re-created leave functions.
- [x] `test/rls-isolation.test.ts`, `supabase-scaffold.test.ts`, `provisioning.test.ts` -- the registries, plus DB cases for every DB row of the matrix and the amend and remove lifetime rows.
- [x] `apps/web/src/features/conflicts/services/resolutions.ts` (+ `.test.ts`) -- the two query options, the parser, and the role-gated answer.
- [x] The queue, marks and hours services and hooks -- thread the resolutions answer into sources, gating and retry, and derive through the filter. Extend each service's tests with the Resolved, Two teams, Bad row and Read fails rows.
- [x] `dependents.ts` (+ test), `eslint.config.js`, the fixtures -- the registries.
- [x] e2e helpers and specs -- an admin with a seeded resolution sees it gone from the queue and its count, the calendar mark and the *Sati* table and `.xlsx`. A member sees their reduced *Moji sati* count. A failed resolutions read shows unavailable, and retry restores it.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the "Story 5.4 collisionKeyOf filter" entry RESOLVED. `sprint-status.yaml` -- add `5-4a`…`5-4d` under 5.4.

**Acceptance Criteria:**
- Given a resolution is inserted in SQL while a surface is open, when its keys are invalidated or the surface is reopened, then every surface agrees on the same unresolved set.
- Given an admin removes or amends leave in-app, when the write lands, then the resolution rows follow the lifetime rule and every surface reflects it without a reload.

## Design Notes

The lifetime rule is DB-side because removal and amend are already atomic definer calls. One live leave record covers a date at most once (exclusion constraint), so "dated in the removed range" is exact. On amend, the dates to drop are the old range minus the new one; the removal and the re-insert happen in one transaction. A resolution never lingers to hide a later conflict from new leave, and an amend never reopens a decision whose date stays on leave.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (local stack up; `pnpm db:reset` only after checking no parallel session needs the stack)
- `pnpm exec playwright test conflicts calendar-conflicts hours` -- expected: green

## Suggested Review Order

**Storage and its lifetime**

- Entry point: one live resolution per collision key, attributed, never cascading.
  [`0031_conflict_resolutions.sql:82`](../../supabase/migrations/0031_conflict_resolutions.sql#L82)
  [`0031_conflict_resolutions.sql:136`](../../supabase/migrations/0031_conflict_resolutions.sql#L136)

- Born on live leave: the trigger locks the covering leave row, so it never races a removal.
  [`0031_conflict_resolutions.sql:195`](../../supabase/migrations/0031_conflict_resolutions.sql#L195)

- Admin-only select and insert; the member's own definer read, without authors.
  [`0031_conflict_resolutions.sql:145`](../../supabase/migrations/0031_conflict_resolutions.sql#L145)
  [`0031_conflict_resolutions.sql:259`](../../supabase/migrations/0031_conflict_resolutions.sql#L259)

- Lifetime rule: remove ends resolutions in the range; amend ends only the dates it uncovers.
  [`0031_conflict_resolutions.sql:341`](../../supabase/migrations/0031_conflict_resolutions.sql#L341)
  [`0031_conflict_resolutions.sql:404`](../../supabase/migrations/0031_conflict_resolutions.sql#L404)

**The one filter**

- Pure domain filter by `collisionKeyOf`; keeps order.
  [`collisions.ts:229`](../../packages/domain/src/collisions.ts#L229)

- The single derivation every unresolved surface uses.
  [`conflicts-queue.ts:156`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L156)

**Reads and surfaces**

- Two reads, paged and counted like leave; a parser that refuses untrusted rows.
  [`resolutions.ts:188`](../../apps/web/src/features/conflicts/services/resolutions.ts#L188)
  [`resolutions.ts:233`](../../apps/web/src/features/conflicts/services/resolutions.ts#L233)

- Queue sources and gating gain the third read.
  [`conflicts-queue.ts:275`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L275)

- Calendar marks: an admin's marks wait for resolutions; a missing answer is retryable unavailable.
  [`marks.ts:73`](../../apps/web/src/features/calendar/services/marks.ts#L73)
  [`marks.ts:123`](../../apps/web/src/features/calendar/services/marks.ts#L123)

- Hours: role-gated, so a member's count drops only by their own resolutions.
  [`hours-conflicts.ts:71`](../../apps/web/src/features/hours/services/hours-conflicts.ts#L71)

- Leave writes now invalidate both resolution keys.
  [`dependents.ts:97`](../../apps/web/src/features/teams/services/dependents.ts#L97)

**Tests**

- DB: access, lifetime, born on leave, and the two-connection race.
  [`rls-isolation.test.ts:17767`](../../test/rls-isolation.test.ts#L17767)
  [`rls-isolation.test.ts:18160`](../../test/rls-isolation.test.ts#L18160)

- e2e: an in-app amend ends one resolution on every surface without a reload.
  [`conflicts-queue.spec.ts:251`](../../e2e/tests/conflicts/conflicts-queue.spec.ts#L251)

- e2e helpers: seeding, and SQL removal that mirrors the lifetime rule.
  [`database-helper.ts:361`](../../e2e/utils/database-helper.ts#L361)
  [`database-helper.ts:411`](../../e2e/utils/database-helper.ts#L411)
