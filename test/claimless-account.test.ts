import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { NOT_AN_ADMIN } from '../supabase/functions/admin-auth/authorize.ts';
import {
  MEMBER_UNKNOWN,
  MUST_SET_PASSWORD,
  PASSWORD_FLAG_CLEARED,
  clearMustSetPassword,
  createUser,
  resetPassword,
  updateUserById,
  type CallerClient,
  type PostgrestAnswer,
  type PrivilegedAccounts,
} from '../supabase/functions/admin-auth/operations.ts';
import { INVOKE_SECRET_REFUSED, readConfiguration as readNotifyConfiguration } from '../supabase/functions/notify/handler.ts';
import { createHandler as createNotifyHandler } from '../supabase/functions/notify/run.ts';

import {
  FIXTURES,
  connect,
  inRolledBackTransaction,
  localApiEndpoint,
  localSecretKey,
  noDatabase,
  organizationId,
} from './database.ts';

/**
 * STORY 19.1 (AD-10 as amended, D-S9; checklist rows A3, A5, A6, E1, E2, E4):
 * a confirmed account with NO `members` row has no claim, and reads and writes
 * nothing. Proved FROM THE CATALOG, not from a list: every table and view in
 * `public`, every function `authenticated` may execute there, Storage, and
 * every Edge Function under `supabase/functions/`. A table, function or Edge
 * Function added later is swept without editing this file (an Edge Function
 * needs its call written below, and the sweep fails until it is).
 *
 * DB-CONNECTING, and written UNRUN (the STRICT DATABASE RULE): CI's fresh
 * stack is its first run. Locally it skips with no stack. Every scene that
 * writes `auth.users` is built as the OWNER, before the case's first `actAs`
 * (bmad-build's scene rule).
 *
 * The functions are asked twice as the claimless account: once with the
 * pilot's real ids, once with ids that exist nowhere. "Reads nothing" is then
 * exact: the two answers are the same, refusal for refusal and row for row, so
 * nothing a function answered depended on a row the account cannot claim.
 * `create_organization` (19.3) is the one function allowed to differ.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const apiEndpoint = localApiEndpoint();
const adminKey = localSecretKey();
const noAdminApi = noDatabase || apiEndpoint === undefined || adminKey === undefined;

const PILOT = FIXTURES[0];

/** AD-23's one definer, the only function a claimless account may succeed with. */
const ALLOWED_TO_SUCCEED = new Set(['create_organization']);

/** The hook's one refusal (0066), word for word. */
const SIGNUP_REFUSED = { error: { http_code: 403, message: 'SIGNUP_REFUSED' } };

const VECTORS = (
  JSON.parse(readFileSync(join(repoRoot, 'test', 'fixtures', 'synthesized-addresses.json'), 'utf8')) as {
    vectors: { address: string; kind: string }[];
  }
).vectors;

// -------------------------------------------------------------------- helpers

/** Run one statement inside a savepoint: its answer, or the code it was refused with. */
async function attempt<T extends Record<string, unknown>>(
  client: Client,
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<{ rows: T[]; rowCount: number } | { refused: string }> {
  await client.query('savepoint attempt');
  try {
    const result = await client.query<T>(sql, [...parameters]);
    await client.query('release savepoint attempt');
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (cause) {
    await client.query('rollback to savepoint attempt');
    return { refused: (cause as { code?: string }).code ?? 'UNKNOWN' };
  }
}

/**
 * A confirmed email identity with no `members` row, as the OWNER: the account
 * a verified signup holds before `create_organization`. Its address is an
 * email identity's (never `.shift.invalid`), as a signup's would be.
 */
async function claimlessAccount(client: Client): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `claimless-${id}@example.com`;
  await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change, email_change_token_new
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
       extensions.crypt('claimless-account-password', extensions.gen_salt('bf', 4)), now(),
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')), '{}'::jsonb,
       now(), now(), '', '', '', ''
     )`,
    [id, email],
  );
  return { id, email };
}

/** Become the claimless session: a token with a subject and no `organization_id`. */
async function actAs(client: Client, authUserId: string): Promise<void> {
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({ sub: authUserId, role: 'authenticated' }),
  ]);
  await client.query('set local role authenticated');
}

async function actAsOwner(client: Client): Promise<void> {
  await client.query('reset role');
}

/**
 * Every row count the sweep could change, as the owner: public, private,
 * Storage and Auth. The live-API cases leave Auth's own logs out (GoTrue
 * writes its audit log and sessions on every admin call and grant) and count
 * `auth.users` alone.
 */
async function snapshot(client: Client, schemas: readonly string[] = ['public', 'private', 'storage', 'auth']): Promise<Record<string, number>> {
  const { rows: tables } = await client.query<{ name: string }>(
    `select format('%I.%I', n.nspname, c.relname) as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and (n.nspname = any($1::text[]) or (n.nspname = 'auth' and c.relname = 'users'))
        and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      order by 1`,
    [[...schemas]],
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from ${name}`);
    counts[name] = rows[0]?.n ?? -1;
  }
  return counts;
}

