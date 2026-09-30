import { rosterOn, scheduledShiftTypeOn } from '@shift/domain';

import {
  overrideStandingOfCalendar,
  rosterStandingOfCalendar,
  typeRangeOn,
  weekdayOf,
} from '@/features/calendar/utils/month';
import type {
  CalendarOverride,
  CalendarRosterOverride,
  CalendarSnapshot,
} from '@/features/calendar/services/snapshot';
import { compareText, formatDate, formatIsoDate, formatTime } from '@/lib/i18n/format';
import type { ShiftTypeRow } from '@/features/shift-types/services/list';

/**
 * One team on one date, opened from the calendar (story 3.4b; CAP-11, AD-2):
 * the team, the date, the shift type it works, that type's times and who is
 * rostered on it.
 *
 * PURE, and executed by the node suite (AD-15): `pages/kalendar.tsx` renders
 * the Dialog and nothing else.
 *
 * NOTHING IS DERIVED TWICE. The type is `scheduledShiftTypeOn`'s answer, as
 * the grid's is — the projection with the day's shift-type override applied
 * over it (story 3.5a) — so the kind, the type and the range follow the type
 * the team WORKED; the range is `typeRangeOn`, the one derivation a cell
 * reads; the roster is `rosterOn`'s, the team's members active on the date
 * with the roster overrides in force applied (story 3.6a). This module only
 * names and orders.
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
 *
 * WHAT AN ADMIN MAY SET (story 3.5b) is decided here too, from the same
 * answer: the day's projected type (`projectedShiftTypeId`, the domain's), the
 * types the form offers ({@link overrideTypeOptionsOf}) and the browser's
 * preflight of an entry ({@link overrideEntryOf}). The database's checks and
 * its partial key stay authoritative; these only spare a request.
 *
 * AN OVERRIDE A ROTATION CHANGE LEFT PENDING (story 3.5c) is not applied: the
 * type is the projection's, with no `✎`, and the detail says the override is
 * waiting for review — its type, reason and author — in `pending`. Which are
 * pending is `overrideStandingOf`'s answer from `@shift/domain`. The admin is
 * offered only its removal here; confirming and amending are the rotation
 * builder's.
 *
 * A ROSTER OVERRIDE IS LISTED (story 3.6a): each one that applied on the
 * day — an addition, a removal or a replacement — with its author, time and
 * reason, and each one pending review apart, under its own heading. One that
 * applies to nothing (an inert one) is shown nowhere: in this story only
 * seeds write them, and 3.6b's removal will list it.
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
  /**
   * `null` for a member put on by a roster override whom the snapshot does
   * not hold (`kalendar.detail.override.unknownAuthor`, story 3.6a).
   */
  readonly name: string | null;
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
  /** The override's id, which a removal names (story 3.5b). */
  readonly id: string;
  /** The type the rotation projects that day, which the override replaced; a non-working one included. */
  readonly projectedTypeName: string;
  /** Who saved it; `null` when they are no member the snapshot holds (`kalendar.detail.override.unknownAuthor`). */
  readonly authorName: string | null;
  readonly savedAt: DayDetailSavedAt;
  readonly reason: string;
}

/** A live override on the day that a rotation change left pending (story 3.5c): shown, not applied. */
export interface DayDetailPendingOverride {
  /** The override's id, which a removal names. */
  readonly id: string;
  /** The type the override names, which the day does not show while it is pending. */
  readonly typeName: string;
  /** The type the rotation projects that day, which a removal leaves; `null` with no rotation. */
  readonly projectedTypeName: string | null;
  /** Who saved it; `null` when they are no member the snapshot holds. */
  readonly authorName: string | null;
  readonly reason: string;
}

/** A roster override that adds a member (story 3.6a). */
export const ROSTER_ADDED = 'added';

/** A roster override that removes a member. */
export const ROSTER_REMOVED = 'removed';

/** A roster override that replaces one member with another, in one row. */
export const ROSTER_REPLACED = 'replaced';

export type DayDetailRosterChangeKind = typeof ROSTER_ADDED | typeof ROSTER_REMOVED | typeof ROSTER_REPLACED;

