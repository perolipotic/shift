import { describe, expect, it } from 'vitest';

import {
  DIRECTORY_ANSWERED,
  DIRECTORY_LOADING,
  DIRECTORY_READ_ANSWERED,
  DIRECTORY_READ_FAILED,
  DIRECTORY_READ_LOADING,
  DIRECTORY_UNAVAILABLE,
  directoryReadOf,
  directoryRetryOf,
  memberDirectoryOf,
  ownTeamIdReadOf,
  type DirectoryRead,
  type MemberDirectory,
} from '@/features/teams/services/directory';
import type { TeamRow } from '@/features/teams/services/list';
import {
  OWN_TEAM_UNAVAILABLE,
  TEAM_ROSTER_FETCH_PAUSED,
  TEAM_ROSTER_UNAVAILABLE,
  TEAM_ROSTER_UNKNOWN,
  type OwnTeamOutcome,
  type TeamRosterMember,
  type TeamRosterOutcome,
} from '@/features/teams/services/roster';

/**
 * Story 7.17's directory, executed (AD-15): every row of the spec's I/O matrix
 * is a case here, over the same reads the hook composes.
 */

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const ARCHIVED = '00000000-0000-4000-8000-00000000000d';

function team(id: string, name: string, archived = false): TeamRow {
  return { id, organizationId: 'org', name, archived };
}

function member(id: string, name: string, fireRank: string | null = null, position: string | null = null): TeamRosterMember {
  return { id, name, fireRank, position };
}

function answered<T>(value: T): DirectoryRead<T> {
  return { state: DIRECTORY_READ_ANSWERED, value };
}

const LOADING = { state: DIRECTORY_READ_LOADING } as const;
const FAILED = { state: DIRECTORY_READ_FAILED } as const;

function roster(name: string, members: readonly TeamRosterMember[], archived = false): DirectoryRead<TeamRosterOutcome> {
  return answered({ ok: true, roster: { name, archived, members } });
}

const TEAMS = answered([team(C, 'Smjena C'), team(A, 'Smjena A'), team(B, 'Smjena B'), team(ARCHIVED, 'Stara', true)]);

const ROSTERS = new Map<string, DirectoryRead<TeamRosterOutcome>>([
  [A, roster('Smjena A', [member('a1', 'Ana Anić', 'firefighter', 'driver'), member('a2', 'Ivo Ivić')])],
  [B, roster('Smjena B', [member('b1', 'Đuro Đurić'), member('b2', 'Marko Marić')])],
  [C, roster('Smjena C', [])],
  [ARCHIVED, roster('Stara', [member('x1', 'Ana Arhivska')], true)],
]);

/** The answered directory's groups as `name: member ids`, or the kind. */
function shape(directory: MemberDirectory): unknown {
  if (directory.kind !== DIRECTORY_ANSWERED) return directory.kind;

  return directory.groups.map((group) => `${group.name}${group.own ? ' (own)' : ''}: ${group.members.map((one) => one.id).join(',')}`);
}

describe('the directory groups today\'s members by team (story 7.17)', () => {
  it('puts the caller\'s own team first and marks it, then the rest by name', () => {
    expect(shape(memberDirectoryOf(TEAMS, ROSTERS, answered(B), ''))).toEqual([
      'Smjena B (own): b1,b2',
      'Smjena A: a1,a2',
      'Smjena C: ',
    ]);
  });

  it('marks no group when the caller is on no team today', () => {
    expect(shape(memberDirectoryOf(TEAMS, ROSTERS, answered(null), ''))).toEqual([
      'Smjena A: a1,a2',
      'Smjena B: b1,b2',
      'Smjena C: ',
    ]);
  });

  it('keeps a team with nobody today, with its zero', () => {
    const directory = memberDirectoryOf(TEAMS, ROSTERS, answered(null), '');

    expect(directory.kind === DIRECTORY_ANSWERED && directory.groups.find((group) => group.id === C)?.members).toEqual([]);
  });

  it('never lists an archived team, by the list\'s flag or the roster\'s', () => {
    const lateArchive = new Map(ROSTERS);

    lateArchive.set(C, roster('Smjena C', [], true));

    expect(shape(memberDirectoryOf(TEAMS, lateArchive, answered(null), ''))).toEqual([
      'Smjena A: a1,a2',
      'Smjena B: b1,b2',
    ]);
  });

  it('keeps members in roster order and carries the rank and position through', () => {
    const directory = memberDirectoryOf(TEAMS, ROSTERS, answered(null), '');

    expect(directory.kind === DIRECTORY_ANSWERED && directory.groups[0]?.members[0]).toEqual(
      member('a1', 'Ana Anić', 'firefighter', 'driver'),
    );
  });

  it('marks nothing when the own team is not an active team', () => {
    expect(shape(memberDirectoryOf(TEAMS, ROSTERS, answered(ARCHIVED), ''))).toEqual([
      'Smjena A: a1,a2',
      'Smjena B: b1,b2',
      'Smjena C: ',
    ]);
  });

  it('states no groups at all for an organization with no active team', () => {
    expect(memberDirectoryOf(answered([]), new Map(), answered(null), '')).toEqual({
      kind: DIRECTORY_ANSWERED,
      groups: [],
      searched: false,
    });
  });
});

