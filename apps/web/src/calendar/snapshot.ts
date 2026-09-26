import type { MembershipVersion, RotationAssignment, RotationStep } from '@shift/domain';
import type { Session } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';

import { isIsoDate } from '@/i18n/format';
import type { MemberRole } from '@/navigation/destinations';
import { memberRoleOf } from '@/navigation/role';

import { rotationAssignmentOf, rotationStepOf } from '@/rotation/list';
import {
  ORGANIZATION_ZONE_COLUMNS,
  SHIFT_TYPES_EMBED,
  compareCreation,
  shiftTypeRowOf,
  type ShiftTypeRow,
} from '@/shift-types/list';
import { currentSession } from '@/supabase/client';
import { TEAMS_COLUMNS, teamRowOf, type TeamRow } from '@/teams/list';

/**
 * The calendar snapshot: one organization's zone, teams, shift types with
 * their versions, rotation steps and rotation assignments, read once (story
 * 3.1). The first `OrganizationSnapshot` (AD-13): later stories extend it with
 * the exception layer, and a surface narrows it by selecting fields.
 *
 * EVERYTHING THE CALENDAR DECIDES IS IN `@/calendar/*.ts`, for the reason
 * `@/shift-types/list` gives: a `.tsx` is collected by no test (AD-15).
 *
 * NOTHING IS PROJECTED HERE (AD-7). A month is `scheduleOfMonth`'s answer from
 * `@shift/domain`, asked by `@/calendar/month`.
 *
 * UNWINDOWED. The configuration is small at pilot scale, so it is read whole
 * and every month is a pure computation over it: the query key carries no
 * month, and moving between months never reads again. When overrides arrive
 * (story 3.5), their window is the part that may need a month in the key.
 *
 * READABLE BY EVERY MEMBER. The one `members` row embedded is THE VIEWER'S
 * (story 3.2a): the embed is filtered to `members.auth_user_id = <session
 * uid>`, which PostgREST applies to the embed without filtering the
 * organization, so it is still one select. It carries the viewer's role —
 * which only picks the default mode, and authorizes nothing — and their team
 * membership history, which *Moj raspored* follows. No name, no position, no
 * rank. No attribution either (`created_by`, `created_at` of an assignment):
 * the calendar says what is worked, not who saved the rule. The shift types'
 * `created_at` stays, because the ramp slot is derived from the creation
 * order, and it is the column `shiftTypeRowOf` checks.
 *
 * `select` AND NOTHING ELSE.
 */

/** The relation the read starts from: the caller's own organization. */
export const CALENDAR_READ_TABLE = 'organizations';

/** The single query key the calendar reads under. No month: the snapshot is not windowed. */
export const CALENDAR_KEY = ['calendar'] as const;

/**
 * The columns this read selects. `organization_id` on every embedded row
 * renders nowhere and is the tripwire {@link readCalendar} uses to refuse a
 * row of another tenant.
 */
export const CALENDAR_COLUMNS =
  `${ORGANIZATION_ZONE_COLUMNS},` +
  `teams(${TEAMS_COLUMNS}),` +
  `${SHIFT_TYPES_EMBED},` +
  'rotation_steps(organization_id,id,pattern_id,position,shift_type_id),' +
  'rotation_assignments(organization_id,team_id,pattern_id,offset_step_id,anchor_date,effective_from),' +
  'members(organization_id,id,role,team_membership_versions(organization_id,team_id,effective_from))';

/** The embedded column the members embed is filtered by: the viewer's own row alone. */
export const CALENDAR_VIEWER_COLUMN = 'members.auth_user_id';

/** The operator of that filter. */
export const CALENDAR_VIEWER_OPERATOR = 'eq';

/** The exact count, so an answer reaching two organizations is caught. */
export const CALENDAR_COUNT: CalendarCountOptions = { count: 'exact' };

/**
 * Zero: the cached month is shown at once, and re-read whenever the calendar
 * is opened, so a rotation or shift type saved elsewhere shows up without an
 * invalidation reaching across surfaces.
 */
