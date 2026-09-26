import { projectedShiftTypeOn } from '@shift/domain';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_CELL_CLASS,
  NO_ROTATION_CELL_CLASS,
  NO_ROTATION_SHOWN,
  SKELETON_COLUMN_COUNT,
  SKELETON_GRID_STYLE,
  calendarMonthOf,
  calendarMonthOutcomeOf,
  calendarSearchOf,
  calendarTodayOf,
  isCalendarMonth,
  monthShownOf,
} from '@/calendar/month';
import { CALENDAR_UNAVAILABLE, readCalendar, type CalendarSnapshot } from '@/calendar/snapshot';
import { initLocalization } from '@/i18n';
import {
  PILOT,
  TODAY,
  UJ5,
  assignmentRow,
  organizationRow,
  stepRow,
  teamRow,
  type FixtureRows,
} from '@/rotation/rotation.fixture';
import { NONWORKING_CHIP_CLASS, NO_TIMES_SHOWN, slotColourClassOf } from '@/shift-types/list';

/**
 * Story 3.1's month model, executed (AD-15): the search and its fallback, the
 * heading, the rows, the cells, today, the ranges, the null cell and the
 * bounds — every row of the spec's matrix but the member and the failed read,
 * which the snapshot's suite and the e2e suite hold.
 */

async function snapshotOf(rows: FixtureRows, timezone = 'Europe/Zagreb'): Promise<CalendarSnapshot> {
  const { members: _members, ...organization } = organizationRow(rows, timezone);
  const outcome = await readCalendar({
    select: () => Promise.resolve({ data: [organization], error: null, count: 1 }),
  });

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

let pilot: CalendarSnapshot;
let uj5: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf(PILOT);
  uj5 = await snapshotOf(UJ5);
});

describe('the search', () => {
  it('keeps a valid month and drops anything else', () => {
    expect(calendarSearchOf({ mjesec: '2026-09' })).toEqual({ mjesec: '2026-09' });
    expect(calendarSearchOf({ mjesec: '0001-01' })).toEqual({ mjesec: '0001-01' });
    expect(calendarSearchOf({ mjesec: '9999-12' })).toEqual({ mjesec: '9999-12' });
    for (const bad of ['2026-13', '2026-00', 'abc', '', '2026-9', '0000-12', '2026-09-01', 202609, null, undefined]) {
      expect(calendarSearchOf({ mjesec: bad }), String(bad)).toEqual({});
    }
    expect(calendarSearchOf({})).toEqual({});
    expect(isCalendarMonth(['2026-09'])).toBe(false);
  });

  it('falls back to the month today falls in', () => {
    expect(monthShownOf({}, TODAY)).toBe('2026-09');
    expect(monthShownOf({ mjesec: '2031-02' }, TODAY)).toBe('2031-02');
    // A search that bypassed validation is still judged.
    expect(monthShownOf({ mjesec: '2026-13' }, TODAY)).toBe('2026-09');
  });

  it("reads today in the organization's zone, never the device's", () => {
    const lateNight = new Date('2026-09-30T22:30:00Z');

    expect(calendarTodayOf(pilot, lateNight)).toBe('2026-10-01');
    expect(calendarTodayOf({ ...pilot, timeZone: 'America/New_York' }, lateNight)).toBe('2026-09-30');
  });
});

