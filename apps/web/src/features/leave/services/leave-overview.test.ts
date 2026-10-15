import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { leaveRecordsOf } from '@/features/leave/services/leave-list';
import {
  DEFAULT_OVERVIEW_SORT,
  GODISNJI_LOADING,
  GODISNJI_OVERVIEW,
  GODISNJI_OWN,
  GODISNJI_UNAVAILABLE,
  LEAVE_OVERVIEW_UNAVAILABLE,
  OVERVIEW_CHIP_STATE,
  OVERVIEW_CHIP_TEAM,
  OVERVIEW_EMPTY_FILTERED,
  OVERVIEW_EMPTY_NONE,
  OVERVIEW_EMPTY_SEARCH,
  OVERVIEW_LOADING,
  OVERVIEW_READY,
  OVERVIEW_SORT_ALLOWANCE,
  OVERVIEW_SORT_BALANCE,
  OVERVIEW_SORT_NAME,
  OVERVIEW_SORT_TEAM,
  OVERVIEW_SORT_USED,
  OVERVIEW_STATES,
  OVERVIEW_STATE_ALL,
  OVERVIEW_STATE_NEGATIVE,
  OVERVIEW_STATE_ON_LEAVE,
  OVERVIEW_STATE_RECORDED,
  OVERVIEW_STATE_UNRECORDED,
  OVERVIEW_UNAVAILABLE,
  chooseLeaveOverviewChip,
  clearedLeaveOverviewFilters,
  godisnjiSearchKeyOf,
  godisnjiSearchOf,
  godisnjiSearchRewriteOf,
  godisnjiViewOf,
  leaveOverviewAriaSortOf,
  leaveOverviewChipChoiceOf,
  leaveOverviewChipRemovalOf,
  leaveOverviewFiltersOf,
  leaveOverviewNarrowed,
  leaveOverviewOf,
  leaveOverviewRowsOf,
  leaveOverviewSearchFor,
  leaveOverviewSortArrowOf,
  leaveOverviewStateMessageKey,
  leaveOverviewStateValueMessageKey,
  nextLeaveOverviewSort,
  sortedLeaveOverviewRows,
  type LeaveOverview,
  type LeaveOverviewFilters,
  type LeaveOverviewSources,
} from '@/features/leave/services/leave-overview';
import {
  LEAVE_READY,
  LEAVE_UNSCHEDULED,
  memberLeaveBaseOf,
  type LeaveOrganizationSource,
} from '@/features/leave/services/leave-section';
import { ALL_TEAMS, NO_TEAM, type MemberListRow } from '@/features/members/services/list';
import { initLocalization, t } from '@/lib/i18n';
import { nextIsoDate } from '@/lib/i18n/format';
import {
  PILOT,
  SEEDED,
  UJ5,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  statusRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 7.15's overview, executed (AD-15): the matrix's rows, the role gate,
 * the URL, the sort, the search and the summary — and the rule itself: every
 * row equals the member page's `memberLeaveBaseOf` for that member, and
 * Pravo − Iskorišteno = Preostalo on every row.
 */

/** 2026-09-26 in Zagreb: the fixtures' today. */
const NOW = new Date('2026-09-26T10:00:00Z');

const ANA = '00000000-0000-4000-8000-0000000000d1';
const DORA = '00000000-0000-4000-8000-0000000000d2';
const EMA = '00000000-0000-4000-8000-0000000000d3';
const CEDO = '00000000-0000-4000-8000-0000000000d4';

function teamOf(rows: FixtureRows, index: number): string {
  const id = rows.teams[index]?.['id'];

  if (typeof id !== 'string') throw new Error('the fixture has no such team');

  return id;
}

/**
 * The organization as an admin sees it: the viewer (an admin) on the first
 * team, Ana on the second, Čedo on the first, Dora on no team, Ema on the
 * third and inactive since August.
 */
async function snapshotOf(rows: FixtureRows, role: unknown = 'admin'): Promise<CalendarSnapshot> {
  const [a, b, c] = [teamOf(rows, 0), teamOf(rows, 1), teamOf(rows, 2)];
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow([membershipRow(a, SEEDED)], { role })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, a, SEEDED),
            memberMembershipRow(ANA, b, SEEDED),
            memberMembershipRow(CEDO, a, SEEDED),
            memberMembershipRow(EMA, c, SEEDED),
          ],
          statuses: [statusRow(EMA, false, '2026-08-01')],
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
    ]),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

