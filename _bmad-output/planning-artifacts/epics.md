---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
inputDocuments:
  - ../specs/spec-shift/SPEC.md
  - ../specs/spec-shift/glossary.md
  - ../specs/spec-shift/engine-rules.md
  - ../specs/spec-shift/localization.md
  - ../specs/spec-shift/quality-requirements.md
  - ../specs/spec-shift/experience-direction.md
  - architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md
  - ux-designs/ux-shift-2026-09-02/DESIGN.md
  - ux-designs/ux-shift-2026-09-02/EXPERIENCE.md
  - prds/prd-shift-2026-09-01/addendum.md
---

# shift - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for shift, decomposing the requirements from the SPEC package, the UX design contract, and the architecture spine into implementable stories.

**Requirements basis:** the SPEC package is canonical. `prd.md` is a fully-absorbed source and is deliberately not an input — it retains a retired rotation table, a pre-narrowing FR-16, and pre-architecture conflict framing. The PRD **addendum** is an adopted companion and is an input, for the pilot seed configuration and the epic seed.

## Requirements Inventory

### Functional Requirements

Capabilities from `SPEC.md`. Each is an independently reviewable slice; `engine-rules.md` holds the numbered behavioural detail each one must satisfy.

- **CAP-1** — Authenticated, tenant- and role-scoped access. Session scoped to one organization and one role; cross-tenant read fails at the data layer; administrative writes refused for member-role via UI *and* direct API; a usable account exists with no email, signing in by admin-issued username, its reset an admin action.
- **CAP-2** — Organization configuration and branding. Identity, timezone, locale, leave year, logo. All times display in organization timezone. Two organizations differing only in type produce byte-identical output. Logo unreadable across tenants.
- **CAP-3** — Configurable day/night boundary via Hour Bands. Bands partition 24h; gap or overlap refused; a band may cross midnight; moving a boundary recomputes band hours and changes no total; three bands report three figures with no code change.
- **CAP-4** — Member management. Create, edit, activate, deactivate with role, team, allowance; search/sort/filter at scale. Deactivation preserves history, blocks authentication, removes from future rosters, alters no past shift. Allowance is per member. Never zero admins. Where the organization uses fire ranks, a member carries an optional rank (current-state).
- **CAP-5** — Team roster visibility. Names and team membership — and, where the organization uses them, rank and team position; no allowance, balance, leave, hours or contact details. No write action for member-role. Reached through team context, not a top-level destination.
- **CAP-6** — Teams of any number. Any count from one upward; no path assumes four; no name carries meaning. A member with no team has an empty schedule and generates no conflicts. A team move changes the schedule forward only. Where the organization uses them, a membership carries a team position, versioned with it.
- **CAP-7** — Configurable shift types including midnight-crossing. 19:00–07:00 has nominal duration 12h, one shift, attributed to its start date, never split or double-counted. 24-hour type valid. Duration derived, never entered. No field names or implies an hour band. Editing times changes no already-reported past hours; renaming takes effect everywhere.
- **CAP-8** — Rotation pattern definition and team assignment. Arbitrary cycle length; nothing assumes a week; deterministic for any date before or after the anchor; teams may share a pattern at the same or different offsets; an offset outside the cycle is refused at save.
- **CAP-9** — Rotation change with an effective date. Shifts before the effective date unchanged; overrides on or after listed for explicit confirm, amend or discard; attributable to an admin and a timestamp.
- **CAP-10** — Configuration warnings that inform rather than block. Coverage gaps, duplicate coverage, consecutive working shifts with no rest interval. No warning blocks a save. Rest-gap fires for the pilot by design. Refusals are reserved for unrepresentable state.
- **CAP-11** — Schedule projection and rosters. Arbitrary future dates with no generation run; repeated queries agree; with every override removed the schedule equals pure projection exactly; each working shift carries a roster.
- **CAP-12** — Schedule overrides as a separable exception layer. Pattern and assignment byte-identical before and after; replacing a member is one action recording both; removing an override restores projection and default roster exactly; an overridden date is identifiable without opening detail.
- **CAP-13** — Monthly calendar with team and member filters. Filters populated from live records; state survives month navigation and clears in one action; a midnight-crossing shift renders once on its start date with both clock times; unresolved conflicts visible without opening detail; no state by colour alone.
- **CAP-14** — Hours computed by band intersection. Band hours sum exactly to total; a straddling shift is split not rounded (19:00–07:00 with bands at 06:00/21:00 yields 3 day, 9 night); 12 hours on both DST transition dates; hours follow the roster; a member's figures reconcile exactly with the admin's view.
- **CAP-15** — Annual leave against a per-member allowance. Recording leave leaves every shift in place; cost visible before saving; overlapping range refused; allowance minus used equals balance at all times within the current leave year; deleting restores the balance.
- **CAP-16** — Leave/schedule conflicts resolved explicitly. A conflict exists for every affected working shift and stands until explicitly resolved; none expires or auto-clears; a configuration change that would remove a cause surfaces it for an explicit decision; detection alters no shift; non-working shifts raise nothing; exactly three resolutions, each attributable; resulting hours land as leave hours.
- **CAP-17** — Role-appropriate landing surfaces. Member: today's shift stated in words when not working, next working shift with both times, band hours and total, leave used and remaining, seven days ahead, usable at phone width with no horizontal scrolling. Admin: today's coverage for any team count, unresolved-conflict count shown even at zero and matching the list exactly. Every dashboard figure equals its detail view.

### NonFunctional Requirements

From `quality-requirements.md`.

- **Q1** Tenant isolation enforced at the database layer; a cross-tenant read with a valid session must fail closed.
- **Q2** Role enforcement at the same layer; administrative writes refused identically via UI or direct API. Needs its own policy design.
- **Q3** Every organization-scoped record carries its organization reference; no record reachable without it.
- **Q4** Uploaded branding assets readable only by members of the owning organization.
- **Q5** Personal data limited to name, optional email, team, hours, leave. No health data, no absence-reason field.
- **Q6** An organization can never be left with zero admins; the last admin's role cannot be downgraded.
- **Q7** Rotation projection, schedule generation, hour computation, leave-day counting and conflict detection are pure, framework-free, unit-testable; no React and no direct data-access dependency.
- **Q8** Exactly one canonical implementation of each domain calculation. A declarative database *constraint* is not a calculation; a database routine that *computes* a domain answer is.
- **Q9** Every constraint in SPEC.md and every rule in engine-rules.md has at least one automated assertion, executable without rendering a component or starting a browser.
- **Q10** Two configuration fixtures minimum: the pilot, and the UJ-5 security organization whose bands and shifts diverge.
- **Q11** Every override and conflict resolution records the acting admin, a timestamp and the affected records, outliving what it modified.
- **Q12** The data model supports reconstructing who changed a schedule entry and when. No audit-log interface in MVP.
- **Q13** Responsive web supporting mobile, tablet, desktop. No native application.
- **Q14** Members primarily on phones. Small-viewport priority: today's shift, next shift, calendar, hours, leave.
- **Q15** Admins primarily on desktop or tablet, with every administrative task also completable on mobile — degraded in comfort, never in capability.
- **Q16** No screen requires horizontal scrolling at phone width; wide content scrolls within its own container.
- **Q17** A monthly all-teams calendar renders within two seconds on a mid-range phone over typical mobile network, at the pilot's scale.
- **Q18** Navigating to any month, past or future, performs comparably whether or not that range has been visited.
- **Q19** Hour and leave figures consistent across every surface at a given moment; no screen shows a stale total beside a fresh one.
- **Q20** The member list remains usable at the pilot's scale and at several hundred members.
- **Q21** No information conveyed by colour alone; shift types, conflicts, uncovered, overridden and leave each carry a non-colour signal.
- **Q22** Calendar and both dashboards keyboard navigable, exposing meaningful labels to assistive technology.
- **Q23** WCAG 2.1 AA target, without formal audit in MVP.

