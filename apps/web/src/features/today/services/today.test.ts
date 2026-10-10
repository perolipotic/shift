import { leaveCostOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { NO_MARKS, calendarDayListOf, memberScheduleInputOf, type CalendarMarks } from '@/features/calendar/utils/month';
import { MODIFIER_LEAVE } from '@/features/calendar/utils/modifiers';
import {
  CASE_DUTY,
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
import {
  NOTE_ADDED,
  NOTE_OWN,
  NOTE_REPLACING,
  dutyEndLineMessageKey,
  dutyHeadlineMessageKey,
  dutyLegStateMessageKey,
  dutyNoteMessageKey,
  endLinePointOf,
  legNoteOf,
  type DutyLegNote,
  type TodayDuty,
} from '@/features/today/services/today-duty';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  type FixtureRows,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
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
    readonly overrides?: readonly Record<string, unknown>[];
    readonly members?: readonly Record<string, unknown>[];
    /** Other members' membership versions, each with its `member_id` (story 6.2). */
    readonly others?: readonly Record<string, unknown>[];
    readonly rows?: FixtureRows;
  } = {},
): Promise<CalendarSnapshot> {
  const versions = options.versions ?? [membershipRow(TEAM_A, SEEDED)];
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(options.rows ?? PILOT, {
          viewers: [viewerRow(versions, { role: options.role ?? 'member_role' })],
          versions:
            options.others === undefined
              ? null
              : [...versions.map((version) => ({ ...version, member_id: VIEWER_MEMBER, position: null })), ...options.others],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf(options.members),
    overridesAnswerOf(options.overrides ?? []),
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

/** The sentence a case other than a duty is stated in. */
function caseSentenceOf(view: TodayView): string {
  if (view.todayCase.kind === CASE_DUTY) throw new Error('a duty states itself in its duty-block');

  return t(todayCaseMessageKey(view.todayCase.kind));
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
      shifts: [{ teamId: TEAM_A, teamName: 'Smjena A', name: 'Noć', range: '19:00–07:00', fromYesterday: false }],
    });
    expect(caseSentenceOf(view)).toBe('Danas radiš');
  });

  it('is free on Slobodno, and the next shift is the Dan in 2 days', () => {
    const view = readyOf(todayViewOf(pilot, [], noonOf('2026-09-28')));

    expect(view.todayCase).toEqual({
      kind: CASE_FREE,
      shift: { teamId: TEAM_A, teamName: 'Smjena A', name: 'Slobodno', range: null, fromYesterday: false },
    });
    expect(caseSentenceOf(view)).toBe('Danas ne radiš');
    expect(view.next).toMatchObject({ date: '2026-09-30', inDays: 2, name: 'Dan', range: '07:00–19:00' });
    expect(view.returning).toBe(false);
    expect(
      t(nextShiftHeadingMessageKey(view.returning), { days: t('count.days', { count: view.next?.inDays ?? 0 }) }),
    ).toBe('Sljedeća smjena · za 2 dana');
  });

  it('lists two shifts today, the own team first, when a roster override puts the viewer on another that does not touch', async () => {
    // Story 6.2: a Noć from 20:00 leaves an hour after the Dan, so the two are no duty.
    const snapshot = await snapshotOf({
      roster: [calendarRosterOverrideRow('roster-1', TEAM_D, '2026-10-01', null, VIEWER_MEMBER)],
      rows: {
        ...PILOT,
        types: [
          PILOT.types[0] ?? {},
          typeRow('pilot-noc', 'Noć', '2026-09-25T20:07:49.331741+00:00', { times: ['20:00:00', '08:00:00'] }),
          ...PILOT.types.slice(2),
        ],
      },
    });
    const view = readyOf(todayViewOf(snapshot, [], noonOf('2026-10-01')));

    expect(view.todayCase).toEqual({
      kind: CASE_WORKING,
      shifts: [
        { teamId: TEAM_A, teamName: 'Smjena A', name: 'Noć', range: '20:00–08:00', fromYesterday: false },
        { teamId: TEAM_D, teamName: 'Smjena D', name: 'Dan', range: '07:00–19:00', fromYesterday: false },
      ],
    });
  });

  it('is on leave, with the range, and the next shift is the return after it', () => {
    const view = readyOf(todayViewOf(pilot, [rowOf('leave-1', '2026-09-28', '2026-10-05')], noonOf('2026-10-01')));

    // 30.09. Dan, 01.10. Noć and 04.10. Dan cost 3.
    expect(view.todayCase).toEqual({ kind: CASE_LEAVE, from: '28.09.2026', to: '04.10.2026', costDays: 3 });
    expect(caseSentenceOf(view)).toBe('Danas si na godišnjem odmoru');
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

describe("today's 24 h duty (story 6.2)", () => {
  const TEAM_B = 'pilot-smjena-b';
  const TEAM_C = 'pilot-smjena-c';
  const LEA = '00000000-0000-4000-8000-0000000000c7';
  const MEMBERS = [calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(LEA, 'Lea Bašić')];
  /** Lea on Smjena D. */
  const OTHERS = [{ ...membershipRow(TEAM_D, SEEDED), member_id: LEA, position: null }];

  /** `hh:mm` on `date` in Zagreb, which is UTC+2 in early October. */
  function zagrebOf(date: string, time: string): Date {
    const [hours = 0, minutes = 0] = time.split(':').map(Number);

    return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hours - 2, minutes));
  }

  function dutyOf(view: TodayView): TodayDuty {
    if (view.todayCase.kind !== CASE_DUTY) throw new Error(`not a duty: ${view.todayCase.kind}`);

    return view.todayCase.duty;
  }

  /** Whose shift a leg is, as the component words it: the member replaced named only on a replacement. */
  function noteText(note: DutyLegNote): string {
    return note.kind === NOTE_REPLACING
      ? t(dutyNoteMessageKey(note.kind), { name: note.member, team: note.team })
      : t(dutyNoteMessageKey(note.kind), { team: note.team });
  }

  /** The duty-block's lines, as the component words them. */
  function linesOf(duty: TodayDuty) {
    const duration = (value: TodayDuty['total']) => t(value.key, value.values);

    return {
      kicker: t('danas.duty.kicker', { total: duration(duty.total) }),
      headline: t(dutyHeadlineMessageKey(duty.phase), { time: duty.end.time }),
      endLine:
        duty.phase === 'done'
          ? null
          : t(dutyEndLineMessageKey(duty.phase), {
              weekday: endLinePointOf(duty).weekday,
              date: endLinePointOf(duty).dayMonth,
              duration: duration(duty.remaining),
              time: duty.start.time,
            }),
      progress: t('danas.duty.progress', { done: duration(duty.elapsed), total: duration(duty.total) }),
      span: [duty.start, duty.end].map((point) => t('danas.duty.moment', { date: point.dayMonth, time: point.time })),
      legs: duty.legs.map(
        (leg) =>
          `${t(dutyLegStateMessageKey(leg.state))} ${leg.name} ${leg.range ?? ''} ${noteText(leg.note)}`,
      ),
    };
  }

  /** The viewer on Smjena A, taking over Lea's Dan on Smjena D on 01.10., then their own Noć. */
  let takenOver: CalendarSnapshot;

  beforeAll(async () => {
    takenOver = await snapshotOf({
      members: MEMBERS,
      others: OTHERS,
      roster: [calendarRosterOverrideRow('roster-1', TEAM_D, '2026-10-01', LEA, VIEWER_MEMBER)],
    });
  });

  it('runs at 21:10: do 07:00, what remains, 14 h 10 min od 24 h, Dan done and Noć running', () => {
    const view = readyOf(todayViewOf(takenOver, [], zagrebOf('2026-10-01', '21:10')));
    const duty = dutyOf(view);

    expect(duty).toMatchObject({ phase: 'running', totalMinutes: 1440, elapsedMinutes: 850 });
    expect(linesOf(duty)).toEqual({
      kicker: 'Na dužnosti · 24 h bez pauze',
      headline: 'do 07:00',
      endLine: 'petak, 02.10. · još 9 h 50 min',
      progress: '14 h 10 min od 24 h',
      span: ['01.10. 07:00', '02.10. 07:00'],
      legs: [
        'Odrađeno Dan 07:00–19:00 zamjena za Lea Bašić (Smjena D)',
        'U tijeku Noć 19:00–07:00 tvoja smjena · Smjena A',
      ],
    });
    expect(duty.legs.map((leg) => leg.note.kind)).toEqual([NOTE_REPLACING, NOTE_OWN]);
  });

  it('is still the duty past midnight, on a free day, not Danas ne radiš', () => {
    const view = readyOf(todayViewOf(takenOver, [], zagrebOf('2026-10-02', '03:00')));

    expect(view.today.date).toBe('2026-10-02');
    expect(linesOf(dutyOf(view))).toMatchObject({ headline: 'do 07:00', progress: '20 h od 24 h' });
  });

  it('is upcoming before 07:00: počinje u 07:00, nothing done, both Slijedi', () => {
    const duty = dutyOf(readyOf(todayViewOf(takenOver, [], zagrebOf('2026-10-01', '06:00'))));

    expect(duty).toMatchObject({ phase: 'upcoming', elapsedMinutes: 0 });
    expect(linesOf(duty)).toMatchObject({
      headline: 'do 07:00',
      endLine: 'četvrtak, 01.10. · počinje u 07:00',
      progress: '0 h od 24 h',
    });
    expect(duty.legs.map((leg) => leg.state)).toEqual(['upcoming', 'upcoming']);
  });

  it('is done once ended: Završeno u 19:00, all of it, both Odrađeno', async () => {
    // On Smjena B: Noć on 30.09.; then Dan on Smjena D on 01.10., added.
    const snapshot = await snapshotOf({
      versions: [membershipRow(TEAM_B, SEEDED)],
      roster: [calendarRosterOverrideRow('roster-1', TEAM_D, '2026-10-01', null, VIEWER_MEMBER)],
    });
    const duty = dutyOf(readyOf(todayViewOf(snapshot, [], zagrebOf('2026-10-01', '20:00'))));

    expect(duty).toMatchObject({ phase: 'done', elapsedMinutes: 1440 });
    expect(linesOf(duty)).toMatchObject({ headline: 'Završeno u 19:00', endLine: null, progress: '24 h od 24 h' });
    expect(linesOf(duty).legs).toEqual([
      'Odrađeno Noć 19:00–07:00 tvoja smjena · Smjena B',
      'Odrađeno Dan 07:00–19:00 dodatna smjena · Smjena D',
    ]);
    expect(duty.legs.map((leg) => leg.note.kind)).toEqual([NOTE_OWN, NOTE_ADDED]);
  });

  it('is no duty over a gap: a working case of two rows (Dan 07–19, Noć 20–08)', async () => {
    const snapshot = await snapshotOf({
      roster: [calendarRosterOverrideRow('roster-1', TEAM_D, '2026-10-01', null, VIEWER_MEMBER)],
      rows: {
        ...PILOT,
        types: [
          PILOT.types[0] ?? {},
          typeRow('pilot-noc', 'Noć', '2026-09-25T20:07:49.331741+00:00', { times: ['20:00:00', '08:00:00'] }),
          ...PILOT.types.slice(2),
        ],
      },
    });
    const view = readyOf(todayViewOf(snapshot, [], zagrebOf('2026-10-01', '21:10')));

    expect(view.todayCase.kind).toBe(CASE_WORKING);
  });

  it('is no duty over an overlap: two Dan 07–19 on one date', async () => {
    // Smjena B's Noć on 30.09. made a Dan, and the viewer put on it beside their own Dan.
    const snapshot = await snapshotOf({
      overrides: [calendarOverrideRow('override-1', TEAM_B, '2026-09-30', 'pilot-dan')],
      roster: [calendarRosterOverrideRow('roster-1', TEAM_B, '2026-09-30', null, VIEWER_MEMBER)],
    });
    const view = readyOf(todayViewOf(snapshot, [], zagrebOf('2026-09-30', '12:00')));

    expect(view.todayCase).toMatchObject({
      kind: CASE_WORKING,
      shifts: [
        { teamId: TEAM_A, name: 'Dan' },
        { teamId: TEAM_B, name: 'Dan' },
      ],
    });
  });

  it('is the working case for a single overnight shift, as in 6.1a, and still is after midnight while it runs', () => {
    expect(readyOf(todayViewOf(pilot, [], zagrebOf('2026-10-01', '21:10'))).todayCase.kind).toBe(CASE_WORKING);
    expect(readyOf(todayViewOf(pilot, [], zagrebOf('2026-10-02', '03:00'))).todayCase.kind).toBe(CASE_WORKING);
  });

  it('gives way to leave today, and drops a leg on a date leave covers', () => {
    const today = readyOf(todayViewOf(takenOver, [rowOf('leave-1', '2026-10-01', '2026-10-02')], zagrebOf('2026-10-01', '21:10')));

    expect(today.todayCase.kind).toBe(CASE_LEAVE);

    // On leave on 30.09.: its Dan is no leg, and 01.10.'s Dan and Noć stay a duty.
    const before = readyOf(
      todayViewOf(takenOver, [rowOf('leave-1', '2026-09-30', '2026-10-01')], zagrebOf('2026-10-01', '21:10')),
    );

    expect(dutyOf(before).legs).toHaveLength(2);
  });

  it('widens the window while the duty touches its edge: 48 h over 30.09. and 01.10.', async () => {
    // Own Dan 30.09., Smjena B's Noć 30.09., Smjena D's Dan 01.10., own Noć 01.10.
    const snapshot = await snapshotOf({
      members: MEMBERS,
      others: OTHERS,
      roster: [
        calendarRosterOverrideRow('roster-1', TEAM_B, '2026-09-30', null, VIEWER_MEMBER),
        calendarRosterOverrideRow('roster-2', TEAM_D, '2026-10-01', LEA, VIEWER_MEMBER),
      ],
    });
    const duty = dutyOf(readyOf(todayViewOf(snapshot, [], zagrebOf('2026-10-02', '03:00'))));

    expect(duty.totalMinutes).toBe(48 * 60);
    expect(linesOf(duty)).toMatchObject({ kicker: 'Na dužnosti · 48 h bez pauze', span: ['30.09. 07:00', '02.10. 07:00'] });
    expect(duty.legs.map((leg) => leg.state)).toEqual(['done', 'done', 'done', 'running']);
  });

  it("skips every leg of today's duty for the next shift (Noć 01.10. + Dan 02.10.)", async () => {
    const snapshot = await snapshotOf({
      roster: [calendarRosterOverrideRow('roster-1', TEAM_C, '2026-10-02', null, VIEWER_MEMBER)],
    });
    const view = readyOf(todayViewOf(snapshot, [], noonOf('2026-10-01')));

    expect(dutyOf(view).legs.map((leg) => leg.name)).toEqual(['Noć', 'Dan']);
    // Smjena A's next Dan, on 04.10.: never 02.10.'s Dan, a leg of today's duty.
    expect(view.next).toMatchObject({ date: '2026-10-04', inDays: 3, name: 'Dan' });
  });

  it('keeps the week as the calendar lists it: both shifts on their own dates', async () => {
    const snapshot = await snapshotOf({
      roster: [calendarRosterOverrideRow('roster-1', TEAM_C, '2026-10-02', null, VIEWER_MEMBER)],
    });
    const view = readyOf(todayViewOf(snapshot, [], noonOf('2026-10-01')));

    expect(view.week[0]?.day.shifts.map((shift) => shift.cell.name)).toEqual(['Slobodno', 'Dan']);
  });

  it('prefers a duty still to come today over one that ended this morning', async () => {
    // On Smjena B: Noć 30.09. and Jutro 07–11 on 01.10. (done by noon); then
    // Popodne 13–19 on Smjena D and Noć on Smjena A on 01.10. (still to come).
    const snapshot = await snapshotOf({
      versions: [membershipRow(TEAM_B, SEEDED)],
      rows: {
        ...PILOT,
        types: [
          ...PILOT.types,
          typeRow('pilot-jutro', 'Jutro', '2026-09-25T20:07:49.333741+00:00', { times: ['07:00:00', '11:00:00'] }),
          typeRow('pilot-popodne', 'Popodne', '2026-09-25T20:07:49.334741+00:00', { times: ['13:00:00', '19:00:00'] }),
        ],
      },
      overrides: [
        calendarOverrideRow('override-1', TEAM_B, '2026-10-01', 'pilot-jutro'),
        calendarOverrideRow('override-2', TEAM_D, '2026-10-01', 'pilot-popodne'),
      ],
      roster: [
        calendarRosterOverrideRow('roster-1', TEAM_D, '2026-10-01', null, VIEWER_MEMBER),
        calendarRosterOverrideRow('roster-2', TEAM_A, '2026-10-01', null, VIEWER_MEMBER),
      ],
    });
    const duty = dutyOf(readyOf(todayViewOf(snapshot, [], zagrebOf('2026-10-01', '12:00'))));

    expect(duty.phase).toBe('upcoming');
    expect(duty.legs.map((leg) => leg.name)).toEqual(['Popodne', 'Noć']);
    expect(linesOf(duty)).toMatchObject({ headline: 'do 07:00', endLine: 'četvrtak, 01.10. · počinje u 13:00' });

    // The morning's duty is still today's when it is the only one left to show.
    const morning = dutyOf(readyOf(todayViewOf({ ...snapshot, rosterOverrides: [] }, [], zagrebOf('2026-10-01', '12:00'))));

    expect(morning).toMatchObject({ phase: 'done' });
    expect(morning.legs.map((leg) => leg.name)).toEqual(['Noć', 'Jutro']);
  });

  it('reads a replacement whose member the snapshot does not name as an added shift, never a blank Danas', () => {
    const view = readyOf(todayViewOf(takenOver, [], zagrebOf('2026-10-01', '21:10')));
    const [taken] = calendarDayListOf(takenOver, takenOver.viewer, '2026-10', '2026-10-01', NO_MARKS)
      ?.find((day) => day.date === '2026-10-01')
      ?.shifts.filter((candidate) => candidate.viaOverride) ?? [];

    if (taken === undefined) throw new Error('the taken-over shift is missing');

    expect(dutyOf(view).legs[0]?.note).toEqual({ kind: NOTE_REPLACING, team: 'Smjena D', member: 'Lea Bašić' });

    const unnamed: CalendarSnapshot = { ...takenOver, members: takenOver.members.filter((member) => member.id !== LEA) };

    expect(legNoteOf(unnamed, { date: '2026-10-01', shift: taken })).toEqual({ kind: NOTE_ADDED, team: 'Smjena D' });
  });

  it('joins no leg on a date own leave covers (Noć 01.10. + Dan 02.10., leave on 02.10.)', async () => {
    const snapshot = await snapshotOf({
      roster: [calendarRosterOverrideRow('roster-1', TEAM_C, '2026-10-02', null, VIEWER_MEMBER)],
    });
    const view = readyOf(todayViewOf(snapshot, [rowOf('leave-1', '2026-10-02', '2026-10-03')], noonOf('2026-10-01')));

    expect(view.todayCase).toEqual({
      kind: CASE_WORKING,
      shifts: [{ teamId: TEAM_A, teamName: 'Smjena A', name: 'Noć', range: '19:00–07:00', fromYesterday: false }],
    });
  });

  it('widens back past yesterday for a leg of yesterday running now (Noć 01.10. + 24 h from 02.10. 07:00, at 03.10. 03:00)', async () => {
    // Smjena A's Slobodno on 02.10. made a 24 h type: yesterday's only leg,
    // running now, joined to the Noć dated the day before it.
    const snapshot = await snapshotOf({
      rows: {
        ...PILOT,
        types: [
          ...PILOT.types,
          typeRow('pilot-24', 'Dežurstvo', '2026-09-25T20:07:49.333741+00:00', { times: ['07:00:00', '07:00:00'] }),
        ],
      },
      overrides: [calendarOverrideRow('override-1', TEAM_A, '2026-10-02', 'pilot-24')],
    });
    const duty = dutyOf(readyOf(todayViewOf(snapshot, [], zagrebOf('2026-10-03', '03:00'))));

    expect(duty).toMatchObject({ phase: 'running', totalMinutes: 36 * 60 });
    expect(linesOf(duty).span).toEqual(['01.10. 19:00', '03.10. 07:00']);
    expect(duty.legs.map((leg) => leg.name)).toEqual(['Noć', 'Dežurstvo']);
  });

  it('widens forward past tomorrow for a duty that runs on (to 02.10. 19:00, read on 30.09.)', async () => {
    // Own Dan 30.09., Smjena B's Noć 30.09., Smjena D's Dan 01.10., own Noć 01.10., Smjena C's Dan 02.10.
    const snapshot = await snapshotOf({
      roster: [
        calendarRosterOverrideRow('roster-1', TEAM_B, '2026-09-30', null, VIEWER_MEMBER),
        calendarRosterOverrideRow('roster-2', TEAM_D, '2026-10-01', null, VIEWER_MEMBER),
        calendarRosterOverrideRow('roster-3', TEAM_C, '2026-10-02', null, VIEWER_MEMBER),
      ],
    });
    const duty = dutyOf(readyOf(todayViewOf(snapshot, [], noonOf('2026-09-30'))));

    expect(duty.totalMinutes).toBe(60 * 60);
    expect(linesOf(duty)).toMatchObject({ headline: 'do 19:00', span: ['30.09. 07:00', '02.10. 19:00'] });
    expect(duty.legs).toHaveLength(5);
  });

  it('is unavailable, logged, when a type’s version breaks a precondition', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: CalendarSnapshot = {
      ...takenOver,
      types: takenOver.types.map((type) =>
        type.id === 'pilot-noc' && type.versions[0] !== undefined
          ? { ...type, versions: [type.versions[0], { ...type.versions[0], startMinute: 1440 }] }
          : type,
      ),
    };

    expect(todayViewOf(broken, [], zagrebOf('2026-10-01', '21:10'))).toEqual({ kind: TODAY_UNAVAILABLE, retryable: false });
    expect(logged).toHaveBeenCalledWith(TODAY_UNAVAILABLE, expect.any(RangeError));
  });

  describe('a shift from yesterday still running (the lone-Noć carry-over)', () => {
    const NOC_FROM_YESTERDAY = {
      teamId: TEAM_A,
      teamName: 'Smjena A',
      name: 'Noć',
      range: '19:00–07:00',
      fromYesterday: true,
    } as const;

    it('Lone Noć, free today: at 02.10. 03:00 the Noć of 01.10. is today’s working case, od jučer', () => {
      const view = readyOf(todayViewOf(pilot, [], zagrebOf('2026-10-02', '03:00')));

      expect(view.todayCase).toEqual({ kind: CASE_WORKING, shifts: [NOC_FROM_YESTERDAY] });
      expect(caseSentenceOf(view)).toBe('Danas radiš');
      expect(t('danas.today.fromYesterday')).toBe('od jučer');
      expect(view.returning).toBe(false);
      // Smjena A's next Dan, on 04.10.
      expect(view.next).toMatchObject({ date: '2026-10-04', inDays: 2, name: 'Dan' });
    });

    it('Same, ended: at 07:00 the Noć is over, and today is free as before', () => {
      const view = readyOf(todayViewOf(pilot, [], zagrebOf('2026-10-02', '07:00')));

      expect(view.todayCase).toEqual({
        kind: CASE_FREE,
        shift: { teamId: TEAM_A, teamName: 'Smjena A', name: 'Slobodno', range: null, fromYesterday: false },
      });
      // One minute before, it still runs.
      expect(readyOf(todayViewOf(pilot, [], zagrebOf('2026-10-02', '06:59'))).todayCase.kind).toBe(CASE_WORKING);
    });

    it('Leave from today: the Noć of 05.10. only, not returning, and the next shift the first after the leave', () => {
      const rows = [rowOf('leave-1', '2026-10-06', '2026-10-09')];
      const view = readyOf(todayViewOf(pilot, rows, zagrebOf('2026-10-06', '03:00')));

      expect(view.todayCase).toEqual({ kind: CASE_WORKING, shifts: [NOC_FROM_YESTERDAY] });
      expect(view.returning).toBe(false);
      // 06.10.–08.10. on leave (08.10.'s Dan with it); 09.10. is a Noć.
      expect(view.next).toMatchObject({ date: '2026-10-09', inDays: 3, name: 'Noć' });
    });

    it('Leave from today, at the boundary: 06:59 still the carried Noć, 07:00 the leave case', () => {
      const rows = [rowOf('leave-1', '2026-10-06', '2026-10-09')];

      expect(readyOf(todayViewOf(pilot, rows, zagrebOf('2026-10-06', '06:59'))).todayCase).toEqual({
        kind: CASE_WORKING,
        shifts: [NOC_FROM_YESTERDAY],
      });
      expect(readyOf(todayViewOf(pilot, rows, zagrebOf('2026-10-06', '07:00'))).todayCase).toEqual({
        kind: CASE_LEAVE,
        from: '06.10.2026',
        to: '08.10.2026',
        costDays: 1,
      });
    });

    it('A duty begun yesterday still running on the first day of leave: the duty, then the leave once it ends', () => {
      const rows = [rowOf('leave-1', '2026-10-02', '2026-10-04')];
      const running = readyOf(todayViewOf(takenOver, rows, zagrebOf('2026-10-02', '03:00')));

      expect(dutyOf(running)).toMatchObject({ phase: 'running', totalMinutes: 1440 });
      expect(running.returning).toBe(false);

      const ended = readyOf(todayViewOf(takenOver, rows, zagrebOf('2026-10-02', '07:00')));

      // 02.10. and 03.10. are Smjena A's Slobodno pair: the leave costs nothing.
      expect(ended.todayCase).toEqual({ kind: CASE_LEAVE, from: '02.10.2026', to: '03.10.2026', costDays: 0 });
      expect(ended.returning).toBe(true);
    });

    it('Same, ended: at 07:30 the leave case, with its range and cost, as before', () => {
      const rows = [rowOf('leave-1', '2026-10-06', '2026-10-09')];
      const view = readyOf(todayViewOf(pilot, rows, zagrebOf('2026-10-06', '07:30')));

      // 08.10.'s Dan is the only working day it covers.
      expect(view.todayCase).toEqual({ kind: CASE_LEAVE, from: '06.10.2026', to: '08.10.2026', costDays: 1 });
      expect(view.returning).toBe(true);
    });

    it('hides today’s own shifts on a day of leave: only the carried-over shift is listed', async () => {
      // Leave on 02.10., where a roster override put the viewer on Smjena D's Noć.
      const snapshot = await snapshotOf({
        roster: [calendarRosterOverrideRow('roster-1', TEAM_D, '2026-10-02', null, VIEWER_MEMBER)],
      });
      const view = readyOf(todayViewOf(snapshot, [rowOf('leave-1', '2026-10-02', '2026-10-03')], zagrebOf('2026-10-02', '03:00')));

      expect(view.todayCase).toEqual({ kind: CASE_WORKING, shifts: [NOC_FROM_YESTERDAY] });
    });

    it('Yesterday on leave: no carry-over, and today is free as before', () => {
      const view = readyOf(todayViewOf(pilot, [rowOf('leave-1', '2026-10-01', '2026-10-02')], zagrebOf('2026-10-02', '03:00')));

      expect(view.todayCase).toMatchObject({ kind: CASE_FREE, shift: { name: 'Slobodno' } });
    });

    it('Noć, then Noć tonight: the carried Noć first, then tonight’s', async () => {
      // Smjena D works Noć on 02.10.; the gap 07:00–19:00 keeps the two apart.
      const snapshot = await snapshotOf({
        roster: [calendarRosterOverrideRow('roster-1', TEAM_D, '2026-10-02', null, VIEWER_MEMBER)],
      });
      const view = readyOf(todayViewOf(snapshot, [], zagrebOf('2026-10-02', '03:00')));

      expect(view.todayCase).toEqual({
        kind: CASE_WORKING,
        shifts: [
          NOC_FROM_YESTERDAY,
          { teamId: TEAM_D, teamName: 'Smjena D', name: 'Noć', range: '19:00–07:00', fromYesterday: false },
        ],
      });
      // Tonight's Noć is today's, never the next shift.
      expect(view.next).toMatchObject({ date: '2026-10-04', name: 'Dan' });
    });

    it('Carry-over beats an upcoming duty with a leg dated tomorrow, which is never the next shift', async () => {
      // 02.10.: Dug 08–20 on Smjena A and Kasni 20–08 on Smjena D; 03.10.: Dug 08–20 on
      // Smjena A again, touching the Kasni — one duty from 02.10. 08:00 to 03.10. 20:00.
      const snapshot = await snapshotOf({
        rows: {
          ...PILOT,
          types: [
            ...PILOT.types,
            typeRow('pilot-dug', 'Dug', '2026-09-25T20:07:49.333741+00:00', { times: ['08:00:00', '20:00:00'] }),
            typeRow('pilot-kasni', 'Kasni', '2026-09-25T20:07:49.334741+00:00', { times: ['20:00:00', '08:00:00'] }),
          ],
        },
        overrides: [
          calendarOverrideRow('override-1', TEAM_A, '2026-10-02', 'pilot-dug'),
          calendarOverrideRow('override-2', TEAM_D, '2026-10-02', 'pilot-kasni'),
          calendarOverrideRow('override-3', TEAM_A, '2026-10-03', 'pilot-dug'),
        ],
        roster: [calendarRosterOverrideRow('roster-1', TEAM_D, '2026-10-02', null, VIEWER_MEMBER)],
      });
      const before = readyOf(todayViewOf(snapshot, [], zagrebOf('2026-10-02', '03:00')));

      expect(before.todayCase).toMatchObject({ kind: CASE_WORKING, shifts: [NOC_FROM_YESTERDAY, { name: 'Dug' }, { name: 'Kasni' }] });
      // Never 03.10.'s Dug, a leg of today's duty: Smjena A's Dan on 04.10.
      expect(before.next).toMatchObject({ date: '2026-10-04', name: 'Dan' });

      const after = readyOf(todayViewOf(snapshot, [], zagrebOf('2026-10-02', '07:30')));

      expect(dutyOf(after).legs.map((leg) => leg.name)).toEqual(['Dug', 'Kasni', 'Dug']);
      expect(after.next).toEqual(before.next);
    });

    it('Joined duty: a Dan and a Noć that touch stay the duty-block, unchanged', () => {
      const view = readyOf(todayViewOf(takenOver, [], zagrebOf('2026-10-02', '03:00')));

      expect(view.todayCase.kind).toBe(CASE_DUTY);
      expect(dutyOf(view)).toMatchObject({ phase: 'running', totalMinutes: 1440 });
    });

    it('Carry-over beats an upcoming duty: the carried Noć, then today’s shifts as rows', async () => {
      // Smjena A's Slobodno on 02.10. made a Dug 08–20, and Smjena D's shift a
      // Kasni 20–08 the viewer is put on: a duty from 08:00, an hour after the Noć.
      const snapshot = await snapshotOf({
        rows: {
          ...PILOT,
          types: [
            ...PILOT.types,
            typeRow('pilot-dug', 'Dug', '2026-09-25T20:07:49.333741+00:00', { times: ['08:00:00', '20:00:00'] }),
            typeRow('pilot-kasni', 'Kasni', '2026-09-25T20:07:49.334741+00:00', { times: ['20:00:00', '08:00:00'] }),
          ],
        },
        overrides: [
          calendarOverrideRow('override-1', TEAM_A, '2026-10-02', 'pilot-dug'),
          calendarOverrideRow('override-2', TEAM_D, '2026-10-02', 'pilot-kasni'),
        ],
        roster: [calendarRosterOverrideRow('roster-1', TEAM_D, '2026-10-02', null, VIEWER_MEMBER)],
      });
      const view = readyOf(todayViewOf(snapshot, [], zagrebOf('2026-10-02', '03:00')));

      expect(view.todayCase).toEqual({
        kind: CASE_WORKING,
        shifts: [
          NOC_FROM_YESTERDAY,
          { teamId: TEAM_A, teamName: 'Smjena A', name: 'Dug', range: '08:00–20:00', fromYesterday: false },
          { teamId: TEAM_D, teamName: 'Smjena D', name: 'Kasni', range: '20:00–08:00', fromYesterday: false },
        ],
      });

      // Today's duty is rows here, but its legs stay today's: Smjena A's Dan on 04.10. is next.
      expect(view.next).toMatchObject({ date: '2026-10-04', name: 'Dan' });

      // Once the Noć ends, the duty is today's again.
      const later = readyOf(todayViewOf(snapshot, [], zagrebOf('2026-10-02', '07:30')));

      expect(dutyOf(later)).toMatchObject({ phase: 'upcoming' });
      expect(dutyOf(later).legs.map((leg) => leg.name)).toEqual(['Dug', 'Kasni']);
    });
  });

  it('words every state, headline and note by its own key', () => {
    expect((['done', 'running', 'upcoming'] as const).map((state) => t(dutyLegStateMessageKey(state)))).toEqual([
      'Odrađeno',
      'U tijeku',
      'Slijedi',
    ]);
    expect(dutyHeadlineMessageKey('upcoming')).toBe('danas.duty.until');
    expect(dutyHeadlineMessageKey('running')).toBe('danas.duty.until');
    expect(dutyHeadlineMessageKey('done')).toBe('danas.duty.ended');
    expect(dutyEndLineMessageKey('running')).toBe('danas.duty.remaining');
    expect(dutyEndLineMessageKey('upcoming')).toBe('danas.duty.startsAt');
    expect(([NOTE_OWN, NOTE_REPLACING, NOTE_ADDED] as const).map((kind) => dutyNoteMessageKey(kind))).toEqual([
      'danas.duty.noteOwn',
      'danas.duty.noteReplacing',
      'danas.duty.noteAdded',
    ]);
  });
});
