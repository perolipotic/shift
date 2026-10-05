---
title: 'A replacement that no longer applies stops hiding its conflict (5.5d)'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: '0184cabab39efc3ba0d65398519c294a5b115708'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A `replace_member` resolution stays live after its linked roster override stops applying. That happens when the override is removed in the calendar, when a rotation save leaves it pending, or when it is inert (for example, the replacement is inactive). The shift is then really uncovered, but the conflict stays hidden. The live resolution also holds the unique key, so the admin could not re-decide even if the conflict reappeared.

**Approach:**
- A `replace_member` resolution counts only while its linked override is in force and applied. Otherwise its conflict shows again everywhere.
- Migration 0033 makes removing the linked override also soft-remove the resolution, which frees the key.
- 0033 also backfills rows already orphaned.
- 0033 gives the member read the link, so a member's own Sati agrees with the admin's.

## Boundaries & Constraints

**Always:**
- **Effectiveness (human, 2026-10-05).** A `replace_member` resolution is effective only while its `roster_override_id` is in the snapshot's live roster overrides, in force (`rosterStandingOfCalendar`), and in `rosterOn(...).applied` for that date and team on a working shift. That is the same test as `replacementWarningsOf` in `leave-section.ts`; extract it into one shared helper. `accept_uncovered` is unaffected.
- **One funnel.** Apply the filter wherever resolutions are turned into keys:
  - `resolutionsOf` in `conflicts-queue.ts` (the queue, the resolution screen, the calendar marks, the admin's Sati);
  - the member path in `hours-conflicts.ts`;
  - the erasure "before" in `conflicts/services/erasures.ts`. Filter once against "before" and use that list on both sides, so reviving an inert replacement is never counted as an erasure.
- **Migration 0033 (human-approved).**
  - (i) `create or replace` `remove_roster_override`, so that in the same transaction it also soft-removes the live `conflict_resolutions` row whose `roster_override_id` is the removed override. `removed_by` is the caller.
  - (ii) A backfill: soft-remove every live resolution whose linked override already has `removed_at` set, copying the override's `removed_by` / `removed_at`.
  - (iii) Drop and recreate `my_conflict_resolutions()` so it also returns `roster_override_id`. Keep the grants as they are.
  - Forward-only. No roster computation in the database.
- **Re-deciding.** On the resolution screen, a conflict that resurfaced because its replacement does not apply shows the line "Zamjena se ne primjenjuje. Ukloni je u kalendaru pa odluči ponovno." until the linked override is removed. That removal frees the key through 0033. A 23505 on accept or replace for such a key maps to that same line.
- **Accepted as-is (human, 2026-10-05), documented in the epic context and the UX docs:**
  - A decision is about the member's absence from that team's shift that day, so it survives a shift-type change.
  - An orphan left by a team move hides nothing.
  - Dormant-key revival is ledgered.
- Every string goes through `t()`.

**Ask First:**
- Any further migration, or a shift-type fingerprint on resolutions.

**Never:**
- No change to how `accept_uncovered` resolutions live.
- No change to the 5.5a–h erasure guards beyond filtering their "before" input.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Removed override | Mirela's +4 replaced by Dino; admin removes Dino's override in the calendar | resolution soft-removed (0033); conflict back in the queue; accept now saves | N/A |
| Pending after rotation save | replace on +4, then a rotation save stamps newer | conflict back with the hint; removing the pending override frees the key | 23505 → hint |
| Inert replacement | replacement deactivated before +4 | conflict back with the hint | N/A |
| Effective | replacement applied | conflict hidden, as today | N/A |
| Accept unaffected | `accept_uncovered` on +4 | hidden, as today | N/A |
| Hours | ineffective replace | the absent member's shift returns to band hours and conflict count +1, on the admin and member sides alike | N/A |
| Backfill | live replace whose override was removed before 0033 | soft-removed by 0033 | DB |
| Erasure before | inert replace, then a change makes it apply again | not listed as an erasure | N/A |

## Epic AC Deviations

- **INTERPRETED:** "no conflict expires, auto-clears or is suppressed" (CAP-16, DI-4). A replacement that does not apply no longer suppresses its conflict. It reappears, which strengthens this AC. Removing the linked override ends the decision, attributed to the admin who removed it (human, 2026-10-05).
- **DEFERRED:** dormant-key revival. A decision whose key stops colliding and later collides again re-applies silently; ledgered in `deferred-work.md` (human, 2026-10-05).
- **INTERPRETED:** Story 5.5 "told when a change would make a queued conflict disappear". A change that makes an inert or pending replacement apply again hides its conflict without a dialog, because the replacement decision already covers it (human, 2026-10-05).
- **NARROWED:** Story 5.4 "exactly three outcomes are offered". While a replacement that does not apply still holds the key, the screen disables Spremi and directs the admin to remove it in the calendar first (human, 2026-10-05).

</frozen-after-approval>

## Code Map

- **Database.**
  - `supabase/migrations/0027_remove_roster_override.sql` (the function to replace) and `0031_conflict_resolutions.sql` (columns, the live key, `my_conflict_resolutions()` :~255-296, grants).
  - `0032_replace_conflict_member.sql` (`roster_override_id`, the check, the header note about 5.5).
  - New `0033_…sql`. Check the main checkout for untracked migrations first.
- **Client parse.** `apps/web/src/features/conflicts/services/resolutions.ts`:
  - `CONFLICT_RESOLUTIONS_COLUMNS` :48 already selects the link;
  - `conflictResolutionsOf` :~268 drops it today;
  - `ConflictResolution` gains `rosterOverrideId`. It is null-tolerant on the member read until 0033 is applied.
  - `replacementLinksOf` :355.
- **The effectiveness test to extract.** `apps/web/src/features/leave/services/leave-section.ts:474-505`. Standing comes from `calendar/utils/month.ts:136`; `rosterOn` from `packages/domain/src/roster.ts:294`.
- **Funnels.**
  - `features/conflicts/services/conflicts-queue.ts:145` `resolutionsOf` / :164 `unresolvedOf`.
  - `features/hours/services/hours-conflicts.ts:104, :146`.
  - `features/conflicts/services/erasures.ts:~167-171`.
  - `packages/domain/src/collisions.ts:230` stays a key filter.
- **Screen.** `features/conflicts/services/resolution-screen.ts` and `resolution-write.ts` (23505 mapping).
- **Tests.**
  - Unit: `resolutions.test.ts`, `conflicts-queue.test.ts`, `hours-conflicts.test.ts`, `organization-hours.test.ts`, `my-hours.test.ts`, `erasures.test.ts`, `resolution-screen.test.ts`, `resolution-write.test.ts`, `leave-section.test.ts`.
  - DB: `test/supabase-scaffold.test.ts` (0027 body and grants, the `my_conflict_resolutions` shape), `test/rls-isolation.test.ts`.
  - e2e: `e2e/tests/conflicts/conflict-resolution.spec.ts`, `e2e/tests/calendar/calendar-roster-erasures.spec.ts`, `e2e/tests/hours/hours.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0033_*.sql`, plus the scaffold, RLS and DB tests -- (i) the removal cascade, (ii) the backfill, (iii) the member read with the link. Apply it to the shared stack with `supabase migration up`.
- [x] Shared effectiveness helper (with tests), `resolutions.ts` parse, and the three funnels -- covering every matrix row except Backfill (DB test) and the e2e-only rows.
- [x] `resolution-screen.ts` / `resolution-write.ts` and the hint string -- the hint and the 23505 mapping.
- [x] `hr.json`, the registries, and `leave-section.ts` using the shared helper.
- [x] e2e -- Removed override (conflict back, accept saves), Pending after rotation save (hint, remove pending, re-decide), Hours flip, and a calendar removal of a replace override showing no erasure dialog while the conflict reappears.
- [x] Docs -- epic context (lifetime rules and the accepted cases), UX docs, AD lines if any. `sprint-status.yaml`: 5-5d. Mark the 5.4a, 5.4c, 5.5d ledger entries resolved.

**Acceptance Criteria:**
- Given a replaced conflict whose override a rotation save left pending, when the admin opens the queue, then the conflict is listed again, and its resolution screen explains how to free it.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (apply 0033 with `supabase migration up`; no `db:reset`)
- `pnpm exec playwright test conflicts calendar hours rotation` -- expected: green

## Suggested Review Order

**The database**

- Entry point: removing the linked override ends its resolution and frees the key; backfill; member read gets the link.
  [`0033_replacement_resolution_lifetime.sql`](../../supabase/migrations/0033_replacement_resolution_lifetime.sql)

**When a replacement counts**

- Effective only while its override is in force and applied; unknown ids count until the calendar re-reads.
  [`replacement-effect.ts:178`](../../apps/web/src/features/conflicts/services/replacement-effect.ts#L178)
  [`replacement-effect.ts:142`](../../apps/web/src/features/conflicts/services/replacement-effect.ts#L142)

- The one funnel every surface reads.
  [`conflicts-queue.ts:171`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L171)
  [`conflicts-queue.ts:148`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L148)

**Re-deciding**

- Held: the key is taken by a replacement that does not apply; Spremi waits with a calendar link.
  [`replacement-effect.ts:197`](../../apps/web/src/features/conflicts/services/replacement-effect.ts#L197)
  [`resolution-write.ts:53`](../../apps/web/src/features/conflicts/services/resolution-write.ts#L53)

**Tests**

- e2e: pending after a rotation save, and an inert replacement, both re-decided after removal.
  [`conflict-resolution.spec.ts:820`](../../e2e/tests/conflicts/conflict-resolution.spec.ts#L820)
  [`conflict-resolution.spec.ts:889`](../../e2e/tests/conflicts/conflict-resolution.spec.ts#L889)
