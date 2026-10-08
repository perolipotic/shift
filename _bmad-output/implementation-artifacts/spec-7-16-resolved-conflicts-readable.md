---
title: 'Resolved conflicts stay readable (7.16)'
type: 'feature'
created: '2026-10-08'
status: 'in-review'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A decided conflict leaves the queue and nothing says what was decided, by whom or when.

**Approach:** *Raspored* gets two tabs. *Neriješeni* stays the default with its count at zero too; *Riješeni* lists the live, effective `conflict_resolutions` with date, team, shift type, member, decision, acting admin and timestamp (FR-48a, Q11).

## Boundaries & Constraints

**Always:** Read `conflict_resolutions` only (PRD §7.2 carve-out); a conflict is in exactly one tab (same effective-resolution funnel as the queue); app text Croatian.

**Ask First:** Any new migration or RLS policy.

**Never:** Show other change history; link, bulk-act or edit an entry; list removed resolutions.

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/conflicts/services/resolved-conflicts.ts` -- view model, tab state, acting-admin names read
- `apps/web/src/features/conflicts/services/resolutions.ts` -- organization read now also selects `created_by,created_at`
- `apps/web/src/features/conflicts/components/{conflicts-tabs,resolved-list,conflicts-body}.tsx` -- tablist, list, composition
- `apps/web/src/features/conflicts/hooks/use-conflicts-queue.ts`, `pages/raspored.tsx` -- tab state and wiring

## Tasks & Acceptance

**Execution:**
- [x] view model + unit tests; tabs and list UI; hr.json keys; sign-in suite and key-hygiene ledgers
- [x] EXPERIENCE.md (IA, inventory, Resolved conflicts), DESIGN.md (Conflict tabs), UX-DR25 and UX-DR33 in epics.md

**Acceptance Criteria:**
- Given Raspored opens, then *Neriješeni* is selected and shows its count, zero included.
- Given *Riješeni*, then each entry shows date, team, shift type, member, decision, acting admin and timestamp, from `conflict_resolutions` only.

## Design Notes

The shift type is not stored (AD-4), so it is named from the team's schedule for that date as it stands today (`scheduledShiftTypeOn`, the same read as `replacement-effect.ts`), not from the collision: a collision also goes when the member is no longer on the roster that day (a take-off override, a team move, deactivation) while the shift stands. Because it is today's schedule, after a rotation change an old entry shows the current type. Only an entry whose team has no working shift that day says "Taj dan više nije radni po rasporedu". An actor with no member row reads "administrator kojeg više nema u organizaciji".

## Verification

**Commands:**
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter ./apps/web test` -- expected: pass
