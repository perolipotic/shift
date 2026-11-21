import {
  activeOn,
  daysBetween,
  dutiesOf,
  memberScheduleOfMonth,
  membershipOn,
  monthOf,
  overlappingLegsOf,
  rosterOverridesMadeInertOf,
  type DutyLeg,
  type Loan,
  type MemberScheduleDay,
  type ScheduleInput,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf, shiftLegOn, snapshotScheduleInputOf, typeRangeOn } from '@/features/calendar/utils/month';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  checkedOf,
  type ErasureReads,
} from '@/features/conflicts/services/erasure-check';
import { erasuresOf, erasuresOutcomeOf, type ErasureRow } from '@/features/conflicts/services/erasures';
import { memberTeamOf, type MemberListRow } from '@/features/members/services/list';
import {
  configurationReportOf,
  minimumOfCalendar,
  unknownReportOf,
  type ShortStaffedReport,
  type StaffingLeaveSource,
} from '@/features/staffing/services/short-staffed';
import type { TeamRow } from '@/features/teams/services/list';
import { formatIsoDayMonth, formatIsoWeekdayShortName, isIsoDate, nextIsoDate, previousIsoDate } from '@/lib/i18n/format';
import { trimName } from '@/utils/name';

/**
 * LENDING A MEMBER TO ANOTHER TEAM (story 18.3; FR-88, FR-90, AD-5, UX-DR58):
 * the member page's loan dialog, as a `.ts` the node suite executes (AD-15).
 * Codes and operands only; the dialog words them from `hr.json`'s `loans`.
 *
 * ONE "AFTER" ({@link loanChangeSnapshotOf}): the calendar snapshot with the
 * draft loan appended to the member's `members` entry — and to the viewer,
 * when the viewer is the member — so every roster the domain derives follows
 * it (R11). *Što se mijenja* ({@link loanPreviewOf}), the short-staffed block
 * ({@link shownLoanShortStaffedOf}) and the erasure check
 * ({@link loanErasureCheckOf}) all derive from that one "after".
 *
 * REFUSED BEFORE DERIVING, as the database would refuse the insert (0062):
 * the team missing from the read (stale) or archived, the member's home team
 * on any covered date, a live loan of the member sharing a date, or `to`
 * before `from`.
 *
 * THE WRITE IS 0062's PLAIN INSERT ({@link lendMember}): the organization,
 * the member, the team, the inclusive range as a `daterange` literal and the
 * trimmed reason. `created_by` and `created_at` are the columns' defaults.
 * 0063's trigger notifies the member (`LOAN_MADE`); nothing here sends it.
 *
 * WARNS, NEVER BLOCKS: nothing in the preview gates *Spremi*. Only an
 * erasure waits on a confirmation, as for every configuration write.
 *
 * AMEND, END EARLY, REMOVE (story 18.4; FR-91): a {@link LoanEdit} names the
 * live loan it replaces and the loan as it will stand, or none for a
 * removal. Its "after" ({@link loanEditSnapshotOf}) is the member's loans
 * with the old one replaced by the draft, or without it; everything the lend
 * derives is derived over its window ({@link loanEditWindowOf}): from the
 * earlier first date to the later last date of the two ranges. The writes are
 * 0064's definers, `amend_team_loan` and `remove_team_loan`
 * ({@link amendLoan}, {@link removeLoan}); 0064 notifies the member once.
 */

/** The table a loan is inserted into (0062). */
export const TEAM_LOANS_TABLE = 'team_loans';

/** The reason's bounds once trimmed by 0036's code-point class, as 0062's check counts them. */
export const LOAN_REASON_MIN = 1;
export const LOAN_REASON_MAX = 200;

/** How many shift lines *Što se mijenja* shows before `i još {n}`. */
export const LOAN_SHOWN_SHIFTS = 10;

/**
 * How many days before `from` and after `to` the preview reads legs, so a
 * no-rest run reaching past the reported window keeps its whole total
 * (FR-26's figure). A run longer than this is cut alike on both sides.
 */
export const LOAN_DUTY_REACH_DAYS = 7;

/** The draft loan's id in the "after": no stored loan (a uuid) carries it. */
export const LOAN_DRAFT_ID = 'loan-draft';

/** No team picked: the placeholder. */
export const LOAN_UNPICKED = 'unpicked';
/** *Od* is not a calendar date. */
export const LOAN_FROM_INVALID = 'from';
/** *Do* is not a calendar date. */
export const LOAN_TO_INVALID = 'to';
/** *Do* is before *Od*. */
export const LOAN_ORDER = 'order';
/** The reason is blank or longer than {@link LOAN_REASON_MAX} once trimmed (or 0062's `team_loans_reason_length`). */
export const LOAN_REASON = 'reason';
/** The team, or the member, is not in the fresh read: the screen is behind the database. */
export const LOAN_STALE = 'stale';
/** The team was archived meanwhile. */
export const LOAN_ARCHIVED = 'archived';
/** The team is the member's own team on a covered date. */
export const LOAN_HOME = 'home';
/** A live loan of the member shares a date (or 0062's 23P01). */
export const LOAN_OVERLAP = 'overlap';
/** The caller may not lend (42501). */
export const LOAN_DENIED = 'denied';
/** Anything else: try again. */
export const LOAN_FAILED = 'failed';
/** An amend that changes nothing: the same team and dates, and no new reason (story 18.4). */
export const LOAN_UNCHANGED = 'unchanged';

/** Logged when a loan's check or write, or a re-read after it, could not be settled. */
export const LOAN_UNAVAILABLE = 'LOAN_UNAVAILABLE';

/** What the browser refuses before anything is sent: a field's own alert. */
export type LoanEntryRefusal =
  | typeof LOAN_UNPICKED
  | typeof LOAN_FROM_INVALID
  | typeof LOAN_TO_INVALID
  | typeof LOAN_ORDER
  | typeof LOAN_REASON
  | typeof LOAN_STALE
  | typeof LOAN_UNCHANGED;

/** What the fresh snapshot refuses: the database would refuse it anyway. */
export type LoanSnapshotRefusal =
  | typeof LOAN_ORDER
  | typeof LOAN_STALE
  | typeof LOAN_ARCHIVED
  | typeof LOAN_HOME
  | typeof LOAN_OVERLAP;

