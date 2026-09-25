import { formatMinuteOfDay } from '@/i18n/format';
import { hourBandById, minuteOfTime, type HourBandRow } from '@/hour-bands/list';
import { claimedOrganizationOf } from '@/teams/write';

/**
 * The organization the caller's token names, or `null`. ONE PARSER: the claim
 * reader `@/teams/write` already holds and tests, re-exported so the band
 * screens import every write rule from one module. Not trusted — `0012`'s
 * insert policy pins the tenant again.
 */
export { claimedOrganizationOf };

/**
 * Adding, editing and removing an hour band — every decision the two band
 * screens make, in a `.ts` that renders nothing (AD-15, story 2.1b).
 *
 * THREE WRITES, ALL PLAIN POSTGREST. `0012`'s policies admit an active admin
 * to insert a band, to update its name or start, and to delete it. Bands are
 * current-state (CAP-3), so a removal really deletes — any band, the last one
 * included (human decision 2026-09-25) — and the day it leaves uncovered is
 * hatched on the bar rather than refused here.
 *
 * ONLY A NAME AND A START ARE WRITTEN. The window, the duration and the
 * midnight flag are derived by `@shift/domain` on read and have no column to
 * write (AD-3), so nothing in this module can express one.
 *
 * NO SWAP. Moving a band onto a start another band holds is refused by
 * `hour_bands_organization_id_start_time_key` and reported as exactly that; two
 * bands trading starts is two writes this story does not offer.
 *
 * ZERO ROWS IS THE STALE REFUSAL. An update or delete that reaches no row means
 * the band is gone from this session's reach since the screen was drawn —
 * removed elsewhere, most likely — and {@link HOUR_BAND_STALE} says so.
 *
 * Codes, never messages: {@link hourBandWriteMessageKey} is the one edge.
 */

/** The name was empty once trimmed (client-side, or `hour_bands_name_not_blank`). */
export const HOUR_BAND_NAME_EMPTY = 'HOUR_BAND_NAME_EMPTY';
/** Another band in this organization carries the name, ignoring case and padding. */
export const HOUR_BAND_NAME_TAKEN = 'HOUR_BAND_NAME_TAKEN';
/** Another band in this organization starts at the same minute. */
export const HOUR_BAND_START_TAKEN = 'HOUR_BAND_START_TAKEN';
/** The start is not a whole minute of the day (client-side, or either time check). */
export const HOUR_BAND_START_INVALID = 'HOUR_BAND_START_INVALID';
/** The band changed since the screen was drawn (removed, or out of reach). */
export const HOUR_BAND_STALE = 'HOUR_BAND_STALE';
/** The database refused the write outright (42501). */
export const HOUR_BAND_WRITE_REFUSED = 'HOUR_BAND_WRITE_REFUSED';
/** Some other value the database would not store. */
export const HOUR_BAND_WRITE_INVALID = 'HOUR_BAND_WRITE_INVALID';
/** The service, not the person: try again. */
export const HOUR_BAND_WRITE_UNAVAILABLE = 'HOUR_BAND_WRITE_UNAVAILABLE';
/** The route names a band the list does not hold. */
export const HOUR_BAND_UNKNOWN = 'HOUR_BAND_UNKNOWN';

export type HourBandWriteFailure =
  | typeof HOUR_BAND_NAME_EMPTY
  | typeof HOUR_BAND_NAME_TAKEN
  | typeof HOUR_BAND_START_TAKEN
  | typeof HOUR_BAND_START_INVALID
  | typeof HOUR_BAND_STALE
  | typeof HOUR_BAND_WRITE_REFUSED
  | typeof HOUR_BAND_WRITE_INVALID
  | typeof HOUR_BAND_WRITE_UNAVAILABLE
  | typeof HOUR_BAND_UNKNOWN;

export type HourBandWriteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: HourBandWriteFailure };

// ----------------------------------------------------------------- the seams

export interface HourBandWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

export interface HourBandWriteAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: HourBandWriteError | null;
}

interface Selecting {
  select(columns: string): PromiseLike<HourBandWriteAnswer>;
}

interface Filtering {
  eq(column: string, value: string): Selecting;
}

/** The three calls this module makes, named structurally so they can be stubbed. */
export interface HourBandWriteTable {
  insert(values: Readonly<Record<string, unknown>>): Selecting;
  update(values: Readonly<Record<string, unknown>>): Filtering;
  delete(): Filtering;
}

const RETURNED_COLUMNS = 'id';
const ID_COLUMN = 'id';

