---
title: 'Tables become stacked rows on a phone (7.6)'
type: 'feature'
created: '2026-10-08'
status: 'done'
baseline_commit: '0fc2177ed37e0f46bfaab8829f531cff861f1de6'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Below 640 px the Sati, Ljudi and shift-types tables scroll sideways inside their own box, so a phone user swipes to find a number (NFR-15, Q16, UX review 2026-10-01).

**Approach:** Below 640 px each of the three screens renders the same view model as a list of stacked rows. A `usePhone()` switch decides which form renders, and only one is in the DOM at a time. At 640 px and wider the tables stay exactly as they are. Mockup: `ux-designs/ux-shift-2026-10-01-redesign/mockups/mobile-tables-1.html`; README decision 7.

## Boundaries & Constraints

**Always:**
- **One primitive** `components/ui/stacked-list.tsx`:
  - `StackedList` is a `ul` named by the table's caption.
  - `StackedRow` is an `li`.
  - `StackedFields` / `StackedField` is a `dl` of `dt` + `dd`. The `dt` is the column's own i18n label. It is visible where the mockup shows a label and `sr-only` where position carries it, so every value keeps its column label for assistive technology (Q22).
- **Sati row:**
  - Title: the name `Link`, as today.
  - Under it: `{team} · {n} smjena`.
  - Top right: `Ukupno` over the total.
  - Below: a 3-up grid, one cell per band plus `Godišnji`, each with a visible label, the hours and the shift count.
  - Conflicts appear only when the count is > 0, as `⚠` + count + label, never colour alone.
  - The empty result renders `EmptyResult` with its two actions in place of the list.
- **Ljudi row:**
  - The avatar, then the name as title, then `{team} · {role}` under it, then the leave figure on the right, then a chevron.
  - The name `Link` to `/ljudi/$id` stretches over the whole row (`after:absolute after:inset-0`). It keeps the `memberActionName` name, so the row has one link and no pencil.
  - Email is not shown on the phone.
- **Shift-types row:**
  - The type chip, then times as the main line, then `{duration} · [prelazi ponoć]` under them.
  - Active rows have the existing 44 px edit link with the same name. Archived rows have none.
- **Sort on a phone** (Sati, Ljudi): one shared `SortControl` above the list reads `Poredano: {column} ↑|↓`.
  - It opens the 7.4 `Popover`, which lists the sortable columns as `aria-pressed` `Button`s.
  - Picking a column calls the same change a header press does (`pressColumn` / the hours sort change), so the state is shared across the 640 px switch.
- Where a table shows a skeleton, the phone shows skeleton rows in the row's shape.
- At ≥ 640 px the tables keep their markup, their `aria-sort`, their sorting and the `Table` primitive's `overflow-auto` wrapper.
- Every digit is `tabular-nums`. No user-facing literal outside i18n. Counts use ICU plurals.
- Update in the same change:
  - DESIGN.md §Layout (:252, :260) and the Table component row (:280), plus a new Stacked row component row.
  - EXPERIENCE.md §Responsive (:166-173) and the hours-table line (:111).
  - `epics.md` UX-DR17 (:127).
  - The stale `DESIGN.md:150` code comments.

**Ask First:** Stacking any other table. Changing what a desktop table shows. Moving Ljudi's filters into a `Filtri` sheet.

**Never:**
- A new runtime dependency.
- CSS `display` overrides on `table`/`tr`/`td`, because they drop table roles.
- Rendering both forms and hiding one.
- Horizontal scroll inside any of the three lists.
- A per-screen fork of the list primitive or the sort control.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sati phone | 390 px, 17 rows | 17 `li`; no element in `main` has `scrollWidth > clientWidth` | N/A |
| Sati, resize | 390 → 1024 px, sort=ukupno desc | The table, `aria-sort="descending"` on Total | N/A |
| Sort control | Ljudi 390 px, pick `Ime` while sorted by name ↑ | Name ↓, focus back on the control | Escape closes it, focus on the control |
| Sati filter empty | phone, `?smjena=B&osoba=luka` | No list; the two sentences and the two actions | N/A |
| Shift types archived | phone | Rows without an edit link | N/A |
| AT read | phone Sati row | Each value is announced with its `dt` label (`Ukupno`, the band name, …) | N/A |

### Epic AC Deviations

- "each row renders as a stacked card with its labels": the Ljudi row omits email on a phone, following the approved mockup. Email stays on the member page and in the ≥ 640 px table.
- "Sati, Ljudi and shift-types tables": only these three stack. The hour-band, team, rotation-offset and rotation-history tables are ledgered in `deferred-work.md`, per the human decision of 2026-10-08. The calendar, week and rotation-preview grids keep scrolling inside their own box, by the epic's rule.