/** One roster override on the day, as the detail lists it (story 3.6a). */
export interface DayDetailRosterChange {
  readonly id: string;
  readonly kind: DayDetailRosterChangeKind;
  /** The member taken off; `null` for an addition, or for one the snapshot does not hold. */
  readonly outName: string | null;
  /** The member put on; `null` for a removal, or for one the snapshot does not hold. */
  readonly inName: string | null;
  /** Who saved it; `null` when they are no member the snapshot holds. */
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
  /** The date as the snapshot keys it, `YYYY-MM-DD` (story 3.5b): what an override is written for. */
  readonly isoDate: string;
  /** The type the rotation projects that day, before any override; `null` with no rotation (story 3.5b). */
  readonly projectedShiftTypeId: string | null;
  readonly kind: DayDetailKind;
  /** The type's name; `null` unless the kind is `working`. */
  readonly typeName: string | null;
  /** `19:00–07:00`; `null` unless the kind is `working` (and `null` for a working type with no times). */
  readonly range: string | null;
  /** The team's members active on the date, by name then id; empty unless the kind is `working`. */
  readonly roster: readonly DayDetailMember[];
  /** The override on the day, whatever the kind; `null` for none (and always with no rotation). */
  readonly override: DayDetailOverride | null;
  /** The override on the day a rotation change left pending (story 3.5c), whatever the kind; `null` for none. */
  readonly pending: DayDetailPendingOverride | null;
  /** The roster overrides that applied on the day, in the snapshot's order (story 3.6a); empty unless `working`. */
  readonly rosterChanges: readonly DayDetailRosterChange[];
  /** The roster overrides on the day a rotation change left pending (story 3.6a), whatever the kind. */
  readonly rosterPending: readonly DayDetailRosterChange[];
}

