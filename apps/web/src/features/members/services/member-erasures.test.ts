import { collisionKeyOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarMember, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE, type ErasureReads } from '@/features/conflicts/services/erasure-check';
import { erasuresOf, type ErasureRow } from '@/features/conflicts/services/erasures';
import {
  MEMBER_CHANGE_MOVE,
  MEMBER_CHANGE_STATUS,
  MEMBER_CHANGE_STATUS_WITHDRAW,
  MEMBER_CHANGE_TEAM_WITHDRAW,
  memberChangeSnapshotOf,
  memberErasureCheckOf,
  statusChangeOf,
  teamChangeOf,
  type MemberChange,
} from '@/features/members/services/member-erasures';
import {
  DEACTIVATE,
  MEMBER_STATUS_DATE_TAKEN,
  MEMBER_STATUS_IN_EFFECT,
  MEMBER_STATUS_STALE,
  MEMBER_TEAM_ARCHIVED,
  MEMBER_TEAM_DATE_TAKEN,
  MEMBER_TEAM_IN_EFFECT,
  MEMBER_TEAM_STALE,
  REACTIVATE,
  TEAM_MOVE,
  WITHDRAW,
} from '@/features/members/services/write';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 5.5e's member page guard, executed (AD-15): every row of the spec's
 * matrix but "Keep", "Read failed" and "Many rows" (the e2e spec's), over the
 * pilot fixture — `[Dan, Noć, Slobodno, Slobodno]`, the viewer on Smjena A,
 * which works Dan 10.09, Noć 11.09 and Dan 14.09; Ana on Smjena B, which works
 * Noć 10.09 and Dan 13.09; Smjena C, off 10.09 and 11.09, Dan 12.09.
 */

const ANA = '00000000-0000-4000-8000-0000000000c1';
const A = 'pilot-smjena-a';
const B = 'pilot-smjena-b';
const C = 'pilot-smjena-c';
/** The organization's today every change is judged at: before every date the tests change. */
const TODAY = '2026-09-01';
/** An instant on {@link TODAY} in Zagreb, for the check's own clock. */
const NOW = (): Date => new Date('2026-09-01T10:00:00Z');

type Row = Record<string, unknown>;

let plain: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();

  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, A, SEEDED), memberMembershipRow(ANA, B, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(ANA, 'Ana Anić')]),
    overridesAnswerOf([]),
    rosterOverridesAnswerOf([]),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  plain = outcome.snapshot;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** `plain` with the viewer's versions replaced. */
function viewerWith(versions: Partial<Pick<CalendarMember, 'memberships' | 'statuses'>>): CalendarSnapshot {
  return {
    ...plain,
    members: plain.members.map((member) => (member.id === VIEWER_MEMBER ? { ...member, ...versions } : member)),
  };
}

/** A row as `leave_records` answers it: the range canonical, its upper bound exclusive. */
function recordOf(id: string, from: string, toExclusive: string, memberId: string = VIEWER_MEMBER): Row {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}

/** A resolution row as `conflict_resolutions` answers it. */
function resolutionOf(memberId: string, date: string, teamId: string): Row {
  return { member_id: memberId, date, team_id: teamId, kind: 'accept_uncovered', roster_override_id: null };
}

function move(
  teamId: string | null,
  day: string,
  memberId: string = VIEWER_MEMBER,
): Extract<MemberChange, { readonly kind: typeof MEMBER_CHANGE_MOVE }> {
  return { kind: MEMBER_CHANGE_MOVE, memberId, teamId, position: null, day };
}

function deactivate(day: string, memberId: string = VIEWER_MEMBER): MemberChange {
  return { kind: MEMBER_CHANGE_STATUS, memberId, active: false, day };
}

/** The rows `change` would erase over `calendar`, as the check derives them. */
function rowsOf(
  calendar: CalendarSnapshot,
  change: MemberChange,
  records: readonly Row[],
  resolutions: readonly Row[] = [],
): readonly ErasureRow[] {
  const applied = memberChangeSnapshotOf(calendar, change, TODAY);

  if (!applied.ok) throw new Error(applied.code);

  return erasuresOf(calendar, applied.after, applied.from, records, resolutions);
}

