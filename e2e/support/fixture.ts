import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type pg from 'pg';

import { connect } from './database.ts';

/**
 * THE PER-RUN ORGANIZATION.
 *
 * The local Supabase stack is shared by the main checkout and every worktree, so
 * an E2E run never writes to the seeded organizations. It provisions its own
 * throwaway tenant, `e2e-<runId>`, through the operator script — the one way a
 * tenant comes into existence — and every test writes inside it. Row level
 * security is what makes that tenant invisible to everyone else, which is the
 * product's core guarantee anyway.
 *
 * Teardown deletes the organization (every domain table cascades from it) and
 * then the auth users, which do not cascade: the cascade runs from `auth.users`
 * to `members`, not the other way. Every address this run issues — the operator
 * script's, the seed recipe's below and the Edge Function's for a member created
 * through the UI — is `<username>@<slug>.shift.invalid`, so the domain reaches
 * all of them.
 */

export const SLUG_PREFIX = 'e2e-';

/** A stale run is one that crashed before its teardown. Younger ones may be a
 *  concurrent run in another worktree, and are kept. */
export const STALE_AFTER = '1 hour';

const AUTH_DIRECTORY = fileURLToPath(new URL('../.auth/', import.meta.url));

export const FIXTURE_FILE = `${AUTH_DIRECTORY}fixture.json`;
export const ADMIN_STATE = `${AUTH_DIRECTORY}admin.json`;
export const MEMBER_STATE = `${AUTH_DIRECTORY}member.json`;

const OPERATOR_SCRIPT = fileURLToPath(
  new URL('../../supabase/operator/provision-organization.sql', import.meta.url),
);

export interface FixturePerson {
  readonly name: string;
  readonly username: string;
}

export interface FixtureBand {
  readonly name: string;
  readonly start: string;
}

/** What the tests may read. Everything here is read-only for them: a test that
 *  writes creates its own rows. */
export interface Fixture {
  readonly runId: string;
  readonly slug: string;
  readonly password: string;
  /** The operator script's first admin. */
  readonly admin: FixturePerson;
  /** A member-role account on `team`; its session is the stored member state. */
  readonly member: FixturePerson;
  /** A member-role account on no team. Signs in and out through the UI (a
   *  sign-out revokes every session of its account, so it is never the stored
   *  one). */
  readonly spare: FixturePerson;
  readonly team: { readonly id: string; readonly name: string };
  readonly bands: readonly FixtureBand[];
}

/** Timestamp + random: two worktrees starting in the same millisecond still
 *  get different organizations. Lowercase alphanumerics only, so the slug
 *  satisfies `0002`'s check. */
function newRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function addressDomain(slug: string): string {
  return `${slug}.shift.invalid`;
}

/** `LIKE` treats `_` and `%` as wildcards; a slug holds neither, but the
 *  pattern is escaped anyway so the delete can only ever reach this run. */
export function literal(pattern: string): string {
  return pattern.replace(/[\\%_]/g, (character) => `\\${character}`);
}

async function parameterize(client: pg.Client, values: Readonly<Record<string, string>>) {
  for (const [name, value] of Object.entries(values)) {
    // `is_local` true: the settings end with the transaction below.
    await client.query('select set_config($1, $2, true)', [`shift.${name}`, value]);
  }
}

/** The seed recipe (`supabase/seed.sql`): an auth user, its identity and its
 *  member row, `'{}'` user metadata and the four empty-string token columns. */
async function insertMember(
  client: pg.Client,
  organizationId: string,
  slug: string,
  person: FixturePerson,
  password: string,
): Promise<{ memberId: string; authUserId: string }> {
  const address = `${person.username}@${addressDomain(slug)}`;
  const { rows } = await client.query<{ id: string }>(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change, email_change_token_new
     ) values (
       '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       $1, extensions.crypt($2, extensions.gen_salt('bf', 10)), now(),
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
       '{}'::jsonb, now(), now(), '', '', '', ''
     )
     returning id`,
    [address, password],
  );
  const authUserId = rows[0]?.id;
  if (authUserId === undefined) throw new Error('auth.users insert returned no row');

  await client.query(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
     values ($1::text, $1::uuid,
             jsonb_build_object('sub', $1::text, 'email', $2::text,
                                'email_verified', true, 'phone_verified', false),
             'email', now(), now())`,
    [authUserId, address],
  );

  const member = await client.query<{ id: string }>(
    `insert into members (organization_id, auth_user_id, name, username, email, role, leave_allowance_days)
     values ($1, $2, $3, $4, null, 'member_role', 20)
     returning id`,
    [organizationId, authUserId, person.name, person.username],
  );
  const memberId = member.rows[0]?.id;
  if (memberId === undefined) throw new Error('members insert returned no row');

  return { memberId, authUserId };
}

