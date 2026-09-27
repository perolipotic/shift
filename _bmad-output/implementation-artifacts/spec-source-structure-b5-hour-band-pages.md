---
title: 'Source structure B5 — the hour-band screens become thin pages over features/hour-bands'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: 'f5d852ea6252ef20423af8f865733ef73df99d41'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-source-structure-b4-shift-type-pages.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two pages still hold their screen's refs, state, query, writes and `render*` helpers:
- `pages/organizacija.satni-pojasi.tsx` (525 lines), the band list, add dialog, table and timeline;
- `pages/organizacija.satni-pojasi.$id.tsx` (477 lines), the band edit dialog over the list.

**Approach:** Follow B4 exactly (its spec, Change Log and `shift-type-screens.fixture.ts`):
- one hook per screen in `features/hour-bands/hooks/`;
- components in `features/hour-bands/components/`;
- leftover pure logic in `utils/`;
- one fixture, `hour-band-screens.fixture.ts`, holding two disjoint sets and the exact exemptions.

Each page keeps its route (with its `beforeLoad` guard and `FIRST_DESTINATION`) and its composition. The edit page also keeps its `key={id}` wrapper and `<OrganizacijaSatniPojasiScreen />` behind the dialog. DOM, behaviour and test outcomes stay identical.

## Boundaries & Constraints

**Always:**
- The DOM does not change.
- The exports `OrganizacijaSatniPojasiScreen`, `organizacijaSatniPojasiRoute`, `OrganizacijaSatniPojasScreen` and `organizacijaSatniPojasRoute` stay.
- Every guard keeps its meaning, with B4's families applied to both sets:
  - a recursive completeness check over all of `features/hour-bands`, with the exact exemption set asserted in the test;
  - disjoint sets, with the page first and a per-file size floor;
  - each named handler declared once per set, in the hook, at 2-space indentation. List: `submit`, `openAdding`. Edit: `submit`, `remove`, `refresh`, `close`, and `clearOutcomes` if it is introduced;
  - a remount guard on the edit page (`<HourBandScreen key={id} id={id} />`, new — hour bands have none today);
  - ref-once-in-hook. This covers `ref={x}` AND `closeRef={x}`, since the edit page attaches `closeButton` through `closeRef`;
  - no handler shadowing outside the hook;
  - every `<form>` bound to a named submit;
  - writes and `supabaseClient(` only in the hook;
  - `localization-applied` derives the parts from the fixture and a recursive walk, with an exact count.
- Existing single-file checks follow B4's split:
  - counts are over the set and also in the hook: `useQuery(` 1, `hourBandsQueryOptions(` 1, `queryKey:` equals the `HOUR_BANDS_LIST_KEY` count, and invalidates;
  - bans apply per part: `useMutation`, `@shift/domain`, `1440|MINUTES_PER_DAY|startMinute[-+%]`, `shift-slot`;
  - needles are asserted in the file that renders them: the two `type="time"` inputs, `renderBar`'s `aria-hidden`, `<TimelineGap`, `t('organization.hourBands.uncovered')` and `{segment.name}`.
- Shared element ids live in one exempt `utils/element-ids.ts`, only if an id crosses files.

**Ask First:**
- A guard whose count or assertion would have to change.
- Any DOM or behaviour difference.

**Never:**
- No new UI.
- No change to `services/{list,write}.ts` beyond moving inline helpers.
- No barrels.
- No E2E change.
- Teams and other screens are out of scope.

</frozen-after-approval>

## Code Map

(Line numbers may be off by a few lines.)

- **`pages/organizacija.satni-pojasi.tsx`**
  - `OrganizacijaSatniPojasiScreen` 112–503:
    - refs `nameField`/`startField`/`creating`;
    - `useState` `pending`/`failure`/`created`/`adding`/`typedStart`;
    - effect 126;
    - `useQuery(hourBandsQueryOptions)` 130.
  - Handlers: `openAdding` 137, and `submit` 143–205 (`createHourBand(`, the session read, invalidate).
  - `renderBar` 207.
  - JSX: header, Callout, created Notice, add Dialog (276–383), skeleton, table card, timeline card (393–470).
  - Route 505–525.
- **`pages/organizacija.satni-pojasi.$id.tsx`**
  - The wrapper 88–92.
  - `HourBandScreen` 94–455:
    - refs `nameField`/`startField`/`closeButton`/`writing`;
    - seven `useState`;
    - `useQuery` 113.
  - Handlers:
    - `close` 128, `refresh` 133;
    - `submit(event, band)` 146 (`updateHourBand(`/`setFailure`);
    - `remove(band)` 194 (`removeHourBand(`/`setRemoveFailure`).
  - Render helpers: `renderRemoveRefusal` 231, `renderRemove` 238, `renderConfirm` 266, `renderEnd` 310, `renderDuration` 322, `renderBand` 339 (keyed `hourBandFormKey(band, saves)`), `renderBody` 413.
  - The list renders behind the dialog at 422–452. `closeRef={closeButton}` is at 431.
  - Route 457–477.