/** What the insert, the amend or the removal answers when it is refused (an amend's or removal's gone loan is {@link LOAN_STALE}). */
export type LoanWriteFailure =
  | typeof LOAN_OVERLAP
  | typeof LOAN_DENIED
  | typeof LOAN_REASON
  | typeof LOAN_STALE
  | typeof LOAN_FAILED;

export type LoanRefusal = LoanEntryRefusal | LoanSnapshotRefusal | LoanWriteFailure;

/** A team the dialog offers. */
export interface LoanChoice {
  readonly id: string;
  readonly name: string;
}

/** A loan as entered and preflighted: what is checked and sent. */
export interface LoanDraft {
  readonly memberId: string;
  readonly teamId: string;
  /** `YYYY-MM-DD`, inclusive. */
  readonly from: string;
  /** `YYYY-MM-DD`, inclusive. */
  readonly to: string;
  /** Trimmed. */
  readonly reason: string;
}

/** The placeholder's value: no team. */
export const LOAN_UNPICKED_VALUE = '';

// ------------------------------------------------------------------ choices

/**
 * The teams the dialog offers (design note 2): every active team but the
 * member's team today, in the teams' order. `null` — no button — while the
 * teams or today are unknown, or no team is left to offer. The home team on
 * another covered date is the fresh check's refusal ({@link LOAN_HOME}).
 */
export function loanChoicesOf(
  member: MemberListRow,
  activeTeams: readonly TeamRow[] | null,
  today: string | null,
): readonly LoanChoice[] | null {
  if (activeTeams === null || today === null) return null;

  const current = memberTeamOf(member, today).team?.id ?? null;
  const choices = activeTeams
    .filter((team) => !team.archived && team.id !== current)
    .map((team) => ({ id: team.id, name: team.name }));

  return choices.length === 0 ? null : choices;
}

/**
 * The teams an amend offers (story 18.4, design note 3): the lend's, plus the
 * loan's own team when it is active and not offered already (the member's
 * team today, after a move). `null` while the teams or today are unknown;
 * empty when none is left, so the dialog still opens for a removal (review).
 */
export function loanAmendChoicesOf(
  member: MemberListRow,
  activeTeams: readonly TeamRow[] | null,
  today: string | null,
  loan: Loan,
): readonly LoanChoice[] | null {
  if (activeTeams === null || today === null) return null;

  const offered = loanChoicesOf(member, activeTeams, today) ?? [];
  const own = activeTeams.find((team) => team.id === loan.teamId && !team.archived);

  if (own === undefined || offered.some((choice) => choice.id === own.id)) return offered;

  return activeTeams
    .filter((team) => team.id === own.id || offered.some((choice) => choice.id === team.id))
    .map((team) => ({ id: team.id, name: team.name }));
}

/** The choice `value` names, or `undefined` for the placeholder or one not offered. */
export function loanChoiceOf(choices: readonly LoanChoice[] | null, value: string): LoanChoice | undefined {
  return value === LOAN_UNPICKED_VALUE ? undefined : choices?.find((choice) => choice.id === value);
}

/** The reason as sent — trimmed by 0036's class — or `null` when 0062 would refuse it. */
export function loanReasonOf(reason: string): string | null {
  const trimmed = trimName(reason);
  const length = [...trimmed].length;

  return length < LOAN_REASON_MIN || length > LOAN_REASON_MAX ? null : trimmed;
}

export type LoanPreflight =
  | { readonly ok: true; readonly draft: LoanDraft }
  | { readonly ok: false; readonly code: LoanEntryRefusal };

/**
 * The browser's preflight, field by field in the dialog's order: the team
 * (the placeholder, or one no longer offered — {@link LOAN_STALE}), *Od*,
 * *Do*, their order, then the reason. What passes is what is sent.
 */
export function loanPreflightOf(
  memberId: string,
  choices: readonly LoanChoice[] | null,
  entered: { readonly teamId: string; readonly from: string; readonly to: string; readonly reason: string },
): LoanPreflight {
  if (entered.teamId === LOAN_UNPICKED_VALUE) return { ok: false, code: LOAN_UNPICKED };

  const team = loanChoiceOf(choices, entered.teamId);

  if (team === undefined) return { ok: false, code: LOAN_STALE };
  if (!isIsoDate(entered.from)) return { ok: false, code: LOAN_FROM_INVALID };
  if (!isIsoDate(entered.to)) return { ok: false, code: LOAN_TO_INVALID };
  if (entered.to < entered.from) return { ok: false, code: LOAN_ORDER };

  const reason = loanReasonOf(entered.reason);

  if (reason === null) return { ok: false, code: LOAN_REASON };

  return { ok: true, draft: { memberId, teamId: team.id, from: entered.from, to: entered.to, reason } };
}

/** An amend as entered and preflighted: the reason is `null` to keep the stored one (design note 2). */
export interface LoanAmendDraft extends Omit<LoanDraft, 'reason'> {
  readonly reason: string | null;
}

export type LoanAmendPreflight =
  | { readonly ok: true; readonly draft: LoanAmendDraft }
  | { readonly ok: false; readonly code: LoanEntryRefusal };

/**
 * An amend's preflight: the lend's, but an empty *Razlog* keeps the stored
 * reason (`null`); a typed one is checked as the lend checks it.
 */
export function loanAmendPreflightOf(
  memberId: string,
  choices: readonly LoanChoice[] | null,
  entered: { readonly teamId: string; readonly from: string; readonly to: string; readonly reason: string },
  stored: Loan | null = null,
): LoanAmendPreflight {
  const kept = trimName(entered.reason) === '';
  // A placeholder reason passes the lend's check; `null` is what is sent.
  const preflight = loanPreflightOf(memberId, choices, kept ? { ...entered, reason: 'x' } : entered);

  if (!preflight.ok) return preflight;

  const { draft } = preflight;

  // NOTHING TO SAVE (review): the same team and dates and no new reason would
  // replace the row by an identical one and tell the member of nothing.
  if (kept && stored !== null && draft.teamId === stored.teamId && draft.from === stored.from && draft.to === stored.to) {
    return { ok: false, code: LOAN_UNCHANGED };
  }

  return { ok: true, draft: { ...draft, reason: kept ? null : draft.reason } };
}

