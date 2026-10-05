import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  cancelErasureCheckOf,
  erasureCheckOf,
  type ErasureReads,
} from '@/features/rotation/services/erasure-check';
import { readRotation, type RotationSnapshot } from '@/features/rotation/services/list';
import { prefillOf, withEffectiveFrom, type RotationDraft } from '@/features/rotation/utils/draft';
import { initLocalization } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  answerOf,
  assignmentRow,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  rotationTableOf,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 5.5a's check run, executed (AD-15): the hook's every path but the
 * fetching itself — offline, a read that rejects, a fresh rotation that
 * refuses the draft, a derivation that cannot be trusted, and a ready answer.
 * The organization's today is 2026-09-01 throughout.
 */

const TODAY = '2026-09-01';
const A = 'pilot-smjena-a';

async function calendarOf(): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, A, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME)]),
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

/** Every team free, from tomorrow. */
function freeFrom(rotation: RotationSnapshot, from: string): RotationDraft {
  return {
    ...withEffectiveFrom(prefillOf(rotation, TODAY), from),
    steps: ['pilot-slobodno'],
    keys: ['step-0'],
    offsets: Object.fromEntries(PILOT.teams.map((team) => [team['id'], 0])),
  };
}

const LEAVE = [{ id: 'record-1', member_id: VIEWER_MEMBER, during: '[2026-09-10,2026-09-12)' }];

let calendar: CalendarSnapshot;
let rotation: RotationSnapshot;

beforeAll(async () => {
  await initLocalization();
  calendar = await calendarOf();
  rotation = await rotationOf(PILOT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function readsOf(overrides: Partial<ErasureReads> = {}): () => Promise<ErasureReads> {
  return () => Promise.resolve({ rotation, calendar, records: LEAVE, resolutions: [], ...overrides });
}

describe('erasureCheckOf', () => {
  it('answers the erasures, the fresh rotation and the draft it checked', async () => {
    const check = await erasureCheckOf(readsOf(), freeFrom(rotation, '2026-09-02'), TODAY, true);

    if (check.kind !== CHECK_READY) throw new Error(check.kind);

    expect(check.rows.map((row) => row.date)).toEqual(['2026-09-10', '2026-09-11']);
    expect(check.rotation).toBe(rotation);
    expect(Object.keys(check.draft.offsets).sort()).toEqual(PILOT.teams.map((team) => team['id']).sort());
  });

  it('answers unavailable offline, without reading', async () => {
    const read = vi.fn(readsOf());

    expect(await erasureCheckOf(read, freeFrom(rotation, '2026-09-02'), TODAY, false)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(read).not.toHaveBeenCalled();
  });

  it('answers unavailable, logged, when a read rejects', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = new Error('unavailable');

    expect(await erasureCheckOf(() => Promise.reject(failed), freeFrom(rotation, '2026-09-02'), TODAY, true)).toEqual({
      kind: CHECK_UNAVAILABLE,
    });
    expect(logged).toHaveBeenCalledWith(CHECK_UNAVAILABLE, failed);
  });

  it('answers unavailable when the derivation cannot be trusted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      await erasureCheckOf(readsOf({ records: [{ id: 'x', member_id: 'stranger', during: '[2026-09-10,2026-09-11)' }] }), freeFrom(rotation, '2026-09-02'), TODAY, true),
    ).toEqual({ kind: CHECK_UNAVAILABLE });
  });

  it('answers unavailable when a throw is not a RangeError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { ...calendar, members: null } as unknown as CalendarSnapshot;

    expect(await erasureCheckOf(readsOf({ calendar: broken }), freeFrom(rotation, '2026-09-02'), TODAY, true)).toEqual({
      kind: CHECK_UNAVAILABLE,
    });
  });

  it('answers refused, with the fresh rotation, when it refuses the draft: a version already dated the effective date', async () => {
    const changed = await rotationOf({
      ...PILOT,
      assignments: [...PILOT.assignments, assignmentRow(A, 'pilot-rotation', 'pilot-step-2', SEEDED, '2026-09-02')],
    });

    expect(await erasureCheckOf(readsOf({ rotation: changed }), freeFrom(rotation, '2026-09-02'), TODAY, true)).toEqual({
      kind: CHECK_REFUSED,
      rotation: changed,
    });
  });
});

