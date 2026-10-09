import { membershipOn } from '@shift/domain';

import type { CalendarSnapshot, CalendarSurfaceState, CalendarViewer } from '@/features/calendar/services/snapshot';
import { calendarTodayOf } from '@/features/calendar/utils/month';
import { organizationLeaveRecordsOf, type LeaveRecord } from '@/features/leave/services/leave-list';
import {
  LEAVE_READY,
  LEAVE_UNSCHEDULED,
  memberLeaveBaseOf,
  type LeaveCalendarSource,
  type LeaveOrganizationSource,
} from '@/features/leave/services/leave-section';
import type { MyLeaveRowsState } from '@/features/leave/services/my-leave';
import {
  NO_TEXT,
  foldForSearch,
  foldedSearchOf,
  memberStatusOf,
  type MemberListRow,
} from '@/features/members/services/list';
import { compareText } from '@/lib/i18n/format';

/**
 * The admin's leave overview on *Godišnji* (story 7.15), as a pure view model
 * in a `.ts` that renders nothing (AD-15): which page the viewer gets, which
 * members are rows, each row's figures, the search, the sort, the summary
 * line and the empty and failed states. The hook only wires these; the node
 * suite executes them.
 *
 * ONE RULE (Q19). Every row is `memberLeaveBaseOf` — the member page's own
 * leave card — for that member, with that member's records from the
 * organization's read (`leave_overview_records()`, 0034), so a row equals the
 * member page's three figures by construction. Nothing here adds, subtracts
 * or dates a leave day; the totals sum the figures the rule answered.
 *
 * MEMBERS ACTIVE TODAY ONLY (decision of 2026-10-09), by `memberStatusOf` at
 * the organization's today. A member with no schedule keeps their row with
 * their allowance, the unscheduled line in place of the other two figures,
 * and is left out of the totals.
 *
 * ALL OR NOTHING. A read that failed or is paused offline, a record row of a
 * member the list does not hold, or any member the rule calls unavailable is
 * the whole overview unavailable — never a partial table.
 */

/** TanStack Query's name for a fetch it has not started (offline). */
const FETCH_PAUSED = 'paused';

// ---------------------------------------------------------------- the page

/** The calendar has not named the viewer yet: the skeleton. */
export const GODISNJI_LOADING = 'loading';
/** The calendar failed, or named a role this page does not know: one notice and a retry. */
export const GODISNJI_UNAVAILABLE = 'unavailable';
/** A member-role viewer: their own tiles, as since story 5.2c. */
export const GODISNJI_OWN = 'own';
/** An admin: the overview, and no tiles of their own. */
export const GODISNJI_OVERVIEW = 'overview';

export type GodisnjiView =
  | typeof GODISNJI_LOADING
  | typeof GODISNJI_UNAVAILABLE
  | typeof GODISNJI_OWN
  | typeof GODISNJI_OVERVIEW;

const ADMIN_ROLE: CalendarViewer['role'] = 'admin';
const MEMBER_ROLE: CalendarViewer['role'] = 'member_role';

/**
 * Which *Godišnji* the viewer gets, by `snapshot.viewer.role` — as *Sati*
 * decides its own. FAILING CLOSED: each role by name, and any other value is
 * unavailable, never the overview by default.
 */
export function godisnjiViewOf(calendar: CalendarSurfaceState): GodisnjiView {
  if (calendar.refusal !== null) return GODISNJI_UNAVAILABLE;
  if (calendar.snapshot === null) return calendar.loading ? GODISNJI_LOADING : GODISNJI_UNAVAILABLE;

  const role: string = calendar.snapshot.viewer.role;

  if (role === ADMIN_ROLE) return GODISNJI_OVERVIEW;
  if (role === MEMBER_ROLE) return GODISNJI_OWN;

  return GODISNJI_UNAVAILABLE;
}

// ---------------------------------------------------------------- the URL

