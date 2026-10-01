import { activeOn, datesOfMonth, memberHoursOfMonth, membershipOn, type Collision, type MemberHours } from '@shift/domain';

import {
  type CalendarMember,
  type CalendarSnapshot,
  type CalendarSurfaceState,
} from '@/features/calendar/services/snapshot';
import {
  MODE_SVE,
  monthHeaderOf,
  monthShownOf,
  type CalendarSearch,
  type MonthHeader,
} from '@/features/calendar/utils/month';
import { conflictCountIn, conflictCountsOf, type HoursConflictsState } from '@/features/hours/services/hours-conflicts';
import {
  BAND_SORT_PREFIX,
  HOURS_UNAVAILABLE,
  SORT_DOWN,
  SORT_LEAVE,
  SORT_NAME,
  SORT_SHIFTS,
  SORT_TEAM,
  SORT_TOTAL,
  SORT_UP,
  hoursReadsOf,
  memberHoursInputOf,
  monthShownHeaderOf,
  myHoursSurfaceOf,
  myHoursViewOf,
  type HoursBandRow,
  type HoursFailure,
  type HoursFigure,
  type HoursSearch,
  type HoursSearchChange,
  type HoursSortDirection,
  type HoursSortKey,
  type MyHoursSurface,
} from '@/features/hours/services/my-hours';
import { compareText } from '@/lib/i18n/format';

/**
 * *Sati* for an admin: every member's month of hours in one table (story
 * 4.2) — sortable, filterable by team and person, each name a way into that
 * member's calendar month, where the roster changes behind a figure show.
 *
 * EVERY RULE OF THE TABLE IS HERE (AD-15), and the node suite executes it:
 * which members are rows, each row's team, the filter options, the filter,
 * the sort, the calendar link, the untimed note and the guarded outcome.
 *
 * NO HOUR IS COMPUTED HERE (AD-3, AD-7). Each row is `memberHoursOfMonth`'s
 * answer for that member through `memberHoursInputOf` — the recipe the
 * viewer's own *Sati* uses — over the calendar's ONE snapshot (AD-13), and its
 * figures are `myHoursViewOf`'s, so a member's own screen and the admin's row
 * for them cannot disagree. The only sum is the untimed shifts of the rows
 * shown, a count of shifts, never of hours.
 *
 * EACH ROW CARRIES ITS CONFLICT COUNT (story 5.3d): the member's shifts in
 * unresolved conflict in the month, `./hours-conflicts`'s count over the
 * organization's collisions, beside the figures it changes none of. It is no
 * sort key.
 */

/** A band's column: its id and its name as stored, in band order. */
export interface HoursBandColumn {
  readonly bandId: string;
  readonly name: string;
  /** The `sort` value that sorts by it. */
  readonly sortKey: HoursSortKey;
}

/** A team a row names, or the team filter offers. */
export interface HoursTeam {
  readonly id: string;
  readonly name: string;
}

/** One member's row of the organization's table. */
export interface OrganizationHoursRow {
  readonly memberId: string;
  readonly name: string;
  /**
   * Their team on their last active date of the month (`membershipOn`), or
   * `null` for none — drawn `—`, and outside every team filter.
   */
  readonly team: HoursTeam | null;
  readonly shiftCount: number;
  /** One cell per band column, in the same order: its hours and its shifts. */
  readonly bands: readonly HoursBandRow[];
  readonly total: HoursFigure;
  /** The month's leave, or `null` when it is 0 — drawn `—` (`MyHoursView.leave`). */
  readonly leave: HoursFigure | null;
  /** Working shifts with no times, counted as shifts and never in hours. */
  readonly untimedShiftCount: number;
  /** The month's working shifts in unresolved conflict, 0 included: the table and the file show a zero. */
  readonly conflictCount: number;
  /** Where the name leads: `/kalendar?prikaz=sve&osoba=<id>&mjesec=<month>`. */
  readonly calendar: CalendarSearch;
  /** The domain's answer, which the sort orders by. */
  readonly hours: MemberHours;
}

