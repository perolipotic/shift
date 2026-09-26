---
title: 'Story 2.4: Rotation configuration completes on a phone'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: '8424dff8220cc5436e0e0d7dc1c270b129a7bd92'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-3b-rotation-builder.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/postavke-rotacije` is one long panel of four numbered sections. On a phone that is a lot of scrolling, and UX-DR16 asks for a four-step sequence below 640 px. The 320 px checks (Q15, Q16, UX-DR43) cover the rotation screen only in its first state.

**Approach:** below `sm` (640 px), a stepper shows one section at a time: 1 Tipovi, 2 Uzorak, 3 Pomaci, 4 Pregled. There is a step bar above the sections and Natrag / Dalje below them. From `sm` up nothing changes: there is no stepper, and it is the 2.3b panel. **It is one DOM tree.** Every section is always rendered, and a section that is not the current step is hidden only below `sm` (`max-sm:hidden`). So the data, the validations and the order are the same at every width by construction.

## Boundaries & Constraints

**Always:**
- The stepper state is `{ current, reached }` (steps 1–4). It lives in a module-level store beside `rotationPreviewCyclesStore`, so the shift type dialog's remount keeps it. Every value set is validated.
- The pure rules live in `apps/web/src/rotation/stepper.ts` and are node-tested. The `.tsx` holds only markup:
  - Dalje goes to `current + 1` and raises `reached`.
  - Natrag goes to `current - 1`.
  - A step in the bar opens only when `step <= reached`. Those are the completed steps: backward always, and forward only up to what was already reached.
  - Dalje and Natrag are never disabled for draft reasons. Adding a gate would be a validation that the desktop panel does not have.
- **The step bar** (`sm:hidden`) is a `nav` holding an `ol` of four items built from `Button` (`h-11`, narrow padding, fits 320 px):
  - The current step is the `default` variant, with `aria-current="step"`.
  - A reached step is `outline`, with a check icon and an sr-only "završeno". The meaning is never carried by colour alone.
  - An unreached step is disabled.
  - Above the bar, "Korak N od 4" is shown. On every step change, focus moves to it (`tabIndex=-1`) and it scrolls into view.
- Natrag and Dalje sit below the sections (`sm:hidden`). Natrag is absent on step 1, and Dalje is absent on step 4. Dalje names the next step (`Dalje — pregled`, as in the mockup).
- **Unchanged at every width and every step:** the page header with `Spremi rotaciju`, the save note, the save outcome, and the read refusal notices. The save works from any step.
- Copy goes under `rotation.builder.stepper.*` in `hr.json`, registered in the inventories the way 2.3b registered its own keys. The team-term rule still applies.
- **E2E:**
  - At 390 px, walk every step, go back through the bar, build, save, and see the prefill.
  - At 320 px, `responsive.spec.ts` checks the rotation screen on each of the four steps: no horizontal scroll, and every control at least 44 px.
  - At desktop width there is no step bar and all four section headings are visible.

**Ask First:** saving from anywhere other than the header; auto-jumping to a step when a save is refused; any change to the hour-band or shift-type screens beyond making them fit 320 px.

**Never:** `matchMedia` or a JS width switch (CSS only); a second copy of any section's markup; any change to `draft.ts` rules, `list.ts`, `write.ts`, `packages/domain` or `supabase/`; new dependencies; coverage and rest warnings (2.5); an effective date (2.6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open at 390 px | fresh tab | Step 1 only, "Korak 1 od 4", only Tipovi enabled | N/A |
| Dalje ×2 | from step 1 | Step 3; bar: 1 and 2 done, 3 current, 4 disabled | N/A |
| Back via bar | on step 3, tap Uzorak | Step 2; Pomaci stays openable (reached 3) | N/A |
| Forward jump | reached 2, tap Pregled | Nothing (disabled) | N/A |
| Empty pattern | step 2, no steps, Dalje | Step 3 with the existing `offsetsEmpty` note | N/A |
| Dialog remount | step 1, open and close a type | Still step 1, draft kept | N/A |
| Refused save | step 4, EMPTY | Notice under the header, step and draft unchanged | existing key |
| Bad store value | set(7) or set('x') | State unchanged | ignored |
| ≥ 640 px | any stored step | All four sections, no bar, no Natrag or Dalje | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/rotation/rotation-section.tsx` -- lays out the page:
  - the page header with the Save button (:674);
  - the `lg` grid of `shiftTypes` and section 2;
  - `renderOffsets` (section 3) and `renderPreview` (section 4).
  
  The step bar and Natrag / Dalje go here. Wrap `{shiftTypes}` and each section in `max-sm:hidden` when it is not the current step. The wrappers must stay grid items and keep `min-w-0`.
- `apps/web/src/routes/postavke-rotacije.tsx` -- passes `heading` and `shiftTypes` (section 1, with its add-outcome notices) into `RotationSection`. It needs no change unless a wrapper has to move there.
- `apps/web/src/rotation/draft-store.ts` -- `createPreviewCyclesStore` is the pattern for `createStepperStore` and `rotationStepperStore`. Arrays only, never `Set` or `.delete` (a sweep forbids delete in `@/rotation`).
- New `apps/web/src/rotation/stepper.ts` (+ `stepper.test.ts`) -- `ROTATION_STEPS`, validation, next, back, open, and the message key per step.
- `apps/web/src/components/ui/button.tsx` -- the variants `default`, `outline` and `ghost`. Compose them; do not restyle them.
- `apps/web/src/i18n/locales/hr.json` -- `rotation.builder` (:~317).
- Inventories:
  - `test/resource-hygiene.test.ts`: `SANCTIONED_SCREEN_KEYS` (exact set, :~754) and `teamTermOutOfTurn`;
  - `test/localization-applied.test.ts`: `SOURCES` (:232-241, add `stepper.ts`) and `AUTHORED_VOCABULARY` (:~828);
  - `apps/web/src/routes/prijava.test.ts`: `SCREENS` and `KEY_SOURCES`, if the new file carries keys.
