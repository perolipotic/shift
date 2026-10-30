# Epic 15 Context: The app looks current, and still reads at a glance

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Users said the app looks old-fashioned. Epic 15 moves every screen to direction G, "Staklo": light glass chrome over a pale page, Outfit type, Phosphor fill icons and ink primary actions, in both themes. It changes no behaviour, data, routes, i18n keys or copy. A user must still find each answer in one glance, and nothing a conflict, a slot or a number says may change. The work starts with a pilot (15.1). The product owner reviews it on their own phone with real data before the rest of the app moves, and a no-go stops the epic with `main` untouched.

## Stories

- Story 15.1: Pilot: *Kalendar* and the shell in glass, on real data, on a phone
- Story 15.2: Every primitive and layered surface in glass, restyled once
- Story 15.3: Member surfaces read in glass
- Story 15.4: Admin surfaces read in glass
- Story 15.5: Glass holds in the dark theme, without blur support, and on a low-end phone
- Story 15.6 (optional, outside v1): A week view on the desktop and a day view on the phone

## Requirements & Constraints

These hard rules stay exactly as they are:
- **The conflict red is reserved.** `destructive` `#D93A46` (dark `#E85B66`) marks only an unresolved conflict. It is never a badge on a mixed count, a delete button or an accent. The mockup's red count on *Za odluku* is not built.
- **Colour never carries meaning alone.** Every shift state keeps its glyph and its fill or ring. The active nav item keeps semibold, a non-colour indicator and `aria-current`, on the glass pill too.
- **Colour goes by slot, never by shift-type name.** No sun or moon icons, and no type tokens.
- **Every digit is tabular** (`tnum`). Every face covers Latin Extended-A (č ć ž š đ and their capitals).
- **Targets are at least 44 px.** Mockup controls drawn smaller (sidebar rows, ‹ › buttons, view switch) are built at 44.
- **Both themes**, with every token defined in both.
- **Screens compose primitives and never restyle them.** Glass is a primitive or token treatment, never a class string in a screen.
- **Nothing from the mockups' copy or IA is adopted.** The UI keeps *Odsutnost u smjeni*, *čeka odluku* and *Odluči*, and a hygiene test bans "konflikt". The binding nav order stays: Danas, Kalendar, Sati, Godišnji, Za odluku, Ljudi, Postavke rotacije, Organizacija. The phone keeps four tabs plus *Više*. The calendar legend and the leave and uncovered hatches stay.
- **Docs ship with the code.** Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same PR (UX-DR1, 3, 5, 11, 26, 31/32 form only, 40, 45, and the new UX-DR53 for glass).
- **The month render still takes at most 2 s** (NFR-22).

Success means:
- the product owner gives go on the pilot;
- no file imports lucide, DM Sans or Syne;
- every glass text pair clears 4.5:1, and every boundary and icon clears 3:1, against the worst-case backdrop;
- the solid fallbacks work;
- the low-end Android trace meets the budget;
- the ring, the ramp, the glyphs and the legend read as before.

## Technical Decisions

- **Font (D1).** `@fontsource-variable/outfit` (self-hosted, latin and latin-ext subsets) replaces DM Sans, Syne and Shift Figures. Set `font-variant-numeric: tabular-nums` once on `html` in `@layer base`. Outfit's `tnum` gives all ten digits one advance at every weight. Remove `scripts/fonts/build-figures.py` and the `shift-figures-*.woff2` files along with their OFL notice. Map weight 800 to 700. In the pilot, check that `1` and `7` stay legible at 12 px in the grid.
- **Icons (D2).** `@phosphor-icons/react` with the `fill` weight replaces lucide-react. `components/ui/icon.tsx` is the only module that imports an icon library, and screens name icons through it. Record the main-chunk delta in the PR. If it grows by more than 15 KB gzip, switch the facade to fill-only SVGs from `@phosphor-icons/core`, with no screen changing. Name mappings include `TriangleAlert`→`Warning`, `Clock3`→`Clock`, `WifiOff`→`WifiSlash`, `GripVertical`→`DotsSixVertical`, Chevron→Caret, and `CircleDashed`→`CircleDashed`. The leave and uncovered marks must stay told apart by shape.
- **Primary (D3).** The default button is ink: `#111827` with white text in light, and `#F1F5F9` with `#0B1220` text in dark. Blue `#2F55B8` is kept for selection, today, links, progress and the focus ring.
- **Slot ramp (D4).** The shipped ramp stays, as fully opaque cells. Do not use the mockup's indigo slot-2, because it breaks the conflict-ring contrast.
- **Navy retired (D5).** The `--sidebar*` set becomes a glass set. The org accent tints only the lockup tile and a 2 px edge on the sidebar and tab bar, and its window is re-measured against glass. Four things depend on the navy today: `theme-contrast`, the Dialog `::backdrop`, the Timeline `dark` tone (it gets its own token in 15.2) and `chrome.tsx`.
- **Glass tokens (light).**
  - Page `#E8EDF5`, with three blobs: `#B9D3FF`, `#E2CCFF` and `#C6F0E2`. The blobs are **static radial gradients** on a fixed layer, never `filter: blur()`.
  - `glass` is `.58` white, for chrome beside content.
  - `glass-over-content` is at least `.72`, for chrome that content scrolls under. Text on it is foreground-strength only.
  - Reading surfaces are at least `.85`.
  - Blur is 24 px with saturate 160 %, the border is white at 80 %, and the shadow is `0 10px 40px rgba(30,40,70,.10)`.
  - Radii run 14–30 px for chrome and cards. Month-grid cells keep a radius of at most 10 px.
  - Every value round-trips with DESIGN.md front matter (`theme-fidelity`).
