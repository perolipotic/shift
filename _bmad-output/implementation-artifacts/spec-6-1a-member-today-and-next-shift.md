---
title: 'A member opens Danas and reads today, the next shift and the week (6.1a)'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '7c037374bc16f131b90420709e282367edb92165'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/danas` shows only a heading and the line "Tvoja smjena ‹tim›". A member who works tonight still has to open Kalendar to learn it. Story 6.1 wants today's answer in words, the next shift and the coming week, with nothing tapped.

**Approach:** Danas gets a pure view model, built from the reads Kalendar already makes and through the same derivations:
- the calendar snapshot, under `CALENDAR_KEY`;
- the viewer's own leave, under `MY_LEAVE_RECORDS_KEY`.

It renders three things, in phone priority order: the today card, the next shift, and the next 7 days. The existing team line stays below them. Hours and leave tiles are 6.1b.

## Boundaries & Constraints

**Always:**
- **Today** is `calendarTodayOf(snapshot, now)`, in the organization's timezone. The heading's subline gives the weekday and date (`četvrtak, 01.10.2026`, from the existing helpers).
- **Exactly one today case:**
  - **on leave:** the viewer's own leave covers today, on a working or a non-working day. This case wins over the others. Text: "Danas si na godišnjem odmoru" plus the record's range.
  - **working:** today has a working shift. Text: "Danas radiš", then one row per shift with the type's name, its range and the team.
  - **free:** today has only non-working types, or no shift. Text: "Danas ne radiš", plus the non-working type's name and the team, or "Bez smjene".
  - **unscheduled:** the viewer has no membership at all. This also applies to an admin.
- **Next shift** is the first date after today that has a working shift not covered by own leave. It shows the weekday and date, the type, and the range (or the name alone when the type has no times). It is headed "Sljedeća smjena · za N dana", or "Vraćaš se · za N dana" in the leave case, using the `count.days` plural. The search ends at 366 days, and finding nothing gives a sentence, never an empty area.
- **Next 7 days** are today+1 through today+7, spanning a month boundary. Each day is built by `calendarDayListOf`, with marks that carry only own leave. A leave day says "Godišnji" in words and with a glyph. The list links to `/kalendar`.
- **Working shifts** are decided by `workingShiftTypeIdsOf`. Projection comes only from `memberScheduleOfMonth` and `memberScheduleInputOf`, never re-implemented.
- **Loading** shows a skeleton laid out like the final cards. A failed read shows an alert with a retry and no figures. A refused row or a `RangeError` shows the unavailable state, which is logged.
- **Copy** comes only from `hr.json`, registered in the hygiene and string tests. There is no `count === 1` check. Times are `tabular-nums`. Nothing overflows sideways at 390 px. The page stays keyboard-reachable, and the cards carry headings that screen readers announce.
- **Admin:** an admin who belongs to a team sees the same screen. 6.3 replaces the admin's view.

**Ask First:**
- Any migration or RLS change.
- A new composite read or query key in place of the reused ones.
- Changing the Kalendar or Godišnji screens.

**Never:**
- No duty-block or grouping of consecutive shifts (6.2).
- No hours or leave tiles, and no leave-cost sentence (6.1b).
- No admin conflict card or coverage (6.3).
- No day-progress strip or "ends at" sentence.
- No change to `packages/domain`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Works tonight | Noć 19:00–07:00 today | "Danas radiš", "Noć 19:00–07:00", team | N/A |
| Free | Slobodno today, Dan in 2 days | "Danas ne radiš" "Slobodno"; next "za 2 dana" | N/A |
| Two shifts today | own Noć + Dan via roster override | "Danas radiš", two rows (own team first) | N/A |
| On leave | leave 28.09.–04.10., today 01.10. | leave case with the range; next = 05.10. "Vraćaš se · za 4 dana" | N/A |
| Future leave on a working day | next working shift date is on leave | that date is skipped | N/A |
| No team today | inactive or between teams | "Danas ne radiš" "Bez smjene" | N/A |
| No membership ever | no versions | unscheduled sentence, no next-shift card or week list | N/A |
| No working shift in 366 days | — | next-shift sentence instead of a date | N/A |
| Week crosses a month | today 28.10. | 29.10.–04.11. from two months | N/A |
| Read fails | calendar or own-leave read fails | alert + retry, no cases | retry refetches |

## Epic AC Deviations

- **"on a 24 h duty (as one duty, per 6.2)"** — DEFERRED. 6.1a lists each of today's shifts separately. 6.2 builds the duty-block. The human decided this on 2026-10-06.
- **"its band hours and total for the period, their leave used and remaining"** — DEFERRED to 6.1b. The human split 6.1 on 2026-10-06.
- **"the priority order today's shift, next shift, calendar, hours, leave"** — NARROWED. 6.1a orders today, next and the 7 days; 6.1b appends hours and leave.
- **"every figure … equal, because both derive from the same snapshot (Q19, AD-13)"** — REINTERPRETED. Danas reuses Kalendar's query options, keys and derivations, so there is one cache entry per key and one derivation per figure, not one composite read. The human decided this on 2026-10-06.
- **Dates `01.10.2026.` (epic context)** — REINTERPRETED to the existing `formatIsoDate` form `01.10.2026`, with no trailing dot. The human decided this on 2026-10-06.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/danas.tsx` -- the screen today: `OWN_TEAM_KEY` and `readOwnTeamToday` give the team line. Keep the line, and put the new cards above it.
- `apps/web/src/features/calendar/hooks/use-calendar-screen.ts:58,123` -- how a member's view wires `calendarQueryOptions` and `myLeaveRecordsQueryOptions` (with `MyLeaveRecordsRpc`). `my_leave_records()` (migration 0030) also answers an admin's own row.
- `apps/web/src/features/calendar/services/snapshot.ts:108,264,947` -- `CALENDAR_KEY`, `CalendarSnapshot`, `calendarQueryOptions`.
- `apps/web/src/features/calendar/utils/month.ts` -- the helpers to reuse:
  - `calendarTodayOf` :493
  - `CalendarMarks`/`NO_MARKS` :556
  - `typeRangeOn` :932
  - `dayMonthOf`/`weekdayOf` :939
  - `memberScheduleInputOf` :955
  - `calendarDayListOf` :986. It returns `null` for a month with no shift, so handle that.
  - `workingShiftTypeIdsOf` :155
