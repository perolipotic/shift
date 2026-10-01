---
title: 'An admin opens Raspored and sees every unresolved conflict, upcoming soonest first and past ones still listed (5.3b)'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: 'b0c60df6340d8ae856dbf274512f90d496f068a3'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 5.3a derives every collision, but no screen shows one. `/raspored` is still a placeholder, so an admin cannot see what leave has left uncovered (CAP-16, R6.8, UX-DR20, UX-DR25).

**Approach:** Turn `/raspored` into the conflicts queue. It derives from the calendar snapshot plus a new org-wide leave read, through `collisionsOf`. It stores nothing. Since no resolution exists before 5.4, every collision counts as unresolved.

## Boundaries & Constraints

**Always:**
- **Source.** `CALENDAR_KEY` (`calendarQueryOptions`) plus a new `ORGANIZATION_LEAVE_RECORDS_KEY`, which reads every live record of the organization (`removed_at is null`, `LEAVE_RECORDS_COLUMNS`). The input is built with the same in-force recipe as `memberScheduleInputOf`, org-wide. The read validates each row like `leaveRecordsOf` does, except that a row's member must be among the snapshot's members.
- **Order (human, 2026-10-01).** Upcoming conflicts come first, where `date >= calendarTodayOf`, soonest first. Past conflicts follow, most recent first. Within one date, keep `collisionsOf`'s order.
- **Row.** Each row shows the date, the team name, the shift type name with its times, the member name, and the causing record's range (`from–to`). A past row is distinguished by more than colour: a dashed border, reduced emphasis, and the words `Prošli datum`.
- **Count.** A header count is always shown through a new plural key, `{n} neriješen(a/ih) konflikt(a/ata)`, including `0 neriješenih konflikata`. With no conflicts the page says `Nema konflikata između godišnjih odmora i rasporeda.`.
- **States.** Loading shows a skeleton, never a spinner. A `RangeError` from the derivation refuses the whole list and logs it, as `organizationHoursOf` does. It never shows a partial list. Admin only, through the existing `beforeLoad` guard.
- **Invalidation.** Leave insert, amend and remove also invalidate `ORGANIZATION_LEAVE_RECORDS_KEY` (`LEAVE_WRITE_DEPENDENTS`). Schedule writes already refresh `CALENDAR_KEY`.
- All strings go through `t()` in `hr.json`. No `destructive` styling on the queue, because the ring belongs to 5.3c's calendar cells.

**Ask First:**
- Any migration or policy change. 0028 already lets an admin select the organization's records.
- Any change to `packages/domain`.

**Never:**
- No `Riješi` button, no link to a resolution screen, no resolution state and no bulk action. Those are 5.4's.
- No calendar marks and no hours-surface change. Those are 5.3c and 5.3d.
- No stored or cached conflict set.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Worked example | leave 10.09–14.09 over `Dan, Noć, Slobodno, Slobodno, Dan`, today 01.09 | 3 rows, 10.09 first; header `3 neriješena konflikta` | N/A |
| Mixed past | conflicts on 04.09 and 02.09 and on 12.09 and 13.09, today 10.09 | 12.09, 13.09, then 04.09 (past), then 02.09 (past) | N/A |
| Today | a conflict dated today | upcoming, not past | N/A |
| Two teams, one date | an override puts a member on a second team | 2 rows | N/A |
| Removed leave | the record is soft-removed | its rows disappear after the write refreshes | N/A |
| None | no live leave, or leave only over non-working dates | `0 neriješenih konflikata` plus the empty sentence | N/A |
| Corrupt data | an unknown member, overlapping rows, or a bad range | no list | logged; the surface is refused |

## Epic AC Deviations

