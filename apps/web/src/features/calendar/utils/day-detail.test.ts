import { shiftRoster } from '@shift/domain';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  OVERRIDE_REFUSED_REASON,
  OVERRIDE_REFUSED_SAME,
  dayDetailOf,
  dayDetailShownOf,
  overrideEntryOf,
  overrideOffersOf,
  overrideRemovalTargetOf,
  overrideTypeOptionsOf,
  ROSTER_REFUSED_MEMBER,
  ROSTER_REFUSED_REASON,
  inOptionOf,
  outOptionOf,
  rosterEntryOf,
  ROSTER_NOBODY,
  isoDateShiftedBy,
  rosterOffersOf,
  rosterOverlapOf,
  rosterOverlapShownOf,
  rosterRemovalTargetOf,
  type DayDetail,
  type RosterLineTranslate,
} from '@/features/calendar/utils/day-detail';
import { OVERRIDE_REMOVED, OVERRIDE_SAVED, overrideDoneMessageKey } from '@/features/calendar/services/override-write';
import { calendarMonthOf } from '@/features/calendar/utils/month';
import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { initLocalization, t } from '@/lib/i18n';
import { positionsShown, rosterLineOf, rosterPositionMessageKey } from '@/features/members/utils/position';
import { ranksShown, rosterRankMessageKey } from '@/features/members/utils/rank';
import {
  PILOT,
  SEEDED,
  UJ5,
  assignmentRow,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  calendarRosterOverrideRow,
  rosterOverridesAnswerOf,
  statusRow,
  teamRow,
  typeRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 3.4b's day detail, executed (AD-15): every row of the spec's matrix
 * but the keys and the day list's button, which `grid-keys.test.ts` and the
 * e2e suite hold. Snapshots are built as `month.test.ts` builds them, through
 * `readCalendar` over the fixture rows.
 */

async function snapshotOf(
  rows: FixtureRows,
  {
    viewers = null as readonly Record<string, unknown>[] | null,
    versions = null as readonly Record<string, unknown>[] | null,
    statuses = [] as readonly Record<string, unknown>[],
    members = undefined as readonly Record<string, unknown>[] | undefined,
    usesFireRanks = false,
    overrides = [] as readonly Record<string, unknown>[],
    rosterOverrides = [] as readonly Record<string, unknown>[],
  } = {},
): Promise<CalendarSnapshot> {
  const organization = calendarOrganizationRow(rows, { viewers, versions, statuses, usesFireRanks });
  const source = calendarTableOf(
    { data: [organization], error: null, count: 1 },
    membersAnswerOf(members),
    overridesAnswerOf(overrides),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

const ANA = '00000000-0000-4000-8000-0000000000d1';
const BORIS = '00000000-0000-4000-8000-0000000000d2';
const CVITA = '00000000-0000-4000-8000-0000000000d3';

/** Smjena B works Noć on 2020-01-01, Slobodno on the 2nd, and has no rotation before. */
const TEAM = 'pilot-smjena-b';
const WORKING = '2020-01-01';
const OFF = '2020-01-02';
const BEFORE = '2019-12-31';

/**
 * The pilot with Boris, Ana and Cvita on Smjena B from `SEEDED` — Boris
 * listed first, so the order is the detail's — Boris deactivated from the
 * 11th (after the working day) and Cvita from 2019-12-29 (before it).
 */
async function onSmjenaB(
  usesFireRanks = false,
  anaRank: string | null = 'firefighter',
  rosterOverrides: readonly Record<string, unknown>[] = [],
  rows: FixtureRows = PILOT,
): Promise<CalendarSnapshot> {
  return snapshotOf(rows, {
    rosterOverrides,
    usesFireRanks,
    viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)])],
    versions: [
      memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED),
      memberMembershipRow(BORIS, TEAM, SEEDED),
      memberMembershipRow(ANA, TEAM, SEEDED, undefined, 'driver'),
      memberMembershipRow(CVITA, TEAM, SEEDED),
    ],
    statuses: [statusRow(BORIS, false, '2020-01-11'), statusRow(CVITA, false, '2019-12-29')],
    members: [
      calendarMemberRow(BORIS, 'Boris'),
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(ANA, 'Ana', anaRank),
      calendarMemberRow(CVITA, 'Cvita'),
    ],
  });
}

/** The lines the Dialog renders, through the members modules as `kalendar.tsx` does. */
function linesOf(detail: DayDetail, snapshot: CalendarSnapshot): string[] {
  const setting = { usesFireRanks: snapshot.usesFireRanks };
  const rankShown = ranksShown(setting);
  const positionShown = positionsShown(setting);

  return detail.roster.map((member) => {
    const line = rosterLineOf(
      member.name ?? t('kalendar.detail.override.unknownAuthor'),
      rosterRankMessageKey(member.fireRank, rankShown),
      rosterPositionMessageKey(member.position, positionShown),
      (key) => t(key),
    );

    return line.key === null ? line.text : t(line.key, line.values);
  });
}

beforeAll(async () => {
  await initLocalization();
});

describe('the day detail (story 3.4b)', () => {
  it('a working day: the type, both clock times and the roster sorted by name, whatever the input order', async () => {
    const snapshot = await onSmjenaB();
    const detail = dayDetailOf(snapshot, TEAM, WORKING);

    // Matrix: working day; deactivated since — Boris (from the 11th) is
    // listed; inactive on date — Cvita (from 2019-12-29) is not.
    expect(detail).toEqual({
      teamId: TEAM,
      teamName: 'Smjena B',
      date: 'srijeda 01.01.2020',
      isoDate: WORKING,
      projectedShiftTypeId: 'pilot-noc',
      shiftTypeId: 'pilot-noc',
      kind: 'working',
      typeName: 'Noć',
      range: '19:00–07:00',
      roster: [
        { id: ANA, name: 'Ana', fireRank: 'firefighter', position: 'driver' },
        { id: BORIS, name: 'Boris', fireRank: null, position: null },
      ],
      override: null,
      pending: null,
      rosterChanges: [],
      rosterPending: [],
      rosterInert: [],
    });
  });

  it("reads the weekday and range exactly as the grid's row and cell do, and the date with its year", async () => {
    const snapshot = await onSmjenaB();
    const month = calendarMonthOf(snapshot, { mjesec: '2020-01' }, '2020-01-15');
    const column = month.columns.findIndex((team) => team.id === TEAM);

    for (const row of month.rows) {
      const detail = dayDetailOf(snapshot, TEAM, row.date)!;
      const cell = row.cells[column]!;

      expect(detail.date).toBe(`${row.weekday} ${row.dayMonth}${row.date.slice(0, 4)}`);
      expect(detail.range, row.date).toBe(cell.range);
      expect(detail.typeName, row.date).toBe(detail.kind === 'working' ? cell.name : null);
    }
  });

  it('ranks on: `Ime · čin · položaj`, and an unknown rank as rankUnknown', async () => {
    const on = await onSmjenaB(true);

    expect(linesOf(dayDetailOf(on, TEAM, WORKING)!, on)).toEqual(['Ana · vatrogasac · vozač', 'Boris']);

    const unknown = await onSmjenaB(true, 'no-such-rank');

    expect(linesOf(dayDetailOf(unknown, TEAM, WORKING)!, unknown)[0]).toBe(
      `Ana · ${t('smjene.roster.rankUnknown')} · vozač`,
    );
  });

  it('ranks off: the name alone', async () => {
    const off = await onSmjenaB(false);

    expect(linesOf(dayDetailOf(off, TEAM, WORKING)!, off)).toEqual(['Ana', 'Boris']);
  });

  it('an off day: off, no type, no range, no roster', async () => {
    const snapshot = await onSmjenaB();

    expect(dayDetailOf(snapshot, TEAM, OFF)).toEqual({
      teamId: TEAM,
      teamName: 'Smjena B',
      date: 'četvrtak 02.01.2020',
      isoDate: OFF,
      projectedShiftTypeId: 'pilot-slobodno',
      shiftTypeId: 'pilot-slobodno',
      kind: 'off',
      typeName: null,
      range: null,
      roster: [],
      override: null,
      pending: null,
      rosterChanges: [],
      rosterPending: [],
      rosterInert: [],
    });
  });

  it('no rotation in effect: noRotation, with no roster', async () => {
    const snapshot = await onSmjenaB();

    expect(dayDetailOf(snapshot, TEAM, BEFORE)).toEqual({
      teamId: TEAM,
      teamName: 'Smjena B',
      date: 'utorak 31.12.2019',
      isoDate: BEFORE,
      projectedShiftTypeId: null,
      shiftTypeId: null,
      kind: 'noRotation',
      typeName: null,
      range: null,
      roster: [],
      override: null,
      pending: null,
      rosterChanges: [],
      rosterPending: [],
      rosterInert: [],
    });
  });

  it('nobody active: working, with an empty roster', async () => {
    // The viewer alone, on the first team; the last has nobody.
    const snapshot = await snapshotOf(UJ5);
    const details = Array.from({ length: 30 }, (_, index) =>
      dayDetailOf(snapshot, 'uj5-smjena-c', `2026-09-${String(index + 1).padStart(2, '0')}`),
    );
    const working = details.filter((detail) => detail?.kind === 'working');

    expect(working.length).toBeGreaterThan(0);
    expect(working.every((detail) => detail?.roster.length === 0)).toBe(true);
    expect(t('kalendar.detail.empty')).toBe('Taj dan nitko nije raspoređen.');
  });

  it('an archived team still opens, so a day list\'s past team does', async () => {
    const snapshot = await snapshotOf(
      {
        ...PILOT,
        teams: PILOT.teams.map((team) =>
          team['id'] === TEAM ? teamRow(TEAM, 'Smjena B', { archived: true }) : team,
        ),
      },
      { viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)])] },
    );

    expect(snapshot.teams.find((team) => team.id === TEAM)?.archived).toBe(true);
    expect(dayDetailOf(snapshot, TEAM, WORKING)).toMatchObject({ teamName: 'Smjena B', kind: 'working', typeName: 'Noć' });
  });

  it('an unknown team: null', async () => {
    const snapshot = await onSmjenaB();

    expect(dayDetailOf(snapshot, 'no-such-team', WORKING)).toBeNull();
  });

  it('breaks a tie of names by id', async () => {
    const snapshot = await snapshotOf(PILOT, {
      viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)])],
      versions: [
        memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED),
        memberMembershipRow(BORIS, TEAM, SEEDED),
        memberMembershipRow(ANA, TEAM, SEEDED),
      ],
      members: [calendarMemberRow(BORIS, 'Ana'), calendarMemberRow(ANA, 'Ana'), calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME)],
    });

    expect(dayDetailOf(snapshot, TEAM, WORKING)?.roster.map((member) => member.id)).toEqual([ANA, BORIS]);
  });

  it('carries the copy the Dialog renders', () => {
    expect(t('kalendar.detail.title', { team: 'Smjena B', date: 'srijeda 01.01.2020' })).toBe(
      'Smjena B · srijeda 01.01.2020',
    );
    expect(t('kalendar.detail.close')).toBe('Zatvori');
    expect(t('kalendar.detail.roster')).toBe('Raspored');
    expect(t('kalendar.detail.off', { team: 'Smjena B' })).toBe('Smjena B taj dan ne radi.');
    expect(t('kalendar.detail.noRotation', { team: 'Smjena B' })).toBe('Smjena B taj dan nema rotacije.');
  });
});

