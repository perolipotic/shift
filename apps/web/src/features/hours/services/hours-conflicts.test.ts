import { collisionsOf, type Collision } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CALENDAR_UNAVAILABLE, readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { collisionInputOf } from '@/features/conflicts/services/conflicts-queue';
import { hoursExportOf } from '@/features/hours/services/hours-export';
import {
  HOURS_CONFLICTS_LOADING,
  HOURS_CONFLICTS_READY,
  HOURS_CONFLICTS_UNAVAILABLE,
  conflictCountIn,
  conflictCountOf,
  conflictCountsOf,
  hoursCollisionsOf,
  hoursConflictsStateOf,
  type HoursConflictsState,
} from '@/features/hours/services/hours-conflicts';
import {
  HOURS_UNAVAILABLE,
  hoursSnapshotStateOf,
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
 * collisions `hoursCollisionsOf` derives. Each count is checked against
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
/** Only the worked example's two free days. */
const FREE = rowOf('record-free', '2026-09-12', '2026-09-14');

function ready(snapshot: CalendarSnapshot, rows: readonly Row[]): HoursConflictsState {
  return hoursConflictsStateOf(snapshot, { data: rows, isError: false, isPending: false, fetchStatus: 'idle' });
}

function collisionsFrom(snapshot: CalendarSnapshot, rows: readonly Row[]): readonly Collision[] {
  return hoursCollisionsOf(snapshot, rows);
}

function tableOf(snapshot: CalendarSnapshot, collisions: readonly Collision[], month = SEPTEMBER): OrganizationHoursView {
  const outcome = organizationHoursOf(snapshot, { mjesec: month }, TODAY, collisions);

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.view;
}

function rowOfMember(view: OrganizationHoursView, memberId: string): OrganizationHoursRow {
  const row = view.rows.find((one) => one.memberId === memberId);

  if (row === undefined) throw new Error(`no row of ${memberId}`);

  return row;
}

function ownOf(snapshot: CalendarSnapshot, collisions: readonly Collision[], month = SEPTEMBER): MyHoursView {
  const outcome = myHoursOf(snapshot, { mjesec: month }, TODAY, collisions);

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.view;
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
    const view = tableOf(admin, collisionsFrom(admin, [WORKED]));

    expect(rowOfMember(view, VIEWER_MEMBER).conflictCount).toBe(3);
    expect(rowOfMember(view, ANA).conflictCount).toBe(0);
  });

  it('changes no figure: band hours, total, shift count and leave are those of no leave', () => {
    const before = tableOf(admin, NO_COLLISIONS);
    const after = tableOf(admin, collisionsFrom(admin, [WORKED]));

    expect(after.rows.map(figuresOf)).toEqual(before.rows.map(figuresOf));
    // The leave figure stays empty: 5.4's "accept as uncovered" fills it.
    expect(rowOfMember(after, VIEWER_MEMBER).leave).toBeNull();
    expect(rowOfMember(after, VIEWER_MEMBER).hours.leaveMinutes).toBe(0);
  });

  it('is the number of collisionsOf dated in the month, through the queue’s own recipe', () => {
    const records = organizationLeaveRecordsOf([WORKED], admin.members.map((one) => one.id))!;
    const direct = collisionsOf(collisionInputOf(admin, records));

    expect(direct.map((collision) => collision.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-14']);
    expect(conflictCountOf(direct, VIEWER_MEMBER, SEPTEMBER)).toBe(3);
  });

  it('carries 3 into the sheet, a number cell under its own heading, and 0 on the other rows', () => {
    const view = tableOf(admin, collisionsFrom(admin, [WORKED]));
    const sheet = hoursExportOf(view, admin.organizationName);

    expect(sheet.columns.at(-1)).toBe(t('sati.organization.conflicts'));
    expect(t('sati.organization.conflicts')).toBe('Neriješeni konflikti');
    view.rows.forEach((row, index) => {
      expect(sheet.rows[index]!.at(-1)).toEqual({ kind: 'count', value: row.memberId === VIEWER_MEMBER ? 3 : 0 });
    });
  });

  it("shows the count on the viewer's own month, worded in every Croatian form", () => {
    const view = ownOf(member, collisionsFrom(member, [WORKED]));

    expect(view.conflictCount).toBe(3);
    expect(ownFiguresOf(view)).toEqual(ownFiguresOf(ownOf(member, NO_COLLISIONS)));
    expect(t('sati.conflicts', { count: 3 })).toBe('3 smjene u neriješenom konfliktu');
    expect(t('sati.conflicts', { count: 2 })).toBe('2 smjene u neriješenom konfliktu');
    expect(t('sati.conflicts', { count: 1 })).toBe('1 smjena u neriješenom konfliktu');
    expect(t('sati.conflicts', { count: 5 })).toBe('5 smjena u neriješenom konfliktu');
  });
});

describe('the month boundary', () => {
  it('counts each month only its own dates', () => {
    const collisions = collisionsFrom(admin, [ACROSS]);
    const september = rowOfMember(tableOf(admin, collisions, SEPTEMBER), VIEWER_MEMBER).conflictCount;
    const october = rowOfMember(tableOf(admin, collisions, OCTOBER), VIEWER_MEMBER).conflictCount;

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
    expect(rowOfMember(tableOf(snapshot, collisions), VIEWER_MEMBER).conflictCount).toBe(4);
  });
});

describe('none', () => {
  it.each([
    { name: 'no leave', rows: [] as readonly Row[] },
    { name: 'leave only over non-working days', rows: [FREE] },
  ])('$name: the table and the sheet show 0, and the own month adds nothing', ({ rows }) => {
    const view = tableOf(admin, collisionsFrom(admin, rows));
    const sheet = hoursExportOf(view, admin.organizationName);

    expect(view.rows.map((row) => row.conflictCount)).toEqual(view.rows.map(() => 0));
    expect(sheet.rows.map((cells) => cells.at(-1))).toEqual(view.rows.map(() => ({ kind: 'count', value: 0 })));
    expect(ownOf(member, collisionsFrom(member, rows)).conflictCount).toBeNull();
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
      const before = tableOf(snapshot, NO_COLLISIONS, month);
      const after = tableOf(snapshot, collisions, month);

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
    expect(hoursConflictsStateOf(admin, { data: undefined, isError: false, isPending: true, fetchStatus: 'fetching' })).toEqual({
      kind: HOURS_CONFLICTS_LOADING,
    });
  });

  it('is loading, not unavailable, while a role-gated read is not yet enabled', () => {
    // Between the snapshot naming the role and the read starting: pending, idle.
    expect(hoursConflictsStateOf(admin, { data: undefined, isError: false, isPending: true, fetchStatus: 'idle' })).toEqual({
      kind: HOURS_CONFLICTS_LOADING,
    });
  });

  it('is loading while a failed read is read again, cached rows or not: the retry is seen to work', () => {
    for (const data of [undefined, [WORKED]]) {
      expect(hoursConflictsStateOf(admin, { data, isError: true, isPending: data === undefined, fetchStatus: 'fetching' })).toEqual({
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
      expect(hoursConflictsStateOf(admin, answer)).toEqual({ kind: HOURS_CONFLICTS_UNAVAILABLE, retryable: true });
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
    expect(ready(admin, [WORKED])).toEqual({ kind: HOURS_CONFLICTS_READY, collisions: collisionsFrom(admin, [WORKED]) });
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

    expect(surface.organization).toEqual(tableOf(admin, collisionsFrom(admin, [WORKED])));
    expect(surface.retryable).toBe(false);
  });
});