describe('Move away', () => {
  it('lists the old team\'s conflict, though the move to a working team adds one on the new team', () => {
    // 10.09: Smjena A works Dan, Smjena B Noć — the move erases A's key and adds B's.
    const rows = rowsOf(plain, move(B, '2026-09-10'), [recordOf('record-1', '2026-09-10', '2026-09-11')]);

    expect(rows).toEqual([
      {
        key: collisionKeyOf({ memberId: VIEWER_MEMBER, date: '2026-09-10', teamId: A }),
        memberId: VIEWER_MEMBER,
        date: '2026-09-10',
        teamId: A,
        memberName: VIEWER_NAME,
        teamName: 'Smjena A',
        weekday: 'četvrtak',
        dayMonth: '10.09.',
        shiftTypeName: 'Dan',
        teamWorks: true,
      },
    ]);
  });

  it('words a row in the member page\'s own terms: the team the conflict was on', () => {
    const [row] = rowsOf(plain, move(B, '2026-09-10'), [recordOf('record-1', '2026-09-10', '2026-09-11')]);

    if (row === undefined) throw new Error('no row');

    expect(t('ljudi.erasures.rowWithout', { member: row.memberName, team: row.teamName })).toBe(
      `${VIEWER_NAME} na godišnjem · nakon promjene: Smjena A taj dan bez ${VIEWER_NAME}`,
    );
    expect(t('ljudi.erasures.title', { count: 2 })).toBe('Promjena briše 2 konflikta');
    expect(t('ljudi.erasures.removed', { count: 1 })).toBe('Uklonjen 1 konflikt.');
  });

  it('runs from the move\'s day: the leave before it keeps its conflicts', () => {
    const rows = rowsOf(plain, move(B, '2026-09-11'), [recordOf('record-1', '2026-09-10', '2026-09-12')]);

    expect(rows.map((row) => row.date)).toEqual(['2026-09-11']);
  });

  it('appends the version to the target member alone, leaving the snapshot as read', () => {
    const applied = memberChangeSnapshotOf(plain, { ...move(B, '2026-09-10'), position: 'vatrogasac' }, TODAY);

    if (!applied.ok) throw new Error(applied.code);

    const viewer = applied.after.members.find((member) => member.id === VIEWER_MEMBER);
    const ana = applied.after.members.find((member) => member.id === ANA);

    expect(viewer?.memberships).toEqual([
      { teamId: A, position: null, effectiveFrom: SEEDED },
      { teamId: B, position: 'vatrogasac', effectiveFrom: '2026-09-10' },
    ]);
    expect(ana).toBe(plain.members.find((member) => member.id === ANA));
    expect(applied.from).toBe('2026-09-10');
    expect(plain.members.find((member) => member.id === VIEWER_MEMBER)?.memberships).toHaveLength(1);
  });
});

describe('Deactivate', () => {
  it('lists every working day of the leave from the deactivation on', () => {
    const rows = rowsOf(plain, deactivate('2026-09-10'), [recordOf('record-1', '2026-09-10', '2026-09-12')]);

    expect(rows.map((row) => [row.date, row.teamName, row.shiftTypeName])).toEqual([
      ['2026-09-10', 'Smjena A', 'Dan'],
      ['2026-09-11', 'Smjena A', 'Noć'],
    ]);
  });
});

describe('No team', () => {
  it('lists the conflict a move onto no team leaves', () => {
    const rows = rowsOf(plain, move(null, '2026-09-10'), [recordOf('record-1', '2026-09-10', '2026-09-11')]);

    expect(rows.map((row) => [row.date, row.teamId])).toEqual([['2026-09-10', A]]);
  });
});

describe('Withdraw move-in', () => {
  it('lists the conflict on the team a scheduled move put the member on', () => {
    // From 13.09 the viewer is on Smjena B, which works Dan that day; A is off.
    const calendar = viewerWith({
      memberships: [
        { teamId: A, position: null, effectiveFrom: SEEDED },
        { teamId: B, position: null, effectiveFrom: '2026-09-13' },
      ],
    });
    const rows = rowsOf(calendar, { kind: MEMBER_CHANGE_TEAM_WITHDRAW, memberId: VIEWER_MEMBER, day: '2026-09-13' }, [
      recordOf('record-1', '2026-09-13', '2026-09-14'),
    ]);

    expect(rows.map((row) => [row.date, row.teamName, row.shiftTypeName])).toEqual([['2026-09-13', 'Smjena B', 'Dan']]);
  });

});