describe('the detail shown while open (story 3.4b)', () => {
  const OPENED = { teamId: TEAM, date: WORKING };

  it('nothing open is nothing to show or close', async () => {
    expect(dayDetailShownOf(await onSmjenaB(), null)).toEqual({ detail: null, close: false });
    expect(dayDetailShownOf(null, null)).toEqual({ detail: null, close: false });
  });

  it('a refetched snapshot re-derives the roster', async () => {
    const before = await onSmjenaB();
    const after = await snapshotOf(PILOT, {
      viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)])],
      versions: [memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED), memberMembershipRow(CVITA, TEAM, SEEDED)],
      members: [calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(CVITA, 'Cvita')],
    });

    expect(dayDetailShownOf(before, OPENED).detail?.roster.map((member) => member.name)).toEqual(['Ana', 'Boris']);
    expect(dayDetailShownOf(after, OPENED)).toEqual({ detail: dayDetailOf(after, TEAM, WORKING), close: false });
    expect(dayDetailShownOf(after, OPENED).detail?.roster.map((member) => member.name)).toEqual(['Cvita']);
  });

  it('closes when the team is removed', async () => {
    const snapshot = await onSmjenaB();
    const removed = { ...snapshot, teams: snapshot.teams.filter((team) => team.id !== TEAM) };

    expect(dayDetailShownOf(removed, OPENED)).toEqual({ detail: null, close: true });
  });

  it('closes when there is no snapshot — a failed refetch, or offline', () => {
    expect(dayDetailShownOf(null, OPENED)).toEqual({ detail: null, close: true });
  });

  it('closes, logging the cause, when the derivation throws', async () => {
    const snapshot = await onSmjenaB();
    // A type the projection names but the snapshot lacks: `dayDetailOf` throws.
    const broken = { ...snapshot, types: [] };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(() => dayDetailOf(broken, TEAM, WORKING)).toThrow(RangeError);
      expect(dayDetailShownOf(broken, OPENED)).toEqual({ detail: null, close: true });
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});

describe('the day detail of an overridden day (story 3.5a)', () => {
  const MEMBERS = [calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(ANA, 'Ana')];
  const onTeam = {
    viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)])],
    versions: [memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED), memberMembershipRow(ANA, TEAM, SEEDED)],
    members: MEMBERS,
  };

  it('a working day overridden to another working type: the worked type, its range, the roster and the block', async () => {
    // Smjena B projects Noć on WORKING; the override is Dan, saved 17:05 UTC = 19:05 in Zagreb.
    const snapshot = await snapshotOf(PILOT, {
      ...onTeam,
      overrides: [calendarOverrideRow('o1', TEAM, WORKING, 'pilot-dan', { author: ANA, reason: 'Vježba.' })],
    });
    const detail = dayDetailOf(snapshot, TEAM, WORKING);

    expect(detail).toMatchObject({ kind: 'working', typeName: 'Dan', range: '07:00–19:00' });
    expect(detail?.roster.map((member) => member.name)).toEqual(['Ana']);
    expect(detail?.override).toEqual({
      id: 'o1',
      projectedTypeName: 'Noć',
      authorName: 'Ana',
      savedAt: { date: '12.09.2026', time: '19:05' },
      reason: 'Vježba.',
    });
  });

  it('an off day made a working one: working, with the roster and the block', async () => {
    const snapshot = await snapshotOf(PILOT, {
      ...onTeam,
      overrides: [calendarOverrideRow('o1', TEAM, OFF, 'pilot-dan')],
    });
    const detail = dayDetailOf(snapshot, TEAM, OFF);

    expect(detail).toMatchObject({ kind: 'working', typeName: 'Dan' });
    expect(detail?.roster.map((member) => member.name)).toEqual(['Ana']);
    expect(detail?.override).toMatchObject({ projectedTypeName: 'Slobodno', authorName: VIEWER_NAME });
  });

  it('a working day made an off one: off, no roster, and the block', async () => {
    const snapshot = await snapshotOf(PILOT, {
      ...onTeam,
      overrides: [calendarOverrideRow('o1', TEAM, WORKING, 'pilot-slobodno')],
    });
    const detail = dayDetailOf(snapshot, TEAM, WORKING);

    expect(detail).toMatchObject({ kind: 'off', typeName: null, range: null, roster: [] });
    expect(detail?.override).toMatchObject({ projectedTypeName: 'Noć' });
  });

  it('an override on a day with no rotation is ignored', async () => {
    const snapshot = await snapshotOf(PILOT, {
      ...onTeam,
      overrides: [calendarOverrideRow('o1', TEAM, BEFORE, 'pilot-dan')],
    });

    expect(dayDetailOf(snapshot, TEAM, BEFORE)).toMatchObject({ kind: 'noRotation', override: null });
  });

  it('an author who is no member the snapshot holds is unknown', async () => {
    for (const author of [null, '00000000-0000-4000-8000-0000000000ff']) {
      const snapshot = await snapshotOf(PILOT, {
        ...onTeam,
        overrides: [calendarOverrideRow('o1', TEAM, WORKING, 'pilot-dan', { author })],
      });

      expect(dayDetailOf(snapshot, TEAM, WORKING)?.override?.authorName, String(author)).toBeNull();
    }
    expect(t('kalendar.detail.override.unknownAuthor')).toBe('Nepoznata osoba');
  });

  it('another day and another team carry no block', async () => {
    const snapshot = await snapshotOf(PILOT, {
      ...onTeam,
      overrides: [calendarOverrideRow('o1', TEAM, WORKING, 'pilot-dan')],
    });

    expect(dayDetailOf(snapshot, TEAM, OFF)?.override).toBeNull();
    expect(dayDetailOf(snapshot, 'pilot-smjena-a', WORKING)?.override).toBeNull();
  });

  it('carries the copy the block renders', () => {
    expect(t('kalendar.detail.override.heading')).toBe('Izmjena');
    expect(t('kalendar.detail.override.projected', { type: 'Dan' })).toBe('Prema rotaciji: Dan');
    expect(t('kalendar.detail.override.author', { name: 'Ana' })).toBe('Autor: Ana');
    expect(t('kalendar.detail.override.savedAt', { date: '12.09.2026', time: '19:05' })).toBe(
      'Vrijeme: 12.09.2026 u 19:05',
    );
    expect(t('kalendar.detail.override.reason', { reason: 'Vježba.' })).toBe('Razlog: Vježba.');
  });
});

