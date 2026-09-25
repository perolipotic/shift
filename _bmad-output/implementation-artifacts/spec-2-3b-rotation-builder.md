---
title: 'Story 2.3b: An admin builds the rotation, places each team at an offset and sees the cycle before saving'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'f6a28a685245621673b3bb1f06d63eb29ee1e6ac'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-3a-rotation-rule.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2b-shift-type-editor.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 2.3a stores rotations and projects them, but no admin can see or build one. This part covers epics.md story 2.3 clauses 1 and 4 (UX-DR14, UX-DR15) on screen, and closes the 2.3 parent.

**Approach:** `/postavke-rotacije` gains a rotation section below `Tipovi smjena`, in one scrolling panel:
- the pattern builder with live figures;
- a shared anchor date and each active team's step;
- a preview of one cycle from today;
- `Spremi rotaciju`.

The draft opens with the rotation in force today. Saving writes a fresh pattern, then its steps, then one assignment per active team, all effective from the organization's today. Rules live in pure `.ts` modules, and `.tsx` holds markup only.

## Boundaries & Constraints

**Always:**
- **Mirror 2.2b:** reader, query options, surface state, the refetch rule, `useRef` lock, exhaustive code→key switch, `Notice`, `h-11`, and the native `<select>` string.
- **One snapshot** (AD-13), under its own key `ROTATION_KEY`, read from `organizations` with the zone, teams, shift types with versions, steps and assignments embedded. The existing row parsers are reused. Save invalidates only `ROTATION_KEY`. A shift type write also invalidates it, so the builder sees new types.
- **Projection and duration come only from `@shift/domain`:** `projectedStepId` (new, see Design Notes), `projectedShiftType`, `rotationAssignmentOn`, `daysBetween`, `shiftDurationOn`. The preview projects the unsaved draft by giving it synthetic step ids. Dates advance with `nextIsoDate`. "Today" is the organization's today.
- **Draft:**
  - Steps are an ordered list of shift type ids, and repeats are allowed.
  - Each step is one compact row: a drag handle, its number, the type's chip and remove. Steps are reordered by dragging the handle (mouse, touch, and keyboard: space to lift, arrows to move, with Croatian screen-reader announcements), using `@dnd-kit`. There are no move-up/move-down arrows. Adding uses a select of active types. Every control is 44 px, and the handle and remove button name their step's position.
  - The unsaved draft survives the shift-type edit dialog opening and closing (`tipovi-smjena.$id` remounts the screen), so it lives outside the component.
  - Removing a step or moving the step a team stands on keeps that team on the same step. If a team's step is removed, the team falls to step 1.
  - Every active team has exactly one step.
  - `Rasporedi ravnomjerno` beside the offsets sets every active team's step at once. The teams are taken in `splitTeams` order and `i` is a team's index. With `n` teams and `len` steps: when `n <= len` a team gets step index `floor(i * len / n)`, otherwise `i mod len`. The button only fills the draft (nothing is saved) and is unavailable while the pattern is empty.
- **Prefill:** when every active team's assignment in force today uses one pattern, the draft takes that pattern's steps with **today** as the anchor. Every team's offset is re-expressed onto today through the projection (`projectedStepId`), so each team's step reads as what it works today and the preview is unchanged. In any other case the draft starts empty, with today as the anchor.
- **Figures** under the steps, updated live:
  - cycle length;
  - working steps;
  - hours per cycle: the sum of today's durations, with the duration keys; a working type with no times makes this "unknown", never a guessed 0.
- **Preview:** one row per active team, with the team's name in a sticky first column, and one column per date, from today for one cycle length. Each column header gives the day number in the cycle and the date. Each cell is a tile in the type's ramp-slot colour, with the type's name and its clock range, or `—` for a non-working type. The grid scrolls horizontally inside its own container.
- **Refused before sending, values kept, each with its own key:**
  - no steps;
  - no active team;
  - the draft is unchanged from the rotation in force (same step sequence and the same projection over one cycle);
  - a step's type is archived (prefill labels it);
  - an assignment is scheduled after today (points to 2.6).
