---
title: "Addendum — Shift Management Platform PRD"
status: draft
created: 2026-09-01
updated: 2026-09-01
---

# Addendum — Shift Management Platform PRD

Material that belongs downstream (architecture, UX, epics) rather than in the PRD, plus the traceability from the author-written PRD onto this one.

---

## 1. Pilot Configuration (seed data, not product behavior)

Per DI-8, none of this appears in the domain model, the schema, or any branch in business logic.

**Organization**
```
Name:              DVD Kaštel Novi
Organization Type: Fire Department   (inert — FR-7)
Timezone:          Europe/Zagreb     (observes DST)
Locale:            hr
Accent color:      red (Organization data, not a system default)
```

**Teams:** four, named `A`, `B`, `C`, `D`. Names and count are data.

**Shift Types**

| Name | Window | Nominal Duration | Working |
|---|---|---|---|
| Dan | 07:00–19:00 | 12h | yes |
| Noć | 19:00–07:00 (+1) | 12h | yes |
| Slobodno | — | 0h | no |

Shift Types carry no hour classification (FR-21) — that is set separately below.

**Hour Bands** (FR-9) — the day/night boundaries used for hour reporting, independent of the Shift Types above:

| Band | Starts | Window | Crosses midnight |
|---|---|---|---|
| Dan | 07:00 | 07:00–19:00 | no |
| Noć | 19:00 | 19:00–07:00 | yes |

The two bands partition the full 24 hours. For the pilot they coincide exactly with the Shift Type changeover times, so each shift falls wholly inside one band and hours come out as 12 Day / 0 Night for `Dan` and 0 Day / 12 Night for `Noć` — reproducing the author PRD §18 worked example (5 day shifts = 60 Day Hours, 4 night shifts = 48 Night Hours, 108 Total). Bands and Shift Types are nonetheless separate settings: moving the `Noć` band to 21:00 would re-split the same 19:00–07:00 shift into 3 Day + 9 Night without touching any Shift Type.

**Rotation Pattern:** `[Dan, Noć, Slobodno, Slobodno]`, cycle length 4, one Team per Offset. **Confirmed by the author 2026-09-01** (PRD §11.1 C-1); the author PRD §3 table showing a different traversal was an authoring slip and is not used.

| Team | Offset | Team's own cycle |
|---|---|---|
| A | 0 | Dan → Noć → Slobodno → Slobodno |
| B | 1 | Noć → Slobodno → Slobodno → Dan |
| C | 2 | Slobodno → Slobodno → Dan → Noć |
| D | 3 | Slobodno → Dan → Noć → Slobodno |

Day grid:

```
          A         B         C         D
Day 1    Dan       Noć       Slob      Slob
Day 2    Noć       Slob      Slob      Dan
Day 3    Slob      Slob      Dan       Noć
Day 4    Slob      Dan       Noć       Slob
```

**What this pattern actually is.** `Dan` sits immediately before `Noć`, so a crew works 07:00–19:00 and continues straight through 19:00–07:00: **a 24-hour duty period followed by 48 hours off.** The pilot is a 24-on / 48-off rota, modelled as two consecutive 12-hour Shift Types rather than one 24-hour Shift Type.

Consequences worth carrying into architecture and UX:
- The Shift Type model needs no change — the pilot is expressible as-is (FR-19, FR-20).
- Hours are unaffected: 12 + 12 = 24 hours per duty period, 2 shifts per cycle, identical to any other decomposition (FR-21, FR-40).
- FR-26's Rest Gap Warning fires for this configuration by design, reporting 24 continuous hours. Not a misconfiguration.
- **UX consideration for `bmad-ux`:** a member on the Day 1 → Day 2 boundary is working one continuous 24-hour stretch shown as two Calendar entries on two dates. The Member dashboard's "today's shift" and "next shift" (FR-52) should not make that read as two unrelated shifts with a gap between them. Worth a deliberate treatment.
- **Alternative modelling, considered and rejected:** if the DVD thinks of this as one 24-hour duty rather than two shifts, a single 07:00–07:00 Shift Type is valid (FR-20) and — now that hours are computed by Hour Band intersection rather than by Shift Type label — would still report 12 Day and 12 Night Hours correctly. So the hour split is no longer an argument either way. The two-shift decomposition is retained because it matches the author's stated model, because the Rotation Pattern is defined as four slots of which two are working, and because shift *counts* per type ("5 day shifts, 4 night shifts", FR-40) are only meaningful if day and night are distinct Shift Types. Recorded rather than reopened.

