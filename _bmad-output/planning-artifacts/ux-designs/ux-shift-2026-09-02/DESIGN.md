---
name: Shift
description: Industry-agnostic shift management platform. shadcn/ui on React + Vite + Tailwind; this DESIGN.md specifies the brand-layer delta only. Croatian-first UI, light and dark driven by prefers-color-scheme.
status: final
updated: 2026-09-02
colors:
  # ── Brand delta on shadcn defaults ────────────────────────────────
  # Unlisted tokens inherit from shadcn: background, foreground, card,
  # card-foreground, popover, popover-foreground, muted, muted-foreground,
  # secondary, border, input, ring.
  primary: '#1F6FB2'
  primary-foreground: '#FFFFFF'
  primary-dark: '#4FA3E3'
  primary-foreground-dark: '#04121D'
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
typography:
  # ZERO DELTA. Geist (shadcn default) covers Latin Extended-A, which
  # Croatian requires. All roles inherit. The single non-default rule:
  numeric:
    fontVariantNumeric: 'tabular-nums'
rounded:
  # shadcn defaults inherited; no overrides.
spacing:
  # Tailwind / shadcn defaults inherited; no overrides.
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

Shift is an operational tool for people who currently keep the rota in a spreadsheet. The brand premise is **quiet competence**: the product's job is to be trusted with a schedule people plan their lives around, and nothing about it should feel like it is trying to be liked. Steel neutrals, one blue accent, and a single red held in reserve for the one thing that must never be missed.

Shift inherits shadcn/ui wholesale. This DESIGN.md specifies only the brand-layer delta: primary and destructive colours, a working-shift colour ramp and modifier signals that shadcn has no concept of, and a handful of domain components. The components that ship from shadcn — Button, Card, Dialog, Sheet, Select, Command, Popover, Toast, Table — inherit their visual specs as-is. Restyling them is against the brand discipline; shadcn's defaults are the contract.

Two properties are not stylistic preferences but consequences of the product contract, and may not be traded away:

1. **No colour is the sole carrier of meaning.** Every shift state pairs colour with a glyph, a fill treatment, or a border.
2. **Nothing in the visual language names a shift type.** Colour is assigned to ordered slots, never to "day" or "night".

## Colors

*Rendered reference: [mockups/color-themes-1.html](mockups/color-themes-1.html) — the four palettes considered, light and dark, with the state language applied to the pilot's content.*

**Register.** Steel neutrals from shadcn, one blue primary, near-zero decorative colour. Both themes ship, driven entirely by `prefers-color-scheme` — there is no in-app theme toggle, so every token below is defined in both and no state may rely on a single theme's contrast.

**The reserved hue.** `destructive` is overridden to `#D93A46` and is **reserved exclusively for an unresolved conflict**. It appears nowhere else — not on delete buttons, not on validation errors, not as an Organization's brand accent. This is a hard rule with a specific origin: the pilot is a fire department and the obvious brand accent is red. Had brand red and conflict red been the same red, the alarm colour would have become the furniture and conflicts would have stopped reading as conflicts. Destructive actions that are not conflicts use shadcn's neutral button styles plus a confirmation step.

**Organization branding.** An Organization's accent is data, not design. It may tint the application shell, the logo lockup, and nothing else. It may never be used for a shift state, a modifier, or `destructive`. An Organization whose accent is red gets a red shell and an unchanged red conflict signal — which is why the conflict signal also carries a glyph and a border.

**The working-shift ramp.** Working Shift Types are Organization data of arbitrary count, so colour is assigned to six ordered slots rather than to named shift types. An Organization's Shift Types take slots in creation order; the pilot's `Dan` takes slot 1 and `Noć` takes slot 2. Slot 1 reads light and cool, slot 2 dark and deep — a deliberate light/dark contrast that happens to suit a day/night organization without encoding one. Slots 3–6 are `[ASSUMPTION]`: unexercised by the pilot, and each must be contrast-verified in both themes before a second Organization uses them. Beyond six Shift Types a slot repeats, and the always-visible label carries the distinction.

**Modifier signals** — leave, uncovered, overridden, conflict — are system-defined and fixed forever. Leave and uncovered are hatch fills, overridden is an inset ring, conflict is an inset ring in the reserved hue. All four also carry a glyph.

## Typography

**Zero delta.** Geist, shadcn's default, at every role. Two requirements, neither of them stylistic:

- **Latin Extended-A coverage is mandatory.** Croatian needs **č ć ž š đ Č Ć Ž Đ Š**. A face that falls back mid-word breaks exactly the strings that matter most — `Noć`, `Godišnji`, `Slobodno`, `Izmijenjeno`, and members' own names. Geist covers it; any substitution must be checked against that set before it lands.
- **Tabular numerals wherever numbers align.** The hours table, every `07:00–19:00`, leave balances, and calendar date columns. Proportional digits make columns wobble and make two totals hard to compare. Applied via the `numeric` token.

## Layout & Spacing

Tailwind and shadcn defaults, inherited without override. Two domain rules:

- **The calendar grid is the density budget.** At 390 px a day row carries a date column plus one column per team. Cells hold a 30 px minimum height, a label, and where space allows a time range. Anything that does not fit is not abbreviated — it moves to the day-detail view.
- **Wide content scrolls inside its own container, never the page.** The calendar grid, member list, and hours table each own their horizontal overflow. The page body never scrolls sideways at any width.

## Elevation & Depth

Flat. shadcn's default card border and background separation carry all hierarchy; no custom shadow tokens. Elevation is reserved for genuinely layered surfaces — Dialog and Sheet — where shadcn's own treatment applies unmodified. A rota is a document, and documents do not float.

## Shapes

shadcn radii, inherited. Shift cells use the small radius so a dense grid reads as a grid rather than as a field of pills.

## Components

*Rendered reference: [mockups/conflict-resolution-1.html](mockups/conflict-resolution-1.html) — resolution-option and consequence-strip in place.*

Domain components shadcn has no equivalent for. Everything else is shadcn as-shipped.

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
- Don't restyle a shadcn component. If a shadcn component is wrong for the job, the job is wrong.
- Don't let an Organization's brand accent touch a shift state, a modifier, or `destructive`.
- Don't convey a state by colour alone anywhere — not in the compressed grid, not in a status pip, not in a badge.
- Don't introduce a motion token. Component transitions ship from shadcn; the product adds none.
- Don't primary-style one conflict resolution over another. A visual default is a decision taken away from the admin.
