---
name: Shift
description: Industry-agnostic shift management platform. shadcn/ui primitives on React + Vite + Tailwind, restyled once in `components/ui` to the shiftapp-v2 register — slate surfaces, a navy sidebar, one blue primary, soft elevation, DM Sans and Syne. Croatian-first UI, light and dark driven by prefers-color-scheme.
status: final
updated: 2026-10-06
colors:
  # ── Brand delta ───────────────────────────────────────────────────
  # The surface tokens (background, card, muted, border, input, ring,
  # sidebar…) are NOT listed here; they live under `base-palette:` below.
  # This block is parsed by test/theme-fidelity.test.ts and must hold
  # exactly the 24 brand names.
  primary: '#2563EB'
  primary-foreground: '#FFFFFF'
  primary-dark: '#3B82F6'
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
  shift-slot-3-dark: '#2A2038'
  shift-slot-3-foreground-dark: '#CBB4E8'
  shift-slot-4: '#FDF0DC'
  shift-slot-4-foreground: '#6E4A12'
  shift-slot-4-dark: '#33280F'
  shift-slot-4-foreground-dark: '#E8C88A'
  shift-slot-5: '#E3F2EC'
  shift-slot-5-foreground: '#1D5644'
  shift-slot-5-dark: '#16302A'
  shift-slot-5-foreground-dark: '#93CFB8'
  shift-slot-6: '#F1EEE6'
  shift-slot-6-foreground: '#5A5344'
  shift-slot-6-dark: '#2A281F'
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
  modifier-leave: 'rgba(33,96,63,0.16)'
  modifier-leave-foreground: '#21603F'
  modifier-leave-dark: 'rgba(132,204,167,0.15)'
  modifier-leave-foreground-dark: '#84CCA7'
  modifier-uncovered: 'rgba(160,110,20,0.22)'
  modifier-uncovered-foreground: '#7A5410'
  modifier-uncovered-dark: 'rgba(230,170,60,0.16)'
  modifier-uncovered-foreground-dark: '#E0AE5C'
  modifier-overridden: '#7A6BC4'
  modifier-overridden-dark: '#9A8BE0'
base-palette:
  # ── Surfaces: the shadcn token names, filled with slate and navy ───
  # Every base token in apps/web/src/index.css traces to a hex here, and
  # test/theme-fidelity.test.ts round-trips each one against the stylesheet. The
  # sidebar is navy in BOTH themes, as two distinct navies. Values marked
  # (a11y) deviate from the plain slate step for a measured reason recorded
  # in index.css's header comment.
  light:
    background: '#F8FAFC'            # slate-50
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
    input: '#7B8AA0'                 # (a11y) a field's only affordance, 3:1
    ring: '#1A3275'                  # (a11y) 3:1 against the input border too
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
    background: '#0D1829'            # navy
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
    ring: '#B4D2FD'
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
elevation:
  # Soft, and only on cards and layered surfaces. Tailwind: shadow-sh, shadow-sh-lg.
  sh: '0 1px 3px rgba(0,0,0,0.07), 0 4px 16px rgba(0,0,0,0.05)'
  sh-lg: '0 8px 32px rgba(0,0,0,0.10)'
  sh-dark: '0 1px 3px rgba(0,0,0,0.30), 0 4px 16px rgba(0,0,0,0.22)'
  sh-lg-dark: '0 8px 32px rgba(0,0,0,0.45)'
typography:
  body:
    fontFamily: 'DM Sans Variable'   # @fontsource-variable/dm-sans, self-hosted
  heading:
    fontFamily: 'Syne Variable'      # @fontsource-variable/syne, self-hosted
    use: 'h1-h6, card titles; letters only, never digits'
  figures:
    fontFamily: 'Shift Figures'      # derived from DM Sans by scripts/fonts/build-figures.py, self-hosted
    unicodeRange: 'U+0030-0039'      # digits only; leads both --font-sans and --font-heading
    weights: [400, 500, 600, 700, 800]
  numeric:
    fontVariantNumeric: 'tabular-nums'
rounded:
  base: 12px                         # --radius: 0.75rem; cards use rounded-lg
  sm: 8px
  md: 10px
  lg: 12px
  xl: 16px
spacing:
  # Tailwind defaults; no overrides.
