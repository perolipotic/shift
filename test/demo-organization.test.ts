import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

/**
 * The pilot demo organization (`supabase/operator/demo-organization.sql`),
 * executed against the local Postgres.
 *
 * EVERY case that runs the file, the refusals included, runs it inside a
 * transaction this test rolls back, so the shared database is left exactly as
 * it was — whether or not a human has applied the demo to it with
 * `pnpm db:demo` — and a regressed guard can never commit a demo. The
 * transactions are REPEATABLE READ, so a before/after comparison sees only
 * this transaction's own writes and never a row another process committed
 * meanwhile.
 *
 * The settings the executing cases pass are the ones `package.json`'s
 * `db:demo` script passes, parsed out of its PGOPTIONS, so the wiring a human
 * runs is the wiring asserted.
 *
 * Two kinds of case: the static ones (the file's shape, its target guard, the
 * `db:demo` wiring) always run; every case that executes SQL is SKIPPED when
 * no local database is reachable, the rule `test/provisioning.test.ts`
 * follows.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const databaseUrl =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function reachable(): Promise<boolean> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const noDatabase = !(await reachable());

const demoScript = readFileSync(
  join(repoRoot, 'supabase', 'operator', 'demo-organization.sql'),
  'utf8',
);

const DEMO_SLUG = 'dvd-demo';
const DEMO_DOMAIN = 'dvd-demo.shift.invalid';

/** `package.json`'s `db:demo` script, and the PGOPTIONS it sets, parsed. */
const demoCommand = (
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
).scripts['db:demo'] ?? '';

function pgOptionsOf(command: string): Record<string, string> {
  const options = /PGOPTIONS='([^']*)'/.exec(command)?.[1];
  if (options === undefined) return {};
  const settings: Record<string, string> = {};
  for (const option of options.split(/(?:^|\s+)-c\s+/).filter((part) => part.trim() !== '')) {
    const equals = option.indexOf('=');
    if (equals < 0) continue;
    settings[option.slice(0, equals).trim()] = option.slice(equals + 1).trim();
  }
  return settings;
}

const demoOptions = pgOptionsOf(demoCommand);

/** What `pnpm db:demo` passes, as `configure` takes it. */
const LOCAL_SETTINGS = {
  target: demoOptions['shift.demo_target'] ?? '',
  password: demoOptions['shift.demo_password'] ?? '',
} as const;
const DEMO_PASSWORD = LOCAL_SETTINGS.password;

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

/** Run `work` in a REPEATABLE READ transaction that is always rolled back. */
async function inRolledBackTransaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    await client.query('begin isolation level repeatable read');
    return await work(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end();
  }
}

/** The two settings the script reads, transaction-local (`set local`). */
async function configure(
  client: Client,
  settings: { readonly target?: string; readonly password?: string },
): Promise<void> {
  if (settings.target !== undefined) {
    await client.query('select set_config($1, $2, $3)', ['shift.demo_target', settings.target, true]);
  }
  if (settings.password !== undefined) {
    await client.query('select set_config($1, $2, $3)', ['shift.demo_password', settings.password, true]);
  }
}

/** Run the script, then force the deferred zero-admins check to fire now. */
async function runDemo(client: Client): Promise<void> {
  await client.query(demoScript);
  await client.query('set constraints all immediate');
}

/**
 * Everything the demo is, as one JSON text with no ids and no timestamps, so
 * two runs compare equal exactly when they created the same demo. Attribution
 * is folded in as "by the demo admin" rather than an id.
 */