- **Met here:** "it appears in a queue ordered soonest first", read as upcoming soonest first, then past most recent first (human, 2026-10-01).
- **Met here:** "a conflict on a date that has already passed and was never resolved … is still there, visually distinguished from upcoming ones" (UX-DR25).
- **Met here:** "an organization with no conflicts … states what is true, and a zero count is still shown" (UX-DR20).
- **NARROWED:** "unresolved" means every derived collision, because resolutions arrive in 5.4. 5.4 filters by `collisionKeyOf`; ledger: the "Story 5.4 … collisionKeyOf" entry.
- **Still DEFERRED to 5.3c:** the calendar `⚠` and ring, as before.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/raspored.tsx` -- `RasporedScreen` (L37–47) is the placeholder. `rasporedRoute` (L49–68) holds the admin guard; keep it.
- `apps/web/src/features/calendar/services/snapshot.ts` -- `CALENDAR_KEY` (L108), `calendarQueryOptions` (L947), `calendarSurfaceStateOf` (L992). `CalendarSnapshot` (L264–315) provides teams, types and members for names.
- `apps/web/src/features/calendar/utils/month.ts` -- `memberScheduleInputOf` (L787–803) is the in-force recipe; reuse its parts, don't copy them. Also `calendarTodayOf` (L483) and `workingShiftTypeIdsOf` (L145).
- `apps/web/src/features/hours/services/organization-hours.ts` -- the pattern for rows, view and the guard: `organizationHoursRowsOf` (L169), `organizationHoursOf` (L426, catches `RangeError`), `hoursSurfaceOf` (L458). `features/hours/hooks/use-hours.ts` L47 shows how two queries feed one view.
- `apps/web/src/features/leave/services/leave-list.ts` -- `LEAVE_RECORDS_COLUMNS` (L38), `leaveRecordsOf` (L88) for validation, `readLeaveRecords` (L125), `leaveRecordsQueryOptions` (L170). Add the org-wide reader beside them.
- `apps/web/src/features/leave/services/leave-section.ts` -- `leaveRangeValuesOf` (L148) is the `from–to` label.
- `apps/web/src/features/teams/services/dependents.ts` -- `LEAVE_WRITE_DEPENDENTS` (L85). Its comment (L78–84) already says the queue joins here.
- `packages/domain/src/collisions.ts` -- `CollisionInput` (L58), `Collision` (L69), `collisionsOf` (L157). Read-only.
- `apps/web/src/lib/i18n/locales/hr.json` -- `count.conflicts` (L25) has no "neriješen" form, so add a new key. Also `lib/i18n/format.ts`: `formatIsoDate` (L293) and `RANGE_DASH`.
- UI: `components/ui/page-header.tsx`, `badge.tsx` and `features/hours/components/hours-skeleton.tsx` (the skeleton pattern). The mockup is `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/mockups/conflict-resolution-1.html` L69–87 and L128–134.
- Tests: vitest is node-only, so there are no render tests (`apps/web/vitest.config.ts`). Precedents are `organization-hours.test.ts`, `leave-list.test.ts`, the `hours-screen.fixture.ts` parts that `pages/prijava.test.ts` scans, and `router.test.ts`. For e2e, see `e2e/tests/hours/hours.spec.ts` and `e2e/tests/people/leave.spec.ts`. Page objects are in `e2e/pages/`. Seed helpers in `e2e/utils/database-helper.ts`: `seedLeaveMember` (L246), `seedLeaveRecord` (L313), `seedRosterOverride` (L824). Strings come from `e2e/utils/i18n.ts` `plural`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/leave/services/leave-list.ts` -- add `ORGANIZATION_LEAVE_RECORDS_KEY`, the org-wide reader and validator, and its query options -- the queue's leave source.
- [x] `apps/web/src/features/teams/services/dependents.ts` -- add the key to `LEAVE_WRITE_DEPENDENTS` -- so leave writes refresh the queue.
- [x] `apps/web/src/features/conflicts/services/conflicts-queue.ts` (new) -- build the input from the snapshot and records, call `collisionsOf`, split rows into upcoming and past per the order rule, and wrap it in a refusing guard -- the one view model.
- [x] `apps/web/src/features/conflicts/hooks/use-conflicts-queue.ts` and `components/` (new) -- the two queries, the header count, the list, the empty state and the skeleton.
- [x] `apps/web/src/pages/raspored.tsx` -- render the queue -- replaces the placeholder.
- [x] `apps/web/src/lib/i18n/locales/hr.json` -- the count, empty, past and label keys.
- [x] `apps/web/src/features/conflicts/conflicts-screen.fixture.ts` and the `pages/prijava.test.ts` registration -- source scans for `t()`-only strings and key coverage.
- [x] `apps/web/src/features/conflicts/services/conflicts-queue.test.ts` and `leave-list.test.ts` -- cover every matrix row except Removed leave.
- [x] `e2e/tests/conflicts/conflicts-queue.spec.ts` and `e2e/pages/conflicts.page.ts` -- the worked example and order with one past row, the zero state, removal clearing the rows, and a member redirected away.