/** The overview's sortable columns, as the URL writes them. */
export const OVERVIEW_SORT_NAME = 'ime';
export const OVERVIEW_SORT_TEAM = 'smjena';
export const OVERVIEW_SORT_ALLOWANCE = 'pravo';
export const OVERVIEW_SORT_USED = 'iskoristeno';
export const OVERVIEW_SORT_BALANCE = 'preostalo';

export const OVERVIEW_SORT_KEYS = [
  OVERVIEW_SORT_NAME,
  OVERVIEW_SORT_TEAM,
  OVERVIEW_SORT_ALLOWANCE,
  OVERVIEW_SORT_USED,
  OVERVIEW_SORT_BALANCE,
] as const;

export type LeaveOverviewSortKey = (typeof OVERVIEW_SORT_KEYS)[number];

/** Which way a sorted column runs: the arrow it draws. */
export type LeaveOverviewSortArrow = 'up' | 'down';

export interface LeaveOverviewSort {
  readonly key: LeaveOverviewSortKey;
  readonly direction: LeaveOverviewSortArrow;
}

/** The overview opens by name, ascending. */
export const DEFAULT_OVERVIEW_SORT: LeaveOverviewSort = { key: OVERVIEW_SORT_NAME, direction: 'up' };

/** The prefix a descending sort carries in the URL: `?sort=-preostalo`. */
const DESCENDING_PREFIX = '-';

/** What the URL narrows and orders the overview by. */
export interface LeaveOverviewFilters {
  /** The search as typed, trimmed. */
  readonly search: string;
  readonly sort: LeaveOverviewSort;
}

/** `/godisnji`'s search: `?trazi=&sort=`, each absent at its default. */
export type GodisnjiSearch = {
  readonly trazi?: string | undefined;
  readonly sort?: string | undefined;
};

function sortOfSearch(value: unknown): LeaveOverviewSort {
  if (typeof value !== 'string') return DEFAULT_OVERVIEW_SORT;

  const descending = value.startsWith(DESCENDING_PREFIX);
  const name = descending ? value.slice(DESCENDING_PREFIX.length) : value;
  const key = OVERVIEW_SORT_KEYS.find((candidate) => candidate === name);

  return key === undefined ? DEFAULT_OVERVIEW_SORT : { key, direction: descending ? 'down' : 'up' };
}

/** The URL's search text, trimmed; a number too, which the router parses `?trazi=123` as. */
function searchOfText(text: unknown): string {
  if (typeof text === 'number') return String(text);

  return typeof text === 'string' ? text.trim() : NO_TEXT;
}

/** What the URL says, as filters: every value outside its vocabulary falls back to its default. */
export function leaveOverviewFiltersOf(search: Readonly<Record<string, unknown>>): LeaveOverviewFilters {
  return { search: searchOfText(search['trazi']), sort: sortOfSearch(search['sort']) };
}

/** The URL's search for `filters`: each value at its default is left out, so the defaults are `/godisnji`. */
export function leaveOverviewSearchFor(filters: LeaveOverviewFilters): GodisnjiSearch {
  const sorted =
    filters.sort.key !== DEFAULT_OVERVIEW_SORT.key || filters.sort.direction !== DEFAULT_OVERVIEW_SORT.direction;
  const sort = `${filters.sort.direction === 'down' ? DESCENDING_PREFIX : NO_TEXT}${filters.sort.key}`;

  return {
    ...(filters.search === NO_TEXT ? {} : { trazi: filters.search }),
    ...(sorted ? { sort } : {}),
  };
}

/** `/godisnji`'s `validateSearch`: parsed and written back, so the route only holds what it shows. */
export function godisnjiSearchOf(search: Readonly<Record<string, unknown>>): GodisnjiSearch {
  return leaveOverviewSearchFor(leaveOverviewFiltersOf(search));
}

/**
 * The search a URL must be REPLACED with, or `null` when it already holds
 * only what it shows: `?sort=xyz`, a default written out, a blank `?trazi=`
 * or a key the page does not read is rewritten out, never left standing.
 */
