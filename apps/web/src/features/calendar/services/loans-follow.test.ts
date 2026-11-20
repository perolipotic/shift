import { memberScheduleOfMonth, shiftRoster } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberMonthDeltasOf } from '@/features/calendar/utils/change-preview';
import { dayDetailOf, rosterOverlapOf, type DayDetail } from '@/features/calendar/utils/day-detail';
import { calendarDayListOf, memberScheduleInputOf } from '@/features/calendar/utils/month';
import { CANDIDATES_FREE, replacementCandidatesOf } from '@/features/calendar/utils/replacement-candidates';
import { deactivationConsequenceOf } from '@/features/members/services/deactivation-consequence';
import { teamMovePreviewOf } from '@/features/members/services/team-move-preview';
import { ownSwapShiftOf, swapReturnOptionsOf } from '@/features/swaps/services/swap-proposal';
import { initLocalization } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarLoanRow,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
  calendarTableOf,
  loansAnswerOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 18.2: a loan read by the snapshot reaches every web mapper that
 * rebuilds a member's schedule input, with none of them changed. Each rebuilds
 * `{memberId, memberships, statuses}` and passes `members: snapshot.members`,
 * whose entry carries the loans, so the domain's one rule (R11, through
 * `memberScheduleOfMonth`'s fallback to the entry) puts the lent member on the
 * loan team. Every case is R11.6-shaped and compares the same snapshot with
 * and without the loan.
 *
 * The pilot (`[Dan, Noć, Slobodno, Slobodno]` from 2020-01-01): Smjena A works
 * Dan on 10.09.2026 and every fourth day after, Noć the day after each;
 * Smjena B works Dan on 09.09. and 13.09., Noć on 10.09. and 14.09.;
 * Smjena C works Dan on 12.09. and 16.09., Noć on 13.09.; Smjena D works Dan
 * on 11.09. and Noć on 12.09. Zoran's home is A; Ivo's is B.
 */

const A = 'pilot-smjena-a';
const B = 'pilot-smjena-b';
const C = 'pilot-smjena-c';
const D = 'pilot-smjena-d';
const ZORAN = '00000000-0000-4000-8000-0000000000f1';
const IVO = '00000000-0000-4000-8000-0000000000f2';
const TODAY = '2026-09-01';

/** Zoran lent to C from 10.09. to 12.09. (R11.6). */
const ZORAN_TO_C = calendarLoanRow('loan-zoran', ZORAN, C, '2026-09-10', '2026-09-12');

type Row = Record<string, unknown>;

async function snapshotOf(
  {
    loans = [],
    overrides = [],
    role = 'admin',
  }: { readonly loans?: readonly Row[]; readonly overrides?: readonly Row[]; readonly role?: string } = {},
): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, A, SEEDED),
            memberMembershipRow(ZORAN, A, SEEDED),
            memberMembershipRow(IVO, B, SEEDED),
          ],
          statuses: [],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(ZORAN, 'Zoran Zorić'),
      calendarMemberRow(IVO, 'Ivo Horvat'),
    ]),
    overridesAnswerOf(overrides),
    rosterOverridesAnswerOf(),
    loansAnswerOf(loans),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

function historyOf(snapshot: CalendarSnapshot, memberId: string) {
  const member = snapshot.members.find((one) => one.id === memberId);

  if (member === undefined) throw new Error(`no member ${memberId}`);

  return { memberId, memberships: member.memberships, statuses: member.statuses };
}

function detailOn(snapshot: CalendarSnapshot, teamId: string, date: string): DayDetail {
  const detail = dayDetailOf(snapshot, teamId, date);

  if (detail === null) throw new Error(`no detail of ${teamId} on ${date}`);

  return detail;
}

