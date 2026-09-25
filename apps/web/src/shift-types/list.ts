import {
  deriveShiftTimes,
  shiftTypeVersionOn,
  type ShiftType,
  type ShiftTypeVersion,
} from '@shift/domain';
import { queryOptions } from '@tanstack/react-query';

import { durationValuesOf, minuteOfTime } from '@/hour-bands/list';
import { RANGE_DASH, formatMinuteOfDay, isIsoDate, organizationIsoDate } from '@/i18n/format';
import { rampSlotOf, type RampSlot } from '@/shift-types/ramp';

/**
 * The shift type list: one organization's shift types and their versioned
 * times, read once, and everything the two shift type screens derive from them
 * (story 2.2b).
 *
 * EVERYTHING THE SCREENS DECIDE IS HERE, for the reason `@/hour-bands/list`
 * gives: a `.tsx` is collected by no test (AD-15), so the validation, the
 * ramp slots, the display rows and the surface state are pure functions the
 * node suite executes.
 *
 * NOTHING IS DERIVED HERE (AD-7). A type's duration, whether it crosses
 * midnight and which version is in effect on a date all come from
 * `@shift/domain` — `deriveShiftTimes` and `shiftTypeVersionOn` — and are only
 * FORMATTED here.
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). The read starts at the caller's
 * ORGANIZATION and embeds its types and each type's versions, so the zone
 * "today" is read in arrives in the same answer as the rows — the way
 * `@/members/list` embeds `organizations(timezone)` — and, unlike an embed on
 * the types, still arrives when the organization has no type at all. The add
 * of a working type needs today for its first version, and zero types is where
 * that add starts.
 *
 * `select` AND NOTHING ELSE. Writing is `@/shift-types/write`.
 */

/** The relation the read starts from: the caller's own organization. */
export const SHIFT_TYPES_READ_TABLE = 'organizations';

/** The relations the writes name. */
export const SHIFT_TYPES_TABLE = 'shift_types';
export const SHIFT_TYPE_VERSIONS_TABLE = 'shift_type_versions';

/** The single query key both shift type screens read under. */
export const SHIFT_TYPES_LIST_KEY = ['shiftTypes'] as const;

/**
 * The organization's own columns every snapshot starting at it selects first:
 * its id and its zone. Shared with `@/rotation/list` (story 2.3b).
 */
export const ORGANIZATION_ZONE_COLUMNS = 'id,timezone';

/**
 * The types-and-versions embed alone, for another snapshot that starts at the
 * organization too and reads its types through {@link shiftTypeRowOf}
 * (`@/rotation/list`, story 2.3b), so the columns and the parser stay one pair.
 */
export const SHIFT_TYPES_EMBED =
  'shift_types(organization_id,id,name,is_working,archived,created_at,' +
  'shift_type_versions(organization_id,shift_type_id,start_time,end_time,effective_from))';

/**
 * The columns this read selects: the organization, its zone, and every type
 * with its versions. `organization_id` on each type renders nowhere and is the
 * tripwire {@link readShiftTypes} uses to refuse a type from another tenant.
 * No duration column exists to select: `0013` stores none.
 */
export const SHIFT_TYPES_COLUMNS = `${ORGANIZATION_ZONE_COLUMNS},${SHIFT_TYPES_EMBED}`;

/** The exact count, so an answer reaching two organizations is caught. */
export const SHIFT_TYPES_COUNT: ShiftTypesCountOptions = { count: 'exact' };

/** Five minutes, the bound `HOUR_BANDS_READ_STALE_MS` sets, for the same reason. */
export const SHIFT_TYPES_READ_STALE_MS = 300000;

/** TanStack Query's name for a fetch it has not started (offline). */
export const SHIFT_TYPES_FETCH_PAUSED = 'paused';

/**
 * The list could not be read, or what came back cannot be trusted as one.
 * THE ONLY FAILURE: zero types is an honest answer and renders as an empty
 * list beside the add form.
 */