export function godisnjiSearchRewriteOf(raw: Readonly<Record<string, unknown>>): GodisnjiSearch | null {
  const clean = godisnjiSearchOf(raw);
  const keys = Object.keys(raw);
  const same =
    keys.length === Object.keys(clean).length &&
    keys.every((key) => (clean as Record<string, unknown>)[key] === raw[key]);

  return same ? null : clean;
}

/** A heading press: a new column starts ascending, the sorted one flips. */
export function nextLeaveOverviewSort(current: LeaveOverviewSort, pressed: LeaveOverviewSortKey): LeaveOverviewSort {
  if (current.key !== pressed) return { key: pressed, direction: 'up' };

  return { key: pressed, direction: current.direction === 'up' ? 'down' : 'up' };
}

/** What a heading reports to assistive technology. */
export function leaveOverviewAriaSortOf(
  sort: LeaveOverviewSort,
  key: LeaveOverviewSortKey,
): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none';

  return sort.direction === 'up' ? 'ascending' : 'descending';
}

/** The arrow a heading shows, or `null` for one that is not sorted. */
export function leaveOverviewSortArrowOf(sort: LeaveOverviewSort, key: LeaveOverviewSortKey): LeaveOverviewSortArrow | null {
  return sort.key === key ? sort.direction : null;
}

// --------------------------------------------------------------- the rows

/** The overview's reads, each as far as it is read here. */
export interface LeaveOverviewSources {
  readonly members: {
    readonly members: readonly MemberListRow[] | null;
    readonly refusal: string | null;
    readonly loading: boolean;
    readonly paused: boolean;
  };
  readonly calendar: LeaveCalendarSource;
  readonly organization: LeaveOrganizationSource;
  /** The rows `leave_overview_records()` answered, unparsed. */
  readonly records: MyLeaveRowsState;
}

/** The three figures of a scheduled member, as the member page's card states them. */
export interface LeaveOverviewFigures {
  readonly usedDays: number;
  /** May be negative. */
  readonly balanceDays: number;
}

export interface LeaveOverviewRow {
  readonly memberId: string;
  readonly name: string;
  /** Their team today, from the calendar snapshot, or `null` for none. */
  readonly team: { readonly id: string; readonly name: string } | null;
  readonly allowanceDays: number;
  /** `null` for a member with no schedule: the unscheduled line instead. */
  readonly figures: LeaveOverviewFigures | null;
}

export interface LeaveOverviewSummary {
  /** Rows shown. */
  readonly shown: number;
  /** Days used over the shown rows that have figures. */
  readonly usedDays: number;
  /** Their allowance, over the same rows. */
  readonly allowanceDays: number;
}

/** No member is active today. */
export const OVERVIEW_EMPTY_NONE = 'none';
/** The search matched nobody. */
export const OVERVIEW_EMPTY_SEARCH = 'search';

export const OVERVIEW_LOADING = 'loading';
export const OVERVIEW_UNAVAILABLE = 'unavailable';

/** The stable code every unavailable overview is logged under. */
export const LEAVE_OVERVIEW_UNAVAILABLE = 'LEAVE_OVERVIEW_UNAVAILABLE';
export const OVERVIEW_READY = 'ready';

export type LeaveOverview =
  | { readonly kind: typeof OVERVIEW_LOADING }
  | { readonly kind: typeof OVERVIEW_UNAVAILABLE }
  | {
      readonly kind: typeof OVERVIEW_READY;
      readonly rows: readonly LeaveOverviewRow[];
      readonly sort: LeaveOverviewSort;
      readonly summary: LeaveOverviewSummary;
      readonly empty: typeof OVERVIEW_EMPTY_NONE | typeof OVERVIEW_EMPTY_SEARCH | null;
    };

/** Every active member's row, unsorted and unsearched, or a state with none. */
export type LeaveOverviewRows =
  | { readonly kind: typeof OVERVIEW_LOADING }
  | { readonly kind: typeof OVERVIEW_UNAVAILABLE }
  | { readonly kind: typeof OVERVIEW_READY; readonly rows: readonly LeaveOverviewRow[] };

