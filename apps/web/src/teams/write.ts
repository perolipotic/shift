import { teamById, type TeamRow, type TeamsSurfaceState } from '@/teams/list';

/**
 * Creating, renaming and archiving a team — every decision the two team
 * screens make, in a `.ts` that renders nothing (AD-15).
 *
 * THREE WRITES, ALL PLAIN POSTGREST. `0009`'s policies admit an active admin to
 * insert a team and to update the name or the archived flag of a team that is
 * not archived yet. There is no delete here and there never is: removing a team
 * archives it, and the database refuses a delete from anybody.
 *
 * ZERO ROWS IS THE STALE REFUSAL. An update that reaches no row means the team
 * is archived already, or gone from this session's reach, since the screen was
 * drawn — the policy's USING admits only a team that is not archived, and it
 * refuses by matching nothing. The screen then no longer matches the database,
 * and {@link TEAM_STALE} says exactly that.
 *
 * Codes, never messages: {@link teamWriteMessageKey} is the one edge.
 */

/** The name was empty once trimmed. Refused before anything is sent. */
export const TEAM_NAME_EMPTY = 'TEAM_NAME_EMPTY';
/** Another team still in use in this organization carries the name. */
export const TEAM_NAME_TAKEN = 'TEAM_NAME_TAKEN';
/** The team changed since the screen was drawn (archived, or out of reach). */
export const TEAM_STALE = 'TEAM_STALE';
/** The database refused the write outright (42501). */
export const TEAM_WRITE_REFUSED = 'TEAM_WRITE_REFUSED';
/** Some other value the database would not store. */
export const TEAM_WRITE_INVALID = 'TEAM_WRITE_INVALID';
/** The service, not the person: try again. */
export const TEAM_WRITE_UNAVAILABLE = 'TEAM_WRITE_UNAVAILABLE';
/** The route names a team the list does not hold. */
export const TEAM_UNKNOWN = 'TEAM_UNKNOWN';
/**
 * Somebody is on the team today, or is scheduled onto it (story 1.7b).
 *
 * `0010` alters the update policy's WITH CHECK to refuse `archived = true`
 * while any membership version for the team is in effect today or dated after
 * it. A failed WITH CHECK RAISES `42501` — unlike a USING miss, which matches
 * no row — and the archive is only offered to an admin on screen, so a `42501`
 * answering an ARCHIVE is this rule, not a lost permission.
 */
export const TEAM_IN_USE = 'TEAM_IN_USE';

export type TeamWriteFailure =
  | typeof TEAM_NAME_EMPTY
  | typeof TEAM_NAME_TAKEN
  | typeof TEAM_STALE
  | typeof TEAM_WRITE_REFUSED
  | typeof TEAM_WRITE_INVALID
  | typeof TEAM_WRITE_UNAVAILABLE
  | typeof TEAM_UNKNOWN
  | typeof TEAM_IN_USE;

export type TeamWriteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: TeamWriteFailure };

// ----------------------------------------------------------------- the seams

export interface TeamWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

export interface TeamWriteAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: TeamWriteError | null;
}

interface Selecting {
  select(columns: string): PromiseLike<TeamWriteAnswer>;
}

/**
 * `insert` and `update` AND NOTHING ELSE. No `delete`: naming it here would be
 * an invitation to write the one verb this story forbids.
 */
export interface TeamWriteTable {
  insert(values: Readonly<Record<string, unknown>>): Selecting;
  update(values: Readonly<Record<string, unknown>>): {
    eq(column: string, value: string): Selecting;
  };
}

const RETURNED_COLUMNS = 'id';
const ID_COLUMN = 'id';

// ---------------------------------------------------------------- the rules

