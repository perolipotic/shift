# `components/`

shadcn/ui primitives under `ui/`, **restyled once there** to DESIGN.md's
register and never in a screen, plus the domain components named in DESIGN.md.
A screen may size and place a primitive (`h-11`, `w-full`, grid placement) but
never overrides its colour, radius, border, shadow or type. If a screen needs a
primitive to look different, the primitive changes for every screen, or a new
primitive is added here.

`layout/auth-layout.tsx` is the shared frame of the sign-in screens. shadcn's
`cn` merger lives in `lib/utils.ts`, and `components.json` points the `utils`,
`lib` and `hooks` aliases at `@/lib/utils`, `@/lib` and `@/hooks`, shadcn's own
defaults. `utils/initials.ts` is the one pure rule for initials: the avatar
chips and the organization lockup's neutral mark both draw from it.

`sortable-head.tsx` is the one sortable table heading — *Sati*'s
organization table and *Godišnji*'s leave overview — a ghost `Button` in a
`TableHead` with `aria-sort` on the cell. The label, the `aria-sort` state and
the arrow's direction are passed in, all from the screen's own sort module.
Its arrow comes from `sort-glyphs.ts`, the one direction → icon record that
*Ljudi*'s headings and `sort-control.tsx` draw from too.

No component contains a user-facing literal. A `ui/` primitive never calls
`t()`: every string it shows comes from `lib/i18n/`, passed in by the screen.
A shared chrome component whose words are the same on every screen that uses
it owns those strings and may call `t()` with its own keys: `filter-bar.tsx`
and `option-filter-bar.tsx` (`filter.*`), `sort-control.tsx` (`sort.*`),
`month-nav.tsx`, `layout/auth-layout.tsx` and `update-notice.tsx` (`update.*`,
story 8.1: the root shell's *Osvježi* notice for a waiting service worker),
and `offline-note.tsx` (`offline.asOf`, story 8.2: the as-of note *Danas* and
*Kalendar* show over a snapshot drawn offline). What differs per screen — a
column's label, an option's name, a count's noun — is still passed in
(2026-10-13, deferred-work sweep; epics 5–7 retro A4).

## The page skeleton

Every screen (destination, form, placeholder or not-found) is built the same way:

```tsx
<main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
  <PageHeader>
    <PageTitle asChild>
      <h1>{t('nav.x')}</h1>
    </PageTitle>
    <PageActions>{/* the screen's buttons and links, h-11 */}</PageActions>
  </PageHeader>
  {/* content: a table in a Card, a StatCard row, or a form Card max-w-lg */}
</main>
```

- The title sits top-left and the actions sit at the right. On a phone they
  stack under the title.
- A form sits in a left-aligned `Card` with `max-w-lg` under the header.
- A refusal and a confirmation are a `Notice` with `role="alert"` or
  `role="status"`. Inside a form screen or a card, the notice sits in the card.
- Every `<form>` is `noValidate` (B298): `required`, `min`, `max` and
  `type="email"` stay for their semantics, but the app's own preflight
  refuses, in Croatian from `hr.json`, never a browser bubble in the OS's
  language. No reason field carries `maxLength`: its preflight counts code
  points as the database does (a name keeps `NAME_MAX_LENGTH`). `pages/structural-pins-controls.test.ts` sweeps both.
- A select is the `Select` primitive (`ui/select.tsx`), a native `<select>`
  in the Input look with a chevron in place of the browser's arrow. A screen
  composes only `className="h-11"` for the 44 px floor, as on `Input`, and
  `pages/structural-pins-controls.test.ts` refuses a bare `<select>` on a screen. Select class string:
  `flex h-9 w-full appearance-none rounded-md border-[1.5px] border-input bg-card py-1 pl-3 pr-9 text-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50`.

## Layout primitives (visual refresh B)

| Primitive | Use |
|---|---|
| `PageHeader`, `PageTitle`, `PageActions` (`ui/page-header.tsx`) | The skeleton's head. `PageTitle asChild` styles the screen's own `<h1>`. |
| `StatCard`, `StatLabel`, `StatValue` (`ui/stat-card.tsx`) | A summary figure: a `t()` label and a `formatNumber` value, counted by a pure module from data the screen already has. |
| `Badge` (`ui/badge.tsx`) | A pill: `default` (primary tint), `secondary`, `outline`. Its text carries the meaning, and there are no status colours. |
| `Avatar` (`ui/avatar.tsx`) | A round initials chip for a PERSON, hidden from assistive technology because the name is always rendered beside it. With no initials it is an empty chip, so names stay aligned. |
| `PageDescription` (`ui/page-header.tsx`) | The one-sentence lede under the title. Wrap `PageTitle` and it in one `<div>` so they stay on the left. |
| `Callout` (`ui/callout.tsx`) | An explanation box with an icon tile, a title, a sentence and an optional action. It explains; it never refuses or confirms (that is `Notice`). |
| `IconTile` (`ui/icon-tile.tsx`) | A decorative rounded square holding one icon, beside words that carry the meaning. `light`/`dark` match the timeline's tones. |
| `EmptyMark` (`ui/empty-mark.tsx`) | The one empty mark (C587): a figure or a name that is not there, as a glyph hidden from assistive technology and a visually hidden word, so a screen reader says `nema` or `bez smjene` rather than "dash". The screen passes both from `t()`. |
| `StatTile` (`ui/stat-tile.tsx`) | A summary figure INSIDE a card, where `StatCard` would nest a card in a card. |
| `InputGroup`, `InputGroupIcon`, `InputGroupAction` (`ui/input-group.tsx`) | A leading icon on an `Input` or a `Select`; the group adds the padding, so neither primitive changes. `InputGroupAction` holds a trailing 44 px button inside the field, such as the password's show/hide toggle; the screen names it and pads the input on the right. Never on `type="time"` or `type="date"`: the browser already draws its own clock or calendar button there, and a second icon reads as a duplicate. |
| `Select` (`ui/select.tsx`) | The one select: native underneath, so `defaultValue`, `ref`, `FormData`, key-remounts and a phone's picker all keep working. The screen composes `h-11`. |
| `OutputField` (`ui/output-field.tsx`) | A computed, read-only value shaped like a field (dashed, muted), on a native `<output>`. |
| `Timeline` and parts (`ui/timeline.tsx`) | A day as one bar: `TimelineScale`, `TimelineTrack` of `TimelineSegment`s and `TimelineGap`s, `TimelineBoundaries`, `TimelineLegend`. The screen hides it from assistive technology beside a text equivalent. |
| `Dialog` and parts (`ui/dialog.tsx`) | The one modal, on the native `<dialog>` and `showModal()`: focus trap, Escape, backdrop click and focus return come from the browser. Closed means hidden, not unmounted, so uncontrolled fields keep their values. A confirmation replaces the form inside the same dialog. `ConfirmDialog` is a confirmation on its own: open while the screen renders it, so an "armed" state becomes a modal without changing, and not dismissible while `busy`. |
| `SectionNumber` (`ui/section-number.tsx`) | A numbered section's badge beside its `CardTitle` (`/postavke-rotacije`, sections 1–4). Takes `value`, renders the figure in the primary tint, and is hidden from assistive technology: the heading beside it carries the meaning. |
| `RadioGroup`, `RadioCard`, `RadioRow` (`ui/radio-group.tsx`) | Radix's radio group (story 5.4b): one tab stop, arrows move, Space selects. `RadioCard` is a whole card as the radio — a dot, the words, and an optional full-width `footer` — unselected in the `input` border, selected with a `primary` border, ring and filled dot, never a new fill. `RadioRow` (story 5.4c) is one line of a pick list — the dot and words that wrap, at least 44 px tall — selected with a `primary` border alone. The screen labels the group. |
| `Notice` (`ui/notice.tsx`) | The one refusal and confirmation box, in the Input look. The `role` is the variant: `alert` draws a warning icon and `status` a check, so the two differ by shape as well as by words. One more shape since story 8.2: `role="status" variant="offline"` draws a WifiOff icon, for the as-of note over a snapshot drawn offline. Every other attribute (`id`, `ref`, `tabIndex`, `aria-*`) passes through to its `<p>`. |
| `StackedList`, `StackedRow`, `StackedFields`, `StackedField`, `StackedSkeletonRow` (`ui/stacked-list.tsx`) | A table's phone form (story 7.6): a `ul` named by the table's caption, an `li` per row, and a `dl` pairing every value with its column's own label — visible, or `sr-only` (`labelHidden`) where the row's position carries it. The screen switches on `usePhone()` and renders one form only; nothing in it scrolls sideways. `sort-control.tsx` beside it is the phone's `Poredano:` control, shared by *Sati* and *Ljudi*. |

## Reordering a list (story 2.3b)

A list the person reorders uses `@dnd-kit` (`core` + `sortable`), never native
HTML5 drag-and-drop, which is unreliable on touch. The rotation builder's steps
(`features/rotation/components/rotation-pattern-card.tsx`) are the reference:

- Each item is one row that never wraps. Only a ghost `Button` handle
  (`GripVertical`, `h-11 w-11`, `touch-none`) activates the drag
  (`setActivatorNodeRef`), and its accessible name names the item's position.
- Mouse, touch and keyboard sensors: space lifts, the arrows move, space drops,
  Escape cancels. Every announcement, the instructions and the handle's role
  description come from `hr.json`, so dnd-kit says nothing in English.
- The drop hands indices to a pure, tested operation (`withStepMovedTo`); the
  screen never reorders, and focus after a drop is a rule in the same module.
