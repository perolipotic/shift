---
title: 'Story 11.2: Every save that can cause it shows a short-staffed shift'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '11a8be21d9939e3ed34e4a6c6cb5bf51614628da'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-11-1-the-staffing-rule-and-the-minimum-members-setting.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 11.1 derives short-staffed shifts, but no save tells the admin that it leaves a shift short. The admin finds out on the day.

**Approach:** One web view model diffs each surface's own before and after through `newlyShortStaffedOf` (11.1), and one block shows the result in *Što se mijenja*: `Smjena B, 14.10. Dan: rade 2 od najmanje 3`. Each surface's after is the one its erasure check (or its conflict preview) already builds. The resolution strip's coverage term states the people at work against the minimum. Nothing gates a save.

## Boundaries & Constraints

**Always:**
- Surfaces and their after. Every after is a snapshot or record list the surface already builds. None is projected anew:
  - Leave record (new, amend) and request approval: the org's live leave plus the candidate or amended range, as `leaveConflictsOf` shapes it. Window: the new range.
  - Day-detail roster and type dialogs, saves and removals: `rosterChangeSnapshotOf` / `overrideChangeSnapshotOf`. Window: the date.
  - Deactivation and team move: `memberChangeSnapshotOf`.
  - Rotation save: `draftCalendarSnapshotOf`. The builder has no *Što se mijenja*, so the block sits above its save bar under that heading.
  - For both rows above, the window starts on the change's date and runs 366 days.
- `CalendarSnapshot.minimumMembers` is read on the calendar's own `organizations` row (`minimum_members`). A missing or invalid value parses as `null`, as 11.1's `minimumMembersOf` does. The staffing input mirrors `collisionInputOf`: the active teams, the same leave on both sides.
- Empty setting: no block, no line, and no extra leave read (the 11.1 deferral, answered here). Each surface asserts this.
- Rows are ordered by date, then team. The block shows the first 5, then `i još {n}`. It has a heading, an icon from the icon facade and text, so it never relies on colour. It is never `destructive`, never the accent, and never an alert.
- The leave read is pending or failed, or the domain throws a `RangeError`: one neutral line, `Popunjenost smjena sada ne mogu provjeriti.`, logged. The save stays offered.
- Surfaces that lack the organization's leave (the member page, the request review, the rotation builder) observe `organizationLeaveRecordsQueryOptions` under its shared key, only while the minimum is set.
- Resolution strip, minimum set: the coverage term reads `rade {n} od najmanje {m}`. `n` comes from `peopleAtWorkOn` over that option's own after: as read (accept), with the amended range (amend), or with the replacement on (replace). A short shift adds a glyph and words. Minimum empty: the term stays as shipped.

**Ask First:**
- Recomputing the report on the save's fresh reads, or letting it hold a save.
- Defining the `warning` token here (11.3 owns it).

**Never:**
- No calendar mark, no *Danas* card, no `warning` token (11.3, 11.4). Nothing is stored (AD-1). No staffing arithmetic outside `domain/staffing` (AD-7). Rank and position are never read.
- No `supabase db reset` and no migration (the column exists since 0048).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Leave makes short | team of 4, minimum 3, one already on leave, a second recorded 14.10. | block `Smjena B, 14.10. Dan: rade 2 od najmanje 3`; Spremi saves | N/A |
| Already short | short before and after | no row | N/A |
| Replacement removed | removing an override drops the shift below the minimum | block on the removal confirmation | N/A |
| Deactivation | team of 3, minimum 3 | each working shift ahead: first 5 rows + `i još {n}` | N/A |
| Setting empty | minimum `null` | no block, no line, no leave read | N/A |
| Unknown | leave read pending or failed, or a RangeError | the neutral line; save offered | logged |
| Resolution strip | minimum 3; 2 at work, accept / replace | `rade 2 od najmanje 3` with the glyph and words / `rade 3 od najmanje 3` | N/A |

## Epic AC Deviations

- *"the leave dialog, a request approval, the roster and type dialogs, a conflict resolution, a deactivation or a rotation save"*:
  - **Extended** to the team move and to the day-detail removals, which can cause the same shortfall through the same after.
  - **Narrowed:** the override review after a rotation save, and the rotation cancel, are deferred (`deferred-work.md`). They have their own erasure afters and no *Što se mijenja*.
- *"a conflict resolution … Što se mijenja shows a block"*: no resolution option lowers staffing (accept keeps it, replace and amend raise it), so none can newly make a shift short. The resolution states it only in the coverage term (AC 2).
- *"from the same 'after' snapshot as its erasure check"*: a leave save has no erasure check. Its after is the one its conflict preview builds.

</frozen-after-approval>

## Code Map