interface Relation {
  readonly name: string;
  readonly kind: string;
  readonly firstColumn: string | null;
}

/** Every table and view in `public` but an extension's, as the owner. */
async function publicRelations(client: Client): Promise<Relation[]> {
  const { rows } = await client.query<{ name: string; kind: string; first: string | null }>(
    `select c.relname as name, c.relkind::text as kind,
            (select a.attname from pg_attribute a
              where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
              order by a.attnum limit 1) as first
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      order by 1`,
  );
  return rows.map((row) => ({ name: row.name, kind: row.kind, firstColumn: row.first }));
}

/**
 * The public tables the migrations create and do not drop, read from their
 * source (the scaffold's reading, kept small here): the floor for the
 * catalog's count, so the sweep cannot quietly read fewer.
 */
function migratedPublicTables(): Set<string> {
  const directory = join(repoRoot, 'supabase', 'migrations');
  const tables = new Set<string>();
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    const text = readFileSync(join(directory, file), 'utf8').replace(/--[^\n]*/g, '');
    for (const match of text.matchAll(/\b(create|drop) table (?:if (?:not )?exists )?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?(?=[\s(;])/gi)) {
      const [, verb = '', name = ''] = match;
      if (/^(private|storage|auth)$/i.test(name)) continue;
      if (verb.toLowerCase() === 'create') tables.add(name.toLowerCase());
      else tables.delete(name.toLowerCase());
    }
  }
  return tables;
}

/**
 * How a write by the claimless session may end and still count as refused:
 * SQLSTATE 42501 (no privilege, or a row-level-security refusal), or zero rows
 * (RLS filtering silently). Every other ending is an offence to read, not to
 * excuse. A view or a materialized view also refuses by not being writable at
 * all (55000, 0A000, 42809).
 */
function refusedWrite(
  relation: Relation,
  verb: 'insert' | 'update' | 'delete',
  answer: { rows: unknown[]; rowCount: number } | { refused: string },
): string | null {
  if ('refused' in answer) {
    if (answer.refused === '42501') return null;
    if (relation.kind !== 'r' && relation.kind !== 'p' && ['55000', '0A000', '42809'].includes(answer.refused)) return null;
    return `${relation.name}: ${verb} ended ${answer.refused}, not 42501`;
  }
  return answer.rowCount === 0 ? null : `${relation.name}: ${verb} changed ${String(answer.rowCount)} rows`;
}

interface Callable {
  readonly name: string;
  readonly types: readonly string[];
  /** `pg_type.typtype` of each argument: `b` base, `c` composite (a table's row), `e` enum, ... */
  readonly kinds: readonly string[];
  readonly names: readonly string[];
}

/** Every function in `public` that `authenticated` may execute, but an extension's or a trigger's. */
async function executableFunctions(client: Client): Promise<Callable[]> {
  const { rows } = await client.query<{
    name: string;
    types: string[];
    kinds: string[];
    names: string[] | null;
    modes: string[] | null;
    count: number;
  }>(
    `select p.proname as name,
            array(select pg_catalog.format_type(t, null) from unnest(p.proargtypes) with ordinality as u(t, i) order by i) as types,
            array(select (case when ty.typcategory = 'A' then 'a' else ty.typtype::text end)
                    from unnest(p.proargtypes) with ordinality as u(t, i) join pg_type ty on ty.oid = u.t order by i) as kinds,
            p.proargnames as names,
            p.proargmodes::text[] as modes,
            p.pronargs::int as count
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
        and pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by 1, 6`,
  );
  return rows.map((row) => {
    const all = row.names ?? [];
    const names =
      row.modes === null ? all.slice(0, row.count) : all.filter((_, index) => ['i', 'b', 'v'].includes(row.modes?.[index] ?? 'i'));
    return { name: row.name, types: row.types, kinds: row.kinds, names: row.types.map((_, index) => names[index] ?? '') };
  });
}

/**
 * Where a uuid argument's real id comes from: by the function's name, then
 * the parameter's, the first rule that matches. A parameter no rule names,
 * or a table the seed holds no pilot row of (it holds no leave requests,
 * leave records, swap requests, loans or conflict resolutions, and none is
 * built here: owner-built scenes only), is NOT exercised and is counted so.
 */
