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
- **CAP-2** — Organization configuration and branding. Identity, timezone, locale, leave year, logo. Type, timezone and locale are set at provisioning; the admin configures identity, leave year and logo. All times display in organization timezone. Two organizations differing only in type produce byte-identical output. Logo unreadable across tenants.
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
- **CAP-13** — Monthly calendar with team and member filters. Filters populated from live records; state survives month navigation and clears in one action; a midnight-crossing shift renders once on its start date with both clock times; unresolved conflicts visible to an admin without opening detail, while a member sees no conflict mark and only their own leave (story 7.10); no state by colour alone.
- **CAP-14** — Hours computed by band intersection. Band hours sum exactly to total; a straddling shift is split not rounded (19:00–07:00 with bands at 06:00/21:00 yields 3 day, 9 night); 12 hours on both DST transition dates; hours follow the roster; a member's figures reconcile exactly with the admin's view. An admin can export the organization hours for a period to Excel, carrying exactly the figures on screen, each hours cell formatted as the screen reads it (`192 h`, `12 h 30 min`, `30 min`). The leave is reported in days only — the days the leave balance charges (`3 dana`) — on screen and in one file column of days (human decision 2026-10-10).
- **CAP-15** — Annual leave against a per-member allowance. Recording leave leaves every shift in place; cost visible before saving; overlapping range refused; allowance minus used equals balance at all times within the current leave year; deleting restores the balance.
- **CAP-16** — Leave/schedule conflicts resolved explicitly. A conflict exists for every affected working shift and stands until explicitly resolved; none expires or auto-clears; a configuration change that would remove a cause surfaces it for an explicit decision; detection alters no shift; non-working shifts raise nothing; exactly three resolutions, each attributable; a shift a resolution moves to leave drops out of the worked hours and lands as its leave day, never as hours (human decision 2026-10-10).
- **CAP-17** — Role-appropriate landing surfaces. Member: today's shift stated in words when not working, next working shift with both times, band hours and total, leave used and remaining, seven days ahead, usable at phone width with no horizontal scrolling. Admin: today's coverage for any team count, unresolved-conflict count shown even at zero and matching the list exactly. Every dashboard figure equals its detail view.
- **CAP-18** — An installable app that reads offline (added 2026-10-10, `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`). Installs on Android and iOS. Offline, every surface already read shows its last snapshot with "as of {date time}" and refuses every write with a stated reason; a cached figure never sits beside a fresh one; signing out removes every cached snapshot from the device.
- **CAP-19** — Leave requests (added 2026-10-10). A member requests a range and sees its cost before sending; a pending request creates no conflict, charges no balance and alters no shift; the admin sees, before deciding, its cost, the balance after it, its conflicts and any short-staffed shift; approval creates a Leave Record attributed to the approving admin, rejection creates nothing; a member withdraws a pending request; each decision is attributable.
- **CAP-20** — Notifications (added 2026-10-10). Email reaches a member with an email address, push a member who installed the app and allowed it, and a member with neither is told so in their settings. A notification names facts and links to the surface; each member can turn each channel off; nothing about another member's leave or absence type reaches a member-role account.
- **CAP-21** — Minimum members per shift (added 2026-10-10). A working shift whose people at work (roster after overrides, minus everyone absent that date, plus replacements) number fewer than the organization's setting is short-staffed. It is shown before every save that would cause it, marked on the calendar day and counted on admin Danas; nothing is blocked; with the setting empty nothing is reported.
- **CAP-22** — Shift swaps (added 2026-10-10). A member proposes their shift and, optionally, a colleague's shift in return; the colleague accepts; an admin approves. Until approval the schedule is unchanged; approval writes Roster Overrides attributed to the admin; the admin first sees each member's hour delta, any leave or double booking and any short-staffed result, which warn and never block; either member can withdraw before the decision.
- **CAP-23** — Absence types, carry-over and part-day absence (added 2026-10-10). An Absence Type is organization data with a name and whether it draws down the allowance; every type raises a conflict against a rostered working shift and only drawing types change the balance; carried-over days are derived from the previous leave year's unused balance, capped by the organization's setting, and expire on its date; a half-day record costs 0.5; no record carries a reason.
- **CAP-24** — Change history (added 2026-10-10). Every write to a rule, an exception, a decision, a request, a member or a setting appears with its author, time and before/after values, deletions included; filterable by date range, member, team and kind; the PDF holds exactly the filtered rows; member-role accounts reach none of it. History begins at the migration that introduces it, earlier entries reconstructed from existing attribution columns.

### NonFunctional Requirements

From `quality-requirements.md`.

