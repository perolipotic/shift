import { minuteOfTime } from '@/hour-bands/list';
import { formatMinuteOfDay, isIsoDate, nextIsoDate } from '@/i18n/format';
import {
  latestVersionOf,
  scheduledVersionOf,
  shiftTypeById,
  type ShiftTypeRow,
  type ShiftTypesSurfaceState,
} from '@/shift-types/list';
import { claimedOrganizationOf } from '@/teams/write';
import type { ShiftTypeVersion } from '@shift/domain';

/**
 * The organization the caller's token names, or `null` — the claim reader
 * `@/teams/write` holds and tests, re-exported so the shift type screens import
 * every write rule from one module. Not trusted: `0013`'s insert policy pins
 * the tenant again.
 */
export { claimedOrganizationOf };

/**
 * Adding, renaming, correcting the times of, and archiving a shift type —
 * every decision the two shift type screens make, in a `.ts` that renders
 * nothing (AD-15, story 2.2b).
 *
 * ALL PLAIN POSTGREST, under `0013`'s policies:
 *
 *   * `shift_types` takes an insert of the tenant, the name and whether the
 *     type is worked, and an update of the name or `archived`. `is_working`
 *     has no update grant, so nothing here can send one after creation, and
 *     there is no delete of a type.
 *   * `shift_type_versions` takes an insert of a working type's times from a
 *     date, and the delete of the one scheduled version while it is still in
 *     the future. Never an update: a version is history.
 *
 * ADD IS TWO WRITES and not atomic (making it atomic would be an RPC, which
 * the spec reserves). A working type is inserted first, then its first version
 * from the organization's today. If the second write fails the type STAYS —
 * visible and editable — and {@link SHIFT_TYPE_CREATED_WITHOUT_TIMES} says it
 * has no times, so the admin sets them from its edit screen.
 *
 * EVERY VERSION RULE ARRIVES AS 42501 (they are WITH CHECK conjuncts), so the
 * certain ones — the date's minimum, a valid time — are refused here before
 * anything is sent, and the rest (the same times, a date the database's today
 * has passed) are the database's to refuse.
 *
 * ARCHIVE REFUSED AS 42501 MEANS A CHANGE IS SCHEDULED. `0013`'s update policy
 * admits `archived = true` only while nothing is scheduled after today, so
 * {@link archiveFailureOf} reads 42501 as {@link SHIFT_TYPE_CHANGE_SCHEDULED}:
 * cancel the scheduled change first.
 *
 * Codes, never messages: {@link shiftTypeWriteMessageKey} is the one edge.
 */

/** The name was empty once trimmed (client-side, or `shift_types_name_not_blank`). */
export const SHIFT_TYPE_NAME_EMPTY = 'SHIFT_TYPE_NAME_EMPTY';
/** Another type in use in this organization carries the name, ignoring case and padding. */
export const SHIFT_TYPE_NAME_TAKEN = 'SHIFT_TYPE_NAME_TAKEN';
/** A start or end is not a whole minute of the day (client-side, or a time check). */
export const SHIFT_TYPE_TIME_INVALID = 'SHIFT_TYPE_TIME_INVALID';
/** The date is not a calendar date, or is before the earliest one admitted. */
export const SHIFT_TYPE_DATE_INVALID = 'SHIFT_TYPE_DATE_INVALID';
/** A times write was refused (42501): the same times, or a date now in the past. */
export const SHIFT_TYPE_TIMES_REFUSED = 'SHIFT_TYPE_TIMES_REFUSED';
/** The entered times are the latest version's own: a correction must change them. */
export const SHIFT_TYPE_TIMES_UNCHANGED = 'SHIFT_TYPE_TIMES_UNCHANGED';
/** Archiving was refused (42501): a change of times is scheduled; cancel it first. */
export const SHIFT_TYPE_CHANGE_SCHEDULED = 'SHIFT_TYPE_CHANGE_SCHEDULED';
/** The type added, but its first times did not: it is listed with no times. */
export const SHIFT_TYPE_CREATED_WITHOUT_TIMES = 'SHIFT_TYPE_CREATED_WITHOUT_TIMES';
/** The type changed since the screen was drawn (zero rows, or out of reach). */
export const SHIFT_TYPE_STALE = 'SHIFT_TYPE_STALE';
/** The database refused the write outright (42501). */
export const SHIFT_TYPE_WRITE_REFUSED = 'SHIFT_TYPE_WRITE_REFUSED';
/** Some other value the database would not store. */
export const SHIFT_TYPE_WRITE_INVALID = 'SHIFT_TYPE_WRITE_INVALID';
/** The service, not the person: try again. */
export const SHIFT_TYPE_WRITE_UNAVAILABLE = 'SHIFT_TYPE_WRITE_UNAVAILABLE';
/** The route names a type the list does not hold. */
export const SHIFT_TYPE_UNKNOWN = 'SHIFT_TYPE_UNKNOWN';

