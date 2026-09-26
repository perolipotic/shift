import { readFileSync, readdirSync } from 'node:fs';

import { projectedShiftTypeOn } from '@shift/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ROTATION_CHANGED_TODAY,
  ROTATION_EFFECTIVE_PAST,
  ROTATION_EMPTY,
  ROTATION_NO_TEAMS,
  ROTATION_SCHEDULED,
  ROTATION_TYPE_ARCHIVED,
  ROTATION_UNCHANGED,
  datesFrom,
  emptyDraftOf,
  prefillOf,
  previewOf,
  withStepAdded,
  withEffectiveFrom,
  withStepMoved,
  withTeamStep,
  STEP_UP,
  type RotationDraft,
} from '@/rotation/draft';
import { readRotation, rotationTeamsOf, teamAssignmentsOf, type RotationSnapshot } from '@/rotation/list';
import {
  ORGANIZATION,
  PILOT,
  SEEDED,
  TODAY,
  UJ5,
  answerOf,
  assignmentRow,
  stepRow,
  teamRow,
  type FixtureRows,
} from '@/rotation/rotation.fixture';
import {
  ROTATION_CANCELLED_MESSAGE_KEY,
  ROTATION_CANCEL_STALE,
  ROTATION_SAVED_MESSAGE_KEY,
  ROTATION_WRITE_REFUSED,
  ROTATION_WRITE_UNAVAILABLE,
  cancelScheduledRotation,
  rotationCancelMessageKey,
  rotationPartialMessageKey,
  rotationWriteFailureOf,
  rotationWriteMessageKey,
  saveRotation,
  type RotationAssignmentDeleteTable,
  type RotationCancelFailure,
  type RotationInsertTable,
  type RotationWriteAnswer,
  type RotationWriteFailure,
} from '@/rotation/write';

/**
 * Story 2.3b's save, executed rather than read (AD-15): the three writes in
 * order, the failures by code and constraint, the partial outcome, and the
 * key switch — every write row of the spec's matrix.
 */

