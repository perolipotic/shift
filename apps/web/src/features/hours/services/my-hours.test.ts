import { memberHoursOfMonth, type Collision, type MemberHours } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_UNAVAILABLE,
  readCalendar,
  type CalendarSnapshot,
} from '@/features/calendar/services/snapshot';
import { calendarDayListOf, monthHeaderOf } from '@/features/calendar/utils/month';
import { HOURS_CONFLICTS_READY, type HoursConflictsState } from '@/features/hours/services/hours-conflicts';
import {
  HOURS_BANDS_HEADING_ID,
  HOURS_MONTH_HEADING_ID,
  HOURS_UNAVAILABLE,
  hoursMessageKey,
  hoursSearchOf,
  HOURS_TEAM_PARAM,
  hoursSearchTo,
  legacyHoursSearchOf,
  figureOf,
  leaveIsEmpty,
  leaveShownOf,
  memberHoursInputOf,
  myHoursOf,
  myHoursSurfaceOf,
  myHoursViewOf,
  type HoursSearch,
  type MyHoursView,
} from '@/features/hours/services/my-hours';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  TODAY,
  UJ5,
  VIEWER_MEMBER,
  bandRow,
  calendarOrganizationRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  membersAnswerOf,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  typeRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 4.1b's rules, executed (AD-15): the search, the month heading, the
 * snapshot as the domain's input, the guarded outcome, the display rows and
 * the surface state — every row of the spec's matrix, over both fixtures.
 * Every figure is compared against `memberHoursOfMonth` itself.
 */

const MONTH = '2026-09';

/** No leave, so no collision: the figures exactly as before story 5.3d. */
const NO_COLLISIONS: readonly Collision[] = [];
const READY: HoursConflictsState = { kind: HOURS_CONFLICTS_READY, collisions: NO_COLLISIONS, leaveKeys: [] };

async function snapshotOf(
  rows: FixtureRows,
  {
    viewers = null as readonly Record<string, unknown>[] | null,
    rosterOverrides = [] as readonly Record<string, unknown>[],
  } = {},
): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    { data: [calendarOrganizationRow(rows, { viewers })], error: null, count: 1 },
    membersAnswerOf(),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

function viewOf(snapshot: CalendarSnapshot, search: HoursSearch = { mjesec: MONTH }): MyHoursView {
  const outcome = myHoursOf(snapshot, search, TODAY, NO_COLLISIONS);

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.view;
}

/** A figure as the screen renders it. */
function shown(figure: MyHoursView['total']): string {
  return t(figure.key, figure.values);
}

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

// Every console spy is restored even when an assertion before the restore fails.
afterEach(() => {
  vi.restoreAllMocks();
});

let pilot: CalendarSnapshot;
let uj5: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf(PILOT);
  uj5 = await snapshotOf(UJ5);
});