const ID_SOURCES: readonly (readonly [RegExp | null, RegExp, string])[] = [
  [/roster_override/, /^p_override_id$/, 'roster_overrides'],
  [/shift_type_override/, /^p_override_id$/, 'shift_type_overrides'],
  [/swap_request/, /^p_request_id$/, 'swap_requests'],
  [/leave_request/, /^p_request_id$/, 'leave_requests'],
  [null, /^p_record_id$/, 'leave_records'],
  [null, /^p_loan_id$/, 'team_loans'],
  [null, /^p_absence_type_id$/, 'absence_types'],
  [null, /^p_resolution_id$/, 'conflict_resolutions'],
  [null, /^(p_)?organization$/, 'organizations'],
  [null, /^(p_)?shift_type(_id)?$/, 'shift_types'],
  [null, /^(p_)?team(_id)?$/, 'teams'],
  [null, /^(p_)?pattern(_id)?$/, 'rotation_patterns'],
  [null, /^(member|p_member_id|p_member_in_id|p_replacement_id|p_proposer|p_addressee)$/, 'members'],
];

/** A real pilot id for a uuid argument, as the owner, and whether one was found. */
async function realId(client: Client, callable: string, parameter: string, organization: string): Promise<{ id: string; real: boolean }> {
  const source = ID_SOURCES.find(([name, parameterPattern]) => (name === null || name.test(callable)) && parameterPattern.test(parameter))?.[2];
  if (source === undefined) return { id: randomUUID(), real: false };
  const sql =
    source === 'organizations'
      ? 'select id::text from public.organizations where id = $1'
      : `select id::text from public.${source} where organization_id = $1 order by id limit 1`;
  const answer = await attempt<{ id: string }>(client, sql, [organization]);
  const found = 'rows' in answer ? answer.rows[0]?.id : undefined;
  return found === undefined ? { id: randomUUID(), real: false } : { id: found, real: true };
}

/** The same value on both calls for every base argument that names no row. */
const SAMPLE: Readonly<Record<string, string>> = {
  text: 'claimless-probe',
  date: '2026-09-14',
  integer: '1',
  smallint: '1',
  bigint: '1',
  boolean: 'true',
  jsonb: '{}',
  json: '{}',
  numeric: '1',
  'time without time zone': '07:00',
  'timestamp with time zone': '2026-09-14T07:00:00Z',
  daterange: '[2026-09-14,2026-09-15)',
};

/**
 * The functions the sweep may not call, each with its reason. An argument it
 * cannot build (an enum, an array, an interval, any base type with no sample)
 * makes a function unswept, and an unswept function not named here fails the
 * sweep. Empty today: no executable function takes such an argument.
 */
const UNSWEPT_ALLOWED: Readonly<Record<string, string>> = {};

/** Why a function cannot be swept, or `null`. */
function unsweepable(callable: Callable): string | null {
  for (const [index, type] of callable.types.entries()) {
    if (type === 'uuid' || callable.kinds[index] === 'c') continue;
    if (callable.kinds[index] === 'b' && SAMPLE[type] !== undefined) continue;
    if (type === 'daterange') continue;
    return `argument ${String(index + 1)} is ${type} (${callable.kinds[index] ?? '?'})`;
  }
  return null;
}

interface Arguments {
  readonly values: (string | null)[];
  /** How many uuid arguments named a real pilot row. */
  readonly realIds: number;
}

/**
 * Each argument as a typed literal. A uuid is a real pilot id, or one that
 * exists nowhere; a row argument (a computed relationship's) is the pilot's
 * real row on both calls, so that function is held to answering nothing at
 * all; every other argument is the same sample on both calls.
 */
async function argumentsFor(client: Client, callable: Callable, organization: string, real: boolean): Promise<Arguments> {
  const values: (string | null)[] = [];
  let realIds = 0;
  for (const [index, type] of callable.types.entries()) {
    const parameter = callable.names[index] ?? '';
    if (type === 'uuid') {
      if (!real) {
        values.push(randomUUID());
        continue;
      }
      const found = await realId(client, callable.name, parameter, organization);
      if (found.real) realIds += 1;
      values.push(found.id);
    } else if (callable.kinds[index] === 'c') {
      const table = type.replace(/^public\./, '');
      const filter = table === 'organizations' ? 'r.id = $1' : 'r.organization_id = $1';
      const row = await attempt<{ row: string }>(client, `select r::text as row from public."${table}" r where ${filter} limit 1`, [organization]);
      values.push('rows' in row ? (row.rows[0]?.row ?? null) : null);
    } else {
      values.push(SAMPLE[type] ?? null);
    }
  }
  return { values, realIds };
}

/** An answer that says nothing: a refusal, no row, or only nulls. */
function saysNothing(answer: string): boolean {
  if (answer.startsWith('refused ')) return true;
  const rows = JSON.parse(answer) as unknown[];
  return rows.every((row) => row === null || (typeof row === 'string' && /^\(,*\)$/.test(row)));
}