export const CALENDAR_READ_STALE_MS = 0;

/** TanStack Query's name for a fetch it has not started (offline). */
export const CALENDAR_FETCH_PAUSED = 'paused';

/**
 * The snapshot could not be read, or what came back cannot be trusted as one.
 * THE ONLY FAILURE: no teams and no rotation are honest answers. Offline is
 * this too.
 */
export const CALENDAR_UNAVAILABLE = 'CALENDAR_UNAVAILABLE';

export type CalendarReadFailure = typeof CALENDAR_UNAVAILABLE;

export type CalendarOutcome =
  | { readonly ok: true; readonly snapshot: CalendarSnapshot }
  | { readonly ok: false; readonly code: CalendarReadFailure };

/** As much of a PostgREST error as this module reads. */
export interface CalendarReadError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface CalendarCountOptions {
  readonly count: 'exact';
}

export interface CalendarAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: CalendarReadError | null;
  readonly count: number | null;
}

/** The select, narrowed to the viewer's own member row. */
export interface CalendarSelectFilter {
  filter(column: string, operator: string, value: string): PromiseLike<CalendarAnswer>;
}

/** The one call this module makes, named structurally so it can be stubbed. */
export interface CalendarTable {
  select(columns: string, options: CalendarCountOptions): CalendarSelectFilter;
}

/** The signed-in member reading the calendar. */
export interface CalendarViewer {
  readonly memberId: string;
  /** Picks the default mode only; authorizes nothing. */
  readonly role: MemberRole;
  /** Every version of the viewer's team membership, in `effectiveFrom` order. */
  readonly memberships: readonly MembershipVersion[];
}

/** The one answer the calendar draws from. */
export interface CalendarSnapshot {
  readonly organizationId: string;
  /** The organization's zone: "today" is the organization's, never the device's (L8). */
  readonly timeZone: string;
  /** Every team, archived ones included; the month shows the active ones. */
  readonly teams: readonly TeamRow[];
  /** Every shift type, archived ones included, in creation order. */
  readonly types: readonly ShiftTypeRow[];
  /** Every step of every pattern. */
  readonly steps: readonly RotationStep[];
  /** Every version of every team's rotation. */
  readonly assignments: readonly RotationAssignment[];
  /** The viewer's own member row. */
  readonly viewer: CalendarViewer;
}

// ------------------------------------------------------------- validation

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' && value !== '' ? value : null;
}

function unavailable(detail: unknown): CalendarOutcome {
  console.error(CALENDAR_UNAVAILABLE, detail);

  return { ok: false, code: CALENDAR_UNAVAILABLE };
}

function embedded(organization: Record<string, unknown>, relation: string): readonly unknown[] | null {
  const rows = organization[relation];

  return Array.isArray(rows) ? (rows as readonly unknown[]) : null;
}

/**
 * The caller's organization, its zone, and every row the calendar draws from,
 * or one stable code.
 *
 * Unavailable on a rejected or malformed answer, on a transport error, on
 * anything but EXACTLY ONE organization, on a row that does not validate or
 * names another tenant, on a step naming a type the answer lacks or two steps
 * of one pattern at one position, and on an assignment naming a team the
 * answer lacks, a step outside its own pattern, or a date its team already
 * has a version on. Unavailable, too, on no session and on anything but
 * EXACTLY ONE viewer member row, whose role is not one this build knows, or
 * whose membership versions name another tenant, a team the answer lacks, or
 * one date twice. What the database's keys guarantee is re-checked, so a
 * defect surfaces as the message, never as a projection that throws.
 */
