import {
  HOURS_FIGURE_LEAVE,
  HOURS_FIGURE_TOTAL,
  HOURS_SOURCE_CHANGE,
  HOURS_SOURCE_REPLACEMENT,
  HOURS_SOURCE_ROTATION,
  collisionKeyOf,
  explainMemberHours,
  memberScheduleOfMonth,
  type Collision,
  type CollisionResolution,
  type HoursFigureCode,
  type HoursSource,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf, type CalendarMemberHistory } from '@/features/calendar/utils/month';
import type { LeaveRecordsByMember } from '@/features/hours/services/hours-conflicts';
import {
  HOURS_UNAVAILABLE,
  figureOf,
  leaveDaysFigureOf,
  memberHoursInputOf,
  memberLeaveDatesOf,
  type HoursFigure,
  type LeaveDaysFigure,
} from '@/features/hours/services/my-hours';
import { t } from '@/lib/i18n';
import { formatIsoDate, formatList } from '@/lib/i18n/format';

/**
 * An hours figure explained (story 7.14; FR-42b): the shifts that compose it,
 * as the dialog behind a figure's ⓘ lists them.
 *
 * NO HOUR IS COMPUTED HERE (AD-3, AD-7, AD-8). The equation is
 * `explainMemberHours`'s — codes and operands over the same
 * `memberHoursInputOf` recipe the figures themselves use — and this only
 * gives its ids their names (teams and shift types as stored), its dates their
 * binding shape and its source code its words. The operands sum to the figure
 * exactly, so `total` is the domain's own minutes, never a sum made here.
 *
 * A SHIFT IN UNRESOLVED CONFLICT IS MARKED (FR-42b, as FR-41 marks it on the
 * view). The mark is a join, never a second collision rule: each line's
 * `(member, date, team)` is looked up among the unresolved collisions *Sati*
 * already holds (`hoursConflictsStateOf`'s), by the domain's own
 * `collisionKeyOf`. A resolved conflict is not among them, so it is not marked.
 *
 * THE LEAVE IS EXPLAINED IN DAYS, AND ONLY IN DAYS (human, 2026-10-10). Its
 * lines are the domain's charged leave dates (`leaveDaysOfMonth`, through
 * `memberLeaveDatesOf`), one per date, naming each working shift on it as
 * `team · type`, paired per shift, and adding `+1 dan`. The figure is the
 * domain's own: the count of those dates, `= 3 dana`, which the lines sum to.
 * A shift a conflict decision moved to leave appears only as its date's day,
 * never as hours, and its pair names the decision as its source word
 * (*Prihvaćeno kao nepokriveno*, *Zamjena osobe*) — the counterpart of the
 * `⚠` an unresolved one carries — so a decided date never passes unmarked. A
 * shift on a line in unresolved conflict is marked by its collision key, as
 * above. A charged date always has a working shift (R4.2): one that names
 * none is a derivation that disagrees with itself, and the dialog says it
 * cannot be shown. The pairs are joined as the locale lists things.
 */

/** Which figure, of whom: `memberId` `null` is the viewer's own. */
export interface HoursExplainRequest {
  readonly memberId: string | null;
  readonly figure: HoursFigureCode;
}

/** An equation of hours: the total's or a band's. */
export const EXPLANATION_HOURS = 'hours';
/** The leave's equation, in days. */
export const EXPLANATION_LEAVE = 'leave';

/** A decision that moved a shift to leave, as a leave line names it. */
export const LEAVE_DECISION_ACCEPTED = 'accept_uncovered';
export const LEAVE_DECISION_REPLACED = 'replace_member';
export type LeaveDecision = typeof LEAVE_DECISION_ACCEPTED | typeof LEAVE_DECISION_REPLACED;

/** What every line has: when, what stands on the date, and whether it is in unresolved conflict. */
interface ExplanationLineBase {
  /** Unique within the equation: a shift is one date on one team, a leave line one date. */
  readonly key: string;
  /** `23.09.2026`. */
  readonly date: string;
  /**
   * What stands on the date, as stored: a shift's `Smjena A · Dan · rotacija`;
   * on a leave line each shift's `Smjena A · Dan`, team and type paired per
   * shift — with the decision as its source word on a decided shift — listed
   * as the locale lists things.
   */
  readonly label: string;
  /** Whether a shift on this line is in an unresolved conflict, as the view counts it. */
  readonly conflict: boolean;
}

/** One shift of an hours equation, and the hours it adds. */
export interface HoursExplanationLine extends ExplanationLineBase {
  /** Where the shift came from. */
  readonly source: HoursSource;
  readonly amount: HoursFigure;
}

/** One charged date of the leave's equation, and the `1 dan` it adds. */
export interface LeaveExplanationLine extends ExplanationLineBase {
  /** The decisions that moved a shift on the date to leave, in shift order; none for an undecided date. */
  readonly decisions: readonly LeaveDecision[];
  readonly amount: LeaveDaysFigure;
}