/** The table's sort: a column and a direction. */
export interface HoursSort {
  readonly key: HoursSortKey;
  readonly direction: HoursSortDirection;
}

/** The order the table opens in: by name, ascending. */
export const DEFAULT_HOURS_SORT: HoursSort = { key: SORT_NAME, direction: SORT_UP };

/** The fixed columns the table draws besides a column per band: member, team, shifts, total, leave, conflicts. */
const FIXED_COLUMN_COUNT = 6;

/** The organization's month, ready to render. */
export interface OrganizationHoursView {
  readonly header: MonthHeader;
  /** Every band, in start order; none with no bands. */
  readonly bands: readonly HoursBandColumn[];
  /** The rows shown: filtered, then sorted. */
  readonly rows: readonly OrganizationHoursRow[];
  /** How many rows the month has before any filter. */
  readonly rowCount: number;
  readonly sort: HoursSort;
  /** The team filter's options: every team some row names, by name. */
  readonly teams: readonly HoursTeam[];
  /** The team the table IS narrowed to, one of `teams`; `null` for all. */
  readonly team: string | null;
  /** The person filter's options: every member with a row, in name order. */
  readonly people: readonly { readonly id: string; readonly name: string }[];
  /** The person the table IS narrowed to, one of `people`; `null` for all. */
  readonly person: string | null;
  /**
   * The search the table stands for, stale parameters dropped: what every
   * filter and sort change starts from.
   */
  readonly search: HoursSearch;
  /** The untimed shifts of the rows shown, or `null` when there are none. */
  readonly untimedShiftCount: number | null;
  /** How many columns a row has: the fixed six and one per band. */
  readonly columnCount: number;
  /** The line an empty table shows, or `null` while it has a row. */
  readonly empty: HoursEmptyMessageKey | null;
}

export type OrganizationHoursOutcome =
  | { readonly ok: true; readonly view: OrganizationHoursView }
  | { readonly ok: false; readonly code: HoursFailure };

/** A band column's `sort` value. */
export function bandSortKeyOf(bandId: string): HoursSortKey {
  return `${BAND_SORT_PREFIX}${bandId}`;
}

/** Where a member's name leads: their calendar month, in *Sve smjene*. */
export function calendarLinkSearchOf(memberId: string, month: string): CalendarSearch {
  return { prikaz: MODE_SVE, osoba: memberId, mjesec: month };
}

/** The last date of `dates` the member is active on, or `null` for none. */
function lastActiveDateOf(member: CalendarMember, dates: readonly string[]): string | null {
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    const date = dates[index];

    if (date !== undefined && activeOn(member.statuses, date)) return date;
  }

  return null;
}

/**
 * Every row of `month`, in the snapshot's name order: each member active on
 * at least one of its dates, and any member with a shift in it — each with
 * their conflicts of the month counted from `collisions`.
 *
 * @throws RangeError on any precondition of the domain, a band the snapshot
 *   lacks, or a team the snapshot does not name.
 */