// ------------------------------------------------------------- the "after"

/** The part of a draft the "after" reads: no reason. */
export type LoanSpan = Pick<LoanDraft, 'memberId' | 'teamId' | 'from' | 'to'>;

export type LoanChangeApplied =
  | { readonly ok: true; readonly after: CalendarSnapshot }
  | { readonly ok: false; readonly code: LoanSnapshotRefusal };

/**
 * The calendar snapshot as the loan would leave it — the draft appended to
 * the member's loans, and to the viewer's when the viewer is the member — or
 * the refusal the insert would meet anyway (see the module's header). A new
 * object, so the calendar's per-snapshot standings are worked out afresh.
 *
 * @throws RangeError on any precondition of `membershipOn` over the member's versions.
 */
export function loanChangeSnapshotOf(calendar: CalendarSnapshot, span: LoanSpan, replaces: string | null = null): LoanChangeApplied {
  if (span.to < span.from) return { ok: false, code: LOAN_ORDER };

  const member = calendar.members.find((candidate) => candidate.id === span.memberId);
  const team = calendar.teams.find((candidate) => candidate.id === span.teamId);

  if (member === undefined || team === undefined) return { ok: false, code: LOAN_STALE };
  // AN AMEND'S LOAN, gone meanwhile (removed or amended): 0064's `TEAM_LOAN_NOT_LIVE`.
  if (replaces !== null && !member.loans.some((loan) => loan.id === replaces)) return { ok: false, code: LOAN_STALE };
  if (team.archived) return { ok: false, code: LOAN_ARCHIVED };

  // THE HOME TEAM ON ANY COVERED DATE: the version in effect on `from`, or one
  // starting inside the range.
  const home =
    membershipOn(member.memberships, span.from)?.teamId === span.teamId ||
    member.memberships.some(
      (version) => version.effectiveFrom > span.from && version.effectiveFrom <= span.to && version.teamId === span.teamId,
    );

  if (home) return { ok: false, code: LOAN_HOME };

  // THE OTHER LIVE LOANS: an amend's own loan is removed before its replacement is inserted.
  const others = member.loans.filter((loan) => loan.id !== replaces);

  if (others.some((loan) => loan.from <= span.to && span.from <= loan.to)) return { ok: false, code: LOAN_OVERLAP };

  const draft: Loan = { id: LOAN_DRAFT_ID, teamId: span.teamId, from: span.from, to: span.to };

  return { ok: true, after: withLoansOf(calendar, member.id, [...others, draft]) };
}

/** `calendar` with `loans` as the member's (and the viewer's, when the viewer is the member). A new object. */
function withLoansOf(calendar: CalendarSnapshot, memberId: string, loans: readonly Loan[]): CalendarSnapshot {
  return {
    ...calendar,
    members: calendar.members.map((candidate) => (candidate.id === memberId ? { ...candidate, loans } : candidate)),
    viewer: calendar.viewer.memberId === memberId ? { ...calendar.viewer, loans } : calendar.viewer,
  };
}

/**
 * A change to a loan (story 18.4): the live loan it replaces (`null` for a
 * new loan) and the loan as it will stand (`null` for a removal). Never both
 * `null`.
 */
export interface LoanEdit {
  readonly memberId: string;
  readonly replaces: Loan | null;
  readonly span: LoanSpan | null;
}

/** A span read as the edit lending it; an edit as it is. */
export function loanEditOf(change: LoanSpan | LoanEdit): LoanEdit {
  return 'replaces' in change ? change : { memberId: change.memberId, replaces: null, span: change };
}

/**
 * The calendar snapshot as the edit would leave it, or the refusal its write
 * would meet anyway: a removal's loan gone meanwhile, or the member, is
 * {@link LOAN_STALE}; a lend or an amend is {@link loanChangeSnapshotOf}'s.
 *
 * @throws RangeError on any precondition of `membershipOn` over the member's versions.
 */
export function loanEditSnapshotOf(calendar: CalendarSnapshot, change: LoanSpan | LoanEdit): LoanChangeApplied {
  const edit = loanEditOf(change);

  if (edit.span !== null) return loanChangeSnapshotOf(calendar, edit.span, edit.replaces?.id ?? null);

  const member = calendar.members.find((candidate) => candidate.id === edit.memberId);
  const removed = edit.replaces;

  if (member === undefined || removed === null || !member.loans.some((loan) => loan.id === removed.id)) {
    return { ok: false, code: LOAN_STALE };
  }

  return { ok: true, after: withLoansOf(calendar, member.id, member.loans.filter((loan) => loan.id !== removed.id)) };
}

/**
 * The dates an edit changes, as one span: from the earlier first date to the
 * later last date of the replaced loan and the new one (a removal: the
 * removed loan; a lend: its own). The preview, the short-staffed block and
 * the erasure check read it. Its `teamId` is the new loan's, else the old.
 */
export function loanEditWindowOf(change: LoanSpan | LoanEdit): LoanSpan {
  const edit = loanEditOf(change);
  const ranges = [edit.replaces, edit.span].filter((range): range is Loan | LoanSpan => range !== null);
  const first = ranges.map((range) => range.from).sort()[0] ?? '';
  const last = ranges.map((range) => range.to).sort().at(-1) ?? '';

  return { memberId: edit.memberId, teamId: edit.span?.teamId ?? edit.replaces?.teamId ?? '', from: first, to: last };
}

/**
 * How many dates of the new loan the member is inactive on (deferred-work,
 * answered in 18.4: warned, never refused). The domain puts an inactive
 * member on no roster, so the loan changes nothing on those dates. An
 * amend counts only the dates its old loan did not cover. 0 for a removal,
 * or a member the snapshot lacks.
 *
 * @throws RangeError on any precondition of `activeOn` over the member's versions.
 */
