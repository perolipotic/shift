import {
  HOURS_FIGURE_BAND,
  HOURS_FIGURE_LEAVE,
  HOURS_FIGURE_TOTAL,
  HOURS_SOURCE_ROTATION,
  leaveDaysOfMonth,
  memberHoursOfMonth,
  memberScheduleOfMonth,
} from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ANNUAL_LEAVE_ID } from '@/features/absence-types/services/list';
import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf, monthHeaderOf } from '@/features/calendar/utils/month';
import {
  EXPLANATION_HOURS,
  EXPLANATION_LEAVE,
  LEAVE_DECISION_ACCEPTED,
  LEAVE_DECISION_REPLACED,
  hoursExplanationOf,
  hoursSourceMessageKey,
  leaveDecisionMessageKey,
  type HoursExplainFigure,
  type HoursExplanationView,
} from '@/features/hours/services/hours-explanation';
import type { LeaveRecordsByMember } from '@/features/hours/services/hours-conflicts';
import {
  OTHER_ABSENCE_COLUMN,
  figureIsEmpty,
  figureOf,
  memberHoursInputOf,
  memberLeaveDatesByColumnOf,
} from '@/features/hours/services/my-hours';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  TODAY,
  UJ5,
  VIEWER_MEMBER,
  calendarOrganizationRow,
  calendarTableOf,
  membersAnswerOf,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 7.14's rules, executed: a figure's explanation names the domain's
 * operands and sums to the figure on the view exactly (FR-42b, DI-7). Every
 * explanation is compared against `memberHoursOfMonth` itself.
 */

const MONTH = '2026-09';
const HEADER = monthHeaderOf(MONTH, TODAY);

async function snapshotOf(rows: FixtureRows): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    { data: [calendarOrganizationRow(rows)], error: null, count: 1 },
    membersAnswerOf(),
    overridesAnswerOf(),
    rosterOverridesAnswerOf([]),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

let pilot: CalendarSnapshot;
let uj5: CalendarSnapshot;

// The leave's dates through a spy that keeps the real ones, so one test can
// hand the equation a date the schedule cannot charge.
vi.mock('@/features/hours/services/my-hours', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/hours/services/my-hours')>();

  return { ...actual, memberLeaveDatesByColumnOf: vi.fn(actual.memberLeaveDatesByColumnOf) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf(PILOT);
  uj5 = await snapshotOf(UJ5);
});

function explained(snapshot: CalendarSnapshot, figure: HoursExplainFigure, memberId: string | null = null): HoursExplanationView {
  const view = hoursExplanationOf(snapshot, { memberId, figure }, HEADER, [], [], new Map(), []);

  if (view === null) throw new Error('refused');

  return view;
}

/** An hours equation: the total's or a band's. */
function hoursOf(snapshot: CalendarSnapshot, figure: HoursExplainFigure, memberId: string | null = null) {
  const view = explained(snapshot, figure, memberId);

  if (view.kind !== EXPLANATION_HOURS) throw new Error(view.kind);

  return view;
}

/** The leave's equation over `records`. */
function leaveOf(snapshot: CalendarSnapshot, records: LeaveRecordsByMember, column: string = ANNUAL_LEAVE_ID) {
  const view = hoursExplanationOf(snapshot, { memberId: null, figure: { code: HOURS_FIGURE_LEAVE, column } }, HEADER, [], [], records, []);

  if (view === null) throw new Error('refused');
  if (view.kind !== EXPLANATION_LEAVE) throw new Error(view.kind);

  return view;
}

