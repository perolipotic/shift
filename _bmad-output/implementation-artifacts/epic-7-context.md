# Epic 7 Context: The app is calm on every screen

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Every shipped screen reads calm, minimal and simple on a phone (390 px) and a desktop (1440 px), in both light and dark themes. A pilot user finds each answer in one glance and makes each change behind one Save. The epic fixes measured defects from the 2026-10-01 UX review. The phone tab bar overflowed sideways. Dark *Noć* and non-working cells measured 1.02:1. The member page stacked five forms, and its team change preselected a different team. Tables scrolled sideways on phones. Syne numerals were misread. The Kalendar and Sati filters and month switchers were inconsistent. It also adds four small new capabilities: first-sign-in password, hours explanation, admin leave overview and resolved-conflicts history. No story is needed for any earlier epic to be correct. Foundations 7.1–7.4 ship before Epic 6. Stories 7.5–7.18 follow Epic 6, in dependency order. The reference design is the approved mockups in `ux-designs/ux-shift-2026-10-01-redesign/mockups/` and the 27 decisions in that folder's README.

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
  - Keyboard operable, with meaningful labels for assistive technology.
  - WCAG 2.1 AA contrast for slot label text in both themes.
- **Hour and leave figures agree on every surface at a given moment.** An overview row equals that member's own view.
- **First sign-in (new):** a member with an admin-issued or admin-reset password reaches only the set-password step until they save their own. The issued password is four words, shown to the admin once with `Kopiraj`. After saving, the member continues without signing in again.
- **Hours explanation (new):** any Sati figure opens the shifts and bands that compose it, with date, shift type, band hours and source (rotation, override or leave). The equation sums exactly to the figure, and a shift in unresolved conflict is marked as it is on the view.
- **Admin leave overview (new):** shows allowance, used and balance for the leave year, where allowance − used = balance on every row. A member-role account is refused.
- **Resolved conflicts (new):** each entry shows date, team, shift type, member, resolution, acting admin and timestamp. It reads only stored conflict resolutions. It is explicitly not an audit-log UI and exposes no other history.
- **Member directory:** a member can see it by team from *Više*, read-only. It shows name, team, and rank and position where used. It never shows allowance, balance, leave, hours or contact details.
- **Conflict marks:** a member never sees one on their own calendar. An admin still sees an unresolved conflict without opening detail.
- **Sign-in:**
  - It reveals nothing before authentication. The organization shows as the slug only (from the URL or the device's last-used value), with no name or logo lookup.
  - One generic error covers a wrong organization, username or password: `Organizacija, korisničko ime ili lozinka nisu točni.`
- **Every story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same PR.** Binding docs never describe unbuilt UI, and no doc is updated ahead of its story.

## Technical Decisions

- **Domain returns codes and operands, never prose.** This covers the hours explanation equation, previews and warnings. The i18n layer translates them, and no literal user-facing text appears outside i18n.
- **One snapshot per surface.** Every figure on a screen comes from one composite read under one query key, loaded from `features/<module>/services/snapshot.ts`. A new overview or history surface gets its own snapshot. There are no optimistic updates for hours, leave balance or conflict state. Writes invalidate their surface and every dependent key.
- **Previews reuse domain functions, never a second implementation.**
  - The leave dialog's conflict preview is the domain collision function, from the same family as 5.5's diff.
  - The replacement candidates in day detail use 5.4's candidate-grouping helper (`slobodan` / `radi taj dan · 24 h bez pauze`). The groups inform and never block.
- **AD-16, applied with 7.8.**
  - The single admin-auth Edge Function sets `app_metadata.must_set_password` on `createUser` and `resetPassword`.
  - It gains one operation that clears the flag for the calling user only, after `auth.updateUser({ password })` succeeds. No caller can clear another account's flag.
  - A route guard keeps every surface closed while the flag is set.
  - The function still performs no domain logic.
  - Update the architecture's "claim-code identity" deferred note to say that member-chosen passwords are now partly adopted.
  - The flag needs no migration.
- **Migrations:** at most one may be needed in the whole epic. Before numbering a migration, check the main checkout for untracked migrations from parallel sessions.
- **URL convention:** Sati's `?tim=` becomes `?smjena=`, and old URLs redirect. Filters stay in the URL.
- **Tokens:**
  - The brand delta grows from 23 to 24 names with `shift-nonworking-border`. Each name is defined in light and dark.
  - Dark *Dan* and *Noć* now have similar luminance, so hue, the border and the label tell them apart.
  - `theme-fidelity` and `theme-contrast` tests pin the values.
- **Typography:** every digit is DM Sans tabular figures, including stat numerals. Syne is for words and headings only. DM Sans must cover č ć ž š đ Č Ć Ž Đ Š.
- **Module boundaries:**
  - Pages compose features and hold no query, mutation or derivation of their own.
  - A feature imports another feature's module only through `FEATURE_PUBLIC`.
  - There are no `index.ts` barrels.

## UX & Interaction Patterns

- **Facts plus dialogs:** the member page, Organizacija and day detail read as facts. Each change opens its own small dialog with one Save, and where applicable shows a computed *Što se mijenja* before saving. A team change starts empty.
- **Phone navigation:**
  - The bar has four fixed tabs plus *Više*.
  - An admin's tabs are Danas, Kalendar, Raspored and Ljudi. Their *Više* holds Sati and Godišnji (*Pregled*), and Postavke rotacije and Organizacija (*Postavke*).
  - On a phone, the theme control (Sustav / Svijetla / Tamna) and Odjava are in *Više*. On desktop they are in the user menu.
  - The *Više* sheet is keyboard operable and labelled.
- **Shared month toolbar:**
  - It reads ‹ month ▾ ›, and the month opens a month-grid popover.
  - PgUp/PgDn move the month. Navigation is symmetric and unbounded.
  - On the current month, `Ovaj mjesec` is a label. On any other month it is a button.
- **Filters:**
  - Active filters are chips (Smjena, Osoba) with ✕, a summary line and one `Poništi filtre`.
  - In Kalendar, choosing a person replaces the team. In Sati, the filters combine.
  - On a phone, filters open in a sheet and the chips stay visible.
- **Copy and states:**
  - Empty states say what is true, for example `Luka Knežević nije u Smjeni B u listopadu 2026.`
  - A zero count is still shown, for example `0 neriješenih konflikata`.
  - Never say *smjena* for a shift type.
  - There are no toasts and no standing banners. A status line is `Notice role="status"`.
  - Skeletons, not spinners.
  - One neutral confirmation for a removal or deactivation, with the consequence in numbers.
  - `destructive` styling is only for unresolved conflicts.
- **Croatian microcopy:** state facts, use numbers rather than adjectives, use no exclamation marks, use the informal second person singular, write `19:00–07:00` with an en dash, and write dates as `12.09.2026`.

## Cross-Story Dependencies

- **Foundations:**
  - 7.1–7.4 have no dependencies and ship before Epic 6, which builds on them.
  - 7.5 needs 7.4.
  - 7.6 needs 7.2.
  - 7.17 needs 7.3.
- **Sign-in:** 7.8 needs 7.7 and carries the AD-16 edit.
- **Member page chain:** 7.12 needs 7.11, and 7.13 needs 7.6 and 7.11.
- **Stacked-table consumers:** 7.14 and 7.15 need 7.6.
- **Other epics:**
  - 7.9 needs 7.5 and 5.4's candidate-grouping helper.
  - 7.16 needs 5.4, the conflict resolution flow.
  - 7.12's collision preview shares the 5.5 function family.
- **Shipped surfaces:** Epic 7 rewrites the surfaces of 1.3/1.3b, 1.4, 1.8, 2.4, 3.3–3.6, 4.1b, 4.2 and 5.1/5.2. Expect test churn in their unit tests and e2e page objects, the largest being `pages/prijava.test.ts` (7.7).
