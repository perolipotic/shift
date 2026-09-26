import {
  ROTATION_CHANGED_TODAY,
  ROTATION_EFFECTIVE_PAST,
  ROTATION_EMPTY,
  ROTATION_NO_TEAMS,
  ROTATION_SCHEDULED,
  ROTATION_TYPE_ARCHIVED,
  ROTATION_UNCHANGED,
  draftRefusalOf,
  normalizedDraftOf,
  type DraftRefusal,
  type RotationDraft,
} from '@/rotation/draft';
import { rotationScheduledDateOf, rotationTeamsOf, type RotationSnapshot } from '@/rotation/list';
import { claimedOrganizationOf } from '@/teams/write';

/**
 * The organization the caller's token names, or `null` — the claim reader
 * `@/teams/write` holds and tests. Not trusted: `0016`'s insert policies pin
 * the tenant again.
 */
export { claimedOrganizationOf };

/**
 * Saving the rotation — every decision the builder's save makes, in a `.ts`
 * that renders nothing (AD-15, story 2.3b).
 *
 * THREE WRITES, NOT ATOMIC (human decision 2026-09-25, 2.3a): a fresh
 * `rotation_patterns` row, then all its steps in one bulk insert, then one
 * assignment per active team in one bulk insert, every version effective from
 * the DRAFT'S EFFECTIVE DATE — today or later (story 2.6) — at the draft's
 * shared anchor. A failure after the
 * pattern leaves an unreferenced pattern, which projects nothing, and changes
 * no team's rotation — so it says NOTHING CHANGED. A retry builds a fresh
 * pattern every time; a half-written one is never reused (its steps may be
 * incomplete, and once a team stands on it no step can be added).
 *
 * PATTERNS AND STEPS ARE NEVER UPDATED OR DELETED (`0016` grants neither), and
 * nothing here calls either verb. THE ONE DELETE is {@link cancelScheduledRotation}:
 * the organization's assignments at the one scheduled date, which `0016`'s
 * delete policy admits only while they are in the future and each team's
 * latest (story 2.6, decision 2a). Nothing is ever updated.
 *
 * Codes, never messages: {@link rotationWriteMessageKey} is the one edge.
 */

/** The database refused a write outright (42501). */
export const ROTATION_WRITE_REFUSED = 'ROTATION_WRITE_REFUSED';
/** The service, not the person: try again. */
export const ROTATION_WRITE_UNAVAILABLE = 'ROTATION_WRITE_UNAVAILABLE';

export type RotationWriteFailure =
  | DraftRefusal
  | typeof ROTATION_WRITE_REFUSED
  | typeof ROTATION_WRITE_UNAVAILABLE;

export type RotationSaveOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: RotationWriteFailure;
      /**
       * The pattern was written and a later write failed: an unreferenced
       * pattern is left behind and no team's rotation changed, which the
       * builder says in so many words.
       */
      readonly afterPattern: boolean;
    };

// ----------------------------------------------------------------- the seams

export interface RotationWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

export interface RotationWriteAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: RotationWriteError | null;
}

interface Selecting {
  select(columns: string): PromiseLike<RotationWriteAnswer>;
}

type Row = Readonly<Record<string, unknown>>;

/** The one call made on each rotation table by the save: an insert returning rows. No update, no delete. */
export interface RotationInsertTable {
  insert(values: Row | readonly Row[]): Selecting;
}

interface FilteringByTeams {
  in(column: string, values: readonly string[]): Selecting;
}

interface FilteringByDate {
  eq(column: string, value: string): FilteringByTeams;
}

interface FilteringByTenant {
  eq(column: string, value: string): FilteringByDate;
}

/**
 * The one call the CANCEL makes on `rotation_assignments`: a delete filtered
 * by the tenant, the scheduled date and the ACTIVE teams, returning the rows
 * removed. No insert and no update on this seam.
 */
export interface RotationAssignmentDeleteTable {
  delete(): FilteringByTenant;
}

export interface RotationWriteTables {
  readonly patterns: RotationInsertTable;
  readonly steps: RotationInsertTable;
  readonly assignments: RotationInsertTable;
}

