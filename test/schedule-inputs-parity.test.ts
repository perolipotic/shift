import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { atWorkShiftsOf, type ScheduleInputs } from '../packages/domain/src/index.js';

import { FIXTURES, connect, localApiEndpoint, noDatabase, organizationId } from './database';

/**
 * AD-19's READ PARITY (story 16.2; NFR-28, Q27), the database suite.
 *
 * For every member of both fixtures (AD-15) who can sign in — active today,
 * with an account — over the calendar feed's window (D2: today − 31 through
 * today + 182), with a scene that adds a loan, a roster override, a
 * shift-type override, a full-day and a half-day leave record:
 *
 *   - the BROWSER'S PATH: the calendar snapshot (`readCalendar`, the select
 *     and its four rpcs) and the member's own live leave (`my_leave_records`),
 *     read over the real PostgREST with the member's own token, the way
 *     supabase-js sends them, through `apps/web`'s one adapter
 *     (`scheduleInputsOfCalendar`);
 *   - the SERVER'S: `private.member_schedule_inputs(member, from, to)`, as the
 *     owner (no role may execute it), with no adapter;
 *
 * are deep-equal after ordering every list, stamps included, and R12 over
 * each (`atWorkShiftsOf`) is equal.
 *
 * COMMITTED SCENE: PostgREST reads only what is committed, so the scene is
 * written as the OWNER before any request (each row naming the fixture
 * admin as `created_by`), and `afterAll` deletes it with the outbox rows its
 * notification triggers wrote, by subject. Its exceptions are 150–166 days
 * ahead, inside the window and clear of the seed, with rows wholly before,
 * across and after the window's edges. The seed gives nobody a team, so the
 * member's one team is the loan: the override and the leave fall inside it,
 * and R12 over the server's assembly is seen applying them.
 *
 * WRITTEN UNRUN (story 16.2): this file opens a database, so it runs only in
 * CI's `test` job, on that job's fresh stack, one root file after another
 * (STRICT DATABASE RULE).
 */

/**
 * The browser's modules, loaded by path at run time: `snapshot.ts` reaches
 * `@/lib/supabase/client`, which reads Vite's `import.meta.env`, a type the
 * root project does not carry. So the three functions are typed here by what
 * this file hands them, and the modules themselves are `apps/web`'s, checked
 * by its own project.
 */
const webRoot = new URL('../apps/web/src/features/', import.meta.url).pathname;

interface CalendarAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: { readonly code?: string; readonly message?: string } | null;
  readonly count: number | null;
}

interface BrowserModules {
  readCalendar(
    table: unknown,
    rpc: unknown,
    session: () => Promise<{ readonly user: { readonly id: string } }>,
  ): Promise<{ readonly ok: true; readonly snapshot: { readonly viewer: { readonly memberId: string } } } | { readonly ok: false; readonly code: string }>;
  readMyLeaveRows(client: unknown): Promise<{ readonly ok: true; readonly rows: readonly unknown[] } | { readonly ok: false; readonly code: string }>;
  leaveRecordsOf(rows: readonly unknown[], memberId: string): readonly unknown[] | null;
  scheduleInputsOfCalendar(snapshot: unknown, ownLeave: readonly unknown[], window: { from: string; to: string }): ScheduleInputs;
}

async function browserModules(): Promise<BrowserModules> {
  const load = (path: string): Promise<Record<string, unknown>> => import(/* @vite-ignore */ `${webRoot}${path}`);
  const [snapshot, adapter, leave] = await Promise.all([
    load('calendar/services/snapshot.ts'),
    load('calendar/services/schedule-inputs.ts'),
    load('leave/services/leave-list.ts'),
  ]);
  return { ...snapshot, ...adapter, ...leave } as unknown as BrowserModules;
}

const FIXTURE_PASSWORD = 'local-fixture-password';
const apiEndpoint = localApiEndpoint();
const noApi = noDatabase || apiEndpoint === undefined;

interface SceneIds {
  readonly loans: string[];
  readonly rosterOverrides: string[];
  readonly overrides: string[];
  readonly leave: string[];
}

const scene: SceneIds = { loans: [], rosterOverrides: [], overrides: [], leave: [] };

interface Viewer {
  readonly memberId: string;
  readonly email: string;
}

