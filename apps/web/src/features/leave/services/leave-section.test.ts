import { leaveBalanceOf, leaveCostOf, leavePreviewOf, type LeavePreview, type LeaveRange } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf } from '@/features/calendar/utils/month';
import type { LeaveRecordsState } from '@/features/leave/services/leave-list';
import {
  LEAVE_ABSENT,
  LEAVE_FROM_FIELD,
  LEAVE_LOADING,
  LEAVE_PREVIEW_READY,
  LEAVE_PREVIEW_REASON,
  LEAVE_ERROR_ID,
  LEAVE_RANGE_INCOMPLETE,
  LEAVE_RANGE_REFUSED,
  LEAVE_RANGE_REVERSED,
  LEAVE_RANGE_TOO_LONG,
  LEAVE_READY,
  LEAVE_REASON_ID,
  LEAVE_TO_FIELD,
  LEAVE_UNAVAILABLE,
  LEAVE_UNSCHEDULED,
  leaveBaseMessageKey,
  leaveConflictOf,
  leaveDescribedByOf,
  leaveInYearChargeOf,
  leaveInvalidFieldOf,
  leaveOverlapNoteShown,
  leavePreviewStateOf,
  leaveReasonMessageKey,
  leaveRefusalMessageKey,
  leaveRefusalValuesOf,
  leaveSavedOf,
  memberLeaveBaseOf,
  type LeaveCalendarSource,
  type LeaveMembersSource,
  type LeaveOrganizationSource,
  type MemberLeaveBase,
  type MemberLeaveSources,
} from '@/features/leave/services/leave-section';
import { LEAVE_DENIED, LEAVE_FAILED, LEAVE_OVERLAP } from '@/features/leave/services/leave-write';
import { initLocalization, t } from '@/lib/i18n';
import { formatIsoDate } from '@/lib/i18n/format';
import {
  PILOT,
  UJ5,
  VIEWER_MEMBER,
  calendarOrganizationRow,
  calendarTableOf,
  membersAnswerOf,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 5.1c's view model, executed (AD-15): every row of the spec's matrix,
 * over both fixtures, and every figure compared against `@shift/domain`
 * itself — the card shows the domain's numbers and never its own.
 */

/** 2026-09-26 in Zagreb: the fixtures' today. */
const NOW = new Date('2026-09-26T10:00:00Z');

async function snapshotOf(
  rows: FixtureRows,
  { viewers = null as readonly Record<string, unknown>[] | null } = {},
): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    { data: [calendarOrganizationRow(rows, { viewers })], error: null, count: 1 },
    membersAnswerOf(),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

let pilot: CalendarSnapshot;
let uj5: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf(PILOT);
  uj5 = await snapshotOf(UJ5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const MEMBERS: LeaveMembersSource = {
  members: [{ id: VIEWER_MEMBER, leaveAllowanceDays: 20 }],
  refusal: null,
  loading: false,
  paused: false,
};

const ORGANIZATION: LeaveOrganizationSource = {
  data: { ok: true, snapshot: { leaveYearStartMonth: 1, leaveYearStartDay: 1 } },
  isPending: false,
  isError: false,
  fetchStatus: 'idle',
};

function calendarOf(snapshot: CalendarSnapshot): LeaveCalendarSource {
  return { snapshot, loading: false };
}

function recordsOf(records: readonly LeaveRange[]): LeaveRecordsState {
  return { records, loading: false, refreshing: false };
}

function sourcesOf(snapshot: CalendarSnapshot, overrides: Partial<MemberLeaveSources> = {}): MemberLeaveSources {
  return {
    members: MEMBERS,
    calendar: calendarOf(snapshot),
    organization: ORGANIZATION,
    records: recordsOf([]),
    ...overrides,
  };
}

function readyOf(base: MemberLeaveBase): Extract<MemberLeaveBase, { kind: typeof LEAVE_READY }> {
  if (base.kind !== LEAVE_READY) throw new Error(`not ready: ${base.kind}`);

  return base;
}

/** The pilot's worked example: 10.09–14.09 over Dan, Noć, Slobodno, Slobodno, Dan. */
const WORKED: LeaveRange = { from: '2026-09-10', to: '2026-09-14' };

describe('the figures', () => {
  it('shows 20 / 3 / 17 for an allowance of 20 and one record costing 3 this year, as the domain does', () => {
    const base = readyOf(memberLeaveBaseOf(sourcesOf(pilot, { records: recordsOf([WORKED]) }), VIEWER_MEMBER, NOW));
    const viewer = pilot.members.find((member) => member.id === VIEWER_MEMBER);

    if (viewer === undefined) throw new Error('the fixture viewer is missing');

    const input = memberScheduleInputOf(pilot, { ...viewer, memberId: viewer.id });

    expect(leaveCostOf(input, WORKED.from, WORKED.to)).toBe(3);
    expect(base.balance).toEqual({ allowanceDays: 20, usedDays: 3, balanceDays: 17 });
    expect(base.balance).toEqual(leaveBalanceOf(base.input));
    expect(base.input).toMatchObject({
      allowanceDays: 20,
      records: [WORKED],
      today: '2026-09-26',
      leaveYearStart: { month: 1, day: 1 },
    });
    expect(base.organizationId).toBe(pilot.organizationId);
  });

  it('counts the UJ5 fixture through the same rule', () => {
    const record = { from: '2026-09-26', to: '2026-09-30' };
    const base = readyOf(memberLeaveBaseOf(sourcesOf(uj5, { records: recordsOf([record]) }), VIEWER_MEMBER, NOW));

    // Jutarnja, Popodnevna, Noćna, Slobodno, Slobodno.
    expect(base.balance).toEqual({ allowanceDays: 20, usedDays: 3, balanceDays: 17 });
    expect(base.balance).toEqual(leaveBalanceOf(base.input));
  });

  it('counts only the dates inside the current leave year', () => {
    const organization: LeaveOrganizationSource = {
      ...ORGANIZATION,
      data: { ok: true, snapshot: { leaveYearStartMonth: 9, leaveYearStartDay: 12 } },
    };
    const base = readyOf(
      memberLeaveBaseOf(sourcesOf(pilot, { organization, records: recordsOf([WORKED]) }), VIEWER_MEMBER, NOW),
    );

    // From 12.09 the range holds Slobodno, Slobodno, Dan.
    expect(base.balance).toEqual({ allowanceDays: 20, usedDays: 1, balanceDays: 19 });
    expect(base.balance).toEqual(leaveBalanceOf(base.input));
  });

  it.each([
    ['the member list', { members: { ...MEMBERS, loading: true, members: null } }],
    ['the calendar', { calendar: { snapshot: null, loading: true } }],
    ['the organization', { organization: { data: undefined, isPending: true, isError: false, fetchStatus: 'fetching' } }],
    ['the records', { records: { records: null, loading: true, refreshing: false } }],
  ] as const)('is loading while %s is', (_name, overrides) => {
    expect(memberLeaveBaseOf(sourcesOf(pilot, overrides), VIEWER_MEMBER, NOW)).toEqual({ kind: LEAVE_LOADING });
  });

  it.each([
    ['the records read fails', { records: { records: null, loading: false, refreshing: false } }],
    ['the calendar read fails', { calendar: { snapshot: null, loading: false } }],
    [
      'the organization read fails',
      { organization: { data: undefined, isPending: false, isError: true, fetchStatus: 'idle' } },
    ],
    [
      'the organization answers a refusal',
      { organization: { data: { ok: false }, isPending: false, isError: false, fetchStatus: 'idle' } },
    ],
    [
      'the organization refetch is paused offline',
      { organization: { ...ORGANIZATION, fetchStatus: 'paused' } },
    ],
    ['the member list is refused', { members: { members: null, refusal: 'MEMBERS_REFUSED', loading: false, paused: false } }],
    ['the member list refetch is paused offline', { members: { ...MEMBERS, paused: true } }],
  ] as const)('is unavailable when %s', (_name, overrides) => {
    expect(memberLeaveBaseOf(sourcesOf(pilot, overrides), VIEWER_MEMBER, NOW)).toEqual({ kind: LEAVE_UNAVAILABLE });
  });

  it('is unavailable over a failure even while another read is still loading', () => {
    expect(
      memberLeaveBaseOf(
        sourcesOf(pilot, {
          records: { records: null, loading: false, refreshing: false },
          calendar: { snapshot: null, loading: true },
        }),
        VIEWER_MEMBER,
        NOW,
      ),
    ).toEqual({ kind: LEAVE_UNAVAILABLE });
  });

  it('is unscheduled, not unavailable, when the calendar holds no such member', () => {
    const members = { ...MEMBERS, members: [{ id: 'someone-else', leaveAllowanceDays: 20 }] };

    expect(memberLeaveBaseOf(sourcesOf(pilot, { members }), 'someone-else', NOW)).toEqual({
      kind: LEAVE_UNSCHEDULED,
    });
  });

  it('is unscheduled when the member has never been on a team', async () => {
    const teamless = await snapshotOf(PILOT, { viewers: [viewerRow([])] });

    expect(memberLeaveBaseOf(sourcesOf(teamless), VIEWER_MEMBER, NOW)).toEqual({ kind: LEAVE_UNSCHEDULED });
  });

  it('gives unscheduled and unavailable their own lines', () => {
    expect(leaveBaseMessageKey(LEAVE_UNSCHEDULED)).toBe('ljudi.leaveRecord.unscheduled');
    expect(leaveBaseMessageKey(LEAVE_UNAVAILABLE)).toBe('ljudi.leaveRecord.unavailable');
  });

  it('is unavailable when the records breach a domain precondition', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const records = recordsOf([WORKED, { from: '2026-09-12', to: '2026-09-20' }]);

    expect(memberLeaveBaseOf(sourcesOf(pilot, { records }), VIEWER_MEMBER, NOW)).toEqual({ kind: LEAVE_UNAVAILABLE });
  });

  it('is absent when the list holds no such member', () => {
    expect(memberLeaveBaseOf(sourcesOf(pilot), 'not-a-member', NOW)).toEqual({ kind: LEAVE_ABSENT });
  });
});

describe('the preview', () => {
  function baseOf(records: readonly LeaveRange[] = [], allowanceDays = 20) {
    return readyOf(
      memberLeaveBaseOf(
        sourcesOf(pilot, {
          records: recordsOf(records),
          members: { ...MEMBERS, members: [{ id: VIEWER_MEMBER, leaveAllowanceDays: allowanceDays }] },
        }),
        VIEWER_MEMBER,
        NOW,
      ),
    );
  }

  it('costs the worked example 3 and leaves 14 after a record costing 3, as the domain does', () => {
    const base = baseOf([{ from: '2026-09-02', to: '2026-09-06' }]);
    const state = leavePreviewStateOf(base.input, '2026-09-18', '2026-09-22');

    if (state.kind !== LEAVE_PREVIEW_READY) throw new Error(state.kind);

    expect(base.balance.balanceDays).toBe(17);
    expect(state.range).toEqual({ from: '2026-09-18', to: '2026-09-22' });
    expect(state.preview.costDays).toBe(3);
    expect(state.preview.balanceAfterDays).toBe(14);
    expect(state.preview.exceedsBalance).toBe(false);
    expect(state.preview.overlapsRecord).toBe(false);
    expect(state.preview).toEqual(leavePreviewOf({ ...base.input, range: state.range }));
  });

  it('notes an overlap with an existing record', () => {
    const state = leavePreviewStateOf(baseOf([WORKED]).input, '2026-09-13', '2026-09-18');

    if (state.kind !== LEAVE_PREVIEW_READY) throw new Error(state.kind);

    expect(state.preview.overlapsRecord).toBe(true);
  });

  it('notes an over-balance range as −2 for a cost of 3 over a balance of 1, and refuses nothing', () => {
    const state = leavePreviewStateOf(baseOf([], 1).input, WORKED.from, WORKED.to);

    if (state.kind !== LEAVE_PREVIEW_READY) throw new Error(state.kind);

    expect(state.preview.costInYearDays).toBe(3);
    expect(state.preview.exceedsBalance).toBe(true);
    expect(state.preview.balanceAfterDays).toBe(-2);
    expect(t('ljudi.leaveRecord.exceeds', { count: state.preview.balanceAfterDays })).toContain('−2 dana');
  });

  it.each([
    ['nothing entered', '', '', LEAVE_RANGE_INCOMPLETE, LEAVE_FROM_FIELD],
    ['od only', '2026-09-10', '', LEAVE_RANGE_INCOMPLETE, LEAVE_TO_FIELD],
    ['do only', '', '2026-09-10', LEAVE_RANGE_INCOMPLETE, LEAVE_FROM_FIELD],
    ['an impossible date', '2026-02-30', '2026-03-02', LEAVE_RANGE_INCOMPLETE, LEAVE_FROM_FIELD],
    ['do before od', '2026-09-14', '2026-09-10', LEAVE_RANGE_REVERSED, LEAVE_TO_FIELD],
    ['367 days', '2026-01-01', '2027-01-02', LEAVE_RANGE_TOO_LONG, LEAVE_TO_FIELD],
  ] as const)('gives a reason and no preview for %s', (_name, from, to, reason, field) => {
    expect(leavePreviewStateOf(baseOf().input, from, to)).toEqual({ kind: LEAVE_PREVIEW_REASON, reason, field });
  });

  it('refuses a range the domain will not cost with its own reason on the od field, never the load failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A breached precondition the base did not check: a record overlapping another.
    const input = { ...baseOf().input, records: [WORKED, { from: '2026-09-12', to: '2026-09-20' }] };

    expect(leavePreviewStateOf(input, '2026-10-01', '2026-10-02')).toEqual({
      kind: LEAVE_PREVIEW_REASON,
      reason: LEAVE_RANGE_REFUSED,
      field: LEAVE_FROM_FIELD,
    });
    expect(leaveReasonMessageKey(LEAVE_RANGE_REFUSED)).toBe('ljudi.leaveRecord.refused');
  });

  it('shows the part charged to this leave year when a range crosses its end', () => {
    // Dan on 2026-12-27 (step 0): 27 Dan, 28 Noć, 29 Sl, 30 Sl, 31 Dan | 01 Noć.
    const state = leavePreviewStateOf(baseOf().input, '2026-12-27', '2027-01-01');

    if (state.kind !== LEAVE_PREVIEW_READY) throw new Error(state.kind);

    expect(state.preview.costDays).toBe(4);
    expect(state.preview.costInYearDays).toBe(3);
    expect(state.preview.balanceAfterDays).toBe(17);
    expect(leaveInYearChargeOf(state.preview)).toBe(3);
    expect(t('ljudi.leaveRecord.costInYear', { count: 3 })).toContain('3 dana');
  });

  it('shows no in-year line when the whole range is charged', () => {
    const state = leavePreviewStateOf(baseOf().input, WORKED.from, WORKED.to);

    if (state.kind !== LEAVE_PREVIEW_READY) throw new Error(state.kind);

    expect(leaveInYearChargeOf(state.preview)).toBeNull();
  });

  it('previews 366 days, the longest range', () => {
    expect(leavePreviewStateOf(baseOf().input, '2026-01-01', '2027-01-01').kind).toBe(LEAVE_PREVIEW_READY);
  });

  it('names every reason with its own line', () => {
    expect(leaveReasonMessageKey(LEAVE_RANGE_INCOMPLETE)).toBe('ljudi.leaveRecord.incomplete');
    expect(leaveReasonMessageKey(LEAVE_RANGE_REVERSED)).toBe('ljudi.leaveRecord.reversed');
    expect(leaveReasonMessageKey(LEAVE_RANGE_TOO_LONG)).toBe('ljudi.leaveRecord.tooLong');
  });
});

