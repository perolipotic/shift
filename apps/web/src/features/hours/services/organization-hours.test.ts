import { leaveCostOf, memberHoursOfMonth, type Collision } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CALENDAR_UNAVAILABLE, readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarDayListOf, calendarMonthOf, memberScheduleInputOf, monthHeaderOf } from '@/features/calendar/utils/month';
import { HOURS_CONFLICTS_READY, NO_LEAVE_RECORDS, type HoursConflictsState, type LeaveRecordsByMember } from '@/features/hours/services/hours-conflicts';
import {
  HOURS_UNAVAILABLE,
  hoursSearchOf,
  memberHoursInputOf,
  myHoursOf,
  myHoursSurfaceOf,
  type HoursFigure,
  type HoursSearch,
} from '@/features/hours/services/my-hours';
import {
  DEFAULT_HOURS_SORT,
  bandSortKeyOf,
  calendarLinkSearchOf,
  hoursAriaSortOf,
  HOURS_EMPTY_FILTERED,
  HOURS_EMPTY_MONTH,
  HOURS_EMPTY_NOT_IN_TEAM,
  hoursEmptyFactMessageKey,
  hoursEmptyMessageKey,
  hoursEmptyOf,
  hoursSearchBaseOf,
  hoursSortArrowOf,
  hoursSortDirectionArrowOf,
  hoursSortChangeOf,
  hoursSurfaceOf,
  nextHoursSort,
  hoursFooterOf,
  organizationHoursOf,
  organizationHoursRowsOf,
  type OrganizationHoursView,
} from '@/features/hours/services/organization-hours';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  TODAY,
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
  statusRow,
  typeRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 4.2's rules, executed (AD-15): which members are rows, each row's
 * team, the filters, the sort, the link, the untimed note, the guarded
 * outcome and the role's surface — every row of the spec's matrix, over both
 * fixtures. Every figure is compared against `memberHoursOfMonth` itself.
 */

const MONTH = '2026-09';

/** No leave, so no collision: the figures exactly as before story 5.3d. */
const NO_COLLISIONS: readonly Collision[] = [];
const READY: HoursConflictsState = { kind: HOURS_CONFLICTS_READY, collisions: NO_COLLISIONS, leaveKeys: [], acceptedKeys: [], leaveRecords: NO_LEAVE_RECORDS };

const ANA = '00000000-0000-4000-8000-0000000000c1';
const CEDO = '00000000-0000-4000-8000-0000000000c2';
const DORA = '00000000-0000-4000-8000-0000000000c3';
const EMA = '00000000-0000-4000-8000-0000000000c4';
const FILIP = '00000000-0000-4000-8000-0000000000c5';

type Row = Record<string, unknown>;