export type ShiftTypeWriteFailure =
  | typeof SHIFT_TYPE_NAME_EMPTY
  | typeof SHIFT_TYPE_NAME_TAKEN
  | typeof SHIFT_TYPE_TIME_INVALID
  | typeof SHIFT_TYPE_DATE_INVALID
  | typeof SHIFT_TYPE_TIMES_REFUSED
  | typeof SHIFT_TYPE_TIMES_UNCHANGED
  | typeof SHIFT_TYPE_CHANGE_SCHEDULED
  | typeof SHIFT_TYPE_CREATED_WITHOUT_TIMES
  | typeof SHIFT_TYPE_STALE
  | typeof SHIFT_TYPE_WRITE_REFUSED
  | typeof SHIFT_TYPE_WRITE_INVALID
  | typeof SHIFT_TYPE_WRITE_UNAVAILABLE
  | typeof SHIFT_TYPE_UNKNOWN;

export type ShiftTypeWriteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ShiftTypeWriteFailure };

// ----------------------------------------------------------------- the seams

export interface ShiftTypeWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

export interface ShiftTypeWriteAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: ShiftTypeWriteError | null;
}

interface Selecting {
  select(columns: string): PromiseLike<ShiftTypeWriteAnswer>;
}

interface Filtering {
  eq(column: string, value: string): Selecting;
}

interface FilteringTwice {
  eq(column: string, value: string): Filtering;
}

/** The calls made on `shift_types`, named structurally so they can be stubbed. */
export interface ShiftTypeWriteTable {
  insert(values: Readonly<Record<string, unknown>>): Selecting;
  update(values: Readonly<Record<string, unknown>>): Filtering;
}

/** The calls made on `shift_type_versions`: append, and cancel the scheduled one. No update. */
export interface ShiftTypeVersionWriteTable {
  insert(values: Readonly<Record<string, unknown>>): Selecting;
  delete(): FilteringTwice;
}

const RETURNED_COLUMNS = 'id';
const ID_COLUMN = 'id';
const TYPE_COLUMN = 'shift_type_id';
const DATE_COLUMN = 'effective_from';

// ---------------------------------------------------------------- the rules