describe('Withdraw reactivation', () => {
  it('lists the conflicts a withdrawn reactivation leaves, the member inactive again', () => {
    const calendar = viewerWith({
      statuses: [
        { active: false, effectiveFrom: '2026-09-01' },
        { active: true, effectiveFrom: '2026-09-10' },
      ],
    });
    const rows = rowsOf(calendar, { kind: MEMBER_CHANGE_STATUS_WITHDRAW, memberId: VIEWER_MEMBER, day: '2026-09-10' }, [
      recordOf('record-1', '2026-09-10', '2026-09-11'),
    ]);

    expect(rows.map((row) => [row.date, row.teamId])).toEqual([['2026-09-10', A]]);
  });

  it('runs the check but derives nothing for a withdrawn scheduled deactivation: it only adds', async () => {
    const calendar = viewerWith({ statuses: [{ active: false, effectiveFrom: '2026-09-10' }] });
    const change: MemberChange = { kind: MEMBER_CHANGE_STATUS_WITHDRAW, memberId: VIEWER_MEMBER, day: '2026-09-10' };
    const applied = memberChangeSnapshotOf(calendar, change, TODAY);

    expect(applied.ok && applied.guarded).toBe(false);
    expect(
      await memberErasureCheckOf(
        () => Promise.resolve({ calendar, records: [recordOf('record-1', '2026-09-10', '2026-09-11')], resolutions: [] }),
        change,
        true,
        NOW,
      ),
    ).toEqual({ kind: CHECK_READY, rows: [] });
  });
});

describe('No erasure', () => {
  it('erases nothing when the member deactivated is not on leave', () => {
    expect(rowsOf(plain, deactivate('2026-09-10', ANA), [recordOf('record-1', '2026-09-10', '2026-09-12')])).toEqual([]);
  });

  it('erases nothing when a move only lands the member on leave on a team that is off', () => {
    // 10.09 and 11.09: Smjena C is off, so the move adds nothing and erases A's.
    // The leave is on 12.09 alone, where Smjena A is off and C works.
    expect(rowsOf(plain, move(C, '2026-09-10'), [recordOf('record-1', '2026-09-12', '2026-09-13')])).toEqual([]);
  });
});

describe('Only adds', () => {
  it('runs no check for a reactivation or a position-only change', () => {
    expect(statusChangeOf(VIEWER_MEMBER, { change: REACTIVATE, day: '2026-09-10' })).toBeNull();
    expect(
      teamChangeOf(VIEWER_MEMBER, { change: TEAM_MOVE, team: { id: A }, position: 'zapovjednik', keepsTeam: true, day: '2026-09-10' }),
    ).toBeNull();
  });

  it('checks a deactivation, a status withdrawal (the check decides), a move and a team withdrawal', () => {
    expect(statusChangeOf(VIEWER_MEMBER, { change: DEACTIVATE, day: '2026-09-10' })).toEqual(deactivate('2026-09-10'));
    expect(statusChangeOf(VIEWER_MEMBER, { change: WITHDRAW, day: '2026-09-10' })).toEqual({
      kind: MEMBER_CHANGE_STATUS_WITHDRAW,
      memberId: VIEWER_MEMBER,
      day: '2026-09-10',
    });
    expect(
      teamChangeOf(VIEWER_MEMBER, { change: TEAM_MOVE, team: null, position: 'vatrogasac', keepsTeam: false, day: '2026-09-10' }),
    ).toEqual(move(null, '2026-09-10'));
    expect(
      teamChangeOf(VIEWER_MEMBER, { change: WITHDRAW, team: null, position: null, keepsTeam: false, day: '2026-09-13' }),
    ).toEqual({ kind: MEMBER_CHANGE_TEAM_WITHDRAW, memberId: VIEWER_MEMBER, day: '2026-09-13' });
  });

  it('erases nothing on a reactivation', () => {
    const calendar = viewerWith({ statuses: [{ active: false, effectiveFrom: '2026-09-01' }] });
    const reactivate: MemberChange = { kind: MEMBER_CHANGE_STATUS, memberId: VIEWER_MEMBER, active: true, day: '2026-09-10' };

    expect(rowsOf(calendar, reactivate, [recordOf('record-1', '2026-09-10', '2026-09-12')])).toEqual([]);
  });
});

describe('Resolved', () => {
  it('does not list a conflict already decided', () => {
    const rows = rowsOf(plain, deactivate('2026-09-10'), [recordOf('record-1', '2026-09-10', '2026-09-11')], [
      resolutionOf(VIEWER_MEMBER, '2026-09-10', A),
    ]);

    expect(rows).toEqual([]);
  });
});

