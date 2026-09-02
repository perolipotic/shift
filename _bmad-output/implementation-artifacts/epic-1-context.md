# Epic 1 Context: An organization exists, and its people can sign in

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Stand up the first real tenant end to end: an operator provisions an organization together with its first admin; that admin configures identity, timezone, locale, leave year and branding, creates teams of any count, and issues credentials — including to people with no email address; every member then signs in and reaches exactly their own organization's data at exactly their own permission level, and can see who is on a team. It is greenfield, so its foundations are built once here and inherited by everything after: the workspace scaffold, the deployment path, the isolation and role-enforcement pattern every later table copies, attribution defaults, the theme layer and the localization layer. It stands alone — a complete, secured, populated tenant with no schedule yet.

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

- **Isolation and role are enforced in the database, not the interface.** A cross-tenant read with a valid session fails closed; an administrative write by a member-role account is refused identically via UI and via direct API. Every organization-scoped row carries its organization reference and no path creates one without it. Both security assertions are written here and re-run by every later epic.
- **Never zero admins** — the last admin cannot be deleted or downgraded, refused by the database.
- **Identity without email** — accounts are usable with no email: sign-in by admin-issued username, password reset an admin action, no phone number collected anywhere.
- **Personal data floor** — name, optional email, team, hours, leave. No health data, no absence-reason field.
- **History is never rewritten** — deactivation and team moves change the future only; status or team as at an earlier date still returns the old answer. A referenced team is archived, not deleted, and stays readable.
- **The organization is the frame** — every date and time renders in the organization's timezone, never the device's. Organization Type is inert: two organizations differing only in type produce byte-identical output. Branding assets are readable only within the owning organization; no logo means a neutral fallback.
- **Scale and shape** — the member list stays usable at several hundred members with search, sort and filter. No horizontal page scroll at any width; wide content scrolls in its own container. Responsive web only, and every administrative task must also complete on a phone.
- **Test discipline** — every rule carries at least one assertion runnable without a browser, against two fixtures: the pilot organization and a structurally different security organization.

## Technical Decisions

**Workspace shape (Story 1.1, authored directly — no generated starter).** `packages/domain` — pure TypeScript, zero runtime dependencies, where importing React or the Supabase client fails the build rather than review; `apps/web` — Vite + React SPA (`routes/`, `surfaces/`, `components/`, `i18n/`, `supabase/`); `supabase/` with forward-only `migrations/`, a `seed.sql` carrying both fixtures, and `functions/admin-auth/`.

**No server tier.** Static SPA on a CDN, no SSR, no application server; clients write directly through PostgREST under RLS. Exactly one serverless function exists — the privileged auth boundary. Migrations are git files promoted local → staging → production, never edited after promotion.

