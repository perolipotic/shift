import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot, type CalendarSurfaceState } from '@/features/calendar/services/snapshot';
import {
  CONFLICTS_READY,
  conflictsQueueOf,
  type ConflictsQueueSources,
  type LeaveRowsAnswer,
} from '@/features/conflicts/services/conflicts-queue';
import {
  ABSENT_ACCEPTED,
  ABSENT_UNRESOLVED,
  ADMIN_TODAY_LOADING,
  ADMIN_TODAY_READY,
  ADMIN_TODAY_UNAVAILABLE,
  ADMIN_WEEK_DAYS,
  BADGE_PAST,
  BADGE_TODAY,
  NEEDS_YOU_ROWS,
  PHASE_ENDED,
  PHASE_RUNNING,
  PHASE_STARTS,
  STAFFING_FULL,
  STAFFING_NOBODY,
  STAFFING_SHORT,
  STATUS_DUTY,
  STATUS_FREE,
  STATUS_LEAVE,
  STATUS_UNSCHEDULED,
  STATUS_WORKING,
  absentLineMessageKey,
  absentTomorrowMessageKey,
  adminStatusMessageKey,
  adminStatusOf,
  adminStatusShiftMessageKey,
  adminTodayOf,
  coverageAbsentMessageKey,
  coveragePhaseMessageKey,
  coveragePhaseOf,
  coverageShiftMessageKey,
  coverageStaffingMessageKey,
  needsYouBadgeMessageKey,
  needsYouShiftMessageKey,
  showsAdminToday,
  weekCellMessageKey,
  weekOf,
  type AdminTodayView,
} from '@/features/today/services/admin-today';
import {
  CASE_DUTY,
  CASE_LEAVE,
  TODAY_LOADING,
  TODAY_READY,
  TODAY_UNAVAILABLE,
  todayViewOf,
  type Today,
} from '@/features/today/services/today';
import { calendarMonthOutcomeOf, type CalendarMonth } from '@/features/calendar/utils/month';
import { initLocalization, t } from '@/lib/i18n';
import { nextIsoDate } from '@/lib/i18n/format';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  assignmentRow,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  statusRow,
  teamRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 6.3's view model, executed (AD-15): every row of the spec's matrix
 * but the member's unchanged screen and the 390 px layout (the e2e spec's),
 * each one built exactly as the hook builds it — from the queue's three
 * reads — and the count compared against `conflictsQueueOf` itself.
 *
 * The pilot: teams A–D work `Dan, Noć, Slobodno, Slobodno`, each a step
 * ahead of the one before. On Thursday 2026-10-01: A works Noć, D works Dan,
 * B and C are off; on Wednesday 2026-09-30 B works Noć.
 */

const A = 'pilot-smjena-a';
const B = 'pilot-smjena-b';
const D = 'pilot-smjena-d';
const ANA = '00000000-0000-4000-8000-0000000000c1';
const BRUNO = '00000000-0000-4000-8000-0000000000c2';
const CVITA = '00000000-0000-4000-8000-0000000000c3';
const DORA = '00000000-0000-4000-8000-0000000000c4';
const EMA = '00000000-0000-4000-8000-0000000000c5';
const FRAN = '00000000-0000-4000-8000-0000000000c6';
const TODAY = '2026-10-01';

type Row = Record<string, unknown>;

/** `time` on `date` in Zagreb (CEST, UTC+2). */
function zagreb(date: string, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);

  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), (hours ?? 0) - 2, minutes ?? 0));
}

/** 14:20 on the organization's wall clock, the mockup's minute. */
const AT_1420 = zagreb(TODAY, '14:20');

/** The members besides the admin viewer, and their teams. */
const PEOPLE: readonly (readonly [string, string, string])[] = [
  [ANA, 'Ana Anić', A],
  [CVITA, 'Cvita Cvitić', A],
  [DORA, 'Dora Dorić', A],
  [EMA, 'Ema Emić', A],
  [BRUNO, 'Bruno Brnić', B],
  [FRAN, 'Fran Franić', B],
];

/**
 * The admin viewer — on `viewerTeam`, or on none — and {@link PEOPLE}, each
 * since the fixture's seeding, over `rows`; `rosterOverrides` as read.
 */