**Acceptance Criteria:**
- Given an admin recorded leave on the member's page, when they open `/raspored`, then the new conflicts are listed without a reload.
- Given the queue is open, when any figure is read, then nothing was written to the database to produce it.

## Spec Change Log

- **2026-10-01, review (human-approved edits to the frozen block, not a loopback).** (1) Spelling: the review found `nerješen…`; the human chose the standard `neriješen / neriješena / neriješenih`, fixed here, in `epics.md` UX-DR20, `EXPERIENCE.md`, the mockups and `epic-5-context.md`. (2) `## Epic AC Deviations` moved inside the frozen block, as the process requires; its content is unchanged except that the NARROWED line now names the ledger entry, which the review found missing and which was added. (3) The human accepted `Nema` in the empty sentence; it moves from the build-wide ban to an `hr.json`-only count in `test/localization-applied.test.ts`. KEEP: the order rule, the two-read source and the refusing guard.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm test` -- expected: all green
- `pnpm test:e2e -- conflicts` -- expected: the new spec is green (with the local stack running)

## Suggested Review Order

**The view model**

- Entry point: two reads in, one outcome out; failure first, then loading, then ready.
  [`conflicts-queue.ts:229`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L229)

- The human's order rule: upcoming soonest first, then past most recent first, both sorted explicitly.
  [`conflicts-queue.ts:93`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L93)

- The collision input: the in-force schedule recipe plus every live record, nothing stored.
  [`conflicts-queue.ts:107`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L107)

- A `RangeError` refuses the whole list rather than showing part of it.
  [`conflicts-queue.ts:193`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L193)

**The org-wide leave read**

- Paged under `max_rows`, with `count: 'exact'`; a count mismatch is unavailable, never a partial list.
  [`leave-list.ts:389`](../../apps/web/src/features/leave/services/leave-list.ts#L389)

- The new key, refreshed by every leave write.
  [`leave-list.ts:354`](../../apps/web/src/features/leave/services/leave-list.ts#L354)
  [`dependents.ts:87`](../../apps/web/src/features/teams/services/dependents.ts#L87)

**The screen**

- Placeholder replaced; the admin guard is unchanged.
  [`raspored.tsx:35`](../../apps/web/src/pages/raspored.tsx#L35)

- The count is always shown; a past row is marked by a dashed border, muted text and `Prošli datum`.
  [`conflicts-list.tsx:48`](../../apps/web/src/features/conflicts/components/conflicts-list.tsx#L48)
  [`conflicts-list.tsx:19`](../../apps/web/src/features/conflicts/components/conflicts-list.tsx#L19)

- Skeleton, alert with retry, or the list.
  [`conflicts-body.tsx:20`](../../apps/web/src/features/conflicts/components/conflicts-body.tsx#L20)

- Strings, including the corrected `neriješen` plural.
  [`hr.json:156`](../../apps/web/src/lib/i18n/locales/hr.json#L156)

**Tests and config**

- Order, time zone, shift-type overrides and refusal, with expectations built independently of the input builder.
  [`conflicts-queue.test.ts:202`](../../apps/web/src/features/conflicts/services/conflicts-queue.test.ts#L202)
  [`conflicts-queue.test.ts:322`](../../apps/web/src/features/conflicts/services/conflicts-queue.test.ts#L322)

- e2e: worked example with past rows, no reload, removal clears them; zero state; failure and retry; member redirect.
  [`conflicts-queue.spec.ts:74`](../../e2e/tests/conflicts/conflicts-queue.spec.ts#L74)

- `Nema` moved from the build-wide ban to an `hr.json`-only count (human decision).
  [`localization-applied.test.ts:1485`](../../test/localization-applied.test.ts#L1485)

- `seedTeamRotation` can start in the past, so past conflicts can be seeded.
  [`database-helper.ts:630`](../../e2e/utils/database-helper.ts#L630)
