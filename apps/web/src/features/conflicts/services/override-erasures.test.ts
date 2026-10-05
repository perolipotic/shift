import { collisionKeyOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { overrideStandingOfCalendar } from '@/features/calendar/utils/month';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  type ErasureReads,
} from '@/features/conflicts/services/erasure-check';
import { erasuresOf, latestInstantOf, type ErasureRow } from '@/features/conflicts/services/erasures';
import {
  OVERRIDE_CHANGE_AMEND,
  OVERRIDE_CHANGE_ARCHIVED,
  OVERRIDE_CHANGE_CONFIRM,
  OVERRIDE_CHANGE_GONE,
  OVERRIDE_CHANGE_REMOVE,
  OVERRIDE_CHANGE_SAME_AS_PROJECTED,
  OVERRIDE_CHANGE_SET,
  OVERRIDE_CHANGE_TAKEN,
  UNWRITTEN_OVERRIDE_ID,
  overrideChangeSnapshotOf,
  overrideErasureCheckOf,
  type OverrideChange,
} from '@/features/conflicts/services/override-erasures';
import { instantMicrosOf } from '@/features/rotation/services/list';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
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
 * Story 5.5f's shift-type override guard, executed (AD-15): every row of the
 * spec's matrix but "Keep" and "Read failed" (the e2e spec's), over the
 * pilot fixture — `[Dan, Noć, Slobodno, Slobodno]`, the viewer on Smjena A,
 * which works Dan 10.09, Noć 11.09, is free 12.09 and 13.09 and works Dan
 * 14.09; Ana on Smjena B unless a case moves her. The rotation versions were
 * saved at `SEEDED_AT` (2019-12-20): an override written before that is
 * pending review, one written after it is in force.
 */

const ANA = '00000000-0000-4000-8000-0000000000c1';
const A = 'pilot-smjena-a';
const B = 'pilot-smjena-b';
const DAN = 'pilot-dan';
const NOC = 'pilot-noc';
const SLOBODNO = 'pilot-slobodno';
/** Before the rotation versions were saved: an override written then is pending review. */
const BEFORE_VERSIONS = '2019-12-01T08:00:00+00:00';

type Row = Record<string, unknown>;

async function calendarOf(overrides: readonly Row[] = [], anaTeam: string = B): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, A, SEEDED), memberMembershipRow(ANA, anaTeam, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(ANA, 'Ana Anić')]),
    overridesAnswerOf(overrides),
    rosterOverridesAnswerOf([]),
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
function resolutionOf(memberId: string, date: string, teamId: string): Row {
  return { member_id: memberId, date, team_id: teamId, kind: 'accept_uncovered', roster_override_id: null };
}

function set(teamId: string, date: string, shiftTypeId: string): OverrideChange {
  return { kind: OVERRIDE_CHANGE_SET, teamId, date, shiftTypeId };
}

function remove(overrideId: string): OverrideChange {
  return { kind: OVERRIDE_CHANGE_REMOVE, overrideId };
}

function confirm(overrideId: string): OverrideChange {
  return { kind: OVERRIDE_CHANGE_CONFIRM, overrideId };
}

function amend(overrideId: string, shiftTypeId: string): OverrideChange {
  return { kind: OVERRIDE_CHANGE_AMEND, overrideId, shiftTypeId };
}

/** The rows `change` would erase over `calendar`, as the check derives them. */
function rowsOf(
  calendar: CalendarSnapshot,
  change: OverrideChange,
  records: readonly Row[],
  resolutions: readonly Row[] = [],
): readonly ErasureRow[] {
  const applied = overrideChangeSnapshotOf(calendar, change);

  if (!applied.ok) throw new Error(applied.code);

  return erasuresOf(calendar, applied.after, applied.from, records, resolutions);
}

const LEAVE_10 = [recordOf('record-1', '2026-09-10', '2026-09-11')];