- `packages/domain/src/staffing.ts` -- `newlyShortStaffedOf(before, after, from, to)`, `peopleAtWorkOn`, `StaffingInput` (ScheduleInput + `leaveRecords` + `minimumMembers`). Read-only.
- `apps/web/src/features/conflicts/services/erasures.ts:153` `erasuresOf`, `erasuresOutcomeOf` -- the guard-and-log shape to mirror. `conflicts-queue.ts:275` `collisionInputOf` -- the input recipe to mirror (add `teamIds`).
- `apps/web/src/features/calendar/services/snapshot.ts:117` `CALENDAR_COLUMNS`, :271 `CalendarSnapshot`; `snapshot.test.ts` pins the columns.
- `apps/web/src/features/calendar/utils/change-preview.ts` `overridePreviewOf`/`rosterPreviewOf` -- the day-detail *Što se mijenja*. `calendar/components/roster-form.tsx`, `override-form.tsx`, `day-detail-dialog.tsx` (removal confirmations). `roster-erasures.ts:94-208`, `conflicts/services/override-erasures.ts` -- the afters, including `REMOVAL`/`REMOVE`.
- `apps/web/src/features/leave/services/leave-conflicts.ts:109` `leaveConflictsOf` -- candidate (`LEAVE_CANDIDATE_ID`) and amend shapes, and the unknown states. `leave/components/leave-conflict-lines.tsx`, `member-leave-dialog.tsx`, `leave-request-review-body.tsx`, `leave/hooks/use-member-leave.ts`, `use-leave-request-review.ts`.
- `apps/web/src/features/members/services/member-erasures.ts:166` `memberChangeSnapshotOf`. `deactivation-consequence.ts`, `team-move-preview.ts`, `hooks/use-member-status.ts:170`, `use-member-team.ts`, and `components/member-status-card.tsx`, `member-team-card.tsx`.
- `apps/web/src/features/rotation/services/erasures.ts:46` `draftCalendarSnapshotOf`. `hooks/use-rotation-builder.ts`, `components/rotation-save-bar.tsx`.
- `apps/web/src/features/conflicts/services/resolution-screen.ts:670-700` (`covered`, `replaceCovered`, `amend`), :716 `coverageMessageKey`. `components/resolution-option.tsx` -- the strips.
- `apps/web/src/features/leave/services/leave-list.ts:455` `organizationLeaveRecordsQueryOptions`. `today/services/today.ts:87` `NEXT_SHIFT_HORIZON_DAYS` -- the 366-day precedent.
- `hr.json` -- `calendar.preview` near :302, `leave` :949, `members` :1556, `zaOdluku.resolution` :584.
- Inventories: `pages/key-sources.fixture.ts`, `source-guards.fixture.ts`, `structural-pins-*.test.ts`, `test/resource-hygiene.test.ts` (voice rule).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/calendar/services/snapshot.ts` (+test) -- select `minimum_members` and parse `minimumMembers` leniently.
- [x] `apps/web/src/features/staffing/services/short-staffed.ts` (+test) -- `staffingInputOf`, `shortStaffedReportOf(before, after, window)` returning `null` (empty setting), known rows with `more`, or unknown. Also the 366-day and 5-row constants and the strip's `coverageAgainstMinimumOf`. Tests cover every matrix row under both fixtures.
- [x] `apps/web/src/features/staffing/components/short-staffed-block.tsx` -- the block and the unknown line.
- [x] Surfaces -- wire the block into each listed dialog's *Što se mijenja*, in its existing polite live region. Add the observed leave read where it is missing.
- [x] `resolution-screen.ts`, `resolution-option.tsx` -- the coverage term against the minimum.
- [x] `hr.json` and the inventories -- the keys (Croatian plural `radi`/`rade`, and `ne radi nitko` for 0).
- [x] `e2e/tests/**` -- a leave record shows the block and saves; with the setting empty there is no block. CI runs it.
- [x] Docs -- `epics.md` UX-DR11, 23, 48. `DESIGN.md` :339 and :358. `EXPERIENCE.md` :104, :105, :117. `deferred-work.md` -- mark the 11.2 part of the "empty reports nothing" entry RESOLVED in part (11.3 stays open), and add the override-review and rotation-cancel entry (written during planning).

**Acceptance Criteria:**
- Given any listed surface and a change that newly makes a working shift short, when its *Što se mijenja* renders, then the block names the date, team, type, people at work and minimum, and the save goes through unchanged.
- Given a conflict resolution with the minimum set, when its strips render, then each coverage term states people at work against the minimum.
- Given the merged change, then UX-DR11, 23 and 48 and the DESIGN.md and EXPERIENCE.md lines describe what shipped.

## Spec Change Log

## Design Notes

The report is a preview from the cache the surface observes, not a second gate. The erasure check's fresh reads at save do not re-derive it, so a stale cache can at worst show a stale warning and never block (R10.4). An open-ended change (deactivation, team move, rotation) can make every future shift short, so the 366-day window and the 5-row cap keep the block readable. A small team under the minimum reads five rows such as `Smjena C, 05.11. Dan: rade 2 od najmanje 3`, then `i još 48` on its own line.

## Verification

**Commands:**
- `pnpm --filter @shift/domain test && pnpm --filter ./apps/web test && pnpm lint && pnpm typecheck` -- expected: green.
- `pnpm test` -- expected: green. E2E runs in CI (5173 may be taken locally).

## Suggested Review Order

**The report (one diff for every surface)**

- Entry point: before/after through `newlyShortStaffedOf`; null when empty, rows + more, or unknown.
  [`short-staffed.ts:225`](../../apps/web/src/features/staffing/services/short-staffed.ts#L225)

- Input mirrors `collisionInputOf`: active teams, the same leave on both sides.
  [`short-staffed.ts:126`](../../apps/web/src/features/staffing/services/short-staffed.ts#L126)

- Leave read states: pending is unknown without a log; failed or untrusted logs.
  [`short-staffed.ts:153`](../../apps/web/src/features/staffing/services/short-staffed.ts#L153)

- Configuration and leave wrappers; non-admin viewers get nothing.
  [`short-staffed.ts:276`](../../apps/web/src/features/staffing/services/short-staffed.ts#L276)

- Leave candidate/amend after, shaped as `leaveConflictsOf` shapes it; overlap is null.
  [`short-staffed.ts:310`](../../apps/web/src/features/staffing/services/short-staffed.ts#L310)

- The short predicate lives in the domain (AD-7).
  [`staffing.ts:81`](../../packages/domain/src/staffing.ts#L81)

**The minimum on the calendar snapshot**

- Selected on the calendar's own organizations row; no extra read.
  [`snapshot.ts:118`](../../apps/web/src/features/calendar/services/snapshot.ts#L118)

- Lenient parse: a missing or invalid value is not set.
  [`snapshot.ts:386`](../../apps/web/src/features/calendar/services/snapshot.ts#L386)

- Saving the minimum now invalidates the calendar too.
  [`use-organization-settings.ts:481`](../../apps/web/src/features/organization/hooks/use-organization-settings.ts#L481)

**Surfaces, each with its erasure check's after**

- Day detail roster and type, saves and removals.
  [`change-preview.ts:297`](../../apps/web/src/features/calendar/utils/change-preview.ts#L297)

- Removal confirmations key on stable date and override id.
  [`change-preview.ts:319`](../../apps/web/src/features/calendar/utils/change-preview.ts#L319)

- Leave dialog: new record and amend.
  [`use-member-leave.ts:78`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L78)

- Request approval carries `shortStaffed` in its ready preview.
  [`leave-request-review.ts:159`](../../apps/web/src/features/leave/services/leave-request-review.ts#L159)

- One "asked" rule gates deactivation and team-move reports (366 days).
  [`deactivation-consequence.ts:156`](../../apps/web/src/features/members/services/deactivation-consequence.ts#L156)

- Team move through `memberChangeSnapshotOf`.
  [`team-move-preview.ts:200`](../../apps/web/src/features/members/services/team-move-preview.ts#L200)

- Rotation: one normalised draft for refusal, after and window.
  [`erasures.ts:158`](../../apps/web/src/features/rotation/services/erasures.ts#L158)

- Rotation hook: unknown while an unsaved draft's calendar read is pending or failed.
  [`use-draft-short-staffed.ts:23`](../../apps/web/src/features/rotation/hooks/use-draft-short-staffed.ts#L23)

- Organization leave observed under the shared key, admin and minimum set only.
  [`use-staffing-leave.ts:26`](../../apps/web/src/features/staffing/hooks/use-staffing-leave.ts#L26)

**The resolution strip**

- Each card's figure from its own after; any null makes the whole staffing null.
  [`resolution-screen.ts:403`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L403)

- `rade n od najmanje m`, glyph and words when short; shipped term when empty.
  [`resolution-option.tsx:50`](../../apps/web/src/features/conflicts/components/resolution-option.tsx#L50)

**The block**

- Heading, icon, rows, `i još {n}`; neutral, never an alert.
  [`short-staffed-block.tsx:39`](../../apps/web/src/features/staffing/components/short-staffed-block.tsx#L39)

**Tests, inventories and docs**

- Every matrix row under both fixtures.
  [`short-staffed.test.ts:2`](../../apps/web/src/features/staffing/services/short-staffed.test.ts#L2)

- Each surface's model, the strip's branches, and empty reports nothing.
  [`surfaces.test.ts:96`](../../apps/web/src/features/staffing/surfaces.test.ts#L96)

- E2E: the leave record shows the block and saves; empty shows none.
  [`short-staffed.spec.ts:92`](../../e2e/tests/people/short-staffed.spec.ts#L92)

- E2E: a day-detail roster change shows the block and saves.
  [`calendar-short-staffed.spec.ts:94`](../../e2e/tests/calendar/calendar-short-staffed.spec.ts#L94)

- The voice rule admits two `popunjenost` keys explicitly.
  [`resource-hygiene.test.ts:2489`](../../test/resource-hygiene.test.ts#L2489)

- UX-DR48 rewritten as shipped (UX-DR11 and 23 likewise).
  [`epics.md:182`](../planning-artifacts/epics.md#L182)
