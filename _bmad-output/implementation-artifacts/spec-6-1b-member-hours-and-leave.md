---
title: 'Danas shows the month''s hours, the leave balance and what today''s leave costs (6.1b)'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '2d279c32cfb57819aeaba30d3913d5ab34fc8e60'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After 6.1a, Danas states today, the next shift and the week. A member still has to open Sati for this month's hours and Godišnji for the days left. The on-leave case also does not say what the leave costs.

**Approach:**
- Below the 7 days, Danas gets two tiles side by side: an hours tile and a leave tile. Each tile is a link to its detail view.
- Each figure comes from the derivation its detail view already uses, applied to the same query keys. The hours tile uses `myHoursSurfaceOf` and the leave tile uses `myLeaveOf`.
- The on-leave case gains a cost sentence from the domain's `leaveCostOf`.

## Boundaries & Constraints

**Always:**
- **Hours tile.**
  - Content:
    - kicker: "Sati · ‹Mjesec› ‹godina›", from the view's `MonthHeader`;
    - value: the month's total;
    - hint: each band as "‹ime› ‹h›", in Sati's order and including 0 h bands;
    - Sati's `sati.conflicts` line when `conflictCount` is not null.
  - The month is today's month in the organization's zone, which is Sati's default.
  - Inputs:
    - the calendar snapshot;
    - own leave under `MY_LEAVE_RECORDS_KEY`;
    - own resolutions under `MY_CONFLICT_RESOLUTIONS_KEY`, through `hoursConflictsStateOf`.
  - Every role takes this member branch, which fits Danas because it shows the viewer's own month. 6.3 replaces the admin's Danas.
  - The tile links to `/sati`.
- **Leave tile.**
  - Content:
    - kicker: "Godišnji odmor";
    - value: `balanceDays` as `count.days` (a negative number stays a number);
    - hint: "preostalo · iskorišteno ‹used› od ‹allowance›".
  - It uses `myLeaveOf` over the same four reads as Godišnji (`MEMBERS_LIST_KEY`, `ORGANIZATION_SNAPSHOT_KEY`, `CALENDAR_KEY`, `MY_LEAVE_RECORDS_KEY`).
  - The tile links to `/godisnji`.
- **Leave cost.**
  - The on-leave today card adds: "Troši ‹N› dana godišnjeg — računaju se samo tvoji radni dani."
  - N is the sum of `leaveCostOf(memberScheduleInputOf(snapshot), from, to)` over each own record in the absence. Each record is costed on its own range, never the merged range.
  - A `RangeError` gives the existing unavailable state.
- **Tile states.**
  - Each tile resolves on its own: a skeleton tile while its reads are pending, figures when ready.
  - When the tile's state is unavailable, it shows Sati's or Godišnji's unavailable sentence and keeps its link, so the detail view's own retry is one tap away.
  - There is no extra control on Danas. The page alert's retry (shown only when the today reads fail) invalidates every key Danas reads.
  - The unscheduled and page-unavailable states show no tiles.
- **Layout and copy.**
  - Phone order: today, next shift, 7 days, tiles, then the kept team line moved below the tiles.
  - The tiles sit in two columns at 390 px with no horizontal scroll, and use `StatTile` and tabular figures.
  - Copy comes only from `hr.json` and is registered. The plural goes through `count.days` and never a `count === 1` check.
- **Reuse, don't copy.** All reads go in `use-today.ts`. All rules go in `services/` and the node suite tests them.

**Ask First:**
- Any migration, RLS change, or new RPC or query key.
- Changing Sati or Godišnji, or any of their exported helpers' behavior.
- Removing the team line, or re-deriving it from the snapshot.

**Never:**
- No duty-block (6.2), and no admin conflict card or coverage (6.3).
- No organization-wide leave or resolution reads on Danas.
- No change to `packages/domain`.
- No figure computed outside the reused derivations, and no optimistic figure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Month with shifts | Dan 84 h, Noć 96 h | "180 h", hint "Dan 84 h · Noć 96 h" | N/A |
| No shifts yet | month empty | "0 h", bands at 0 h | N/A |
| Unresolved conflict | 1 own shift in conflict | total as Sati shows + conflicts line | N/A |
| Accepted uncovered | resolution moves shift to leave | total excludes it, as Sati does | N/A |
| Balance | allowance 20, used 3 | "17 dana", "iskorišteno 3 od 20" | N/A |
| Over balance | used 22 of 20 | "-2 dana" | N/A |
| On leave today | record 28.09.–04.10. costs 4 | cost sentence "4 dana" | RangeError → unavailable |
| Two back-to-back records | costs 2 + 3 | "5 dana" | N/A |
| Resolutions read fails | today ok | hours tile unavailable sentence + link, leave tile fine | Sati's retry |
| Members read pending | today ok | leave tile skeleton only | N/A |

