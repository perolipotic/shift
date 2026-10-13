---
title: Shift Management Platform
status: draft
created: 2026-09-01
updated: 2026-10-10
---

# PRD: Shift Management Platform
*Working title: **Shift**. Confirm before it reaches the UI.*

## 0. Document Purpose

This PRD is the requirements contract for **Shift**, an industry-agnostic shift management platform whose first tenant is a Croatian volunteer fire department. Its readers are the downstream BMad workflows — UX, architecture, epics and stories — and any reviewer judging whether the product is defined well enough to build.

**How it is structured.** Vocabulary is fixed in the **Glossary** (§3) and used verbatim everywhere else. §4 states the **Domain Invariants** the system must enforce structurally rather than merely honor; every dependent FR references one by ID. Features are grouped in §5 with globally numbered FRs nested beneath, so downstream artifacts have stable references even if features are reorganized. Cross-cutting requirements are in §8. Inferences are tagged `[ASSUMPTION]` inline and indexed in §12.

**Inputs.** Two: the product brief at `_bmad-output/planning-artifacts/briefs/brief-shift-2026-09-01/`, and a full author-written PRD supplied during this session. Where the two disagree, the disagreement is recorded rather than resolved silently — see §11.1. The author-written PRD's own fifty numbered functional requirements are mapped onto this document's FRs in `addendum.md` §7, so no requirement from it is lost in restructuring.

**What is not here.** Technology stack, proposed data model, component strategy, pilot seed data, and localization file layout live in `addendum.md`. This PRD states capabilities; it does not choose mechanisms. No UX artifacts exist yet — §2.3's journeys are requirement-level narratives, expected to be superseded (with their IDs mirrored) by `bmad-ux`.

## 1. Vision

Organizations that run continuous operations — emergency services, security firms, care providers, plants, warehouses, hotels — all solve the same problem badly. They rotate crews through recurring patterns, and they manage it in spreadsheets, paper rotas, and group chats. The pattern lives in one person's head. Worked hours are reconstructed after the month closes. Leave is agreed verbally, collides with the rota, and nobody notices until a shift is short.

Shift lets an organization define its own shift types, its own rotation pattern, and its own teams, then generates the schedule from that definition, tracks hours against it with a day/night breakdown, manages annual leave, and surfaces every collision between the two instead of resolving them silently. An Admin configures the rotation once; the schedule follows. A member opens their phone and knows when they work.

The founding insight is a separation most tools blur: **the rotation pattern is a rule, the schedule is a projection of that rule, and reality is a layer of exceptions on top.** Manual changes and approved leave never rewrite the rule. That separation is what makes the platform explainable, auditable, and correct across an arbitrary number of teams and patterns — and it is why the first customer's four-team, four-day rotation is configuration rather than code.

## 2. Target User

### 2.1 Jobs To Be Done

**Admin** — the person who currently owns the spreadsheet:
- Define the rotation once and stop rebuilding the schedule every month.
- Know *before* the day arrives that an approved absence has left a shift short.
- Produce month-end hour totals, split day and night, that nobody disputes.
- Stop being the single point of failure for "who is on tonight?"
- Configure and run all of this without technical knowledge.

**Member** — the person on the rota:
- Know when they are next working, in seconds, on a phone, without asking anyone.
- See accumulated hours and how they split day versus night.
- Know how much annual leave is left.
- See who else is in the organization and which team they are on.

**Product owner** — you, as the platform's builder:
- Prove the engine is generic by configuring a second, differently shaped organization without touching code.

### 2.2 Non-Users (v1)

- **Organizations scheduling ad-hoc, demand-driven shifts** with no recurring pattern (retail shift-bidding, gig dispatch). The core object here is a rotation; without one the product offers little.
- **Payroll and finance functions.** Shift computes hours; it does not apply rates, run pay, or export to payroll.
- **The public and external stakeholders.** There is no public-facing surface.
- **Multi-site organizations** needing per-site rotations under a single tenant.
- **Users belonging to more than one organization.** One account, one organization, in v1.

### 2.3 Key User Journeys

Named protagonists; pronouns are they/them throughout.

- **UJ-1. Damir configures the rotation once and retires the spreadsheet.**
  Damir is the operations lead at a volunteer fire department of roughly forty members in four crews. Entry state: freshly provisioned Admin account, empty organization. They set the organization's name and logo — its timezone and locale were set when it was provisioned — define three Shift Types (`Dan` 07:00–19:00, `Noć` 19:00–07:00, `Slobodno`); build a four-slot Rotation Pattern; create four Teams and give each an Offset against a shared Anchor Date. The system previews the next full cycle and confirms each day has exactly one team on `Dan` and one on `Noć`. **Climax:** Damir opens the Calendar and sees three months already scheduled, correct, without having typed a date. **Resolution:** they add Members to Teams and hand out credentials. **Edge case:** if two Teams get the same Offset, the coverage preview reports the resulting duplicate coverage and the uncovered days — as a warning, not a block, since Damir may have meant it.

- **UJ-2. Luka checks whether they are working tomorrow, from the truck.**
  Luka is a volunteer with a day job who cannot hold the rota in their head. Entry state: authenticated on their phone from a previous session. They open Shift and land on their dashboard: today's shift, next working shift with date and times, hours this month split day and night, leave remaining, and the next few shifts as a compact list. **Climax:** the answer is on screen before they tap anything. **Resolution:** they close the app. **Edge case:** when their Team is non-working today, the dashboard says so in words rather than showing an empty area Luka has to interpret.

- **UJ-3. Damir records Ana's leave and finds the collisions before they bite.**
  Ana is on Team C and has agreed the second week of September off. Damir opens Ana's record — 30 allocated, 12 used, 18 remaining — and enters 10.09–16.09. Before saving, the system shows the cost in Leave Days, counting only dates where Ana has a working shift. **Climax:** on save, each affected working shift becomes a visible Conflict; the shifts stay on the Calendar and the rotation is untouched. **Resolution:** Damir resolves two Conflicts by putting a colleague on those shifts and accepts the third as uncovered. Nothing was silently deleted. **Edge case:** a range overlapping leave Ana already has is refused rather than charged twice.

- **UJ-4. Damir closes the month.**
  End of September. Damir opens Hours, picks the month, and sees every Member with shift counts and hours per category — day, night, total — plus leave listed separately, in days. One member's total is low; Damir drills in and sees two shifts were reassigned during week two's leave conflicts. **Climax:** the number is explainable without reconstructing anything. **Resolution:** they export the month to Excel and send it onward, and the file carries exactly the figures on screen (FR-42a).

- **UJ-5. A second organization proves the engine.**
  A security company with three Teams on a five-slot `DAY → DAY → NIGHT → OFF → OFF` pattern and 8-hour shifts is configured as a second tenant. **Climax:** it works with no code change, no migration, no branch. **Resolution:** the core principle is validated rather than asserted. This is a product acceptance test, not an end-user flow.

## 3. Glossary

Downstream workflows and readers use these terms exactly. Introducing a synonym anywhere is a discipline violation.

- **Organization** — a tenant. Owns every other record. Has a name, short name, description, address, contact details, an Organization Type, a timezone, a locale, a Leave Year, and branding. Has many Members, Teams, Shift Types, and Rotation Patterns.
- **Organization Type** — a descriptive label (e.g. "Fire Department"). Affects presentation and, later, onboarding templates. **Never** affects scheduling, hours, leave, or conflict logic.
- **Member** — a person belonging to exactly one Organization. Has a name, optional email, active/inactive status, a Role, at most one Team, a Leave Allowance, and — where the Organization uses them — a Fire Rank and a Team Position. *"Member" always means the person, never the permission level.*
- **Role** — a Member's permission level: **Admin** or **Member Role**. Where the permission level is meant, the term is always "Admin" or "Member Role", never bare "Member".
- **Team** — a named group of Members within an Organization sharing one Rotation Assignment. A Member belongs to at most one Team in v1.
- **Fire Rank** — an optional, descriptive rank on a Member, from a fixed list, current-state. Exists only for an Organization whose Fire Ranks and Positions setting is on. Never affects scheduling, hours, leave or conflict logic.
- **Team Position** — a Member's descriptive position within their Team (commander, driver, firefighter), versioned with the Team membership so it changes from a date forward. Required while the setting is on; absent without a Team. Inert like Fire Rank.
- **Fire Ranks and Positions** — an Organization setting, off by default, gating the display and entry of Fire Rank and Team Position. Never deletes them.
- **Shift Type** — a reusable named definition of a working or non-working period: start time, end time, and a working flag. It carries no hour classification of its own (FR-21). A non-working Shift Type has zero duration and needs no times. A Shift Type whose end time is not after its start time crosses midnight.
- **Nominal Duration** — the configured wall-clock length of a Shift Type, independent of daylight-saving transitions. Authoritative for all hour accounting.
- **Elapsed Duration** — real time between a Scheduled Shift's absolute start and end instants. Equals Nominal Duration except across a daylight-saving transition. May be displayed; never used for accounting.
- **Hour Band** — an Organization-defined, named window of the day that hours are reported under, given by its name and start time. Consecutive Hour Bands partition the full 24 hours with no gap and no overlap; a band may cross midnight. The pilot defines two: `Dan` starting 07:00 and `Noć` starting 19:00.
- **Band Hours** — the portions of a Member's working Scheduled Shifts' Nominal Durations falling within each Hour Band, summed per band. For the pilot this yields Day Hours and Night Hours.
- **Total Hours** — the sum of Band Hours across all Hour Bands. Always equals the summed Nominal Durations of the Member's working Scheduled Shifts.
- **Rotation Pattern** — an ordered, repeating sequence of Shift Types belonging to an Organization, optionally named. Its length is the **Cycle Length**. Arbitrary; no assumed relationship to a week.
- **Rotation Assignment** — the binding of a Team to a Rotation Pattern with a **Rotation Offset** (position within the Cycle) and an **Anchor Date** (the date at which the Team sits at that Offset). Together these fully determine the Team's Projected Schedule.
- **Projected Schedule** — the Shift Type a Team is assigned on each date, derived purely from its Rotation Assignment. Contains no exceptions.
- **Scheduled Shift** — one (date, Team, Shift Type) entry in the Schedule, with a Shift Roster. Derived from the Projected Schedule and then modified by applicable Overrides. A midnight-crossing Scheduled Shift belongs to the date on which it starts.
- **Shift Roster** — the Members expected to work a Scheduled Shift: the assigned Team's active Members, modified by Roster Overrides.
- **Schedule** — the Projected Schedule combined with the Override layer. What the Calendar shows. Never authored directly.
- **Override** — a recorded exception to the Projected Schedule on a specific date, of one of two kinds. Carries author, timestamp, and reason. Overrides never modify a Rotation Pattern or Rotation Assignment.
  - **Shift Type Override** — changes the Shift Type for a Team on a date.
  - **Roster Override** — adds, removes, or replaces a Member on a specific Scheduled Shift.