describe('an explained figure is the figure on the view', () => {
  it.each([
    ['pilot', () => pilot],
    ['UJ-5', () => uj5],
  ])('%s: the total and each band equal the domain\'s figures, and the lines add up', (_name, snapshot) => {
    const shot = snapshot();
    const hours = memberHoursOfMonth(memberHoursInputOf(shot), MONTH);
    const figures: readonly (readonly [HoursExplainFigure, number])[] = [
      [{ code: HOURS_FIGURE_TOTAL }, hours.totalMinutes],
      ...hours.bands.map((band): readonly [HoursExplainFigure, number] => [
        { code: HOURS_FIGURE_BAND, bandId: band.bandId },
        band.minutes,
      ]),
    ];

    for (const [figure, minutes] of figures) {
      const view = hoursOf(shot, figure);

      expect(view.total).toEqual(figureOf(minutes));
      expect(figureIsEmpty(view.total)).toBe(minutes === 0);
      expect(view.lines.length > 0).toBe(minutes > 0);
      // Read back from the display values: the lines are the equation, and it sums.
      const amounts = view.lines.map((line) => line.amount);

      expect(amounts.reduce((sum, amount) => sum + amount.values.hours * 60 + amount.values.minutes, 0)).toBe(minutes);
    }
  });

  it('names each shift: its date as 23.09.2026, its team and shift type as stored, and where it came from', () => {
    const view = hoursOf(pilot, { code: HOURS_FIGURE_TOTAL });
    const first = view.lines[0];

    expect(first?.date).toMatch(/^\d{2}\.\d{2}\.2026$/);
    expect(first?.label).toMatch(/^Smjena [A-D] · (Dan|Noć) · rotacija$/);
    expect(first?.source).toBe(HOURS_SOURCE_ROTATION);
    expect(t(hoursSourceMessageKey(HOURS_SOURCE_ROTATION))).toBe('rotacija');
    expect(new Set(view.lines.map((line) => line.key)).size).toBe(view.lines.length);
  });

  it('heads the figure with its name, the band as stored, and the month', () => {
    const band = pilot.bands[0]!;

    expect(explained(pilot, { code: HOURS_FIGURE_TOTAL }).figureName).toBe(t('sati.total'));
    expect(explained(pilot, { code: HOURS_FIGURE_LEAVE, column: ANNUAL_LEAVE_ID }).figureName).toBe('Godišnji odmor');
    expect(explained(pilot, { code: HOURS_FIGURE_BAND, bandId: band.id }).figureName).toBe(band.name);
    expect(explained(pilot, { code: HOURS_FIGURE_TOTAL }).context).toBe(`${HEADER.monthName} ${HEADER.year}.`);
  });

  it('names another member in the context, and the viewer by an explicit id as the same figure', () => {
    const own = explained(pilot, { code: HOURS_FIGURE_TOTAL });
    const byId = explained(pilot, { code: HOURS_FIGURE_TOTAL }, VIEWER_MEMBER);

    expect(byId.total).toEqual(own.total);
    expect(byId.lines).toEqual(own.lines);
    expect(byId.context).toContain(pilot.members.find((member) => member.id === VIEWER_MEMBER)!.name);
  });
});

