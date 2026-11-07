import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';
import { DECISIONS_EMBED } from '@/features/swaps/services/organization-swaps';

/**
 * STORY 12.4: the admin's swaps over the pilot, shared by the node suites of
 * the organization's swap read, the decision screen, the queue, *Odlučeno*,
 * the resolution screen's back link and the admin's *Danas*.
 *
 * The rotation is Dan, Noć, Slobodno, Slobodno, and Smjena B runs one step
 * ahead of A: A works Dan on 2026-09-10 and 2026-09-14 (the viewer, an admin,
 * and Karlo on it), B works Noć on 2026-09-10 and Dan on 2026-09-13 (Ana,
 * Dino, Eva and Ivo). C (Luka, Mara) is off on 2026-09-10.
 */

type Row = Record<string, unknown>;

export const ANA = '00000000-0000-4000-8000-0000000000e1';
export const DINO = '00000000-0000-4000-8000-0000000000e2';
export const EVA = '00000000-0000-4000-8000-0000000000e3';
export const IVO = '00000000-0000-4000-8000-0000000000e4';
export const KARLO = '00000000-0000-4000-8000-0000000000e5';
export const LUKA = '00000000-0000-4000-8000-0000000000e6';
export const MARA = '00000000-0000-4000-8000-0000000000e7';

/** The admin's auth user, as `decided_by` names them. */
export const DECIDING_ADMIN = '00000000-0000-4000-8000-0000000000a9';

function teamIdOf(index: number): string {
  const id = PILOT.teams[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no team ${String(index)}`);

  return id;
}

export const TEAM_A = teamIdOf(0);
export const TEAM_B = teamIdOf(1);
export const TEAM_C = teamIdOf(2);

/**
 * The calendar snapshot an admin (the viewer, on A) reads, with
 * `rosterOverrides`, shift-type `overrides` and *Najmanje ljudi u smjeni*
 * (`minimumMembers`, unset unless named).
 */
export async function adminSwapSnapshotOf(
  {
    rosterOverrides = [],
    overrides = [],
    minimumMembers = undefined as number | undefined,
  }: { readonly rosterOverrides?: readonly Row[]; readonly overrides?: readonly Row[]; readonly minimumMembers?: number } = {},
): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(TEAM_A, SEEDED)], { role: 'admin' })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, TEAM_A, SEEDED),
            memberMembershipRow(KARLO, TEAM_A, SEEDED),
            memberMembershipRow(ANA, TEAM_B, SEEDED),
            memberMembershipRow(DINO, TEAM_B, SEEDED),
            memberMembershipRow(EVA, TEAM_B, SEEDED),
            memberMembershipRow(IVO, TEAM_B, SEEDED),
            memberMembershipRow(LUKA, TEAM_C, SEEDED),
            memberMembershipRow(MARA, TEAM_C, SEEDED),
          ],
          statuses: [],
          minimumMembers,
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(ANA, 'Ana Babić'),
      calendarMemberRow(DINO, 'Dino Grgić'),
      calendarMemberRow(EVA, 'Eva Šarić'),
      calendarMemberRow(IVO, 'Ivo Horvat'),
      calendarMemberRow(KARLO, 'Karlo Jelić'),
      calendarMemberRow(LUKA, 'Luka Perić'),
      calendarMemberRow(MARA, 'Mara Kovač'),
    ]),
    overridesAnswerOf(overrides),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** When a swap was sent, unless a row says otherwise. */
export const SENT_AT = '2026-09-05T08:00:00+00:00';
/** When a swap was closed, and decided, unless a row says otherwise. */
export const CLOSED_AT = '2026-09-07T10:00:00+00:00';

/**
 * One swap row as the organization's read answers it: Ivo gives B's Dan on
 * 2026-09-13 to Karlo (off that day), open and accepted unless told otherwise.
 */
export function swapRowOf(overrides: Row = {}): Row {
  return {
    id: 'swap-1',
    proposer_id: IVO,
    addressee_id: KARLO,
    team_id: TEAM_B,
    date: '2026-09-13',
    return_team_id: null,
    return_date: null,
    answer: 'accepted',
    closed_at: null,
    created_at: SENT_AT,
    [DECISIONS_EMBED]: [],
    ...overrides,
  };
}

/** A decision as the read embeds it: by {@link DECIDING_ADMIN} at {@link CLOSED_AT} unless told otherwise. */
export function swapDecisionRowOf(outcome: string, overrides: Row = {}): Row {
  return {
    outcome,
    roster_override_id: outcome === 'approved' ? 'ro-given' : null,
    return_roster_override_id: null,
    decided_by: DECIDING_ADMIN,
    decided_at: CLOSED_AT,
    ...overrides,
  };
}

/** A decided swap's row: closed, accepted, and the decision embedded. */
export function decidedSwapRowOf(outcome: string, overrides: Row = {}, decision: Row = {}): Row {
  return swapRowOf({
    closed_at: CLOSED_AT,
    [DECISIONS_EMBED]: [swapDecisionRowOf(outcome, decision)],
    ...overrides,
  });
}
