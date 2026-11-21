import { activeOn, effectiveTeamOn, loanAheadOf, membershipOn, type Loan, type MembershipVersion } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { formatIsoDate } from '@/lib/i18n/format';
import type { LentFrom } from '@/utils/loan-mark';

export type { LentFrom } from '@/utils/loan-mark';

/**
 * STORY 18.5 — where a Loan is said (FR-92, UX-DR59): the mark a lent member
 * carries under the loan team, and the notice a member reads of their own
 * loan. PURE, from the calendar snapshot alone, which already holds every
 * live loan of the organization without its reason or author
 * (`calendar_team_loans()`, 0062): nothing here can show either.
 *
 * Every answer is ABSENT (`null`) without a loan, so a surface with no loan
 * draws exactly what it drew before (R11.4).
 */

/** What a loan mark that cannot be derived is logged as: the surface draws without it. */
export const LOAN_MARKS_UNAVAILABLE = 'LOAN_MARKS_UNAVAILABLE';

/** The member's loan covers today: `U timu {tim} do {do}.` */
export const LOAN_NOTICE_WITH = 'with';
/** The member's next loan starts after today: `Od {od}. u timu {tim} do {do}.` */
export const LOAN_NOTICE_AHEAD = 'ahead';

export type LoanNoticeKind = typeof LOAN_NOTICE_WITH | typeof LOAN_NOTICE_AHEAD;

/** A loan as a member is told of it: the loan team's name and the inclusive dates, formatted. */
export interface LoanNotice {
  readonly kind: LoanNoticeKind;
  readonly teamName: string;
  /** `20.12.2026` */
  readonly from: string;
  /** `22.12.2026` */
  readonly to: string;
}

/** A team's stored name from the snapshot. @throws RangeError for a team it does not hold. */
function teamNameOf(snapshot: Pick<CalendarSnapshot, 'teams'>, teamId: string): string {
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);

  if (team === undefined) throw new RangeError(`the team ${teamId} is not in the snapshot`);

  return team.name;
}

/** `20.12.2026`. @throws RangeError for a date that cannot be formatted. */
function shownDateOf(date: string): string {
  const shown = formatIsoDate(date);

  if (shown === null) throw new RangeError(`the date ${date} could not be formatted`);

  return shown;
}

/**
 * The notice of `loans` on `today` (UX-DR59, *Moj raspored* and *Danas*): the
 * loan covering today, else the first starting after it (`loanAheadOf`), or
 * `null` when none ends on or after today.
 *
 * @throws RangeError on any precondition of `loanAheadOf`, a team the
 *   snapshot does not hold, or a date that cannot be formatted.
 */
export function loanNoticeOf(
  snapshot: Pick<CalendarSnapshot, 'teams'>,
  loans: readonly Loan[] | undefined,
  today: string,
): LoanNotice | null {
  const loan = loanAheadOf(loans ?? [], today);

  if (loan === null) return null;

  return {
    kind: loan.from <= today ? LOAN_NOTICE_WITH : LOAN_NOTICE_AHEAD,
    teamName: teamNameOf(snapshot, loan.teamId),
    from: shownDateOf(loan.from),
    to: shownDateOf(loan.to),
  };
}

/** The `hr.json` key of a notice. */
export function loanNoticeMessageKey(kind: LoanNoticeKind): 'loans.mark.with' | 'loans.mark.ahead' {
  return kind === LOAN_NOTICE_WITH ? 'loans.mark.with' : 'loans.mark.ahead';
}

/**
 * Whether `member` is on `teamId` on `date` THROUGH A LOAN (the domain's
 * `effectiveTeamOn` naming a `loanId` for that team), and if so whom they
 * were lent from: their home team on that date (`membershipOn`), by name, or
 * `null` for none. `null` when they are not lent to `teamId` that date — on
 * their own team, put on by a roster override, or on no loan.
 *
 * @throws RangeError on any precondition of `effectiveTeamOn`, or a home
 *   team the snapshot does not hold.
 */
export function lentFromOf(
  snapshot: Pick<CalendarSnapshot, 'teams'>,
  member: { readonly memberships: readonly MembershipVersion[]; readonly loans?: readonly Loan[] | undefined },
  teamId: string,
  date: string,
): LentFrom | null {
  const effective = effectiveTeamOn(member, date);

  if (effective === null || effective.loanId === null || effective.teamId !== teamId) return null;

  const home = membershipOn(member.memberships, date);

  return { teamName: home === null ? null : teamNameOf(snapshot, home.teamId) };
}

/** Nobody is on loan: the directory with no snapshot, or with no loan in it. */
const NO_LOAN_TEAMS: ReadonlyMap<string, string> = new Map();

/**
 * The directory's `trenutno u timu {tim}` (story 18.5, UX-DR59): for every
 * member whom a live loan of the snapshot puts on another team on `today`,
 * that team's name, by member id. Empty while the snapshot or today is
 * unknown, and — logged, never a failed list — when it cannot be derived:
 * the line decorates a row, and the list's figures never depend on it.
 */
export function currentLoanTeamsOf(
  snapshot: Pick<CalendarSnapshot, 'teams' | 'members'> | null,
  today: string | null,
): ReadonlyMap<string, string> {
  if (snapshot === null || today === null) return NO_LOAN_TEAMS;

  const teams = new Map<string, string>();

  for (const member of snapshot.members) {
    // An inactive member is on no roster, lent or not: no line.
    if ((member.loans ?? []).length === 0) continue;

    // Guarded per member: one that cannot be derived loses only their own line.
    try {
      if (!activeOn(member.statuses, today)) continue;

      const effective = effectiveTeamOn(member, today);

      if (effective === null || effective.loanId === null) continue;
      teams.set(member.id, teamNameOf(snapshot, effective.teamId));
    } catch (cause) {
      if (!(cause instanceof RangeError)) throw cause;
      console.error(LOAN_MARKS_UNAVAILABLE, cause);
    }
  }

  return teams.size === 0 ? NO_LOAN_TEAMS : teams;
}

/**
 * {@link lentFromOf}, GUARDED: a mark that cannot be derived (a home team the
 * snapshot does not hold) is no mark, logged — never a failed day detail or
 * month, whose figures do not depend on it.
 */
export function lentFromShownOf(
  snapshot: Pick<CalendarSnapshot, 'teams'>,
  member: { readonly memberships: readonly MembershipVersion[]; readonly loans?: readonly Loan[] | undefined },
  teamId: string,
  date: string,
): LentFrom | null {
  try {
    return lentFromOf(snapshot, member, teamId, date);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    console.error(LOAN_MARKS_UNAVAILABLE, cause);

    return null;
  }
}

/** {@link loanNoticeOf}, GUARDED as {@link lentFromShownOf}: a notice that cannot be derived is none, logged. */
export function loanNoticeShownOf(
  snapshot: Pick<CalendarSnapshot, 'teams'>,
  loans: readonly Loan[] | undefined,
  today: string,
): LoanNotice | null {
  try {
    return loanNoticeOf(snapshot, loans, today);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    console.error(LOAN_MARKS_UNAVAILABLE, cause);

    return null;
  }
}
