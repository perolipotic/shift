---
title: 'The hours rule: one member''s month, split by band (4.1a)'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_commit: '04a59e4fdc7c3ccebce2f34fd0ee5d05efadcf31'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing computes hours yet. Epic 4 needs one pure computation, used everywhere, that turns a member's rostered month into shift counts, minutes per hour band and a total, and never rounds or reads real time.

**Approach:** Add `packages/domain/src/hours.ts`. It takes the member-schedule input plus the organization's bands and shift types (with versions), walks `memberScheduleOfMonth`, and intersects each working shift's nominal interval with the band partition. The screen is story 4-1b and is out of scope here.

## Boundaries & Constraints

**Always:**
- Integer minutes over nominal wall-clock. There is no `Date`, time zone or elapsed time. Duration comes from `deriveShiftTimes`/`shiftTypeVersionOn` for the version in force on the shift's date.
- A shift, including one that crosses midnight, is one interval `[start, start+duration)` counted wholly in its start date's month.
- Per band: minutes, plus the number of shifts whose interval overlaps that band. A split shift counts once in each band it touches. `shiftCount` counts each working shift once.
- Invariant: `sum(band minutes) + unbandedMinutes === totalMinutes`. `unbandedMinutes` is non-zero only when the organization has zero bands, which is a valid state (2-1a).
- Bands are listed in `deriveHourBands` order, including bands with 0 minutes. Output is numbers and ids only.
- `leaveMinutes` is always `0` (it is filled in Epic 5) and never enters any band or the total.
- The roster follows the caller-supplied in-force shift-type and roster overrides, exactly as `memberScheduleOfMonth` does. Non-working types contribute nothing.
- File header, JSDoc, `@throws RangeError` and entry precondition checks follow the existing modules. Imports are relative only (`purity.test.ts`).

**Ask First:**
- Changing any existing domain module's exported signature or behaviour.
- Any case where a fixture expectation in the matrix below does not hold.

**Never:** UI, web services, SQL, schema, i18n or new dependencies. No conflict state (Epic 5). No rounding, and no hours cached or stored.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Split | bands 06:00/21:00, one 19:00–07:00 shift | day 180 min (count 1), night 540 (count 1), total 720 | N/A |
| Pilot no split | pilot bands, 5 `Dan` + 4 `Noć` | 3600 / 2880, counts 5 / 4, total 6480 | N/A |
| 24h under pilot | one 07:00–07:00 type | 720 / 720, total 1440 | N/A |
| UJ-5 | UJ-5 fixture month | every shift split across two bands; invariant holds | N/A |
| DST | 12 h shift on 2026-03-29 and on 2026-10-25 | 720 each, unchanged split | N/A |
| Crossing into next month | night shift on the month's last day | whole duration in this month, none in the next | N/A |
| Roster override | A removed, B added on one working shift | that shift's minutes leave A and appear on B; others unchanged | N/A |
| Double shift | own shift plus one added on another team, same day | both counted | N/A |
| Zero bands | no bands | `bands: []`, all minutes in `unbandedMinutes` | N/A |
| Untimed | working type with no version on the date | not counted in minutes; `untimedShiftCount` +1 | N/A |
| Bad input | malformed month, band or type data | — | `RangeError` naming the value |

</frozen-after-approval>

## Code Map

