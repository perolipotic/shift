import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  QueryClient,
  QueryObserver,
  environmentManager,
  onlineManager,
} from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_COLUMNS,
  CALENDAR_COUNT,
  CALENDAR_FETCH_PAUSED,
  CALENDAR_KEY,
  CALENDAR_READ_STALE_MS,
  CALENDAR_READ_TABLE,
  CALENDAR_UNAVAILABLE,
  CALENDAR_VIEWER_COLUMN,
  CALENDAR_VIEWER_OPERATOR,
  calendarMessageKey,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  readCalendar,
  type CalendarAnswer,
  type CalendarSnapshot,
  type CalendarTable,
} from '@/calendar/snapshot';
import {
  OTHER_ORGANIZATION,
  PILOT,
  SEEDED,
  UJ5,
  VIEWER_AUTH_USER,
  VIEWER_MEMBER,
  assignmentRow,
  calendarOrganizationRow,
  calendarTableOf,
  membershipRow,
  stepRow,
  teamRow,
  typeRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/rotation/rotation.fixture';

/**
 * Story 3.1's read, executed rather than read (AD-15): the one select, the
 * parsing, the tenant tripwire, the query options and the surface state, over
 * both fixtures, with a real `QueryObserver`. Story 3.2a's viewer row: the
 * filter, the session and every bad-embed row of its matrix.
 */

/** The organization as the calendar's read embeds it: the viewer's member row alone. */
function answerOf(rows: FixtureRows, viewers: readonly Record<string, unknown>[] | null = null): CalendarAnswer {
  return { data: [calendarOrganizationRow(rows, { viewers })], error: null, count: 1 };
}

function tableOf(answer: CalendarAnswer): CalendarTable & { readonly seen: unknown[][] } {
  return calendarTableOf(answer);
}

const session = viewerSession();

async function snapshotOf(rows: FixtureRows): Promise<CalendarSnapshot> {
  const outcome = await readCalendar(tableOf(answerOf(rows)), session);

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

const REFUSED = { ok: false, code: CALENDAR_UNAVAILABLE } as const;

describe('the read', () => {
  it.each([
    { fixture: 'pilot', rows: PILOT, teams: 4, types: 3, steps: 4 },
    { fixture: 'UJ-5', rows: UJ5, teams: 3, types: 4, steps: 5 },
  ])('$fixture: reads the organization and everything the month draws from in one exact-count select', async ({ rows, teams, types, steps }) => {
    const table = tableOf(answerOf(rows));
    const outcome = await readCalendar(table, session);

    expect(CALENDAR_READ_TABLE).toBe('organizations');
    expect(table.seen).toEqual([
      ['select', CALENDAR_COLUMNS, CALENDAR_COUNT],
      ['filter', 'members.auth_user_id', 'eq', VIEWER_AUTH_USER],
    ]);
    expect([CALENDAR_VIEWER_COLUMN, CALENDAR_VIEWER_OPERATOR]).toEqual(['members.auth_user_id', 'eq']);
    expect(CALENDAR_COUNT).toEqual({ count: 'exact' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.timeZone).toBe('Europe/Zagreb');
    expect(outcome.snapshot.teams).toHaveLength(teams);
    expect(outcome.snapshot.types).toHaveLength(types);
    expect(outcome.snapshot.steps).toHaveLength(steps);
    expect(outcome.snapshot.assignments).toHaveLength(teams);
    expect(outcome.snapshot.viewer).toEqual({
      memberId: VIEWER_MEMBER,
      role: 'member_role',
      memberships: [{ teamId: (rows.teams[0] as { id: string }).id, effectiveFrom: SEEDED }],
    });
  });

  it('selects what a member may read and nothing more', () => {
    expect(CALENDAR_COLUMNS).toContain('teams(organization_id,id,name,archived)');
    expect(CALENDAR_COLUMNS).toContain('shift_types(');
    expect(CALENDAR_COLUMNS).toContain('shift_type_versions(');
    expect(CALENDAR_COLUMNS).toContain('rotation_steps(');
    expect(CALENDAR_COLUMNS).toContain('rotation_assignments(');
    // The viewer's own member row: its tenant, id, role and team history, and
    // nothing that names, ranks or positions a person.
    expect(CALENDAR_COLUMNS).toContain(
      'members(organization_id,id,role,team_membership_versions(organization_id,team_id,effective_from))',
    );
    const member = /members\(([^()]*)/.exec(CALENDAR_COLUMNS)?.[1] ?? '';

    expect(member).toBe('organization_id,id,role,team_membership_versions');
    expect(/team_membership_versions\(([^)]*)\)/.exec(CALENDAR_COLUMNS)?.[1]).toBe('organization_id,team_id,effective_from');
    expect(CALENDAR_COLUMNS).not.toMatch(/auth_user_id|email/);
    expect(CALENDAR_COLUMNS).not.toContain('created_by');
    const assignments = /rotation_assignments\(([^)]*)\)/.exec(CALENDAR_COLUMNS)?.[1] ?? '';

    expect(assignments).toBe('organization_id,team_id,pattern_id,offset_step_id,anchor_date,effective_from');
    // No fire rank, no position, nothing projected or stored as a schedule.
    expect(CALENDAR_COLUMNS).not.toMatch(/rank|position_|cycle|projected|schedule|override/);
  });

  it('answers an organization with nothing yet as an answer', async () => {
    const snapshot = await snapshotOf({ teams: [], types: [], steps: [], assignments: [] });

    expect(snapshot.teams).toEqual([]);
    expect(snapshot.assignments).toEqual([]);
  });

  it('orders the types by creation, whatever order they arrive in', async () => {
    const snapshot = await snapshotOf({ ...PILOT, types: [...PILOT.types].reverse() });

    expect(snapshot.types.map((type) => type.id)).toEqual(['pilot-dan', 'pilot-noc', 'pilot-slobodno']);
  });

  it('refuses a rejected call, an error, and anything but exactly one organization', async () => {
    quiet();
    const rejecting: CalendarTable = { select: () => ({ filter: () => Promise.reject(new Error('down')) }) };

    expect(await readCalendar(rejecting, session)).toEqual(REFUSED);
    expect(await readCalendar(tableOf({ data: null, error: { code: '500' }, count: null }), session)).toEqual(REFUSED);
    expect(await readCalendar(tableOf({ ...answerOf(PILOT), count: 2 }), session)).toEqual(REFUSED);
    expect(await readCalendar(tableOf({ data: [], error: null, count: 0 }), session)).toEqual(REFUSED);
    expect(await readCalendar(tableOf({ data: [{ id: 'x' }], error: null, count: 1 }), session)).toEqual(REFUSED);
    vi.restoreAllMocks();
  });

  it('refuses a row of another tenant, in every embed', async () => {
    quiet();
    for (const rows of [
      { ...PILOT, teams: [...PILOT.teams, teamRow('stranger', 'Smjena X', { organization: OTHER_ORGANIZATION })] },
      {
        ...PILOT,
        types: [...PILOT.types, typeRow('stranger', 'X', '2026-09-25T20:07:49+00:00', { organization: OTHER_ORGANIZATION })],
      },
      { ...PILOT, steps: [...PILOT.steps, stepRow('stranger', 'pilot-rotation', 9, 'pilot-dan', OTHER_ORGANIZATION)] },
      {
        ...PILOT,
        assignments: [
          ...PILOT.assignments,
          assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-0', '2020-01-01', '2026-10-01', OTHER_ORGANIZATION),
        ],
      },
    ]) {
      expect(await readCalendar(tableOf(answerOf(rows)), session)).toEqual(REFUSED);
    }
    vi.restoreAllMocks();
  });

  it('refuses what the keys guarantee, so no projection ever throws on it', async () => {
    quiet();
    for (const rows of [
      // A step naming a type the answer lacks.
      { ...PILOT, steps: [...PILOT.steps, stepRow('orphan', 'pilot-rotation', 9, 'missing')] },
      // Two steps of one pattern at one position.
      { ...PILOT, steps: [...PILOT.steps, stepRow('twin', 'pilot-rotation', 0, 'pilot-dan')] },
      // An assignment naming a team the answer lacks.
      { ...PILOT, assignments: [...PILOT.assignments, assignmentRow('missing', 'pilot-rotation', 'pilot-step-0', '2020-01-01', '2020-01-01')] },
      // An offset step outside its own pattern.
      { ...PILOT, assignments: [assignmentRow('pilot-smjena-a', 'other', 'pilot-step-0', '2020-01-01', '2020-01-01')] },
      // Two versions of one team on one date.
      { ...PILOT, assignments: [...PILOT.assignments, PILOT.assignments[0]!] },
      // A malformed date.
      { ...PILOT, assignments: [assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-0', '2020-01-01', '2020-02-30')] },
    ]) {
      expect(await readCalendar(tableOf(answerOf(rows)), session)).toEqual(REFUSED);
    }
    vi.restoreAllMocks();
  });

  it('reads the viewer\'s history in date order, a left team and archived teams included', async () => {
    const moved = await readCalendar(
      tableOf(
        answerOf(
          { ...PILOT, teams: [...PILOT.teams, teamRow('pilot-smjena-x', 'Smjena X', { archived: true })] },
          [
            viewerRow(
              [
                membershipRow(null, '2026-09-10'),
                membershipRow('pilot-smjena-x', '2020-01-01'),
                membershipRow('pilot-smjena-b', '2024-05-01'),
              ],
              { role: 'admin' },
            ),
          ],
        ),
      ),
      session,
    );

    expect(moved.ok && moved.snapshot.viewer).toEqual({
      memberId: VIEWER_MEMBER,
      role: 'admin',
      memberships: [
        { teamId: 'pilot-smjena-x', effectiveFrom: '2020-01-01' },
        { teamId: 'pilot-smjena-b', effectiveFrom: '2024-05-01' },
        { teamId: null, effectiveFrom: '2026-09-10' },
      ],
    });
    const none = await readCalendar(tableOf(answerOf(PILOT, [viewerRow([])])), session);

    expect(none.ok && none.snapshot.viewer.memberships).toEqual([]);
  });

  it('refuses no session, and a session that cannot be read, without reading', async () => {
    quiet();
    const table = tableOf(answerOf(PILOT));

    expect(await readCalendar(table, () => Promise.resolve(null))).toEqual(REFUSED);
    expect(await readCalendar(table, () => Promise.reject(new Error('storage')))).toEqual(REFUSED);
    expect(table.seen).toEqual([]);
    vi.restoreAllMocks();
  });

  it('refuses every bad viewer embed', async () => {
    quiet();
    const own = membershipRow('pilot-smjena-a', SEEDED);

    for (const viewers of [
      // No member row, and two.
      [],
      [viewerRow([own]), viewerRow([own], { id: 'someone-else' })],
      // Another tenant's row, or a version of another tenant.
      [viewerRow([own], { organization: OTHER_ORGANIZATION })],
      [viewerRow([membershipRow('pilot-smjena-a', SEEDED, OTHER_ORGANIZATION)])],
      // A team the answer lacks.
      [viewerRow([membershipRow('unknown-team', SEEDED)])],
      // Two versions on one date.
      [viewerRow([own, membershipRow('pilot-smjena-b', SEEDED)])],
      // A role this build does not know, or none.
      [viewerRow([own], { role: 'supervisor' })],
      [viewerRow([own], { role: null })],
      // A malformed date, a malformed team, no id, no versions list.
      [viewerRow([membershipRow('pilot-smjena-a', '2020-02-30')])],
      [viewerRow([{ ...own, team_id: 7 }])],
      [{ ...viewerRow([own]), id: '' }],
      [{ ...viewerRow([own]), team_membership_versions: null }],
    ]) {
      expect(await readCalendar(tableOf(answerOf(PILOT, viewers)), session), JSON.stringify(viewers)).toEqual(REFUSED);
    }
    const { members: _members, ...noEmbed } = calendarOrganizationRow(PILOT);

    expect(await readCalendar(tableOf({ data: [noEmbed], error: null, count: 1 }), session)).toEqual(REFUSED);
    vi.restoreAllMocks();
  });

  it('names the read failure through its own key', () => {
    expect(calendarMessageKey(CALENDAR_UNAVAILABLE)).toBe('kalendar.error.unavailable');
  });
});

describe('the surface state, driven through the one query definition', () => {
  const wasServer = environmentManager.isServer();
  const good = answerOf(PILOT);
  const miscounted: CalendarAnswer = { ...good, count: 2 };
  let client: QueryClient;
  let unsubscribes: (() => void)[];
  let pilot: CalendarSnapshot;

  beforeAll(async () => {
    environmentManager.setIsServer(() => false);
    pilot = await snapshotOf(PILOT);
  });

  afterAll(() => {
    environmentManager.setIsServer(() => wasServer);
  });

  beforeEach(() => {
    client = new QueryClient();
    unsubscribes = [];
    quiet();
  });

  afterEach(() => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    client.clear();
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  function answeringInTurn(...answers: CalendarAnswer[]): CalendarTable & { readonly calls: () => number } {
    let calls = 0;

    return {
      calls: () => calls,
      select() {
        return {
          filter() {
            const answer = answers[Math.min(calls, answers.length - 1)];

            calls += 1;

            return Promise.resolve(answer as CalendarAnswer);
          },
        };
      },
    };
  }

  function observe(table: () => CalendarTable) {
    const observer = new QueryObserver(client, { ...calendarQueryOptions(table, session), retryDelay: 0 });

    unsubscribes.push(observer.subscribe(() => undefined));

    return observer;
  }

  async function settled(observer: ReturnType<typeof observe>) {
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().fetchStatus).toBe('idle');
    });

    return observer.getCurrentResult();
  }

  it('keeps one key with no month in it, and reads again whenever it is opened', () => {
    const options = calendarQueryOptions(() => answeringInTurn(good));

    expect(options.queryKey).toEqual(CALENDAR_KEY);
    expect(CALENDAR_KEY).toEqual(['calendar']);
    expect(options.staleTime).toBe(CALENDAR_READ_STALE_MS);
    expect(CALENDAR_READ_STALE_MS).toBe(0);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.retry).toBe(1);
  });

  it('pulses while the first read is in flight and says nothing', () => {
    const observer = observe(() => answeringInTurn(good));

    expect(calendarSurfaceStateOf(observer.getCurrentResult())).toEqual({
      snapshot: null,
      refusal: null,
      loading: true,
    });
  });

  it('draws a first answer', async () => {
    const state = calendarSurfaceStateOf(await settled(observe(() => answeringInTurn(good))));

    expect(state).toEqual({ snapshot: pilot, refusal: null, loading: false });
  });

  it('shows the cached answer at once when opened again, then reads it again', async () => {
    const table = answeringInTurn(good);

    await settled(observe(() => table));
    const reopened = observe(() => table);

    expect(calendarSurfaceStateOf(reopened.getCurrentResult()).snapshot).toEqual(pilot);
    await settled(reopened);
    expect(table.calls()).toBe(2);
  });

  it('retries an unavailable read once, then shows the message and no grid', async () => {
    const table = answeringInTurn(miscounted);
    const result = await settled(observe(() => table));

    expect(table.calls()).toBe(2);
    expect(calendarSurfaceStateOf(result)).toEqual({ snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false });
  });

  it('draws no grid over a failed refetch either', async () => {
    const table = answeringInTurn(good, miscounted);
    const observer = observe(() => table);

    await settled(observer);
    await client.invalidateQueries({ queryKey: CALENDAR_KEY });

    expect(calendarSurfaceStateOf(await settled(observer))).toEqual({
      snapshot: null,
      refusal: CALENDAR_UNAVAILABLE,
      loading: false,
    });
  });

  it('rejects when the table cannot even be built', async () => {
    const result = await settled(
      observe(() => {
        throw new Error('SUPABASE_ENVIRONMENT_MISSING');
      }),
    );

    expect(calendarSurfaceStateOf(result).refusal).toBe(CALENDAR_UNAVAILABLE);
  });

  it('counts offline as unavailable rather than pulsing', () => {
    onlineManager.setOnline(false);
    const result = observe(() => answeringInTurn(good)).getCurrentResult();

    expect(result.fetchStatus).toBe(CALENDAR_FETCH_PAUSED);
    expect(calendarSurfaceStateOf(result)).toEqual({ snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false });
  });

  it('counts offline as unavailable over a cached answer too, and draws no stale grid', async () => {
    const table = answeringInTurn(good);
    const observer = observe(() => table);

    await settled(observer);
    onlineManager.setOnline(false);
    void client.invalidateQueries({ queryKey: CALENDAR_KEY });
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().fetchStatus).toBe(CALENDAR_FETCH_PAUSED);
    });
    const result = observer.getCurrentResult();

    expect(result.data).toEqual(pilot);
    expect(calendarSurfaceStateOf(result)).toEqual({ snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false });
  });

  it('recovers: after a failed read, a good answer brings the grid back', async () => {
    const table = answeringInTurn(miscounted, miscounted, good);
    const observer = observe(() => table);

    expect(calendarSurfaceStateOf(await settled(observer)).refusal).toBe(CALENDAR_UNAVAILABLE);
    await observer.refetch();

    expect(calendarSurfaceStateOf(await settled(observer))).toEqual({ snapshot: pilot, refusal: null, loading: false });
  });

  it('never pulses a skeleton beside a message', () => {
    for (const isError of [true, false]) {
      for (const isPending of [true, false]) {
        for (const fetchStatus of ['idle', 'fetching', CALENDAR_FETCH_PAUSED]) {
          for (const data of [undefined, pilot]) {
            const state = calendarSurfaceStateOf({ isPending, isError, fetchStatus, data });

            expect(state.loading && state.refusal !== null).toBe(false);
          }
        }
      }
    }
  });
});

