# Epic 7 Context: The app is calm on every screen

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Every shipped screen should read calm, minimal and simple on a phone (390 px) and on a desktop (1440 px), in both light and dark themes. A pilot user finds each answer in one glance and makes each change behind one Save. The epic fixes measured defects from the 2026-10-01 UX review:

- The phone tab bar overflowed sideways.
- Dark *Noć* and non-working cells measured 1.02:1.
- The member page stacked five forms, and its team change preselected a different team.
- Tables scrolled sideways on phones.
- Syne numerals were misread.
- The Kalendar and Sati filters and month switchers looked "thrown together". This was the human's main concern.

It also adds four small capabilities: a first-sign-in password, an hours explanation, an admin leave overview and a resolved-conflicts history. No story is needed for any earlier epic to be correct. Foundations 7.1–7.4 have shipped, ahead of Epic 6. Stories 7.5–7.18 follow Epic 6, in dependency order. The reference design is the approved mockups in `ux-designs/ux-shift-2026-10-01-redesign/mockups/` and the 27 decisions in that folder's README. Filters are covered by `filters-and-month-nav-1.html`, direction A.

## Stories

- Story 7.1: Dark slot tokens are re-tuned so Noć never reads as a free day
- Story 7.2: Every number is set in DM Sans tabular figures
- Story 7.3: The phone bar has four tabs and Više
- Story 7.4: Kalendar and Sati share one month toolbar
- Story 7.5: Filters are chips that say what is shown and clear in one action
- Story 7.6: Tables become stacked rows on a phone
- Story 7.7: Sign-in is one form
- Story 7.8: A member's first sign-in makes them set their own password
- Story 7.9: Day detail changes open in their own dialogs
- Story 7.10: A member's own schedule shows their leave and no conflict marks
- Story 7.11: The member page shows facts and each change opens one dialog
- Story 7.12: The leave dialog shows what a record costs and creates before saving
- Story 7.13: Ljudi shows each member's status and adds a member in a dialog
- Story 7.14: An hours figure explains itself
- Story 7.15: An admin sees everyone's leave in one overview
- Story 7.16: Resolved conflicts stay readable
- Story 7.17: Members find the directory by team in Više
- Story 7.18: Organization settings show facts and change through dialogs

## Requirements & Constraints

- **Definition of done on every surface:**
  - No horizontal page scroll at phone width. Below 640 px a table becomes stacked rows. The calendar grid still scrolls inside its own container.
  - No information is shown by colour alone.
  - Every surface is keyboard operable and has meaningful labels for assistive technology.
  - Slot label text meets WCAG 2.1 AA contrast in both themes.
- **Hour and leave figures agree on every surface at a given moment.** A row in an overview equals that member's own view.
- **Calendar filters:**
  - Any member can filter to all teams, one team or one member.
  - Options come from live records and are never hard-coded.
  - The member filter shows that member's shifts, including override-held shifts, plus their leave.
  - Filter state survives month navigation within a session. It is not persisted across sessions.
  - All filters clear in one action, without leaving the screen.
- **Organization hours:**
  - The view is filterable by team and member, and the two filters combine.
  - Export (`Izvezi u Excel`) exports exactly the current period, filter and sort.
- **First sign-in (new):**
  - A member with an admin-issued or admin-reset password reaches only the set-password step until they save their own.
  - The issued password is four words, shown to the admin once with `Kopiraj`.
  - After saving, the member continues without signing in again.
- **Hours explanation (new):** any Sati figure opens the shifts and bands that compose it. Each line shows the date, shift type, band hours and source (rotation, override or leave). The equation sums exactly to the figure.
- **Admin leave overview (new):**
  - Each row shows allowance, used and balance for the leave year, and allowance − used = balance on every row.
  - A member-role account is refused.
- **Resolved conflicts (new):**
  - Each entry shows date, team, shift type, member, resolution, acting admin and timestamp.
  - It reads only stored conflict resolutions. It is not an audit-log UI.
- **Member directory:** a member reaches it from *Više*, grouped by team and read-only. It shows name, team, and rank and position where used. It never shows allowance, balance, leave, hours or contact details.
- **Conflict marks:** a member never sees one on their own calendar. An admin still sees an unresolved conflict without opening detail.
- **Sign-in:**
  - It reveals nothing before authentication. The organization shows as its slug only, with no name or logo lookup.
  - One generic error covers a wrong organization, username or password: `Organizacija, korisničko ime ili lozinka nisu točni.`
- **Every story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes, in the same PR.** Binding docs never describe unbuilt UI.
  - 7.5 rewrites EXPERIENCE.md §Interaction Primitives ("Team / member filter", which still describes one Select) and UX-DR19, 20, 34 and 36.

## Technical Decisions

- **Domain returns codes and operands, never prose.** This covers equations, previews, warnings and empty-state facts. The i18n layer translates them, and no user-facing literal appears outside i18n.
- **One snapshot per surface.** Every figure on a screen comes from one composite read under one query key (`features/<module>/services/snapshot.ts`).
  - There are no optimistic updates for hours, leave balance or conflict state.
  - Writes invalidate their surface and every dependent key.
- **Previews reuse domain functions.**
  - The leave dialog's conflict preview is the domain collision function, from the same family as 5.5's diff.
  - Day detail's replacement candidates use 5.4's candidate-grouping helper. The groups inform and never block.
