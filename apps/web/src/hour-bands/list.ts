import {
  MINUTES_PER_DAY,
  deriveHourBands,
  partitionOfDay,
  type HourBand,
} from '@shift/domain';
import { queryOptions } from '@tanstack/react-query';

import { RANGE_DASH, formatMinuteOfDay } from '@/i18n/format';

/**
 * The hour band list: one organization's bands, read once, and everything the
 * two band screens derive from them (story 2.1b).
 *
 * EVERYTHING THE SCREENS DECIDE IS HERE, for the reason `@/teams/list` gives:
 * a `.tsx` is collected by no test (AD-15), so the validation, the display
 * rows, the bar's segments and the surface state are pure functions the node
 * suite executes.
 *
 * NOTHING IS DERIVED HERE (AD-3, AD-7). A band's window, its duration, whether
 * it crosses midnight and how the day is partitioned all come from
 * `@shift/domain` — `deriveHourBands` and `partitionOfDay` — and are only
 * FORMATTED here. A second implementation of "each band ends where the next
 * begins" in the web tree is exactly the drift the domain package exists to
 * prevent, so this module never subtracts one start from another.
 *
 * ANY COUNT (CAP-3, DI-8). Zero, two and twelve bands take the same path, and
 * nothing reads meaning into a band's name: it is data that is only shown.
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). {@link HOUR_BANDS_LIST_KEY} is the only
 * key both band screens read under.
 *
 * `select` AND NOTHING ELSE. Writing is `@/hour-bands/write`.
 */

/** The relation both band modules name. */
export const HOUR_BANDS_TABLE = 'hour_bands';

/** The single query key the band screens read under. */
export const HOUR_BANDS_LIST_KEY = ['hourBands'] as const;

/**
 * The columns this read selects. `organization_id` renders nowhere and is the
 * tripwire {@link readHourBands} uses to refuse an answer spanning two tenants.
 * No window, duration or midnight column exists to select: `0012` stores none.
 */
export const HOUR_BANDS_COLUMNS = 'organization_id,id,name,start_time';

/** The exact count, so a truncated answer is caught rather than rendered. */
export const HOUR_BANDS_COUNT: HourBandsCountOptions = { count: 'exact' };

/** Five minutes, the bound `TEAMS_READ_STALE_MS` sets, for the same reason. */
export const HOUR_BANDS_READ_STALE_MS = 300000;

/** TanStack Query's name for a fetch it has not started (offline). */
export const HOUR_BANDS_FETCH_PAUSED = 'paused';

/**
 * The list could not be read, or what came back cannot be trusted as one.
 *
 * THE ONLY FAILURE. Zero rows is an honest answer — zero bands is a valid
 * stored state (human decision 2026-09-25) — and renders as a hatched,
 * uncovered day, never as a refusal.
 */
export const HOUR_BANDS_UNAVAILABLE = 'HOUR_BANDS_UNAVAILABLE';

export type HourBandsFailure = typeof HOUR_BANDS_UNAVAILABLE;

export type HourBandsOutcome =
  | { readonly ok: true; readonly bands: readonly HourBandRow[] }
  | { readonly ok: false; readonly code: HourBandsFailure };

/** As much of a PostgREST error as this module reads. */
export interface HourBandsReadFailure {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface HourBandsCountOptions {
  readonly count: 'exact';
}

export interface HourBandsAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: HourBandsReadFailure | null;
  readonly count: number | null;
}

/** The one call this module makes, named structurally so it can be stubbed. */
export interface HourBandsTable {
  select(columns: string, options: HourBandsCountOptions): PromiseLike<HourBandsAnswer>;
}

/** One stored band, as the surface sees it: the domain's `HourBand` plus its tenant. */
export interface HourBandRow extends HourBand {
  readonly organizationId: string;
}

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

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' ? value : null;
}

/**
 * One PostgREST row as a band, or `null` — validated field by field rather
 * than cast, so a malformed row refuses the answer instead of reaching the
 * domain as `NaN`.
 */
export function hourBandRowOf(row: unknown): HourBandRow | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;

  const fields = row as Record<string, unknown>;
  const id = textAt(fields, 'id');
  const organizationId = textAt(fields, 'organization_id');
  const name = textAt(fields, 'name');
  const startTime = textAt(fields, 'start_time');

  if (id === null || organizationId === null || name === null || startTime === null) return null;

  const startMinute = minuteOfTime(startTime);

  if (startMinute === null) return null;

  return { id, organizationId, name, startMinute };
}