describe('cancelErasureCheckOf (story 5.5g)', () => {
  const SCHEDULED = '2026-09-10';
  /** PILOT with a change scheduled from 10.09, Smjena A at `offsetA`. */
  function scheduledRowsOf(offsetA: number): FixtureRows {
    return {
      ...PILOT,
      assignments: [
        ...PILOT.assignments,
        ...PILOT.teams.map((team, offset) =>
          assignmentRow(String(team['id']), 'pilot-rotation', `pilot-step-${String(team['id'] === A ? offsetA : offset)}`, SEEDED, SCHEDULED, undefined, {
            createdAt: '2026-09-20T10:00:00+00:00',
          }),
        ),
      ],
    };
  }

  // Smjena A scheduled at step 2: free on 10.09 and 11.09, Dan on 12.09.
  const scheduledRows = scheduledRowsOf(2);

  async function scheduledCalendarOf(rows: FixtureRows = scheduledRows): Promise<CalendarSnapshot> {
    const source = calendarTableOf(
      {
        data: [
          calendarOrganizationRow(rows, {
            viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'admin' })],
            versions: [memberMembershipRow(VIEWER_MEMBER, A, SEEDED)],
          }),
        ],
        error: null,
        count: 1,
      },
      membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME)]),
    );
    const outcome = await readCalendar(source, source, viewerSession());

    if (!outcome.ok) throw new Error(outcome.code);

    return outcome.snapshot;
  }

  const LEAVE_12 = [{ id: 'record-1', member_id: VIEWER_MEMBER, during: '[2026-09-12,2026-09-13)' }];

  it('answers the erasures and the fresh rotation it checked', async () => {
    const scheduled = await rotationOf(scheduledRows);
    const check = await cancelErasureCheckOf(
      readsOf({ rotation: scheduled, calendar: await scheduledCalendarOf(), records: LEAVE_12 }),
      SCHEDULED,
      TODAY,
      true,
    );

    if (check.kind !== CHECK_READY) throw new Error(check.kind);

    expect(check.rows.map((row) => row.date)).toEqual(['2026-09-12']);
    expect(check.rotation).toBe(scheduled);
  });

  it('answers refused, with the fresh rotation, when nothing is scheduled any more', async () => {
    expect(await cancelErasureCheckOf(readsOf(), SCHEDULED, TODAY, true)).toEqual({ kind: CHECK_REFUSED, rotation });
  });

  it('answers refused when another date is scheduled than the one confirmed', async () => {
    const scheduled = await rotationOf(scheduledRows);

    expect(await cancelErasureCheckOf(readsOf({ rotation: scheduled }), '2026-09-11', TODAY, true)).toEqual({
      kind: CHECK_REFUSED,
      rotation: scheduled,
    });
  });

  it('answers refused when the scheduled date has come into effect', async () => {
    const scheduled = await rotationOf(scheduledRows);

    expect(await cancelErasureCheckOf(readsOf({ rotation: scheduled }), SCHEDULED, SCHEDULED, true)).toEqual({
      kind: CHECK_REFUSED,
      rotation: scheduled,
    });
  });

  it('answers unavailable offline, without reading', async () => {
    const read = vi.fn(readsOf());

    expect(await cancelErasureCheckOf(read, SCHEDULED, TODAY, false)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(read).not.toHaveBeenCalled();
  });

  it('answers unavailable, logged, when the calendar differs from the rotation only in its scheduled versions', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduled = await rotationOf(scheduledRows);
    // The same rows but Smjena A's scheduled step.
    const calendarRead = await scheduledCalendarOf(scheduledRowsOf(1));

    expect(await cancelErasureCheckOf(readsOf({ rotation: scheduled, calendar: calendarRead }), SCHEDULED, TODAY, true)).toEqual({
      kind: CHECK_UNAVAILABLE,
    });
    expect(logged).toHaveBeenCalledWith(
      CHECK_UNAVAILABLE,
      expect.objectContaining({ message: 'the rotation and the calendar disagree on the scheduled versions' }),
    );
  });
});
