---
title: 'Pilot: Kalendar and the shell in glass, on real data, on a phone'
type: 'feature'
created: '2026-10-30'
status: 'done'
baseline_commit: 'fbcab3c93c2eee07da000159fa3f7d0df83f06ea'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-30-glass-redesign.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users say the app looks old-fashioned. The product owner must judge direction G ("Staklo") on real data on their own phone before the rest of the app moves (D8).

**Approach:** Add the glass tokens in both themes, swap to Outfit and to Phosphor `fill` icons behind one facade (small status marks in `bold`), put the shell (desktop sidebar, phone tab bar) in glass, and bring *Kalendar*'s month view into G. Hold the PR unmerged until the product owner says go or no-go.

## Boundaries & Constraints

**Always:**
- D1–D10 as accepted. The hard rules in epic-15-context §Requirements apply as written: conflict red reserved, no colour-only meaning, slot not type, `tnum`, Latin Ext-A, 44 px targets, both themes, and no mockup copy or IA.
- Glass lives only in tokens and `@utility` classes in `index.css` and is never a screen class string. `backdrop-filter` goes only on the sidebar, the tab bar and the phone's sticky month head. Each also emits `-webkit-backdrop-filter`. Blur is at most 24 px. The blobs are static radial gradients, never `filter: blur()`.
- Grid cells stay opaque slot fills with a radius of at most 10 px. Label, ring, glyph, legend and hatches are unchanged.
- Every icon is Phosphor `fill`, except the small status marks: the leave and uncovered marks and *Danas*'s duty-block leg states use Phosphor `bold` through the same `icon.tsx` facade (human decision 2026-10-30). The leave and uncovered marks must differ by drawn shape, and a test proves it on the rendered marks.
- Text on `glass-over-content` is foreground-strength, never `muted-foreground`.
- Every new colour token is OKLCH, declared once per theme, and round-trips with DESIGN.md.

**Ask First:**
- If the Phosphor main-chunk growth exceeds 15 KB gzip, switch the facade to fill-only SVGs from `@phosphor-icons/core` and report it.
- Ask before changing any slot, `destructive` or modifier value, or any i18n key or copy.
- Ask before glassing a Dialog, Popover or sheet (that is 15.2).

**Never:**
- No Supabase, migration, RLS, route, i18n or CI change. No `pnpm db:reset`.
- No week or day view, no count badge, and no motion token.
- Do not restyle the *Više* sheet's or `/obavijesti`'s content beyond the token swap. Story 10.4 is working in `features/navigation` (sign-out) and `/obavijesti` in parallel.
- Never amend or force-push. Merge `origin/main` into the branch to update it, and never rebase.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Phone, long month | Grid scrolled to the last row | The last row clears the floating bar plus the safe-area inset | N/A |
| Content under the bar | Slot-2 cell under the tab bar | Tab text ≥ 4.5:1 and icons ≥ 3:1, worst case (light: slot-2; dark: lightest slot) | N/A |
| No blur support or reduced transparency | `@supports not (backdrop-filter…)` / `prefers-reduced-transparency: reduce` | Glass resolves to the opaque card colour | N/A |
| Forced colours | `forced-colors: active` | `Canvas` with a `CanvasText` border; the active item keeps its underline | N/A |
| Accent chosen | The organization has `violet` | Only the lockup tile and the 2 px edge are tinted | No accent → neutral edge |

## Epic AC Deviations