/** What every dialog has: the figure's name and whose month. */
interface ExplanationViewBase {
  /** The figure's name: `Ukupno sati`, a band's name as stored, `Godišnji odmor`. */
  readonly figureName: string;
  /** Whose figure and which month: `Ivan Horvat · Rujan 2026.`, the month alone for the viewer's own. */
  readonly context: string;
}

/** The dialog's content, by the kind of figure: hours, or the leave in days. */
export type HoursExplanationView =
  | (ExplanationViewBase & {
      readonly kind: typeof EXPLANATION_HOURS;
      /** The figure, which the lines sum to. */
      readonly total: HoursFigure;
      /** In date order; none for a figure of 0. */
      readonly lines: readonly HoursExplanationLine[];
    })
  | (ExplanationViewBase & {
      readonly kind: typeof EXPLANATION_LEAVE;
      /** The days, `3 dana`, which the lines sum to. */
      readonly total: LeaveDaysFigure;
      /** In date order; none for no charged day. */
      readonly lines: readonly LeaveExplanationLine[];
    });

/** The words a decision reads as on a leave line: the resolved queue's own. */
export function leaveDecisionMessageKey(
  decision: LeaveDecision,
): 'raspored.resolved.accept_uncovered' | 'raspored.resolved.replace_memberUnknown' {
  switch (decision) {
    case LEAVE_DECISION_ACCEPTED:
      return 'raspored.resolved.accept_uncovered';
    case LEAVE_DECISION_REPLACED:
      return 'raspored.resolved.replace_memberUnknown';
  }
}

/**
 * The words a source code reads as. Exhaustive: a new domain code is a
 * compile error here.
 */
export function hoursSourceMessageKey(
  source: HoursSource,
): 'sati.explain.source.rotation' | 'sati.explain.source.change' | 'sati.explain.source.replacement' {
  switch (source) {
    case HOURS_SOURCE_ROTATION:
      return 'sati.explain.source.rotation';
    case HOURS_SOURCE_CHANGE:
      return 'sati.explain.source.change';
    case HOURS_SOURCE_REPLACEMENT:
      return 'sati.explain.source.replacement';
  }
}

/** The snapshot's names and the unresolved collisions, as a line reads them. */
interface LineNames {
  readonly teams: ReadonlyMap<string, string>;
  readonly types: ReadonlyMap<string, string>;
  readonly inConflict: ReadonlySet<string>;
}

/** A team's and a shift type's names as stored. @throws RangeError for one the snapshot lacks. */
function namesOf(names: LineNames, teamId: string, shiftTypeId: string): { readonly team: string; readonly shiftType: string } {
  const team = names.teams.get(teamId);
  const shiftType = names.types.get(shiftTypeId);

  if (team === undefined) throw new RangeError(`team ${teamId} is not in the snapshot`);
  if (shiftType === undefined) throw new RangeError(`shift type ${shiftTypeId} is not in the snapshot`);

  return { team, shiftType };
}

/** A date as the dialog reads it. @throws RangeError for one the locale cannot name. */
function dateOf(date: string): string {
  const shown = formatIsoDate(date);

  if (shown === null) throw new RangeError(`the date ${date}`);

  return shown;
}

/**
 * The explanation of `request` for the month `month` (`YYYY-MM`) shown, or
 * `null` when the domain refuses it (a `RangeError`, logged) or the member is
 * not in the snapshot — the dialog then says it cannot be shown, never a
 * guess. `collisions` are the unresolved ones the view counts; a line whose
 * shift is among them is marked. `leaveRecords` are the records the leave
 * figure counted its days from, `null` while the leave read is not ready:
 * the leave is then `null` too, never a figure of no records. `acceptedKeys`
 * are those of `leaveKeys` accepted as uncovered; the rest were replaced.
 */