/** One call as the session: its refusal code, or its rows as text. */
async function call(client: Client, callable: Callable, values: readonly (string | null)[]): Promise<string> {
  const placeholders = callable.types.map((type, index) => `$${String(index + 1)}::${type}`).join(', ');
  const answer = await attempt<{ answer: unknown }>(
    client,
    `select coalesce(pg_catalog.jsonb_agg(r::text), '[]'::jsonb) as answer from public."${callable.name}"(${placeholders}) as r`,
    values,
  );
  return 'refused' in answer ? `refused ${answer.refused}` : JSON.stringify(answer.rows[0]?.answer ?? null);
}

// ------------------------------------------------------------------ the suite

describe('a confirmed account with no organization reads and writes nothing (story 19.1, AD-10)', () => {
  it.skipIf(noDatabase)('reads zero rows from every table and view in public, and every write is refused or changes nothing', async () => {
    await inRolledBackTransaction(async (client) => {
      // THE SCENE, AS THE OWNER, before any actAs.
      const account = await claimlessAccount(client);
      const relations = await publicRelations(client);
      const before = await snapshot(client);
      const migrated = migratedPublicTables();
      const tables = relations.filter(({ kind }) => kind === 'r' || kind === 'p').map(({ name }) => name);
      expect(migrated.size, 'the migrations were not read').toBeGreaterThan(25);
      expect([...migrated].filter((name) => !tables.includes(name)), 'a migrated table is missing from the sweep').toEqual([]);
      expect(before['public.members'] ?? 0, 'the fixtures must be loaded, or zero rows proves nothing').toBeGreaterThan(0);

      await actAs(client, account.id);
      const offences: string[] = [];
      for (const relation of relations) {
        const read = await attempt<{ n: number }>(client, `select count(*)::int as n from public."${relation.name}"`);
        if ('rows' in read && (read.rows[0]?.n ?? 0) !== 0) offences.push(`${relation.name}: reads ${String(read.rows[0]?.n)} rows`);
        if ('refused' in read && read.refused !== '42501') offences.push(`${relation.name}: a read ended ${read.refused}, not 42501`);

        const inserted = refusedWrite(relation, 'insert', await attempt(client, `insert into public."${relation.name}" default values`));
        if (inserted !== null) offences.push(inserted);
        if (relation.firstColumn !== null) {
          const column = relation.firstColumn;
          const updated = refusedWrite(relation, 'update', await attempt(client, `update public."${relation.name}" set "${column}" = "${column}"`));
          if (updated !== null) offences.push(updated);
        }
        const deleted = refusedWrite(relation, 'delete', await attempt(client, `delete from public."${relation.name}"`));
        if (deleted !== null) offences.push(deleted);
      }
      // The claim is what every policy reads: the session has none.
      const claim = await attempt<{ claim: string | null }>(client, `select (select auth.jwt()) ->> 'organization_id' as claim`);
      expect('rows' in claim ? claim.rows[0]?.claim : 'refused').toBeNull();
      const access = await attempt<{ n: number }>(client, 'select count(*)::int as n from public.current_member_access()');
      expect('rows' in access ? access.rows[0]?.n : -1, 'current_member_access names an access').toBe(0);

      await actAsOwner(client);
      expect(offences).toEqual([]);
      expect(await snapshot(client), 'a write as the claimless account landed').toEqual(before);
    }, 'repeatable read');
  });

  it.skipIf(noDatabase)('gets the same answer from every function it may execute whether the pilot’s ids exist or not', async () => {
    await inRolledBackTransaction(async (client) => {
      // THE SCENE, AS THE OWNER: the account, the catalog, the real ids.
      const account = await claimlessAccount(client);
      const organization = await organizationId(client, PILOT.slug);
      const all = (await executableFunctions(client)).filter(({ name }) => !ALLOWED_TO_SUCCEED.has(name));
      expect(all.length, 'too few functions were read for the sweep to mean anything').toBeGreaterThan(30);
      const unswept = all
        .map((callable) => ({ callable, reason: unsweepable(callable) }))
        .filter(({ reason }) => reason !== null)
        .map(({ callable, reason }) => `${callable.name}: ${reason ?? ''}`);
      expect(
        unswept.filter((entry) => !(entry.slice(0, entry.indexOf(':')) in UNSWEPT_ALLOWED)),
        'a function the sweep cannot call is not named, with its reason, in UNSWEPT_ALLOWED',
      ).toEqual([]);
      const functions = all.filter((callable) => unsweepable(callable) === null);
      const calls: { callable: Callable; real: Arguments; absent: Arguments }[] = [];
      for (const callable of functions) {
        calls.push({
          callable,
          real: await argumentsFor(client, callable, organization, true),
          absent: await argumentsFor(client, callable, organization, false),
        });
      }
      // Non-vacuity, counted only where a real pilot row was found: enough
      // uuid arguments, and enough functions called with at least one.
      const realIds = calls.reduce((sum, { real }) => sum + real.realIds, 0);
      const exercised = calls.filter(({ real }) => real.realIds > 0).map(({ callable }) => callable.name);
      expect(realIds, 'too few uuid arguments named a real pilot row').toBeGreaterThanOrEqual(20);
      expect(new Set(exercised).size, `too few functions were called with a real id: ${exercised.join(', ')}`).toBeGreaterThanOrEqual(15);
      const before = await snapshot(client);

      await actAs(client, account.id);
      const differing: string[] = [];
      for (const { callable, real, absent } of calls) {
        const signature = `${callable.name}(${callable.types.join(', ')})`;
        const withReal = await call(client, callable, real.values);
        if (!callable.types.includes('uuid')) {
          // No id to vary (the readers take none): it must answer nothing.
          if (!saysNothing(withReal)) differing.push(`${signature}: answered ${withReal}`);
          continue;
        }
        const withAbsent = await call(client, callable, absent.values);
        if (withReal !== withAbsent) differing.push(`${signature}: ${withReal} ≠ ${withAbsent}`);
      }

      await actAsOwner(client);
      expect(differing, 'a function answered a claimless account from a row it cannot claim').toEqual([]);
      expect(await snapshot(client), 'a function wrote as the claimless account').toEqual(before);
    }, 'repeatable read');
  });

  it.skipIf(noDatabase)('reads no Storage object or bucket, and cannot write a logo', async () => {
    await inRolledBackTransaction(async (client) => {
      const account = await claimlessAccount(client);
      const organization = await organizationId(client, PILOT.slug);
      const before = await snapshot(client);

      await actAs(client, account.id);
      const objects = await attempt<{ n: number }>(client, 'select count(*)::int as n from storage.objects');
      const buckets = await attempt<{ n: number }>(client, 'select count(*)::int as n from storage.buckets');
      const written = await attempt(
        client,
        `insert into storage.objects (bucket_id, name, owner) values ('organization-logos', $1, $2::uuid)`,
        [`${organization}/claimless.png`, account.id],
      );

      await actAsOwner(client);
      expect('rows' in objects ? objects.rows[0]?.n : 0).toBe(0);
      expect('rows' in buckets ? buckets.rows[0]?.n : 0).toBe(0);
      // 42501 (the logo policies refuse a claimless writer), or nothing written.
      expect(
        refusedWrite({ name: 'storage.objects', kind: 'r', firstColumn: null }, 'insert', written),
        'a claimless account wrote a logo',
      ).toBeNull();
      expect(await snapshot(client)).toEqual(before);
    }, 'repeatable read');
  });
});

