import { queryOptions } from '@tanstack/react-query';
import { collisionKeyOf, type CollisionResolution } from '@shift/domain';

import { isIsoDate } from '@/lib/i18n/format';

/**
 * The live conflict resolutions (story 5.4a; AD-4), read in a `.ts` that
 * renders nothing (AD-15). A conflict is derived, never stored; what is
 * stored is the decision on one, keyed by `collisionKeyOf`'s `(member, date,
 * team)` (0031). Every surface that counts or lists unresolved conflicts — the
 * queue, the calendar's marks and *Sati*'s count — reads these beside the
 * leave and drops each collision they match through the one domain filter,
 * `unresolvedCollisionsOf`, so they all agree on one unresolved set.
 *
 * TWO READS, BY ROLE, as the leave's are: an admin reads the organization's
 * live rows from `conflict_resolutions` under
 * {@link ORGANIZATION_CONFLICT_RESOLUTIONS_KEY}; a member reads their own
 * through `my_conflict_resolutions()` under
 * {@link MY_CONFLICT_RESOLUTIONS_KEY}, which carries no author. Neither read
 * names an author column.
 *
 * THE ROWS COME BACK UNPARSED. Whose rows are trustworthy is the calendar
 * snapshot's question — every row's member and team must be one of its — so
 * {@link conflictResolutionsOf} parses them where both reads meet. A bad row,
 * an unknown member or team, or two live rows of one key make the whole
 * answer untrustworthy (`null`), never a guess.
 */

/** The table an admin reads (0031). */
export const CONFLICT_RESOLUTIONS_TABLE = 'conflict_resolutions';

/** The definer function a member reads their own through (0031). */
export const MY_CONFLICT_RESOLUTIONS_FUNCTION = 'my_conflict_resolutions';

/** The one query key the organization's live resolutions are read under. */
export const ORGANIZATION_CONFLICT_RESOLUTIONS_KEY = ['organization-conflict-resolutions'] as const;

/** The one query key the viewer's own live resolutions are read under. */
export const MY_CONFLICT_RESOLUTIONS_KEY = ['my-conflict-resolutions'] as const;

/** The resolutions could not be read, or what came back cannot be trusted. */
export const CONFLICT_RESOLUTIONS_UNAVAILABLE = 'CONFLICT_RESOLUTIONS_UNAVAILABLE';

/**
 * The columns read: the key, the kind and the override a replacement names
 * (0032; story 5.4e), and never an author.
 */
export const CONFLICT_RESOLUTIONS_COLUMNS = 'member_id,date,team_id,kind,roster_override_id';

/** Five minutes, the bound the leave reads set; every leave write re-reads it. */
export const CONFLICT_RESOLUTIONS_READ_STALE_MS = 300000;

/**
 * Rows per page of the organization's read: PostgREST's `max_rows`
 * (`supabase/config.toml`), so a short page means the last.
 */
export const CONFLICT_RESOLUTIONS_PAGE_ROWS = 1000;

/** The three kinds 0031 admits, as stored. */
export const CONFLICT_RESOLUTION_KINDS = ['accept_uncovered', 'replace_member', 'amend_leave'] as const;

export type ConflictResolutionKind = (typeof CONFLICT_RESOLUTION_KINDS)[number];

/** The kind story 5.4b writes: the shift goes uncovered, and the absent member's hours become leave hours. */
export const ACCEPT_UNCOVERED = 'accept_uncovered' satisfies ConflictResolutionKind;

/**
 * The kind story 5.4c writes, through 0032's function alone: someone else is
 * put on the shift, and the absent member — still rostered, on leave — has
 * their hours as leave hours, as for {@link ACCEPT_UNCOVERED}.
 */
export const REPLACE_MEMBER = 'replace_member' satisfies ConflictResolutionKind;

const ID_COLUMN = 'id';
const MEMBER_COLUMN = 'member_id';
const DATE_COLUMN = 'date';
const TEAM_COLUMN = 'team_id';
const KIND_COLUMN = 'kind';
const REMOVED_COLUMN = 'removed_at';
const ROSTER_OVERRIDE_COLUMN = 'roster_override_id';

/** One live resolution: the key it matches a collision on, and its kind. */
export interface ConflictResolution extends CollisionResolution {
  readonly kind: ConflictResolutionKind;
}

export interface ConflictResolutionsReadError {
  readonly code?: string | undefined;
}

export interface ConflictResolutionsAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: ConflictResolutionsReadError | null;
}

/** One page's answer, with the exact count of every row the filter matches. */
export interface OrganizationConflictResolutionsAnswer extends ConflictResolutionsAnswer {
  readonly count?: number | null;
}

/** The organization's read: the live filter, a stable order, and one page of it. */
export interface OrganizationConflictResolutionsQuery {
  is(column: string, value: null): OrganizationConflictResolutionsQuery;
  order(column: string, options: { readonly ascending: boolean }): OrganizationConflictResolutionsQuery;
  range(from: number, to: number): PromiseLike<OrganizationConflictResolutionsAnswer>;
}

