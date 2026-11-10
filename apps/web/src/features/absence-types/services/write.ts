import { isAnnualLeave, type AbsenceTypeRow } from '@/features/absence-types/services/list';
import { NAME_MAX_LENGTH, enteredName } from '@/utils/name';

/**
 * Adding and editing an absence type — every decision *Vrste odsutnosti*'s
 * dialog makes, in a `.ts` that renders nothing (AD-15, story 13.1b).
 *
 * TWO WRITES, BOTH PLAIN POSTGREST, both on `absence_types` alone. `0052`'s
 * policies admit an active admin to insert `(organization_id, name,
 * draws_allowance)` and to update `(name, draws_allowance)`. Nothing deletes a
 * type: no session holds the privilege, and this module has no call for it.
 * No leave record, figure or report is touched: nothing reads the type yet
 * (13.2).
 *
 * THE DRAWING CHOICE HAS NO DEFAULT. `0052` stores none ("an admin says it"),
 * so the form starts with neither choice and a save without one is refused
 * here, before anything is sent ({@link ABSENCE_TYPE_DRAWS_REQUIRED}).
 *
 * ANNUAL LEAVE ALWAYS DRAWS (`absence_types_annual_draws`). Its dialog holds
 * the choice disabled on *draws*; a save that says otherwise anyway is refused
 * here as {@link ABSENCE_TYPE_ANNUAL_DRAWS}, the same code the check maps to.
 *
 * ZERO ROWS ON AN UPDATE IS THE STALE REFUSAL. An update that reaches no row
 * means the type is out of this session's reach since the card was drawn. On
 * an insert, zero rows is the service ({@link ABSENCE_TYPE_WRITE_UNAVAILABLE}).
 *
 * AN UPDATE FILTERS BY THE TENANT AS WELL AS THE ID: annual leave's id is the
 * same in every organization, so the id alone names a row in each of them.
 * RLS already confines the update to the token's organization; the tenant
 * filter is defence in depth beside it.
 *
 * Codes, never messages: {@link absenceTypeWriteMessageKey} is the one edge.
 */

/** The name was empty once trimmed (client-side, or `absence_types_name_not_blank`). */
export const ABSENCE_TYPE_NAME_EMPTY = 'ABSENCE_TYPE_NAME_EMPTY';
/** The name is longer than `NAME_MAX_LENGTH` (client-side, or `absence_types_name_length`). */
export const ABSENCE_TYPE_NAME_TOO_LONG = 'ABSENCE_TYPE_NAME_TOO_LONG';
/** Another type in this organization carries the name, ignoring case and padding. */
export const ABSENCE_TYPE_NAME_TAKEN = 'ABSENCE_TYPE_NAME_TAKEN';
/** Neither drawing choice was made (client-side only: the column has no default). */
export const ABSENCE_TYPE_DRAWS_REQUIRED = 'ABSENCE_TYPE_DRAWS_REQUIRED';
/** Annual leave set not to draw (client-side, or `absence_types_annual_draws`). */
export const ABSENCE_TYPE_ANNUAL_DRAWS = 'ABSENCE_TYPE_ANNUAL_DRAWS';
/** The type changed since the card was drawn (out of reach): zero rows. */
export const ABSENCE_TYPE_STALE = 'ABSENCE_TYPE_STALE';
/** The database refused the write outright (42501). */
export const ABSENCE_TYPE_WRITE_REFUSED = 'ABSENCE_TYPE_WRITE_REFUSED';
/** The service, not the person: try again. */
export const ABSENCE_TYPE_WRITE_UNAVAILABLE = 'ABSENCE_TYPE_WRITE_UNAVAILABLE';

export type AbsenceTypeWriteFailure =
  | typeof ABSENCE_TYPE_NAME_EMPTY
  | typeof ABSENCE_TYPE_NAME_TOO_LONG
  | typeof ABSENCE_TYPE_NAME_TAKEN
  | typeof ABSENCE_TYPE_DRAWS_REQUIRED
  | typeof ABSENCE_TYPE_ANNUAL_DRAWS
  | typeof ABSENCE_TYPE_STALE
  | typeof ABSENCE_TYPE_WRITE_REFUSED
  | typeof ABSENCE_TYPE_WRITE_UNAVAILABLE;

export type AbsenceTypeWriteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: AbsenceTypeWriteFailure };

// ----------------------------------------------------------------- the seams

export interface AbsenceTypeWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

export interface AbsenceTypeWriteAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: AbsenceTypeWriteError | null;
}

