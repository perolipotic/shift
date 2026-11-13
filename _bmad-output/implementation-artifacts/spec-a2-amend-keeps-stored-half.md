---
title: 'A2: the admin can amend a stored half day whose shift has gone'
type: 'bugfix'
created: '2026-11-13'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'be625e1b4a300614ed499e009b8bce726170db8f'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin's leave dialog opens an amend on the record's own half (`use-member-leave.ts`). `leavePreviewStateOf` defaults to `refuseHalf = true` and checks `halfDayShiftOf` for the date. If the member no longer has exactly one working shift that date (the rotation or an override changed), every amend of that half-day record is refused with *Taj dan nemaš točno jednu radnu smjenu.*, even a type-only amend. 13.5's Design Note says such a stored half costs 0 and raises nothing (epic 13 retro B3, action A2).

**Approach:** An amend that **keeps** the stored half is never refused for the shift. It keeps it when the date stays the record's own and the half stays the record's own. It is costed by the domain (0 on a date with no working shift), as the request review already does (13.5b). A **fresh** half choice, on a new date or the other half, is still refused when the date has no single working shift.

## Boundaries & Constraints

**Always:**
- The rule lives in `leavePreviewStateOf`, not in its callers.
- A same-range, same-type, same-half amend stays `LEAVE_RANGE_UNCHANGED`.
- New records and the member's request form are unchanged.
- The request review's `refuseHalf: false` is unchanged.

**Ask First:** drawing the kept half (which half, without times) when no half cards can be drawn. That would need new `hr.json` copy.

**Never:**
- Touch the DB or migrations. `amend_leave_record` already accepts any half on a one-date range.
- Run DB-connecting root tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Type-only amend, shift gone | Amending a FIRST half on a date with no working shift; same date, same half, another type | READY; range keeps `half: FIRST`; costs 0 | N/A |
| Unchanged, shift gone | Same date, type and half | `LEAVE_RANGE_UNCHANGED` | N/A |
| Other half, shift gone | Same date, SECOND chosen | `LEAVE_HALF_REFUSED` on the half field | N/A |
| Moved date, no shift there | The date moved to another date with no working shift, half kept | `LEAVE_HALF_REFUSED` | N/A |
| Whole day, shift gone | Switch off on the same date | READY whole-day range (unchanged behaviour) | N/A |
| New record, no shift | Not amending | `LEAVE_HALF_REFUSED` (unchanged) | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/leave/services/leave-section.ts`
  - `leavePreviewStateOf` (~L729-790): the `refuseHalf && leaveHalfOfferedOf && halfChoice.on` block runs before the "unchanged" check. The keep-the-stored-half test goes into that condition.
  - Its doc block "A STORED HALF (story 13.5b)" gets a line for the amend.
- `apps/web/src/features/leave/services/leave-section.test.ts`
  - ~L1523-1560: the existing half refusal tests. `baseOf()`'s 2026-09-12 is the viewer's *Slobodno* (no working shift), and 2026-09-10 is a working date.
  - Build the amended `LeaveRecord` with `half` the way the existing amend tests in this file do.
- Read-only:
  - `apps/web/src/features/leave/hooks/use-member-leave.ts:339`, the admin dialog's call, which passes `amendTarget` and the record's half;
  - `conflicts/services/resolution-screen.ts:358`, where a conflict amend never carries a half, because a half is one date and resolves as a removal.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/leave/services/leave-section.ts`:
  - In `leavePreviewStateOf`, skip the shift refusal when `amending !== null`, `from`/`to` equal the record's, and the sent half is non-null and equals `amending.half`.
  - Extend the doc block.
- [x] `apps/web/src/features/leave/services/leave-section.test.ts` -- one test per matrix row.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- mark action item A2 (`epic-13-retro-item-51-…`) `done`.

**Acceptance Criteria:**
- Given a half-day record whose date has lost its working shift, when the admin changes only its type in the dialog, then the preview is ready at 0 days and Spremi sends the amend with the half kept.

## Verification

**Commands:**
- `pnpm --filter ./apps/web exec vitest run src/features/leave` -- expected: all pass.
- `pnpm --filter ./apps/web typecheck && pnpm lint` -- expected: clean.

## Suggested Review Order

**Keeping the stored half**

- The rule: the record's own date and half skip only the shift refusal.
  [`leave-section.ts:775`](../../apps/web/src/features/leave/services/leave-section.ts#L775)

- Switching Pola dana back on, or returning to the record's date, restores its half.
  [`leave-section.ts:546`](../../apps/web/src/features/leave/services/leave-section.ts#L546)

- The dialog's two entry points that call it.
  [`use-member-leave.ts:632`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L632)
  [`use-member-leave.ts:637`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L637)

**Tests and docs**

- The matrix rows, the two-shift date, the whole-day record with the switch on, and the restore helper.
  [`leave-section.test.ts:1623`](../../apps/web/src/features/leave/services/leave-section.test.ts#L1623)

- The Member page's Izmijeni now names the exception, matching the request review's.
  [`EXPERIENCE.md:106`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L106)
