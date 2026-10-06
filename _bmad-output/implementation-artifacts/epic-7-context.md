# Epic 7 Context: The app is calm on every screen

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Every screen should read calm, minimal and simple on a phone and on a desktop, in both themes. A pilot user finds each answer at a glance and makes each change behind one Save. The epic comes from a UX review of the shipped app, which found measured defects. The phone tab bar overflows sideways. In the dark theme, *Noć* and a non-working day measure 1.02:1, so a night shift reads as a free day. The member page stacks five forms, and its team change preselects a different team. Tables scroll sideways on phones. Syne numerals are misread ("17" reads as "ı7"). Kalendar and Sati have mismatched filters and month switchers. Epic 7 adds no new domain capability of its own. It reworks existing surfaces and adds four small FRs: first-sign-in password, hours explanation, admin leave overview and resolved-conflict history. No completed story is rolled back. New stories replace the old surfaces, and the original acceptance criteria stay in history.

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

- **No horizontal scroll at phone width (390 px).** Below 640 px, a table becomes stacked rows, and each value keeps its column label for assistive technology. The calendar grid alone still scrolls inside its own container. At 640 px and wider, tables stay sortable tables with tabular numerals.
- **Phone navigation.** The bar has four fixed tabs plus *Više*, and the active tab is always visible. The admin's tabs are Danas, Kalendar, Raspored and Ljudi. Theme (Sustav / Svijetla / Tamna) and Odjava sit in *Više* on a phone and in the user menu on desktop. *Više* is a sheet that is keyboard operable and labelled.
- **Contrast and colour.** Every slot label meets WCAG 2.1 AA in both themes. No state is shown by colour alone. `destructive` is reserved for unresolved conflicts.
- **Sign-in.**
  - Sign-in is one form: organization, username and password.
  - It shows one generic error for a wrong organization, username or password: `Organizacija, korisničko ime ili lozinka nisu točni.` The form must not reveal which organizations or usernames exist.
  - Before sign-in, no organization name or logo is looked up. The organization shows only as the slug, from the URL or from the last one used on the device (stored in localStorage, empty when storage is unavailable).
- **First sign-in.** A member whose password an admin issued or reset reaches only the set-password step until they save their own password. Then they continue to their landing surface without signing in again. The admin-issued password is four words, shown to the admin once with `Kopiraj`. An admin reset puts the member back under this rule.
- **Hours explanation.** It lists every counted shift with its date, shift type, band hours and source (rotation, override or leave). It sums exactly to the figure it explains, and a conflicted shift is marked as it is on the view.
- **Admin leave overview.** Each row equals that member's own view, and allowance − used = balance. A member-role account is refused.
- **Resolved conflicts.** Each entry shows date, team, shift type, member, resolution, acting admin and timestamp. It is read only from `conflict_resolutions`. It is explicitly not an audit-log UI and exposes no other change history.
- **Members see no conflict marks** on their own schedule, only their own leave. Admins still see conflicts on the calendar without opening detail.
- **Member directory.** It is read-only, grouped by team, and reachable from *Više*. It shows name and team, plus rank and position where used. It never shows allowance, balance, leave, hours or contact details.
- **Doc-sync rule.** Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same PR. Binding docs must never describe unbuilt UI.

## Technical Decisions

- **The domain returns codes and operands, never prose.** The hours explanation comes from `domain/hours` as codes and operands. The leave dialog's conflict preview reuses the domain collision function, the same family as 5.5's diff, and never re-implements it. Recomputing outside `packages/domain` is a defect.
- **One snapshot per surface.** Every figure on a screen derives from one composite query (`features/<module>/services/snapshot.ts`). New reads (the org-wide leave overview, the `conflict_resolutions` list) narrow the canonical `OrganizationSnapshot`; they do not define new shapes. There are no optimistic updates for hours, leave or conflict state. A write invalidates its own snapshot and every key derived from the rows it writes.
- **AD-16 edit (applied with 7.8).**
  - The admin-auth Edge Function sets `app_metadata.must_set_password` on `createUser` and `resetPassword`.
  - It gains one operation that clears the flag, only for the calling user, after `auth.updateUser({ password })`. No caller can clear the flag for another account.
  - A route guard keeps every surface closed while the flag is set.
  - The function still does no domain calculation and holds no engine rule.
  - The flag needs no migration. The deferred "claim-code identity" note must say that it is partly reversed.