- `e2e/responsive.spec.ts:84-89` -- the rotation entry waits for `patternHeading`, which is hidden on step 1 at 320 px. It must become a four-step walk.
- `e2e/support/layout.ts` -- `expectNoHorizontalScroll` and `expectTouchTargets` (they skip invisible elements).
- `e2e/rotation.spec.ts` -- the desktop flow, the drag helpers and the per-attempt team setup, for reuse at 390 px.
- Mockup: `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/mockups/rotation-config-1.html:175-199` (phone stepper, for layout only).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/rotation/stepper.ts`, `stepper.test.ts` -- the steps and their transition rules, pure. Every stepper row of the matrix.
- [x] `apps/web/src/rotation/draft-store.ts`, `draft-store.test.ts` -- `rotationStepperStore`, which validates, notifies only on a change, and ignores bad values.
- [x] `apps/web/src/rotation/rotation-section.tsx` -- the step bar, the progress line with focus, the per-section `max-sm:hidden` and the Natrag / Dalje bar. The markup stays markup.
- [x] `apps/web/src/i18n/locales/hr.json` -- `rotation.builder.stepper.*`: the nav label, the progress line, the four step names, done, back, and next per target step.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` -- register the new keys and source.
- [x] `e2e/rotation-phone.spec.ts` -- at 390 px with touch: the step walk, back through the bar, the disabled forward jump, then build `[A, Slob]`, save from the header and see the prefill. A desktop test checks that there is no bar and all four headings are visible.
- [x] `e2e/responsive.spec.ts` -- the rotation screen at 320 px, checked on each of the four steps, reached through Dalje.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `2-4-rotation-configuration-completes-on-a-phone: in-progress`.

**Acceptance Criteria:**
- Given 320 px and the pilot or UJ-5 admin, when each step is shown, then there is no horizontal page scroll, every control is at least 44 px, and the preview grid scrolls inside its own container.
- Given the hour bands list and dialog and the shift type dialogs at 320 px, when they are exercised, then each completes with no horizontal page scroll (a regression only, and fixed only if broken).
- Given the built bundle, when it is swept, then no string literal is added and no `matchMedia` appears.

## Design Notes

**Why CSS and not a JS width switch:** one tree means Dalje never re-mounts a section. The draft, the dnd-kit context and the uncontrolled inputs survive. A resize across 640 px also swaps layouts with no state to reconcile. Hidden sections are `display:none`, so they leave the accessibility tree and the E2E visibility filters.

**Reached, not validated:** "completed" is "has been passed with Dalje". Save refusals (EMPTY, NO_TEAMS, UNCHANGED…) stay the only validations, at every width.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `pnpm test:e2e` -- green. Stop any Vite already on 5173 first, and do not run it at the same time as `pnpm test`.
- `git diff --stat supabase/ packages/ package.json pnpm-lock.yaml` -- empty.

**Manual checks:**
- At 320 and 390 px, in light and dark: walk the stepper, rotate across 640 px mid-step, and check that the draft is kept.

## Suggested Review Order

**The stepper rules: pure, node-tested**

- Entry point: `{ current, reached }` and the step list the whole stepper turns on.
  [`stepper.ts:22`](../../apps/web/src/rotation/stepper.ts#L22)

- With no draft, show step 1 without touching the store.
  [`stepper.ts:45`](../../apps/web/src/rotation/stepper.ts#L45)

- Dalje raises `reached`; Natrag steps back; the bar opens only reached steps.
  [`stepper.ts:82`](../../apps/web/src/rotation/stepper.ts#L82)

- One DOM tree: a non-current section is only `max-sm:hidden`.
  [`stepper.ts:128`](../../apps/web/src/rotation/stepper.ts#L128)

**State that survives the dialog's remount**

- Validated module store beside the preview cycles; ignores non-steps and unreached steps.
  [`draft-store.ts:136`](../../apps/web/src/rotation/draft-store.ts#L136)

**Screen: markup only**

- The shown stepper derived once per render from store and draft.
  [`rotation-section.tsx:222`](../../apps/web/src/rotation/rotation-section.tsx#L222)

- Focus flag raised only when the store actually changed — no stale focus steal.
  [`rotation-section.tsx:720`](../../apps/web/src/rotation/rotation-section.tsx#L720)

- Progress line and the `nav` step bar, both `sm:hidden`.
  [`rotation-section.tsx:734`](../../apps/web/src/rotation/rotation-section.tsx#L734)

- Sections wrapped per step; the 1+2 grid hides as a group on steps 3–4.
  [`rotation-section.tsx:857`](../../apps/web/src/rotation/rotation-section.tsx#L857)

**Peripherals**

- `rotation.builder.stepper.*` copy.
  [`hr.json:363`](../../apps/web/src/i18n/locales/hr.json#L363)

- Keys sanctioned under the team-term rule.
  [`resource-hygiene.test.ts:804`](../../test/resource-hygiene.test.ts#L804)

- Phone E2E: walk, bar, remount, save, prefill, no focus on mount.
  [`rotation-phone.spec.ts:39`](../../e2e/rotation-phone.spec.ts#L39)

- Desktop: no bar, all four sections.
  [`rotation-phone.spec.ts:208`](../../e2e/rotation-phone.spec.ts#L208)

- 320 px measured on each of the four steps.
  [`responsive.spec.ts:123`](../../e2e/responsive.spec.ts#L123)

- Bounded advisory lock so two rotation-saving specs never overlap or leak.
  [`database.ts:80`](../../e2e/support/database.ts#L80)
