import { collisionKeyOf, collisionsOf, type Collision, type CollisionInput } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_UNAVAILABLE,
  readCalendar,
  type CalendarSnapshot,
  type CalendarSurfaceState,
} from '@/features/calendar/services/snapshot';
import { unknownSnapshotIdsOf } from '@/features/calendar/services/snapshot-skew';
import {
  CONFLICTS_LOADING,
  CONFLICTS_READY,
  CONFLICTS_UNAVAILABLE,
  conflictsQueueOf,
  conflictsQueueOutcomeOf,
  ITEM_COLLISION,
  ITEM_REQUEST,
  collisionRowsOf,
  mergedQueueOrderOf,
  queueOrderOf,
  queueCountOf,
  type ConflictRow,
  type ConflictsQueueSources,
  type ConflictsQueueView,
  type LeaveRowsAnswer,
  type RequestRow,
} from '@/features/conflicts/services/conflicts-queue';
import { REPLACEMENT_LINK_MISMATCH } from '@/features/conflicts/services/replacement-effect';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  UJ5,
  assignmentRow,
  calendarOverrideRow,
  typeRow,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 5.3b's view model, executed (AD-15): every row of the spec's matrix
 * but the removed record (the e2e spec's), over both fixtures, every row
 * compared against `collisionsOf` itself — the queue lists the domain's
 * collisions and never its own.
 */

const ANA = '00000000-0000-4000-8000-0000000000c1';

type Row = Record<string, unknown>;

/** Noon in Zagreb on `date`: the organization's today is `date`. */
function nowOn(date: string): Date {
  return new Date(`${date}T10:00:00Z`);
}

function teamOf(rows: FixtureRows, index: number): string {
  const id = rows.teams[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no team ${String(index)}`);

  return id;
}

/**
 * The viewer on the first team, Ana on the second (or the team `anaTeam`
 * names), each since the fixture's seeding.
 */
async function snapshotOf(
  rows: FixtureRows,
  rosterOverrides: readonly Row[] = [],
  { overrides = [] as readonly Row[], anaTeam = 1 } = {},
): Promise<CalendarSnapshot> {
  const [a, b] = [teamOf(rows, 0), teamOf(rows, anaTeam)];
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow([membershipRow(a, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, a, SEEDED), memberMembershipRow(ANA, b, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(ANA, 'Ana Anić')]),
    overridesAnswerOf(overrides),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A row as `leave_records` answers it: the range canonical, its upper bound exclusive. */
function rowOf(id: string, from: string, toExclusive: string, memberId: string = VIEWER_MEMBER): Row {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}

/** The pilot's worked example: 10.09–14.09 over Dan, Noć, Slobodno, Slobodno, Dan. */
const WORKED = rowOf('record-worked', '2026-09-10', '2026-09-15');

/** The queue over no leave requests: every row a collision. */
function viewOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  today: string,
  resolutionRows: readonly unknown[] = [],
): { readonly count: number; readonly rows: readonly ConflictRow[] } {
  const outcome = conflictsQueueOutcomeOf(snapshot, rows, resolutionRows, today, []);

  if (!outcome.ok) throw new Error(outcome.code);

  const collisions = collisionRowsOf(outcome.view.rows);

  expect(collisions).toHaveLength(outcome.view.rows.length);

  return { count: outcome.view.count, rows: collisions };
}

/**
 * What the domain derives from the same inputs, its input built HERE from
 * the snapshot's own fields rather than through the queue's recipe. Only for
 * snapshots with no shift-type override, where every roster override is in
 * force (none here is ever left pending), so nothing needs the standing.
 */
function domainOf(snapshot: CalendarSnapshot, rows: readonly unknown[]): readonly Collision[] {
  const records = organizationLeaveRecordsOf(
    rows,
    snapshot.members.map((member) => member.id),
  );

  if (records === null) throw new Error('rows refused');
  if (snapshot.overrides.length > 0) throw new Error('domainOf builds no override standing');

  const input: CollisionInput = {
    assignments: snapshot.assignments,
    steps: snapshot.steps,
    overrides: [],
    members: snapshot.members,
    rosterOverrides: snapshot.rosterOverrides,
    workingShiftTypeIds: snapshot.types.filter((type) => type.isWorking).map((type) => type.id),
    leaveRecords: records.map(({ id, memberId, from, to }) => ({ id, memberId, from, to })),
  };

  return collisionsOf(input);
}

let pilot: CalendarSnapshot;
let uj5: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf(PILOT);
  uj5 = await snapshotOf(UJ5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the worked example', () => {
  it('lists 3 conflicts, 10.09 first, under `3 čekaju odluku`', () => {
    const view = viewOf(pilot, [WORKED], '2026-09-01');

    expect(view.count).toBe(3);
    expect(view.rows.map((row) => row.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-14']);
    expect(view.rows.map((row) => row.shiftTypeName)).toEqual(['Dan', 'Noć', 'Dan']);
    expect(view.rows.map((row) => row.times)).toEqual(['07:00–19:00', '19:00–07:00', '07:00–19:00']);
    expect(view.rows.every((row) => !row.past)).toBe(true);
    expect(t('zaOdluku.count', { count: view.count })).toBe('3 čekaju odluku');
  });

  it('names the date, the team, the shift type, the member and the causing range on each row', () => {
    const [first] = viewOf(pilot, [WORKED], '2026-09-01').rows;

    expect(first).toEqual({
      kind: ITEM_COLLISION,
      key: collisionKeyOf({ memberId: VIEWER_MEMBER, date: '2026-09-10', teamId: teamOf(PILOT, 0) }),
      memberId: VIEWER_MEMBER,
      date: '2026-09-10',
      teamId: teamOf(PILOT, 0),
      shiftTypeId: 'pilot-dan',
      leaveRecordId: 'record-worked',
      dateShown: '10.09.2026',
      past: false,
      memberName: VIEWER_NAME,
      teamName: 'Smjena A',
      shiftTypeName: 'Dan',
      times: '07:00–19:00',
      leaveFrom: '10.09.2026',
      leaveTo: '14.09.2026',
    });
  });

  it.each([
    ['the pilot', () => pilot],
    ['UJ5', () => uj5],
  ])("lists exactly the domain's collisions over %s", (_name, snapshotFor) => {
    const snapshot = snapshotFor();
    const rows = [WORKED, rowOf('record-ana', '2026-09-01', '2026-09-08', ANA)];
    const view = viewOf(snapshot, rows, '2026-09-01');
    const domain = domainOf(snapshot, rows);

    expect(domain.length).toBeGreaterThan(0);
    expect(view.count).toBe(domain.length);
    expect(view.rows.map((row) => row.key)).toEqual(domain.map(collisionKeyOf));
  });
});

describe('the order', () => {
  it('lists upcoming conflicts soonest first, then past ones most recent first', () => {
    // 02.09 Dan, 03.09 Noć; 14.09 Dan, 15.09 Noć — today 10.09.
    const rows = [rowOf('record-early', '2026-09-02', '2026-09-04'), rowOf('record-late', '2026-09-14', '2026-09-16')];
    const view = viewOf(pilot, rows, '2026-09-10');

    expect(view.rows.map((row) => [row.date, row.past])).toEqual([
      ['2026-09-14', false],
      ['2026-09-15', false],
      ['2026-09-03', true],
      ['2026-09-02', true],
    ]);
    expect(view.count).toBe(4);
  });

  it('lists the matrix example: 12.09, 13.09, then 04.09 and 02.09 as past, today 10.09', async () => {
    // Ana on Smjena C, which works 04.09, 12.09 and 13.09; the viewer on
    // Smjena A, which works 02.09. Neither team works the other's dates.
    const snapshot = await snapshotOf(PILOT, [], { anaTeam: 2 });
    const rows = [
      rowOf('record-viewer', '2026-09-02', '2026-09-03'),
      rowOf('record-ana-early', '2026-09-04', '2026-09-05', ANA),
      rowOf('record-ana-late', '2026-09-12', '2026-09-14', ANA),
    ];
    const view = viewOf(snapshot, rows, '2026-09-10');

    expect(view.rows.map((row) => [row.date, row.memberName, row.past])).toEqual([
      ['2026-09-12', 'Ana Anić', false],
      ['2026-09-13', 'Ana Anić', false],
      ['2026-09-04', 'Ana Anić', true],
      ['2026-09-02', VIEWER_NAME, true],
    ]);
    expect(view.count).toBe(4);
  });

  it('counts a conflict dated today as upcoming, not past', () => {
    const view = viewOf(pilot, [WORKED], '2026-09-10');

    expect(view.rows[0]).toMatchObject({ date: '2026-09-10', past: false });
    expect(view.rows.filter((row) => row.past)).toEqual([]);
  });

  it("keeps the domain's order within one date, on both sides of today", () => {
    const of = (date: string, teamId: string): Collision => ({
      memberId: 'm',
      date,
      teamId,
      shiftTypeId: 's',
      leaveRecordId: 'r',
    });
    const ordered = [of('2026-09-01', 'a'), of('2026-09-01', 'b'), of('2026-09-05', 'a'), of('2026-09-05', 'b'), of('2026-09-20', 'a'), of('2026-09-20', 'b')];

    expect(queueOrderOf(ordered, '2026-09-10')).toEqual([ordered[4], ordered[5], ordered[2], ordered[3], ordered[0], ordered[1]]);
  });

  it('sorts the upcoming group itself, never trusting the order it is given', () => {
    const of = (date: string, teamId: string): Collision => ({
      memberId: 'm',
      date,
      teamId,
      shiftTypeId: 's',
      leaveRecordId: 'r',
    });
    const shuffled = [of('2026-09-20', 'a'), of('2026-09-12', 'a'), of('2026-09-20', 'b'), of('2026-09-01', 'a'), of('2026-09-12', 'b')];

    expect(queueOrderOf(shuffled, '2026-09-10')).toEqual([shuffled[1], shuffled[4], shuffled[0], shuffled[2], shuffled[3]]);
  });

  it('reads today in the organization zone, never the UTC date', () => {
    // 22:30 UTC on the 10th is already the 11th in Zagreb: the 10th (Dan) is
    // PAST there, though the UTC date would still call it today.
    const queue = conflictsQueueOf(
      { calendar: { snapshot: pilot, refusal: null, loading: false }, records: answered([WORKED]), resolutions: answered([]), requests: answered([]) },
      new Date('2026-09-10T22:30:00Z'),
    );

    if (queue.kind !== CONFLICTS_READY) throw new Error(queue.kind);

    expect(queue.view.rows.map((row) => [row.date, row.past])).toEqual([
      ['2026-09-11', false],
      ['2026-09-14', false],
      ['2026-09-10', true],
    ]);
  });

  it('reads the organization zone the other way too: a zone behind UTC keeps the date upcoming', () => {
    // 02:00 UTC on the 11th is still the 10th in New York: the 10th is today, not past.
    const behind: CalendarSnapshot = { ...pilot, timeZone: 'America/New_York' };
    const queue = conflictsQueueOf(
      { calendar: { snapshot: behind, refusal: null, loading: false }, records: answered([WORKED]), resolutions: answered([]), requests: answered([]) },
      new Date('2026-09-11T02:00:00Z'),
    );

    if (queue.kind !== CONFLICTS_READY) throw new Error(queue.kind);

    expect(queue.view.rows.map((row) => [row.date, row.past])).toEqual([
      ['2026-09-10', false],
      ['2026-09-11', false],
      ['2026-09-14', false],
    ]);
  });
});

describe('two teams on one date', () => {
  it('lists two rows when a roster override puts the member on a second team', async () => {
    const date = viewOf(pilot, [WORKED], '2026-09-01').rows[0]!.date;
    const b = teamOf(PILOT, 1);
    // Team B works the pilot's 10.09 too, so the override puts the viewer on
    // a second working shift that date; the domain says so below.
    const snapshot = await snapshotOf(PILOT, [calendarRosterOverrideRow('put-on', b, date, null, VIEWER_MEMBER)]);
    const view = viewOf(snapshot, [WORKED], '2026-09-01');
    const domain = domainOf(snapshot, [WORKED]);
    const onDate = domain.filter((collision) => collision.date === date);

    expect(view.rows.map((row) => row.key)).toEqual(domain.map(collisionKeyOf));
    expect(onDate.map((collision) => collision.teamId).sort()).toEqual([teamOf(PILOT, 0), b].sort());
    expect(view.rows.filter((row) => row.date === date).map((row) => row.teamName)).toEqual(['Smjena A', 'Smjena B']);
  });
});

describe('shift-type overrides', () => {
  const a = teamOf(PILOT, 0);

  it('follows an override in force, both ways: a working date made free, a free one made working', async () => {
    // Over 10.09–14.09 (Dan, Noć, Slobodno, Slobodno, Dan): 11.09 Noć becomes
    // Slobodno, and 12.09 Slobodno becomes Dan.
    const snapshot = await snapshotOf(PILOT, [], {
      overrides: [
        calendarOverrideRow('free', a, '2026-09-11', 'pilot-slobodno'),
        calendarOverrideRow('working', a, '2026-09-12', 'pilot-dan'),
      ],
    });
    const view = viewOf(snapshot, [WORKED], '2026-09-01');

    expect(view.rows.map((row) => [row.date, row.shiftTypeName])).toEqual([
      ['2026-09-10', 'Dan'],
      ['2026-09-12', 'Dan'],
      ['2026-09-14', 'Dan'],
    ]);
  });

  it('ignores an override a later rotation change left pending', async () => {
    // Smjena A changes phase from 20.09 (Slobodno, Slobodno, Dan, Noć …),
    // saved on 15.09 — after the override on the 21st was written (12.09), so
    // that override is pending review and not in force.
    const changed: FixtureRows = {
      ...PILOT,
      assignments: [
        ...PILOT.assignments,
        assignmentRow(a, 'pilot-rotation', 'pilot-step-2', '2026-09-20', '2026-09-20', undefined, {
          createdAt: '2026-09-15T10:00:00+00:00',
        }),
      ],
    };
    const snapshot = await snapshotOf(changed, [], {
      overrides: [calendarOverrideRow('pending', a, '2026-09-21', 'pilot-dan')],
    });
    const view = viewOf(snapshot, [rowOf('record-change', '2026-09-20', '2026-09-24')], '2026-09-01');

    expect(view.rows.map((row) => [row.date, row.shiftTypeName])).toEqual([
      ['2026-09-22', 'Dan'],
      ['2026-09-23', 'Noć'],
    ]);
  });

  it('shows a working type with no times in effect without them, through `zaOdluku.detail`', async () => {
    const untimed: FixtureRows = {
      ...PILOT,
      types: [...PILOT.types, typeRow('pilot-dezurstvo', 'Dežurstvo', '2026-09-25T20:07:49.339741+00:00')],
    };
    const snapshot = await snapshotOf(untimed, [], {
      overrides: [calendarOverrideRow('untimed', a, '2026-09-12', 'pilot-dezurstvo')],
    });
    const row = viewOf(snapshot, [WORKED], '2026-09-01').rows.find((one) => one.date === '2026-09-12');

    expect(row).toMatchObject({ shiftTypeName: 'Dežurstvo', times: null });
    expect(t('zaOdluku.detail', { type: row!.shiftTypeName, from: row!.leaveFrom, to: row!.leaveTo })).toBe(
      'Dežurstvo · Godišnji odmor 10.09.2026–14.09.2026',
    );
  });
});

describe('none', () => {
  it('shows `0 čeka odluku` with no live leave', () => {
    const view = viewOf(pilot, [], '2026-09-01');

    expect(view).toEqual({ count: 0, rows: [] });
    expect(t('zaOdluku.count', { count: 0 })).toBe('0 čeka odluku');
    expect(t('zaOdluku.empty')).toBe('Ništa ne čeka odluku.');
  });

  it('lists nothing for leave only over non-working dates', () => {
    // 12.09 and 13.09 are Slobodno.
    expect(viewOf(pilot, [rowOf('record-off', '2026-09-12', '2026-09-14')], '2026-09-01')).toEqual({ count: 0, rows: [] });
  });

  it.each([
    [1, '1 čeka odluku'],
    [2, '2 čekaju odluku'],
    [4, '4 čekaju odluku'],
    [5, '5 čeka odluku'],
    [11, '11 čeka odluku'],
    [12, '12 čeka odluku'],
    [14, '14 čeka odluku'],
    [21, '21 čeka odluku'],
    [22, '22 čekaju odluku'],
    [23, '23 čekaju odluku'],
    [24, '24 čekaju odluku'],
    [25, '25 čeka odluku'],
  ])('says %i in its Croatian form', (count, shown) => {
    expect(t('zaOdluku.count', { count })).toBe(shown);
  });
});

describe('corrupt data refuses the whole queue', () => {
  it.each([
    ['an unknown member', [WORKED, rowOf('record-stranger', '2026-09-01', '2026-09-03', 'stranger')]],
    ['overlapping rows of one member', [WORKED, rowOf('record-overlap', '2026-09-14', '2026-09-18')]],
    ['a bad range', [WORKED, { id: 'record-bad', member_id: VIEWER_MEMBER, during: 'garbage' }]],
    ['an id two members share', [WORKED, rowOf('record-worked', '2026-09-01', '2026-09-03', ANA)]],
    ['a row that is not a record', [WORKED, null]],
  ])('refuses %s, and logs it', (_name, rows) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(conflictsQueueOutcomeOf(pilot, rows, [], '2026-09-01', [])).toEqual({ ok: false, code: CONFLICTS_UNAVAILABLE });
    expect(logged).toHaveBeenCalledWith(CONFLICTS_UNAVAILABLE, expect.any(RangeError));
  });
});

/** A settled records read that answered `rows`. */
function answered(rows: readonly unknown[]): LeaveRowsAnswer {
  return { isPending: false, isError: false, fetchStatus: 'idle', data: rows };
}

describe('the four reads', () => {
  const ready: CalendarSurfaceState = { snapshot: null, refusal: null, loading: false };

  it('is ready once both answered', () => {
    const queue = conflictsQueueOf(
      { calendar: { ...ready, snapshot: pilot }, records: answered([WORKED]), resolutions: answered([]), requests: answered([]) },
      nowOn('2026-09-01'),
    );

    expect(queue.kind).toBe(CONFLICTS_READY);
  });

  it('is loading while either read is pending', () => {
    const pending: LeaveRowsAnswer = { isPending: true, isError: false, fetchStatus: 'fetching', data: undefined };

    expect(
      conflictsQueueOf({ calendar: { ...ready, loading: true }, records: answered([]), resolutions: answered([]), requests: answered([]) }, nowOn('2026-09-01')),
    ).toEqual({ kind: CONFLICTS_LOADING });
    expect(
      conflictsQueueOf({ calendar: { ...ready, snapshot: pilot }, records: pending, resolutions: answered([]), requests: answered([]) }, nowOn('2026-09-01')),
    ).toEqual({ kind: CONFLICTS_LOADING });
    expect(
      conflictsQueueOf({ calendar: { ...ready, snapshot: pilot }, records: answered([WORKED]), resolutions: pending, requests: answered([]) }, nowOn('2026-09-01')),
    ).toEqual({ kind: CONFLICTS_LOADING });
  });

  it.each([
    ['the calendar read failed', { snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false }, answered([])],
    ['the records read failed', { snapshot: null, refusal: null, loading: true }, { isPending: true, isError: true, fetchStatus: 'idle', data: undefined }],
    ['a records refetch failed over cached rows', { snapshot: null, refusal: null, loading: false }, { isPending: false, isError: true, fetchStatus: 'idle', data: [] }],
    ['the records read is paused offline', { snapshot: null, refusal: null, loading: false }, { isPending: false, isError: false, fetchStatus: 'paused', data: [] }],
  ] as const)('is unavailable when %s, ahead of any skeleton', (_name, calendar, records) => {
    const state: CalendarSurfaceState = { ...calendar, snapshot: calendar.refusal === null && !calendar.loading ? pilot : null };

    expect(conflictsQueueOf({ calendar: state, records, resolutions: answered([]), requests: answered([]) }, nowOn('2026-09-01'))).toEqual({
      kind: CONFLICTS_UNAVAILABLE,
    });
  });

  it('derives the same queue on every read and changes nothing it reads', () => {
    const rows = Object.freeze([Object.freeze({ ...WORKED })]);
    const first = viewOf(pilot, rows, '2026-09-01');

    expect(viewOf(pilot, rows, '2026-09-01')).toEqual(first);
  });

  // E765, as the calendar's marks: rows newer than the cached snapshot are a
  // skew between the reads, never logged as rows that cannot be trusted.
  it.each([
    ['a leave row of a newer member', [WORKED, rowOf('record-newer', '2026-09-01', '2026-09-03', 'newer-member')], []],
    ['a resolution on a newer team', [WORKED], [resolutionOf(VIEWER_MEMBER, '2026-09-11', 'newer-team')]],
    ['a resolution of a newer member', [WORKED], [resolutionOf('newer-member', '2026-09-11', teamOf(PILOT, 0))]],
  ])('is unavailable, unlogged, for %s, and loading while the snapshot is read again', (_name, rows, resolutionRows) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sources = { calendar: { ...ready, snapshot: pilot }, records: answered(rows), resolutions: answered(resolutionRows), requests: answered([]) };

    expect(conflictsQueueOf(sources, nowOn('2026-09-01'))).toEqual({ kind: CONFLICTS_UNAVAILABLE });
    expect(conflictsQueueOf({ ...sources, snapshotFetching: true }, nowOn('2026-09-01'))).toEqual({ kind: CONFLICTS_LOADING });
    expect(logged).not.toHaveBeenCalled();
  });
});

/** A resolution row as `conflict_resolutions` answers it. */
function resolutionOf(
  memberId: string,
  date: string,
  teamId: string,
  kind = 'accept_uncovered',
  rosterOverrideId: string | null = null,
): Row {
  return { member_id: memberId, date, team_id: teamId, kind, roster_override_id: rosterOverrideId };
}

describe('resolutions (story 5.4a)', () => {
  const a = teamOf(PILOT, 0);

  it('drops the resolved conflict: 3 collisions, 1 resolved, 2 listed and counted', () => {
    const view = viewOf(pilot, [WORKED], '2026-09-01', [resolutionOf(VIEWER_MEMBER, '2026-09-11', a)]);

    expect(view.count).toBe(2);
    expect(view.rows).toHaveLength(view.count);
    expect(view.rows.map((row) => row.date)).toEqual(['2026-09-10', '2026-09-14']);
    expect(t('zaOdluku.count', { count: view.count })).toBe('2 čekaju odluku');
  });

  it.each([
    ['the pilot', () => pilot],
    ['UJ5', () => uj5],
  ])("lists exactly the domain's unresolved collisions over %s", (_name, snapshotFor) => {
    const snapshot = snapshotFor();
    const rows = [WORKED, rowOf('record-ana', '2026-09-01', '2026-09-08', ANA)];
    const domain = domainOf(snapshot, rows);
    const [resolved] = domain;

    if (resolved === undefined) throw new Error('no collision');

    const view = viewOf(snapshot, rows, '2026-09-01', [resolutionOf(resolved.memberId, resolved.date, resolved.teamId)]);

    expect(view.count).toBe(domain.length - 1);
    expect(view.rows.map((row) => row.key)).toEqual(domain.slice(1).map(collisionKeyOf));
  });

  it("keeps the other team's conflict when a roster override puts the member on two teams and one is resolved", async () => {
    const b = teamOf(PILOT, 1);
    const snapshot = await snapshotOf(PILOT, [calendarRosterOverrideRow('put-on', b, '2026-09-10', null, VIEWER_MEMBER)]);
    const view = viewOf(snapshot, [WORKED], '2026-09-01', [resolutionOf(VIEWER_MEMBER, '2026-09-10', a)]);

    expect(view.rows.filter((row) => row.date === '2026-09-10').map((row) => row.teamName)).toEqual(['Smjena B']);
    expect(view.count).toBe(viewOf(snapshot, [WORKED], '2026-09-01').count - 1);
  });

  describe('a replacement that no longer applies (story 5.5d)', () => {
    // Ana, of the other team, put on the viewer's 11.09 Noć by a replacement.
    const replaced = [resolutionOf(VIEWER_MEMBER, '2026-09-11', a, 'replace_member', 'ro-ana')];

    it('Effective: hides its conflict while its override applies, as today', async () => {
      const snapshot = await snapshotOf(PILOT, [calendarRosterOverrideRow('ro-ana', a, '2026-09-11', null, ANA)]);

      expect(viewOf(snapshot, [WORKED], '2026-09-01', replaced).count).toBe(2);
    });

    it('Pending after rotation save: lists the conflict again once a rotation save left its override pending', async () => {
      const snapshot = await snapshotOf(PILOT, [
        calendarRosterOverrideRow('ro-ana', a, '2026-09-11', null, ANA, { createdAt: '2019-01-01T00:00:00+00:00' }),
      ]);
      const view = viewOf(snapshot, [WORKED], '2026-09-01', replaced);

      expect(view.count).toBe(3);
      expect(view.rows.map((row) => row.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-14']);
    });

    it('Fetch skew: a link to an override the snapshot does not hold yet keeps hiding its conflict until the snapshot is read again', () => {
      expect(viewOf(pilot, [WORKED], '2026-09-01', replaced).count).toBe(2);
    });

    it('Accept unaffected: an accepted conflict stays hidden beside a pending replacement', async () => {
      const snapshot = await snapshotOf(PILOT, [
        calendarRosterOverrideRow('ro-ana', a, '2026-09-11', null, ANA, { createdAt: '2019-01-01T00:00:00+00:00' }),
      ]);

      expect(viewOf(snapshot, [WORKED], '2026-09-01', [...replaced, resolutionOf(VIEWER_MEMBER, '2026-09-10', a)]).count).toBe(2);
    });

    it('One bad link: a link that disagrees with its override is logged and shows its conflict, never the whole queue unavailable', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // The override is on 11.09; the resolution names it from 10.09.
      const snapshot = await snapshotOf(PILOT, [calendarRosterOverrideRow('ro-ana', a, '2026-09-11', null, ANA)]);
      const outcome = conflictsQueueOutcomeOf(
        snapshot,
        [WORKED],
        [resolutionOf(VIEWER_MEMBER, '2026-09-10', a, 'replace_member', 'ro-ana')],
        '2026-09-01',
        [],
      );

      expect(outcome.ok).toBe(true);
      expect(viewOf(snapshot, [WORKED], '2026-09-01', [resolutionOf(VIEWER_MEMBER, '2026-09-10', a, 'replace_member', 'ro-ana')]).count).toBe(3);
      expect(logged).toHaveBeenCalledWith(REPLACEMENT_LINK_MISMATCH, 'ro-ana');
    });
  });

  it('ignores a resolution that matches no collision, whatever its kind', () => {
    const view = viewOf(pilot, [WORKED], '2026-09-01', [
      resolutionOf(VIEWER_MEMBER, '2026-09-12', a, 'amend_leave'),
      resolutionOf(ANA, '2026-09-10', a, 'replace_member', 'ro-elsewhere'),
    ]);

    expect(view.count).toBe(3);
  });

  it.each([
    ['an unknown team', [resolutionOf(VIEWER_MEMBER, '2026-09-11', 'no-such-team')]],
    ['an unknown member', [resolutionOf('stranger', '2026-09-11', a)]],
    ['a date that is no calendar date', [resolutionOf(VIEWER_MEMBER, '2026-02-30', a)]],
    ['an unknown kind', [resolutionOf(VIEWER_MEMBER, '2026-09-11', a, 'uncovered')]],
    ['two live rows of one key', [resolutionOf(VIEWER_MEMBER, '2026-09-11', a), resolutionOf(VIEWER_MEMBER, '2026-09-11', a, 'amend_leave')]],
    ['a row that is not a record', [null]],
    // 0032's check, as an integrity break (story 5.5d).
    ['a replacement with no link', [resolutionOf(VIEWER_MEMBER, '2026-09-11', a, 'replace_member')]],
    ['an acceptance with a link', [resolutionOf(VIEWER_MEMBER, '2026-09-11', a, 'accept_uncovered', 'ro-ana')]],
  ])('refuses the whole queue for %s, and logs it', (_name, resolutionRows) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(conflictsQueueOutcomeOf(pilot, [WORKED], resolutionRows, '2026-09-01', [])).toEqual({ ok: false, code: CONFLICTS_UNAVAILABLE });
    expect(logged).toHaveBeenCalledWith(CONFLICTS_UNAVAILABLE, expect.any(RangeError));
  });

  it.each([
    ['failed', { isPending: true, isError: true, fetchStatus: 'idle', data: undefined }],
    ['failed on a refetch over cached rows', { isPending: false, isError: true, fetchStatus: 'idle', data: [] }],
    ['paused offline', { isPending: false, isError: false, fetchStatus: 'paused', data: [] }],
  ] as const)('is unavailable when the resolutions read %s, never a count without them', (_name, resolutions) => {
    expect(
      conflictsQueueOf({ calendar: { snapshot: pilot, refusal: null, loading: false }, records: answered([WORKED]), resolutions, requests: answered([]) }, nowOn('2026-09-01')),
    ).toEqual({ kind: CONFLICTS_UNAVAILABLE });
  });
});

/** A request row as `leave_requests` answers it, with its decision embedded (story 9.5). */
function requestOf(
  id: string,
  from: string,
  toExclusive: string,
  options: {
    readonly memberId?: string;
    readonly closedAt?: string | null;
    readonly decisions?: readonly unknown[];
    readonly createdAt?: string;
  } = {},
): Row {
  return {
    id,
    member_id: options.memberId ?? VIEWER_MEMBER,
    during: `[${from},${toExclusive})`,
    closed_at: options.closedAt ?? null,
    ...(options.createdAt === undefined ? {} : { created_at: options.createdAt }),
    leave_request_decisions: options.decisions ?? [],
  };
}

const DECIDED_AT = '2026-09-02T08:00:00+00:00';

/** The queue over the four reads, every one answered. */
function mergedOf(
  rows: readonly unknown[],
  resolutionRows: readonly unknown[],
  requestRows: readonly unknown[],
  today: string,
): ConflictsQueueView {
  const outcome = conflictsQueueOutcomeOf(pilot, rows, resolutionRows, today, requestRows);

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.view;
}

describe('pending leave requests beside collisions (story 9.5)', () => {
  const a = teamOf(PILOT, 0);

  it('Mixed: 2 collisions and 1 pending request are `3 čekaju odluku`, by date, each naming its kind', () => {
    const view = mergedOf([WORKED], [resolutionOf(VIEWER_MEMBER, '2026-09-11', a)], [requestOf('req-1', '2026-09-12', '2026-09-14')], '2026-09-01');

    expect(view.count).toBe(3);
    expect(t('zaOdluku.count', { count: view.count })).toBe('3 čekaju odluku');
    expect(view.rows.map((row) => [row.kind, row.date])).toEqual([
      [ITEM_COLLISION, '2026-09-10'],
      [ITEM_REQUEST, '2026-09-12'],
      [ITEM_COLLISION, '2026-09-14'],
    ]);
    expect(t('zaOdluku.kind.collision')).toBe('Odsutnost u smjeni');
    expect(t('zaOdluku.kind.request')).toBe('Zahtjev za godišnji odmor');
  });

  it('Only requests: one pending request is `1 čeka odluku`, a row naming the member and the range', () => {
    const view = mergedOf([], [], [requestOf('req-1', '2026-09-12', '2026-09-14')], '2026-09-01');
    const expected: RequestRow = {
      kind: ITEM_REQUEST,
      key: 'request:req-1',
      requestId: 'req-1',
      memberId: VIEWER_MEMBER,
      date: '2026-09-12',
      dateShown: '12.09.2026',
      past: false,
      memberName: VIEWER_NAME,
      from: '12.09.2026',
      to: '13.09.2026',
      createdAt: null,
    };

    expect(view).toEqual({ count: 1, rows: [expected] });
    expect(t('zaOdluku.count', { count: view.count })).toBe('1 čeka odluku');
    expect(t('zaOdluku.request.range', { from: expected.from, to: expected.to })).toBe('Godišnji odmor 12.09.2026–13.09.2026');
  });

  it('Zero: nothing pending is `0 čeka odluku`', () => {
    expect(mergedOf([], [], [], '2026-09-01')).toEqual({ count: 0, rows: [] });
  });

  it('Withdrawn/decided: a closed request is not in the queue', () => {
    const closed = [
      requestOf('req-approved', '2026-09-20', '2026-09-22', {
        closedAt: DECIDED_AT,
        decisions: [{ outcome: 'approved', decided_by: 'admin-auth', decided_at: DECIDED_AT }],
      }),
      requestOf('req-rejected', '2026-09-20', '2026-09-22', {
        closedAt: DECIDED_AT,
        decisions: [{ outcome: 'rejected', decided_by: 'admin-auth', decided_at: DECIDED_AT }],
      }),
      requestOf('req-withdrawn', '2026-09-24', '2026-09-26', { closedAt: DECIDED_AT }),
    ];

    expect(mergedOf([], [], closed, '2026-09-01')).toEqual({ count: 0, rows: [] });
  });

  it('a request starting before today is past, and sorts with the past items, collisions first on one date', () => {
    const view = mergedOf([WORKED], [], [requestOf('req-past', '2026-09-11', '2026-09-13')], '2026-09-12');

    expect(view.rows.map((row) => [row.kind, row.date, row.past])).toEqual([
      [ITEM_COLLISION, '2026-09-14', false],
      [ITEM_COLLISION, '2026-09-11', true],
      [ITEM_REQUEST, '2026-09-11', true],
      [ITEM_COLLISION, '2026-09-10', true],
    ]);
    expect(view.count).toBe(4);
  });

  it('puts collisions before requests on one upcoming date, then the requests by id', () => {
    const view = mergedOf(
      [WORKED],
      [],
      [requestOf('req-b', '2026-09-10', '2026-09-11', { memberId: ANA }), requestOf('req-a', '2026-09-10', '2026-09-12', { memberId: ANA })],
      '2026-09-01',
    );

    expect(view.rows.map((row) => row.key)).toEqual([
      collisionKeyOf({ memberId: VIEWER_MEMBER, date: '2026-09-10', teamId: a }),
      'request:req-a',
      'request:req-b',
      collisionKeyOf({ memberId: VIEWER_MEMBER, date: '2026-09-11', teamId: a }),
      collisionKeyOf({ memberId: VIEWER_MEMBER, date: '2026-09-14', teamId: a }),
    ]);
  });

  it('orders requests on one date by when they were sent, oldest first, then by id — upcoming and past alike', () => {
    const sent = (id: string, from: string, toExclusive: string, createdAt?: string) =>
      requestOf(id, from, toExclusive, { memberId: ANA, ...(createdAt === undefined ? {} : { createdAt }) });
    const view = mergedOf(
      [],
      [],
      [
        // Upcoming, all from 20.09.
        sent('up-a', '2026-09-20', '2026-09-21', '2026-09-03T10:00:00+00:00'),
        sent('up-b', '2026-09-20', '2026-09-22', '2026-09-01T10:00:00+00:00'),
        sent('up-c', '2026-09-20', '2026-09-23', '2026-09-01T10:00:00+00:00'),
        sent('up-d', '2026-09-20', '2026-09-24'),
        // Past, all from 05.09.
        sent('past-z', '2026-09-05', '2026-09-06', '2026-08-02T09:00:00+00:00'),
        sent('past-y', '2026-09-05', '2026-09-07', '2026-08-01T09:00:00+00:00'),
        sent('past-x', '2026-09-05', '2026-09-08', '2026-08-03T09:00:00+00:00'),
      ],
      '2026-09-10',
    );

    expect(view.rows.map((row) => row.key)).toEqual([
      // The oldest first; two sent at one instant by id; one with no instant last.
      'request:up-b',
      'request:up-c',
      'request:up-a',
      'request:up-d',
      'request:past-y',
      'request:past-z',
      'request:past-x',
    ]);
  });

  it('refuses a row whose sending instant is not one', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      conflictsQueueOutcomeOf(pilot, [], [], '2026-09-01', [{ ...requestOf('req-1', '2026-09-12', '2026-09-14'), created_at: 'never' }]),
    ).toEqual({ ok: false, code: CONFLICTS_UNAVAILABLE });
  });

  it('Stale snapshot: a request naming a member the snapshot does not hold yet is a skew — unavailable, unlogged, and loading while the snapshot is read again; never drawn as gone', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sources: ConflictsQueueSources = {
      calendar: { snapshot: pilot, refusal: null, loading: false },
      records: answered([]),
      resolutions: answered([]),
      requests: answered([requestOf('req-newer', '2026-09-12', '2026-09-14', { memberId: 'newer-member' })]),
    };

    expect(conflictsQueueOf(sources, nowOn('2026-09-01'))).toEqual({ kind: CONFLICTS_UNAVAILABLE });
    expect(conflictsQueueOf({ ...sources, snapshotFetching: true }, nowOn('2026-09-01'))).toEqual({ kind: CONFLICTS_LOADING });
    expect(unknownSnapshotIdsOf(pilot, [], [], sources.requests.data)).toEqual(['member:newer-member']);
    expect(queueCountOf(pilot, [], [], sources.requests.data ?? [], '2026-09-01')).toBeNull();
    expect(logged).not.toHaveBeenCalled();
  });

  it('states the same count through queueCountOf as the queue does', () => {
    const requests = [requestOf('req-1', '2026-09-12', '2026-09-14')];

    expect(queueCountOf(pilot, [WORKED], [], requests, '2026-09-01')).toBe(mergedOf([WORKED], [], requests, '2026-09-01').count);
    expect(queueCountOf(pilot, [WORKED], [], requests, '2026-09-01')).toBe(4);
  });

  it.each([
    ['a bad range', [{ ...requestOf('req-1', '2026-09-12', '2026-09-14'), during: 'garbage' }]],
    ['two rows of one id', [requestOf('req-1', '2026-09-12', '2026-09-14'), requestOf('req-1', '2026-09-20', '2026-09-22')]],
    ['a pending request with a decision', [requestOf('req-1', '2026-09-12', '2026-09-14', { decisions: [{ outcome: 'approved' }] })]],
    ['a decision without its author', [requestOf('req-1', '2026-09-12', '2026-09-14', { closedAt: DECIDED_AT, decisions: [{ outcome: 'approved' }] })]],
    ['a row that is not a request', [null]],
  ])('refuses the whole queue for %s, and logs it', (_name, requestRows) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(conflictsQueueOutcomeOf(pilot, [WORKED], [], '2026-09-01', requestRows)).toEqual({ ok: false, code: CONFLICTS_UNAVAILABLE });
    expect(logged).toHaveBeenCalledWith(CONFLICTS_UNAVAILABLE, expect.any(RangeError));
  });

  it.each([
    ['failed', { isPending: true, isError: true, fetchStatus: 'idle', data: undefined }],
    ['failed on a refetch over cached rows', { isPending: false, isError: true, fetchStatus: 'idle', data: [] }],
    ['paused offline', { isPending: false, isError: false, fetchStatus: 'paused', data: [] }],
  ] as const)('Read fails: the whole queue is unavailable when the requests read %s, never a partial list', (_name, requests) => {
    expect(
      conflictsQueueOf(
        { calendar: { snapshot: pilot, refusal: null, loading: false }, records: answered([WORKED]), resolutions: answered([]), requests },
        nowOn('2026-09-01'),
      ),
    ).toEqual({ kind: CONFLICTS_UNAVAILABLE });
  });

  it('is loading while the requests read is pending', () => {
    expect(
      conflictsQueueOf(
        {
          calendar: { snapshot: pilot, refusal: null, loading: false },
          records: answered([WORKED]),
          resolutions: answered([]),
          requests: { isPending: true, isError: false, fetchStatus: 'fetching', data: undefined },
        },
        nowOn('2026-09-01'),
      ),
    ).toEqual({ kind: CONFLICTS_LOADING });
  });

  it('merges by date alone, whatever order the requests arrive in', () => {
    const request = (requestId: string, date: string): RequestRow => ({
      kind: ITEM_REQUEST,
      key: `request:${requestId}`,
      requestId,
      memberId: VIEWER_MEMBER,
      date,
      dateShown: date,
      past: date < '2026-09-10',
      memberName: null,
      from: date,
      to: date,
      createdAt: null,
    });
    const merged = mergedQueueOrderOf([], [request('z', '2026-09-12'), request('y', '2026-09-01'), request('x', '2026-09-12'), request('w', '2026-09-05')], '2026-09-10');

    expect(merged.map((row) => row.key)).toEqual(['request:x', 'request:z', 'request:w', 'request:y']);
  });
});