describe('this month', () => {
  it("shows today's month with today's row marked and a cell per active team", () => {
    const month = calendarMonthOf(pilot, {}, TODAY);

    expect(month.month).toBe('2026-09');
    expect(month.monthName).toBe('Rujan');
    expect(month.year).toBe('2026');
    expect(month.isCurrent).toBe(true);
    expect(month.previous).toBe('2026-08');
    expect(month.next).toBe('2026-10');
    expect(month.columns.map((team) => team.name)).toEqual(['Smjena A', 'Smjena B', 'Smjena C', 'Smjena D']);
    expect(month.rows).toHaveLength(30);
    expect(month.rows.filter((row) => row.isToday).map((row) => row.date)).toEqual([TODAY]);
    for (const row of month.rows) expect(row.cells).toHaveLength(4);

    const today = month.rows.find((row) => row.isToday)!;

    expect(today.dayMonth).toBe('26.09.');
    expect(today.weekday).toBe('subota');
  });

  it('is not current on another month, and marks no row there', () => {
    const month = calendarMonthOf(pilot, { mjesec: '2026-10' }, TODAY);

    expect(month.isCurrent).toBe(false);
    expect(month.rows.some((row) => row.isToday)).toBe(false);
  });

  it.each([
    { fixture: 'pilot', rows: PILOT, snapshot: () => pilot },
    { fixture: 'UJ-5', rows: UJ5, snapshot: () => uj5 },
  ])('$fixture: every cell is the projection, named and filled by its type', ({ snapshot }) => {
    const shown = snapshot();

    for (const mjesec of ['2026-09', '2031-02', '2019-12']) {
      const month = calendarMonthOf(shown, { mjesec }, TODAY);

      for (const row of month.rows) {
        for (const cell of row.cells) {
          const versions = shown.assignments.filter((assignment) => assignment.teamId === cell.teamId);

          expect(cell.shiftTypeId, `${cell.teamId} on ${row.date}`).toBe(
            projectedShiftTypeOn(versions, shown.steps, row.date),
          );
          const type = shown.types.find((one) => one.id === cell.shiftTypeId);

          expect(cell.name).toBe(type?.name ?? null);
        }
      }
    }
  });

  it('fills a working type by its ramp slot and a day off by the non-working fill', () => {
    const month = calendarMonthOf(pilot, { mjesec: '2020-01' }, TODAY);
    // 2020-01-01 is the anchor: Smjena A–D stand on Dan, Noć, Slobodno, Slobodno.
    const [dan, noc, slobodno] = month.rows[0]!.cells;

    expect(dan).toEqual({
      teamId: 'pilot-smjena-a',
      shiftTypeId: 'pilot-dan',
      name: 'Dan',
      className: `${CALENDAR_CELL_CLASS} ${slotColourClassOf(1)}`,
      range: '07:00–19:00',
    });
    expect(noc?.className).toBe(`${CALENDAR_CELL_CLASS} ${slotColourClassOf(2)}`);
    expect(noc?.range).toBe('19:00–07:00');
    expect(slobodno).toEqual({
      teamId: 'pilot-smjena-c',
      shiftTypeId: 'pilot-slobodno',
      name: 'Slobodno',
      className: `${CALENDAR_CELL_CLASS} ${NONWORKING_CHIP_CLASS}`,
      range: null,
    });
    expect(CALENDAR_CELL_CLASS).toContain('min-h-[30px]');
    expect(CALENDAR_CELL_CLASS).toContain('rounded-sm');
    expect(CALENDAR_CELL_CLASS).not.toMatch(/truncate|ellipsis|destructive|accent/);
  });

  it('hides archived teams', async () => {
    const withArchived = await snapshotOf({
      ...PILOT,
      teams: [...PILOT.teams, teamRow('pilot-smjena-x', 'Smjena X', { archived: true })],
      assignments: [
        ...PILOT.assignments,
        assignmentRow('pilot-smjena-x', 'pilot-rotation', 'pilot-step-0', '2020-01-01', '2020-01-01'),
      ],
    });
    const month = calendarMonthOf(withArchived, {}, TODAY);

    expect(month.columns.map((team) => team.id)).not.toContain('pilot-smjena-x');
    expect(month.rows[0]!.cells).toHaveLength(4);
  });

  it('has no columns and still every date when no team is active', async () => {
    const month = calendarMonthOf(await snapshotOf({ teams: [], types: [], steps: [], assignments: [] }), {}, TODAY);

    expect(month.columns).toEqual([]);
    expect(month.rows).toHaveLength(30);
  });
});

