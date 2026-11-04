import { shortStaffedShiftsOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ROSTER_CHANGE_REMOVAL, rosterChangeSnapshotOf } from '@/features/calendar/services/roster-erasures';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { LEAVE_CANDIDATE_ID } from '@/features/leave/services/leave-conflicts';
import { MEMBER_CHANGE_STATUS, memberChangeSnapshotOf } from '@/features/members/services/member-erasures';
import {
  SHORT_STAFFED_HORIZON_DAYS,
  SHORT_STAFFED_KNOWN,
  SHORT_STAFFED_SHOWN_ROWS,
  SHORT_STAFFED_UNAVAILABLE,
  SHORT_STAFFED_UNKNOWN,
  configurationReportOf,
  coverageAgainstMinimumOf,
  dayWindowOf,
  horizonWindowOf,
  leaveChangeReportOf,
  minimumOfCalendar,
  readsStaffingLeaveOf,
  shortStaffedReportOf,
  staffingInputOf,
  staffingRecordsOf,
  type ShortStaffedReport,
  type StaffingLeaveSource,
} from '@/features/staffing/services/short-staffed';
import {
  OVERRIDE_ID,
  REPLACEMENT,
  STAFFING_FIXTURES,
  firstWorkingDayOf,
  leaveRead,
  leaveRow,
  member,
  rosterOverrideOn,
  staffingSnapshotOf,
} from '@/features/staffing/staffing.fixture';
import { initLocalization, t } from '@/lib/i18n';

/**
 * Story 11.2's report, executed (AD-15) over real snapshots of both fixtures:
 * every row of the spec's matrix — a leave that makes a shift short, one
 * already short, a replacement removed, a deactivation over the horizon, the
 * setting empty, the unknown states — and the resolution strip's coverage.
 */

const ONE = '00000000-0000-4000-8000-00000000c001';
const TWO = '00000000-0000-4000-8000-00000000c002';
const THREE = '00000000-0000-4000-8000-00000000c003';

/** A leave read every getter of which throws: proof that nothing looked at it. */
const UNTOUCHABLE: StaffingLeaveSource = {
  get isPending(): boolean {
    throw new Error('the leave was read');
  },
  get isError(): boolean {
    throw new Error('the leave was read');
  },
  get data(): readonly unknown[] | undefined {
    throw new Error('the leave was read');
  },
};

