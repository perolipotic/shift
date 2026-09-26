/**
 * The one locale-aware formatting layer (L6) and the only `Intl` construction
 * site in `apps/web` (story 1.1c).
 *
 * Two invariants shape every function here.
 *
 *   - L8. Every date and time renders in the ORGANIZATION's timezone, never the
 *     viewer's device. So `timeZone` is a required positional argument on every
 *     date/time entry point rather than an option with a default: an omitted
 *     `timeZone` on `Intl.DateTimeFormat` silently resolves to the system zone,
 *     which on a Croatian developer's machine *is* `Europe/Zagreb` — the
 *     violation is invisible locally and only surfaces for a member travelling
 *     or a device with a wrong clock. Making it a required argument turns that
 *     class of defect into a compile error. Story 1.4 supplies the value.
 *   - UX-DR34. The binding literals are `12.09.2026`, `19:00–07:00` and
 *     `10.09–16.09`, and CLDR `hr` produces none of them: its numeric date is
 *     `12. 09. 2026.` (spaced, trailing period) and `formatRange` pads the dash
 *     with U+2009 thin spaces. So dates and ranges are composed from
 *     `formatToParts` — CLDR supplies the numbers, this module supplies the
 *     separators. `format()` and `formatRange()` are never called.
 *
 * Month and day names are the opposite case: CLDR `hr` is already correct and
 * already lowercase (`rujan`, `subota`), so they are passed through verbatim
 * and only lowercased, defensively and locale-aware. Capitalization belongs to
 * the consuming surface, which knows whether the name starts a sentence.
 *
 * KEEP THIS MODULE IMPORT-FREE. `format.test.ts` proves L8 by loading this file
 * in a child process under `TZ=Pacific/Kiritimati` through Node's own type
 * stripping — no bundler, no `@` alias resolution. The first non-relative
 * import here turns that proof into a module-resolution error surfacing out of
 * a timezone test, which is a confusing way to learn what broke. There is no
 * reason to need one: this wraps `Intl` and nothing else.
 */

/**
 * The one locale. `hr` rather than `hr-HR`: measured identical for every format
 * this module produces, and a bare language tag is what i18next carries.
 *
 * A second locale is not a constant to add here — it is `_bmad-output`'s L3
 * promise, a resource file plus a locale argument. Deliberately out of scope
 * for this story, so nothing takes a locale parameter yet.
 */
export const LOCALE = 'hr';

/** U+2013 EN DASH. Unspaced, and never a hyphen (UX-DR34). */
export const RANGE_DASH = '–';

/** Minutes in one nominal day, for {@link formatMinuteOfDay}'s range check. */
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

/**
 * `07:00` — a nominal minute of the day (0–1439), 24-hour and zero-padded
 * (story 2.1b).
 *
 * NO ZONE AND NO `Intl`, and both on purpose. An hour band's start is a
 * wall-clock time with no date and no instant (AD-7 reads it as integer
 * minutes), so there is nothing to resolve against a zone, and `formatTime`'s
 * zoned path would need a fabricated `Date` to reach the same two digits. The
 * shape is `formatTime`'s — `h23`, so midnight is `00:00`, never `24:00`.
 *
 * @throws RangeError for anything that is not a whole minute in 0–1439, rather
 *   than rendering `NaN:NaN` or a `24:00` that names a second midnight.
 */
export function formatMinuteOfDay(minute: number): string {
  if (!Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) {
    throw new RangeError(`FORMAT_MINUTE_OUT_OF_RANGE:${String(minute)}`);
  }

  const hours = String(Math.floor(minute / MINUTES_PER_HOUR)).padStart(2, '0');
  const minutes = String(minute % MINUTES_PER_HOUR).padStart(2, '0');

  return `${hours}:${minutes}`;
}

/**
 * The date/time shapes this module produces. A closed set, because every
 * formatter is memoized by name and an ad-hoc options object elsewhere would be
 * the L6 violation this module exists to prevent.
 *
 * `hourCycle: 'h23'` is explicit rather than inherited: `hr` resolves to h23
 * today, but the difference between h23 and h24 is whether midnight renders
 * `00:00` or `24:00`, and a night shift ending at midnight is the pilot's
 * normal case.
 */