describe('the leave is explained in days', () => {
  it.each([
    ['pilot', () => pilot],
    ['UJ-5', () => uj5],
  ])('%s: a line per charged date with each shift\'s team and type, +1 dan each, = the domain\'s count', (_name, snapshot) => {
    const shot = snapshot();
    const record = { from: '2026-09-05', to: '2026-09-12', absenceTypeId: ANNUAL_LEAVE_ID, drawsAllowance: true };
    const records = new Map([[VIEWER_MEMBER, [record]]]);
    const dates = leaveDaysOfMonth(memberScheduleInputOf(shot, shot.viewer), [record], MONTH);
    const view = leaveOf(shot, records);

    expect(dates.length).toBeGreaterThan(0);
    expect(view.figureName).toBe('Godišnji odmor');
    expect(view.lines.map((line) => line.key)).toEqual(dates);
    for (const line of view.lines) {
      expect(line.date).toMatch(/^\d{2}\.\d{2}\.2026$/);
      expect(line.label).toMatch(/^Smjena [A-D] · [^,·]+((, | i )Smjena [A-D] · [^,·]+)*$/);
      // Nothing is decided here: no decision word on any line.
      expect(line.decisions).toEqual([]);
      expect(t(line.amount.key, line.amount.values)).toBe('1 dan');
    }
    expect(t(view.total.key, view.total.values)).toBe(`${String(dates.length)} dana`);
  });

  it('has no line without a record', () => {
    expect(explained(pilot, { code: HOURS_FIGURE_LEAVE, column: ANNUAL_LEAVE_ID }).lines).toEqual([]);
  });

  it('names each decision in words: the resolved queue\'s own', () => {
    expect(t(leaveDecisionMessageKey(LEAVE_DECISION_ACCEPTED))).toBe('Prihvaćeno kao nepokriveno');
    expect(t(leaveDecisionMessageKey(LEAVE_DECISION_REPLACED))).toBe('Zamjena osobe');
  });

  it('is unavailable, never a nameless line, when a charged date has no working shift', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const input = memberScheduleInputOf(pilot, pilot.viewer);
    const working = new Set(input.workingShiftTypeIds);
    const off = memberScheduleOfMonth(input, MONTH).find(
      (day) => !day.shifts.some((shift) => shift.shiftTypeId !== null && working.has(shift.shiftTypeId)),
    )!;

    vi.mocked(memberLeaveDatesByColumnOf).mockReturnValueOnce([[off.date]]);

    expect(
      hoursExplanationOf(pilot, { memberId: null, figure: { code: HOURS_FIGURE_LEAVE, column: ANNUAL_LEAVE_ID } }, HEADER, [], [], new Map(), []),
    ).toBeNull();
    expect(errors).toHaveBeenCalledWith(expect.any(String), expect.any(RangeError));
  });
});

describe('an explanation the domain refuses is null, never a guess', () => {
  it('is null for a band the snapshot lacks, and for a member it does not hold', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      hoursExplanationOf(pilot, { memberId: null, figure: { code: HOURS_FIGURE_BAND, bandId: 'nope' } }, HEADER, [], [], new Map(), []),
    ).toBeNull();
    expect(hoursExplanationOf(pilot, { memberId: 'nobody', figure: { code: HOURS_FIGURE_TOTAL } }, HEADER, [], [], new Map(), [])).toBeNull();
  });
});

describe('the leave is explained one leave column at a time (story 13.2)', () => {
  const SICK = '00000000-0000-4000-8000-00000000d001';

  it('names the column and lists only the dates of its own types', () => {
    const snapshot: CalendarSnapshot = {
      ...pilot,
      absenceTypes: [
        { id: ANNUAL_LEAVE_ID, organizationId: pilot.organizationId, name: 'Godišnji odmor', drawsAllowance: true },
        { id: SICK, organizationId: pilot.organizationId, name: 'Bolovanje', drawsAllowance: false },
      ],
    };
    const annual = { from: '2026-09-01', to: '2026-09-04', absenceTypeId: ANNUAL_LEAVE_ID, drawsAllowance: true };
    const sick = { from: '2026-09-07', to: '2026-09-12', absenceTypeId: SICK, drawsAllowance: false };
    const records = new Map([[VIEWER_MEMBER, [annual, sick]]]);
    const input = memberScheduleInputOf(snapshot, snapshot.viewer);
    const other = leaveOf(snapshot, records, OTHER_ABSENCE_COLUMN);
    const annualView = leaveOf(snapshot, records);

    expect(other.figureName).toBe('Ostala odsutnost');
    expect(other.lines.map((line) => line.key)).toEqual(leaveDaysOfMonth(input, [sick], MONTH));
    expect(annualView.figureName).toBe('Godišnji odmor');
    expect(annualView.lines.map((line) => line.key)).toEqual(leaveDaysOfMonth(input, [annual], MONTH));
  });

  it('is unavailable for a column the snapshot does not make', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      hoursExplanationOf(pilot, { memberId: null, figure: { code: HOURS_FIGURE_LEAVE, column: OTHER_ABSENCE_COLUMN } }, HEADER, [], [], new Map(), []),
    ).toBeNull();
    expect(errors).toHaveBeenCalledWith(expect.any(String), expect.any(RangeError));
  });
});