- **Q1** Tenant isolation enforced at the database layer; a cross-tenant read with a valid session must fail closed.
- **Q2** Role enforcement at the same layer; administrative writes refused identically via UI or direct API. Needs its own policy design.
- **Q3** Every organization-scoped record carries its organization reference; no record reachable without it.
- **Q4** Uploaded branding assets readable only by members of the owning organization.
- **Q5** Personal data limited to name, optional email, team, hours, absence by type. No absence record has a reason, diagnosis or free-text field. An absence type's name is visible only to admins and to the member themselves; to anyone else it reads as absent. Where an organization names a type for sick leave, that fact is health data, held under that visibility rule and no wider (amended 2026-10-10, decision D1).
- **Q6** An organization can never be left with zero admins; the last admin's role cannot be downgraded.
- **Q7** Rotation projection, schedule generation, hour computation, leave-day counting and conflict detection are pure, framework-free, unit-testable; no React and no direct data-access dependency.
- **Q8** Exactly one canonical implementation of each domain calculation. A declarative database *constraint* is not a calculation; a database routine that *computes* a domain answer is.
- **Q9** Every constraint in SPEC.md and every rule in engine-rules.md has at least one automated assertion, executable without rendering a component or starting a browser.
- **Q10** Two configuration fixtures minimum: the pilot, and the UJ-5 security organization whose bands and shifts diverge.
- **Q11** Every override and conflict resolution records the acting admin, a timestamp and the affected records, outliving what it modified.
- **Q12** Every write to an organization's records is reconstructable — author, time, before and after — and readable by admins on the change-history surface (CAP-24) (amended 2026-10-10).
- **Q13** Responsive web supporting mobile, tablet, desktop. No native application. Installable as a PWA and readable offline (CAP-18, added 2026-10-10).
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
- **Q24** A cached snapshot is never shown without its as-of time, never beside a fresh one, and never survives sign-out (added 2026-10-10).
- **Q25** A notification is derived from a recorded fact, never a calculation the notifier makes on its own, and is sent at most once per recipient and channel (added 2026-10-10).

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
- **AD-16** One privileged auth boundary — a single Edge Function exposing only `createUser`, `updateUserById`, `resetPassword` (each admin-authorized against the database) and `clearMustSetPassword` (any role, acting only on the caller), holding two clients (secret key for the auth call, caller's JWT for every domain write), performing no domain calculation. Deactivation does not use it: it is a versioned write through PostgREST, and the custom access token hook refuses a member inactive today; there is no ban/unban (2026-10-13, deferred-work sweep). Organization provisioning is an operator CLI task and does not use it.
- **AD-17** The secret key (`sb_secret_*`) exists only in that function's environment, per environment; the SPA ships the publishable key only. Legacy `anon`/`service_role` keys are deprecated end of 2026 and unused.

**Environment and platform.** Local (Supabase CLI) → free-tier staging → production; migrations are files in git, forward-only, never edited after promotion. Stack pinned and verified 2026-09-02: React 19.2.8, TypeScript 7.0.2, Vite 8.2.2, Tailwind 4.3.3, TanStack Router 1.170.32 / Query 5.102.8 / Table 9.2.4, supabase-js 2.113.0, i18next 26.4.1, Vitest (node environment). Known gap: TypeScript 7 has no stable programmatic API until 7.1, affecting typed linting; fallback is pinning TypeScript 5.x.

### UX Design Requirements

From `DESIGN.md` (visual) and `EXPERIENCE.md` (behavioural). Both are binding and win over any mock.

**Design tokens and theme**
- **UX-DR1** Implement the 48-token colour layer as a shadcn theme delta: `primary`, `destructive`, the six-slot working-shift ramp plus `shift-nonworking` and its `shift-nonworking-border`, and four modifier signals — each defined in *both* light and dark.
- **UX-DR2** Light and dark both ship. The default follows `prefers-color-scheme`; a Sustav / Svijetla / Tamna control pins either theme, persisted per device in `localStorage` (changed 2026-09-25 by human decision — it originally forbade any toggle, setting or persisted preference). It sits beside Odjava: in the *Više* sheet on a phone and in the user (profile) menu on desktop (story 7.3).
- **UX-DR3** Convert DESIGN.md's hex tokens to the space shadcn now emits (OKLCH), and contrast-verify ramp slots 3–6 in both themes before any second organization uses them. Slots 3–6 are marked `[ASSUMPTION]` and unexercised by the pilot.
- **UX-DR4** `destructive` is reserved exclusively for an unresolved conflict — not delete buttons, not validation errors, not an organization's accent. Destructive actions use neutral styling plus a confirmation step. *Planned (2026-10-10, `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`), rewritten by the story that ships it:* a `warning` token is reserved for a short-staffed shift (UX-DR48), never `destructive` and never an accent (story 11.3).
- **UX-DR5** An organization's accent may tint the application shell and logo lockup only; never a shift state, a modifier, or `destructive`. It is chosen from named radio cards, with this rule said beside them (story 7.18).
- **UX-DR6** Shift types are assigned ramp slots in creation order; beyond six a slot repeats and the always-visible label carries the distinction. No `shift-day` or `shift-night` token may exist.

**Domain components**
- **UX-DR7** `shift-cell` — base fill from the assigned slot, label always visible, time range shown when width allows and dropped rather than abbreviated, 30 px minimum height, tap opens day detail.
- **UX-DR8** `shift-cell` modifiers, composable on any base and on each other: conflict (inset 2 px `destructive` + `⚠`), overridden (inset 2 px + `✎`), leave (hatch + `◷`), uncovered (hatch + `◌`). Conflict and uncovered render on an admin's calendar only (story 7.10). *Planned (2026-10-10, `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`), rewritten by the story that ships it:* a fifth modifier, short-staffed, with its own glyph and the `warning` token, on an admin's calendar only (story 11.3).
- **UX-DR9** `duty-block` — groups consecutive working shifts with no non-working interval into one duty; end time as headline, span and total as metadata, progress bar, one leg per constituent shift marked done or in progress. Presentation only; the data remains two scheduled shifts on two dates. As built in Epic 6 (recorded 2026-10-13, deferred-work sweep): the progress bar's value is said in words (`14 h 10 min od 24 h`) between the span's two ends; each leg is *Odrađeno*, *U tijeku* or *Slijedi* by word and icon and says whose shift it is, a replacement naming the member replaced (`zamjena za {ime} ({smjena})`) (story 6.2). On leave, *Danas* states the leave, its range and its cost in days, and heads the next shift as the return (`Vraćaš se`); a running duty still wins (UJ-2, story 6.1b). An admin's *Danas* is its own body: *Treba tebe* first, then *Pokrivenost danas*, *Odsutni danas* and *Ovaj tjedan* (story 6.3).
- **UX-DR10** `resolution-option` — radio-selection card, exactly one selected, no option primary-styled or labelled recommended, fixed order so muscle memory is possible. Nothing is preselected; the selected card takes a border, a ring and a filled radio, never a new background. ‹ › move to the adjacent unresolved conflict in queue order, without saving (decision 20, story 5.4b). "Zamijeni osobu" sits at position 2; its candidate picker is a sibling after the card, its own radio group, grouped `slobodan` / `radi taj dan · 24 h bez pauze` / `na godišnjem taj dan`, every candidate selectable and none preselected (story 5.4c). "Izmijeni godišnji odmor" sits at position 3, the three cards one arrow-key group; it states the computed range that would clear the conflict (rule A: start `d + 1`, end `d − 1` on the last day, removal of a one-day record), never preselected or recommended, records no resolution, and its Spremi opens the member page's leave amend prefilled, or the record's removal confirmation, with "Natrag na konflikte" back to the queue (story 5.4d). Story 7.9: the day detail's roster dialog groups its "Dolazi" candidates by the same three groups, as native option groups, every candidate selectable and none preselected.
- **UX-DR11** `consequence-strip` — three fixed terms in a fixed order on every resolution option: coverage, the absent member (labelled *Odsutni član* since 2026-10-10: the first two cards state their leave day, "1 dan godišnjeg", never hours; amending states their hours as work), the leave balance. Three columns at every width, a phone's included; uncovered coverage carries lucide `CircleDashed` (story 5.4b). A replacement's coverage reads one higher and names the person picked, never "Nepokriveno"; its hours and balance read as uncovered's, because the absent member stays on leave (story 5.4c). Amending the leave reads the coverage one higher with "{ime} radi", the shift's hours as work ("12 h rada"), and the balance once the dropped days are given back over what that gives ("17 dana preostalo" / "+1 dan"), in the conflict date's leave year (story 5.4d).
- **UX-DR12** `state-glyph` — the fixed four-mark vocabulary with a persistent legend anywhere glyphs render. Not a tooltip, not behind an info icon. *Planned (2026-10-10, `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`), rewritten by the story that ships it:* the vocabulary becomes five marks with short-staffed (story 11.3); the conflict mark's legend reads *čeka odluku* (story 9.1) and the leave mark's *odsutnost* (story 13.2).
- **UX-DR13** Hour Band editor — name and start time only, with window, duration and midnight-crossing derived and read-only; a 24-hour partition bar with any gap hatched and flagged.
- **UX-DR14** Pattern builder — ordered, reorderable, arbitrary length, the same shift type may repeat; cycle length, working steps and hours per cycle update live beneath it.
- **UX-DR15** Cycle preview — renders the next full cycle from pattern, offsets and anchor date before saving.
- **UX-DR16** Configuration stepper — four steps on phone (shift types, pattern, offsets, preview) with completed steps navigable backwards; one scrolling panel on tablet and desktop. Same data, same validations, same order. The builder ends in a save bar (story 5.5c): a hint, "Odbaci promjene" while there are unsaved changes, and the one "Spremi rotaciju"; sticky at the viewport's bottom from `sm` up (where the phone tab bar is gone) while there are unsaved changes, with the page's scroll padding clearing it; at the end of the builder (the history is a dialog behind a header button since story 7.18), and never sticky on a phone.
- **UX-DR17** Hours table — tabular numerals, sortable and filterable by team and member; from 640 px a table scrolling inside its own container, and below 640 px stacked rows (story 7.6) — as are Ljudi, the shift types, the leave overview and, since the 2026-10 deferred-work cleanup, the hour-band, team, rotation-offset and rotation-history tables — with every value labelled and one `Poredano: {column} ↑|↓` sort control, the sort and filters kept across the switch. Since story 7.14 the table ends with a footer total (the stacked rows with one total line), the export keeps a status line about the downloaded file, and every hours figure above 0 has an ⓘ that opens a dialog of the shifts that compose it, as an equation with dates (FR-42b). Since 2026-10-10 the leave reads in days only (`3 dana`, `—` at 0), sorts and totals by days, and is one column of days in the export; its ⓘ lists the charged dates, `+1 dan` each. Since the Epic 4 and 5–7 cleanup the shifts in unresolved conflict sort by their count, and the export ends with the footer row, as on the screen.
- **UX-DR18** Calendar mode switch — segmented, two modes (*Moj raspored* default on mobile for member-role, *Sve smjene*), persisting across month navigation within a session.
- **UX-DR19** Team/member filter — one chip bar shared by *Kalendar* and *Sati* (story 7.5): `Smjena: sve|<team>` and `Osoba: sve|<name>`, populated from live records, never hard-coded, each option with its count; an active chip has its own ✕; a summary line always states what is shown (`Prikazano: Smjena B · 4 osobe od 17`); one `Poništi filtre` clears all filters without leaving the screen. In *Kalendar* a person replaces the team; in *Sati* the two combine. Below 640 px `Filtri · N` opens a bottom sheet, and active chips stay visible. All filter state lives in the URL (`?smjena=…&osoba=…`). A team or person with no row in another month stays in the URL across the month change — the screen then shows everyone — and applies again where it has a row; only a filter change drops it (as the calendar always has; *Sati* since the Epic 4 cleanup).

**State language**
- **UX-DR20** Empty states state what is true, never absence. A zero count is still shown — `0 neriješenih konflikata` — because hiding it is indistinguishable from not having loaded. A filter that leaves no row says why and where instead (`Luka Knežević nije u smjeni Smjena B u listopadu 2026.` · `Luka Knežević je u smjeni Smjena A.`) and offers `Ukloni filtar: Smjena B` and `Poništi filtre`.
- **UX-DR21** Loading uses skeletons matching final layout for the calendar grid and tables; no spinners on primary surfaces. A visited and an unvisited month must feel the same.
- **UX-DR22** A refused save names the specific problem in hours and keeps every entered value.
- **UX-DR23** Warnings appear at save time with the consequence in numbers and never block, and never persist as standing banners. The one thing a configuration save waits on is an erasure (AD-5): since story 5.5a, a rotation save that would erase an unresolved conflict opens a confirmation listing each, and saves only once every one is confirmed ("Potvrdi brisanje"); the warnings show beside them and still never block. Since story 5.5b the same confirmation guards a calendar roster change, saved or removed, beside the day detail. Since story 7.9 a change opened from the day detail — the roster dialog and the type dialog — computes *Što se mijenja* before its one Save (the type from and to, who leaves and arrives, each member's hour delta), from the same "after" snapshot as its erasure check; it informs and never blocks. Since story 7.12 the leave dialog computes, before its Save, the cost, the balance after it and the conflicts the record creates (an amend: which clear and which stay) through the domain's collision rule; none of it blocks, an over-balance range included. *Planned (2026-10-10, `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`), rewritten by the story that ships it:* a short-staffed shift is the second named exception to "never persist as standing banners", after conflicts: it is a standing derived state on the calendar and admin Danas, and at save a block in *Što se mijenja* (`Smjena B, 14.10. Dan: rade 2 od najmanje 3`), never a quiet line (stories 11.2–11.4). The erasure dialog reads *Promjena uklanja N stavki koje čekaju odluku* (story 9.1).
- **UX-DR24** Overridden state is identifiable on the calendar and in a list without opening detail; detail names author, timestamp, reason and the projected value replaced.
- **UX-DR25** Past-but-unresolved conflicts stay in the queue, visually distinguished from upcoming ones. Since story 7.16, *Raspored* has *Neriješeni* (the default, its count kept at zero) and *Riješeni*, which lists the decided conflicts from `conflict_resolutions` only, each with its decision, the acting admin and the timestamp; a resolved conflict is never in the queue, and the tab is not an audit-log screen. *Planned (2026-10-10, `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`), rewritten by the story that ships it:* the queue is *Za odluku*, its tabs *Čeka odluku* (default) and *Odlučeno* (story 9.1); it also lists pending leave and swap requests, and *Odlučeno* their decisions (stories 9.5, 12.4). *Odlučeno* stays a read of stored decisions; the change history is its own surface (UX-DR51).

**Interaction**
- **UX-DR26** 44 px minimum tap targets on touch, including calendar cells — which sets the real floor for grid density.
- **UX-DR27** One destructive confirmation step, never a colour-only signal. Since story 7.13c a deactivation's neutral question also states its date and its consequence in numbers (the team's size before and after, and the member's own duties left in that month), and its final button repeats the date.
- **UX-DR28** No bulk conflict resolution anywhere. Amending a leave record still clears every conflict it caused — cause-removal, not batching.
- **UX-DR29** No optimistic updates for hours, leave balance or conflict state. A recorded conflict decision is confirmed by a `Notice role="status"` line on the queue, not a toast: it is gone on navigation and persists nowhere (decision 21, story 5.4b).
- **UX-DR30** Month navigation symmetric in both directions across every month the calendar represents (0001-01…9999-12); no month unreachable or slower. Since story 7.4 one month toolbar (‹ month ▾ ›) on *Kalendar* and *Sati*: PgUp/PgDn step the month within it, and the month opens a twelve-month picker with the year's ‹ › and a footer (its keys and `Ovaj mjesec`), a bottom sheet below 640 px, where the toolbar is a sticky head that repeats the active filters in one line once the chips have scrolled away.

**Information architecture**
- **UX-DR31** Bottom tabs on mobile, sidebar on desktop — two layouts, one architecture. Member-role reaches five destinations (Danas, Kalendar, Sati, Godišnji, Ljudi) and no configuration surface at all. *Ljudi* is role-scoped, as *Sati* is: for a member it is the read-only directory of who is on which team (story 7.17). On a phone the bar is four fixed tabs plus *Više* and never scrolls; a member's tabs are Danas, Kalendar, Sati and Godišnji, and their *Više* holds Ljudi under *Pregled*, then the theme and Odjava (stories 7.3, 7.17). *Planned (2026-10-10, `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`), rewritten by the story that ships it:* a member's *Više* gains *Obavijesti* (story 10.3) and *Instaliraj* (story 8.4); their *Godišnji* gains *Zatraži godišnji* (story 9.3); their day detail gains *Predloži zamjenu* (story 12.2).
- **UX-DR32** The admin reaches the member's five destinations plus three admin-only ones — Raspored, Postavke rotacije, Organizacija — eight in all. The sidebar lists them in binding order: Danas, Kalendar, Sati, Godišnji, Raspored, Ljudi, Postavke rotacije, Organizacija. Sati, Godišnji and Ljudi are shared and role-scoped: Sati shows organization-wide hours to an admin, Godišnji shows an admin the leave overview of every member active today in place of their own tiles (story 7.15), and Ljudi shows an admin the members list where a member sees the directory (story 7.17). The sidebar has no group labels yet (deferred from story 7.3). On a phone an admin's tabs are Danas, Kalendar, Raspored, Ljudi; *Više* holds Sati and Godišnji (*Pregled*) and Postavke rotacije and Organizacija (*Postavke*) (story 7.3). *Planned (2026-10-10, `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`), rewritten by the story that ships it:* *Za odluku* replaces *Raspored* in the binding order and on the phone bar (story 9.1); the admin's *Više* gains *Povijest promjena* under *Pregled* (story 14.2).
- **UX-DR33** Build the 18 surfaces in the EXPERIENCE.md inventory. The member roster is one page for a member: *Ljudi* shows every active team with today's members as `Ime · čin · položaj`, their own team first and marked *tvoja smjena*, with a name search in `?trazi=` — read-only, with no allowance, balance, leave, hours, username or contact detail (story 7.17, CAP-5). One team's roster also stays inside team detail (`/smjene/$id`), reached from Danas. *Riješeni* (story 7.16) is a tab of the conflicts queue, not another surface. A member's *Sati* is titled *Moji sati* (story 7.14). An admin's *Godišnji* is the leave overview (story 7.15): *Osoba* (a link to the member page), *Smjena*, *Pravo*, *Iskorišteno* and *Preostalo* for the members active today, with `?trazi=` and `?sort=`, read-only; a member-role account is refused its data at the database (`leave_overview_records()`, 0034). *Planned (2026-10-10, `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`), rewritten by the story that ships it:* five more surfaces — request leave (9.3), request decision screen (9.4, 12.4), request swap (12.2), notification settings (10.3), change history (14.2) — bring the inventory from 18 to 23.

**Voice and localization**
- **UX-DR34** Croatian microcopy rules: state the fact not the absence; numbers not adjectives; no exclamation marks; second person singular informal; `19:00–07:00` with an en dash; `12.09.2026` date format. A data name (a team, a person) is never declined: it stands in apposition (`nije u smjeni Smjena B`), and a month in a sentence reads in the locative (`u listopadu 2026.`).
- **UX-DR35** Three plural forms wherever a count renders — days, hours, shifts, conflicts, members, teams.
- **UX-DR36** Never say *smjena* for a shift type. `Sve smjene` carries a count (`Sve smjene (4)`), each team its person count (`4 osobe`), and the teams are grouped under a labelled heading (*Smjene*).

**Accessibility**
- **UX-DR37** No information by colour alone anywhere — verified specifically in the compressed grid, status pips and badges, where the rule is most often broken.
- **UX-DR38** Keyboard navigation for the calendar grid, both dashboards, the conflict queue and the resolution screen, whose options are an arrow-navigable radio group.
- **UX-DR39** Assistive technology gets date, team, shift type, times and any modifier on every calendar cell — not a colour swatch, not a bare letter.
- **UX-DR40** Typography: verify Latin Extended-A coverage against **č ć ž š đ Č Ć Ž Đ Š** before any face substitution; every digit is a DM Sans tabular figure (Shift Figures, derived from DM Sans and leading both font stacks), never Syne; tabular numerals wherever numbers align.

**Responsive**
- **UX-DR41** Phone (<640): *Moj raspored* day list by default, compressed grid one tap away with teams as one-letter columns. Tablet (640–1024): full grid with team names. Desktop (>1024): times visible in cells.
- **UX-DR42** The compressed grid is the same component as the full grid with a narrower column treatment, not a separate mobile calendar.
- **UX-DR43** Every administrative task completes on a phone; rotation configuration is the hardest case and the one to test first.
- **UX-DR44** Hours export — one action on Organization hours, `Izvezi u Excel`, admin-only; exports the current period, filter and sort; the file's figures match the table exactly.

**Added 2026-10-10** (`sprint-change-proposal-2026-10-10-v1-scope-expansion.md`), each binding from the story that ships it:

- **UX-DR45** Install and offline — the install prompt sits in *Više* and is never a modal on first visit. Offline, a `Notice` reads `Bez veze · stanje od 10.10.2026. 14:32` above the surface, and every write control states that it needs a connection (stories 8.2–8.4). A new version is announced app-wide by a `Notice role="status"`, *Dostupna je nova verzija.*, with an *Osvježi* button; the page reloads only when the member taps it, never by itself (story 8.1).
- **UX-DR46** *Za odluku* items — three kinds: absence in a shift, a leave request, a swap request. Each kind has its own decision screen; the queue is soonest-first across all kinds and each item names its kind in words. The UI never says *konflikt*: a collision item reads *Odsutnost u smjeni* (`{ime} je na godišnjem, a raspoređen je`), the count `3 čekaju odluku` in three plural forms, the button *Odluči*, the back link *Natrag na Za odluku* (stories 9.1, 9.5).
- **UX-DR47** Request forms — a member's leave request: range, type (from story 13.2), half day (from 13.5), then the cost and the balance after it, and one *Pošalji*. A swap request: my shift, a colleague, an optional return shift, the colleague's own consequence, and one *Pošalji* (stories 9.3, 12.2).
- **UX-DR48** Short-staffed — a fifth state glyph with a legend entry, its own `warning` token in light and dark, contrast-verified, never `destructive`, never accent, and a non-colour signal. Standing on the calendar and admin Danas (a card beside *Za odluku*, shown at zero); a block in *Što se mijenja* at save; in the consequence strip it lives in the coverage term (stories 11.2–11.4).
- **UX-DR49** Notification settings — in *Više*: email on/off with the address, or `Nemaš upisan e-mail`; push on/off, or `Instaliraj aplikaciju za obavijesti` on iOS before install (story 10.3).
- **UX-DR50** Absence type — a radio card group in the leave dialog and the request form. A member sees another member's absence as *odsutan*, never its type; the calendar ◷ legend reads *odsutnost* (story 13.2).
- **UX-DR51** Change history — a table, stacked rows below 640 px, of time, author, kind, subject and *bilo → sada*; filter chips for period, member, team and kind; one `Izvezi u PDF` that exports exactly the filtered rows. Admin only (stories 14.2, 14.3).
- **UX-DR52** Decided requests — *Odlučeno* lists decided leave and swap requests beside decided collisions, each with the decision, the acting admin and the time (stories 9.5, 12.4).

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
| CAP-14 Hours by band intersection | Epic 4 | my hours, organization hours, Excel export |
| CAP-15 Annual leave against allowance | Epic 5 | leave records, cost preview, balance |
| CAP-16 Conflicts resolved explicitly | Epic 5 | derived collisions, queue, three resolutions |
| CAP-17 Role-appropriate landing surfaces | Epic 6 | member and admin dashboards |
| CAP-18 Installable, reads offline | Epic 8 | manifest, service worker, persisted snapshots with as-of note |
| CAP-19 Leave requests | Epic 9 | request record, member form, admin decision screen, *Za odluku* |
| CAP-20 Notifications | Epic 10 | outbox, `notify` function, email, Web Push, settings |
| CAP-21 Minimum members per shift | Epic 11 | `domain/staffing`, setting, save blocks, calendar mark, Danas card |
| CAP-22 Shift swaps | Epic 12 | swap record, proposal, acceptance, admin decision |
| CAP-23 Absence types, carry-over, half days | Epic 13 | absence types, allowance per leave year, carry-over, half-day records |
| CAP-24 Change history | Epic 14 | `audit_events`, history surface, PDF export |

**Non-functional allocation.** Q1–Q3 and Q6 land in Epic 1 and are re-asserted by every epic that adds a table. Q7–Q10 land in Epic 2 with the domain package and both fixtures, and each later epic extends the suite. Q11–Q12 land in Epic 3 with the first attributable writes. Q13–Q16 and Q21–Q23 are definition-of-done on every epic with a surface. Q17–Q18 are proven in Epic 3, Q19 in Epic 6, Q20 in Epic 1. The localization contract L1–L8 is definition-of-done everywhere. Added 2026-10-10: Q24 lands in Epic 8; Q25 in Epic 10; the amended Q5 in Epic 13 and the amended Q12 in Epic 14; Q2 is re-asserted by Epics 9 and 12, which add the first member-role domain writes (own requests only, never an administrative write).

**UX design requirement allocation.** UX-DR1–2, 4–5, 31–32, 34, 40 land in Epic 1 — the theme layer and the i18n layer are built once, first. UX-DR3, 6, 13–16, 23, 35, 43 land in Epic 2, including the ramp-slot contrast verification, which belongs where shift types are first assigned to slots. UX-DR7–8, 12, 18–21, 24, 26, 30, 33, 36–39, 41–42 land in Epic 3 with the calendar, skeleton loading included. UX-DR17, 29, 44 land in Epic 4. UX-DR10–11, 22, 25, 27–28 land in Epic 5. UX-DR9 (duty-block) lands in Epic 6. Epic 7 (sprint change 2026-10-02) revises UX-DR1, 2, 10, 16–17, 19–20, 23, 25, 29–34, 36 and 40 on shipped surfaces; each line is rewritten by the story that ships its change, not up front. Epics 8–14 (sprint change 2026-10-10) add UX-DR45–52 and revise UX-DR4, 8, 12, 23, 25 and 31–33 the same way: UX-DR45 in Epic 8, UX-DR46, 47 and 52 in Epic 9 (47 and 52 extended by Epic 12), UX-DR49 in Epic 10, UX-DR48 in Epic 11, UX-DR50 in Epic 13, UX-DR51 in Epic 14.

## Epic List

Fourteen epics. Each stands alone and enables the next without requiring it. Epic 7 was added on 2026-10-02 by `sprint-change-proposal-2026-10-02-ux-redesign.md`; its four foundation stories (7.1–7.4) ship before Epic 6. Epics 8–14 were added on 2026-10-10 by `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`, in priority order: former v2 items that ship in v1, before pilot go-live. Each is shippable on its own, so go-live may follow any finished epic.

### Epic 1: An organization exists, and its people can sign in

An operator provisions an organization with its type, timezone and locale; an admin configures its identity, leave year and branding, creates teams, and issues credentials — including to members who have no email address. Every member signs in and reaches exactly their own organization's data at exactly their own permission level, and can see who is on a team.

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

A member sees their shift counts, hours per band, total and leave — in days — for a period. An admin sees the same for everyone, sortable and filterable. Nobody enters or reconciles an hour by hand, and a member's own figures reconcile exactly with the admin's view of them. The admin can take the month away as an Excel file that matches the screen.

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
**Implementation notes:** where Q19 is proven — every dashboard figure equals its detail view, guaranteed by AD-13 rather than by checking. Carries `duty-block` (UX-DR9), the subtlest component in the set: it presents a 24-hour duty spanning two dates as one card while the data stays two scheduled shifts on two dates. Built on Epic 7's foundations (7.1–7.4: dark tokens, numerals, phone navigation, month toolbar), which ship first (sprint change 2026-10-02).

### Epic 7: The app is calm on every screen (added 2026-10-02, sprint change)

Every screen reads calm, minimal and simple on a phone and a desktop, in both themes. A pilot user finds each answer in one glance and makes each change behind one Save. The phone tab bar fits, a night shift never reads as a free day in the dark theme, tables do not scroll sideways on a phone, and Kalendar and Sati share one toolbar.

**Capabilities covered:** none exclusively — it reworks the surfaces of CAP-1, CAP-4, CAP-5, CAP-13, CAP-14, CAP-15 and CAP-16, and adds PRD FR-3a, FR-42b, FR-45a and FR-48a
**Standalone:** every story improves a surface that already works; no story is required for any earlier epic to be correct.
**Implementation notes:** source is `sprint-change-proposal-2026-10-02-ux-redesign.md` and the 27 approved decisions in `ux-designs/ux-shift-2026-10-01-redesign/README.md`. Foundations 7.1–7.4 ship before Epic 6; 7.5–7.18 follow Epic 6, ordered by dependency. Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same PR, so no binding doc describes unbuilt UI.

### Epic 8: The app installs, and the schedule reads without a connection (added 2026-10-10)

A member adds Shift to their phone's home screen and opens it on a truck with no signal: the last schedule they saw is there, with the time it is from, and nothing pretends to save.

**Capabilities covered:** CAP-18
**Standalone:** every surface already works online; this epic makes it installable and readable offline.
**Implementation notes:** amends AD-13 (a persisted snapshot renders only while offline, whole, labelled with its as-of time) in story 8.2. Q24 is proven here. The installed name is decided in 8.1, since the PRD's "Shift" is a working title.

### Epic 9: A member asks for leave, and an admin decides (added 2026-10-10)

A member requests a leave range from their phone and sees what it would cost. An admin sees the request in *Za odluku* with the conflicts it would raise and decides it; on approval the leave exists. Until then nothing in the schedule moved. The conflicts queue becomes *Za odluku*, and the UI stops saying *konflikt*.

**Capabilities covered:** CAP-19
**Standalone:** leave still works admin-entered; requests add a path into it.
**Implementation notes:** amends AD-4 (*Za odluku* is the union of unresolved collisions and pending requests) and AD-10 (member-owned request rows, the first member-role domain writes) in story 9.2. Story 9.1 renames the shipped surfaces of 5.3b, 5.4, 6.3 and 7.16 and rewrites the 71 *konflikt* strings in `hr.json`.

### Epic 10: People hear about what concerns them (added 2026-10-10)

A member learns by email or push that their request was decided or their shifts changed; an admin learns that something waits in *Za odluku*. A member without an email address gets push once they install the app.

**Capabilities covered:** CAP-20
**Standalone:** every fact it reports already exists on a surface; notifications only carry it out.
**Implementation notes:** an Architect pass (`bmad-architecture`, update intent) precedes 10.1. It amends AD-14 (exactly two Edge Functions: `admin-auth` and `notify`) and AD-17 (email provider and VAPID keys only in `notify`'s environment), and adds AD-18 (a notification is written to the outbox by the request that asserts its fact, as codes and operands; `notify` computes no domain answer). Shift reminders are out of v1. Push depends on Epic 8's service worker. Q25 is proven here.

### Epic 11: A shift short of people is impossible to miss (added 2026-10-10)

An organization sets how many people a working shift needs. Every save that would leave a shift short says so in numbers, the calendar marks the day, and admin Danas counts it. Nothing is ever blocked.

**Capabilities covered:** CAP-21
**Standalone:** a derived signal beside collisions; with the setting empty, nothing changes.
**Implementation notes:** `domain/staffing`, derived on read (AD-1). Minimum members is current-state (AD-2 row, story 11.1), so moving it re-reports past dates, as hour bands do. It never reads fire rank or team position (FR-18a stays inert). Answers the deactivation open question (R7.4): a vacated shift shows as short-staffed.

### Epic 12: Members swap shifts, and an admin signs it off (added 2026-10-10)

A member proposes to give a shift to a colleague, optionally taking one of theirs in return. The colleague accepts, an admin approves in *Za odluku*, and the schedule changes by two roster overrides attributed to the admin.

**Capabilities covered:** CAP-22
**Standalone:** reuses Epic 9's request model and Epic 3's roster overrides.
**Implementation notes:** the AD-10 member-owned pattern of 9.2, extended to the addressee. Approval runs the AD-5 erasure check and the Epic 11 staffing check. A return shift is optional, so one-way cover is a swap with no return (default adopted 2026-10-10).

### Epic 13: Absence has a type, unused leave carries over, and a half day exists (added 2026-10-10)

An organization records absence other than annual leave without recording why, carries unused leave into the next leave year with an expiry, and records half days at 0.5.

**Capabilities covered:** CAP-23
**Standalone:** existing leave becomes annual leave and reads as before.
**Implementation notes:** amends AD-2 — absence type is current-state, leave allowance becomes **versioned per leave year** (story 13.3), because carry-over must read the previous year's allowance as it was. Q5 as amended (decision D1) is proven here. Whether the pilot records sick leave at all is asked at the presentation (story 13.1). Half-day default: one collision, and the worked half's interval counts in Band Hours (story 13.5).

### Epic 14: Every change can be read back, and printed (added 2026-10-10)

An admin reads who changed what and when — before and after, deletions included — filters it, and exports exactly what they filtered as a PDF.

**Capabilities covered:** CAP-24
**Standalone:** attribution already exists on every asserted row; this epic records every write and makes it readable.
**Implementation notes:** an Architect pass precedes 14.1. It amends AD-3 (a second permitted trigger class: append-only audit triggers that compute and refuse nothing) and AD-11 (the change history reads `audit_events`), and resolves the spine's Deferred "conflict-resolution history". Admin only (decision D4). Q12 as amended is proven here.


---

## Epic 1: An organization exists, and its people can sign in

An operator provisions an organization with its type, timezone and locale; an admin configures its identity, leave year and branding, creates teams, and issues credentials — including to members who have no email address. Every member signs in and reaches exactly their own organization's data at exactly their own permission level, and can see who is on a team.

**Capabilities:** CAP-1, CAP-2, CAP-4, CAP-5, CAP-6 · **Governed by:** AD-3, AD-9, AD-10, AD-11, AD-12, AD-14 · **Proves:** Q1, Q2, Q3, Q5, Q6, Q20 · **UX:** UX-DR1–2, 4–5, 31–32, 34, 40 (aligned with the allocation above, 2026-10-13, deferred-work sweep)

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
I want to set my organization's name, leave year and logo, and see the timezone it was provisioned with,
So that every date, time and calculation resolves against my organization rather than a default.

**Acceptance Criteria:**

**Given** an organization whose timezone is Europe/Zagreb and a viewer whose device is in another timezone
**When** any date or time is displayed
**Then** it renders in the organization's timezone, never the device's (CAP-2, L8)

**Given** the organization settings surface
**When** an admin saves it
**Then** the Organization Type, timezone and locale are unchanged — they are set at provisioning — and the timezone is shown read-only beside the form (CAP-2)

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
**Then** authentication is blocked from the effective date by the custom access token hook, which refuses a member inactive today; deactivation is the versioned write above and never calls the privileged auth function (AD-16, AD-10; 2026-10-13, deferred-work sweep)
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

*Reach since story 7.3:* on a phone the admin's bar shows Danas, Kalendar, Raspored and Ljudi plus *Više*; Sati, Godišnji and the two configuration destinations are in the *Više* sheet, not on the bar. The sidebar still lists all of them.


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

A member sees their shift counts, hours per band, total and leave — in days — for a period. An admin sees the same for everyone, sortable and filterable. Nobody enters or reconciles an hour by hand, and a member's own figures reconcile exactly with the admin's view of them. The admin can take the month away as an Excel file that matches the screen.

**Capabilities:** CAP-14 · **Governed by:** AD-6, AD-7, AD-13 · **Proves:** Q8, Q10, Q19 · **UX:** UX-DR17, 29, 44

**Sequencing note.** This epic delivers worked hours in full. CAP-14's *leave* half — the leave days, since 2026-10-10 — needs leave records, which arrive in Epic 5, so the column exists here and is populated there. Epic 4 does not depend on Epic 5 to be correct or useful; it is complete for every hour actually worked.

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
**And** leave hours are reported in their own column, which is populated once leave records exist in Epic 5 and is empty until then (reinterpreted 2026-10-10: leave in days, see spec-hours-as-on-screen-leave-in-days)

**Given** the hours table
**When** it renders
**Then** it uses tabular numerals, is sortable and filterable by team and member, and scrolls inside its own container (UX-DR17, Q16)

**Given** a member's own view of their hours and the admin's view of the same member
**When** both are open at the same moment
**Then** the figures reconcile exactly, because both derive from the same computation (CAP-14, Q19)

**Given** hours, leave balance or conflict state
**When** any of them changes
**Then** no optimistic update is shown — the figure waits rather than flickering and correcting itself (UX-DR29)

### Story 4.3: An admin exports the month's hours to Excel (added 2026-09-26, sprint change)

As an admin,
I want to download the hours I am looking at as an Excel file,
So that I can send the month onward without retyping a number.

**Acceptance Criteria:**

**Given** the Organization hours view with a period, a team or member filter, and a sort
**When** the admin chooses `Izvezi u Excel`
**Then** an `.xlsx` file downloads with exactly the rows, order and figures on screen (FR-42a)
**And** it is built from the surface's one snapshot, never a second read (AD-13, Q19)

**Given** an organization with any number of Hour Bands
**When** the file is built
**Then** it has one column per band, named by the organization's bands, next to Member, Team, shift count, Total and Leave Hours; nothing names day or night in code (DI-8) (reinterpreted 2026-10-10: leave in days, see spec-hours-as-on-screen-leave-in-days)
**And** the security fixture, whose bands split shifts, exports its split figures exactly (AD-15)

**Given** the exported figures
**When** the file is opened in a spreadsheet
**Then** every count and hour is a number, not text, and band hours sum to total on every row (DI-7)

**Given** the organization locale
**When** the file is built
**Then** headers, sheet name and file name come from `i18n`, and the file name carries the organization and period; no literal string is added outside `i18n` (AD-8, L1–L8)

**Given** a member with a shift in unresolved conflict in the period
**When** the file is built
**Then** that row carries the same distinct state the table shows (FR-41)

**Given** Epic 5 not yet delivered
**When** the file is built
**Then** the leave-hours column exists and is empty, and fills with no change to the export once leave records exist (reinterpreted 2026-10-10: leave in days, see spec-hours-as-on-screen-leave-in-days)

**Given** a member-role account
**When** any surface renders
**Then** no export action is offered, and the export needs no new RLS path because it reads nothing the table did not (Q1–Q3)

**Given** the main bundle
**When** the app loads
**Then** the XLSX writer is not in it; it loads only when the export is chosen (NFR-22, Q17)

**Given** the domain package
**When** it is inspected
**Then** it has gained no dependency and no export code (AD-7)

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
**And** the absent member's hours land as leave hours rather than worked hours (CAP-16) (reinterpreted 2026-10-10: leave in days, see spec-hours-as-on-screen-leave-in-days)

**Given** a queue of several conflicts
**When** an admin looks for a way to clear them together
**Then** no such affordance exists anywhere (UX-DR28)

**Given** any resolution
**When** time passes, or any unrelated data changes
**Then** no conflict expires, auto-clears or is suppressed under any circumstance (CAP-16, DI-4)

**Note (sprint change 2026-09-25):** for the replace-the-member outcome, where the organization uses fire ranks, candidates may be shown with rank and position — information only; nothing blocks, warns or suggests from them (FR-18a, §7.2).

**Given** the replace-the-member outcome (sprint change 2026-10-02)
**When** its candidates are listed
**Then** they keep rank and position as above (FR-18a)
**And** candidates are grouped `slobodan` / `radi taj dan · 24 h bez pauze`, informing only and never blocking (FR-50, FR-18a)
**And** the grouping is one helper, reused by story 7.9's roster dialog

**Given** a decision is recorded (sprint change 2026-10-02)
**When** the screen returns
**Then** a `Notice role="status"` line confirms it and is gone on navigation; it is not a toast and persists nowhere (UX-DR29)

**Given** the amend-leave option (sprint change 2026-10-02)
**When** it is shown
**Then** it carries the computed start date that would clear this conflict
**And** that date is unselected and is not labelled recommended (UX-DR10)

**Given** the resolution screen (sprint change 2026-10-02)
**When** the admin presses ‹ or ›
**Then** it moves to the adjacent unresolved conflict in queue order

### Story 5.5: A configuration change cannot quietly erase a pending decision

As an admin,
I want to be told when a change I am making would make a queued conflict disappear,
So that a decision I still owed someone is not silently taken off my list.

**Acceptance Criteria:**

**Given** unresolved conflicts and a rotation, roster or membership change that would remove their cause
**When** the change is saved
**Then** the unresolved collision set is computed before and after, and every collision the change would erase is surfaced in the rotation save confirmation dialog for explicit confirm, amend or discard; rotation warnings in the same dialog still do not block (AD-5, CAP-16, UX-DR23; changed by sprint change 2026-10-02)
**And** the change is not applied until they are dispositioned

**Given** rotation settings with unsaved changes (sprint change 2026-10-02)
**When** the admin scrolls the page
**Then** a sticky save bar keeps `Spremi` and `Odbaci promjene` in reach until the changes are saved or discarded

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
**And** Danas states each case in words: on shift today (type and times), free today (`Danas ne radiš`), on a 24 h duty (as one duty, per 6.2) and on leave today (sprint change 2026-10-02)
**And** while loading it shows a skeleton, never a spinner (UX-DR21)

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
**Then** they are presented as one duty: the end time as the headline, the span and total hours as metadata, a progress bar, and one leg per constituent shift marked done or in progress, and, where the leg is a replacement, the name of the member replaced (UX-DR9; changed by sprint change 2026-10-02)

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
**Then** the unresolved-conflict card (*Treba tebe*) renders first, showing `0 neriješenih konflikata` at zero and equal to the queue; today's coverage across all of them and the week follow (CAP-17; changed by sprint change 2026-10-02)

**Given** an unresolved conflict count
**When** the dashboard renders
**Then** the count is shown even when it is zero, because hiding it is indistinguishable from not having loaded (CAP-17, UX-DR20)
**And** it matches the conflict list exactly (Q19)

**Given** the dashboard
**When** it is operated by keyboard and by assistive technology
**Then** both are supported, as they are for the calendar and the conflict queue (Q22, UX-DR38)

---

## Epic 7: The app is calm on every screen

Every screen reads calm, minimal and simple on a phone and a desktop, in both themes. A pilot user finds each answer in one glance and makes each change behind one Save.

Added 2026-10-02 by `sprint-change-proposal-2026-10-02-ux-redesign.md`, from the 27 decisions approved that day in `ux-designs/ux-shift-2026-10-01-redesign/README.md` (mockups in its `mockups/` folder). Foundations 7.1–7.4 ship before Epic 6; 7.5–7.18 follow Epic 6, ordered by dependency. No completed story is rolled back: this epic rewrites the surfaces of 1.3/1.3b, 1.4, 1.8, 2.4, 3.3–3.6, 4.1b, 4.2 and 5.1/5.2 through new stories, and their original criteria stay in history.

**Capabilities:** CAP-1, CAP-4, CAP-5, CAP-13, CAP-14, CAP-15, CAP-16 (surfaces only), PRD FR-3a, FR-42b, FR-45a, FR-48a · **Governed by:** AD-8, AD-13, AD-16 · **Proves:** Q4, Q13–Q16, Q19, Q21–Q23 · **UX:** UX-DR1–2, 10, 16–17, 19–21, 23, 25, 29–34, 36, 40

### Story 7.1: Dark slot tokens are re-tuned so Noć never reads as a free day

As a member using the dark theme,
I want a night shift to look different from a free day,
So that I do not misread my schedule at a glance.

**Depends on:** none (foundation; ships before Epic 6).

**Acceptance Criteria:**

**Given** the dark theme
**When** the six working-shift slot values are re-tuned and `shift-nonworking-border` is added
**Then** the brand delta has 24 names, each defined in both light and dark (UX-DR1)
**And** `theme-fidelity` pins the new values

**Given** a *Noć* cell next to a non-working cell in the dark theme
**When** the calendar renders
**Then** they are told apart by hue, the non-working border and the always-visible label, not by luminance alone, and their contrast is re-measured by `theme-contrast` (UX-DR3, Q21)

**Given** any slot fill in either theme
**When** its label text is measured
**Then** it meets WCAG 2.1 AA contrast (Q23)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (DESIGN.md §Colors, UX-DR1)

### Story 7.2: Every number is set in DM Sans tabular figures

As a member,
I want every number to be easy to read,
So that I never misread "17" as "ı7".

**Depends on:** none (foundation; ships before Epic 6).

**Acceptance Criteria:**

**Given** any rendered number — a count, hours, a date, a time, a balance
**When** it is displayed, including large stat numerals
**Then** it is set in DM Sans with tabular figures
**And** Syne is used for words and headings only

**Given** columns of numbers in a table or a stat row
**When** they render
**Then** their digits align (UX-DR40)

**Given** the DM Sans face
**When** its coverage is checked
**Then** it renders **č ć ž š đ Č Ć Ž Đ Š** without falling back mid-word (UX-DR40)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (DESIGN.md §Typography and §Components, UX-DR40)

### Story 7.3: The phone bar has four tabs and Više

As a member or an admin on a phone,
I want every destination reachable without the tab bar scrolling sideways,
So that the tab I am on is always visible.

**Depends on:** none (foundation; ships before Epic 6).

**Acceptance Criteria:**

**Given** a phone-width viewport (390 px)
**When** a member signs in
**Then** the bottom bar shows four fixed tabs plus *Više*, with no horizontal overflow, and the active tab is always visible (Q16)

**Given** an admin on a phone
**When** the bar renders
**Then** it shows Danas, Kalendar, Raspored and Ljudi plus *Više*; Sati, Godišnji and the configuration groups sit in the *Više* sheet (UX-DR31, UX-DR32)

**Given** the theme control and Odjava
**When** a person looks for them
**Then** they are in *Više* on a phone and in the user menu on desktop, and the theme keeps its three options Sustav / Svijetla / Tamna (UX-DR2)
**And** *Više* opens as a sheet that is keyboard operable and labelled for assistive technology (Q22)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §Responsive & Platform and §IA, UX-DR2, 31, 32, story 1.8's reach)

### Story 7.4: Kalendar and Sati share one month toolbar

As a member or an admin,
I want one way to change the month on every screen that has one,
So that I do not learn two controls for the same thing.

**Depends on:** none (foundation; ships before Epic 6).

**Acceptance Criteria:**

**Given** Kalendar or Sati
**When** it renders
**Then** the month control is one shared toolbar: ‹ month ▾ ›, where the month opens a month-grid popover

**Given** the toolbar has focus
**When** the person presses PgUp or PgDn, or ‹ or ›
**Then** the month moves back or forward by one, symmetric and unbounded in both directions (UX-DR30)

**Given** the current month is shown
**When** the toolbar renders
**Then** `Ovaj mjesec` is a label, not a disabled button; on any other month it is a button that returns to the current month

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §Interaction Primitives, UX-DR30)

### Story 7.5: Filters are chips that say what is shown and clear in one action

As a member or an admin,
I want to see at once what a filter is hiding and clear it in one tap,
So that an empty result never looks like missing data.

**Depends on:** 7.4.

**Acceptance Criteria:**

**Given** Kalendar or Sati with a filter applied
**When** the toolbar renders
**Then** each active filter is a chip (Smjena, Osoba) with ✕, a summary line states what is shown, and one `Poništi filtre` clears them all without leaving the screen (UX-DR19, FR-36)
**And** in Kalendar picking a person still replaces the team (3.3b), while in Sati the two filters combine

**Given** a phone-width viewport
**When** the person opens filters
**Then** they open in a sheet, and the active chips stay visible above the content

**Given** an old Sati URL carrying `?tim=`
**When** it is opened
**Then** it redirects to the same view under `?smjena=`

**Given** a filter that matches nothing
**When** the result renders
**Then** the copy states what is true — for example `Luka Knežević nije u Smjeni B u listopadu 2026.` (UX-DR20, UX-DR34)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §Interaction Primitives, UX-DR19, 20, 34, 36)

### Story 7.6: Tables become stacked rows on a phone

As a member or an admin on a phone,
I want a table to read as a list of rows,
So that I never scroll sideways to find a number.

**Depends on:** 7.2.

**Acceptance Criteria:**

**Given** the Sati, Ljudi and shift-types tables
**When** the viewport is below 640 px
**Then** each row renders as a stacked card with its labels, and no table scrolls sideways (NFR-15, Q16)

**Given** a viewport of 640 px or wider
**When** the same tables render
**Then** they stay tables with tabular numerals, sortable as before (UX-DR17)

**Given** the stacked rows
**When** they are read by assistive technology
**Then** each value keeps its column label (Q22)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (DESIGN.md §Layout, EXPERIENCE.md §Responsive, UX-DR17)

### Story 7.7: Sign-in is one form

As a member,
I want to sign in with one form,
So that getting in takes one step, not two.

**Depends on:** PRD edit (FR-1, sprint change 2026-10-02).

**Acceptance Criteria:**

**Given** the sign-in screen
**When** it opens
**Then** it is one form — organization, username, password — with one `Prijava` button and a show/hide toggle on the password

**Given** a URL carrying the organization (`/prijava/dvd-demo`)
**When** the screen opens
**Then** the organization shows as the slug only, read-only, with `Promijeni`; no organization name or logo is looked up or shown before sign-in (Q4, NFR-4, 1.3b)
**And** without that URL the field is prefilled with the last organization used on this device, and is empty when storage is unavailable

**Given** a wrong organization, a wrong username or a wrong password
**When** sign-in fails
**Then** the same message shows for all three — `Organizacija, korisničko ime ili lozinka nisu točni.` — so the form reveals no organization or username (CAP-1)
**And** `Zaboravljena lozinka?` opens in place and says the admin sets the password

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §Key Flows, sign-in)

