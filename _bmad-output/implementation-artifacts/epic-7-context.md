# Epic 7 Context: The app is calm on every screen

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Rework the surfaces that already work so every screen reads calm, minimal and simple on a phone (390 px) and a desktop, in both themes. A pilot user should find each answer at a glance and make each change behind one Save. The epic fixes defects measured in the 2026-10-01 UX review. The phone tab bar overflows sideways. In the dark theme *Noć* and a non-working day measure 1.02:1. The member page stacks five forms, and its team change preselects a different team. Tables scroll sideways on phones. Syne numerals get misread ("17" as "ı7"). Kalendar and Sati have inconsistent filters and month switchers. The epic also adds a few small capabilities: a first sign-in password, an explanation for each hours figure, an admin leave overview, a resolved-conflicts history and a member directory by team. Foundations 7.1–7.4 ship before Epic 6. Stories 7.5–7.18 follow Epic 6 in dependency order. No completed story is rolled back.

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

- **No horizontal page scroll at phone width.** Below 640 px a table (Sati, Ljudi, shift types) becomes stacked rows, and each value keeps its column label for assistive technology. Only the calendar grid still scrolls inside its own container. At 640 px and wider, tables stay sortable tables.
- **Contrast.** Every slot fill's label meets WCAG 2.1 AA in both themes. *Noć* and non-working are told apart by hue, the new non-working border and the always-visible label, never by luminance alone. No state is shown by colour alone.
- **First sign-in password.** A session whose password an admin issued or reset is refused on every surface except setting a new password. The admin-issued password is four words, shown once with `Kopiraj`.
- **Sign-in privacy.** No organization name or logo is looked up or shown before sign-in. Only the slug from the URL or from this device is shown. A wrong organization, username or password all give the same message: `Organizacija, korisničko ime ili lozinka nisu točni.`
- **Hours explanation.** Any Sati figure opens the shifts and bands that compose it, as an equation with dates that sums exactly to the figure.
- **Admin leave overview.** Shows each member's allowance, days used and balance for the leave year, and allowance − used = balance on every row. Each row equals that member's own view. A member-role request is refused, and a member sees only their own leave.
- **Resolved conflicts.** Each entry shows date, team, shift type, member, resolution, acting admin and timestamp. The list reads only stored conflict resolutions and exposes no other change history, because it is not an audit-log UI.
- **Members' calendar.** A member sees their own leave and no conflict marks. An admin still sees unresolved conflicts without opening detail.
- **Member directory.** It is read-only and grouped by team. It shows name, team, rank and position where used. It never shows allowance, balance, leave, hours or contact details.
- **Every number agrees with its detail view.** A figure on any surface equals the same figure on its detail screen.
- **Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same PR.** Binding docs never describe unbuilt UI.

## Technical Decisions

- **Domain returns codes and operands, never prose.** The hours explanation is built in `domain/hours` as codes and operands and translated only in i18n. No user-facing literal text outside i18n.
- **One snapshot per surface.** Every figure on a screen, including the new overview, explanation and previews, derives from that surface's single composite payload. Writes invalidate their surface key and declared dependents. No optimistic updates for hours, leave balance or conflict state.
- **No second implementation of a rule.** The leave dialog's conflict preview calls the domain collision function. It is the same function family as 5.5's erasure diff. Replacement candidates in 7.9 reuse 5.4's candidate-grouping helper.
- **Auth boundary amendment, applied with 7.8.** The single admin-auth Edge Function sets `app_metadata.must_set_password` on `createUser` and `resetPassword`. It gains one operation that clears the flag only for the authenticated caller, after `auth.updateUser({ password })`. No caller can clear another account's flag. The function still holds no domain logic. A route guard closes every other route while the flag is set. 7.8 also updates the deferred "claim-code identity" note to say that member-chosen passwords are now partly adopted. The flag needs no migration.
- **Tokens.** The brand delta grows from 23 to 24 names when `shift-nonworking-border` is added, each defined in light and dark. `theme-fidelity` and `theme-contrast` tests pin and re-measure the values. Never add org-specific tokens such as `shift-day` or `shift-night`.
- **Fonts.** Syne is for words and headings only. Every number, including stat numerals, is DM Sans with tabular figures. Fonts are self-hosted, never loaded from the Google CDN. A face change re-runs the Croatian glyph check (č ć ž š đ).
- **URL convention.** Filters live in the URL. Sati's `?tim=` becomes `?smjena=`, and old URLs redirect.
- **Module boundaries.** Pages compose features and hold no query, mutation or derivation. Cross-feature imports must be listed in `FEATURE_PUBLIC`.
- **Migrations.** Any new migration must check the main checkout for untracked migrations before taking a number.

## UX & Interaction Patterns

- **Reference.** The approved mockups are in `ux-designs/ux-shift-2026-10-01-redesign/mockups/` (desktop at 1440 px, phone at 390 px, both themes, Croatian copy, pilot data DVD Kaštel Novi, October 2026). The 27 approved decisions are in its README.
- **Phone navigation.** The bottom bar has four fixed tabs plus *Više*. For an admin they are Danas, Kalendar, Raspored and Ljudi. Sati, Godišnji and the configuration groups sit in the *Više* sheet. Theme (Sustav / Svijetla / Tamna) and Odjava are in *Više* on a phone and in the user menu on desktop. The sheet is keyboard operable and labelled.
- **Month toolbar.** Kalendar and Sati share ‹ month ▾ › with a month-grid popover. PgUp/PgDn and the arrows move the month, symmetric and unbounded. `Ovaj mjesec` is a label on the current month and a button on any other.
- **Filters.** Active filters are chips (Smjena, Osoba) with ✕, a summary line and one `Poništi filtre`. In Kalendar, picking a person replaces the team. In Sati the two filters combine. On a phone, filters open in a sheet and the active chips stay visible. Empty results state what is true.
- **Facts pages with dialogs.** The member page, day detail and Organizacija show facts. Each change opens its own dialog with one Save and a computed *Što se mijenja* or *bilo / sada*. A team change starts empty. The accent picker uses named radio cards. The timezone is shown locked, and the page says why. *Povijest rotacije* sits behind a header button.
- **Confirmations.** Removals and deactivations ask one neutral modal question that names the subject and states the consequence in numbers.
- **Kept everywhere.** Croatian copy with three plural forms. No toasts and no persistent banners; a saved decision shows a `Notice role="status"` line. `destructive` is used only for unresolved conflicts. Skeletons, not spinners. Zero counts are shown (`0 neriješenih konflikata`). Tap targets are at least 44 px. Only the two blocking validations plus the 5.5 erasure rule block a save.

## Cross-Story Dependencies

- 7.1–7.4 have no dependencies and must ship before Epic 6 (6.1–6.3), which builds on them.
- 7.5 depends on 7.4. 7.6 depends on 7.2. 7.9 depends on 7.5 and on 5.4's candidate-grouping helper.
- 7.8 depends on 7.7. 7.12 depends on 7.11. 7.13 depends on 7.6 and 7.11.
- 7.14 and 7.15 depend on 7.6. 7.16 depends on 5.4. 7.17 depends on 7.3.
- 7.10, 7.11 and 7.18 have no story dependencies.
- The PRD edits these stories need are already applied: FR-3a, FR-42b, FR-45a, FR-48a with its carve-out, the CAP-5 and CAP-13/FR-38 edits and NFR-15.
- Expect test churn in the theme tests (7.1), `pages/prijava.test.ts` (7.7), and the e2e page objects for login, base, calendar, hours, people, leave, rotation and organization.
