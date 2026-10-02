import { leaveBalanceOf, leaveCostOf, leavePreviewOf, type LeavePreview, type LeaveRange } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf } from '@/features/calendar/utils/month';
import type { LeaveRecord, LeaveRecordsState } from '@/features/leave/services/leave-list';
import {
  LEAVE_ABSENT,
  LEAVE_AMEND_ACTION,
  LEAVE_FROM_FIELD,
  LEAVE_LOADING,
  LEAVE_PREVIEW_READY,
  LEAVE_PREVIEW_REASON,
  LEAVE_ERROR_ID,
  LEAVE_RANGE_INCOMPLETE,
  LEAVE_RANGE_REFUSED,
  LEAVE_RANGE_REVERSED,
  LEAVE_RANGE_TOO_LONG,
  LEAVE_RANGE_UNCHANGED,
  LEAVE_READY,
  LEAVE_REASON_ID,
  LEAVE_RECORD_ACTION,
  LEAVE_REMOVE_ACTION,
  LEAVE_TO_FIELD,
  LEAVE_UNAVAILABLE,
  LEAVE_UNSCHEDULED,
  leaveAmendedOf,
  leaveBaseMessageKey,
  leaveConfirmFailureOf,
  leaveConflictOf,
  leaveDescribedByOf,
  leaveFormFailureOf,
  leaveHandoffKeyOf,
  leaveHandoffOf,
  leaveHandoffOpeningOf,
  leaveHandoffOriginOf,
  leaveInYearChargeOf,
  leaveInvalidFieldOf,
  leaveListFailureOf,
  leaveOverlapNoteShown,
  leavePreviewStateOf,
  leaveRangeValuesOf,
  leaveReasonMessageKey,
  leaveRefusalMessageKey,
  leaveRefusalValuesOf,
  leaveRemovePromptMessageKey,
  leaveSavedOf,
  memberLeaveBaseOf,
  type LeaveCalendarSource,
  type LeaveMembersSource,
  type LeaveOrganizationSource,
  type MemberLeaveBase,
  type MemberLeaveSources,
  LEAVE_HANDOFF_ORIGIN_STATE,
  LEAVE_HANDOFF_STATE,
  withLeaveHandoff,
  withoutLeaveHandoffOpening,
} from '@/features/leave/services/leave-section';
import { LEAVE_DENIED, LEAVE_FAILED, LEAVE_GONE, LEAVE_OVERLAP } from '@/features/leave/services/leave-write';
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

