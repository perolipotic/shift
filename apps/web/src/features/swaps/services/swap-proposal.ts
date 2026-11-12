import {
  activeOn,
  adjacentMonth,
  memberScheduleOfMonth,
  membershipOn,
  monthOf,
  type CollisionResolution,
} from '@shift/domain';

import {
  ROSTER_CHANGE_SAVE,
  rosterChangeSnapshotOf,
  type RosterChangeApplied,
  type RosterChangeRefusal,
} from '@/features/calendar/services/roster-erasures';
import type { CalendarSnapshot, CalendarSurfaceState, CalendarViewer } from '@/features/calendar/services/snapshot';
import { memberMonthDeltasOf, type MemberMonthDelta } from '@/features/calendar/utils/change-preview';
import {
  DAY_WORKING,
  MEMBER_ROLE,
  dayDetailOf,
  swapOfferedOf,
  type DayDetail,
  type OpenSwapProposal,
} from '@/features/calendar/utils/day-detail';
import { memberScheduleInputOf } from '@/features/calendar/utils/month';
import {
  NO_LEAVE_RECORDS,
  hoursLeaveKeysOf,
  hoursLeaveRecordsOf,
  leaveRecordsIn,
  type LeaveRecordsByMember,
} from '@/features/hours/services/hours-conflicts';
import { compareText, formatIsoDate, isIsoDate } from '@/lib/i18n/format';
import { monthInMessageKey, yearOfMonthText } from '@/utils/filter-bar';

/**
 * A MEMBER PROPOSES A SWAP (story 12.2; FR-66, R9.3): the rules of
 * `/kalendar/zamjena`, as a pure `.ts` the node suite executes (AD-15). Codes
 * and operands only; the screen words them.
 *
 * THE GIVEN SHIFT is the viewer's own working shift from today on — the day
 * detail's own question (`swapOfferedOf`) over its own derivation
 * (`dayDetailOf`, `rosterOn` with the overrides in force) — so the link and
 * the form never disagree.
 *
 * THE COLLEAGUE is any member active on the date, not on the shift's roster
 * and not the viewer, by name. THE RETURN SHIFT, optional, is one of the
 * colleague's working shifts from today through the end of the month after
 * the given date, never the given shift, and never one the viewer already
 * works or is inactive on.
 *
 * THE PREVIEW NEVER BLOCKS. It is the calendar's own roster-change "after"
 * (`rosterChangeSnapshotOf`) with both changes applied — the viewer off and
 * the colleague on the given shift, then the colleague off and the viewer on
 * the return shift — and each member's hours per month through the
 * calendar's one delta (`memberMonthDeltasOf`). Only a change the roster's
 * live keys would refuse anyway (`ROSTER_TAKEN`) has no preview, and that
 * option alone says why.
 *
 * THE SEND-TIME CHECK (FR-66) is the browser's alone: the database never
 * projects a roster (AD-1, AD-3). {@link swapSendCheckOf} refuses a given
 * shift that is no longer the viewer's working shift, and a return shift no
 * longer on the colleague's roster, over the snapshot as it stands when
 * *Pošalji* is pressed, and re-derives the choice from the options, so a
 * stale choice is refused, never sent as something else. A direct API call
 * can still store one; 12.4's stale check refuses its approval.
 *
 * THE WRITE is 0049's plain insert of the seven proposal columns, its
 * refusals mapped by SQLSTATE. Nothing here reads `swap_requests`.
 */

// ---------------------------------------------------------------- the view

/** The calendar has not named the viewer yet: the skeleton. */
export const SWAP_VIEW_LOADING = 'loading';
/** The calendar failed, or named a role this page does not know: one notice and a retry. */
export const SWAP_VIEW_UNAVAILABLE = 'unavailable';
/** A member-role viewer: the form. */
export const SWAP_VIEW_MEMBER = 'member';
/** An admin: sent to `/kalendar`, where an admin changes a roster directly. */
export const SWAP_VIEW_ADMIN = 'admin';

export type SwapView =
  | typeof SWAP_VIEW_LOADING
  | typeof SWAP_VIEW_UNAVAILABLE
  | typeof SWAP_VIEW_MEMBER
  | typeof SWAP_VIEW_ADMIN;

const ADMIN_ROLE: CalendarViewer['role'] = 'admin';

