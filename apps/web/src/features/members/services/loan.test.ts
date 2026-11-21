import { memberScheduleOfMonth } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf } from '@/features/calendar/utils/month';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE, type ErasureReads } from '@/features/conflicts/services/erasure-check';
import type { MemberListRow } from '@/features/members/services/list';
import {
  AMEND_TEAM_LOAN_FUNCTION,
  LOAN_AMEND,
  LOAN_ARCHIVED,
  LOAN_DENIED,
  LOAN_DRAFT_ID,
  LOAN_FAILED,
  LOAN_FIELD_FROM,
  LOAN_FIELD_REASON,
  LOAN_FIELD_TEAM,
  LOAN_FIELD_TO,
  LOAN_FROM_INVALID,
  LOAN_GAINED,
  LOAN_HOME,
  LOAN_LEND,
  LOAN_LOST,
  LOAN_ORDER,
  LOAN_OVERLAP,
  LOAN_REASON,
  LOAN_REMOVE,
  LOAN_STALE,
  LOAN_TO_INVALID,
  LOAN_UNCHANGED,
  LOAN_UNPICKED,
  LOAN_UNPICKED_VALUE,
  REMOVE_TEAM_LOAN_FUNCTION,
  amendLoan,
  enteredSpanOf,
  lendMember,
  loanAmendChoicesOf,
  loanAmendPreflightOf,
  loanEditSnapshotOf,
  loanEditWindowOf,
  loanEndsTodayOfferedOf,
  loanInactiveDaysOf,
  loanSavedMessageKey,
  loanWriteEditOf,
  memberLoansOf,
  removeLoan,
  loanChangeSnapshotOf,
  loanChoicesOf,
  loanErasureCheckOf,
  loanFieldOf,
  loanInertMessageKey,
  loanPreflightOf,
  loanPreviewOf,
  loanRefusalMessageKey,
  loanShiftMessageKey,
  loanWriteFailureOf,
  previewableSpanOf,
  shownLoanPreviewOf,
  shownLoanShortStaffedOf,
  type LoanEdit,
  type LoanRpc,
  type LoanSpan,
  type LoanTable,
} from '@/features/members/services/loan';
import { SHORT_STAFFED_KNOWN, SHORT_STAFFED_UNKNOWN } from '@/features/staffing/services/short-staffed';
import type { TeamRow } from '@/features/teams/services/list';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarLoanRow,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  loansAnswerOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  statusRow,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 18.3's loan dialog, executed (AD-15): every row of the spec's matrix
 * but the DB-only ones (the notification, the policy's own refusals), over
 * the pilot fixture — `[Dan, Noć, Slobodno, Slobodno]` — in October 2026:
 * Smjena A works Dan 08., 12., 16. and Noć 09., 13.; Smjena C works Dan 06.,
 * 10., 14. and Noć 07., 11., 15. Ana is on Smjena A; the viewer, an admin,
 * on Smjena B. Ana is lent to C for 10.–12.
 */

const ANA = '00000000-0000-4000-8000-0000000000a1';
const A = 'pilot-smjena-a';
const B = 'pilot-smjena-b';
const C = 'pilot-smjena-c';
const D = 'pilot-smjena-d';
const TODAY = '2026-10-01';
const SPAN: LoanSpan = { memberId: ANA, teamId: C, from: '2026-10-10', to: '2026-10-12' };

type Row = Record<string, unknown>;

interface Setup {
  readonly versions?: readonly Row[];
  readonly overrides?: readonly Row[];
  readonly rosterOverrides?: readonly Row[];
  readonly loans?: readonly Row[];
  readonly statuses?: readonly Row[];
  readonly minimumMembers?: number;
}

async function snapshotOf({
  versions = [],
  overrides = [],
  rosterOverrides = [],
  loans = [],
  statuses = [],
  minimumMembers,
}: Setup = {}): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(B, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, B, SEEDED), memberMembershipRow(ANA, A, SEEDED), ...versions],
          statuses,
          minimumMembers,
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(ANA, 'Ana Anić')]),
    overridesAnswerOf(overrides),
    rosterOverridesAnswerOf(rosterOverrides),
    loansAnswerOf(loans),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** The preview of {@link SPAN} over `snapshot`, which must accept it. */
function previewOf(snapshot: CalendarSnapshot, span: LoanSpan = SPAN) {
  const applied = loanChangeSnapshotOf(snapshot, span);

  if (!applied.ok) throw new Error(applied.code);

  return loanPreviewOf(snapshot, applied.after, span);
}

/** A row as `leave_records` answers it: the range canonical, its upper bound exclusive. */
function recordOf(id: string, from: string, toExclusive: string, memberId: string = ANA): Row {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}

const LEAVE_READ = { isPending: false, isError: false, data: [] } as const;

