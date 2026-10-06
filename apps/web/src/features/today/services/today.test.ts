import { leaveCostOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarDayListOf, memberScheduleInputOf, type CalendarMarks } from '@/features/calendar/utils/month';
import { MODIFIER_LEAVE } from '@/features/calendar/utils/modifiers';
import {
  CASE_FREE,
  CASE_LEAVE,
  CASE_WORKING,
  NEXT_SHIFT_HORIZON_DAYS,
  TODAY_LOADING,
  TODAY_READY,
  TODAY_UNAVAILABLE,
  TODAY_UNSCHEDULED,
  WEEK_DAYS,
  nextShiftHeadingMessageKey,
  todayCaseMessageKey,
  todayDateShownOf,
  todayMessageKey,
  todayOf,
  todayViewOf,
  type Today,
  type TodayRowsAnswer,
  type TodayView,
} from '@/features/today/services/today';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  type FixtureRows,
  SEEDED,
  VIEWER_MEMBER,
  calendarOrganizationRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  typeRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 6.1a's view model, executed (AD-15): every row of the spec's matrix
 * over the pilot fixture — team A works `Dan, Noć, Slobodno, Slobodno` from
 * 2020-01-01, so 2026-09-30 is a Dan, 2026-10-01 a Noć, 2026-10-02 and
 * 2026-10-03 Slobodno — and every day compared against *Moj raspored*'s own
 * `calendarDayListOf`.
 */

const TEAM_A = 'pilot-smjena-a';
const TEAM_D = 'pilot-smjena-d';

/** Noon in Zagreb on `date`. */
function noonOf(date: string): Date {
  return new Date(`${date}T10:00:00Z`);
}