describe('the outcome', () => {
  function inputOf(allowanceDays: number) {
    return readyOf(
      memberLeaveBaseOf(
        sourcesOf(pilot, { members: { ...MEMBERS, members: [{ id: VIEWER_MEMBER, leaveAllowanceDays: allowanceDays }] } }),
        VIEWER_MEMBER,
        NOW,
      ),
    ).input;
  }

  it('says what a landed save cost, and the over-balance warning with its number, from the fresh records', () => {
    expect(leaveSavedOf(inputOf(1), [WORKED], WORKED)).toEqual({ costDays: 3, overBalanceDays: -2 });
    expect(leaveSavedOf(inputOf(20), [WORKED], WORKED)).toEqual({ costDays: 3, overBalanceDays: null });
    expect(t('ljudi.leaveRecord.savedExceeds', { count: -2 })).toContain('−2 dana');
    expect(t('ljudi.leaveRecord.saved', { count: 3 })).toContain('3 dana');
  });

  it('charges the balance the fresh records leave, other records included', () => {
    const earlier = { from: '2026-09-02', to: '2026-09-06' };

    // Allowance 4: the earlier record leaves 1, so this one goes 2 over.
    expect(leaveSavedOf(inputOf(4), [earlier, WORKED], WORKED)).toEqual({ costDays: 3, overBalanceDays: -2 });
    // Allowance 6: it leaves 3, so this one fits exactly.
    expect(leaveSavedOf(inputOf(6), [earlier, WORKED], WORKED)).toEqual({ costDays: 3, overBalanceDays: null });
  });

  it('gives the plain line when the re-read did not answer or lacks the saved record', () => {
    expect(leaveSavedOf(inputOf(1), null, WORKED)).toEqual({ costDays: null, overBalanceDays: null });
    expect(leaveSavedOf(inputOf(1), [], WORKED)).toEqual({ costDays: null, overBalanceDays: null });
  });

  it('names the conflicting record with its dates and an en dash', () => {
    const failure = { code: LEAVE_OVERLAP, conflict: WORKED } as const;
    const values = leaveRefusalValuesOf(failure);

    expect(leaveRefusalMessageKey(failure)).toBe('ljudi.leaveRecord.overlapConflict');
    expect(values).toEqual({ from: formatIsoDate(WORKED.from), to: formatIsoDate(WORKED.to) });
    if (values === undefined) throw new Error('no values for a named conflict');

    expect(t(leaveRefusalMessageKey(failure), values)).toContain(`${values.from}–${values.to}`);
  });

  it('falls back to a generic overlap line when the conflict could not be read', () => {
    expect(leaveRefusalMessageKey({ code: LEAVE_OVERLAP, conflict: null })).toBe('ljudi.leaveRecord.overlap');
  });

  it('gives denied and failed their own lines', () => {
    expect(leaveRefusalMessageKey({ code: LEAVE_DENIED, conflict: null })).toBe('ljudi.leaveRecord.denied');
    expect(leaveRefusalMessageKey({ code: LEAVE_FAILED, conflict: null })).toBe('ljudi.leaveRecord.failed');
    expect(leaveRefusalValuesOf({ code: LEAVE_DENIED, conflict: null })).toBeUndefined();
    expect(leaveRefusalValuesOf({ code: LEAVE_FAILED, conflict: null })).toBeUndefined();
    expect(leaveRefusalValuesOf({ code: LEAVE_OVERLAP, conflict: null })).toBeUndefined();
  });

  it('reads the conflict off an overlap outcome alone', () => {
    expect(leaveConflictOf({ ok: false, code: LEAVE_OVERLAP, conflict: WORKED })).toEqual(WORKED);
    expect(leaveConflictOf({ ok: false, code: LEAVE_OVERLAP, conflict: null })).toBeNull();
    expect(leaveConflictOf({ ok: false, code: LEAVE_DENIED })).toBeNull();
    expect(leaveConflictOf({ ok: true })).toBeNull();
  });

  it('hides the preview overlap note while an overlap alert says it', () => {
    const overlapping = { overlapsRecord: true } as LeavePreview;

    expect(leaveOverlapNoteShown(overlapping, null)).toBe(true);
    expect(leaveOverlapNoteShown(overlapping, { code: LEAVE_OVERLAP, conflict: WORKED })).toBe(false);
    expect(leaveOverlapNoteShown(overlapping, { code: LEAVE_FAILED, conflict: null })).toBe(true);
    expect(leaveOverlapNoteShown({ overlapsRecord: false } as LeavePreview, null)).toBe(false);
  });

  it('describes the od field by a standing refusal, and a marked field by its reason', () => {
    const overlap = { code: LEAVE_OVERLAP, conflict: null } as const;

    expect(leaveDescribedByOf(LEAVE_FROM_FIELD, overlap, LEAVE_FROM_FIELD)).toBe(LEAVE_ERROR_ID);
    expect(leaveDescribedByOf(LEAVE_TO_FIELD, overlap, LEAVE_FROM_FIELD)).toBeUndefined();
    expect(leaveDescribedByOf(LEAVE_TO_FIELD, null, LEAVE_TO_FIELD)).toBe(LEAVE_REASON_ID);
    expect(leaveDescribedByOf(LEAVE_FROM_FIELD, null, LEAVE_TO_FIELD)).toBeUndefined();
    expect(leaveDescribedByOf(LEAVE_FROM_FIELD, null, null)).toBeUndefined();
  });

  it('marks the od field after an overlap, else the field a refused save named', () => {
    expect(leaveInvalidFieldOf({ code: LEAVE_OVERLAP, conflict: null }, LEAVE_TO_FIELD)).toBe(LEAVE_FROM_FIELD);
    expect(leaveInvalidFieldOf({ code: LEAVE_FAILED, conflict: null }, null)).toBeNull();
    expect(leaveInvalidFieldOf(null, LEAVE_TO_FIELD)).toBe(LEAVE_TO_FIELD);
    expect(leaveInvalidFieldOf(null, null)).toBeNull();
  });
});