let plain: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await snapshotOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Lend: the one "after" and what it changes', () => {
  it('appends the draft to the member alone, and to the viewer only when the viewer is lent', () => {
    const applied = loanChangeSnapshotOf(plain, SPAN);

    if (!applied.ok) throw new Error(applied.code);

    const lent = applied.after.members.find((member) => member.id === ANA);
    expect(lent?.loans).toEqual([{ id: LOAN_DRAFT_ID, teamId: C, from: SPAN.from, to: SPAN.to }]);
    expect(applied.after.members.find((member) => member.id === VIEWER_MEMBER)?.loans).toEqual([]);
    expect(applied.after.viewer.loans).toEqual([]);
    expect(plain.members.find((member) => member.id === ANA)?.loans).toEqual([]);

    const self = loanChangeSnapshotOf(plain, { ...SPAN, memberId: VIEWER_MEMBER });

    if (!self.ok) throw new Error(self.code);
    expect(self.after.viewer.loans).toEqual([{ id: LOAN_DRAFT_ID, teamId: C, from: SPAN.from, to: SPAN.to }]);
  });

  it("lists A's shift lost and C's gained, per date, and words them", () => {
    const preview = previewOf(plain);

    expect(preview.shifts).toEqual([
      { side: LOAN_GAINED, team: 'Smjena C', date: '2026-10-10', type: 'Dan', range: '07:00–19:00' },
      { side: LOAN_GAINED, team: 'Smjena C', date: '2026-10-11', type: 'Noć', range: '19:00–07:00' },
      { side: LOAN_LOST, team: 'Smjena A', date: '2026-10-12', type: 'Dan', range: '07:00–19:00' },
    ]);
    expect(preview.moreShifts).toBe(0);
    expect(preview.inert).toEqual([]);
    const [first] = preview.shifts;
    expect(
      t(loanShiftMessageKey(first!), { team: first!.team, type: first!.type, range: first!.range ?? '', weekday: 'sub', date: '10.10.' }),
    ).toBe('Dobiva Dan u timu Smjena C · sub 10.10. · 07:00–19:00');
    expect(loanShiftMessageKey({ ...first!, side: LOAN_LOST, range: null })).toBe('loans.lostNoRange');
  });

  it('Boundary: a home Noć on the 9th runs into C’s Dan on the 10th — 24 h of work with no rest', () => {
    const preview = previewOf(plain);

    expect(preview.restGaps).toEqual([
      { key: expect.any(String), date: '2026-10-09', teams: ['Smjena A', 'Smjena C'], totalMinutes: 1440 },
    ]);
    expect(preview.doubles).toEqual([]);
  });

  it('keeps a no-rest run’s whole total when it starts before the day ahead of the loan', async () => {
    // A works Noć on the 8th and Ana is put on B's Dan of the 9th: A Noć 8th, B Dan 9th, A Noć 9th, C Dan 10th.
    const snapshot = await snapshotOf({
      overrides: [calendarOverrideRow('type-a-8', A, '2026-10-08', 'pilot-noc'), calendarOverrideRow('type-b-9', B, '2026-10-09', 'pilot-dan')],
      rosterOverrides: [calendarRosterOverrideRow('on-b-9', B, '2026-10-09', null, ANA)],
    });
    const preview = previewOf(snapshot);

    expect(preview.restGaps).toEqual([
      { key: expect.any(String), date: '2026-10-08', teams: ['Smjena A', 'Smjena B', 'Smjena A', 'Smjena C'], totalMinutes: 2880 },
    ]);
  });

  it('shows the first ten shift lines and counts the rest', () => {
    const preview = previewOf(plain, { ...SPAN, from: '2026-10-10', to: '2026-10-31' });

    expect(preview.shifts).toHaveLength(10);
    expect(preview.moreShifts).toBeGreaterThan(0);
  });

  it('Overlap legs: a home override putting the member back on A while C works the same Noć is a double booking', async () => {
    const snapshot = await snapshotOf({
      overrides: [calendarOverrideRow('type-a-11', A, '2026-10-11', 'pilot-noc')],
      rosterOverrides: [calendarRosterOverrideRow('back-on-a', A, '2026-10-11', null, ANA)],
    });
    const preview = previewOf(snapshot);

    expect(preview.doubles).toEqual([
      {
        key: expect.any(String),
        date: '2026-10-11',
        first: { team: 'Smjena C', type: 'Noć' },
        second: { team: 'Smjena A', type: 'Noć' },
      },
    ]);
  });

  it('Override inert: one taking the member off A on the 12th is listed, kept, and worded', async () => {
    const snapshot = await snapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('off-a-12', A, '2026-10-12', ANA, null)],
    });
    const preview = previewOf(snapshot);

    expect(preview.inert).toEqual([
      { key: 'off-a-12', date: '2026-10-12', team: 'Smjena A', out: { name: 'Ana Anić' }, in: null },
    ]);
    expect(snapshot.rosterOverrides.map((override) => override.id)).toEqual(['off-a-12']);
    expect(loanInertMessageKey(preview.inert[0]!)).toBe('loans.inertOut');
    expect(loanInertMessageKey({ ...preview.inert[0]!, out: null, in: { name: 'Ivo' } })).toBe('loans.inertIn');
    expect(loanInertMessageKey({ ...preview.inert[0]!, in: { name: 'Ivo' } })).toBe('loans.inertSwap');
  });

  it('names an inert override’s member the snapshot lacks as unknown, and keeps the line and the preview', async () => {
    const snapshot = await snapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('swap-a-12', A, '2026-10-12', ANA, VIEWER_MEMBER)],
    });
    // The viewer, put on A, is no longer in the members read.
    const lacking = { ...snapshot, members: snapshot.members.filter((member) => member.id !== VIEWER_MEMBER) };

    expect(previewOf(lacking).inert).toEqual([
      { key: 'swap-a-12', date: '2026-10-12', team: 'Smjena A', out: { name: 'Ana Anić' }, in: { name: null } },
    ]);
    expect(shownLoanPreviewOf(lacking, SPAN)?.inert).toHaveLength(1);
  });

  it('Boundary, trailing: C’s Noć on the 11th runs into A’s Dan on the 12th, the day after the loan', () => {
    const preview = previewOf(plain, { ...SPAN, to: '2026-10-11' });

    expect(preview.restGaps).toEqual([
      { key: expect.any(String), date: '2026-10-09', teams: ['Smjena A', 'Smjena C'], totalMinutes: 1440 },
      { key: expect.any(String), date: '2026-10-11', teams: ['Smjena C', 'Smjena A'], totalMinutes: 1440 },
    ]);
  });

  it('says no double booking an override already made before the loan, on a boundary day', async () => {
    // B works Noć on the 13th by a type override and Ana is put on it, while A works Noć that day too.
    const snapshot = await snapshotOf({
      overrides: [calendarOverrideRow('type-b-13', B, '2026-10-13', 'pilot-noc')],
      rosterOverrides: [calendarRosterOverrideRow('on-b-13', B, '2026-10-13', null, ANA)],
    });
    const ana = snapshot.members.find((member) => member.id === ANA)!;
    const thirteenth = memberScheduleOfMonth(
      memberScheduleInputOf(snapshot, { memberId: ANA, memberships: ana.memberships, statuses: ana.statuses }),
      '2026-10',
    ).find((day) => day.date === '2026-10-13');
    const preview = previewOf(snapshot);

    expect(thirteenth?.shifts.map((shift) => [shift.teamId, shift.shiftTypeId]), 'the double booking is not already there').toEqual([
      [A, 'pilot-noc'],
      [B, 'pilot-noc'],
    ]);
    expect(preview.doubles).toEqual([]);
    expect(preview.restGaps).toHaveLength(1);
  });

  it('derives nothing for a span past 366 days, as while a year is typed digit by digit; the save is unaffected', async () => {
    const snapshot = await snapshotOf({ minimumMembers: 1 });
    const centuries = { ...SPAN, from: '0002-10-12', to: '2026-10-12' };
    const yearAndADay = { ...SPAN, to: '2027-10-11' };

    expect(previewableSpanOf({ ...SPAN, to: '2027-10-10' }), '366 days, both ends included').toBe(true);
    expect(previewableSpanOf(yearAndADay)).toBe(false);
    expect(shownLoanPreviewOf(snapshot, centuries)).toBeNull();
    expect(shownLoanShortStaffedOf(snapshot, centuries, LEAVE_READ)).toBeNull();
    expect(shownLoanShortStaffedOf(snapshot, yearAndADay, LEAVE_READ)).toBeNull();
    expect(
      loanPreflightOf(ANA, [{ id: C, name: 'Smjena C' }], { teamId: C, from: centuries.from, to: centuries.to, reason: 'Ispravak' }),
    ).toMatchObject({ ok: true });
  });

  it('shows the unknown line, logged, for any error the short-staffed derivation throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const snapshot = await snapshotOf({ minimumMembers: 1 });
    const broken = {
      get isPending(): boolean {
        throw new TypeError('the leave read broke');
      },
      isError: false,
      data: [],
    };

    expect(shownLoanShortStaffedOf(snapshot, SPAN, broken)).toEqual({ kind: SHORT_STAFFED_UNKNOWN });
    expect(error).toHaveBeenCalled();
  });

  it('Short-staffed: A falls below the minimum on the 12th; nothing while the setting is empty; unknown while the leave is unread', async () => {
    const snapshot = await snapshotOf({ minimumMembers: 1 });
    const report = shownLoanShortStaffedOf(snapshot, SPAN, LEAVE_READ);

    if (report === null || report.kind !== SHORT_STAFFED_KNOWN) throw new Error(JSON.stringify(report));
    expect(report.rows.map((row) => [row.teamName, row.date, row.shiftTypeName])).toEqual([['Smjena A', '2026-10-12', 'Dan']]);
    expect(shownLoanShortStaffedOf(plain, SPAN, LEAVE_READ)).toBeNull();
    expect(shownLoanShortStaffedOf(snapshot, null, LEAVE_READ)).toBeNull();
    expect(shownLoanShortStaffedOf(snapshot, SPAN, { isPending: true, isError: false, data: undefined })).toEqual({
      kind: SHORT_STAFFED_UNKNOWN,
    });
  });

  it('shows no preview without a snapshot, a span or an accepted loan, and when nothing changes', () => {
    expect(shownLoanPreviewOf(null, SPAN)).toBeNull();
    expect(shownLoanPreviewOf(plain, null)).toBeNull();
    expect(shownLoanPreviewOf(plain, { ...SPAN, teamId: A })).toBeNull();
    // D works nothing on the 11th that A did not: Slobodno on both, so nothing changes, no rest gap.
    expect(shownLoanPreviewOf(plain, { ...SPAN, teamId: D, from: '2026-10-11', to: '2026-10-11' })).toBeNull();
    expect(shownLoanPreviewOf(plain, SPAN)?.shifts).toHaveLength(3);
  });

  it('derives the span from the fields only for a picked team and two dates in order', () => {
    const choices = [{ id: C, name: 'Smjena C' }];

    expect(enteredSpanOf(ANA, choices, C, SPAN.from, SPAN.to)).toEqual(SPAN);
    expect(enteredSpanOf(ANA, choices, LOAN_UNPICKED_VALUE, SPAN.from, SPAN.to)).toBeNull();
    expect(enteredSpanOf(ANA, choices, B, SPAN.from, SPAN.to)).toBeNull();
    expect(enteredSpanOf(ANA, choices, C, '', SPAN.to)).toBeNull();
    expect(enteredSpanOf(ANA, choices, C, SPAN.to, SPAN.from)).toBeNull();
  });
});

