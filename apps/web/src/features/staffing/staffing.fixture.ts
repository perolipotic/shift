import { peopleAtWorkOn } from '@shift/domain';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  PILOT,
  SEEDED,
  UJ5,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
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
import { staffingInputOf } from '@/features/staffing/services/short-staffed';
import { nextIsoDate } from '@/lib/i18n/format';

/**
 * Story 11.2's snapshots, for the staffing report's suites (AD-15): a real
 * calendar read over either fixture, its first team holding the viewer (an
 * admin) and `size − 1` other members, a member of the second team to put on
 * as a replacement, and Minimum Members as given. Every rule is asserted
 * against both the pilot and the UJ-5 fixture.
 */

export interface StaffingFixture {
  readonly name: string;
  readonly rows: FixtureRows;
  /** The team every member below is on. */
  readonly team: string;
  readonly teamName: string;
  /** The team the replacement is on. */
  readonly otherTeam: string;
  /** The fixture's non-working type. */
  readonly offType: string;
}

export const STAFFING_FIXTURES: readonly StaffingFixture[] = [
  {
    name: 'pilot',
    rows: PILOT,
    team: 'pilot-smjena-a',
    teamName: 'Smjena A',
    otherTeam: 'pilot-smjena-b',
    offType: 'pilot-slobodno',
  },
  { name: 'UJ-5', rows: UJ5, team: 'uj5-smjena-a', teamName: 'Smjena A', otherTeam: 'uj5-smjena-b', offType: 'uj5-slobodno' },
];

/** The members of the first team, the viewer first: `member(0)` is the viewer. */
export function member(index: number): string {
  return index === 0 ? VIEWER_MEMBER : `00000000-0000-4000-8000-0000000005${String(index).padStart(2, '0')}`;
}

/** The replacement, on the second team. */
export const REPLACEMENT = '00000000-0000-4000-8000-000000000599';

/** A live roster override's id. */
export const OVERRIDE_ID = '00000000-0000-4000-8000-0000000006a1';

export interface StaffingSnapshotOptions {
  /** How many members the first team has, the viewer included. */
  readonly size: number;
  /** Minimum Members as the row answers it; `undefined` for a row without the column. */
  readonly minimum: unknown;
  /** Live roster overrides, as `calendarRosterOverrideRow` rows. */
  readonly rosterOverrides?: readonly Record<string, unknown>[];
  /** Live shift-type overrides, as `calendarOverrideRow` rows. */
  readonly overrides?: readonly Record<string, unknown>[];
  /** The viewer's role. */
  readonly role?: string;
}

/** A calendar snapshot of `fixture` as {@link StaffingSnapshotOptions} describe. */
export async function staffingSnapshotOf(
  fixture: StaffingFixture,
  { size, minimum, rosterOverrides = [], overrides = [], role = 'admin' }: StaffingSnapshotOptions,
): Promise<CalendarSnapshot> {
  const ids = Array.from({ length: size }, (_, index) => member(index));
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(fixture.rows, {
          viewers: [viewerRow([membershipRow(fixture.team, SEEDED)], { role })],
          versions: [
            ...ids.map((id) => memberMembershipRow(id, fixture.team, SEEDED)),
            memberMembershipRow(REPLACEMENT, fixture.otherTeam, SEEDED),
          ],
          minimumMembers: minimum,
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      ...ids.map((id, index) => calendarMemberRow(id, index === 0 ? VIEWER_NAME : `Član ${String(index)}`)),
      calendarMemberRow(REPLACEMENT, 'Zamjena Zamjenić'),
    ]),
    overridesAnswerOf(overrides),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** A roster override on `date` taking `out` off the first team's shift and putting `put` on. */
export function rosterOverrideOn(fixture: StaffingFixture, date: string, out: string | null, put: string | null) {
  return calendarRosterOverrideRow(OVERRIDE_ID, fixture.team, date, out, put);
}

/**
 * The first date from 2026-10-01 on which the first team works a working
 * shift, and its type: found through the domain, not assumed per fixture.
 */
export function firstWorkingDayOf(snapshot: CalendarSnapshot, fixture: StaffingFixture): { date: string; shiftTypeId: string } {
  let date = '2026-10-01';

  for (let day = 0; day < 40; day += 1) {
    const staffing = peopleAtWorkOn(staffingInputOf(snapshot, []), fixture.team, date);

    if (staffing !== null) return { date, shiftTypeId: staffing.shiftTypeId };

    date = nextIsoDate(date) ?? date;
  }

  throw new Error('no working day');
}

/** The first date from 2026-10-01 on which the first team works no working shift. */
export function firstDayOffOf(snapshot: CalendarSnapshot, fixture: StaffingFixture): string {
  let date = '2026-10-01';

  for (let day = 0; day < 40; day += 1) {
    if (peopleAtWorkOn(staffingInputOf(snapshot, []), fixture.team, date) === null) return date;

    date = nextIsoDate(date) ?? date;
  }

  throw new Error('no day off');
}

/** A shift-type override of the first team on `date` to `shiftTypeId`. */
export function typeOverrideOn(fixture: StaffingFixture, date: string, shiftTypeId: string) {
  return calendarOverrideRow(TYPE_OVERRIDE_ID, fixture.team, date, shiftTypeId);
}

/** A live shift-type override's id. */
export const TYPE_OVERRIDE_ID = '00000000-0000-4000-8000-0000000006b1';

/** A leave row as the organization's read answers it: the range canonical, its upper bound exclusive. */
export function leaveRow(id: string, memberId: string, from: string, to: string): Record<string, unknown> {
  return { id, member_id: memberId, during: `[${from},${nextIsoDate(to) ?? to})` };
}

/** A leave read that answered `rows`. */
export function leaveRead(rows: readonly unknown[]) {
  return { isPending: false, isError: false, data: rows };
}
