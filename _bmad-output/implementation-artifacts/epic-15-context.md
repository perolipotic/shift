# Epic 15 Context: The app looks current, and still reads at a glance

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Users said the app looks old-fashioned. Epic 15 moves every screen to direction G, "Staklo": floating glass chrome over a pale page with static blobs, Outfit type, Phosphor `fill` icons and ink default actions, in both themes. It changes no behaviour, data, routes or copy. A user still finds each answer in one glance, and nothing a conflict, a slot or a number says may change. 15.1 (pilot, accepted by the PO on a phone), 15.2 (primitives and layered panels), 15.3 and 15.4 (member and admin surfaces) and 15.7 (one filter pattern on every filtered surface, which the PO added after the pilot) have merged. 15.5, the dark, fallback and low-end hardening, pins the glass rules as UX-DR53; its real low-end Android trace stays with the product owner (deferred-work). Still to do: 15.7b, the month control.

## Stories

- Story 15.1: Pilot: *Kalendar* and the shell in glass, on real data, on a phone (done)
- Story 15.2: Every primitive and layered surface in glass, restyled once (done)
- Story 15.3: Member surfaces read in glass (merged)
- Story 15.4: Admin surfaces read in glass (merged)
- Story 15.5: Glass holds in the dark theme, without blur support, and on a low-end phone
- Story 15.6 (optional, outside v1): A week view on the desktop and a day view on the phone
- Story 15.7: Every filter is one summary bar, a *Filtri* sheet and removable chips, and the month is a compact header control

## Requirements & Constraints

- **`destructive` is reserved for an unresolved conflict.** Never use it for a badge on a count, a delete button or an accent, so the Filtri count Badge is not red.
- **Colour never carries meaning alone.** A filter chip is told apart by its words and its ✕. The chosen option is pressed or marked, not only tinted.
- **Targets are at least 44 px**, even where the mockup draws them smaller. This covers ‹ ›, the chip ✕, `Filtri` and the option rows.
- **Every digit is tabular.** Counts and summaries are muted and tabular.
- **Both themes.** Every token is defined in light and dark.
- **Copy and IA stay.** Nothing from the mockups' copy or IA is adopted. A hygiene test bans "konflikt". Team is `Smjena` and shift type is `Tip smjene`. `Sve smjene (4)` always shows its count.
- **Docs ship with the code.** 15.7 updates DESIGN.md (*month toolbar*, *Filter chip row*, *Filter sheet*), EXPERIENCE.md (month toolbar, filter chips, Ljudi's filters, plus Godišnji's chip bar if it changes) and the UX-DRs it touches (UX-DR19 filter and UX-DR30 month navigation, at minimum) in the same PR.
- **The month renders in at most 2 s** (NFR-22).

## Technical Decisions

- **Glass utilities.** Glass is only the tokens and three utilities in `index.css`: `glass-chrome`, `glass-over-content` and `glass-panel`. These are the only `backdrop-filter`s, each also emitted with `-webkit-`. A screen never names a glass class. The one exception is the rotation save bar (`saveBarClassOf`).
- **Panels.** Dialog, ConfirmDialog, Popover and the docked sheets are `glass-panel`, at `glass-reading` alpha (.85 light, .92 dark), over a tinted `glass-scrim` that is never blurred.
- **Where muted text may sit.** Muted text appears only on surfaces of at least .85 or on opaque ones. Text on over-content glass, such as the phone's sticky month head, is `foreground`-strength.
- **Opaque reading surfaces.** Cards, tables, lists, rows and cells never carry `backdrop-filter`. The summary bar is a reading card.
- **Primitives for 15.7.** Build on the app's own Dialog and Popover:
  - `<Dialog docked>` is the bottom sheet. Screens never restyle it. The sheet docks at the side from 1024 px, a new variant made once in `components/ui`.
  - Popover is non-modal and named by the screen. Escape or a press outside closes it and focus returns to the trigger. Tabbing out closes it. Closed means unmounted.
  - A Popover is never inside a `glass-*` ancestor, where the blur would be clipped.
  - A dialog opened over another marks the lower one `data-covered`, so only the top panel is blurred.
  - The PO chose shadcn-style Sheet, Button, Badge and Popover/Command. If one is missing, add it once in `components/ui`, and name any new dependency (e.g. `cmdk`) in the PR.