- **Leave Allowance** — the Leave Days a Member is entitled to in a Leave Year.
- **Leave Year** — the Organization-defined annual period against which Leave Allowance is measured.
- **Absence Type** — an Organization-defined kind of absence, given by its name and whether it draws down the Leave Allowance. Annual leave is the drawing type every Organization starts with. Never carries a reason. Its name is visible only to Admins and to the Member themselves.
- **Leave Record** — a date range of absence of one Absence Type for one Member, entered by an Admin or created by approving a Leave Request. A one-date record may be a Half-day Record.
- **Half-day Record** — a one-date Leave Record covering the first or the second half of the Member's working Scheduled Shift on that date. Costs 0.5 Leave Days.
- **Leave Request** — a Member's own request for a Leave Record, pending until an Admin approves or rejects it, or the Member withdraws it. While pending, it derives nothing.
- **Leave Day** — one date within a Leave Record on which the Member was active and had a working Scheduled Shift (R4.2). Only Leave Days draw down Leave Balance, and the hours views report the leave as the Leave Days of the period, never as hours (FR-40). A record across a period's edge counts each date in its own period, so the periods of one record sum to its cost. A Half-day Record counts 0.5, and only Leave Days of drawing Absence Types draw down Leave Balance (added 2026-10-10).
- **Carried-over Days** — the unused Leave Balance of the previous Leave Year that moves into the current one, capped by the Organization's setting and expiring on the date that setting names. Derived, never entered.
- **Leave Balance** — Leave Allowance plus Carried-over Days not yet expired, minus Leave Days of drawing Absence Types consumed in the Leave Year.
- **Conflict** — the state of a working Scheduled Shift whose Shift Roster includes a Member covered by a Leave Record on that date. A first-class, visible, persisted state. *UI vocabulary:* the Croatian UI renders a Conflict as an item *za odluku* (absence in a shift), never as "konflikt" (2026-10-10).
- **Conflict Resolution** — the explicit Admin action clearing a Conflict: **Accept as Uncovered**, **Replace Member**, or **Amend Leave**.
- **Uncovered Shift** — a working Scheduled Shift deliberately recorded as having no Member to work it, via Accept as Uncovered.
- **Coverage Warning** — a non-blocking notice that a Rotation configuration produces dates with no working Team, or more than one working Team on the same Shift Type.
- **Rest Gap Warning** — a non-blocking notice that a Rotation configuration schedules a Team for consecutive working Shift Types with no non-working interval between them.
- **Swap Request** — a Member's proposal to give a colleague their working Scheduled Shift, optionally taking one of the colleague's in return. The colleague accepts or declines; an Admin approves or rejects. Only approval writes anything, as Roster Overrides.
- **Minimum Members** — an Organization setting: how many people a working Scheduled Shift needs. Empty means no staffing signal at all.
- **Short-staffed Shift** — a working Scheduled Shift whose people at work — its Shift Roster after Overrides, minus every Member absent that date — number fewer than Minimum Members. Derived, never stored; it warns and never blocks.
- **Notification** — an email or push message telling a Member about their own schedule or requests, or an Admin about an item waiting for a decision. Written as a code and operands by the request that asserts the fact it reports.
- **Change History** — the Admin-only, append-only record of every write to an Organization's records: author, time, and values before and after.

## 4. Domain Invariants

The product's load-bearing rules. Architecture must make them structurally impossible to violate, not merely avoid violating. Each is independently testable against the domain logic with no UI present.

- **DI-1. Rotation is a rule; Schedule is a projection.** The Projected Schedule for any Team and date is a pure function of its Rotation Assignment. Recomputing always yields the same result, for past dates as well as future.
- **DI-2. Overrides never mutate the rule.** No Override changes a Rotation Pattern or Rotation Assignment. Removing every Override returns the Schedule to the Projected Schedule exactly.
- **DI-3. Leave never mutates the rule and never removes a shift.** Recording leave leaves the Projected Schedule and every Scheduled Shift intact. Absence is represented as a Conflict, never as a deletion.
- **DI-4. A Conflict is explicit state requiring explicit resolution.** The system never auto-resolves a Conflict and never hides one. It remains visible until an Admin acts.
- **DI-5. A shift is one continuous interval.** A midnight-crossing Shift Type produces exactly one Scheduled Shift of its full Nominal Duration, attributed to its start date. Midnight is not a boundary. It is never split, never double-counted, never attributed to two dates.
- **DI-6. Nominal Duration is authoritative for hours.** Hour accounting uses configured wall-clock times, so a 12-hour night shift reports 12 hours on every date including daylight-saving transitions. Elapsed Duration never enters an hour total.
- **DI-7. Hour classification is computed from data, not labelled in code.** A working Scheduled Shift's Nominal Duration is attributed to Hour Bands by intersecting its nominal interval with the Organization's Hour Bands. Bands are Organization data and partition the full 24-hour day. No `Day`/`Night` literal, no boundary time, and no classification rule appears in the domain logic.
- **DI-8. No pilot specific exists in the core.** Team count, Team names, Cycle Length, Shift Type names, shift durations, Hour Band names and boundaries, Organization Type, timezone, and locale are all Organization data. The domain logic contains no reference to four teams, to `Dan`/`Noć`/`Slobodno` or `DAY`/`NIGHT`/`OFF` as literals, to twelve hours, to fire departments, or to Croatian.
- **DI-9. Tenant isolation is absolute.** No read or write may cross an Organization boundary. Enforced at the data layer, never only in frontend or application code.
- **DI-10. No user-facing string is hard-coded.** Every string presented to a user resolves through a translation key. Domain logic returns keys, codes, and values — never formatted display text.
- **DI-11. Manual change is attributable.** Every Override and every Conflict Resolution records who performed it and when, and that record survives for the life of the schedule it touched.

## 5. Features

### 5.1 Authentication and Access

**Description:** Members sign in with email and password and reach only their own Organization. Organizations are provisioned by the platform operator — self-service onboarding is a go-to-market step, not an MVP requirement. Admins create Member accounts and issue credentials directly, because volunteer organizations frequently have no per-person work email and an invite-only flow would strand the pilot; invitation by email is available where an address exists. Role restriction is enforced at the data layer, not in the UI. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-1: Sign in
A Member can authenticate with email and password, and the system resolves their Organization and Role from the session.

**Consequences (testable):**
- A valid credential pair returns a session scoped to exactly one Organization and one Role.
- An authenticated request for a record belonging to another Organization fails at the data layer, not only in application code (DI-9).
- Every surface other than sign-in and password reset refuses an unauthenticated request.
- Every surface other than setting a new password refuses a session whose password was issued or reset by an Admin and not yet replaced by the Member (FR-3a; changed 2026-10-02, sprint-change-proposal-2026-10-02-ux-redesign).

#### FR-2: Operator provisions an Organization
The platform operator can create an Organization together with its first Admin.

**Consequences (testable):**
- A newly created Organization has no Members besides its first Admin, and no Teams, Shift Types, or Rotation Patterns.
- No user-facing surface allows creating an Organization.

**Out of Scope:** self-service organization signup; billing; subscription plans; trials.

#### FR-3: Admin creates Member credentials
An Admin can create a Member account with credentials, or send an email invitation where an address exists.

**Consequences (testable):**
- A usable Member account can be created with no email address present.
- An invited Member sets their own password before first access.
- A Member created by an Admin belongs to that Admin's Organization and no other.

#### FR-3a: First sign-in sets the password (added 2026-10-02, sprint-change-proposal-2026-10-02-ux-redesign)
A Member whose password was issued or reset by an Admin sets their own password before any surface opens.

**Consequences (testable):**
- After signing in with an Admin-issued or Admin-reset password, the Member reaches only the set-password step; every other surface is refused until a new password is saved (FR-1).
- The Admin-issued password is four words, shown to the Admin once.
- Saving the new password lets the Member continue to their landing surface without signing in again.
- An Admin reset (FR-4) puts the Member back under this rule.

#### FR-4: Password reset
A Member can reset their own password; an Admin can reset any Member's password within their Organization.

**Consequences (testable):**
- Admin-initiated reset works for a Member with no email address on record.
- A reset invalidates that Member's existing sessions.

#### FR-5: Role enforcement
The system refuses every administrative write to a Member Role account.

**Consequences (testable):**
- A Member Role account is refused every write in §5.2, §5.3, §5.4, §5.5, §5.6, §5.8, §5.11 and every Conflict Resolution in §5.12 — at the data layer (DI-9).
- Removing the last Admin from an Organization is refused.
- Refusal is identical whether attempted through the UI or by direct API call.
- A Member Role account may write only rows it owns and that decide nothing: sending and withdrawing its own Leave Requests (FR-58, FR-59), proposing and withdrawing its own Swap Requests and answering one addressed to it (FR-66, FR-67, FR-69), and its own notification settings and push subscriptions (FR-64, FR-65). None of these is an administrative write (added 2026-10-10).

### 5.2 Organization Settings and Branding

**Description:** Organization settings are the substrate the whole engine reads: identity, branding, timezone, locale, Hour Bands, and Leave Year. Nothing here is defaulted from the pilot's values in code; the pilot supplies them as data (DI-8). Organization Type is descriptive only — it is the most likely place for fire-department assumptions to leak into the core, so its inertness is a requirement rather than an accident. Realizes UJ-1. Organization Type, timezone and locale are set when the Organization is provisioned; an Admin sees the timezone but does not change any of the three in the application (human decision 2026-09-25, `sprint-change-proposal-2026-09-25-organization-settings.md`).

**Functional Requirements:**

#### FR-6: Organization profile
An Admin can set the Organization's name, short name, description, address, and contact details.

**Consequences (testable):**
- Name and short name appear in the application shell; the pilot displays its real name (e.g. "DVD Kaštel Novi") without any Organization being required to be a fire department.
- Only an Admin can modify these fields (FR-5).

#### FR-7: Organization Type is inert
An Organization has an Organization Type, set when the Organization is provisioned, and it changes no scheduling behavior.

**Consequences (testable):**
- Saving the Organization settings never changes the Organization Type; the Admin's settings surface offers no control for it.
- Two Organizations with identical Teams, Shift Types, and Rotation Assignments but different Organization Types produce byte-identical schedules, hours, and conflicts.
- No branch anywhere in the domain logic reads Organization Type (DI-8).

