import { readFileSync } from 'node:fs';

import { projectedShiftTypeOn } from '@shift/domain';
import { describe, expect, it } from 'vitest';

import {
  ROTATION_CHANGED_TODAY,
  ROTATION_EFFECTIVE_PAST,
  ROTATION_EMPTY,
  ROTATION_NO_TEAMS,
  ROTATION_SCHEDULED,
  ROTATION_TYPE_ARCHIVED,
  ROTATION_UNCHANGED,
  FOCUS_ADD,
  FOCUS_STEP,
  STEP_CONTROL_HANDLE,
  STEP_CONTROL_REMOVE,
  STEP_DOWN,
  STEP_UP,
  addableTypesOf,
  datesFrom,
  draftRefusalOf,
  draftShiftTypeOn,
  draftStepRowsOf,
  draftTeamRowsOf,
  draftUnchangedOf,
  emptyDraftOf,
  figuresOf,
  dropOf,
  focusAfterDropOf,
  focusAfterRemoveOf,
  normalizedDraftOf,
  prefillOf,
  NO_CLOCK_RANGE,
  PREVIEW_CYCLE_CHOICES,
  previewCyclesOf,
  previewGridOf,
  previewOf,
  stepControlIdOf,
  stepIndexOf,
  withAnchor,
  withEffectiveFrom,
  withStepAdded,
  withStepMoved,
  withStepMovedTo,
  stepPositionOf,
  withOffsetsSpread,
  spreadOfferedOf,
  withStepRemoved,
  withTeamStep,
  type RotationDraft,
} from '@/rotation/draft';
import { readRotation, rotationTeamsOf, teamAssignmentsOf, type RotationSnapshot } from '@/rotation/list';
import {
  PILOT,
  SEEDED,
  TODAY,
  UJ5,
  answerOf,
  assignmentRow,
  stepRow,
  teamRow,
  typeRow,
  type FixtureRows,
} from '@/rotation/rotation.fixture';

/**
 * Story 2.3b's draft, executed rather than read (AD-15): the prefill with its
 * anchor re-expression, the step operations and the offset rule, the live
 * figures, the preview through `@shift/domain`, and every refusal made before
 * anything is sent — every draft row of the spec's matrix, over both
 * fixtures, plus a seeded-PRNG check that the prefill previews exactly what
 * is stored.
 */

async function snapshotOf(rows: FixtureRows): Promise<RotationSnapshot> {
  const outcome = await readRotation({ select: () => Promise.resolve(answerOf(rows)) });

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** The type ids the stored rotation projects for every active team on `date`. */
function storedOn(snapshot: RotationSnapshot, date: string): (string | null)[] {
  return rotationTeamsOf(snapshot).map((team) =>
    projectedShiftTypeOn(teamAssignmentsOf(snapshot, team.id), snapshot.steps, date),
  );
}

/** The preview as type ids, row by row. */
function previewIds(snapshot: RotationSnapshot, draft: RotationDraft, today = TODAY): string[][] {
  return previewOf(snapshot, draft, today).map((row) => row.cells.map((cell) => cell.chip.shiftTypeId));
}

const DAN = 'pilot-dan';
const NOC = 'pilot-noc';
const SLOB = 'pilot-slobodno';

describe('the prefill', () => {
  it('pilot on 2026-09-26: Dan Noć Slob Slob, anchor today, A–D on steps 1–4, 4 dana · 2 · 24 h, the seeded projection', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = prefillOf(snapshot, TODAY);

    expect(draft.steps).toEqual([DAN, NOC, SLOB, SLOB]);
    // 2460 days after the seeded 2020-01-01 anchor, a whole number of cycles.
    expect(draft.anchorDate).toBe(TODAY);
    expect(draft.offsets).toEqual({
      'pilot-smjena-a': 0,
      'pilot-smjena-b': 1,
      'pilot-smjena-c': 2,
      'pilot-smjena-d': 3,
    });
    expect(figuresOf(snapshot, draft, TODAY)).toEqual({ cycleLength: 4, workingSteps: 2, nonWorkingSteps: 2, cycleMinutes: 1440 });
    expect(previewIds(snapshot, draft)).toEqual(datesFrom(TODAY, 4).map((date) => storedOn(snapshot, date)));
  });

  it('pilot on 2026-09-27: anchor that day, re-expressed — A on step 2, B on 3, C on 4, D on 1', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = prefillOf(snapshot, '2026-09-27');

    expect(draft.anchorDate).toBe('2026-09-27');
    expect(draft.offsets).toEqual({
      'pilot-smjena-a': 1,
      'pilot-smjena-b': 2,
      'pilot-smjena-c': 3,
      'pilot-smjena-d': 0,
    });
    expect(previewIds(snapshot, draft, '2026-09-27')).toEqual(
      datesFrom('2026-09-27', 4).map((date) => storedOn(snapshot, date)),
    );
    expect(draftRefusalOf(snapshot, draft, '2026-09-27')).toBe(ROTATION_UNCHANGED);
  });

  it('UJ-5 on 2026-09-26: five steps, anchor today, each team on the step it works today, 5 dana · 3 · 24 h, three columns', async () => {
    const snapshot = await snapshotOf(UJ5);
    const draft = prefillOf(snapshot, TODAY);
    const preview = previewOf(snapshot, draft, TODAY);

    expect(draft.steps).toHaveLength(5);
    expect(draft.anchorDate).toBe(TODAY);
    // 2460 days after 2020-01-01 is 0 in a 5-day cycle as well: the identity.
    expect(draft.offsets).toEqual({ 'uj5-smjena-a': 0, 'uj5-smjena-b': 1, 'uj5-smjena-c': 2 });
    const tomorrow = prefillOf(snapshot, '2026-09-27');

    expect(tomorrow.offsets).toEqual({ 'uj5-smjena-a': 1, 'uj5-smjena-b': 2, 'uj5-smjena-c': 3 });
    expect(previewIds(snapshot, tomorrow, '2026-09-27')).toEqual(
      datesFrom('2026-09-27', 5).map((date) => storedOn(snapshot, date)),
    );
    expect(figuresOf(snapshot, draft, TODAY)).toEqual({ cycleLength: 5, workingSteps: 3, nonWorkingSteps: 2, cycleMinutes: 1440 });
    expect(preview).toHaveLength(5);
    expect(preview.every((row) => row.cells.length === 3)).toBe(true);
    expect(previewIds(snapshot, draft)).toEqual(datesFrom(TODAY, 5).map((date) => storedOn(snapshot, date)));
  });

  it('re-expresses a team stored on another anchor onto today, so the preview is unchanged', async () => {
    // Smjena B is stored at step 1 (Dan) from 2020-01-02; on 2020-01-01 that
    // is one day earlier, step 4 — the step it stood on in the seed.
    const rows: FixtureRows = {
      ...PILOT,
      assignments: [
        ...PILOT.assignments.filter((row) => row['team_id'] !== 'pilot-smjena-b'),
        assignmentRow('pilot-smjena-b', 'pilot-rotation', 'pilot-step-0', '2020-01-02', SEEDED),
      ],
    };
    const snapshot = await snapshotOf(rows);
    const draft = prefillOf(snapshot, TODAY);

    expect(draft.anchorDate).toBe(TODAY);
    // Stored at step 1 from 2020-01-02: 2459 days to today, 3 in the cycle.
    expect(draft.offsets['pilot-smjena-b']).toBe(3);
    expect(previewIds(snapshot, draft)).toEqual(datesFrom(TODAY, 4).map((date) => storedOn(snapshot, date)));
    expect(draftRefusalOf(snapshot, draft, TODAY)).toBe(ROTATION_UNCHANGED);
  });

  it("takes today as the anchor whatever each team's stored anchor is", async () => {
    const rows: FixtureRows = {
      ...PILOT,
      assignments: PILOT.assignments.map((row) =>
        row['team_id'] === 'pilot-smjena-a'
          ? assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-2', '2026-09-28', SEEDED)
          : row,
      ),
    };
    const snapshot = await snapshotOf(rows);
    const draft = prefillOf(snapshot, TODAY);

    expect(draft.anchorDate).toBe(TODAY);
    // Step 3 on 2026-09-28 is step 1 two days earlier, today.
    expect(draft.offsets['pilot-smjena-a']).toBe(0);
    expect(previewIds(snapshot, draft)).toEqual(datesFrom(TODAY, 4).map((date) => storedOn(snapshot, date)));
  });

  it('mixed patterns: an empty draft, anchored today', async () => {
    const rows: FixtureRows = {
      ...PILOT,
      steps: [...PILOT.steps, stepRow('other-0', 'other', 0, DAN)],
      assignments: [
        ...PILOT.assignments.filter((row) => row['team_id'] !== 'pilot-smjena-d'),
        assignmentRow('pilot-smjena-d', 'other', 'other-0', SEEDED, SEEDED),
      ],
    };
    const snapshot = await snapshotOf(rows);

    expect(prefillOf(snapshot, TODAY)).toEqual(emptyDraftOf(rotationTeamsOf(snapshot), TODAY));
    expect(prefillOf(snapshot, TODAY).steps).toEqual([]);
    expect(prefillOf(snapshot, TODAY).anchorDate).toBe(TODAY);
  });

  it('a team with no rotation, or no team at all: an empty draft, anchored today', async () => {
    const withNewTeam = await snapshotOf({ ...PILOT, teams: [...PILOT.teams, teamRow('new', 'Smjena E')] });
    const withNoTeam = await snapshotOf({ ...PILOT, teams: [], assignments: [] });

    expect(prefillOf(withNewTeam, TODAY).steps).toEqual([]);
    expect(prefillOf(withNewTeam, TODAY).offsets['new']).toBe(0);
    expect(prefillOf(withNoTeam, TODAY)).toEqual({ steps: [], anchorDate: TODAY, effectiveFrom: TODAY, offsets: {}, keys: [], nextKey: 0 });
  });

  it('takes the version in force today, not a later or earlier one', async () => {
    const rows: FixtureRows = {
      ...PILOT,
      steps: [...PILOT.steps, stepRow('next-0', 'next', 0, NOC), stepRow('next-1', 'next', 1, SLOB)],
      assignments: [
        ...PILOT.assignments,
        ...PILOT.teams.map((team) => assignmentRow(String(team['id']), 'next', 'next-0', '2026-09-20', '2026-09-20')),
      ],
    };
    const snapshot = await snapshotOf(rows);

    expect(prefillOf(snapshot, TODAY).steps).toEqual([NOC, SLOB]);
    expect(prefillOf(snapshot, '2026-09-19').steps).toEqual([DAN, NOC, SLOB, SLOB]);
  });
});

