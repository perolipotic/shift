---
title: 'Glass holds in the dark theme, without blur support, and on a low-end phone (15.5)'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: '578fa905529ee077fdc654530bf5a6fc0ec2138f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The dark glass values are still marked "proposed". `theme-contrast` measures most glass pairs but not every control drawn on over-content glass, and it records no dark worst-case ratios. Only `glass-panel` has its three fallbacks pinned in the built CSS. The opaque fallbacks of `glass-chrome` and `glass-over-content` keep the white glass hairline, which vanishes on the card. Under forced colours the borderless `chrome` Button (*Odbaci promjene*) is bare text, and nothing pins the sign-in ink tile. No performance trace exists. UX-DR53 and the glass part of §Accessibility Floor are unwritten.

**Approach:** Keep the dark values: every required pair clears its threshold against the worst backdrop (Design Notes). Pin them as final, with their measured ratios. Close the measurement gaps. Make the three utilities' fallbacks identical and pin all of them. Give `chrome` a `ButtonText` border under forced colours only. Add an on-demand Playwright perf run with CPU throttling as the automatable proxy for the low-end Android trace. Write UX-DR53, §Accessibility Floor, and the DESIGN.md close-out. Answer every deferral addressed to 15.5.

## Boundaries & Constraints

**Always:**
- No change to behaviour, routes, copy, i18n keys, data, or light-theme token values.
- `index.css` keeps exactly 3 `backdrop-filter` utilities. No `.tsx` uses `blur-*` or `backdrop-blur`.
- Every value DESIGN.md `glass:` declares still round-trips (`theme-fidelity`).
- Required inputs, answered in Design Notes: the dark values, the dark `glass-scrim`, the thin margins (deferred-work, 15.2 review), dark `primary` on the card (15.1), the sign-in ink tile (15.3 review), and the save bar's disabled, pending and forced-colours states (15.4 review). Mark each one `RESOLVED by 15.5 (2026-11-02)`.

**Ask First:**
- If any dark or light value must change because a measurement fails.
- If the perf proxy fails its budget. The proposal's fallback would make glass solid on that class of device. Do not build it unasked.
- Any restyle of a `components/ui/*` primitive other than the `chrome` forced-colours border.