function compareMembers(left: DayDetailMember, right: DayDetailMember): number {
  // A member the snapshot does not hold sorts after every named one.
  if (left.name === null || right.name === null) {
    if (left.name !== right.name) return left.name === null ? 1 : -1;
  } else {
    const byName = compareText(left.name, right.name);

    if (byName !== 0) return byName;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * The detail of `teamId` on `date` (`YYYY-MM-DD`), or `null` for a team the
 * snapshot does not hold — the screen then closes the Dialog. Archived teams
 * are held, so a day list's past team still opens.
 *
 * @throws RangeError on any precondition of `scheduledShiftTypeOn`,
 *   `rosterOn` or `typeRangeOn`, a type the snapshot lacks, a member of the
 *   default roster the snapshot lacks, or a date or time that cannot be
 *   formatted.
 */
export function dayDetailOf(snapshot: CalendarSnapshot, teamId: string, date: string): DayDetail | null {
  const team = snapshot.teams.find((one) => one.id === teamId);

  if (team === undefined) return null;

  const standing = overrideStandingOfCalendar(snapshot);
  const scheduled = scheduledShiftTypeOn(
    snapshot.assignments.filter((assignment) => assignment.teamId === teamId),
    snapshot.steps,
    standing.inForce,
    teamId,
    date,
  );
  const waiting = standing.pending.find((one) => one.teamId === teamId && one.date === date);
  const rosterStanding = rosterStandingOfCalendar(snapshot);
  const rosterPending = rosterStanding.pending
    .filter((one) => one.teamId === teamId && one.date === date)
    .map((one) => rosterChangeOf(snapshot, one));
  const full = formatIsoDate(date);

  if (full === null) throw new RangeError(`the date ${date} could not be formatted`);

  const base = { teamId, teamName: team.name, date: `${weekdayOf(date)} ${full}`, isoDate: date, rosterPending };

  if (scheduled === null) {
    return {
      ...base,
      projectedShiftTypeId: null,
      kind: DAY_NO_ROTATION,
      typeName: null,
      range: null,
      roster: [],
      override: null,
      pending: waiting === undefined ? null : pendingOf(snapshot, waiting, null, date),
      rosterChanges: [],
    };
  }

  const projectedTypeName = typeOf(snapshot, scheduled.projectedShiftTypeId, date).name;
  const projected = {
    ...base,
    projectedShiftTypeId: scheduled.projectedShiftTypeId,
    pending: waiting === undefined ? null : pendingOf(snapshot, waiting, projectedTypeName, date),
  };

  const type = typeOf(snapshot, scheduled.shiftTypeId, date);
  const override = scheduled.overridden ? overrideOf(snapshot, standing.inForce, teamId, date, projectedTypeName) : null;

  if (!type.isWorking) {
    return { ...projected, kind: DAY_OFF, typeName: null, range: null, roster: [], override, rosterChanges: [] };
  }

  const members = new Map(snapshot.members.map((member) => [member.id, member]));
  const shown = rosterOn(snapshot.members, rosterStanding.inForce, teamId, date);
  const roster = shown.roster.map((entry): DayDetailMember => {
    const member = members.get(entry.memberId);

    // A member of the default roster comes from the snapshot's own members;
    // one a roster override put on may be one the members read did not name.
    if (member === undefined && !entry.added) {
      throw new RangeError(`member ${entry.memberId} is rostered but is not in the snapshot`);
    }

    return { id: entry.memberId, name: member?.name ?? null, fireRank: member?.fireRank ?? null, position: entry.position };
  });

  return {
    ...projected,
    kind: DAY_WORKING,
    typeName: type.name,
    range: typeRangeOn(type, date),
    roster: roster.sort(compareMembers),
    override,
    rosterChanges: shown.applied.map((one) => rosterChangeOf(snapshot, one)),
  };
}

/** A member's name through the snapshot's members, or `null` for one it does not hold. */
function memberNameOf(snapshot: CalendarSnapshot, memberId: string | null): string | null {
  if (memberId === null) return null;

  return snapshot.members.find((member) => member.id === memberId)?.name ?? null;
}

/**
 * When an override was saved, in the organization's zone.
 *
 * @throws RangeError when `createdAt` is not an instant.
 */
function savedAtOf(snapshot: CalendarSnapshot, createdAt: string, what: string): DayDetailSavedAt {
  const saved = new Date(createdAt);

  if (Number.isNaN(saved.getTime())) throw new RangeError(`${what} was saved at ${createdAt}`);

  return { date: formatDate(saved, snapshot.timeZone), time: formatTime(saved, snapshot.timeZone) };
}

/**
 * A roster override as the detail lists it (story 3.6a): added, removed or
 * replaced, the members named through the snapshot's, its author, time and
 * reason.
 *
 * @throws RangeError when its time is not an instant.
 */
function rosterChangeOf(snapshot: CalendarSnapshot, override: CalendarRosterOverride): DayDetailRosterChange {
  const kind =
    override.memberOutId === null ? ROSTER_ADDED : override.memberInId === null ? ROSTER_REMOVED : ROSTER_REPLACED;

  return {
    id: override.id,
    kind,
    outName: memberNameOf(snapshot, override.memberOutId),
    inName: memberNameOf(snapshot, override.memberInId),
    authorName: memberNameOf(snapshot, override.authorMemberId),
    savedAt: savedAtOf(snapshot, override.createdAt, `the roster override ${override.id}`),
    reason: override.reason,
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

/** The author of `override` through the snapshot's members, or `null` for one it does not hold. */
function authorNameOf(snapshot: CalendarSnapshot, override: CalendarOverride): string | null {
  const author =
    override.authorMemberId === null
      ? undefined
      : snapshot.members.find((member) => member.id === override.authorMemberId);

  return author?.name ?? null;
}

/**
 * A pending override as the detail names it: its type, the type a removal
 * leaves (`projectedTypeName`), its author and its reason.
 *
 * @throws RangeError for a type the snapshot lacks.
 */
function pendingOf(
  snapshot: CalendarSnapshot,
  override: CalendarOverride,
  projectedTypeName: string | null,
  date: string,
): DayDetailPendingOverride {
  return {
    id: override.id,
    typeName: typeOf(snapshot, override.shiftTypeId, date).name,
    projectedTypeName,
    authorName: authorNameOf(snapshot, override),
    reason: override.reason,
  };
}

/**
 * The override of `teamId` on `date`, as the detail names it: its author
 * through the snapshot's members (`null` for one it does not hold), its time
 * in the organization's zone, its reason, and `projectedTypeName`.
 *
 * @throws RangeError when `inForce` holds no override of the team on the
 *   date, or its time is not an instant.
 */
function overrideOf(
  snapshot: CalendarSnapshot,
  inForce: readonly CalendarOverride[],
  teamId: string,
  date: string,
  projectedTypeName: string,
): DayDetailOverride {
  const override = inForce.find((one) => one.teamId === teamId && one.date === date);

  if (override === undefined) throw new RangeError(`team ${teamId} is overridden on ${date} by no override`);

  return {
    id: override.id,
    projectedTypeName,
    authorName: authorNameOf(snapshot, override),
    savedAt: savedAtOf(snapshot, override.createdAt, `the override of team ${teamId} on ${date}`),
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

// ------------------------------------------------ setting an override (3.5b)

/** One type the override form offers: its id and name. */
export interface OverrideTypeOption {
  readonly id: string;
  readonly name: string;
}

/**
 * The types an admin may set on the day (story 3.5b): every type of the
 * snapshot that is NOT ARCHIVED and is not the one the rotation projects that
 * day, in the snapshot's own order (creation order). None for a day with no
 * rotation, and none for a day already overridden — its override is removed,
 * never changed in place — or with an override pending review (story 3.5c).
 */
export function overrideTypeOptionsOf(snapshot: CalendarSnapshot, detail: DayDetail): readonly OverrideTypeOption[] {
  const projectedShiftTypeId = detail.projectedShiftTypeId;

  if (projectedShiftTypeId === null || detail.override !== null || detail.pending !== null) return [];

  return snapshot.types
    .filter((type) => !type.archived && type.id !== projectedShiftTypeId)
    .map((type) => ({ id: type.id, name: type.name }));
}

/** The reason's bounds once surrounding white space is trimmed, as 0019's check reads them. */
export const OVERRIDE_REASON_MIN = 1;
export const OVERRIDE_REASON_MAX = 200;

/** The reason is blank or longer than {@link OVERRIDE_REASON_MAX} once trimmed. */
export const OVERRIDE_REFUSED_REASON = 'reason';

/** The type chosen is the one the rotation already projects, or none at all. */
export const OVERRIDE_REFUSED_SAME = 'sameAsProjected';

export type OverrideEntryRefusal = typeof OVERRIDE_REFUSED_REASON | typeof OVERRIDE_REFUSED_SAME;

export type OverrideEntry =
  | { readonly ok: true; readonly shiftTypeId: string; readonly reason: string }
  | { readonly ok: false; readonly code: OverrideEntryRefusal };

/**
 * The browser's preflight of an override entered on `detail` (story 3.5b):
 * the type first, as the first field, then the reason. The type may not be
 * empty or the projected one — "same as projected" is the browser's to
 * check, because the database cannot project. The reason is trimmed of
 * surrounding white space and must then hold 1–200 characters (code points,
 * as `char_length` counts them). What passes is what is sent: the trimmed
 * reason.
 */
export function overrideEntryOf(detail: DayDetail, shiftTypeId: string, reason: string): OverrideEntry {
  if (shiftTypeId === '' || shiftTypeId === detail.projectedShiftTypeId) {
    return { ok: false, code: OVERRIDE_REFUSED_SAME };
  }

  const trimmed = reason.trim();
  const length = [...trimmed].length;

  if (length < OVERRIDE_REASON_MIN || length > OVERRIDE_REASON_MAX) return { ok: false, code: OVERRIDE_REFUSED_REASON };

  return { ok: true, shiftTypeId, reason: trimmed };
}

/** What the day detail offers its viewer (story 3.5b): the form and its types, or the removal, or neither. */
export interface OverrideOffers {
  readonly options: readonly OverrideTypeOption[];
  /** The form to set an override: an admin, a day with a rotation and no override, and a type to offer. */
  readonly set: boolean;
  /** The removal: an admin, on a day with an override, or one pending review (story 3.5c). */
  readonly remove: boolean;
}

const NO_OFFERS: OverrideOffers = { options: [], set: false, remove: false };

/**
 * What `detail` offers the viewer of `snapshot` (story 3.5b). SHOWN BY THE
 * ROLE, DECIDED BY THE DATABASE: only an admin is offered either, and the
 * insert policy and the removal function refuse everyone else anyway. A day
 * with no rotation offers neither, unless an override is pending on it. A
 * PENDING OVERRIDE (story 3.5c) offers its removal alone, on any kind of day:
 * no form, because confirming or amending it is the rotation builder's.
 */
export function overrideOffersOf(snapshot: CalendarSnapshot | null, detail: DayDetail | null): OverrideOffers {
  if (snapshot === null || detail === null || snapshot.viewer.role !== 'admin') return NO_OFFERS;
  if (detail.pending !== null) return { options: [], set: false, remove: true };
  if (detail.kind === DAY_NO_ROTATION) return NO_OFFERS;

  const options = overrideTypeOptionsOf(snapshot, detail);

  return { options, set: detail.override === null && options.length > 0, remove: detail.override !== null };
}

/** What a removal from the day detail names (stories 3.5b, 3.5c): the override, and the type the day then shows. */
export interface OverrideRemovalTarget {
  readonly id: string;
  /**
   * The projected type an override IN FORCE gives way to, which the
   * confirmation and the done notice name; `null` for an override PENDING
   * review (story 3.5c), which is not applied, so the day already shows the
   * projection — or no rotation — and its removal changes nothing on screen.
   * Those say the pending copy instead.
   */
  readonly projectedTypeName: string | null;
}

/** The override a removal from `detail` names: the one in force, else the one pending review, else none. */
export function overrideRemovalTargetOf(detail: DayDetail | null): OverrideRemovalTarget | null {
  if (detail === null) return null;
  if (detail.override !== null) return { id: detail.override.id, projectedTypeName: detail.override.projectedTypeName };
  if (detail.pending !== null) return { id: detail.pending.id, projectedTypeName: null };

  return null;
}
