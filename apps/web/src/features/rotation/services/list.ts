import {
  overrideStandingOf,
  rotationAssignmentOn,
  type OverrideStanding,
  type RotationAssignment,
  type RotationStep,
  type RotationVersionStamp,
} from '@shift/domain';
import { queryOptions } from '@tanstack/react-query';

import { isIsoDate, organizationIsoDate } from '@/lib/i18n/format';
import {
  ORGANIZATION_ZONE_COLUMNS,
  SHIFT_TYPES_EMBED,
  compareCreation,
  shiftTypeRowOf,
  type ShiftTypeRow,
} from '@/features/shift-types/services/list';
import { TEAMS_COLUMNS, splitTeams, teamRowOf, type TeamRow } from '@/features/teams/services/list';

/**
 * The rotation snapshot: one organization's teams, shift types with their
 * versions, rotation steps and rotation assignments, read once (story 2.3b).
 *
 * EVERYTHING THE BUILDER DECIDES IS IN the `.ts` modules under `@/features/rotation`, for the reason
 * `@/features/shift-types/services/list` gives: a `.tsx` is collected by no test (AD-15).
 *
 * NOTHING IS PROJECTED HERE (AD-7). Which assignment is in force on a date is
 * `rotationAssignmentOn`'s answer; the projection itself is `@/features/rotation/utils/draft`'s
 * call into `@shift/domain`.
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). The read starts at the caller's
 * ORGANIZATION and embeds everything the builder draws from, so the zone
 * "today" is read in arrives with the rows. The team and shift type rows are
 * validated by the parsers their own lists use (`teamRowOf`, `shiftTypeRowOf`),
 * so a row one list refuses the other refuses too.
 *
 * THE LIVE SHIFT-TYPE OVERRIDES (story 3.5c) ride along, embedded and
 * filtered to the live ones, so the builder can list those a rotation change
 * left pending. The table is an active admin's alone (0019), as the builder is.
 *
 * `select` AND ITS ONE FILTER, AND NOTHING ELSE. Writing is
 * `@/features/rotation/services/write`, and the dispositions are
 * `@/features/rotation/services/override-disposition`.
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
  'rotation_assignments(organization_id,id,team_id,pattern_id,offset_step_id,anchor_date,effective_from,created_by,created_at),' +
  // STORY 2.6: who saved each change. `created_by` is an auth user id with no
  // key to `members`, so the names are joined here, on the client; an active
  // admin reads every member of the organization (0011).
  'members(organization_id,auth_user_id,name),' +
  // STORY 3.5c: the live overrides, for the review a rotation change leaves.
  'shift_type_overrides(organization_id,id,team_id,date,shift_type_id,reason,created_by,created_at,confirmed_at)';

/** The embedded column the overrides embed is filtered by: live ones only (`removed_at is null`). */
export const ROTATION_OVERRIDES_LIVE_COLUMN = 'shift_type_overrides.removed_at';

/** The operator and value of that filter. */
export const ROTATION_OVERRIDES_LIVE_OPERATOR = 'is';
export const ROTATION_OVERRIDES_LIVE_VALUE = 'null';

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

/** The select, narrowed to the live overrides. */
export interface RotationSelectFilter {
  filter(column: string, operator: string, value: string): PromiseLike<RotationAnswer>;
}

/** The one call this module makes, named structurally so it can be stubbed. */
export interface RotationTable {
  select(columns: string, options: RotationCountOptions): RotationSelectFilter;
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
  /**
   * The same versions' ATTRIBUTION (story 2.6, AD-11), one record per
   * assignment, kept beside the domain's type rather than on it: the domain
   * projects dates and never reads who saved a version or when.
   */
  readonly history: readonly RotationHistoryRecord[];
  /** The organization's members as the history names them: by auth user id. */
  readonly authors: readonly RotationAuthor[];
  /** Every LIVE shift-type override, by team then date (story 3.5c); at most one per team and date. */
  readonly overrides: readonly RotationOverride[];
}

/**
 * One live shift-type override as the builder reviews it (story 3.5c): the
 * fact, its author by auth user id (named through `authors`), and when it was
 * written and last confirmed, as sent.
 */
export interface RotationOverride {
  readonly id: string;
  readonly teamId: string;
  readonly date: string;
  readonly shiftTypeId: string;
  readonly reason: string;
  readonly createdBy: string;
  readonly createdAt: string;
  /** `null` until an admin confirms it. */
  readonly confirmedAt: string | null;
}

/** One stored assignment's attribution: which version, who saved it, when. */
export interface RotationHistoryRecord {
  readonly id: string;
  readonly teamId: string;
  readonly patternId: string;
  readonly effectiveFrom: string;
  /** The saving admin's auth user id — `0016`'s `created_by default auth.uid()`. */
  readonly createdBy: string;
  /** The instant it was saved — `0016`'s `created_at default now()`, as sent. */
  readonly createdAt: string;
}

