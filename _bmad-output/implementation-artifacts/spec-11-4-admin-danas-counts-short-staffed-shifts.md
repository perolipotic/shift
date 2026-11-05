---
title: 'Story 11.4: Admin Danas counts short-staffed shifts'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: 'f5986fa6be2e9df3ef5d60c22f9c2cf3e9bbc39c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-11-3-the-calendar-day-marks-a-short-staffed-shift.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An admin landing on *Danas* sees a short-staffed shift only as a small mark in *Ovaj tjedan*. Nothing counts them. *Pokrivenost danas* derives type, range and roster with its own `coverageOf`, which is AD-13's last recorded exception.

**Approach:** While *Najmanje ljudi u smjeni* is set, a *Premalo ljudi* card directly after *Treba tebe* counts the short-staffed shifts of the week *Ovaj tjedan* draws (today + 6). It comes from the same derivation as the calendar's marks, is shown at zero, and lists the earliest shifts. Each row links to that day's detail on *Kalendar*. *Pokrivenost danas* takes kind, type, range and roster from `dayDetailOf`.

## Boundaries & Constraints

**Always:**
- Horizon: `ADMIN_WEEK_DAYS`. The rows are `shortStaffedShiftsOf(staffingInputOf(snapshot, marks.staffingLeave), today, today+6)`, the calls `shortStaffedOfMonth` makes. The count is the number of rows. A test pins count = number of week cells that carry `MODIFIER_SHORT_STAFFED`, under both fixtures.
- `view.shortStaffed` is `null` while `marks.staffingLeave` is `null` (setting empty). Then there is no card.
- Card: heading `Premalo ljudi`, count line `{n} smjena ovaj tjedan` (plural). Above zero: `border-l-4 border-l-warning` and `UsersThree` in `text-warning`. At zero: neutral, `CheckCircle`, and `Svaka smjena ovaj tjedan ima najmanje {minimum} ljudi.` (plural-correct).
- At most `NEEDS_YOU_ROWS` rows, soonest first, then by team order. Each reads `{weekday} {dd.mm.} · {team} · {type}: rade 2 od najmanje 3` (`popunjenost.atWork`). Each is a link to `/kalendar?mjesec&dan&danSmjena`, which opens the day detail. Then `i još {n}`, then `Otvori kalendar`.
- *Pokrivenost*: for each `month.columns` team, `dayDetailOf(snapshot, team.id, today)`: `noRotation` / `off` / working with `typeName`, `range`, and `detail.roster` as the roster. Phase, absent states, `present`/`total` and the replacement rule are unchanged. Output is identical to today's on every existing test.
- Text stays `foreground` / `muted-foreground`. `warning` is used only for the edge and the glyph.

**Ask First:** a horizon other than the week; a two-column layout; a short-staffed line on *Pokrivenost* rows; any new token.

**Never:** staffing arithmetic outside `domain/staffing`; a second leave read; `destructive` or the accent for this card; anything stored; a migration or `db reset`; touching the calendar's mark derivation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Short | min 3, team of 4, two on leave on two dates this week | count 2, warning edge, 2 rows linking to their days | N/A |
| Many | 5 short | 3 rows + `i još 2` | N/A |
| Zero | min set, none short | `0 smjena ovaj tjedan`, check, calm line | N/A |
| Empty setting | minimum `null` | no card | N/A |
| Beyond week | short only on today+7 | count 0 | N/A |
| Refused data | `RangeError` | whole screen unavailable (existing guard) | logged |

## Epic AC Deviations