- **AD-16, applied with 7.8:**
  - The admin-auth Edge Function sets `app_metadata.must_set_password` on `createUser` and `resetPassword`.
  - It gains one operation that clears the flag for the calling user only, after `auth.updateUser({ password })` succeeds.
  - A route guard keeps every surface closed while the flag is set. The flag needs no migration.
  - Update the claim-code deferred note in the architecture doc.
- **Migrations:** at most one in the whole epic. Check the main checkout for untracked migrations from parallel sessions before numbering one.
- **All filter state lives in the URL:** `?mjesec=2026-10&prikaz=sve&smjena=…&osoba=…`.
  - Sati's `?tim=` becomes `?smjena=`, and an old URL redirects to the same view.
  - A filter change updates the URL immediately, so Back works.
  - Changing the month keeps the mode and filters.
- **Tokens and type:** the brand delta has 24 names, and `theme-fidelity` and `theme-contrast` pin them. Every digit is set in DM Sans tabular figures. Syne is for words only.
- **Module boundaries:**
  - Pages compose features and hold no query, mutation or derivation of their own.
  - A feature reaches another feature only through `FEATURE_PUBLIC`.
  - Do not add `index.ts` barrels.

## UX & Interaction Patterns

- **Shared toolbar (Kalendar and Sati), in a fixed order:** month · view · filters · action.
  - The month control is the shipped 7.4 toolbar.
  - The view (*Moj raspored* / *Sve smjene*) is a segmented `role="group"` with `aria-pressed`. The selected option differs by surface, border and bold text, not by colour alone.
  - On Sati, `Izvezi u Excel` is an action on the right, not a filter.
- **Filter chips (direction A):**
  - Two always-visible chips: `Smjena: sve|<team>` and `Osoba: sve|<name>`. They replace Kalendar's single "Smjena ili osoba" select and Sati's two labelled selects.
  - The chip button opens its picker.
  - A separate ✕ is named `Ukloni filtar smjena: Smjena B`. After removing a chip, focus moves to the next chip, or to the toolbar's first button.
  - The Osoba picker is a searchable combobox. People are grouped by team, and the match count is shown ("1 od 17").
  - The Smjena chip keeps its count (`sve smjene (4)`). Its options come from records and are grouped under a labelled heading.
- **Summary line:** it is a permanent part of the toolbar, not a banner or toast.
  - It reads `Prikazano: Smjena B · 4 osobe od 17`, `Prikazano: Luka Knežević · Smjena A`, or, unfiltered, `Prikazano: sve smjene (4) · 17 osoba`.
  - While any filter is active, it ends with one `Poništi filtre`.
  - The approved wording is `Poništi filtre`, not "Poništi filtere".
- **The same toolbar behaves two ways:**
  - **Kalendar:** choosing a person replaces the team (3.3b). The Smjena chip hides, and the person carries their own team. The column is headed "Luka Knežević · Smjena A".
  - **Kalendar, *Moj raspored*:** no filters are shown. A sentence says why: `Tvoj raspored · Smjena A. Filtri vrijede za „Sve smjene”.`
  - **Sati:** the two filters combine.
- **Empty result:** state what is true, never "no results". For example: `Luka Knežević nije u Smjeni B u listopadu 2026.` plus `Luka je u Smjeni A.` It offers two actions, `Ukloni Smjenu B` and `Poništi filtre`. This replaces "Nijedna osoba ne odgovara odabranom filtru.".
- **Phone:**
  - The header is sticky, about 150 px.
  - A `Filtri` button shows the active count, with no number when no filter is active, and opens a bottom sheet:
    - Smjena is a single choice, with a person count on each option.
    - Osoba is a search field (`Traži osobu (17)`). In Kalendar it carries the note `U Kalendaru osoba zamjenjuje smjenu, jer osoba već nosi svoju smjenu.`
    - The sheet ends with `Poništi` and a live `Prikaži 17 osoba`.
  - Active chips, with a `Poništi`, stay visible under the header without opening the sheet.
  - Swiping the grid changes the month as a shortcut only. ‹ › always exist.
- **Loading:** the toolbar and chips render at once, because their state comes from the URL. Only the rows or grid below show a skeleton. Do not use spinners.
- **Other patterns:**
  - **Facts plus dialogs:** each change opens its own small dialog with one Save and a computed *Što se mijenja*.
  - **Phone navigation:** four tabs plus *Više*.
  - **Copy:** a zero count is still shown. Never use *smjena* for a shift type. Do not use toasts or standing banners. A status line is `Notice role="status"`.
  - **`destructive` styling:** only for unresolved conflicts.
  - **Croatian microcopy:** state facts, use numbers rather than adjectives, no exclamation marks, informal second person singular, `19:00–07:00`, `12.09.2026`.

## Cross-Story Dependencies

- 7.1–7.4 are done.
- 7.5 builds on 7.4's toolbar. 7.9 needs 7.5 and 5.4's helper. 7.13's Ljudi status filter chip should reuse 7.5's chip pattern.
- 7.6 needs 7.2. 7.13, 7.14 and 7.15 need 7.6. 7.12 and 7.13 need 7.11.
- 7.8 needs 7.7 and carries the AD-16 edit. 7.17 needs 7.3. 7.16 needs 5.4.
- Epic 7 rewrites shipped surfaces from 1.3/1.3b, 1.4, 1.8, 2.4, 3.3–3.6, 4.1b, 4.2 and 5.1/5.2, so expect churn in unit tests and e2e page objects. For 7.5 that means the Kalendar filter select (3.3b) and the Sati filters and export (4.2/4.1b).