describe('Home team / archived / overlap: the fresh read refuses before deriving', () => {
  it('refuses the home team, on the first covered date or one a move starts inside the range', async () => {
    expect(loanChangeSnapshotOf(plain, { ...SPAN, teamId: A })).toEqual({ ok: false, code: LOAN_HOME });

    const moving = await snapshotOf({ versions: [memberMembershipRow(ANA, C, '2026-10-11')] });
    expect(loanChangeSnapshotOf(moving, SPAN)).toEqual({ ok: false, code: LOAN_HOME });
    // A move to C after the range is no refusal.
    const later = await snapshotOf({ versions: [memberMembershipRow(ANA, C, '2026-10-13')] });
    expect(loanChangeSnapshotOf(later, SPAN).ok).toBe(true);
  });

  it('refuses an archived team, a team or member the read lacks, a reversed range and a live loan sharing a date', async () => {
    const archived = { ...plain, teams: plain.teams.map((team) => (team.id === C ? { ...team, archived: true } : team)) };
    expect(loanChangeSnapshotOf(archived, SPAN)).toEqual({ ok: false, code: LOAN_ARCHIVED });
    expect(loanChangeSnapshotOf(plain, { ...SPAN, teamId: 'gone' })).toEqual({ ok: false, code: LOAN_STALE });
    expect(loanChangeSnapshotOf(plain, { ...SPAN, memberId: 'gone' })).toEqual({ ok: false, code: LOAN_STALE });
    expect(loanChangeSnapshotOf(plain, { ...SPAN, from: SPAN.to, to: SPAN.from })).toEqual({ ok: false, code: LOAN_ORDER });

    const lent = await snapshotOf({ loans: [calendarLoanRow('00000000-0000-4000-8000-00000000f001', ANA, B, '2026-10-12', '2026-10-14')] });
    expect(loanChangeSnapshotOf(lent, SPAN)).toEqual({ ok: false, code: LOAN_OVERLAP });
    expect(loanChangeSnapshotOf(lent, { ...SPAN, to: '2026-10-11' }).ok).toBe(true);
  });
});