interface Selecting {
  select(columns: string): PromiseLike<AbsenceTypeWriteAnswer>;
}

/** `.eq()` chains: an update filters by the tenant and by the id. */
interface Filtering extends Selecting {
  eq(column: string, value: string): Filtering;
}

/** The two calls this module makes, named structurally so they can be stubbed. No delete. */
export interface AbsenceTypeWriteTable {
  insert(values: Readonly<Record<string, unknown>>): Selecting;
  update(values: Readonly<Record<string, unknown>>): Filtering;
}

const RETURNED_COLUMNS = 'id';
const ID_COLUMN = 'id';
const ORGANIZATION_COLUMN = 'organization_id';

// ---------------------------------------------------------- the drawing choice

/** The radio value for a type that draws down the allowance. */
export const DRAWS_VALUE = 'draws';
/** The radio value for a type that does not. */
export const DOES_NOT_DRAW_VALUE = 'doesNotDraw';
/** Neither choice made yet: a new type's starting value. */
export const NO_DRAWS_CHOICE = '';

export type DrawsChoice = typeof DRAWS_VALUE | typeof DOES_NOT_DRAW_VALUE | typeof NO_DRAWS_CHOICE;

/** The two choices, in the order the dialog lists them. */
export const DRAWS_OPTIONS: readonly boolean[] = [true, false];

/** The radio value a stored flag is chosen by. */
export function drawsValue(drawsAllowance: boolean): typeof DRAWS_VALUE | typeof DOES_NOT_DRAW_VALUE {
  return drawsAllowance ? DRAWS_VALUE : DOES_NOT_DRAW_VALUE;
}

/** The flag a radio value says, or `null` when nothing (or nothing known) was chosen. */
export function drawsOf(value: string): boolean | null {
  if (value === DRAWS_VALUE) return true;
  if (value === DOES_NOT_DRAW_VALUE) return false;

  return null;
}

/** The value the dialog opens on: the stored flag on *Uredi*, neither on *Dodaj*. */
export function initialDrawsChoice(type: AbsenceTypeRow | null): DrawsChoice {
  return type === null ? NO_DRAWS_CHOICE : drawsValue(type.drawsAllowance);
}

/** Whether the dialog holds the drawing choice disabled: on annual leave only. */
export function drawsLocked(type: AbsenceTypeRow | null): boolean {
  return type !== null && isAnnualLeave(type.id);
}

/**
 * Whether the edit dialog says what changing the flag does (story 13.2b,
 * Q8): on every existing type but annual leave, whose flag is locked. A
 * static line, never a confirmation: every balance is re-derived from the
 * flag as it stands (AD-2 current-state).
 */
export function drawsHintShown(type: AbsenceTypeRow | null): boolean {
  return type !== null && !isAnnualLeave(type.id);
}

// ---------------------------------------------------------------- the rules

/** How long a name is as `char_length` counts it: in code points. */
function codePoints(value: string): number {
  return [...value].length;
}

/** What was entered, checked before anything is sent: a name and a drawing choice. */
type Entered =
  | { readonly ok: true; readonly name: string; readonly drawsAllowance: boolean }
  | { readonly ok: false; readonly code: AbsenceTypeWriteFailure };

/**
 * The name and the choice as they will be sent, or the first refusal: a blank
 * name, a name past {@link NAME_MAX_LENGTH}, no drawing choice, or annual
 * leave set not to draw.
 */
export function enteredAbsenceTypeOf(
  type: AbsenceTypeRow | null,
  name: string,
  draws: string,
): Entered {
  const stored = enteredName(name);

  if (stored === null) return { ok: false, code: ABSENCE_TYPE_NAME_EMPTY };
  if (codePoints(stored) > NAME_MAX_LENGTH) return { ok: false, code: ABSENCE_TYPE_NAME_TOO_LONG };

  const drawsAllowance = drawsOf(draws);

  if (drawsAllowance === null) return { ok: false, code: ABSENCE_TYPE_DRAWS_REQUIRED };
  if (type !== null && isAnnualLeave(type.id) && !drawsAllowance) {
    return { ok: false, code: ABSENCE_TYPE_ANNUAL_DRAWS };
  }

  return { ok: true, name: stored, drawsAllowance };
}

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

/** `0052`'s constraint names, as PostgreSQL quotes them in `message`. */
const NAME_UNIQUE = '"absence_types_organization_name_key"';
const NAME_CHECK = '"absence_types_name_not_blank"';
const NAME_LENGTH_CHECK = '"absence_types_name_length"';
const ANNUAL_CHECK = '"absence_types_annual_draws"';

