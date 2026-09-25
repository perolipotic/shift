import {
  QueryClient,
  QueryObserver,
  environmentManager,
  onlineManager,
} from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initLocalization, t } from '@/i18n';
import { teamFormStateOf } from '@/teams/write';
import {
  TEAMS_COLUMNS,
  TEAMS_COUNT,
  TEAMS_FETCH_PAUSED,
  TEAMS_LIST_KEY,
  TEAMS_READ_STALE_MS,
  TEAMS_TABLE,
  TEAMS_UNAVAILABLE,
  readTeams,
  splitTeams,
  teamById,
  teamActionMessageKey,
  teamHeadingMessageKey,
  teamRowOf,
  teamsMessageKey,
  teamsQueryOptions,
  teamsSurfaceStateOf,
  writableTeamsOf,
  type TeamRow,
  type TeamsAnswer,
  type TeamsTable,
} from '@/teams/list';

/**
 * Story 1.7a's list half, executed rather than read (AD-15).
 *
 * ANY COUNT (DI-8): every count below is produced by one generator and one
 * path, and no case names a particular number of teams as special.
 */

const ORGANIZATION = '00000000-0000-4000-8000-000000000001';
const OTHER_ORGANIZATION = '00000000-0000-4000-8000-000000000002';

/** `count` teams, named by their position, the given ones archived. */
function rows(count: number, archivedEvery = 0): Record<string, unknown>[] {
  return Array.from({ length: count }, (_value, index) => ({
    organization_id: ORGANIZATION,
    id: `team-${String(index).padStart(3, '0')}`,
    name: `Tim ${String(index + 1)}`,
    archived: archivedEvery > 0 && index % archivedEvery === 0,
  }));
}

function tableAnswering(answer: TeamsAnswer | Promise<never>): TeamsTable & {
  readonly calls: unknown[][];
} {
  const calls: unknown[][] = [];

  return {
    calls,
    select(...args: unknown[]) {
      calls.push(args);

      return answer instanceof Promise ? answer : Promise.resolve(answer);
    },
  };
}

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the team read', () => {
  it('names one table, one key, and selects the tenant it checks', () => {
    expect(TEAMS_TABLE).toBe('teams');
    expect(TEAMS_LIST_KEY).toEqual(['teams']);
    expect(TEAMS_COLUMNS.split(',')).toEqual(['organization_id', 'id', 'name', 'archived']);
    expect(TEAMS_COUNT).toEqual({ count: 'exact' });
  });

  it.each([0, 1, 4, 9])('reads %i teams through the same call', async (count) => {
    const table = tableAnswering({ data: rows(count), error: null, count });
    const outcome = await readTeams(table);

    expect(table.calls).toEqual([[TEAMS_COLUMNS, TEAMS_COUNT]]);
    expect(outcome.ok && outcome.teams.length).toBe(count);
  });

  it('answers zero rows as an empty list, never as a refusal', async () => {
    // An organization may run no teams at all; the screen says `0 smjena`.
    expect(await readTeams(tableAnswering({ data: [], error: null, count: 0 }))).toEqual({
      ok: true,
      teams: [],
    });
    expect(await readTeams(tableAnswering({ data: null, error: null, count: null }))).toEqual({
      ok: true,
      teams: [],
    });
  });

  it('returns an archived team unchanged, flag and all', async () => {
    const archived = { organization_id: ORGANIZATION, id: 'a', name: 'Stari tim', archived: true };
    const outcome = await readTeams(tableAnswering({ data: [archived], error: null, count: 1 }));

    expect(outcome).toEqual({
      ok: true,
      teams: [{ id: 'a', organizationId: ORGANIZATION, name: 'Stari tim', archived: true }],
    });
  });

  it('refuses a truncated, malformed, erroring, rejected or cross-tenant answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unavailable = { ok: false, code: TEAMS_UNAVAILABLE };

    expect(await readTeams(tableAnswering({ data: rows(2), error: null, count: 3 }))).toEqual(
      unavailable,
    );
    expect(
      await readTeams(tableAnswering({ data: [{ id: 'x' }], error: null, count: 1 })),
    ).toEqual(unavailable);
    expect(
      await readTeams(tableAnswering({ data: null, error: { code: '42P01' }, count: null })),
    ).toEqual(unavailable);
    expect(await readTeams(tableAnswering(Promise.reject(new Error('offline'))))).toEqual(
      unavailable,
    );
    expect(
      await readTeams(
        tableAnswering({
          data: [...rows(1), { ...rows(1)[0], id: 'other', organization_id: OTHER_ORGANIZATION }],
          error: null,
          count: 2,
        }),
      ),
    ).toEqual(unavailable);
    expect(
      await readTeams({ select: () => Promise.resolve('not an answer' as unknown as TeamsAnswer) }),
    ).toEqual(unavailable);
  });
});

