---
title: 'The calendar keeps its team header and the focused cell in view, loads in the shape it will show, and keeps its modifiers under forced colours'
type: 'bugfix'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '2f85a699f7b8e81ecd553e1e866abde2f30ca6a2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The deferred-work triage on 2026-09-27 put four calendar entries still open on main into "package 3c":
1. **Team header scrolls away** ("The calendar's team header row is not sticky, so the team names scroll out of view in a 28–31-row month on a phone or short window"). Only the date column is `sticky left-0`.
2. **Focused cell hidden** ("When the grid is scrolled sideways, a cell that receives keyboard focus can sit under the sticky date column…"). `cell.focus()` runs with no `scroll-margin` or `scrollIntoView` offset.
3. **Layout jumps on load** ("While the calendar loads, the skeleton is always the grid shape and the mode switch is absent…"). A member who lands on the day list sees the layout jump.
4. **Modifiers lost under forced colours** ("Under `forced-colors: active` (Windows High Contrast) the `box-shadow` modifier rings and the background-image hatches are dropped…").

**Approach:**
- **Team header:** make the grid's header row sticky at the top inside the scroll container, and make the corner cell sticky on both axes. Z-order: corner, then header, then date column, then cells.
- **Focused cell:** give grid cells a `scroll-margin-left` (and a `scroll-margin-top` for the new sticky header) equal to the sticky column's width and the header's height. Also use `scrollIntoView({ block: 'nearest', inline: 'nearest' })` after focus if margins alone do not work.
- **Skeleton:** choose the skeleton's shape from the default mode the screen will show.
  - If the role is already cached (the chrome's `MEMBER_ROLE_KEY`) and the rule that picks the default mode can run without the snapshot, use it to show the day-list skeleton for a member.
  - If it cannot run without the snapshot, keep the grid skeleton and record why.
- **Forced colours:** add an `@media (forced-colors: active)` fallback for the `modifier-ring-*` and `modifier-hatch-*` utilities, e.g. an `outline` in `CanvasText` / `Highlight` and a border style for hatches, so the treatment survives.

## Boundaries & Constraints

**Always:**
- **Tests:**
  - An E2E test on a phone and a short viewport: after scrolling down, the team header is still visible, meaning its bounding box stays within the scroll container.
  - An E2E test: keyboard focus moved to a cell under the sticky column ends with the cell fully visible.
  - A unit test for the skeleton-shape choice.
  - A CSS or source test that the forced-colours fallback exists for each modifier utility. Add Playwright `forcedColors` emulation if feasible.
- The existing calendar keyboard, legend, contrast and responsive tests keep passing.
- Mutation-prove every new test.
- Remove the deferred-work entries this closes.

**Ask First:**
- Any new i18n text.
- Any change to the calendar's data reads or keys.

**Never:**
- No change to the domain projection or SQL.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/calendar/components/calendar-grid.tsx` -- `sticky left-0` date column, header row.
- `apps/web/src/features/calendar/hooks/use-calendar-screen.ts` (or similar) -- focus handling (`cell.focus()`) and the default mode.
- `apps/web/src/features/calendar/components/*skeleton*` -- `CalendarSkeleton`.
- `apps/web/src/index.css` or the theme CSS -- `modifier-ring-*`, `modifier-hatch-*`.
- `features/navigation` -- `MEMBER_ROLE_KEY`.
- `e2e/tests/calendar/`, `e2e/tests/layout/responsive.spec.ts`, `e2e/pages/calendar.page.ts`.
- `test/theme-*.test.ts` -- CSS source tests.

## Tasks & Acceptance

**Execution:**
- [x] Make the team header sticky.
- [x] Keep the focused cell in view.
- [x] Choose the skeleton shape from the default mode.
- [x] Add the forced-colours fallback.
- [x] Add the tests and clean up `deferred-work.md`.

**Acceptance Criteria:**
- Given each fix reverted, when the new tests run, then they fail.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test` (after a web build) and `pnpm test:e2e` run twice, then all pass.

## Spec Change Log

- **Bounded, isolated scroller (team header).** The table primitive's wrapper was the only scroller and had no height, so the page scrolled vertically and `sticky top-0` had nothing to stick in. The grid now wraps `<Table>` in a plain, non-scrolling `div`: `isolate [&>div]:max-h-[70svh] print:[&>div]:max-h-none print:[&>div]:overflow-visible`.
  - `svh`, not `dvh`, so the bound does not resize while a phone's toolbar slides.
  - `isolate` keeps the sticky cells' `z-*` layers inside the grid, so they never paint over the chrome's `sticky bottom-0` phone bar. The bar has no z-index and is unchanged.
  - The bound is lifted in print, so a printed month is whole.
  - `table.tsx` is unchanged: its `<div className="…overflow-auto…">` source guard in `prijava.test.ts` and the "one scroller" rule hold.
- **Every focus source is revealed.** Chrome's own focus scroll ignores `scroll-margin`. So the cell's `onFocus` calls `useCalendarScreen`'s `reveal`, which runs `scrollIntoView(GRID_REVEAL)` (`{ block: 'nearest', inline: 'nearest' }`, in `utils/grid-keys.ts`) while the cell matches `:focus-visible` (`FOCUS_VISIBLE`).
  - This covers the arrow keys, Tab, the day detail returning focus on close (a 3.5b override save included), and the tab-stop fallback.
  - The arrow path focuses with `preventScroll`, so `onFocus` is its only scroll.
  - A pointer focus is not revealed, so a cell never moves out from under a click in progress.
  - The options are named constants because the Kalendar literal sweep refuses string literals in the screen parts.
- **The margins are the sizes.** The date column is `w-28 min-w-28` and cells carry `scroll-ml-28`. Both header cells are `h-11` and cells carry `scroll-mt-11`. Source and runtime tests hold the pairs together.
  - This makes the date column 112 px, wider than its natural ~98 px.
  - The header is 44 px, up from 40.
- **The phone bar is cleared.** `html` has `scroll-padding-bottom: calc(4rem + env(safe-area-inset-bottom, 0px))` below 640 px and `0` from 640 px up. This is the space the content above the bar already clears, so a `scrollIntoView` stops above the bar.
- **The cached role is observed, not read.** The hook subscribes to the query cache (`useSyncExternalStore` over `QueryCache.subscribe`) and reads `getQueryData(MEMBER_ROLE_KEY)` through `cachedRoleOf`. It adds no `useQuery`, no fetch and no key, so the calendar still makes its one read. A source guard now holds this: exactly one `useQuery(`, and no `fetchQuery`, `ensureQueryData`, `prefetchQuery`, `fetchInfiniteQuery` or `refetchQueries`.
  - A second `useQuery` on the key with `skipToken` was rejected. TanStack 5 copies an observer's options onto the shared query, which could leave the chrome's refetches without a `queryFn`.
- **Early mode: the switch and the skeleton.** `earlyCalendarModeOf(search, cachedRole, isPhone)` is the mode the URL names, or the default for the cached role, or `null`. While the snapshot is pending, the hook's `mode` is that value.
  - So `kalendar.tsx`, unchanged, renders the mode switch during load as soon as the role is cached.
  - `calendarSkeletonShapeOf` uses the same early mode. It also shows the day list for a chosen `osoba`: an unknown person id still jumps to the grid when the snapshot lands, which only a hand-edited URL produces.
  - The deferred mode-switch entry added in the first pass is removed.
- **Forced colours.**
  - The six modifier fallbacks stay as they are, except the conflict-plus-overridden double band. It is now `4px double`, offset `-4px`: no deeper than the cell's 4 px padding, so it no longer covers the label.
  - The sticky header cells get a `forced-colors:` `border-b` in `CanvasText`, because their inset box-shadow separator is dropped.
  - The focused cell uses `outline-hidden` instead of `outline-none`. The base layer's `*:focus-visible` forced-colours outline, from before this change, already showed focus. Each protection alone keeps it visible, and removing both hides it (mutants F7a–F7c).
- **Deterministic widened grid.** The E2E helper builds each fake team from the team columns alone (`organization_id`, `id`, `name`, `archived`) and names them `Širina 01`…`12`. These sort after every `S…` name under the Croatian collation, so real teams keep the first columns and the order is fixed.
- **New files.** `utils/skeleton.ts` (and its test) is listed in `CALENDAR_SCREEN_EXEMPT`, as the other pure `utils/` modules are. `features/calendar/calendar-layout.test.ts` holds the source guards. The E2E tests are in `e2e/tests/calendar/layout.spec.ts`.
- **Dropped.** The `GRID_REVEAL` unit test that restated the constant is gone. `GRID_REVEAL` is pinned by behaviour: the "least scroll" check in the keys E2E test, mutants F2b and F2g.

## Verification

**Commands** (all under the `e2e.lock` mutex, on `a0e8a1c` rebased onto main with 3.5b):
- `pnpm typecheck`, `pnpm lint` -- expected: exit 0. Result: exit 0.
- `pnpm test` after a build -- expected: pass. Result:
  - Web: 256 + 2690 pass. Before this round the web count was 2685: +2 `earlyCalendarModeOf`, +4 `calendar-layout.test.ts`, −1 restating `GRID_REVEAL` test.
  - Root: 3141 of 3145 pass. The 4 failures are in `test/rls-isolation.test.ts`, "a shift-type override … (story 3.5a)". They fail because the answer has one more column than expected.
  - The cause is the shared stack. It carries another session's untracked migration `supabase/migrations/0022_shift_type_override_disposition.sql`, which is in the main checkout and not in this branch.
  - They fail the same way with this change stashed, and this change touches no SQL or read.
- `pnpm test:e2e`, run twice -- expected: pass. Result: 96 passed both runs (92 before this round; `layout.spec.ts` grew from 5 to 9 tests).

**Mutation proof** (each planted, the test run, then restored; scripts in `scratchpad/calendar-layout/`):

| Id | Mutant | Test | Result |
| --- | --- | --- | --- |
| F1 | wrapper without `isolate` | E2E sticky layers | killed: "the grid paints over the bottom bar" |
| F1s | same | `calendar-layout.test.ts` | killed |
| F2 | no `html` `scroll-padding-bottom` | E2E keys | killed: "ArrowDown to row 7 … hidden past its bar edge" |
| F3 | `onFocus` does not call `reveal` | E2E keys; Tab and close | killed: "End … right edge"; "Tab … left edge" |
| F4a | date column `w-32`/`min-w-32` (margin 28) | E2E margins at least the sizes | killed |
| F4b | header cells `h-14` (margin 11) | E2E margins | killed |
| F4c | `scroll-ml-24` | `calendar-layout.test.ts` | killed |
| F4d | `scroll-mt-10` | `calendar-layout.test.ts` | killed |
| F4e | team header without `h-11` | `calendar-layout.test.ts` | killed |
| F5 | `max-h-[70dvh]` | `calendar-layout.test.ts` | killed |
| F6 | no `print:` lift | `calendar-layout.test.ts` | killed |
| F7a | `outline-hidden` back to `outline-none` | E2E forced focus | survived: the base forced-colours `*:focus-visible` rule still draws focus (redundant protection) |
| F7b | `outline-none` and no base forced-colours focus rule | E2E forced focus | killed: "the focused cell shows no focus under forced colours" |
| F7c | `outline-hidden` kept, no base rule | E2E forced focus | survived: `outline-hidden` alone keeps it (redundant protection) |
| F8 | header cells without `forced-colors:border-b` | E2E forced header edge | killed |
| F9 | double band back to `6px`/`-6px` | E2E forced treatments | killed: "covers the label" |
| F10 | no early mode (`null` while pending) | E2E pending | killed: switch not found after the role lands |
| F11a | corner without `z-30` | E2E sticky layers | killed: "something paints over the corner" |
| F11b | team header without `z-20` | E2E sticky layers | survived, equivalent: the cells hold nothing positioned, so a sticky `z-auto` header already paints over them, and the header and date column never overlap |
| F11c | date column without `z-10` | E2E sticky layers | survived, equivalent: same reason |
| F11d | corner without `top-0` | E2E sticky layers | killed: "the corner left the scroller's top edge" |
| F11e | corner without `left-0` | E2E sticky layers | killed: "… left edge" |
| F11f | team header without `bg-muted` | E2E sticky layers | killed: "shows what scrolls under it" |
| F11g | corner without `bg-muted` | E2E sticky layers | killed |
| F13 | no-op cache `subscribe` | E2E pending | killed: 150 grid bars after the role lands |
| F14a | a `prefetchQuery` in the hook | `calendar-layout.test.ts` | killed |
| F14b | a second `useQuery(` in the hook | `calendar-layout.test.ts` | killed |
| M1 | team header without `sticky top-0 z-20` | E2E team header ×2 | killed |
| M1b | no `max-h` bound | E2E team header ×2 | killed |
| M2a | no scroll margins | E2E keys, Tab, margins | killed |
| F2b | `scrollIntoView()` (block `start`) | E2E keys, least scroll | killed: "a step to a cell in view scrolled the grid" |
| F2g | `scrollIntoView` centred | E2E keys, least scroll | killed |
| M2d | no `scroll-mt-11` | E2E keys | killed: "ArrowUp to row 19 … top edge" |
| M2e | no `scroll-ml-28` | E2E keys | killed: "ArrowLeft to column 8 … left edge" |
| M2f | arrows focus without `preventScroll` | E2E keys | survived, equivalent: the browser's scroll and `reveal` run in one task, so there is one paint, one coalesced `scroll` event and the same final position |
| M3a | hook passes `null` for the cached role | E2E pending | killed |
| M3b | `CalendarSkeleton` ignores `shape` | E2E pending | killed |
| M4a | overridden ring's fallback removed | E2E forced treatments | killed |
| M4b | uncovered hatch's fallback removed | E2E forced treatments | killed |
| U1 | `earlyCalendarModeOf` ignores the role | `skeleton.test.ts` | killed (3 tests) |
| U2 | shape ignores `osoba` | `skeleton.test.ts` | killed |
| U3 | `cachedRoleOf` ignores `ok` | `skeleton.test.ts` | killed |
| U6 | early mode ignores the URL's `prikaz` | `skeleton.test.ts` | killed (2 tests) |
| C1 | leave hatch's fallback removed | `theme-tokens.test.ts` | killed |
| C2 | conflict ring's fallback in `var(--destructive)` | `theme-tokens.test.ts` | killed |
| C3 | overridden ring drawn like conflict's | `theme-tokens.test.ts` | killed |

## Suggested Review Order

1. `apps/web/src/features/calendar/components/calendar-grid.tsx`: the isolated, `svh`-bounded, print-lifted scroller; the sticky corner, header and date column with their sizes and z-order; `forced-colors:` header edge; `outline-hidden`; `onFocus` → `reveal`.
2. `apps/web/src/features/calendar/hooks/use-calendar-screen.ts` and `utils/grid-keys.ts` (`GRID_REVEAL`, `FOCUS_VISIBLE`). `reveal`; the arrow path's `preventScroll`; the cached-role store; the early `mode`.
3. `apps/web/src/features/calendar/utils/skeleton.ts` and its test: `cachedRoleOf`, `earlyCalendarModeOf` and `calendarSkeletonShapeOf`. Then `components/calendar-skeleton.tsx`, `components/calendar-month-body.tsx` and the exemption in `calendar-screen.fixture.ts`.
4. `apps/web/src/index.css`: the `html` bottom scroll padding and the six forced-colours fallbacks (the double band now 4 px). Then `test/theme-tokens.test.ts` and `features/calendar/calendar-layout.test.ts`.
5. `e2e/tests/calendar/layout.spec.ts`.
6. `_bmad-output/implementation-artifacts/deferred-work.md`: four entries removed.
