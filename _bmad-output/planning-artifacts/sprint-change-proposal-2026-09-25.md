# Sprint Change Proposal — Fire rank and team position (retroactive)

- **Date:** 2026-09-25
- **Author:** Developer (correct-course workflow), for Perolipotic
- **Mode:** Batch
- **Status:** Approved 2026-09-25 (option A, batch) — applied on `docs/correct-course-rank-position`

## 1. Issue Summary

**What happened.** During Epic 2, between stories 2.2b and 2.3, two features were built and merged without any planning artifact:

- **#43, `spec-member-rank.md`.** It adds an organization setting, `uses_fire_ranks` (default off), and a nullable member fire rank. The rank is one of 11 fixed codes, `trainee` … `senior_officer_1`, and is current-state. When the setting is on, the rank appears on the member forms and on the team roster.
- **#45, `spec-team-position.md`.** It adds a team position, one of `commander`, `driver` or `firefighter`, on `team_membership_versions`, versioned with the team. A position is required only while the setting is on. A position change is a membership version from a date, and it can be scheduled and withdrawn like a move. The roster shows the position.

**How it was discovered.** The need came from the pilot demo-seed discussion. The pilot wants four teams, each with a commander, a driver and two firefighters, named by rank. The human decided the scope on 2026-09-25: both features, fixed lists, with UI, and position required only while the setting is on. The human also agreed that course correction should have come first.

**Category.** A new requirement from the stakeholder (the pilot).

**Evidence.**
- The PRD, epics.md, the architecture spine and sprint-status contain no rank or position.
- `test/supabase-scaffold.test.ts:195-234` enforces DI-8 on migrations, and the code satisfies it.
- The PRD §6 non-goal is still not addressed. See §2.3.

## 2. Impact Analysis

### 2.1 Epic Impact

- **Epic 1 (done):** it owns members, teams and the roster, so this is where the capability belongs. It gains a new Story 1.9, delivered. The epic stays done.
- **Epic 2 (in progress):** its goal and stories do not change. `epic-2-context.md` goes stale as soon as planning artifacts change; `bmad-build` regenerates it automatically before 2.3.
- **Epic 3:**
  - Story 3.6, replacing a member on a shift: rank and position may be shown to help choose a replacement, as information only.
  - The calendar and day detail may show position beside names.
  - No acceptance criterion changes.
- **Epic 4 (hours):** no impact. Rank and position never enter hours.
- **Epic 5 (conflicts):** in FR-50, Replace Member, rank and position may be shown beside candidates, as information only. Detection and the three resolutions do not change.
- **Epic 6 (dashboards):** no impact.
- **No epic becomes obsolete, no new epic is needed, and the order does not change.**

### 2.2 Story Impact

- **Current:** none. 2.3 is next and does not touch members.
- **Future:** 3.6 and 5.4 get an informational note. Nothing in them may block, warn or suggest based on rank or position (see §2.3).

### 2.3 Artifact Conflicts

**PRD — a real conflict with a non-goal.**

§6 says: "This does not become a fire-department product by accretion. Any requirement that cannot be expressed as Organization data is a requirement to reject or generalize (DI-8)."

The rank and position lists are fixed codes in the core schema, not Organization data.

What still holds:
- **DI-8** as written. It governs *domain logic*, and `packages/domain` holds no rank or position. The migrations contain no fire-specific text either.
- **FR-7's spirit** is kept: nothing reads rank or position in scheduling, hours, leave or conflict logic.

What does not hold: the §6 non-goal. This must be decided explicitly, not left implicit:

- **Option A (recommended): a recorded, bounded exception.**
  - Rank and position are *descriptive* data. They sit behind an organization setting and are inert, under the same rule FR-7 applies to Organization Type: no scheduling, hours, leave or conflict behaviour reads them.
  - They are never enforced as staffing or qualification rules. The MVP already excludes those (§7.2: "Minimum-staffing rules; qualification constraints").
  - Revisit when a second organization needs ranks or positions. At that point the lists become Organization data, the codes migrate into seeded per-organization rows, and the setting is replaced.
- **Option B: generalize now.** Per-organization rank and position lists as Organization data. This reworks #43 and #45: new tables, an editor UI, and migrating codes to rows. Effort is medium to high, with no pilot benefit today.