async function snapshotOf(
  {
    rows = PILOT,
    viewerTeam = null as string | null,
    rosterOverrides = [] as readonly Row[],
    statuses = [] as readonly Row[],
    people = PEOPLE,
  } = {},
): Promise<CalendarSnapshot> {
  const own = viewerTeam === null ? [] : [membershipRow(viewerTeam, SEEDED)];
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow(own, { role: 'admin' })],
          versions: [
            ...(viewerTeam === null ? [] : [memberMembershipRow(VIEWER_MEMBER, viewerTeam, SEEDED)]),
            ...people.map(([id, , team]) => memberMembershipRow(id, team, SEEDED)),
          ],
          statuses,
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      ...people.map(([id, name]) => calendarMemberRow(id, name)),
    ]),
    overridesAnswerOf([]),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A row as `leave_records` answers it: both days included. */
function leaveOf(id: string, memberId: string, from: string, to: string): Row {
  return { id, member_id: memberId, during: `[${from},${nextIsoDate(to) ?? to})` };
}

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

/** A settled read that answered `rows`. */
function answered(rows: readonly unknown[]): LeaveRowsAnswer {
  return { isPending: false, isError: false, fetchStatus: 'idle', data: rows };
}

function sourcesOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  resolutionRows: readonly unknown[] = [],
): ConflictsQueueSources {
  const calendar: CalendarSurfaceState = { snapshot, refusal: null, loading: false };

  return { calendar, records: answered(rows), resolutions: answered(resolutionRows) };
}

/** The ready view, as the hook builds it. */
function viewOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  resolutionRows: readonly unknown[] = [],
  now: Date = AT_1420,
): AdminTodayView {
  const shown = adminTodayOf(sourcesOf(snapshot, rows, resolutionRows), now);

  if (shown.kind !== ADMIN_TODAY_READY) throw new Error(shown.kind);

  return shown.view;
}

/** What *Raspored* counts for the same reads at the same minute. */
function queueCountOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  resolutionRows: readonly unknown[] = [],
  now: Date = AT_1420,
): number {
  const queue = conflictsQueueOf(sourcesOf(snapshot, rows, resolutionRows), now);

  if (queue.kind !== CONFLICTS_READY) throw new Error(queue.kind);

  return queue.view.count;
}

/**
 * SEVEN, ONE PAST: Bruno (B) off on 30.09., B's Noć — yesterday; Ana (A)
 * from 01.10. to 10.10., over A's Noć 01.10., Dan 04.10., Noć 05.10., Dan
 * 08.10. and Noć 09.10.; Cvita (A) on 01.10., A's Noć.
 */
const SEVEN = [
  leaveOf('leave-bruno', BRUNO, '2026-09-30', '2026-09-30'),
  leaveOf('leave-ana', ANA, '2026-10-01', '2026-10-10'),
  leaveOf('leave-cvita', CVITA, '2026-10-01', '2026-10-01'),
];

let pilot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Treba tebe', () => {
  it('Zero: the count shows at 0, neutral, with no row and nothing past', () => {
    const { needsYou } = viewOf(pilot, []);

    expect(needsYou).toEqual({ count: 0, pastCount: 0, earliestPast: null, rows: [] });
    expect(t('raspored.count', { count: needsYou.count })).toBe('0 neriješenih konflikata');
    expect(t('danas.admin.needsYou.open', { count: needsYou.count })).toBe('Otvori konflikte (0)');
    expect(needsYou.count).toBe(queueCountOf(pilot, []));
  });

  it('Seven, one past: the count, the past share with its date, and the earliest three, the past one first', () => {
    const { needsYou } = viewOf(pilot, SEVEN);

    expect(needsYou.count).toBe(7);
    expect(needsYou.count).toBe(queueCountOf(pilot, SEVEN));
    expect(needsYou.pastCount).toBe(1);
    expect(needsYou.earliestPast).toBe('30.09.');
    expect(t('danas.admin.needsYou.pastLine', { count: needsYou.pastCount, date: needsYou.earliestPast })).toBe(
      '1 na datum koji je prošao · najraniji 30.09.',
    );
    expect(needsYou.rows).toHaveLength(NEEDS_YOU_ROWS);
    expect(needsYou.rows.map((row) => [row.date, row.memberName, row.badge])).toEqual([
      ['2026-09-30', 'Bruno Brnić', BADGE_PAST],
      ['2026-10-01', 'Ana Anić', BADGE_TODAY],
      ['2026-10-01', 'Cvita Cvitić', BADGE_TODAY],
    ]);
    expect(needsYou.rows[0]).toMatchObject({
      memberId: BRUNO,
      teamId: B,
      weekday: 'srijeda',
      dayMonth: '30.09.',
      shiftTypeName: 'Noć',
      times: '19:00–07:00',
      teamName: 'Smjena B',
    });
    expect(t('raspored.count', { count: 7 })).toBe('7 neriješenih konflikata');
  });

  it('lists a later date with no badge once the past and today are fewer than three', () => {
    const rows = [leaveOf('leave-ana', ANA, '2026-10-04', '2026-10-05')];
    const { needsYou } = viewOf(pilot, rows);

    expect(needsYou.rows.map((row) => [row.date, row.badge])).toEqual([
      ['2026-10-04', null],
      ['2026-10-05', null],
    ]);
  });

  it('Equality: one decision saved takes the count to 6 on both, and nothing else does', () => {
    const resolved = [resolutionOf(ANA, '2026-10-04', A)];

    expect(viewOf(pilot, SEVEN).needsYou.count).toBe(7);
    expect(viewOf(pilot, SEVEN, resolved).needsYou.count).toBe(6);
    expect(queueCountOf(pilot, SEVEN, resolved)).toBe(6);
  });

  it('says each count in all three Croatian forms', () => {
    expect(t('danas.admin.needsYou.pastLine', { count: 2, date: '30.09.' })).toBe(
      '2 na datume koji su prošli · najraniji 30.09.',
    );
    expect(t('danas.admin.needsYou.pastLine', { count: 21, date: '30.09.' })).toBe(
      '21 na datum koji je prošao · najraniji 30.09.',
    );
    expect(t('raspored.count', { count: 22 })).toBe('22 neriješena konflikta');
  });
});

