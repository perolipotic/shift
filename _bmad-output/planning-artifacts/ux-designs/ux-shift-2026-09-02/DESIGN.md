---
name: Shift
description: Industry-agnostic shift management platform. shadcn/ui primitives on React + Vite + Tailwind, restyled once in `components/ui` to direction G, "Staklo" (story 15.1 pilot) — light glass chrome over a pale page, ink actions, one blue for selection, Outfit and Phosphor fill icons. Croatian-first UI, light and dark.
status: final
updated: 2026-10-30
colors:
  # ── Brand delta ───────────────────────────────────────────────────
  # The surface tokens (background, card, muted, border, input, ring,
  # sidebar…) are NOT listed here; they live under `base-palette:` below,
  # and the glass set under `glass:`.
  # This block is parsed by test/theme-fidelity.test.ts and must hold
  # exactly 24 brand names (48 values, light and dark). The stylesheet adds
  # the four curated accents' 8 tokens, so it declares 32 brand tokens per
  # theme, beside 28 base-palette and 11 glass colour tokens: 71 colours,
  # plus 2 elevation shadows and 3 glass effects (UX-DR1).
  primary: '#2F55B8'                 # re-tuned by story 15.1 (D3): selection, today, links, progress
  primary-foreground: '#FFFFFF'
  primary-dark: '#3FA0FA'            # re-tuned by story 15.2: 5.90:1 on the dark card, 4.74:1 on the dark panel's worst backdrop
  primary-foreground-dark: '#0B1628'
  # destructive is OVERRIDDEN and RESERVED — see Colors §"The reserved hue"
  destructive: '#D93A46'
  destructive-foreground: '#FFFFFF'
  destructive-dark: '#E85B66'
  destructive-foreground-dark: '#1A0C0E'

  # ── Working-shift ramp ────────────────────────────────────────────
  # Ordered slots an Organization's working Shift Types are assigned to.
  # NOT named day/night: Shift Types are Organization data of arbitrary
  # count (SPEC constraint DI-8). Pilot: Dan → slot-1, Noć → slot-2.
  shift-slot-1: '#E4F0FA'
  shift-slot-1-foreground: '#14496F'
  shift-slot-1-dark: '#00415D'
  shift-slot-1-foreground-dark: '#B8E2FA'
  shift-slot-2: '#1B2735'
  shift-slot-2-foreground: '#CBD8E6'
  shift-slot-2-dark: '#2F3641'
  shift-slot-2-foreground-dark: '#DCE3EE'
  shift-slot-3: '#EFE7F7'          # slots 3-6 verified in both themes, test/theme-contrast.test.ts
  shift-slot-3-foreground: '#4B3168'
  shift-slot-3-dark: '#3C324C'
  shift-slot-3-foreground-dark: '#CBB4E8'
  shift-slot-4: '#FDF0DC'
  shift-slot-4-foreground: '#6E4A12'
  shift-slot-4-dark: '#42361D'
  shift-slot-4-foreground-dark: '#E8C88A'
  shift-slot-5: '#E3F2EC'
  shift-slot-5-foreground: '#1D5644'
  shift-slot-5-dark: '#243E38'
  shift-slot-5-foreground-dark: '#93CFB8'
  shift-slot-6: '#F1EEE6'
  shift-slot-6-foreground: '#5A5344'
  shift-slot-6-dark: '#3A382F'
  shift-slot-6-foreground-dark: '#CFC6AE'
  shift-nonworking: '#F0F3F6'
  shift-nonworking-foreground: '#8D9AA7'
  shift-nonworking-dark: '#0E1828'
  shift-nonworking-foreground-dark: '#8494A8'
  # A hairline that keeps the recessed dark non-working cell a cell (7.1).
  shift-nonworking-border: 'transparent'
  shift-nonworking-border-dark: 'rgba(255,255,255,0.07)'

  # ── Modifier signals ──────────────────────────────────────────────
  # System-defined and fixed. Never the sole carrier of meaning —
  # each pairs with a glyph and a fill treatment (see Components).
  # Leave has no token: its hatch and glyph are drawn in the cell's own
  # foreground (story 5.3c), so the old modifier-leave pair was retired.
  modifier-uncovered: 'rgba(160,110,20,0.22)'
  modifier-uncovered-foreground: '#7A5410'
  modifier-uncovered-dark: 'rgba(230,170,60,0.16)'
  modifier-uncovered-foreground-dark: '#E0AE5C'
  modifier-overridden: '#7A6BC4'
  modifier-overridden-dark: '#9A8BE0'

  # ── Hour band tone (story 15.2) ───────────────────────────────────
  # The Timeline's alternate stretch and IconTile's `dark`, at the navy the
  # `sidebar` pair drew in before, so the bands look exactly as they did.
  band-dark: '#0B1628'
  band-dark-foreground: '#CBD5E1'
  band-dark-dark: '#070E1A'
  band-dark-foreground-dark: '#C0CBDA'
base-palette:
  # ── Surfaces: the shadcn token names, filled with slate and navy ───
  # Every base token in apps/web/src/index.css traces to a hex here, and
  # test/theme-fidelity.test.ts round-trips each one against the stylesheet. The
  # sidebar is navy in BOTH themes, as two distinct navies — kept after story
  # 15.2 only for the sign-in panel, which story 15.3 moves before deleting
  # the set; the shell is glass, the hour band has `band-dark`. Values marked
  # (a11y) deviate from the plain slate step for a measured reason recorded
  # in index.css's header comment.
  light:
    background: '#E8EDF5'            # direction G's pale page (story 15.1)
    foreground: '#0F172A'            # slate-900
    card: '#FFFFFF'
    card-foreground: '#0F172A'
    popover: '#FFFFFF'
    popover-foreground: '#0F172A'
    secondary: '#F1F5F9'             # slate-100
    secondary-foreground: '#1E293B'  # slate-800
    muted: '#F1F5F9'
    muted-foreground: '#556275'      # (a11y) slate-500 is 4.34:1 on muted
    accent: '#F1F5F9'
    accent-foreground: '#1E293B'
    border: '#E2E8F0'                # slate-200, decorative only
    input: '#6E7D93'                 # (a11y) a field's only affordance, 3:1 on the page and on a glass panel's worst backdrop (15.2)
    ring: '#13296B'                  # (a11y) 3:1 against the input border too, on a panel as well (15.2)
    chart-1: '#D4D4D4'               # chart greys: stock shadcn neutrals,
    chart-2: '#737373'               # identical in both themes, consumed by
    chart-3: '#525252'               # nothing yet
    chart-4: '#404040'
    chart-5: '#262626'
    sidebar: '#0B1628'               # navy
    sidebar-foreground: '#CBD5E1'    # slate-300
    sidebar-primary: '#2563EB'       # the active destination's pill
    sidebar-primary-foreground: '#FFFFFF'
    sidebar-accent: '#1A2D47'        # navy-3, hover
    sidebar-accent-foreground: '#FFFFFF'
    sidebar-border: 'rgba(255,255,255,0.08)'
    sidebar-ring: '#93C5FD'
  dark:
    background: '#0A1020'            # direction G's dark page (story 15.1)
    foreground: '#E2E8F0'
    card: '#132035'                  # navy-2
    card-foreground: '#E2E8F0'
    popover: '#132035'
    popover-foreground: '#E2E8F0'
    secondary: '#1C2B44'             # navy-3
    secondary-foreground: '#E2E8F0'
    muted: '#1C2B44'
    muted-foreground: '#94A3B8'      # slate-400
    accent: '#1C2B44'
    accent-foreground: '#F1F5F9'
    border: 'rgba(255,255,255,0.10)'
    input: 'rgba(255,255,255,0.36)'
    ring: '#D6E6FC'                  # (a11y) 3:1 against the input border on the dark panel (15.2)
    chart-1: '#D4D4D4'               # chart greys: stock shadcn neutrals,
    chart-2: '#737373'               # identical in both themes, consumed by
    chart-3: '#525252'               # nothing yet
    chart-4: '#404040'
    chart-5: '#262626'
    sidebar: '#070E1A'               # a darker navy than the page
    sidebar-foreground: '#C0CBDA'
    sidebar-primary: '#1D4ED8'
    sidebar-primary-foreground: '#FFFFFF'
    sidebar-accent: '#132035'
    sidebar-accent-foreground: '#F8FAFC'
    sidebar-border: 'rgba(255,255,255,0.07)'
    sidebar-ring: '#60A5FA'
