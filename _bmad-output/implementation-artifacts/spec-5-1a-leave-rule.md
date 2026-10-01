---
title: 'Leave cost and balance, computed in one pure domain rule (5.1a)'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: 'b09f5a56329b15916f30d92e48f4b4eb95a6b436'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 5.1 needs an admin to see what a leave range costs, and what it leaves of the member's balance, before saving. Nothing in the engine computes leave yet. `engine-rules.md` §4 (R4.2, R4.5–R4.7) defines the rule, and Epic 5 requires it to live in ONE pure function that can change without a schema change, because R4.2 is inferred and not confirmed by the pilot.

**Approach:** Add `packages/domain/src/leave.ts`, exported from `index.ts`. It covers:
- the cost of a date range: the count of dates on which the member has at least one working shift, read from `memberScheduleOfMonth`;
- the leave year containing a date, from the organization's start month and day;
- the member's balance (allowance, days used in the current leave year, remainder);
- a preview of a new range: its cost, the part charged to the current year, the balance after, and whether it exceeds the balance.

It returns numbers and flags only, and is asserted on both fixtures in node.

## Boundaries & Constraints

**Always:**
- **R4.2.** A date costs 1 when the member's schedule on it holds at least one shift whose type is in `workingShiftTypeIds`, whether on their own team or a shift a roster override puts them on. A date with two working shifts still costs 1. Non-working, no-team, inactive and taken-off dates cost 0. The per-date rule is one small exported function, so it is the single place to change it.
- Ranges are inclusive `from`–`to` calendar dates with `from <= to`. A range may span months and leave years.
- **R4.6.** Leave year: the year starting on `(startMonth, startDay)` that contains the date. `startDay` is 1–28, as `organizations` checks. Only dates inside the current leave year (the one containing `today`) count toward "used".
- **R4.5.** `balance = allowance − used`, and it may be negative. The three figures always agree.
- **R4.7.** The preview flags `exceedsBalance` when the cost in the current year is greater than the balance before it. This is a warning, never a refusal.
- **AD-7.** No `Date`, no time zone, no I/O, no new dependency. `today` is a caller-supplied `YYYY-MM-DD`. Every breached precondition throws a `RangeError` naming the value, in the style of `hours.ts`.

**Ask First:**
- Any change to `schedule.ts` or `hours.ts` beyond a read-only reuse.
- Counting leave per shift or per hour instead of per date.

**Never:**
- No database, UI or leave-hours work. Leave hours (R4.10) belong to 5.3, the record to 5.1b, the screen to 5.1c.
- No overlap check between records here; the database owns it (R4.4, 5.1b).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Worked example (pilot) | `Dan, Noć, Slobodno, Slobodno, Dan` over 5 dates | cost 3 | N/A |
| UJ-5 | 5 dates over `Jutarnja, Popodnevna, Noćna, Slobodno, Slobodno` | cost 3 | N/A |
| Two shifts on one date | own shift plus one a roster override puts them on | that date costs 1 | N/A |
| Taken off | a roster override takes the member off their only shift | that date costs 0 | N/A |
| Inactive or no team | dates while inactive or on no team | 0 | N/A |
| Leave year, not January | start 1 March; today 2026-02-10 | year 2025-03-01–2026-02-28 | N/A |
| Range across years | today in year Y; a range ends in Y+1 | cost counts all dates; the current-year part counts only Y | N/A |
| Over balance | allowance 2, used 1, new cost 3 | `balanceAfter` −2, `exceedsBalance` true | N/A |
| Leap year | start 1 March, a year containing 29 Feb | the year includes 29 Feb | N/A |
| Bad input | `from > to`, a non-date, `startDay` 29, negative allowance | — | RangeError naming the value |

## Epic AC Deviations

- **Deferred to 5.1c** (human split, 2026-10-01): "the cost is shown before saving". 5.1a computes it; 5.1c shows it. Ledger: `deferred-work.md`, the "Story 5.1c" entry.
- **Deferred to 5.1b** (human split): "every scheduled shift is still in place" after a save, and "overlapping range … refused by the database … names the conflict and keeps every entered value". Ledger: `deferred-work.md`, the "Story 5.1b" entry.
- **Partly here, partly 5.1c**: "saves with a warning rather than being refused". 5.1a supplies `exceedsBalance`; 5.1c shows the warning on save.