export const SHIFT_TYPES_UNAVAILABLE = 'SHIFT_TYPES_UNAVAILABLE';

export type ShiftTypesFailure = typeof SHIFT_TYPES_UNAVAILABLE;

export type ShiftTypesOutcome =
  | { readonly ok: true; readonly snapshot: ShiftTypesSnapshot }
  | { readonly ok: false; readonly code: ShiftTypesFailure };

/** As much of a PostgREST error as this module reads. */
export interface ShiftTypesReadFailure {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface ShiftTypesCountOptions {
  readonly count: 'exact';
}

export interface ShiftTypesAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: ShiftTypesReadFailure | null;
  readonly count: number | null;
}

/** The one call this module makes, named structurally so it can be stubbed. */
export interface ShiftTypesTable {
  select(columns: string, options: ShiftTypesCountOptions): PromiseLike<ShiftTypesAnswer>;
}

/** One stored type, as the surface sees it: the domain's `ShiftType` and more. */
export interface ShiftTypeRow extends ShiftType {
  readonly organizationId: string;
  readonly archived: boolean;
  /** `created_at` as PostgREST sent it; the ramp order reads it. */
  readonly createdAt: string;
  /** Every version of this type's times, oldest first. */
  readonly versions: readonly ShiftTypeVersion[];
}

/** The one answer both screens draw from. */
export interface ShiftTypesSnapshot {
  readonly organizationId: string;
  /** The organization's zone: "today" is the organization's, never the device's (L8). */
  readonly timeZone: string;
  /** Every type, archived ones included, in creation order. */
  readonly types: readonly ShiftTypeRow[];
}

// ---------------------------------------------------------- creation order

/** A `timestamptz` as two integers that order exactly: whole seconds, microseconds. */
interface Instant {
  readonly seconds: number;
  readonly micros: number;
}

const TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;
const MICRO_DIGITS = 6;
const MILLIS_PER_SECOND = 1000;

/**
 * A PostgREST `timestamptz` as an exactly ordered instant, or `null`.
 *
 * NOT `Date.parse` alone: it keeps milliseconds, and the database orders by
 * microseconds, so two types created within one millisecond would tie here
 * and not there. Postgres also drops trailing zeros (`.88`), so the fraction is
 * read as digits and padded rather than compared as text.
 */
export function instantOf(value: string): Instant | null {
  const matched = TIMESTAMP.exec(value);

  if (matched === null) return null;

  const [, date, time, fraction, zone] = matched;
  const offset =
    zone === 'Z' || zone === undefined
      ? 'Z'
      : zone.length === 3
        ? `${zone}:00`
        : zone.includes(':')
          ? zone
          : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const millis = Date.parse(`${date ?? ''}T${time ?? ''}${offset}`);

  if (Number.isNaN(millis)) return null;

  return {
    seconds: Math.floor(millis / MILLIS_PER_SECOND),
    micros: Number((fraction ?? '').padEnd(MICRO_DIGITS, '0')),
  };
}

/**
 * Creation order: `created_at`, then `id`. A tie on `created_at` is broken by
 * the id — arbitrary among the tied rows, but stable, so no slot moves between
 * two reads (this resolves 2.2a's deferred tiebreaker without a stored
 * ordinal). The ids are compared as plain code units, never by locale.
 */
export function compareCreation(
  first: Pick<ShiftTypeRow, 'createdAt' | 'id'>,
  second: Pick<ShiftTypeRow, 'createdAt' | 'id'>,
): number {
  const one = instantOf(first.createdAt);
  const other = instantOf(second.createdAt);

  if (one !== null && other !== null) {
    if (one.seconds !== other.seconds) return one.seconds < other.seconds ? -1 : 1;
    if (one.micros !== other.micros) return one.micros < other.micros ? -1 : 1;
  }

  if (first.id === second.id) return 0;

  return first.id < second.id ? -1 : 1;
}

