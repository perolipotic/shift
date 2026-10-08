import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { conflictsQueueOutcomeOf } from '@/features/conflicts/services/conflicts-queue';
import type { LeaveRecord } from '@/features/leave/services/leave-list';
import {
  LEAVE_CONFLICTS_KNOWN,
  LEAVE_CONFLICTS_UNAVAILABLE,
  LEAVE_CONFLICTS_UNKNOWN,
  leaveConflictsOf,
  leaveConflictsUnknown,
  leaveRemoveClearsOf,
  type LeaveConflicts,
} from '@/features/leave/services/leave-conflicts';
import type { ReplacementResolutionsSource } from '@/features/leave/services/leave-section';
import { initLocalization } from '@/lib/i18n';
import { nextIsoDate } from '@/lib/i18n/format';
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

/**
 * Story 7.12's conflict preview, executed (AD-15) over a real snapshot: the
 * pilot's Smjena A, which works Dan on 02, 06, 10, 14 and 18 September and
 * Noć the day after each, with the viewer on it. Every count is checked
 * against what *Raspored*'s queue lists once the change is stored.
 */

const TEAM_A = 'pilot-smjena-a';
const RECORD_ID = '00000000-0000-4000-8000-00000000a001';
const OTHER_ID = '00000000-0000-4000-8000-00000000a002';

/** 10.09–15.09: čet 10.09. Dan, pet 11.09. Noć, pon 14.09. Dan, uto 15.09. Noć. */
const RECORD: LeaveRecord = { id: RECORD_ID, from: '2026-09-10', to: '2026-09-15' };
/** 02.09–03.09, far from every range below: Dan, Noć. */
const OTHER: LeaveRecord = { id: OTHER_ID, from: '2026-09-02', to: '2026-09-03' };

const READ = (data: readonly unknown[] = []): ReplacementResolutionsSource => ({
  isPending: false,
  isError: false,
  fetchStatus: 'idle',
  data,
});

const line = (weekday: string, date: string, type: string) => ({ weekday, date, type });

/** A resolution row as the organization's read answers it. */
function resolutionRow(date: string, kind = 'accept_uncovered'): Record<string, unknown> {
  return { member_id: VIEWER_MEMBER, date, team_id: TEAM_A, kind, roster_override_id: null };
}

/** A `leave_records` row: the range canonical, its upper bound exclusive. */
function storedRow(record: LeaveRecord): Record<string, unknown> {
  return { id: record.id, member_id: VIEWER_MEMBER, during: `[${record.from},${nextIsoDate(record.to) ?? record.to})` };
}

/** The lines of each group without their keys, which only identify them. */
function linesOf(conflicts: LeaveConflicts | null) {
  if (conflicts === null || conflicts.kind !== LEAVE_CONFLICTS_KNOWN) throw new Error('not known');

  const strip = (lines: readonly { readonly weekday: string; readonly date: string; readonly type: string }[]) =>
    lines.map(({ weekday, date, type }) => ({ weekday, date, type }));

  return { created: strip(conflicts.created), cleared: strip(conflicts.cleared), kept: strip(conflicts.kept) };
}

/** How many unresolved conflicts *Raspored* lists for the viewer over `records`. */
function queuedCount(records: readonly LeaveRecord[], resolutionRows: readonly unknown[] = []): number {
  const outcome = conflictsQueueOutcomeOf(snapshot, records.map(storedRow), resolutionRows, '2026-09-01');

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.view.rows.filter((row) => row.memberId === VIEWER_MEMBER).length;
}