- `apps/web/src/features/calendar/services/marks.ts:78` -- `calendarMarksOf`, the member branch: own leave goes through `leaveRecordsOf`. Danas builds the member-shaped marks for any role (own leave only, no collisions).
- `packages/domain/src/schedule.ts:239,277` -- `MemberShift`, `MemberScheduleDay`, `memberScheduleOfMonth` (one month per call), and `monthOf`/`adjacentMonth` :103-132.
- `apps/web/src/lib/i18n/format.ts:227,272,317,413` -- `organizationIsoDate`, `nextIsoDate`, `formatIsoDate`, `formatIsoWeekdayName`.
- `apps/web/src/features/calendar/components/calendar-day-list.tsx`, `calendar-cell.tsx`, `modifier-glyphs.tsx` -- day-row and leave-glyph rendering to reuse, or to mirror, for the 7-day list.
- `apps/web/src/components/ui/card.tsx`, `notice.tsx`, `page-header.tsx`; skeleton precedent in `features/hours/components/hours-skeleton.tsx`.
- `eslint.config.js:111` `FEATURE_PUBLIC` -- a new `features/today` module imports `calendar` and `leave` modules that are already public. Update their consumer comments, and expose `today` modules to `pages`.
- `apps/web/src/pages/prijava.test.ts:279,553,704,2148,5601-5680` -- these pin `danas.tsx` hard (controls, literals, one `useQuery`, `OWN_TEAM_KEY`). Re-derive them for the new screen; do not delete the team-line assertions.
- `apps/web/src/lib/i18n/locales/hr.json` (`count.days` :24, `kalendar.day.noTeam`) and `test/resource-hygiene.test.ts` -- the new `danas.*` keys.
- e2e: `e2e/tests/hours/hours.spec.ts:46-71` (`seedTeamRotation`/`holdRotation` lifecycle), `e2e/utils/dates.ts`, `e2e/pages/`. There is no Danas page object yet.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/today/services/today.ts` (+test) -- the pure view model:
  - `(snapshot, ownLeaveRows, now)` → loading, unavailable, unscheduled or ready, with the today case, the next shift and 7 days;
  - every matrix row covered.
- [x] `apps/web/src/features/today/hooks/use-today.ts`, `components/` (today card, next-shift card, week list, skeleton) -- wiring the two reused query options and rendering.
- [x] `apps/web/src/pages/danas.tsx` -- compose the cards above the kept team line, plus the date subline.
- [x] `eslint.config.js`, `hr.json`, `test/resource-hygiene.test.ts`, `pages/prijava.test.ts` -- registrations and the re-derived pins.
- [x] `e2e/pages/today.page.ts`, `e2e/tests/today/today.spec.ts` -- with a seeded rotation:
  - the free and working cases name the seeded type and range;
  - the next shift's date equals the seeded rotation's;
  - the 7 days equal Kalendar's for the same dates;
  - a leave record today gives the leave case and the return;
  - 390 px has no horizontal scroll.

**Acceptance Criteria:**
- Given a member, when Danas opens, then exactly one of the four cases is stated in words before any interaction, and the page shows no spinner while loading.
- Given the same member and dates, when Danas's 7 days are compared to Kalendar's *Moj raspored*, then every type name, range and leave mark is equal.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green
- `pnpm exec playwright test e2e/tests/today e2e/tests/auth e2e/tests/layout` -- expected: all pass

## Suggested Review Order

**The view model (pure)**

- Entry point: two reused reads become loading, unavailable, unscheduled or ready, never a guess.
  [`today.ts:163`](../../apps/web/src/features/today/services/today.ts#L163)

- One derivation; a RangeError alone is unavailable, anything else is rethrown.
  [`today.ts:180`](../../apps/web/src/features/today/services/today.ts#L180)

- Exactly one case: leave wins, then working, then free.
  [`today.ts:344`](../../apps/web/src/features/today/services/today.ts#L344)

- Back-to-back leave records read as one absence.
  [`today.ts:240`](../../apps/web/src/features/today/services/today.ts#L240)

- The next shift skips own leave and stops at 366 days.
  [`today.ts:375`](../../apps/web/src/features/today/services/today.ts#L375)

- Days come from Kalendar's own day list, one month at a time, with own-leave marks only.
  [`today.ts:293`](../../apps/web/src/features/today/services/today.ts#L293)

**Wiring and rendering**

- Kalendar's query options and keys reused; today re-derives when the organization's date turns.
  [`use-today.ts:56`](../../apps/web/src/features/today/hooks/use-today.ts#L56)

- Danas composes the cards above the kept team line.
  [`danas.tsx:103`](../../apps/web/src/pages/danas.tsx#L103)

- Loading, unavailable with or without a retry, unscheduled and ready.
  [`today-body.tsx:27`](../../apps/web/src/features/today/components/today-body.tsx#L27)

- The week reuses CalendarCellBox; leave is said in words once.
  [`week-list.tsx:64`](../../apps/web/src/features/today/components/week-list.tsx#L64)

- The today card, one row per shift.
  [`today-card.tsx:44`](../../apps/web/src/features/today/components/today-card.tsx#L44)

**Peripherals**

- The unit suite covers every matrix row.
  [`today.test.ts:1`](../../apps/web/src/features/today/services/today.test.ts#L1)

- E2E: free and working cases, failed-read retry for both reads, leave and return, 390 px.
  [`today.spec.ts:135`](../../e2e/tests/today/today.spec.ts#L135)

- Danas pins re-derived for a file set; the team-line assertions kept on the page.
  [`prijava.test.ts:281`](../../apps/web/src/pages/prijava.test.ts#L281)

- New copy.
  [`hr.json:27`](../../apps/web/src/lib/i18n/locales/hr.json#L27)