function member(fields: Partial<MemberListRow> & { readonly id: string; readonly name: string }): MemberListRow {
  return {
    organizationId: 'organization',
    username: fields.id,
    email: null,
    role: 'member_role',
    leaveAllowanceDays: 20,
    fireRank: null,
    authUserId: `account-${fields.id}`,
    statusVersions: [],
    teamVersions: [],
    timeZone: 'Europe/Zagreb',
    ...fields,
  };
}

const LIST: readonly MemberListRow[] = [
  member({ id: VIEWER_MEMBER, name: VIEWER_NAME, role: 'admin', leaveAllowanceDays: 22 }),
  member({ id: ANA, name: 'Ana Anić', leaveAllowanceDays: 25 }),
  member({ id: CEDO, name: 'Čedo Čačić', leaveAllowanceDays: 20 }),
  member({ id: DORA, name: 'Dora Dorić', leaveAllowanceDays: 18 }),
  member({ id: EMA, name: 'Ema Emić', statusVersions: [{ active: false, effectiveFrom: '2026-08-01' }] }),
];

const ORGANIZATION: LeaveOrganizationSource = {
  data: { ok: true, snapshot: { leaveYearStartMonth: 1, leaveYearStartDay: 1 } },
  isPending: false,
  isError: false,
  fetchStatus: 'idle',
};

/** A row as `leave_overview_records()` answers it: the range canonical, its upper bound exclusive. */
function rpcRow(id: string, memberId: string, from: string, toExclusive: string) {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}

/** Records in and outside the leave year: last year's edge, this year's, next year's. */
const ROWS = [
  rpcRow('r1', VIEWER_MEMBER, '2026-09-10', '2026-09-15'),
  rpcRow('r2', ANA, '2025-12-29', '2026-01-03'),
  rpcRow('r3', ANA, '2026-06-01', '2026-06-08'),
  rpcRow('r4', ANA, '2027-02-01', '2027-02-05'),
  rpcRow('r5', DORA, '2026-05-04', '2026-05-06'),
  rpcRow('r6', EMA, '2026-03-02', '2026-03-06'),
];

function sourcesOf(snapshot: CalendarSnapshot, overrides: Partial<LeaveOverviewSources> = {}): LeaveOverviewSources {
  return {
    members: { members: LIST, refusal: null, loading: false, paused: false },
    calendar: { snapshot, loading: false },
    organization: ORGANIZATION,
    records: { rows: ROWS, loading: false },
    ...overrides,
  };
}

const NO_FILTERS: LeaveOverviewFilters = {
  search: '',
  sort: DEFAULT_OVERVIEW_SORT,
  team: ALL_TEAMS,
  state: OVERVIEW_STATE_ALL,
};

function readyOf(overview: LeaveOverview): Extract<LeaveOverview, { kind: typeof OVERVIEW_READY }> {
  if (overview.kind !== OVERVIEW_READY) throw new Error(`not ready: ${overview.kind}`);

  return overview;
}