const SHAPES = {
  date: { day: '2-digit', month: '2-digit', year: 'numeric' },
  dayMonth: { day: '2-digit', month: '2-digit' },
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  monthName: { month: 'long' },
  weekdayName: { weekday: 'long' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

type Shape = keyof typeof SHAPES;

/**
 * Formatter cache, keyed by locale, zone and shape.
 *
 * `Intl.DateTimeFormat` construction is the expensive part of formatting, and a
 * month calendar formats several hundred cells from the same three shapes in
 * one render. Nothing here is invalidated because nothing it depends on can
 * change at runtime: there is one locale, and the organization's zone is fixed
 * for the session.
 */
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();

/**
 * The one collator, built once.
 *
 * `Intl.Collator` construction is the expensive part of comparing, and a sort
 * over several hundred member rows calls the comparator O(n log n) times — a
 * collator built per comparison would construct it a few thousand times for one
 * click. Nothing invalidates it because there is one locale.
 */
const collator = new Intl.Collator(LOCALE, { usage: 'sort', sensitivity: 'variant' });

/**
 * The memoized formatter for one shape in one zone.
 *
 * An invalid IANA zone throws `RangeError` here, at construction, which is the
 * fail-fast this layer wants: a typo in the organization's configured zone
 * surfaces as a named error rather than as silently device-local output. The
 * throw happens before the cache write, so a bad zone is never memoized.
 */
function dateTimeFormatter(shape: Shape, timeZone: string): Intl.DateTimeFormat {
  const key = `${LOCALE}\u0000${timeZone}\u0000${shape}`;
  const cached = dateTimeFormatters.get(key);
  if (cached !== undefined) return cached;

  const created = new Intl.DateTimeFormat(LOCALE, { ...SHAPES[shape], timeZone });
  dateTimeFormatters.set(key, created);

  return created;
}

/**
 * One part's value, or a named throw.
 *
 * Total rather than asserted with `!`: if a future ICU stopped emitting a
 * `day` part for `hr`, the non-null form would produce the string
 * `"undefined.09.2026"` on screen, while this names the missing part.
 */
function part(parts: readonly Intl.DateTimeFormatPart[], type: string): string {
  const found = parts.find((candidate) => candidate.type === type);
  if (found === undefined) throw new Error(`FORMAT_PART_MISSING:${type}`);

  return found.value;
}

/**
 * The year part as FOUR digits (story 3.1). `year: 'numeric'` renders year 1
 * as `1`, so without the padding `isIsoDate('0001-01-01')` round-tripped to
 * `1-01-01` and refused every date before 1000 — which the schema and the
 * domain both admit. From 1000 on the padding changes nothing.
 */
function yearOf(parts: readonly Intl.DateTimeFormatPart[]): string {
  return part(parts, 'year').padStart(4, '0');
}

/**
 * The one choke point every date/time entry point passes through, and therefore
 * where an invalid instant is named.
 *
 * `formatToParts` throws a bare `RangeError: Invalid time value` on
 * `new Date('nonsense')` — no key, no argument, nothing saying which of a
 * table's several hundred cells was bad. That is the same failure mode `part()`
 * was made total to avoid, so it is named here for the same reason: an invalid
 * `Date` reaching this layer is a defect upstream (a malformed API date, a
 * parse of an empty string) and the error should say so.
 */
function partsOf(shape: Shape, instant: Date, timeZone: string): Intl.DateTimeFormatPart[] {
  if (Number.isNaN(instant.valueOf())) throw new Error('FORMAT_INVALID_INSTANT');

  return dateTimeFormatter(shape, timeZone).formatToParts(instant);
}

/**
 * Whether this runtime can actually render in a zone (story 1.4a).
 *
 * The organization's `timezone` column is deliberately unvalidated in the
 * database — `0002:93` records why: `pg_timezone_names` is not immutable and so
 * cannot appear in a constraint. That left the value every date and time in the
 * application resolves against with no check anywhere, and the failure it
 * produces is not a bad date: `Intl.DateTimeFormat` THROWS `RangeError` on an
 * unknown zone, so a typo saved on the settings surface takes down every later
 * screen that renders an instant, long after the edit and nowhere near it.
 *
 * HERE rather than at the surface, because this module is the only file in
 * `apps/web` permitted to touch `Intl` at all (`format.test.ts` asserts it), and
 * asking the runtime is the only honest test — a hand-written list of zones is a
 * second copy of the IANA database that starts rotting the day it is written.
 * It stays import-free like everything else in this file.
 *
 * The parameter is `timeZone: string`, required and positional, so this reads
 * the same way as every other zoned entry point and is held to the same rule.
 */
export function isRenderableTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone });

    return true;
  } catch {
    return false;
  }
}

/** The zone a date falls back to when the organization's cannot be rendered —
 *  the same fallback `0008`'s `organization_today` makes, so the two agree. */