components:
  shift-cell:
    background: '{colors.shift-slot-N}'
    foreground: '{colors.shift-slot-N-foreground}'
    radius: '{rounded.sm}'
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
    fill: 'repeating-linear-gradient(-45deg, {colors.modifier-leave} 0 4px, transparent 4px 8px)'
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

Shift is an operational tool for people who currently keep the rota in a spreadsheet. The brand premise is **quiet competence**: the product's job is to be trusted with a schedule people plan their lives around, and nothing about it should feel like it is trying to be liked. Slate surfaces, a navy sidebar, one blue primary, and a single red held in reserve for the one thing that must never be missed.

*Style reference: [../shiftapp-v2/shiftapp_manager_v2.html](../shiftapp-v2/shiftapp_manager_v2.html) (shell, cards, buttons, inputs, tables) and [../shiftapp-v2/shiftapp_login_onboard.html](../shiftapp-v2/shiftapp_login_onboard.html) (sign-in). The reference is for LOOK only — its copy, its English, its product name, its Google login, signup and demo affordances are not Shift's.*

**The register is modern and calm, not decorative.** White cards with a soft shadow on a slate-50 page, a 12 px radius, a navy sidebar in both themes, DM Sans for reading and Syne for headings. Every surface the product draws inherits it through two layers and only two:

1. **Tokens** in `apps/web/src/index.css`, transcribed from this file's front matter.
2. **Primitives** in `apps/web/src/components/ui` — Button, Card, Input, Label, Table and whatever shadcn primitive is added next. They are shadcn's components, **restyled once there** to this register.

Screens compose primitives and never restyle them. A screen may size and place a primitive (`h-11`, `w-full`, grid placement) but may not override its colour, radius, border, shadow or type. If a screen needs a primitive to look different, the primitive changes — for every screen at once — or a new primitive is added.

Two properties are not stylistic preferences but consequences of the product contract, and may not be traded away:

1. **No colour is the sole carrier of meaning.** Every shift state pairs colour with a glyph, a fill treatment, or a border.
2. **Nothing in the visual language names a shift type.** Colour is assigned to ordered slots, never to "day" or "night".

## Colors

*Rendered reference: [mockups/color-themes-1.html](mockups/color-themes-1.html) — the four palettes considered, light and dark, with the state language applied to the pilot's content.*

**Register.** A slate base (`base-palette:`), a navy sidebar in both themes, one blue primary `#2563EB`, near-zero decorative colour. The dark theme is navy-based, not grey: a navy page, navy-2 cards, and a darker navy sidebar. Both themes ship, driven entirely by `prefers-color-scheme` — there is no in-app theme toggle, so every token below is defined in both and no state may rely on a single theme's contrast.

**The reserved hue.** `destructive` is overridden to `#D93A46` and is **reserved exclusively for an unresolved conflict**. It appears nowhere else — not on delete buttons, not on validation errors, not as an Organization's brand accent. This is a hard rule with a specific origin: the pilot is a fire department and the obvious brand accent is red. Had brand red and conflict red been the same red, the alarm colour would have become the furniture and conflicts would have stopped reading as conflicts. Destructive actions that are not conflicts use shadcn's neutral button styles plus a confirmation step.

**Organization branding.** An Organization's accent is data, not design. It tints exactly three things — the logo lockup, the sidebar's edge and the phone bar's edge — and nothing else. Because the lockup and the sidebar edge sit on the navy sidebar, a light-theme accent must clear 3:1 against both a white card and the navy, and 4.5:1 under its own white letter, which confines it to roughly OKLCH L 0.53–0.56; the accent values in `index.css` are tuned into that window and `test/theme-contrast.test.ts` measures them there. It may never be used for a shift state, a modifier, or `destructive`. An Organization whose accent is red gets a red shell and an unchanged red conflict signal — which is why the conflict signal also carries a glyph and a border.

**The working-shift ramp.** Working Shift Types are Organization data of arbitrary count, so colour is assigned to six ordered slots rather than to named shift types. An Organization's Shift Types take slots in creation order; the pilot's `Dan` takes slot 1 and `Noć` takes slot 2. In the light theme slot 1 reads light and cool, slot 2 dark and deep — a deliberate light/dark contrast that happens to suit a day/night organization without encoding one. Slots 3–6 are verified in both themes, `test/theme-contrast.test.ts` (story 2.2b pins that every slot the ramp can return has a measured light and dark pair). Beyond six Shift Types a slot repeats, and the always-visible label carries the distinction.