describe('the search matches names only, and hides teams with no hit', () => {
  it('shows only the teams holding a hit, with the matching names', () => {
    expect(shape(memberDirectoryOf(TEAMS, ROSTERS, answered(B), 'ana'))).toEqual(['Smjena A: a1']);
  });

  it('folds diacritics and đ the way the member list does', () => {
    expect(shape(memberDirectoryOf(TEAMS, ROSTERS, answered(null), 'duric'))).toEqual(['Smjena B: b1']);
    expect(shape(memberDirectoryOf(TEAMS, ROSTERS, answered(null), 'ANIĆ'))).toEqual(['Smjena A: a1']);
  });

  it('matches no rank, position or team name', () => {
    expect(shape(memberDirectoryOf(TEAMS, ROSTERS, answered(null), 'firefighter'))).toEqual([]);
    expect(shape(memberDirectoryOf(TEAMS, ROSTERS, answered(null), 'smjena'))).toEqual([]);
  });

  it('says a search with no hit is searched, so the screen offers to clear it', () => {
    expect(memberDirectoryOf(TEAMS, ROSTERS, answered(null), 'zzz')).toEqual({
      kind: DIRECTORY_ANSWERED,
      groups: [],
      searched: true,
    });
  });

  it('reads whitespace as no search, and a query that folds to nothing as no hit', () => {
    expect(memberDirectoryOf(TEAMS, ROSTERS, answered(null), '   ')).toMatchObject({ searched: false });
    expect(memberDirectoryOf(TEAMS, ROSTERS, answered(null), '̀')).toEqual({
      kind: DIRECTORY_ANSWERED,
      groups: [],
      searched: true,
    });
  });

  it('keeps the own team first among the hits', () => {
    expect(shape(memberDirectoryOf(TEAMS, ROSTERS, answered(B), 'ma'))).toEqual(['Smjena B (own): b2']);
    expect(shape(memberDirectoryOf(TEAMS, ROSTERS, answered(B), 'i'))).toEqual([
      'Smjena B (own): b1,b2',
      'Smjena A: a1,a2',
    ]);
  });
});

describe('the directory is all or nothing', () => {
  it('is unavailable when the team list fails', () => {
    expect(memberDirectoryOf(FAILED, ROSTERS, answered(null), '')).toEqual({ kind: DIRECTORY_UNAVAILABLE });
  });

  it('is unavailable when any one roster fails, even beside one still loading', () => {
    const rosters = new Map(ROSTERS);

    rosters.set(A, FAILED);
    rosters.set(B, LOADING);

    expect(memberDirectoryOf(TEAMS, rosters, answered(null), '')).toEqual({ kind: DIRECTORY_UNAVAILABLE });
  });

  it.each([TEAM_ROSTER_UNAVAILABLE, TEAM_ROSTER_UNKNOWN] as const)(
    'is unavailable when an active team\'s roster answers %s',
    (code) => {
      const rosters = new Map(ROSTERS);

      rosters.set(C, answered({ ok: false, code }));

      expect(memberDirectoryOf(TEAMS, rosters, answered(null), '')).toEqual({ kind: DIRECTORY_UNAVAILABLE });
    },
  );

  it('is unavailable when the caller\'s own team cannot be read', () => {
    expect(memberDirectoryOf(TEAMS, ROSTERS, FAILED, '')).toEqual({ kind: DIRECTORY_UNAVAILABLE });
  });

  it('ignores a roster of an archived team, failed or not', () => {
    const rosters = new Map(ROSTERS);

    rosters.set(ARCHIVED, FAILED);

    expect(memberDirectoryOf(TEAMS, rosters, answered(null), '').kind).toBe(DIRECTORY_ANSWERED);
  });

  it('is loading until every read has answered', () => {
    const rosters = new Map(ROSTERS);

    rosters.delete(C);

    expect(memberDirectoryOf(LOADING, ROSTERS, answered(null), '')).toEqual({ kind: DIRECTORY_LOADING });
    expect(memberDirectoryOf(TEAMS, rosters, answered(null), '')).toEqual({ kind: DIRECTORY_LOADING });
    expect(memberDirectoryOf(TEAMS, ROSTERS, LOADING, '')).toEqual({ kind: DIRECTORY_LOADING });
  });
});