/** One fixture's scene rows: those the window holds, and those it must not. */
interface SceneRows {
  readonly member: string;
  readonly loan: string;
  readonly lentTo: string;
  readonly rosterOverride: string;
  readonly override: string;
  readonly fullDay: string;
  readonly halfDay: string;
  /** A full-day record from before the window into it: overlapping, so carried. */
  readonly straddling: string;
  /** A loan and a full-day record wholly before the window and wholly after it: never carried. */
  readonly outside: readonly string[];
}

interface FixtureScene {
  readonly rows: SceneRows;
  readonly fixture: string;
  readonly organization: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly viewers: readonly Viewer[];
  /** Where the scene's exceptions fall inside its loan, for R12 to be seen applying them. */
  readonly dates: { readonly override: string; readonly fullDay: readonly string[]; readonly halfDay: string; readonly workingType: string };
}

const scenes: FixtureScene[] = [];

async function one<T>(client: Client, sql: string, values: readonly unknown[]): Promise<T> {
  const { rows } = await client.query(sql, [...values]);
  const row = rows[0] as T | undefined;
  if (row === undefined) throw new Error(`no row: ${sql}`);
  return row;
}

/** The organization's today plus `days`, as `YYYY-MM-DD`. */
async function dayOf(client: Client, organization: string, days: number): Promise<string> {
  const row = await one<{ day: string }>(client, `select (public.organization_today($1) + $2::int)::text as day`, [organization, days]);
  return row.day;
}

/** Build one fixture's scene as the owner, and list the members who can sign in. */
async function buildScene(client: Client, fixture: (typeof FIXTURES)[number]): Promise<FixtureScene> {
  const organization = await organizationId(client, fixture.slug);
  const account = async (username: string) =>
    one<{ id: string; authUserId: string }>(
      client,
      `select m.id, m.auth_user_id as "authUserId"
         from members m join auth.users u on u.id = m.auth_user_id
        where m.organization_id = $1 and u.email = $2`,
      [organization, `${username}@${fixture.slug}.shift.invalid`],
    );
  const admin = await account(fixture.admin);
  const member = await account(fixture.member);
  const bystander = await account(fixture.bystander);

  const at = (days: number) => dayOf(client, organization, days);
  const loanFrom = await at(150);
  // Through the override and both leave dates, so R12 has shifts there to apply them to: the seed
  // holds no team membership, and the loan is the member's one team.
  const loanTo = await at(166);
  const rosterDate = await at(155);
  const overrideDate = await at(156);
  const leaveFrom = await at(160);
  const leaveTo = await at(161);
  const halfDate = await at(165);

  const teamOn = async (memberId: string, date: string): Promise<string | null> => {
    const { rows } = await client.query<{ team_id: string | null }>(
      `select team_id from team_membership_versions
        where member_id = $1 and effective_from <= $2::date
        order by effective_from desc limit 1`,
      [memberId, date],
    );
    return rows[0]?.team_id ?? null;
  };
  const teams = (
    await client.query<{ id: string }>(`select id from teams where organization_id = $1 and not archived order by id`, [organization])
  ).rows.map((row) => row.id);
  const home = (await teamOn(member.id, loanFrom)) ?? teams[0] ?? null;
  const lentTo = teams.find((team) => team !== home);
  if (home === null || lentTo === undefined) throw new Error(`${fixture.slug} has fewer than two active teams`);
  const working = await one<{ id: string }>(
    client,
    `select id from shift_types where organization_id = $1 and is_working and not archived order by created_at limit 1`,
    [organization],
  );

  const inserted = async (sql: string, values: readonly unknown[]): Promise<string> =>
    (await one<{ id: string }>(client, sql, values)).id;

  const loanOf = (from: string, to: string) =>
    inserted(
      `insert into team_loans (organization_id, member_id, team_id, during, reason, created_by)
       values ($1, $2, $3, daterange($4::date, $5::date, '[]'), 'Paritet.', $6) returning id`,
      [organization, member.id, lentTo, from, to, admin.authUserId],
    );
  const fullDayOf = (from: string, to: string) =>
    inserted(
      `insert into leave_records (organization_id, member_id, during, created_by)
       values ($1, $2, daterange($3::date, $4::date, '[]'), $5) returning id`,
      [organization, member.id, from, to, admin.authUserId],
    );

  const loan = await loanOf(loanFrom, loanTo);
  const outside = [
    await loanOf(await at(-62), await at(-60)),
    await loanOf(await at(200), await at(201)),
    await fullDayOf(await at(-45), await at(-44)),
    await fullDayOf(await at(190), await at(191)),
  ];
  const straddling = await fullDayOf(await at(-33), await at(-30));
  scene.loans.push(loan, outside[0]!, outside[1]!);
  const rosterOverride = await inserted(
      `insert into roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason, created_by)
       values ($1, $2, $3::date, null, $4, 'Paritet.', $5) returning id`,
      [organization, home, rosterDate, bystander.id, admin.authUserId],
  );
  // Written before every rotation version was saved: PENDING review on both sides, so R12 must not apply it.
  const pendingRosterOverride = await inserted(
    `insert into roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason, created_by, created_at)
     values ($1, $2, $3::date, null, $4, 'Paritet.', $5, timestamptz '2001-01-01 00:00:00.123456+00') returning id`,
    [organization, home, await at(157), bystander.id, admin.authUserId],
  );
  scene.rosterOverrides.push(rosterOverride, pendingRosterOverride);
  const override = await inserted(
      // Confirmed (0022's check: `confirmed_by` with `confirmed_at`), so `writtenAt` is `confirmed_at`, not `created_at`, on both sides.
      `insert into shift_type_overrides (organization_id, team_id, date, shift_type_id, reason, created_by, confirmed_by, confirmed_at)
       values ($1, $2, $3::date, $4, 'Paritet.', $5, $5, now() + interval '1.234567 second') returning id`,
      [organization, lentTo, overrideDate, working.id, admin.authUserId],
  );
  scene.overrides.push(override);
  const fullDay = await fullDayOf(leaveFrom, leaveTo);
  const halfDay = await inserted(
    `insert into leave_records (organization_id, member_id, during, half, created_by)
     values ($1, $2, daterange($3::date, $3::date, '[]'), 'FIRST', $4) returning id`,
    [organization, member.id, halfDate, admin.authUserId],
  );
  scene.leave.push(fullDay, halfDay, straddling, outside[2]!, outside[3]!);

  const viewers = (
    await client.query<Viewer>(
      `select m.id as "memberId", u.email
         from members m join auth.users u on u.id = m.auth_user_id
        where m.organization_id = $1
          and public.member_active_on(m.id, public.organization_today($1))
          and (u.banned_until is null or u.banned_until < now())
        order by m.id`,
      [organization],
    )
  ).rows;

  return {
    rows: { member: member.id, loan, lentTo, rosterOverride, override, fullDay, halfDay, straddling, outside },
    dates: { override: overrideDate, fullDay: [leaveFrom, leaveTo], halfDay: halfDate, workingType: working.id },
    fixture: fixture.fixture,
    organization,
    window: { from: await at(-31), to: await at(182) },
    viewers,
  };
}