export function loanInactiveDaysOf(calendar: CalendarSnapshot, change: LoanSpan | LoanEdit): number {
  const edit = loanEditOf(change);
  const member = calendar.members.find((candidate) => candidate.id === edit.memberId);

  if (edit.span === null || member === undefined) return 0;

  const old = edit.replaces;

  return datesBetween(edit.span.from, edit.span.to)
    .filter((date) => old === null || date < old.from || date > old.to)
    .filter((date) => !activeOn(member.statuses, date)).length;
}

// --------------------------------------------------------------- the preview

/** A working shift the member loses on a date, or gains. */
export const LOAN_LOST = 'lost';
export const LOAN_GAINED = 'gained';
export type LoanShiftSide = typeof LOAN_LOST | typeof LOAN_GAINED;

/** One working shift of the preview, as data: names as stored, the ISO date, the range or none. */
export interface LoanShift {
  readonly team: string;
  readonly date: string;
  readonly type: string;
  /** `19:00–07:00`, or `null` for a type with no times in effect that date. */
  readonly range: string | null;
}

export interface LoanShiftLine extends LoanShift {
  readonly side: LoanShiftSide;
}

/** Two working shifts of two teams at once (double booking). */
export interface LoanDoubleLine {
  readonly key: string;
  /** The earlier one's date. */
  readonly date: string;
  readonly first: { readonly team: string; readonly type: string };
  readonly second: { readonly team: string; readonly type: string };
}

/** Working shifts of two or more teams joined with no rest: one duty, FR-26's figure. */
export interface LoanRestGapLine {
  readonly key: string;
  /** The duty's first date. */
  readonly date: string;
  /** The teams in the order worked, each once in a row. */
  readonly teams: readonly string[];
  readonly totalMinutes: number;
}

/** One side of a roster override: the member's name, or `null` when the snapshot does not name them. */
export interface LoanPerson {
  readonly name: string | null;
}

/** A roster override that applies now and no longer would: kept, listed. */
export interface LoanInertLine {
  readonly key: string;
  readonly date: string;
  readonly team: string;
  /** The member taken off, or `null` for none. */
  readonly out: LoanPerson | null;
  /** The member put on, or `null` for none. */
  readonly in: LoanPerson | null;
}

/** *Što se mijenja* of a loan. */
export interface LoanPreview {
  /** The first {@link LOAN_SHOWN_SHIFTS}, by date, lost before gained on a date. */
  readonly shifts: readonly LoanShiftLine[];
  /** How many more shift lines there are. */
  readonly moreShifts: number;
  readonly doubles: readonly LoanDoubleLine[];
  readonly restGaps: readonly LoanRestGapLine[];
  readonly inert: readonly LoanInertLine[];
}

/** The preview the dialog shows: {@link LoanPreview}, and the dates of the new loan the member is inactive on. */
export interface ShownLoanPreview extends LoanPreview {
  readonly inactiveDays: number;
}

/** Every date from `from` to `to`, both included. */
function datesBetween(from: string, to: string): readonly string[] {
  const dates: string[] = [];

  for (let date: string | null = from; date !== null && date <= to; date = nextIsoDate(date)) dates.push(date);

  return dates;
}

/** The member's schedule day on each of `dates`, one month derivation per month, from `snapshot`. */
function scheduleDaysOf(snapshot: CalendarSnapshot, memberId: string, dates: readonly string[]): ReadonlyMap<string, MemberScheduleDay> {
  const member = snapshot.members.find((candidate) => candidate.id === memberId);

  if (member === undefined) throw new RangeError(`member ${memberId} is not in the snapshot`);

  const input = memberScheduleInputOf(snapshot, { memberId, memberships: member.memberships, statuses: member.statuses });
  const days = new Map<string, MemberScheduleDay>();

  for (const month of new Set(dates.map((date) => monthOf(date)))) {
    for (const day of memberScheduleOfMonth(input, month)) days.set(day.date, day);
  }

  return days;
}

/** The working shifts of a day, as `team\u0000type` keys and their team and type ids. */
function workingOf(snapshot: CalendarSnapshot, day: MemberScheduleDay | undefined): ReadonlyMap<string, { teamId: string; shiftTypeId: string }> {
  const working = new Map<string, { teamId: string; shiftTypeId: string }>();

  for (const shift of day?.shifts ?? []) {
    if (shift.shiftTypeId === null) continue;

    const type = snapshot.types.find((candidate) => candidate.id === shift.shiftTypeId);

    if (type?.isWorking !== true) continue;

    working.set(`${shift.teamId}\u0000${shift.shiftTypeId}`, { teamId: shift.teamId, shiftTypeId: shift.shiftTypeId });
  }

  return working;
}

function nameOf<Row extends { readonly id: string; readonly name: string }>(rows: readonly Row[], id: string, what: string): string {
  const row = rows.find((candidate) => candidate.id === id);

  if (row === undefined) throw new RangeError(`${what} ${id} is not in the snapshot`);

  return row.name;
}

function shiftOf(snapshot: CalendarSnapshot, teamId: string, shiftTypeId: string, date: string): LoanShift {
  const type = snapshot.types.find((candidate) => candidate.id === shiftTypeId);

  if (type === undefined) throw new RangeError(`shift type ${shiftTypeId} is not in the snapshot`);

  return { team: nameOf(snapshot.teams, teamId, 'team'), date, type: type.name, range: typeRangeOn(type, date) };
}

/** A leg of the "after", with what a line names. */
interface LoanLeg extends DutyLeg {
  readonly teamId: string;
  readonly shiftTypeId: string;
}

/** A snapshot's schedule input as `rosterOverridesMadeInertOf` reads it. */
function scheduleInputOf(snapshot: CalendarSnapshot): ScheduleInput {
  return { teamIds: snapshot.teams.map((team) => team.id), ...snapshotScheduleInputOf(snapshot) };
}

/**
 * *Što se mijenja* of the loan `span` (see the module's header) from `before`
 * and its one "after":
 * - per date of `[from, to]`, the working shifts the member loses and gains
 *   (by team and type, so an unchanged date says nothing; design note 3);
 * - with a leg over `[from − 1, to + 1]` in the "after", every two working
 *   legs of two different teams that overlap (double booking), and every
 *   duty (`dutiesOf`, its legs read {@link LOAN_DUTY_REACH_DAYS} days either
 *   side) joining legs of two different teams, with its total — each
 *   only when `before` does not already hold it over the same window (the
 *   same legs, by date, team and type), so a double shift an override made
 *   before the loan is not the loan's;
 * - every roster override in force, dated in the range, that applies before
 *   and not after (`rosterOverridesMadeInertOf`). Kept, never discarded.
 *
 * @throws RangeError on any precondition of the domain's derivations, or a
 *   member, team or shift type the snapshots lack.
 */
