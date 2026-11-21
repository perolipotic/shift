/**
 * THE RUNTIME-PARITY PROBE (story 16.2; AD-7, AD-19 test 2): one JSON of
 * everything a server projection computes, over the parity fixture, for
 * both fixtures — R12 for every member over the parity window, the month
 * schedule and every member's hours of every month of that window, `zone.ts`'s
 * conversions and transitions, and a WebCrypto SHA-256 of the token vector.
 *
 * The same probe runs twice and the two answers must be byte-identical:
 * `test/runtime-parity.test.ts` runs it under Node over the built `dist`, and
 * CI's `runtime-parity` job runs it under the pinned `edge-runtime`
 * (`deploy/parity/index.ts`, which imports `@shift/domain` through its
 * `deno.json` map onto that same `dist`, as a function does), with no
 * network. That is the 2026-11-21 spike made permanent.
 *
 * IT IMPORTS NOTHING AT RUN TIME: the domain, the fixture and WebCrypto are
 * handed in, so the one file loads unchanged under both runtimes. The type
 * import below is erased; it names `src/` for the type checker only.
 */

import type * as Domain from '../src/index.js';
import type * as Fixtures from './fixtures.js';

/** The fixture module's shape, as both runtimes import it. */
type ParityFixtures = typeof Fixtures;

/** As much of WebCrypto's `SubtleCrypto` as the probe uses. */
export interface ParityDigest {
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}

/** Hex of a digest. */
function hexOf(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Local minutes probed on each transition date: midnight, the gap and the overlap, and a night shift's end. */
const PROBED_MINUTES = [0, 59, 60, 119, 120, 150, 179, 180, 1439, 1440 + 420];

/**
 * The probe's JSON, as one string. Throws whatever the domain throws: a
 * breached precondition is a failed probe on either runtime.
 */
export async function runtimeParityProbe(
  domain: typeof Domain,
  fixtures: ParityFixtures,
  subtle: ParityDigest,
): Promise<string> {
  const { PARITY_FIXTURES, PARITY_MONTHS, PARITY_WINDOW, PARITY_VECTOR, inputsOf } = fixtures;

  const organizations = PARITY_FIXTURES.map(({ fixture, organization, bands }) => {
    const working = organization.shiftTypes.filter((entry) => entry.type.isWorking).map((entry) => entry.type.id);
    const shared = {
      assignments: organization.assignments,
      steps: organization.steps,
      overrides: domain.overrideStandingOf(organization.assignmentStamps, organization.overrides).inForce,
      members: organization.members,
      rosterOverrides: domain.overrideStandingOf(organization.assignmentStamps, organization.rosterOverrides).inForce,
      workingShiftTypeIds: working,
    };

    const schedules = PARITY_MONTHS.map((month) => ({
      month,
      rows: domain.scheduleOfMonth({ ...shared, teamIds: organization.teams.map((team) => team.id) }, month),
    }));

    const members = organization.members.map((member) => {
      const inputs: Domain.ScheduleInputs = inputsOf(organization, member.id);
      const halfDays = inputs.leave.flatMap((record) => (record.half === undefined ? [] : [{ date: record.from, half: record.half }]));
      const hours = PARITY_MONTHS.map((month) => ({
        month,
        hours: domain.memberHoursOfMonth(
          {
            ...shared,
            memberId: member.id,
            memberships: member.memberships,
            statuses: member.statuses,
            loans: member.loans,
            bands,
            shiftTypes: organization.shiftTypes,
            halfDays,
          },
          month,
        ),
      }));
      return {
        memberId: member.id,
        atWork: domain.atWorkShiftsOf(inputs, PARITY_WINDOW.from, PARITY_WINDOW.to),
        hours,
      };
    });

    const transitions = domain.zoneTransitionsOf(organization.timeZone, PARITY_WINDOW.from, PARITY_WINDOW.to);
    return { fixture, schedules, members, transitions };
  });

  const zones = ['Europe/Zagreb', 'Australia/Sydney', 'UTC'].map((zone) => {
    const transitions = domain.zoneTransitionsOf(zone, '2026-01-01', '2027-12-31');
    const dates = ['2026-03-29', '2026-10-25', '2027-03-28', '2027-10-31', '2026-04-05', '2026-10-04'];
    return {
      zone,
      transitions: transitions.map((transition) => ({ ...transition, iso: domain.utcIsoOf(transition.instant) })),
      instants: dates.map((date) => ({
        date,
        minutes: PROBED_MINUTES.map((minute) => {
          const instant = domain.instantOf(date, minute, zone);
          return { minute, instant, iso: domain.utcIsoOf(instant), offset: domain.offsetMinutesAt(instant, zone) };
        }),
      })),
    };
  });

  const tokenHash = hexOf(await subtle.digest('SHA-256', new TextEncoder().encode(PARITY_VECTOR)));

  return JSON.stringify({ organizations, zones, token: { vector: PARITY_VECTOR, sha256: tokenHash } });
}