export function hoursExplanationOf(
  snapshot: CalendarSnapshot,
  request: HoursExplainRequest,
  month: { readonly month: string; readonly monthName: string; readonly year: string },
  leaveKeys: readonly CollisionResolution[],
  collisions: readonly Collision[],
  leaveRecords: LeaveRecordsByMember | null,
  acceptedKeys: readonly CollisionResolution[],
): HoursExplanationView | null {
  const memberId = request.memberId ?? snapshot.viewer.memberId;
  const member = snapshot.members.find((one) => one.id === memberId) ?? null;
  const history = memberId === snapshot.viewer.memberId ? snapshot.viewer : member === null ? null : { ...member, memberId: member.id };

  if (history === null) return null;

  try {
    const names: LineNames = {
      teams: new Map(snapshot.teams.map((team) => [team.id, team.name])),
      types: new Map(snapshot.types.map((type) => [type.id, type.name])),
      inConflict: new Set(collisions.map(collisionKeyOf)),
    };
    const monthText = t('sati.explain.month', { month: month.monthName, year: month.year });
    const context =
      member === null || request.memberId === null ? monthText : t('sati.explain.memberMonth', { name: member.name, month: monthText });
    const figureName = figureNameOf(snapshot, request.figure);

    if (request.figure.code === HOURS_FIGURE_LEAVE) {
      // The leave read is not ready: the dialog's unavailable state, never a leave of no records.
      if (leaveRecords === null) return null;

      const decided: Decided = {
        leave: new Set(leaveKeys.map(collisionKeyOf)),
        accepted: new Set(acceptedKeys.map(collisionKeyOf)),
      };

      return {
        kind: EXPLANATION_LEAVE,
        figureName,
        context,
        ...leaveEquationOf(snapshot, history, leaveRecords, month.month, names, decided),
      };
    }

    const explanation = explainMemberHours(memberHoursInputOf(snapshot, history, leaveKeys), month.month, request.figure);
    const lines = explanation.operands.map((operand): HoursExplanationLine => {
      const { team, shiftType } = namesOf(names, operand.teamId, operand.shiftTypeId);

      return {
        key: `${operand.date}|${operand.teamId}`,
        date: dateOf(operand.date),
        label: t('sati.explain.line', { team, shiftType, source: t(hoursSourceMessageKey(operand.source)) }),
        source: operand.source,
        amount: figureOf(operand.minutes),
        conflict: names.inConflict.has(collisionKeyOf({ memberId, date: operand.date, teamId: operand.teamId })),
      };
    });

    return { kind: EXPLANATION_HOURS, figureName, context, total: figureOf(explanation.minutes), lines };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(HOURS_UNAVAILABLE, cause);

    return null;
  }
}

/** The decided keys, by `collisionKeyOf`: every one moved to leave, and those accepted as uncovered. */
interface Decided {
  readonly leave: ReadonlySet<string>;
  readonly accepted: ReadonlySet<string>;
}

/**
 * The leave's equation: one line per charged date of `month` — the domain's
 * dates, never a count made here — in date order. Each names the working
 * shifts on its date as `team · type`, paired per shift, with the decision as
 * the source word of a shift a conflict decision moved to leave, and adds
 * `1 dan`. The total is the domain's: the dates' count, which the lines sum
 * to.
 *
 * @throws RangeError on any precondition of the domain; a team, shift type
 *   or date the snapshot or the locale cannot name; and a charged date with
 *   no working shift, which R4.2 cannot charge.
 */
function leaveEquationOf(
  snapshot: CalendarSnapshot,
  history: CalendarMemberHistory,
  leaveRecords: LeaveRecordsByMember,
  month: string,
  names: LineNames,
  decided: Decided,
): { readonly total: LeaveDaysFigure; readonly lines: readonly LeaveExplanationLine[] } {
  const charged = memberLeaveDatesOf(snapshot, history, leaveRecords, month);
  const total = leaveDaysFigureOf(charged.length);

  if (charged.length === 0) return { total, lines: [] };

  const input = memberScheduleInputOf(snapshot, history);
  const working = new Set(input.workingShiftTypeIds);
  const schedule = new Map(memberScheduleOfMonth(input, month).map((day) => [day.date, day]));

  const lines = charged.map((date): LeaveExplanationLine => {
    const shifts = new Map<string, { readonly teamId: string; readonly shiftTypeId: string }>();

    for (const shift of schedule.get(date)?.shifts ?? []) {
      if (shift.shiftTypeId !== null && working.has(shift.shiftTypeId)) {
        shifts.set(`${shift.teamId}:${shift.shiftTypeId}`, { teamId: shift.teamId, shiftTypeId: shift.shiftTypeId });
      }
    }

    if (shifts.size === 0) throw new RangeError(`the charged leave date ${date} has no working shift`);

    const decisions: LeaveDecision[] = [];
    const pairs = [...shifts.values()].map((shift) => {
      const key = collisionKeyOf({ memberId: history.memberId, date, teamId: shift.teamId });
      const pair = namesOf(names, shift.teamId, shift.shiftTypeId);

      if (!decided.leave.has(key)) return t('sati.explain.leaveLine', pair);

      const decision = decided.accepted.has(key) ? LEAVE_DECISION_ACCEPTED : LEAVE_DECISION_REPLACED;

      decisions.push(decision);

      return t('sati.explain.line', { ...pair, source: t(leaveDecisionMessageKey(decision)) });
    });

    return {
      key: date,
      date: dateOf(date),
      label: formatList(pairs),
      decisions,
      amount: leaveDaysFigureOf(1),
      conflict: [...shifts.values()].some((shift) =>
        names.inConflict.has(collisionKeyOf({ memberId: history.memberId, date, teamId: shift.teamId })),
      ),
    };
  });

  return { total, lines };
}

/** The figure's name: the total's and the leave's words, a band's name as stored. */
function figureNameOf(snapshot: CalendarSnapshot, figure: HoursFigureCode): string {
  if (figure.code === HOURS_FIGURE_TOTAL) return t('sati.total');
  if (figure.code === HOURS_FIGURE_LEAVE) return t('sati.leave');

  const band = snapshot.bands.find((one) => one.id === figure.bandId);

  if (band === undefined) throw new RangeError(`hour band ${figure.bandId} is not in the snapshot`);

  return band.name;
}
