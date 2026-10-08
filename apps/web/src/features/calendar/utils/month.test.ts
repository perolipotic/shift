import { projectedShiftTypeOn, shiftRoster } from '@shift/domain';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_CELL_CLASS,
  COMPRESSED_CELL_CLASS,
  NO_ROTATION_CELL_CLASS,
  NO_ROTATION_SHOWN,
  SKELETON_COLUMN_COUNT,
  SKELETON_GRID_STYLE,
  calendarDayListOf,
  calendarModeOf,
  calendarMonthOf,
  calendarMonthOutcomeOf,
  calendarSearchOf,
  calendarSearchTo,
  calendarTodayOf,
  chosenPersonOf,
  chosenTeamOf,
  defaultModeOf,
  isCalendarMonth,
  monthShownOf,
  monthTeamOf,
  teamLettersOf,
  typeLettersOf,
  type CalendarCell,
  type CalendarDay,
  type CalendarMonth,
} from '@/features/calendar/utils/month';
import { cellLabelOf, gridCellLabelsOf, legendOf, type CellLabelTranslate } from '@/features/calendar/utils/modifiers';
import { CALENDAR_UNAVAILABLE, readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  TODAY,
  UJ5,
  VIEWER_MEMBER,
  VIEWER_NAME,
  assignmentRow,
  calendarOrganizationRow,
  calendarOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membershipRow,
  membersAnswerOf,
  overridesAnswerOf,
  calendarMemberRow,
  statusRow,
  stepRow,
  teamRow,
  typeRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';
import { NONWORKING_CHIP_CLASS, NO_TIMES_SHOWN, slotColourClassOf } from '@/features/shift-types/services/list';

/**
 * Story 3.1's month model, executed (AD-15): the search and its fallback, the
 * heading, the rows, the cells, today, the ranges, the null cell and the
 * bounds — every row of the spec's matrix but the member and the failed read,
 * which the snapshot's suite and the e2e suite hold.
 */

async function snapshotOf(
  rows: FixtureRows,
  {
    timezone = 'Europe/Zagreb',
    viewers = null as readonly Record<string, unknown>[] | null,
    versions = null as readonly Record<string, unknown>[] | null,
    statuses = [] as readonly Record<string, unknown>[],
    members = undefined as readonly Record<string, unknown>[] | undefined,
    overrides = [] as readonly Record<string, unknown>[],
  } = {},
): Promise<CalendarSnapshot> {
  const organization = calendarOrganizationRow(rows, { timezone, viewers, versions, statuses });
  const source = calendarTableOf(
    { data: [organization], error: null, count: 1 },
    membersAnswerOf(members),
    overridesAnswerOf(overrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A day's team, from its one shift (story 3.6a); with no roster override a day has at most one. */
function soleTeamOf(day: CalendarDay): string | null {
  if (day.shifts.length > 1) throw new Error(`${day.date} has ${String(day.shifts.length)} shifts`);

  return day.shifts[0]?.teamId ?? null;
}

/** A day's cell, from its one shift. */
function soleCellOf(day: CalendarDay): CalendarCell | null {
  if (day.shifts.length > 1) throw new Error(`${day.date} has ${String(day.shifts.length)} shifts`);

  return day.shifts[0]?.cell ?? null;
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
    expect(month.current).toBe('2026-09');
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
    expect(month.current).toBe('2026-09');
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
      expect(soleTeamOf(day)).toBe(team);
      expect(soleCellOf(day)).toEqual(row.cells[column]);
    }
    expect(daysOf(month)!.filter((day) => day.isToday).map((day) => day.date)).toEqual([TODAY]);
    expect(calendarDayListOf(shown, shown.viewer, '2026-09', TODAY)).toEqual(daysOf(month));
  });

  it('follows a move in the middle of the month: the 1st–14th from A, the 15th on from B', async () => {
    const moved = await snapshotOf(PILOT, {
      viewers: [viewerRow([membershipRow('pilot-smjena-a', '2026-10-01'), membershipRow('pilot-smjena-b', '2026-10-15')])],
    });
    const month = calendarMonthOf(moved, { mjesec: '2026-10' }, TODAY);

    for (const [index, day] of daysOf(month)!.entries()) {
      const column = day.date < '2026-10-15' ? 0 : 1;

      expect(soleTeamOf(day), day.date).toBe(column === 0 ? 'pilot-smjena-a' : 'pilot-smjena-b');
      expect(soleCellOf(day), day.date).toEqual(month.rows[index]!.cells[column]);
    }
  });

  it('reads no team from the day the viewer leaves, and no list when on no team all month', async () => {
    const left = await snapshotOf(PILOT, {
      viewers: [viewerRow([membershipRow('pilot-smjena-a', '2020-01-01'), membershipRow(null, '2026-09-10')])],
    });
    const september = daysOf(calendarMonthOf(left, { mjesec: '2026-09' }, TODAY))!;

    expect(september.slice(0, 9).every((day) => soleTeamOf(day) === 'pilot-smjena-a' && soleCellOf(day) !== null)).toBe(true);
    expect(september.slice(9).every((day) => soleTeamOf(day) === null && soleCellOf(day) === null)).toBe(true);
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
    expect(soleTeamOf(daysOf(month)![0]!)).toBe('pilot-smjena-x');
    expect(soleCellOf(daysOf(month)![0]!)?.name).toBe('Dan');
  });

  it('draws a day before the team has a rotation as the grid draws it: the mark', async () => {
    const month = calendarMonthOf(pilot, { mjesec: '2019-12' }, TODAY);

    // The fixture viewer joins on 2020-01-01: December 2019 has no team at all.
    expect(daysOf(month)).toBeNull();
    const early = await snapshotOf(PILOT, { viewers: [viewerRow([membershipRow('pilot-smjena-a', '2019-12-01')])] });
    const days = daysOf(calendarMonthOf(early, { mjesec: '2019-12' }, TODAY))!;

    expect(days.every((day) => soleCellOf(day)?.name === null && soleCellOf(day)?.letter === null)).toBe(true);
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
      viewer: { ...pilot.viewer, memberships: [{ teamId: 'archived-team', position: null, effectiveFrom: '2020-01-01' }] },
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

    expect(() => calendarDayListOf(broken, broken.viewer, '2026-09', TODAY)).toThrow(RangeError);
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

      for (const cell of [...cells, ...days.map((day) => soleCellOf(day))]) {
        if (cell !== null) expect(cell.modifiers).toEqual([]);
      }
      expect(legendOf(cells)).toEqual([]);
      expect(legendOf(days.map((day) => soleCellOf(day)))).toEqual([]);
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

describe('the overridden mark (story 3.5a)', () => {
  const translate: CellLabelTranslate = (key) => t(key);
  // Smjena A projects Dan on 2020-01-01 (the anchor); the override is Noć.
  const overridden = () =>
    snapshotOf(PILOT, {
      viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)])],
      overrides: [calendarOverrideRow('o1', 'pilot-smjena-a', '2020-01-01', 'pilot-noc')],
    });

  it("marks the overridden cell, draws the worked type, and leaves every other cell as the projection's", async () => {
    const snapshot = await overridden();
    const month = calendarMonthOf(snapshot, { mjesec: '2020-01' }, TODAY);
    const pure = calendarMonthOf(pilot, { mjesec: '2020-01' }, TODAY);

    for (const [index, row] of month.rows.entries()) {
      for (const [column, cell] of row.cells.entries()) {
        if (row.date === '2020-01-01' && cell.teamId === 'pilot-smjena-a') {
          expect(cell).toMatchObject({ shiftTypeId: 'pilot-noc', name: 'Noć', range: '19:00–07:00', modifiers: ['overridden'] });
        } else {
          expect(cell, `${cell.teamId} on ${row.date}`).toEqual(pure.rows[index]!.cells[column]);
        }
      }
    }
    expect(legendOf(month.rows.flatMap((row) => row.cells))).toEqual(['overridden']);
    expect(gridCellLabelsOf(month, translate)[0]![0]).toBe('srijeda 01.01., Smjena A, Noć, 19:00–07:00, Izmijenjeno');
  });

  it("marks the day in the viewer's day list, with its legend", async () => {
    const snapshot = await overridden();
    const days = daysOf(calendarMonthOf(snapshot, { mjesec: '2020-01' }, TODAY))!;

    expect(soleCellOf(days[0]!)).toMatchObject({ name: 'Noć', modifiers: ['overridden'] });
    expect(days.slice(1).every((day) => soleCellOf(day)?.modifiers.length === 0)).toBe(true);
    expect(legendOf(days.map((day) => soleCellOf(day)))).toEqual(['overridden']);
  });

  it('ignores an override on a day with no rotation: no mark, no legend', async () => {
    const snapshot = await snapshotOf(PILOT, {
      overrides: [calendarOverrideRow('o1', 'pilot-smjena-a', '2019-12-31', 'pilot-noc')],
    });
    const month = calendarMonthOf(snapshot, { mjesec: '2019-12' }, TODAY);

    expect(month.rows.at(-1)!.cells[0]).toMatchObject({ shiftTypeId: null, modifiers: [] });
    expect(legendOf(month.rows.flatMap((row) => row.cells))).toEqual([]);
  });
});