describe('what an admin may set on a day (story 3.5b)', () => {
  it('carries the projected type, the ISO date and the override id, whatever the override made of the day', async () => {
    const snapshot = await snapshotOf(PILOT, {
      overrides: [calendarOverrideRow('o1', TEAM, WORKING, 'pilot-slobodno')],
    });
    const detail = dayDetailOf(snapshot, TEAM, WORKING);

    expect(detail).toMatchObject({ isoDate: WORKING, projectedShiftTypeId: 'pilot-noc', kind: 'off' });
    expect(detail?.override?.id).toBe('o1');
  });

  it('offers every type that is not archived and not the projected one, in the snapshot order', async () => {
    const rows = {
      ...PILOT,
      types: [
        ...PILOT.types,
        typeRow('pilot-stara', 'Stara', '2026-09-25T20:07:49.339741+00:00', { archived: true }),
        typeRow('pilot-pripravnost', 'Pripravnost', '2026-09-25T20:07:49.338741+00:00', { working: false }),
      ],
    };
    const snapshot = await snapshotOf(rows);

    expect(overrideTypeOptionsOf(snapshot, dayDetailOf(snapshot, TEAM, WORKING)!)).toEqual([
      { id: 'pilot-dan', name: 'Dan' },
      { id: 'pilot-slobodno', name: 'Slobodno' },
      { id: 'pilot-pripravnost', name: 'Pripravnost' },
    ]);
    expect(overrideTypeOptionsOf(snapshot, dayDetailOf(snapshot, TEAM, OFF)!).map((option) => option.id)).toEqual([
      'pilot-dan',
      'pilot-noc',
      'pilot-pripravnost',
    ]);
  });

  it('offers nothing with no rotation, and nothing on a day already overridden', async () => {
    const snapshot = await snapshotOf(PILOT, {
      overrides: [calendarOverrideRow('o1', TEAM, WORKING, 'pilot-dan')],
    });

    expect(overrideTypeOptionsOf(snapshot, dayDetailOf(snapshot, TEAM, BEFORE)!)).toEqual([]);
    expect(overrideTypeOptionsOf(snapshot, dayDetailOf(snapshot, TEAM, WORKING)!)).toEqual([]);
  });

  it('preflights the type first, then the reason trimmed to 1–200 characters, and passes the trimmed reason', async () => {
    const snapshot = await onSmjenaB();
    const detail = dayDetailOf(snapshot, TEAM, WORKING)!;

    expect(overrideEntryOf(detail, 'pilot-noc', 'Zamjena')).toEqual({ ok: false, code: OVERRIDE_REFUSED_SAME });
    expect(overrideEntryOf(detail, '', 'Zamjena')).toEqual({ ok: false, code: OVERRIDE_REFUSED_SAME });
    expect(overrideEntryOf(detail, 'pilot-noc', '  ')).toEqual({ ok: false, code: OVERRIDE_REFUSED_SAME });
    for (const reason of ['', '  ', '\t\n', 'z'.repeat(201), ` ${'z'.repeat(201)} `]) {
      expect(overrideEntryOf(detail, 'pilot-dan', reason), JSON.stringify(reason)).toEqual({
        ok: false,
        code: OVERRIDE_REFUSED_REASON,
      });
    }
    expect(overrideEntryOf(detail, 'pilot-dan', '  Zamjena \n')).toEqual({
      ok: true,
      shiftTypeId: 'pilot-dan',
      reason: 'Zamjena',
    });
    expect(overrideEntryOf(detail, 'pilot-dan', ` ${'z'.repeat(200)} `)).toMatchObject({ ok: true });
    // Code points, as `char_length` counts them: 200 emoji are 400 UTF-16 units.
    expect(overrideEntryOf(detail, 'pilot-dan', '🚒'.repeat(200))).toMatchObject({ ok: true });
    expect(overrideEntryOf(detail, 'pilot-dan', '🚒'.repeat(201))).toMatchObject({ ok: false });
  });

  it('offers the form or the removal to an admin alone, and neither with no rotation', async () => {
    const asAdmin = { viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)], { role: 'admin' })] };
    const admin = await snapshotOf(PILOT, {
      ...asAdmin,
      overrides: [calendarOverrideRow('o1', TEAM, OFF, 'pilot-dan')],
    });
    const member = await snapshotOf(PILOT, { overrides: [calendarOverrideRow('o1', TEAM, OFF, 'pilot-dan')] });

    expect(overrideOffersOf(admin, dayDetailOf(admin, TEAM, WORKING))).toEqual({
      options: [
        { id: 'pilot-dan', name: 'Dan' },
        { id: 'pilot-slobodno', name: 'Slobodno' },
      ],
      set: true,
      remove: false,
    });
    expect(overrideOffersOf(admin, dayDetailOf(admin, TEAM, OFF))).toEqual({ options: [], set: false, remove: true });
    expect(overrideOffersOf(admin, dayDetailOf(admin, TEAM, BEFORE))).toEqual({ options: [], set: false, remove: false });
    for (const date of [WORKING, OFF, BEFORE]) {
      expect(overrideOffersOf(member, dayDetailOf(member, TEAM, date)), date).toEqual({
        options: [],
        set: false,
        remove: false,
      });
    }
    expect(overrideOffersOf(null, null)).toEqual({ options: [], set: false, remove: false });
    expect(overrideOffersOf(admin, null)).toEqual({ options: [], set: false, remove: false });
  });

  it('says a landed save, and a landed removal with the type the rotation restores', () => {
    const saved = overrideDoneMessageKey({ code: OVERRIDE_SAVED });
    const removed = overrideDoneMessageKey({ code: OVERRIDE_REMOVED, projectedTypeName: 'Dan' });

    expect(saved).toBe('kalendar.detail.override.saved');
    expect(removed).toBe('kalendar.detail.override.removed');
    expect(t(saved)).toBe('Izmjena je spremljena.');
    expect(t(removed, { type: 'Dan' })).toBe('Izmjena je uklonjena. Prema rotaciji: Dan.');
  });

  it('carries the copy the form and the confirmation render', () => {
    expect(t('kalendar.detail.override.set.heading')).toBe('Promijeni tip smjene');
    expect(t('kalendar.detail.override.set.type')).toBe('Tip smjene');
    expect(t('kalendar.detail.override.set.reason')).toBe('Razlog');
    expect(t('kalendar.detail.override.set.save')).toBe('Spremi izmjenu');
    expect(t('kalendar.detail.override.set.saving')).toBe('Spremanje…');
    expect(t('kalendar.detail.override.remove.action')).toBe('Ukloni izmjenu');
    expect(
      t('kalendar.detail.override.remove.prompt', { team: 'Smjena A', date: 'subota 26.09.2026', type: 'Dan' }),
    ).toBe('Ukloniti izmjenu za Smjena A · subota 26.09.2026? Vraća se Dan prema rotaciji.');
    expect(t('kalendar.detail.override.remove.confirm')).toBe('Ukloni');
    expect(t('kalendar.detail.override.remove.cancel')).toBe('Odustani od uklanjanja');
    expect(t('kalendar.detail.override.remove.removing')).toBe('Uklanjanje…');
  });
});

