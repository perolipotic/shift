import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { dayDetailOf, rosterOffersOf, type DayDetail } from '@/features/calendar/utils/day-detail';
import {
  LOAN_MARKS_UNAVAILABLE,
  LOAN_NOTICE_AHEAD,
  LOAN_NOTICE_WITH,
  currentLoanTeamsOf,
  lentFromOf,
  loanNoticeMessageKey,
  loanNoticeOf,
} from '@/features/calendar/utils/loan-marks';
import { calendarMonthOf, calendarSearchOf, filterTeamOf } from '@/features/calendar/utils/month';
import { hoursSourceMessageKey } from '@/features/hours/services/hours-explanation';
import { historyRecordMessageKey } from '@/features/history/services/history-rows';
import { CASE_FREE, TODAY_READY, TODAY_UNSCHEDULED, todayViewOf } from '@/features/today/services/today';
import { adminOwnLoanOf } from '@/features/today/services/admin-today';
import { LEAVE_READY, LEAVE_UNSCHEDULED, memberLeaveBaseOf } from '@/features/leave/services/leave-section-base';
import { MY_LEAVE_READY, MY_LEAVE_UNSCHEDULED, myLeaveOf } from '@/features/leave/services/my-leave';
import { replacementCandidatesOf } from '@/features/calendar/utils/replacement-candidates';
import { hoursExportOf } from '@/features/hours/services/hours-export';
import { swapColleaguesOf } from '@/features/swaps/services/swap-proposal';
import { organizationHoursOf } from '@/features/hours/services/organization-hours';
import { lentFromText } from '@/components/loan-mark';
import { initLocalization, t } from '@/lib/i18n';
import { organizationTodayAt } from '@/utils/organization-today';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarLoanRow,
  calendarMemberRow,
  calendarOrganizationRow,
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
 * STORY 18.5 — loans are visible wherever rosters are read (FR-92,
 * UX-DR59). On the pilot (`[Dan, Noć, Slobodno, Slobodno]`): Smjena C works
 * Dan on 12.09.2026 and 16.09., Noć on 13.09.; Smjena A works Dan on 10.09.
 * and 14.09. Zoran's home is A; Nina is on no team. Every case compares the
 * same organization with and without the loan: with none, nothing is added.
 */

const A = 'pilot-smjena-a';
const C = 'pilot-smjena-c';
const D = 'pilot-smjena-d';
const ZORAN = '00000000-0000-4000-8000-0000000000f1';
const NINA = '00000000-0000-4000-8000-0000000000f3';

type Row = Record<string, unknown>;

const ZORAN_TO_C = calendarLoanRow('loan-zoran', ZORAN, C, '2026-09-10', '2026-09-12');
const NINA_TO_C = calendarLoanRow('loan-nina', NINA, C, '2026-09-12', '2026-09-12');
const VIEWER_TO_D = calendarLoanRow('loan-viewer', VIEWER_MEMBER, D, '2026-09-20', '2026-09-22');

async function snapshotOf({
  loans = [],
  viewerTeam = A as string | null,
  role = 'member_role',
}: { readonly loans?: readonly Row[]; readonly viewerTeam?: string | null; readonly role?: string } = {}): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow(viewerTeam === null ? [] : [membershipRow(viewerTeam, SEEDED)], { role })],
          versions: [
            ...(viewerTeam === null ? [] : [memberMembershipRow(VIEWER_MEMBER, viewerTeam, SEEDED)]),
            memberMembershipRow(ZORAN, A, SEEDED),
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
      calendarMemberRow(NINA, 'Nina Novak'),
    ]),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(),
    loansAnswerOf(loans),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

function detailOn(snapshot: CalendarSnapshot, teamId: string, date: string): DayDetail {
  const detail = dayDetailOf(snapshot, teamId, date);

  if (detail === null) throw new Error(`no detail of ${teamId} on ${date}`);

  return detail;
}

function memberOf(snapshot: CalendarSnapshot, id: string) {
  const member = snapshot.members.find((one) => one.id === id);

  if (member === undefined) throw new Error(`no member ${id}`);

  return member;
}