/** Which body the surface draws, by the calendar snapshot's role. FAILING CLOSED: any other role is unavailable. */
export function swapViewOf(calendar: CalendarSurfaceState): SwapView {
  if (calendar.refusal !== null) return SWAP_VIEW_UNAVAILABLE;
  if (calendar.snapshot === null) return calendar.loading ? SWAP_VIEW_LOADING : SWAP_VIEW_UNAVAILABLE;

  const role: string = calendar.snapshot.viewer.role;

  if (role === ADMIN_ROLE) return SWAP_VIEW_ADMIN;
  if (role === MEMBER_ROLE) return SWAP_VIEW_MEMBER;

  return SWAP_VIEW_UNAVAILABLE;
}

// ----------------------------------------------------------------- the URL

/** `/kalendar/zamjena?dan=2026-11-20&smjena=<team id>`: the given shift. */
export interface SwapSearch {
  /** `YYYY-MM-DD`; absent when the URL names none or a malformed one. */
  readonly dan?: string;
  /** The team's id; absent when the URL names none. */
  readonly smjena?: string;
}

/** The route's search, kept only where it is a text of the right shape: anything else names no shift. */
export function swapSearchOf(search: Record<string, unknown>): SwapSearch {
  const dan = search['dan'];
  const smjena = search['smjena'];

  return {
    ...(typeof dan === 'string' && isIsoDate(dan) ? { dan } : {}),
    ...(typeof smjena === 'string' && smjena !== '' ? { smjena } : {}),
  };
}

// --------------------------------------------------------- the given shift

/** One shift: a team on a date (`YYYY-MM-DD`), as 0049 names it. */
export interface SwapShiftKey {
  readonly teamId: string;
  readonly date: string;
}

/**
 * The day detail of `teamId` on `date`, or `null` for none or one that
 * cannot be derived (the cause logged).
 */
function dayOf(snapshot: CalendarSnapshot, teamId: string, date: string): DayDetail | null {
  try {
    return dayDetailOf(snapshot, teamId, date);
  } catch (cause) {
    console.error(cause);

    return null;
  }
}

/**
 * The viewer's own working shift `teamId` on `date` as the day detail derives
 * it, or `null`: no shift named, a date before `today`, an admin viewer, a
 * day that is not a working one, or a roster the viewer is not on — the
 * notice, and no form. Since story 12.3 also a shift the viewer already
 * proposed in an open swap (`proposals`; `null` while unknown, which refuses
 * nothing): the surface then says so instead.
 */
export function ownSwapShiftOf(
  snapshot: CalendarSnapshot,
  search: SwapSearch,
  today: string | null,
  proposals: readonly OpenSwapProposal[] | null,
): DayDetail | null {
  if (search.dan === undefined || search.smjena === undefined) return null;

  const detail = dayOf(snapshot, search.smjena, search.dan);

  return swapOfferedOf(snapshot, detail, today, proposals) ? detail : null;
}

/** The day detail of `shift`, or `null` for none or one that cannot be derived (the cause logged). */
export function swapDayOf(snapshot: CalendarSnapshot, shift: SwapShiftKey): DayDetail | null {
  return dayOf(snapshot, shift.teamId, shift.date);
}

/** Whether `memberId` is on the working roster of `shift` as the day detail derives it (`rosterOn`, the overrides in force). */
export function swapShiftWorkedBy(snapshot: CalendarSnapshot, shift: SwapShiftKey, memberId: string): boolean {
  return works(dayOf(snapshot, shift.teamId, shift.date), memberId);
}

// ------------------------------------------------------------ the options

/** A colleague the form offers: shown as `Ime · čin · položaj`, as the roster form's lines read. */
export interface SwapColleague {
  readonly id: string;
  readonly name: string;
  /** Shown, never used; `null` is no rank. */
  readonly fireRank: string | null;
  /** Their position in their own team on the date; shown, never used. */
  readonly position: string | null;
  /** Why the given shift cannot pass to them ({@link ROSTER_TAKEN}), or `null`. */
  readonly blocked: RosterChangeRefusal | null;
}

/** The given shift handed from `proposerId` (the viewer, unless named) to `colleagueId`, as the roster-change "after" applies it. */
function givenApplied(
  snapshot: CalendarSnapshot,
  given: SwapShiftKey,
  colleagueId: string,
  proposerId: string = snapshot.viewer.memberId,
): RosterChangeApplied {
  return rosterChangeSnapshotOf(snapshot, {
    kind: ROSTER_CHANGE_SAVE,
    teamId: given.teamId,
    date: given.date,
    memberOutId: proposerId,
    memberInId: colleagueId,
  });
}

/** The return shift handed from `colleagueId` to `proposerId` (the viewer, unless named), over `after`. */
function returnApplied(
  after: CalendarSnapshot,
  shift: SwapShiftKey,
  colleagueId: string,
  proposerId: string = after.viewer.memberId,
): RosterChangeApplied {
  return rosterChangeSnapshotOf(after, {
    kind: ROSTER_CHANGE_SAVE,
    teamId: shift.teamId,
    date: shift.date,
    memberOutId: colleagueId,
    memberInId: proposerId,
  });
}