beforeAll(async () => {
  if (noApi) return;
  const client = await connect();
  try {
    for (const fixture of FIXTURES) scenes.push(await buildScene(client, fixture));
  } finally {
    await client.end();
  }
}, 30_000);

afterAll(async () => {
  if (noApi) return;
  const client = await connect();
  try {
    const subjects = [...scene.loans, ...scene.rosterOverrides, ...scene.overrides, ...scene.leave];
    await client.query('begin');
    await client.query('delete from notification_outbox where subject_id = any($1::uuid[])', [subjects]);
    await client.query('delete from leave_records where id = any($1::uuid[])', [scene.leave]);
    await client.query('delete from roster_overrides where id = any($1::uuid[])', [scene.rosterOverrides]);
    await client.query('delete from shift_type_overrides where id = any($1::uuid[])', [scene.overrides]);
    await client.query('delete from team_loans where id = any($1::uuid[])', [scene.loans]);
    await client.query('commit');
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end();
  }
});

// ------------------------------------------------- the browser's transport

async function tokenFor(email: string): Promise<string> {
  const endpoint = apiEndpoint;
  if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');
  const response = await fetch(`${endpoint.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: endpoint.key, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: FIXTURE_PASSWORD }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  const token = body['access_token'];
  if (typeof token !== 'string' || token === '') throw new Error(`${email} could not sign in: ${String(response.status)}`);
  await usableAfterIssue(token);
  return token;
}

/**
 * PostgREST refuses a token whose `iat` is later than its own clock (PGRST303
 * "JWT issued at future"), and GoTrue's `iat` can round up past PostgREST's
 * reading in the same second (CI run on 76e6f63). Wait until the issuing
 * second has passed, as a browser that signs in and then reads always has.
 */
async function usableAfterIssue(token: string): Promise<void> {
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { iat?: unknown };
  if (typeof payload.iat !== 'number') return;
  const waitMs = (payload.iat + 1) * 1000 - Date.now();
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)));
}

function userIdOf(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown };
  if (typeof payload.sub !== 'string') throw new Error('the token names no user');
  return payload.sub;
}

/** PostgREST over fetch, as supabase-js sends a select with an exact count and an rpc. */
function restOf(token: string) {
  const endpoint = apiEndpoint;
  if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');
  const headers = { apikey: endpoint.key, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  // Every answer, by path, with its status and body: a refusal names only its check, so a failure
  // prints what PostgREST actually said.
  const answers: string[] = [];
  const answerOf = async (path: string, response: Response) => {
    const text = await response.text();
    answers.push(`${path} ${String(response.status)} ${text.slice(0, 600)}`);
    const body: unknown = JSON.parse(text);
    return response.ok
      ? { data: body as readonly unknown[], error: null }
      : { data: null, error: body as { code?: string; message?: string } };
  };

  return {
    answers,
    select: (columns: string, _options: unknown) => ({
      filter: async (column: string, operator: string, value: string): Promise<CalendarAnswer> => {
        const query = new URLSearchParams({ select: columns, [column]: `${operator}.${value}` });
        const response = await fetch(`${endpoint.url}/rest/v1/organizations?${query.toString()}`, {
          headers: { ...headers, prefer: 'count=exact' },
        });
        const range = response.headers.get('content-range') ?? '';
        const total = Number(range.split('/')[1]);
        return { ...(await answerOf('organizations', response)), count: Number.isInteger(total) ? total : null };
      },
    }),
    rpc: async (fn: string) =>
      answerOf(`rpc/${fn}`, await fetch(`${endpoint.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: '{}' })),
  };
}

