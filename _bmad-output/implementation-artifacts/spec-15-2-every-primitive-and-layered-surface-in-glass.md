---
title: 'Every primitive and layered surface in glass, restyled once'
type: 'feature'
created: '2026-10-30'
status: 'done'
baseline_commit: 'b0313365c8c571b828adcd1e383952d6639eeb2e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-15-1-pilot-kalendar-and-the-shell-in-glass.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After the pilot (15.1) the shell and *Kalendar* are in G, but every dialog, popover and docked sheet is still an opaque white box over a navy `::backdrop`. Timeline, IconTile and Button still draw with the navy `--sidebar*` pair, and the two docked sheets restyle the Dialog in screen class strings.

**Approach:** Restyle the layered primitives once in `components/ui`:
- Dialog, ConfirmDialog, Popover and the docked sheets become a new `glass-panel` utility: `glass-reading` alpha plus blur, with the 15.1 fallbacks.
- The Dialog `::backdrop` becomes a tinted `glass-scrim` token, with no blur.
- Dialog gains a `docked` prop, so the *Više* and filter sheets stop restyling it.
- Timeline and IconTile `dark` get their own `band-dark` pair.
- Button `sidebar` becomes `chrome`.
- The other listed primitives keep the 15.1 tokens they already render with, and each pair is measured on its G surface.

## Boundaries & Constraints

**Always:**
- D1–D10 and the epic-15-context hard rules: conflict red reserved, no colour-only meaning, `tnum`, 44 px, both themes, no mockup copy or IA.
- `backdrop-filter` only in the `@utility glass-*` blocks of `index.css`, always with `-webkit-`, blur ≤ 24 px. No blur on `::backdrop`. A phone shows at most three blurred layers (tab bar, sticky head, one panel).
- `glass-panel` falls back to opaque `--card` (no blur support, reduced transparency) and to `Canvas` with a `CanvasText` border (forced colours).
- Every text pair on `glass-panel` clears 4.5:1, and every boundary and ring clears 3:1, against its worst backdrop: the panel over the page, each blob and every opaque fill, and for Dialog, each of those under the scrim first. `muted-foreground` stays allowed on the panel only because its alpha is ≥ .85.
- New colour tokens are OKLCH, declared once per theme, and round-trip with DESIGN.md (`glass:` gets `glass-scrim`, `colors:` gets `band-dark`/`-foreground`).
- `band-dark` keeps today's navy values, so the hour-band look is unchanged.
- Card keeps its opaque `card` fill (human decision 2026-10-30). Panels use the `glass-reading` alpha with blur, never `glass` or `glass-over-content`.
- Dark `--primary` is re-tuned in this story (human decision 2026-10-30, closing the 15.1 deferred gap); light `--primary` stays `#2F55B8`.

**Ask First:**
- Any change to a slot, `destructive` or modifier value, any i18n key or copy, or a screen file beyond `chrome.tsx` and `filter-bar.tsx`.
- Raising `--glass-reading`, or setting a `glass-panel` alpha below .85.

**Never:**
- No Supabase, migration, RLS, route, i18n or CI change. No `pnpm db:reset`. Never amend, force-push or rebase.
- No glass on Card, Table, StackedList, RadioCard, Input or any reading surface. No `Popover` inside a `glass-*` ancestor (a backdrop root clips its blur). No motion token.
- Do not touch the sign-in panel (`auth-layout.tsx`, 15.3) or delete `--sidebar*` while it still uses them.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Dialog over *Kalendar*, phone | The day detail opens while the tab bar and sticky head show | Panel in `glass-panel`, scrim tinted with no blur, three blurred layers at most | N/A |
| Docked sheet | *Više*, or the filter sheet below 640 px | `<Dialog docked>`: bottom, full width, rounded top, safe-area padding, glass panel; the *Više* rows keep `shell-entries-opaque` | N/A |
| Worst backdrop | Light: the ink button under the scrim. Dark: the near-white ink button | Measured: light `muted-foreground` 4.53:1 at .85; dark primary text 3.56:1 at .92 and 4.44:1 on the opaque dark card (both fail) | Dark `--primary` is re-tuned lighter until primary text clears 4.5:1 on the dark card and on the dark panel's worst backdrop, and `primary-foreground` on `primary` still clears 4.5:1; each new ratio is recorded |
| No blur support or reduced transparency | `@supports not …` / `prefers-reduced-transparency` | Panel is opaque `--card`; the scrim stays | N/A |
| Forced colours | `forced-colors: active` | Panel `Canvas` with a `CanvasText` border | N/A |

