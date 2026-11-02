# Epic 15 Context: The app looks current, and still reads at a glance

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Users said the app looks old-fashioned. Epic 15 moves every screen to direction G, "Staklo": light glass chrome over a pale page, Outfit type, Phosphor fill icons and ink primary actions, in both themes. It changes no behaviour, data, routes or copy. A user must still find each answer in one glance, and nothing a conflict, a slot or a number says may change. The pilot (15.1, *Kalendar* and the shell) was accepted by the product owner on a phone, and the primitives and layered surfaces (15.2) shipped. The work left is the member and admin screens (15.3, 15.4), the dark, fallback and low-end hardening (15.5), and one filter pattern on every filtered surface (15.7), which the product owner added after the pilot.

## Stories

- Story 15.1: Pilot: *Kalendar* and the shell in glass, on real data, on a phone (done)
- Story 15.2: Every primitive and layered surface in glass, restyled once (done)
- Story 15.3: Member surfaces read in glass
- Story 15.4: Admin surfaces read in glass
- Story 15.5: Glass holds in the dark theme, without blur support, and on a low-end phone
- Story 15.6 (optional, outside v1): A week view on the desktop and a day view on the phone
- Story 15.7: Every filter is one summary bar, a *Filtri* sheet and removable chips

## Requirements & Constraints

- **The conflict red is reserved.** `destructive` marks only an unresolved conflict. It is never a badge on a mixed count, a delete button or an accent. The mockup's red count on *Za odluku* is not built.
- **Colour never carries meaning alone.** Shift states keep their glyph and their fill or ring. The active nav row keeps semibold, a non-colour indicator and `aria-current`. A filter chip is told apart by its words and its ✕.
- **Colour goes by slot, never by shift-type name.** The shipped slot ramp stays as opaque cells. The mockup's indigo slot-2 is not used, because it breaks the conflict-ring contrast.
- **Every digit is tabular** (`tnum`). Every face covers č ć ž š đ and their capitals.
- **Targets are at least 44 px**, even where a mockup draws them smaller.
- **Both themes**, with every token defined in both.
- **Screens compose primitives and never restyle them.** Glass is a primitive or token treatment, never a class string on a screen.
- **Nothing from the mockups' copy or IA is adopted.** Keep *Odsutnost u smjeni*, *čeka odluku* and *Odluči*. A hygiene test bans "konflikt". The nav order stays: Danas, Kalendar, Sati, Godišnji, Za odluku, Ljudi, Postavke rotacije, Organizacija. The phone keeps four tabs plus *Više*. The calendar legend and the leave and uncovered hatches stay.
- **Docs ship with the code.** Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same PR. 15.5 writes UX-DR53 (glass) and EXPERIENCE.md §Accessibility Floor.
- **The month still renders in at most 2 s** (NFR-22).
- **Success:** every glass text pair clears 4.5:1, and every boundary and icon clears 3:1, against the worst-case backdrop. The solid fallbacks work. A low-end Android trace meets the budget. The ring, the ramp, the glyphs and the legend read as before.

## Technical Decisions

- **Stack already in place (15.1, 15.2).** Outfit is self-hosted, with `tnum` set once on the document. `@phosphor-icons/react` with the `fill` weight is reached only through `components/ui/icon.tsx`, and no file imports lucide. The default Button is ink. Blue `primary` is for selection, today, links, progress and the focus ring. The `--sidebar*` navy is now a glass set. Dialog, ConfirmDialog, Popover and the docked sheets are glass panels over a tinted, never blurred `glass-scrim` backdrop. Timeline has its own `dark` tone token. The token values live in the DESIGN.md front matter (`glass:`, `base-palette`) and `index.css`. `theme-fidelity` round-trips them, so change both together.
- **Where glass goes.** Glass is for floating chrome only: the sidebar, the tab bar, the phone's sticky month head, dialogs, popovers and docked sheets. Tables, lists, the grid, forms, data cards, resolution options and the consequence strip are opaque reading surfaces (at least `.85`) with no `backdrop-filter`. Chrome that content scrolls under uses `glass-over-content`, with foreground-strength text only.
- **Org accent.** It tints only the lockup tile and a 2 px edge on the sidebar and the tab bar.
- **Contrast.** `theme-contrast` composites each glass pair over the page, over each blob, and, for over-content glass and panels, over the darkest fill that can scroll under it. It reuses the existing `composite()` helper.
- **Fallbacks (15.5 pins them).** Under `@supports not (backdrop-filter)` and `prefers-reduced-transparency: reduce`, glass resolves to the opaque card colour. Under `forced-colors: active` it resolves to `Canvas` with a `CanvasText` border. Always emit `-webkit-backdrop-filter`.
- **Dark values.** The dark glass values were proposed as starting points. 15.5 tunes and pins them.
- **Performance budget.**
  - No `backdrop-filter` in a scrolling list or grid, a card, a row or a cell.
  - At most three blurred layers on a phone at once, with blur of at most 24 px.
  - No blur on the Dialog `::backdrop`.
  - On a low-end Android, scrolling *Kalendar* has no frame over 50 ms from paint or composite.
