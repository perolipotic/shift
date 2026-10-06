import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarTodayOf } from '@/features/calendar/utils/month';
import { hoursConflictsStateOf } from '@/features/hours/services/hours-conflicts';
import { myHoursSurfaceOf, type HoursSearch, type MyHoursSurface } from '@/features/hours/services/my-hours';
import type { LeaveMembersSource, LeaveOrganizationSource } from '@/features/leave/services/leave-section';
import { MY_LEAVE_READY, myLeaveOf, myLeaveRowsStateOf, type MyLeave, type MyLeaveSources } from '@/features/leave/services/my-leave';
import {
  TILE_LOADING,
  TILE_READY,
  TILE_UNAVAILABLE,
  hoursTileOf,
  leaveTileOf,
  todayTilesOf,
  type HoursTile,
  type HoursTileFigures,
  type LeaveTile,
  type LeaveTileFigures,
} from '@/features/today/services/today-tiles';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  calendarOrganizationRow,
  calendarTableOf,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 6.1b's tiles, executed (AD-15): every row of the spec's matrix but
 * the cost rows (`today.test.ts`), each tile built exactly as the hook builds
 * it — *Sati*'s `myHoursSurfaceOf` over `hoursConflictsStateOf` for today's
 * month, *Godišnji*'s `myLeaveOf` over its four reads — and compared against
 * the figures *Sati* and *Godišnji* themselves show for the same inputs.
 *
 * The pilot: team A works `Dan, Noć, Slobodno, Slobodno` from 2020-01-01;
 * September 2026 holds 8 Dan and 7 Noć, 180 h.
 */

const TEAM_A = 'pilot-smjena-a';
/** 2026-09-26, noon in Zagreb. */
const NOW = new Date('2026-09-26T10:00:00Z');
/** *Sati*'s search for the same month, named. */
const SEPTEMBER: HoursSearch = { mjesec: '2026-09' };

type Row = Record<string, unknown>;

async function snapshotOf(versions: readonly Row[] = [membershipRow(TEAM_A, SEEDED)]): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [calendarOrganizationRow(PILOT, { viewers: [viewerRow(versions, { role: 'member_role' })] })],
      error: null,
      count: 1,
    },
    membersAnswerOf(),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A row as `my_leave_records()` answers it: the range canonical, its upper bound exclusive. */
function rowOf(id: string, from: string, toExclusive: string): Row {
  return { id, member_id: VIEWER_MEMBER, during: `[${from},${toExclusive})` };
}

/** A row as `my_conflict_resolutions()` answers it. */
function resolutionOf(date: string, kind = 'accept_uncovered'): Row {
  return { member_id: VIEWER_MEMBER, date, team_id: TEAM_A, kind, roster_override_id: null };
}

/** The pilot's worked example: 10.09–14.09 over Dan, Noć, Slobodno, Slobodno, Dan — 3 leave days, 3 collisions. */
const WORKED = rowOf('record-worked', '2026-09-10', '2026-09-15');

interface Answer {
  readonly data: readonly unknown[] | undefined;
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly fetchStatus: string;
}

function settled(rows: readonly unknown[]): Answer {
  return { data: rows, isError: false, isPending: false, fetchStatus: 'idle' };
}

const FAILED: Answer = { data: undefined, isError: true, isPending: false, fetchStatus: 'idle' };
const PENDING: Answer = { data: undefined, isError: false, isPending: true, fetchStatus: 'fetching' };

/** *Sati*'s member surface, as the hook builds it: today's month (`{}`) unless `search` names one. */
function hoursOf(
  snapshot: CalendarSnapshot,
  leave: Answer,
  resolutions: Answer,
  search: HoursSearch = {},
): MyHoursSurface {
  return myHoursSurfaceOf(
    { snapshot, refusal: null, loading: false },
    hoursConflictsStateOf(snapshot, leave, resolutions),
    search,
    calendarTodayOf(snapshot, NOW),
  );
}

const MEMBERS: LeaveMembersSource = {
  members: [{ id: VIEWER_MEMBER, leaveAllowanceDays: 20 }],
  refusal: null,
  loading: false,
  paused: false,
};