let pilot: CalendarSnapshot;
let uj5: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf(PILOT);
  uj5 = await snapshotOf(UJ5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('which Godišnji the viewer gets', () => {
  it('gives an admin the overview, a member their own tiles, and fails closed otherwise', async () => {
    expect(godisnjiViewOf({ snapshot: pilot, refusal: null, loading: false })).toBe(GODISNJI_OVERVIEW);
    expect(godisnjiViewOf({ snapshot: await snapshotOf(PILOT, 'member_role'), refusal: null, loading: false })).toBe(
      GODISNJI_OWN,
    );
    expect(godisnjiViewOf({ snapshot: null, refusal: null, loading: true })).toBe(GODISNJI_LOADING);
    expect(godisnjiViewOf({ snapshot: null, refusal: 'CALENDAR_UNAVAILABLE', loading: false } as never)).toBe(
      GODISNJI_UNAVAILABLE,
    );
    // A role this build does not know: never the overview by default.
    const unknown = { ...pilot, viewer: { ...pilot.viewer, role: 'supervisor' } } as unknown as CalendarSnapshot;
    expect(godisnjiViewOf({ snapshot: unknown, refusal: null, loading: false })).toBe(GODISNJI_UNAVAILABLE);
  });
});

describe('the rows', () => {
  it.each([
    ['pilot', () => pilot],
    ['UJ-5', () => uj5],
  ])('lists the %s members active today, each equal to the member page, with Pravo − Iskorišteno = Preostalo', (_name, snapshotFor) => {
    const snapshot = snapshotFor();
    const overview = readyOf(leaveOverviewOf(sourcesOf(snapshot), NO_FILTERS, NOW));

    // Ema is inactive today: no row.
    expect(overview.rows.map((row) => row.memberId)).toEqual([ANA, CEDO, DORA, VIEWER_MEMBER]);

    for (const row of overview.rows) {
      const own = leaveRecordsOf(
        ROWS.filter((candidate) => candidate.member_id === row.memberId),
        row.memberId,
      );
      const base = memberLeaveBaseOf(
        {
          members: sourcesOf(snapshot).members,
          calendar: { snapshot, loading: false },
          organization: ORGANIZATION,
          records: { records: own, loading: false, refreshing: false },
        },
        row.memberId,
        NOW,
      );

      if (row.memberId === DORA) {
        expect(base.kind).toBe(LEAVE_UNSCHEDULED);
        expect(row.figures).toBeNull();
        expect(row.allowanceDays).toBe(18);
        continue;
      }

      if (base.kind !== LEAVE_READY) throw new Error(`not ready: ${base.kind}`);
      expect(row.allowanceDays, row.name).toBe(base.balance.allowanceDays);
      expect(row.figures, row.name).toEqual({ usedDays: base.balance.usedDays, balanceDays: base.balance.balanceDays });
      expect(row.allowanceDays - (row.figures?.usedDays ?? NaN), row.name).toBe(row.figures?.balanceDays);
    }
  });

  it("names each row's team today from the snapshot, and none for a member on no team", () => {
    const overview = readyOf(leaveOverviewOf(sourcesOf(pilot), NO_FILTERS, NOW));
    const teams = Object.fromEntries(overview.rows.map((row) => [row.memberId, row.team?.name ?? null]));

    expect(teams).toEqual({ [VIEWER_MEMBER]: 'Smjena A', [ANA]: 'Smjena B', [CEDO]: 'Smjena A', [DORA]: null });
  });

  it("counts only this leave year's days: Ana's New Year edge and next year's record leave the year's balance", () => {
    const overview = readyOf(leaveOverviewOf(sourcesOf(pilot), NO_FILTERS, NOW));
    const ana = overview.rows.find((row) => row.memberId === ANA);
    const alone = readyOf(
      leaveOverviewOf(
        sourcesOf(pilot, { records: { rows: ROWS.filter((row) => row.id === 'r3'), loading: false } }),
        NO_FILTERS,
        NOW,
      ),
    ).rows.find((row) => row.memberId === ANA);

    // Smjena B works Dan, Noć, Slobodno, Slobodno from Noć on 01.01.2020.
    // 01.06.–07.06.2026 is Dan, Noć, -, -, Dan, Noć, -: four days.
    expect(alone?.figures).toEqual({ usedDays: 4, balanceDays: 21 });
    // 29.12.2025–02.01.2026 charges only 01.01. (Noć; 02.01. is free) to this
    // year, and 2027's record charges nothing: one day more.
    expect(ana?.figures).toEqual({ usedDays: 5, balanceDays: 20 });
  });

  it('holds the rule as a property: random records, every row equal to memberLeaveBaseOf', () => {
    let seed = 7;
    const next = (limit: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;

      return seed % limit;
    };
    const iso = (day: number) => {
      let date = '2025-10-01';

      for (let step = 0; step < day; step += 1) date = nextIsoDate(date) ?? date;

      return date;
    };

    for (let round = 0; round < 25; round += 1) {
      const rows: ReturnType<typeof rpcRow>[] = [];

      for (const id of [VIEWER_MEMBER, ANA, CEDO, DORA]) {
        let day = next(30);

        for (let index = 0; index < next(5); index += 1) {
          const length = 1 + next(10);
          rows.push(rpcRow(`${id}-${String(round)}-${String(index)}`, id, iso(day), iso(day + length)));
          day += length + 1 + next(60);
        }
      }

      const sources = sourcesOf(pilot, { records: { rows, loading: false } });
      const overview = readyOf(leaveOverviewOf(sources, NO_FILTERS, NOW));

      for (const row of overview.rows) {
        const own = leaveRecordsOf(
          rows.filter((candidate) => candidate.member_id === row.memberId),
          row.memberId,
        );
        const base = memberLeaveBaseOf(
          { ...sources, records: { records: own, loading: false, refreshing: false } },
          row.memberId,
          NOW,
        );
        const figures =
          base.kind === LEAVE_READY ? { usedDays: base.balance.usedDays, balanceDays: base.balance.balanceDays } : null;

        expect(row.figures, `round ${String(round)}: ${row.name}`).toEqual(figures);
        if (row.figures !== null) {
          expect(row.allowanceDays - row.figures.usedDays).toBe(row.figures.balanceDays);
        }
      }
    }
  });
});

describe('the states', () => {
  it("keeps the row of a member whose team today the snapshot does not hold, naming no team", () => {
    const missing = {
      ...pilot,
      teams: pilot.teams.filter((team) => team.name !== 'Smjena B'),
    } as CalendarSnapshot;
    const overview = readyOf(leaveOverviewOf(sourcesOf(missing), NO_FILTERS, NOW));
    const ana = overview.rows.find((row) => row.memberId === ANA);

    expect(ana?.team).toBeNull();
    expect(ana?.figures).not.toBeNull();
  });

  it('logs every unavailable overview under its stable code', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    leaveOverviewRowsOf(sourcesOf(pilot, { records: { rows: null, loading: false } }), NOW);
    leaveOverviewRowsOf(
      sourcesOf(pilot, { records: { rows: [...ROWS, { id: 'bad', member_id: ANA, during: 'x' }], loading: false } }),
      NOW,
    );

    expect(logged.mock.calls.map((call) => call[0])).toEqual([LEAVE_OVERVIEW_UNAVAILABLE, LEAVE_OVERVIEW_UNAVAILABLE]);
    expect(LEAVE_OVERVIEW_UNAVAILABLE).toBe('LEAVE_OVERVIEW_UNAVAILABLE');
  });

  it('is loading while any read is pending, and unavailable first when any fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(leaveOverviewRowsOf(sourcesOf(pilot, { records: { rows: null, loading: true } }), NOW).kind).toBe(
      OVERVIEW_LOADING,
    );
    expect(leaveOverviewRowsOf(sourcesOf(pilot, { calendar: { snapshot: null, loading: true } }), NOW).kind).toBe(
      OVERVIEW_LOADING,
    );
    expect(
      leaveOverviewRowsOf(
        sourcesOf(pilot, {
          calendar: { snapshot: null, loading: true },
          records: { rows: null, loading: false },
        }),
        NOW,
      ).kind,
    ).toBe(OVERVIEW_UNAVAILABLE);

    for (const failed of [
      { records: { rows: null, loading: false } },
      { calendar: { snapshot: null, loading: false } },
      { members: { members: null, refusal: 'MEMBERS_UNAVAILABLE', loading: false, paused: false } },
      { members: { members: LIST, refusal: null, loading: false, paused: true } },
      { organization: { ...ORGANIZATION, isError: true } },
      { organization: { ...ORGANIZATION, fetchStatus: 'paused' } },
    ] as const) {
      expect(leaveOverviewRowsOf(sourcesOf(pilot, failed), NOW).kind, JSON.stringify(Object.keys(failed))).toBe(
        OVERVIEW_UNAVAILABLE,
      );
    }
  });

  it("is unavailable for a record of a member the list does not hold, or one that does not parse", () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const rows of [
      [...ROWS, rpcRow('stranger', '00000000-0000-4000-8000-0000000000ff', '2026-09-01', '2026-09-02')],
      [...ROWS, { id: 'bad', member_id: ANA, during: 'not a range' }],
    ]) {
      expect(leaveOverviewRowsOf(sourcesOf(pilot, { records: { rows, loading: false } }), NOW).kind).toBe(
        OVERVIEW_UNAVAILABLE,
      );
    }
  });

  it('answers no rows and shows the summary at zero when nobody is active today', () => {
    const overview = readyOf(
      leaveOverviewOf(
        sourcesOf(pilot, {
          members: {
            members: LIST.filter((row) => row.id === EMA),
            refusal: null,
            loading: false,
            paused: false,
          },
          records: { rows: [], loading: false },
        }),
        NO_FILTERS,
        NOW,
      ),
    );

    expect(overview.rows).toEqual([]);
    expect(overview.empty).toBe(OVERVIEW_EMPTY_NONE);
    expect(overview.summary).toEqual({ shown: 0, records: 0, usedDays: 0, allowanceDays: 0 });
  });
});

