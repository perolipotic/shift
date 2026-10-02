import { collisionKeyOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  NO_OPTION,
  OPTION_ACCEPT_UNCOVERED,
  RESOLUTION_LOADING,
  RESOLUTION_MISSING,
  RESOLUTION_READY,
  RESOLUTION_SAVED_STATE,
  RESOLUTION_UNAVAILABLE,
  coverageMessageKey,
  coworkersMessageKey,
  leaveHoursMessageKey,
  resolutionOptionOf,
  refetchingAfterFailure,
  resolutionSavedMessageKey,
  resolutionSavedOf,
  resolutionSavedStepOf,
  resolutionScreenOf,
  saveHintMessageKey,
  shiftFactsMessageKey,
  withResolutionSaved,
  withoutResolutionSaved,
  type ResolutionParams,
  type ResolutionScreen,
  type ResolutionSources,
  type ResolutionView,
} from '@/features/conflicts/services/resolution-screen';
import { initLocalization, t } from '@/lib/i18n';
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
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 5.4b's resolution screen, executed (AD-15): every service-level row
 * of the spec's matrix — Open, Ends, Strip and Missing — and the states and
 * the status line's router state, over the pilot fixture. The write's
 * refusals are `resolution-write.test.ts`'s.
 */

type Row = Record<string, unknown>;

/** Three colleagues on the viewer's team, so the team has four members. */
const ANTE = '00000000-0000-4000-8000-0000000000d1';
const FRANE = '00000000-0000-4000-8000-0000000000d2';
const KARLO = '00000000-0000-4000-8000-0000000000d3';

/** The 1st of September in the organization's zone: the 10th to the 14th are upcoming. */
const NOW = new Date('2026-09-01T08:00:00Z');