describe('Erasure: the check over the three fresh reads', () => {
  const reads = (calendar: CalendarSnapshot, records: readonly Row[] = []) => (): Promise<ErasureReads> =>
    Promise.resolve({ calendar, records, resolutions: [] });

  it("names the conflict of a member on leave on A's Dan of the 12th, which the loan would erase", async () => {
    const check = await loanErasureCheckOf(reads(plain, [recordOf('leave-12', '2026-10-12', '2026-10-13')]), SPAN, true);

    if (check.kind !== CHECK_READY) throw new Error(check.kind);
    expect(check.rows.map((row) => [row.memberName, row.date, row.teamName])).toEqual([['Ana Anić', '2026-10-12', 'Smjena A']]);
  });

  it('is ready and empty with nothing to erase, refused as the database would, and unavailable offline or on a failed read', async () => {
    expect(await loanErasureCheckOf(reads(plain), SPAN, true)).toEqual({ kind: CHECK_READY, rows: [] });
    expect(await loanErasureCheckOf(reads(plain), { ...SPAN, teamId: A }, true)).toEqual({ kind: CHECK_REFUSED, code: LOAN_HOME });
    expect(await loanErasureCheckOf(reads(plain), SPAN, false)).toEqual({ kind: CHECK_UNAVAILABLE });

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await loanErasureCheckOf(() => Promise.reject(new Error('down')), SPAN, true)).toEqual({ kind: CHECK_UNAVAILABLE });
  });
});

describe('Unpicked / dates / reason: the preflight sends nothing', () => {
  const choices = [{ id: C, name: 'Smjena C' }];
  const entered = { teamId: C, from: SPAN.from, to: SPAN.to, reason: '  Vježba  ' };

  it('passes a filled dialog with the reason trimmed by 0036’s class', () => {
    expect(loanPreflightOf(ANA, choices, entered)).toEqual({ ok: true, draft: { ...SPAN, reason: 'Vježba' } });
    expect(loanPreflightOf(ANA, choices, { ...entered, reason: `\u0085${'đ'.repeat(200)}\u3000` })).toMatchObject({ ok: true });
  });

  it.each([
    [{ teamId: LOAN_UNPICKED_VALUE }, LOAN_UNPICKED, LOAN_FIELD_TEAM],
    [{ teamId: B }, LOAN_STALE, null],
    [{ from: '2026-02-30' }, LOAN_FROM_INVALID, LOAN_FIELD_FROM],
    [{ to: '' }, LOAN_TO_INVALID, LOAN_FIELD_TO],
    [{ from: SPAN.to, to: SPAN.from }, LOAN_ORDER, LOAN_FIELD_TO],
    [{ reason: ' \t\u0085 ' }, LOAN_REASON, LOAN_FIELD_REASON],
    [{ reason: 'đ'.repeat(201) }, LOAN_REASON, LOAN_FIELD_REASON],
  ] as const)('refuses %j as %s, naming its field', (change, code, field) => {
    expect(loanPreflightOf(ANA, choices, { ...entered, ...change })).toEqual({ ok: false, code });
    expect(loanFieldOf(code)).toBe(field);
    expect(t(loanRefusalMessageKey(code))).not.toBe(loanRefusalMessageKey(code));
  });
});

describe('the choices the card offers', () => {
  const team = (id: string, archived = false): TeamRow => ({ id, organizationId: 'organization-1', name: id, archived });
  const member: MemberListRow = {
    id: ANA,
    organizationId: 'organization-1',
    name: 'Ana Anić',
    username: 'ana',
    email: null,
    role: 'member_role',
    leaveAllowanceDays: 20,
    leaveAllowance: { startingDays: 20, versions: [] },
    leaveYearStart: { month: 1, day: 1 },
    fireRank: null,
    authUserId: 'account-ana',
    statusVersions: [],
    teamVersions: [{ team: { id: A, name: 'Smjena A' }, position: null, effectiveFrom: SEEDED }],
    timeZone: 'Europe/Zagreb',
  };

  it("offers every active team but the member's own today, and nothing while unread or with none left", () => {
    expect(loanChoicesOf(member, [team(A), team(B), team(C, true), team(D)], TODAY)).toEqual([
      { id: B, name: B },
      { id: D, name: D },
    ]);
    expect(loanChoicesOf(member, null, TODAY)).toBeNull();
    expect(loanChoicesOf(member, [team(A)], TODAY)).toBeNull();
    expect(loanChoicesOf(member, [team(A)], null)).toBeNull();
    expect(loanChoicesOf({ ...member, teamVersions: [] }, [team(A)], TODAY)).toEqual([{ id: A, name: A }]);
  });
});

