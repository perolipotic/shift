---
title: 'Sati: the export reads as the screen, and leave is counted in days'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: '00d0493eb6507e7dbb9d6e465d1dfa4dfbc11857'
review_loop_iteration: 2
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The `.xlsx` shows hours as `192:00` and `12:30`, while the screen shows `192 h` and `12 h 30 min`. The leave figure on Sati counts leave *hours*, and only for the shifts that a conflict decision moved to leave. An admin closing the month wants leave *days*, the same count Godišnji and Danas charge ("3 dana godišnjeg").

**Approach:**
- Each export hours cell stays a spreadsheet duration. Its number format is chosen per cell by the screen's own rule. Excel shows it as the screen does; Numbers shows its own duration format, and that is accepted.
- Leave is shown **in days only**, everywhere. A leave day is a charged day of the member in the month (R4.2: active, with a working shift, inside a leave record), and a new domain function returns them.
- A shift that a conflict decision moves to leave still drops out of the bands, the total and the shift count. It appears only as its leave day, never as hours.

Human decisions, 2026-10-10:
- Days are counted as Godišnji counts them.
- The table, the export and the conflict consequence strip all show days ("one takes a day of leave; there is no 12 h").

## Boundaries & Constraints

**Always:**
- The days and their dates come from the domain (AD-3/AD-7, Q7). They are derived from the records and schedule input the surface already reads (AD-13), with no new read.
- A month's days are the record dates inside the month that `isLeaveDay` charges while the member is active. Summed over the months, they equal `leaveCostOf` over the record.
- Each record is clipped to the month before it is checked, so a bad record outside the month cannot make the month fail.
- On screen, the leave figure reads `3 dana`, or `—` at 0. Sort and footer use days.
- The export has one leave column of days, written as a `count`.
- The conflict consequence strip states the leave term in days (`1 dan godišnjeg`) where it said `{hours} kao godišnji`. `{hours} rada` (the amend case) stays.
- Export hours formats follow the same rule as `durationMessageKey`: whole hours `[h] "h"`, under one hour `[m] "min"`, otherwise `[h] "h" m "min"`.
- The leave records are a required argument wherever a leave figure or its ⓘ is derived. No default may silently yield 0.
- The leave ⓘ's total is the domain's figure, and its lines sum to it.

**Ask First:** Any change to the Danas tiles, Godišnji or the leave overview.

**Never:**
- No schema or RLS change.
- Don't compute days in a component or in the export.
- Don't write a figure as text.
- Don't change how `leaveMinutes` is derived. It is shown nowhere.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Whole hours | 11 520 min | screen `192 h`; cell 8.0, `[h] "h"` | N/A |
| Hours and minutes | 750 min | `12 h 30 min`; cell `[h] "h" m "min"` | N/A |
| Under an hour | 30 min | `30 min`; cell `[m] "min"` | N/A |
| Leave over a month edge | record 29.09–03.10, working 30.09, 01.10, 03.10 | Sep `1 dan`, Oct `2 dana`; sum = `leaveCostOf` | N/A |
| Free dates only | no working shift in range | `—`; export cell empty | N/A |
| Unresolved conflict | shift on a leave date, unresolved | hours stay in total, with ⚠; the date counts 1 day | N/A |
| Accepted uncovered | that conflict accepted | shift leaves the total and the bands; leave `1 dan`; strip `1 dan godišnjeg` | N/A |
| Inactive on a leave date | status inactive | not counted | N/A |
| Bad record in another month | malformed record dated outside the month | the month renders | N/A |
| Leave ⓘ | 3 dates, one unresolved | one line per date: date, `team · type` per shift, `+1 dan`, ⚠ on the unresolved; `= 3 dana` | N/A |

## Epic AC Deviations

- **4.2 "leave hours are reported in their own column"**: REINTERPRETED. The column reports leave days, charged as Godišnji counts them. Human decision, 2026-10-10.
- **4.3 "next to … Total and Leave Hours"** and **"the leave-hours column … fills with no change to the export"**: REINTERPRETED. The column holds days as a number, under a heading that names days.
- **7.14 "the equation comes from `domain/hours` … sums exactly to the figure"** (for the leave): REINTERPRETED. The leave ⓘ lists charged dates from `domain/leave` as `+1 dan` lines.
- **CAP-14 / FR-42 / FR-42a / FR-42b "Leave Hours"**: REINTERPRETED as above, and the docs are updated to match.
- **5.4 / CAP-16 "the absent member's hours land as leave hours"** and the **UX-DR11 hours term**: REINTERPRETED. The decided shift drops out of the worked hours and lands as its leave day. The strip states it as `1 dan godišnjeg`. Human decision, 2026-10-10.