describe('a query result becomes a read', () => {
  const base = { isPending: false, isError: false, fetchStatus: 'idle', data: undefined };

  it('is answered once there is data', () => {
    expect(directoryReadOf({ ...base, data: 1 })).toEqual(answered(1));
  });

  it('is failed on an error, even over kept data', () => {
    expect(directoryReadOf({ ...base, isError: true })).toEqual(FAILED);
    expect(directoryReadOf({ ...base, isError: true, data: 1 })).toEqual(FAILED);
  });

  it('is failed on a first fetch paused offline, and loading while pending', () => {
    expect(directoryReadOf({ ...base, isPending: true, fetchStatus: TEAM_ROSTER_FETCH_PAUSED })).toEqual(FAILED);
    expect(directoryReadOf({ ...base, isPending: true, fetchStatus: 'fetching' })).toEqual(LOADING);
  });
});

describe('the caller\'s own read becomes their team today', () => {
  const NOW = new Date('2026-10-09T10:00:00Z');
  const snapshot = (teamId: string | null): OwnTeamOutcome => ({
    ok: true,
    snapshot: {
      timeZone: 'Europe/Zagreb',
      teamVersions: [
        {
          team: teamId === null ? null : { id: teamId, name: 'Smjena' },
          position: null,
          effectiveFrom: '2026-01-01',
        },
      ],
    },
  });

  it('answers the team id, or null for no team', () => {
    expect(ownTeamIdReadOf(answered(snapshot(B)), NOW)).toEqual(answered(B));
    expect(ownTeamIdReadOf(answered(snapshot(null)), NOW)).toEqual(answered(null));
  });

  it('fails on a refused own read, and passes loading and failure through', () => {
    expect(ownTeamIdReadOf(answered<OwnTeamOutcome>({ ok: false, code: OWN_TEAM_UNAVAILABLE }), NOW)).toEqual(FAILED);
    expect(ownTeamIdReadOf(LOADING, NOW)).toEqual(LOADING);
    expect(ownTeamIdReadOf(FAILED, NOW)).toEqual(FAILED);
  });
});

describe('the retry reads again exactly what failed', () => {
  it('re-reads a failed list, a failed own read and each failed roster, and nothing answered', () => {
    expect(
      directoryRetryOf(FAILED, [roster('A', []), FAILED, answered({ ok: false, code: TEAM_ROSTER_UNAVAILABLE })], FAILED),
    ).toEqual({ teams: true, own: true, rosters: [false, true, true] });
    expect(directoryRetryOf(TEAMS, [roster('A', []), LOADING], answered(null))).toEqual({
      teams: false,
      own: false,
      rosters: [false, false],
    });
  });

  it('counts a first fetch paused offline as failed, which carries no isError', () => {
    const paused = directoryReadOf({ isPending: true, isError: false, fetchStatus: TEAM_ROSTER_FETCH_PAUSED, data: undefined });

    expect(directoryRetryOf(paused, [paused as DirectoryRead<TeamRosterOutcome>], paused)).toEqual({
      teams: true,
      own: true,
      rosters: [true],
    });
  });

  it('re-reads the team list too when a roster answers unknown', () => {
    expect(directoryRetryOf(TEAMS, [answered({ ok: false, code: TEAM_ROSTER_UNKNOWN })], answered(null))).toEqual({
      teams: true,
      own: false,
      rosters: [true],
    });
  });
});
