---
id: SPEC-shift
companions:
  - glossary.md
  - engine-rules.md
  - localization.md
  - quality-requirements.md
  - experience-direction.md
  - ../../planning-artifacts/prds/prd-shift-2026-09-01/addendum.md
  - ../../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md
  - ../../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md
  - ../../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md
sources:
  - ../../planning-artifacts/prds/prd-shift-2026-09-01/prd.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Shift — Shift Management Platform

Vocabulary is fixed in `glossary.md`; every term below is used exactly as defined there. This kernel fixes product intent; the realized interface contract is fixed in the adopted `EXPERIENCE.md` (information architecture, behaviour, states, flows) and `DESIGN.md` (visual system), and the consistency invariants everything is built from are fixed in the adopted `ARCHITECTURE-SPINE.md` (cited by `AD-` id). All three are binding and not restated here.

## Why

**A pain to solve, and an opportunity to claim.** Organizations that run people through recurring shift rotations — emergency services, security firms, care providers, plants, warehouses, hospitality — manage the rota in spreadsheets, paper, and group chats. Three failures follow: the rotation pattern is tribal knowledge held by one person, so nobody else can answer "who is on nights next Tuesday?"; worked hours are reconstructed by hand after the month closes, split day and night, and disputed; and leave is agreed verbally without checking the rota, so the collision surfaces as an uncovered shift on the day it happens. Off-the-shelf scheduling SaaS models individual shift assignments and bolts patterns on afterwards, which fits organizations whose operation *is* a fixed multi-team rotation badly enough that they stay on the spreadsheet.

The opportunity is that the same generic engine serves every one of those industries, because the underlying objects — teams, shift types, a repeating pattern, offsets, hours, leave — are identical across all of them. The first customer is a Croatian volunteer fire department running four teams on a 24-hour-on / 48-hour-off rota. It is tenant number one, not the product's shape.

## Capabilities

- **CAP-1 — Authenticated, tenant- and role-scoped access**
  - **intent:** A member signs in and reaches exactly their own organization's data at exactly their own permission level; an operator provisions organizations and an admin issues member credentials.
  - **success:** A valid sign-in yields a session scoped to one organization and one role. A cross-tenant read with a valid session fails at the data layer. Every administrative write is refused for a member-role account whether attempted through the UI or a direct API call. A usable member account is created with no email address present; such an account signs in by admin-issued username, and its password reset is an admin action rather than a self-service email.

- **CAP-2 — Organization configuration and branding**
  - **intent:** An admin configures the organization's identity, timezone, locale, leave year, and logo, so every downstream calculation and display resolves against organization data rather than defaults.
  - **success:** All dates and times display in the organization timezone, not the viewer's device timezone. Two organizations differing only in organization type produce byte-identical schedules, hours, and conflicts. An organization with no logo renders a neutral fallback; an uploaded logo is unreadable to other organizations.

- **CAP-3 — Configurable day/night boundary**
  - **intent:** An admin defines the organization's hour bands — the named windows of the day that hours are reported under — so day and night are a setting rather than a built-in assumption.
  - **success:** Bands partition the full 24 hours; a configuration leaving a gap or an overlap is refused. A band may cross midnight. Moving a boundary recomputes reported band hours for affected shifts and changes no total. An organization defining three bands reports three figures with no code change. See `engine-rules.md`.

- **CAP-4 — Member management**
  - **intent:** An admin creates, edits, activates, and deactivates members with a role, a team, and a leave allowance, and works the list at scale via search, sort, and filter.
  - **success:** Deactivation preserves all historical shifts, overrides, hours, and leave records, blocks authentication, removes the member from future rosters, and alters no past shift. Leave allowance is per member, never an organization-wide constant. An organization cannot be left with zero admins.

- **CAP-5 — Team roster visibility**
  - **intent:** A member sees who is on a team — their own first, any team on request — without administrative data being exposed.
  - **success:** A roster shows member names and team membership and exposes no member's leave allowance, balance, leave records, hours, or contact details. No write action is reachable from it for a member-role account. The roster is not a top-level destination: it is reached through a team's context, from the member's own dashboard, schedule, or the calendar. See `EXPERIENCE.md`.

- **CAP-6 — Teams of any number**
  - **intent:** An admin creates and names teams freely, and assigns each member to at most one, so the rotation has something to project onto.
  - **success:** An organization works with any team count from one upward; no code path assumes four, and no team name carries special meaning. A member with no team has an empty schedule and generates no conflicts. Moving a member between teams changes their schedule forward only and rewrites no history.