async function demoSnapshot(client: Client): Promise<string> {
  const { rows } = await client.query<{ snapshot: string | null }>(
    `with demo as (select * from organizations where slug = $1),
          admin as (
            select m.auth_user_id from members m join demo on demo.id = m.organization_id
             where m.username = 'admin'
          )
     select jsonb_build_object(
       'organization', (select jsonb_build_object(
          'name', name, 'short_name', short_name, 'type', organization_type,
          'timezone', timezone, 'locale', locale,
          'leave_year', array[leave_year_start_month, leave_year_start_day],
          'uses_fire_ranks', uses_fire_ranks) from demo),
       'members', (select jsonb_agg(jsonb_build_object(
          'name', m.name, 'username', m.username, 'email', m.email, 'role', m.role,
          'fire_rank', m.fire_rank, 'leave', m.leave_allowance_days, 'address', u.email)
          order by m.username)
          from members m join demo on demo.id = m.organization_id
          join auth.users u on u.id = m.auth_user_id),
       'statuses', (select count(*) from member_status_versions v join demo on demo.id = v.organization_id),
       'teams', (select jsonb_agg(jsonb_build_object(
          'name', t.name, 'archived', t.archived,
          'by_admin', t.created_by = (select auth_user_id from admin)) order by t.name)
          from teams t join demo on demo.id = t.organization_id),
       'memberships', (select jsonb_agg(jsonb_build_object(
          'member', m.username, 'team', t.name, 'position', v.position,
          'from', v.effective_from,
          'by_admin', v.created_by = (select auth_user_id from admin)) order by m.username, v.effective_from)
          from team_membership_versions v join demo on demo.id = v.organization_id
          join members m on m.id = v.member_id
          left join teams t on t.id = v.team_id),
       'hour_bands', (select jsonb_agg(jsonb_build_object('name', b.name, 'start', b.start_time)
          order by b.start_time)
          from hour_bands b join demo on demo.id = b.organization_id),
       'shift_types', (select jsonb_agg(jsonb_build_object(
          'name', s.name, 'working', s.is_working, 'archived', s.archived,
          'by_admin', s.created_by = (select auth_user_id from admin),
          'versions', (select coalesce(jsonb_agg(jsonb_build_object(
              'start', sv.start_time, 'end', sv.end_time, 'from', sv.effective_from,
              'by_admin', sv.created_by = (select auth_user_id from admin)) order by sv.effective_from), '[]'::jsonb)
              from shift_type_versions sv where sv.shift_type_id = s.id))
          order by s.created_at, s.id)
          from shift_types s join demo on demo.id = s.organization_id),
       'rotation_patterns', (select jsonb_agg(jsonb_build_object(
          'by_admin', p.created_by = (select auth_user_id from admin),
          'steps', (select coalesce(jsonb_agg(jsonb_build_object(
              'position', rs.position, 'type', st.name,
              'by_admin', rs.created_by = (select auth_user_id from admin)) order by rs.position), '[]'::jsonb)
              from rotation_steps rs join shift_types st on st.id = rs.shift_type_id
             where rs.pattern_id = p.id))
          order by p.created_at, p.id)
          from rotation_patterns p join demo on demo.id = p.organization_id),
       'rotation_assignments', (select jsonb_agg(jsonb_build_object(
          'team', t.name, 'offset', rs.position, 'anchor', a.anchor_date, 'from', a.effective_from,
          'by_admin', a.created_by = (select auth_user_id from admin)) order by t.name, a.effective_from)
          from rotation_assignments a join demo on demo.id = a.organization_id
          join teams t on t.id = a.team_id
          join rotation_steps rs on rs.id = a.offset_step_id),
       'auth_users', (select count(*) from auth.users where email like '%@' || $2),
       'identities', (select count(*) from auth.identities i join auth.users u on u.id = i.user_id
                       where u.email like '%@' || $2)
     )::text as snapshot`,
    [DEMO_SLUG, DEMO_DOMAIN],
  );
  return rows[0]?.snapshot ?? '';
}

/**
 * A fingerprint of every row that is NOT the demo's: the other organizations
 * and everything scoped to them, and every auth user and identity outside the
 * demo's address domain. Whole rows, as text, ordered by key.
 */
