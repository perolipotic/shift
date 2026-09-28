import {
  MODE_MOJ,
  defaultModeOf,
  isCalendarMode,
  type CalendarMode,
  type CalendarSearch,
} from '@/features/calendar/utils/month';
import { memberRoleOf } from '@/features/navigation/services/role';
import type { MemberRole } from '@/features/navigation/utils/destinations';

/**
 * What the calendar shows while the one read is unanswered — the mode switch
 * and the skeleton's shape — so the screen loads in the shape it will show and
 * nothing jumps when the snapshot lands.
 *
 * THE ROLE IS NOT READ HERE. The mode a search names needs no role; the
 * default mode does (`defaultModeOf`), and it arrives with the snapshot. What
 * the screen may use before that is the chrome's answer already in the cache
 * under `MEMBER_ROLE_KEY` — never a read of its own — and with no answer there
 * the mode is unknown, no switch shows, and the skeleton stays the grid it
 * always was.
 *
 * PURE, and executed by the node suite (AD-15).
 */

/** The grid's skeleton: a row per date and a column per team. */
export const SKELETON_GRID = 'grid';

/** The day list's skeleton: a row per date, the date beside one bar. */
export const SKELETON_LIST = 'list';

export type CalendarSkeletonShape = typeof SKELETON_GRID | typeof SKELETON_LIST;

/**
 * The role a cached `MEMBER_ROLE_KEY` answer carries, or `null` when there is
 * no answer yet, the answer is a failure, or it names no role this build knows.
 */
export function cachedRoleOf(answer: unknown): MemberRole | null {
  if (typeof answer !== 'object' || answer === null) return null;

  const outcome = answer as { readonly ok?: unknown; readonly role?: unknown };

  return outcome.ok === true ? memberRoleOf(outcome.role) : null;
}

/**
 * The mode before the snapshot lands: the search's, or the default for a known
 * role, or `null` while neither decides. With the snapshot's own role equal to
 * the cached one, it is the mode `calendarModeOf` then returns.
 */
export function earlyCalendarModeOf(
  search: CalendarSearch,
  role: MemberRole | null,
  isPhone: boolean,
): CalendarMode | null {
  if (isCalendarMode(search.prikaz)) return search.prikaz;

  return role === null ? null : defaultModeOf(role, isPhone);
}

/**
 * The skeleton's shape: the day list when the screen will show one — *Moj
 * raspored*, by the search or by the default mode for a known role, or a
 * person chosen in *Sve smjene* — and the grid otherwise. A person chosen with
 * no mode named is the day list whichever the default is: *Moj raspored* is
 * one, and *Sve smjene* shows that person's. (A person id the snapshot does
 * not know is ignored for the grid once it lands, which only a hand-edited URL
 * produces.)
 */
export function calendarSkeletonShapeOf(
  search: CalendarSearch,
  role: MemberRole | null,
  isPhone: boolean,
): CalendarSkeletonShape {
  const mode = earlyCalendarModeOf(search, role, isPhone);

  if (mode === MODE_MOJ || search.osoba !== undefined) return SKELETON_LIST;

  return SKELETON_GRID;
}
