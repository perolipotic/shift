import { peopleAtWorkOn } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  calendarSurfaceStateOf,
  readCalendar,
  type CalendarSnapshot,
  type CalendarSurfaceState,
} from '@/features/calendar/services/snapshot';
import {
  FRESHNESS_OFFLINE,
  snapshotAnswerOf,
  snapshotFreshnessOf,
  type FreshnessClock,
  type ReadAnswer,
} from '@/lib/offline/freshness';
import {
  CONFLICTS_READY,
  ITEM_COLLISION,
  ITEM_REQUEST,
  ITEM_SWAP,
  collisionRowsOf,
  conflictsQueueOf,
  type ConflictsQueueSources,
  type LeaveRowsAnswer,
} from '@/features/conflicts/services/conflicts-queue';
import { swapRowOf } from '@/features/swaps/organization-swaps.fixture';
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
  SHORT_STAFFED_TODAY_ROWS,
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
  shortStaffedCardOf,
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
import { DAY_NO_ROTATION, DAY_OFF, dayDetailOf } from '@/features/calendar/utils/day-detail';
import { MODIFIER_SHORT_STAFFED } from '@/features/calendar/utils/modifiers';
import { NO_MARKS, calendarMonthOutcomeOf, calendarOpenDayOf, type CalendarMonth } from '@/features/calendar/utils/month';
import { atWorkText } from '@/features/staffing/components/short-staffed-block';
import { staffingInputOf } from '@/features/staffing/services/short-staffed';
import {
  STAFFING_FIXTURES,
  firstWorkingDayOf,
  leaveRow,
  member,
  staffingSnapshotOf,
  type StaffingFixture,
} from '@/features/staffing/staffing.fixture';
import { datesFrom } from '@/utils/dates';
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
    minimum = undefined as unknown,
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
          minimumMembers: minimum,
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
  requestRows: readonly unknown[] = [],
  swapRows: readonly unknown[] = [],
): ConflictsQueueSources {
  const calendar: CalendarSurfaceState = { snapshot, refusal: null, loading: false };

  return {
    calendar,
    records: answered(rows),
    resolutions: answered(resolutionRows),
    requests: answered(requestRows),
    swaps: answered(swapRows),
  };
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

/** What *Za odluku* counts for the same reads at the same minute. */
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
    expect(t('zaOdluku.count', { count: needsYou.count })).toBe('0 čeka odluku');
    expect(t('danas.admin.needsYou.open', { count: needsYou.count })).toBe('Otvori Za odluku (0)');
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
    expect(needsYou.rows.map((row) => [row.date, row.kind === ITEM_SWAP ? null : row.memberName, row.badge])).toEqual([
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
    expect(t('zaOdluku.count', { count: 7 })).toBe('7 čeka odluku');
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

  describe('pending leave requests (story 9.5)', () => {
    /** A pending request row as `leave_requests` answers it: both days included. */
    const requestOf = (id: string, memberId: string, from: string, to: string): Row => ({
      id,
      member_id: memberId,
      during: `[${from},${nextIsoDate(to) ?? to})`,
      closed_at: null,
      leave_request_decisions: [],
    });
    const shownOf = (rows: readonly unknown[], requestRows: readonly unknown[]) => {
      const shown = adminTodayOf(sourcesOf(pilot, rows, [], requestRows), AT_1420);

      if (shown.kind !== ADMIN_TODAY_READY) throw new Error(shown.kind);

      return shown.view.needsYou;
    };

    it('Mixed: counts requests with the collisions, the same count as the queue, and lists them by date', () => {
      const requests = [requestOf('req-past', ANA, '2026-09-28', '2026-09-29'), requestOf('req-later', BRUNO, '2026-10-20', '2026-10-21')];
      const needsYou = shownOf(SEVEN, requests);
      const queue = conflictsQueueOf(sourcesOf(pilot, SEVEN, [], requests), AT_1420);

      if (queue.kind !== CONFLICTS_READY) throw new Error(queue.kind);

      expect(needsYou.count).toBe(9);
      expect(needsYou.count).toBe(queue.view.count);
      // The past share and its earliest date count both kinds.
      expect([needsYou.pastCount, needsYou.earliestPast]).toEqual([2, '28.09.']);
      expect(needsYou.rows.map((row) => [row.kind, row.date, row.badge])).toEqual([
        [ITEM_REQUEST, '2026-09-28', BADGE_PAST],
        [ITEM_COLLISION, '2026-09-30', BADGE_PAST],
        [ITEM_COLLISION, '2026-10-01', BADGE_TODAY],
      ]);
      expect(needsYou.rows[0]).toEqual({
        kind: ITEM_REQUEST,
        key: 'request:req-past',
        requestId: 'req-past',
        date: '2026-09-28',
        weekday: 'ponedjeljak',
        dayMonth: '28.09.',
        memberName: 'Ana Anić',
        from: '28.09.2026',
        to: '29.09.2026',
        badge: BADGE_PAST,
      });
      expect(t('danas.admin.needsYou.open', { count: needsYou.count })).toBe('Otvori Za odluku (9)');
    });

    it('Only requests: one pending request is `1 čeka odluku`', () => {
      const needsYou = shownOf([], [requestOf('req-1', ANA, '2026-10-04', '2026-10-05')]);

      expect(needsYou.count).toBe(1);
      expect(needsYou.rows.map((row) => row.kind)).toEqual([ITEM_REQUEST]);
      expect(t('zaOdluku.count', { count: needsYou.count })).toBe('1 čeka odluku');
    });

    it('Stale snapshot: a request of a member the snapshot does not hold yet is a skew, as the queue\'s — never drawn as gone', () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const newer = [requestOf('req-newer', '00000000-0000-4000-8000-0000000000ff', '2026-10-04', '2026-10-05')];

      expect(adminTodayOf(sourcesOf(pilot, [], [], newer), AT_1420)).toEqual({ kind: ADMIN_TODAY_UNAVAILABLE });
      expect(adminTodayOf({ ...sourcesOf(pilot, [], [], newer), snapshotFetching: true }, AT_1420)).toEqual({
        kind: ADMIN_TODAY_LOADING,
      });
      expect(logged).not.toHaveBeenCalled();
    });

    it('Read fails: a failed or paused requests read makes the whole card unavailable', () => {
      const failed: LeaveRowsAnswer = { isPending: false, isError: true, fetchStatus: 'idle', data: [] };
      const paused: LeaveRowsAnswer = { isPending: false, isError: false, fetchStatus: 'paused', data: [] };

      expect(adminTodayOf({ ...sourcesOf(pilot, []), requests: failed }, AT_1420)).toEqual({ kind: ADMIN_TODAY_UNAVAILABLE });
      expect(adminTodayOf({ ...sourcesOf(pilot, []), requests: paused }, AT_1420)).toEqual({ kind: ADMIN_TODAY_UNAVAILABLE });
    });
  });

  describe('swaps waiting for an admin (story 12.4)', () => {
    /** Ana gives B's shift on `date` to Bruno, accepted and open. */
    const swapOf = (id: string, date: string): Row =>
      swapRowOf({ id, proposer_id: ANA, addressee_id: BRUNO, team_id: B, date });
    const shownOf = (rows: readonly unknown[], swapRows: readonly unknown[]) => {
      const shown = adminTodayOf(sourcesOf(pilot, rows, [], [], swapRows), AT_1420);

      if (shown.kind !== ADMIN_TODAY_READY) throw new Error(shown.kind);

      return shown.view.needsYou;
    };

    it('Waits: counts an accepted swap with the collisions, the same count as the queue, with a row of its own', () => {
      const swaps = [swapOf('swap-past', '2026-09-29')];
      const needsYou = shownOf(SEVEN, swaps);
      const queue = conflictsQueueOf(sourcesOf(pilot, SEVEN, [], [], swaps), AT_1420);

      if (queue.kind !== CONFLICTS_READY) throw new Error(queue.kind);

      expect(needsYou.count).toBe(8);
      expect(needsYou.count).toBe(queue.view.count);
      expect(needsYou.rows[0]).toEqual({
        kind: ITEM_SWAP,
        key: 'swap:swap-past',
        requestId: 'swap-past',
        date: '2026-09-29',
        weekday: 'utorak',
        dayMonth: '29.09.',
        proposerName: 'Ana Anić',
        addresseeName: 'Bruno Brnić',
        given: { date: '2026-09-29', dateShown: '29.09.2026', teamName: expect.any(String) },
        returnShift: null,
        badge: BADGE_PAST,
      });
    });

    it('equals Za odluku at zero, and with only a swap', () => {
      for (const swaps of [[], [swapOf('swap-1', '2026-10-04')]]) {
        const queue = conflictsQueueOf(sourcesOf(pilot, [], [], [], swaps), AT_1420);

        if (queue.kind !== CONFLICTS_READY) throw new Error(queue.kind);

        expect(shownOf([], swaps).count).toBe(queue.view.count);
        expect(shownOf([], swaps).count).toBe(swaps.length);
      }
    });

    it('Read fails: a failed or paused swaps read makes the whole card unavailable, never a partial count', () => {
      const failed: LeaveRowsAnswer = { isPending: false, isError: true, fetchStatus: 'idle', data: [] };
      const paused: LeaveRowsAnswer = { isPending: false, isError: false, fetchStatus: 'paused', data: [] };

      expect(adminTodayOf({ ...sourcesOf(pilot, []), swaps: failed }, AT_1420)).toEqual({ kind: ADMIN_TODAY_UNAVAILABLE });
      expect(adminTodayOf({ ...sourcesOf(pilot, []), swaps: paused }, AT_1420)).toEqual({ kind: ADMIN_TODAY_UNAVAILABLE });
    });
  });

  it('says each count in all three Croatian forms', () => {
    expect(t('danas.admin.needsYou.pastLine', { count: 2, date: '30.09.' })).toBe(
      '2 na datume koji su prošli · najraniji 30.09.',
    );
    expect(t('danas.admin.needsYou.pastLine', { count: 21, date: '30.09.' })).toBe(
      '21 na datum koji je prošao · najraniji 30.09.',
    );
    expect(t('zaOdluku.count', { count: 22 })).toBe('22 čekaju odluku');
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
      'Ana Anić je na godišnjem, a u sastavu je smjene · čeka odluku',
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

  it('reads kind, type, range and roster through the day detail: a replacement by roster override matches dayDetailOf (story 11.4)', async () => {
    const snapshot = await snapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('ro-fran', A, TODAY, ANA, FRAN)],
    });
    const rows = [leaveOf('leave-fran', FRAN, TODAY, TODAY)];
    const { coverage } = viewOf(snapshot, rows);

    for (const row of coverage.rows) {
      const detail = dayDetailOf(snapshot, row.teamId, TODAY);

      expect([row.shiftTypeName, row.range, row.total]).toEqual([detail?.typeName, detail?.range, detail?.roster.length]);
    }

    const teams = ['pilot-smjena-a', 'pilot-smjena-b', 'pilot-smjena-c', 'pilot-smjena-d'];
    const kindOf = (teamId: string) => dayDetailOf(snapshot, teamId, TODAY)?.kind;

    const namesOf = (kind: string) =>
      teams.filter((id) => kindOf(id) === kind).map((id) => dayDetailOf(snapshot, id, TODAY)?.teamName);

    expect(coverage.off).toEqual(namesOf(DAY_OFF));
    expect(coverage.noRotation).toEqual(namesOf(DAY_NO_ROTATION));
    // Ana is off A's Noć and Fran on it: Fran, on leave, is the one absent.
    const [noc] = coverage.rows;

    expect(dayDetailOf(snapshot, A, TODAY)?.roster.map((one) => one.id)).toContain(FRAN);
    expect(noc).toMatchObject({ teamId: A, present: 3, total: 4, staffing: STAFFING_SHORT });
    expect(noc?.absent).toEqual([{ memberId: FRAN, name: 'Fran Franić', state: ABSENT_UNRESOLVED }]);
  });

  it('two absent on one shift, one of them put on by a roster override: in the day detail\'s roster order', async () => {
    const snapshot = await snapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('ro-fran', A, TODAY, DORA, FRAN)],
    });
    const rows = [leaveOf('leave-fran', FRAN, TODAY, TODAY), leaveOf('leave-ana', ANA, TODAY, TODAY)];
    const [noc] = viewOf(snapshot, rows).coverage.rows;
    const roster = dayDetailOf(snapshot, A, TODAY)?.roster.map((one) => one.id) ?? [];

    // The order is the day detail's (name order) on purpose: the row equals that day's detail (AD-13).
    expect(noc?.absent.map((one) => one.memberId)).toEqual(roster.filter((id) => id === ANA || id === FRAN));
    expect(noc?.absent.map((one) => one.name)).toEqual(['Ana Anić', 'Fran Franić']);
    expect(noc).toMatchObject({ present: 2, total: 4, staffing: STAFFING_SHORT });
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
    const listed = collisionRowsOf(queue.view.rows)
      .filter((row) => inWeek.has(row.date))
      .map((row) => `${row.teamId}|${row.date}`);

    expect(marked.length).toBeGreaterThan(0);
    expect(new Set(marked)).toEqual(new Set(listed));
    expect(needsYou.count).toBe(7);
    expect(week.legend).toEqual([
      { letter: 'N', name: 'Noć' },
      { letter: 'S', name: 'Slobodno' },
      { letter: 'D', name: 'Dan' },
    ]);
    expect(week.anyConflict).toBe(true);
    // The setting empty: nothing short-staffed anywhere in the week.
    expect(week.rows.flatMap((row) => row.cells).some((cell) => cell.shortStaffed)).toBe(false);
    expect(week.rows.flatMap((row) => row.cells).some((cell) => cell.modifiers.includes('shortStaffed'))).toBe(false);
    expect(week.anyShortStaffed).toBe(false);
  });

  it('carries the calendar\'s short-staffed mark, its name and its legend entry while the minimum is set (story 11.3)', async () => {
    // Team A has four members; on 01.10. (Noć) Ana and Cvita are away, so two
    // are at work against a minimum of 3. On 04.10. (Dan) only Ana is: three.
    const snapshot = await snapshotOf({ minimum: 3 });
    const { week } = viewOf(snapshot, SEVEN);
    const a = week.rows.find((row) => row.teamId === A);
    const short = a?.cells[0];
    const enough = a?.cells[3];
    const day = week.days[0];

    if (short === undefined || enough === undefined || day === undefined) throw new Error('no cell');

    expect(short.modifiers).toContain('shortStaffed');
    expect(short.shortStaffed).toBe(true);
    expect(enough.letter).toBe('D');
    expect(enough.shortStaffed).toBe(false);
    expect(enough.modifiers).not.toContain('shortStaffed');
    expect(week.anyShortStaffed).toBe(true);
    // The name the grid gives it: the cell's words, then the mark's.
    const name = t(weekCellMessageKey(short), {
      weekday: day.weekday,
      date: day.dayMonth,
      team: a?.teamName,
      type: short.name,
      range: short.range,
    });

    expect(t('danas.admin.week.cellShortStaffed', { cell: name })).toBe(
      'četvrtak 01.10., Smjena A, Noć 19:00–07:00, čeka odluku, premalo ljudi',
    );
    expect(t('danas.admin.week.legendShortStaffed')).toBe('premalo ljudi');
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
    ).toBe('četvrtak 01.10., Smjena A, Noć 19:00–07:00, čeka odluku');
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

describe('the four reads', () => {
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

  describe('offline and restored, through the surface\'s freshness (story 8.2)', () => {
    const READ_AT = 1_000;
    /** The three reads as the cache holds them, each refetch paused offline. */
    const pausedOf = <Data>(data: Data | undefined) => ({
      data,
      dataUpdatedAt: data === undefined ? 0 : READ_AT,
      isError: false,
      isPending: data === undefined,
      fetchStatus: 'paused',
    });
    const shownOf = (
      calendar: ReadAnswer<CalendarSnapshot>,
      records: ReadAnswer<readonly unknown[]>,
      resolutions: ReadAnswer<readonly unknown[]>,
      clock: FreshnessClock,
      // Story 9.5: the requests read, in the same state as the resolutions unless a case says otherwise.
      requests: ReadAnswer<readonly unknown[]> = resolutions,
      // Story 12.4: the swaps read, likewise.
      swaps: ReadAnswer<readonly unknown[]> = resolutions,
    ) => {
      const freshness = snapshotFreshnessOf(
        [calendar, records, resolutions, requests, swaps],
        clock.freshAfter,
        clock.online,
        clock.reconnected,
      );
      const answerOf = <Data,>(answer: ReadAnswer<Data>) => snapshotAnswerOf(answer, freshness, clock);
      const mappedCalendar = answerOf(calendar);

      return {
        freshness,
        today: adminTodayOf(
          {
            calendar: calendarSurfaceStateOf(mappedCalendar),
            records: answerOf(records),
            resolutions: answerOf(resolutions),
            requests: answerOf(requests),
            swaps: answerOf(swaps),
            snapshotFetching: mappedCalendar.fetchStatus === 'fetching',
          },
          AT_1420,
        ),
      };
    };

    it('offline, whole: the admin\'s Danas is drawn from the device, the same view as online', () => {
      const clock = { online: false, freshAfter: READ_AT + 1 };
      const { freshness, today } = shownOf(pausedOf(pilot), pausedOf([]), pausedOf([]), clock);

      expect(freshness).toEqual({ kind: FRESHNESS_OFFLINE, asOf: READ_AT });
      expect(today.kind).toBe(ADMIN_TODAY_READY);
      if (today.kind === ADMIN_TODAY_READY) expect(today.view).toEqual(viewOf(pilot, []));
    });

    it('offline, partial: unavailable, never Treba tebe beside a missing read', () => {
      const clock = { online: false, freshAfter: READ_AT + 1 };

      expect(shownOf(pausedOf(pilot), pausedOf([]), pausedOf<readonly unknown[]>(undefined), clock).today).toEqual({
        kind: ADMIN_TODAY_UNAVAILABLE,
      });
    });

    it('online, restored: the skeleton until every read is newer than freshAfter', () => {
      const clock = { online: true, freshAfter: READ_AT + 1 };
      const refetching = <Data,>(data: Data) => ({ ...pausedOf(data), fetchStatus: 'fetching' });

      expect(shownOf(refetching(pilot), refetching([]), refetching([]), clock).today).toEqual({ kind: ADMIN_TODAY_LOADING });
    });

    it('reconnected, whole: the cached view stays until every read is fresh', () => {
      const clock = { online: true, freshAfter: READ_AT + 1, reconnected: true };
      const refetching = <Data,>(data: Data) => ({ ...pausedOf(data), fetchStatus: 'fetching' });

      expect(shownOf(refetching(pilot), refetching([]), refetching([]), clock).today.kind).toBe(ADMIN_TODAY_READY);
    });
  });

  it('a leave row that cannot be trusted is unavailable, and logged', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(adminTodayOf(sourcesOf(pilot, [{ id: 'x', member_id: VIEWER_MEMBER, during: 'not a range' }]), AT_1420)).toEqual({
      kind: ADMIN_TODAY_UNAVAILABLE,
    });
    expect(logged).toHaveBeenCalled();
  });

  // E765, as the queue: a row newer than the cached snapshot is a skew between the reads.
  it('a leave row of a member newer than the snapshot is unavailable, unlogged, and loading while it is read again', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sources = sourcesOf(pilot, [{ id: 'x', member_id: 'newer-member', during: '[2026-10-01,2026-10-02)' }]);

    expect(adminTodayOf(sources, AT_1420)).toEqual({ kind: ADMIN_TODAY_UNAVAILABLE });
    expect(adminTodayOf({ ...sources, snapshotFetching: true }, AT_1420)).toEqual({ kind: ADMIN_TODAY_LOADING });
    expect(logged).not.toHaveBeenCalled();
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

    expect(status).toEqual({ kind: STATUS_WORKING, shifts: [{ name: 'Noć', range: '19:00–07:00', fromYesterday: false }] });

    if (status?.kind !== STATUS_WORKING) throw new Error('not working');

    const [shift] = status.shifts;

    if (shift === undefined) throw new Error('no shift');

    expect(t(adminStatusShiftMessageKey(shift), { type: shift.name, range: shift.range })).toBe('Danas radiš Noć 19:00–07:00');
    expect(t('danas.admin.subtitle', { weekday: 'četvrtak', date: '01.10.2026', status: 'Danas radiš Noć 19:00–07:00' })).toBe(
      'četvrtak, 01.10.2026 · Danas radiš Noć 19:00–07:00',
    );
  });

  it('a lone Noć from yesterday still running: Danas radiš Noć 19:00–07:00 od jučer, and coverage unchanged', async () => {
    const snapshot = await snapshotOf({ viewerTeam: A });
    const at = zagreb('2026-10-02', '03:00');
    const status = adminStatusOf(todayViewOf(snapshot, [], at));

    // Marked as the member's today card marks it (E897), so the two surfaces
    // never describe the same carried shift differently.
    expect(status).toEqual({ kind: STATUS_WORKING, shifts: [{ name: 'Noć', range: '19:00–07:00', fromYesterday: true }] });

    if (status?.kind !== STATUS_WORKING) throw new Error('not working');

    const [shift] = status.shifts;

    if (shift === undefined) throw new Error('no shift');

    expect(adminStatusShiftMessageKey(shift)).toBe('danas.admin.status.workingFromYesterday');
    expect(t(adminStatusShiftMessageKey(shift), { type: shift.name, range: shift.range })).toBe(
      'Danas radiš Noć 19:00–07:00 od jučer',
    );

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
    expect(adminStatusShiftMessageKey({ name: 'Noć', range: null, fromYesterday: false })).toBe('danas.admin.status.workingUntimed');
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

/**
 * STORY 11.4's matrix, executed over real snapshots of both fixtures: the
 * *Premalo ljudi* card counts the short-staffed shifts of the week *Ovaj
 * tjedan* draws, and that count is always the number of the week's cells the
 * calendar marks short-staffed.
 */
describe.each(STAFFING_FIXTURES)('Premalo ljudi ($name)', (fixture) => {
  const ONE = '00000000-0000-4000-8000-00000000e001';

  /**
   * The fixture's first team alone active: every other team is archived, so
   * its empty rosters (short under any minimum) count for nothing.
   */
  async function soloOf(fixtureOf: StaffingFixture, minimum: unknown): Promise<CalendarSnapshot> {
    const snapshot = await staffingSnapshotOf(fixtureOf, { size: 4, minimum });

    return {
      ...snapshot,
      teams: snapshot.teams.map((team) => (team.id === fixtureOf.team ? team : { ...team, archived: true })),
    };
  }

  /** The dates from `from`, over `days` days, on which `teamId` (the fixture's first team by default) works a working shift. */
  function workingDatesOf(snapshot: CalendarSnapshot, from: string, days: number, teamId = fixture.team): readonly string[] {
    return datesFrom(from, days).filter((date) => peopleAtWorkOn(staffingInputOf(snapshot, []), teamId, date) !== null);
  }

  /** Two of the team's four on leave on each of `dates`. */
  function twoAwayOn(dates: readonly string[]): readonly unknown[] {
    return dates.flatMap((date, index) => [
      leaveRow(`00000000-0000-4000-8000-0000000e1${String(index).padStart(3, '0')}`, member(1), date, date),
      leaveRow(`00000000-0000-4000-8000-0000000e2${String(index).padStart(3, '0')}`, member(2), date, date),
    ]);
  }

  /** How many of the week's cells carry the calendar's short-staffed mark. */
  function weekMarkedOf(view: AdminTodayView): number {
    return view.week.rows.flatMap((row) => row.cells).filter((cell) => cell.modifiers.includes(MODIFIER_SHORT_STAFFED)).length;
  }

  it('Short: two away on two dates this week — count 2, two rows linking to their day details', async () => {
    const snapshot = await soloOf(fixture, 3);
    const today = firstWorkingDayOf(snapshot, fixture).date;
    const dates = workingDatesOf(snapshot, today, ADMIN_WEEK_DAYS).slice(0, 2);

    expect(dates).toHaveLength(2);

    const view = viewOf(snapshot, twoAwayOn(dates), [], zagreb(today, '12:00'));
    const card = view.shortStaffed;

    if (card === null) throw new Error('no card');

    expect(card.count).toBe(2);
    expect(card.count).toBe(weekMarkedOf(view));
    expect(card.minimum).toBe(3);
    expect(card.more).toBe(0);
    expect(card.rows.map((row) => [row.date, row.teamId, row.atWork, row.minimum])).toEqual(
      dates.map((date) => [date, fixture.team, 2, 3]),
    );
    const [first] = card.rows;
    const firstDate = dates[0] ?? '';

    if (first === undefined) throw new Error('no row');

    // On *Sve smjene*, as *Otvori kalendar*, with the day detail open.
    expect(first.calendar).toEqual({ mjesec: firstDate.slice(0, 7), prikaz: 'sve', dan: firstDate, danSmjena: fixture.team });
    expect(calendarOpenDayOf(first.calendar)).toEqual({ teamId: fixture.team, date: firstDate });
    expect(first.teamName).toBe(fixture.teamName);
    expect(first.shiftTypeName).toBe(dayDetailOf(snapshot, fixture.team, firstDate)?.typeName);
    expect(
      t('danas.admin.shortStaffed.row', {
        weekday: first.weekday,
        date: first.dayMonth,
        team: first.teamName,
        type: first.shiftTypeName,
        atWork: atWorkText(first.atWork, first.minimum),
      }),
    ).toBe(`${first.weekday} ${first.dayMonth} · ${fixture.teamName} · ${first.shiftTypeName}: rade 2 od najmanje 3`);
    expect(t('danas.admin.shortStaffed.count', { count: card.count })).toBe('2 smjene ovaj tjedan');
  });

  it('Many: 5 short — the earliest three by date then team order, then `i još 2`', async () => {
    // Two teams active: the fixture's second team holds only the replacement,
    // so each of its working shifts is short; the first team is made short on
    // as many of its working dates as bring the week to exactly 5.
    const full = await staffingSnapshotOf(fixture, { size: 4, minimum: 3 });
    const snapshot: CalendarSnapshot = {
      ...full,
      teams: full.teams.map((team) =>
        team.id === fixture.team || team.id === fixture.otherTeam ? team : { ...team, archived: true },
      ),
    };
    const today = firstWorkingDayOf(snapshot, fixture).date;
    const need = 5 - workingDatesOf(snapshot, today, ADMIN_WEEK_DAYS, fixture.otherTeam).length;

    expect(need).toBeGreaterThanOrEqual(0);

    const ours = workingDatesOf(snapshot, today, ADMIN_WEEK_DAYS).slice(0, need);

    expect(ours).toHaveLength(need);

    const view = viewOf(snapshot, twoAwayOn(ours), [], zagreb(today, '12:00'));
    const card = view.shortStaffed;

    if (card === null) throw new Error('no card');

    expect(card.count).toBe(5);
    expect(card.count).toBe(weekMarkedOf(view));
    expect(card.rows).toHaveLength(SHORT_STAFFED_TODAY_ROWS);
    expect(card.rows).toHaveLength(3);
    expect(card.more).toBe(2);
    // Soonest first, then in the week's team order.
    const order = view.week.rows.map((row) => row.teamId);
    const keys = card.rows.map((row) => [row.date, order.indexOf(row.teamId)] as const);

    expect([...keys].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1]))).toEqual(keys);
    expect(t('danas.admin.shortStaffed.more', { count: card.more })).toBe('i još 2');
  });

  it('Zero: the minimum set and none short — 0, the calm line naming the minimum', async () => {
    const snapshot = await soloOf(fixture, 3);
    const today = firstWorkingDayOf(snapshot, fixture).date;
    const view = viewOf(snapshot, [], [], zagreb(today, '12:00'));

    expect(view.shortStaffed).toEqual({ count: 0, minimum: 3, rows: [], more: 0 });
    expect(weekMarkedOf(view)).toBe(0);
    expect(t('danas.admin.shortStaffed.count', { count: 0 })).toBe('0 smjena ovaj tjedan');
    expect(t('danas.admin.shortStaffed.calm', { minimum: 3 })).toBe('Svaka smjena ovaj tjedan ima najmanje 3 čovjeka.');
  });

  it('Empty setting: no card at all, whatever the leave', async () => {
    const snapshot = await soloOf(fixture, null);
    const today = firstWorkingDayOf(snapshot, fixture).date;
    const dates = workingDatesOf(snapshot, today, ADMIN_WEEK_DAYS).slice(0, 2);

    expect(viewOf(snapshot, twoAwayOn(dates), [], zagreb(today, '12:00')).shortStaffed).toBeNull();
  });

  it('Beyond the week: short only after today + 6 — count 0', async () => {
    const snapshot = await soloOf(fixture, 3);
    const today = firstWorkingDayOf(snapshot, fixture).date;
    const later = workingDatesOf(snapshot, today, 40).filter((date) => !datesFrom(today, ADMIN_WEEK_DAYS).includes(date));
    const beyond = later.slice(0, 1);

    expect(beyond).toHaveLength(1);

    const view = viewOf(snapshot, twoAwayOn(beyond), [], zagreb(today, '12:00'));

    expect(view.shortStaffed?.count).toBe(0);
    expect(weekMarkedOf(view)).toBe(0);
  });

  it('Refused data: a record the staffing rule refuses throws a RangeError, and the whole screen is unavailable, logged', async () => {
    const snapshot = await soloOf(fixture, 3);
    const today = firstWorkingDayOf(snapshot, fixture).date;
    const tomorrow = datesFrom(today, 2)[1] ?? today;
    const marks = {
      ...NO_MARKS,
      // Ends (today) before it starts (tomorrow).
      staffingLeave: [{ id: ONE, memberId: member(1), from: tomorrow, to: today }],
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => shortStaffedCardOf(snapshot, marks, datesFrom(today, ADMIN_WEEK_DAYS))).toThrow(RangeError);
    // The same records refuse the month too.
    expect(calendarMonthOutcomeOf(snapshot, { mjesec: today.slice(0, 7) }, today, marks).ok).toBe(false);
    // Through the whole path: the same refused record as the leave read answers it is the screen's unavailable, logged.
    const refused = { id: ONE, member_id: member(1), during: `[${tomorrow},${today})` };

    expect(adminTodayOf(sourcesOf(snapshot, [refused]), zagreb(today, '12:00'))).toEqual({ kind: ADMIN_TODAY_UNAVAILABLE });
    expect(logged).toHaveBeenCalled();
    // No staffing leave in the marks (a member's, or the setting empty) is no card, before the minimum is read.
    expect(shortStaffedCardOf(snapshot, NO_MARKS, datesFrom(today, ADMIN_WEEK_DAYS))).toBeNull();
  });
});

describe('Premalo ljudi, the words', () => {
  it('says the count and the minimum in all three Croatian forms', () => {
    expect(t('danas.admin.shortStaffed.count', { count: 1 })).toBe('1 smjena ovaj tjedan');
    expect(t('danas.admin.shortStaffed.count', { count: 5 })).toBe('5 smjena ovaj tjedan');
    expect(t('danas.admin.shortStaffed.count', { count: 22 })).toBe('22 smjene ovaj tjedan');
    expect(t('danas.admin.shortStaffed.calm', { minimum: 1 })).toBe('Svaka smjena ovaj tjedan ima najmanje 1 čovjeka.');
    expect(t('danas.admin.shortStaffed.calm', { minimum: 5 })).toBe('Svaka smjena ovaj tjedan ima najmanje 5 ljudi.');
    expect(t('danas.admin.shortStaffed.heading')).toBe('Premalo ljudi');
    expect(t('danas.admin.shortStaffed.open')).toBe('Otvori kalendar');
  });
});