describe('an override a rotation change left pending (story 3.5c)', () => {
  // Smjena B changes pattern phase from CHANGE, saved after every override
  // below was written (2026-09-12 17:05 UTC) — unless it was confirmed later.
  const CHANGE = '2026-09-20';
  const CHANGED_AT = '2026-09-15T10:00:00+00:00';
  const AFTER = '2026-09-21';
  const EARLIER = '2026-09-19';
  const withChange: FixtureRows = {
    ...PILOT,
    assignments: [
      ...PILOT.assignments,
      assignmentRow(TEAM, 'pilot-rotation', 'pilot-step-2', CHANGE, CHANGE, undefined, { createdAt: CHANGED_AT }),
    ],
  };
  const asAdmin = { viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)], { role: 'admin' })] };

  it('is not applied: the day is the projection, with the block that says it waits', async () => {
    const snapshot = await snapshotOf(withChange, {
      ...asAdmin,
      overrides: [
        calendarOverrideRow('o1', TEAM, AFTER, 'pilot-dan', { reason: 'Vježba.' }),
        calendarOverrideRow('o2', TEAM, EARLIER, 'pilot-dan'),
      ],
    });
    const pure = await snapshotOf(withChange, asAdmin);
    const pending = dayDetailOf(snapshot, TEAM, AFTER);
    const projected = dayDetailOf(pure, TEAM, AFTER);

    // The change anchors CHANGE on the third step, so AFTER is the fourth: Slobodno, an off day.
    expect(projected).not.toBeNull();
    expect(projected?.kind).toBe('off');
    if (projected === null) return;
    expect(pending).toEqual({
      ...projected,
      pending: {
        id: 'o1',
        typeName: 'Dan',
        projectedTypeName: 'Slobodno',
        authorName: VIEWER_NAME,
        reason: 'Vježba.',
      },
    });
    expect(pending?.override).toBeNull();
    // Before the change's date the override was written for the version still in force.
    expect(dayDetailOf(snapshot, TEAM, EARLIER)).toMatchObject({ typeName: 'Dan', pending: null });
    expect(dayDetailOf(snapshot, TEAM, EARLIER)?.override?.id).toBe('o2');
  });

  it('is in force again once confirmed after the change, or written after it', async () => {
    const snapshot = await snapshotOf(withChange, {
      overrides: [
        calendarOverrideRow('o1', TEAM, AFTER, 'pilot-dan', { confirmedAt: '2026-09-16T08:00:00+00:00' }),
        calendarOverrideRow('o2', TEAM, '2026-09-22', 'pilot-dan', { createdAt: '2026-09-16T08:00:00+00:00' }),
      ],
    });

    for (const date of [AFTER, '2026-09-22']) {
      expect(dayDetailOf(snapshot, TEAM, date), date).toMatchObject({ kind: 'working', typeName: 'Dan', pending: null });
      expect(dayDetailOf(snapshot, TEAM, date)?.override, date).not.toBeNull();
    }
  });

  it('is in force again, without a write, once the change is cancelled', async () => {
    const overrides = [calendarOverrideRow('o1', TEAM, AFTER, 'pilot-dan')];
    const changed = await snapshotOf(withChange, { overrides });
    const cancelled = await snapshotOf(PILOT, { overrides });

    expect(dayDetailOf(changed, TEAM, AFTER)?.pending?.id).toBe('o1');
    expect(dayDetailOf(cancelled, TEAM, AFTER)).toMatchObject({ typeName: 'Dan', pending: null });
  });

  it('offers the admin its removal alone, on a working day and on a day with no rotation', async () => {
    const admin = await snapshotOf(withChange, {
      ...asAdmin,
      overrides: [
        calendarOverrideRow('o1', TEAM, AFTER, 'pilot-dan'),
        calendarOverrideRow('o2', TEAM, BEFORE, 'pilot-dan'),
      ],
    });
    const member = await snapshotOf(withChange, { overrides: [calendarOverrideRow('o1', TEAM, AFTER, 'pilot-dan')] });
    const after = dayDetailOf(admin, TEAM, AFTER);
    const before = dayDetailOf(admin, TEAM, BEFORE);

    expect(overrideOffersOf(admin, after)).toEqual({ options: [], set: false, remove: true });
    expect(overrideTypeOptionsOf(admin, after!)).toEqual([]);
    // A pending override is removed with the pending copy, on a working day too.
    expect(overrideRemovalTargetOf(after)).toEqual({ id: 'o1', projectedTypeName: null });
    expect(before).toMatchObject({ kind: 'noRotation', override: null, pending: { id: 'o2', projectedTypeName: null } });
    expect(overrideOffersOf(admin, before)).toEqual({ options: [], set: false, remove: true });
    expect(overrideRemovalTargetOf(before)).toEqual({ id: 'o2', projectedTypeName: null });
    expect(overrideOffersOf(member, dayDetailOf(member, TEAM, AFTER))).toEqual({ options: [], set: false, remove: false });
    expect(overrideRemovalTargetOf(null)).toBeNull();
  });

  it('leaves the month cell unmarked: the projection, no ✎', async () => {
    const snapshot = await snapshotOf(withChange, { overrides: [calendarOverrideRow('o1', TEAM, AFTER, 'pilot-dan')] });
    const pure = await snapshotOf(withChange);
    const search = { mjesec: '2026-09' };
    const cells = calendarMonthOf(snapshot, search, '2026-09-26').rows.flatMap((row) => row.cells);
    const pureCells = calendarMonthOf(pure, search, '2026-09-26').rows.flatMap((row) => row.cells);

    expect(cells).toEqual(pureCells);
    expect(cells.some((cell) => cell.modifiers.length > 0)).toBe(false);
  });

  it('says a pending removal in the pending copy, and carries the block\'s copy', () => {
    const removed = overrideDoneMessageKey({ code: OVERRIDE_REMOVED, projectedTypeName: null });

    expect(removed).toBe('kalendar.detail.override.pending.removed');
    expect(t(removed)).toBe('Izmjena koja je čekala pregled je uklonjena.');
    expect(t('kalendar.detail.override.pending.heading')).toBe('Izmjena čeka pregled');
    expect(t('kalendar.detail.override.pending.type', { type: 'Dan' })).toBe('Upisana izmjena: Dan');
    expect(t('kalendar.detail.override.pending.removePrompt', { team: 'Smjena B', date: 'ponedjeljak 21.09.2026' })).toBe(
      'Ukloniti izmjenu koja čeka pregled za Smjena B · ponedjeljak 21.09.2026? Ona se već ne primjenjuje, pa se prikaz dana ne mijenja.',
    );
  });
});

describe('a roster override is recorded and shown (story 3.6a)', () => {
  const SAVED = { date: '12.09.2026', time: '19:05' };
  const STRANGER = '00000000-0000-4000-8000-0000000000d9';

  it('replaces: the roster follows the domain, and the change is listed with its author, time and reason', async () => {
    const snapshot = await onSmjenaB(false, 'firefighter', [
      calendarRosterOverrideRow('r1', TEAM, WORKING, ANA, VIEWER_MEMBER, { reason: 'Bolovanje.' }),
    ]);
    const detail = dayDetailOf(snapshot, TEAM, WORKING);

    // Cvita is inactive from 2019-12-29; Ana is taken off and Lana put on, with no position.
    expect(detail?.roster).toEqual([
      { id: BORIS, name: 'Boris', fireRank: null, position: null },
      { id: VIEWER_MEMBER, name: VIEWER_NAME, fireRank: null, position: null },
    ]);
    expect(detail?.rosterChanges).toEqual([
      {
        id: 'r1',
        kind: 'replaced',
        outName: 'Ana',
        inName: VIEWER_NAME,
        authorName: VIEWER_NAME,
        savedAt: SAVED,
        reason: 'Bolovanje.',
      },
    ]);
    expect(detail?.rosterPending).toEqual([]);
    // Nothing else of the day moves.
    const pure = dayDetailOf(await onSmjenaB(), TEAM, WORKING);
    expect({ ...detail, roster: [], rosterChanges: [] }).toEqual({ ...pure, roster: [], rosterChanges: [] });
  });

  it('adds alone and removes alone; a member the snapshot does not hold is nobody, listed last', async () => {
    const snapshot = await onSmjenaB(false, 'firefighter', [
      calendarRosterOverrideRow('r1', TEAM, WORKING, null, STRANGER, { author: null }),
      calendarRosterOverrideRow('r2', TEAM, WORKING, BORIS, null),
    ]);
    const detail = dayDetailOf(snapshot, TEAM, WORKING);

    expect(detail?.roster.map((member) => [member.id, member.name])).toEqual([
      [ANA, 'Ana'],
      [STRANGER, null],
    ]);
    expect(detail?.rosterChanges.map(({ kind, outName, inName, authorName }) => ({ kind, outName, inName, authorName }))).toEqual([
      { kind: 'added', outName: null, inName: null, authorName: null },
      { kind: 'removed', outName: 'Boris', inName: null, authorName: VIEWER_NAME },
    ]);
    expect(t('kalendar.detail.rosterChange.added', { name: t('kalendar.detail.override.unknownAuthor') })).toBe(
      'Dodano: Nepoznata osoba',
    );
  });

  it('leaves an inert override unapplied, listed as inert alone (3.6b): a member not on the roster taken off, or an off day', async () => {
    const snapshot = await onSmjenaB(false, 'firefighter', [
      calendarRosterOverrideRow('r1', TEAM, WORKING, VIEWER_MEMBER, null),
      calendarRosterOverrideRow('r2', TEAM, OFF, ANA, VIEWER_MEMBER),
    ]);
    const pure = await onSmjenaB();
    const working = dayDetailOf(snapshot, TEAM, WORKING);
    const off = dayDetailOf(snapshot, TEAM, OFF);

    expect(working?.rosterInert.map((change) => [change.id, change.kind])).toEqual([['r1', 'removed']]);
    expect(off?.rosterInert.map((change) => [change.id, change.kind])).toEqual([['r2', 'replaced']]);
    expect({ ...working, rosterInert: [] }).toEqual(dayDetailOf(pure, TEAM, WORKING));
    expect({ ...off, rosterInert: [] }).toEqual(dayDetailOf(pure, TEAM, OFF));
    const month = calendarMonthOf(snapshot, { mjesec: '2020-01' }, '2020-01-01');
    expect(month).toEqual(calendarMonthOf(pure, { mjesec: '2020-01' }, '2020-01-01'));
  });

  it('leaves an override putting on a member inactive that day inert: the roster, the cell and both day lists unchanged', async () => {
    // Cvita is inactive from 2019-12-29; Smjena A works Dan on 2020-01-01, the viewer on it.
    const alfa = 'pilot-smjena-a';
    const snapshot = await onSmjenaB(false, 'firefighter', [
      calendarRosterOverrideRow('r1', alfa, WORKING, VIEWER_MEMBER, CVITA),
      calendarRosterOverrideRow('r2', alfa, '2020-01-05', null, CVITA),
    ]);
    const pure = await onSmjenaB();

    expect(dayDetailOf(snapshot, alfa, WORKING)?.kind).toBe('working');
    expect(dayDetailOf(snapshot, alfa, WORKING)?.rosterInert.map((change) => change.id)).toEqual(['r1']);
    expect(dayDetailOf(snapshot, alfa, '2020-01-05')?.rosterInert.map((change) => change.id)).toEqual(['r2']);
    expect({ ...dayDetailOf(snapshot, alfa, WORKING), rosterInert: [] }).toEqual(dayDetailOf(pure, alfa, WORKING));
    expect({ ...dayDetailOf(snapshot, alfa, '2020-01-05'), rosterInert: [] }).toEqual(
      dayDetailOf(pure, alfa, '2020-01-05'),
    );
    const search = { mjesec: '2020-01' };
    expect(calendarMonthOf(snapshot, search, WORKING)).toEqual(calendarMonthOf(pure, search, WORKING));
    expect(calendarMonthOf(snapshot, { ...search, osoba: CVITA }, WORKING)).toEqual(
      calendarMonthOf(pure, { ...search, osoba: CVITA }, WORKING),
    );
  });

  it('marks the cell with the one `✎`, and follows the members taken off and put on in their day lists', async () => {
    const snapshot = await onSmjenaB(false, 'firefighter', [
      calendarRosterOverrideRow('r1', TEAM, WORKING, ANA, VIEWER_MEMBER),
    ]);
    const month = calendarMonthOf(snapshot, { mjesec: '2020-01' }, '2020-01-01');
    const column = month.columns.findIndex((team) => team.id === TEAM);

    for (const row of month.rows) {
      for (const [index, cell] of row.cells.entries()) {
        expect(cell.modifiers, `${cell.teamId} on ${row.date}`).toEqual(
          row.date === WORKING && index === column ? ['overridden'] : [],
        );
      }
    }
    // The viewer, on Smjena A, holds Smjena B's shift too on that day, marked, and nothing more all month.
    if (!month.days.ok) throw new Error(month.days.code);
    const viewerDays = month.days.days ?? [];
    expect(viewerDays[0]?.shifts.map((shift) => [shift.teamId, shift.viaOverride, shift.cell.modifiers])).toEqual([
      ['pilot-smjena-a', false, []],
      [TEAM, true, ['overridden']],
    ]);
    expect(viewerDays[0]?.shifts[1]?.cell).toEqual(month.rows[0]?.cells[column]);
    expect(viewerDays.slice(1).every((day) => day.shifts.length === 1)).toBe(true);
    // Ana, in the person filter, lacks that shift.
    const ana = calendarMonthOf(snapshot, { mjesec: '2020-01', osoba: ANA }, '2020-01-01');
    if (ana.person === null || !ana.person.days.ok) throw new Error('no person');
    expect(ana.person.days.days?.[0]?.shifts).toEqual([]);
    expect(ana.person.days.days?.slice(1).every((day) => day.shifts.length === 1)).toBe(true);
  });

  it('with every roster override pending, shows the default roster and lists them apart', async () => {
    // Smjena B changes pattern phase from 2026-09-20, saved after the override was written.
    const withChange: FixtureRows = {
      ...PILOT,
      assignments: [
        ...PILOT.assignments,
        assignmentRow(TEAM, 'pilot-rotation', 'pilot-step-2', '2026-09-20', '2026-09-20', undefined, {
          createdAt: '2026-09-15T10:00:00+00:00',
        }),
      ],
    };
    // The change anchors 09-20 on the third step (Slobodno), so 09-22 is Dan.
    const date = '2026-09-22';
    const snapshot = await onSmjenaB(false, 'firefighter', [calendarRosterOverrideRow('r1', TEAM, date, ANA, VIEWER_MEMBER)], withChange);
    const pure = await onSmjenaB(false, 'firefighter', [], withChange);
    const detail = dayDetailOf(snapshot, TEAM, date);

    expect(detail?.kind).toBe('working');
    expect(detail?.rosterChanges).toEqual([]);
    expect(detail?.rosterPending.map((change) => [change.id, change.kind])).toEqual([['r1', 'replaced']]);
    expect({ ...detail, rosterPending: [] }).toEqual(dayDetailOf(pure, TEAM, date));
    expect(calendarMonthOf(snapshot, { mjesec: '2026-09' }, date)).toEqual(calendarMonthOf(pure, { mjesec: '2026-09' }, date));
  });

  it('carries the copy the change block renders', () => {
    expect(t('kalendar.detail.rosterChange.heading')).toBe('Promjene sastava');
    expect(t('kalendar.detail.rosterChange.added', { name: 'Ana' })).toBe('Dodano: Ana');
    expect(t('kalendar.detail.rosterChange.removed', { name: 'Ana' })).toBe('Uklonjeno: Ana');
    expect(t('kalendar.detail.rosterChange.replaced', { out: 'Ana', in: 'Boris' })).toBe('Zamjena: Ana → Boris');
    expect(t('kalendar.detail.rosterChange.pendingHeading')).toBe('Promjena sastava čeka pregled');
  });
});

