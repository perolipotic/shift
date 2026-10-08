---
title: "A member's own schedule shows their leave and no conflict marks (7.10)"
type: 'chore'
created: '2026-10-08'
status: 'done'
route: 'one-shot'
baseline_commit: 'd6499f3d90e40ddf66478bec3e55897e03c89733'
---

# A member's own schedule shows their leave and no conflict marks (7.10)

## Intent

**Problem:** CAP-13, UX-DR8, DESIGN.md and EXPERIENCE.md §State Patterns said that an unresolved conflict is visible on the calendar to anyone. Decision 14 and PRD FR-38 (edited 2026-10-02) limit that to an admin: a member sees only their own leave. The code has done this since 5.3c (`calendar/services/marks.ts`: a member's marks carry no collision, no uncovered key and only their own leave). An e2e test already proves both ACs (`calendar-conflicts.spec.ts` L235 for the member; 5.3c's grid tests for the admin).

**Approach:** No code change. The binding docs get the role qualifier in the same change, per the story's third AC. EXPERIENCE.md §State Patterns *Conflict* states the member rule and limits it to the calendar, because *Sati* still counts a member's own shifts in conflict (5.3d). The DESIGN.md modifiers row, CAP-13 and UX-DR8 are qualified the same way. The epic 7 context was recompiled after 7.9. The review restored two AD-16 guarantees that the recompile had dropped.

## Epic AC Deviations

None. Both behavioural ACs were already met by 5.3c. This story ships the doc AC.

## Suggested Review Order

**The rule, as the docs now state it**

- Entry point: member sees no `⚠`/`◌` on the calendar; *Sati* keeps its count.
  [`EXPERIENCE.md:124`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L124)

- Modifiers row: conflict and uncovered are drawn for an admin only.
  [`DESIGN.md:305`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L305)

- CAP-13 and UX-DR8 carry the same qualifier.
  [`epics.md:42`](../planning-artifacts/epics.md#L42)
  [`epics.md:118`](../planning-artifacts/epics.md#L118)

**Why no code changes (already shipped in 5.3c)**

- A member's own cell: conflict only from their collisions, which are empty for a member.
  [`month.ts:577`](../../apps/web/src/features/calendar/utils/month.ts#L577)

- Unit test: a member's marks never carry a collision.
  [`marks.test.ts:373`](../../apps/web/src/features/calendar/services/marks.test.ts#L373)

- E2E test: a member's own leave is marked, with no `⚠` in either mode or in day detail.
  [`calendar-conflicts.spec.ts:235`](../../e2e/tests/calendar/calendar-conflicts.spec.ts#L235)

**Peripherals**

- Epic 7 context recompiled; the AD-16 guarantees are restored.
  [`epic-7-context.md:49`](epic-7-context.md#L49)

- FR-37 role qualifier deferred.
  [`deferred-work.md`](deferred-work.md)
