import { collisionKeyOf, overrideStandingOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { overrideStandingOfCalendar, rosterStandingOfCalendar } from '@/features/calendar/utils/month';
import { readRotation, type RotationSnapshot } from '@/features/rotation/services/list';
import {
  ERASURES_UNAVAILABLE,
  ERASURE_CONFIRMED,
  ERASURE_KEPT,
  erasureKeptOf,
  erasuresOf as sharedErasuresOf,
  erasuresConfirmedOf,
  sameErasuresOf,
  type ErasureRow,
} from '@/features/conflicts/services/erasures';
import {
  cancelledCalendarSnapshotOf,
  draftCalendarSnapshotOf,
  rotationCancelErasuresOf,
  rotationCancelErasuresOutcomeOf,
  rotationErasuresOf,
  rotationErasuresOutcomeOf,
} from '@/features/rotation/services/erasures';
import { prefillOf, withEffectiveFrom, withTeamStep, type RotationDraft } from '@/features/rotation/utils/draft';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  answerOf,
  assignmentRow,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  rotationTableOf,
  statusRow,
  teamRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 5.5a's erasure check, executed (AD-15): every row of the spec's
 * matrix but "Changed meanwhile" and "Read failed" (the builder's and the e2e
 * spec's), over the pilot fixture — `[Dan, Noć, Slobodno, Slobodno]`, the
 * viewer on Smjena A, which works Dan 10.09, Noć 11.09 and Dan 14.09, and Ana
 * on Smjena B.
 */

const ANA = '00000000-0000-4000-8000-0000000000c1';

type Row = Record<string, unknown>;

function teamOf(rows: FixtureRows, index: number): string {
  const id = rows.teams[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no team ${String(index)}`);

  return id;
}

const A = teamOf(PILOT, 0);
const B = teamOf(PILOT, 1);

async function calendarOf(
  rows: FixtureRows,
  rosterOverrides: readonly Row[] = [],
  { overrides = [] as readonly Row[], statuses = [] as readonly Row[], anaTeam = null as string | null } = {},
): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow([membershipRow(teamOf(rows, 0), SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, teamOf(rows, 0), SEEDED), memberMembershipRow(ANA, anaTeam ?? teamOf(rows, 1), SEEDED)],
          statuses,
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(ANA, 'Ana Anić')]),
    overridesAnswerOf(overrides),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

async function rotationOf(rows: FixtureRows): Promise<RotationSnapshot> {
  const outcome = await readRotation(rotationTableOf(answerOf(rows)));

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A row as `leave_records` answers it: the range canonical, its upper bound exclusive. */
function recordOf(id: string, from: string, toExclusive: string, memberId: string = VIEWER_MEMBER): Row {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}

/** A resolution row as `conflict_resolutions` answers it. */
function resolutionOf(memberId: string, date: string, teamId: string, kind = 'accept_uncovered'): Row {
  return { member_id: memberId, date, team_id: teamId, kind };
}

/** The rotation in force, re-expressed as a draft: the same projection, applying from `from`. */
function sameRotationFrom(from: string): RotationDraft {
  return withEffectiveFrom(prefillOf(rotation, from), from);
}

/** Every team free on every date, from `from`. */
function allFreeFrom(from: string): RotationDraft {
  return { ...sameRotationFrom(from), steps: ['pilot-slobodno'], keys: ['step-0'], offsets: Object.fromEntries(PILOT.teams.map((team) => [team['id'], 0])) };
}

let calendar: CalendarSnapshot;
let rotation: RotationSnapshot;

beforeAll(async () => {
  await initLocalization();
  calendar = await calendarOf(PILOT);
  rotation = await rotationOf(PILOT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function erasuresOf(draft: RotationDraft, records: readonly Row[], resolutions: readonly Row[] = [], snapshot = calendar): readonly ErasureRow[] {
  return rotationErasuresOf(snapshot, rotation, draft, records, resolutions);
}

describe('Erases', () => {
  const leave = [recordOf('record-1', '2026-09-10', '2026-09-12')];

  it('lists both conflicts a free day takes away, each with its parts, by date', () => {
    const rows = erasuresOf(allFreeFrom('2026-09-01'), leave);

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
        teamWorks: false,
      },
      expect.objectContaining({ date: '2026-09-11', shiftTypeName: 'Noć', weekday: 'petak', teamWorks: false }),
    ]);
  });

  it('words a row as the mockup does', () => {
    const [row] = erasuresOf(allFreeFrom('2026-09-01'), leave);

    if (row === undefined) throw new Error('no row');

    expect(t('rotation.builder.erasures.rowTitle', { team: row.teamName, weekday: row.weekday, date: row.dayMonth, type: row.shiftTypeName })).toBe(
      'Smjena A · četvrtak 10.09. · Dan',
    );
    expect(t('rotation.builder.erasures.rowFree', { member: row.memberName, team: row.teamName })).toBe(
      `${VIEWER_NAME} na godišnjem · nova rotacija: Smjena A taj dan slobodna`,
    );
    expect(t('rotation.builder.erasures.title', { count: 2 })).toBe('Promjena briše 2 konflikta');
    expect(t('rotation.builder.erasures.title', { count: 5 })).toBe('Promjena briše 5 konflikata');
    expect(t('rotation.builder.erasures.lede', { count: 1 })).toBe(
      'Ova promjena uklanja uzrok 1 neriješenog konflikta. Prije spremanja odluči za svaki.',
    );
  });

  it('orders rows by date, then team, whoever is on leave', () => {
    // Ana's Smjena B works Noć 10.09 and Dan 13.09.
    const rows = erasuresOf(allFreeFrom('2026-09-01'), [...leave, recordOf('record-ana', '2026-09-10', '2026-09-11', ANA)]);

    expect(rows.map((row) => [row.date, row.teamName])).toEqual([
      ['2026-09-10', 'Smjena A'],
      ['2026-09-10', 'Smjena B'],
      ['2026-09-11', 'Smjena A'],
    ]);
  });
});

describe('No erasure', () => {
  it('erases nothing when the draft changes only dates without leave', () => {
    // Smjena B moves; only the viewer on Smjena A is on leave.
    const draft = withTeamStep(sameRotationFrom('2026-09-01'), B, 3);

    expect(erasuresOf(draft, [recordOf('record-1', '2026-09-10', '2026-09-15')])).toEqual([]);
  });

  it('erases nothing with no leave at all', () => {
    expect(erasuresOf(allFreeFrom('2026-09-01'), [])).toEqual([]);
  });
});

describe('Before effective', () => {
  it('never lists a conflict dated before the change applies', () => {
    const rows = erasuresOf(allFreeFrom('2026-09-12'), [recordOf('record-1', '2026-09-10', '2026-09-15')]);

    expect(rows.map((row) => row.date)).toEqual(['2026-09-14']);
  });
});

describe('Resolved', () => {
  it('does not list a resolved conflict on an erased date', () => {
    const rows = erasuresOf(allFreeFrom('2026-09-01'), [recordOf('record-1', '2026-09-10', '2026-09-12')], [
      resolutionOf(VIEWER_MEMBER, '2026-09-10', A),
    ]);

    expect(rows.map((row) => row.date)).toEqual(['2026-09-11']);
  });
});

describe('Added', () => {
  it('never lists a collision the draft adds', () => {
    // Every team works Dan every day: 12.09 and 13.09 collide anew, and the
    // three existing keys stay (the shift type alone changes on 11.09).
    const draft = { ...allFreeFrom('2026-09-01'), steps: ['pilot-dan'] };

    expect(erasuresOf(draft, [recordOf('record-1', '2026-09-10', '2026-09-15')])).toEqual([]);
  });
});

describe('Override pending', () => {
  it('lists the conflict of a roster override that the save makes pending, the team still working', async () => {
    // Smjena B works Dan 13.09, the viewer's Smjena A is off: the override
    // puts the viewer on it. The same rotation saved from 01.09 leaves it pending.
    const snapshot = await calendarOf(PILOT, [calendarRosterOverrideRow('put-on', B, '2026-09-13', null, VIEWER_MEMBER)]);
    const rows = erasuresOf(sameRotationFrom('2026-09-01'), [recordOf('record-1', '2026-09-13', '2026-09-14')], [], snapshot);

    expect(rows).toEqual([expect.objectContaining({ date: '2026-09-13', teamName: 'Smjena B', shiftTypeName: 'Dan', teamWorks: true })]);
    expect(t('rotation.builder.erasures.rowWithout', { member: VIEWER_NAME, team: 'Smjena B' })).toBe(
      `${VIEWER_NAME} na godišnjem · nova rotacija: Smjena B taj dan bez ${VIEWER_NAME}`,
    );
  });

  it('keeps an override dated before the effective date in force', async () => {
    const snapshot = await calendarOf(PILOT, [calendarRosterOverrideRow('put-on', B, '2026-09-13', null, VIEWER_MEMBER)]);

    expect(erasuresOf(sameRotationFrom('2026-09-14'), [recordOf('record-1', '2026-09-13', '2026-09-14')], [], snapshot)).toEqual([]);
  });
});

describe('whether the team still works is the team\'s own (review)', () => {
  it('says the team works without the member when the member on leave is not the viewer', async () => {
    // Ana is on Smjena B, off on 11.09; the override puts her on Smjena A's Noć.
    const snapshot = await calendarOf(PILOT, [calendarRosterOverrideRow('put-on', A, '2026-09-11', null, ANA)]);
    const rows = erasuresOf(sameRotationFrom('2026-09-01'), [recordOf('record-ana', '2026-09-11', '2026-09-12', ANA)], [], snapshot);

    expect(rows).toEqual([
      expect.objectContaining({ memberName: 'Ana Anić', teamName: 'Smjena A', shiftTypeName: 'Noć', teamWorks: true }),
    ]);
  });
});

describe('a shift-type override from the effective date goes pending (review)', () => {
  it('lists the conflict a later override made, the override pending after the save', async () => {
    // Smjena A is off on 12.09; an override, written after everything else, makes it work Dan.
    const snapshot = await calendarOf(PILOT, [], {
      overrides: [calendarOverrideRow('worked', A, '2026-09-12', 'pilot-dan', { createdAt: '2026-09-30T08:00:00.654321+00:00' })],
    });
    const draft = sameRotationFrom('2026-09-01');
    const after = draftCalendarSnapshotOf(snapshot, rotation, draft);

    expect(overrideStandingOfCalendar(snapshot).inForce.map((override) => override.id)).toEqual(['worked']);
    expect(overrideStandingOfCalendar(after).pending.map((override) => override.id)).toEqual(['worked']);
    expect(erasuresOf(draft, [recordOf('record-1', '2026-09-12', '2026-09-13')], [], snapshot)).toEqual([
      expect.objectContaining({ date: '2026-09-12', teamName: 'Smjena A', shiftTypeName: 'Dan', teamWorks: false }),
    ]);
  });
});

describe('a deactivated member (review)', () => {
  it('is in the snapshot, so their leave and resolutions never make the check untrusted', async () => {
    // Ana leaves the organization on 05.09; her leave and a resolution on her still parse.
    const snapshot = await calendarOf(PILOT, [], { statuses: [statusRow(ANA, false, '2026-09-05')] });

    expect(snapshot.members.map((member) => member.id)).toContain(ANA);
    expect(
      rotationErasuresOutcomeOf(
        snapshot,
        rotation,
        allFreeFrom('2026-09-01'),
        [recordOf('record-ana', '2026-09-10', '2026-09-12', ANA), recordOf('record-1', '2026-09-10', '2026-09-11')],
        [resolutionOf(ANA, '2026-09-10', B)],
      ),
    ).toEqual({ ok: true, rows: [expect.objectContaining({ memberName: VIEWER_NAME, date: '2026-09-10' })] });
  });
});

describe('the snapshot after the save', () => {
  it('stamps each new version newer than every override, so those from the date on go pending', async () => {
    const snapshot = await calendarOf(PILOT, [
      calendarRosterOverrideRow('before', B, '2026-09-05', null, VIEWER_MEMBER, { createdAt: '2026-09-30T08:00:00.123456+00:00' }),
      calendarRosterOverrideRow('after', B, '2026-09-13', null, VIEWER_MEMBER),
    ]);
    const after = draftCalendarSnapshotOf(snapshot, rotation, sameRotationFrom('2026-09-10'));
    const added = after.assignmentStamps.slice(snapshot.assignmentStamps.length);

    expect(added.map((stamp) => [stamp.teamId, stamp.effectiveFrom])).toEqual(PILOT.teams.map((team) => [team['id'], '2026-09-10']));
    expect(after.assignments.slice(snapshot.assignments.length).every((assignment) => assignment.effectiveFrom === '2026-09-10')).toBe(true);
    expect(rosterStandingOfCalendar(snapshot).pending).toEqual([]);
    expect(rosterStandingOfCalendar(after).pending.map((override) => override.id)).toEqual(['after']);
    expect(overrideStandingOf(after.assignmentStamps, []).pending).toEqual([]);
  });

  it('leaves the snapshot as read unchanged', () => {
    const steps = calendar.steps.length;

    draftCalendarSnapshotOf(calendar, rotation, allFreeFrom('2026-09-01'));

    expect(calendar.steps).toHaveLength(steps);
  });
});

describe('not derivable', () => {
  it.each([
    ['a leave row that cannot be trusted', [{ id: 'x', member_id: 'stranger', during: '[2026-09-10,2026-09-11)' }], []],
    ['a resolution row that cannot be trusted', [recordOf('record-1', '2026-09-10', '2026-09-12')], [resolutionOf('stranger', '2026-09-10', A)]],
  ])('refuses the whole check for %s, and logs it', (_name, records, resolutions) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(rotationErasuresOutcomeOf(calendar, rotation, allFreeFrom('2026-09-01'), records, resolutions)).toEqual({
      ok: false,
      code: ERASURES_UNAVAILABLE,
    });
    expect(logged).toHaveBeenCalledWith(ERASURES_UNAVAILABLE, expect.any(RangeError));
  });

  it('refuses when a version is already dated the effective date', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduled = await calendarOf({
      ...PILOT,
      assignments: [...PILOT.assignments, assignmentRow(A, 'pilot-rotation', 'pilot-step-2', SEEDED, '2026-09-01')],
    });

    expect(rotationErasuresOutcomeOf(scheduled, rotation, allFreeFrom('2026-09-01'), [], [])).toEqual({ ok: false, code: ERASURES_UNAVAILABLE });
  });

  it('refuses when the rotation and the calendar disagree on the active teams', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wider = await rotationOf({ ...PILOT, teams: [...PILOT.teams, teamRow('pilot-smjena-e', 'Smjena E')] });

    expect(rotationErasuresOutcomeOf(calendar, wider, allFreeFrom('2026-09-01'), [], [])).toEqual({ ok: false, code: ERASURES_UNAVAILABLE });
  });

  it('answers the rows when it can be derived', () => {
    expect(rotationErasuresOutcomeOf(calendar, rotation, allFreeFrom('2026-09-01'), [recordOf('record-1', '2026-09-10', '2026-09-11')], [])).toEqual({
      ok: true,
      rows: [expect.objectContaining({ date: '2026-09-10' })],
    });
  });
});

describe('the decisions', () => {
  const rows = [{ key: 'one' }, { key: 'two' }] as unknown as readonly ErasureRow[];

  it('lets the save go only once every row is confirmed; nothing is preselected', () => {
    expect(erasuresConfirmedOf(rows, {})).toBe(false);
    expect(erasuresConfirmedOf(rows, { one: ERASURE_CONFIRMED })).toBe(false);
    expect(erasuresConfirmedOf(rows, { one: ERASURE_CONFIRMED, two: ERASURE_KEPT })).toBe(false);
    expect(erasuresConfirmedOf(rows, { one: ERASURE_CONFIRMED, two: ERASURE_CONFIRMED })).toBe(true);
  });

  it('says a row is kept only when one is', () => {
    expect(erasureKeptOf(rows, { one: ERASURE_CONFIRMED })).toBe(false);
    expect(erasureKeptOf(rows, { two: ERASURE_KEPT })).toBe(true);
  });

  it('compares two checks by their keys alone', () => {
    expect(sameErasuresOf(rows, [...rows].reverse())).toBe(true);
    expect(sameErasuresOf(rows, rows.slice(1))).toBe(false);
    expect(sameErasuresOf(rows, [rows[0]!, { key: 'three' } as unknown as ErasureRow])).toBe(false);
    // The same key, read differently, is not the row decided.
    const [one] = erasuresOf(allFreeFrom('2026-09-01'), [recordOf('record-1', '2026-09-10', '2026-09-11')]);

    if (one === undefined) throw new Error('no row');

    expect(sameErasuresOf([one], [{ ...one }])).toBe(true);
    expect(sameErasuresOf([one], [{ ...one, teamWorks: true }])).toBe(false);
    expect(sameErasuresOf([one], [{ ...one, shiftTypeName: 'Noć' }])).toBe(false);
    expect(sameErasuresOf([one], [{ ...one, memberName: 'Netko drugi' }])).toBe(false);
    // A conflict added meanwhile: the shown list is no longer the one to save over.
    expect(sameErasuresOf(rows, [...rows, { key: 'three' } as unknown as ErasureRow])).toBe(false);
    expect(sameErasuresOf([], [])).toBe(true);
  });
});

// ------------------------------------------------------------ the cancel (5.5g)

/**
 * Story 5.5g's cancel "after", executed: a change scheduled from 10.09 for
 * every active team, saved on 20.09 — after every override the cases write
 * (12.09 by default) — so those dated from 10.09 on are pending under it.
 * Under the version in force before, Smjena A works Dan 10.09, Noć 11.09 and
 * Dan 14.09; scheduled at step 2 it works Dan 12.09 and Noć 13.09 instead.
 */
const SCHEDULED = '2026-09-10';
const SCHEDULED_AT = '2026-09-20T10:00:00.000001+00:00';
/** Written after the scheduled stamp: in force under it and without it. */
const AFTER_STAMP = '2026-09-25T08:00:00.000001+00:00';

/** One scheduled version of `teamId`, at step `offset`, from `date` (by default {@link SCHEDULED}). */
function scheduledRow(teamId: string, offset: number, date = SCHEDULED, createdAt = SCHEDULED_AT): Row {
  return assignmentRow(teamId, 'pilot-rotation', `pilot-step-${String(offset)}`, SEEDED, date, undefined, { createdAt });
}

/** PILOT with a change scheduled on {@link SCHEDULED}: Smjena A at `offsetA`, the others as they are. */
function scheduledRows(offsetA = 0, rows: FixtureRows = PILOT): FixtureRows {
  return {
    ...rows,
    assignments: [
      ...rows.assignments,
      ...PILOT.teams.map((team, offset) => scheduledRow(String(team['id']), team['id'] === A ? offsetA : offset)),
    ],
  };
}

async function cancelErasuresOf(
  rows: FixtureRows,
  snapshot: CalendarSnapshot,
  records: readonly Row[],
  resolutions: readonly Row[] = [],
): Promise<readonly ErasureRow[]> {
  return rotationCancelErasuresOf(snapshot, await rotationOf(rows), SCHEDULED, records, resolutions);
}

describe('the cancel: Plain revert', () => {
  it('lists the conflict the scheduled version alone raises, the team free after the cancel', async () => {
    const rows = scheduledRows(2);
    const listed = await cancelErasuresOf(rows, await calendarOf(rows), [recordOf('record-1', '2026-09-12', '2026-09-13')]);

    expect(listed).toEqual([
      expect.objectContaining({ date: '2026-09-12', teamName: 'Smjena A', shiftTypeName: 'Dan', teamWorks: false }),
    ]);
    expect(t('rotation.builder.cancelScheduled.erasures.rowFree', { member: VIEWER_NAME, team: 'Smjena A' })).toBe(
      `${VIEWER_NAME} na godišnjem · nakon poništavanja: Smjena A taj dan slobodna`,
    );
    expect(t('rotation.builder.cancelScheduled.erasures.lede', { count: 1 })).toBe(
      'Poništavanje uklanja uzrok 1 neriješenog konflikta. Prije poništavanja odluči za svaki.',
    );
    expect(t('rotation.builder.cancelScheduled.erasures.kept')).toBe('Zadržan konflikt: odustani od poništavanja.');
    expect(t('rotation.builder.cancelScheduled.erasures.unavailable')).toBe(
      'Ne mogu provjeriti konflikte koje bi poništavanje izbrisalo.',
    );
    expect(t('rotation.builder.cancelScheduled.erasures.removed', { count: 1 })).toBe('Uklonjen 1 konflikt.');
  });

  it('never lists a conflict dated before the scheduled date', async () => {
    // 09.09: Smjena A works Noć under the version in force either way.
    const rows = scheduledRows(2);

    expect(await cancelErasuresOf(rows, await calendarOf(rows), [recordOf('record-1', '2026-09-08', '2026-09-10')])).toEqual([]);
  });

  it('cancels only the earliest scheduled change: a later version keeps its own conflicts', async () => {
    // A second change from 14.09 puts Smjena A back at step 0: Dan on 14.09 with or without the cancel.
    const base = scheduledRows(2);
    const rows = { ...base, assignments: [...base.assignments, scheduledRow(A, 0, '2026-09-14', '2026-09-21T10:00:00+00:00')] };
    const listed = await cancelErasuresOf(rows, await calendarOf(rows), [
      recordOf('record-1', '2026-09-12', '2026-09-13'),
      recordOf('record-2', '2026-09-14', '2026-09-15'),
    ]);

    expect(listed.map((row) => row.date)).toEqual(['2026-09-12']);
  });
});

describe('the cancel: Override returns', () => {
  it('lists the conflict a Slobodno override written before the scheduled stamp clears once in force again', async () => {
    const rows = scheduledRows();
    const snapshot = await calendarOf(rows, [], {
      overrides: [calendarOverrideRow('free', A, '2026-09-10', 'pilot-slobodno')],
    });

    expect(overrideStandingOfCalendar(snapshot).pending.map((override) => override.id)).toEqual(['free']);
    expect(overrideStandingOfCalendar(cancelledCalendarSnapshotOf(snapshot, SCHEDULED)).inForce.map((override) => override.id)).toEqual([
      'free',
    ]);
    expect(await cancelErasuresOf(rows, snapshot, [recordOf('record-1', '2026-09-10', '2026-09-11')])).toEqual([
      expect.objectContaining({ date: '2026-09-10', teamName: 'Smjena A', shiftTypeName: 'Dan', teamWorks: false }),
    ]);
  });

  it('never lists a conflict an override written after the scheduled stamp holds either way', async () => {
    // 12.09 would be erased (Plain revert), but a Dan override written after the stamp keeps Smjena A working.
    const rows = scheduledRows(2);
    const snapshot = await calendarOf(rows, [], {
      overrides: [calendarOverrideRow('worked', A, '2026-09-12', 'pilot-dan', { createdAt: AFTER_STAMP })],
    });

    expect(overrideStandingOfCalendar(snapshot).inForce.map((override) => override.id)).toEqual(['worked']);
    expect(await cancelErasuresOf(rows, snapshot, [recordOf('record-1', '2026-09-12', '2026-09-13')])).toEqual([]);
  });

  it('lists one row when a shift-type and a roster override come back on the same date', async () => {
    const rows = scheduledRows();
    const snapshot = await calendarOf(rows, [calendarRosterOverrideRow('take-off', A, '2026-09-10', VIEWER_MEMBER, null)], {
      overrides: [calendarOverrideRow('free', A, '2026-09-10', 'pilot-slobodno')],
    });

    expect(await cancelErasuresOf(rows, snapshot, [recordOf('record-1', '2026-09-10', '2026-09-11')])).toEqual([
      expect.objectContaining({ date: '2026-09-10', teamName: 'Smjena A', teamWorks: false }),
    ]);
  });
});

describe('the cancel: Roster returns', () => {
  it('lists the conflict a take-off written in that window clears, the team still working', async () => {
    const rows = scheduledRows();
    const snapshot = await calendarOf(rows, [calendarRosterOverrideRow('take-off', A, '2026-09-10', VIEWER_MEMBER, null)]);

    expect(rosterStandingOfCalendar(snapshot).pending.map((override) => override.id)).toEqual(['take-off']);
    expect(await cancelErasuresOf(rows, snapshot, [recordOf('record-1', '2026-09-10', '2026-09-11')])).toEqual([
      expect.objectContaining({ date: '2026-09-10', teamName: 'Smjena A', memberName: VIEWER_NAME, teamWorks: true }),
    ]);
    expect(t('rotation.builder.cancelScheduled.erasures.rowWithout', { member: VIEWER_NAME, team: 'Smjena A' })).toBe(
      `${VIEWER_NAME} na godišnjem · nakon poništavanja: Smjena A taj dan bez ${VIEWER_NAME}`,
    );
  });
});

describe('the cancel: No erasure', () => {
  it('erases nothing when the cancel changes no leave date', async () => {
    const rows = scheduledRows();

    expect(await cancelErasuresOf(rows, await calendarOf(rows), [recordOf('record-1', '2026-09-10', '2026-09-15')])).toEqual([]);
  });

  it('never lists a collision the cancel adds', async () => {
    // The scheduled Smjena A is free on 10.09; the version in force before works Dan.
    const rows = scheduledRows(2);

    expect(await cancelErasuresOf(rows, await calendarOf(rows), [recordOf('record-1', '2026-09-10', '2026-09-11')])).toEqual([]);
  });

  it('does not list a resolved conflict', async () => {
    const rows = scheduledRows(2);

    expect(
      await cancelErasuresOf(rows, await calendarOf(rows), [recordOf('record-1', '2026-09-12', '2026-09-13')], [
        resolutionOf(VIEWER_MEMBER, '2026-09-12', A),
      ]),
    ).toEqual([]);
  });
});

describe('the cancel: Archived team', () => {
  const ARCHIVED = 'pilot-smjena-e';
  // Smjena E, archived: free on 10.09 under its old version (step 2), Dan under its scheduled one (step 0).
  const withArchived: FixtureRows = {
    ...PILOT,
    teams: [...PILOT.teams, teamRow(ARCHIVED, 'Smjena E', { archived: true })],
    assignments: [...PILOT.assignments, assignmentRow(ARCHIVED, 'pilot-rotation', 'pilot-step-2', SEEDED, SEEDED), scheduledRow(ARCHIVED, 0)],
  };

  it('keeps an archived team\'s scheduled version in "after", as the delete does', async () => {
    const rows = scheduledRows(2, withArchived);
    const snapshot = await calendarOf(rows);
    const after = cancelledCalendarSnapshotOf(snapshot, SCHEDULED);

    expect(after.assignments.filter((assignment) => assignment.effectiveFrom === SCHEDULED).map((assignment) => assignment.teamId)).toEqual([
      ARCHIVED,
    ]);
    expect(after.assignmentStamps.filter((stamp) => stamp.effectiveFrom === SCHEDULED).map((stamp) => stamp.teamId)).toEqual([ARCHIVED]);
    expect(after.steps).toBe(snapshot.steps);
    expect(await cancelErasuresOf(rows, snapshot, [recordOf('record-1', '2026-09-12', '2026-09-13')])).toEqual([
      expect.objectContaining({ date: '2026-09-12', teamName: 'Smjena A' }),
    ]);
  });

  it('never lists a conflict the archived team\'s kept version raises', async () => {
    // Ana is on Smjena E and on leave 10.09, a Dan under its scheduled version, which the cancel keeps.
    const rows = scheduledRows(0, withArchived);
    const snapshot = await calendarOf(rows, [], { anaTeam: ARCHIVED });
    const leave = [recordOf('record-ana', '2026-09-10', '2026-09-11', ANA)];
    // Were it dropped with the active teams', the conflict would be erased.
    const dropped = {
      ...snapshot,
      assignments: snapshot.assignments.filter((assignment) => assignment.effectiveFrom !== SCHEDULED),
      assignmentStamps: snapshot.assignmentStamps.filter((stamp) => stamp.effectiveFrom !== SCHEDULED),
    };

    expect(sharedErasuresOf(snapshot, dropped, SCHEDULED, leave, [])).toEqual([
      expect.objectContaining({ memberName: 'Ana Anić', teamName: 'Smjena E', date: '2026-09-10' }),
    ]);
    expect(await cancelErasuresOf(rows, snapshot, leave)).toEqual([]);
  });
});

describe('the cancel: not derivable', () => {
  it('refuses when the calendar and the rotation disagree on how many versions are scheduled', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const snapshot = await calendarOf(scheduledRows());
    const partial = await rotationOf({ ...scheduledRows(), assignments: scheduledRows().assignments.slice(0, -1) });

    expect(rotationCancelErasuresOutcomeOf(snapshot, partial, SCHEDULED, [], [])).toEqual({ ok: false, code: ERASURES_UNAVAILABLE });
    expect(logged).toHaveBeenCalledWith(
      ERASURES_UNAVAILABLE,
      expect.objectContaining({ message: 'the rotation and the calendar disagree on the scheduled versions' }),
    );
  });

  it('refuses when the counts agree but the teams scheduled differ', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const [a, b, c, d] = PILOT.teams.map((team) => String(team['id']));
    const drawnRows = { ...PILOT, assignments: [...PILOT.assignments, scheduledRow(a ?? '', 0), scheduledRow(b ?? '', 1), scheduledRow(c ?? '', 2)] };
    const boundRows = { ...PILOT, assignments: [...PILOT.assignments, scheduledRow(a ?? '', 0), scheduledRow(b ?? '', 1), scheduledRow(d ?? '', 3)] };

    expect(rotationCancelErasuresOutcomeOf(await calendarOf(drawnRows), await rotationOf(boundRows), SCHEDULED, [], [])).toEqual({
      ok: false,
      code: ERASURES_UNAVAILABLE,
    });
    expect(logged).toHaveBeenCalledWith(
      ERASURES_UNAVAILABLE,
      expect.objectContaining({ message: 'the rotation and the calendar disagree on the scheduled versions' }),
    );
  });

  it('refuses when the same teams are scheduled at another step', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(rotationCancelErasuresOutcomeOf(await calendarOf(scheduledRows(2)), await rotationOf(scheduledRows(1)), SCHEDULED, [], [])).toEqual({
      ok: false,
      code: ERASURES_UNAVAILABLE,
    });
  });

  it('refuses when the rotation and the calendar disagree on the active teams', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const snapshot = await calendarOf(scheduledRows());
    const wider = await rotationOf({ ...scheduledRows(), teams: [...PILOT.teams, teamRow('pilot-smjena-e', 'Smjena E')] });

    expect(rotationCancelErasuresOutcomeOf(snapshot, wider, SCHEDULED, [], [])).toEqual({ ok: false, code: ERASURES_UNAVAILABLE });
  });

  it('leaves the snapshot as read unchanged', async () => {
    const snapshot = await calendarOf(scheduledRows());
    const versions = snapshot.assignments.length;

    cancelledCalendarSnapshotOf(snapshot, SCHEDULED);

    expect(snapshot.assignments).toHaveLength(versions);
  });
});