/**
 * A PostgREST refusal on `absence_types`, as this application's own failure.
 *
 * BY CONSTRAINT NAME, as `hourBandWriteFailureOf` does, because `23514` is
 * raised by three checks. Read from `message` ONLY, where PostgreSQL quotes the
 * constraint, never from `details`, which holds the values typed — a name that
 * spells a constraint must not be read as one (`namesLengthCheck`'s rule).
 * `42501` is refused; anything else, a constraint this module does not know
 * included, is unavailable.
 */
export function absenceTypeWriteFailureOf(error: AbsenceTypeWriteError): AbsenceTypeWriteFailure {
  const message = error.message ?? '';

  if (error.code === UNIQUE_VIOLATION && message.includes(NAME_UNIQUE)) return ABSENCE_TYPE_NAME_TAKEN;
  if (error.code === CHECK_VIOLATION) {
    if (message.includes(NAME_CHECK)) return ABSENCE_TYPE_NAME_EMPTY;
    if (message.includes(NAME_LENGTH_CHECK)) return ABSENCE_TYPE_NAME_TOO_LONG;
    if (message.includes(ANNUAL_CHECK)) return ABSENCE_TYPE_ANNUAL_DRAWS;
  }
  if (error.code === INSUFFICIENT_PRIVILEGE) return ABSENCE_TYPE_WRITE_REFUSED;

  return ABSENCE_TYPE_WRITE_UNAVAILABLE;
}

