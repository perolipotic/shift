import {
  rotationAssignmentOn,
  type RotationAssignment,
  type RotationStep,
} from '@shift/domain';
import { queryOptions } from '@tanstack/react-query';

import { isIsoDate, organizationIsoDate } from '@/i18n/format';
import {
  ORGANIZATION_ZONE_COLUMNS,
  SHIFT_TYPES_EMBED,
  compareCreation,
  shiftTypeRowOf,
  type ShiftTypeRow,
} from '@/shift-types/list';
import { TEAMS_COLUMNS, splitTeams, teamRowOf, type TeamRow } from '@/teams/list';

/**
 * The rotation snapshot: one organization's teams, shift types with their
 * versions, rotation steps and rotation assignments, read once (story 2.3b).
 *
 * EVERYTHING THE BUILDER DECIDES IS IN `@/rotation/*.ts`, for the reason
 * `@/shift-types/list` gives: a `.tsx` is collected by no test (AD-15).
 *
 * NOTHING IS PROJECTED HERE (AD-7). Which assignment is in force on a date is
 * `rotationAssignmentOn`'s answer; the projection itself is `@/rotation/draft`'s
 * call into `@shift/domain`.
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). The read starts at the caller's
 * ORGANIZATION and embeds everything the builder draws from, so the zone
 * "today" is read in arrives with the rows. The team and shift type rows are
 * validated by the parsers their own lists use (`teamRowOf`, `shiftTypeRowOf`),
 * so a row one list refuses the other refuses too.
 *
 * `select` AND NOTHING ELSE. Writing is `@/rotation/write`.
 */

/** The relation the read starts from: the caller's own organization. */
export const ROTATION_READ_TABLE = 'organizations';

/** The relations the save names. */
export const ROTATION_PATTERNS_TABLE = 'rotation_patterns';
export const ROTATION_STEPS_TABLE = 'rotation_steps';
export const ROTATION_ASSIGNMENTS_TABLE = 'rotation_assignments';

/** The single query key the builder reads under; only the builder's save and a shift type write invalidate it. */
export const ROTATION_KEY = ['rotation'] as const;

/**
 * The columns this read selects. `organization_id` on every embedded row
 * renders nowhere and is the tripwire {@link readRotation} uses to refuse a
 * row of another tenant. No cycle length, offset integer or projected shift
 * exists to select: `0016` stores none.
 */
export const ROTATION_COLUMNS =
  `${ORGANIZATION_ZONE_COLUMNS},` +
  `teams(${TEAMS_COLUMNS}),` +
  `${SHIFT_TYPES_EMBED},` +
  'rotation_steps(organization_id,id,pattern_id,position,shift_type_id),' +
  'rotation_assignments(organization_id,team_id,pattern_id,offset_step_id,anchor_date,effective_from)';

/** The exact count, so an answer reaching two organizations is caught. */
export const ROTATION_COUNT: RotationCountOptions = { count: 'exact' };

/** Five minutes, the bound the shift type list sets, for the same reason. */
export const ROTATION_READ_STALE_MS = 300000;

/** TanStack Query's name for a fetch it has not started (offline). */
export const ROTATION_FETCH_PAUSED = 'paused';

/**
 * The snapshot could not be read, or what came back cannot be trusted as one.
 * THE ONLY FAILURE: no teams, no types and no rotation are honest answers.
 */
export const ROTATION_UNAVAILABLE = 'ROTATION_UNAVAILABLE';

export type RotationReadFailure = typeof ROTATION_UNAVAILABLE;

export type RotationOutcome =
  | { readonly ok: true; readonly snapshot: RotationSnapshot }
  | { readonly ok: false; readonly code: RotationReadFailure };

/** As much of a PostgREST error as this module reads. */
export interface RotationReadError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface RotationCountOptions {
  readonly count: 'exact';
}

export interface RotationAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: RotationReadError | null;
  readonly count: number | null;
}