#### FR-8: Timezone and locale
An Organization's timezone and locale are set when the Organization is provisioned. An Admin sees the timezone on the settings surface and cannot change either in the application.

**Consequences (testable):**
- Saving the Organization settings never changes the timezone or the locale; changing either after provisioning is an operator action.
- Every date and time displayed anywhere resolves against the Organization timezone, not the viewer's device timezone.
- Changing locale changes language, date format, number format, and pluralization with no deployment (DI-10).

#### FR-9: Hour Bands
An Admin can define the Organization's Hour Bands — the named windows of the day that hours are reported under — by setting each band's name and start time.

**Consequences (testable):**
- Bands partition the full 24 hours; a configuration leaving a gap or an overlap is refused, so no working hour is unclassified and none is counted twice.
- A band may cross midnight — the pilot's `Noć` band runs 19:00–07:00.
- The pilot defines exactly two bands, named in Croatian, and nothing in the system presumes that count or those names (DI-7, DI-8).
- Moving a band boundary recomputes Band Hours for every affected Scheduled Shift and changes no Total Hours.
- An Organization defining three bands (morning, evening, night) reports three figures with no code change.

#### FR-10: Leave Year
An Admin can define the Leave Year.

**Consequences (testable):**
- The Leave Year need not align to the calendar year.
- Leave Balance counts only Leave Days falling inside the selected Leave Year.

#### FR-11: Branding
An Admin can upload a logo, and it is available throughout the application for that Organization.

**Consequences (testable):**
- An Organization with no logo renders a neutral fallback — never a broken image, never another Organization's logo.
- An uploaded logo is readable only by Members of the owning Organization (DI-9).

### 5.3 Members and Directory

**Description:** Members are people, with a Role, at most one Team, and a Leave Allowance. Admins get a working list — search, sort, filter — because forty-odd records are unmanageable otherwise. Member Role accounts get a read-only directory, which answers "who else is on my team?" without exposing administrative data. Realizes UJ-1, UJ-3.

**Functional Requirements:**

#### FR-12: Manage Members
An Admin can create, edit, activate, and deactivate Members, recording first name, last name, email, status, Role, Team, and Leave Allowance.

**Consequences (testable):**
- Email is optional; a Member with no email can be created, activated, and scheduled.
- Deactivating a Member preserves their historical Scheduled Shifts, Overrides, hours, and Leave Records.
- A deactivated Member cannot authenticate, is removed from future Shift Rosters, and generates no new Conflicts.
- Deactivation does not delete or alter any past Scheduled Shift.

#### FR-13: Assign Role
An Admin can set a Member's Role to Admin or Member Role.

**Consequences (testable):**
- The change takes effect on the Member's next request without requiring their re-authentication elsewhere.
- The last Admin's Role cannot be downgraded (FR-5).

#### FR-14: Set Leave Allowance
An Admin can set each Member's Leave Allowance for the Leave Year.

**Consequences (testable):**
- Allowance is per Member, never a single Organization-wide constant.
- Changing Allowance recomputes Leave Balance and never retroactively invalidates an existing Leave Record.

#### FR-15: Member list
An Admin can search, sort, and filter the Member list.

**Consequences (testable):**
- Filterable by Team, by Role, and by active/inactive status; searchable by name.
- Filter and sort state is resettable in one action.
- The list remains usable at the pilot's scale (tens of Members) and at several hundred.

#### FR-16: Member directory
A Member Role account can view the Organization's Members and their Teams.

**Consequences (testable):**
- The directory is grouped by Team and reachable from *Više*, not only from inside a Team's detail (changed 2026-10-02, sprint-change-proposal-2026-10-02-ux-redesign).
- The directory shows name and Team — and, where the Organization uses them, Fire Rank and Team Position; it does not expose Leave Allowance, Leave Balance, Leave Records, hours, or contact details of other Members. `[ASSUMPTION: other Members' leave and hours are private to Admins; confirm — a volunteer organization may prefer full transparency.]`
- No write action is reachable from the directory for a Member Role account.

### 5.4 Teams

**Description:** Teams are the unit the rotation projects onto. A Member's schedule derives from their Team's Rotation Assignment; individual deviation is an Override, never a separate personal rotation. Realizes UJ-1.

**Functional Requirements:**

#### FR-17: Manage Teams
An Admin can create, rename, archive, and list Teams, with no limit on count and no reserved names.

**Consequences (testable):**
- An Organization works with any number of Teams from one upward; nothing assumes four (DI-8).
- Team names are free text; `A`, `B`, `C`, `D` carry no special meaning anywhere in the system.
- A Team with historical Scheduled Shifts is archived rather than deleted, and its history remains readable.

#### FR-18: Assign Members to Teams
An Admin can assign a Member to at most one Team, or leave them unassigned.

**Consequences (testable):**
- A Member normally belongs to exactly one Team. Unassigned is permitted, yields an empty schedule, and generates no Conflicts — this keeps onboarding representable rather than forcing a placeholder Team.
- Moving a Member between Teams changes their schedule from the move date forward and rewrites no history.

**Out of Scope:** simultaneous membership of multiple Teams; temporary loan to another Team (see §11.2).

#### FR-18a: Fire Ranks and Team Positions (added 2026-09-25, sprint change)
An Admin of an Organization that switches on Fire Ranks and Positions can record each Member's Fire Rank and their Team Position.

**Consequences (testable):**
- With the setting off, no rank or position control or text appears anywhere; stored values survive.
- A position change takes effect from a chosen date and rewrites no history (as FR-18).
- Rank and position are inert: two Organizations identical but for ranks and positions produce byte-identical schedules, hours and conflicts (the FR-7 rule).
- No rule enforces a staffing mix or qualification from them (§7.2).

**Bounded exception to §6.** The rank and position lists are fixed, not Organization data — accepted for the pilot on 2026-09-25 (`sprint-change-proposal-2026-09-25.md`, option A). **Revisit when** a second Organization needs ranks or positions: the lists then become Organization data.

### 5.5 Shift Types

**Description:** Reusable definitions of working and non-working periods. A midnight-crossing Shift Type is one continuous shift — the invariant most competing tools get wrong (DI-5). A Shift Type declares only its times and whether it is working; whether its hours count as day or night is settled separately by the Organization's Hour Bands (FR-9). That separation is what lets the identical shift definition report differently for an organization whose night begins at 21:00 rather than 19:00. Realizes UJ-1, UJ-5.

**Functional Requirements:**

#### FR-19: Manage Shift Types
An Admin can create, edit, and list Shift Types with a name, start time, end time, and working flag.

**Consequences (testable):**
- Nominal Duration is derived from the times, never entered by hand.
- A non-working Shift Type has zero Nominal Duration and requires no times.
- Shift Type names are free text; `Dan`, `Noć`, `Slobodno`, `DAY`, `NIGHT`, `OFF` carry no meaning in logic (DI-8).
- Editing times recomputes hours for affected Scheduled Shifts and leaves Rotation Patterns referencing the Shift Type intact.

#### FR-20: Midnight-crossing Shift Types
A Shift Type whose end time is not after its start time is stored as crossing midnight and produces one continuous shift.

**Consequences (testable):**
- 19:00–07:00 yields a Nominal Duration of 12 hours (DI-5).
- The resulting Scheduled Shift appears once, on its start date, and is never attributed to the following date.
- A 24-hour Shift Type (e.g. 08:00–08:00) is valid and yields 24 hours.

#### FR-21: Shift Types carry no hour classification
A Shift Type declares its times and its working flag only; how its hours are classified is determined entirely by the Organization's Hour Bands.

**Consequences (testable):**
- No Shift Type field names, references, or implies an Hour Band (DI-7).
- With the pilot's bands (`Dan` 07:00, `Noć` 19:00): five 07:00–19:00 shifts and four 19:00–07:00 shifts report 60 Day Hours, 48 Night Hours, 108 Total Hours.
- With the bands moved to `Dan` 06:00 and `Noć` 21:00, the same 19:00–07:00 shift reports 3 Day Hours and 9 Night Hours, and its Nominal Duration is still 12.
- Moving a band boundary modifies no Shift Type record.

### 5.6 Rotation Patterns and Assignments

**Description:** The heart of the product. A Rotation Pattern is an ordered sequence of Shift Types of arbitrary length; a Rotation Assignment binds a Team to it at an Offset from an Anchor Date. These objects, plus the Shift Types they reference, fully determine every schedule the system will ever produce (DI-1). Because the engine accepts arbitrary configurations, it can produce days with no coverage, or crews working two shifts back to back — the system warns and does not block, since it cannot know intent. Realizes UJ-1, UJ-5.

**Functional Requirements:**

#### FR-22: Define a Rotation Pattern
An Admin can create a named Rotation Pattern as an ordered sequence of Shift Types of any length.

**Consequences (testable):**
- Cycle Length is arbitrary — 3, 4, 5, 7, 21 slots all valid — and nothing assumes a weekly cycle.
- The same Shift Type may appear more than once in a Pattern.
- An empty Pattern is refused.

#### FR-23: Assign a Team to a Rotation
An Admin can bind a Team to a Rotation Pattern with a Rotation Offset and an Anchor Date.

**Consequences (testable):**
- Offset must fall within the Pattern's Cycle Length.
- Teams may share a Pattern at different Offsets, and may share the same Offset (subject to FR-25).
- Given Pattern, Offset, and Anchor Date, the Shift Type for any date is deterministic and computable for dates before the Anchor Date as well as after (DI-1).

#### FR-24: Change a Rotation
An Admin can edit a Rotation Pattern or Rotation Assignment, choosing the date from which the change takes effect.

**Consequences (testable):**
- Scheduled Shifts before the effective date are unchanged.
- Overrides on or after the effective date are listed for the Admin to confirm, amend, or discard; none is silently discarded and none is silently reapplied to a shift it was not written for (DI-2). `[ASSUMPTION: explicit review is the expected behavior; confirm.]`
- The change is attributable (DI-11).

#### FR-25: Coverage Warning
On saving a Rotation configuration, the system reports dates in the next full cycle with no working Team, or with more than one working Team on the same Shift Type.

**Consequences (testable):**
- The warning never blocks saving.
- The pilot configuration reports zero gaps and zero duplicates.
- Giving two Teams the same Offset produces both a duplicate-coverage and a gap warning.

#### FR-26: Rest Gap Warning
On saving a Rotation configuration, the system reports where a Team is scheduled for consecutive working Shift Types with no non-working interval between them, stating the resulting continuous duration.