</frozen-after-approval>

## Code Map

- `apps/web/src/components/ui/table.tsx:5-30` -- the primitive, with the pinned `overflow-auto` wrapper (:22). Leave it; fix the stale DESIGN.md:150 comment.
- `apps/web/src/hooks/viewport.ts:13` `usePhone()`, `:22` `useCloseWhenWide`; `utils/viewport.ts:11` `PHONE_MEDIA_QUERY`. Reuse these and add no new hook.
- `apps/web/src/components/ui/popover.tsx`, `components/filter-bar.tsx` (picker as roving `aria-pressed` Buttons, focus return after render, `:107` usePhone) -- the pattern for `SortControl`.
- `apps/web/src/features/hours/components/organization-hours-table.tsx`:
  - `:53-91` `SortHead`/`SORT_GLYPHS`; `:199` caption; `:204-262` columns and cells; `:263-269` `EmptyResult`; `:272` untimed note.
  - `hours-body.tsx:91` mounts it.
  - The sort change is `hoursSearchTo` in `services/my-hours.ts:183-207`, and `hoursAriaSortOf` lives in the same service.
- `apps/web/src/features/members/components/member-table.tsx`:
  - `:63` caption, `:80` `aria-sort`, `:102` actions head, `:112-125` skeleton, `:142-149` edit link.
  - `components/cell-view.tsx`.
  - `services/list.ts:1076-1160` `MEMBER_COLUMNS`, `:1184` `cellClassNameOf`, `:1419` `sortStateOf`.
  - `hooks/use-member-list.ts:121` `pressColumn`.
  - `features/members/utils/sort-glyphs`.
- `apps/web/src/features/shift-types/components/shift-type-table.tsx`:
  - `:32-78` times and duration cells; `:92-100` edit link; `:111` null on no rows.
  - `shift-type-list-section.tsx:62,72` mounts it.
- Fixtures: `features/hours/hours-screen.fixture.ts:19`, `features/shift-types/shift-type-screens.fixture.ts:30`, and `MEMBER_LIST` in `prijava.test.ts:148-156`. Register the new part files here.
- `apps/web/src/pages/prijava.test.ts`:
  - `:6040-6091` one scroll container, and no `overflow-auto` in `MEMBER_LIST`.
  - `:8935-8955` exactly 2 `<TableHead` in `MEMBER_LIST`, one with `aria-sort`.
  - `:9070-9087` `aria-sort` uses `sortStateOf`.
  - `:785-789` hours control count.
  - `:9956` the edit-link name.
- e2e:
  - `e2e/pages/hours.page.ts:130-280` positional `cell` locators, desktop only.
  - `e2e/pages/people.page.ts:18-41`.
  - `e2e/pages/rotation.page.ts:155-160`.
  - `e2e/tests/hours/hours.spec.ts:344,555-557,733`: 390 px tests that count `tbody` rows.
  - `e2e/tests/layout/responsive.spec.ts:19-74,184,216`.
  - `e2e/utils/layout.ts:32-45` checks only the page's `scrollWidth`.
  - `e2e/tests/rotation/rotation-phone.spec.ts:149`.
- `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-10-01-redesign/mockups/mobile-tables-1.html:311-388` -- the row shapes and rules.

## Tasks & Acceptance

**Execution:**
- [x] `components/ui/stacked-list.tsx` -- `StackedList`, `StackedRow`, `StackedFields`, `StackedField` (`labelHidden`), and a row-shaped skeleton helper.
- [x] `components/sort-control.tsx` -- `Poredano:` button + `Popover` column picker, driven by `{columns, active, direction, onPick}`; it holds the `t()` calls.
- [x] `features/hours/components/organization-hours-rows.tsx` + `organization-hours-table.tsx`/`hours-body.tsx` -- the phone rows, and the `usePhone()` switch with `SortControl`.
- [x] `features/members/components/member-rows.tsx` + `pages/ljudi.tsx` or `member-table.tsx` -- the phone rows, the switch, `SortControl` and the skeleton.
- [x] `features/shift-types/components/shift-type-rows.tsx` + `shift-type-table.tsx` -- the phone rows and the switch.
- [x] `hr.json` -- `sort.*` keys (`Poredano`, the direction names).
- [x] `prijava.test.ts`, fixtures -- register the new parts and re-count with comments. Pin: rows files contain no `<Table`, `overflow-` or `display` overrides, and every value goes through `StackedField`.
- [x] e2e:
  - Page objects get phone-row locators.
  - The 390 px hours tests use them.
  - A new `expectNoInnerHorizontalScroll` in `utils/layout.ts` runs on `/sati`, `/ljudi` and the shift-types step at 320 and 390 px.
  - A phone sort test (Sati, Ljudi).
  - The desktop sort tests stay unchanged.