async function snapshotOf(rows: FixtureRows): Promise<RotationSnapshot> {
  const outcome = await readRotation({ select: () => Promise.resolve(answerOf(rows)) });

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

type Answer = RotationWriteAnswer | Error;

/** One table that records every insert and answers from a script, in turn. */
function tableOf(name: string, log: string[], ...answers: ((sent: unknown) => Answer)[]) {
  const sent: unknown[] = [];
  let calls = 0;
  const table: RotationInsertTable = {
    insert(values) {
      sent.push(values);
      log.push(name);

      return {
        select(columns) {
          log.push(`${name}.select(${columns})`);
          const script = answers[Math.min(calls, answers.length - 1)];

          calls += 1;
          const answer = script === undefined ? new Error('unscripted') : script(values);

          return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
        },
      };
    },
  };

  return { table, sent };
}

let serial = 0;

/** The database's answers: ids for what was sent. */
const patternMade = (): RotationWriteAnswer => ({ data: [{ id: `pattern-${String((serial += 1))}` }], error: null });
const stepsMade = (sent: unknown): RotationWriteAnswer => ({
  data: (sent as { position: number }[]).map((row) => ({ id: `made-step-${String(row.position)}`, position: row.position })),
  error: null,
});
const assignmentsMade = (sent: unknown): RotationWriteAnswer => ({
  data: (sent as { team_id: string }[]).map((row) => ({ team_id: row.team_id })),
  error: null,
});
const refusedWith = (code: string, message = ''): (() => RotationWriteAnswer) => () => ({
  data: null,
  error: { code, message },
});

function tablesOf(
  patterns: ((sent: unknown) => Answer)[] = [patternMade],
  steps: ((sent: unknown) => Answer)[] = [stepsMade],
  assignments: ((sent: unknown) => Answer)[] = [assignmentsMade],
) {
  const log: string[] = [];
  const p = tableOf('patterns', log, ...patterns);
  const s = tableOf('steps', log, ...steps);
  const a = tableOf('assignments', log, ...assignments);

  return {
    log,
    sent: { patterns: p.sent, steps: s.sent, assignments: a.sent },
    tables: { patterns: p.table, steps: s.table, assignments: a.table },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the save', () => {
  it('writes a fresh pattern, then its steps, then one assignment per active team, all from today', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = withStepMoved(prefillOf(snapshot, TODAY), 1, STEP_UP);
    const { log, sent, tables } = tablesOf();

    expect(await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY)).toEqual({ ok: true });
    expect(log).toEqual([
      'patterns',
      'patterns.select(id)',
      'steps',
      'steps.select(id,position)',
      'assignments',
      'assignments.select(team_id)',
    ]);
    expect(sent.patterns).toEqual([{ organization_id: ORGANIZATION }]);

    const patternId = `pattern-${String(serial)}`;

    expect(sent.steps).toEqual([
      ['pilot-noc', 'pilot-dan', 'pilot-slobodno', 'pilot-slobodno'].map((shiftTypeId, position) => ({
        organization_id: ORGANIZATION,
        pattern_id: patternId,
        position,
        shift_type_id: shiftTypeId,
      })),
    ]);
    // Each team on the step it stood on: A followed Dan to index 1, B Noć to 0.
    expect(sent.assignments).toEqual([[
      ['pilot-smjena-a', 1],
      ['pilot-smjena-b', 0],
      ['pilot-smjena-c', 2],
      ['pilot-smjena-d', 3],
    ].map(([team, index]) => ({
      organization_id: ORGANIZATION,
      team_id: team,
      pattern_id: patternId,
      offset_step_id: `made-step-${String(index)}`,
      // The prefill's anchor is today (owner decision); on 2026-09-26 the
      // seeded offsets are unchanged by the re-expression.
      anchor_date: TODAY,
      effective_from: TODAY,
    }))]);
  });

  it('sends only the facts 0016 grants: no id, attribution, cycle length or projected shift', async () => {
    const snapshot = await snapshotOf(UJ5);
    const draft = withTeamStep(prefillOf(snapshot, TODAY), 'uj5-smjena-a', 4);
    const { sent, tables } = tablesOf();

    await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY);

    expect(Object.keys(sent.patterns[0] as object)).toEqual(['organization_id']);
    expect(Object.keys((sent.steps[0] as object[])[0] as object).sort()).toEqual(
      ['organization_id', 'pattern_id', 'position', 'shift_type_id'].sort(),
    );
    expect(Object.keys((sent.assignments[0] as object[])[0] as object).sort()).toEqual(
      ['anchor_date', 'effective_from', 'offset_step_id', 'organization_id', 'pattern_id', 'team_id'].sort(),
    );
  });

  it('leaves every date before today as it was, and projects the draft from today', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-a', 1);
    const { sent, tables } = tablesOf();

    await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY);

    // What the database now holds: the old rows plus the three writes.
    const patternId = `pattern-${String(serial)}`;
    const after = await snapshotOf({
      ...PILOT,
      steps: [
        ...PILOT.steps,
        ...(sent.steps[0] as { position: number; shift_type_id: string }[]).map((row) =>
          stepRow(`made-step-${String(row.position)}`, patternId, row.position, row.shift_type_id),
        ),
      ],
      assignments: [
        ...PILOT.assignments,
        ...(sent.assignments[0] as Record<string, string>[]).map((row) =>
          assignmentRow(
            row['team_id'] as string,
            patternId,
            row['offset_step_id'] as string,
            row['anchor_date'] as string,
            row['effective_from'] as string,
          ),
        ),
      ],
    });
    const projected = (state: RotationSnapshot, date: string) =>
      rotationTeamsOf(state).map((team) =>
        projectedShiftTypeOn(teamAssignmentsOf(state, team.id), state.steps, date),
      );

    for (const date of datesFrom('2026-08-01', 56)) {
      if (date >= TODAY) break;
      expect(projected(after, date), date).toEqual(projected(snapshot, date));
    }
    expect(datesFrom(TODAY, 4).map((date) => projected(after, date))).toEqual(
      previewOf(snapshot, draft, TODAY).map((row) => row.cells.map((cell) => cell.chip.shiftTypeId)),
    );
    // And it now opens as the prefill, which saves nothing twice.
    expect(prefillOf(after, TODAY).steps).toEqual(draft.steps);
  });

  it('builds a fresh pattern on every attempt, a retry included', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-a', 1);
    const { sent, tables } = tablesOf([patternMade], [refusedWith('500'), stepsMade]);

    const first = await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY);
    const second = await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY);

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(sent.patterns).toHaveLength(2);
    const [one, other] = sent.steps as { pattern_id: string }[][];

    expect(one?.[0]?.pattern_id).not.toBe(other?.[0]?.pattern_id);
  });
});

