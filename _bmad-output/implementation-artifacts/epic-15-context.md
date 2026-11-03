# Epic 15 Context: The app looks current, and still reads at a glance

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Users said the app looks old-fashioned. Epic 15 moves every screen to direction G, "Staklo": light glass chrome over a pale page, Outfit type, Phosphor fill icons and ink primary actions, in both themes. It changes no behaviour, data, routes or copy. A user must still find each answer in one glance, and nothing a conflict, a slot or a number says may change. The pilot (15.1), the primitives and layered panels (15.2), the member surfaces (15.3) and the admin surfaces (15.4) have shipped. The work left is the dark, fallback and low-end hardening (15.5), which pins the glass rules as UX-DR53, and one filter pattern on every filtered surface (15.7), which the product owner added after the pilot.

## Stories

- Story 15.1: Pilot: *Kalendar* and the shell in glass, on real data, on a phone (done)
- Story 15.2: Every primitive and layered surface in glass, restyled once (done)
- Story 15.3: Member surfaces read in glass (merged)
- Story 15.4: Admin surfaces read in glass (merged)
- Story 15.5: Glass holds in the dark theme, without blur support, and on a low-end phone
- Story 15.6 (optional, outside v1): A week view on the desktop and a day view on the phone
- Story 15.7: Every filter is one summary bar, a *Filtri* sheet and removable chips

## Requirements & Constraints

- **The conflict red is reserved.** `destructive` marks only an unresolved conflict. It is never a badge on a mixed count, a delete button or an accent. The mockup's red count on *Za odluku* is not built.
- **Colour never carries meaning alone.** Shift states keep their glyph and their fill or ring. The active nav row keeps semibold, an underline and `aria-current`. A filter chip is told apart by its words and its ✕.
- **Colour goes by slot, never by shift-type name.** The slot ramp stays as fully opaque cells. The mockup's indigo slot-2 is not used.
- **Every digit is tabular** (`tnum`). Every face covers č ć ž š đ and their capitals.
- **Targets are at least 44 px**, even where a mockup draws them smaller.
- **Both themes**, with every token defined in both.
- **Screens compose primitives and never restyle them.** Glass is a token or primitive treatment, never a class string on a screen. The only exception is the rotation save bar (see below).
- **Nothing from the mockups' copy or IA is adopted.** Keep *Odsutnost u smjeni*, *čeka odluku* and *Odluči*. A hygiene test bans "konflikt". The nav order stays: Danas, Kalendar, Sati, Godišnji, Za odluku, Ljudi, Postavke rotacije, Organizacija. The phone keeps four tabs plus *Više*. The calendar legend and the leave and uncovered hatches stay.
- **Docs ship with the code.** Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same PR. 15.5 writes UX-DR53 (glass) and the glass part of EXPERIENCE.md's Accessibility Floor.
- **The month still renders in at most 2 s** (NFR-22).
- **Success:** every glass text pair clears 4.5:1, and every boundary, accent edge and focus ring clears 3:1, against the worst-case backdrop in both themes. The solid fallbacks work and a test pins them. A low-end Android trace meets the budget and is linked from the PR. The ring, the ramp, the glyphs and the legend read as before.

## Technical Decisions

- **Stack in place.** Outfit is self-hosted, with `tnum` set once on the document. `@phosphor-icons/react` (`fill`; small status marks `bold`) is reached only through `components/ui/icon.tsx`, and lucide is banned. The default Button is ink. Blue `primary` is for selection, today, links, progress and the focus ring. Dark `primary` is `#3FA0FA` since 15.2.
- **Tokens.** The navy `--sidebar*` set is retired (15.3). Each theme has 63 colour tokens: 20 base, 32 brand and 11 glass. There are three glass effects: `glass-blur`, `glass-saturate` and `glass-shadow`. The values live in the DESIGN.md front matter (`glass:`, `base-palette:`) and in `index.css`. `theme-fidelity` round-trips them, so change both together. The Timeline uses `band-dark`, and the Dialog backdrop is the tinted, never blurred `glass-scrim`.
- **Where glass goes.** It is the three utilities in `index.css` (`glass-chrome`, `glass-over-content`, `glass-panel`), the only `backdrop-filter`s in the app. Glass is used for:
  - the desktop sidebar;
  - the phone tab bar and the phone's sticky month head;
  - the sign-in brand panel from `lg` up, with `foreground` text and an ink tile, never the org accent;
  - the Dialog, ConfirmDialog, Popover and the docked sheets (panels are `glass-reading`: .85 light, .92 dark);
  - the rotation save bar.

  Everything else is an opaque reading surface with no blur: tables, lists, the grid, forms, data cards, resolution options, the consequence strip and the change dialogs' *Što se mijenja* box (a `muted` fill). A Popover never sits inside a `glass-*` ancestor.