- **CAP-7 — Configurable shift types, including midnight-crossing**
  - **intent:** An admin defines reusable working and non-working periods by name and times, and the system treats a period spanning midnight as one continuous shift.
  - **success:** A 19:00–07:00 shift type has a nominal duration of 12 hours, produces exactly one scheduled shift attributed to its start date, and is never split or counted twice. A 24-hour shift type is valid. Nominal duration is derived from the times, never entered. No shift type field names or implies an hour band. Editing a shift type's times changes no already-reported hours for past dates; renaming one takes effect everywhere.

- **CAP-8 — Rotation pattern definition and team assignment**
  - **intent:** An admin defines a repeating sequence of shift types of arbitrary length and binds each team to it at an offset from an anchor date, so the whole schedule is determined by a handful of records.
  - **success:** Cycle length is arbitrary and nothing assumes a weekly cycle. Given pattern, offset, and anchor date, the shift type for any date — before or after the anchor — is deterministic and reproducible. Teams may share a pattern at different offsets, or at the same offset. An offset outside the cycle is refused at save: it names no position in the pattern, so projection has no defined answer. See `engine-rules.md`.

- **CAP-9 — Rotation change with an effective date**
  - **intent:** An admin edits a pattern or assignment from a chosen date forward, without disturbing history or silently discarding recorded exceptions.
  - **success:** Shifts before the effective date are unchanged. Overrides on or after it are listed for explicit confirm, amend, or discard — none silently dropped, none silently reapplied to a shift it was not written for. The change is attributable to an admin and a timestamp.

- **CAP-10 — Configuration warnings that inform rather than block**
  - **intent:** On saving a rotation, the system reports coverage gaps, duplicate coverage, and consecutive working shifts with no rest interval, so a configuration the admin did not intend is caught immediately and one they did intend still saves.
  - **success:** No warning ever blocks a save. Two teams at the same offset produce both a duplicate-coverage and a gap warning. A day shift immediately followed by a night shift is reported with its continuous duration in hours, computed from nominal durations so it is stable across daylight-saving transitions. The pilot configuration produces the rest-gap report by design and is not treated as a misconfiguration. A save is refused only where the resulting state would be unrepresentable rather than merely unwise — an hour-band gap or overlap (CAP-3), an offset outside the cycle, and an empty pattern (CAP-8) — and such a refusal is not a warning.

- **CAP-11 — Schedule projection and rosters**
  - **intent:** The system answers what any team and any member is doing on any date, derived from the rotation plus recorded exceptions, without a prior generation step.
  - **success:** Projection works for arbitrary future dates with no generation run. Repeated queries for the same date agree. With every override removed, the schedule equals the pure projection exactly. Each working shift carries a roster derived from the team's active members plus roster overrides.

- **CAP-12 — Schedule overrides as a separable exception layer**
  - **intent:** An admin changes a team's shift type on a date, or adds, removes, or replaces a member on a specific shift, recording what actually happened without editing the rule that generated it.
  - **success:** The pattern and assignment are byte-identical before and after any override. Replacing a member is one action recording both the removed and added member. Removing an override restores the projected value and default roster exactly. An overridden date is identifiable without opening a detail view, and its detail names author, timestamp, reason, and the projected value it replaced.

- **CAP-13 — Monthly calendar with team and member filters**
  - **intent:** Anyone in the organization reads the schedule as a month, filtered to all teams, one team, or one member, with leave, conflicts, uncovered shifts, and overridden dates all legible.
  - **success:** Filter options are populated from actual records with no hard-coded entries; filter state survives month navigation and clears in one action. A midnight-crossing shift renders once, on its start date, labelled with both clock times. An unresolved conflict is visible to an admin without opening a detail view. No state is distinguished by color alone. See `DESIGN.md` and `EXPERIENCE.md` for the legibility requirements this surface must satisfy.

- **CAP-14 — Hours computed by band intersection**
  - **intent:** The system derives each member's shift counts, hours per band, total hours, and leave hours for a period from the schedule, so nobody enters or reconciles an hour by hand.
  - **success:** Band hours are derived by intersecting each working shift's nominal interval with the organization's bands and always sum exactly to total hours. A shift straddling a boundary is split, not rounded: with bands at 06:00 and 21:00 a 19:00–07:00 shift yields 3 day and 9 night hours. A 12-hour shift contributes 12 hours on both daylight-saving transition dates. Hours follow the roster, so a roster override moves them between members. A member's own figures reconcile exactly with the admin's view of them. See `engine-rules.md`.