/** A swap as 0049 stores it, whoever the viewer is: the two members, the given shift and any return shift. */
export interface SwapParties {
  readonly proposerId: string;
  readonly addresseeId: string;
  readonly given: SwapShiftKey;
  readonly returnShift: SwapShiftKey | null;
}

/**
 * The "after" of a stored swap (story 12.3): the preview's own two changes
 * — the proposer off and the addressee on the given shift, then the
 * addressee off and the proposer on the return shift — over the calendar's
 * roster-change "after" (`rosterChangeSnapshotOf`), or its refusal.
 */
export function swapAppliedOf(snapshot: CalendarSnapshot, swap: SwapParties): RosterChangeApplied {
  const first = givenApplied(snapshot, swap.given, swap.addresseeId, swap.proposerId);

  if (!first.ok || swap.returnShift === null) return first;

  return returnApplied(first.after, swap.returnShift, swap.addresseeId, swap.proposerId);
}

/** The given shift's key, from its day detail. */
function givenKeyOf(given: DayDetail): SwapShiftKey {
  return { teamId: given.teamId, date: given.isoDate };
}

/**
 * The colleagues the given shift may go to: every member active on its date,
 * not on its roster and not the viewer, by name (the Croatian collation),
 * then by id. Each one a live roster key already names is kept, with its
 * reason, so the choice is explained rather than missing. Never throws: a
 * list that cannot be derived is empty, the cause logged.
 */