async function browserInputsOf(viewer: Viewer, window: { from: string; to: string }): Promise<ScheduleInputs> {
  const token = await tokenFor(viewer.email);
  const rest = restOf(token);
  const { readCalendar, readMyLeaveRows, leaveRecordsOf, scheduleInputsOfCalendar } = await browserModules();
  const session = () => Promise.resolve({ user: { id: userIdOf(token) } });
  const calendar = await readCalendar(rest, rest, session);
  if (!calendar.ok) throw new Error(`${viewer.email}: the calendar is ${calendar.code}\n${rest.answers.join('\n')}`);
  expect(calendar.snapshot.viewer.memberId).toBe(viewer.memberId);

  const rows = await readMyLeaveRows(rest);
  if (!rows.ok) throw new Error(`${viewer.email}: the own leave is ${rows.code}`);
  const ownLeave = leaveRecordsOf(rows.rows, viewer.memberId);
  if (ownLeave === null) throw new Error(`${viewer.email}: the own leave does not parse`);

  return scheduleInputsOfCalendar(calendar.snapshot, ownLeave, window);
}

async function serverInputsOf(client: Client, memberId: string, window: { from: string; to: string }): Promise<ScheduleInputs> {
  const row = await one<{ inputs: ScheduleInputs | null }>(
    client,
    'select private.member_schedule_inputs($1::uuid, $2::date, $3::date) as inputs',
    [memberId, window.from, window.to],
  );
  if (row.inputs === null) throw new Error(`member ${memberId} has no assembly`);
  return row.inputs;
}

/** Every array sorted by its elements' JSON, recursively: "deep-equal after ordering by id". */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(ordered).sort((left, right) => {
      const a = JSON.stringify(left);
      const b = JSON.stringify(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  if (typeof value === 'object' && value !== null) {
    // jsonb orders keys its own way: every object is rewritten in key order, so equal elements sort alike.
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, inner]) => [key, ordered(inner)]),
    );
  }
  return value;
}