- **Save failures:**
  - 23505 `rotation_assignments_team_id_effective_from_key`: already changed today;
  - 42501: refused;
  - anything else: unavailable.
  - A failure after the pattern insert says nothing changed. A retry always builds a fresh pattern.
- **Copy:** keys under `rotation.builder.*`. There `smjen` names the team, as in `smjene.*`, and `tip… smjen` is forbidden. `teamTermOutOfTurn` is amended, with self-tests of both polarities. Plurals use ICU one/few/other. Wording follows the mockup: `Uzorak rotacije`, `Dodaj korak`, `Dužina ciklusa`, `Referentni datum`, `Pomak`, `Pregled ciklusa`.

**Ask First:** any migration, RPC or policy change; archiving rules for teams or types; a delete path for patterns; a date other than today for the save (2.6).

**Never:** the phone stepper (2.4); coverage and rest warnings (2.5); cancelling a scheduled change or picking an effective date (2.6); any dependency other than `@dnd-kit`; `.delete(`; projection or modulo in `apps/web`; `destructive`; a stored cycle length, offset or projected shift.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pilot prefill | seeded, today 2026-09-26 | Steps Dan Noć Slob Slob; anchor today (2026-09-26); A–D on steps 1–4 (2460 days after 2020-01-01, 2460 mod 4 = 0); `4 dana · 2 · 24 h`; preview equals the seeded projection | N/A |
| UJ-5 prefill | seeded | 5 steps, `5 dana · 3 · 24 h`, 3 columns | N/A |
| Reorder | move Noć above Dan | Figures unchanged, preview changes, teams keep their step | N/A |
| Repeat | Dan Dan Noć Slob Slob Slob | Length 6, working 3, 36 h | N/A |
| Remove a team's step | remove step 3 while C stands on it | C falls to step 1 | N/A |
| Mixed patterns | teams in force on two patterns | Empty draft, anchor today | N/A |
| Unchanged | prefill and save | Refused before sending | UNCHANGED |
| Empty / no team | no steps, or 0 active teams | Refused before sending | EMPTY / NO_TEAMS |
| Save | changed draft | Pattern, then steps, then assignments from today; prefill shows it | N/A |
| Second save today | a team already has a version today | Nothing further written | 23505 → CHANGED_TODAY |
| Steps fail | step insert refused | Orphan pattern; "nothing changed" | code → key |
| Scheduled exists | assignment after today | Refused before sending | SCHEDULED |
| Hours unknown | working type with no times | Hours shown as unknown | N/A |
| Refetch fails | rows cached | Draft and rows kept, message beside them | retry 1 |

</frozen-after-approval>

## Code Map

- `apps/web/src/shift-types/list.ts` -- the pattern to copy:
  - `readShiftTypes` (:285, from `organizations`, `{count:'exact'}`) and the row parsers to reuse;
  - `shiftTypesTodayOf` :343, `rampSlotsOf` :355, `chipClassOf` :388, `shiftTypesQueryOptions` :552, `shiftTypesSurfaceStateOf` :590.
- `apps/web/src/shift-types/write.ts` -- failures by code, then by constraint name (:189-245); `settledRows` :290; the two-write `createShiftType` :511 and `createdIdOf` :492; the key switch :663; the seam types :103-133. `claimedOrganizationOf` lives in `teams/write.ts:223`.
- `apps/web/src/teams/list.ts` -- `teamRowOf` :103 and `splitTeams` :196 (active teams in display order).
- `packages/domain/src/{projection,duration}.ts` -- `duration.ts` is READ ONLY; `projection.ts` gains only `projectedStepId` (see Design Notes). `projectedShiftType(steps, assignment, date)` :174 and `rotationAssignmentOn` :97 take one team at a time; `shiftDurationOn` :146 returns `null` for a working type with no version.
- `apps/web/src/i18n/format.ts` -- `nextIsoDate` :261 and `formatIsoDate` :283. Only this file touches `Intl`.
- `supabase/migrations/0016_rotation.sql` -- READ ONLY:
  - insert grants :455-484 (patterns `(organization_id)`, and select returns the id);
  - the assignment policy :396-426;
  - constraint names :83-188.