describe('DB refusal: the insert and its answers', () => {
  const draft = { ...SPAN, reason: 'Vježba' };

  function tableAnswering(answer: unknown): LoanTable & { readonly sent: unknown[] } {
    const sent: unknown[] = [];

    return {
      sent,
      insert(values) {
        sent.push(values);

        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as never);
      },
    };
  }

  it("sends 0062's five facts, the range inclusive, and lands", async () => {
    const table = tableAnswering({ error: null });

    expect(await lendMember(table, 'organization-1', draft)).toEqual({ ok: true });
    expect(table.sent).toEqual([
      { organization_id: 'organization-1', member_id: ANA, team_id: C, during: '[2026-10-10,2026-10-12]', reason: 'Vježba' },
    ]);
  });

  it.each([
    [{ code: '23P01', message: 'conflicting key value violates exclusion constraint "team_loans_no_overlap"' }, LOAN_OVERLAP],
    [{ code: '42501', message: 'new row violates row-level security policy' }, LOAN_DENIED],
    [{ code: '23514', message: 'new row violates check constraint "team_loans_reason_length"' }, LOAN_REASON],
    [{ code: '23514', message: 'new row violates check constraint "team_loans_during_in_years"' }, LOAN_FAILED],
    [{ code: '23503' }, LOAN_FAILED],
  ] as const)('maps %j to %s and keeps it in the dialog', async (error, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(loanWriteFailureOf(error)).toBe(code);
    expect(await lendMember(tableAnswering({ error }), 'organization-1', draft)).toEqual({ ok: false, code });
  });

  it('fails without a request on a bad range, and on a thrown or malformed answer', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering({ error: null });

    expect(await lendMember(table, 'organization-1', { ...draft, to: '2026-10-09' })).toEqual({ ok: false, code: LOAN_FAILED });
    expect(table.sent).toEqual([]);
    expect(await lendMember(tableAnswering(new Error('network')), 'organization-1', draft)).toEqual({ ok: false, code: LOAN_FAILED });
    expect(await lendMember(tableAnswering(null), 'organization-1', draft)).toEqual({ ok: false, code: LOAN_FAILED });
    expect(await lendMember(tableAnswering({ error: 'x' }), 'organization-1', draft)).toEqual({ ok: false, code: LOAN_FAILED });
    expect(error).toHaveBeenCalled();
  });
});

describe('Past loan', () => {
  it('derives and sends a loan wholly before today: a late entry is a correction (design note 1)', async () => {
    const past = { ...SPAN, from: '2026-09-10', to: '2026-09-12' };

    expect(loanChangeSnapshotOf(plain, past).ok).toBe(true);
    expect(loanPreflightOf(ANA, [{ id: C, name: 'Smjena C' }], { teamId: C, from: past.from, to: past.to, reason: 'Ispravak' })).toMatchObject({
      ok: true,
    });
  });
});

// ------------------------------------------------------------------ story 18.4

/**
 * Story 18.4's amend, end early and removal, executed (AD-15): every row of
 * the spec's matrix but the DB-only ones (the notices, the definers' own
 * refusals, the archive trigger), over the same fixture. Ana's live loan
 * `LIVE` is to C for 10.–12.
 */
