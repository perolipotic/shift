import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  daysBetween,
  projectedShiftType,
  projectedShiftTypeOn,
  projectedStepId,
  rotationAssignmentOn,
  type RotationAssignment,
  type RotationStep,
  type ShiftType,
} from '../src/index.js';
import {
  PILOT_ROTATION_ASSIGNMENTS,
  PILOT_ROTATION_PATTERN,
  PILOT_ROTATION_STEPS,
  PILOT_SHIFT_TYPES,
  PILOT_TEAMS,
  SEEDED_ANCHOR_DATE,
  SEEDED_EFFECTIVE_FROM,
  UJ5_ROTATION_ASSIGNMENTS,
  UJ5_ROTATION_PATTERN,
  UJ5_ROTATION_STEPS,
  UJ5_SHIFT_TYPES,
  UJ5_TEAMS,
  type FixtureTeam,
} from './fixtures.js';

/**
 * Story 2.3a — rotation projection (CAP-8, CAP-11, AD-2, AD-7; R1.1–R1.7,
 * Q9, Q10). Node environment, no browser. Every domain row of the spec's I/O
 * matrix is asserted here, over both fixtures.
 */

const FIXTURES = [
  {
    fixture: 'pilot',
    teams: PILOT_TEAMS,
    types: PILOT_SHIFT_TYPES,
    steps: PILOT_ROTATION_STEPS,
    assignments: PILOT_ROTATION_ASSIGNMENTS,
    patternId: PILOT_ROTATION_PATTERN.id,
  },
  {
    fixture: 'UJ-5',
    teams: UJ5_TEAMS,
    types: UJ5_SHIFT_TYPES,
    steps: UJ5_ROTATION_STEPS,
    assignments: UJ5_ROTATION_ASSIGNMENTS,
    patternId: UJ5_ROTATION_PATTERN.id,
  },
] as const;

/** The one assignment of `team` in a fixture. */
function assignmentOf(assignments: readonly RotationAssignment[], team: FixtureTeam): RotationAssignment {
  const found = assignments.find((assignment) => assignment.teamId === team.id);
  if (found === undefined) throw new Error(`no assignment for ${team.id}`);
  return found;
}

/** A shift type id, as the name a human reads in the engine rules' grid. */
function nameOf(types: readonly ShiftType[], id: string): string {
  const found = types.find((type) => type.id === id);
  if (found === undefined) throw new Error(`no shift type ${id}`);
  return found.name;
}

// ---------------------------------------------------------------- the oracle

/**
 * An INDEPENDENT calendar, for the brute-force walk: a date as numbers, moved
 * one day at a time by the month lengths alone. It shares no code with the
 * engine's civil-day arithmetic, so agreeing with it is evidence, not an echo.
 */
interface Civil {
  year: number;
  month: number;
  day: number;
}

function monthLength(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parse(date: string): Civil {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

function format({ year, month, day }: Civil): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function nextDay(date: Civil): void {
  date.day += 1;
  if (date.day > monthLength(date.year, date.month)) {
    date.day = 1;
    date.month += 1;
    if (date.month > 12) {
      date.month = 1;
      date.year += 1;
    }
  }
}

function previousDay(date: Civil): void {
  date.day -= 1;
  if (date.day < 1) {
    date.month -= 1;
    if (date.month < 1) {
      date.month = 12;
      date.year -= 1;
    }
    date.day = monthLength(date.year, date.month);
  }
}

/**
 * Walk `days` days from `from` (either direction), stepping a cycle index
 * along with it and wrapping by hand, never with `%`. Returns the date reached
 * and the index the team stands on there.
 */
function walk(from: string, days: number, startIndex: number, cycleLength: number): { date: string; index: number } {
  const date = parse(from);
  let index = startIndex;
  for (let step = 0; step < Math.abs(days); step += 1) {
    if (days > 0) {
      nextDay(date);
      index = index + 1 === cycleLength ? 0 : index + 1;
    } else {
      previousDay(date);
      index = index === 0 ? cycleLength - 1 : index - 1;
    }
  }
  return { date: format(date), index };
}

/** The walk's answer for one assignment on the date `days` days from its anchor. */
function walkedShiftType(
  steps: readonly RotationStep[],
  assignment: RotationAssignment,
  days: number,
): { date: string; shiftTypeId: string; stepId: string } {
  const ordered = [...steps].sort((left, right) => left.position - right.position);
  const offsetIndex = ordered.findIndex((step) => step.id === assignment.offsetStepId);
  const { date, index } = walk(assignment.anchorDate, days, offsetIndex, ordered.length);
  const step = ordered[index] as RotationStep;
  return { date, shiftTypeId: step.shiftTypeId, stepId: step.id };
}

/** An unbiased Fisher–Yates shuffle of a copy, drawing from `random`. */
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
  }
  return copy;
}