describe('the step operations keep every team on its step', () => {
  it('reorder: Noć above Dan — the figures stay, the preview changes, each team follows its step', async () => {
    const snapshot = await snapshotOf(PILOT);
    const before = prefillOf(snapshot, TODAY);
    const after = withStepMoved(before, 1, STEP_UP);

    expect(after.steps).toEqual([NOC, DAN, SLOB, SLOB]);
    expect(figuresOf(snapshot, after, TODAY)).toEqual(figuresOf(snapshot, before, TODAY));
    expect(previewIds(snapshot, after)).not.toEqual(previewIds(snapshot, before));
    expect(after.offsets['pilot-smjena-a']).toBe(1);
    expect(after.offsets['pilot-smjena-b']).toBe(0);
    expect(after.offsets['pilot-smjena-c']).toBe(2);
    // On the anchor every team still works what it worked there.
    expect(draftTeamRowsOf(snapshot, after).map((row) => row.onAnchor?.shiftTypeId)).toEqual(
      draftTeamRowsOf(snapshot, before).map((row) => row.onAnchor?.shiftTypeId),
    );
    expect(withStepMoved(after, 0, STEP_DOWN)).toEqual(before);
  });

  it('moves nothing past either end', async () => {
    const draft = prefillOf(await snapshotOf(PILOT), TODAY);

    expect(withStepMoved(draft, 0, STEP_UP)).toBe(draft);
    expect(withStepMoved(draft, 3, STEP_DOWN)).toBe(draft);
  });

  it('repeat: Dan Dan Noć Slob Slob Slob is 6 dana, 3 working, 36 h', async () => {
    const snapshot = await snapshotOf(PILOT);
    let draft = emptyDraftOf(rotationTeamsOf(snapshot), TODAY);

    for (const type of [DAN, DAN, NOC, SLOB, SLOB, SLOB]) draft = withStepAdded(draft, type);

    expect(draft.steps).toEqual([DAN, DAN, NOC, SLOB, SLOB, SLOB]);
    expect(figuresOf(snapshot, draft, TODAY)).toEqual({ cycleLength: 6, workingSteps: 3, nonWorkingSteps: 3, cycleMinutes: 2160 });
    expect(previewOf(snapshot, draft, TODAY)).toHaveLength(6);
  });

  it("remove a team's step: C falls to step 1, D keeps its own step", async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = withStepRemoved(prefillOf(snapshot, TODAY), 2);

    expect(draft.steps).toEqual([DAN, NOC, SLOB]);
    expect(draft.offsets).toEqual({
      'pilot-smjena-a': 0,
      'pilot-smjena-b': 1,
      'pilot-smjena-c': 0,
      'pilot-smjena-d': 2,
    });
  });

  it('removing the last step leaves every team on step 1 of an empty pattern', async () => {
    let draft = withStepAdded(emptyDraftOf(rotationTeamsOf(await snapshotOf(PILOT)), TODAY), DAN);

    draft = withStepRemoved(draft, 0);
    expect(draft.steps).toEqual([]);
    expect(Object.values(draft.offsets)).toEqual([0, 0, 0, 0]);
    expect(withStepRemoved(draft, 0)).toBe(draft);
  });

  it('adding a step keeps every team where it stands', async () => {
    const draft = prefillOf(await snapshotOf(PILOT), TODAY);

    expect(withStepAdded(draft, DAN).offsets).toEqual(draft.offsets);
  });

  it('puts one team on a step, and ignores a step outside the pattern or an unknown team', async () => {
    const draft = prefillOf(await snapshotOf(PILOT), TODAY);

    expect(withTeamStep(draft, 'pilot-smjena-a', 3).offsets['pilot-smjena-a']).toBe(3);
    expect(withTeamStep(draft, 'pilot-smjena-a', 4)).toBe(draft);
    expect(withTeamStep(draft, 'nobody', 1)).toBe(draft);
    expect(stepIndexOf(draft, '2')).toBe(2);
    expect(stepIndexOf(draft, '4')).toBeNull();
    expect(stepIndexOf(draft, 'x')).toBeNull();
    expect(stepIndexOf(draft, '1.5')).toBeNull();
    expect(stepIndexOf(draft, '0')).toBe(0);
    for (const value of ['', ' ', '\t', '1e0', '+1', '-0', ' 1', '1 ', '0x1', '1.0']) {
      expect(stepIndexOf(draft, value), JSON.stringify(value)).toBeNull();
    }
  });

  it('takes a calendar date as the anchor and keeps the anchor for anything else', async () => {
    const draft = prefillOf(await snapshotOf(PILOT), TODAY);

    expect(withAnchor(draft, '2026-10-01').anchorDate).toBe('2026-10-01');
    expect(withAnchor(draft, '')).toBe(draft);
    expect(withAnchor(draft, '2026-02-30')).toBe(draft);
  });

  it('gives every active team exactly one step, a new team step 1, a stepless one none', async () => {
    const snapshot = await snapshotOf({
      ...PILOT,
      teams: [...PILOT.teams, teamRow('new', 'Smjena E'), teamRow('gone', 'Smjena Z', { archived: true })],
    });
    const draft = normalizedDraftOf(
      { steps: [DAN, NOC], anchorDate: TODAY, effectiveFrom: TODAY, offsets: { 'pilot-smjena-a': 1, 'pilot-smjena-b': 7, gone: 1 }, keys: [], nextKey: 0 },
      rotationTeamsOf(snapshot),
    );

    expect(draft.offsets).toEqual({
      'pilot-smjena-a': 1,
      'pilot-smjena-b': 0,
      'pilot-smjena-c': 0,
      'pilot-smjena-d': 0,
      new: 0,
    });
  });
});