/** The ranges as live records, each with an id of its own unless it carries one. */
function recordsOf(records: readonly (LeaveRange | LeaveRecord)[]): LeaveRecordsState {
  return {
    records: records.map((record, index) => ('id' in record ? record : { id: `record-${String(index)}`, ...record })),
    loading: false,
    refreshing: false,
  };
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
const WORKED: LeaveRecord = { id: 'record-worked', from: '2026-09-10', to: '2026-09-14' };

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
    const input = { ...baseOf().input, records: [WORKED, { id: 'record-overlapping', from: '2026-09-12', to: '2026-09-20' }] };

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
    const failure = { action: LEAVE_RECORD_ACTION, code: LEAVE_OVERLAP, conflict: WORKED } as const;
    const values = leaveRefusalValuesOf(failure);

    expect(leaveRefusalMessageKey(failure)).toBe('ljudi.leaveRecord.overlapConflict');
    expect(values).toEqual({ from: formatIsoDate(WORKED.from), to: formatIsoDate(WORKED.to) });
    if (values === undefined) throw new Error('no values for a named conflict');

    expect(t(leaveRefusalMessageKey(failure), values)).toContain(`${values.from}–${values.to}`);
  });

  it('falls back to a generic overlap line when the conflict could not be read', () => {
    expect(leaveRefusalMessageKey({ action: LEAVE_RECORD_ACTION, code: LEAVE_OVERLAP, conflict: null })).toBe('ljudi.leaveRecord.overlap');
  });

  it('gives denied and failed their own lines', () => {
    expect(leaveRefusalMessageKey({ action: LEAVE_RECORD_ACTION, code: LEAVE_DENIED, conflict: null })).toBe('ljudi.leaveRecord.denied');
    expect(leaveRefusalMessageKey({ action: LEAVE_RECORD_ACTION, code: LEAVE_FAILED, conflict: null })).toBe('ljudi.leaveRecord.failed');
    expect(leaveRefusalValuesOf({ action: LEAVE_RECORD_ACTION, code: LEAVE_DENIED, conflict: null })).toBeUndefined();
    expect(leaveRefusalValuesOf({ action: LEAVE_RECORD_ACTION, code: LEAVE_FAILED, conflict: null })).toBeUndefined();
    expect(leaveRefusalValuesOf({ action: LEAVE_RECORD_ACTION, code: LEAVE_OVERLAP, conflict: null })).toBeUndefined();
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
    expect(leaveOverlapNoteShown(overlapping, { action: LEAVE_RECORD_ACTION, code: LEAVE_OVERLAP, conflict: WORKED })).toBe(false);
    expect(leaveOverlapNoteShown(overlapping, { action: LEAVE_RECORD_ACTION, code: LEAVE_FAILED, conflict: null })).toBe(true);
    expect(leaveOverlapNoteShown({ overlapsRecord: false } as LeavePreview, null)).toBe(false);
  });

  it('describes the od field by a standing refusal, and a marked field by its reason', () => {
    const overlap = { action: LEAVE_RECORD_ACTION, code: LEAVE_OVERLAP, conflict: null } as const;

    expect(leaveDescribedByOf(LEAVE_FROM_FIELD, overlap, LEAVE_FROM_FIELD)).toBe(LEAVE_ERROR_ID);
    expect(leaveDescribedByOf(LEAVE_TO_FIELD, overlap, LEAVE_FROM_FIELD)).toBeUndefined();
    expect(leaveDescribedByOf(LEAVE_TO_FIELD, null, LEAVE_TO_FIELD)).toBe(LEAVE_REASON_ID);
    expect(leaveDescribedByOf(LEAVE_FROM_FIELD, null, LEAVE_TO_FIELD)).toBeUndefined();
    expect(leaveDescribedByOf(LEAVE_FROM_FIELD, null, null)).toBeUndefined();
  });

  it('marks the od field after an overlap, else the field a refused save named', () => {
    expect(leaveInvalidFieldOf({ action: LEAVE_RECORD_ACTION, code: LEAVE_OVERLAP, conflict: null }, LEAVE_TO_FIELD)).toBe(LEAVE_FROM_FIELD);
    expect(leaveInvalidFieldOf({ action: LEAVE_RECORD_ACTION, code: LEAVE_FAILED, conflict: null }, null)).toBeNull();
    expect(leaveInvalidFieldOf(null, LEAVE_TO_FIELD)).toBe(LEAVE_TO_FIELD);
    expect(leaveInvalidFieldOf(null, null)).toBeNull();
  });
});

/**
 * Story 5.2b's half of the view model: the records list, the amend preview
 * that leaves the amended record out, and what an amend or a removal says —
 * every row of its matrix, the figures still the domain's own.
 */
