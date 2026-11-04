import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  overrideRemovalShortStaffedOf,
  overrideShortStaffedOf,
  rosterRemovalShortStaffedOf,
  rosterShortStaffedOf,
} from '@/features/calendar/utils/change-preview';
import { ROSTER_NOBODY, dayDetailOf, type DayDetail } from '@/features/calendar/utils/day-detail';
import { resolutionStaffingOf } from '@/features/conflicts/services/resolution-screen';
import { LEAVE_CANDIDATE_ID } from '@/features/leave/services/leave-conflicts';
import { AMEND_ENDS, AMEND_REMOVES, AMEND_STARTS } from '@/features/leave/services/leave-section';
import { shownDeactivationShortStaffedOf } from '@/features/members/services/deactivation-consequence';
import { shownTeamMoveShortStaffedOf } from '@/features/members/services/team-move-preview';
import { DEACTIVATE, REACTIVATE, TEAM_MOVE, type TeamMoveOffer } from '@/features/members/services/write';
import { draftShortStaffedOf } from '@/features/rotation/services/erasures';
import { readRotation, type RotationSnapshot } from '@/features/rotation/services/list';
import { answerOf, rotationTableOf } from '@/features/rotation/rotation.fixture';
import { prefillOf, withEffectiveFrom, withTeamStep } from '@/features/rotation/utils/draft';
import {
  SHORT_STAFFED_KNOWN,
  SHORT_STAFFED_SHOWN_ROWS,
  dayWindowOf,
  leaveChangeReportOf,
  staffingRecordsOf,
  type ShortStaffedReport,
  type StaffingLeaveSource,
} from '@/features/staffing/services/short-staffed';
import {
  OVERRIDE_ID,
  REPLACEMENT,
  STAFFING_FIXTURES,
  firstDayOffOf,
  firstWorkingDayOf,
  leaveRead,
  leaveRow,
  member,
  rosterOverrideOn,
  staffingSnapshotOf,
  typeOverrideOn,
} from '@/features/staffing/staffing.fixture';
import { initLocalization } from '@/lib/i18n';
import { nextIsoDate, previousIsoDate } from '@/lib/i18n/format';

/**
 * Story 11.2, surface by surface (AD-15): each save that can newly leave a
 * working shift short of people reports it from its own erasure "after" —
 * the day detail's roster and type dialogs and their removals, the
 * deactivation, the team move, the rotation save, and the resolution strip's
 * coverage — and each says nothing, reading no leave, with the setting empty.
 * Both fixtures. The leave dialog and a request's approval are the report's
 * own `leaveChangeReportOf` (its suite) and `leave-request-review.test.ts`.
 */

const ONE = '00000000-0000-4000-8000-00000000d001';
const TWO = '00000000-0000-4000-8000-00000000d002';
const THREE = '00000000-0000-4000-8000-00000000d003';
const TODAY = '2026-09-30';

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

function rowsOf(report: ShortStaffedReport | null) {
  if (report === null || report.kind !== SHORT_STAFFED_KNOWN) throw new Error(`not known: ${JSON.stringify(report)}`);

  return report.rows;
}

