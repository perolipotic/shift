---
title: 'Story 2.5: Saving a rotation reports what it will actually do'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: '3b792ba426df215e5f43d7573affd38884237619'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-3b-rotation-builder.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** a saved rotation can leave a working shift type uncovered, double up two teams on one, or run working steps back to back, and the admin never hears about it. CAP-10, FR-25, FR-26 and UX-DR23 are unmet.

**Approach:**
- A new pure `packages/domain/src/warnings.ts` returns warnings as data for the rotation being saved.
- The builder shows them with the save confirmation.
- They never block, and they disappear with the next edit or a reload.

## Boundaries & Constraints

**Always:**
- **The domain returns codes and values, never text:**
  - `{ code: 'COVERAGE_GAP', dates: [{ date, shiftTypeIds }] }`;
  - `{ code: 'DUPLICATE_COVERAGE', dates: [{ date, shiftTypeIds }] }`;
  - `{ code: 'REST_GAP', minutes, shiftTypeIds, endless }`.

  An empty array means no warning of that code.
- **Coverage window:** the next full cycle, `cycleLength` dates starting on the save date. Each team's type comes from `projectedShiftType`, over the draft's synthetic steps and assignments.
- **Coverage gap (human decision 2026-09-26, option b):** a date on which a WORKING shift type that appears in the pattern has no team.
- **Duplicate coverage:** a date on which two or more teams are on the same working type.
- **Rest gap (human decision 2026-09-26, option a):**
  - A run of two or more CYCLICALLY consecutive working steps in the pattern. The run wraps from the last step to the first.
  - `minutes` is the sum of the run's nominal durations on the save date (`shiftDurationOn`), and `null` if any duration is unknown.
  - `endless` is true when every step works; `minutes` is then one whole cycle.
  - One warning per run, reported once for the pattern, not per team.
- **Copy must be true on the clock.** For the pilot it reads `24 h rada bez slobodnog dana između (Dan → Noć)`, never `bez pauze`. Durations use the existing duration keys (from minutes). Every count uses one/few/other. Dates go through `formatIsoDate` / `formatIsoDayMonth`. Type names are shown as text.
- **When they are computed and shown:**
  - Only after a save lands (`ok: true`), from the draft that was saved, with the save date the save used.
  - They are shown in the success `Notice` (`role="status"`) under the header, at every width and on every 2.4 step.
  - They are cleared by the same `setOutcome(null)` a draft change already triggers. A reload or a refused save shows none.
  - A throw while computing is logged, and the plain confirmation still shows.
- Keys go under `rotation.builder.warnings.*`, registered in the inventories as 2.3b and 2.4 did. The team-term rule holds (`smjen` names a team).

**Ask First:** showing warnings before a save or live while editing; computing them over more than one cycle; any schema, RPC or policy change.

**Never:**
- blocking or confirming a save because of a warning;
- a standing banner or a persisted warning;
- warning logic or projection in `apps/web`, beyond calling the domain;
- a formatted string from `packages/domain`;
- reading fire rank or team position;
- an effective date (2.6);
- new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pilot | `[Dan, Noć, Slob, Slob]`, A–D on steps 1–4 | No gap, no duplicate. One REST_GAP of 1440 min for Dan → Noć, not endless | N/A |
| Shared offset | pilot, A and B both on step 1 | Gaps: day 1 Noć, day 4 Dan. Duplicates: day 1 Dan, day 2 Noć. Save succeeds | N/A |
| UJ-5 seed | 5 steps, offsets 0, 1, 2 | Gaps on 4 of the 5 dates, no duplicate. REST_GAP 1440 min, J → P → N | N/A |
| Separated | `[Dan, Slob, Noć, Slob]` | No REST_GAP | N/A |
| Wraps | `[Noć, Slob, Dan]` | REST_GAP Dan → Noć, 1440 min | N/A |
| Endless | `[Dan]` | REST_GAP 720 min, endless | N/A |
| Unknown times | a working type with no version | REST_GAP with minutes `null`, "trajanje nepoznato" | N/A |
| Next edit | after a warned save, change a step | Warnings gone | N/A |
| Refused save | UNCHANGED / EMPTY | Refusal only, no warnings | existing key |

</frozen-after-approval>

## Code Map

- `packages/domain/src/projection.ts` -- `projectedShiftType` :219. Warnings project through it; they never reimplement the modulo. `daysBetween` :81.
- `packages/domain/src/duration.ts` -- `shiftDurationOn` :146 returns `0` for a non-working type and `null` for a working type with no version. `ShiftType` has `isWorking`.
- `packages/domain/src/calendar.ts` -- `checkDate` and `civilDayNumber`, internal to the package. The next date can be computed from them, or copied from the approach in `apps/web` `nextIsoDate`.
- `packages/domain/src/index.ts` -- re-export the warnings API and its types.
- `packages/domain/test/fixtures.ts` -- the pilot and UJ-5 types, versions, steps and assignments, for the domain tests. `purity.test.ts` sweeps the package.
- `apps/web/src/rotation/draft.ts` -- the input the domain needs:
  - `draftStepsOf` :85 and `draftAssignmentOf` :95 are the synthetic steps and assignments;
  - `figuresOf` :696 shows the duration-on-a-date pattern;
  - `datesFrom` :422.