- **CAP-15 — Annual leave against a per-member allowance**
  - **intent:** An admin records, amends, and deletes a member's leave as a date range and sees its cost before saving; a member sees their allowance, days used, and balance.
  - **success:** Recording leave leaves every scheduled shift in place and the rotation untouched. Cost equals the count of dates in the range on which the member had a working shift; non-working dates cost nothing. A range overlapping existing leave for that member is refused. Allowance minus used equals balance at all times, computed only from the current leave year. Deleting a record restores the balance. See `engine-rules.md`.

- **CAP-16 — Leave/schedule conflicts resolved explicitly**
  - **intent:** When recorded leave collides with a working shift the member is rostered for, the system raises a visible conflict and requires an admin to choose an outcome, so an absence never silently becomes an unnoticed coverage gap.
  - **success:** A conflict exists for every affected working shift and stands until explicitly resolved; none expires or auto-clears. A configuration change that would remove a collision's cause surfaces it for an explicit decision rather than clearing it silently. Detection deletes, hides, and alters no shift. Non-working shifts coinciding with leave raise nothing. Exactly three resolutions exist — accept as uncovered, replace the member, amend the leave — each attributable, and the resulting hours land as leave hours rather than worked hours for the absent member. See `engine-rules.md`.

- **CAP-17 — Role-appropriate landing surfaces**
  - **intent:** Each role lands on a screen answering its standing questions without navigation: a member's next shift, hours, and leave; an admin's coverage, conflicts, and pending work.
  - **success:** A member sees today's shift — stated explicitly in words when not working — their next working shift with date and both clock times, band hours and total for the period, leave used and remaining, and at least seven days of upcoming shifts, all usable at phone width with no horizontal scrolling. An admin sees today's coverage for any number of teams and an unresolved-conflict count shown even when zero, matching the conflict list exactly. Every dashboard figure equals its detail view. The standing questions each role arrives with are fixed in `experience-direction.md`.

## Constraints

- **Rotation is a rule; the schedule is a projection of it.** The projected schedule for any team and date is a pure function of pattern, offset, and anchor date. This rules out authoring the schedule directly and rules out any generation step that cannot be repeated to the same result.
- **Overrides never mutate the rule.** Removing every override must return the schedule to the pure projection exactly. This rules out implementing an override by editing generated schedule rows in place with no separable exception layer.
- **Leave never mutates the rule and never removes a shift.** Absence is represented as a conflict, never as a deletion. This rules out the conventional design where approving leave clears the roster.
- **A conflict requires an explicit human resolution, and that resolution is persisted and attributable.** A conflict stands, visible, until a human decides it. This rules out auto-resolution, expiry, suppression, and any "smart" reassignment.
- **A shift is one continuous interval; midnight is not a boundary.** This rules out storing a midnight-crossing shift as two rows, attributing it to two dates, or counting it twice.
- **Nominal wall-clock duration is authoritative for all hour accounting.** A 12-hour night shift reports 12 hours on daylight-saving transition dates. This rules out deriving reported hours from elapsed real time between instants.
- **Hour classification is computed by interval intersection against organization-defined bands, never labelled on the shift type.** This rules out a day/night flag or category field on a shift type, and rules out any hard-coded boundary time.
- **No pilot specific may exist in the core.** Team count and names, cycle length, shift-type names and durations, band names and boundaries, organization type, timezone, and locale are all organization data. This rules out defaults, presets, seeded fixtures, or branches that encode four teams, `Dan`/`Noć`/`Slobodno`, twelve hours, fire departments, or Croatian.
- **Tenant isolation and role enforcement are absolute and live at the data layer.** This rules out enforcing either in frontend or application code alone. See `quality-requirements.md`.
- **No user-facing string is hard-coded anywhere in frontend code.** Every string resolves through a translation key; domain logic returns keys, codes, and values only. This rules out literal display text in components, hooks, pages, and validation rules, and rules out formatted strings originating in the domain layer. See `localization.md`.
- **Every manual change is attributable and outlives what it modified.** This rules out overrides and resolutions stored without author and timestamp.
- **Domain logic is pure, framework-free, and has exactly one canonical implementation.** Rotation projection, schedule generation, hour computation, leave-day counting, and conflict detection carry no React and no direct data-access dependency, and the same input yields the same output regardless of call site. This rules out business rules inside components or query hooks, and rules out duplicating a calculation across client and database.
- **Every constraint above is asserted by an automated test that runs without a browser or a rendered component,** against the pilot configuration and against a structurally different second configuration whose bands and shifts diverge. This rules out shipping the engine verified only through the UI.
- **MVP ships Croatian as the only complete locale, on responsive web only.** This rules out a native application and rules out treating a second language as post-hoc retrofit work.