const PATTERN_RETURNED = 'id';
const STEP_RETURNED = 'id,position';
const ASSIGNMENT_RETURNED = 'team_id';
const CANCEL_RETURNED = 'id';
const ORGANIZATION_COLUMN = 'organization_id';
const EFFECTIVE_COLUMN = 'effective_from';
const TEAM_COLUMN = 'team_id';

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';

/** `0016`'s one version per team per date, as PostgREST names it in `message`/`details`. */
const VERSION_UNIQUE = 'rotation_assignments_team_id_effective_from_key';

/**
 * A PostgREST refusal on any of the three tables, as this application's own
 * failure: a second version on one date for one team is
 * {@link ROTATION_CHANGED_TODAY}, BY CONSTRAINT NAME, since `23505` is raised
 * by other keys too; `42501` is the refusal; anything else is the service.
 */
export function rotationWriteFailureOf(error: RotationWriteError): RotationWriteFailure {
  const named = `${error.message ?? ''} ${error.details ?? ''}`;

  if (error.code === UNIQUE_VIOLATION && named.includes(VERSION_UNIQUE)) return ROTATION_CHANGED_TODAY;
  if (error.code === INSUFFICIENT_PRIVILEGE) return ROTATION_WRITE_REFUSED;

  return ROTATION_WRITE_UNAVAILABLE;
}