- **"Given *Kalendar* (… filter chips and sheet …) … it is in G."** Narrowed. The filter sheet and the month-picker popover take the new tokens but not a glass panel, because the Dialog and Popover primitives are 15.2's. *Why:* glassing them here would restyle every dialog in the app inside the pilot. Deferred-work entry written.
- **D5 "the `--sidebar*` set becomes a glass set" (proposal §2.4 and the "Navy retired" decision; not one of 15.1's ACs).** Reinterpreted. A new `chrome`/glass token set drives the shell. `--sidebar*` keeps its navy values for the sign-in panel, Timeline, IconTile, the Dialog `::backdrop` and Button `sidebar` until 15.2 and 15.3 move them. *Why:* repainting the shared tokens now would restyle screens that are outside the pilot.
- **"DESIGN.md (… Shell) … updated".** Reinterpreted. DESIGN.md has no Shell section, so the Shell row in §Components is updated. Under proposal §4.3, the 15.1 rows of UX-DR1, 3, 5, 11, 31/32 (form only) and 45, and EXPERIENCE.md §Responsive, are updated too.

</frozen-after-approval>

## Code Map

- `apps/web/src/index.css` -- tokens: `:root` :231, dark :308, `@theme inline` :379, `@layer base` :452, phone `scroll-padding-bottom` :489, `@utility shell-entry` :602 (built on `sidebar-*`). The Shift Figures `@font-face` rules are at :186-230.
- `apps/web/src/features/navigation/components/chrome.tsx` -- aside :1096, content padding `pb-[calc(4rem…)]` :1163, phone bar :1172, *Više* sheet `bg-sidebar` :968, profile popover :855. The sheet rows use the same `shell-entry` link.
- `apps/web/src/features/organization/utils/accent.ts` -- `mark`/`frame`/`edge` class literals per accent. The edge becomes 2 px.
- `apps/web/src/components/sticky-head.tsx` :96 -- the phone's sticky month head (also used by Sati's `hours-body.tsx`).
- `apps/web/src/features/calendar/components/*` -- grid, cell, day list, legend, skeleton, mode switch. `components/filter-bar.tsx` and `month-nav.tsx` handle the chips and the toolbar.
- `apps/web/src/components/ui/button.tsx` -- `default` variant. `ui/card.tsx` holds `CardTitle` (font pin).
- Icons: 66 files import `lucide-react`. `features/navigation/utils/icons.ts` (`LucideIcon` type), `features/calendar/utils/modifiers.ts` (leave `Clock`, uncovered `CircleDashed`) and `components/sort-glyphs.ts` are the non-JSX users.
- `test/theme-css.ts` -- `BASE_TOKENS` :72, `BRAND_TOKENS` :51, `ELEVATION_TOKENS` :112. Add `GLASS_TOKENS` on the elevation pattern, with colour and non-colour lists kept apart.
- `test/theme-fidelity.test.ts` -- parses only `colors:` (44 values / 22 names) and `base-palette:` (28). It needs a `glass:` parser (light/dark).
- `test/theme-contrast.test.ts` -- `composite()` :135, navy sidebar block :234-307, rings :389, `SIGNALS` incl. `primary` :953, accent edge `SURFACES` :986.
- `test/theme-tokens.test.ts` -- counts :55-63, `PARITY` :96, OKLCH-only :120, `@layer base` body background :226.
- `test/theme-applied.test.ts` :189 -- pins the shift-figures files.
- `test/typography-coverage.test.ts` -- `FACES` :45, Figures block :212-350, lucide pin :370.
- `apps/web/src/pages/structural-pins-shell.test.ts` -- `ring-offset-sidebar` :490, bar padding :639-654.
- `test/static-hosting.test.ts` :229, `apps/web/vite.config.ts` :55, `apps/web/index.html` :21 -- `#f8fafc` theme colour.
- e2e: `e2e/tests/layout/numerals.spec.ts` (Shift Figures), `e2e/tests/calendar/calendar-conflicts.spec.ts` :176 (`svg.lucide-clock`), `calendar/layout.spec.ts` and `layout/phone-navigation.spec.ts` (the bar).
- Docs: `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md` (front matter :1-196, §Brand :198, §Colors :216, §Typography :232, §Layout :245, §Elevation :260, §Shapes :264, Shell row :296), `EXPERIENCE.md` §Responsive :179, `epics.md` UX-DR1 :118, 3 :120, 5 :122, 11 :130, 31/32 :156, 40 :169, 45 :179.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/package.json`, `pnpm-lock.yaml` -- Add `@fontsource-variable/outfit` 5.3.0 and `@phosphor-icons/react` 2.1.10. Remove dm-sans, syne and lucide-react. Delete `scripts/fonts/build-figures.py` and `assets/fonts/*` (the woff2 files and their LICENSE) -- D1, D2.
- [x] `apps/web/src/components/ui/icon.tsx` -- Create the only icon import. It exports named icons as `fill` Phosphor components carrying `data-icon="<kebab-name>"` and an `IconComponent` type. Map all names with the proposal's table. Then repoint every importer, `icons.ts`, `modifiers.ts` and `sort-glyphs.ts`. In `eslint.config.js`, ban `lucide-react` and `@phosphor-icons/*` outside the facade -- D2.
- [x] `apps/web/src/index.css` -- Changes:
  - Outfit import, the font stacks and `tabular-nums` on `html`. Map 800 to 700, or remove 800.
  - `--background` `#E8EDF5` / `#0A1020`. The blob layer is static radial gradients over the existing `background-color`.
  - The glass set in both themes (§4.4 values): `glass`, `glass-over-content`, `glass-reading`, `glass-border`, `glass-active`, 3 blobs, `ink`/`ink-foreground`, plus non-colour blur, saturate and shadow.
  - `--primary` `#2F55B8` in light; dark keeps its value unless a measured pair fails. Radii widened, with the cells' class staying at 10 px or less.
  - `@utility glass-chrome` and `glass-over-content`, with their `@supports`, reduced-transparency and forced-colors fallbacks.
  - `shell-entry` moves to the chrome set (white pill plus semibold plus underline plus `aria-current`).
  - The phone `scroll-padding-bottom` matches the floating bar.
- [x] `apps/web/src/components/ui/button.tsx` -- The `default` variant becomes `bg-ink text-ink-foreground`. Other variants are untouched (15.2).
- [x] `apps/web/src/features/navigation/components/chrome.tsx` -- Changes:
  - The sidebar becomes a floating `glass-chrome` panel inset 16 px, with rows of at least 44 px.
  - The tab bar becomes a floating `glass-over-content` pill above the safe area. The content reserves its height plus the inset.
  - The accent touches only the lockup tile and a 2 px edge.
  - The *Više* sheet and profile menu move to opaque chrome tokens.
  - Leave the sign-out and *Obavijesti* logic alone.
- [x] `apps/web/src/components/sticky-head.tsx`, the calendar components, `filter-bar.tsx`, `month-nav.tsx` -- Bring the month view into G: the sticky head in `glass-over-content`, the chips, mode switch, legend, skeleton and day list on the new tokens. Restyle no primitive.
- [x] `test/theme-*.ts`, `test/typography-coverage.test.ts`, `pages/structural-pins-*.test.ts`, `modifiers.test.ts`, `localization-applied.test.ts`, `static-hosting.test.ts` -- Move the pins:
  - `GLASS_TOKENS` with counts, and the `glass:` fidelity parser.
  - Contrast for every chrome text, icon and edge pair against the worst case (page, each blob, darkest slot under over-content glass) in both themes, plus the ink pair and the new primary.
  - One Outfit face, a `tnum` rule, and the facade-only icon pin.
- [x] `e2e/tests/layout/numerals.spec.ts`, `calendar/calendar-conflicts.spec.ts`, layout specs -- Outfit `tnum` widths, `[data-icon="clock"]`, and a scroll past the floating bar where needed.
- [x] `apps/web/vite.config.ts`, `apps/web/index.html` -- The theme colours follow the new page.
- [x] DESIGN.md, EXPERIENCE.md, `epics.md` -- Update the sections in the Code Map. `updated: 2026-10-30`.

**Acceptance Criteria:**
- Given the repo, when it is searched, then nothing imports `lucide-react`, DM Sans, Syne or Shift Figures, and only `icon.tsx` imports Phosphor.
- Given a desktop, when any signed-in route renders, then the sidebar is a floating glass panel. Its active row is a white pill, semibold, with an indicator and `aria-current`.
- Given a phone, when any signed-in route renders, then four tabs plus *Više* float in a glass pill and the last row is reachable.
- Given *Kalendar* in either theme, when it renders, then it is in G, the cells read exactly as before, and the leave and uncovered marks (Phosphor `bold`) differ by drawn shape at their real size.
- Given the PR, when it is opened, then it records the main-chunk gzip delta against `main` and stays unmerged pending the product owner's go or no-go.

## Spec Change Log

- **Loop 1 (2026-10-30), review finding (Edge Case Hunter, confirmed in the SVG sources):** Phosphor `clock-fill`, `circle-dashed-fill` and `record-fill` are each a solid disc with 16/256-unit knockouts. At 12–16 px those knockouts are about 0.75–1 px, so the leave and uncovered marks (and the duty-block leg states) drew as near-identical solid dots and were no longer told apart by shape. The M-count test still passed. **Amended:** the frozen Approach, Always and AC lines now state the `bold` exception for small status marks (human decision: option 1). **Known-bad state avoided:** status marks that differ only by an invisible knockout, and a test that passes on SVG source text and not on what is drawn. **KEEP:** everything else as built, namely the tokens and glass utilities, the shell, the Kalendar changes, the docs, the fill-only facade on `@phosphor-icons/core` (not `@phosphor-icons/react`, which cost +31.3 kB gzip), and the re-tuned values (`glass-over-content` light .80, `--input` #78879D, the hour-band flag on `bg-card`).

## Design Notes

The shell gets a new glass set while `--sidebar*` stays navy. This keeps the pilot's blast radius to the shell and *Kalendar*. Sign-in, Timeline and the Dialog backdrop move in 15.2 and 15.3, which then retire `--sidebar*`. Primary's re-tune and the radii are global by nature, so every screen shifts slightly. That is expected, and the product owner sees it.

The icon facade draws fill-only SVGs from `@phosphor-icons/core` (imported as `?raw` and rendered as path elements), not `@phosphor-icons/react`. The react package carries all six weights in every icon module and grew the main chunk by +31.3 kB gzip, over the 15 KB line, so the spec's Ask First fallback applied. The small status marks import the `bold` SVGs from the same package through the same facade.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && pnpm typecheck && pnpm test` -- expected: green.
- `pnpm --filter ./apps/web build` on this branch and on `main` -- record the gzip delta of the main chunk.
- `pnpm test:e2e` (the shared local stack; no reset) -- expected: green.

**Manual checks:**
- D8 review: run `VITE_SUPABASE_URL=http://<LAN-IP>:54321 pnpm --filter ./apps/web dev --host 0.0.0.0`, then open `/prijava/dvd-demo` on the phone. Check `1`/`7` at 12 px in the compressed grid.

## Suggested Review Order

**Glass as tokens and utilities**

- Entry point: the over-content glass utility (blur, fallbacks, forced colours). Glass lives only here.
  [`index.css:717`](../../apps/web/src/index.css#L717)

- Glass beside content: the sidebar's lighter alpha, with the same fallback path.
  [`index.css:691`](../../apps/web/src/index.css#L691)

- The light glass set; over-content was raised to .80 after measurement.
  [`index.css:223`](../../apps/web/src/index.css#L223)

- Dark glass values, proposed here and tuned in 15.5.
  [`index.css:311`](../../apps/web/src/index.css#L311)

- Static radial-gradient blobs on a fixed layer, with no `filter: blur()`.
  [`index.css:496`](../../apps/web/src/index.css#L496)

- Active pill: semibold, underline and `aria-current`, never colour alone.
  [`index.css:658`](../../apps/web/src/index.css#L658)

- The opaque sheet and menu keep a visible current-row fill.
  [`index.css:668`](../../apps/web/src/index.css#L668)

**Shell**

- Floating glass sidebar inset 16 px; the accent is only the 2 px edge.
  [`chrome.tsx:1105`](../../apps/web/src/features/navigation/components/chrome.tsx#L1105)

- Floating tab pill, five cells, safe-area aware.
  [`chrome.tsx:1192`](../../apps/web/src/features/navigation/components/chrome.tsx#L1192)

- The Više sheet stays opaque; glass panels are 15.2's.
  [`chrome.tsx:981`](../../apps/web/src/features/navigation/components/chrome.tsx#L981)

- Default button becomes ink (D3); the other variants wait for 15.2.
  [`button.tsx:33`](../../apps/web/src/components/ui/button.tsx#L33)

**Icons**

- One facade; fill-only core SVGs, and a guard against shapes other than paths.
  [`icon.tsx:130`](../../apps/web/src/components/ui/icon.tsx#L130)

- The bold exception for small status marks (human decision, loop 1).
  [`icon.tsx:235`](../../apps/web/src/components/ui/icon.tsx#L235)

- Leave and uncovered draw in bold so their shapes stay apart at 12 px.
  [`modifiers.ts:98`](../../apps/web/src/features/calendar/utils/modifiers.ts#L98)

- The duty-block legs use bold for the same reason.
  [`duty-block.tsx:23`](../../apps/web/src/features/today/components/duty-block.tsx#L23)

**Kalendar and type**

- The phone sticky head is the third blurred layer.
  [`sticky-head.tsx:102`](../../apps/web/src/components/sticky-head.tsx#L102)

- Cells keep an 8 px radius whatever the other radii become.
  [`month.ts:313`](../../apps/web/src/features/calendar/utils/month.ts#L313)

- Outfit is the only face; `tnum` is set once on the document.
  [`index.css:536`](../../apps/web/src/index.css#L536)

**Tests, docs, config**

- Worst-case composites: page, blobs, every fill, ink, primary and destructive.
  [`theme-contrast.test.ts:1133`](../../test/theme-contrast.test.ts#L1133)

- Drawn-pixel comparison of the status marks, with the fill marks as a failing control.
  [`typography-coverage.test.ts:427`](../../test/typography-coverage.test.ts#L427)

- The forced-colours shell, as rendered.
  [`shell-forced-colours.spec.ts:57`](../../e2e/tests/layout/shell-forced-colours.spec.ts#L57)

- DESIGN.md's glass block, round-tripped by theme-fidelity.
  [`DESIGN.md:140`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L140)

- Lint ban: lucide and Phosphor imports only in the facade.
  [`eslint.config.js:797`](../../eslint.config.js#L797)