/** The name as it will be stored — trimmed — or `null` when nothing is left. */
export function enteredShiftTypeName(value: string): string | null {
  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

/**
 * An entered time as the `time` literal sent — `07:00` — or `null` when it is
 * not a whole minute of the day. Read through the parser the list reads stored
 * times with, so what is sent and what comes back agree.
 */
export function enteredShiftTypeTime(value: string): string | null {
  const minute = minuteOfTime(value.trim());

  return minute === null ? null : formatMinuteOfDay(minute);
}

/** Working, or not: chosen once, at creation. */
export const SHIFT_TYPE_WORKING = 'working';
export const SHIFT_TYPE_NONWORKING = 'nonworking';

export type ShiftTypeKind = typeof SHIFT_TYPE_WORKING | typeof SHIFT_TYPE_NONWORKING;

/** The two kinds, in the order the add form offers them. */
export const SHIFT_TYPE_KINDS: readonly ShiftTypeKind[] = [SHIFT_TYPE_WORKING, SHIFT_TYPE_NONWORKING];

/** The kind a `<select>` value names; anything else reads as working, the default. */
export function shiftTypeKindOf(value: string): ShiftTypeKind {
  return value === SHIFT_TYPE_NONWORKING ? SHIFT_TYPE_NONWORKING : SHIFT_TYPE_WORKING;
}

/** The label of a kind. Exhaustive. */
export function shiftTypeKindMessageKey(
  kind: ShiftTypeKind,
): 'rotation.shiftTypes.working' | 'rotation.shiftTypes.nonworking' {
  if (kind === SHIFT_TYPE_WORKING) return 'rotation.shiftTypes.working';
  if (kind === SHIFT_TYPE_NONWORKING) return 'rotation.shiftTypes.nonworking';

  const unhandled: never = kind;

  return unhandled;
}

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const VALUE_CLASSES = ['22', '23'];

/** `0013`'s constraint names, as PostgREST reports them in `message`/`details`. */
const NAME_UNIQUE = 'shift_types_organization_name_key';
const NAME_CHECK = 'shift_types_name_not_blank';
const TIME_CHECKS = [
  'shift_type_versions_start_before_midnight',
  'shift_type_versions_end_before_midnight',
  'shift_type_versions_start_whole_minute',
  'shift_type_versions_end_whole_minute',
];
const DATE_CHECK = 'shift_type_versions_effective_from_finite';
const DATE_UNIQUE = 'shift_type_versions_shift_type_id_effective_from_key';

/**
 * A PostgREST refusal on either table, as this application's own failure —
 * BY CONSTRAINT NAME, as `@/hour-bands/write` reads them: `23505` and `23514`
 * are each raised by more than one constraint, and the refusal must name the
 * problem it is. `42501` is the permission here; each write that reads it as
 * something more specific says so ({@link timesFailureOf},
 * {@link archiveFailureOf}).
 */
export function shiftTypeWriteFailureOf(error: ShiftTypeWriteError): ShiftTypeWriteFailure {
  const named = `${error.message ?? ''} ${error.details ?? ''}`;

  if (error.code === UNIQUE_VIOLATION) {
    if (named.includes(NAME_UNIQUE)) return SHIFT_TYPE_NAME_TAKEN;
    // A version already on that date: the type changed since the screen was
    // drawn (the minimum is after the latest version the screen knew of).
    if (named.includes(DATE_UNIQUE)) return SHIFT_TYPE_STALE;

    return SHIFT_TYPE_WRITE_INVALID;
  }

  if (error.code === CHECK_VIOLATION) {
    if (named.includes(NAME_CHECK)) return SHIFT_TYPE_NAME_EMPTY;
    if (TIME_CHECKS.some((check) => named.includes(check))) return SHIFT_TYPE_TIME_INVALID;
    if (named.includes(DATE_CHECK)) return SHIFT_TYPE_DATE_INVALID;

    return SHIFT_TYPE_WRITE_INVALID;
  }

  if (error.code === INSUFFICIENT_PRIVILEGE) return SHIFT_TYPE_WRITE_REFUSED;
  if (error.code !== undefined && VALUE_CLASSES.includes(error.code.slice(0, 2))) {
    return SHIFT_TYPE_WRITE_INVALID;
  }

  return SHIFT_TYPE_WRITE_UNAVAILABLE;
}

/**
 * A times write's refusal: `42501` is one of the version rules the client
 * cannot see from here — the same times as the latest version, or a date the
 * database's today has already passed — so it is {@link SHIFT_TYPE_TIMES_REFUSED}.
 */
export function timesFailureOf(error: ShiftTypeWriteError): ShiftTypeWriteFailure {
  if (error.code === INSUFFICIENT_PRIVILEGE) return SHIFT_TYPE_TIMES_REFUSED;

  return shiftTypeWriteFailureOf(error);
}

/**
 * An archive's refusal. `42501` is the scheduled-change rule (see the module
 * comment) ONLY when the snapshot shows a change scheduled — then the message
 * says to cancel it first. Without one, the list cannot explain the refusal,
 * and it is the plain permission refusal.
 */
export function archiveFailureOf(
  error: ShiftTypeWriteError,
  scheduled: boolean,
): ShiftTypeWriteFailure {
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    return scheduled ? SHIFT_TYPE_CHANGE_SCHEDULED : SHIFT_TYPE_WRITE_REFUSED;
  }

  return shiftTypeWriteFailureOf(error);
}

/** One write, settled: a thrown call, an error, zero rows, or its rows. */
type Settled =
  | { readonly ok: true; readonly rows: readonly unknown[] }
  | { readonly ok: false; readonly code: ShiftTypeWriteFailure };

