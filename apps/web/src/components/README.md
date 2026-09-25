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
- A native `<select>` uses the Input look. The class string stays literal in
  each screen for the 44 px check, and `prijava.test.ts` holds all six to
  this one. Select class string:
  `flex h-11 w-full rounded-md border-[1.5px] border-input bg-card px-3 text-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50`.

## Layout primitives (visual refresh B)

| Primitive | Use |
|---|---|
| `PageHeader`, `PageTitle`, `PageActions` (`ui/page-header.tsx`) | The skeleton's head. `PageTitle asChild` styles the screen's own `<h1>`. |
| `StatCard`, `StatLabel`, `StatValue` (`ui/stat-card.tsx`) | A summary figure: a `t()` label and a `formatNumber` value, counted by a pure module from data the screen already has. |
| `Badge` (`ui/badge.tsx`) | A pill: `default` (primary tint), `secondary`, `outline`. Its text carries the meaning, and there are no status colours. |
| `Avatar` (`ui/avatar.tsx`) | A round initials chip for a PERSON, hidden from assistive technology because the name is always rendered beside it. With no initials it is an empty chip, so names stay aligned. |
| `Notice` (`ui/notice.tsx`) | The one refusal and confirmation box, in the Input look. The `role` is the variant: `alert` draws a warning icon and `status` a check, so the two differ by shape as well as by words. Every other attribute (`id`, `ref`, `tabIndex`, `aria-*`) passes through to its `<p>`. |