export function organizationHoursRowsOf(
  snapshot: CalendarSnapshot,
  month: string,
  header: MonthHeader,
  collisions: readonly Collision[],
): readonly OrganizationHoursRow[] {
  const dates = datesOfMonth(month);
  const teams = new Map(snapshot.teams.map((team) => [team.id, team.name]));
  const rows: OrganizationHoursRow[] = [];
  // Counted once for the month, then looked up per row.
  const counts = conflictCountsOf(collisions, month);

  for (const member of snapshot.members) {
    const hours = memberHoursOfMonth(memberHoursInputOf(snapshot, { ...member, memberId: member.id }), month);
    const lastActive = lastActiveDateOf(member, dates);

    if (lastActive === null && hours.shiftCount === 0) continue;

    const teamId = lastActive === null ? null : (membershipOn(member.memberships, lastActive)?.teamId ?? null);
    const teamName = teamId === null ? undefined : teams.get(teamId);

    if (teamId !== null && teamName === undefined) throw new RangeError(`team ${teamId} is not in the snapshot`);

    const conflictCount = conflictCountIn(counts, member.id);
    const figures = myHoursViewOf(snapshot, header, hours, conflictCount);

    rows.push({
      memberId: member.id,
      name: member.name,
      team: teamId === null || teamName === undefined ? null : { id: teamId, name: teamName },
      shiftCount: figures.shiftCount,
      bands: figures.bands,
      total: figures.total,
      leave: figures.leave,
      untimedShiftCount: hours.untimedShiftCount,
      conflictCount,
      calendar: calendarLinkSearchOf(member.id, month),
      hours,
    });
  }

  return rows;
}

/** Plain order of two ids or two counts: no collation, no arithmetic. */
function compareValues<Value extends string | number>(first: Value, second: Value): number {
  if (first === second) return 0;

  return first < second ? -1 : 1;
}

/** Minutes of one band in a row; a band the row lacks is none. */
function bandMinutesOf(row: OrganizationHoursRow, bandId: string): number {
  return row.hours.bands.find((band) => band.bandId === bandId)?.minutes ?? 0;
}

/** The column's own order, ascending: a row with no team after every team. */
function compareByKey(first: OrganizationHoursRow, second: OrganizationHoursRow, key: HoursSortKey): number {
  switch (key) {
    case SORT_NAME:
      return compareText(first.name, second.name);
    case SORT_TEAM:
      if (first.team === null || second.team === null) {
        return compareValues(first.team === null ? 1 : 0, second.team === null ? 1 : 0);
      }

      return compareText(first.team.name, second.team.name) || compareValues(first.team.id, second.team.id);
    case SORT_SHIFTS:
      return compareValues(first.shiftCount, second.shiftCount);
    case SORT_TOTAL:
      return compareValues(first.hours.totalMinutes, second.hours.totalMinutes);
    case SORT_LEAVE:
      return compareValues(first.hours.leaveMinutes, second.hours.leaveMinutes);
    default: {
      const bandId = key.slice(BAND_SORT_PREFIX.length);

      return compareValues(bandMinutesOf(first, bandId), bandMinutesOf(second, bandId));
    }
  }
}

/**
 * `rows` in `sort`'s order: the column in its direction, and ties by name,
 * then id, always ascending — so equal totals read alphabetically either way.
 */
export function sortedHoursRows(
  rows: readonly OrganizationHoursRow[],
  sort: HoursSort,
): readonly OrganizationHoursRow[] {
  const sign = sort.direction === SORT_UP ? 1 : -1;

  return [...rows].sort(
    (first, second) =>
      sign * compareByKey(first, second, sort.key) ||
      compareText(first.name, second.name) ||
      compareValues(first.memberId, second.memberId),
  );
}

/** The teams the rows name, once each, by name then id. */
export function hoursTeamsOf(rows: readonly OrganizationHoursRow[]): readonly HoursTeam[] {
  const teams = new Map<string, HoursTeam>();

  for (const row of rows) if (row.team !== null) teams.set(row.team.id, row.team);

  return [...teams.values()].sort((first, second) => compareText(first.name, second.name) || compareValues(first.id, second.id));
}

/**
 * The sort `search` names, when it names one the table has: a band's column
 * only while the band exists. No column is the name, in the direction
 * `smjer` names (ascending by default). A STALE column — a band since
 * removed — is the whole default, name ascending: its direction was about a
 * column that is gone.
 */
