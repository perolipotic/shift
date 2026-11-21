/**
 * THE PARITY FIXTURE (story 16.2; AD-15, AD-19): both fixtures as the server
 * assembly carries them, plus every exception kind a member's projection
 * reads — a loan, a shift-type override in force and one pending review, a
 * roster override in force and one pending, a full-day and a half-day Leave
 * Record, a team move, a member on no team, and an inactive spell — dated on
 * or around both daylight-saving transitions of 2026 and 2027.
 *
 * PLAIN DATA, AND IT IMPORTS NOTHING, so the runtime-parity probe
 * (`probe.ts`) loads it unchanged under Node and under the pinned
 * `edge-runtime` (Deno 2.1.4), which cannot resolve this package's `src/`.
 * `test/parity-fixture.test.ts` types every entry as `ScheduleInputs` and
 * holds its teams, shift types, steps and rotation to `test/fixtures.ts`, so
 * it cannot drift from the fixtures every other rule is asserted against.
 *
 * A NEW RULE KIND THAT FEEDS DERIVATION is added here in the story that adds
 * it to the browser's read and to `private.member_schedule_inputs` (AD-19).
 */

const SEEDED = '2020-01-01';
/** When the seeded rotation versions were saved: 2020-01-01T00:00:00Z, in µs. */
const VERSIONS_SAVED = 1577836800000000;
/** After the versions: an override written then is IN FORCE. 2026-01-01T00:00:00Z, in µs. */
const IN_FORCE = 1767225600000000;
/** Before the versions: an override written then is PENDING review. 2017-07-14T02:40:00Z, in µs. */
const PENDING = 1500000000000000;

const at = (hours: number, minutes = 0): number => hours * 60 + minutes;

/** A roster override: either member may be absent (`null`), never both. */
const roster = (id: string, teamId: string, date: string, memberOutId: string | null, memberInId: string | null, writtenAt: number) => ({
  id,
  teamId,
  date,
  memberOutId,
  memberInId,
  writtenAt,
});

/** The token vector: a 43-character unpadded base64url token, canonical (its last character carries no stray bits). */
export const PARITY_VECTOR = 'shift-parity-vector_0123456789abcdefghijklA';

const PILOT = {
  organizationId: 'pilot-organization',
  timeZone: 'Europe/Zagreb',
  teams: [
    { id: 'pilot-smjena-a', name: 'Smjena A', archived: false },
    { id: 'pilot-smjena-b', name: 'Smjena B', archived: false },
    { id: 'pilot-smjena-c', name: 'Smjena C', archived: false },
    { id: 'pilot-smjena-d', name: 'Smjena D', archived: false },
  ],
  shiftTypes: [
    {
      type: { id: 'pilot-dan', name: 'Dan', isWorking: true },
      versions: [{ shiftTypeId: 'pilot-dan', effectiveFrom: SEEDED, startMinute: at(7), endMinute: at(19) }],
    },
    {
      type: { id: 'pilot-noc', name: 'Noć', isWorking: true },
      versions: [{ shiftTypeId: 'pilot-noc', effectiveFrom: SEEDED, startMinute: at(19), endMinute: at(7) }],
    },
    { type: { id: 'pilot-slobodno', name: 'Slobodno', isWorking: false }, versions: [] },
  ],
  steps: [
    { id: 'pilot-step-0', patternId: 'pilot-rotation', position: 0, shiftTypeId: 'pilot-dan' },
    { id: 'pilot-step-1', patternId: 'pilot-rotation', position: 1, shiftTypeId: 'pilot-noc' },
    { id: 'pilot-step-2', patternId: 'pilot-rotation', position: 2, shiftTypeId: 'pilot-slobodno' },
    { id: 'pilot-step-3', patternId: 'pilot-rotation', position: 3, shiftTypeId: 'pilot-slobodno' },
  ],
  assignments: ['a', 'b', 'c', 'd'].map((team, offset) => ({
    teamId: `pilot-smjena-${team}`,
    patternId: 'pilot-rotation',
    offsetStepId: `pilot-step-${String(offset)}`,
    anchorDate: SEEDED,
    effectiveFrom: SEEDED,
  })),
  assignmentStamps: ['a', 'b', 'c', 'd'].map((team) => ({
    teamId: `pilot-smjena-${team}`,
    effectiveFrom: SEEDED,
    createdAt: VERSIONS_SAVED,
  })),
  members: [
    {
      id: 'pilot-m1',
      memberships: [{ teamId: 'pilot-smjena-a', position: null, effectiveFrom: SEEDED }],
      statuses: [],
      // Lent to C across the spring transition.
      loans: [{ id: 'pilot-loan-1', teamId: 'pilot-smjena-c', from: '2026-03-28', to: '2026-03-30' }],
    },
    {
      id: 'pilot-m2',
      memberships: [{ teamId: 'pilot-smjena-b', position: null, effectiveFrom: SEEDED }],
      statuses: [],
      loans: [],
    },
    {
      id: 'pilot-m3',
      memberships: [{ teamId: 'pilot-smjena-c', position: null, effectiveFrom: SEEDED }],
      statuses: [{ active: false, effectiveFrom: '2026-06-01' }],
      loans: [],
    },
    {
      // On no team, and lent to D across the 2027 spring transition.
      id: 'pilot-m4',
      memberships: [],
      statuses: [],
      loans: [{ id: 'pilot-loan-2', teamId: 'pilot-smjena-d', from: '2027-03-27', to: '2027-03-29' }],
    },
    {
      id: 'pilot-m5',
      memberships: [
        { teamId: 'pilot-smjena-a', position: 'zapovjednik', effectiveFrom: SEEDED },
        { teamId: 'pilot-smjena-b', position: null, effectiveFrom: '2026-10-01' },
      ],
      statuses: [],
      loans: [],
    },
  ],
  overrides: [
    // A works Dan on the spring transition, where it was off: in force.
    { id: 'pilot-override-1', teamId: 'pilot-smjena-a', date: '2026-03-29', shiftTypeId: 'pilot-dan', writtenAt: IN_FORCE },
    // Pending review: D keeps its projected type.
    { id: 'pilot-override-2', teamId: 'pilot-smjena-d', date: '2027-10-31', shiftTypeId: 'pilot-noc', writtenAt: PENDING },
  ],
  rosterOverrides: [
    // m2 is put on A's night across the autumn transition: in force.
    roster('pilot-roster-1', 'pilot-smjena-a', '2026-10-25', null, 'pilot-m2', IN_FORCE),
    // m1 is taken off A's night: in force.
    roster('pilot-roster-2', 'pilot-smjena-a', '2027-10-24', 'pilot-m1', null, IN_FORCE),
    // Pending review: m5 stays on B's night.
    roster('pilot-roster-3', 'pilot-smjena-b', '2027-10-31', 'pilot-m5', null, PENDING),
  ],
};