const ORGANIZATION: LeaveOrganizationSource = {
  data: { ok: true, snapshot: { leaveYearStartMonth: 1, leaveYearStartDay: 1 } },
  isPending: false,
  isError: false,
  fetchStatus: 'idle',
};

/** *Godišnji*'s state, as the hook builds it. */
function leaveOf(snapshot: CalendarSnapshot, records: Answer, overrides: Partial<MyLeaveSources> = {}): MyLeave {
  return myLeaveOf(
    {
      members: MEMBERS,
      calendar: { snapshot, loading: false },
      organization: ORGANIZATION,
      records: myLeaveRowsStateOf(records),
      ...overrides,
    },
    NOW,
  );
}

function hoursFiguresOf(tile: HoursTile): HoursTileFigures {
  if (tile.kind !== TILE_READY) throw new Error(`not ready: ${tile.kind}`);

  return tile.figures;
}

function leaveFiguresOf(tile: LeaveTile): LeaveTileFigures {
  if (tile.kind !== TILE_READY) throw new Error(`not ready: ${tile.kind}`);

  return tile.figures;
}

/** The hint as the tile renders it: each band `‹ime› ‹h›`, joined by the separator. */
function hintOf(figures: HoursTileFigures): string {
  return figures.bands
    .map((band) => t('danas.tiles.band', { name: band.name, hours: t(band.hours.key, band.hours.values) }))
    .join(t('danas.tiles.separator'));
}

let pilot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the hours tile', () => {
  it("shows today's month, 180 h, and every band as Sati does: Dan 96 h · Noć 84 h", () => {
    const surface = hoursOf(pilot, settled([]), settled([]));
    const figures = hoursFiguresOf(hoursTileOf(surface));
    const sati = hoursOf(pilot, settled([]), settled([]), SEPTEMBER).view!;

    expect(t('danas.tiles.hoursKicker', { month: figures.monthName, year: figures.year })).toBe('Sati · Rujan 2026');
    expect(t(figures.total.key, figures.total.values)).toBe('180 h');
    expect(hintOf(figures)).toBe('Dan 96 h · Noć 84 h');
    expect(figures.conflictCount).toBeNull();
    // EQUAL TO SATI, figure for figure.
    expect(figures.total).toEqual(sati.total);
    expect(figures.bands).toEqual(sati.bands);
  });

  it('shows 0 h and every band at 0 h when the month has no shift yet', async () => {
    const empty = await snapshotOf([]);
    const figures = hoursFiguresOf(hoursTileOf(hoursOf(empty, settled([]), settled([]))));

    expect(t(figures.total.key, figures.total.values)).toBe('0 h');
    expect(hintOf(figures)).toBe('Dan 0 h · Noć 0 h');
  });

  it("keeps the total as Sati shows it beside Sati's conflict line for an unresolved conflict", () => {
    const figures = hoursFiguresOf(hoursTileOf(hoursOf(pilot, settled([WORKED]), settled([]))));
    const sati = hoursOf(pilot, settled([WORKED]), settled([]), SEPTEMBER).view!;

    expect(t(figures.total.key, figures.total.values)).toBe('180 h');
    expect(figures.conflictCount).toBe(3);
    expect(figures.conflictCount).toBe(sati.conflictCount);
    expect(t('sati.conflicts', { count: figures.conflictCount ?? 0 })).toBe('3 smjene u neriješenom konfliktu');
  });

  it('leaves an accepted-uncovered shift out of the total, as Sati does', () => {
    const accepted = [resolutionOf('2026-09-10')];
    const figures = hoursFiguresOf(hoursTileOf(hoursOf(pilot, settled([WORKED]), settled(accepted))));
    const sati = hoursOf(pilot, settled([WORKED]), settled(accepted), SEPTEMBER).view!;

    expect(t(figures.total.key, figures.total.values)).toBe('168 h');
    expect(figures.total).toEqual(sati.total);
    expect(figures.bands).toEqual(sati.bands);
    expect(figures.conflictCount).toBe(2);
  });

  it("is Sati's unavailable sentence when the resolutions read fails, and the leave tile is unaffected", () => {
    const tiles = todayTilesOf(hoursOf(pilot, settled([]), FAILED), leaveOf(pilot, settled([])));

    expect(tiles.hours).toEqual({ kind: TILE_UNAVAILABLE, key: 'sati.error.unavailable' });
    expect(t('sati.error.unavailable')).toBe('Sate trenutačno nije moguće učitati. Pokušaj ponovno.');
    expect(leaveFiguresOf(tiles.leave).balanceDays).toBe(20);
  });

  it('is unavailable for rows that cannot be trusted, logged', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stranger = { ...resolutionOf('2026-09-10'), member_id: 'stranger' };

    expect(hoursTileOf(hoursOf(pilot, settled([]), settled([stranger])))).toEqual({
      kind: TILE_UNAVAILABLE,
      key: 'sati.error.unavailable',
    });
    expect(logged).toHaveBeenCalled();
  });

  it('is its skeleton while a read is pending', () => {
    expect(hoursTileOf(hoursOf(pilot, settled([]), PENDING))).toEqual({ kind: TILE_LOADING });
    expect(
      hoursTileOf(myHoursSurfaceOf({ snapshot: null, refusal: null, loading: true }, null, {}, null)),
    ).toEqual({ kind: TILE_LOADING });
  });
});