**Localization contract** (`localization.md`) applies to every surface: no hard-coded user-facing string (L1, merge-blocking per L2); adding a language changes no component and no business logic (L3); domain returns keys, codes and values only (L4); a missing key degrades visibly and safely (L5); one centralized locale-aware formatting layer (L6); Croatian's three plural forms — an `count === 1` check is a defect (L7); every date and time in the organization timezone (L8). Terminology is settled: `Smjena` = Team, `Tip smjene` = Shift Type, `Sve smjene (N)` carries a count.

### Additional Requirements

From `ARCHITECTURE-SPINE.md`. Each `AD` governs stories rather than becoming one, except where noted as scaffold.

**Scaffold — belongs in Epic 1, Story 1.** The spine specifies no third-party starter template. It specifies the scaffold directly: a workspace with `packages/domain` (pure TypeScript, zero runtime dependencies), `apps/web` (Vite + React SPA), and `supabase/` (forward-only migrations, `seed.sql` carrying both fixtures). Story 1 creates that shape, not a generated starter.

- **AD-1** Nothing derived is ever persisted. No table may hold a value the domain package can compute.
- **AD-2** Every rule feeding derivation declares versioned or current-state. Versioned: rotation assignment, team membership, member active status, rotation pattern and steps, shift type *times*. Current-state: shift type *name*, hour bands, leave allowance.
- **AD-3** Illegal states unrepresentable, not validated: bands as name + start time; offset as an FK to a step of that pattern; leave overlap by `EXCLUDE USING gist` (requires `btree_gist`). Named exception: Q6 is a cross-row cardinality rule enforced by a constraint trigger — the only permitted trigger.
- **AD-4** A conflict is derived; only its resolution is stored, keyed by `(organization, member, date, team)`.
- **AD-5** A configuration change diffs the collision set before and after and surfaces what it would erase; the diff is bounded by existing leave ranges intersected with the change's validity range.
- **AD-6** Time is integer minutes since midnight over nominal wall-clock. No `Date`, no `timestamptz`, no instant in any calculation.
- **AD-7** One pure domain package that cannot reach for data; it is a leaf.
- **AD-8** The domain returns codes and operands, never prose.
- **AD-9** No server tier; clients write directly under RLS.
- **AD-10** RLS reads organization from a JWT claim (via a custom access token hook) and role plus active status fresh from a `SECURITY DEFINER STABLE` helper.
- **AD-11** Attribution from column defaults `auth.uid()` and `now()`, with `WITH CHECK (created_by = auth.uid())`.
- **AD-12** Identity is an admin-issued username mapped to a synthesized non-routable address.
- **AD-13** One snapshot per surface, under a single query key; one canonical `OrganizationSnapshot(window)` type that surfaces narrow by selection.
- **AD-14** No server runtime; a static SPA build.
- **AD-15** Every rule asserted without a browser, against both fixtures.
- **AD-16** One privileged auth boundary — a single Edge Function exposing only `createUser`, `updateUserById` and ban/unban, admin-authorized against the database, holding two clients (secret key for the auth call, caller's JWT for every domain write), performing no domain calculation. Organization provisioning is an operator CLI task and does not use it.
- **AD-17** The secret key (`sb_secret_*`) exists only in that function's environment, per environment; the SPA ships the publishable key only. Legacy `anon`/`service_role` keys are deprecated end of 2026 and unused.

**Environment and platform.** Local (Supabase CLI) → free-tier staging → production; migrations are files in git, forward-only, never edited after promotion. Stack pinned and verified 2026-09-02: React 19.2.8, TypeScript 7.0.2, Vite 8.2.2, Tailwind 4.3.3, TanStack Router 1.170.32 / Query 5.102.8 / Table 9.2.4, supabase-js 2.113.0, i18next 26.4.1, Vitest (node environment). Known gap: TypeScript 7 has no stable programmatic API until 7.1, affecting typed linting; fallback is pinning TypeScript 5.x.

### UX Design Requirements

From `DESIGN.md` (visual) and `EXPERIENCE.md` (behavioural). Both are binding and win over any mock.

**Design tokens and theme**
- **UX-DR1** Implement the 46-token colour layer as a shadcn theme delta: `primary`, `destructive`, the six-slot working-shift ramp plus `shift-nonworking`, and four modifier signals — each defined in *both* light and dark.
- **UX-DR2** Light and dark both ship, driven entirely by `prefers-color-scheme`. No in-app toggle, no theme setting, no persisted preference — so no surface exists for one.
- **UX-DR3** Convert DESIGN.md's hex tokens to the space shadcn now emits (OKLCH), and contrast-verify ramp slots 3–6 in both themes before any second organization uses them. Slots 3–6 are marked `[ASSUMPTION]` and unexercised by the pilot.
- **UX-DR4** `destructive` is reserved exclusively for an unresolved conflict — not delete buttons, not validation errors, not an organization's accent. Destructive actions use neutral styling plus a confirmation step.
- **UX-DR5** An organization's accent may tint the application shell and logo lockup only; never a shift state, a modifier, or `destructive`.
- **UX-DR6** Shift types are assigned ramp slots in creation order; beyond six a slot repeats and the always-visible label carries the distinction. No `shift-day` or `shift-night` token may exist.

**Domain components**
- **UX-DR7** `shift-cell` — base fill from the assigned slot, label always visible, time range shown when width allows and dropped rather than abbreviated, 30 px minimum height, tap opens day detail.
- **UX-DR8** `shift-cell` modifiers, composable on any base and on each other: conflict (inset 2 px `destructive` + `⚠`), overridden (inset 2 px + `✎`), leave (hatch + `◷`), uncovered (hatch + `◌`).
- **UX-DR9** `duty-block` — groups consecutive working shifts with no non-working interval into one duty; end time as headline, span and total as metadata, progress bar, one leg per constituent shift marked done or in progress. Presentation only; the data remains two scheduled shifts on two dates.
- **UX-DR10** `resolution-option` — radio-selection card, exactly one selected, no option primary-styled or labelled recommended, fixed order so muscle memory is possible.
- **UX-DR11** `consequence-strip` — three fixed terms in a fixed order on every resolution option: coverage, the absent member's hours, the leave balance.
- **UX-DR12** `state-glyph` — the fixed four-mark vocabulary with a persistent legend anywhere glyphs render. Not a tooltip, not behind an info icon.
- **UX-DR13** Hour Band editor — name and start time only, with window, duration and midnight-crossing derived and read-only; a 24-hour partition bar with any gap hatched and flagged.
- **UX-DR14** Pattern builder — ordered, reorderable, arbitrary length, the same shift type may repeat; cycle length, working steps and hours per cycle update live beneath it.
- **UX-DR15** Cycle preview — renders the next full cycle from pattern, offsets and anchor date before saving.
- **UX-DR16** Configuration stepper — four steps on phone (shift types, pattern, offsets, preview) with completed steps navigable backwards; one scrolling panel on tablet and desktop. Same data, same validations, same order.
- **UX-DR17** Hours table — tabular numerals, sortable and filterable by team and member, scrolling inside its own container.
- **UX-DR18** Calendar mode switch — segmented, two modes (*Moj raspored* default on mobile for member-role, *Sve smjene*), persisting across month navigation within a session.
- **UX-DR19** Team/member filter — populated from live records, never hard-coded; shows a count in its label; resets to all-teams in one action without leaving the calendar.

**State language**
- **UX-DR20** Empty states state what is true, never absence. A zero count is still shown — `0 nerješenih konflikata` — because hiding it is indistinguishable from not having loaded.
- **UX-DR21** Loading uses skeletons matching final layout for the calendar grid and tables; no spinners on primary surfaces. A visited and an unvisited month must feel the same.
- **UX-DR22** A refused save names the specific problem in hours and keeps every entered value.
- **UX-DR23** Warnings appear at save time with the consequence in numbers and never block, and never persist as standing banners.
- **UX-DR24** Overridden state is identifiable on the calendar and in a list without opening detail; detail names author, timestamp, reason and the projected value replaced.
- **UX-DR25** Past-but-unresolved conflicts stay in the queue, visually distinguished from upcoming ones.

**Interaction**
- **UX-DR26** 44 px minimum tap targets on touch, including calendar cells — which sets the real floor for grid density.
- **UX-DR27** One destructive confirmation step, never a colour-only signal.
- **UX-DR28** No bulk conflict resolution anywhere. Amending a leave record still clears every conflict it caused — cause-removal, not batching.
- **UX-DR29** No optimistic updates for hours, leave balance or conflict state.
- **UX-DR30** Month navigation symmetric and unbounded in both directions; no month unreachable or slower.

**Information architecture**
- **UX-DR31** Bottom tabs on mobile, sidebar on desktop — two layouts, one architecture. Member-role reaches four destinations (Danas, Kalendar, Sati, Godišnji) and no configuration surface at all.
- **UX-DR32** Admin sidebar adds grouped configuration: Raspored, Ljudi, Postavke rotacije, Organizacija, Sati.
- **UX-DR33** Build the 17 surfaces in the EXPERIENCE.md inventory; the member roster lives inside team detail, not as a top-level destination.

**Voice and localization**
- **UX-DR34** Croatian microcopy rules: state the fact not the absence; numbers not adjectives; no exclamation marks; second person singular informal; `19:00–07:00` with an en dash; `12.09.2026` date format.
- **UX-DR35** Three plural forms wherever a count renders — days, hours, shifts, conflicts, members, teams.
- **UX-DR36** Never say *smjena* for a shift type. `Sve smjene` carries a count and groups its options under a labelled heading.

**Accessibility**
- **UX-DR37** No information by colour alone anywhere — verified specifically in the compressed grid, status pips and badges, where the rule is most often broken.
- **UX-DR38** Keyboard navigation for the calendar grid, both dashboards, the conflict queue and the resolution screen, whose options are an arrow-navigable radio group.
- **UX-DR39** Assistive technology gets date, team, shift type, times and any modifier on every calendar cell — not a colour swatch, not a bare letter.
- **UX-DR40** Typography: verify Latin Extended-A coverage against **č ć ž š đ Č Ć Ž Đ Š** before any face substitution; tabular numerals wherever numbers align.

**Responsive**
- **UX-DR41** Phone (<640): *Moj raspored* day list by default, compressed grid one tap away with teams as one-letter columns. Tablet (640–1024): full grid with team names. Desktop (>1024): times visible in cells.
- **UX-DR42** The compressed grid is the same component as the full grid with a narrower column treatment, not a separate mobile calendar.
- **UX-DR43** Every administrative task completes on a phone; rotation configuration is the hardest case and the one to test first.

### FR Coverage Map

Capabilities are the functional requirements (see basis note above). Every capability maps to exactly one epic.

| Capability | Epic | Delivered as |
| --- | --- | --- |
| CAP-1 Authenticated, scoped access | Epic 1 | sign-in, username identity, RLS isolation and role |
| CAP-2 Organization config and branding | Epic 1 | identity, timezone, locale, leave year, logo |
| CAP-4 Member management | Epic 1 | create, edit, activate, deactivate, list at scale |
| CAP-5 Team roster visibility | Epic 1 | roster inside team context |
| CAP-6 Teams of any number | Epic 1 | teams, membership, forward-only moves |
| CAP-3 Configurable day/night boundary | Epic 2 | Hour Bands, stored so gaps are unrepresentable |
| CAP-7 Shift types incl. midnight-crossing | Epic 2 | shift types, versioned times, derived duration |
| CAP-8 Rotation pattern and assignment | Epic 2 | pattern builder, offsets, anchor date |
| CAP-9 Rotation change with effective date | Epic 2 | versioned assignments, override disposition |
| CAP-10 Warnings that inform | Epic 2 | coverage, duplicate coverage, rest gap |
| CAP-11 Schedule projection and rosters | Epic 2 | the projection function and cycle preview |
| CAP-12 Overrides as a separable layer | Epic 3 | shift-type and roster overrides |
| CAP-13 Monthly calendar with filters | Epic 3 | calendar in both modes, day detail |
| CAP-14 Hours by band intersection | Epic 4 | my hours, organization hours |
| CAP-15 Annual leave against allowance | Epic 5 | leave records, cost preview, balance |
| CAP-16 Conflicts resolved explicitly | Epic 5 | derived collisions, queue, three resolutions |
| CAP-17 Role-appropriate landing surfaces | Epic 6 | member and admin dashboards |

**Non-functional allocation.** Q1–Q3 and Q6 land in Epic 1 and are re-asserted by every epic that adds a table. Q7–Q10 land in Epic 2 with the domain package and both fixtures, and each later epic extends the suite. Q11–Q12 land in Epic 3 with the first attributable writes. Q13–Q16 and Q21–Q23 are definition-of-done on every epic with a surface. Q17–Q18 are proven in Epic 3, Q19 in Epic 6, Q20 in Epic 1. The localization contract L1–L8 is definition-of-done everywhere.

**UX design requirement allocation.** UX-DR1–2, 4–5, 31–32, 34, 40 land in Epic 1 — the theme layer and the i18n layer are built once, first. UX-DR3, 6, 13–16, 23, 35, 43 land in Epic 2, including the ramp-slot contrast verification, which belongs where shift types are first assigned to slots. UX-DR7–8, 12, 18–21, 24, 26, 30, 33, 36–39, 41–42 land in Epic 3 with the calendar, skeleton loading included. UX-DR17, 29 land in Epic 4. UX-DR10–11, 22, 25, 27–28 land in Epic 5. UX-DR9 (duty-block) lands in Epic 6.

## Epic List

Six epics. Each stands alone and enables the next without requiring it.

### Epic 1: An organization exists, and its people can sign in

An operator provisions an organization; an admin configures its identity, timezone, locale, leave year and branding, creates teams, and issues credentials — including to members who have no email address. Every member signs in and reaches exactly their own organization's data at exactly their own permission level, and can see who is on a team.

**Capabilities covered:** CAP-1, CAP-2, CAP-4, CAP-5, CAP-6
**Standalone:** a complete, secured, populated tenant. Nothing later is required for it to be useful or correct.
**Implementation notes:** carries the scaffold (Story 1.1), the RLS pattern of AD-10 that every later table follows, attribution defaults (AD-11), the theme layer and the i18n formatting layer. The cross-tenant read test of Q1 and the direct-API refusal test of Q2 are written here and re-run by every subsequent epic.

### Epic 2: The rota is defined once, and projects itself

An admin defines the organization's hour bands, its shift types — including one that crosses midnight — and a repeating rotation of arbitrary length, then binds each team to it at an offset from a shared anchor date. Before saving they see the next full cycle rendered from their own configuration, and the coverage and rest-gap consequences stated in numbers. After saving, the shift for any team on any date, past or future, is answerable.

**Capabilities covered:** CAP-3, CAP-7, CAP-8, CAP-9, CAP-10, CAP-11
**Standalone:** the cycle preview makes the configuration verifiable without a calendar. This is UJ-1's climax and the product's critical path.
**Implementation notes:** the domain package begins here — `projection`, `duration`, `bands`, `warnings` — as does the browser-free test suite and both fixtures (Q9, Q10, AD-15). Versioning (AD-2) is established here and every later versioned entity follows the pattern. Rotation configuration is the hardest surface to fit on a phone (UX-DR43), so it is the one to build against a 390 px viewport first.

### Epic 3: Anyone can read the schedule, and an admin can record what actually happened

Any member opens a month and reads it — their own schedule or every team's — filtered, with midnight-crossing shifts rendered once on their start date. An admin changes a team's shift type on a date, or adds, removes or replaces a member on a specific shift, and the record shows who changed it, when, why, and what it replaced — without the rotation itself being touched.

**Capabilities covered:** CAP-12, CAP-13
**Standalone:** the schedule becomes readable and correctable. Proves AD-1 in the strongest available way — remove every override and the schedule must equal the pure projection exactly.
**Implementation notes:** first surface under AD-13's one-snapshot rule, so `OrganizationSnapshot` is defined here and later epics extend it. Q17's two-second budget and Q18's any-month parity are measured here on the pilot fixture.

### Epic 4: Hours compute themselves

A member sees their shift counts, hours per band, total and leave hours for a period. An admin sees the same for everyone, sortable and filterable. Nobody enters or reconciles an hour by hand, and a member's own figures reconcile exactly with the admin's view of them.

**Capabilities covered:** CAP-14
**Standalone:** closes the month, which is one of the three failures the product exists to fix.
**Implementation notes:** `domain/hours` — band intersection over nominal wall-clock (AD-6), so both DST transition dates are assertions, not hopes. The UJ-5 security fixture finally earns its keep here: the pilot's bands coincide with its changeovers and never split a shift, so this is the epic the second fixture exists for.

### Epic 5: Leave is recorded, and every collision is surfaced and decided

An admin records a member's leave as a date range and sees its cost before saving. Every working shift the member was rostered for becomes a visible conflict that stands until a human decides it — accept as uncovered, replace the member, or amend the leave — each decision attributable, each taken on its own screen with its consequences stated in the same three terms.

**Capabilities covered:** CAP-15, CAP-16
**Standalone:** the product's distinguishing stance, end to end.
**Implementation notes:** `domain/leave` and `domain/collisions`. Conflicts are derived, so the AD-5 before/after diff is built here and retro-applies to Epic 2's configuration saves — the one place a later epic adds a guard to an earlier epic's surface, and worth sequencing as the final story. Leave-day counting is the open product question; the function is isolated so the answer changes one implementation and no schema.

### Epic 6: Each role lands on the answer to its standing question

A member opens the app and knows whether they are working today — stated in words when they are not — when they next work, how many hours they have done and how much leave remains, without tapping anything. An admin sees today's coverage and the count of conflicts awaiting them, shown even when it is zero.

**Capabilities covered:** CAP-17
**Standalone:** every figure it shows already exists; this epic is where they must all agree.
**Implementation notes:** where Q19 is proven — every dashboard figure equals its detail view, guaranteed by AD-13 rather than by checking. Carries `duty-block` (UX-DR9), the subtlest component in the set: it presents a 24-hour duty spanning two dates as one card while the data stays two scheduled shifts on two dates.


---

## Epic 1: An organization exists, and its people can sign in

An operator provisions an organization; an admin configures its identity, timezone, locale, leave year and branding, creates teams, and issues credentials — including to members who have no email address. Every member signs in and reaches exactly their own organization's data at exactly their own permission level, and can see who is on a team.

**Capabilities:** CAP-1, CAP-2, CAP-4, CAP-5, CAP-6 · **Governed by:** AD-3, AD-9, AD-10, AD-11, AD-12, AD-14 · **Proves:** Q1, Q2, Q3, Q5, Q6, Q20 · **UX:** UX-DR1–6, 31–32, 34–36, 40

### Story 1.1: A deployable shell that speaks Croatian in both themes

As an admin,
I want to reach a working sign-in screen at a real URL,
So that there is something real to sign in to before any of my organization's data exists.

**Acceptance Criteria:**

**Given** a clean checkout
**When** the workspace is installed and built
**Then** it contains `packages/domain` (pure TypeScript, zero runtime dependencies, no React and no Supabase import), `apps/web`, and `supabase/` with a forward-only `migrations/` directory and a `seed.sql`
**And** an import of React or the Supabase client from inside `packages/domain` fails the build, not review

**Given** the built application
**When** it is deployed to the static host
**Then** it serves as a static SPA with no server runtime and no SSR; exactly one Edge Function exists, the privileged auth boundary (AD-14, AD-16)
**And** the bundle contains the publishable key only, with the secret key present in no client asset, committed file or migration (AD-17)
**And** it is a responsive web application supporting mobile, tablet and desktop, with no native application in scope (Q13)
**And** the local → staging → production migration path is exercised once end to end

**Given** a viewer whose system theme is dark, and one whose is light, and one who has stamped an explicit choice
**When** each opens the sign-in screen
**Then** the palette resolves correctly for all three, from the token layer defined in `DESIGN.md` (UX-DR1, UX-DR2)
**And** no in-app theme toggle exists anywhere, because no theme setting exists

**Given** the sign-in screen
**When** its text is inspected
**Then** every user-facing string resolves through a translation key with no literal in any component (L1)
**And** the rendering face covers **č ć ž š đ Č Ć Ž Đ Š** without falling back mid-word (UX-DR40)

### Story 1.2: An operator provisions an organization that is born with an admin

As an operator,
I want to provision a new organization together with its first admin,
So that a tenant exists that someone can actually get into.

**Acceptance Criteria:**

**Given** no organization exists
**When** the operator provisions one, supplying the first admin's name and credentials
**Then** the organization and that admin are created in a single transaction by an operator CLI task outside the application, not through a product surface (AD-16)
**And** this is the single write in the system exempt from AD-11's attribution, because no admin yet exists to attribute it to
**And** an attempt to provision an organization without an admin is refused (Q6)

**Given** an existing organization with exactly one admin
**When** anyone attempts to delete that admin or downgrade their role to member
**Then** the write is refused by the database, not by the interface (Q6, AD-3 named exception)
**And** the refusal is the only constraint trigger in the schema

**Given** any organization-scoped row
**When** it is created
**Then** it carries its organization reference, and no path exists to create one without it (Q3)

### Story 1.3: Signing in reaches exactly one organization at exactly one role

As a member,
I want to sign in with the credentials my admin gave me,
So that I reach my own organization's data and nothing else.

**Acceptance Criteria:**

**Given** a member whose account has no email address
**When** they sign in with their admin-issued username and password
**Then** the username resolves to the synthesized non-routable address and the sign-in succeeds (AD-12, CAP-1)
**And** no phone number was collected at any point (Q5)

**Given** a valid session for organization A
**When** a read for organization B's data is issued, including by a direct API call bypassing the interface
**Then** it fails closed at the database layer (Q1)
**And** the test asserting this runs without a browser (Q9)

**Given** a valid session held by a member-role account
**When** an administrative write is attempted through the interface and again as a direct API call
**Then** both are refused identically (Q2)

**Given** a signed-in admin whose role is downgraded to member, or whose account is deactivated
**When** they issue their very next query on the existing session
**Then** the new role is already in force, because role and active status are read fresh rather than from the token (AD-10)
**And** the organization is read from the JWT claim, which is safe only because one user belongs to exactly one organization

### Story 1.4: An admin configures the organization's identity, localization and branding

As an admin,
I want to set my organization's name, type, timezone, locale, leave year and logo,
So that every date, time and calculation resolves against my organization rather than a default.

**Acceptance Criteria:**

**Given** an organization whose timezone is Europe/Zagreb and a viewer whose device is in another timezone
**When** any date or time is displayed
**Then** it renders in the organization's timezone, never the device's (CAP-2, L8)

**Given** two organizations identical except for their Organization Type
**When** their schedules, hours and conflicts are produced
**Then** the output is byte-identical, because type is inert (CAP-2)

**Given** an organization with no logo, and one with a logo uploaded
**When** each is viewed
**Then** the first renders a neutral fallback, and the second's asset is unreadable to any member of another organization (Q4)
**And** the organization's accent tints the application shell and logo lockup only — never a shift state, a modifier, or `destructive` (UX-DR5)

**Given** an organization whose brand colour is red — as the pilot fire department's is
**When** any surface renders
**Then** `destructive` remains reserved exclusively for an unresolved conflict, appearing on no delete button, no validation error and no brand accent (UX-DR4)
**And** the conflict signal stays distinguishable because it also carries a glyph and a border

### Story 1.5: An admin creates and edits members and works the list at scale

As an admin,
I want to create members with a role and a leave allowance and find them quickly,
So that I can issue credentials to everyone in my organization.

**Acceptance Criteria:**

**Given** the member form
**When** an admin creates a member with no email address
**Then** the account is usable and its password reset is an admin-issued action rather than a self-service email (CAP-1, AD-12)
**And** the auth account is created through the single privileged auth function, which uses the secret key for the auth call only and the calling admin's JWT for the `members` row, so RLS and attribution still apply (AD-16, AD-17, AD-11)
**And** the function refuses the call unless the caller is an admin of the target member's own organization, verified against the database rather than the request

**Given** several members with different allowances
**When** their records are read
**Then** each allowance is per member, with no organization-wide constant anywhere in the model (CAP-4)

**Given** an organization with several hundred members
**When** an admin searches, sorts and filters the list
**Then** the list remains usable (Q20)
**And** the table scrolls inside its own container, with no horizontal page scroll at phone width (Q16)

**Given** any member record
**When** its fields are inspected
**Then** they carry only name, optional email, team, hours and leave — no health data and no absence-reason field (Q5)

### Story 1.6: Deactivating a member changes the future and rewrites no history

As an admin,
I want to deactivate someone who has left,
So that they stop appearing on future rosters without any record of what they already did being altered.

**Acceptance Criteria:**

**Given** an active member
**When** they are deactivated with effect from a date
**Then** their active status is written as a new version with a validity range rather than a field being flipped, and no existing row is updated in place (AD-2)
**And** asking for their status as at any earlier date returns *active*, which is the mechanism by which no past roster can later be altered
**And** every record referencing them is preserved; as shifts, hours and leave records come to exist in later epics, this preservation is re-asserted against each (CAP-4)

**Given** a deactivated member
**When** they attempt to sign in
**Then** authentication is blocked, via the privileged auth function (AD-16)
**And** they are absent from every future roster

**Given** a deactivated member who is later reactivated
**When** rosters are derived across the whole period
**Then** the gap appears in the future rosters covered by the deactivation and nowhere else

### Story 1.7: An admin creates teams and moves people between them

As an admin,
I want to create teams of any number and assign each member to at most one,
So that the rotation has something to project onto.

**Acceptance Criteria:**

**Given** a fresh organization
**When** an admin creates one team, then four, then nine
**Then** all counts work identically, no code path assumes four, and no team name carries special meaning (CAP-6, DI-8)

**Given** a member on team A with history on that team
**When** they are moved to team B with effect from a chosen date
**Then** their schedule changes from that date forward only, and their history on team A is unchanged (CAP-6)
**And** team membership is stored as a versioned value, so roster derivation for a past date returns team A (AD-2)

**Given** a member with no team
**When** their schedule is derived
**Then** it is empty, they generate no conflicts, and the surface says so in words rather than showing a blank area (UX-DR20)

**Given** a team that has been referenced by any record
**When** an admin removes it
**Then** it is archived rather than deleted and remains readable, so that once schedules exist no derivation can encounter a missing team (engine-rules R7.6)

### Story 1.8: A member sees who is on a team

As a member,
I want to see who else is on a team,
So that I know who I am working with.

**Acceptance Criteria:**

**Given** a signed-in member-role account
**When** they open a team's detail from their own dashboard, schedule or the calendar
**Then** they see member names and team membership, and no allowance, balance, leave record, hours or contact detail for anyone (CAP-5)
**And** no write action is reachable from that surface

**Given** the navigation
**When** a member-role account looks for the roster
**Then** it is not a top-level destination — it lives inside team context (CAP-5, UX-DR33)
**And** no configuration surface is reachable at all for that role (UX-DR31)

**Given** a signed-in admin
**When** they open the navigation
**Then** it carries the same four destinations plus grouped configuration — Raspored, Ljudi, Postavke rotacije, Organizacija, Sati (UX-DR32)
**And** the shape is bottom tabs on mobile and a sidebar on desktop: two layouts, one information architecture (UX-DR31)


### Story 1.9: An organization that uses fire ranks records each member's rank and team position (delivered 2026-09-25, sprint change)

As an admin of an organization that uses fire ranks,
I want to record each member's rank and their position in the team,
So that everyone can see who commands and who drives.

Added retroactively by `sprint-change-proposal-2026-09-25.md`; delivered in #43 (`spec-member-rank.md`) and #45 (`spec-team-position.md`). Governed by PRD FR-18a, a bounded exception to §6.

**Acceptance Criteria (as delivered):**

**Given** the organization's fire ranks and positions setting off
**When** any screen renders
**Then** no rank or position appears, and stored values survive

**Given** the setting on
**When** an admin creates or edits a member
**Then** a rank from the fixed list can be chosen, and an untouched stored rank is written back unchanged

**Given** a member on a team with the setting on
**When** their position changes from a date
**Then** it is a new membership version, withdrawable while scheduled, and rewrites no history (AD-2)

**Given** a team roster
**When** it is read by any role
**Then** each member shows `Ime · čin · položaj` where present (CAP-5)

**Given** any schedule, hours or conflict derivation
**When** ranks or positions change
**Then** the output is byte-identical (FR-18a)

---

## Epic 2: The rota is defined once, and projects itself

An admin defines the organization's hour bands, its shift types — including one that crosses midnight — and a repeating rotation of arbitrary length, then binds each team to it at an offset from a shared anchor date. Before saving they see the next full cycle rendered from their own configuration, and the coverage and rest-gap consequences stated in numbers. After saving, the shift for any team on any date, past or future, is answerable.

**Capabilities:** CAP-3, CAP-7, CAP-8, CAP-9, CAP-10, CAP-11 · **Governed by:** AD-1, AD-2, AD-3, AD-6, AD-7, AD-8, AD-15 · **Proves:** Q7, Q8, Q9, Q10 · **UX:** UX-DR3, 6, 13–16, 43

### Story 2.1: An admin defines the day's hour bands so a gap cannot be expressed

As an admin,
I want to define the named windows my hours are reported under,
So that day and night are my organization's setting rather than something baked into the product.

**Acceptance Criteria:**

**Given** the Hour Band editor
**When** an admin adds a band
**Then** they enter a name and a start time only, and the window, duration and midnight-crossing flag are derived and shown read-only (UX-DR13, AD-3)
**And** a configuration leaving a gap or an overlap cannot be entered, because start times alone cannot express one

**Given** two bands starting at 07:00 and 19:00
**When** the 24-hour partition bar renders
**Then** it shows the full day covered, with any uncovered region hatched and flagged
**And** the band starting at 19:00 is derived as crossing midnight

**Given** an organization that defines three bands rather than two
**When** hours are later reported
**Then** three figures are produced with no code change (CAP-3)

**Given** `packages/domain`
**When** the band module is added
**Then** it is pure, framework-free and asserted without a browser (Q7, Q9)
**And** both fixtures — the pilot and the UJ-5 security organization — are seeded in `supabase/seed.sql` (Q10)

### Story 2.2: An admin defines shift types, including one that crosses midnight

As an admin,
I want to define my organization's working and non-working periods by name and time,
So that the rotation has something to repeat.

**Acceptance Criteria:**

**Given** a shift type entered as 19:00–07:00
**When** it is saved
**Then** its nominal duration is derived as 12 hours, never entered (CAP-7)
**And** it produces exactly one scheduled shift, attributed to its start date, never split and never counted twice (DI-5)

**Given** a 24-hour shift type, and a non-working type with no times
**When** each is saved
**Then** both are valid

**Given** any shift type
**When** its fields are inspected
**Then** none names or implies an hour band, and no `shift-day` or `shift-night` token exists in the design layer (DI-8, UX-DR6)
**And** shift types take working-shift ramp slots in creation order, a slot repeating beyond six with the always-visible label carrying the distinction

**Given** shift types assigned to ramp slots 3–6, which the pilot never exercises
**When** they are used by a second organization
**Then** their contrast has been verified in both light and dark first (UX-DR3)

**Given** an admin who corrects a shift type's times
**When** past hours are re-read
**Then** they are unchanged, because times are versioned; a rename by contrast takes effect everywhere (AD-2, CAP-7)

### Story 2.3: An admin builds the rotation and sees the cycle before saving

As an admin,
I want to build a repeating pattern and place each team at its own offset,
So that the whole schedule is determined by a handful of records rather than typed in.

**Acceptance Criteria:**

**Given** the pattern builder
**When** an admin orders and reorders steps of arbitrary length, repeating a shift type where they want
**Then** cycle length, working steps and hours per cycle update live beneath it (UX-DR14)

**Given** a saved pattern and four teams each bound to it at an offset from a shared anchor date
**When** the shift type for any team on any date is requested
**Then** it is `pattern[(offset + daysBetween(anchor, date)) mod cycleLength]`, deterministic and repeatable (CAP-8, CAP-11)
**And** it resolves for dates **before** the anchor, using a true mathematical modulo rather than a language remainder that returns negatives (engine-rules R1.2)

**Given** an offset outside the cycle, or a pattern with no steps
**When** either is attempted
**Then** it cannot be expressed — an offset is a reference to a step of that pattern, and an empty pattern has no step to reference (AD-3, R1.5, R1.6)

**Given** a complete configuration not yet saved
**When** the admin asks to see it
**Then** the next full cycle renders from their own pattern, offsets and anchor date, so the configuration is judged by its output (UX-DR15)

**Given** the projection module
**When** it is inspected
**Then** it holds no React and no data-access dependency, is the only implementation of projection anywhere, and is asserted against both fixtures without a browser (AD-7, Q8, Q9, Q10)

### Story 2.4: Rotation configuration completes on a phone

As an admin,
I want to configure the whole rotation from my phone,
So that I am not required to find a desktop to run my organization.

**Acceptance Criteria:**

**Given** a viewport narrower than 640 px
**When** an admin opens rotation configuration
**Then** it presents as a four-step sequence — shift types, pattern, offsets, preview — with completed steps navigable backwards (UX-DR16)

**Given** a tablet or desktop viewport
**When** the same configuration is opened
**Then** it is one scrolling panel with no stepper, carrying the same data, the same validations and the same order

**Given** any width from 320 px upward
**When** every configuration surface in this epic is exercised
**Then** each task completes, degraded in comfort but never in capability (Q15, UX-DR43)
**And** no screen scrolls horizontally; wide content scrolls inside its own container (Q16)

### Story 2.5: Saving a rotation reports what it will actually do

As an admin,
I want to be told the consequences of the configuration I just built,
So that a mistake is caught immediately and a deliberate choice still saves.

**Acceptance Criteria:**

**Given** a configuration leaving a date with no working team, or two teams on the same working shift type
**When** it is saved
**Then** both a coverage gap and a duplicate-coverage warning are reported, and the save succeeds (CAP-10)
**And** no warning blocks a save, ever

**Given** the pilot's configuration, where a day shift is immediately followed by a night shift
**When** it is saved
**Then** a rest-gap warning reports 24 continuous hours, computed from nominal durations so it is stable across daylight-saving transitions (AD-6)
**And** it is not treated as a misconfiguration, because this rota is intentional

**Given** any warning produced by the domain
**When** it crosses the package boundary
**Then** it is data — `{ code: 'REST_GAP', hours: 24 }` — and the interface resolves it through the i18n layer (AD-8, L4)
**And** the rendered count respects Croatian's three plural forms (L7, UX-DR35)

**Given** a warning at save time
**When** the save completes
**Then** the warning does not persist as a standing banner (UX-DR23)

### Story 2.6: An admin changes the rotation from a date forward

As an admin,
I want to change the pattern or a team's offset from a chosen date,
So that a real change to how we work does not destroy the record of how we worked before.

**Acceptance Criteria:**

**Given** a rotation in use with history behind it
**When** an admin changes it with an effective date
**Then** every shift before that date is unchanged, because the change closes the current assignment version and opens a new one rather than editing in place (CAP-9, AD-2)

**Given** a rotation changed with an effective date
**When** any date before it is projected
**Then** it resolves through the prior assignment version, and any date on or after it resolves through the new one (AD-2, CAP-11)

**Given** the applied change
**When** it is inspected
**Then** it names the acting admin and a timestamp, from column defaults the client cannot forge (AD-11, Q11)

---

## Epic 3: Anyone can read the schedule, and an admin can record what actually happened

Any member opens a month and reads it — their own schedule or every team's — filtered, with midnight-crossing shifts rendered once on their start date. An admin changes a team's shift type on a date, or adds, removes or replaces a member on a specific shift, and the record shows who changed it, when, why, and what it replaced — without the rotation itself being touched.

**Capabilities:** CAP-12, CAP-13 · **Governed by:** AD-1, AD-11, AD-13 · **Proves:** Q11, Q12, Q17, Q18 · **UX:** UX-DR7–8, 12, 18–19, 21, 24, 26, 30, 37–39, 41–42

### Story 3.1: Anyone reads a month

As a member,
I want to open a month and see what is happening,
So that I can answer "who is on nights next Tuesday?" without asking anyone.

**Acceptance Criteria:**

**Given** any month, past or future, never visited before
**When** it is opened
**Then** it renders from projection plus the exception layer with no generation step, and performs comparably to a month already visited (CAP-11, Q18, AD-1)
**And** an all-teams month at the pilot's scale renders within two seconds on a mid-range phone over typical mobile network (Q17)

**Given** the surface
**When** it loads its data
**Then** it issues one composite read under a single query key, and every figure it shows derives from that one snapshot (AD-13)
**And** loading shows skeletons matching the final layout, not spinners (UX-DR21)

**Given** a 19:00–07:00 shift
**When** the month renders
**Then** it appears exactly once, on its start date, labelled with both clock times (CAP-13, DI-5)
**And** each cell carries its base fill from the assigned ramp slot with the label always visible, a minimum height of 30 px, and its time range shown when width allows and **dropped rather than abbreviated** when it does not (UX-DR7)

**Given** every override removed
**When** the schedule is derived
**Then** it equals the pure projection exactly (CAP-12, AD-1)

**Given** month navigation
**When** the admin or member moves backwards and forwards
**Then** it is symmetric and unbounded, with no month unreachable or slower (UX-DR30)

### Story 3.2: The month is readable on a phone, and by a screen reader

As a member,
I want the calendar to work on the phone in my pocket,
So that I can check the rota from the truck.

**Acceptance Criteria:**

**Given** a viewport under 640 px for a member-role account
**When** the calendar opens
**Then** it defaults to the day-list mode, with the compressed all-teams grid one tap away and teams as one-letter columns (UX-DR41)
**And** the compressed grid is the same component as the full grid with a narrower column treatment, not a separate mobile calendar (UX-DR42)

**Given** the modifier vocabulary — `⚠` conflict, `✎` overridden, `◷` leave, `◌` uncovered
**When** it is implemented as a fixed set with its fill treatments and inset rings
**Then** each mark is available to every surface, composable on any base cell and on each other (UX-DR8)
**And** a persistent legend renders wherever glyphs appear — not a tooltip, not behind an info icon (UX-DR12)

**Given** any shift state rendered by this epic, and every state added by a later one
**When** it appears anywhere, including the compressed grid, status pips and badges
**Then** it carries a glyph or fill treatment alongside its colour, never colour alone — asserted for each state as it lands (Q21, UX-DR37)

**Given** touch input
**When** any calendar cell is targeted
**Then** it presents at least a 44 px target (UX-DR26)

**Given** assistive technology
**When** it reaches a calendar cell
**Then** it is given date, team, shift type, times and any modifier — not a colour swatch and not a bare letter (Q22, UX-DR39)
**And** the calendar grid is keyboard navigable
**And** the surface meets WCAG 2.1 AA as the working target, without formal audit in MVP (Q23)

### Story 3.3: Filtering to one team or one person

As a member,
I want to narrow the month to a team or a person,
So that I see my own schedule rather than everyone's.

**Acceptance Criteria:**

**Given** the filter controls
**When** they are opened
**Then** their options are populated from actual records with no hard-coded entries, and the control shows a count in its label (CAP-13, UX-DR19)
**And** the all-teams option reads `Sve smjene (4)` with its options grouped under a labelled heading, because `Sve smjene` alone is ambiguous (UX-DR36)

**Given** an applied filter and mode
**When** the user navigates to another month
**Then** both survive the navigation within the session, and neither persists across sessions (UX-DR18)

**Given** any applied filter
**When** the user wants it gone
**Then** it clears in one action, reachable without leaving the calendar (CAP-13)

### Story 3.4: Opening a day to see who is actually on it

As a member,
I want to tap a day and see its detail,
So that I know who is working it, not just what shift it is.

**Acceptance Criteria:**

**Given** a working shift on a date
**When** its detail is opened
**Then** it shows the shift type, both clock times, and the roster derived from the team's active members as at that date modified by roster overrides (CAP-11, AD-2)

**Given** a member with no team
**When** their schedule is opened
**Then** it explains why it is empty rather than showing a blank area (UX-DR20)

### Story 3.5: An admin changes a team's shift type on one date

As an admin,
I want to record that a team worked something other than what the pattern says,
So that the schedule reflects what actually happened without me editing the rule.

**Acceptance Criteria:**

**Given** a rotation and a date
**When** an admin overrides that date's shift type for a team
**Then** the pattern and the assignment are byte-identical before and after (CAP-12, DI-2)

**Given** an overridden date
**When** the month renders
**Then** it is identifiable without opening a detail view, carrying the `✎` glyph and its inset ring (UX-DR8, UX-DR24)
**And** its detail names the author, the timestamp, the reason and the projected value it replaced (Q11, Q12)

**Given** an override
**When** it is removed
**Then** the projected value and default roster are restored exactly (CAP-12)

**Given** overrides recorded on or after a rotation change's effective date
**When** that change is applied
**Then** each is listed for explicit confirm, amend or discard — none silently dropped, and none silently reapplied to a shift it was not written for (CAP-9)
**And** this completes CAP-9, whose disposition half could not land in Epic 2 because no override existed to dispose of

### Story 3.6: An admin adds, removes or replaces someone on a shift

As an admin,
I want to record who actually covered a shift,
So that hours follow the people who worked rather than the people who were scheduled.

**Acceptance Criteria:**

**Given** a scheduled shift with its derived roster
**When** an admin replaces member A with member B
**Then** it is one action recording both the removed and the added member (CAP-12)

**Given** roster overrides on a shift
**When** they are removed
**Then** the default roster is restored exactly (CAP-12)

**Given** any roster override
**When** it is written
**Then** it carries author and timestamp from column defaults the client cannot forge, and that record outlives the schedule entry it modified (AD-11, Q11)

**Note (sprint change 2026-09-25):** where the organization uses fire ranks, candidates may be shown with rank and position — information only; nothing blocks, warns or suggests from them (FR-18a, §7.2).

---

## Epic 4: Hours compute themselves

A member sees their shift counts, hours per band, total and leave hours for a period. An admin sees the same for everyone, sortable and filterable. Nobody enters or reconciles an hour by hand, and a member's own figures reconcile exactly with the admin's view of them.

**Capabilities:** CAP-14 · **Governed by:** AD-6, AD-7, AD-13 · **Proves:** Q8, Q10, Q19 · **UX:** UX-DR17, 29

**Sequencing note.** This epic delivers worked hours in full. CAP-14's *leave hours* half needs leave records, which arrive in Epic 5 — so the column exists here and is populated there. Epic 4 does not depend on Epic 5 to be correct or useful; it is complete for every hour actually worked.

### Story 4.1: A member sees their own hours, split by band

As a member,
I want to see how many hours I have worked and how they split,
So that I do not have to reconstruct my month by hand.

**Acceptance Criteria:**

**Given** a member's working shifts in a period
**When** their hours are computed
**Then** band hours are derived by intersecting each shift's **nominal** interval with the organization's bands, and always sum exactly to total hours (CAP-14, DI-7)

**Given** bands at 06:00 and 21:00 and a 19:00–07:00 shift
**When** hours are computed
**Then** the shift is split, not rounded: 3 day hours and 9 night hours (CAP-14)
**And** the same computation over the pilot's bands yields no split at all, because its bands coincide with its changeovers

**Given** a 12-hour shift on each of the two daylight-saving transition dates
**When** hours are computed
**Then** both report 12 hours, because the calculation is integer minutes over nominal wall-clock and never consults elapsed real time (AD-6, DI-6)

**Given** a roster override moving a shift from member A to member B
**When** hours are recomputed
**Then** the hours move with the roster (CAP-14)

**Given** the hours module
**When** it is inspected
**Then** it is the only implementation of hour computation anywhere, and is asserted against both fixtures without a browser (Q8, Q9, Q10)

### Story 4.2: An admin sees hours for everyone and can explain any figure

As an admin,
I want to see every member's hours for a period,
So that I can close the month and answer a question about any number in it.

**Acceptance Criteria:**

**Given** a period and an organization
**When** an admin opens organization hours
**Then** every member appears with shift counts, hours per band and total (CAP-14)
**And** leave hours are reported in their own column, which is populated once leave records exist in Epic 5 and is empty until then

**Given** the hours table
**When** it renders
**Then** it uses tabular numerals, is sortable and filterable by team and member, and scrolls inside its own container (UX-DR17, Q16)

**Given** a member's own view of their hours and the admin's view of the same member
**When** both are open at the same moment
**Then** the figures reconcile exactly, because both derive from the same computation (CAP-14, Q19)

**Given** hours, leave balance or conflict state
**When** any of them changes
**Then** no optimistic update is shown — the figure waits rather than flickering and correcting itself (UX-DR29)

---

## Epic 5: Leave is recorded, and every collision is surfaced and decided

An admin records a member's leave as a date range and sees its cost before saving. Every working shift the member was rostered for becomes a visible conflict that stands until a human decides it — accept as uncovered, replace the member, or amend the leave — each decision attributable, each taken on its own screen with its consequences stated in the same three terms.

**Capabilities:** CAP-15, CAP-16 · **Governed by:** AD-3, AD-4, AD-5, AD-11 · **Proves:** Q11 · **UX:** UX-DR10–11, 20, 22–23, 25, 27–28

### Story 5.1: An admin records leave and sees what it costs first

As an admin,
I want to enter someone's leave and see what it draws down before I commit,
So that I am not agreeing to something whose cost I discover afterwards.

**Acceptance Criteria:**

**Given** a member with an allowance, days used and a balance
**When** an admin enters a date range
**Then** the cost is shown before saving, counted per `engine-rules.md` §4 (CAP-15)

**Given** a saved leave record
**When** the schedule is re-read
**Then** every scheduled shift is still in place and the rotation is untouched (CAP-15, DI-3)

**Given** an existing leave record for a member
**When** an overlapping range is entered for the same member
**Then** it is refused by the database, not the interface — an exclusion constraint on the member and the date range (AD-3, R4.4)
**And** the refusal names the specific conflict and keeps every entered value (UX-DR22)

**Given** leave whose cost exceeds the remaining balance
**When** it is saved
**Then** it saves with a warning rather than being refused, so a real agreement is never unrecordable

### Story 5.2: An admin amends or deletes leave, and the balance follows

As an admin,
I want to correct a leave record after entering it,
So that a mistake or a changed plan does not become permanent.

**Acceptance Criteria:**

**Given** a saved leave record
**When** it is amended or deleted
**Then** the balance is recomputed so that allowance minus used equals balance at all times, from the current leave year only (CAP-15)

**Given** a leave record that caused conflicts
**When** it is amended so it no longer collides
**Then** every conflict it caused is cleared, because the cause was removed — which is one edit to one record, not a batch resolution (UX-DR28)

**Given** an admin deleting a leave record
**When** they confirm
**Then** the action passes through exactly one confirmation step, signalled by more than colour, using neutral styling rather than the reserved hue (UX-DR27, UX-DR4)

**Given** a member's own view
**When** they open their leave
**Then** they see their allowance, days used and balance, and no other member's (CAP-15, CAP-5)

### Story 5.3: A collision with a rostered shift becomes a visible conflict

As an admin,
I want every shift someone's leave collides with to be raised in front of me,
So that an absence never quietly becomes an uncovered shift discovered on the day.

**Acceptance Criteria:**

**Given** leave covering dates on which a member is rostered for working shifts
**When** the schedule is read
**Then** a conflict exists for every affected working shift, derived rather than stored, so no detection path can be missed (CAP-16, AD-4)
**And** a non-working shift coinciding with leave raises nothing

**Given** an unresolved conflict
**When** the calendar is viewed by an admin
**Then** it is visible without opening a detail view, carrying `⚠` and its inset ring in the reserved hue (UX-DR8, Q21)
**And** it appears in a queue ordered soonest first

**Given** a conflict on a date that has already passed and was never resolved
**When** the queue is viewed
**Then** it is still there, visually distinguished from upcoming ones (UX-DR25)

**Given** an organization with no conflicts
**When** the queue is opened
**Then** it states what is true, and a zero count is still shown rather than hidden (UX-DR20)

**Given** detection running
**When** it completes
**Then** it has deleted, hidden and altered no shift (CAP-16, DI-3)

### Story 5.4: An admin decides each conflict on its own screen

As an admin,
I want to decide each collision individually with its consequences in front of me,
So that I am choosing an outcome rather than clearing a list.

**Acceptance Criteria:**

**Given** an unresolved conflict
**When** its resolution screen opens
**Then** exactly three outcomes are offered — accept as uncovered, replace the member, amend the leave — in a fixed order, as radio-selection cards (CAP-16, UX-DR10)
**And** no option is primary-styled and none is labelled recommended, because a visual default is a decision taken away from the admin

**Given** each offered outcome
**When** it is displayed
**Then** it carries a consequence strip stating the same three terms in the same order: coverage, the absent member's hours, the leave balance (UX-DR11)

**Given** a chosen resolution
**When** it is applied
**Then** it is recorded against `(organization, member, date, team)` with the acting admin and a timestamp, and the conflict no longer derives as unresolved (AD-4, AD-11, Q11)
**And** the absent member's hours land as leave hours rather than worked hours (CAP-16)

**Given** a queue of several conflicts
**When** an admin looks for a way to clear them together
**Then** no such affordance exists anywhere (UX-DR28)

**Given** any resolution
**When** time passes, or any unrelated data changes
**Then** no conflict expires, auto-clears or is suppressed under any circumstance (CAP-16, DI-4)

**Note (sprint change 2026-09-25):** for the replace-the-member outcome, where the organization uses fire ranks, candidates may be shown with rank and position — information only; nothing blocks, warns or suggests from them (FR-18a, §7.2).

### Story 5.5: A configuration change cannot quietly erase a pending decision

As an admin,
I want to be told when a change I am making would make a queued conflict disappear,
So that a decision I still owed someone is not silently taken off my list.

**Acceptance Criteria:**

**Given** unresolved conflicts and a rotation, roster or membership change that would remove their cause
**When** the change is saved
**Then** the unresolved collision set is computed before and after, and every collision the change would erase is surfaced for explicit confirm, amend or discard (AD-5, CAP-16)
**And** the change is not applied until they are dispositioned

**Given** that same diff
**When** it runs
**Then** it is bounded by the union of existing leave ranges intersected with the change's own validity range, not computed over all future dates (AD-5)

**Given** a configuration change producing only warnings and no erasures
**When** it is saved
**Then** it saves without blocking, because only an erasure blocks (CAP-10, AD-5)

---

## Epic 6: Each role lands on the answer to its standing question

A member opens the app and knows whether they are working today — stated in words when they are not — when they next work, how many hours they have done and how much leave remains, without tapping anything. An admin sees today's coverage and the count of conflicts awaiting them, shown even when it is zero.

**Capabilities:** CAP-17 · **Governed by:** AD-13 · **Proves:** Q14, Q19 · **UX:** UX-DR9, 33

### Story 6.1: A member opens the app and already has their answer

As a member,
I want to know whether I am working and when I next work without tapping anything,
So that I can check between other tasks, in a vehicle, before bed.

**Acceptance Criteria:**

**Given** a member who is not working today
**When** their dashboard opens
**Then** it says so in words — `Danas ne radiš` — rather than showing an empty area to interpret (CAP-17, UX-DR20, UX-DR34)

**Given** a member who has a next working shift
**When** their dashboard opens
**Then** it shows its date and both clock times, their band hours and total for the period, their leave used and remaining, and at least seven days of upcoming shifts (CAP-17)

**Given** a phone-width viewport
**When** the dashboard renders
**Then** everything is usable with no horizontal scrolling, in the priority order today's shift, next shift, calendar, hours, leave (Q14, Q16)

**Given** every figure on the dashboard
**When** it is compared to its detail view
**Then** they are equal, because both derive from the same snapshot (Q19, AD-13)

### Story 6.2: A 24-hour duty reads as one duty, not two unrelated shifts

As a member,
I want a day shift running straight into a night shift to read as the single stretch it is,
So that finishing at 07:00 does not look like two separate shifts with a gap between them.

**Acceptance Criteria:**

**Given** consecutive working shifts with no non-working interval between them
**When** the member dashboard renders
**Then** they are presented as one duty: the end time as the headline, the span and total hours as metadata, a progress bar, and one leg per constituent shift marked done or in progress (UX-DR9)

**Given** that same duty
**When** the underlying data is inspected
**Then** it remains two scheduled shifts on two dates — the grouping is presentation only, and no duty entity is stored (UX-DR9, DI-5, AD-1)

**Given** a member mid-duty
**When** their dashboard opens
**Then** it headlines when they finish, not when they started

### Story 6.3: An admin opens the app and sees what needs them

As an admin,
I want today's coverage and the count of decisions waiting for me,
So that I can configure once and then simply be told when something needs me.

**Acceptance Criteria:**

**Given** an organization with any number of teams
**When** an admin's dashboard opens
**Then** it shows today's coverage across all of them (CAP-17)

**Given** an unresolved conflict count
**When** the dashboard renders
**Then** the count is shown even when it is zero, because hiding it is indistinguishable from not having loaded (CAP-17, UX-DR20)
**And** it matches the conflict list exactly (Q19)

**Given** the dashboard
**When** it is operated by keyboard and by assistive technology
**Then** both are supported, as they are for the calendar and the conflict queue (Q22, UX-DR38)