describe('the switch and the before-user-created hook (story 19.1, AD-21)', () => {
  it.skipIf(noDatabase)('holds the switch where no session role reaches it, closed by default', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ role: string; privileged: boolean }>(
        `select r as role,
                pg_catalog.has_table_privilege(r, 'private.signup_settings', 'select')
             or pg_catalog.has_table_privilege(r, 'private.signup_settings', 'insert')
             or pg_catalog.has_table_privilege(r, 'private.signup_settings', 'update')
             or pg_catalog.has_table_privilege(r, 'private.signup_settings', 'delete')
             or pg_catalog.has_table_privilege(r, 'private.signup_settings', 'truncate') as privileged
           from unnest(array['anon', 'authenticated', 'service_role']) as r`,
      );
      expect(rows).toEqual([
        { role: 'anon', privileged: false },
        { role: 'authenticated', privileged: false },
        { role: 'service_role', privileged: false },
      ]);
      const { rows: shape } = await client.query<{ rls: boolean; openDefault: string; rowsHeld: number }>(
        `select c.relrowsecurity as rls,
                (select column_default from information_schema.columns
                  where table_schema = 'private' and table_name = 'signup_settings' and column_name = 'open') as "openDefault",
                (select count(*)::int from private.signup_settings) as "rowsHeld"
           from pg_class c where c.oid = 'private.signup_settings'::regclass`,
      );
      expect(shape).toEqual([{ rls: true, openDefault: 'false', rowsHeld: 1 }]);
      // A second row cannot exist.
      await client.query('begin');
      const second = await attempt(client, 'insert into private.signup_settings (id) values (false)');
      await client.query('rollback');
      expect(second).toEqual({ refused: '23514' });
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('lets the auth service alone execute the hook', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ role: string; executes: boolean }>(
        `select r as role, pg_catalog.has_function_privilege(r, 'public.before_user_created_hook(jsonb)', 'execute') as executes
           from unnest(array['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) as r`,
      );
      expect(rows).toEqual([
        { role: 'anon', executes: false },
        { role: 'authenticated', executes: false },
        { role: 'service_role', executes: false },
        { role: 'supabase_auth_admin', executes: true },
      ]);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('decides an address’s kind in SQL exactly as the vector file does (AD-12)', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ address: string; kind: string; synthesized: boolean }>(
        `select v.address, private.address_kind(v.address) as kind, private.is_synthesized_address(v.address) as synthesized
           from unnest($1::text[]) with ordinality as v(address, i) order by v.i`,
        [VECTORS.map(({ address }) => address)],
      );
      expect(rows.map(({ kind }) => kind)).toEqual(VECTORS.map(({ kind }) => kind));
      expect(rows.map(({ synthesized }) => synthesized)).toEqual(VECTORS.map(({ kind }) => kind === 'synthesized'));
      const { rows: nothing } = await client.query<{ kind: string }>('select private.address_kind(null) as kind');
      expect(nothing).toEqual([{ kind: 'malformed' }]);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('refuses a closed door, a synthesized, malformed or unusable address and the ceiling with one answer, and writes nothing', async () => {
    await inRolledBackTransaction(async (client) => {
      const hook = async (email: string | null): Promise<unknown> => {
        const { rows } = await client.query<{ answer: unknown }>(
          `select public.before_user_created_hook(jsonb_build_object(
                    'metadata', jsonb_build_object('uuid', gen_random_uuid(), 'name', 'before-user-created'),
                    'user', jsonb_build_object('email', $1::text))) as answer`,
          [email],
        );
        return rows[0]?.answer;
      };
      // THE SCENE, AS THE OWNER (the hook runs as its owner; no actAs here).
      await client.query('update private.signup_settings set open = true, accounts_per_day = 100000 where id');
      const before = await snapshot(client);

      expect(await hook('nova.organizacija@example.com')).toEqual({});
      expect(await hook('Nova.Organizacija@Example.COM')).toEqual({});
      for (const address of ['ana@dvd-kastel-novi.shift.invalid', 'ana@SHIFT.INVALID.', 'ana', 'ana@@example.com', '"a"@example.com', 'a b@example.com', '', null]) {
        expect(await hook(address), JSON.stringify(address)).toEqual(SIGNUP_REFUSED);
      }
      // Review 2: the username half the ASCII cases above never reach. A
      // local part `lower()` would still change fails `members_username_check`
      // (0007) at founding, so the hook refuses it; which letters `lower()`
      // changes is this database's locale, so the expectation is read from it.
      const { rows: folds } = await client.query<{ changes: boolean }>(`select 'Ána' <> lower('Ána') as changes`);
      expect(await hook('Ána@example.com'), 'a non-ASCII capital in the local part').toEqual(
        folds[0]?.changes === true ? SIGNUP_REFUSED : {},
      );

      await client.query('update private.signup_settings set open = false where id');
      expect(await hook('nova.organizacija@example.com'), 'a closed door').toEqual(SIGNUP_REFUSED);

      // D4: the ceiling counts accounts with no members row created in the last 24 hours.
      await client.query('update private.signup_settings set open = true where id');
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from auth.users u
          where u.created_at > now() - interval '24 hours'
            and not exists (select 1 from public.members m where m.auth_user_id = u.id)`,
      );
      const recent = rows[0]?.n ?? 0;
      await client.query('update private.signup_settings set accounts_per_day = $1 where id', [recent + 1]);
      expect(await hook('nova.organizacija@example.com'), 'one below the ceiling').toEqual({});
      await claimlessAccount(client);
      expect(await hook('nova.organizacija@example.com'), 'at the ceiling').toEqual(SIGNUP_REFUSED);

      const after = await snapshot(client);
      // The one account this case created itself, and nothing else.
      expect({ ...after, 'auth.users': (after['auth.users'] ?? 0) - 1 }).toEqual(before);
    }, 'repeatable read');
  });
});

// ------------------------------------------------- the live API (GoTrue, functions)

/** The privileged client `admin-auth` is given, over GoTrue's admin API (as `test/rls-isolation.test.ts`). */
function privilegedOverAdminApi(): PrivilegedAccounts {
  const endpoint = apiEndpoint;
  const key = adminKey;
  if (endpoint === undefined || key === undefined) throw new Error('unreachable: gated by skipIf');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const fieldsOf = (body: unknown): Record<string, unknown> =>
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return {
    auth: {
      getUser: async (jwt: string) => {
        const response = await fetch(`${endpoint.url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` } });
        const fields = fieldsOf(await response.json());
        return response.ok ? { data: { user: { id: fields['id'] } }, error: null } : { data: { user: null }, error: { status: response.status } };
      },
      admin: {
        createUser: () => Promise.reject(new Error('a claimless caller must not create an account')),
        deleteUser: () => Promise.reject(new Error('a claimless caller must not delete an account')),
        updateUserById: async (id: string, attributes: Readonly<Record<string, unknown>>) => {
          const response = await fetch(`${endpoint.url}/auth/v1/admin/users/${id}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(attributes),
          });
          const fields = fieldsOf(await response.json());
          return response.ok ? { data: { user: { id: fields['id'] } }, error: null } : { data: null, error: { status: response.status } };
        },
      },
    },
  } as unknown as PrivilegedAccounts;
}