describe('the search', () => {
  it('reads a valid month, and drops an invalid one and everything else', () => {
    expect(hoursSearchOf({ mjesec: '2026-09' })).toEqual({ mjesec: '2026-09' });
    expect(hoursSearchOf({ mjesec: '2026-13' })).toEqual({});
    expect(hoursSearchOf({ mjesec: '2026-9' })).toEqual({});
    expect(hoursSearchOf({ mjesec: 202609 })).toEqual({});
    expect(hoursSearchOf({ prikaz: 'moj', tim: 'x' })).toEqual({});
    expect(hoursSearchOf({})).toEqual({});
  });

  it("reads the organization table's team, person, sort and direction, each dropped on its own when invalid", () => {
    expect(
      hoursSearchOf({ mjesec: '2026-09', smjena: 't', osoba: 'o', sort: 'ukupno', smjer: 'silazno' }),
    ).toEqual({ mjesec: '2026-09', smjena: 't', osoba: 'o', sort: 'ukupno', smjer: 'silazno' });
    for (const sort of ['ime', 'tim', 'smjene', 'ukupno', 'dopust', 'pojas-b1']) {
      expect(hoursSearchOf({ sort })).toEqual({ sort });
    }
    expect(hoursSearchOf({ sort: 'pojas-' })).toEqual({});
    expect(hoursSearchOf({ sort: 'total' })).toEqual({});
    expect(hoursSearchOf({ smjer: 'gore' })).toEqual({});
    expect(hoursSearchOf({ smjer: 'uzlazno' })).toEqual({ smjer: 'uzlazno' });
    expect(hoursSearchOf({ smjena: '', osoba: 3 })).toEqual({});
  });

  it('names the team `smjena`, as the calendar does, and never reads the old `tim` (story 7.5)', () => {
    expect(HOURS_TEAM_PARAM).toBe('smjena');
    expect(hoursSearchOf({ tim: 't' })).toEqual({});
    // `sort=tim` stays a sort value: the Team column.
    expect(hoursSearchOf({ sort: 'tim' })).toEqual({ sort: 'tim' });
  });

  it('redirects an old `?tim=` to `?smjena=`, keeping every other parameter in order (story 7.5)', () => {
    // Matrix: old URL — `/sati?tim=B&mjesec=2026-07` → `?mjesec=2026-07&smjena=B`.
    const moved = legacyHoursSearchOf({ tim: 'B', mjesec: '2026-07' });

    expect(moved).toEqual({ mjesec: '2026-07', smjena: 'B' });
    expect(Object.keys(moved ?? {})).toEqual(['mjesec', 'smjena']);
    expect(legacyHoursSearchOf({ mjesec: '2026-07', tim: 'B', osoba: 'o', sort: 'tim', smjer: 'silazno' })).toEqual({
      mjesec: '2026-07',
      osoba: 'o',
      sort: 'tim',
      smjer: 'silazno',
      smjena: 'B',
    });
    // `smjena` wins when both are present.
    expect(legacyHoursSearchOf({ tim: 'B', smjena: 'A' })).toEqual({ smjena: 'A' });
    // No `tim`, no redirect.
    expect(legacyHoursSearchOf({ smjena: 'B', mjesec: '2026-07' })).toBeNull();
    expect(legacyHoursSearchOf({})).toBeNull();
  });

  it('navigates to a month, and to the current one by dropping the parameter, keeping the rest', () => {
    expect(hoursSearchTo({}, { mjesec: '2026-10' })).toEqual({ mjesec: '2026-10' });
    expect(hoursSearchTo({ mjesec: '2026-10' }, { mjesec: null })).toEqual({});
    const table: HoursSearch = { mjesec: '2026-10', smjena: 't', osoba: 'o', sort: 'ukupno', smjer: 'silazno' };

    expect(hoursSearchTo(table, { mjesec: null })).toEqual({ smjena: 't', osoba: 'o', sort: 'ukupno', smjer: 'silazno' });
    expect(hoursSearchTo(table, { smjena: null, osoba: 'o' })).toEqual({
      mjesec: '2026-10',
      osoba: 'o',
      sort: 'ukupno',
      smjer: 'silazno',
    });
    expect(hoursSearchTo(table, { smjena: 't', osoba: 'p' })).toEqual({
      mjesec: '2026-10',
      smjena: 't',
      osoba: 'p',
      sort: 'ukupno',
      smjer: 'silazno',
    });
    expect(hoursSearchTo(table, { sort: null, smjer: null })).toEqual({ mjesec: '2026-10', smjena: 't', osoba: 'o' });
  });

  it('names its own month heading, apart from the calendar, and its bands heading', () => {
    expect(HOURS_MONTH_HEADING_ID).toBe('sati-month-heading');
    expect(HOURS_BANDS_HEADING_ID).toBe('sati-bands-heading');
  });
});