describe('the calendar only reads, and projects nothing of its own', () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const route = join(directory, '..', 'routes', 'kalendar.tsx');
  const files = [
    ...readdirSync(directory)
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.test.ts'))
      .map((name) => join(directory, name)),
    route,
  ];
  const stripped = (file: string) =>
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('sweeps the files it means to', () => {
    expect(files.map((file) => file.slice(directory.length - 1))).toEqual(
      expect.arrayContaining(['/month.ts', '/snapshot.ts', '/modifiers.ts', '/grid-keys.ts']),
    );
  });

  it('derives no modifier from snapshot data (story 3.2b): only the vocabulary names one', () => {
    // Every cell carries `modifiers: []` until 3.5, 3.6 and Epics 4–5 derive
    // one; no file but the vocabulary names a modifier, and `month.ts` sets
    // the empty list and nothing else.
    for (const file of files.filter((one) => !one.endsWith('modifiers.ts'))) {
      expect(stripped(file), file).not.toMatch(/'(conflict|overridden|leave|uncovered)'|MODIFIER_[A-Z]+\b/);
    }
    const month = stripped(join(directory, 'month.ts'));

    expect(month, 'a cell given modifiers other than the empty list').not.toMatch(
      /(?<!readonly )\bmodifiers:(?! NO_MODIFIERS\b)/,
    );
    expect(month.match(/\bmodifiers: NO_MODIFIERS\b/g)).toHaveLength(2);
    expect(month).toMatch(/const NO_MODIFIERS: readonly CalendarModifier\[\] = \[\];/);
  });

  it.each(files)('%s has no modulo, no write and no read of rank or position', (file) => {
    const text = stripped(file);

    expect(text, 'a `%` projection').not.toMatch(/%/);
    expect(text).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(text).not.toMatch(/fire_?rank|fireRank|\brank\b|team_position|teamPosition/i);
    expect(text, 'a second query or key').not.toMatch(/queryKey:\s*\[(?!\s*\])/);
  });
});