describe('read parity: the server assembly equals the browser\'s read (AD-19)', () => {
  it.skipIf(noApi)('builds a scene in both fixtures, with members to read it as', () => {
    expect(scenes.map((one) => one.fixture)).toEqual(FIXTURES.map((fixture) => fixture.fixture));
    for (const one of scenes) expect(one.viewers.length, `${one.fixture} has nobody who can sign in`).toBeGreaterThan(2);
    expect(scene.rosterOverrides).toHaveLength(4);
    expect(scene.loans).toHaveLength(6);
    expect(scene.leave).toHaveLength(10);
  });

  for (const fixture of FIXTURES) {
    it.skipIf(noApi)(
      `holds every member of ${fixture.fixture} equal, stamps included, and R12 over each`,
      async () => {
        const one = scenes.find((candidate) => candidate.fixture === fixture.fixture);
        if (one === undefined) throw new Error(`${fixture.fixture} has no scene`);
        const client = await connect();
        try {
          for (const [index, viewer] of one.viewers.entries()) {
            const browser = await browserInputsOf(viewer, one.window).catch((cause: unknown) => {
              throw new Error(`viewer ${String(index + 1)} of ${String(one.viewers.length)}: ${String(cause)}`, { cause });
            });
            const server = await serverInputsOf(client, viewer.memberId, one.window);

            expect(ordered(server), `${viewer.email}: the assemblies differ`).toEqual(ordered(browser));
            expect(atWorkShiftsOf(server, one.window.from, one.window.to), `${viewer.email}: R12 differs`).toEqual(
              atWorkShiftsOf(browser, one.window.from, one.window.to),
            );
          }
        } finally {
          await client.end();
        }
      },
      60_000,
    );
  }

  it.skipIf(noApi)("carries the scene by the window: what overlaps it, and nothing wholly outside", async () => {
    const client = await connect();
    try {
      for (const one of scenes) {
        const { rows } = one;
        const inputs = await serverInputsOf(client, rows.member, one.window);
        const loans = inputs.members.find((entry) => entry.id === rows.member)?.loans.map((loan) => loan.id) ?? [];
        const leave = inputs.leave.map((record) => record.id);

        expect(loans, `${one.fixture}: the loan`).toContain(rows.loan);
        expect(inputs.rosterOverrides.map((override) => override.id), `${one.fixture}: the roster override`).toContain(rows.rosterOverride);
        expect(inputs.overrides.map((override) => override.id), `${one.fixture}: the override`).toContain(rows.override);
        expect(leave, `${one.fixture}: the leave in the window`).toEqual(expect.arrayContaining([rows.fullDay, rows.halfDay, rows.straddling]));
        expect(inputs.leave.find((record) => record.id === rows.halfDay)?.half).toBe('FIRST');
        expect(Object.hasOwn(inputs.leave.find((record) => record.id === rows.fullDay) ?? {}, 'half')).toBe(false);
        for (const id of rows.outside) {
          expect(loans, `${one.fixture}: a loan outside the window`).not.toContain(id);
          expect(leave, `${one.fixture}: a record outside the window`).not.toContain(id);
        }
        expect(JSON.stringify(inputs)).not.toMatch(/Paritet/);

        // R12 over it, so the parity above is not of empty projections: on the lent team, the
        // confirmed override replaces the date's type, the full days hold nothing, the half day
        // keeps only its worked half.
        const shifts = atWorkShiftsOf(inputs, one.window.from, one.window.to);
        const { dates } = one;
        expect(shifts.filter((shift) => shift.loanId === rows.loan).length, `${one.fixture}: shifts on the loan`).toBeGreaterThan(0);
        expect(
          shifts.filter((shift) => shift.date === dates.override).map((shift) => [shift.teamId === rows.lentTo, shift.shiftTypeId, shift.loanId]),
          `${one.fixture}: the override in force`,
        ).toEqual([[true, dates.workingType, rows.loan]]);
        expect(shifts.filter((shift) => dates.fullDay.includes(shift.date)), `${one.fixture}: the full days`).toEqual([]);
        for (const shift of shifts.filter((candidate) => candidate.date === dates.halfDay)) {
          expect(shift.workedHalf, `${one.fixture}: the half day`).toBe('SECOND');
        }
      }
    } finally {
      await client.end();
    }
  });

  it.skipIf(noApi)('answers null for a member that does not exist, and refuses a reversed window', async () => {
    const client = await connect();
    try {
      const missing = await one<{ inputs: unknown }>(
        client,
        `select private.member_schedule_inputs('00000000-0000-4000-8000-000000000000'::uuid, '2026-01-01', '2026-01-31') as inputs`,
        [],
      );
      expect(missing.inputs).toBeNull();
      await expect(
        client.query(`select private.member_schedule_inputs(gen_random_uuid(), '2026-02-01', '2026-01-01')`),
      ).rejects.toMatchObject({ code: '22023', message: 'SCHEDULE_INPUTS_WINDOW' });
    } finally {
      await client.end();
    }
  });

  it.skipIf(noApi)('is executable by no request role, nor by service_role', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ role: string; allowed: boolean }>(
        `select role, has_function_privilege(role, 'private.member_schedule_inputs(uuid, date, date)', 'execute') as allowed
           from unnest(array['anon', 'authenticated', 'service_role']) as role`,
      );
      expect(rows.filter((row) => row.allowed).map((row) => row.role)).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
