import { memberHoursOfMonth } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CALENDAR_UNAVAILABLE, readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarDayListOf, calendarMonthOf, monthHeaderOf } from '@/features/calendar/utils/month';
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
  hoursEmptyMessageKey,
  hoursPersonChangeOf,
  hoursSearchBaseOf,
  hoursSortArrowOf,
  hoursSortChangeOf,
  hoursSurfaceOf,
  hoursTeamChangeOf,
  nextHoursSort,
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

function viewOf(snapshot: CalendarSnapshot, search: HoursSearch = { mjesec: MONTH }): OrganizationHoursView {
  const outcome = organizationHoursOf(snapshot, search, TODAY);

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
    const view = viewOf(current);

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
      expect(shown(row.leave)).toBe('0 h');
    }

    const own = myHoursOf(current, { mjesec: MONTH }, TODAY);

    if (!own.ok) throw new Error(own.code);
    const mine = view.rows.find((row) => row.memberId === VIEWER_MEMBER)!;

    expect(mine.total).toEqual(own.view.total);
    expect(mine.shiftCount).toBe(own.view.shiftCount);
    expect(mine.bands).toEqual(own.view.bands);
    expect(mine.leave).toEqual(own.view.leave);
  });

  it("a member-role viewer's own screen equals the admin's row for them", async () => {
    const asMember = await organizationOf(PILOT, { role: 'member_role' });
    const own = myHoursOf(asMember, { mjesec: MONTH }, TODAY);

    if (!own.ok) throw new Error(own.code);
    const row = viewOf(pilot).rows.find((one) => one.memberId === VIEWER_MEMBER)!;

    expect(row.total).toEqual(own.view.total);
    expect(row.bands).toEqual(own.view.bands);
    expect(row.shiftCount).toBe(own.view.shiftCount);
  });

  it('UJ-5: the band cells split each shift, and sum to the total on every row', () => {
    const view = viewOf(uj5);

    expect(view.bands.map((band) => band.name)).toEqual(['Jutro', 'Popodne', 'Noć']);
    for (const row of view.rows) {
      expect(row.bands.reduce((sum, band) => sum + minutesOf(band.hours), 0)).toBe(minutesOf(row.total));
      // Every UJ-5 shift straddles a band edge.
      expect(row.bands.reduce((sum, band) => sum + band.shiftCount, 0)).toBe(2 * row.shiftCount);
    }
  });

  it('a member inactive all month with no shift is not listed; one inactive part of it is', () => {
    const view = viewOf(pilot);
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
    const cedo = viewOf(pilot).rows.find((row) => row.memberId === CEDO)!;

    expect(cedo.team).toEqual({ id: b, name: 'Smjena B' });
    expect(viewOf(pilot, { mjesec: MONTH, tim: b }).rows.map((row) => row.memberId)).toContain(CEDO);
    expect(viewOf(pilot, { mjesec: MONTH, tim: teamOf(PILOT, 0) }).rows.map((row) => row.memberId)).not.toContain(
      CEDO,
    );
  });

  it('a member on no team reads —, 0 h, and is hidden under any team filter', () => {
    const dora = viewOf(pilot).rows.find((row) => row.memberId === DORA)!;

    expect(dora.team).toBeNull();
    expect(shown(dora.total)).toBe('0 h');
    expect(dora.shiftCount).toBe(0);
    expect(t('sati.organization.noTeam')).toBe('—');
    for (const team of viewOf(pilot).teams) {
      expect(viewOf(pilot, { mjesec: MONTH, tim: team.id }).rows.map((row) => row.memberId)).not.toContain(DORA);
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
    const view = viewOf(snapshot);
    const dora = view.rows.find((row) => row.memberId === DORA)!;

    expect(dora.shiftCount).toBe(1);
    expect(shown(dora.total)).toBe('12 h');
    // Her team is her membership's, and she has none: the shift is not a team.
    expect(dora.team).toBeNull();
    // An inactive member is never put on a shift, so Ema has none and no row.
    expect(view.rows.map((row) => row.memberId)).not.toContain(EMA);
  });

  it('each name leads to their calendar month in Sve smjene', () => {
    const row = viewOf(pilot, { mjesec: '2026-10' }).rows.find((one) => one.memberId === ANA)!;

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
      const rows = organizationHoursRowsOf(current, month, monthHeaderOf(month, TODAY)).map((row) => row.memberId);
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
    const view = viewOf(pilot);

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

    expect(names(viewOf(pilot, { mjesec: MONTH, tim: b }))).toEqual(['Ana Anić', 'Čedo Čačić']);
    expect(names(viewOf(pilot, { mjesec: MONTH, tim: b, osoba: ANA }))).toEqual(['Ana Anić']);
    expect(names(viewOf(pilot, { mjesec: MONTH, tim: b, osoba: FILIP }))).toEqual([]);
    expect(names(viewOf(pilot, { mjesec: MONTH, osoba: FILIP }))).toEqual(['Filip Filić']);
  });

  it('map the selects: "all" drops the parameter', () => {
    expect(hoursTeamChangeOf('')).toEqual({ tim: null });
    expect(hoursTeamChangeOf('t')).toEqual({ tim: 't' });
    expect(hoursPersonChangeOf('')).toEqual({ osoba: null });
    expect(hoursPersonChangeOf(ANA)).toEqual({ osoba: ANA });
  });
});