export function loanPreviewOf(before: CalendarSnapshot, after: CalendarSnapshot, span: LoanSpan): LoanPreview {
  const covered = datesBetween(span.from, span.to);
  const edges = [previousIsoDate(span.from), nextIsoDate(span.to)].filter((date): date is string => date !== null);
  // REPORTED over `[from − 1, to + 1]`; the legs are read further out
  // ({@link LOAN_DUTY_REACH_DAYS}), so a no-rest run crossing the window's
  // edge keeps its whole total and is cut alike on both sides. Outside
  // `[from, to]` both sides are the same, so a run or a double the loan makes
  // always has a leg in the reported window.
  const reported = new Set([...covered, ...edges]);
  const reach = (date: string, step: (date: string) => string | null): string[] => {
    const dates: string[] = [];

    for (let at = step(date), n = 0; at !== null && n < LOAN_DUTY_REACH_DAYS; at = step(at), n += 1) dates.push(at);

    return dates;
  };
  const window = [...new Set([...reach(span.from, previousIsoDate), ...covered, ...reach(span.to, nextIsoDate)])].sort();
  const inReported = (legs: readonly LoanLeg[]): boolean => legs.some((leg) => reported.has(leg.date));
  const was = scheduleDaysOf(before, span.memberId, window);
  const will = scheduleDaysOf(after, span.memberId, window);
  const lines: LoanShiftLine[] = [];

  for (const date of covered) {
    const lost = workingOf(before, was.get(date));
    const gained = workingOf(after, will.get(date));

    for (const [key, shift] of lost) {
      if (!gained.has(key)) lines.push({ side: LOAN_LOST, ...shiftOf(before, shift.teamId, shift.shiftTypeId, date) });
    }
    for (const [key, shift] of gained) {
      if (!lost.has(key)) lines.push({ side: LOAN_GAINED, ...shiftOf(after, shift.teamId, shift.shiftTypeId, date) });
    }
  }

  // THE SAME DERIVATION ON BOTH SIDES over the same window: only a double
  // booking or a no-rest duty the loan makes is said, never one already there.
  const legsOf = (snapshot: CalendarSnapshot, days: ReadonlyMap<string, MemberScheduleDay>): LoanLeg[] =>
    window.flatMap((date) =>
      [...workingOf(snapshot, days.get(date)).values()].flatMap((shift): LoanLeg[] => {
        const leg = shiftLegOn(snapshot, shift.shiftTypeId, date);

        return leg === null ? [] : [{ ...leg, teamId: shift.teamId, shiftTypeId: shift.shiftTypeId }];
      }),
    );
  const legKey = (leg: LoanLeg): string => JSON.stringify([leg.date, leg.teamId, leg.shiftTypeId]);
  const pairsOf = (legs: readonly LoanLeg[]) =>
    overlappingLegsOf(legs).filter(([first, second]) => first.teamId !== second.teamId);
  const dutiesAcrossOf = (legs: readonly LoanLeg[]) =>
    dutiesOf(legs).filter((duty) => new Set(duty.legs.map((leg) => leg.teamId)).size > 1);
  const legsBefore = legsOf(before, was);
  const legsAfter = legsOf(after, will);
  // ORDER-FREE: two legs with one start come in the day's shift order, which
  // may differ between the sides, so the same pair keys alike either way.
  const pairKey = ([first, second]: readonly [LoanLeg, LoanLeg]): string => JSON.stringify([legKey(first), legKey(second)].sort());
  const dutyKey = (duty: { readonly legs: readonly LoanLeg[] }): string => JSON.stringify(duty.legs.map(legKey));
  const pairsBefore = new Set(pairsOf(legsBefore).map(pairKey));
  const dutiesBefore = new Set(dutiesAcrossOf(legsBefore).map(dutyKey));
  const named = (leg: LoanLeg) => ({
    team: nameOf(after.teams, leg.teamId, 'team'),
    type: nameOf(after.types, leg.shiftTypeId, 'shift type'),
  });
  const doubles = pairsOf(legsAfter)
    .filter((pair) => inReported(pair) && !pairsBefore.has(pairKey(pair)))
    .map((pair): LoanDoubleLine => {
      const [first, second] = pair;

      return { key: pairKey(pair), date: first.date, first: named(first), second: named(second) };
    });
  const restGaps = dutiesAcrossOf(legsAfter)
    .filter((duty) => inReported(duty.legs) && !dutiesBefore.has(dutyKey(duty)))
    .map((duty): LoanRestGapLine => {
      const teams = duty.legs
        .map((leg) => nameOf(after.teams, leg.teamId, 'team'))
        .filter((team, index, all) => index === 0 || all[index - 1] !== team);
      const first = duty.legs[0] as LoanLeg;

      return { key: dutyKey(duty), date: first.date, teams, totalMinutes: duty.totalMinutes };
    });
  const members = new Map(before.members.map((member) => [member.id, member.name]));
  // A MEMBER THE SNAPSHOT LACKS is named by no one: the line stays, without the name.
  const personOf = (id: string | null): LoanPerson | null => (id === null ? null : { name: members.get(id) ?? null });
  const inert = rosterOverridesMadeInertOf(scheduleInputOf(before), scheduleInputOf(after), span.from, span.to).map(
    (override): LoanInertLine => ({
      key: override.id,
      date: override.date,
      team: nameOf(before.teams, override.teamId, 'team'),
      out: personOf(override.memberOutId),
      in: personOf(override.memberInId),
    }),
  );

  return {
    shifts: lines.slice(0, LOAN_SHOWN_SHIFTS),
    moreShifts: Math.max(lines.length - LOAN_SHOWN_SHIFTS, 0),
    doubles,
    restGaps,
    inert,
  };
}