/** mulberry32 — a small seeded PRNG, so a failure reproduces. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----------------------------------------------------------------- the rules

describe('daysBetween', () => {
  it.each([
    ['the same date', '2020-01-01', '2020-01-01', 0],
    ['the next day', '2020-01-01', '2020-01-02', 1],
    ['the day before (R1.2)', '2020-01-01', '2019-12-31', -1],
    ['across a leap day', '2024-02-28', '2024-03-01', 2],
    ['across a common February', '2026-02-28', '2026-03-01', 1],
    ['across 1900, not a leap year', '1900-02-28', '1900-03-01', 1],
    ['across 2000, a leap year', '2000-02-28', '2000-03-01', 2],
    ['a leap year', '2024-01-01', '2025-01-01', 366],
    ['a common year', '2025-01-01', '2026-01-01', 365],
    ['four centuries', '1600-01-01', '2000-01-01', 146097],
    ['back from the anchor to 1970', '2020-01-01', '1970-01-01', -18262],
    ['the whole calendar the schema admits, 0001-01-01…9999-12-31', '0001-01-01', '9999-12-31', 3652058],
  ] as const)('counts %s', (_label, from, to, expected) => {
    expect(daysBetween(from, to)).toBe(expected);
    expect(daysBetween(to, from)).toBe(0 - expected);
  });

  it('admits exactly the calendar the schema admits: 0001-01-01 to 9999-12-31, and nothing either side', () => {
    expect(daysBetween('0001-01-01', '0001-01-01')).toBe(0);
    expect(daysBetween('9999-12-31', '9999-12-31')).toBe(0);
    expect(() => daysBetween('0000-12-31', '0001-01-01')).toThrow(RangeError);
    expect(() => daysBetween('0000-12-31', '0001-01-01')).toThrow('"0000-12-31"');
    expect(() => daysBetween('9999-12-31', '10000-01-01')).toThrow('"10000-01-01"');
  });

  it('agrees with a day-by-day walk over two centuries', () => {
    // Every date from 1900-01-01 to 2100-12-31, counted from the pilot anchor.
    const date = parse('1900-01-01');
    let expected = daysBetween(SEEDED_ANCHOR_DATE, '1900-01-01');
    expect(expected).toBe(-43829);
    while (date.year <= 2100) {
      expect(daysBetween(SEEDED_ANCHOR_DATE, format(date))).toBe(expected);
      nextDay(date);
      expected += 1;
    }
  });
});

describe('the pilot grid (engine rules §1)', () => {
  it('projects Smjena A–D over 2020-01-01…04 exactly as the worked example', () => {
    const grid = ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04'].map((date) =>
      PILOT_TEAMS.map((team) =>
        nameOf(
          PILOT_SHIFT_TYPES,
          projectedShiftType(PILOT_ROTATION_STEPS, assignmentOf(PILOT_ROTATION_ASSIGNMENTS, team), date),
        ),
      ),
    );

    expect(grid).toEqual([
      ['Dan', 'Noć', 'Slobodno', 'Slobodno'],
      ['Noć', 'Slobodno', 'Slobodno', 'Dan'],
      ['Slobodno', 'Slobodno', 'Dan', 'Noć'],
      ['Slobodno', 'Dan', 'Noć', 'Slobodno'],
    ]);
  });

  it('puts exactly one team on Dan and one on Noć on every date of a year', () => {
    // A property of this configuration, not a guarantee of the engine.
    for (let days = 0; days < 366; days += 1) {
      const { date } = walk(SEEDED_ANCHOR_DATE, days, 0, 1);
      const worked = PILOT_TEAMS.map((team) =>
        projectedShiftTypeOn([assignmentOf(PILOT_ROTATION_ASSIGNMENTS, team)], PILOT_ROTATION_STEPS, date),
      );
      expect(worked.filter((id) => id === 'pilot-dan'), date).toHaveLength(1);
      expect(worked.filter((id) => id === 'pilot-noc'), date).toHaveLength(1);
    }
  });
});

describe('dates before the anchor (R1.2)', () => {
  it('gives Smjena A Slobodno (index 3) on 2019-12-31, where daysBetween is −1', () => {
    const smjenaA = assignmentOf(PILOT_ROTATION_ASSIGNMENTS, PILOT_TEAMS[0]!);

    expect(daysBetween(smjenaA.anchorDate, '2019-12-31')).toBe(-1);
    expect(projectedShiftType(PILOT_ROTATION_STEPS, smjenaA, '2019-12-31')).toBe('pilot-slobodno');
    // Index 3. A sign-keeping `%` gives −1 here (`-1 % 4` is −1), which
    // names no step at all; the true modulo wraps it to the last one.
    const smjenaB = assignmentOf(PILOT_ROTATION_ASSIGNMENTS, PILOT_TEAMS[1]!);
    expect(projectedShiftType(PILOT_ROTATION_STEPS, smjenaB, '2019-12-31')).toBe('pilot-dan');
    const smjenaD = assignmentOf(PILOT_ROTATION_ASSIGNMENTS, PILOT_TEAMS[3]!);
    expect(projectedShiftType(PILOT_ROTATION_STEPS, smjenaD, '2019-12-31')).toBe('pilot-slobodno');
    expect(projectedShiftType(PILOT_ROTATION_STEPS, smjenaD, '2019-12-30')).toBe('pilot-noc');
    expect(projectedShiftType(PILOT_ROTATION_STEPS, smjenaD, '2019-12-29')).toBe('pilot-dan');
  });

  it.each(FIXTURES)('walks every $fixture team backwards a full cycle and more, day by day', ({ teams, steps, assignments }) => {
    for (const team of teams) {
      const assignment = assignmentOf(assignments, team);
      for (let days = -1; days >= -3 * steps.length; days -= 1) {
        const walked = walkedShiftType(steps, assignment, days);
        expect(projectedShiftType(steps, assignment, walked.date), `${team.id} on ${walked.date}`).toBe(
          walked.shiftTypeId,
        );
      }
    }
  });
});

describe('far past and far future', () => {
  it.each(FIXTURES)('equals a brute-force day walk for every $fixture team on 1900-03-01 and 2100-02-28', ({ teams, steps, assignments }) => {
    for (const target of ['1900-03-01', '2100-02-28']) {
      for (const team of teams) {
        const assignment = assignmentOf(assignments, team);
        const days = daysBetween(assignment.anchorDate, target);
        const walked = walkedShiftType(steps, assignment, days);
        expect(walked.date, 'the walk and daysBetween disagree on where the target is').toBe(target);
        expect(projectedShiftType(steps, assignment, target), `${team.id} on ${target}`).toBe(walked.shiftTypeId);
      }
    }
  });
});

describe('the UJ-5 rotation', () => {
  it('projects Smjena A–C over one five-day cycle, deterministically', () => {
    const dates = ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05'];
    const grid = () =>
      dates.map((date) =>
        UJ5_TEAMS.map((team) =>
          nameOf(UJ5_SHIFT_TYPES, projectedShiftType(UJ5_ROTATION_STEPS, assignmentOf(UJ5_ROTATION_ASSIGNMENTS, team), date)),
        ),
      );

    expect(grid()).toEqual([
      ['Jutarnja', 'Popodnevna', 'Noćna'],
      ['Popodnevna', 'Noćna', 'Slobodno'],
      ['Noćna', 'Slobodno', 'Slobodno'],
      ['Slobodno', 'Slobodno', 'Jutarnja'],
      ['Slobodno', 'Jutarnja', 'Popodnevna'],
    ]);
    // R1.1: a second evaluation agrees.
    expect(grid()).toEqual(grid());
    // And the cycle repeats: 2020-01-06 is 2020-01-01 again.
    for (const team of UJ5_TEAMS) {
      const assignment = assignmentOf(UJ5_ROTATION_ASSIGNMENTS, team);
      expect(projectedShiftType(UJ5_ROTATION_STEPS, assignment, '2020-01-06')).toBe(
        projectedShiftType(UJ5_ROTATION_STEPS, assignment, '2020-01-01'),
      );
    }
  });

  it('leaves working shift types uncovered on some dates, which the engine projects without complaint', () => {
    // Three teams on a five-step cycle cannot cover three working types every
    // day. Projection answers regardless; reporting it is 2.5's warning.
    const working = UJ5_SHIFT_TYPES.filter((type) => type.isWorking).map((type) => type.id);
    const uncovered = ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05'].map((date) => {
      const worked = UJ5_TEAMS.map((team) =>
        projectedShiftType(UJ5_ROTATION_STEPS, assignmentOf(UJ5_ROTATION_ASSIGNMENTS, team), date),
      );
      return working.filter((id) => !worked.includes(id)).length;
    });
    expect(uncovered).toEqual([0, 1, 2, 2, 1]);
  });
});

describe('rotationAssignmentOn', () => {
  const smjenaA = assignmentOf(PILOT_ROTATION_ASSIGNMENTS, PILOT_TEAMS[0]!);
  // A rotation change (2.6's shape): a NEW pattern and a new version pointing
  // at it. The old pattern and its steps stay.
  const changedSteps: readonly RotationStep[] = [
    { id: 'changed-step-0', patternId: 'changed-rotation', position: 0, shiftTypeId: 'pilot-dan' },
    { id: 'changed-step-1', patternId: 'changed-rotation', position: 1, shiftTypeId: 'pilot-slobodno' },
  ];
  const changed: RotationAssignment = {
    teamId: smjenaA.teamId,
    patternId: 'changed-rotation',
    offsetStepId: 'changed-step-1',
    anchorDate: '2026-10-01',
    effectiveFrom: '2026-10-01',
  };
  const allSteps = [...PILOT_ROTATION_STEPS, ...changedSteps];

  it('answers null before the earliest version, and invents no rotation', () => {
    expect(rotationAssignmentOn([smjenaA], '2019-12-31')).toBeNull();
    expect(rotationAssignmentOn([], '2026-09-25')).toBeNull();
    expect(projectedShiftTypeOn([smjenaA], PILOT_ROTATION_STEPS, '2019-12-31')).toBeNull();
    expect(projectedShiftTypeOn([], PILOT_ROTATION_STEPS, '2026-09-25')).toBeNull();
  });

  it('selects the version with the greatest effectiveFrom on or before the date', () => {
    for (const versions of [
      [smjenaA, changed],
      [changed, smjenaA],
    ]) {
      expect(rotationAssignmentOn(versions, SEEDED_EFFECTIVE_FROM)).toBe(smjenaA);
      expect(rotationAssignmentOn(versions, '2026-09-30')).toBe(smjenaA);
      expect(rotationAssignmentOn(versions, '2026-10-01')).toBe(changed);
      expect(rotationAssignmentOn(versions, '2099-12-31')).toBe(changed);
    }
  });

  it('projects dates before a change through the old pattern, and on or after it through the new', () => {
    // 2026-09-30 is 2464 days from the anchor: 2464 mod 4 = 0, so Dan; the
    // day before is index 3.
    expect(daysBetween(SEEDED_ANCHOR_DATE, '2026-09-30')).toBe(2464);
    expect(projectedShiftTypeOn([smjenaA, changed], allSteps, '2026-09-30')).toBe('pilot-dan');
    expect(projectedShiftTypeOn([smjenaA, changed], allSteps, '2026-09-29')).toBe('pilot-slobodno');
    // From 2026-10-01 the new two-step pattern, starting on its second step.
    expect(projectedShiftTypeOn([smjenaA, changed], allSteps, '2026-10-01')).toBe('pilot-slobodno');
    expect(projectedShiftTypeOn([smjenaA, changed], allSteps, '2026-10-02')).toBe('pilot-dan');
    expect(projectedShiftTypeOn([smjenaA, changed], allSteps, '2026-10-03')).toBe('pilot-slobodno');
    // Appending the change rewrote no date before it.
    for (let days = 0; days < daysBetween('2025-09-01', changed.effectiveFrom); days += 1) {
      const { date } = walk('2025-09-01', days, 0, 1);
      expect(projectedShiftTypeOn([smjenaA, changed], allSteps, date), date).toBe(
        projectedShiftTypeOn([smjenaA], PILOT_ROTATION_STEPS, date),
      );
    }
  });

  it('throws a RangeError naming both teams when the versions belong to more than one', () => {
    const smjenaB = assignmentOf(PILOT_ROTATION_ASSIGNMENTS, PILOT_TEAMS[1]!);
    for (const mixed of [
      [smjenaA, smjenaB],
      [smjenaB, smjenaA],
    ]) {
      expect(() => rotationAssignmentOn(mixed, '2026-09-25')).toThrow(RangeError);
      expect(() => rotationAssignmentOn(mixed, '2026-09-25')).toThrow(
        /pilot-smjena-a[\s\S]*pilot-smjena-b|pilot-smjena-b[\s\S]*pilot-smjena-a/,
      );
    }
    // Before either is in effect too: every version is checked.
    expect(() => rotationAssignmentOn([smjenaA, smjenaB], '2019-01-01')).toThrow(/pilot-smjena-b/);
  });

  it('throws a RangeError naming the date when two versions share it', () => {
    const twin = { ...changed, effectiveFrom: SEEDED_EFFECTIVE_FROM };
    expect(() => rotationAssignmentOn([smjenaA, twin], '2026-09-25')).toThrow(RangeError);
    expect(() => rotationAssignmentOn([smjenaA, twin], '2026-09-25')).toThrow(SEEDED_EFFECTIVE_FROM);
  });
});

describe('a rotation change from a date forward (story 2.6)', () => {
  // The change 2.6 saves: a NEW pattern (the old one's steps, reversed) and a
  // new version per team from EFFECTIVE, anchored on a date of its own — the
  // anchor fixes the phase, the effective date when it applies. Nothing of
  // the old version is touched.
  const EFFECTIVE = '2026-10-03';
  const ANCHOR = '2026-09-26';

  it.each(FIXTURES)('$fixture: the day before resolves through the old version, the effective day and later through the new', ({ teams, steps, assignments, patternId }) => {
    const changedSteps: readonly RotationStep[] = [...steps]
      .sort((one, other) => one.position - other.position)
      .reverse()
      .map((step, position) => ({ ...step, id: `changed-${step.id}`, patternId: `changed-${patternId}`, position }));
    const allSteps = [...steps, ...changedSteps];

    for (const [index, team] of teams.entries()) {
      const old = assignmentOf(assignments, team);
      const changed: RotationAssignment = {
        teamId: team.id,
        patternId: `changed-${patternId}`,
        offsetStepId: (changedSteps[index] as RotationStep).id,
        anchorDate: ANCHOR,
        effectiveFrom: EFFECTIVE,
      };
      const versions = [old, changed];
      let differs = false;

      // Before the effective date: exactly the old projection, for a full
      // cycle and more back from the day before.
      for (let days = 1; days <= steps.length * 3; days += 1) {
        const { date } = walk(EFFECTIVE, -days, 0, 1);

        expect(rotationAssignmentOn(versions, date), `${team.id} on ${date}`).toBe(old);
        expect(projectedShiftTypeOn(versions, allSteps, date), `${team.id} on ${date}`).toBe(
          projectedShiftType(steps, old, date),
        );
      }
      // On the effective date and after it: the new version, from its own
      // anchor.
      for (let days = 0; days < steps.length * 3; days += 1) {
        const { date } = walk(EFFECTIVE, days, 0, 1);

        expect(rotationAssignmentOn(versions, date), `${team.id} on ${date}`).toBe(changed);
        expect(projectedShiftTypeOn(versions, allSteps, date), `${team.id} on ${date}`).toBe(
          walkedShiftType(changedSteps, changed, daysBetween(ANCHOR, date)).shiftTypeId,
        );
        if (projectedShiftType(changedSteps, changed, date) !== projectedShiftType(steps, old, date)) differs = true;
      }
      // Not vacuous: the change changes something the old version said.
      expect(differs, team.id).toBe(true);
    }
  });
});

describe('the steps and the offset', () => {
  const smjenaA = assignmentOf(PILOT_ROTATION_ASSIGNMENTS, PILOT_TEAMS[0]!);

  it('orders steps by position, whatever order they are given in', () => {
    const reversed = [...PILOT_ROTATION_STEPS].reverse();
    for (const date of ['2019-12-31', '2020-01-01', '2020-01-02', '2026-09-25']) {
      expect(projectedShiftType(reversed, smjenaA, date)).toBe(
        projectedShiftType(PILOT_ROTATION_STEPS, smjenaA, date),
      );
    }
  });

  it('reads gaps in position as harmless: the index is what counts', () => {
    const gapped = PILOT_ROTATION_STEPS.map((step) => ({ ...step, position: step.position * 10 + 3 }));
    for (let days = -8; days <= 8; days += 1) {
      const { date } = walk(SEEDED_ANCHOR_DATE, days, 0, 1);
      for (const team of PILOT_TEAMS) {
        const assignment = assignmentOf(PILOT_ROTATION_ASSIGNMENTS, team);
        expect(projectedShiftType(gapped, assignment, date)).toBe(
          projectedShiftType(PILOT_ROTATION_STEPS, assignment, date),
        );
      }
    }
  });

  it('admits a shift type repeated in a pattern (R1.4) and two teams at one offset (R1.7)', () => {
    const shared: RotationAssignment = { ...smjenaA, teamId: 'another-team' };
    for (let days = -4; days <= 4; days += 1) {
      const { date } = walk(SEEDED_ANCHOR_DATE, days, 0, 1);
      expect(projectedShiftType(PILOT_ROTATION_STEPS, shared, date)).toBe(
        projectedShiftType(PILOT_ROTATION_STEPS, smjenaA, date),
      );
    }
  });

  it('projects a one-step pattern to its one type on every date', () => {
    const only: RotationStep = { id: 'only', patternId: 'single', position: 7, shiftTypeId: 'pilot-noc' };
    const assignment: RotationAssignment = { ...smjenaA, patternId: 'single', offsetStepId: 'only' };
    for (const date of ['0001-01-01', '1900-03-01', '2020-01-01', '9999-12-31']) {
      expect(projectedShiftType([only], assignment, date)).toBe('pilot-noc');
    }
  });

  it('refuses an empty pattern (R1.5) with a RangeError naming it', () => {
    expect(() => projectedShiftType([], smjenaA, '2020-01-01')).toThrow(RangeError);
    expect(() => projectedShiftType([], smjenaA, '2020-01-01')).toThrow(/pilot-rotation/);
    // Through the version reader as well: a version whose pattern has no steps
    // among those given.
    expect(() => projectedShiftTypeOn([smjenaA], UJ5_ROTATION_STEPS, '2020-01-01')).toThrow(/pilot-rotation/);
  });

  it('refuses an offset step outside the pattern (R1.6) with a RangeError naming it', () => {
    const foreign: RotationAssignment = { ...smjenaA, offsetStepId: 'uj5-step-0' };
    expect(() => projectedShiftType(PILOT_ROTATION_STEPS, foreign, '2020-01-01')).toThrow(RangeError);
    expect(() => projectedShiftType(PILOT_ROTATION_STEPS, foreign, '2020-01-01')).toThrow(/uj5-step-0/);
    const invented: RotationAssignment = { ...smjenaA, offsetStepId: 'pilot-step-4' };
    expect(() => projectedShiftType(PILOT_ROTATION_STEPS, invented, '2020-01-01')).toThrow(/pilot-step-4/);
  });

  it('refuses steps of more than one pattern with a RangeError naming both', () => {
    const mixed = [...PILOT_ROTATION_STEPS, UJ5_ROTATION_STEPS[0]!];
    expect(() => projectedShiftType(mixed, smjenaA, '2020-01-01')).toThrow(RangeError);
    expect(() => projectedShiftType(mixed, smjenaA, '2020-01-01')).toThrow(/uj5-rotation[\s\S]*pilot-rotation/);
    // And steps of another pattern than the assignment's.
    expect(() => projectedShiftType(UJ5_ROTATION_STEPS, smjenaA, '2020-01-01')).toThrow(/uj5-rotation/);
  });

  it('refuses two steps at one position with a RangeError naming it', () => {
    const twin = { ...PILOT_ROTATION_STEPS[3]!, id: 'pilot-step-twin', position: 2 };
    expect(() => projectedShiftType([...PILOT_ROTATION_STEPS, twin], smjenaA, '2020-01-01')).toThrow(RangeError);
    expect(() => projectedShiftType([...PILOT_ROTATION_STEPS, twin], smjenaA, '2020-01-01')).toThrow(
      /position 2/,
    );
  });

  it.each([
    ['a negative position', -1, '-1'],
    ['a fractional position', 1.5, '1.5'],
    ['NaN', Number.NaN, 'NaN'],
  ] as const)('refuses %s with a RangeError naming it', (_label, position, offender) => {
    const broken = [...PILOT_ROTATION_STEPS.slice(0, 3), { ...PILOT_ROTATION_STEPS[3]!, position }];
    expect(() => projectedShiftType(broken, smjenaA, '2020-01-01')).toThrow(RangeError);
    expect(() => projectedShiftType(broken, smjenaA, '2020-01-01')).toThrow(offender);
  });

  it('refuses one step given twice', () => {
    const again = [...PILOT_ROTATION_STEPS, { ...PILOT_ROTATION_STEPS[0]!, position: 9 }];
    expect(() => projectedShiftType(again, smjenaA, '2020-01-01')).toThrow(/pilot-step-0/);
  });
});

describe('malformed dates', () => {
  const smjenaA = assignmentOf(PILOT_ROTATION_ASSIGNMENTS, PILOT_TEAMS[0]!);

  it.each([
    ['a date with no padding', '2026-9-25'],
    ['a timestamp', '2026-09-25T00:00:00Z'],
    ['month 13', '2026-13-01'],
    ['day 00', '2026-09-00'],
    ['30 February', '2024-02-30'],
    ['29 February in 1900', '1900-02-29'],
    ['year 0000, which PostgreSQL does not have', '0000-01-01'],
    ['the last day of year 0000', '0000-12-31'],
    ['a BC date as PostgreSQL prints one', '0044-03-15 BC'],
    ['a five-digit year', '10000-01-01'],
    ['an empty string', ''],
  ] as const)('throws a RangeError naming %s, wherever it is given', (_label, date) => {
    const named = JSON.stringify(date);
    expect(() => daysBetween(date, SEEDED_ANCHOR_DATE)).toThrow(named);
    expect(() => daysBetween(SEEDED_ANCHOR_DATE, date)).toThrow(named);
    expect(() => projectedShiftType(PILOT_ROTATION_STEPS, smjenaA, date)).toThrow(RangeError);
    expect(() => projectedShiftType(PILOT_ROTATION_STEPS, smjenaA, date)).toThrow(named);
    expect(() => projectedShiftType(PILOT_ROTATION_STEPS, { ...smjenaA, anchorDate: date }, '2020-01-01')).toThrow(
      named,
    );
    expect(() => rotationAssignmentOn([smjenaA], date)).toThrow(named);
    expect(() => rotationAssignmentOn([{ ...smjenaA, effectiveFrom: date }], '2020-01-01')).toThrow(named);
    // An anchor on a version that is not the one selected is still checked.
    const later = { ...smjenaA, effectiveFrom: '2030-01-01', anchorDate: date };
    expect(() => rotationAssignmentOn([smjenaA, later], '2020-01-01')).toThrow(named);
    expect(() => projectedShiftTypeOn([smjenaA], PILOT_ROTATION_STEPS, date)).toThrow(named);
  });
});

describe('both fixtures', () => {
  it.each(FIXTURES)('binds every $fixture team once, to its one pattern, at a distinct offset step', ({ teams, steps, assignments, patternId }) => {
    expect(assignments.map((assignment) => assignment.teamId)).toEqual(teams.map((team) => team.id));
    expect(new Set(assignments.map((assignment) => assignment.patternId))).toEqual(new Set([patternId]));
    expect(new Set(steps.map((step) => step.patternId))).toEqual(new Set([patternId]));
    expect(new Set(assignments.map((assignment) => assignment.offsetStepId)).size).toBe(teams.length);
    expect(assignments.filter((assignment) => assignment.anchorDate !== SEEDED_ANCHOR_DATE)).toEqual([]);
    expect(assignments.filter((assignment) => assignment.effectiveFrom !== SEEDED_EFFECTIVE_FROM)).toEqual([]);
  });

  it.each(FIXTURES)('projects every $fixture team to one of its own shift types on every date of a cycle', ({ teams, types, steps, assignments }) => {
    const own = new Set(types.map((type) => type.id));
    for (const team of teams) {
      for (let days = 0; days < steps.length; days += 1) {
        const { date } = walk(SEEDED_ANCHOR_DATE, days, 0, 1);
        const projected = projectedShiftTypeOn([assignmentOf(assignments, team)], steps, date);
        expect(projected === null ? false : own.has(projected), `${team.id} on ${date}`).toBe(true);
      }
    }
  });

  it.each(FIXTURES)('gives each $fixture team its offset step on the anchor date', ({ teams, steps, assignments }) => {
    for (const team of teams) {
      const assignment = assignmentOf(assignments, team);
      const offset = steps.find((step) => step.id === assignment.offsetStepId);
      expect(projectedShiftType(steps, assignment, assignment.anchorDate)).toBe(offset?.shiftTypeId);
    }
  });
});

describe('projectedStepId (story 2.3b)', () => {
  it.each(FIXTURES)('names each $fixture team\'s offset step on the anchor, and the step whose type the projection returns on every date of a cycle', ({ teams, steps, assignments }) => {
    for (const team of teams) {
      const assignment = assignmentOf(assignments, team);
      expect(projectedStepId(steps, assignment, assignment.anchorDate)).toBe(assignment.offsetStepId);
      for (let days = -steps.length; days < 2 * steps.length; days += 1) {
        const { date } = walk(SEEDED_ANCHOR_DATE, days, 0, 1);
        const stepId = projectedStepId(steps, assignment, date);
        const step = steps.find((candidate) => candidate.id === stepId);
        expect(step?.shiftTypeId, `${team.id} on ${date}`).toBe(projectedShiftType(steps, assignment, date));
      }
    }
  });

  it.each(FIXTURES)('re-expresses a $fixture team against another anchor without changing any projected date', ({ teams, steps, assignments }) => {
    for (const team of teams) {
      const assignment = assignmentOf(assignments, team);
      for (const anchorDate of ['2019-12-30', '2026-09-26', '2031-02-28']) {
        const moved: RotationAssignment = {
          ...assignment,
          anchorDate,
          offsetStepId: projectedStepId(steps, assignment, anchorDate),
        };
        for (let days = -7; days < 14; days += 1) {
          const { date } = walk('2026-09-26', days, 0, 1);
          expect(projectedShiftType(steps, moved, date), `${team.id} from ${anchorDate} on ${date}`).toBe(
            projectedShiftType(steps, assignment, date),
          );
        }
      }
    }
  });

  it('tells two steps of one repeated type apart: the pilot\'s Smjena C and D both stand on Slobodno on the anchor', () => {
    const [, , c, d] = PILOT_TEAMS as readonly [FixtureTeam, FixtureTeam, FixtureTeam, FixtureTeam];
    expect(projectedStepId(PILOT_ROTATION_STEPS, assignmentOf(PILOT_ROTATION_ASSIGNMENTS, c), SEEDED_ANCHOR_DATE)).toBe('pilot-step-2');
    expect(projectedStepId(PILOT_ROTATION_STEPS, assignmentOf(PILOT_ROTATION_ASSIGNMENTS, d), SEEDED_ANCHOR_DATE)).toBe('pilot-step-3');
  });

  it('refuses what projectedShiftType refuses, with the same RangeError', () => {
    const smjenaA = assignmentOf(PILOT_ROTATION_ASSIGNMENTS, PILOT_TEAMS[0] as FixtureTeam);
    expect(() => projectedStepId([], smjenaA, '2020-01-01')).toThrow(/has no steps/);
    expect(() => projectedStepId(PILOT_ROTATION_STEPS, { ...smjenaA, offsetStepId: 'uj5-step-0' }, '2020-01-01')).toThrow(/uj5-step-0/);
    expect(() => projectedStepId(PILOT_ROTATION_STEPS, smjenaA, '2020-02-30')).toThrow(RangeError);
  });
});

describe('the projection invariant, over randomized patterns and dates (Q9)', () => {
  /** A random pattern of `cycleLength` steps: gapped positions, repeated types, shuffled. */
  function randomSteps(random: () => number, patternId: string, cycleLength: number): RotationStep[] {
    const pick = (below: number) => Math.floor(random() * below);
    const steps: RotationStep[] = [];
    let position = pick(3);
    for (let index = 0; index < cycleLength; index += 1) {
      steps.push({
        id: `${patternId}-step-${index}`,
        patternId,
        position,
        shiftTypeId: `type-${pick(Math.min(cycleLength, 5))}`,
      });
      position += 1 + pick(3);
    }
    return shuffled(steps, random);
  }

  it('equals a brute-force day walk from the anchor, for 1–30 steps across ±100 years', () => {
    const random = prng(20260925);
    const pick = (below: number) => Math.floor(random() * below);

    for (let run = 0; run < 300; run += 1) {
      const cycleLength = 1 + pick(30);
      const steps = randomSteps(random, 'random', cycleLength);
      const anchor = walk('2000-01-01', pick(2 * 36525) - 36525, 0, 1).date;
      const assignment: RotationAssignment = {
        teamId: 'random-team',
        patternId: 'random',
        offsetStepId: `random-step-${pick(cycleLength)}`,
        anchorDate: anchor,
        effectiveFrom: '0001-01-01',
      };

      // Mostly anywhere within a century either way; one run in eight within a
      // cycle of the anchor, where an off-by-one would show first.
      const days = random() < 0.125 ? pick(2 * cycleLength + 1) - cycleLength : pick(2 * 36525 + 1) - 36525;
      const walked = walkedShiftType(steps, assignment, days);
      const label = `run ${run}: ${cycleLength} steps, anchor ${anchor}, ${days} days to ${walked.date}`;

      expect(daysBetween(anchor, walked.date), label).toBe(days);
      expect(projectedShiftType(steps, assignment, walked.date), label).toBe(walked.shiftTypeId);
      expect(projectedStepId(steps, assignment, walked.date), label).toBe(walked.stepId);
      expect(projectedShiftTypeOn([assignment], steps, walked.date), label).toBe(walked.shiftTypeId);
    }
  });

  it('selects the version in effect and projects through its own pattern, over 2–4 randomized versions', () => {
    // The brute-force reference: the version is found by scanning every
    // version for the latest effectiveFrom on or before the date, compared as
    // day counts from the walk; the shift by walking from that version's
    // anchor. Neither shares code with `rotationAssignmentOn`.
    const random = prng(20261001);
    const pick = (below: number) => Math.floor(random() * below);

    for (let run = 0; run < 150; run += 1) {
      const count = 2 + pick(3);
      const origin = walk('2000-01-01', pick(2 * 18262) - 18262, 0, 1).date;
      // Strictly increasing starts, as day offsets from `origin`.
      const startDays: number[] = [];
      let day = 0;
      for (let index = 0; index < count; index += 1) {
        startDays.push(day);
        day += 1 + pick(400);
      }
      const steps: RotationStep[] = [];
      const versions: RotationAssignment[] = startDays.map((startDay, index) => {
        const patternId = `run${run}-pattern-${index}`;
        const cycleLength = 1 + pick(12);
        const own = randomSteps(random, patternId, cycleLength);
        steps.push(...own);
        return {
          teamId: 'random-team',
          patternId,
          offsetStepId: `${patternId}-step-${pick(cycleLength)}`,
          anchorDate: walk(origin, startDay + pick(2001) - 1000, 0, 1).date,
          effectiveFrom: walk(origin, startDay, 0, 1).date,
        };
      });
      const given = shuffled(versions, random);
      const shuffledSteps = shuffled(steps, random);

      // Around each switch (the day before, the day, the day after), a random
      // day inside each version, and days before the first one.
      const probes = new Set<number>([-1, -1 - pick(5000)]);
      for (const [index, startDay] of startDays.entries()) {
        probes.add(startDay - 1).add(startDay).add(startDay + 1);
        const next = startDays[index + 1] ?? startDay + 800;
        probes.add(startDay + pick(next - startDay));
      }

      for (const offset of probes) {
        const date = walk(origin, offset, 0, 1).date;
        let reference: RotationAssignment | null = null;
        let referenceStart = Number.NEGATIVE_INFINITY;
        for (const [index, version] of versions.entries()) {
          const startDay = startDays[index] as number;
          if (startDay <= offset && startDay > referenceStart) {
            reference = version;
            referenceStart = startDay;
          }
        }
        const label = `run ${run}, ${count} versions from ${origin}, on ${date} (day ${offset})`;

        if (reference === null) {
          expect(rotationAssignmentOn(given, date), label).toBeNull();
          expect(projectedShiftTypeOn(given, shuffledSteps, date), label).toBeNull();
          continue;
        }
        const own = steps.filter((step) => step.patternId === reference.patternId);
        const walked = walkedShiftType(own, reference, daysBetween(reference.anchorDate, date));
        expect(walked.date, `${label}: the walk and daysBetween disagree`).toBe(date);
        expect(rotationAssignmentOn(given, date), label).toBe(reference);
        expect(projectedShiftTypeOn(given, shuffledSteps, date), label).toBe(walked.shiftTypeId);
      }
    }
  });
});

describe('the projection reads nothing it must not', () => {
  it.each(['projection.ts', 'calendar.ts'])(
    'names no fire rank, no team position, no shift-type name and no Date in %s',
    (file) => {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
        .replaceAll(/\/\*[\s\S]*?\*\//g, '')
        .replaceAll(/\/\/[^\n]*/g, '');

      expect(source.length).toBeGreaterThan(0);
      expect(source).not.toMatch(/rank/i);
      expect(source).not.toMatch(/teamPosition|team_position|\.name\b/);
      expect(source).not.toMatch(/\bDate\b/);
    },
  );
});
