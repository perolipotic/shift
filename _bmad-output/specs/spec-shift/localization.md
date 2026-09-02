# Localization Contract

MVP ships Croatian (`hr`) as the only complete locale, on an architecture that treats a second language as a resource file rather than a refactor. Implementation shape — resource layout, key examples, library choice — is in the adopted addendum, §6.

## Hard rules

- **L1. No user-facing string is hard-coded anywhere in frontend code.** Every string resolves through a translation key. This covers navigation, buttons, form labels, validation messages, error messages, empty states, confirmation dialogs, calendar labels, shift labels, leave labels, dashboard content, admin settings, and table headers.
- **L2. Any new user-facing string introduced during development goes through the translation system.** This is merge-blocking, not advisory. A code review that lets a literal through has failed.
- **L3. Adding a language requires adding a translation resource and changing no component and no business logic.**
- **L4. Domain logic returns keys, codes, and values only.** No formatted, translated, or display-ready string originates in the domain layer. A function that returns `"12 sati"` instead of `12` is a defect.
- **L5. A missing key degrades visibly and safely** — never to a blank screen, and never to a crash. A second locale may exist incomplete without breaking the application.
- **L6. Dates, times, numbers, month and day names, and pluralization are produced by one centralized locale-aware layer.** Ad-hoc string construction or manual formatting anywhere else is a defect.
- **L7. Croatian's three plural forms (one / few / other) are handled by that layer.** An English-shaped `count === 1` check is a defect. This applies wherever a count is rendered: days of leave, hours, shifts, conflicts, members, teams.
- **L8. Every date and time renders in the Organization's timezone,** never the viewer's device timezone.

## Terminology, settled

The pilot's crews are colloquially **"smjene"**, which is also the natural Croatian word for **shift**. The glossary separates **Team** from **Shift Type**, and the key set cannot preserve that separation if both render as *smjena*. Resolved by the UX run and binding on the key set:

- **`Smjena` is the Team.** **`Tip smjene` is the Shift Type.** Fixed everywhere — labels, filters, empty states, validation messages.
- Because **`Sve smjene`** still reads ambiguously as an all-teams filter, that control carries a count — `Sve smjene (4)` — and groups its options under a labelled heading.
- Never say *smjena* for a Shift Type in any string, however natural it reads in isolation.

## Consequences for the engine

- Hour Band names, Shift Type names, and Team names are Organization **data**, entered by an admin in their own language. They are not translation keys and are not translated by the application — an organization naming a band `Noć` sees `Noć`, and one naming it `Night` sees `Night`.
- Therefore no code may match on a Shift Type, Team, or Hour Band **name** to determine behavior. Behavior derives from structure — the working flag, times, band boundaries, offsets — never from a string an admin typed.