describe('an admin adds, removes or replaces someone on a shift (story 3.6b)', () => {
  const DORA = '00000000-0000-4000-8000-0000000000d4';

  /** `onSmjenaB`'s organization, the viewer an admin (or not), with Dora on no team at all. */
  async function asAdmin(
    rosterOverrides: readonly Record<string, unknown>[] = [],
    { role = 'admin', rows = PILOT }: { readonly role?: string; readonly rows?: FixtureRows } = {},
  ): Promise<CalendarSnapshot> {
    return snapshotOf(rows, {
      rosterOverrides,
      viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)], { role })],
      versions: [
        memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED),
        memberMembershipRow(BORIS, TEAM, SEEDED),
        memberMembershipRow(ANA, TEAM, SEEDED, undefined, 'driver'),
        memberMembershipRow(CVITA, TEAM, SEEDED),
      ],
      statuses: [statusRow(BORIS, false, '2020-01-11'), statusRow(CVITA, false, '2019-12-29')],
      members: [
        calendarMemberRow(BORIS, 'Boris'),
        calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
        calendarMemberRow(ANA, 'Ana', 'firefighter'),
        calendarMemberRow(CVITA, 'Cvita'),
        calendarMemberRow(DORA, 'Dora'),
      ],
    });
  }

  const ids = (candidates: readonly { readonly id: string }[]) => candidates.map((one) => one.id);

  it('offers the default roster to take off, and every other active member to put on, in the snapshot order', async () => {
    const snapshot = await asAdmin();
    const offers = rosterOffersOf(snapshot, dayDetailOf(snapshot, TEAM, WORKING));

    expect(offers.set).toBe(true);
    expect(offers.remove).toBe(true);
    // Cvita is inactive on the date: on neither list.
    expect(offers.out).toEqual([
      { id: ANA, name: 'Ana', fireRank: 'firefighter', position: 'driver' },
      { id: BORIS, name: 'Boris', fireRank: null, position: null },
    ]);
    // Lana's own team works Dan that day: offered; whether it overlaps is `rosterOverlapOf`'s to warn of.
    expect(offers.in).toEqual([
      { id: DORA, name: 'Dora', fireRank: null, teamName: null },
      { id: VIEWER_MEMBER, name: VIEWER_NAME, fireRank: null, teamName: 'Smjena A' },
    ]);
  });

  it('leaves out every member a live change on the shift names, applied, pending or inert, on either side', async () => {
    const applied = await asAdmin([calendarRosterOverrideRow('r1', TEAM, WORKING, ANA, VIEWER_MEMBER)]);
    const appliedDetail = dayDetailOf(applied, TEAM, WORKING);
    const offers = rosterOffersOf(applied, appliedDetail);

    expect(appliedDetail?.rosterChanges.map((change) => [change.kind, change.outName, change.inName])).toEqual([
      ['replaced', 'Ana', VIEWER_NAME],
    ]);
    expect(ids(offers.out)).toEqual([BORIS]);
    expect(ids(offers.in)).toEqual([DORA]);

    // Inert: Dora taken off a shift she is not on still names her.
    const inert = await asAdmin([calendarRosterOverrideRow('r2', TEAM, WORKING, DORA, null)]);
    const inertDetail = dayDetailOf(inert, TEAM, WORKING);

    expect(inertDetail?.rosterInert.map((change) => change.id)).toEqual(['r2']);
    expect(ids(rosterOffersOf(inert, inertDetail).in)).toEqual([VIEWER_MEMBER]);
    // Another team's or another date's change names nobody here.
    const elsewhere = await asAdmin([
      calendarRosterOverrideRow('r3', 'pilot-smjena-a', WORKING, VIEWER_MEMBER, BORIS),
      calendarRosterOverrideRow('r4', TEAM, '2020-01-05', ANA, null),
    ]);

    expect(rosterOffersOf(elsewhere, dayDetailOf(elsewhere, TEAM, WORKING))).toEqual(
      rosterOffersOf(await asAdmin(), dayDetailOf(await asAdmin(), TEAM, WORKING)),
    );
  });

  it('leaves out a member named by a change pending review', async () => {
    const withChange: FixtureRows = {
      ...PILOT,
      assignments: [
        ...PILOT.assignments,
        assignmentRow(TEAM, 'pilot-rotation', 'pilot-step-2', '2026-09-20', '2026-09-20', undefined, {
          createdAt: '2026-09-15T10:00:00+00:00',
        }),
      ],
    };
    const date = '2026-09-22';
    const snapshot = await asAdmin([calendarRosterOverrideRow('r1', TEAM, date, ANA, null)], { rows: withChange });
    const detail = dayDetailOf(snapshot, TEAM, date);

    expect(detail?.rosterPending.map((change) => change.id)).toEqual(['r1']);
    expect(ids(rosterOffersOf(snapshot, detail).out)).toEqual([]);
    expect(rosterRemovalTargetOf(detail, 'r1')?.change.id).toBe('r1');
  });

  it('offers no form but every removal on a day that is not working, and nothing to a member-role account', async () => {
    const snapshot = await asAdmin([calendarRosterOverrideRow('r1', TEAM, OFF, ANA, VIEWER_MEMBER)]);
    const off = dayDetailOf(snapshot, TEAM, OFF);
    const before = dayDetailOf(snapshot, TEAM, BEFORE);

    expect(off?.kind).toBe('off');
    expect(rosterOffersOf(snapshot, off)).toEqual({ set: false, remove: true, out: [], in: [] });
    expect(off?.rosterInert.map((change) => change.id)).toEqual(['r1']);
    expect(rosterRemovalTargetOf(off, 'r1')).toEqual({
      change: off?.rosterInert[0],
      teamName: 'Smjena B',
      date: off?.date,
    });
    expect(before?.kind).toBe('noRotation');
    expect(rosterOffersOf(snapshot, before)).toEqual({ set: false, remove: true, out: [], in: [] });

    const member = await asAdmin([calendarRosterOverrideRow('r1', TEAM, OFF, ANA, VIEWER_MEMBER)], {
      role: 'member_role',
    });
    const none = { set: false, remove: false, out: [], in: [] };

    expect(rosterOffersOf(member, dayDetailOf(member, TEAM, WORKING))).toEqual(none);
    expect(rosterOffersOf(member, dayDetailOf(member, TEAM, OFF))).toEqual(none);
    expect(rosterOffersOf(null, null)).toEqual(none);
  });

  it('names the removal target among applied, pending and inert changes, and nothing else', async () => {
    const snapshot = await asAdmin([
      calendarRosterOverrideRow('r1', TEAM, WORKING, ANA, VIEWER_MEMBER, { reason: 'Bolovanje.' }),
      calendarRosterOverrideRow('r2', TEAM, WORKING, DORA, null),
    ]);
    const detail = dayDetailOf(snapshot, TEAM, WORKING);

    expect(rosterRemovalTargetOf(detail, 'r1')).toMatchObject({
      change: { id: 'r1', kind: 'replaced', outName: 'Ana', inName: VIEWER_NAME, reason: 'Bolovanje.' },
      teamName: 'Smjena B',
      date: 'srijeda 01.01.2020',
    });
    expect(rosterRemovalTargetOf(detail, 'r2')?.change.kind).toBe('removed');
    expect(rosterRemovalTargetOf(detail, 'r9')).toBeNull();
    expect(rosterRemovalTargetOf(detail, null)).toBeNull();
    expect(rosterRemovalTargetOf(null, 'r1')).toBeNull();
  });

  it('once removed, the default roster and its candidates are back exactly', async () => {
    const pure = await asAdmin();
    const replaced = await asAdmin([calendarRosterOverrideRow('r1', TEAM, WORKING, ANA, VIEWER_MEMBER)]);

    // Written, the month and the detail move; the rpc then no longer answers the removed row.
    expect(calendarMonthOf(replaced, { mjesec: '2020-01' }, WORKING)).not.toEqual(
      calendarMonthOf(pure, { mjesec: '2020-01' }, WORKING),
    );
    const removed: CalendarSnapshot = {
      ...replaced,
      rosterOverrides: replaced.rosterOverrides.filter((one) => one.id !== 'r1'),
    };

    expect(replaced.rosterOverrides.map((one) => one.id)).toEqual(['r1']);

    expect(dayDetailOf(removed, TEAM, WORKING)).toEqual(dayDetailOf(pure, TEAM, WORKING));
    expect(rosterOffersOf(removed, dayDetailOf(removed, TEAM, WORKING))).toEqual(
      rosterOffersOf(pure, dayDetailOf(pure, TEAM, WORKING)),
    );
    expect(calendarMonthOf(removed, { mjesec: '2020-01' }, WORKING)).toEqual(
      calendarMonthOf(pure, { mjesec: '2020-01' }, WORKING),
    );
  });

  it('on UJ-5 too: a replacement leaves both members off both lists, and its removal gives them back', async () => {
    const team = 'uj5-smjena-b';
    const rows = (overrides: readonly Record<string, unknown>[]) =>
      snapshotOf(UJ5, {
        rosterOverrides: overrides,
        viewers: [viewerRow([membershipRow('uj5-smjena-a', SEEDED)], { role: 'admin' })],
        versions: [
          memberMembershipRow(VIEWER_MEMBER, 'uj5-smjena-a', SEEDED),
          memberMembershipRow(ANA, team, SEEDED),
          memberMembershipRow(BORIS, 'uj5-smjena-c', SEEDED),
        ],
        members: [
          calendarMemberRow(ANA, 'Ana'),
          calendarMemberRow(BORIS, 'Boris'),
          calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
        ],
      });
    const pure = await rows([]);
    const before = rosterOffersOf(pure, dayDetailOf(pure, team, SEEDED));

    expect(dayDetailOf(pure, team, SEEDED)?.kind).toBe('working');
    expect(ids(before.out)).toEqual([ANA]);
    expect(before.in.map((one) => [one.id, one.teamName])).toEqual([
      [BORIS, 'Smjena C'],
      [VIEWER_MEMBER, 'Smjena A'],
    ]);

    const replaced = await rows([calendarRosterOverrideRow('r1', team, SEEDED, ANA, BORIS)]);
    const detail = dayDetailOf(replaced, team, SEEDED);
    const after = rosterOffersOf(replaced, detail);

    expect(detail?.roster.map((member) => member.id)).toEqual([BORIS]);
    expect(ids(after.out)).toEqual([]);
    expect(ids(after.in)).toEqual([VIEWER_MEMBER]);
    const removed: CalendarSnapshot = {
      ...replaced,
      rosterOverrides: replaced.rosterOverrides.filter((one) => one.id !== 'r1'),
    };

    expect(rosterOffersOf(removed, dayDetailOf(removed, team, SEEDED))).toEqual(before);
    expect(dayDetailOf(removed, team, SEEDED)).toEqual(dayDetailOf(pure, team, SEEDED));
    expect(calendarMonthOf(removed, { mjesec: '2020-01' }, SEEDED)).toEqual(
      calendarMonthOf(pure, { mjesec: '2020-01' }, SEEDED),
    );
  });

  it('preflights the members first, then the trimmed reason; what passes is what is sent', () => {
    expect(rosterEntryOf('', '', 'Zamjena')).toEqual({ ok: false, code: ROSTER_REFUSED_MEMBER });
    expect(rosterEntryOf('', '', '  ')).toEqual({ ok: false, code: ROSTER_REFUSED_MEMBER });
    // One member on both sides, as 0026's `_members_distinct` refuses it.
    expect(rosterEntryOf(ANA, ANA, 'Zamjena')).toEqual({ ok: false, code: ROSTER_REFUSED_MEMBER });
    for (const reason of ['', '  ', '\t\n', 'z'.repeat(201), '🚒'.repeat(201)]) {
      expect(rosterEntryOf(ANA, '', reason), JSON.stringify(reason)).toEqual({ ok: false, code: ROSTER_REFUSED_REASON });
    }
    expect(rosterEntryOf(ANA, BORIS, '  Zamjena \n')).toEqual({
      ok: true,
      memberOutId: ANA,
      memberInId: BORIS,
      reason: 'Zamjena',
    });
    expect(rosterEntryOf('', CVITA, 'x')).toEqual({ ok: true, memberOutId: null, memberInId: CVITA, reason: 'x' });
    expect(rosterEntryOf(ANA, '', 'x')).toEqual({ ok: true, memberOutId: ANA, memberInId: null, reason: 'x' });
    expect(rosterEntryOf(ANA, '', '🚒'.repeat(200))).toMatchObject({ ok: true });
  });

  it('reads a candidate line as the roster does: Ime · čin · položaj off, Ime · čin · smjena on', async () => {
    const snapshot = await asAdmin();
    const offers = rosterOffersOf(snapshot, dayDetailOf(snapshot, TEAM, WORKING));
    const words: RosterLineTranslate = { word: (key) => t(key), line: (key, values) => t(key, values) };
    const noTeam = t('kalendar.detail.rosterChange.set.noTeam');
    const out = (rank: boolean, position: boolean) => offers.out.map((one) => outOptionOf(one, rank, position, words).label);
    const put = (rank: boolean) => offers.in.map((one) => inOptionOf(one, rank, noTeam, words).label);

    expect(out(true, true)).toEqual(['Ana · vatrogasac · vozač', 'Boris']);
    expect(out(false, false)).toEqual(['Ana', 'Boris']);
    expect(put(true)).toEqual(['Dora · bez smjene', `${VIEWER_NAME} · Smjena A`]);
    expect(put(false)).toEqual(['Dora · bez smjene', `${VIEWER_NAME} · Smjena A`]);
    expect(outOptionOf(offers.out[0]!, true, true, words).id).toBe(ANA);
    // A member put on with a rank: Ime · čin · smjena, and the rank alone is gated.
    const ranked = { id: DORA, name: 'Dora', fireRank: 'nco', teamName: 'Smjena C' };

    expect(inOptionOf(ranked, true, noTeam, words).label).toBe(
      t('smjene.roster.withRankAndPosition', { name: 'Dora', rank: t('ljudi.rank.nco'), position: 'Smjena C' }),
    );
    expect(inOptionOf(ranked, false, noTeam, words).label).toBe('Dora · Smjena C');
    // The screen's own setting reading, off: neither rank nor position.
    expect(ranksShown({ usesFireRanks: false })).toBe(false);
    expect(positionsShown({ usesFireRanks: false })).toBe(false);
  });

  it('offers those to take off in the default roster order and those to put on in the snapshot order, whatever the input order', async () => {
    const snapshot = await snapshotOf(PILOT, {
      viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)], { role: 'admin' })],
      versions: [
        memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED),
        memberMembershipRow(DORA, TEAM, SEEDED),
        memberMembershipRow(ANA, TEAM, SEEDED),
      ],
      // Out of name order on the wire: Zora, Dora, Ana, Lana.
      members: [
        calendarMemberRow(BORIS, 'Zora'),
        calendarMemberRow(DORA, 'Dora'),
        calendarMemberRow(ANA, 'Ana'),
        calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      ],
    });
    const detail = dayDetailOf(snapshot, TEAM, WORKING);
    const offers = rosterOffersOf(snapshot, detail);

    expect(snapshot.members.map((member) => member.name)).toEqual(['Ana', 'Dora', VIEWER_NAME, 'Zora']);
    expect(ids(offers.out)).toEqual(
      shiftRoster(snapshot.members, TEAM, WORKING).map((entry) => entry.memberId),
    );
    expect(ids(offers.out)).toEqual([ANA, DORA]);
    expect(ids(offers.in)).toEqual(
      snapshot.members.filter((member) => member.id === VIEWER_MEMBER || member.id === BORIS).map((member) => member.id),
    );
    expect(ids(offers.in)).toEqual([VIEWER_MEMBER, BORIS]);
  });

  it('offers no form on an archived team, and still every removal', async () => {
    const archivedRows: FixtureRows = {
      ...PILOT,
      teams: PILOT.teams.map((team) => (team['id'] === TEAM ? teamRow(TEAM, 'Smjena B', { archived: true }) : team)),
    };
    const snapshot = await asAdmin([calendarRosterOverrideRow('r1', TEAM, WORKING, ANA, VIEWER_MEMBER)], {
      rows: archivedRows,
    });
    const detail = dayDetailOf(snapshot, TEAM, WORKING);

    expect(detail?.kind).toBe('working');
    expect(rosterOffersOf(snapshot, detail)).toEqual({ set: false, remove: true, out: [], in: [] });
    expect(rosterRemovalTargetOf(detail, 'r1')?.change.id).toBe('r1');
  });

  it('carries the form, removal and notice copy', () => {
    expect(t('kalendar.detail.rosterChange.set.heading')).toBe('Promjena sastava');
    expect(t('kalendar.detail.rosterChange.set.out')).toBe('Skida se');
    expect(t('kalendar.detail.rosterChange.set.in')).toBe('Dolazi');
    expect(t('kalendar.detail.rosterChange.set.none')).toBe('— nitko —');
    expect(t('kalendar.detail.rosterChange.set.reason')).toBe('Razlog');
    expect(t('kalendar.detail.rosterChange.set.save')).toBe('Spremi promjenu');
    expect(t('kalendar.detail.rosterChange.set.saving')).toBe('Spremanje…');
    expect(t('kalendar.detail.rosterChange.remove.action')).toBe('Ukloni promjenu');
    expect(
      t('kalendar.detail.rosterChange.remove.prompt', {
        change: 'Zamjena: Ana → Boris',
        team: 'Smjena B',
        date: 'srijeda 01.01.2020',
      }),
    ).toBe('Ukloniti promjenu „Zamjena: Ana → Boris” za Smjena B · srijeda 01.01.2020? Sastav se vraća prema rotaciji.');
    expect(t('kalendar.detail.rosterChange.remove.confirm')).toBe('Ukloni');
    expect(t('kalendar.detail.rosterChange.remove.cancel')).toBe('Odustani od uklanjanja');
    expect(t('kalendar.detail.rosterChange.remove.removing')).toBe('Uklanjanje…');
    expect(t('kalendar.detail.rosterChange.inertHeading')).toBe('Promjena sastava se ne primjenjuje');
  });
});