**The dark ramp has three lightness levels** (story 7.1). The non-working fill recedes below the card (`#0E1828`), *Noć*'s slot-2 rises to a light slate (`#2F3641`) and *Dan*'s slot-1 is a more saturated blue (`#00415D`, the lightest of the three), so a night shift never reads as a free day (1.46:1 and OKLab ΔE×100 12.3 between slot-2 and non-working, pinned in `test/theme-contrast.test.ts`). Slot-2 and non-working share a hue, so beyond lightness they are told apart by `shift-nonworking-border` — a 7 % white hairline in dark, transparent in light, drawn as a 1 px outline inside every non-working cell, chip and tile so it takes no layout space and survives the modifier rings — and by the always-visible label. *Dan* and *Noć* sit at similar lightness and differ by hue (about 24°) and by label.

**Modifier signals** — leave, uncovered, overridden, conflict — are system-defined and fixed forever. Leave and uncovered are hatch fills, overridden is an inset ring, conflict is an inset ring in the reserved hue. All four also carry a glyph.

## Typography

**Two faces and a figure set, all self-hosted**, never the Google CDN:

- **DM Sans** for body text, labels, controls, table cells and every stat value — `--font-sans`, through `@fontsource-variable`.
- **Syne** for the words of headings (`h1`–`h6`, card titles) — `--font-heading`, through `@fontsource-variable`. Applied once in `@layer base` and in the Card primitive; screens never spell a font family.
- **Shift Figures** for every digit (story 7.2). DM Sans ships no tabular figures — no `tnum`, and its `1` is 312 units wide where `0` is 684 — and Syne's heavy numerals were misread ("17" as "ı7"). Shift Figures is DM Sans's own digit glyphs, one static file per weight in use (400–800), each digit centred on one advance shared by every weight. `scripts/fonts/build-figures.py` derives it byte-deterministically from the Fontsource DM Sans file; the OFL notice ships beside it in `apps/web/src/assets/fonts/`. It leads **both** stacks with `unicode-range: U+0030-0039`, so **digits are never Syne**: "Listopad 2026" in an `h2` is Syne letters and DM Sans tabular digits. The range excludes the space, so line-box metrics stay DM Sans and Syne. Boundary cases: every weight shares one digit advance (the widest digit across 400–800), so a column that mixes weights still aligns; weights outside 400–800 have no figure file and are not used, which `test/typography-coverage.test.ts` enforces.

Two requirements, neither of them stylistic, and each applies to **both** faces:

- **Latin Extended-A coverage is mandatory.** Croatian needs **č ć ž š đ Č Ć Ž Đ Š**. A face that falls back mid-word breaks exactly the strings that matter most — `Noć`, `Godišnji`, `Slobodno`, `Izmijenjeno`, and members' own names. Both faces ship a latin-ext subset; `test/typography-coverage.test.ts` checks each import, and any substitution must pass the same check before it lands.
- **Tabular numerals wherever numbers align.** The hours table, every `07:00–19:00`, leave balances, and calendar date columns. Proportional digits make columns wobble and make two totals hard to compare. Shift Figures makes every digit tabular by construction; the `numeric` token (`tabular-nums`) stays on the slots that align, harmless today and correct if a face with real `tnum` replaces it. A numeric slot never takes `font-heading`.

## Layout & Spacing

Tailwind's spacing scale, no overrides. Controls a person presses keep the 44 px floor (`h-11`) at every width. Two domain rules:

- **The calendar grid is the density budget.** At 390 px a day row carries a date column plus one column per team. Cells hold a 30 px minimum height, a label, and where space allows a time range. Anything that does not fit is not abbreviated — it moves to the day-detail view.
- **Wide content scrolls inside its own container, never the page.** The calendar, week and rotation-preview grids own their horizontal overflow at every width, and so does a table from 640 px. The page body never scrolls sideways at any width.
- **Below 640 px a table becomes stacked rows** (story 7.6, mockup `ux-shift-2026-10-01-redesign/mockups/mobile-tables-1.html`). The Sati, Ljudi and shift-types tables render the same view model as a list of `StackedRow`s, so neither the page nor any element in it scrolls sideways; a `usePhone()` switch puts exactly one form in the DOM, never both with one hidden, and never a table restyled with `display` overrides. Sort and filter state live outside the table, so crossing 640 px keeps them. On a phone the sort is one `Poredano: {column} ↑|↓` control above the list. The hour-band, team, rotation-offset and rotation-history tables still scroll in their own box until they stack too (`deferred-work.md`).