describe('the sort', () => {
  it('opens by name, ascending, under the Croatian collation', () => {
    const view = viewOf(pilot);

    expect(view.sort).toEqual(DEFAULT_HOURS_SORT);
    expect(names(view)).toEqual(['Ana Anić', 'Čedo Čačić', 'Dora Dorić', 'Filip Filić', VIEWER_NAME]);
  });

  it('by total, descending, with ties by name', () => {
    const view = viewOf(pilot, hoursSearchOf({ mjesec: MONTH, sort: 'ukupno', smjer: 'silazno' }));
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
    expect(names(viewOf(pilot, { mjesec: MONTH, sort: 'ukupno' }))).toEqual([
      'Dora Dorić',
      'Filip Filić',
      VIEWER_NAME,
      'Ana Anić',
      'Čedo Čačić',
    ]);
  });

  it('by team, a row with no team after every team, and by a band', () => {
    expect(names(viewOf(pilot, { mjesec: MONTH, sort: 'tim' })).at(-1)).toBe('Dora Dorić');
    expect(names(viewOf(pilot, { mjesec: MONTH, sort: 'tim', smjer: 'silazno' }))[0]).toBe('Dora Dorić');
    const band = pilot.bands[0]!;
    const view = viewOf(pilot, { mjesec: MONTH, sort: bandSortKeyOf(band.id), smjer: 'silazno' });
    const minutes = view.rows.map((row) => minutesOf(row.bands[0]!.hours));

    expect(view.sort).toEqual({ key: `pojas-${band.id}`, direction: 'silazno' });
    expect(minutes).toEqual([...minutes].sort((first, second) => second - first));
  });

  it('by shifts and by leave', () => {
    const shifts = viewOf(pilot, { mjesec: MONTH, sort: 'smjene' }).rows.map((row) => row.shiftCount);

    expect(shifts).toEqual([...shifts].sort((first, second) => first - second));
    // Leave is 0 everywhere until Epic 5: the order is the names'.
    expect(names(viewOf(pilot, { mjesec: MONTH, sort: 'dopust', smjer: 'silazno' }))).toEqual(names(viewOf(pilot)));
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
  });
});