glass:
  # ── Direction G, "Staklo" (story 15.1) ─────────────────────────────
  # The chrome's glass set, one map per theme; test/theme-fidelity.test.ts
  # round-trips every value against apps/web/src/index.css. `glass` is
  # chrome BESIDE content (the desktop sidebar); `glass-over-content` is
  # chrome content scrolls UNDER (the phone tab bar, the phone's sticky
  # month head), and text on it is foreground-strength only; reading
  # surfaces and the layered panels (Dialog, Popover, the docked sheets,
  # story 15.2) are at least `glass-reading`. The page is `base-palette`'s
  # `background`, with the three blobs as static radial gradients. Dark
  # values are proposed here and tuned by story 15.5.
  light:
    glass: 'rgba(255,255,255,0.58)'
    glass-over-content: 'rgba(255,255,255,0.80)'   # ≥ .72; .80 keeps the accent edge 3:1 over slot-2
    glass-reading: 'rgba(255,255,255,0.85)'
    glass-border: 'rgba(255,255,255,0.80)'
    glass-active: '#FFFFFF'                          # the current row's pill
    glass-scrim: 'rgba(15,23,42,0.32)'               # the Dialog backdrop, tinted, never blurred (15.2)
    glass-blob-1: '#B9D3FF'                          # blue
    glass-blob-2: '#E2CCFF'                          # lilac
    glass-blob-3: '#C6F0E2'                          # mint
    ink: '#111827'                                   # the default button (D3)
    ink-foreground: '#FFFFFF'
    glass-blur: '24px'
    glass-saturate: '160%'
    glass-shadow: '0 10px 40px rgba(30,40,70,0.10)'
  dark:
    glass: 'rgba(15,23,42,0.58)'
    glass-over-content: 'rgba(15,23,42,0.80)'
    glass-reading: 'rgba(19,32,53,0.92)'
    glass-border: 'rgba(255,255,255,0.10)'
    glass-active: 'rgba(255,255,255,0.12)'
    glass-scrim: 'rgba(0,0,0,0.55)'                  # tuned by 15.5
    glass-blob-1: 'rgba(29,58,122,0.45)'
    glass-blob-2: 'rgba(59,36,102,0.45)'
    glass-blob-3: 'rgba(14,74,60,0.45)'
    ink: '#F1F5F9'
    ink-foreground: '#0B1220'
    glass-blur: '24px'
    glass-saturate: '140%'
    glass-shadow: '0 10px 40px rgba(0,0,0,0.45)'
elevation:
  # Soft, and only on cards and layered surfaces. Tailwind: shadow-sh, shadow-sh-lg.
  sh: '0 1px 3px rgba(0,0,0,0.07), 0 4px 16px rgba(0,0,0,0.05)'
  sh-lg: '0 8px 32px rgba(0,0,0,0.10)'
  sh-dark: '0 1px 3px rgba(0,0,0,0.30), 0 4px 16px rgba(0,0,0,0.22)'
  sh-lg-dark: '0 8px 32px rgba(0,0,0,0.45)'
typography:
  # Story 15.1 (D1): one face. DM Sans, Syne and Shift Figures are retired.
  body:
    fontFamily: 'Outfit Variable'    # @fontsource-variable/outfit, self-hosted, latin + latin-ext
  heading:
    fontFamily: 'Outfit Variable'    # the same face; h1-h6 and card titles
    use: 'h1-h6, card titles'
  weights: [400, 500, 600, 700]      # font-extrabold (800) is mapped to 700
  numeric:
    fontVariantNumeric: 'tabular-nums'   # set once on html; Outfit tnum: one 590-unit advance at every weight
rounded:
  base: 16px                         # --radius: 1rem (story 15.1); cards use rounded-lg
  sm: 12px
  md: 14px                           # buttons, inputs
  lg: 16px                           # cards
  xl: 20px
  chrome: 24px                       # the floating sidebar (rounded-3xl); the tab bar is a pill
  cell: 8px                          # month-grid cells, their skeleton and legend swatch: ≤ 10 px
spacing:
  # Tailwind defaults; no overrides.
components:
  shift-cell:
    background: '{colors.shift-slot-N}'
    foreground: '{colors.shift-slot-N-foreground}'
    radius: '{rounded.cell}'
    minHeight: 30px
  shift-cell-nonworking:
    background: '{colors.shift-nonworking}'
    foreground: '{colors.shift-nonworking-foreground}'
    outline: '1px inside {colors.shift-nonworking-border}'   # drawn inside the box: no layout space, survives the rings; off under forced colours
  shift-cell-conflict:
    border: '2px inset {colors.destructive}'
    glyph: '⚠'
  shift-cell-overridden:
    border: '2px inset {colors.modifier-overridden}'
    glyph: '✎'
  shift-cell-leave:
    fill: 'repeating-linear-gradient(-45deg, color-mix(in oklch, currentColor 16%, transparent) 0 4px, transparent 4px 8px)'
    glyph: '◷'
  shift-cell-uncovered:
    fill: 'repeating-linear-gradient(45deg, {colors.modifier-uncovered} 0 4px, transparent 4px 8px)'
    glyph: '◌'
  duty-block:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    progressFill: '{colors.primary}'
  resolution-option:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    borderSelected: '{colors.primary}'
    radius: '{rounded.lg}'
  consequence-strip:
    background: '{colors.background}'
    border: '1px solid {colors.border}'
    radius: '{rounded.md}'
---

## Brand & Style