### Story 7.8: A member's first sign-in makes them set their own password

As a member,
I want to choose my own password the first time I sign in,
So that the password my admin read out to me does not stay my password.

**Depends on:** 7.7, PRD FR-3a, AD-16 edit (applied with this story).

**Acceptance Criteria:**

**Given** an admin creates a member or resets their password
**When** the admin-auth function runs `createUser` or `resetPassword`
**Then** it sets `app_metadata.must_set_password` on that account (AD-16)
**And** the admin's dialog shows the new four-word password once, with `Kopiraj` (FR-3a)

**Given** a session whose account carries `app_metadata.must_set_password`
**When** any route other than setting a password is requested
**Then** a route guard keeps it closed and shows the set-password step (FR-1, FR-3a)

**Given** the member saves a new password
**When** `auth.updateUser({ password })` succeeds
**Then** the one added function operation clears `app_metadata.must_set_password` for the calling user only, and the member continues to their landing surface
**And** no caller can clear the flag for another account

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §Key Flows, sign-in), with ARCHITECTURE-SPINE.md AD-16 and the claim-code deferred note

### Story 7.9: Day detail changes open in their own dialogs

As an admin,
I want each change to a day to open its own small dialog,
So that I see what will change before I save it.

**Depends on:** 7.5, 5.4's candidate-grouping helper.