**Never:**
- The 15.7 filter bar. The offline save-bar padding entry (not addressed to 15.5).
- A perf test in the CI e2e suite: throttled timing is too flaky there.
- `db reset`, or touching the Vite server on port 5173.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No blur support | `@supports not (backdrop-filter…)` | All 3 utilities: opaque `--card`, hairline in `--border` | Built-CSS pin |
| Reduced transparency | emulated `reduce` | Sidebar, tab bar and Više sheet compute the card colour and `backdrop-filter: none` | e2e |
| Forced colours, shell or sheet | `forcedColors: active` | `Canvas` and a `CanvasText` border (existing spec) | N/A |
| Forced colours, save bar | admin, ≥ 640 px, unsaved | *Odbaci promjene* has a 1 px `ButtonText` border | e2e |
| Forced colours, sign-in | ≥ 1024 px | The tile's icon computes `CanvasText`, which differs from `Canvas` | e2e |
| Disabled or pending button | `opacity-50` on glass | WCAG-exempt (inactive). Measured and recorded, not floored | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/index.css:321-342` -- the dark glass block, commented "proposed values that story 15.5 tunes" (:327). `:660` repeats it. `:702-751` -- `glass-chrome` and `glass-over-content`. Their `@supports` and reduced-transparency fallbacks set only `background-color`, so the white `--glass-border` hairline stays. `glass-panel` (:771-811) also sets `inset 0 0 0 1px var(--border)`; copy that pattern.
- `apps/web/src/components/ui/button.tsx:49-50` -- `chrome`: `border-0 bg-transparent …`. Add `forced-colors:border forced-colors:border-[ButtonText]`. Other modes keep the same layout.
- `apps/web/src/components/layout/auth-layout.tsx:33` -- the ink tile. Pin only, no change.
- `apps/web/src/features/rotation/components/rotation-save-bar.tsx:77-90` -- Discard `chrome disabled={pending}`, Save `aria-disabled:opacity-50`.
- `test/theme-contrast.test.ts:1064-1193` -- the chrome block (`backdrops`, `grounds`, `worst`). Over-content includes card, every fill, ink, primary, destructive and muted. `:1296-1452` -- the panel block, with the scrim. `:1416` -- the pattern for recording ratios.
- `test/theme-applied.test.ts:213-225, 257-270` -- the built-CSS glass pins. Only `glass-panel` has all three fallbacks pinned.
- `e2e/tests/layout/shell-forced-colours.spec.ts` -- the `drawn()` probe pattern (resolves the system-colour keywords). `e2e/tests/rotation/rotation-save-bar.spec.ts` -- the save bar setup.
- `playwright.smoke.config.ts`, `smoke/support/env.ts`, `smoke/tsconfig.json`, root `package.json` (`test:smoke`, `typecheck`) -- the pattern for a separate, env-targeted Playwright run.
- Sticky-head controls on over-content glass: `components/month-nav.tsx`, and `features/calendar/components/calendar-mode-switch.tsx`, which is outline with an `aria-pressed` primary fill.
- Comments and docs that say "tuned in/by 15.5": `features/navigation/components/chrome.tsx:580`, `pages/structural-pins-shell.test.ts:700`, DESIGN.md :141, :163, :303, :311, the Don'ts ("two `index.css` utilities", which is now three), `epics.md:156` (UX-DR31), and the list after UX-DR52 (:186).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/index.css` -- In the `glass-chrome` and `glass-over-content` `@supports` and reduced-transparency fallbacks, add `box-shadow: inset 0 0 0 1px var(--border), var(--glass-shadow)`. Rewrite the dark-block comments: the values are final, measured by 15.5.
- [x] `apps/web/src/components/ui/button.tsx` -- Add the `chrome` forced-colours border and update the variant comment.
- [x] `test/theme-contrast.test.ts` -- On over-content glass, a `primary` fill (the pressed mode switch) and the ink button each clear 3:1 against the worst backdrop. Add one block that records each glass surface's required pairs in dark at their measured worst ratios (`toBeCloseTo`), including the three thin margins. Put the WCAG exemption and the measured disabled-label values in a comment.
- [x] `test/theme-applied.test.ts` -- Pin all three fallbacks for all three utilities: card plus a `--border` hairline, `backdrop-filter:none`, and `Canvas` with a `CanvasText` border. Pin the `chrome` forced-colours border in the built sheet.
- [x] `e2e/tests/layout/glass-fallbacks.spec.ts` (new) -- Reduced transparency (`page.emulateMedia` if Playwright 1.63 supports it, else CDP `Emulation.setEmulatedMedia`) for the sidebar at 1280, and the tab bar and Više sheet at 390. Forced colours on the sign-in tile at 1280.
- [x] `e2e/tests/rotation/rotation-save-bar.spec.ts` -- Forced colours, unsaved, ≥ 640: Discard's border is `ButtonText`.
- [x] `playwright.perf.config.ts`, `perf/glass-scroll.spec.ts`, `perf/tsconfig.json`, `package.json` (`test:perf`, typecheck) -- Run against `PERF_BASE_URL`, with the org and user from env. Phone viewport, admin, Kalendar all teams. (a) NFR-22: 4× CPU and DevTools "Fast 4G", from navigation to the month grid visible, ≤ 2000 ms. (b) Budget: 6× CPU, a Chromium trace while scrolling the grid across two months, with no frame over 50 ms attributable to paint or composite. Write the trace JSON and a summary to `test-results-perf/`.
- [x] Docs -- `epics.md`: write UX-DR53 after UX-DR52 (§4.4's rules in one paragraph, with the final values, the fallbacks and the budget) and add it to the UX allocation line. In UX-DR31, drop "tuned in 15.5". DESIGN.md: the glass front matter and rules 4, 5, 7 and 8 become final (dark values, the scrim, the fallback hairline, the `chrome` forced-colours border, the proxy result). Fix the Don'ts count. Set `updated:`. EXPERIENCE.md §Accessibility Floor: glass bullets for the worst-backdrop measurement, the three solid fallbacks, forced colours, and the exemption for disabled controls. Update the code comments listed in the Code Map.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- Mark the 15.1 dark-primary, 15.2 thin-margin, 15.3 tile and 15.4 states entries RESOLVED by 15.5.

**Acceptance Criteria:**
- Given the repo, when it is searched, then no comment or doc calls the dark glass values "proposed" or "tuned by 15.5".
- Given `pnpm test:perf` against a preview build on port 5174, then both budgets pass. The numbers and the trace path are recorded in the spec's Verification section for the PR.
- Given the PR, then lint, typecheck, unit and e2e are green.

## Epic AC Deviations

- "The performance budget (§4.4) is measured on a low-end Android, and the trace is linked from the PR." **Narrowed.** An agent cannot take a trace on a real device. The proxy is Chromium at 6× CPU (DevTools' low-tier mobile) on a phone viewport, with the trace saved for the PR. The real-device trace is deferred-work, and a human action: the product owner runs Chrome remote debugging on a low-end Android over `dvd-demo` and links the trace. 15.5 is not `done` until that is linked or the human waives it.

## Spec Change Log

## Design Notes

**Dark values: kept, measured worst case (light in brackets).**
- `glass`: foreground 13.64 (15.07), ring 13.27, the active-pill row 9.52.
- `glass-over-content`: foreground 7.99 (11.66) over ink, ring 7.78, the active pill 5.62, primary fill 3.57 (4.41).
- `glass-reading`: muted 5.11 (4.51), input 3.08 (3.06 as DESIGN.md rounds it), primary 4.75.

Every pair clears its threshold, so retuning would only move margins. The dark scrim at .55 is a tint (the panel pairs above include it), so it stays.

**Thin margins.** Light muted 4.51, dark input 3.08, light ring beside the input 3.22. These values are untouched, so the ratios are unchanged and are now recorded as pins.

**Dark `primary` on the card** is 5.93. 15.2 retuned it and pinned it at :278, so this is resolved, verified here.

**Ink tile under forced colours.** The tile becomes `Canvas`. Its icon is `currentColor`, which becomes `CanvasText`, so it stays perceivable. Only a pin is added.

**Disabled and pending.** WCAG 1.4.3 and 1.4.11 exempt inactive controls. Measured: a `chrome` label at 50 % on over-content glass reads 3.06 light and 3.30 dark. Recorded, not floored.

**Why `ButtonText` only under forced colours.** A transparent border in every mode would shift chrome buttons by 1 px. Forced colours is the only mode where the button loses its pill and hover.

## Verification

**Commands:**
- `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"; pnpm lint && pnpm typecheck && pnpm build && pnpm test` -- expected: green, with the built-CSS pins running.
- `PERF_BASE_URL=http://127.0.0.1:5174 pnpm test:perf` against `vite preview --port 5174` (shared stack, no reset). Stop it afterwards. Expected: both budgets pass.
- e2e -- CI runs it on the PR.

**Measured (2026-11-03, `pnpm test:perf` against `vite preview` on 5174, shared stack, `dvd-demo` admin):**
- NFR-22, 4× CPU, 9/1.5 Mbit/s at 150 ms (a longer round trip than DevTools' Fast 4G, chosen as the more conservative case), cold (no cache, no service worker, session signed in): month grid in 1661 ms (budget 2000).
- Glass budget, 6× CPU, 390 × 844 at DPR 3, two months scrolled (1085 px and 1190 px): longest paint or composite task 1.8 ms (Paint), the one long animation frame (66 ms, script-bound) spent 10.8 ms rendering (budget 50). Chromium 153, after the review patches; the first run read 2.3 ms and 11.7 ms. CPU throttling does not slow the GPU, raster or compositor threads, so this is the main-thread half of the budget; the real-device trace is the other half.
- The trace is `test-results-perf/glass-scroll-trace.json` (git-ignored; attach it to the PR), with `summary.json` beside it.

**Manual checks:**
- Screenshots on 5174 in dark at 390 and 1280: Kalendar scrolled under the head, Više open, a Dialog over the day detail, and the save bar unsaved. They are for the product owner's visual sign-off on the dark values.

## Suggested Review Order

**The solid fallbacks, made identical**

- Entry point: the chrome's opaque fallbacks now draw the `--border` hairline, as the panel's did.
  [`index.css:713`](../../apps/web/src/index.css#L713)

- The same for the over-content glass (tab bar, sticky head, save bar).
  [`index.css:745`](../../apps/web/src/index.css#L745)

- Button `chrome` gains a `ButtonText` border under forced colours only, so *Odbaci promjene* reads as a button.
  [`button.tsx:56`](../../apps/web/src/components/ui/button.tsx#L56)

**The dark values, measured and pinned**

- The dark worst-case ratios and the three thin margins, recorded so a retune shows as a diff.
  [`theme-contrast.test.ts:1588`](../../test/theme-contrast.test.ts#L1588)

- New pairs: a primary fill and the ink button against over-content glass, both themes.
  [`theme-contrast.test.ts:1179`](../../test/theme-contrast.test.ts#L1179)

**The performance proxy**

- The glass budget: 6× CPU, trace over two months of scrolling; the GPU caveat is in the header.
  [`glass-scroll.spec.ts:150`](../../perf/glass-scroll.spec.ts#L150)

- NFR-22: 4× CPU, a mobile network, cold month grid within 2 s.
  [`glass-scroll.spec.ts:117`](../../perf/glass-scroll.spec.ts#L117)

- On demand only, phone UA; never in CI.
  [`playwright.perf.config.ts:41`](../../playwright.perf.config.ts#L41)

**Docs**

- UX-DR53, the glass rules in one paragraph.
  [`epics.md:187`](../../_bmad-output/planning-artifacts/epics.md#L187)

- Rule 4: the dark measurements and the disabled-control exemption.
  [`DESIGN.md:309`](../../_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L309)

- Rule 5: the fallbacks, the `ButtonText` border and the sign-in tile.
  [`DESIGN.md:310`](../../_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L310)

- Rule 7: the measured budget and what the proxy cannot show.
  [`DESIGN.md:312`](../../_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L312)

- §Accessibility Floor's glass bullets.
  [`EXPERIENCE.md:166`](../../_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L166)

- The real-device trace, owned by the product owner.
  [`deferred-work.md:1214`](../../_bmad-output/implementation-artifacts/deferred-work.md#L1214)

**Tests**

- Every fallback of every utility, the phone head's variant included, pinned in the built sheet.
  [`theme-applied.test.ts:288`](../../test/theme-applied.test.ts#L288)

- The `ButtonText` border exists only inside forced colours.
  [`theme-applied.test.ts:312`](../../test/theme-applied.test.ts#L312)

- e2e: reduced transparency on the shell, the head and the sheet; the sign-in tile under forced colours.
  [`glass-fallbacks.spec.ts:78`](../../e2e/tests/layout/glass-fallbacks.spec.ts#L78)

- e2e: *Odbaci promjene* has a 1 px `ButtonText` border under forced colours.
  [`rotation-save-bar.spec.ts:340`](../../e2e/tests/rotation/rotation-save-bar.spec.ts#L340)
