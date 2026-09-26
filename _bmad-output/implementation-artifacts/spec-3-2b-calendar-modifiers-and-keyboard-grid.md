---
title: 'Story 3.2b: Modifier marks, legend, keyboard grid and full cell labels'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'cc86448bb1b324ec537f9c928c6c0ad6520b5850'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The calendar has no modifier vocabulary (UX-DR8, UX-DR12), so 3.5, 3.6 and Epics 4–5 would each invent their own marks. A keyboard cannot move through the grid, and a screen reader hears a bare type name without the date, team or times (Q22, UX-DR39).

**Approach:**
- Add a fixed set of four modifiers that can be combined on any cell. Each one has a glyph, a fill or ring, and a label.
- Add a legend that shows only while a mark is on screen.
- Make the grid an ARIA grid with one tab stop.
- Give every cell a full label.

No data source adds a modifier yet, so every cell carries `modifiers: []` for now.

## Boundaries & Constraints

**Always:**
- **Vocabulary (`apps/web/src/calendar/modifiers.ts`):**
  - `CALENDAR_MODIFIERS` lists `conflict`, `overridden`, `leave` and `uncovered`, always in that order. Each entry has a glyph (`⚠ ✎ ◷ ◌`) and a label key `kalendar.modifier.*` (Konflikt, Izmijenjeno, Godišnji, Nepokriveno).
  - Each entry also has a treatment:
    - conflict: a 2 px inset `destructive` ring;
    - overridden: a 2 px inset `modifier-overridden` ring;
    - leave: the `modifier-leave` hatch at −45°;
    - uncovered: the `modifier-uncovered` hatch at 45°.
  - A pure `modifierTreatmentOf(modifiers)` returns the classes and the glyphs, in canonical order and with duplicates removed.
  - Any subset composes. Both rings stay visible together, both hatches stay visible together, and each overlays the type's base fill.
  - Never colour alone: every modifier has a glyph and a label.
- **Cells:** `CalendarCell` gains `modifiers`, which is always `[]` in this story.
  - One shared renderer draws a cell in the grid, the compressed grid and the day list.
  - Glyphs sit next to the name or letter and are `aria-hidden`.
  - A compressed cell stays ≥ 44 × 44 px with glyphs.
- **Legend:** a pure `legendOf(cells)` returns the modifiers present, in canonical order.
  - When that list is non-empty, a visible list of glyph + label renders above the grid or day list for the mode shown.
  - When it is empty, nothing renders: no tooltip, no info icon.
- **Label:** a pure `cellLabelOf` joins, with `, `:
  - the weekday and date;
  - the team's full name;
  - the type name, or `kalendar.noRotation`;
  - the range when there is one;
  - each modifier's label.

  It never uses a letter. The label reads the same at every width.
- **Keyboard grid (full and compressed):**
  - The table has `role="grid"`, and the data cells are `gridcell` with `aria-label` = `cellLabelOf`. Their visual body is `aria-hidden`. Column and row headers keep their names.
  - Exactly one cell has `tabIndex=0`: today's first-team cell when the month shows today, otherwise the first cell. Every other cell is `-1`.
  - Keys:
    - arrows move one cell and stop at the edges;
    - Home/End go to the start or end of the row;
    - Ctrl+Home/Ctrl+End go to the first or last cell of the month;
    - each handled key calls `preventDefault` and moves DOM focus.
  - The move is a pure `gridFocusAfter(key, ctrl, position, size)` that returns a position, or `null` when the key is not handled.
  - The focused position survives re-renders and resets when the month changes.
  - Enter and Space do nothing until 3.4.
- The focus ring is visible, and nothing scrolls the page sideways at 320 px.
- **Text:** `kalendar.modifier.*` and `kalendar.legend` ("Oznake") go in `hr.json` and are registered in the inventories.

**Ask First:** any migration, query or data source that produces a modifier; changing the one read; changing the 3.1 layout at ≥ 640 px beyond focus rings and the legend.