describe('Pokrivenost danas', () => {
  it('lists the working teams in team order and names the teams off', () => {
    const { coverage } = viewOf(pilot, []);

    expect(coverage.rows.map((row) => [row.teamName, row.shiftTypeName, row.range])).toEqual([
      ['Smjena A', 'Noć', '19:00–07:00'],
      ['Smjena D', 'Dan', '07:00–19:00'],
    ]);
    expect(coverage.rows.map((row) => row.teamId)).toEqual([A, D]);
    expect(coverage.off).toEqual(['Smjena B', 'Smjena C']);
    expect(t('danas.admin.coverage.off', { teams: coverage.off.join(t('danas.admin.listSeparator')) })).toBe(
      'Slobodno: Smjena B, Smjena C',
    );
  });

  it('Phase: Dan 07–19 and Noć 19–07 at 14:20', () => {
    const [noc, dan] = viewOf(pilot, []).coverage.rows;

    expect(dan?.phase).toEqual({ kind: PHASE_RUNNING, time: '19:00' });
    expect(noc?.phase).toEqual({ kind: PHASE_STARTS, time: '19:00' });
    expect(t(coveragePhaseMessageKey(PHASE_RUNNING), { time: '19:00' })).toBe('u tijeku, do 19:00');
    expect(t(coveragePhaseMessageKey(PHASE_STARTS), { time: '19:00' })).toBe('počinje u 19:00');
  });

  it('re-derives the phase at another minute: at 20:00 the Dan is over and the Noć under way', () => {
    const [noc, dan] = viewOf(pilot, [], [], zagreb(TODAY, '20:00')).coverage.rows;

    expect(dan?.phase).toEqual({ kind: PHASE_ENDED, time: '19:00' });
    expect(noc?.phase).toEqual({ kind: PHASE_RUNNING, time: '07:00' });
    expect(t(coveragePhaseMessageKey(PHASE_ENDED), { time: '19:00' })).toBe('završeno u 19:00');
  });

  it.each([
    [7 * 60, 19 * 60, 0, PHASE_STARTS, '07:00'],
    [7 * 60, 19 * 60, 7 * 60, PHASE_RUNNING, '19:00'],
    [7 * 60, 19 * 60, 19 * 60, PHASE_ENDED, '19:00'],
    [19 * 60, 7 * 60, 23 * 60 + 59, PHASE_RUNNING, '07:00'],
    [8 * 60, 8 * 60, 9 * 60, PHASE_RUNNING, '08:00'],
  ] as const)('a %i–%i shift at minute %i is %s, %s', (start, end, minute, kind, time) => {
    expect(coveragePhaseOf(start, end, minute)).toEqual({ kind, time });
  });

  it('a full shift: 4 od 4 člana, ✓ puna smjena', () => {
    const [noc] = viewOf(pilot, []).coverage.rows;

    expect(noc).toMatchObject({ present: 4, total: 4, absent: [], staffing: STAFFING_FULL });
    expect(t(coverageStaffingMessageKey(STAFFING_FULL))).toBe('✓ puna smjena');
    expect(t('danas.admin.coverage.members', { present: 4, total: 4 })).toBe('4 od 4 člana');
  });

  it('an empty roster is never full: nobody rostered, in its own words', () => {
    // Team D works Dan today, and nobody is on it.
    const [, dan] = viewOf(pilot, []).coverage.rows;

    expect(dan).toMatchObject({ teamId: D, present: 0, total: 0, absent: [], staffing: STAFFING_NOBODY });
    expect(t(coverageStaffingMessageKey(STAFFING_NOBODY))).toBe('Nitko nije raspoređen');
  });

  it('names every active team: a team with no rotation today is neither working nor off', async () => {
    const snapshot = await snapshotOf({
      rows: { ...PILOT, teams: [...PILOT.teams, teamRow('pilot-smjena-e', 'Smjena E')] },
    });
    const { coverage, week } = viewOf(snapshot, []);

    expect(coverage.rows.map((row) => row.teamName)).toEqual(['Smjena A', 'Smjena D']);
    expect(coverage.off).toEqual(['Smjena B', 'Smjena C']);
    expect(coverage.noRotation).toEqual(['Smjena E']);
    expect(t('danas.admin.coverage.noRotation', { teams: coverage.noRotation.join(t('danas.admin.listSeparator')) })).toBe(
      'Bez rotacije: Smjena E',
    );
    expect([...coverage.rows.map((row) => row.teamName), ...coverage.off, ...coverage.noRotation].sort()).toEqual(
      week.rows.map((row) => row.teamName).sort(),
    );
  });

  it('Short team: A on Noć with a member on leave, unresolved — 3 od 4 člana and why', () => {
    const rows = [leaveOf('leave-ana', ANA, TODAY, TODAY)];
    const [noc] = viewOf(pilot, rows).coverage.rows;

    expect(noc).toMatchObject({ present: 3, total: 4, staffing: STAFFING_SHORT });
    expect(noc?.absent).toEqual([{ memberId: ANA, name: 'Ana Anić', state: ABSENT_UNRESOLVED }]);
    expect(t('danas.admin.coverage.members', { present: noc?.present, total: noc?.total })).toBe('3 od 4 člana');
    expect(t(coverageAbsentMessageKey(ABSENT_UNRESOLVED), { name: 'Ana Anić' })).toBe(
      'Ana Anić je na godišnjem · konflikt nije riješen',
    );
  });

  it('accepted as uncovered: still 3 od 4, and said so', () => {
    const rows = [leaveOf('leave-ana', ANA, TODAY, TODAY)];
    const [noc] = viewOf(pilot, rows, [resolutionOf(ANA, TODAY, A)]).coverage.rows;

    expect(noc).toMatchObject({ present: 3, total: 4 });
    expect(noc?.absent).toEqual([{ memberId: ANA, name: 'Ana Anić', state: ABSENT_ACCEPTED }]);
    expect(t(coverageAbsentMessageKey(ABSENT_ACCEPTED), { name: 'Ana Anić' })).toBe(
      'Ana Anić je na godišnjem · prihvaćeno bez zamjene',
    );
  });

  it('Replaced: the same, resolved by a replacement — 4 od 4, ✓ puna smjena', async () => {
    const snapshot = await snapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('ro-fran', A, TODAY, null, FRAN)],
    });
    const rows = [leaveOf('leave-ana', ANA, TODAY, TODAY)];
    const [noc] = viewOf(snapshot, rows, [resolutionOf(ANA, TODAY, A, 'replace_member', 'ro-fran')]).coverage.rows;

    expect(noc).toMatchObject({ present: 4, total: 4, absent: [], staffing: STAFFING_FULL });
    expect(viewOf(snapshot, rows, [resolutionOf(ANA, TODAY, A, 'replace_member', 'ro-fran')]).needsYou.count).toBe(0);
  });

  it('says a timed and an untimed row', () => {
    expect(t(coverageShiftMessageKey({ range: '19:00–07:00' }), { type: 'Noć', range: '19:00–07:00', team: 'Smjena A' })).toBe(
      'Noć 19:00–07:00 · Smjena A',
    );
    expect(t(coverageShiftMessageKey({ range: null }), { type: 'Noć', team: 'Smjena A' })).toBe('Noć · Smjena A');
  });
});

