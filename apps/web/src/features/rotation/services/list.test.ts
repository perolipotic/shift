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
  instantMicrosOf,
  overrideStandingOfSnapshot,
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
} from '@/features/rotation/services/list';
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
  overrideRow,
  stepRow,
  teamRow,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';
import { scheduledChangeOf } from '@/features/rotation/services/history';
import { pendingOverrideCountOf, pendingOverrideRowsOf } from '@/features/rotation/services/override-disposition';
import { cancelScheduledRotation, type RotationAssignmentDeleteTable } from '@/features/rotation/services/write';
import { datesFrom, draftRefusalOf, prefillOf, withEffectiveFrom } from '@/features/rotation/utils/draft';
import { rotationWarningLinesOf, shownSaveOutcomeOf } from '@/features/rotation/utils/warnings';

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

      return {
        filter(column, operator, value) {
          seen.push([column, operator, value]);

          return Promise.resolve(answer);
        },
      };
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

    expect(table.seen).toEqual([
      [ROTATION_COLUMNS, ROTATION_COUNT],
      ['shift_type_overrides.removed_at', 'is', 'null'],
    ]);
    expect(ROTATION_COLUMNS).toContain('teams(organization_id,id,name,archived)');
    expect(ROTATION_COLUMNS).toContain('shift_types(');
    expect(ROTATION_COLUMNS).toContain('rotation_steps:rotation_steps_in_view(');
    expect(ROTATION_COLUMNS).toContain('rotation_assignments:rotation_assignments_in_view(');
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
      await readRotation({ select: () => ({ filter: () => Promise.reject(new Error('down')) }) }),
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
      'rotation_assignments:rotation_assignments_in_view(organization_id,id,team_id,pattern_id,offset_step_id,anchor_date,effective_from,created_by,created_at)',
    );
    expect(ROTATION_COLUMNS).toContain(
      'rotation_history:rotation_assignments(organization_id,id,team_id,pattern_id,effective_from,created_by,created_at)',
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

describe('the bounded read (0025)', () => {
  it('embeds the steps, assignments and overrides through the computed relationships, and the history whole but without a step', () => {
    const embeds = ROTATION_COLUMNS.split(/,(?![^(]*\))/);

    expect(embeds.filter((embed) => /rotation_|overrides/.test(embed)).map((embed) => embed.split('(')[0])).toEqual([
      'rotation_steps:rotation_steps_in_view',
      'rotation_assignments:rotation_assignments_in_view',
      'rotation_history:rotation_assignments',
      'shift_type_overrides:rotation_overrides_in_view',
    ]);
    // The unbounded embed carries the attribution alone: no offset, no anchor, and no step embed.
    const history = embeds.find((embed) => embed.startsWith('rotation_history:')) ?? '';

    expect(history).not.toMatch(/offset_step_id|anchor_date|rotation_steps/);
  });

  it('keeps every stored version in the history while the assignments are only the kept ones', async () => {
    const older = assignmentRow('pilot-smjena-a', 'pilot-old', 'pilot-old-0', '2019-01-01', '2019-01-01');
    const snapshot = await snapshotOf({ ...PILOT, history: [older, ...PILOT.assignments] });

    expect(snapshot.assignments).toHaveLength(PILOT.assignments.length);
    expect(snapshot.history).toHaveLength(PILOT.assignments.length + 1);
    expect(snapshot.history.map((record) => record.patternId)).toContain('pilot-old');
    // The old pattern's steps are not read, and nothing projects through it.
    expect(snapshot.steps.some((step) => step.patternId === 'pilot-old')).toBe(false);
    expect(assignmentInForceOf(snapshot, 'pilot-smjena-a', TODAY)?.patternId).toBe('pilot-rotation');
  });

  it('refuses a kept version the history does not hold, a history row of another tenant, and no history embed', async () => {
    const spy = quiet();

    for (const history of [
      PILOT.assignments.slice(1),
      PILOT.assignments.map((row, index) => (index === 0 ? { ...row, effective_from: '2019-06-01' } : row)),
      [...PILOT.assignments, assignmentRow('pilot-smjena-a', 'x', 'x-0', SEEDED, '2019-01-01', OTHER_ORGANIZATION)],
      [...PILOT.assignments, { ...PILOT.assignments[0], id: 'twice' }],
    ]) {
      expect((await refusedOf({ ...PILOT, history })).ok, JSON.stringify(history[0])).toBe(false);
    }
    const organization = { ...(answerOf(PILOT).data?.[0] as Record<string, unknown>) };

    Reflect.deleteProperty(organization, 'rotation_history');

    expect((await readRotation(tableOf({ data: [organization], error: null, count: 1 }))).ok).toBe(false);
    spy.mockRestore();
  });
});

describe('every consumer over a strictly bounded snapshot (0025)', () => {
  // THE FULL HISTORY, for every pilot team: the seed (2020), two older
  // patterns (2023, 2025), the seed's pattern again (2026-06-01, in force
  // today) and a change scheduled after today (2026-10-01). An override
  // written before the 2025 version was saved is PENDING under it, and pins
  // Smjena A's horizon on its date; one written after its version is IN
  // FORCE, and a FUTURE pending one sits under the scheduled change.
  const letters = ['a', 'b', 'c', 'd'] as const;
  const patternSteps = (pattern: string, types: readonly string[]) =>
    types.map((type, position) => stepRow(`${pattern}-${String(position)}`, pattern, position, type));
  const ancientSteps = patternSteps('pilot-ancient', ['pilot-dan', 'pilot-slobodno']);
  const oldSteps = patternSteps('pilot-old', ['pilot-noc', 'pilot-slobodno', 'pilot-slobodno', 'pilot-dan']);
  const nextSteps = patternSteps('pilot-next', ['pilot-dan', 'pilot-dan', 'pilot-slobodno', 'pilot-noc']);
  const versionsOn = (pattern: string, prefix: string, from: string, createdAt: string) =>
    letters.map((letter, offset) =>
      assignmentRow(`pilot-smjena-${letter}`, pattern, `${prefix}-${String(offset)}`, SEEDED, from, ORGANIZATION, {
        createdAt,
      }),
    );
  const seed = PILOT.assignments;
  const ancient = letters.map((letter) =>
    assignmentRow(`pilot-smjena-${letter}`, 'pilot-ancient', 'pilot-ancient-0', SEEDED, '2023-01-01', ORGANIZATION, {
      createdAt: '2022-12-20T10:00:00+00:00',
    }),
  );
  const older = versionsOn('pilot-old', 'pilot-old', '2025-01-01', '2024-12-20T10:00:00+00:00');
  const current = versionsOn('pilot-rotation', 'pilot-step', '2026-06-01', '2026-05-20T10:00:00+00:00');
  const scheduled = versionsOn('pilot-next', 'pilot-next', '2026-10-01', '2026-09-20T10:00:00+00:00');
  const everyVersion = [...seed, ...ancient, ...older, ...current, ...scheduled];
  const pendingPast = overrideRow('o-pending', 'pilot-smjena-a', '2025-03-10', 'pilot-slobodno', {
    createdAt: '2024-12-01T08:00:00+00:00',
  });
  const inForce = overrideRow('o-in-force', 'pilot-smjena-b', '2025-03-01', 'pilot-dan', {
    createdAt: '2025-02-01T08:00:00+00:00',
  });
  const pendingFuture = overrideRow('o-future', 'pilot-smjena-c', '2026-10-05', 'pilot-noc', {
    createdAt: '2026-09-01T08:00:00+00:00',
  });
  const FULL: FixtureRows = {
    ...PILOT,
    steps: [...PILOT.steps, ...ancientSteps, ...oldSteps, ...nextSteps],
    assignments: everyVersion,
    history: everyVersion,
    overrides: [pendingPast, inForce, pendingFuture],
  };
  // What 0025 selects: Smjena A's horizon is the pending override's date, so
  // it keeps the 2025 version that governs it; every other team's is
  // yesterday. All keep 2026-06-01 and later. The 2020 and 2023 versions,
  // the 2023 pattern's steps and the override in force are not read.
  const BOUNDED: FixtureRows = {
    ...PILOT,
    steps: [...PILOT.steps, ...oldSteps, ...nextSteps],
    assignments: [older[0]!, ...current, ...scheduled],
    history: everyVersion,
    overrides: [pendingPast, pendingFuture],
  };
  const YESTERDAY = '2026-09-25';
  const fromHorizon = datesFrom(YESTERDAY, 30);

  const cancelTable = (log: string[]): RotationAssignmentDeleteTable => ({
    delete: () => ({
      eq: (tenantColumn: string, tenant: string) => ({
        eq: (dateColumn: string, date: string) => ({
          in: (teamColumn: string, teams: readonly string[]) => ({
            select: () => {
              log.push(`${tenantColumn}=${tenant},${dateColumn}=${date},${teamColumn}=${teams.join('|')}`);

              return Promise.resolve({ data: teams.map((team) => ({ id: team })), error: null });
            },
          }),
        }),
      }),
    }),
  });

  it('is strictly smaller than the full set, and keeps the whole history', async () => {
    const full = await snapshotOf(FULL);
    const bounded = await snapshotOf(BOUNDED);

    expect(bounded.assignments.length).toBeLessThan(full.assignments.length);
    expect(bounded.steps.length).toBeLessThan(full.steps.length);
    expect(bounded.overrides.length).toBeLessThan(full.overrides.length);
    expect(bounded.history).toEqual(full.history);
  });

  it('judges and lists the pending overrides exactly as over the full set', async () => {
    const full = await snapshotOf(FULL);
    const bounded = await snapshotOf(BOUNDED);

    expect(overrideStandingOfSnapshot(bounded).pending).toEqual(overrideStandingOfSnapshot(full).pending);
    expect(overrideStandingOfSnapshot(full).pending.map((one) => one.id)).toEqual(['o-pending', 'o-future']);
    // The disposition rows project each pending date through the kept versions.
    expect(pendingOverrideRowsOf(bounded)).toEqual(pendingOverrideRowsOf(full));
    expect(pendingOverrideRowsOf(full).map((row) => row.governed)).toEqual([true, true]);
    // On 2025-03-10 the 2025 pattern projects Dan, where the seed's would project Slobodno.
    expect(pendingOverrideRowsOf(full)[0]?.projectedShiftTypeId).toBe('pilot-dan');
    expect(pendingOverrideCountOf(bounded)).toBe(pendingOverrideCountOf(full));
  });

  it('answers the version in force, and the prefill, on every date from the horizon on', async () => {
    const full = await snapshotOf(FULL);
    const bounded = await snapshotOf(BOUNDED);

    for (const date of [...datesFrom('2025-03-10', 3), ...fromHorizon]) {
      for (const letter of letters) {
        const team = `pilot-smjena-${letter}`;

        if (letter !== 'a' && date < YESTERDAY) continue;
        expect(assignmentInForceOf(bounded, team, date), `${team} on ${date}`).toEqual(
          assignmentInForceOf(full, team, date),
        );
      }
    }
    for (const date of fromHorizon) {
      expect(prefillOf(bounded, date), date).toEqual(prefillOf(full, date));
    }
    expect(prefillOf(full, TODAY).steps).toEqual(['pilot-dan', 'pilot-noc', 'pilot-slobodno', 'pilot-slobodno']);
  });

  it('answers the scheduled change, the cancel and the save refusals as over the full set', async () => {
    const full = await snapshotOf(FULL);
    const bounded = await snapshotOf(BOUNDED);

    for (const date of fromHorizon) {
      expect(rotationScheduledOf(bounded, date), date).toBe(rotationScheduledOf(full, date));
      expect(rotationScheduledDateOf(bounded, date), date).toBe(rotationScheduledDateOf(full, date));
      expect(scheduledChangeOf(bounded, date), date).toEqual(scheduledChangeOf(full, date));
      expect(rotationChangedTodayOf(bounded, date), date).toBe(rotationChangedTodayOf(full, date));
      expect(draftRefusalOf(bounded, prefillOf(full, date), date), date).toBe(
        draftRefusalOf(full, prefillOf(full, date), date),
      );
    }
    expect(rotationScheduledDateOf(full, TODAY)).toBe('2026-10-01');

    const sent: string[][] = [[], []];
    const outcomes = await Promise.all(
      [bounded, full].map((snapshot, index) =>
        cancelScheduledRotation(cancelTable(sent[index] ?? []), ORGANIZATION, snapshot, TODAY, '2026-10-01'),
      ),
    );

    expect(outcomes[0]).toEqual({ ok: true });
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(sent[0]).toEqual(sent[1]);
  });

  it('gives a landed save the same 2.5 warnings as over the full set', async () => {
    const full = await snapshotOf(FULL);
    const bounded = await snapshotOf(BOUNDED);

    for (const date of [TODAY, '2026-10-02']) {
      const draft = withEffectiveFrom(prefillOf(full, TODAY), date);

      expect(rotationWarningLinesOf(bounded, draft, date), date).toEqual(rotationWarningLinesOf(full, draft, date));
      expect(shownSaveOutcomeOf({ ok: true }, bounded, draft, date)).toEqual(
        shownSaveOutcomeOf({ ok: true }, full, draft, date),
      );
    }
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

        return { filter: () => Promise.resolve(answer as RotationAnswer) };
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

describe('the live overrides (story 3.5c)', () => {
  it('embeds the pending live overrides, bounded and filtered on the server, and carries them by team then date', async () => {
    expect(ROTATION_COLUMNS).toContain(
      'shift_type_overrides:rotation_overrides_in_view(organization_id,id,team_id,date,shift_type_id,reason,created_by,created_at,confirmed_at)',
    );
    expect(ROTATION_COLUMNS, 'a removal leaves the read').not.toMatch(/removed_by|removed_at/);
    const snapshot = await snapshotOf({
      ...PILOT,
      overrides: [
        overrideRow('o2', 'pilot-smjena-b', '2026-09-03', 'pilot-dan'),
        overrideRow('o1', 'pilot-smjena-a', '2026-09-14', 'pilot-noc', { confirmedAt: '2026-09-20T08:00:00+00:00' }),
      ],
    });

    expect(snapshot.overrides).toEqual([
      {
        id: 'o1',
        teamId: 'pilot-smjena-a',
        date: '2026-09-14',
        shiftTypeId: 'pilot-noc',
        reason: 'Zamjena zbog vježbe.',
        createdBy: ADMIN,
        createdAt: '2026-09-12T17:05:00+00:00',
        confirmedAt: '2026-09-20T08:00:00+00:00',
      },
      {
        id: 'o2',
        teamId: 'pilot-smjena-b',
        date: '2026-09-03',
        shiftTypeId: 'pilot-dan',
        reason: 'Zamjena zbog vježbe.',
        createdBy: ADMIN,
        createdAt: '2026-09-12T17:05:00+00:00',
        confirmedAt: null,
      },
    ]);
    // Nothing is pending on the seeded rotation: it predates both.
    expect(overrideStandingOfSnapshot(snapshot).pending).toEqual([]);
    expect(overrideStandingOfSnapshot(snapshot).inForce.map((override) => override.id)).toEqual(['o1', 'o2']);
  });

  it('refuses a malformed, foreign or doubled override', async () => {
    quiet();
    const good = overrideRow('o1', 'pilot-smjena-a', '2026-09-14', 'pilot-noc');

    for (const overrides of [
      [{ ...good, organization_id: OTHER_ORGANIZATION }],
      [{ ...good, team_id: 'missing' }],
      [{ ...good, shift_type_id: 'missing' }],
      [{ ...good, date: '2026-02-30' }],
      [{ ...good, reason: 7 }],
      [{ ...good, created_by: null }],
      [{ ...good, created_at: '2026-09-12' }],
      [{ ...good, confirmed_at: 'yesterday' }],
      [good, { ...good, id: 'o2' }],
      [good, { ...good, date: '2026-09-15' }],
    ]) {
      expect(await refusedOf({ ...PILOT, overrides }), JSON.stringify(overrides)).toEqual({
        ok: false,
        code: ROTATION_UNAVAILABLE,
      });
    }
    const { shift_type_overrides: _gone, ...noEmbed } = answerOf(PILOT).data![0] as Record<string, unknown>;

    expect(await readRotation(tableOf({ data: [noEmbed], error: null, count: 1 }))).toEqual({
      ok: false,
      code: ROTATION_UNAVAILABLE,
    });
    vi.restoreAllMocks();
  });

  it('reads an instant, to the microsecond, only from a full timestamp with an offset', () => {
    const at = Date.UTC(2026, 8, 12, 17, 5) * 1000;

    expect(instantMicrosOf('2026-09-12T17:05:00+00:00')).toBe(at);
    expect(instantMicrosOf('2026-09-12T19:05:00.5+02:00')).toBe(at + 500_000);
    expect(instantMicrosOf('2026-09-12T19:05:00.123456+0200')).toBe(at + 123_456);
    expect(instantMicrosOf('2026-09-12T17:05:00.88Z')).toBe(at + 880_000);
    // Within one millisecond, the later is still later.
    expect(instantMicrosOf('2026-09-12T17:05:00.000002Z')!).toBeGreaterThan(instantMicrosOf('2026-09-12T17:05:00.000001Z')!);
    for (const text of ['2026-09-12', '2026', 'yesterday', '', null, 7, '2026-09-12T17:05:00']) {
      expect(instantMicrosOf(text), String(text)).toBeNull();
    }
  });
});