function known(report: ShortStaffedReport | null) {
  if (report === null || report.kind !== SHORT_STAFFED_KNOWN) throw new Error(`not known: ${JSON.stringify(report)}`);

  return report;
}

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(STAFFING_FIXTURES)('$name', (fixture) => {
  let four: CalendarSnapshot;
  let day: { date: string; shiftTypeId: string };
  let typeName: string;

  beforeAll(async () => {
    four = await staffingSnapshotOf(fixture, { size: 4, minimum: 3 });
    day = firstWorkingDayOf(four, fixture);
    typeName = four.types.find((type) => type.id === day.shiftTypeId)?.name ?? '';
  });

  it('reads the minimum off the snapshot, and an admin reads the leave only while it is set', async () => {
    const empty = await staffingSnapshotOf(fixture, { size: 4, minimum: null });
    const memberView = await staffingSnapshotOf(fixture, { size: 4, minimum: 3, role: 'member_role' });

    expect(minimumOfCalendar(four)).toBe(3);
    expect(minimumOfCalendar(empty)).toBeNull();
    // A snapshot cached before story 11.2 carries no such field.
    const { minimumMembers: _dropped, ...cached } = four;
    expect(minimumOfCalendar(cached as CalendarSnapshot)).toBeNull();
    expect(readsStaffingLeaveOf(four)).toBe(true);
    expect(readsStaffingLeaveOf(empty)).toBe(false);
    expect(readsStaffingLeaveOf(memberView)).toBe(false);
    expect(readsStaffingLeaveOf(null)).toBe(false);
  });

  it('leaves out a row of a member the snapshot does not hold yet: a race, on no roster of it', () => {
    expect(
      staffingRecordsOf(
        four,
        leaveRead([leaveRow(ONE, member(1), day.date, day.date), leaveRow(TWO, 'created-since', day.date, day.date)]),
      ),
    ).toEqual([{ id: ONE, memberId: member(1), from: day.date, to: day.date }]);
  });

  it('mirrors the queue recipe: the active teams, the leave as given and the minimum', () => {
    const input = staffingInputOf(four, [{ id: ONE, memberId: member(1), from: day.date, to: day.date }]);

    expect(input.teamIds).toEqual(four.teams.filter((team) => !team.archived).map((team) => team.id));
    expect(input.minimumMembers).toBe(3);
    expect(input.leaveRecords).toEqual([{ id: ONE, memberId: member(1), from: day.date, to: day.date }]);
  });

  it('leave makes short: a team of 4, one already on leave, a second recorded', () => {
    const report = leaveChangeReportOf(four, leaveRead([leaveRow(ONE, member(1), day.date, day.date)]), {
      memberId: member(2),
      targetId: null,
      candidateId: LEAVE_CANDIDATE_ID,
      next: dayWindowOf(day.date),
    });
    const { rows, more } = known(report);

    expect(more).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: day.date, teamId: fixture.team, teamName: fixture.teamName, atWork: 2, minimum: 3 });
    expect(rows[0]?.shiftTypeName).toBe(typeName);
    expect(
      t('popunjenost.row', {
        team: rows[0]?.teamName,
        date: rows[0]?.dayMonth,
        type: rows[0]?.shiftTypeName,
        atWork: t('popunjenost.atWork', { atWork: 2, minimum: 3 }),
      }),
    ).toBe(`Smjena A, ${rows[0]?.dayMonth ?? ''} ${typeName}: rade 2 od najmanje 3`);
  });

  it('an amend moves the record onto a shift: the amended range, the same id', () => {
    const elsewhere = '2026-12-20';
    const report = leaveChangeReportOf(
      four,
      leaveRead([leaveRow(ONE, member(1), day.date, day.date), leaveRow(TWO, member(2), elsewhere, elsewhere)]),
      { memberId: member(2), targetId: TWO, candidateId: LEAVE_CANDIDATE_ID, next: dayWindowOf(day.date) },
    );

    expect(known(report).rows.map((row) => row.atWork)).toEqual([2]);
  });

  it('one on leave of four is not short, and a shift short before and after is no row', () => {
    const one = leaveChangeReportOf(four, leaveRead([]), {
      memberId: member(1),
      targetId: null,
      candidateId: LEAVE_CANDIDATE_ID,
      next: dayWindowOf(day.date),
    });
    const already = leaveChangeReportOf(
      four,
      leaveRead([leaveRow(ONE, member(1), day.date, day.date), leaveRow(TWO, member(2), day.date, day.date)]),
      { memberId: member(3), targetId: null, candidateId: LEAVE_CANDIDATE_ID, next: dayWindowOf(day.date) },
    );

    expect(known(one).rows).toEqual([]);
    expect(known(already).rows).toEqual([]);
  });

  it('a replacement removed drops the shift below the minimum', async () => {
    const rows = [leaveRow(ONE, member(1), day.date, day.date), leaveRow(TWO, member(2), day.date, day.date)];
    const replaced = await staffingSnapshotOf(fixture, {
      size: 4,
      minimum: 3,
      rosterOverrides: [rosterOverrideOn(fixture, day.date, member(1), REPLACEMENT)],
    });
    const applied = rosterChangeSnapshotOf(replaced, { kind: ROSTER_CHANGE_REMOVAL, overrideId: OVERRIDE_ID });

    if (!applied.ok) throw new Error(applied.code);

    // Replaced: 3 at work, not short.
    expect(coverageAgainstMinimumOf(replaced, staffingRecordsOf(replaced, leaveRead(rows)) ?? [], fixture.team, day.date)).toEqual({
      atWork: 3,
      minimum: 3,
      short: false,
    });
    expect(known(configurationReportOf(replaced, applied.after, dayWindowOf(day.date), leaveRead(rows))).rows).toMatchObject([
      { date: day.date, teamId: fixture.team, atWork: 2, minimum: 3 },
    ]);
  });

  it('a deactivation of a team of 3 at minimum 3: the first 5 shifts ahead, then how many more', async () => {
    const three = await staffingSnapshotOf(fixture, { size: 3, minimum: 3 });
    const applied = memberChangeSnapshotOf(
      three,
      { kind: MEMBER_CHANGE_STATUS, memberId: member(2), active: false, day: day.date },
      '2026-09-30',
    );

    if (!applied.ok) throw new Error(applied.code);

    const window = horizonWindowOf(day.date);
    const report = known(configurationReportOf(three, applied.after, window, leaveRead([])));
    // The other teams have nobody, so they are short before and after: only this team's are new.
    const all = shortStaffedShiftsOf(staffingInputOf(applied.after, []), window.from, window.to).filter(
      (shift) => shift.teamId === fixture.team,
    );

    expect(report.rows).toHaveLength(SHORT_STAFFED_SHOWN_ROWS);
    expect(report.rows.map((row) => row.date)).toEqual(all.slice(0, 5).map((shift) => shift.date));
    expect(report.rows[0]).toMatchObject({ date: day.date, atWork: 2, minimum: 3 });
    expect(report.more).toBe(all.length - SHORT_STAFFED_SHOWN_ROWS);
    expect(report.more).toBeGreaterThan(50);
    expect(t('popunjenost.more', { count: report.more })).toBe(`i još ${String(report.more)}`);
  });

  it('setting empty: no report, and the leave is never looked at', async () => {
    const empty = await staffingSnapshotOf(fixture, { size: 4, minimum: null });

    expect(configurationReportOf(empty, empty, dayWindowOf(day.date), UNTOUCHABLE)).toBeNull();
    expect(
      leaveChangeReportOf(empty, UNTOUCHABLE, {
        memberId: member(1),
        targetId: null,
        candidateId: LEAVE_CANDIDATE_ID,
        next: dayWindowOf(day.date),
      }),
    ).toBeNull();
    expect(shortStaffedReportOf({ calendar: empty, records: null }, { calendar: empty, records: null }, dayWindowOf(day.date))).toBeNull();
    expect(coverageAgainstMinimumOf(empty, [], fixture.team, day.date)).toBeNull();
  });

  it('unknown while the leave read is pending: the neutral line, and nothing logged — a wait, not a fault', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(configurationReportOf(four, four, dayWindowOf(day.date), { isPending: true, isError: false, data: undefined })).toEqual({
      kind: SHORT_STAFFED_UNKNOWN,
    });
    expect(logged).not.toHaveBeenCalled();
  });

  it('a viewer who is not an admin observes no organization leave: no block, no line, nothing logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const memberView = await staffingSnapshotOf(fixture, { size: 4, minimum: 3, role: 'member_role' });

    expect(configurationReportOf(memberView, memberView, dayWindowOf(day.date), null)).toBeNull();
    expect(
      leaveChangeReportOf(memberView, null, {
        memberId: member(1),
        targetId: null,
        candidateId: LEAVE_CANDIDATE_ID,
        next: dayWindowOf(day.date),
      }),
    ).toBeNull();
    expect(logged).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'failed', leave: { isPending: false, isError: true, data: undefined } },
    { name: 'untrusted', leave: leaveRead([{ id: THREE, member_id: member(1), during: 'not a range' }]) },
    { name: 'nameless', leave: leaveRead([{ id: THREE, during: '[2026-10-01,2026-10-02)' }]) },
  ])('unknown while the leave read is $name: one neutral line, logged', ({ leave }) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(configurationReportOf(four, four, dayWindowOf(day.date), leave)).toEqual({ kind: SHORT_STAFFED_UNKNOWN });
    expect(logged).toHaveBeenCalledWith(SHORT_STAFFED_UNAVAILABLE, expect.anything());
  });

  it('unknown on a RangeError of the domain, logged; anything else is rethrown', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(configurationReportOf(four, four, { from: '2026-10-10', to: '2026-10-01' }, leaveRead([]))).toEqual({
      kind: SHORT_STAFFED_UNKNOWN,
    });
    expect(logged).toHaveBeenCalledWith(SHORT_STAFFED_UNAVAILABLE, expect.any(RangeError));
    expect(() =>
      shortStaffedReportOf(
        { calendar: four, records: [] },
        { calendar: { ...four, teams: null } as unknown as CalendarSnapshot, records: [] },
        dayWindowOf(day.date),
      ),
    ).toThrow(TypeError);
  });

  it('resolution strip: 2 at work is short of 3, and with a replacement on it is not', () => {
    const records = staffingRecordsOf(
      four,
      leaveRead([leaveRow(ONE, member(1), day.date, day.date), leaveRow(TWO, member(2), day.date, day.date)]),
    );

    if (records === null) throw new Error('records');

    expect(coverageAgainstMinimumOf(four, records, fixture.team, day.date)).toEqual({ atWork: 2, minimum: 3, short: true });
    expect(t('popunjenost.atWork', { atWork: 2, minimum: 3 })).toBe('rade 2 od najmanje 3');
    expect(t('popunjenost.atWork', { atWork: 0, minimum: 3 })).toBe('ne radi nitko od najmanje 3');
    expect(t('popunjenost.atWork', { atWork: 1, minimum: 3 })).toBe('radi 1 od najmanje 3');
    expect(t('popunjenost.atWork', { atWork: 5, minimum: 6 })).toBe('radi 5 od najmanje 6');
  });
});

describe('the window', () => {
  it(`runs ${String(SHORT_STAFFED_HORIZON_DAYS)} days from the change's date, the date included`, () => {
    expect(horizonWindowOf('2026-10-14')).toEqual({ from: '2026-10-14', to: '2027-10-14' });
    expect(horizonWindowOf('2027-03-01')).toEqual({ from: '2027-03-01', to: '2028-02-29' });
    expect(dayWindowOf('2026-10-14')).toEqual({ from: '2026-10-14', to: '2026-10-14' });
  });
});

describe('the source', () => {
  it('never reads a fire rank or a team position', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./short-staffed.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/fireRank|\.position\b|position:/);
  });
});