describe('Odsutni danas', () => {
  it('names nobody on a day nobody is on leave', () => {
    const { absences } = viewOf(pilot, []);

    expect(absences).toEqual({ today: [], tomorrow: [] });
    expect(t('danas.admin.absent.none')).toBe('Danas nitko nije na godišnjem odmoru.');
  });

  it('names who is on leave with their team and the whole absence, then who starts tomorrow', () => {
    const rows = [
      leaveOf('leave-ana-1', ANA, '2026-09-28', '2026-09-30'),
      leaveOf('leave-ana-2', ANA, '2026-10-01', '2026-10-04'),
      leaveOf('leave-dora', DORA, '2026-10-02', '2026-10-09'),
      leaveOf('leave-ema', EMA, '2026-10-05', '2026-10-06'),
    ];
    const { absences } = viewOf(pilot, rows);

    expect(absences.today).toEqual([
      { memberId: ANA, name: 'Ana Anić', teamName: 'Smjena A', from: '28.09.', to: '04.10.', oneDay: false },
    ]);
    expect(absences.tomorrow).toEqual([
      { memberId: DORA, name: 'Dora Dorić', teamName: 'Smjena A', from: '02.10.', to: '09.10.', oneDay: false },
    ]);
    const [ana] = absences.today;
    const [dora] = absences.tomorrow;

    expect(t(absentLineMessageKey({ teamName: 'Smjena A', oneDay: false }), { team: ana?.teamName, from: ana?.from, to: ana?.to })).toBe(
      'Smjena A · godišnji 28.09.–04.10.',
    );
    expect(
      t(absentTomorrowMessageKey({ teamName: 'Smjena A', oneDay: false }), {
        name: dora?.name,
        team: dora?.teamName,
        from: dora?.from,
        to: dora?.to,
      }),
    ).toBe('Od sutra: Dora Dorić (Smjena A), 02.10.–09.10.');
  });

  it('states a one-day absence as its one date, never 01.10.–01.10.', () => {
    const rows = [leaveOf('leave-ana', ANA, TODAY, TODAY), leaveOf('leave-dora', DORA, '2026-10-02', '2026-10-02')];
    const { absences } = viewOf(pilot, rows);
    const [ana] = absences.today;
    const [dora] = absences.tomorrow;

    if (ana === undefined || dora === undefined) throw new Error('nobody absent');

    expect(ana.oneDay).toBe(true);
    expect(dora.oneDay).toBe(true);
    expect(t(absentLineMessageKey(ana), { team: ana.teamName, from: ana.from, to: ana.to, date: ana.from })).toBe(
      'Smjena A · godišnji 01.10.',
    );
    expect(
      t(absentTomorrowMessageKey(dora), { name: dora.name, team: dora.teamName, from: dora.from, to: dora.to, date: dora.from }),
    ).toBe('Od sutra: Dora Dorić (Smjena A), 02.10.');
    expect(t(absentLineMessageKey({ teamName: null, oneDay: true }), { date: '01.10.' })).toBe('godišnji 01.10.');
    expect(t(absentTomorrowMessageKey({ teamName: null, oneDay: true }), { name: 'Ana Anić', date: '02.10.' })).toBe(
      'Od sutra: Ana Anić, 02.10.',
    );
  });

  it('leaves out a member inactive today', async () => {
    const snapshot = await snapshotOf({ statuses: [statusRow(ANA, false, '2026-09-01')] });
    const { absences } = viewOf(snapshot, [leaveOf('leave-ana', ANA, '2026-09-20', '2026-10-04')]);

    expect(absences.today).toEqual([]);
  });

  it('says a member on no team without one', () => {
    expect(t(absentLineMessageKey({ teamName: null, oneDay: false }), { from: '28.09.', to: '04.10.' })).toBe('godišnji 28.09.–04.10.');
    expect(t(absentTomorrowMessageKey({ teamName: null, oneDay: false }), { name: 'Ana Anić', from: '02.10.', to: '04.10.' })).toBe(
      'Od sutra: Ana Anić, 02.10.–04.10.',
    );
  });
});