const FALLBACK_TIME_ZONE = 'UTC';

/**
 * `2026-09-23` — the calendar date an instant falls on in the organization's
 * zone, as the ISO string a `date` column and an `<input type="date">` both
 * speak (story 1.6).
 *
 * THE ORGANIZATION'S TODAY, never the device's (L8). A deactivation "from
 * today" is refused by the database for any date before the organization's
 * own today, so a device a zone away would otherwise offer a date the policy
 * refuses, or hide one it admits.
 *
 * AN UNRENDERABLE ZONE FALLS BACK TO UTC rather than throwing, mirroring the
 * database: `organizations.timezone` is unchecked (`0002:89-92`), and the
 * policy reads UTC's date for a zone it cannot resolve.
 */
export function organizationIsoDate(instant: Date, timeZone: string): string {
  const zone = isRenderableTimeZone(timeZone) ? timeZone : FALLBACK_TIME_ZONE;
  // THE `date` SHAPE, read as parts: the same three fields, reassembled in
  // ISO order rather than the binding one. A second shape with the same
  // options would be a second formatter for one question.
  const parts = partsOf('date', instant, zone);

  return `${yearOf(parts)}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

/** An ISO calendar date, shaped `YYYY-MM-DD`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date read at noon UTC — the one reading under which no offset
 *  can move it across a midnight. */
function noonOf(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00Z`);
}

/**
 * Whether a value is a REAL ISO calendar date — THE ONE VALIDATOR (story 1.6).
 *
 * The shape alone is not enough: `2026-02-31` matches it and names no day.
 * `Date` would roll it over to 3 March, so the round trip back to the same
 * string is what refuses it. `members/list.ts` reads status dates with this
 * and `members/write.ts` judges an entered date with it; a second validator
 * is how one of them admits a date the other refuses.
 */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;

  const instant = noonOf(value);

  if (Number.isNaN(instant.valueOf())) return false;

  return organizationIsoDate(instant, FALLBACK_TIME_ZONE) === value;
}

/**
 * The calendar day after an ISO date, or `null` if it is not one — or if it
 * is the last day a four-digit year can name.
 *
 * The earliest date a new status version may carry when the member's latest
 * version is dated today or later (`0008`: versions append in date order).
 */
export function nextIsoDate(isoDate: string): string | null {
  if (!isIsoDate(isoDate)) return null;

  const instant = noonOf(isoDate);

  instant.setUTCDate(instant.getUTCDate() + 1);

  const next = organizationIsoDate(instant, FALLBACK_TIME_ZONE);

  // `9999-12-31` HAS NO NEXT DAY this shape can carry, and `0008` refuses
  // year 10000 outright, so there is no date to offer rather than one the
  // database would refuse.
  return isIsoDate(next) ? next : null;
}

/**
 * `23.09.2026` — an ISO calendar date in the binding shape (UX-DR34).
 *
 * A DATE, not an instant, so no zone applies: the string already names the
 * day. `null` for anything {@link isIsoDate} refuses, so a malformed value
 * reaches the caller as a case rather than as `NaN.NaN.NaN`.
 */
export function formatIsoDate(isoDate: string): string | null {
  if (!isIsoDate(isoDate)) return null;

  return formatDate(noonOf(isoDate), FALLBACK_TIME_ZONE);
}

/**
 * `23.09.` — an ISO calendar date's day and month alone, for a column head
 * where the year is the header's (story 2.3b, the cycle preview). The same
 * binding shape as {@link formatIsoDate}, cut before the year. `null` for
 * anything {@link isIsoDate} refuses.
 */
export function formatIsoDayMonth(isoDate: string): string | null {
  const full = formatIsoDate(isoDate);

  return full === null ? null : full.slice(0, full.length - 4);
}

/** `12.09.2026` — the binding date (UX-DR34). */
export function formatDate(instant: Date, timeZone: string): string {
  const parts = partsOf('date', instant, timeZone);

  return `${part(parts, 'day')}.${part(parts, 'month')}.${yearOf(parts)}`;
}

/** `19:00` — 24-hour, zero-padded, in the organization's zone. */
export function formatTime(instant: Date, timeZone: string): string {
  const parts = partsOf('time', instant, timeZone);

  return `${part(parts, 'hour')}:${part(parts, 'minute')}`;
}

/**
 * `19:00–07:00` — the binding time range (UX-DR34).
 *
 * Both ends are instants, so a range crossing midnight is expressed by the
 * dates being different rather than by a flag, and the crossing needs no
 * special case here.
 */