let plain: CalendarSnapshot;
let lent: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await snapshotOf();
  lent = await snapshotOf({ loans: [ZORAN_TO_C, NINA_TO_C, VIEWER_TO_D] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the mark under the loan team (day detail, UX-DR59)', () => {
  it('lists a lent member under C marked `posudba iz tima Smjena A`, a teamless one `posudba, bez svog tima`', () => {
    const roster = detailOn(lent, C, '2026-09-12').roster;

    expect(roster.find((one) => one.id === ZORAN)?.lentFrom).toEqual({ teamName: 'Smjena A' });
    expect(roster.find((one) => one.id === NINA)?.lentFrom).toEqual({ teamName: null });
    expect(lentFromText({ teamName: 'Smjena A' })).toBe('posudba iz tima Smjena A');
    expect(lentFromText({ teamName: null })).toBe('posudba, bez svog tima');
  });

  it('carries no `lentFrom` key at all with no loan, or on a home day (R11.4)', () => {
    for (const snapshot of [plain, lent]) {
      for (const [teamId, date] of [
        [A, '2026-09-14'],
        [C, '2026-09-16'],
      ] as const) {
        for (const member of detailOn(snapshot, teamId, date).roster) expect(Object.hasOwn(member, 'lentFrom')).toBe(false);
      }
    }
    expect(detailOn(plain, C, '2026-09-12').roster.some((member) => Object.hasOwn(member, 'lentFrom'))).toBe(false);
  });

  it("names a put-on candidate's team as the one they are with that day", async () => {
    const admin = await snapshotOf({ role: 'admin' });
    const adminLent = await snapshotOf({ role: 'admin', loans: [ZORAN_TO_C] });
    const offers = (snapshot: CalendarSnapshot) =>
      rosterOffersOf(snapshot, detailOn(snapshot, D, '2026-09-11'), null).in.find((one) => one.id === ZORAN)?.teamName;

    expect(offers(admin)).toBe('Smjena A');
    expect(offers(adminLent)).toBe('Smjena C');
  });

  it('lentFromOf is null on the home team, on a date with no loan, and with no loan at all', () => {
    const zoran = memberOf(lent, ZORAN);

    expect(lentFromOf(lent, zoran, C, '2026-09-11')).toEqual({ teamName: 'Smjena A' });
    expect(lentFromOf(lent, zoran, A, '2026-09-11')).toBeNull();
    expect(lentFromOf(lent, zoran, C, '2026-09-13')).toBeNull();
    expect(lentFromOf(plain, memberOf(plain, ZORAN), C, '2026-09-11')).toBeNull();
  });

  it('draws the day without the mark, logged, when the home team cannot be named', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { ...lent, teams: lent.teams.filter((team) => team.id !== A) } as CalendarSnapshot;
    const zoran = detailOn(broken, C, '2026-09-12').roster.find((one) => one.id === ZORAN);

    expect(zoran).toBeDefined();
    expect(Object.hasOwn(zoran ?? {}, 'lentFrom')).toBe(false);
    expect(error).toHaveBeenCalledWith(LOAN_MARKS_UNAVAILABLE, expect.any(RangeError));
  });
});

