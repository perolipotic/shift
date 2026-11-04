---
title: 'Story 11.3: The calendar day marks a short-staffed shift'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: 'c61eda325d4e10bbb872c6f296ac7b4cf4b3ec7c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-11-2-every-save-that-can-cause-it-shows-a-short-staffed-shift.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An admin learns that a shift is short of people only when a save warns (11.2). The calendar shows nothing, so a shortfall already standing stays hidden until the day.

**Approach:** The admin's marks carry the organization's leave while *Najmanje ljudi u smjeni* is set. The month derives its short-staffed shifts through `shortStaffedShiftsOf` and sets a fifth modifier, `shortStaffed`, on those grid cells. The modifier has a `UsersThreeBold` glyph, a 3 px `warning` bar inside the bottom edge, a legend entry and a label. The day detail states `rade 2 od najmanje 3`. A new `warning` token is defined, and 11.2's block takes it.

## Boundaries & Constraints

**Always:**
- The `warning` token: light `#BF6A14`, dark `#F59145`, OKLCH in `index.css`, plus `--color-warning`. Pinned in `test/theme-contrast.test.ts`:
  - against every `FILLS` slot, `card` and `muted`: 3:1 or more (light worst 3.30, dark worst 4.71);
  - against `destructive`: ΔE2000 25 or more (25.2 / 26.1);
  - added to the accent `SIGNALS`, so every accent stays ΔE 10 or more from it.
  - The token has no foreground. No text ever sits on it.
- Vocabulary: `shortStaffed` is fifth in canonical order, label `Premalo ljudi`.
  - Its treatment is a new `edge`. It is an inset box-shadow, precomposed with the rings so that it is always the innermost band. The ring utilities grow from 3 to 7, `ringClassOf` grows to match, and every one has a forced-colours fallback.
  - Its glyph is drawn in the cell's `currentColor`, like every other glyph.
- Derivation:
  - `CalendarMarks.staffingLeave` holds the parsed organization records for an admin whose minimum is set. It is `null` for a member or when the setting is empty.
  - `calendarMonthOf` runs `shortStaffedShiftsOf(staffingInputOf(…))` over the month's dates and marks grid cells only. Day-list cells never carry the mark, as `uncovered`.
  - A `RangeError` makes the calendar unavailable. That is the existing guard.
- Day detail: on an admin's working shift with the minimum set, one line under *Sastav* gives `peopleAtWorkOn` against the minimum, read from the same records. While the shift is short, the line adds `UsersThree` in `text-warning` and `Premalo ljudi:`. The words carry the meaning.
- Empty setting (the 11.3 half of the deferral): no mark, no legend entry, no day-detail line. Asserted.
- 11.2's block takes `border-warning` and a `text-warning` glyph. The strip glyph takes `text-warning`. Every text stays `foreground`.

**Ask First:** a ring or hatch for short-staffed; numbers in the cell label; the mark outside the grid.