describe('the records list', () => {
  function baseOf(records: readonly LeaveRecord[], allowanceDays = 20) {
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

  const LATER: LeaveRecord = { id: 'record-later', from: '2026-09-18', to: '2026-09-25' };

  it('lists two live records in their read order, soonest first, each with its range and what the domain says it costs', () => {
    // In the order `leaveRecordsOf` sorts them into (leave-list.test.ts), which the rows keep.
    const base = baseOf([WORKED, LATER]);
    const viewer = pilot.members.find((member) => member.id === VIEWER_MEMBER);

    if (viewer === undefined) throw new Error('the fixture viewer is missing');

    const input = memberScheduleInputOf(pilot, { ...viewer, memberId: viewer.id });

    expect(base.rows.map((row) => row.record)).toEqual([WORKED, LATER]);
    expect(base.rows.map((row) => row.costDays)).toEqual([
      leaveCostOf(input, WORKED.from, WORKED.to),
      leaveCostOf(input, LATER.from, LATER.to),
    ]);
    expect(base.rows[0]?.costDays).toBe(3);
    expect(base.rows[0]?.label).toBe(`${formatIsoDate(WORKED.from) ?? ''}–${formatIsoDate(WORKED.to) ?? ''}`);
    expect(base.rows[0]).toMatchObject(leaveRangeValuesOf(WORKED));
  });

  it('has no rows for a member with no live record, and the empty line says so', () => {
    expect(baseOf([]).rows).toEqual([]);
    expect(t('ljudi.leaveRecord.recordsEmpty')).toBe('Za osobu nije upisan nijedan godišnji odmor.');
  });

  it('prompts a removal with the range and its whole cost when all of it falls in this leave year', () => {
    const row = baseOf([WORKED]).rows[0];

    if (row === undefined) throw new Error('no row');

    expect(row.inYearDays).toBeNull();
    expect(leaveRemovePromptMessageKey(row)).toBe('ljudi.leaveRecord.removePrompt');
    expect(
      t(leaveRemovePromptMessageKey(row), { from: row.from, to: row.to, cost: t('count.days', { count: row.costDays }) }),
    ).toBe('Ukloniti godišnji odmor 10.09.2026–14.09.2026? Njegov trošak je 3 dana.');
  });

  it('states the in-year part of a record crossing the leave year, on its row and in its removal prompt', () => {
    // Dan on 2026-12-27 (step 0): 27 Dan, 28 Noć, 29 Sl, 30 Sl, 31 Dan | 01 Noć.
    const crossing: LeaveRecord = { id: 'record-crossing', from: '2026-12-27', to: '2027-01-01' };
    const row = baseOf([crossing]).rows[0];

    if (row === undefined) throw new Error('no row');

    expect(row.costDays).toBe(4);
    expect(row.inYearDays).toBe(3);
    expect(baseOf([crossing]).balance.usedDays).toBe(3);
    expect(leaveRemovePromptMessageKey(row)).toBe('ljudi.leaveRecord.removePromptInYear');
    expect(
      t(leaveRemovePromptMessageKey(row), {
        from: row.from,
        to: row.to,
        cost: t('count.days', { count: row.costDays }),
        inYear: t('count.days', { count: row.inYearDays ?? row.costDays }),
      }),
    ).toBe('Ukloniti godišnji odmor 27.12.2026–01.01.2027? Njegov trošak je 4 dana, a u tekuću godinu od toga ulazi 3 dana.');
  });

  it('states an in-year part of 0 for a record wholly outside the current leave year', () => {
    // 2027-01-02 is Sl (step 2): Sl, Dan, Noć, Sl, Sl.
    const row = baseOf([{ id: 'record-next-year', from: '2027-01-02', to: '2027-01-06' }]).rows[0];

    if (row === undefined) throw new Error('no row');

    expect(row.costDays).toBe(2);
    expect(row.inYearDays).toBe(0);
    expect(leaveRemovePromptMessageKey(row)).toBe('ljudi.leaveRecord.removePromptInYear');
  });

  it('leaves the amended record out by its id, not by its dates', () => {
    const impostor: LeaveRecord = { ...WORKED, id: 'record-not-in-the-list' };
    const state = leavePreviewStateOf(baseOf([WORKED]).input, '2026-09-10', '2026-09-16', impostor);

    if (state.kind !== LEAVE_PREVIEW_READY) throw new Error(state.kind);

    expect(state.preview.overlapsRecord).toBe(true);
  });

  it('previews an amend without the amended record: the new cost, the balance after it, and no overlap of its own', () => {
    const base = baseOf([WORKED]);
    const state = leavePreviewStateOf(base.input, '2026-09-10', '2026-09-16', WORKED);

    if (state.kind !== LEAVE_PREVIEW_READY) throw new Error(state.kind);

    // 10 Dan, 11 Noć, 12 Sl, 13 Sl, 14 Dan, 15 Noć, 16 Sl.
    expect(state.preview.costDays).toBe(4);
    expect(state.preview.balanceAfterDays).toBe(20 - 4);
    expect(state.preview.overlapsRecord).toBe(false);
    expect(state.preview).toEqual(leavePreviewOf({ ...base.input, records: [], range: state.range }));
    // The same range as a NEW record overlaps the one held.
    const asNew = leavePreviewStateOf(base.input, '2026-09-10', '2026-09-16');

    if (asNew.kind !== LEAVE_PREVIEW_READY) throw new Error(asNew.kind);

    expect(asNew.preview.overlapsRecord).toBe(true);
  });

  it('still notes an amend that overlaps another record', () => {
    const state = leavePreviewStateOf(baseOf([WORKED, LATER]).input, '2026-09-10', '2026-09-19', WORKED);

    if (state.kind !== LEAVE_PREVIEW_READY) throw new Error(state.kind);

    expect(state.preview.overlapsRecord).toBe(true);
  });

  it('gives a reason and no preview for an amend to the range already held, so it is never sent', () => {
    expect(leavePreviewStateOf(baseOf([WORKED]).input, WORKED.from, WORKED.to, WORKED)).toEqual({
      kind: LEAVE_PREVIEW_REASON,
      reason: LEAVE_RANGE_UNCHANGED,
      field: LEAVE_FROM_FIELD,
    });
    expect(leaveReasonMessageKey(LEAVE_RANGE_UNCHANGED)).toBe('ljudi.leaveRecord.unchanged');
    // A new record of the same range is no amend: it previews, and overlaps.
    expect(leavePreviewStateOf(baseOf([WORKED]).input, WORKED.from, WORKED.to).kind).toBe(LEAVE_PREVIEW_READY);
  });

  it('removing the one record costing 3 leaves 20 / 0 / 20; amending it to a range costing 5 leaves 20 / 5 / 15', () => {
    expect(baseOf([WORKED]).balance).toEqual({ allowanceDays: 20, usedDays: 3, balanceDays: 17 });
    expect(baseOf([]).balance).toEqual({ allowanceDays: 20, usedDays: 0, balanceDays: 20 });

    // 10.09–18.09: Dan, Noć, Sl, Sl, Dan, Noć, Sl, Sl, Dan.
    const amended: LeaveRecord = { id: 'record-amended', from: '2026-09-10', to: '2026-09-18' };
    const preview = leavePreviewStateOf(baseOf([WORKED]).input, amended.from, amended.to, WORKED);

    if (preview.kind !== LEAVE_PREVIEW_READY) throw new Error(preview.kind);

    expect(preview.preview.costDays).toBe(5);
    expect(preview.preview.balanceAfterDays).toBe(15);
    expect(baseOf([amended]).balance).toEqual({ allowanceDays: 20, usedDays: 5, balanceDays: 15 });
    expect(baseOf([amended]).rows.map((row) => row.costDays)).toEqual([5]);
  });

  it('says what a landed amend cost from the re-read records, found by the returned id', () => {
    const input = baseOf([WORKED], 4).input;
    const replacement: LeaveRecord = { id: 'record-new', from: '2026-09-10', to: '2026-09-18' };

    expect(leaveAmendedOf(input, [replacement], replacement.id)).toEqual({ costDays: 5, overBalanceDays: -1 });
    expect(leaveAmendedOf(baseOf([WORKED]).input, [replacement], replacement.id)).toEqual({
      costDays: 5,
      overBalanceDays: null,
    });
    // Against the other fresh records: one costing 3 leaves 1 of 4, so 5 goes 4 over.
    const other: LeaveRecord = { id: 'record-other', from: '2026-09-26', to: '2026-09-30' };

    expect(leaveAmendedOf(input, [replacement, other], replacement.id).overBalanceDays).toBe(
      leavePreviewOf({ ...input, records: [other], range: replacement }).balanceAfterDays,
    );
    expect(t('ljudi.leaveRecord.amended', { count: 5 })).toContain('5 dana');
  });

  it('gives the plain amended line when the re-read did not answer or holds no record of the returned id', () => {
    const input = baseOf([WORKED]).input;

    expect(leaveAmendedOf(input, null, 'record-new')).toEqual({ costDays: null, overBalanceDays: null });
    expect(leaveAmendedOf(input, [WORKED], 'record-new')).toEqual({ costDays: null, overBalanceDays: null });
  });
});

describe('what an amend or a removal says', () => {
  const OTHER_RECORD: LeaveRange = { from: '2026-09-18', to: '2026-09-25' };

  it('names the other record on an amend overlap, in the overlap words a record uses', () => {
    const failure = { action: LEAVE_AMEND_ACTION, code: LEAVE_OVERLAP, conflict: OTHER_RECORD } as const;
    const values = leaveRefusalValuesOf(failure);

    expect(leaveRefusalMessageKey(failure)).toBe('ljudi.leaveRecord.overlapConflict');
    if (values === undefined) throw new Error('no values for a named conflict');
    expect(t(leaveRefusalMessageKey(failure), values)).toContain('18.09.2026–25.09.2026');
    expect(leaveFormFailureOf(failure)).toBe(failure);
    expect(leaveInvalidFieldOf(leaveFormFailureOf(failure), null)).toBe(LEAVE_FROM_FIELD);
  });

  it.each([
    [LEAVE_RECORD_ACTION, LEAVE_DENIED, 'ljudi.leaveRecord.denied'],
    [LEAVE_RECORD_ACTION, LEAVE_FAILED, 'ljudi.leaveRecord.failed'],
    [LEAVE_AMEND_ACTION, LEAVE_DENIED, 'ljudi.leaveRecord.amendDenied'],
    [LEAVE_AMEND_ACTION, LEAVE_FAILED, 'ljudi.leaveRecord.amendFailed'],
    [LEAVE_REMOVE_ACTION, LEAVE_DENIED, 'ljudi.leaveRecord.removeDenied'],
    [LEAVE_REMOVE_ACTION, LEAVE_FAILED, 'ljudi.leaveRecord.removeFailed'],
    [LEAVE_AMEND_ACTION, LEAVE_GONE, 'ljudi.leaveRecord.gone'],
    [LEAVE_REMOVE_ACTION, LEAVE_GONE, 'ljudi.leaveRecord.gone'],
  ] as const)('gives a %s refused as %s its own line', (action, code, key) => {
    expect(leaveRefusalMessageKey({ action, code, conflict: null })).toBe(key);
    expect(leaveRefusalValuesOf({ action, code, conflict: null })).toBeUndefined();
  });

  it('says an amended record is gone on the list, never in the form', () => {
    const gone = { action: LEAVE_AMEND_ACTION, code: LEAVE_GONE, conflict: null } as const;

    expect(leaveFormFailureOf(gone)).toBeNull();
    expect(leaveListFailureOf(gone, null, false)).toBe(gone);
    expect(leaveDescribedByOf(LEAVE_FROM_FIELD, leaveFormFailureOf(gone), null)).toBeUndefined();
  });

  it('keeps a refused removal inside its open confirmation, and says a gone one on the list once it closes', () => {
    const failed = { action: LEAVE_REMOVE_ACTION, code: LEAVE_FAILED, conflict: null } as const;
    const gone = { action: LEAVE_REMOVE_ACTION, code: LEAVE_GONE, conflict: null } as const;

    expect(leaveConfirmFailureOf(failed)).toBe(failed);
    expect(leaveListFailureOf(null, failed, true)).toBeNull();
    expect(leaveConfirmFailureOf(gone)).toBeNull();
    expect(leaveListFailureOf(null, gone, false)).toBe(gone);
    expect(leaveListFailureOf(null, null, false)).toBeNull();
  });

  it('shows a closed removal found gone over an amend found gone, and an amend found gone while a removal is refused in its open confirmation', () => {
    const amendGone = { action: LEAVE_AMEND_ACTION, code: LEAVE_GONE, conflict: null } as const;
    const removeGone = { action: LEAVE_REMOVE_ACTION, code: LEAVE_GONE, conflict: null } as const;
    const removeFailed = { action: LEAVE_REMOVE_ACTION, code: LEAVE_FAILED, conflict: null } as const;

    expect(leaveListFailureOf(amendGone, removeGone, false)).toBe(removeGone);
    expect(leaveListFailureOf(amendGone, removeFailed, true)).toBe(amendGone);
    expect(leaveListFailureOf(amendGone, removeGone, true)).toBe(amendGone);
    expect(leaveListFailureOf({ ...amendGone, code: LEAVE_OVERLAP }, removeFailed, true)).toBeNull();
  });

  it('says a gone record no longer exists, removed or amended, and claims no refresh', () => {
    expect(t('ljudi.leaveRecord.gone')).toBe('Taj zapis godišnjeg odmora više ne postoji (uklonjen je ili izmijenjen).');
  });

  it('reads the conflict off an amend outcome as off a record one', () => {
    expect(leaveConflictOf({ ok: false, code: LEAVE_OVERLAP, conflict: OTHER_RECORD })).toEqual(OTHER_RECORD);
    expect(leaveConflictOf({ ok: false, code: LEAVE_GONE })).toBeNull();
    expect(leaveConflictOf({ ok: true, id: 'record-new' })).toBeNull();
  });

  it('names the range and its cost in words in the removal prompt, and the range in the removed line', () => {
    const values = leaveRangeValuesOf(WORKED);
    const prompt = t('ljudi.leaveRecord.removePrompt', { ...values, cost: t('count.days', { count: 3 }) });

    expect(prompt).toContain('10.09.2026–14.09.2026');
    expect(prompt).toContain('3 dana');
    expect(t('ljudi.leaveRecord.removed', values)).toContain('10.09.2026–14.09.2026');
  });
});

describe('the hand-off from a conflict (story 5.4d)', () => {
  const ORIGIN = { memberId: VIEWER_MEMBER, date: '2026-09-10', teamId: 'team-a' };
  const AMEND = { kind: LEAVE_AMEND_ACTION, recordId: WORKED.id, range: { from: '2026-09-11', to: '2026-09-14' }, origin: ORIGIN } as const;
  const REMOVE = { kind: LEAVE_REMOVE_ACTION, recordId: WORKED.id, origin: ORIGIN } as const;

  function rowsOf(records: readonly LeaveRecord[]) {
    return readyOf(memberLeaveBaseOf(sourcesOf(pilot, { records: recordsOf(records) }), VIEWER_MEMBER, NOW)).rows;
  }

  it('travels in router state beside the router\'s own keys, and is read back as it went', () => {
    const state = withLeaveHandoff({ key: 'abc' }, AMEND);

    expect(state).toEqual({ key: 'abc', [LEAVE_HANDOFF_STATE]: AMEND, [LEAVE_HANDOFF_ORIGIN_STATE]: ORIGIN });
    expect(leaveHandoffOf(state)).toEqual(AMEND);
    expect(leaveHandoffOriginOf(state)).toEqual(ORIGIN);
    expect(leaveHandoffOf(withLeaveHandoff({}, REMOVE))).toEqual(REMOVE);
    expect(leaveHandoffKeyOf(AMEND)).toBe(leaveHandoffKeyOf({ ...AMEND }));
    expect(leaveHandoffKeyOf(AMEND)).not.toBe(leaveHandoffKeyOf(REMOVE));
    expect(leaveHandoffKeyOf(null)).toBeNull();
  });

  it('once opened, is taken off the entry with the origin and every other key kept: a reload or Back reopens nothing, and the way back stays', () => {
    const opened = withoutLeaveHandoffOpening(withLeaveHandoff({ key: 'abc' }, AMEND));

    expect(opened).toEqual({ key: 'abc', [LEAVE_HANDOFF_ORIGIN_STATE]: ORIGIN });
    expect(leaveHandoffOf(opened)).toBeNull();
    expect(leaveHandoffOriginOf(opened)).toEqual(ORIGIN);
    expect(withoutLeaveHandoffOpening(undefined)).toEqual({});
    expect(leaveHandoffOriginOf({})).toBeNull();
    expect(leaveHandoffOriginOf({ [LEAVE_HANDOFF_ORIGIN_STATE]: { ...ORIGIN, teamId: '' } })).toBeNull();
  });

  it('reads nothing from an entry without it, or a malformed one', () => {
    expect(leaveHandoffOf(undefined)).toBeNull();
    expect(leaveHandoffOf({})).toBeNull();
    expect(leaveHandoffOf({ [LEAVE_HANDOFF_STATE]: { ...AMEND, kind: 'record' } })).toBeNull();
    expect(leaveHandoffOf({ [LEAVE_HANDOFF_STATE]: { ...AMEND, recordId: '' } })).toBeNull();
    expect(leaveHandoffOf({ [LEAVE_HANDOFF_STATE]: { ...AMEND, range: { from: '2026-09-14', to: '2026-09-11' } } })).toBeNull();
    expect(leaveHandoffOf({ [LEAVE_HANDOFF_STATE]: { ...AMEND, range: null } })).toBeNull();
    expect(leaveHandoffOf({ [LEAVE_HANDOFF_STATE]: { ...REMOVE, origin: { ...ORIGIN, date: '2026-02-31' } } })).toBeNull();
  });

  it('Save: opens amend mode for its record with the computed range, or that record\'s removal', () => {
    const rows = rowsOf([WORKED]);

    expect(leaveHandoffOpeningOf(AMEND, VIEWER_MEMBER, rows)).toEqual({ kind: LEAVE_AMEND_ACTION, row: rows[0], range: AMEND.range });
    const oneDay = rowsOf([{ id: WORKED.id, from: '2026-09-10', to: '2026-09-10' }]);

    expect(leaveHandoffOpeningOf(REMOVE, VIEWER_MEMBER, oneDay)).toEqual({ kind: LEAVE_REMOVE_ACTION, row: oneDay[0] });
  });

  it('Gone: opens nothing when the record was removed before arrival, for another member, or with no hand-off', () => {
    expect(leaveHandoffOpeningOf(AMEND, VIEWER_MEMBER, rowsOf([]))).toBeNull();
    expect(leaveHandoffOpeningOf(AMEND, 'someone-else', rowsOf([WORKED]))).toBeNull();
    expect(leaveHandoffOpeningOf(null, VIEWER_MEMBER, rowsOf([WORKED]))).toBeNull();
  });

  it('Changed elsewhere: re-applies the rule to the record as it is now, so a lengthened record is never removed and a shortened one never stretched', () => {
    // Handed over as a one-day removal, the record has since grown to 10.09–14.09: amend, starting 11.09.
    const lengthened = rowsOf([WORKED]);

    expect(leaveHandoffOpeningOf(REMOVE, VIEWER_MEMBER, lengthened)).toEqual({
      kind: LEAVE_AMEND_ACTION,
      row: lengthened[0],
      range: { from: '2026-09-11', to: '2026-09-14' },
    });

    // Handed over as 11.09–14.09, the record has since shrunk to 10.09–12.09: 11.09–12.09, never back to the 14th.
    const shrunk = rowsOf([{ id: WORKED.id, from: '2026-09-10', to: '2026-09-12' }]);

    expect(leaveHandoffOpeningOf(AMEND, VIEWER_MEMBER, shrunk)).toEqual({
      kind: LEAVE_AMEND_ACTION,
      row: shrunk[0],
      range: { from: '2026-09-11', to: '2026-09-12' },
    });

    // Shrunk to the conflict's date alone: the removal.
    const oneDay = rowsOf([{ id: WORKED.id, from: '2026-09-10', to: '2026-09-10' }]);

    expect(leaveHandoffOpeningOf(AMEND, VIEWER_MEMBER, oneDay)).toEqual({ kind: LEAVE_REMOVE_ACTION, row: oneDay[0] });
  });

  it('Changed elsewhere: opens nothing once the record no longer covers the conflict\'s date', () => {
    expect(leaveHandoffOpeningOf(AMEND, VIEWER_MEMBER, rowsOf([{ id: WORKED.id, from: '2026-09-11', to: '2026-09-14' }]))).toBeNull();
    expect(leaveHandoffOpeningOf(REMOVE, VIEWER_MEMBER, rowsOf([{ id: WORKED.id, from: '2026-09-01', to: '2026-09-09' }]))).toBeNull();
  });
});
