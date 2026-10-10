import { HOURS_FIGURE_LEAVE, HOURS_FIGURE_TOTAL, collisionsOf, leaveCostOf, type Collision, type CollisionResolution } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CALENDAR_UNAVAILABLE, readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf, monthHeaderOf } from '@/features/calendar/utils/month';
import { collisionInputOf } from '@/features/conflicts/services/conflicts-queue';
import {
  EXPLANATION_HOURS,
  EXPLANATION_LEAVE,
  LEAVE_DECISION_ACCEPTED,
  LEAVE_DECISION_REPLACED,
  hoursExplanationOf,
  type HoursExplanationLine,
  type LeaveExplanationLine,
} from '@/features/hours/services/hours-explanation';
import { hoursExportOf } from '@/features/hours/services/hours-export';
import {
  HOURS_CONFLICTS_LOADING,
  HOURS_CONFLICTS_READY,
  HOURS_CONFLICTS_UNAVAILABLE,
  NO_LEAVE_RECORDS,
  conflictCountIn,
  conflictCountOf,
  conflictCountsOf,
  hoursLeaveOf,
  hoursConflictsStateOf,
  hoursLeaveKeysOf,
  leaveShiftsOf,
  type HoursConflictsState,
  type LeaveRecordsByMember,
} from '@/features/hours/services/hours-conflicts';
import {
  HOURS_UNAVAILABLE,
  hoursSnapshotStateOf,
  leaveShownOf,
  myHoursOf,
  type MyHoursView,
} from '@/features/hours/services/my-hours';
import {
  hoursSurfaceOf,
  organizationHoursOf,
  type OrganizationHoursRow,
  type OrganizationHoursView,
} from '@/features/hours/services/organization-hours';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  UJ5,
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
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 5.3d's count, executed (AD-15): every row of the spec's matrix but
 * the failed read (the e2e spec's), over *Sati*'s three surfaces — the
 * viewer's own month, the organization's table and the sheet — with the
 * collisions `hoursLeaveOf` derives. Each count is checked against
 * `collisionsOf` itself, through *Raspored*'s own recipe, and every other
 * figure against the same month computed with no leave at all.
 */

const ANA = '00000000-0000-4000-8000-0000000000c1';
const SEPTEMBER = '2026-09';
const OCTOBER = '2026-10';
const TODAY = '2026-09-01';

type Row = Record<string, unknown>;
type Role = 'admin' | 'member_role';

const NO_COLLISIONS: readonly Collision[] = [];

function teamOf(rows: FixtureRows, index: number): string {
  const id = rows.teams[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no team ${String(index)}`);

  return id;
}

/** The viewer on the first team, Ana on the second, each since the fixture's seeding. */
async function snapshotOf(
  rows: FixtureRows,
  { role = 'admin' as Role, rosterOverrides = [] as readonly Row[] } = {},
): Promise<CalendarSnapshot> {
  const [a, b] = [teamOf(rows, 0), teamOf(rows, 1)];
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow([membershipRow(a, SEEDED)], { role })],
          versions: [memberMembershipRow(VIEWER_MEMBER, a, SEEDED), memberMembershipRow(ANA, b, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(ANA, 'Ana Anić')]),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A row as `leave_records` answers it: the range canonical, its upper bound exclusive. */
function rowOf(id: string, from: string, toExclusive: string, memberId: string = VIEWER_MEMBER): Row {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}

/** The pilot's worked example: 10.09–14.09 over Dan, Noć, Slobodno, Slobodno, Dan. */
const WORKED = rowOf('record-worked', '2026-09-10', '2026-09-15');
/** Across the month's edge: 29.09–02.10. */
const ACROSS = rowOf('record-across', '2026-09-29', '2026-10-03');
/** WORKED as the records *Sati* hands on: the viewer's one range. */
const WORKED_RECORDS: LeaveRecordsByMember = new Map([[VIEWER_MEMBER, [{ from: '2026-09-10', to: '2026-09-14' }]]]);

/** Only the worked example's two free days. */
const FREE = rowOf('record-free', '2026-09-12', '2026-09-14');

/** A settled read that answered `rows`. */
function settled(rows: readonly unknown[]) {
  return { data: rows, isError: false, isPending: false, fetchStatus: 'idle' };
}

function ready(snapshot: CalendarSnapshot, rows: readonly Row[], resolutionRows: readonly Row[] = []): HoursConflictsState {
  return hoursConflictsStateOf(snapshot, settled(rows), settled(resolutionRows));
}

function collisionsFrom(snapshot: CalendarSnapshot, rows: readonly Row[], resolutionRows: readonly Row[] = []): readonly Collision[] {
  return hoursLeaveOf(snapshot, rows, resolutionRows).collisions;
}

function tableOf(
  snapshot: CalendarSnapshot,
  collisions: readonly Collision[],
  month: string,
  leaveKeys: readonly CollisionResolution[],
  leaveRecords: LeaveRecordsByMember,
): OrganizationHoursView {
  const outcome = organizationHoursOf(snapshot, { mjesec: month }, TODAY, collisions, leaveKeys, leaveRecords);

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.view;
}

function rowOfMember(view: OrganizationHoursView, memberId: string): OrganizationHoursRow {
  const row = view.rows.find((one) => one.memberId === memberId);

  if (row === undefined) throw new Error(`no row of ${memberId}`);

  return row;
}

function ownOf(
  snapshot: CalendarSnapshot,
  collisions: readonly Collision[],
  month: string,
  leaveKeys: readonly CollisionResolution[],
  leaveRecords: LeaveRecordsByMember,
): MyHoursView {
  const outcome = myHoursOf(snapshot, { mjesec: month }, TODAY, collisions, leaveKeys, leaveRecords);

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.view;
}

/** A leave as the screen reads it. */
function shown(leave: Parameters<typeof leaveShownOf>[0]): string {
  const { key, values } = leaveShownOf(leave);

  return t(key, values);
}

/** A row without its count: every figure the count must leave alone. */
function figuresOf({ conflictCount: _count, ...figures }: OrganizationHoursRow): Omit<OrganizationHoursRow, 'conflictCount'> {
  return figures;
}

/** The viewer's own month without its count. */
function ownFiguresOf({ conflictCount: _count, ...figures }: MyHoursView): Omit<MyHoursView, 'conflictCount'> {
  return figures;
}

let admin: CalendarSnapshot;
let member: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  admin = await snapshotOf(PILOT);
  member = await snapshotOf(PILOT, { role: 'member_role' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the worked example', () => {
  it("counts 3 on the admin's table, and 0 for everybody else", () => {
    const view = tableOf(admin, collisionsFrom(admin, [WORKED]), SEPTEMBER, [], NO_LEAVE_RECORDS);

    expect(rowOfMember(view, VIEWER_MEMBER).conflictCount).toBe(3);
    expect(rowOfMember(view, ANA).conflictCount).toBe(0);
  });

  it('changes no hours figure, and the leave is the charged days, the dates in conflict among them', () => {
    // The records and collisions as *Sati* holds them: the ready state `use-hours` reads.
    const state = ready(admin, [WORKED]);

    if (state.kind !== HOURS_CONFLICTS_READY) throw new Error(state.kind);
    const before = tableOf(admin, NO_COLLISIONS, SEPTEMBER, [], NO_LEAVE_RECORDS);
    const after = tableOf(admin, state.collisions, SEPTEMBER, state.leaveKeys, state.leaveRecords);
    const hoursOf = ({ conflictCount: _count, leave: _leave, leaveDays: _days, ...figures }: OrganizationHoursRow) => figures;

    // No hours figure moves: band hours, total, shift count and the domain's leave minutes.
    expect(after.rows.map(hoursOf)).toEqual(before.rows.map(hoursOf));
    expect(rowOfMember(after, VIEWER_MEMBER).hours.leaveMinutes).toBe(0);
    // The leave is the charged days: 10.09, 11.09 and 14.09, each in unresolved conflict.
    expect(rowOfMember(after, VIEWER_MEMBER).leaveDays).toBe(3);
    expect(shown(rowOfMember(after, VIEWER_MEMBER).leave)).toBe('3 dana');
    expect(rowOfMember(after, VIEWER_MEMBER).conflictCount).toBe(3);
    expect(rowOfMember(after, ANA).leave).toBeNull();

    // The member's own path: the same days, from their own records.
    const own = ready(member, [WORKED]);

    if (own.kind !== HOURS_CONFLICTS_READY) throw new Error(own.kind);
    const mine = ownOf(member, own.collisions, SEPTEMBER, own.leaveKeys, own.leaveRecords);
    const plain = ownOf(member, NO_COLLISIONS, SEPTEMBER, [], NO_LEAVE_RECORDS);

    expect(shown(mine.leave)).toBe('3 dana');
    expect(mine.conflictCount).toBe(3);
    expect(mine.total).toEqual(plain.total);
    expect(mine.bands).toEqual(plain.bands);
    expect(mine.shiftCount).toBe(plain.shiftCount);
  });

  it('is the number of collisionsOf dated in the month, through the queue’s own recipe', () => {
    const records = organizationLeaveRecordsOf([WORKED], admin.members.map((one) => one.id))!;
    const direct = collisionsOf(collisionInputOf(admin, records));

    expect(direct.map((collision) => collision.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-14']);
    expect(conflictCountOf(direct, VIEWER_MEMBER, SEPTEMBER)).toBe(3);
  });

  it('carries 3 into the sheet, a number cell under its own heading, and 0 on the other rows', () => {
    const view = tableOf(admin, collisionsFrom(admin, [WORKED]), SEPTEMBER, [], NO_LEAVE_RECORDS);
    const sheet = hoursExportOf(view, admin.organizationName);

    expect(sheet.columns.at(-1)).toBe(t('sati.organization.conflicts'));
    expect(t('sati.organization.conflicts')).toBe('Neriješeni konflikti');
    view.rows.forEach((row, index) => {
      expect(sheet.rows[index]!.at(-1)).toEqual({ kind: 'count', value: row.memberId === VIEWER_MEMBER ? 3 : 0 });
    });
  });

  it("shows the count on the viewer's own month, worded in every Croatian form", () => {
    const view = ownOf(member, collisionsFrom(member, [WORKED]), SEPTEMBER, [], NO_LEAVE_RECORDS);

    expect(view.conflictCount).toBe(3);
    expect(ownFiguresOf(view)).toEqual(ownFiguresOf(ownOf(member, NO_COLLISIONS, SEPTEMBER, [], NO_LEAVE_RECORDS)));
    expect(t('sati.conflicts', { count: 3 })).toBe('3 smjene u neriješenom konfliktu');
    expect(t('sati.conflicts', { count: 2 })).toBe('2 smjene u neriješenom konfliktu');
    expect(t('sati.conflicts', { count: 1 })).toBe('1 smjena u neriješenom konfliktu');
    expect(t('sati.conflicts', { count: 5 })).toBe('5 smjena u neriješenom konfliktu');
  });
});

describe('the month boundary', () => {
  it('counts each month only its own dates', () => {
    const collisions = collisionsFrom(admin, [ACROSS]);
    const september = rowOfMember(tableOf(admin, collisions, SEPTEMBER, [], NO_LEAVE_RECORDS), VIEWER_MEMBER).conflictCount;
    const october = rowOfMember(tableOf(admin, collisions, OCTOBER, [], NO_LEAVE_RECORDS), VIEWER_MEMBER).conflictCount;

    expect(september).toBe(collisions.filter((one) => one.date.startsWith(`${SEPTEMBER}-`)).length);
    expect(october).toBe(collisions.filter((one) => one.date.startsWith(`${OCTOBER}-`)).length);
    // Working days on both sides of the edge, so both months count some.
    expect(september).toBeGreaterThan(0);
    expect(october).toBeGreaterThan(0);
    expect(september + october).toBe(collisions.length);
  });
});

describe('two teams on one date', () => {
  it('counts 2 for the date a roster override puts the member on a second team', async () => {
    const b = teamOf(PILOT, 1);
    const snapshot = await snapshotOf(PILOT, {
      rosterOverrides: [calendarRosterOverrideRow('put-on', b, '2026-09-10', null, VIEWER_MEMBER)],
    });
    const collisions = collisionsFrom(snapshot, [WORKED]);

    expect(collisions.filter((one) => one.date === '2026-09-10')).toHaveLength(2);
    expect(rowOfMember(tableOf(snapshot, collisions, SEPTEMBER, [], NO_LEAVE_RECORDS), VIEWER_MEMBER).conflictCount).toBe(4);
  });
});

describe('none', () => {
  it.each([
    { name: 'no leave', rows: [] as readonly Row[] },
    { name: 'leave only over non-working days', rows: [FREE] },
  ])('$name: the table and the sheet show 0, and the own month adds nothing', ({ rows }) => {
    const view = tableOf(admin, collisionsFrom(admin, rows), SEPTEMBER, [], NO_LEAVE_RECORDS);
    const sheet = hoursExportOf(view, admin.organizationName);

    expect(view.rows.map((row) => row.conflictCount)).toEqual(view.rows.map(() => 0));
    expect(sheet.rows.map((cells) => cells.at(-1))).toEqual(view.rows.map(() => ({ kind: 'count', value: 0 })));
    expect(ownOf(member, collisionsFrom(member, rows), SEPTEMBER, [], NO_LEAVE_RECORDS).conflictCount).toBeNull();
  });
});

describe("a member's own", () => {
  it('reads their own records alone, and counts their own collisions', () => {
    const collisions = collisionsFrom(member, [WORKED]);

    expect(collisions.every((one) => one.memberId === VIEWER_MEMBER)).toBe(true);
    expect(conflictCountOf(collisions, VIEWER_MEMBER, SEPTEMBER)).toBe(3);
  });

  it("refuses the whole read, with no retry, when a row of anybody else's comes back", () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(ready(member, [WORKED, rowOf('record-ana', '2026-09-20', '2026-09-22', ANA)])).toEqual({
      kind: HOURS_CONFLICTS_UNAVAILABLE,
      retryable: false,
    });
    expect(errors).toHaveBeenCalledWith(HOURS_CONFLICTS_UNAVAILABLE, expect.any(RangeError));
  });

  it("sees their own count on Sati's surface, and never the organization's table", () => {
    const surface = hoursSurfaceOf(
      { snapshot: member, refusal: null, loading: false },
      ready(member, [WORKED]),
      { mjesec: SEPTEMBER },
      TODAY,
    );

    expect(surface.organization).toBeNull();
    expect(surface.view?.conflictCount).toBe(3);
  });
});

describe('the property', () => {
  it.each([
    { fixture: 'pilot', rows: PILOT },
    { fixture: 'UJ-5', rows: UJ5 },
  ])('$fixture: every count is its collisions in the month, and every other figure that of no leave', async ({ rows }) => {
    const snapshot = await snapshotOf(rows);
    const leave = [
      rowOf('record-viewer', '2026-08-28', '2026-09-04'),
      rowOf('record-viewer-late', '2026-09-20', '2026-10-06'),
      rowOf('record-ana', '2026-09-08', '2026-09-19', ANA),
    ];
    const collisions = collisionsFrom(snapshot, leave);

    expect(collisions.length).toBeGreaterThan(0);
    for (const month of ['2026-08', SEPTEMBER, OCTOBER]) {
      const before = tableOf(snapshot, NO_COLLISIONS, month, [], NO_LEAVE_RECORDS);
      const after = tableOf(snapshot, collisions, month, [], NO_LEAVE_RECORDS);

      expect(after.rows.map(figuresOf), month).toEqual(before.rows.map(figuresOf));
      for (const row of after.rows) {
        expect(row.conflictCount, `${row.memberId} ${month}`).toBe(
          collisions.filter((one) => one.memberId === row.memberId && one.date.slice(0, 7) === month).length,
        );
      }
    }
  });
});

describe('the read', () => {
  it('is loading while the read is pending', () => {
    expect(hoursConflictsStateOf(admin, { data: undefined, isError: false, isPending: true, fetchStatus: 'fetching' }, settled([]))).toEqual({
      kind: HOURS_CONFLICTS_LOADING,
    });
  });

  it('is loading, not unavailable, while a role-gated read is not yet enabled', () => {
    // Between the snapshot naming the role and the read starting: pending, idle.
    expect(hoursConflictsStateOf(admin, { data: undefined, isError: false, isPending: true, fetchStatus: 'idle' }, settled([]))).toEqual({
      kind: HOURS_CONFLICTS_LOADING,
    });
  });

  it('is loading while a failed read is read again, cached rows or not: the retry is seen to work', () => {
    for (const data of [undefined, [WORKED]]) {
      expect(hoursConflictsStateOf(admin, { data, isError: true, isPending: data === undefined, fetchStatus: 'fetching' }, settled([]))).toEqual({
        kind: HOURS_CONFLICTS_LOADING,
      });
    }
  });

  it('is unavailable with a retry when the read failed or is paused, cached rows or not', () => {
    for (const answer of [
      { data: undefined, isError: true, isPending: false, fetchStatus: 'idle' },
      { data: [WORKED], isError: true, isPending: false, fetchStatus: 'idle' },
      { data: undefined, isError: false, isPending: true, fetchStatus: 'paused' },
      { data: [WORKED], isError: false, isPending: false, fetchStatus: 'paused' },
    ]) {
      expect(hoursConflictsStateOf(admin, answer, settled([]))).toEqual({ kind: HOURS_CONFLICTS_UNAVAILABLE, retryable: true });
    }
  });

  it('is unavailable, logged, with no retry, when a row cannot be trusted', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(ready(admin, [{ id: 'x', member_id: 'nobody', during: '[2026-09-10,2026-09-11)' }])).toEqual({
      kind: HOURS_CONFLICTS_UNAVAILABLE,
      retryable: false,
    });
    expect(errors).toHaveBeenCalledWith(HOURS_CONFLICTS_UNAVAILABLE, expect.any(RangeError));
  });

  it('is ready with the collisions once the rows are in', () => {
    expect(ready(admin, [WORKED])).toEqual({
      kind: HOURS_CONFLICTS_READY,
      collisions: collisionsFrom(admin, [WORKED]),
      leaveKeys: [],
      acceptedKeys: [],
      leaveRecords: WORKED_RECORDS,
    });
    expect(ready(member, [WORKED])).toMatchObject({ leaveRecords: WORKED_RECORDS });
  });
});

describe('the snapshot read', () => {
  it('is the skeleton while a failed read is read again, never the cached snapshot or the message', () => {
    for (const data of [undefined, admin]) {
      expect(hoursSnapshotStateOf({ data, isError: true, isPending: data === undefined, fetchStatus: 'fetching' })).toEqual({
        snapshot: null,
        refusal: null,
        loading: true,
      });
    }
  });

  it("is otherwise the calendar's own state: refused when failed or paused, else the answer", () => {
    expect(hoursSnapshotStateOf({ data: admin, isError: true, isPending: false, fetchStatus: 'idle' })).toEqual({
      snapshot: null,
      refusal: CALENDAR_UNAVAILABLE,
      loading: false,
    });
    expect(hoursSnapshotStateOf({ data: admin, isError: false, isPending: false, fetchStatus: 'paused' })).toMatchObject({
      refusal: CALENDAR_UNAVAILABLE,
    });
    expect(hoursSnapshotStateOf({ data: undefined, isError: false, isPending: true, fetchStatus: 'fetching' })).toEqual({
      snapshot: null,
      refusal: null,
      loading: true,
    });
    expect(hoursSnapshotStateOf({ data: admin, isError: false, isPending: false, fetchStatus: 'idle' })).toEqual({
      snapshot: admin,
      refusal: null,
      loading: false,
    });
  });
});

describe('the counts', () => {
  it('groups every member of one month in one walk, 0 for a member with none', () => {
    const collisions = collisionsFrom(admin, [WORKED, ACROSS, rowOf('record-ana', '2026-09-20', '2026-09-26', ANA)]);
    const counts = conflictCountsOf(collisions, SEPTEMBER);

    for (const memberId of [VIEWER_MEMBER, ANA]) {
      expect(conflictCountIn(counts, memberId)).toBe(
        collisions.filter((one) => one.memberId === memberId && one.date.startsWith(`${SEPTEMBER}-`)).length,
      );
      expect(conflictCountOf(collisions, memberId, SEPTEMBER)).toBe(conflictCountIn(counts, memberId));
    }
    expect(conflictCountIn(counts, 'nobody')).toBe(0);
    expect(conflictCountIn(conflictCountsOf(collisions, '2026-11'), VIEWER_MEMBER)).toBe(0);
  });
});

describe('the surface', () => {
  const state = () => ({ snapshot: admin, refusal: null, loading: false });

  it('waits for the leave read: the skeleton, and no figure without the count', () => {
    for (const conflicts of [null, { kind: HOURS_CONFLICTS_LOADING } as const]) {
      expect(hoursSurfaceOf(state(), conflicts, { mjesec: SEPTEMBER }, TODAY)).toMatchObject({
        view: null,
        organization: null,
        refusal: null,
        loading: true,
      });
    }
  });

  it('a failed leave read is the message alone, with the retry', () => {
    expect(
      hoursSurfaceOf(state(), { kind: HOURS_CONFLICTS_UNAVAILABLE, retryable: true }, { mjesec: SEPTEMBER }, TODAY),
    ).toEqual({
      view: null,
      organization: null,
      month: null,
      navShown: false,
      refusal: HOURS_UNAVAILABLE,
      retryable: true,
      loading: false,
    });
  });

  it('untrusted rows are the message alone, with no retry', () => {
    expect(
      hoursSurfaceOf(state(), { kind: HOURS_CONFLICTS_UNAVAILABLE, retryable: false }, { mjesec: SEPTEMBER }, TODAY),
    ).toMatchObject({ refusal: HOURS_UNAVAILABLE, retryable: false, navShown: false });
  });

  it('the answer is the table with its counts', () => {
    const surface = hoursSurfaceOf(state(), ready(admin, [WORKED]), { mjesec: SEPTEMBER }, TODAY);

    expect(surface.organization).toEqual(tableOf(admin, collisionsFrom(admin, [WORKED]), SEPTEMBER, [], WORKED_RECORDS));
    expect(surface.retryable).toBe(false);
  });
});

/** A resolution row as `conflict_resolutions` and `my_conflict_resolutions()` answer it. */
function resolutionOf(
  memberId: string,
  date: string,
  teamId: string,
  kind = 'accept_uncovered',
  rosterOverrideId: string | null = null,
): Row {
  return { member_id: memberId, date, team_id: teamId, kind, roster_override_id: rosterOverrideId };
}

describe('resolutions (story 5.4a)', () => {
  const a = teamOf(PILOT, 0);
  const resolved = [resolutionOf(VIEWER_MEMBER, '2026-09-11', a)];

  it("counts 2 of 3 on the admin's table and in the sheet when one is resolved, every other figure unchanged", () => {
    const view = tableOf(admin, collisionsFrom(admin, [WORKED], resolved), SEPTEMBER, [], NO_LEAVE_RECORDS);
    const sheet = hoursExportOf(view, admin.organizationName);

    expect(rowOfMember(view, VIEWER_MEMBER).conflictCount).toBe(2);
    expect(view.rows.map(figuresOf)).toEqual(tableOf(admin, NO_COLLISIONS, SEPTEMBER, [], NO_LEAVE_RECORDS).rows.map(figuresOf));
    view.rows.forEach((row, index) => {
      expect(sheet.rows[index]!.at(-1)).toEqual({ kind: 'count', value: row.memberId === VIEWER_MEMBER ? 2 : 0 });
    });
  });

  it('counts exactly the queue\'s unresolved set: the domain\'s collisions less the resolved key', () => {
    const records = organizationLeaveRecordsOf([WORKED], admin.members.map((one) => one.id))!;
    const direct = collisionsOf(collisionInputOf(admin, records));

    expect(collisionsFrom(admin, [WORKED], resolved)).toEqual(direct.filter((one) => one.date !== '2026-09-11'));
  });

  it("keeps the other team's conflict when the member is on two teams and one is resolved", async () => {
    const b = teamOf(PILOT, 1);
    const snapshot = await snapshotOf(PILOT, {
      rosterOverrides: [calendarRosterOverrideRow('put-on', b, '2026-09-10', null, VIEWER_MEMBER)],
    });
    const collisions = collisionsFrom(snapshot, [WORKED], [resolutionOf(VIEWER_MEMBER, '2026-09-10', a)]);

    expect(collisions.filter((one) => one.date === '2026-09-10').map((one) => one.teamId)).toEqual([b]);
    expect(rowOfMember(tableOf(snapshot, collisions, SEPTEMBER, [], NO_LEAVE_RECORDS), VIEWER_MEMBER).conflictCount).toBe(3);
  });

  it("counts 1 on a member's own month with 1 of 2 own collisions resolved", () => {
    // 10.09 Dan and 11.09 Noć: two own collisions, 10.09 resolved.
    const two = rowOf('record-two', '2026-09-10', '2026-09-12');

    expect(ownOf(member, collisionsFrom(member, [two]), SEPTEMBER, [], NO_LEAVE_RECORDS).conflictCount).toBe(2);
    expect(ownOf(member, collisionsFrom(member, [two], [resolutionOf(VIEWER_MEMBER, '2026-09-10', a)]), SEPTEMBER, [], NO_LEAVE_RECORDS).conflictCount).toBe(1);
  });

  it("refuses a member's read, with no retry, when a resolution of anybody else comes back", () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(ready(member, [WORKED], [resolutionOf(ANA, '2026-09-11', a)])).toEqual({ kind: HOURS_CONFLICTS_UNAVAILABLE, retryable: false });
    expect(errors).toHaveBeenCalledWith(HOURS_CONFLICTS_UNAVAILABLE, expect.any(RangeError));
  });

  it.each([
    ['an unknown team', [resolutionOf(VIEWER_MEMBER, '2026-09-11', 'no-such-team')]],
    ['an unknown member', [resolutionOf('stranger', '2026-09-11', a)]],
    ['two live rows of one key', [...resolved, resolutionOf(VIEWER_MEMBER, '2026-09-11', a, 'amend_leave')]],
  ])('is unavailable, logged, with no retry, for %s', (_name, rows) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(ready(admin, [WORKED], rows)).toEqual({ kind: HOURS_CONFLICTS_UNAVAILABLE, retryable: false });
    expect(errors).toHaveBeenCalledWith(HOURS_CONFLICTS_UNAVAILABLE, expect.any(RangeError));
  });

  it('is unavailable with a retry when the resolutions read failed or is paused, and loading while it is pending or read again', () => {
    for (const answer of [
      { data: undefined, isError: true, isPending: false, fetchStatus: 'idle' },
      { data: [], isError: true, isPending: false, fetchStatus: 'idle' },
      { data: [], isError: false, isPending: false, fetchStatus: 'paused' },
    ]) {
      expect(hoursConflictsStateOf(admin, settled([WORKED]), answer)).toEqual({ kind: HOURS_CONFLICTS_UNAVAILABLE, retryable: true });
    }
    for (const answer of [
      { data: undefined, isError: false, isPending: true, fetchStatus: 'fetching' },
      { data: undefined, isError: false, isPending: true, fetchStatus: 'idle' },
      { data: undefined, isError: true, isPending: true, fetchStatus: 'fetching' },
    ]) {
      expect(hoursConflictsStateOf(admin, settled([WORKED]), answer)).toEqual({ kind: HOURS_CONFLICTS_LOADING });
    }
  });
});

describe('accepted as leaveKeys is leave, not work (story 5.4b)', () => {
  const a = teamOf(PILOT, 0);
  // 10.09 is a 12 h Dan of the viewer's team, in conflict with WORKED.
  const accepted = [resolutionOf(VIEWER_MEMBER, '2026-09-10', a)];
  const TWELVE_HOURS = 720;

  function stateOf(snapshot: CalendarSnapshot, resolutionRows: readonly Row[]) {
    const state = ready(snapshot, [WORKED], resolutionRows);

    if (state.kind !== HOURS_CONFLICTS_READY) throw new Error(state.kind);

    return state;
  }

  it('reads the accepted-uncovered keys, and since story 5.4c the replaced, never the amend kind', () => {
    expect(stateOf(admin, accepted).leaveKeys).toEqual([{ memberId: VIEWER_MEMBER, date: '2026-09-10', teamId: a }]);
    expect(stateOf(admin, accepted).acceptedKeys).toEqual([{ memberId: VIEWER_MEMBER, date: '2026-09-10', teamId: a }]);
    expect(stateOf(member, accepted).acceptedKeys).toEqual([{ memberId: VIEWER_MEMBER, date: '2026-09-10', teamId: a }]);
    expect(stateOf(admin, [resolutionOf(VIEWER_MEMBER, '2026-09-10', a, 'amend_leave')]).leaveKeys).toEqual([]);
    expect(hoursLeaveKeysOf(member, accepted)).toEqual([{ memberId: VIEWER_MEMBER, date: '2026-09-10', teamId: a }]);
    expect(leaveShiftsOf(stateOf(admin, accepted).leaveKeys, ANA)).toEqual([]);
  });

  it("moves the shift out of the admin's table, band, total and shift count −12 h / −1, and counts it only as its leave day", () => {
    const { collisions, leaveKeys, leaveRecords } = stateOf(admin, accepted);
    const before = rowOfMember(tableOf(admin, collisionsFrom(admin, [WORKED]), SEPTEMBER, [], NO_LEAVE_RECORDS), VIEWER_MEMBER);
    const view = tableOf(admin, collisions, SEPTEMBER, leaveKeys, leaveRecords);
    const after = rowOfMember(view, VIEWER_MEMBER);

    expect(after.conflictCount).toBe(2);
    // The leave is the charged days, the accepted date among them: never its hours.
    expect(after.leaveDays).toBe(3);
    expect(after.leave).toEqual({ key: 'count.days', values: { count: 3 } });
    expect(shown(after.leave)).toBe('3 dana');
    expect(after.shiftCount).toBe(before.shiftCount - 1);
    expect(after.hours.totalMinutes).toBe(before.hours.totalMinutes - TWELVE_HOURS);
    expect(after.hours.bands.map((band) => band.minutes).reduce((x, y) => x + y, 0)).toBe(
      before.hours.bands.map((band) => band.minutes).reduce((x, y) => x + y, 0) - TWELVE_HOURS,
    );
    expect(rowOfMember(view, ANA)).toEqual(rowOfMember(tableOf(admin, collisions, SEPTEMBER, [], NO_LEAVE_RECORDS), ANA));
    expect(rowOfMember(view, ANA).leave).toBeNull();

    const sheet = hoursExportOf(view, admin.organizationName);
    const index = view.rows.findIndex((row) => row.memberId === VIEWER_MEMBER);
    const days = sheet.columns.findIndex((cell) => cell === t('sati.organization.export.leaveDays'));

    expect(days).toBeGreaterThan(-1);
    expect(sheet.rows[index]![days]).toEqual({ kind: 'count', value: 3 });
    // No leave hour is written anywhere: the next column is the conflicts'.
    expect(sheet.columns[days + 1]).toBe(t('sati.organization.conflicts'));
  });

  it("fills a member's own month with 3 dana, the accepted shift out of the shift count", () => {
    const { collisions, leaveKeys, leaveRecords } = stateOf(member, accepted);
    const view = ownOf(member, collisions, SEPTEMBER, leaveKeys, leaveRecords);
    const plain = ownOf(member, collisionsFrom(member, [WORKED]), SEPTEMBER, [], NO_LEAVE_RECORDS);

    expect(view.leave).not.toBeNull();
    expect(shown(view.leave)).toBe('3 dana');
    expect(view.shiftCount).toBe(plain.shiftCount - 1);
    expect(view.conflictCount).toBe(2);
  });

  it('passes the keys through the surface: the table the state gives is the one with leave', () => {
    const state = stateOf(admin, accepted);
    const surface = hoursSurfaceOf({ snapshot: admin, refusal: null, loading: false }, state, { mjesec: SEPTEMBER }, TODAY);

    expect(surface.organization).toEqual(tableOf(admin, state.collisions, SEPTEMBER, state.leaveKeys, state.leaveRecords));
    expect(rowOfMember(surface.organization!, VIEWER_MEMBER).hours.leaveMinutes).toBe(TWELVE_HOURS);
  });
});

describe('replaced is leave too, and the replacement works it (story 5.4c)', () => {
  const a = teamOf(PILOT, 0);
  // 10.09 is a 12 h Dan of the viewer's team, in conflict with WORKED; Ana is put on it.
  const replaced = [resolutionOf(VIEWER_MEMBER, '2026-09-10', a, 'replace_member', 'ro-ana')];
  const TWELVE_HOURS = 720;
  let replacedAdmin: CalendarSnapshot;
  let replacedMember: CalendarSnapshot;

  beforeAll(async () => {
    const rosterOverrides = [calendarRosterOverrideRow('ro-ana', a, '2026-09-10', null, ANA)];

    replacedAdmin = await snapshotOf(PILOT, { rosterOverrides });
    replacedMember = await snapshotOf(PILOT, { role: 'member_role', rosterOverrides });
  });

  function stateOf(snapshot: CalendarSnapshot, resolutionRows: readonly Row[]) {
    const state = ready(snapshot, [WORKED], resolutionRows);

    if (state.kind !== HOURS_CONFLICTS_READY) throw new Error(state.kind);

    return state;
  }

  it('feeds the replaced key to the leave hours on the admin path and on the member path', () => {
    const key = { memberId: VIEWER_MEMBER, date: '2026-09-10', teamId: a };

    expect(stateOf(replacedAdmin, replaced).leaveKeys).toEqual([key]);
    expect(stateOf(replacedMember, replaced).leaveKeys).toEqual([key]);
    expect(hoursLeaveKeysOf(replacedMember, replaced)).toEqual([key]);
  });

  it("moves the absent member's 12 h to leave, and the replacement's band hours rise by 12 h through the override", () => {
    const { collisions, leaveKeys, leaveRecords } = stateOf(replacedAdmin, replaced);
    const view = tableOf(replacedAdmin, collisions, SEPTEMBER, leaveKeys, leaveRecords);
    const absent = rowOfMember(view, VIEWER_MEMBER);
    const before = rowOfMember(tableOf(admin, collisionsFrom(admin, [WORKED]), SEPTEMBER, [], NO_LEAVE_RECORDS), ANA);
    const ana = rowOfMember(view, ANA);
    const bandSum = (row: OrganizationHoursRow) => row.hours.bands.map((band) => band.minutes).reduce((x, y) => x + y, 0);

    expect(absent.hours.leaveMinutes).toBe(TWELVE_HOURS);
    expect(absent.conflictCount).toBe(2);
    expect(ana.hours.leaveMinutes).toBe(0);
    expect(ana.shiftCount).toBe(before.shiftCount + 1);
    expect(bandSum(ana)).toBe(bandSum(before) + TWELVE_HOURS);
  });

  it("names the replacement on the absent member's leave line, on both paths", () => {
    for (const snapshot of [replacedAdmin, replacedMember]) {
      const state = stateOf(snapshot, replaced);
      const view = hoursExplanationOf(
        snapshot,
        { memberId: snapshot === replacedAdmin ? VIEWER_MEMBER : null, figure: { code: HOURS_FIGURE_LEAVE } },
        monthHeaderOf(SEPTEMBER, TODAY),
        state.leaveKeys,
        state.collisions,
        state.leaveRecords,
        state.acceptedKeys,
      );

      if (view?.kind !== EXPLANATION_LEAVE) throw new Error('refused');
      expect(state.acceptedKeys).toEqual([]);
      // The replaced date is still a charged leave day: the absent member stays rostered, on leave.
      expect(view.lines[0]?.key).toBe('2026-09-10');
      expect(view.lines[0]?.decisions).toEqual([LEAVE_DECISION_REPLACED]);
      expect(view.lines[0]?.label).toBe('Smjena A · Dan · Zamjena osobe');
    }
  });

  it("fills the absent member's own month with the leave days Godišnji charges", () => {
    const { collisions, leaveKeys, leaveRecords } = stateOf(replacedMember, replaced);
    const view = ownOf(replacedMember, collisions, SEPTEMBER, leaveKeys, leaveRecords);
    const charged = leaveCostOf(memberScheduleInputOf(replacedMember, replacedMember.viewer), '2026-09-10', '2026-09-14');

    expect(charged).toBeGreaterThan(0);
    expect(view.leave).toEqual({ key: 'count.days', values: { count: charged } });
  });

  describe('Hours: a replacement that no longer applies (story 5.5d)', () => {
    let pendingAdmin: CalendarSnapshot;
    let pendingMember: CalendarSnapshot;

    beforeAll(async () => {
      // The same resolution, its override written before the seeded rotation's stamp: pending, so not applied.
      const rosterOverrides = [
        calendarRosterOverrideRow('ro-ana', a, '2026-09-10', null, ANA, { createdAt: '2019-01-01T00:00:00+00:00' }),
      ];

      pendingAdmin = await snapshotOf(PILOT, { rosterOverrides });
      pendingMember = await snapshotOf(PILOT, { role: 'member_role', rosterOverrides });
    });

    it('feeds no leave key, on the admin path and on the member path alike', () => {
      expect(stateOf(pendingAdmin, replaced).leaveKeys).toEqual([]);
      expect(stateOf(pendingMember, replaced).leaveKeys).toEqual([]);
      expect(hoursLeaveKeysOf(pendingMember, replaced)).toEqual([]);
    });

    it("returns the absent member's shift to band hours and counts its conflict again, on both sides", () => {
      const adminState = stateOf(pendingAdmin, replaced);
      const memberState = stateOf(pendingMember, replaced);
      const absent = rowOfMember(
        tableOf(pendingAdmin, adminState.collisions, SEPTEMBER, adminState.leaveKeys, adminState.leaveRecords),
        VIEWER_MEMBER,
      );
      const own = ownOf(pendingMember, memberState.collisions, SEPTEMBER, memberState.leaveKeys, memberState.leaveRecords);

      expect(absent.hours.leaveMinutes).toBe(0);
      expect(absent.conflictCount).toBe(3);
      // The leave still counts its three days, all in unresolved conflict again.
      expect(own.leave).toEqual({ key: 'count.days', values: { count: 3 } });
      expect(absent.leaveDays).toBe(3);
      expect(memberState.collisions).toHaveLength(adminState.collisions.length);
    });
  });
});

describe('the explanation marks a shift in unresolved conflict as the view counts it (story 7.14; FR-42b)', () => {
  const a = teamOf(PILOT, 0);
  const header = monthHeaderOf(SEPTEMBER, TODAY);

  /** The lines of the viewer's total, over the collisions and leave keys *Sati* holds. */
  function totalLinesOf(snapshot: CalendarSnapshot, memberId: string | null, resolutionRows: readonly Row[] = []) {
    const state = ready(snapshot, [WORKED], resolutionRows);

    if (state.kind !== HOURS_CONFLICTS_READY) throw new Error(state.kind);

    const view = hoursExplanationOf(
      snapshot,
      { memberId, figure: { code: HOURS_FIGURE_TOTAL } },
      header,
      state.leaveKeys,
      state.collisions,
      state.leaveRecords,
      state.acceptedKeys,
    );

    if (view === null) throw new Error('refused');
    if (view.kind !== EXPLANATION_HOURS) throw new Error(view.kind);

    return view.lines;
  }

  function markedOf(lines: readonly HoursExplanationLine[]): readonly string[] {
    return lines.filter((line) => line.conflict).map((line) => line.key);
  }

  it("marks each rostered shift the leave collides with on the admin's explanation, as many as the table counts, and no other", () => {
    const lines = totalLinesOf(admin, VIEWER_MEMBER);

    // The worked example: Dan 10.09, Noć 11.09 and Dan 14.09 of the viewer's team.
    expect(markedOf(lines)).toEqual([`2026-09-10|${a}`, `2026-09-11|${a}`, `2026-09-14|${a}`]);
    expect(lines.length).toBeGreaterThan(3);
    expect(markedOf(lines)).toHaveLength(rowOfMember(tableOf(admin, collisionsFrom(admin, [WORKED]), SEPTEMBER, [], NO_LEAVE_RECORDS), VIEWER_MEMBER).conflictCount);
    // Another member's explanation has no conflict to mark.
    expect(markedOf(totalLinesOf(admin, ANA))).toEqual([]);
  });

  it("marks the same shifts on a member's own explanation", () => {
    expect(markedOf(totalLinesOf(member, null))).toEqual(markedOf(totalLinesOf(admin, VIEWER_MEMBER)));
  });

  it('leaves a resolved conflict unmarked: its shift still counts, without the mark', () => {
    const lines = totalLinesOf(admin, VIEWER_MEMBER, [resolutionOf(VIEWER_MEMBER, '2026-09-11', a, 'amend_leave')]);

    expect(lines.map((line) => line.key)).toContain(`2026-09-11|${a}`);
    expect(markedOf(lines)).toEqual([`2026-09-10|${a}`, `2026-09-14|${a}`]);
  });
});

describe("the leave's ⓘ lists the charged dates, in days only (leave in days, 2026-10-10)", () => {
  const a = teamOf(PILOT, 0);
  const header = monthHeaderOf(SEPTEMBER, TODAY);
  // 10.09 is a 12 h Dan of the viewer's team, in conflict with WORKED, accepted as uncovered.
  const accepted = [resolutionOf(VIEWER_MEMBER, '2026-09-10', a)];

  function leaveOf(snapshot: CalendarSnapshot, memberId: string | null, resolutionRows: readonly Row[] = []) {
    const state = ready(snapshot, [WORKED], resolutionRows);

    if (state.kind !== HOURS_CONFLICTS_READY) throw new Error(state.kind);

    const view = hoursExplanationOf(
      snapshot,
      { memberId, figure: { code: HOURS_FIGURE_LEAVE } },
      header,
      state.leaveKeys,
      state.collisions,
      state.leaveRecords,
      state.acceptedKeys,
    );

    if (view === null) throw new Error('refused');
    if (view.kind !== EXPLANATION_LEAVE) throw new Error(view.kind);

    return view;
  }

  function amountOf(line: LeaveExplanationLine): string {
    return t(line.amount.key, line.amount.values);
  }

  it('has a line per charged date, +1 dan each, the decision named on the accepted one, ⚠ on the unresolved, = 3 dana', () => {
    const view = leaveOf(admin, VIEWER_MEMBER, accepted);
    // The row from the same ready state as the dialog: the same collisions, keys and records.
    const state = ready(admin, [WORKED], accepted);

    if (state.kind !== HOURS_CONFLICTS_READY) throw new Error(state.kind);
    const row = rowOfMember(tableOf(admin, state.collisions, SEPTEMBER, state.leaveKeys, state.leaveRecords), VIEWER_MEMBER);

    expect(view.lines.map((line) => line.key)).toEqual(['2026-09-10', '2026-09-11', '2026-09-14']);
    expect(view.lines.map(amountOf)).toEqual(['1 dan', '1 dan', '1 dan']);
    expect(view.lines.map((line) => line.conflict)).toEqual([false, true, true]);
    // A decided date does not pass unmarked: its pair carries the decision as its source word.
    expect(view.lines.map((line) => line.decisions)).toEqual([[LEAVE_DECISION_ACCEPTED], [], []]);
    expect(view.lines[0]!.label).toBe('Smjena A · Dan · Prihvaćeno kao nepokriveno');
    for (const line of view.lines.slice(1)) expect(line.label).toMatch(/^Smjena A · (Dan|Noć)$/);
    expect(t(view.total.key, view.total.values)).toBe('3 dana');
    expect(row.leaveDays).toBe(view.lines.length);
  });

  it('marks every charged date in unresolved conflict while nothing is decided', () => {
    const view = leaveOf(admin, VIEWER_MEMBER);

    expect(view.lines.map(amountOf)).toEqual(['1 dan', '1 dan', '1 dan']);
    expect(view.lines.every((line) => line.conflict)).toBe(true);
    expect(t(view.total.key, view.total.values)).toBe('3 dana');
  });

  it("is the same on a member's own path", () => {
    const own = leaveOf(member, null, accepted);
    const admins = leaveOf(admin, VIEWER_MEMBER, accepted);

    expect(own.lines).toEqual(admins.lines);
    expect(own.total).toEqual(admins.total);
  });

  it('is unavailable while the leave read is not ready, never a leave of no records', () => {
    expect(hoursExplanationOf(admin, { memberId: VIEWER_MEMBER, figure: { code: HOURS_FIGURE_LEAVE } }, header, [], [], null, [])).toBeNull();
    expect(hoursExplanationOf(admin, { memberId: VIEWER_MEMBER, figure: { code: HOURS_FIGURE_TOTAL } }, header, [], [], null, [])).not.toBeNull();
  });
});

describe("several members' records on the admin path (leave in days, 2026-10-10)", () => {
  const ANA_WORKED = rowOf('record-ana', '2026-09-10', '2026-09-15', ANA);
  const ANA_LATE = rowOf('record-ana-late', '2026-09-28', '2026-10-04', ANA);

  it("counts each member's charged days over their own records, sorts and sums them", () => {
    const state = ready(admin, [WORKED, ANA_WORKED, ANA_LATE]);

    if (state.kind !== HOURS_CONFLICTS_READY) throw new Error(state.kind);

    expect(state.leaveRecords.get(ANA)).toEqual([
      { from: '2026-09-10', to: '2026-09-14' },
      { from: '2026-09-28', to: '2026-10-03' },
    ]);

    const anaInput = memberScheduleInputOf(admin, { ...admin.members.find((one) => one.id === ANA)!, memberId: ANA });
    const anaSeptember = leaveCostOf(anaInput, '2026-09-10', '2026-09-14') + leaveCostOf(anaInput, '2026-09-28', '2026-09-30');
    const anaOctober = leaveCostOf(anaInput, '2026-10-01', '2026-10-03');
    const september = tableOf(admin, state.collisions, SEPTEMBER, state.leaveKeys, state.leaveRecords);
    const october = tableOf(admin, state.collisions, OCTOBER, state.leaveKeys, state.leaveRecords);

    expect(anaSeptember).toBeGreaterThan(0);
    expect(rowOfMember(september, VIEWER_MEMBER).leaveDays).toBe(3);
    expect(rowOfMember(september, ANA).leaveDays).toBe(anaSeptember);
    expect(rowOfMember(october, ANA).leaveDays).toBe(anaOctober);
    expect(rowOfMember(october, VIEWER_MEMBER).leave).toBeNull();
    // The months of a record sum to its cost, as Godišnji charges it.
    expect(anaSeptember + anaOctober).toBe(
      leaveCostOf(anaInput, '2026-09-10', '2026-09-14') + leaveCostOf(anaInput, '2026-09-28', '2026-10-03'),
    );
    expect(september.footer?.leave).toEqual({ key: 'count.days', values: { count: 3 + anaSeptember } });

    const sorted = tableOf(admin, state.collisions, SEPTEMBER, state.leaveKeys, state.leaveRecords);
    const bySort = organizationHoursOf(
      admin,
      { mjesec: SEPTEMBER, sort: 'dopust', smjer: 'silazno' },
      TODAY,
      state.collisions,
      state.leaveKeys,
      state.leaveRecords,
    );

    if (!bySort.ok) throw new Error(bySort.code);
    expect(bySort.view.rows.map((row) => row.leaveDays)).toEqual(
      [...sorted.rows.map((row) => row.leaveDays)].sort((x, y) => y - x),
    );
  });
});
