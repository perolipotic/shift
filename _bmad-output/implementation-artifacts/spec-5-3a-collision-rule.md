---
title: 'A collision with a rostered working shift is derived from leave, one per shift, and stored nowhere (5.3a)'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: '7610a31d3b6894f020beaa24679feafcc0cc2414'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Leave is recorded, amended and removed (5.1, 5.2), but nothing in the engine says which rostered working shifts it collides with. Without that, an absence can quietly become an uncovered shift (CAP-16, R6.1–R6.5). The queue (5.3b), the calendar marks (5.3c) and the hours state (5.3d) all need one derivation to read.

**Approach:** Add `packages/domain/src/collisions.ts`, exported from `index.ts`. It derives collisions on read: `leave ∩ working shift ∩ roster` (AD-4). There is no table and no stored conflict. It is asserted on both fixtures in node. It is also asserted against the database through 0029's amend and removal, which closes the 5.2 AC carried in the ledger.

## Boundaries & Constraints

**Always:**
- **The rule (R6.1).** There is one collision per `(memberId, date, teamId)`. It exists when a live leave record of the member covers the date and the member's schedule on that date (`memberScheduleOfMonth`) holds a WORKING shift of that team. That covers their own team, or a team a roster override puts them on. The scope is exactly the scope of `isLeaveDay`, `activeOn` and the cost rule, reused and never re-implemented:
  - A non-working shift raises nothing.
  - A taken-off member raises nothing.
  - No team raises nothing (R7.1).
  - Dates on which the member is inactive raise nothing (R7.3). Earlier active dates still raise.
- **Input.** One organization-wide input: the shared schedule fields of `MemberScheduleInput` (assignments, steps, in-force overrides, `members` with memberships and statuses, in-force roster overrides, `workingShiftTypeIds`), plus leave records `{ id, memberId, from, to }`. The inclusive range follows `leave.ts`.
- **Output.** Each collision carries `memberId`, `date`, `teamId`, `shiftTypeId` and `leaveRecordId`. Sort by date ascending (soonest first, R6.8), then by `teamId`, then by `memberId`. Return ids and codes only. No names and no strings (AD-8).
- **Key.** Export `collisionKeyOf(c)` for `(memberId, date, teamId)`, the key 5.4's resolutions match on (AD-4).
- **Agreement with cost.** For every member, the number of distinct collision dates equals `leaveCostOf` over their records. Collisions can outnumber cost days, because two teams on one date give two collisions.
- **R6.2.** Detection mutates nothing. A frozen input still passes, and `scheduleOfMonth` gives an equal result before and after the call.
- **AD-7.** No `Date`, no time zone, no I/O and no new dependency. A breached precondition throws a `RangeError` naming the value. That covers a bad range, a record whose member is not in `members`, a duplicate record id, and overlapping records of one member.

**Ask First:**
- Any change to `leave.ts`, `schedule.ts`, `roster.ts` or `hours.ts` beyond read-only reuse or exporting an existing helper.
- Adding a resolutions input or filter now. That is 5.4's work.
- Any migration.

**Never:**
- No web code, no UI, no web leave reader, and no `leaveMinutes` change. Those belong to 5.3b–d.
- No conflicts table, no cached set, and no database routine that computes a collision.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Worked example (pilot) | leave 10.09–14.09 over `Dan, Noć, Slobodno, Slobodno, Dan` | 3 collisions, soonest first | N/A |
| UJ-5 | 5 dates, 3 working | 3 collisions | N/A |
| Non-working only | leave over `Slobodno` dates only | none | N/A |
| Put on another team | own working shift plus one a roster override adds, same date | 2 collisions (two `teamId`s), cost 1 | N/A |
| Taken off | an override takes the member off their only shift | none that date | N/A |
| Type overridden | a shift-type override turns a working date non-working, or the reverse | follows the override | N/A |
| No team / deactivated | no membership; or deactivated mid-range | none; only the active dates before deactivation | N/A |
| Two members | both on leave on the same team's shift | 2 collisions, ordered by `memberId` | N/A |
| Bad input | `from > to`, unknown member, duplicate id, overlapping records | — | RangeError naming the value |
| Database (both orgs) | insert leave; amend it via `amend_leave_record` off working days; remove via `remove_leave_record` | collisions = cost; then none from the old id; then none | N/A |

## Epic AC Deviations

- **Met here:** "a conflict exists for every affected working shift, derived rather than stored … And a non-working shift coinciding with leave raises nothing" (CAP-16, AD-4).
- **Met here:** "Given detection running, When it completes, Then it has deleted, hidden and altered no shift" (CAP-16, DI-3).
- **Met here (carried from 5.2):** "When it is amended so it no longer collides, Then every conflict it caused is cleared". This closes the 5.2a ledger entry.
- **DEFERRED to 5.3c** (human split, 2026-10-01): "visible without opening a detail view, carrying `⚠` and its inset ring". Ledger: the "Story 5.3c" entry.
- **NARROWED, rest DEFERRED to 5.3b:** "it appears in a queue ordered soonest first", the past-conflict AC (UX-DR25) and the zero-count AC (UX-DR20). 5.3a only supplies the soonest-first order. Ledger: the "Story 5.3b" entry.

</frozen-after-approval>

## Code Map