Shift is an operational tool for people who currently keep the rota in a spreadsheet. The brand premise is **quiet competence**: the product's job is to be trusted with a schedule people plan their lives around, and nothing about it should feel like it is trying to be liked. Light glass chrome over a pale page, ink actions, one blue for selection, and a single red held in reserve for the one thing that must never be missed (direction G, "Staklo", story 15.1).

*Style reference: the direction G mockups, [../ux-shift-2026-10-30-glass/kalendar-g-desktop.dc.html](../ux-shift-2026-10-30-glass/kalendar-g-desktop.dc.html) and [../ux-shift-2026-10-30-glass/kalendar-g-mobitel.dc.html](../ux-shift-2026-10-30-glass/kalendar-g-mobitel.dc.html) (story 15.1); before them [../shiftapp-v2/shiftapp_manager_v2.html](../shiftapp-v2/shiftapp_manager_v2.html) (shell, cards, buttons, inputs, tables) and [../shiftapp-v2/shiftapp_login_onboard.html](../shiftapp-v2/shiftapp_login_onboard.html) (sign-in), which still describe the surfaces 15.2–15.4 have not moved. Every reference is for LOOK only — its copy, its English, its product name, its information architecture, its week and day views, its indigo slot-2 and red count badge, its Google login, signup and demo affordances are not Shift's.*

**The register is modern and calm, not decorative.** Since story 15.1 (the pilot of direction G): a pale `#E8EDF5` page carrying three static colour blobs, floating glass chrome (the desktop sidebar and the phone's tab bar) and, since story 15.2, glass dialogs, popovers and docked sheets over a tinted scrim, white cards with a soft shadow, radii from 12 to 24 px, Outfit for every word and digit, Phosphor `fill` icons (the small status marks — the calendar's leave and uncovered marks and *Danas*'s duty-block legs — in `bold`, so they differ by drawn shape at 12 px; human decision 2026-10-30), an ink default button and blue for selection. The screens 15.2–15.4 have not moved yet keep the visual-refresh-A register (white cards on the page, a 12–16 px card, a navy sign-in panel) until they do. Every surface the product draws inherits it through two layers and only two:

1. **Tokens** in `apps/web/src/index.css`, transcribed from this file's front matter.
2. **Primitives** in `apps/web/src/components/ui` — Button, Card, Input, Label, Table and whatever shadcn primitive is added next. They are shadcn's components, **restyled once there** to this register.

Screens compose primitives and never restyle them. A screen may size and place a primitive (`h-11`, `w-full`, grid placement) but may not override its colour, radius, border, shadow or type. If a screen needs a primitive to look different, the primitive changes — for every screen at once — or a new primitive is added.

Two properties are not stylistic preferences but consequences of the product contract, and may not be traded away:

1. **No colour is the sole carrier of meaning.** Every shift state pairs colour with a glyph, a fill treatment, or a border.
2. **Nothing in the visual language names a shift type.** Colour is assigned to ordered slots, never to "day" or "night".

## Colors

*Rendered reference: [mockups/color-themes-1.html](mockups/color-themes-1.html) — the four palettes considered, light and dark, with the state language applied to the pilot's content.*

**Register.** Since story 15.1: a pale page (`#E8EDF5` light, `#0A1020` dark) with three static blobs, light glass chrome (`glass:`), an ink default action (`#111827` light, `#F1F5F9` dark) and one blue, `primary` `#2F55B8`, kept for selection, today, links, progress and the focus ring's hue. `#2F55B8` reads 6.75:1 on white where the old `#2563EB` read 5.17:1. The slate base (`base-palette:`) stays for cards, text and borders, and the navy `sidebar-*` pair stays only for the sign-in panel, which 15.3 moves before deleting the set (story 15.2 moved the Timeline and IconTile onto `band-dark`, the Dialog backdrop onto `glass-scrim`, and Button's `sidebar` variant became `chrome`). Dark `primary` is `#3FA0FA` since story 15.2 (`#3B82F6` before), so links and selection read 4.5:1 on the dark card and the dark panel. Before 15.1: a slate base, a navy sidebar in both themes, one blue primary `#2563EB`, near-zero decorative colour. The dark theme is navy-based, not grey: a navy page, navy-2 cards, and a darker navy sidebar. Both themes ship: the theme follows `prefers-color-scheme` unless the person pins one with the *Sustav / Svijetla / Tamna* control (human decision 2026-09-25), so every token below is defined in both and no state may rely on a single theme's contrast.

**The reserved hue.** `destructive` is overridden to `#D93A46` and is **reserved exclusively for an unresolved conflict**. It appears nowhere else — not on delete buttons, not on validation errors, not as an Organization's brand accent. This is a hard rule with a specific origin: the pilot is a fire department and the obvious brand accent is red. Had brand red and conflict red been the same red, the alarm colour would have become the furniture and conflicts would have stopped reading as conflicts. Destructive actions that are not conflicts use shadcn's neutral button styles plus a confirmation step.

**Organization branding.** An Organization's accent is data, not design. It tints exactly three things — the lockup tile, and a 2 px edge on the glass sidebar and on the glass tab bar (story 15.1, D5) — and nothing else; with no accent the edge is the glass hairline. A light-theme accent must clear 3:1 against a white card, the page and every glass backdrop it can sit on (the page, each blob and, under the tab bar, every shift fill), and 4.5:1 under its own white letter, which keeps it at roughly OKLCH L 0.53–0.56; the accent values in `index.css` are tuned into that window and `test/theme-contrast.test.ts` measures them there. The tightest is green on the tab bar over a slot-2 cell, 3.25:1, which is why `glass-over-content` is .80 in light rather than .72. It may never be used for a shift state, a modifier, or `destructive`. An Organization whose accent is red gets a red shell and an unchanged red conflict signal — which is why the conflict signal also carries a glyph and a border. The accent tokens are deliberately not listed in this file's front matter: `test/theme-contrast.test.ts` measures each in both themes and holds it away from `destructive`'s hue, and that test, not a copy here, is their source of truth (decided 2026-10-13, deferred-work sweep).

**The working-shift ramp.** Working Shift Types are Organization data of arbitrary count, so colour is assigned to six ordered slots rather than to named shift types. An Organization's Shift Types take slots in creation order; the pilot's `Dan` takes slot 1 and `Noć` takes slot 2. In the light theme slot 1 reads light and cool, slot 2 dark and deep — a deliberate light/dark contrast that happens to suit a day/night organization without encoding one. Slots 3–6 are verified in both themes, `test/theme-contrast.test.ts` (story 2.2b pins that every slot the ramp can return has a measured light and dark pair). Beyond six Shift Types a slot repeats, and the always-visible label carries the distinction. **The always-visible label is the sole distinguisher between ramp slots** (decided 2026-10-13, deferred-work sweep): slots differ by hue, which colour-vision deficiency can erase, and light slot-1 (`#E4F0FA`) measures about 1.04:1 against the light non-working fill, so the D/N/S label every shift-cell carries (UX-DR7, UX-DR37) is what tells them apart, never the fill alone. No palette revision is planned for it.