</frozen-after-approval>

## Code Map

- `packages/domain/src/leave.ts`
  - Existing: `isLeaveDay` :115, the internal `costCounter` / `intersect`, and `leaveCostOf` :206.
  - Add `leaveDaysOfMonth(input, records, month): readonly string[]`, which returns sorted dates.
  - Export it from `index.ts`, in the leave block (:80–93).
- `apps/web/src/features/hours/services/hours-conflicts.ts`
  - `hoursCollisionsOf` :95 parses the records. The READY state (:76–85) keeps only `collisions` and `leaveKeys`.
  - Keep the records by member, taken from that one parse.
- `.../hours/services/my-hours.ts`: `SORT_LEAVE` :97, `memberHoursInputOf` :220, `leaveIsEmpty` :254, `leaveFigureOf` :259, `leaveShownOf` :275, `myHoursViewOf` :344.
- `.../hours/services/organization-hours.ts`: the row's `leave` :100, the rows :196–237, the sort :268, the footer :511–517.
- `.../hours/services/hours-explanation.ts`: `hoursExplanationOf`, and `figureNameOf` :151.
- `.../hours/hooks/use-hours.ts` :212–221: the ⓘ wiring.
- `.../hours/services/hours-export.ts`: `HoursExportCell`, `cellsOf` :107, and `hoursExportOf` (the headings).
- `.../hours/services/xlsx.ts`: `HOURS_CELL_FORMAT` :20 and `cellOf` :48. The writer, `write-excel-file/browser`, takes a `format` per cell.
- `.../hour-bands/services/list.ts`: `durationMessageKey` :263 holds the screen's rule.
- Components:
  - `hours-summary.tsx`
  - `organization-hours-table.tsx`
  - `organization-hours-rows.tsx`
  - `hours-explanation.tsx`
- Consequence strip:
  - `features/conflicts/services/resolution-screen.ts` :586 (`leaveHours`)
  - `components/resolution-option.tsx` :152–198
  - `hr.json` :510 (`hoursAsLeave`)
- `hr.json`: `sati.leave` :546, `sati.organization.leave` :583, `count.days` :55.
- e2e: `hours.page.ts`, `e2e/utils/rotation.ts`, `e2e/utils/xlsx.ts`, the hours spec and the conflict-resolution spec.
- Untouched: `today-tiles.ts`, and `leaveHoursKeysOf` in `resolutions.ts` :362.

## Tasks & Acceptance

**Execution:**
- [x] Domain: `leave.ts`, `index.ts` and `test/leave.test.ts`.
  - Add `leaveDaysOfMonth`.
  - Test the month edge, inactive dates, free dates, that the month sum equals `leaveCostOf`, and a bad record outside the month.
- [x] `hours-conflicts.ts`, `my-hours.ts` and `organization-hours.ts`, with their tests.
  - Make the records a required argument.
  - Build the days figure, and sort and total it.
  - Test several members' records on the admin path.
- [x] `hours-explanation.ts`, `use-hours.ts` and `hours-explanation.tsx`, with their tests.
  - Draw dated lines, with team · type paired per shift.
  - Mark ⚠ by collision key.
  - Take the total from the domain.
  - When the records are `null`, show the unavailable state.
- [x] The table, the phone rows and *Moji sati*: render the days figure. The ⓘ shows only when the figure is above 0.
- [x] `hours-export.ts` and `xlsx.ts`, with their tests: one format per hours cell, and one leave-days column with an i18n heading.
- [x] The consequence strip, with its tests and e2e: the leave term in days.
- [x] `hr.json`, `pages/prijava.test.ts` and `test/resource-hygiene.test.ts`: the keys and the sweeps.
- [x] e2e:
  - Update the `[h]:mm` expectations.
  - Read a recorded leave back as days, on screen and in the file. Derive the expected count from the seeded schedule.
  - Open the leave ⓘ.
- [x] Docs:
  - `EXPERIENCE.md`
  - `prd.md`: FR-40 and FR-42, 42a, 42b, and the existing "Leave Day" term, tightened rather than given a synonym.
  - `epics.md`: CAP-14, CAP-16, UX-DR11, UX-DR17, and the Epic 4 summaries.

**Acceptance Criteria:**
- Given an admin's Sati with a recorded leave, when the month is exported, then Excel shows every hours cell as the screen does, a column still sums natively, and the leave cell equals the row's days.
- Given a member, when *Moji sati*, Godišnji and the record's cost are compared across the months of one leave, then the days agree.
- Given an accepted-uncovered conflict, when the resolution screen and Sati render, then neither shows any leave hours, and both show the day.

