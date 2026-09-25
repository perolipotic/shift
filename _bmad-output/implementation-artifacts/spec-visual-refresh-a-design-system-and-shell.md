---
title: 'Visual refresh A — design system, shell and sign-in in the shiftapp-v2 style'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '78e3419679caa49962a670cb7ffbfd242a57b4f1'
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app looks like stock shadcn (Geist, neutral greys, flat cards). The owner wants the more modern look of the mockups in `_bmad-output/planning-artifacts/ux-designs/shiftapp-v2/`, but the same product, flows and roles, and every screen built from now on should be in that style.

**Approach:** Retheme at the design-system layer so every existing and future screen inherits it:
- Rewrite DESIGN.md as the new source of truth.
- Retune `index.css` tokens: a slate base, primary `#2563EB`, a navy sidebar in both themes, a navy-based dark theme, 12px radius and soft shadows.
- Swap the fonts to DM Sans for body text and Syne for headings.
- Restyle the shared `components/ui` primitives, the app shell and the two sign-in screens.

Only visuals change. Content screens get their bespoke polish in part B, which is recorded in `deferred-work.md`.

## Boundaries & Constraints

**Always:**
- Croatian copy through i18n keys only.
- Light and dark themes via the single `prefers-color-scheme` block. No toggle, no `.dark`, no `data-theme`.
- Phone-first. The page body never scrolls sideways. The 44px control floor stays: screens keep `h-11`.
- All colours are OKLCH in CSS and each is traced to a hex in DESIGN.md.
- `destructive` stays reserved for conflicts and is never used as a status red.
- No state is carried by colour alone.
- Ramp slots stay numbered. Their hues may be retuned only to keep passing contrast against the new surfaces.
- The organization accent remains data. It tints only the lockup, the sidebar edge and the phone-bar edge.
- Every existing test threshold keeps its value: 4.5:1, 3:1, ΔE ≥ 10, hue ≥ 45° with ΔE ≥ 25, and glyph coverage.
- Pinned *measurements* may be re-pinned only to newly measured values that still satisfy their threshold. The spec change log in the file header comment records the old value, the new value and the reason.
- Hard-coded token counts and name lists in tests may change to match intentional additions.

**Ask First:**
- Any test threshold that seems to need lowering.
- Moving a brand accent's hue more than 15° from its current hue.
- Changing `destructive` or modifier hues.
- Adding any npm dependency other than the two fontsource packages.

**Never:**
- New features, routes or data.
- A topbar, search bar or per-route page titles. Those belong to part B or later.
- A Badge or KPI component. Those belong to part B.
- Emoji icons. Keep lucide.
- The mockup's copy: English, "ShiftApp", Google login, signup, demo buttons or "remember me".
- Loading fonts from the Google CDN.
- Restyling in a route or screen file that belongs to the primitives.
- Weakening the chrome structure assertions in `apps/web/src/routes/prijava.test.ts`.

</frozen-after-approval>

## Code Map

- `_bmad-output/planning-artifacts/ux-designs/shiftapp-v2/shiftapp_manager_v2.html:8-250` -- style reference for the shell, cards, buttons and inputs. Sidebar is at :27-43, card at :83-86, button at :55-61, input at :130-135.
- `.../shiftapp_login_onboard.html:29-87` -- sign-in reference: a 420px navy brand panel with glows, and the form on a slate-50 panel.
- `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md` -- front matter `colors:` is parsed by `test/theme-fidelity.test.ts:40-51`. Only `^\s{2}name: '#hex'` lines count, and parsing stops at the next top-level key. Put shadows and the base palette under NEW top-level keys, not under `colors:`. The prose at :113-192 contains rules this change overturns: flat, no shadows, don't restyle shadcn, and Geist.
- `apps/web/src/index.css` -- the header comment (:1-110) records every deviation and its measurement, so update it. The base tokens are at :124-153 and :195-222, the brand delta at :155-181 and :224-248, and the `@theme inline` block at :250-330.
- `test/theme-tokens.test.ts:41-47,78-96,99-113` -- token counts, one declaration per theme, dark ≠ light except the PARITY list, and OKLCH only (a shadow `oklch(... / a)` passes; hex and `rgb()` fail).
- `test/theme-contrast.test.ts` -- rings :180-218, the light-L pins :242-259 (`sidebar-ring` 0.654 must be re-pinned for a navy sidebar), input/border pins :281-368, accent vs destructive :480-513, accent vs primary ΔE ≥ 10 :558-592, accent ≥ 3:1 vs background/card/sidebar :622-634.
- `test/theme-fidelity.test.ts:35,78-84,118-151` -- hard-coded 46 values and 23 names, and hex round-trips within 0.5/255.
- `test/typography-coverage.test.ts:49,59-71,143-165` -- checks only the FIRST `@fontsource` import. It requires `čćžšđČĆŽĐŠ` coverage, requires `◷ ◌` to be uncovered, and pins `--font-sans: 'Geist Variable'`.
- `test/theme-applied.test.ts:67-146` -- built-CSS assertions. It skips when `dist` is absent.
- `apps/web/src/organization/accent.ts:159-183`, `accent.test.ts:187-297` -- the only place accent classes may be spelled, from an allowlist.
- `apps/web/src/components/ui/{button,card,input,label,table}.tsx` -- primitives. `input.tsx` must keep `border-input` (prijava.test :2745). `table.tsx` must keep the literal `overflow-auto` wrapper (:2567).
- `apps/web/src/navigation/chrome.tsx:360-540` -- the shell, which `prijava.test.ts` constrains:
  - `sm:hidden` / `hidden…sm:flex` (:1922)
  - no `w-N` on `<aside>` (:1756)
  - active link `aria-[current=page]:font-(bold|semibold)|underline` (:1792)
  - `<Icon aria-hidden` (:2006)
  - the phone bar starts `<div className={\`sticky` (:1871)
  - `${accent.edge}` on the aside and the phone bar (:3925)
  - exactly 2 `<nav>` (:1709)
  - `#app-destinations` with `className={expanded ?` (:1733)
