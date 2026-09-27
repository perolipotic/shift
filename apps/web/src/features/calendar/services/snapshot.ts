import type {
  MembershipVersion,
  RotationAssignment,
  RotationStep,
  ShiftTypeOverride,
  StatusVersion,
} from '@shift/domain';
import type { Session } from '@supabase/supabase-js';
import { queryOptions } from '@tanstack/react-query';

import { compareText, isIsoDate } from '@/lib/i18n/format';
import type { MemberRole } from '@/features/navigation/utils/destinations';
import { memberRoleOf } from '@/features/navigation/services/role';

import { rotationAssignmentOf, rotationStepOf } from '@/features/rotation/services/list';
import {
  ORGANIZATION_ZONE_COLUMNS,
  SHIFT_TYPES_EMBED,
  compareCreation,
  shiftTypeRowOf,
  type ShiftTypeRow,
} from '@/features/shift-types/services/list';
import { currentSession } from '@/lib/supabase/client';
import { TEAMS_COLUMNS, teamRowOf, type TeamRow } from '@/features/teams/services/list';

/**
 * The calendar snapshot: one organization's zone, teams, shift types with
 * their versions, rotation steps and rotation assignments, read once (story
 * 3.1). The first `OrganizationSnapshot` (AD-13): later stories extend it with
 * the exception layer, and a surface narrows it by selecting fields.
 *
 * EVERYTHING THE CALENDAR DECIDES IS IN the `.ts` modules under `@/features/calendar`, for the reason
 * `@/features/shift-types/services/list` gives: a `.tsx` is collected by no test (AD-15).
 *
 * NOTHING IS PROJECTED HERE (AD-7). A month is `scheduleOfMonth`'s answer from
 * `@shift/domain`, asked by `@/features/calendar/utils/month`.
 *
 * UNWINDOWED. The configuration is small at pilot scale, so it is read whole
 * and every month is a pure computation over it: the query key carries no
 * month, and moving between months never reads again. The live shift-type
 * overrides (story 3.5a) are read whole too; a window by month is a later
 * decision, and the part that may then need a month in the key.
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
 * THE MEMBERS (stories 3.3b, 3.4a). A member-role session reads only its own
 * `members` row (0011), so the colleagues come from `calendar_members()`
 * (0018): the id, name and fire rank of every member, active or not, and
 * nothing more. Their team membership history (with position) and their
 * active-status history are the organization-level `team_membership_versions`
 * and `member_status_versions` embeds, which any active member may read, so
 * "active on a date" is `activeOn` from `@shift/domain` — the person filter's
 * "active today" and the roster's "active on the day" alike. The rpc is made
 * beside the select under the same key, so it is still ONE query.
 *
 * THE OVERRIDES (story 3.5a). The table is an admin's alone (0019), so every
 * member reads the LIVE shift-type overrides through
 * `calendar_shift_type_overrides()`: each one's team, date, type, reason,
 * time, and its author as a member id — never an auth user id — which the
 * members read names. That rpc too is made beside the select, under the same
 * key.
 *
 * `select` AND TWO `rpc`s, AND NOTHING ELSE.
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
  `${ORGANIZATION_ZONE_COLUMNS},uses_fire_ranks,` +
  `teams(${TEAMS_COLUMNS}),` +
  `${SHIFT_TYPES_EMBED},` +
  'rotation_steps(organization_id,id,pattern_id,position,shift_type_id),' +
  'rotation_assignments(organization_id,team_id,pattern_id,offset_step_id,anchor_date,effective_from),' +
  'members(organization_id,id,role,team_membership_versions(organization_id,team_id,effective_from)),' +
  'team_membership_versions(organization_id,member_id,team_id,position,effective_from),' +
  'member_status_versions(organization_id,member_id,active,effective_from)';

/** The function every member is read through (0018): id, name and fire rank only. */
export const CALENDAR_MEMBERS_FUNCTION = 'calendar_members';

/** The function the live shift-type overrides are read through (0019). */
export const CALENDAR_OVERRIDES_FUNCTION = 'calendar_shift_type_overrides';

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
export interface CalendarMembersAnswer {
  readonly data: unknown;
  readonly error: CalendarReadError | null;
}