describe('Ovaj tjedan', () => {
  it('shows every active team across today and the six days after it, ⚠ exactly where the queue lists one', () => {
    const { week, needsYou } = viewOf(pilot, SEVEN);

    expect(week.days).toHaveLength(ADMIN_WEEK_DAYS);
    expect(week.days.map((day) => day.date)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ]);
    expect(week.days[0]?.isToday).toBe(true);
    expect(week.rows.map((row) => row.teamName)).toEqual(['Smjena A', 'Smjena B', 'Smjena C', 'Smjena D']);
    const [a] = week.rows;

    expect(a?.cells.map((cell) => cell.letter)).toEqual(['N', 'S', 'S', 'D', 'N', 'S', 'S']);
    expect(a?.cells.map((cell) => cell.conflict)).toEqual([true, false, false, true, true, false, false]);
    // Every ⚠ in the week is a queue row on that team and date, and every
    // queue row within the week is a ⚠.
    const marked = week.rows.flatMap((row) => row.cells.filter((cell) => cell.conflict).map((cell) => `${row.teamId}|${cell.date}`));
    const queue = conflictsQueueOf(sourcesOf(pilot, SEVEN), AT_1420);

    if (queue.kind !== CONFLICTS_READY) throw new Error(queue.kind);

    const inWeek = new Set(week.days.map((day) => day.date));
    const listed = queue.view.rows.filter((row) => inWeek.has(row.date)).map((row) => `${row.teamId}|${row.date}`);

    expect(marked.length).toBeGreaterThan(0);
    expect(new Set(marked)).toEqual(new Set(listed));
    expect(needsYou.count).toBe(7);
    expect(week.legend).toEqual([
      { letter: 'N', name: 'Noć' },
      { letter: 'S', name: 'Slobodno' },
      { letter: 'D', name: 'Dan' },
    ]);
    expect(week.anyConflict).toBe(true);
  });

  it('names a cell in words: the day, the team, the type and range, and the conflict', () => {
    const { week } = viewOf(pilot, SEVEN);
    const [a] = week.rows;
    const cell = a?.cells[0];
    const day = week.days[0];

    if (cell === undefined || day === undefined) throw new Error('no cell');

    expect(
      t(weekCellMessageKey(cell), {
        weekday: day.weekday,
        date: day.dayMonth,
        team: a?.teamName,
        type: cell.name,
        range: cell.range,
      }),
    ).toBe('četvrtak 01.10., Smjena A, Noć 19:00–07:00, neriješen konflikt');
    expect(weekCellMessageKey({ range: null, conflict: false })).toBe('danas.admin.week.cell');
    expect(weekCellMessageKey({ range: '07:00–19:00', conflict: false })).toBe('danas.admin.week.cellTimed');
    expect(weekCellMessageKey({ range: null, conflict: true })).toBe('danas.admin.week.cellConflict');
  });

  it('heads each column with the short weekday, never a cut of the long one', () => {
    const { week } = viewOf(pilot, []);

    expect(week.days.map((day) => day.weekdayShort)).toEqual(['čet', 'pet', 'sub', 'ned', 'pon', 'uto', 'sri']);
  });

  it('a team that leaves mid-week across a month boundary is an empty cell after it, named as no rotation', () => {
    const today = '2026-09-28';
    const dates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
    const months = new Map<string, CalendarMonth>();

    for (const month of ['2026-09', '2026-10']) {
      const outcome = calendarMonthOutcomeOf(pilot, { mjesec: month }, today);

      if (!outcome.ok) throw new Error(outcome.code);

      // October no longer draws team D: its cells are gone from that month.
      months.set(
        month,
        month === '2026-09'
          ? outcome.month
          : {
              ...outcome.month,
              columns: outcome.month.columns.filter((column) => column.id !== D),
              rows: outcome.month.rows.map((row) => ({ ...row, cells: row.cells.filter((cell) => cell.teamId !== D) })),
            },
      );
    }

    const week = weekOf(dates, months, today);
    const d = week.rows.find((row) => row.teamId === D);

    expect(d?.cells.slice(0, 3).every((cell) => cell.letter !== null)).toBe(true);
    expect(d?.cells.slice(3).map((cell) => [cell.letter, cell.name, cell.conflict])).toEqual([
      [null, null, false],
      [null, null, false],
      [null, null, false],
      [null, null, false],
    ]);
    const cell = d?.cells[3];
    const day = week.days[3];

    if (cell === undefined || day === undefined) throw new Error('no cell');

    expect(
      t(weekCellMessageKey(cell), { weekday: day.weekday, date: day.dayMonth, team: 'Smjena D', type: t('kalendar.noRotation') }),
    ).toBe('četvrtak 01.10., Smjena D, Bez rotacije');
  });

  it('crosses a month: from 28.09. it draws September and October', () => {
    const { week } = viewOf(pilot, [], [], zagreb('2026-09-28', '14:20'));

    expect(week.days.map((day) => day.dayMonth)).toEqual(['28.09.', '29.09.', '30.09.', '01.10.', '02.10.', '03.10.', '04.10.']);
    expect(week.rows[0]?.cells.map((cell) => cell.letter)).toEqual(['S', 'S', 'D', 'N', 'S', 'S', 'D']);
  });

  it('Many teams: six teams, six week rows and a coverage row per working team', async () => {
    const six: FixtureRows = {
      ...PILOT,
      teams: ['a', 'b', 'c', 'd', 'e', 'f'].map((letter) => teamRow(`pilot-smjena-${letter}`, `Smjena ${letter.toUpperCase()}`)),
      assignments: ['a', 'b', 'c', 'd', 'e', 'f'].map((letter, offset) =>
        assignmentRow(`pilot-smjena-${letter}`, 'pilot-rotation', `pilot-step-${String(offset % 4)}`, SEEDED, SEEDED),
      ),
    };
    const snapshot = await snapshotOf({ rows: six });
    const { week, coverage } = viewOf(snapshot, []);

    expect(week.rows).toHaveLength(6);
    expect(coverage.rows.map((row) => row.teamName)).toEqual(['Smjena A', 'Smjena D', 'Smjena E']);
    expect(coverage.off).toEqual(['Smjena B', 'Smjena C', 'Smjena F']);
    expect(coverage.noRotation).toEqual([]);
  });
});