/** Provisions this run's organization and its read-only fixture, in ONE
 *  transaction: either all of it exists afterwards or none of it does. */
export async function provision(): Promise<Fixture> {
  const runId = newRunId();
  const slug = `${SLUG_PREFIX}${runId}`;
  const password = randomBytes(18).toString('base64url');
  const admin: FixturePerson = { name: 'Ema Admin', username: 'e2e.admin' };
  const member: FixturePerson = { name: 'Lana Članica', username: 'e2e.clanica' };
  const spare: FixturePerson = { name: 'Toni Bezsmjene', username: 'e2e.bezsmjene' };
  const teamName = 'Smjena Alfa';
  const bands: FixtureBand[] = [
    { name: 'Dan', start: '07:00' },
    { name: 'Noć', start: '19:00' },
  ];

  const client = await connect();
  let committed = false;
  try {
    await client.query('begin');

    await parameterize(client, {
      organization_slug: slug,
      organization_name: `E2E ${runId}`,
      organization_type: 'E2E',
      organization_timezone: 'Europe/Zagreb',
      organization_locale: 'hr',
      leave_year_start_month: '1',
      leave_year_start_day: '1',
      admin_name: admin.name,
      admin_username: admin.username,
      admin_password: password,
      admin_leave_allowance_days: '20',
    });
    await client.query(readFileSync(OPERATOR_SCRIPT, 'utf8'));

    const created = await client.query<{ organization_id: string; admin_user: string }>(
      `select o.id as organization_id, m.auth_user_id as admin_user
         from organizations o
         join members m on m.organization_id = o.id and m.role = 'admin'
        where o.slug = $1`,
      [slug],
    );
    const organization = created.rows[0];
    if (organization === undefined) throw new Error(`the operator script provisioned no ${slug}`);

    const onTeam = await insertMember(client, organization.organization_id, slug, member, password);
    await insertMember(client, organization.organization_id, slug, spare, password);

    // `created_by` is written because its default is `auth.uid()`, which is
    // null on this connection; the admin is who an operator acts for here.
    const team = await client.query<{ id: string }>(
      `insert into teams (organization_id, name, created_by) values ($1, $2, $3) returning id`,
      [organization.organization_id, teamName, organization.admin_user],
    );
    const teamId = team.rows[0]?.id;
    if (teamId === undefined) throw new Error('teams insert returned no row');

    await client.query(
      `insert into team_membership_versions (organization_id, member_id, team_id, effective_from, created_by)
       values ($1, $2, $3, public.organization_today($1), $4)`,
      [organization.organization_id, onTeam.memberId, teamId, organization.admin_user],
    );

    for (const band of bands) {
      await client.query(
        'insert into hour_bands (organization_id, name, start_time) values ($1, $2, $3::time)',
        [organization.organization_id, band.name, band.start],
      );
    }

    await client.query('commit');
    committed = true;

    const fixture: Fixture = {
      runId,
      slug,
      password,
      admin,
      member,
      spare,
      team: { id: teamId, name: teamName },
      bands,
    };
    mkdirSync(dirname(FIXTURE_FILE), { recursive: true });
    writeFileSync(FIXTURE_FILE, `${JSON.stringify(fixture, null, 2)}\n`);

    return fixture;
  } catch (cause) {
    // Before the commit a rollback undoes everything. After it — the fixture
    // file could not be written — the organization exists and nothing would
    // name it to teardown, so it is deleted here instead of leaking for an hour.
    if (committed) await deleteOrganization(client, slug).catch(() => undefined);
    else await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    await client.end();
  }
}

/** Deletes one organization and every auth user under its address domain. */
async function deleteOrganization(client: pg.Client, slug: string): Promise<void> {
  await client.query('delete from organizations where slug = $1', [slug]);
  await client.query(`delete from auth.users where email like $1 escape '\\'`, [
    `%@${literal(addressDomain(slug))}`,
  ]);
}

