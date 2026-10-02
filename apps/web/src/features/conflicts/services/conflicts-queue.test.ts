import { collisionKeyOf, collisionsOf, type Collision, type CollisionInput } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_UNAVAILABLE,
  readCalendar,
  type CalendarSnapshot,
  type CalendarSurfaceState,
} from '@/features/calendar/services/snapshot';
import {
  CONFLICTS_LOADING,
  CONFLICTS_READY,
  CONFLICTS_UNAVAILABLE,
  conflictsQueueOf,
  conflictsQueueOutcomeOf,
  queueOrderOf,
  type ConflictsQueueView,
  type LeaveRowsAnswer,
} from '@/features/conflicts/services/conflicts-queue';
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

function viewOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  today: string,
  resolutionRows: readonly unknown[] = [],
): ConflictsQueueView {
  const outcome = conflictsQueueOutcomeOf(snapshot, rows, resolutionRows, today);

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.view;
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
  it('lists 3 conflicts, 10.09 first, under `3 neriješena konflikta`', () => {
    const view = viewOf(pilot, [WORKED], '2026-09-01');

    expect(view.count).toBe(3);
    expect(view.rows.map((row) => row.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-14']);
    expect(view.rows.map((row) => row.shiftTypeName)).toEqual(['Dan', 'Noć', 'Dan']);
    expect(view.rows.map((row) => row.times)).toEqual(['07:00–19:00', '19:00–07:00', '07:00–19:00']);
    expect(view.rows.every((row) => !row.past)).toBe(true);
    expect(t('raspored.count', { count: view.count })).toBe('3 neriješena konflikta');
  });

  it('names the date, the team, the shift type, the member and the causing range on each row', () => {
    const [first] = viewOf(pilot, [WORKED], '2026-09-01').rows;

    expect(first).toEqual({
      key: collisionKeyOf({ memberId: VIEWER_MEMBER, date: '2026-09-10', teamId: teamOf(PILOT, 0) }),
      date: '2026-09-10',
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
      { calendar: { snapshot: pilot, refusal: null, loading: false }, records: answered([WORKED]), resolutions: answered([]) },
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
      { calendar: { snapshot: behind, refusal: null, loading: false }, records: answered([WORKED]), resolutions: answered([]) },
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

  it('shows a working type with no times in effect without them, through `raspored.detail`', async () => {
    const untimed: FixtureRows = {
      ...PILOT,
      types: [...PILOT.types, typeRow('pilot-dezurstvo', 'Dežurstvo', '2026-09-25T20:07:49.339741+00:00')],
    };
    const snapshot = await snapshotOf(untimed, [], {
      overrides: [calendarOverrideRow('untimed', a, '2026-09-12', 'pilot-dezurstvo')],
    });
    const row = viewOf(snapshot, [WORKED], '2026-09-01').rows.find((one) => one.date === '2026-09-12');

    expect(row).toMatchObject({ shiftTypeName: 'Dežurstvo', times: null });
    expect(t('raspored.detail', { type: row!.shiftTypeName, from: row!.leaveFrom, to: row!.leaveTo })).toBe(
      'Dežurstvo · Godišnji odmor 10.09.2026–14.09.2026',
    );
  });
});

describe('none', () => {
  it('shows `0 neriješenih konflikata` with no live leave', () => {
    const view = viewOf(pilot, [], '2026-09-01');

    expect(view).toEqual({ count: 0, rows: [] });
    expect(t('raspored.count', { count: 0 })).toBe('0 neriješenih konflikata');
    expect(t('raspored.empty')).toBe('Nema konflikata između godišnjih odmora i rasporeda.');
  });

  it('lists nothing for leave only over non-working dates', () => {
    // 12.09 and 13.09 are Slobodno.
    expect(viewOf(pilot, [rowOf('record-off', '2026-09-12', '2026-09-14')], '2026-09-01')).toEqual({ count: 0, rows: [] });
  });

  it.each([
    [1, '1 neriješen konflikt'],
    [2, '2 neriješena konflikta'],
    [4, '4 neriješena konflikta'],
    [5, '5 neriješenih konflikata'],
    [11, '11 neriješenih konflikata'],
    [12, '12 neriješenih konflikata'],
    [14, '14 neriješenih konflikata'],
    [21, '21 neriješen konflikt'],
    [22, '22 neriješena konflikta'],
    [23, '23 neriješena konflikta'],
    [24, '24 neriješena konflikta'],
    [25, '25 neriješenih konflikata'],
  ])('says %i in its Croatian form', (count, shown) => {
    expect(t('raspored.count', { count })).toBe(shown);
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

    expect(conflictsQueueOutcomeOf(pilot, rows, [], '2026-09-01')).toEqual({ ok: false, code: CONFLICTS_UNAVAILABLE });
    expect(logged).toHaveBeenCalledWith(CONFLICTS_UNAVAILABLE, expect.any(RangeError));
  });
});

/** A settled records read that answered `rows`. */
function answered(rows: readonly unknown[]): LeaveRowsAnswer {
  return { isPending: false, isError: false, fetchStatus: 'idle', data: rows };
}

describe('the three reads', () => {
  const ready: CalendarSurfaceState = { snapshot: null, refusal: null, loading: false };

  it('is ready once both answered', () => {
    const queue = conflictsQueueOf(
      { calendar: { ...ready, snapshot: pilot }, records: answered([WORKED]), resolutions: answered([]) },
      nowOn('2026-09-01'),
    );

    expect(queue.kind).toBe(CONFLICTS_READY);
  });

  it('is loading while either read is pending', () => {
    const pending: LeaveRowsAnswer = { isPending: true, isError: false, fetchStatus: 'fetching', data: undefined };

    expect(
      conflictsQueueOf({ calendar: { ...ready, loading: true }, records: answered([]), resolutions: answered([]) }, nowOn('2026-09-01')),
    ).toEqual({ kind: CONFLICTS_LOADING });
    expect(
      conflictsQueueOf({ calendar: { ...ready, snapshot: pilot }, records: pending, resolutions: answered([]) }, nowOn('2026-09-01')),
    ).toEqual({ kind: CONFLICTS_LOADING });
    expect(
      conflictsQueueOf({ calendar: { ...ready, snapshot: pilot }, records: answered([WORKED]), resolutions: pending }, nowOn('2026-09-01')),
    ).toEqual({ kind: CONFLICTS_LOADING });
  });

  it.each([
    ['the calendar read failed', { snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false }, answered([])],
    ['the records read failed', { snapshot: null, refusal: null, loading: true }, { isPending: true, isError: true, fetchStatus: 'idle', data: undefined }],
    ['a records refetch failed over cached rows', { snapshot: null, refusal: null, loading: false }, { isPending: false, isError: true, fetchStatus: 'idle', data: [] }],
    ['the records read is paused offline', { snapshot: null, refusal: null, loading: false }, { isPending: false, isError: false, fetchStatus: 'paused', data: [] }],
  ] as const)('is unavailable when %s, ahead of any skeleton', (_name, calendar, records) => {
    const state: CalendarSurfaceState = { ...calendar, snapshot: calendar.refusal === null && !calendar.loading ? pilot : null };

    expect(conflictsQueueOf({ calendar: state, records, resolutions: answered([]) }, nowOn('2026-09-01'))).toEqual({
      kind: CONFLICTS_UNAVAILABLE,
    });
  });

  it('derives the same queue on every read and changes nothing it reads', () => {
    const rows = Object.freeze([Object.freeze({ ...WORKED })]);
    const first = viewOf(pilot, rows, '2026-09-01');

    expect(viewOf(pilot, rows, '2026-09-01')).toEqual(first);
  });
});

/** A resolution row as `conflict_resolutions` answers it. */
function resolutionOf(memberId: string, date: string, teamId: string, kind = 'accept_uncovered'): Row {
  return { member_id: memberId, date, team_id: teamId, kind };
}

describe('resolutions (story 5.4a)', () => {
  const a = teamOf(PILOT, 0);

  it('drops the resolved conflict: 3 collisions, 1 resolved, 2 listed and counted', () => {
    const view = viewOf(pilot, [WORKED], '2026-09-01', [resolutionOf(VIEWER_MEMBER, '2026-09-11', a)]);

    expect(view.count).toBe(2);
    expect(view.rows).toHaveLength(view.count);
    expect(view.rows.map((row) => row.date)).toEqual(['2026-09-10', '2026-09-14']);
    expect(t('raspored.count', { count: view.count })).toBe('2 neriješena konflikta');
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

  it('ignores a resolution that matches no collision, whatever its kind', () => {
    const view = viewOf(pilot, [WORKED], '2026-09-01', [
      resolutionOf(VIEWER_MEMBER, '2026-09-12', a, 'amend_leave'),
      resolutionOf(ANA, '2026-09-10', a, 'replace_member'),
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
  ])('refuses the whole queue for %s, and logs it', (_name, resolutionRows) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(conflictsQueueOutcomeOf(pilot, [WORKED], resolutionRows, '2026-09-01')).toEqual({ ok: false, code: CONFLICTS_UNAVAILABLE });
    expect(logged).toHaveBeenCalledWith(CONFLICTS_UNAVAILABLE, expect.any(RangeError));
  });

  it.each([
    ['failed', { isPending: true, isError: true, fetchStatus: 'idle', data: undefined }],
    ['failed on a refetch over cached rows', { isPending: false, isError: true, fetchStatus: 'idle', data: [] }],
    ['paused offline', { isPending: false, isError: false, fetchStatus: 'paused', data: [] }],
  ] as const)('is unavailable when the resolutions read %s, never a count without them', (_name, resolutions) => {
    expect(
      conflictsQueueOf({ calendar: { snapshot: pilot, refusal: null, loading: false }, records: answered([WORKED]), resolutions }, nowOn('2026-09-01')),
    ).toEqual({ kind: CONFLICTS_UNAVAILABLE });
  });
});
