import {
  HOURS_FIGURE_BAND,
  HOURS_FIGURE_LEAVE,
  HOURS_FIGURE_TOTAL,
  HOURS_SOURCE_ROTATION,
  memberHoursOfMonth,
  type HoursFigureCode,
} from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { monthHeaderOf } from '@/features/calendar/utils/month';
import {
  hoursExplanationOf,
  hoursSourceMessageKey,
  type HoursExplanationView,
} from '@/features/hours/services/hours-explanation';
import { figureIsEmpty, figureOf, memberHoursInputOf } from '@/features/hours/services/my-hours';
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

afterEach(() => {
  vi.restoreAllMocks();
});

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf(PILOT);
  uj5 = await snapshotOf(UJ5);
});

function explained(snapshot: CalendarSnapshot, figure: HoursFigureCode, memberId: string | null = null): HoursExplanationView {
  const view = hoursExplanationOf(snapshot, { memberId, figure }, HEADER, []);

  if (view === null) throw new Error('refused');

  return view;
}

describe('an explained figure is the figure on the view', () => {
  it.each([
    ['pilot', () => pilot],
    ['UJ-5', () => uj5],
  ])('%s: the total, each band and the leave equal the domain\'s figures, and the lines add up', (_name, snapshot) => {
    const shot = snapshot();
    const hours = memberHoursOfMonth(memberHoursInputOf(shot), MONTH);
    const figures: readonly (readonly [HoursFigureCode, number])[] = [
      [{ code: HOURS_FIGURE_TOTAL }, hours.totalMinutes],
      [{ code: HOURS_FIGURE_LEAVE }, hours.leaveMinutes],
      ...hours.bands.map((band): readonly [HoursFigureCode, number] => [
        { code: HOURS_FIGURE_BAND, bandId: band.bandId },
        band.minutes,
      ]),
    ];

    for (const [figure, minutes] of figures) {
      const view = explained(shot, figure);

      expect(view.total).toEqual(figureOf(minutes));
      expect(figureIsEmpty(view.total)).toBe(minutes === 0);
      expect(view.lines.length > 0).toBe(minutes > 0);
      // Read back from the display values: the lines are the equation, and it sums.
      expect(view.lines.reduce((sum, line) => sum + line.hours.values.hours * 60 + line.hours.values.minutes, 0)).toBe(minutes);
    }
  });

  it('names each shift: its date as 23.09.2026, its team and shift type as stored, and where it came from', () => {
    const view = explained(pilot, { code: HOURS_FIGURE_TOTAL });
    const first = view.lines[0];

    expect(first?.date).toMatch(/^\d{2}\.\d{2}\.2026$/);
    expect(first?.team).toMatch(/^Smjena [A-D]$/);
    expect(['Dan', 'Noć']).toContain(first?.shiftType);
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

describe('an explanation the domain refuses is null, never a guess', () => {
  it('is null for a band the snapshot lacks, and for a member it does not hold', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(hoursExplanationOf(pilot, { memberId: null, figure: { code: HOURS_FIGURE_BAND, bandId: 'nope' } }, HEADER, [])).toBeNull();
    expect(hoursExplanationOf(pilot, { memberId: 'nobody', figure: { code: HOURS_FIGURE_TOTAL } }, HEADER, [])).toBeNull();
  });
});