## Epic AC Deviations

- **"their band hours and total for the period"** — REINTERPRETED: the period is the organization's current calendar month, Sati's default. Sati has no other period.
- **"every figure … equal, because both derive from the same snapshot (Q19, AD-13)"** — REINTERPRETED, as in 6.1a: the same query keys and derivation functions, not one composite read.
- **"on a 24 h duty (as one duty, per 6.2)"** — remains DEFERRED to 6.2. 6.1a already recorded it in `deferred-work.md`.
- **Mockup kicker "Godišnji · 2026."** — NARROWED to "Godišnji odmor". A leave year that does not start on 1 January spans two calendar years, so a single year number would be false.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/today/hooks/use-today.ts` -- add the reads `myConflictResolutionsQueryOptions` (`features/conflicts/services/resolutions`), `membersQueryOptions` and `organizationSnapshotQueryOptions`, wired as in `use-my-leave.ts:43` and `features/hours/hooks/use-hours.ts:75-176`. Call `useReplacementLinkRefresh`, as Sati does at :119. `retry` invalidates all six keys.
- `features/hours/services/my-hours.ts` -- reuse:
  - `myHoursSurfaceOf` :468, with an empty `HoursSearch`, giving `{view, refusal, loading}`;
  - `hoursSnapshotStateOf` :403;
  - `MyHoursView` :263;
  - `HoursFigure`, rendered as `t(fig.key, fig.values)`.
- `features/hours/services/hours-conflicts.ts` -- `hoursConflictsStateOf(snapshot, leaveAnswer, resolutionsAnswer)`.
- `features/leave/services/my-leave.ts` -- reuse:
  - `myLeaveOf` :104, with kinds LOADING, UNAVAILABLE, UNSCHEDULED and READY{balance};
  - `myLeaveRowsStateOf` :73;
  - `myLeaveMessageKey` :185.
- `packages/domain/src/leave.ts:206` -- `leaveCostOf`. `features/calendar/utils/month.ts:955` -- `memberScheduleInputOf`.
- `features/today/services/today.ts` -- `absenceOn` :239 merges records. Add the cost of the records it joins to `CASE_LEAVE` (`TodayCase` :80, `todayCaseOf` :344).
- `features/today/components/today-body.tsx`, `today-card.tsx`, `today-skeleton.tsx` -- add the tiles after `WeekList`, the cost line, and the two tile skeletons.
- `components/ui/stat-tile.tsx` -- `StatTile`, `StatTileLabel`, `StatTileValue`. They are already used in `features/hours/components/hours-summary.tsx` and `features/leave/components/my-leave-summary.tsx`.
- `apps/web/src/pages/danas.tsx:102` -- move the team-line Card below the body. It keeps its own `useQuery`.
- `eslint.config.js:111` `FEATURE_PUBLIC` -- expose these to `today`, and update the consumer comments:
  - `hours: services/my-hours, services/hours-conflicts`;
  - `leave: services/my-leave`;
  - `members: services/list`, if not already public;
  - `organization` snapshot service.
- `features/today/today-screen.fixture.ts` -- register new files in `TODAY_SCREEN_PARTS`.
- `pages/prijava.test.ts` -- re-derive these:
  - :281-292 (sets);
  - :719 (controls stay 1);
  - :2163-2184 (string counts);
  - :3049 (`KEY_SOURCES`);
  - :3214-3233 (file set);
  - :5653-5723 (danas.tsx keeps one `useQuery` and one link).
- `hr.json` `danas.*` and `test/resource-hygiene.test.ts:1486-1499` -- add the new keys: tile kickers, leave hint, cost sentence.
- e2e:
  - `e2e/pages/today.page.ts` -- add tile locators;
  - `e2e/pages/hours.page.ts` (`totalTile` :62, `bandHours` :87) and `e2e/pages/leave.page.ts` (`usedFigure` :33, `balanceFigure` :38) -- the figures to compare against;
  - `e2e/tests/today/today.spec.ts` -- the leave-today test is at :223.

## Tasks & Acceptance

**Execution:**
- [x] `features/today/services/today-tiles.ts` (+test) -- pure: `(hoursSurface, myLeave)` → per-tile state `loading | unavailable(key) | ready(figures)`. Covers every matrix row except the cost rows.
- [x] `features/today/services/today.ts` (+test) -- add `costDays` to `CASE_LEAVE` and test the two cost rows.
- [x] `features/today/hooks/use-today.ts` -- add the four reads and derive the tile states.
- [x] `features/today/components/hours-tile.tsx`, `leave-tile.tsx`, and edits to `today-body.tsx`, `today-card.tsx`, `today-skeleton.tsx`.
- [x] `pages/danas.tsx` -- order the body, then the team line.
- [x] `eslint.config.js`, `today-screen.fixture.ts`, `hr.json`, `resource-hygiene.test.ts`, `prijava.test.ts` -- registrations and re-derived pins.
- [x] `e2e/pages/today.page.ts`, `e2e/tests/today/today.spec.ts` -- with a seeded rotation:
  - the hours tile's total and band hours equal Sati's for the month;
  - the leave tile's balance and used equal Godišnji's;
  - leave today shows the cost sentence with the expected count;
  - 390 px has no horizontal scroll.

**Acceptance Criteria:**
- Given a member, when Danas opens, then the order is today, next shift, 7 days, hours and leave tiles, team line. Every figure is in tabular figures, and loading shows skeleton tiles, never a spinner.
- Given the same member and month, when the hours tile is compared to Sati and the leave tile to Godišnji, then the total, every band's hours, the used days and the balance are equal.
- Given one tile's read fails, when Danas renders, then that tile states it is unavailable in words and still links to its detail view, and the other tile and the cards are unaffected.

## Spec Change Log

- 2026-10-06, review (iteration 0, human-approved): the Blind Hunter found the cost sentence's "dani kad bi radio" masculine-only. The human approved the neutral "računaju se samo tvoji radni dani." in the frozen Boundaries and in `hr.json`. This avoids gendered second-person copy on a screen whose other lines are neutral. KEEP: the per-record `leaveCostOf` sum and the rest of the sentence.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green
- `pnpm exec playwright test e2e/tests/today e2e/tests/hours e2e/tests/leave e2e/tests/layout` -- expected: all pass

## Suggested Review Order

**Wiring: Sati's and Godišnji's own derivations**

- Entry point: Sati's member branch and Godišnji's four reads, on the same keys.
  [`use-today.ts:155`](../../apps/web/src/features/today/hooks/use-today.ts#L155)

- Leave and resolutions parsed exactly as Sati parses them.
  [`use-today.ts:129`](../../apps/web/src/features/today/hooks/use-today.ts#L129)

- The leave tile is `myLeaveOf` itself, so it cannot drift from Godišnji.
  [`use-today.ts:164`](../../apps/web/src/features/today/hooks/use-today.ts#L164)

- A stale replacement link re-reads once, as on Sati.
  [`use-today.ts:120`](../../apps/web/src/features/today/hooks/use-today.ts#L120)

- Retry re-reads every key Danas stands on.
  [`use-today.ts:176`](../../apps/web/src/features/today/hooks/use-today.ts#L176)

**Tile states (pure)**

- Hours tile: Sati's surface becomes loading, unavailable or figures; it computes nothing.
  [`today-tiles.ts:71`](../../apps/web/src/features/today/services/today-tiles.ts#L71)

- Leave tile: Godišnji's balance, used and allowance as they came.
  [`today-tiles.ts:95`](../../apps/web/src/features/today/services/today-tiles.ts#L95)

**Leave cost**

- Each joined record costed on its own range; the database refuses overlaps.
  [`today.ts:383`](../../apps/web/src/features/today/services/today.ts#L383)

- The absence returns the records it joined.
  [`today.ts:286`](../../apps/web/src/features/today/services/today.ts#L286)

**Rendering**

- The tiles come after the week, two columns, only in the ready branch.
  [`today-body.tsx:71`](../../apps/web/src/features/today/components/today-body.tsx#L71)

- Each tile is a link to its detail view, unavailable included.
  [`hours-tile.tsx:17`](../../apps/web/src/features/today/components/hours-tile.tsx#L17)
  [`leave-tile.tsx:17`](../../apps/web/src/features/today/components/leave-tile.tsx#L17)

- The cost sentence through `count.days`.
  [`today-card.tsx:26`](../../apps/web/src/features/today/components/today-card.tsx#L26)

- Skeleton tiles, no spinner.
  [`today-skeleton.tsx:9`](../../apps/web/src/features/today/components/today-skeleton.tsx#L9)

**Peripherals**

- E2E: tiles equal Sati and Godišnji, exactly.
  [`today.spec.ts:142`](../../e2e/tests/today/today.spec.ts#L142)

- E2E: a failed resolutions read affects the hours tile only.
  [`today.spec.ts:227`](../../e2e/tests/today/today.spec.ts#L227)

- Unit: every tile matrix row against Sati's and Godišnji's own figures.
  [`today-tiles.test.ts:173`](../../apps/web/src/features/today/services/today-tiles.test.ts#L173)

- New copy and the re-derived string pin.
  [`hr.json:46`](../../apps/web/src/lib/i18n/locales/hr.json#L46)
  [`prijava.test.ts:2185`](../../apps/web/src/pages/prijava.test.ts#L2185)