describe('an override a rotation change left pending (story 3.5c)', () => {
  // Smjena A changes phase from 2026-09-20, saved after the override on the
  // 21st was written (2026-09-12): that override is pending, and not applied.
  const changed: FixtureRows = {
    ...PILOT,
    assignments: [
      ...PILOT.assignments,
      assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-2', '2026-09-20', '2026-09-20', undefined, {
        createdAt: '2026-09-15T10:00:00+00:00',
      }),
    ],
  };
  const onTeam = { viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)])] };

  it("leaves the viewer's day list and the chosen person's as the pure projection, unmarked", async () => {
    const pending = await snapshotOf(changed, {
      ...onTeam,
      overrides: [calendarOverrideRow('o1', 'pilot-smjena-a', '2026-09-21', 'pilot-dan')],
    });
    const pure = await snapshotOf(changed, onTeam);
    const search = { mjesec: '2026-09', osoba: VIEWER_MEMBER };
    const month = calendarMonthOf(pending, search, TODAY);
    const expected = calendarMonthOf(pure, search, TODAY);

    expect(month.person?.id).toBe(VIEWER_MEMBER);
    expect(month.days).toEqual(expected.days);
    expect(month.person?.days).toEqual(expected.person?.days);
    const days = daysOf(month)!;
    const day = days.find((one) => one.date === '2026-09-21');

    expect((day === undefined ? undefined : soleCellOf(day)?.modifiers)).toEqual([]);
    expect(month.rows.flatMap((row) => row.cells).every((cell) => cell.modifiers.length === 0)).toBe(true);
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
    expect(calendarSearchTo({ mjesec: '2026-10' }, { smjena: 'A', osoba: null })).toEqual({
      mjesec: '2026-10',
      smjena: 'A',
    });
    expect(calendarSearchTo({ smjena: 'A' }, { smjena: 'B', osoba: null })).toEqual({ smjena: 'B' });
    // Matrix: reset — the search without `smjena`, the other params kept.
    expect(
      calendarSearchTo({ mjesec: '2026-10', prikaz: 'sve', smjena: 'A' }, { smjena: null, osoba: null }),
    ).toEqual({
      mjesec: '2026-10',
      prikaz: 'sve',
    });
    // Never a mode or a team the viewer did not choose.
    expect(calendarSearchTo({}, { smjena: null, osoba: null })).toEqual({});
    expect(calendarSearchTo({}, { mjesec: '2026-10' })).toEqual({ mjesec: '2026-10' });
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
    expect(unfiltered!.every((day) => soleTeamOf(day) === own)).toBe(true);
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

    expect(month.filter).toEqual({
      teams: [],
      chosen: null,
      people: [{ id: VIEWER_MEMBER, name: VIEWER_NAME, teamId: null, teamName: null }],
      person: null,
      teamCounts: {},
    });
  });
});

