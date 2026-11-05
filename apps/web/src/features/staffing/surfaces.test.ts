import { peopleAtWorkOn } from '@shift/domain';
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
import {
  builderShortStaffedOf,
  cancelShortStaffedOf,
  cancelledCalendarSnapshotOf,
  draftShortStaffedOf,
} from '@/features/rotation/services/erasures';
import { readRotation, type RotationSnapshot } from '@/features/rotation/services/list';
import {
  REVIEW_ROSTER,
  REVIEW_SHIFT_TYPE,
  type PendingOverrideRow,
  type PendingRosterOverrideRow,
} from '@/features/rotation/services/override-disposition';
import {
  reviewAmendShortStaffedOf,
  reviewRowShortStaffedOf,
  reviewRowsShortStaffedOf,
} from '@/features/rotation/services/override-review-short-staffed';
import { answerOf, assignmentRow, rotationTableOf, type FixtureRows } from '@/features/rotation/rotation.fixture';
import { prefillOf, withEffectiveFrom, withTeamStep } from '@/features/rotation/utils/draft';
import {
  SHORT_STAFFED_KNOWN,
  SHORT_STAFFED_SHOWN_ROWS,
  SHORT_STAFFED_UNAVAILABLE,
  SHORT_STAFFED_UNKNOWN_REPORT,
  dayWindowOf,
  leaveChangeReportOf,
  staffingInputOf,
  staffingRecordsOf,
  type ShortStaffedReport,
  type StaffingLeaveSource,
} from '@/features/staffing/services/short-staffed';
import {
  OVERRIDE_ID,
  REPLACEMENT,
  STAFFING_FIXTURES,
  TYPE_OVERRIDE_ID,
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
 * Since Epic 11 retro A7, the two surfaces 11.2 deferred too: the rotation
 * cancel and the override review's confirm and amend. Both fixtures. The leave dialog and a request's approval are the report's
 * own `leaveChangeReportOf` (its suite) and `leave-request-review.test.ts`.
 */

const ONE = '00000000-0000-4000-8000-00000000d001';
const TWO = '00000000-0000-4000-8000-00000000d002';
const THREE = '00000000-0000-4000-8000-00000000d003';
const TODAY = '2026-09-30';
/** The date a change is scheduled from, and the instant it was saved (after every override the cases write). */
const SCHEDULED = '2026-10-01';
const SCHEDULED_AT = '2026-09-25T10:00:00.000001+00:00';
/** A version re-saved for the first team before the cases' dates, after every override they write: those overrides are pending. */
const RESAVED = '2026-09-20';
const PENDING_LEAVE: StaffingLeaveSource = { isPending: true, isError: false, data: undefined };

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

/** A rotation snapshot read over `rows`. */
async function rotationOf(rows: FixtureRows): Promise<RotationSnapshot> {
  const outcome = await readRotation(rotationTableOf(answerOf(rows)));

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** The first team's seeded version, as the fixture's row. */
function seededVersionOf(rows: FixtureRows, team: string): Record<string, unknown> {
  const version = rows.assignments.find((one) => one['team_id'] === team);

  if (version === undefined) throw new Error('no version');

  return version;
}

/** One version of `team` at `offsetStepId` from `date`, saved at `createdAt`. */
function versionRow(rows: FixtureRows, team: string, offsetStepId: unknown, date: string, createdAt: string) {
  const seeded = seededVersionOf(rows, team);

  return assignmentRow(team, String(seeded['pattern_id']), String(offsetStepId), String(seeded['anchor_date']), date, undefined, {
    createdAt,
  });
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

    describe('the builder’s line (Epic 11 retro A2, R1)', () => {
      const PENDING = { isError: false, data: undefined };
      const FAILED = { isError: true, data: undefined };
      const LEAVE_PENDING: StaffingLeaveSource = { isPending: true, isError: false, data: undefined };
      let draft: ReturnType<typeof prefillOf>;

      beforeAll(() => {
        draft = withTeamStep(withEffectiveFrom(prefillOf(rotation, TODAY), '2026-10-01'), fixture.team, 2);
      });

      it('says nothing while the calendar is pending, whatever the minimum turns out to be', () => {
        expect(builderShortStaffedOf(true, PENDING, rotation, draft, TODAY, UNTOUCHABLE)).toBeNull();
        expect(builderShortStaffedOf(true, PENDING, rotation, draft, TODAY, null)).toBeNull();
      });

      it('says nothing when the calendar read failed, with the minimum set or empty', () => {
        // A failed read may still hold stale data: it is not trusted either way.
        expect(builderShortStaffedOf(true, FAILED, rotation, draft, TODAY, UNTOUCHABLE)).toBeNull();
        expect(builderShortStaffedOf(true, { isError: true, data: four }, rotation, draft, TODAY, UNTOUCHABLE)).toBeNull();
        expect(builderShortStaffedOf(true, { isError: true, data: empty }, rotation, draft, TODAY, UNTOUCHABLE)).toBeNull();
      });

      it('the minimum set and the leave pending: the unknown line', () => {
        expect(builderShortStaffedOf(true, { isError: false, data: four }, rotation, draft, TODAY, LEAVE_PENDING)).toEqual(
          SHORT_STAFFED_UNKNOWN_REPORT,
        );
      });

      it('the calendar in with the minimum empty: nothing, and no leave looked at', () => {
        expect(builderShortStaffedOf(true, { isError: false, data: empty }, rotation, draft, TODAY, UNTOUCHABLE)).toBeNull();
      });

      it('no draft to save: nothing', () => {
        expect(builderShortStaffedOf(false, { isError: false, data: four }, rotation, draft, TODAY, UNTOUCHABLE)).toBeNull();
        expect(builderShortStaffedOf(true, { isError: false, data: four }, rotation, null, TODAY, UNTOUCHABLE)).toBeNull();
      });

      it('the calendar and the leave in: the report, as the save would derive it', () => {
        const leave = leaveRead([leaveRow(ONE, member(1), '2026-10-01', '2026-10-31'), leaveRow(TWO, member(2), '2026-10-01', '2026-10-31')]);

        expect(builderShortStaffedOf(true, { isError: false, data: four }, rotation, draft, TODAY, leave)).toEqual(
          draftShortStaffedOf(four, rotation, draft, TODAY, leave),
        );
        expect(rowsOf(builderShortStaffedOf(true, { isError: false, data: four }, rotation, draft, TODAY, leave)).length).toBeGreaterThan(0);
      });
    });
  });

  describe('the rotation cancel (Epic 11 retro A7)', () => {
    /** The fixture with a change scheduled on {@link SCHEDULED} for every team: the first at `offsetStepId`, the others as they are. */
    function scheduledRows(offsetStepId: unknown): FixtureRows {
      const rows = fixture.rows;

      return {
        ...rows,
        assignments: [
          ...rows.assignments,
          ...rows.teams.map((team) => {
            const id = String(team['id']);
            const offset = id === fixture.team ? offsetStepId : seededVersionOf(rows, id)['offset_step_id'];

            return versionRow(rows, id, offset, SCHEDULED, SCHEDULED_AT);
          }),
        ],
      };
    }

    let rows: FixtureRows;
    let chosen: unknown;
    let scheduled: CalendarSnapshot;
    let unset: CalendarSnapshot;
    let rotation: RotationSnapshot;
    let leave: StaffingLeaveSource;

    beforeAll(async () => {
      // The scheduled version frees the first team on `day.date`; the one in force before works it.
      for (const step of fixture.rows.steps) {
        const candidate = scheduledRows(step['id']);
        const snapshot = await staffingSnapshotOf({ ...fixture, rows: candidate }, { size: 4, minimum: 3 });

        if (peopleAtWorkOn(staffingInputOf(snapshot, []), fixture.team, day.date) === null) {
          rows = candidate;
          chosen = step['id'];
          scheduled = snapshot;
          break;
        }
      }

      if (chosen === undefined) throw new Error('no step frees the first team on the working day');

      unset = await staffingSnapshotOf({ ...fixture, rows }, { size: 4, minimum: null });
      rotation = await rotationOf(rows);
      leave = leaveRead([leaveRow(ONE, member(1), day.date, day.date), leaveRow(TWO, member(2), day.date, day.date)]);
    });

    it('the reverted version puts the team, two on leave, on a working day: the block names it', () => {
      expect(rowsOf(cancelShortStaffedOf({ isError: false, data: scheduled }, rotation, SCHEDULED, leave))).toMatchObject([
        { date: day.date, teamId: fixture.team, atWork: 2, minimum: 3 },
      ]);
    });

    it('the setting empty: nothing, and no leave read', () => {
      expect(cancelShortStaffedOf({ isError: false, data: unset }, rotation, SCHEDULED, UNTOUCHABLE)).toBeNull();
    });

    it('the calendar pending or failed: nothing, whatever the minimum turns out to be', () => {
      expect(cancelShortStaffedOf({ isError: false, data: undefined }, rotation, SCHEDULED, UNTOUCHABLE)).toBeNull();
      expect(cancelShortStaffedOf({ isError: true, data: scheduled }, rotation, SCHEDULED, UNTOUCHABLE)).toBeNull();
    });

    it('no cancel shown: nothing', () => {
      expect(cancelShortStaffedOf({ isError: false, data: scheduled }, rotation, null, UNTOUCHABLE)).toBeNull();
      expect(cancelShortStaffedOf({ isError: false, data: scheduled }, null, SCHEDULED, UNTOUCHABLE)).toBeNull();
    });

    it('the leave pending: the unknown line', () => {
      expect(cancelShortStaffedOf({ isError: false, data: scheduled }, rotation, SCHEDULED, PENDING_LEAVE)).toEqual(
        SHORT_STAFFED_UNKNOWN_REPORT,
      );
    });

    it('over the horizon: a date a month and more on, freed by the change and worked after the cancel, is reported', () => {
      const cancelled = cancelledCalendarSnapshotOf(scheduled, SCHEDULED);
      let date = SCHEDULED;

      for (let index = 0; index < 30; index += 1) date = nextIsoDate(date) ?? date;

      // The first such date at least 30 days after the scheduled one.
      for (let index = 0; index < 60; index += 1) {
        const freed = peopleAtWorkOn(staffingInputOf(scheduled, []), fixture.team, date) === null;
        const worked = peopleAtWorkOn(staffingInputOf(cancelled, []), fixture.team, date) !== null;

        if (freed && worked) break;

        date = nextIsoDate(date) ?? date;
      }

      expect(peopleAtWorkOn(staffingInputOf(scheduled, []), fixture.team, date), 'no freed date found').toBeNull();
      expect(peopleAtWorkOn(staffingInputOf(cancelled, []), fixture.team, date), 'no worked date found').not.toBeNull();

      const later = leaveRead([leaveRow(ONE, member(1), date, date), leaveRow(TWO, member(2), date, date)]);

      expect(rowsOf(cancelShortStaffedOf({ isError: false, data: scheduled }, rotation, SCHEDULED, later))).toMatchObject([
        { date, teamId: fixture.team, atWork: 2, minimum: 3 },
      ]);
    });

    it('a shift short only before the scheduled date is not reported', () => {
      // The last working day of the first team before the scheduled date: the same version governs it either way.
      let date = previousIsoDate(SCHEDULED) ?? SCHEDULED;

      for (let index = 0; index < 40 && peopleAtWorkOn(staffingInputOf(scheduled, []), fixture.team, date) === null; index += 1) {
        date = previousIsoDate(date) ?? date;
      }

      expect(peopleAtWorkOn(staffingInputOf(scheduled, []), fixture.team, date), 'no working day before').not.toBeNull();

      const earlier = leaveRead([leaveRow(ONE, member(1), date, date), leaveRow(TWO, member(2), date, date)]);

      expect(rowsOf(cancelShortStaffedOf({ isError: false, data: scheduled }, rotation, SCHEDULED, earlier))).toEqual([]);
    });

    it('the calendar and the rotation disagree on the scheduled versions: unknown, logged', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // The same teams scheduled, the first at another step.
      const other = fixture.rows.steps.find((step) => step['id'] !== chosen);

      if (other === undefined) throw new Error('the pattern has no other step');

      const bound = await rotationOf(scheduledRows(other['id']));

      expect(cancelShortStaffedOf({ isError: false, data: scheduled }, bound, SCHEDULED, leave)).toEqual(SHORT_STAFFED_UNKNOWN_REPORT);
      expect(logged).toHaveBeenCalledWith(
        SHORT_STAFFED_UNAVAILABLE,
        expect.objectContaining({ message: 'the rotation and the calendar disagree on the scheduled versions' }),
      );
    });
  });

  describe('the override review (Epic 11 retro A7)', () => {
    /** The fixture with the first team's version re-saved on {@link RESAVED}: every override written before is pending. */
    function resavedRows(): FixtureRows {
      const rows = fixture.rows;
      const seeded = seededVersionOf(rows, fixture.team);

      return {
        ...rows,
        assignments: [...rows.assignments, versionRow(rows, fixture.team, seeded['offset_step_id'], RESAVED, SCHEDULED_AT)],
      };
    }

    let pendingType: CalendarSnapshot;
    let pendingRoster: CalendarSnapshot;
    let unsetType: CalendarSnapshot;
    let unsetRoster: CalendarSnapshot;
    let typeRow: PendingOverrideRow;
    let rosterRow: PendingRosterOverrideRow;

    beforeAll(async () => {
      const resaved = { ...fixture, rows: resavedRows() };
      const overrides = [typeOverrideOn(fixture, off, day.shiftTypeId)];
      const rosterOverrides = [rosterOverrideOn(fixture, day.date, member(1), null)];

      pendingType = await staffingSnapshotOf(resaved, { size: 4, minimum: 3, overrides });
      pendingRoster = await staffingSnapshotOf(resaved, { size: 4, minimum: 3, rosterOverrides });
      unsetType = await staffingSnapshotOf(resaved, { size: 4, minimum: null, overrides });
      unsetRoster = await staffingSnapshotOf(resaved, { size: 4, minimum: null, rosterOverrides });
      // A day off made a working one, still pending: the review's row of it.
      typeRow = {
        layer: REVIEW_SHIFT_TYPE,
        id: TYPE_OVERRIDE_ID,
        teamId: fixture.team,
        teamName: fixture.teamName,
        isoDate: off,
        date: off,
        shiftTypeId: day.shiftTypeId,
        typeName: 'Radna',
        projectedShiftTypeId: fixture.offType,
        projectedTypeName: 'Slobodno',
        reason: 'Vježba.',
        authorName: null,
        governed: true,
        governingSavedAt: SCHEDULED_AT,
        options: [{ id: day.shiftTypeId, name: 'Radna' }],
      };
      // Member 1 taken off a working day, nobody put on, still pending.
      rosterRow = {
        layer: REVIEW_ROSTER,
        id: OVERRIDE_ID,
        teamId: fixture.team,
        teamName: fixture.teamName,
        isoDate: day.date,
        date: day.date,
        memberOutId: member(1),
        memberOutName: 'Član 1',
        memberInId: null,
        memberInName: null,
        projectedTypeName: 'Radna',
        reason: 'Bolovanje.',
        authorName: null,
        governed: true,
        governingSavedAt: SCHEDULED_AT,
      };
    });

    it('confirming a pending type override that makes a day off a working one, two on leave: that row’s block', () => {
      const leave = leaveRead([leaveRow(ONE, member(1), off, off), leaveRow(TWO, member(2), off, off)]);

      expect(rowsOf(reviewRowShortStaffedOf(pendingType, typeRow, leave))).toMatchObject([
        { date: off, teamId: fixture.team, atWork: 2, minimum: 3 },
      ]);
    });

    it('confirming a pending roster override taking one off, another on leave: that row’s block', () => {
      const leave = leaveRead([leaveRow(TWO, member(2), day.date, day.date)]);

      expect(rowsOf(reviewRowShortStaffedOf(pendingRoster, rosterRow, leave))).toMatchObject([
        { date: day.date, teamId: fixture.team, atWork: 2, minimum: 3 },
      ]);
      expect(reviewRowsShortStaffedOf(pendingRoster, [rosterRow], leave).get(OVERRIDE_ID)).toEqual(
        reviewRowShortStaffedOf(pendingRoster, rosterRow, leave),
      );
    });

    it('a confirm that leaves nobody newly short: no block', () => {
      expect(reviewRowShortStaffedOf(pendingRoster, rosterRow, leaveRead([]))).toBeNull();
      expect(reviewRowsShortStaffedOf(pendingRoster, [rosterRow], leaveRead([])).size).toBe(0);
    });

    it('the leave not known: no row block, though the amend says the unknown line', () => {
      expect(reviewRowShortStaffedOf(pendingRoster, rosterRow, PENDING_LEAVE)).toBeNull();
      expect(reviewAmendShortStaffedOf(pendingRoster, rosterRow, REPLACEMENT, PENDING_LEAVE)).toEqual(SHORT_STAFFED_UNKNOWN_REPORT);
    });

    it('a row gone from the cached calendar: no block', () => {
      const leave = leaveRead([leaveRow(TWO, member(2), day.date, day.date)]);
      const gone = { ...rosterRow, id: '00000000-0000-4000-8000-0000000006ff' };

      expect(reviewRowShortStaffedOf(pendingRoster, gone, leave)).toBeNull();
      expect(reviewAmendShortStaffedOf(pendingRoster, gone, REPLACEMENT, leave)).toBeNull();
    });

    it('a row that offers no confirm, or the calendar pending or failed: no block, no leave read', () => {
      expect(reviewRowShortStaffedOf(pendingRoster, { ...rosterRow, governed: false }, UNTOUCHABLE)).toBeNull();
      expect(reviewRowShortStaffedOf(null, rosterRow, UNTOUCHABLE)).toBeNull();
      expect(reviewAmendShortStaffedOf(null, rosterRow, REPLACEMENT, UNTOUCHABLE)).toBeNull();
      expect(reviewRowsShortStaffedOf(null, [rosterRow, typeRow], UNTOUCHABLE).size).toBe(0);
    });

    it('a shift-type row that offers no confirm: no block, no leave read', () => {
      const ungoverned = { ...typeRow, governed: false, options: [] };

      expect(reviewRowShortStaffedOf(pendingType, ungoverned, UNTOUCHABLE)).toBeNull();
      expect(reviewRowsShortStaffedOf(pendingType, [ungoverned], UNTOUCHABLE).size).toBe(0);
    });

    it('a roster amend to the member already put on: nothing, as its preflight refuses it', () => {
      const replaced = { ...rosterRow, memberInId: REPLACEMENT, memberInName: 'Zamjena Zamjenić' };

      expect(reviewAmendShortStaffedOf(pendingRoster, replaced, REPLACEMENT, UNTOUCHABLE)).toBeNull();
    });

    it('the setting empty: no block, no line and no leave read, on a row or in the amend', () => {
      expect(reviewRowShortStaffedOf(unsetType, typeRow, UNTOUCHABLE)).toBeNull();
      expect(reviewRowShortStaffedOf(unsetRoster, rosterRow, UNTOUCHABLE)).toBeNull();
      expect(reviewAmendShortStaffedOf(unsetType, typeRow, day.shiftTypeId, UNTOUCHABLE)).toBeNull();
      expect(reviewAmendShortStaffedOf(unsetRoster, rosterRow, REPLACEMENT, UNTOUCHABLE)).toBeNull();
    });

    it('the amend follows the choice: the block is worked out for the member now chosen', () => {
      const leave = leaveRead([leaveRow(TWO, member(2), day.date, day.date), leaveRow(THREE, REPLACEMENT, day.date, day.date)]);
      const away = leaveRead([leaveRow(TWO, member(2), day.date, day.date)]);

      // The replacement on leave that day: two at work either way, so short.
      expect(rowsOf(reviewAmendShortStaffedOf(pendingRoster, rosterRow, REPLACEMENT, leave))).toMatchObject([
        { date: day.date, atWork: 2, minimum: 3 },
      ]);
      // At work: three, so nothing newly short.
      expect(rowsOf(reviewAmendShortStaffedOf(pendingRoster, rosterRow, REPLACEMENT, away))).toEqual([]);
      // The member taken off is no choice the amend's preflight lets through; nothing chosen is none.
      expect(reviewAmendShortStaffedOf(pendingRoster, rosterRow, member(1), UNTOUCHABLE)).toBeNull();
      expect(reviewAmendShortStaffedOf(pendingRoster, rosterRow, null, UNTOUCHABLE)).toBeNull();
    });

    it('the amend of a type: a working type is reported, the projected type is null', () => {
      const leave = leaveRead([leaveRow(ONE, member(1), off, off), leaveRow(TWO, member(2), off, off)]);

      expect(rowsOf(reviewAmendShortStaffedOf(pendingType, typeRow, day.shiftTypeId, leave))).toMatchObject([
        { date: off, atWork: 2, minimum: 3 },
      ]);
      // `sameAsProjected` in the cached calendar: the write would refuse it.
      expect(reviewAmendShortStaffedOf(pendingType, typeRow, fixture.offType, leave)).toBeNull();
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