**PRD — additions needed:**
- Glossary: Fire Rank, Team Position, and the Fire Ranks and Positions setting.
- A new FR in §5.3 or §5.4, with inertness consequences.
- FR-16 needs amending: the directory and roster now show rank and position.

**Epics — capability texts:**
- CAP-5 says "Names and team membership only". It must also admit rank and position. They are neither private nor administrative, and CAP-5's exclusion list (allowance, balance, leave, hours, contact) stays as it is.
- CAP-4 and CAP-6 get a clause each.

**Architecture:**
- AD-2's table says "A new rule kind is unclassified until it appears in this table". Rank and position are unclassified, which violates AD-2 today.
- The Core entities attributes and the Deferred list need the new facts.

**UX (EXPERIENCE.md):**
- Terminology: `Vatrogasni čin`, `Položaj`, and the setting label `Vatrogasni činovi i položaji`.
- The roster line format.
- Nothing may colour-code rank or position.

**Other artifacts:**
- `DEPLOY.md`: the migration and function must deploy before the SPA. This is already in deferred-work, so no new item.
- sprint-status: add keys.
- E2E: already added in #43 and #45.
- CI: none.

### 2.4 Technical Impact

None. The code is merged, reviewed, and covered by unit, RLS and E2E tests. This proposal only changes documents.

## 3. Recommended Approach

**Direct Adjustment** (checklist option 1), which is a documentation backfill, together with **Option A** from §2.3.

- **Rollback (option 2): not viable.** It would discard reviewed, tested work the pilot wants, and gain nothing.
- **MVP review (option 3): not needed.** The MVP goals are unchanged. The bounded exception keeps the product's stance intact.
- **Effort:** low, documents only.
- **Risk:** low.
- **Timeline:** none. 2.3 proceeds after the demo seed, as planned.

## 4. Detailed Change Proposals

### 4.1 PRD (`prds/prd-shift-2026-09-01/prd.md`)

**§3 Glossary, after "Team".**

NEW:
- **Fire Rank** — an optional, descriptive rank on a Member, from a fixed list, current-state. It exists only for an Organization whose Fire Ranks and Positions setting is on. It never affects scheduling, hours, leave or conflict logic.
- **Team Position** — a Member's descriptive position within their Team (commander, driver or firefighter). It is versioned with the Team membership, so it changes from a date forward. It is required while the setting is on and absent without a Team. Like Fire Rank, it is inert.
- **Fire Ranks and Positions** — an Organization setting, off by default. It gates the display and entry of Fire Rank and Team Position and never deletes them.

**§3 Glossary, "Member".**

- OLD: "Has a name, optional email, active/inactive status, a Role, at most one Team, and a Leave Allowance."
- NEW: "Has a name, optional email, active/inactive status, a Role, at most one Team, a Leave Allowance, and, where the Organization uses them, a Fire Rank and a Team Position."

**§5.4, a new FR after FR-18.**

NEW:

> #### FR-18a: Fire Ranks and Team Positions (added 2026-09-25, sprint change)
> An Admin of an Organization that switches on Fire Ranks and Positions can record each Member's Fire Rank and their Team Position.
>
> **Consequences (testable):**
> - With the setting off, no rank or position control or text appears anywhere, and stored values survive.
> - A position change takes effect from a chosen date and rewrites no history (the same rule as FR-18).
> - Rank and position are inert. Two Organizations identical except for ranks and positions produce byte-identical schedules, hours and conflicts (the FR-7 rule).
> - No rule enforces a staffing mix or a qualification from them (§7.2).
>
> **Bounded exception to §6.** The rank and position lists are fixed, not Organization data. This was accepted for the pilot on 2026-09-25. Revisit when a second Organization needs ranks or positions: the lists then become Organization data.

**§5.3, FR-16, first consequence.**

- OLD: "The directory shows name and Team; it does not expose …"
- NEW: "The directory shows name and Team, and, where the Organization uses them, Fire Rank and Team Position; it does not expose …"

**§6, the fire-department non-goal. Append:**

> "The one recorded exception is FR-18a, whose fixed lists are descriptive, inert and gated by a setting."

### 4.2 Epics (`epics.md`)

**CAP-4.** Append: "Where the organization uses fire ranks, a member carries an optional rank (current-state)."

