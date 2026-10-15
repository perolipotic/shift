import { isIsoDate, nextIsoDate } from '@/lib/i18n/format';

/**
 * Calendar-date steps every screen shares (retro A10), over the one validator
 * and the one day step in `@/lib/i18n/format` (`isIsoDate`, `nextIsoDate`).
 *
 * Danas, the admin's week and the rotation preview each wrote their own
 * `dayAfter` or `datesFrom`, and the two `datesFrom`s disagreed at the end of
 * the calendar: one threw, the other stopped short. One copy each now, and the
 * end of the calendar is decided here once.
 */

/** The day after `date`. @throws RangeError when `date` is not a calendar date or is 9999-12-31. */
export function dayAfter(date: string): string {
  const next = nextIsoDate(date);

  if (next === null) throw new RangeError(`the date ${date} has no next day`);

  return next;
}

/**
 * `count` consecutive dates starting at `from`, in order. SHORTER ONLY AT THE
 * END OF THE CALENDAR: 9999-12-31 has no next day, so the list stops there
 * rather than throwing, and a screen drawing a week or a preview draws what
 * the calendar has. Empty when `from` is not a calendar date or `count` is not
 * positive.
 */
export function datesFrom(from: string, count: number): readonly string[] {
  if (!isIsoDate(from)) return [];

  const dates: string[] = [];
  let date: string | null = from;

  while (date !== null && dates.length < count) {
    dates.push(date);
    date = nextIsoDate(date);
  }

  return dates;
}