describe('the leave tile', () => {
  it("shows Godišnji's balance, used and allowance: 17 dana, iskorišteno 3 od 20", () => {
    const leave = leaveOf(pilot, settled([WORKED]));
    const figures = leaveFiguresOf(leaveTileOf(leave));

    if (leave.kind !== MY_LEAVE_READY) throw new Error(leave.kind);

    expect(figures).toEqual({ balanceDays: 17, usedDays: 3, allowanceDays: 20 });
    // EQUAL TO GODIŠNJI, figure for figure.
    expect(figures).toEqual({
      balanceDays: leave.balance.balanceDays,
      usedDays: leave.balance.usedDays,
      allowanceDays: leave.balance.allowanceDays,
    });
    expect(t('count.days', { count: figures.balanceDays })).toBe('17 dana');
    expect(t('danas.tiles.leaveHint', { used: figures.usedDays, allowance: figures.allowanceDays })).toBe(
      'preostalo · iskorišteno 3 od 20',
    );
  });

  it('keeps a balance below zero a number', () => {
    const members: LeaveMembersSource = { ...MEMBERS, members: [{ id: VIEWER_MEMBER, leaveAllowanceDays: 1 }] };
    const figures = leaveFiguresOf(leaveTileOf(leaveOf(pilot, settled([WORKED]), { members })));

    expect(figures).toEqual({ balanceDays: -2, usedDays: 3, allowanceDays: 1 });
    // Intl's Croatian minus sign (U+2212), never dropped.
    expect(t('count.days', { count: figures.balanceDays })).toBe('\u22122 dana');
  });

  it('is its skeleton alone while the members read is pending, and the hours tile is unaffected', () => {
    const members: LeaveMembersSource = { members: null, refusal: null, loading: true, paused: false };
    const tiles = todayTilesOf(hoursOf(pilot, settled([]), settled([])), leaveOf(pilot, settled([]), { members }));

    expect(tiles.leave).toEqual({ kind: TILE_LOADING });
    expect(tiles.hours.kind).toBe(TILE_READY);
  });

  it("is Godišnji's unavailable sentence when a read fails", () => {
    expect(leaveTileOf(leaveOf(pilot, FAILED))).toEqual({ kind: TILE_UNAVAILABLE, key: 'godisnji.unavailable' });
  });

  it("is Godišnji's own sentence for a viewer with no team", async () => {
    const empty = await snapshotOf([]);

    expect(leaveTileOf(leaveOf(empty, settled([])))).toEqual({ kind: TILE_UNAVAILABLE, key: 'godisnji.unscheduled' });
  });
});

describe('the words', () => {
  it('names the leave tile without a year: a leave year may span two', () => {
    expect(t('danas.tiles.leaveKicker')).toBe('Godišnji odmor');
  });

  it('counts the balance in all three Croatian forms, never by count === 1', () => {
    expect(t('count.days', { count: 1 })).toBe('1 dan');
    expect(t('count.days', { count: 2 })).toBe('2 dana');
    expect(t('count.days', { count: 5 })).toBe('5 dana');
    expect(t('count.days', { count: 21 })).toBe('21 dan');
  });
});