</frozen-after-approval>

## Code Map

- `packages/domain/src/schedule.ts:207-330` -- `MemberScheduleInput` (it carries `workingShiftTypeIds`), `MemberShift` (`shiftTypeId`, `viaOverride`) and `memberScheduleOfMonth(input, month)`, which gives one row per date with its shifts. To walk a range, call it per spanned month with `monthOf` and slice to the range. `datesOfMonth` and `monthOf` are at :103 and :120.
- `packages/domain/src/projection.ts:81` -- `daysBetween`, plus the private `checkDate`/`civilDayNumber` that validate dates. Reuse the exported date helpers, or validate the same way. Month arithmetic: `adjacentMonth` (`schedule.ts:132`).
- `packages/domain/src/hours.ts:151-212` -- the shape to mirror: header comment, input interface, RangeError style, results as numbers only.
- `packages/domain/src/index.ts` -- export the new functions and types. Its header already names "leave".
- `packages/domain/test/fixtures.ts` -- the pilot (`[Dan, Noć, Slobodno, Slobodno]`, teams A–D at offsets 0–3) and UJ-5 (`[Jutarnja, Popodnevna, Noćna, Slobodno, Slobodno]`). `SEEDED_ANCHOR_DATE` is 2020-01-01. `hours.test.ts` shows how a member input is built over these fixtures (`it.each(FIXTURES)`).
- `packages/domain/test/purity.test.ts` -- asserts no imports; the new module must pass it.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/leave.ts` -- `isLeaveDay(day, workingIds)`, `leaveCostOf(input, from, to)`, `leaveYearOf(date, startMonth, startDay)`, `leaveBalanceOf({ input, allowanceDays, records, today, leaveYearStart })` and `leavePreviewOf(...)`. Names are free if they are clear. It returns `{ allowanceDays, usedDays, balanceDays }` and `{ costDays, costInYearDays, balanceAfterDays, exceedsBalance }` -- the one leave rule.
- [x] `packages/domain/src/index.ts` -- export them -- the public API.
- [x] `packages/domain/test/leave.test.ts` -- every matrix row, on both fixtures where a schedule is involved (`it.each`), plus the worked example by name -- R8 coverage in node.

**Acceptance Criteria:**
- Given the pilot and UJ-5 fixtures, when the tests run in node, then every matrix row passes and `purity.test.ts` still passes.
- Given a leave record that straddles the start of the leave year, when the balance is computed, then only its dates inside the current year count as used.

## Verification

**Commands:**
- `pnpm --filter ./packages/domain exec vitest run` -- expected: all green
- `pnpm typecheck && pnpm lint` -- expected: exit 0

## Suggested Review Order

**The rule**

- Entry point: the single per-date rule R4.2 hangs on; change it here alone.
  [`leave.ts:115`](../../packages/domain/src/leave.ts#L115)

- A range's cost walks each spanned month once; inactive dates cost nothing.
  [`leave.ts:203`](../../packages/domain/src/leave.ts#L203)

- The leave year from the organization's start; leap days included.
  [`leave.ts:218`](../../packages/domain/src/leave.ts#L218)

**Balance and preview**

- Used counts only in-year dates; overlapping records are a breached precondition.
  [`leave.ts:286`](../../packages/domain/src/leave.ts#L286)

- Preview: full cost, in-year charge without double-charging, the balance before and after, and the warning flag.
  [`leave.ts:304`](../../packages/domain/src/leave.ts#L304)

- A range over a year is a typo, refused before any schedule is built.
  [`leave.ts:46`](../../packages/domain/src/leave.ts#L46)

**Tests**

- The worked example by name, then every matrix row on both fixtures.
  [`leave.test.ts:136`](../../packages/domain/test/leave.test.ts#L136)