describe("the notice of one's own loan (Moj raspored, Danas)", () => {
  it('reads the loan ahead, then the one covering today, then nothing once it has ended', () => {
    const loans = lent.viewer.loans;

    expect(loanNoticeOf(lent, loans, '2026-09-11')).toEqual({
      kind: LOAN_NOTICE_AHEAD,
      teamName: 'Smjena D',
      from: '20.09.2026',
      to: '22.09.2026',
    });
    expect(loanNoticeOf(lent, loans, '2026-09-20')?.kind).toBe(LOAN_NOTICE_WITH);
    expect(loanNoticeOf(lent, loans, '2026-09-22')?.kind).toBe(LOAN_NOTICE_WITH);
    expect(loanNoticeOf(lent, loans, '2026-09-23')).toBeNull();
    expect(loanNoticeOf(plain, plain.viewer.loans, '2026-09-11')).toBeNull();
    expect(t(loanNoticeMessageKey(LOAN_NOTICE_WITH), { team: 'Smjena D', from: '20.09.2026', to: '22.09.2026' })).toBe(
      'U timu Smjena D do 22.09.2026.',
    );
    expect(t(loanNoticeMessageKey(LOAN_NOTICE_AHEAD), { team: 'Smjena D', from: '20.09.2026', to: '22.09.2026' })).toBe(
      'Od 20.09.2026. u timu Smjena D do 22.09.2026.',
    );
  });

  it("puts it on Kalendar's month as `ownLoan`, absent with none", () => {
    const search = calendarSearchOf({});

    expect(calendarMonthOf(lent, search, '2026-09-21').ownLoan?.kind).toBe(LOAN_NOTICE_WITH);
    expect(Object.hasOwn(calendarMonthOf(plain, search, '2026-09-21'), 'ownLoan')).toBe(false);
    expect(Object.hasOwn(calendarMonthOf(lent, search, '2026-09-23'), 'ownLoan')).toBe(false);
  });

  it("puts it on Danas's view as `loan`, absent with none", () => {
    const now = new Date('2026-09-21T10:00:00Z');
    const ready = (snapshot: CalendarSnapshot) => {
      const today = todayViewOf(snapshot, [], now);

      if (today.kind !== TODAY_READY) throw new Error(today.kind);

      return today.view;
    };

    expect(ready(lent).loan).toMatchObject({ kind: LOAN_NOTICE_WITH, teamName: 'Smjena D' });
    expect(Object.hasOwn(ready(plain), 'loan')).toBe(false);
    // An admin's *Danas* states the same notice under its subtitle.
    expect(adminOwnLoanOf(todayViewOf(lent, [], now))).toMatchObject({ kind: LOAN_NOTICE_WITH, teamName: 'Smjena D' });
    expect(adminOwnLoanOf(todayViewOf(plain, [], now))).toBeUndefined();
  });

  it('draws Danas and the month without the notice, logged, when the loan team cannot be named', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { ...lent, teams: lent.teams.filter((team) => team.id !== D) } as CalendarSnapshot;
    const today = todayViewOf(broken, [], new Date('2026-09-11T10:00:00Z'));

    expect(today.kind).toBe(TODAY_READY);
    if (today.kind === TODAY_READY) expect(Object.hasOwn(today.view, 'loan')).toBe(false);
    expect(Object.hasOwn(calendarMonthOf(broken, calendarSearchOf({}), '2026-09-11'), 'ownLoan')).toBe(false);
    expect(error).toHaveBeenCalledWith(LOAN_MARKS_UNAVAILABLE, expect.any(RangeError));
  });

  it('keeps a teamless viewer scheduled while a loan of theirs covers today or lies ahead (deferred-work 18.2)', async () => {
    const teamless = await snapshotOf({ viewerTeam: null });
    const teamlessLent = await snapshotOf({ viewerTeam: null, loans: [VIEWER_TO_D] });

    expect(todayViewOf(teamless, [], new Date('2026-09-11T10:00:00Z')).kind).toBe(TODAY_UNSCHEDULED);
    const ahead = todayViewOf(teamlessLent, [], new Date('2026-09-11T10:00:00Z'));

    expect(ahead.kind).toBe(TODAY_READY);
    if (ahead.kind === TODAY_READY) {
      expect(ahead.view.todayCase).toEqual({ kind: CASE_FREE, shift: null, inactive: false });
      expect(ahead.view.loan?.kind).toBe(LOAN_NOTICE_AHEAD);
      expect(ahead.view.week.some((day) => day.day.shifts.some((shift) => shift.teamId === D))).toBe(false);
    }
    const during = todayViewOf(teamlessLent, [], new Date('2026-09-21T10:00:00Z'));

    expect(during.kind).toBe(TODAY_READY);
    if (during.kind === TODAY_READY) expect(during.view.loan?.kind).toBe(LOAN_NOTICE_WITH);
    // Once the only loan has ended, unscheduled again.
    expect(todayViewOf(teamlessLent, [], new Date('2026-09-23T10:00:00Z')).kind).toBe(TODAY_UNSCHEDULED);
  });
});