export function formatTimeRange(start: Date, end: Date, timeZone: string): string {
  return `${formatTime(start, timeZone)}${RANGE_DASH}${formatTime(end, timeZone)}`;
}

/** `10.09` — the day-and-month half of a week range. Not exported: the range is
 *  the binding literal, a bare day-month is not. */
function formatDayMonth(instant: Date, timeZone: string): string {
  const parts = partsOf('dayMonth', instant, timeZone);

  return `${part(parts, 'day')}.${part(parts, 'month')}`;
}

/** `10.09–16.09` — the binding day-month range (UX-DR34). */
export function formatDayMonthRange(start: Date, end: Date, timeZone: string): string {
  return `${formatDayMonth(start, timeZone)}${RANGE_DASH}${formatDayMonth(end, timeZone)}`;
}

/** `rujan` — CLDR verbatim, lowercase. The surface capitalizes if it must. */
export function formatMonthName(instant: Date, timeZone: string): string {
  return part(partsOf('monthName', instant, timeZone), 'month').toLocaleLowerCase(LOCALE);
}

/** `subota` — CLDR verbatim, lowercase. */
export function formatWeekdayName(instant: Date, timeZone: string): string {
  return part(partsOf('weekdayName', instant, timeZone), 'weekday').toLocaleLowerCase(LOCALE);
}

/**
 * `rujan` — the month an ISO calendar date falls in, by
 * {@link formatMonthName} (story 3.1, the calendar's heading). A DATE, not an
 * instant, so no zone applies: it is read at noon in the fallback zone, where
 * no offset can move it. `null` for anything {@link isIsoDate} refuses.
 */
export function formatIsoMonthName(isoDate: string): string | null {
  if (!isIsoDate(isoDate)) return null;

  return formatMonthName(noonOf(isoDate), FALLBACK_TIME_ZONE);
}

/**
 * `subota` — the weekday of an ISO calendar date, by
 * {@link formatWeekdayName} (story 3.1, the calendar's rows), by the same
 * reading as {@link formatIsoMonthName}. `null` for anything {@link isIsoDate}
 * refuses.
 */
export function formatIsoWeekdayName(isoDate: string): string | null {
  if (!isIsoDate(isoDate)) return null;

  return formatWeekdayName(noonOf(isoDate), FALLBACK_TIME_ZONE);
}

/**
 * Croatian order for any two pieces of text — names, addresses, anything a
 * column sorts by.
 *
 * NAMED FOR WHAT IT ORDERS rather than for the one column that first needed it:
 * the member list sorts by name AND by email address through this same call,
 * and a `compareNames` sorting addresses is a name that has to be explained
 * every time it is read.
 *
 * `<` IS THE THING THIS REPLACES, and the difference is not cosmetic. JavaScript
 * compares strings by code unit, which puts every Croatian diacritic after `z`:
 * `Čavić` sorts after `Zoran`, and `Cvitanović` and `Čavić` land at opposite
 * ends of the list though a Croatian reader expects them adjacent. `hr`'s CLDR
 * collation puts `č` directly after `c`, `ž` after `z`, and `dž lj nj` where the
 * alphabet puts them. `members/list.test.ts` pins a case the two disagree on, so
 * a comparator "simplified" back to `<` fails rather than merely reordering.
 *
 * HERE rather than beside the sort, because this file is the only one in
 * `apps/web` permitted to touch `Intl` at all (`format.test.ts` asserts it), and
 * `Intl.Collator` is `Intl`. It takes no `timeZone`: it formats no instant, so
 * the L8 rule that governs every other export here does not reach it —
 * `format.test.ts` names it alongside `formatNumber` for that reason.
 */
export function compareText(first: string, second: string): number {
  return collator.compare(first, second);
}

/**
 * `1.234,50` — Croatian grouping and decimal separators.
 *
 * Two fraction digits by default, which is the binding shape for a decimal
 * figure: `hr`'s own default would render `1234.5` as `1.234,5`, and a column
 * of hours where some rows carry one decimal and some two is exactly the
 * wobble UX-DR40's tabular numerals exist to prevent. A count passes
 * `fractionDigits: 0` — or, far more often, is not formatted here at all but
 * rendered through an ICU `plural` message, because a bare number needs a noun
 * and the noun needs all three Croatian forms (L7).
 */
export function formatNumber(value: number, fractionDigits = 2): string {
  const key = `${LOCALE}\u0000${fractionDigits}`;
  let formatter = numberFormatters.get(key);

  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    numberFormatters.set(key, formatter);
  }

  return formatter.format(value);
}