/**
 * Every band this session reaches, or one stable code.
 *
 * Unavailable on a rejected or malformed answer, on a transport error, on
 * `data` that is not an array, on a missing exact count or one that disagrees
 * with the rows in either direction, on a row that does not validate, on
 * two rows sharing a start (the domain's precondition, which the schema's
 * unique makes unreachable), and on an answer spanning two organizations. Zero
 * rows is an answer.
 */
export async function readHourBands(table: HourBandsTable): Promise<HourBandsOutcome> {
  let answered: HourBandsAnswer;

  try {
    answered = await table.select(HOUR_BANDS_COLUMNS, HOUR_BANDS_COUNT);
  } catch (cause) {
    console.error(HOUR_BANDS_UNAVAILABLE, cause);

    return { ok: false, code: HOUR_BANDS_UNAVAILABLE };
  }

  if (typeof answered !== 'object' || answered === null || Array.isArray(answered)) {
    console.error(HOUR_BANDS_UNAVAILABLE, typeof answered);

    return { ok: false, code: HOUR_BANDS_UNAVAILABLE };
  }

  if (answered.error !== null) {
    console.error(HOUR_BANDS_UNAVAILABLE, answered.error.code);

    return { ok: false, code: HOUR_BANDS_UNAVAILABLE };
  }

  if (answered.data !== null && !Array.isArray(answered.data)) {
    console.error(HOUR_BANDS_UNAVAILABLE, 'data');

    return { ok: false, code: HOUR_BANDS_UNAVAILABLE };
  }

  const rows: readonly unknown[] = answered.data ?? [];

  // THE EXACT COUNT IS REQUIRED AND MUST AGREE, in both directions. It was
  // asked for, so its absence is an answer this read cannot vouch for, and a
  // count below the rows is as wrong as one above them.
  if (answered.count === null || answered.count !== rows.length) {
    console.error(HOUR_BANDS_UNAVAILABLE, answered.count, rows.length);

    return { ok: false, code: HOUR_BANDS_UNAVAILABLE };
  }

  const bands: HourBandRow[] = [];

  for (const row of rows) {
    const band = hourBandRowOf(row);

    if (band === null) {
      console.error(HOUR_BANDS_UNAVAILABLE, 'row');

      return { ok: false, code: HOUR_BANDS_UNAVAILABLE };
    }

    bands.push(band);
  }

  if (new Set(bands.map((band) => band.startMinute)).size !== bands.length) {
    console.error(HOUR_BANDS_UNAVAILABLE, 'starts');

    return { ok: false, code: HOUR_BANDS_UNAVAILABLE };
  }

  if (new Set(bands.map((band) => band.organizationId)).size > 1) {
    console.error(HOUR_BANDS_UNAVAILABLE, 'organizations');

    return { ok: false, code: HOUR_BANDS_UNAVAILABLE };
  }

  return { ok: true, bands };
}

/** The band a route parameter names, or `null` when the answer holds none. */
export function hourBandById(bands: readonly HourBandRow[], id: string): HourBandRow | null {
  return bands.find((band) => band.id === id) ?? null;
}

// ------------------------------------------------------------- durations

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

/**
 * Which shape a duration reads in. No plural: `h` and `min` are units, which is
 * how the voice rule's own `24 h bez pauze` reads. A whole number of hours
 * drops its minutes, and less than an hour drops its hours — zero included
 * among the hours, so an uncovered day reads `0 h`, never `0 min`.
 */
export function durationMessageKey(
  durationMinutes: number,
):
  | 'organization.hourBands.duration.hours'
  | 'organization.hourBands.duration.hoursMinutes'
  | 'organization.hourBands.duration.minutes' {
  const { hours, minutes } = durationValuesOf(durationMinutes);

  if (minutes === 0) return 'organization.hourBands.duration.hours';
  if (hours === 0) return 'organization.hourBands.duration.minutes';

  return 'organization.hourBands.duration.hoursMinutes';
}

// ---------------------------------------------------------- display rows

/**
 * Which of the two alternating tones a band is drawn in, on its row and on the
 * bar. POSITION, NEVER MEANING: the tone follows the band's place in start
 * order, so adjacent stretches read apart, and nothing about the band's name
 * picks it — a band called `Noć` is not dark because of its name. Every
 * stretch still carries the band's name as text.
 */
export type HourBandTone = 'light' | 'dark';

const BAND_TONES: readonly HourBandTone[] = ['light', 'dark'];

function toneAt(index: number): HourBandTone {
  return BAND_TONES[index % BAND_TONES.length] ?? 'light';
}