// ------------------------------------------------------------- validation

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One embedded version, validated field by field, or `null` — refused when it
 * names another type or another tenant than its type's.
 */
function versionOf(entry: unknown, typeId: string, organizationId: string): ShiftTypeVersion | null {
  if (!isRecord(entry)) return null;
  if (textAt(entry, 'organization_id') !== organizationId) return null;

  const shiftTypeId = textAt(entry, 'shift_type_id');
  const startTime = textAt(entry, 'start_time');
  const endTime = textAt(entry, 'end_time');
  const effectiveFrom = textAt(entry, 'effective_from');

  if (shiftTypeId !== typeId || startTime === null || endTime === null || effectiveFrom === null) {
    return null;
  }
  if (!isIsoDate(effectiveFrom)) return null;

  const startMinute = minuteOfTime(startTime);
  const endMinute = minuteOfTime(endTime);

  if (startMinute === null || endMinute === null) return null;

  return { shiftTypeId, effectiveFrom, startMinute, endMinute };
}

/**
 * One embedded type as a row, or `null` — validated rather than cast, so a
 * malformed row refuses the answer instead of reaching the domain. A version
 * that does not validate, two versions on one date, or a version on a
 * NON-WORKING type (which has no times) refuse the row too.
 */
export function shiftTypeRowOf(row: unknown): ShiftTypeRow | null {
  if (!isRecord(row)) return null;

  const id = textAt(row, 'id');
  const organizationId = textAt(row, 'organization_id');
  const name = textAt(row, 'name');
  const createdAt = textAt(row, 'created_at');
  const isWorking = row['is_working'];
  const archived = row['archived'];
  const embedded = row['shift_type_versions'];

  if (id === null || organizationId === null || name === null || createdAt === null) return null;
  if (typeof isWorking !== 'boolean' || typeof archived !== 'boolean') return null;
  if (instantOf(createdAt) === null || !Array.isArray(embedded)) return null;

  const versions: ShiftTypeVersion[] = [];

  for (const entry of embedded as readonly unknown[]) {
    const version = versionOf(entry, id, organizationId);

    if (version === null) return null;

    versions.push(version);
  }

  if (new Set(versions.map((version) => version.effectiveFrom)).size !== versions.length) {
    return null;
  }
  if (!isWorking && versions.length > 0) return null;

  versions.sort((one, other) =>
    one.effectiveFrom < other.effectiveFrom ? -1 : one.effectiveFrom > other.effectiveFrom ? 1 : 0,
  );

  return { id, organizationId, name, isWorking, archived, createdAt, versions };
}

function unavailable(detail: unknown): ShiftTypesOutcome {
  console.error(SHIFT_TYPES_UNAVAILABLE, detail);

  return { ok: false, code: SHIFT_TYPES_UNAVAILABLE };
}

/**
 * The caller's organization, its zone and every type, or one stable code.
 *
 * Unavailable on a rejected or malformed answer, on a transport error, on
 * anything but EXACTLY ONE organization (by the exact count and by the rows
 * alike), on a type or version that does not validate, and on a type naming
 * another tenant. Zero types is an answer.
 */