/** Settle one write: a thrown call, an error, zero rows, or one row. */
async function settled(
  write: () => PromiseLike<AbsenceTypeWriteAnswer>,
  noRows: AbsenceTypeWriteFailure,
): Promise<AbsenceTypeWriteOutcome> {
  let answered: AbsenceTypeWriteAnswer;

  try {
    answered = await write();
  } catch (cause) {
    console.error(ABSENCE_TYPE_WRITE_UNAVAILABLE, cause);

    return { ok: false, code: ABSENCE_TYPE_WRITE_UNAVAILABLE };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(ABSENCE_TYPE_WRITE_UNAVAILABLE, typeof answered);

    return { ok: false, code: ABSENCE_TYPE_WRITE_UNAVAILABLE };
  }

  // Rows that are not rows: the service, never the person. Checked before the
  // error so a malformed answer cannot be read as a zero-row stale refusal.
  if (answered.data !== null && answered.data !== undefined && !Array.isArray(answered.data)) {
    console.error(ABSENCE_TYPE_WRITE_UNAVAILABLE, 'data');

    return { ok: false, code: ABSENCE_TYPE_WRITE_UNAVAILABLE };
  }

  if (answered.error !== null && answered.error !== undefined) {
    const code = absenceTypeWriteFailureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  // ZERO ROWS: on an update, the policy's USING matched nothing (stale; see
  // the module comment); on an insert, an answer that cannot be vouched for
  // (the service), since a new type cannot have changed in the meantime.
  if ((answered.data ?? []).length === 0) return { ok: false, code: noRows };

  return { ok: true };
}

/**
 * Add a type. `organizationId` is the session's own claim; the name is trimmed
 * and checked, and a drawing choice required, before anything is sent.
 */
export async function createAbsenceType(
  table: AbsenceTypeWriteTable,
  organizationId: string,
  name: string,
  draws: string,
): Promise<AbsenceTypeWriteOutcome> {
  const entered = enteredAbsenceTypeOf(null, name, draws);

  if (!entered.ok) return entered;

  return settled(() =>
    table
      .insert({ organization_id: organizationId, name: entered.name, draws_allowance: entered.drawsAllowance })
      .select(RETURNED_COLUMNS),
    ABSENCE_TYPE_WRITE_UNAVAILABLE,
  );
}

/** Rename a type or set its drawing flag in place; its id never changes. */
export async function updateAbsenceType(
  table: AbsenceTypeWriteTable,
  type: AbsenceTypeRow,
  name: string,
  draws: string,
): Promise<AbsenceTypeWriteOutcome> {
  const entered = enteredAbsenceTypeOf(type, name, draws);

  if (!entered.ok) return entered;

  return settled(() =>
    table
      .update({ name: entered.name, draws_allowance: entered.drawsAllowance })
      .eq(ORGANIZATION_COLUMN, type.organizationId)
      .eq(ID_COLUMN, type.id)
      .select(RETURNED_COLUMNS),
    ABSENCE_TYPE_STALE,
  );
}

// ---------------------------------------------------- where focus stays

/** The name field. */
export const ABSENCE_TYPE_NAME_FIELD = 'name';
/** The drawing choice. */
export const ABSENCE_TYPE_DRAWS_FIELD = 'draws';

export type AbsenceTypeField = typeof ABSENCE_TYPE_NAME_FIELD | typeof ABSENCE_TYPE_DRAWS_FIELD;

/**
 * The field a refusal is about, so focus stays on it. A refusal about neither
 * — the service, the permission, a stale card — keeps focus on the name, the
 * form's first field.
 */
export function refusedAbsenceTypeFieldOf(failure: AbsenceTypeWriteFailure): AbsenceTypeField {
  return failure === ABSENCE_TYPE_DRAWS_REQUIRED || failure === ABSENCE_TYPE_ANNUAL_DRAWS
    ? ABSENCE_TYPE_DRAWS_FIELD
    : ABSENCE_TYPE_NAME_FIELD;
}

/** Whether a refusal marks `field` as the invalid one. */
export function marksAbsenceTypeField(failure: AbsenceTypeWriteFailure | null, field: AbsenceTypeField): boolean {
  if (failure === null) return false;
  if (failure === ABSENCE_TYPE_NAME_EMPTY || failure === ABSENCE_TYPE_NAME_TOO_LONG || failure === ABSENCE_TYPE_NAME_TAKEN) {
    return field === ABSENCE_TYPE_NAME_FIELD;
  }
  if (failure === ABSENCE_TYPE_DRAWS_REQUIRED || failure === ABSENCE_TYPE_ANNUAL_DRAWS) {
    return field === ABSENCE_TYPE_DRAWS_FIELD;
  }

  return false;
}

// ------------------------------------------------------------ the messages

/** The edge, and the only place one of these codes becomes Croatian. */
export function absenceTypeWriteMessageKey(
  failure: AbsenceTypeWriteFailure,
):
  | 'organization.absenceTypes.error.nameEmpty'
  | 'organization.absenceTypes.error.nameTooLong'
  | 'organization.absenceTypes.error.nameTaken'
  | 'organization.absenceTypes.error.drawsRequired'
  | 'organization.absenceTypes.error.annualDraws'
  | 'organization.absenceTypes.error.stale'
  | 'organization.absenceTypes.error.refused'
  | 'organization.absenceTypes.error.saveUnavailable' {
  if (failure === ABSENCE_TYPE_NAME_EMPTY) return 'organization.absenceTypes.error.nameEmpty';
  if (failure === ABSENCE_TYPE_NAME_TOO_LONG) return 'organization.absenceTypes.error.nameTooLong';
  if (failure === ABSENCE_TYPE_NAME_TAKEN) return 'organization.absenceTypes.error.nameTaken';
  if (failure === ABSENCE_TYPE_DRAWS_REQUIRED) return 'organization.absenceTypes.error.drawsRequired';
  if (failure === ABSENCE_TYPE_ANNUAL_DRAWS) return 'organization.absenceTypes.error.annualDraws';
  if (failure === ABSENCE_TYPE_STALE) return 'organization.absenceTypes.error.stale';
  if (failure === ABSENCE_TYPE_WRITE_REFUSED) return 'organization.absenceTypes.error.refused';
  if (failure === ABSENCE_TYPE_WRITE_UNAVAILABLE) return 'organization.absenceTypes.error.saveUnavailable';

  const unhandled: never = failure;

  return unhandled;
}

// ---------------------------------------------------- what a save says

/** A new type landed. */
export const ABSENCE_TYPE_ADDED = 'added';
/** An edit landed. */
export const ABSENCE_TYPE_SAVED = 'saved';

export type AbsenceTypeSaved = typeof ABSENCE_TYPE_ADDED | typeof ABSENCE_TYPE_SAVED;

/** Which confirmation a landed write renders: an add, or an edit. */
export function absenceTypeSavedOf(type: AbsenceTypeRow | null): AbsenceTypeSaved {
  return type === null ? ABSENCE_TYPE_ADDED : ABSENCE_TYPE_SAVED;
}

/** The confirmation a landed write renders on the card. Exhaustive. */
export function absenceTypeSavedMessageKey(
  saved: AbsenceTypeSaved,
): 'organization.absenceTypes.added' | 'organization.absenceTypes.saved' {
  if (saved === ABSENCE_TYPE_ADDED) return 'organization.absenceTypes.added';
  if (saved === ABSENCE_TYPE_SAVED) return 'organization.absenceTypes.saved';

  const unhandled: never = saved;

  return unhandled;
}