describe('the search and the summary', () => {
  it('searches names folded as Ljudi folds, and says when nobody matches', () => {
    const cedo = readyOf(leaveOverviewOf(sourcesOf(pilot), { ...NO_FILTERS, search: 'cedo' }, NOW));
    const none = readyOf(leaveOverviewOf(sourcesOf(pilot), { ...NO_FILTERS, search: 'zzz' }, NOW));

    expect(cedo.rows.map((row) => row.name)).toEqual(['Čedo Čačić']);
    expect(none.rows).toEqual([]);
    expect(none.empty).toBe(OVERVIEW_EMPTY_SEARCH);
    expect(none.summary).toEqual({ shown: 0, records: 0, usedDays: 0, allowanceDays: 0 });
  });

  it('treats a box holding only whitespace as no search, as the trimmed URL does', () => {
    const all = readyOf(leaveOverviewOf(sourcesOf(pilot), NO_FILTERS, NOW));
    const blank = readyOf(leaveOverviewOf(sourcesOf(pilot), { ...NO_FILTERS, search: '   ' }, NOW));

    expect(blank.rows).toEqual(all.rows);
    expect(blank.empty).toBeNull();
    expect(leaveOverviewFiltersOf({ trazi: '   ' }).search).toBe('');
  });

  it('sums the shown rows, leaving an unscheduled member out of the totals but in the count', () => {
    const overview = readyOf(leaveOverviewOf(sourcesOf(pilot), NO_FILTERS, NOW));
    const scheduled = overview.rows.filter((row) => row.figures !== null);

    expect(overview.summary).toEqual({
      shown: 4,
      // Ana's record of February 2027 is the one ending today or later.
      records: 1,
      usedDays: scheduled.reduce((sum, row) => sum + (row.figures?.usedDays ?? 0), 0),
      allowanceDays: 22 + 25 + 20,
    });
  });

  it('words the summary in all three forms, the records stated at zero (E884)', () => {
    const line = (count: number, records: number) =>
      t('godisnji.overview.summary', { count, records, used: 8, allowance: 340 });

    expect(line(17, 3)).toBe('Prikazano: 17 osoba · upisana 3 godišnja · iskorišteno ukupno 8 dana od 340');
    expect(line(1, 1)).toBe('Prikazano: 1 osoba · upisan 1 godišnji · iskorišteno ukupno 8 dana od 340');
    expect(line(2, 0)).toBe('Prikazano: 2 osobe · upisano 0 godišnjih · iskorišteno ukupno 8 dana od 340');
  });
});

