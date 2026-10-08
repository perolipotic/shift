# Epic 7 Context: The app is calm on every screen

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Every shipped screen should read calm, minimal and simple on a phone (390 px) and a desktop (1440 px), in both light and dark themes. A pilot user finds each answer at a glance and makes each change behind one Save. The epic fixes defects measured in the 2026-10-01 UX review and rewrites already-shipped surfaces through new stories, without rolling any completed story back. It also adds four small capabilities: a first-sign-in password, an explanation for any hours figure, an admin leave overview and a history of resolved conflicts. Foundations 7.1–7.6 have shipped (dark tokens, DM Sans numerals, the four-tab phone bar with *Više*, the shared month toolbar, filter chips, stacked rows on phones). 7.7–7.18 remain, in dependency order. The reference design is the approved mockups in `ux-designs/ux-shift-2026-10-01-redesign/mockups/` (one file per area: `sign-in-1`, `calendar-1`, `hours-1`, `leave-1`, `conflicts-1`, `people-1`, `member-page-1`, `setup-1`) and the 27 decisions in that folder's README. Where a mockup and an epic criterion disagree, the criterion wins.

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

- **Definition of done on every surface:** no horizontal page scroll at phone width (tables stack below 640 px, and the calendar grid scrolls inside its own container). No information is shown by colour alone. Every surface is keyboard operable and has meaningful labels for assistive technology. Text meets WCAG 2.1 AA in both themes.
- **Figures agree everywhere.** Hour and leave figures match on every surface at a given moment. A row in an overview equals that member's own view.
- **Sign-in:**
  - It reveals nothing before authentication. With `/prijava/<slug>`, the organization shows as the slug only, read-only, with `Promijeni`. No organization name or logo is looked up (this overrides the mockup's logo row).
  - Without the URL, the field is prefilled from the last organization used on this device (localStorage), and is empty when storage is unavailable. A slug that does not exist stays editable and fails like any other wrong value.
  - One generic error covers a wrong organization, username or password: `Organizacija, korisničko ime ili lozinka nisu točni.`
- **First sign-in:** a member with an admin-issued or admin-reset password reaches only the set-password step until they save their own. An admin reset puts them back under this rule. The issued password is four words, shown to the admin once with `Kopiraj`. After saving, the member continues to their landing surface without signing in again.
- **Hours explanation:** any Sati figure opens the shifts and bands that compose it. Each line shows the date, shift type, band hours and source (rotation, override or leave). A shift in unresolved conflict is marked as it is on the view. The equation sums exactly to the figure.
- **Admin leave overview:** each row shows allowance, used and balance for the leave year, and allowance − used = balance on every row. A member-role account is refused.
- **Resolved conflicts:** each entry shows date, team, shift type, member, resolution, acting admin and timestamp. It reads only stored conflict resolutions and is not an audit-log UI.
- **Member directory:** members reach it from *Više*, grouped by team and read-only. It shows name, team, and rank and position where used. It never shows allowance, balance, leave, hours or contact details.
- **Conflict marks:** a member never sees one on their own calendar. An admin still sees an unresolved conflict without opening detail.
- **Docs in the same PR:** every story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes. Binding docs never describe unbuilt UI.

## Technical Decisions

- **The domain returns codes and operands, never prose.** This covers equations, *Što se mijenja* previews, warnings and empty-state facts. The i18n layer translates them, and no user-facing literal appears outside i18n.
- **One snapshot per surface:** every figure on a screen comes from one composite read under one query key. There are no optimistic updates for hours, leave balance or conflict state. Writes invalidate their surface and every dependent key.
- **Previews reuse domain functions, never a second implementation.** The leave dialog's conflict preview is the domain collision function. Day detail's replacement candidates use 5.4's candidate-grouping helper, and the groups inform without blocking.
- **One privileged auth boundary (AD-16), extended by 7.8:**
  - The admin-auth Edge Function sets `app_metadata.must_set_password` on `createUser` and `resetPassword`.
  - It gains exactly one operation, which clears the flag for the calling user only, after `auth.updateUser({ password })` succeeds. No caller can clear another account's flag.
  - A route guard keeps every surface closed while the flag is set. The flag lives in `app_metadata`, so it needs no migration.
  - The function still performs no domain calculation, and every domain write goes through the caller's JWT. 7.8 updates AD-16 and the claim-code deferred note in ARCHITECTURE-SPINE.md.
- **Migrations:** at most one in the whole epic. Check the main checkout for untracked migrations from parallel sessions before numbering one.
- **Filter state lives in the URL.** It survives month navigation and is never persisted across sessions.
- **Module boundaries:** pages compose features and hold no query, mutation or derivation of their own. A feature reaches another feature only through `FEATURE_PUBLIC`. Do not add `index.ts` barrels.

## UX & Interaction Patterns

- **Facts plus dialogs:** day detail, the member page, Ljudi and Organizacija read as facts. Each change opens its own small dialog with one Save and a computed *Što se mijenja* before saving. A team change starts empty and never preselects a team.
- **Reuse the shipped patterns:** use the 7.4 month toolbar, the 7.5 filter chips with summary line and `Poništi filtre` (7.13's Ljudi status chip reuses them), and the 7.6 stacked rows for new tables (the 7.14 footer total and the 7.15 overview).
- **Neutral confirmations:** removal and deactivation ask one neutral question, giving a date and the consequence in numbers. `destructive` styling is reserved for unresolved conflicts, and destructive actions are never styled destructive.
- **Status feedback:** a status line is `Notice role="status"` and disappears on navigation. Do not use toasts or standing banners.
- **Empty states and counts:** say what is true, never "no results". A zero count is still shown, such as the *Neriješeni* count at zero.
- **Loading:** skeletons, not spinners. URL-derived controls render at once.
- **Navigation:** the phone bar has four tabs plus *Više*. The member directory is added to *Više*. *Povijest rotacije* sits behind a header button.
- **Croatian microcopy:** state facts, use numbers rather than adjectives, no exclamation marks, informal second person singular. Formats are `19:00–07:00` and `12.09.2026`. Never use *smjena* for a shift type.

## Cross-Story Dependencies

- 7.1–7.6 are done.
- 7.8 needs 7.7 and carries the AD-16 edit.
- 7.9 needs 7.5 and 5.4's helper. 7.16 needs 5.4. 7.17 needs 7.3.
- 7.12 and 7.13 need 7.11. 7.13, 7.14 and 7.15 need 7.6.
- 7.7, 7.10, 7.11 and 7.18 have no story prerequisites. Their PRD edits have already landed.
- Epic 7 rewrites shipped surfaces from 1.3/1.3b (sign-in), 1.4 (organization settings), 1.8 (roster), 2.4, 3.3–3.6 (calendar, day detail and overrides), 4.1b/4.2 (hours) and 5.1/5.2 (leave). Expect churn in unit tests and e2e page objects, including sign-in helpers once sign-in becomes one form.