const UJ5 = {
  organizationId: 'uj5-organization',
  timeZone: 'Europe/Zagreb',
  teams: [
    { id: 'uj5-smjena-a', name: 'Smjena A', archived: false },
    { id: 'uj5-smjena-b', name: 'Smjena B', archived: false },
    { id: 'uj5-smjena-c', name: 'Smjena C', archived: false },
  ],
  shiftTypes: [
    {
      type: { id: 'uj5-jutarnja', name: 'Jutarnja', isWorking: true },
      versions: [{ shiftTypeId: 'uj5-jutarnja', effectiveFrom: SEEDED, startMinute: at(6), endMinute: at(14) }],
    },
    {
      type: { id: 'uj5-popodnevna', name: 'Popodnevna', isWorking: true },
      versions: [{ shiftTypeId: 'uj5-popodnevna', effectiveFrom: SEEDED, startMinute: at(14), endMinute: at(22) }],
    },
    {
      type: { id: 'uj5-nocna', name: 'Noćna', isWorking: true },
      versions: [{ shiftTypeId: 'uj5-nocna', effectiveFrom: SEEDED, startMinute: at(22), endMinute: at(6) }],
    },
    { type: { id: 'uj5-slobodno', name: 'Slobodno', isWorking: false }, versions: [] },
  ],
  steps: [
    { id: 'uj5-step-0', patternId: 'uj5-rotation', position: 0, shiftTypeId: 'uj5-jutarnja' },
    { id: 'uj5-step-1', patternId: 'uj5-rotation', position: 1, shiftTypeId: 'uj5-popodnevna' },
    { id: 'uj5-step-2', patternId: 'uj5-rotation', position: 2, shiftTypeId: 'uj5-nocna' },
    { id: 'uj5-step-3', patternId: 'uj5-rotation', position: 3, shiftTypeId: 'uj5-slobodno' },
    { id: 'uj5-step-4', patternId: 'uj5-rotation', position: 4, shiftTypeId: 'uj5-slobodno' },
  ],
  assignments: ['a', 'b', 'c'].map((team, offset) => ({
    teamId: `uj5-smjena-${team}`,
    patternId: 'uj5-rotation',
    offsetStepId: `uj5-step-${String(offset)}`,
    anchorDate: SEEDED,
    effectiveFrom: SEEDED,
  })),
  assignmentStamps: ['a', 'b', 'c'].map((team) => ({
    teamId: `uj5-smjena-${team}`,
    effectiveFrom: SEEDED,
    createdAt: VERSIONS_SAVED,
  })),
  members: [
    {
      id: 'uj5-m1',
      memberships: [{ teamId: 'uj5-smjena-a', position: null, effectiveFrom: SEEDED }],
      statuses: [],
      loans: [],
    },
    {
      id: 'uj5-m2',
      memberships: [{ teamId: 'uj5-smjena-b', position: null, effectiveFrom: SEEDED }],
      statuses: [],
      // Lent to C across the autumn transition.
      loans: [{ id: 'uj5-loan-1', teamId: 'uj5-smjena-c', from: '2026-10-24', to: '2026-10-25' }],
    },
    {
      id: 'uj5-m3',
      memberships: [{ teamId: 'uj5-smjena-c', position: null, effectiveFrom: SEEDED }],
      statuses: [],
      loans: [],
    },
    {
      id: 'uj5-m4',
      memberships: [{ teamId: 'uj5-smjena-a', position: null, effectiveFrom: SEEDED }],
      statuses: [
        { active: false, effectiveFrom: '2027-01-01' },
        { active: true, effectiveFrom: '2027-06-01' },
      ],
      loans: [],
    },
  ],
  overrides: [
    // B works a night on the autumn transition, where it worked mornings: in force.
    { id: 'uj5-override-1', teamId: 'uj5-smjena-b', date: '2026-10-25', shiftTypeId: 'uj5-nocna', writtenAt: IN_FORCE },
  ],
  rosterOverrides: [
    // m1 replaces m3 on C's morning across the 2027 spring transition: in force.
    roster('uj5-roster-1', 'uj5-smjena-c', '2027-03-28', 'uj5-m3', 'uj5-m1', IN_FORCE),
    // Pending review: m3 stays on C's night.
    roster('uj5-roster-2', 'uj5-smjena-c', '2027-10-27', 'uj5-m3', null, PENDING),
  ],
};