describe("the viewer's month", () => {
  it.each([
    { fixture: 'pilot', snapshot: () => pilot, bands: 2 },
    { fixture: 'UJ-5', snapshot: () => uj5, bands: 3 },
  ])('$fixture: every figure is the domain\'s, in band order, names as stored', ({ snapshot, bands }) => {
    const current = snapshot();
    const hours = memberHoursOfMonth(memberHoursInputOf(current), MONTH);
    const view = viewOf(current);

    expect(view.shiftCount).toBe(hours.shiftCount);
    expect(view.total.values).toEqual({
      hours: Math.floor(hours.totalMinutes / 60),
      minutes: hours.totalMinutes % 60,
    });
    expect(view.bands).toHaveLength(bands);
    expect(view.bands.map((band) => band.bandId)).toEqual(current.bands.map((band) => band.id));
    expect(view.bands.map((band) => band.name)).toEqual(current.bands.map((band) => band.name));
    for (const [index, band] of view.bands.entries()) {
      const domain = hours.bands[index]!;

      expect(band.bandId).toBe(domain.bandId);
      expect(band.shiftCount).toBe(domain.shiftCount);
      expect(band.hours.values.hours * 60 + band.hours.values.minutes).toBe(domain.minutes);
    }
    // No leave exists before Epic 5: the figure is empty, never `0 h`.
    expect(hours.leaveMinutes).toBe(0);
    expect(view.leave).toBeNull();
    expect(t('sati.noFigure')).toBe('—');
    // No untimed shift, so no note.
    expect(view.untimedShiftCount).toBeNull();
  });

  it('pilot: the member month holds 15 shifts, 180 h, split by the pilot bands without splitting a shift', () => {
    const view = viewOf(pilot);

    expect(view.shiftCount).toBe(15);
    expect(shown(view.total)).toBe('180 h');
    // Smjena A starts on Dan: 8 Dan and 7 Noć, or the other way round.
    expect(view.bands.map((band) => band.shiftCount).reduce((sum, count) => sum + count, 0)).toBe(15);
    expect(view.bands.map((band) => band.name)).toEqual(['Dan', 'Noć']);
    for (const band of view.bands) expect(band.hours.values).toEqual({ hours: band.shiftCount * 12, minutes: 0 });
    expect(t('sati.shiftCount', { count: view.shiftCount })).toBe('15 smjena');
  });

  it('UJ-5: every shift straddles a band edge, so the band counts sum to twice the shifts', () => {
    const view = viewOf(uj5);

    expect(view.bands.reduce((sum, band) => sum + band.shiftCount, 0)).toBe(2 * view.shiftCount);
  });

  it.each([
    { fixture: 'pilot', snapshot: () => pilot },
    { fixture: 'UJ-5', snapshot: () => uj5 },
  ])('$fixture: the shifts counted are exactly the working shifts of the day list', ({ snapshot }) => {
    const current = snapshot();
    const working = new Set(current.types.filter((type) => type.isWorking).map((type) => type.id));
    const days = calendarDayListOf(current, current.viewer, MONTH, TODAY) ?? [];
    const workingShifts = days.flatMap((day) =>
      day.shifts.filter((shift) => shift.cell.shiftTypeId !== null && working.has(shift.cell.shiftTypeId)),
    );

    expect(viewOf(current).shiftCount).toBe(workingShifts.length);
  });

  it('follows a roster override: a shift the viewer was taken off leaves their hours', async () => {
    const before = viewOf(pilot);
    const days = calendarDayListOf(pilot, pilot.viewer, MONTH, TODAY) ?? [];
    const worked = days.find((day) =>
      day.shifts.some((shift) => shift.cell.shiftTypeId === 'pilot-dan' || shift.cell.shiftTypeId === 'pilot-noc'),
    );

    expect(worked).toBeDefined();
    const after = viewOf(
      await snapshotOf(PILOT, {
        rosterOverrides: [calendarRosterOverrideRow('off', 'pilot-smjena-a', worked!.date, VIEWER_MEMBER, null)],
      }),
    );

    expect(after.shiftCount).toBe(before.shiftCount - 1);
    expect(shown(after.total)).toBe('168 h');
  });

  it('moving a band boundary changes band hours and never the total', async () => {
    const moved = viewOf(
      await snapshotOf({
        ...PILOT,
        bands: [bandRow('pilot-band-dan', 'Dan', '06:00:00'), bandRow('pilot-band-noc', 'Noć', '21:00:00')],
      }),
    );
    const before = viewOf(pilot);

    expect(moved.total).toEqual(before.total);
    expect(moved.shiftCount).toBe(before.shiftCount);
    expect(moved.bands.map((band) => band.hours)).not.toEqual(before.bands.map((band) => band.hours));
    // 19:00–07:00 under 06:00/21:00 is 3 h in the first band and 9 h in the second.
    const noc = memberHoursOfMonth(memberHoursInputOf(pilot), MONTH).bands[1]!.shiftCount;
    const dan = before.shiftCount - noc;

    expect(moved.bands[0]!.hours.values.hours * 60 + moved.bands[0]!.hours.values.minutes).toBe(
      dan * 720 + noc * 180,
    );
    expect(moved.bands[1]!.hours.values).toEqual({ hours: noc * 9, minutes: 0 });
  });

  it('shows the heading of the month, and the current one for a bad or missing month', () => {
    expect(viewOf(pilot).header).toEqual(monthHeaderOf(MONTH, TODAY));
    expect(viewOf(pilot).header).toMatchObject({
      month: '2026-09',
      monthName: 'Rujan',
      year: '2026',
      previous: '2026-08',
      next: '2026-10',
      isCurrent: true,
      current: '2026-09',
    });
    expect(viewOf(pilot, hoursSearchOf({ mjesec: '2026-13' })).header.month).toBe('2026-09');
    expect(viewOf(pilot, {}).header.month).toBe('2026-09');
    expect(viewOf(pilot, { mjesec: '2026-10' }).header).toMatchObject({ month: '2026-10', isCurrent: false, current: '2026-09' });
  });
});

