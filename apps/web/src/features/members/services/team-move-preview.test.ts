import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  MOVE_FIRST,
  MOVE_LAST,
  moveShiftMessageKey,
  moveShiftValuesOf,
  shownTeamMovePreviewOf,
  teamMovePreviewOf,
  type MoveShift,
} from '@/features/members/services/team-move-preview';
import { NO_TEAM_VALUE, TEAM_MOVE, TEAM_UNPICKED_VALUE, type TeamMoveOffer } from '@/features/members/services/write';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';

/**
 * Decision 16's *Što se mijenja* in the team dialog, executed (AD-15) over
 * the pilot fixture — `[Dan, Noć, Slobodno, Slobodno]` from 2020-01-01:
 * Smjena A works Dan on 10.09.2026 and every fourth day after (…, 30.09.,
 * 04.10., 08.10., …) and Noć the day after each (…, 01.10., 05.10., …);
 * Smjena B works Dan on 13.09.2026 and every fourth day after (…, 29.09.,
 * 03.10., 07.10., …) and Noć the day after each (…, 30.09., 04.10., …).
 * Zoran is on Smjena B; the viewer on Smjena A.
 */

const ZORAN = '00000000-0000-4000-8000-0000000000d1';
const A = 'pilot-smjena-a';
const B = 'pilot-smjena-b';
const TODAY = '2026-10-01';

type Row = Record<string, unknown>;

async function snapshotOf(
  { rosterOverrides = [], versions = [] }: { readonly rosterOverrides?: readonly Row[]; readonly versions?: readonly Row[] } = {},
): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, A, SEEDED), memberMembershipRow(ZORAN, B, SEEDED), ...versions],
          statuses: [],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(ZORAN, 'Zoran Zorić')]),
    overridesAnswerOf([]),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

const NIGHT = '19:00–07:00';
const DAY = '07:00–19:00';

let plain: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await snapshotOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The dialog's two lines, exactly as it words them. */
function linesOf(snapshot: CalendarSnapshot, teamId: string | null, day: string): readonly string[] | null {
  const preview = teamMovePreviewOf(snapshot, ZORAN, teamId, day, TODAY);

  if (preview === null) return null;

  const line = (side: typeof MOVE_LAST | typeof MOVE_FIRST, shift: MoveShift | null) =>
    shift === null ? [] : [t(moveShiftMessageKey(side, shift), moveShiftValuesOf(shift))];

  return [...line(MOVE_LAST, preview.last), ...line(MOVE_FIRST, preview.first)];
}

describe('what a move across teams changes', () => {
  it('Happy: the last shift in the team left, before the day, and the first in the team joined, from it', () => {
    expect(teamMovePreviewOf(plain, ZORAN, A, '2026-10-05', TODAY)).toEqual({
      last: { team: 'Smjena B', date: '2026-10-04', type: 'Noć', range: NIGHT },
      first: { team: 'Smjena A', date: '2026-10-05', type: 'Noć', range: NIGHT },
    });
    expect(linesOf(plain, A, '2026-10-05')).toEqual([
      'Zadnja u Smjena B · ned 04.10. · Noć · 19:00–07:00',
      'Prva u Smjena A · pon 05.10. · Noć · 19:00–07:00',
    ]);
  });

  it('counts the day itself for the team joined, and never for the team left', () => {
    // From 07.10., a Dan of B and a Slobodno of A: B's last is Noć 04.10., A's first Dan 08.10.
    expect(teamMovePreviewOf(plain, ZORAN, A, '2026-10-07', TODAY)).toEqual({
      last: { team: 'Smjena B', date: '2026-10-04', type: 'Noć', range: NIGHT },
      first: { team: 'Smjena A', date: '2026-10-08', type: 'Dan', range: DAY },
    });
  });

  it('crosses a month either way', () => {
    // From 01.11.: the day itself is never the left team's, so B's last is
    // Dan 31.10. in October; A's first is Dan 01.11.
    const preview = teamMovePreviewOf(plain, ZORAN, A, '2026-11-01', TODAY);

    expect(preview?.last?.date).toBe('2026-10-31');
    expect(preview?.first?.date).toBe('2026-11-01');
  });

  it('No team: a move onto no team has only the last shift', () => {
    expect(teamMovePreviewOf(plain, ZORAN, null, '2026-10-05', TODAY)).toEqual({
      last: { team: 'Smjena B', date: '2026-10-04', type: 'Noć', range: NIGHT },
      first: null,
    });
    expect(linesOf(plain, null, '2026-10-05')).toEqual(['Zadnja u Smjena B · ned 04.10. · Noć · 19:00–07:00']);
  });

  it('From no team: a member on no team has only the first shift', async () => {
    // Off Smjena B since 20.09., before today: nothing is scheduled.
    const snapshot = await snapshotOf({ versions: [memberMembershipRow(ZORAN, null, '2026-09-20')] });

    expect(teamMovePreviewOf(snapshot, ZORAN, A, '2026-10-05', TODAY)).toEqual({
      last: null,
      first: { team: 'Smjena A', date: '2026-10-05', type: 'Noć', range: NIGHT },
    });
  });

  it('Moved off by override: a shift the member was taken off is not their last; one put on elsewhere is not either', async () => {
    const snapshot = await snapshotOf({
      rosterOverrides: [
        // Taken off Smjena B's Noć 04.10.: the last is Dan 03.10.
        calendarRosterOverrideRow('roster-off', B, '2026-10-04', ZORAN, null),
      ],
    });

    expect(teamMovePreviewOf(snapshot, ZORAN, A, '2026-10-05', TODAY)?.last).toEqual({
      team: 'Smjena B',
      date: '2026-10-03',
      type: 'Dan',
      range: DAY,
    });
  });
});