- [x] Unit tests -- each rows component renders a `dt` label for every value, and the sort control picks, flips and returns focus.
- [x] Binding docs -- DESIGN.md, EXPERIENCE.md, epics.md UX-DR17.
- [x] `deferred-work.md` -- ledger stacking for the hour-band, team, rotation-offset and rotation-history tables.

**Acceptance Criteria:**
- Given Sati (admin), Ljudi or the shift-types step below 640 px, when it renders, then each row is a stacked row with labelled values and neither the page nor any element in it scrolls sideways.
- Given ≥ 640 px, when the same screens render, then the tables, tabular numerals and header sorting are unchanged.
- Given the suite, when `pnpm test`, lint, typecheck and the hours, people, rotation and layout e2e run, then they pass.

## Design Notes

The rows and the table read one view model, so a figure can never differ between the two forms. Sort and filter state already live outside the table (the URL for Sati, `use-member-list` for Ljudi), so crossing 640 px keeps them. A list (`ul`/`dl`) is the honest semantics for a card. Restyled table elements lose their roles in WebKit.

## Verification

**Commands:**
- `pnpm --filter ./apps/web test && pnpm exec vitest run && pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm test:e2e e2e/tests/hours e2e/tests/people e2e/tests/rotation e2e/tests/layout` -- expected: pass

**Manual checks:**
- Demo at 390 and 1440 px, both themes: Sati, Ljudi and shift types; the sort control; resizing across 640 px.

## Suggested Review Order

**One switch, two forms**

- Entry point: `usePhone()` puts exactly one form in the DOM
  [`hours-body.tsx:80`](../../apps/web/src/features/hours/components/hours-body.tsx#L80)

- The one primitive: `ul`/`li`, every value a `dt` + `dd`
  [`stacked-list.tsx:63`](../../apps/web/src/components/ui/stacked-list.tsx#L63)

- The list is named by the table's caption, and it carries `aria-busy` while loading
  [`stacked-list.tsx:23`](../../apps/web/src/components/ui/stacked-list.tsx#L23)

**Rows per screen**

- Sati: total top right, band grid, conflicts only above zero
  [`organization-hours-rows.tsx:38`](../../apps/web/src/features/hours/components/organization-hours-rows.tsx#L38)

- Ljudi: one stretched link per row, no email
  [`member-rows.tsx:61`](../../apps/web/src/features/members/components/member-rows.tsx#L61)

- Shift types: table and rows share one formatting
  [`shift-type-cells.tsx:25`](../../apps/web/src/features/shift-types/components/shift-type-cells.tsx#L25)

- The shift-types row: chip, times, `{duration} · Prelazi ponoć`
  [`shift-type-rows.tsx:43`](../../apps/web/src/features/shift-types/components/shift-type-rows.tsx#L43)

- Sati's phone skeleton takes the row's shape
  [`hours-skeleton.tsx:15`](../../apps/web/src/features/hours/components/hours-skeleton.tsx#L15)

**Sort on a phone**

- One control drives the same change a header press does
  [`sort-control.tsx:57`](../../apps/web/src/components/sort-control.tsx#L57)

- Pure helpers: listed columns, cursor clamp, the label of an unlisted sort
  [`sort-control.ts:23`](../../apps/web/src/utils/sort-control.ts#L23)

- Ljudi direction: a total mapping with no silent fallback
  [`list.ts:1482`](../../apps/web/src/features/members/services/list.ts#L1482)

- Sati direction is derived from the header arrow
  [`organization-hours.ts:346`](../../apps/web/src/features/hours/services/organization-hours.ts#L346)

**Supporting**

- `EmptyResult` gets its own file, shared by both forms
  [`organization-hours-empty.tsx:34`](../../apps/web/src/features/hours/components/organization-hours-empty.tsx#L34)

- Ljudi leave unit, as an ICU plural
  [`cell-content.ts:62`](../../apps/web/src/features/members/utils/cell-content.ts#L62)

- Binding docs: §Layout stacked-rows rule
  [`DESIGN.md:253`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L253)

- §Responsive: the per-screen rows
  [`EXPERIENCE.md:173`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L173)

- UX-DR17 rewritten
  [`epics.md:127`](../planning-artifacts/epics.md#L127)

**Tests**

- A new check catches a table scrolling inside its own box
  [`layout.ts:78`](../../e2e/utils/layout.ts#L78)

- Sati phone: every value, the bands, the sort control and its keys
  [`hours.spec.ts:787`](../../e2e/tests/hours/hours.spec.ts#L787)

- Source pins: no table markup, label first, one form per switch
  [`prijava.test.ts:6143`](../../apps/web/src/pages/prijava.test.ts#L6143)