export function hoursSortOf(search: HoursSearch, bands: readonly HoursBandColumn[]): HoursSort {
  const wanted = search.sort;

  if (wanted === undefined) {
    return { key: DEFAULT_HOURS_SORT.key, direction: search.smjer ?? DEFAULT_HOURS_SORT.direction };
  }

  const known = !wanted.startsWith(BAND_SORT_PREFIX) || bands.some((band) => band.sortKey === wanted);

  return known ? { key: wanted, direction: search.smjer ?? DEFAULT_HOURS_SORT.direction } : DEFAULT_HOURS_SORT;
}

/**
 * What pressing a column heading does: a new column starts ascending, and
 * the sorted one flips.
 */
export function nextHoursSort(current: HoursSort, pressed: HoursSortKey): HoursSort {
  if (current.key !== pressed) return { key: pressed, direction: SORT_UP };

  return { key: pressed, direction: current.direction === SORT_UP ? SORT_DOWN : SORT_UP };
}

/** A sort as a search change: the default is no parameter at all. */
export function hoursSortChangeOf(sort: HoursSort): HoursSearchChange {
  return {
    sort: sort.key === DEFAULT_HOURS_SORT.key ? null : sort.key,
    smjer: sort.direction === DEFAULT_HOURS_SORT.direction ? null : sort.direction,
  };
}

/** The filters' "all" option value; no search ever names `''`. */
export const ALL_FILTER = '';

/** A team filter `<select>` value as a search change. */
export function hoursTeamChangeOf(value: string): HoursSearchChange {
  return { tim: value === ALL_FILTER ? null : value };
}

/** A person filter `<select>` value as a search change. */
export function hoursPersonChangeOf(value: string): HoursSearchChange {
  return { osoba: value === ALL_FILTER ? null : value };
}

/** `aria-sort`'s own vocabulary. */
export type AriaSort = 'ascending' | 'descending' | 'none';

/** What a column heading reports to assistive technology. */
export function hoursAriaSortOf(sort: HoursSort, key: HoursSortKey): AriaSort {
  if (sort.key !== key) return 'none';

  return sort.direction === SORT_UP ? 'ascending' : 'descending';
}

/** The arrow a sorted heading shows, or `null` for one that is not sorted. */
export type HoursSortArrow = 'up' | 'down';

export function hoursSortArrowOf(sort: HoursSort, key: HoursSortKey): HoursSortArrow | null {
  if (sort.key !== key) return null;

  return sort.direction === SORT_UP ? 'up' : 'down';
}

/** What an empty table says: nobody matches the filter, or nobody has a row this month. */
export type HoursEmptyMessageKey = 'sati.organization.empty' | 'sati.organization.emptyMonth';

/**
 * The line an empty table shows, or `null` while a row is shown: nobody has
 * a row in the month at all, or the rows there are all filtered out — the
 * only way `shown` can be fewer than `all`.
 */
export function hoursEmptyMessageKey(
  shown: number,
  all: number,
): 'sati.organization.empty' | 'sati.organization.emptyMonth' | null {
  if (shown > 0) return null;

  return all === 0 ? 'sati.organization.emptyMonth' : 'sati.organization.empty';
}

/**
 * The search *Sati*'s navigation starts from: the table's own, stale
 * parameters dropped, for an admin; the month alone otherwise, so a member's
 * month navigation never writes a parameter only the table reads.
 */
export function hoursSearchBaseOf(organization: OrganizationHoursView | null, search: HoursSearch): HoursSearch {
  if (organization !== null) return organization.search;

  return search.mjesec === undefined ? {} : { mjesec: search.mjesec };
}

/** The untimed shifts of `rows`, or `null` when there are none. */
export function untimedShiftsOf(rows: readonly OrganizationHoursRow[]): number | null {
  const sum = rows.reduce((total, row) => total + row.untimedShiftCount, 0);

  return sum > 0 ? sum : null;
}

/**
 * The organization's month `search` names, `today` the organization's, the
 * conflicts counted from `collisions`.
 *
 * @throws RangeError on any precondition of the rows.
 */