/** The one call this module makes, named structurally so it can be stubbed. */
export interface RotationTable {
  select(columns: string, options: RotationCountOptions): PromiseLike<RotationAnswer>;
}

/** The one answer the builder draws from. */
export interface RotationSnapshot {
  readonly organizationId: string;
  /** The organization's zone: "today" is the organization's, never the device's (L8). */
  readonly timeZone: string;
  /** Every team, archived ones included. */
  readonly teams: readonly TeamRow[];
  /** Every shift type, archived ones included, in creation order. */
  readonly types: readonly ShiftTypeRow[];
  /** Every step of every pattern. */
  readonly steps: readonly RotationStep[];
  /** Every version of every team's rotation. */
  readonly assignments: readonly RotationAssignment[];
}

// ------------------------------------------------------------- validation

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' && value !== '' ? value : null;
}

/** One embedded step, validated field by field, or `null` (another tenant included). */
export function rotationStepOf(row: unknown, organizationId: string): RotationStep | null {
  if (!isRecord(row) || textAt(row, 'organization_id') !== organizationId) return null;

  const id = textAt(row, 'id');
  const patternId = textAt(row, 'pattern_id');
  const shiftTypeId = textAt(row, 'shift_type_id');
  const position = row['position'];

  if (id === null || patternId === null || shiftTypeId === null) return null;
  if (typeof position !== 'number' || !Number.isInteger(position) || position < 0) return null;

  return { id, patternId, position, shiftTypeId };
}

/** One embedded assignment, validated field by field, or `null` (another tenant included). */
export function rotationAssignmentOf(row: unknown, organizationId: string): RotationAssignment | null {
  if (!isRecord(row) || textAt(row, 'organization_id') !== organizationId) return null;

  const teamId = textAt(row, 'team_id');
  const patternId = textAt(row, 'pattern_id');
  const offsetStepId = textAt(row, 'offset_step_id');
  const anchorDate = textAt(row, 'anchor_date');
  const effectiveFrom = textAt(row, 'effective_from');

  if (teamId === null || patternId === null || offsetStepId === null) return null;
  if (anchorDate === null || effectiveFrom === null) return null;
  if (!isIsoDate(anchorDate) || !isIsoDate(effectiveFrom)) return null;

  return { teamId, patternId, offsetStepId, anchorDate, effectiveFrom };
}

function unavailable(detail: unknown): RotationOutcome {
  console.error(ROTATION_UNAVAILABLE, detail);

  return { ok: false, code: ROTATION_UNAVAILABLE };
}

function embedded(organization: Record<string, unknown>, relation: string): readonly unknown[] | null {
  const rows = organization[relation];

  return Array.isArray(rows) ? (rows as readonly unknown[]) : null;
}

/**
 * The caller's organization, its zone, and every row the builder draws from,
 * or one stable code.
 *
 * Unavailable on a rejected or malformed answer, on a transport error, on
 * anything but EXACTLY ONE organization, on a row that does not validate or
 * names another tenant, on a step naming a type the answer lacks or two steps
 * of one pattern at one position, and on an assignment naming a team the
 * answer lacks, a step outside its own pattern, or a date its team already
 * has a version on. What the database's keys guarantee is re-checked, so a
 * defect surfaces as the message, never as a projection that throws.
 */