/**
 * Each member's own live leave: a full-day record and a half day on a date
 * holding one working shift, around the transitions. A whole day carries no
 * `half` key, as the assembly writes it.
 */
const LEAVE: Readonly<Record<string, readonly { id: string; from: string; to: string; half?: 'FIRST' | 'SECOND'; absenceTypeId: string }[]>> = {
  'pilot-m1': [
    { id: 'pilot-leave-1', from: '2026-10-25', to: '2026-10-25', absenceTypeId: 'pilot-annual' },
    { id: 'pilot-leave-2', from: '2027-10-31', to: '2027-10-31', half: 'FIRST', absenceTypeId: 'pilot-annual' },
  ],
  'pilot-m2': [
    { id: 'pilot-leave-3', from: '2027-10-31', to: '2027-10-31', half: 'SECOND', absenceTypeId: 'pilot-sick' },
  ],
  'uj5-m1': [
    { id: 'uj5-leave-1', from: '2026-03-30', to: '2026-03-31', absenceTypeId: 'uj5-annual' },
    { id: 'uj5-leave-2', from: '2026-10-26', to: '2026-10-26', half: 'SECOND', absenceTypeId: 'uj5-annual' },
  ],
};

/** Both fixtures' hour bands, for the probe's hours; the assembly carries none (AD-19). */
const BANDS = {
  pilot: [
    { id: 'pilot-dan', name: 'Dan', startMinute: at(7) },
    { id: 'pilot-noc', name: 'Noć', startMinute: at(19) },
  ],
  uj5: [
    { id: 'uj5-jutro', name: 'Jutro', startMinute: at(5) },
    { id: 'uj5-popodne', name: 'Popodne', startMinute: at(13) },
    { id: 'uj5-noc', name: 'Noć', startMinute: at(21) },
  ],
};

/** The parity window: both transitions of both years, start dates both inclusive. */
export const PARITY_WINDOW = { from: '2026-03-01', to: '2027-10-31' };

/**
 * Every month of the window, which the probe projects in full (the schedule
 * and every member's hours), so the projection and hours, like R12, are
 * compared for every date of it. Four of them hold a transition.
 */
export const PARITY_MONTHS = Array.from({ length: 20 }, (_, index) => {
  const month = 2 + index; // 2026-03 is month index 2 of 2026
  return `${String(2026 + Math.floor(month / 12))}-${String((month % 12) + 1).padStart(2, '0')}`;
});

/**
 * Both fixtures: the organization-wide part of the assembly, each member's
 * own leave, and the bands. `inputsOf` makes one member's `ScheduleInputs`.
 */
export const PARITY_FIXTURES = [
  { fixture: 'pilot', organization: PILOT, bands: BANDS.pilot },
  { fixture: 'UJ-5', organization: UJ5, bands: BANDS.uj5 },
];

/** One member's assembly: the organization's part, the member, and that member's own leave alone. */
export function inputsOf<Organization extends object>(organization: Organization, memberId: string) {
  return { ...organization, memberId, leave: LEAVE[memberId] ?? [] };
}