/** The members and overrides reads, named structurally so they can be stubbed. */
export interface CalendarMembersRpc {
  rpc(fn: string): PromiseLike<CalendarMembersAnswer>;
}

/**
 * One live shift-type override (0019, story 3.5a): `teamId` worked
 * `shiftTypeId` on `date`, for `reason`, saved at `createdAt` by the member
 * `authorMemberId` — `null` when the author is no member of the organization.
 */
export interface CalendarOverride extends ShiftTypeOverride {
  readonly id: string;
  readonly reason: string;
  /** An instant, as the database answers it; formatted in the organization's zone. */
  readonly createdAt: string;
  readonly authorMemberId: string | null;
}

/** A member of the organization, active or not: id, name and rank only (0018). */
export interface CalendarMember {
  readonly id: string;
  readonly name: string;
  /** Shown, never used; `null` is no rank. */
  readonly fireRank: string | null;
  /** Every version of their team membership, in `effectiveFrom` order. */
  readonly memberships: readonly MembershipVersion[];
  /** Every version of their active status, in `effectiveFrom` order; none is always active. */
  readonly statuses: readonly StatusVersion[];
}

/** The signed-in member reading the calendar. */
export interface CalendarViewer {
  readonly memberId: string;
  /** Picks the default mode only; authorizes nothing. */
  readonly role: MemberRole;
  /**
   * Every version of the viewer's team membership, in `effectiveFrom` order:
   * the organization-level history, the same as their entry in `members`.
   */
  readonly memberships: readonly MembershipVersion[];
  /** Every version of the viewer's active status, in `effectiveFrom` order (story 3.4a). */
  readonly statuses: readonly StatusVersion[];
}

/** The one answer the calendar draws from. */
export interface CalendarSnapshot {
  readonly organizationId: string;
  /** The organization's zone: "today" is the organization's, never the device's (L8). */
  readonly timeZone: string;
  /** Whether the organization uses fire ranks: rank is shown where it does, and never used. */
  readonly usesFireRanks: boolean;
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
   * Every member of the organization, active or not, the viewer included,
   * sorted by name under the Croatian collation, then by id (stories 3.3b,
   * 3.4a).
   */
  readonly members: readonly CalendarMember[];
  /** Every live shift-type override, by team then date (story 3.5a); at most one per team and date. */
  readonly overrides: readonly CalendarOverride[];
}

// ------------------------------------------------------------- validation

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Which check refused the read: logged beside {@link CALENDAR_UNAVAILABLE},
 * never shown, and closed so a new check names itself here.
 */
type CalendarRefusal =
  | 'session'
  | 'rejected'
  | 'answer'
  | 'error'
  | 'data'
  | 'count'
  | 'organization'
  | 'viewer'
  | 'team'
  | 'type'
  | 'step'
  | 'assignment'
  | 'ids'
  | 'step type'
  | 'positions'
  | 'assignment team'
  | 'assignment step'
  | 'versions'
  | 'members'
  | 'memberships'
  | 'statuses'
  | 'override';