- **No new server runtime.** There is exactly one Edge Function. All other writes are PostgREST under RLS.
- **URL convention.** Filters live in the URL. On Sati, `?tim=` becomes `?smjena=`, and old URLs redirect.
- **Strings.** No literal user-facing text outside `i18n`. Croatian copy uses three plural forms.
- **Module boundaries.** A page composes features and holds no query, mutation or derivation. Cross-feature imports go only through `FEATURE_PUBLIC`, and there are no barrels.
- **Migrations.** Any migration this epic needs must check the main checkout for untracked migrations before numbering, because parallel sessions collide.
- **Tests.**
  - Heavy churn is expected: `theme-fidelity` and `theme-contrast` (7.1), `pages/prijava.test.ts` (7.7), and the e2e page objects for login, base, calendar, hours, people, leave, rotation and organization.
  - Domain rules are asserted in Vitest node (no jsdom) against both fixtures.
  - Phone defects are verified by e2e at 390 px.

## UX & Interaction Patterns

- **Source of truth.** The mockups in `ux-designs/ux-shift-2026-10-01-redesign/mockups/` and the 27 approved decisions in its README. They build on `ux-shift-2026-09-02/DESIGN.md` and `EXPERIENCE.md`.
- **Typography.** DM Sans with tabular figures for every number, including large stat numerals. Syne is for words and headings only. DM Sans must cover č ć ž š đ.
- **Pages of facts, with a dialog per change.**
  - The member page, organization settings and day detail read as facts.
  - Each change opens its own dialog with one Save, plus a computed *Što se mijenja* or *bilo / sada* where relevant.
  - A team change starts empty.
  - A removal or deactivation asks one neutral confirmation, never in `destructive` styling.
- **Month toolbar.** `‹ month ▾ ›` with a month-grid popover. PgUp/PgDn move the month, unbounded in both directions. `Ovaj mjesec` is a label on the current month and a button otherwise.
- **Filters.**
  - Filters are chips (Smjena, Osoba) with ✕, a summary line and one `Poništi filtre`.
  - In Kalendar, picking a person replaces the team. In Sati, the two filters combine.
  - On a phone, filters open in a sheet, and the active chips stay visible.
- **Replacement candidates.** They are grouped `slobodan` / `radi taj dan · 24 h bez pauze`. The groups inform only and never block. Reuse 5.4's helper.
- **Standing rules.** No toasts and no persistent banners: a confirmation is a `Notice role="status"` line that is gone on navigation. Skeletons, not spinners. Empty states state what is true. Every interaction is keyboard and screen-reader operable. Only the existing blocking validations apply, plus the 5.5 erasure rule.

## Cross-Story Dependencies

- **Order.** Foundations 7.1–7.4 ship before Epic 6. 7.1 and 7.2 are done; 7.3 and 7.4 are next. Stories 7.5–7.18 follow Epic 6, in dependency order.
- **Within the epic.**

  | Story | Depends on |
  |---|---|
  | 7.5 | 7.4 |
  | 7.6 | 7.2 |
  | 7.8 | 7.7 |
  | 7.9 | 7.5 |
  | 7.12 | 7.11 |
  | 7.13 | 7.6, 7.11 |
  | 7.14 | 7.6 |
  | 7.15 | 7.6 |
  | 7.17 | 7.3 |

- **External.**
  - 7.9 reuses 5.4's candidate-grouping helper.
  - 7.16 depends on 5.4 (`conflict_resolutions`).
  - 7.12's collision preview shares its function family with 5.5's erasure diff.
  - Epic 6's Danas builds on 7.1–7.4.
- **Surfaces replaced.** Stories 1.3/1.3b, 1.4, 1.8, 2.4, 3.3–3.6, 4.1b, 4.2 and 5.1/5.2. Their tests and e2e page objects change with them.
