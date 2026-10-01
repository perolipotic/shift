import { collisionsOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  MARKS_LOADING,
  MARKS_READY,
  MARKS_UNAVAILABLE,
  calendarMarksOf,
  calendarMarksStateOf,
  calendarRefusalOf,
} from '@/features/calendar/services/marks';
import { CALENDAR_UNAVAILABLE, readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  cellLabelOf,
  gridCellLabelsOf,
  legendOf,
  modifierMessageKey,
  modifierTreatmentOf,
  type CellLabelTranslate,
} from '@/features/calendar/utils/modifiers';
import {
  calendarMonthOf,
  type CalendarCell,
  type CalendarDay,
  type CalendarMonth,
} from '@/features/calendar/utils/month';
import { collisionInputOf } from '@/features/conflicts/services/conflicts-queue';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  UJ5,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
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
 * Story 5.3c's marks, executed (AD-15): every row of the spec's matrix but
 * the removed record and the failed read (the e2e spec's), over the calendar
 * month as `calendarMonthOf` builds it — the grid, the viewer's own day list
 * and the person shown — with the marks `calendarMarksOf` derives. Each
 * admin mark is checked against `collisionsOf` itself, through *Raspored*'s
 * own recipe, so the calendar marks exactly what the queue lists.
 */

const ANA = '00000000-0000-4000-8000-0000000000c1';
const SEPTEMBER = { mjesec: '2026-09' };
const TODAY = '2026-09-01';

type Row = Record<string, unknown>;
type Role = 'admin' | 'member_role';

const translate: CellLabelTranslate = (key) => t(key);

function teamOf(rows: FixtureRows, index: number): string {
  const id = rows.teams[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no team ${String(index)}`);

  return id;
}

/** The viewer on the first team, Ana on the second, each since the fixture's seeding. */
async function snapshotOf(
  rows: FixtureRows,
  {
    role = 'admin' as Role,
    rosterOverrides = [] as readonly Row[],
    overrides = [] as readonly Row[],
    since = SEEDED,
  } = {},
): Promise<CalendarSnapshot> {
  const [a, b] = [teamOf(rows, 0), teamOf(rows, 1)];
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow([membershipRow(a, since)], { role })],
          versions: [memberMembershipRow(VIEWER_MEMBER, a, since), memberMembershipRow(ANA, b, SEEDED)],
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
const WORKED_DATES = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'];
const COLLIDING_DATES = ['2026-09-10', '2026-09-11', '2026-09-14'];

function monthOf(snapshot: CalendarSnapshot, rows: readonly Row[], search: Record<string, string> = SEPTEMBER): CalendarMonth {
  return calendarMonthOf(snapshot, search, TODAY, calendarMarksOf(snapshot, rows));
}

/** The grid cell of `teamId` on `date`. */
function gridCellOf(month: CalendarMonth, teamId: string, date: string): CalendarCell {
  const cell = month.rows.find((row) => row.date === date)?.cells.find((one) => one.teamId === teamId);

  if (cell === undefined) throw new Error(`no cell of ${teamId} on ${date}`);

  return cell;
}

function daysOf(outcome: CalendarMonth['days']): readonly CalendarDay[] {
  if (!outcome.ok || outcome.days === null) throw new Error('no day list');

  return outcome.days;
}

/** The marks of each date's shifts in a day list, by date, for the dates given. */
function dayMarksOf(days: readonly CalendarDay[], dates: readonly string[]): Record<string, readonly (readonly string[])[]> {
  return Object.fromEntries(
    dates.map((date) => [date, days.find((day) => day.date === date)?.shifts.map((shift) => shift.cell.modifiers) ?? []]),
  );
}

let pilot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf(PILOT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the worked example, on the admin grid', () => {
  it("marks the team's 10, 11 and 14 with conflict and leave, and 12 and 13 with nothing", () => {
    const month = monthOf(pilot, [WORKED]);
    const a = teamOf(PILOT, 0);

    expect(Object.fromEntries(WORKED_DATES.map((date) => [date, gridCellOf(month, a, date).modifiers]))).toEqual({
      '2026-09-10': ['conflict', 'leave'],
      '2026-09-11': ['conflict', 'leave'],
      '2026-09-12': [],
      '2026-09-13': [],
      '2026-09-14': ['conflict', 'leave'],
    });
    // Nothing else in the month carries a mark.
    const marked = month.rows.flatMap((row) =>
      row.cells.filter((cell) => cell.modifiers.length > 0).map((cell) => [cell.teamId, row.date]),
    );

    expect(marked).toEqual(COLLIDING_DATES.map((date) => [a, date]));
  });

  it('draws ⚠, the ring and the hatch, and the legend shows Konflikt and Godišnji', () => {
    const month = monthOf(pilot, [WORKED]);
    const treatment = modifierTreatmentOf(gridCellOf(month, teamOf(PILOT, 0), '2026-09-10').modifiers);

    expect(treatment.className).toBe('modifier-ring-conflict modifier-hatch-leave');
    expect(treatment.glyphText).toBe('⚠');
    expect(treatment.glyphs).toHaveLength(2);
    expect(legendOf(month.rows.flatMap((row) => row.cells)).map((modifier) => translate(modifierMessageKey(modifier)))).toEqual([
      'Konflikt',
      'Godišnji',
    ]);
  });

  it("names each mark in the cell's label", () => {
    const month = monthOf(pilot, [WORKED]);
    const labels = gridCellLabelsOf(month, translate);
    const row = month.rows.findIndex((one) => one.date === '2026-09-10');

    expect(labels[row]?.[0]).toBe('četvrtak 10.09., Smjena A, Dan, 07:00–19:00, Konflikt, Godišnji');
  });

  it.each([
    ['the pilot', PILOT],
    ['UJ5', UJ5],
  ])("marks exactly the domain's collisions over %s, by team and date", async (_name, rows) => {
    const snapshot = await snapshotOf(rows);
    const leave = [WORKED, rowOf('record-ana', '2026-09-01', '2026-09-08', ANA)];
    const records = organizationLeaveRecordsOf(
      leave,
      snapshot.members.map((member) => member.id),
    );

    if (records === null) throw new Error('rows refused');

    const domain = collisionsOf(collisionInputOf(snapshot, records));
    const month = monthOf(snapshot, leave);
    const marked = month.rows.flatMap((row) =>
      row.cells.filter((cell) => cell.modifiers.includes('conflict')).map((cell) => `${cell.teamId}|${row.date}`),
    );

    expect(domain.length).toBeGreaterThan(0);
    expect(new Set(marked)).toEqual(new Set(domain.map((collision) => `${collision.teamId}|${collision.date}`)));
  });
});

describe("the admin's member-centric views", () => {
  it('hatches 10–14 on the person shown, 12 and 13 too, and adds ⚠ on 10, 11 and 14', () => {
    const month = monthOf(pilot, [WORKED], { ...SEPTEMBER, osoba: VIEWER_MEMBER });

    if (month.person === null) throw new Error('no person shown');

    expect(dayMarksOf(daysOf(month.person.days), WORKED_DATES)).toEqual({
      '2026-09-10': [['conflict', 'leave']],
      '2026-09-11': [['conflict', 'leave']],
      '2026-09-12': [['leave']],
      '2026-09-13': [['leave']],
      '2026-09-14': [['conflict', 'leave']],
    });
  });

  it("marks the admin's own Moj list the same way", () => {
    const month = monthOf(pilot, [WORKED]);

    expect(dayMarksOf(daysOf(month.days), [...WORKED_DATES, '2026-09-15'])).toEqual({
      '2026-09-10': [['conflict', 'leave']],
      '2026-09-11': [['conflict', 'leave']],
      '2026-09-12': [['leave']],
      '2026-09-13': [['leave']],
      '2026-09-14': [['conflict', 'leave']],
      '2026-09-15': [[]],
    });
  });

  it("marks another member's person view with their leave alone, never the viewer's", () => {
    const month = monthOf(pilot, [WORKED], { ...SEPTEMBER, osoba: ANA });

    if (month.person === null) throw new Error('no person shown');

    expect(daysOf(month.person.days).flatMap((day) => day.shifts.flatMap((shift) => shift.cell.modifiers))).toEqual([]);
  });

  it("names the marks in the day list's label", () => {
    const month = monthOf(pilot, [WORKED]);
    const day = daysOf(month.days).find((one) => one.date === '2026-09-12');
    const shift = day?.shifts[0];

    if (day === undefined || shift === undefined) throw new Error('no 12.09');

    expect(
      cellLabelOf(
        {
          weekday: day.weekday,
          dayMonth: day.dayMonth,
          teamName: 'Smjena A',
          name: shift.cell.name,
          range: shift.cell.range,
          modifiers: shift.cell.modifiers,
        },
        translate,
      ),
    ).toBe('subota 12.09., Smjena A, Slobodno, Godišnji');
  });
});

describe('two teams on one date', () => {
  it("marks both teams' cells when a roster override puts the member on a second team", async () => {
    const b = teamOf(PILOT, 1);
    const snapshot = await snapshotOf(PILOT, {
      rosterOverrides: [calendarRosterOverrideRow('put-on', b, '2026-09-10', null, VIEWER_MEMBER)],
    });
    const month = monthOf(snapshot, [WORKED]);

    expect(gridCellOf(month, teamOf(PILOT, 0), '2026-09-10').modifiers).toEqual(['conflict', 'leave']);
    // Team B's cell: overridden by the roster change, and colliding.
    expect(gridCellOf(month, b, '2026-09-10').modifiers).toEqual(['conflict', 'overridden', 'leave']);
    expect(dayMarksOf(daysOf(month.days), ['2026-09-10'])).toEqual({
      '2026-09-10': [
        ['conflict', 'leave'],
        ['conflict', 'overridden', 'leave'],
      ],
    });
  });
});

describe('an overridden cell that collides', () => {
  it('nests the rings and carries ⚠ and ✎, both named', async () => {
    const a = teamOf(PILOT, 0);
    // 12.09 Slobodno becomes Dan: a working shift on leave.
    const snapshot = await snapshotOf(PILOT, {
      overrides: [calendarOverrideRow('worked', a, '2026-09-12', 'pilot-dan')],
    });
    const month = monthOf(snapshot, [WORKED]);
    const cell = gridCellOf(month, a, '2026-09-12');
    const treatment = modifierTreatmentOf(cell.modifiers);
    const row = month.rows.findIndex((one) => one.date === '2026-09-12');

    expect(cell.modifiers).toEqual(['conflict', 'overridden', 'leave']);
    expect(treatment.className).toBe('modifier-ring-conflict-overridden modifier-hatch-leave');
    expect(treatment.glyphText).toBe('⚠✎');
    expect(gridCellLabelsOf(month, translate)[row]?.[0]).toBe(
      'subota 12.09., Smjena A, Dan, 07:00–19:00, Konflikt, Izmijenjeno, Godišnji',
    );
  });
});

describe('a member', () => {
  let member: CalendarSnapshot;

  beforeAll(async () => {
    member = await snapshotOf(PILOT, { role: 'member_role' });
  });

  it('hatches their own Moj list on every leave date, with no ⚠', () => {
    const month = monthOf(member, [WORKED]);

    expect(dayMarksOf(daysOf(month.days), WORKED_DATES)).toEqual({
      '2026-09-10': [['leave']],
      '2026-09-11': [['leave']],
      '2026-09-12': [['leave']],
      '2026-09-13': [['leave']],
      '2026-09-14': [['leave']],
    });
  });

  it('hatches their own person view the same way', () => {
    const month = monthOf(member, [WORKED], { ...SEPTEMBER, osoba: VIEWER_MEMBER });

    if (month.person === null) throw new Error('no person shown');

    expect(daysOf(month.person.days).flatMap((day) => day.shifts.flatMap((shift) => shift.cell.modifiers))).toEqual(
      WORKED_DATES.map(() => 'leave'),
    );
  });

  it('sees nothing new on the Sve grid', () => {
    const month = monthOf(member, [WORKED]);

    expect(month.rows.flatMap((row) => row.cells.flatMap((cell) => cell.modifiers))).toEqual([]);
    expect(legendOf(month.rows.flatMap((row) => row.cells))).toEqual([]);
  });

  it("sees nothing of a teammate's leave: a row of anybody else refuses the whole read", () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => calendarMarksOf(member, [rowOf('record-ana', '2026-09-01', '2026-09-08', ANA)])).toThrow(RangeError);
    expect(calendarMarksStateOf(member, answered([rowOf('record-ana', '2026-09-01', '2026-09-08', ANA)]))).toEqual({
      kind: MARKS_UNAVAILABLE,
      retryable: false,
    });
  });

  it("never carries a collision or another member's leave", () => {
    const marks = calendarMarksOf(member, [WORKED]);

    expect(marks.collisions).toEqual([]);
    expect([...marks.leave.keys()]).toEqual([VIEWER_MEMBER]);
  });
});

/** A settled query answer over `rows`. */
function answered(rows: readonly unknown[]) {
  return { isPending: false, isError: false, fetchStatus: 'idle', data: rows };
}

describe('the leave read, never hidden', () => {
  it('is loading while the read is pending, a disabled one included', () => {
    expect(calendarMarksStateOf(pilot, { isPending: true, isError: false, fetchStatus: 'fetching', data: undefined })).toEqual({
      kind: MARKS_LOADING,
    });
    expect(calendarMarksStateOf(pilot, { isPending: true, isError: false, fetchStatus: 'idle', data: undefined })).toEqual({
      kind: MARKS_LOADING,
    });
  });

  it('is unavailable when the read failed, a failed refetch over cached rows included', () => {
    expect(calendarMarksStateOf(pilot, { isPending: false, isError: true, fetchStatus: 'idle', data: undefined }).kind).toBe(
      MARKS_UNAVAILABLE,
    );
    expect(calendarMarksStateOf(pilot, { isPending: false, isError: true, fetchStatus: 'idle', data: [WORKED] }).kind).toBe(
      MARKS_UNAVAILABLE,
    );
  });

  it('is unavailable while paused offline, cached rows or not', () => {
    expect(calendarMarksStateOf(pilot, { isPending: false, isError: false, fetchStatus: 'paused', data: [WORKED] }).kind).toBe(
      MARKS_UNAVAILABLE,
    );
  });

  it('is unavailable, logged, when a row cannot be trusted', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(calendarMarksStateOf(pilot, answered([{ id: 'x', member_id: 'nobody', during: '[2026-09-10,2026-09-11)' }])).kind).toBe(
      MARKS_UNAVAILABLE,
    );
    expect(logged).toHaveBeenCalledWith(MARKS_UNAVAILABLE, expect.any(RangeError));
  });

  it('offers a retry for a failed or paused read alone, never for rows it cannot trust', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(calendarMarksStateOf(pilot, { isPending: false, isError: true, fetchStatus: 'idle', data: undefined })).toEqual({
      kind: MARKS_UNAVAILABLE,
      retryable: true,
    });
    expect(calendarMarksStateOf(pilot, { isPending: false, isError: false, fetchStatus: 'paused', data: [WORKED] })).toEqual({
      kind: MARKS_UNAVAILABLE,
      retryable: true,
    });
    expect(calendarMarksStateOf(pilot, answered([{ id: 'x', member_id: 'nobody', during: '[2026-09-10,2026-09-11)' }]))).toEqual({
      kind: MARKS_UNAVAILABLE,
      retryable: false,
    });
  });

  it('is ready with the marks once the rows are in', () => {
    const state = calendarMarksStateOf(pilot, answered([WORKED]));

    if (state.kind !== MARKS_READY) throw new Error(state.kind);

    expect(state.marks.collisions.map((collision) => collision.date)).toEqual(COLLIDING_DATES);
  });
});

describe('the refusal and its retry', () => {
  const ready = { kind: MARKS_READY, marks: { collisions: [], leave: new Map() } } as const;

  it('refuses with a retry when the snapshot read failed or is paused, whatever else', () => {
    expect(calendarRefusalOf(CALENDAR_UNAVAILABLE, null, null)).toEqual({ refusal: CALENDAR_UNAVAILABLE, retryable: true });
    expect(
      calendarRefusalOf(CALENDAR_UNAVAILABLE, { kind: MARKS_UNAVAILABLE, retryable: false }, CALENDAR_UNAVAILABLE),
    ).toEqual({ refusal: CALENDAR_UNAVAILABLE, retryable: true });
  });

  it('refuses with a retry when the leave read failed or is paused', () => {
    expect(calendarRefusalOf(null, { kind: MARKS_UNAVAILABLE, retryable: true }, null)).toEqual({
      refusal: CALENDAR_UNAVAILABLE,
      retryable: true,
    });
  });

  it('refuses with NO retry for leave rows it cannot trust or a derivation the domain refused', () => {
    expect(calendarRefusalOf(null, { kind: MARKS_UNAVAILABLE, retryable: false }, null)).toEqual({
      refusal: CALENDAR_UNAVAILABLE,
      retryable: false,
    });
  });

  it('refuses with NO retry for a month the domain refused', () => {
    expect(calendarRefusalOf(null, ready, CALENDAR_UNAVAILABLE)).toEqual({ refusal: CALENDAR_UNAVAILABLE, retryable: false });
  });

  it('refuses nothing while loading or ready', () => {
    expect(calendarRefusalOf(null, null, null)).toEqual({ refusal: null, retryable: false });
    expect(calendarRefusalOf(null, { kind: MARKS_LOADING }, null)).toEqual({ refusal: null, retryable: false });
    expect(calendarRefusalOf(null, ready, null)).toEqual({ refusal: null, retryable: false });
  });
});

describe('no rotation, no mark', () => {
  it("carries nothing on a cell before the team's first rotation, however the member's leave covers it", async () => {
    // The viewer is on Smjena A from 2019-12-01, a month before its first
    // rotation version (2020-01-01), with leave over the gap and into it.
    const snapshot = await snapshotOf(PILOT, { since: '2019-12-01' });
    const leave = [rowOf('record-gap', '2019-12-20', '2020-01-03')];
    const december = monthOf(snapshot, leave, { mjesec: '2019-12' });
    const gap = daysOf(december.days).filter((day) => day.date >= '2019-12-20');

    expect(gap.length).toBeGreaterThan(0);
    for (const day of gap) {
      expect(day.shifts.map((shift) => [shift.cell.shiftTypeId, shift.cell.modifiers]), day.date).toEqual([[null, []]]);
    }
    expect(legendOf(daysOf(december.days).flatMap((day) => day.shifts.map((shift) => shift.cell)))).toEqual([]);
    expect(december.rows.flatMap((row) => row.cells.flatMap((cell) => cell.modifiers))).toEqual([]);

    // Once the rotation is in effect, the same record marks as ever.
    const january = monthOf(snapshot, leave, { mjesec: '2020-01' });

    expect(dayMarksOf(daysOf(january.days), ['2020-01-01', '2020-01-02'])).toEqual({
      '2020-01-01': [['conflict', 'leave']],
      '2020-01-02': [['conflict', 'leave']],
    });
  });
});
