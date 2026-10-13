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
  ALL_TEAMS,
  NO_TEAM,
  NO_TEXT,
  foldForSearch,
  foldedSearchOf,
  memberStatusOf,
  type MemberListRow,
  type TeamFilter,
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
 *
 * THE CHIPS (E884, the mockup's `Smjena: sve` and `Stanje: sve`, drawn by
 * the shared option-chip bar as *Ljudi*'s): the team today, and the leave
 * state — on leave today, with a record from today on, with none, or with a
 * balance below zero. Both live in the URL beside the search and the sort,
 * and the summary line counts what they leave, the records from today on
 * included (`upisano 3 godišnja`).
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

/** Every state: the Stanje chip at its default. */
export const OVERVIEW_STATE_ALL = 'sve';
/** A live record covers the organization's today. */
export const OVERVIEW_STATE_ON_LEAVE = 'na-godisnjem';
/** A live record ends today or later: current or upcoming. */
export const OVERVIEW_STATE_RECORDED = 'upisano';
/** No live record ends today or later. */
export const OVERVIEW_STATE_UNRECORDED = 'bez-upisa';
/** The balance is below zero. */
export const OVERVIEW_STATE_NEGATIVE = 'u-minusu';

/** The Stanje chip's values, in the order its picker lists them; also how the URL writes them. */
export const OVERVIEW_STATES = [
  OVERVIEW_STATE_ALL,
  OVERVIEW_STATE_ON_LEAVE,
  OVERVIEW_STATE_RECORDED,
  OVERVIEW_STATE_UNRECORDED,
  OVERVIEW_STATE_NEGATIVE,
] as const;

export type LeaveOverviewState = (typeof OVERVIEW_STATES)[number];

/** What the URL narrows and orders the overview by. */
export interface LeaveOverviewFilters {
  /** The search as typed, trimmed. */
  readonly search: string;
  readonly sort: LeaveOverviewSort;
  /** The Smjena chip: {@link ALL_TEAMS}, {@link NO_TEAM} or a team's id, as *Ljudi*'s. */
  readonly team: TeamFilter;
  /** The Stanje chip. */
  readonly state: LeaveOverviewState;
}

/** `/godisnji`'s search: `?trazi=&smjena=&stanje=&sort=`, each absent at its default. */
export type GodisnjiSearch = {
  readonly trazi?: string | undefined;
  readonly smjena?: string | undefined;
  readonly stanje?: string | undefined;
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

/** A Stanje value as the URL writes it, or every state for anything else. */
export function chooseLeaveOverviewState(value: unknown): LeaveOverviewState {
  return OVERVIEW_STATES.find((state) => state === value) ?? OVERVIEW_STATE_ALL;
}

/**
 * What the URL says, as filters: every value outside its vocabulary falls
 * back to its default. A team is any non-empty value here — whether it is
 * still an option is the rows' to say ({@link leaveOverviewFromRows}).
 */
export function leaveOverviewFiltersOf(search: Readonly<Record<string, unknown>>): LeaveOverviewFilters {
  const team = search['smjena'];

  return {
    search: searchOfText(search['trazi']),
    sort: sortOfSearch(search['sort']),
    team: typeof team === 'string' && team !== NO_TEXT ? team : ALL_TEAMS,
    state: chooseLeaveOverviewState(search['stanje']),
  };
}

/** The URL's search for `filters`: each value at its default is left out, so the defaults are `/godisnji`. */
export function leaveOverviewSearchFor(filters: LeaveOverviewFilters): GodisnjiSearch {
  const sorted =
    filters.sort.key !== DEFAULT_OVERVIEW_SORT.key || filters.sort.direction !== DEFAULT_OVERVIEW_SORT.direction;
  const sort = `${filters.sort.direction === 'down' ? DESCENDING_PREFIX : NO_TEXT}${filters.sort.key}`;

  return {
    ...(filters.search === NO_TEXT ? {} : { trazi: filters.search }),
    ...(filters.team === ALL_TEAMS ? {} : { smjena: filters.team }),
    ...(filters.state === OVERVIEW_STATE_ALL ? {} : { stanje: filters.state }),
    ...(sorted ? { sort } : {}),
  };
}

/** The state the URL holds, as one key: the filter bar waits for it to move focus. */
export function godisnjiSearchKeyOf(search: GodisnjiSearch): string {
  // JSON, never a join: free text holding the separator would make two states one key.
  return JSON.stringify([search.trazi, search.smjena, search.stanje, search.sort].map((value) => value ?? null));
}

/** The filters with every chip and the search at their defaults; the sort is kept. */
export function clearedLeaveOverviewFilters(filters: LeaveOverviewFilters): LeaveOverviewFilters {
  return { ...filters, search: NO_TEXT, team: ALL_TEAMS, state: OVERVIEW_STATE_ALL };
}

/** Whether a chip narrows the rows: `Poništi filtre` is offered. */
export function leaveOverviewNarrowed(filters: Pick<LeaveOverviewFilters, 'team' | 'state'>): boolean {
  return filters.team !== ALL_TEAMS || filters.state !== OVERVIEW_STATE_ALL;
}

// ---------------------------------------------------------------- the chips

/** The two chips beside the search (E884), in the order they are drawn. */
export const OVERVIEW_CHIP_TEAM = 'team';
export const OVERVIEW_CHIP_STATE = 'state';

export type LeaveOverviewChipKey = typeof OVERVIEW_CHIP_TEAM | typeof OVERVIEW_CHIP_STATE;

const OVERVIEW_CHIPS: readonly LeaveOverviewChipKey[] = [OVERVIEW_CHIP_TEAM, OVERVIEW_CHIP_STATE];

/** The chip a key names, or `null` for none — never a cast. */
export function chooseLeaveOverviewChip(value: string): LeaveOverviewChipKey | null {
  return OVERVIEW_CHIPS.find((key) => key === value) ?? null;
}

/**
 * The filters once `key`'s picker chose `value`: a team only from the options
 * on screen (a stale one is every team), a state only from its vocabulary.
 */
export function leaveOverviewChipChoiceOf(
  filters: LeaveOverviewFilters,
  key: LeaveOverviewChipKey,
  value: string,
  teams: readonly LeaveOverviewTeamOption[],
): LeaveOverviewFilters {
  if (key === OVERVIEW_CHIP_TEAM) {
    return { ...filters, team: teams.find((option) => option.value === value)?.value ?? ALL_TEAMS };
  }

  return { ...filters, state: chooseLeaveOverviewState(value) };
}

/** The filters once `key`'s ✕ was pressed: that chip back to its default. */
export function leaveOverviewChipRemovalOf(filters: LeaveOverviewFilters, key: LeaveOverviewChipKey): LeaveOverviewFilters {
  return key === OVERVIEW_CHIP_TEAM ? { ...filters, team: ALL_TEAMS } : { ...filters, state: OVERVIEW_STATE_ALL };
}

/** A Stanje option as its picker lists it. Exhaustive. */
export function leaveOverviewStateMessageKey(
  state: LeaveOverviewState,
):
  | 'godisnji.overview.state.all'
  | 'godisnji.overview.state.onLeave'
  | 'godisnji.overview.state.recorded'
  | 'godisnji.overview.state.unrecorded'
  | 'godisnji.overview.state.negative' {
  switch (state) {
    case OVERVIEW_STATE_ALL:
      return 'godisnji.overview.state.all';
    case OVERVIEW_STATE_ON_LEAVE:
      return 'godisnji.overview.state.onLeave';
    case OVERVIEW_STATE_RECORDED:
      return 'godisnji.overview.state.recorded';
    case OVERVIEW_STATE_UNRECORDED:
      return 'godisnji.overview.state.unrecorded';
    case OVERVIEW_STATE_NEGATIVE:
      return 'godisnji.overview.state.negative';
  }
}

/** A Stanje value as the chip says it after `Stanje:`. Exhaustive. */
export function leaveOverviewStateValueMessageKey(
  state: LeaveOverviewState,
):
  | 'godisnji.overview.stateValue.all'
  | 'godisnji.overview.stateValue.onLeave'
  | 'godisnji.overview.stateValue.recorded'
  | 'godisnji.overview.stateValue.unrecorded'
  | 'godisnji.overview.stateValue.negative' {
  switch (state) {
    case OVERVIEW_STATE_ALL:
      return 'godisnji.overview.stateValue.all';
    case OVERVIEW_STATE_ON_LEAVE:
      return 'godisnji.overview.stateValue.onLeave';
    case OVERVIEW_STATE_RECORDED:
      return 'godisnji.overview.stateValue.recorded';
    case OVERVIEW_STATE_UNRECORDED:
      return 'godisnji.overview.stateValue.unrecorded';
    case OVERVIEW_STATE_NEGATIVE:
      return 'godisnji.overview.stateValue.negative';
  }
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
  /** A live record covers the organization's today. */
  readonly onLeaveToday: boolean;
  /** How many of their live records end today or later: current or upcoming. */
  readonly upcomingRecords: number;
}

export interface LeaveOverviewSummary {
  /** Rows shown. */
  readonly shown: number;
  /** Their live records that end today or later. */
  readonly records: number;
  /** Days used over the shown rows that have figures. */
  readonly usedDays: number;
  /** Their allowance, over the same rows. */
  readonly allowanceDays: number;
}

/** One Smjena option: every team, no team, or a team (its name data), and how many rows it would leave. */
export interface LeaveOverviewTeamOption {
  readonly value: TeamFilter;
  /** The team's name; `null` for {@link ALL_TEAMS} and {@link NO_TEAM}, which the screen words. */
  readonly team: string | null;
  readonly count: number;
}

/** No member is active today. */
export const OVERVIEW_EMPTY_NONE = 'none';
/** The search matched nobody. */
export const OVERVIEW_EMPTY_SEARCH = 'search';
/** The chips (and the search) leave nobody. */
export const OVERVIEW_EMPTY_FILTERED = 'filtered';

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
      readonly empty: typeof OVERVIEW_EMPTY_NONE | typeof OVERVIEW_EMPTY_SEARCH | typeof OVERVIEW_EMPTY_FILTERED | null;
      /** The team the rows were narrowed by: the URL's, or every team once it is no longer an option. */
      readonly team: TeamFilter;
      /** The Smjena options: every team first, then each team by name, then no team where anyone has none. */
      readonly teams: readonly LeaveOverviewTeamOption[];
      /** How many rows each Stanje option would leave, under the search and the team. */
      readonly states: Readonly<Record<LeaveOverviewState, number>>;
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

      const own = byMember.get(member.id) ?? [];

      result.push({
        memberId: member.id,
        name: member.name,
        team: teamTodayOf(snapshot, member.id, today),
        allowanceDays: member.leaveAllowanceDays,
        figures:
          base.kind === LEAVE_READY
            ? { usedDays: base.balance.usedDays, balanceDays: base.balance.balanceDays }
            : null,
        onLeaveToday: own.some((record) => record.from <= today && today <= record.to),
        upcomingRecords: own.filter((record) => record.to >= today).length,
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
  let records = 0;

  for (const row of rows) {
    records += row.upcomingRecords;
    if (row.figures === null) continue;

    usedDays += row.figures.usedDays;
    allowanceDays += row.allowanceDays;
  }

  return { shown: rows.length, records, usedDays, allowanceDays };
}

/** The team value a row counts under: its team's id, or {@link NO_TEAM}. */
function teamValueOf(row: LeaveOverviewRow): TeamFilter {
  return row.team?.id ?? NO_TEAM;
}

/** Whether `row` is in `team`. */
function inTeam(row: LeaveOverviewRow, team: TeamFilter): boolean {
  return team === ALL_TEAMS || teamValueOf(row) === team;
}

/** Whether `row` is in `state`. Exhaustive. */
export function inLeaveOverviewState(row: LeaveOverviewRow, state: LeaveOverviewState): boolean {
  switch (state) {
    case OVERVIEW_STATE_ALL:
      return true;
    case OVERVIEW_STATE_ON_LEAVE:
      return row.onLeaveToday;
    case OVERVIEW_STATE_RECORDED:
      return row.upcomingRecords > 0;
    case OVERVIEW_STATE_UNRECORDED:
      return row.upcomingRecords === 0;
    case OVERVIEW_STATE_NEGATIVE:
      return row.figures !== null && row.figures.balanceDays < 0;
  }
}

/**
 * The Smjena options over every row — so an option never vanishes because the
 * search or the other chip left its members out; it reads `0` instead — each
 * counted over `counted`.
 */
function teamOptionsOf(rows: readonly LeaveOverviewRow[], counted: readonly LeaveOverviewRow[]): LeaveOverviewTeamOption[] {
  const teams = new Map<string, string>();
  let noTeam = false;

  for (const row of rows) {
    if (row.team === null) noTeam = true;
    else teams.set(row.team.id, row.team.name);
  }

  const countOf = (value: TeamFilter) => counted.filter((row) => inTeam(row, value)).length;
  const named = [...teams]
    .sort(([firstId, first], [secondId, second]) => compareText(first, second) || compareText(firstId, secondId))
    .map(([id, name]) => ({ value: id, team: name, count: countOf(id) }));

  return [
    { value: ALL_TEAMS, team: null, count: counted.length },
    ...named,
    ...(noTeam ? [{ value: NO_TEAM, team: null, count: countOf(NO_TEAM) }] : []),
  ];
}

/**
 * The overview from rows already worked out ({@link leaveOverviewRowsOf}) and
 * the filters: the search, the two chips and the sort run over them, so a
 * keystroke never recomputes a member's figures. A team that is no longer an
 * option narrows nothing.
 */
export function leaveOverviewFromRows(all: LeaveOverviewRows, filters: LeaveOverviewFilters): LeaveOverview {
  if (all.kind !== OVERVIEW_READY) return all;

  const searched = searchedLeaveOverviewRows(all.rows, filters.search);
  const teams = teamOptionsOf(
    all.rows,
    searched.filter((row) => inLeaveOverviewState(row, filters.state)),
  );
  const team = teams.some((option) => option.value === filters.team) ? filters.team : ALL_TEAMS;
  const inTeamRows = searched.filter((row) => inTeam(row, team));
  const states = Object.fromEntries(
    OVERVIEW_STATES.map((state) => [state, inTeamRows.filter((row) => inLeaveOverviewState(row, state)).length]),
  ) as Record<LeaveOverviewState, number>;
  const rows = sortedLeaveOverviewRows(
    inTeamRows.filter((row) => inLeaveOverviewState(row, filters.state)),
    filters.sort,
  );
  let empty: Extract<LeaveOverview, { kind: typeof OVERVIEW_READY }>['empty'] = null;

  if (rows.length === 0) {
    if (all.rows.length === 0) empty = OVERVIEW_EMPTY_NONE;
    else if (leaveOverviewNarrowed({ team, state: filters.state })) empty = OVERVIEW_EMPTY_FILTERED;
    else empty = OVERVIEW_EMPTY_SEARCH;
  }

  return {
    kind: OVERVIEW_READY,
    rows,
    sort: filters.sort,
    summary: leaveOverviewSummaryOf(rows),
    empty,
    team,
    teams,
    states,
  };
}

/** The overview from its reads and the URL's filters, at `now`. */
export function leaveOverviewOf(sources: LeaveOverviewSources, filters: LeaveOverviewFilters, now: Date): LeaveOverview {
  return leaveOverviewFromRows(leaveOverviewRowsOf(sources, now), filters);
}
