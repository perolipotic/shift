import { queryOptions } from '@tanstack/react-query';
import { collisionKeyOf, collisionsOf, type Collision } from '@shift/domain';

import type { CalendarSnapshot, CalendarSurfaceState } from '@/features/calendar/services/snapshot';
import { typeRangeOn } from '@/features/calendar/utils/month';
import { collisionInputOf, liveResolutionsOf, queueReadFailed, type LeaveRowsAnswer } from '@/features/conflicts/services/conflicts-queue';
import { effectiveResolutionsOf } from '@/features/conflicts/services/replacement-effect';
import { REPLACE_MEMBER, type ConflictResolutionKind } from '@/features/conflicts/services/resolutions';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { formatDate, formatIsoDate, formatTime } from '@/lib/i18n/format';

/**
 * *Raspored*'s *Riješeni* tab (story 7.16; FR-48a, UX-DR20, UX-DR25), as a
 * pure view model in a `.ts` that renders nothing (AD-15).
 *
 * A READ OF `conflict_resolutions` ONLY (Q11; PRD §7.2's carve-out). Each
 * entry is one live, still-effective resolution — the same set the queue
 * drops its conflicts by (`resolutionsOf`'s funnel), so a conflict is in
 * exactly one of the two tabs — with its date, team, member, decision, the
 * acting admin and the instant it was recorded (`created_by`, `created_at`;
 * AD-11). No other change history is listed: the leave records and the
 * snapshot are read ONLY to name the shift type the collision was on, which
 * the table does not store (AD-4). A resolution whose collision the schedule
 * no longer derives keeps its entry, with no shift type. A resolution ends
 * with its leave (0031's lifetime rule), so a removed one is not listed.
 *
 * THE ACTING ADMIN is named from `members` by `auth_user_id`; an author with
 * no member left (deleted) has `actorName` `null`, which the screen says in
 * words.
 *
 * ORDER: most recently decided first, by the instant, then by key.
 * NEVER A PARTIAL LIST, as the queue's: an untrustworthy row refuses the tab.
 */

/** One resolved conflict as the tab shows it. */
export interface ResolvedConflictRow {
  /** `collisionKeyOf`'s key: unique per row. */
  readonly key: string;
  readonly kind: ConflictResolutionKind;
  /** `12.09.2026`. */
  readonly dateShown: string;
  readonly teamName: string;
  readonly memberName: string;
  /** The shift type the collision is on; `null` when the schedule no longer derives it. */
  readonly shiftTypeName: string | null;
  /** `19:00–07:00`, or `null` with no times in effect (or no shift type). */
  readonly times: string | null;
  /** For a replacement, who works the shift; `null` for every other kind or when not known. */
  readonly replacementName: string | null;
  /** The acting admin's name, or `null` when they are no longer a member. */
  readonly actorName: string | null;
  /** `12.09.2026`, in the organization's zone. */
  readonly decidedOn: string;
  /** `19:00`, in the organization's zone. */
  readonly decidedAt: string;
}

export interface ResolvedConflictsView {
  readonly rows: readonly ResolvedConflictRow[];
}

/** One page of the names read, `members(auth_user_id,name)`, named structurally so it can be stubbed. */
export interface ActingAdminsQuery {
  order(column: string, options: { readonly ascending: boolean }): ActingAdminsQuery;
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    readonly data: readonly unknown[] | null;
    readonly error: { readonly code?: string | undefined } | null;
  }>;
}

/** The one call made on `members` for the names, named structurally so it can be stubbed. */
export interface ActingAdminsTable {
  select(columns: string): ActingAdminsQuery;
}

/** The table the acting admins' names are read from (0002). */
export const ACTING_ADMINS_TABLE = 'members';
/** Two columns: who an auth user is, and nothing else. */
export const ACTING_ADMINS_COLUMNS = 'auth_user_id,name';
/** The one query key the names are read under. */
export const ACTING_ADMINS_KEY = ['acting-admin-names'] as const;
/** The names could not be read. */
export const ACTING_ADMINS_UNAVAILABLE = 'ACTING_ADMINS_UNAVAILABLE';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** PostgREST's `max_rows` (supabase/config.toml); the names are read one page of this size at a time. */
export const ACTING_ADMINS_PAGE_ROWS = 1000;
const ACTING_ADMINS_ORDER_COLUMN = 'id';

/** The member rows, unparsed, every page of them; throws when any read failed. */
export async function readActingAdminRows(table: ActingAdminsTable): Promise<readonly unknown[]> {
  const rows: unknown[] = [];

  for (let from = 0; ; from += ACTING_ADMINS_PAGE_ROWS) {
    const answered = await table
      .select(ACTING_ADMINS_COLUMNS)
      .order(ACTING_ADMINS_ORDER_COLUMN, { ascending: true })
      .range(from, from + ACTING_ADMINS_PAGE_ROWS - 1);

    if (answered.error !== null || !Array.isArray(answered.data)) throw new Error(ACTING_ADMINS_UNAVAILABLE);

    rows.push(...(answered.data as readonly unknown[]));

    // A short page is the last one, so nothing is asked past the end.
    if (answered.data.length < ACTING_ADMINS_PAGE_ROWS) break;
  }

  return rows;
}

