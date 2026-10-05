import { collisionKeyOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  PENDING_ROSTER_CHANGE_ID,
  ROSTER_CHANGE_REMOVAL,
  ROSTER_CHANGE_SAVE,
  rosterChangeSnapshotOf,
  rosterErasureCheckOf,
  type RosterChange,
} from '@/features/calendar/services/roster-erasures';
import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { rosterStandingOfCalendar } from '@/features/calendar/utils/month';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  type ErasureReads,
} from '@/features/conflicts/services/erasure-check';
import { erasuresOf, isoInstantOf, latestInstantOf, type ErasureRow } from '@/features/conflicts/services/erasures';
import { ROSTER_GONE, ROSTER_TAKEN } from '@/features/calendar/services/roster-write';
import { instantMicrosOf } from '@/features/rotation/services/list';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarRosterOverrideRow,
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
 * Story 5.5b's roster change guard, executed (AD-15): every row of the spec's
 * matrix but "Keep", "Read failed" and "Rotation intact" (the e2e spec's and
 * 5.5a's own), over the pilot fixture — `[Dan, Noć, Slobodno, Slobodno]`, the
 * viewer on Smjena A, which works Dan 10.09, Noć 11.09 and Dan 14.09, and Ana
 * on Smjena B, which works Noć 10.09 and Dan 13.09.
 */

const ANA = '00000000-0000-4000-8000-0000000000c1';
const A = 'pilot-smjena-a';
const B = 'pilot-smjena-b';

type Row = Record<string, unknown>;

async function calendarOf(rosterOverrides: readonly Row[] = []): Promise<CalendarSnapshot> {
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
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A row as `leave_records` answers it: the range canonical, its upper bound exclusive. */
function recordOf(id: string, from: string, toExclusive: string, memberId: string = VIEWER_MEMBER): Row {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}

/** A resolution row as `conflict_resolutions` answers it. */
function resolutionOf(memberId: string, date: string, teamId: string, kind = 'accept_uncovered', overrideId: string | null = null): Row {
  return { member_id: memberId, date, team_id: teamId, kind, roster_override_id: overrideId };
}

function takeOff(memberId: string, teamId: string, date: string): RosterChange {
  return { kind: ROSTER_CHANGE_SAVE, teamId, date, memberOutId: memberId, memberInId: null };
}

function removal(overrideId: string): RosterChange {
  return { kind: ROSTER_CHANGE_REMOVAL, overrideId };
}

/** The rows `change` would erase over `calendar`, as the check derives them. */
function rowsOf(
  calendar: CalendarSnapshot,
  change: RosterChange,
  records: readonly Row[],
  resolutions: readonly Row[] = [],
): readonly ErasureRow[] {
  const applied = rosterChangeSnapshotOf(calendar, change);

  if (!applied.ok) throw new Error(applied.code);

  return erasuresOf(calendar, applied.after, applied.from, records, resolutions);
}

let plain: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await calendarOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Take off', () => {
  it('lists the conflict a member on leave taken off the roster leaves, the team still working', () => {
    const rows = rowsOf(plain, takeOff(VIEWER_MEMBER, A, '2026-09-10'), [recordOf('record-1', '2026-09-10', '2026-09-12')]);

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

  it('words a row in the calendar\'s own terms', () => {
    const [row] = rowsOf(plain, takeOff(VIEWER_MEMBER, A, '2026-09-10'), [recordOf('record-1', '2026-09-10', '2026-09-11')]);

    if (row === undefined) throw new Error('no row');

    expect(t('kalendar.detail.rosterChange.erasures.rowWithout', { member: row.memberName, team: row.teamName })).toBe(
      `${VIEWER_NAME} na godišnjem · nakon promjene: Smjena A taj dan bez ${VIEWER_NAME}`,
    );
    expect(t('kalendar.detail.rosterChange.erasures.ledeRemoval', { count: 1 })).toBe(
      'Ova promjena uklanja uzrok 1 neriješenog konflikta. Prije uklanjanja odluči za svaki.',
    );
    expect(t('kalendar.detail.rosterChange.erasures.title', { count: 1 })).toBe('Promjena briše 1 konflikt');
    expect(t('kalendar.detail.rosterChange.erasures.removed', { count: 2 })).toBe('Uklonjena 2 konflikta.');
  });

  it('stays bounded to the change\'s own date: the leave\'s other dates keep their conflicts', () => {
    const rows = rowsOf(plain, takeOff(VIEWER_MEMBER, A, '2026-09-11'), [recordOf('record-1', '2026-09-10', '2026-09-15')]);

    expect(rows.map((row) => row.date)).toEqual(['2026-09-11']);
  });

  it('writes the change newer than every instant, so it is in force as a real insert would be', () => {
    const applied = rosterChangeSnapshotOf(plain, takeOff(VIEWER_MEMBER, A, '2026-09-10'));

    if (!applied.ok) throw new Error(applied.code);

    const added = applied.after.rosterOverrides.find((override) => override.id === PENDING_ROSTER_CHANGE_ID);

    expect(instantMicrosOf(added?.createdAt)).toBe(latestInstantOf(plain) + 1);
    expect(rosterStandingOfCalendar(applied.after).inForce.map((override) => override.id)).toEqual([PENDING_ROSTER_CHANGE_ID]);
    expect(applied.from).toBe('2026-09-10');
    // The snapshot as read is left as it was.
    expect(plain.rosterOverrides).toEqual([]);
  });
});

describe('Remove put-on', () => {
  it('lists the conflict of a member on leave an override put on, once that override is removed', async () => {
    // Smjena A is off on 13.09; the override puts the viewer on Smjena B's Dan.
    const snapshot = await calendarOf([calendarRosterOverrideRow('put-on', B, '2026-09-13', null, VIEWER_MEMBER)]);
    const rows = rowsOf(snapshot, removal('put-on'), [recordOf('record-1', '2026-09-13', '2026-09-14')]);

    expect(rows).toEqual([expect.objectContaining({ date: '2026-09-13', teamName: 'Smjena B', shiftTypeName: 'Dan', teamWorks: true })]);
  });
});

describe('Swap', () => {
  it('lists the member on leave taken off, and never the member on leave put on: an added collision is no erasure', () => {
    const swap: RosterChange = { kind: ROSTER_CHANGE_SAVE, teamId: A, date: '2026-09-10', memberOutId: VIEWER_MEMBER, memberInId: ANA };
    const rows = rowsOf(plain, swap, [
      recordOf('record-1', '2026-09-10', '2026-09-11'),
      recordOf('record-ana', '2026-09-10', '2026-09-11', ANA),
    ]);

    expect(rows.map((row) => [row.memberId, row.teamId])).toEqual([[VIEWER_MEMBER, A]]);
  });
});

describe('several erasures', () => {
  it('orders them by date, then team, then member name', async () => {
    // Before: Ana put on Smjena A's Dan on 10.09, beside the viewer; Ana's own
    // Smjena B works Noć that day. After: everyone taken off 10.09, and the
    // viewer off Smjena A's Noć on 11.09.
    const before = await calendarOf([calendarRosterOverrideRow('ana-on-a', A, '2026-09-10', null, ANA)]);
    const createdAt = isoInstantOf(latestInstantOf(before) + 1);
    const off = (id: string, teamId: string, date: string, memberId: string) => ({
      id,
      teamId,
      date,
      memberOutId: memberId,
      memberInId: null,
      reason: '',
      createdAt,
      authorMemberId: null,
    });
    const after: CalendarSnapshot = {
      ...before,
      rosterOverrides: [
        off('viewer-a-10', A, '2026-09-10', VIEWER_MEMBER),
        off('ana-b-10', B, '2026-09-10', ANA),
        off('viewer-a-11', A, '2026-09-11', VIEWER_MEMBER),
      ],
    };
    const rows = erasuresOf(
      before,
      after,
      '2026-09-01',
      [recordOf('record-1', '2026-09-10', '2026-09-12'), recordOf('record-ana', '2026-09-10', '2026-09-11', ANA)],
      [],
    );

    expect(rows.map((row) => [row.date, row.teamName, row.memberName])).toEqual([
      ['2026-09-10', 'Smjena A', 'Ana Anić'],
      ['2026-09-10', 'Smjena A', VIEWER_NAME],
      ['2026-09-10', 'Smjena B', 'Ana Anić'],
      ['2026-09-11', 'Smjena A', VIEWER_NAME],
    ]);
  });
});

describe('No erasure', () => {
  it('erases nothing when the member taken off is not on leave', () => {
    expect(rowsOf(plain, takeOff(ANA, B, '2026-09-10'), [recordOf('record-1', '2026-09-10', '2026-09-12')])).toEqual([]);
  });

  it('erases nothing when a member is only put on', () => {
    const putOn: RosterChange = { kind: ROSTER_CHANGE_SAVE, teamId: B, date: '2026-09-13', memberOutId: null, memberInId: VIEWER_MEMBER };

    expect(rowsOf(plain, putOn, [recordOf('record-1', '2026-09-13', '2026-09-14')])).toEqual([]);
  });
});

describe('Resolved', () => {
  it('does not list a conflict already decided', () => {
    const rows = rowsOf(plain, takeOff(VIEWER_MEMBER, A, '2026-09-10'), [recordOf('record-1', '2026-09-10', '2026-09-11')], [
      resolutionOf(VIEWER_MEMBER, '2026-09-10', A),
    ]);

    expect(rows).toEqual([]);
  });
});

describe('Remove take-off', () => {
  it('erases nothing when the override removed took someone off: it only adds', async () => {
    const snapshot = await calendarOf([calendarRosterOverrideRow('took-off', A, '2026-09-10', VIEWER_MEMBER, null)]);

    expect(rowsOf(snapshot, removal('took-off'), [recordOf('record-1', '2026-09-10', '2026-09-11')])).toEqual([]);
  });
});

describe('Replace link', () => {
  it('erases nothing when the override behind a replacement is removed', async () => {
    const snapshot = await calendarOf([calendarRosterOverrideRow('replace', A, '2026-09-10', VIEWER_MEMBER, ANA)]);
    const rows = rowsOf(snapshot, removal('replace'), [recordOf('record-1', '2026-09-10', '2026-09-11')], [
      resolutionOf(VIEWER_MEMBER, '2026-09-10', A, 'replace_member', 'replace'),
    ]);

    expect(rows).toEqual([]);
  });

  it('erases nothing when an applied replacement that only adds is removed: its conflict comes back instead (story 5.5d)', async () => {
    const snapshot = await calendarOf([calendarRosterOverrideRow('replace', A, '2026-09-10', null, ANA)]);
    const rows = rowsOf(snapshot, removal('replace'), [recordOf('record-1', '2026-09-10', '2026-09-11')], [
      resolutionOf(VIEWER_MEMBER, '2026-09-10', A, 'replace_member', 'replace'),
    ]);

    expect(rows).toEqual([]);
  });

  it('Erasure before: a replacement that does not apply before the change, and applies after it, erases nothing (story 5.5d)', async () => {
    // Pending before (written before the seeded rotation's stamp); in force after.
    const before = await calendarOf([
      calendarRosterOverrideRow('replace', A, '2026-09-10', null, ANA, { createdAt: '2019-01-01T00:00:00+00:00' }),
    ]);
    const after = await calendarOf([calendarRosterOverrideRow('replace', A, '2026-09-10', null, ANA)]);

    expect(rosterStandingOfCalendar(before).inForce).toEqual([]);
    expect(
      erasuresOf(before, after, '2026-09-10', [recordOf('record-1', '2026-09-10', '2026-09-11')], [
        resolutionOf(VIEWER_MEMBER, '2026-09-10', A, 'replace_member', 'replace'),
      ]),
    ).toEqual([]);
  });
});

describe('refused anyway', () => {
  it('answers gone for a removal of an override no longer live', () => {
    expect(rosterChangeSnapshotOf(plain, removal('gone'))).toEqual({ ok: false, code: ROSTER_GONE });
  });

  it('answers taken for a save a live key holds: the member already taken off, or put on, that day', async () => {
    const snapshot = await calendarOf([
      calendarRosterOverrideRow('took-off', A, '2026-09-10', VIEWER_MEMBER, null),
      calendarRosterOverrideRow('put-on', B, '2026-09-13', null, VIEWER_MEMBER),
    ]);
    const putOn: RosterChange = { kind: ROSTER_CHANGE_SAVE, teamId: B, date: '2026-09-13', memberOutId: ANA, memberInId: VIEWER_MEMBER };

    expect(rosterChangeSnapshotOf(snapshot, takeOff(VIEWER_MEMBER, A, '2026-09-10'))).toEqual({ ok: false, code: ROSTER_TAKEN });
    expect(rosterChangeSnapshotOf(snapshot, putOn)).toEqual({ ok: false, code: ROSTER_TAKEN });
    // Another day, or another team, is no live key of theirs.
    expect(rosterChangeSnapshotOf(snapshot, takeOff(VIEWER_MEMBER, A, '2026-09-11')).ok).toBe(true);
  });
});

describe('rosterErasureCheckOf', () => {
  const LEAVE = [recordOf('record-1', '2026-09-10', '2026-09-11')];

  function readsOf(overrides: Partial<ErasureReads> = {}): () => Promise<ErasureReads> {
    return () => Promise.resolve({ calendar: plain, records: LEAVE, resolutions: [], ...overrides });
  }

  it('answers the rows the change would erase', async () => {
    const check = await rosterErasureCheckOf(readsOf(), takeOff(VIEWER_MEMBER, A, '2026-09-10'), true);

    expect(check).toEqual({ kind: CHECK_READY, rows: [expect.objectContaining({ date: '2026-09-10', teamId: A })] });
  });

  it('answers refused, with the write\'s own code, for a write the database would refuse anyway', async () => {
    expect(await rosterErasureCheckOf(readsOf(), removal('gone'), true)).toEqual({ kind: CHECK_REFUSED, code: ROSTER_GONE });
  });

  it('answers unavailable, never refused, for any other fault of the change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Not a calendar date: the diff refuses it, so nothing is written unchecked.
    const check = await rosterErasureCheckOf(readsOf(), takeOff(VIEWER_MEMBER, A, '2026-02-30'), true);

    expect(check).toEqual({ kind: CHECK_UNAVAILABLE });
  });

  it('answers unavailable offline, without reading', async () => {
    const read = vi.fn(readsOf());

    expect(await rosterErasureCheckOf(read, takeOff(VIEWER_MEMBER, A, '2026-09-10'), false)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(read).not.toHaveBeenCalled();
  });

  it('answers unavailable, logged, when a read rejects', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const check = await rosterErasureCheckOf(() => Promise.reject(new Error('500')), takeOff(VIEWER_MEMBER, A, '2026-09-10'), true);

    expect(check).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(logged).toHaveBeenCalled();
  });

  it('answers unavailable when a row cannot be trusted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const check = await rosterErasureCheckOf(
      readsOf({ resolutions: [resolutionOf('stranger', '2026-09-10', A)] }),
      takeOff(VIEWER_MEMBER, A, '2026-09-10'),
      true,
    );

    expect(check).toEqual({ kind: CHECK_UNAVAILABLE });
  });
});
