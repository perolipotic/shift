import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import type pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { connect, requireAdminAuth, requireStack } from '../e2e/support/database.ts';
import { STALE_AFTER, literal, sweepStale, teardown } from '../e2e/support/fixture.ts';

/**
 * The E2E lifecycle's edge rows (`spec-e2e-smoke-suite.md`, I/O matrix): a
 * crashed run's organization is swept after an hour and a younger one is kept,
 * a run's teardown leaves nothing behind, and a run without the stack stops
 * before any test, naming what to start.
 *
 * Everything here runs on a prefix of this run's own, `e2efixture<tag>-`, never
 * on `e2e-`: a live E2E run in another worktree owns those organizations, and
 * this file must not be able to reach them — nor another run of this file.
 * Everything it writes carries that prefix, and `afterAll` removes all of it.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const runTag = randomBytes(4).toString('hex');
const PREFIX = `e2efixture${runTag}-`;

/** Nothing listens on port 1, so a connection is refused at once. */
const UNREACHABLE_DATABASE = 'postgresql://postgres:postgres@127.0.0.1:1/postgres';
const UNREACHABLE_API = 'http://127.0.0.1:1';

async function reachable(): Promise<boolean> {
  try {
    await requireStack();
    return true;
  } catch {
    return false;
  }
}

const noDatabase = !(await reachable());

async function insertOrganization(client: pg.Client, slug: string, age: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into organizations (
       slug, name, organization_type, timezone, locale,
       leave_year_start_month, leave_year_start_day, created_at
     ) values ($1, $1, 'Fixture Type', 'UTC', 'en', 1, 1, now() - $2::interval)
     returning id`,
    [slug, age],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('organizations insert returned no row');
  return id;
}

/** Only what the table needs: these accounts never authenticate. */
async function insertAuthUser(client: pg.Client, email: string, age: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into auth.users (id, email, created_at) values (gen_random_uuid(), $1, now() - $2::interval)
     returning id`,
    [email, age],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('auth.users insert returned no row');
  return id;
}

async function slugsLike(client: pg.Client, pattern: string): Promise<string[]> {
  const { rows } = await client.query<{ slug: string }>(
    `select slug from organizations where slug like $1 escape '\\' order by slug`,
    [pattern],
  );
  return rows.map((row) => row.slug);
}

async function emailsLike(client: pg.Client, pattern: string): Promise<string[]> {
  const { rows } = await client.query<{ email: string }>(
    `select email from auth.users where email like $1 escape '\\' order by email`,
    [pattern],
  );
  return rows.map((row) => row.email);
}

afterAll(async () => {
  if (noDatabase) return;
  const client = await connect();
  try {
    await client.query(`delete from organizations where slug like $1 escape '\\'`, [
      `${literal(PREFIX)}%`,
    ]);
    await client.query(`delete from auth.users where email like $1 escape '\\'`, [
      `%@${literal(PREFIX)}%`,
    ]);
  } finally {
    await client.end();
  }
});

describe('the E2E stale sweep', () => {
  it('uses one hour as the stale age', () => {
    expect(STALE_AFTER).toBe('1 hour');
  });

  it.skipIf(noDatabase)(
    'deletes an organization older than an hour with its auth users, and keeps a younger one',
    async () => {
      const stale = `${PREFIX}stale`;
      const young = `${PREFIX}young`;
      const orphan = `${PREFIX}orphan`;
      const freshOrphan = `${PREFIX}fresh`;

      const client = await connect();
      try {
        await insertOrganization(client, stale, '2 hours');
        await insertAuthUser(client, `admin@${stale}.shift.invalid`, '2 hours');
        // A younger organization may be a concurrent run in another worktree.
        await insertOrganization(client, young, '30 minutes');
        await insertAuthUser(client, `admin@${young}.shift.invalid`, '2 hours');
        // An old account whose organization is already gone: a crash between
        // the two deletes of a teardown.
        await insertAuthUser(client, `admin@${orphan}.shift.invalid`, '2 hours');
        // A young one with no organization yet is left alone.
        await insertAuthUser(client, `admin@${freshOrphan}.shift.invalid`, '5 minutes');

        await sweepStale(PREFIX);

        expect(await slugsLike(client, `${literal(PREFIX)}%`)).toEqual([young]);
        expect(await emailsLike(client, `%@${literal(PREFIX)}%`)).toEqual([
          `admin@${freshOrphan}.shift.invalid`,
          `admin@${young}.shift.invalid`,
        ]);
      } finally {
        await client.end();
      }
    },
  );

  it('refuses a prefix that is not a slug prefix', async () => {
    await expect(sweepStale('%')).rejects.toThrow(/not a slug prefix/);
  });
});