## Epic AC Deviations

- **"Card (reading alpha)".** Reinterpreted. Card keeps the opaque `card` fill, which is ≥ .85. *Why:* the sticky `bg-card` masks inside cards (the *Kalendar* date column, the rotation preview, the sticky summary) would show a seam over a translucent card, and the product owner approved white cards in 15.1.
- **"Button (… `outline`, `ghost`, `sidebar` → `chrome`)".** Reinterpreted. `sidebar` is renamed `chrome` (borderless, `foreground`, `glass-active` hover, ring with no offset), and `chrome.tsx`'s glass overrides move into it. `outline` and `ghost` keep their classes, because they sit on opaque or ≥ .85 surfaces where their pairs are measured.
- **"Badge, Notice, Callout, IconTile, StatCard, StatTile, Table, StackedList, RadioCard and RadioRow, PageHeader, Input …"** Narrowed. They already render G through the 15.1 tokens (radius, primary, Outfit, Phosphor). 15.2 measures them and changes a class only where a measured pair fails.
- **"No screen file changes, except where a pin moves".** Narrowed. `chrome.tsx` and `filter-bar.tsx` change to adopt `docked` and `chrome`, which removes the screen-side restyling.
- **"Updates … UX-DR11 and UX-DR45 (icon names)".** Already done in 15.1. 15.2 updates UX-DR1 (token count) and UX-DR26 (mockup controls under 44 px are built at 44) instead, as proposal §4.3 assigns.
- **D5 `--sidebar*` retired.** Partly deferred. Every consumer except the sign-in panel moves off it, and 15.3 deletes the set with `auth-layout.tsx`. Deferred-work entry written.

</frozen-after-approval>

## Code Map