describe("Kalendar's Osoba picker (the Team filter)", () => {
  const dates = Array.from({ length: 30 }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`);

  it('places a person lent today under the loan team, marked; counts follow; Sati keeps the home team', () => {
    const month = calendarMonthOf(lent, calendarSearchOf({}), '2026-09-11');
    const zoran = month.filter.people.find((one) => one.id === ZORAN);

    expect(zoran).toEqual({ id: ZORAN, name: 'Zoran Zorić', teamId: C, teamName: 'Smjena C', lentFrom: { teamName: 'Smjena A' } });
    const plainMonth = calendarMonthOf(plain, calendarSearchOf({}), '2026-09-11');

    expect(month.filter.teamCounts[C]).toBe((plainMonth.filter.teamCounts[C] ?? 0) + 1);
    expect(month.filter.teamCounts[A]).toBe((plainMonth.filter.teamCounts[A] ?? 0) - 1);
  });

  it('reads the loan on today in the month holding today, else on the last active date; none adds nothing', () => {
    const zoran = memberOf(lent, ZORAN);

    expect(filterTeamOf(lent, zoran, dates, '2026-09-11')).toEqual({ teamId: C, lentFrom: { teamName: 'Smjena A' } });
    expect(filterTeamOf(lent, zoran, dates, '2026-09-20')).toEqual({ teamId: A, lentFrom: null });
    // Another month shown: its last active date, 30.09., is no loan day.
    expect(filterTeamOf(lent, zoran, dates, '2026-10-05')).toEqual({ teamId: A, lentFrom: null });
    const plainMonth = calendarMonthOf(plain, calendarSearchOf({}), '2026-09-11');

    expect(plainMonth.filter.people.some((person) => Object.hasOwn(person, 'lentFrom'))).toBe(false);
  });

  it("reads a month not holding today on its last active date: a loan covering 30.09. places them under it", async () => {
    const monthEnd = await snapshotOf({ loans: [calendarLoanRow('loan-end', ZORAN, C, '2026-09-29', '2026-09-30')] });

    expect(filterTeamOf(monthEnd, memberOf(monthEnd, ZORAN), dates, '2026-10-05')).toEqual({
      teamId: C,
      lentFrom: { teamName: 'Smjena A' },
    });
  });

  it('places a person inactive on the loan date by their team for the month, unmarked', () => {
    const zoran = { ...memberOf(lent, ZORAN), statuses: [{ active: false, effectiveFrom: '2026-09-11' }] };

    expect(filterTeamOf(lent, zoran, dates, '2026-09-11')).toEqual({ teamId: A, lentFrom: null });
  });

  it('places a person lent to a team archived since as before: no active team holds the loan', () => {
    const archived = {
      ...lent,
      teams: lent.teams.map((team) => (team.id === C ? { ...team, archived: true } : team)),
    } as CalendarSnapshot;

    expect(filterTeamOf(archived, memberOf(archived, ZORAN), dates, '2026-09-11')).toEqual({ teamId: A, lentFrom: null });
  });
});

describe("the directory's `trenutno u timu {tim}`", () => {
  it('names the team each lent member is with today, and nobody else', () => {
    expect([...currentLoanTeamsOf(lent, '2026-09-11')]).toEqual([[ZORAN, 'Smjena C']]);
    expect([...currentLoanTeamsOf(lent, '2026-09-12')].sort()).toEqual([
      [ZORAN, 'Smjena C'],
      [NINA, 'Smjena C'],
    ].sort());
    expect(currentLoanTeamsOf(lent, '2026-09-13').size).toBe(0);
    expect(currentLoanTeamsOf(plain, '2026-09-11').size).toBe(0);
    expect(currentLoanTeamsOf(null, '2026-09-11').size).toBe(0);
    expect(currentLoanTeamsOf(lent, null).size).toBe(0);
    expect(t('loans.mark.now', { team: 'Smjena C' })).toBe('trenutno u timu Smjena C');
  });

  it('draws no line for a member inactive today, lent or not', () => {
    const inactive = {
      ...lent,
      members: lent.members.map((member) =>
        member.id === ZORAN ? { ...member, statuses: [{ active: false, effectiveFrom: '2026-09-01' }] } : member,
      ),
    } as CalendarSnapshot;

    expect(currentLoanTeamsOf(inactive, '2026-09-11').has(ZORAN)).toBe(false);
  });

  it("reads today in the organization's zone, and logs and draws nothing on a snapshot it cannot read", () => {
    // The hook's today (`useOrganizationToday`): at 10:00 UTC on 11.09., Zoran's loan.
    const at = (instant: string) => organizationTodayAt(null, lent.timeZone, new Date(instant)).today;

    expect([...currentLoanTeamsOf(lent, at('2026-09-11T10:00:00Z'))]).toEqual([[ZORAN, 'Smjena C']]);
    // 22:30 UTC on 12.09. is already the 13th in Zagreb, after both loans: no line (UTC would still show two).
    expect(at('2026-09-12T22:30:00Z')).toBe('2026-09-13');
    expect(currentLoanTeamsOf(lent, at('2026-09-12T22:30:00Z')).size).toBe(0);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { ...lent, teams: [] } as CalendarSnapshot;

    expect(currentLoanTeamsOf(broken, '2026-09-11').size).toBe(0);
    expect(error).toHaveBeenCalledWith(LOAN_MARKS_UNAVAILABLE, expect.any(RangeError));
  });

  it('loses only the line it cannot derive: one member\'s unknown loan team leaves the others', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mixed = await snapshotOf({
      loans: [ZORAN_TO_C, calendarLoanRow('loan-nina-d', NINA, D, '2026-09-11', '2026-09-11')],
    });
    const broken = { ...mixed, teams: mixed.teams.filter((team) => team.id !== C) } as CalendarSnapshot;

    expect([...currentLoanTeamsOf(broken, '2026-09-11')]).toEqual([[NINA, 'Smjena D']]);
    expect(error).toHaveBeenCalledWith(LOAN_MARKS_UNAVAILABLE, expect.any(RangeError));
  });
});

describe('the words of a loan elsewhere', () => {
  it('names the hours source `posudba` and the history record `Posudba`', () => {
    expect(t(hoursSourceMessageKey('LOAN'))).toBe('posudba');
    expect(t(historyRecordMessageKey('loan'))).toBe('Posudba');
  });

  it('never calls a team `smjena` in a loan mark, the hours source or the history record', () => {
    for (const key of [
      'loans.mark.lentFrom',
      'loans.mark.lentFromNone',
      'loans.mark.with',
      'loans.mark.ahead',
      'loans.mark.now',
      'sati.explain.source.loan',
      'history.record.loan',
    ] as const) {
      expect(t(key, { team: 'X', from: 'a', to: 'b' }).toLowerCase()).not.toContain('smjen');
    }
  });
});

describe('a teamless lent member is scheduled for leave costing (deferred-work 18.2)', () => {
  const ORGANIZATION = {
    data: { ok: true as const, snapshot: { leaveYearStartMonth: 1, leaveYearStartDay: 1 } },
    isPending: false,
    isError: false,
    fetchStatus: 'idle',
  };
  const NOW = new Date('2026-09-11T10:00:00Z');
  const members = (id: string) => ({
    members: [{ id, leaveAllowance: { startingDays: 20, versions: [] } }],
    refusal: null,
    loading: false,
    paused: false,
  });

  it("*Godišnji*: unscheduled with no team and no loan; costed once a loan gives them the loan team's days", async () => {
    const sources = (snapshot: CalendarSnapshot) => ({
      members: members(VIEWER_MEMBER),
      calendar: { snapshot, loading: false },
      organization: ORGANIZATION,
      records: { rows: [], loading: false },
    });

    expect(myLeaveOf(sources(await snapshotOf({ viewerTeam: null })), NOW).kind).toBe(MY_LEAVE_UNSCHEDULED);
    expect(myLeaveOf(sources(await snapshotOf({ viewerTeam: null, loans: [VIEWER_TO_D] })), NOW).kind).toBe(MY_LEAVE_READY);
  });

  it("the member page's leave card: the same, for a member on no team", () => {
    const base = (snapshot: CalendarSnapshot) =>
      memberLeaveBaseOf(
        {
          members: members(NINA),
          calendar: { snapshot, loading: false },
          organization: ORGANIZATION,
          records: { records: [], loading: false, refreshing: false },
        },
        NINA,
        NOW,
      ).kind;

    expect(base(plain)).toBe(LEAVE_UNSCHEDULED);
    expect(base(lent)).toBe(LEAVE_READY);
  });
});

describe('a position is held in the home team, never on a loan team', () => {
  it("names no position for a candidate who is with a loan team that day", async () => {
    const withPosition = async (loans: readonly Row[]) => {
      const source = calendarTableOf(
        {
          data: [
            calendarOrganizationRow(PILOT, {
              viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'admin' })],
              versions: [
                memberMembershipRow(VIEWER_MEMBER, A, SEEDED),
                memberMembershipRow(ZORAN, A, SEEDED, undefined, 'vozač'),
              ],
              statuses: [],
            }),
          ],
          error: null,
          count: 1,
        },
        membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(ZORAN, 'Zoran Zorić')]),
        overridesAnswerOf(),
        rosterOverridesAnswerOf(),
        loansAnswerOf(loans),
      );
      const outcome = await readCalendar(source, source, viewerSession());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.snapshot;
    };
    const positionOf = (snapshot: CalendarSnapshot) =>
      replacementCandidatesOf(snapshot, [], D, '2026-09-11', 'pilot-dan')
        .flatMap((group) => group.candidates)
        .find((one) => one.id === ZORAN)?.position;

    expect(positionOf(await withPosition([]))).toBe('vozač');
    expect(positionOf(await withPosition([ZORAN_TO_C]))).toBeNull();

    // A swap's colleague on B's Dan of 13.09.: their home position, none once lent to D that day.
    const colleagueOf = (snapshot: CalendarSnapshot) =>
      swapColleaguesOf(snapshot, detailOn(snapshot, 'pilot-smjena-b', '2026-09-13')).find((one) => one.id === ZORAN)?.position;

    expect(colleagueOf(await withPosition([]))).toBe('vozač');
    expect(colleagueOf(await withPosition([calendarLoanRow('loan-d', ZORAN, D, '2026-09-13', '2026-09-13')]))).toBeNull();
  });
});

describe('the Excel export follows rosters, with no column change (AC 4)', () => {
  it("writes the lent member's hours as the loan team's shifts, under the same columns and their own team", () => {
    const sheetOf = (snapshot: CalendarSnapshot) => {
      const outcome = organizationHoursOf(snapshot, { mjesec: '2026-09' }, '2026-09-11', [], [], new Map());

      if (!outcome.ok) throw new Error(outcome.code);

      return hoursExportOf(outcome.view, 'Org');
    };
    const before = sheetOf(plain);
    const after = sheetOf(lent);
    const rowOf = (sheet: typeof before) => sheet.rows.find((row) => row[0]?.kind === 'text' && row[0].value === 'Zoran Zorić');

    expect(after.columns).toEqual(before.columns);
    expect(rowOf(after)?.[1]).toEqual(rowOf(before)?.[1]);
    expect(rowOf(after)?.[1]).toEqual({ kind: 'text', value: 'Smjena A' });
    // A's Dan of 10.09. and Noć of 11.09. lost, C's Dan of 12.09. gained: one shift and 12 h fewer.
    const shiftsOf = (row: ReturnType<typeof rowOf>) => (row?.[2]?.kind === 'count' ? row[2].value : null);

    expect(shiftsOf(rowOf(after))).toBe((shiftsOf(rowOf(before)) ?? 0) - 1);
    // The total, in days: 12 h fewer.
    const totalAt = after.columns.indexOf(t('sati.organization.total'));
    const hoursOf = (row: ReturnType<typeof rowOf>) => (row?.[totalAt]?.kind === 'hours' ? row[totalAt].value : null);

    expect(totalAt).toBeGreaterThan(0);
    expect((hoursOf(rowOf(before)) ?? 0) - (hoursOf(rowOf(after)) ?? 0)).toBeCloseTo(12 / 24);
  });
});
