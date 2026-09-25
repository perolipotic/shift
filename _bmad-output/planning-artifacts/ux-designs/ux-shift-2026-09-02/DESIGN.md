---
name: Shift
description: Industry-agnostic shift management platform. shadcn/ui primitives on React + Vite + Tailwind, restyled once in `components/ui` to the shiftapp-v2 register — slate surfaces, a navy sidebar, one blue primary, soft elevation, DM Sans and Syne. Croatian-first UI, light and dark driven by prefers-color-scheme.
status: final
updated: 2026-09-25
colors:
  # ── Brand delta ───────────────────────────────────────────────────
  # The surface tokens (background, card, muted, border, input, ring,
  # sidebar…) are NOT listed here; they live under `base-palette:` below.
  # This block is parsed by test/theme-fidelity.test.ts and must hold
  # exactly the 23 brand names.
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
  shift-slot-1-dark: '#173248'
  shift-slot-1-foreground-dark: '#A8D3F2'
  shift-slot-2: '#1B2735'
  shift-slot-2-foreground: '#CBD8E6'
  shift-slot-2-dark: '#171F29'
  shift-slot-2-foreground-dark: '#9FB3C6'
  shift-slot-3: '#EFE7F7'          # [ASSUMPTION] slots 3-6 unexercised by the pilot
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
  shift-nonworking-dark: '#161D24'
  shift-nonworking-foreground-dark: '#6B7885'

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
    use: 'h1-h6, card titles, large numerals'
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

**The working-shift ramp.** Working Shift Types are Organization data of arbitrary count, so colour is assigned to six ordered slots rather than to named shift types. An Organization's Shift Types take slots in creation order; the pilot's `Dan` takes slot 1 and `Noć` takes slot 2. Slot 1 reads light and cool, slot 2 dark and deep — a deliberate light/dark contrast that happens to suit a day/night organization without encoding one. Slots 3–6 are `[ASSUMPTION]`: unexercised by the pilot, and each must be contrast-verified in both themes before a second Organization uses them. Beyond six Shift Types a slot repeats, and the always-visible label carries the distinction.

**Modifier signals** — leave, uncovered, overridden, conflict — are system-defined and fixed forever. Leave and uncovered are hatch fills, overridden is an inset ring, conflict is an inset ring in the reserved hue. All four also carry a glyph.

## Typography

**Two faces, both self-hosted** through `@fontsource-variable`, never the Google CDN:

- **DM Sans** for body text, labels, controls and table cells — `--font-sans`.
- **Syne** for headings (`h1`–`h6`, card titles) and, when they arrive, large display numerals — `--font-heading`. Applied once in `@layer base` and in the Card primitive; screens never spell a font family.

Two requirements, neither of them stylistic, and each applies to **both** faces:

- **Latin Extended-A coverage is mandatory.** Croatian needs **č ć ž š đ Č Ć Ž Đ Š**. A face that falls back mid-word breaks exactly the strings that matter most — `Noć`, `Godišnji`, `Slobodno`, `Izmijenjeno`, and members' own names. Both faces ship a latin-ext subset; `test/typography-coverage.test.ts` checks each import, and any substitution must pass the same check before it lands.
- **Tabular numerals wherever numbers align.** The hours table, every `07:00–19:00`, leave balances, and calendar date columns. Proportional digits make columns wobble and make two totals hard to compare. Applied via the `numeric` token.

## Layout & Spacing

Tailwind's spacing scale, no overrides. Controls a person presses keep the 44 px floor (`h-11`) at every width. Two domain rules:

- **The calendar grid is the density budget.** At 390 px a day row carries a date column plus one column per team. Cells hold a 30 px minimum height, a label, and where space allows a time range. Anything that does not fit is not abbreviated — it moves to the day-detail view.
- **Wide content scrolls inside its own container, never the page.** The calendar grid, member list, and hours table each own their horizontal overflow. The page body never scrolls sideways at any width.

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
| **Table** | Header cells uppercase, small, `muted-foreground` on `muted`; rows divide with `border` and tint to `muted` on hover. Scrolls in its own container. |
| **Shell** | Navy `sidebar` with a `border` edge (or the organization's accent). Destinations are rounded rows; the active one is a `sidebar-primary` pill AND semibold AND underlined, never colour or shape alone, since a hovered row takes the same fill. Its focus ring is offset by the sidebar colour. The shell's buttons use Button's `sidebar` variant, whose 1.5 px boundary is `sidebar-foreground` at 50% (≥ 3:1 on navy); `sidebar-border` is a divider only. The phone bar is the same navy with the same treatment. |

**Domain components** — the ones shadcn has no equivalent for:

| Component | Spec |
|---|---|
| **shift-cell** | Base fill from the assigned `shift-slot-N`; label always visible; time range shown when width allows. 30 px minimum height. |
| **shift-cell modifiers** | Composable on any base: conflict = inset 2 px `destructive` + `⚠`; overridden = inset 2 px `modifier-overridden` + `✎`; leave = `modifier-leave` hatch + `◷`; uncovered = `modifier-uncovered` hatch + `◌`. A cell may carry more than one. |
| **duty-block** | Card presenting consecutive working shifts with no interval between them as one duty: end time as the headline, span as metadata, a progress bar in `primary`, and one leg per constituent shift marked done / in progress. |
| **resolution-option** | A conflict outcome. Card with a radio affordance, name, one-line effect, and a **consequence-strip**. No option is primary-styled and none is labelled recommended. |
| **consequence-strip** | Inside a resolution-option: states the outcome in three fixed terms, always the same three and always in this order — coverage, the absent member's hours, the leave balance. |
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
- Don't copy the style reference's copy or flows: no English, no "ShiftApp", no social login, signup, demo buttons or "remember me".
- Don't let an Organization's brand accent touch a shift state, a modifier, or `destructive`.
- Don't convey a state by colour alone anywhere — not in the compressed grid, not in a status pip, not in a badge.
- Don't introduce a motion token. Primitives use short colour/shadow transitions; the product adds no animation of its own.
- Don't primary-style one conflict resolution over another. A visual default is a decision taken away from the admin.
