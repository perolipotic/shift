import type { Session } from '@supabase/supabase-js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { initLocalization, t } from '@/i18n';
import {
  OWN_TEAM_COLUMNS,
  OWN_TEAM_KEY,
  OWN_TEAM_TABLE,
  OWN_TEAM_UNAVAILABLE,
  TEAM_ROSTER_FETCH_PAUSED,
  TEAM_ROSTER_FUNCTION,
  TEAM_ROSTER_KEY,
  TEAM_ROSTER_UNAVAILABLE,
  TEAM_ROSTER_UNKNOWN,
  ownTeamLineMessageKey,
  ownTeamLineOf,
  ownTeamMessageKey,
  ownTeamSnapshotOf,
  ownTeamSurfaceStateOf,
  ownTeamTodayOf,
  readOwnTeamToday,
  readTeamRoster,
  teamRosterMessageKey,
  teamRosterOf,
  teamRosterSurfaceStateOf,
  type OwnTeamAnswer,
  type OwnTeamOutcome,
  type OwnTeamTable,
  type TeamRosterAnswer,
  type TeamRosterOutcome,
  type TeamRosterRpc,
} from '@/teams/roster';

/**
 * Story 1.8's two readings, executed rather than read (AD-15): the roster one
 * team's screen draws, and the caller's own team the Danas line names.
 */

const TEAM = '00000000-0000-4000-8000-0000000000aa';

function rpcAnswering(answer: TeamRosterAnswer | Promise<never>): TeamRosterRpc & {
  readonly calls: unknown[][];
} {
  const calls: unknown[][] = [];

  return {
    calls,
    rpc(...args: unknown[]) {
      calls.push(args);

      return answer instanceof Promise ? answer : Promise.resolve(answer);
    },
  };
}

function rosterRow(members: readonly Record<string, unknown>[], archived = false): Record<string, unknown> {
  return { name: 'Tim 1', archived, members };
}

const SESSION = { access_token: 'token', user: { id: 'auth-user-id' } } as unknown as Session;
const signedIn = (): Promise<Session | null> => Promise.resolve(SESSION);

function ownTableAnswering(answer: OwnTeamAnswer | Promise<never>): OwnTeamTable & {
  readonly calls: unknown[][];
} {
  const calls: unknown[][] = [];

  return {
    calls,
    select(columns: string) {
      calls.push(['select', columns]);

      return {
        filter(column: string, operator: string, value: string) {
          calls.push(['filter', column, operator, value]);

          return {
            limit(count: number) {
              calls.push(['limit', count]);

              return answer instanceof Promise ? answer : Promise.resolve(answer);
            },
          };
        },
      };
    },
  };
}