function organizationReady(organization: LeaveOrganizationSource): boolean {
  return organization.data !== undefined && organization.data.ok;
}

/**
 * The team a snapshot member is on today, by the domain's own reading, or
 * `null` — also for a team the snapshot does not hold, which names no team
 * rather than taking the whole overview down: the figures do not depend on it.
 */
function teamTodayOf(snapshot: CalendarSnapshot, memberId: string, today: string): LeaveOverviewRow['team'] {
  const scheduled = snapshot.members.find((candidate) => candidate.id === memberId);

  if (scheduled === undefined) return null;

  const membership = membershipOn(scheduled.memberships, today);

  if (membership === null) return null;

  const team = snapshot.teams.find((candidate) => candidate.id === membership.teamId);

  return team === undefined ? null : { id: team.id, name: team.name };
}

/**
 * Every member active today as a row, at `now`: unavailable when any read
 * failed or is paused offline — first, so a failure is never hidden behind
 * another's skeleton — loading while any read is pending, and otherwise one
 * row per active member whose figures are `memberLeaveBaseOf`'s.
 */
export function leaveOverviewRowsOf(sources: LeaveOverviewSources, now: Date): LeaveOverviewRows {
  const { members, calendar, organization, records } = sources;
  const failed =
    members.paused ||
    (!members.loading && (members.refusal !== null || members.members === null)) ||
    (!calendar.loading && calendar.snapshot === null) ||
    organization.fetchStatus === FETCH_PAUSED ||
    (!organization.isPending && (organization.isError || !organizationReady(organization))) ||
    (!records.loading && records.rows === null);

  if (failed) {
    console.error(LEAVE_OVERVIEW_UNAVAILABLE, 'read');

    return { kind: OVERVIEW_UNAVAILABLE };
  }

  const list = members.members;
  const snapshot = calendar.snapshot;
  const rows = records.rows;

  if (list === null || snapshot === null || !organizationReady(organization) || rows === null) {
    return { kind: OVERVIEW_LOADING };
  }

  const parsed = organizationLeaveRecordsOf(
    rows,
    list.map((member) => member.id),
  );

  if (parsed === null) {
    console.error(LEAVE_OVERVIEW_UNAVAILABLE, 'row');

    return { kind: OVERVIEW_UNAVAILABLE };
  }

  const byMember = new Map<string, LeaveRecord[]>();

  for (const { memberId, ...record } of parsed) {
    const own = byMember.get(memberId);

    if (own === undefined) byMember.set(memberId, [record]);
    else own.push(record);
  }

  try {
    const today = calendarTodayOf(snapshot, now);
    const result: LeaveOverviewRow[] = [];

    for (const member of list) {
      if (!memberStatusOf(member, today).activeToday) continue;

      // THE MEMBER PAGE'S OWN RULE, with this member's records in place of
      // its per-member read: the same records, so the same figures.
      const base = memberLeaveBaseOf(
        {
          members,
          calendar,
          organization,
          records: { records: byMember.get(member.id) ?? [], loading: false, refreshing: false },
        },
        member.id,
        now,
      );

      if (base.kind !== LEAVE_READY && base.kind !== LEAVE_UNSCHEDULED) {
        console.error(LEAVE_OVERVIEW_UNAVAILABLE, base.kind, member.id);

        return { kind: OVERVIEW_UNAVAILABLE };
      }

      result.push({
        memberId: member.id,
        name: member.name,
        team: teamTodayOf(snapshot, member.id, today),
        allowanceDays: member.leaveAllowanceDays,
        figures:
          base.kind === LEAVE_READY
            ? { usedDays: base.balance.usedDays, balanceDays: base.balance.balanceDays }
            : null,
      });
    }

    return { kind: OVERVIEW_READY, rows: result };
  } catch (cause) {
    console.error(LEAVE_OVERVIEW_UNAVAILABLE, cause);

    return { kind: OVERVIEW_UNAVAILABLE };
  }
}

