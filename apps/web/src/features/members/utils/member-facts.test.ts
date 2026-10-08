import { describe, expect, it } from 'vitest';

import type { MemberListRow } from '@/features/members/services/list';
import { memberHeaderFactsOf, memberStatusBadgeMessageKey } from '@/features/members/utils/member-facts';

const TODAY = '2026-10-08';

function member(fields: Partial<MemberListRow> = {}): MemberListRow {
  return {
    id: 'member-1',
    organizationId: 'organization-1',
    name: 'Luka Knežević',
    username: 'luka.knezevic',
    email: null,
    role: 'member_role',
    leaveAllowanceDays: 20,
    fireRank: 'nco',
    authUserId: 'account-1',
    statusVersions: [],
    teamVersions: [{ team: { id: 'team-a', name: 'Smjena A' }, position: 'driver', effectiveFrom: '2020-01-01' }],
    timeZone: 'Europe/Zagreb',
    ...fields,
  };
}

describe('the member page header says who the person is (story 7.11)', () => {
  it('names rank, position and team while ranks and positions are used', () => {
    expect(memberHeaderFactsOf(member(), TODAY, true)).toEqual({
      rank: 'ljudi.rank.nco',
      position: 'smjene.position.driver',
      team: 'Smjena A',
      role: 'ljudi.member',
      roleBadge: 'secondary',
      status: 'ljudi.page.active',
    });
  });

  it('names neither rank nor position while the setting is off, and keeps the team', () => {
    expect(memberHeaderFactsOf(member(), TODAY, false)).toMatchObject({ rank: null, position: null, team: 'Smjena A' });
  });

  it('names no team for a member on none, and no rank for a member with none', () => {
    expect(memberHeaderFactsOf(member({ teamVersions: [], fireRank: null }), TODAY, true)).toMatchObject({
      rank: null,
      position: null,
      team: null,
    });
  });

  it('names no position while positions are on but today\'s version carries none', () => {
    const legacy = member({ teamVersions: [{ team: { id: 'team-a', name: 'Smjena A' }, position: null, effectiveFrom: '2020-01-01' }] });

    expect(memberHeaderFactsOf(legacy, TODAY, true)).toMatchObject({ rank: 'ljudi.rank.nco', position: null, team: 'Smjena A' });
  });

  it('says today\'s team and position, never a change scheduled after today', () => {
    const moving = member({
      teamVersions: [
        { team: { id: 'team-a', name: 'Smjena A' }, position: 'driver', effectiveFrom: '2020-01-01' },
        { team: { id: 'team-b', name: 'Smjena B' }, position: 'commander', effectiveFrom: '2026-10-20' },
      ],
    });
    const leaving = member({
      teamVersions: [
        { team: { id: 'team-a', name: 'Smjena A' }, position: 'driver', effectiveFrom: '2020-01-01' },
        { team: null, position: null, effectiveFrom: '2026-10-20' },
      ],
    });
    const joining = member({ teamVersions: [{ team: { id: 'team-b', name: 'Smjena B' }, position: 'commander', effectiveFrom: '2026-10-20' }] });

    expect(memberHeaderFactsOf(moving, TODAY, true)).toMatchObject({ position: 'smjene.position.driver', team: 'Smjena A' });
    expect(memberHeaderFactsOf(leaving, TODAY, true)).toMatchObject({ position: 'smjene.position.driver', team: 'Smjena A' });
    // NOT YET ON A TEAM: neither the future team nor its position is said.
    expect(memberHeaderFactsOf(joining, TODAY, true)).toMatchObject({ position: null, team: null });
  });

  it('badges an administrator in the primary tint and an inactive member in words', () => {
    const facts = memberHeaderFactsOf(
      member({ role: 'admin', statusVersions: [{ active: false, effectiveFrom: '2026-10-01' }] }),
      TODAY,
      true,
    );

    expect(facts).toMatchObject({ role: 'ljudi.admin', roleBadge: 'default', status: 'ljudi.page.inactive' });
    expect(memberStatusBadgeMessageKey(true)).toBe('ljudi.page.active');
  });
});