**Verified properties of the confirmed configuration:**
- Every calendar day has exactly one Team on `Dan` and exactly one on `Noć`. Coverage is complete and non-overlapping.
- Each Team works 2 shifts and 24 hours per 4-day cycle; all four Teams are symmetric.
- Over a 28-day period each Team accrues 84 `Day` Band Hours and 84 `Night` Band Hours, 168 Total.
- Because the pilot's Hour Bands coincide with its shift changeovers, no shift straddles a band boundary and no split arises. An organization whose bands and shifts diverge exercises FR-40's splitting path — worth keeping as a second test fixture (NFR-18).

**Important:** full coverage is a property of *this* configuration, not a guarantee of the engine. An arbitrary pattern, team count, or offset assignment can leave days uncovered or double-covered — which is why FR-25 exists and why it warns rather than blocks.

---

## 2. Technical Direction (strong preferences, to be pressure-tested in Architecture)

**Frontend**
- React, TypeScript, Vite
- TanStack Router (routing), TanStack Query (server state), TanStack Table (member list, hours tables — see FR-15, FR-42)
- shadcn/ui as the component foundation, Tailwind CSS for styling and layout

**Backend / infrastructure**
- Supabase — PostgreSQL, Supabase Auth, Supabase Storage (branding assets, FR-11)
- PostgreSQL Row Level Security for tenant isolation (NFR-1, NFR-2)

**Non-negotiable structural constraint (NFR-16 … NFR-19).** Rotation projection, schedule generation, hour calculation, Leave Day counting, and conflict detection are pure, framework-free, unit-testable domain logic — no React dependency, no direct data-access dependency. TanStack Query manages server state; it does not host business rules. The pilot configuration and at least one structurally different configuration are test fixtures.

**Reusable domain components** (avoid duplicating UI patterns across pages): shift badge, calendar cell, calendar grid, team chip, member row, leave range, hours summary, dashboard card, conflict state, override marker.

**To reconsider during Architecture:**
- **Where domain logic executes** — client-side TypeScript, Postgres functions, or Supabase Edge Functions — and whether any part must be duplicated. NFR-19 requires one canonical implementation; a naive split violates it.
- **RLS policy design** for the Admin / Member Role split within a tenant, without policy sprawl. Note NFR-2 requires role enforcement at the data layer, which is more than tenant scoping.
- **Whether compute-on-read projection is viable** within Supabase's query model, or whether Calendar performance (NFR-22) and roster queries force materialization. See §5 Q1 below.
- **Calendar-scale query shape** — a month across all Teams with rosters, leave, conflicts, and override markers, in one round trip if possible.
- **Whether `hr`-only MVP warrants full ICU message formatting.** NFR-9's Croatian three-form plural rule suggests yes.
- **Identity model headroom** for a user belonging to multiple Organizations later (§11.2 Q9), without building it now.
- **Attribution storage** satisfying DI-11 / NFR-20-21 without an audit-log table nobody reads.

---

## 3. Proposed Data Model (author-supplied, for Architecture to ratify or replace)

```
organizations
    │
    ├── organization_settings
    │
    ├── memberships ─── users
    │
    ├── members ─── team
    │
    ├── teams
    │
    ├── shift_types
    │
    ├── rotation_patterns ─── rotation_steps
    │
    ├── schedules / shifts ─── shift_members
    │
    └── leave_records
```

Every Organization-scoped entity carries `organization_id` (NFR-3). The relational model is Architecture's call; `shift_members` is the natural home for the Shift Roster (FR-28) and Roster Overrides (FR-31).

Model gaps to resolve in Architecture, implied by the PRD but absent above: Hour Bands (FR-9), the Override layer as distinct from generated schedule data (FR-33, DI-2), Conflict as persisted state (FR-47, DI-4), and attribution records (DI-11).

---

## 4. Core Domain Relationships

```
Organization
    ├── Members
    ├── Teams ─── Members
    ├── Shift Types
    ├── Hour Bands
    ├── Rotation Patterns ─── Rotation Steps
    ├── Rotation Assignments (Team + Pattern + Offset + Anchor Date)
    ├── Schedule ─── Shift Rosters
    ├── Overrides (Shift Type / Roster)
    ├── Conflicts
    └── Leave Records
```

The distinctions that must not blur:

```
Team      = a group of people
Shift Type = a definition of a working period
Rotation  = a recurring pattern (the rule)
Schedule  = projected state plus overrides (the reality)
Leave     = a member availability exception
Conflict  = a recorded collision awaiting a human decision
```

---

## 5. Architecture-Bound Questions (detail)

**Q1. Persist generated shifts, or compute on read?**
The invariants point toward computing from Pattern + Offset + Anchor Date with only Overrides persisted: DI-1 wants projection to be a pure function, DI-2 wants Overrides as a separable layer, and FR-27 requires arbitrary future dates to work with no generation step. Against it: Shift Rosters, Conflict records, and Calendar performance (NFR-22) all want rows. A hybrid — compute the Projected Schedule, persist Overrides, Conflicts, and roster deviations — is the likely answer and should be reasoned about explicitly rather than defaulted into.

**Q2. Rotation anchoring and mid-cycle change.**
Each Rotation Assignment needs an Anchor Date (FR-23). FR-24 requires an effective date and explicit review of affected Overrides. Open: whether a rotation change creates a new Assignment version with a validity range, or mutates in place with history elsewhere. Versioned assignments make DI-1 hold for past dates trivially; in-place mutation does not.

**Q3. History immutability.**
Are past schedules and hours frozen once a period closes? Required if these figures are ever used for pay or formal records. Currently unspecified; PRD assumes unbounded mutable history with attribution (DI-11).

**Q4. Conflict recomputation triggers.**
FR-47 lists six events that must re-run detection. Whether that is a trigger, a job, or computed-on-read materially affects whether DI-4 can be guaranteed.

**Q5. Hour Band intersection.**
FR-40 requires Band Hours to be derived by intersecting each shift's nominal interval with the Organization's Hour Bands (DI-7). Points to settle: whether bands are stored as ordered start times with windows derived, or as explicit start/end pairs with a partition constraint (the former makes gaps and overlaps unrepresentable rather than merely validated); how a band-boundary change propagates to already-reported periods; and whether intersection runs on read or is materialized alongside the schedule. Note the intersection must operate on **nominal** wall-clock intervals so results stay DST-stable (DI-6).

---

## 6. Localization Implementation Detail

Requirements are NFR-6 … NFR-11. Implementation shape:

**Solution:** i18next / react-i18next, or equivalent with ICU message support.

**Resource layout**
```
locales/
├── hr/
│   └── translation.json
└── en/
    └── translation.json
```

**Key structure** — namespaced by surface:
```json
{
  "dashboard": {
    "todayShift": "Današnja smjena",
    "nextShift": "Sljedeća smjena",
    "monthlyHours": "Sati ovaj mjesec",
    "notWorkingToday": "Danas ne radiš"
  },
  "calendar": {
    "filters": {
      "allTeams": "Sve smjene",
      "allMembers": "Svi članovi",
      "reset": "Poništi filtere"
    }
  }
}
```

**Usage:** `t("dashboard.todayShift")` — never `<span>Današnja smjena</span>`.

**Scope of coverage:** navigation, buttons, form labels, validation messages, error messages, empty states, confirmation dialogs, calendar labels, shift labels, leave labels, dashboard content, admin settings, table headers.

**Language selection:** `hr` is default and the only complete locale in MVP. The architecture must support a future selector (`Hrvatski` / `English`) with no component changes. The `en` resource need not be complete for MVP.

**Formatting:** a single centralized locale-aware layer for dates, times, numbers, month and day names, and pluralization. Croatian's three plural forms (one / few / other) must be handled there. Future candidates: `en`, then possibly `de`, `it`.

**Naming caution:** the author's example maps `allTeams` to "Sve smjene" — *smjena* means shift, not team. Worth settling the Croatian term for Team versus Shift Type before the key set is written, since the pilot's crews are colloquially "smjene" while the product's Glossary separates Team from Shift Type. Flag for `bmad-ux`.

---

## 7. Coverage Map — Author PRD FR-01 … FR-50

Every requirement from the author-written PRD, mapped onto this PRD. No requirement was dropped.