function compareNumbers(first: number, second: number): number {
  return first - second;
}

/** A row's value in a column, or `null` where it has none (no team, no schedule): those sort last. */
const SORT_VALUES: Record<LeaveOverviewSortKey, (row: LeaveOverviewRow) => string | number | null> = {
  [OVERVIEW_SORT_NAME]: (row) => row.name,
  [OVERVIEW_SORT_TEAM]: (row) => row.team?.name ?? null,
  [OVERVIEW_SORT_ALLOWANCE]: (row) => row.allowanceDays,
  [OVERVIEW_SORT_USED]: (row) => row.figures?.usedDays ?? null,
  [OVERVIEW_SORT_BALANCE]: (row) => row.figures?.balanceDays ?? null,
};

function compareValues(first: string | number, second: string | number): number {
  return typeof first === 'number' && typeof second === 'number'
    ? compareNumbers(first, second)
    : compareText(String(first), String(second));
}

/**
 * The rows in `sort`'s order: a row with no value in the column after every
 * row with one, in either direction; ties by name, then id, so the order is
 * the same every time.
 */
export function sortedLeaveOverviewRows(
  rows: readonly LeaveOverviewRow[],
  sort: LeaveOverviewSort,
): readonly LeaveOverviewRow[] {
  const value = SORT_VALUES[sort.key];
  const sign = sort.direction === 'up' ? 1 : -1;

  return [...rows].sort((first, second) => {
    const a = value(first);
    const b = value(second);

    if (a === null || b === null) {
      if (a !== b) return a === null ? 1 : -1;
    } else {
      const order = compareValues(a, b);

      if (order !== 0) return sign * order;
    }

    return compareText(first.name, second.name) || compareText(first.memberId, second.memberId);
  });
}

/** The rows whose name matches the search, folded as Ljudi folds; every row for no search. */
export function searchedLeaveOverviewRows(rows: readonly LeaveOverviewRow[], search: string): readonly LeaveOverviewRow[] {
  const folded = foldedSearchOf(search);

  if (folded === null) return rows;
  if (folded === NO_TEXT) return [];

  return rows.filter((row) => foldForSearch(row.name).includes(folded));
}

/** The summary over the rows shown: an unscheduled row counts as shown and adds to neither total. */
export function leaveOverviewSummaryOf(rows: readonly LeaveOverviewRow[]): LeaveOverviewSummary {
  let usedDays = 0;
  let allowanceDays = 0;

  for (const row of rows) {
    if (row.figures === null) continue;

    usedDays += row.figures.usedDays;
    allowanceDays += row.allowanceDays;
  }

  return { shown: rows.length, usedDays, allowanceDays };
}

/**
 * The overview from rows already worked out ({@link leaveOverviewRowsOf}) and
 * the filters: the search and the sort run over them, so a keystroke never
 * recomputes a member's figures.
 */
export function leaveOverviewFromRows(all: LeaveOverviewRows, filters: LeaveOverviewFilters): LeaveOverview {
  if (all.kind !== OVERVIEW_READY) return all;

  const rows = sortedLeaveOverviewRows(searchedLeaveOverviewRows(all.rows, filters.search), filters.sort);

  return {
    kind: OVERVIEW_READY,
    rows,
    sort: filters.sort,
    summary: leaveOverviewSummaryOf(rows),
    empty: rows.length > 0 ? null : all.rows.length === 0 ? OVERVIEW_EMPTY_NONE : OVERVIEW_EMPTY_SEARCH,
  };
}

/** The overview from its reads and the URL's filters, at `now`. */
export function leaveOverviewOf(sources: LeaveOverviewSources, filters: LeaveOverviewFilters, now: Date): LeaveOverview {
  return leaveOverviewFromRows(leaveOverviewRowsOf(sources, now), filters);
}