describe('the matrix', () => {
  it('far future: 28 rows of February 2031, all projected', () => {
    const month = calendarMonthOf(pilot, { mjesec: '2031-02' }, TODAY);

    expect(month.monthName).toBe('Veljača');
    expect(month.rows).toHaveLength(28);
    expect(month.rows.every((row) => row.cells.every((cell) => cell.shiftTypeId !== null))).toBe(true);
  });

  it('before the first version: every cell is the mark, with no fill and no range', () => {
    const month = calendarMonthOf(pilot, { mjesec: '2019-12' }, TODAY);

    for (const cell of month.rows.flatMap((row) => row.cells)) {
      expect(cell).toEqual({
        teamId: cell.teamId,
        shiftTypeId: null,
        name: null,
        className: `${CALENDAR_CELL_CLASS} ${NO_ROTATION_CELL_CLASS}`,
        range: null,
      });
    }
    expect(NO_ROTATION_SHOWN).toBe(NO_TIMES_SHOWN);
  });

  it('a change in the middle of the month: the 1st–14th through the old pattern, the 15th on through the new', async () => {
    const changed = await snapshotOf({
      ...PILOT,
      steps: [...PILOT.steps, stepRow('changed-0', 'changed', 0, 'pilot-noc'), stepRow('changed-1', 'changed', 1, 'pilot-slobodno')],
      assignments: [
        ...PILOT.assignments,
        assignmentRow('pilot-smjena-a', 'changed', 'changed-0', '2026-10-15', '2026-10-15'),
      ],
    });
    const before = calendarMonthOf(pilot, { mjesec: '2026-10' }, TODAY);
    const after = calendarMonthOf(changed, { mjesec: '2026-10' }, TODAY);

    for (const [index, row] of after.rows.entries()) {
      const cell = row.cells[0]!;

      if (row.date < '2026-10-15') {
        expect(cell, row.date).toEqual(before.rows[index]!.cells[0]);
      } else {
        // The new pattern alternates Noć and Slobodno from its anchor.
        expect(cell.shiftTypeId, row.date).toBe(index % 2 === 0 ? 'pilot-noc' : 'pilot-slobodno');
      }
    }
    // The other teams are untouched.
    for (const [index, row] of after.rows.entries()) {
      expect(row.cells.slice(1)).toEqual(before.rows[index]!.cells.slice(1));
    }
  });

  it('a night shift appears once, on its start date, with both clock times', () => {
    const month = calendarMonthOf(pilot, { mjesec: '2020-01' }, TODAY);
    const smjenaB = month.rows.map((row) => row.cells[1]!);

    // Smjena B starts on Noć on 2020-01-01: 01 Noć, 02–03 Slobodno, 04 Dan, 05 Noć.
    expect(smjenaB.slice(0, 5).map((cell) => cell.name)).toEqual(['Noć', 'Slobodno', 'Slobodno', 'Dan', 'Noć']);
    expect(smjenaB[0]!.range).toBe('19:00–07:00');
    expect(smjenaB[1]!.range).toBeNull();
    expect(smjenaB.filter((cell) => cell.range === '19:00–07:00')).toHaveLength(
      smjenaB.filter((cell) => cell.shiftTypeId === 'pilot-noc').length,
    );
  });

  it('a bad parameter falls back to the current month', () => {
    for (const mjesec of ['2026-13', 'abc']) {
      const month = calendarMonthOf(pilot, calendarSearchOf({ mjesec }), TODAY);

      expect(month.month).toBe('2026-09');
      expect(month.isCurrent).toBe(true);
    }
  });

  it('the bounds: no month before 0001-01 and none after 9999-12', () => {
    const first = calendarMonthOf(pilot, { mjesec: '0001-01' }, TODAY);
    const last = calendarMonthOf(pilot, { mjesec: '9999-12' }, TODAY);

    expect(first.previous).toBeNull();
    expect(first.next).toBe('0001-02');
    expect(first.year).toBe('0001');
    expect(last.next).toBeNull();
    expect(last.previous).toBe('9999-11');
    expect(last.rows).toHaveLength(31);
    expect(last.monthName).toBe('Prosinac');
  });

  it('the range comes from the version in effect on that date', async () => {
    const retimed = await snapshotOf({
      ...PILOT,
      types: PILOT.types.map((type) =>
        type['id'] === 'pilot-dan'
          ? {
              ...type,
              shift_type_versions: [
                ...(type['shift_type_versions'] as readonly Record<string, unknown>[]),
                {
                  organization_id: type['organization_id'],
                  shift_type_id: 'pilot-dan',
                  start_time: '08:00:00',
                  end_time: '20:00:00',
                  effective_from: '2026-10-10',
                },
              ],
            }
          : type,
      ),
    });
    const month = calendarMonthOf(retimed, { mjesec: '2026-10' }, TODAY);
    const ranges = month.rows.flatMap((row) =>
      row.cells.filter((cell) => cell.shiftTypeId === 'pilot-dan').map((cell) => [row.date, cell.range] as const),
    );

    expect(ranges.length).toBeGreaterThan(0);
    for (const [date, range] of ranges) {
      expect(range, date).toBe(date < '2026-10-10' ? '07:00–19:00' : '08:00–20:00');
    }
  });
});

describe('the guard', () => {
  it('draws a month the domain answers', () => {
    expect(calendarMonthOutcomeOf(pilot, { mjesec: '2026-09' }, TODAY)).toEqual({
      ok: true,
      month: calendarMonthOf(pilot, { mjesec: '2026-09' }, TODAY),
    });
  });

  it('turns a projection the domain refuses into the read failure, logged', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A version whose pattern has no steps in the snapshot: projectedShiftTypeOn throws.
    const broken: CalendarSnapshot = { ...pilot, steps: [] };

    expect(() => calendarMonthOf(broken, { mjesec: '2026-09' }, TODAY)).toThrow(RangeError);
    expect(calendarMonthOutcomeOf(broken, { mjesec: '2026-09' }, TODAY)).toEqual({
      ok: false,
      code: CALENDAR_UNAVAILABLE,
    });
    expect(logged).toHaveBeenCalledWith(CALENDAR_UNAVAILABLE, expect.any(RangeError));
    logged.mockRestore();
  });

  it('never labels a cell with a raw id: a type the snapshot lacks is the read failure', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const missing: CalendarSnapshot = { ...pilot, types: pilot.types.filter((type) => type.id !== 'pilot-dan') };

    expect(() => calendarMonthOf(missing, { mjesec: '2026-09' }, TODAY)).toThrow(/pilot-dan/);
    expect(calendarMonthOutcomeOf(missing, { mjesec: '2026-09' }, TODAY).ok).toBe(false);
    logged.mockRestore();
  });

  it('never renders a blank weekday or date: a today that is no date is the read failure', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => calendarMonthOf(pilot, {}, 'not-a-date')).toThrow(RangeError);
    expect(calendarMonthOutcomeOf(pilot, {}, 'not-a-date')).toEqual({ ok: false, code: CALENDAR_UNAVAILABLE });
    logged.mockRestore();
  });

  it('shapes the skeleton row from its column count', () => {
    expect(SKELETON_GRID_STYLE.gridTemplateColumns).toBe(`repeat(${String(SKELETON_COLUMN_COUNT + 1)}, minmax(0, 1fr))`);
  });
});
