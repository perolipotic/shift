import {
  activeOn,
  daysBetween,
  deriveShiftTimes,
  MINUTES_PER_DAY,
  memberScheduleOfMonth,
  membershipOn,
  monthOf,
  rosterOn,
  scheduledShiftTypeOn,
  shiftRoster,
  shiftTypeVersionOn,
  type Collision,
  type LeaveRange,
} from '@shift/domain';

import {
  dayMonthOf,
  memberScheduleInputOf,
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
import {
  CANDIDATE_GROUPS,
  replacementCandidatesOf,
  type CandidateGroupKind,
  type CandidateLeave,
} from '@/features/calendar/utils/replacement-candidates';
import { compareText, formatDate, formatIsoDate, formatTime } from '@/lib/i18n/format';
import { rosterLineOf, rosterPositionMessageKey, type RosterLine } from '@/features/members/utils/position';
import { rosterRankMessageKey } from '@/features/members/utils/rank';
import { shiftTimesShownOf, type ShiftTypeRow } from '@/features/shift-types/services/list';

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
 * reason, and each one pending review apart, under its own heading. One in
 * force that applies to nothing (an INERT one, story 3.6b) is listed apart
 * too, in `rosterInert`, for the admin to remove.
 *
 * WHAT AN ADMIN MAY CHANGE ON A SHIFT (story 3.6b) is decided here as well:
 * the members to take off and to put on ({@link rosterOffersOf}), against the
 * DEFAULT roster alone (`shiftRoster`, `activeOn` and `membershipOn` from
 * `@shift/domain`), the browser's preflight ({@link rosterEntryOf}) and what
 * a removal names ({@link rosterRemovalTargetOf}). The database's checks and
 * its partial keys stay authoritative. A member chosen to put on who already
 * works an overlapping shift is warned of, never refused
 * ({@link rosterOverlapOf}, Epic 4 retro C2).
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
  /**
   * The type the team WORKS that day, the override applied (the roster form's
   * overlap hint derives the shift's window from it, Epic 4 retro C2); `null`
   * with no rotation.
   */
  readonly shiftTypeId: string | null;
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
  /**
   * The roster overrides IN FORCE on the day that `rosterOn` did not apply
   * (story 3.6b) — inert, whatever the kind: on a day that is not a working
   * one, every one in force is. In the snapshot's order.
   */
  readonly rosterInert: readonly DayDetailRosterChange[];
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
  const rosterInForce = rosterStanding.inForce.filter((one) => one.teamId === teamId && one.date === date);
  // Inert is in force less applied (story 3.6b): with no working shift, all of them.
  const inertOf = (applied: readonly { readonly id: string }[]): readonly DayDetailRosterChange[] =>
    rosterInForce
      .filter((one) => !applied.some((used) => used.id === one.id))
      .map((one) => rosterChangeOf(snapshot, one));
  const full = formatIsoDate(date);

  if (full === null) throw new RangeError(`the date ${date} could not be formatted`);

  const base = { teamId, teamName: team.name, date: `${weekdayOf(date)} ${full}`, isoDate: date, rosterPending };

  if (scheduled === null) {
    return {
      ...base,
      projectedShiftTypeId: null,
      shiftTypeId: null,
      kind: DAY_NO_ROTATION,
      typeName: null,
      range: null,
      roster: [],
      override: null,
      pending: waiting === undefined ? null : pendingOf(snapshot, waiting, null, date),
      rosterChanges: [],
      rosterInert: inertOf([]),
    };
  }

  const projectedTypeName = typeOf(snapshot, scheduled.projectedShiftTypeId, date).name;
  const projected = {
    ...base,
    projectedShiftTypeId: scheduled.projectedShiftTypeId,
    shiftTypeId: scheduled.shiftTypeId,
    pending: waiting === undefined ? null : pendingOf(snapshot, waiting, projectedTypeName, date),
  };

  const type = typeOf(snapshot, scheduled.shiftTypeId, date);
  const override = scheduled.overridden ? overrideOf(snapshot, standing.inForce, teamId, date, projectedTypeName) : null;

  if (!type.isWorking) {
    return {
      ...projected,
      kind: DAY_OFF,
      typeName: null,
      range: null,
      roster: [],
      override,
      rosterChanges: [],
      rosterInert: inertOf([]),
    };
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
    rosterInert: inertOf(shown.applied),
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

/** The type chosen is the one the rotation already projects. */
export const OVERRIDE_REFUSED_SAME = 'sameAsProjected';

/** No type chosen at all (story 7.9): the type dialog's placeholder left as it is. */
export const OVERRIDE_REFUSED_TYPE = 'type';

/** No type chosen (story 7.9): the type `Select`'s placeholder, which the preview shows nothing for and the preflight refuses as {@link OVERRIDE_REFUSED_TYPE}. */
export const OVERRIDE_NO_TYPE = '';

export type OverrideEntryRefusal =
  | typeof OVERRIDE_REFUSED_REASON
  | typeof OVERRIDE_REFUSED_SAME
  | typeof OVERRIDE_REFUSED_TYPE;

export type OverrideEntry =
  | { readonly ok: true; readonly shiftTypeId: string; readonly reason: string }
  | { readonly ok: false; readonly code: OverrideEntryRefusal };

/**
 * The browser's preflight of an override entered on `detail` (story 3.5b):
 * the type first, as the first field, then the reason. The type must be
 * chosen ({@link OVERRIDE_REFUSED_TYPE}, story 7.9) and may not be the
 * projected one — "same as projected" is the browser's to check, because the
 * database cannot project. The reason is trimmed of
 * surrounding white space and must then hold 1–200 characters (code points,
 * as `char_length` counts them). What passes is what is sent: the trimmed
 * reason.
 */
export function overrideEntryOf(detail: DayDetail, shiftTypeId: string, reason: string): OverrideEntry {
  if (shiftTypeId === OVERRIDE_NO_TYPE) return { ok: false, code: OVERRIDE_REFUSED_TYPE };
  if (shiftTypeId === detail.projectedShiftTypeId) return { ok: false, code: OVERRIDE_REFUSED_SAME };

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

// ------------------------------------------- changing a shift's roster (3.6b)

/** A member the roster form may take off the shift: on its default roster (story 3.6b). */
export interface RosterOutCandidate {
  readonly id: string;
  readonly name: string;
  /** Shown, never used; `null` is no rank. */
  readonly fireRank: string | null;
  /** Their position in the team on the date; shown, never used. */
  readonly position: string | null;
}

/** A member the roster form may put on the shift: active on the date and not on its default roster. */
export interface RosterInCandidate {
  readonly id: string;
  readonly name: string;
  /** Shown, never used; `null` is no rank. */
  readonly fireRank: string | null;
  /** The name of their own team on the date, which may work too; `null` for none. */
  readonly teamName: string | null;
}

/**
 * One group of members to put on (story 7.9): 5.4c's grouping
 * (`replacementCandidatesOf`) — free, working that day, on leave that day —
 * informing and never blocking. An empty group is kept, so the order is fixed.
 */
export interface RosterInGroup {
  readonly kind: CandidateGroupKind;
  readonly candidates: readonly RosterInCandidate[];
}

/** What the day detail offers an admin for its roster (story 3.6b). */
export interface RosterOffers {
  /** The form: an admin, on a working day. */
  readonly set: boolean;
  /** A removal on every listed change — applied, pending and inert alike: an admin, on any kind of day. */
  readonly remove: boolean;
  readonly out: readonly RosterOutCandidate[];
  readonly in: readonly RosterInCandidate[];
  /** `in` in 5.4c's groups (story 7.9); empty while the leave they are grouped by is not read. */
  readonly inGroups: readonly RosterInGroup[];
  /**
   * The members of `in` in no group, drawn outside any `<optgroup>` (story
   * 7.9): all of them while the leave is not read or the grouping cannot be
   * derived, and otherwise any the helper did not place (never, by
   * construction). Never under a group they were not placed in.
   */
  readonly inUngrouped: readonly RosterInCandidate[];
}

const NO_ROSTER_OFFERS: RosterOffers = { set: false, remove: false, out: [], in: [], inGroups: [], inUngrouped: [] };

/**
 * What `detail` offers the viewer of `snapshot` for its roster (story 3.6b).
 * SHOWN BY THE ROLE, DECIDED BY THE DATABASE: only an admin is offered
 * anything. The form only on a working day; the removal on any.
 *
 * THE CANDIDATES ARE THE DEFAULT ROSTER'S, never the changed one's: to take
 * off, its members (`shiftRoster`); to put on, every member active on the
 * date (`activeOn`) who is not on it — their own team may work that date too.
 * Both leave out every member any LIVE roster override on the team and date
 * names, on either side — applied, pending or inert — so a change is always
 * made against the default roster, and the live keys do not answer `taken`.
 * To change a change, remove it and save a new one. Those to take off are in
 * `shiftRoster`'s order, and those to put on in `snapshot.members`' order.
 * Nothing is blocked or suggested, and the list marks no one: a member put on
 * while they already work an overlapping shift is WARNED of once chosen
 * ({@link rosterOverlapOf}), never refused (Epic 4 retro C2, 2026-10-01).
 *
 * AN ARCHIVED TEAM (a day list's past team still opens) offers no form: the
 * insert policy refuses it. Its changes can still be removed.
 *
 * THOSE TO PUT ON ARE GROUPED (story 7.9) by 5.4c's helper
 * (`replacementCandidatesOf`, over `leave`, the live leave the admin reads):
 * free, working that day, on leave that day. The groups only inform: none is
 * left out or disabled for its group. With `leave` `null` — not read yet, or
 * failed — nobody is grouped, since a member on leave would read as free; a
 * grouping that cannot be derived is logged and groups nobody either.
 *
 * @throws RangeError on any precondition of `shiftRoster`, `activeOn`,
 *   `membershipOn` or `replacementCandidatesOf`.
 */
export function rosterOffersOf(
  snapshot: CalendarSnapshot | null,
  detail: DayDetail | null,
  leave: readonly CandidateLeave[] | null = null,
): RosterOffers {
  if (snapshot === null || detail === null || snapshot.viewer.role !== 'admin') return NO_ROSTER_OFFERS;
  const { teamId, isoDate } = detail;
  const archived = snapshot.teams.find((team) => team.id === teamId)?.archived ?? false;

  if (detail.kind !== DAY_WORKING || archived) return { ...NO_ROSTER_OFFERS, remove: true };

  const named = new Set<string>();

  for (const one of snapshot.rosterOverrides) {
    if (one.teamId !== teamId || one.date !== isoDate) continue;
    if (one.memberOutId !== null) named.add(one.memberOutId);
    if (one.memberInId !== null) named.add(one.memberInId);
  }

  const onDefault = shiftRoster(snapshot.members, teamId, isoDate);
  const onDefaultIds = new Set(onDefault.map((entry) => entry.memberId));
  const byId = new Map(snapshot.members.map((member) => [member.id, member]));
  const teams = new Map(snapshot.teams.map((team) => [team.id, team.name]));
  const out: RosterOutCandidate[] = [];

  for (const entry of onDefault) {
    const member = byId.get(entry.memberId);

    if (member === undefined || named.has(member.id)) continue;
    out.push({ id: member.id, name: member.name, fireRank: member.fireRank, position: entry.position });
  }

  const put: RosterInCandidate[] = [];

  for (const member of snapshot.members) {
    if (named.has(member.id) || onDefaultIds.has(member.id)) continue;
    if (!activeOn(member.statuses, isoDate)) continue;

    const own = membershipOn(member.memberships, isoDate);

    put.push({
      id: member.id,
      name: member.name,
      fireRank: member.fireRank,
      teamName: own === null ? null : (teams.get(own.teamId) ?? null),
    });
  }

  const ungrouped = { set: true, remove: true, out, in: put, inGroups: [], inUngrouped: put };

  if (leave === null) return ungrouped;

  try {
    return { set: true, remove: true, out, in: put, ...inGroupsOf(snapshot, leave, detail, put) };
  } catch (cause) {
    console.error(cause);

    return ungrouped;
  }
}

/**
 * `put` in 5.4c's groups, each in `put`'s own order. The helper's candidates
 * are a superset of `put` (it leaves out fewer of the members a live change
 * names), so only those in `put` are kept. One the helper would not place —
 * never, by construction — is logged and left ungrouped, never put under a
 * group it was not placed in.
 *
 * @throws RangeError on any precondition of `replacementCandidatesOf`.
 */
function inGroupsOf(
  snapshot: CalendarSnapshot,
  leave: readonly CandidateLeave[],
  detail: DayDetail,
  put: readonly RosterInCandidate[],
): Pick<RosterOffers, 'inGroups' | 'inUngrouped'> {
  const kindOf = new Map<string, CandidateGroupKind>();

  for (const group of replacementCandidatesOf(snapshot, leave, detail.teamId, detail.isoDate)) {
    for (const candidate of group.candidates) kindOf.set(candidate.id, group.kind);
  }

  const groups = new Map<CandidateGroupKind, RosterInCandidate[]>();
  const unplaced: RosterInCandidate[] = [];

  for (const candidate of put) {
    const kind = kindOf.get(candidate.id);

    if (kind === undefined) {
      console.error(`member ${candidate.id} is offered on ${detail.isoDate} but in no candidate group`);
      unplaced.push(candidate);
      continue;
    }

    const group = groups.get(kind);

    if (group === undefined) groups.set(kind, [candidate]);
    else group.push(candidate);
  }

  return {
    inGroups: CANDIDATE_GROUPS.map((kind) => ({ kind, candidates: groups.get(kind) ?? [] })),
    inUngrouped: unplaced,
  };
}

/** The value of a roster form's "— nitko —" option: no member on that side. */
export const ROSTER_NOBODY = '';

/**
 * `date` (`YYYY-MM-DD`) moved by `days` whole days, as `YYYY-MM-DD`: civil-day
 * arithmetic on the UTC axis, so no zone or daylight-saving change moves it.
 *
 * @throws RangeError when `date` is not a calendar `YYYY-MM-DD` (`2020-02-31`
 *   and `2020-13-01` included), when `days` is not a safe integer, or when the
 *   result falls outside years 0001–9999.
 */
export function isoDateShiftedBy(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (match === null) throw new RangeError(`the date ${date} is not a YYYY-MM-DD`);
  if (!Number.isSafeInteger(days)) throw new RangeError(`${String(days)} is not a whole number of days`);

  const pad = (value: number, width: number) => String(value).padStart(width, '0');
  const isoOf = (instant: Date) =>
    `${pad(instant.getUTCFullYear(), 4)}-${pad(instant.getUTCMonth() + 1, 2)}-${pad(instant.getUTCDate(), 2)}`;
  const at = (offset: number): Date => {
    const instant = new Date(0);

    instant.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offset);

    return instant;
  };

  // The round trip: a date the calendar does not have comes back as another one.
  if (Number(match[1]) < 1 || isoOf(at(0)) !== date) throw new RangeError(`the date ${date} is not a calendar date`);

  const moved = at(days);
  const year = moved.getUTCFullYear();

  if (Number.isNaN(year) || year < 1 || year > 9999) {
    throw new RangeError(`${date} moved by ${String(days)} days leaves years 0001–9999`);
  }

  return isoOf(moved);
}

/**
 * A shift a member put on would double-book (Epic 4 retro C2): the member,
 * the team they already work, the day that shift starts and its times.
 */
export interface RosterOverlap {
  readonly memberName: string;
  readonly teamName: string;
  /** The day the shift they already work starts, `YYYY-MM-DD`: the open day, or the one before or after. */
  readonly date: string;
  /** That day as the calendar reads it: `četvrtak 01.01.`. */
  readonly day: string;
  /** `19:00–07:00`, the times of the shift they already work. */
  readonly range: string;
}

/** A nominal window on an absolute axis: minutes from the start of the open day. */
interface NominalWindow {
  readonly start: number;
  readonly end: number;
}

/**
 * The nominal window of the type `shiftTypeId` on `date`, `offset` days from
 * the open day; `null` for a type the snapshot lacks, a non-working one, or
 * one with no version in effect.
 *
 * @throws RangeError on any precondition of `shiftTypeVersionOn` or `deriveShiftTimes`.
 */
function windowOf(
  snapshot: CalendarSnapshot,
  shiftTypeId: string,
  date: string,
  offset: number,
): { readonly window: NominalWindow; readonly range: string } | null {
  const type = snapshot.types.find((one) => one.id === shiftTypeId);

  if (type === undefined || !type.isWorking) return null;

  const version = shiftTypeVersionOn(type.versions, date);

  if (version === null) return null;

  const times = deriveShiftTimes(version.startMinute, version.endMinute);
  const start = offset * MINUTES_PER_DAY + times.startMinute;

  return { window: { start, end: start + times.durationMinutes }, range: shiftTimesShownOf(version).range };
}

/** One shift the member already works near the open day, in the order the hint names them. */
interface NearbyShift {
  readonly date: string;
  readonly teamId: string;
  readonly shiftTypeId: string;
  /** Their own team's shift, rather than one a roster override puts them on. */
  readonly own: boolean;
}

/** By date, then the member's own team before a shift a roster override puts them on. */
function compareNearby(left: NearbyShift, right: NearbyShift): number {
  if (left.date !== right.date) return left.date < right.date ? -1 : 1;
  if (left.own !== right.own) return left.own ? -1 : 1;

  return 0;
}

/**
 * WHETHER PUTTING `memberId` ON THE SHIFT OF `detail` WOULD DOUBLE-BOOK THEM
 * (Epic 4 retro C2; human decision 2026-10-01: warn, never block): a shift
 * the member already works on the day before, the day itself or the day
 * after whose NOMINAL window overlaps the open shift's; `null` for none, for
 * nobody ({@link ROSTER_NOBODY}), for a member the snapshot does not hold,
 * and for a day that is not a working one or whose type has no times.
 *
 * ONLY THE FIRST OVERLAP IS NAMED: by date, then the member's own team before
 * a shift a roster override puts them on, then the domain's order.
 *
 * "Already works" is `memberScheduleOfMonth`'s answer through
 * `memberScheduleInputOf` — the very shifts *Sati* counts — read for each
 * month the three days fall in. As in hours, ONLY OVERRIDES IN FORCE count,
 * shift-type and roster alike: one pending review or inert changes nothing.
 * Windows are integer minutes on one axis (day offset × 1440 + start, + the
 * duration `deriveShiftTimes` derives), half-open, so a shift ending at 07:00
 * and one starting at 07:00 do not overlap. Only working types with times
 * count; a neighbouring shift whose type or team the snapshot lacks is
 * skipped. The open shift (its team on its date) is never counted against
 * itself.
 *
 * @throws RangeError on any precondition of `memberScheduleOfMonth`,
 *   `shiftTypeVersionOn` or `deriveShiftTimes`, or a date that cannot be
 *   formatted. {@link rosterOverlapShownOf} is its guarded form.
 */
export function rosterOverlapOf(snapshot: CalendarSnapshot, detail: DayDetail, memberId: string): RosterOverlap | null {
  if (memberId === ROSTER_NOBODY || detail.kind !== DAY_WORKING || detail.shiftTypeId === null) return null;

  const member = snapshot.members.find((one) => one.id === memberId);

  if (member === undefined) return null;

  const day = detail.isoDate;
  const open = windowOf(snapshot, detail.shiftTypeId, day, 0);

  if (open === null) return null;

  const dates = [isoDateShiftedBy(day, -1), day, isoDateShiftedBy(day, 1)];
  const input = memberScheduleInputOf(snapshot, {
    memberId: member.id,
    memberships: member.memberships,
    statuses: member.statuses,
  });
  const months = [...new Set(dates.map((date) => monthOf(date)))];
  const nearby: NearbyShift[] = [];

  for (const { date, shifts } of months.flatMap((month) => memberScheduleOfMonth(input, month))) {
    if (!dates.includes(date)) continue;

    for (const shift of shifts) {
      if (shift.shiftTypeId === null) continue;
      if (shift.teamId === detail.teamId && date === day) continue;
      nearby.push({ date, teamId: shift.teamId, shiftTypeId: shift.shiftTypeId, own: !shift.viaOverride });
    }
  }

  // `Array.prototype.sort` is stable: equal ones keep the domain's order.
  for (const shift of nearby.sort(compareNearby)) {
    const team = snapshot.teams.find((one) => one.id === shift.teamId);
    const theirs = windowOf(snapshot, shift.shiftTypeId, shift.date, daysBetween(day, shift.date));

    if (team === undefined || theirs === null) continue;
    if (theirs.window.start < open.window.end && open.window.start < theirs.window.end) {
      return {
        memberName: member.name,
        teamName: team.name,
        date: shift.date,
        day: `${weekdayOf(shift.date)} ${dayMonthOf(shift.date)}`,
        range: theirs.range,
      };
    }
  }

  return null;
}

/**
 * {@link rosterOverlapOf}, GUARDED: nothing open or nobody chosen is no hint,
 * and a hint that cannot be derived is no hint either — the cause logged —
 * so it never takes the form down. The save decides nothing by it.
 */
export function rosterOverlapShownOf(
  snapshot: CalendarSnapshot | null,
  detail: DayDetail | null,
  memberId: string,
): RosterOverlap | null {
  if (snapshot === null || detail === null || memberId === ROSTER_NOBODY) return null;

  try {
    return rosterOverlapOf(snapshot, detail, memberId);
  } catch (cause) {
    console.error(cause);

    return null;
  }
}

/** One member a roster form's `Select` offers: their id and the line it reads. */
export interface RosterOption {
  readonly id: string;
  readonly label: string;
}

type RosterWordKey =
  | NonNullable<ReturnType<typeof rosterRankMessageKey>>
  | NonNullable<ReturnType<typeof rosterPositionMessageKey>>;
type RosterSentence = Extract<RosterLine, { readonly key: string }>;

/**
 * The words of a candidate line: `word` for a rank or position label, and
 * `line` for the roster sentence with its values — `t` on the screen,
 * anything in a test.
 */
export interface RosterLineTranslate {
  readonly word: (key: RosterWordKey) => string;
  readonly line: (key: RosterSentence['key'], values: RosterSentence['values']) => string;
}

/** A {@link RosterLine} as words. */
function rosterLineText(line: RosterLine, translate: RosterLineTranslate): string {
  return line.key === null ? line.text : translate.line(line.key, line.values);
}

/**
 * The line a member to take off reads in the roster form (story 3.6b):
 * `Ime · čin · položaj`, as the roster reads it, rank and position only where
 * the organization uses them (`rankShown`, `positionShown`). Shown, never used.
 */
export function outOptionOf(
  candidate: RosterOutCandidate,
  rankShown: boolean,
  positionShown: boolean,
  translate: RosterLineTranslate,
): RosterOption {
  const rankKey = rosterRankMessageKey(candidate.fireRank, rankShown);
  const positionKey = rosterPositionMessageKey(candidate.position, positionShown);

  return {
    id: candidate.id,
    label: rosterLineText(rosterLineOf(candidate.name, rankKey, positionKey, translate.word), translate),
  };
}

/**
 * The line a member to put on reads in the roster form (story 3.6b):
 * `Ime · čin · Smjena X`, their own team on the date in the position's place,
 * or `noTeam` ("bez smjene"), rank only where the organization uses it.
 * Shown, never used.
 */
export function inOptionOf(
  candidate: RosterInCandidate,
  rankShown: boolean,
  noTeam: string,
  translate: RosterLineTranslate,
): RosterOption {
  const rankKey = rosterRankMessageKey(candidate.fireRank, rankShown);
  const team = candidate.teamName ?? noTeam;
  // Both beside the name are words already, so their translation is the words.
  const line = rosterLineOf(candidate.name, rankKey === null ? null : translate.word(rankKey), team, (words) => words);

  return { id: candidate.id, label: rosterLineText(line, translate) };
}

/** Neither a member to take off nor one to put on was chosen, or one member on both sides. */
export const ROSTER_REFUSED_MEMBER = 'member';

/** The reason is blank or longer than {@link OVERRIDE_REASON_MAX} once trimmed, as 0026 checks it. */
export const ROSTER_REFUSED_REASON = 'reason';

export type RosterEntryRefusal = typeof ROSTER_REFUSED_MEMBER | typeof ROSTER_REFUSED_REASON;

export type RosterEntry =
  | {
      readonly ok: true;
      readonly memberOutId: string | null;
      readonly memberInId: string | null;
      readonly reason: string;
    }
  | { readonly ok: false; readonly code: RosterEntryRefusal };

/**
 * The browser's preflight of a roster change (story 3.6b), field by field:
 * the members first — at least one chosen ({@link ROSTER_NOBODY} being
 * "— nitko —"), and never one member on both sides, as 0026's
 * `_member_present` and `_members_distinct` checks have it — then the reason,
 * trimmed and then 1–200 characters (code points, as `char_length` counts
 * them). The database's checks stay authoritative. What passes is what is
 * sent: the trimmed reason, and `null` for the side not chosen. Taking off
 * only removes, putting on only adds, and both replace, in one row.
 */
export function rosterEntryOf(memberOutId: string, memberInId: string, reason: string): RosterEntry {
  if (memberOutId === ROSTER_NOBODY && memberInId === ROSTER_NOBODY) return { ok: false, code: ROSTER_REFUSED_MEMBER };
  if (memberOutId === memberInId) return { ok: false, code: ROSTER_REFUSED_MEMBER };

  const trimmed = reason.trim();
  const length = [...trimmed].length;

  if (length < OVERRIDE_REASON_MIN || length > OVERRIDE_REASON_MAX) return { ok: false, code: ROSTER_REFUSED_REASON };

  return {
    ok: true,
    memberOutId: memberOutId === ROSTER_NOBODY ? null : memberOutId,
    memberInId: memberInId === ROSTER_NOBODY ? null : memberInId,
    reason: trimmed,
  };
}

/** What a roster change's removal names (story 3.6b): the change, and the team and date it is on. */
export interface RosterRemovalTarget {
  readonly change: DayDetailRosterChange;
  readonly teamName: string;
  readonly date: string;
}

/** The listed roster change `overrideId` on `detail` — applied, pending or inert — or `null` for none. */
export function rosterRemovalTargetOf(detail: DayDetail | null, overrideId: string | null): RosterRemovalTarget | null {
  if (detail === null || overrideId === null) return null;

  const change = [...detail.rosterChanges, ...detail.rosterPending, ...detail.rosterInert].find(
    (one) => one.id === overrideId,
  );

  return change === undefined ? null : { change, teamName: detail.teamName, date: detail.date };
}

// -------------------------------------------- the day's conflicts (story 7.9)

/**
 * One unresolved conflict on the day (story 7.9): a member on leave who is
 * rostered on the shift, the leave that covers it, and the conflict's key —
 * the member, the date and the team — which its decision screen is reached by.
 */
export interface DayConflict {
  readonly memberId: string;
  /** `null` for a member the snapshot does not hold (`kalendar.detail.override.unknownAuthor`). */
  readonly memberName: string | null;
  /**
   * The leave's first and last day, `12.09.2026`; both `null` when no live
   * leave range of the member covers the date — a derivation that disagrees
   * with itself, logged — so the line is said without dates, never dropped.
   */
  readonly leaveFrom: string | null;
  readonly leaveTo: string | null;
  /** The conflict's key: `/raspored/$memberId/$date/$teamId`. */
  readonly date: string;
  readonly teamId: string;
}

/**
 * The unresolved conflicts of the day `detail`, by member name: those of
 * `collisions` (the calendar's own marks, `calendarMarksStateOf`, unresolved
 * already) on its team and date, each with the leave range of `leave` that
 * covers the date. An admin's marks alone carry collisions; a member's carry
 * none, so a member is shown none. Never throws: a collision whose leave
 * cannot be found or formatted is kept without dates, and logged, so one bad
 * entry never hides the others.
 */
export function dayConflictsOf(
  snapshot: CalendarSnapshot,
  collisions: readonly Collision[],
  leave: ReadonlyMap<string, readonly LeaveRange[]>,
  detail: DayDetail,
): readonly DayConflict[] {
  const conflicts = collisions
    .filter((collision) => collision.teamId === detail.teamId && collision.date === detail.isoDate)
    .map((collision): DayConflict => {
      const range = leave.get(collision.memberId)?.find((one) => one.from <= collision.date && collision.date <= one.to);
      const from = range === undefined ? null : formatIsoDate(range.from);
      const to = range === undefined ? null : formatIsoDate(range.to);

      const dated = from !== null && to !== null;

      if (!dated) console.error(`no leave of member ${collision.memberId} covers ${collision.date}`);

      return {
        memberId: collision.memberId,
        memberName: memberNameOf(snapshot, collision.memberId),
        leaveFrom: dated ? from : null,
        leaveTo: dated ? to : null,
        date: collision.date,
        teamId: collision.teamId,
      };
    });

  // By name, a member the snapshot does not hold last, then by id: the roster's own order.
  return conflicts.sort((left, right) => {
    if (left.memberName !== right.memberName) {
      if (left.memberName === null) return 1;
      if (right.memberName === null) return -1;

      const byName = compareText(left.memberName, right.memberName);

      if (byName !== 0) return byName;
    }

    return left.memberId < right.memberId ? -1 : left.memberId > right.memberId ? 1 : 0;
  });
}

/**
 * What a change dialog's description names (story 7.9): the team and the
 * date, and the type the day works now with its times, where it works one.
 * Operands only; the dialog words them.
 */
export interface ChangeContext {
  readonly team: string;
  readonly date: string;
  readonly type: { readonly name: string; readonly range: string | null } | null;
}

export function changeContextOf(detail: DayDetail): ChangeContext {
  return {
    team: detail.teamName,
    date: detail.date,
    type: detail.typeName === null ? null : { name: detail.typeName, range: detail.range },
  };
}
