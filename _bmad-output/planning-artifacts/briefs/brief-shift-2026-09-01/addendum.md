---
title: "Addendum — Shift Management Platform"
status: draft
created: 2026-09-01
updated: 2026-09-01
---

# Addendum — Shift Management Platform

Depth captured during discovery that belongs downstream (PRD, UX, architecture) rather than in the brief.

---

## 1. Pilot Configuration (seed data, not product behavior)

**Organization:** Croatian volunteer fire department (DVD). Tenant #1.

**Teams:** four — A, B, C, D. Names and count are data; nothing may hard-code `A/B/C/D` or the number 4.

**Shift types:**

| Type | Window | Duration |
|---|---|---|
| DAY | 07:00 – 19:00 | 12h |
| NIGHT | 19:00 – 07:00 (+1 day) | 12h |
| OFF | — | 0h |

**Pattern:** `[DAY, NIGHT, OFF, OFF]`, cycle length 4, one team per offset.

| Team | Offset | Projected cycle |
|---|---|---|
| A | 0 | DAY → NIGHT → OFF → OFF |
| B | 1 | NIGHT → OFF → OFF → DAY |
| C | 2 | OFF → OFF → DAY → NIGHT |
| D | 3 | OFF → DAY → NIGHT → OFF |

**Verified property of this configuration:** with 4 teams at offsets 0–3 over a 4-slot pattern containing exactly one DAY and one NIGHT, every calendar day has exactly one DAY team and exactly one NIGHT team, and two teams off. Coverage is complete and non-overlapping.

**Important:** this property is a coincidence of *this* configuration, not a guarantee of the engine. An arbitrary pattern, team count, or offset assignment can produce days with no coverage or double coverage. See open question **Q9**.

**Locale:** Croatian (`hr`). Europe/Zagreb — observes DST.

---

## 2. Open Product & Architecture Questions

Each entry: the fork, why it is material, and what it blocks.

### Q1 — Day/night hour semantics *(blocks: hours engine, schema)*
The dump states `DAY = 12h, NIGHT = 12h`, implying hours are classified by **shift type label**. But "day/night hour breakdown" conventionally means classification by **time of day** against a statutory night window (commonly 22:00–06:00). Under a 22:00–06:00 window, a `19:00–07:00` NIGHT shift is 8 night hours + 4 day hours, not 12 night hours.

These produce different numbers for the same shift. Which is correct determines whether hours are a property of the shift type (trivial) or computed by interval intersection against org-configured bands (materially more complex, and the only version that generalizes to premium pay and other jurisdictions).

### Q2 — Leave accounting unit *(blocks: leave domain model)*
Is a "day" of the 30-day allowance a **calendar day** or a **scheduled shift**? In a `DAY/NIGHT/OFF/OFF` rotation a member is scheduled roughly half of all calendar days, so the two interpretations differ by ~2×. Related: if a member takes leave spanning an OFF day, does that OFF day draw down the balance? Both answers must be explicit; neither is inferable.

### Q3 — Hours during approved leave *(blocks: hours engine)*
Invariant: leave does not remove the scheduled shift. Worked hours are derived from the schedule. Naively, a member on holiday therefore accrues 12 worked hours. Options: hours are suppressed for leave-covered shifts; hours are tracked separately as leave hours; or worked hours are only ever attributed to shifts an Admin has affirmed. This interacts directly with Q1 and Q2.

### Q4 — Conflict resolution actions *(blocks: MVP scope, UX)*
"Admin must explicitly resolve" is stated; the resolution set is not. Candidates: accept the leave and mark the shift uncovered; reassign the shift to another member; swap two members; reject or amend the leave; substitute a different shift type. Each option added is real MVP scope — particularly reassignment, which requires individual-level assignment (see Q6).

### Q5 — Leave request flow *(blocks: MVP scope, roles)*
The Member capability list contains no "request leave"; the Admin list contains "manage leave". Read literally, MVP leave is Admin-entered only, with no request/approval workflow. That is a coherent smaller MVP, but it is likely not what the pilot expects. Needs an explicit call.

### Q6 — Assignment model *(blocks: core domain model)*
Is a generated shift assigned to a **team** — with members deriving their schedule through team membership — or materialized per **member**? Team-level is truer to the rotation and cheaper; member-level is required for individual overrides, reassignment, and per-member conflict state. Likely answer is team-level projection plus member-level exceptions, but it must be decided, not assumed. Sub-questions: can a member belong to multiple teams? Can a member be scheduled outside their team's pattern?

### Q7 — Access and tenancy *(blocks: MVP scope)*
Two unspecified flows: how an **organization** is provisioned (self-serve signup vs. operator-provisioned), and how a **member** gets an account (Admin-created credentials, email invitation, or self-signup against an org code). Volunteer organizations often lack per-person work email, which makes email-invite-only a real risk. No billing was mentioned; assumed out of MVP.

### Q8 — Timezone and DST *(blocks: hours engine)*
Europe/Zagreb observes DST. On transition nights a `19:00 → 07:00` shift is 11 or 13 wall-clock hours, directly contradicting the "NIGHT is always 12 hours" invariant. Decide which is authoritative — nominal scheduled duration or elapsed real time — and whether shift boundaries are stored as local wall-clock times or absolute instants. Two nights a year, but it dictates the storage model.