describe('each step keeps its client key, and focus lands where the rule says', () => {
  it('keys the prefill, moves a key with its step, drops it with its step, and never reuses one', async () => {
    const draft = prefillOf(await snapshotOf(PILOT), TODAY);

    expect(draft.keys).toEqual(['step-0', 'step-1', 'step-2', 'step-3']);
    expect(withStepMoved(draft, 1, STEP_UP).keys).toEqual(['step-1', 'step-0', 'step-2', 'step-3']);
    expect(withStepRemoved(draft, 1).keys).toEqual(['step-0', 'step-2', 'step-3']);

    const added = withStepAdded(withStepRemoved(draft, 3), DAN);

    expect(added.keys).toEqual(['step-0', 'step-1', 'step-2', 'step-4']);
    expect(new Set(added.keys).size).toBe(added.keys.length);
  });

  it('rows are keyed by the client key, and it is never sent', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = withStepMoved(prefillOf(snapshot, TODAY), 0, STEP_DOWN);

    expect(draftStepRowsOf(snapshot, draft).map((row) => row.key)).toEqual(draft.keys);
    expect(readFileSync(new URL('./write.ts', import.meta.url), 'utf8')).not.toMatch(/\.keys\b|nextKey/);
  });

  it('repairs keys that do not match the steps', () => {
    const draft = normalizedDraftOf({ steps: [DAN, NOC], anchorDate: TODAY, effectiveFrom: TODAY, offsets: {}, keys: ['x'], nextKey: 0 }, []);

    expect(draft.keys).toEqual(['step-0', 'step-1']);
    expect(withStepAdded(draft, SLOB).keys).toEqual(['step-0', 'step-1', 'step-2']);
  });

  it("after a drop, focus stays on the moved step's handle, wherever it landed", async () => {
    const draft = prefillOf(await snapshotOf(PILOT), TODAY);

    expect(focusAfterDropOf(withStepMovedTo(draft, 0, 3), 3)).toEqual({ kind: FOCUS_STEP, key: 'step-0', control: STEP_CONTROL_HANDLE });
    expect(focusAfterDropOf(withStepMovedTo(draft, 3, 0), 0)).toEqual({ kind: FOCUS_STEP, key: 'step-3', control: STEP_CONTROL_HANDLE });
    expect(focusAfterDropOf(draft, 4)).toBeNull();
  });

  it("after a removal, focus goes to the next step's remove, or to the add select when none follows", async () => {
    const draft = prefillOf(await snapshotOf(PILOT), TODAY);

    expect(focusAfterRemoveOf(withStepRemoved(draft, 1), 1)).toEqual({ kind: FOCUS_STEP, key: 'step-2', control: STEP_CONTROL_REMOVE });
    expect(focusAfterRemoveOf(withStepRemoved(draft, 3), 3)).toEqual({ kind: FOCUS_ADD });
    expect(stepControlIdOf('step-2', STEP_CONTROL_REMOVE)).not.toBe(stepControlIdOf('step-2', STEP_CONTROL_HANDLE));
  });
});