- `apps/web/src/organization/lockup.tsx:100-120` -- where accent `mark`/`frame` land, on the navy sidebar.
- `apps/web/src/routes/prijava-organizacija.tsx:75-99`, `prijava.tsx:130-215` -- `<main>` → `Card max-w-sm` → form. The control counts per screen are fixed by `prijava.test.ts:249-372`.
- `apps/web/src/i18n/locales/hr.json` -- the `auth.*` keys. New brand-panel copy is added here.
- `.npmrc` -- `save-exact`, isolated linker.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/package.json` -- add `@fontsource-variable/dm-sans` and `@fontsource-variable/syne` (exact versions), drop geist, then `pnpm install` -- self-hosted fonts.
- [x] `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md` -- rewrite the front matter and prose for the new register -- source of truth:
  - `primary` becomes #2563EB, with a dark counterpart.
  - Add a new top-level `base-palette:` with the slate/navy hexes per theme, and an `elevation:` key with `sh`/`sh-lg`.
  - Typography: DM Sans for body, Syne for headings and large numerals, tabular numerals kept.
  - `rounded`: 12px.
  - Replace the rules for flat, no shadows, don't restyle shadcn, and Geist with: primitives are restyled once in `components/ui`, and screens never restyle them.
  - Keep every product rule.
- [x] `apps/web/src/index.css` -- implement the palette:
  - Fonts: DM Sans import first, then Syne. `--font-sans: 'DM Sans Variable'`, `--font-heading: 'Syne Variable'`.
  - `--radius: 0.75rem`.
  - Shadow tokens as oklch-alpha.
  - Light: background slate-50, card white, sidebar navy #0B1628 with a light foreground.
  - Dark: a navy background, a darker navy sidebar (distinct value).
  - Headings get `font-family: var(--font-heading)` in `@layer base`.
  - Retune primary, ring, input and border, and the brand accents where a threshold demands it, and the ramp if needed.
  - Update the header comment with every new deviation or pin.
- [x] `test/*.test.ts` -- update only counts, name lists, the font-name pin and re-measured pins, as the Boundaries allow. Extend `typography-coverage` to check BOTH fontsource imports (Croatian coverage for each, `◷ ◌` uncovered in each) -- the heading face must pass the same glyph gate.
- [x] `apps/web/src/components/ui/*.tsx` -- restyle in the mockup idiom -- one restyle that every screen inherits:
  - Button: radius, weight, and a soft primary hover shadow. Heights stay as they are; screens set `h-11`.
  - Card: border plus `shadow-sh`, and a header with a bottom divider.
  - Input: 1.5px `border-input`, and a primary focus ring.
  - Table: uppercase header cells on muted, and hover rows.
- [x] `apps/web/src/navigation/chrome.tsx`, `organization/lockup.tsx` -- restyle the shell -- mockup sidebar within the existing structure:
  - Navy aside.
  - Nav items rounded, with a `sidebar-primary` pill when active, keeping `font-semibold` on `aria-current`.
  - Muted section label.
  - Lockup legible on navy.
  - The phone bar restyled consistently.
- [x] `apps/web/src/routes/prijava-organizacija.tsx`, `prijava.tsx`, `i18n/locales/hr.json` -- split layout: a navy brand panel (product name "Shift", a headline and a subline, both new `auth.brand.*` keys) visible from `lg`, and the form column on the page background -- modern sign-in with no flow change. The control counts are unchanged.

**Acceptance Criteria:**
- Given any screen, when rendered in light or dark, then body text is DM Sans, headings are Syne, cards are 12px-radius with a soft shadow, and the primary is the new blue.
- Given desktop width, when signed in, then the sidebar is navy with the active destination as a blue pill. Given phone width, then the bottom bar still works and nothing scrolls sideways at 390px.
- Given each of the four accents, when applied, then the lockup mark on the navy sidebar is distinct and the contrast tests pass unchanged thresholds.
- Given the sign-in steps at 390px, when rendered, then the brand panel is hidden and the form is fully usable. From `lg` up, the split layout shows.
- Given the repository, when `pnpm lint`, `pnpm typecheck` and `pnpm test` run, then all pass with no threshold lowered.

## Design Notes

Why the navy sidebar is feasible under the accent rules: an accent must reach ≥ 3:1 against both a white card and the navy sidebar, which means relative luminance between about 0.13 and 0.30. It also needs ≥ 4.5:1 with a white foreground, which means luminance ≤ 0.18. That window, roughly OKLCH L 0.55–0.62, exists for every hue. Today's light accents sit at L ≈ 0.49, just below it. Retune within that window.

`#2563EB` sits ΔE 6.6 from today's light `brand-blue`. Move `brand-blue` (within ±15°) until ΔE ≥ 10; don't relax the rule.

Sidebar parity: use two distinct navies (light #0B1628, dark a darker #070E1A-ish) so the divergence rule holds without widening PARITY.

## Verification

Environment: the default shell is Node 20. Prefix commands with `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`. The worktree has no `node_modules` until `pnpm install` runs. The local Supabase stack is already running and is shared with the main checkout.

**Commands:**
- `pnpm install && pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all green (DB-backed suites need the local Supabase stack running)
- `pnpm --filter @shift/web build && pnpm test` -- expected: `theme-applied`/`localization-applied` run against a fresh dist and pass

**Manual checks:**
- Run the dev server and sign in as `ivan.maric` in `dvd-kastel-novi`. Check light and dark (OS setting) at 390px and 1280px, including the sign-in steps, the members list and org settings.

## Suggested Review Order

**Source of truth**

- The new register: base palette per theme, then elevation; everything downstream traces here.
  [`DESIGN.md:68`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L68)

- Shadows as a separate top-level key so the `colors:` parser stays untouched.
  [`DESIGN.md:133`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L133)

- DM Sans body, Syne headings; Croatian coverage requirement kept.
  [`DESIGN.md:224`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L224)

**Token layer**

- Navy sidebar in light; distinct darker navy in dark keeps the divergence rule.
  [`index.css:161`](../../apps/web/src/index.css#L161)

- Brand blue moved 14° to indigo: ΔE 10.84 from the new primary, at sRGB edge.
  [`index.css:196`](../../apps/web/src/index.css#L196)

- Shadow tokens in OKLCH alpha; dark deliberately heavier.
  [`index.css:137`](../../apps/web/src/index.css#L137)

- Heading face token wired alongside `--font-sans`.
  [`index.css:280`](../../apps/web/src/index.css#L280)

**Primitives**

- Outline now on the 3:1 `input` border; new `sidebar` variant for navy chrome.
  [`button.tsx:33`](../../apps/web/src/components/ui/button.tsx#L33)

- `CardTitle` gains `asChild` so screens render their `<h1>` without restyling.
  [`card.tsx:38`](../../apps/web/src/components/ui/card.tsx#L38)

**Shell and sign-in**

- Active destination: pill + semibold + underline, ring offset onto navy.
  [`chrome.tsx:378`](../../apps/web/src/navigation/chrome.tsx#L378)

- Navy aside, sticky, structure untouched for the chrome assertions.
  [`chrome.tsx:480`](../../apps/web/src/navigation/chrome.tsx#L480)

- No-accent mark switches to `text-foreground` so its letter reads on navy.
  [`accent.ts:149`](../../apps/web/src/organization/accent.ts#L149)

- One shared brand panel, hidden below `lg`, used by both sign-in steps.
  [`auth-layout.tsx:21`](../../apps/web/src/components/auth-layout.tsx#L21)

- Sign-in screen now only composes the layout; flow and controls unchanged.
  [`prijava.tsx:131`](../../apps/web/src/routes/prijava.tsx#L131)

**Tests**

- New gamut sweep: every token must render as measured.
  [`theme-contrast.test.ts:205`](../../test/theme-contrast.test.ts#L205)

- Sidebar text pairs at 4.5:1, closing the pair deferred since 1.3b.
  [`theme-contrast.test.ts:225`](../../test/theme-contrast.test.ts#L225)

- Fidelity now round-trips `base-palette:` too.
  [`theme-fidelity.test.ts:159`](../../test/theme-fidelity.test.ts#L159)

- Glyph gate runs for both faces, not only the first import.
  [`typography-coverage.test.ts:44`](../../test/typography-coverage.test.ts#L44)