**Acceptance Criteria:**

**Given** day detail
**When** it opens
**Then** it is one readable dialog of facts — the conflict with `Riješi konflikt`, the roster as `Ime · čin · položaj`, and the changes — with no inline form

**Given** `Promijeni sastav` or `Promijeni tip smjene`
**When** the admin chooses it
**Then** it opens its own dialog with one Save, showing a computed *Što se mijenja* before saving
**And** replacement candidates are grouped by availability with 5.4's helper, informing only (FR-18a, FR-50)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §Component Patterns, UX-DR10, 23)

### Story 7.10: A member's own schedule shows their leave and no conflict marks

As a member,
I want my own schedule to show my leave and nothing meant for the admin,
So that I am not alarmed by a decision that is not mine to make.

**Depends on:** PRD FR-38 edit (CAP-13 role qualifier).

**Acceptance Criteria:**

**Given** a member-role account in *Moj raspored*
**When** they have leave in the month
**Then** their leave dates show with the leave mark (UX-DR8)
**And** no conflict mark (`⚠`) renders anywhere on their calendar (FR-38)

**Given** an admin on the calendar
**When** an unresolved conflict exists
**Then** it is still visible without opening detail, unchanged from 5.3c (CAP-13)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §State Patterns)

### Story 7.11: The member page shows facts and each change opens one dialog