describe('the matrix edges', () => {
  it('no shifts: an admin with no team has 0 h, 0 shifts and every band at 0 h', async () => {
    const view = viewOf(await snapshotOf(PILOT, { viewers: [viewerRow([], { role: 'admin' })] }));

    expect(view.shiftCount).toBe(0);
    expect(shown(view.total)).toBe('0 h');
    expect(view.bands.map((band) => shown(band.hours))).toEqual(['0 h', '0 h']);
    expect(view.bands.map((band) => band.shiftCount)).toEqual([0, 0]);
    expect(t('sati.shiftCount', { count: 0 })).toBe('0 smjena');
  });

  it('zero bands: the total is shown, and there is no band row', async () => {
    const view = viewOf(await snapshotOf({ ...PILOT, bands: [] }));

    expect(view.bands).toEqual([]);
    expect(shown(view.total)).toBe('180 h');
  });

  it('untimed: working shifts with no times are counted as shifts, never in hours, and named', async () => {
    const untimed = {
      ...PILOT,
      types: PILOT.types.map((type) =>
        type['id'] === 'pilot-dan' ? typeRow('pilot-dan', 'Dan', type['created_at'] as string) : type,
      ),
    };
    const snapshot = await snapshotOf(untimed);
    const view = viewOf(snapshot);
    const hours = memberHoursOfMonth(memberHoursInputOf(snapshot), MONTH);

    expect(view.untimedShiftCount).toBe(hours.untimedShiftCount);
    expect(view.untimedShiftCount).toBe(8);
    expect(view.shiftCount).toBe(15);
    // THE RULE: only the 7 timed Noć shifts count, 7 × 12 h; the untimed Dan
    // shifts add nothing, so the band they would fall in holds 0 h and no shift.
    expect(shown(view.total)).toBe('84 h');
    expect(view.bands.map((band) => ({ name: band.name, hours: shown(band.hours), shifts: band.shiftCount }))).toEqual([
      { name: 'Dan', hours: '0 h', shifts: 0 },
      { name: 'Noć', hours: '84 h', shifts: 7 },
    ]);
    // All three Croatian forms, the fixture's own 8 among them.
    expect(t('sati.untimed', { count: 8 })).toBe('8 smjena nema upisano vrijeme pa nije uračunato u sate.');
    expect(t('sati.untimed', { count: 2 })).toBe('2 smjene nemaju upisano vrijeme pa nisu uračunate u sate.');
    expect(t('sati.untimed', { count: 1 })).toBe('1 smjena nema upisano vrijeme pa nije uračunata u sate.');
  });

  it('odd minutes: a band total of 750 min reads 12 h 30 min', () => {
    const hours: MemberHours = {
      shiftCount: 1,
      bands: [
        { bandId: 'pilot-band-dan', minutes: 750, shiftCount: 1 },
        { bandId: 'pilot-band-noc', minutes: 45, shiftCount: 1 },
      ],
      unbandedMinutes: 0,
      totalMinutes: 795,
      leaveMinutes: 0,
      untimedShiftCount: 0,
    };
    const view = myHoursViewOf(pilot, monthHeaderOf(MONTH, TODAY), hours, 0);

    expect(view.bands.map((band) => shown(band.hours))).toEqual(['12 h 30 min', '45 min']);
    expect(shown(view.total)).toBe('13 h 15 min');
  });

  it('leave: 0 is empty, and a positive leave reads as a duration with no further change', () => {
    const hoursWith = (leaveMinutes: number): MemberHours => ({
      shiftCount: 1,
      bands: [
        { bandId: 'pilot-band-dan', minutes: 720, shiftCount: 1 },
        { bandId: 'pilot-band-noc', minutes: 0, shiftCount: 0 },
      ],
      unbandedMinutes: 0,
      totalMinutes: 720,
      leaveMinutes,
      untimedShiftCount: 0,
    });
    const none = myHoursViewOf(pilot, monthHeaderOf(MONTH, TODAY), hoursWith(0), 0);
    const some = myHoursViewOf(pilot, monthHeaderOf(MONTH, TODAY), hoursWith(750), 0);

    expect(none.leave).toBeNull();
    expect(some.leave).not.toBeNull();
    expect(shown(some.leave!)).toBe('12 h 30 min');
    // Leave is never in the total or a band.
    expect(shown(some.total)).toBe('12 h');
    expect(some.bands.map((band) => shown(band.hours))).toEqual(['12 h', '0 h']);
  });

  it('leave: zero is the one empty rule, and what a leave reads as goes through t()', () => {
    expect(leaveIsEmpty(0)).toBe(true);
    expect(leaveIsEmpty(1)).toBe(false);
    expect(leaveIsEmpty(750)).toBe(false);
    const none = leaveShownOf(null);
    const some = leaveShownOf(figureOf(750));

    expect(t(none.key, none.values)).toBe('—');
    expect(t(some.key, some.values)).toBe('12 h 30 min');
  });

  it('a band the snapshot lacks is refused, never shown nameless', () => {
    const hours: MemberHours = {
      shiftCount: 0,
      bands: [{ bandId: 'missing', minutes: 0, shiftCount: 0 }],
      unbandedMinutes: 0,
      totalMinutes: 0,
      leaveMinutes: 0,
      untimedShiftCount: 0,
    };

    expect(() => myHoursViewOf(pilot, monthHeaderOf(MONTH, TODAY), hours, 0)).toThrow(RangeError);
  });

  it('a RangeError from the domain is the one failure, logged, and no figure', () => {
    const errors = quiet();
    const broken: CalendarSnapshot = { ...pilot, bands: [...pilot.bands, { ...pilot.bands[0]!, startMinute: 3 }] };

    expect(myHoursOf(broken, { mjesec: MONTH }, TODAY, NO_COLLISIONS)).toEqual({ ok: false, code: HOURS_UNAVAILABLE });
    expect(errors).toHaveBeenCalledWith(HOURS_UNAVAILABLE, expect.any(RangeError));
  });

  it('anything but a RangeError is not swallowed', () => {
    const broken = { ...pilot, get bands(): never { throw new TypeError('defect'); } } as unknown as CalendarSnapshot;

    expect(() => myHoursOf(broken, { mjesec: MONTH }, TODAY, NO_COLLISIONS)).toThrow(TypeError);
  });
});