describe('a drop moves a step to any place, and every team follows its step', () => {
  it('moves the first step to the end: the steps between shift up, keys and teams follow', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = prefillOf(snapshot, TODAY);
    const after = withStepMovedTo(draft, 0, 3);

    expect(after.steps).toEqual([NOC, SLOB, SLOB, DAN]);
    expect(after.keys).toEqual(['step-1', 'step-2', 'step-3', 'step-0']);
    expect(after.offsets).toEqual({
      'pilot-smjena-a': 3,
      'pilot-smjena-b': 0,
      'pilot-smjena-c': 1,
      'pilot-smjena-d': 2,
    });
    // Each team works on the anchor what it worked there before.
    expect(draftTeamRowsOf(snapshot, after).map((row) => row.onAnchor?.shiftTypeId)).toEqual(
      draftTeamRowsOf(snapshot, draft).map((row) => row.onAnchor?.shiftTypeId),
    );
    expect(figuresOf(snapshot, after, TODAY)).toEqual(figuresOf(snapshot, draft, TODAY));
  });

  it('moves the last step to the front, and back again to the same draft', async () => {
    const draft = prefillOf(await snapshotOf(PILOT), TODAY);
    const after = withStepMovedTo(draft, 3, 0);

    expect(after.steps).toEqual([SLOB, DAN, NOC, SLOB]);
    expect(after.keys).toEqual(['step-3', 'step-0', 'step-1', 'step-2']);
    expect(after.offsets['pilot-smjena-d']).toBe(0);
    expect(withStepMovedTo(after, 0, 3)).toEqual(draft);
  });

  it('is the one-place move for a neighbour', async () => {
    const draft = prefillOf(await snapshotOf(UJ5), TODAY);

    expect(withStepMovedTo(draft, 1, 2)).toEqual(withStepMoved(draft, 1, STEP_DOWN));
    expect(withStepMovedTo(draft, 2, 1)).toEqual(withStepMoved(draft, 2, STEP_UP));
  });

  it('leaves the draft as it was for the same place, an index outside the pattern, or a fraction', async () => {
    const draft = prefillOf(await snapshotOf(PILOT), TODAY);

    for (const [from, to] of [[1, 1], [-1, 2], [0, 4], [4, 0], [0.5, 2]] as const) {
      expect(withStepMovedTo(draft, from, to)).toBe(draft);
    }
  });

  it('reads a drop by keys: from the dragged step to the one it is over, or nothing', async () => {
    const draft = prefillOf(await snapshotOf(PILOT), TODAY);

    expect(dropOf(draft, 'step-0', 'step-2')).toEqual({ from: 0, to: 2 });
    expect(dropOf(draft, 'step-0', 'step-0')).toBeNull();
    expect(dropOf(draft, 'step-0', null)).toBeNull();
    expect(dropOf(draft, 'nowhere', 'step-1')).toBeNull();
    expect(stepPositionOf(draft, 'step-2')).toBe(3);
    expect(stepPositionOf(draft, 'nowhere')).toBeNull();
  });
});

describe('Rasporedi ravnomjerno spreads the teams evenly over the cycle', () => {
  const teamsOf = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `team-${String(index)}`,
      organizationId: 'org',
      name: `Smjena ${String(index)}`,
      archived: false,
    }));
  const draftOf = (length: number, teams: readonly { id: string }[]): RotationDraft => ({
    steps: Array.from({ length }, (_, index) => `type-${String(index)}`),
    anchorDate: TODAY,
    effectiveFrom: TODAY,
    offsets: Object.fromEntries(teams.map((team) => [team.id, 0])),
    keys: Array.from({ length }, (_, index) => `step-${String(index)}`),
    nextKey: length,
  });
  /** The steps the teams land on, 1-based as the screen names them. */
  const spread = (count: number, length: number) => {
    const teams = teamsOf(count);

    return teams.map((team) => (withOffsetsSpread(draftOf(length, teams), teams).offsets[team.id] ?? -1) + 1);
  };

  it.each([
    { count: 4, length: 4, steps: [1, 2, 3, 4] },
    { count: 3, length: 4, steps: [1, 2, 3] },
    { count: 2, length: 4, steps: [1, 3] },
    { count: 5, length: 4, steps: [1, 2, 3, 4, 1] },
    { count: 1, length: 4, steps: [1] },
    { count: 3, length: 5, steps: [1, 2, 4] },
    { count: 7, length: 3, steps: [1, 2, 3, 1, 2, 3, 1] },
  ])('$count teams on $length steps: steps $steps', ({ count, length, steps }) => {
    expect(spread(count, length)).toEqual(steps);
  });

  it('leaves an empty pattern as it was, and is not offered there', () => {
    const teams = teamsOf(3);
    const empty = draftOf(0, teams);

    expect(withOffsetsSpread(empty, teams)).toBe(empty);
    expect(spreadOfferedOf(empty, teams)).toBe(false);
    expect(spreadOfferedOf(draftOf(2, teams), teams)).toBe(true);
    expect(spreadOfferedOf(draftOf(2, []), [])).toBe(false);
  });

  it('touches only the offsets: steps, keys, the anchor and the next key stay', () => {
    const teams = teamsOf(3);
    const draft = draftOf(4, teams);
    const after = withOffsetsSpread(draft, teams);

    expect(after.steps).toBe(draft.steps);
    expect(after.keys).toBe(draft.keys);
    expect(after.anchorDate).toBe(draft.anchorDate);
    expect(after.nextKey).toBe(draft.nextKey);
  });

  it('pilot: every team on step 1, spread, previews exactly the seeded projection on the seeded anchor', async () => {
    const snapshot = await snapshotOf(PILOT);
    const teams = rotationTeamsOf(snapshot);
    let draft = prefillOf(snapshot, TODAY);

    for (const team of teams) draft = withTeamStep(draft, team.id, 0);
    draft = withOffsetsSpread(withAnchor(draft, SEEDED), teams);

    expect(draft.anchorDate).toBe(SEEDED);
    expect(Object.values(draft.offsets)).toEqual([0, 1, 2, 3]);
    expect(previewIds(snapshot, draft)).toEqual(datesFrom(TODAY, 4).map((date) => storedOn(snapshot, date)));
  });
});

describe('the figures', () => {
  it('hours unknown: a working type with no times makes the hours unknown, never 0', async () => {
    const snapshot = await snapshotOf({
      ...PILOT,
      types: [...PILOT.types, typeRow('pilot-dezurstvo', 'Dežurstvo', '2026-09-25T21:00:00+00:00')],
    });
    const draft = withStepAdded(prefillOf(snapshot, TODAY), 'pilot-dezurstvo');

    expect(figuresOf(snapshot, draft, TODAY)).toEqual({ cycleLength: 5, workingSteps: 3, nonWorkingSteps: 2, cycleMinutes: null });
  });

  it('an empty pattern is 0 dana, 0 working, 0 h', async () => {
    const snapshot = await snapshotOf(PILOT);

    expect(figuresOf(snapshot, emptyDraftOf(rotationTeamsOf(snapshot), TODAY), TODAY)).toEqual({
      cycleLength: 0,
      workingSteps: 0,
      nonWorkingSteps: 0,
      cycleMinutes: 0,
    });
  });

  it("uses each type's times in effect today", async () => {
    const snapshot = await snapshotOf(PILOT);
    const [dan] = snapshot.types;
    const corrected: RotationSnapshot = {
      ...snapshot,
      types: snapshot.types.map((type) =>
        type === dan
          ? {
              ...type,
              versions: [
                ...type.versions,
                { shiftTypeId: type.id, effectiveFrom: '2026-10-01', startMinute: 420, endMinute: 1080 },
              ],
            }
          : type,
      ),
    };
    const draft = prefillOf(corrected, TODAY);

    expect(figuresOf(corrected, draft, TODAY).cycleMinutes).toBe(1440);
    expect(figuresOf(corrected, draft, '2026-10-01').cycleMinutes).toBe(1380);
  });
});