let snapshot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();

  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(TEAM_A, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, TEAM_A, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME)]),
    overridesAnswerOf(),
    rosterOverridesAnswerOf([]),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  snapshot = outcome.snapshot;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a new record', () => {
  it('New, collides: names each conflict the range creates, soonest first', () => {
    const conflicts = leaveConflictsOf(READ(), snapshot, VIEWER_MEMBER, [OTHER], {
      target: null,
      next: { from: '2026-09-10', to: '2026-09-15' },
    });

    expect(linesOf(conflicts)).toEqual({
      created: [
        line('čet', '10.09.', 'Dan'),
        line('pet', '11.09.', 'Noć'),
        line('pon', '14.09.', 'Dan'),
        line('uto', '15.09.', 'Noć'),
      ],
      cleared: [],
      kept: [],
    });
  });

  it("equals what Raspored lists for the member once the record is saved", () => {
    const next = { from: '2026-09-10', to: '2026-09-15' };
    const conflicts = leaveConflictsOf(READ(), snapshot, VIEWER_MEMBER, [OTHER], { target: null, next });

    expect(linesOf(conflicts).created).toHaveLength(queuedCount([OTHER, { id: RECORD_ID, ...next }]) - queuedCount([OTHER]));
  });

  it('New, none: a range over free days only creates nothing', () => {
    const conflicts = leaveConflictsOf(READ(), snapshot, VIEWER_MEMBER, [], {
      target: null,
      next: { from: '2026-09-12', to: '2026-09-13' },
    });

    expect(conflicts).toEqual({ kind: LEAVE_CONFLICTS_KNOWN, created: [], cleared: [], kept: [] });
  });

  it('says nothing for a range that overlaps another record: the overlap note says it', () => {
    expect(
      leaveConflictsOf(READ(), snapshot, VIEWER_MEMBER, [RECORD], { target: null, next: { from: '2026-09-15', to: '2026-09-18' } }),
    ).toBeNull();
  });
});

describe('an amend', () => {
  it('Amend shorter: clears the dropped conflicts and keeps the rest', () => {
    const conflicts = leaveConflictsOf(READ(), snapshot, VIEWER_MEMBER, [OTHER, RECORD], {
      target: RECORD,
      next: { from: '2026-09-10', to: '2026-09-12' },
    });

    expect(linesOf(conflicts)).toEqual({
      created: [],
      cleared: [line('pon', '14.09.', 'Dan'), line('uto', '15.09.', 'Noć')],
      kept: [line('čet', '10.09.', 'Dan'), line('pet', '11.09.', 'Noć')],
    });
  });

  it('Amend longer: names the new conflict beside the kept ones', () => {
    const shorter = { ...RECORD, to: '2026-09-12' };
    const conflicts = leaveConflictsOf(READ(), snapshot, VIEWER_MEMBER, [shorter], {
      target: shorter,
      next: { from: '2026-09-10', to: '2026-09-14' },
    });

    expect(linesOf(conflicts)).toEqual({
      created: [line('pon', '14.09.', 'Dan')],
      cleared: [],
      kept: [line('čet', '10.09.', 'Dan'), line('pet', '11.09.', 'Noć')],
    });
  });

  it('leaves a resolved conflict out of cleared and kept: it is no unresolved conflict', () => {
    const resolved = READ([resolutionRow('2026-09-11'), resolutionRow('2026-09-14')]);
    const conflicts = leaveConflictsOf(resolved, snapshot, VIEWER_MEMBER, [RECORD], {
      target: RECORD,
      next: { from: '2026-09-10', to: '2026-09-12' },
    });

    expect(linesOf(conflicts)).toEqual({
      created: [],
      cleared: [line('uto', '15.09.', 'Noć')],
      kept: [line('čet', '10.09.', 'Dan')],
    });
  });

  it('leaves a newly covered date out of created when a live resolution already resolves it', () => {
    const shorter = { ...RECORD, to: '2026-09-12' };
    const conflicts = leaveConflictsOf(READ([resolutionRow('2026-09-14')]), snapshot, VIEWER_MEMBER, [shorter], {
      target: shorter,
      next: { from: '2026-09-10', to: '2026-09-15' },
    });

    expect(linesOf(conflicts).created).toEqual([line('uto', '15.09.', 'Noć')]);
  });

  it("agrees with Raspored: kept plus created is what it lists once the amend is stored", () => {
    const resolutions = [resolutionRow('2026-09-11')];
    const next = { from: '2026-09-11', to: '2026-09-18' };
    const conflicts = linesOf(
      leaveConflictsOf(READ(resolutions), snapshot, VIEWER_MEMBER, [RECORD], { target: RECORD, next }),
    );

    expect(conflicts.cleared.length + conflicts.kept.length).toBe(queuedCount([RECORD], resolutions));
    expect(conflicts.kept.length + conflicts.created.length).toBe(queuedCount([{ ...RECORD, ...next }], resolutions));
  });

  it('measures an amend against every record but its own', () => {
    expect(
      leaveConflictsOf(READ(), snapshot, VIEWER_MEMBER, [RECORD], { target: RECORD, next: { from: '2026-09-14', to: '2026-09-18' } }),
    ).not.toBeNull();
  });
});

