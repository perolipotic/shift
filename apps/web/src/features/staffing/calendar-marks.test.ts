import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { atWorkText } from '@/features/staffing/components/short-staffed-block';
import { calendarMarksOf, calendarMarksStateOf, MARKS_READY } from '@/features/calendar/services/marks';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  MODIFIER_SHORT_STAFFED,
  RING_BOTH_SHORT_STAFFED_CLASS,
  gridCellLabelsOf,
  legendOf,
  modifierTreatmentOf,
  type CellLabelTranslate,
} from '@/features/calendar/utils/modifiers';
import {
  NO_MARKS,
  calendarMonthOf,
  calendarMonthOutcomeOf,
  type CalendarMarks,
  type CalendarMonth,
} from '@/features/calendar/utils/month';
import { dayStaffingOf } from '@/features/staffing/services/short-staffed';
import {
  STAFFING_FIXTURES,
  firstDayOffOf,
  firstWorkingDayOf,
  leaveRow,
  member,
  rosterOverrideOn,
  staffingSnapshotOf,
} from '@/features/staffing/staffing.fixture';
import { initLocalization, t } from '@/lib/i18n';

/**
 * Story 11.3's matrix, executed (AD-15) over real snapshots of both fixtures:
 * the admin's marks carry the organization's leave while *Najmanje ljudi u
 * smjeni* is set, the month marks the grid cell of a short working shift
 * (`shortStaffed`, last in canonical order) and never a day-list cell, and
 * the day detail's line states people at work against the minimum. Short,
 * not short, composed with the rings, non-working, a member viewer, the
 * setting empty, and the refused data.
 */

const ONE = '00000000-0000-4000-8000-00000000d001';
const TWO = '00000000-0000-4000-8000-00000000d002';
const TODAY = '2026-10-01';

const translate: CellLabelTranslate = (key) => t(key);

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The admin's marks over `rows` of leave, as `calendarMarksOf` builds them, with no resolution. */
function marksOf(snapshot: CalendarSnapshot, rows: readonly unknown[]): CalendarMarks {
  return calendarMarksOf(snapshot, rows, []);
}

/** The grid of `date`'s month under `marks`. */
function monthOf(snapshot: CalendarSnapshot, date: string, marks: CalendarMarks): CalendarMonth {
  return calendarMonthOf(snapshot, { mjesec: date.slice(0, 7) }, TODAY, marks);
}

/** The first team's grid cell and its full label on `date`. */
function cellOn(month: CalendarMonth, teamId: string, date: string) {
  const rowIndex = month.rows.findIndex((row) => row.date === date);
  const column = month.columns.findIndex((team) => team.id === teamId);
  const cell = month.rows[rowIndex]?.cells[column];

  if (cell === undefined) throw new Error(`no cell on ${date}`);

  return { cell, label: gridCellLabelsOf(month, translate)[rowIndex]?.[column] ?? '' };
}

/**
 * Every grid cell of `teamId` carrying the short-staffed mark, as
 * `teamId|date`. The fixtures' other teams have no members, so each of their
 * working shifts is short under any minimum: only the team under test is read.
 */
function shortCellsOf(month: CalendarMonth, teamId: string): string[] {
  return month.rows.flatMap((row) =>
    row.cells
      .filter((cell) => cell.teamId === teamId && cell.modifiers.includes(MODIFIER_SHORT_STAFFED))
      .map((cell) => `${cell.teamId}|${row.date}`),
  );
}

/** The day detail's line as the dialog words it. */
function lineOf(staffing: ReturnType<typeof dayStaffingOf>): string | null {
  if (staffing === null) return null;

  const atWork = atWorkText(staffing.atWork, staffing.minimum);

  return staffing.short ? t('popunjenost.dayShort', { atWork }) : atWork;
}