describe('the preview', () => {
  it('one row per date from today, one cell per active team, dated through the format layer', async () => {
    const snapshot = await snapshotOf(PILOT);
    const preview = previewOf(snapshot, prefillOf(snapshot, TODAY), TODAY);

    expect(preview.map((row) => row.date)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29']);
    expect(preview[0]?.label).toBe('26.09.2026');
    expect(preview[0]?.cells.map((cell) => cell.teamId)).toEqual(
      rotationTeamsOf(snapshot).map((team) => team.id),
    );
  });

  it('draws each cell in its ramp-slot chip, with the name', async () => {
    const snapshot = await snapshotOf(PILOT);
    const cells = previewOf(snapshot, prefillOf(snapshot, TODAY), TODAY).flatMap((row) => row.cells);
    const dan = cells.find((cell) => cell.chip.shiftTypeId === DAN)?.chip;
    const slob = cells.find((cell) => cell.chip.shiftTypeId === SLOB)?.chip;

    expect(dan?.name).toBe('Dan');
    expect(dan?.chipClass).toContain('bg-shift-slot-1');
    expect(slob?.chipClass).toContain('bg-shift-nonworking');
  });

  it('has no rows while the pattern is empty', async () => {
    const snapshot = await snapshotOf(PILOT);

    expect(previewOf(snapshot, emptyDraftOf(rotationTeamsOf(snapshot), TODAY), TODAY)).toEqual([]);
  });

  it('projects the unsaved draft, not the stored rotation', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = withTeamStep(prefillOf(snapshot, TODAY), 'pilot-smjena-a', 1);

    expect(previewIds(snapshot, draft).map((row) => row[0])).not.toEqual(
      datesFrom(TODAY, 4).map((date) => storedOn(snapshot, date)[0]),
    );
  });
});

describe('the preview, transposed: teams as rows, dates as columns', () => {
  it('pilot on 2026-09-26: Dan N headers with short dates, each team a row of its projected tiles and clock ranges', async () => {
    const snapshot = await snapshotOf(PILOT);
    const grid = previewGridOf(snapshot, prefillOf(snapshot, TODAY), TODAY);

    expect(grid.days).toEqual([
      { date: '2026-09-26', dayNumber: 1, cycleNumber: 1, startsCycle: false, headClass: expect.not.stringContaining('border-l-2'), cellClass: expect.not.stringContaining('border-l-2'), label: '26.09.' },
      { date: '2026-09-27', dayNumber: 2, cycleNumber: 1, startsCycle: false, headClass: expect.not.stringContaining('border-l-2'), cellClass: expect.not.stringContaining('border-l-2'), label: '27.09.' },
      { date: '2026-09-28', dayNumber: 3, cycleNumber: 1, startsCycle: false, headClass: expect.not.stringContaining('border-l-2'), cellClass: expect.not.stringContaining('border-l-2'), label: '28.09.' },
      { date: '2026-09-29', dayNumber: 4, cycleNumber: 1, startsCycle: false, headClass: expect.not.stringContaining('border-l-2'), cellClass: expect.not.stringContaining('border-l-2'), label: '29.09.' },
    ]);
    expect(grid.rows.map((row) => row.team.name)).toEqual(['Smjena A', 'Smjena B', 'Smjena C', 'Smjena D']);
    // The transpose of the date-rows preview, and of the stored projection.
    expect(grid.rows.map((row) => row.cells.map((cell) => cell.chip.shiftTypeId))).toEqual(
      rotationTeamsOf(snapshot).map((_, column) =>
        datesFrom(TODAY, 4).map((date) => storedOn(snapshot, date)[column]),
      ),
    );
    expect(grid.rows[0]?.cells.map((cell) => cell.range)).toEqual([
      '07:00–19:00',
      '19:00–07:00',
      NO_CLOCK_RANGE,
      NO_CLOCK_RANGE,
    ]);
    expect(grid.rows[0]?.cells[0]?.chip.tileClass).toContain('bg-shift-slot-1');
    expect(grid.rows[0]?.cells[2]?.chip.tileClass).toContain('bg-shift-nonworking');
    expect(NO_CLOCK_RANGE).toBe('—');
  });

  it('UJ-5: three rows of five, the 8-hour ranges, Noćna crossing midnight', async () => {
    const snapshot = await snapshotOf(UJ5);
    const grid = previewGridOf(snapshot, prefillOf(snapshot, TODAY), TODAY);

    expect(grid.days).toHaveLength(5);
    expect(grid.rows).toHaveLength(3);
    expect(grid.rows.map((row) => row.cells.map((cell) => cell.chip.shiftTypeId))).toEqual(
      rotationTeamsOf(snapshot).map((_, column) =>
        datesFrom(TODAY, 5).map((date) => storedOn(snapshot, date)[column]),
      ),
    );
    expect(grid.rows[0]?.cells.map((cell) => cell.range)).toEqual([
      '06:00–14:00',
      '14:00–22:00',
      '22:00–06:00',
      NO_CLOCK_RANGE,
      NO_CLOCK_RANGE,
    ]);
  });

  it("gives each date the times in effect on it, and a working type with none shows '—'", async () => {
    const snapshot = await snapshotOf({
      ...PILOT,
      types: [...PILOT.types, typeRow('pilot-dezurstvo', 'Dežurstvo', '2026-09-25T21:00:00+00:00')],
    });
    const corrected: RotationSnapshot = {
      ...snapshot,
      types: snapshot.types.map((type) =>
        type.id === DAN
          ? {
              ...type,
              versions: [
                ...type.versions,
                { shiftTypeId: DAN, effectiveFrom: '2026-09-30', startMinute: 360, endMinute: 1080 },
              ],
            }
          : type,
      ),
    };
    const teams = rotationTeamsOf(corrected);
    // Every team on step 1 (Dan) on the 29th, so Dan falls on the 29th and the 1st.
    const draft = withStepAdded(withStepAdded(emptyDraftOf(teams, '2026-09-29'), DAN), 'pilot-dezurstvo');
    const grid = previewGridOf(corrected, draft, '2026-09-29');

    expect(grid.rows[0]?.cells.map((cell) => cell.range)).toEqual(['07:00–19:00', NO_CLOCK_RANGE]);
    expect(previewGridOf(corrected, draft, '2026-10-01').rows[0]?.cells[0]?.range).toBe('06:00–18:00');
  });

  it('has no days and empty rows while the pattern is empty', async () => {
    const snapshot = await snapshotOf(PILOT);
    const grid = previewGridOf(snapshot, emptyDraftOf(rotationTeamsOf(snapshot), TODAY), TODAY);

    expect(grid.days).toEqual([]);
    expect(grid.rows.every((row) => row.cells.length === 0)).toBe(true);
  });
});