- **`pages/prijava.test.ts`**
  - `HOUR_BAND_LIST`/`HOUR_BAND_EDIT` (188–191) become fixture sets.
  - `SCREENS` controls: list 7, edit 6 (540, 543).
  - `t()`: list 32, edit 15 (~1612–1745).
  - `FORM_SCREENS` (675–690), `IN_FLIGHT_HANDLERS` 793 (`remove`), totals 10/18 (4917–4968).
  - Sweeps 4796–5139.
  - Checks to retarget: one-read 3385–3409, band bans 3411–3426, `renderBar` 3428.
  - B4's families to mirror: 2285, 2303, 2355–2421, 3443–3497.
- **`test/localization-applied.test.ts`**: `SOURCES` 324–327 lists both pages and both services. Mirror `shiftTypesScreenParts()` (97–109) and its equality case (~428–446).
- **`router.test.ts`**: imports and `component:` pins at 25–37 and 230–253. Unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `features/hour-bands/{hooks,components,utils}/` and the fixture -- extract both screens.
- [x] Both pages -- compose only.
- [x] `pages/prijava.test.ts`, `test/localization-applied.test.ts` -- retarget per Boundaries, with counts unchanged, and add B4's guard families.

**Acceptance Criteria:**
- Given both pages, when measured, then each is ≤ 150 lines with no `useQuery`, `useState`, `useRef` or effect.
- Given each new or retargeted guard, when a planted mutation breaks its target, then the guard fails. Revert each afterwards. Spot-check at least:
  - the remount `key` dropped;
  - a component-local `closeButton` ref;
  - `removeHourBand(` in a component;
  - `preventDefault` removed from the edit hook's `submit`;
  - `aria-hidden` dropped from the bar;
  - an extra `t()` in the timeline;
  - a stray nested file.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test`, the web build and `pnpm test:e2e` run, then all pass. Unit counts grow only by added cases, and E2E is 68/68.

## Spec Change Log

- Implementation note (no intent change):
  - One fixture, `features/hour-bands/hour-band-screens.fixture.ts`, holds `HOUR_BAND_LIST_PARTS`, `HOUR_BAND_EDIT_PARTS` and `HOUR_BAND_SCREENS_EXEMPT` (the fixture, `services/list.ts`, `services/write.ts`). No `utils/` module and no id module were needed: no pure logic was left over, and every id stays a literal inside its own set.
  - List set: page (header, explainer Callout, the two notices), `hooks/use-hour-band-list.ts`, `components/hour-band-add-dialog.tsx`, `hour-band-list-section.tsx` (skeleton, then table and timeline), `hour-band-table.tsx`, `hour-band-timeline.tsx` (keeps `renderBar` as an inner function at 2-space indentation so `componentFunction` still extracts it).
  - Edit set: page (keeps the `key={id}` wrapper and `HourBandScreen`, which composes the dialog over `<OrganizacijaSatniPojasiScreen />` with `closeRef={closeButton}`), `hooks/use-hour-band-edit.ts`, `components/hour-band-edit-body.tsx` (the form, the end and the duration), `hour-band-remove.tsx` (the offer, the confirmation and the refusal).
  - No `clearOutcomes` was introduced: the arm/disarm inline arrows stay inline in the components, calling the hook's setters.
  - `prijava.test.ts`: every hour band count is unchanged. New cases: recursive completeness with exact exemptions, disjoint sets, page first, a 150-character floor and one declaration per handler in its hook; remount; ref-once-in-hook over `ref=`/`closeRef=` (plus a `closeRef={closeButton}` pin); no handler shadowing; forms bound; writes and `supabaseClient(` only in the hook. Retargeted: reads-once (set counts plus hook counts, `useMutation` per part), fields (count over the set, `type="time"` in the part that renders it, bans per part), bar (read from the timeline part, `shift-slot` per part over both sets). `localization-applied.test.ts` gains `hourBandsScreenParts()` and a required-parts case with an exact count of 10.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shift/web build` -- expected: exit 0.
- `pnpm test` -- expected: pass. Rebuild first, and record the baseline first.
- `pnpm test:e2e` -- expected: 68/68, with port 5173 free and not in parallel with unit tests.

## Suggested Review Order

**The thin pages**

- The list page composes the header, explainer and the list section.
  [`organizacija.satni-pojasi.tsx:94`](../../apps/web/src/pages/organizacija.satni-pojasi.tsx#L94)

- The edit page keeps the per-band remount and the dialog over the list, with `closeRef`.
  [`organizacija.satni-pojasi.$id.tsx:103`](../../apps/web/src/pages/organizacija.satni-pojasi.$id.tsx#L103)

**Where the state went**

- The list hook: refs, focus effect, the query and the create write.
  [`use-hour-band-list.ts:40`](../../apps/web/src/features/hour-bands/hooks/use-hour-band-list.ts#L40)

- The edit hook: save and remove, each with its in-flight guard; focus after a landed removal.
  [`use-hour-band-edit.ts:50`](../../apps/web/src/features/hour-bands/hooks/use-hour-band-edit.ts#L50)

**Guards**

- The two disjoint screen sets and the exact exemptions.
  [`hour-band-screens.fixture.ts:1`](../../apps/web/src/features/hour-bands/hour-band-screens.fixture.ts#L1)
