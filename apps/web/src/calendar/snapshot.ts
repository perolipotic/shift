import type { MembershipVersion, RotationAssignment, RotationStep } from '@shift/domain';
import type { Session } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';

import { compareText, isIsoDate } from '@/i18n/format';
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
 * THE PEOPLE (story 3.3b). A member-role session reads only its own
 * `members` row (0011), so the colleagues the person filter offers come from
 * `calendar_people()` (0017): the id and name of every member active today,
 * and nothing more. Their team membership history is the organization-level
 * `team_membership_versions` embed, which any active member may read. The rpc
 * is made beside the select under the same key, so it is still ONE query.
 *
 * `select` AND ONE `rpc`, AND NOTHING ELSE.
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
  'members(organization_id,id,role,team_membership_versions(organization_id,team_id,effective_from)),' +
  'team_membership_versions(organization_id,member_id,team_id,effective_from)';

/** The function the person filter's people are read through (0017): id and name only. */
export const CALENDAR_PEOPLE_FUNCTION = 'calendar_people';

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

/** As much of the rpc's answer as this module reads. */
export interface CalendarPeopleAnswer {
  readonly data: unknown;
  readonly error: CalendarReadError | null;
}

/** The people read, named structurally so it can be stubbed. */
export interface CalendarPeopleRpc {
  rpc(fn: string): PromiseLike<CalendarPeopleAnswer>;
}

/** A colleague the person filter offers: active today, id and name only (0017). */
export interface CalendarPerson {
  readonly id: string;
  readonly name: string;
  /** Every version of their team membership, in `effectiveFrom` order. */
  readonly memberships: readonly MembershipVersion[];
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
  /**
   * Every member of the organization active today, the viewer included,
   * sorted by name under the Croatian collation, then by id (story 3.3b).
   */
  readonly people: readonly CalendarPerson[];
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
 * one date twice. Unavailable, finally, on a people read that is rejected,
 * errors, answers anything but an array, or holds a malformed row or one id
 * twice, and on an organization-level membership version of another tenant,
 * naming a team the answer lacks, or on a date its member already has a
 * version on. What the database's keys guarantee is re-checked, so a defect
 * surfaces as the message, never as a projection that throws.
 */
export async function readCalendar(
  table: CalendarTable,
  people: CalendarPeopleRpc,
  session: () => Promise<Session | null>,
): Promise<CalendarOutcome> {
  let answered: CalendarAnswer;
  let peopleAnswered: CalendarPeopleAnswer;

  try {
    const current = await session();

    if (current === null) return unavailable('session');

    [answered, peopleAnswered] = await Promise.all([
      table
        .select(CALENDAR_COLUMNS, CALENDAR_COUNT)
        .filter(CALENDAR_VIEWER_COLUMN, CALENDAR_VIEWER_OPERATOR, current.user.id),
      people.rpc(CALENDAR_PEOPLE_FUNCTION),
    ]);
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
  const membershipRows = embedded(organization, 'team_membership_versions');

  if (organizationId === null || timeZone === null) return unavailable('organization');
  if (teamRows === null || typeRows === null || stepRows === null || assignmentRows === null) {
    return unavailable('organization');
  }
  if (memberRows === null || memberRows.length !== 1) return unavailable('viewer');
  if (membershipRows === null) return unavailable('memberships');

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

  const memberships = membershipsByMemberOf(membershipRows, organizationId, teamIds);

  if (memberships === null) return unavailable('memberships');

  const persons = peopleOf(peopleAnswered, memberships);

  if (persons === null) return unavailable('people');

  types.sort(compareCreation);

  return {
    ok: true,
    snapshot: { organizationId, timeZone, teams, types, steps, assignments, viewer, people: persons },
  };
}

function byEffectiveFrom(left: MembershipVersion, right: MembershipVersion): number {
  return left.effectiveFrom < right.effectiveFrom ? -1 : 1;
}

/**
 * One membership version as the calendar embeds it, or `null`: another
 * tenant's, a malformed date, or a team that is neither `null` nor one the
 * answer holds.
 */
function membershipOf(
  version: unknown,
  organizationId: string,
  teamIds: ReadonlySet<string>,
): MembershipVersion | null {
  if (!isRecord(version) || textAt(version, 'organization_id') !== organizationId) return null;

  const effectiveFrom = textAt(version, 'effective_from');
  const teamId = version['team_id'];

  if (effectiveFrom === null || !isIsoDate(effectiveFrom)) return null;
  if (teamId !== null && (typeof teamId !== 'string' || !teamIds.has(teamId))) return null;

  return { teamId, effectiveFrom };
}

/**
 * Every member's team membership history from the organization-level embed,
 * by member id, each in date order; `null` when one version does not validate
 * ({@link membershipOf}), names no member, or repeats a date its member
 * already has.
 */
function membershipsByMemberOf(
  rows: readonly unknown[],
  organizationId: string,
  teamIds: ReadonlySet<string>,
): ReadonlyMap<string, readonly MembershipVersion[]> | null {
  const byMember = new Map<string, MembershipVersion[]>();

  for (const row of rows) {
    const version = membershipOf(row, organizationId, teamIds);
    const memberId = isRecord(row) ? textAt(row, 'member_id') : null;

    if (version === null || memberId === null) return null;

    const versions = byMember.get(memberId) ?? [];

    if (versions.some((known) => known.effectiveFrom === version.effectiveFrom)) return null;

    versions.push(version);
    byMember.set(memberId, versions);
  }

  for (const versions of byMember.values()) versions.sort(byEffectiveFrom);

  return byMember;
}

function comparePeople(first: CalendarPerson, second: CalendarPerson): number {
  // By name under the Croatian collation, then by id, as `compareMembers`, so
  // two people who share a name sort the same way every time.
  return compareText(first.name, second.name) || compareText(first.id, second.id);
}

/**
 * The people `calendar_people()` answered, each with their memberships, or
 * `null`: a malformed answer, an error, data that is not an array, a row
 * without a text id and a non-blank name, or one id twice. Only `id` and `name` are
 * carried off a row, whatever else might arrive.
 */
function peopleOf(
  answered: unknown,
  memberships: ReadonlyMap<string, readonly MembershipVersion[]>,
): CalendarPerson[] | null {
  if (!isRecord(answered) || answered['error'] !== null) return null;

  const rows = answered['data'];

  if (!Array.isArray(rows)) return null;

  const people: CalendarPerson[] = [];

  for (const row of rows as readonly unknown[]) {
    if (!isRecord(row)) return null;

    const id = textAt(row, 'id');
    const name = row['name'];

    // Blank is not a name `members` can hold (`btrim(name) <> ''`).
    if (id === null || typeof name !== 'string' || name.trim() === '') return null;

    people.push({ id, name, memberships: memberships.get(id) ?? [] });
  }

  if (new Set(people.map((person) => person.id)).size !== people.length) return null;

  return people.sort(comparePeople);
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

  for (const row of versionRows) {
    const version = membershipOf(row, organizationId, teamIds);

    if (version === null || dates.has(version.effectiveFrom)) return null;

    dates.add(version.effectiveFrom);
    memberships.push(version);
  }

  memberships.sort(byEffectiveFrom);

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
  people: () => CalendarPeopleRpc,
  session: () => Promise<Session | null> = currentSession,
) {
  return queryOptions({
    queryKey: CALENDAR_KEY,
    queryFn: async (): Promise<CalendarSnapshot> => {
      const outcome = await readCalendar(table(), people(), session);

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