**Never:** `destructive` or the accent for short-staffed. A glass class on a cell. Staffing arithmetic outside `domain/staffing`. Anything stored. A migration or `db reset`. The *Danas* count (11.4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Short | team of 4, min 3, two on leave 14.10. | cell `…, Dan, 07:00–19:00, Premalo ljudi`, glyph and bar; legend `Premalo ljudi`; detail `Premalo ljudi: rade 2 od najmanje 3` | N/A |
| Not short | one on leave | no mark; detail `rade 3 od najmanje 3` | N/A |
| Composed | short + conflict + overridden | both rings, then the bar inside them; three glyphs | N/A |
| Non-working / member | off day, or a member viewer | no mark, no line | N/A |
| Empty | minimum `null` | nothing anywhere | N/A |
| Refused data | `RangeError` | calendar unavailable | logged |

## Epic AC Deviations

- *"its cell carries a fifth glyph and the `warning` token"* is **reinterpreted**. The token is the bar, and the glyph stays `currentColor`. A warning-coloured glyph cannot reach 3:1 on every fill, while each cell glyph already does in its own foreground.
- *"an admin's calendar"* is **narrowed** to the grid. The admin's person view and *Moj raspored* do not carry the mark, matching `uncovered`.
- **Extended:** *Danas* "Ovaj tjedan" draws the calendar's cells, so it carries the mark. The day-detail line shows on every working shift while the setting is set, not only on short ones. 11.2's block and strip take the token, as 11.2 decided.

</frozen-after-approval>

## Code Map

- `packages/domain/src/staffing.ts` -- `shortStaffedShiftsOf`, `peopleAtWorkOn`, `isShortStaffed`. Read-only.
- `apps/web/src/features/staffing/services/short-staffed.ts:107,126` -- `minimumOfCalendar`, `staffingInputOf`. Reuse both.
- `apps/web/src/features/calendar/services/marks.ts:80` `calendarMarksOf` -- the admin branch already parses `records`.
- `apps/web/src/features/calendar/utils/month.ts:538` `CalendarMarks`, `NO_MARKS`, :576 `marksLookupOf`, :604 `cellModifiersOf`, :621 `gridCellMarksOf`, :1180 `calendarMonthOf`.
- `apps/web/src/features/calendar/utils/modifiers.ts` -- vocabulary, `ringClassOf`, `modifierMessageKey`, the labels.
- `apps/web/src/features/calendar/components/calendar-legend.tsx`, `calendar-cell.tsx`, `modifier-glyphs.tsx` -- render whatever the vocabulary gives.
- `apps/web/src/features/calendar/components/day-detail-dialog.tsx:364` -- the working branch, under the *Sastav* heading. `hooks/use-calendar-screen.ts:233` -- `marks`.
- `apps/web/src/index.css` -- tokens :289/:373, `@theme` :445, rings :828.
- `apps/web/src/components/ui/icon.tsx` -- add `UsersThreeBold` (`bold/users-three-bold.svg`).
- `apps/web/src/features/today/services/admin-today.ts:390` -- the week inherits the mark. Update its tests where they pin the marks.
- Pins: `test/theme-contrast.test.ts`, `test/theme-fidelity.test.ts:93` (24 to 25 names), `test/theme-css.ts` `BRAND_TOKENS`, `test/typography-coverage.test.ts:427,497` (the bold-icon allow-list, and a shape distinct from clock and dashed).
- `hr.json` -- `kalendar.modifier` :432, `popunjenost` :1719.

## Tasks & Acceptance

**Execution:**
- [x] `DESIGN.md` front matter and `index.css` -- the `warning` token in light and dark, and `--color-warning`.
- [x] `test/theme-*.test.ts`, `theme-css.ts` -- the counts and pins listed under Always, with a non-vacuity case.
- [x] `index.css` -- the edge utility and its ring compositions, each with a forced-colours fallback.
- [x] `icon.tsx`, `typography-coverage.test.ts` -- add `UsersThreeBold` and prove its shape.
- [x] `modifiers.ts` (+test) -- the fifth modifier and the 7-way ring class.
- [x] `marks.ts`, `month.ts` (+tests) -- `staffingLeave` and the grid marks. Run every matrix row under both fixtures.
- [x] `day-detail-dialog.tsx`, plus a pure `dayStaffingOf` in `staffing/services/short-staffed.ts` (+test) -- the line.
- [x] `short-staffed-block.tsx`, `resolution-option.tsx` -- the token.
- [x] `hr.json` and the inventories -- `kalendar.modifier.shortStaffed`.
- [x] `e2e/tests/calendar/` -- with the minimum set and two people on leave, the cell's label and the legend name it and the detail states it. With the setting empty, none of them do.
- [x] Docs:
  - `epics.md`: UX-DR4, 8, 12 and 48 as shipped.
  - `DESIGN.md`: §Colors (a *warning* paragraph), `shift-cell-short-staffed`, and the modifiers row.
  - `EXPERIENCE.md`: :104 and :137.
  - `deferred-work.md` :1249: mark it RESOLVED by 11.3.

**Acceptance Criteria:**
- Given an admin's grid with a short shift, when it renders, then the cell shows the glyph and the bar, its label ends with `Premalo ljudi`, and the legend lists it.
- Given the merged change, when `pnpm test` runs, then the token is pinned in both themes, and the docs describe what shipped.

## Spec Change Log

## Design Notes

The hue is orange, about 58° light and 55° dark. It sits between `destructive` (about 20°) and the amber signals (68–95°), which leaves a light window of roughly 0.16–0.26 in relative luminance. Every candidate there was measured, and `#BF6A14` / `#F59145` were the best balance of fill contrast and distance from the other signals. The bar is precomposed with the rings rather than drawn as a pseudo-element, so it sits inside any ring and never covers the conflict's band.

## Verification

**Commands:**
- `pnpm --filter ./apps/web test && pnpm test && pnpm lint && pnpm typecheck` -- expected: green. E2E runs in CI.

## Suggested Review Order

**The derivation (one domain call, grid cells only)**

- Entry point: the month marks short-staffed grid cells through `shortStaffedShiftsOf`.
  [`month.ts:1318`](../../apps/web/src/features/calendar/utils/month.ts#L1318)

- The admin's marks carry the parsed leave only while the minimum is set.
  [`marks.ts:127`](../../apps/web/src/features/calendar/services/marks.ts#L127)

- Day detail figure: active teams only, `null` for members, off days and the empty setting.
  [`short-staffed.ts:395`](../../apps/web/src/features/staffing/services/short-staffed.ts#L395)

**The vocabulary and the look**

- Fifth modifier, `edge` treatment, `UsersThreeBold`, `Premalo ljudi`.
  [`modifiers.ts:50`](../../apps/web/src/features/calendar/utils/modifiers.ts#L50)

- The bar is precomposed with the rings so it is always the innermost band.
  [`modifiers.ts:211`](../../apps/web/src/features/calendar/utils/modifiers.ts#L211)

- The `warning` token in light and dark.
  [`index.css:315`](../../apps/web/src/index.css#L315)

- The edge utility and its forced-colours fallback.
  [`index.css:880`](../../apps/web/src/index.css#L880)

**Surfaces**

- Day detail line under *Sastav*, glyph and words when short.
  [`day-detail-dialog.tsx:112`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L112)

- Danas week: glyph, name and legend entry, never the bar alone.
  [`week-grid.tsx:104`](../../apps/web/src/features/today/components/week-grid.tsx#L104)

- 11.2's block takes the token on its border and glyph.
  [`short-staffed-block.tsx:51`](../../apps/web/src/features/staffing/components/short-staffed-block.tsx#L51)

**Tests**

- Every matrix row under both fixtures, the empty setting and archived teams.
  [`calendar-marks.test.ts:1`](../../apps/web/src/features/staffing/calendar-marks.test.ts#L1)

- Contrast and distance pins, plus the pinned light-glass gap.
  [`theme-contrast.test.ts:702`](../../test/theme-contrast.test.ts#L702)

- E2E: short, not short, and the empty setting.
  [`calendar-short-staffed.spec.ts:181`](../../e2e/tests/calendar/calendar-short-staffed.spec.ts#L181)