- `packages/domain/src/leave.ts`
  - `isLeaveDay` (:115) is the per-date working rule.
  - The `costCounter` loop (:169-186) walks `memberScheduleOfMonth` month by month, with an `activeOn` guard. Copy this pattern, but per shift.
  - `LeaveRange` (:49), `MAX_LEAVE_RANGE_DAYS` (:46), the private `checkRange` (:124) and the header style (:1-35).
  - `leaveCostOf` (:203) is the agreement oracle.
- `packages/domain/src/schedule.ts`
  - `MemberScheduleInput` (:207-230) and `memberScheduleOfMonth` (:277).
  - A `MemberShift` (:239) carries `teamId`, `shiftTypeId` and `viaOverride`. An inactive member gets no shifts (:304-326).
  - `monthOf` (:120) and `adjacentMonth` (:132).
- `packages/domain/src/roster.ts` -- `RosterMember` (:50) and `activeOn` (:109).
- `packages/domain/src/calendar.ts` -- the internal `checkDate` (:21) and `civilDayNumber`/`dateOfCivilDay` (:38, :57).
- `packages/domain/src/index.ts` -- one `export {…} from './x.js'` block per module. The header (:3-4) already names `collisions`.
- `packages/domain/test/leave.test.ts:42-57`
  - The `FIXTURES` (pilot, UJ-5) and `describe.each` pattern.
  - The worked examples at :136 and :153.
  - `fixtures.ts`: `NO_ROSTER` (:166), `soleShiftDaysOf` (:193) and the `at` helper.
  - `roster-overrides.test.ts` shows how put-on and take-off are built.
- `packages/domain/test/purity.test.ts` -- relative imports only. `warnings.test.ts:253-260` has a source-scan precedent (no names, no rank) to mirror.
- `test/rls-isolation.test.ts`
  - `FIXTURES` (:233-248).
  - `memberScheduleInputOf(client, org, memberId)` (:16253). Generalise a sibling into an org-wide collision input.
  - 5.2a helpers: `insertLeave` (~16150), `amendLeaveRecord` (:16814), `removeLeaveRecord` (:16809), `liveLeaveOf` (~16838), and the suite at :16932. Domain imports come from `'../packages/domain/src/index.ts'` (:43-54).
  - Add the new suite after 5.2c (:17347+).

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/collisions.ts` -- `CollisionInput`, `Collision`, `collisionsOf` and `collisionKeyOf`, with the header doc in the `leave.ts` style -- the one derivation.
- [x] `packages/domain/src/index.ts` -- export the module block.
- [x] `packages/domain/test/collisions.test.ts` -- every matrix row except Database, `describe.each` over both fixtures, the cost-agreement property across ranges, the R6.2 no-mutation check, and a no-names source scan.
- [x] `test/rls-isolation.test.ts` -- an org-wide input builder from rows, plus the Database row per fixture under `inRolledBackTransaction`: after the amend, no collision references the old id; after the removal, none remain.

**Acceptance Criteria:**
- Given any fixture member and leave range, when `collisionsOf` runs, then the distinct `(memberId, date)` pairs equal `leaveCostOf` for that member.
- Given an admin amends a record through 0029 so that it covers only non-working dates, when collisions are re-derived from the live rows, then none remain, and no other row was written to clear them.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm test` -- expected: all green, including `packages/domain` and `test/rls-isolation.test.ts` with the local stack running

## Suggested Review Order

**The derivation**

- Entry point: one walk per member over their leave months, one collision per working shift.
  [`collisions.ts:157`](../../packages/domain/src/collisions.ts#L157)

- Each shift goes through `isLeaveDay` itself, so collision and cost can never disagree.
  [`collisions.ts:191`](../../packages/domain/src/collisions.ts#L191)

- One collision per team per date. The Set is defensive only, since an override cannot double a roster.
  [`collisions.ts:194`](../../packages/domain/src/collisions.ts#L194)

- The shape: five ids, no names, plus the in-memory key 5.4 will match on.
  [`collisions.ts:69`](../../packages/domain/src/collisions.ts#L69)
  [`collisions.ts:85`](../../packages/domain/src/collisions.ts#L85)

**Preconditions**

- Duplicate members or records, and overlap within one member, refused with a RangeError naming the value.
  [`collisions.ts:98`](../../packages/domain/src/collisions.ts#L98)

- `checkRange` is exported for reuse, marked INTERNAL and kept out of the index.
  [`leave.ts:127`](../../packages/domain/src/leave.ts#L127)

- The public export block.
  [`index.ts:30`](../../packages/domain/src/index.ts#L30)

**Tests**

- Distinct collision dates equal `leaveCostOf`, across months, years, overrides and deactivation.
  [`collisions.test.ts:361`](../../packages/domain/test/collisions.test.ts#L361)

- A no-team member put on a shift raises one, the same as the cost charges it.
  [`collisions.test.ts:303`](../../packages/domain/test/collisions.test.ts#L303)

- R6.2: a frozen input passes, and the schedule is equal before and after.
  [`collisions.test.ts:448`](../../packages/domain/test/collisions.test.ts#L448)

- Database: insert, amend off working days, and remove through 0029, with collisions re-derived from live rows.
  [`rls-isolation.test.ts:17572`](../../test/rls-isolation.test.ts#L17572)

- The org-wide input builder from rows. The member wrapper now throws for an unknown id.
  [`rls-isolation.test.ts:16256`](../../test/rls-isolation.test.ts#L16256)
  [`rls-isolation.test.ts:17555`](../../test/rls-isolation.test.ts#L17555)