- **Icons** come only through `components/ui/icon.tsx` (Phosphor). No file imports lucide.
- **Performance budget.** Blur is at most 24 px. A phone has at most three blurred layers at once: the tab bar, the sticky head and one panel. The Dialog `::backdrop` is never blurred.
- **Contrast.** `theme-contrast` measures each glass pair against the worst backdrop: the scrim over the ink button, every slot fill and the conflict red. Any new glass pair must pass it: 4.5:1 for text, 3:1 for boundaries and the ring.
- **Tests that churn.** `theme-fidelity` (DESIGN.md front matter ↔ `index.css`), `theme-contrast`, `typography-coverage` and the structural pins. The e2e tests are role-based. A phone test may need to scroll past the floating tab bar.
- **Out of scope.** No changes to Supabase, RLS, migrations, routes, the i18n structure, CI or deploy.

## UX & Interaction Patterns

- **PO reference.** The reference is `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-10-30-glass/filters-15-7-po-reference.png`. Its filter names and values are illustrative. The mockups in that folder set the look only: their week and day views, indigo slot-2, red badge, copy and sidebar order are not adopted.
- **15.7 surfaces.** *Kalendar*, *Sati* and *Ljudi*. *Godišnji* draws the same option-chip bar today, with *Smjena* and *Stanje*. *Moj raspored* shows no filters, only its one sentence.
- **Summary bar.** One reading card holds:
  - an icon;
  - the muted tabular summary, which stays the `role="status"` line, e.g. `Prikazano: sve smjene (4) · 17 osoba`;
  - a `Filtri` Button of at least 44 px with a Badge for the active-filter count.

  Under the card, each active filter is a removable chip (`Smjena: B ✕`), with `Očisti sve` while any filter is on. `Očisti sve` replaces the bar's `Poništi filtre`: it clears everything and moves focus to `Filtri` (on *Ljudi* and *Godišnji*, to the search), replacing "moves focus to the first control".
- **Sheet.** `Filtri` opens a sheet that holds every filter of the surface. It docks at the bottom on a phone and at the side from 1024 px.
  - Each value is picked in a Popover with a searchable Command list: options carry muted tabular counts, and the chosen one is marked. Search ignores diacritics.
  - The footer has one `Poništi` and one live `Prikaži {n}`.
  - Every opening starts with an empty search. The sheet closes on `Prikaži…`, on Escape, or when the viewport crosses the breakpoint.
- **Month control** on *Kalendar* and *Sati* — MOVED to story 15.7b (2026-11-03, the product owner's split; deferred-work): the compact header control and the removal of the `Ovaj mjesec` Badge ship there, not in 15.7. It becomes a compact header control beside the page title: 44 px ‹ and › around the month name, which opens the month picker.
  - The `Ovaj mjesec` Badge is removed. Returning to the current month stays one action, the picker footer's `Ovaj mjesec`.
  - Keep the picker as it is: the year ‹ ›, a 4×3 grid of months, ← → ↑ ↓ and Enter, and PgUp/PgDn within the toolbar. Below 640 px it is a bottom sheet. Focus moves to the month button at a bound.
  - The visually hidden month heading stays.
- **Kept behaviour** from stories 7.4, 7.5 and 7.13:
  - Filter state lives in the URL (`?smjena=&osoba=`, and on *Ljudi* `?trazi=&razina=&smjena=&status=&sort=`, each absent at its default), so Back works and the state survives a month change.
  - Counts come from live records.
  - In *Kalendar* a person replaces the team. On *Sati* the two combine.
  - On *Ljudi*, `Status: aktivni` is the default and draws active.
  - After a ✕, focus goes to the next chip, or to `Filtri` where that chip is not drawn.
  - The zero-row empty states keep `Ukloni filtar: …` and `Poništi filtre`.
  - The offline read is kept.
  - On a phone the month toolbar is the sticky `glass-over-content` head, at most about 160 px. It repeats the active filters as one line once the bar has scrolled away.
- **No motion.** Glass needs no motion token and is never a state signal.

## Cross-Story Dependencies

- **15.7 depends only on 15.2.** It needs the docked Dialog and the glass Popover, both shipped. Its surfaces were restyled by 15.3 (*Sati*, *Ljudi*, *Godišnji*) and 15.4 (admin *Ljudi*), so merge `origin/main` before starting and never rebase.
- **15.5 follows** and tunes the dark glass values. Its tests pin the solid fallbacks: `@supports not (backdrop-filter)`, reduced transparency, and `Canvas`/`CanvasText` under forced colours. New 15.7 surfaces must not break them.
- **Epic 14's change history** (UX-DR51) will use filter chips for period, member, team and kind, and inherits 15.7's pattern.
- **Hot files.** `index.css`, `components/ui/*`, `chrome.tsx` and the structural pin tests. Parallel sessions must not restyle them at the same time.
