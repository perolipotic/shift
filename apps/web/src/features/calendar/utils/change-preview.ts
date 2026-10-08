import { memberHoursOfMonth, monthOf, type CollisionResolution } from '@shift/domain';

import { ROSTER_CHANGE_SAVE, rosterChangeSnapshotOf } from '@/features/calendar/services/roster-erasures';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { OVERRIDE_NO_TYPE, ROSTER_NOBODY, dayDetailOf, type DayDetail } from '@/features/calendar/utils/day-detail';
import { OVERRIDE_CHANGE_SET, overrideChangeSnapshotOf } from '@/features/conflicts/services/override-erasures';
import { memberHoursInputOf } from '@/features/hours/services/my-hours';

/**
 * WHAT A CHANGE OF ONE DAY WOULD DO, before it is saved (story 7.9): the
 * *Što se mijenja* of the day detail's two change dialogs, as a pure model in
 * a `.ts` that renders nothing (AD-15). Codes and operands only — names, ids
 * and minutes — and the i18n layer words them.
 *
 * NOTHING IS PROJECTED HERE. The day after the change is the "after" snapshot
 * the erasure check already builds (`overrideChangeSnapshotOf`,
 * `rosterChangeSnapshotOf`), read through the day detail's own derivation
 * (`dayDetailOf`) — the same type, range and roster the day detail shows. The
 * hours are `memberHoursOfMonth` through *Sati*'s own input
 * (`memberHoursInputOf`), over the before and after snapshots, for the
 * month of the date: the very figure *Sati* would show.
 *
 * WHOSE HOURS: a change of one team on one date moves the hours of the
 * members on that shift alone — before it or after it — so the delta is
 * worked out for the union of the two rosters, and only a non-zero one is
 * kept. Members with the same delta are one group, the groups by delta
 * (losses first), each in the roster's order.
 *
 * A change the write would refuse anyway, or one that is not a change (the
 * projected type, or nobody on either side), has no preview.
 */

/** A type as the day shows it: its name, and `19:00–07:00` or `null` for a type with no times or a non-working one. */
export interface TypeFact {
  readonly name: string;
  readonly range: string | null;
}

/** Members whose month moves by the same minutes. */
export interface HourDelta {
  /** Never 0: a member whose hours do not move is not listed. */
  readonly deltaMinutes: number;
  readonly memberIds: readonly string[];
}

/** What a change would do to the day, as codes and operands. */
export interface ChangePreview {
  /**
   * The day's type before and after: only when it changes; a side with no
   * rotation (no type at all) is `null`.
   */
  readonly type: { readonly from: TypeFact | null; readonly to: TypeFact | null } | null;
  /**
   * Who leaves the shift and who arrives on it, by id: only for a roster
   * change — a type change moves the whole shift, never one member — and
   * `null` on a side with nobody.
   */
  readonly roster: { readonly out: string | null; readonly in: string | null } | null;
  readonly hours: readonly HourDelta[];
}

/**
 * The type `day` works, as a fact.
 *
 * @throws RangeError for a type the snapshot lacks.
 */
function typeFactOf(snapshot: CalendarSnapshot, day: DayDetail): TypeFact | null {
  if (day.shiftTypeId === null) return null;

  const type = snapshot.types.find((one) => one.id === day.shiftTypeId);

  if (type === undefined) throw new RangeError(`shift type ${day.shiftTypeId} is not in the snapshot`);

  return { name: type.name, range: day.range };
}

/**
 * The hours each member on either roster gains or loses, grouped by delta.
 *
 * @throws RangeError on any precondition of `memberHoursOfMonth`.
 */
function hourDeltasOf(
  before: CalendarSnapshot,
  after: CalendarSnapshot,
  dayBefore: DayDetail,
  dayAfter: DayDetail,
  leaveKeys: readonly CollisionResolution[],
): readonly HourDelta[] {
  const month = monthOf(dayBefore.isoDate);
  const ids = [...new Set([...dayBefore.roster, ...dayAfter.roster].map((member) => member.id))];
  const groups = new Map<number, string[]>();

  for (const id of ids) {
    const member = before.members.find((one) => one.id === id) ?? after.members.find((one) => one.id === id);

    // A member the snapshot does not hold has no history to count hours by.
    if (member === undefined) continue;

    const history = { memberId: member.id, memberships: member.memberships, statuses: member.statuses };
    const minutesIn = (snapshot: CalendarSnapshot) =>
      memberHoursOfMonth(memberHoursInputOf(snapshot, history, leaveKeys), month).totalMinutes;
    const delta = minutesIn(after) - minutesIn(before);

    if (delta === 0) continue;

    const group = groups.get(delta);

    if (group === undefined) groups.set(delta, [member.id]);
    else group.push(member.id);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([deltaMinutes, memberIds]) => ({ deltaMinutes, memberIds }));
}

