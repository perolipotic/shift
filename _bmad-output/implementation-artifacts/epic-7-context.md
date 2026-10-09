# Epic 7 Context: The app is calm on every screen

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Every shipped screen should read calm, minimal and simple on a phone (390 px) and on a desktop, in both themes. A pilot user finds each answer at a glance and makes each change behind one Save. The epic fixes defects measured in the 2026-10-01 UX review and rewrites already-shipped surfaces through new stories. It rolls no completed story back. It also adds four small capabilities: a first-sign-in password, an explanation for any hours figure, an admin leave overview and a list of resolved conflicts. **Status:** 7.1–7.12, 7.14, 7.16 and 7.18 have shipped. 7.13 was split into three parts: 7.13a (status chip and Status column) has shipped, 7.13b (the add-member dialog) is in progress, and 7.13c (deactivation consequence in numbers) is a deferred entry. 7.15 and 7.17 remain. The reference design is the approved mockups in `ux-designs/ux-shift-2026-10-01-redesign/mockups/` (for the remaining work, `people-1` and `leave-1`) and the 27 decisions in that folder's README. Where a mockup and an epic criterion disagree, the criterion wins.

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
  - no horizontal page scroll at phone width;
  - no information shown by colour alone;
  - keyboard operable, with meaningful labels for assistive technology;
  - WCAG 2.1 AA in both themes;
  - all copy in i18n, with Croatian's three plural forms.
- **Figures agree everywhere.** Hour and leave figures match on every surface at a given moment. A row in any overview equals that member's own view.
- **Add a member (7.13b):** `Novi član` / *Dodaj osobu* opens a short dialog on Ljudi (`/ljudi?dodaj=1`), which replaces the `/ljudi/novi` page. The route stays as a guarded redirect to `/ljudi?dodaj=1`, so an old link still opens the dialog.
  - The dialog asks for no team; the team is set on the member page. The username is suggested from the name, and the e-mail field stays.
  - It ends inside the same dialog by showing the four-word password once, with `Kopiraj`. It then offers *Dodaj još jednu* and *Otvori stranicu osobe*. The second needs the `memberId` that `createUser` already returns.
- **Deactivation (7.13c):** offered only on the member page, never from Ljudi. It is one neutral question with a date and the consequence in numbers, computed from the domain roster. The action button repeats the date.
- **Admin leave overview (7.15):** an admin on *Godišnji* sees every member's allowance, days used and balance for the leave year. Allowance − used = balance on every row, and each row equals that member's own view. A member-role account is refused at the data layer and sees only their own leave.
- **Member directory (7.17):** a member reaches it from *Više*. It is grouped by team and read-only. It shows name and team, plus rank and position where the organization uses them. It never shows allowance, balance, leave, hours or contact details. This replaces "the roster lives only inside team detail".
- **Keep shipped behaviour intact:**
  - Sign-in reveals nothing before authentication and has one generic error (7.7).
  - The set-password guard stays (7.8).
  - A member's calendar shows no conflict mark or uncovered mark (7.10).
  - *Neriješeni* stays the default tab and shows its count at zero (7.16).
- **Docs in the same PR:** every story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes. Binding docs never describe unbuilt UI.

## Technical Decisions

- **The domain returns codes and operands, never prose.** This covers equations, previews, consequences and empty-state facts. The i18n layer translates them.
- **One snapshot per surface.** Every figure on a screen comes from one composite read under one query key. There are no optimistic updates for hours, leave balance or conflict state. A write invalidates its surface and every dependent key.
- **One canonical calculation.** A preview or consequence reuses the domain function, such as the collision rule, `memberStatusOf`, `rosterOn` / `shiftRoster` or the hours explanation. It never re-implements one.
- **One privileged auth boundary (AD-16).** A single Edge Function has four operations:
  - `createUser`, `updateUserById` and `resetPassword` are admin-only. Each is verified against the database for the target's own organization.
  - `clearMustSetPassword` acts only on the caller.
  - `createUser` and `resetPassword` set `app_metadata.must_set_password`.
  - The function does no domain calculation. Adding an operation or a function needs an architecture amendment.
- **Role and tenant enforcement stay in RLS.** A new org-wide read, such as the leave overview, must fail for member-role through the API, not only in the UI.
- **Migrations:** the epic allows at most one. Before you number one, check the main checkout for untracked migrations from parallel sessions.
- **Filter state lives only in the URL.** Ljudi uses `?trazi=&razina=&smjena=&status=&sort=`. A bad value falls back to its default.
- **Module boundaries:** pages compose features and hold no query, mutation or derivation of their own. A feature reaches another feature only through `FEATURE_PUBLIC`. Do not add `index.ts` barrels.

## UX & Interaction Patterns

- **Facts plus dialogs.** The reference implementations are the day detail (7.9), the member page (7.11, 7.12) and Organizacija (7.18). Each change opens its own dialog from its card's header button and has one final button, never styled `destructive`. Where a change moves figures, the dialog shows a computed *Što se mijenja* before the Save.
  - On refusal, the dialog keeps the entered values and shows `Notice role="alert"`.
  - On success, it closes, shows `Notice role="status"` and returns focus to its opener.
  - A change dialog cannot be dismissed while its write is in flight.
- **Reuse the shipped components:**
  - the 7.4 month toolbar;
  - the 7.5 filter chips, with their summary line, `Poništi filtre` and the phone `Filtri · N` sheet (generalised for Ljudi in 7.13a);
  - the 7.6 stacked rows below 640 px, built from `StackedList` / `StackedRow` with exactly one form in the DOM, a labelled value in every field and one `Poredano` control on a phone;
  - the 7.14 `TableFooter` total and the `CredentialLine` for a one-time password.
- **Neutral confirmations.** A removal or a deactivation asks one neutral question that gives a date and the consequence in numbers. `destructive` is reserved for unresolved conflicts.
- **Status feedback** uses a `Notice role="status"` line that is gone on navigation. Do not use toasts or standing banners.
- **Empty states** state what is true. Counts show at zero.
- **Loading** uses skeletons, never spinners. Controls derived from the URL render at once.
- **Navigation.** The phone bar has four tabs plus *Više*. The member directory goes in a member's *Više*. On a phone an admin reaches *Godišnji* under *Više* → *Pregled*.
- **Croatian microcopy:**
  - state facts, use numbers rather than adjectives, no exclamation marks, informal second person singular;
  - write times as `19:00–07:00` and dates as `12.09.2026`;
  - never decline a data name; it stands in apposition;
  - never use *smjena* for a shift type.

## Cross-Story Dependencies

- 7.13b and 7.13c build on 7.11's member page and dialog pattern, and on 7.13a's Ljudi.
- 7.13b turns `/ljudi/novi` into a guarded redirect to `/ljudi?dodaj=1`. Rewrite the route sweeps in `prijava.test.ts` and `router.test.ts`.
- 7.15 needs 7.6 (stacked rows) and FR-45a, which has landed.
- 7.17 needs 7.3 (*Više*) and the CAP-5 / FR-16 edit, which has landed.
- Epic 7 rewrites shipped surfaces, so expect churn in unit tests and e2e page objects (people, leave, base navigation).