describe('the matrix edges', () => {
  it('stale params: an unknown person and a deleted band are dropped — all rows, by name', () => {
    const view = viewOf(pilot, hoursSearchOf({ mjesec: MONTH, osoba: 'nobody', tim: 'gone', sort: 'pojas-deleted' }));

    expect(view.person).toBeNull();
    expect(view.team).toBeNull();
    expect(view.sort).toEqual(DEFAULT_HOURS_SORT);
    expect(names(view)).toEqual(names(viewOf(pilot)));
    expect(view.search).toEqual({ mjesec: MONTH });
  });

  it('a stale column falls back to the whole default: name ascending, neither parameter kept', () => {
    const view = viewOf(pilot, hoursSearchOf({ mjesec: MONTH, sort: 'pojas-deleted', smjer: 'silazno' }));

    expect(view.sort).toEqual({ key: 'ime', direction: 'uzlazno' });
    expect(names(view)).toEqual(names(viewOf(pilot)));
    expect(view.search).toEqual({ mjesec: MONTH });
    // No column at all keeps its direction: that is the name, pressed twice.
    expect(viewOf(pilot, { mjesec: MONTH, smjer: 'silazno' }).sort).toEqual({ key: 'ime', direction: 'silazno' });
    expect(viewOf(pilot, { mjesec: MONTH, smjer: 'silazno' }).search).toEqual({ mjesec: MONTH, smjer: 'silazno' });
  });

  it('an empty table says why: nobody matches the filter, or nobody has a row this month', () => {
    expect(hoursEmptyMessageKey(3, 5)).toBeNull();
    expect(hoursEmptyMessageKey(0, 5)).toBe('sati.organization.empty');
    expect(hoursEmptyMessageKey(0, 0)).toBe('sati.organization.emptyMonth');
    expect(viewOf(pilot).empty).toBeNull();
    expect(viewOf(pilot, { mjesec: MONTH, tim: teamOf(PILOT, 1), osoba: FILIP }).empty).toBe('sati.organization.empty');
    const empty = viewOf({ ...pilot, members: [] });

    expect(empty.rows).toEqual([]);
    expect(empty.empty).toBe('sati.organization.emptyMonth');
    expect(t('sati.organization.emptyMonth')).toBe('U ovom mjesecu nema nijedne osobe.');
  });

  it('spans a row across every column: the fixed five and one per band', async () => {
    expect(viewOf(pilot).columnCount).toBe(7);
    expect(viewOf(uj5).columnCount).toBe(8);
    expect(viewOf(await organizationOf({ ...PILOT, bands: [] })).columnCount).toBe(5);
  });

  it('names the month in the caption', () => {
    const view = viewOf(pilot);

    expect(t('sati.organization.caption', { month: view.header.monthName, year: view.header.year })).toBe(
      'Sati svih osoba: Rujan 2026',
    );
  });

  it("navigates from the table's own search for an admin, and from the month alone for a member", () => {
    const view = viewOf(pilot, { mjesec: MONTH, tim: teamOf(PILOT, 1), osoba: 'gone', sort: 'ukupno', smjer: 'silazno' });
    const raw: HoursSearch = { mjesec: MONTH, tim: 't', osoba: 'o', sort: 'ukupno', smjer: 'silazno' };

    expect(hoursSearchBaseOf(view, raw)).toEqual({ mjesec: MONTH, tim: teamOf(PILOT, 1), sort: 'ukupno', smjer: 'silazno' });
    expect(hoursSearchBaseOf(null, raw)).toEqual({ mjesec: MONTH });
    expect(hoursSearchBaseOf(null, { tim: 't', sort: 'ukupno' })).toEqual({});
  });

  it('the search the table stands for keeps what it applies, and reloading it gives the same rows in the same order', () => {
    const search = { mjesec: MONTH, tim: teamOf(PILOT, 1), sort: 'ukupno', smjer: 'silazno' } as const;
    const view = viewOf(pilot, search);

    expect(view.search).toEqual(search);
    expect(viewOf(pilot, hoursSearchOf({ ...view.search })).rows).toEqual(view.rows);
  });

  it('zero bands: no band column, the totals shown', async () => {
    const view = viewOf(await organizationOf({ ...PILOT, bands: [] }));

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
    const view = viewOf(snapshot);
    const sum = view.rows.reduce((total, row) => total + row.untimedShiftCount, 0);

    expect(sum).toBeGreaterThan(0);
    expect(view.untimedShiftCount).toBe(sum);
    const ana = viewOf(snapshot, { mjesec: MONTH, osoba: ANA });

    expect(ana.untimedShiftCount).toBe(ana.rows[0]!.untimedShiftCount);
    expect(viewOf(snapshot, { mjesec: MONTH, osoba: DORA }).untimedShiftCount).toBeNull();
    expect(viewOf(pilot).untimedShiftCount).toBeNull();
  });

  it('a RangeError for any row refuses the whole table, logged, never thrown', () => {
    const errors = quiet();
    const broken: CalendarSnapshot = { ...pilot, bands: [...pilot.bands, pilot.bands[0]!] };

    expect(organizationHoursOf(broken, { mjesec: MONTH }, TODAY)).toEqual({ ok: false, code: HOURS_UNAVAILABLE });
    expect(errors).toHaveBeenCalledWith(HOURS_UNAVAILABLE, expect.any(RangeError));
    const team = { ...pilot, teams: pilot.teams.filter((one) => one.id !== teamOf(PILOT, 1)) };

    expect(organizationHoursOf(team, { mjesec: MONTH }, TODAY)).toEqual({ ok: false, code: HOURS_UNAVAILABLE });
  });

  it('anything but a RangeError is not swallowed', () => {
    const broken = { ...pilot, get bands(): never { throw new TypeError('defect'); } } as unknown as CalendarSnapshot;

    expect(() => organizationHoursOf(broken, { mjesec: MONTH }, TODAY)).toThrow(TypeError);
  });
});