/** The span the dialog's fields describe, or `null` while it describes none: no team, a bad date, a reversed range. */
export function enteredSpanOf(
  memberId: string,
  choices: readonly LoanChoice[] | null,
  teamValue: string,
  from: string,
  to: string,
): LoanSpan | null {
  const team = loanChoiceOf(choices, teamValue);

  if (team === undefined || !isIsoDate(from) || !isIsoDate(to) || to < from) return null;

  return { memberId, teamId: team.id, from, to };
}

/**
 * The longest span, in days, the dialog derives *Što se mijenja* and the
 * short-staffed block for. A year typed digit by digit passes through
 * centuries (`0002-10-12`); past this nothing is derived, and the save is
 * unaffected.
 */
export const LOAN_PREVIEW_MAX_DAYS = 366;

/** Whether the dialog derives anything for `span`: one of at most {@link LOAN_PREVIEW_MAX_DAYS} days. */
export function previewableSpanOf(span: LoanSpan | null): span is LoanSpan {
  return span !== null && daysBetween(span.from, span.to) + 1 <= LOAN_PREVIEW_MAX_DAYS;
}

/**
 * The preview the dialog shows, or `null` for none: no snapshot, no span, a
 * span longer than {@link LOAN_PREVIEW_MAX_DAYS}, a refused span, nothing
 * that changes, or a derivation that throws (logged, never rethrown: a
 * missing preview never gates the save).
 */
export function shownLoanPreviewOf(snapshot: CalendarSnapshot | null, change: LoanSpan | LoanEdit | null): ShownLoanPreview | null {
  const window = change === null ? null : loanEditWindowOf(change);

  if (snapshot === null || change === null || !previewableSpanOf(window)) return null;

  try {
    const applied = loanEditSnapshotOf(snapshot, change);

    if (!applied.ok) return null;

    const preview = { ...loanPreviewOf(snapshot, applied.after, window), inactiveDays: loanInactiveDaysOf(snapshot, change) };
    const empty =
      preview.shifts.length === 0 &&
      preview.doubles.length === 0 &&
      preview.restGaps.length === 0 &&
      preview.inert.length === 0 &&
      preview.inactiveDays === 0;

    return empty ? null : preview;
  } catch (cause) {
    console.error(LOAN_UNAVAILABLE, cause);

    return null;
  }
}

/**
 * What the loan newly leaves short of people (story 11.2), in BOTH teams,
 * over `[from, to]`: the one "after" over the organization's leave as
 * observed (`configurationReportOf`). `null` — no block — while the setting
 * is empty, there is no span, the span is longer than
 * {@link LOAN_PREVIEW_MAX_DAYS}, or it is refused; unknown (logged) on ANY
 * error, since it is derived while the dialog renders. Never a gate.
 */
export function shownLoanShortStaffedOf(
  snapshot: CalendarSnapshot | null,
  change: LoanSpan | LoanEdit | null,
  leave: StaffingLeaveSource | null,
): ShortStaffedReport | null {
  const window = change === null ? null : loanEditWindowOf(change);

  if (snapshot === null || change === null || !previewableSpanOf(window) || minimumOfCalendar(snapshot) === null) return null;

  try {
    const applied = loanEditSnapshotOf(snapshot, change);

    return applied.ok ? configurationReportOf(snapshot, applied.after, { from: window.from, to: window.to }, leave) : null;
  } catch (cause) {
    return unknownReportOf(cause);
  }
}

// ------------------------------------------------------- the erasure check

export type LoanErasureCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: LoanSnapshotRefusal }
  | { readonly kind: typeof CHECK_READY; readonly rows: readonly ErasureRow[] };

/**
 * THE ERASURE CHECK (AD-5): `read`'s three core reads, fresh; the same
 * "after" rebuilt over the fresh calendar; `erasuresOf` from `from`. Never
 * throws: anything that goes wrong is unavailable, and logged. A loan the
 * database would refuse anyway answers `refused` with its code.
 */
export async function loanErasureCheckOf(
  read: () => Promise<ErasureReads>,
  change: LoanSpan | LoanEdit,
  online: boolean,
): Promise<LoanErasureCheck> {
  const window = loanEditWindowOf(change);

  return checkedOf(
    read,
    ({ calendar, records, resolutions }): LoanErasureCheck => {
      const applied = loanEditSnapshotOf(calendar, change);

      if (!applied.ok) return { kind: CHECK_REFUSED, code: applied.code };

      const outcome = erasuresOutcomeOf(() => erasuresOf(calendar, applied.after, window.from, records, resolutions));

      return outcome.ok ? { kind: CHECK_READY, rows: outcome.rows } : { kind: CHECK_UNAVAILABLE };
    },
    online,
  );
}

// ----------------------------------------------------------------- the write

export interface LoanWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | null | undefined;
}

export interface LoanWriteAnswer {
  readonly error: LoanWriteError | null;
}

/** `insert` AND NOTHING ELSE: no update, no delete, no upsert (0062 grants none). */
export interface LoanTable {
  insert(values: Readonly<Record<string, unknown>>): PromiseLike<LoanWriteAnswer>;
}

export type LoanWriteOutcome = { readonly ok: true } | { readonly ok: false; readonly code: LoanWriteFailure };

const INSUFFICIENT_PRIVILEGE = '42501';
const NO_DATA_FOUND = 'P0002';
/** 0064's amend, refusing an archived or home team itself. */
const TEAM_REFUSED_MESSAGE = 'TEAM_LOAN_TEAM_REFUSED';
const EXCLUSION_VIOLATION = '23P01';
const CHECK_VIOLATION = '23514';
/** 0062's reason check, which a `23514` names. */
const REASON_CHECK = 'team_loans_reason_length';

/**
 * A refused INSERT (0062), as this application's own failure: `23P01` the
 * exclusion — a live loan of the member shares a date — `42501` the policy
 * (no active admin, or a loan to the home team or an archived team written
 * after the fresh check: the code cannot tell which, so its message names
 * all three and the screen re-reads the teams and members), `23514`
 * naming `team_loans_reason_length` the reason; everything else — another
 * range check, `22000`, `23503`, the unforeseen — {@link LOAN_FAILED}.
 */