async function settledRows(
  write: () => PromiseLike<ShiftTypeWriteAnswer>,
  failureOf: (error: ShiftTypeWriteError) => ShiftTypeWriteFailure,
): Promise<Settled> {
  let answered: ShiftTypeWriteAnswer;

  try {
    answered = await write();
  } catch (cause) {
    console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);

    return { ok: false, code: SHIFT_TYPE_WRITE_UNAVAILABLE };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, typeof answered);

    return { ok: false, code: SHIFT_TYPE_WRITE_UNAVAILABLE };
  }

  // Rows that are not rows: the service, never the person. Checked before the
  // error so a malformed answer cannot be read as a zero-row stale refusal.
  if (answered.data !== null && answered.data !== undefined && !Array.isArray(answered.data)) {
    console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, 'data');

    return { ok: false, code: SHIFT_TYPE_WRITE_UNAVAILABLE };
  }

  if (answered.error !== null) {
    const code = failureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  const rows = answered.data ?? [];

  // ZERO ROWS: the policy's USING matched nothing — the type or version is
  // gone from this session's reach since the screen was drawn.
  if (rows.length === 0) return { ok: false, code: SHIFT_TYPE_STALE };

  return { ok: true, rows };
}

async function settled(
  write: () => PromiseLike<ShiftTypeWriteAnswer>,
  failureOf: (error: ShiftTypeWriteError) => ShiftTypeWriteFailure = shiftTypeWriteFailureOf,
): Promise<ShiftTypeWriteOutcome> {
  const outcome = await settledRows(write, failureOf);

  return outcome.ok ? { ok: true } : outcome;
}

// --------------------------------------------------------------- the times

/** What was entered for a span of times, checked before anything is sent. */
type EnteredTimes =
  | { readonly ok: true; readonly startTime: string; readonly endTime: string }
  | { readonly ok: false; readonly code: ShiftTypeWriteFailure };

function enteredTimesOf(start: string, end: string): EnteredTimes {
  const startTime = enteredShiftTypeTime(start);
  const endTime = enteredShiftTypeTime(end);

  // Equal times are VALID: `07:00–07:00` is a 24-hour type.
  if (startTime === null || endTime === null) return { ok: false, code: SHIFT_TYPE_TIME_INVALID };

  return { ok: true, startTime, endTime };
}

/**
 * The earliest date a new version of `type` may carry: the later of the
 * organization's today and the day after the type's latest version, because
 * versions append in strictly increasing date order. `null` when there is no
 * date left to offer (the latest is on `9999-12-31`).
 */
export function timesMinimumOf(type: ShiftTypeRow, today: string): string | null {
  const latest = latestVersionOf(type);

  if (latest === null) return today;

  const afterLatest = nextIsoDate(latest.effectiveFrom);

  if (afterLatest === null) return null;

  return afterLatest > today ? afterLatest : today;
}

/** Set a working type's first times, when it has none. */
export const TIMES_SET = 'set';
/** Correct a working type's times from a date. */
export const TIMES_CORRECT = 'correct';
/** A correction is scheduled: the only thing offered is cancelling it. */
export const TIMES_CANCEL = 'cancel';

/** What the times block of one type offers. */
export type TimesOffer =
  | {
      readonly kind: typeof TIMES_SET | typeof TIMES_CORRECT;
      /** The earliest date the control admits, and its default. */
      readonly minimum: string;
    }
  | {
      readonly kind: typeof TIMES_CANCEL;
      /** The scheduled version the cancellation removes. */
      readonly scheduled: ShiftTypeVersion;
    };

/**
 * The times block's offer, or `null` when there is none: a non-working type
 * has no times, an archived one is frozen, and a type whose latest version is
 * on the last day there is has no later date left.
 *
 * WHILE A CORRECTION IS SCHEDULED IT IS OFFERED ONLY FOR CANCELLATION —
 * `0013` admits one scheduled version at a time — and a working type with no
 * version at all is offered "set times" from today.
 */
export function timesOfferOf(type: ShiftTypeRow, today: string): TimesOffer | null {
  if (!type.isWorking || type.archived) return null;

  const scheduled = scheduledVersionOf(type, today);

  if (scheduled !== null) return { kind: TIMES_CANCEL, scheduled };

  const minimum = timesMinimumOf(type, today);

  if (minimum === null) return null;

  return { kind: type.versions.length === 0 ? TIMES_SET : TIMES_CORRECT, minimum };
}

/**
 * Append a version of `type`'s times from `date`. Refused before anything is
 * sent when the type offers no times change (non-working, archived, or a
 * change already scheduled — stale), when the date is not a calendar date or
 * is before {@link timesMinimumOf}, or when a time is not a whole minute.
 */