- `apps/web/src/rotation/write.ts` -- `RotationSaveOutcome` :52 and `ROTATION_SAVED_MESSAGE_KEY` :326.
- `apps/web/src/rotation/rotation-section.tsx` -- `save()` computes `savedOn` and calls `saveRotation`. The success `Notice` sits just after the page header. `change()` already clears `outcome`.
- New `apps/web/src/rotation/warnings.ts` (+ test) -- calls the domain from the snapshot, draft and date, and maps each code to its key and values: type names by id, formatted dates, the duration key, the plural count. It is the only place those keys are chosen.
- `apps/web/src/i18n/format.ts` -- `formatIsoDate` :283 and `formatIsoDayMonth` :295.
- `apps/web/src/shift-types/list.ts` -- `shiftTypeDurationMessageKey` and `durationValuesOf`, for the minutes.
- Inventories:
  - `test/resource-hygiene.test.ts`: `SANCTIONED_SCREEN_KEYS` and `SANCTIONED_PLURAL_KEYS`;
  - `test/localization-applied.test.ts`: `SOURCES` and `AUTHORED_VOCABULARY`;
  - `apps/web/src/routes/prijava.test.ts`: `KEY_SOURCES` and the builder's string and control counts.
- `e2e/rotation.spec.ts`, `e2e/support/rotation.ts`, `e2e/support/database.ts` -- the save flow, and the `holdRotation` lock both rotation specs share.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/warnings.ts`, `src/index.ts`, `test/warnings.test.ts` -- coverage, duplicate and rest-gap rules. Every domain row of the matrix, on both fixtures, plus a check that nothing reads names, ranks or positions.
- [x] `apps/web/src/rotation/warnings.ts`, `warnings.test.ts` -- the draft-to-domain adapter and the code-to-key/values mapping. The pilot's `24 h` copy, and plural cases 1, 2 and 5.
- [x] `apps/web/src/rotation/rotation-section.tsx` -- compute the warnings after a landed save and render them as a list inside the success Notice.
- [x] `apps/web/src/i18n/locales/hr.json` -- `rotation.builder.warnings.*`.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` -- the inventories.
- [x] `e2e/rotation.spec.ts` -- in the run's org:
  - build `[A, B, Slob]` with two teams on step 1, save, and see a gap, a duplicate and the rest gap in the confirmation;
  - edit a step and see them gone.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `2-5-…: in-progress`.

**Acceptance Criteria:**
- Given any warning, when the save runs, then the rows are written exactly as they would be without it (the save is never blocked).
- Given the built bundle and the `apps/web` sources, when swept, then no warning text is a literal, and no `@shift/domain` import appears in a `.tsx`.

## Design Notes

**`minutes`, not `hours`.** The AC's `{ code: 'REST_GAP', hours: 24 }` shows the shape: data, not prose. Durations here are integer minutes everywhere (an 8 h 30 min type exists in principle), and the i18n duration keys take minutes. So `minutes: 1440` renders `24 h`.

**Why the pilot's rest gap is 24 h, and what the copy may say.** On the clock, the pilot is 12 h (Dan), 24 h off, 12 h (Noć), 48 h off. The rest gap counts working steps with no free step between them (FR-26, "computed from nominal durations"), so the pilot reports 12 + 12 = 1440 minutes. The copy says "24 h rada bez slobodnog dana između", which is true, rather than "24 h bez pauze", which would not be.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `pnpm test:e2e` -- green. Stop any Vite already on 5173 first, and do not run it at the same time as `pnpm test`.
- `git diff --stat supabase/ package.json pnpm-lock.yaml` -- empty.

**Manual checks:**
- Save as the pilot admin at 390 and 1280 px: the confirmation carries the 24 h rest gap, and it is gone after an edit.

## Suggested Review Order

**Domain: the warnings, as data**

- Entry point: one call returns coverage, duplicate and rest-gap warnings for the saved rotation.
  [`warnings.ts:90`](../../packages/domain/src/warnings.ts#L90)

- The three shapes; codes and values only, never text.
  [`warnings.ts:35`](../../packages/domain/src/warnings.ts#L35)

- Cyclic runs of working steps; wraps last → first, endless when every step works.
  [`warnings.ts:179`](../../packages/domain/src/warnings.ts#L179)

- The window: `cycleLength` dates from the save date, cut at the calendar's end.
  [`warnings.ts:158`](../../packages/domain/src/warnings.ts#L158)

- Inverse of `civilDayNumber`, so the window walks dates without `Date`.
  [`calendar.ts:57`](../../packages/domain/src/calendar.ts#L57)

**Web: adapter and copy**

- Warnings computed only after a landed save; a throw logs and keeps the confirmation.
  [`warnings.ts:223`](../../apps/web/src/rotation/warnings.ts#L223)

- Codes to keys and values: names, formatted dates, duration keys, plurals.
  [`warnings.ts:159`](../../apps/web/src/rotation/warnings.ts#L159)

- The one place a warning's key is chosen.
  [`warnings.ts:39`](../../apps/web/src/rotation/warnings.ts#L39)

**Screen**

- The save stores the shown outcome; `change()` already clears it.
  [`rotation-section.tsx:340`](../../apps/web/src/rotation/rotation-section.tsx#L340)

- Warnings listed inside the success Notice (spans with list roles, since Notice is a `<p>`).
  [`rotation-section.tsx:869`](../../apps/web/src/rotation/rotation-section.tsx#L869)

**Peripherals**

- `rotation.builder.warnings.*`, including "24 h rada bez slobodnog dana između".
  [`hr.json:363`](../../apps/web/src/i18n/locales/hr.json#L363)

- Plural and screen keys sanctioned.
  [`resource-hygiene.test.ts:86`](../../test/resource-hygiene.test.ts#L86)

- E2E: shared offset saves with gap, duplicate and rest gap; an edit clears them.
  [`rotation.spec.ts:296`](../../e2e/rotation.spec.ts#L296)

- Domain tests: both fixtures, wrap, endless, unknown, leap-day and calendar-end windows.
  [`warnings.test.ts:1`](../../packages/domain/test/warnings.test.ts#L1)