**CAP-5.**
- OLD: "Names and team membership only; no allowance …"
- NEW: "Names and team membership, and, where the organization uses them, rank and team position; no allowance …"

**CAP-6.** Append: "Where the organization uses them, a membership carries a team position, versioned with it."

**Epic 1, a new story after 1.8.**

> ### Story 1.9: An organization that uses fire ranks records each member's rank and team position (delivered 2026-09-25, sprint change)
>
> As an admin of an organization that uses fire ranks, I want to record each member's rank and their position in the team, so that everyone can see who commands and who drives.
>
> **Acceptance Criteria (as delivered in #43 and #45):**
> - **Given** the setting off, **when** any screen renders, **then** no rank or position appears, and stored values survive.
> - **Given** the setting on, **when** an admin creates or edits a member, **then** a rank from the fixed list can be chosen, and an untouched stored rank is written back unchanged.
> - **Given** a member on a team with the setting on, **when** their position changes from a date, **then** it is a new membership version, can be withdrawn while scheduled, and rewrites no history (AD-2).
> - **Given** a team roster, **when** it is read by any role, **then** each member shows `Ime · čin · položaj` where present (CAP-5).
> - **Given** any schedule, hours or conflict derivation, **when** ranks or positions change, **then** the output is byte-identical (FR-18a).

**Epic 3, Story 3.6, a note.**

> "Where the organization uses fire ranks, candidates may be shown with rank and position, as information only. Nothing blocks, warns or suggests from them (FR-18a, §7.2)."

**Epic 5, Story 5.4, the same note** for the replace-the-member outcome.

### 4.3 Architecture (`architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md`)

**AD-2 table. Add two rows:**

| Rule | Classification | Because |
| --- | --- | --- |
| Team position | **Versioned** (on the team-membership version) | a promotion takes effect from a date; the roster for a past date shows the position then held |
| Member fire rank | **Current-state** | descriptive only, like shift type name; nothing derived reads it |

**Deferred. Add:**

> "**Organization-data rank and position lists.** Fire rank and team position are fixed code lists behind the `uses_fire_ranks` setting (PRD FR-18a, a bounded exception to DI-8's spirit). **Revisit when** a second organization needs ranks or positions: the lists become organization rows, and the codes migrate to seeded rows."

**Capability map.** Add rank and position to the CAP-4, CAP-5 and CAP-6 rows: `members.fire_rank`, `team_membership_versions.position`, `team_roster`.

### 4.4 UX (`ux-designs/ux-shift-2026-09-02/EXPERIENCE.md`), terminology section

NEW bullet:

> "**Rank and position.**
> - The member's rank is `Vatrogasni čin`, and the team role is `Položaj`, never *pozicija*.
> - The setting is `Vatrogasni činovi i položaji`.
> - On the roster: `Ime · čin · položaj`, with labels in lowercase beside the name.
> - Neither is ever colour-coded, and neither is a filter in MVP."

### 4.5 Sprint status (`implementation-artifacts/sprint-status.yaml`)

Under Epic 1, after `1-8-…`:

```yaml
  # Added 2026-09-25 by sprint change (sprint-change-proposal-2026-09-25.md):
  # built mid-Epic-2 without planning, backfilled here. Parts: A member rank
  # (#43, spec-member-rank.md), B team position (#45, spec-team-position.md).
  1-9-an-organization-that-uses-fire-ranks-records-rank-and-position: done
  1-9a-member-rank: done
  1-9b-team-position: done
```

`epic-1` stays `done`.

## 5. Implementation Handoff

- **Scope:** Minor. It is a documentation backfill, carried out directly by the Developer agent in this workflow, on the branch `docs/correct-course-rank-position`.
- **Deliverables:** the edits in §4, applied verbatim, plus this proposal, committed and merged as one PR.
- **Success criteria:**
  - Every artifact in §4 carries the change.
  - A grep of the planning artifacts finds rank and position in the PRD, the epics, AD-2 and EXPERIENCE.md.
  - sprint-status has the 1.9 keys as done.
  - Nothing else changes.
- **Next, unchanged by this proposal:**
  1. the 4×4 pilot demo seed (deferred-work);
  2. then `/bmad-build 2.3`, which regenerates `epic-2-context.md`, because the planning artifacts are now newer.