describe('the person filter (story 3.3b)', () => {
  const COLLEAGUE = '00000000-0000-4000-8000-0000000000c1';
  const SPARE = '00000000-0000-4000-8000-0000000000c2';
  const INACTIVE = '00000000-0000-4000-8000-0000000000c9';

  /**
   * The pilot with the viewer on Smjena A, a colleague on Smjena A who moves
   * to Smjena B on 2026-09-15, a spare on no team, and a member inactive today
   * whom `calendar_members()` names but the filter, by `activeOn`, does not
   * offer (story 3.4a).
   */
  async function withColleagues(): Promise<CalendarSnapshot> {
    return snapshotOf(PILOT, {
      versions: [
        memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED),
        memberMembershipRow(COLLEAGUE, 'pilot-smjena-a', SEEDED),
        memberMembershipRow(COLLEAGUE, 'pilot-smjena-b', '2026-09-15'),
        memberMembershipRow(INACTIVE, 'pilot-smjena-c', SEEDED),
      ],
      statuses: [statusRow(INACTIVE, false, '2026-09-01')],
      members: [
        calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
        calendarMemberRow(COLLEAGUE, 'Ante Babić'),
        calendarMemberRow(SPARE, 'Toni Bezsmjene'),
        calendarMemberRow(INACTIVE, 'Zoran Umirovljeni'),
      ],
    });
  }

  let colleagues: CalendarSnapshot;

  beforeAll(async () => {
    colleagues = await withColleagues();
  });

  it('keeps any non-empty osoba and drops anything else', () => {
    expect(calendarSearchOf({ osoba: COLLEAGUE })).toEqual({ osoba: COLLEAGUE });
    expect(calendarSearchOf({ osoba: 'nobody', smjena: 'A' })).toEqual({ smjena: 'A', osoba: 'nobody' });
    for (const bad of ['', 7, null, undefined, [COLLEAGUE], { id: COLLEAGUE }]) {
      expect(calendarSearchOf({ osoba: bad, mjesec: '2026-10' }), String(bad)).toEqual({ mjesec: '2026-10' });
    }
  });

  it('keeps the person on a month change and on a mode change', () => {
    // Matrix: month / mode change — `osoba` kept.
    expect(calendarSearchTo({ osoba: 'P', prikaz: 'sve' }, { mjesec: '2026-10' })).toEqual({
      mjesec: '2026-10',
      prikaz: 'sve',
      osoba: 'P',
    });
    expect(calendarSearchTo({ mjesec: '2026-10', osoba: 'P' }, { mjesec: null })).toEqual({ osoba: 'P' });
    expect(calendarSearchTo({ osoba: 'P' }, { prikaz: 'moj' })).toEqual({ prikaz: 'moj', osoba: 'P' });
  });

  it('offers every person active today, with their team for the month, and chooses nobody without osoba', () => {
    const month = calendarMonthOf(colleagues, {}, TODAY);

    // Story 7.5: the colleague moved to B on 2026-09-15, so B is their team
    // for this month; the spare is on none.
    expect(month.filter.people).toEqual([
      { id: COLLEAGUE, name: 'Ante Babić', teamId: 'pilot-smjena-b', teamName: 'Smjena B' },
      { id: VIEWER_MEMBER, name: VIEWER_NAME, teamId: 'pilot-smjena-a', teamName: 'Smjena A' },
      { id: SPARE, name: 'Toni Bezsmjene', teamId: null, teamName: null },
    ]);
    expect(month.filter.person).toBeNull();
    expect(month.person).toBeNull();
  });

  it("counts each active team's people by their team for the month, and gives the person shown theirs (story 7.5)", () => {
    const month = calendarMonthOf(colleagues, {}, TODAY);

    expect(month.filter.teamCounts['pilot-smjena-a']).toBe(1);
    expect(month.filter.teamCounts['pilot-smjena-b']).toBe(1);
    expect(month.filter.teamCounts['pilot-smjena-c']).toBe(0);
    expect(Object.keys(month.filter.teamCounts)).toEqual(month.filter.teams.map((team) => team.id));

    const shown = calendarMonthOf(colleagues, { osoba: COLLEAGUE }, TODAY).person;

    expect(shown).toMatchObject({ id: COLLEAGUE, teamId: 'pilot-smjena-b', teamName: 'Smjena B' });
    expect(calendarMonthOf(colleagues, { osoba: SPARE }, TODAY).person).toMatchObject({ teamId: null, teamName: null });
  });

  it('refuses a person whose team for the month the snapshot does not name (story 7.5)', () => {
    // The colleague is on B this month; a snapshot without B is a defect.
    const withoutB = { ...colleagues, teams: colleagues.teams.filter((team) => team.id !== 'pilot-smjena-b') };

    expect(() => calendarMonthOf(withoutB, {}, TODAY)).toThrow(RangeError);
  });

  it("reads a person's team for the month on their last active date (story 7.5)", () => {
    const memberships = [
      { teamId: 'a', effectiveFrom: '2026-01-01' },
      { teamId: 'b', effectiveFrom: '2026-09-15' },
    ] as unknown as Parameters<typeof monthTeamOf>[0]['memberships'];
    const september = ['2026-09-01', '2026-09-14', '2026-09-15', '2026-09-30'];

    expect(monthTeamOf({ memberships, statuses: [] }, september)).toBe('b');
    // Inactive from the 15th: their last active date is the 14th, on A.
    const leaving = [
      { active: true, effectiveFrom: '2026-01-01' },
      { active: false, effectiveFrom: '2026-09-15' },
    ] as unknown as Parameters<typeof monthTeamOf>[0]['statuses'];

    expect(monthTeamOf({ memberships, statuses: leaving }, september)).toBe('a');
    expect(monthTeamOf({ memberships, statuses: leaving }, ['2026-10-01'])).toBeNull();
    expect(monthTeamOf({ memberships: [], statuses: [] }, september)).toBeNull();
  });

  it("shows the chosen person's day list, headed with their name, across a mid-month move", () => {
    // Matrix: person chosen; mid-month move — days 1–14 A's type, 15+ B's.
    const month = calendarMonthOf(colleagues, { mjesec: '2026-09', osoba: COLLEAGUE }, TODAY);
    const grid = calendarMonthOf(colleagues, { mjesec: '2026-09' }, TODAY);
    const a = grid.columns.findIndex((team) => team.id === 'pilot-smjena-a');
    const b = grid.columns.findIndex((team) => team.id === 'pilot-smjena-b');

    expect(month.filter.person).toBe(COLLEAGUE);
    expect(month.person?.id).toBe(COLLEAGUE);
    expect(month.person?.name).toBe('Ante Babić');
    if (month.person === null || !month.person.days.ok) throw new Error('no day list');
    const days = month.person.days.days!;

    expect(days).toHaveLength(30);
    for (const [index, day] of days.entries()) {
      const column = day.date < '2026-09-15' ? a : b;

      expect(soleTeamOf(day), day.date).toBe(day.date < '2026-09-15' ? 'pilot-smjena-a' : 'pilot-smjena-b');
      expect(soleCellOf(day), day.date).toEqual(grid.rows[index]!.cells[column]);
    }
    expect(month.person.days.days).toEqual(
      calendarDayListOf(colleagues, { ...colleagues.members.find((one) => one.id === COLLEAGUE)!, memberId: COLLEAGUE }, '2026-09', TODAY),
    );
    // The grid is not narrowed by a person, and the viewer's own list is theirs.
    expect(month.columns).toEqual(grid.columns);
    expect(month.rows).toEqual(grid.rows);
    expect(month.days).toEqual(grid.days);
  });

  it('says a person on no team all month is on none, never an empty list', () => {
    // Matrix: no team this month.
    const month = calendarMonthOf(colleagues, { mjesec: '2026-09', osoba: SPARE }, TODAY);

    expect(month.person).toEqual({
      id: SPARE,
      name: 'Toni Bezsmjene',
      teamId: null,
      teamName: null,
      days: { ok: true, days: null },
    });
  });

  it('ignores an unknown or inactive id: the grid, or the smjena team', () => {
    // Matrix: unknown / inactive id — as if absent.
    for (const osoba of ['nobody', INACTIVE]) {
      const month = calendarMonthOf(colleagues, { osoba }, TODAY);

      expect(month.filter.person, osoba).toBeNull();
      expect(month.person, osoba).toBeNull();
      expect(month.columns, osoba).toHaveLength(4);
      const narrowed = calendarMonthOf(colleagues, { osoba, smjena: 'pilot-smjena-b' }, TODAY);

      expect(narrowed.filter.chosen, osoba).toBe('pilot-smjena-b');
      expect(narrowed.columns.map((team) => team.id), osoba).toEqual(['pilot-smjena-b']);
    }
    const offered = calendarMonthOf(colleagues, {}, TODAY).filter.people;

    expect(chosenPersonOf({ osoba: INACTIVE }, offered)).toBeNull();
    expect(chosenPersonOf({ osoba: COLLEAGUE }, offered)).toBe(COLLEAGUE);
    expect(chosenPersonOf({}, offered)).toBeNull();
  });

  it('lets a person win over a team when a URL carries both', () => {
    // Matrix: both params — P's day list; the team filter reads `chosen: null`.
    const month = calendarMonthOf(colleagues, { smjena: 'pilot-smjena-b', osoba: COLLEAGUE }, TODAY);

    expect(month.filter.chosen).toBeNull();
    expect(month.filter.person).toBe(COLLEAGUE);
    expect(month.person?.id).toBe(COLLEAGUE);
    expect(month.columns).toHaveLength(4);
  });

  it("fails the person's day list alone, and the grid still draws", async () => {
    const broken = await withColleagues();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcome = calendarMonthOutcomeOf(
      {
        ...broken,
        // The 3.2a defect, on the person: a team whose rotation the grid
        // never projects, on a pattern with no steps. Archived but named, as
        // story 7.5's team for the month requires of every person's team.
        teams: [
          ...broken.teams,
          { id: 'archived-team', organizationId: broken.teams[0]!.organizationId, name: 'Stara smjena', archived: true },
        ],
        members: broken.members.map((one) =>
          one.id === COLLEAGUE
            ? { ...one, memberships: [{ teamId: 'archived-team', position: null, effectiveFrom: SEEDED }] }
            : one,
        ),
        assignments: [
          ...broken.assignments,
          {
            teamId: 'archived-team',
            patternId: 'no-steps',
            offsetStepId: 'missing',
            anchorDate: SEEDED,
            effectiveFrom: SEEDED,
          },
        ],
      },
      { mjesec: '2026-09', osoba: COLLEAGUE },
      TODAY,
    );

    quiet.mockRestore();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.month.person?.days).toEqual({ ok: false, code: CALENDAR_UNAVAILABLE });
    expect(outcome.month.days.ok).toBe(true);
    expect(outcome.month.rows).toEqual(calendarMonthOf(broken, { mjesec: '2026-09' }, TODAY).rows);
  });
});