## Non-goals

- **Not a fire-department management system.** No interventions, incident reporting, equipment, vehicles, readiness, or training. Any requirement that cannot be expressed as organization data is one to reject or generalize.
- **Not payroll or time-and-attendance.** Hours are what was scheduled, not what was attended. No rates, pay, overtime, premiums, breaks, period locking, or government reporting.
- **Not a workforce-optimization tool.** No demand forecasting, auto-assignment, minimum-staffing rules, qualification constraints, or statutory rest-period enforcement.
- **Not a communication tool.** No notifications, reminders, messaging, push, SMS, or email beyond authentication and invitation.
- **No member-initiated workflows in MVP.** Members do not request leave, propose swaps, trade shifts, or resolve conflicts. Leave is admin-entered only.
- **No absence types beyond annual leave.** No sick, personal, training, parental, or unpaid leave; no carry-over, part-day leave, public-holiday calendars, or accrual.
- **No export or reporting beyond the hours view.** No CSV, Excel, PDF, analytics, or team statistics.
- **No self-service commerce.** Organizations are operator-provisioned. No signup wizard, billing, subscriptions, or payment processing.
- **No general permission system.** Exactly two roles. Not a role builder, not per-resource ACLs.
- **No multi-membership.** One member in at most one team; one user in exactly one organization. No multi-site or sub-organization hierarchy.
- **No audit-log interface.** The data model supports auditability; no screen exposes it.
- **No calendar surfaces beyond the monthly view.** No weekly or daily views, drag-and-drop editing, print layout, or iCal feeds.

## Success signal

The pilot organization stops maintaining its spreadsheet and does not resume: within one month of go-live the platform is the sole source of truth for the rota, every member answers "when do I next work?" from their phone without asking anyone, and two consecutive months of hour totals are produced by the system and accepted without manual recomputation — with zero shifts left uncovered by a collision the system failed to surface.

The engine's genericity is proven, not asserted: a second organization in a different industry, with a different team count, cycle length, shift durations, and day/night boundaries, is configured and running with no code change, no schema migration, and no branch.

Two things must *not* happen, and their absence is part of the signal: override counts must not fall toward zero (which would mean people went back to arranging cover by phone), and configuration must not have been made easy by shipping pilot-shaped defaults.

## Assumptions

- Leave days are counted as dates in the range on which the member had a working scheduled shift. Inferred, not confirmed by the pilot organization; it changes what a 30-day allowance means by roughly a factor of two.
- On-screen hour reporting is sufficient for the pilot; no export is needed in MVP.
- Another member's leave, hours, and contact details are visible only to admins. A volunteer organization may prefer full transparency.
- When a rotation changes, overrides on or after the effective date are surfaced for explicit review rather than silently kept or silently dropped.
- In the all-teams calendar view, leave is shown as an indicator or count rather than per-member detail.
- Leave whose cost exceeds the remaining balance is saved with a warning rather than refused, so a real agreement is never unrecordable.
- No absence reason is recorded, which keeps personal-data exposure minimal.
- WCAG 2.1 AA is the accessibility target, without formal audit in MVP.
- The pilot's rotation is `DAY → NIGHT → OFF → OFF` with every team at its own offset, making it a 24-hour-on / 48-hour-off rota. Confirmed by the author; the pilot's own PRD contained a contradicting table, now retired.

## Open Questions

- How exactly does the pilot organization count leave days — calendar days, working days, or shifts? Needs the fire department, not an inference. Highest-cost question open.
- A deactivated member is removed from future rosters and no past shift changes. Open: does the shift they vacated stay silently short-handed, or raise something? A conflict is specifically leave against a rostered working shift, so answering "conflict-like" means defining a second signal with its own resolution vocabulary.
- Beyond name and team membership, how much of another member's information may a member-role account see? Settled for rosters (CAP-5); leave, hours, and contact details remain assumed admin-only.
- Can a member be temporarily loaned to another team, or are repeated roster overrides adequate?
- Should one user ever belong to multiple organizations? Out of scope now, and no longer cheap to relax: the single-organization non-goal is what licenses the architecture to carry the organization in a session claim, so reversing it changes every access policy at once.
- What retention applies to schedule and leave history? Unbounded is assumed.
- Is WCAG 2.1 AA the target, and is a formal audit ever expected?
- Does the pilot need an absence reason recorded?
