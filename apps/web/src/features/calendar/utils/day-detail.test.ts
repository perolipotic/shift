import { beforeAll, describe, expect, it, vi } from 'vitest';

import { dayDetailOf, dayDetailShownOf, type DayDetail } from '@/features/calendar/utils/day-detail';
import { calendarMonthOf } from '@/features/calendar/utils/month';
import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { initLocalization, t } from '@/lib/i18n';
import { positionsShown, rosterLineOf, rosterPositionMessageKey } from '@/features/members/utils/position';
import { ranksShown, rosterRankMessageKey } from '@/features/members/utils/rank';
import {
  PILOT,
  SEEDED,
  UJ5,
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
  statusRow,
  teamRow,
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
  } = {},
): Promise<CalendarSnapshot> {
  const organization = calendarOrganizationRow(rows, { viewers, versions, statuses, usesFireRanks });
  const source = calendarTableOf(
    { data: [organization], error: null, count: 1 },
    membersAnswerOf(members),
    overridesAnswerOf(overrides),
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
async function onSmjenaB(usesFireRanks = false, anaRank: string | null = 'firefighter'): Promise<CalendarSnapshot> {
  return snapshotOf(PILOT, {
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
      member.name,
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
      kind: 'working',
      typeName: 'Noć',
      range: '19:00–07:00',
      roster: [
        { id: ANA, name: 'Ana', fireRank: 'firefighter', position: 'driver' },
        { id: BORIS, name: 'Boris', fireRank: null, position: null },
      ],
      override: null,
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
      kind: 'off',
      typeName: null,
      range: null,
      roster: [],
      override: null,
    });
  });

  it('no rotation in effect: noRotation, with no roster', async () => {
    const snapshot = await onSmjenaB();

    expect(dayDetailOf(snapshot, TEAM, BEFORE)).toEqual({
      teamId: TEAM,
      teamName: 'Smjena B',
      date: 'utorak 31.12.2019',
      kind: 'noRotation',
      typeName: null,
      range: null,
      roster: [],
      override: null,
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