export function organizationHoursViewOf(
  snapshot: CalendarSnapshot,
  search: HoursSearch,
  today: string,
  collisions: readonly Collision[],
): OrganizationHoursView {
  const month = monthShownOf(search, today);
  const header = monthHeaderOf(month, today);
  const bands = snapshot.bands.map((band) => ({ bandId: band.id, name: band.name, sortKey: bandSortKeyOf(band.id) }));
  const all = organizationHoursRowsOf(snapshot, month, header, collisions);
  const teams = hoursTeamsOf(all);
  const people = all.map((row) => ({ id: row.memberId, name: row.name }));
  const team = teams.find((one) => one.id === search.tim)?.id ?? null;
  const person = people.find((one) => one.id === search.osoba)?.id ?? null;
  const sort = hoursSortOf(search, bands);
  const shown = all.filter(
    (row) => (team === null || row.team?.id === team) && (person === null || row.memberId === person),
  );

  return {
    header,
    bands,
    rows: sortedHoursRows(shown, sort),
    rowCount: all.length,
    sort,
    teams,
    team,
    people,
    person,
    search: {
      ...(search.mjesec === undefined ? {} : { mjesec: search.mjesec }),
      ...(team === null ? {} : { tim: team }),
      ...(person === null ? {} : { osoba: person }),
      ...(sort.key === DEFAULT_HOURS_SORT.key ? {} : { sort: sort.key }),
      ...(sort.direction === DEFAULT_HOURS_SORT.direction ? {} : { smjer: sort.direction }),
    },
    untimedShiftCount: untimedShiftsOf(shown),
    columnCount: FIXED_COLUMN_COUNT + bands.length,
    empty: hoursEmptyMessageKey(shown.length, all.length),
  };
}

/**
 * {@link organizationHoursViewOf}, GUARDED: a `RangeError` for any one row
 * refuses the whole table — never a partial one — and is logged.
 */
export function organizationHoursOf(
  snapshot: CalendarSnapshot,
  search: HoursSearch,
  today: string,
  collisions: readonly Collision[],
): OrganizationHoursOutcome {
  try {
    return { ok: true, view: organizationHoursViewOf(snapshot, search, today, collisions) };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(HOURS_UNAVAILABLE, cause);

    return { ok: false, code: HOURS_UNAVAILABLE };
  }
}

/**
 * What *Sati* shows, whoever reads it: {@link MyHoursSurface}, and the
 * organization's table in place of the viewer's figures for an admin. At
 * most one of `view` and `organization` is ever set.
 */
export interface HoursSurface extends MyHoursSurface {
  readonly organization: OrganizationHoursView | null;
}

/**
 * The calendar read's and the leave read's surface states as *Sati*
 * (`hoursReadsOf`): a member-role viewer's own month exactly as
 * `myHoursSurfaceOf` draws it, and for an admin (`snapshot.viewer.role`)
 * every member's. A refused read is the message alone, with a retry only
 * where reading again can help; a pending one the skeleton; a domain refusal
 * of the table the message in place of it, the month navigation kept.
 */
export function hoursSurfaceOf(
  state: CalendarSurfaceState,
  conflicts: HoursConflictsState | null,
  search: HoursSearch,
  today: string | null,
): HoursSurface {
  const reads = hoursReadsOf(state, conflicts, today);

  if (!reads.ready || reads.snapshot.viewer.role !== 'admin') {
    return { ...myHoursSurfaceOf(state, conflicts, search, today), organization: null };
  }

  const outcome = organizationHoursOf(reads.snapshot, search, reads.today, reads.collisions);

  if (outcome.ok) {
    return {
      view: null,
      organization: outcome.view,
      month: outcome.view.header,
      navShown: true,
      refusal: null,
      retryable: false,
      loading: false,
    };
  }

  const month = monthShownHeaderOf(search, reads.today);

  return {
    view: null,
    organization: null,
    month,
    navShown: month !== null,
    refusal: outcome.code,
    retryable: false,
    loading: false,
  };
}