describe('a team row validates field by field', () => {
  const good = { organization_id: ORGANIZATION, id: 'a', name: 'A', archived: false };

  it('admits a well-formed row', () => {
    expect(teamRowOf(good)).toEqual({ id: 'a', organizationId: ORGANIZATION, name: 'A', archived: false });
  });

  it.each([
    ['not an object', 'row'],
    ['an array', []],
    ['null', null],
    ['no id', { ...good, id: undefined }],
    ['no organization', { ...good, organization_id: 7 }],
    ['no name', { ...good, name: null }],
    ['a flag that is not a boolean', { ...good, archived: 'false' }],
  ])('refuses %s', (_what, row) => {
    expect(teamRowOf(row)).toBeNull();
  });
});

describe('the list splits into active and archived, and any count is just a count', () => {
  it.each([0, 1, 4, 9])('splits and counts %i teams on one path', (count) => {
    const teams = rows(count, 3).map((row) => teamRowOf(row)).filter((row) => row !== null);
    const split = splitTeams(teams);

    expect(split.active.length + split.archived.length).toBe(count);
    expect(split.active.every((team) => !team.archived)).toBe(true);
    expect(split.archived.every((team) => team.archived)).toBe(true);
  });

  it('sorts each group by name under the Croatian collation', () => {
    const team = (id: string, name: string, archived = false): TeamRow => ({
      id,
      organizationId: ORGANIZATION,
      name,
      archived,
    });
    const split = splitTeams([
      team('1', 'Čvor'),
      team('2', 'Cesta'),
      team('3', 'Zora', true),
      team('4', 'Ana', true),
      team('5', 'Dvor'),
    ]);

    expect(split.active.map((entry) => entry.name)).toEqual(['Cesta', 'Čvor', 'Dvor']);
    expect(split.archived.map((entry) => entry.name)).toEqual(['Ana', 'Zora']);
  });

  it('finds a team by id, and nothing for an id it does not hold', () => {
    const teams = rows(3).map((row) => teamRowOf(row)).filter((row) => row !== null);

    expect(teamById(teams, 'team-001')?.name).toBe('Tim 2');
    expect(teamById(teams, 'missing')).toBeNull();
  });
});

describe('the counts read in words, with the plural each count takes', () => {
  it.each([
    [0, '0 smjena'],
    [1, '1 smjena'],
    [2, '2 smjene'],
    [4, '4 smjene'],
    [5, '5 smjena'],
    [9, '9 smjena'],
    [21, '21 smjena'],
    [22, '22 smjene'],
  ])('renders %i teams as %s', (count, expected) => {
    expect(t('smjene.count', { count })).toBe(expected);
  });

  it.each([
    [0, 'Arhivirano: 0 smjena'],
    [1, 'Arhivirano: 1 smjena'],
    [4, 'Arhivirano: 4 smjene'],
    [9, 'Arhivirano: 9 smjena'],
  ])('renders %i archived teams as %s', (count, expected) => {
    expect(t('smjene.archivedCount', { count })).toBe(expected);
  });
});