function detailOf(snapshot: CalendarSnapshot, team: string, date: string): DayDetail {
  const detail = dayDetailOf(snapshot, team, date);

  if (detail === null) throw new Error('no detail');

  return detail;
}

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(STAFFING_FIXTURES)('$name', (fixture) => {
  let four: CalendarSnapshot;
  let empty: CalendarSnapshot;
  let day: { date: string; shiftTypeId: string };
  let off: string;

  beforeAll(async () => {
    four = await staffingSnapshotOf(fixture, { size: 4, minimum: 3 });
    empty = await staffingSnapshotOf(fixture, { size: 4, minimum: null });
    day = firstWorkingDayOf(four, fixture);
    off = firstDayOffOf(four, fixture);
  });

  describe('the day detail', () => {
    it('a roster change taking one off, with another on leave, leaves the shift short', () => {
      const leave = leaveRead([leaveRow(ONE, member(2), day.date, day.date)]);
      const detail = detailOf(four, fixture.team, day.date);

      expect(rowsOf(rosterShortStaffedOf(four, detail, member(1), ROSTER_NOBODY, leave))).toMatchObject([
        { date: day.date, teamId: fixture.team, atWork: 2, minimum: 3 },
      ]);
      // A replacement in their place keeps three at work.
      expect(rowsOf(rosterShortStaffedOf(four, detail, member(1), REPLACEMENT, leave))).toEqual([]);
      // Nobody either way is no change, and the setting empty reads no leave.
      expect(rosterShortStaffedOf(four, detail, ROSTER_NOBODY, ROSTER_NOBODY, leave)).toBeNull();
      expect(rosterShortStaffedOf(empty, detailOf(empty, fixture.team, day.date), member(1), ROSTER_NOBODY, UNTOUCHABLE)).toBeNull();
    });

    it('removing a replacement drops the shift below the minimum: the removal confirmation says so', async () => {
      const leave = leaveRead([leaveRow(ONE, member(1), day.date, day.date), leaveRow(TWO, member(2), day.date, day.date)]);
      const rosterOverrides = [rosterOverrideOn(fixture, day.date, member(1), REPLACEMENT)];
      const replaced = await staffingSnapshotOf(fixture, { size: 4, minimum: 3, rosterOverrides });
      const unset = await staffingSnapshotOf(fixture, { size: 4, minimum: null, rosterOverrides });

      expect(
        rowsOf(rosterRemovalShortStaffedOf(replaced, day.date, OVERRIDE_ID, leave)),
      ).toMatchObject([{ date: day.date, atWork: 2, minimum: 3 }]);
      expect(rosterRemovalShortStaffedOf(unset, day.date, OVERRIDE_ID, UNTOUCHABLE)).toBeNull();
    });

    it('a type change making a day off a working one, with two on leave, leaves it short', () => {
      const leave = leaveRead([leaveRow(ONE, member(1), off, off), leaveRow(TWO, member(2), off, off)]);

      expect(rowsOf(overrideShortStaffedOf(four, detailOf(four, fixture.team, off), day.shiftTypeId, leave))).toMatchObject([
        { date: off, atWork: 2, minimum: 3 },
      ]);
      expect(overrideShortStaffedOf(empty, detailOf(empty, fixture.team, off), day.shiftTypeId, UNTOUCHABLE)).toBeNull();
    });

    it('the projected type is no change: nothing, and no leave read', () => {
      const detail = detailOf(four, fixture.team, day.date);

      expect(detail.projectedShiftTypeId).not.toBeNull();
      expect(overrideShortStaffedOf(four, detail, detail.projectedShiftTypeId ?? '', UNTOUCHABLE)).toBeNull();
    });

    it('removing a type change that freed a working day, with two on leave, leaves it short', async () => {
      const leave = leaveRead([leaveRow(ONE, member(1), day.date, day.date), leaveRow(TWO, member(2), day.date, day.date)]);
      const overrides = [typeOverrideOn(fixture, day.date, fixture.offType)];
      const freed = await staffingSnapshotOf(fixture, { size: 4, minimum: 3, overrides });
      const unset = await staffingSnapshotOf(fixture, { size: 4, minimum: null, overrides });
      const detail = detailOf(freed, fixture.team, day.date);
      const id = detail.override?.id ?? null;

      expect(id).not.toBeNull();
      expect(rowsOf(overrideRemovalShortStaffedOf(freed, day.date, id, leave))).toMatchObject([
        { date: day.date, atWork: 2, minimum: 3 },
      ]);
      expect(overrideRemovalShortStaffedOf(unset, day.date, id, UNTOUCHABLE)).toBeNull();
    });
  });

  describe('the leave dialog', () => {
    it('a range sharing a date with another of the member’s records says nothing, as the conflicts do', () => {
      const leave = leaveRead([leaveRow(ONE, member(1), day.date, day.date)]);

      expect(
        leaveChangeReportOf(four, leave, {
          memberId: member(1),
          targetId: null,
          candidateId: LEAVE_CANDIDATE_ID,
          next: { from: previousIsoDate(day.date) ?? day.date, to: day.date },
        }),
      ).toBeNull();
      // Its own record amended over the same date is no overlap.
      expect(
        leaveChangeReportOf(four, leave, {
          memberId: member(1),
          targetId: ONE,
          candidateId: LEAVE_CANDIDATE_ID,
          next: dayWindowOf(day.date),
        }),
      ).not.toBeNull();
    });
  });

  describe('the member page', () => {
    it('a deactivation of a team of 3 at minimum 3 lists the first 5 shifts ahead and how many more', async () => {
      const three = await staffingSnapshotOf(fixture, { size: 3, minimum: 3 });
      const unset = await staffingSnapshotOf(fixture, { size: 3, minimum: null });
      const offer = { change: DEACTIVATE, minimum: TODAY } as const;
      const report = shownDeactivationShortStaffedOf(three, member(2), offer, day.date, TODAY, leaveRead([]));

      expect(rowsOf(report)).toHaveLength(SHORT_STAFFED_SHOWN_ROWS);
      expect(report?.kind === SHORT_STAFFED_KNOWN ? report.more : 0).toBeGreaterThan(50);
      // A reactivation only adds back, and the setting empty reads no leave.
      expect(shownDeactivationShortStaffedOf(three, member(2), { change: REACTIVATE, minimum: TODAY }, day.date, TODAY, leaveRead([]))).toBeNull();
      expect(shownDeactivationShortStaffedOf(unset, member(2), offer, day.date, TODAY, UNTOUCHABLE)).toBeNull();
    });

    it('a team move out of a team of 3 at minimum 3 leaves it short from the date', async () => {
      const three = await staffingSnapshotOf(fixture, { size: 3, minimum: 3 });
      const unset = await staffingSnapshotOf(fixture, { size: 3, minimum: null });
      const offer: TeamMoveOffer = {
        change: TEAM_MOVE,
        state: { team: { id: fixture.team, name: fixture.teamName }, scheduled: null },
        today: TODAY,
        choices: [{ id: fixture.otherTeam, name: 'Smjena B' }],
        offersNoTeam: true,
        positions: false,
        current: { id: fixture.team, name: fixture.teamName },
        currentPosition: null,
        minimum: TODAY,
      };

      expect(rowsOf(shownTeamMoveShortStaffedOf(three, member(2), offer, fixture.otherTeam, day.date, TODAY, leaveRead([])))[0]).toMatchObject({
        date: day.date,
        teamId: fixture.team,
        atWork: 2,
        minimum: 3,
      });
      expect(shownTeamMoveShortStaffedOf(three, member(2), offer, '', day.date, TODAY, leaveRead([]))).toBeNull();
      expect(shownTeamMoveShortStaffedOf(unset, member(2), offer, fixture.otherTeam, day.date, TODAY, UNTOUCHABLE)).toBeNull();
    });
  });

  describe('the rotation save', () => {
    let rotation: RotationSnapshot;

    beforeAll(async () => {
      const outcome = await readRotation(rotationTableOf(answerOf(fixture.rows)));

      if (!outcome.ok) throw new Error(outcome.code);

      rotation = outcome.snapshot;
    });

    it('a new rotation putting the team on other days, two on leave all month, leaves those days short', () => {
      const leave = leaveRead([leaveRow(ONE, member(1), '2026-10-01', '2026-10-31'), leaveRow(TWO, member(2), '2026-10-01', '2026-10-31')]);
      const draft = withTeamStep(withEffectiveFrom(prefillOf(rotation, TODAY), '2026-10-01'), fixture.team, 2);
      const rows = rowsOf(draftShortStaffedOf(four, rotation, draft, TODAY, leave));

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.teamId === fixture.team && row.atWork === 2 && row.minimum === 3)).toBe(true);
      expect(rows[0]?.date.startsWith('2026-10')).toBe(true);
      expect(draftShortStaffedOf(empty, rotation, draft, TODAY, UNTOUCHABLE)).toBeNull();
      // A draft the save would refuse before any check says nothing.
      expect(draftShortStaffedOf(four, rotation, withEffectiveFrom(draft, '2026-09-01'), TODAY, leave)).toBeNull();
    });
  });

  describe('the resolution strip', () => {
    it('states people at work against the minimum over each option’s own after', () => {
      const records = staffingRecordsOf(
        four,
        leaveRead([leaveRow(ONE, member(1), day.date, day.date), leaveRow(TWO, member(2), day.date, day.date)]),
      );

      if (records === null) throw new Error('records');

      const collision = { memberId: member(1), date: day.date, teamId: fixture.team, shiftTypeId: day.shiftTypeId, leaveRecordId: ONE };
      const record = { id: ONE, from: day.date, to: day.date };

      expect(resolutionStaffingOf(four, records, collision, record, { kind: AMEND_REMOVES })).toEqual({
        accept: { atWork: 2, minimum: 3, short: true },
        replace: { atWork: 3, minimum: 3, short: false },
        replaceBy: {},
        amend: { atWork: 3, minimum: 3, short: false },
      });
      expect(resolutionStaffingOf(empty, records, collision, record, { kind: AMEND_REMOVES })).toBeNull();
    });

    it('a multi-day record amended to start later or end earlier frees the date: the amend card counts them', () => {
      const before = previousIsoDate(day.date) ?? day.date;
      const after = nextIsoDate(day.date) ?? day.date;
      const records = staffingRecordsOf(
        four,
        leaveRead([leaveRow(ONE, member(1), before, after), leaveRow(TWO, member(2), day.date, day.date)]),
      );

      if (records === null) throw new Error('records');

      const collision = { memberId: member(1), date: day.date, teamId: fixture.team, shiftTypeId: day.shiftTypeId, leaveRecordId: ONE };
      const record = { id: ONE, from: before, to: after };
      const later = resolutionStaffingOf(four, records, collision, record, { kind: AMEND_STARTS, range: { from: after, to: after } });
      const earlier = resolutionStaffingOf(four, records, collision, record, { kind: AMEND_ENDS, range: { from: before, to: before } });

      expect(later?.accept).toEqual({ atWork: 2, minimum: 3, short: true });
      expect(later?.amend).toEqual({ atWork: 3, minimum: 3, short: false });
      expect(earlier?.amend).toEqual({ atWork: 3, minimum: 3, short: false });
    });

    it('the replace card follows the candidate picked: one on leave that day is not counted', () => {
      const records = staffingRecordsOf(
        four,
        leaveRead([
          leaveRow(ONE, member(1), day.date, day.date),
          leaveRow(TWO, member(2), day.date, day.date),
          leaveRow(THREE, REPLACEMENT, day.date, day.date),
        ]),
      );

      if (records === null) throw new Error('records');

      const collision = { memberId: member(1), date: day.date, teamId: fixture.team, shiftTypeId: day.shiftTypeId, leaveRecordId: ONE };
      const staffing = resolutionStaffingOf(four, records, collision, { id: ONE, from: day.date, to: day.date }, { kind: AMEND_REMOVES }, [
        REPLACEMENT,
      ]);

      // Before a pick: someone not on leave put on.
      expect(staffing?.replace).toEqual({ atWork: 3, minimum: 3, short: false });
      // The replacement picked is on leave that day: still two at work.
      expect(staffing?.replaceBy[REPLACEMENT]).toEqual({ atWork: 2, minimum: 3, short: true });
    });

    it('a figure that cannot be derived — the replacement refused — leaves every card on the shipped term', async () => {
      // A live change already takes the absent member off that day, so the replacement's write is refused.
      const taken = await staffingSnapshotOf(fixture, {
        size: 4,
        minimum: 3,
        rosterOverrides: [rosterOverrideOn(fixture, day.date, member(1), null)],
      });
      const records = staffingRecordsOf(taken, leaveRead([leaveRow(TWO, member(2), day.date, day.date)]));

      if (records === null) throw new Error('records');

      const collision = { memberId: member(1), date: day.date, teamId: fixture.team, shiftTypeId: day.shiftTypeId, leaveRecordId: ONE };

      expect(resolutionStaffingOf(taken, records, collision, { id: ONE, from: day.date, to: day.date }, { kind: AMEND_REMOVES })).toBeNull();
    });
  });
});