/** A fixture's team id by index: `a`, `b`, `c`, `d`. */
function teamOf(rows: FixtureRows, index: number): string {
  const id = rows.teams[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no team ${String(index)}`);

  return id;
}

/**
 * The organization: the viewer (admin unless `role` says otherwise) on the
 * first team; Ana on the second; Čedo on the first until the 15th, then the
 * second; Dora on no team; Ema on the third, inactive since August; Filip on
 * the last, inactive from the 11th.
 */
async function organizationOf(
  rows: FixtureRows,
  {
    role = 'admin',
    rosterOverrides = [] as readonly Row[],
  } = {},
): Promise<CalendarSnapshot> {
  const [a, b, c] = [teamOf(rows, 0), teamOf(rows, 1), teamOf(rows, 2)];
  const last = teamOf(rows, rows.teams.length - 1);
  const viewer = viewerRow([membershipRow(a, SEEDED)], { role });
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewer],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, a, SEEDED),
            memberMembershipRow(ANA, b, SEEDED),
            memberMembershipRow(CEDO, a, SEEDED),
            memberMembershipRow(CEDO, b, '2026-09-16'),
            memberMembershipRow(EMA, c, SEEDED),
            memberMembershipRow(FILIP, last, SEEDED),
          ],
          statuses: [statusRow(EMA, false, '2026-08-01'), statusRow(FILIP, false, '2026-09-11')],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(ANA, 'Ana Anić'),
      calendarMemberRow(CEDO, 'Čedo Čačić'),
      calendarMemberRow(DORA, 'Dora Dorić'),
      calendarMemberRow(EMA, 'Ema Emić'),
      calendarMemberRow(FILIP, 'Filip Filić'),
    ]),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

function viewOf(
  snapshot: CalendarSnapshot,
  leaveRecords: LeaveRecordsByMember,
  search: HoursSearch = { mjesec: MONTH },
): OrganizationHoursView {
  const outcome = organizationHoursOf(snapshot, search, TODAY, NO_COLLISIONS, [], leaveRecords);

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.view;
}

function minutesOf(figure: HoursFigure): number {
  return figure.values.hours * 60 + figure.values.minutes;
}

function shown(figure: HoursFigure): string {
  return t(figure.key, figure.values);
}

function names(view: OrganizationHoursView): readonly string[] {
  return view.rows.map((row) => row.name);
}

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

afterEach(() => {
  vi.restoreAllMocks();
});

let pilot: CalendarSnapshot;
let uj5: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await organizationOf(PILOT);
  uj5 = await organizationOf(UJ5);
});

describe('the rows', () => {
  it.each([
    { fixture: 'pilot', snapshot: () => pilot },
    { fixture: 'UJ-5', snapshot: () => uj5 },
  ])("$fixture: every row is the domain's answer for that member, and the viewer's is their own screen's", ({ snapshot }) => {
    const current = snapshot();
    const view = viewOf(current, NO_LEAVE_RECORDS);

    expect(view.rows.length).toBeGreaterThan(0);
    for (const row of view.rows) {
      const member = current.members.find((one) => one.id === row.memberId)!;
      const hours = memberHoursOfMonth(memberHoursInputOf(current, { ...member, memberId: member.id }), MONTH);

      expect(row.hours).toEqual(hours);
      expect(row.shiftCount).toBe(hours.shiftCount);
      expect(minutesOf(row.total)).toBe(hours.totalMinutes);
      expect(row.bands.map((band) => [band.bandId, minutesOf(band.hours), band.shiftCount])).toEqual(
        hours.bands.map((band) => [band.bandId, band.minutes, band.shiftCount]),
      );
      expect(row.leave).toBeNull();
    }

    const own = myHoursOf(current, { mjesec: MONTH }, TODAY, NO_COLLISIONS, [], NO_LEAVE_RECORDS);

    if (!own.ok) throw new Error(own.code);
    const mine = view.rows.find((row) => row.memberId === VIEWER_MEMBER)!;

    expect(mine.total).toEqual(own.view.total);
    expect(mine.shiftCount).toBe(own.view.shiftCount);
    expect(mine.bands).toEqual(own.view.bands);
    expect(mine.leave).toEqual(own.view.leave);
  });

  it("a member-role viewer's own screen equals the admin's row for them", async () => {
    const asMember = await organizationOf(PILOT, { role: 'member_role' });
    const own = myHoursOf(asMember, { mjesec: MONTH }, TODAY, NO_COLLISIONS, [], NO_LEAVE_RECORDS);

    if (!own.ok) throw new Error(own.code);
    const row = viewOf(pilot, NO_LEAVE_RECORDS).rows.find((one) => one.memberId === VIEWER_MEMBER)!;

    expect(row.total).toEqual(own.view.total);
    expect(row.bands).toEqual(own.view.bands);
    expect(row.shiftCount).toBe(own.view.shiftCount);
  });

  it('UJ-5: the band cells split each shift, and sum to the total on every row', () => {
    const view = viewOf(uj5, NO_LEAVE_RECORDS);

    expect(view.bands.map((band) => band.name)).toEqual(['Jutro', 'Popodne', 'Noć']);
    for (const row of view.rows) {
      expect(row.bands.reduce((sum, band) => sum + minutesOf(band.hours), 0)).toBe(minutesOf(row.total));
      // Every UJ-5 shift straddles a band edge.
      expect(row.bands.reduce((sum, band) => sum + band.shiftCount, 0)).toBe(2 * row.shiftCount);
    }
  });

  it('a member inactive all month with no shift is not listed; one inactive part of it is', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS);
    const ids = view.rows.map((row) => row.memberId);

    expect(ids).not.toContain(EMA);
    expect(ids).toContain(FILIP);
    const filip = view.rows.find((row) => row.memberId === FILIP)!;

    // Filip's team, on his last active date (the 10th), and fewer shifts than a whole month.
    expect(filip.team?.id).toBe(teamOf(PILOT, 3));
    expect(filip.shiftCount).toBeGreaterThan(0);
    expect(filip.shiftCount).toBeLessThan(15);
    expect(view.rowCount).toBe(5);
  });

  it('a member moved mid-month is on the team they end it on, and that filter includes them', () => {
    const b = teamOf(PILOT, 1);
    const cedo = viewOf(pilot, NO_LEAVE_RECORDS).rows.find((row) => row.memberId === CEDO)!;

    expect(cedo.team).toEqual({ id: b, name: 'Smjena B' });
    expect(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, smjena: b }).rows.map((row) => row.memberId)).toContain(CEDO);
    expect(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, smjena: teamOf(PILOT, 0) }).rows.map((row) => row.memberId)).not.toContain(
      CEDO,
    );
  });

  it('a member on no team reads —, 0 h, and is hidden under any team filter', () => {
    const dora = viewOf(pilot, NO_LEAVE_RECORDS).rows.find((row) => row.memberId === DORA)!;

    expect(dora.team).toBeNull();
    expect(shown(dora.total)).toBe('0 h');
    expect(dora.shiftCount).toBe(0);
    expect(t('sati.organization.noTeam')).toBe('—');
    for (const team of viewOf(pilot, NO_LEAVE_RECORDS).teams) {
      expect(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, smjena: team.id }).rows.map((row) => row.memberId)).not.toContain(DORA);
    }
  });

  it('a member on a shift only through a roster override counts it; one inactive all month is still not listed', async () => {
    const days = calendarDayListOf(pilot, pilot.viewer, MONTH, TODAY) ?? [];
    const worked = days.find((day) =>
      day.shifts.some((shift) => shift.cell.shiftTypeId === 'pilot-dan' || shift.cell.shiftTypeId === 'pilot-noc'),
    );

    expect(worked).toBeDefined();
    const a = teamOf(PILOT, 0);
    const snapshot = await organizationOf(PILOT, {
      rosterOverrides: [
        calendarRosterOverrideRow('dora', a, worked!.date, null, DORA),
        calendarRosterOverrideRow('ema', a, worked!.date, null, EMA),
      ],
    });
    const view = viewOf(snapshot, NO_LEAVE_RECORDS);
    const dora = view.rows.find((row) => row.memberId === DORA)!;

    expect(dora.shiftCount).toBe(1);
    expect(shown(dora.total)).toBe('12 h');
    // Her team is her membership's, and she has none: the shift is not a team.
    expect(dora.team).toBeNull();
    // An inactive member is never put on a shift, so Ema has none and no row.
    expect(view.rows.map((row) => row.memberId)).not.toContain(EMA);
  });

  it('each name leads to their calendar month in Sve smjene', () => {
    const row = viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: '2026-10' }).rows.find((one) => one.memberId === ANA)!;

    expect(row.calendar).toEqual({ prikaz: 'sve', osoba: ANA, mjesec: '2026-10' });
    expect(calendarLinkSearchOf(ANA, MONTH)).toEqual({ prikaz: 'sve', osoba: ANA, mjesec: MONTH });
  });
});

describe('the calendar person filter (epic 4 retro, C1)', () => {
  it.each([
    { fixture: 'pilot', snapshot: () => pilot },
    { fixture: 'UJ-5', snapshot: () => uj5 },
  ])('$fixture: offers exactly the members Sati has a row for, month by month', ({ snapshot }) => {
    const current = snapshot();

    for (const month of ['2026-08', MONTH, '2026-10']) {
      const rows = organizationHoursRowsOf(current, month, monthHeaderOf(month, TODAY), NO_COLLISIONS, [], NO_LEAVE_RECORDS).map((row) => row.memberId);
      const people = calendarMonthOf(current, { mjesec: month }, TODAY).filter.people.map((person) => person.id);

      expect(people, month).toEqual(rows);
    }
    // The guard bites: Filip, inactive from the 11th and so inactive today,
    // has a row in September and is offered; Ema, inactive since August,
    // has neither then.
    const september = calendarMonthOf(current, { mjesec: MONTH }, TODAY).filter.people.map((person) => person.id);

    expect(september).toContain(FILIP);
    expect(september).not.toContain(EMA);
    expect(calendarMonthOf(current, { mjesec: '2026-07' }, TODAY).filter.people.map((person) => person.id)).toContain(
      EMA,
    );
  });
});

describe('the filters', () => {
  it('offer the teams some row names, by name, and the people with a row, in name order', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS);

    // Smjena C is Ema's alone, and she has no row.
    expect(view.teams.map((team) => team.name)).toEqual(['Smjena A', 'Smjena B', 'Smjena D']);
    expect(view.people.map((person) => person.name)).toEqual([
      'Ana Anić',
      'Čedo Čačić',
      'Dora Dorić',
      'Filip Filić',
      VIEWER_NAME,
    ]);
    expect(view.team).toBeNull();
    expect(view.person).toBeNull();
  });

  it('combine: a team and a person narrow together', () => {
    const b = teamOf(PILOT, 1);

    expect(names(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, smjena: b }))).toEqual(['Ana Anić', 'Čedo Čačić']);
    expect(names(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, smjena: b, osoba: ANA }))).toEqual(['Ana Anić']);
    expect(names(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, smjena: b, osoba: FILIP }))).toEqual([]);
    expect(names(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, osoba: FILIP }))).toEqual(['Filip Filić']);
  });

  it('the filter bar combines, and counts each team\'s rows (story 7.5)', () => {
    const b = teamOf(PILOT, 1);
    const view = viewOf(pilot, NO_LEAVE_RECORDS);
    const all = view.filters;

    expect(all.combine).toBe(true);
    expect(all.chips.map((chip) => chip.key)).toEqual(['team', 'person']);
    expect(all.teams.map((team) => [team.name, team.count])).toEqual(
      view.teams.map((team) => [team.name, view.rows.filter((row) => row.team?.id === team.id).length]),
    );
    expect(all.people.map((person) => person.id)).toEqual(view.people.map((person) => person.id));
    expect(all.summary).toEqual({ kind: 'all', teams: view.teams.length, people: view.rowCount });

    const both = viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, smjena: b, osoba: FILIP }).filters;

    expect(both.chips).toEqual([
      { key: 'team', value: 'Smjena B' },
      { key: 'person', value: 'Filip Filić' },
    ]);
    expect(both.summary).toEqual({ kind: 'both', team: 'Smjena B', person: 'Filip Filić', shown: 0 });
    expect(both.activeCount).toBe(2);
    expect(both.shownCount).toBe(0);
    // Each person carries their team for the month: Čedo moved to B on the 16th.
    expect(all.people.find((person) => person.id === CEDO)).toMatchObject({ teamId: b, teamName: 'Smjena B' });
    expect(all.people.find((person) => person.id === DORA)).toMatchObject({ teamId: null, teamName: null });
  });
});

describe('the sort', () => {
  it('opens by name, ascending, under the Croatian collation', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS);

    expect(view.sort).toEqual(DEFAULT_HOURS_SORT);
    expect(names(view)).toEqual(['Ana Anić', 'Čedo Čačić', 'Dora Dorić', 'Filip Filić', VIEWER_NAME]);
  });

  it('by total, descending, with ties by name', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS, hoursSearchOf({ mjesec: MONTH, sort: 'ukupno', smjer: 'silazno' }));
    const totals = view.rows.map((row) => row.hours.totalMinutes);

    expect(totals).toEqual([...totals].sort((first, second) => second - first));
    for (let index = 1; index < view.rows.length; index += 1) {
      const [before, after] = [view.rows[index - 1]!, view.rows[index]!];

      if (before.hours.totalMinutes === after.hours.totalMinutes) {
        expect(names({ ...view, rows: [before, after] })).toEqual(
          [before.name, after.name].sort((first, second) => first.localeCompare(second, 'hr')),
        );
      }
    }
    // Ana and Čedo both work 192 h: a tie, read by name — in either direction.
    expect(names(view)).toEqual(['Ana Anić', 'Čedo Čačić', VIEWER_NAME, 'Filip Filić', 'Dora Dorić']);
    expect(names(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, sort: 'ukupno' }))).toEqual([
      'Dora Dorić',
      'Filip Filić',
      VIEWER_NAME,
      'Ana Anić',
      'Čedo Čačić',
    ]);
  });

  it('by team, a row with no team after every team, and by a band', () => {
    expect(names(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, sort: 'tim' })).at(-1)).toBe('Dora Dorić');
    expect(names(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, sort: 'tim', smjer: 'silazno' }))[0]).toBe('Dora Dorić');
    const band = pilot.bands[0]!;
    const view = viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, sort: bandSortKeyOf(band.id), smjer: 'silazno' });
    const minutes = view.rows.map((row) => minutesOf(row.bands[0]!.hours));

    expect(view.sort).toEqual({ key: `pojas-${band.id}`, direction: 'silazno' });
    expect(minutes).toEqual([...minutes].sort((first, second) => second - first));
  });

  it('by shifts and by leave', () => {
    const shifts = viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, sort: 'smjene' }).rows.map((row) => row.shiftCount);

    expect(shifts).toEqual([...shifts].sort((first, second) => first - second));
    // Leave is 0 everywhere until Epic 5: the order is the names'.
    expect(names(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, sort: 'dopust', smjer: 'silazno' }))).toEqual(names(viewOf(pilot, NO_LEAVE_RECORDS)));
  });

  it('by leave: each row counts its charged days, sorts by them either way with ties by name, and the footer sums them', () => {
    const byName = viewOf(pilot, NO_LEAVE_RECORDS).rows;
    const [first, second, third] = byName;
    const records = new Map([
      [first!.memberId, [{ from: '2026-09-01', to: '2026-09-04' }]],
      [second!.memberId, [{ from: '2026-09-01', to: '2026-09-20' }]],
      [third!.memberId, [{ from: '2026-09-01', to: '2026-09-04' }]],
    ]);
    const sortedBy = (smjer: 'uzlazno' | 'silazno') => {
      const outcome = organizationHoursOf(pilot, { mjesec: MONTH, sort: 'dopust', smjer }, TODAY, NO_COLLISIONS, [], records);

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.view;
    };
    const costOf = (memberId: string, to: string): number => {
      const member = pilot.members.find((one) => one.id === memberId)!;

      return leaveCostOf(memberScheduleInputOf(pilot, { ...member, memberId }), '2026-09-01', to);
    };
    const expectedDays = new Map(byName.map((row) => [row.memberId, 0]));

    expectedDays.set(first!.memberId, costOf(first!.memberId, '2026-09-04'));
    expectedDays.set(second!.memberId, costOf(second!.memberId, '2026-09-20'));
    expectedDays.set(third!.memberId, costOf(third!.memberId, '2026-09-04'));
    expect(expectedDays.get(second!.memberId)).toBeGreaterThan(0);

    const down = sortedBy('silazno');
    const up = sortedBy('uzlazno');
    const daysOf = (memberId: string) => expectedDays.get(memberId)!;

    // Each row is its own member's days, as Godišnji charges them.
    for (const row of down.rows) {
      expect(row.leaveDays, row.name).toBe(daysOf(row.memberId));
      expect(row.leave).toEqual(row.leaveDays === 0 ? null : { key: 'count.days', values: { count: row.leaveDays } });
    }
    // The order, either way, is by days, and equal days (every member at 0 among them) read by name, ascending both ways.
    expect(down.rows.map((row) => row.memberId)).toEqual(
      [...byName].sort((one, other) => daysOf(other.memberId) - daysOf(one.memberId)).map((row) => row.memberId),
    );
    expect(up.rows.map((row) => row.memberId)).toEqual(
      [...byName].sort((one, other) => daysOf(one.memberId) - daysOf(other.memberId)).map((row) => row.memberId),
    );
    expect(down.rows[0]!.memberId).toBe(second!.memberId);
    expect(down.footer!.leave).toEqual({
      key: 'count.days',
      values: { count: [...expectedDays.values()].reduce((sum, one) => sum + one, 0) },
    });
    // Leave days take nothing out of the hours: no shift was accepted as uncovered.
    expect(down.rows.find((row) => row.memberId === second!.memberId)!.hours).toEqual(second!.hours);
  });

  it('a new column starts ascending, and pressing it again flips it', () => {
    const total = nextHoursSort(DEFAULT_HOURS_SORT, 'ukupno');

    expect(total).toEqual({ key: 'ukupno', direction: 'uzlazno' });
    expect(nextHoursSort(total, 'ukupno')).toEqual({ key: 'ukupno', direction: 'silazno' });
    expect(nextHoursSort({ key: 'ukupno', direction: 'silazno' }, 'tim')).toEqual({ key: 'tim', direction: 'uzlazno' });
    expect(nextHoursSort(DEFAULT_HOURS_SORT, 'ime')).toEqual({ key: 'ime', direction: 'silazno' });
  });

  it('writes no parameter for the default', () => {
    expect(hoursSortChangeOf(DEFAULT_HOURS_SORT)).toEqual({ sort: null, smjer: null });
    expect(hoursSortChangeOf({ key: 'ime', direction: 'silazno' })).toEqual({ sort: null, smjer: 'silazno' });
    expect(hoursSortChangeOf({ key: 'ukupno', direction: 'uzlazno' })).toEqual({ sort: 'ukupno', smjer: null });
  });

  it('reports aria-sort on the sorted heading alone, and its arrow the same way', () => {
    const sort = { key: 'ukupno', direction: 'silazno' } as const;

    expect(hoursAriaSortOf(sort, 'ukupno')).toBe('descending');
    expect(hoursAriaSortOf(sort, 'ime')).toBe('none');
    expect(hoursAriaSortOf(DEFAULT_HOURS_SORT, 'ime')).toBe('ascending');
    expect(hoursSortArrowOf(sort, 'ukupno')).toBe('down');
    expect(hoursSortArrowOf(DEFAULT_HOURS_SORT, 'ime')).toBe('up');
    expect(hoursSortArrowOf(sort, 'ime')).toBeNull();
    // Story 7.6: the phone's sort control points the sorted column's way.
    expect(hoursSortDirectionArrowOf(sort)).toBe('down');
    expect(hoursSortDirectionArrowOf(DEFAULT_HOURS_SORT)).toBe('up');
  });
});

describe('the matrix edges', () => {
  it('stale params: an unknown person and a deleted band are dropped — all rows, by name', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS, hoursSearchOf({ mjesec: MONTH, osoba: 'nobody', smjena: 'gone', sort: 'pojas-deleted' }));

    expect(view.person).toBeNull();
    expect(view.team).toBeNull();
    expect(view.sort).toEqual(DEFAULT_HOURS_SORT);
    expect(names(view)).toEqual(names(viewOf(pilot, NO_LEAVE_RECORDS)));
    expect(view.search).toEqual({ mjesec: MONTH });
  });

  it('a stale column falls back to the whole default: name ascending, neither parameter kept', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS, hoursSearchOf({ mjesec: MONTH, sort: 'pojas-deleted', smjer: 'silazno' }));

    expect(view.sort).toEqual({ key: 'ime', direction: 'uzlazno' });
    expect(names(view)).toEqual(names(viewOf(pilot, NO_LEAVE_RECORDS)));
    expect(view.search).toEqual({ mjesec: MONTH });
    // No column at all keeps its direction: that is the name, pressed twice.
    expect(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, smjer: 'silazno' }).sort).toEqual({ key: 'ime', direction: 'silazno' });
    expect(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, smjer: 'silazno' }).search).toEqual({ mjesec: MONTH, smjer: 'silazno' });
  });

  it('an empty table says what is true: who is where this month, or nobody has a row (story 7.5)', () => {
    expect(viewOf(pilot, NO_LEAVE_RECORDS).empty).toBeNull();
    // Matrix: combine — Filip is in D, not B.
    const filtered = viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, smjena: teamOf(PILOT, 1), osoba: FILIP }).empty;

    expect(filtered).toEqual({
      code: HOURS_EMPTY_NOT_IN_TEAM,
      person: 'Filip Filić',
      personTeam: 'Smjena D',
      team: 'Smjena B',
      month: MONTH,
    });
    expect(hoursEmptyMessageKey(filtered!)).toBe('filter.empty.notInTeam');
    expect(hoursEmptyFactMessageKey('Smjena D')).toBe('filter.empty.inTeam');
    expect(hoursEmptyFactMessageKey(null)).toBe('filter.empty.noTeam');
    expect(
      t('filter.empty.notInTeam', { person: 'Luka Knežević', team: 'Smjena B', monthIn: t('filter.monthIn.10'), year: '2026' }),
    ).toBe('Luka Knežević nije u smjeni Smjena B u listopadu 2026.');
    expect(t('filter.empty.inTeam', { person: 'Luka Knežević', team: 'Smjena A' })).toBe('Luka Knežević je u smjeni Smjena A.');
    expect(t('filter.empty.noTeam', { person: 'Luka Knežević', monthIn: t('filter.monthIn.10'), year: '2026' })).toBe(
      'Luka Knežević nije ni u jednoj smjeni u listopadu 2026.',
    );
    expect(t('filter.empty.removeTeam', { team: 'Smjena B' })).toBe('Ukloni filtar: Smjena B');

    const empty = viewOf({ ...pilot, members: [] }, NO_LEAVE_RECORDS);

    expect(empty.rows).toEqual([]);
    expect(empty.empty).toEqual({ code: HOURS_EMPTY_MONTH });
    expect(hoursEmptyMessageKey({ code: HOURS_EMPTY_MONTH })).toBe('sati.organization.emptyMonth');
    expect(t('sati.organization.emptyMonth')).toBe('U ovom mjesecu nema nijedne osobe.');
    // A filter alone never empties the table today (its options are the
    // rows'); were it to, the table says the filters show nobody, never throws.
    expect(hoursEmptyOf(0, viewOf(pilot, NO_LEAVE_RECORDS).rows, null, FILIP, MONTH)).toEqual({ code: HOURS_EMPTY_FILTERED });
    expect(hoursEmptyOf(0, viewOf(pilot, NO_LEAVE_RECORDS).rows, null, 'gone', MONTH)).toEqual({ code: HOURS_EMPTY_FILTERED });
    expect(hoursEmptyMessageKey({ code: HOURS_EMPTY_FILTERED })).toBe('filter.empty.filtered');
    expect(t('filter.empty.filtered')).toBe('Odabrani filtri ne prikazuju nijednu osobu.');
  });

  it('spans a row across every column: the fixed six and one per band', async () => {
    expect(viewOf(pilot, NO_LEAVE_RECORDS).columnCount).toBe(8);
    expect(viewOf(uj5, NO_LEAVE_RECORDS).columnCount).toBe(9);
    expect(viewOf(await organizationOf({ ...PILOT, bands: [] }), NO_LEAVE_RECORDS).columnCount).toBe(6);
  });

  it('names the month in the caption', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS);

    expect(t('sati.organization.caption', { month: view.header.monthName, year: view.header.year })).toBe(
      'Sati svih osoba: Rujan 2026',
    );
  });

  it("navigates from the table's own search for an admin, and from the month alone for a member", () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, smjena: teamOf(PILOT, 1), osoba: 'gone', sort: 'ukupno', smjer: 'silazno' });
    const raw: HoursSearch = { mjesec: MONTH, smjena: 't', osoba: 'o', sort: 'ukupno', smjer: 'silazno' };

    expect(hoursSearchBaseOf(view, raw)).toEqual({ mjesec: MONTH, smjena: teamOf(PILOT, 1), sort: 'ukupno', smjer: 'silazno' });
    expect(hoursSearchBaseOf(null, raw)).toEqual({ mjesec: MONTH });
    expect(hoursSearchBaseOf(null, { smjena: 't', sort: 'ukupno' })).toEqual({});
  });

  it('the search the table stands for keeps what it applies, and reloading it gives the same rows in the same order', () => {
    const search = { mjesec: MONTH, smjena: teamOf(PILOT, 1), sort: 'ukupno', smjer: 'silazno' } as const;
    const view = viewOf(pilot, NO_LEAVE_RECORDS, search);

    expect(view.search).toEqual(search);
    expect(viewOf(pilot, NO_LEAVE_RECORDS, hoursSearchOf({ ...view.search })).rows).toEqual(view.rows);
  });

  it('zero bands: no band column, the totals shown', async () => {
    const view = viewOf(await organizationOf({ ...PILOT, bands: [] }), NO_LEAVE_RECORDS);

    expect(view.bands).toEqual([]);
    for (const row of view.rows) expect(row.bands).toEqual([]);
    expect(shown(view.rows.find((row) => row.memberId === VIEWER_MEMBER)!.total)).toBe('180 h');
    expect(shown(view.rows.find((row) => row.memberId === ANA)!.total)).toBe('192 h');
  });

  it('untimed: one note for the rows shown, their untimed shifts summed', async () => {
    const snapshot = await organizationOf({
      ...PILOT,
      types: PILOT.types.map((type) =>
        type['id'] === 'pilot-dan' ? typeRow('pilot-dan', 'Dan', type['created_at'] as string) : type,
      ),
    });
    const view = viewOf(snapshot, NO_LEAVE_RECORDS);
    const sum = view.rows.reduce((total, row) => total + row.untimedShiftCount, 0);

    expect(sum).toBeGreaterThan(0);
    expect(view.untimedShiftCount).toBe(sum);
    const ana = viewOf(snapshot, NO_LEAVE_RECORDS, { mjesec: MONTH, osoba: ANA });

    expect(ana.untimedShiftCount).toBe(ana.rows[0]!.untimedShiftCount);
    expect(viewOf(snapshot, NO_LEAVE_RECORDS, { mjesec: MONTH, osoba: DORA }).untimedShiftCount).toBeNull();
    expect(viewOf(pilot, NO_LEAVE_RECORDS).untimedShiftCount).toBeNull();
  });

  it('the footer totals each column of the rows shown, and nothing when none is shown (story 7.14)', () => {
    for (const snapshot of [pilot, uj5]) {
      const view = viewOf(snapshot, NO_LEAVE_RECORDS);
      const footer = view.footer!;
      const minutes = (figure: { readonly values: { readonly hours: number; readonly minutes: number } }): number =>
        figure.values.hours * 60 + figure.values.minutes;

      expect(minutes(footer.total)).toBe(view.rows.reduce((sum, row) => sum + row.hours.totalMinutes, 0));
      expect(footer.shiftCount).toBe(view.rows.reduce((sum, row) => sum + row.shiftCount, 0));
      expect(footer.leave).toBeNull();
      expect(footer.conflictCount).toBe(view.rows.reduce((sum, row) => sum + row.conflictCount, 0));
      expect(footer.bands.map((band) => band.bandId)).toEqual(view.bands.map((band) => band.bandId));
      footer.bands.forEach((band, index) => {
        expect(minutes(band.hours)).toBe(view.rows.reduce((sum, row) => sum + row.hours.bands[index]!.minutes, 0));
      });
      // The columns add up to the footer's total: the bands partition it.
      expect(footer.bands.reduce((sum, band) => sum + minutes(band.hours), 0)).toBe(minutes(footer.total));
    }

    const one = viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, osoba: ANA });

    expect(one.footer!.total).toEqual(one.rows[0]!.total);
    expect(hoursFooterOf([], one.bands)).toBeNull();
  });

  it('a RangeError for any row refuses the whole table, logged, never thrown', () => {
    const errors = quiet();
    const broken: CalendarSnapshot = { ...pilot, bands: [...pilot.bands, pilot.bands[0]!] };

    expect(organizationHoursOf(broken, { mjesec: MONTH }, TODAY, NO_COLLISIONS, [], NO_LEAVE_RECORDS)).toEqual({ ok: false, code: HOURS_UNAVAILABLE });
    expect(errors).toHaveBeenCalledWith(HOURS_UNAVAILABLE, expect.any(RangeError));
    const team = { ...pilot, teams: pilot.teams.filter((one) => one.id !== teamOf(PILOT, 1)) };

    expect(organizationHoursOf(team, { mjesec: MONTH }, TODAY, NO_COLLISIONS, [], NO_LEAVE_RECORDS)).toEqual({ ok: false, code: HOURS_UNAVAILABLE });
  });

  it('anything but a RangeError is not swallowed', () => {
    const broken = { ...pilot, get bands(): never { throw new TypeError('defect'); } } as unknown as CalendarSnapshot;

    expect(() => organizationHoursOf(broken, { mjesec: MONTH }, TODAY, NO_COLLISIONS, [], NO_LEAVE_RECORDS)).toThrow(TypeError);
  });
});

describe('the surface', () => {
  it('an admin sees the table, never their own figures', () => {
    const surface = hoursSurfaceOf({ snapshot: pilot, refusal: null, loading: false }, READY, { mjesec: MONTH }, TODAY);

    expect(surface.view).toBeNull();
    expect(surface.organization).toEqual(viewOf(pilot, NO_LEAVE_RECORDS));
    expect(surface.month).toEqual(monthHeaderOf(MONTH, TODAY));
    expect(surface.navShown).toBe(true);
    expect(surface.refusal).toBeNull();
    expect(surface.loading).toBe(false);
  });

  it('a member-role viewer sees exactly the 4.1b screen, whatever the search holds', async () => {
    const asMember = await organizationOf(PILOT, { role: 'member_role' });
    const state = { snapshot: asMember, refusal: null, loading: false };
    const search = { mjesec: MONTH, smjena: teamOf(PILOT, 1), sort: 'ukupno' } as const;

    expect(hoursSurfaceOf(state, READY, search, TODAY)).toEqual({
      ...myHoursSurfaceOf(state, READY, { mjesec: MONTH }, TODAY),
      organization: null,
    });
  });

  it('a failed or pending read is the 4.1b surface: the message alone, or the skeleton', () => {
    expect(hoursSurfaceOf({ snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false }, null, {}, null)).toEqual({
      view: null,
      organization: null,
      month: null,
      navShown: false,
      refusal: HOURS_UNAVAILABLE,
      retryable: true,
      loading: false,
    });
    expect(hoursSurfaceOf({ snapshot: null, refusal: null, loading: true }, null, {}, null)).toMatchObject({
      organization: null,
      loading: true,
      navShown: true,
    });
  });

  it('a refused table is the message in place of it, the month navigation kept', () => {
    quiet();
    const broken: CalendarSnapshot = { ...pilot, bands: [...pilot.bands, pilot.bands[0]!] };

    expect(hoursSurfaceOf({ snapshot: broken, refusal: null, loading: false }, READY, { mjesec: '2026-10' }, TODAY)).toEqual({
      view: null,
      organization: null,
      month: monthHeaderOf('2026-10', TODAY),
      navShown: true,
      refusal: HOURS_UNAVAILABLE,
      retryable: false,
      loading: false,
    });
  });
});