- `apps/web/src/index.css` -- glass tokens light :219, dark :311; `@utility glass-chrome` :691 and `glass-over-content` :717 (the pattern for `glass-panel`); `shell-entries-opaque` :668; the header comment at :34-54 names `--sidebar*`'s consumers; `@theme inline` :379 (add `--color-glass-scrim`, `--color-band-dark*`).
- `apps/web/src/components/ui/dialog.tsx:87` -- panel class with `backdrop:bg-sidebar/60`; add `docked`.
- `apps/web/src/components/ui/popover.tsx:39` -- `bg-popover … shadow-sh-lg`.
- `apps/web/src/components/ui/button.tsx:46` -- `sidebar` variant (no consumer). `timeline.tsx:98` and `icon-tile.tsx:24` -- `bg-sidebar` dark tones.
- `apps/web/src/features/navigation/components/chrome.tsx:984-989` (*Više* sheet classes), `:882` (profile Button, ghost with glass overrides), `:873` (the hand-rolled profile menu: stays opaque `popover`, because it sits inside the `glass-chrome` aside, a backdrop root). `components/filter-bar.tsx:710-717` -- FilterSheet classes.
- Popovers: `month-nav.tsx:231` (desktop only; the phone uses the sheet), `filter-bar.tsx:437`, `sort-control.tsx:104`. None renders inside `sticky-head`'s glass.
- Tests: `test/theme-contrast.test.ts` -- navy block :242-315 (the `sidebar` button boundary test reads `button.tsx`), glass worst-backdrop pattern :1133, `composite()` :143, badge/table :317. `test/theme-css.ts` -- `GLASS_TOKENS`, `BRAND_TOKENS`. `test/theme-fidelity.test.ts` -- `glass:` and `colors:` parsers. `test/theme-tokens.test.ts` counts. `test/theme-applied.test.ts`, `pages/structural-pins-shell.test.ts` and `e2e/tests/layout/shell-forced-colours.spec.ts` pin sheet and shell strings.
- `apps/web/components.json` -- `"iconLibrary": "lucide"` (deferred from 15.1). `apps/web/src/components/README.md:77,84` -- the IconTile and Dialog rows.
- Docs: DESIGN.md front matter (`glass:`, `colors:`, counts comment :14), §Elevation rule 1, §Components (Button, Dialog, Popover, IconTile, Timeline, Filter sheet), §Colors register sentence on `sidebar-*`; `epics.md` UX-DR1 :118, UX-DR26.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/index.css` -- Changes:
  - Add `--glass-scrim` (light `rgba(15,23,42,.32)`, dark `rgba(0,0,0,.55)`; 15.5 tunes dark) and `--band-dark`/`--band-dark-foreground` (today's `--sidebar`/`--sidebar-foreground` values) in both themes.
  - Add `@utility glass-panel` on the `glass-over-content` pattern, at `--glass-reading`.
  - Update the header comment.
  - Re-tune dark `--primary` lighter (I/O row 3), and DESIGN.md's dark `primary` with it.
- [x] `components/ui/dialog.tsx` -- Panel `glass-panel`, `backdrop:bg-glass-scrim`, and a `docked` prop carrying the sheet geometry. ConfirmDialog inherits it.
- [x] `components/ui/popover.tsx` -- `glass-panel`.
- [x] `components/ui/button.tsx` -- Rename `sidebar` to `chrome`, and rewrite its comment.
- [x] `components/ui/timeline.tsx`, `icon-tile.tsx` -- `dark` becomes `bg-band-dark text-band-dark-foreground`.
- [x] `features/navigation/components/chrome.tsx`, `components/filter-bar.tsx` -- Use `docked` and `variant="chrome"`, and drop the duplicated classes. Leave the sign-out and *Obavijesti* logic alone.
- [x] `components.json`, `components/README.md` -- Point `iconLibrary` at Phosphor. Note that generated icon imports go through `@/components/ui/icon`. Update the Dialog (`docked`), Button (`chrome`) and IconTile rows.
- [x] `test/theme-*.ts` -- Add `glass-scrim` and the band pair to the token lists, counts and fidelity. Add a "layered surfaces read against their worst backdrop" block (I/O row 3), the band-dark pair, and the `chrome` variant's ring on glass. Retire the `sidebar` button boundary test. Keep the base `sidebar` pairs until 15.3.
- [x] `pages/structural-pins-shell.test.ts`, `test/theme-applied.test.ts`, `e2e/tests/layout/shell-forced-colours.spec.ts` -- Move the pins. The forced-colours spec also opens the *Više* sheet and expects `Canvas` with a `CanvasText` border.
- [x] DESIGN.md, `epics.md` -- Update the sections in the Code Map. `updated: 2026-10-30`.

**Acceptance Criteria:**
- Given the repo, when it is searched, then classes that read a `--sidebar*` token (`bg-sidebar`, `text-sidebar-*`, `border-sidebar-*`, `*-sidebar-ring`, `ring-offset-sidebar`) appear only in `auth-layout.tsx`, no Button variant is named `sidebar`, and `backdrop-filter` appears only inside `@utility glass-*`.
- Given any Dialog, ConfirmDialog, Popover or docked sheet in either theme, when it opens, then it is a glass panel over a tinted, unblurred scrim, and its text, boundaries and ring clear 4.5:1 and 3:1 against the worst backdrop (`theme-contrast`).
- Given *Satni pojasi*, when the timeline renders, then the bands alternate exactly as before, now on `band-dark`.
- Given the PR, when it is opened, then lint, typecheck, unit and e2e tests are green, and it records any re-tuned value with its measured ratio.

## Design Notes

Why `glass-reading` for panels: they carry `DialogDescription` and muted counts, so they must be ≥ .85 (rule 3). Measured light `muted-foreground` at .85 over the scrimmed ink button is 4.53:1, so do not go thinner. The scrim does not help in light, because the worst fill is already dark.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && pnpm typecheck && pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green. Wait until port 5173 is free, and use the shared stack with no reset.

**Manual checks:**
- In both themes, on a phone width: the day detail over *Kalendar*, the *Više* sheet, the filter sheet, and the month picker on desktop. Then the same with reduced transparency emulated.

## Re-tuned values (recorded for the PR)

Measured by `test/theme-contrast.test.ts` ("the layered surfaces read against their worst backdrop"), panel over every backdrop and, for a Dialog, each under the scrim:

- Dark `--primary` `#3B82F6` -> `#3FA0FA` (L 0.6231 -> 0.691, hue 259.8 -> 250). On the dark card 4.44 -> 5.90:1; on the dark panel's worst backdrop (the near-white ink button) 3.56 -> 4.74:1; `primary-foreground` on it 4.92 -> 6.55:1. The hue moved 10 degrees because at 259.8 the lightness that clears the panel sits CIEDE2000 8.7 from dark `--brand-blue`, under the 10 the accents keep from every signal; at 250 it is 11.2. Light `--primary` unchanged.
- Light `--input` `#78879D` -> `#6E7D93`. Not named by the spec, but its "every boundary clears 3:1 against its worst backdrop" failed: a field or outline button on the light panel over the (scrimmed) ink button measured 2.67:1; now 3.06:1 (3.56:1 on the page, 4.19:1 on a card). Dark `--input` unchanged (3.08:1 at its worst on the panel).
- `--ring` light `#1A3275` -> `#13296B`, dark `#B4D2FD` -> `#D6E6FC`, to keep the existing "ring is 3:1 from the input border it abuts" invariant on the panel: light 3.27 -> 3.22:1 (would have been 2.85:1 against the darker input), dark 2.75 -> 3.36:1. On every panel backdrop the ring clears 9.86:1 (light) and 10.34:1 (dark).
- Light `muted-foreground` on the panel: 4.53:1 at .85 over the scrimmed ink button, unchanged (no re-tune needed).