As an admin,
I want a member's page to read as facts with one Save per change,
So that a hurried click never moves someone to the wrong team.

**Depends on:** none.

**Acceptance Criteria:**

**Given** a member's page
**When** it opens
**Then** it shows the person's facts under their name, with no stacked forms

**Given** a change to role, team, allowance, rank or status
**When** the admin chooses it
**Then** it opens its own dialog with one Save
**And** a team change starts empty, never preselecting a different team

**Given** the allowance (*Dani godišnjeg*)
**When** the page renders
**Then** it sits in the leave section

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (DESIGN.md §Components, EXPERIENCE.md §Component Patterns and §IA)

### Story 7.12: The leave dialog shows what a record costs and creates before saving

As an admin,
I want to see a leave record's cost, balance and conflicts before I save it,
So that I know what I am agreeing to.

**Depends on:** 7.11.

**Acceptance Criteria:**

**Given** the leave dialog on the member page
**When** the admin enters a range
**Then** it shows, before saving, the cost in leave days, the remaining balance and the conflicts the record will create, in neutral text (CAP-15, CAP-16)
**And** the conflict preview is the domain collision function, never a second implementation (Q8)

**Given** an amend
**When** the range changes
**Then** the dialog shows *bilo / sada* and which conflicts clear

**Given** a removal
**When** the admin chooses it
**Then** one neutral confirmation asks it (UX-DR27)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §Component Patterns, UX-DR23)