describe('the surface state, driven through the one query definition', () => {
  /**
   * A REAL `QueryClient` and `QueryObserver`, never a hand-built result: the
   * defect this pins — a failed refetch replacing a good cached list — lived in
   * how TanStack Query treats a resolved failure versus a rejected one, which a
   * fixture cannot reproduce. Only `retryDelay` is overridden; `retry` is the
   * factory's own `1`. Node counts as a server, where TanStack forces `retry`
   * to 0, so the environment is told it is a browser for these cases.
   */
  const wasServer = environmentManager.isServer();
  const good = { data: rows(3), error: null, count: 3 };
  const truncated = { data: rows(2), error: null, count: 3 };
  let client: QueryClient;
  let unsubscribes: (() => void)[];

  beforeAll(() => {
    environmentManager.setIsServer(() => false);
  });

  afterAll(() => {
    environmentManager.setIsServer(() => wasServer);
  });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    client = new QueryClient();
    unsubscribes = [];
  });

  afterEach(() => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    client.clear();
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  /** A table answering each call with the next answer, the last one for ever. */
  function answeringInTurn(...answers: TeamsAnswer[]): TeamsTable & { readonly calls: () => number } {
    let calls = 0;

    return {
      calls: () => calls,
      select() {
        const answer = answers[Math.min(calls, answers.length - 1)];

        calls += 1;

        return Promise.resolve(answer as TeamsAnswer);
      },
    };
  }

  function observe(table: () => TeamsTable) {
    const observer = new QueryObserver(client, { ...teamsQueryOptions(table), retryDelay: 0 });

    unsubscribes.push(observer.subscribe(() => undefined));

    return observer;
  }

  async function settled(observer: ReturnType<typeof observe>) {
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().fetchStatus).toBe('idle');
    });

    return observer.getCurrentResult();
  }

  const goodTeams: readonly TeamRow[] = good.data.flatMap((row) => {
    const team = teamRowOf(row);

    return team === null ? [] : [team];
  });

  it('keeps today\'s key and cache bound', () => {
    const options = teamsQueryOptions(() => answeringInTurn(good));

    expect(options.queryKey).toEqual(TEAMS_LIST_KEY);
    expect(options.staleTime).toBe(TEAMS_READ_STALE_MS);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.retry).toBe(1);
    expect(options.retryDelay).toBe(1000);
  });

  it('pulses while the first read is in flight and says nothing', () => {
    const observer = observe(() => answeringInTurn(good));

    expect(teamsSurfaceStateOf(observer.getCurrentResult())).toEqual({
      teams: null,
      refusal: null,
      loading: true,
    });
  });

  it.each([0, 3])('draws a first answer of %i teams', async (count) => {
    const result = await settled(
      observe(() => answeringInTurn({ data: rows(count), error: null, count })),
    );

    expect(result.status).toBe('success');
    expect(teamsSurfaceStateOf(result)).toEqual({
      teams: rows(count).map((row) => teamRowOf(row)),
      refusal: null,
      loading: false,
    });
  });

  it('retries an unavailable first read, then shows the message and no rows', async () => {
    const table = answeringInTurn(truncated);
    const result = await settled(observe(() => table));

    expect(table.calls(), 'the unavailable read was not retried exactly once').toBe(2);
    expect(result.status).toBe('error');
    expect(result.data).toBeUndefined();
    expect(teamsSurfaceStateOf(result)).toEqual({
      teams: null,
      refusal: TEAMS_UNAVAILABLE,
      loading: false,
    });
  });

  it('keeps the rows beside the message when a refetch is unavailable', async () => {
    // The write's `invalidateQueries`, then a blip: the list stays on screen.
    const table = answeringInTurn(good, truncated);
    const observer = observe(() => table);

    await settled(observer);
    await client.invalidateQueries({ queryKey: TEAMS_LIST_KEY });
    const result = await settled(observer);

    expect(table.calls(), 'the unavailable refetch was not retried exactly once').toBe(3);
    expect(result.isError).toBe(true);
    expect(teamsSurfaceStateOf(result)).toEqual({
      teams: goodTeams,
      refusal: TEAMS_UNAVAILABLE,
      loading: false,
    });
  });

  it('hides the edit form, and names nothing, when a refetch fails over good rows', async () => {
    // Through the real cache and the same two calls the edit screen makes: the
    // cached rows stay on the surface, and the form gate still withholds the form.
    const table = answeringInTurn(good, truncated);
    const observer = observe(() => table);

    await settled(observer);
    expect(teamFormStateOf(teamsSurfaceStateOf(observer.getCurrentResult()), 'team-000').team).not.toBeNull();
    await client.invalidateQueries({ queryKey: TEAMS_LIST_KEY });
    const state = teamsSurfaceStateOf(await settled(observer));

    expect(state.teams).toEqual(goodTeams);
    expect(teamFormStateOf(state, 'team-000')).toEqual({ team: null, refusal: null });
  });

  it('withholds the teams a write may use when a refetch fails over good rows', async () => {
    // The member screen's picker and team actions: the rows stay drawable, but
    // nothing is written from a list the read now says it cannot vouch for.
    const table = answeringInTurn(good, truncated);
    const observer = observe(() => table);

    expect(writableTeamsOf(teamsSurfaceStateOf(await settled(observer)))).toEqual(goodTeams);
    await client.invalidateQueries({ queryKey: TEAMS_LIST_KEY });
    const state = teamsSurfaceStateOf(await settled(observer));

    expect(state.teams).toEqual(goodTeams);
    expect(writableTeamsOf(state)).toBeNull();
  });

  it('offers the teams to write from only while the read is healthy', () => {
    expect(writableTeamsOf({ teams: goodTeams, refusal: null, loading: false })).toEqual(goodTeams);
    expect(writableTeamsOf({ teams: [], refusal: null, loading: false })).toEqual([]);
    expect(writableTeamsOf({ teams: null, refusal: null, loading: true })).toBeNull();
    expect(writableTeamsOf({ teams: goodTeams, refusal: TEAMS_UNAVAILABLE, loading: false })).toBeNull();
    expect(writableTeamsOf({ teams: null, refusal: TEAMS_UNAVAILABLE, loading: false })).toBeNull();
  });

  it('settles as a success when a transient failure is followed by an answer', async () => {
    const table = answeringInTurn(truncated, good);
    const result = await settled(observe(() => table));

    expect(table.calls()).toBe(2);
    expect(result.status).toBe('success');
    expect(teamsSurfaceStateOf(result)).toEqual({ teams: goodTeams, refusal: null, loading: false });
  });

  it('rejects when the table cannot even be built', async () => {
    // `supabaseClient()` raising `SUPABASE_ENVIRONMENT_MISSING`, resolved
    // inside the query function so it is a query rejection like any other.
    const result = await settled(
      observe(() => {
        throw new Error('SUPABASE_ENVIRONMENT_MISSING');
      }),
    );

    expect(result.isError).toBe(true);
    expect(teamsSurfaceStateOf(result)).toEqual({
      teams: null,
      refusal: TEAMS_UNAVAILABLE,
      loading: false,
    });
  });

  it('says why rather than pulsing while paused offline', () => {
    onlineManager.setOnline(false);
    const result = observe(() => answeringInTurn(good)).getCurrentResult();

    expect(result.isPending).toBe(true);
    expect(result.fetchStatus).toBe(TEAMS_FETCH_PAUSED);
    expect(teamsSurfaceStateOf(result)).toEqual({
      teams: null,
      refusal: TEAMS_UNAVAILABLE,
      loading: false,
    });
  });

  it('never pulses a skeleton beside a message', () => {
    for (const isError of [true, false]) {
      for (const isPending of [true, false]) {
        for (const fetchStatus of ['idle', 'fetching', TEAMS_FETCH_PAUSED]) {
          for (const data of [undefined, [], goodTeams]) {
            const state = teamsSurfaceStateOf({ isPending, isError, fetchStatus, data });

            expect(state.loading && state.refusal !== null).toBe(false);
          }
        }
      }
    }
  });

  it('maps its one failure to its own message', () => {
    expect(teamsMessageKey(TEAMS_UNAVAILABLE)).toBe('smjene.error.unavailable');
  });
});

describe('an archived team is viewed, never edited', () => {
  const active: TeamRow = { id: 'a', organizationId: ORGANIZATION, name: 'A', archived: false };
  const archived: TeamRow = { ...active, archived: true };

  it('lists an active team to edit and an archived one to view', () => {
    expect(teamActionMessageKey(active)).toBe('smjene.edit');
    expect(teamActionMessageKey(archived)).toBe('smjene.view');
  });

  it('heads the screen by the same rule, and as an edit while the team is unknown', () => {
    expect(teamHeadingMessageKey(active)).toBe('smjene.editHeading');
    expect(teamHeadingMessageKey(archived)).toBe('smjene.viewHeading');
    expect(teamHeadingMessageKey(null)).toBe('smjene.editHeading');
  });
});
