import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { initLocalization, t } from '@/i18n';
import {
  TEAMS_COLUMNS,
  TEAMS_COUNT,
  TEAMS_FETCH_PAUSED,
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  TEAMS_UNAVAILABLE,
  readTeams,
  splitTeams,
  teamById,
  teamActionMessageKey,
  teamHeadingMessageKey,
  teamRowOf,
  teamsMessageKey,
  teamsSurfaceStateOf,
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

describe('the surface state', () => {
  const answered = { ok: true as const, teams: [] };

  it('pulses while pending and says nothing', () => {
    expect(
      teamsSurfaceStateOf({ isPending: true, isError: false, fetchStatus: 'fetching', data: undefined }),
    ).toEqual({ teams: null, refusal: null, loading: true });
  });

  it('draws an answer, an empty one included', () => {
    expect(
      teamsSurfaceStateOf({ isPending: false, isError: false, fetchStatus: 'idle', data: answered }),
    ).toEqual({ teams: [], refusal: null, loading: false });
  });

  it('shows the message for a failed read, a thrown one and a paused one', () => {
    const failed = { ok: false as const, code: TEAMS_UNAVAILABLE } as const;

    expect(
      teamsSurfaceStateOf({ isPending: false, isError: false, fetchStatus: 'idle', data: failed }),
    ).toEqual({ teams: null, refusal: TEAMS_UNAVAILABLE, loading: false });
    expect(
      teamsSurfaceStateOf({ isPending: false, isError: true, fetchStatus: 'idle', data: undefined }),
    ).toEqual({ teams: null, refusal: TEAMS_UNAVAILABLE, loading: false });
    expect(
      teamsSurfaceStateOf({
        isPending: true,
        isError: false,
        fetchStatus: TEAMS_FETCH_PAUSED,
        data: undefined,
      }),
    ).toEqual({ teams: null, refusal: TEAMS_UNAVAILABLE, loading: false });
  });

  it('keeps a good answer beside a failed refetch', () => {
    expect(
      teamsSurfaceStateOf({ isPending: false, isError: true, fetchStatus: 'idle', data: answered }),
    ).toEqual({ teams: [], refusal: TEAMS_UNAVAILABLE, loading: false });
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