let plain: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await calendarOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Set non-working', () => {
  it('lists the conflict of a member on leave whose working day the override makes free', () => {
    const rows = rowsOf(plain, set(A, '2026-09-10', SLOBODNO), LEAVE_10);

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
        // A shift-type override never changes who is rostered: the team is free.
        teamWorks: false,
      },
    ]);
  });

  it('words a row in the calendar override\'s own terms', () => {
    const [row] = rowsOf(plain, set(A, '2026-09-10', SLOBODNO), LEAVE_10);

    if (row === undefined) throw new Error('no row');

    expect(t('kalendar.detail.override.erasures.rowFree', { member: row.memberName, team: row.teamName })).toBe(
      `${VIEWER_NAME} na godišnjem · nakon promjene: Smjena A taj dan slobodna`,
    );
    expect(t('kalendar.detail.override.erasures.title', { count: 1 })).toBe('Promjena briše 1 konflikt');
    expect(t('kalendar.detail.override.erasures.removed', { count: 2 })).toBe('Uklonjena 2 konflikta.');
  });

  it('stays bounded to the override\'s own date: the leave\'s other dates keep their conflicts', () => {
    const rows = rowsOf(plain, set(A, '2026-09-11', SLOBODNO), [recordOf('record-1', '2026-09-10', '2026-09-15')]);

    expect(rows.map((row) => row.date)).toEqual(['2026-09-11']);
  });

  it('writes the override newer than every instant and never confirmed, so it is in force', () => {
    const applied = overrideChangeSnapshotOf(plain, set(A, '2026-09-10', SLOBODNO));

    if (!applied.ok) throw new Error(applied.code);

    const added = applied.after.overrides.find((override) => override.id === UNWRITTEN_OVERRIDE_ID);

    expect(instantMicrosOf(added?.createdAt)).toBe(latestInstantOf(plain) + 1);
    expect(added?.confirmedAt).toBeNull();
    expect(overrideStandingOfCalendar(applied.after).inForce.map((override) => override.id)).toEqual([
      UNWRITTEN_OVERRIDE_ID,
    ]);
    expect(applied.from).toBe('2026-09-10');
    // A new object, and the snapshot as read left as it was.
    expect(applied.after).not.toBe(plain);
    expect(plain.overrides).toEqual([]);
  });
});

describe('Two on leave', () => {
  it('lists one row per member of the team on leave, ordered by member name', async () => {
    const both = await calendarOf([], A);
    const rows = rowsOf(both, set(A, '2026-09-10', SLOBODNO), [...LEAVE_10, recordOf('record-ana', '2026-09-10', '2026-09-11', ANA)]);

    expect(rows.map((row) => row.memberName)).toEqual(['Ana Anić', VIEWER_NAME]);
  });
});

describe('Working→working', () => {
  it('erases nothing when the override names another working type: the key stays', () => {
    expect(rowsOf(plain, set(A, '2026-09-10', NOC), LEAVE_10)).toEqual([]);
  });

  it('erases nothing when a free day is made working: it only adds', () => {
    expect(rowsOf(plain, set(A, '2026-09-12', DAN), [recordOf('record-1', '2026-09-12', '2026-09-13')])).toEqual([]);
  });
});

describe('Remove makes free', () => {
  it('lists the conflict an in-force override raised on a free day, once it is removed', async () => {
    const snapshot = await calendarOf([calendarOverrideRow('made-dan', A, '2026-09-12', DAN)]);
    const rows = rowsOf(snapshot, remove('made-dan'), [recordOf('record-1', '2026-09-12', '2026-09-13')]);

    expect(rows).toEqual([
      expect.objectContaining({ date: '2026-09-12', teamName: 'Smjena A', shiftTypeName: 'Dan', teamWorks: false }),
    ]);
  });

  it('filters the override out by id, into a new object', async () => {
    const snapshot = await calendarOf([calendarOverrideRow('made-dan', A, '2026-09-12', DAN)]);
    const applied = overrideChangeSnapshotOf(snapshot, remove('made-dan'));

    if (!applied.ok) throw new Error(applied.code);

    expect(applied.after.overrides).toEqual([]);
    expect(applied.from).toBe('2026-09-12');
    expect(snapshot.overrides).toHaveLength(1);
  });
});

describe('Remove pending', () => {
  it('erases nothing when the override removed is pending review: it was not applied', async () => {
    const snapshot = await calendarOf([
      calendarOverrideRow('pending-dan', A, '2026-09-12', DAN, { createdAt: BEFORE_VERSIONS }),
    ]);

    expect(rowsOf(snapshot, remove('pending-dan'), [recordOf('record-1', '2026-09-12', '2026-09-13')])).toEqual([]);
  });

  it('answers ready with no rows through the check, so a removal pending in fresh data opens nothing', async () => {
    const snapshot = await calendarOf([
      calendarOverrideRow('pending-dan', A, '2026-09-12', DAN, { createdAt: BEFORE_VERSIONS }),
    ]);
    const check = await overrideErasureCheckOf(
      () => Promise.resolve({ calendar: snapshot, records: [recordOf('record-1', '2026-09-12', '2026-09-13')], resolutions: [] }),
      remove('pending-dan'),
      true,
    );

    expect(check).toEqual({ kind: CHECK_READY, rows: [] });
  });
});

describe('a set on a date no version governs', () => {
  it('is written pending, applied nowhere, and erases nothing', () => {
    // The versions are effective from 2020-01-01: 2019-06-03 is before any.
    const applied = overrideChangeSnapshotOf(plain, set(A, '2019-06-03', SLOBODNO));

    if (!applied.ok) throw new Error(applied.code);

    expect(overrideStandingOfCalendar(applied.after).pending.map((override) => override.id)).toEqual([UNWRITTEN_OVERRIDE_ID]);
    expect(rowsOf(plain, set(A, '2019-06-03', SLOBODNO), [recordOf('record-1', '2019-06-03', '2019-06-04')])).toEqual([]);
  });
});

