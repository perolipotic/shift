import type { RotationAnswer } from '@/rotation/list';

/**
 * Both fixtures' rotation snapshots as PostgREST embeds them under the
 * organization (story 2.3b), for `@/rotation/*.test.ts`. The values are
 * `packages/domain/test/fixtures.ts`'s (2.3a's seed): the pilot's
 * `[Dan, Noć, Slobodno, Slobodno]` with Smjena A–D at offsets 0–3, and UJ-5's
 * `[Jutarnja, Popodnevna, Noćna, Slobodno, Slobodno]` with Smjena A–C at 0, 1
 * and 2, everything anchored and effective from 2020-01-01.
 *
 * Ids are opaque labels; nothing may branch on a name.
 */

export const ORGANIZATION = '00000000-0000-4000-8000-000000000001';
export const OTHER_ORGANIZATION = '00000000-0000-4000-8000-000000000002';
export const TODAY = '2026-09-26';
export const SEEDED = '2020-01-01';
/** The admin every fixture version is attributed to, unless a row says otherwise (story 2.6). */
export const ADMIN = '00000000-0000-4000-8000-0000000000a1';
export const ADMIN_NAME = 'Ivan Marić';
/** When the seeded versions were saved. */
export const SEEDED_AT = '2019-12-20T09:15:00+00:00';

type Row = Record<string, unknown>;

export interface FixtureRows {
  readonly teams: readonly Row[];
  readonly types: readonly Row[];
  readonly steps: readonly Row[];
  readonly assignments: readonly Row[];
  /** The members embed; the admin alone when a fixture names none. */
  readonly members?: readonly Row[];
}

export function memberRow(authUserId: string, name: string, organization = ORGANIZATION): Row {
  return { organization_id: organization, auth_user_id: authUserId, name };
}

export function teamRow(id: string, name: string, { archived = false, organization = ORGANIZATION } = {}): Row {
  return { organization_id: organization, id, name, archived };
}

/** A type with, for a working one, one version from `SEEDED` unless `times` is `null`. */
export function typeRow(
  id: string,
  name: string,
  createdAt: string,
  {
    working = true,
    archived = false,
    times = null as readonly [string, string] | null,
    organization = ORGANIZATION,
  } = {},
): Row {
  return {
    organization_id: organization,
    id,
    name,
    is_working: working,
    archived,
    created_at: createdAt,
    shift_type_versions:
      times === null
        ? []
        : [
            {
              organization_id: organization,
              shift_type_id: id,
              start_time: times[0],
              end_time: times[1],
              effective_from: SEEDED,
            },
          ],
  };
}

export function stepRow(
  id: string,
  patternId: string,
  position: number,
  shiftTypeId: string,
  organization = ORGANIZATION,
): Row {
  return { organization_id: organization, id, pattern_id: patternId, position, shift_type_id: shiftTypeId };
}

export function assignmentRow(
  teamId: string,
  patternId: string,
  offsetStepId: string,
  anchorDate: string,
  effectiveFrom: string,
  organization = ORGANIZATION,
  { createdBy = ADMIN, createdAt = SEEDED_AT }: { createdBy?: string; createdAt?: string } = {},
): Row {
  return {
    organization_id: organization,
    // One version per team per date, so the pair names the row.
    id: `assignment-${teamId}-${effectiveFrom}`,
    team_id: teamId,
    pattern_id: patternId,
    offset_step_id: offsetStepId,
    anchor_date: anchorDate,
    effective_from: effectiveFrom,
    created_by: createdBy,
    created_at: createdAt,
  };
}

export function organizationRow(rows: FixtureRows, timezone = 'Europe/Zagreb'): Row {
  return {
    id: ORGANIZATION,
    timezone,
    teams: rows.teams,
    shift_types: rows.types,
    rotation_steps: rows.steps,
    rotation_assignments: rows.assignments,
    members: rows.members ?? [memberRow(ADMIN, ADMIN_NAME)],
  };
}

export function answerOf(rows: FixtureRows, timezone = 'Europe/Zagreb'): RotationAnswer {
  return { data: [organizationRow(rows, timezone)], error: null, count: 1 };
}

const created = (index: number) => `2026-09-25T20:07:49.33${String(index)}741+00:00`;

export const PILOT: FixtureRows = {
  teams: ['a', 'b', 'c', 'd'].map((letter) => teamRow(`pilot-smjena-${letter}`, `Smjena ${letter.toUpperCase()}`)),
  types: [
    typeRow('pilot-dan', 'Dan', created(0), { times: ['07:00:00', '19:00:00'] }),
    typeRow('pilot-noc', 'Noć', created(1), { times: ['19:00:00', '07:00:00'] }),
    typeRow('pilot-slobodno', 'Slobodno', created(2), { working: false }),
  ],
  steps: ['pilot-dan', 'pilot-noc', 'pilot-slobodno', 'pilot-slobodno'].map((type, position) =>
    stepRow(`pilot-step-${String(position)}`, 'pilot-rotation', position, type),
  ),
  assignments: ['a', 'b', 'c', 'd'].map((letter, offset) =>
    assignmentRow(`pilot-smjena-${letter}`, 'pilot-rotation', `pilot-step-${String(offset)}`, SEEDED, SEEDED),
  ),
};

export const UJ5: FixtureRows = {
  teams: ['a', 'b', 'c'].map((letter) => teamRow(`uj5-smjena-${letter}`, `Smjena ${letter.toUpperCase()}`)),
  types: [
    typeRow('uj5-jutarnja', 'Jutarnja', created(0), { times: ['06:00:00', '14:00:00'] }),
    typeRow('uj5-popodnevna', 'Popodnevna', created(1), { times: ['14:00:00', '22:00:00'] }),
    typeRow('uj5-nocna', 'Noćna', created(2), { times: ['22:00:00', '06:00:00'] }),
    typeRow('uj5-slobodno', 'Slobodno', created(3), { working: false }),
  ],
  steps: ['uj5-jutarnja', 'uj5-popodnevna', 'uj5-nocna', 'uj5-slobodno', 'uj5-slobodno'].map(
    (type, position) => stepRow(`uj5-step-${String(position)}`, 'uj5-rotation', position, type),
  ),
  assignments: ['a', 'b', 'c'].map((letter, offset) =>
    assignmentRow(`uj5-smjena-${letter}`, 'uj5-rotation', `uj5-step-${String(offset)}`, SEEDED, SEEDED),
  ),
};