### Story 7.13: Ljudi shows each member's status and adds a member in a dialog

As an admin,
I want to filter people by status and add someone without leaving the list,
So that the list answers who is active and adding a person is quick.

**Depends on:** 7.6, 7.11.

**Acceptance Criteria:**

**Given** Ljudi
**When** it renders
**Then** it has a status filter chip and a status column that marks scheduled changes (FR-15)

**Given** `Novi član`
**When** the admin chooses it
**Then** a short dialog creates the member and ends by showing the password once

**Given** a deactivation
**When** the admin chooses it
**Then** one neutral question asks it, with a date and the consequence in numbers (UX-DR27)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (DESIGN.md §Components, EXPERIENCE.md §Component Patterns and §IA)

### Story 7.14: An hours figure explains itself

As an admin or a member,
I want to open any hours figure and see what composes it,
So that I can answer a question about a number without reconstructing it.

**Depends on:** 7.6, PRD FR-42b.

**Acceptance Criteria:**

**Given** any figure on Sati
**When** its ⓘ is chosen
**Then** a drawer lists the shifts and bands that compose it — rotation, changes and leave — as an equation with dates (FR-42b)
**And** the equation comes from `domain/hours` as codes and operands, and sums exactly to the figure (AD-8, DI-7)

**Given** the organization hours table
**When** it renders
**Then** it has a footer total, and the export keeps a status line about the downloaded file (FR-42a)

**Given** a member's own hours
**When** the page opens
**Then** its title is *Moji sati*

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §IA, UX-DR33)

### Story 7.15: An admin sees everyone's leave in one overview

As an admin,
I want every member's allowance, days used and balance on one screen,
So that I can see who still has leave without opening each person.

**Depends on:** 7.6, PRD FR-45a.

**Acceptance Criteria:**

**Given** an admin on Godišnji
**When** the overview opens
**Then** every member appears with allowance, days used and balance for the leave year, and allowance minus used equals balance on every row (FR-45a)
**And** each row equals that member's own view (Q19)

**Given** a member-role account
**When** it requests the overview
**Then** it is refused, and the member sees only their own leave (FR-5, CAP-5)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §IA, UX-DR33)

### Story 7.16: Resolved conflicts stay readable

As an admin,
I want to see conflicts already decided, and how,
So that I can answer who decided what without asking around.

**Depends on:** 5.4, PRD FR-48a and its §7.2 carve-out.

**Acceptance Criteria:**

**Given** Raspored
**When** it opens
**Then** it has *Neriješeni* and *Riješeni* tabs, and *Neriješeni* stays the default and keeps its count even at zero (UX-DR20, UX-DR25)

**Given** the *Riješeni* tab
**When** it renders
**Then** each entry shows date, team, shift type, member, the resolution, the acting admin and the timestamp, read from `conflict_resolutions` only (FR-48a, Q11)
**And** it offers no other change history, because it is not an audit-log UI (§7.2)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §IA, UX-DR25, 33)

### Story 7.17: Members find the directory by team in Više

As a member,
I want to see who is on each team from one place,
So that I do not have to find a team first to see its people.

**Depends on:** 7.3, PRD FR-16 edit (CAP-5).

**Acceptance Criteria:**

**Given** a member-role account
**When** they open the directory from *Više*
**Then** it lists members grouped by team, read-only (CAP-5, FR-16)
**And** it shows name, team and, where used, rank and position — no allowance, balance, leave, hours or contact details

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §IA, UX-DR33)

### Story 7.18: Organization settings show facts and change through dialogs

As an admin,
I want organization settings to read as facts with a dialog per change,
So that I change one thing at a time.

**Depends on:** none.

**Acceptance Criteria:**

**Given** Organizacija
**When** it opens
**Then** it is a page of facts, each change opens its own dialog with one Save, and the accent picker uses named radio cards (UX-DR5)
**And** the timezone is shown locked, and the page says why (FR-8)

**Given** *Povijest rotacije*
**When** the admin looks for it
**Then** it sits behind a header button rather than on the page

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (DESIGN.md §Components, EXPERIENCE.md §Component Patterns and §IA)

## Epic 8: The app installs, and the schedule reads without a connection

A member adds Shift to their phone's home screen and opens it on a truck with no signal: the last schedule they saw is there, with the time it is from, and nothing pretends to save.

Added 2026-10-10 by `sprint-change-proposal-2026-10-10-v1-scope-expansion.md` (approved that day). Epics 8–14 ship in priority order, after Epic 7.

**Capabilities:** CAP-18 · **Governed by:** AD-13 (amended by 8.2), AD-14 · **Proves:** Q13, Q19, Q24 · **UX:** UX-DR31, 45

### Story 8.1: The app is installable

As a member,
I want to install Shift on my phone's home screen,
So that it opens like an app instead of a browser tab.

**Depends on:** none.

**Acceptance Criteria:**

**Given** a supported browser on Android or iOS
**When** the app is opened
**Then** it offers a web app manifest with name, icons, theme colours for both themes and a start URL, and a service worker that caches the app shell (CAP-18)

**Given** a new version is deployed
**When** an installed app next opens online
**Then** it states that a new version is ready and reloads on the member's action, never mid-task

**Given** the installed name
**When** this story is specified
**Then** the human decides it, since the PRD's "Shift" is a working title; the manifest is not organization-specific in v1 (spine Deferred)

**Given** this story ships
**When** it is merged
**Then** the spine's Stack table names the PWA plugin and its pinned version, and the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change

### Story 8.2: Surfaces read offline

As a member,
I want the screens I already opened to show their last state with no connection,
So that I can see when I work even without signal.

**Depends on:** 8.1. Applies the AD-13 amendment row.

**Acceptance Criteria:**

**Given** a surface was read online
**When** it opens offline
**Then** it renders its last snapshot whole, from the persisted query cache (IndexedDB), under a `Notice` reading `Bez veze · stanje od {datum} {vrijeme}` (UX-DR45, Q24)
**And** no figure from the cache is shown beside a fresh one (Q19, AD-13)

**Given** the member opens Danas online
**When** it loads
**Then** their current and next month are prefetched so Danas and Kalendar read offline

**Given** the connection returns
**When** the surface refetches
**Then** the as-of note disappears and the whole surface renders from the fresh snapshot

**Given** this story ships
**When** it is merged
**Then** AD-13 carries the offline clause, and the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §State Patterns, UX-DR45)

### Story 8.3: Offline writes are refused, and signing out clears the device

As a member,
I want the app to say plainly that nothing saves offline, and to leave nothing behind when I sign out,
So that I never think a change saved when it did not, and a shared phone keeps nobody's data.

**Depends on:** 8.2.

**Acceptance Criteria:**

**Given** the app is offline
**When** any write control is shown
**Then** it states that it needs a connection, and nothing is queued for later (no optimistic writes, UX-DR29)