### Q9 — Coverage validation *(blocks: rotation configuration UX)*
Because the engine accepts arbitrary patterns and offsets, a valid configuration can leave days uncovered. Does MVP validate or warn about coverage gaps when a rotation is configured, or does it accept whatever the Admin defines? Minimum-staffing rules are out of MVP; a configuration-time sanity check may not be.

### Q10 — Schedule generation strategy *(architecture, flagged not asked)*
Materialize generated shifts as rows over a rolling horizon, or compute from `pattern + offset + anchor date` on read with only exceptions persisted? The stated invariants (rotation separate from schedule, overrides as a distinct layer) point strongly toward compute-on-read plus a persisted override layer. Also needs: rotation **anchor date** per team, and the rule for what happens to already-generated future schedule when a pattern is edited mid-cycle. Deferred to Architecture.

### Q11 — Schedule history immutability *(architecture, flagged not asked)*
Are past schedules and hours frozen once a period closes? Required if hours are ever used for pay or recognition. Deferred.

---

## 3. Role Capability Matrix (MVP)

| Capability | Admin | Member |
|---|---|---|
| Manage organization settings | ✓ | — |
| Manage branding / logo | ✓ | — |
| Manage members | ✓ | — |
| Manage teams | ✓ | — |
| Configure shift types | ✓ | — |
| Configure rotation patterns | ✓ | — |
| Generate / override schedules | ✓ | — |
| Manage leave | ✓ | — |
| Resolve conflicts | ✓ | — |
| View all hours | ✓ | — |
| View own dashboard | ✓ | ✓ |
| View own schedule | ✓ | ✓ |
| View calendar (with filters) | ✓ | ✓ |
| View own hours | ✓ | ✓ |
| View own leave balance | ✓ | ✓ |
| View relevant org/member info | ✓ | ✓ |
| Request leave | ? | ? |

Last row unresolved — see **Q5**.

---

## 4. Internationalization Requirements

- UI ships in Croatian (`hr`) only; architecture must be multilingual from day one.
- **No user-facing string hard-coded in a React component.** Translation keys throughout: `t("dashboard.todayShift")`, never `"Today's shift"`.
- Established solution: i18next / react-i18next.
- Locale-aware date, time, number, and pluralization formatting. Croatian has a three-form plural rule (one / few / other) — plural handling cannot be an afterthought or an English-shaped `count === 1` check.
- Adding English later must require no changes to components or business logic.
- Domain-layer output must be locale-neutral: the engine returns keys, codes, and values, never formatted display strings.

---

## 5. Technical Direction (strong preferences, to be pressure-tested in Architecture)

**Frontend:** React, TypeScript, Vite, TanStack Router, TanStack Query, TanStack Table, shadcn/ui, Tailwind CSS.

**Backend / infrastructure:** Supabase — PostgreSQL, Supabase Auth, Supabase Storage (branding assets).

**Non-negotiable structural constraint:** rotation calculation, schedule generation, hour calculation, and conflict detection are pure, framework-free, unit-testable domain logic with no React dependency. The pilot configuration serves as a test fixture.

**To reconsider during Architecture:**
- Where domain logic executes — client-side TypeScript, Postgres functions, or Supabase Edge Functions — and whether it must be duplicated. A single canonical implementation is strongly preferable.
- Multi-tenant isolation via RLS: policy design, and how a same-tenant Admin/Member split is enforced without policy sprawl.
- Whether compute-on-read schedule projection (Q10) is viable within Supabase's query model, or forces materialization.
- Calendar-scale query performance: month views across all teams and members.
- Whether `hr`-only MVP still warrants full ICU message formatting.

---

## 6. Future Opportunities (explicitly not MVP)

Shift swaps and member-initiated trades within Admin-defined rules · additional absence types (sick, training, parental, unpaid) · minimum-coverage and staffing-level rules · qualification, certification, and competency constraints on assignment · notifications and shift reminders (push, email, SMS) · payroll and timesheet export · overtime and premium-pay calculation · statutory rest-period and maximum-hours compliance checking at generation time · reporting and analytics · multi-site and sub-organization hierarchies · native mobile apps or PWA · English and further languages · billing and subscriptions · public API and integrations · audit log surfaced to Admins.

---

## 7. Recommended BMad Path From Here

1. **`bmad-product-brief`** *(current)* — brief drafted; awaiting answers to Q1–Q9.
2. **`bmad-prd`** — required. Resolve Q1–Q9 into requirements. Fresh context.
3. **`bmad-ux`** — recommended, not skippable in practice: the calendar and the conflict-resolution flow are the product's two hardest surfaces.
4. **`bmad-architecture`** — required. Pressure-test the stack, settle Q10/Q11, design the domain-logic boundary and RLS model.
5. **`bmad-create-epics-and-stories`** → **`bmad-sprint-planning`** → **`bmad-build`**.

Optional and genuinely useful here: **`bmad-spec`** after the PRD, to lock the rotation/hours/conflict engine as a machine-checkable contract before architecture — this product's correctness lives almost entirely in that engine.
