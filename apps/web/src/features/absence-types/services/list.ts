import { queryOptions } from '@tanstack/react-query';

import { compareText } from '@/lib/i18n/format';

/**
 * The absence type list: one organization's types, read once, and everything
 * *Organizacija*'s *Vrste odsutnosti* card derives from them (story 13.1b).
 *
 * `0052` holds a type as a NAME and whether a record of it DRAWS DOWN THE
 * ALLOWANCE, and nothing else (Q5: no reason, no free text). Since `0053`
 * (story 13.2) every active member reads the table — the calendar snapshot
 * embeds it for *Sati*'s leave columns — but no member surface reads this key.
 *
 * EVERYTHING THE CARD DECIDES IS HERE, for the reason
 * `@/features/hour-bands/services/list` gives: a `.tsx` is collected by no
 * test (AD-15), so the parsing, the order and the surface state are pure
 * functions the node suite executes.
 *
 * NOTHING NAMES A TYPE (DI-8) except annual leave's fixed id, which `0052`
 * gives the one type that is never deleted and always draws. A type's name is
 * data that is only shown.
 *
 * `select` AND NOTHING ELSE. Writing is `@/features/absence-types/services/write`.
 */

/** The relation both absence type modules name. */
export const ABSENCE_TYPES_TABLE = 'absence_types';

/** The single query key the absence types are read under. */
export const ABSENCE_TYPES_LIST_KEY = ['absenceTypes'] as const;

/**
 * The columns this read selects. `organization_id` renders nowhere and is the
 * tripwire {@link readAbsenceTypes} uses to refuse an answer spanning two
 * tenants.
 */
export const ABSENCE_TYPES_COLUMNS = 'organization_id,id,name,draws_allowance';

/** The exact count, so a truncated answer is caught rather than rendered. */
export const ABSENCE_TYPES_COUNT: AbsenceTypesCountOptions = { count: 'exact' };

/** Five minutes, the bound `HOUR_BANDS_READ_STALE_MS` sets, for the same reason. */
export const ABSENCE_TYPES_READ_STALE_MS = 300000;

/** TanStack Query's name for a fetch it has not started (offline). */
export const ABSENCE_TYPES_FETCH_PAUSED = 'paused';

/**
 * Annual leave's id, the same in every organization (`0052`): renamed at
 * will, never deleted, and always drawing.
 */
export const ANNUAL_LEAVE_ID = '00000000-0000-0000-0000-000000000001';

/**
 * The list could not be read, or what came back cannot be trusted as one.
 * The only failure: every organization holds annual leave, but an empty answer
 * is still an answer the card draws, not a refusal.
 */
export const ABSENCE_TYPES_UNAVAILABLE = 'ABSENCE_TYPES_UNAVAILABLE';

export type AbsenceTypesFailure = typeof ABSENCE_TYPES_UNAVAILABLE;

export type AbsenceTypesOutcome =
  | { readonly ok: true; readonly types: readonly AbsenceTypeRow[] }
  | { readonly ok: false; readonly code: AbsenceTypesFailure };

/** As much of a PostgREST error as this module reads. */
export interface AbsenceTypesReadFailure {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface AbsenceTypesCountOptions {
  readonly count: 'exact';
}

export interface AbsenceTypesAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: AbsenceTypesReadFailure | null;
  readonly count: number | null;
}

/** The one call this module makes, named structurally so it can be stubbed. */
export interface AbsenceTypesTable {
  select(columns: string, options: AbsenceTypesCountOptions): PromiseLike<AbsenceTypesAnswer>;
}

/** One stored type, as the card sees it. */
export interface AbsenceTypeRow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly drawsAllowance: boolean;
}

/** Whether `id` is annual leave's fixed id. */
export function isAnnualLeave(id: string): boolean {
  return id === ANNUAL_LEAVE_ID;
}

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' ? value : null;
}

/**
 * One PostgREST row as a type, or `null` — validated field by field rather
 * than cast, so a malformed row refuses the answer.
 */
export function absenceTypeRowOf(row: unknown): AbsenceTypeRow | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;

  const fields = row as Record<string, unknown>;
  const id = textAt(fields, 'id');
  const organizationId = textAt(fields, 'organization_id');
  const name = textAt(fields, 'name');
  const drawsAllowance = fields['draws_allowance'];

  if (id === null || organizationId === null || name === null || typeof drawsAllowance !== 'boolean') return null;

  return { id, organizationId, name, drawsAllowance };
}

/**
 * The order the card lists types in: annual leave first, then the rest by
 * name in Croatian collation (`compareText`), the id breaking a tie so the
 * order never depends on the answer's.
 */
export function compareAbsenceTypes(first: AbsenceTypeRow, second: AbsenceTypeRow): number {
  const annual = Number(isAnnualLeave(second.id)) - Number(isAnnualLeave(first.id));

  if (annual !== 0) return annual;

  return compareText(first.name, second.name) || compareText(first.id, second.id);
}

/** The types in the card's order, as a new array. */
export function orderedAbsenceTypes(types: readonly AbsenceTypeRow[]): AbsenceTypeRow[] {
  return [...types].sort(compareAbsenceTypes);
}

/**
 * Every type this session reaches, in the card's order, or one stable code.
 *
 * Unavailable on a rejected or malformed answer, on a transport error, on
 * `data` that is not an array, on a missing exact count or one that disagrees
 * with the rows, on a row that does not validate, on two rows sharing an id,
 * and on an answer spanning two organizations.
 */
