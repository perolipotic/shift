# `components/`

shadcn/ui primitives (added under `ui/`, inherited wholesale and never
restyled) plus the domain components named in DESIGN.md. `utils.ts` holds
shadcn's `cn` merger; `components.json` points the `utils`, `lib` and `hooks`
aliases here so no directory outside the architecture spine's `src/` shape is
created.

No component contains a user-facing literal — every string comes from `i18n/`.