describe.each(STAFFING_FIXTURES)('$name', (fixture) => {
  it('short: a team of 4, minimum 3, two on leave — the cell, its label, the legend and the line', async () => {
    const snapshot = await staffingSnapshotOf(fixture, { size: 4, minimum: 3 });
    const { date } = firstWorkingDayOf(snapshot, fixture);
    const marks = marksOf(snapshot, [leaveRow(ONE, member(1), date, date), leaveRow(TWO, member(2), date, date)]);

    expect(marks.staffingLeave?.map((record) => record.id).sort()).toEqual([ONE, TWO]);

    const month = monthOf(snapshot, date, marks);
    const { cell, label } = cellOn(month, fixture.team, date);

    // Last in canonical order, after the conflict and leave the two records raise.
    expect(cell.modifiers.at(-1)).toBe(MODIFIER_SHORT_STAFFED);
    expect(label).toMatch(new RegExp(`, ${cell.name ?? ''}, ${cell.range ?? ''}(, [^,]+)*, Premalo ljudi$`));
    expect(shortCellsOf(month, fixture.team)).toEqual([`${fixture.team}|${date}`]);
    expect(legendOf(month.rows.flatMap((row) => row.cells))).toContain(MODIFIER_SHORT_STAFFED);

    const staffing = dayStaffingOf(snapshot, marks.staffingLeave, fixture.team, date);

    expect(staffing).toEqual({ atWork: 2, minimum: 3, short: true });
    expect(lineOf(staffing)).toBe('Premalo ljudi: rade 2 od najmanje 3');
  });

  it('not short: one on leave — no mark anywhere, and the line without the words', async () => {
    const snapshot = await staffingSnapshotOf(fixture, { size: 4, minimum: 3 });
    const { date } = firstWorkingDayOf(snapshot, fixture);
    const marks = marksOf(snapshot, [leaveRow(ONE, member(1), date, date)]);
    const month = monthOf(snapshot, date, marks);

    expect(shortCellsOf(month, fixture.team)).toEqual([]);
    expect(cellOn(month, fixture.team, date).label).not.toMatch(/Premalo ljudi/);

    const staffing = dayStaffingOf(snapshot, marks.staffingLeave, fixture.team, date);

    expect(staffing).toEqual({ atWork: 3, minimum: 3, short: false });
    expect(lineOf(staffing)).toBe('rade 3 od najmanje 3');
  });

  it('composed: short, in conflict and overridden — both rings, the edge inside them, and every glyph', async () => {
    const probe = await staffingSnapshotOf(fixture, { size: 4, minimum: 3 });
    const { date } = firstWorkingDayOf(probe, fixture);
    // Member 3 taken off by a roster override (overridden); members 1 and 2 on leave (conflict, leave).
    const snapshot = await staffingSnapshotOf(fixture, {
      size: 4,
      minimum: 3,
      rosterOverrides: [rosterOverrideOn(fixture, date, member(3), null)],
    });
    const marks = marksOf(snapshot, [leaveRow(ONE, member(1), date, date), leaveRow(TWO, member(2), date, date)]);
    const { cell } = cellOn(monthOf(snapshot, date, marks), fixture.team, date);

    expect(cell.modifiers).toEqual(['conflict', 'overridden', 'leave', 'shortStaffed']);

    const treatment = modifierTreatmentOf(cell.modifiers);

    expect(treatment.className.split(' ')).toContain(RING_BOTH_SHORT_STAFFED_CLASS);
    expect(treatment.glyphs).toHaveLength(4);
    expect(dayStaffingOf(snapshot, marks.staffingLeave, fixture.team, date)).toEqual({ atWork: 1, minimum: 3, short: true });
  });

  it('an archived team: the grid never draws it, so the day detail has no line either', async () => {
    const live = await staffingSnapshotOf(fixture, { size: 4, minimum: 3 });
    const { date } = firstWorkingDayOf(live, fixture);
    const marks = marksOf(live, [leaveRow(ONE, member(1), date, date), leaveRow(TWO, member(2), date, date)]);
    const archived: CalendarSnapshot = {
      ...live,
      teams: live.teams.map((team) => (team.id === fixture.team ? { ...team, archived: true } : team)),
    };

    expect(dayStaffingOf(live, marks.staffingLeave, fixture.team, date)?.short).toBe(true);
    expect(dayStaffingOf(archived, marks.staffingLeave, fixture.team, date)).toBeNull();
  });

  it('non-working: a day off is never marked and has no line', async () => {
    const snapshot = await staffingSnapshotOf(fixture, { size: 4, minimum: 3 });
    const date = firstDayOffOf(snapshot, fixture);
    const marks = marksOf(snapshot, [leaveRow(ONE, member(1), date, date), leaveRow(TWO, member(2), date, date)]);
    const { cell } = cellOn(monthOf(snapshot, date, marks), fixture.team, date);

    expect(cell.modifiers).not.toContain(MODIFIER_SHORT_STAFFED);
    expect(dayStaffingOf(snapshot, marks.staffingLeave, fixture.team, date)).toBeNull();
  });

  it('a member viewer: no organization leave in the marks, so no mark and no line', async () => {
    const snapshot = await staffingSnapshotOf(fixture, { size: 4, minimum: 1, role: 'member_role' });
    const { date } = firstWorkingDayOf(snapshot, fixture);
    const marks = marksOf(snapshot, []);

    expect(marks.staffingLeave).toBeNull();
    expect(shortCellsOf(monthOf(snapshot, date, marks), fixture.team)).toEqual([]);
    expect(dayStaffingOf(snapshot, marks.staffingLeave, fixture.team, date)).toBeNull();
  });

  it('the setting empty: no leave carried, no mark, no legend entry and no line', async () => {
    const snapshot = await staffingSnapshotOf(fixture, { size: 4, minimum: null });
    const { date } = firstWorkingDayOf(snapshot, fixture);
    const marks = marksOf(snapshot, [leaveRow(ONE, member(1), date, date), leaveRow(TWO, member(2), date, date)]);
    const month = monthOf(snapshot, date, marks);

    expect(marks.staffingLeave).toBeNull();
    expect(shortCellsOf(month, fixture.team)).toEqual([]);
    expect(legendOf(month.rows.flatMap((row) => row.cells))).not.toContain(MODIFIER_SHORT_STAFFED);
    expect(dayStaffingOf(snapshot, marks.staffingLeave, fixture.team, date)).toBeNull();
    // NO_MARKS carries nothing either.
    expect(NO_MARKS.staffingLeave).toBeNull();
  });

  it('the grid alone: a day-list cell never carries the mark, as `uncovered`', async () => {
    const snapshot = await staffingSnapshotOf(fixture, { size: 1, minimum: 3 });
    const { date } = firstWorkingDayOf(snapshot, fixture);
    const marks = marksOf(snapshot, []);
    const month = monthOf(snapshot, date, marks);

    // The viewer alone on the team: every working shift of the month is short on the grid.
    expect(shortCellsOf(month, fixture.team)).toContain(`${fixture.team}|${date}`);
    const days = month.days.ok ? month.days.days : null;

    expect(days).not.toBeNull();
    expect(
      (days ?? []).flatMap((day) => day.shifts).filter((shift) => shift.cell.modifiers.includes(MODIFIER_SHORT_STAFFED)),
    ).toEqual([]);
  });

  it('refused data: a leave record the staffing rule refuses makes the calendar unavailable, logged', async () => {
    const snapshot = await staffingSnapshotOf(fixture, { size: 4, minimum: 3 });
    const { date } = firstWorkingDayOf(snapshot, fixture);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const marks: CalendarMarks = {
      ...NO_MARKS,
      // Ends before it starts: `shortStaffedShiftsOf` throws a RangeError.
      staffingLeave: [{ id: ONE, memberId: member(1), from: date, to: '2026-01-01' }],
    };

    expect(calendarMonthOutcomeOf(snapshot, { mjesec: date.slice(0, 7) }, TODAY, marks)).toEqual({
      ok: false,
      code: 'CALENDAR_UNAVAILABLE',
    });
    expect(error).toHaveBeenCalled();
  });

  it('the marks state carries the same records the month derives from', async () => {
    const snapshot = await staffingSnapshotOf(fixture, { size: 4, minimum: 3 });
    const { date } = firstWorkingDayOf(snapshot, fixture);
    const rows = [leaveRow(ONE, member(1), date, date)];
    const state = calendarMarksStateOf(
      snapshot,
      { data: rows, isError: false, isPending: false, fetchStatus: 'idle' },
      { data: [], isError: false, isPending: false, fetchStatus: 'idle' },
    );

    expect(state.kind).toBe(MARKS_READY);
    if (state.kind === MARKS_READY) expect(state.marks.staffingLeave?.map((record) => record.id)).toEqual([ONE]);
  });
});
