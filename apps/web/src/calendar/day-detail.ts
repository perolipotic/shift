import { scheduledShiftTypeOn, shiftRoster } from '@shift/domain';

import { typeRangeOn, weekdayOf } from '@/calendar/month';
import type { CalendarSnapshot } from '@/calendar/snapshot';
import { compareText, formatDate, formatIsoDate, formatTime } from '@/i18n/format';
import type { ShiftTypeRow } from '@/shift-types/list';

/**
 * One team on one date, opened from the calendar (story 3.4b; CAP-11, AD-2):
 * the team, the date, the shift type it works, that type's times and who is
 * rostered on it.
 *
 * PURE, and executed by the node suite (AD-15): `routes/kalendar.tsx` renders
 * the Dialog and nothing else.
 *
 * NOTHING IS DERIVED TWICE. The type is `scheduledShiftTypeOn`'s answer, as
 * the grid's is — the projection with the day's shift-type override applied
 * over it (story 3.5a) — so the kind, the type and the range follow the type
 * the team WORKED; the range is `typeRangeOn`, the one derivation a cell
 * reads; the roster is `shiftRoster`'s, the team's members active on the
 * date. This module only names and orders.
 *
 * AN OVERRIDE IS ATTRIBUTED (story 3.5a): its author (named through the
 * snapshot's members), when it was saved (in the organization's zone), its
 * reason and the projected type it replaced — on every kind.
 *
 * RANK AND POSITION ARE CARRIED, NEVER USED: they ride along for the screen to
 * show where the organization uses them, and nothing here orders, filters or
 * decides by them. The roster is ordered by name alone.
 *
 * READ-ONLY: it reads the snapshot the calendar already holds, under its one
 * query key, and writes nothing.
 */

/** The team works a type that day. */
export const DAY_WORKING = 'working';

/** The team's type that day is a non-working one. */
export const DAY_OFF = 'off';

/** No rotation version of the team is in effect that day. */
export const DAY_NO_ROTATION = 'noRotation';

/** What the team does that day: works a type, has a non-working type, or has no rotation yet. */
export type DayDetailKind = typeof DAY_WORKING | typeof DAY_OFF | typeof DAY_NO_ROTATION;

/** One member rostered on the day: shown as `Ime · čin · položaj`. */
export interface DayDetailMember {
  readonly id: string;
  readonly name: string;
  /** Shown, never used; `null` is no rank. */
  readonly fireRank: string | null;
  /** Their position in the team on that date; shown, never used. */
  readonly position: string | null;
}

/** The day detail's `<dialog>` element's id. */
export const DAY_DETAIL_DIALOG_ID = 'kalendar-detail';

/** What an opener of the day detail announces: `aria-haspopup`, a Dialog. */
export const DAY_DETAIL_POPUP = 'dialog';

/** When an override was saved, in the organization's zone: `12.09.2026` and `19:05`. */
export interface DayDetailSavedAt {
  readonly date: string;
  readonly time: string;
}

/** The shift-type override on the day, as the detail names it (story 3.5a). */
export interface DayDetailOverride {
  /** The type the rotation projects that day, which the override replaced; a non-working one included. */
  readonly projectedTypeName: string;
  /** Who saved it; `null` when they are no member the snapshot holds (`kalendar.detail.override.unknownAuthor`). */
  readonly authorName: string | null;
  readonly savedAt: DayDetailSavedAt;
  readonly reason: string;
}

/** The day detail, ready to render. */
export interface DayDetail {
  readonly teamId: string;
  readonly teamName: string;
  /** `subota 26.09.2026`: the calendar's own weekday wording, and the date in the binding shape, year included. */
  readonly date: string;
  readonly kind: DayDetailKind;
  /** The type's name; `null` unless the kind is `working`. */
  readonly typeName: string | null;
  /** `19:00–07:00`; `null` unless the kind is `working` (and `null` for a working type with no times). */
  readonly range: string | null;
  /** The team's members active on the date, by name then id; empty unless the kind is `working`. */
  readonly roster: readonly DayDetailMember[];
  /** The override on the day, whatever the kind; `null` for none (and always with no rotation). */
  readonly override: DayDetailOverride | null;
}