async function othersFingerprint(client: Client): Promise<{ rows: number; digest: string }> {
  const { rows } = await client.query<{ rows: number; digest: string }>(
    `with others as (select id from organizations where slug <> $1),
          everything as (
            select 'organizations' as source, o.id::text as key, to_jsonb(o)::text as body
              from organizations o where o.id in (select id from others)
            union all select 'members', x.id::text, to_jsonb(x)::text from members x
              where x.organization_id in (select id from others)
            union all select 'member_status_versions', x.id::text, to_jsonb(x)::text from member_status_versions x
              where x.organization_id in (select id from others)
            union all select 'teams', x.id::text, to_jsonb(x)::text from teams x
              where x.organization_id in (select id from others)
            union all select 'team_membership_versions', x.id::text, to_jsonb(x)::text from team_membership_versions x
              where x.organization_id in (select id from others)
            union all select 'hour_bands', x.id::text, to_jsonb(x)::text from hour_bands x
              where x.organization_id in (select id from others)
            union all select 'shift_types', x.id::text, to_jsonb(x)::text from shift_types x
              where x.organization_id in (select id from others)
            union all select 'shift_type_versions', x.id::text, to_jsonb(x)::text from shift_type_versions x
              where x.organization_id in (select id from others)
            union all select 'rotation_patterns', x.id::text, to_jsonb(x)::text from rotation_patterns x
              where x.organization_id in (select id from others)
            union all select 'rotation_steps', x.id::text, to_jsonb(x)::text from rotation_steps x
              where x.organization_id in (select id from others)
            union all select 'rotation_assignments', x.id::text, to_jsonb(x)::text from rotation_assignments x
              where x.organization_id in (select id from others)
            union all select 'auth.users', u.id::text, to_jsonb(u)::text from auth.users u
              where u.email is null or u.email not like '%@' || $2
            union all select 'auth.identities', i.id::text, to_jsonb(i)::text from auth.identities i
              join auth.users u on u.id = i.user_id
              where u.email is null or u.email not like '%@' || $2
          )
     select count(*)::int as rows,
            md5(coalesce(string_agg(source || ':' || key || ':' || body, E'\\n' order by source, key), '')) as digest
       from everything`,
    [DEMO_SLUG, DEMO_DOMAIN],
  );
  const found = rows[0];
  if (found === undefined) throw new Error('the fingerprint query returned no row');
  return found;
}

interface Refusal {
  readonly code: string;
  readonly message: string;
}

async function refused(work: () => Promise<unknown>): Promise<Refusal> {
  try {
    await work();
  } catch (cause) {
    const error = cause as { code?: string; message?: string };
    return { code: error.code ?? '', message: error.message ?? '' };
  }
  throw new Error('nothing was refused: the script ran');
}

/** The interface's own labels, so the roster line is the one a screen renders. */
const hr = JSON.parse(
  readFileSync(join(repoRoot, 'apps', 'web', 'src', 'i18n', 'locales', 'hr.json'), 'utf8'),
) as {
  ljudi: { rank: Record<string, string> };
  smjene: { position: Record<string, string>; roster: Record<string, string> };
};

/** `firefighter_1` → `firefighter1`, `senior_nco` → `seniorNco`: the catalogue's key. */
function rankKey(code: string): string {
  return code.replaceAll(/_([a-z0-9])/g, (_match, next: string) => next.toUpperCase());
}

function rosterLine(name: string, rank: string, position: string): string {
  const template = hr.smjene.roster['withRankAndPosition'] ?? '';
  return template
    .replace('{name}', name)
    .replace('{rank}', hr.ljudi.rank[rankKey(rank)] ?? `<${rank}>`)
    .replace('{position}', hr.smjene.position[position] ?? `<${position}>`);
}

