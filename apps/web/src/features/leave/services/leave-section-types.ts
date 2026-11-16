import type { AbsenceTypeRow } from '@/features/absence-types/services/list';
import { absenceTypesOfCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { LEAVE_READY, LEAVE_UNAVAILABLE, type MemberLeaveBase } from '@/features/leave/services/leave-section-base';

/**
 * The absence type a leave surface offers, names and sends (story 13.2b).
 * Split out of `leave-section.ts` (epic 13 retro A8), which re-exports its
 * public names; it imports nothing from there.
 */

/**
 * The absence type a range is previewed and sent as (story 13.2b): its id,
 * and whether it draws down the allowance, from the calendar snapshot's
 * catalog.
 */
export interface LeaveTypeChoice {
  readonly id: string;
  readonly drawsAllowance: boolean;
}

// ------------------------------------------------------------ the type (13.2b)

/** What a type catalog that cannot be trusted logs: never shown. */
export const LEAVE_TYPES_UNAVAILABLE = 'LEAVE_TYPES_UNAVAILABLE';

/**
 * The absence types a leave surface offers and names (story 13.2b): the
 * calendar snapshot's catalog, in its order, when every id in `named` — the
 * records or requests the surface shows — is in it. Null — the surface is
 * unavailable, never a guess — for no snapshot, a snapshot cached before 13.2
 * that carries no catalog, an empty catalog (no card could be chosen; every
 * organization holds annual leave), or an id the catalog does not hold.
 */
export function leaveTypesOf(
  snapshot: CalendarSnapshot | null,
  named: readonly string[],
): readonly AbsenceTypeRow[] | null {
  if (snapshot === null) return null;

  const types = absenceTypesOfCalendar(snapshot);

  if (types === null || types.length === 0) {
    console.error(LEAVE_TYPES_UNAVAILABLE, 'catalog');

    return null;
  }

  const known = new Set(types.map((type) => type.id));

  if (!named.every((id) => known.has(id))) {
    console.error(LEAVE_TYPES_UNAVAILABLE, 'type');

    return null;
  }

  return types;
}

/** The type of `id` in `types` as a choice, or null when none is chosen or it is not there. */
export function leaveTypeChoiceOf(types: readonly AbsenceTypeRow[] | null, id: string | null): LeaveTypeChoice | null {
  const type = id === null || types === null ? undefined : types.find((candidate) => candidate.id === id);

  return type === undefined ? null : { id: type.id, drawsAllowance: type.drawsAllowance };
}

/** The stored name of type `id`, or null when `types` does not hold it. */
export function leaveTypeNameOf(types: readonly AbsenceTypeRow[] | null, id: string): string | null {
  return types?.find((type) => type.id === id)?.name ?? null;
}

/**
 * The admin card's base with its type catalog (story 13.2b): a ready base
 * whose snapshot carries no catalog, or one of whose records names a type
 * the catalog lacks, is unavailable, never drawn with a guessed name.
 */
export function typedLeaveBaseOf(
  base: MemberLeaveBase,
  snapshot: CalendarSnapshot | null,
): { readonly base: MemberLeaveBase; readonly types: readonly AbsenceTypeRow[] | null } {
  if (base.kind !== LEAVE_READY) return { base, types: null };

  const types = leaveTypesOf(snapshot, base.input.records.map((record) => record.absenceTypeId));

  return types === null ? { base: { kind: LEAVE_UNAVAILABLE }, types: null } : { base, types };
}
