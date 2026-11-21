import { describe, expect, it } from 'vitest';

import type { ScheduleInputs } from '../src/index.js';
import { PARITY_FIXTURES, PARITY_MONTHS, PARITY_WINDOW, PARITY_VECTOR, inputsOf } from '../parity/fixtures.js';
import {
  PILOT_ROTATION_ASSIGNMENTS,
  PILOT_ROTATION_STEPS,
  PILOT_SHIFT_TYPE_VERSIONS,
  PILOT_SHIFT_TYPES,
  PILOT_TEAMS,
  UJ5_ROTATION_ASSIGNMENTS,
  UJ5_ROTATION_STEPS,
  UJ5_SHIFT_TYPE_VERSIONS,
  UJ5_SHIFT_TYPES,
  UJ5_TEAMS,
} from './fixtures.js';

/**
 * The parity fixture (story 16.2) imports nothing, so it is held here to the
 * fixtures every other rule is asserted against (AD-15), and typed as the
 * assembly it stands for.
 */

const [pilot, uj5] = PARITY_FIXTURES;
if (pilot === undefined || uj5 === undefined) throw new Error('the parity fixture lost a fixture');

describe('the parity fixture', () => {
  it('is an assembly for every member of both fixtures', () => {
    for (const { organization } of PARITY_FIXTURES) {
      for (const member of organization.members) {
        const inputs: ScheduleInputs = inputsOf(organization, member.id);
        expect(inputs.memberId).toBe(member.id);
      }
    }
  });

  it('holds the pilot\'s configuration exactly', () => {
    expect(pilot.organization.teams.map(({ id, name }) => ({ id, name }))).toEqual(PILOT_TEAMS);
    expect(pilot.organization.shiftTypes.map((entry) => entry.type)).toEqual(PILOT_SHIFT_TYPES);
    expect(pilot.organization.shiftTypes.flatMap((entry) => entry.versions)).toEqual(PILOT_SHIFT_TYPE_VERSIONS);
    expect(pilot.organization.steps).toEqual(PILOT_ROTATION_STEPS);
    expect(pilot.organization.assignments).toEqual(PILOT_ROTATION_ASSIGNMENTS);
  });

  it('holds UJ-5\'s configuration exactly', () => {
    expect(uj5.organization.teams.map(({ id, name }) => ({ id, name }))).toEqual(UJ5_TEAMS);
    expect(uj5.organization.shiftTypes.map((entry) => entry.type)).toEqual(UJ5_SHIFT_TYPES);
    expect(uj5.organization.shiftTypes.flatMap((entry) => entry.versions)).toEqual(UJ5_SHIFT_TYPE_VERSIONS);
    expect(uj5.organization.steps).toEqual(UJ5_ROTATION_STEPS);
    expect(uj5.organization.assignments).toEqual(UJ5_ROTATION_ASSIGNMENTS);
  });

  it('puts every exception kind into the scene (AD-19)', () => {
    const all = PARITY_FIXTURES.map((fixture) => fixture.organization);
    const leave = all.flatMap((organization) => organization.members.flatMap((member) => inputsOf(organization, member.id).leave));

    expect(all.flatMap((organization) => organization.members.flatMap((member) => member.loans)).length).toBeGreaterThan(0);
    expect(all.flatMap((organization) => organization.overrides).length).toBeGreaterThan(0);
    expect(all.flatMap((organization) => organization.rosterOverrides).length).toBeGreaterThan(0);
    expect(leave.some((record) => record.half === undefined)).toBe(true);
    expect(leave.some((record) => record.half !== undefined)).toBe(true);
  });

  it('spans both transitions of both years', () => {
    expect(PARITY_WINDOW.from <= '2026-03-29' && PARITY_WINDOW.to >= '2027-10-31').toBe(true);
    // Every month of the window, so the schedule and the hours cover every date of it.
    expect(PARITY_MONTHS).toHaveLength(20);
    expect(PARITY_MONTHS[0]).toBe(PARITY_WINDOW.from.slice(0, 7));
    expect(PARITY_MONTHS.at(-1)).toBe(PARITY_WINDOW.to.slice(0, 7));
    expect(PARITY_MONTHS).toEqual(expect.arrayContaining(['2026-03', '2026-10', '2026-12', '2027-01', '2027-03', '2027-10']));
    expect(new Set(PARITY_MONTHS).size).toBe(20);
  });

  it('holds a canonical 43-character token as its vector', () => {
    expect(PARITY_VECTOR).toMatch(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
  });
});