describe('the three reads', () => {
  it('is loading while a read is pending: the skeleton, never a figure', () => {
    const pending: LeaveRowsAnswer = { isPending: true, isError: false, fetchStatus: 'fetching', data: undefined };

    expect(adminTodayOf({ ...sourcesOf(pilot, []), records: pending }, AT_1420)).toEqual({ kind: ADMIN_TODAY_LOADING });
    expect(
      adminTodayOf({ ...sourcesOf(pilot, []), calendar: { snapshot: null, refusal: null, loading: true } }, AT_1420),
    ).toEqual({ kind: ADMIN_TODAY_LOADING });
  });

  it('Read fails: a failed leave read is unavailable, with no partial figure', () => {
    const failed: LeaveRowsAnswer = { isPending: false, isError: true, fetchStatus: 'idle', data: [] };

    expect(adminTodayOf({ ...sourcesOf(pilot, []), records: failed }, AT_1420)).toEqual({
      kind: ADMIN_TODAY_UNAVAILABLE,
    });
    expect(adminTodayOf({ ...sourcesOf(pilot, []), resolutions: failed }, AT_1420)).toEqual({
      kind: ADMIN_TODAY_UNAVAILABLE,
    });
  });

  it('a leave row that cannot be trusted is unavailable, and logged', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(adminTodayOf(sourcesOf(pilot, [{ id: 'x', member_id: 'nobody', during: '[2026-10-01,2026-10-02)' }]), AT_1420)).toEqual({
      kind: ADMIN_TODAY_UNAVAILABLE,
    });
    expect(logged).toHaveBeenCalled();
  });

  it('derives the same screen on every read and changes nothing it reads', () => {
    const rows = Object.freeze(SEVEN.map((row) => Object.freeze({ ...row })));

    expect(viewOf(pilot, rows)).toEqual(viewOf(pilot, rows));
  });
});