Consecutive working shifts are a legitimate design, not an error — the pilot's own configuration is exactly this (§11.1 C-1). The requirement exists so the resulting figure is stated out loud at configuration time rather than discovered from a rota, and so an organization that did *not* intend it finds out immediately.

**Consequences (testable):**
- A pattern placing a 12-hour night shift immediately after a 12-hour day shift is reported as 24 continuous hours.
- The pilot configuration produces this report, by design, and it is not treated as a misconfiguration.
- The report never blocks saving and never persists as a standing alert — it is shown at save time only, so a deliberate pattern does not generate recurring noise.
- A pattern with a non-working slot between every pair of working slots produces no report.
- The reported duration is computed from Nominal Durations and is therefore stable across daylight-saving transitions (DI-6).

**Out of Scope:** minimum-staffing rules; per-Shift-Type headcount requirements; qualification or certification constraints; statutory rest-period enforcement.

### 5.7 Schedule Generation

**Description:** The Schedule is the Projected Schedule with the Override layer applied. It is never authored directly and is always reproducible from its inputs. Each Scheduled Shift carries a Shift Roster, which is what makes "who is actually on this shift" answerable and overridable. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-27: Project the Schedule
The system determines the Scheduled Shift for any Team and any date from the Rotation Assignment plus applicable Overrides.

**Consequences (testable):**
- Projection is available for arbitrary future dates with no prior generation step for that range.
- Repeated queries for the same date return the same result (DI-1).
- With all Overrides removed, the Schedule equals the Projected Schedule exactly (DI-2).
- The system answers both "what is this Team doing on this date?" and "what is this Member doing on this date?"

#### FR-28: Shift Roster
Each working Scheduled Shift has a Shift Roster: the assigned Team's active Members, modified by Roster Overrides.

**Consequences (testable):**
- Adding an active Member to a Team adds them to that Team's future Shift Rosters without touching past ones.
- Deactivating a Member removes them from future Shift Rosters and leaves past ones intact (FR-12).
- The Roster is derivable for any future date without a generation step.

#### FR-29: A Member's schedule
A Member can view their own Scheduled Shifts. Realizes UJ-2.

**Consequences (testable):**
- A midnight-crossing shift appears once, on its start date, with both clock times shown so its span is unambiguous (DI-5).
- A Member with no Team sees an explanatory message, not a blank screen.
- Shifts the Member holds only through a Roster Override appear alongside the rest, indistinguishable in usefulness.

### 5.8 Schedule Overrides

**Description:** The exception layer. Real organizations change the rota: someone swaps out, someone covers, a shift type changes for a day. Every such change is recorded as an Override that leaves the rotation untouched (DI-2) and carries who did it and why (DI-11). The Schedule must show plainly where it has diverged from the projection, so nobody mistakes a correction for the rule. Realizes UJ-3.

**Functional Requirements:**

#### FR-30: Shift Type Override
An Admin can change the Shift Type for a Team on a specific date.

**Consequences (testable):**
- The Rotation Pattern and Rotation Assignment are byte-identical before and after (DI-2).
- Every Member of the Team sees the changed shift, and hours recompute accordingly.
- The Override records author, timestamp, and reason (DI-11).

#### FR-31: Roster Override
An Admin can add a Member to, remove a Member from, or replace a Member on a specific Scheduled Shift.

**Consequences (testable):**
- Replace is a single action recording both the removed and the added Member, not two unrelated edits.
- A Member can be added to a shift on a date their own Team is non-working.
- The added Member's hours increase and the removed Member's decrease, with no effect on any other Member.
- The Team's Projected Schedule is unchanged (DI-2).

#### FR-32: Remove an Override
An Admin can remove an Override, returning the affected date to its projected state.

**Consequences (testable):**
- Removal restores the Projected Schedule and default Shift Roster for that date exactly.
- Any Conflict that existed only because of the Override is cleared.
- The removal is itself attributable (DI-11).

#### FR-33: Overridden state is visible
The Schedule distinguishes projected data from data modified by an Override.

**Consequences (testable):**
- An overridden date is identifiable on the Calendar and in a Member's schedule without opening a detail view.
- The detail view names the author, timestamp, reason, and what the projected value would have been.
- Distinction does not rely on color alone.

### 5.9 Calendar

**Description:** The primary shared surface, and where the product is judged. A monthly view of the Schedule, filterable to all Teams, one Team, or one Member, with shift types, leave, conflicts, and uncovered shifts all legible at a glance. Realizes UJ-2, UJ-3.

**Functional Requirements:**

#### FR-34: Monthly Calendar
Any Member can view a monthly Calendar of their Organization's Schedule and navigate between months.

**Consequences (testable):**
- Each day cell shows which Teams are on which Shift Types, with shift times available.
- A midnight-crossing shift is rendered once, on its start date, labelled with both clock times (DI-5).
- Navigating to a month with no prior generation renders correctly (FR-27).

#### FR-35: Filter the Calendar
Any Member can filter the Calendar to all Teams, a specific Team, or a specific Member.

**Consequences (testable):**
- Team and Member filter options are populated from the Organization's actual records, with no hard-coded entries (DI-8).
- The Member filter shows that Member's shifts including those held through Roster Overrides, plus their leave.
- Filter state survives month navigation.

#### FR-36: Reset filters
Any Member can clear all Calendar filters in one action.

**Consequences (testable):**
- Reset returns the Calendar to the all-Teams view.
- Reset is reachable without navigating away from the Calendar.

#### FR-37: Leave on the Calendar
Approved leave is visible on the Calendar.

**Consequences (testable):**
- In a Member-filtered view, that Member's leave dates are marked, including dates where they had no working shift.
- In the all-Teams view, leave is indicated without making the shift grid unreadable. `[ASSUMPTION: an indicator or count rather than per-Member detail in the all-Teams view; UX to settle the treatment.]`
- The all-Teams leave indication and another Member's leave apply to an Admin. A Member Role account sees only their own leave (2026-10-13, deferred-work sweep; as FR-38).

#### FR-38: Conflicts and Uncovered Shifts on the Calendar
The Calendar visually distinguishes shifts in Conflict and Uncovered Shifts.

**Consequences (testable):**
- An unresolved Conflict is visible to an Admin on the Calendar without opening any detail view (DI-4).
- This applies to an Admin. A Member Role account sees no Conflict marks; their own schedule shows their own leave only (changed 2026-10-02, sprint-change-proposal-2026-10-02-ux-redesign).
- Distinction does not rely on color alone.

#### FR-39: Shift types are visually distinguishable
Working and non-working shift types are distinguishable at a glance.

**Consequences (testable):**
- Day, night, non-working, and leave are each distinguishable without reading the label.
- Distinction does not rely on color alone, and holds for an Organization defining Shift Types the design never anticipated.

**Out of Scope for MVP:** weekly and daily views; drag-and-drop editing; print layout; iCal or calendar-subscription feeds. Re-confirmed out of v1, 2026-10-10.

### 5.10 Hours

**Description:** Hours are derived, never entered. For each rostered Member, a working Scheduled Shift's Nominal Duration is split across the Organization's Hour Bands by interval intersection, so a shift straddling a boundary is divided correctly rather than labelled wholesale. Leave is reported separately, in Leave Days (human decision 2026-10-10), and a shift a Conflict Resolution moved to leave leaves the worked hours, so a Member on holiday never appears to have worked. Counts of shifts are reported alongside hours, because "5 day shifts, 60 hours" is how the numbers are actually checked. Realizes UJ-2, UJ-4.

**Functional Requirements:**

#### FR-40: Compute hours
The system computes, per Member and period, the shift count and Band Hours per Hour Band, Total Hours, and the leave in days only: the period's Leave Days, charged as the Leave Balance charges them (human decision 2026-10-10). A shift accepted as uncovered or replaced leaves Band Hours, Total Hours and the shift count, and appears only as its Leave Day.

**Consequences (testable):**
- Band Hours are derived by intersecting each working Scheduled Shift's nominal interval with the Organization's Hour Bands, and always sum exactly to Total Hours (DI-7).
- A shift straddling a band boundary is split, not rounded to one band: with bands at 06:00 and 21:00, a 19:00–07:00 shift yields 3 Day Hours and 9 Night Hours.
- A midnight-crossing shift is intersected as one continuous interval, never as two same-day fragments, and contributes its full Nominal Duration once to its start date's period (DI-5).
- On both daylight-saving transition dates a 12-hour shift still contributes 12 hours, and its band split is unchanged (DI-6).
- Hours follow the Shift Roster, so a Roster Override moves hours between Members (FR-31).
- A shift a Conflict Resolution moved to leave is never added into Band Hours or Total Hours; it counts only as its Leave Day.
- A period's Leave Days are the Leave Days of the Member's Leave Records inside it; summed over the periods a record spans, they equal the record's cost.

#### FR-41: Member hours view
A Member can view their own shift counts, Band Hours, Total Hours, and leave in Leave Days (`3 dana`) for a selected period. Realizes UJ-2.

**Consequences (testable):**
- Period selection covers at minimum a calendar month.
- A shift in unresolved Conflict is reported in a distinct state, so no total is silently wrong while the Conflict stands.

#### FR-42: Organization hours view
An Admin can view hours for all Members for a selected period. Realizes UJ-4.

**Consequences (testable):**
- Sortable and filterable by Team and Member.
- Per-Member figures reconcile exactly with that Member's own view (FR-41).
- The leave reads as on the Member's view (`3 dana`), sorts by days, and the footer sums them.
- Reachable in one navigation step from the Admin dashboard.

#### FR-42a: Export organization hours (added 2026-09-26, sprint change)
An Admin can export the Organization hours for a selected period to an Excel file. Realizes UJ-4.

**Consequences (testable):**
- The file holds exactly the rows the Organization hours view shows for that period and filter, in its sort order, with the same figures (FR-42). It is built from the same data the view rendered, never from a second read.
- Columns: Member, Team, shift count, one column per Hour Band named by the Organization's bands, Total Hours, Leave Days (*Godišnji odmor (dani)*): the heading names the unit, since a number format cannot inflect `dan/dana`. No band is hard-coded (DI-8).
- Figures are stored as numbers, not text, so they can be summed in the spreadsheet. Each hours cell is a duration whose number format reads as the screen does — `[h] "h"` for whole hours (`192 h`), `[h] "h" m "min"` for hours and minutes (`12 h 30 min`), `[m] "min"` under an hour (`30 min`) — chosen by the screen's own rule; the Leave Days are a plain count. A leave figure of 0 is an empty cell (2026-10-10).
- Column headers, sheet name and file name follow the Organization locale. The file name carries the Organization and the period.
- A shift in unresolved Conflict is marked in the file as it is on screen (FR-41), so no exported total is silently wrong.
- Only an Admin can export. A Member cannot export anyone's hours, their own included, in MVP.

