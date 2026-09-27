---
title: 'Source structure B4 — the shift-type screens become thin pages over features/shift-types'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: '9993e338367e5c2d20761624ad1cfd7b12a1958d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-source-structure-b3-calendar-page.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two pages still hold all of their screen's refs, state, query, write handlers and `render*` helpers:
- `pages/postavke-rotacije.tsx` (560 lines), the shift-type list, add dialog and host of `RotationSection`;
- `pages/postavke-rotacije.tipovi-smjena.$id.tsx` (727 lines), the shift-type edit dialog.

The approved proposal wants pages that only compose.

**Approach:** Follow B1–B3 (see B3's spec and Change Log, and `features/calendar/calendar-screen.fixture.ts`):
- one hook per screen in `features/shift-types/hooks/`;
- components in `features/shift-types/components/`;
- leftover pure logic in `features/shift-types/utils/`;
- one fixture per screen set (or one fixture holding both sets) in `features/shift-types/`.

Each page keeps its route (`beforeLoad` guard, `FIRST_DESTINATION`) and composition. The edit page keeps its `key={id}` wrapper and `<PostavkeRotacijeScreen />` behind the dialog. DOM, behaviour and test outcomes stay identical.

## Boundaries & Constraints

**Always:**
- The DOM does not change.
- The exports `PostavkeRotacijeScreen`, `postavkeRotacijeRoute`, `PostavkeRotacijeTipSmjeneScreen` and `postavkeRotacijeTipSmjeneRoute` stay.
- Every guard keeps its meaning, with B1–B3's scoping rules:
  - Needles are asserted against the file that must hold them.
  - Order, null, `finally` and `catch` checks read the named handler's text.
  - Non-vacuity is checked per file, with a size floor.
  - A recursive completeness check asserts set equality over all of `features/shift-types`. Exemptions (`services/*`, `utils/ramp.ts`, the fixture, any id module) each carry a reason.
  - `test/localization-applied.test.ts` derives these parts from the folder, recursively, and asserts that none drops out.
- The list set and the edit set are disjoint. No file carrying `t()`, a control or a named handler belongs to both, so no count is doubled. The extractors take the first match in a joined set, so a handler name (`submit`, `archive`) must appear once per set.
- Handlers keep their names, ref guards, setters and `finally` at 2-space indentation inside the hook:
  - list: `submit`, `openAdding`, `chooseKind`;
  - edit: `submit`, `saveTimes`, `cancelTimes`, `archive`, `refresh`, `close`, `clearOutcomes`.
- `<Input ref={x}>` keeps a bare ref name that the set declares as `const x = useRef`.
- The literal `Promise.all([queryClient.invalidateQueries(SHIFT_TYPES_LIST_KEY), …ROTATION_KEY])` shape stays in the hook, with the variable named `queryClient`.
- Shared `kalendar`-style element ids go in one exempt `utils/element-ids.ts`.
- `utils/ramp.ts` does not move and does not gain imports: `test/theme-contrast.test.ts` imports it.
- Per-file bans follow the set: no `.delete(`, no `is_working`, no `useMutation`, no `@shift/domain`, no minute arithmetic and no colour or shift-slot classes in any part. The single `.delete()` stays in `services/write.ts`.

**Ask First:**
- A guard whose count or assertion would have to change.
- Any DOM or behaviour difference.
- A change to `RotationSection` or any `features/rotation` file.

**Never:**
- No new UI.
- No change to `services/{list,write}.ts` or `utils/ramp.ts` beyond moving inline helpers.
- No barrels.
- No E2E change.
- The other screens are out of scope.

</frozen-after-approval>

## Code Map

(Line numbers may be off by a few lines.)

- **`pages/postavke-rotacije.tsx`**
  - `PostavkeRotacijeScreen` 102–538:
    - refs `nameField`/`kindField`/`startField`/`endField` and `creating`;
    - `useState` `pending`/`working`/`failure`/`saved`/`adding`;
    - a `useEffect` that focuses the name field;
    - `useQuery(shiftTypesQueryOptions)`.
  - Handlers:
    - `openAdding` 121, `chooseKind` 136;
    - `submit` 141–224: `createShiftType(`, then `createdOutcomeOf` and `setFailure(next.failure)`, then `Promise.all` in its own try/catch.
  - Render helpers: `renderTimeFields` 227, `renderNoTimes` 269, `renderTimes` 276, `renderDuration` 304, `renderRow` 325, `renderTable` 350, `renderShiftTypes` 373. The JSX (428–537) holds the `RotationSection` and the add Dialog.
  - Route 540–560.
- **`pages/postavke-rotacije.tipovi-smjena.$id.tsx`**
  - `PostavkeRotacijeTipSmjeneScreen` 106–110 is a `key` wrapper.
  - `ShiftTypeScreen` 112–705:
    - refs `nameField`/`dateField`/`startField`/`endField`/`confirmation` and `writing`;
    - seven `useState`;
    - one `useQuery`;
    - derived values 138–147.
  - Handlers: `close` 149, `refresh` 154, `clearOutcomes` 168.
  - Writes: `submit` 176 (`renameShiftType(`/`setFailure`), `saveTimes` 220 (`correctShiftTypeTimes(`/`setTimesFailure`), `cancelTimes` 265 (`cancelScheduledTimes(`/`setTimesFailure`), `archive` 303 (`archiveShiftType(`/`setArchiveFailure`; its `finally` also calls `setArmed(false)`).
  - Render helpers: `durationOf` 336, `renderCurrent` 341, `renderFacts` 365, `renderTimesRefusal` 390, `renderArchiveRefusal` 398, `renderArchive` 405, `renderConfirm` 447, `renderType` 486, `renderBody` 552, `renderTimesForm` 559, `renderTimes` 642.
  - Route 707–727.
- **`pages/prijava.test.ts`**
  - Constants: `SHIFT_TYPE_LIST`/`SHIFT_TYPE_EDIT` (193–196) become fixture-built sets.
  - `SCREENS` controls: list 8 (535), edit 10 (536). The `SCREENS` length is 24 and the `KEY_SOURCES` length is 45 (2175).
  - `t()` occurrences: list 22, edit 23. Keep the duration text per set. A shared `t()` helper would move counts.
  - `FORM_SCREENS` 673–684 and tests 4612/4632/4682/4710.
  - `IN_FLIGHT_HANDLERS` 787–814 and tests 4733–4785 (`IN_FLIGHT_SCREENS` 10, `HANDLERS` 18), 4795, 4829 (list: `createdOutcomeOf(outcome);[\s\S]{0,120}?setFailure(next.failure)`) and 4926.
  - `namedHandler`/`componentFunction`/`finallyBlock` match at `\n {2}\}` / `\n {4}}`.
  - "reads the shift types exactly once" 3278–3316.
  - "no is_working change and no delete of a type" 3409–3432.
  - `SELECT_SCREENS` 3646 (14 in total).
  - Completeness precedents at 2192, 2211 and 2236.
- **`test/localization-applied.test.ts`**: 167 and 291 list the pages, and 288–290 list the shift-types modules. Add a recursive `shiftTypesScreenParts()` plus a required-parts assertion, as for the calendar at 375.
- **`router.test.ts:38-42,162,194,259-268,313-315`**: unchanged.
- **`features/rotation/services/write.test.ts:691-729`**: the recursive rotation sweep. Nothing new goes under `features/rotation`.

## Tasks & Acceptance

**Execution:**
- [x] `features/shift-types/{hooks,components,utils}/` and the fixture -- extract both screens per the Code Map.
- [x] Both pages -- compose only.
- [x] `pages/prijava.test.ts`, `test/localization-applied.test.ts` -- retarget to the sets per Boundaries, with counts unchanged, and add the completeness case.

**Acceptance Criteria:**
- Given both pages, when measured, then each is ≤ 150 lines with no `useQuery`, `useState`, `useRef` or effect.
- Given each retargeted guard, when a planted mutation breaks its target in a moved file, then the guard fails. Spot-check at least:
  - `.delete(` in an edit component;
  - `preventDefault` removed from the edit hook's `submit`;
  - `setArchiveFailure` removed from `archive`'s catch;
  - a bare `<select>` in the add dialog;
  - an extra `t()` in a list component;
  - a stray nested file under `components/`.

  Revert each afterwards.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test`, the web build and `pnpm test:e2e` run, then all pass. Unit counts grow only by added cases, and E2E stays at 68/68.

## Spec Change Log

- Implementation note (no intent change):
  - One fixture, `features/shift-types/shift-type-screens.fixture.ts`, holds both sets (`SHIFT_TYPE_LIST_PARTS`, `SHIFT_TYPE_EDIT_PARTS`) and `SHIFT_TYPE_SCREENS_EXEMPT` (the fixture, `services/list.ts`, `services/write.ts`, `utils/ramp.ts`). No id module was needed: every id stays a literal on a structural attribute inside its own set.
  - List set: page, `hooks/use-shift-type-list.ts`, `components/shift-type-list-section.tsx`, `components/shift-type-table.tsx`, `components/shift-type-add-dialog.tsx`.
  - Edit set: page (keeps the `key={id}` wrapper and `ShiftTypeScreen`, which composes the dialog over `<PostavkeRotacijeScreen />`), `hooks/use-shift-type-edit.ts`, `components/shift-type-edit-body.tsx` (the rename form, read before the times form), `shift-type-facts.tsx`, `shift-type-times.tsx`, `shift-type-archive.tsx`.
  - Components take the hook's return (`ShiftTypeListScreen` / `ShiftTypeEditScreen`) as `screen` and destructure it, so refs and handlers keep their bare names.
  - `prijava.test.ts`: the "reads once" case counts over the set, asserts the read and the `Promise.all` in the hook, and applies every ban per part; the "no is_working / no delete" case is per part; a new completeness case walks the feature recursively and also asserts the sets are disjoint, a 150-character floor per part, and each named handler declared once per set and inside its hook. `localization-applied.test.ts` gains a recursive `shiftTypesScreenParts()` (hooks, components, services, utils) and a required-parts case.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shift/web build` -- expected: exit 0.
- `pnpm test` -- expected: pass. Rebuild first, and record the baseline first.
- `pnpm test:e2e` -- expected: 68/68. Check that port 5173 is free, and do not run it in parallel with unit tests.

## Suggested Review Order

**The thin pages**

- The list page composes the rotation section, the shift-type list and the add dialog.
  [`postavke-rotacije.tsx:70`](../../apps/web/src/pages/postavke-rotacije.tsx#L70)

- The edit page keeps the per-type remount and the dialog over the list.
  [`postavke-rotacije.tipovi-smjena.$id.tsx:96`](../../apps/web/src/pages/postavke-rotacije.tipovi-smjena.$id.tsx#L96)

**Where the state went**

- The list hook: refs, focus effect, the query and the create write.
  [`use-shift-type-list.ts:47`](../../apps/web/src/features/shift-types/hooks/use-shift-type-list.ts#L47)

- The edit hook: rename, times, cancel and archive, each with its in-flight guard.
  [`use-shift-type-edit.ts:60`](../../apps/web/src/features/shift-types/hooks/use-shift-type-edit.ts#L60)

**Guards**

- The two disjoint screen sets and the exact exemptions.
  [`shift-type-screens.fixture.ts:1`](../../apps/web/src/features/shift-types/shift-type-screens.fixture.ts#L1)