describe('Amend / change team / end early / remove: the edit\'s one "after"', () => {
  const LIVE_ID = '00000000-0000-4000-8000-00000000f0a1';
  const LIVE = { id: LIVE_ID, teamId: C, from: '2026-10-10', to: '2026-10-12' } as const;
  let lent: CalendarSnapshot;

  beforeAll(async () => {
    lent = await snapshotOf({ loans: [calendarLoanRow(LIVE_ID, ANA, C, LIVE.from, LIVE.to)] });
  });

  const amendOf = (span: Partial<LoanSpan>): LoanEdit => ({ memberId: ANA, replaces: LIVE, span: { ...SPAN, ...span } });
  const removal: LoanEdit = { memberId: ANA, replaces: LIVE, span: null };
  const loansOf = (snapshot: CalendarSnapshot) => snapshot.members.find((member) => member.id === ANA)?.loans;

  it('Amend: replaces the live loan by the draft, and previews only the dates the change makes (13.–14.)', () => {
    const applied = loanEditSnapshotOf(lent, amendOf({ to: '2026-10-14' }));

    if (!applied.ok) throw new Error(applied.code);
    expect(loansOf(applied.after)).toEqual([{ id: LOAN_DRAFT_ID, teamId: C, from: '2026-10-10', to: '2026-10-14' }]);

    const preview = shownLoanPreviewOf(lent, amendOf({ to: '2026-10-14' }));

    // 13.: A's Noć lost; 14.: C's Dan gained. Nothing on 10.–12., which stay C's.
    expect(preview?.shifts.map((line) => [line.side, line.date, line.team])).toEqual([
      [LOAN_LOST, '2026-10-13', 'Smjena A'],
      [LOAN_GAINED, '2026-10-14', 'Smjena C'],
    ]);
    expect(loanEditWindowOf(amendOf({ to: '2026-10-14' }))).toEqual({ memberId: ANA, teamId: C, from: '2026-10-10', to: '2026-10-14' });
  });

  it('Change team: C to D is C lost and D gained over the same dates', () => {
    const preview = shownLoanPreviewOf(lent, amendOf({ teamId: D }));
    const lines = (side: string) =>
      preview?.shifts.filter((line) => line.side === side).map((line) => [line.date, line.team]) ?? [];

    // C works Dan 10. and Noć 11.; D (the pilot's fourth team) works on the 10.–12. too, all inside the range.
    expect(lines(LOAN_LOST).length).toBeGreaterThan(0);
    expect(lines(LOAN_LOST).every(([date, team]) => team === 'Smjena C' && date !== undefined && date >= LIVE.from && date <= LIVE.to)).toBe(true);
    expect(lines(LOAN_GAINED).every(([date, team]) => team === 'Smjena D' && date !== undefined && date >= LIVE.from && date <= LIVE.to)).toBe(true);
    expect(lines(LOAN_LOST)).toContainEqual(['2026-10-10', 'Smjena C']);
  });

  it('End early: *Završi danas* only while the loan has begun and ends after today; the amend is an earlier *Do*', () => {
    expect(loanEndsTodayOfferedOf(LIVE, '2026-10-11')).toBe(true);
    expect(loanEndsTodayOfferedOf(LIVE, '2026-10-10')).toBe(true);
    expect(loanEndsTodayOfferedOf(LIVE, '2026-10-12')).toBe(false);
    expect(loanEndsTodayOfferedOf(LIVE, '2026-10-09')).toBe(false);
    expect(loanEndsTodayOfferedOf(LIVE, null)).toBe(false);

    // Ended on the 11th: the 12th returns to A (Dan), the window stays 10.–12.
    const preview = shownLoanPreviewOf(lent, amendOf({ to: '2026-10-11' }));

    expect(preview?.shifts.map((line) => [line.side, line.date, line.team])).toEqual([[LOAN_GAINED, '2026-10-12', 'Smjena A']]);
    expect(loanEditWindowOf(amendOf({ to: '2026-10-11' }))).toEqual({ memberId: ANA, teamId: C, from: '2026-10-10', to: '2026-10-12' });
  });

  it('Remove: the "after" equals the snapshot with no loan ever recorded, and the preview regains the home shifts', () => {
    const applied = loanEditSnapshotOf(lent, removal);

    if (!applied.ok) throw new Error(applied.code);
    expect(loansOf(applied.after)).toEqual([]);

    // Every date derives as with no loan ever recorded (FR-91, DI-2).
    const input = (snapshot: CalendarSnapshot) => {
      const member = snapshot.members.find((candidate) => candidate.id === ANA);

      if (member === undefined) throw new Error('no member');

      return memberScheduleInputOf(snapshot, { memberId: ANA, memberships: member.memberships, statuses: member.statuses });
    };
    expect(memberScheduleOfMonth(input(applied.after), '2026-10')).toEqual(memberScheduleOfMonth(input(plain), '2026-10'));

    const preview = shownLoanPreviewOf(lent, removal);

    expect(preview?.shifts.some((line) => line.side === LOAN_GAINED && line.team === 'Smjena A' && line.date === '2026-10-12')).toBe(true);
    expect(preview?.shifts.some((line) => line.side === LOAN_LOST && line.team === 'Smjena C')).toBe(true);
    expect(loanEditWindowOf(removal)).toEqual({ memberId: ANA, teamId: C, from: LIVE.from, to: LIVE.to });
  });

  it('Overlap: an amend meeting another live loan is refused, but never by its own loan', async () => {
    expect(loanEditSnapshotOf(lent, amendOf({ from: '2026-10-11', to: '2026-10-13' })).ok).toBe(true);

    const two = await snapshotOf({
      loans: [calendarLoanRow(LIVE_ID, ANA, C, LIVE.from, LIVE.to), calendarLoanRow('00000000-0000-4000-8000-00000000f0a2', ANA, D, '2026-10-14', '2026-10-15')],
    });

    expect(loanEditSnapshotOf(two, amendOf({ to: '2026-10-14' }))).toEqual({ ok: false, code: LOAN_OVERLAP });
  });

  it('Home / archived: the amended team is refused as a lend\'s is', () => {
    expect(loanEditSnapshotOf(lent, amendOf({ teamId: A }))).toEqual({ ok: false, code: LOAN_HOME });

    const archived = { ...lent, teams: lent.teams.map((team) => (team.id === D ? { ...team, archived: true } : team)) };

    expect(loanEditSnapshotOf(archived, amendOf({ teamId: D }))).toEqual({ ok: false, code: LOAN_ARCHIVED });
  });

  it('Gone: a loan removed or amended meanwhile is stale, for the amend and the removal', async () => {
    expect(loanEditSnapshotOf(plain, amendOf({}))).toEqual({ ok: false, code: LOAN_STALE });
    expect(loanEditSnapshotOf(plain, removal)).toEqual({ ok: false, code: LOAN_STALE });
    expect(loanEditSnapshotOf(lent, { ...removal, memberId: 'gone' })).toEqual({ ok: false, code: LOAN_STALE });
    expect(shownLoanPreviewOf(plain, removal)).toBeNull();
    expect(
      await loanErasureCheckOf(() => Promise.resolve({ calendar: plain, records: [], resolutions: [] }), removal, true),
    ).toEqual({ kind: CHECK_REFUSED, code: LOAN_STALE });
    expect(loanWriteFailureOf({ code: 'P0002', message: 'TEAM_LOAN_NOT_LIVE' })).toBe(LOAN_STALE);
    expect(loanRefusalMessageKey(LOAN_STALE)).toBe('loans.error.stale');
  });

  it("Erasure: a removal takes Ana off C's Noć of the 11th, where she has leave, and names that conflict", async () => {
    const check = await loanErasureCheckOf(
      () => Promise.resolve({ calendar: lent, records: [recordOf('leave-11', '2026-10-11', '2026-10-12')], resolutions: [] }),
      removal,
      true,
    );

    if (check.kind !== CHECK_READY) throw new Error(check.kind);
    expect(check.rows.map((row) => [row.memberName, row.date, row.teamName])).toEqual([['Ana Anić', '2026-10-11', 'Smjena C']]);

    // Leave on A's Dan of the 12th, which the removal gives back: a new conflict, nothing erased.
    const none = await loanErasureCheckOf(
      () => Promise.resolve({ calendar: lent, records: [recordOf('leave-12', '2026-10-12', '2026-10-13')], resolutions: [] }),
      removal,
      true,
    );

    expect(none).toEqual({ kind: CHECK_READY, rows: [] });
  });

  it('Short-staffed: derived over the edit\'s window, for both teams', async () => {
    const minimum = await snapshotOf({ loans: [calendarLoanRow(LIVE_ID, ANA, C, LIVE.from, LIVE.to)], minimumMembers: 1 });
    const report = shownLoanShortStaffedOf(minimum, amendOf({ teamId: D }), LEAVE_READ);

    expect(report?.kind).toBe(SHORT_STAFFED_KNOWN);
    expect(shownLoanShortStaffedOf(minimum, null, LEAVE_READ)).toBeNull();
  });

  it('Inactive: counts the new loan\'s dates the member is inactive on, warns, and never refuses', async () => {
    const inactive = await snapshotOf({ statuses: [statusRow(ANA, false, '2026-10-11')] });

    expect(loanInactiveDaysOf(inactive, SPAN)).toBe(2);
    expect(loanInactiveDaysOf(plain, SPAN)).toBe(0);
    expect(loanInactiveDaysOf(inactive, { memberId: ANA, replaces: LIVE, span: null })).toBe(0);
    // An amend counts only the dates its old loan did not cover: 13.–14. here.
    expect(loanInactiveDaysOf(inactive, { memberId: ANA, replaces: LIVE, span: { ...SPAN, to: '2026-10-14' } })).toBe(2);
    expect(loanInactiveDaysOf(inactive, { memberId: ANA, replaces: LIVE, span: SPAN })).toBe(0);
    expect(loanEditSnapshotOf(inactive, SPAN).ok).toBe(true);
    expect(shownLoanPreviewOf(inactive, SPAN)?.inactiveDays).toBe(2);
    expect(t('loans.inactive', { count: 2 })).toBe('2 dana posudbe osoba nije aktivna: tada se ništa ne mijenja.');
    expect(t('loans.inactive', { count: 1 })).toContain('1 dan ');
  });

  it("lists the member's live loans by first date with their team, and offers the loan's own team in an amend", async () => {
    const two = await snapshotOf({
      loans: [calendarLoanRow('00000000-0000-4000-8000-00000000f0a2', ANA, D, '2026-10-20', '2026-10-21'), calendarLoanRow(LIVE_ID, ANA, C, LIVE.from, LIVE.to)],
    });

    expect(memberLoansOf(two, ANA).map(({ loan, team }) => [loan.id, team])).toEqual([
      [LIVE_ID, 'Smjena C'],
      ['00000000-0000-4000-8000-00000000f0a2', 'Smjena D'],
    ]);
    expect(memberLoansOf(null, ANA)).toEqual([]);
    expect(memberLoansOf(two, 'gone')).toEqual([]);

    const teams = [A, B, C, D].map((id): TeamRow => ({ id, organizationId: 'organization-1', name: id, archived: false }));
    const ana: MemberListRow = {
      id: ANA,
      organizationId: 'organization-1',
      name: 'Ana Anić',
      username: 'ana',
      email: null,
      role: 'member_role',
      leaveAllowanceDays: 20,
      leaveAllowance: { startingDays: 20, versions: [] },
      leaveYearStart: { month: 1, day: 1 },
      fireRank: null,
      authUserId: 'account-ana',
      statusVersions: [],
      teamVersions: [{ team: { id: A, name: 'Smjena A' }, position: null, effectiveFrom: SEEDED }],
      timeZone: 'Europe/Zagreb',
    };
    // A loan to A, the member's team today (a move after the loan): A is offered too.
    const offered = loanAmendChoicesOf(ana, teams, TODAY, { ...LIVE, teamId: A })?.map((choice) => choice.id) ?? [];

    expect(offered).toContain(A);
    expect(loanAmendChoicesOf(ana, teams, TODAY, LIVE)?.map((choice) => choice.id)).not.toContain(A);
    expect(loanAmendChoicesOf(ana, null, TODAY, LIVE)).toBeNull();
    // No team left to offer: empty, not null, so the dialog still opens for a removal (review).
    expect(loanAmendChoicesOf(ana, [{ id: A, organizationId: 'organization-1', name: A, archived: false }], TODAY, LIVE)).toEqual([]);
  });

  it('preflights an amend: an empty reason keeps the stored one (null), a typed one is checked', () => {
    const choices = [{ id: C, name: 'Smjena C' }];
    const entered = { teamId: C, from: SPAN.from, to: SPAN.to, reason: '   ' };

    expect(loanAmendPreflightOf(ANA, choices, entered)).toEqual({ ok: true, draft: { ...SPAN, reason: null } });
    expect(loanAmendPreflightOf(ANA, choices, { ...entered, reason: ' Novi ' })).toEqual({ ok: true, draft: { ...SPAN, reason: 'Novi' } });
    expect(loanAmendPreflightOf(ANA, choices, { ...entered, reason: 'x'.repeat(201) })).toEqual({ ok: false, code: LOAN_REASON });
    expect(loanAmendPreflightOf(ANA, choices, { ...entered, to: '2026-10-09' })).toEqual({ ok: false, code: LOAN_ORDER });
    // Nothing to save: the stored team and dates, and no new reason (review).
    const stored = { id: 'loan-1', teamId: C, from: SPAN.from, to: SPAN.to };
    expect(loanAmendPreflightOf(ANA, choices, entered, stored)).toEqual({ ok: false, code: LOAN_UNCHANGED });
    expect(loanAmendPreflightOf(ANA, choices, { ...entered, reason: 'Novi' }, stored).ok).toBe(true);
    expect(loanAmendPreflightOf(ANA, choices, { ...entered, to: '2026-10-11' }, stored).ok).toBe(true);
    expect(loanRefusalMessageKey(LOAN_UNCHANGED)).toBe('loans.error.unchanged');
  });

  it('reads each write as its edit, and says what landed', () => {
    const draft = { ...SPAN, reason: 'x' };

    expect(loanWriteEditOf({ kind: LOAN_LEND, draft })).toEqual({ memberId: ANA, replaces: null, span: draft });
    expect(loanWriteEditOf({ kind: LOAN_AMEND, loan: LIVE, draft: { ...draft, reason: null } }).replaces).toBe(LIVE);
    expect(loanWriteEditOf({ kind: LOAN_REMOVE, memberId: ANA, loan: LIVE })).toEqual(removal);
    expect(([LOAN_LEND, LOAN_AMEND, LOAN_REMOVE] as const).map((kind) => t(loanSavedMessageKey(kind)))).toEqual([
      'Posudba je spremljena.',
      'Posudba je izmijenjena.',
      'Posudba je uklonjena.',
    ]);
  });
});

