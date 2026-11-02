---
title: 'Admin surfaces read in glass (15.4)'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: '3201fbf2faabbfbcf66cdede088c1065350a2673'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The rotation builder's save bar is still the pre-glass strip: full width, bleeding over the page padding (`-mx-6 -mb-6`), opaque `bg-card` with a top border. From `sm` up it is sticky at the viewport bottom with content scrolling under it, which is the chrome case the epic gives to `glass-over-content`. In the change dialogs, the preview box (`change-preview-output.tsx`) is a translucent `bg-muted/40` fill on the glass panel, where reading surfaces must be opaque. Every other admin screen already composes opaque Cards, Notices and primitives on the backdrop: Za odluku, the resolution and request screens, Ljudi and the member page, day detail, Organizacija, hour bands, teams and shift types.

**Approach:** Make the save bar a floating `glass-over-content` pill, `rounded-3xl`, inside the page padding. From `sm` up it is sticky 16 px above the viewport bottom while unsaved, and it stays in flow on a phone. Its hint text becomes `foreground`, and *Odbaci promjene* moves to Button's `chrome` variant. Make the preview box opaque `bg-muted`. Update the pins, the e2e test, DESIGN.md, EXPERIENCE.md and UX-DR16.

## Boundaries & Constraints

**Always:**
- No change to behaviour, routes, copy, i18n keys or data. The bar's stickiness rules (only from `sm`, only while unsaved, `data-sticky`) stay.
- Glass comes only from the existing `glass-over-content` utility. `index.css` keeps exactly 3 `backdrop-filter` utilities.
- Text on the bar is `foreground`-strength (DESIGN rule 2).

**Ask First:**
- Any restyle of a `components/ui/*` primitive, or a new or retuned token.
- Any further admin screen whose composition turns out to be wrong during manual checks.

**Never:**
- The 15.7 filter bar, member screens (15.3), or dark and fallback tuning (15.5).
- A `backdrop-blur` or `blur-*` class in a `.tsx` file.
- An `outline` Button on over-content glass. Its `input` border measures 2.73:1 there over an ink button in both themes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unsaved, ≥ 640 px | draft edited, page scrolled | Glass pill sticky 16 px above the bottom, nothing drawn over it. A focused control scrolls above it. | N/A |
| Clean, any width | no draft changes | Same pill in flow at the end of the builder, static | N/A |
| Phone, unsaved | < 640 px | In flow after Natrag / Dalje, never sticky. The hint wraps above the buttons. | N/A |
| Reduced transparency or forced colours | emulated | The utility's existing fallbacks (opaque `--card`, or `Canvas` + `CanvasText`) | N/A |
| Change dialog preview | override or roster form with a change | Preview box opaque `bg-muted`, words unchanged | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/rotation/utils/stepper.ts:141-155` -- `SAVE_BAR_CLASS` and the sticky variant. Keep `saveBarClassOf`'s shape.
- `apps/web/src/features/rotation/components/rotation-save-bar.tsx:13-25` (doc), `:56` (hint `text-muted-foreground`), `:74` (Discard `variant="outline"`).
- `apps/web/src/components/ui/button.tsx:49` -- the `chrome` variant: borderless `foreground`, `glass-active` hover, ring with no offset. Read it only; do not change it.
- `apps/web/src/index.css:555-567` -- the scroll padding keyed on `data-sticky` (6rem). The float adds 1 rem.
- `apps/web/src/features/calendar/components/change-preview-output.tsx:72` -- `bg-muted/40`.
- `apps/web/src/features/rotation/utils/stepper.test.ts:192-207` -- pins `-mx-6`, `-mb-6`, `px-6`, `border-t`, `bg-card` and `sm:bottom-0`.
- `e2e/tests/rotation/rotation-save-bar.spec.ts:115-133` -- expects the bar's bottom to equal the viewport height.
- `test/theme-contrast.test.ts:1064-1180` -- the chrome block. It already measures `foreground`, the `glass-active` pill and `ring` on `glass-over-content` over every fill, including the ink button. The `chrome` hover is the pill at 60 %, between glass and pill, so it is covered.
- `test/theme-applied.test.ts:218` -- the built CSS emits `glass-over-content` unprefixed.
- Docs: DESIGN.md rule 1 (:305, "Nothing else is glass"), rule 7 (:311, layers), §Shell register (:346), `updated:` (:5); EXPERIENCE.md :120 (save bar) and §Responsive :191 (the 15.3 bullet); `epics.md:135` UX-DR16.
- Checked with no change: `pages/za-odluku*.tsx` (queue in a Card; tabs and rows inside it), `conflict-resolution-body.tsx`, `resolution-option.tsx`, `replacement-picker.tsx`, `leave-request-review-body.tsx`, `member-table.tsx`, `ljudi.$id.tsx` cards, `day-detail-dialog.tsx` (bordered sections on the ≥ .85 panel), `organization-settings-card.tsx`, `hour-band-*`, `team-*`, `shift-type-*`, `rotation-pattern-card.tsx` and `hour-band-timeline.tsx` (StatTiles inside Cards), `rotation-preview-card.tsx` (opaque sticky column, no blur).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/rotation/utils/stepper.ts` -- Base class: `glass-over-content flex flex-wrap items-center gap-3 rounded-3xl px-4 py-3 text-foreground`, without `-mx-6 -mb-6 border-t bg-card`. Sticky: add `sm:sticky sm:bottom-4 sm:z-20`. Update the doc comment.
- [x] `apps/web/src/features/rotation/components/rotation-save-bar.tsx` -- Hint `text-foreground`; Discard `variant="chrome"`; rewrite the doc comment. -- Over-content glass allows no muted text and no outline boundary.
- [x] `apps/web/src/index.css` -- Raise the scroll padding to `7rem` and note the 1 rem float.
- [x] `apps/web/src/features/calendar/components/change-preview-output.tsx` -- `bg-muted/40` → `bg-muted`.
- [x] `apps/web/src/features/rotation/utils/stepper.test.ts` -- Pin the new classes and `sm:bottom-4`, and pin that the base class carries no `bg-card`, `-mx-6` or `border-t`.
- [x] `e2e/tests/rotation/rotation-save-bar.spec.ts` -- Expect the bar's bottom at the viewport height minus 16 px. Keep the no-overlap check.
- [x] Docs -- DESIGN.md: add the save bar to rule 1's glass list and to rule 7's layer count (from `sm` there is no tab bar, so the sidebar, the bar and one panel make three). Set `updated: 2026-11-02`. EXPERIENCE.md :120 -- the bar is a floating glass pill, *Odbaci promjene* a borderless chrome button. §Responsive -- add the admin screens to the 15.3 bullet's opaque-cards sentence. `epics.md` UX-DR16 -- add "a floating glass pill".