export function loanWriteFailureOf(error: LoanWriteError): LoanWriteFailure {
  // 0064: the amended or removed loan is no longer live (`TEAM_LOAN_NOT_LIVE`),
  // or the amend's team was archived or became the member's own meanwhile
  // (`TEAM_LOAN_TEAM_REFUSED`, after the fresh check): the screen is behind.
  if (error.code === NO_DATA_FOUND) return LOAN_STALE;
  if (error.code === INSUFFICIENT_PRIVILEGE && error.message === TEAM_REFUSED_MESSAGE) return LOAN_STALE;
  if (error.code === EXCLUSION_VIOLATION) return LOAN_OVERLAP;
  if (error.code === INSUFFICIENT_PRIVILEGE) return LOAN_DENIED;
  if (error.code === CHECK_VIOLATION && `${error.message ?? ''} ${error.details ?? ''}`.includes(REASON_CHECK)) {
    return LOAN_REASON;
  }

  return LOAN_FAILED;
}

/**
 * Lend `draft.memberId` to `draft.teamId` from `draft.from` to `draft.to`,
 * both included, for `draft.reason` (0062's plain insert, as `recordLeave`
 * records leave). A date that is not a calendar date, or a reversed range,
 * is {@link LOAN_FAILED} without a request. Failures are logged; a refusal's
 * code is not a fault.
 */
export async function lendMember(table: LoanTable, organizationId: string, draft: LoanDraft): Promise<LoanWriteOutcome> {
  if (!isIsoDate(draft.from) || !isIsoDate(draft.to) || draft.to < draft.from) {
    console.error(LOAN_FAILED, 'not a calendar range');

    return { ok: false, code: LOAN_FAILED };
  }

  let answered: LoanWriteAnswer;

  try {
    answered = await table.insert({
      organization_id: organizationId,
      member_id: draft.memberId,
      team_id: draft.teamId,
      during: `[${draft.from},${draft.to}]`,
      reason: draft.reason,
    });
  } catch (cause) {
    console.error(LOAN_FAILED, cause);

    return { ok: false, code: LOAN_FAILED };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(LOAN_FAILED, typeof answered);

    return { ok: false, code: LOAN_FAILED };
  }

  const error: unknown = answered.error;

  if (error === null) return { ok: true };

  if (typeof error !== 'object') {
    console.error(LOAN_FAILED, typeof error);

    return { ok: false, code: LOAN_FAILED };
  }

  const code = loanWriteFailureOf(error as LoanWriteError);

  if (code === LOAN_FAILED) console.error(code, (error as LoanWriteError).code);

  return { ok: false, code };
}

/** 0064's two definers. */
export const AMEND_TEAM_LOAN_FUNCTION = 'amend_team_loan';
export const REMOVE_TEAM_LOAN_FUNCTION = 'remove_team_loan';

export interface LoanRpcAnswer {
  readonly data?: unknown;
  readonly error: LoanWriteError | null;
}

/** The two calls and nothing else. */
export interface LoanRpc {
  rpc(
    fn: typeof AMEND_TEAM_LOAN_FUNCTION,
    args: { p_loan_id: string; p_team_id: string; p_from: string; p_to: string; p_reason?: string },
  ): PromiseLike<LoanRpcAnswer>;
  rpc(fn: typeof REMOVE_TEAM_LOAN_FUNCTION, args: { p_loan_id: string }): PromiseLike<LoanRpcAnswer>;
}

type LoanCalled = { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly code: LoanWriteFailure };

/** A settled call: the answer, or the failure (logged unless it is a refusal's code). */
async function calledLoan(call: () => PromiseLike<LoanRpcAnswer>): Promise<LoanCalled> {
  let answered: LoanRpcAnswer;

  try {
    answered = await call();
  } catch (cause) {
    console.error(LOAN_FAILED, cause);

    return { ok: false, code: LOAN_FAILED };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(LOAN_FAILED, typeof answered);

    return { ok: false, code: LOAN_FAILED };
  }

  const error: unknown = answered.error;

  if (error === null) return { ok: true, data: answered.data };

  if (typeof error !== 'object') {
    console.error(LOAN_FAILED, typeof error);

    return { ok: false, code: LOAN_FAILED };
  }

  const code = loanWriteFailureOf(error as LoanWriteError);

  if (code === LOAN_FAILED) console.error(code, (error as LoanWriteError).code);

  return { ok: false, code };
}

/**
 * Amend the live loan `loanId` to `draft` (0064's `amend_team_loan`): the
 * team, the inclusive range and, unless `null` keeps the stored one, the
 * reason. Ending early is an earlier `to`. A bad range is
 * {@link LOAN_FAILED} without a request; a landed amend that names no
 * replacement is {@link LOAN_FAILED} too.
 */
export async function amendLoan(client: LoanRpc, loanId: string, draft: LoanAmendDraft): Promise<LoanWriteOutcome> {
  if (!isIsoDate(draft.from) || !isIsoDate(draft.to) || draft.to < draft.from) {
    console.error(LOAN_FAILED, 'not a calendar range');

    return { ok: false, code: LOAN_FAILED };
  }

  const called = await calledLoan(() =>
    client.rpc(AMEND_TEAM_LOAN_FUNCTION, {
      p_loan_id: loanId,
      p_team_id: draft.teamId,
      p_from: draft.from,
      p_to: draft.to,
      ...(draft.reason === null ? {} : { p_reason: draft.reason }),
    }),
  );

  if (!called.ok) return called;
  if (typeof called.data === 'string' && called.data !== '') return { ok: true };

  console.error(LOAN_FAILED, 'no replacement id');

  return { ok: false, code: LOAN_FAILED };
}

/** Remove the live loan `loanId` (0064's `remove_team_loan`): soft-removed, attributed to the caller. */
export async function removeLoan(client: LoanRpc, loanId: string): Promise<LoanWriteOutcome> {
  const called = await calledLoan(() => client.rpc(REMOVE_TEAM_LOAN_FUNCTION, { p_loan_id: loanId }));

  return called.ok ? { ok: true } : called;
}

