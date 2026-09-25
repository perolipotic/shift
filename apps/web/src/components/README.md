# `components/`

shadcn/ui primitives under `ui/`, **restyled once there** to DESIGN.md's
register and never in a screen, plus the domain components named in DESIGN.md.
A screen may size and place a primitive (`h-11`, `w-full`, grid placement) but
never overrides its colour, radius, border, shadow or type. If a screen needs a
primitive to look different, the primitive changes for every screen, or a new
primitive is added here.

`utils.ts` holds shadcn's `cn` merger; `components.json` points the `utils`,
`lib` and `hooks` aliases here so no directory outside the architecture spine's
`src/` shape is created. `initials.ts` is the one pure rule for initials: the
avatar chips and the organization lockup's neutral mark both draw from it.

No component contains a user-facing literal or calls `t()`. Every string comes
from `i18n/`, passed in by the screen.

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
- A select is the `Select` primitive (`ui/select.tsx`), a native `<select>`
  in the Input look with a chevron in place of the browser's arrow. A screen
  composes only `className="h-11"` for the 44 px floor, as on `Input`, and
  `prijava.test.ts` refuses a bare `<select>` on a screen. Select class string:
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
| `StatTile` (`ui/stat-tile.tsx`) | A summary figure INSIDE a card, where `StatCard` would nest a card in a card. |
| `InputGroup`, `InputGroupIcon` (`ui/input-group.tsx`) | A leading icon on an `Input` or a `Select`; the group adds the padding, so neither primitive changes. Never on `type="time"` or `type="date"`: the browser already draws its own clock or calendar button there, and a second icon reads as a duplicate. |
| `Select` (`ui/select.tsx`) | The one select: native underneath, so `defaultValue`, `ref`, `FormData`, key-remounts and a phone's picker all keep working. The screen composes `h-11`. |
| `OutputField` (`ui/output-field.tsx`) | A computed, read-only value shaped like a field (dashed, muted), on a native `<output>`. |
| `Timeline` and parts (`ui/timeline.tsx`) | A day as one bar: `TimelineScale`, `TimelineTrack` of `TimelineSegment`s and `TimelineGap`s, `TimelineBoundaries`, `TimelineLegend`. The screen hides it from assistive technology beside a text equivalent. |
| `Dialog` and parts (`ui/dialog.tsx`) | The one modal, on the native `<dialog>` and `showModal()`: focus trap, Escape, backdrop click and focus return come from the browser. Closed means hidden, not unmounted, so uncontrolled fields keep their values. A confirmation replaces the form inside the same dialog. `ConfirmDialog` is a confirmation on its own: open while the screen renders it, so an "armed" state becomes a modal without changing, and not dismissible while `busy`. |
| `Notice` (`ui/notice.tsx`) | The one refusal and confirmation box, in the Input look. The `role` is the variant: `alert` draws a warning icon and `status` a check, so the two differ by shape as well as by words. Every other attribute (`id`, `ref`, `tabIndex`, `aria-*`) passes through to its `<p>`. |
