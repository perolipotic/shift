# Epic 1 Context: An organization exists, and its people can sign in

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic stands up the first real tenant end to end. An operator provisions an organization together with its first admin. That admin configures identity, timezone, locale, leave year and branding, creates teams of any count, and issues credentials, including to people with no email address. Every member then signs in, reaches only their own organization's data at their own permission level, and can see who is on a team. The project is greenfield, so the foundations are built here once and every later epic inherits them: the workspace scaffold, the deployment path, the isolation and role pattern that every later table copies, attribution defaults, the versioning mechanism, the theme layer and the localization layer. When the epic is done there is a complete, secured, populated tenant with no schedule yet.

## Stories

- Story 1.1: A deployable shell that speaks Croatian in both themes
- Story 1.2: An operator provisions an organization that is born with an admin
- Story 1.3: Signing in reaches exactly one organization at exactly one role
- Story 1.4: An admin configures the organization's identity, localization and branding
- Story 1.5: An admin creates and edits members and works the list at scale
- Story 1.6: Deactivating a member changes the future and rewrites no history
- Story 1.7: An admin creates teams and moves people between them
- Story 1.8: A member sees who is on a team

## Requirements & Constraints

- **The database enforces isolation and role, not the interface.** A cross-tenant read with a valid session fails closed. An administrative write from a member-role account is refused the same way through the UI and through a direct API call. Every organization-scoped row carries its organization reference, and no path can create one without it. Later epics re-run these assertions.
- **An organization can never have zero admins.** The database refuses any delete or downgrade of the last admin.
- **Accounts work without email.** Sign-in uses an admin-issued username. Password reset is an admin action. No phone number is collected anywhere.
- **Personal data is limited** to name, optional email, team, hours and leave. There is no health data and no absence-reason field.
- **History is never rewritten.** Deactivation and team moves change the future only. Asking for status or team at an earlier date still returns the earlier answer. A team that any record references is archived, not deleted, and stays readable. A member with no team has an empty schedule, and the surface says so in words.
- **The organization is the frame of reference.** Every date and time renders in the organization's timezone, never the device's. Organization Type has no effect: two organizations that differ only in type produce byte-identical output. Only members of the owning organization can read its branding assets. An organization with no logo gets a neutral fallback. Leave allowance is set per member, and no organization-wide constant exists.
- **Scale and layout:** the member list stays usable at several hundred members, with search, sort and filter. No page scrolls horizontally at phone width; wide content scrolls inside its own container. The product is responsive web only, and every admin task must also be possible on a phone.
- **Testing:** every rule has at least one assertion that runs without a browser (Vitest, node environment), against two fixtures: the pilot and the structurally different security organization.

## Technical Decisions