- **Two chrome alphas.** `glass` (.58) is for chrome beside content. `glass-over-content` (.80 light, at least .72; .80 dark) is for chrome that content scrolls under. Text on that glass is `foreground`-strength, never muted.
- **Rotation save bar exception (15.4).** It is a `glass-over-content` `rounded-3xl` pill inside the page padding, named on the screen in `features/rotation/utils/stepper.ts` (`saveBarClassOf`). From `sm` it sits sticky 16 px above the bottom while there are unsaved changes, and the scroll padding is 7rem. *Odbaci promjene* is the `chrome` Button, because an outline border measured 2.73:1 on that glass.
- **Org accent.** It tints only the lockup tile and a 2 px edge on the sidebar and the tab bar.
- **Contrast.** `theme-contrast` composites each glass surface over the page, over each blob at full strength, and, for over-content glass and panels, over the card and every opaque fill that can sit under it (cells, ink, primary, the conflict red, muted). For a Dialog it also adds `glass-scrim`. Blur is ignored.
- **Fallbacks (15.5 pins them).** Under `@supports not (backdrop-filter)` and `prefers-reduced-transparency: reduce`, glass resolves to the opaque `card`. Under `forced-colors: active` it resolves to `Canvas` with a `CanvasText` border, and the active row keeps its underline. A Dialog's scrim stays in every fallback. Always emit `-webkit-backdrop-filter`.
- **Dark values.** The dark glass alphas, `glass-active`, the scrim and the blobs were starting points. 15.5 tunes and pins them.
- **Performance budget.**
  - Blur is at most 24 px. Saturate is 160 % (140 % dark).
  - No `backdrop-filter` in a scrolling list or grid, a card, a row or a cell.
  - At most three blurred layers at once. On a phone that is the tab bar, the sticky head or the save bar (they never share a screen), and one panel. From `sm` it is the sidebar, the save bar and one panel. A covered dialog (`data-covered`) draws opaque and unblurred.
  - No blur on a Dialog `::backdrop`.
  - On a low-end Android, scrolling *Kalendar* has no frame over 50 ms from paint or composite.
- **15.7 build.** The product owner chose a shadcn-style Sheet, Button, Badge and Popover/Command. Build it on the app's Dialog (`docked`) and Popover primitives, or on a new primitive restyled once in `components/ui`. Name any new dependency (e.g. `cmdk`) in the PR.
- **Tests that churn.** `theme-fidelity`, `theme-contrast`, `typography-coverage` and the structural pins (`structural-pins-shell` most of all). The e2e tests are role-based, but a phone test may need to scroll past the floating bar.
- **No changes** to Supabase, RLS, migrations, routes, i18n structure, CI or deploy.

## UX & Interaction Patterns

- **Mockups are a reference for look only.** They are in `ux-designs/ux-shift-2026-10-30-glass/`. Their week and day layouts, indigo slot-2, red badge, copy and sidebar order are not adopted. For 15.7, `filters-15-7-po-reference.png` is a PO mockup, and its filter names and values are illustrative.
- **Shell.**
  - Desktop: a floating glass sidebar inset 16 px, with the active row as a `glass-active` pill.
  - Phone: a floating glass tab-bar pill 16 px from the sides and 0.75 rem above the safe area. Every page reserves its height, so the last row and a keyboard-revealed cell land above it.
- **Shipped surfaces.** The member and admin screens are opaque cards and notices on the page backdrop. Their only glass is the chrome, the panels and the save bar. *Danas*'s *Treba tebe* card keeps its `destructive` edge.
- **15.7 filter pattern.** It applies to *Kalendar*, *Sati* and *Ljudi*. *Godišnji* draws the same option-chip bar as *Ljudi* today.
  - **Summary bar.** One `glass-reading` card holds an icon, the muted tabular summary (`Prikazano: …`) and a `Filtri` Button. The button is at least 44 px and carries a Badge with the active-filter count.
  - **Chips.** Under the bar, each active filter is a removable chip (`Smjena: B ✕`). `Očisti sve` shows while any filter is on.
  - **Sheet.** `Filtri` opens a Sheet that holds every filter of the surface. It is docked at the bottom on a phone and at the side from 1024 px. Each value is picked in a Popover with a searchable Command list: options carry muted tabular counts, and the chosen one is marked. The footer has one `Prikaži {n}` and one `Poništi`.
  - **Month control.** On *Kalendar* and *Sati*, the month becomes a compact header control beside the title: 44 px ‹ and › around the month name, which opens the month picker. The `Ovaj mjesec` Badge goes. Returning to the current month stays one action, in the picker.
  - **Kept behaviour.** Everything from stories 7.4, 7.5 and 7.13 stays: URL search params, counts, focus moves, the keyboard model, the offline read and the phone sticky head.
- **No motion.** Glass needs no motion token, and the blobs are never animated. Glass is never a state signal.

## Cross-Story Dependencies

- **Order.** 15.5 follows 15.3 and 15.4, which are both merged. 15.7 depends only on 15.2 (the docked Dialog and the glass Popover).
- **15.5 inherits review findings** recorded in `deferred-work.md`:
  - Panel pairs with thin margins must be re-measured after any tuning: light `muted-foreground` is about 4.51–4.53:1, dark `input` 3.08:1, and the light ring beside the input 3.22:1.
  - The sign-in ink tile must stay perceivable under forced colours.
  - The save bar's states need checking: its `opacity-50` disabled and pending buttons, and its borderless `chrome` Discard on `Canvas`.
  - The save bar's offline-note row can outgrow the 7rem scroll padding.
- **Shared surfaces.** 15.7 touches *Sati* and *Ljudi* (member and admin), which 15.3 and 15.4 just restyled. Merge `origin/main` before starting.
- **Epic 11.** 11.3's `warning` token and short-staffed glyph are measured on the glass surfaces and drawn as a Phosphor icon.
- **15.6** needs a PRD edit (week and day views are out of v1) and a new FR. It runs only if decision D6 brings it in.
- **Hot files.** This epic holds `index.css`, `components/ui/*`, `chrome.tsx` and `structural-pins-shell.test.ts`. No parallel session may restyle them at the same time. Merge `origin/main` and never rebase. Epics 12–14 inherit the look through the primitives.