/** The names by auth user id; a row that is not two texts is skipped, since a name only decorates. */
function actorNamesOf(rows: readonly unknown[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>();

  for (const row of rows) {
    if (!isRecord(row)) continue;

    const { auth_user_id: authUserId, name } = row;

    if (typeof authUserId === 'string' && typeof name === 'string' && name !== '') names.set(authUserId, name);
  }

  return names;
}

/** The raw row of each resolution by its key, so the author columns the parse ignores are still read. */
function rowsByKeyOf(rows: readonly unknown[]): ReadonlyMap<string, Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    if (!isRecord(row)) continue;

    const { member_id: memberId, date, team_id: teamId } = row;

    if (typeof memberId === 'string' && typeof date === 'string' && typeof teamId === 'string') {
      byKey.set(collisionKeyOf({ memberId, date, teamId }), row);
    }
  }

  return byKey;
}

/**
 * The tab from the snapshot, the leave rows, the resolution rows and the
 * member rows as read.
 *
 * @throws RangeError when a row cannot be trusted, a resolution lacks its
 *   instant or author, or on any precondition of the derivation.
 */
export function resolvedConflictsViewOf(
  snapshot: CalendarSnapshot,
  leaveRows: readonly unknown[],
  resolutionRows: readonly unknown[],
  actorRows: readonly unknown[],
): ResolvedConflictsView {
  const records = organizationLeaveRecordsOf(
    leaveRows,
    snapshot.members.map((member) => member.id),
  );

  if (records === null) throw new RangeError('a leave record row cannot be trusted');

  const resolutions = effectiveResolutionsOf(snapshot, liveResolutionsOf(snapshot, resolutionRows));
  const collisions = new Map<string, Collision>(
    collisionsOf(collisionInputOf(snapshot, records)).map((collision) => [collisionKeyOf(collision), collision]),
  );
  const raw = rowsByKeyOf(resolutionRows);
  const actors = actorNamesOf(actorRows);
  const members = new Map(snapshot.members.map((member) => [member.id, member.name]));
  const teams = new Map(snapshot.teams.map((team) => [team.id, team.name]));
  const types = new Map(snapshot.types.map((type) => [type.id, type]));
  const overrides = new Map(snapshot.rosterOverrides.map((override) => [override.id, override]));

  const entries = resolutions.map((resolution) => {
    const key = collisionKeyOf(resolution);
    const row = raw.get(key);
    const memberName = members.get(resolution.memberId);
    const teamName = teams.get(resolution.teamId);
    const dateShown = formatIsoDate(resolution.date);
    const created = row?.['created_at'];
    const createdAt = typeof created === 'string' ? new Date(created) : null;
    const createdBy = row?.['created_by'];

    if (memberName === undefined) throw new RangeError(`member ${resolution.memberId} is not in the snapshot`);
    if (teamName === undefined) throw new RangeError(`team ${resolution.teamId} is not in the snapshot`);
    if (dateShown === null) throw new RangeError(`the date ${resolution.date} cannot be formatted`);
    if (createdAt === null || Number.isNaN(createdAt.getTime())) throw new RangeError(`resolution ${key} has no valid instant`);
    if (typeof createdBy !== 'string') throw new RangeError(`resolution ${key} has no author`);

    const collision = collisions.get(key);
    const type = collision === undefined ? undefined : types.get(collision.shiftTypeId);
    const link =
      resolution.kind === REPLACE_MEMBER && resolution.rosterOverrideId !== null
        ? overrides.get(resolution.rosterOverrideId)
        : undefined;
    const replacementId = link?.memberInId ?? null;

    const shown: ResolvedConflictRow = {
      key,
      kind: resolution.kind,
      dateShown,
      teamName,
      memberName,
      shiftTypeName: type?.name ?? null,
      times: type === undefined ? null : typeRangeOn(type, resolution.date),
      replacementName: replacementId === null ? null : (members.get(replacementId) ?? null),
      actorName: actors.get(createdBy) ?? null,
      decidedOn: formatDate(createdAt, snapshot.timeZone),
      decidedAt: formatTime(createdAt, snapshot.timeZone),
    };

    return { at: createdAt.getTime(), shown };
  });

  entries.sort((first, second) => second.at - first.at || (first.shown.key < second.shown.key ? -1 : 1));

  return { rows: entries.map((entry) => entry.shown) };
}

