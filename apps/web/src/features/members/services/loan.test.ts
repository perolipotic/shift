import { memberScheduleOfMonth } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf } from '@/features/calendar/utils/month';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE, type ErasureReads } from '@/features/conflicts/services/erasure-check';
import type { MemberListRow } from '@/features/members/services/list';
import {
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
  LOAN_LOST,
  LOAN_ORDER,
  LOAN_OVERLAP,
  LOAN_REASON,
  LOAN_STALE,
  LOAN_TO_INVALID,
  LOAN_UNPICKED,
  LOAN_UNPICKED_VALUE,
  enteredSpanOf,
  lendMember,
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
  readonly minimumMembers?: number;
}

async function snapshotOf({ versions = [], overrides = [], rosterOverrides = [], loans = [], minimumMembers }: Setup = {}): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(B, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, B, SEEDED), memberMembershipRow(ANA, A, SEEDED), ...versions],
          statuses: [],
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