describe('a removal', () => {
  it('Remove: clears every unresolved conflict of the record', () => {
    const conflicts = leaveConflictsOf(READ([resolutionRow('2026-09-14')]), snapshot, VIEWER_MEMBER, [OTHER, RECORD], {
      target: RECORD,
      next: null,
    });

    expect(linesOf(conflicts)).toEqual({
      created: [],
      cleared: [line('čet', '10.09.', 'Dan'), line('pet', '11.09.', 'Noć'), line('uto', '15.09.', 'Noć')],
      kept: [],
    });
    expect(leaveRemoveClearsOf(conflicts)).toBe(3);
  });

  it('counts nothing for an unknown preview or none, and says only the unknown one cannot be checked', () => {
    expect(leaveRemoveClearsOf(null)).toBe(0);
    expect(leaveRemoveClearsOf({ kind: LEAVE_CONFLICTS_UNKNOWN })).toBe(0);
    expect(leaveConflictsUnknown(null)).toBe(false);
    expect(leaveConflictsUnknown({ kind: LEAVE_CONFLICTS_UNKNOWN })).toBe(true);
    expect(leaveConflictsUnknown({ kind: LEAVE_CONFLICTS_KNOWN, created: [], cleared: [], kept: [] })).toBe(false);
  });
});

describe('unknown', () => {
  it.each([
    ['pending', { isPending: true, isError: false, fetchStatus: 'fetching', data: undefined }],
    ['failed', { isPending: false, isError: true, fetchStatus: 'idle', data: [] }],
    ['paused offline', { isPending: false, isError: false, fetchStatus: 'paused', data: [] }],
    ['settled with nothing', { isPending: false, isError: false, fetchStatus: 'idle', data: undefined }],
    ['being re-read over cached rows', { isPending: false, isError: false, fetchStatus: 'fetching', data: [] }],
  ] as const)('is unknown while the resolutions read is %s', (_name, resolutions) => {
    expect(
      leaveConflictsOf(resolutions, snapshot, VIEWER_MEMBER, [], { target: null, next: { from: '2026-09-10', to: '2026-09-15' } }),
    ).toEqual({ kind: LEAVE_CONFLICTS_UNKNOWN });
  });

  it('is unknown while the calendar snapshot is being re-read', () => {
    expect(
      leaveConflictsOf(
        READ(),
        snapshot,
        VIEWER_MEMBER,
        [RECORD],
        { target: RECORD, next: null },
        true,
      ),
    ).toEqual({ kind: LEAVE_CONFLICTS_UNKNOWN });
  });

  it('is unknown, logged and never thrown, when a resolution row cannot be trusted', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      leaveConflictsOf(READ([resolutionRow('2026-02-30')]), snapshot, VIEWER_MEMBER, [RECORD], { target: RECORD, next: null }),
    ).toEqual({ kind: LEAVE_CONFLICTS_UNKNOWN });
    expect(logged).toHaveBeenCalledWith(LEAVE_CONFLICTS_UNAVAILABLE, expect.any(RangeError));
  });

  it('is unknown, logged, when the domain refuses the member', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      leaveConflictsOf(READ(), snapshot, 'stranger', [], { target: null, next: { from: '2026-09-10', to: '2026-09-15' } }),
    ).toEqual({ kind: LEAVE_CONFLICTS_UNKNOWN });
    expect(logged).toHaveBeenCalledWith(LEAVE_CONFLICTS_UNAVAILABLE, expect.any(RangeError));
  });
});