describe('the demo organization script', () => {
  it('is one do block, so `supabase db query` can send it as one statement', () => {
    const statements = demoScript.replaceAll(/--[^\n]*/g, '').trim();

    expect(statements.startsWith('do $$')).toBe(true);
    expect(statements.endsWith('$$;')).toBe(true);
    expect(statements.match(/\$\$/g)?.length).toBe(2);
  });

  it('guards the target: only local and staging are admitted, before any write', () => {
    const statements = demoScript.replaceAll(/--[^\n]*/g, '');

    expect(statements).toMatch(
      /if demo_target is null or demo_target not in \('local', 'staging'\) then\s+raise exception using\s+errcode = 'raise_exception',\s+message = 'DEMO_TARGET_REFUSED'/,
    );
    const guard = statements.indexOf('DEMO_TARGET_REFUSED');
    const firstWrite = statements.search(/\b(delete from|insert into)\b/);
    expect(guard).toBeGreaterThan(0);
    expect(guard, 'the target guard must come before the first write').toBeLessThan(firstWrite);
  });

  it('wires `pnpm db:demo` to the local target with a password', () => {
    expect(demoCommand).toContain('supabase db query --local -f supabase/operator/demo-organization.sql');
    expect(Object.keys(demoOptions).sort()).toEqual(['shift.demo_password', 'shift.demo_target']);
    expect(demoOptions['shift.demo_target']).toBe('local');
    expect(LOCAL_SETTINGS.password.length, 'db:demo passes an empty password').toBeGreaterThan(0);
  });

  it.skipIf(noDatabase)('creates the organization, its people, four crews and the pilot configuration', async () => {
    await inRolledBackTransaction(async (client) => {
      await configure(client, LOCAL_SETTINGS);
      await runDemo(client);

      const { rows: organization } = await client.query<{
        id: string;
        name: string;
        organization_type: string;
        timezone: string;
        locale: string;
        leave_year_start_month: number;
        leave_year_start_day: number;
        uses_fire_ranks: boolean;
      }>('select * from organizations where slug = $1', [DEMO_SLUG]);

      expect(organization.length).toBe(1);
      expect(organization[0]).toMatchObject({
        name: 'DVD Kaštel Novi (demo)',
        organization_type: 'Fire Department',
        timezone: 'Europe/Zagreb',
        locale: 'hr',
        leave_year_start_month: 1,
        leave_year_start_day: 1,
        uses_fire_ranks: true,
      });
      const organizationId = organization[0]?.id;

      const { rows: counts } = await client.query<Record<string, number>>(
        `select
           (select count(*)::int from members where organization_id = $1) as members,
           (select count(*)::int from members where organization_id = $1 and role = 'admin') as admins,
           (select count(*)::int from members where organization_id = $1 and role = 'member_role') as "memberRole",
           (select count(*)::int from teams where organization_id = $1) as teams,
           (select count(*)::int from team_membership_versions where organization_id = $1) as memberships,
           (select count(*)::int from hour_bands where organization_id = $1) as bands,
           (select count(*)::int from shift_types where organization_id = $1) as types,
           (select count(*)::int from rotation_patterns where organization_id = $1) as patterns,
           (select count(*)::int from rotation_steps where organization_id = $1) as steps,
           (select count(*)::int from rotation_assignments where organization_id = $1) as assignments,
           (select count(*)::int from auth.users where email like '%@' || $2) as "authUsers",
           (select count(*)::int from auth.identities i join auth.users u on u.id = i.user_id
             where u.email like '%@' || $2) as identities`,
        [organizationId, DEMO_DOMAIN],
      );
      expect(counts[0]).toEqual({
        members: 17,
        admins: 1,
        memberRole: 16,
        teams: 4,
        memberships: 16,
        bands: 2,
        types: 3,
        patterns: 1,
        steps: 4,
        assignments: 4,
        authUsers: 17,
        identities: 17,
      });

      // The admin: "Demo Admin", no rank, and in no crew.
      const { rows: admin } = await client.query<{ name: string; fire_rank: string | null; versions: number }>(
        `select m.name, m.fire_rank,
                (select count(*)::int from team_membership_versions v where v.member_id = m.id) as versions
           from members m where m.organization_id = $1 and m.role = 'admin'`,
        [organizationId],
      );
      expect(admin).toEqual([{ name: 'Demo Admin', fire_rank: null, versions: 0 }]);

      // Every member-role account is ranked, with an ASCII username that is
      // the local part of the address it signs in with.
      const { rows: people } = await client.query<{ username: string; fire_rank: string | null; local: string }>(
        `select m.username, m.fire_rank, split_part(u.email, '@', 1) as local
           from members m join auth.users u on u.id = m.auth_user_id
          where m.organization_id = $1 and m.role = 'member_role'`,
        [organizationId],
      );
      expect(people.filter((person) => person.fire_rank === null)).toEqual([]);
      expect(people.filter((person) => !/^[a-z]+\.[a-z]+$/.test(person.username))).toEqual([]);
      expect(people.filter((person) => person.username !== person.local)).toEqual([]);
      expect(new Set(people.map((person) => person.username)).size).toBe(16);

      // The crews: Smjena A–D, each exactly one commander, one driver and two
      // firefighters, from 2020-01-01, with the rank each position allows.
      const { rows: crews } = await client.query<{
        team: string;
        position: string;
        rank: string;
        from: string;
      }>(
        `select t.name as team, v.position, m.fire_rank as rank, v.effective_from::text as "from"
           from team_membership_versions v
           join teams t on t.id = v.team_id
           join members m on m.id = v.member_id
          where v.organization_id = $1
          order by t.name, v.position`,
        [organizationId],
      );
      expect([...new Set(crews.map((row) => row.team))]).toEqual(['Smjena A', 'Smjena B', 'Smjena C', 'Smjena D']);
      expect(crews.filter((row) => row.from !== '2020-01-01')).toEqual([]);

      const allowed: Record<string, readonly string[]> = {
        commander: ['officer', 'nco'],
        driver: ['firefighter_1', 'nco'],
        firefighter: ['firefighter', 'trainee'],
      };
      for (const team of ['Smjena A', 'Smjena B', 'Smjena C', 'Smjena D']) {
        const crew = crews.filter((row) => row.team === team);
        expect(crew.map((row) => row.position), `${team}'s positions`).toEqual([
          'commander',
          'driver',
          'firefighter',
          'firefighter',
        ]);
        expect(
          crew.filter((row) => !(allowed[row.position] ?? []).includes(row.rank)),
          `${team} has a rank its position does not allow`,
        ).toEqual([]);
      }
      expect(crews.filter((row) => row.position === 'commander').length).toBe(4);
      expect(crews.filter((row) => row.position === 'driver').length).toBe(4);
      expect(crews.filter((row) => row.position === 'firefighter').length).toBe(8);
      expect(crews.some((row) => row.rank === 'trainee'), 'at least one trainee').toBe(true);

      // Ranks vary across crews: no two crews carry the same rank line-up.
      const lineUps = ['Smjena A', 'Smjena B', 'Smjena C', 'Smjena D'].map((team) =>
        crews.filter((row) => row.team === team).map((row) => `${row.position}:${row.rank}`).sort().join(','),
      );
      expect(new Set(lineUps).size, 'every crew carries the same ranks').toBe(4);

      // Pilot configuration.
      const { rows: bands } = await client.query<{ name: string; start: string }>(
        `select name, start_time::text as start from hour_bands where organization_id = $1 order by start_time`,
        [organizationId],
      );
      expect(bands).toEqual([
        { name: 'Dan', start: '07:00:00' },
        { name: 'Noć', start: '19:00:00' },
      ]);

      const { rows: types } = await client.query<{ name: string; working: boolean; times: string | null }>(
        `select s.name, s.is_working as working,
                (select string_agg(v.start_time::text || '-' || v.end_time::text || '@' || v.effective_from::text, ',')
                   from shift_type_versions v where v.shift_type_id = s.id) as times
           from shift_types s where s.organization_id = $1
          order by s.created_at, s.id`,
        [organizationId],
      );
      expect(types).toEqual([
        { name: 'Dan', working: true, times: '07:00:00-19:00:00@2020-01-01' },
        { name: 'Noć', working: true, times: '19:00:00-07:00:00@2020-01-01' },
        { name: 'Slobodno', working: false, times: null },
      ]);
      // Strictly ascending creation, so the ramp slots are Dan 1 and Noć 2.
      const { rows: ties } = await client.query<{ distinct: number }>(
        'select count(distinct created_at)::int as distinct from shift_types where organization_id = $1',
        [organizationId],
      );
      expect(ties[0]?.distinct).toBe(3);

      // The pilot's rotation: [Dan, Noć, Slobodno, Slobodno], Smjena A–D at
      // offsets 0–3 from the anchor 2020-01-01, effective from the same date.
      const { rows: steps } = await client.query<{ position: number; type: string }>(
        `select s.position, t.name as type
           from rotation_steps s join shift_types t on t.id = s.shift_type_id
          where s.organization_id = $1 order by s.position`,
        [organizationId],
      );
      expect(steps).toEqual([
        { position: 0, type: 'Dan' },
        { position: 1, type: 'Noć' },
        { position: 2, type: 'Slobodno' },
        { position: 3, type: 'Slobodno' },
      ]);
      const { rows: assignments } = await client.query<{
        team: string;
        offset: number;
        anchor: string;
        from: string;
        samePattern: boolean;
      }>(
        `select t.name as team, s.position as "offset", a.anchor_date::text as anchor,
                a.effective_from::text as "from", a.pattern_id = s.pattern_id as "samePattern"
           from rotation_assignments a
           join teams t on t.id = a.team_id
           join rotation_steps s on s.id = a.offset_step_id
          where a.organization_id = $1 order by t.name`,
        [organizationId],
      );
      expect(assignments).toEqual(
        ['Smjena A', 'Smjena B', 'Smjena C', 'Smjena D'].map((team, offset) => ({
          team,
          offset,
          anchor: '2020-01-01',
          from: '2020-01-01',
          samePattern: true,
        })),
      );

      // Attribution: every created_by is the demo admin.
      const { rows: attribution } = await client.query<{ foreign: number; attributed: number }>(
        `with admin as (select auth_user_id from members where organization_id = $1 and role = 'admin')
         select count(*) filter (where created_by <> (select auth_user_id from admin))::int as foreign,
                count(*)::int as attributed
           from (
             select created_by from teams where organization_id = $1
             union all select created_by from team_membership_versions where organization_id = $1
             union all select created_by from shift_types where organization_id = $1
             union all select created_by from shift_type_versions where organization_id = $1
             union all select created_by from rotation_patterns where organization_id = $1
             union all select created_by from rotation_steps where organization_id = $1
             union all select created_by from rotation_assignments where organization_id = $1
           ) as rows`,
        [organizationId],
      );
      expect(attribution[0]).toEqual({ foreign: 0, attributed: 4 + 16 + 3 + 2 + 1 + 4 + 4 });
    });
  });

  it.skipIf(noDatabase)('shows each crew to a demo member as four `Ime · čin · položaj` lines', async () => {
    await inRolledBackTransaction(async (client) => {
      await configure(client, LOCAL_SETTINGS);
      await runDemo(client);

      const { rows: teams } = await client.query<{ id: string; name: string; organization: string }>(
        `select t.id, t.name, t.organization_id as organization
           from teams t join organizations o on o.id = t.organization_id
          where o.slug = $1 order by t.name`,
        [DEMO_SLUG],
      );
      expect(teams.map((team) => team.name)).toEqual(['Smjena A', 'Smjena B', 'Smjena C', 'Smjena D']);

      // A member-role reader, from Smjena A, reading every crew.
      const { rows: reader } = await client.query<{ authUserId: string }>(
        `select m.auth_user_id as "authUserId"
           from members m join organizations o on o.id = m.organization_id
          where o.slug = $1 and m.username = 'mate.radic' and m.role = 'member_role'`,
        [DEMO_SLUG],
      );
      const caller = reader[0];
      if (caller === undefined) throw new Error('no demo member to read as');

      await client.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: caller.authUserId, role: 'authenticated', organization_id: teams[0]?.organization }),
      ]);
      await client.query('set local role authenticated');
      const rosters: Record<string, string[]> = {};
      for (const team of teams) {
        const { rows } = await client.query<{
          name: string;
          members: { name: string; fire_rank: string | null; position: string | null }[];
        }>('select name, members from team_roster($1)', [team.id]);
        expect(rows.length, `the ${team.name} roster read returned nothing to a demo member`).toBe(1);
        const members = rows[0]?.members ?? [];
        expect(
          members.filter((member) => member.fire_rank === null || member.position === null),
          `${team.name} has a line without rank or position`,
        ).toEqual([]);
        rosters[rows[0]?.name ?? team.name] = members
          .map((member) => rosterLine(member.name, member.fire_rank ?? '<none>', member.position ?? '<none>'))
          .sort();
      }
      await client.query('reset role');

      const expected: Record<string, string[]> = {
        'Smjena A': [
          'Davor Horvat · vatrogasni časnik · zapovjednik',
          'Luka Knežević · vatrogasni dočasnik · vozač',
          'Mate Radić · vatrogasac · vatrogasac',
          'Ivana Vuković · vatrogasac pripravnik · vatrogasac',
        ],
        'Smjena B': [
          'Zoran Pavić · vatrogasni dočasnik · zapovjednik',
          'Nikola Barišić · vatrogasac I. klase · vozač',
          'Stipe Matić · vatrogasac · vatrogasac',
          'Dino Grgić · vatrogasac · vatrogasac',
        ],
        'Smjena C': [
          'Mirela Kovačević · vatrogasni časnik · zapovjednik',
          'Ante Bilić · vatrogasac I. klase · vozač',
          'Frane Lozić · vatrogasac pripravnik · vatrogasac',
          'Karlo Jelić · vatrogasac · vatrogasac',
        ],
        'Smjena D': [
          'Duje Tomić · vatrogasni dočasnik · zapovjednik',
          'Roko Vidović · vatrogasni dočasnik · vozač',
          'Marin Šarić · vatrogasac · vatrogasac',
          'Lea Bašić · vatrogasac pripravnik · vatrogasac',
        ],
      };
      expect(rosters).toEqual(
        Object.fromEntries(Object.entries(expected).map(([team, lines]) => [team, [...lines].sort()])),
      );
    });
  });

  it.skipIf(noDatabase)('replaces the demo on a re-run, with no duplicate auth users', async () => {
    await inRolledBackTransaction(async (client) => {
      await configure(client, LOCAL_SETTINGS);
      await runDemo(client);
      const first = await demoSnapshot(client);

      // The snapshot is only a comparison if it holds the demo: every
      // aggregate a non-null array of the expected length.
      const parsed = JSON.parse(first) as Record<string, unknown>;
      const lengths = Object.fromEntries(
        ['members', 'teams', 'memberships', 'hour_bands', 'shift_types', 'rotation_patterns', 'rotation_assignments'].map((key) => [
          key,
          Array.isArray(parsed[key]) ? (parsed[key] as unknown[]).length : `not an array: ${String(parsed[key])}`,
        ]),
      );
      expect(lengths).toEqual({
        members: 17,
        teams: 4,
        memberships: 16,
        hour_bands: 2,
        shift_types: 3,
        rotation_patterns: 1,
        rotation_assignments: 4,
      });
      expect(
        ((parsed['rotation_patterns'] as { steps: unknown[] }[] | undefined)?.[0]?.steps ?? []).length,
        'the demo pattern has no steps in the snapshot',
      ).toBe(4);
      expect(parsed['organization']).not.toBeNull();
      expect(parsed['auth_users']).toBe(17);

      // Edit the demo the way a human using it would.
      await client.query(
        `update members set name = 'Preimenovan', fire_rank = null
          where username = 'mate.radic'
            and organization_id = (select id from organizations where slug = $1)`,
        [DEMO_SLUG],
      );
      await client.query(
        `update teams set name = 'Smjena X'
          where name = 'Smjena D' and organization_id = (select id from organizations where slug = $1)`,
        [DEMO_SLUG],
      );
      await client.query(
        `update hour_bands set start_time = '08:00'
          where name = 'Dan' and organization_id = (select id from organizations where slug = $1)`,
        [DEMO_SLUG],
      );
      // Debris a re-run must clear: a stray account in the demo's domain and
      // a team nobody seeded.
      await client.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), $1)`,
        [`stray@${DEMO_DOMAIN}`],
      );
      await client.query(
        `insert into teams (organization_id, name, created_by)
         select o.id, 'Smjena E', m.auth_user_id
           from organizations o join members m on m.organization_id = o.id
          where o.slug = $1 and m.username = 'admin'`,
        [DEMO_SLUG],
      );
      expect(await demoSnapshot(client)).not.toBe(first);

      await runDemo(client);

      expect(await demoSnapshot(client)).toBe(first);
      const { rows } = await client.query<{ organizations: number; users: number; stray: number; extra: number }>(
        `select (select count(*)::int from organizations where slug = $1) as organizations,
                (select count(*)::int from auth.users where email like '%@' || $2) as users,
                (select count(*)::int from auth.users where email = 'stray@' || $2) as stray,
                (select count(*)::int from teams t join organizations o on o.id = t.organization_id
                  where o.slug = $1 and t.name = 'Smjena E') as extra`,
        [DEMO_SLUG, DEMO_DOMAIN],
      );
      expect(rows[0]).toEqual({ organizations: 1, users: 17, stray: 0, extra: 0 });
    });
  });

  it.skipIf(noDatabase)('touches no other organization and no other auth user', async () => {
    await inRolledBackTransaction(async (client) => {
      const before = await othersFingerprint(client);

      // The vacuous-pass guard: both fixtures must be among what is compared.
      const { rows: fixtures } = await client.query<{ present: number }>(
        `select count(*)::int as present from organizations where slug in ('dvd-kastel-novi', 'zastita-split')`,
      );
      expect(fixtures[0]?.present).toBe(2);
      expect(before.rows).toBeGreaterThan(10);

      await configure(client, LOCAL_SETTINGS);
      await runDemo(client);
      await runDemo(client);

      expect(await othersFingerprint(client)).toEqual(before);
    });
  });

  describe('refuses, and writes nothing', () => {
    /**
     * Each refusal runs inside a REPEATABLE READ transaction of ours that is
     * always rolled back, with the settings set transaction-locally, so a
     * regressed guard that let the script run could never commit a demo to
     * the shared database — it would fail on "nothing was refused" instead.
     *
     * What is compared: the demo's own rows (`demoSnapshot`) before the run
     * and after the run is refused. The failed statement is contained by a
     * savepoint, and the "after" read is taken once the transaction is back
     * at that savepoint; the load-bearing assertion is the refusal itself —
     * its SQLSTATE and its message — because PostgreSQL discards a raising
     * do block's writes by construction.
     */
    async function refusal(settings: { readonly target?: string; readonly password?: string }) {
      return inRolledBackTransaction(async (client) => {
        await configure(client, settings);
        const before = await demoSnapshot(client);
        await client.query('savepoint refusal');
        const outcome = await refused(() => client.query(demoScript));
        await client.query('rollback to savepoint refusal');
        const after = await demoSnapshot(client);
        return { outcome, before, after };
      });
    }

    it.skipIf(noDatabase).each([
      { what: 'no password', settings: { target: 'local' } },
      { what: 'an empty password', settings: { target: 'local', password: '' } },
      { what: 'a whitespace-only password', settings: { target: 'local', password: '   ' } },
    ])('with $what', async ({ settings }) => {
      const { outcome, before, after } = await refusal(settings);

      expect(outcome).toEqual({ code: 'P0001', message: 'DEMO_PASSWORD_MISSING' });
      expect(after).toBe(before);
    });

    it.skipIf(noDatabase).each([
      { what: 'no target', settings: { password: DEMO_PASSWORD } },
      { what: 'production', settings: { target: 'production', password: DEMO_PASSWORD } },
      { what: 'an empty target', settings: { target: '', password: DEMO_PASSWORD } },
    ])('with $what', async ({ settings }) => {
      const { outcome, before, after } = await refusal(settings);

      expect(outcome).toEqual({ code: 'P0001', message: 'DEMO_TARGET_REFUSED' });
      expect(after).toBe(before);
    });

    it.skipIf(noDatabase).each([
      {
        what: 'a step naming a shift type the demo does not have',
        from: "(3, 'Slobodno')\n    ) as step",
        to: "(3, 'Nepostojeći')\n    ) as step",
      },
      {
        what: 'an assignment naming a crew the demo does not have',
        from: "('Smjena D', 3)\n    ) as assignment",
        to: "('Smjena Z', 3)\n    ) as assignment",
      },
    ])('with the rotation written short ($what), as DEMO_ROTATION_INCOMPLETE', async ({ from, to }) => {
      // The rotation joins by name, so a drifted name would write fewer rows
      // silently. The guard turns that into a refusal of the whole run.
      expect(demoScript, 'the text this case edits is gone').toContain(from);
      const drifted = demoScript.replace(from, to);
      await inRolledBackTransaction(async (client) => {
        await configure(client, LOCAL_SETTINGS);
        const before = await demoSnapshot(client);
        await client.query('savepoint refusal');
        const outcome = await refused(() => client.query(drifted));
        await client.query('rollback to savepoint refusal');
        expect(outcome).toEqual({ code: 'P0001', message: 'DEMO_ROTATION_INCOMPLETE' });
        expect(await demoSnapshot(client)).toBe(before);
      });
    });

    it.skipIf(noDatabase)('with staging as the target, it runs', async () => {
      // The positive control for the target check: `staging` is admitted.
      await inRolledBackTransaction(async (client) => {
        await configure(client, { target: 'staging', password: DEMO_PASSWORD });
        await runDemo(client);
        const { rows } = await client.query<{ total: number }>(
          'select count(*)::int as total from organizations where slug = $1',
          [DEMO_SLUG],
        );
        expect(rows[0]?.total).toBe(1);
      });
    });
  });
});
