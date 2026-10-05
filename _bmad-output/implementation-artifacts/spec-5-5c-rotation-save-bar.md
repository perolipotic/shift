---
title: 'A sticky save bar keeps Spremi and Odbaci promjene in reach (5.5c)'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: 'b5ec6448fa34d298f98e2a55aaa7fae750145acf'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On rotation settings, "Spremi rotaciju" sits in the page header. Once the admin scrolls down to edit steps, offsets or the cycle preview, they must scroll back up to save. There is also no way to throw away an unsaved draft.

**Approach:** Move the save into a bar at the bottom of the builder, following mockup `setup-1.html` §2 (the `.savebar`). The bar sticks to the bottom of the viewport while the admin has an unsaved draft. It holds a hint, an "Odbaci promjene" button that discards the draft, and "Spremi rotaciju".

## Boundaries & Constraints

**Always:**
- **Move, don't duplicate (human, 2026-10-05).**
  - The one "Spremi rotaciju" button moves from the header into the bar. It keeps its `ref`, its `requestSave()`, its disabled and busy rules, and its erasure and cancel focus targets.
  - The button is always rendered. A save that the draft cannot pass still shows today's refusals.
- **Unsaved changes** means the store holds the admin's own draft for this organization (`stored !== null && stored.organizationId === snapshot.organizationId`). Reverting an edit by hand still counts as unsaved.
- **Sticky (human, 2026-10-05).**
  - From `sm` up, the bar is `sticky bottom-0` while there are unsaved changes, and static at the end of the builder otherwise.
  - On the phone (below `sm`) the bar is never sticky, as in the mockup. It stays in flow after the step actions, so it never stacks on the tab bar. Do not use `sm:hidden`.
  - The bar spans the full width of the builder, with a card background and a top border, as in the mockup. Nothing scrolls sideways at 390 px. The hint wraps above the buttons.
- **Hint.** While there are unsaved changes, the hint reads "Promjena vrijedi od {effectiveFrom} · na snazi je rotacija od {inForceFrom}". The in-force date is the effective date of the version governing today. When there are no unsaved changes, or no version is in force, show only the first part or nothing.
- **Odbaci promjene (human, 2026-10-05).**
  - It is an outline button (never `destructive`), shown only while there are unsaved changes, and disabled while `pending`. It has no confirmation dialog, because it drops only a local draft.
  - It calls `rotationDraftStore.reset()` and clears the same raised state that an edit clears (outcome, saved pending, erased count, cancelled, unavailable). The cancel offer and the override review are untouched.
  - Focus then moves to "Spremi rotaciju". The builder shows the prefill again.
- Every string goes through `t()`. Update the UX docs, and the UX-DR line for the bar.

**Ask First:**
- A confirmation before discarding.
- Showing the bar sticky on the phone.

**Never:**
- No second save button, and no change to the save, erasure or cancel flows.
- No `matchMedia`, `ResizeObserver` or `innerWidth` JavaScript for the layout. CSS only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dirty, scrolled | edit a step, scroll down (≥ sm) | the bar stays at the viewport bottom with hint, Odbaci promjene, Spremi rotaciju | N/A |
| Clean | no own draft | the bar is static at the end; no discard; save still refuses as UNCHANGED | existing |
| Discard | edit, press Odbaci promjene | the draft is gone, the prefill is shown, focus on Spremi, no discard button | N/A |
| Discard while pending | save in flight | discard is disabled | N/A |
| Phone | 390 px with a draft | the bar is in flow after the step actions, not sticky; no sideways scroll | N/A |
| Hint | draft from 01.11.2026, in force from 01.01.2020 | "Promjena vrijedi od 01.11.2026. · na snazi je rotacija od 01.01.2020." | N/A |
| Save flows | the 5.5a / 5.5g erasure and cancel flows | unchanged; focus still returns to the moved Spremi | existing |

## Epic AC Deviations

- **NARROWED:** "when the admin scrolls the page, a sticky save bar keeps Spremi and Odbaci promjene in reach". On the phone the bar is not sticky, because the mockup's phone stepper ends with its own save and stacking it on the tab bar costs too much height (human, 2026-10-05).

</frozen-after-approval>

## Code Map

Paths are under `apps/web/src` unless they say otherwise. Line numbers are as shipped (refreshed after the review patch).