describe('the preview over 1–5 cycles (owner request)', () => {
  it('offers exactly 1–5 cycles, and reads anything else as 1', () => {
    expect(PREVIEW_CYCLE_CHOICES).toEqual([1, 2, 3, 4, 5]);
    for (const [value, cycles] of [
      [3, 3],
      ['5', 5],
      [0, 1],
      [6, 1],
      [2.5, 1],
      ['', 1],
      ['2e0', 1],
      [' 2', 1],
      ['-1', 1],
    ] as const) {
      expect(previewCyclesOf(value), JSON.stringify(value)).toBe(cycles);
    }
  });

  it.each([
    { fixture: 'pilot', rows: PILOT, length: 4 },
    { fixture: 'UJ-5', rows: UJ5, length: 5 },
  ])('$fixture: 1 and 3 cycles equal the stored projection over the whole window', async ({ rows, length }) => {
    const snapshot = await snapshotOf(rows);
    const draft = prefillOf(snapshot, TODAY);

    for (const cycles of [1, 3]) {
      const grid = previewGridOf(snapshot, draft, TODAY, cycles);

      expect(grid.days).toHaveLength(cycles * length);
      expect(grid.rows.map((row) => row.cells.map((cell) => cell.chip.shiftTypeId))).toEqual(
        rotationTeamsOf(snapshot).map((_, column) =>
          datesFrom(TODAY, cycles * length).map((date) => storedOn(snapshot, date)[column]),
        ),
      );
      expect(previewOf(snapshot, draft, TODAY, cycles)).toHaveLength(cycles * length);
    }
  });

  it("restarts 'Dan N' at 1 with every cycle, numbers the cycles, and marks each boundary after the first", async () => {
    const snapshot = await snapshotOf(PILOT);
    const days = previewGridOf(snapshot, prefillOf(snapshot, TODAY), TODAY, 3).days;

    expect(days.map((day) => day.dayNumber)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]);
    expect(days.map((day) => day.cycleNumber)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
    expect(days.filter((day) => day.startsCycle).map((day) => day.date)).toEqual(['2026-09-30', '2026-10-04']);
    expect(days.at(-1)?.date).toBe('2026-10-07');
    expect(days.filter((day) => day.headClass.includes('border-l-2')).map((day) => day.date)).toEqual([
      '2026-09-30',
      '2026-10-04',
    ]);
  });

  it('reads an invalid choice as one cycle, and the choice is no part of the draft or of unchanged', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = prefillOf(snapshot, TODAY);

    expect(previewGridOf(snapshot, draft, TODAY, 9).days).toHaveLength(4);
    expect(Object.keys(draft)).not.toContain('cycles');
    expect(draftRefusalOf(snapshot, draft, TODAY)).toBe(ROTATION_UNCHANGED);
  });
});

describe('the builder lists', () => {
  it('names every step by its position, first and last marked, and labels an archived type', async () => {
    const snapshot = await snapshotOf({
      ...PILOT,
      types: PILOT.types.map((row) => (row['id'] === NOC ? { ...row, archived: true } : row)),
    });
    const rows = draftStepRowsOf(snapshot, prefillOf(snapshot, TODAY));

    expect(rows.map((row) => row.position)).toEqual([1, 2, 3, 4]);
    expect(rows.map((row) => [row.first, row.last])).toEqual([
      [true, false],
      [false, false],
      [false, false],
      [false, true],
    ]);
    expect(rows.map((row) => row.chip.archived)).toEqual([false, true, false, false]);
    expect(addableTypesOf(snapshot).map((type) => type.shiftTypeId)).toEqual([DAN, SLOB]);
  });
});

describe('refused before anything is sent', () => {
  it('unchanged: the prefill as it opened', async () => {
    for (const rows of [PILOT, UJ5]) {
      const snapshot = await snapshotOf(rows);

      expect(draftRefusalOf(snapshot, prefillOf(snapshot, TODAY), TODAY)).toBe(ROTATION_UNCHANGED);
    }
  });

  it('unchanged is judged by projection: a re-anchored equivalent is unchanged, a moved team is not', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = prefillOf(snapshot, TODAY);
    // One day later on the anchor, every team one step back: the same schedule.
    const reanchored: RotationDraft = {
      ...draft,
      anchorDate: '2020-01-02',
      offsets: { 'pilot-smjena-a': 1, 'pilot-smjena-b': 2, 'pilot-smjena-c': 3, 'pilot-smjena-d': 0 },
    };

    expect(draftUnchangedOf(snapshot, reanchored, TODAY)).toBe(true);
    expect(draftUnchangedOf(snapshot, withTeamStep(draft, 'pilot-smjena-a', 1), TODAY)).toBe(false);
    expect(draftUnchangedOf(snapshot, withStepMoved(draft, 1, STEP_UP), TODAY)).toBe(false);
    expect(draftUnchangedOf(snapshot, withAnchor(draft, '2020-01-02'), TODAY)).toBe(false);
    expect(draftRefusalOf(snapshot, withTeamStep(draft, 'pilot-smjena-a', 1), TODAY)).toBeNull();
  });

  it('a new team with no rotation yet makes the same pattern a change', async () => {
    const snapshot = await snapshotOf({ ...PILOT, teams: [...PILOT.teams, teamRow('new', 'Smjena E')] });
    const draft = normalizedDraftOf(prefillOf(await snapshotOf(PILOT), TODAY), rotationTeamsOf(snapshot));

    expect(draftUnchangedOf(snapshot, draft, TODAY)).toBe(false);
  });

  it('empty and no team, each by its own code', async () => {
    const snapshot = await snapshotOf(PILOT);
    const empty = emptyDraftOf(rotationTeamsOf(snapshot), TODAY);
    const noTeams = await snapshotOf({ ...PILOT, teams: [], assignments: [] });

    expect(draftRefusalOf(snapshot, empty, TODAY)).toBe(ROTATION_EMPTY);
    expect(draftRefusalOf(noTeams, withStepAdded(empty, DAN), TODAY)).toBe(ROTATION_NO_TEAMS);
  });

  it('a step on an archived type', async () => {
    const snapshot = await snapshotOf({
      ...PILOT,
      types: PILOT.types.map((row) => (row['id'] === NOC ? { ...row, archived: true } : row)),
    });

    expect(draftRefusalOf(snapshot, prefillOf(snapshot, TODAY), TODAY)).toBe(ROTATION_TYPE_ARCHIVED);
    expect(draftRefusalOf(snapshot, withStepRemoved(prefillOf(snapshot, TODAY), 1), TODAY)).toBeNull();
  });

  it('an assignment scheduled after today', async () => {
    const snapshot = await snapshotOf({
      ...PILOT,
      assignments: [
        ...PILOT.assignments,
        assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-1', SEEDED, '2026-10-01'),
      ],
    });

    expect(draftRefusalOf(snapshot, withStepAdded(prefillOf(snapshot, TODAY), DAN), TODAY)).toBe(
      ROTATION_SCHEDULED,
    );
  });

  it('a rotation already changed today', async () => {
    const snapshot = await snapshotOf({
      ...PILOT,
      assignments: [
        ...PILOT.assignments,
        assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-1', SEEDED, TODAY),
      ],
    });

    expect(draftRefusalOf(snapshot, withStepAdded(prefillOf(snapshot, TODAY), DAN), TODAY)).toBe(
      ROTATION_CHANGED_TODAY,
    );
  });

  it('keeps every entered value: a refusal is a code, and the draft is untouched', async () => {
    const snapshot = await snapshotOf(PILOT);
    const draft = prefillOf(snapshot, TODAY);
    const copy = JSON.parse(JSON.stringify(draft)) as RotationDraft;

    draftRefusalOf(snapshot, draft, TODAY);
    expect(draft).toEqual(copy);
  });
});