function compareMembers(left: DayDetailMember, right: DayDetailMember): number {
  const byName = compareText(left.name, right.name);

  if (byName !== 0) return byName;

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * The detail of `teamId` on `date` (`YYYY-MM-DD`), or `null` for a team the
 * snapshot does not hold — the screen then closes the Dialog. Archived teams
 * are held, so a day list's past team still opens.
 *
 * @throws RangeError on any precondition of `scheduledShiftTypeOn`,
 *   `shiftRoster` or `typeRangeOn`, a type the snapshot lacks, a rostered
 *   member the snapshot lacks, or a date that cannot be formatted.
 */
export function dayDetailOf(snapshot: CalendarSnapshot, teamId: string, date: string): DayDetail | null {
  const team = snapshot.teams.find((one) => one.id === teamId);

  if (team === undefined) return null;

  const scheduled = scheduledShiftTypeOn(
    snapshot.assignments.filter((assignment) => assignment.teamId === teamId),
    snapshot.steps,
    snapshot.overrides,
    teamId,
    date,
  );
  const full = formatIsoDate(date);

  if (full === null) throw new RangeError(`the date ${date} could not be formatted`);

  const base = { teamId, teamName: team.name, date: `${weekdayOf(date)} ${full}` };

  if (scheduled === null) {
    return { ...base, kind: DAY_NO_ROTATION, typeName: null, range: null, roster: [], override: null };
  }

  const type = typeOf(snapshot, scheduled.shiftTypeId, date);
  const override = scheduled.overridden
    ? overrideOf(snapshot, teamId, date, typeOf(snapshot, scheduled.projectedShiftTypeId, date).name)
    : null;

  if (!type.isWorking) {
    return { ...base, kind: DAY_OFF, typeName: null, range: null, roster: [], override };
  }

  const members = new Map(snapshot.members.map((member) => [member.id, member]));
  const roster = shiftRoster(snapshot.members, teamId, date).map((entry): DayDetailMember => {
    const member = members.get(entry.memberId);

    if (member === undefined) throw new RangeError(`member ${entry.memberId} is rostered but is not in the snapshot`);

    return { id: member.id, name: member.name, fireRank: member.fireRank, position: entry.position };
  });

  return {
    ...base,
    kind: DAY_WORKING,
    typeName: type.name,
    range: typeRangeOn(type, date),
    roster: roster.sort(compareMembers),
    override,
  };
}

/**
 * A type of the snapshot by id.
 *
 * @throws RangeError for a type the snapshot lacks — never a raw id as a
 *   label, as `cellOf` refuses it.
 */
function typeOf(snapshot: CalendarSnapshot, shiftTypeId: string, date: string): ShiftTypeRow {
  const type = snapshot.types.find((one) => one.id === shiftTypeId);

  if (type === undefined) {
    throw new RangeError(`shift type ${shiftTypeId} is scheduled on ${date} but is not in the snapshot`);
  }

  return type;
}

/**
 * The override of `teamId` on `date`, as the detail names it: its author
 * through the snapshot's members (`null` for one it does not hold), its time
 * in the organization's zone, its reason, and `projectedTypeName`.
 *
 * @throws RangeError when the snapshot holds no override of the team on the
 *   date, or its time is not an instant.
 */
function overrideOf(
  snapshot: CalendarSnapshot,
  teamId: string,
  date: string,
  projectedTypeName: string,
): DayDetailOverride {
  const override = snapshot.overrides.find((one) => one.teamId === teamId && one.date === date);

  if (override === undefined) throw new RangeError(`team ${teamId} is overridden on ${date} by no override`);

  const saved = new Date(override.createdAt);

  if (Number.isNaN(saved.getTime())) {
    throw new RangeError(`the override of team ${teamId} on ${date} was saved at ${override.createdAt}`);
  }

  const author =
    override.authorMemberId === null
      ? undefined
      : snapshot.members.find((member) => member.id === override.authorMemberId);

  return {
    projectedTypeName,
    authorName: author?.name ?? null,
    savedAt: { date: formatDate(saved, snapshot.timeZone), time: formatTime(saved, snapshot.timeZone) },
    reason: override.reason,
  };
}

/** The day open in the detail: a team on a date. */
export interface OpenedDay {
  readonly teamId: string;
  readonly date: string;
}

/**
 * What the Dialog shows for the day `opened`, reconciled with the snapshot the
 * calendar holds NOW (story 3.4b): the detail, re-derived on every refetch, or
 * `null`; and whether the screen must CLOSE — forget the day, so the Dialog
 * never reopens by itself once data returns. It closes when there is no
 * snapshot (a refetch failed, or the session is offline), when the team is
 * gone, and when the derivation throws (the cause is logged; the grid reports
 * the same failure as the read failure). Nothing open is nothing to close.
 */
export interface DayDetailShown {
  readonly detail: DayDetail | null;
  readonly close: boolean;
}

export function dayDetailShownOf(snapshot: CalendarSnapshot | null, opened: OpenedDay | null): DayDetailShown {
  if (opened === null) return { detail: null, close: false };
  if (snapshot === null) return { detail: null, close: true };

  try {
    const detail = dayDetailOf(snapshot, opened.teamId, opened.date);

    return { detail, close: detail === null };
  } catch (cause) {
    console.error(cause);

    return { detail: null, close: true };
  }
}
