import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ROSTER_TAKEN } from '@/features/calendar/services/roster-erasures';
import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { DAY_WORKING, dayDetailOf, swapOfferedOf, swapProposalMarkOf, type DayDetail } from '@/features/calendar/utils/day-detail';
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
  statusRow,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';
import {
  SWAP_BLOCKED,
  SWAP_COLLEAGUE_GONE,
  SWAP_DENIED,
  SWAP_DUPLICATE,
  SWAP_FAILED,
  SWAP_GIVEN_GONE,
  SWAP_INVALID,
  SWAP_NO_CHOICE,
  SWAP_NO_COLLEAGUE,
  SWAP_NO_COLLEAGUE_CHOSEN,
  SWAP_NO_RETURN,
  SWAP_PREVIEW_BLOCKED,
  SWAP_PREVIEW_READY,
  SWAP_PROPOSED_STATE,
  SWAP_RETURN_GONE,
  SWAP_VIEW_ADMIN,
  SWAP_VIEW_LOADING,
  SWAP_VIEW_MEMBER,
  SWAP_VIEW_UNAVAILABLE,
  ownSwapShiftOf,
  sendSwapProposal,
  swapChoiceOf,
  swapChoiceOnColleague,
  swapColleaguesOf,
  swapLeaveKeysOf,
  swapLeaveRecordsOf,
  SWAP_LEAVE_RECORDS_UNREAD,
  swapMonthOf,
  swapPreviewOf,
  swapProposedOf,
  swapProposedStepOf,
  swapProposedValuesOf,
  swapReturnOptionsOf,
  swapReturnShiftOf,
  swapReturnValueOf,
  swapSearchOf,
  swapSendCheckOf,
  swapSendFailureOf,
  swapSendMessageKey,
  type SwapCheckRefusal,
  type SwapSendFailure,
  swapViewOf,
  withSwapProposed,
  withoutSwapProposed,
  type SwapRequestInsertTable,
} from '@/features/swaps/services/swap-proposal';
import { initLocalization } from '@/lib/i18n';

/**
 * Story 12.2's rules, executed (AD-15): the spec's I/O matrix over the pilot.
 * The rotation is Dan, Noć, Slobodno, Slobodno, and Smjena B runs one step
 * ahead of A. On 2026-09-10 A works Dan (the viewer and Karlo on it) and B
 * works Noć (Ana, Dino, Eva and Ivo); C (Luka, Mara) is off. B works Dan on
 * 2026-09-13 and 2026-10-03.
 */

type Row = Record<string, unknown>;

const DATE = '2026-09-10';
const TODAY = '2026-09-08';
const TWELVE_HOURS = 12 * 60;

const ANA = '00000000-0000-4000-8000-0000000000e1';
const DINO = '00000000-0000-4000-8000-0000000000e2';
const EVA = '00000000-0000-4000-8000-0000000000e3';
const IVO = '00000000-0000-4000-8000-0000000000e4';
const KARLO = '00000000-0000-4000-8000-0000000000e5';
const LUKA = '00000000-0000-4000-8000-0000000000e6';
const MARA = '00000000-0000-4000-8000-0000000000e7';