export function swapColleaguesOf(snapshot: CalendarSnapshot, given: DayDetail): readonly SwapColleague[] {
  try {
    const rostered = new Set(given.roster.map((member) => member.id));
    const colleagues: SwapColleague[] = [];

    for (const member of snapshot.members) {
      if (member.id === snapshot.viewer.memberId || rostered.has(member.id)) continue;
      if (!activeOn(member.statuses, given.isoDate)) continue;

      const applied = givenApplied(snapshot, givenKeyOf(given), member.id);

      colleagues.push({
        id: member.id,
        name: member.name,
        fireRank: member.fireRank,
        position: membershipOn(member.memberships, given.isoDate)?.position ?? null,
        blocked: applied.ok ? null : applied.code,
      });
    }

    return colleagues.sort((left, right) => compareText(left.name, right.name) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  } catch (cause) {
    console.error(cause);

    return [];
  }
}

/** A return shift the form offers: the colleague's working shift, as the day detail names it. */
export interface SwapReturnOption {
  readonly teamId: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly teamName: string;
  /** `subota 26.09.2026`, the day detail's own wording. */
  readonly day: string;
  readonly typeName: string;
  /** `19:00–07:00`; `null` for a type with no times. */
  readonly range: string | null;
  /** Why the swap cannot take this shift in return ({@link ROSTER_TAKEN}), or `null`. */
  readonly blocked: RosterChangeRefusal | null;
}

/** The value of the colleague field's placeholder: nobody chosen yet. */
export const SWAP_NO_COLLEAGUE = '';

/** The value of the return field's "none": a one-way cover. */
export const SWAP_NO_RETURN = '';

/** A return option's value in the field: its date and team, never ambiguous (an id has no `/`… and a date none either). */
export function swapReturnValueOf(shift: SwapShiftKey): string {
  return `${shift.date}/${shift.teamId}`;
}

/** The shift a return field's value names, or `null` for {@link SWAP_NO_RETURN} or anything malformed. */
export function swapReturnShiftOf(value: string): SwapShiftKey | null {
  const slash = value.indexOf('/');

  if (slash < 0) return null;

  const date = value.slice(0, slash);
  const teamId = value.slice(slash + 1);

  return isIsoDate(date) && teamId !== '' ? { teamId, date } : null;
}

/** The last month the return window reaches: the month after the given date's (FR-66 decision 3). */
function lastReturnMonthOf(given: DayDetail): string | null {
  return adjacentMonth(monthOf(given.isoDate), 1);
}

/** Whether `memberId` is on the working roster of `day`. */
function works(day: DayDetail | null, memberId: string): boolean {
  return day !== null && day.kind === DAY_WORKING && day.roster.some((member) => member.id === memberId);
}

/**
 * The colleague's working shifts the viewer may take in return: from `today`
 * through the end of the month after the given date, each a working shift
 * with the colleague on its roster (`rosterOn`, through the day detail), in
 * date order then the teams' order — never the given shift, one the viewer
 * already works, or one on a date the viewer is inactive. One the roster's
 * live keys already name is kept with its reason. Empty for a colleague the
 * snapshot does not hold; never throws (the cause logged).
 */
export function swapReturnOptionsOf(
  snapshot: CalendarSnapshot,
  given: DayDetail,
  colleagueId: string,
  today: string,
): readonly SwapReturnOption[] {
  const colleague = snapshot.members.find((member) => member.id === colleagueId);
  const last = lastReturnMonthOf(given);

  if (colleague === undefined || last === null) return [];

  try {
    const history = { memberId: colleague.id, memberships: colleague.memberships, statuses: colleague.statuses };
    const teamOrder = new Map(snapshot.teams.map((team, index) => [team.id, index]));
    const first = givenApplied(snapshot, givenKeyOf(given), colleague.id);
    const options: SwapReturnOption[] = [];
    let month: string | null = monthOf(today);

    while (month !== null && month <= last) {
      for (const day of memberScheduleOfMonth(memberScheduleInputOf(snapshot, history), month)) {
        if (day.date < today) continue;
        if (!activeOn(snapshot.viewer.statuses, day.date)) continue;

        const shifts = [...day.shifts].sort((left, right) => (teamOrder.get(left.teamId) ?? 0) - (teamOrder.get(right.teamId) ?? 0));

        for (const shift of shifts) {
          if (shift.teamId === given.teamId && day.date === given.isoDate) continue;

          const detail = dayOf(snapshot, shift.teamId, day.date);

          if (detail === null || detail.typeName === null) continue;
          if (!works(detail, colleague.id) || works(detail, snapshot.viewer.memberId)) continue;

          const key = { teamId: shift.teamId, date: day.date };
          const second = first.ok ? returnApplied(first.after, key, colleague.id) : first;

          options.push({
            ...key,
            teamName: detail.teamName,
            day: detail.date,
            typeName: detail.typeName,
            range: detail.range,
            blocked: second.ok ? null : second.code,
          });
        }
      }

      month = adjacentMonth(month, 1);
    }

    return options;
  } catch (cause) {
    console.error(cause);

    return [];
  }
}

// ------------------------------------------------------------- the preview

/** The preview: who works which date, and each member's hours per month. */
export const SWAP_PREVIEW_READY = 'ready';
/** A change the roster's live keys would refuse anyway: no preview, its reason. */
export const SWAP_PREVIEW_BLOCKED = 'blocked';

/** One date the swap changes: on `team`'s shift, `inId` works instead of `outId`. */
export interface SwapPreviewLine {
  /** `subota 26.09.2026`. */
  readonly day: string;
  readonly teamName: string;
  readonly inId: string;
  readonly outId: string;
}

export type SwapPreview =
  | {
      readonly kind: typeof SWAP_PREVIEW_READY;
      readonly lines: readonly SwapPreviewLine[];
      /** The viewer's months first, then the colleague's, each in month order; `0` included. */
      readonly hours: readonly MemberMonthDelta[];
    }
  | { readonly kind: typeof SWAP_PREVIEW_BLOCKED; readonly code: RosterChangeRefusal };

/**
 * What the swap would do once approved: `null` while no colleague is chosen,
 * for a return shift the snapshot holds no day of, or for a preview that
 * cannot be derived (the cause logged — a preview never takes the form down,
 * and never gates the send). Whether the return shift is one the window
 * offers is the options' question ({@link swapChoiceOf}), not this one's. The
 * viewer's hours count `proposerLeaveKeys`, the keys their *Sati* counts;
 * the colleague's count none, since a member reads no one else's leave (7.10).
 */
export function swapPreviewOf(
  snapshot: CalendarSnapshot,
  given: DayDetail,
  colleagueId: string,
  returnShift: SwapShiftKey | null,
  proposerLeaveKeys: readonly CollisionResolution[],
  /**
   * Story 13.5: the viewer's own leave records, by member, whose half days
   * split their shift's hours as their *Sati* does; none by default. The
   * colleague's are never read (7.10).
   */
  proposerLeaveRecords: LeaveRecordsByMember = NO_LEAVE_RECORDS,
): SwapPreview | null {
  if (colleagueId === SWAP_NO_COLLEAGUE) return null;

  try {
    const proposerId = snapshot.viewer.memberId;
    const first = givenApplied(snapshot, givenKeyOf(given), colleagueId);

    if (!first.ok) return { kind: SWAP_PREVIEW_BLOCKED, code: first.code };

    const lines: SwapPreviewLine[] = [{ day: given.date, teamName: given.teamName, inId: colleagueId, outId: proposerId }];
    let after = first.after;

    if (returnShift !== null) {
      const back = dayOf(snapshot, returnShift.teamId, returnShift.date);

      if (back === null) return null;

      const second = returnApplied(after, returnShift, colleagueId);

      if (!second.ok) return { kind: SWAP_PREVIEW_BLOCKED, code: second.code };

      after = second.after;
      lines.push({ day: back.date, teamName: back.teamName, inId: proposerId, outId: colleagueId });
    }

    const months = [...new Set([given.isoDate, ...(returnShift === null ? [] : [returnShift.date])].map(monthOf))].sort();
    const hours = memberMonthDeltasOf(
      snapshot,
      after,
      [proposerId, colleagueId],
      months,
      (memberId) => (memberId === proposerId ? proposerLeaveKeys : []),
      new Map([[proposerId, leaveRecordsIn(proposerLeaveRecords, proposerId)]]),
    );

    return { kind: SWAP_PREVIEW_READY, lines, hours };
  } catch (cause) {
    console.error(cause);

    return null;
  }
}

// ------------------------------------------------- the choice and the check

/** The given shift is no longer the viewer's working shift from today on (FR-66). */
export const SWAP_GIVEN_GONE = 'givenGone';
/** The return shift is no longer offered: off the colleague's roster, out of the window, or the viewer's (FR-66). */
export const SWAP_RETURN_GONE = 'returnGone';
/** No colleague is chosen. */
export const SWAP_NO_COLLEAGUE_CHOSEN = 'noColleague';
/** The colleague chosen is no longer offered: on the shift now, inactive that day, or gone from the snapshot. */
export const SWAP_COLLEAGUE_GONE = 'colleagueGone';
/** A live roster change already names the viewer or the colleague on a shift of the swap ({@link ROSTER_TAKEN}). */
export const SWAP_BLOCKED = 'blocked';

export type SwapCheckRefusal =
  | typeof SWAP_GIVEN_GONE
  | typeof SWAP_RETURN_GONE
  | typeof SWAP_NO_COLLEAGUE_CHOSEN
  | typeof SWAP_COLLEAGUE_GONE
  | typeof SWAP_BLOCKED;

/** What the two fields hold: a colleague's id or {@link SWAP_NO_COLLEAGUE}, a return value or {@link SWAP_NO_RETURN}. */
export interface SwapChoiceValues {
  readonly colleagueId: string;
  readonly returnValue: string;
}

/** No colleague and no return shift: the form as it opens. */
export const SWAP_NO_CHOICE: SwapChoiceValues = { colleagueId: SWAP_NO_COLLEAGUE, returnValue: SWAP_NO_RETURN };

/**
 * The fields after a colleague is chosen: the return shift was the last
 * colleague's, so it goes — even when the new colleague has the very same
 * shift on offer (a teammate), since the choice of what to take in return is
 * made for one colleague.
 */
export function swapChoiceOnColleague(_choice: SwapChoiceValues, colleagueId: string): SwapChoiceValues {
  return { colleagueId, returnValue: SWAP_NO_RETURN };
}

/** The choice resolved against the options: what would be sent, or why nothing can be. */
export type SwapChoice =
  | { readonly ok: true; readonly colleague: SwapColleague; readonly returnShift: SwapShiftKey | null }
  | { readonly ok: false; readonly code: SwapCheckRefusal };

/**
 * `choice` against the option lists as they stand: the colleague must still
 * be offered and not blocked, and a return value other than none must still
 * be offered and not blocked — never quietly sent as a one-way cover.
 */
export function swapChoiceOf(
  colleagues: readonly SwapColleague[],
  returnOptions: readonly SwapReturnOption[],
  choice: SwapChoiceValues,
): SwapChoice {
  if (choice.colleagueId === SWAP_NO_COLLEAGUE) return { ok: false, code: SWAP_NO_COLLEAGUE_CHOSEN };

  const colleague = colleagues.find((one) => one.id === choice.colleagueId);

  if (colleague === undefined) return { ok: false, code: SWAP_COLLEAGUE_GONE };
  if (colleague.blocked !== null) return { ok: false, code: SWAP_BLOCKED };
  if (choice.returnValue === SWAP_NO_RETURN) return { ok: true, colleague, returnShift: null };

  const option = returnOptions.find((one) => swapReturnValueOf(one) === choice.returnValue);

  if (option === undefined) return { ok: false, code: SWAP_RETURN_GONE };
  if (option.blocked !== null) return { ok: false, code: SWAP_BLOCKED };

  return { ok: true, colleague, returnShift: { teamId: option.teamId, date: option.date } };
}

/**
 * FR-66's send-time check, over the snapshot as it stands when *Pošalji* is
 * pressed. The given shift must still be the viewer's own working shift from
 * `today` on; the choice is resolved against the options re-derived from the
 * same snapshot ({@link swapChoiceOf}: the colleague still offered, the
 * return still offered — today or later, in the window, the viewer active
 * and off its roster — and neither blocked); and the return shift must still
 * be a working shift with the colleague on its roster (`rosterOn`, through
 * the day detail). The database asks none of these.
 */
export function swapSendCheckOf(
  snapshot: CalendarSnapshot,
  given: SwapShiftKey,
  choice: SwapChoiceValues,
  today: string | null,
): SwapChoice {
  // The proposals are not asked here: an open one is 0049's 23505 to refuse.
  const own = ownSwapShiftOf(snapshot, { dan: given.date, smjena: given.teamId }, today, null);

  if (own === null || today === null) return { ok: false, code: SWAP_GIVEN_GONE };

  const colleagues = swapColleaguesOf(snapshot, own);
  const returnOptions =
    choice.colleagueId === SWAP_NO_COLLEAGUE ? [] : swapReturnOptionsOf(snapshot, own, choice.colleagueId, today);
  const resolved = swapChoiceOf(colleagues, returnOptions, choice);

  if (!resolved.ok || resolved.returnShift === null) return resolved;
  if (!works(dayOf(snapshot, resolved.returnShift.teamId, resolved.returnShift.date), resolved.colleague.id)) {
    return { ok: false, code: SWAP_RETURN_GONE };
  }

  return resolved;
}

// ------------------------------------------------------------- the leave keys

/** The viewer's leave keys, and whether they are known. */
export interface SwapLeaveKeys {
  readonly keys: readonly CollisionResolution[];
  /** False while the resolutions are unread, failed, or cannot be trusted: the figures then count no leave. */
  readonly known: boolean;
}

/**
 * The keys the viewer's *Sati* counts as leave, from their own resolution
 * rows (`hoursLeaveKeysOf`): none, and not known, for rows not read
 * (`undefined`) or rows that cannot be trusted (the cause logged). Never a
 * gate: the preview then counts the viewer's shifts alone.
 */
export function swapLeaveKeysOf(snapshot: CalendarSnapshot, rows: readonly unknown[] | undefined): SwapLeaveKeys {
  if (rows === undefined) return { keys: [], known: false };

  try {
    return { keys: hoursLeaveKeysOf(snapshot, rows), known: true };
  } catch (cause) {
    console.error(cause);

    return { keys: [], known: false };
  }
}

/**
 * The viewer's own leave records, by member, from their `my_leave_records()`
 * rows (story 13.5), so a half day's shift counts only its worked half in a
 * swap's hours, as their *Sati* counts it. None while the rows are not read
 * (`undefined`, pending or failed) or cannot be trusted, the failure and the
 * untrusted rows logged: never a gate, and the card or form is drawn either
 * way, its hours then counting whole shifts.
 */
export function swapLeaveRecordsOf(
  snapshot: CalendarSnapshot,
  read: { readonly data: readonly unknown[] | undefined; readonly isError: boolean },
): LeaveRecordsByMember {
  if (read.isError) {
    console.error(SWAP_LEAVE_RECORDS_UNREAD, 'the own leave read failed');

    return NO_LEAVE_RECORDS;
  }

  if (read.data === undefined) return NO_LEAVE_RECORDS;

  try {
    return hoursLeaveRecordsOf(snapshot, read.data);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    console.error(SWAP_LEAVE_RECORDS_UNREAD, cause);

    return NO_LEAVE_RECORDS;
  }
}

/** What a swap's hours log when they count no half day for want of the viewer's leave read (story 13.5). */
export const SWAP_LEAVE_RECORDS_UNREAD = 'SWAP_LEAVE_RECORDS_UNREAD';

// ----------------------------------------------------------------- the write

/** The table a proposal is inserted into (0049): the one constant every reader and writer names it by. */
export { SWAP_REQUESTS_TABLE } from '@/features/swaps/services/organization-swaps';

const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';

/** An open swap already holds this shift, or that return shift (0049's partial keys, 23505). */
export const SWAP_DUPLICATE = 'duplicate';
/** Not allowed (42501): a past date, an inactive party, or the session. */
export const SWAP_DENIED = 'denied';
/** Refused by a check (23514): a proposal 0049 does not admit. */
export const SWAP_INVALID = 'invalid';
/** Anything else — the network, a malformed answer: try again. */
export const SWAP_FAILED = 'failed';

export type SwapSendFailure =
  | typeof SWAP_DUPLICATE
  | typeof SWAP_DENIED
  | typeof SWAP_INVALID
  | typeof SWAP_FAILED
  | SwapCheckRefusal;

export type SwapSendOutcome = { readonly ok: true } | { readonly ok: false; readonly code: SwapSendFailure };

export interface SwapWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

/** The one write made on `swap_requests`, named structurally so it can be stubbed: the insert. */
export interface SwapRequestInsertTable {
  insert(values: Readonly<Record<string, unknown>>): PromiseLike<{ readonly error: SwapWriteError | null }>;
}

/** A proposal as 0049's seven proposal columns take it. */
export interface SwapProposal {
  readonly organizationId: string;
  readonly proposerId: string;
  readonly addresseeId: string;
  readonly given: SwapShiftKey;
  readonly returnShift: SwapShiftKey | null;
}

/** A refused insert by SQLSTATE: 23505 duplicate, 42501 not allowed, 23514 invalid, anything else failed. */
export function swapSendFailureOf(error: SwapWriteError): SwapSendFailure {
  if (error.code === UNIQUE_VIOLATION) return SWAP_DUPLICATE;
  if (error.code === INSUFFICIENT_PRIVILEGE) return SWAP_DENIED;
  if (error.code === CHECK_VIOLATION) return SWAP_INVALID;

  return SWAP_FAILED;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Send `proposal`: 0049's plain insert. `created_by` and `created_at` come
 * from their defaults, and the answer and the close are never named (the
 * column grant refuses them).
 */
export async function sendSwapProposal(table: SwapRequestInsertTable, proposal: SwapProposal): Promise<SwapSendOutcome> {
  let answered: unknown;

  try {
    answered = await table.insert({
      organization_id: proposal.organizationId,
      proposer_id: proposal.proposerId,
      addressee_id: proposal.addresseeId,
      team_id: proposal.given.teamId,
      date: proposal.given.date,
      return_team_id: proposal.returnShift?.teamId ?? null,
      return_date: proposal.returnShift?.date ?? null,
    });
  } catch (cause) {
    console.error(SWAP_FAILED, cause);

    return { ok: false, code: SWAP_FAILED };
  }

  if (!isRecord(answered)) {
    console.error(SWAP_FAILED, typeof answered);

    return { ok: false, code: SWAP_FAILED };
  }

  const error: unknown = answered['error'];

  if (error === null) return { ok: true };
  if (!isRecord(error)) {
    console.error(SWAP_FAILED, typeof error);

    return { ok: false, code: SWAP_FAILED };
  }

  const code = swapSendFailureOf(error as SwapWriteError);

  if (code === SWAP_FAILED) console.error(code, (error as SwapWriteError).code);

  return { ok: false, code };
}

// ----------------------------------------------------- the sent line (12.2)

/** The history state the form hands *Kalendar* after a landed send. */
export const SWAP_PROPOSED_STATE = 'swapProposed';

/** What the status line on *Kalendar* names: the date, the shift and the colleague. */
export interface SwapProposed {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly teamName: string;
  readonly colleagueName: string;
  /** The shift taken in return, `YYYY-MM-DD` and its team's name; `null` for a one-way cover. */
  readonly returnShift: { readonly date: string; readonly teamName: string } | null;
}

/** The entry's state with `proposed` added under {@link SWAP_PROPOSED_STATE}, every other field kept. */
export function withSwapProposed<State extends object>(state: State, proposed: SwapProposed): State {
  return { ...state, [SWAP_PROPOSED_STATE]: proposed };
}

/** The entry's state without the line: what a reload finds. */
export function withoutSwapProposed(state: unknown): Record<string, unknown> {
  if (typeof state !== 'object' || state === null) return {};

  const { [SWAP_PROPOSED_STATE]: _proposed, ...rest } = state as Record<string, unknown>;

  return rest;
}

/** The line from router state as it came back, or `null` for none or anything malformed. */
export function swapProposedOf(state: unknown): SwapProposed | null {
  if (typeof state !== 'object' || state === null) return null;

  const proposed: unknown = (state as Record<string, unknown>)[SWAP_PROPOSED_STATE];

  if (!isRecord(proposed)) return null;

  const { date, teamName, colleagueName, returnShift } = proposed;

  if (typeof date !== 'string' || formatIsoDate(date) === null) return null;
  if (typeof teamName !== 'string' || typeof colleagueName !== 'string') return null;
  if (returnShift === null || returnShift === undefined) return { date, teamName, colleagueName, returnShift: null };
  if (!isRecord(returnShift)) return null;

  const back = { date: returnShift['date'], teamName: returnShift['teamName'] };

  if (typeof back.date !== 'string' || formatIsoDate(back.date) === null || typeof back.teamName !== 'string') return null;

  return { date, teamName, colleagueName, returnShift: { date: back.date, teamName: back.teamName } };
}

/**
 * A `YYYY-MM` as a sentence of the preview names it (UX-DR34): the month in
 * the locative, `u rujnu`, by the filter bar's own key, and its year.
 */
export function swapMonthOf(month: string): { readonly key: ReturnType<typeof monthInMessageKey>; readonly year: string } {
  return { key: monthInMessageKey(month), year: yearOfMonthText(month) };
}

/** The status line's values: the date `20.11.2026`, the shift and the colleague. */
export type SwapProposedValues = {
  readonly date: string;
  readonly team: string;
  readonly name: string;
};

/** The status line's words and values: with the shift taken in return where there was one. */
export type SwapProposedLine =
  | { readonly withReturn: false; readonly key: 'kalendar.swap.sent'; readonly values: SwapProposedValues }
  | {
      readonly withReturn: true;
      readonly key: 'kalendar.swap.sentWithReturn';
      readonly values: SwapProposedValues & { readonly returnDate: string; readonly returnTeam: string };
    };

/** The line as it names the swap: the date, the shift and the colleague, and the return shift if any. */
export function swapProposedValuesOf(proposed: SwapProposed): SwapProposedLine {
  const values = { date: formatIsoDate(proposed.date) ?? proposed.date, team: proposed.teamName, name: proposed.colleagueName };
  const key = swapProposedMessageKey(proposed.returnShift !== null);

  if (proposed.returnShift === null || key === 'kalendar.swap.sent') return { withReturn: false, key: 'kalendar.swap.sent', values };

  return {
    withReturn: true,
    key,
    values: {
      ...values,
      returnDate: formatIsoDate(proposed.returnShift.date) ?? proposed.returnShift.date,
      returnTeam: proposed.returnShift.teamName,
    },
  };
}

/** The status line's message, with or without a shift taken in return. */
export function swapProposedMessageKey(withReturn: boolean): 'kalendar.swap.sent' | 'kalendar.swap.sentWithReturn' {
  return withReturn ? 'kalendar.swap.sentWithReturn' : 'kalendar.swap.sent';
}

/** What the line does on one location: what it shows, and whether the entry is cleared. */
export interface SwapProposedStep {
  readonly shown: SwapProposed | null;
  readonly clear: boolean;
  readonly clearing: boolean;
}

/**
 * The line on one location (the *Godišnji* sent line's rule): a location that
 * brings it shows it and clears it off the entry, so a reload or Back finds
 * none; the clearing replace keeps it; any other location drops it.
 */
export function swapProposedStepOf(shown: SwapProposed | null, state: unknown, clearing: boolean): SwapProposedStep {
  const arrived = swapProposedOf(state);

  if (arrived !== null) return { shown: arrived, clear: true, clearing: true };
  if (clearing) return { shown, clear: false, clearing: false };

  return { shown: null, clear: false, clearing: false };
}

// ------------------------------------------------------------- the words

/** The message a refused send says, by its code. */
export function swapSendMessageKey(
  code: SwapSendFailure,
):
  | 'kalendar.swap.duplicate'
  | 'kalendar.swap.denied'
  | 'kalendar.swap.invalid'
  | 'kalendar.swap.failed'
  | 'kalendar.swap.givenGone'
  | 'kalendar.swap.returnGone'
  | 'kalendar.swap.noColleague'
  | 'kalendar.swap.colleagueGone'
  | 'kalendar.swap.blocked' {
  switch (code) {
    case SWAP_DUPLICATE:
      return 'kalendar.swap.duplicate';
    case SWAP_DENIED:
      return 'kalendar.swap.denied';
    case SWAP_INVALID:
      return 'kalendar.swap.invalid';
    case SWAP_FAILED:
      return 'kalendar.swap.failed';
    case SWAP_GIVEN_GONE:
      return 'kalendar.swap.givenGone';
    case SWAP_RETURN_GONE:
      return 'kalendar.swap.returnGone';
    case SWAP_NO_COLLEAGUE_CHOSEN:
      return 'kalendar.swap.noColleague';
    case SWAP_COLLEAGUE_GONE:
      return 'kalendar.swap.colleagueGone';
    case SWAP_BLOCKED:
      return 'kalendar.swap.blocked';
    default: {
      const unhandled: never = code;

      return unhandled;
    }
  }
}