- `apps/web/src/routes/postavke-rotacije.tsx` -- `<main>` :363, cards :488-511, native select :439-453, the shift-type create lock :141-211. The `tipovi-smjena.$id` route renders this screen behind its dialog (:685), so the builder renders there too.
- New `apps/web/src/rotation/{list,draft,write}.ts` (+ `.test.ts`) and `rotation/rotation-section.tsx`, a separate file because `prijava.test.ts:2889-2915` pins a single `useQuery` and `SHIFT_TYPES_LIST_KEY` on the shift-type screens.
- Inventories:
  - `prijava.test.ts`: `SCREENS` :284-472, `FORM_SCREENS` :474, `KEY_SOURCES` :1340+, lengths :1895, the per-screen query checks :2889;
  - `test/resource-hygiene.test.ts`: `SANCTIONED_SCREEN_KEYS` (exact set, :868), `SANCTIONED_PLURAL_KEYS` :37, `teamTermOutOfTurn` :803 with self-tests :1101-1124, imperative pins :992;
  - `test/localization-applied.test.ts`: `SOURCES` :48-232 and `AUTHORED_VOCABULARY` :484.
- `e2e/support/fixture.ts:146-215` -- a per-run org with team `Smjena Alfa` and no shift types. Seeded orgs are never touched.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/projection.ts`, `src/index.ts`, `test/projection.test.ts` -- `projectedStepId`, with `projectedShiftType` delegating to it. Both fixtures, plus the existing PRNG check extended to it.
- [x] `apps/web/src/rotation/list.ts` (+ test) -- reader, `ROTATION_KEY`, query options and surface state; the in-force rotation per team today; the scheduled flag. Both fixtures, with real `QueryObserver` refetch tests.
- [x] `apps/web/src/rotation/draft.ts` (+ test) -- prefill with anchor re-expression, the step operations with the offset rule, figures, preview rows through `@shift/domain`, pre-send refusals. Every draft row of the matrix, plus a seeded-PRNG check that the prefill's preview equals the stored projection.
- [x] `apps/web/src/rotation/write.ts` (+ test) -- the three-write save, failure codes, partial outcome, the key switch. Every write row of the matrix.
- [x] `apps/web/src/rotation/rotation-section.tsx`, `routes/postavke-rotacije.tsx` -- the markup, rendered under the shift types, with the shift-type writes also invalidating `ROTATION_KEY`.
- [x] `apps/web/src/i18n/locales/hr.json` -- the `rotation.builder.*` keys.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` -- the inventories and the namespace rule.
- [x] `e2e/rotation.spec.ts` -- in the run's org:
  - add two types;
  - build `[A, B, Slob]` and check the figures and the preview;
  - save;
  - reload and see the prefill.
  
  Each attempt uses a team made for it.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `2-3a-rotation-rule: done`, add `2-3b-rotation-builder: in-progress`.

**Acceptance Criteria:**
- Given the pilot admin at 390 px, when they open `/postavke-rotacije`, then the builder, offsets and preview are usable with no horizontal page scroll, and every control is at least 44 px.
- Given a saved rotation, when any date before today is projected, then it is unchanged (the old version still governs).
- Given the built bundle and the `apps/web` sources, when they are swept, then there are no literals, no `%` projection arithmetic, and no `@shift/domain` import in any `.tsx`.

## Spec Change Log

- **2026-09-25, human renegotiation after review (not a finding):**
  - **Trigger:** the owner asked for drag-and-drop instead of arrows, and for compact step rows. The owner also chose to fix, now, the loss of the unsaved draft when the shift-type edit dialog opens, rather than defer it.
  - **Amended (frozen block, by the owner):**
    - Draft step controls: a drag handle via `@dnd-kit/core` + `@dnd-kit/sortable` (+ `@dnd-kit/utilities` if needed), with touch and keyboard sensors and i18n announcements. Arrows removed.
    - One-row step layout.
    - The draft is kept outside the component.
    - The Never list now allows `@dnd-kit`.
  - **Known-bad states avoided:**
    - Native HTML5 drag-and-drop, which is unreliable on touch for a phone-first product.
    - A drag-only UI with no keyboard path.
    - Focus lost after a reorder.
  - **KEEP:**
    - The pure step operations in `draft.ts`: stable keys, the offset rule, the focus rules. A drop calls `withStepMoved` (or an equivalent move-to-index op, tested) and never reorders inside the `.tsx`.
    - Every review patch from iteration 0.
    - The e2e coverage of reorder and remove, now driven by drag and by keyboard.

