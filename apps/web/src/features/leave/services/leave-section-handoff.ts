import type { LeaveRange } from '@shift/domain';

import type { LeaveRecordRow } from '@/features/leave/services/leave-section-base';
import { LEAVE_AMEND_ACTION, LEAVE_REMOVE_ACTION } from '@/features/leave/services/leave-section-outcome';
import { isIsoDate, nextIsoDate, previousIsoDate } from '@/lib/i18n/format';

/**
 * The date rule and the hand-off from a conflict (story 5.4d). Split out of
 * `leave-section.ts` (epic 13 retro A8), which re-exports its public names;
 * it imports nothing from there.
 */

// ------------------------------------------------------------- the hand-off

/**
 * STORY 5.4d's date rule, here because both ends apply it: the resolution
 * screen's third card states it, and the leave card re-applies it to the
 * record as it is on arrival.
 */

/** The leave starts the day after the conflict: the record runs past it. */
export const AMEND_STARTS = 'starts';
/** The leave ends the day before the conflict: it is the record's last day. */
export const AMEND_ENDS = 'ends';
/** The record is removed: it is one day, the conflict's. */
export const AMEND_REMOVES = 'removes';

export type ResolutionAmendKind = typeof AMEND_STARTS | typeof AMEND_ENDS | typeof AMEND_REMOVES;

/** The range that would clear a conflict (rule A): a new range, or the record removed. */
export type ResolutionAmendTarget =
  | { readonly kind: typeof AMEND_STARTS | typeof AMEND_ENDS; readonly range: { readonly from: string; readonly to: string } }
  | { readonly kind: typeof AMEND_REMOVES };

/**
 * THE DATE RULE (rule A, human, 2026-10-02): for a record running `from`–`to`
 * and the conflict's date `d` — before the end, the leave starts on `d + 1`;
 * on the last day of a longer record, it ends on `d − 1`; a one-day record is
 * removed. A computation, never a recommendation.
 *
 * @throws RangeError when `d` is not inside the record, or a neighbouring day cannot be named.
 */
export function amendTargetOf(record: { readonly from: string; readonly to: string }, date: string): ResolutionAmendTarget {
  if (date < record.from || date > record.to) {
    throw new RangeError(`the date ${date} is not inside the leave ${record.from}–${record.to}`);
  }

  if (date < record.to) {
    const from = nextIsoDate(date);

    if (from === null) throw new RangeError(`the date ${date} has no next day`);

    return { kind: AMEND_STARTS, range: { from, to: record.to } };
  }

  if (record.from < date) {
    const to = previousIsoDate(date);

    if (to === null) throw new RangeError(`the date ${date} has no previous day`);

    return { kind: AMEND_ENDS, range: { from: record.from, to } };
  }

  return { kind: AMEND_REMOVES };
}

/**
 * THE HAND-OFF FROM A CONFLICT (story 5.4d). The resolution screen's third
 * card writes nothing: its Spremi comes here with the record, the range that
 * would clear the conflict — or that the record is removed — and the conflict
 * it came from, in ROUTER STATE only, never the URL and never storage. The
 * card opens it once its rows are ready, through its own amend or removal:
 * there is no other leave write path.
 *
 * TWO KEYS, so the opening can go and the origin stay: once the card has
 * opened it, or found it does not apply, the entry is replaced without
 * {@link LEAVE_HANDOFF_STATE} — a reload or Back never reopens it — while
 * {@link LEAVE_HANDOFF_ORIGIN_STATE} keeps "Natrag na Za odluku".
 */
export const LEAVE_HANDOFF_STATE = 'leaveHandoff';
export const LEAVE_HANDOFF_ORIGIN_STATE = 'leaveHandoffOrigin';

/** The conflict a hand-off came from: the resolution route's three params. */
export interface LeaveHandoffOrigin {
  readonly memberId: string;
  readonly date: string;
  readonly teamId: string;
}

export type LeaveHandoff =
  | {
      readonly kind: typeof LEAVE_AMEND_ACTION;
      readonly recordId: string;
      readonly range: LeaveRange;
      readonly origin: LeaveHandoffOrigin;
    }
  | { readonly kind: typeof LEAVE_REMOVE_ACTION; readonly recordId: string; readonly origin: LeaveHandoffOrigin };

/** The history entry's state with `handoff` and its origin added, every other field kept. */
export function withLeaveHandoff<State extends object>(state: State, handoff: LeaveHandoff): State {
  return { ...state, [LEAVE_HANDOFF_STATE]: handoff, [LEAVE_HANDOFF_ORIGIN_STATE]: handoff.origin };
}