describe('the Smjena and Stanje chips (E884)', () => {
  /** Today (26.09.) Čedo is on leave until 30.09., and Lana over her allowance: a balance below zero. */
  const CHIP_ROWS = [
    ...ROWS,
    rpcRow('r7', CEDO, '2026-09-25', '2026-10-01'),
    rpcRow('r8', VIEWER_MEMBER, '2026-01-05', '2026-03-02'),
  ];
  const overviewOf = (filters: Partial<LeaveOverviewFilters>) =>
    readyOf(leaveOverviewOf(sourcesOf(pilot, { records: { rows: CHIP_ROWS, loading: false } }), { ...NO_FILTERS, ...filters }, NOW));
  const ids = (overview: ReturnType<typeof overviewOf>) => overview.rows.map((row) => row.memberId);
  const teamA = teamOf(PILOT, 0);
  const teamB = teamOf(PILOT, 1);

  it('derives each row\'s state from its records at today', () => {
    const rows = Object.fromEntries(overviewOf({}).rows.map((row) => [row.memberId, row]));

    expect([rows[CEDO]?.onLeaveToday, rows[CEDO]?.upcomingRecords]).toEqual([true, 1]);
    expect([rows[ANA]?.onLeaveToday, rows[ANA]?.upcomingRecords]).toEqual([false, 1]);
    expect([rows[DORA]?.onLeaveToday, rows[DORA]?.upcomingRecords]).toEqual([false, 0]);
    expect(rows[VIEWER_MEMBER]?.figures?.balanceDays).toBeLessThan(0);
  });

  it('narrows by state, counting each option under the search and the team', () => {
    expect(ids(overviewOf({ state: OVERVIEW_STATE_ON_LEAVE }))).toEqual([CEDO]);
    expect(ids(overviewOf({ state: OVERVIEW_STATE_RECORDED }))).toEqual([ANA, CEDO]);
    expect(ids(overviewOf({ state: OVERVIEW_STATE_UNRECORDED }))).toEqual([DORA, VIEWER_MEMBER]);
    expect(ids(overviewOf({ state: OVERVIEW_STATE_NEGATIVE }))).toEqual([VIEWER_MEMBER]);
    expect(overviewOf({}).states).toEqual({
      [OVERVIEW_STATE_ALL]: 4,
      [OVERVIEW_STATE_ON_LEAVE]: 1,
      [OVERVIEW_STATE_RECORDED]: 2,
      [OVERVIEW_STATE_UNRECORDED]: 2,
      [OVERVIEW_STATE_NEGATIVE]: 1,
    });
    // Under Smjena A (the viewer and Čedo): the counts follow.
    expect(overviewOf({ team: teamA }).states[OVERVIEW_STATE_RECORDED]).toBe(1);
  });

  it('narrows by team today, offering every team, each team by name and no team, counted under the other chip', () => {
    const all = overviewOf({});

    expect(all.teams.map((option) => [option.value, option.team, option.count])).toEqual([
      [ALL_TEAMS, null, 4],
      [teamA, 'Smjena A', 2],
      [teamB, 'Smjena B', 1],
      [NO_TEAM, null, 1],
    ]);
    expect(ids(overviewOf({ team: teamA }))).toEqual([CEDO, VIEWER_MEMBER]);
    expect(ids(overviewOf({ team: NO_TEAM }))).toEqual([DORA]);
    // An option never vanishes under the other chip: it reads 0.
    expect(overviewOf({ state: OVERVIEW_STATE_ON_LEAVE }).teams.map((option) => option.count)).toEqual([1, 1, 0, 0]);
    // A team that is no longer an option narrows nothing, and says it applied every team.
    const stale = overviewOf({ team: 'gone-team' });

    expect(stale.team).toBe(ALL_TEAMS);
    expect(stale.rows).toHaveLength(4);
  });

  it('says the chips left nobody, apart from a search that matched nobody, and sums only what they leave', () => {
    const filtered = overviewOf({ team: teamB, state: OVERVIEW_STATE_ON_LEAVE });

    expect(filtered.rows).toEqual([]);
    expect(filtered.empty).toBe(OVERVIEW_EMPTY_FILTERED);
    expect(overviewOf({ search: 'zzz' }).empty).toBe(OVERVIEW_EMPTY_SEARCH);
    expect(overviewOf({ team: teamA }).summary).toMatchObject({ shown: 2, records: 1 });
  });

  it('reads and writes ?smjena= and ?stanje=, falling back on a bad value and leaving the defaults out', () => {
    expect(leaveOverviewFiltersOf({ smjena: teamA, stanje: 'u-minusu' })).toMatchObject({
      team: teamA,
      state: OVERVIEW_STATE_NEGATIVE,
    });
    expect(leaveOverviewFiltersOf({ smjena: '', stanje: 'xyz' })).toMatchObject({ team: ALL_TEAMS, state: OVERVIEW_STATE_ALL });
    expect(leaveOverviewSearchFor({ ...NO_FILTERS, team: NO_TEAM, state: OVERVIEW_STATE_ON_LEAVE })).toEqual({
      smjena: NO_TEAM,
      stanje: 'na-godisnjem',
    });
    expect(leaveOverviewSearchFor(NO_FILTERS)).toEqual({});
    expect(godisnjiSearchRewriteOf({ stanje: 'sve' })).toEqual({});
    expect(godisnjiSearchRewriteOf({ stanje: 'upisano', smjena: teamA })).toBeNull();
    expect(godisnjiSearchKeyOf({ trazi: 'a|b' })).not.toBe(godisnjiSearchKeyOf({ trazi: 'a', smjena: 'b' }));
  });

  it('picks, removes and clears the chips: a team only from the options, the sort kept by a clear', () => {
    const { teams } = overviewOf({});

    expect(chooseLeaveOverviewChip(OVERVIEW_CHIP_TEAM)).toBe(OVERVIEW_CHIP_TEAM);
    expect(chooseLeaveOverviewChip('level')).toBeNull();
    expect(leaveOverviewChipChoiceOf(NO_FILTERS, OVERVIEW_CHIP_TEAM, teamB, teams).team).toBe(teamB);
    expect(leaveOverviewChipChoiceOf(NO_FILTERS, OVERVIEW_CHIP_TEAM, 'stale', teams).team).toBe(ALL_TEAMS);
    expect(leaveOverviewChipChoiceOf(NO_FILTERS, OVERVIEW_CHIP_STATE, 'upisano', teams).state).toBe(OVERVIEW_STATE_RECORDED);
    expect(leaveOverviewChipChoiceOf(NO_FILTERS, OVERVIEW_CHIP_STATE, 'xyz', teams).state).toBe(OVERVIEW_STATE_ALL);

    const set: LeaveOverviewFilters = {
      search: 'ana',
      team: teamA,
      state: OVERVIEW_STATE_NEGATIVE,
      sort: { key: OVERVIEW_SORT_BALANCE, direction: 'down' },
    };

    expect(leaveOverviewChipRemovalOf(set, OVERVIEW_CHIP_TEAM)).toEqual({ ...set, team: ALL_TEAMS });
    expect(leaveOverviewChipRemovalOf(set, OVERVIEW_CHIP_STATE)).toEqual({ ...set, state: OVERVIEW_STATE_ALL });
    expect(clearedLeaveOverviewFilters(set)).toEqual({ ...NO_FILTERS, sort: set.sort });
    expect(leaveOverviewNarrowed(set)).toBe(true);
    expect(leaveOverviewNarrowed(NO_FILTERS)).toBe(false);
  });

  it('words every state for its picker and its chip', () => {
    expect(OVERVIEW_STATES.map((state) => t(leaveOverviewStateMessageKey(state)))).toEqual([
      'Sva stanja',
      'Na godišnjem danas',
      'S upisanim godišnjim',
      'Bez upisanog godišnjeg',
      'Preostalo u minusu',
    ]);
    expect(t('godisnji.overview.stateChip', { value: t(leaveOverviewStateValueMessageKey(OVERVIEW_STATE_ALL)) })).toBe(
      'Stanje: sve',
    );
  });
});