export async function readShiftTypes(table: ShiftTypesTable): Promise<ShiftTypesOutcome> {
  let answered: ShiftTypesAnswer;

  try {
    answered = await table.select(SHIFT_TYPES_COLUMNS, SHIFT_TYPES_COUNT);
  } catch (cause) {
    return unavailable(cause);
  }

  if (!isRecord(answered)) return unavailable(typeof answered);
  if (answered.error !== null) return unavailable(answered.error.code);
  if (!Array.isArray(answered.data)) return unavailable('data');

  const rows: readonly unknown[] = answered.data;

  // ONE ORGANIZATION, by the count and by the rows. Zero means the session
  // reaches no organization at all; two would put two tenants on one screen.
  if (answered.count !== 1 || rows.length !== 1) return unavailable(answered.count);

  const organization = rows[0];

  if (!isRecord(organization)) return unavailable('organization');

  const organizationId = textAt(organization, 'id');
  const timeZone = textAt(organization, 'timezone');
  const embedded = organization['shift_types'];

  if (organizationId === null || timeZone === null || !Array.isArray(embedded)) {
    return unavailable('organization');
  }

  const types: ShiftTypeRow[] = [];

  for (const entry of embedded as readonly unknown[]) {
    const type = shiftTypeRowOf(entry);

    if (type === null) return unavailable('row');
    if (type.organizationId !== organizationId) return unavailable('organizations');

    types.push(type);
  }

  if (new Set(types.map((type) => type.id)).size !== types.length) return unavailable('ids');

  types.sort(compareCreation);

  return { ok: true, snapshot: { organizationId, timeZone, types } };
}

/** The type a route parameter names, or `null` when the answer holds none. */
export function shiftTypeById(snapshot: ShiftTypesSnapshot, id: string): ShiftTypeRow | null {
  return snapshot.types.find((type) => type.id === id) ?? null;
}

/**
 * The organization's today, in its own zone (L8) — never the device's date.
 * The zone arrives in the same answer as the types.
 */
export function shiftTypesTodayOf(snapshot: ShiftTypesSnapshot, now: Date): string {
  return organizationIsoDate(now, snapshot.timeZone);
}

// ------------------------------------------------------------- ramp slots

/**
 * Every working type's ramp slot, by id: `(i mod 6) + 1` over the WORKING
 * types — ARCHIVED ONES INCLUDED, so archiving a type never moves the slot of
 * a type created after it — in creation order. A non-working type has no slot
 * (it is drawn in `shift-nonworking`). Derived on every read, never stored.
 */
export function rampSlotsOf(types: readonly ShiftTypeRow[]): ReadonlyMap<string, RampSlot> {
  const slots = new Map<string, RampSlot>();
  const working = [...types].filter((type) => type.isWorking).sort(compareCreation);

  working.forEach((type, index) => {
    slots.set(type.id, rampSlotOf(index));
  });

  return slots;
}

/**
 * The chip classes for each slot, as STATIC STRINGS — Tailwind finds a utility
 * only when it is written out whole, so a class built from a number would ship
 * no colour at all.
 */
const SLOT_CHIP_CLASSES: Readonly<Record<RampSlot, string>> = {
  1: 'bg-shift-slot-1 text-shift-slot-1-foreground',
  2: 'bg-shift-slot-2 text-shift-slot-2-foreground',
  3: 'bg-shift-slot-3 text-shift-slot-3-foreground',
  4: 'bg-shift-slot-4 text-shift-slot-4-foreground',
  5: 'bg-shift-slot-5 text-shift-slot-5-foreground',
  6: 'bg-shift-slot-6 text-shift-slot-6-foreground',
};

/**
 * What a table cell shows where a type has no times: a non-working type's
 * times and duration (owner layout, story 2.3b — the kind column is gone, and
 * this, beside the chip's name, is how a non-working type reads). An em dash,
 * a mark rather than a word, so it is no copy.
 */
export const NO_TIMES_SHOWN = '\u2014';

/** A non-working type's chip. */
export const NONWORKING_CHIP_CLASS = 'bg-shift-nonworking text-shift-nonworking-foreground';

/** The chip's shape — the Badge primitive's pill — shared by every slot. */
export const CHIP_SHAPE_CLASS =
  'inline-flex min-w-0 max-w-full items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold';

/** A slot's colour classes alone — or the non-working ones — for a shape other than the pill. */
export function slotColourClassOf(slot: RampSlot | null): string {
  return slot === null ? NONWORKING_CHIP_CLASS : SLOT_CHIP_CLASSES[slot];
}