export async function readCalendar(
  table: CalendarTable,
  session: () => Promise<Session | null>,
): Promise<CalendarOutcome> {
  let answered: CalendarAnswer;

  try {
    const current = await session();

    if (current === null) return unavailable('session');

    answered = await table
      .select(CALENDAR_COLUMNS, CALENDAR_COUNT)
      .filter(CALENDAR_VIEWER_COLUMN, CALENDAR_VIEWER_OPERATOR, current.user.id);
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

  if (organizationId === null || timeZone === null) return unavailable('organization');
  if (teamRows === null || typeRows === null || stepRows === null || assignmentRows === null) {
    return unavailable('organization');
  }
  if (memberRows === null || memberRows.length !== 1) return unavailable('viewer');

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

  const viewer = viewerOf(memberRows[0], organizationId, teamIds);

  if (viewer === null) return unavailable('viewer');

  types.sort(compareCreation);

  return { ok: true, snapshot: { organizationId, timeZone, teams, types, steps, assignments, viewer } };
}

/**
 * The viewer's member row, or `null` when it does not validate: another
 * tenant's, a role this build does not know, a membership version of another
 * tenant, with a malformed date, naming a team the answer lacks, or on a date
 * another version already has.
 */
function viewerOf(row: unknown, organizationId: string, teamIds: ReadonlySet<string>): CalendarViewer | null {
  if (!isRecord(row) || textAt(row, 'organization_id') !== organizationId) return null;

  const memberId = textAt(row, 'id');
  const role = memberRoleOf(row['role']);
  const versionRows = embedded(row, 'team_membership_versions');

  if (memberId === null || role === null || versionRows === null) return null;

  const memberships: MembershipVersion[] = [];
  const dates = new Set<string>();

  for (const version of versionRows) {
    if (!isRecord(version) || textAt(version, 'organization_id') !== organizationId) return null;

    const effectiveFrom = textAt(version, 'effective_from');
    const teamId = version['team_id'];

    if (effectiveFrom === null || !isIsoDate(effectiveFrom) || dates.has(effectiveFrom)) return null;
    if (teamId !== null && (typeof teamId !== 'string' || !teamIds.has(teamId))) return null;

    dates.add(effectiveFrom);
    memberships.push({ teamId, effectiveFrom });
  }

  memberships.sort((left, right) => (left.effectiveFrom < right.effectiveFrom ? -1 : 1));

  return { memberId, role, memberships };
}

/** The message a read failure renders as. Exhaustive. */
export function calendarMessageKey(failure: CalendarReadFailure): 'kalendar.error.unavailable' {
  if (failure === CALENDAR_UNAVAILABLE) return 'kalendar.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}

// --------------------------------------------------------- surface state

/**
 * The one query definition the calendar reads {@link CALENDAR_KEY} with.
 * UNAVAILABLE REJECTS — the query function throws its code — so a failed
 * refetch is retried once and reported.
 */
export function calendarQueryOptions(
  table: () => CalendarTable,
  session: () => Promise<Session | null> = currentSession,
) {
  return queryOptions({
    queryKey: CALENDAR_KEY,
    queryFn: async (): Promise<CalendarSnapshot> => {
      const outcome = await readCalendar(table(), session);

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.snapshot;
    },
    staleTime: CALENDAR_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

/** The query result the surface state is derived from. */
export interface CalendarQueryAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  /** The last good answer, kept by TanStack Query across a failed refetch. */
  readonly data: CalendarSnapshot | undefined;
}

export interface CalendarSurfaceState {
  /** The snapshot to draw, or `null` when there is nothing to draw — a failure included. */
  readonly snapshot: CalendarSnapshot | null;
  readonly refusal: CalendarReadFailure | null;
  /** Never true beside a message. */
  readonly loading: boolean;
}

/**
 * One query result as what the calendar shows: answered, loading, failed, or
 * paused offline. A FAILURE SHOWS NO GRID, a failed refetch over a cached
 * answer included: a month drawn from rows the database may no longer hold
 * would be read as the schedule. OFFLINE IS UNAVAILABLE whether or not an
 * answer is cached: a paused refetch over a cached snapshot is a refusal too.
 */
export function calendarSurfaceStateOf(answer: CalendarQueryAnswer): CalendarSurfaceState {
  const paused = answer.fetchStatus === CALENDAR_FETCH_PAUSED;

  if (answer.isError || paused) {
    return { snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false };
  }

  return { snapshot: answer.data ?? null, refusal: null, loading: answer.isPending };
}