- **2026-09-25, owner addition:**
  - **What:** a `Rasporedi ravnomjerno` button that spreads the teams' offsets evenly over the cycle.
  - **Why:** teams left on the same offset put, for example, three teams on Noć on one date (duplicate cover on that date, and none on another).
  - **Not part of this change:** checking a statutory minimum rest (the owner declined it for now; rest-gap warnings stay in 2.5).
  - **Spread rule:** it lives in `draft.ts`, is pure and tested. For example:
    - 4 teams on 4 steps: steps 1–4;
    - 3 teams on 4 steps: steps 1, 2, 3;
    - 2 teams on 4 steps: steps 1 and 3;
    - 5 teams on 4 steps: steps 1, 2, 3, 4, 1.

- **2026-09-25, owner decision:**
  - **What:** the prefill's anchor is the organization's today, not the stored anchor (the seeded one is 2020-01-01). Offsets are re-expressed onto today, so the projection is identical, and "Pomak" reads as the step each team works today.
  - **Unchanged save:** a prefill saved with no edit is still refused as UNCHANGED, because that check compares projections. A real change is saved with today's anchor.
  - **Amended:** the Prefill bullet and the pilot-prefill row of the matrix (by the owner).

- **2026-09-25, owner layout (from the owner's mockup):**
  - **Layout:**
    - Numbered sections: 1 Tipovi smjena, 2 Uzorak rotacije, 3 Smjene i pomaci, 4 Pregled ciklusa.
    - Sections 1 and 2 sit side by side from `lg` up and stack below that.
    - The shift type add button moves into card 1's header, and `Spremi rotaciju` moves into the page header actions.
  - **Section 2:**
    - Compact step rows.
    - Figures as four icon `StatTile`s: cycle length, working steps, non-working steps and hours per cycle.
  - **Section 3:** the anchor date and `Rasporedi ravnomjerno` share one row, with a `Callout` "Kako to funkcionira?".
  - **Preview:** teams become the rows (see the amended Preview bullet).
  - **Shift types table:** the Vrsta column is removed from the shift types table; a non-working type reads as `—` in times and duration.
  - **Declined from the mockup:**
    - per-type icons (a type has no icon, and nothing may branch on a name);
    - templates and "Kopiraj iz predloška";
    - a duration per step (a step is one day);
    - red, `destructive`-styled delete icons.
  - **Cycles shown (owner request):** cycle paging is replaced by a select of 1–5 cycles in the preview's header (default 1). The preview covers `k × cycleLength` days from today, "Dan N" restarts at each cycle, and each cycle's first day is named and ruled off. It is view state only: never saved, and no part of UNCHANGED.

## Design Notes

**One domain addition.** `projectedShiftType` returns a type id, but the prefill and the offset rule need the step. Add `projectedStepId(steps, assignment, date)` to `packages/domain/src/projection.ts`, with the same checks, and make `projectedShiftType` its type lookup. This is the only change to `packages/domain`, and it is tested there on both fixtures.

Re-expressing an offset: `newOffset = projectedStepId(steps, teamAssignment, sharedAnchor)`. On the shared anchor, the team stands on the step it would have stood on anyway, so the preview is unchanged. The seeded teams already share 2020-01-01, so for them this is the identity.

"Unchanged" means: the same sequence of type ids, and the same projected step index per team over one cycle from today. A new pattern id alone would pass the database's "changes the value" rule and write a redundant version.

**"Already changed today" is caught before sending.** A second version on one date for one team is refused by `0016`'s RLS insert check (`effective_from` strictly after the latest version) with 42501, before the unique key `rotation_assignments_team_id_effective_from_key` could raise 23505. So the draft is refused as `ROTATION_CHANGED_TODAY` before anything is sent whenever an active team already has a version dated today, and nothing is written. 23505 is still mapped by constraint name to the same code, for a snapshot that went stale in between.

**The E2E resets its own organization's rotation over `pg`.** Before each attempt it deletes the today-or-later assignments of its own run organization, because a save binds every active team and a retry on the same day would otherwise be refused. This is test infrastructure, not an application `.delete(`.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `pnpm test:e2e` -- green, not run at the same time as `pnpm test`.
- `git diff --stat supabase/ package.json pnpm-lock.yaml` -- empty.
- Mutation probes that must fail the suite:
  - prefill ignores the anchor difference;
  - removing a step does not move a team to step 1;
  - hours counts a working type with no times as 0;
  - the UNCHANGED check skipped.

**Manual checks:**
- At 320 and 390 px, in light and dark, with the pilot and UJ-5 admins.

## Suggested Review Order

**The draft: every rule of the builder, pure and node-tested**

- Entry point: the prefill re-expresses each team's offset onto today, so the preview is unchanged.
  [`draft.ts:159`](../../apps/web/src/rotation/draft.ts#L159)

- A drop moves a step to an index; keys and teams follow their step.
  [`draft.ts:227`](../../apps/web/src/rotation/draft.ts#L227)

- Even spread: `floor(i·len/n)`, or wrap when teams outnumber steps.
  [`draft.ts:317`](../../apps/web/src/rotation/draft.ts#L317)

- Pre-send refusals, including "unchanged by projection" and "already changed today".
  [`draft.ts:777`](../../apps/web/src/rotation/draft.ts#L777)

- Preview grid, teams × dates over 1–5 cycles, projected only through the domain.
  [`draft.ts:627`](../../apps/web/src/rotation/draft.ts#L627)

- Figures: cycle length, working and non-working steps, hours unknown rather than 0.
  [`draft.ts:696`](../../apps/web/src/rotation/draft.ts#L696)

**Domain: the one addition**

- `projectedStepId`: the step a team stands on; `projectedShiftType` now delegates to it.
  [`projection.ts:177`](../../packages/domain/src/projection.ts#L177)

**Read and save**

- One snapshot from `organizations`: zone, teams, types, steps, assignments.
  [`list.ts:187`](../../apps/web/src/rotation/list.ts#L187)

- Scheduled and changed-today checks, over active teams only.
  [`list.ts:328`](../../apps/web/src/rotation/list.ts#L328)

- Pattern, then steps, then assignments from today; positions verified before binding.
  [`write.ts:178`](../../apps/web/src/rotation/write.ts#L178)

- Failures mapped by code and constraint name; the orphan-pattern outcome.
  [`write.ts:111`](../../apps/web/src/rotation/write.ts#L111)

**Screen: markup and state only**

- The draft outside the component, so the shift-type dialog's remount keeps it.
  [`draft-store.ts:46`](../../apps/web/src/rotation/draft-store.ts#L46)

- dnd-kit sensors: pointer, touch and keyboard on a handle, with Croatian announcements.
  [`rotation-section.tsx:180`](../../apps/web/src/rotation/rotation-section.tsx#L180)

- The page composed around the builder; shift-type writes also refresh `ROTATION_KEY`.
  [`postavke-rotacije.tsx:446`](../../apps/web/src/routes/postavke-rotacije.tsx#L446)

**Peripherals**

- `rotation.builder.*` copy, including drag announcements and the cycle-count plural.
  [`hr.json:317`](../../apps/web/src/i18n/locales/hr.json#L317)

- The team-term rule extended to the builder namespace, with self-tests.
  [`resource-hygiene.test.ts:79`](../../test/resource-hygiene.test.ts#L79)

- E2E: build, drag and keyboard reorder, spread, rename mid-draft, save and prefill.
  [`rotation.spec.ts:118`](../../e2e/rotation.spec.ts#L118)