- **Dark values (proposed, tuned in 15.5).**
  - Page `#0A1020`, with blobs `#1D3A7A`, `#3B2466` and `#0E4A3C` at about 45 %.
  - `glass` is `rgba(15,23,42,.58)` with saturate 140 %. `glass-over-content` is at least `.80`.
  - The border is `rgba(255,255,255,.10)`, and the shadow is `0 10px 40px rgba(0,0,0,.45)`.
  - The reading surface is `rgba(19,32,53,.92)`.
- **Where glass goes.** Glass is only for floating chrome: the desktop sidebar, the phone tab bar, the phone's sticky month head, Dialog, ConfirmDialog, Popover and the docked sheets. Tables, lists, the grid, forms, data cards, resolution options and the consequence strip are reading surfaces with no `backdrop-filter`.
- **Contrast.** `theme-contrast` composites each glass pair over the page, over each blob and, for over-content glass, over the darkest fill that can scroll under it (light: slot-2; dark: the lightest slot). It reuses the existing `composite()` helper.
- **Fallbacks.** Under `@supports not (backdrop-filter)` and under `prefers-reduced-transparency: reduce`, glass resolves to the opaque card colour. Under `forced-colors: active` it resolves to `Canvas` with a `CanvasText` border. Always emit `-webkit-backdrop-filter`.
- **Performance budget.**
  - No `backdrop-filter` inside a scrolling list or grid, a card, a row or a cell.
  - At most three blurred layers on a phone at once.
  - Blur of at most 24 px.
  - No blur on the Dialog `::backdrop`, which is only tinted.
  - On a low-end Android, scrolling *Kalendar* allows no frame over 50 ms caused by paint or composite.
- **Tests that churn.** High churn: `theme-fidelity`, `theme-contrast`, `typography-coverage` (one Outfit face, a `tnum` assertion, the icon pin) and `structural-pins-shell`. Medium: `theme-tokens` and `theme-applied`. Low: the other structural pins, `modifiers.test.ts` and `localization-applied`. The e2e tests are role-based, but a phone test may need to scroll past the floating bar.
- **No changes** to Supabase, RLS, migrations, routes, i18n, CI or deploy.

## UX & Interaction Patterns

- The mockups in `ux-designs/ux-shift-2026-10-30-glass/` are a reference for **look only**. Their week and day layouts, indigo slot-2, red badge, copy and sidebar order are not adopted.
- **Desktop sidebar.** A floating glass panel, inset 16–20 px from the viewport edge. The active row is a white pill, semibold, with an indicator.
- **Phone tab bar.** A floating glass pill above the safe area. The page reserves the bar's height plus the safe-area inset, so the last row is reachable.
- **Kalendar in the pilot.** The pilot covers the month view only: toolbar, filter chips and sheet, the grid in both modes, *Moj raspored*'s day list, legend and skeleton. Cells keep their label, ring and glyph.
- *Danas*'s *Treba tebe* card keeps its `destructive` edge.
- Glass needs no motion: do not add a motion token, and do not animate the blobs. Glass is never a state signal.

## Cross-Story Dependencies

- **Order.** 10.3 is merged, then 15.1, then 15.2, then 15.3 and 15.4 (in either order, or folded into one), then 15.5. Epic 11 starts after 15.2, so 11.3's `warning` token and short-staffed glyph (a Phosphor icon) are measured on the final surfaces. 10.4 runs in parallel with 15.1–15.2 and merges `origin/main` when either lands.
- **15.1 is gated.** The PR stays **unmerged** until the product owner opens `dvd-demo` on their phone, with Vite bound to the LAN address, and gives go or no-go (D8). 15.2 starts only after go.
- **15.6** needs 15.1 plus a PRD edit, because week and day views are out of v1, and a new FR. It runs only if D6 brings it in.
- **Hot files.** `index.css`, `components/ui/*`, `chrome.tsx` and `structural-pins-shell.test.ts` are held by this epic, so no parallel session may restyle them at the same time. Merge `origin/main` and never rebase. Epics 12–14 inherit the look through the primitives.