**The privileged auth boundary.** One function holds the secret key and exposes only user creation, user update and ban/unban. It authorizes every call against the database (caller must be an admin of the target member's own organization), never against the request, and performs no domain calculation. It holds two clients: the secret key for the auth call only, the caller's JWT for every domain-table write, so RLS and attribution still apply. The SPA ships the publishable key only. Organization provisioning does not use it — that is an operator CLI task, and the one write in the system exempt from attribution because no admin exists yet.

**Access-control pattern every later table copies.** `organization_id` rides in a JWT claim, safe only because one user belongs to exactly one organization; role and active status are read fresh on every policy evaluation via a `SECURITY DEFINER STABLE` helper, so a demoted or deactivated account loses access on its next query rather than at token expiry.

**Data-model rules.** Attribution comes from column defaults the client cannot forge (`created_by default auth.uid()`, `created_at default now()`) plus a policy check on `created_by`; no audit-log interface in MVP. Illegal states are made unrepresentable by schema shape rather than validated, and the zero-admins rule is the single named exception and the only permitted constraint trigger. Team membership and member active status are versioned with validity ranges — a new row, never an in-place update — so derivation for a past date returns the past answer, while leave allowance is per member and current-state with no organization-wide constant anywhere. Nothing derived is persisted: rosters are computed, and no shifts, roster or conflicts tables exist.

**Conventions.** Database `snake_case`, plural tables, singular columns, database-generated `uuid` keys, `organization_id` first on every organization-scoped table. TypeScript `camelCase` values / `PascalCase` types, domain terms matching the glossary exactly — a synonym is a contract violation. Dates as `date`, times as `time` without zone, clock arithmetic in integer minutes, no `timestamptz` outside `created_at`. Errors and warnings are `{ code, ...operands }` with stable `SCREAMING_SNAKE` codes translated only at the edge. One snapshot per surface under a single query key, from one canonical organization-snapshot type surfaces narrow by selection — two figures on a screen never come from two reads.

**Stack, pinned and verified.** React 19.2.8, TypeScript 7.0.2, Vite 8.2.2, Tailwind 4.3.3, shadcn/ui, TanStack Router 1.170.32 / Query 5.102.8 / Table 9.2.4, supabase-js 2.113.0, i18next 26.4.1 with ICU messages, Vitest in the node environment (no jsdom). Known gap: TypeScript 7 has no stable programmatic API until 7.1, which affects typed linting; the fallback is pinning TypeScript 5.x.

## UX & Interaction Patterns

**Theme layer, built once here.** shadcn/ui is inherited wholesale and never restyled; only a brand delta is authored — `primary`, `destructive`, a six-slot working-shift ramp plus a non-working slot, and four modifier signals, each defined in both light and dark, in OKLCH. Ramp slots are assigned to shift types in creation order and the always-visible label carries the distinction, so no `shift-day`/`shift-night` token may ever exist. Both themes ship driven entirely by `prefers-color-scheme`: no toggle, no setting, nothing persisted, so no surface exists for one.

**`destructive` is reserved exclusively for an unresolved conflict** — not delete buttons, not validation errors, not a brand accent (the pilot is a fire department whose obvious accent is red). Ordinary destructive actions use neutral styling plus one confirmation step, never a colour-only signal. An organization's accent tints the application shell and logo lockup only.

**Information architecture, established here.** Bottom tabs on mobile, sidebar on desktop: two layouts, one architecture. Member-role reaches four destinations — Danas, Kalendar, Sati, Godišnji — and no configuration surface at all. Admin adds grouped configuration: Raspored, Ljudi, Postavke rotacije, Organizacija, Sati. The roster is not a top-level destination — it lives inside team detail, read-only, names and membership only, no write action reachable.

**Localization layer, built once here.** No user-facing literal in any component, merge-blocking; adding a language means a resource file and no component or logic change; the domain returns keys, codes and values only. One centralized locale-aware layer produces every date, time, number, month/day name and plural, including Croatian's three forms — a `count === 1` check is a defect. A missing key degrades visibly, never to a blank screen or crash. Terminology is binding: `Smjena` = Team, `Tip smjene` = Shift Type, never *smjena* for a shift type. Band, shift-type and team names are admin-entered data, never keys — no code may branch on such a name.

**Voice and floor.** State the fact, never the absence, and show a zero count rather than hiding it. Numbers not adjectives, no exclamation marks, second person singular informal, `19:00–07:00` with an en dash, `12.09.2026`; a refused save names the problem and keeps every entered value. Verify **č ć ž š đ Č Ć Ž Đ Š** coverage before any font substitution, tabular numerals where numbers align, 44 px tap targets, skeletons rather than spinners, no meaning by colour alone, keyboard and assistive-technology labels as definition-of-done, WCAG 2.1 AA target.

## Cross-Story Dependencies

- **1.1 gates everything** — workspace, deployment path, theme layer and i18n layer precede every other story here and every later epic.
- **1.2 before 1.3** — a tenant with an admin must exist before anyone can sign in; the zero-admins trigger and the organization-reference rule land with provisioning.
- **1.3 before 1.4–1.8** — the isolation and role pattern is what every subsequent read and write is written against, and its two security tests become the regression suite later epics re-run.
- **1.5 and 1.6 both route through the privileged auth function** — member create/update, and the deactivated-user sign-in block.
- **1.6 and 1.7 share one versioning mechanism** (active status, team membership) — build it once. Their "no past record altered" guarantees can only be fully asserted once shifts, hours and leave exist, so later epics re-assert preservation against their own records.
- **1.7 before 1.8**, and 1.7's teams are what Epic 2's rotation projects onto: arbitrary count, forward-only moves, archive-not-delete.
- **Downstream** — Epic 2 builds the domain package and both test fixtures on this scaffold and first assigns real shift types to the ramp slots defined here; Epic 3 adds the first attributable writes using these defaults.