/** The chip classes a type is drawn in: the pill, and its slot's colour or the non-working one. */
export function chipClassOf(slot: RampSlot | null): string {
  return `${CHIP_SHAPE_CLASS} ${slotColourClassOf(slot)}`;
}

// ------------------------------------------------------------ display rows

/** One version's times as the screens show them — every figure from the domain. */
export interface ShiftTimesShown {
  readonly startMinute: number;
  readonly endMinute: number;
  /** `19:00–07:00`, en dash, unspaced (UX-DR34). */
  readonly range: string;
  readonly durationMinutes: number;
  readonly crossesMidnight: boolean;
}

/** A version's times, derived by `deriveShiftTimes` and only formatted here. */
export function shiftTimesShownOf(version: ShiftTypeVersion): ShiftTimesShown {
  const times = deriveShiftTimes(version.startMinute, version.endMinute);

  return {
    startMinute: times.startMinute,
    endMinute: times.endMinute,
    range: `${formatMinuteOfDay(times.startMinute)}${RANGE_DASH}${formatMinuteOfDay(times.endMinute)}`,
    durationMinutes: times.durationMinutes,
    crossesMidnight: times.crossesMidnight,
  };
}

/** A type's latest version, or `null` for a type that has none. */
export function latestVersionOf(type: ShiftTypeRow): ShiftTypeVersion | null {
  return type.versions[type.versions.length - 1] ?? null;
}

/**
 * The version scheduled after today, or `null`. AT MOST ONE: `0013` admits a
 * new version only while the latest one is already in effect, so the latest
 * is the only one that can be dated after today.
 */
export function scheduledVersionOf(type: ShiftTypeRow, today: string): ShiftTypeVersion | null {
  const latest = latestVersionOf(type);

  return latest !== null && latest.effectiveFrom > today ? latest : null;
}

/** One type as a screen draws it. */
export interface ShiftTypeDisplayRow {
  readonly type: ShiftTypeRow;
  /** The ramp slot, or `null` for a non-working type. */
  readonly slot: RampSlot | null;
  /** Static chip classes for the slot; the chip always carries the name as text. */
  readonly chipClass: string;
  /**
   * The times in effect today, from `shiftTypeVersionOn`. `null` for a
   * non-working type (it has none) and for a working type with no version in
   * effect yet — nothing invents them.
   */
  readonly times: ShiftTimesShown | null;
  /** The scheduled correction, with its date, or `null`. */
  readonly scheduled: { readonly from: string; readonly times: ShiftTimesShown } | null;
}

function displayRowOf(
  type: ShiftTypeRow,
  slots: ReadonlyMap<string, RampSlot>,
  today: string,
): ShiftTypeDisplayRow {
  const slot = type.isWorking ? (slots.get(type.id) ?? null) : null;
  const current = type.isWorking ? shiftTypeVersionOn(type.versions, today) : null;
  const scheduled = scheduledVersionOf(type, today);

  return {
    type,
    slot,
    chipClass: chipClassOf(slot),
    times: current === null ? null : shiftTimesShownOf(current),
    scheduled:
      scheduled === null
        ? null
        : { from: scheduled.effectiveFrom, times: shiftTimesShownOf(scheduled) },
  };
}

/** The list, split: types in use, and archived ones (listed separately, read-only). */
export interface ShiftTypeList {
  readonly active: readonly ShiftTypeDisplayRow[];
  readonly archived: readonly ShiftTypeDisplayRow[];
}

/** Every type as a display row, in creation order, split by `archived`. */
export function shiftTypeListOf(snapshot: ShiftTypesSnapshot, today: string): ShiftTypeList {
  const slots = rampSlotsOf(snapshot.types);
  const rows = [...snapshot.types].sort(compareCreation).map((type) => displayRowOf(type, slots, today));

  return {
    active: rows.filter((row) => !row.type.archived),
    archived: rows.filter((row) => row.type.archived),
  };
}

