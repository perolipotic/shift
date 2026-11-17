/** Date formatting the calendar screen shows, for its page object and its spec alike. */

/** `05.10.` — a date as its row header starts. */
export function dayMonth(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.`;
}

/** `subota` — a date's weekday, as its row header and its cells' labels name it. */
export function weekdayOf(date: string): string {
  return new Intl.DateTimeFormat('hr', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

/** `čet` — a date's short weekday, lowercase, as the leave dialog's conflict lines name it (story 7.12). */
export function weekdayShort(date: string): string {
  return new Intl.DateTimeFormat('hr', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`))
    .toLocaleLowerCase('hr');
}

/** `05.10.2026` — a whole date as the app's `formatIsoDate` writes it. */
export function fullDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

/** A `YYYY-MM-DD` date `days` days from `date`, by UTC arithmetic. */
export function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);

  return instant.toISOString().slice(0, 10);
}

/**
 * Milliseconds from `now` to the next 00:00 on `timeZone`'s wall clock: what
 * a test waits out when it would start too close to midnight, so its seed,
 * its page and the server read the same "today"
 * (spec-today-spec-midnight-safe). Read from the wall clock, so it is exact
 * within hours of midnight in a zone whose DST change is not at midnight
 * (Europe/Zagreb changes at 02:00/03:00); earlier on a DST-change day it is
 * off by that hour, which no caller near midnight sees.
 */
export function msUntilMidnight(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const part = (type: 'hour' | 'minute' | 'second'): number => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) throw new Error(`E2E: no ${type} in ${timeZone}'s wall clock at ${now.toISOString()}`);
    return Number(value);
  };
  const sinceMidnight = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000 + now.getUTCMilliseconds();

  return 24 * 60 * 60 * 1000 - sinceMidnight;
}

/** At least this close to midnight, a test waits (more than the slowest timeout: 120 s × `test.slow()`). */
export const MIDNIGHT_MARGIN_MS = 8 * 60_000;
/** How far past midnight a waiting test starts. */
export const PAST_MIDNIGHT_MS = 5_000;

/**
 * How long a test starting at `now` waits before it runs, so it runs wholly
 * on one date in `timeZone`: 0, or until {@link PAST_MIDNIGHT_MS} past the
 * next midnight when that is closer than {@link MIDNIGHT_MARGIN_MS} or than
 * the test's own timeout plus a minute (`timeoutMs`, 0 when it has none).
 */
export function midnightWait(now: Date, timeZone: string, timeoutMs: number): number {
  const left = msUntilMidnight(now, timeZone);
  const margin = Math.max(MIDNIGHT_MARGIN_MS, timeoutMs + 60_000);

  return left < margin ? left + PAST_MIDNIGHT_MS : 0;
}