/** The one call made on `conflict_resolutions`, named structurally so it can be stubbed. */
export interface OrganizationConflictResolutionsTable {
  select(columns: string, options: { readonly count: 'exact' }): OrganizationConflictResolutionsQuery;
}

/** The one call made for the viewer's own, named structurally so it can be stubbed. */
export interface MyConflictResolutionsRpc {
  rpc(fn: string): PromiseLike<ConflictResolutionsAnswer>;
}

export type ConflictResolutionRowsOutcome =
  | { readonly ok: true; readonly rows: readonly unknown[] }
  | { readonly ok: false; readonly code: typeof CONFLICT_RESOLUTIONS_UNAVAILABLE };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unavailable(reason: unknown): ConflictResolutionRowsOutcome {
  console.error(CONFLICT_RESOLUTIONS_UNAVAILABLE, reason);

  return { ok: false, code: CONFLICT_RESOLUTIONS_UNAVAILABLE };
}

/** An answer's rows, unparsed, or unavailable when it is not an answer, an error, or not a list. */
function rowsOfAnswer(answered: ConflictResolutionsAnswer): ConflictResolutionRowsOutcome {
  if (!isRecord(answered)) return unavailable(typeof answered);

  if (answered.error !== null) return unavailable(answered.error?.code);

  if (!Array.isArray(answered.data)) return unavailable('shape');

  return { ok: true, rows: answered.data as readonly unknown[] };
}

/**
 * The organization's live rows, EVERY ONE, or unavailable: read in pages of
 * {@link CONFLICT_RESOLUTIONS_PAGE_ROWS} ordered by id, each with the exact
 * count, as the organization's leave is. A count that is missing, changes
 * between pages, or disagrees with the rows assembled is unavailable.
 */
export async function readOrganizationConflictResolutionRows(
  table: OrganizationConflictResolutionsTable,
): Promise<ConflictResolutionRowsOutcome> {
  const rows: unknown[] = [];
  let expected: number | null = null;

  for (let from = 0; ; from += CONFLICT_RESOLUTIONS_PAGE_ROWS) {
    let answered: OrganizationConflictResolutionsAnswer;

    try {
      answered = await table
        .select(CONFLICT_RESOLUTIONS_COLUMNS, { count: 'exact' })
        .is(REMOVED_COLUMN, null)
        .order(ID_COLUMN, { ascending: true })
        .range(from, from + CONFLICT_RESOLUTIONS_PAGE_ROWS - 1);
    } catch (cause) {
      return unavailable(cause);
    }

    const page = rowsOfAnswer(answered);

    if (!page.ok) return page;

    const count = answered.count;

    if (typeof count !== 'number' || (expected !== null && count !== expected)) return unavailable('count');

    expected = count;
    rows.push(...page.rows);

    // Never asked past the count, which PostgREST answers 416 rather than empty.
    if (rows.length >= count || page.rows.length < CONFLICT_RESOLUTIONS_PAGE_ROWS) break;
  }

  if (rows.length !== expected) return unavailable('count');

  return { ok: true, rows };
}

/** The viewer's own live rows as `my_conflict_resolutions()` answered them, or unavailable. */
export async function readMyConflictResolutionRows(client: MyConflictResolutionsRpc): Promise<ConflictResolutionRowsOutcome> {
  let answered: ConflictResolutionsAnswer;

  try {
    answered = await client.rpc(MY_CONFLICT_RESOLUTIONS_FUNCTION);
  } catch (cause) {
    return unavailable(cause);
  }

  return rowsOfAnswer(answered);
}