/** One band as the list renders it: every derived value read-only. */
export interface HourBandDisplayRow {
  readonly band: HourBandRow;
  /** `07:00–19:00`, en dash, unspaced (UX-DR34). */
  readonly window: string;
  /** `07:00`, the window's first half. */
  readonly start: string;
  /** `19:00`, the window's second half: where the next band begins. */
  readonly end: string;
  readonly tone: HourBandTone;
  readonly durationMinutes: number;
  readonly crossesMidnight: boolean;
}

/**
 * The bands in START order, each with the window, duration and midnight flag
 * `deriveHourBands` returned for it — read verbatim, never recomputed.
 */
export function hourBandDisplayRowsOf(bands: readonly HourBandRow[]): HourBandDisplayRow[] {
  const byId = new Map(bands.map((band) => [band.id, band]));

  return deriveHourBands(bands).flatMap((window, index) => {
    const band = byId.get(window.bandId);

    if (band === undefined) return [];

    const start = formatMinuteOfDay(window.startMinute);
    const end = formatMinuteOfDay(window.endMinute);

    return [
      {
        band,
        window: `${start}${RANGE_DASH}${end}`,
        start,
        end,
        tone: toneAt(index),
        durationMinutes: window.durationMinutes,
        crossesMidnight: window.crossesMidnight,
      },
    ];
  });
}

// ---------------------------------------------------------- the preview

/** What a band being entered would span, before it is saved. */
export interface HourBandPreview {
  /** `19:00`: the start of the band that would follow it. */
  readonly end: string;
  readonly durationMinutes: number;
  readonly crossesMidnight: boolean;
}

/** The id the previewed band takes among the stored ones; no stored id is empty. */
const PREVIEW_ID = '';

/**
 * The END a start would give a band, shown beside the start while it is typed
 * — in the add dialog (`replacingId` null) and in the edit dialog (the band's
 * own id, whose stored start the typed one replaces).
 *
 * THE DOMAIN DERIVES IT, as it derives every stored band's: the typed start is
 * placed among the others and `deriveHourBands` says where it ends. Nothing is
 * stored and nothing is entered: an end is always the next band's start.
 *
 * `null` for a start that is not a time yet, or one another band already
 * holds — the save would be refused, so there is no window to show.
 */
export function hourBandPreviewOf(
  bands: readonly HourBandRow[],
  startText: string,
  replacingId: string | null,
): HourBandPreview | null {
  const startMinute = minuteOfTime(startText);

  if (startMinute === null) return null;

  const others = bands.filter((band) => band.id !== replacingId);

  if (others.some((band) => band.startMinute === startMinute)) return null;

  const window = deriveHourBands([
    ...others,
    { id: PREVIEW_ID, organizationId: PREVIEW_ID, name: PREVIEW_ID, startMinute },
  ]).find((candidate) => candidate.bandId === PREVIEW_ID);

  if (window === undefined) return null;

  return {
    end: formatMinuteOfDay(window.endMinute),
    durationMinutes: window.durationMinutes,
    crossesMidnight: window.crossesMidnight,
  };
}

// ------------------------------------------------------------- the bar

/** One stretch of the 24-hour bar. */
export interface PartitionBarSegment {
  /** Stable React key: a crossing band has two segments, so the id is not enough. */
  readonly key: string;
  /** The band's name, or `null` for the uncovered stretch (hatched and flagged). */
  readonly name: string | null;
  /** `(toMinute − fromMinute) / 1440` as a percentage of the bar's width. */
  readonly widthPercent: number;
  /** The covering band's tone, or `null` for the uncovered stretch. */
  readonly tone: HourBandTone | null;
}

/** A labelled point along the bar: an hour on its scale, or a band boundary. */
export interface PartitionBarMark {
  readonly key: string;
  /** `07:00`. */
  readonly label: string;
  /** How far along the day, as a percentage of the bar's width. */
  readonly percent: number;
}

export interface PartitionBar {
  readonly segments: readonly PartitionBarSegment[];
  /**
   * Where each stretch begins, midnight excepted: the boundaries between
   * stretches, labelled under the bar.
   */
  readonly boundaries: readonly PartitionBarMark[];
  readonly coveredMinutes: number;
  readonly uncoveredMinutes: number;
}

const PERCENT = 100;

/**
 * The bar, from `partitionOfDay`: one segment per stretch it returned, each
 * labelled with the band covering it — so a band crossing midnight is two
 * segments with one label each — and, with no bands, one uncovered segment
 * spanning the whole day.
 */