describe('the surface', () => {
  it('an admin sees the table, never their own figures', () => {
    const surface = hoursSurfaceOf({ snapshot: pilot, refusal: null, loading: false }, { mjesec: MONTH }, TODAY);

    expect(surface.view).toBeNull();
    expect(surface.organization).toEqual(viewOf(pilot));
    expect(surface.month).toEqual(monthHeaderOf(MONTH, TODAY));
    expect(surface.navShown).toBe(true);
    expect(surface.refusal).toBeNull();
    expect(surface.loading).toBe(false);
  });

  it('a member-role viewer sees exactly the 4.1b screen, whatever the search holds', async () => {
    const asMember = await organizationOf(PILOT, { role: 'member_role' });
    const state = { snapshot: asMember, refusal: null, loading: false };
    const search = { mjesec: MONTH, tim: teamOf(PILOT, 1), sort: 'ukupno' } as const;

    expect(hoursSurfaceOf(state, search, TODAY)).toEqual({
      ...myHoursSurfaceOf(state, { mjesec: MONTH }, TODAY),
      organization: null,
    });
  });

  it('a failed or pending read is the 4.1b surface: the message alone, or the skeleton', () => {
    expect(hoursSurfaceOf({ snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false }, {}, null)).toEqual({
      view: null,
      organization: null,
      month: null,
      navShown: false,
      refusal: HOURS_UNAVAILABLE,
      loading: false,
    });
    expect(hoursSurfaceOf({ snapshot: null, refusal: null, loading: true }, {}, null)).toMatchObject({
      organization: null,
      loading: true,
      navShown: true,
    });
  });

  it('a refused table is the message in place of it, the month navigation kept', () => {
    quiet();
    const broken: CalendarSnapshot = { ...pilot, bands: [...pilot.bands, pilot.bands[0]!] };

    expect(hoursSurfaceOf({ snapshot: broken, refusal: null, loading: false }, { mjesec: '2026-10' }, TODAY)).toEqual({
      view: null,
      organization: null,
      month: monthHeaderOf('2026-10', TODAY),
      navShown: true,
      refusal: HOURS_UNAVAILABLE,
      loading: false,
    });
  });
});
