import type { LeaveRange } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { dayMonthOf } from '@/features/calendar/utils/month';
import {
  REPLACEMENT_APPLIED,
  REPLACEMENT_MISMATCH,
  replacementContextOf,
  replacementStandingIn,
} from '@/features/conflicts/services/replacement-effect';
import { replacementLinksOf, type ReplacementLink } from '@/features/conflicts/services/resolutions';
import { FETCH_PAUSED } from '@/features/leave/services/leave-section-base';
import { compareText } from '@/lib/i18n/format';

/**
 * The replacement guard of an amend or a removal (story 5.4e). Split out of
 * `leave-section.ts` (epic 13 retro A8), which re-exports its public names;
 * it imports nothing from there.
 */

// ------------------------------------------------------ the replacement guard

/**
 * STORY 5.4e. An amend or a removal of a leave record soft-removes, inside
 * the database call, every live resolution of the member on a date the change
 * uncovers (0031). A `replace_member` resolution goes with it while its roster
 * override stays (0032), so the replacement stays rostered beside a member who
 * now works that day. Before the write, the amend preview and the removal
 * confirmation name each such replacement, one line each; the notice after a
 * landed write repeats the lines captured before it. A NOTE, NEVER A GATE:
 * nothing here disables, blocks or asks.
 */

/**
 * Whether changing `record` to `next` — null for a removal — uncovers `date`,
 * as 0031 computes it: a removal uncovers every date of the record, an amend
 * the dates in the old range and not in the new one.
 */
export function leaveUncoversDate(record: LeaveRange, next: LeaveRange | null, date: string): boolean {
  if (date < record.from || date > record.to) return false;

  return next === null || date < next.from || date > next.to;
}

/** What a replacement guard that cannot be trusted logs: never shown. */
export const REPLACEMENTS_UNAVAILABLE = 'REPLACEMENTS_UNAVAILABLE';

/** One replacement that would stay rostered: who, on which team's shift, on which date. */
export interface ReplacementWarning {
  /** The override that put them on: a line's stable identity. */
  readonly overrideId: string;
  /** The replacement's name, as the calendar's members read answers it. */
  readonly name: string;
  readonly team: string;
  /** `02.10.`, as `dayMonthOf` writes it. */
  readonly date: string;
}

/**
 * The replacements changing `record` to `next` (null: its removal) would
 * leave behind (story 5.4e): each of `links` of `memberId` dated on a date the
 * change uncovers, whose override — joined by its id, never by team and date —
 * is still live in the snapshot and actually APPLIED on its date: a working
 * shift that date, the override in force, and `rosterOn` applying it. A
 * removed or inert override gives no line. Ordered by date, then team name.
 *
 * Null — the replacements cannot be known — when a link and the override it
 * names disagree on the team or the date, a replacement's member or team is
 * not in the snapshot, or the domain refuses the roster.
 */
export function replacementWarningsOf(
  links: readonly ReplacementLink[],
  snapshot: CalendarSnapshot,
  memberId: string,
  record: LeaveRange,
  next: LeaveRange | null,
): readonly ReplacementWarning[] | null {
  const uncovered = links.filter((link) => link.memberId === memberId && leaveUncoversDate(record, next, link.date));

  if (uncovered.length === 0) return [];

  try {
    const warnings: (ReplacementWarning & { readonly isoDate: string })[] = [];
    // THE SHARED TEST (story 5.5d), its standings worked out once for every link.
    const context = replacementContextOf(snapshot);

    for (const link of uncovered) {
      const standing = replacementStandingIn(context, link);

      // THE LINK AND ITS OVERRIDE MUST AGREE: 0032 writes both from one key.
      if (standing.kind === REPLACEMENT_MISMATCH) {
        console.error(REPLACEMENTS_UNAVAILABLE, 'link');

        return null;
      }
      // Live, in force and applied on a working shift; a removed, pending or inert one gives no line.
      if (standing.kind !== REPLACEMENT_APPLIED) continue;

      const override = standing.override;
      const teamId = override.teamId;
      const date = override.date;
      const replacement = snapshot.members.find((member) => member.id === override.memberInId);
      const team = snapshot.teams.find((one) => one.id === teamId);

      if (replacement === undefined || team === undefined) {
        console.error(REPLACEMENTS_UNAVAILABLE, 'snapshot');

        return null;
      }

      warnings.push({ overrideId: override.id, name: replacement.name, team: team.name, date: dayMonthOf(date), isoDate: date });
    }

    return warnings
      .sort((left, right) => (left.isoDate === right.isoDate ? compareText(left.team, right.team) : left.isoDate < right.isoDate ? -1 : 1))
      .map(({ overrideId, name, team, date }) => ({ overrideId, name, team, date }));
  } catch (cause) {
    console.error(REPLACEMENTS_UNAVAILABLE, cause);

    return null;
  }
}

/** The replacements are known: zero or more lines. */
export const REPLACEMENTS_KNOWN = 'known';
/** The resolutions read is pending, failed or paused, or untrustworthy: one line says they cannot be checked. */
export const REPLACEMENTS_UNKNOWN = 'unknown';

export type ReplacementGuard =
  | { readonly kind: typeof REPLACEMENTS_KNOWN; readonly lines: readonly ReplacementWarning[] }
  | { readonly kind: typeof REPLACEMENTS_UNKNOWN };

/** No change is shown, or none would leave a replacement behind. */
export const NO_REPLACEMENTS: ReplacementGuard = { kind: REPLACEMENTS_KNOWN, lines: [] };

/** Whether a guard draws any line: the unknown line, or at least one replacement. */
export function replacementLinesShown(guard: ReplacementGuard | null): boolean {
  return guard !== null && (guard.kind === REPLACEMENTS_UNKNOWN || guard.lines.length !== 0);
}

/** The organization's resolutions read, as far as the guard reads it. */
export interface ReplacementResolutionsSource {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  readonly data: readonly unknown[] | undefined;
}

/**
 * The guard for changing `record` to `next` (null: its removal), from the
 * organization's resolutions read and the calendar snapshot: unknown while
 * the read is pending, failed or paused offline, or THIS MEMBER's replacement
 * rows or the replacements cannot be trusted — a malformed row of another
 * member's is not this guard's concern (`replacementLinksOf`); otherwise the
 * lines of
 * {@link replacementWarningsOf}.
 */
export function replacementGuardOf(
  resolutions: ReplacementResolutionsSource,
  snapshot: CalendarSnapshot,
  memberId: string,
  record: LeaveRange,
  next: LeaveRange | null,
): ReplacementGuard {
  if (resolutions.isPending || resolutions.isError || resolutions.fetchStatus === FETCH_PAUSED) {
    return { kind: REPLACEMENTS_UNKNOWN };
  }

  const links = resolutions.data === undefined ? null : replacementLinksOf(resolutions.data, memberId);
  const lines = links === null ? null : replacementWarningsOf(links, snapshot, memberId, record, next);

  return lines === null ? { kind: REPLACEMENTS_UNKNOWN } : { kind: REPLACEMENTS_KNOWN, lines };
}