/** The query options the organization's resolutions are read with, under {@link ORGANIZATION_CONFLICT_RESOLUTIONS_KEY}. */
export function organizationConflictResolutionsQueryOptions(table: () => OrganizationConflictResolutionsTable) {
  return queryOptions({
    queryKey: ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
    queryFn: async (): Promise<readonly unknown[]> => {
      const outcome = await readOrganizationConflictResolutionRows(table());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.rows;
    },
    staleTime: CONFLICT_RESOLUTIONS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

/** The query options the viewer's own resolutions are read with, under {@link MY_CONFLICT_RESOLUTIONS_KEY}. */
export function myConflictResolutionsQueryOptions(client: () => MyConflictResolutionsRpc) {
  return queryOptions({
    queryKey: MY_CONFLICT_RESOLUTIONS_KEY,
    queryFn: async (): Promise<readonly unknown[]> => {
      const outcome = await readMyConflictResolutionRows(client());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.rows;
    },
    staleTime: CONFLICT_RESOLUTIONS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

function isKind(value: unknown): value is ConflictResolutionKind {
  return typeof value === 'string' && (CONFLICT_RESOLUTION_KINDS as readonly string[]).includes(value);
}

/**
 * The rows as resolutions, in the order given, or null when any row is not a
 * record, carries a member outside `memberIds` or a team outside `teamIds`, a
 * date that is no calendar `YYYY-MM-DD`, or a kind 0031 does not admit, or
 * when two rows share a key — which 0031's live key refuses.
 */
export function conflictResolutionsOf(
  rows: readonly unknown[],
  memberIds: readonly string[],
  teamIds: readonly string[],
): readonly ConflictResolution[] | null {
  const members = new Set(memberIds);
  const teams = new Set(teamIds);
  const keys = new Set<string>();
  const resolutions: ConflictResolution[] = [];

  for (const row of rows) {
    if (!isRecord(row)) return null;

    const memberId = row[MEMBER_COLUMN];
    const date = row[DATE_COLUMN];
    const teamId = row[TEAM_COLUMN];
    const kind = row[KIND_COLUMN];

    if (typeof memberId !== 'string' || !members.has(memberId)) return null;
    if (typeof teamId !== 'string' || !teams.has(teamId)) return null;
    if (typeof date !== 'string' || !isIsoDate(date)) return null;
    if (!isKind(kind)) return null;

    const resolution = { memberId, date, teamId, kind };
    const key = collisionKeyOf(resolution);

    if (keys.has(key)) return null;

    keys.add(key);
    resolutions.push(resolution);
  }

  return resolutions;
}

/** A read's result as far as the surfaces read it: the leave reads' shape. */
export interface ConflictResolutionRowsAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  readonly data: readonly unknown[] | undefined;
}

/**
 * The ROLE-GATED ANSWER: the organization's read for a viewer who reads the
 * organization's leave (an admin), the viewer's own otherwise — the one each
 * surface enabled, as its leave answer is chosen.
 */
export function conflictResolutionsAnswerOf<Answer extends ConflictResolutionRowsAnswer>(
  readsOrganization: boolean,
  organization: Answer,
  own: Answer,
): Answer {
  return readsOrganization ? organization : own;
}

/**
 * THE SPLIT BY KIND (story 5.4b): the keys of the resolutions that accepted
 * their conflict as uncovered, in the order given. *Sati* moves each one's
 * shift into the absent member's leave hours, and the admin's calendar marks
 * its cell uncovered; no other kind does either.
 */
export function acceptedUncoveredOf(resolutions: readonly ConflictResolution[]): readonly CollisionResolution[] {
  return resolutions
    .filter((resolution) => resolution.kind === ACCEPT_UNCOVERED)
    .map(({ memberId, date, teamId }) => ({ memberId, date, teamId }));
}

/** The kinds whose absent member's shift counts as leave, not work (stories 5.4b, 5.4c). */
const LEAVE_HOURS_KINDS: ReadonlySet<ConflictResolutionKind> = new Set([ACCEPT_UNCOVERED, REPLACE_MEMBER]);

/**
 * THE LEAVE-HOURS SPLIT (stories 5.4b, 5.4c): the keys of the resolutions
 * whose absent member's shift counts as leave hours, in the order given —
 * accepted as uncovered, and replaced. A replacement's override only ADDS
 * (human, 2026-10-02): the absent member stays rostered, so their shift is
 * still in their schedule and must be moved to leave; the replacement's band
 * hours rise through the override itself. *Sati* reads this on both the
 * admin's and the member's path. The calendar's uncovered mark stays
 * {@link acceptedUncoveredOf}'s alone.
 */
export function leaveHoursKeysOf(resolutions: readonly ConflictResolution[]): readonly CollisionResolution[] {
  return resolutions
    .filter((resolution) => LEAVE_HOURS_KINDS.has(resolution.kind))
    .map(({ memberId, date, teamId }) => ({ memberId, date, teamId }));
}

/**
 * One live `replace_member` resolution and the roster override it put in
 * place (0032's `roster_override_id`; story 5.4e).
 */
export interface ReplacementLink extends CollisionResolution {
  readonly rosterOverrideId: string;
}

/**
 * THE REPLACEMENT LINKS (story 5.4e): every `replace_member` row of
 * `memberId` in the organization's read, with the override it names, in the
 * order given; every other kind and every other member is skipped.
 *
 * TRUST IS JUDGED FOR THIS MEMBER ONLY, so one malformed row elsewhere in the
 * organization never blinds every member's guard. Null — never a guess — when
 * a row is not a record or its member cannot be read (it might be this
 * member's), or a replacement row of this member carries no team or override
 * id, or a date that is no calendar `YYYY-MM-DD`. Kept apart from
 * {@link conflictResolutionsOf}, whose shape the queue, the member path and
 * *Sati* consume.
 */
export function replacementLinksOf(rows: readonly unknown[], memberId: string): readonly ReplacementLink[] | null {
  const links: ReplacementLink[] = [];

  for (const row of rows) {
    if (!isRecord(row)) return null;

    const rowMember = row[MEMBER_COLUMN];

    if (typeof rowMember !== 'string' || rowMember === '') return null;
    if (rowMember !== memberId || row[KIND_COLUMN] !== REPLACE_MEMBER) continue;

    const date = row[DATE_COLUMN];
    const teamId = row[TEAM_COLUMN];
    const rosterOverrideId = row[ROSTER_OVERRIDE_COLUMN];

    if (typeof teamId !== 'string' || teamId === '') return null;
    if (typeof rosterOverrideId !== 'string' || rosterOverrideId === '') return null;
    if (typeof date !== 'string' || !isIsoDate(date)) return null;

    links.push({ memberId, date, teamId, rosterOverrideId });
  }

  return links;
}