export async function readAbsenceTypes(table: AbsenceTypesTable): Promise<AbsenceTypesOutcome> {
  let answered: AbsenceTypesAnswer;

  try {
    answered = await table.select(ABSENCE_TYPES_COLUMNS, ABSENCE_TYPES_COUNT);
  } catch (cause) {
    console.error(ABSENCE_TYPES_UNAVAILABLE, cause);

    return { ok: false, code: ABSENCE_TYPES_UNAVAILABLE };
  }

  if (typeof answered !== 'object' || answered === null || Array.isArray(answered)) {
    console.error(ABSENCE_TYPES_UNAVAILABLE, typeof answered);

    return { ok: false, code: ABSENCE_TYPES_UNAVAILABLE };
  }

  if (answered.error !== null) {
    console.error(ABSENCE_TYPES_UNAVAILABLE, answered.error.code);

    return { ok: false, code: ABSENCE_TYPES_UNAVAILABLE };
  }

  if (answered.data !== null && !Array.isArray(answered.data)) {
    console.error(ABSENCE_TYPES_UNAVAILABLE, 'data');

    return { ok: false, code: ABSENCE_TYPES_UNAVAILABLE };
  }

  const rows: readonly unknown[] = answered.data ?? [];

  if (answered.count === null || answered.count !== rows.length) {
    console.error(ABSENCE_TYPES_UNAVAILABLE, answered.count, rows.length);

    return { ok: false, code: ABSENCE_TYPES_UNAVAILABLE };
  }

  const types: AbsenceTypeRow[] = [];

  for (const row of rows) {
    const type = absenceTypeRowOf(row);

    if (type === null) {
      console.error(ABSENCE_TYPES_UNAVAILABLE, 'row');

      return { ok: false, code: ABSENCE_TYPES_UNAVAILABLE };
    }

    types.push(type);
  }

  if (new Set(types.map((type) => type.id)).size !== types.length) {
    console.error(ABSENCE_TYPES_UNAVAILABLE, 'ids');

    return { ok: false, code: ABSENCE_TYPES_UNAVAILABLE };
  }

  if (new Set(types.map((type) => type.organizationId)).size > 1) {
    console.error(ABSENCE_TYPES_UNAVAILABLE, 'organizations');

    return { ok: false, code: ABSENCE_TYPES_UNAVAILABLE };
  }

  return { ok: true, types: orderedAbsenceTypes(types) };
}

// ------------------------------------------------------------ the messages

/** What a row says about drawing down the allowance. Exhaustive over the flag. */
export function absenceTypeDrawsMessageKey(
  drawsAllowance: boolean,
): 'organization.absenceTypes.draws' | 'organization.absenceTypes.doesNotDraw' {
  return drawsAllowance ? 'organization.absenceTypes.draws' : 'organization.absenceTypes.doesNotDraw';
}

/** The message a read failure renders as. Exhaustive. */
export function absenceTypesMessageKey(
  failure: AbsenceTypesFailure,
): 'organization.absenceTypes.error.unavailable' {
  if (failure === ABSENCE_TYPES_UNAVAILABLE) return 'organization.absenceTypes.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}

// --------------------------------------------------------- surface state

/**
 * The one query definition the card reads {@link ABSENCE_TYPES_LIST_KEY}
 * with. UNAVAILABLE REJECTS, and the table is resolved inside the query
 * function, for the reasons `hourBandsQueryOptions` gives.
 */
export function absenceTypesQueryOptions(table: () => AbsenceTypesTable) {
  return queryOptions({
    queryKey: ABSENCE_TYPES_LIST_KEY,
    queryFn: async (): Promise<readonly AbsenceTypeRow[]> => {
      const outcome = await readAbsenceTypes(table());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.types;
    },
    staleTime: ABSENCE_TYPES_READ_STALE_MS,
    refetchOnWindowFocus: false,
    // One retry, one second apart, as `hourBandsQueryOptions` and for its reason.
    retry: 1,
    retryDelay: 1000,
  });
}

/** The query result the surface state is derived from. */
export interface AbsenceTypesQueryAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  /** The last good answer, kept by TanStack Query across a failed refetch. */
  readonly data: readonly AbsenceTypeRow[] | undefined;
}

export interface AbsenceTypesSurfaceState {
  /** The types to draw, or `null` when there is no answer to draw. */
  readonly types: readonly AbsenceTypeRow[] | null;
  readonly refusal: AbsenceTypesFailure | null;
  /** Never true beside a message. */
  readonly loading: boolean;
  /** A refetch paused offline over cached rows; never a refusal. */
  readonly paused: boolean;
}

/** One query result as what the card shows, by `hourBandsSurfaceStateOf`'s rule. */
export function absenceTypesSurfaceStateOf(answer: AbsenceTypesQueryAnswer): AbsenceTypesSurfaceState {
  const types = answer.data ?? null;
  const pausedFetch = answer.fetchStatus === ABSENCE_TYPES_FETCH_PAUSED;

  if (answer.isError || (answer.isPending && pausedFetch)) {
    return { types, refusal: ABSENCE_TYPES_UNAVAILABLE, loading: false, paused: false };
  }

  return { types, refusal: null, loading: answer.isPending, paused: pausedFetch };
}

/**
 * What the card announces, by `hourBandsNoticeOf`'s rule: the refusal, or the
 * unavailable message beside rows a raw refetch paused over (the card hands
 * this the answer as the page's freshness answers it, which is never paused).
 */
export function absenceTypesNoticeOf(state: AbsenceTypesSurfaceState): AbsenceTypesFailure | null {
  return state.refusal ?? (state.paused ? ABSENCE_TYPES_UNAVAILABLE : null);
}