**Acceptance Criteria:**
- Given the repo, when it is searched, then no `.tsx` uses `blur-*` or `backdrop-blur`, and `index.css` has exactly 3 `backdrop-filter` utilities.
- Given Za odluku, the resolution and request screens, Ljudi and the member page and its dialogs, the day detail and its change dialogs, the rotation builder, Organizacija, hour bands and teams, in both themes at 390 px and 1280 px, then every content surface is an opaque Card, Notice or primitive. The only glass is the chrome, the panels and the save bar.
- Given the PR, then lint, typecheck, unit and e2e tests are green.

## Epic AC Deviations

None. The epic lists surfaces only. Za odluku's tabs and rows, the resolution option and its consequence strip, the request decision, the member page and its dialogs, the day detail, Organizacija, hour bands and teams were checked and need no change.

## Spec Change Log

## Design Notes

**Why `chrome` and not `outline` for Discard.** Over-content glass is .80. With an ink button scrolled under it, the ground measures 2.73:1 against the light `--input` and 2.73:1 against the dark one. That fails 3:1, and only retuning tokens (15.5) could fix it. The chrome block already covers the `chrome` variant's text, ring and pill on over-content glass.

**Why glass in flow too.** One class keeps the bar the same element in both states, and Discard only renders while unsaved, which on a phone is in flow. On a phone the bar is glass over the page next to the tab bar: two blurred layers, three with a dialog open.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && pnpm typecheck && pnpm test` -- expected: green.
- e2e -- CI runs it on the PR. It cannot run locally, because port 5173 belongs to another session.

**Manual checks:**
- Screenshots on a temporary Vite on port 5174 against the shared stack, with no reset: the rotation builder unsaved at 1280 px scrolled mid-page, and at 390 px, in both themes; a change dialog's preview in light.

## Suggested Review Order

**The save bar as floating glass**

- Entry point: one glass class for both states, sticky 16 px up only from `sm`.
  [`stepper.ts:151`](../../apps/web/src/features/rotation/utils/stepper.ts#L151)

- Muted text is not allowed on over-content glass, so the hint is foreground.
  [`rotation-save-bar.tsx:58`](../../apps/web/src/features/rotation/components/rotation-save-bar.tsx#L58)

- Discard is borderless `chrome`, because an outline border measures 2.73:1 there.
  [`rotation-save-bar.tsx:77`](../../apps/web/src/features/rotation/components/rotation-save-bar.tsx#L77)

- The scroll padding adds the 1 rem float.
  [`index.css:566`](../../apps/web/src/index.css#L566)

**The change preview made opaque**

- A reading fill on the glass panel, now opaque.
  [`change-preview-output.tsx:72`](../../apps/web/src/features/calendar/components/change-preview-output.tsx#L72)

**Docs**

- Glass rule 1 names the save bar as the one screen-owned glass exception.
  [`DESIGN.md:305`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L305)

- The save bar's behaviour, rewritten for the pill and the chrome Discard.
  [`EXPERIENCE.md:120`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L120)

- §Responsive: the admin screens are opaque cards on the page.
  [`EXPERIENCE.md:191`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L191)

- UX-DR16 now describes a floating glass pill.
  [`epics.md:135`](../planning-artifacts/epics.md#L135)

**Tests**

- The bar's classes, never sticky below `sm`, with the old strip's classes gone.
  [`stepper.test.ts:200`](../../apps/web/src/features/rotation/utils/stepper.test.ts#L200)

- A source pin: no muted hint and no outline Discard; Discard is chrome.
  [`stepper.test.ts:219`](../../apps/web/src/features/rotation/utils/stepper.test.ts#L219)

- A source pin: the preview fill has no alpha.
  [`calendar-layout.test.ts:111`](../../apps/web/src/features/calendar/calendar-layout.test.ts#L111)

- e2e: the bar's bottom sits 16 px above the viewport's bottom.
  [`rotation-save-bar.spec.ts:123`](../../e2e/tests/rotation/rotation-save-bar.spec.ts#L123)