| Author FR | Requirement | Covered by |
|---|---|---|
| FR-01 | Users must be able to authenticate | FR-1 |
| FR-02 | System identifies the user's organization | FR-1, NFR-1 |
| FR-03 | System identifies the user's role | FR-1, FR-5 |
| FR-04 | Admins edit organization information | FR-6 |
| FR-05 | Admins upload and manage a logo | FR-11 |
| FR-06 | Organization data isolated | DI-9, NFR-1, NFR-3 |
| FR-07 | Admins create members | FR-12 |
| FR-08 | Admins edit members | FR-12 |
| FR-09 | Admins activate/deactivate members | FR-12 |
| FR-10 | Admins assign members to teams | FR-18 |
| FR-11 | Members view relevant member information | FR-16 |
| FR-12 | Admins create teams | FR-17 |
| FR-13 | Admins rename teams | FR-17 |
| FR-14 | Configurable number of teams | FR-17, DI-8 |
| FR-15 | Members belong to an active team | FR-18 — *softened, see PRD §11.1 C-4* |
| FR-16 | Configurable shift types | FR-19 |
| FR-17 | Shift types support start and end times | FR-19 |
| FR-18 | Shifts crossing midnight | FR-20, DI-5 |
| FR-19 | Non-working / off states | FR-19 |
| FR-20 | Admins configure a rotation | FR-22 |
| FR-21 | A rotation supports multiple steps | FR-22 |
| FR-22 | Each step references a shift type | FR-22 |
| FR-23 | Configurable rotation start date | FR-23 (Anchor Date) |
| FR-24 | Calculate expected shift for any date | FR-27, DI-1 |
| FR-25 | Different teams, different offsets, same rotation | FR-23 |
| FR-26 | Generate schedules from the rotation | FR-27 |
| FR-27 | Manually override schedule assignments | FR-30, FR-31 |
| FR-28 | Overrides must not modify the rotation | DI-2, FR-30, FR-31 |
| FR-29 | Preserve generated vs. overridden distinction | FR-33, DI-11 |
| FR-30 | Monthly calendar | FR-34 |
| FR-31 | Filter by team | FR-35 |
| FR-32 | Filter by member | FR-35 |
| FR-33 | View all teams | FR-34, FR-35 |
| FR-34 | Filters resettable | FR-36 |
| FR-35 | Leave visible on the calendar | FR-37 |
| FR-36 | Conflicts visible on the calendar | FR-38 |
| FR-37 | Calculate hours from scheduled shifts | FR-40 |
| FR-38 | Calculate day hours | FR-40, FR-9 |
| FR-39 | Calculate night hours | FR-40, FR-9 |
| FR-40 | Calculate total hours | FR-40 |
| FR-41 | Admins view member hours | FR-42 |
| FR-42 | Members view own hours | FR-41 |
| FR-43 | Support annual leave | §5.11 |
| FR-44 | Each member has an annual leave allowance | FR-14 |
| FR-45 | Calculate used leave | FR-44, FR-45 |
| FR-46 | Calculate remaining leave | FR-45 |
| FR-47 | Admins create leave periods | FR-43 |
| FR-48 | Leave appears on the calendar | FR-37 |
| FR-49 | Detect leave/schedule conflicts | FR-47 |
| FR-50 | Do not silently overwrite conflicting schedules | DI-3, DI-4, FR-47 |

**Non-FR sections of the author PRD:** §2 principles → DI-8, DI-9, §1, NFR-13 · §6 settings → FR-6, FR-7 · §16 member dashboard → FR-52 · §17 admin dashboard → FR-53 · §22 member management → FR-15 · §24 security → NFR-1 … NFR-4 · §25 auditability → DI-11, NFR-20, NFR-21 · §26 UX direction → PRD §9 · §27 component strategy → §2 above · §28 responsive → NFR-12 … NFR-15 · §29–31 stack and model → §2–4 above · §33 user stories → §8 below · §34 pilot config → §1 above · §35 out of scope → PRD §6, §7.2 · §36–37 future → §9 below · §38 success criteria → PRD §10 · §39 open questions → PRD §11.2 · §40 architecture principle → DI-8 · localization annex → NFR-6 … NFR-11 and §6 above.

**Requirements added by this PRD that the author PRD did not state:** FR-2 (operator provisioning), FR-4 (password reset), FR-7 (Organization Type inertness as a testable requirement), FR-9 (Hour Bands as configuration — the day/night boundary in Organization settings), FR-10 (Leave Year), FR-20 (24-hour shift types valid), FR-21 (Shift Types carry no hour classification), FR-26 (Rest Gap Warning), FR-25 (Coverage Warning), FR-28 (Shift Roster as a named concept), FR-32 (remove an Override), FR-39 (shift types visually distinguishable), FR-46 (amend/delete leave), FR-49 … FR-51 (the three named Conflict Resolutions).