// ---------------------------------------------------------------- the rules

/** The name as it will be stored — trimmed — or `null` when nothing is left. */
export function enteredHourBandName(value: string): string | null {
  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

/**
 * The entered start as the `time` literal sent — `07:00` — or `null` when it is
 * not a whole minute of the day. Read through the same parser the list reads
 * the stored value with, so what is sent and what comes back agree.
 */
export function enteredHourBandStart(value: string): string | null {
  const minute = minuteOfTime(value.trim());

  return minute === null ? null : formatMinuteOfDay(minute);
}

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const DATETIME_CLASS = '22007';
const DATETIME_OVERFLOW = '22008';
const VALUE_CLASSES = ['22', '23'];

/** `0012`'s constraint names, as PostgREST reports them in `message`/`details`. */
const START_UNIQUE = 'hour_bands_organization_id_start_time_key';
const NAME_UNIQUE = 'hour_bands_organization_name_key';
const NAME_CHECK = 'hour_bands_name_not_blank';
const START_CHECKS = ['hour_bands_start_before_midnight', 'hour_bands_start_whole_minute'];

/**
 * A PostgREST refusal on `hour_bands`, as this application's own failure.
 *
 * BY CONSTRAINT NAME, NOT BY CODE ALONE, because the code is ambiguous twice
 * over: two uniques raise `23505` (the start and the name) and three checks
 * raise `23514` (the blank name and the two time checks). Mapping by code would
 * tell somebody who picked a taken start that the name was taken — the
 * refusal must name the problem it is. The name is read from `message` and
 * `details` together, as `@/organization/snapshot` does, and a code whose
 * constraint this module does not know reads as a generic invalid value.
 */
export function hourBandWriteFailureOf(error: HourBandWriteError): HourBandWriteFailure {
  const named = `${error.message ?? ''} ${error.details ?? ''}`;

  if (error.code === UNIQUE_VIOLATION) {
    if (named.includes(START_UNIQUE)) return HOUR_BAND_START_TAKEN;
    if (named.includes(NAME_UNIQUE)) return HOUR_BAND_NAME_TAKEN;

    return HOUR_BAND_WRITE_INVALID;
  }

  if (error.code === CHECK_VIOLATION) {
    if (named.includes(NAME_CHECK)) return HOUR_BAND_NAME_EMPTY;
    if (START_CHECKS.some((check) => named.includes(check))) return HOUR_BAND_START_INVALID;

    return HOUR_BAND_WRITE_INVALID;
  }

  // A malformed `time` literal: the start is the only temporal column written.
  if (error.code === DATETIME_CLASS || error.code === DATETIME_OVERFLOW) {
    return HOUR_BAND_START_INVALID;
  }

  if (error.code === INSUFFICIENT_PRIVILEGE) return HOUR_BAND_WRITE_REFUSED;
  if (error.code !== undefined && VALUE_CLASSES.includes(error.code.slice(0, 2))) {
    return HOUR_BAND_WRITE_INVALID;
  }

  return HOUR_BAND_WRITE_UNAVAILABLE;
}

/** Settle one write: a thrown call, an error, zero rows, or one row. */
async function settled(write: () => PromiseLike<HourBandWriteAnswer>): Promise<HourBandWriteOutcome> {
  let answered: HourBandWriteAnswer;

  try {
    answered = await write();
  } catch (cause) {
    console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);

    return { ok: false, code: HOUR_BAND_WRITE_UNAVAILABLE };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(HOUR_BAND_WRITE_UNAVAILABLE, typeof answered);

    return { ok: false, code: HOUR_BAND_WRITE_UNAVAILABLE };
  }

  // Rows that are not rows: the service, never the person. Checked before the
  // error so a malformed answer cannot be read as a zero-row stale refusal.
  if (answered.data !== null && answered.data !== undefined && !Array.isArray(answered.data)) {
    console.error(HOUR_BAND_WRITE_UNAVAILABLE, 'data');

    return { ok: false, code: HOUR_BAND_WRITE_UNAVAILABLE };
  }

  if (answered.error !== null) {
    const code = hourBandWriteFailureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  // ZERO ROWS: the policy's USING matched nothing. See the module comment.
  if ((answered.data ?? []).length === 0) return { ok: false, code: HOUR_BAND_STALE };

  return { ok: true };
}

/** What was entered, checked before anything is sent: a name and a start. */
type Entered =
  | { readonly ok: true; readonly name: string; readonly startTime: string }
  | { readonly ok: false; readonly code: HourBandWriteFailure };

function enteredOf(name: string, start: string): Entered {
  const enteredName = enteredHourBandName(name);

  if (enteredName === null) return { ok: false, code: HOUR_BAND_NAME_EMPTY };

  const startTime = enteredHourBandStart(start);

  if (startTime === null) return { ok: false, code: HOUR_BAND_START_INVALID };

  return { ok: true, name: enteredName, startTime };
}

/**
 * Add a band. The name is trimmed and the start checked here; the database's
 * checks and uniques refuse the same from any other caller.
 */
export async function createHourBand(
  table: HourBandWriteTable,
  organizationId: string,
  name: string,
  start: string,
): Promise<HourBandWriteOutcome> {
  const entered = enteredOf(name, start);

  if (!entered.ok) return entered;

  return settled(() =>
    table
      .insert({ organization_id: organizationId, name: entered.name, start_time: entered.startTime })
      .select(RETURNED_COLUMNS),
  );
}

/** Edit a band's name or start in place; its id never changes. */
export async function updateHourBand(
  table: HourBandWriteTable,
  band: HourBandRow,
  name: string,
  start: string,
): Promise<HourBandWriteOutcome> {
  const entered = enteredOf(name, start);

  if (!entered.ok) return entered;

  return settled(() =>
    table
      .update({ name: entered.name, start_time: entered.startTime })
      .eq(ID_COLUMN, band.id)
      .select(RETURNED_COLUMNS),
  );
}

/** Remove a band. Zero rows back means it was already gone: stale. */
export async function removeHourBand(
  table: HourBandWriteTable,
  band: HourBandRow,
): Promise<HourBandWriteOutcome> {
  return settled(() => table.delete().eq(ID_COLUMN, band.id).select(RETURNED_COLUMNS));
}

// ---------------------------------------------------- where focus stays

/** The name field. */
export const HOUR_BAND_NAME_FIELD = 'name';
/** The start field. */
export const HOUR_BAND_START_FIELD = 'start';

export type HourBandField = typeof HOUR_BAND_NAME_FIELD | typeof HOUR_BAND_START_FIELD;

/**
 * The field a refusal is about, so focus stays on it and it alone is marked
 * invalid. A refusal about neither — the service, the permission, a stale
 * screen — keeps focus on the name, the form's first field.
 */
export function refusedFieldOf(failure: HourBandWriteFailure): HourBandField {
  if (failure === HOUR_BAND_START_TAKEN || failure === HOUR_BAND_START_INVALID) {
    return HOUR_BAND_START_FIELD;
  }

  return HOUR_BAND_NAME_FIELD;
}

/** Whether a refusal marks one field as the invalid one. */
export function marksField(failure: HourBandWriteFailure | null, field: HourBandField): boolean {
  if (failure === null) return false;
  if (failure === HOUR_BAND_NAME_EMPTY || failure === HOUR_BAND_NAME_TAKEN) {
    return field === HOUR_BAND_NAME_FIELD;
  }
  if (failure === HOUR_BAND_START_TAKEN || failure === HOUR_BAND_START_INVALID) {
    return field === HOUR_BAND_START_FIELD;
  }

  return false;
}

// ------------------------------------------------------------ the messages

/** The edge, and the only place one of these codes becomes Croatian. */
export function hourBandWriteMessageKey(
  failure: HourBandWriteFailure,
):
  | 'organization.hourBands.error.nameEmpty'
  | 'organization.hourBands.error.nameTaken'
  | 'organization.hourBands.error.startTaken'
  | 'organization.hourBands.error.startInvalid'
  | 'organization.hourBands.error.stale'
  | 'organization.hourBands.error.refused'
  | 'organization.hourBands.error.invalid'
  | 'organization.hourBands.error.saveUnavailable'
  | 'organization.hourBands.error.unknown' {
  if (failure === HOUR_BAND_NAME_EMPTY) return 'organization.hourBands.error.nameEmpty';
  if (failure === HOUR_BAND_NAME_TAKEN) return 'organization.hourBands.error.nameTaken';
  if (failure === HOUR_BAND_START_TAKEN) return 'organization.hourBands.error.startTaken';
  if (failure === HOUR_BAND_START_INVALID) return 'organization.hourBands.error.startInvalid';
  if (failure === HOUR_BAND_STALE) return 'organization.hourBands.error.stale';
  if (failure === HOUR_BAND_WRITE_REFUSED) return 'organization.hourBands.error.refused';
  if (failure === HOUR_BAND_WRITE_INVALID) return 'organization.hourBands.error.invalid';
  if (failure === HOUR_BAND_WRITE_UNAVAILABLE) return 'organization.hourBands.error.saveUnavailable';
  if (failure === HOUR_BAND_UNKNOWN) return 'organization.hourBands.error.unknown';

  const unhandled: never = failure;

  return unhandled;
}

// ------------------------------------------------------- the remove stages

/** The offer stands: one neutral action naming the band. */
export const REMOVE_IDLE = 'idle';
/** One press armed the confirmation, which names the band. */
export const REMOVE_ARMED = 'armed';
/** The confirmed write is outstanding; the confirmation stays, disabled. */
export const REMOVE_BUSY = 'busy';

export type RemoveStage = typeof REMOVE_IDLE | typeof REMOVE_ARMED | typeof REMOVE_BUSY;

/**
 * Which remove control renders. BUSY wins over everything: the confirmation
 * stays mounted while the write is outstanding, so no enabled control can
 * start a second one.
 */
export function removeStageOf(armed: boolean, pending: boolean): RemoveStage {
  if (pending) return REMOVE_BUSY;

  return armed ? REMOVE_ARMED : REMOVE_IDLE;
}

// ------------------------------------------------------- the form state

/**
 * Whether this screen holds the outcome of a removal it made — landed, or
 * refused.
 *
 * Either way the band may be gone from the re-read that follows: a landed
 * removal took it, and a removal refused as {@link HOUR_BAND_STALE} found it
 * already taken elsewhere. Both outcomes are the screen's to say, in words that
 * name what happened, and a generic {@link HOUR_BAND_UNKNOWN} standing over
 * them would replace the stale refusal with a vaguer one (spec: Stale row).
 */
export function holdsRemovalOutcome(
  saved: HourBandSaved | null,
  removeFailure: HourBandWriteFailure | null,
): boolean {
  return saved === HOUR_BAND_REMOVED || removeFailure !== null;
}

/**
 * What the edit screen renders for the band its route names.
 *
 * `null` band with no refusal while the list loads, and whenever THIS SCREEN
 * holds a removal outcome ({@link holdsRemovalOutcome}) — that outcome is
 * rendered instead, outside the band's own block, so it survives the band
 * disappearing. {@link HOUR_BAND_UNKNOWN} when the answer settled without the
 * band otherwise.
 */
export interface HourBandFormState {
  readonly band: HourBandRow | null;
  readonly refusal: typeof HOUR_BAND_UNKNOWN | null;
}

export function hourBandFormStateOf(
  bands: readonly HourBandRow[] | null,
  loading: boolean,
  id: string,
  removalHeld: boolean,
): HourBandFormState {
  if (bands === null) return { band: null, refusal: null };

  const band = hourBandById(bands, id);

  // The band is drawn while it is there, even beside a refused removal (a
  // 42501, say, leaves it in place); only its ABSENCE is not called unknown.
  if (band === null && removalHeld) return { band: null, refusal: null };

  if (band === null && !loading) return { band: null, refusal: HOUR_BAND_UNKNOWN };

  return { band, refusal: null };
}

/**
 * The key the edit form is mounted under: the band, and how many saves THIS
 * SCREEN has landed on it — never its values, for the reason `teamFormKey`
 * gives: a refused save followed by a re-read bringing a change made elsewhere
 * must keep what was typed.
 */
export function hourBandFormKey(band: HourBandRow, saves: number): string {
  return `${band.id}:${String(saves)}`;
}

/** How many landed saves the form key counts after one write settles. */
export function savesAfter(saves: number, outcome: HourBandWriteOutcome): number {
  return outcome.ok ? saves + 1 : saves;
}

// ---------------------------------------------------- what a save says

/** An edit landed. */
export const HOUR_BAND_SAVED = 'saved';
/** A removal landed. */
export const HOUR_BAND_REMOVED = 'removed';

export type HourBandSaved = typeof HOUR_BAND_SAVED | typeof HOUR_BAND_REMOVED;

/** The confirmation a landed write renders. Exhaustive. */
export function hourBandSavedMessageKey(
  saved: HourBandSaved,
): 'organization.hourBands.saved' | 'organization.hourBands.removed' {
  if (saved === HOUR_BAND_SAVED) return 'organization.hourBands.saved';
  if (saved === HOUR_BAND_REMOVED) return 'organization.hourBands.removed';

  const unhandled: never = saved;

  return unhandled;
}