describe('putting someone on a shift they would double-book warns (Epic 4 retro C2)', () => {
  const DORA = '00000000-0000-4000-8000-0000000000d4';
  const EMA = '00000000-0000-4000-8000-0000000000d5';
  const SMJENA_A = 'pilot-smjena-a';
  const SMJENA_C = 'pilot-smjena-c';
  const SMJENA_D = 'pilot-smjena-d';
  /**
   * PILOT plus Rano, 06:00–18:00. The rotation from 2020-01-01, by team A–D:
   * 01-01 Dan, Noć, –, –; 01-02 Noć, –, –, Dan; 01-03 –, –, Dan, Noć;
   * 01-04 –, Dan, Noć, –; then again from 01-05.
   */
  const ROWS: FixtureRows = {
    ...PILOT,
    types: [
      ...PILOT.types,
      typeRow('pilot-rano', 'Rano', '2026-09-25T20:07:49.339741+00:00', { times: ['06:00:00', '18:00:00'] }),
    ],
  };

  /** Lana on Smjena A, Ana on Smjena B, Ema on Smjena D, Dora on no team; the viewer an admin. */
  async function withShifts(
    overrides: readonly Record<string, unknown>[] = [],
    rosterOverrides: readonly Record<string, unknown>[] = [],
  ): Promise<CalendarSnapshot> {
    return snapshotOf(ROWS, {
      overrides,
      rosterOverrides,
      viewers: [viewerRow([membershipRow(SMJENA_A, SEEDED)], { role: 'admin' })],
      versions: [
        memberMembershipRow(VIEWER_MEMBER, SMJENA_A, SEEDED),
        memberMembershipRow(ANA, TEAM, SEEDED),
        memberMembershipRow(EMA, SMJENA_D, SEEDED),
      ],
      members: [
        calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
        calendarMemberRow(ANA, 'Ana'),
        calendarMemberRow(DORA, 'Dora'),
        calendarMemberRow(EMA, 'Ema'),
      ],
    });
  }

  function detailOn(snapshot: CalendarSnapshot, teamId: string, date: string): DayDetail {
    const detail = dayDetailOf(snapshot, teamId, date);

    if (detail === null) throw new Error(`no detail of ${teamId} on ${date}`);

    return detail;
  }

  function overlapOn(snapshot: CalendarSnapshot, teamId: string, date: string, memberId: string) {
    return rosterOverlapOf(snapshot, detailOn(snapshot, teamId, date), memberId);
  }

  it('own team, same window: names the team, the day and its times', async () => {
    // Smjena C is off on 01-01, made a Dan; Lana's own Smjena A works Dan.
    const snapshot = await withShifts([calendarOverrideRow('o1', SMJENA_C, WORKING, 'pilot-dan')]);

    expect(dayDetailOf(snapshot, SMJENA_C, WORKING)?.shiftTypeId).toBe('pilot-dan');
    expect(overlapOn(snapshot, SMJENA_C, WORKING, VIEWER_MEMBER)).toEqual({
      memberName: VIEWER_NAME,
      teamName: 'Smjena A',
      date: WORKING,
      day: 'srijeda 01.01.',
      range: '07:00–19:00',
    });
  });

  it("a night that crosses into the day: Lana's own Noć on D-1 overlaps a 06–18 shift on D, and names D-1", async () => {
    const snapshot = await withShifts([calendarOverrideRow('o1', SMJENA_C, '2020-01-03', 'pilot-rano')]);

    expect(overlapOn(snapshot, SMJENA_C, '2020-01-03', VIEWER_MEMBER)).toEqual({
      memberName: VIEWER_NAME,
      teamName: 'Smjena A',
      date: '2020-01-02',
      day: 'četvrtak 02.01.',
      range: '19:00–07:00',
    });
  });

  it('touching ends do not overlap: own Noć on D-1 ending 07:00, a Dan on D starting 07:00', async () => {
    const snapshot = await withShifts();

    expect(overlapOn(snapshot, SMJENA_C, '2020-01-03', VIEWER_MEMBER)).toBeNull();
  });

  it('their own team works that day in a window that does not overlap: no hint', async () => {
    // Lana's Smjena A works Dan 07–19 on 01-01; Smjena B works Noć 19–07 the same day.
    const snapshot = await withShifts();

    expect(detailOn(snapshot, SMJENA_A, WORKING).kind).toBe('working');
    expect(overlapOn(snapshot, TEAM, WORKING, VIEWER_MEMBER)).toBeNull();
  });

  it('a next-day start: put on a Noć on D, their own 06–18 on D+1, named as D+1', async () => {
    const snapshot = await withShifts([calendarOverrideRow('o1', SMJENA_A, '2020-01-05', 'pilot-rano')]);

    expect(overlapOn(snapshot, SMJENA_C, '2020-01-04', VIEWER_MEMBER)).toEqual({
      memberName: VIEWER_NAME,
      teamName: 'Smjena A',
      date: '2020-01-05',
      day: 'nedjelja 05.01.',
      range: '06:00–18:00',
    });
  });

  it('already put on elsewhere: a roster override puts Dora on Smjena D in the same window', async () => {
    const snapshot = await withShifts(
      [
        calendarOverrideRow('o1', SMJENA_C, WORKING, 'pilot-dan'),
        calendarOverrideRow('o2', SMJENA_D, WORKING, 'pilot-dan'),
      ],
      [calendarRosterOverrideRow('r1', SMJENA_D, WORKING, null, DORA)],
    );

    expect(overlapOn(snapshot, SMJENA_C, WORKING, DORA)).toMatchObject({
      memberName: 'Dora',
      teamName: 'Smjena D',
      date: WORKING,
      range: '07:00–19:00',
    });
  });

  it('two overlaps: the earlier day is named, and on one day their own team before a shift an override puts them on', async () => {
    // Open: Smjena C on 01-03 made a Rano 06–18. Lana's own Noć on 01-02 (D-1)
    // reaches 07:00; an override puts her on Smjena D's Noć 19–07 on 01-03 —
    // no overlap — so make Smjena B's 01-03 a Dan and put her on it: 07–18 overlaps.
    const snapshot = await withShifts(
      [
        calendarOverrideRow('o1', SMJENA_C, '2020-01-03', 'pilot-rano'),
        calendarOverrideRow('o2', TEAM, '2020-01-03', 'pilot-dan'),
      ],
      [calendarRosterOverrideRow('r1', TEAM, '2020-01-03', null, VIEWER_MEMBER)],
    );

    expect(overlapOn(snapshot, SMJENA_C, '2020-01-03', VIEWER_MEMBER)).toMatchObject({
      teamName: 'Smjena A',
      date: '2020-01-02',
    });

    // On one day: Lana's own Dan on 01-01 and an override putting her on Smjena D's Dan.
    const sameDay = await withShifts(
      [
        calendarOverrideRow('o1', SMJENA_C, WORKING, 'pilot-dan'),
        calendarOverrideRow('o2', SMJENA_D, WORKING, 'pilot-dan'),
      ],
      [calendarRosterOverrideRow('r1', SMJENA_D, WORKING, null, VIEWER_MEMBER)],
    );

    expect(overlapOn(sameDay, SMJENA_C, WORKING, VIEWER_MEMBER)).toMatchObject({ teamName: 'Smjena A', date: WORKING });
  });

  it('their own day off, and no shift on either side that reaches the window: no hint', async () => {
    // Smjena A is off on 01-03 and 01-04, and works Dan 07–19 on 01-05.
    const snapshot = await withShifts();

    expect(overlapOn(snapshot, TEAM, '2020-01-04', VIEWER_MEMBER)).toBeNull();
    // Dora is on no team at all.
    expect(overlapOn(snapshot, SMJENA_C, '2020-01-03', DORA)).toBeNull();
  });

  it("the month's edge: D the 1st, Ema's own Noć on the last day of the month before", async () => {
    // Smjena D works Noć on 2020-01-31; Smjena B works Dan on 2020-02-01, made a Rano.
    const touching = await withShifts();

    expect(overlapOn(touching, TEAM, '2020-02-01', EMA)).toBeNull();

    const snapshot = await withShifts([calendarOverrideRow('o1', TEAM, '2020-02-01', 'pilot-rano')]);

    expect(overlapOn(snapshot, TEAM, '2020-02-01', EMA)).toEqual({
      memberName: 'Ema',
      teamName: 'Smjena D',
      date: '2020-01-31',
      day: 'petak 31.01.',
      range: '19:00–07:00',
    });
  });

  it('nobody chosen, a member the snapshot lacks, and the open shift itself: no hint', async () => {
    const snapshot = await withShifts([calendarOverrideRow('o1', SMJENA_C, WORKING, 'pilot-dan')]);

    expect(overlapOn(snapshot, SMJENA_C, WORKING, ROSTER_NOBODY)).toBeNull();
    expect(overlapOn(snapshot, SMJENA_C, WORKING, '00000000-0000-4000-8000-0000000000ff')).toBeNull();
    // Ana's own Smjena B Noć on 01-01 is the shift open: never counted against itself.
    expect(overlapOn(snapshot, TEAM, WORKING, ANA)).toBeNull();
  });

  it('a day that is not working offers no window', async () => {
    const snapshot = await withShifts();
    const off = dayDetailOf(snapshot, TEAM, OFF);

    expect(off).not.toBeNull();
    expect(off?.kind).toBe('off');
    if (off !== null) expect(rosterOverlapOf(snapshot, off, VIEWER_MEMBER)).toBeNull();
  });

  it('skips a neighbouring shift whose team or type the snapshot lacks, and keeps checking the others', async () => {
    const snapshot = await withShifts([calendarOverrideRow('o1', SMJENA_C, WORKING, 'pilot-dan')]);
    const detail = detailOn(snapshot, SMJENA_C, WORKING);
    const noTeamA: CalendarSnapshot = { ...snapshot, teams: snapshot.teams.filter((team) => team.id !== SMJENA_A) };

    // Lana's only overlap is on Smjena A: without it, nothing to name, and nothing thrown.
    expect(rosterOverlapOf(noTeamA, detail, VIEWER_MEMBER)).toBeNull();

    // Dora on Smjena D's Dan too, Smjena A's type unknown: Smjena A is skipped, Smjena D still named.
    const both = await withShifts(
      [
        calendarOverrideRow('o1', SMJENA_C, WORKING, 'pilot-dan'),
        calendarOverrideRow('o2', SMJENA_D, WORKING, 'pilot-rano'),
      ],
      [calendarRosterOverrideRow('r1', SMJENA_D, WORKING, null, VIEWER_MEMBER)],
    );
    const bothDetail = detailOn(both, SMJENA_C, WORKING);
    const noDan: CalendarSnapshot = {
      ...both,
      // Smjena C keeps its own window: only Smjena A's Dan is made unknown.
      types: both.types.map((type) => (type.id === 'pilot-dan' ? { ...type, id: 'pilot-dan-unknown' } : type)),
    };
    const withOpen: DayDetail = { ...bothDetail, shiftTypeId: 'pilot-dan-unknown' };

    expect(rosterOverlapOf(noDan, withOpen, VIEWER_MEMBER)).toMatchObject({ teamName: 'Smjena D', range: '06:00–18:00' });
  });

  it('the guarded form: nothing open or nobody is no hint, and a derivation that throws is logged and no hint', async () => {
    const snapshot = await withShifts([calendarOverrideRow('o1', SMJENA_C, WORKING, 'pilot-dan')]);
    const detail = detailOn(snapshot, SMJENA_C, WORKING);

    expect(rosterOverlapShownOf(snapshot, detail, VIEWER_MEMBER)).toMatchObject({ teamName: 'Smjena A' });
    expect(rosterOverlapShownOf(null, detail, VIEWER_MEMBER)).toBeNull();
    expect(rosterOverlapShownOf(snapshot, null, VIEWER_MEMBER)).toBeNull();
    expect(rosterOverlapShownOf(snapshot, detail, ROSTER_NOBODY)).toBeNull();

    // Two membership versions on one date: `memberScheduleOfMonth` throws.
    const broken: CalendarSnapshot = {
      ...snapshot,
      members: snapshot.members.map((member) =>
        member.id === VIEWER_MEMBER ? { ...member, memberships: [...member.memberships, ...member.memberships] } : member,
      ),
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(() => rosterOverlapOf(broken, detail, VIEWER_MEMBER)).toThrow(RangeError);
      expect(rosterOverlapShownOf(broken, detail, VIEWER_MEMBER)).toBeNull();
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });

  it('moves a date by whole days across months, years and leap days, and refuses what is no date or no whole day', () => {
    expect(isoDateShiftedBy('2020-03-01', -1)).toBe('2020-02-29');
    expect(isoDateShiftedBy('2019-12-31', 1)).toBe('2020-01-01');
    expect(isoDateShiftedBy('2020-01-01', -1)).toBe('2019-12-31');
    expect(isoDateShiftedBy('0050-06-15', 1)).toBe('0050-06-16');
    expect(isoDateShiftedBy('2020-01-01', 0)).toBe('2020-01-01');
    expect(() => isoDateShiftedBy('9999-12-31', 1)).toThrow(RangeError);
    expect(() => isoDateShiftedBy('2020-1-1', 1)).toThrow(RangeError);
    for (const impossible of ['2020-02-31', '2020-13-01', '2019-02-29', '2020-00-10', '2020-01-00', '0000-01-01']) {
      expect(() => isoDateShiftedBy(impossible, 1), impossible).toThrow(RangeError);
    }
    for (const days of [0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => isoDateShiftedBy('2020-01-01', days), String(days)).toThrow(RangeError);
    }
  });

  it('carries the hint copy', () => {
    expect(
      t('kalendar.detail.rosterChange.set.overlap', {
        name: 'Ana',
        team: 'Smjena A',
        day: 'četvrtak 02.01.',
        range: '19:00–07:00',
      }),
    ).toBe('Ana tada već radi: Smjena A, četvrtak 02.01. 19:00–07:00. Ti bi se sati brojali dvaput.');
  });
});