describe('Resolved', () => {
  it('does not list a conflict already decided', () => {
    expect(rowsOf(plain, set(A, '2026-09-10', SLOBODNO), LEAVE_10, [resolutionOf(VIEWER_MEMBER, '2026-09-10', A)])).toEqual(
      [],
    );
  });
});

describe('Helper confirm/amend', () => {
  it('confirm puts a pending non-working override in force, and the diff lists the erasure', async () => {
    const snapshot = await calendarOf([
      calendarOverrideRow('pending-free', A, '2026-09-10', SLOBODNO, { createdAt: BEFORE_VERSIONS }),
    ]);
    const applied = overrideChangeSnapshotOf(snapshot, confirm('pending-free'));

    if (!applied.ok) throw new Error(applied.code);

    const confirmed = applied.after.overrides.find((override) => override.id === 'pending-free');

    expect(instantMicrosOf(confirmed?.confirmedAt)).toBe(latestInstantOf(snapshot) + 1);
    expect(overrideStandingOfCalendar(applied.after).inForce.map((override) => override.id)).toEqual(['pending-free']);
    expect(rowsOf(snapshot, confirm('pending-free'), LEAVE_10)).toEqual([
      expect.objectContaining({ date: '2026-09-10', teamId: A, shiftTypeName: 'Dan', teamWorks: false }),
    ]);
  });

  it('amend replaces the override with a new one of the new type, in force, and the diff lists the erasure', async () => {
    const snapshot = await calendarOf([
      calendarOverrideRow('pending-noc', A, '2026-09-10', NOC, { createdAt: BEFORE_VERSIONS }),
    ]);
    const applied = overrideChangeSnapshotOf(snapshot, amend('pending-noc', SLOBODNO));

    if (!applied.ok) throw new Error(applied.code);

    expect(applied.after.overrides).toEqual([
      expect.objectContaining({ id: UNWRITTEN_OVERRIDE_ID, teamId: A, date: '2026-09-10', shiftTypeId: SLOBODNO, confirmedAt: null }),
    ]);
    expect(instantMicrosOf(applied.after.overrides[0]?.createdAt)).toBe(latestInstantOf(snapshot) + 1);
    expect(overrideStandingOfCalendar(applied.after).inForce.map((override) => override.id)).toEqual([
      UNWRITTEN_OVERRIDE_ID,
    ]);
    expect(rowsOf(snapshot, amend('pending-noc', SLOBODNO), LEAVE_10)).toEqual([
      expect.objectContaining({ date: '2026-09-10', teamId: A, teamWorks: false }),
    ]);
  });

  it('confirm of an override already in force erases nothing', async () => {
    const snapshot = await calendarOf([calendarOverrideRow('in-force-free', A, '2026-09-10', SLOBODNO)]);

    expect(rowsOf(snapshot, confirm('in-force-free'), LEAVE_10)).toEqual([]);
  });

  it('amend of an in-force working override to a free type lists the erasure', async () => {
    const snapshot = await calendarOf([calendarOverrideRow('in-force-noc', A, '2026-09-10', NOC)]);

    expect(rowsOf(snapshot, amend('in-force-noc', SLOBODNO), LEAVE_10)).toEqual([
      expect.objectContaining({ date: '2026-09-10', teamId: A, shiftTypeName: 'Noć', teamWorks: false }),
    ]);
  });

  it('amend to the type the rotation projects is refused as the preflight refuses it, never derived', async () => {
    const snapshot = await calendarOf([calendarOverrideRow('in-force-free', A, '2026-09-10', SLOBODNO)]);

    expect(overrideChangeSnapshotOf(snapshot, amend('in-force-free', DAN))).toEqual({
      ok: false,
      code: OVERRIDE_CHANGE_SAME_AS_PROJECTED,
    });
    expect(
      await overrideErasureCheckOf(
        () => Promise.resolve({ calendar: snapshot, records: LEAVE_10, resolutions: [] }),
        amend('in-force-free', DAN),
        true,
      ),
    ).toEqual({ kind: CHECK_REFUSED, code: OVERRIDE_CHANGE_SAME_AS_PROJECTED });
  });

  it('amend to a working type erases nothing', async () => {
    const snapshot = await calendarOf([
      calendarOverrideRow('pending-free', A, '2026-09-10', SLOBODNO, { createdAt: BEFORE_VERSIONS }),
    ]);

    expect(rowsOf(snapshot, amend('pending-free', NOC), LEAVE_10)).toEqual([]);
  });
});