/** One member, as the history names an author. */
export interface RotationAuthor {
  readonly authUserId: string;
  readonly name: string;
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

/**
 * A full ISO timestamp WITH an offset, as PostgREST renders a `timestamptz`:
 * the date and time, the fraction (Postgres drops trailing zeros, so `.88`),
 * and the offset.
 */
const TIMESTAMP_WITH_OFFSET = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})$/;

const MICROS_PER_MILLI = 1000;
const MICRO_DIGITS = 6;

/**
 * A `timestamptz` as PostgREST renders it, as epoch MICROSECONDS — the one
 * edge where an instant becomes the integer `@shift/domain` compares (story
 * 3.5c) — or `null` for anything that is not a full timestamp with an offset.
 *
 * NOT `Date.parse` alone: it keeps milliseconds, and the database stamps
 * microseconds, so a version saved in the same millisecond as an override,
 * but after it, would read as no later. The fraction is read as digits and
 * padded to six; the rest is `Date.parse`'s, at whole seconds.
 */
export function instantMicrosOf(text: unknown): number | null {
  if (typeof text !== 'string') return null;

  const matched = TIMESTAMP_WITH_OFFSET.exec(text);

  if (matched === null) return null;

  const [, base = '', fraction = '', zone = ''] = matched;
  const offset = zone === 'Z' || zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const millis = Date.parse(`${base}${offset}`);

  if (Number.isNaN(millis)) return null;

  const micros = millis * MICROS_PER_MILLI + Number(fraction.slice(0, MICRO_DIGITS).padEnd(MICRO_DIGITS, '0'));

  return Number.isSafeInteger(micros) ? micros : null;
}

/**
 * One embedded assignment as the domain's stamp of when it was saved (story
 * 3.5c), or `null` (another tenant included, and a `created_at` that is not
 * an instant).
 */
export function rotationVersionStampOf(row: unknown, organizationId: string): RotationVersionStamp | null {
  const assignment = rotationAssignmentOf(row, organizationId);
  const createdAt = isRecord(row) ? instantMicrosOf(row['created_at']) : null;

  if (assignment === null || createdAt === null) return null;

  return { teamId: assignment.teamId, effectiveFrom: assignment.effectiveFrom, createdAt };
}

/** One embedded live override, validated field by field, or `null` (another tenant included). */
export function rotationOverrideOf(row: unknown, organizationId: string): RotationOverride | null {
  if (!isRecord(row) || textAt(row, 'organization_id') !== organizationId) return null;

  const id = textAt(row, 'id');
  const teamId = textAt(row, 'team_id');
  const date = textAt(row, 'date');
  const shiftTypeId = textAt(row, 'shift_type_id');
  const reason = row['reason'];
  const createdBy = textAt(row, 'created_by');
  const createdAt = textAt(row, 'created_at');
  const confirmedAt = row['confirmed_at'];

  if (id === null || teamId === null || shiftTypeId === null || createdBy === null) return null;
  if (date === null || !isIsoDate(date)) return null;
  // Any text: what a reason may hold is 0019's check alone.
  if (typeof reason !== 'string') return null;
  if (createdAt === null || instantMicrosOf(createdAt) === null) return null;
  if (confirmedAt !== null && instantMicrosOf(confirmedAt) === null) return null;

  return { id, teamId, date, shiftTypeId, reason, createdBy, createdAt, confirmedAt: confirmedAt as string | null };
}

/**
 * One embedded assignment's attribution, validated field by field, or `null`
 * (another tenant included). `created_at` must be a full timestamp with an
 * offset that reads as an instant — `2026` or a bare date is not one.
 */
export function rotationHistoryRecordOf(row: unknown, organizationId: string): RotationHistoryRecord | null {
  const assignment = rotationAssignmentOf(row, organizationId);

  if (assignment === null || !isRecord(row)) return null;

  const id = textAt(row, 'id');
  const createdBy = textAt(row, 'created_by');
  const createdAt = textAt(row, 'created_at');

  if (id === null || createdBy === null || createdAt === null) return null;
  if (instantMicrosOf(createdAt) === null) return null;

  return {
    id,
    teamId: assignment.teamId,
    patternId: assignment.patternId,
    effectiveFrom: assignment.effectiveFrom,
    createdBy,
    createdAt,
  };
}

