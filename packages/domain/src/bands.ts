/**
 * Hour bands (CAP-3, AD-3, AD-7).
 *
 * An organization stores each band as a name and a start time, nothing more.
 * Everything else — where a band ends, how long it lasts, whether it crosses
 * midnight, and how the day is partitioned — is derived here and nowhere else.
 *
 * Sorted by start time, each band ends where the next one begins and the last
 * one wraps round to the first. So a gap or an overlap cannot be expressed: the
 * only configuration that leaves any minute uncovered is the empty set.
 *
 * Time is integer minutes since midnight over nominal wall-clock time
 * (0–1439). Nothing here reads a name, and nothing branches on how many bands
 * there are: one, two and twelve bands take the same path. A single band is
 * simply the case where the next band is itself, so its gap wraps to 0 and it
 * runs the whole day.
 *
 * The preconditions the schema enforces are re-checked on entry, and a breach
 * throws a `RangeError` rather than silently breaking the 1440 invariant.
 */

/** Minutes in one nominal day. */
export const MINUTES_PER_DAY = 1440;

/**
 * One stored hour band, as the database holds it.
 *
 * Preconditions, enforced by the schema (`0012_hour_bands.sql`) and re-checked
 * by every function here: every `startMinute` is an integer in 0–1439, and no
 * two bands share a start.
 */
export interface HourBand {
  readonly id: string;
  readonly name: string;
  readonly startMinute: number;
}

/** A band's derived window. `endMinute` is where the next band starts (0–1439). */
export interface HourBandWindow {
  readonly bandId: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly durationMinutes: number;
  readonly crossesMidnight: boolean;
}

/**
 * One stretch of the day, `[fromMinute, toMinute)` over 0–1440, and the band
 * that covers it — `null` only when there are no bands at all.
 */
export interface DaySegment {
  readonly fromMinute: number;
  readonly toMinute: number;
  readonly bandId: string | null;
}

export interface DayPartition {
  /** Ordered by `fromMinute`; they tile 0–1440 with no gap and no overlap. */
  readonly segments: readonly DaySegment[];
  /** Minutes covered by some band: 1440 whenever at least one band exists. */
  readonly coveredMinutes: number;
}

/** A true modulo, non-negative for a negative dividend. */
function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Bands in start order, the input never mutated, after checking the
 * preconditions. Starts are distinct once checked, so the order is total and
 * needs no tie-break.
 *
 * @throws RangeError naming the offending band when a start is not an integer
 *   in 0–1439, or when two bands share a start.
 */
function sortedByStart(bands: readonly HourBand[]): HourBand[] {
  const seen = new Map<number, string>();
  for (const band of bands) {
    const { id, startMinute } = band;
    if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute >= MINUTES_PER_DAY) {
      throw new RangeError(
        `hour band ${id} starts at ${startMinute}, not a whole minute in 0–${MINUTES_PER_DAY - 1}`,
      );
    }
    const twin = seen.get(startMinute);
    if (twin !== undefined) {
      throw new RangeError(`hour band ${id} starts at ${startMinute}, as hour band ${twin} does`);
    }
    seen.set(startMinute, id);
  }
  return [...bands].sort((a, b) => a.startMinute - b.startMinute);
}

/**
 * Every band's window, in start order. Each band runs until the next band's
 * start, and the last until the first's, so the durations sum to exactly 1440
 * whenever any band exists. A single band is the whole day.
 *
 * @throws RangeError when a precondition on {@link HourBand} is breached.
 */
export function deriveHourBands(bands: readonly HourBand[]): HourBandWindow[] {
  const sorted = sortedByStart(bands);

  return sorted.map((band, index) => {
    // Non-null: `index` is a valid index into a non-empty `sorted`, so the
    // wrapped successor always exists.
    const next = sorted[(index + 1) % sorted.length]!;
    const gap = mod(next.startMinute - band.startMinute, MINUTES_PER_DAY);
    // Starts are distinct, so the gap is 0 only when `next` is `band` itself —
    // a lone band, which runs the full day round to its own start.
    const durationMinutes = gap === 0 ? MINUTES_PER_DAY : gap;

    return {
      bandId: band.id,
      startMinute: band.startMinute,
      endMinute: next.startMinute,
      durationMinutes,
      crossesMidnight: band.startMinute + durationMinutes > MINUTES_PER_DAY,
    };
  });
}

/**
 * The day, 0–1440, cut into the stretches each band covers. A band that
 * crosses midnight yields two segments, one ending at 1440 and one starting
 * at 0. With no bands the whole day is one uncovered segment.
 *
 * @throws RangeError when a precondition on {@link HourBand} is breached.
 */
export function partitionOfDay(bands: readonly HourBand[]): DayPartition {
  const windows = deriveHourBands(bands);

  if (windows.length === 0) {
    return {
      segments: [{ fromMinute: 0, toMinute: MINUTES_PER_DAY, bandId: null }],
      coveredMinutes: 0,
    };
  }

  const segments: DaySegment[] = [];
  for (const window of windows) {
    const end = window.startMinute + window.durationMinutes;
    if (end > MINUTES_PER_DAY) {
      segments.push({ fromMinute: window.startMinute, toMinute: MINUTES_PER_DAY, bandId: window.bandId });
      segments.push({ fromMinute: 0, toMinute: end - MINUTES_PER_DAY, bandId: window.bandId });
    } else {
      segments.push({ fromMinute: window.startMinute, toMinute: end, bandId: window.bandId });
    }
  }
  segments.sort((a, b) => a.fromMinute - b.fromMinute);

  let coveredMinutes = 0;
  for (const segment of segments) {
    if (segment.bandId !== null) coveredMinutes += segment.toMinute - segment.fromMinute;
  }

  return { segments, coveredMinutes };
}