- *"counts short-staffed shifts ahead"* is **narrowed** to the week *Ovaj tjedan* shows (today + 6 days). That bounds the number when a team is permanently below the minimum. It also makes the AC's "equals the calendar marks from the same snapshot" visible on the same screen. Later shifts show on *Kalendar* and in 11.2's save-time block.
- *"a card beside Za odluku"* is **read** as directly after *Treba tebe*, in the same single column.
- *"linking to their dates"*: each row links to its date's day detail. Rows beyond the third are counted, not linked, and the card ends in *Otvori kalendar*.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/today/services/admin-today.ts:382` `adminTodayViewOf` -- `marks` (`staffingLeave`), `dates` and `today` are already there; add `shortStaffed`. `:548` `coverageOf` is rewritten over `dayDetailOf`, and its `month` param is kept for `columns`.
- `apps/web/src/features/calendar/utils/month.ts:1318` `shortStaffedOfMonth` -- the recipe to mirror. Not exported; do not change it.
- `apps/web/src/features/calendar/utils/day-detail.ts:247` `dayDetailOf`, `DAY_WORKING/OFF/NO_ROTATION`. `roster[].name` may be `null` (an added unknown member), and today's code throws `RangeError` for that.
- `apps/web/src/features/staffing/services/short-staffed.ts:126` `staffingInputOf`, `:107` `minimumOfCalendar`.
- `apps/web/src/features/calendar/utils/month.ts:222,287` `CalendarSearch`, `calendarSearchTo` -- the link's search (`mjesec`, `dan`, `danSmjena`).
- `apps/web/src/features/today/components/needs-you-card.tsx` -- the card shape to mirror. `admin-today-body.tsx` -- placement. `admin-today-skeleton.tsx` -- add no block (the card's presence is setting-dependent).
- `apps/web/src/components/ui/icon.tsx` -- `UsersThree` is already exported (11.2).
- `apps/web/src/lib/i18n/locales/hr.json:124` `danas.admin.*`, `:1722` `popunjenost.*`. Key and literal sweeps: `pages/key-sweep.test.ts`, `literal-sweep.test.ts`.
- `apps/web/src/features/today/services/admin-today.test.ts:412,605` -- *Pokrivenost* and the week; `:167` sets `minimumMembers`.
- `e2e/tests/today/today.spec.ts`, `e2e/tests/calendar/calendar-short-staffed.spec.ts` -- the setup to reuse.

## Tasks & Acceptance

**Execution:**
- [x] `admin-today.ts` -- `ShortStaffedCard` view (`count`, `minimum`, `rows`, `more`) or `null`; *Pokrivenost* over `dayDetailOf`. The card's keys are called through `t()` in the component, not through message-key helpers.
- [x] `admin-today.test.ts` -- every matrix row under both fixtures. Count = the week's marked cells. *Pokrivenost* is unchanged on the existing cases, plus a roster-override case that matches `dayDetailOf`.
- [x] `short-staffed-card.tsx` (new, `features/today/components`) and `admin-today-body.tsx` -- the card after `NeedsYouCard`.
- [x] `hr.json` -- `danas.admin.shortStaffed.*`.
- [x] `e2e/tests/today/` -- minimum set and two absent on one date: the card counts 1 and the row opens that day's detail. Setting empty: no card.
- [x] Docs:
  - `epics.md`: UX-DR48's Danas clause and UX-DR23 as shipped; UX-DR4 lists the card edge.
  - `EXPERIENCE.md:108`: the card.
  - `DESIGN.md` §Warning: the card edge.
  - `ARCHITECTURE-SPINE.md` AD-13: `Amended 2026-11-04 (story 11.4)`, the *Danas* coverage exception closed.

**Acceptance Criteria:**
- Given the merged change, when `pnpm test` runs, then the count equals the week's short-staffed marks under both fixtures, and *Pokrivenost* reads type, range and roster only through `dayDetailOf`.
- Given the setting empty, when admin *Danas* renders, then no *Premalo ljudi* card is in the DOM.

## Spec Change Log

## Design Notes

The 11.3 mark and the card read one input recipe over the same `marks.staffingLeave`, so they agree by construction. The test pins it anyway. Rewriting *Pokrivenost* is a refactor with an invariant: every existing *Pokrivenost* test passes unchanged.

The e2e changes `minimum_members` on a shared stack: it holds the shared rotation lock (`holdRotation`) and restores the value afterwards, as `calendar-short-staffed.spec.ts` does. Never run e2e locally (port 5173 is shared; CI is the gate), never apply migrations or `db reset`. Root DB test failures caused only by migration 0048 missing on the shared stack are expected.

Review notes (2026-11-05):
- *Pokrivenost*'s absent list now follows the day detail's roster order: name order, with a member a roster override put on sorted in by name rather than appended. This is deliberate (AD-13: it equals the day detail) and is pinned in `admin-today.test.ts`. It differs from the old order only when an override-added member is absent together with another member.
- The epic AC names EXPERIENCE.md §Key Flows. §Key Flows has no admin-landing flow (UJ-1 to UJ-5; the only *Danas* flow is UJ-2, a member's), so the card is recorded where admin *Danas* is specified, in the Admin Danas pattern entry (EXPERIENCE.md:108).

## Verification

**Commands:**
- `pnpm --filter ./apps/web test && pnpm test && pnpm lint && pnpm typecheck` -- expected: green. E2E runs in CI.

## Suggested Review Order

**The count is the calendar's mark**

- Entry point: the week's short-staffed shifts through the month's own recipe, counted and linked.
  [`admin-today.ts:576`](../../apps/web/src/features/today/services/admin-today.ts#L576)

- `null` while the setting is empty: no card.
  [`admin-today.ts:457`](../../apps/web/src/features/today/services/admin-today.ts#L457)

**Pokrivenost from the day detail (AD-13)**

- Kind, type, range and roster are `dayDetailOf`'s; the rest is unchanged.
  [`admin-today.ts:675`](../../apps/web/src/features/today/services/admin-today.ts#L675)

- The recorded exception is closed.
  [`ARCHITECTURE-SPINE.md:151`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L151)

**The card**

- Warning edge and glyph above zero; check and calm line at zero; rows open the day detail.
  [`short-staffed-card.tsx:46`](../../apps/web/src/features/today/components/short-staffed-card.tsx#L46)

- Placed directly after *Treba tebe*.
  [`admin-today-body.tsx:82`](../../apps/web/src/features/today/components/admin-today-body.tsx#L82)

**Docs**

- UX-DR48 as shipped (and UX-DR4, UX-DR23).
  [`epics.md:182`](../planning-artifacts/epics.md#L182)

- Admin Danas entry.
  [`EXPERIENCE.md:108`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L108)

**Tests**

- Every matrix row under both fixtures; count equals the week's marks.
  [`admin-today.test.ts:1078`](../../apps/web/src/features/today/services/admin-today.test.ts#L1078)

- Two absent, one override-added: the day detail's order.
  [`admin-today.test.ts:566`](../../apps/web/src/features/today/services/admin-today.test.ts#L566)

- E2E: count 1 opens the day, zero state, setting empty.
  [`today-short-staffed.spec.ts:102`](../../e2e/tests/today/today-short-staffed.spec.ts#L102)
