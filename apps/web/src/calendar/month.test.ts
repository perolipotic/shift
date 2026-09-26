import { projectedShiftTypeOn } from '@shift/domain';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ALL_TEAMS_FILTER,
  CALENDAR_CELL_CLASS,
  COMPRESSED_CELL_CLASS,
  NO_ROTATION_CELL_CLASS,
  NO_ROTATION_SHOWN,
  SKELETON_COLUMN_COUNT,
  SKELETON_GRID_STYLE,
  PHONE_MEDIA_QUERY,
  calendarDayListOf,
  calendarFilterChangeOf,
  calendarModeOf,
  calendarMonthOf,
  calendarMonthOutcomeOf,
  calendarSearchOf,
  calendarSearchTo,
  calendarTodayOf,
  chosenTeamOf,
  defaultModeOf,
  isCalendarMonth,
  monthShownOf,
  teamLettersOf,
  phoneStoreOf,
  typeLettersOf,
  type CalendarDay,
  type CalendarMonth,
  type PhoneMediaQuery,
} from '@/calendar/month';
import { cellLabelOf, gridCellLabelsOf, legendOf, type CellLabelTranslate } from '@/calendar/modifiers';
import { CALENDAR_UNAVAILABLE, readCalendar, type CalendarSnapshot } from '@/calendar/snapshot';
import { initLocalization, t } from '@/i18n';
import {
  PILOT,
  TODAY,
  UJ5,
  assignmentRow,
  calendarOrganizationRow,
  calendarTableOf,
  membershipRow,
  stepRow,
  teamRow,
  typeRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/rotation/rotation.fixture';
import { NONWORKING_CHIP_CLASS, NO_TIMES_SHOWN, slotColourClassOf } from '@/shift-types/list';

/**
 * Story 3.1's month model, executed (AD-15): the search and its fallback, the
 * heading, the rows, the cells, today, the ranges, the null cell and the
 * bounds — every row of the spec's matrix but the member and the failed read,
 * which the snapshot's suite and the e2e suite hold.
 */

async function snapshotOf(
  rows: FixtureRows,
  { timezone = 'Europe/Zagreb', viewers = null as readonly Record<string, unknown>[] | null } = {},
): Promise<CalendarSnapshot> {
  const organization = calendarOrganizationRow(rows, { timezone, viewers });
  const outcome = await readCalendar(
    calendarTableOf({ data: [organization], error: null, count: 1 }),
    viewerSession(),
  );

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** The day list of a month whose day list did not fail. */
function daysOf(month: CalendarMonth): readonly CalendarDay[] | null {
  if (!month.days.ok) throw new Error(month.days.code);

  return month.days.days;
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
      letter: 'D',
      className: `${CALENDAR_CELL_CLASS} ${slotColourClassOf(1)}`,
      range: '07:00–19:00',
      modifiers: [],
    });
    expect(noc?.className).toBe(`${CALENDAR_CELL_CLASS} ${slotColourClassOf(2)}`);
    expect(noc?.range).toBe('19:00–07:00');
    expect(slobodno).toEqual({
      teamId: 'pilot-smjena-c',
      shiftTypeId: 'pilot-slobodno',
      name: 'Slobodno',
      letter: 'S',
      className: `${CALENDAR_CELL_CLASS} ${NONWORKING_CHIP_CLASS}`,
      range: null,
      modifiers: [],
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
        letter: null,
        className: `${CALENDAR_CELL_CLASS} ${NO_ROTATION_CELL_CLASS}`,
        range: null,
        modifiers: [],
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

describe('the mode (story 3.2a)', () => {
  it('keeps a valid prikaz beside the month and drops anything else', () => {
    expect(calendarSearchOf({ prikaz: 'moj' })).toEqual({ prikaz: 'moj' });
    expect(calendarSearchOf({ prikaz: 'sve', mjesec: '2026-10' })).toEqual({ mjesec: '2026-10', prikaz: 'sve' });
    for (const bad of ['MOJ', 'all', '', 1, null, undefined, ['moj']]) {
      expect(calendarSearchOf({ prikaz: bad, mjesec: '2026-10' }), String(bad)).toEqual({ mjesec: '2026-10' });
    }
  });

  it('defaults to the day list only for a member-role account on a phone', () => {
    expect(defaultModeOf('member_role', true)).toBe('moj');
    expect(defaultModeOf('member_role', false)).toBe('sve');
    expect(defaultModeOf('admin', true)).toBe('sve');
    expect(defaultModeOf('admin', false)).toBe('sve');
    expect(PHONE_MEDIA_QUERY).toBe('(max-width: 639px)');
  });

  it('shows the mode the search names, whatever the role or width', () => {
    for (const role of ['admin', 'member_role'] as const) {
      for (const isPhone of [true, false]) {
        expect(calendarModeOf({ prikaz: 'moj' }, role, isPhone)).toBe('moj');
        expect(calendarModeOf({ prikaz: 'sve' }, role, isPhone)).toBe('sve');
        expect(calendarModeOf({}, role, isPhone)).toBe(defaultModeOf(role, isPhone));
      }
    }
  });

  it('keeps the mode on month navigation and Ovaj mjesec, and never writes one in', () => {
    expect(calendarSearchTo({ prikaz: 'moj' }, { mjesec: '2026-10' })).toEqual({ mjesec: '2026-10', prikaz: 'moj' });
    expect(calendarSearchTo({ mjesec: '2026-10', prikaz: 'sve' }, { mjesec: null })).toEqual({ prikaz: 'sve' });
    expect(calendarSearchTo({}, { mjesec: '2026-10' })).toEqual({ mjesec: '2026-10' });
    expect(calendarSearchTo({ mjesec: '2026-10' }, { mjesec: null })).toEqual({});
    // The switch keeps the month.
    expect(calendarSearchTo({ mjesec: '2026-10' }, { prikaz: 'moj' })).toEqual({ mjesec: '2026-10', prikaz: 'moj' });
    expect(calendarSearchTo({ mjesec: '2026-10', prikaz: 'moj' }, { prikaz: 'sve' })).toEqual({
      mjesec: '2026-10',
      prikaz: 'sve',
    });
  });
});

describe('the letters (story 3.2a)', () => {
  it('names a team by the first letter of its last word, and a type by its first letter', () => {
    expect(teamLettersOf(['Smjena A', 'Smjena B', 'Smjena C', 'Smjena D'])).toEqual(['A', 'B', 'C', 'D']);
    expect(typeLettersOf(['Dan', 'Noć', 'Slobodno'])).toEqual(['D', 'N', 'S']);
    expect(typeLettersOf(['Jutarnja', 'Popodnevna', 'Noćna', 'Slobodno'])).toEqual(['J', 'P', 'N', 'S']);
    expect(teamLettersOf(['smjena čvor', '  Ekipa  ', 'Smjena'])).toEqual(['Č', 'E', 'S']);
  });

  it('widens colliding letters to two, and still colliding ones to the whole word', () => {
    expect(teamLettersOf(['Smjena Alfa', 'Smjena Ante', 'Smjena B'])).toEqual(['AL', 'AN', 'B']);
    expect(typeLettersOf(['Dan', 'Dežurstvo', 'Noć'])).toEqual(['DA', 'DE', 'N']);
    expect(teamLettersOf(['Smjena Alfa', 'Smjena Alma'])).toEqual(['ALFA', 'ALMA']);
    // A single letter collides with nothing once the rest widen.
    expect(typeLettersOf(['Dan', 'Dnevna', 'D'])).toEqual(['DA', 'DN', 'D']);
  });

  it('puts the letters on the grid, the columns and the cells', async () => {
    const month = calendarMonthOf(pilot, { mjesec: '2020-01' }, TODAY);

    expect(month.columns.map((column) => column.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(month.rows[0]!.cells.map((cell) => cell.letter)).toEqual(['D', 'N', 'S', 'S']);
    expect(calendarMonthOf(uj5, { mjesec: '2020-01' }, TODAY).rows[0]!.cells.map((cell) => cell.letter)).toEqual([
      'J',
      'P',
      'N',
    ]);
    const colliding = await snapshotOf({
      ...PILOT,
      teams: PILOT.teams.map((team, index) =>
        index < 2 ? { ...team, name: ['Smjena Alfa', 'Smjena Ante'][index] } : team,
      ),
      types: [...PILOT.types, typeRow('pilot-dezurstvo', 'Dežurstvo', '2026-09-25T20:07:49.339741+00:00')],
    });
    const widened = calendarMonthOf(colliding, { mjesec: '2020-01' }, TODAY);

    expect(widened.columns.map((column) => column.letter)).toEqual(['AL', 'AN', 'C', 'D']);
    // Dežurstvo is in no rotation, so it is not shown and widens nothing.
    expect(widened.rows[0]!.cells[0]!.letter).toBe('D');
  });

  it('makes a compressed cell a touch target below 640 px only', () => {
    expect(COMPRESSED_CELL_CLASS.split(' ').every((name) => name.startsWith('max-sm:'))).toBe(true);
    expect(COMPRESSED_CELL_CLASS).toContain('max-sm:min-h-11');
    expect(COMPRESSED_CELL_CLASS).toContain('max-sm:min-w-11');
  });
});

describe('the day list (story 3.2a)', () => {
  it.each([
    { fixture: 'pilot', snapshot: () => pilot },
    { fixture: 'UJ-5', snapshot: () => uj5 },
  ])("$fixture: every day is the viewer's team's cell in the grid", ({ snapshot }) => {
    const shown = snapshot();
    const month = calendarMonthOf(shown, {}, TODAY);
    const team = shown.viewer.memberships[0]!.teamId;
    const column = month.columns.findIndex((one) => one.id === team);

    expect(daysOf(month)).toHaveLength(30);
    for (const [index, day] of daysOf(month)!.entries()) {
      const row = month.rows[index]!;

      expect(day.date).toBe(row.date);
      expect(day.dayMonth).toBe(row.dayMonth);
      expect(day.weekday).toBe(row.weekday);
      expect(day.isToday).toBe(row.isToday);
      expect(day.teamId).toBe(team);
      expect(day.cell).toEqual(row.cells[column]);
    }
    expect(daysOf(month)!.filter((day) => day.isToday).map((day) => day.date)).toEqual([TODAY]);
    expect(calendarDayListOf(shown, '2026-09', TODAY)).toEqual(daysOf(month));
  });

  it('follows a move in the middle of the month: the 1st–14th from A, the 15th on from B', async () => {
    const moved = await snapshotOf(PILOT, {
      viewers: [viewerRow([membershipRow('pilot-smjena-a', '2026-10-01'), membershipRow('pilot-smjena-b', '2026-10-15')])],
    });
    const month = calendarMonthOf(moved, { mjesec: '2026-10' }, TODAY);

    for (const [index, day] of daysOf(month)!.entries()) {
      const column = day.date < '2026-10-15' ? 0 : 1;

      expect(day.teamId, day.date).toBe(column === 0 ? 'pilot-smjena-a' : 'pilot-smjena-b');
      expect(day.cell, day.date).toEqual(month.rows[index]!.cells[column]);
    }
  });

  it('reads no team from the day the viewer leaves, and no list when on no team all month', async () => {
    const left = await snapshotOf(PILOT, {
      viewers: [viewerRow([membershipRow('pilot-smjena-a', '2020-01-01'), membershipRow(null, '2026-09-10')])],
    });
    const september = daysOf(calendarMonthOf(left, { mjesec: '2026-09' }, TODAY))!;

    expect(september.slice(0, 9).every((day) => day.teamId === 'pilot-smjena-a' && day.cell !== null)).toBe(true);
    expect(september.slice(9).every((day) => day.teamId === null && day.cell === null)).toBe(true);
    expect(daysOf(calendarMonthOf(left, { mjesec: '2026-10' }, TODAY))).toBeNull();

    const none = await snapshotOf(PILOT, { viewers: [viewerRow([])] });

    expect(daysOf(calendarMonthOf(none, {}, TODAY))).toBeNull();
  });

  it("follows the viewer onto an archived team, which the grid hides", async () => {
    const archived = await snapshotOf(
      {
        ...PILOT,
        teams: [...PILOT.teams, teamRow('pilot-smjena-x', 'Smjena X', { archived: true })],
        assignments: [
          ...PILOT.assignments,
          assignmentRow('pilot-smjena-x', 'pilot-rotation', 'pilot-step-0', '2020-01-01', '2020-01-01'),
        ],
      },
      { viewers: [viewerRow([membershipRow('pilot-smjena-x', '2020-01-01')])] },
    );
    const month = calendarMonthOf(archived, { mjesec: '2020-01' }, TODAY);

    expect(month.columns.map((column) => column.id)).not.toContain('pilot-smjena-x');
    expect(daysOf(month)![0]!.teamId).toBe('pilot-smjena-x');
    expect(daysOf(month)![0]!.cell?.name).toBe('Dan');
  });

  it('draws a day before the team has a rotation as the grid draws it: the mark', async () => {
    const month = calendarMonthOf(pilot, { mjesec: '2019-12' }, TODAY);

    // The fixture viewer joins on 2020-01-01: December 2019 has no team at all.
    expect(daysOf(month)).toBeNull();
    const early = await snapshotOf(PILOT, { viewers: [viewerRow([membershipRow('pilot-smjena-a', '2019-12-01')])] });
    const days = daysOf(calendarMonthOf(early, { mjesec: '2019-12' }, TODAY))!;

    expect(days.every((day) => day.cell?.name === null && day.cell.letter === null)).toBe(true);
  });
});

describe('the review of 3.2a', () => {
  it('keeps a decomposed letter one letter', () => {
    const decomposed = 'Smjena C\u030Cvor';

    expect(decomposed).not.toBe(decomposed.normalize('NFC'));
    expect(teamLettersOf([decomposed, 'Smjena B'])).toEqual(['Č', 'B']);
    expect(typeLettersOf(['C\u030Casna', 'Dan'])).toEqual(['Č', 'D']);
    expect(typeLettersOf(['C\u030Casna', 'Čuvanje'])).toEqual(['ČA', 'ČU']);
  });

  it('falls back to the full name where even the whole words collide', () => {
    expect(teamLettersOf(['Smjena A', 'Tim A', 'Smjena B'])).toEqual(['Smjena A', 'Tim A', 'B']);
    const labels = teamLettersOf(['Prva Alfa', 'Druga Alfa', 'Alfa']);

    expect(new Set(labels).size).toBe(3);
    expect(labels).toEqual(['Prva Alfa', 'Druga Alfa', 'Alfa']);
  });

  it('letters only the types the month shows: an unused type never widens a shown one', async () => {
    const withUnused = await snapshotOf({
      ...PILOT,
      types: [
        ...PILOT.types,
        typeRow('pilot-dezurstvo', 'Dežurstvo', '2026-09-25T20:07:49.339741+00:00', { archived: true }),
        typeRow('pilot-nocna', 'Noćna', '2026-09-25T20:07:49.339841+00:00'),
      ],
    });
    const month = calendarMonthOf(withUnused, { mjesec: '2026-09' }, TODAY);
    const letters = new Set(month.rows.flatMap((row) => row.cells.map((cell) => cell.letter)));

    expect(letters).toEqual(new Set(['D', 'N', 'S']));
  });

  it('keeps a day-list failure local: the grid still draws, and the day list is the read failure', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The viewer on an archived team whose version names a pattern with no
    // steps: the grid never projects that team, the day list must.
    const broken: CalendarSnapshot = {
      ...pilot,
      viewer: { ...pilot.viewer, memberships: [{ teamId: 'archived-team', effectiveFrom: '2020-01-01' }] },
      assignments: [
        ...pilot.assignments,
        {
          teamId: 'archived-team',
          patternId: 'no-steps',
          offsetStepId: 'missing',
          anchorDate: '2020-01-01',
          effectiveFrom: '2020-01-01',
        },
      ],
    };

    expect(() => calendarDayListOf(broken, '2026-09', TODAY)).toThrow(RangeError);
    const outcome = calendarMonthOutcomeOf(broken, { mjesec: '2026-09' }, TODAY);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Sve smjene: the grid is the grid it always was.
    expect(outcome.month.rows).toEqual(calendarMonthOf(pilot, { mjesec: '2026-09' }, TODAY).rows);
    // Moj raspored: the alert, and no list.
    expect(outcome.month.days).toEqual({ ok: false, code: CALENDAR_UNAVAILABLE });
    expect(logged).toHaveBeenCalledWith(CALENDAR_UNAVAILABLE, expect.any(RangeError));
    logged.mockRestore();
  });

  it('follows the width through one shared media query list', () => {
    const listeners = new Set<() => void>();
    const asked: string[] = [];
    const list: PhoneMediaQuery & { matches: boolean } = {
      matches: false,
      addEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.add(listener);
      }),
      removeEventListener: vi.fn((_type: 'change', listener: () => void) => {
        listeners.delete(listener);
      }),
    };
    const store = phoneStoreOf((query) => {
      asked.push(query);

      return list;
    });

    expect(asked).toEqual([]);
    expect(store.get()).toBe(false);
    const onChange = vi.fn();
    const unsubscribe = store.subscribe(onChange);

    expect(list.addEventListener).toHaveBeenCalledWith('change', onChange);
    list.matches = true;
    for (const listener of listeners) listener();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(true);
    unsubscribe();
    expect(list.removeEventListener).toHaveBeenCalledWith('change', onChange);
    expect(listeners.size).toBe(0);
    expect(asked).toEqual([PHONE_MEDIA_QUERY]);
  });
});

describe('modifiers and labels (story 3.2b)', () => {
  const translate: CellLabelTranslate = (key) => t(key);

  it.each([
    { fixture: 'pilot', snapshot: () => pilot },
    { fixture: 'UJ-5', snapshot: () => uj5 },
  ])('$fixture: no cell carries a modifier yet, so there is no legend', ({ snapshot }) => {
    for (const mjesec of ['2026-09', '2019-12', '2031-02']) {
      const month = calendarMonthOf(snapshot(), { mjesec }, TODAY);
      const cells = month.rows.flatMap((row) => row.cells);
      const days = daysOf(month) ?? [];

      for (const cell of [...cells, ...days.map((day) => day.cell)]) {
        if (cell !== null) expect(cell.modifiers).toEqual([]);
      }
      expect(legendOf(cells)).toEqual([]);
      expect(legendOf(days.map((day) => day.cell))).toEqual([]);
    }
  });

  it('labels a cell from its row, its column and itself, never with a letter', () => {
    const month = calendarMonthOf(pilot, { mjesec: '2020-01' }, TODAY);
    const labels = gridCellLabelsOf(month, translate);

    expect(labels).toHaveLength(month.rows.length);
    for (const row of labels) expect(row).toHaveLength(month.columns.length);
    // Never a letter: every label names the team and the type in full.
    for (const [index, row] of month.rows.entries()) {
      for (const [column, cell] of row.cells.entries()) {
        const label = labels[index]![column]!;

        expect(label.startsWith(`${row.weekday} ${row.dayMonth}, ${month.columns[column]!.name}, ${cell.name ?? ''}`)).toBe(true);
        expect(label.split(', ')).not.toContain(cell.letter);
      }
    }
    // 2020-01-01, the anchor: Smjena A–D stand on Dan, Noć, Slobodno, Slobodno.
    expect(labels[0]).toEqual([
      'srijeda 01.01., Smjena A, Dan, 07:00–19:00',
      'srijeda 01.01., Smjena B, Noć, 19:00–07:00',
      'srijeda 01.01., Smjena C, Slobodno',
      'srijeda 01.01., Smjena D, Slobodno',
    ]);
  });

  it("labels today's row and a month before any rotation", () => {
    const today = calendarMonthOf(pilot, {}, TODAY).rows.find((row) => row.isToday)!;
    const before = calendarMonthOf(pilot, { mjesec: '2019-12' }, TODAY);

    expect(cellLabelOf({ ...today, ...today.cells[0]!, teamName: 'Smjena A' }, translate)).toMatch(
      /^subota 26\.09\., Smjena A, /,
    );
    expect(
      cellLabelOf({ ...before.rows[0]!, ...before.rows[0]!.cells[0]!, teamName: before.columns[0]!.name }, translate),
    ).toBe('nedjelja 01.12., Smjena A, Bez rotacije');
  });
});

describe('the team filter (story 3.3a)', () => {
  it('keeps any non-empty smjena and drops anything else', () => {
    expect(calendarSearchOf({ smjena: 'pilot-smjena-a' })).toEqual({ smjena: 'pilot-smjena-a' });
    // Kept whatever it names: whether it is a team shown is the month's decision.
    expect(calendarSearchOf({ smjena: 'nobody' })).toEqual({ smjena: 'nobody' });
    expect(calendarSearchOf({ smjena: 'pilot-smjena-a', prikaz: 'sve', mjesec: '2026-10' })).toEqual({
      mjesec: '2026-10',
      prikaz: 'sve',
      smjena: 'pilot-smjena-a',
    });
    for (const bad of ['', 7, null, undefined, ['pilot-smjena-a'], { id: 'pilot-smjena-a' }]) {
      expect(calendarSearchOf({ smjena: bad, mjesec: '2026-10' }), String(bad)).toEqual({ mjesec: '2026-10' });
    }
  });

  it('keeps the team on a month change and on a mode change', () => {
    // Matrix: month change — `{mjesec, prikaz, smjena}` all kept.
    expect(calendarSearchTo({ smjena: 'A', prikaz: 'sve' }, { mjesec: '2026-10' })).toEqual({
      mjesec: '2026-10',
      prikaz: 'sve',
      smjena: 'A',
    });
    expect(calendarSearchTo({ mjesec: '2026-10', smjena: 'A' }, { mjesec: null })).toEqual({ smjena: 'A' });
    // Matrix: mode change — `smjena` kept.
    expect(calendarSearchTo({ smjena: 'A' }, { prikaz: 'moj' })).toEqual({ prikaz: 'moj', smjena: 'A' });
  });

  it('chooses a team, and resets to every team keeping the rest', () => {
    expect(calendarSearchTo({ mjesec: '2026-10' }, { smjena: 'A' })).toEqual({ mjesec: '2026-10', smjena: 'A' });
    expect(calendarSearchTo({ smjena: 'A' }, { smjena: 'B' })).toEqual({ smjena: 'B' });
    // Matrix: reset — the search without `smjena`, the other params kept.
    expect(calendarSearchTo({ mjesec: '2026-10', prikaz: 'sve', smjena: 'A' }, { smjena: null })).toEqual({
      mjesec: '2026-10',
      prikaz: 'sve',
    });
    // Never a mode or a team the viewer did not choose.
    expect(calendarSearchTo({}, { smjena: null })).toEqual({});
    expect(calendarSearchTo({}, { mjesec: '2026-10' })).toEqual({ mjesec: '2026-10' });
  });

  it('turns the all-teams option into the reset, and a team into itself', () => {
    expect(calendarFilterChangeOf(ALL_TEAMS_FILTER)).toEqual({ smjena: null });
    expect(calendarFilterChangeOf('pilot-smjena-b')).toEqual({ smjena: 'pilot-smjena-b' });
  });

  it('shows every column and chooses nothing with no smjena', () => {
    // Matrix: no filter — 4 columns.
    const month = calendarMonthOf(pilot, {}, TODAY);

    expect(month.filter.chosen).toBeNull();
    expect(month.filter.teams.map((team) => team.id)).toEqual(month.columns.map((team) => team.id));
    expect(month.filter.teams).toHaveLength(4);
    expect(month.columns).toHaveLength(4);
  });

  it("narrows the columns and every row's cells to the chosen team, keeping its letter", () => {
    // Matrix: team chosen — only B's column and cells, B keeps its letter.
    const all = calendarMonthOf(pilot, { mjesec: '2020-01' }, TODAY);
    const month = calendarMonthOf(pilot, { mjesec: '2020-01', smjena: 'pilot-smjena-b' }, TODAY);

    expect(month.filter.chosen).toBe('pilot-smjena-b');
    expect(month.filter.teams.map((team) => team.id)).toEqual(all.columns.map((team) => team.id));
    expect(month.columns.map((team) => [team.id, team.letter])).toEqual([['pilot-smjena-b', 'B']]);
    expect(month.rows).toHaveLength(all.rows.length);
    month.rows.forEach((row, index) => {
      expect(row.cells).toEqual(all.rows[index]!.cells.filter((cell) => cell.teamId === 'pilot-smjena-b'));
    });
    // The labels read the narrowed column, never the first of every team.
    expect(gridCellLabelsOf(month, (key) => t(key))[0]).toEqual(['srijeda 01.01., Smjena B, Noć, 19:00–07:00']);
  });

  it('keeps a widened letter when narrowed to one column', async () => {
    const colliding = await snapshotOf({
      ...PILOT,
      teams: PILOT.teams.map((team, index) =>
        index < 2 ? { ...team, name: ['Smjena Alfa', 'Smjena Ante'][index] } : team,
      ),
    });
    const all = calendarMonthOf(colliding, { mjesec: '2020-01' }, TODAY);

    for (const team of all.columns) {
      const month = calendarMonthOf(colliding, { mjesec: '2020-01', smjena: team.id }, TODAY);

      // The narrowed column's letter is the same team's letter unfiltered.
      expect(month.columns.map((column) => [column.id, column.letter])).toEqual([[team.id, team.letter]]);
    }
    expect(all.columns[0]!.letter).toBe('AL');
  });

  it('ignores an unknown or archived id: every column, and nothing chosen', async () => {
    const withArchived = await snapshotOf({
      ...PILOT,
      teams: [...PILOT.teams, teamRow('pilot-smjena-x', 'Smjena X', { archived: true })],
    });

    for (const smjena of ['nobody', 'pilot-smjena-x']) {
      const month = calendarMonthOf(withArchived, { smjena }, TODAY);

      expect(month.filter.chosen, smjena).toBeNull();
      expect(month.columns, smjena).toHaveLength(4);
      for (const row of month.rows) expect(row.cells).toHaveLength(4);
    }
    // Archived teams are never options.
    expect(calendarMonthOf(withArchived, {}, TODAY).filter.teams.map((team) => team.id)).not.toContain(
      'pilot-smjena-x',
    );
    expect(chosenTeamOf({ smjena: 'pilot-smjena-x' }, calendarMonthOf(withArchived, {}, TODAY).filter.teams)).toBeNull();
  });

  it('lists the options in column order, straight from the snapshot', async () => {
    const reordered = await snapshotOf({ ...PILOT, teams: [...PILOT.teams].reverse() });
    const month = calendarMonthOf(reordered, {}, TODAY);

    expect(month.filter.teams.map((team) => team.id)).toEqual(month.columns.map((team) => team.id));
    expect(calendarMonthOf(uj5, {}, TODAY).filter.teams.map((team) => team.name)).toEqual([
      'Smjena A',
      'Smjena B',
      'Smjena C',
    ]);
  });

  it('leaves the day list alone when a team is chosen', () => {
    // Matrix: mode change — the day list is unchanged by `smjena`, even when
    // the chosen team is not the viewer's.
    const own = pilot.viewer.memberships[0]!.teamId;
    const unfiltered = daysOf(calendarMonthOf(pilot, {}, TODAY));

    expect(unfiltered, 'the viewer is on no team, so the day list proves nothing').not.toBeNull();
    expect(unfiltered!.every((day) => day.teamId === own)).toBe(true);
    for (const team of calendarMonthOf(pilot, {}, TODAY).filter.teams) {
      expect(daysOf(calendarMonthOf(pilot, { smjena: team.id }, TODAY)), team.id).toEqual(unfiltered);
    }
    expect(calendarMonthOf(pilot, {}, TODAY).filter.teams.some((team) => team.id !== own)).toBe(true);
  });

  it('has no options and nothing chosen when no team is active', async () => {
    const month = calendarMonthOf(
      await snapshotOf({ teams: [], types: [], steps: [], assignments: [] }),
      { smjena: 'pilot-smjena-a' },
      TODAY,
    );

    expect(month.filter).toEqual({ teams: [], chosen: null });
  });
});