describe('the surface state', () => {
  it('a failed or paused read is the message alone: no figure and no navigation', () => {
    const alone = { view: null, month: null, navShown: false, refusal: HOURS_UNAVAILABLE, retryable: true, loading: false };

    expect(myHoursSurfaceOf({ snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false }, null, {}, null)).toEqual(alone);
    // ANY read refusal, a code added later included, and over a cached snapshot
    // too: never an endless skeleton, never a stale figure.
    const later = 'CALENDAR_SOMETHING_ELSE' as unknown as typeof CALENDAR_UNAVAILABLE;

    expect(myHoursSurfaceOf({ snapshot: null, refusal: later, loading: false }, null, {}, null)).toEqual(alone);
    expect(myHoursSurfaceOf({ snapshot: pilot, refusal: later, loading: false }, READY, {}, TODAY)).toEqual(alone);
    expect(hoursMessageKey(HOURS_UNAVAILABLE)).toBe('sati.error.unavailable');
    expect(t(hoursMessageKey(HOURS_UNAVAILABLE))).toBe('Sate trenutačno nije moguće učitati. Pokušaj ponovno.');
  });

  it('a pending read is the skeleton, and no figure', () => {
    expect(myHoursSurfaceOf({ snapshot: null, refusal: null, loading: true }, null, {}, null)).toEqual({
      view: null,
      month: null,
      navShown: true,
      refusal: null,
      retryable: false,
      loading: true,
    });
  });

  it('an answer is the month, and never a message beside it', () => {
    const surface = myHoursSurfaceOf({ snapshot: pilot, refusal: null, loading: false }, READY, { mjesec: MONTH }, TODAY);

    expect(surface.refusal).toBeNull();
    expect(surface.loading).toBe(false);
    expect(surface.view).toEqual(viewOf(pilot));
    expect(surface.month).toEqual(viewOf(pilot).header);
    expect(surface.navShown).toBe(true);
  });

  it('a domain refusal over an answer is the message in place of the figures, the month navigation kept', () => {
    quiet();
    const broken: CalendarSnapshot = { ...pilot, bands: [...pilot.bands, pilot.bands[0]!] };

    expect(myHoursSurfaceOf({ snapshot: broken, refusal: null, loading: false }, READY, {}, TODAY)).toEqual({
      view: null,
      month: monthHeaderOf(MONTH, TODAY),
      navShown: true,
      refusal: HOURS_UNAVAILABLE,
      retryable: false,
      loading: false,
    });
    // The month named, so the viewer can leave it.
    expect(
      myHoursSurfaceOf({ snapshot: broken, refusal: null, loading: false }, READY, { mjesec: '2026-10' }, TODAY).month,
    ).toMatchObject({ month: '2026-10', previous: '2026-09', next: '2026-11' });
  });

  it('a domain refusal on a month that cannot be headed is the message alone', () => {
    quiet();
    const broken: CalendarSnapshot = { ...pilot, bands: [...pilot.bands, pilot.bands[0]!] };

    // `today` malformed: neither the hours nor the heading can be worked out.
    expect(myHoursSurfaceOf({ snapshot: broken, refusal: null, loading: false }, READY, {}, 'not-a-date')).toEqual({
      view: null,
      month: null,
      navShown: false,
      refusal: HOURS_UNAVAILABLE,
      retryable: false,
      loading: false,
    });
  });

  it('reads the fixtures in the month today falls in', () => {
    expect(TODAY.slice(0, 7)).toBe(MONTH);
  });
});