export async function correctShiftTypeTimes(
  table: ShiftTypeVersionWriteTable,
  type: ShiftTypeRow,
  entered: { readonly date: string; readonly start: string; readonly end: string },
  today: string,
): Promise<ShiftTypeWriteOutcome> {
  const offer = timesOfferOf(type, today);

  if (offer === null || offer.kind === TIMES_CANCEL) return { ok: false, code: SHIFT_TYPE_STALE };

  const date = entered.date.trim();

  // ISO dates order as strings, so this is the policy's own comparison.
  if (!isIsoDate(date) || date < offer.minimum) return { ok: false, code: SHIFT_TYPE_DATE_INVALID };

  const times = enteredTimesOf(entered.start, entered.end);

  if (!times.ok) return times;

  // THE SAME TIMES AS THE LATEST VERSION change nothing, and `0013` would
  // refuse them as a bare 42501; said here, before sending, by name.
  const latest = latestVersionOf(type);

  if (
    latest !== null &&
    formatMinuteOfDay(latest.startMinute) === times.startTime &&
    formatMinuteOfDay(latest.endMinute) === times.endTime
  ) {
    return { ok: false, code: SHIFT_TYPE_TIMES_UNCHANGED };
  }

  return settled(
    () =>
      table
        .insert({
          organization_id: type.organizationId,
          shift_type_id: type.id,
          start_time: times.startTime,
          end_time: times.endTime,
          effective_from: date,
        })
        .select(RETURNED_COLUMNS),
    timesFailureOf,
  );
}

/**
 * Cancel the scheduled correction. Zero rows back means it is gone or already
 * in effect: stale.
 */
export async function cancelScheduledTimes(
  table: ShiftTypeVersionWriteTable,
  type: ShiftTypeRow,
  today: string,
): Promise<ShiftTypeWriteOutcome> {
  const scheduled = scheduledVersionOf(type, today);

  if (scheduled === null || type.archived) return { ok: false, code: SHIFT_TYPE_STALE };

  return settled(() =>
    table
      .delete()
      .eq(TYPE_COLUMN, type.id)
      .eq(DATE_COLUMN, scheduled.effectiveFrom)
      .select(RETURNED_COLUMNS),
  );
}

// ------------------------------------------------------------------ the add

/** What the add form holds. */
export interface EnteredShiftType {
  readonly name: string;
  readonly kind: ShiftTypeKind;
  /** Read only for a working type. */
  readonly start: string;
  readonly end: string;
}