- **15.7 build.** The product owner chose a shadcn-style Sheet, Button, Badge and Popover/Command. Build it on the app's own Dialog (`docked`) and Popover primitives, or on a new primitive restyled once in `components/ui`. Name any new dependency (e.g. `cmdk`) in the PR.
- **Tests that churn.** `theme-fidelity`, `theme-contrast`, `typography-coverage` and the structural pins (`structural-pins-shell` most of all). The e2e tests are role-based, but a phone test may need to scroll past the floating bar.
- **No changes** to Supabase, RLS, migrations, routes, i18n structure, CI or deploy.

## UX & Interaction Patterns

- **Mockups are a reference for look only.** They are in `ux-designs/ux-shift-2026-10-30-glass/`. Their week and day layouts, indigo slot-2, red badge, copy and sidebar order are not adopted. For 15.7, `filters-15-7-po-reference.png` is a PO mockup, and its filter names and values are illustrative.
- **Shell.**
  - Desktop: a floating glass sidebar, inset from the viewport edge, with the active row as a white pill.
  - Phone: a floating glass tab-bar pill above the safe area. The page reserves the bar's height, so the last row is reachable.
- **15.3 member surfaces.** Sign-in, set-password, Danas, Sati and *Moji sati*, Godišnji and *Zatraži*, the Ljudi directory, `/obavijesti`, and the error, not-found and pending pages. Make screen-level fixes only where the composition is wrong. *Danas*'s *Treba tebe* card keeps its `destructive` edge.
- **15.4 admin surfaces.** Za odluku, the resolution and request decisions, the member page and its dialogs, the day detail and its change dialogs, the rotation builder and its sticky save bar, Organizacija, hour bands and teams.
- **15.7 filter pattern.** It applies to *Kalendar*, *Sati* and *Ljudi*. *Godišnji* draws the same option-chip bar as *Ljudi* today.
  - **Summary bar.** One glass-reading card holds an icon, the muted tabular summary (`Prikazano: …`) and a `Filtri` Button. The button is at least 44 px and carries a Badge with the active-filter count.
  - **Chips.** Under the bar, each active filter is a removable chip (`Smjena: B ✕`). `Očisti sve` shows while any filter is on.
  - **Sheet.** `Filtri` opens a Sheet that holds every filter of the surface. It is docked at the bottom on a phone and at the side from 1024 px. Each value is picked in a Popover with a searchable Command list: options carry muted tabular counts, and the chosen one is marked. The footer has one `Prikaži {n}` and one `Poništi`.
  - **Month control.** On *Kalendar* and *Sati*, the month becomes a compact header control beside the title: 44 px ‹ and › around the month name, which opens the month picker. The `Ovaj mjesec` Badge goes. Returning to the current month stays one action, in the picker.
  - **Kept behaviour.** Everything from stories 7.4, 7.5 and 7.13 stays: URL search params, counts, focus moves, the keyboard model, the offline read and the phone sticky head.
- **No motion.** Glass needs no motion token, and the blobs are never animated. Glass is never a state signal.

## Cross-Story Dependencies

- **Order.** 15.3 and 15.4 follow 15.2, in either order or folded into one. 15.5 follows both. 15.7 depends only on 15.2 (the docked Dialog and the glass Popover).
- **Shared surfaces.** 15.7 and 15.3 both touch *Sati* and *Ljudi*, and 15.7 and 15.4 both touch the admin *Ljudi* list. Coordinate, or merge `origin/main` before starting.
- **Epic 11** starts after 15.2. 11.3's `warning` token and short-staffed glyph are measured on the glass surfaces and drawn as a Phosphor icon.
- **15.6** needs a PRD edit (week and day views are out of v1) and a new FR. It runs only if decision D6 brings it in.
- **Hot files.** This epic holds `index.css`, `components/ui/*`, `chrome.tsx` and `structural-pins-shell.test.ts`. No parallel session may restyle them at the same time. Merge `origin/main` and never rebase. Epics 12–14 inherit the look through the primitives.
