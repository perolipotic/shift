import { describe, expect, it } from 'vitest';

import {
  activeOn,
  memberScheduleOfMonth,
  membershipOn,
  shiftRoster,
  type MembershipVersion,
  type RosterMember,
  type StatusVersion,
} from '../src/index.js';
import {
  PILOT_ROTATION_ASSIGNMENTS,
  PILOT_ROTATION_STEPS,
  PILOT_TEAMS,
  SEEDED_EFFECTIVE_FROM,
  UJ5_TEAMS,
} from './fixtures.js';

/**
 * Story 3.4a — the roster as at a date (CAP-11, AD-2, FR-12). Node
 * environment, no browser. Membership (with position) and active status are
 * versioned and selected by the date being derived, never by today.
 */

const D = '2026-09-15';

const FIXTURES = [
  { fixture: 'pilot', teams: PILOT_TEAMS },
  { fixture: 'UJ-5', teams: UJ5_TEAMS },
] as const;

function member(
  id: string,
  memberships: readonly MembershipVersion[],
  statuses: readonly StatusVersion[] = [],
): RosterMember {
  return { id, memberships, statuses };
}

describe('activeOn', () => {
  it('is active when the member was never versioned', () => {
    expect(activeOn([], D)).toBe(true);
  });

  it('is the latest version on or before the date, in any input order', () => {
    const statuses = [
      { active: true, effectiveFrom: '2026-09-15' },
      { active: false, effectiveFrom: '2026-09-12' },
      { active: true, effectiveFrom: '2020-01-01' },
    ];
    expect(activeOn(statuses, '2019-12-31')).toBe(true);
    expect(activeOn(statuses, '2026-09-11')).toBe(true);
    expect(activeOn(statuses, '2026-09-12')).toBe(false);
    expect(activeOn(statuses, '2026-09-14')).toBe(false);
    expect(activeOn(statuses, '2026-09-15')).toBe(true);
  });

  it('is active before the first version, even when that version deactivates', () => {
    expect(activeOn([{ active: false, effectiveFrom: '2026-09-25' }], D)).toBe(true);
  });

  it('throws a RangeError on a malformed or repeated date', () => {
    expect(() => activeOn([], '2026-02-30')).toThrow(RangeError);
    expect(() => activeOn([{ active: false, effectiveFrom: '2026-9-1' }], D)).toThrow(RangeError);
    expect(() =>
      activeOn(
        [
          { active: false, effectiveFrom: '2026-09-01' },
          { active: true, effectiveFrom: '2026-09-01' },
        ],
        D,
      ),
    ).toThrow(/2026-09-01/);
  });
});

describe('membershipOn', () => {
  const memberships: MembershipVersion[] = [
    { teamId: 'beta', position: 'driver', effectiveFrom: '2026-09-15' },
    { teamId: 'alfa', position: 'commander', effectiveFrom: '2026-01-01' },
    { teamId: null, position: null, effectiveFrom: '2026-10-01' },
  ];

  it('is null before the first version', () => {
    expect(membershipOn(memberships, '2025-12-31')).toBeNull();
    expect(membershipOn([], D)).toBeNull();
  });

  it('is the team and position of the latest version on or before the date', () => {
    expect(membershipOn(memberships, '2026-09-14')).toEqual({ teamId: 'alfa', position: 'commander' });
    expect(membershipOn(memberships, '2026-09-15')).toEqual({ teamId: 'beta', position: 'driver' });
  });

  it('is null from a version that names no team', () => {
    expect(membershipOn(memberships, '2026-10-01')).toBeNull();
  });

  it('carries a null position', () => {
    expect(membershipOn([{ teamId: 'alfa', position: null, effectiveFrom: '2026-01-01' }], D)).toEqual({
      teamId: 'alfa',
      position: null,
    });
  });

  it('throws a RangeError on a malformed or repeated date', () => {
    expect(() => membershipOn(memberships, 'not-a-date')).toThrow(RangeError);
    expect(() => membershipOn([{ teamId: 'alfa', position: null, effectiveFrom: '2026-13-01' }], D)).toThrow(RangeError);
    expect(() =>
      membershipOn(
        [
          { teamId: 'alfa', position: null, effectiveFrom: '2026-01-01' },
          { teamId: 'beta', position: null, effectiveFrom: '2026-01-01' },
        ],
        D,
      ),
    ).toThrow(/2026-01-01/);
  });
});