function createdIdOf(rows: readonly unknown[]): string | null {
  const row = rows[0];

  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;

  const id = (row as Record<string, unknown>)['id'];

  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * Add a type: the type, then — for a working one — its first version from the
 * organization's `today`. See the module comment: a failed second write
 * leaves the type in place and answers {@link SHIFT_TYPE_CREATED_WITHOUT_TIMES}.
 *
 * Everything the add can refuse by itself (a blank name, an invalid time, no
 * known today) is refused BEFORE the first write, so a refusal the person can
 * correct never leaves a half-created type behind.
 */
export async function createShiftType(
  tables: { readonly types: ShiftTypeWriteTable; readonly versions: ShiftTypeVersionWriteTable },
  organizationId: string,
  entered: EnteredShiftType,
  today: string | null,
): Promise<ShiftTypeWriteOutcome> {
  const name = enteredShiftTypeName(entered.name);

  if (name === null) return { ok: false, code: SHIFT_TYPE_NAME_EMPTY };

  const working = entered.kind === SHIFT_TYPE_WORKING;
  const times = working ? enteredTimesOf(entered.start, entered.end) : null;

  if (times !== null && !times.ok) return times;
  if (working && today === null) return { ok: false, code: SHIFT_TYPE_WRITE_UNAVAILABLE };

  const created = await settledRows(
    () =>
      tables.types
        .insert({ organization_id: organizationId, name, is_working: working })
        .select(RETURNED_COLUMNS),
    shiftTypeWriteFailureOf,
  );

  if (!created.ok) return created;
  if (times === null || today === null) return { ok: true };

  const id = createdIdOf(created.rows);

  if (id === null) {
    console.error(SHIFT_TYPE_CREATED_WITHOUT_TIMES, 'id');

    return { ok: false, code: SHIFT_TYPE_CREATED_WITHOUT_TIMES };
  }

  const first = await settled(
    () =>
      tables.versions
        .insert({
          organization_id: organizationId,
          shift_type_id: id,
          start_time: times.startTime,
          end_time: times.endTime,
          effective_from: today,
        })
        .select(RETURNED_COLUMNS),
    timesFailureOf,
  );

  if (!first.ok) {
    console.error(SHIFT_TYPE_CREATED_WITHOUT_TIMES, first.code);

    return { ok: false, code: SHIFT_TYPE_CREATED_WITHOUT_TIMES };
  }

  return { ok: true };
}

// ----------------------------------------------------- rename and archive

/** Rename a type in place; its id never changes, so the rename is on every date. */
export async function renameShiftType(
  table: ShiftTypeWriteTable,
  type: ShiftTypeRow,
  entered: string,
): Promise<ShiftTypeWriteOutcome> {
  const name = enteredShiftTypeName(entered);

  if (name === null) return { ok: false, code: SHIFT_TYPE_NAME_EMPTY };
  if (type.archived) return { ok: false, code: SHIFT_TYPE_STALE };

  return settled(() => table.update({ name }).eq(ID_COLUMN, type.id).select(RETURNED_COLUMNS));
}

/**
 * Whether archiving is offered at all: not while a correction is scheduled —
 * `0013` refuses it, so the screen says to cancel the change first instead.
 */
export function archiveOfferedOf(type: ShiftTypeRow, today: string): boolean {
  return !type.archived && scheduledVersionOf(type, today) === null;
}

/**
 * Archive a type. One-way: nothing in this module writes `archived: false`.
 * Refused before sending while the snapshot shows a correction scheduled.
 */
export async function archiveShiftType(
  table: ShiftTypeWriteTable,
  type: ShiftTypeRow,
  today: string,
): Promise<ShiftTypeWriteOutcome> {
  if (type.archived) return { ok: false, code: SHIFT_TYPE_STALE };

  const scheduled = scheduledVersionOf(type, today) !== null;

  if (scheduled) return { ok: false, code: SHIFT_TYPE_CHANGE_SCHEDULED };

  return settled(
    () => table.update({ archived: true }).eq(ID_COLUMN, type.id).select(RETURNED_COLUMNS),
    (error) => archiveFailureOf(error, scheduled),
  );
}

// ---------------------------------------------------- where focus stays

export const SHIFT_TYPE_NAME_FIELD = 'name';
export const SHIFT_TYPE_START_FIELD = 'start';
export const SHIFT_TYPE_END_FIELD = 'end';
export const SHIFT_TYPE_DATE_FIELD = 'date';

export type ShiftTypeField =
  | typeof SHIFT_TYPE_NAME_FIELD
  | typeof SHIFT_TYPE_START_FIELD
  | typeof SHIFT_TYPE_END_FIELD
  | typeof SHIFT_TYPE_DATE_FIELD;

/**
 * Whether a refusal marks one field as the invalid one. A time refusal marks
 * both times, since either may be the one; a refusal about no field marks none.
 */
export function marksField(failure: ShiftTypeWriteFailure | null, field: ShiftTypeField): boolean {
  if (failure === SHIFT_TYPE_NAME_EMPTY || failure === SHIFT_TYPE_NAME_TAKEN) {
    return field === SHIFT_TYPE_NAME_FIELD;
  }
  if (failure === SHIFT_TYPE_TIME_INVALID) {
    return field === SHIFT_TYPE_START_FIELD || field === SHIFT_TYPE_END_FIELD;
  }
  if (failure === SHIFT_TYPE_DATE_INVALID) return field === SHIFT_TYPE_DATE_FIELD;

  return false;
}

/**
 * The field focus goes to after a refusal: the one it is about, or `fallback`
 * — the form's first field — when it is about none.
 */
export function refusedFieldOf(
  failure: ShiftTypeWriteFailure,
  fallback: ShiftTypeField,
): ShiftTypeField {
  if (failure === SHIFT_TYPE_NAME_EMPTY || failure === SHIFT_TYPE_NAME_TAKEN) {
    return SHIFT_TYPE_NAME_FIELD;
  }
  if (failure === SHIFT_TYPE_TIME_INVALID) return SHIFT_TYPE_START_FIELD;
  if (failure === SHIFT_TYPE_DATE_INVALID) return SHIFT_TYPE_DATE_FIELD;

  return fallback;
}

// ------------------------------------------------------------ the messages

/** The edge, and the only place one of these codes becomes Croatian. Exhaustive. */
export function shiftTypeWriteMessageKey(
  failure: ShiftTypeWriteFailure,
):
  | 'rotation.shiftTypes.error.nameEmpty'
  | 'rotation.shiftTypes.error.nameTaken'
  | 'rotation.shiftTypes.error.timeInvalid'
  | 'rotation.shiftTypes.error.dateInvalid'
  | 'rotation.shiftTypes.error.timesRefused'
  | 'rotation.shiftTypes.error.timesUnchanged'
  | 'rotation.shiftTypes.error.changeScheduled'
  | 'rotation.shiftTypes.error.createdWithoutTimes'
  | 'rotation.shiftTypes.error.stale'
  | 'rotation.shiftTypes.error.refused'
  | 'rotation.shiftTypes.error.invalid'
  | 'rotation.shiftTypes.error.saveUnavailable'
  | 'rotation.shiftTypes.error.unknown' {
  switch (failure) {
    case SHIFT_TYPE_NAME_EMPTY:
      return 'rotation.shiftTypes.error.nameEmpty';
    case SHIFT_TYPE_NAME_TAKEN:
      return 'rotation.shiftTypes.error.nameTaken';
    case SHIFT_TYPE_TIME_INVALID:
      return 'rotation.shiftTypes.error.timeInvalid';
    case SHIFT_TYPE_DATE_INVALID:
      return 'rotation.shiftTypes.error.dateInvalid';
    case SHIFT_TYPE_TIMES_REFUSED:
      return 'rotation.shiftTypes.error.timesRefused';
    case SHIFT_TYPE_TIMES_UNCHANGED:
      return 'rotation.shiftTypes.error.timesUnchanged';
    case SHIFT_TYPE_CHANGE_SCHEDULED:
      return 'rotation.shiftTypes.error.changeScheduled';
    case SHIFT_TYPE_CREATED_WITHOUT_TIMES:
      return 'rotation.shiftTypes.error.createdWithoutTimes';
    case SHIFT_TYPE_STALE:
      return 'rotation.shiftTypes.error.stale';
    case SHIFT_TYPE_WRITE_REFUSED:
      return 'rotation.shiftTypes.error.refused';
    case SHIFT_TYPE_WRITE_INVALID:
      return 'rotation.shiftTypes.error.invalid';
    case SHIFT_TYPE_WRITE_UNAVAILABLE:
      return 'rotation.shiftTypes.error.saveUnavailable';
    case SHIFT_TYPE_UNKNOWN:
      return 'rotation.shiftTypes.error.unknown';
    default: {
      const unhandled: never = failure;

      return unhandled;
    }
  }
}

// ------------------------------------------------------ the archive stages

/** The offer stands: one neutral action naming the type. */
export const ARCHIVE_IDLE = 'idle';
/** One press armed the confirmation, which names the type. */
export const ARCHIVE_ARMED = 'armed';
/** The confirmed write is outstanding; the confirmation stays, disabled. */
export const ARCHIVE_BUSY = 'busy';

export type ArchiveStage = typeof ARCHIVE_IDLE | typeof ARCHIVE_ARMED | typeof ARCHIVE_BUSY;

/**
 * Which archive control renders. IDLE whenever the confirmation is not armed —
 * a rename, times or cancel write in flight sets `pending` too, and must not
 * reveal the confirmation. Armed and pending is BUSY: the confirmation stays
 * mounted while the archive is outstanding, so no enabled control can start a
 * second. (The idle offer is disabled by `pending` on the screen.)
 */
export function archiveStageOf(armed: boolean, pending: boolean): ArchiveStage {
  if (!armed) return ARCHIVE_IDLE;

  return pending ? ARCHIVE_BUSY : ARCHIVE_ARMED;
}

// ------------------------------------------------------- the form state

/**
 * What the edit screen renders for the type its route names: `null` with no
 * refusal while the list loads and whenever the read has failed (even over
 * cached rows — the screen then shows only the read message, as the team and
 * band screens do); {@link SHIFT_TYPE_UNKNOWN} when the answer settled
 * without the type.
 */
export interface ShiftTypeFormState {
  readonly type: ShiftTypeRow | null;
  readonly refusal: typeof SHIFT_TYPE_UNKNOWN | null;
}

export function shiftTypeFormStateOf(state: ShiftTypesSurfaceState, id: string): ShiftTypeFormState {
  const { snapshot, loading } = state;

  if (snapshot === null || state.refusal !== null) return { type: null, refusal: null };

  const type = shiftTypeById(snapshot, id);

  if (type === null && !loading) return { type: null, refusal: SHIFT_TYPE_UNKNOWN };

  return { type, refusal: null };
}

/**
 * The key the rename form is mounted under: the type, and how many writes THIS
 * SCREEN has landed — never its name, so a refused save followed by a re-read
 * bringing a change made elsewhere keeps what was typed.
 */
export function shiftTypeFormKey(type: ShiftTypeRow, saves: number): string {
  return `${type.id}:${String(saves)}`;
}

/**
 * The key the times form is mounted under: the type and its whole version
 * history. A version landing (or a cancellation) changes it, so the date
 * returns to the new minimum; a refusal changes nothing, so the entered
 * date and times are kept.
 */
export function timesFormKey(type: ShiftTypeRow): string {
  return [
    type.id,
    ...type.versions.map(
      (version) =>
        `${version.effectiveFrom}:${String(version.startMinute)}:${String(version.endMinute)}`,
    ),
  ].join('|');
}

/** How many landed writes the form key counts after one write settles. */
export function savesAfter(saves: number, outcome: ShiftTypeWriteOutcome): number {
  return outcome.ok ? saves + 1 : saves;
}

// ---------------------------------------------------- what a save says

export const SHIFT_TYPE_CREATED = 'created';
export const SHIFT_TYPE_RENAMED = 'renamed';
export const SHIFT_TYPE_TIMES_SAVED = 'timesSaved';
export const SHIFT_TYPE_TIMES_CANCELLED = 'timesCancelled';
export const SHIFT_TYPE_ARCHIVED = 'archived';

export type ShiftTypeSaved =
  | typeof SHIFT_TYPE_CREATED
  | typeof SHIFT_TYPE_RENAMED
  | typeof SHIFT_TYPE_TIMES_SAVED
  | typeof SHIFT_TYPE_TIMES_CANCELLED
  | typeof SHIFT_TYPE_ARCHIVED;

/** The confirmation a landed write renders. Exhaustive. */
export function shiftTypeSavedMessageKey(
  saved: ShiftTypeSaved,
):
  | 'rotation.shiftTypes.created'
  | 'rotation.shiftTypes.renamed'
  | 'rotation.shiftTypes.timesSaved'
  | 'rotation.shiftTypes.timesCancelled'
  | 'rotation.shiftTypes.archivedDone' {
  switch (saved) {
    case SHIFT_TYPE_CREATED:
      return 'rotation.shiftTypes.created';
    case SHIFT_TYPE_RENAMED:
      return 'rotation.shiftTypes.renamed';
    case SHIFT_TYPE_TIMES_SAVED:
      return 'rotation.shiftTypes.timesSaved';
    case SHIFT_TYPE_TIMES_CANCELLED:
      return 'rotation.shiftTypes.timesCancelled';
    case SHIFT_TYPE_ARCHIVED:
      return 'rotation.shiftTypes.archivedDone';
    default: {
      const unhandled: never = saved;

      return unhandled;
    }
  }
}

// ------------------------------------------------------- after the add

/** What the add form does once `createShiftType` settles. */
export interface CreatedOutcome {
  /** Clear the fields: the type exists (with or without its times). */
  readonly clearForm: boolean;
  /** The confirmation to render, or `null`. */
  readonly saved: ShiftTypeSaved | null;
  /** The refusal to render, or `null`. */
  readonly failure: ShiftTypeWriteFailure | null;
  /** Re-read the list: something was written. */
  readonly refetch: boolean;
}

/**
 * The add's three outcome kinds. CREATED: clear, confirm, re-read. CREATED
 * WITHOUT TIMES: the type exists, so clear and re-read, and say its times are
 * still to be set. REFUSED: nothing was written, so keep every entered value,
 * say why, and re-read nothing.
 */
export function createdOutcomeOf(outcome: ShiftTypeWriteOutcome): CreatedOutcome {
  if (outcome.ok) {
    return { clearForm: true, saved: SHIFT_TYPE_CREATED, failure: null, refetch: true };
  }

  if (outcome.code === SHIFT_TYPE_CREATED_WITHOUT_TIMES) {
    return { clearForm: true, saved: null, failure: outcome.code, refetch: true };
  }

  return { clearForm: false, saved: null, failure: outcome.code, refetch: false };
}

/**
 * Whether focus moves to the confirmation once a write lands. After an archive
 * or a cancellation the pressed button unmounts with its block, so focus would
 * fall to the document; the confirmation is where it goes instead.
 */
export function focusesConfirmation(saved: ShiftTypeSaved | null): boolean {
  return saved === SHIFT_TYPE_ARCHIVED || saved === SHIFT_TYPE_TIMES_CANCELLED;
}