describe("DB refusal: 0064's two definers and their answers", () => {
  function rpcAnswering(answer: unknown): LoanRpc & { readonly sent: unknown[] } {
    const sent: unknown[] = [];

    return {
      sent,
      rpc(fn: string, args: unknown) {
        sent.push([fn, args]);

        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as never);
      },
    } as LoanRpc & { readonly sent: unknown[] };
  }

  const draft = { ...SPAN, reason: 'Vježba' };

  it('amends with the team, the inclusive dates and the reason, or none to keep it, and lands on the replacement id', async () => {
    const client = rpcAnswering({ data: 'replacement-id', error: null });

    expect(await amendLoan(client, 'loan-1', draft)).toEqual({ ok: true });
    expect(await amendLoan(client, 'loan-1', { ...draft, reason: null })).toEqual({ ok: true });
    expect(client.sent).toEqual([
      [AMEND_TEAM_LOAN_FUNCTION, { p_loan_id: 'loan-1', p_team_id: C, p_from: SPAN.from, p_to: SPAN.to, p_reason: 'Vježba' }],
      [AMEND_TEAM_LOAN_FUNCTION, { p_loan_id: 'loan-1', p_team_id: C, p_from: SPAN.from, p_to: SPAN.to }],
    ]);
  });

  it('removes by the loan id alone', async () => {
    const client = rpcAnswering({ data: null, error: null });

    expect(await removeLoan(client, 'loan-1')).toEqual({ ok: true });
    expect(client.sent).toEqual([[REMOVE_TEAM_LOAN_FUNCTION, { p_loan_id: 'loan-1' }]]);
  });

  it.each([
    [{ code: '23P01' }, LOAN_OVERLAP],
    [{ code: '42501', message: 'TEAM_LOAN_AMEND_REFUSED' }, LOAN_DENIED],
    // The amend's own team refusal comes after the fresh check: the screen is behind, and re-reads.
    [{ code: '42501', message: 'TEAM_LOAN_TEAM_REFUSED' }, LOAN_STALE],
    [{ code: 'P0002', message: 'TEAM_LOAN_NOT_LIVE' }, LOAN_STALE],
    [{ code: '23514', message: 'new row violates check constraint "team_loans_reason_length"' }, LOAN_REASON],
    [{ code: '22000' }, LOAN_FAILED],
  ])('maps a refused call %o to %s, for the amend and the removal', async (error, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await amendLoan(rpcAnswering({ data: null, error }), 'loan-1', draft)).toEqual({ ok: false, code });
    expect(await removeLoan(rpcAnswering({ data: null, error }), 'loan-1')).toEqual({ ok: false, code });
  });

  it('fails without a request on a bad range, and on a thrown, malformed or id-less answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = rpcAnswering({ data: 'x', error: null });

    expect(await amendLoan(client, 'loan-1', { ...draft, to: '2026-10-09' })).toEqual({ ok: false, code: LOAN_FAILED });
    expect(client.sent).toEqual([]);
    expect(await amendLoan(rpcAnswering(new Error('network')), 'loan-1', draft)).toEqual({ ok: false, code: LOAN_FAILED });
    expect(await amendLoan(rpcAnswering(null), 'loan-1', draft)).toEqual({ ok: false, code: LOAN_FAILED });
    expect(await amendLoan(rpcAnswering({ data: null, error: null }), 'loan-1', draft)).toEqual({ ok: false, code: LOAN_FAILED });
    expect(await removeLoan(rpcAnswering({ error: 'x' }), 'loan-1')).toEqual({ ok: false, code: LOAN_FAILED });
  });
});