- **Workspace (authored directly, no generated starter):** `packages/domain` is pure TypeScript with zero runtime dependencies, and importing React or Supabase from it fails the build. `apps/web` is a Vite + React static SPA with no SSR. `supabase/` holds forward-only `migrations/`, a `seed.sql` with both fixtures, and `functions/admin-auth/`. Migrations are promoted local → staging → production and are never edited after promotion.
- **No server tier:** every domain write is a direct PostgREST call under RLS. A rule that cannot be declarative goes back to the architecture; it does not become a new function.
- **One privileged auth boundary:** exactly one Edge Function holds the secret key (`sb_secret_*`). It exposes only `createUser`, `updateUserById` and `resetPassword`. Before each call it checks against the database, not the request, that the caller is an admin of the target member's own organization. It performs no domain calculation and holds two clients: the secret key is used for the auth call only, and a client built from the caller's JWT makes every domain-table write, including the `members` row, so RLS and attribution still apply. The SPA ships only the publishable key. Legacy `anon`/`service_role` keys are not used.
- **Provisioning is an operator CLI task.** It creates the organization and its first admin in one transaction. It is the only write that does not use the function and the only write exempt from attribution.
- **Deactivation does not go through the auth function.** Active status is a versioned domain table written through PostgREST under RLS, like any other domain write. A status change is an inserted version. A version not yet in effect can be cancelled by deleting it. A version already in effect is never changed or deleted. Data access ends on the effective date, because the RLS helper reads the version that covers *today in the organization's timezone*. Sign-in and token refresh end because the custom access token hook refuses a member who is inactive today. There is no ban/unban and no write to the auth store. A token minted before the effective date still authenticates to GoTrue's own endpoints until it expires, but it reads no organization data.
- **Access-control pattern:** `organization_id` comes from a JWT claim set by the custom access token hook. This is safe only because each user belongs to exactly one organization. Role and active status are read fresh on every policy evaluation through a `SECURITY DEFINER STABLE` helper, so a demotion takes effect on the account's next query.
- **Schema rules:** illegal states are made unrepresentable by schema shape rather than caught by validation. The zero-admins constraint trigger is the only trigger allowed. Team membership and member active status are versioned: each change is a new row with a validity range, never an in-place update, and derivation selects the version for the date asked. Leave allowance and shift-type names are current-state. Nothing derived is stored, so there are no shifts, roster or conflicts tables.
- **Attribution:** `created_by uuid default auth.uid()` and `created_at timestamptz default now()`, with `WITH CHECK (created_by = auth.uid())`. There is no audit-log UI.
- **Conventions:** database names are `snake_case`, with plural tables and singular columns. Keys are `uuid`s generated by the database. `organization_id` is the first column of every organization-scoped table. TypeScript uses `camelCase` values and `PascalCase` types. Domain terms match the glossary exactly, and a synonym is a contract violation. Dates use `date`, times use `time` without zone, clock arithmetic uses integer minutes, and `timestamptz` appears only in `created_at`. Errors are `{ code, ...operands }`, with stable `SCREAMING_SNAKE` codes translated only at the edge. Each surface reads one snapshot under a single query key, and a write invalidates only that key.
- **Stack:** React 19.2.8, TypeScript 7.0.2, Vite 8.2.2, Tailwind 4.3.3, shadcn/ui, TanStack Router 1.170.32 / Query 5.102.8 / Table 9.2.4, supabase-js 2.113.0, i18next 26.4.1. TypeScript 7 has no stable programmatic API until 7.1, which blocks typed linting. The fallback is pinning TypeScript 5.x.

## UX & Interaction Patterns

- **Theme:** the theme is a shadcn token delta in OKLCH, defined for both light and dark: `primary`, `destructive`, a six-slot working-shift ramp plus a non-working slot, and four modifier signals. The theme follows `prefers-color-scheme` only. There is no toggle, no setting and no stored preference. No `shift-day`/`shift-night` token may exist.
- **`destructive` is reserved for unresolved conflicts.** It is never used for a delete button, a validation error or a brand accent, even though the pilot's brand colour is red. Destructive actions use neutral styling and one confirmation step. An organization's accent tints only the app shell and the logo lockup.
- **Navigation:** the same information architecture has two layouts: bottom tabs on mobile and a sidebar on desktop. Member-role accounts reach four destinations (Danas, Kalendar, Sati, Godišnji) and no configuration surface. Admins also get grouped configuration: Raspored, Ljudi, Postavke rotacije, Organizacija, Sati. The roster is not a top-level destination. It lives inside team detail, is read-only, and shows names and membership only.
- **Localization:** components contain no user-facing literals, and a violation blocks the merge. One formatting layer produces every date, number and plural, including Croatian's three plural forms; a `count === 1` check is a defect. A missing key degrades visibly and safely. `Smjena` = Team and `Tip smjene` = Shift Type; never use *smjena* for a shift type. Names that admins enter are data, and no code may branch on them.
- **Voice:** state the fact, not the absence, and show a zero count rather than hiding it. Use numbers, not adjectives. No exclamation marks. Address the user in the informal second person singular. Write times as `19:00–07:00` with an en dash and dates as `12.09.2026`. A refused save names the problem and keeps every value the user entered. The typeface must render **č ć ž š đ Č Ć Ž Đ Š** without fallback. Use tabular numerals, 44 px tap targets, and never convey meaning by colour alone. Target WCAG 2.1 AA.

## Cross-Story Dependencies

- 1.1 comes before every other story: scaffold, deploy path, theme and i18n.
- 1.2 comes before 1.3: a tenant with an admin must exist before anyone can sign in.
- 1.3's isolation and role pattern, including the access token hook and the RLS helper, underlies 1.4–1.8. Its security tests become the regression suite for later epics.
- 1.5 routes member create, update and password reset through the auth function. 1.6 deliberately does not use it; it extends the access token hook and the RLS helper so they read the active-status version for today.
- 1.6 and 1.7 share one versioning mechanism, so build it once. Their "no past record altered" guarantees get re-asserted as shifts, hours and leave arrive in later epics.
- 1.7 comes before 1.8. The teams from 1.7 are what Epic 2's rotation projects onto: any count, moves forward only, archived rather than deleted.
