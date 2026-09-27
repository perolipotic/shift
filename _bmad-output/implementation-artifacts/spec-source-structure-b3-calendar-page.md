---
title: 'Source structure B3 — the calendar screen becomes a thin page over features/calendar'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: '4f2bf48e0b4ea814812d78effaaeba979f8bbef5'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-source-structure-b2-organization-page.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `pages/kalendar.tsx` (983 lines) holds the calendar's search state, query, grid focus, day-detail dialog state and effect, ten handlers and sixteen `render*` helpers. The approved proposal wants a page that only composes.

**Approach:** Follow B1 and B2 (see B2's spec, Change Log and `settings-screen.fixture.ts`):
- state, handlers and the effect go into hooks in `features/calendar/hooks/`: a screen hook, and a day-detail hook if it is cleanly separable;
- sections go into components in `features/calendar/components/`: month nav, mode switch, filter, cell, legend, grid, day list, day-detail dialog and skeleton;
- leftover pure logic goes into `features/calendar/utils/`.

The page keeps `createRoute` (with `validateSearch: calendarSearchOf`) and the composition. The DOM, keyboard behaviour, focus return and every test outcome stay identical.

## Boundaries & Constraints

**Always:**
- The DOM, the keyboard grid navigation and the dialog focus return do not change.
- The `KalendarScreen` and `kalendarRoute` exports stay.
- Every guard keeps its meaning, with B1 and B2's scoping rules:
  - a shared `features/calendar/calendar-screen.fixture.ts` defines the screen's file set, used by `pages/prijava.test.ts` and `features/calendar/services/snapshot.test.ts`;
  - needles are asserted against the file that must hold them;
  - order and null checks read the handler text;
  - non-vacuity is checked per file with a size floor;
  - a completeness check asserts set equality over `components`, `hooks` and `utils`, with exemptions for the rule modules that are their own key sources;
  - `test/localization-applied.test.ts` derives the files from the folder.
- `snapshot.test.ts`'s "the calendar only reads" sweep keeps every rule for every file in the feature. The allowances that today match `kalendar.tsx` by `endsWith` move to the screen's file set:
  - `SCREEN_SHOWS` token counts are summed over the set and stay the same totals;
  - `MODIFIER_OVERRIDDEN` stays at exactly 2 across `month.ts` plus the set;
  - every file outside `month.ts` and the set keeps an allowance of 0;
  - the residual rank/position ban applies to every file.
- The fixture file lives inside the feature, so it obeys the sweep too: no `%`, no writes, no rank or position tokens.

**Ask First:**
- A guard whose count or assertion would have to change.
- Any DOM, focus or keyboard difference.

**Never:**
- No new UI.
- No change to `utils/{month,grid-keys,modifiers,day-detail}` or `services/snapshot` beyond moving inline helpers in.
- No barrels.
- No E2E change.
- The other screens are out of scope.

</frozen-after-approval>

## Code Map

(Line numbers may be off by a few lines.)

- `pages/kalendar.tsx`:
  - imports 1–89; doc 91–146;
  - module-level: `phone`/`isPhoneOnServer` 148–152, `SKELETON_*` 154–155, `translateCellLabel` 157;
  - `KalendarScreen` 159–976;
  - route 978–983.
- Hooks in the screen:
  - routing and data: `useSearch` 160, `useNavigate` 161, `useQuery(calendarQueryOptions…)` 162, `useMemo` outcome 178, `useSyncExternalStore` 188;
  - `useState`: `gridFocus` 195, `focusGrid` 200, `opened` 211, `closes` 212, `detailFor` 225;
  - refs: `gridRef` 207, `openerRef` 213, `armedRef` 214, `closeEventOwedRef` 218, `filterRef` 261;
  - memos: `shownDetail` 220, `labels` 263;
  - effect 244–259;
  - render-time resets 202–205 and 227–240.
- Handlers: `show` 265, `choose` 269, `filter` 273, `openDay` 278, `closeDay` 284, `closedByBrowser` 297, `openCell` 308, `remember` 380, `moveGridFocus` 394, `openOnKeyUp` 432.
- Render helpers, each ending at the next: `renderCellName` 316, `renderCellBox` 349, `renderCell` 447, `renderLegend` 478, `renderSwitch` 507, `renderFilter` 545, `renderDayButton` 605, `renderRoster` 623, `renderOverride` 655, `renderDetail` 690, `renderDay` 723, `renderDayList` 753, `renderDays` 783, `renderPerson` 789, `renderGrid` 800, `renderSkeleton` 869. The main JSX is 882–975.
- `features/calendar/services/snapshot.test.ts` ~950–1050 ("the calendar only reads"):
  - it reads every non-test `.ts`/`.tsx` under the feature plus `pages/kalendar.tsx`, comments stripped;
  - rules: no `'conflict'|'overridden'|'leave'|'uncovered'` literal; `MODIFIER_OVERRIDDEN` exactly 2 in `month.ts`/`kalendar.tsx` and 0 elsewhere; no `%`; no `.insert(|.update(|.delete(|.upsert(`; exact `SCREEN_SHOWS` counts for `kalendar.tsx`, listed below, and after removing those tokens no match for `/fire_?rank|fireRank|\brank\b|team_position|teamPosition|usesFireRanks/i`; no `queryKey: [` with contents.

  | token | count |
  |---|---|
  | `'@/features/members/utils/rank'` | 1 |
  | `usesFireRanks` | 6 |
  | `member.fireRank` | 1 |
  | `'@/features/members/utils/position'` | 1 |
  | `positionsShown` | 2 |
  | `rosterPositionMessageKey` | 2 |
  | `member.position` | 1 |

  The non-vacuity list requires month, snapshot, modifiers, grid-keys and day-detail.
- `pages/prijava.test.ts`:
  - `KALENDAR` (214) is a single path, used in `SCREENS` 494 (`expectedControls: 8`), `KEY_SOURCES` ~1827 (32 strings) and `SELECT_SCREENS` 3604 (14 `<Select>` in total, `className="h-11"`, no bare `<select>`);
  - no `componentFunction` or `namedHandler` targets it;
  - `source()` takes a `SourceSet`;
  - add a calendar completeness case like the members one (~2178) and the organization one (~2197).
- `test/localization-applied.test.ts:127,277-286`: replace the hand-listed calendar entries with a `calendarScreenParts()`-style derivation.
- `router.test.ts`: imports `KalendarScreen`/`kalendarRoute` and checks the id, the component and that `validateSearch` is defined. Unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `features/calendar/{hooks,components,utils}/` and `calendar-screen.fixture.ts` -- extract per the Code Map.
- [x] `pages/kalendar.tsx` -- compose only.
- [x] `features/calendar/services/snapshot.test.ts`, `pages/prijava.test.ts`, `test/localization-applied.test.ts` -- retarget to the set per Boundaries, with totals unchanged.

**Acceptance Criteria:**
- Given the page, when measured, then it is ≤ 150 lines with no `useQuery`, `useState`, `useRef`, `useMemo` or effect.
- Given each retargeted guard, when a planted mutation breaks its target in a moved file, then the guard fails. Spot-check at least:
  - a `usesFireRanks` in a calendar component outside the set;
  - one extra `MODIFIER_OVERRIDDEN` in a component;
  - a `%` in a component class;
  - a bare `<select>` in the filter component;
  - an extra `t()` in the legend.

  Revert each afterwards.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test`, the web build and `pnpm test:e2e` run, then all pass. Unit counts grow only by added cases, and E2E stays at 68/68. The calendar specs cover grid keyboard moves, the day detail and focus return.

## Spec Change Log

- Implementation note (no intent change):
  - Two hooks: `use-calendar-screen.ts` (the read, search-derived month and mode, grid focus, labels, filter ref and every handler) calls `use-day-detail.ts` (opened day, closes, opener and owed-close refs, the render-time close and the focus-return effect). The page passes the route's `search` and a `go` callback wrapping `useNavigate`, so the hook never imports the route.
  - Components: month nav, mode switch, filter, cell, legend, grid, day list (`CalendarDays`, `CalendarPerson`), day-detail dialog, skeleton, plus `calendar-month-body.tsx`, which chooses skeleton, day list, grid or person. It exists because a JSX ternary chain in the page reads as bare JSX text to `jsxTextWithContent`.
  - Utils: `cell-label.ts` (`translateCellLabel`) and `screen-keys.ts` (`gridFocusKeyOf`, `dayDetailKeyOf`, with `screen-keys.test.ts`).
  - The roster, override and detail renderers stay together as module functions in `day-detail-dialog.tsx`. After review, `snapshot.test.ts` pins every `SCREEN_SHOWS` token at its old count and exactly 2 `MODIFIER_OVERRIDDEN` to that file. Every other file in the set, and every file outside it, carries 0 of each (except `month.ts`'s 2 and the carriers' own lists). The rank/position ban applies everywhere.
  - `snapshot.test.ts` compares exact '/'-normalized paths (`utils/modifiers.ts`, `services/snapshot.ts`, `utils/day-detail.ts`, `utils/month.ts`), never suffixes.
  - Shared ids live in `utils/element-ids.ts` (legend, person heading, detail heading, roster and override); the month heading uses `MONTH_HEADING_ID`. The filter's `kalendar-filter` stays literal because `labelTargets` reads `htmlFor="…"`.
  - The fixture exempts `calendar-screen.fixture.ts`, `services/snapshot.ts`, `utils/element-ids.ts` and `utils/{month,modifiers,grid-keys,day-detail}.ts`. The completeness check walks the whole feature recursively, and `localization-applied.test.ts` asserts that `calendarScreenParts()` (recursive) holds every non-page part and the four rule modules.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shift/web build` -- expected: exit 0.
- `pnpm test` -- expected: pass. Rebuild first and record the baseline first.
- `pnpm test:e2e` -- expected: 68/68, with port 5173 free and not run in parallel with unit tests.

## Suggested Review Order

**The thin page**

- The page reads the search, hands the hook a `go` callback, and composes.
  [`kalendar.tsx:100`](../../apps/web/src/pages/kalendar.tsx#L100)

**Where the screen's state went**

- The screen hook: the read, the month and mode, grid focus and its render-time reset, and the keyboard handlers.
  [`use-calendar-screen.ts:56`](../../apps/web/src/features/calendar/hooks/use-calendar-screen.ts#L56)

- The day-detail hook: open and close, the owed close event, and the focus-return effect, using the grid ref it is given.
  [`use-day-detail.ts:19`](../../apps/web/src/features/calendar/hooks/use-day-detail.ts#L19)

- The one file allowed to carry the rank, position and override tokens.
  [`day-detail-dialog.tsx:132`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L132)

**Guards**

- The screen's file set and its exemptions, shared by both guard suites.
  [`calendar-screen.fixture.ts:1`](../../apps/web/src/features/calendar/calendar-screen.fixture.ts#L1)