export function partitionBarOf(bands: readonly HourBandRow[]): PartitionBar {
  const names = new Map(bands.map((band) => [band.id, band.name]));
  // The tone each band takes on its row, so a row and its stretches match.
  const tones = new Map(
    deriveHourBands(bands).map((window, index) => [window.bandId, toneAt(index)]),
  );
  const partition = partitionOfDay(bands);

  return {
    segments: partition.segments.map((segment) => ({
      key: `${segment.bandId ?? ''}:${String(segment.fromMinute)}`,
      name: segment.bandId === null ? null : (names.get(segment.bandId) ?? null),
      widthPercent: ((segment.toMinute - segment.fromMinute) / MINUTES_PER_DAY) * PERCENT,
      tone: segment.bandId === null ? null : (tones.get(segment.bandId) ?? null),
    })),
    boundaries: partition.segments
      .filter((segment) => segment.fromMinute > 0)
      .map((segment) => ({
        key: String(segment.fromMinute),
        label: formatMinuteOfDay(segment.fromMinute),
        percent: (segment.fromMinute / MINUTES_PER_DAY) * PERCENT,
      })),
    coveredMinutes: partition.coveredMinutes,
    uncoveredMinutes: MINUTES_PER_DAY - partition.coveredMinutes,
  };
}

const SCALE_STEP_MINUTES = 6 * MINUTES_PER_HOUR;

/**
 * The bar's scale: every six hours, and the closing midnight labelled
 * `00:00` again rather than `24:00`, for the reason `formatMinuteOfDay` gives.
 */
export const DAY_SCALE: readonly PartitionBarMark[] = Array.from(
  { length: MINUTES_PER_DAY / SCALE_STEP_MINUTES + 1 },
  (_, step) => {
    const minute = step * SCALE_STEP_MINUTES;

    return {
      key: String(minute),
      label: formatMinuteOfDay(minute % MINUTES_PER_DAY),
      percent: (minute / MINUTES_PER_DAY) * PERCENT,
    };
  },
);

// ------------------------------------------------------------ the messages

/** The message a read failure renders as. Exhaustive. */
export function hourBandsMessageKey(
  failure: HourBandsFailure,
): 'organization.hourBands.error.unavailable' {
  if (failure === HOUR_BANDS_UNAVAILABLE) return 'organization.hourBands.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}

// --------------------------------------------------------- surface state

/**
 * The one query definition every screen reading {@link HOUR_BANDS_LIST_KEY}
 * uses. UNAVAILABLE REJECTS, and the table is resolved inside the query
 * function, for the reasons `teamsQueryOptions` gives: a failed refetch keeps
 * the cached bands (and the bar and edit forms drawn from them) and is retried,
 * instead of replacing them with a resolved failure.
 */
export function hourBandsQueryOptions(table: () => HourBandsTable) {
  return queryOptions({
    queryKey: HOUR_BANDS_LIST_KEY,
    queryFn: async (): Promise<readonly HourBandRow[]> => {
      const outcome = await readHourBands(table());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.bands;
    },
    staleTime: HOUR_BANDS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    // ONE RETRY, ONE SECOND APART, not TanStack's three with backoff (~7 s). A
    // write awaits the invalidation's refetch before releasing its busy lock, so
    // the default held Save disabled for seconds after a write that had landed.
    retry: 1,
    retryDelay: 1000,
  });
}

/** The query result the surface state is derived from. */
export interface HourBandsQueryAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  /** The last good answer, kept by TanStack Query across a failed refetch. */
  readonly data: readonly HourBandRow[] | undefined;
}

export interface HourBandsSurfaceState {
  /** The bands to draw, or `null` when there is no answer to draw. */
  readonly bands: readonly HourBandRow[] | null;
  readonly refusal: HourBandsFailure | null;
  /** Never true beside a message. */
  readonly loading: boolean;
}

/**
 * One query result as what the screen shows: answered, failed, paused offline,
 * and a failed refetch over a good answer (bands kept, message beside them).
 * Every failure reaches here as `isError`, because {@link hourBandsQueryOptions}
 * rejects on it; TanStack Query keeps the last good `data` beside that error.
 */
export function hourBandsSurfaceStateOf(answer: HourBandsQueryAnswer): HourBandsSurfaceState {
  const bands = answer.data ?? null;
  const paused = answer.isPending && answer.fetchStatus === HOUR_BANDS_FETCH_PAUSED;

  if (answer.isError || paused) {
    return { bands, refusal: HOUR_BANDS_UNAVAILABLE, loading: false };
  }

  return { bands, refusal: null, loading: answer.isPending };
}
