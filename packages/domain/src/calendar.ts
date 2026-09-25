/**
 * Calendar dates as `YYYY-MM-DD` strings (AD-7). INTERNAL: shared by the
 * modules of this package and not re-exported from `index.ts`.
 *
 * A date is a civil day, never an instant: nothing here constructs a `Date`,
 * reads a timezone or knows about daylight saving. Day arithmetic is done on
 * the proleptic Gregorian calendar with integers alone.
 */

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * @throws RangeError naming `what` when `date` is not a calendar `YYYY-MM-DD`
 *   in years 0001–9999. PostgreSQL has no year 0 (1 BC precedes AD 1), and the
 *   schema admits no date outside 0001-01-01…9999-12-31, so `0000` is refused.
 */
export function checkDate(what: string, date: string): void {
  const match = DATE_SHAPE.exec(date);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (match === null || year < 1 || daysInMonth === undefined || day < 1 || day > daysInMonth) {
    throw new RangeError(`${what} is ${JSON.stringify(date)}, not a calendar date as YYYY-MM-DD`);
  }
}

/**
 * The civil day number of a date already checked by {@link checkDate}: days
 * since 1970-01-01, negative before it. Integer arithmetic over 400-year eras
 * (each exactly 146 097 days), with March as the first month so the leap day
 * falls at the end of the computational year.
 */
export function civilDayNumber(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));

  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const monthFromMarch = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
