import { describe, expect, it } from 'vitest';

import { LEAVE_START_DAYS, LEAVE_START_LAST_DAY, LEAVE_START_MONTHS } from '@/organization/leave-start';

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
});
