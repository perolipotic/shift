import {
  QueryClient,
  QueryObserver,
  environmentManager,
  onlineManager,
} from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ROTATION_COLUMNS,
  ROTATION_COUNT,
  ROTATION_FETCH_PAUSED,
  ROTATION_KEY,
  ROTATION_READ_STALE_MS,
  ROTATION_UNAVAILABLE,
  assignmentInForceOf,
  patternStepsOf,
  readRotation,
  rotationChangedTodayOf,
  rotationMessageKey,
  rotationQueryOptions,
  rotationScheduledDateOf,
  rotationScheduledOf,
  rotationSurfaceStateOf,
  rotationTeamsOf,
  rotationTodayOf,
  writableRotationOf,
  type RotationAnswer,
  type RotationSnapshot,
  type RotationTable,
} from '@/rotation/list';
import {
  ADMIN,
  ADMIN_NAME,
  ORGANIZATION,
  OTHER_ORGANIZATION,
  PILOT,
  SEEDED_AT,
  SEEDED,
  TODAY,
  UJ5,
  answerOf,
  assignmentRow,
  memberRow,
  stepRow,
  teamRow,
  type FixtureRows,
} from '@/rotation/rotation.fixture';

/**
 * Story 2.3b's read half, executed rather than read (AD-15): the one
 * snapshot, the rotation in force per team today, the scheduled flag and the
 * surface state, over both fixtures, with a real `QueryObserver`.
 */

function tableOf(answer: RotationAnswer): RotationTable & { readonly seen: unknown[][] } {
  const seen: unknown[][] = [];

  return {
    seen,
    select(columns, options) {
      seen.push([columns, options]);

      return Promise.resolve(answer);
    },
  };
}