- **Builder.** `features/rotation/components/rotation-section.tsx`:
  - the save bar `renderSaveBar` :1697, rendered last, after the history, only with a draft :1870; the moved save inside it, and the `saveButton` ref :321;
  - the focus users :327, :347, :1681, and the discard's own :461;
  - the state clearing `clearRaised()` :426, used by `change()` :435 and `discard()` :454;
  - the `saveNote` :1758;
  - the step actions :1360;
  - `requestSave` :593.
- **Helpers.**
  - `features/rotation/hooks/draft-store.ts`: `unsavedDraftOf` :210, `shownDraftOf` :194, `rotationDraftStore` :187 and its `reset()` :72, the stepper store's `reset()` :167.
  - `features/rotation/services/history.ts`: `inForceFromOf` :173 (the newest in-force `effectiveFrom` across active teams, from the assignments) and `saveBarHintOf` :191; `scheduledChangeOf` :145.
  - `features/rotation/utils/stepper.ts`: `saveBarClassOf` :153. `features/rotation/utils/element-ids.ts`: `ROTATION_SAVE_BAR_ID`.
- **Layout.**
  - The page frame `pages/postavke-rotacije.tsx:47` uses `p-6`, so the bar has `-mx-6 -mb-6 px-6` for full bleed.
  - The phone tab bar is `sm:hidden` at `features/navigation/components/chrome.tsx:750`, so the bar is sticky from `sm` up.
  - Scroll padding is at `index.css:395-399`; the sticky bar's own padding (`html:has(#rotation-save-bar[data-sticky='true'])`) at `index.css:411`.
- **Registries.**
  - `pages/prijava.test.ts`:
    - builder controls 19 :813;
    - strings 98 :2271;
    - `sm:hidden` count 2 :5158 (kept);
    - the no-`matchMedia` rule :5151;
    - `destructive` banned :5207.
  - `lib/i18n/locales/hr.json`: `rotation.builder.saveBar.label`, `.discard`, `.hint` and `.hintInForce`; `/test/resource-hygiene.test.ts` sanctions them.
- **e2e.**
  - `e2e/pages/rotation.page.ts:322` `saveButton`, `:332` `discardButton` (`exact: true`), plus `saveBar` and `saveBarHint`.
  - The "save from the save bar" comment is at `e2e/tests/rotation/rotation-phone.spec.ts:165`.
  - The unchanged-save tests at `rotation.spec.ts:259` and `rotation-phone.spec.ts:184` still pass.

## Tasks & Acceptance

**Execution:**
- [x] `rotation-section.tsx` -- the bar with the moved save, the discard, the hint and the sticky rules; a pure helper (and its test) for "unsaved changes" and the in-force date.
- [x] `hr.json` and the registries.
- [x] `e2e/tests/rotation/rotation-save-bar.spec.ts` -- Dirty scrolled (the bar in view after scrolling, at ≥ sm), Discard (prefill back, focus on Spremi), Clean (no discard), Phone (not sticky, no sideways scroll), Hint. The existing rotation specs still pass.
- [x] Docs -- the UX docs and the UX-DR line. `sprint-status.yaml`: 5-5c. Mark the 5.5c ledger entry resolved.

**Acceptance Criteria:**
- Given a draft on a desktop width, when the admin scrolls to the bottom of the builder, then "Spremi rotaciju" and "Odbaci promjene" stay visible without scrolling back.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green
- `pnpm exec playwright test rotation` -- expected: green

## Suggested Review Order

- Entry point: the bar holds the moved Spremi, the discard and the live hint; it renders only with a draft.
  [`rotation-section.tsx:1697`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L1697)

- Discard: clears raised state, the cancel refusal, the stepper and the draft, then focuses Spremi.
  [`rotation-section.tsx:454`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L454)

- Unsaved means the admin's own draft for this organization.
  [`draft-store.ts:210`](../../apps/web/src/features/rotation/hooks/draft-store.ts#L210)

- The hint: no hint without a valid date; the in-force date is the newest version governing today.
  [`history.ts:191`](../../apps/web/src/features/rotation/services/history.ts#L191)
  [`history.ts:173`](../../apps/web/src/features/rotation/services/history.ts#L173)

- Sticky only from sm while unsaved; scroll padding keeps focus clear of it.
  [`stepper.ts:153`](../../apps/web/src/features/rotation/utils/stepper.ts#L153)
  [`index.css:410`](../../apps/web/src/index.css#L410)