describe('the subtitle', () => {
  it('Admin off-team: no membership is the unscheduled sentence', () => {
    const today = todayViewOf(pilot, [], AT_1420);

    expect(adminStatusOf(today)).toEqual({ kind: STATUS_UNSCHEDULED });
    expect(t(adminStatusMessageKey(STATUS_UNSCHEDULED))).toBe('Nisi raspoređen ni u jednu smjenu.');
  });

  it('Admin working: on A, Noć today — once per shift, with its range', async () => {
    const snapshot = await snapshotOf({ viewerTeam: A });
    const status = adminStatusOf(todayViewOf(snapshot, [], AT_1420));

    expect(status).toEqual({ kind: STATUS_WORKING, shifts: [{ name: 'Noć', range: '19:00–07:00' }] });

    if (status?.kind !== STATUS_WORKING) throw new Error('not working');

    const [shift] = status.shifts;

    if (shift === undefined) throw new Error('no shift');

    expect(t(adminStatusShiftMessageKey(shift), { type: shift.name, range: shift.range })).toBe('Danas radiš Noć 19:00–07:00');
    expect(t('danas.admin.subtitle', { weekday: 'četvrtak', date: '01.10.2026', status: 'Danas radiš Noć 19:00–07:00' })).toBe(
      'četvrtak, 01.10.2026 · Danas radiš Noć 19:00–07:00',
    );
  });

  it('a lone Noć from yesterday still running: Danas radiš Noć 19:00–07:00, and coverage unchanged', async () => {
    const snapshot = await snapshotOf({ viewerTeam: A });
    const at = zagreb('2026-10-02', '03:00');
    const status = adminStatusOf(todayViewOf(snapshot, [], at));

    expect(status).toEqual({ kind: STATUS_WORKING, shifts: [{ name: 'Noć', range: '19:00–07:00' }] });

    if (status?.kind !== STATUS_WORKING) throw new Error('not working');

    const [shift] = status.shifts;

    if (shift === undefined) throw new Error('no shift');

    expect(t(adminStatusShiftMessageKey(shift), { type: shift.name, range: shift.range })).toBe('Danas radiš Noć 19:00–07:00');

    // Coverage is today's teams alone, as for an admin on no team: A's Noć of 01.10. is not in it.
    const { coverage } = viewOf(snapshot, [], [], at);

    expect(coverage).toEqual(viewOf(pilot, [], [], at).coverage);
    expect(coverage.rows.map((row) => row.teamId)).not.toContain(A);
  });

  it('on a 24 h duty: until the duty’s own end, from the real case', async () => {
    // Her own D works Dan today; a roster override puts her on A's Noć too.
    const snapshot = await snapshotOf({
      viewerTeam: D,
      rosterOverrides: [calendarRosterOverrideRow('ro-duty', A, TODAY, null, VIEWER_MEMBER)],
    });
    const today = todayViewOf(snapshot, [], AT_1420);

    if (today.kind !== TODAY_READY || today.view.todayCase.kind !== CASE_DUTY) throw new Error('not a duty');

    expect(today.view.todayCase.duty.end.time).toBe('07:00');
    expect(adminStatusOf(today)).toEqual({ kind: STATUS_DUTY, until: today.view.todayCase.duty.end.time });
  });

  it('on leave today: the leave status, from the real case', async () => {
    const snapshot = await snapshotOf({ viewerTeam: A });
    const today = todayViewOf(snapshot, [leaveOf('leave-own', VIEWER_MEMBER, TODAY, TODAY)], AT_1420);

    if (today.kind !== TODAY_READY) throw new Error(today.kind);

    expect(today.view.todayCase.kind).toBe(CASE_LEAVE);
    expect(adminStatusOf(today)).toEqual({ kind: STATUS_LEAVE });
  });

  it('a free day, leave and a duty each say themselves', async () => {
    const snapshot = await snapshotOf({ viewerTeam: B });

    expect(adminStatusOf(todayViewOf(snapshot, [], AT_1420))).toEqual({ kind: STATUS_FREE });
    expect(t(adminStatusMessageKey(STATUS_FREE))).toBe('Danas ne radiš');
    expect(t(adminStatusMessageKey(STATUS_LEAVE))).toBe('Danas si na godišnjem odmoru');
    expect(t(adminStatusMessageKey(STATUS_DUTY), { time: '07:00' })).toBe('Na dužnosti do 07:00');
    expect(adminStatusShiftMessageKey({ name: 'Noć', range: null })).toBe('danas.admin.status.workingUntimed');
  });

  it('states nothing while the case is loading or unavailable', () => {
    expect(adminStatusOf({ kind: TODAY_LOADING } as Today)).toBeNull();
    expect(adminStatusOf({ kind: TODAY_UNAVAILABLE, retryable: true })).toBeNull();
    expect(todayViewOf(pilot, [], AT_1420).kind).not.toBe(TODAY_READY);
  });

  it('picks the admin body for an admin only, and the member skeleton while no role is known', () => {
    expect(showsAdminToday('admin')).toBe(true);
    expect(showsAdminToday('member_role')).toBe(false);
    expect(showsAdminToday(null)).toBe(false);
  });
});

describe('the words', () => {
  it('says each badge and a row’s shift', () => {
    expect(t(needsYouBadgeMessageKey(BADGE_PAST))).toBe('prošlo');
    expect(t(needsYouBadgeMessageKey(BADGE_TODAY))).toBe('danas');
    expect(t(needsYouShiftMessageKey({ times: '07:00–19:00' }), { type: 'Dan', times: '07:00–19:00', team: 'Smjena C' })).toBe(
      'Dan 07:00–19:00 · Smjena C',
    );
    expect(t(needsYouShiftMessageKey({ times: null }), { type: 'Dan', team: 'Smjena C' })).toBe('Dan · Smjena C');
  });
});