- `packages/domain/src/schedule.ts:207,239,277` -- `MemberScheduleInput`, `MemberShift`, `memberScheduleOfMonth(input, 'YYYY-MM')`: the per-day shifts to walk. A day may hold several shifts. The own team's shift is included even when non-working, or with `shiftTypeId: null` when there is no rotation, so filter those out.
- `packages/domain/src/bands.ts:23,102,131` -- `MINUTES_PER_DAY`, `deriveHourBands` (ordering and validation), `partitionOfDay`. A crossing band is two segments with one `bandId`, and zero bands give one `null` segment. To intersect a shift that runs past 1440, match it against the segments and against the segments shifted by +1440. There is no intersection helper yet.
- `packages/domain/src/duration.ts:32,46,81,105,146` -- `ShiftType.isWorking`, `ShiftTypeVersion`, `deriveShiftTimes`, `shiftTypeVersionOn` (throws on mixed types, so pass one type's versions).
- `packages/domain/src/index.ts` -- re-export groups `{…, type X} from './x.js'`; the header already names hours.
- `packages/domain/src/calendar.ts` -- internal `checkDate`; do not re-export it.
- `packages/domain/test/fixtures.ts:30,39,57,72,105,132,166,193` -- pilot/UJ-5 bands, types, teams and rotation; `NO_ROSTER`; `soleShiftDaysOf`.
- `packages/domain/test/roster-overrides.test.ts:59,70,97` -- `membersOf`, `workingOf` and `override` helpers; `FIXTURES` with `it.each`.
- `packages/domain/test/duration.test.ts:245-275` -- the seeded `prng` pattern for randomized tests (fast-check is not allowed).
- `packages/domain/test/purity.test.ts` -- src may import only relative paths.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/hours.ts` -- add `MemberHoursInput` (a `MemberScheduleInput` plus `bands: HourBand[]` and `shiftTypes: {type: ShiftType, versions: ShiftTypeVersion[]}[]`) and `memberHoursOfMonth(input, month): MemberHours`, returning `{shiftCount, bands: {bandId, minutes, shiftCount}[], unbandedMinutes, totalMinutes, leaveMinutes, untimedShiftCount}`. Add a pure interval-by-partition intersection helper -- the single hour computation.
- [x] `packages/domain/src/index.ts` -- export the function and its types; keep the helper internal unless 4.2 obviously needs it.
- [x] `packages/domain/test/hours.test.ts` -- cover every matrix row, run the fixture cases with `it.each` over pilot and UJ-5, and assert the sum invariant over at least 1000 seeded random band/type configurations.

**Acceptance Criteria:**
- Given any valid input, when `memberHoursOfMonth` runs, then the band minutes plus `unbandedMinutes` equal `totalMinutes`, and `totalMinutes` equals the sum of the durations of the timed working shifts.
- Given the domain package, when `pnpm --filter @shift/domain test` runs, then every hours case passes in node without a browser, and the purity test still passes.

## Design Notes

Intersection of a shift `[s, e)` with `e <= 2880`, for each partition segment `[f, t)` and for its copy `[f+1440, t+1440)`, is `max(0, min(e, t) - max(s, f))`, accumulated by `bandId`. Under pilot bands a 19:00–07:00 shift touches only `[1140,1440)` and `[1440,1860)`, both `pilot-noc`, so it does not split.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm --filter @shift/domain test` -- expected: all pass
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm --filter @shift/domain typecheck` -- expected: no errors
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint` -- expected: no errors

## Suggested Review Order

**The computation**

- Entry point: walks the member's schedule and accumulates each timed working shift by band.
  [`hours.ts:151`](../../packages/domain/src/hours.ts#L151)

- The only intersection: a shift against the day partition and its +1440 copy.
  [`hours.ts:91`](../../packages/domain/src/hours.ts#L91)

- Result shape: numbers and ids only; per-band counts deliberately do not sum.
  [`hours.ts:53`](../../packages/domain/src/hours.ts#L53)

**Preconditions**

- Types checked once, and the working-id list must match the working types given.
  [`hours.ts:112`](../../packages/domain/src/hours.ts#L112)

- Duplicate band ids rejected, so no band is emitted twice.
  [`hours.ts:156`](../../packages/domain/src/hours.ts#L156)

**Public surface**

- Function and types exported; the helper stays internal.
  [`index.ts:39`](../../packages/domain/src/index.ts#L39)

**Tests**

- Independent minute-by-minute oracle every case is compared against.
  [`hours.test.ts:76`](../../packages/domain/test/hours.test.ts#L76)

- Story cases: 3/9 split, pilot 60/48/108, UJ-5 splits.
  [`hours.test.ts:254`](../../packages/domain/test/hours.test.ts#L254)

- DST dates and month-crossing shifts.
  [`hours.test.ts:403`](../../packages/domain/test/hours.test.ts#L403)

- Hours follow roster and shift-type overrides, exactly.
  [`hours.test.ts:483`](../../packages/domain/test/hours.test.ts#L483)

- 1000 seeded random configurations against invariant and oracle.
  [`hours.test.ts:661`](../../packages/domain/test/hours.test.ts#L661)