export async function readRotation(table: RotationTable): Promise<RotationOutcome> {
  let answered: RotationAnswer;

  try {
    answered = await table.select(ROTATION_COLUMNS, ROTATION_COUNT);
  } catch (cause) {
    return unavailable(cause);
  }

  if (!isRecord(answered)) return unavailable(typeof answered);
  if (answered.error !== null) return unavailable(answered.error.code);
  if (!Array.isArray(answered.data)) return unavailable('data');

  const rows: readonly unknown[] = answered.data;

  if (answered.count !== 1 || rows.length !== 1) return unavailable(answered.count);

  const organization = rows[0];

  if (!isRecord(organization)) return unavailable('organization');

  const organizationId = textAt(organization, 'id');
  const timeZone = textAt(organization, 'timezone');
  const teamRows = embedded(organization, 'teams');
  const typeRows = embedded(organization, 'shift_types');
  const stepRows = embedded(organization, 'rotation_steps');
  const assignmentRows = embedded(organization, 'rotation_assignments');

  if (organizationId === null || timeZone === null) return unavailable('organization');
  if (teamRows === null || typeRows === null || stepRows === null || assignmentRows === null) {
    return unavailable('organization');
  }

  const teams: TeamRow[] = [];

  for (const row of teamRows) {
    const team = teamRowOf(row);

    if (team === null || team.organizationId !== organizationId) return unavailable('team');

    teams.push(team);
  }

  const types: ShiftTypeRow[] = [];

  for (const row of typeRows) {
    const type = shiftTypeRowOf(row);

    if (type === null || type.organizationId !== organizationId) return unavailable('type');

    types.push(type);
  }

  const steps: RotationStep[] = [];

  for (const row of stepRows) {
    const step = rotationStepOf(row, organizationId);

    if (step === null) return unavailable('step');

    steps.push(step);
  }

  const assignments: RotationAssignment[] = [];

  for (const row of assignmentRows) {
    const assignment = rotationAssignmentOf(row, organizationId);

    if (assignment === null) return unavailable('assignment');

    assignments.push(assignment);
  }

  const teamIds = new Set(teams.map((team) => team.id));
  const typeIds = new Set(types.map((type) => type.id));
  const stepById = new Map(steps.map((step) => [step.id, step]));

  if (teamIds.size !== teams.length || typeIds.size !== types.length) return unavailable('ids');
  if (stepById.size !== steps.length) return unavailable('ids');
  if (steps.some((step) => !typeIds.has(step.shiftTypeId))) return unavailable('step type');
  if (new Set(steps.map((step) => `${step.patternId}:${String(step.position)}`)).size !== steps.length) {
    return unavailable('positions');
  }

  for (const assignment of assignments) {
    const offset = stepById.get(assignment.offsetStepId);

    if (!teamIds.has(assignment.teamId)) return unavailable('assignment team');
    if (offset === undefined || offset.patternId !== assignment.patternId) {
      return unavailable('assignment step');
    }
  }

  const versions = new Set(assignments.map((assignment) => `${assignment.teamId}:${assignment.effectiveFrom}`));

  if (versions.size !== assignments.length) return unavailable('versions');

  types.sort(compareCreation);

  return { ok: true, snapshot: { organizationId, timeZone, teams, types, steps, assignments } };
}

// ---------------------------------------------------------------- reading

/** The organization's today, in its own zone (L8) — never the device's date. */
export function rotationTodayOf(snapshot: RotationSnapshot, now: Date): string {
  return organizationIsoDate(now, snapshot.timeZone);
}

/** The teams a rotation binds: the active ones, in the order the team list shows them. */
export function rotationTeamsOf(snapshot: RotationSnapshot): readonly TeamRow[] {
  return splitTeams(snapshot.teams).active;
}

/** Every version of one team's rotation. */
export function teamAssignmentsOf(snapshot: RotationSnapshot, teamId: string): readonly RotationAssignment[] {
  return snapshot.assignments.filter((assignment) => assignment.teamId === teamId);
}

/** The version of one team's rotation in force on `date`, from `rotationAssignmentOn`, or `null`. */
export function assignmentInForceOf(
  snapshot: RotationSnapshot,
  teamId: string,
  date: string,
): RotationAssignment | null {
  return rotationAssignmentOn(teamAssignmentsOf(snapshot, teamId), date);
}

/** The steps of one pattern, ordered by position — the order the projection reads them in. */
export function patternStepsOf(snapshot: RotationSnapshot, patternId: string): readonly RotationStep[] {
  return snapshot.steps
    .filter((step) => step.patternId === patternId)
    .sort((one, other) => one.position - other.position);
}