**Given** a member signs out
**When** sign-out completes
**Then** every persisted snapshot is removed from the device (Q24)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (UX-DR45)

### Story 8.4: Install from Više

As a member,
I want to find how to install the app in one place,
So that I do not need someone to show me.

**Depends on:** 8.1.

**Acceptance Criteria:**

**Given** the app is not installed
**When** the member opens *Više*
**Then** *Instaliraj* offers the browser's install prompt where it exists, and on iOS Safari states the Share → Add to Home Screen steps; it is never a modal on first visit (UX-DR45)

**Given** the app is installed
**When** *Više* opens
**Then** *Instaliraj* is not shown

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §IA, UX-DR31)

## Epic 9: A member asks for leave, and an admin decides

A member requests a leave range from their phone and sees what it would cost. An admin sees the request in *Za odluku* with the conflicts it would raise and decides it; on approval the leave exists. Until then nothing in the schedule moved.

Added 2026-10-10 by `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`. Story 9.1 renames the shipped surfaces of 5.3b, 5.4, 6.3 and 7.16; their original criteria stay in history.

**Capabilities:** CAP-19 · **Governed by:** AD-4 and AD-10 (amended by 9.2), AD-5, AD-11 · **Proves:** Q2, Q11 · **UX:** UX-DR12, 23, 25, 31–33, 46, 47, 52

### Story 9.1: Raspored becomes Za odluku, and no screen says konflikt

As an admin,
I want the place where decisions wait to be named for what it is,
So that a member going on leave never reads as a conflict.

**Depends on:** none.

**Acceptance Criteria:**

**Given** the sidebar, the phone bar and the queue page
**When** they render
**Then** *Raspored* reads *Za odluku*, its tabs *Čeka odluku* (default, count kept at zero) and *Odlučeno*, and the old URL redirects to the new one (UX-DR25, UX-DR32)

**Given** any Croatian string
**When** the locale resource is checked
**Then** none contains *konflikt*: a collision item reads *Odsutnost u smjeni*, the count `# čeka odluku` / `# čekaju odluku` in three plural forms, the button *Odluči*, the legend ⚠ *čeka odluku*, the erasure dialog *Promjena uklanja N stavki koje čekaju odluku*, the back link *Natrag na Za odluku* (UX-DR46, L7)
**And** a test fails the build if *konflikt* reappears in `hr.json`

**Given** code, docs and the glossary
**When** they name the domain state
**Then** "Conflict" stays the domain term (DI-4, AD-4); only the Croatian UI changes

**Given** this story ships
**When** it is merged
**Then** the e2e page objects follow the new names, and the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §IA, UX-DR12, 23, 25, 32, 46)

### Story 9.2: The leave request record

As a member,
I want my leave request stored as mine and nothing more,
So that asking changes nothing until an admin decides.

**Depends on:** 9.1. Applies the AD-4 and AD-10 amendment rows.

**Acceptance Criteria:**

**Given** `leave_requests` and `leave_request_decisions`
**When** a member-role account writes
**Then** it may insert a request only for itself and withdraw only its own pending request; the member is read from the AD-10 helper, never from the request (AD-10, Q1–Q3)
**And** it can write no decision, no Leave Record and nobody else's request, through the UI or a direct API call (Q2)

**Given** a pending request
**When** any surface derives conflicts, balance, hours or rosters
**Then** the request changes nothing (R9.1)

**Given** a request overlapping the member's existing leave or another pending request of theirs
**When** it is inserted
**Then** it is refused by schema shape (R9.4, AD-3)

**Given** a decision
**When** it is recorded
**Then** it carries the acting admin and timestamp by column default (AD-11)

### Story 9.3: A member requests leave and sees what it costs

As a member,
I want to ask for leave from Godišnji and see its cost before sending,
So that I know what I am asking for.

**Depends on:** 9.2.

**Acceptance Criteria:**

**Given** *Godišnji* for a member
**When** they choose *Zatraži godišnji*
**Then** a form takes the range and shows the cost in days and the balance after it before one *Pošalji*, computed by `domain/leave` (UX-DR47, CAP-19)

**Given** the member's requests
**When** *Godišnji* renders
**Then** it lists pending, approved, rejected and withdrawn requests, and a pending one can be withdrawn

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §IA, UX-DR31, 33, 47)

### Story 9.4: An admin decides a leave request on its own screen

As an admin,
I want to see what approving a request would do before I decide,
So that I approve with the conflicts in front of me.

**Depends on:** 9.2.

**Acceptance Criteria:**

**Given** a pending request
**When** the admin opens it
**Then** it shows the cost, the balance after it, the conflicts approval would create, and — once Epic 11 has shipped — any short-staffed shift, computed by the same rules as a direct leave save (R9.3); none of it blocks

**Given** the admin approves
**When** the decision lands
**Then** a Leave Record attributed to that admin exists, its conflicts appear, and the request reads approved (R9.2)

**Given** the admin rejects
**When** the decision lands
**Then** nothing but the decision is recorded

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (UX-DR33, 46)

### Story 9.5: Za odluku lists requests beside collisions

As an admin,
I want every item that waits for me in one queue,
So that one count tells me what needs me.

**Depends on:** 9.4.

**Acceptance Criteria:**

**Given** *Čeka odluku*
**When** it renders
**Then** it lists unresolved collisions and pending requests soonest-first, each naming its kind in words (UX-DR46)
**And** the admin Danas count equals the queue exactly, shown at zero (FR-48, FR-53)

**Given** *Odlučeno*
**When** it renders
**Then** it lists decided requests beside decided collisions, each with the decision, the acting admin and the time; it is still not a history surface (UX-DR52, FR-48a)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (UX-DR25, 46, 52)

## Epic 10: People hear about what concerns them

A member learns by email or push that their request was decided or their shifts changed; an admin learns that something waits in *Za odluku*.

Added 2026-10-10 by `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`. An Architect pass (`bmad-architecture`, update intent) over AD-14, AD-17 and the new AD-18 precedes 10.1.

**Capabilities:** CAP-20 · **Governed by:** AD-14 and AD-17 (amended), AD-18 (new), AD-8 · **Proves:** Q25 · **UX:** UX-DR31, 49

### Story 10.1: The outbox and the notify function

As the product owner,
I want notifications to leave through one place that computes nothing,
So that a message can never say something the data does not.

**Depends on:** the Architect pass. Applies the AD-14, AD-17 and AD-18 amendment rows.

**Acceptance Criteria:**

**Given** `notification_outbox`
**When** a fact is asserted that a notification reports
**Then** the same request writes the outbox row as codes and operands (AD-18, AD-8)

**Given** the `notify` Edge Function on its schedule
**When** it runs
**Then** it sends each row at most once per recipient and channel, writes only delivery columns, renders text from the shared locale resource by code, and computes no domain answer (Q25, AD-14)

**Given** each environment
**When** it is deployed
**Then** the email provider key and the VAPID private key exist only in `notify`'s environment, and DEPLOY.md names them (AD-17)

### Story 10.2: Email tells people what concerns them

As a member,
I want an email when something about my own shifts or requests changes,
So that I find out without opening the app.

**Depends on:** 10.1, 9.4.

**Acceptance Criteria:**

**Given** a member with an email address
**When** their leave request is decided; their shifts change by a roster or shift-type override, a swap, or a rotation change effective within the next 30 days; or an admin records leave for them
**Then** they receive one email naming the facts and linking to the surface (CAP-20)

**Given** a new item in *Za odluku*
**When** it is created
**Then** every admin with an email address receives one email

**Given** any email to a member-role account
**When** it is rendered
**Then** it names nothing about another member's leave or absence type (Q5)

### Story 10.3: Notification settings in Više

As a member,
I want to turn each kind of notification on or off,
So that I get only what I want.

**Depends on:** 10.2.

**Acceptance Criteria:**

**Given** *Više* → *Obavijesti*
**When** it opens
**Then** email has an on/off with the address, or reads `Nemaš upisan e-mail`; push has an on/off, or reads `Instaliraj aplikaciju za obavijesti` where install is required (UX-DR49)

**Given** a channel turned off
**When** an event occurs
**Then** nothing is sent on that channel

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §IA, UX-DR31, 33, 49)

### Story 10.4: Web Push reaches members without email

As a member without an email address,
I want push notifications once I install the app,
So that I am not left out.

**Depends on:** 10.3, 8.1.

**Acceptance Criteria:**

**Given** an installed app with permission granted
**When** the member turns push on
**Then** a subscription is stored for that member only, and the same events as email arrive as push (CAP-20)

**Given** iOS before install
**When** push settings render
**Then** they state that push needs the installed app (iOS 16.4+)

**Given** a subscription the push service reports gone
**When** `notify` sends to it
**Then** it is removed and nothing else changes

## Epic 11: A shift short of people is impossible to miss

An organization sets how many people a working shift needs. Every save that would leave a shift short says so in numbers, the calendar marks the day, and admin Danas counts it. Nothing is ever blocked.

Added 2026-10-10 by `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`.

**Capabilities:** CAP-21 · **Governed by:** AD-1, AD-2 (amended by 11.1), AD-7, AD-8 · **Proves:** Q9, Q21 · **UX:** UX-DR4, 8, 12, 23, 48

### Story 11.1: The staffing rule and the minimum-members setting

As an admin,
I want to set how many people a shift needs,
So that the app can tell me where a shift falls short.

**Depends on:** none. Applies the AD-2 row for minimum members (current-state).

**Acceptance Criteria:**

**Given** `domain/staffing`
**When** it derives a working Scheduled Shift
**Then** people at work = the roster after overrides, minus everyone absent that date, plus replacements (R10.1), and the shift is short-staffed when that is below the minimum (R10.2), derived on read and never stored (R10.3, AD-1)
**And** the R10.5 worked example holds against both fixtures: pilot teams of 4, minimum 3 — one member on leave leaves 3 at work, not short; two on leave is short (AD-15)
**And** it never reads fire rank or team position (FR-18a)

**Given** *Organizacija*
**When** the admin sets *Najmanje ljudi u smjeni*
**Then** it saves a positive whole number or empty; empty reports nothing; the demo seed sets 3

**Given** this story ships
**When** it is merged
**Then** the spine's AD-2 table carries the row, and the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change

### Story 11.2: Every save that can cause it shows a short-staffed shift

As an admin,
I want to see before saving that a change leaves a shift short,
So that I never find out on the day.

**Depends on:** 11.1.

**Acceptance Criteria:**

**Given** the leave dialog, a request approval, the roster and type dialogs, a conflict resolution, a deactivation or a rotation save
**When** the change would leave a working shift short-staffed
**Then** *Što se mijenja* shows a block, not a quiet line: `Smjena B, 14.10. Dan: rade 2 od najmanje 3`, from the same "after" snapshot as its erasure check (UX-DR48, UX-DR23)
**And** the save still goes through (R10.4)

**Given** a conflict resolution
**When** its consequence strip renders
**Then** the coverage term states the people at work against the minimum (UX-DR11)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (UX-DR11, 23, 48)