/** A lend's write. */
export const LOAN_LEND = 'lend';
/** An amend's write: the dates, the team, ending early. */
export const LOAN_AMEND = 'amend';
/** A removal's write. */
export const LOAN_REMOVE = 'remove';

/** Which write: a lend, an amend or a removal. */
export type LoanWriteKind = typeof LOAN_LEND | typeof LOAN_AMEND | typeof LOAN_REMOVE;

/** What *Spremi* writes, once preflighted: the lend's insert, or one of 0064's two definers. */
export type LoanWrite =
  | { readonly kind: typeof LOAN_LEND; readonly draft: LoanDraft }
  | { readonly kind: typeof LOAN_AMEND; readonly loan: Loan; readonly draft: LoanAmendDraft }
  | { readonly kind: typeof LOAN_REMOVE; readonly memberId: string; readonly loan: Loan };

/** The edit a write makes: what its erasure check and preview derive. */
export function loanWriteEditOf(write: LoanWrite): LoanEdit {
  switch (write.kind) {
    case LOAN_LEND:
      return { memberId: write.draft.memberId, replaces: null, span: write.draft };
    case LOAN_AMEND:
      return { memberId: write.draft.memberId, replaces: write.loan, span: write.draft };
    case LOAN_REMOVE:
      return { memberId: write.memberId, replaces: write.loan, span: null };
  }
}

/** What a landed write says on the card. */
export function loanSavedMessageKey(kind: LoanWriteKind): 'loans.saved' | 'loans.amended' | 'loans.removed' {
  return kind === LOAN_LEND ? 'loans.saved' : kind === LOAN_AMEND ? 'loans.amended' : 'loans.removed';
}

// ------------------------------------------------------------ the member's loans

/** One live loan of the member as the card lists it: the loan, and its team's name (`null` when the read lacks it). */
export interface MemberLoan {
  readonly loan: Loan;
  readonly team: string | null;
}

/** The member's live loans in the snapshot, by first date: what the card offers to amend. Empty while unread. */
export function memberLoansOf(snapshot: CalendarSnapshot | null, memberId: string): readonly MemberLoan[] {
  const member = snapshot?.members.find((candidate) => candidate.id === memberId);

  if (snapshot === null || member === undefined) return [];

  return [...member.loans]
    .sort((first, second) => (first.from < second.from ? -1 : first.from > second.from ? 1 : 0))
    .map((loan) => ({ loan, team: snapshot.teams.find((team) => team.id === loan.teamId)?.name ?? null }));
}

/** Whether *Završi danas* applies: the loan has begun and ends after today. */
export function loanEndsTodayOfferedOf(loan: Loan, today: string | null): boolean {
  return today !== null && loan.from <= today && today < loan.to;
}

// ------------------------------------------------------------- the messages

/** The alert a refusal says. */
export function loanRefusalMessageKey(
  code: LoanRefusal,
):
  | 'loans.error.unpicked'
  | 'loans.error.from'
  | 'loans.error.to'
  | 'loans.error.order'
  | 'loans.error.reason'
  | 'loans.error.stale'
  | 'loans.error.archived'
  | 'loans.error.home'
  | 'loans.error.overlap'
  | 'loans.error.denied'
  | 'loans.error.failed'
  | 'loans.error.unchanged' {
  switch (code) {
    case LOAN_UNPICKED:
      return 'loans.error.unpicked';
    case LOAN_FROM_INVALID:
      return 'loans.error.from';
    case LOAN_TO_INVALID:
      return 'loans.error.to';
    case LOAN_ORDER:
      return 'loans.error.order';
    case LOAN_REASON:
      return 'loans.error.reason';
    case LOAN_STALE:
      return 'loans.error.stale';
    case LOAN_ARCHIVED:
      return 'loans.error.archived';
    case LOAN_HOME:
      return 'loans.error.home';
    case LOAN_OVERLAP:
      return 'loans.error.overlap';
    case LOAN_DENIED:
      return 'loans.error.denied';
    case LOAN_FAILED:
      return 'loans.error.failed';
    case LOAN_UNCHANGED:
      return 'loans.error.unchanged';
  }
}

/** The dialog field a refusal names, for its `aria-invalid` and focus; `null` for one about no field. */
export const LOAN_FIELD_TEAM = 'team';
export const LOAN_FIELD_FROM = 'from';
export const LOAN_FIELD_TO = 'to';
export const LOAN_FIELD_REASON = 'reason';
export type LoanField = typeof LOAN_FIELD_TEAM | typeof LOAN_FIELD_FROM | typeof LOAN_FIELD_TO | typeof LOAN_FIELD_REASON;

export function loanFieldOf(code: LoanRefusal): LoanField | null {
  switch (code) {
    case LOAN_UNPICKED:
      return LOAN_FIELD_TEAM;
    case LOAN_FROM_INVALID:
      return LOAN_FIELD_FROM;
    case LOAN_TO_INVALID:
    case LOAN_ORDER:
      return LOAN_FIELD_TO;
    case LOAN_REASON:
      return LOAN_FIELD_REASON;
    default:
      return null;
  }
}

/** A shift line's key: with the range, or without it for a type with no times that date. */
export function loanShiftMessageKey(
  line: LoanShiftLine,
): 'loans.lost' | 'loans.lostNoRange' | 'loans.gained' | 'loans.gainedNoRange' {
  if (line.side === LOAN_LOST) return line.range === null ? 'loans.lostNoRange' : 'loans.lost';

  return line.range === null ? 'loans.gainedNoRange' : 'loans.gained';
}

/** An inert override's key: by which sides it names. */
export function loanInertMessageKey(line: LoanInertLine): 'loans.inertSwap' | 'loans.inertOut' | 'loans.inertIn' {
  if (line.out !== null && line.in !== null) return 'loans.inertSwap';

  return line.out !== null ? 'loans.inertOut' : 'loans.inertIn';
}

/** A date as a line reads it: `čet` and `01.10.` (the ISO date only for one `isIsoDate` refuses, which none here is). */
export function loanDateValuesOf(date: string): { readonly weekday: string; readonly date: string } {
  return { weekday: formatIsoWeekdayShortName(date) ?? date, date: formatIsoDayMonth(date) ?? date };
}