/**
 * Whether any ACTIVE team's rotation has a version scheduled after today. `0016`
 * admits one scheduled version per team and a new version only while the
 * latest is in effect, so while one exists the builder saves nothing (2.6
 * offers cancelling it).
 */
export function rotationScheduledOf(snapshot: RotationSnapshot, today: string): boolean {
  // ACTIVE teams only: the save writes no archived team's version, so an
  // archived team's scheduled one cannot refuse it.
  const active = new Set(rotationTeamsOf(snapshot).map((team) => team.id));

  return snapshot.assignments.some(
    (assignment) => active.has(assignment.teamId) && assignment.effectiveFrom > today,
  );
}

/**
 * Whether an active team's rotation already has a version dated today. A new
 * version must be dated after the latest one, and the save dates every
 * version today, so the database would refuse it.
 */
export function rotationChangedTodayOf(snapshot: RotationSnapshot, today: string): boolean {
  const active = new Set(rotationTeamsOf(snapshot).map((team) => team.id));

  return snapshot.assignments.some(
    (assignment) => active.has(assignment.teamId) && assignment.effectiveFrom === today,
  );
}

/** The message a read failure renders as. Exhaustive. */
export function rotationMessageKey(failure: RotationReadFailure): 'rotation.builder.error.unavailable' {
  if (failure === ROTATION_UNAVAILABLE) return 'rotation.builder.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}

// --------------------------------------------------------- surface state

/**
 * The one query definition the builder reads {@link ROTATION_KEY} with.
 * UNAVAILABLE REJECTS — the query function throws its code — for the reasons
 * `shiftTypesQueryOptions` gives: a failed refetch keeps the cached rows, and
 * is retried once.
 */
export function rotationQueryOptions(table: () => RotationTable) {
  return queryOptions({
    queryKey: ROTATION_KEY,
    queryFn: async (): Promise<RotationSnapshot> => {
      const outcome = await readRotation(table());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.snapshot;
    },
    staleTime: ROTATION_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

/** The query result the surface state is derived from. */
export interface RotationQueryAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  /** The last good answer, kept by TanStack Query across a failed refetch. */
  readonly data: RotationSnapshot | undefined;
}

export interface RotationSurfaceState {
  /** The snapshot to draw, or `null` when there is no answer to draw. */
  readonly snapshot: RotationSnapshot | null;
  readonly refusal: RotationReadFailure | null;
  /** Never true beside a message. */
  readonly loading: boolean;
}

/**
 * One query result as what the builder shows: answered, failed, paused
 * offline, and a failed refetch over a good answer (rows kept, message beside
 * them — the draft is the builder's own state and is kept too).
 */
export function rotationSurfaceStateOf(answer: RotationQueryAnswer): RotationSurfaceState {
  const snapshot = answer.data ?? null;
  const paused = answer.isPending && answer.fetchStatus === ROTATION_FETCH_PAUSED;

  if (answer.isError || paused) {
    return { snapshot, refusal: ROTATION_UNAVAILABLE, loading: false };
  }

  return { snapshot, refusal: null, loading: answer.isPending };
}

/** TanStack Query's name for a query whose last fetch succeeded. */
export const ROTATION_READ_SUCCEEDED = 'success';

/**
 * Whether the builder re-opens its draft from the snapshot after a landed
 * save: only when the re-read that followed it succeeded. Over a failed one
 * the cached rows predate the save, and the draft stays as it was saved.
 */
export function reopensAfterSaveOf(status: string | undefined): boolean {
  return status === ROTATION_READ_SUCCEEDED;
}

/**
 * The snapshot a SAVE may be built from: the surface's, but only while the
 * read is healthy — rows kept beside a failed refetch may no longer be what
 * the database holds, as `writableTeamsOf` argues.
 */
export function writableRotationOf(state: RotationSurfaceState): RotationSnapshot | null {
  return state.refusal === null ? state.snapshot : null;
}
