---
title: 'Dark slot tokens are re-tuned so Noć never reads as a free day (7.1)'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: 'a67c44ee0de0a002a12011b44b19e2dc1f113ccc'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In the dark theme *Noć* (slot-2 `#171F29`) and a non-working day (`#161D24`) measure 1.02:1, so a night shift reads as a free day (UX review 2026-10-01).

**Approach:** Ship the six dark values and the new `shift-nonworking-border` token approved in decision 4 (`mockups/dark-tokens-1.html` §5). Then pin and measure them in the theme tests, and update DESIGN.md in the same change. The light theme is unchanged.

## Boundaries & Constraints

**Always:**
- New dark values, from DESIGN.md hex → `index.css` OKLCH (mockup §5):
  - slot-1 `#00415D` / fg `#B8E2FA`
  - slot-2 `#2F3641` / fg `#DCE3EE`
  - nonworking `#0E1828` / fg `#8494A8`
- `shift-nonworking-border`:
  - In DESIGN.md: light `'transparent'`, dark `'rgba(255,255,255,0.07)'`.
  - In CSS: light `transparent`, dark `oklch(1 0 0 / 7%)`, because the CSS must be OKLCH-only with no rgba.
  - It also gets a `--color-` mapping in `@theme inline`.
- The brand delta becomes 24 names (48 values). The CSS brand list becomes 32 names.
- The border must not change layout and must survive the inset box-shadow modifier rings. Draw it as an inset outline on `NONWORKING_CHIP_CLASS` (see Design Notes). It then reaches the calendar cells, chips and rotation tiles in one place.
- Every slot fill's foreground still meets 4.5:1 in both themes. The conflict and override borders still meet 3:1 on every fill.

**Ask First:** a change to any light value, or to any dark token beyond the six named above.

**Never:**
- No org-specific tokens (`shift-night` etc.).
- No hex or rgba in `index.css`.
- No second dark block.
- No changes to modifier, base-palette or ramp-order logic.

## Epic AC Deviations

- *"they are told apart by hue, the non-working border and the always-visible label, not by luminance alone"* (epics.md, 7.1 AC2). **Reinterpreted.**
  - The approved values give slot-2 and non-working the same hue (259.4° vs 259.5°).
  - The mockup separates them by lightness: non-working recedes below the card and *Noć* rises to light slate. In practice they are told apart by fill difference (1.46:1, OKLab ΔE×100 12.3), the border and the label.
  - The test pins those three, not a hue gap. Hue does separate Dan from Noć (≈24°).
  - Why: the human approved the values themselves (decision 4). The AC wording predates the measurement. No state is shown by colour alone, because the D/N/S label is always visible.

</frozen-after-approval>

## Code Map

- `apps/web/src/index.css`
  - Single dark block `:root[data-theme="dark"]` (:219-289). Values at :260-263 and :272-273. Light `:root` nonworking is at :200-201. `@theme inline` is at :345-346.
  - Header comments to correct: :7-8 (brand delta contents), :54-56 (nonworking-fg history), :108-110 ("non-working slot … did NOT move"), :475 (slot-2 "inverted" now holds only in light).
  - Modifier rings are inset box-shadows (:491-518).
- `test/theme-css.ts:26-59`. `BRAND_TOKENS` expands each name to name + `-foreground`, then `.concat('modifier-overridden')`. The border has no foreground, so add it to the concat. Fix the "31 / twenty-three" doc comment.
- `test/theme-tokens.test.ts:42-55`. `toHaveLength(31)` becomes 32. The other sweeps pick the token up automatically.
- `test/theme-fidelity.test.ts`
  - `APPROVED` (:35-37) exempts `shift-nonworking-foreground` in both themes and asserts drift > 1 (:126-130). Dark now equals DESIGN.md, so the exemption must become light-only.
  - Counts: 46 → 48 (:78-79), 23 → 24 (:70, :82-83). Header :18-21.
  - Add the border to the alpha-preservation loop (:141-151).
- `test/theme-contrast.test.ts`
  - Lists: `FILLS` :73-81, `BRAND_PAIRS` :51-67.
  - Helpers: `ratio` :141, `composite` :132, `hueGap` :158. culori is imported at :5. No fill-vs-fill check exists today.
- `apps/web/src/features/shift-types/services/list.ts:401` -- `NONWORKING_CHIP_CLASS`. Every non-working surface reads it: `calendar/utils/month.ts:874,916`, `shift-type-table.tsx:86`, `shift-type-facts.tsx:46`, `rotation/utils/draft.ts:489-503`.
- `apps/web/src/features/shift-types/services/list.test.ts:323` -- asserts that exact string.
- `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md`
  - `colors:` :11 (comment "23"), :28-33, :52-53.
  - `components.shift-cell-nonworking` :161-163. §Colors :210-222. `updated:` :6.
- `_bmad-output/planning-artifacts/epics.md:109` -- UX-DR1 says "46-token". It becomes 48 and names `shift-nonworking-border`.