#### FR-42b: An hours figure explains itself (added 2026-10-02, sprint-change-proposal-2026-10-02-ux-redesign)
Any figure on the Member or Organization hours view can be opened to show the Scheduled Shifts and Hour Bands that compose it. Realizes UJ-4.

**Consequences (testable):**
- The explanation lists every shift counted in the figure, with its date, Shift Type, Band Hours, and whether it came from the Rotation, an Override, or leave.
- The leave's explanation lists one line per charged Leave Day — its date, each shift's Team and Shift Type, `+1 dan` — and `= 3 dana` (2026-10-10).
- The equation is computed by the domain as codes and operands, never as prose, and sums exactly to the figure it explains (DI-7).
- The explained figure and the figure on the view are always equal (FR-41, FR-42).
- A shift in unresolved Conflict is marked in the explanation as it is on the view (FR-41).

**Out of Scope for MVP:** export as CSV or payroll formats (re-confirmed 2026-10-10), and any hours export other than FR-42a; pay rates and premiums; overtime rules; breaks within a shift; actual attendance as distinct from scheduled; period locking.

### 5.11 Annual Leave

**Description:** Each Member has a Leave Allowance for the Leave Year. An Admin records leave as a date range; only dates on which the Member had a working Scheduled Shift consume Leave Balance, which keeps the cost fair in a rotation where a Member is rostered roughly half the days. Members may also request leave, which an Admin approves or rejects (§5.15). Absence types, carry-over and half days are §5.19 (changed 2026-10-10). Recording leave never alters the rotation or the schedule (DI-3); it produces Conflicts, handled in §5.12. Realizes UJ-3.

**Functional Requirements:**

#### FR-43: Record leave
An Admin can create, edit, and delete a Leave Record for a Member as a date range, and see its cost in Leave Days before saving. Realizes UJ-3.

**Consequences (testable):**
- The record leaves every affected Scheduled Shift in place and the Rotation untouched (DI-3).
- A range overlapping an existing Leave Record for that Member is refused.
- Saving creates a Conflict for each affected working Scheduled Shift (FR-47).
- A record whose cost exceeds Leave Balance is saved with an explicit warning rather than refused, so a real agreement is never unrecordable. `[ASSUMPTION: warn-and-allow rather than refuse; confirm.]`

#### FR-44: Leave Day cost
The system computes a Leave Record's cost as the number of dates in the range on which the Member had a working Scheduled Shift.

**Consequences (testable):**
- Non-working dates inside the range cost nothing.
- Worked example: leave 10.09–14.09 against a schedule of `Dan`, `Noć`, `Slobodno`, `Slobodno`, `Dan` costs 3 Leave Days and raises 3 Conflicts.
- Cost is recomputed if an Override changes whether a date within the range is working.
- `[ASSUMPTION: this counting rule is inferred, not confirmed by the pilot organization. It is the single most consequential open question — see §11.2 Q1.]`

#### FR-45: Leave Balance
A Member can see their Leave Allowance, Leave Days used, and Leave Balance for the Leave Year. Realizes UJ-2, UJ-3.

**Consequences (testable):**
- The three figures are internally consistent at all times: Allowance minus used equals Balance.
- Deleting a Leave Record restores the consumed Balance.
- Balance is computed only from Leave Days inside the current Leave Year (FR-10).

#### FR-45a: Admin leave overview (added 2026-10-02, sprint-change-proposal-2026-10-02-ux-redesign)
An Admin can see every Member's Leave Allowance, Leave Days used, and Leave Balance for the Leave Year on one surface. Realizes UJ-3.

**Consequences (testable):**
- Each Member's three figures equal that Member's own view exactly (FR-45).
- Allowance minus used equals Balance on every row.
- A Member Role account cannot reach the overview or any other Member's figures (FR-5, FR-16).

#### FR-46: Amend or delete leave
An Admin can change a Leave Record's dates or delete it.

**Consequences (testable):**
- Amending recomputes cost and Conflicts for the new range.
- Deleting clears Conflicts arising from that record and leaves unrelated Conflicts intact.
- A Conflict already resolved by Replace Member does not have its Override silently reverted; the situation is surfaced to the Admin.

**Out of Scope for MVP:** public-holiday calendars; accrual over time; differing leave policies per Member group. Leave requests, absence types, carry-over and half days moved into v1 on 2026-10-10 (§5.15, §5.19).

### 5.12 Conflict Detection and Resolution

**Description:** The product's distinguishing stance. When leave and a working Scheduled Shift collide, the system records a Conflict and requires an Admin to resolve it explicitly, because a silently removed shift is an uncovered shift nobody was warned about (DI-3, DI-4). Three resolutions cover the real cases without pulling shift-swap mechanics into MVP. Realizes UJ-3, UJ-4.

**Functional Requirements:**

#### FR-47: Detect Conflicts
The system creates a Conflict for every working Scheduled Shift whose Shift Roster includes a Member covered by a Leave Record on that date.

**Consequences (testable):**
- Detection re-runs when leave is recorded, amended, or deleted; when an Override changes a shift or roster; when a Member changes Team or is deactivated; and when a Rotation changes.
- A Conflict persists until explicitly resolved — nothing expires or auto-clears it (DI-4).
- Detection deletes, hides, or alters no Scheduled Shift (DI-3).
- Non-working shifts coinciding with leave produce no Conflict.

#### FR-48: Conflict list
An Admin can see all unresolved Conflicts for their Organization, soonest first, in *Za odluku* beside pending Leave Requests and Swap Requests (changed 2026-10-10). Realizes UJ-3, UJ-4.

**Consequences (testable):**
- Each entry shows date, Team, Shift Type, Member, and the Leave Record that caused it.
- Conflicts for dates already past remain listed and are distinguishable from upcoming ones.
- The count of items waiting in *Za odluku* — unresolved Conflicts, pending Leave Requests and accepted Swap Requests — matches the Admin dashboard figure exactly (FR-53).
- The Croatian UI calls the queue *Za odluku*, its tabs *Čeka odluku* and *Odlučeno*, and never uses the word "konflikt" (changed 2026-10-10).

#### FR-48a: Resolved conflicts stay readable (added 2026-10-02, sprint-change-proposal-2026-10-02-ux-redesign)
An Admin can see the Organization's resolved Conflicts, each with its resolution, the acting Admin, and the timestamp.

**Consequences (testable):**
- Each entry shows date, Team, Shift Type, Member, the resolution chosen, who chose it, and when (DI-11).
- The list is a read of stored Conflict Resolutions and request decisions only; it adds no new record and is not the change history, which is FR-78 (changed 2026-10-10).
- A resolved Conflict never reappears in the unresolved list (FR-48).

#### FR-49: Resolve as Uncovered
An Admin can resolve a Conflict by accepting the shift as an Uncovered Shift.

**Consequences (testable):**
- The Scheduled Shift remains, is marked Uncovered, and stays visible on the Calendar (FR-38).
- The Member's hours no longer count the shift in Band Hours or Total Hours; it counts only as its Leave Day (FR-40).
- The resolution records the Admin and timestamp (DI-11).

#### FR-50: Resolve by Replace Member
An Admin can resolve a Conflict by replacing the absent Member on the shift with another Member.

**Consequences (testable):**
- Implemented as a Roster Override (FR-31); the Rotation is untouched (DI-2).
- The replacement's Band Hours increase; the absent Member's do not.
- The system warns, without blocking, if the replacement is themselves on leave or already rostered that date — consistent with FR-25 and FR-26's warn-not-block stance.
- The shift is no longer in Conflict and is not marked Uncovered.

#### FR-51: Resolve by Amend Leave
An Admin can resolve a Conflict by amending or deleting the underlying Leave Record.

**Consequences (testable):**
- Amending recomputes cost, Balance, and Conflicts for the new range (FR-46).
- Deleting restores consumed Balance and clears every Conflict from that record.

**Out of Scope for MVP:** Shift Type substitution as a resolution; Member-initiated resolution; notification beyond FR-62; bulk resolution across a date range. Two-member shift swaps moved into v1 on 2026-10-10 (§5.17).

### 5.13 Dashboards

**Description:** Each Role's landing surface, answering its standing questions without navigation. The Member dashboard is the most-used screen in the product and is designed for a phone. Realizes UJ-1, UJ-2, UJ-4.

**Functional Requirements:**

#### FR-52: Member dashboard
A Member landing in the application sees today's shift, their next working shift, their hours for the current period, their Leave Balance, and their upcoming shifts. Realizes UJ-2.

**Consequences (testable):**
- Today's shift states explicitly when the Member is not working, rather than rendering an empty area.
- Next working shift shows date, Shift Type, and both clock times, and skips non-working days.
- Hours show Band Hours and Total for the current period; Leave shows used and remaining.
- Upcoming shifts appear as a compact list covering at least the next seven days.
- Every figure matches its detail view exactly (FR-41, FR-45).
- Usable on a phone-width viewport with no horizontal scrolling (§8.3).

#### FR-53: Admin dashboard
An Admin landing in the application sees today's coverage by Team, upcoming shifts, unresolved Conflict count, upcoming leave, and total hours for the period. Realizes UJ-1, UJ-4.

**Consequences (testable):**
- Today's coverage lists each Team with its Shift Type, for any number of Teams.
- The count of items waiting in *Za odluku* is always shown, including when zero, and matches FR-48 (changed 2026-10-10).
- Where the Organization sets Minimum Members, the count of Short-staffed Shifts ahead is shown beside it, including when zero (FR-73).
- Each summary links to its corresponding list view.

*Sections §5.14–§5.20 were added on 2026-10-10 by `sprint-change-proposal-2026-10-10-v1-scope-expansion.md`. They ship in v1, before pilot go-live, in this order. Decisions taken that day: D1, Absence Types are Organization data, no record carries a reason, and a type's name is Admin- and self-only; D2, a swap goes Member → colleague → Admin; D3, part-day leave is a half day; D4, the change history is Admin-only.*

### 5.14 Installable and Offline (added 2026-10-10, sprint-change-proposal-2026-10-10-v1-scope-expansion)

**Description:** Members are on phones, often where the signal is poor. The application installs to the home screen as a PWA and shows the last schedule a Member read when there is no connection. It is labelled with the time that schedule is from, and nothing pretends to save. Realizes UJ-2.

**Functional Requirements:**