/**
 * The preview of the day `detail` as `after` holds it.
 *
 * @throws RangeError on any precondition of `dayDetailOf` or `memberHoursOfMonth`.
 */
function previewOf(
  before: CalendarSnapshot,
  after: CalendarSnapshot,
  detail: DayDetail,
  leaveKeys: readonly CollisionResolution[],
  /** Whether the change is a roster change, the one that moves members one by one. */
  rosterChange: boolean,
): ChangePreview | null {
  const dayBefore = dayDetailOf(before, detail.teamId, detail.isoDate);
  const dayAfter = dayDetailOf(after, detail.teamId, detail.isoDate);

  if (dayBefore === null || dayAfter === null) return null;

  const type =
    dayBefore.shiftTypeId === dayAfter.shiftTypeId
      ? null
      : { from: typeFactOf(before, dayBefore), to: typeFactOf(after, dayAfter) };
  const beforeIds = new Set(dayBefore.roster.map((member) => member.id));
  const afterIds = new Set(dayAfter.roster.map((member) => member.id));
  // ONE ROW, at most one member each way: the after snapshot's roster less the before's, and the other way round.
  const out = rosterChange ? (dayBefore.roster.find((member) => !afterIds.has(member.id))?.id ?? null) : null;
  const put = rosterChange ? (dayAfter.roster.find((member) => !beforeIds.has(member.id))?.id ?? null) : null;

  return {
    type,
    roster: out === null && put === null ? null : { out, in: put },
    hours: hourDeltasOf(before, after, dayBefore, dayAfter, leaveKeys),
  };
}

/** {@link previewOf}, guarded: a preview that cannot be derived is none, the cause logged, so it never takes the dialog down. */
function guarded(derive: () => ChangePreview | null): ChangePreview | null {
  try {
    return derive();
  } catch (cause) {
    console.error(cause);

    return null;
  }
}

/**
 * What setting `shiftTypeId` on the day `detail` would do; `null` for no type
 * chosen, the projected type (the form's own `sameAsProjected` refusal), an
 * override the write would refuse anyway, or a preview that cannot be derived.
 */
export function overridePreviewOf(
  snapshot: CalendarSnapshot | null,
  detail: DayDetail | null,
  shiftTypeId: string,
  leaveKeys: readonly CollisionResolution[],
): ChangePreview | null {
  if (snapshot === null || detail === null) return null;
  if (shiftTypeId === OVERRIDE_NO_TYPE || shiftTypeId === detail.projectedShiftTypeId) return null;

  return guarded(() => {
    const applied = overrideChangeSnapshotOf(snapshot, {
      kind: OVERRIDE_CHANGE_SET,
      teamId: detail.teamId,
      date: detail.isoDate,
      shiftTypeId,
    });

    return applied.ok ? previewOf(snapshot, applied.after, detail, leaveKeys, false) : null;
  });
}

/**
 * What taking `memberOutId` off and putting `memberInId` on the shift of
 * `detail` would do ({@link ROSTER_NOBODY} for nobody on a side); `null` for
 * nobody on either side, one member on both, a change the write would refuse
 * anyway, or a preview that cannot be derived.
 */
export function rosterPreviewOf(
  snapshot: CalendarSnapshot | null,
  detail: DayDetail | null,
  memberOutId: string,
  memberInId: string,
  leaveKeys: readonly CollisionResolution[],
): ChangePreview | null {
  if (snapshot === null || detail === null) return null;
  if (memberOutId === memberInId) return null;

  return guarded(() => {
    const applied = rosterChangeSnapshotOf(snapshot, {
      kind: ROSTER_CHANGE_SAVE,
      teamId: detail.teamId,
      date: detail.isoDate,
      memberOutId: memberOutId === ROSTER_NOBODY ? null : memberOutId,
      memberInId: memberInId === ROSTER_NOBODY ? null : memberInId,
    });

    return applied.ok ? previewOf(snapshot, applied.after, detail, leaveKeys, true) : null;
  });
}

/** A member a preview names, through the snapshot's members; `null` for one it does not hold. */
export function previewMemberNameOf(snapshot: CalendarSnapshot | null, memberId: string): string | null {
  return snapshot?.members.find((member) => member.id === memberId)?.name ?? null;
}