describe('the sort and the URL', () => {
  it('orders by every column, with a row that has no value last in either direction', () => {
    const order = (key: (typeof DEFAULT_OVERVIEW_SORT)['key'], direction: 'up' | 'down') =>
      readyOf(leaveOverviewOf(sourcesOf(pilot), { ...NO_FILTERS, sort: { key, direction } }, NOW)).rows.map(
        (row) => row.memberId,
      );

    expect(order(OVERVIEW_SORT_NAME, 'up')).toEqual([ANA, CEDO, DORA, VIEWER_MEMBER]);
    expect(order(OVERVIEW_SORT_NAME, 'down')).toEqual([VIEWER_MEMBER, DORA, CEDO, ANA]);
    expect(order(OVERVIEW_SORT_TEAM, 'up')).toEqual([CEDO, VIEWER_MEMBER, ANA, DORA]);
    expect(order(OVERVIEW_SORT_TEAM, 'down')).toEqual([ANA, CEDO, VIEWER_MEMBER, DORA]);
    expect(order(OVERVIEW_SORT_ALLOWANCE, 'down')).toEqual([ANA, VIEWER_MEMBER, CEDO, DORA]);
    expect(order(OVERVIEW_SORT_USED, 'up').at(-1)).toBe(DORA);
    expect(order(OVERVIEW_SORT_USED, 'down').at(-1)).toBe(DORA);
    expect(order(OVERVIEW_SORT_BALANCE, 'up').at(-1)).toBe(DORA);
    // Pravo ascending: 18, 20, 22, 25 — Dora's allowance is a value, so she sorts by it.
    expect(order(OVERVIEW_SORT_ALLOWANCE, 'up')).toEqual([DORA, CEDO, VIEWER_MEMBER, ANA]);
    // Preostalo descending: Ana and Čedo tie at 20 and fall back to the name, then Lana's 19, Dora last.
    expect(order(OVERVIEW_SORT_BALANCE, 'down')).toEqual([ANA, CEDO, VIEWER_MEMBER, DORA]);
  });

  it('breaks a tie by name and then by id, in either direction', () => {
    const row = (memberId: string, name: string) => ({
      memberId,
      name,
      team: null,
      allowanceDays: 20,
      figures: { usedDays: 2, balanceDays: 18 },
      onLeaveToday: false,
      upcomingRecords: 0,
    });
    const rows = [row('b', 'Ana Anić'), row('c', 'Bruno Bić'), row('a', 'Ana Anić')];

    for (const direction of ['up', 'down'] as const) {
      expect(
        sortedLeaveOverviewRows(rows, { key: OVERVIEW_SORT_BALANCE, direction }).map((entry) => entry.memberId),
        direction,
      ).toEqual(['a', 'b', 'c']);
    }
  });

  it('reads ?trazi= and ?sort=, falling back to the defaults on a bad value', () => {
    expect(leaveOverviewFiltersOf({})).toEqual(NO_FILTERS);
    expect(leaveOverviewFiltersOf({ sort: 'xyz' }).sort).toEqual({ key: 'ime', direction: 'up' });
    expect(leaveOverviewFiltersOf({ sort: '-preostalo', trazi: '  ana ' })).toEqual({
      ...NO_FILTERS,
      search: 'ana',
      sort: { key: 'preostalo', direction: 'down' },
    });
    expect(leaveOverviewFiltersOf({ trazi: 123, sort: 4 })).toEqual({ ...NO_FILTERS, search: '123' });
    expect(godisnjiSearchOf({ sort: 'ime', trazi: '' })).toEqual({});
    expect(godisnjiSearchOf({ sort: '-ime', other: 'x' })).toEqual({ sort: '-ime' });
    expect(leaveOverviewSearchFor({ ...NO_FILTERS, search: 'ana', sort: { key: 'iskoristeno', direction: 'up' } })).toEqual({
      trazi: 'ana',
      sort: 'iskoristeno',
    });
  });

  it('rewrites a URL holding anything it does not show, and leaves a clean one alone', () => {
    expect(godisnjiSearchRewriteOf({ sort: 'xyz' })).toEqual({});
    expect(godisnjiSearchRewriteOf({ sort: 'ime' })).toEqual({});
    expect(godisnjiSearchRewriteOf({ trazi: '  ' })).toEqual({});
    expect(godisnjiSearchRewriteOf({ trazi: 'ana', other: 1 })).toEqual({ trazi: 'ana' });
    expect(godisnjiSearchRewriteOf({ trazi: 123 })).toEqual({ trazi: '123' });
    expect(godisnjiSearchRewriteOf({})).toBeNull();
    expect(godisnjiSearchRewriteOf({ sort: '-preostalo', trazi: 'ana' })).toBeNull();
    expect(godisnjiSearchRewriteOf({ trazi: '123' })).toBeNull();
  });

  it('starts a new column ascending and flips the sorted one, and reports it as ARIA and an arrow agree', () => {
    const up = nextLeaveOverviewSort(DEFAULT_OVERVIEW_SORT, OVERVIEW_SORT_BALANCE);
    const down = nextLeaveOverviewSort(up, OVERVIEW_SORT_BALANCE);

    expect(up).toEqual({ key: OVERVIEW_SORT_BALANCE, direction: 'up' });
    expect(down).toEqual({ key: OVERVIEW_SORT_BALANCE, direction: 'down' });
    expect(leaveOverviewAriaSortOf(up, OVERVIEW_SORT_BALANCE)).toBe('ascending');
    expect(leaveOverviewSortArrowOf(up, OVERVIEW_SORT_BALANCE)).toBe('up');
    expect(leaveOverviewAriaSortOf(down, OVERVIEW_SORT_BALANCE)).toBe('descending');
    expect(leaveOverviewSortArrowOf(down, OVERVIEW_SORT_BALANCE)).toBe('down');
    expect(leaveOverviewAriaSortOf(down, OVERVIEW_SORT_NAME)).toBe('none');
    expect(leaveOverviewSortArrowOf(down, OVERVIEW_SORT_NAME)).toBeNull();
  });
});
