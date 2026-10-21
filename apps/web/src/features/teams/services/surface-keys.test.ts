import { describe, expect, it } from 'vitest';

import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';
import { TEAMS_LIST_KEY } from '@/features/teams/services/list';
import { OWN_TEAM_KEY, TEAM_ROSTER_KEY } from '@/features/teams/services/roster';
import {
  directorySurfaceKeysOf,
  directoryTimeZoneOf,
  teamRosterSurfaceKeysOf,
  teamRosterTimeZoneOf,
} from '@/features/teams/services/surface-keys';
import { persistsKey } from '@/lib/offline/persistence';

/** Story 8.2b: the members' directory and one team's roster, each one snapshot, every key kept on the device. */

const text = (key: readonly unknown[]): string => JSON.stringify(key);

describe("the directory's keys", () => {
  it('are the team list, the own team, the organization and one roster per active team', () => {
    expect(directorySurfaceKeysOf(['a', 'b'])).toEqual([
      TEAMS_LIST_KEY,
      OWN_TEAM_KEY,
      ORGANIZATION_SNAPSHOT_KEY,
      TEAM_ROSTER_KEY('a'),
      TEAM_ROSTER_KEY('b'),
    ]);
    expect(directorySurfaceKeysOf([])).toEqual([TEAMS_LIST_KEY, OWN_TEAM_KEY, ORGANIZATION_SNAPSHOT_KEY]);
  });

  it('are all kept on the device', () => {
    for (const key of directorySurfaceKeysOf(['a', 'b'])) expect(persistsKey(key), text(key)).toBe(true);
  });
});

describe("a team roster's keys", () => {
  it('are the roster and the organization', () => {
    expect(teamRosterSurfaceKeysOf('a')).toEqual([TEAM_ROSTER_KEY('a'), ORGANIZATION_SNAPSHOT_KEY]);
  });

  it('are all kept on the device', () => {
    for (const key of teamRosterSurfaceKeysOf('a')) expect(persistsKey(key), text(key)).toBe(true);
  });
});

describe("the note's zone", () => {
  const organization = { ok: true, snapshot: { timezone: 'Europe/Zagreb' } } as const;
  const own = { ok: true, snapshot: { timeZone: 'Europe/Vienna' } } as const;
  const failed = { ok: false } as const;

  it("is the organization snapshot's for a roster, and none without it", () => {
    expect(teamRosterTimeZoneOf(organization)).toBe('Europe/Zagreb');
    expect(teamRosterTimeZoneOf(failed)).toBeNull();
    expect(teamRosterTimeZoneOf(undefined)).toBeNull();
  });

  it("is the organization snapshot's for the directory, then the own team's, and none without either", () => {
    expect(directoryTimeZoneOf(organization, own)).toBe('Europe/Zagreb');
    expect(directoryTimeZoneOf(failed, own)).toBe('Europe/Vienna');
    expect(directoryTimeZoneOf(undefined, own)).toBe('Europe/Vienna');
    expect(directoryTimeZoneOf(failed, failed)).toBeNull();
    expect(directoryTimeZoneOf(undefined, undefined)).toBeNull();
  });
});