## Tasks & Acceptance

**Execution:**
- [x] `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md`
  - Six dark values and the two border entries; `shift-cell-nonworking` gains `border`.
  - §Colors gets one short dark-ramp paragraph: the three lightness levels, the border, and that Dan/Noć differ by hue and label. Fix the "23" comment and bump `updated`.
- [x] `apps/web/src/index.css` -- the six dark OKLCH values (mockup §5 gives them), the border in light, dark and `@theme inline`, and corrected header notes.
- [x] `apps/web/src/features/shift-types/services/list.ts` + `list.test.ts` -- add the inset-outline border classes to `NONWORKING_CHIP_CLASS` and update the exact-string assertion.
- [x] `test/theme-css.ts`, `test/theme-tokens.test.ts`, `test/theme-fidelity.test.ts` -- the new name, counts 32 / 48 / 24, light-only `APPROVED`, alpha check, comments.
- [x] `test/theme-contrast.test.ts` -- a new describe, in both themes:
  - slot-2↔nonworking (both themes) and dark slot-1↔nonworking each reach ratio ≥ 1.4 and OKLab ΔE×100 ≥ 10. Light slot-1↔nonworking (1.04:1, unchanged light values) is excluded with a comment.
  - In dark only, the border composited over nonworking differs from the bare fill by at least `PERCEPTIBLE`. In light, the border's alpha is 0.
  - A comment says why hue is not asserted for Noć↔nonworking.
- [x] `_bmad-output/planning-artifacts/epics.md:109` -- update the UX-DR1 count and token list.

**Acceptance Criteria:**
- Given the built stylesheet, when the theme suites run, then `theme-fidelity` round-trips all 24 names in both themes against DESIGN.md. Only light `shift-nonworking-foreground` is exempt.
- Given the dark theme, when `theme-contrast` measures *Noć* against non-working, then the ratio is ≥ 1.4 and ΔE ≥ 10, and the border is perceptible on the non-working fill.
- Given any slot fill in either theme, when its foreground is measured, then it is ≥ 4.5:1, and the conflict and override borders stay ≥ 3:1.
- Given a non-working calendar cell carrying a modifier ring, when it renders, then both the outline and the ring are visible, and the cell's box size equals a working cell's.

## Design Notes

Border classes: `outline outline-1 -outline-offset-1 outline-shift-nonworking-border`.
- An outline takes no layout space, so non-working and working cells stay the same size.
- It is not a box-shadow, so the `modifier-ring-*` inset shadows do not overwrite it.
- In light it is transparent, so nothing visible changes.
- Before using it, check that no focused cell relies on `outline-none`.

## Verification

**Commands:**
- `pnpm exec vitest run test/theme-` -- expected: all pass (`theme-applied` needs `pnpm build` first)
- `pnpm --filter ./apps/web test` -- expected: all pass
- `pnpm lint && pnpm typecheck` -- expected: clean

**Manual checks:**
- Dark theme, Kalendar, October: the N·S·S·D rhythm reads without reading the labels. Compare with mockup §3–4.

## Suggested Review Order

**The re-tuned dark ramp**

- Entry point: why Noć and non-working now separate by lightness, border and label
  [`index.css:61`](../../apps/web/src/index.css#L61)

- Six dark values from decision 4; slot-1 chroma 0.0751 keeps it in gamut
  [`index.css:284`](../../apps/web/src/index.css#L284)

- New 24th brand name, light transparent / dark 7% white, plus Tailwind mapping
  [`index.css:298`](../../apps/web/src/index.css#L298)

**The hairline on every non-working surface**

- One class reaches calendar cells, chips and rotation tiles; outline takes no layout
  [`list.ts:417`](../../apps/web/src/features/shift-types/services/list.ts#L417)

- Ring forced-colours fallbacks become !important so the hairline cannot thin them
  [`index.css:526`](../../apps/web/src/index.css#L526)

**Binding docs**

- DESIGN.md source of truth: dark values and the new token
  [`DESIGN.md:28`](../../_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L28)

- Component outline entry and the dark-ramp paragraph
  [`DESIGN.md:167`](../../_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L167)

**Tests**

- New floors: Noć/Dan vs non-working, hairline perceptible, Dan↔Noć hue gap
  [`theme-contrast.test.ts:753`](../../test/theme-contrast.test.ts#L753)

- Exemption narrowed to light only; counts 48 / 24
  [`theme-fidelity.test.ts:37`](../../test/theme-fidelity.test.ts#L37)

- Bare keyword guard admits only the light border
  [`theme-tokens.test.ts:125`](../../test/theme-tokens.test.ts#L125)

- Brand list gains the foreground-less border
  [`theme-css.ts:66`](../../test/theme-css.ts#L66)

- Rendered check: hairline computed values, box size, rings under forced colours
  [`layout.spec.ts:594`](../../e2e/tests/calendar/layout.spec.ts#L594)