/** An own row whose one version puts the caller on `team` from `from`. */
function ownRow(
  versions: readonly Record<string, unknown>[],
  timezone = 'UTC',
): Record<string, unknown> {
  return { team_membership_versions: versions, organizations: { timezone } };
}

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the roster read', () => {
  it('calls one function with the team, under one key per team', async () => {
    const client = rpcAnswering({ data: [rosterRow([])], error: null });

    await readTeamRoster(client, TEAM);

    expect(TEAM_ROSTER_FUNCTION).toBe('team_roster');
    expect(client.calls).toEqual([['team_roster', { team: TEAM }]]);
    expect(TEAM_ROSTER_KEY(TEAM)).toEqual(['team-roster', TEAM]);
    expect(TEAM_ROSTER_KEY('a')).not.toEqual(TEAM_ROSTER_KEY('b'));
  });

  it('sorts names under the Croatian collation, tie-broken by id', async () => {
    const outcome = await readTeamRoster(
      rpcAnswering({
        data: [
          rosterRow([
            { id: 'c', name: 'Zrinka', fire_rank: null, position: null },
            { id: 'b', name: 'Čedo', fire_rank: null, position: null },
            { id: 'z', name: 'Ana', fire_rank: null, position: null },
            { id: 'a', name: 'Ana', fire_rank: 'nco', position: null },
            { id: 'd', name: 'Cvita', fire_rank: null, position: null },
          ]),
        ],
        error: null,
      }),
      TEAM,
    );

    // `č` sorts after `c` in Croatian, not after `z` as code points would put it.
    expect(outcome.ok && outcome.roster.members.map((member) => member.id)).toEqual([
      'a',
      'z',
      'd',
      'b',
      'c',
    ]);
  });

  it('answers an empty team and an archived team with their flag and nobody', async () => {
    expect(await readTeamRoster(rpcAnswering({ data: [rosterRow([])], error: null }), TEAM)).toEqual({
      ok: true,
      roster: { name: 'Tim 1', archived: false, members: [] },
    });
    expect(
      await readTeamRoster(rpcAnswering({ data: [rosterRow([], true)], error: null }), TEAM),
    ).toEqual({ ok: true, roster: { name: 'Tim 1', archived: true, members: [] } });
  });

  it('carries id, name and rank off each member and nothing else', () => {
    const roster = teamRosterOf(
      rosterRow([{ id: 'a', name: 'Ana', fire_rank: 'nco', position: null, email: 'ana@example.invalid' }]),
    );

    expect(roster?.members).toEqual([{ id: 'a', name: 'Ana', fireRank: 'nco', position: null }]);
    expect(Object.keys(roster?.members[0] ?? {}).sort()).toEqual([
      'fireRank',
      'id',
      'name',
      'position',
    ]);
  });

  it('carries the position today, none as null, and a code this build lacks as itself', () => {
    // TEAM POSITION. As the rank: an unknown code is the surface's to label.
    const roster = teamRosterOf(
      rosterRow([
        { id: 'a', name: 'Ana', fire_rank: null, position: 'driver' },
        { id: 'b', name: 'Bruno', fire_rank: null, position: null },
        { id: 'c', name: 'Cvita', fire_rank: null, position: 'chief' },
      ]),
    );

    expect(roster?.members.map((member) => member.position)).toEqual(['driver', null, 'chief']);
  });

  it('refuses a roster whose member lacks a position or carries a non-text one', () => {
    // PRESENT, as text or null: `0015` always writes the key.
    expect(teamRosterOf(rosterRow([{ id: 'a', name: 'Ana', fire_rank: null }]))).toBeNull();
    expect(
      teamRosterOf(rosterRow([{ id: 'a', name: 'Ana', fire_rank: null, position: 3 }])),
    ).toBeNull();
  });

  it('carries no rank as null, and a code this build lacks as itself', () => {
    // MEMBER RANK. An unknown code is the surface's to label, never a reason to
    // refuse the whole roster.
    const roster = teamRosterOf(
      rosterRow([
        { id: 'a', name: 'Ana', fire_rank: null, position: null },
        { id: 'b', name: 'Bruno', fire_rank: 'marshal', position: null },
      ]),
    );

    expect(roster?.members.map((member) => member.fireRank)).toEqual([null, 'marshal']);
  });

  it.each(['abc', '', 'smjene', `${TEAM}x`, TEAM.replaceAll('-', '')])(
    'answers %j unknown without calling the database, since it is no uuid',
    async (id) => {
      const client = rpcAnswering({ data: [rosterRow([])], error: null });

      expect(await readTeamRoster(client, id)).toEqual({ ok: false, code: TEAM_ROSTER_UNKNOWN });
      expect(client.calls).toEqual([]);
    },
  );

  it('names zero rows unknown — another organization or a team that never existed', async () => {
    expect(await readTeamRoster(rpcAnswering({ data: [], error: null }), TEAM)).toEqual({
      ok: false,
      code: TEAM_ROSTER_UNKNOWN,
    });
  });

  it('refuses an erroring, rejected, malformed or doubled answer as unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unavailable = { ok: false, code: TEAM_ROSTER_UNAVAILABLE };

    for (const answer of [
      { data: null, error: { code: '42501' } },
      { data: null, error: null },
      { data: 'rows', error: null },
      { data: [rosterRow([]), rosterRow([])], error: null },
      { data: [{ name: 'Tim 1', archived: 'no', members: [] }], error: null },
      { data: [{ name: 7, archived: false, members: [] }], error: null },
      { data: [{ name: 'Tim 1', archived: false, members: null }], error: null },
      { data: [rosterRow([{ id: 'a' }])], error: null },
      { data: [rosterRow([{ id: 1, name: 'Ana', fire_rank: null }])], error: null },
      // MEMBER RANK: the rank must be present, as text or null.
      { data: [rosterRow([{ id: 'a', name: 'Ana' }])], error: null },
      { data: [rosterRow([{ id: 'a', name: 'Ana', fire_rank: 3 }])], error: null },
      { data: [rosterRow(['Ana' as unknown as Record<string, unknown>])], error: null },
      {
        data: [
          rosterRow([
            { id: 'a', name: 'Ana', fire_rank: null, position: null },
            { id: 'a', name: 'Ana', fire_rank: null, position: null },
          ]),
        ],
        error: null,
      },
    ]) {
      expect(await readTeamRoster(rpcAnswering(answer), TEAM), JSON.stringify(answer)).toEqual(
        unavailable,
      );
    }
    expect(await readTeamRoster(rpcAnswering(Promise.reject(new Error('offline'))), TEAM)).toEqual(
      unavailable,
    );
    expect(
      await readTeamRoster(
        { rpc: () => Promise.resolve('not an answer' as unknown as TeamRosterAnswer) },
        TEAM,
      ),
    ).toEqual(unavailable);
  });
});

