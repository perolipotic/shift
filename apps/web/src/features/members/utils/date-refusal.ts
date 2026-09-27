import {
  MEMBER_STATUS_DATE_TAKEN,
  MEMBER_STATUS_IN_PAST,
  MEMBER_STATUS_OUT_OF_ORDER,
  MEMBER_TEAM_DATE_TAKEN,
  MEMBER_TEAM_IN_PAST,
  MEMBER_TEAM_OUT_OF_ORDER,
  MEMBER_WRITE_INVALID,
  type MemberWriteFailure,
  type MemberWriteRefusal,
} from '@/features/members/services/write';

/**
 * The refusals that name the DATE a status or team change was entered with,
 * wherever they were raised: a date in the past, a date another version
 * already holds, or a date before the latest version. The other refusals the
 * two blocks raise — no change, a change already scheduled, a team archived, a
 * position missing, a list behind the database — are about something else,
 * and marking the date invalid for them would point at the one control that is
 * not wrong.
 */
const DATE_REFUSALS: ReadonlySet<MemberWriteFailure> = new Set<MemberWriteFailure>([
  MEMBER_STATUS_IN_PAST,
  MEMBER_STATUS_DATE_TAKEN,
  MEMBER_STATUS_OUT_OF_ORDER,
  MEMBER_TEAM_IN_PAST,
  MEMBER_TEAM_DATE_TAKEN,
  MEMBER_TEAM_OUT_OF_ORDER,
]);

/**
 * A date the block marked invalid: the refusal that named it, and the history
 * the block was drawn from when it did.
 *
 * THE REFUSAL BY IDENTITY, so any later refusal — or none — unmarks the date
 * without a second piece of state to clear. THE HISTORY, so a block that
 * remounts on a new history (a fresh `defaultValue`, the entered date gone)
 * starts unmarked although the refusal still stands above it.
 */
export interface DateMark {
  readonly refusal: MemberWriteRefusal;
  readonly history: string;
}

/**
 * The mark a refusal earns, or `null` for none.
 *
 * `MEMBER_WRITE_INVALID` NAMES THE DATE ONLY FROM THE PREFLIGHT, where it means
 * "not a date". From the server write it is any 22xxx or 23xxx the database
 * raised — a check constraint, or a malformed team or position — and says
 * nothing about which value.
 */
export function dateMarkFor(
  refusal: MemberWriteRefusal,
  history: string,
  fromPreflight: boolean,
): DateMark | null {
  const named =
    DATE_REFUSALS.has(refusal.code) || (fromPreflight && refusal.code === MEMBER_WRITE_INVALID);

  return named ? { refusal, history } : null;
}

/**
 * Whether the date control is `aria-invalid` now: only while the refusal it was
 * marked for is still the block's refusal, and the block still shows the
 * history it was marked on. The leave field's `invalidField` is the same idea
 * on the form.
 */
export function dateMarked(
  mark: DateMark | null,
  refusal: MemberWriteRefusal | null,
  history: string | null,
): boolean {
  return mark !== null && refusal !== null && mark.refusal === refusal && mark.history === history;
}
