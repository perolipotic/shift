/**
 * Times of day and durations as plain numbers, shared by every feature that
 * reads a `time` column or shows a duration (hour bands, shift types, the
 * calendar, *Danas*, *Sati*, the conflicts). A pure module (AD-15): no
 * locale, no wording — the words are each feature's own message keys.
 */

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/**
 * `HH:MM` or `HH:MM:SS` as a whole minute of the day, or `null`.
 *
 * Postgres returns a `time` as `07:00:00`; `<input type="time">` gives `07:00`.
 * Both are read by this one parser. A value with non-zero seconds is REFUSED
 * rather than truncated: `0012` stores whole minutes only, so such a value is
 * either a malformed answer or an input the database would refuse anyway.
 */
export function minuteOfTime(value: string): number | null {
  const matched = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);

  if (matched === null) return null;

  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  const seconds = matched[3] === undefined ? 0 : Number(matched[3]);

  if (hours >= HOURS_PER_DAY || minutes >= MINUTES_PER_HOUR || seconds !== 0) return null;

  return hours * MINUTES_PER_HOUR + minutes;
}

/**
 * A duration split for display: `12 h`, `1 h 30 min`, `45 min`. The minutes
 * are the DOMAIN's `durationMinutes`, only divided for reading.
 */
// A type alias rather than an interface: it is handed to `t()` as ICU values,
// and only an alias is assignable to i18next's index-signature options type.
export type DurationValues = {
  readonly hours: number;
  readonly minutes: number;
};

export function durationValuesOf(durationMinutes: number): DurationValues {
  return {
    hours: Math.floor(durationMinutes / MINUTES_PER_HOUR),
    minutes: durationMinutes % MINUTES_PER_HOUR,
  };
}