async function snapshotOf(
  options: {
    readonly versions?: readonly Record<string, unknown>[];
    readonly role?: string;
    readonly roster?: readonly Record<string, unknown>[];
    readonly rows?: FixtureRows;
  } = {},
): Promise<CalendarSnapshot> {
  const versions = options.versions ?? [membershipRow(TEAM_A, SEEDED)];
  const source = calendarTableOf(
    {
      data: [calendarOrganizationRow(options.rows ?? PILOT, { viewers: [viewerRow(versions, { role: options.role ?? 'member_role' })] })],
      error: null,
      count: 1,
    },
    membersAnswerOf(),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(options.roster ?? []),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A row as `my_leave_records()` answers it: the range canonical, its upper bound exclusive. */
function rowOf(id: string, from: string, toExclusive: string, memberId: string = VIEWER_MEMBER) {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}

function readyOf(today: Today): TodayView {
  if (today.kind !== TODAY_READY) throw new Error(`not ready: ${today.kind}`);

  return today.view;
}

let pilot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("today's one case", () => {
  it('works tonight: Danas radiš, Noć 19:00–07:00 and the team', () => {
    const view = readyOf(todayViewOf(pilot, [], noonOf('2026-10-01')));

    expect(view.todayCase).toEqual({
      kind: CASE_WORKING,
      shifts: [{ teamId: TEAM_A, teamName: 'Smjena A', name: 'Noć', range: '19:00–07:00' }],
    });
    expect(t(todayCaseMessageKey(view.todayCase.kind))).toBe('Danas radiš');
  });

  it('is free on Slobodno, and the next shift is the Dan in 2 days', () => {
    const view = readyOf(todayViewOf(pilot, [], noonOf('2026-09-28')));

    expect(view.todayCase).toEqual({
      kind: CASE_FREE,
      shift: { teamId: TEAM_A, teamName: 'Smjena A', name: 'Slobodno', range: null },
    });
    expect(t(todayCaseMessageKey(view.todayCase.kind))).toBe('Danas ne radiš');
    expect(view.next).toMatchObject({ date: '2026-09-30', inDays: 2, name: 'Dan', range: '07:00–19:00' });
    expect(view.returning).toBe(false);
    expect(
      t(nextShiftHeadingMessageKey(view.returning), { days: t('count.days', { count: view.next?.inDays ?? 0 }) }),
    ).toBe('Sljedeća smjena · za 2 dana');
  });

  it('lists two shifts today, the own team first, when a roster override puts the viewer on another', async () => {
    const snapshot = await snapshotOf({
      roster: [calendarRosterOverrideRow('roster-1', TEAM_D, '2026-10-01', null, VIEWER_MEMBER)],
    });
    const view = readyOf(todayViewOf(snapshot, [], noonOf('2026-10-01')));

    expect(view.todayCase).toEqual({
      kind: CASE_WORKING,
      shifts: [
        { teamId: TEAM_A, teamName: 'Smjena A', name: 'Noć', range: '19:00–07:00' },
        { teamId: TEAM_D, teamName: 'Smjena D', name: 'Dan', range: '07:00–19:00' },
      ],
    });
  });

  it('is on leave, with the range, and the next shift is the return after it', () => {
    const view = readyOf(todayViewOf(pilot, [rowOf('leave-1', '2026-09-28', '2026-10-05')], noonOf('2026-10-01')));

    // 30.09. Dan, 01.10. Noć and 04.10. Dan cost 3.
    expect(view.todayCase).toEqual({ kind: CASE_LEAVE, from: '28.09.2026', to: '04.10.2026', costDays: 3 });
    expect(t(todayCaseMessageKey(view.todayCase.kind))).toBe('Danas si na godišnjem odmoru');
    expect(view.returning).toBe(true);
    expect(view.next).toMatchObject({ date: '2026-10-05', inDays: 4, name: 'Noć', text: '05.10.2026' });
    expect(
      t(nextShiftHeadingMessageKey(view.returning), { days: t('count.days', { count: view.next?.inDays ?? 0 }) }),
    ).toBe('Vraćaš se · za 4 dana');
  });

  it('is on leave on a non-working day too: leave wins over free', () => {
    const view = readyOf(todayViewOf(pilot, [rowOf('leave-1', '2026-09-28', '2026-09-29')], noonOf('2026-09-28')));

    expect(view.todayCase.kind).toBe(CASE_LEAVE);
    expect(view.next).toMatchObject({ date: '2026-09-30', inDays: 2 });
  });

  it('states the whole absence when back-to-back records cover today, and returns after both', () => {
    const rows = [rowOf('leave-1', '2026-09-28', '2026-10-01'), rowOf('leave-2', '2026-10-01', '2026-10-05')];
    const view = readyOf(todayViewOf(pilot, rows, noonOf('2026-10-01')));

    // 1 (30.09.) + 2 (01.10., 04.10.).
    expect(view.todayCase).toEqual({ kind: CASE_LEAVE, from: '28.09.2026', to: '04.10.2026', costDays: 3 });
    expect(view.next).toMatchObject({ date: '2026-10-05', inDays: 4 });
  });

  it('keeps a record after a gap out of today’s absence', () => {
    const rows = [rowOf('leave-1', '2026-09-28', '2026-10-02'), rowOf('leave-2', '2026-10-03', '2026-10-05')];
    const view = readyOf(todayViewOf(pilot, rows, noonOf('2026-10-01')));

    // 28.09.–01.10., then 02.10. free of leave, then 03.10.–04.10.
    expect(view.todayCase).toEqual({ kind: CASE_LEAVE, from: '28.09.2026', to: '01.10.2026', costDays: 2 });
  });

  it('names a next shift whose type has no times by its name alone', async () => {
    const untimed = await snapshotOf({
      rows: {
        ...PILOT,
        types: [
          typeRow('pilot-dan', 'Dan', '2026-09-25T20:07:49.330741+00:00'),
          ...PILOT.types.slice(1),
        ],
      },
    });
    const view = readyOf(todayViewOf(untimed, [], noonOf('2026-09-28')));

    expect(view.next).toMatchObject({ date: '2026-09-30', inDays: 2, name: 'Dan', range: null });
  });

  it('skips a future working date covered by leave', () => {
    const view = readyOf(todayViewOf(pilot, [rowOf('leave-1', '2026-09-30', '2026-10-01')], noonOf('2026-09-28')));

    expect(view.todayCase.kind).toBe(CASE_FREE);
    expect(view.next).toMatchObject({ date: '2026-10-01', inDays: 3, name: 'Noć' });
    expect(view.returning).toBe(false);
  });

  it('is free with no shift between teams, and the next shift is on the new team', async () => {
    const snapshot = await snapshotOf({
      versions: [membershipRow(TEAM_A, SEEDED), membershipRow(null, '2026-09-20'), membershipRow(TEAM_A, '2026-10-04')],
    });
    const view = readyOf(todayViewOf(snapshot, [], noonOf('2026-10-01')));

    expect(view.todayCase).toEqual({ kind: CASE_FREE, shift: null });
    expect(view.next).toMatchObject({ date: '2026-10-04', inDays: 3, name: 'Dan' });
  });

  it('is unscheduled with no membership at all, an admin too, with the date and no case', async () => {
    for (const role of ['member_role', 'admin']) {
      const snapshot = await snapshotOf({ versions: [], role });
      const today = todayViewOf(snapshot, [], noonOf('2026-10-01'));

      expect(today).toEqual({
        kind: TODAY_UNSCHEDULED,
        today: { date: '2026-10-01', weekday: 'četvrtak', text: '01.10.2026' },
      });
      expect(todayDateShownOf(today)).toEqual({ date: '2026-10-01', weekday: 'četvrtak', text: '01.10.2026' });
    }
  });

  it('gives an admin on a team the same screen as a member', async () => {
    const admin = await snapshotOf({ role: 'admin' });

    expect(todayViewOf(admin, [], noonOf('2026-10-01'))).toEqual(todayViewOf(pilot, [], noonOf('2026-10-01')));
  });

  it(`has no next shift when none falls within ${String(NEXT_SHIFT_HORIZON_DAYS)} days`, async () => {
    const snapshot = await snapshotOf({ versions: [membershipRow(TEAM_A, SEEDED), membershipRow(null, '2026-09-01')] });
    const view = readyOf(todayViewOf(snapshot, [], noonOf('2026-10-01')));

    expect(view.todayCase).toEqual({ kind: CASE_FREE, shift: null });
    expect(view.next).toBeNull();
    expect(t('danas.next.none', { days: t('count.days', { count: NEXT_SHIFT_HORIZON_DAYS }) })).toBe(
      'U sljedećih 366 dana nemaš nijednu smjenu.',
    );
  });

  it('finds a shift exactly on the horizon, and none a day past it', async () => {
    const back = (date: string) => [membershipRow(TEAM_A, SEEDED), membershipRow(null, '2026-09-01'), membershipRow(TEAM_A, date)];
    // 2026-10-02 + 366 days is 2027-10-03, a Dan; 2027-10-04 is a Noć.
    const onHorizon = await snapshotOf({ versions: back('2027-10-03') });
    const pastHorizon = await snapshotOf({ versions: back('2027-10-04') });

    expect(readyOf(todayViewOf(onHorizon, [], noonOf('2026-10-02'))).next).toMatchObject({
      date: '2027-10-03',
      inDays: NEXT_SHIFT_HORIZON_DAYS,
      name: 'Dan',
    });
    expect(readyOf(todayViewOf(pastHorizon, [], noonOf('2026-10-02'))).next).toBeNull();
  });

  it('states the date of today in the organization zone', () => {
    // 23:30 UTC on 30.09 is already 01.10 in Zagreb.
    const view = readyOf(todayViewOf(pilot, [], new Date('2026-09-30T23:30:00Z')));

    expect(view.today).toEqual({ date: '2026-10-01', weekday: 'četvrtak', text: '01.10.2026' });
    expect(t('danas.dateLine', { weekday: view.today.weekday, date: view.today.text })).toBe('četvrtak, 01.10.2026');
  });
});

describe("what today's leave costs (story 6.1b)", () => {
  /** The cost the case states, and the domain's own for the same ranges. */
  function costOf(view: TodayView): number {
    if (view.todayCase.kind !== CASE_LEAVE) throw new Error(`not on leave: ${view.todayCase.kind}`);

    return view.todayCase.costDays;
  }

  it("states the record's cost, the domain's leaveCostOf over the viewer's schedule", () => {
    const view = readyOf(todayViewOf(pilot, [rowOf('leave-1', '2026-09-28', '2026-10-05')], noonOf('2026-10-01')));
    const input = memberScheduleInputOf(pilot, pilot.viewer);

    // 30.09. Dan, 01.10. Noć and 04.10. Dan: only the days the viewer would work.
    expect(costOf(view)).toBe(3);
    expect(costOf(view)).toBe(leaveCostOf(input, '2026-09-28', '2026-10-04'));
    expect(t('danas.today.leaveCost', { days: t('count.days', { count: costOf(view) }) })).toBe(
      'Troši 3 dana godišnjeg — računaju se samo tvoji radni dani.',
    );
  });

  it('sums back-to-back records, each costed on its own range', () => {
    const rows = [rowOf('leave-1', '2026-09-28', '2026-10-01'), rowOf('leave-2', '2026-10-01', '2026-10-05')];
    const view = readyOf(todayViewOf(pilot, rows, noonOf('2026-10-01')));
    const input = memberScheduleInputOf(pilot, pilot.viewer);
    const first = leaveCostOf(input, '2026-09-28', '2026-09-30');
    const second = leaveCostOf(input, '2026-10-01', '2026-10-04');

    // 30.09. Dan; then 01.10. Noć and 04.10. Dan.
    expect([first, second]).toEqual([1, 2]);
    expect(costOf(view)).toBe(first + second);
  });

  it('leaves a record after a gap out of the cost', () => {
    const rows = [rowOf('leave-1', '2026-09-28', '2026-10-02'), rowOf('leave-2', '2026-10-03', '2026-10-05')];
    const view = readyOf(todayViewOf(pilot, rows, noonOf('2026-10-01')));

    // 30.09. Dan and 01.10. Noć; 04.10. is the later record's.
    expect(costOf(view)).toBe(2);
  });

  it('states the cost in all three forms: 1 dan, 2 dana, 5 dana', () => {
    const sentence = (count: number) => t('danas.today.leaveCost', { days: t('count.days', { count }) });

    expect(sentence(1)).toBe('Troši 1 dan godišnjeg — računaju se samo tvoji radni dani.');
    expect(sentence(2)).toContain('Troši 2 dana godišnjeg');
    expect(sentence(5)).toContain('Troši 5 dana godišnjeg');
  });

  it('is unavailable, logged, when the cost throws a RangeError', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A range longer than the domain admits: today on leave, the cost refused.
    const view = todayViewOf(pilot, [rowOf('leave-1', '2020-01-01', '2026-12-31')], noonOf('2026-10-01'));

    expect(view).toEqual({ kind: TODAY_UNAVAILABLE, retryable: false });
    expect(logged).toHaveBeenCalledWith(TODAY_UNAVAILABLE, expect.any(RangeError));
  });
});

describe('the next seven days', () => {
  /** *Moj raspored*'s day on `date`, with the member-shaped marks over `records`. */
  function calendarDay(snapshot: CalendarSnapshot, date: string, today: string, records: readonly { from: string; to: string }[]) {
    const marks: CalendarMarks = {
      collisions: [],
      uncovered: [],
      leave: new Map([[VIEWER_MEMBER, records]]),
    };

    return calendarDayListOf(snapshot, snapshot.viewer, date.slice(0, 7), today, marks)?.find((day) => day.date === date);
  }

  it('crosses a month: 29.10. to 04.11., each day equal to the calendar’s', () => {
    const view = readyOf(todayViewOf(pilot, [], noonOf('2026-10-28')));

    expect(view.week).toHaveLength(WEEK_DAYS);
    expect(view.week.map(({ day }) => day.date)).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
    for (const { day } of view.week) expect(day).toEqual(calendarDay(pilot, day.date, '2026-10-28', []));
  });

  it('marks own leave days, in the cells as the calendar does and in words', () => {
    const records = [{ from: '2026-10-02', to: '2026-10-03' }];
    const view = readyOf(todayViewOf(pilot, [rowOf('leave-1', '2026-10-02', '2026-10-04')], noonOf('2026-10-01')));

    expect(view.week.map(({ onLeave }) => onLeave)).toEqual([true, true, false, false, false, false, false]);
    expect(view.week[0]?.day.shifts[0]?.cell.modifiers).toEqual([MODIFIER_LEAVE]);
    for (const { day } of view.week) expect(day).toEqual(calendarDay(pilot, day.date, '2026-10-01', records));
  });

  it('shows days with no shift as such when the viewer has no team', async () => {
    const snapshot = await snapshotOf({ versions: [membershipRow(TEAM_A, SEEDED), membershipRow(null, '2026-09-01')] });
    const view = readyOf(todayViewOf(snapshot, [], noonOf('2026-10-01')));

    expect(view.week).toHaveLength(WEEK_DAYS);
    for (const { day } of view.week) expect(day.shifts).toEqual([]);
    expect(view.week[0]?.day).toMatchObject({ date: '2026-10-02', dayMonth: '02.10.', weekday: 'petak' });
  });
});

describe('the reads', () => {
  const ROWS: TodayRowsAnswer = { data: [], isError: false, isPending: false, fetchStatus: 'idle' };
  const PENDING: TodayRowsAnswer = { data: undefined, isError: false, isPending: true, fetchStatus: 'fetching' };

  it('loads while either read is pending, and never shows a case', () => {
    expect(todayOf({ calendar: { snapshot: null, refusal: null, loading: true }, records: ROWS }, noonOf('2026-10-01'))).toEqual({
      kind: TODAY_LOADING,
    });
    expect(todayOf({ calendar: { snapshot: pilot, refusal: null, loading: false }, records: PENDING }, noonOf('2026-10-01'))).toEqual({
      kind: TODAY_LOADING,
    });
    expect(todayDateShownOf({ kind: TODAY_LOADING })).toBeNull();
  });

  it('is unavailable with a retry when the calendar or the own-leave read fails, before any skeleton', () => {
    const failed = { kind: TODAY_UNAVAILABLE, retryable: true };

    expect(
      todayOf({ calendar: { snapshot: null, refusal: 'CALENDAR_UNAVAILABLE', loading: false }, records: PENDING }, noonOf('2026-10-01')),
    ).toEqual(failed);
    expect(
      todayOf(
        { calendar: { snapshot: null, refusal: null, loading: true }, records: { ...ROWS, data: undefined, isError: true } },
        noonOf('2026-10-01'),
      ),
    ).toEqual(failed);
    expect(
      todayOf({ calendar: { snapshot: pilot, refusal: null, loading: false }, records: { ...ROWS, fetchStatus: 'paused' } }, noonOf('2026-10-01')),
    ).toEqual(failed);
    expect(t(todayMessageKey(TODAY_UNAVAILABLE))).toBe('Danas trenutačno nije moguće učitati. Pokušaj ponovno.');
  });

  it('is ready once both answered', () => {
    expect(todayOf({ calendar: { snapshot: pilot, refusal: null, loading: false }, records: ROWS }, noonOf('2026-10-01')).kind).toBe(
      TODAY_READY,
    );
  });

  it("is unavailable without a retry, logged, for another member's row or one that does not parse", () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(todayViewOf(pilot, [rowOf('leave-1', '2026-10-01', '2026-10-02', 'someone-else')], noonOf('2026-10-01'))).toEqual({
      kind: TODAY_UNAVAILABLE,
      retryable: false,
    });
    expect(todayViewOf(pilot, [{ id: 'x', member_id: VIEWER_MEMBER, during: 'nonsense' }], noonOf('2026-10-01'))).toEqual({
      kind: TODAY_UNAVAILABLE,
      retryable: false,
    });
    expect(logged).toHaveBeenCalledTimes(2);
  });

  it('is unavailable without a retry, logged, when the derivation throws a RangeError', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: CalendarSnapshot = { ...pilot, types: [] };

    expect(todayViewOf(broken, [], noonOf('2026-10-01'))).toEqual({ kind: TODAY_UNAVAILABLE, retryable: false });
    expect(logged).toHaveBeenCalledWith(TODAY_UNAVAILABLE, expect.any(RangeError));
  });

  it('rethrows anything but a RangeError: a defect is not an unavailable read', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = Object.defineProperty({ ...pilot }, 'viewer', {
      get() {
        throw new TypeError('a defect');
      },
    }) as CalendarSnapshot;

    expect(() => todayViewOf(broken, [], noonOf('2026-10-01'))).toThrow(TypeError);
    expect(logged).not.toHaveBeenCalled();
  });
});

describe('the words', () => {
  it('maps every case and line to its own key', () => {
    expect(([CASE_LEAVE, CASE_WORKING, CASE_FREE] as const).map((kind) => todayCaseMessageKey(kind))).toEqual([
      'danas.today.leave',
      'danas.today.working',
      'danas.today.free',
    ]);
    expect(nextShiftHeadingMessageKey(true)).toBe('danas.next.returnHeading');
    expect(nextShiftHeadingMessageKey(false)).toBe('danas.next.heading');
    expect(todayMessageKey(TODAY_UNSCHEDULED)).toBe('danas.unscheduled');
    expect(todayMessageKey(TODAY_UNAVAILABLE)).toBe('danas.unavailable');
  });

  it('counts the days in all three Croatian forms, never by count === 1', () => {
    expect([1, 2, 5, 21].map((count) => t('danas.next.heading', { days: t('count.days', { count }) }))).toEqual([
      'Sljedeća smjena · za 1 dan',
      'Sljedeća smjena · za 2 dana',
      'Sljedeća smjena · za 5 dana',
      'Sljedeća smjena · za 21 dan',
    ]);
  });
});