describe('the roster as at a date (story 3.4a)', () => {
  const COLLEAGUE = '00000000-0000-4000-8000-0000000000c1';
  const RETIRED = '00000000-0000-4000-8000-0000000000c9';
  const RETURNED = '00000000-0000-4000-8000-0000000000c8';
  const LATER = '00000000-0000-4000-8000-0000000000c7';

  /**
   * The pilot, everyone on Smjena A from `SEEDED`: the viewer (inactive
   * 2026-09-05 to 2026-09-19), a colleague deactivated from 2026-09-30 (after
   * today), a member retired from 2026-09-10 (before today), and one who was
   * inactive from 2026-09-01 and active again from 2026-09-20.
   */
  async function withStatuses(): Promise<CalendarSnapshot> {
    return snapshotOf(PILOT, {
      viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)])],
      versions: [
        memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED),
        memberMembershipRow(COLLEAGUE, 'pilot-smjena-a', SEEDED, undefined, 'commander'),
        memberMembershipRow(RETIRED, 'pilot-smjena-a', SEEDED, undefined, 'driver'),
        memberMembershipRow(RETURNED, 'pilot-smjena-a', SEEDED),
        memberMembershipRow(LATER, 'pilot-smjena-a', '2026-09-16', undefined, 'firefighter'),
      ],
      statuses: [
        statusRow(VIEWER_MEMBER, false, '2026-09-05'),
        statusRow(VIEWER_MEMBER, true, '2026-09-20'),
        statusRow(COLLEAGUE, false, '2026-09-30'),
        statusRow(RETIRED, false, '2026-09-10'),
        statusRow(RETURNED, false, '2026-09-01'),
        statusRow(RETURNED, true, '2026-09-20'),
      ],
      members: [
        calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
        calendarMemberRow(COLLEAGUE, 'Ante Babić', 'nco'),
        calendarMemberRow(RETIRED, 'Zoran Umirovljeni', 'officer'),
        calendarMemberRow(RETURNED, 'Iva Povratnica'),
        calendarMemberRow(LATER, 'Dino Kasniji'),
      ],
    });
  }

  let snapshot: CalendarSnapshot;

  beforeAll(async () => {
    snapshot = await withStatuses();
  });

  /** `snapshot` with `id`'s status versions replaced by `statuses`. */
  function withStatusesOf(id: string, statuses: CalendarSnapshot['members'][number]['statuses']): CalendarSnapshot {
    return {
      ...snapshot,
      members: snapshot.members.map((member) => (member.id === id ? { ...member, statuses } : member)),
    };
  }

  it('offers every member active on at least one date of the month shown, in name order', () => {
    // Matrix: left this month — the member retired 2026-09-10 is offered in
    // September, as a Sati row, though inactive today.
    const month = calendarMonthOf(snapshot, { mjesec: '2026-09' }, TODAY);

    expect(month.filter.people.map((person) => person.id)).toEqual([
      COLLEAGUE,
      LATER,
      RETURNED,
      VIEWER_MEMBER,
      RETIRED,
    ]);
    expect(month.filter.people.map((person) => person.name)).toEqual(
      snapshot.members.map((member) => member.name),
    );
  });

  it("shows a member who left this month: their heading and day list, inactive dates as no team", () => {
    // Matrix: left this month — `osoba` names them, so their day list shows.
    const month = calendarMonthOf(snapshot, { mjesec: '2026-09', osoba: RETIRED }, TODAY);

    expect(month.filter.person).toBe(RETIRED);
    expect(month.person?.id).toBe(RETIRED);
    expect(month.person?.name).toBe('Zoran Umirovljeni');
    if (month.person === null || !month.person.days.ok) throw new Error('no day list');
    expect(month.person.days.days!.map((day) => soleTeamOf(day) !== null)).toEqual(
      datesOfSeptember().map((date) => date < '2026-09-10'),
    );
    expect(chosenPersonOf({ osoba: RETIRED }, month.filter.people)).toBe(RETIRED);
  });

  it('does not offer a member who left before the month shown, and their osoba is no person', () => {
    // Matrix: left before the month — October, the whole grid.
    const month = calendarMonthOf(snapshot, { mjesec: '2026-10', osoba: RETIRED }, TODAY);

    expect(month.filter.people.map((person) => person.id)).not.toContain(RETIRED);
    expect(month.filter.person).toBeNull();
    expect(month.person).toBeNull();
    const plain = calendarMonthOf(snapshot, { mjesec: '2026-10' }, TODAY);

    expect(month.columns.map((team) => team.id)).toEqual(plain.columns.map((team) => team.id));
    expect(month.rows).toEqual(plain.rows);
    expect(chosenPersonOf({ osoba: RETIRED }, month.filter.people)).toBeNull();
    // Everyone is still in the snapshot, the retired member included.
    expect(snapshot.members.map((member) => member.id)).toContain(RETIRED);
  });

  it('offers a member who becomes active later in the month shown, though inactive today', () => {
    // Matrix: joins later — first active 2026-09-16, and out again from
    // 2026-09-21, so inactive today: "active today" would not offer them.
    const joining = withStatusesOf(LATER, [
      { active: false, effectiveFrom: SEEDED },
      { active: true, effectiveFrom: '2026-09-16' },
      { active: false, effectiveFrom: '2026-09-21' },
    ]);
    const month = calendarMonthOf(joining, { mjesec: '2026-09', osoba: LATER }, TODAY);

    expect(month.filter.people.map((person) => person.id)).toContain(LATER);
    expect(month.filter.person).toBe(LATER);
    expect(month.person?.id).toBe(LATER);
  });

  it('offers a member active only on the first, or only on the last, day of the month shown', () => {
    // The month's edges: inactive from 2026-09-02, or active only from 2026-09-30.
    const firstDayOnly = withStatusesOf(LATER, [{ active: false, effectiveFrom: '2026-09-02' }]);
    const lastDayOnly = withStatusesOf(LATER, [
      { active: false, effectiveFrom: SEEDED },
      { active: true, effectiveFrom: '2026-09-30' },
    ]);

    for (const [label, edge] of [
      ['first day', firstDayOnly],
      ['last day', lastDayOnly],
    ] as const) {
      const month = calendarMonthOf(edge, { mjesec: '2026-09', osoba: LATER }, TODAY);

      expect(month.filter.people.map((person) => person.id), label).toContain(LATER);
      expect(month.person?.id, label).toBe(LATER);
    }
    // And neither is offered in a month they are inactive throughout.
    expect(calendarMonthOf(firstDayOnly, { mjesec: '2026-10' }, TODAY).filter.people.map((one) => one.id)).not.toContain(
      LATER,
    );
    expect(calendarMonthOf(lastDayOnly, { mjesec: '2026-08' }, TODAY).filter.people.map((one) => one.id)).not.toContain(
      LATER,
    );
  });

  it('does not offer a member inactive all month who is active only later', () => {
    // Matrix: inactive all month, active later — August, active from 2026-09-01 only.
    const starting = withStatusesOf(LATER, [
      { active: false, effectiveFrom: SEEDED },
      { active: true, effectiveFrom: '2026-09-01' },
    ]);
    const august = calendarMonthOf(starting, { mjesec: '2026-08', osoba: LATER }, TODAY);

    expect(august.filter.people.map((person) => person.id)).not.toContain(LATER);
    expect(august.filter.person).toBeNull();
    expect(august.person).toBeNull();
    expect(calendarMonthOf(starting, { mjesec: '2026-09' }, TODAY).filter.people.map((one) => one.id)).toContain(
      LATER,
    );
  });

  it('keeps osoba across months, and draws the whole grid where the person is inactive throughout', () => {
    // Matrix: kept across months — chosen in September, next month inactive.
    const september = { mjesec: '2026-09', osoba: RETIRED };
    const october = calendarSearchTo(september, { mjesec: '2026-10' });

    expect(october).toEqual({ mjesec: '2026-10', osoba: RETIRED });
    expect(calendarMonthOf(snapshot, september, TODAY).person?.id).toBe(RETIRED);
    const month = calendarMonthOf(snapshot, october, TODAY);

    expect(month.filter.person).toBeNull();
    expect(month.person).toBeNull();
    const plain = calendarMonthOf(snapshot, { mjesec: '2026-10' }, TODAY);

    expect(month.columns.map((team) => team.id)).toEqual(plain.columns.map((team) => team.id));
    expect(month.rows).toEqual(plain.rows);
  });

  it('draws the days a member is inactive as no team, and the rest as their team', () => {
    // Matrix: inactive on date — the day list says no team.
    const month = calendarMonthOf(snapshot, { mjesec: '2026-09' }, TODAY);
    const days = daysOf(month)!;
    const column = month.columns.findIndex((team) => team.id === 'pilot-smjena-a');

    for (const [index, day] of days.entries()) {
      const inactive = day.date >= '2026-09-05' && day.date < '2026-09-20';

      expect(soleTeamOf(day), day.date).toBe(inactive ? null : 'pilot-smjena-a');
      expect(soleCellOf(day), day.date).toEqual(inactive ? null : month.rows[index]!.cells[column]);
    }
    const returned = calendarMonthOf(snapshot, { mjesec: '2026-09', osoba: RETURNED }, TODAY).person;

    if (returned === null || !returned.days.ok) throw new Error('no day list');
    expect(returned.days.days!.map((day) => soleTeamOf(day) !== null)).toEqual(
      datesOfSeptember().map((date) => date >= '2026-09-20'),
    );
  });

  it('says a member inactive all month has no team, through kalendar.noTeam', async () => {
    // AC2: an empty state that says what is true, never a blank schedule.
    const inactive = await snapshotOf(PILOT, { statuses: [statusRow(VIEWER_MEMBER, false, '2026-08-01')] });

    expect(calendarMonthOf(inactive, { mjesec: '2026-09' }, TODAY).days).toEqual({ ok: true, days: null });
    expect(calendarMonthOf(pilot, { mjesec: '2019-12' }, TODAY).days).toEqual({ ok: true, days: null });
    expect(t('kalendar.noTeam')).toBe('Nisi član nijedne smjene.');
  });

  it("derives a team's roster on a date from the snapshot, members deactivated since included", () => {
    const roster = (date: string) => shiftRoster(snapshot.members, 'pilot-smjena-a', date);

    // Matrix: roster; deactivated since — the colleague (from the 30th) and
    // the retired member (from the 10th) are on the 4th's roster, with the
    // viewer (inactive from the 5th).
    expect(roster('2026-09-04')).toEqual([
      { memberId: COLLEAGUE, position: 'commander' },
      { memberId: VIEWER_MEMBER, position: null },
      { memberId: RETIRED, position: 'driver' },
    ]);
    // Matrix: inactive on date — the viewer and the returned member are absent.
    expect(roster('2026-09-09').map((entry) => entry.memberId)).toEqual([COLLEAGUE, RETIRED]);
    // Matrix: joined later — absent before, present from the 16th.
    expect(roster('2026-09-16').map((entry) => entry.memberId)).toEqual([COLLEAGUE, LATER]);
    // Matrix: reactivated — back on the 20th.
    expect(roster('2026-09-20').map((entry) => entry.memberId)).toEqual([COLLEAGUE, LATER, RETURNED, VIEWER_MEMBER]);
    expect(roster('2026-09-30').map((entry) => entry.memberId)).toEqual([LATER, RETURNED, VIEWER_MEMBER]);
    expect(shiftRoster(snapshot.members, 'pilot-smjena-b', '2026-09-20')).toEqual([]);
  });
});

function datesOfSeptember(): string[] {
  return Array.from({ length: 30 }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`);
}
