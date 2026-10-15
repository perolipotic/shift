import { beforeAll, describe, expect, it } from 'vitest';

import {
  LEAVE_START_DAYS,
  LEAVE_START_LAST_DAY,
  LEAVE_START_MONTHS,
  currentLeaveYearOf,
  leaveYearStartLabel,
} from '@/features/organization/utils/leave-start';
import { initLocalization, t } from '@/lib/i18n';

beforeAll(async () => {
  await initLocalization();
});

describe("the leave year's start, as a day and a month", () => {
  it('offers the days 1 to 28 and nothing a February lacks', () => {
    expect(LEAVE_START_LAST_DAY).toBe(28);
    expect(LEAVE_START_DAYS).toHaveLength(28);
    expect(LEAVE_START_DAYS[0]).toBe(1);
    expect(LEAVE_START_DAYS.at(-1)).toBe(28);
  });

  it('names the twelve months in Croatian, valued 1 to 12', () => {
    expect(LEAVE_START_MONTHS.map((month) => month.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(LEAVE_START_MONTHS[0]?.label).toBe('siječanj');
    expect(LEAVE_START_MONTHS[11]?.label).toBe('prosinac');
  });

  it('states the start as a day and a month, in the binding shape and without a year', () => {
    expect(leaveYearStartLabel(1, 1)).toBe('01.01.');
    expect(leaveYearStartLabel(9, 28)).toBe('28.09.');
    expect(leaveYearStartLabel(13, 1)).toBeNull();
  });
});

describe('the current leave year, as the dialog states it (deferred work from 7.18)', () => {
  const ZAGREB = 'Europe/Zagreb';

  it('is the calendar year for a 01.01. start', () => {
    const current = currentLeaveYearOf({ month: 1, day: 1 }, ZAGREB, new Date('2026-10-13T10:00:00Z'));

    expect(current).toEqual({ from: '01.01.2026', to: '31.12.2026' });
    expect(t('organization.leaveYearCurrent', { from: current?.from, to: current?.to })).toBe(
      'Tekuća godina godišnjeg: 01.01.2026–31.12.2026',
    );
  });

  it('runs across the new year from a later start, and turns on its start day', () => {
    const start = { month: 7, day: 1 };

    expect(currentLeaveYearOf(start, ZAGREB, new Date('2026-03-01T10:00:00Z'))).toEqual({
      from: '01.07.2025',
      to: '30.06.2026',
    });
    expect(currentLeaveYearOf(start, ZAGREB, new Date('2026-07-01T10:00:00Z'))).toEqual({
      from: '01.07.2026',
      to: '30.06.2027',
    });
  });

  it("reads today in the organization's zone, never the device's", () => {
    // 23:30 UTC on 31.12. is already 01.01. in Zagreb: the new leave year.
    expect(currentLeaveYearOf({ month: 1, day: 1 }, ZAGREB, new Date('2026-12-31T23:30:00Z'))).toEqual({
      from: '01.01.2027',
      to: '31.12.2027',
    });
  });

  it('states no line for a start the domain refuses', () => {
    expect(currentLeaveYearOf({ month: 2, day: 30 }, ZAGREB, new Date('2026-10-13T10:00:00Z'))).toBeNull();
    expect(currentLeaveYearOf({ month: 13, day: 1 }, ZAGREB, new Date('2026-10-13T10:00:00Z'))).toBeNull();
  });
});