describe('Date taken, and the other refusals judged before deriving', () => {
  it('answers date taken for a version already dated the day', () => {
    expect(memberChangeSnapshotOf(plain, move(B, SEEDED), TODAY)).toEqual({ ok: false, code: MEMBER_TEAM_DATE_TAKEN });

    const inactive = viewerWith({ statuses: [{ active: true, effectiveFrom: '2026-09-10' }] });

    expect(memberChangeSnapshotOf(inactive, deactivate('2026-09-10'), TODAY)).toEqual({ ok: false, code: MEMBER_STATUS_DATE_TAKEN });
  });

  it('answers stale for a scheduled version that is gone', () => {
    expect(
      memberChangeSnapshotOf(plain, { kind: MEMBER_CHANGE_TEAM_WITHDRAW, memberId: VIEWER_MEMBER, day: '2026-09-13' }, TODAY),
    ).toEqual({ ok: false, code: MEMBER_TEAM_STALE });
    expect(
      memberChangeSnapshotOf(plain, { kind: MEMBER_CHANGE_STATUS_WITHDRAW, memberId: VIEWER_MEMBER, day: '2026-09-13' }, TODAY),
    ).toEqual({ ok: false, code: MEMBER_STATUS_STALE });
  });

  it('answers stale for a move or a status change while another version is already scheduled', () => {
    const movedLater = viewerWith({
      memberships: [
        { teamId: A, position: null, effectiveFrom: SEEDED },
        { teamId: C, position: null, effectiveFrom: '2026-09-20' },
      ],
      statuses: [{ active: false, effectiveFrom: '2026-09-20' }],
    });

    expect(memberChangeSnapshotOf(movedLater, move(B, '2026-09-10'), TODAY)).toEqual({ ok: false, code: MEMBER_TEAM_STALE });
    expect(memberChangeSnapshotOf(movedLater, deactivate('2026-09-10'), TODAY)).toEqual({ ok: false, code: MEMBER_STATUS_STALE });
    // A version already in effect is no scheduled one.
    expect(memberChangeSnapshotOf(movedLater, move(B, '2026-09-25'), '2026-09-20').ok).toBe(true);
  });

  it('answers in effect for a withdrawal whose version is no longer in the future', () => {
    const inactive = viewerWith({ statuses: [{ active: false, effectiveFrom: '2026-09-01' }] });

    expect(
      memberChangeSnapshotOf(plain, { kind: MEMBER_CHANGE_TEAM_WITHDRAW, memberId: VIEWER_MEMBER, day: SEEDED }, TODAY),
    ).toEqual({ ok: false, code: MEMBER_TEAM_IN_EFFECT });
    expect(
      memberChangeSnapshotOf(inactive, { kind: MEMBER_CHANGE_STATUS_WITHDRAW, memberId: VIEWER_MEMBER, day: '2026-09-01' }, TODAY),
    ).toEqual({ ok: false, code: MEMBER_STATUS_IN_EFFECT });
  });

  it('answers stale for a target team that is missing, and archived for one archived', () => {
    const archived: CalendarSnapshot = {
      ...plain,
      teams: plain.teams.map((team) => (team.id === C ? { ...team, archived: true } : team)),
    };

    expect(memberChangeSnapshotOf(plain, move('no-such-team', '2026-09-10'), TODAY)).toEqual({ ok: false, code: MEMBER_TEAM_STALE });
    expect(memberChangeSnapshotOf(archived, move(C, '2026-09-10'), TODAY)).toEqual({ ok: false, code: MEMBER_TEAM_ARCHIVED });
  });
});

describe('memberErasureCheckOf', () => {
  const LEAVE = [recordOf('record-1', '2026-09-10', '2026-09-11')];

  function readsOf(overrides: Partial<ErasureReads> = {}): () => Promise<ErasureReads> {
    return () => Promise.resolve({ calendar: plain, records: LEAVE, resolutions: [], ...overrides });
  }

  it('answers the rows the change would erase', async () => {
    const check = await memberErasureCheckOf(readsOf(), deactivate('2026-09-10'), true, NOW);

    expect(check).toEqual({ kind: CHECK_READY, rows: [expect.objectContaining({ date: '2026-09-10', teamId: A })] });
  });

  it('answers refused, with the card\'s own code, for a write the database would refuse anyway', async () => {
    expect(await memberErasureCheckOf(readsOf(), move(B, SEEDED), true, NOW)).toEqual({
      kind: CHECK_REFUSED,
      code: MEMBER_TEAM_DATE_TAKEN,
    });
  });

  it('answers unavailable, never refused, for any other fault of the change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await memberErasureCheckOf(readsOf(), deactivate('2026-02-30'), true, NOW)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(await memberErasureCheckOf(readsOf(), deactivate('2026-09-10', 'stranger'), true, NOW)).toEqual({
      kind: CHECK_UNAVAILABLE,
    });
  });

  it('answers unavailable offline, without reading', async () => {
    const read = vi.fn(readsOf());

    expect(await memberErasureCheckOf(read, deactivate('2026-09-10'), false)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(read).not.toHaveBeenCalled();
  });

  it('answers unavailable, logged, when a read rejects', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const check = await memberErasureCheckOf(() => Promise.reject(new Error('500')), deactivate('2026-09-10'), true);

    expect(check).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(logged).toHaveBeenCalled();
  });
});