**The page skeleton** (visual refresh B). Every screen follows the same pattern, including placeholders and not-found:

- The page is `mx-auto w-full max-w-5xl` with `p-6`, and the `PageHeader` comes first. The title sits top-left and the actions sit at the right, stacking under the title on a phone. Nothing is centred in the viewport.
- Content follows: a table inside a `Card`, a `StatCard` row (2 columns on a phone, 4 from `lg`), or a form in a left-aligned `Card` with `max-w-lg`.
- A refusal and a confirmation are one `Notice` primitive in the Input look: a 1.5 px `input` border on the card colour. `role="alert"` draws a warning icon and `role="status"` a check, so the two differ by shape as well as by words. On a form screen or a card the notice sits in the card. Native `<select>`s use the Input look too, and `components/README.md` spells that class string.
- People's names are shown with an `Avatar` (never a team's), and a permission level or an inactive marker is shown as a `Badge`. A name cell wraps rather than widening its column.

## Elevation & Depth

**Soft, and sparing.** Two shadow tokens, `sh` and `sh-lg` (`elevation:`), expressed as OKLCH alpha in the stylesheet. Cards carry a 1 px `border` plus `sh`; `sh-lg` is for genuinely layered surfaces — Dialog, Sheet, Popover. The primary button lifts a primary-tinted shadow on hover. Nothing else floats: a rota is still a document, and the shadow says "this is a card", never "look at me".

## Shapes

A 12 px base radius (`--radius: 0.75rem`): cards `lg` (12 px), buttons and inputs `md` (10 px), small chips `sm` (8 px). Shift cells use the small radius so a dense grid reads as a grid rather than as a field of pills.

## Components

*Rendered reference: [mockups/conflict-resolution-1.html](mockups/conflict-resolution-1.html) — resolution-option and consequence-strip in place.*

**Primitives** — shadcn components, restyled once in `components/ui` and never in a screen:

