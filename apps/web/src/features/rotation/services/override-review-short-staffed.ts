import { rosterChangeSnapshotOf } from '@/features/calendar/services/roster-erasures';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { dayReportOf } from '@/features/calendar/utils/change-preview';
import { overrideChangeSnapshotOf } from '@/features/conflicts/services/override-erasures';
import {
  REVIEW_SHIFT_TYPE,
  reviewOffersOf,
  type ReviewRow,
} from '@/features/rotation/services/override-disposition';
import {
  reviewedAmendChangeOf,
  reviewedConfirmChangeOf,
  type ReviewChange,
} from '@/features/rotation/services/override-review-erasures';
import {
  SHORT_STAFFED_KNOWN,
  type ShortStaffedReport,
  type StaffingLeaveSource,
} from '@/features/staffing/services/short-staffed';

/**
 * IZMJENE ZA PREGLED'S SHORT-STAFFED BLOCKS (Epic 11 retro A7; story 11.2's
 * report on the surface it deferred), as a pure view model in a `.ts` that
 * renders nothing (AD-15). `use-override-review` wires it; `override-review`
 * draws it.
 *
 * CONFIRMING OR AMENDING A PENDING OVERRIDE PUTS IT IN FORCE, so it can newly
 * leave its day's shift short of people. Each "after" is the one the erasure
 * check builds for that write (`overrideChangeSnapshotOf` /
 * `rosterChangeSnapshotOf`, by the row's layer), over the CACHED calendar, and
 * the window is the row's date: the day detail's own `dayReportOf`. A
 * discard puts nothing in force and shows nothing.
 *
 * `null` — no block — while the calendar is pending or failed (the caller
 * passes `null`: R1), with the minimum empty (before any leave is looked at),
 * and for a write the cached calendar says would be refused anyway (`gone`,
 * `archived`, `taken`, `sameAsProjected`). Never a gate: no button, latch or
 * write changes.
 */

/**
 * The cached calendar as `change` would leave it, by its layer's own guard:
 * the erasure check's "after", or the refusal the write would meet anyway.
 *
 * @throws RangeError as the guards do.
 */
function reviewChangeSnapshotOf(
  calendar: CalendarSnapshot,
  change: ReviewChange,
): { readonly ok: true; readonly after: CalendarSnapshot } | { readonly ok: false } {
  return change.layer === REVIEW_SHIFT_TYPE
    ? overrideChangeSnapshotOf(calendar, change.change)
    : rosterChangeSnapshotOf(calendar, change.change);
}

/**
 * A ROW'S BLOCK: what confirming `row` would newly leave short of people,
 * shown ONLY when it would — a known report with rows. Nothing where the row
 * offers no confirm, and nothing while the leave is not known or the report
 * cannot be derived (the product owner's "only when that row's confirm would
 * newly make a shift short"): the amend's dialog and the cancel say the
 * unknown line, a row does not.
 */
export function reviewRowShortStaffedOf(
  calendar: CalendarSnapshot | null,
  row: ReviewRow,
  leave: StaffingLeaveSource | null,
): ShortStaffedReport | null {
  if (calendar === null || !reviewOffersOf(row).confirm) return null;

  const report = dayReportOf(calendar, row.isoDate, leave, () =>
    reviewChangeSnapshotOf(calendar, reviewedConfirmChangeOf(row)),
  );

  return report !== null && report.kind === SHORT_STAFFED_KNOWN && report.rows.length > 0 ? report : null;
}

/** Each row's block, by override id: only the rows that show one. */
export function reviewRowsShortStaffedOf(
  calendar: CalendarSnapshot | null,
  rows: readonly ReviewRow[],
  leave: StaffingLeaveSource | null,
): ReadonlyMap<string, ShortStaffedReport> {
  const reports = new Map<string, ShortStaffedReport>();

  if (calendar === null) return reports;

  for (const row of rows) {
    const report = reviewRowShortStaffedOf(calendar, row, leave);

    if (report !== null) reports.set(row.id, report);
  }

  return reports;
}

/**
 * THE AMEND DIALOG'S BLOCK: what amending `row` to `choiceId` — the type, or
 * for a roster override the member to put on, as currently chosen — would
 * newly leave short of people. The unknown line too, as every 11.2 dialog
 * says it. `null` where the row offers no amend, with nothing chosen, and for
 * a choice the amend's preflight refuses (a roster amend's `sameMember`) or
 * the cached calendar does.
 */
export function reviewAmendShortStaffedOf(
  calendar: CalendarSnapshot | null,
  row: ReviewRow,
  choiceId: string | null,
  leave: StaffingLeaveSource | null,
): ShortStaffedReport | null {
  if (calendar === null || choiceId === null || choiceId === '' || !reviewOffersOf(row).amend) return null;
  if (row.layer !== REVIEW_SHIFT_TYPE && (choiceId === row.memberInId || choiceId === row.memberOutId)) return null;

  return dayReportOf(calendar, row.isoDate, leave, () =>
    reviewChangeSnapshotOf(calendar, reviewedAmendChangeOf(row, choiceId)),
  );
}