describe('the effective date (story 2.6)', () => {
  const YESTERDAY = '2026-09-25';
  const NEXT_WEEK = '2026-10-03';

  it.each([
    { fixture: 'pilot', rows: PILOT },
    { fixture: 'UJ-5', rows: UJ5 },
  ])('$fixture: the prefill and an empty draft apply from today, the anchor staying today however the date moves', async ({ rows }) => {
    const snapshot = await snapshotOf(rows);
    const prefill = prefillOf(snapshot, TODAY);

    expect(prefill.effectiveFrom).toBe(TODAY);
    expect(emptyDraftOf(rotationTeamsOf(snapshot), TODAY).effectiveFrom).toBe(TODAY);

    const moved = withEffectiveFrom(prefill, NEXT_WEEK);

    expect(moved.effectiveFrom).toBe(NEXT_WEEK);
    expect(moved.anchorDate).toBe(TODAY);
    expect(moved.offsets).toEqual(prefill.offsets);
  });

  it('takes only a calendar date, and keeps a past one for the save to refuse', async () => {
    const draft = prefillOf(await snapshotOf(PILOT), TODAY);

    for (const value of ['', '2026-13-01', '2026-02-30', 'soon']) {
      expect(withEffectiveFrom(draft, value), value).toBe(draft);
    }
    expect(withEffectiveFrom(draft, ` ${YESTERDAY} `).effectiveFrom).toBe(YESTERDAY);
  });

  it.each([
    { fixture: 'pilot', rows: PILOT },
    { fixture: 'UJ-5', rows: UJ5 },
  ])('$fixture past: a date before today is refused, after only the scheduled, empty and no-team checks, and the draft is kept', async ({ rows }) => {
    const snapshot = await snapshotOf(rows);
    const [first] = rotationTeamsOf(snapshot);
    const changed = withTeamStep(prefillOf(snapshot, TODAY), first?.id ?? '', 1);

    for (const draft of [withEffectiveFrom(changed, YESTERDAY), withEffectiveFrom(prefillOf(snapshot, TODAY), '2020-01-01')]) {
      const copy = JSON.parse(JSON.stringify(draft)) as RotationDraft;

      expect(draftRefusalOf(snapshot, draft, TODAY)).toBe(ROTATION_EFFECTIVE_PAST);
      expect(draft).toEqual(copy);
    }
    expect(draftRefusalOf(snapshot, withEffectiveFrom(changed, TODAY), TODAY)).toBeNull();
  });

  it('future: the preview, the figures and the check all start on the effective date', async () => {
    const snapshot = await snapshotOf(PILOT);
    const [dan] = snapshot.types;
    // Dan's times change from next week, so the figures show which date they read.
    const corrected: RotationSnapshot = {
      ...snapshot,
      types: snapshot.types.map((type) =>
        type === dan
          ? {
              ...type,
              versions: [
                ...type.versions,
                { shiftTypeId: type.id, effectiveFrom: NEXT_WEEK, startMinute: 420, endMinute: 1080 },
              ],
            }
          : type,
      ),
    };
    const draft = withEffectiveFrom(withTeamStep(prefillOf(corrected, TODAY), 'pilot-smjena-a', 1), NEXT_WEEK);
    const grid = previewGridOf(corrected, draft, draft.effectiveFrom);

    expect(grid.days.map((day) => day.date)).toEqual(datesFrom(NEXT_WEEK, 4));
    expect(previewIds(corrected, draft, draft.effectiveFrom)).toEqual(
      datesFrom(NEXT_WEEK, 4).map((date) => rotationTeamsOf(corrected).map((team) => draftShiftTypeOn(draft, team.id, date))),
    );
    expect(figuresOf(corrected, draft, draft.effectiveFrom).cycleMinutes).toBe(1380);
    expect(figuresOf(corrected, draft, TODAY).cycleMinutes).toBe(1440);
    expect(draftRefusalOf(corrected, draft, TODAY)).toBeNull();
  });

  it.each([
    { fixture: 'pilot', rows: PILOT },
    { fixture: 'UJ-5', rows: UJ5 },
  ])('$fixture unchanged on the date: the version in force on it, re-expressed from today, is refused', async ({ rows }) => {
    const snapshot = await snapshotOf(rows);

    for (const date of [TODAY, '2026-09-27', NEXT_WEEK]) {
      const draft = withEffectiveFrom(prefillOf(snapshot, TODAY), date);

      expect(draftUnchangedOf(snapshot, draft, date), date).toBe(true);
      expect(draftRefusalOf(snapshot, draft, TODAY), date).toBe(ROTATION_UNCHANGED);
    }
  });

  it('judges unchanged against the version in force ON the date, not today', async () => {
    // A version from yesterday: today it is in force; on 2026-09-24 the seeded one was.
    const snapshot = await snapshotOf({
      ...PILOT,
      steps: [...PILOT.steps, stepRow('next-0', 'next', 0, NOC), stepRow('next-1', 'next', 1, SLOB)],
      assignments: [
        ...PILOT.assignments,
        ...PILOT.teams.map((team) => assignmentRow(String(team['id']), 'next', 'next-0', YESTERDAY, YESTERDAY)),
      ],
    });
    const seeded = prefillOf(snapshot, '2026-09-24');

    expect(draftUnchangedOf(snapshot, seeded, '2026-09-24')).toBe(true);
    expect(draftUnchangedOf(snapshot, withEffectiveFrom(seeded, NEXT_WEEK), NEXT_WEEK)).toBe(false);
  });

  it("refuses only a date a team's latest version already carries", async () => {
    const changedToday = await snapshotOf({
      ...PILOT,
      assignments: [...PILOT.assignments, assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-1', SEEDED, TODAY)],
    });
    const draft = withStepAdded(prefillOf(changedToday, TODAY), DAN);

    expect(draftRefusalOf(changedToday, draft, TODAY)).toBe(ROTATION_CHANGED_TODAY);
    expect(draftRefusalOf(changedToday, withEffectiveFrom(draft, '2026-09-27'), TODAY)).toBeNull();
  });

  it('refuses a scheduled change FIRST, over a past date, an empty pattern and no team, so the cancel is offered', async () => {
    const scheduled = {
      ...PILOT,
      assignments: [...PILOT.assignments, assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-1', SEEDED, NEXT_WEEK)],
    };
    const snapshot = await snapshotOf(scheduled);
    const prefill = prefillOf(snapshot, TODAY);

    expect(draftRefusalOf(snapshot, withEffectiveFrom(prefill, YESTERDAY), TODAY)).toBe(ROTATION_SCHEDULED);
    expect(draftRefusalOf(snapshot, emptyDraftOf(rotationTeamsOf(snapshot), TODAY), TODAY)).toBe(ROTATION_SCHEDULED);
    expect(
      draftRefusalOf(snapshot, withEffectiveFrom(emptyDraftOf(rotationTeamsOf(snapshot), TODAY), YESTERDAY), TODAY),
    ).toBe(ROTATION_SCHEDULED);
    // NO TEAM AND A SCHEDULED CHANGE CANNOT MEET: only an ACTIVE team's
    // version counts as scheduled. With every team archived, the scheduled
    // version refuses nothing and no-teams is what is said.
    const archived: RotationSnapshot = {
      ...snapshot,
      teams: snapshot.teams.map((team) => ({ ...team, archived: true })),
    };

    expect(draftRefusalOf(archived, prefill, TODAY)).toBe(ROTATION_NO_TEAMS);
  });

  it('reads the times in force ON a future effective date for the figures, not today\'s', async () => {
    const snapshot = await snapshotOf(UJ5);
    const [jutarnja] = snapshot.types;
    // Jutarnja goes from 06:00–14:00 (8 h) to 06:00–16:00 (10 h) on 2026-09-30,
    // between today and next week.
    const corrected: RotationSnapshot = {
      ...snapshot,
      types: snapshot.types.map((type) =>
        type === jutarnja
          ? {
              ...type,
              versions: [
                ...type.versions,
                { shiftTypeId: type.id, effectiveFrom: '2026-09-30', startMinute: 360, endMinute: 960 },
              ],
            }
          : type,
      ),
    };
    const draft = withEffectiveFrom(prefillOf(corrected, TODAY), NEXT_WEEK);

    expect(figuresOf(corrected, draft, TODAY).cycleMinutes).toBe(1440);
    expect(figuresOf(corrected, draft, draft.effectiveFrom).cycleMinutes).toBe(1560);
  });

  it('is unchanged when the draft equals a NEWER version in force on the effective date', async () => {
    // Snapshot data only: every team's version from NEXT_WEEK, on a two-step
    // pattern — as the database would hold it, with no save made here.
    const snapshot = await snapshotOf({
      ...PILOT,
      steps: [...PILOT.steps, stepRow('next-0', 'next', 0, NOC), stepRow('next-1', 'next', 1, SLOB)],
      assignments: [
        ...PILOT.assignments,
        ...PILOT.teams.map((team, index) =>
          assignmentRow(String(team['id']), 'next', `next-${String(index < 2 ? 0 : 1)}`, NEXT_WEEK, NEXT_WEEK),
        ),
      ],
    });
    const newer: RotationDraft = {
      ...emptyDraftOf(rotationTeamsOf(snapshot), TODAY),
      steps: [NOC, SLOB],
      keys: ['step-0', 'step-1'],
      nextKey: 2,
      anchorDate: NEXT_WEEK,
      effectiveFrom: NEXT_WEEK,
      offsets: { 'pilot-smjena-a': 0, 'pilot-smjena-b': 0, 'pilot-smjena-c': 1, 'pilot-smjena-d': 1 },
    };

    expect(draftUnchangedOf(snapshot, newer, NEXT_WEEK)).toBe(true);
    // Against the version in force today it is a change.
    expect(draftUnchangedOf(snapshot, newer, TODAY)).toBe(false);
  });

  it('still refuses a scheduled change, judged from today whatever the effective date', async () => {
    const snapshot = await snapshotOf({
      ...PILOT,
      assignments: [...PILOT.assignments, assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-1', SEEDED, NEXT_WEEK)],
    });
    const draft = withStepAdded(prefillOf(snapshot, TODAY), DAN);

    for (const date of [TODAY, '2026-10-10']) {
      expect(draftRefusalOf(snapshot, withEffectiveFrom(draft, date), TODAY), date).toBe(ROTATION_SCHEDULED);
    }
  });
});

describe('the prefill previews exactly what is stored, over randomized rotations (seeded)', () => {
  /** mulberry32 — a small seeded PRNG, so a failure reproduces. */
  function prng(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state);

      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('for 1–12 steps, 1–6 teams, each on its own anchor and step', async () => {
    const random = prng(20260926);
    const pick = (below: number) => Math.floor(random() * below);
    const days = datesFrom('2019-01-01', 3001);
    const dayOf = (offset: number) => days[offset] as string;

    for (let run = 0; run < 120; run += 1) {
      const cycleLength = 1 + pick(12);
      const teamCount = 1 + pick(6);
      const types = PILOT.types.map((row) => String(row['id']));
      // Gapped positions, repeated types: the stored shape 0016 admits.
      let position = pick(3);
      const steps = Array.from({ length: cycleLength }, (_, index) => {
        const row = stepRow(`r${String(run)}-step-${String(index)}`, `r${String(run)}`, position, types[pick(3)] as string);

        position += 1 + pick(3);

        return row;
      });
      const teams = Array.from({ length: teamCount }, (_, index) => teamRow(`r${String(run)}-team-${String(index)}`, `Smjena ${String(index)}`));
      const assignments = teams.map((team) =>
        assignmentRow(
          String(team['id']),
          `r${String(run)}`,
          String(steps[pick(cycleLength)]?.['id']),
          dayOf(pick(3000)),
          dayOf(pick(2000)),
        ),
      );
      const snapshot = await snapshotOf({ ...PILOT, teams, steps, assignments });
      const today = dayOf(2000 + pick(1000));
      const draft = prefillOf(snapshot, today);
      const label = `run ${String(run)}: ${String(cycleLength)} steps, ${String(teamCount)} teams, today ${today}`;

      expect(draft.steps, label).toHaveLength(cycleLength);
      expect(previewIds(snapshot, draft, today), label).toEqual(
        datesFrom(today, cycleLength).map((date) => storedOn(snapshot, date)),
      );
      expect(draftUnchangedOf(snapshot, draft, today), label).toBe(true);
    }
  });
});

describe('the draft module computes nothing it must not', () => {
  it('takes no modulo and walks no cycle by hand: the projection is the domain', () => {
    const source = readFileSync(new URL('./draft.ts', import.meta.url), 'utf8')
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll(/\/\/[^\n]*/g, '');

    expect(source).not.toMatch(/%/);
    expect(source).toContain('projectedStepId(');
    expect(source).toContain('projectedShiftType(');
    expect(source).toContain('shiftDurationOn(');
    expect(source).not.toMatch(/rank|position_in_team|teamPosition/i);
  });
});