describe('from a date forward (story 2.6)', () => {
  const NEXT_WEEK = '2026-10-03';

  it('writes every version from the effective date, the anchor its own, and no attribution', async () => {
    for (const rows of [PILOT, UJ5]) {
      const snapshot = await snapshotOf(rows);
      const [first] = rotationTeamsOf(snapshot);
      const draft = withEffectiveFrom(withTeamStep(prefillOf(snapshot, TODAY), first?.id ?? '', 1), NEXT_WEEK);
      const { sent, tables } = tablesOf();

      expect(await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY)).toEqual({ ok: true });

      const bound = sent.assignments[0] as Record<string, unknown>[];

      expect(bound).toHaveLength(rotationTeamsOf(snapshot).length);
      for (const row of bound) {
        expect(row['effective_from']).toBe(NEXT_WEEK);
        expect(row['anchor_date']).toBe(TODAY);
        // AD-11: `created_by` and `created_at` are `0016`'s defaults, never sent.
        expect(row).not.toHaveProperty('created_by');
        expect(row).not.toHaveProperty('created_at');
      }
    }
  });

  it('refuses a date before today with nothing sent, and keeps the draft', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = withEffectiveFrom(withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-a', 1), '2026-09-25');
    const copy = JSON.parse(JSON.stringify(draft)) as RotationDraft;
    const { log, tables } = tablesOf();

    expect(await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY)).toEqual({
      ok: false,
      code: ROTATION_EFFECTIVE_PAST,
      afterPattern: false,
    });
    expect(log).toEqual([]);
    expect(draft).toEqual(copy);
  });

  it('leaves every date before the effective date as it was, and projects the draft from it', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = withEffectiveFrom(withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-a', 1), NEXT_WEEK);
    const { sent, tables } = tablesOf();

    await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY);

    const patternId = `pattern-${String(serial)}`;
    const after = await snapshotOf({
      ...PILOT,
      steps: [
        ...PILOT.steps,
        ...(sent.steps[0] as { position: number; shift_type_id: string }[]).map((row) =>
          stepRow(`made-step-${String(row.position)}`, patternId, row.position, row.shift_type_id),
        ),
      ],
      assignments: [
        ...PILOT.assignments,
        ...(sent.assignments[0] as Record<string, string>[]).map((row) =>
          assignmentRow(
            row['team_id'] as string,
            patternId,
            row['offset_step_id'] as string,
            row['anchor_date'] as string,
            row['effective_from'] as string,
          ),
        ),
      ],
    });
    const projected = (state: RotationSnapshot, date: string) =>
      rotationTeamsOf(state).map((team) =>
        projectedShiftTypeOn(teamAssignmentsOf(state, team.id), state.steps, date),
      );

    for (const date of datesFrom('2026-09-01', 32)) {
      if (date >= NEXT_WEEK) break;
      expect(projected(after, date), date).toEqual(projected(snapshot, date));
    }
    expect(datesFrom(NEXT_WEEK, 4).map((date) => projected(after, date))).toEqual(
      previewOf(snapshot, draft, NEXT_WEEK).map((row) => row.cells.map((cell) => cell.chip.shiftTypeId)),
    );
  });
});