**The dark ramp has three lightness levels** (story 7.1). The non-working fill recedes below the card (`#0E1828`), *Noć*'s slot-2 rises to a light slate (`#2F3641`) and *Dan*'s slot-1 is a more saturated blue (`#00415D`, the lightest of the three), so a night shift never reads as a free day (1.46:1 and OKLab ΔE×100 12.3 between slot-2 and non-working, pinned in `test/theme-contrast.test.ts`). Slot-2 and non-working share a hue, so beyond lightness they are told apart by `shift-nonworking-border` — a 7 % white hairline in dark, transparent in light, drawn as a 1 px outline inside every non-working cell, chip and tile so it takes no layout space and survives the modifier rings — and by the always-visible label. *Dan* and *Noć* sit at similar lightness and differ by hue (about 24°) and by label. Dark slots 3–6 sit at the same working level (OKLCH L ≈ 0.34, hue and chroma kept; re-tuned 2026-10-15, deferred-work sweep), so every working slot clears the same floor against non-working — contrast ≥ 1.4:1 and OKLab ΔE×100 ≥ 10, measured for all six dark slots in `test/theme-contrast.test.ts`.

**Modifier signals** — leave, uncovered, overridden, conflict — are system-defined and fixed forever. Leave and uncovered are hatch fills, overridden is an inset ring, conflict is an inset ring in the reserved hue. All four also carry a glyph.

## Typography

**One face, self-hosted**, never the Google CDN (story 15.1, D1):