describe('the roster screen state and messages', () => {
  const good: TeamRosterOutcome = {
    ok: true,
    roster: {
      name: 'Tim 1',
      archived: false,
      members: [{ id: 'a', name: 'Ana', fireRank: null, position: null }],
    },
  };

  it('distinguishes answered, failed, paused, refetch-failed and loading', () => {
    const base = { isPending: false, isError: false, fetchStatus: 'idle' };

    expect(teamRosterSurfaceStateOf({ ...base, data: good })).toEqual({
      roster: good.ok ? good.roster : null,
      refusal: null,
      loading: false,
    });
    expect(
      teamRosterSurfaceStateOf({ ...base, data: { ok: false, code: TEAM_ROSTER_UNKNOWN } }),
    ).toEqual({ roster: null, refusal: TEAM_ROSTER_UNKNOWN, loading: false });
    expect(
      teamRosterSurfaceStateOf({
        isPending: true,
        isError: false,
        fetchStatus: TEAM_ROSTER_FETCH_PAUSED,
        data: undefined,
      }),
    ).toEqual({ roster: null, refusal: TEAM_ROSTER_UNAVAILABLE, loading: false });
    expect(teamRosterSurfaceStateOf({ ...base, isError: true, data: good })).toEqual({
      roster: good.ok ? good.roster : null,
      refusal: TEAM_ROSTER_UNAVAILABLE,
      loading: false,
    });
    expect(
      teamRosterSurfaceStateOf({ isPending: true, isError: false, fetchStatus: 'fetching', data: undefined }),
    ).toEqual({ roster: null, refusal: null, loading: true });
  });

  it('maps each failure to its own sentence, and unknown to the named one', () => {
    expect(teamRosterMessageKey(TEAM_ROSTER_UNKNOWN)).toBe('smjene.error.unknown');
    expect(teamRosterMessageKey(TEAM_ROSTER_UNAVAILABLE)).toBe('smjene.roster.error.unavailable');
    expect(t(teamRosterMessageKey(TEAM_ROSTER_UNKNOWN))).not.toBe(
      t(teamRosterMessageKey(TEAM_ROSTER_UNAVAILABLE)),
    );
  });

  it.each([
    [0, '0 osoba'],
    [1, '1 osoba'],
    [2, '2 osobe'],
    [4, '4 osobe'],
    [5, '5 osoba'],
    [21, '21 osoba'],
    [22, '22 osobe'],
  ])('states %i people with the ICU plural', (count, expected) => {
    expect(t('smjene.roster.count', { count })).toBe(expected);
  });
});