function unavailable(reason: CalendarRefusal, detail?: unknown): CalendarOutcome {
  if (detail === undefined) console.error(CALENDAR_UNAVAILABLE, reason);
  else console.error(CALENDAR_UNAVAILABLE, reason, detail);

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
 * EXACTLY ONE viewer member row, whose role is not one this build knows,
 * whose own membership versions name another tenant, a team the answer lacks,
 * or one date twice, or whose id the members read does not name.
 * Unavailable, finally, on a members read that is rejected, errors, answers
 * anything but an array, or holds a malformed row (a rank neither text nor
 * null included) or one id twice; on an organization-level membership version
 * of another tenant, naming a team the answer lacks, with a position neither
 * text nor null, or on a date its member already has a version on; and on a
 * status version of another tenant, with an `active` that is not a boolean,
 * or on a date its member already has a version on. Unavailable on an
 * overrides read that is rejected, errors or answers anything but an array,
 * or on an override row without a text id, naming a team or a type the
 * answer lacks, with a malformed date, a reason that is not text, a
 * creation time that is not an instant, or an author neither text nor null,
 * or on a second override of one team and date or one id twice. What the database's keys
 * guarantee is re-checked, so a defect surfaces as the message, never as a
 * projection that throws.
 *
 * A VALID VERSION OF A MEMBER THE MEMBERS READ DOES NOT NAME IS IGNORED, as
 * 3.3b ignored it: the select and the rpc are two requests, so a member
 * created between them is a race, not a defect, and must not take the
 * calendar down.
 */
export async function readCalendar(
  table: CalendarTable,
  membersRead: CalendarMembersRpc,
  session: () => Promise<Session | null>,
): Promise<CalendarOutcome> {
  let answered: CalendarAnswer;
  let membersAnswered: CalendarMembersAnswer;
  let overridesAnswered: CalendarMembersAnswer;

  try {
    const current = await session();

    if (current === null) return unavailable('session');

    [answered, membersAnswered, overridesAnswered] = await Promise.all([
      table
        .select(CALENDAR_COLUMNS, CALENDAR_COUNT)
        .filter(CALENDAR_VIEWER_COLUMN, CALENDAR_VIEWER_OPERATOR, current.user.id),
      membersRead.rpc(CALENDAR_MEMBERS_FUNCTION),
      membersRead.rpc(CALENDAR_OVERRIDES_FUNCTION),
    ]);
  } catch (cause) {
    return unavailable('rejected', cause);
  }

  if (!isRecord(answered)) return unavailable('answer', typeof answered);
  if (answered.error !== null) return unavailable('error', answered.error.code);
  if (!Array.isArray(answered.data)) return unavailable('data');

  const rows: readonly unknown[] = answered.data;

  if (answered.count !== 1 || rows.length !== 1) return unavailable('count', answered.count);

  const organization = rows[0];

  if (!isRecord(organization)) return unavailable('organization');

  const organizationId = textAt(organization, 'id');
  const timeZone = textAt(organization, 'timezone');
  const usesFireRanks = organization['uses_fire_ranks'];
  const teamRows = embedded(organization, 'teams');
  const typeRows = embedded(organization, 'shift_types');
  const stepRows = embedded(organization, 'rotation_steps');
  const assignmentRows = embedded(organization, 'rotation_assignments');
  const memberRows = embedded(organization, 'members');
  const membershipRows = embedded(organization, 'team_membership_versions');
  const statusRows = embedded(organization, 'member_status_versions');

  if (organizationId === null || timeZone === null) return unavailable('organization');
  if (typeof usesFireRanks !== 'boolean') return unavailable('organization');
  if (teamRows === null || typeRows === null || stepRows === null || assignmentRows === null) {
    return unavailable('organization');
  }
  if (memberRows === null || memberRows.length !== 1) return unavailable('viewer');
  if (membershipRows === null) return unavailable('memberships');
  if (statusRows === null) return unavailable('statuses');

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

  const identities = identitiesOf(membersAnswered);

  if (identities === null) return unavailable('members');

  const memberIds = new Set(identities.map((identity) => identity.id));
  const memberships = versionsByMemberOf(membershipRows, memberIds, (row) =>
    membershipOf(row, organizationId, teamIds, true),
  );

  if (memberships === null) return unavailable('memberships');

  const statuses = versionsByMemberOf(statusRows, memberIds, (row) => statusOf(row, organizationId));

  if (statuses === null) return unavailable('statuses');

  const viewer = viewerOf(memberRows[0], organizationId, teamIds, memberIds, memberships, statuses);

  if (viewer === null) return unavailable('viewer');

  const members: CalendarMember[] = identities
    .map((identity) => ({
      ...identity,
      memberships: memberships.get(identity.id) ?? [],
      statuses: statuses.get(identity.id) ?? [],
    }))
    .sort(compareMembers);

  const overrides = overridesOf(overridesAnswered, teamIds, typeIds);

  if (overrides === null) return unavailable('override');

  types.sort(compareCreation);

  return {
    ok: true,
    snapshot: { organizationId, timeZone, usesFireRanks, teams, types, steps, assignments, viewer, members, overrides },
  };
}

/**
 * The live overrides `calendar_shift_type_overrides()` answered, by team then
 * date, or `null`: a malformed answer, an error, data that is not an array, a
 * row that does not validate, a second override of one team and date, or one
 * id twice. Only the seven columns are carried off a row.
 */
function overridesOf(
  answered: unknown,
  teamIds: ReadonlySet<string>,
  typeIds: ReadonlySet<string>,
): CalendarOverride[] | null {
  if (!isRecord(answered) || answered['error'] !== null) return null;

  const rows = answered['data'];

  if (!Array.isArray(rows)) return null;

  const overrides: CalendarOverride[] = [];

  for (const row of rows as readonly unknown[]) {
    if (!isRecord(row)) return null;

    const id = textAt(row, 'id');
    const teamId = textAt(row, 'team_id');
    const date = textAt(row, 'date');
    const shiftTypeId = textAt(row, 'shift_type_id');
    const reason = row['reason'];
    const createdAt = textAt(row, 'created_at');
    const authorMemberId = row['author_member_id'];

    if (id === null || teamId === null || !teamIds.has(teamId)) return null;
    if (shiftTypeId === null || !typeIds.has(shiftTypeId)) return null;
    if (date === null || !isIsoDate(date)) return null;
    // Any text: what a reason may hold is 0019's check alone, and a row the
    // database accepted is never refused here for its content.
    if (typeof reason !== 'string') return null;
    if (createdAt === null || Number.isNaN(Date.parse(createdAt))) return null;
    if (authorMemberId !== null && (typeof authorMemberId !== 'string' || authorMemberId === '')) return null;

    overrides.push({ id, teamId, date, shiftTypeId, reason, createdAt, authorMemberId });
  }

  if (new Set(overrides.map((override) => override.id)).size !== overrides.length) return null;
  if (new Set(overrides.map((override) => `${override.teamId}:${override.date}`)).size !== overrides.length) {
    return null;
  }

  return overrides.sort((left, right) =>
    left.teamId === right.teamId ? (left.date < right.date ? -1 : 1) : left.teamId < right.teamId ? -1 : 1,
  );
}

function byEffectiveFrom(left: { readonly effectiveFrom: string }, right: { readonly effectiveFrom: string }): number {
  return left.effectiveFrom < right.effectiveFrom ? -1 : 1;
}

/**
 * One membership version as the calendar embeds it, or `null`: another
 * tenant's, a malformed date, a team that is neither `null` nor one the
 * answer holds, or — where the embed carries it (`positioned`) — a position
 * that is neither text nor `null`. The viewer's own embed carries no
 * position; it is only validated, never carried ({@link viewerOf}).
 */
function membershipOf(
  version: unknown,
  organizationId: string,
  teamIds: ReadonlySet<string>,
  positioned: boolean,
): MembershipVersion | null {
  if (!isRecord(version) || textAt(version, 'organization_id') !== organizationId) return null;

  const effectiveFrom = textAt(version, 'effective_from');
  const teamId = version['team_id'];
  const position = positioned ? version['position'] : null;

  if (effectiveFrom === null || !isIsoDate(effectiveFrom)) return null;
  if (teamId !== null && (typeof teamId !== 'string' || !teamIds.has(teamId))) return null;
  if (position !== null && typeof position !== 'string') return null;

  return { teamId, position, effectiveFrom };
}

/**
 * One status version as the calendar embeds it, or `null`: another tenant's,
 * a malformed date, or an `active` that is not a boolean.
 */
function statusOf(version: unknown, organizationId: string): StatusVersion | null {
  if (!isRecord(version) || textAt(version, 'organization_id') !== organizationId) return null;

  const effectiveFrom = textAt(version, 'effective_from');
  const active = version['active'];

  if (effectiveFrom === null || !isIsoDate(effectiveFrom)) return null;
  if (typeof active !== 'boolean') return null;

  return { active, effectiveFrom };
}

/**
 * Every member's history from an organization-level versions embed, by member
 * id, each in date order; `null` when one version does not validate
 * (`versionOf`), names no member, or repeats a date its member already has.
 * A valid version of a member outside `memberIds` — one the members read, a
 * separate request, did not yet name — is checked like any other and then
 * left out.
 */
function versionsByMemberOf<Version extends { readonly effectiveFrom: string }>(
  rows: readonly unknown[],
  memberIds: ReadonlySet<string>,
  versionOf: (row: unknown) => Version | null,
): ReadonlyMap<string, readonly Version[]> | null {
  const byMember = new Map<string, Version[]>();

  for (const row of rows) {
    const version = versionOf(row);
    const memberId = isRecord(row) ? textAt(row, 'member_id') : null;

    if (version === null || memberId === null) return null;

    const versions = byMember.get(memberId) ?? [];

    if (versions.some((known) => known.effectiveFrom === version.effectiveFrom)) return null;

    versions.push(version);
    byMember.set(memberId, versions);
  }

  const known = new Map<string, Version[]>();

  for (const [memberId, versions] of byMember) {
    if (memberIds.has(memberId)) known.set(memberId, versions.sort(byEffectiveFrom));
  }

  return known;
}

function compareMembers(first: CalendarMember, second: CalendarMember): number {
  // By name under the Croatian collation, then by id, as `@/features/teams/services/roster`'s
  // `compareMembers`, so two members who share a name sort the same way every
  // time.
  return compareText(first.name, second.name) || compareText(first.id, second.id);
}

/** A member as `calendar_members()` answers it, before their histories are attached. */
interface CalendarMemberIdentity {
  readonly id: string;
  readonly name: string;
  readonly fireRank: string | null;
}

/**
 * The members `calendar_members()` answered, or `null`: a malformed answer,
 * an error, data that is not an array, a row without a text id and a
 * non-blank name or with a rank neither text nor `null`, or one id twice.
 * Only `id`, `name` and `fire_rank` are carried off a row, whatever else
 * might arrive.
 */
function identitiesOf(answered: unknown): CalendarMemberIdentity[] | null {
  if (!isRecord(answered) || answered['error'] !== null) return null;

  const rows = answered['data'];

  if (!Array.isArray(rows)) return null;

  const identities: CalendarMemberIdentity[] = [];

  for (const row of rows as readonly unknown[]) {
    if (!isRecord(row)) return null;

    const id = textAt(row, 'id');
    const name = row['name'];
    const fireRank = row['fire_rank'];

    // Blank is not a name `members` can hold (`btrim(name) <> ''`).
    if (id === null || typeof name !== 'string' || name.trim() === '') return null;
    if (fireRank !== null && typeof fireRank !== 'string') return null;

    identities.push({ id, name, fireRank });
  }

  if (new Set(identities.map((identity) => identity.id)).size !== identities.length) return null;

  return identities;
}

/**
 * The viewer's member row, or `null` when it does not validate: another
 * tenant's, a role this build does not know, a membership version of another
 * tenant, with a malformed date, naming a team the answer lacks, or on a date
 * another version already has — or a member the members read does not name.
 *
 * ONE HISTORY PER PERSON (story 3.4a): the viewer's own embed is still
 * validated, as the tripwire it always was, but the memberships and statuses
 * carried are the organization-level ones under their id — exactly those of
 * their entry in `members`, positions included.
 */
function viewerOf(
  row: unknown,
  organizationId: string,
  teamIds: ReadonlySet<string>,
  memberIds: ReadonlySet<string>,
  memberships: ReadonlyMap<string, readonly MembershipVersion[]>,
  statuses: ReadonlyMap<string, readonly StatusVersion[]>,
): CalendarViewer | null {
  if (!isRecord(row) || textAt(row, 'organization_id') !== organizationId) return null;

  const memberId = textAt(row, 'id');
  const role = memberRoleOf(row['role']);
  const versionRows = embedded(row, 'team_membership_versions');

  if (memberId === null || role === null || versionRows === null) return null;

  if (!memberIds.has(memberId)) return null;

  const dates = new Set<string>();

  for (const row of versionRows) {
    const version = membershipOf(row, organizationId, teamIds, false);

    if (version === null || dates.has(version.effectiveFrom)) return null;

    dates.add(version.effectiveFrom);
  }

  return {
    memberId,
    role,
    memberships: memberships.get(memberId) ?? [],
    statuses: statuses.get(memberId) ?? [],
  };
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
  membersRead: () => CalendarMembersRpc,
  session: () => Promise<Session | null> = currentSession,
) {
  return queryOptions({
    queryKey: CALENDAR_KEY,
    queryFn: async (): Promise<CalendarSnapshot> => {
      const outcome = await readCalendar(table(), membersRead(), session);

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