describe('the E2E teardown', () => {
  it.skipIf(noDatabase)(
    'deletes the organization, its members and every auth user under its domain',
    async () => {
      const slug = `${PREFIX}teardown`;
      const domain = `${slug}.shift.invalid`;

      const client = await connect();
      try {
        const organization = await insertOrganization(client, slug, '0 minutes');
        const admin = await insertAuthUser(client, `admin@${domain}`, '0 minutes');
        await client.query(
          `insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
           values ($1, $2, 'Teardown Admin', 'admin', 'admin', 0)`,
          [organization, admin],
        );
        // The way the admin-auth function's `createUser` leaves an account:
        // the provider in the app metadata and `'{}'` user metadata.
        await client.query(
          `insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
           values (gen_random_uuid(), $1,
                   jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
                   '{}'::jsonb)`,
          [`created@${domain}`],
        );

        await teardown(slug, PREFIX);

        expect(await slugsLike(client, literal(slug))).toEqual([]);
        expect(await emailsLike(client, `%@${literal(domain)}`)).toEqual([]);
        const members = await client.query<{ remaining: number }>(
          'select count(*)::int as remaining from members where organization_id = $1',
          [organization],
        );
        expect(members.rows[0]?.remaining).toBe(0);
      } finally {
        await client.end();
      }
    },
  );

  it('refuses a slug outside the E2E prefix', async () => {
    await expect(teardown('not-e2e-anything')).rejects.toThrow(/refusing to delete/);
  });

  it('refuses a prefix that is not a slug prefix', async () => {
    await expect(teardown('e2e-anything', '%')).rejects.toThrow(/not a slug prefix/);
  });
});

describe('an E2E run without the stack', () => {
  const withoutStack = { ...process.env, SUPABASE_DB_URL: UNREACHABLE_DATABASE };

  function failureOf(args: readonly string[]): { status: number | null; stderr: string } {
    try {
      execFileSync(process.execPath, args, { cwd: repoRoot, env: withoutStack, encoding: 'utf8', stdio: 'pipe' });
      return { status: 0, stderr: '' };
    } catch (error) {
      const failed = error as { status: number | null; stderr: string };
      return { status: failed.status, stderr: failed.stderr };
    }
  }

  it('fails the stack check with a message naming supabase start', async () => {
    await expect(requireStack(UNREACHABLE_DATABASE)).rejects.toThrow(/supabase start/);
  });

  it.skipIf(noDatabase)('fails the stack check when GoTrue is not reachable', async () => {
    await expect(requireStack(undefined, UNREACHABLE_API)).rejects.toThrow(/GoTrue.*supabase start/);
  });

  it('fails the function check with a message naming supabase functions serve', async () => {
    await expect(requireAdminAuth(UNREACHABLE_API)).rejects.toThrow(/supabase functions serve/);
  });

  it('stops the web server command before `supabase functions serve`', () => {
    const { status, stderr } = failureOf(['e2e/support/require-stack.ts']);

    expect(status).toBe(1);
    expect(stderr).toContain('supabase start');
    expect(stderr).toContain(UNREACHABLE_DATABASE);
  });

  it('fails globalSetup before it sweeps or provisions anything', () => {
    const { status, stderr } = failureOf([
      '--input-type=module',
      '--eval',
      "import globalSetup from './e2e/global-setup.ts'; await globalSetup();",
    ]);

    expect(status).not.toBe(0);
    expect(stderr).toContain('supabase start');
  });
});