### Story 11.3: The calendar day marks a short-staffed shift

As an admin,
I want short-staffed days marked on the calendar,
So that I see them without opening each day.

**Depends on:** 11.1.

**Acceptance Criteria:**

**Given** an admin's calendar
**When** a working shift is short-staffed
**Then** its cell carries a fifth glyph and the `warning` token, with a legend entry, never `destructive` or accent, and never by colour alone (UX-DR8, 12, 48, Q21)
**And** the cell's accessible label names it

**Given** day detail
**When** it opens on that shift
**Then** it states `rade 2 od najmanje 3`

**Given** this story ships
**When** it is merged
**Then** the `warning` token is defined in light and dark and contrast-verified, and the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (DESIGN.md §Colors, UX-DR4, 8, 12, 48)

### Story 11.4: Admin Danas counts short-staffed shifts

As an admin,
I want Danas to tell me how many shifts are short,
So that I see it on landing.

**Depends on:** 11.3.

**Acceptance Criteria:**

**Given** admin Danas with the setting on
**When** it renders
**Then** a card beside *Za odluku* counts short-staffed shifts ahead, shown at zero, linking to their dates (UX-DR48, UX-DR20)
**And** the count equals the calendar marks from the same snapshot (AD-13, Q19)
**And** *Pokrivenost danas* derives its coverage from the day detail's `dayDetailOf` rather than its own `coverageOf`, so it equals the day detail by construction and AD-13's recorded exception is closed (epics 5–7 retro R1; added 2026-10-13, deferred-work sweep)

**Given** the setting is empty
**When** Danas renders
**Then** the card is not shown

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §Key Flows, UX-DR48)

## Epic 12: Members swap shifts, and an admin signs it off

A member proposes to give a shift to a colleague, optionally taking one of theirs in return. The colleague accepts, an admin approves in *Za odluku*, and the schedule changes by roster overrides attributed to the admin.

Added 2026-10-10 by `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`. A return shift is optional (default adopted 2026-10-10).

**Capabilities:** CAP-22 · **Governed by:** AD-4, AD-5, AD-10, AD-11 · **Proves:** Q2, Q11 · **UX:** UX-DR31, 33, 46, 47, 52

### Story 12.1: The swap request record

As a member,
I want my swap proposal stored as a proposal,
So that nothing moves until it is agreed and approved.

**Depends on:** 9.2.

**Acceptance Criteria:**

**Given** `swap_requests` and their decisions
**When** they are written
**Then** a proposal names the proposer's shift (date, team) and the addressee, and optionally the addressee's shift in return; its states are proposed → accepted or declined → approved or rejected, or withdrawn

**Given** RLS
**When** a member-role account writes
**Then** only the proposer inserts and withdraws, only the addressee accepts or declines, and only an admin approves or rejects, through the UI or a direct API call (AD-10, Q2)

**Given** any state before approval
**When** a surface derives the schedule
**Then** nothing changes (R9.1)

### Story 12.2: A member proposes a swap from the day detail

As a member,
I want to propose a swap from my shift's day detail,
So that I ask for it where I see the shift.

**Depends on:** 12.1.

**Acceptance Criteria:**

**Given** the member's own working shift in day detail
**When** they choose *Predloži zamjenu*
**Then** a form takes a colleague and an optional return shift, shows each member's consequence in hours, and sends with one *Pošalji* (UX-DR47)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §IA, UX-DR31, 33, 47)

### Story 12.3: The colleague accepts or declines

As a member,
I want to answer a swap addressed to me from Danas,
So that I agree before an admin sees it.

**Depends on:** 12.2.

**Acceptance Criteria:**

**Given** a swap addressed to the member
**When** Danas renders
**Then** it shows the swap and its consequence for them, with *Prihvati* and *Odbij*

**Given** acceptance
**When** it lands
**Then** the swap enters *Za odluku* for admins; a decline closes it and the proposer sees it declined

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change

### Story 12.4: An admin decides a swap on its own screen

As an admin,
I want to see what a swap does before approving it,
So that a swap never leaves a shift short or puts someone on leave to work.

**Depends on:** 12.3, 11.1.

**Acceptance Criteria:**

**Given** an accepted swap
**When** the admin opens it
**Then** it shows each member's hour delta, any leave or double booking, and any short-staffed result; none blocks (CAP-22, R9.3)

**Given** approval
**When** it is saved
**Then** it writes Roster Overrides replacing the proposer with the addressee, and the addressee with the proposer where a return shift exists, with reason `swap`, attributed to the admin (R9.2, AD-11), through the AD-5 erasure check

**Given** *Odlučeno*
**When** it renders
**Then** it lists the decided swap with the decision, the admin and the time (UX-DR52)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (UX-DR33, 46, 52)

## Epic 13: Absence has a type, unused leave carries over, and a half day exists

An organization records absence other than annual leave without recording why, carries unused leave into the next leave year with an expiry, and records half days at 0.5.

Added 2026-10-10 by `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`. It changes the leave surfaces of 5.1, 5.2, 7.12 and 7.15 through new stories; their original criteria stay in history.

**Capabilities:** CAP-23 · **Governed by:** AD-2 (amended by 13.1 and 13.3), AD-3, AD-8 · **Proves:** Q5 (amended), Q9, Q19 · **UX:** UX-DR12, 17, 47, 50

### Story 13.1: Absence types are organization data

As an admin,
I want to define the kinds of absence my organization records,
So that sick leave or training is not recorded as annual leave.

**Depends on:** none. Applies the AD-2 row for absence type (current-state).

**Acceptance Criteria:**

**Given** `absence_types`
**When** an admin defines one
**Then** it has a name and whether it draws down the allowance, and no reason, diagnosis or free-text field exists on it or on any Leave Record (Q5)

**Given** an existing organization
**When** the migration runs
**Then** annual leave is seeded as a drawing type and every existing Leave Record becomes annual leave, its figures unchanged

**Given** this story is specified
**When** the pilot's needs are confirmed at the presentation
**Then** whether the pilot records sick leave at all is recorded in the story spec

### Story 13.2: Leave has a type everywhere it is recorded or reported

As an admin,
I want to choose the type when recording absence and see it reported by type,
So that hours and balances stay right.

**Depends on:** 13.1.

**Acceptance Criteria:**

**Given** the leave dialog and the request form
**When** they open
**Then** a radio card group chooses the type (UX-DR50, UX-DR47)

**Given** any type
**When** it covers a rostered working shift
**Then** it raises a conflict; only drawing types change the balance (CAP-23)

**Given** another member's absence
**When** a member-role account sees it
**Then** it reads *odsutan*, never the type (Q5)

**Given** Sati and the Excel file
**When** they render
**Then** they show a days column per drawing type and one for the rest, named by organization data (DI-8, FR-42a)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (UX-DR12, 17, 50)

### Story 13.3: The allowance is set per leave year

As an admin,
I want each member's allowance recorded per leave year,
So that last year's figures stay what they were.

**Depends on:** none. Applies the AD-2 row for leave allowance (versioned per leave year).

**Acceptance Criteria:**

**Given** `leave_allowances`
**When** the migration runs
**Then** each member's current single value becomes their allowance for the current leave year, and every balance reads as before

**Given** an allowance changed for this year
**When** a past year's balance is derived
**Then** it uses that year's allowance

### Story 13.4: Unused leave carries over and expires

As a member,
I want unused leave carried into the next year until its expiry,
So that days I did not take are not lost at the turn of the year.

**Depends on:** 13.3.

**Acceptance Criteria:**

**Given** the organization's carry-over setting (maximum days, expiry date; Croatian practice is 30.06.)
**When** a leave year begins
**Then** carried-over days are derived from the previous year's unused balance, capped by the maximum, and expire on the date (R4.13–R4.15); nothing derived is stored (AD-1)

**Given** a drawing record in the new year
**When** its cost is charged
**Then** carried days are consumed before the current allowance

**Given** the member's tiles and the leave overview
**When** they render
**Then** they show carried days and their expiry, and allowance plus carried minus used equals balance on every row (Q19)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change

### Story 13.5: A half-day record costs half a day

As an admin,
I want to record a half day,
So that half a shift away is not charged as a whole day.

**Depends on:** 13.2.

**Acceptance Criteria:**

**Given** a one-date record
**When** the admin marks it a half day, first or second half of the shift
**Then** it costs 0.5 (CAP-23)

**Given** a half-day record on a rostered working shift
**When** collisions and hours derive
**Then** it raises one collision, and the worked half's interval counts in Band Hours by intersection (DI-7); the story spec may refine this default

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (UX-DR47, 50)

## Epic 14: Every change can be read back, and printed

An admin reads who changed what and when — before and after, deletions included — filters it, and exports exactly what they filtered as a PDF.

Added 2026-10-10 by `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`. An Architect pass over AD-3 and AD-11 precedes 14.1. Admin only (decision D4).

**Capabilities:** CAP-24 · **Governed by:** AD-3 and AD-11 (amended by 14.1), AD-13 · **Proves:** Q11, Q12 (amended) · **UX:** UX-DR32, 33, 51

### Story 14.1: Every change is recorded in the change history

As an admin,
I want every write recorded with its author and before/after values,
So that a deletion leaves a trace.

**Depends on:** the Architect pass. Applies the AD-3 and AD-11 amendment rows.

**Acceptance Criteria:**

**Given** every organization table
**When** a row is inserted, updated or deleted
**Then** an append-only trigger copies `OLD`/`NEW`, `auth.uid()` and `now()` into `audit_events`, computing and refusing nothing (AD-3); the Q6 trigger stays the only refusing one

**Given** RLS on `audit_events`
**When** a member-role account reads
**Then** it reads nothing, through the UI or a direct API call (Q2, D4)

**Given** the migration
**When** it runs
**Then** history before it is backfilled from existing attribution columns where they exist, and deletions before it are stated as unrecoverable

### Story 14.2: An admin reads the change history

As an admin,
I want to read who changed what, filtered,
So that I can answer what happened without asking around.

**Depends on:** 14.1.

**Acceptance Criteria:**

**Given** *Povijest promjena* under *Pregled*
**When** it opens
**Then** a table (stacked rows below 640 px) shows time, author, kind, subject and *bilo → sada* in words from codes, with chips for period, member, team and kind (UX-DR51, L4)

**Given** this story ships
**When** it is merged
**Then** the DESIGN.md / EXPERIENCE.md / UX-DR lines this story changes are updated in the same change (EXPERIENCE.md §IA, UX-DR32, 33, 51)

### Story 14.3: The change history exports to PDF

As an admin,
I want to export the filtered history as a PDF,
So that I can hand it on.

**Depends on:** 14.2.

**Acceptance Criteria:**

**Given** a filtered history
**When** the admin chooses `Izvezi u PDF`
**Then** the file holds exactly the filtered rows in their order, built from the rendered snapshot and never a second read, with the organization name, the period and the generation time (UX-DR51, AD-13)
**And** the PDF writer is lazily loaded in `apps/web` only, and the spine's Stack table names its pinned version