function teamOf(rows: FixtureRows, index: number): string {
  const id = rows.teams[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no team ${String(index)}`);

  return id;
}

const A = teamOf(PILOT, 0);

async function snapshotOf(usesFireRanks = false, rows: FixtureRows = PILOT): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          usesFireRanks,
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'admin' })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, A, SEEDED, undefined, 'driver'),
            memberMembershipRow(ANTE, A, SEEDED),
            memberMembershipRow(FRANE, A, SEEDED),
            memberMembershipRow(KARLO, A, SEEDED),
          ],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME, 'firefighter_1'),
      calendarMemberRow(ANTE, 'Ante Bilić'),
      calendarMemberRow(FRANE, 'Frane Lozić'),
      calendarMemberRow(KARLO, 'Karlo Jelić'),
    ]),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A row as `leave_records` answers it: the range canonical, its upper bound exclusive. */
function rowOf(id: string, from: string, toExclusive: string, memberId: string = VIEWER_MEMBER): Row {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}

/** The pilot's worked example: 10.09–14.09 over Dan, Noć, Slobodno, Slobodno, Dan — three conflicts. */
const WORKED = rowOf('record-worked', '2026-09-10', '2026-09-15');

function resolutionOf(memberId: string, date: string, teamId: string, kind = 'accept_uncovered'): Row {
  return { member_id: memberId, date, team_id: teamId, kind };
}

function settled(rows: readonly unknown[]) {
  return { data: rows, isError: false, isPending: false, fetchStatus: 'idle' };
}

const PENDING = { data: undefined, isError: false, isPending: true, fetchStatus: 'fetching' };

/** Allowance 19 and the leave year from 1 January: the worked example's 3 days leave 16. */
function sourcesOf(
  snapshot: CalendarSnapshot,
  rows: readonly Row[] = [WORKED],
  resolutionRows: readonly Row[] = [],
  overrides: Partial<ResolutionSources> = {},
): ResolutionSources {
  return {
    calendar: { snapshot, refusal: null, loading: false },
    records: settled(rows),
    resolutions: settled(resolutionRows),
    members: {
      members: snapshot.members.map((member) => ({ id: member.id, leaveAllowanceDays: 19 })),
      refusal: null,
      loading: false,
      paused: false,
    },
    organization: {
      data: { ok: true, snapshot: { leaveYearStartMonth: 1, leaveYearStartDay: 1 } },
      isPending: false,
      isError: false,
      fetchStatus: 'idle',
    },
    ...overrides,
  };
}

function paramsOn(date: string, memberId = VIEWER_MEMBER, teamId = A): ResolutionParams {
  return { memberId, date, teamId };
}

function viewOf(screen: ResolutionScreen): ResolutionView {
  if (screen.kind !== RESOLUTION_READY) throw new Error(screen.kind);

  return screen.view;
}

let pilot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Open and Ends: K od N, and ‹ › in the queue\'s order', () => {
  it('opens the 2nd of 3 as "2 od 3", both neighbours there', () => {
    const view = viewOf(resolutionScreenOf(sourcesOf(pilot), paramsOn('2026-09-11'), NOW));

    expect([view.position, view.count]).toEqual([2, 3]);
    expect(t('raspored.resolution.position', { position: view.position, count: view.count })).toBe(
      '2 od 3 · odluči što vrijedi za ovu smjenu.',
    );
    expect(view.previous).toEqual({ ...paramsOn('2026-09-10'), dayMonth: '10.09.' });
    expect(view.next).toEqual({ ...paramsOn('2026-09-14'), dayMonth: '14.09.' });
    expect(t('raspored.resolution.previous', { date: view.previous!.dayMonth })).toBe('Prethodni konflikt: 10.09.');
  });

  it('has no ‹ on the 1st and no › on the last', () => {
    const first = viewOf(resolutionScreenOf(sourcesOf(pilot), paramsOn('2026-09-10'), NOW));
    const last = viewOf(resolutionScreenOf(sourcesOf(pilot), paramsOn('2026-09-14'), NOW));

    expect([first.position, first.previous, first.next?.date]).toEqual([1, null, '2026-09-11']);
    expect([last.position, last.previous?.date, last.next]).toEqual([3, '2026-09-11', null]);
  });

  it('counts the queue without the resolved, and the way back says so', () => {
    const view = viewOf(
      resolutionScreenOf(sourcesOf(pilot, [WORKED], [resolutionOf(VIEWER_MEMBER, '2026-09-10', A)]), paramsOn('2026-09-11'), NOW),
    );

    expect([view.position, view.count, view.previous]).toEqual([1, 2, null]);
    expect(t('raspored.resolution.back', { count: view.count })).toBe('Raspored · 2 neriješena');
  });
});

describe('the facts', () => {
  it('names the shift, the team, the date, the absent member and their leave with its cost', () => {
    const view = viewOf(resolutionScreenOf(sourcesOf(pilot), paramsOn('2026-09-10'), NOW));

    expect(view.key).toBe(collisionKeyOf(paramsOn('2026-09-10')));
    expect(
      t(shiftFactsMessageKey(view.times), { type: view.shiftTypeName, times: view.times, team: view.teamName, date: view.dateShown }),
    ).toBe('Dan 07:00–19:00 · Smjena A · četvrtak 10.09.2026');
    expect(view.memberName).toBe(VIEWER_NAME);
    expect(t('raspored.resolution.leave', { from: view.leaveFrom, to: view.leaveTo, days: view.leaveCostDays })).toBe(
      'na godišnjem 10.09.2026–14.09.2026 · 3 dana',
    );
  });

  it('shows rank and position as information only, where the organization uses them', async () => {
    const plain = viewOf(resolutionScreenOf(sourcesOf(pilot), paramsOn('2026-09-10'), NOW));
    const ranked = await snapshotOf(true);
    const view = viewOf(resolutionScreenOf(sourcesOf(ranked), paramsOn('2026-09-10'), NOW));

    expect([plain.rankKey, plain.positionKey]).toEqual([null, null]);
    expect([view.rankKey, view.positionKey]).toEqual(['ljudi.rank.firefighter1', 'smjene.position.driver']);
  });

  it('lists who else works that day, leaving out everyone on leave', () => {
    const plain = viewOf(resolutionScreenOf(sourcesOf(pilot), paramsOn('2026-09-10'), NOW));
    const frane = viewOf(
      resolutionScreenOf(sourcesOf(pilot, [WORKED, rowOf('record-frane', '2026-09-10', '2026-09-11', FRANE)]), paramsOn('2026-09-10'), NOW),
    );

    expect(plain.coworkers).toEqual(['Ante Bilić', 'Frane Lozić', 'Karlo Jelić']);
    expect(t(coworkersMessageKey(plain.coworkers), { team: plain.teamName, names: 'x' })).toBe('Taj dan rade i (Smjena A): x.');
    expect(frane.coworkers).toEqual(['Ante Bilić', 'Karlo Jelić']);
    expect(coworkersMessageKey([])).toBe('raspored.resolution.noCoworkers');
  });
});

describe('Strip: coverage, the hours as leave and the balance', () => {
  it('reads "3 od 4 člana", "12 h kao godišnji" and "16 dana preostalo" for a team of four, a 12 h shift and a balance of 16', () => {
    const view = viewOf(resolutionScreenOf(sourcesOf(pilot), paramsOn('2026-09-10'), NOW));

    expect([view.covered, view.total]).toEqual([3, 4]);
    expect(t(coverageMessageKey(), { covered: view.covered, total: view.total })).toBe('3 od 4 člana');
    expect(view.leaveHours).not.toBeNull();
    expect(t(leaveHoursMessageKey(view.leaveHours), { hours: t(view.leaveHours!.key, view.leaveHours!.values) })).toBe(
      '12 h kao godišnji',
    );
    expect(view.balanceDays).toBe(16);
    expect(t('raspored.resolution.balance', { count: view.balanceDays })).toBe('16 dana preostalo');
  });

  it('counts out every member on leave that date, and says the plural forms', () => {
    const view = viewOf(
      resolutionScreenOf(sourcesOf(pilot, [WORKED, rowOf('record-ante', '2026-09-10', '2026-09-11', ANTE)]), paramsOn('2026-09-10'), NOW),
    );

    expect([view.covered, view.total]).toEqual([2, 4]);
    expect(t(coverageMessageKey(), { covered: 4, total: 5 })).toBe('4 od 5 članova');
    expect(t(coverageMessageKey(), { covered: 0, total: 1 })).toBe('0 od 1 člana');
    expect(t('raspored.resolution.balance', { count: 1 })).toBe('1 dan preostalo');
  });

  it('says the empty mark for an untimed shift', () => {
    expect(leaveHoursMessageKey(null)).toBe('raspored.resolution.noHours');
    expect(t(leaveHoursMessageKey(null))).toBe('—');
  });

  it('names what the queue\'s status line will say once the decision lands', () => {
    const view = viewOf(resolutionScreenOf(sourcesOf(pilot), paramsOn('2026-09-10'), NOW));

    expect(
      t('raspored.saved', {
        type: view.saved.shiftTypeName,
        team: view.saved.teamName,
        date: view.saved.dateShown,
        member: view.saved.memberName,
      }),
    ).toBe(`Odluka je spremljena: Dan · Smjena A · četvrtak 10.09.2026 · ${VIEWER_NAME}, prihvaćeno kao nepokriveno.`);
    expect(view.organizationId).toBe(pilot.organizationId);
  });
});

describe('Missing: a URL that names no open conflict', () => {
  it.each([
    ['a date with no conflict', paramsOn('2026-09-12')],
    ['a member who is not on leave', paramsOn('2026-09-10', ANTE)],
    ['another team', paramsOn('2026-09-10', VIEWER_MEMBER, teamOf(PILOT, 1))],
    ['params that are no ids at all', { memberId: 'x', date: 'not-a-date', teamId: 'y' }],
  ])('is missing for %s, with the queue\'s count', (_name, params) => {
    expect(resolutionScreenOf(sourcesOf(pilot), params, NOW)).toEqual({ kind: RESOLUTION_MISSING, count: 3 });
  });

  it('is missing once the conflict is resolved, or its leave removed', () => {
    expect(
      resolutionScreenOf(sourcesOf(pilot, [WORKED], [resolutionOf(VIEWER_MEMBER, '2026-09-10', A)]), paramsOn('2026-09-10'), NOW),
    ).toEqual({ kind: RESOLUTION_MISSING, count: 2 });
    expect(resolutionScreenOf(sourcesOf(pilot, []), paramsOn('2026-09-10'), NOW)).toEqual({ kind: RESOLUTION_MISSING, count: 0 });
  });
});

describe('the reads', () => {
  it('is loading while any of the queue\'s reads is pending, or the balance\'s', () => {
    expect(resolutionScreenOf(sourcesOf(pilot, [WORKED], [], { records: PENDING }), paramsOn('2026-09-10'), NOW)).toEqual({
      kind: RESOLUTION_LOADING,
    });
    expect(
      resolutionScreenOf(sourcesOf(pilot, [WORKED], [], { calendar: { snapshot: null, refusal: null, loading: true } }), paramsOn('2026-09-10'), NOW),
    ).toEqual({ kind: RESOLUTION_LOADING });
    expect(
      resolutionScreenOf(
        sourcesOf(pilot, [WORKED], [], { members: { members: null, refusal: null, loading: true, paused: false } }),
        paramsOn('2026-09-10'),
        NOW,
      ),
    ).toEqual({ kind: RESOLUTION_LOADING });
  });

  it('is missing without waiting for the balance\'s reads', () => {
    expect(
      resolutionScreenOf(
        sourcesOf(pilot, [WORKED], [], { members: { members: null, refusal: null, loading: true, paused: false } }),
        paramsOn('2026-09-12'),
        NOW,
      ),
    ).toEqual({ kind: RESOLUTION_MISSING, count: 3 });
  });

  it('is unavailable when a read failed or is paused, first', () => {
    for (const overrides of [
      { records: { data: undefined, isError: true, isPending: false, fetchStatus: 'idle' } },
      { resolutions: { data: [], isError: false, isPending: false, fetchStatus: 'paused' } },
      { calendar: { snapshot: null, refusal: 'unavailable' as never, loading: false } },
    ]) {
      expect(resolutionScreenOf(sourcesOf(pilot, [WORKED], [], overrides), paramsOn('2026-09-10'), NOW)).toEqual({
        kind: RESOLUTION_UNAVAILABLE,
      });
    }
  });

  it('is unavailable, logged, when a row cannot be trusted', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      resolutionScreenOf(sourcesOf(pilot, [WORKED], [resolutionOf(VIEWER_MEMBER, '2026-09-10', 'no-such-team')]), paramsOn('2026-09-10'), NOW),
    ).toEqual({ kind: RESOLUTION_UNAVAILABLE });
    expect(errors).toHaveBeenCalledWith(RESOLUTION_UNAVAILABLE, expect.any(RangeError));
  });

  it('is unavailable, logged, when the member is in no member list row: the balance cannot be had', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      resolutionScreenOf(
        sourcesOf(pilot, [WORKED], [], { members: { members: [], refusal: null, loading: false, paused: false } }),
        paramsOn('2026-09-10'),
        NOW,
      ),
    ).toEqual({ kind: RESOLUTION_UNAVAILABLE });
    expect(errors).toHaveBeenCalledWith(RESOLUTION_UNAVAILABLE, expect.any(RangeError));
  });
});

describe('the choice', () => {
  it('starts with nothing chosen, and admits the one outcome alone', () => {
    expect(resolutionOptionOf(NO_OPTION)).toBeNull();
    expect(resolutionOptionOf(OPTION_ACCEPT_UNCOVERED)).toBe(OPTION_ACCEPT_UNCOVERED);
    expect(resolutionOptionOf('replace-member')).toBeNull();
  });

  it('says why Spremi waits, and then what saving records', () => {
    expect(t(saveHintMessageKey(null))).toBe('Odaberi odluku.');
    expect(t(saveHintMessageKey(OPTION_ACCEPT_UNCOVERED))).toBe('Odluka se bilježi s tvojim imenom i vremenom.');
  });
});

describe('the status line travels in router state only', () => {
  const saved = {
    kind: 'accept_uncovered' as const,
    shiftTypeName: 'Dan',
    teamName: 'Smjena A',
    dateShown: 'četvrtak 10.09.2026',
    memberName: VIEWER_NAME,
  };

  it('is added beside the router\'s own keys, and read back with its outcome', () => {
    const state = withResolutionSaved({ __TSR_index: 3, key: 'k' }, saved);

    expect(state).toEqual({ __TSR_index: 3, key: 'k', [RESOLUTION_SAVED_STATE]: saved });
    expect(resolutionSavedOf(state)).toEqual(saved);
    expect(resolutionSavedMessageKey(saved.kind)).toBe('raspored.saved');
  });

  it('reads nothing from an entry without it, or a malformed one, an unknown outcome included', () => {
    for (const state of [
      undefined,
      null,
      {},
      { resolutionSaved: 'x' },
      { resolutionSaved: { ...saved, memberName: 3 } },
      { resolutionSaved: { ...saved, kind: 'replace_member' } },
      { resolutionSaved: { ...saved, kind: undefined } },
    ]) {
      expect(resolutionSavedOf(state)).toBeNull();
    }
  });

  it('is taken off the entry with every other key kept, so a reload finds none', () => {
    const cleared = withoutResolutionSaved(withResolutionSaved({ __TSR_index: 3 }, saved));

    expect(cleared).toEqual({ __TSR_index: 3 });
    expect(resolutionSavedOf(cleared)).toBeNull();
    expect(withoutResolutionSaved(null)).toEqual({});
  });

  it('is shown and cleared on the location that brings it, kept over its own clearing, and dropped by any other', () => {
    const arriving = withResolutionSaved({ __TSR_index: 3 }, saved);
    const first = resolutionSavedStepOf(null, arriving, false);

    expect(first).toEqual({ shown: saved, clear: true, clearing: true });
    // The router's replace lands: the line stays, nothing more is cleared.
    const second = resolutionSavedStepOf(first.shown, { __TSR_index: 3 }, first.clearing);

    expect(second).toEqual({ shown: saved, clear: false, clearing: false });
    // The Raspored tab, a same-route navigation: the line is gone.
    expect(resolutionSavedStepOf(second.shown, { __TSR_index: 4 }, second.clearing)).toEqual({
      shown: null,
      clear: false,
      clearing: false,
    });
    expect(resolutionSavedStepOf(null, {}, false)).toEqual({ shown: null, clear: false, clearing: false });
  });
});

describe('the patch round', () => {
  it('says the empty mark for an untimed conflict: a working type with no times on the date', async () => {
    const untimed: FixtureRows = {
      ...PILOT,
      types: PILOT.types.map((type) => (type['id'] === 'pilot-dan' ? { ...type, shift_type_versions: [] } : type)),
    };
    const snapshot = await snapshotOf(false, untimed);
    const view = viewOf(resolutionScreenOf(sourcesOf(snapshot), paramsOn('2026-09-10'), NOW));

    expect(view.times).toBeNull();
    expect(view.leaveHours).toBeNull();
    expect(t(leaveHoursMessageKey(view.leaveHours))).toBe('—');
    expect(t(shiftFactsMessageKey(view.times), { type: view.shiftTypeName, team: view.teamName, date: view.dateShown })).toBe(
      'Dan · Smjena A · četvrtak 10.09.2026',
    );
  });

  it('counts the coverage from the same list it names', () => {
    const view = viewOf(
      resolutionScreenOf(sourcesOf(pilot, [WORKED, rowOf('record-karlo', '2026-09-10', '2026-09-11', KARLO)]), paramsOn('2026-09-10'), NOW),
    );

    expect(view.covered).toBe(view.coworkers.length);
    expect(view.coworkers).toEqual(['Ante Bilić', 'Frane Lozić']);
  });

  it('is unavailable with a retry, not a skeleton, when the member list or the organization read failed or is paused', () => {
    for (const overrides of [
      { members: { members: null, refusal: 'MEMBERS_UNAVAILABLE', loading: false, paused: false } },
      { members: { members: null, refusal: null, loading: true, paused: true } },
      { organization: { data: undefined, isPending: false, isError: true, fetchStatus: 'idle' } },
      { organization: { data: undefined, isPending: true, isError: false, fetchStatus: 'paused' } },
    ]) {
      expect(resolutionScreenOf(sourcesOf(pilot, [WORKED], [], overrides), paramsOn('2026-09-10'), NOW)).toEqual({
        kind: RESOLUTION_UNAVAILABLE,
      });
    }
  });

  it('is loading while a failed read is read again, and only then', () => {
    expect(refetchingAfterFailure([{ isError: true, fetchStatus: 'fetching' }, { isError: false, fetchStatus: 'idle' }])).toBe(true);
    expect(refetchingAfterFailure([{ isError: true, fetchStatus: 'idle' }, { isError: false, fetchStatus: 'fetching' }])).toBe(false);
    expect(
      resolutionScreenOf(
        sourcesOf(pilot, [WORKED], [], {
          records: { data: undefined, isError: true, isPending: false, fetchStatus: 'fetching' },
          refetching: true,
        }),
        paramsOn('2026-09-10'),
        NOW,
      ),
    ).toEqual({ kind: RESOLUTION_LOADING });
  });

  it('states the balance of the leave year that holds the conflict, not today\'s', () => {
    // Read on 1 January 2027, the worked example's 3 days are last year's: today's balance would be 19.
    const view = viewOf(resolutionScreenOf(sourcesOf(pilot), paramsOn('2026-09-10'), new Date('2027-01-01T08:00:00Z')));

    expect(view.balanceDays).toBe(16);
  });
});