## Spec Change Log

- **Loop 1 (2026-10-10), intent_gap.**
  - **Finding:** leave hours from decided conflicts showed nowhere, against CAP-16.
  - **Decision:** days and hours together (A).
  - **Patch findings folded in:** the records argument made required, the ⓘ total taken from the domain, records clipped before they are checked, team · type paired per shift, the unavailable ⓘ, docs drift fixed, and test gaps filled.
- **Loop 2 (2026-10-10), intent_gap.**
  - **Finding:** the human checked a real export. Excel shows the hours formats as the screen does, and Numbers' own display is accepted. The human rejected leave hours: "one takes a day of leave, there is no 12 h".
  - **Decision:** leave in days only, everywhere, the consequence strip included (B). The frozen block is amended to match.
  - **KEEP** from the second implementation:
    - `leaveDaysOfMonth`, through the shared collector that also backs `costCounter`.
    - Records taken from the one parse.
    - The required records argument.
    - `null` records giving the unavailable ⓘ.
    - Records clipped before they are checked.
    - Team · type paired per shift.
    - ⚠ by collision key.
    - The per-cell format chosen from `durationMessageKey`.
    - `chargedLeaveDays` in `e2e/utils/rotation.ts`, and the leave ⓘ locators.
    - The docs edits, minus leave hours.
  - **DROP:** `LeaveFigure.minutes`, `sati.leaveFigure`, the `leaveHours` export column, and the `+12 h` leave amounts.
  - **Reference:** start from `/private/tmp/claude-501/-Users-perolipotic-Desktop-hobby-shift/15c6affe-cde0-478f-8a81-0174aa84e7a7/scratchpad/impl-v2.patch`, which is the reverted second implementation.

## Design Notes

- `leaveDaysOfMonth` returns dates, so the ⓘ and the count share one derivation.
- The file heading is `Godišnji odmor (dani)`, because a number format cannot inflect `dan/dana`.

## Verification

**Commands:**
- `pnpm --filter ./apps/web build && pnpm test`: all green.
- `pnpm lint && pnpm typecheck`: clean.
- `pnpm test:e2e e2e/tests/hours e2e/tests/conflicts`: green.

## Suggested Review Order

**Leave days in the domain**

- Entry point: charged dates of one month, clipped per record; outside-month records skipped unchecked.
  [`leave.ts:242`](../../packages/domain/src/leave.ts#L242)

- One collector backs both the month dates and `leaveCostOf`, so Sati and Godišnji cannot drift.
  [`leave.ts:172`](../../packages/domain/src/leave.ts#L172)

**Records threaded through Sati**

- The one parse now also keeps records by member; no new read (AD-13).
  [`hours-conflicts.ts:110`](../../apps/web/src/features/hours/services/hours-conflicts.ts#L110)

- Leave days via the same schedule input Godišnji uses.
  [`my-hours.ts:315`](../../apps/web/src/features/hours/services/my-hours.ts#L315)

- Row carries `leaveDays`; sort and footer use it.
  [`organization-hours.ts:238`](../../apps/web/src/features/hours/services/organization-hours.ts#L238)

- `null` records while the read is not ready → unavailable ⓘ.
  [`use-hours.ts:221`](../../apps/web/src/features/hours/hooks/use-hours.ts#L221)

**Leave ⓘ**

- Dated `+1 dan` lines, team · type per shift, ⚠ or the decision word; total from the domain.
  [`hours-explanation.ts:286`](../../apps/web/src/features/hours/services/hours-explanation.ts#L286)

**Export**

- Per-cell format by the screen's rule; Excel reads `192 h`, `12 h 30 min`.
  [`xlsx.ts:27`](../../apps/web/src/features/hours/services/xlsx.ts#L27)

- One leave-days column as a number, empty at 0.
  [`hours-export.ts:137`](../../apps/web/src/features/hours/services/hours-export.ts#L137)

**Consequence strip in days**

- The absent member's term is the charged day (`1 dan godišnjeg`), counted by the domain.
  [`resolution-screen.ts:594`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L594)

- Neutral label `Odsutni član` over days or `12 h rada`.
  [`resolution-option.tsx:228`](../../apps/web/src/features/conflicts/components/resolution-option.tsx#L228)

**Tests and docs**

- E2E oracle for charged dates from the seeded rotation, with its simplifications stated.
  [`rotation.ts:64`](../../e2e/utils/rotation.ts#L64)

- Domain tests: month edge, inactive, free, bad records in and out of the month.
  [`leave.test.ts:1`](../../packages/domain/test/leave.test.ts#L1)