/** The caller's client `admin-auth` is given: PostgREST with the claimless token. */
function callerOver(token: string): CallerClient {
  const endpoint = apiEndpoint;
  if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');
  const headers = { apikey: endpoint.key, Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const settle = async (response: Response): Promise<PostgrestAnswer> => {
    const body: unknown = await response.json();
    if (response.ok) return { data: body, error: null };
    const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    return { data: null, error: { code: typeof fields['code'] === 'string' ? fields['code'] : String(response.status) } };
  };
  return {
    rpc: async (name: string) => settle(await fetch(`${endpoint.url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: '{}' })),
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          limit: async (count: number) =>
            settle(await fetch(`${endpoint.url}/rest/v1/${table}?select=${columns}&${column}=eq.${value}&limit=${String(count)}`, { headers })),
        }),
      }),
      insert: () => ({ select: () => Promise.reject(new Error('a claimless caller must not insert')) }),
      update: () => ({ eq: () => ({ select: () => Promise.reject(new Error('a claimless caller must not update')) }) }),
    }),
  } as unknown as CallerClient;
}

/** What the live-API cases count: everything but GoTrue's own logs and sessions. */
const LIVE_SCHEMAS = ['public', 'private', 'storage'] as const;

/** The Edge Functions under `supabase/functions/`, each a directory with a handler. */
const EDGE_FUNCTIONS = readdirSync(join(repoRoot, 'supabase', 'functions'))
  .filter((entry) => !entry.startsWith('_') && !entry.startsWith('.'))
  .filter((entry) => statSync(join(repoRoot, 'supabase', 'functions', entry)).isDirectory())
  .sort();

describe('a claimless session at the API (story 19.1, AD-10, AD-16)', () => {
  /** A confirmed email identity with no members row, made the way GoTrue makes one, signed in. */
  async function claimlessSession(): Promise<{ id: string; token: string; address: string }> {
    const endpoint = apiEndpoint;
    const key = adminKey;
    if (endpoint === undefined || key === undefined) throw new Error('unreachable: gated by skipIf');
    const address = `claimless-${randomUUID()}@example.com`;
    const password = `claimless-${randomUUID()}`;
    const created = await fetch(`${endpoint.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: address, password, email_confirm: true }),
    });
    const user = (await created.json()) as Record<string, unknown>;
    expect(created.status, JSON.stringify(user)).toBe(200);
    const granted = await fetch(`${endpoint.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: endpoint.key, 'content-type': 'application/json' },
      body: JSON.stringify({ email: address, password }),
    });
    const session = (await granted.json()) as Record<string, unknown>;
    expect(granted.status, JSON.stringify(session)).toBe(200);
    return { id: String(user['id']), token: String(session['access_token']), address };
  }

  async function removeAccount(id: string): Promise<void> {
    const client = await connect();
    try {
      await client.query('delete from auth.users where id = $1', [id]);
    } finally {
      await client.end();
    }
  }

  it.skipIf(noAdminApi)('carries no organization claim, and every Edge Function gives it nothing but its own flag', async () => {
    const session = await claimlessSession();
    const client = await connect();
    try {
      const claims = JSON.parse(Buffer.from(session.token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
      expect(claims['organization_id']).toBeUndefined();
      expect(claims['sub']).toBe(session.id);

      const organization = await organizationId(client, PILOT.slug);
      const { rows: targets } = await client.query<{ id: string }>(
        'select id from public.members where organization_id = $1 order by id limit 1',
        [organization],
      );
      const target = targets[0]?.id ?? randomUUID();
      const before = await snapshot(client, LIVE_SCHEMAS);

      // Every function, enumerated from the tree: a new one fails here until it is called below.
      const CALLS: Record<string, () => Promise<void>> = {
        'admin-auth': async () => {
          const privileged = privilegedOverAdminApi();
          const caller = callerOver(session.token);
          expect(
            await createUser(
              { privileged, caller },
              { organizationId: organization, name: 'Bez Organizacije', username: 'bez-organizacije', email: null, role: 'member_role', leaveAllowanceDays: 20 },
            ),
          ).toEqual({ status: 403, body: { code: NOT_AN_ADMIN } });
          expect(await updateUserById({ privileged, caller }, { memberId: target, username: 'preimenovan' })).toEqual({
            status: 404,
            body: { code: MEMBER_UNKNOWN },
          });
          expect(await resetPassword({ privileged, caller }, { memberId: target })).toEqual({ status: 404, body: { code: MEMBER_UNKNOWN } });
          // E2: harmless. It clears the caller's own flag and nothing else.
          expect(await clearMustSetPassword({ privileged }, `Bearer ${session.token}`)).toEqual({
            status: 200,
            body: { code: PASSWORD_FLAG_CLEARED },
          });
          const { rows } = await client.query<{ flag: unknown }>(
            `select raw_app_meta_data -> $2 as flag from auth.users where id = $1`,
            [session.id, MUST_SET_PASSWORD],
          );
          expect(rows).toEqual([{ flag: false }]);
        },
        notify: async () => {
          // The session's own token is no invoke secret: refused before any client exists.
          const handle = createNotifyHandler(
            readNotifyConfiguration((name) =>
              ({
                SUPABASE_URL: 'http://127.0.0.1:54321',
                SHIFT_SECRET_KEY: 'sb_secret_claimless_probe',
                NOTIFY_INVOKE_SECRET: 'i'.repeat(48),
                RESEND_API_KEY: 're_test',
                NOTIFY_EMAIL_FROM: 'Shift <obavijesti@example.org>',
                SHIFT_APP_URL: 'https://shift.example.org',
                VAPID_PUBLIC_KEY: `B${'a'.repeat(86)}`,
                VAPID_PRIVATE_KEY: 'p'.repeat(43),
                VAPID_SUBJECT: 'mailto:obavijesti@example.org',
              })[name],
            ),
            {
              makeClient: () => {
                throw new Error('notify built a client for a claimless session');
              },
              fetch: () => Promise.reject(new Error('notify sent something for a claimless session')),
            } as unknown as Parameters<typeof createNotifyHandler>[1],
          );
          const response = await handle(
            new Request('http://localhost/functions/v1/notify', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } }),
          );
          expect(response.status).toBe(401);
          expect(await response.json()).toMatchObject({ code: INVOKE_SECRET_REFUSED });
        },
      };
      expect(Object.keys(CALLS).sort(), 'an Edge Function is not swept as a claimless session').toEqual(EDGE_FUNCTIONS);
      for (const name of EDGE_FUNCTIONS) await CALLS[name]?.();

      // Nothing changed but the caller's own app_metadata, which no count sees.
      expect(await snapshot(client, LIVE_SCHEMAS)).toEqual(before);
    } finally {
      await client.end();
      await removeAccount(session.id);
    }
  }, 60_000);

  it.skipIf(noAdminApi)('cannot upload a logo into any organization’s folder', async () => {
    const endpoint = apiEndpoint;
    if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');
    const session = await claimlessSession();
    const client = await connect();
    try {
      const organization = await organizationId(client, PILOT.slug);
      const response = await fetch(`${endpoint.url}/storage/v1/object/organization-logos/${organization}/claimless.png`, {
        method: 'POST',
        headers: { apikey: endpoint.key, Authorization: `Bearer ${session.token}`, 'content-type': 'image/png' },
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      });
      expect(response.status, await response.clone().text()).toBeGreaterThanOrEqual(400);
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from storage.objects where bucket_id = 'organization-logos' and name = $1`,
        [`${organization}/claimless.png`],
      );
      expect(rows).toEqual([{ n: 0 }]);
    } finally {
      await client.end();
      await removeAccount(session.id);
    }
  }, 30_000);

  it.skipIf(noAdminApi)('creates a username identity through POST /admin/users with the hook on, which the hook would refuse (A6)', async () => {
    // The hook refuses every synthesized address (0066). The admin API
    // creating one proves GoTrue does not run the hook there, so `admin-auth`
    // and the operator script are unaffected.
    const endpoint = apiEndpoint;
    const key = adminKey;
    if (endpoint === undefined || key === undefined) throw new Error('unreachable: gated by skipIf');
    const address = `claimless-${randomUUID().slice(0, 8)}@${PILOT.slug}.shift.invalid`;
    const created = await fetch(`${endpoint.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: address, password: `claimless-${randomUUID()}`, email_confirm: true }),
    });
    const body = (await created.json()) as Record<string, unknown>;
    try {
      expect(created.status, JSON.stringify(body)).toBe(200);
      expect(body['email']).toBe(address);
    } finally {
      if (typeof body['id'] === 'string') await removeAccount(body['id']);
    }
  }, 30_000);

  it.skipIf(noAdminApi)('refuses a synthesized address at /signup through the hook, and creates nothing', async () => {
    // The CLI's GoTrue, not Kong (the CLI's Kong has no allow-list, AD-22):
    // this is the hook's refusal, which Kong masks on a deployed stack.
    const endpoint = apiEndpoint;
    if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');
    const address = `claimless-${randomUUID().slice(0, 8)}@${PILOT.slug}.shift.invalid`;
    const response = await fetch(`${endpoint.url}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: endpoint.key, 'content-type': 'application/json' },
      body: JSON.stringify({ email: address, password: `claimless-${randomUUID()}` }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(403);
    expect(JSON.stringify(body)).toContain('SIGNUP_REFUSED');
    const client = await connect();
    try {
      const { rows } = await client.query<{ n: number }>('select count(*)::int as n from auth.users where email = $1', [address]);
      expect(rows).toEqual([{ n: 0 }]);
    } finally {
      await client.end();
    }
  }, 30_000);
});