/** The history entry's state without the opening, its origin and every other field kept: what a reload or Back finds. */
export function withoutLeaveHandoffOpening(state: unknown): Record<string, unknown> {
  if (typeof state !== 'object' || state === null) return {};

  const { [LEAVE_HANDOFF_STATE]: _opening, ...rest } = state as Record<string, unknown>;

  return rest;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** An origin as it came back, or `null` for anything malformed. */
function originOf(origin: unknown): LeaveHandoffOrigin | null {
  if (typeof origin !== 'object' || origin === null) return null;

  const { memberId, date, teamId } = origin as Record<string, unknown>;

  if (!isText(memberId) || typeof date !== 'string' || !isIsoDate(date) || !isText(teamId)) return null;

  return { memberId, date, teamId };
}

/** The conflict the page was reached from, for "Natrag na Za odluku", or `null` when it was not. */
export function leaveHandoffOriginOf(state: unknown): LeaveHandoffOrigin | null {
  if (typeof state !== 'object' || state === null) return null;

  return originOf((state as Record<string, unknown>)[LEAVE_HANDOFF_ORIGIN_STATE]);
}

/** The hand-off from router state as it came back, or `null` for none, one already opened, or anything malformed. */
export function leaveHandoffOf(state: unknown): LeaveHandoff | null {
  if (typeof state !== 'object' || state === null) return null;

  const handoff: unknown = (state as Record<string, unknown>)[LEAVE_HANDOFF_STATE];

  if (typeof handoff !== 'object' || handoff === null) return null;

  const { kind, recordId, range, origin: rawOrigin } = handoff as Record<string, unknown>;
  const origin = originOf(rawOrigin);

  if (!isText(recordId) || origin === null) return null;
  if (kind === LEAVE_REMOVE_ACTION) return { kind, recordId, origin };
  if (kind !== LEAVE_AMEND_ACTION || typeof range !== 'object' || range === null) return null;

  const { from: start, to: end } = range as Record<string, unknown>;

  if (typeof start !== 'string' || typeof end !== 'string' || !isIsoDate(start) || !isIsoDate(end) || end < start) {
    return null;
  }

  return { kind, recordId, range: { from: start, to: end }, origin };
}

/** A hand-off's identity, for opening each one once: equal for equal hand-offs. */
export function leaveHandoffKeyOf(handoff: LeaveHandoff | null): string | null {
  return handoff === null ? null : JSON.stringify(handoff);
}

/** What a hand-off opens on the card: amend mode with the range, or the removal confirmation. */
export type LeaveHandoffOpening =
  | { readonly kind: typeof LEAVE_AMEND_ACTION; readonly row: LeaveRecordRow; readonly range: LeaveRange }
  | { readonly kind: typeof LEAVE_REMOVE_ACTION; readonly row: LeaveRecordRow };

/**
 * What `handoff` opens over the member's ready rows: amend mode for its
 * record, or that record's removal confirmation — by the rule RE-APPLIED to
 * the record as it is now ({@link amendTargetOf}), never the range handed
 * over, so a record lengthened elsewhere is never removed and one shortened
 * is never stretched back. `null` — nothing opens, the card stays as it was
 * — when there is no hand-off, it is about another member, its record is
 * gone, or the record no longer covers the conflict's date.
 */
export function leaveHandoffOpeningOf(
  handoff: LeaveHandoff | null,
  memberId: string,
  rows: readonly LeaveRecordRow[],
): LeaveHandoffOpening | null {
  if (handoff === null || handoff.origin.memberId !== memberId) return null;

  const row = rows.find((one) => one.record.id === handoff.recordId);
  const date = handoff.origin.date;

  if (row === undefined || date < row.record.from || date > row.record.to) return null;

  let target: ResolutionAmendTarget;

  try {
    target = amendTargetOf(row.record, date);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    return null;
  }

  return target.kind === AMEND_REMOVES
    ? { kind: LEAVE_REMOVE_ACTION, row }
    : { kind: LEAVE_AMEND_ACTION, row, range: target.range };
}

/**
 * Whether the card says a hand-off opened nothing: it was about this member,
 * yet {@link leaveHandoffOpeningOf} found no opening — the record is gone or
 * no longer covers the conflict's date. No hand-off, or one about another
 * member, says nothing.
 */
export function leaveHandoffMissed(
  handoff: LeaveHandoff | null,
  memberId: string,
  opening: LeaveHandoffOpening | null,
): boolean {
  return handoff !== null && handoff.origin.memberId === memberId && opening === null;
}