| Primitive | Spec |
|---|---|
| **Button** | `rounded-md`, semibold. Default is `primary` with a soft primary-tinted shadow on hover; outline is a 1.5 px `input` border on the card colour. Heights are the primitive's; screens set `h-11`. |
| **Card** | `rounded-lg`, 1 px `border`, `shadow-sh`, `card` fill. A header carries a bottom divider; the title is Syne, and `CardTitle asChild` makes it the page's `<h1>` without restyling. |
| **Input** | `rounded-md`, 1.5 px `border-input` on the card colour, and a 2 px `ring` focus ring. |
| **Table** | Header cells uppercase, small, `muted-foreground` on `muted`; rows divide with `border` and tint to `muted` on hover. A table scrolls inside its own container. Below 640 px the Sati, Ljudi and shift-types tables are not rendered: those screens render stacked rows (`StackedList`) instead. |
| **StackedList / StackedRow / StackedFields / StackedField** | A table's phone form (story 7.6): a `ul` named by the table's caption, an `li` per row dividing with `border` and tinting to `muted` on hover, and a `dl` whose `StackedField` pairs every value (`dd`, tabular figures) with its column's own label (`dt`). The label is small `muted-foreground` text above the value where the mockup shows it, and `sr-only` where the row's position carries it, so every value keeps its label for assistive technology. `separated` draws a field on one line after the previous one behind a middle dot. `StackedSkeletonRow` is a loading row in the row's shape. No `overflow-*`: nothing in it scrolls sideways. On Ljudi's row the decorative `Avatar` is hidden below 360 px, so a level's badge fits beside the team. |
| **PageHeader / PageTitle** | The page skeleton's head (visual refresh B). The title is top-left, Syne `text-2xl` extrabold, and the actions sit at the right, stacking under the title on a phone. `PageTitle asChild` styles the screen's own `<h1>`, and the primitive carries no copy. |
| **StatCard** | A `Card` with a small uppercase `muted-foreground` label and a large DM Sans value whose digits are tabular Shift Figures, never Syne. It counts only data the screen already holds, as one snapshot. |
| **Badge** | A `rounded-full` pill in `text-xs` semibold. `default` is a 15% `primary` tint with `foreground` text, because dark `primary` text on the dark card measures below 4.5:1 at any tint. Badges are measured on the card and on a hovered row. `secondary` is the `secondary` fill, and `outline` is an `input` border with `muted-foreground` text. Its text carries the meaning, and there are no status colours. |
| **Avatar** | A round `secondary` chip for a person, holding initials: the first letter (with its combining marks, after NFC) of the first and last word that has one, so brackets, digits and emoji are skipped. A name with no letter draws an empty chip, so names stay aligned. It is decorative and hidden from assistive technology, because the name is always rendered beside it. |
| **RadioGroup / RadioCard / RadioRow** | Radix's radio group, restyled once (story 5.4b): one tab stop, the arrow keys move and Space selects. `RadioCard` is a whole card as the radio, the words beside the dot and an optional full-width footer under them; its states are the resolution-option's. `RadioRow` (story 5.4c) is one line of a pick list, the replacement candidates: the dot and words that wrap, at least 44 px tall, a transparent border that turns `input` on hover and `primary` when chosen, never a fill. |
| **Notice** | The one refusal and confirmation box: `rounded-md`, 1.5 px `input` border, `card` fill, `text-sm` medium, and a small lucide icon chosen by its `role` (`alert` a warning, `status` a check). The icon is hidden from assistive technology; the role announces the message. |
| **PageDescription** | The one-sentence lede under a `PageTitle` (design refresh C): `text-sm` `muted-foreground`, never a second heading. |
| **Dialog** | The one modal (design refresh C), on the native `<dialog>` and `showModal()`: focus trap, Escape, the inert page and focus return come from the browser. `rounded-lg`, `border`, `shadow-sh-lg`, a `sidebar`-tinted backdrop. A header carries the Syne title and a 44 px close button named by the screen. Closed means hidden, not unmounted, so uncontrolled fields keep a refused value. Not dismissible while a write it started is in flight. A change opened from a dialog of facts (story 7.9, day detail) is its own small dialog over it, with one Save and a computed *Što se mijenja* (an `<output>`, announced politely); its form is drawn only while it is open, and a refusal keeps what was entered while it is. **ConfirmDialog** is a confirmation on its own: a prompt and a right-aligned footer — cancel, then the confirm. |
| **Popover** | The one non-modal anchored surface (story 7.4), beside the modal Dialog: `role="dialog"` named by the screen, below its trigger and left-aligned to it, never wider than the viewport less 2rem. `rounded-lg`, `border`, `popover` fill, `shadow-sh-lg`. Escape and a press outside close it and the screen returns focus to the trigger; focus leaving it (Tab out) closes it where focus went. Closed means unmounted. |
| **Callout** | An explanation box: `primary` at 5% over the page with a 20% `primary` border, an icon tile, a title and a sentence, and an optional action at the right. It explains, and is never a refusal or a confirmation (that is `Notice`). It also sets a scheduled change apart from the present-tense lines around it. |
| **IconTile** | A `rounded-md` square holding one decorative icon beside words that carry the meaning. `muted`, `primary`, and the timeline's two tones, `light` and `dark`. |
| **StatTile** | A summary figure inside a card, where `StatCard` would nest a card in a card: a `muted` panel, an icon tile, a small label and a DM Sans value in tabular Shift Figures, never Syne. |
| **InputGroup** | A leading icon on an `Input` or a native `<select>`. The group adds the padding, so the select's documented class string stays literal. |
| **OutputField** | A computed, read-only value in a field's shape: the Input height and radius, dashed `input` border on `muted`, on a native `<output>`. It sits beside the field it is computed from (the hour band's end beside its start). |
| **Timeline** | A day as one bar: a scale of hours, stretches alternating `light` (the Badge's primary tint) and `dark` (the navy sidebar pair) so neighbours read apart, the uncovered stretch hatched, boundaries labelled beneath, and a legend. Each stretch carries its band's name; the screen hides the drawing from assistive technology beside a text equivalent. Tones follow position, never a band's name, and never the shift-slot ramp. |
| **Shell** | Navy `sidebar` with a `border` edge (or the organization's accent). Destinations are rounded rows; the active one is a `sidebar-primary` pill AND semibold AND underlined, never colour or shape alone, since a hovered row takes the same fill. Its focus ring is offset by the sidebar colour. The shell's buttons use Button's `sidebar` variant, whose 1.5 px boundary is `sidebar-foreground` at 50% (≥ 3:1 on navy); `sidebar-border` is a divider only. The phone bar is the same navy with the same treatment: five equal cells (four tabs and *Više*), icon over label, 56 px tall, never scrolling, no lockup. *Više* opens a navy bottom sheet (the shared Dialog, docked, `rounded-t-2xl`) with the person's avatar and name, small muted capital group labels (Pregled, Postavke, Prikaz), the same destination rows, the theme's three-segment pill and an outlined Odjava. On desktop the theme pill sits in the profile menu above Odjava, not in the sidebar foot. |

**Domain components** — the ones shadcn has no equivalent for:

| Component | Spec |
|---|---|
| **shift-cell** | Base fill from the assigned `shift-slot-N`; label always visible; time range shown when width allows. 30 px minimum height. |
| **shift-cell modifiers** | Composable on any base: conflict = inset 2 px `destructive` + `⚠`; overridden = inset 2 px `modifier-overridden` + `✎`; leave = `modifier-leave` hatch + `◷`; uncovered = `modifier-uncovered` hatch + `◌`. A cell may carry more than one. Conflict and uncovered are drawn on an admin's calendar only. A member's calendar carries overridden, and leave on their own dates in *Moj raspored* (story 7.10). |
| **duty-block** | Card presenting consecutive working shifts with no interval between them as one duty: end time as the headline, span as metadata, a progress bar in `primary`, and one leg per constituent shift marked done / in progress. |
| **resolution-option** | A conflict outcome. Card with a radio affordance, name, one-line effect, and a **consequence-strip**. No option is primary-styled and none is labelled recommended. Built on `RadioCard` (`components/ui/radio-group.tsx`, Radix radio group): unselected, a 1.5 px `input` border and an outlined dot; selected, a `primary` border plus a 2 px `primary` ring and a filled dot, and never a different fill (story 5.4b). |
| **consequence-strip** | Inside a resolution-option, across the card's whole width under a divider: states the outcome in three fixed terms, always the same three and always in this order — coverage, the absent member's hours, the leave balance. Three columns at every width, a phone's included; each term is a small `muted-foreground` label over its value. Uncovered coverage carries lucide `CircleDashed`, as the calendar's uncovered mark does (story 5.4b). A replacement's coverage carries no mark: the count one higher and the name picked (story 5.4c). Amending the leave's carries none either: the count one higher and "{ime} radi", its hours as work, and the balance after over its gain, `+1 dan` (story 5.4d). |
| **month toolbar** | *Kalendar*'s and *Sati*'s one month control (story 7.4): ‹ and › as 44 px outline icon buttons around the month as an outline button, bold, with a chevron and, on the current month, "ovaj mjesec" as an `outline` Badge label inside it (under the name on a phone). It opens a Popover month picker: the year between ghost ‹ ›, and a four-column grid of 44 px month buttons by short name — the shown month `primary`-filled, today's month with an inset 1.5 px `input` ring and "ovaj" beneath. Off the current month an outline `Ovaj mjesec` button follows. |
| **Filter chip row** | *Kalendar*'s and *Sati*'s one filter bar (story 7.5), under the month toolbar, `px-4 pb-4`. Two pill chips, Smjena and Osoba: a `rounded-full` 1.5 px `input` boundary on `card`, holding a 44 px ghost button `Ključ: vrijednost ▾`. An active chip takes a `primary` boundary and a `primary`/10 fill, semibold text and a 44 px ghost ✕, so it never differs by colour alone. Each opens its picker in the Popover (`w-72`): ghost option rows of at least 44 px, the chosen one pressed, `primary`/10 and semibold, a count muted and tabular on the right, small muted capital group headings. The Smjena picker opens on `Sve smjene (4)`, the Osoba picker on a labelled 44 px Input search, a muted "1 od 17" and `Sve osobe (17)`. Under the chips a muted `text-sm` tabular summary line, then a `link` button `Poništi filtre` while a filter is on. Below 640 px the inactive chips are not drawn, and an outline `Filtri · N` button leads the row. |
| **Filter sheet** | The phone's filters (story 7.5): the shared Dialog docked at the bottom, full width, `rounded-t-2xl`, on `card`. Its parts are a title "Filtri" with the Dialog's close, a Smjena section of RadioRows (`Sve smjene (4)` and each team with its muted tabular count), and an Osoba section with the same search list as the picker, plus in *Kalendar* a muted note. A footer row splits evenly between an outline `Poništi` and a `primary` `Prikaži {n} osoba`. |
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