#### FR-54: Install the application
A Member can install the application to their device's home screen.

**Consequences (testable):**
- The application installs from Chrome on Android and from Safari on iOS, and opens without browser chrome.
- The installed name is the confirmed product name, not a working title, and no Organization's name or logo is hard-coded into the installed manifest (DI-8).
- An install entry is reachable from *Više*; nothing prompts installation as a modal on a first visit.
- A new version is announced in the application and applied on reload. It is never applied silently mid-task.

#### FR-55: Read offline with an as-of note
A Member without a connection can open every surface they have already read and see its last snapshot, labelled with the time that snapshot was taken.

**Consequences (testable):**
- Offline, a surface renders its whole last snapshot with `stanje od {datum} {vrijeme}` in the Organization timezone (FR-8).
- A cached figure is never shown beside a fresh one. A surface is either wholly cached and labelled, or wholly fresh (NFR-24).
- Online, a cached snapshot is never shown in place of a fresh read.
- The Member's current and next month are available offline after they have opened their dashboard once online.

#### FR-56: Writes refused offline
Every write is refused while offline, with a stated reason.

**Consequences (testable):**
- Each write control states that it needs a connection. No write is queued for later, and none is applied optimistically.
- Coming back online changes no record by itself.

#### FR-57: Signing out clears the device
Signing out removes every cached snapshot from the device.

**Consequences (testable):**
- After sign-out, no Organization data is readable from the device's storage, offline or online.
- A second account signing in on the same device sees none of the first account's cached data.

### 5.15 Leave Requests (added 2026-10-10, sprint-change-proposal-2026-10-10-v1-scope-expansion)

**Description:** A Member asks for leave from their phone and sees what it would cost; an Admin decides. Until an Admin approves, nothing in the schedule, the hours or the balance moves, and no Conflict exists (DI-3, DI-4). Approval asserts the Leave Record exactly as if the Admin had entered it. Realizes UJ-3.

**Functional Requirements:**

#### FR-58: A Member requests leave
A Member can send a request for a date range, of an Absence Type (FR-74), optionally a half day (FR-75), and sees its cost in Leave Days and their balance after it before sending.

**Consequences (testable):**
- The cost is computed by FR-44 from the same schedule the Member sees.
- A pending request creates no Conflict, charges no Leave Balance, changes no hours, and alters no Scheduled Shift or Shift Roster (DI-3).
- A range overlapping the Member's existing Leave Records or another pending request of theirs is refused when sent.
- A request carries no reason field (NFR-5).

#### FR-59: Withdraw a request
A Member can withdraw their own pending request.

**Consequences (testable):**
- A withdrawn request can no longer be decided, and it creates nothing.
- A decided request cannot be withdrawn. An approved leave is changed by an Admin through FR-46.

#### FR-60: An Admin decides a request
An Admin can approve or reject a pending request on its own screen, after seeing what approval would create.

**Consequences (testable):**
- Before deciding, the Admin sees the cost, the Member's balance after it, every Conflict approval would create, and every Short-staffed Shift it would cause (FR-72). These are computed by the same rules as a direct Leave Record (FR-43, FR-47), never a second implementation (NFR-19).
- Approval creates one Leave Record of the requested range, type and half, attributed to the approving Admin (DI-11). From that moment it behaves exactly as FR-43.
- Rejection records the decision and creates nothing.
- Each decision records the acting Admin and timestamp.
- If the schedule has changed so that the request no longer applies, approval is refused as stale and the request stays pending.
- A pending request appears in *Za odluku* beside unresolved Conflicts (FR-48); a decided one appears in *Odlučeno* (FR-48a).

#### FR-61: A Member sees their requests
A Member can see their own pending, approved, rejected and withdrawn requests.

**Consequences (testable):**
- Each request shows its range, type, cost and state, and for a decision its date.
- A Member Role account cannot read another Member's requests (FR-16).

### 5.16 Notifications (added 2026-10-10, sprint-change-proposal-2026-10-10-v1-scope-expansion)

**Description:** People hear about what concerns them without opening the application. Email comes first; push follows for Members who installed the application, which is the only channel for a Member without an email address. A notification reports a fact that was recorded. It is never a calculation of its own, and never news about another Member's absence. Realizes UJ-2, UJ-3.

**Functional Requirements:**

#### FR-62: Events and recipients
The system notifies a Member when their leave request is decided, when an Admin records leave for them, when their own shifts change through a Roster or Shift Type Override, a swap, or a rotation change taking effect within the next 30 days, and when a swap is proposed to them or decided. It notifies every Admin when a new item waits in *Za odluku*.

**Consequences (testable):**
- Each notification is written by the same request that records the fact it reports, as a code and its operands. The sender computes no domain answer.
- Each notification is sent at most once per recipient and channel.
- A notification states facts in the Organization locale and links to the surface concerned.
- No notification to a Member Role account names another Member's absence or Absence Type (NFR-5).
- Shift reminders that need a projection outside the browser are out of v1.

#### FR-63: Email
A Member with an email address receives notifications by email.

**Consequences (testable):**
- Email goes only to the Member's own recorded address, never to a synthesized sign-in address.
- An email failure is retried and never blocks the write that caused it.

#### FR-64: Push
A Member who installed the application and allowed notifications receives them as push.

**Consequences (testable):**
- Push carries the same events as email (FR-62).
- On iOS, push is offered only to the installed application, and the settings say so.
- A subscription the push service reports as gone is removed.

#### FR-65: Notification settings
A Member can turn email and push on or off for themselves.

**Consequences (testable):**
- The settings show the recorded email address, or state that none is recorded.
- A Member with neither channel available is told so in words.
- A channel turned off receives nothing from that moment.

### 5.17 Shift Swaps (added 2026-10-10, sprint-change-proposal-2026-10-10-v1-scope-expansion)

**Description:** Members arrange swaps between themselves today by phone, and the rota never learns of them. Here a Member proposes, the colleague accepts, and an Admin approves. Only approval writes anything, and what it writes is ordinary Roster Overrides, so the rotation is untouched (DI-2) and the hours follow (FR-40). Realizes UJ-3.

**Functional Requirements:**

#### FR-66: Propose a swap
A Member can propose to give a colleague one of their own working Scheduled Shifts, optionally taking one of the colleague's working Scheduled Shifts in return.

**Consequences (testable):**
- The return shift is optional. Without it, the swap is a one-way cover.
- A given shift that is not a working shift on the proposer's roster, or a return shift not on the colleague's, is refused when sent.
- The proposer sees the consequence for both Members before sending: who works which date, and each Member's hour delta.
- A proposal changes no Scheduled Shift, Shift Roster or hours (DI-2).

#### FR-67: The colleague answers
The colleague can accept or decline a swap proposed to them.

**Consequences (testable):**
- A declined swap is closed and creates nothing.
- An accepted swap appears in *Za odluku* for an Admin. Until the Admin decides, it still changes nothing.

#### FR-68: An Admin decides a swap
An Admin can approve or reject an accepted swap on its own screen, after seeing its consequences.

**Consequences (testable):**
- Before deciding, the Admin sees each Member's hour delta, any leave or double booking either Member would have, and any Short-staffed Shift (FR-72). These warn and never block, as in FR-50.
- Approval writes a Roster Override replacing the proposer with the colleague on the given shift and, when there is a return shift, one replacing the colleague with the proposer on it. Each is attributed to the approving Admin with the reason "swap", and passes the AD-5 erasure check.
- Rejection records the decision and creates nothing.
- If either shift has changed so that the swap no longer applies, approval is refused as stale.

#### FR-69: Withdraw a swap
Either Member can withdraw a swap before an Admin decides it.

**Consequences (testable):**
- A withdrawn swap disappears from *Za odluku* and creates nothing.

### 5.18 Minimum Members (added 2026-10-10, sprint-change-proposal-2026-10-10-v1-scope-expansion)

**Description:** An Admin needs to know a shift is short before it arrives. An Organization sets one number: how many people a working shift needs. The application states plainly wherever a shift falls short — before the save that causes it, on the calendar, and on the Admin dashboard. It warns and never blocks, because the Admin may have no one else (FR-25, FR-26 stance). It never reads Fire Rank or Team Position (FR-18a). Realizes UJ-3.

**Functional Requirements:**

#### FR-70: Minimum Members setting
An Admin can set the Organization's Minimum Members, or leave it empty.

**Consequences (testable):**
- An empty setting reports nothing anywhere.
- The value is Organization data. No default exists in the core (DI-8).
- Changing it changes the short-staffed state of past and future shifts alike, as moving an Hour Band does.

#### FR-71: Short-staffed is derived
The system derives, for every working Scheduled Shift, the people at work and whether they are fewer than Minimum Members.

**Consequences (testable):**
- People at work are the Shift Roster after Overrides, minus every Member absent that date by any Absence Type, with replacements counted. A Member on a half day counts as at work.
- Non-working shifts are never short-staffed.
- The state is derived on read and never stored. It ends only when the roster, the absence or the setting changes. Nothing resolves it.
- A Member deactivated from a date leaves their future shifts short-staffed where the count falls below the setting (§11.2 Q5).

#### FR-72: Shown before every save that causes it
Every write that can make a shift short-staffed reports it before saving.