/** An assignments table that records the delete and its filters, answering from a script. */
function deleteTableOf(answer: () => RotationWriteAnswer | Error) {
  const log: string[] = [];
  const table: RotationAssignmentDeleteTable = {
    delete() {
      log.push('delete');

      return {
        eq(column, value) {
          log.push(`eq(${column},${value})`);

          return {
            eq(second, other) {
              log.push(`eq(${second},${other})`);

              return {
                in(third, values) {
                  log.push(`in(${third},${values.join('|')})`);

                  return {
                    select(columns) {
                      log.push(`select(${columns})`);
                      const answered = answer();

                      return answered instanceof Error ? Promise.reject(answered) : Promise.resolve(answered);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return { table, log };
}

describe('cancelling a scheduled change (story 2.6, decision 2a)', () => {
  const NEXT_WEEK = '2026-10-03';
  const scheduledRows: FixtureRows = {
    ...PILOT,
    assignments: [
      ...PILOT.assignments,
      ...['a', 'b', 'c', 'd'].map((letter, index) =>
        assignmentRow(`pilot-smjena-${letter}`, 'pilot-rotation', `pilot-step-${String(3 - index)}`, TODAY, NEXT_WEEK),
      ),
    ],
  };

  const ACTIVE = ['a', 'b', 'c', 'd'].map((letter) => `pilot-smjena-${letter}`);
  const fourRows = () => ({ data: ACTIVE.map((team) => ({ id: team })), error: null });

  it("deletes the active teams' assignments at the confirmed scheduled date, and nothing else", async () => {
    const snapshot = await snapshotOf(scheduledRows);
    const { table, log } = deleteTableOf(fourRows);

    expect(await cancelScheduledRotation(table, ORGANIZATION, snapshot, TODAY, NEXT_WEEK)).toEqual({ ok: true });
    expect(log).toEqual([
      'delete',
      `eq(organization_id,${ORGANIZATION})`,
      `eq(effective_from,${NEXT_WEEK})`,
      `in(team_id,${ACTIVE.join('|')})`,
      'select(id)',
    ]);
  });

  it("never touches an archived team's version at that date, and counts only the active teams'", async () => {
    const snapshot = await snapshotOf({
      ...scheduledRows,
      teams: [...scheduledRows.teams, teamRow('gone', 'Smjena Z', { archived: true })],
      assignments: [...scheduledRows.assignments, assignmentRow('gone', 'pilot-rotation', 'pilot-step-1', TODAY, NEXT_WEEK)],
    });
    const { table, log } = deleteTableOf(fourRows);

    expect(await cancelScheduledRotation(table, ORGANIZATION, snapshot, TODAY, NEXT_WEEK)).toEqual({ ok: true });
    expect(log.find((entry) => entry.startsWith('in('))).not.toContain('gone');
  });

  it('zero rows back, or fewer than the active versions at that date, is stale: never a partial success', async () => {
    const snapshot = await snapshotOf(scheduledRows);

    for (const data of [[], [{ id: 'one' }], ACTIVE.slice(0, 3).map((team) => ({ id: team }))]) {
      const { table } = deleteTableOf(() => ({ data, error: null }));

      expect(await cancelScheduledRotation(table, ORGANIZATION, snapshot, TODAY, NEXT_WEEK), String(data.length)).toEqual({
        ok: false,
        code: ROTATION_CANCEL_STALE,
      });
    }
  });

  it('nothing scheduled, or a date other than the one confirmed, is stale, with nothing sent', async () => {
    const { table, log } = deleteTableOf(fourRows);

    expect(await cancelScheduledRotation(table, ORGANIZATION, await snapshotOf(PILOT), TODAY, NEXT_WEEK)).toEqual({
      ok: false,
      code: ROTATION_CANCEL_STALE,
    });
    // On the scheduled date itself the change is in effect: nothing to cancel.
    expect(
      await cancelScheduledRotation(table, ORGANIZATION, await snapshotOf(scheduledRows), NEXT_WEEK, NEXT_WEEK),
    ).toEqual({ ok: false, code: ROTATION_CANCEL_STALE });
    // The dialog confirmed one date; the snapshot now schedules another.
    expect(
      await cancelScheduledRotation(table, ORGANIZATION, await snapshotOf(scheduledRows), TODAY, '2026-10-10'),
    ).toEqual({ ok: false, code: ROTATION_CANCEL_STALE });
    expect(log).toEqual([]);
  });

  it('refused (42501) and unavailable map as the save does', async () => {
    const snapshot = await snapshotOf(scheduledRows);

    for (const [answer, code] of [
      [() => ({ data: null, error: { code: '42501' } }), ROTATION_WRITE_REFUSED],
      [() => ({ data: null, error: { code: '500' } }), ROTATION_WRITE_UNAVAILABLE],
      [() => new Error('down'), ROTATION_WRITE_UNAVAILABLE],
      [() => ({ data: null, error: null }), ROTATION_WRITE_UNAVAILABLE],
      [() => ({ data: ['not a row'], error: null }), ROTATION_WRITE_UNAVAILABLE],
    ] as [() => RotationWriteAnswer | Error, RotationCancelFailure][]) {
      const { table } = deleteTableOf(answer);

      expect(await cancelScheduledRotation(table, ORGANIZATION, snapshot, TODAY, NEXT_WEEK)).toEqual({ ok: false, code });
    }
  });
});

describe('an archived team does not refuse the save', () => {
  it('saves over an archived team with a version scheduled after today, and binds only active teams', async () => {
    const rows: FixtureRows = {
      ...PILOT,
      teams: [...PILOT.teams, teamRow('gone', 'Smjena Z', { archived: true })],
      assignments: [...PILOT.assignments, assignmentRow('gone', 'pilot-rotation', 'pilot-step-1', SEEDED, '2026-10-01')],
    };
    const snapshot = await snapshotOf(rows);
    const { sent, tables } = tablesOf();

    expect(await saveRotation(tables, ORGANIZATION, snapshot, withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-a', 1), TODAY)).toEqual({ ok: true });
    expect((sent.assignments[0] as { team_id: string }[]).map((row) => row.team_id)).not.toContain('gone');
  });
});

describe('refused before anything is sent, every value kept', () => {
  it.each([
    {
      name: 'unchanged',
      code: ROTATION_UNCHANGED,
      rows: PILOT,
      draft: (snapshot: RotationSnapshot) => prefillOf(snapshot, TODAY),
    },
    {
      name: 'empty',
      code: ROTATION_EMPTY,
      rows: PILOT,
      draft: (snapshot: RotationSnapshot) => emptyDraftOf(rotationTeamsOf(snapshot), TODAY),
    },
    {
      name: 'no team',
      code: ROTATION_NO_TEAMS,
      rows: { ...PILOT, teams: [], assignments: [] },
      draft: (snapshot: RotationSnapshot) => withStepAdded(emptyDraftOf(rotationTeamsOf(snapshot), TODAY), 'pilot-dan'),
    },
    {
      name: 'scheduled',
      code: ROTATION_SCHEDULED,
      rows: {
        ...PILOT,
        assignments: [...PILOT.assignments, assignmentRow('pilot-smjena-b', 'pilot-rotation', 'pilot-step-0', SEEDED, '2026-10-02')],
      },
      draft: (snapshot: RotationSnapshot) => withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-a', 1),
    },
    {
      name: 'archived type',
      code: ROTATION_TYPE_ARCHIVED,
      rows: { ...PILOT, types: PILOT.types.map((row) => (row['id'] === 'pilot-noc' ? { ...row, archived: true } : row)) },
      draft: (snapshot: RotationSnapshot) => withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-a', 1),
    },
    {
      name: 'second save today',
      code: ROTATION_CHANGED_TODAY,
      rows: {
        ...PILOT,
        assignments: [...PILOT.assignments, assignmentRow('pilot-smjena-b', 'pilot-rotation', 'pilot-step-0', SEEDED, TODAY)],
      },
      draft: (snapshot: RotationSnapshot) => withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-a', 1),
    },
  ])('$name: $code, and nothing written', async ({ code, rows, draft }) => {
    const snapshot = await snapshotOf(rows);
    const entered: RotationDraft = draft(snapshot);
    const { log, tables } = tablesOf();

    expect(await saveRotation(tables, ORGANIZATION, snapshot, entered, TODAY)).toEqual({
      ok: false,
      code,
      afterPattern: false,
    });
    expect(log).toEqual([]);
  });
});

describe('the failures, by code and by constraint', () => {
  async function changed() {
    const snapshot = await snapshotOf(PILOT);

    return { snapshot, draft: withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-a', 1) };
  }

  it('the pattern refused: 42501, nothing else sent, nothing left behind', async () => {
    const { snapshot, draft } = await changed();
    const { log, tables } = tablesOf([refusedWith('42501')]);
    const outcome = await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY);

    expect(outcome).toEqual({ ok: false, code: ROTATION_WRITE_REFUSED, afterPattern: false });
    expect(log).toEqual(['patterns', 'patterns.select(id)']);
    expect(rotationPartialMessageKey(outcome)).toBeNull();
  });

  it('the steps refused: an orphan pattern, and "nothing changed" beside the reason', async () => {
    const { snapshot, draft } = await changed();
    const { log, tables } = tablesOf([patternMade], [refusedWith('42501')]);
    const outcome = await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY);

    expect(outcome).toEqual({ ok: false, code: ROTATION_WRITE_REFUSED, afterPattern: true });
    expect(log).not.toContain('assignments');
    expect(rotationPartialMessageKey(outcome)).toBe('rotation.builder.error.nothingChanged');
  });

  it('a second version today, by constraint name: already changed today, nothing further written', async () => {
    const { snapshot, draft } = await changed();
    const { tables } = tablesOf(
      [patternMade],
      [stepsMade],
      [
        refusedWith(
          '23505',
          'duplicate key value violates unique constraint "rotation_assignments_team_id_effective_from_key"',
        ),
      ],
    );
    const outcome = await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY);

    expect(outcome).toEqual({ ok: false, code: ROTATION_CHANGED_TODAY, afterPattern: true });
    expect(rotationPartialMessageKey(outcome)).toBe('rotation.builder.error.nothingChanged');
  });

  it('steps returned at other positions than sent: an orphan pattern, nothing changed, no assignment sent', async () => {
    const { snapshot, draft } = await changed();

    for (const positions of [
      [0, 1, 2, 2],
      [1, 2, 3, 4],
      [0, 1, 2, 3.5],
    ]) {
      const { log, tables } = tablesOf(
        [patternMade],
        [() => ({ data: positions.map((position, index) => ({ id: `s${String(index)}`, position })), error: null })],
      );
      const outcome = await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY);

      expect(outcome, JSON.stringify(positions)).toEqual({
        ok: false,
        code: ROTATION_WRITE_UNAVAILABLE,
        afterPattern: true,
      });
      expect(log).not.toContain('assignments');
      expect(rotationPartialMessageKey(outcome)).toBe('rotation.builder.error.nothingChanged');
    }
  });

  it('maps every other refusal: another 23505, a 42501, any other code', () => {
    expect(rotationWriteFailureOf({ code: '23505', message: 'rotation_steps_pattern_id_position_key' })).toBe(
      ROTATION_WRITE_UNAVAILABLE,
    );
    expect(rotationWriteFailureOf({ code: '23505', details: 'rotation_assignments_team_id_effective_from_key' })).toBe(
      ROTATION_CHANGED_TODAY,
    );
    expect(rotationWriteFailureOf({ code: '42501' })).toBe(ROTATION_WRITE_REFUSED);
    expect(rotationWriteFailureOf({ code: '23503' })).toBe(ROTATION_WRITE_UNAVAILABLE);
    expect(rotationWriteFailureOf({})).toBe(ROTATION_WRITE_UNAVAILABLE);
  });

  it('a thrown call, rows that are not rows, or fewer rows than sent: unavailable', async () => {
    const { snapshot, draft } = await changed();

    for (const [patterns, steps] of [
      [[() => new Error('down')], [stepsMade]],
      [[() => ({ data: null, error: null })], [stepsMade]],
      [[patternMade], [() => ({ data: [{ id: 'one', position: 0 }], error: null })]],
      [[() => ({ data: [{ id: '' }], error: null })], [stepsMade]],
    ] as ((sent: unknown) => Answer)[][][]) {
      const { tables } = tablesOf(patterns, steps);
      const outcome = await saveRotation(tables, ORGANIZATION, snapshot, draft, TODAY);

      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.code).toBe(ROTATION_WRITE_UNAVAILABLE);
    }
  });
});

describe('the messages', () => {
  const resource = JSON.parse(
    readFileSync(new URL('../i18n/locales/hr.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const messageAt = (key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], resource);

  it('gives every code its own key, each in the resource file', () => {
    const codes: RotationWriteFailure[] = [
      ROTATION_EMPTY,
      ROTATION_NO_TEAMS,
      ROTATION_SCHEDULED,
      ROTATION_EFFECTIVE_PAST,
      ROTATION_TYPE_ARCHIVED,
      ROTATION_UNCHANGED,
      ROTATION_CHANGED_TODAY,
      ROTATION_WRITE_REFUSED,
      ROTATION_WRITE_UNAVAILABLE,
    ];
    const keys = codes.map(rotationWriteMessageKey);

    expect(new Set(keys).size).toBe(codes.length);
    for (const key of [...keys, ROTATION_SAVED_MESSAGE_KEY, 'rotation.builder.error.nothingChanged']) {
      expect(typeof messageAt(key), key).toBe('string');
    }
  });

  it("gives the cancel's stale refusal its own key, and maps the rest as the save does", () => {
    const codes: RotationCancelFailure[] = [ROTATION_CANCEL_STALE, ROTATION_WRITE_REFUSED, ROTATION_WRITE_UNAVAILABLE];
    const keys = codes.map(rotationCancelMessageKey);

    expect(keys).toEqual([
      'rotation.builder.cancelScheduled.stale',
      rotationWriteMessageKey(ROTATION_WRITE_REFUSED),
      rotationWriteMessageKey(ROTATION_WRITE_UNAVAILABLE),
    ]);
    for (const key of [...keys, ROTATION_CANCELLED_MESSAGE_KEY]) {
      expect(typeof messageAt(key), key).toBe('string');
    }
  });
});

describe('the rotation modules write nothing they must not', () => {
  it('never update a pattern, a step or an assignment, and delete only in the cancel of a scheduled change', () => {
    const directory = new URL('./', import.meta.url);
    let deletes = 0;

    for (const file of readdirSync(directory).filter((name) => !name.endsWith('.test.ts'))) {
      const source = readFileSync(new URL(file, directory), 'utf8');

      deletes += source.split('.delete(').length - 1;
      if (file !== 'write.ts') expect(source, file).not.toContain('.delete(');
      expect(source, file).not.toContain('.update(');
      expect(source, file).not.toContain('.upsert(');
    }

    // STORY 2.6: exactly one delete, and it is inside `cancelScheduledRotation`.
    const write = readFileSync(new URL('write.ts', directory), 'utf8');
    const cancel = /export async function cancelScheduledRotation\([\s\S]*?\n\}/.exec(write)?.[0] ?? '';

    expect(deletes, 'a second delete arrived').toBe(1);
    expect(cancel, 'the cancel could not be extracted').toContain('rotationScheduledDateOf(');
    expect(cancel, 'the one delete is not the cancel').toContain('.delete()');
  });
});