describe('shiftRoster', () => {
  const alfa = 'alfa';
  const beta = 'beta';
  const onAlfa = (position: string | null): MembershipVersion[] => [{ teamId: alfa, position, effectiveFrom: '2026-01-01' }];

  it('lists the team members active on the date, with positions, in input order', () => {
    const members = [member('B', onAlfa('driver')), member('A', onAlfa('commander'))];
    expect(shiftRoster(members, alfa, D)).toEqual([
      { memberId: 'B', position: 'driver' },
      { memberId: 'A', position: 'commander' },
    ]);
  });

  it('keeps a member deactivated since the date', () => {
    const members = [
      member('A', onAlfa(null)),
      member('B', onAlfa('driver'), [{ active: false, effectiveFrom: '2026-09-25' }]),
    ];
    expect(shiftRoster(members, alfa, D).map((entry) => entry.memberId)).toEqual(['A', 'B']);
  });

  it('drops a member inactive on the date', () => {
    const members = [
      member('A', onAlfa(null)),
      member('B', onAlfa('driver'), [{ active: false, effectiveFrom: '2026-09-12' }]),
    ];
    expect(shiftRoster(members, alfa, D).map((entry) => entry.memberId)).toEqual(['A']);
  });

  it('brings back a member reactivated on the date', () => {
    const members = [
      member('B', onAlfa('driver'), [
        { active: false, effectiveFrom: '2026-09-12' },
        { active: true, effectiveFrom: D },
      ]),
    ];
    expect(shiftRoster(members, alfa, D)).toEqual([{ memberId: 'B', position: 'driver' }]);
  });

  it('leaves out a member who joins the day after, and moves one who changes team on the date', () => {
    const members = [
      member('A', [{ teamId: alfa, position: null, effectiveFrom: '2026-09-16' }]),
      member('C', [
        { teamId: alfa, position: 'commander', effectiveFrom: '2026-01-01' },
        { teamId: beta, position: 'firefighter', effectiveFrom: D },
      ]),
    ];
    expect(shiftRoster(members, alfa, D)).toEqual([]);
    expect(shiftRoster(members, beta, D)).toEqual([{ memberId: 'C', position: 'firefighter' }]);
    expect(shiftRoster(members, alfa, '2026-09-14')).toEqual([{ memberId: 'C', position: 'commander' }]);
    expect(shiftRoster(members, alfa, '2026-09-16')).toEqual([{ memberId: 'A', position: null }]);
  });

  it('reads a status history that starts before the first membership', () => {
    // Inactive from 09-01, active again from 09-10; on Alfa only from 09-12.
    const statuses = [
      { active: false, effectiveFrom: '2026-09-01' },
      { active: true, effectiveFrom: '2026-09-10' },
    ];
    const members = [member('A', [{ teamId: alfa, position: 'driver', effectiveFrom: '2026-09-12' }], statuses)];

    expect(shiftRoster(members, alfa, '2026-09-05')).toEqual([]);
    expect(shiftRoster(members, alfa, '2026-09-11')).toEqual([]);
    expect(shiftRoster(members, alfa, '2026-09-12')).toEqual([{ memberId: 'A', position: 'driver' }]);
    const days = memberScheduleOfMonth(
      { memberships: members[0]!.memberships, statuses, assignments: PILOT_ROTATION_ASSIGNMENTS, steps: PILOT_ROTATION_STEPS },
      '2026-09',
    );
    const [pilotA] = PILOT_TEAMS;

    expect(days.filter((day) => day.teamId !== null).map((day) => day.date)).toEqual(
      days.map((day) => day.date).filter((date) => date >= '2026-09-12'),
    );
    // The same history on a team the pilot rotates: types from the 12th only.
    const onPilot = memberScheduleOfMonth(
      {
        memberships: [{ teamId: pilotA!.id, position: 'driver', effectiveFrom: '2026-09-12' }],
        statuses,
        assignments: PILOT_ROTATION_ASSIGNMENTS,
        steps: PILOT_ROTATION_STEPS,
      },
      '2026-09',
    );

    for (const day of onPilot) {
      expect(day.shiftTypeId !== null, day.date).toBe(day.date >= '2026-09-12');
    }
  });

  it('leaves out a member with no team', () => {
    expect(shiftRoster([member('A', [])], alfa, D)).toEqual([]);
    expect(shiftRoster([member('A', [{ teamId: null, position: null, effectiveFrom: '2026-01-01' }])], alfa, D)).toEqual([]);
  });

  it('throws a RangeError on a malformed date or a repeated version date', () => {
    expect(() => shiftRoster([], alfa, '2026-02-29')).toThrow(RangeError);
    expect(() =>
      shiftRoster(
        [
          member('A', onAlfa(null), [
            { active: false, effectiveFrom: '2026-09-01' },
            { active: false, effectiveFrom: '2026-09-01' },
          ]),
        ],
        alfa,
        D,
      ),
    ).toThrow(RangeError);
  });

  it.each(FIXTURES)('$fixture: a roster per team, each active member on exactly one', ({ teams }) => {
    // Two members per team; the second of every team is inactive from the 10th.
    const members = teams.flatMap((team, index) => [
      member(`${team.id}-1`, [{ teamId: team.id, position: 'commander', effectiveFrom: SEEDED_EFFECTIVE_FROM }]),
      member(
        `${team.id}-2`,
        [{ teamId: team.id, position: index % 2 === 0 ? 'driver' : null, effectiveFrom: SEEDED_EFFECTIVE_FROM }],
        [{ active: false, effectiveFrom: '2026-09-10' }],
      ),
    ]);
    teams.forEach((team, index) => {
      expect(shiftRoster(members, team.id, '2026-09-09')).toEqual([
        { memberId: `${team.id}-1`, position: 'commander' },
        { memberId: `${team.id}-2`, position: index % 2 === 0 ? 'driver' : null },
      ]);
      expect(shiftRoster(members, team.id, '2026-09-10')).toEqual([{ memberId: `${team.id}-1`, position: 'commander' }]);
      expect(shiftRoster(members, team.id, '2019-12-31')).toEqual([]);
    });
  });
});