let plain: CalendarSnapshot;
let lent: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await snapshotOf();
  lent = await snapshotOf({ loans: [ZORAN_TO_C] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a loan read by the snapshot is followed by every mapper (story 18.2)', () => {
  it('carries the loan on the lent member alone; with none, every member carries `loans: []`', () => {
    expect(plain.members.every((member) => member.loans.length === 0)).toBe(true);
    expect(plain.viewer.loans).toEqual([]);
    expect(lent.members.find((member) => member.id === ZORAN)?.loans).toEqual([
      { id: 'loan-zoran', teamId: C, from: '2026-09-10', to: '2026-09-12' },
    ]);
    expect(lent.viewer.loans).toEqual([]);
  });

  it('month.ts: the member\'s schedule input and person month follow the loan team on covered dates, and home after', () => {
    const shiftsOn = (snapshot: CalendarSnapshot, date: string) =>
      memberScheduleOfMonth(memberScheduleInputOf(snapshot, historyOf(snapshot, ZORAN)), '2026-09')
        .find((day) => day.date === date)
        ?.shifts.map((shift) => [shift.teamId, shift.shiftTypeId]);

    expect(shiftsOn(plain, '2026-09-10')).toEqual([[A, 'pilot-dan']]);
    expect(shiftsOn(lent, '2026-09-10')).toEqual([[C, 'pilot-slobodno']]);
    expect(shiftsOn(lent, '2026-09-12')).toEqual([[C, 'pilot-dan']]);
    expect(shiftsOn(lent, '2026-09-13')).toEqual(shiftsOn(plain, '2026-09-13'));
    expect(shiftsOn(lent, '2026-09-14')).toEqual([[A, 'pilot-dan']]);

    const dayOf = (snapshot: CalendarSnapshot, date: string) =>
      calendarDayListOf(snapshot, historyOf(snapshot, ZORAN), '2026-09', TODAY)
        ?.find((day) => day.date === date)
        ?.shifts.map((shift) => shift.teamId);

    expect(dayOf(plain, '2026-09-12')).toEqual([A]);
    expect(dayOf(lent, '2026-09-12')).toEqual([C]);
    expect(dayOf(lent, '2026-09-14')).toEqual([A]);
  });

  it('change-preview.ts: the month\'s hours move with the loan — A\'s Dan and Noć lost, C\'s Dan gained', () => {
    expect(memberMonthDeltasOf(plain, lent, [ZORAN], ['2026-09'], () => [])).toEqual([
      { memberId: ZORAN, month: '2026-09', deltaMinutes: -12 * 60 },
    ]);
    expect(memberMonthDeltasOf(plain, plain, [ZORAN], ['2026-09'], () => [])).toEqual([
      { memberId: ZORAN, month: '2026-09', deltaMinutes: 0 },
    ]);
  });

  it('day-detail.ts: putting the lent member on a shift overlapping the loan team\'s names the loan team', async () => {
    // D's Noć of 12.09. made a Dan: the window of C's Dan that Zoran works through the loan.
    const overrides = [calendarOverrideRow('o-d', D, '2026-09-12', 'pilot-dan')];
    const plainDan = await snapshotOf({ overrides });
    const lentDan = await snapshotOf({ overrides, loans: [ZORAN_TO_C] });

    expect(rosterOverlapOf(plainDan, detailOn(plainDan, D, '2026-09-12'), ZORAN)).toBeNull();
    expect(rosterOverlapOf(lentDan, detailOn(lentDan, D, '2026-09-12'), ZORAN)).toMatchObject({
      teamName: 'Smjena C',
      date: '2026-09-12',
      range: '07:00–19:00',
    });
  });

  it('replacement-candidates.ts: the lent member is off the home roster and free on the loan team\'s day off', () => {
    const freeOf = (snapshot: CalendarSnapshot) =>
      replacementCandidatesOf(snapshot, [], A, '2026-09-10', 'pilot-dan')
        .find((group) => group.kind === CANDIDATES_FREE)
        ?.candidates.map((one) => one.id);

    expect(freeOf(plain)).not.toContain(ZORAN);
    expect(freeOf(lent)).toContain(ZORAN);
    // Off A's base roster that date, so no candidate list excludes him as on it.
    expect(shiftRoster(plain.members, A, '2026-09-10').map((entry) => entry.memberId)).toContain(ZORAN);
    expect(shiftRoster(lent.members, A, '2026-09-10').map((entry) => entry.memberId)).not.toContain(ZORAN);
    expect(shiftRoster(lent.members, C, '2026-09-10').map((entry) => entry.memberId)).toContain(ZORAN);
  });

  it('deactivation-consequence.ts: the home team\'s duties left in the month leave out the loaned dates', async () => {
    // From 14.09. on A: Dan 14, 18, 22, 26, 30 and Noć 15, 19, 23, 27 — nine;
    // lent to C on 18.–19.09., Dan 18 and Noć 19 are C's dates, so seven.
    const later = await snapshotOf({ loans: [calendarLoanRow('loan-later', ZORAN, C, '2026-09-18', '2026-09-19')] });

    expect(deactivationConsequenceOf(plain, ZORAN, '2026-09-14', TODAY)?.duties).toBe(9);
    expect(deactivationConsequenceOf(later, ZORAN, '2026-09-14', TODAY)?.duties).toBe(7);
    // On a date lent away the member is on no roster of the home team: nothing shrinks.
    expect(deactivationConsequenceOf(lent, ZORAN, '2026-09-10', TODAY)).toBeNull();
  });

  it('team-move-preview.ts: the last shift in the team left skips the dates lent away', () => {
    expect(teamMovePreviewOf(plain, ZORAN, B, '2026-09-13', TODAY)?.last).toMatchObject({ team: 'Smjena A', date: '2026-09-11' });
    expect(teamMovePreviewOf(lent, ZORAN, B, '2026-09-13', TODAY)?.last).toMatchObject({ team: 'Smjena A', date: '2026-09-07' });
  });

  it('swap-proposal.ts: a return option is the loan team\'s shift the colleague holds through the loan', async () => {
    // A member-role viewer offers their own shift.
    const own = await snapshotOf({ role: 'member_role' });
    const ivoToC = await snapshotOf({
      role: 'member_role',
      // 13.09.: B works Dan, C works Noć.
      loans: [calendarLoanRow('loan-ivo', IVO, C, '2026-09-13', '2026-09-13')],
    });
    const optionsOf = (snapshot: CalendarSnapshot) => {
      const given = ownSwapShiftOf(snapshot, { dan: '2026-09-10', smjena: A }, '2026-09-08', null);

      if (given === null) throw new Error('not the viewer’s shift');

      return swapReturnOptionsOf(snapshot, given, IVO, '2026-09-08')
        .filter((one) => one.date <= '2026-09-14')
        .map((one) => [one.date, one.teamId, one.typeName]);
    };

    expect(optionsOf(own)).toEqual([
      ['2026-09-09', B, 'Dan'],
      ['2026-09-10', B, 'Noć'],
      ['2026-09-13', B, 'Dan'],
      ['2026-09-14', B, 'Noć'],
    ]);
    // B's Dan of 13.09. is gone; C's Noć that date, held through the loan, is offered.
    expect(optionsOf(ivoToC)).toEqual([
      ['2026-09-09', B, 'Dan'],
      ['2026-09-10', B, 'Noć'],
      ['2026-09-13', C, 'Noć'],
      ['2026-09-14', B, 'Noć'],
    ]);
  });

  it('the viewer: a loan of the viewer rides on `viewer` and their own month follows the loan team', async () => {
    const viewerToC = await snapshotOf({ loans: [calendarLoanRow('loan-viewer', VIEWER_MEMBER, C, '2026-09-10', '2026-09-12')] });
    const own = (snapshot: CalendarSnapshot) => ({
      memberId: snapshot.viewer.memberId,
      memberships: snapshot.viewer.memberships,
      statuses: snapshot.viewer.statuses,
    });
    const teamsOn = (snapshot: CalendarSnapshot, date: string) =>
      calendarDayListOf(snapshot, own(snapshot), '2026-09', TODAY)
        ?.find((day) => day.date === date)
        ?.shifts.map((shift) => shift.teamId);

    expect(viewerToC.viewer.loans).toEqual([{ id: 'loan-viewer', teamId: C, from: '2026-09-10', to: '2026-09-12' }]);
    expect(teamsOn(plain, '2026-09-10')).toEqual([A]);
    expect(teamsOn(viewerToC, '2026-09-12')).toEqual([C]);
    expect(teamsOn(viewerToC, '2026-09-14')).toEqual([A]);
  });
});