async function snapshotOf(rows: FixtureRows): Promise<RotationSnapshot> {
  const outcome = await readRotation(tableOf(answerOf(rows)));

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

async function refusedOf(rows: FixtureRows) {
  return readRotation(tableOf(answerOf(rows)));
}

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

describe('the read', () => {
  it('reads the organization, its zone, teams, types, steps and assignments in one exact-count call', async () => {
    const table = tableOf(answerOf(PILOT));
    const outcome = await readRotation(table);

    expect(table.seen).toEqual([[ROTATION_COLUMNS, ROTATION_COUNT]]);
    expect(ROTATION_COLUMNS).toContain('teams(organization_id,id,name,archived)');
    expect(ROTATION_COLUMNS).toContain('shift_types(');
    expect(ROTATION_COLUMNS).toContain('rotation_steps(');
    expect(ROTATION_COLUMNS).toContain('rotation_assignments(');
    expect(ROTATION_COLUMNS).not.toMatch(/cycle|offset_index|projected/);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.timeZone).toBe('Europe/Zagreb');
    expect(outcome.snapshot.teams).toHaveLength(4);
    expect(outcome.snapshot.types.map((type) => type.id)).toEqual(['pilot-dan', 'pilot-noc', 'pilot-slobodno']);
    expect(outcome.snapshot.steps).toHaveLength(4);
    expect(outcome.snapshot.assignments).toHaveLength(4);
  });

  it('answers an organization with nothing yet as an answer', async () => {
    const snapshot = await snapshotOf({ teams: [], types: [], steps: [], assignments: [] });

    expect(snapshot.teams).toEqual([]);
    expect(snapshot.assignments).toEqual([]);
  });

  it('refuses a rejected call, an error, and anything but exactly one organization', async () => {
    const spy = quiet();

    expect(
      await readRotation({ select: () => Promise.reject(new Error('down')) }),
    ).toEqual({ ok: false, code: ROTATION_UNAVAILABLE });
    expect(await readRotation(tableOf({ data: null, error: { code: '500' }, count: null }))).toEqual({
      ok: false,
      code: ROTATION_UNAVAILABLE,
    });
    expect(await readRotation(tableOf({ ...answerOf(PILOT), count: 2 }))).toEqual({
      ok: false,
      code: ROTATION_UNAVAILABLE,
    });
    expect(await readRotation(tableOf({ data: [], error: null, count: 0 }))).toEqual({
      ok: false,
      code: ROTATION_UNAVAILABLE,
    });
    spy.mockRestore();
  });

  it('refuses a row of another tenant, in every embed', async () => {
    const spy = quiet();

    for (const rows of [
      { ...PILOT, teams: [...PILOT.teams, teamRow('stranger', 'Smjena X', { organization: OTHER_ORGANIZATION })] },
      { ...PILOT, steps: [...PILOT.steps, stepRow('stranger', 'pilot-rotation', 9, 'pilot-dan', OTHER_ORGANIZATION)] },
      {
        ...PILOT,
        assignments: [
          ...PILOT.assignments,
          assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-0', SEEDED, '2026-10-01', OTHER_ORGANIZATION),
        ],
      },
    ]) {
      expect((await refusedOf(rows)).ok).toBe(false);
    }
    spy.mockRestore();
  });

  it('refuses a step naming a type it lacks, two steps at one position, and a malformed position', async () => {
    const spy = quiet();

    expect((await refusedOf({ ...PILOT, steps: [...PILOT.steps, stepRow('s9', 'pilot-rotation', 9, 'nowhere')] })).ok).toBe(false);
    expect((await refusedOf({ ...PILOT, steps: [...PILOT.steps, stepRow('s9', 'pilot-rotation', 0, 'pilot-dan')] })).ok).toBe(false);
    expect((await refusedOf({ ...PILOT, steps: [...PILOT.steps, stepRow('s9', 'p2', 1.5, 'pilot-dan')] })).ok).toBe(false);
    expect((await refusedOf({ ...PILOT, steps: [...PILOT.steps, stepRow('s9', 'p2', -1, 'pilot-dan')] })).ok).toBe(false);
    spy.mockRestore();
  });

  it('refuses an assignment on a step of another pattern, of a team it lacks, a malformed date, or a second version on one date', async () => {
    const spy = quiet();
    const extra = (row: Record<string, unknown>) => ({ ...PILOT, assignments: [...PILOT.assignments, row] });

    expect((await refusedOf({ ...PILOT, steps: [...PILOT.steps, stepRow('other-0', 'other', 0, 'pilot-dan')], assignments: [...PILOT.assignments, assignmentRow('pilot-smjena-a', 'pilot-rotation', 'other-0', SEEDED, '2026-10-01')] })).ok).toBe(false);
    expect((await refusedOf(extra(assignmentRow('nobody', 'pilot-rotation', 'pilot-step-0', SEEDED, '2026-10-01')))).ok).toBe(false);
    expect((await refusedOf(extra(assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-0', '2026-02-30', '2026-10-01')))).ok).toBe(false);
    expect((await refusedOf(extra(assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-1', SEEDED, SEEDED)))).ok).toBe(false);
    spy.mockRestore();
  });

  it("reads today in the organization's zone, never the device's", async () => {
    const snapshot = await snapshotOf(PILOT);
    const lateEvening = new Date('2026-09-25T22:30:00Z');

    expect(rotationTodayOf(snapshot, lateEvening)).toBe('2026-09-26');
    expect(rotationTodayOf({ ...snapshot, timeZone: 'UTC' }, lateEvening)).toBe('2026-09-25');
  });
});

describe('the attribution, read in the same snapshot (story 2.6)', () => {
  it('selects each version\'s id, author and time, and the members as names', () => {
    expect(ROTATION_COLUMNS).toContain(
      'rotation_assignments(organization_id,id,team_id,pattern_id,offset_step_id,anchor_date,effective_from,created_by,created_at)',
    );
    expect(ROTATION_COLUMNS).toContain('members(organization_id,auth_user_id,name)');
    // Names only: no role, email, rank or position reaches the builder.
    expect(ROTATION_COLUMNS).not.toMatch(/email|role|fire_rank|position\)/);
  });

  it.each([
    { fixture: 'pilot', rows: PILOT },
    { fixture: 'UJ-5', rows: UJ5 },
  ])('$fixture: one history record per assignment, beside the domain type, and the authors by auth user id', async ({ rows }) => {
    const snapshot = await snapshotOf(rows);

    expect(snapshot.history).toHaveLength(snapshot.assignments.length);
    expect(snapshot.history[0]).toEqual({
      id: `assignment-${String(rows.assignments[0]?.['team_id'])}-${SEEDED}`,
      teamId: rows.assignments[0]?.['team_id'],
      patternId: rows.assignments[0]?.['pattern_id'],
      effectiveFrom: SEEDED,
      createdBy: ADMIN,
      createdAt: SEEDED_AT,
    });
    // The domain's type carries none of it.
    expect(Object.keys(snapshot.assignments[0] ?? {}).sort()).toEqual(
      ['anchorDate', 'effectiveFrom', 'offsetStepId', 'patternId', 'teamId'].sort(),
    );
    expect(snapshot.authors).toEqual([{ authUserId: ADMIN, name: ADMIN_NAME }]);
  });

  it('refuses a member of another tenant, a malformed member, and a version without its id, author or time', async () => {
    const spy = quiet();
    const withRow = (change: (row: Record<string, unknown>) => Record<string, unknown>): FixtureRows => ({
      ...PILOT,
      assignments: PILOT.assignments.map((row, index) => (index === 0 ? change({ ...row }) : row)),
    });

    for (const rows of [
      { ...PILOT, members: [memberRow(ADMIN, ADMIN_NAME), memberRow('stranger', 'Netko', OTHER_ORGANIZATION)] },
      { ...PILOT, members: [{ organization_id: ORGANIZATION, auth_user_id: '', name: 'Netko' }] },
      { ...PILOT, members: [memberRow(ADMIN, ADMIN_NAME), memberRow(ADMIN, 'Dvojnik')] },
      withRow((row) => ({ ...row, id: null })),
      withRow((row) => ({ ...row, created_by: '' })),
      withRow((row) => ({ ...row, created_at: 'yesterday' })),
      // Date.parse reads these; they are not a full timestamp with an offset.
      withRow((row) => ({ ...row, created_at: '2026' })),
      withRow((row) => ({ ...row, created_at: '2026-09-26' })),
      withRow((row) => ({ ...row, created_at: '2026-09-26T20:07:49' })),
      withRow((row) => ({ ...row, id: PILOT.assignments[1]?.['id'] })),
    ]) {
      expect((await refusedOf(rows)).ok).toBe(false);
    }
    // No members embed at all: the answer is not the snapshot the read asked for.
    const organization = { ...(answerOf(PILOT).data?.[0] as Record<string, unknown>) };

    Reflect.deleteProperty(organization, 'members');

    expect((await readRotation(tableOf({ data: [organization], error: null, count: 1 }))).ok).toBe(false);
    spy.mockRestore();
  });

  it('reads the timestamps PostgREST renders, with any offset', async () => {
    for (const createdAt of ['2026-09-25T20:07:49.331741+00:00', '2026-09-25T22:07:49+02:00', '2026-09-25T20:07Z']) {
      const snapshot = await snapshotOf({
        ...PILOT,
        assignments: PILOT.assignments.map((row, index) => (index === 0 ? { ...row, created_at: createdAt } : row)),
      });

      expect(snapshot.history[0]?.createdAt, createdAt).toBe(createdAt);
    }
  });

  it('reads a version whose author the members embed lacks: the history names nobody', async () => {
    const snapshot = await snapshotOf({ ...PILOT, members: [] });

    expect(snapshot.authors).toEqual([]);
    expect(snapshot.history.every((record) => record.createdBy === ADMIN)).toBe(true);
  });
});

describe('the rotation in force, over both fixtures', () => {
  it.each([
    { fixture: 'pilot', rows: PILOT, count: 4, pattern: 'pilot-rotation' },
    { fixture: 'UJ-5', rows: UJ5, count: 3, pattern: 'uj5-rotation' },
  ])('$fixture: every active team on its one pattern today, steps by position', async ({ rows, count, pattern }) => {
    const snapshot = await snapshotOf(rows);
    const teams = rotationTeamsOf(snapshot);

    expect(teams.map((team) => team.name)).toEqual(['Smjena A', 'Smjena B', 'Smjena C', 'Smjena D'].slice(0, count));
    for (const team of teams) {
      expect(assignmentInForceOf(snapshot, team.id, TODAY)?.patternId).toBe(pattern);
    }
    expect(patternStepsOf(snapshot, pattern).map((step) => step.position)).toEqual(
      [0, 1, 2, 3, 4].slice(0, rows.steps.length),
    );
  });

  it('keeps archived teams out of the teams a rotation binds', async () => {
    const snapshot = await snapshotOf({
      ...PILOT,
      teams: [...PILOT.teams, teamRow('gone', 'Smjena Z', { archived: true })],
    });

    expect(rotationTeamsOf(snapshot).map((team) => team.id)).not.toContain('gone');
  });

  it('has no rotation in force before the first version', async () => {
    const snapshot = await snapshotOf(PILOT);

    expect(assignmentInForceOf(snapshot, 'pilot-smjena-a', '2019-12-31')).toBeNull();
  });

  it('flags a version scheduled after today, and only after today', async () => {
    const seeded = await snapshotOf(PILOT);
    const scheduled = await snapshotOf({
      ...PILOT,
      assignments: [
        ...PILOT.assignments,
        assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-1', SEEDED, '2026-10-01'),
      ],
    });

    expect(rotationScheduledOf(seeded, TODAY)).toBe(false);
    expect(rotationScheduledOf(scheduled, TODAY)).toBe(true);
    expect(rotationScheduledOf(scheduled, '2026-10-01')).toBe(false);
    // The date the cancel deletes (story 2.6).
    expect(rotationScheduledDateOf(seeded, TODAY)).toBeNull();
    expect(rotationScheduledDateOf(scheduled, TODAY)).toBe('2026-10-01');
    expect(rotationScheduledDateOf(scheduled, '2026-10-01')).toBeNull();
  });

  it("ignores an archived team's version after today: the save writes none for it", async () => {
    const snapshot = await snapshotOf({
      ...PILOT,
      teams: [...PILOT.teams, teamRow('gone', 'Smjena Z', { archived: true })],
      assignments: [
        ...PILOT.assignments,
        assignmentRow('gone', 'pilot-rotation', 'pilot-step-1', SEEDED, '2026-10-01'),
      ],
    });

    expect(rotationScheduledOf(snapshot, TODAY)).toBe(false);
  });

  it('flags an active team whose rotation already changed today', async () => {
    const changed = await snapshotOf({
      ...PILOT,
      assignments: [
        ...PILOT.assignments,
        assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-1', SEEDED, TODAY),
      ],
    });

    expect(rotationChangedTodayOf(await snapshotOf(PILOT), TODAY)).toBe(false);
    expect(rotationChangedTodayOf(changed, TODAY)).toBe(true);
    expect(rotationChangedTodayOf(changed, '2026-09-27')).toBe(false);
  });
});

describe('the surface state, driven through the one query definition', () => {
  const wasServer = environmentManager.isServer();
  const good = answerOf(PILOT);
  const miscounted: RotationAnswer = { ...good, count: 2 };
  let client: QueryClient;
  let unsubscribes: (() => void)[];
  let pilot: RotationSnapshot;

  beforeAll(async () => {
    environmentManager.setIsServer(() => false);
    pilot = await snapshotOf(PILOT);
  });

  afterAll(() => {
    environmentManager.setIsServer(() => wasServer);
  });

  beforeEach(() => {
    client = new QueryClient();
    unsubscribes = [];
    quiet();
  });

  afterEach(() => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    client.clear();
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  function answeringInTurn(...answers: RotationAnswer[]): RotationTable & { readonly calls: () => number } {
    let calls = 0;

    return {
      calls: () => calls,
      select() {
        const answer = answers[Math.min(calls, answers.length - 1)];

        calls += 1;

        return Promise.resolve(answer as RotationAnswer);
      },
    };
  }

  function observe(table: () => RotationTable) {
    const observer = new QueryObserver(client, { ...rotationQueryOptions(table), retryDelay: 0 });

    unsubscribes.push(observer.subscribe(() => undefined));

    return observer;
  }

  async function settled(observer: ReturnType<typeof observe>) {
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().fetchStatus).toBe('idle');
    });

    return observer.getCurrentResult();
  }

  it('keeps its own key and the cache bound', () => {
    const options = rotationQueryOptions(() => answeringInTurn(good));

    expect(options.queryKey).toEqual(ROTATION_KEY);
    expect(ROTATION_KEY).toEqual(['rotation']);
    expect(options.staleTime).toBe(ROTATION_READ_STALE_MS);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.retry).toBe(1);
    expect(options.retryDelay).toBe(1000);
  });

  it('pulses while the first read is in flight and says nothing', () => {
    const observer = observe(() => answeringInTurn(good));

    expect(rotationSurfaceStateOf(observer.getCurrentResult())).toEqual({
      snapshot: null,
      refusal: null,
      loading: true,
    });
  });

  it('draws a first answer, and a save may be built from it', async () => {
    const state = rotationSurfaceStateOf(await settled(observe(() => answeringInTurn(good))));

    expect(state).toEqual({ snapshot: pilot, refusal: null, loading: false });
    expect(writableRotationOf(state)).toEqual(pilot);
  });

  it('retries an unavailable first read once, then shows the message and no rows', async () => {
    const table = answeringInTurn(miscounted);
    const result = await settled(observe(() => table));

    expect(table.calls()).toBe(2);
    expect(rotationSurfaceStateOf(result)).toEqual({
      snapshot: null,
      refusal: ROTATION_UNAVAILABLE,
      loading: false,
    });
  });

  it('keeps the rows beside the message when a refetch fails, retried once — and builds no save from them', async () => {
    const table = answeringInTurn(good, miscounted);
    const observer = observe(() => table);

    await settled(observer);
    await client.invalidateQueries({ queryKey: ROTATION_KEY });
    const state = rotationSurfaceStateOf(await settled(observer));

    expect(table.calls()).toBe(3);
    expect(state).toEqual({ snapshot: pilot, refusal: ROTATION_UNAVAILABLE, loading: false });
    expect(writableRotationOf(state)).toBeNull();
  });

  it('rejects when the table cannot even be built', async () => {
    const result = await settled(
      observe(() => {
        throw new Error('SUPABASE_ENVIRONMENT_MISSING');
      }),
    );

    expect(rotationSurfaceStateOf(result).refusal).toBe(ROTATION_UNAVAILABLE);
  });

  it('says why rather than pulsing while paused offline', () => {
    onlineManager.setOnline(false);
    const result = observe(() => answeringInTurn(good)).getCurrentResult();

    expect(result.fetchStatus).toBe(ROTATION_FETCH_PAUSED);
    expect(rotationSurfaceStateOf(result)).toEqual({
      snapshot: null,
      refusal: ROTATION_UNAVAILABLE,
      loading: false,
    });
  });

  it('never pulses a skeleton beside a message', () => {
    for (const isError of [true, false]) {
      for (const isPending of [true, false]) {
        for (const fetchStatus of ['idle', 'fetching', ROTATION_FETCH_PAUSED]) {
          for (const data of [undefined, pilot]) {
            const state = rotationSurfaceStateOf({ isPending, isError, fetchStatus, data });

            expect(state.loading && state.refusal !== null).toBe(false);
          }
        }
      }
    }
  });

  it('names the read failure through its own key', () => {
    expect(rotationMessageKey(ROTATION_UNAVAILABLE)).toBe('rotation.builder.error.unavailable');
  });
});