/** The one type's display row, or `null`. */
export function shiftTypeDisplayRowOf(
  snapshot: ShiftTypesSnapshot,
  id: string,
  today: string,
): ShiftTypeDisplayRow | null {
  const type = shiftTypeById(snapshot, id);

  return type === null ? null : displayRowOf(type, rampSlotsOf(snapshot.types), today);
}

// --------------------------------------------------------------- durations

export { durationValuesOf };

/**
 * Which shape a duration reads in — `12 h`, `1 h 30 min`, `45 min` — with no
 * plural, as `@/hour-bands/list`'s: `h` and `min` are units. The minutes are
 * the domain's `durationMinutes`, only divided for reading.
 */
export function shiftTypeDurationMessageKey(
  durationMinutes: number,
):
  | 'rotation.shiftTypes.duration.hours'
  | 'rotation.shiftTypes.duration.hoursMinutes'
  | 'rotation.shiftTypes.duration.minutes' {
  const { hours, minutes } = durationValuesOf(durationMinutes);

  if (minutes === 0) return 'rotation.shiftTypes.duration.hours';
  if (hours === 0) return 'rotation.shiftTypes.duration.minutes';

  return 'rotation.shiftTypes.duration.hoursMinutes';
}

// ------------------------------------------------------------ the messages

/** The edit screen's heading: an archived type is viewed, not edited. */
export function shiftTypeHeadingMessageKey(
  type: ShiftTypeRow | null,
): 'rotation.shiftTypes.editHeading' | 'rotation.shiftTypes.viewHeading' {
  return type !== null && type.archived
    ? 'rotation.shiftTypes.viewHeading'
    : 'rotation.shiftTypes.editHeading';
}

/** The message a read failure renders as. Exhaustive. */
export function shiftTypesMessageKey(
  failure: ShiftTypesFailure,
): 'rotation.shiftTypes.error.unavailable' {
  if (failure === SHIFT_TYPES_UNAVAILABLE) return 'rotation.shiftTypes.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}

// --------------------------------------------------------- surface state

/**
 * The one query definition every screen reading {@link SHIFT_TYPES_LIST_KEY}
 * uses. UNAVAILABLE REJECTS — the query function throws its code — and the
 * table is resolved inside it, for the reasons `hourBandsQueryOptions` gives:
 * a failed refetch keeps the cached types and is retried once.
 */
export function shiftTypesQueryOptions(table: () => ShiftTypesTable) {
  return queryOptions({
    queryKey: SHIFT_TYPES_LIST_KEY,
    queryFn: async (): Promise<ShiftTypesSnapshot> => {
      const outcome = await readShiftTypes(table());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.snapshot;
    },
    staleTime: SHIFT_TYPES_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

/** The query result the surface state is derived from. */
export interface ShiftTypesQueryAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  /** The last good answer, kept by TanStack Query across a failed refetch. */
  readonly data: ShiftTypesSnapshot | undefined;
}

export interface ShiftTypesSurfaceState {
  /** The snapshot to draw, or `null` when there is no answer to draw. */
  readonly snapshot: ShiftTypesSnapshot | null;
  readonly refusal: ShiftTypesFailure | null;
  /** Never true beside a message. */
  readonly loading: boolean;
}

/**
 * One query result as what the screen shows: answered, failed, paused offline,
 * and a failed refetch over a good answer (rows kept, message beside them).
 */
export function shiftTypesSurfaceStateOf(answer: ShiftTypesQueryAnswer): ShiftTypesSurfaceState {
  const snapshot = answer.data ?? null;
  const paused = answer.isPending && answer.fetchStatus === SHIFT_TYPES_FETCH_PAUSED;

  if (answer.isError || paused) {
    return { snapshot, refusal: SHIFT_TYPES_UNAVAILABLE, loading: false };
  }

  return { snapshot, refusal: null, loading: answer.isPending };
}