**Consequences (testable):**
- Reported by: recording or amending leave (FR-43), approving a Leave Request (FR-60), a Roster or Shift Type Override (FR-30, FR-31), approving a swap (FR-68), every Conflict Resolution (FR-49 to FR-51, in the consequence strip's coverage term), deactivating a Member (FR-12), and saving a Rotation (FR-24).
- The report names the date, the Team, the people at work, and the minimum. It is a block in the change summary, not a quiet line.
- It never blocks the save.

#### FR-73: Shown on the calendar and the dashboard
Short-staffed shifts are marked on the Calendar day and counted on the Admin dashboard.

**Consequences (testable):**
- The Calendar marks a short-staffed shift for an Admin without opening a detail view, with a glyph and a legend entry, not by colour alone (NFR-25).
- The day detail states the people at work against the minimum.
- The Admin dashboard shows the count of short-staffed shifts ahead, including zero, linked to their dates.

### 5.19 Absence Types, Carry-over and Half Days (added 2026-10-10, sprint-change-proposal-2026-10-10-v1-scope-expansion)

**Description:** Annual leave is not the only absence an Organization records, unused leave carries into the next year, and some absences are half a shift. All three are Organization data or derived from it. None records a reason (NFR-5). Every absence collides with a rostered working shift exactly as annual leave does (DI-3, DI-4); only the types that draw down the allowance change the balance. Realizes UJ-3, UJ-4.

**Functional Requirements:**

#### FR-74: Absence Types
An Admin can define Absence Types by name, each stating whether it draws down the Leave Allowance, and every Leave Record has one.

**Consequences (testable):**
- Every Organization starts with one drawing type for annual leave. Existing Leave Records become that type.
- Every type raises Conflicts against a rostered working shift (FR-47). Only drawing types count toward Leave Balance (FR-45).
- A type's name is visible only to Admins and to the Member themselves. To any other Member, the Member reads as absent (NFR-5).
- The hours views and the Excel export report Leave Days per drawing type and one total for the rest, with columns named by Organization data (FR-42a, DI-8).

#### FR-75: Half-day records
An Admin, or a Member through a request, can record a one-date absence covering the first or second half of the Member's working shift that date.

**Consequences (testable):**
- It costs 0.5 Leave Days.
- It raises one Conflict, like a full day.
- The worked half's interval counts in Band Hours and Total Hours by band intersection (FR-40, DI-7). The absent half counts in neither.
- A half-day record on a date without a working shift is refused.

#### FR-76: Carry-over
An Admin can set the Organization's carry-over: the maximum days that carry into the next Leave Year, and the date they expire.

**Consequences (testable):**
- Leave Allowance is held per Leave Year, so an earlier year's allowance stays as it was.
- Carried-over Days are the previous year's unused balance, capped by the maximum. They are derived and never entered.
- Leave Days consume carried days first; carried days not used by the expiry date lapse.
- An empty or zero maximum means no carry-over. No default exists in the core (DI-8).

#### FR-77: Balance with carry-over
A Member and an Admin see the Leave Balance including carried days and their expiry.

**Consequences (testable):**
- Balance = Allowance + unexpired Carried-over Days − Leave Days of drawing types, consistent at all times (FR-45).
- The Member's view, the Admin's leave overview (FR-45a) and the dashboard show the same figures (NFR-24).

### 5.20 Change History (added 2026-10-10, sprint-change-proposal-2026-10-10-v1-scope-expansion)

**Description:** DI-11 made every manual change attributable; this makes it readable. An Admin sees who changed what and when, deletions included, and can hand it on as a PDF. Member Role accounts reach none of it. Realizes UJ-4.

**Functional Requirements:**

#### FR-78: History surface
An Admin can read the Organization's change history, filtered by period, Member, Team and kind of change.

**Consequences (testable):**
- Every write to a rule, an exception, a decision, a request, a Member or a setting appears with its author, its time, and its values before and after. A deletion appears as well.
- The history is append-only. No surface edits or removes an entry.
- History begins at its introduction. Earlier entries are reconstructed from existing attribution where it exists, and the surface says where history begins.
- A Member Role account is refused every entry at the data layer (NFR-2).

#### FR-79: Export the history to PDF
An Admin can export the filtered history to a PDF file.

**Consequences (testable):**
- The file holds exactly the rows the surface shows for that filter, in its order, built from the same data the surface rendered.
- It names the Organization, the period, the filter, and the time it was generated, in the Organization locale and timezone.
- Only an Admin can export it.

## 6. Non-Goals

- **This is not a fire-department management system.** No interventions, incident reporting, equipment, vehicles, readiness, or training. Those are candidate industry modules layered on a validated core, never part of it.
- **This is not a payroll or time-and-attendance system.** Hours are what was *scheduled*, not what was *attended*. No rates, no pay, no government reporting.
- **This is not a workforce-optimization tool.** No demand forecasting, no auto-assignment, no optimization of coverage against predicted load.
- **This is not a communication tool.** Notifications tell a Member about their own schedule and their own requests, and tell an Admin what waits for a decision (§5.16). No messaging, chat, broadcast, announcements, or SMS (changed 2026-10-10).
- **This does not become a staffing optimizer.** One Minimum Members number warns. It never assigns anyone, never blocks a save, and never reads Fire Rank or Team Position, which stay inert (FR-18a) (added 2026-10-10).
- **This does not become a general permission system.** Two Roles. Not a role builder, not per-resource ACLs.
- **This does not become a fire-department product by accretion.** Any requirement that cannot be expressed as Organization data is a requirement to reject or generalize (DI-8). The one recorded exception is FR-18a, whose fixed lists are descriptive, inert and gated by a setting.

## 7. MVP Scope

### 7.1 In Scope

Authentication with Organization and Role resolution · operator-provisioned multi-tenant Organizations with enforced isolation · Organization profile, Organization Type, timezone, locale, Hour Bands, Leave Year, and branding · Members with Roles, status, Team, and Leave Allowance · Admin member list with search, sort, filter · read-only member directory · Teams of any number · configurable Shift Types including midnight-crossing and non-working · band-based day/night hour computation · Rotation Patterns of arbitrary cycle length · Rotation Assignments with Offset and Anchor Date · coverage and rest-gap warnings · schedule projection for any date · Shift Rosters · Shift Type and Roster Overrides with attribution and visible overridden state · monthly Calendar with Team/Member filters, filter reset, leave, conflicts, and uncovered shifts · shift counts and Band Hours per Member and Organization · Excel export of Organization hours · annual leave with allowance, Leave Day cost, and balance · leave/schedule Conflict detection with three explicit resolutions · Member and Admin dashboards · *added 2026-10-10:* installable PWA with offline reading · Member leave requests with Admin approval · email and push notifications · Minimum Members with short-staffed warnings · Member shift swaps with Admin approval · Absence Types, carry-over and half-day records · Admin change history with PDF export · Croatian UI on a fully internationalized architecture · responsive across mobile, tablet, desktop.

### 7.2 Out of Scope for MVP

Grouped with reasons where the reason matters.

*On 2026-10-10 leave requests, shift swaps, Absence Types, carry-over, part-day leave, minimum staffing, the change-history interface, PDF export of that history, notifications and PWA installation moved into v1 (`sprint-change-proposal-2026-10-10-v1-scope-expansion.md`). What remains below is re-confirmed out.*

**Deferred because the workflow is a feature in itself:**
- Temporary loan of a Member to another Team.

**Deferred because MVP has no need:**
- Public-holiday calendars; accrual over time; leave policies per Member group.
- Breaks within a shift; overtime; actual attendance distinct from scheduled.
- Export beyond FR-42a's Excel file of Organization hours and FR-79's change-history PDF (CSV, payroll formats, other surfaces); advanced reporting; analytics; team statistics.
- Staffing rules beyond one Minimum Members warning (§5.18); qualification constraints; statutory rest-period enforcement.
- Weekly and daily Calendar views; drag-and-drop editing; print; iCal feeds (re-confirmed 2026-10-10).
- Multiple Teams per Member; multiple Organizations per user.

**Deferred because it is a go-to-market decision, not a product one:**
- Self-service organization signup and onboarding wizard.
- Billing, subscription plans, payment processing.
- English or any second shipped language. The architecture is ready (§8.2); the translation is not in MVP.

**Deferred because it is a different product:**
- Notifications beyond FR-62's events: shift reminders, messaging, broadcast, SMS.
- Native mobile applications.
- Industry modules (interventions, equipment, vehicles, training, patrol routes, production lines).
- Public API and third-party integrations.

## 8. Cross-Cutting Non-Functional Requirements

### 8.1 Tenancy and Security

- **NFR-1.** Tenant isolation is enforced at the database layer via row-level security or equivalent, not in application or frontend code (DI-9). A test that issues a cross-tenant read with a valid session must fail closed.
- **NFR-2.** Role restriction is enforced at the same layer. Every administrative write is refused for a Member Role account identically whether attempted through the UI or a direct API call (FR-5).
- **NFR-3.** Every Organization-scoped record carries its Organization reference; no record is reachable without it.
- **NFR-4.** Uploaded branding assets are readable only by Members of the owning Organization.
- **NFR-5.** Personal data held is limited to what scheduling requires: name, optional email, team, hours, and absence by type. No absence record has a reason, a diagnosis, or a free-text field. An Absence Type's name is visible only to Admins and to the Member themselves; to anyone else the Member reads as absent. Where an Organization names a type for sick leave, that fact is health data, and it is held under that visibility rule and no wider (changed 2026-10-10).

### 8.2 Internationalization and Localization

- **NFR-6.** No user-facing string is hard-coded in any component, hook, page, validation rule, or other frontend code. Every string resolves through a translation key (DI-10). This applies to navigation, buttons, form and table labels, validation and error messages, empty states, confirmation dialogs, and every calendar, shift, leave, hours, and settings label.
- **NFR-7.** Adding a language requires adding a translation resource and no change to any component or to business logic.
- **NFR-8.** The MVP ships Croatian (`hr`) as the only complete locale. A second locale may exist incomplete without breaking the application; a missing key degrades visibly and safely, never to a blank screen.
- **NFR-9.** Dates, times, numbers, month and day names, and pluralization are produced by a single locale-aware formatting layer, never by ad-hoc string construction. Croatian's three-form plural rule must be handled by that layer — an English-shaped `count === 1` check is a defect.
- **NFR-10.** Domain logic returns keys, codes, and values only. No formatted or translated display string originates in the domain layer (DI-10).
- **NFR-11.** Any new user-facing string introduced during development goes through the internationalization system. This is a merge-blocking rule, not a guideline.

### 8.3 Platform and Responsiveness

- **NFR-12.** The application is a responsive web application supporting mobile, tablet, and desktop, installable as a PWA and readable offline (§5.14). No native application in MVP.
- **NFR-13.** Members are assumed to be primarily on phones. Their priority order on small viewports is: today's shift, next shift, calendar, hours, leave.
- **NFR-14.** Admins are assumed to be primarily on desktop or tablet, with every administrative task also completable on mobile — degraded in comfort, never in capability.
- **NFR-15.** No screen requires horizontal scrolling at a phone-width viewport. A table — the member list, the hours table — becomes stacked rows below 640 px, and the Calendar grid still scrolls within its own container (changed 2026-10-02, sprint-change-proposal-2026-10-02-ux-redesign).

### 8.4 Domain Logic Isolation

- **NFR-16.** Rotation projection, schedule generation, hour calculation, Leave Day counting, and conflict detection are implemented as pure, framework-free, unit-testable logic with no React dependency and no direct data-access dependency.
- **NFR-17.** Every Domain Invariant in §4 has at least one automated test asserting it, executable without rendering a component or starting a browser.
- **NFR-18.** The pilot configuration is a test fixture, and at least one structurally different configuration — different team count, cycle length, and shift durations — is a second fixture. Both run in the same suite (UJ-5).
- **NFR-19.** There is one canonical implementation of each domain calculation. The same input produces the same output regardless of where it is invoked from.

### 8.5 Auditability

- **NFR-20.** Every Override and Conflict Resolution records the acting Admin, a timestamp, and the affected records, and that record outlives the schedule entry it modified (DI-11).
- **NFR-21.** Every write to an Organization's records can be reconstructed: its author, its time, and the values before and after. Admins read it on the change-history surface (FR-78) (changed 2026-10-10).

### 8.6 Performance and Reliability

- **NFR-22.** A monthly Calendar in the all-Teams view renders within two seconds on a mid-range phone over typical mobile network conditions, at the pilot's scale.
- **NFR-23.** Navigating to any month, past or future, performs comparably regardless of whether that range has been visited before (FR-27).
- **NFR-24.** Hour and leave figures are consistent across every surface that displays them at any given moment; no screen shows a stale total alongside a fresh one.

### 8.7 Accessibility

- **NFR-25.** No information is conveyed by color alone — shift types, conflicts, uncovered shifts, overridden state, and leave all carry a non-color signal.
- **NFR-26.** The Calendar and both dashboards are keyboard navigable and expose meaningful labels to assistive technology. `[ASSUMPTION: WCAG 2.1 AA as the target without formal audit in MVP; confirm.]`

## 9. Aesthetic and Tone

The product should read as a modern SaaS application, not a traditional internal scheduling tool — that gap is much of what makes the spreadsheet feel normal.

**Visual direction:** clean, professional, highly readable, minimal clutter. Neutral and light backgrounds, strong typography carrying the hierarchy, subtle borders, cards where they earn their place, clear status badges. Restrained use of brand color — accent, not fill.

**Anti-references:** dense enterprise grids with no hierarchy; color-coded spreadsheets ported to the web; consumer-app playfulness that undercuts an operational tool people rely on.

**Shift-type legibility is the central visual problem.** Day, night, non-working, leave, conflict, uncovered, and overridden must all be distinguishable at a glance in a dense monthly grid, without color alone (NFR-25), and the scheme must hold for an Organization that defines Shift Types the design never anticipated (DI-8).

**Branding:** the pilot may use a fire-department-inspired red accent, but the design system must treat accent color as Organization data from the start. No Organization's palette may be the system's default assumption.

**Voice:** plain, direct Croatian. Product-generated text states facts — "Danas ne radiš" rather than an empty space the member has to interpret (FR-52). No exclamation marks, no encouragement, no personality where a fact will do.

## 10. Success Metrics

### Primary

- **SM-1.** The pilot Organization retires its spreadsheet — the platform is the sole source of truth for the rota within one month of go-live, with no parallel manual schedule maintained. Validates FR-22, FR-23, FR-27, FR-30, FR-31.
- **SM-2.** A Member opens the application and answers "when do I next work?" in under five seconds, without navigating away from the landing screen. Validates FR-29, FR-52.
- **SM-3.** Month-end hour figures are produced by the system and accepted without manual recomputation, for every Member, for two consecutive months. Validates FR-40, FR-41, FR-42.
- **SM-4.** Zero shifts left uncovered by an *undetected* leave collision. Deliberately uncovered shifts (FR-49) do not count against this. Validates FR-47, FR-48, FR-49.
- **SM-5.** A second Organization in a different industry, with a different team count, cycle length, and shift durations, is configured with no code change, no schema migration, and no branch. Validates DI-8, NFR-18, UJ-5.

### Secondary

- **SM-6.** The Admin configures the full pilot rotation — Shift Types, Pattern, Teams, Offsets — unaided, without developer help and without written instructions beyond the UI. Validates FR-19, FR-22, FR-23.
- **SM-7.** Every Conflict raised during the pilot's first two months reaches an explicit resolution. Validates FR-47, FR-48, FR-49, FR-50, FR-51.
- **SM-8.** Members access the application predominantly on phones, confirming the mobile-first assumption. Validates NFR-13.

### Counter-metrics (do not optimize)

- **SM-C1.** **Override count must not be driven toward zero.** A steady stream of Overrides means the tool is being used honestly to record what actually happened. Zero Overrides more likely means people have gone back to arranging cover by phone. Counterbalances SM-1.
- **SM-C2.** **Time-to-resolve a Conflict must not be minimized by automation.** Any change that resolves Conflicts faster by deciding on the Admin's behalf violates DI-4 and defeats the product's central stance. Counterbalances SM-7.
- **SM-C3.** **Configuration speed must not be bought with pilot-shaped defaults.** Pre-filling four teams, a four-slot pattern, or twelve-hour day/night shifts would improve SM-6 while destroying SM-5. Counterbalances SM-6.
- **SM-C4.** **Feature count must not grow toward the pilot's domain.** Requests for interventions, equipment, or training will come from a happy pilot. Satisfying them inside the core trades SM-5 for short-term goodwill. Counterbalances SM-1.

## 11. Open Questions

### 11.1 Conflicting inputs

**No unresolved conflicts.** All four are settled below.

**Resolved.**

- **C-1. Pilot rotation direction — resolved by the author, 2026-09-01.** The author PRD §3 rotation table implied Team A ran `DAY, OFF, OFF, NIGHT`, contradicting both the original brain dump and the author PRD §20 conflict example, which both gave `DAY, NIGHT, OFF, OFF`. **Confirmed: the Rotation Pattern is `DAY → NIGHT → OFF → OFF` and every Team follows it at its own Offset.** The §3 table was an authoring slip. The consequence is deliberate and worth naming plainly: a crew works 07:00–19:00 and then straight into 19:00–07:00, so **the pilot runs 24-hour duty periods followed by 48 hours off**, expressed as two consecutive 12-hour Shift Types rather than one 24-hour shift. Nothing in the engine changes — this is seed data (addendum §1) — but it means the pilot's own configuration legitimately triggers FR-26's Rest Gap Warning, which FR-26 accounts for.

- **C-2. Hour classification — reconciled by the author, 2026-09-01.** During the brief I recommended splitting day and night hours by intersecting each shift with a configurable night window. The author PRD §18's worked example — five day shifts giving 60 day hours, four night shifts giving 48 night hours — read as whole-shift attribution instead, and was initially resolved that way. The author then confirmed the day/night boundary belongs in Organization settings ("maybe night shift is from 9pm to 6am"). **The two readings reconcile completely:** with Hour Bands set to the pilot's own changeover times, 07:00 and 19:00, interval intersection reproduces the author PRD's worked example exactly, because the pilot's shift boundaries and its day/night boundaries coincide. Resolved in favour of Hour Bands (FR-9, FR-21, FR-40, DI-7) — identical numbers for the pilot, and correct for any organization whose bands and shifts diverge.
- **C-3. Leave requests.** During the brief I recommended Members request and Admins approve. The author PRD §36 places member-submitted requests and approval workflow in future opportunities. The author PRD wins: MVP leave is Admin-entered only (§5.11), flagged in §7.2 as the most likely early follow-up.
- **C-4. Team membership requirement.** Author PRD FR-15 requires Members to belong to an active team, while §8 says a Member "normally belongs to one team". Resolved toward §8: unassigned is permitted and yields an empty schedule (FR-18), so onboarding has no unrepresentable state.

### 11.2 Open questions

Ordered by how much they cost to get wrong.

1. **How exactly are Leave Days counted?** FR-44 states a rule — only dates with a working Scheduled Shift draw down balance — but it is inferred. The pilot's actual convention may count calendar days, working days on a Mon–Fri notion, or shifts. Needs confirmation from the fire department, and it changes the meaning of a 30-day allowance by roughly a factor of two. *Blocks: nothing structurally; changes FR-44 and FR-45 behavior.*
2. **Are generated shifts persisted or computed on read?** The invariants (DI-1, DI-2) point toward computing from Pattern, Offset, and Anchor Date with only Overrides persisted, but Calendar performance (NFR-22) and roster queries may argue otherwise. *For `bmad-architecture`.*
3. **If persisted, how far ahead, and how is the horizon maintained?** *For `bmad-architecture`.*
4. **What happens to future schedule and Overrides when a rotation changes mid-cycle?** FR-24 states explicit review; the mechanism is unspecified. *For `bmad-architecture`.*
5. **What happens to a deactivated Member's future scheduled shifts?** *Answered 2026-10-10:* nothing Conflict-like. Where the Organization sets Minimum Members, a vacated shift shows as short-staffed (FR-71), and the deactivation's preview reports it (FR-72).
6. **How much of another Member's information may a Member Role account see?** FR-16 assumes leave and hours are Admin-only. A volunteer organization may expect full transparency. *Product question.*
7. **Can a Member be temporarily loaned to another Team?** Currently expressible only as repeated Roster Overrides (FR-31). Whether that is adequate or needs a first-class concept is a v2 question. *Deferred.*
8. **Should one user eventually belong to multiple Organizations?** Out of scope now (§2.2); worth knowing whether it is ever intended, since it shapes the identity model. *For `bmad-architecture` to note, not to solve.*
9. **What retention applies to schedule and leave history, and to the change history (FR-78)?** Unbounded is assumed. *Deferred.*
10. **Is WCAG 2.1 AA the accessibility target, and is a formal audit ever expected?** *For `bmad-ux`.*
11. **Does the pilot need any absence reason recorded?** *Answered 2026-10-10:* no, never (NFR-5). Open: does the pilot record sick leave at all? If it does, admin-only visibility of the Absence Type is the minimum its legal basis requires (GDPR Art. 9(2)(b)). *Confirm with the pilot.*

## 12. Assumptions Index

Every `[ASSUMPTION]` in this document, for explicit confirmation:

- **§5.3 FR-16** — Another Member's leave, hours, and contact details are visible only to Admins. A volunteer organization may prefer full transparency. *See §11.2 Q6.*
- **§5.6 FR-24** — When a rotation changes, Overrides on or after the effective date are surfaced for explicit review rather than silently kept or silently dropped.
- **§5.9 FR-37** — In the all-Teams Calendar view, leave is shown as an indicator or count rather than per-Member detail; UX to settle the treatment.
- **§5.11 FR-43** — A Leave Record whose cost exceeds Leave Balance is saved with a warning rather than refused, so a real agreement is never unrecordable.
- **§5.11 FR-44** — Leave Days are counted as dates in the range on which the Member had a working Scheduled Shift. *The most consequential assumption in the document — see §11.2 Q1.*
- **§8.1 NFR-5** — *Settled 2026-10-10:* no absence reason is ever recorded. Whether the pilot records sick leave at all is still open. *See §11.2 Q11.*
- **§8.7 NFR-26** — WCAG 2.1 AA is the target, without formal audit in MVP.