type Settled =
  | { readonly ok: true; readonly rows: readonly Record<string, unknown>[] }
  | { readonly ok: false; readonly code: RotationWriteFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One insert, settled: a thrown call, an error, rows that are not rows, or
 * fewer rows than were sent — the last is the service, never the person.
 */
async function settledRows(write: () => PromiseLike<RotationWriteAnswer>, expected: number): Promise<Settled> {
  let answered: RotationWriteAnswer;

  try {
    answered = await write();
  } catch (cause) {
    console.error(ROTATION_WRITE_UNAVAILABLE, cause);

    return { ok: false, code: ROTATION_WRITE_UNAVAILABLE };
  }

  if (!isRecord(answered)) {
    console.error(ROTATION_WRITE_UNAVAILABLE, typeof answered);

    return { ok: false, code: ROTATION_WRITE_UNAVAILABLE };
  }

  if (answered.error !== null && answered.error !== undefined) {
    const code = rotationWriteFailureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  const rows = answered.data;

  if (!Array.isArray(rows) || rows.length !== expected || !rows.every(isRecord)) {
    console.error(ROTATION_WRITE_UNAVAILABLE, 'rows');

    return { ok: false, code: ROTATION_WRITE_UNAVAILABLE };
  }

  return { ok: true, rows: rows as readonly Record<string, unknown>[] };
}

function textOf(row: Record<string, unknown> | undefined, column: string): string | null {
  const value = row?.[column];

  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Save `draft` as the rotation from its effective date: refused before
 * anything is sent for every reason {@link draftRefusalOf} names — `today`,
 * the organization's, is what the date may not precede — then the three
 * writes. `created_by` and `created_at` are never sent: `0016`'s defaults
 * fill them (AD-11).
 */
export async function saveRotation(
  tables: RotationWriteTables,
  organizationId: string,
  snapshot: RotationSnapshot,
  entered: RotationDraft,
  today: string,
): Promise<RotationSaveOutcome> {
  const teams = rotationTeamsOf(snapshot);
  const draft = normalizedDraftOf(entered, teams);
  const refusal = draftRefusalOf(snapshot, draft, today);

  if (refusal !== null) return { ok: false, code: refusal, afterPattern: false };

  const pattern = await settledRows(
    () => tables.patterns.insert({ organization_id: organizationId }).select(PATTERN_RETURNED),
    1,
  );

  if (!pattern.ok) return { ...pattern, afterPattern: false };

  const patternId = textOf(pattern.rows[0], 'id');

  if (patternId === null) {
    console.error(ROTATION_WRITE_UNAVAILABLE, 'pattern id');

    return { ok: false, code: ROTATION_WRITE_UNAVAILABLE, afterPattern: true };
  }

  const steps = await settledRows(
    () =>
      tables.steps
        .insert(
          draft.steps.map((shiftTypeId, position) => ({
            organization_id: organizationId,
            pattern_id: patternId,
            position,
            shift_type_id: shiftTypeId,
          })),
        )
        .select(STEP_RETURNED),
    draft.steps.length,
  );

  if (!steps.ok) return { ...steps, afterPattern: true };

  // THE STEPS CAME BACK AS SENT: every position 0…n−1 exactly once, each with
  // an id. Anything else is the service, and — like any failure after the
  // pattern — leaves an orphan pattern and changes nothing.
  const stepIdAt = new Map<number, string>();

  for (const row of steps.rows) {
    const id = textOf(row, 'id');
    const position = row['position'];

    if (
      id === null ||
      typeof position !== 'number' ||
      !Number.isInteger(position) ||
      position < 0 ||
      position >= draft.steps.length ||
      stepIdAt.has(position)
    ) {
      console.error(ROTATION_WRITE_UNAVAILABLE, 'step positions');

      return { ok: false, code: ROTATION_WRITE_UNAVAILABLE, afterPattern: true };
    }

    stepIdAt.set(position, id);
  }

  const assignments: Row[] = [];

  for (const team of teams) {
    const offsetStepId = stepIdAt.get(draft.offsets[team.id] ?? 0);

    if (offsetStepId === undefined) {
      console.error(ROTATION_WRITE_UNAVAILABLE, 'step ids');

      return { ok: false, code: ROTATION_WRITE_UNAVAILABLE, afterPattern: true };
    }

    assignments.push({
      organization_id: organizationId,
      team_id: team.id,
      pattern_id: patternId,
      offset_step_id: offsetStepId,
      anchor_date: draft.anchorDate,
      effective_from: draft.effectiveFrom,
    });
  }

  const bound = await settledRows(
    () => tables.assignments.insert(assignments).select(ASSIGNMENT_RETURNED),
    assignments.length,
  );

  if (!bound.ok) return { ...bound, afterPattern: true };

  return { ok: true };
}

// ---------------------------------------------------------------- the cancel

/** The scheduled change is gone since the screen was drawn — cancelled, or in effect. */
export const ROTATION_CANCEL_STALE = 'ROTATION_CANCEL_STALE';

export type RotationCancelFailure =
  | typeof ROTATION_CANCEL_STALE
  | typeof ROTATION_WRITE_REFUSED
  | typeof ROTATION_WRITE_UNAVAILABLE;

export type RotationCancelOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: RotationCancelFailure };

/** A refusal of the cancel, mapped as the save's are: `42501` refused, anything else the service. */
function cancelFailureOf(error: RotationWriteError): RotationCancelFailure {
  return error.code === INSUFFICIENT_PRIVILEGE ? ROTATION_WRITE_REFUSED : ROTATION_WRITE_UNAVAILABLE;
}

/**
 * Cancel the change scheduled after `today` (story 2.6, decision 2a): delete
 * the ACTIVE teams' assignments at that one date — the date the admin
 * confirmed, `confirmed` — through `0016`'s delete policy, which admits only a
 * version still in the future and its team's latest. An archived team's
 * version is never touched (the save wrote none for it). Nothing else is
 * deleted, and nothing is updated.
 *
 * {@link ROTATION_CANCEL_STALE}, and the caller re-reads, when:
 *
 *   * nothing is scheduled in the snapshot, or a DIFFERENT date is than the
 *     one confirmed — nothing is sent;
 *   * the rows back are not EXACTLY the active teams' versions the snapshot
 *     holds at that date (zero, or fewer): the change was cancelled elsewhere,
 *     came into effect, or was only partly removed. A partial cancel is never
 *     reported as success.
 */
export async function cancelScheduledRotation(
  table: RotationAssignmentDeleteTable,
  organizationId: string,
  snapshot: RotationSnapshot,
  today: string,
  confirmed: string,
): Promise<RotationCancelOutcome> {
  const scheduled = rotationScheduledDateOf(snapshot, today);

  if (scheduled === null || scheduled !== confirmed) return { ok: false, code: ROTATION_CANCEL_STALE };

  const teamIds = rotationTeamsOf(snapshot).map((team) => team.id);
  const active = new Set(teamIds);
  const expected = snapshot.assignments.filter(
    (assignment) => active.has(assignment.teamId) && assignment.effectiveFrom === scheduled,
  ).length;

  let answered: RotationWriteAnswer;

  try {
    answered = await table
      .delete()
      .eq(ORGANIZATION_COLUMN, organizationId)
      .eq(EFFECTIVE_COLUMN, scheduled)
      .in(TEAM_COLUMN, teamIds)
      .select(CANCEL_RETURNED);
  } catch (cause) {
    console.error(ROTATION_WRITE_UNAVAILABLE, cause);

    return { ok: false, code: ROTATION_WRITE_UNAVAILABLE };
  }

  if (!isRecord(answered)) {
    console.error(ROTATION_WRITE_UNAVAILABLE, typeof answered);

    return { ok: false, code: ROTATION_WRITE_UNAVAILABLE };
  }

  if (answered.error !== null && answered.error !== undefined) {
    const code = cancelFailureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  const rows = answered.data;

  if (!Array.isArray(rows) || !rows.every(isRecord)) {
    console.error(ROTATION_WRITE_UNAVAILABLE, 'rows');

    return { ok: false, code: ROTATION_WRITE_UNAVAILABLE };
  }

  if (rows.length !== expected) {
    console.error(ROTATION_CANCEL_STALE, rows.length, expected);

    return { ok: false, code: ROTATION_CANCEL_STALE };
  }

  return { ok: true };
}

/** The message a refused cancel renders. Exhaustive. */
export function rotationCancelMessageKey(
  failure: RotationCancelFailure,
):
  | 'rotation.builder.cancelScheduled.stale'
  | 'rotation.builder.error.refused'
  | 'rotation.builder.error.saveUnavailable' {
  switch (failure) {
    case ROTATION_CANCEL_STALE:
      return 'rotation.builder.cancelScheduled.stale';
    case ROTATION_WRITE_REFUSED:
      return 'rotation.builder.error.refused';
    case ROTATION_WRITE_UNAVAILABLE:
      return 'rotation.builder.error.saveUnavailable';
    default: {
      const unhandled: never = failure;

      return unhandled;
    }
  }
}

/** The confirmation a landed cancel renders. */
export const ROTATION_CANCELLED_MESSAGE_KEY = 'rotation.builder.cancelScheduled.done';

// ------------------------------------------------------------ the messages

/** The edge, and the only place one of these codes becomes Croatian. Exhaustive. */
export function rotationWriteMessageKey(
  failure: RotationWriteFailure,
):
  | 'rotation.builder.error.empty'
  | 'rotation.builder.error.noTeams'
  | 'rotation.builder.error.scheduled'
  | 'rotation.builder.error.effectivePast'
  | 'rotation.builder.error.typeArchived'
  | 'rotation.builder.error.unchanged'
  | 'rotation.builder.error.changedToday'
  | 'rotation.builder.error.refused'
  | 'rotation.builder.error.saveUnavailable' {
  switch (failure) {
    case ROTATION_EMPTY:
      return 'rotation.builder.error.empty';
    case ROTATION_NO_TEAMS:
      return 'rotation.builder.error.noTeams';
    case ROTATION_SCHEDULED:
      return 'rotation.builder.error.scheduled';
    case ROTATION_EFFECTIVE_PAST:
      return 'rotation.builder.error.effectivePast';
    case ROTATION_TYPE_ARCHIVED:
      return 'rotation.builder.error.typeArchived';
    case ROTATION_UNCHANGED:
      return 'rotation.builder.error.unchanged';
    case ROTATION_CHANGED_TODAY:
      return 'rotation.builder.error.changedToday';
    case ROTATION_WRITE_REFUSED:
      return 'rotation.builder.error.refused';
    case ROTATION_WRITE_UNAVAILABLE:
      return 'rotation.builder.error.saveUnavailable';
    default: {
      const unhandled: never = failure;

      return unhandled;
    }
  }
}

/** The note a failure after the pattern renders beside its reason: no team's rotation changed. */
export function rotationPartialMessageKey(
  outcome: RotationSaveOutcome,
): 'rotation.builder.error.nothingChanged' | null {
  return !outcome.ok && outcome.afterPattern ? 'rotation.builder.error.nothingChanged' : null;
}

/** The confirmation a landed save renders. */
export const ROTATION_SAVED_MESSAGE_KEY = 'rotation.builder.saved';