- **Outfit** for every word and every digit — body text, labels, controls, table cells, stat values, headings (`h1`–`h6`, card titles) — through `@fontsource-variable/outfit`, latin and latin-ext. `--font-sans` and `--font-heading` both name it, so a screen still spells no font family and a heading stays a heading slot. Weights 400–700; `font-extrabold` is mapped to 700. It replaced DM Sans, Syne and Shift Figures; the figure face and its build script were retired with them.
- **Every digit is tabular by construction.** Outfit has a real `tnum`: under it all ten digits share one advance (590 units) at every weight in use, where its default digits are proportional (`1` is 321 units, `0` is 659). `font-variant-numeric: tabular-nums` is set once on `html`, so every number in the app is tabular and a column that mixes weights (a semibold date under a regular one, a bold total) still aligns. `test/typography-coverage.test.ts` reads the `tnum` feature out of the shipped font file, and `e2e/tests/layout/numerals.spec.ts` measures the widths in a browser. The pilot checks that `1` and `7` stay legible at 12 px in the compressed grid (Syne's "17 reads as ı7" was the origin of story 7.2).

Two requirements, neither of them stylistic, and each applies to **every** face:

- **Latin Extended-A coverage is mandatory.** Croatian needs **č ć ž š đ Č Ć Ž Đ Š**. A face that falls back mid-word breaks exactly the strings that matter most — `Noć`, `Godišnji`, `Slobodno`, `Izmijenjeno`, and members' own names. Outfit ships a latin-ext subset; `test/typography-coverage.test.ts` checks the import, and any substitution must pass the same check before it lands.
- **Tabular numerals wherever numbers align.** The hours table, every `07:00–19:00`, leave balances, and calendar date columns. Proportional digits make columns wobble and make two totals hard to compare. The document-wide `tnum` makes every digit tabular; the `numeric` token (`tabular-nums`) stays on the slots that align, and a numeric slot never takes `font-heading`.

## Layout & Spacing

Tailwind's spacing scale, no overrides. Controls a person presses keep the 44 px floor (`h-11`) at every width. Two domain rules:

- **The calendar grid is the density budget.** At 390 px a day row carries a date column plus one column per team. Cells hold a 30 px minimum height, a label, and where space allows a time range. Anything that does not fit is not abbreviated — it moves to the day-detail view.
- **Wide content scrolls inside its own container, never the page.** The calendar, week and rotation-preview grids own their horizontal overflow at every width, and so does a table from 640 px. The page body never scrolls sideways at any width.
- **Below 640 px a table becomes stacked rows** (story 7.6, mockup `ux-shift-2026-10-01-redesign/mockups/mobile-tables-1.html`). The Sati, Ljudi, shift-types, leave-overview (story 7.15), hour-band, team, rotation-offset and rotation-history tables render the same view model as a list of `StackedRow`s, so neither the page nor any element in it scrolls sideways; a `usePhone()` switch puts exactly one form in the DOM, never both with one hidden, and never a table restyled with `display` overrides. Sort and filter state live outside the table, so crossing 640 px keeps them. On a phone the sort is one `Poredano: {column} ↑|↓` control above the list.

**The floating chrome** (story 15.1). On the desktop the sidebar is a glass panel floating 16 px in from the viewport's top, bottom and left edges, sticky as the page scrolls; on a phone the tab bar is a glass pill floating 16 px in from the sides and 0.75 rem above the safe area. The phone page reserves the pill's height (4 rem plus its 2 px edge), the float and the safe-area inset at its bottom, and the page's `scroll-padding-bottom` says the same, so the last row and a revealed cell are never hidden under the bar. Content scrolls UNDER the pill and the phone's sticky month head, which is why both are the thicker over-content glass.

**The page skeleton** (visual refresh B). Every screen follows the same pattern, including placeholders and not-found:

- The page is `mx-auto w-full max-w-5xl` with `p-6`, and the `PageHeader` comes first. The title sits top-left and the actions sit at the right, stacking under the title on a phone. Nothing is centred in the viewport.
- Content follows: a table inside a `Card`, a `StatCard` row (2 columns on a phone, 4 from `lg`), or a form in a left-aligned `Card` with `max-w-lg`.
- A refusal and a confirmation are one `Notice` primitive in the Input look: a 1.5 px `input` border on the card colour. `role="alert"` draws a warning icon and `role="status"` a check, so the two differ by shape as well as by words. On a form screen or a card the notice sits in the card. The update notice (story 8.1) is the one app-level `Notice`: `role="status"` with an *Osvježi* `Button` beside it, above the outlet on every route. The as-of note (story 8.2) is the offline variant: `role="status"` with a `WifiSlash` icon (lucide's WifiOff before story 15.1) in place of the check, under the `PageHeader` while a surface draws its snapshot from the device, reading *Bez veze · stanje od 10.10.2026 14:32*. The offline write note (story 8.3a) is the same variant beside a gated write control — once per form, dialog footer or card action row, only while offline — reading *Za ovo je potrebna veza.* (*Za prijavu je potrebna veza.* on the sign-in); the control stays focusable, `aria-disabled` rather than `disabled`, and names the note in its description. Native `<select>`s use the Input look too, and `components/README.md` spells that class string.
- People's names are shown with an `Avatar` (never a team's), and a permission level or an inactive marker is shown as a `Badge`. A name cell wraps rather than widening its column.

## Elevation, glass and depth

**Soft, and sparing.** Two shadow tokens, `sh` and `sh-lg` (`elevation:`), expressed as OKLCH alpha in the stylesheet. Cards carry a 1 px `border` plus `sh`; `sh-lg` was for the layered surfaces (Dialog, Sheet, Popover) until story 15.2 made them glass panels, which carry `glass-shadow` instead. Nothing else floats but the chrome: a rota is still a document, and the shadow says "this is a card", never "look at me".

**Glass** (story 15.1, direction G; the `glass:` front matter, round-tripped by `test/theme-fidelity.test.ts`). The rules, which 15.5 finalises for dark and pins as UX-DR53 (written by 15.5):

1. **Glass is for floating chrome only:** the desktop sidebar, the phone tab bar and the phone's sticky month head (story 15.1), and the layered panels — Dialog, ConfirmDialog, Popover and the docked sheets (story 15.2). Nothing else is glass, and glass is never a class string on a screen: it is the tokens and three utilities in `index.css`, `glass-chrome`, `glass-over-content` and `glass-panel`, the only `backdrop-filter`s in the app, each with `-webkit-backdrop-filter`. The panels are restyled once in `components/ui`; a screen asks for a docked sheet with `<Dialog docked>` and never restyles it. A Popover never sits inside a `glass-*` ancestor, whose backdrop root would clip its blur, which is why the profile menu in the glass sidebar stays an opaque `popover`.
2. **Two glass alphas.** `glass` (light `.58`) is chrome BESIDE content, never over it — the desktop sidebar. `glass-over-content` (light `.80`, at least `.72`; dark `.80`) is chrome content scrolls UNDER — the tab bar and the sticky head. Text on over-content glass is `foreground`-strength, never `muted-foreground`, and muted text appears only on surfaces of at least `.85` (`glass-reading`) or opaque ones; the sidebar's group labels and role line are `foreground` too.
3. **Reading surfaces are at least 85 % opaque** and carry no `backdrop-filter`: tables, stacked lists, the calendar grid and its card, forms, data cards, resolution options and the consequence strip. Shift cells are **fully opaque** slot fills, so the ramp's measured pairs stay true.
4. **Contrast is measured against the worst backdrop.** `test/theme-contrast.test.ts` composites each glass surface over the page, over each blob at full strength and, for over-content glass and a panel, over the card and every opaque fill (every cell, the ink button, a primary fill, the conflict red, a muted row), and for a Dialog each of those under `glass-scrim` too; it holds text to 4.5:1 and every boundary, the accent edge and the focus ring to 3:1 against the worst of them. Blur is ignored: it only averages toward the measured colours. **Panels** (story 15.2) are `glass-reading` (.85 light, .92 dark), never `glass` or `glass-over-content`, because they carry `DialogDescription` and muted counts: light `muted-foreground` measures 4.53:1 at .85 over the scrimmed ink button, so a panel never goes thinner. What failed there was re-tuned and recorded in `index.css`: dark `primary` `#3B82F6` → `#3FA0FA` (3.56:1 → 4.74:1 on the panel, 4.44:1 → 5.90:1 on the dark card), light `input` `#78879D` → `#6E7D93` (2.67:1 → 3.06:1 on the panel), and `ring` light `#1A3275` → `#13296B`, dark `#B4D2FD` → `#D6E6FC`, so the ring stays 3:1 from the input border on a panel (3.22:1 and 3.36:1).
5. **Fallbacks render solid.** Without blur support (`@supports not (backdrop-filter …)`) and under `prefers-reduced-transparency: reduce`, glass resolves to the opaque `card`. Under `forced-colors: active` it is `Canvas` with a `CanvasText` border; the active row keeps its underline. A Dialog's scrim stays in every fallback.
6. **The page's blobs** (`glass-blob-1..3`: blue `#B9D3FF`, lilac `#E2CCFF`, mint `#C6F0E2`; dark `#1D3A7A`, `#3B2466`, `#0E4A3C` at 45 %) are three static radial gradients on one fixed layer behind everything, never a `filter: blur()` and never animated.
7. **Performance budget:** a blur of 24 px at most (`glass-blur`), saturate 160 % (dark 140 %); no `backdrop-filter` on anything inside a scrolling list or grid, a card, a row or a cell; at most three blurred layers on a phone at once (tab bar, sticky head, one open panel — a dialog opened over another marks the one beneath `data-covered`, and `glass-panel` draws it opaque and unblurred); no blur on a Dialog `::backdrop`, which is the tinted `glass-scrim` (`rgba(15,23,42,.32)` light, `rgba(0,0,0,.55)` dark, tuned by 15.5). Story 15.5 measures it on a low-end Android.
8. **The chrome's own pieces:** the hairline is `glass-border` (an inset 1 px, so it takes no layout space), the shadow `glass-shadow` (`0 10px 40px`, 10 % slate light, 45 % black dark), and the current row's pill `glass-active` (white light, 12 % white dark) with `sh`.

## Shapes

A 16 px base radius since story 15.1 (`--radius: 1rem`, widened from 12 px): cards `lg` (16 px), buttons and inputs `md` (14 px), small chips `sm` (12 px), `xl` 20 px; the floating sidebar `3xl` (24 px) and the tab bar a full pill. Month-grid cells, their skeleton and their legend swatch keep their own `rounded-cell` (8 px, at most 10 px whatever the other radii become), so a dense grid reads as a grid rather than as a field of pills.

## Components

*Rendered reference: [mockups/conflict-resolution-1.html](mockups/conflict-resolution-1.html) — resolution-option and consequence-strip in place.*

**Primitives** — shadcn components, restyled once in `components/ui` and never in a screen:

| Primitive | Spec |
|---|---|
| **Button** | `rounded-md`, semibold. Default is **ink** since story 15.1 (D3): `ink` fill and `ink-foreground` text (`#111827`/white light, `#F1F5F9`/`#0B1220` dark) with a soft lift on hover; blue `primary` is kept for selection, today, links and progress. Outline is a 1.5 px `input` border on the card colour. Heights are the primitive's; screens set `h-11`. `chrome` (story 15.2, the navy `sidebar` variant renamed) is the glass shell's own: borderless, `foreground` text, a `glass-active` hover at 60 %, and the focus ring with no offset, drawn straight on the glass and measured against every glass backdrop; the sidebar's profile card is its one consumer. `outline` and `ghost` keep their classes: they sit on opaque or ≥ .85 surfaces, where their pairs are measured. |
| **Card** | `rounded-lg`, 1 px `border`, `shadow-sh`, `card` fill. A header carries a bottom divider; the title is the heading slot (Outfit since story 15.1), and `CardTitle asChild` makes it the page's `<h1>` without restyling. |
| **Input** | `rounded-md`, 1.5 px `border-input` on the card colour, and a 2 px `ring` focus ring. |
| **Table** | Header cells uppercase, small, `muted-foreground` on `muted`; rows divide with `border` and tint to `muted` on hover. A table scrolls inside its own container. Below 640 px the Sati, Ljudi, shift-types, leave-overview, hour-band, team, rotation-offset and rotation-history tables are not rendered: those screens render stacked rows (`StackedList`) instead. A `TableFooter` (story 7.14) closes a table that sums a column: a `muted` 50% fill, semibold, a top `border`, no row divider; only the organization hours table has one. Ljudi's Status column (story 7.13) states `Aktivno` in `muted-foreground`, `Neaktivno` in body text, and a scheduled change as an `outline` Badge, `Od 05.10.: neaktivno`; the word always carries the meaning. |
| **StackedList / StackedRow / StackedFields / StackedField** | A table's phone form (story 7.6): a `ul` named by the table's caption, an `li` per row dividing with `border` and tinting to `muted` on hover, and a `dl` whose `StackedField` pairs every value (`dd`, tabular figures) with its column's own label (`dt`). The label is small `muted-foreground` text above the value where the mockup shows it, and `sr-only` where the row's position carries it, so every value keeps its label for assistive technology. `separated` draws a field on one line after the previous one behind a middle dot. `StackedSkeletonRow` is a loading row in the row's shape. No `overflow-*`: nothing in it scrolls sideways. On Ljudi's row the decorative `Avatar` is hidden below 360 px, so a level's badge fits beside the team. The leave overview's row (story 7.15) is the name over the team, *Preostalo* at the top right, then *Pravo* and *Iskorišteno*; a member with no schedule shows *Pravo* and the unscheduled line. An hour band's row is its tile and name over the window, `19:00–07:00`, and the duration with *Prelazi ponoć*; a team's row is its tile and name; a rotation offset's row is the team with the type it works on the anchor at the right, over the step's picker at full width; a history row is the effective date and the status over who saved it, when, and how many teams it binds. Each keeps its edit or view link at the right. |
| **PageHeader / PageTitle** | The page skeleton's head (visual refresh B). The title is top-left, the heading slot at `text-2xl` extrabold (Outfit 700 since story 15.1), and the actions sit at the right, stacking under the title on a phone. `PageTitle asChild` styles the screen's own `<h1>`, and the primitive carries no copy. |
| **StatCard** | A `Card` with a small uppercase `muted-foreground` label and a large body-face value whose digits are tabular (Outfit `tnum`), never the heading slot. It counts only data the screen already holds, as one snapshot. |
| **Badge** | A `rounded-full` pill in `text-xs` semibold. `default` is a 15% `primary` tint with `foreground` text (chosen when dark `primary` text measured below 4.5:1 on the dark card; story 15.2 re-tuned dark `primary`, and the badge keeps the stronger `foreground`). Badges are measured on the card and on a hovered row. `secondary` is the `secondary` fill, and `outline` is an `input` border with `muted-foreground` text. Its text carries the meaning, and there are no status colours. |
| **Avatar** | A round `secondary` chip for a person, holding initials: the first letter (with its combining marks, after NFC) of the first and last word that has one, so brackets, digits and emoji are skipped. A name with no letter draws an empty chip, so names stay aligned. It is decorative and hidden from assistive technology, because the name is always rendered beside it. |
| **RadioGroup / RadioCard / RadioRow** | Radix's radio group, restyled once (story 5.4b): one tab stop, the arrow keys move and Space selects. `RadioCard` is a whole card as the radio, the words beside the dot and an optional full-width footer under them; its states are the resolution-option's. `RadioRow` (story 5.4c) is one line of a pick list, the replacement candidates: the dot and words that wrap, at least 44 px tall, a transparent border that turns `input` on hover and `primary` when chosen, never a fill. The organization's accent is picked from `RadioCard`s (story 7.18, UX-DR5): two columns from `sm` up, each card the accent's name beside the lockup's mark in that accent (hidden from assistive technology, so no card is a colour alone), with the rule as the group's description; the fire-rank setting is two `RadioRow`s. |
| **Notice** | The one refusal and confirmation box: `rounded-md`, 1.5 px `input` border, `card` fill, `text-sm` medium, and a small Phosphor `fill` icon chosen by its `role` (`alert` a warning, `WarningCircle`; `status` a check, `CheckCircle`; the offline status `WifiSlash`). The icon is hidden from assistive technology; the role announces the message. |
| **PageDescription** | The one-sentence lede under a `PageTitle` (design refresh C): `text-sm` `muted-foreground`, never a second heading. |
| **Dialog** | The one modal (design refresh C), on the native `<dialog>` and `showModal()`: focus trap, Escape, the inert page and focus return come from the browser. A `glass-panel` since story 15.2 (`glass-reading`, blurred, `rounded-lg`, the glass hairline and shadow; opaque `card` without blur support or under reduced transparency, `Canvas` with a `CanvasText` border under forced colours) over a `glass-scrim` backdrop, tinted and never blurred (a `sidebar`-tinted backdrop before). `docked` makes it the phone's bottom sheet — full width at the bottom edge, `rounded-t-2xl`, padded clear of the safe area — so *Više* and the filter sheet never restyle it. A dialog opened over another leaves only the top one blurred. A header carries the heading-slot title and a 44 px close button named by the screen. Closed means hidden, not unmounted: an add dialog keeps its body mounted, and the other add dialogs keep a refused value in their uncontrolled fields after they close. *Dodaj osobu* on Ljudi (story 7.13b) is the exception: it keeps a refused value only while it stays open, starts from an empty form on every opening, and ends in the same dialog with the one-time password, `Kopiraj`, *Dodaj još jednu* and *Otvori stranicu osobe*. A change dialog that draws its body only while open (story 7.9 day detail, story 7.11 member page, story 7.12 leave) keeps a refused value for as long as it stays open and starts afresh on the next opening. Not dismissible while a write it started is in flight. A change opened from a dialog of facts (story 7.9, day detail) is its own small dialog over it, with one Save and a computed *Što se mijenja* (an `<output>`, announced politely); its form is drawn only while it is open, and a refusal keeps what was entered while it is. A change on a page of facts (story 7.11, the member page) is the same small dialog opened from its card's header button, with one final button — `Spremi`, or the action itself for a status change, never `destructive` — and its body is drawn afresh on each opening; since story 7.12 the leave card's record and amend dialogs are two more, each with its computed cost, balance and conflicts as neutral lines. Since story 7.13c the status dialog's deactivation adds one computed neutral line under its question, inside the element the dialog is described by — the team's size before and after and the member's own duties left that month (`Smjena B od tada ima 3 od 4 člana, a u listopadu je to 7 smjena.`), never gating the save — and its final button repeats the date (`Deaktiviraj od 05.10.`). A re-read never redraws an open one: it stays as opened while its offer stands, stays busy until its write settles, and otherwise closes with the card saying the record moved. Organizacija (story 7.18) is a page of facts in the same way: each change is its own small dialog with one `Spremi`, opened from `Promijeni` beside its fact or `Uredi` in its card's header, drawn afresh on each opening. A dialog that only reads — *Povijest rotacije*, opened from a header button (story 7.18) — has no footer, and widens to `max-w-3xl` for its table. Since story 7.14 it also carries the hours explanation, opened by a figure's ⓘ (a 44 px ghost icon button): a header with the figure's name and the person and month, one line per shift with its date and the hours it adds with a `+` in tabular figures — a shift in unresolved conflict marked with `⚠` and words, never colour alone — and a closing `=` line with the figure; the leave's (counted in days only since 2026-10-10) one line per charged date with each shift on it as `{smjena} · {tip smjene}` — a shift a conflict decision moved to leave naming the decision as its source word — and `+1 dan`, closing on `= 3 dana`; drawn once as it opens, never redrawn while open. **ConfirmDialog** is a confirmation on its own: a prompt and a right-aligned footer — cancel, then the confirm. |
| **Popover** | The one non-modal anchored surface (story 7.4), beside the modal Dialog: `role="dialog"` named by the screen, below its trigger and left-aligned to it, never wider than the viewport less 2rem. `rounded-lg`, a `glass-panel` since story 15.2 (a `popover` fill with `shadow-sh-lg` before), never inside a `glass-*` ancestor. Escape and a press outside close it and the screen returns focus to the trigger; focus leaving it (Tab out) closes it where focus went. Closed means unmounted. |
| **Callout** | An explanation box: `primary` at 5% over the page with a 20% `primary` border, an icon tile, a title and a sentence, and an optional action at the right. It explains, and is never a refusal or a confirmation (that is `Notice`). It also sets a scheduled change apart from the present-tense lines around it. |
| **IconTile** | A `rounded-md` square holding one decorative icon beside words that carry the meaning. `muted`, `primary`, and the timeline's two tones, `light` and `dark` (`band-dark` since story 15.2). |
| **StatTile** | A summary figure inside a card, where `StatCard` would nest a card in a card: a `muted` panel, an icon tile, a small label and a body-face value in tabular figures, never the heading slot. |
| **InputGroup** | A leading icon on an `Input` or a native `<select>`. The group adds the padding, so the select's documented class string stays literal. |
| **OutputField** | A computed, read-only value in a field's shape: the Input height and radius, dashed `input` border on `muted`, on a native `<output>`. It sits beside the field it is computed from (the hour band's end beside its start). |
| **Timeline** | A day as one bar: a scale of hours, stretches alternating `light` (the Badge's primary tint) and `dark` (`band-dark`, story 15.2: its own token at the navy the `sidebar` pair drew before, so the bands look as they did) so neighbours read apart, the uncovered stretch hatched, boundaries labelled beneath, and a legend. Each stretch carries its band's name; the screen hides the drawing from assistive technology beside a text equivalent. Tones follow position, never a band's name, and never the shift-slot ramp. |
| **Shell** | Glass since story 15.1 (direction G, D5). On the desktop a floating `glass-chrome` panel (`glass`, .58: it sits beside the content, never over it), inset 16 px, `rounded-3xl`, sticky, with a 2 px edge on its content side in the organization's accent (the glass hairline with none). Destinations are rounded rows at least 44 px tall in `foreground` text; the active one is a `glass-active` pill (white in light; a translucent white tint in dark, tuned in 15.5) with a soft lift AND semibold AND underlined, with `aria-current`, never colour or shape alone, since a hovered row takes a lighter pill of the same shape. Its focus ring is `--ring` drawn straight on the glass, measured against every glass backdrop. The group labels *Pregled* and *Postavke* and the profile's role line are `foreground`, never muted, because the glass is below .85; they go `sr-only` while the rail is collapsed. The shell's buttons are the ordinary `ghost` and `outline` variants, and the profile card is Button's glass `chrome` variant (story 15.2). On a phone the bar is a floating `glass-over-content` pill (.80, because content scrolls under it), 16 px in from the sides and 0.75 rem above the safe area, with the accent's 2 px edge on top: five equal cells (four tabs and *Više*), icon over label, 56 px tall, never scrolling, no lockup, text and icons `foreground`. The page reserves the pill, its edge, the float and the safe-area inset. *Više* opens a bottom sheet, the shared Dialog `docked` (a glass panel since story 15.2, `rounded-t-2xl`; its rows keep the opaque `accent` hover and current fill, where the white glass pill would vanish) with the person's avatar and name, small muted capital group labels (Pregled, Postavke, Prikaz), the same destination rows with a one-line `xs` description under each name and an outlined `Ovdje si` pill on the current one, the theme's three-segment pill, an *Obavijesti* row with a bell icon, drawn as the destination rows are, with its one-line description and `Ovdje si` while current (story 10.3), an outlined *Instaliraj* with a download icon where it applies (story 8.4; on iOS its steps open as a small muted line under it) and an outlined Odjava. While *Više* is current it carries a 10 px place name under its label (`Rotacija`). On desktop the theme pill sits in the profile menu (an opaque `popover`) above *Obavijesti*, *Instaliraj* and Odjava, not in the sidebar foot. Before 15.1 the shell was the navy `sidebar` in both themes with a `sidebar-primary` pill. |

**Domain components** — the ones shadcn has no equivalent for:

| Component | Spec |
|---|---|
| **shift-cell** | Base fill from the assigned `shift-slot-N`; label always visible; time range shown when width allows. 30 px minimum height. |
| **shift-cell modifiers** | Composable on any base: conflict = inset 2 px `destructive` + `⚠`; overridden = inset 2 px `modifier-overridden` + `✎`; leave = −45° hatch + `◷`; uncovered = 45° hatch + `◌`, both drawn in the cell's own foreground at 16 % (story 5.3c), so no leave token exists (`modifier-uncovered` remains for the hour band bar). A cell may carry more than one. Conflict and uncovered are drawn on an admin's calendar only. A member's calendar carries overridden, and leave on their own dates in *Moj raspored* (story 7.10). |
| **duty-block** | Card presenting consecutive working shifts with no interval between them as one duty: end time as the headline, span as metadata, a progress bar in `primary`, and one leg per constituent shift marked done / in progress / upcoming. As built (story 6.2; recorded 2026-10-13, deferred-work sweep): the total as the `muted-foreground` kicker, the headline `text-2xl` bold; the bar is 8 px, `rounded-full`, `primary` over `muted`, with the span's two ends and the progress in words (`14 h 10 min od 24 h`) under it in `text-xs` `muted-foreground`; each leg carries an icon beside its state word, and a `text-sm` `muted-foreground` note of whose shift it is — on a replacement the replaced member by name (`zamjena za {ime} ({smjena})`). |
| **Admin Danas cards** | Story 6.3, recorded 2026-10-13 (deferred-work sweep). Four cards in this order: *Treba tebe* (the count always shown; above zero a `destructive` left edge and ⚠, at zero neutral with a check), *Pokrivenost danas* (one row per working team, `{present} od {total} članova`, ⚠ beside an unresolved absence, `✓ puna smjena`), *Odsutni danas* (the leave glyph `◷` per line), and *Ovaj tjedan* (the calendar's own shift-cells, team rows × seven days, with a legend). |
| **resolution-option** | A conflict outcome. Card with a radio affordance, name, one-line effect, and a **consequence-strip**. No option is primary-styled and none is labelled recommended. Built on `RadioCard` (`components/ui/radio-group.tsx`, Radix radio group): unselected, a 1.5 px `input` border and an outlined dot; selected, a `primary` border plus a 2 px `primary` ring and a filled dot, and never a different fill (story 5.4b). |
| **consequence-strip** | Inside a resolution-option, across the card's whole width under a divider: states the outcome in three fixed terms, always the same three and always in this order — coverage, the absent member (labelled *Odsutni član*: on accepting or replacing, their leave day, "1 dan godišnjeg", never hours, since 2026-10-10; on amending, their hours as work), the leave balance. Three columns at every width, a phone's included; each term is a small `muted-foreground` label over its value. Uncovered coverage carries Phosphor's `CircleDashed` in `bold` (through `@/components/ui/icon` since story 15.1; small status marks are `bold`, never `fill`), as the calendar's uncovered mark does (story 5.4b). A replacement's coverage carries no mark: the count one higher and the name picked (story 5.4c). Amending the leave's carries none either: the count one higher and "{ime} radi", its hours as work, and the balance after over its gain, `+1 dan` (story 5.4d). |
| **month toolbar** | *Kalendar*'s and *Sati*'s one month control (story 7.4): ‹ and › as 44 px outline icon buttons around the month as an outline button, bold, with a chevron and, on the current month, "ovaj mjesec" as an `outline` Badge label inside it (under the name on a phone). It opens a Popover month picker: the year between ghost ‹ ›, and a four-column grid of 44 px month buttons by short name — the shown month `primary`-filled, today's month with an inset 1.5 px `input` ring and "ovaj" beneath, and a footer row: the key hint in `text-xs` `muted-foreground` and a link `Ovaj mjesec`. Below 640 px the picker is the filter bar's bottom sheet instead. Off the current month an outline `Ovaj mjesec` button follows. On a phone the toolbar alone is a sticky head, `glass-over-content` (story 15.1: the month scrolls under it) with a bottom `border`, with the active filters as one `text-xs` line under it once the filter bar has scrolled away. |
| **Filter chip row** | *Kalendar*'s and *Sati*'s one filter bar (story 7.5), under the month toolbar, `px-4 pb-4`. Two pill chips, Smjena and Osoba: a `rounded-full` 1.5 px `input` boundary on `card`, holding a 44 px ghost button `Ključ: vrijednost ▾`. An active chip takes a `primary` boundary and a `primary`/10 fill, semibold text and a 44 px ghost ✕, so it never differs by colour alone. Each opens its picker in the Popover (`w-72`): ghost option rows of at least 44 px, the chosen one pressed, `primary`/10 and semibold, a count muted and tabular on the right, small muted capital group headings. The Smjena picker opens on `Sve smjene (4)`, the Osoba picker on a labelled 44 px Input search, a muted "1 od 17" and `Sve osobe (17)`. Under the chips a muted `text-sm` tabular summary line, then a `link` button `Poništi filtre` while a filter is on. Below 640 px the inactive chips are not drawn, and an outline `Filtri · N` button leads the row. *Ljudi* (story 7.13) draws the same chips, picker and sheet as option chips — Razina, Smjena and Status, each one choice from a fixed list with a muted tabular person count beside every option — in the search's row inside the table card, with no padding of its own. From 1024 px the search fills the row and the chips end it; below, the search takes its own row. Every picker after the first opens under its chip's right edge. Status is set at its default, `Status: aktivni`, so it draws active. |
| **Filter sheet** | The phone's filters (story 7.5): the shared Dialog `docked` at the bottom, full width, `rounded-t-2xl`, a glass panel since story 15.2. Its parts are a title "Filtri" with the Dialog's close, a Smjena section of RadioRows (`Sve smjene (4)` and each team with its muted tabular count), and an Osoba section with the same search list as the picker, plus in *Kalendar* a muted note. A footer row splits evenly between an outline `Poništi` and a `primary` `Prikaži {n} osoba`. *Ljudi*'s sheet (story 7.13) holds one RadioRow group per chip, each under its heading (Razina, Smjena, Status), every option with its muted tabular count, and the same footer. |
| **Conflict tabs** | *Za odluku*'s two tabs (story 7.16; renamed in story 9.1), *Čeka odluku* and *Odlučeno*: a `role="tablist"` on a `muted` track, `rounded-md`, `p-1`, two equal 44 px tabs. The selected tab is `card` with a shadow AND underlined AND `aria-selected`, never colour alone; the other is `muted-foreground`. One tab stop, arrows, Home and End move and select. An *Odlučeno* entry is a bordered `card` row with the date in tabular numerals, the decision as a default `Badge`, then the member and team, the shift type and who decided it and when, in `muted-foreground`. It is read-only, so it is not a link, and it is not drawn in `destructive`, which a resolved conflict has left. Since story 9.5 a decided leave request is the same bordered `card` row with the same leading line: the request's first day in tabular numerals, its outcome as a default `Badge` (*Odobren* or *Odbijen*) and the kind *Zahtjev za godišnji odmor* in `muted-foreground`; then the member, the range and who decided it and when. A resolved conflict's leading line names its kind *Odsutnost u smjeni* after its badge the same way. On *Čeka odluku* every row names its kind in `muted-foreground` after its date. |
| **state-glyph** | The four modifier marks: `⚠` conflict, `✎` overridden, `◷` leave, `◌` uncovered. Fixed set, fixed meanings, always accompanied by a persistent legend on the calendar. |

## Do's and Don'ts

**Do**

- Assign a new Organization's Shift Types to ramp slots in order, and verify contrast in both themes before shipping the Organization.
- Pair every state colour with its glyph and fill treatment, in every surface, including compact ones.
- Keep `destructive` for unresolved conflicts and let ordinary destructive actions rely on confirmation instead of colour.
- Show a legend anywhere modifier glyphs appear.
- Use tabular numerals for anything a reader will compare or scan down a column.

**Don't**

- Don't add a `shift-day` or `shift-night` token, however convenient. It encodes one Organization into the design system and breaks the platform's core constraint.
- Don't restyle a primitive in a screen. Colour, radius, border, shadow and type belong to `components/ui`; a screen that needs a primitive to look different changes the primitive for everyone, or adds a new one.
- Don't load fonts from the Google CDN, and don't swap a face without re-running the Croatian glyph check against it.
- Don't copy the style reference's copy or flows: no English, no "ShiftApp", no social login, signup, demo buttons or "remember me". "Remember me" means a lasting session, and that stays out. Remembering the organization slug on this device after a successful sign-in is allowed (story 7.7). It is the slug only: no username, no password.
- Don't let an Organization's brand accent touch a shift state, a modifier, or `destructive`.
- Don't convey a state by colour alone anywhere — not in the compressed grid, not in a status pip, not in a badge.
- Don't introduce a motion token. Primitives use short colour/shadow transitions; the product adds no animation of its own.
- Don't primary-style one conflict resolution over another. A visual default is a decision taken away from the admin.
- Don't put glass on a reading surface, a cell or a row, and don't spell it in a screen: glass is the tokens and the two `index.css` utilities (story 15.1).
- Don't measure glass contrast against the page alone: measure it against the worst backdrop, the blobs and every fill that can pass under it.
- Don't animate the blobs or blur them with `filter`, and don't use glass as a state signal: selection, conflict and override keep their own cues.
- Don't put `muted-foreground` text on glass below .85.