describe('refused anyway', () => {
  it('answers taken for a set whose team and date a live override already holds, pending or in force', async () => {
    const snapshot = await calendarOf([
      calendarOverrideRow('in-force', A, '2026-09-10', NOC),
      calendarOverrideRow('pending', B, '2026-09-10', DAN, { createdAt: BEFORE_VERSIONS }),
    ]);

    expect(overrideChangeSnapshotOf(snapshot, set(A, '2026-09-10', SLOBODNO))).toEqual({ ok: false, code: OVERRIDE_CHANGE_TAKEN });
    expect(overrideChangeSnapshotOf(snapshot, set(B, '2026-09-10', SLOBODNO))).toEqual({ ok: false, code: OVERRIDE_CHANGE_TAKEN });
    // Another day is no live key of theirs.
    expect(overrideChangeSnapshotOf(snapshot, set(A, '2026-09-11', SLOBODNO)).ok).toBe(true);
  });

  it.each([remove('gone'), confirm('gone'), amend('gone', SLOBODNO)])('answers gone for $kind of an override no longer live', (change) => {
    expect(overrideChangeSnapshotOf(plain, change)).toEqual({ ok: false, code: OVERRIDE_CHANGE_GONE });
  });

  it('answers archived for a confirm or amend on an archived team or type, never for a removal', async () => {
    const snapshot = await calendarOf([calendarOverrideRow('free', A, '2026-09-10', SLOBODNO, { createdAt: BEFORE_VERSIONS })]);
    const archivedTeam: CalendarSnapshot = {
      ...snapshot,
      teams: snapshot.teams.map((team) => (team.id === A ? { ...team, archived: true } : team)),
    };
    const archivedType: CalendarSnapshot = {
      ...snapshot,
      types: snapshot.types.map((type) => (type.id === NOC ? { ...type, archived: true } : type)),
    };

    expect(overrideChangeSnapshotOf(archivedTeam, confirm('free'))).toEqual({ ok: false, code: OVERRIDE_CHANGE_ARCHIVED });
    expect(overrideChangeSnapshotOf(archivedTeam, amend('free', NOC))).toEqual({ ok: false, code: OVERRIDE_CHANGE_ARCHIVED });
    // An archived type with the team live: refused all the same.
    expect(archivedType.teams.find((team) => team.id === A)?.archived).toBe(false);
    expect(overrideChangeSnapshotOf(archivedType, amend('free', NOC))).toEqual({ ok: false, code: OVERRIDE_CHANGE_ARCHIVED });
    // The type it names now is not archived: confirming it goes ahead.
    expect(overrideChangeSnapshotOf(archivedType, confirm('free')).ok).toBe(true);
    expect(overrideChangeSnapshotOf(archivedTeam, remove('free')).ok).toBe(true);
  });
});

describe('overrideErasureCheckOf', () => {
  function readsOf(overrides: Partial<ErasureReads> = {}): () => Promise<ErasureReads> {
    return () => Promise.resolve({ calendar: plain, records: LEAVE_10, resolutions: [], ...overrides });
  }

  it('answers the rows the change would erase', async () => {
    const check = await overrideErasureCheckOf(readsOf(), set(A, '2026-09-10', SLOBODNO), true);

    expect(check).toEqual({ kind: CHECK_READY, rows: [expect.objectContaining({ date: '2026-09-10', teamId: A })] });
  });

  it('answers refused, with the write\'s own code, for a write the database would refuse anyway', async () => {
    expect(await overrideErasureCheckOf(readsOf(), remove('gone'), true)).toEqual({
      kind: CHECK_REFUSED,
      code: OVERRIDE_CHANGE_GONE,
    });
  });

  it('answers unavailable, never refused, for any other fault of the change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await overrideErasureCheckOf(readsOf(), set(A, '2026-02-30', SLOBODNO), true)).toEqual({ kind: CHECK_UNAVAILABLE });
  });

  it('answers unavailable offline, without reading', async () => {
    const read = vi.fn(readsOf());

    expect(await overrideErasureCheckOf(read, set(A, '2026-09-10', SLOBODNO), false)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(read).not.toHaveBeenCalled();
  });

  it('answers unavailable, logged, when a read rejects', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const check = await overrideErasureCheckOf(() => Promise.reject(new Error('500')), set(A, '2026-09-10', SLOBODNO), true);

    expect(check).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(logged).toHaveBeenCalled();
  });

  it('answers unavailable when a row cannot be trusted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const check = await overrideErasureCheckOf(
      readsOf({ resolutions: [resolutionOf('stranger', '2026-09-10', A)] }),
      set(A, '2026-09-10', SLOBODNO),
      true,
    );

    expect(check).toEqual({ kind: CHECK_UNAVAILABLE });
  });
});