describe('the caller\'s own team today', () => {
  it('reads the own row by auth_user_id, asking for one row more than it takes', async () => {
    const table = ownTableAnswering({ data: [ownRow([])], error: null });

    await readOwnTeamToday(table, signedIn);

    expect(OWN_TEAM_TABLE).toBe('members');
    expect(OWN_TEAM_KEY).toEqual(['own-team']);
    expect(OWN_TEAM_COLUMNS).toBe(
      'team_membership_versions(team_id,position,effective_from,teams(name)),organizations(timezone)',
    );
    expect(table.calls).toEqual([
      ['select', OWN_TEAM_COLUMNS],
      ['filter', 'auth_user_id', 'eq', 'auth-user-id'],
      ['limit', 2],
    ]);
  });

  it('derives the team as at the organization today, through the list derivation', async () => {
    const now = new Date('2026-09-25T12:00:00Z');
    const outcome = await readOwnTeamToday(
      ownTableAnswering({
        data: [
          ownRow([
            { team_id: 'b', position: null, effective_from: '2026-09-26', teams: { name: 'Tim B' } },
            { team_id: 'a', position: null, effective_from: '2026-09-01', teams: { name: 'Tim A' } },
          ]),
        ],
        error: null,
      }),
      signedIn,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Scheduled onto B tomorrow: A today.
    expect(ownTeamTodayOf(outcome.snapshot, now)).toEqual({ id: 'a', name: 'Tim A' });
  });

  it('reads today in the organization zone, never UTC', () => {
    // 23:30 UTC on the 25th is already the 26th fourteen hours ahead.
    const now = new Date('2026-09-25T23:30:00Z');
    const versions = [{ team_id: 'a', position: null, effective_from: '2026-09-26', teams: { name: 'Tim A' } }];
    const ahead = ownTeamSnapshotOf(ownRow(versions, 'Pacific/Kiritimati'));
    const utc = ownTeamSnapshotOf(ownRow(versions, 'UTC'));

    expect(ahead === null ? 'refused' : ownTeamTodayOf(ahead, now)).toEqual({ id: 'a', name: 'Tim A' });
    expect(utc === null ? 'refused' : ownTeamTodayOf(utc, now)).toBeNull();
  });

  it('says no team in words, never as a blank', () => {
    expect(ownTeamLineMessageKey(ownTeamLineOf(null))).toBe('smjene.membership.none');
    expect(t(ownTeamLineMessageKey(ownTeamLineOf(null)))).toBe('Bez smjene');
    expect(ownTeamLineOf({ id: 'a', name: 'Tim A' })).toEqual({ team: { id: 'a', name: 'Tim A' } });
    expect(ownTeamLineMessageKey(ownTeamLineOf({ id: 'a', name: 'Tim A' }))).toBe(
      'smjene.today.label',
    );
    expect(t('smjene.today.label')).toBe('Tvoja smjena');
  });

  it('draws the line for no version and for a no-team version alike', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    const base = { isPending: false, isError: false, fetchStatus: 'idle' };
    const none = { ok: true, snapshot: { teamVersions: [], timeZone: 'UTC' } } as const;
    const left: OwnTeamOutcome = {
      ok: true,
      snapshot: {
        teamVersions: [
          { team: { id: 'a', name: 'Tim A' }, position: null, effectiveFrom: '2026-09-01' },
          { team: null, position: null, effectiveFrom: '2026-09-20' },
        ],
        timeZone: 'UTC',
      },
    };

    for (const outcome of [none, left]) {
      expect(ownTeamSurfaceStateOf({ ...base, data: outcome }, now)).toEqual({
        line: { team: null },
        refusal: null,
        loading: false,
      });
    }
    expect(
      ownTeamSurfaceStateOf({ ...base, data: { ok: false, code: OWN_TEAM_UNAVAILABLE } }, now),
    ).toEqual({ line: null, refusal: OWN_TEAM_UNAVAILABLE, loading: false });
    expect(
      ownTeamSurfaceStateOf(
        { isPending: true, isError: false, fetchStatus: TEAM_ROSTER_FETCH_PAUSED, data: undefined },
        now,
      ),
    ).toEqual({ line: null, refusal: OWN_TEAM_UNAVAILABLE, loading: false });
    expect(
      ownTeamSurfaceStateOf(
        { isPending: true, isError: false, fetchStatus: 'fetching', data: undefined },
        now,
      ),
    ).toEqual({ line: null, refusal: null, loading: true });
    expect(ownTeamMessageKey(OWN_TEAM_UNAVAILABLE)).toBe('smjene.today.error.unavailable');
  });

  it('refuses no session, an error, a rejection, zero or two rows, or a malformed row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unavailable = { ok: false, code: OWN_TEAM_UNAVAILABLE };

    expect(
      await readOwnTeamToday(ownTableAnswering({ data: [ownRow([])], error: null }), () =>
        Promise.resolve(null),
      ),
    ).toEqual(unavailable);
    expect(
      await readOwnTeamToday(ownTableAnswering({ data: [ownRow([])], error: null }), () =>
        Promise.reject(new Error('SecurityError')),
      ),
    ).toEqual(unavailable);
    for (const answer of [
      { data: null, error: { code: '42703' } },
      { data: [], error: null },
      { data: null, error: null },
      { data: [ownRow([]), ownRow([])], error: null },
      { data: [{ team_membership_versions: [] }], error: null },
      { data: [{ organizations: { timezone: 'UTC' } }], error: null },
      { data: [ownRow([{ team_id: 'a', effective_from: '2026-09-01' }])], error: null },
      { data: [ownRow([{ team_id: 'a', effective_from: 'soon', teams: { name: 'A' } }])], error: null },
    ]) {
      expect(await readOwnTeamToday(ownTableAnswering(answer), signedIn), JSON.stringify(answer)).toEqual(
        unavailable,
      );
    }
    expect(
      await readOwnTeamToday(ownTableAnswering(Promise.reject(new Error('offline'))), signedIn),
    ).toEqual(unavailable);
  });
});
