import { queryOptions } from '@tanstack/react-query';

import { compareText } from '@/i18n/format';

/**
 * The team list: one organization's teams, read once and split in memory
 * (story 1.7a).
 *
 * EVERYTHING THE SCREENS DECIDE IS HERE, for the reason `@/members/list` gives:
 * a `.tsx` is collected by no test (AD-15), so the validation, the split into
 * active and archived, the counts and the surface state are pure functions the
 * node suite executes.
 *
 * ANY COUNT (DI-8). Nothing below knows how many teams an organization runs or
 * reads meaning into a team's name: zero, one and nine teams take the same
 * path, and the name is data that is only ever sorted and shown.
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). {@link TEAMS_LIST_KEY} is the only key
 * the two team screens read under, and every figure on them is derived from
 * that one answer by {@link splitTeams}.
 *
 * `select` AND NOTHING ELSE. Writing is `@/teams/write`.
 */

/** The relation both team modules name. */
export const TEAMS_TABLE = 'teams';

/** The single query key the team screens read under. */
export const TEAMS_LIST_KEY = ['teams'] as const;

/**
 * The columns this read selects. `organization_id` renders nowhere and is the
 * tripwire {@link readTeams} uses to refuse an answer spanning two tenants.
 */
export const TEAMS_COLUMNS = 'organization_id,id,name,archived';

/** The exact count, so a truncated answer is caught rather than rendered. */
export const TEAMS_COUNT: TeamsCountOptions = { count: 'exact' };

/** Five minutes, the bound `MEMBERS_READ_STALE_MS` sets, for the same reason. */
export const TEAMS_READ_STALE_MS = 300000;

/** TanStack Query's name for a fetch it has not started (offline). */
export const TEAMS_FETCH_PAUSED = 'paused';

/**
 * The list could not be read, or what came back cannot be trusted as one.
 *
 * THE ONLY FAILURE, and the absence of a "refused" code is deliberate. On
 * `members` zero rows is the policy's silent refusal, because an organization
 * always has the caller in it; an organization may have NO teams, so zero rows
 * here is an honest answer and is rendered as `0 smjena`.
 */
export const TEAMS_UNAVAILABLE = 'TEAMS_UNAVAILABLE';

export type TeamsFailure = typeof TEAMS_UNAVAILABLE;

export type TeamsOutcome =
  | { readonly ok: true; readonly teams: readonly TeamRow[] }
  | { readonly ok: false; readonly code: TeamsFailure };

/** As much of a PostgREST error as this module reads. */
export interface TeamsReadFailure {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface TeamsCountOptions {
  readonly count: 'exact';
}

export interface TeamsAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: TeamsReadFailure | null;
  readonly count: number | null;
}

/** The one call this module makes, named structurally so it can be stubbed. */
export interface TeamsTable {
  select(columns: string, options: TeamsCountOptions): PromiseLike<TeamsAnswer>;
}

/** One team, as the surface sees it. */
export interface TeamRow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  /** One-way (`0009`): an archived team is read and shown, never written. */
  readonly archived: boolean;
}

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' ? value : null;
}

/**
 * One PostgREST row as a team, or `null` — validated field by field rather
 * than cast, so a malformed row refuses the answer instead of reaching the
 * collator as `undefined`.
 */
export function teamRowOf(row: unknown): TeamRow | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;

  const fields = row as Record<string, unknown>;
  const id = textAt(fields, 'id');
  const organizationId = textAt(fields, 'organization_id');
  const name = textAt(fields, 'name');
  const archived = fields['archived'];

  if (id === null || organizationId === null || name === null) return null;
  if (typeof archived !== 'boolean') return null;

  return { id, organizationId, name, archived };
}

/**
 * Every team this session reaches, or one stable code.
 *
 * Unavailable on a rejected or malformed answer, on a transport error, on an
 * answer shorter than its own exact count, on a row that does not validate, and
 * on an answer spanning two organizations. Zero rows is an answer.
 */
export async function readTeams(table: TeamsTable): Promise<TeamsOutcome> {
  let answered: TeamsAnswer;

  try {
    answered = await table.select(TEAMS_COLUMNS, TEAMS_COUNT);
  } catch (cause) {
    console.error(TEAMS_UNAVAILABLE, cause);

    return { ok: false, code: TEAMS_UNAVAILABLE };
  }

  if (typeof answered !== 'object' || answered === null || Array.isArray(answered)) {
    console.error(TEAMS_UNAVAILABLE, typeof answered);

    return { ok: false, code: TEAMS_UNAVAILABLE };
  }

  if (answered.error !== null) {
    console.error(TEAMS_UNAVAILABLE, answered.error.code);

    return { ok: false, code: TEAMS_UNAVAILABLE };
  }

  const rows = answered.data ?? [];

  if (answered.count !== null && answered.count > rows.length) {
    console.error(TEAMS_UNAVAILABLE, answered.count, rows.length);

    return { ok: false, code: TEAMS_UNAVAILABLE };
  }

  const teams: TeamRow[] = [];

  for (const row of rows) {
    const team = teamRowOf(row);

    if (team === null) {
      console.error(TEAMS_UNAVAILABLE, 'row');

      return { ok: false, code: TEAMS_UNAVAILABLE };
    }

    teams.push(team);
  }

  if (new Set(teams.map((team) => team.organizationId)).size > 1) {
    console.error(TEAMS_UNAVAILABLE, 'organizations');

    return { ok: false, code: TEAMS_UNAVAILABLE };
  }

  return { ok: true, teams };
}