/** One embedded member as an author, or `null` (another tenant included). */
export function rotationAuthorOf(row: unknown, organizationId: string): RotationAuthor | null {
  if (!isRecord(row) || textAt(row, 'organization_id') !== organizationId) return null;

  const authUserId = textAt(row, 'auth_user_id');
  const name = textAt(row, 'name');

  return authUserId === null || name === null ? null : { authUserId, name };
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
    answered = await table
      .select(ROTATION_COLUMNS, ROTATION_COUNT)
      .filter(ROTATION_OVERRIDES_LIVE_COLUMN, ROTATION_OVERRIDES_LIVE_OPERATOR, ROTATION_OVERRIDES_LIVE_VALUE);
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
  const memberRows = embedded(organization, 'members');
  const overrideRows = embedded(organization, 'shift_type_overrides');

  if (organizationId === null || timeZone === null) return unavailable('organization');
  if (
    teamRows === null ||
    typeRows === null ||
    stepRows === null ||
    assignmentRows === null ||
    memberRows === null ||
    overrideRows === null
  ) {
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
  const history: RotationHistoryRecord[] = [];

  for (const row of assignmentRows) {
    const assignment = rotationAssignmentOf(row, organizationId);
    const record = rotationHistoryRecordOf(row, organizationId);

    if (assignment === null || record === null) return unavailable('assignment');

    assignments.push(assignment);
    history.push(record);
  }

  const authors: RotationAuthor[] = [];

  for (const row of memberRows) {
    const author = rotationAuthorOf(row, organizationId);

    if (author === null) return unavailable('member');

    authors.push(author);
  }

  const overrides: RotationOverride[] = [];

  for (const row of overrideRows) {
    const override = rotationOverrideOf(row, organizationId);

    if (override === null) return unavailable('override');

    overrides.push(override);
  }

  const teamIds = new Set(teams.map((team) => team.id));
  const typeIds = new Set(types.map((type) => type.id));
  const stepById = new Map(steps.map((step) => [step.id, step]));

  if (teamIds.size !== teams.length || typeIds.size !== types.length) return unavailable('ids');
  if (stepById.size !== steps.length) return unavailable('ids');
  if (overrides.some((override) => !teamIds.has(override.teamId) || !typeIds.has(override.shiftTypeId))) {
    return unavailable('override');
  }
  if (new Set(overrides.map((override) => override.id)).size !== overrides.length) return unavailable('ids');
  if (new Set(overrides.map((override) => `${override.teamId}:${override.date}`)).size !== overrides.length) {
    return unavailable('override');
  }
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
  if (new Set(history.map((record) => record.id)).size !== history.length) return unavailable('ids');
  if (new Set(authors.map((author) => author.authUserId)).size !== authors.length) return unavailable('ids');

  types.sort(compareCreation);
  overrides.sort((left, right) =>
    left.teamId === right.teamId ? (left.date < right.date ? -1 : 1) : left.teamId < right.teamId ? -1 : 1,
  );

  return {
    ok: true,
    snapshot: { organizationId, timeZone, teams, types, steps, assignments, history, authors, overrides },
  };
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
 * The date of the change scheduled after today — the earliest, should two
 * active teams ever differ — or `null` while nothing is scheduled. What the
 * cancel deletes (story 2.6, decision 2a).
 */
export function rotationScheduledDateOf(snapshot: RotationSnapshot, today: string): string | null {
  const active = new Set(rotationTeamsOf(snapshot).map((team) => team.id));
  const dates = snapshot.assignments
    .filter((assignment) => active.has(assignment.teamId) && assignment.effectiveFrom > today)
    .map((assignment) => assignment.effectiveFrom)
    .sort();

  return dates[0] ?? null;
}

/**
 * Whether an active team's LATEST version is dated `effectiveFrom`. A new
 * version must be dated after the latest one, and the save dates every
 * version on the effective date, so the database would refuse it (story 2.6:
 * the effective date, where 2.3b had today).
 */
export function rotationChangedTodayOf(snapshot: RotationSnapshot, effectiveFrom: string): boolean {
  return rotationTeamsOf(snapshot).some((team) => {
    const latest = teamAssignmentsOf(snapshot, team.id)
      .map((assignment) => assignment.effectiveFrom)
      .sort()
      .at(-1);

    return latest === effectiveFrom;
  });
}

/**
 * Every live override IN FORCE and every one PENDING the admin's disposition
 * (story 3.5c): `overrideStandingOf` from `@shift/domain`, over the versions'
 * save times and each override's `confirmedAt ?? createdAt`. The instants are
 * parsed here, at the edge; the rule is the domain's.
 */
export function overrideStandingOfSnapshot(
  snapshot: RotationSnapshot,
): OverrideStanding<RotationOverride & { readonly writtenAt: number }> {
  const stamps = snapshot.history.map((record) => ({
    teamId: record.teamId,
    effectiveFrom: record.effectiveFrom,
    createdAt: instantMicrosOf(record.createdAt) ?? Number.NaN,
  }));
  const overrides = snapshot.overrides.map((override) => ({
    ...override,
    writtenAt: instantMicrosOf(override.confirmedAt ?? override.createdAt) ?? Number.NaN,
  }));

  return overrideStandingOf(stamps, overrides);
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