/** Refuses anything but a slug-shaped prefix, so neither a delete nor a sweep
 *  can be widened into a wildcard. */
function requirePrefix(prefix: string): void {
  if (!/^[a-z0-9]+-$/.test(prefix)) throw new Error(`refusing ${prefix}: not a slug prefix`);
}

/**
 * This run's teardown: the organization (every domain table cascades) and every
 * auth user under its address domain. The prefix is a parameter only so
 * `test/e2e-fixture.test.ts` can exercise it on a prefix of its own.
 */
export async function teardown(slug: string, prefix: string = SLUG_PREFIX): Promise<void> {
  requirePrefix(prefix);
  if (!slug.startsWith(prefix)) throw new Error(`refusing to delete ${slug}: not a ${prefix} slug`);

  const client = await connect();
  try {
    await deleteOrganization(client, slug);
  } finally {
    await client.end();
  }
}

/**
 * Removes what a crashed run left behind: `e2e-%` organizations older than an
 * hour, and auth users under an `e2e-` address domain older than an hour whose
 * organization is already gone. A younger organization may be a concurrent run
 * in another worktree, so it is never touched.
 */
export async function sweepStale(prefix: string = SLUG_PREFIX): Promise<void> {
  // The prefix is a parameter only so `test/e2e-fixture.test.ts` can exercise
  // the sweep on a prefix of its own, never on a live run's organizations.
  requirePrefix(prefix);

  const client = await connect();
  try {
    const { rows } = await client.query<{ slug: string }>(
      `select slug from organizations
        where slug like $1 escape '\\' and created_at < now() - $2::interval`,
      [`${literal(prefix)}%`, STALE_AFTER],
    );
    for (const { slug } of rows) await deleteOrganization(client, slug);

    await client.query(
      `delete from auth.users u
        where u.email like $1 escape '\\'
          and u.created_at < now() - $2::interval
          and not exists (
            select 1 from organizations o
             where u.email like ('%@' || o.slug || '.shift.invalid')
          )`,
      [`%@${literal(prefix)}%.shift.invalid`, STALE_AFTER],
    );
  } finally {
    await client.end();
  }
}

const FIXTURE_UNREADABLE =
  `E2E: ${FIXTURE_FILE} is missing, stale or incomplete. It is written by ` +
  'globalSetup for the run in progress; run the suite with `pnpm test:e2e`.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isPerson(value: unknown): value is FixturePerson {
  return isRecord(value) && isText(value['name']) && isText(value['username']);
}

function isFixture(value: unknown): value is Fixture {
  if (!isRecord(value)) return false;
  const team = value['team'];
  const bands = value['bands'];

  return (
    isText(value['runId']) &&
    isText(value['slug']) &&
    value['slug'].startsWith(SLUG_PREFIX) &&
    isText(value['password']) &&
    isPerson(value['admin']) &&
    isPerson(value['member']) &&
    isPerson(value['spare']) &&
    isRecord(team) &&
    isText(team['id']) &&
    isText(team['name']) &&
    Array.isArray(bands) &&
    bands.length > 0 &&
    bands.every((band) => isRecord(band) && isText(band['name']) && isText(band['start']))
  );
}

/** The fixture globalSetup wrote, for a spec or a setup project. Read lazily,
 *  inside a test, so `playwright test --list` works without a run. */
export function readFixture(): Fixture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'));
  } catch (cause) {
    throw new Error(FIXTURE_UNREADABLE, { cause });
  }
  if (!isFixture(parsed)) throw new Error(FIXTURE_UNREADABLE);

  return parsed;
}

/** The slug of the run globalSetup provisioned, if it wrote one — read
 *  leniently, so a partial file still gets its organization deleted. */
export function readRunSlug(): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8'));
    const slug = isRecord(parsed) ? parsed['slug'] : null;

    return isText(slug) && slug.startsWith(SLUG_PREFIX) ? slug : null;
  } catch {
    return null;
  }
}

/** Forgets this run's stored sessions and facts, so a later run can never sign
 *  in with an account that no longer exists. */
export function forgetRun(): void {
  rmSync(AUTH_DIRECTORY, { recursive: true, force: true });
}