## Suggested Review Order

**The layered glass**

- Entry point: the panel utility. Reading alpha, blur, opaque fallbacks with a `--border` edge, and covered panels.
  [`index.css:797`](../../apps/web/src/index.css#L797)

- The Dialog is the panel over a tinted scrim; `docked` carries the sheet geometry.
  [`dialog.tsx:155`](../../apps/web/src/components/ui/dialog.tsx#L155)

- One blurred panel at a time: the stack marks the panels below the top one `data-covered`.
  [`dialog.tsx:52`](../../apps/web/src/components/ui/dialog.tsx#L52)

- Popover shares the panel and must never sit inside a glass ancestor.
  [`popover.tsx:44`](../../apps/web/src/components/ui/popover.tsx#L44)

- The scrim token, light, tinted and never blurred.
  [`index.css:251`](../../apps/web/src/index.css#L251)

**Re-tuned values (contrast)**

- Dark primary is lighter and its hue moved 10° to keep ΔE from brand-blue.
  [`index.css:387`](../../apps/web/src/index.css#L387)

- Light input is darker so a field holds 3:1 on a panel; the ring moves with it.
  [`index.css:275`](../../apps/web/src/index.css#L275)

- The header records each measured ratio, before and after.
  [`index.css:79`](../../apps/web/src/index.css#L79)

**Off the navy sidebar set**

- The band-dark pair keeps the old navy values, so the hour bands look unchanged.
  [`index.css:298`](../../apps/web/src/index.css#L298)

- Timeline (and IconTile) draw the dark tone from band-dark.
  [`timeline.tsx:99`](../../apps/web/src/components/ui/timeline.tsx#L99)

- The navy `sidebar` variant is replaced by `chrome`: borderless on glass, the ring with no offset.
  [`button.tsx:49`](../../apps/web/src/components/ui/button.tsx#L49)

**Screens that only ask**

- The Više sheet passes `docked` and keeps its opaque rows.
  [`chrome.tsx:995`](../../apps/web/src/features/navigation/components/chrome.tsx#L995)

- The profile card uses the chrome variant, with no overrides.
  [`chrome.tsx:888`](../../apps/web/src/features/navigation/components/chrome.tsx#L888)

- The filter sheet passes `docked`, and a pressed row's count goes foreground on glass.
  [`filter-bar.tsx:722`](../../apps/web/src/components/filter-bar.tsx#L722)

**Tests and docs**

- Panel pairs against every backdrop, scrimmed or not, ink and band-dark included.
  [`theme-contrast.test.ts:1292`](../../test/theme-contrast.test.ts#L1292)

- Dialog over dialog: the lower one covered and unblurred, then blurred again.
  [`calendar.spec.ts:1863`](../../e2e/tests/calendar/calendar.spec.ts#L1863)

- The Više sheet: glass and scrim, and Canvas under forced colours.
  [`shell-forced-colours.spec.ts:97`](../../e2e/tests/layout/shell-forced-colours.spec.ts#L97)

- DESIGN.md glass block with the scrim, round-tripped by theme-fidelity.
  [`DESIGN.md:165`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L165)