---

## 8. Epic Seed (author-supplied, for `bmad-create-epics-and-stories`)

The author PRD §33 proposed eight epics. They map cleanly onto this PRD's feature groups and are a sound starting decomposition. Recorded verbatim in shape, with the corresponding FR ranges:

| Epic | Author's stories | FRs |
|---|---|---|
| 1 — Authentication & Organizations | log in; see only own organization's data; manage organization settings | FR-1 … FR-11 |
| 2 — Members & Teams | create members; assign to teams; deactivate; see my team | FR-12 … FR-18 |
| 3 — Shift Types & Rotation | define shift types; configure recurring rotation; configure start date; offset teams | FR-19 … FR-26 |
| 4 — Schedule Generation | generate automatically; correct individual assignments; keep corrections separate from the rotation | FR-27 … FR-33 |
| 5 — Calendar | see my schedule; see all teams; filter by team; filter by member | FR-34 … FR-39 |
| 6 — Hours | see my monthly hours; see hours for all members; day and night shown separately | FR-40 … FR-42 |
| 7 — Annual Leave | record annual leave; see remaining leave; detect conflicts with scheduled work | FR-43 … FR-51 |
| 8 — Organization Administration | manage branding; manage settings | FR-6, FR-11 |

Note: Epic 8 overlaps Epic 1 in this PRD's grouping (both land in §5.2), and the dashboards (FR-52, FR-53) have no epic yet. Sequencing note for planning: Epic 3 → Epic 4 is the critical path, and the domain-logic test suite (NFR-17, NFR-18) should land with Epic 3 rather than after Epic 4.

---

## 9. Future Opportunities (explicitly not MVP)

**Scheduling** — shift swaps and member-initiated trades within Admin-defined rules · member availability declarations · recurring exceptions · temporary team changes and loans · overtime · custom working rules · minimum-coverage and staffing-level rules · qualification, certification, and competency constraints · statutory rest-period and maximum-hours enforcement at generation time.

**Hours** — breaks within shifts · overtime and premium calculation · actual attendance distinct from scheduled · period locking.

**Leave** — member-submitted requests and approval workflow — *the most likely early follow-up* · sick, personal, training, parental, unpaid leave · differing leave policies per member group · carry-over between Leave Years · part-day leave · public-holiday calendars · accrual over time.

**Notifications** — upcoming shift reminders · schedule change alerts · leave decisions · conflict alerts. Channels: push, email, SMS.

**Reporting** — Excel and PDF export · advanced hour reports · team statistics · attendance reports · payroll export · government reporting.

**Platform** — native mobile applications or PWA · English, then possibly German and Italian · public API and integrations · audit-log interface · multiple Organizations per user · multi-site and sub-organization hierarchies.

**Industry modules** — layered on a validated generic core, never inside it:
- *Fire departments* — interventions, training, readiness, vehicles, equipment
- *Healthcare* — departments, nursing teams, on-call schedules
- *Security* — sites, guards, patrol schedules
- *Manufacturing* — production lines, line-specific rotations, overtime

**SaaS direction** — eventual self-service onboarding:
```
Create account → Create organization → Choose organization type
→ Configure teams → Configure shift types → Configure rotation
→ Invite members → Start scheduling
```
Organization Type would drive onboarding templates and, later, industry modules — **never the core scheduling engine** (FR-7, DI-8).

---

## 10. Recommended Path From Here

1. **`bmad-prd`** *(current)* — drafted; C-1 and §11.2 Q1 outstanding.
2. **`bmad-spec`** — recommended before architecture. The rotation, hours, leave-counting, and conflict engine is where this product's correctness lives; locking it as a machine-checkable contract makes NFR-17 and NFR-18 straightforward rather than aspirational.
3. **`bmad-ux`** — the Calendar (FR-34 … FR-39) and Conflict resolution (FR-48 … FR-51) are the two hardest surfaces, and §9's shift-type legibility problem is a genuine design problem. Also settle the Croatian Team/Shift Type naming flagged in §6.
4. **`bmad-architecture`** — pressure-test the stack, resolve §5 Q1–Q5, design the RLS model and the domain-logic boundary.
5. **`bmad-create-epics-and-stories`** — §8 above is the seed.
6. **`bmad-sprint-planning`** → **`bmad-build`**.