**Never:**
- deriving any modifier from real data (3.5, 3.6, Epics 4–5);
- keyboard navigation in the day list (it stays an `<ol>`);
- a sticky header row (it stays deferred: `Table`'s own `overflow-auto` wrapper would need a height);
- filters and day detail;
- the accent colour, or `destructive` for anything but conflict;
- new tokens beyond hatch utilities over the existing `--modifier-*` variables;
- new dependencies, render tests, or `localStorage`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Label, working | Sat 26.09., Smjena A, Noć | `subota 26.09., Smjena A, Noć, 19:00–07:00` | N/A |
| Label, off / none | Slobodno; no rotation | `…, Smjena B, Slobodno`; `…, Smjena A, Bez rotacije` | N/A |
| Label, modifiers | `['leave','conflict']` | `…, Konflikt, Godišnji` | N/A |
| Compose | `['overridden','conflict','conflict']` | both rings, glyphs `⚠✎` | N/A |
| Legend | no modifiers / `['uncovered']` on one cell | `[]`, no legend / `['uncovered']` | N/A |
| Keys | (0,0) ←, ↑ / End / Ctrl+End / Tab / Enter | (0,0) / (0,last) / (lastRow,lastCol) / `null` | N/A |
| Initial stop | month shows today / other month | today's row, col 0 / (0,0) | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/calendar/month.ts:299` -- `CalendarCell` (add `modifiers`), `cellOf` :414 (sets `[]`), `CALENDAR_CELL_CLASS` :151, `COMPRESSED_CELL_CLASS` :159, and `CalendarRow`/`CalendarDay` :313/:331 (`dayMonth` and `weekday` feed the label). Tests are in `month.test.ts`.
- `apps/web/src/calendar/modifiers.ts` (new), plus `modifiers.test.ts` -- the vocabulary, treatment, legend and label.
- `apps/web/src/calendar/grid-keys.ts` (new), plus `grid-keys.test.ts` -- `gridFocusAfter` and the initial position. There is no precedent for a roving tabindex in `apps/web/src`, so keep the rules in `.ts` as `rotation/stepper.ts` does.
- `apps/web/src/routes/kalendar.tsx` -- `renderCellBody` :99 becomes the shared renderer. Also `renderCell` :127, `renderDay` :165, `renderGrid` :213 (the `Table` gets `role="grid"` and a key handler), and the legend next to the grid and the day list. Refs for focus hold one per cell or use `data-row`/`data-col` lookups.
- `apps/web/src/index.css:202-206,274-278,347-351` -- the `--modifier-*` tokens. The only hatch is `@utility hatch-uncovered` :411, used by `components/ui/timeline.tsx:99` and asserted by `prijava.test.ts:3076`; keep it, and add composable hatch or ring utilities beside it. `organization/accent.test.ts:271` forbids `modifier-` in the accent output.
- `apps/web/src/i18n/locales/hr.json` -- the `kalendar` object. `Nepokriveno` exists at :244 in another namespace.
- Inventories:
  - `test/resource-hygiene.test.ts:885-900` -- the kalendar keys;
  - `test/localization-applied.test.ts:48-254` -- `SOURCES`, where the new `.ts` files go;
  - `:979-987` `AUTHORED_VOCABULARY` -- the counts for new words (`Oznake`, `Konflikt`, `Izmijenjeno`);
  - `apps/web/src/routes/prijava.test.ts:426` -- the controls, still 5;
  - `:1737-1747` -- the kalendar string count, now 13 plus the new keys.
- `e2e/calendar.spec.ts` -- `cellOf` :101 uses `getByRole('cell')` and becomes `gridcell`, which is shared with :356 and the tap-target checks. `letterOf` :295 reads the first `aria-hidden`, which must still be the letter. The organizations counter is at :189.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/calendar/modifiers.ts`, `modifiers.test.ts` -- vocabulary, `modifierTreatmentOf`, `legendOf`, `cellLabelOf`; tests cover every matrix row, every subset of the four modifiers composing, and a glyph plus a label for each modifier.
- [x] `apps/web/src/calendar/grid-keys.ts`, `grid-keys.test.ts` -- `gridFocusAfter` and `initialGridFocusOf`; tests cover every key at the corners, the edges and the middle, a 1×1 grid, and unhandled keys.
- [x] `apps/web/src/calendar/month.ts`, `month.test.ts` -- `modifiers: []` on every cell, and labels built from rows, columns and cells.
- [x] `apps/web/src/index.css` -- ring and hatch utilities for leave and uncovered that compose, in light and dark.
- [x] `apps/web/src/routes/kalendar.tsx` -- the shared cell renderer with glyphs, the legend, `role="grid"`, the roving tabindex, the key handler and `gridcell` labels.
- [x] `apps/web/src/i18n/locales/hr.json` -- `kalendar.legend` and `kalendar.modifier.{conflict,overridden,leave,uncovered}`.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` -- register the new keys, words and sources.
- [x] `e2e/calendar.spec.ts`:
  - the grid is `role=grid` with one tab stop, which starts on today;
  - arrows, Home, End and Ctrl+End move focus at 1280 px and at 390 px;
  - a gridcell's name holds the date, the team, the type and the range;
  - no legend without marks;
  - existing tests move to `gridcell`.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `3-2-…: done`, and the comment notes that both parts have landed.

**Acceptance Criteria:**
- Given the calendar at any width, when Tab enters the grid, then focus lands on one gridcell, and a second Tab leaves the grid.
- Given the compressed grid at 390 px, when a screen reader reads a cell, then it hears the full label and never a bare letter.
- Given `apps/web/src/calendar` and `kalendar.tsx`, when they are swept, then no modifier is derived from snapshot data, there is still one `organizations` select, and there are no writes.

## Design Notes

**Why an empty vocabulary ships now.** Later stories each name their own marks, so they would drift apart. Fixing the set, the treatment and the legend here means 3.5 only writes `modifiers: ['overridden']`. The legend's "only while a mark is on screen" rule means nothing new is visible today. Unit tests carry the proof instead.

**Composing treatments.** Rings are inset `box-shadow`s, so two of them stack as nested 2 px bands (`inset 0 0 0 2px …, inset 0 0 0 4px …`). Hatches are `background-image` layers over the `bg-*` base colour, so two of them layer. Use a per-cell CSS variable or precomposed utilities; either way the classes are picked in `modifiers.ts`.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above the baseline.
- `pnpm test:e2e` -- green. Stop Vite on 5173 first, and do not run it alongside `pnpm test`.
- `git diff --stat supabase/ package.json pnpm-lock.yaml` -- empty.

**Manual checks:**
- Demo org at 320, 390 and 1280 px: Tab and the arrows move through the grid, and the focus ring is visible. With VoiceOver on, a compressed cell reads the full label.

## Suggested Review Order

**The fixed modifier vocabulary**

- Entry point: four marks, fixed order, each with glyph, treatment and label key.
  [`modifiers.ts:51`](../../apps/web/src/calendar/modifiers.ts#L51)

- Any subset composes into one ring class and one hatch class, canonical and deduplicated.
  [`modifiers.ts:145`](../../apps/web/src/calendar/modifiers.ts#L145)

- Stacked rings and layered hatches, over the existing `--modifier-*` tokens only.
  [`index.css:455`](../../apps/web/src/index.css#L455)

- Every cell carries the empty list; nothing derives a modifier yet.
  [`month.ts:446`](../../apps/web/src/calendar/month.ts#L446)

**Labels and legend**

- The full label: date, team, type or no rotation, range, modifiers — never a letter.
  [`modifiers.ts:212`](../../apps/web/src/calendar/modifiers.ts#L212)

- Labels per month throw on a cell without a column instead of naming nobody.
  [`modifiers.ts:239`](../../apps/web/src/calendar/modifiers.ts#L239)

- Legend only from the marks actually shown; nothing renders when there are none.
  [`kalendar.tsx:282`](../../apps/web/src/routes/kalendar.tsx#L282)

- One cell renderer for the grid, compressed grid and day list; glyphs text-style.
  [`kalendar.tsx:187`](../../apps/web/src/routes/kalendar.tsx#L187)

**The keyboard grid**

- Pure moves: arrows stop at edges, Home/End, Ctrl only with Home/End, Alt/Meta/Shift ignored.
  [`grid-keys.ts:66`](../../apps/web/src/calendar/grid-keys.ts#L66)

- The one tab stop: remembered within a month, today or the first cell otherwise.
  [`grid-keys.ts:151`](../../apps/web/src/calendar/grid-keys.ts#L151)

- Read-only `role="grid"`; the handler moves from the focused cell's `data-row`/`data-column`.
  [`kalendar.tsx:401`](../../apps/web/src/routes/kalendar.tsx#L401)

- The remembered stop is forgotten whenever the shown month changes.
  [`kalendar.tsx:138`](../../apps/web/src/routes/kalendar.tsx#L138)

**Peripherals**

- Unit tests: every modifier subset, labels, legend, and the key matrix.
  [`modifiers.test.ts:1`](../../apps/web/src/calendar/modifiers.test.ts#L1)
  [`grid-keys.test.ts:1`](../../apps/web/src/calendar/grid-keys.test.ts#L1)

- E2E at 1280 and 390 px: one tab stop, keys, labels, reset on a month change.
  [`calendar.spec.ts:452`](../../e2e/calendar.spec.ts#L452)

- Copy: `kalendar.legend` and `kalendar.modifier.*`.
  [`hr.json:44`](../../apps/web/src/i18n/locales/hr.json#L44)