describe('no preview: the dialog shows none', () => {
  it('the same team is a position-only change', () => {
    expect(teamMovePreviewOf(plain, ZORAN, B, '2026-10-05', TODAY)).toBeNull();
  });

  it('a change the guard refuses, a missing member and no snapshot', async () => {
    // A version already dated the day: the write would be refused anyway.
    const taken = await snapshotOf({ versions: [memberMembershipRow(ZORAN, B, '2026-10-05')] });

    expect(teamMovePreviewOf(taken, ZORAN, A, '2026-10-05', TODAY)).toBeNull();
    expect(teamMovePreviewOf(plain, 'nobody', A, '2026-10-05', TODAY)).toBeNull();
    expect(teamMovePreviewOf(null, ZORAN, A, '2026-10-05', TODAY)).toBeNull();
  });

  it('a domain fault is logged and never rethrown', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(teamMovePreviewOf(plain, ZORAN, A, 'not-a-date', TODAY)).toBeNull();
    expect(logged).toHaveBeenCalled();
  });
});

describe('the preview the dialog shows', () => {
  const offer: TeamMoveOffer = {
    change: TEAM_MOVE,
    state: { team: { id: B, name: 'Smjena B' }, scheduled: null },
    today: TODAY,
    choices: [{ id: A, name: 'Smjena A' }],
    offersNoTeam: true,
    positions: false,
    current: { id: B, name: 'Smjena B' },
    currentPosition: null,
    minimum: TODAY,
  };

  it('only once a team or no team is picked, on a valid date from the minimum, with today known', () => {
    expect(shownTeamMovePreviewOf(plain, ZORAN, offer, A, '2026-10-05', TODAY)?.first?.team).toBe('Smjena A');
    expect(shownTeamMovePreviewOf(plain, ZORAN, offer, NO_TEAM_VALUE, '2026-10-05', TODAY)?.first).toBeNull();
    expect(shownTeamMovePreviewOf(plain, ZORAN, offer, TEAM_UNPICKED_VALUE, '2026-10-05', TODAY)).toBeNull();
    expect(shownTeamMovePreviewOf(plain, ZORAN, offer, 'stale-team', '2026-10-05', TODAY)).toBeNull();
    expect(shownTeamMovePreviewOf(plain, ZORAN, offer, A, '2026-09-30', TODAY)).toBeNull();
    expect(shownTeamMovePreviewOf(plain, ZORAN, offer, A, '', TODAY)).toBeNull();
    expect(shownTeamMovePreviewOf(plain, ZORAN, offer, A, '2026-10-05', null)).toBeNull();
    expect(shownTeamMovePreviewOf(plain, ZORAN, null, A, '2026-10-05', TODAY)).toBeNull();
  });

  it('words a type with no times without a range', () => {
    const shift: MoveShift = { team: 'Smjena A', date: '2026-10-05', type: 'Dežurstvo', range: null };

    expect(t(moveShiftMessageKey(MOVE_FIRST, shift), moveShiftValuesOf(shift))).toBe(
      'Prva u Smjena A · pon 05.10. · Dežurstvo',
    );
    expect(t(moveShiftMessageKey(MOVE_LAST, shift), moveShiftValuesOf(shift))).toBe(
      'Zadnja u Smjena A · pon 05.10. · Dežurstvo',
    );
  });
});
