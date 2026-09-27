---
title: 'Source structure B1 — the people screens become thin pages over features/members'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: 'fcc6931cb921451aa09fbb967a18eeb88907cc9f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
  - '{project-root}/apps/web/src/components/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `pages/ljudi.tsx` (670 lines), `pages/ljudi.novi.tsx` (579) and `pages/ljudi.$id.tsx` (1,674) each hold state, queries, handlers, derivations and every section's JSX. The approved proposal wants a page that only composes, with the screen's parts in `features/members/`.

**Approach:** For each screen:
- move its state, queries and handlers into one hook in `features/members/hooks/`;
- move each self-contained section into a component in `features/members/components/`;
- move inline pure logic into `features/members/utils/`.

The page keeps `createRoute`, its `beforeLoad` and the composition. The rendered DOM, the behaviour and every test outcome stay identical.

## Boundaries & Constraints

**Always:**
- The DOM does not change: same elements, order, roles, labels, classes and text.
- Every source guard keeps its meaning. A guard that targeted one screen file now targets that screen's file set (page, its components and its hook), read as one source, with **the same expected counts**. This covers:
  - `pages/prijava.test.ts`: `SCREENS`, `KEY_SOURCES`, `FORM_SCREENS`/`IN_FLIGHT_HANDLERS`, `SELECT_SCREENS`, the member-list and query checks, `filterWiringFaults`;
  - `test/localization-applied.test.ts` `SOURCES`.
- An effect call stays inside its named handler (`submit`, `issue`, `changeStatus`, `changeTeam`) with its ref guard and setters, all in the same file (the hook).
- Components in `features/members/components/` may call `t()`.

**Ask First:**
- A guard whose expected count or assertion would have to change.
- Any DOM or behaviour difference.
- A shared component that another feature would need.

**Never:**
- No new UI and no restyling.
- No change to `members/{list,write,wire}` services beyond moving inline helpers in.
- No barrels (A2).
- No E2E locator change.

</frozen-after-approval>

## Code Map

(Paths after A. Line numbers are from the pre-A `routes/` files and shift by at most a few lines.)

- `pages/ljudi.tsx`:
  - `cellContent` 200–234 and `SORT_GLYPHS` 172 go to `utils/`. The guard at `prijava.test.ts` ~2762–2970 matches `function cellContent(` by name, so it keeps working in the new file.
  - `CellView` 236–256 becomes a component.
  - `LjudiScreen` state and query 258–322 become `hooks/use-member-list.ts`.
  - Sections become components: filters ~339–424, stats 465–494, table card 501–597, count status 608–612.
- `pages/ljudi.novi.tsx`:
  - `submit` 160–253 and the state and refs 114–158 become `hooks/use-member-create.ts`.
  - `renderCredential` 265–291, `renderRank` 293–329 and `renderForm` 331–487 become components.
- `pages/ljudi.$id.tsx`:
  - Four queries 319–352, the derived values 333–402 and the handlers `armTeam` 408, `pickTeam` 467, `changeTeam` 485, `armStatus` 552, `changeStatus` 593, `issue` 656 and `submit` 698 go to one hook, `hooks/use-member-edit.ts`, or at most one hook per card if the guard file-set says so.
  - Components by card: basics form 797–982, password reset 983–1139, status 1140–1298, team history and change 1299–1542.
  - The repeated key-join at 1175, 1344, 1356 and 1587 becomes one util.
- `pages/prijava.test.ts`: `MEMBER_LIST`/`MEMBER_CREATE`/`MEMBER_EDIT` (~70, 93, 94) become file sets, with a `screenSource(set)` concatenation. The tables at 373/384/406, 1500–1858 (45 entries at 2096), 573–675, 2984–3022, 3367, 3476–3513 and 3525–3660 all read through it.
- `test/localization-applied.test.ts:100,191-192`: `SOURCES` gains the new files.

## Tasks & Acceptance

**Execution:**
- [x] `features/members/{hooks,components,utils}/` -- extract per the Code Map, one screen at a time (list, create, edit).
- [x] `pages/ljudi{,.novi,.$id}.tsx` -- compose only.
- [x] `pages/prijava.test.ts`, `test/localization-applied.test.ts` -- retarget the guards to the file sets, with unchanged counts.

**Acceptance Criteria:**
- Given the three pages, when measured, then each is ≤ 150 lines and contains no `useQuery`, `useMutation`, `useState` or effect call.
- Given each guard, when a spot-check breaks its target in a moved file (a bare `<select>` in a members component, an effect call outside its handler in the hook, an extra `t()` key), then the guard fails. Revert afterwards.
- Given the suite, when `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shift/web build` and `pnpm test:e2e` run, then all pass with the baseline test counts.

## Suggested Review Order

**The thin page**

- The edit page now only reads the route param and composes four cards.
  [`ljudi.$id.tsx:73`](../../apps/web/src/pages/ljudi.$id.tsx#L73)

**Where the screen's state went**

- One hook holds the edit screen's reads, scoped state and named in-flight handlers.
  [`use-member-edit.ts:108`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L108)

- A representative card: its `render*` helpers are inner functions because the guards pin their names.
  [`member-team-card.tsx:54`](../../apps/web/src/features/members/components/member-team-card.tsx#L54)

**Guards retargeted to file sets**

- A screen is read as its concatenated file set, and every count stays unchanged.
  [`prijava.test.ts:815`](../../apps/web/src/pages/prijava.test.ts#L815)

- Completeness: no new member file can escape the sweeps.
  [`prijava.test.ts:2155`](../../apps/web/src/pages/prijava.test.ts#L2155)

- The freshness sweep derives the member files from the folder.
  [`localization-applied.test.ts:38`](../../test/localization-applied.test.ts#L38)