/** The name as it will be stored — trimmed — or `null` when nothing is left. */
export function enteredTeamName(value: string): string | null {
  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const VALUE_CLASSES = ['22', '23'];

/**
 * A PostgREST refusal on `teams`, as this application's own failure.
 *
 * `23505` IS THE NAME, because the only unique on the columns a session writes
 * is `teams_organization_name_key` — the other two keys are `id`, which the
 * session never names. `23514` IS THE EMPTY NAME, because `teams_name_not_blank`
 * is the table's only check. Both are reported as what they are rather than as
 * a generic "correct a value", so the refusal names the problem.
 */
export function teamWriteFailureOf(error: TeamWriteError): TeamWriteFailure {
  if (error.code === UNIQUE_VIOLATION) return TEAM_NAME_TAKEN;
  if (error.code === CHECK_VIOLATION) return TEAM_NAME_EMPTY;
  if (error.code === INSUFFICIENT_PRIVILEGE) return TEAM_WRITE_REFUSED;
  if (error.code !== undefined && VALUE_CLASSES.includes(error.code.slice(0, 2))) {
    return TEAM_WRITE_INVALID;
  }

  return TEAM_WRITE_UNAVAILABLE;
}

/**
 * An archive's refusal: `42501` is the in-use rule (see {@link TEAM_IN_USE}),
 * and everything else reads as any other team write does.
 */
export function archiveFailureOf(error: TeamWriteError): TeamWriteFailure {
  if (error.code === INSUFFICIENT_PRIVILEGE) return TEAM_IN_USE;

  return teamWriteFailureOf(error);
}

/** Settle one write: a thrown call, an error, zero rows, or one row. */
async function settled(
  write: () => PromiseLike<TeamWriteAnswer>,
  failureOf: (error: TeamWriteError) => TeamWriteFailure = teamWriteFailureOf,
): Promise<TeamWriteOutcome> {
  let answered: TeamWriteAnswer;

  try {
    answered = await write();
  } catch (cause) {
    console.error(TEAM_WRITE_UNAVAILABLE, cause);

    return { ok: false, code: TEAM_WRITE_UNAVAILABLE };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(TEAM_WRITE_UNAVAILABLE, typeof answered);

    return { ok: false, code: TEAM_WRITE_UNAVAILABLE };
  }

  if (answered.error !== null) {
    const code = failureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  // ZERO ROWS: the policy's USING matched nothing. See the module comment.
  if ((answered.data ?? []).length === 0) return { ok: false, code: TEAM_STALE };

  return { ok: true };
}

/**
 * Create a team. The name is trimmed here; a name empty once trimmed is refused
 * before anything is sent, and the database's check refuses it from any other
 * caller.
 */
export async function createTeam(
  table: TeamWriteTable,
  organizationId: string,
  entered: string,
): Promise<TeamWriteOutcome> {
  const name = enteredTeamName(entered);

  if (name === null) return { ok: false, code: TEAM_NAME_EMPTY };

  return settled(() =>
    table.insert({ organization_id: organizationId, name }).select(RETURNED_COLUMNS),
  );
}

/** Rename a team in place; its id never changes. */
export async function renameTeam(
  table: TeamWriteTable,
  team: TeamRow,
  entered: string,
): Promise<TeamWriteOutcome> {
  const name = enteredTeamName(entered);

  if (name === null) return { ok: false, code: TEAM_NAME_EMPTY };
  if (team.archived) return { ok: false, code: TEAM_STALE };

  return settled(() => table.update({ name }).eq(ID_COLUMN, team.id).select(RETURNED_COLUMNS));
}

/** Archive a team. One-way: nothing in this module writes `archived: false`. */
export async function archiveTeam(table: TeamWriteTable, team: TeamRow): Promise<TeamWriteOutcome> {
  if (team.archived) return { ok: false, code: TEAM_STALE };

  return settled(
    () => table.update({ archived: true }).eq(ID_COLUMN, team.id).select(RETURNED_COLUMNS),
    archiveFailureOf,
  );
}

// ------------------------------------------------------- the organization

/**
 * The organization the caller's token names, or `null`.
 *
 * READ FROM THE SESSION'S OWN CLAIM rather than a second query, so the list
 * screen keeps its one read (AD-13). It is not trusted: `0009`'s insert policy
 * pins the tenant from the same signed claim and from the fresh helper, so a
 * wrong value here is refused by the database, never written.
 */
export function claimedOrganizationOf(accessToken: string | null | undefined): string | null {
  if (typeof accessToken !== 'string') return null;

  const payload = accessToken.split('.')[1];

  if (payload === undefined || payload === '') return null;

  try {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
    const decoded: unknown = JSON.parse(atob(base64));

    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null;

    const claim = (decoded as Record<string, unknown>)['organization_id'];

    return typeof claim === 'string' && claim !== '' ? claim : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ the messages

/** The edge, and the only place one of these codes becomes Croatian. */
export function teamWriteMessageKey(
  failure: TeamWriteFailure,
):
  | 'smjene.error.empty'
  | 'smjene.error.taken'
  | 'smjene.error.stale'
  | 'smjene.error.refused'
  | 'smjene.error.invalid'
  | 'smjene.error.saveUnavailable'
  | 'smjene.error.unknown'
  | 'smjene.error.inUse' {
  if (failure === TEAM_NAME_EMPTY) return 'smjene.error.empty';
  if (failure === TEAM_NAME_TAKEN) return 'smjene.error.taken';
  if (failure === TEAM_STALE) return 'smjene.error.stale';
  if (failure === TEAM_WRITE_REFUSED) return 'smjene.error.refused';
  if (failure === TEAM_WRITE_INVALID) return 'smjene.error.invalid';
  if (failure === TEAM_WRITE_UNAVAILABLE) return 'smjene.error.saveUnavailable';
  if (failure === TEAM_UNKNOWN) return 'smjene.error.unknown';
  if (failure === TEAM_IN_USE) return 'smjene.error.inUse';

  const unhandled: never = failure;

  return unhandled;
}

// ------------------------------------------------------ the archive stages

/** The offer stands: one neutral action naming the team. */
export const ARCHIVE_IDLE = 'idle';
/** One press armed the confirmation, which names the team. */
export const ARCHIVE_ARMED = 'armed';
/** The confirmed write is outstanding; the confirmation stays, disabled. */
export const ARCHIVE_BUSY = 'busy';

export type ArchiveStage = typeof ARCHIVE_IDLE | typeof ARCHIVE_ARMED | typeof ARCHIVE_BUSY;

/**
 * Which archive control renders. BUSY wins over everything: the confirmation
 * stays mounted while the write is outstanding, so no enabled control can
 * start a second one.
 */
export function archiveStageOf(armed: boolean, pending: boolean): ArchiveStage {
  if (pending) return ARCHIVE_BUSY;

  return armed ? ARCHIVE_ARMED : ARCHIVE_IDLE;
}

/**
 * What the edit screen renders for the team its route names.
 *
 * `null` team with no refusal while the list loads, and whenever the read has
 * failed — even over cached rows: the screen then shows only the read message,
 * because a form remounted after a landed rename would draw the stale name
 * beside "saved", and a second Save would overwrite the change.
 * {@link TEAM_UNKNOWN} when the answer settled without it.
 */
export interface TeamFormState {
  readonly team: TeamRow | null;
  readonly refusal: typeof TEAM_UNKNOWN | null;
}

export function teamFormStateOf(state: TeamsSurfaceState, id: string): TeamFormState {
  const { teams, loading } = state;

  if (teams === null || state.refusal !== null) return { team: null, refusal: null };

  const team = teamById(teams, id);

  if (team === null && !loading) return { team: null, refusal: TEAM_UNKNOWN };

  return { team, refusal: null };
}

/**
 * The key the rename form is mounted under: the team, and how many renames
 * THIS SCREEN has landed on it.
 *
 * NOT THE NAME. A refused rename followed by a refetch that brings a changed
 * name — somebody else renamed the team meanwhile — would remount a form keyed
 * by the name and throw away what was typed, and a refused save keeps the
 * entered value (UX-DR34). Only a rename that LANDED bumps `renames`, after the
 * re-read, so the field then shows what the database holds.
 */
export function teamFormKey(team: TeamRow, renames: number): string {
  return `${team.id}:${String(renames)}`;
}

/** How many landed renames the form key counts after one write settles. */
export function renamesAfter(renames: number, outcome: TeamWriteOutcome): number {
  return outcome.ok ? renames + 1 : renames;
}

// ---------------------------------------------------- what a save says

/** A rename landed. */
export const TEAM_RENAMED = 'renamed';
/** An archive landed. */
export const TEAM_ARCHIVED = 'archived';

export type TeamSaved = typeof TEAM_RENAMED | typeof TEAM_ARCHIVED;

/**
 * The confirmation a landed write renders. Two writes, two sentences: an
 * archive is not a name being saved, and saying so would describe a change
 * nobody made. Exhaustive.
 */
export function teamSavedMessageKey(saved: TeamSaved): 'smjene.saved' | 'smjene.archivedDone' {
  if (saved === TEAM_RENAMED) return 'smjene.saved';
  if (saved === TEAM_ARCHIVED) return 'smjene.archivedDone';

  const unhandled: never = saved;

  return unhandled;
}
