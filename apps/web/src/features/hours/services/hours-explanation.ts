import {
  HOURS_FIGURE_LEAVE,
  HOURS_FIGURE_TOTAL,
  HOURS_SOURCE_CHANGE,
  HOURS_SOURCE_REPLACEMENT,
  HOURS_SOURCE_ROTATION,
  collisionKeyOf,
  explainMemberHours,
  type Collision,
  type CollisionResolution,
  type HoursFigureCode,
  type HoursSource,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { HOURS_UNAVAILABLE, figureOf, memberHoursInputOf, type HoursFigure } from '@/features/hours/services/my-hours';
import { t } from '@/lib/i18n';
import { formatIsoDate } from '@/lib/i18n/format';

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
 */

/** Which figure, of whom: `memberId` `null` is the viewer's own. */
export interface HoursExplainRequest {
  readonly memberId: string | null;
  readonly figure: HoursFigureCode;
}

/** One shift of the equation: when, where, what, how it came to be, and the hours it adds. */
export interface HoursExplanationLine {
  /** Unique within the equation: a shift is one date on one team. */
  readonly key: string;
  /** `23.09.2026`. */
  readonly date: string;
  readonly team: string;
  readonly shiftType: string;
  readonly source: HoursSource;
  readonly hours: HoursFigure;
  /** Whether this shift is in an unresolved conflict, as the view counts it. */
  readonly conflict: boolean;
}

/** The dialog's content. */
export interface HoursExplanationView {
  /** The figure's name: `Ukupno sati`, a band's name as stored, `Godišnji odmor`. */
  readonly figureName: string;
  /** Whose figure and which month: `Ivan Horvat · Rujan 2026.`, the month alone for the viewer's own. */
  readonly context: string;
  /** The figure, which the lines sum to. */
  readonly total: HoursFigure;
  /** In date order; none for a figure of 0. */
  readonly lines: readonly HoursExplanationLine[];
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

/**
 * The explanation of `request` for the month `month` (`YYYY-MM`) shown, or
 * `null` when the domain refuses it (a `RangeError`, logged) or the member is
 * not in the snapshot — the dialog then says it cannot be shown, never a
 * guess. `collisions` are the unresolved ones the view counts; a line whose
 * shift is among them is marked.
 */
export function hoursExplanationOf(
  snapshot: CalendarSnapshot,
  request: HoursExplainRequest,
  month: { readonly month: string; readonly monthName: string; readonly year: string },
  leaveKeys: readonly CollisionResolution[],
  collisions: readonly Collision[],
): HoursExplanationView | null {
  const memberId = request.memberId ?? snapshot.viewer.memberId;
  const member = snapshot.members.find((one) => one.id === memberId) ?? null;
  const history = memberId === snapshot.viewer.memberId ? snapshot.viewer : member === null ? null : { ...member, memberId: member.id };

  if (history === null) return null;

  try {
    const explanation = explainMemberHours(memberHoursInputOf(snapshot, history, leaveKeys), month.month, request.figure);
    const teams = new Map(snapshot.teams.map((team) => [team.id, team.name]));
    const types = new Map(snapshot.types.map((type) => [type.id, type.name]));
    const inConflict = new Set(collisions.map(collisionKeyOf));
    const lines = explanation.operands.map((operand): HoursExplanationLine => {
      const team = teams.get(operand.teamId);
      const shiftType = types.get(operand.shiftTypeId);
      const date = formatIsoDate(operand.date);

      if (team === undefined) throw new RangeError(`team ${operand.teamId} is not in the snapshot`);
      if (shiftType === undefined) throw new RangeError(`shift type ${operand.shiftTypeId} is not in the snapshot`);
      if (date === null) throw new RangeError(`the date ${operand.date}`);

      return {
        key: `${operand.date}|${operand.teamId}`,
        date,
        team,
        shiftType,
        source: operand.source,
        hours: figureOf(operand.minutes),
        conflict: inConflict.has(collisionKeyOf({ memberId, date: operand.date, teamId: operand.teamId })),
      };
    });
    const monthText = t('sati.explain.month', { month: month.monthName, year: month.year });

    return {
      figureName: figureNameOf(snapshot, request.figure),
      context: member === null || request.memberId === null ? monthText : t('sati.explain.memberMonth', { name: member.name, month: monthText }),
      total: figureOf(explanation.minutes),
      lines,
    };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(HOURS_UNAVAILABLE, cause);

    return null;
  }
}

/** The figure's name: the total's and the leave's words, a band's name as stored. */
function figureNameOf(snapshot: CalendarSnapshot, figure: HoursFigureCode): string {
  if (figure.code === HOURS_FIGURE_TOTAL) return t('sati.total');
  if (figure.code === HOURS_FIGURE_LEAVE) return t('sati.leave');

  const band = snapshot.bands.find((one) => one.id === figure.bandId);

  if (band === undefined) throw new RangeError(`hour band ${figure.bandId} is not in the snapshot`);

  return band.name;
}
