---
title: 'Story 3.1: Anyone reads a month'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'eb41ed1e0257eaab075fe0d6caebf21fe19ad86c'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/kalendar` is a titled placeholder. Nobody, member or admin, can see which team works which shift type on a given date without opening the rotation builder, and a member cannot open the builder at all.

**Approach:**
- `/kalendar` shows one month as a grid: a row per day and a column per active team. Each cell holds the shift type that team works that day.
- The month is derived in `packages/domain` from one read of the configuration. The month is chosen in the URL (`?mjesec=YYYY-MM`), and moving between months never reads again.

## Boundaries & Constraints

**Always:**
- **Domain (AD-7):**
  - New `packages/domain/src/schedule.ts` exports:
    - `datesOfMonth(month)`: every `YYYY-MM-DD` of a `YYYY-MM` month;
    - `monthOf(date)`;
    - `adjacentMonth(month, ±1)`, which returns `null` outside 0001-01…9999-12;
    - `scheduleOfMonth({ teamIds, assignments, steps }, month)`, which returns rows of `{ date, cells: { teamId, shiftTypeId | null }[] }`.
  - Each cell is `projectedShiftTypeOn` for that team and date, and `null` when no version is in effect yet.
  - Every precondition that breaks throws a `RangeError`. The functions return ids only.
  - `projectedShiftTypeOn` is the only projection used. No modulo arithmetic in `apps/web`.
- **One read (AD-13):**
  - New `apps/web/src/calendar/snapshot.ts` reads the organization zone, teams, shift types with their versions, steps and assignments in ONE `select` from `organizations` under `CALENDAR_KEY = ['calendar']`, with `count: 'exact'`.
  - Each embedded row is checked by the existing row parsers and the tenant tripwire. The read has no `members` embed and no `created_by`/`created_at`, because a member reads only their own member row.
  - The snapshot is not windowed, so the query key has no month.
  - `staleTime` is 0: after a rotation or shift-type save elsewhere, opening the calendar shows the cached month, then refetches it.
  - The only failure is `CALENDAR_UNAVAILABLE`, shown as a `Notice role="alert"`. Offline counts as unavailable.
- **Month model (`apps/web/src/calendar/month.ts`, pure):**
  - It returns the heading, rows and cells, ready to render.
  - Each row has its date `formatIsoDayMonth` and weekday, plus `isToday` (today in the organization zone).
  - Each cell has the name, `slotColourClassOf` fill (or `NONWORKING_CHIP_CLASS`), and its range from `shiftTypeVersionOn` + `shiftTimesShownOf` on that date. Non-working cells and cells without a version have no range.
  - A `null` cell renders `NO_TIMES_SHOWN` with a `kalendar.noRotation` label for screen readers.
  - Columns are `splitTeams(...).active`.
  - A missing or invalid `mjesec` falls back to today's month in the organization zone.
- **Screen (`routes/kalendar.tsx`):**
  - `validateSearch` for `mjesec`.
  - A header with the month name and year, plus previous, next and `Ovaj mjesec` buttons (≥ 44 px). Previous and next are disabled only at the calendar bounds.
  - A `Table` inside its own horizontal overflow: `th scope="col"` for teams and `th scope="row"` for dates. Today's row carries `aria-current="date"`.
  - Cells are at least 30 px high. The label is always visible. The range is shown from 1024 px up and hidden below, never truncated or abbreviated.
  - While loading, skeleton rows with the grid's shape, with `aria-busy`. No spinner.
  - The page never scrolls sideways.
- **A shift crossing midnight** (19:00–07:00) appears once, on its start date, with both clock times.
- **Text:** every string goes through `hr.json` under `kalendar.*` and is registered in the inventories, as 2.6 did. `Smjena` means a team, never a shift type.

**Ask First:** any migration, table or policy, including override tables; showing archived teams; a day-detail view.

**Never:**
- override tables or override logic (stories 3.5 and 3.6);
- mode switch, filters, phone day-list, legend or modifiers (3.2 and 3.3);
- day detail (3.4);
- a second query or key;
- one fetch per month;
- materialized schedules;
- reading fire rank or position;
- `destructive` or the accent on shift state;
- new dependencies;
- render tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| This month | pilot, no `mjesec` | Month of today (org zone); today's row marked; a cell per active team | N/A |
| Far future | `?mjesec=2031-02` | 28 rows, all projected; no new request | N/A |
| Before first version | a month before every `effective_from` | Every cell `—` with no-rotation label | N/A |
| Version change mid-month | 2.6 change on the 15th | 1–14 through old pattern, 15+ through new | N/A |
| Night shift | 19:00–07:00 type | Once on its start date, range `19:00–07:00` | N/A |
| Bad param | `?mjesec=2026-13` / `abc` | Falls back to current month | N/A |
| Bounds | `0001-01` / `9999-12` | Previous / next disabled | N/A |
| Member | member-role account | Same grid as admin | N/A |
| Read fails | network error / foreign row | Alert notice, no grid | `CALENDAR_UNAVAILABLE` |

</frozen-after-approval>

## Code Map

- `packages/domain/src/projection.ts:240` -- `projectedShiftTypeOn(versions, steps, date)`, which returns the id or `null`. Group the versions per team.
- `packages/domain/src/calendar.ts` -- `checkDate`, `civilDayNumber`, `dateOfCivilDay` (internal; `schedule.ts` imports them). `warnings.ts:158` `windowOf` is a private precedent for iterating dates.
- `packages/domain/src/index.ts` -- export the new module.
- `packages/domain/test/fixtures.ts`, `projection.test.ts` -- the PILOT/UJ5 fixtures and the two-version pattern (2.6, :417).
- `apps/web/src/rotation/list.ts`:
  - `ROTATION_COLUMNS` :55 and `readRotation` :257 — the model for the read. Copy them WITHOUT the history and members parts.
  - Reuse `rotationStepOf` :162, `rotationAssignmentOf` :177, `rotationQueryOptions` :482 and the `rotationSurfaceStateOf` :521 shape.
  - `teamAssignmentsOf` :397.
- `apps/web/src/shift-types/list.ts`:
  - `ORGANIZATION_ZONE_COLUMNS` :53, `SHIFT_TYPES_EMBED` :60, `shiftTypeRowOf` :246, `compareCreation`;
  - `rampSlotsOf` :367, `slotColourClassOf` :408, `NONWORKING_CHIP_CLASS` :401;
  - `shiftTimesShownOf` :430, `NO_TIMES_SHOWN` :398.
- `apps/web/src/teams/list.ts` -- `TEAMS_COLUMNS` :35, `teamRowOf` :103, `splitTeams` :196.
- `apps/web/src/rotation/draft.ts` -- `previewGridOf` :654 with the inline `rangeOf`, and `chipsOf` :480 (private). Extract them or mirror them; do not change the builder's behaviour.
- `apps/web/src/i18n/format.ts`:
  - `organizationIsoDate` :216, `formatIsoDayMonth` :295;
  - `formatMonthName` :340 and `formatWeekdayName` :345 take an instant. Add ISO-date wrappers through `noonOf` :231, in `FALLBACK_TIME_ZONE`.
- `apps/web/src/routes/kalendar.tsx` -- the placeholder to replace. `postavke-rotacije.tsx:99,388` has the skeleton and `aria-busy` pattern.
- `apps/web/src/components/ui/{table,button,notice,card,page-header}.tsx`.
- `apps/web/src/router.test.ts:156,381` -- the kalendar pins. A search param keeps the deep-link chain; do NOT add a child route.
- Inventories: `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` (string counts, controls, bans). Register whatever the sweeps flag.
- `apps/web/src/rotation/rotation.fixture.ts` -- the row builders for the snapshot tests.
- e2e:
  - `e2e/support/database.ts:59` `holdRotation`;
  - `e2e/support/fixture.ts` `ADMIN_STATE`/`MEMBER_STATE`;
  - `e2e/support/layout.ts` `expectNoHorizontalScroll`/`expectTouchTargets`;
  - `e2e/support/rotation.ts` `addShiftType`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/schedule.ts`, `index.ts`, `test/schedule.test.ts` -- the month helpers and `scheduleOfMonth`. Tests: every cell equals `projectedShiftTypeOn` on both fixtures; a February in a leap year and in a common year; a change in the middle of the month; the bounds; bad input.