/** *Neriješeni*, the default and the queue itself. */
export const TAB_UNRESOLVED = 'unresolved';
/** *Riješeni*, the decided conflicts. */
export const TAB_RESOLVED = 'resolved';

export type ConflictsTab = typeof TAB_UNRESOLVED | typeof TAB_RESOLVED;

/** The tabs in the order drawn. */
export const CONFLICTS_TABS: readonly ConflictsTab[] = [TAB_UNRESOLVED, TAB_RESOLVED];

/** The id the one tab panel carries, which each tab controls. */
export const CONFLICTS_PANEL_ID = 'raspored-panel';

/** The id the resolved count's heading carries, which names the list's section. */
export const RESOLVED_COUNT_HEADING_ID = 'raspored-resolved-count';

/** The id of a tab, which the panel is labelled by. */
export function conflictsTabId(tab: ConflictsTab): string {
  return `raspored-tab-${tab}`;
}

/**
 * The tab a key moves to from `tab`, as a tablist's keys do — the arrows wrap,
 * Home and End jump — or `null` for any other key.
 */
export function tabAfterKey(tab: ConflictsTab, key: string): ConflictsTab | null {
  const at = CONFLICTS_TABS.indexOf(tab);
  const count = CONFLICTS_TABS.length;

  if (key === 'ArrowRight') return CONFLICTS_TABS[(at + 1) % count] ?? null;
  if (key === 'ArrowLeft') return CONFLICTS_TABS[(at + count - 1) % count] ?? null;
  if (key === 'Home') return CONFLICTS_TABS[0] ?? null;
  if (key === 'End') return CONFLICTS_TABS[count - 1] ?? null;

  return null;
}

/** The query options the acting admins' names are read with, under {@link ACTING_ADMINS_KEY}; read only once the tab is open. */
export function actingAdminsQueryOptions(table: () => ActingAdminsTable, enabled: boolean) {
  return queryOptions({
    queryKey: ACTING_ADMINS_KEY,
    queryFn: () => readActingAdminRows(table()),
    enabled,
    // NEVER FRESH: no write names this key, so every opening of the tab reads the names again.
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

/** The tab's reads failed, or what they answered breaches a rule. */
export const RESOLVED_UNAVAILABLE = 'unavailable';
/** Still waiting on a read. */
export const RESOLVED_LOADING = 'loading';
/** Everything read. */
export const RESOLVED_READY = 'ready';

export type ResolvedConflictsOutcome =
  | { readonly ok: true; readonly view: ResolvedConflictsView }
  | { readonly ok: false; readonly code: typeof RESOLVED_UNAVAILABLE };

/** {@link resolvedConflictsViewOf}, GUARDED as the queue is: a `RangeError` refuses the whole tab, logged. */
export function resolvedConflictsOutcomeOf(
  snapshot: CalendarSnapshot,
  leaveRows: readonly unknown[],
  resolutionRows: readonly unknown[],
  actorRows: readonly unknown[],
): ResolvedConflictsOutcome {
  try {
    return { ok: true, view: resolvedConflictsViewOf(snapshot, leaveRows, resolutionRows, actorRows) };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error('RESOLVED_CONFLICTS_UNAVAILABLE', cause);

    return { ok: false, code: RESOLVED_UNAVAILABLE };
  }
}

export type ResolvedConflicts =
  | { readonly kind: typeof RESOLVED_LOADING }
  | { readonly kind: typeof RESOLVED_UNAVAILABLE }
  | { readonly kind: typeof RESOLVED_READY; readonly view: ResolvedConflictsView };

/** The four reads the tab stands on. */
export interface ResolvedConflictsSources {
  readonly calendar: CalendarSurfaceState;
  readonly records: LeaveRowsAnswer;
  readonly resolutions: LeaveRowsAnswer;
  readonly actors: LeaveRowsAnswer;
}

/** What the tab shows: unavailable first, as the queue's, then loading, otherwise the guarded view. */
export function resolvedConflictsOf(sources: ResolvedConflictsSources): ResolvedConflicts {
  const { calendar, records, resolutions, actors } = sources;
  const failed =
    calendar.refusal !== null ||
    (!calendar.loading && calendar.snapshot === null) ||
    queueReadFailed(records) ||
    queueReadFailed(resolutions) ||
    queueReadFailed(actors);

  if (failed) return { kind: RESOLVED_UNAVAILABLE };

  if (calendar.snapshot === null || records.data === undefined || resolutions.data === undefined || actors.data === undefined) {
    return { kind: RESOLVED_LOADING };
  }

  const outcome = resolvedConflictsOutcomeOf(calendar.snapshot, records.data, resolutions.data, actors.data);

  return outcome.ok ? { kind: RESOLVED_READY, view: outcome.view } : { kind: RESOLVED_UNAVAILABLE };
}