function idOf(rows: readonly Row[], index: number): string {
  const id = rows[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no row ${String(index)}`);

  return id;
}

const A = idOf(PILOT.teams, 0);
const B = idOf(PILOT.teams, 1);
const C = idOf(PILOT.teams, 2);

async function snapshotOf(
  {
    role = 'member_role',
    rosterOverrides = [],
    statuses = [],
  }: { readonly role?: string; readonly rosterOverrides?: readonly Row[]; readonly statuses?: readonly Row[] } = {},
): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, A, SEEDED),
            memberMembershipRow(KARLO, A, SEEDED),
            memberMembershipRow(ANA, B, SEEDED),
            memberMembershipRow(DINO, B, SEEDED),
            memberMembershipRow(EVA, B, SEEDED),
            memberMembershipRow(IVO, B, SEEDED),
            memberMembershipRow(LUKA, C, SEEDED),
            memberMembershipRow(MARA, C, SEEDED),
          ],
          statuses,
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
    overridesAnswerOf([]),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

function dayOf(snapshot: CalendarSnapshot, teamId: string, date = DATE): DayDetail {
  const detail = dayDetailOf(snapshot, teamId, date);

  if (detail === null) throw new Error('no day');

  return detail;
}

function givenOf(snapshot: CalendarSnapshot): DayDetail {
  const given = ownSwapShiftOf(snapshot, { dan: DATE, smjena: A }, TODAY, null);

  if (given === null) throw new Error('not the viewer’s shift');

  return given;
}

let snapshot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  snapshot = await snapshotOf();
});

describe('the link and the given shift (story 12.2)', () => {
  it('Link: a member, on their own working shift from today on, is offered Predloži zamjenu', () => {
    expect(swapOfferedOf(snapshot, dayOf(snapshot, A), TODAY, null)).toBe(true);
    expect(swapOfferedOf(snapshot, dayOf(snapshot, A), DATE, null)).toBe(true);
  });

  it('No link: an admin, a day off, a past day, someone else’s shift, or no today yet', async () => {
    const admin = await snapshotOf({ role: 'admin' });

    expect(swapOfferedOf(admin, dayOf(admin, A), TODAY, null)).toBe(false);
    expect(swapOfferedOf(snapshot, dayOf(snapshot, C), TODAY, null)).toBe(false);
    expect(dayOf(snapshot, C).kind).not.toBe(DAY_WORKING);
    expect(swapOfferedOf(snapshot, dayOf(snapshot, A), '2026-09-11', null)).toBe(false);
    expect(swapOfferedOf(snapshot, dayOf(snapshot, B), TODAY, null)).toBe(false);
    expect(swapOfferedOf(snapshot, dayOf(snapshot, A), null, null)).toBe(false);
    expect(swapOfferedOf(null, null, TODAY, null)).toBe(false);
  });

  it('Not mine: a URL for a shift not on the viewer’s roster, or none, names no given shift', async () => {
    expect(ownSwapShiftOf(snapshot, { dan: DATE, smjena: B }, TODAY, null)).toBeNull();
    expect(ownSwapShiftOf(snapshot, { dan: DATE }, TODAY, null)).toBeNull();
    expect(ownSwapShiftOf(snapshot, { dan: DATE, smjena: 'no-such-team' }, TODAY, null)).toBeNull();

    // Taken off by a roster change in force: no longer theirs.
    const off = await snapshotOf({ rosterOverrides: [calendarRosterOverrideRow('ro-off', A, DATE, VIEWER_MEMBER, null)] });

    expect(ownSwapShiftOf(off, { dan: DATE, smjena: A }, TODAY, null)).toBeNull();
    expect(givenOf(snapshot).teamId).toBe(A);
  });

  it('a roster change putting the viewer on another team’s working shift makes it theirs to offer', async () => {
    // B works Noć on 09-10; Luka (not on B) out is inert, so a plain addition puts the viewer on.
    const added = await snapshotOf({ rosterOverrides: [calendarRosterOverrideRow('ro-on', B, DATE, null, VIEWER_MEMBER)] });

    expect(swapOfferedOf(added, dayOf(added, B), TODAY, null)).toBe(true);
    expect(ownSwapShiftOf(added, { dan: DATE, smjena: B }, TODAY, null)?.teamId).toBe(B);
  });

  it('Marked (story 12.3): a shift the viewer already proposed in an open swap offers no link and no form', () => {
    const detail = dayOf(snapshot, A);
    const proposed = [{ teamId: A, date: DATE, addresseeId: ANA }];

    expect(swapOfferedOf(snapshot, detail, TODAY, proposed)).toBe(false);
    expect(swapProposalMarkOf(snapshot, detail, TODAY, proposed)).toEqual({ colleagueName: 'Ana Babić' });
    expect(ownSwapShiftOf(snapshot, { dan: DATE, smjena: A }, TODAY, proposed)).toBeNull();
    // Another shift, or none proposed: offered as before; unknown (`null`) too.
    expect(swapOfferedOf(snapshot, detail, TODAY, [{ teamId: A, date: '2026-09-14', addresseeId: ANA }])).toBe(true);
    expect(swapOfferedOf(snapshot, detail, TODAY, [])).toBe(true);
    expect(swapProposalMarkOf(snapshot, detail, TODAY, null)).toBeNull();
    expect(swapProposalMarkOf(snapshot, detail, TODAY, [])).toBeNull();
    // A colleague the snapshot does not hold is marked without a name.
    expect(swapProposalMarkOf(snapshot, detail, TODAY, [{ teamId: A, date: DATE, addresseeId: 'gone' }])).toEqual({ colleagueName: null });
  });

  it('Marked: never before the organization’s today, the link’s own date rule', () => {
    const detail = dayOf(snapshot, A);
    const proposed = [{ teamId: A, date: DATE, addresseeId: ANA }];

    expect(swapProposalMarkOf(snapshot, detail, '2026-09-11', proposed)).toBeNull();
    expect(swapProposalMarkOf(snapshot, detail, DATE, proposed)).toEqual({ colleagueName: 'Ana Babić' });
    expect(swapProposalMarkOf(snapshot, detail, null, proposed)).toBeNull();
  });

  it('Marked: an admin is never marked', async () => {
    const admin = await snapshotOf({ role: 'admin' });

    expect(swapProposalMarkOf(admin, dayOf(admin, A), TODAY, [{ teamId: A, date: DATE, addresseeId: ANA }])).toBeNull();
  });

  it('reads the URL only where it has the right shape', () => {
    expect(swapSearchOf({ dan: DATE, smjena: A })).toEqual({ dan: DATE, smjena: A });
    expect(swapSearchOf({ dan: '2026-02-31', smjena: '' })).toEqual({});
    expect(swapSearchOf({ dan: 20260910, smjena: 7 })).toEqual({});
  });

  it('draws by the snapshot’s role, failing closed', () => {
    expect(swapViewOf({ snapshot, refusal: null, loading: false })).toBe(SWAP_VIEW_MEMBER);
    expect(swapViewOf({ snapshot: { ...snapshot, viewer: { ...snapshot.viewer, role: 'admin' } }, refusal: null, loading: false })).toBe(
      SWAP_VIEW_ADMIN,
    );
    expect(swapViewOf({ snapshot: null, refusal: null, loading: true })).toBe(SWAP_VIEW_LOADING);
    expect(swapViewOf({ snapshot: null, refusal: null, loading: false })).toBe(SWAP_VIEW_UNAVAILABLE);
    expect(swapViewOf({ snapshot: null, refusal: 'CALENDAR_UNAVAILABLE', loading: false })).toBe(SWAP_VIEW_UNAVAILABLE);
  });
});

describe('the colleague options (story 12.2)', () => {
  it('offers every member active on the date, off the shift’s roster and not the viewer, by name', () => {
    expect(swapColleaguesOf(snapshot, givenOf(snapshot)).map((one) => one.id)).toEqual([ANA, DINO, EVA, IVO, LUKA, MARA]);
    expect(swapColleaguesOf(snapshot, givenOf(snapshot)).every((one) => one.blocked === null)).toBe(true);
  });

  it('leaves out a member inactive on the date', async () => {
    const inactive = await snapshotOf({ statuses: [statusRow(LUKA, false, '2026-09-01')] });

    expect(swapColleaguesOf(inactive, givenOf(inactive)).map((one) => one.id)).not.toContain(LUKA);
  });

  it('keeps one a live roster key already names, with its reason (ROSTER_TAKEN)', async () => {
    // Inert — Luka is not on A — but live, and its key puts Mara on A that day.
    const taken = await snapshotOf({ rosterOverrides: [calendarRosterOverrideRow('ro-mara', A, DATE, LUKA, MARA)] });
    const mara = swapColleaguesOf(taken, givenOf(taken)).find((one) => one.id === MARA);

    expect(mara?.blocked).toBe(ROSTER_TAKEN);
    expect(swapPreviewOf(taken, givenOf(taken), MARA, null, [])).toEqual({ kind: SWAP_PREVIEW_BLOCKED, code: ROSTER_TAKEN });
  });
});

describe('the return options (story 12.2)', () => {
  it('offers the colleague’s working shifts from today through the end of the next month, in date order', () => {
    const options = swapReturnOptionsOf(snapshot, givenOf(snapshot), IVO, TODAY);

    expect(options.slice(0, 3).map((one) => [one.date, one.typeName])).toEqual([
      ['2026-09-09', 'Dan'],
      ['2026-09-10', 'Noć'],
      ['2026-09-13', 'Dan'],
    ]);
    expect(options.every((one) => one.teamId === B && one.blocked === null)).toBe(true);
    expect(options.at(-1)?.date).toBe('2026-10-31');
    expect(options.every((one) => one.date >= TODAY && one.date <= '2026-10-31')).toBe(true);
  });

  it('never offers a past shift, the given one, one the viewer already works, or a date the viewer is inactive', async () => {
    const later = swapReturnOptionsOf(snapshot, givenOf(snapshot), IVO, '2026-09-11');

    expect(later[0]?.date).toBe('2026-09-13');

    // Karlo works A beside the viewer every time: none of his shifts can be taken.
    expect(swapReturnOptionsOf(snapshot, givenOf(snapshot), KARLO, TODAY)).toEqual([]);

    const leaving = await snapshotOf({ statuses: [statusRow(VIEWER_MEMBER, false, '2026-10-01')] });

    expect(swapReturnOptionsOf(leaving, givenOf(leaving), IVO, TODAY).every((one) => one.date < '2026-10-01')).toBe(true);
  });

  it('keeps a shift a live roster key already names, with its reason', async () => {
    const taken = await snapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('ro-back', B, '2026-09-13', LUKA, VIEWER_MEMBER)],
    });
    const back = swapReturnOptionsOf(taken, givenOf(taken), IVO, TODAY).find((one) => one.date === '2026-09-13');

    expect(back?.blocked).toBe(ROSTER_TAKEN);
  });

  it('is empty for a colleague the snapshot does not hold', () => {
    expect(swapReturnOptionsOf(snapshot, givenOf(snapshot), 'nobody', TODAY)).toEqual([]);
  });

  it('round-trips a return option through its field value', () => {
    expect(swapReturnShiftOf(swapReturnValueOf({ teamId: B, date: '2026-09-13' }))).toEqual({ teamId: B, date: '2026-09-13' });
    expect(swapReturnShiftOf('')).toBeNull();
    expect(swapReturnShiftOf('2026-02-31/x')).toBeNull();
  });
});

describe('the preview (story 12.2)', () => {
  it('shows nothing until a colleague is chosen', () => {
    expect(swapPreviewOf(snapshot, givenOf(snapshot), SWAP_NO_COLLEAGUE, null, [])).toBeNull();
  });

  it('One-way cover: the colleague works the date; the viewer −12 h, the colleague +12 h', () => {
    const preview = swapPreviewOf(snapshot, givenOf(snapshot), IVO, null, []);

    expect(preview?.kind).toBe(SWAP_PREVIEW_READY);
    if (preview?.kind !== SWAP_PREVIEW_READY) return;
    expect(preview.lines).toEqual([{ day: givenOf(snapshot).date, teamName: 'Smjena A', inId: IVO, outId: VIEWER_MEMBER }]);
    expect(preview.hours).toEqual([
      { memberId: VIEWER_MEMBER, month: '2026-09', deltaMinutes: -TWELVE_HOURS },
      { memberId: IVO, month: '2026-09', deltaMinutes: TWELVE_HOURS },
    ]);
  });

  it('With return in another month: both dates, and each member’s delta per month', () => {
    const preview = swapPreviewOf(snapshot, givenOf(snapshot), IVO, { teamId: B, date: '2026-10-03' }, []);

    if (preview?.kind !== SWAP_PREVIEW_READY) throw new Error('no preview');
    expect(preview.lines.map((line) => [line.teamName, line.inId, line.outId])).toEqual([
      ['Smjena A', IVO, VIEWER_MEMBER],
      ['Smjena B', VIEWER_MEMBER, IVO],
    ]);
    expect(preview.hours).toEqual([
      { memberId: VIEWER_MEMBER, month: '2026-09', deltaMinutes: -TWELVE_HOURS },
      { memberId: VIEWER_MEMBER, month: '2026-10', deltaMinutes: TWELVE_HOURS },
      { memberId: IVO, month: '2026-09', deltaMinutes: TWELVE_HOURS },
      { memberId: IVO, month: '2026-10', deltaMinutes: -TWELVE_HOURS },
    ]);
  });

  it('a return in the same month nets to no change, which is said rather than dropped', () => {
    const preview = swapPreviewOf(snapshot, givenOf(snapshot), IVO, { teamId: B, date: '2026-09-13' }, []);

    if (preview?.kind !== SWAP_PREVIEW_READY) throw new Error('no preview');
    expect(preview.hours).toEqual([
      { memberId: VIEWER_MEMBER, month: '2026-09', deltaMinutes: 0 },
      { memberId: IVO, month: '2026-09', deltaMinutes: 0 },
    ]);
  });

  it('counts the viewer’s Sati leave keys, and none for the colleague', () => {
    // The given shift already counts as leave on the viewer's Sati: giving it away moves no hours of theirs.
    const keys = [
      { memberId: VIEWER_MEMBER, date: DATE, teamId: A },
      { memberId: IVO, date: '2026-09-13', teamId: B },
    ];
    const preview = swapPreviewOf(snapshot, givenOf(snapshot), IVO, { teamId: B, date: '2026-09-13' }, keys);

    if (preview?.kind !== SWAP_PREVIEW_READY) throw new Error('no preview');
    expect(preview.hours).toEqual([
      { memberId: VIEWER_MEMBER, month: '2026-09', deltaMinutes: TWELVE_HOURS },
      { memberId: IVO, month: '2026-09', deltaMinutes: 0 },
    ]);
  });

  it('counts the viewer’s own half day as Sati does, and never a record of the colleague (story 13.5)', () => {
    const half = { from: DATE, to: DATE, absenceTypeId: 'annual', drawsAllowance: true, half: 'SECOND' as const };
    const other = { from: DATE, to: DATE, absenceTypeId: 'annual', drawsAllowance: true, half: 'FIRST' as const };
    const preview = swapPreviewOf(
      snapshot,
      givenOf(snapshot),
      IVO,
      null,
      [],
      new Map([
        [VIEWER_MEMBER, [half]],
        [IVO, [other]],
      ]),
    );

    if (preview?.kind !== SWAP_PREVIEW_READY) throw new Error('no preview');
    expect(preview.hours).toEqual([
      { memberId: VIEWER_MEMBER, month: '2026-09', deltaMinutes: -TWELVE_HOURS / 2 },
      { memberId: IVO, month: '2026-09', deltaMinutes: TWELVE_HOURS },
    ]);
  });

  it('a preview that cannot be derived is none, logged, never a thrown error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: CalendarSnapshot = { ...snapshot, types: [] };

    expect(swapPreviewOf(broken, givenOf(snapshot), IVO, null, [])).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('the choice (story 12.2 review)', () => {
  const choiceOf = (colleagueId: string, back: { readonly teamId: string; readonly date: string } | null = null) => ({
    colleagueId,
    returnValue: back === null ? SWAP_NO_RETURN : swapReturnValueOf(back),
  });

  it('drops the return shift when the colleague changes, even to a teammate offering the same shift', () => {
    const given = givenOf(snapshot);
    const back = { teamId: B, date: '2026-09-13' };
    // Ivo and Ana both work B on 09-13: the same value is on offer for each.
    expect(swapReturnOptionsOf(snapshot, given, ANA, TODAY).map(swapReturnValueOf)).toContain(swapReturnValueOf(back));

    const chosen = choiceOf(IVO, back);
    const switched = swapChoiceOnColleague(chosen, ANA);

    expect(switched).toEqual({ colleagueId: ANA, returnValue: SWAP_NO_RETURN });
    expect(swapChoiceOnColleague(SWAP_NO_CHOICE, IVO)).toEqual({ colleagueId: IVO, returnValue: SWAP_NO_RETURN });
  });

  it('resolves a choice the options hold, and refuses one they do not, never as a one-way cover', () => {
    const given = givenOf(snapshot);
    const colleagues = swapColleaguesOf(snapshot, given);
    const options = swapReturnOptionsOf(snapshot, given, IVO, TODAY);
    const back = { teamId: B, date: '2026-09-13' };

    expect(swapChoiceOf(colleagues, options, choiceOf(IVO))).toMatchObject({ ok: true, returnShift: null });
    expect(swapChoiceOf(colleagues, options, choiceOf(IVO, back))).toMatchObject({ ok: true, returnShift: back });
    expect(swapChoiceOf(colleagues, options, SWAP_NO_CHOICE)).toEqual({ ok: false, code: SWAP_NO_COLLEAGUE_CHOSEN });
    expect(swapChoiceOf(colleagues, options, choiceOf(KARLO))).toEqual({ ok: false, code: SWAP_COLLEAGUE_GONE });
    // A return value no longer offered: refused, never sent as none.
    expect(swapChoiceOf(colleagues, [], choiceOf(IVO, back))).toEqual({ ok: false, code: SWAP_RETURN_GONE });
    expect(
      swapChoiceOf(
        colleagues,
        options.map((one) => ({ ...one, blocked: ROSTER_TAKEN })),
        choiceOf(IVO, back),
      ),
    ).toEqual({ ok: false, code: SWAP_BLOCKED });
    expect(
      swapChoiceOf(
        colleagues.map((one) => ({ ...one, blocked: ROSTER_TAKEN })),
        options,
        choiceOf(IVO),
      ),
    ).toEqual({ ok: false, code: SWAP_BLOCKED });
  });
});

describe('the send-time check (FR-66)', () => {
  const given = { teamId: A, date: DATE };
  const choiceOf = (colleagueId: string, back: { readonly teamId: string; readonly date: string } | null = null) => ({
    colleagueId,
    returnValue: back === null ? SWAP_NO_RETURN : swapReturnValueOf(back),
  });
  const codeOf = (outcome: ReturnType<typeof swapSendCheckOf>): SwapCheckRefusal | null => (outcome.ok ? null : outcome.code);

  it('passes the viewer’s own shift, and a return shift on the colleague’s roster', () => {
    expect(swapSendCheckOf(snapshot, given, choiceOf(IVO), TODAY)).toMatchObject({ ok: true, returnShift: null });
    expect(swapSendCheckOf(snapshot, given, choiceOf(IVO, { teamId: B, date: '2026-09-13' }), TODAY)).toMatchObject({
      ok: true,
      returnShift: { teamId: B, date: '2026-09-13' },
    });
  });

  it('refuses a given shift that is not a working shift on the viewer’s roster', async () => {
    expect(codeOf(swapSendCheckOf(snapshot, { teamId: B, date: DATE }, choiceOf(IVO), TODAY))).toBe(SWAP_GIVEN_GONE);
    expect(codeOf(swapSendCheckOf(snapshot, given, choiceOf(IVO), '2026-09-11'))).toBe(SWAP_GIVEN_GONE);
    expect(codeOf(swapSendCheckOf(snapshot, given, choiceOf(IVO), null))).toBe(SWAP_GIVEN_GONE);

    const off = await snapshotOf({ rosterOverrides: [calendarRosterOverrideRow('ro-off', A, DATE, VIEWER_MEMBER, null)] });

    expect(codeOf(swapSendCheckOf(off, given, choiceOf(IVO), TODAY))).toBe(SWAP_GIVEN_GONE);
  });

  it('refuses a return shift that is not a working shift on the colleague’s roster, or no longer offered', async () => {
    // B is off on 2026-09-11, and C works none of Ivo's.
    expect(codeOf(swapSendCheckOf(snapshot, given, choiceOf(IVO, { teamId: B, date: '2026-09-11' }), TODAY))).toBe(
      SWAP_RETURN_GONE,
    );
    expect(codeOf(swapSendCheckOf(snapshot, given, choiceOf(IVO, { teamId: C, date: '2026-09-12' }), TODAY))).toBe(
      SWAP_RETURN_GONE,
    );
    // Past today, or past the window: the options' rules, re-derived.
    expect(codeOf(swapSendCheckOf(snapshot, given, choiceOf(IVO, { teamId: B, date: '2026-09-09' }), '2026-09-10'))).toBe(
      SWAP_RETURN_GONE,
    );
    expect(codeOf(swapSendCheckOf(snapshot, given, choiceOf(IVO, { teamId: B, date: '2026-11-04' }), TODAY))).toBe(
      SWAP_RETURN_GONE,
    );

    const moved = await snapshotOf({ rosterOverrides: [calendarRosterOverrideRow('ro-ivo', B, '2026-09-13', IVO, null)] });

    expect(codeOf(swapSendCheckOf(moved, given, choiceOf(IVO, { teamId: B, date: '2026-09-13' }), TODAY))).toBe(
      SWAP_RETURN_GONE,
    );
  });

  it('refuses no colleague, a colleague no longer offered, and a blocked one, each with its own code', async () => {
    expect(codeOf(swapSendCheckOf(snapshot, given, SWAP_NO_CHOICE, TODAY))).toBe(SWAP_NO_COLLEAGUE_CHOSEN);
    expect(codeOf(swapSendCheckOf(snapshot, given, choiceOf(KARLO), TODAY))).toBe(SWAP_COLLEAGUE_GONE);

    const inactive = await snapshotOf({ statuses: [statusRow(LUKA, false, '2026-09-01')] });

    expect(codeOf(swapSendCheckOf(inactive, given, choiceOf(LUKA), TODAY))).toBe(SWAP_COLLEAGUE_GONE);

    const taken = await snapshotOf({ rosterOverrides: [calendarRosterOverrideRow('ro-mara', A, DATE, LUKA, MARA)] });

    expect(codeOf(swapSendCheckOf(taken, given, choiceOf(MARA), TODAY))).toBe(SWAP_BLOCKED);
  });
});

describe('the viewer’s leave records (story 13.5)', () => {
  const halfRow = { id: 'record-half', member_id: VIEWER_MEMBER, during: `[${DATE},2026-09-11)`, half: 'SECOND' };

  it('are the viewer’s own records by member, a half day keeping its half, and split the preview’s hours', () => {
    const records = swapLeaveRecordsOf(snapshot, { data: [halfRow], isError: false });

    expect(records.get(VIEWER_MEMBER)).toMatchObject([{ from: DATE, to: DATE, half: 'SECOND' }]);
    const preview = swapPreviewOf(snapshot, givenOf(snapshot), IVO, null, [], records);
    if (preview?.kind !== SWAP_PREVIEW_READY) throw new Error('no preview');
    expect(preview.hours[0]).toEqual({ memberId: VIEWER_MEMBER, month: '2026-09', deltaMinutes: -TWELVE_HOURS / 2 });
  });

  it('are none while pending, silently, and none when the read failed or a row cannot be trusted, logged', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(swapLeaveRecordsOf(snapshot, { data: undefined, isError: false }).size).toBe(0);
    expect(error).not.toHaveBeenCalled();
    expect(swapLeaveRecordsOf(snapshot, { data: undefined, isError: true }).size).toBe(0);
    expect(swapLeaveRecordsOf(snapshot, { data: [{ ...halfRow, member_id: 'someone else' }], isError: false }).size).toBe(0);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(SWAP_LEAVE_RECORDS_UNREAD, expect.anything());
    error.mockRestore();
  });
});

describe('the leave keys (story 12.2 review)', () => {
  it('are the viewer’s Sati keys from their own resolution rows', () => {
    const rows = [{ member_id: VIEWER_MEMBER, date: DATE, team_id: A, kind: 'accept_uncovered', roster_override_id: null }];

    expect(swapLeaveKeysOf(snapshot, rows)).toEqual({ keys: [{ memberId: VIEWER_MEMBER, date: DATE, teamId: A }], known: true });
    expect(swapLeaveKeysOf(snapshot, [])).toEqual({ keys: [], known: true });
  });

  it('are none, and not known, for rows unread or rows that cannot be trusted', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(swapLeaveKeysOf(snapshot, undefined)).toEqual({ keys: [], known: false });
    expect(swapLeaveKeysOf(snapshot, [{ member_id: 'someone else', date: DATE, team_id: A, kind: 'accept_uncovered' }])).toEqual({
      keys: [],
      known: false,
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('the write (0049)', () => {
  function tableAnswering(answer: unknown): { readonly table: SwapRequestInsertTable; readonly sent: unknown[] } {
    const sent: unknown[] = [];

    return {
      sent,
      table: {
        insert: (values) => {
          sent.push(values);

          return Promise.resolve(answer as { readonly error: null });
        },
      },
    };
  }

  const proposal = {
    organizationId: 'org',
    proposerId: VIEWER_MEMBER,
    addresseeId: IVO,
    given: { teamId: A, date: DATE },
    returnShift: null,
  };

  it('inserts exactly the seven proposal columns, nulls for a one-way cover', async () => {
    const { table, sent } = tableAnswering({ error: null });

    await expect(sendSwapProposal(table, proposal)).resolves.toEqual({ ok: true });
    expect(sent).toEqual([
      {
        organization_id: 'org',
        proposer_id: VIEWER_MEMBER,
        addressee_id: IVO,
        team_id: A,
        date: DATE,
        return_team_id: null,
        return_date: null,
      },
    ]);

    const back = tableAnswering({ error: null });

    await sendSwapProposal(back.table, { ...proposal, returnShift: { teamId: B, date: '2026-10-03' } });
    expect(back.sent[0]).toMatchObject({ return_team_id: B, return_date: '2026-10-03' });
  });

  it('maps the refusals by SQLSTATE: 23505 duplicate, 42501 denied, 23514 invalid, anything else failed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(swapSendFailureOf({ code: '23505' })).toBe(SWAP_DUPLICATE);
    expect(swapSendFailureOf({ code: '42501' })).toBe(SWAP_DENIED);
    expect(swapSendFailureOf({ code: '23514' })).toBe(SWAP_INVALID);
    expect(swapSendFailureOf({ code: '23503' })).toBe(SWAP_FAILED);
    await expect(sendSwapProposal(tableAnswering({ error: { code: '23505' } }).table, proposal)).resolves.toEqual({
      ok: false,
      code: SWAP_DUPLICATE,
    });
    await expect(sendSwapProposal(tableAnswering('nonsense').table, proposal)).resolves.toEqual({ ok: false, code: SWAP_FAILED });
    await expect(
      sendSwapProposal({ insert: () => Promise.reject(new Error('network')) }, proposal),
    ).resolves.toEqual({ ok: false, code: SWAP_FAILED });
    error.mockRestore();
  });

  it('words every refusal', () => {
    const words: Readonly<Record<SwapSendFailure, string>> = {
      [SWAP_DUPLICATE]: 'kalendar.swap.duplicate',
      [SWAP_DENIED]: 'kalendar.swap.denied',
      [SWAP_INVALID]: 'kalendar.swap.invalid',
      [SWAP_FAILED]: 'kalendar.swap.failed',
      [SWAP_GIVEN_GONE]: 'kalendar.swap.givenGone',
      [SWAP_RETURN_GONE]: 'kalendar.swap.returnGone',
      [SWAP_NO_COLLEAGUE_CHOSEN]: 'kalendar.swap.noColleague',
      [SWAP_COLLEAGUE_GONE]: 'kalendar.swap.colleagueGone',
      [SWAP_BLOCKED]: 'kalendar.swap.blocked',
    };

    for (const [code, key] of Object.entries(words)) expect(swapSendMessageKey(code as SwapSendFailure), code).toBe(key);
  });
});

describe('the status line on Kalendar (story 12.2)', () => {
  const proposed = { date: DATE, teamName: 'Smjena A', colleagueName: 'Ivo Horvat', returnShift: null };
  const withReturn = { ...proposed, returnShift: { date: '2026-10-03', teamName: 'Smjena B' } };

  it('rides the history entry, and is cleared off it', () => {
    const state = withSwapProposed({ key: 'router' }, proposed);

    expect(swapProposedOf(state)).toEqual(proposed);
    expect(withoutSwapProposed(state)).toEqual({ key: 'router' });
    expect(swapProposedValuesOf(proposed)).toEqual({
      withReturn: false,
      key: 'kalendar.swap.sent',
      values: { date: '10.09.2026', team: 'Smjena A', name: 'Ivo Horvat' },
    });
    expect(swapProposedOf(withSwapProposed({}, withReturn))).toEqual(withReturn);
    expect(swapProposedValuesOf(withReturn)).toEqual({
      withReturn: true,
      key: 'kalendar.swap.sentWithReturn',
      values: { date: '10.09.2026', team: 'Smjena A', name: 'Ivo Horvat', returnDate: '03.10.2026', returnTeam: 'Smjena B' },
    });
    expect(swapProposedOf({ [SWAP_PROPOSED_STATE]: { ...withReturn, returnShift: { date: 'x', teamName: 'B' } } })).toBeNull();
    expect(swapProposedOf(null)).toBeNull();
    expect(swapProposedOf({ [SWAP_PROPOSED_STATE]: { ...proposed, date: 'x' } })).toBeNull();
  });

  it('shows on the location that brings it, keeps through the clearing replace, and drops after', () => {
    const arrived = swapProposedStepOf(null, withSwapProposed({}, proposed), false);

    expect(arrived).toEqual({ shown: proposed, clear: true, clearing: true });
    expect(swapProposedStepOf(proposed, {}, true)).toEqual({ shown: proposed, clear: false, clearing: false });
    expect(swapProposedStepOf(proposed, {}, false)).toEqual({ shown: null, clear: false, clearing: false });
  });

  it('names a month in the locative, as a sentence says it (UX-DR34)', () => {
    expect(swapMonthOf('2026-10')).toEqual({ key: 'filter.monthIn.10', year: '2026' });
  });
});