- [x] `apps/web/src/i18n/format.ts` (+ test) -- `formatIsoMonthName`/`formatIsoWeekdayName`, or an equivalent ISO wrapper.
- [x] `apps/web/src/calendar/snapshot.ts`, `snapshot.test.ts` -- the read, the parsing, the tripwire, the one select, the query options, the surface state, and the message key.
- [x] `apps/web/src/calendar/month.ts`, `month.test.ts` -- search parsing and fallback, heading, rows, cells, today, ranges, the null cell and the bounds. Covers every row of the matrix except Member and Read fails.
- [x] `apps/web/src/routes/kalendar.tsx` -- the screen as specified.
- [x] `apps/web/src/i18n/locales/hr.json` -- the `kalendar.*` keys.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts`, `apps/web/src/router.test.ts` -- update the inventories and pins.
- [x] `e2e/support/database.ts`, `e2e/calendar.spec.ts` -- a SQL helper seeds a rotation for the run's org under `holdRotation`. Tests:
  - as admin and as member, the month shows the team column and the projected types;
  - next → next → previous changes the month with no request to `/rest/v1/organizations`;
  - no horizontal scroll at 320 px;
  - the navigation buttons are touch targets.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `epic-3: in-progress`, `3-1-anyone-reads-a-month: in-progress`.

**Acceptance Criteria:**
- Given the calendar opened, when its network traffic is inspected, then there is exactly one `organizations` select, and every figure on screen comes from it.
- Given the domain with no exception layer, when `scheduleOfMonth` is compared day by day with `projectedShiftTypeOn` for every team of both fixtures, then they are equal. (Stories 3.5 and 3.6 extend this assertion to "all overrides removed".)
- Given `apps/web/src/calendar`, when it is swept, then it contains no `%`-modulo projection, no `.insert(`/`.update(`/`.delete(`/`.upsert(`, and no read of rank or position.

## Design Notes

**Unwindowed snapshot.** Configuration is small at pilot scale: a handful of teams, types, steps and versions. Reading it once makes every month cost only a pure computation, which is how "visited ≈ unvisited" and "unbounded" hold by construction. When overrides arrive (3.5), their window is the part that may need a month in the key. This story adds nothing an override would need.

**Archived teams are hidden,** as in the builder. An archived team's rotation still projects, so it would appear in every month forever. Showing it only where it once worked needs a rule, which is an Ask First.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `pnpm test:e2e` -- green. Stop Vite on 5173 first; not alongside `pnpm test`.
- `git diff --stat supabase/ package.json pnpm-lock.yaml` -- empty.

**Manual checks:**
- Pilot/demo org at 390 and 1280 px: the ranges appear only on desktop. With throttling set to Fast 4G and a 4× slower CPU, the month renders in under 2 s.

## Suggested Review Order

**The month, derived in the domain**

- Entry point: every cell is `projectedShiftTypeOn`, per active team and date; ids only.
  [`schedule.ts:115`](../../packages/domain/src/schedule.ts#L115)

- Month helpers: civil-day arithmetic, `null` at the 0001-01 / 9999-12 bounds.
  [`schedule.ts:95`](../../packages/domain/src/schedule.ts#L95)

**One read, one key**

- One `organizations` select, no `members` embed and no attribution columns.
  [`snapshot.ts:51`](../../apps/web/src/calendar/snapshot.ts#L51)

- `staleTime` 0: after a save elsewhere the calendar shows the cached month, then refetches.
  [`snapshot.ts:66`](../../apps/web/src/calendar/snapshot.ts#L66)

- A paused fetch or an error is a refusal, cached or not; the grid is never stale.
  [`snapshot.ts:315`](../../apps/web/src/calendar/snapshot.ts#L315)

**From snapshot to screen model**

- The rows, cells, fills and ranges; a missing type or formatter throws.
  [`month.ts:179`](../../apps/web/src/calendar/month.ts#L179)

- The guard: a domain or format throw becomes `CALENDAR_UNAVAILABLE`, never a crash.
  [`month.ts:222`](../../apps/web/src/calendar/month.ts#L222)

- `?mjesec` parsing; an invalid value falls back to today's month.
  [`month.ts:69`](../../apps/web/src/calendar/month.ts#L69)

**Screen**

- `mjesec` is a search param, not a child route, so the router pins hold.
  [`kalendar.tsx:222`](../../apps/web/src/routes/kalendar.tsx#L222)

- The memoized, guarded month; navigation never reads again.
  [`kalendar.tsx:66`](../../apps/web/src/routes/kalendar.tsx#L66)

- The range is shown only from `lg`: dropped, never abbreviated.
  [`kalendar.tsx:90`](../../apps/web/src/routes/kalendar.tsx#L90)

- Buttons disabled only at the bounds; `Ovaj mjesec` disabled while current.
  [`kalendar.tsx:178`](../../apps/web/src/routes/kalendar.tsx#L178)

**Shared formatting fix (touches other screens)**

- Years before 1000 are padded to four digits; `isIsoDate` accepts them now.
  [`format.ts:157`](../../apps/web/src/i18n/format.ts#L157)

- ISO wrappers for month and weekday names.
  [`format.ts:365`](../../apps/web/src/i18n/format.ts#L365)

**Peripherals**

- E2E seed and cleanup of a rotation, under `holdRotation`.
  [`database.ts:160`](../../e2e/support/database.ts#L160)

- Calendar E2E: admin and member, no second read, bounds, 320 px, failed read.
  [`calendar.spec.ts:1`](../../e2e/calendar.spec.ts#L1)

- Domain tests: every cell equals the projection, on both fixtures.
  [`schedule.test.ts:35`](../../packages/domain/test/schedule.test.ts#L35)

- Copy: the `kalendar.*` keys.
  [`hr.json:27`](../../apps/web/src/i18n/locales/hr.json#L27)