/** The teams split into the two labelled groups the list screen renders. */
export interface TeamsSplit {
  readonly active: readonly TeamRow[];
  readonly archived: readonly TeamRow[];
}

function compareTeams(first: TeamRow, second: TeamRow): number {
  // By name under the Croatian collation, then by id so two archived teams
  // that once carried the same name still sort the same way every time.
  return compareText(first.name, second.name) || compareText(first.id, second.id);
}

/**
 * Active and archived teams, each sorted by name. The counts the screen states
 * are these arrays' lengths and nothing else, so a count can never disagree
 * with the rows beside it.
 */
export function splitTeams(teams: readonly TeamRow[]): TeamsSplit {
  const sorted = [...teams].sort(compareTeams);

  return {
    active: sorted.filter((team) => !team.archived),
    archived: sorted.filter((team) => team.archived),
  };
}

/** The team a route parameter names, or `null` when the answer holds none. */
export function teamById(teams: readonly TeamRow[], id: string): TeamRow | null {
  return teams.find((team) => team.id === id) ?? null;
}

/**
 * The row action a team is listed with. An archived team is frozen, so its row
 * OPENS it for viewing: "edit" on a row that offers no edit is a promise the
 * next screen breaks.
 */
export function teamActionMessageKey(team: TeamRow): 'smjene.edit' | 'smjene.view' {
  return team.archived ? 'smjene.view' : 'smjene.edit';
}

/** The heading one team's screen carries, by the same rule. */
export function teamHeadingMessageKey(
  team: TeamRow | null,
): 'smjene.editHeading' | 'smjene.viewHeading' {
  return team !== null && team.archived ? 'smjene.viewHeading' : 'smjene.editHeading';
}

/** The message a read failure renders as. Exhaustive. */
export function teamsMessageKey(failure: TeamsFailure): 'smjene.error.unavailable' {
  if (failure === TEAMS_UNAVAILABLE) return 'smjene.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}

/**
 * The one query definition every screen reading {@link TEAMS_LIST_KEY} uses.
 *
 * UNAVAILABLE REJECTS. {@link readTeams} returns its failure as a value, and
 * handed to TanStack Query as resolved data that value would REPLACE a good
 * cached list on a failed refetch — the rows vanish after any write's
 * invalidation — and `retry` would never run. Thrown here, TanStack retries it
 * and keeps the previous `data` beside `isError`, which is exactly the "rows
 * kept, message beside them" state {@link teamsSurfaceStateOf} draws.
 *
 * THE TABLE IS RESOLVED INSIDE THE QUERY FUNCTION, so a build with no
 * environment (`SUPABASE_ENVIRONMENT_MISSING`) is a query rejection too.
 *
 * ONE DEFINITION PER KEY: two query functions registered under one key is a
 * known defect, so no screen spells this out by hand.
 */
export function teamsQueryOptions(table: () => TeamsTable) {
  return queryOptions({
    queryKey: TEAMS_LIST_KEY,
    queryFn: async (): Promise<readonly TeamRow[]> => {
      const outcome = await readTeams(table());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.teams;
    },
    staleTime: TEAMS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    // ONE RETRY, ONE SECOND APART, not TanStack's three with backoff (~7 s). A
    // write awaits the invalidation's refetch before releasing its busy lock, so
    // the default held Save disabled for seconds after a write that had landed.
    retry: 1,
    retryDelay: 1000,
  });
}

/** The query result the surface state is derived from. */
export interface TeamsQueryAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  /** The last good answer, kept by TanStack Query across a failed refetch. */
  readonly data: readonly TeamRow[] | undefined;
}

export interface TeamsSurfaceState {
  /** The teams to draw, or `null` when there is no answer to draw. */
  readonly teams: readonly TeamRow[] | null;
  readonly refusal: TeamsFailure | null;
  /** Never true beside a message. */
  readonly loading: boolean;
}

/**
 * One query result as what the screen shows: answered, failed, paused offline,
 * and a failed refetch over a good answer (rows kept, message beside them).
 * Every failure reaches here as `isError`, because {@link teamsQueryOptions}
 * rejects on it.
 */
export function teamsSurfaceStateOf(answer: TeamsQueryAnswer): TeamsSurfaceState {
  const teams = answer.data ?? null;
  const paused = answer.isPending && answer.fetchStatus === TEAMS_FETCH_PAUSED;

  if (answer.isError || paused) {
    return { teams, refusal: TEAMS_UNAVAILABLE, loading: false };
  }

  return { teams, refusal: null, loading: answer.isPending };
}

/**
 * The teams a WRITE may be built from: the surface's rows, but only while the
 * read is healthy. A failed refetch keeps the cached rows on screen beside the
 * message, and a picker or team action offered from that possibly stale list
 * would write against teams the database may no longer hold as shown — so on
 * any read refusal there is nothing to write from.
 */
export function writableTeamsOf(state: TeamsSurfaceState): readonly TeamRow[] | null {
  return state.refusal === null ? state.teams : null;
}
