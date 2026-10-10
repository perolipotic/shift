import {
  HOURS_FIGURE_BAND,
  HOURS_FIGURE_LEAVE,
  HOURS_FIGURE_TOTAL,
  HOURS_SOURCE_ROTATION,
  leaveDaysOfMonth,
  memberHoursOfMonth,
  memberScheduleOfMonth,
  type HoursFigureCode,
} from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
  type HoursExplanationView,
} from '@/features/hours/services/hours-explanation';
import { figureIsEmpty, figureOf, memberHoursInputOf, memberLeaveDatesOf } from '@/features/hours/services/my-hours';
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

  return { ...actual, memberLeaveDatesOf: vi.fn(actual.memberLeaveDatesOf) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf(PILOT);
  uj5 = await snapshotOf(UJ5);
});

function explained(snapshot: CalendarSnapshot, figure: HoursFigureCode, memberId: string | null = null): HoursExplanationView {
  const view = hoursExplanationOf(snapshot, { memberId, figure }, HEADER, [], [], new Map(), []);

  if (view === null) throw new Error('refused');

  return view;
}

/** An hours equation: the total's or a band's. */
function hoursOf(snapshot: CalendarSnapshot, figure: HoursFigureCode, memberId: string | null = null) {
  const view = explained(snapshot, figure, memberId);

  if (view.kind !== EXPLANATION_HOURS) throw new Error(view.kind);

  return view;
}

/** The leave's equation over `records`. */
function leaveOf(snapshot: CalendarSnapshot, records: ReadonlyMap<string, readonly { from: string; to: string }[]>) {
  const view = hoursExplanationOf(snapshot, { memberId: null, figure: { code: HOURS_FIGURE_LEAVE } }, HEADER, [], [], records, []);

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
    const figures: readonly (readonly [HoursFigureCode, number])[] = [
      [{ code: HOURS_FIGURE_TOTAL }, hours.totalMinutes],
      ...hours.bands.map((band): readonly [HoursFigureCode, number] => [
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
    expect(explained(pilot, { code: HOURS_FIGURE_LEAVE }).figureName).toBe(t('sati.leave'));
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
    const record = { from: '2026-09-05', to: '2026-09-12' };
    const records = new Map([[VIEWER_MEMBER, [record]]]);
    const dates = leaveDaysOfMonth(memberScheduleInputOf(shot, shot.viewer), [record], MONTH);
    const view = leaveOf(shot, records);

    expect(dates.length).toBeGreaterThan(0);
    expect(view.figureName).toBe(t('sati.leave'));
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
    expect(explained(pilot, { code: HOURS_FIGURE_LEAVE }).lines).toEqual([]);
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

    vi.mocked(memberLeaveDatesOf).mockReturnValueOnce([off.date]);

    expect(
      hoursExplanationOf(pilot, { memberId: null, figure: { code: HOURS_FIGURE_LEAVE } }, HEADER, [], [], new Map(), []),
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
