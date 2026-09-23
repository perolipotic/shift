import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ACCESS_UNREADABLE,
  NOT_AN_ADMIN,
} from '../supabase/functions/admin-auth/authorize.ts';
import {
  MEMBER_UNKNOWN,
  PASSWORD_RESET,
  resetPassword,
  type CallerClient,
  type PostgrestAnswer,
  type PrivilegedAccounts,
} from '../supabase/functions/admin-auth/operations.ts';

/**
 * Q1 and Q2, executed rather than read — and the regression suite every later
 * epic re-runs.
 *
 * `supabase/migrations/0003_access_control.sql` is the only place isolation and
 * role are enforced: AD-9 leaves no server tier, so every domain write goes
 * through PostgREST under those policies and there is exactly one point at
 * which a refusal can happen. "Refused identically through the interface and
 * through a direct API call" is therefore not two assertions — it is one, made
 * here, against the same HTTP path the interface uses.
 *
 * Two harnesses, because one of them cannot see everything:
 *
 *   1. THROUGH POSTGREST WITH A REAL TOKEN. A fixture credential is exchanged
 *      at `/auth/v1/token?grant_type=password` and the resulting ES256 token is
 *      used for real `/rest/v1` calls. This is the shipped path, it is the
 *      literal reading of "a direct API call bypassing the interface", and it
 *      needs no browser (Q9). No test here constructs or signs a token: the
 *      keys are asymmetric and forging one is not an option.
 *   2. WITH CLAIMS INJECTED IN A TRANSACTION. `set_config('request.jwt.claims',
 *      …, true)` followed by `set local role authenticated` is what
 *      `auth.uid()`, `auth.jwt()` and every policy actually read. It isolates
 *      policy behaviour from token issuance, so a broken hook fails the hook's
 *      own cases instead of failing every policy case at once while saying
 *      nothing about the policies.
 *
 * Nothing here asserts security on a bare `postgres` connection. `postgres` is
 * BYPASSRLS, so an un-roled read is empty of meaning: it would pass against no
 * policy at all. Every security assertion below either carries a token or has
 * done `set local role authenticated` first.
 *
 * A database-less checkout reports every case as SKIPPED, never as green having
 * asserted nothing — the rule `test/static-hosting.test.ts:12-15` sets, and the
 * reason `it.skipIf` is used rather than an early `return`. The consequence is
 * that this file is not load-bearing until something runs it with a database
 * attached; that is on the deferred ledger.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * The Supabase CLI's fixed local default. Read from the environment when set,
 * so no credential for any other database is written down here.
 */
const databaseUrl =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Whether there is a database here with this schema in it.
 *
 * The schema check is not decoration. `test/provisioning.test.ts` probes
 * TCP and authentication only, and the deferred ledger indicts it for exactly
 * that: `supabase db reset` ends by restarting containers, and in that window
 * Postgres accepts connections while no migration has been applied, so every
 * case fails with `relation "organizations" does not exist` instead of
 * skipping. This file is the suite every later epic re-runs, so it asks the
 * question the ledger proposes — connected AND migrated, or not ready.
 */
async function reachable(): Promise<boolean> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    const { rows } = await client.query<{ migrated: boolean }>(
      `select to_regclass('public.organizations') is not null
                and to_regclass('public.members') is not null as migrated`,
    );
    await client.end();
    return rows[0]?.migrated === true;
  } catch {
    await client.end().catch(() => undefined);
    return false;
  }
}

/**
 * A sanctioned module-scope await: `skipIf` is evaluated at collection time, so
 * the answer has to exist before the first `it` is registered.
 */
const noDatabase = !(await reachable());

/**
 * The local API endpoint and the key needed to reach it, or `undefined`.
 *
 * Same derivation as `test/provisioning.test.ts:65-83`, and for the same
 * reasons: the publishable key is generated per stack, so hard-coding one would
 * both rot and put a key in a tracked file. Spawned once, here, never inside a
 * test.
 */
const apiEndpoint: { readonly url: string; readonly key: string } | undefined = (() => {
  if (noDatabase) return undefined;
  try {
    const status = execFileSync(
      join(repoRoot, 'node_modules', '.bin', 'supabase'),
      ['status', '-o', 'json'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const parsed: unknown = JSON.parse(status);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const fields = parsed as Record<string, unknown>;
    const key = fields['PUBLISHABLE_KEY'] ?? fields['ANON_KEY'];
    const url = fields['API_URL'] ?? 'http://127.0.0.1:54321';
    if (typeof key !== 'string' || typeof url !== 'string') return undefined;
    return { url, key };
  } catch {
    return undefined;
  }
})();

/**
 * The SECRET key for the local stack, or `undefined`.
 *
 * Read from the same `supabase status -o json` the publishable key comes from,
 * and used by every block that drives GoTrue's ADMIN API the way `admin-auth`
 * drives it: the one that proves an issued account can sign in, and the four
 * that prove an admin-issued reset replaces the credential and ends the
 * sessions it had. It is a per-stack local value that never leaves this
 * machine — AD-17 confines the DEPLOYED secret to the Edge Function's
 * environment, and this reads the one `supabase start` just printed rather
 * than hard-coding anything.
 *
 * TWO SPELLINGS ARE READ because the CLI has used both, which is the same
 * reason the guard below insists this resolved: a third rename would leave
 * every case named above skipping silently while the run reported green.
 */
const adminKey: string | undefined = (() => {
  if (noDatabase) return undefined;
  try {
    const status = execFileSync(
      join(repoRoot, 'node_modules', '.bin', 'supabase'),
      ['status', '-o', 'json'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const parsed: unknown = JSON.parse(status);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const fields = parsed as Record<string, unknown>;
    const key = fields['SECRET_KEY'] ?? fields['SERVICE_ROLE_KEY'];
    return typeof key === 'string' && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
})();

/** Every case that leaves the database and speaks HTTP is gated on both. */
const noApi = noDatabase || apiEndpoint === undefined;
/** The five blocks that also need the admin API — the issued-account case and
 *  the four reset cases, which are the whole verification of the revocation. */
const noAdminApi = noApi || adminKey === undefined;

/** `supabase/seed.sql:27` — one password, shared, local and test only. */
const FIXTURE_PASSWORD = 'local-fixture-password';

/**
 * The two fixtures every rule is asserted against (AD-15, Q10), and the three
 * accounts each case needs: the organization's own admin, a member-role account
 * to attempt an administrative write as, and a second member-role account to
 * attempt it *on* — so a refusal has both a subject and a bystander.
 *
 * Accounts are named by username rather than by display name: the username is
 * the local part of the synthesized sign-in address (AD-12), which is the one
 * key that reaches both GoTrue and the domain tables.
 */
const FIXTURES = [
  {
    fixture: 'pilot',
    slug: 'dvd-kastel-novi',
    admin: 'ivan.maric',
    member: 'ana.kovac',
    bystander: 'marko.novak',
  },
  {
    fixture: 'UJ-5',
    slug: 'zastita-split',
    admin: 'josip.peric',
    member: 'lucija.simic',
    bystander: 'tomislav.juric',
  },
] as const;

/**
 * Each fixture paired with the other one — the tenant it must never reach.
 *
 * Generated rather than written out, so neither direction can be the one
 * somebody forgets: a policy that leaked in exactly one direction would pass a
 * hand-written pair and fail this.
 */
const CROSS_TENANT = FIXTURES.flatMap((self) =>
  FIXTURES.filter((other) => other.slug !== self.slug).map((other) => ({
    fixture: self.fixture,
    slug: self.slug,
    admin: self.admin,
    member: self.member,
    otherFixture: other.fixture,
    otherSlug: other.slug,
  })),
);

/** Both fixtures against both readable tables. */
const OWN_ORGANIZATION_READS = FIXTURES.flatMap((entry) =>
  (['organizations', 'members'] as const).map((table) => ({ ...entry, table })),
);

/** Name and address prefix for rows this file creates outside a transaction. */
const THROWAWAY = 'rls-isolation-test';

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

/** Run `work` in a transaction that is always rolled back. */
async function inRolledBackTransaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    await client.query('begin');
    return await work(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end();
  }
}

interface Refusal {
  readonly code: string;
  readonly message: string;
}

/**
 * Assert that `work` is refused, and hand back what the database raised.
 *
 * Copied from `test/provisioning.test.ts:124-148` for the reason stated there:
 * a refusal case that only asserts "it threw" passes when the schema breaks in
 * a different way — a typo in a column name throws too. Here it matters twice
 * over, because the refusal this file is about has a specific SQLSTATE and a
 * different failure would still be a throw.
 */
/**
 * `refused`, for a case that still has work to do afterwards.
 *
 * A raised error aborts the whole transaction, so every statement after it —
 * including the `reset role` that lets the assertion re-read the row as the
 * owner — fails with "current transaction is aborted". Taking a savepoint first
 * and rolling back to it clears that state and leaves the injected claims and
 * the `set local role` in place, because both were set before the savepoint.
 *
 * Use it wherever a refusal has to be followed by a re-read; plain `refused` is
 * still right when asserting the raised code is the whole case.
 */
async function refusedThenContinue(
  client: Client,
  work: () => Promise<unknown>,
): Promise<Refusal> {
  await client.query('savepoint refusal_probe');
  try {
    return await refused(work);
  } finally {
    await client.query('rollback to savepoint refusal_probe').catch(() => undefined);
  }
}

async function refused(work: () => Promise<unknown>): Promise<Refusal> {
  try {
    await work();
  } catch (cause) {
    const error = cause as { code?: string; message?: string };
    return { code: error.code ?? '', message: error.message ?? '' };
  }
  throw new Error('nothing was refused: the statement was permitted');
}

// ------------------------------------------------------------------- identity

/** AD-12: the non-routable synthesized address a credential is issued against. */
function address(username: string, slug: string): string {
  return `${username}@${slug}.shift.invalid`;
}

/**
 * The claims carried by a token, decoded and not verified.
 *
 * Verification is GoTrue's and PostgREST's job and this file has no key to do
 * it with — which is the point: the assertions below are about what the hook
 * put in the payload, and every assertion that depends on the signature being
 * good is made by issuing a real request instead.
 */
function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (payload === undefined) throw new Error('not a three-part token');
  const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new Error('the token payload is not an object');
  }
  return decoded as Record<string, unknown>;
}

/** Exchange a fixture credential for a real ES256 token. */
async function tokenFor(username: string, slug: string): Promise<string> {
  const endpoint = apiEndpoint;
  if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

  const response = await fetch(`${endpoint.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: endpoint.key, 'content-type': 'application/json' },
    body: JSON.stringify({ email: address(username, slug), password: FIXTURE_PASSWORD }),
  });
  const body: unknown = await response.json();
  const token =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)['access_token']
      : undefined;

  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(
      `${address(username, slug)} could not sign in: ${response.status} ${JSON.stringify(body)}. ` +
        `If every credential case failed at once, check FIXTURE_PASSWORD against supabase/seed.sql — ` +
        `it is duplicated here as a literal and a drift presents as a 400 on every case rather than as itself.`,
    );
  }
  return token;
}

interface RestCall {
  /** Omitted for an anonymous call, which carries the publishable key only. */
  readonly token?: string;
  readonly method?: string;
  readonly body?: Readonly<Record<string, unknown>>;
  /**
   * PostgREST's `Prefer` header, for the one case that needs `count=exact`.
   *
   * Story 1.5a: `apps/web/src/members/list.ts` asks for an exact count and
   * refuses an answer shorter than it claims, so the whole truncation defence
   * rests on PostgREST actually reporting one. supabase-js sends this header for
   * `select(columns, { count: 'exact' })`, and this is what lets a case here ask
   * the same question of the real service.
   */
  readonly prefer?: string;
}

/** One real PostgREST request — the same transport the SPA uses. */
async function rest(path: string, call: RestCall = {}): Promise<Response> {
  const endpoint = apiEndpoint;
  if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

  const headers: Record<string, string> = { apikey: endpoint.key };
  if (call.token !== undefined) headers['Authorization'] = `Bearer ${call.token}`;
  if (call.body !== undefined) headers['content-type'] = 'application/json';
  if (call.prefer !== undefined) headers['Prefer'] = call.prefer;

  return fetch(`${endpoint.url}/rest/v1/${path}`, {
    method: call.method ?? 'GET',
    headers,
    ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
  });
}

/** The rows a real read returns, or a failure naming the status that came back. */
async function restRows(
  path: string,
  call: RestCall = {},
): Promise<readonly Record<string, unknown>[]> {
  const response = await rest(path, call);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new Error(`GET ${path} did not return rows: ${response.status} ${JSON.stringify(body)}`);
  }
  return body as readonly Record<string, unknown>[];
}

/** The `{ code, message }` PostgREST answers a refused write with. */
async function restRefusal(response: Response): Promise<Refusal> {
  const body: unknown = await response.json();
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return {
    code: typeof fields['code'] === 'string' ? fields['code'] : '',
    message: typeof fields['message'] === 'string' ? fields['message'] : '',
  };
}

// --------------------------------------------------------------------- storage

/**
 * The private bucket `0005` creates, and the one object inside each
 * organization's own folder.
 *
 * Written out here rather than imported from `apps/web`: this file asserts what
 * the DATABASE does, and reading the constants from the client would make a
 * renamed bucket agree with itself on both sides while every existing object
 * became unreachable.
 */
const LOGO_BUCKET = 'organization-logos';
const LOGO_OBJECT = 'logo';

/** Where an organization's logo lives. The first segment is the isolation. */
function logoPath(organization: string): string {
  return `${organization}/${LOGO_OBJECT}`;
}

/** A one-pixel PNG. The smallest thing the bucket's allowlist accepts. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface StorageCall {
  /** Omitted for an anonymous call, which carries the publishable key only. */
  readonly token?: string;
  readonly method?: string;
  readonly body?: Buffer;
  readonly contentType?: string;
  readonly json?: Readonly<Record<string, unknown>>;
}

/**
 * One real storage request — the sibling of {@link rest}, and it has to be one.
 *
 * `rest` hardcodes `/rest/v1/`, which is PostgREST's mount point and not the
 * storage service's: the two are different processes behind the same gateway,
 * they authenticate the same token, and only one of them has ever been reached
 * from this file. Q4 is about the other one.
 */
async function storageApi(path: string, call: StorageCall = {}): Promise<Response> {
  const endpoint = apiEndpoint;
  if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

  const headers: Record<string, string> = { apikey: endpoint.key };
  if (call.token !== undefined) headers['Authorization'] = `Bearer ${call.token}`;
  if (call.contentType !== undefined) headers['content-type'] = call.contentType;
  if (call.json !== undefined) headers['content-type'] = 'application/json';
  // Always upsert: replacing a logo is an upsert of the same key, and without
  // the header the second write of a case is refused as a duplicate rather than
  // exercising the update policy this story wrote.
  headers['x-upsert'] = 'true';

  return fetch(`${endpoint.url}/storage/v1/${path}`, {
    method: call.method ?? 'GET',
    headers,
    ...(call.json === undefined ? {} : { body: JSON.stringify(call.json) }),
    ...(call.body === undefined ? {} : { body: call.body }),
  });
}

/** Write an object, as whoever the token names — or as nobody at all. */
async function putLogo(token: string | undefined, objectPath: string): Promise<Response> {
  return storageApi(`object/${LOGO_BUCKET}/${objectPath}`, {
    ...(token === undefined ? {} : { token }),
    method: 'POST',
    body: ONE_PIXEL_PNG,
    contentType: 'image/png',
  });
}

/** Ask for a signed read URL — the call the surface makes to render a logo. */
async function signLogo(token: string | undefined, objectPath: string): Promise<Response> {
  return storageApi(`object/sign/${LOGO_BUCKET}/${objectPath}`, {
    ...(token === undefined ? {} : { token }),
    method: 'POST',
    json: { expiresIn: 60 },
  });
}

/** Ask for the bytes themselves. */
async function downloadLogo(token: string | undefined, objectPath: string): Promise<Response> {
  return storageApi(`object/${LOGO_BUCKET}/${objectPath}`, {
    ...(token === undefined ? {} : { token }),
  });
}

/**
 * The storage service's own refusal, which is NOT shaped like PostgREST's.
 *
 * Every refusal arrives as HTTP 400 and the distinction lives in the body's
 * `statusCode` — `403` for a policy, `404` for an object the caller may not
 * see, `413` for the size bound, `415` for the type allowlist. Reading
 * `response.status` would make all four the same fact.
 */
async function storageRefusal(response: Response): Promise<Refusal> {
  const body: unknown = await response.json();
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return {
    code: typeof fields['statusCode'] === 'string' ? fields['statusCode'] : '',
    message: typeof fields['message'] === 'string' ? fields['message'] : '',
  };
}

/** Every object under one organization's folder, read as the owner so RLS hides
 *  nothing — the storage twin of {@link organizationById}. */
async function logoObjects(client: Client, organization: string): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `select name from storage.objects
      where bucket_id = $1 and (storage.foldername(name))[1] = $2
      order by name`,
    [LOGO_BUCKET, organization],
  );
  return rows.map((row) => row.name);
}

/**
 * Remove whatever a case wrote. Owner-side, because no DELETE policy exists.
 *
 * `storage.allow_delete_query` is the storage schema's own guard against
 * orphaning objects by deleting their rows out from under the files, and it
 * raises 42501 for everybody — the owner included — until it is set. Set
 * LOCALLY, so it lasts one statement's transaction and never becomes a property
 * of the connection.
 */
async function removeLogoObjects(client: Client, organization: string): Promise<void> {
  await client.query('begin');
  try {
    await client.query("set local storage.allow_delete_query = 'true'");
    await client.query(
      `delete from storage.objects
        where bucket_id = $1 and (storage.foldername(name))[1] = $2`,
      [LOGO_BUCKET, organization],
    );
    await client.query('update organizations set logo_path = null where id = $1', [organization]);
    await client.query('commit');
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  }
}

// ----------------------------------------------------------- claims injection

/**
 * Become an authenticated caller inside the current transaction.
 *
 * `request.jwt.claims` is what `auth.uid()` and `auth.jwt()` read, and
 * `set local role authenticated` is what makes row level security apply at all
 * — without it the connection stays `postgres`, which is BYPASSRLS and proves
 * nothing. Passing `null` for the organization omits the claim entirely, which
 * is what a session minted before the hook existed looks like.
 */
async function actAs(
  client: Client,
  authUserId: string,
  organization: string | null,
): Promise<void> {
  const claims =
    organization === null
      ? { sub: authUserId, role: 'authenticated' }
      : { sub: authUserId, role: 'authenticated', organization_id: organization };
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify(claims),
  ]);
  await client.query('set local role authenticated');
}

/**
 * Both tables in one statement, so neither policy's active clause is unwatched.
 *
 * Module scope because two describe blocks need it: the freshness cases, and
 * the case covering the caller's own member row being deleted.
 */
async function visibleToSession(client: Client): Promise<{ members: number; organizations: number }> {
  const { rows } = await client.query<{ members: number; organizations: number }>(
    `select (select count(*)::int from members) as members,
            (select count(*)::int from organizations) as organizations`,
  );
  const counted = rows[0];
  if (counted === undefined) throw new Error('the count query returned no row');
  return counted;
}

/** Back to the connection's own role, so the next read can see the truth. */
async function actAsOwner(client: Client): Promise<void> {
  await client.query('reset role');
}

// --------------------------------------------------------------- db lookups

interface MemberRow {
  readonly id: string;
  readonly authUserId: string;
  readonly organizationId: string;
  readonly role: string;
  readonly leaveAllowanceDays: number;
}

async function organizationId(client: Client, slug: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'select id from organizations where slug = $1',
    [slug],
  );
  const found = rows[0];
  if (found === undefined) throw new Error(`seed fixture ${slug} is not in the database`);
  return found.id;
}

/**
 * One fixture member, found through the address its credential was issued
 * against — the only key that reaches both `auth.users` and `members`.
 */
async function memberByUsername(
  client: Client,
  slug: string,
  username: string,
): Promise<MemberRow> {
  const { rows } = await client.query<MemberRow>(
    `select m.id,
            m.auth_user_id as "authUserId",
            m.organization_id as "organizationId",
            m.role,
            m.leave_allowance_days as "leaveAllowanceDays"
       from members m
       join auth.users u on u.id = m.auth_user_id
      where u.email = $1`,
    [address(username, slug)],
  );
  const found = rows[0];
  if (found === undefined) throw new Error(`no member for ${address(username, slug)}`);
  return found;
}

/** The same row, re-read as the connection's own role, so RLS hides nothing. */
async function memberById(client: Client, id: string): Promise<MemberRow | undefined> {
  const { rows } = await client.query<MemberRow>(
    `select id,
            auth_user_id as "authUserId",
            organization_id as "organizationId",
            role,
            leave_allowance_days as "leaveAllowanceDays"
       from members where id = $1`,
    [id],
  );
  return rows[0];
}

interface OrganizationRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly organizationType: string;
  readonly timezone: string;
  readonly leaveYearStartMonth: number;
  readonly leaveYearStartDay: number;
  /** `0006`. A KEY and never a colour — null is "no accent", which is where
   *  both fixtures start and what every case below restores them to. */
  readonly brandAccent: string | null;
}

/**
 * One organization row, re-read as the connection's own role so RLS hides
 * nothing — the `organizations` twin of `memberById`, added by story 1.4a.
 *
 * It is what every write case below reads through, and it has to be an OWNER
 * read rather than a session one: a policy that refused the write AND the read
 * would make "the row did not change" true for the wrong reason, which is the
 * shape this file distinguishes everywhere else.
 */
async function organizationById(
  client: Client,
  id: string,
): Promise<OrganizationRow | undefined> {
  const { rows } = await client.query<OrganizationRow>(
    `select id,
            slug,
            name,
            organization_type as "organizationType",
            timezone,
            leave_year_start_month as "leaveYearStartMonth",
            leave_year_start_day as "leaveYearStartDay",
            brand_accent as "brandAccent"
       from organizations where id = $1`,
    [id],
  );
  return rows[0];
}

/**
 * A disposable member-role row in `organization`, so a destructive case has
 * something to be destructive to.
 *
 * Every write case that could succeed if a policy were wrong aims at one of
 * these rather than at a fixture account, so a regression turns a case red
 * instead of quietly editing the fixtures every other suite reads. Its address
 * is derived from its own id, so no two of them can collide.
 *
 * The row is built to the same shape `supabase/seed.sql:88-118` gives a real
 * account even though it never authenticates, because it is committed into a
 * *seeded* organization and `test/provisioning.test.ts` health-checks every
 * account in those organizations. Carrying only `(id, email)` left
 * `confirmation_token`, `recovery_token`, `email_change` and
 * `email_change_token_new` null and created no `auth.identities` row, which
 * made `'leaves every $fixture account able to sign in'` fail with
 * `nullTokens = 1` and `identities != accounts` for as long as a throwaway
 * existed — reproduced during the 1.3a review. `fileParallelism: false` now
 * keeps the two files apart, but this shape is what stops a throwaway left
 * behind by a skipped `afterAll` from failing the next run for a reason that
 * has nothing to do with what broke.
 */
async function addThrowawayMember(client: Client, organization: string): Promise<MemberRow> {
  const { rows: created } = await client.query<{ id: string }>(
    `with generated as (select gen_random_uuid() as id)
     insert into auth.users (
       instance_id, id, aud, role, email, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change, email_change_token_new
     )
     select '00000000-0000-0000-0000-000000000000',
            generated.id,
            'authenticated',
            'authenticated',
            generated.id::text || '@' || $1,
            now(),
            jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
            '{}'::jsonb,
            now(),
            now(),
            '', '', '', ''
       from generated
     returning id`,
    [`${THROWAWAY}.shift.invalid`],
  );
  const account = created[0];
  if (account === undefined) throw new Error('auth.users insert returned no row');

  // One identity per account, carrying this account's own sub and email:
  // `recipeHealth` asserts both, and a password grant resolves through
  // `auth.identities` rather than `auth.users.email`.
  await client.query(
    `insert into auth.identities (
       provider_id, user_id, identity_data, provider, created_at, updated_at
     )
     select $1::uuid::text,
            $1::uuid,
            jsonb_build_object(
              'sub', $1::uuid::text,
              'email', u.email,
              'email_verified', true,
              'phone_verified', false
            ),
            'email',
            now(),
            now()
       from auth.users u
      where u.id = $1::uuid`,
    [account.id],
  );

  const { rows } = await client.query<{ id: string }>(
    `insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
     values ($1, $2::uuid, $3, $2::uuid::text, 'member_role', 20)
     returning id`,
    [organization, account.id, `${THROWAWAY} target`],
  );
  const member = rows[0];
  if (member === undefined) throw new Error('members insert returned no row');

  return {
    id: member.id,
    authUserId: account.id,
    organizationId: organization,
    role: 'member_role',
    leaveAllowanceDays: 20,
  };
}

afterAll(async () => {
  if (noDatabase) return;
  const client = await connect();
  try {
    // The members rows cascade from auth.users, and every address this file
    // issues carries the throwaway domain, so this reaches all of them.
    await client.query('delete from auth.users where email like $1', [
      `%@${THROWAWAY}.shift.invalid`,
    ]);
    // The storage cases write real objects through the real API, outside any
    // transaction — there is no throwaway organization to aim them at, because
    // the caller's claim pins the folder it may write to. Both fixtures are
    // seeded logo-less and must stay that way for the fallback case.
    //
    // SCOPED TO THE FIXTURES THIS FILE ACTUALLY TOUCHES, by slug, exactly as
    // every other cleanup here is scoped. `databaseUrl` honours
    // `SUPABASE_DB_URL`, so an unscoped `delete from storage.objects` or
    // `update organizations set logo_path = null` is one environment variable
    // away from clearing every tenant's branding on a database this file was
    // never meant to be pointed at — and both statements would report success.
    const fixtures = FIXTURES.map((entry) => entry.slug);

    await client.query('begin');
    await client.query("set local storage.allow_delete_query = 'true'");
    await client.query(
      `delete from storage.objects
        where bucket_id = $1
          and (storage.foldername(name))[1] in (
            select id::text from organizations where slug = any($2::text[])
          )`,
      [LOGO_BUCKET, fixtures],
    );
    await client.query('update organizations set logo_path = null where slug = any($1::text[])', [
      fixtures,
    ]);
    // STORY 1.4c, and for the same reason: the accent cases below write a real
    // key through the real transport, outside any transaction, because there is
    // no throwaway organization to aim them at. Both fixtures are seeded with no
    // accent and must stay that way — a fixture left tinted is a `0006` default
    // by accident, which is the thing `0002:38-41` forbids on purpose. Scoped
    // by slug, like every other cleanup here.
    await client.query(
      'update organizations set brand_accent = null where slug = any($1::text[])',
      [fixtures],
    );
    await client.query('commit');
  } finally {
    await client.end();
  }
});

/** A decoder fixture: a payload wrapped in the two segments `claimsOf` ignores. */
function tokenShapedString(payload: unknown): string {
  return `header.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.signature`;
}

describe('the access-control layer is present, so nothing below passes vacuously', () => {
  it('drives every cross-tenant case against a second tenant that exists', () => {
    // `CROSS_TENANT` is derived from `FIXTURES`. With one fixture it is the
    // empty array, `it.each([])` registers no tests at all, and every
    // cross-tenant case — the whole of Q1 — disappears without a single
    // failure. AD-15 and Q10 require two fixtures; this is what makes their
    // absence loud.
    expect(FIXTURES.length, 'every rule is asserted against two fixtures (Q10)').toBeGreaterThanOrEqual(2);
    expect(
      CROSS_TENANT.length,
      'CROSS_TENANT must pair every fixture with every other one, in both directions',
    ).toBe(FIXTURES.length * (FIXTURES.length - 1));
    expect(
      OWN_ORGANIZATION_READS.length,
      'OWN_ORGANIZATION_READS must cover both readable tables per fixture',
    ).toBe(FIXTURES.length * 2);
  });

  it.skipIf(noDatabase)('reaches the API whenever it can reach the database', () => {
    // The guard the file was missing, and the one that matters most. Fifteen of
    // this file's twenty-nine blocks are `skipIf(noApi)`, and they are not a
    // spare half: they hold every cross-tenant *write* case and both cases that
    // observe what the access token hook actually mints. `apiEndpoint` is built
    // by shelling out to `supabase status` inside a `try` that returns
    // `undefined` on any throw with the CLI's stderr discarded, so a broken
    // stack and an absent one are indistinguishable — and the broken one skips
    // silently while reporting green.
    //
    // A database with no API is not a shape this project has. `SUPABASE_DB_URL`
    // pointing at a plain Postgres is, which is exactly why the assertion is
    // `skipIf(noDatabase)` and not ungated: it fires only when the local stack
    // is the thing under test, and there it insists the two halves rise and
    // fall together. Reviewed 2026-09-07: without it, a hook rewritten to mint
    // no claim at all passes this entire file.
    expect(
      apiEndpoint,
      'the database is reachable but `supabase status` yielded no API endpoint — the fifteen HTTP cases, including every cross-tenant write and both hook-claim assertions, would skip silently',
    ).toBeDefined();

    // THE SAME HOLE, ONE KEY OVER, and it is the one that matters most now.
    // `adminKey` is read out of the same `supabase status` JSON under EITHER of
    // two spellings — the code already hedges `SECRET_KEY` against
    // `SERVICE_ROLE_KEY`, so a CLI rename is the anticipated case rather than a
    // hypothetical one — and a third spelling resolves it to `undefined` with
    // the CLI's stderr discarded. Every `skipIf(noAdminApi)` block then
    // vanishes while this file reports green.
    //
    // WHAT VANISHES IS THE WHOLE REVOCATION CLAIM. "A session held before the
    // reset no longer authenticates" cannot be asserted against a stub at all:
    // GoTrue's admin user update is what ends those sessions, so the only place
    // that behaviour is ever observed is the admin-API blocks this key gates.
    // Silently skipping them leaves the story's security argument resting on a
    // comment.
    expect(
      adminKey,
      'the database is reachable but `supabase status` yielded no secret key — the admin-API cases would skip silently, and they are the only verification that a reset ends the sessions the old credential minted',
    ).toBeDefined();
  });

  it.skipIf(noDatabase)('finds both fixtures, both new functions and every policy by name', async () => {
    // Every case below looks a fixture up by slug and asserts something about a
    // policy. Without this guard, a database that had loaded no seed or applied
    // no 0003 would let the read cases find nothing to be denied and the
    // refusal cases be refused by the absence of a grant instead of by a
    // policy — green, in both directions, having asserted nothing.
    const client = await connect();
    try {
      const { rows: present } = await client.query<{ slug: string }>('select slug from organizations');
      expect(
        FIXTURES.map(({ slug }) => slug).filter(
          (slug) => !present.some((row) => row.slug === slug),
        ),
        'seed.sql loaded no fixture; every assertion below would have nothing to assert against',
      ).toEqual([]);

      // The exact list, not a count per table and not "at least one". A missing
      // policy is invisible to a count — and the delete policy in particular
      // refuses silently, so its absence produces exactly the HTTP 204 with the
      // row still present that this suite teaches a reader to read as a
      // refusal. Naming every policy is what makes a deleted one a failure.
      //
      // EXTENDED BY STORY 1.4a, exactly as this comment asked: `0004` adds
      // `organizations_update_by_own_active_admin`, so a sixth name is listed
      // here rather than the assertion being relaxed to a `toContain` or a
      // count — the shape that let the delete policy be deletable in the first
      // place. And still no seventh: `organizations` gains no insert and no
      // delete policy, because no product surface creates or destroys a tenant.
      // The same list is mirrored over migration source text in
      // `test/supabase-scaffold.test.ts`, which runs with no database.
      const { rows: policies } = await client.query<{ policyname: string }>(
        `select policyname from pg_policies where schemaname = 'public' order by policyname`,
      );
      expect(
        policies.map((row) => row.policyname),
        'stories 1.3a and 1.4a own exactly these six policies; a missing one refuses silently and looks like a working refusal',
      ).toEqual([
        'members_delete_by_own_active_admin',
        'members_insert_by_own_active_admin',
        'members_select_own_organization',
        'members_update_by_own_active_admin',
        'organizations_select_own_organization',
        'organizations_update_by_own_active_admin',
      ]);

      const { rows: functions } = await client.query<{ proname: string }>(
        `select proname from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in ('current_member_access', 'custom_access_token_hook')
          order by proname`,
      );
      expect(
        functions.map((row) => row.proname),
        'the helper and the hook are what every policy and every claim depend on',
      ).toEqual(['current_member_access', 'custom_access_token_hook']);
    } finally {
      await client.end();
    }
  });
});

describe('the token decoder this file owns reads a payload and refuses everything else', () => {
  it('decodes a payload, and refuses each shape its own guards name', () => {
    // The detector self-test for the one matcher this file owns. `claimsOf` is
    // what every hook assertion is read through, so a version of it that
    // silently returned `{}` would make "the domain role never enters a claim"
    // pass for a token that carried nothing but domain roles.
    //
    // Every input below is a decoder fixture, not a token: none has a
    // signature and none could authenticate anything. Every real token in this
    // file comes from a credential exchange.
    expect(
      claimsOf(tokenShapedString({ role: 'authenticated', organization_id: 'a-probe-value' })),
      'a well-formed payload must decode to its own claims',
    ).toEqual({ role: 'authenticated', organization_id: 'a-probe-value' });

    // One case per guard the function actually writes, because a guard with no
    // case is a branch that can be deleted for free.
    expect(() => claimsOf('not-a-token'), 'a string with no payload segment').toThrow();
    expect(() => claimsOf('header.bm90LWpzb24.signature'), 'a payload that is not JSON').toThrow();
    expect(() => claimsOf(tokenShapedString(42)), 'a payload that parses to a number').toThrow();
    expect(() => claimsOf(tokenShapedString('a string')), 'a payload that parses to a string').toThrow();
    expect(() => claimsOf(tokenShapedString(null)), 'a payload that parses to null').toThrow();
    // `typeof [] === 'object'` and an array is not null, so this is the one
    // shape the guard let through: every claim lookup on it would be
    // `undefined` and every assertion about a claim would pass vacuously.
    expect(() => claimsOf(tokenShapedString([])), 'a payload that parses to an array').toThrow();
  });
});

describe('a token carries its own organization and no domain role', () => {
  it.skipIf(noApi).each(FIXTURES)(
    'mints a $fixture token whose claims name that organization alone',
    async ({ slug, admin }) => {
      const token = await tokenFor(admin, slug);
      const claims = claimsOf(token);

      const client = await connect();
      try {
        expect(
          claims['organization_id'],
          'the access token hook must put the signer own organization into the claims; a missing claim means [auth.hook.custom_access_token] is configured but the stack was not restarted',
        ).toBe(await organizationId(client, slug));
      } finally {
        await client.end();
      }

      // PostgREST owns the `role` claim and its value selects the database role
      // the request runs as. A domain role there would change which role every
      // request arrives as, and AD-10 keeps the domain role out of every claim
      // regardless, because a claim is a fact about the past.
      expect(claims['role'], 'PostgREST owns the role claim, and its value is authenticated').toBe(
        'authenticated',
      );
      expect(
        Object.entries(claims)
          .filter(([, value]) => value === 'admin' || value === 'member_role')
          .map(([name]) => name),
        'the domain role must never enter any claim (AD-10)',
      ).toEqual([]);
    },
    20_000,
  );

  it.skipIf(noDatabase)('writes no organization claim for an account with no member row', async () => {
    // The hook's other branch, which nothing else reaches: every seeded
    // `auth.users` row has a `members` row, and the claimless-session cases
    // inject claims directly and never call the hook at all. Replacing this
    // branch's body with `return event` changed no test before this case
    // existed — and the branch is the fail-closed direction, so its silent
    // removal would mean a token minted for an accountless user inheriting
    // whatever claim happened to be in the event.
    //
    // Called directly rather than through a sign-in, because the account this
    // is about cannot sign in: it has no member row by construction.
    const client = await connect();
    try {
      const { rows } = await client.query<{ claims: Record<string, unknown> }>(
        `select public.custom_access_token_hook(
                  jsonb_build_object(
                    'user_id', gen_random_uuid()::text,
                    'claims', jsonb_build_object(
                      'role', 'authenticated',
                      'organization_id', gen_random_uuid()::text
                    )
                  )
                ) -> 'claims' as claims`,
      );

      expect(
        rows[0]?.claims,
        'a subject with no member row must have the organization claim removed, not defaulted or inherited',
      ).toEqual({ role: 'authenticated' });
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('writes the signer own organization claim, called directly', async () => {
    // The twin of the branch above, and the one the whole story rests on. Every
    // policy in 0003 compares a column to this claim, so a hook that never
    // writes it leaves every signed-in session reading zero rows from both
    // tables — the deny-all symptom DEPLOY.md §5.2b warns "looks exactly like a
    // broken policy and is not one".
    //
    // Asserted here, on the database, rather than only through the two
    // `skipIf(noApi)` cases that decode a real token. Those exercise the
    // shipped path and must stay, but they disappear whenever `supabase status`
    // fails, and the claims-injection harness builds `organization_id` itself
    // and never calls the hook. Before this case existed, replacing the hook
    // body with the unconditional claim-removing branch passed this entire
    // file whenever the API half was skipped. Reviewed 2026-09-07.
    const client = await connect();
    try {
      for (const { slug, admin } of FIXTURES) {
        const organization = await organizationId(client, slug);
        const member = await memberByUsername(client, slug, admin);

        const { rows } = await client.query<{ claims: Record<string, unknown> }>(
          `select public.custom_access_token_hook(
                    jsonb_build_object(
                      'user_id', $1::text,
                      'claims', jsonb_build_object('role', 'authenticated')
                    )
                  ) -> 'claims' as claims`,
          [member.authUserId],
        );

        expect(
          rows[0]?.claims,
          `the hook must mint ${slug}'s own organization for its own admin, and nothing else`,
        ).toEqual({ role: 'authenticated', organization_id: organization });
      }
    } finally {
      await client.end();
    }
  });

  it.skipIf(noApi)(
    'mints organization claims that differ between the two fixtures',
    async () => {
      // The negative control. A hook that ignored its argument and wrote one
      // hard-coded organization would satisfy every assertion above for
      // whichever fixture it happened to name.
      const claimed = await Promise.all(
        FIXTURES.map(async ({ admin, slug }) => claimsOf(await tokenFor(admin, slug))['organization_id']),
      );

      expect(new Set(claimed).size, 'two fixtures must not receive the same organization claim').toBe(
        FIXTURES.length,
      );
    },
    20_000,
  );
});

describe('a direct API call reaches exactly one organization', () => {
  it.skipIf(noApi).each(OWN_ORGANIZATION_READS)(
    'returns the $fixture organization own $table rows to its admin',
    async ({ slug, admin, table }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const rows = await restRows(`${table}?select=*`, { token });

        expect(rows.length, `${slug} read no ${table} rows at all`).toBeGreaterThan(0);
        // `organizations` carries the tenant as `id`; every organization-scoped
        // table carries it as `organization_id` (Q3).
        const tenantColumn = table === 'organizations' ? 'id' : 'organization_id';
        expect(
          [...new Set(rows.map((row) => row[tenantColumn]))],
          `a ${slug} session read ${table} rows belonging to another organization`,
        ).toEqual([own]);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'returns the $fixture organization members to a member-role session too',
    async ({ slug, member }) => {
      // Q2 is about writes. A member-role account has to be able to read the
      // list — that is how anyone sees who is on a team — and the refusals
      // below are what keep it from changing it.
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const rows = await restRows('members?select=organization_id', { token });

        expect(rows.length, `a ${slug} member-role session read no members`).toBeGreaterThan(0);
        expect(
          [...new Set(rows.map((row) => row['organization_id']))],
          `a ${slug} member-role session read another organization members`,
        ).toEqual([own]);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(CROSS_TENANT)(
    'returns no $otherFixture rows to a $fixture session that asks for them by id',
    async ({ slug, admin, otherSlug }) => {
      // The cross-tenant read with a valid session, filtered by the policy and
      // not by the caller: the request names the other organization explicitly
      // and the filter it supplies is the one thing that cannot be trusted.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const other = await organizationId(client, otherSlug);

        expect(
          await restRows(`members?select=id&organization_id=eq.${other}`, { token }),
          `a ${slug} session reached ${otherSlug} members by naming the organization`,
        ).toEqual([]);
        expect(
          await restRows(`organizations?select=id&id=eq.${other}`, { token }),
          `a ${slug} session reached the ${otherSlug} organization row`,
        ).toEqual([]);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(['organizations', 'members'] as const)(
    'returns no %s rows to a call carrying the publishable key and no session',
    async (table) => {
      // The other negative control, and the state that must survive this story
      // unchanged: there is no anonymous read path anywhere in this system, so
      // both tables answer an unauthenticated call with zero rows forever.
      //
      // Zero rows and specifically not an error: 0002:160-172 explains that the
      // default grants are what make an unmatched policy empty a result rather
      // than deny it, and a privilege error here would mean something else
      // entirely.
      const response = await rest(`${table}?select=*`);

      expect(response.status, `an anonymous read of ${table} must not be an error`).toBe(200);
      expect(await response.json(), `${table} is readable without a session`).toEqual([]);
    },
    20_000,
  );
});

describe('a direct API call refuses an administrative write by a member-role account', () => {
  it.skipIf(noApi).each(FIXTURES)(
    'leaves the row unchanged when a $fixture member-role session patches a role',
    async ({ slug, member }) => {
      // The refusal shape differs by operation, and this is the one that
      // surprises: row level security refuses an update by failing USING, which
      // means the statement matches no row and succeeds. PostgREST answers 204
      // with no error body. Asserting that the write *threw* would be wrong;
      // the assertion is that the row did not move.
      //
      // Aimed at a throwaway row rather than a seeded account, because this
      // case runs outside any transaction: if the policy were wrong it would
      // promote whoever it targeted, permanently, and `afterAll` only cleans
      // what this file created.
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const target = await addThrowawayMember(client, await organizationId(client, slug));
        const response = await rest(`members?id=eq.${target.id}`, {
          token,
          method: 'PATCH',
          body: { role: 'admin' },
        });

        expect(response.status, 'a refused update affects zero rows and raises nothing').toBe(204);
        expect(
          (await memberById(client, target.id))?.role,
          `a ${slug} member-role session promoted somebody`,
        ).toBe(target.role);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses an insert by a $fixture member-role session with 42501',
    async ({ slug, member }) => {
      // Insert has no USING clause to fail, so WITH CHECK raises instead of
      // filtering: this is the one write refusal that reaches the caller as an
      // error, and PostgREST maps it to 403.
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const before = await client.query<{ total: number }>(
          'select count(*)::int as total from members where organization_id = $1',
          [own],
        );

        const response = await rest('members', {
          token,
          method: 'POST',
          body: {
            organization_id: own,
            auth_user_id: '00000000-0000-0000-0000-000000000000',
            name: `${THROWAWAY} refused insert`,
            // `0007` makes `username` not null, so a body without one would be
            // refused with 23502 BEFORE the policy is reached — and this case
            // would then pass while asserting nothing about row level security.
            username: `${THROWAWAY}-refused-insert`,
            role: 'admin',
            leave_allowance_days: 0,
          },
        });

        expect(response.status, 'a refused insert reaches the caller as HTTP 403').toBe(403);
        expect((await restRefusal(response)).code, 'a row level security refusal is 42501').toBe(
          '42501',
        );

        const after = await client.query<{ total: number }>(
          'select count(*)::int as total from members where organization_id = $1',
          [own],
        );
        expect(after.rows[0]?.total, `a ${slug} member-role session inserted a member`).toBe(
          before.rows[0]?.total,
        );
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'leaves the row present when a $fixture member-role session deletes it',
    async ({ slug, member }) => {
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const target = await addThrowawayMember(client, await organizationId(client, slug));
        const response = await rest(`members?id=eq.${target.id}`, { token, method: 'DELETE' });

        expect(response.status, 'a refused delete affects zero rows and raises nothing').toBe(204);
        expect(
          await memberById(client, target.id),
          `a ${slug} member-role session deleted a member`,
        ).toBeDefined();
      } finally {
        await client.end();
      }
    },
    20_000,
  );
});

describe('a direct API call permits an admin inside their own organization and nowhere else', () => {
  it.skipIf(noApi).each(FIXTURES)(
    'permits the $fixture admin to change a leave allowance in their own organization',
    async ({ slug, admin }) => {
      // The positive control the three refusals above need. Without it a policy
      // that refused every write would satisfy all of them.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const target = await addThrowawayMember(client, await organizationId(client, slug));
        const response = await rest(`members?id=eq.${target.id}`, {
          token,
          method: 'PATCH',
          body: { leave_allowance_days: target.leaveAllowanceDays + 3 },
        });

        expect(response.status, 'a permitted update answers 204 with no body').toBe(204);
        expect(
          (await memberById(client, target.id))?.leaveAllowanceDays,
          `the ${slug} admin could not write inside their own organization`,
        ).toBe(target.leaveAllowanceDays + 3);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(CROSS_TENANT)(
    'changes nothing when the $fixture admin patches a $otherFixture member',
    async ({ slug, admin, otherSlug }) => {
      // The target is a throwaway row in the *other* organization, not one of
      // its seeded accounts: this case runs outside any transaction, so a wrong
      // policy would leave the other fixture permanently edited and every later
      // suite reading the edited value.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const target = await addThrowawayMember(client, await organizationId(client, otherSlug));
        const response = await rest(`members?id=eq.${target.id}`, {
          token,
          method: 'PATCH',
          body: { leave_allowance_days: target.leaveAllowanceDays + 5 },
        });

        expect(response.status, 'a cross-tenant update matches no row and raises nothing').toBe(204);
        expect(
          (await memberById(client, target.id))?.leaveAllowanceDays,
          `the ${slug} admin wrote into ${otherSlug}`,
        ).toBe(target.leaveAllowanceDays);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'permits the $fixture admin to delete a member of their own organization',
    async ({ slug, admin }) => {
      // The positive control the delete refusal cannot do without. Row level
      // security refuses a delete by failing USING, so a policy that is absent,
      // inverted, or written against the wrong role produces the identical
      // "HTTP 204 and the row is still there" this suite reads as a refusal.
      // Without this case the whole delete half of Q2 can ship missing.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const target = await addThrowawayMember(client, await organizationId(client, slug));
        const response = await rest(`members?id=eq.${target.id}`, { token, method: 'DELETE' });

        expect(response.status, 'a permitted delete answers 204 with no body').toBe(204);
        expect(
          await memberById(client, target.id),
          `the ${slug} admin could not delete a member of their own organization`,
        ).toBeUndefined();
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(CROSS_TENANT)(
    'leaves the row present when the $fixture admin deletes a $otherFixture member',
    async ({ slug, admin, otherSlug }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const target = await addThrowawayMember(client, await organizationId(client, otherSlug));
        const response = await rest(`members?id=eq.${target.id}`, { token, method: 'DELETE' });

        expect(response.status, 'a cross-tenant delete matches no row and raises nothing').toBe(204);
        expect(
          await memberById(client, target.id),
          `the ${slug} admin deleted a ${otherSlug} member`,
        ).toBeDefined();
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(CROSS_TENANT)(
    'refuses an insert by the $fixture admin carrying the $otherFixture organization with 42501',
    async ({ slug, admin, otherSlug }) => {
      // The insert-side twin of the tenant move. Insert has no USING clause to
      // fail, so WITH CHECK raises: an otherwise-legitimate admin cannot create
      // a row inside somebody else's tenant, which is the only direction Q3's
      // not-null cannot cover on its own.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const other = await organizationId(client, otherSlug);
        const before = await client.query<{ total: number }>(
          'select count(*)::int as total from members where organization_id = $1',
          [other],
        );

        const response = await rest('members', {
          token,
          method: 'POST',
          body: {
            organization_id: other,
            auth_user_id: '00000000-0000-0000-0000-000000000000',
            name: `${THROWAWAY} cross-tenant insert`,
            username: `${THROWAWAY}-cross-tenant-insert`,
            role: 'member_role',
            leave_allowance_days: 0,
          },
        });

        expect(response.status, 'a refused write reaches the caller as HTTP 403').toBe(403);
        expect((await restRefusal(response)).code, 'a WITH CHECK refusal is 42501').toBe('42501');
        expect(
          (
            await client.query<{ total: number }>(
              'select count(*)::int as total from members where organization_id = $1',
              [other],
            )
          ).rows[0]?.total,
          `the ${slug} admin created a member inside ${otherSlug}`,
        ).toBe(before.rows[0]?.total);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(CROSS_TENANT)(
    'refuses moving a $fixture member into $otherFixture with 42501',
    async ({ slug, admin, otherSlug }) => {
      // USING passes here — the row is the admin own organization's — and WITH
      // CHECK is the only thing standing between an otherwise-legal update and
      // a member handed to another tenant. This case is what a USING-only
      // policy fails.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const other = await organizationId(client, otherSlug);
        const target = await addThrowawayMember(client, own);

        const response = await rest(`members?id=eq.${target.id}`, {
          token,
          method: 'PATCH',
          body: { organization_id: other },
        });

        expect(response.status, 'a refused write reaches the caller as HTTP 403').toBe(403);
        expect((await restRefusal(response)).code, 'a WITH CHECK refusal is 42501').toBe('42501');
        expect(
          (await memberById(client, target.id))?.organizationId,
          `a ${slug} member was moved into ${otherSlug}`,
        ).toBe(own);
      } finally {
        await client.end();
      }
    },
    20_000,
  );
});

describe('the policies refuse the same things with claims injected instead of a token', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'reads only the $fixture organization when its own claim is injected',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const { rows: total } = await client.query<{ total: number }>(
          'select count(*)::int as total from members',
        );

        await actAs(client, caller.authUserId, caller.organizationId);
        const { rows: visible } = await client.query<{
          own: number;
          foreign: number;
          ownOrganization: number;
          foreignOrganizations: number;
        }>(
          `select (select count(*) filter (where organization_id = $1)::int from members) as own,
                  (select count(*) filter (where organization_id <> $1)::int from members) as "foreign",
                  (select count(*) filter (where id = $1)::int from organizations) as "ownOrganization",
                  (select count(*) filter (where id <> $1)::int from organizations) as "foreignOrganizations"`,
          [caller.organizationId],
        );
        await actAsOwner(client);

        expect(visible[0]?.own, `a ${slug} session read none of its own members`).toBeGreaterThan(0);
        expect(visible[0]?.foreign, `a ${slug} session read another organization members`).toBe(0);
        // `organizations` too, and in the same statement. Its isolation was
        // otherwise asserted only through PostgREST, which skips whenever the
        // API gateway is unreachable — leaving the table the whole system's
        // tenancy hangs off with no database-only coverage at all.
        expect(
          visible[0]?.ownOrganization,
          `a ${slug} session could not read its own organization row`,
        ).toBe(1);
        expect(
          visible[0]?.foreignOrganizations,
          `a ${slug} session read another organization row`,
        ).toBe(0);
        // The vacuous half: if the database held only one organization's rows,
        // "no foreign rows" would be true of a policy that filtered nothing.
        expect(
          total[0]?.total,
          'both fixtures must be loaded, or a zero foreign count proves nothing',
        ).toBeGreaterThan(visible[0]?.own ?? 0);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'reads nothing when a $fixture session claims the $otherFixture organization',
    async ({ slug, admin, otherSlug }) => {
      // A claim cannot be forged — the keys are asymmetric — but the policies
      // are written not to depend on that: the claim has to agree with the row
      // the helper finds, so a claim naming somebody else's tenant matches
      // nothing rather than everything in it.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const other = await organizationId(client, otherSlug);

        await actAs(client, caller.authUserId, other);
        const { rows } = await client.query<{ members: number; organizations: number }>(
          `select (select count(*)::int from members) as members,
                  (select count(*)::int from organizations) as organizations`,
        );
        await actAsOwner(client);

        expect(rows[0]?.members, `a claim naming ${otherSlug} read its members`).toBe(0);
        expect(rows[0]?.organizations, `a claim naming ${otherSlug} read its organization`).toBe(0);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'reads nothing when a $fixture session carries no organization claim at all',
    async ({ slug, admin }) => {
      // Every session minted before the hook existed looks like this. The
      // claim's absence has to fail closed: a policy comparing a column to a
      // missing claim must yield zero rows, never all of them.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await actAs(client, caller.authUserId, null);
        const { rows } = await client.query<{ members: number; organizations: number }>(
          `select (select count(*)::int from members) as members,
                  (select count(*)::int from organizations) as organizations`,
        );
        await actAsOwner(client);

        expect(rows[0]?.members, `a claimless ${slug} session read members`).toBe(0);
        expect(rows[0]?.organizations, `a claimless ${slug} session read organizations`).toBe(0);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'reads nothing when a $fixture session carries an empty organization claim',
    async ({ slug, admin }) => {
      // The case for the `nullif(…, '')` written six times across the five
      // policies and argued for at length at 0003:221-226. Until this existed
      // the guard could be deleted from every policy for free — by the standard
      // this file holds `claimsOf` to two hundred lines up, a branch with no
      // case is a branch that can be deleted for free.
      //
      // What `nullif` buys: `''::uuid` raises 22P02, so without it an empty
      // claim is an error rather than a closed door, and an error is a
      // different thing for a caller to handle than zero rows.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await client.query('select set_config($1, $2, true)', [
          'request.jwt.claims',
          JSON.stringify({
            sub: caller.authUserId,
            role: 'authenticated',
            organization_id: '',
          }),
        ]);
        await client.query('set local role authenticated');
        const { rows } = await client.query<{ members: number; organizations: number }>(
          `select (select count(*)::int from members) as members,
                  (select count(*)::int from organizations) as organizations`,
        );
        await actAsOwner(client);

        expect(rows[0]?.members, `an empty ${slug} claim read members`).toBe(0);
        expect(rows[0]?.organizations, `an empty ${slug} claim read organizations`).toBe(0);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses an insert by an injected $fixture member-role session with 42501',
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, member);
        expect(caller.role, 'this case needs a member-role account, not an admin').toBe(
          'member_role',
        );

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refused(() =>
          client.query(
            `insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
             values ($1, gen_random_uuid(), $2, gen_random_uuid()::text, 'admin', 0)`,
            [caller.organizationId, `${THROWAWAY} injected insert`],
          ),
        );

        expect(refusal.code, 'a row level security refusal is 42501').toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'permits an insert by an injected $fixture admin session',
    async ({ slug, admin }) => {
      // The positive control for the case above. A policy with no WITH CHECK
      // that anybody satisfies refuses every insert, and the refusal case alone
      // could not tell that apart from a working one.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        // The account has to be reachable in `auth.users` before `members` can
        // reference it, and that write is the owner's, not the session's.
        const { rows: created } = await client.query<{ id: string }>(
          `insert into auth.users (id, email)
           values (gen_random_uuid(), gen_random_uuid()::text || '@' || $1)
           returning id`,
          [`${THROWAWAY}.shift.invalid`],
        );
        const account = created[0];
        if (account === undefined) throw new Error('auth.users insert returned no row');

        await actAs(client, caller.authUserId, caller.organizationId);
        const inserted = await client.query(
          `insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
           values ($1, $2::uuid, $3, $2::uuid::text, 'member_role', 20)`,
          [caller.organizationId, account.id, `${THROWAWAY} permitted insert`],
        );
        await actAsOwner(client);

        expect(inserted.rowCount, `the ${slug} admin could not insert into their own organization`).toBe(
          1,
        );
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'affects no rows when an injected $fixture admin updates a $otherFixture member',
    async ({ slug, admin, otherSlug }) => {
      // Half of Q1 lived only behind the API gate until this case and the one
      // below existed: the injection block covered reads and own-organization
      // inserts, so the tenant conjunct in `members_update_by_own_active_admin`
      // USING could be dropped entirely and only `skipIf(noApi)` cases noticed.
      //
      // A refused UPDATE raises nothing — the row simply fails USING and the
      // statement affects zero rows — so this asserts `rowCount` and re-reads
      // the row as the owner, never that anything threw.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, await organizationId(client, otherSlug));

        await actAs(client, caller.authUserId, caller.organizationId);
        const attempted = await client.query(
          'update members set leave_allowance_days = 99 where id = $1',
          [target.id],
        );
        await actAsOwner(client);

        expect(
          attempted.rowCount,
          `the ${slug} admin reached a ${otherSlug} row through the update policy`,
        ).toBe(0);
        expect(
          (await memberById(client, target.id))?.leaveAllowanceDays,
          `the ${slug} admin changed a ${otherSlug} member`,
        ).toBe(target.leaveAllowanceDays);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'refuses an injected $fixture admin moving their own member into $otherFixture',
    async ({ slug, admin, otherSlug }) => {
      // The WITH CHECK twin. 0003:296-302 says that clause exists precisely so
      // the refusal survives a later loosening of USING, and weakening it to
      // `with check (organization_id is not null)` passed every injected case
      // before this one. Unlike the update above this one *does* raise, because
      // WITH CHECK is what refuses it.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const elsewhere = await organizationId(client, otherSlug);

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, () =>
          client.query('update members set organization_id = $1 where id = $2', [
            elsewhere,
            target.id,
          ]),
        );
        await actAsOwner(client);

        expect(refusal.code, 'a row level security refusal is 42501').toBe('42501');
        expect(
          (await memberById(client, target.id))?.organizationId,
          `a ${slug} member was moved into ${otherSlug}`,
        ).toBe(caller.organizationId);
      });
    },
  );
});

describe('organizations admits exactly one write path, and it is the settings surface', () => {
  /**
   * STORY 1.4a REWROTE THIS BLOCK, and the assertion it replaced said the
   * opposite: until `0004` there was no write policy at all, so update, delete
   * and insert were refused by *no policy matching* and the block existed to
   * pin that. Its own comment named this story and told it to edit here rather
   * than anywhere else, which is what happened.
   *
   * What survives verbatim is the half that is still true: INSERT and DELETE
   * stay refused, and they stay refused for the same reason — no policy matches
   * them. FR-2 puts provisioning in the operator script, so no product surface
   * creates or destroys a tenant, and the day one does it will have to delete
   * these two assertions to do it.
   */
  it.skipIf(noDatabase).each(FIXTURES)(
    'still refuses an injected $fixture admin every insert and delete on organizations',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await actAs(client, caller.authUserId, caller.organizationId);
        const remove = await client.query('delete from organizations where id = $1', [
          caller.organizationId,
        ]);
        const insertRefusal = await refusedThenContinue(client, () =>
          client.query('insert into organizations (name, slug) values ($1, $2)', [
            `${THROWAWAY} organization`,
            `${THROWAWAY}-inserted`,
          ]),
        );
        await actAsOwner(client);

        expect(remove.rowCount, `a ${slug} admin deleted their own organization`).toBe(0);
        expect(insertRefusal.code, 'an insert with no matching policy is 42501').toBe('42501');
        expect(
          await organizationById(client, caller.organizationId),
          `a ${slug} admin removed their own organization row`,
        ).toBeDefined();
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'permits an injected $fixture admin to edit their own organization',
    async ({ slug, admin }) => {
      // The positive control every refusal below needs. A policy that refused
      // everything — misspelt, written `to anon`, or with a `with check` nobody
      // satisfies — produces the identical "zero rows and no error" this file
      // teaches a reader to read as a refusal, so without this the whole write
      // half of the story can ship broken and green.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const before = await organizationById(client, caller.organizationId);

        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await client.query(
          `update organizations
              set name = $1,
                  timezone = $2,
                  leave_year_start_month = $3,
                  leave_year_start_day = $4
            where id = $5`,
          [`${THROWAWAY} renamed`, 'Etc/UTC', 7, 28, caller.organizationId],
        );
        await actAsOwner(client);

        const after = await organizationById(client, caller.organizationId);

        expect(written.rowCount, `the ${slug} admin could not edit their own organization`).toBe(1);
        expect(after?.name).toBe(`${THROWAWAY} renamed`);
        expect(after?.timezone, 'the timezone the whole application renders in did not move').toBe(
          'Etc/UTC',
        );
        expect(after?.leaveYearStartMonth).toBe(7);
        expect(after?.leaveYearStartDay).toBe(28);
        // The slug is not in the statement above and must not move on its own:
        // every issued sign-in address is built from it (AD-12).
        expect(after?.slug, 'the slug moved during an edit that never named it').toBe(before?.slug);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses an injected $fixture member-role session editing the organization',
    async ({ slug, member }) => {
      // Q2 from the database's side. The refusal is SILENT — USING fails, the
      // statement matches no row and raises nothing — so this asserts `rowCount`
      // and re-reads the row as the owner, never that anything threw.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, member);
        expect(caller.role, 'this case needs a member-role account, not an admin').toBe(
          'member_role',
        );
        const before = await organizationById(client, caller.organizationId);

        await actAs(client, caller.authUserId, caller.organizationId);
        const attempted = await client.query('update organizations set name = $1 where id = $2', [
          `${THROWAWAY} renamed by a member`,
          caller.organizationId,
        ]);
        await actAsOwner(client);

        expect(attempted.rowCount, `a ${slug} member-role session edited the organization`).toBe(0);
        expect(
          (await organizationById(client, caller.organizationId))?.name,
          `a ${slug} member-role session changed the organization name`,
        ).toBe(before?.name);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'affects no rows when an injected $fixture admin edits the $otherFixture organization',
    async ({ slug, admin, otherSlug }) => {
      // Q1. The claim is the caller's own and the target is somebody else's, so
      // USING's tenant conjunct is the only thing in the way — which is exactly
      // the clause a copy-paste from the members policy could lose.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const other = await organizationId(client, otherSlug);
        const before = await organizationById(client, other);

        await actAs(client, caller.authUserId, caller.organizationId);
        const attempted = await client.query('update organizations set name = $1 where id = $2', [
          `${THROWAWAY} cross-tenant rename`,
          other,
        ]);
        await actAsOwner(client);

        expect(
          attempted.rowCount,
          `the ${slug} admin reached the ${otherSlug} row through the update policy`,
        ).toBe(0);
        expect(
          (await organizationById(client, other))?.name,
          `the ${slug} admin renamed ${otherSlug}`,
        ).toBe(before?.name);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses an injected $fixture admin changing the organization own identity',
    async ({ slug, admin }) => {
      // The `organizations` equivalent of moving a row between tenants, and the
      // case a USING-only policy fails: USING passes — the row IS the caller's
      // — and WITH CHECK is the only thing standing between an otherwise-legal
      // update and a row that has left the tenant it was reachable in. On this
      // table the primary key IS the tenant reference, so `id` is what has to be
      // pinned in the check.
      //
      // TWO REFUSALS STAND IN FRONT OF IT since the review, and this case proves
      // both in order rather than letting the outer one hide the inner. `0004`
      // revokes the table UPDATE grant and re-grants five columns, so `id` is no
      // longer writable at all and the privilege refuses first; the WITH CHECK
      // pin is then exercised by granting the column INSIDE this transaction,
      // where the rollback takes it away again. Without the second half the
      // check could be deleted for free, which is the standard this file holds
      // every other branch to.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await actAs(client, caller.authUserId, caller.organizationId);
        const byPrivilege = await refusedThenContinue(client, () =>
          client.query('update organizations set id = gen_random_uuid() where id = $1', [
            caller.organizationId,
          ]),
        );
        await actAsOwner(client);

        expect(byPrivilege.code, 'a privilege refusal is 42501').toBe('42501');
        expect(
          byPrivilege.message,
          'id is writable by authenticated; the column grant no longer bounds the update',
        ).toContain('permission denied');

        // Rolled back with the transaction, so nothing here outlives the case.
        await client.query('grant update (id) on table public.organizations to authenticated');

        await actAs(client, caller.authUserId, caller.organizationId);
        const byCheck = await refusedThenContinue(client, () =>
          client.query('update organizations set id = gen_random_uuid() where id = $1', [
            caller.organizationId,
          ]),
        );
        await actAsOwner(client);

        expect(byCheck.code, 'a WITH CHECK refusal is 42501').toBe('42501');
        expect(
          byCheck.message,
          'with the column writable, nothing refused the row leaving its own tenant',
        ).toContain('row-level security');
        expect(
          await organizationById(client, caller.organizationId),
          `the ${slug} organization row lost its own id`,
        ).toBeDefined();
      });
    },
  );

  it.skipIf(noDatabase)('grants authenticated UPDATE on exactly the seven writable columns', () => {
    // The column allowlist as a fact about the database rather than about the
    // interface, and an EXACT set: a later migration re-granting the table — or
    // `grant all` written by habit — restores every column silently, and the
    // behavioural cases below would then be the only thing noticing, one column
    // at a time.
    //
    // Reads `information_schema.column_privileges`, which reports column grants
    // and table grants alike, so the table grant coming back shows up here as
    // thirteen columns rather than as nothing.
    return inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ column: string }>(
        `select column_name as "column"
           from information_schema.column_privileges
          where table_schema = 'public'
            and table_name = 'organizations'
            and grantee = 'authenticated'
            and privilege_type = 'UPDATE'
          order by column_name`,
      );

      expect(
        rows.map((row) => row.column),
        'authenticated may update a column the settings surface never offers',
      ).toEqual([
        // STORY 1.4c. `0006` adds `brand_accent` the same way `0005` added
        // `logo_path` — a third column grant, unioned with the other two — and
        // it sorts first because the set is compared in column order. Writable
        // for the same reason: it is the organization's own branding. What
        // stops the settings FORM from sending it is a TYPE rather than a
        // privilege (`@/organization/snapshot` makes the accent a shape
        // disjoint from the five fields and from the logo), and what stops it
        // holding a value this build cannot render is `0006`'s check constraint
        // rather than either.
        'brand_accent',
        'leave_year_start_day',
        'leave_year_start_month',
        // STORY 1.4b. `0005` adds `logo_path` with a SECOND column grant rather
        // than by re-granting the five, because column grants are unioned — and
        // that is exactly why this assertion reads the database instead of the
        // migration text: it is the only place the union is a single fact.
        //
        // Writable, and rightly: it is the organization's own pointer at its own
        // object. What stops the settings form from sending it is not a
        // privilege but a TYPE — `@/organization/snapshot` makes the logo write
        // a shape disjoint from the five fields — so a save of the identity
        // fields cannot carry a stale path over a logo uploaded seconds earlier.
        'logo_path',
        'name',
        'organization_type',
        'timezone',
      ]);
    });
  });

  it.skipIf(noDatabase).each(
    FIXTURES.flatMap((entry) =>
      (
        [
          { column: 'slug', value: 'hijacked-slug' },
          { column: 'locale', value: 'en' },
        ] as const
      ).map((target) => ({ ...entry, ...target })),
    ),
  )(
    'refuses an injected $fixture admin writing $column, which no policy could bound',
    async ({ slug, admin, column, value }) => {
      // THE WRITE THAT MATTERS MOST, and the one the policy alone never touched:
      // a policy constrains rows, so an entitled admin passed USING and WITH
      // CHECK and wrote whatever column they liked. Proved during the 1.4a
      // review — `update organizations set slug = 'hijacked-slug'` reported one
      // row updated — and it is the frozen "Never": the slug is the domain part
      // of every issued sign-in address (AD-12), so changing it refuses every
      // credential in the organization at once.
      //
      // Refused by the column grant, which raises rather than filtering, so this
      // is one of the few write refusals on this table that reaches the caller
      // as an error.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const before = await organizationById(client, caller.organizationId);

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, () =>
          client.query(`update organizations set ${column} = $1 where id = $2`, [
            value,
            caller.organizationId,
          ]),
        );
        await actAsOwner(client);

        expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
        expect(refusal.message, `${column} is still writable`).toContain('permission denied');
        expect(
          (await organizationById(client, caller.organizationId))?.slug,
          `the ${slug} organization slug moved, so every issued credential is refused`,
        ).toBe(before?.slug);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses an injected $fixture session with no organization claim at all',
    async ({ slug, admin }) => {
      // Every session minted before the hook existed looks like this, and the
      // claim's absence has to fail CLOSED on the write side as it does on the
      // read side: `nullif(...)::uuid` yields null, the comparison is null,
      // which is not true, which matches no row.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const before = await organizationById(client, caller.organizationId);

        await actAs(client, caller.authUserId, null);
        const attempted = await client.query('update organizations set name = $1 where id = $2', [
          `${THROWAWAY} renamed with no claim`,
          caller.organizationId,
        ]);
        await actAsOwner(client);

        expect(attempted.rowCount, `a claimless ${slug} session edited the organization`).toBe(0);
        expect((await organizationById(client, caller.organizationId))?.name).toBe(before?.name);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'affects no rows on the very next edit after the $fixture admin is banned',
    async ({ slug, admin }) => {
      // AD-10's freshness guarantee, on the new write policy, and the ONLY shape
      // that can prove it — `deferred-work.md` records the finding in full.
      // PostgreSQL applies the SELECT policy to an `update` as well as the write
      // policy whenever the statement reads a column, and the select policy
      // carries its own `is_active`; so the obvious `... where id = $1` form is
      // refused either way and says nothing about the write predicate. NO
      // `where`, and a CONSTANT on the right of `set`, is what isolates it.
      //
      // `organizations` makes that safe in a way `members` did not: the select
      // policy already narrows an unfiltered update to the caller's own row.
      //
      // PostgREST cannot issue an unfiltered write, so this case is
      // claims-injection only. It is a statement about the policy, not about the
      // transport.
      const settled = `${THROWAWAY} settled type`;

      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await actAs(client, caller.authUserId, caller.organizationId);
        const permitted = await client.query('update organizations set organization_type = $1', [
          settled,
        ]);
        await actAsOwner(client);

        expect(
          permitted.rowCount,
          `the ${slug} admin could not edit their own organization before the ban`,
        ).toBe(1);

        await client.query(
          `update auth.users set banned_until = now() + interval '1 day' where id = $1`,
          [caller.authUserId],
        );

        await actAs(client, caller.authUserId, caller.organizationId);
        const updated = await client.query('update organizations set organization_type = $1', [
          `${THROWAWAY} after the ban`,
        ]);
        const deleted = await client.query('delete from organizations');
        await actAsOwner(client);

        expect(updated.rowCount, 'a banned admin kept editing until the token expired').toBe(0);
        expect(deleted.rowCount, 'a banned admin deleted an organization').toBe(0);
        // The row itself, not only the count: a `rowCount` of zero from a
        // statement that nevertheless changed something is the one shape the two
        // assertions above could not see.
        expect(
          (await organizationById(client, caller.organizationId))?.organizationType,
          'a banned admin changed the organization',
        ).toBe(settled);
      });
    },
  );
});

describe('a direct API call edits an organization under exactly the same rules', () => {
  /**
   * Q1 and Q2 over the shipped transport, on the write path story 1.4a opened.
   *
   * Every case here targets a SEEDED organization row, which the member cases
   * above could avoid by aiming at a throwaway: there is no throwaway
   * organization to aim at, because the caller's claim pins the row it may
   * reach, and no session may create one. So the permitted case restores what it
   * changed in a `finally`, as the connection's own role, and every refusal case
   * asserts the row is untouched rather than creating something to touch.
   */
  it.skipIf(noApi).each(FIXTURES)(
    'permits the $fixture admin to edit their own organization over PostgREST',
    async ({ slug, admin }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      let restore: OrganizationRow | undefined;
      try {
        const own = await organizationId(client, slug);
        restore = await organizationById(client, own);
        expect(restore, `${slug} is not in the database`).toBeDefined();

        const response = await rest(`organizations?id=eq.${own}`, {
          token,
          method: 'PATCH',
          body: { organization_type: `${THROWAWAY} type` },
        });

        expect(response.status, 'a permitted update answers 204 with no body').toBe(204);
        expect(
          (await organizationById(client, own))?.organizationType,
          `the ${slug} admin could not edit their own organization`,
        ).toBe(`${THROWAWAY} type`);
      } finally {
        if (restore !== undefined) {
          await client.query('update organizations set organization_type = $1 where id = $2', [
            restore.organizationType,
            restore.id,
          ]);
        }
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'leaves the row unchanged when a $fixture member-role session patches the organization',
    async ({ slug, member }) => {
      // The refusal shape that surprises, and the reason this file re-reads
      // rather than expecting a throw: row level security refuses an update by
      // failing USING, so the statement matches no row and succeeds. PostgREST
      // answers 204 with no error body.
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const before = await organizationById(client, own);

        const response = await rest(`organizations?id=eq.${own}`, {
          token,
          method: 'PATCH',
          body: { name: `${THROWAWAY} renamed by a member` },
        });

        expect(response.status, 'a refused update affects zero rows and raises nothing').toBe(204);
        expect(
          (await organizationById(client, own))?.name,
          `a ${slug} member-role session renamed the organization`,
        ).toBe(before?.name);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(CROSS_TENANT)(
    'changes nothing when the $fixture admin patches the $otherFixture organization',
    async ({ slug, admin, otherSlug }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const other = await organizationId(client, otherSlug);
        const before = await organizationById(client, other);

        const response = await rest(`organizations?id=eq.${other}`, {
          token,
          method: 'PATCH',
          body: { name: `${THROWAWAY} cross-tenant rename` },
        });

        expect(response.status, 'a cross-tenant update matches no row and raises nothing').toBe(
          204,
        );
        expect(
          (await organizationById(client, other))?.name,
          `the ${slug} admin renamed ${otherSlug}`,
        ).toBe(before?.name);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses the $fixture admin an insert and a delete on organizations',
    async ({ slug, admin }) => {
      // FR-2 over the transport a browser actually uses. Insert has no USING
      // clause to fail, so the absence of an insert policy reaches the caller as
      // 42501 and HTTP 403; delete refuses silently, which is why the row is
      // re-read rather than the response being trusted.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const before = await client.query<{ total: number }>(
          'select count(*)::int as total from organizations',
        );

        const created = await rest('organizations', {
          token,
          method: 'POST',
          body: {
            slug: `${THROWAWAY}-inserted`,
            name: `${THROWAWAY} organization`,
            organization_type: `${THROWAWAY} type`,
            timezone: 'Etc/UTC',
            locale: 'hr',
            leave_year_start_month: 1,
            leave_year_start_day: 1,
          },
        });

        expect(created.status, 'a refused insert reaches the caller as HTTP 403').toBe(403);
        expect((await restRefusal(created)).code, 'an unmatched policy is 42501').toBe('42501');

        const removed = await rest(`organizations?id=eq.${own}`, { token, method: 'DELETE' });

        expect(removed.status, 'a refused delete affects zero rows and raises nothing').toBe(204);
        expect(
          await organizationById(client, own),
          `the ${slug} admin deleted their own organization`,
        ).toBeDefined();
        expect(
          (
            await client.query<{ total: number }>(
              'select count(*)::int as total from organizations',
            )
          ).rows[0]?.total,
          'the number of organizations changed',
        ).toBe(before.rows[0]?.total);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(
    FIXTURES.flatMap((entry) =>
      (
        [
          { column: 'slug', value: 'hijacked-slug' },
          { column: 'locale', value: 'en' },
        ] as const
      ).map((target) => ({ ...entry, ...target })),
    ),
  )(
    'refuses the $fixture admin a $column PATCH over PostgREST',
    async ({ slug, admin, column, value }) => {
      // The same refusal over the transport a browser actually uses, and the
      // literal reading of "refused identically via the interface and via a
      // direct API call": the settings surface draws no control for either
      // column, and this is what makes that a rule rather than a habit. A
      // privilege refusal raises, so PostgREST maps it to HTTP 403.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      let restore: string | undefined;
      try {
        const own = await organizationId(client, slug);
        const before = await organizationById(client, own);
        restore = before?.slug;

        const response = await rest(`organizations?id=eq.${own}`, {
          token,
          method: 'PATCH',
          body: { [column]: value },
        });
        const refusal = await restRefusal(response);

        expect(response.status, `a ${column} PATCH reaches the caller as HTTP 403`).toBe(403);
        expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
        expect(
          (await organizationById(client, own))?.slug,
          `the ${slug} organization slug moved, so every issued credential is refused`,
        ).toBe(before?.slug);
      } finally {
        // RESTORED EVEN THOUGH NOTHING SHOULD HAVE CHANGED, and the reason is
        // what this case is for: the write it attempts is the one that would
        // break every other suite if it ever succeeded. `slug` is the domain
        // part of every fixture credential, so a regression here without this
        // `finally` leaves `tokenFor` unable to sign anybody in and turns one
        // local failure into a file-wide cascade with no diagnosis in it.
        // Observed exactly that while probing the column grant.
        if (restore !== undefined) {
          await client.query('update organizations set slug = $1 where slug = $2', [
            restore,
            value,
          ]);
        }
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a blank $fixture name by shape rather than by policy',
    async ({ slug, admin }) => {
      // The one refusal on this surface that is the VALUE's rather than the
      // caller's, and the one the settings surface must name the field for
      // (UX-DR34). `btrim(name) <> ''` is a check on the table, so it refuses
      // whoever writes it — including an admin who is otherwise entitled — and
      // it raises 23514 rather than matching no row, which is what lets the
      // surface tell the two apart at all.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const before = await organizationById(client, own);

        const response = await rest(`organizations?id=eq.${own}`, {
          token,
          method: 'PATCH',
          body: { name: '   ' },
        });

        const refusal = await restRefusal(response);

        expect(response.status, 'a check violation reaches the caller as an error').toBe(400);
        expect(refusal.code, 'a check violation is 23514').toBe('23514');
        // The constant `@/organization/snapshot` reads to tell this refusal from
        // every other check on the table. Asserted against the live database, so
        // a constraint renamed by a later migration fails here rather than
        // silently turning a named field into a general message.
        expect(
          refusal.message,
          'the refusal does not name the constraint the surface reads',
        ).toContain('organizations_name_check');
        expect(
          (await organizationById(client, own))?.name,
          `the ${slug} organization was left with a blank name`,
        ).toBe(before?.name);
      } finally {
        await client.end();
      }
    },
    20_000,
  );
});

describe('the brand accent is an admin’s own to set and nobody else’s', () => {
  /**
   * STORY 1.4c, over the shipped transport, on the column `0006` opens.
   *
   * FOUR CLAIMS, and the fourth is the one that is not about permission at all.
   * An admin may set their own organization's accent; a member-role session may
   * not; an admin of another tenant changes nothing; and a key outside the
   * curated set is refused BY THE DATABASE, whoever asks. That last one is what
   * makes "an accent this build cannot render is unrepresentable" a fact rather
   * than a property of the `<select>` — the interface offers four options, and
   * an interface is not an enforcement point (AD-9 leaves no server tier, so a
   * terminal and the SPA make the same call).
   *
   * Every case targets a SEEDED organization row, for the reason the edit cases
   * above do: the caller's claim pins the row it may reach and no session may
   * create one. So the permitted case restores what it changed in a `finally`,
   * as the connection's own role, and every refusal case asserts the row is
   * untouched.
   */
  const CURATED = 'violet';

  it.skipIf(noApi).each(FIXTURES)(
    'permits the $fixture admin to set their own organization’s accent',
    async ({ slug, admin }) => {
      // The positive control every refusal below needs. A column grant that
      // never landed, or a policy nobody satisfies, produces the identical
      // "zero rows and no error" this file teaches a reader to read as a
      // refusal — so without this the whole block can ship broken and green.
      //
      // IT SELF-HEALS RATHER THAN RELYING ON ITS OWN `finally`. This case
      // cannot run inside `inRolledBackTransaction` the way the constraint and
      // seeding cases below do: it writes over the real transport, as a real
      // session, which is the whole point of it, and PostgREST holds no
      // transaction this file can roll back. So the restore is written three
      // ways rather than one — the `finally` here, a fixture-scoped reset in
      // `afterAll`, and the assertion below, which FAILS on a fixture that is
      // already tinted rather than quietly writing over it. A crashed run
      // therefore leaves a red test that names the leftover instead of a green
      // one that hides it, and the next `supabase db reset` clears it outright.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      let restore: OrganizationRow | undefined;
      try {
        const own = await organizationId(client, slug);
        restore = await organizationById(client, own);
        expect(restore, `${slug} is not in the database`).toBeDefined();
        expect(
          restore?.brandAccent,
          `${slug} already holds an accent — a previous run of this case did not restore it; run \`supabase db reset\``,
        ).toBeNull();

        const response = await rest(`organizations?id=eq.${own}`, {
          token,
          method: 'PATCH',
          body: { brand_accent: CURATED },
        });

        expect(response.status, 'a permitted update answers 204 with no body').toBe(204);
        expect(
          (await organizationById(client, own))?.brandAccent,
          `the ${slug} admin could not set their own accent`,
        ).toBe(CURATED);

        // AND BACK TO NONE, which is a write rather than an omission: null is
        // what "no accent" IS on this row, so an organization that cannot
        // return to it is one whose branding is a one-way door.
        const cleared = await rest(`organizations?id=eq.${own}`, {
          token,
          method: 'PATCH',
          body: { brand_accent: null },
        });

        expect(cleared.status, 'clearing the accent answers 204 with no body').toBe(204);
        expect(
          (await organizationById(client, own))?.brandAccent,
          `the ${slug} admin could not return to no accent`,
        ).toBeNull();
      } finally {
        // RESTORED UNCONDITIONALLY, including on the path where `restore` was
        // read and the write then failed: the value it holds is the value the
        // row had, so writing it back is a no-op when nothing moved and the
        // repair when something did.
        if (restore !== undefined) {
          await client.query('update organizations set brand_accent = $1 where id = $2', [
            restore.brandAccent,
            restore.id,
          ]);
        }
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture member-role session the accent, by the database and not the interface',
    async ({ slug, member }) => {
      // The matrix row: the surface offers a member no control at all — the
      // whole settings destination is admin-only (UX-DR32) — and this is what
      // holds when somebody skips the surface. Row level security refuses an
      // update by failing USING, so the statement matches no row and succeeds;
      // PostgREST answers 204 with no error body, and the assertion is that the
      // row did not move.
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const before = await organizationById(client, own);

        const response = await rest(`organizations?id=eq.${own}`, {
          token,
          method: 'PATCH',
          body: { brand_accent: CURATED },
        });

        expect(response.status, 'a refused update affects zero rows and raises nothing').toBe(204);
        expect(
          (await organizationById(client, own))?.brandAccent,
          `a ${slug} member-role session tinted the shell`,
        ).toBe(before?.brandAccent ?? null);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(CROSS_TENANT)(
    'changes nothing when the $fixture admin sets the $otherFixture accent',
    async ({ slug, admin, otherSlug }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const other = await organizationId(client, otherSlug);
        const before = await organizationById(client, other);

        const response = await rest(`organizations?id=eq.${other}`, {
          token,
          method: 'PATCH',
          body: { brand_accent: CURATED },
        });

        expect(response.status, 'a cross-tenant update matches no row and raises nothing').toBe(
          204,
        );
        expect(
          (await organizationById(client, other))?.brandAccent,
          `the ${slug} admin tinted ${otherSlug}`,
        ).toBe(before?.brandAccent ?? null);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses the $fixture admin an accent outside the curated set',
    async ({ slug, admin }) => {
      // THE CLAIM THE CURATION RESTS ON, and the one that is not about
      // permission: this caller is entitled, the column is granted, the policy
      // passes — and the write is still refused, by `0006`'s check constraint,
      // as 23514. That is what makes an unrenderable accent UNREPRESENTABLE
      // rather than merely absent from a dropdown: the four options in the
      // `<select>` are a convenience, and the database is the enforcement.
      //
      // A check violation RAISES rather than filtering, so this is one of the
      // few write refusals on this table that reaches the caller as an error —
      // PostgREST maps it to HTTP 400.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const before = await organizationById(client, own);

        const response = await rest(`organizations?id=eq.${own}`, {
          token,
          method: 'PATCH',
          body: { brand_accent: 'red' },
        });

        expect(
          response.ok,
          'an accent outside the curated set was accepted by the database',
        ).toBe(false);

        const refusal = await restRefusal(response);

        expect(refusal.code, 'a check-constraint refusal is 23514').toBe('23514');
        expect(
          refusal.message,
          'the refusal does not name the accent constraint',
        ).toContain('organizations_brand_accent_check');
        expect(
          (await organizationById(client, own))?.brandAccent,
          `the ${slug} organization holds an accent no build can render`,
        ).toBe(before?.brandAccent ?? null);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noDatabase)('admits exactly the curated keys, asked of the constraint itself', () => {
    // The set, read off the RUNNING database rather than off the migration
    // text, which is the only place the constraint is a single fact — a later
    // migration dropping and re-adding it with a fifth value would leave `0006`
    // reading exactly as it does today. `apps/web/src/organization/accent.test.ts`
    // compares the SPA's set to the migration; this is what pins the migration
    // to what actually shipped.
    return inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ definition: string }>(
        `select pg_get_constraintdef(c.oid) as definition
           from pg_constraint c
           join pg_class t on t.oid = c.conrelid
           join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'public'
            and t.relname = 'organizations'
            and c.conname = 'organizations_brand_accent_check'`,
      );

      const definition = rows[0]?.definition ?? '';

      expect(definition, 'no check constraint on organizations.brand_accent').not.toBe('');
      expect(
        [...definition.matchAll(/'([a-z]+)'/g)].map((found) => found[1]).sort(),
        'the database admits a different accent set from the one this build renders',
      ).toEqual(['amber', 'blue', 'green', 'violet']);
      // RED IS ABSENT DELIBERATELY AND PERMANENTLY. UX-DR4 reserves
      // `destructive` exclusively for an unresolved conflict, and the epic names
      // the case: the pilot is a fire department whose obvious accent is red.
      expect(definition, 'the database admits a red accent').not.toContain("'red'");
    });
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    'seeds the $fixture organization with no accent at all',
    async ({ slug }) => {
      // `0002:38-41` forbids a default that encodes one organization's answer,
      // and this is the other half of that: the column is nullable with no
      // default, so every organization starts untinted and the shell it renders
      // is the one the navigation chrome shipped with. A fixture seeded with an
      // accent would also make the permitted case above assert nothing.
      await inRolledBackTransaction(async (client) => {
        const own = await organizationId(client, slug);

        expect(
          (await organizationById(client, own))?.brandAccent,
          `${slug} is seeded with an accent`,
        ).toBeNull();
      });
    },
  );
});

describe('a branding asset is readable only within the organization that owns it', () => {
  /**
   * Q4, executed over the transport a browser actually uses (story 1.4b).
   *
   * This is the first block in this file that leaves PostgREST. The storage
   * service is a different process behind the same gateway, it authenticates
   * the same token, and `0005`'s three policies on `storage.objects` are the
   * whole of what stands between one tenant's branding and another's — exactly
   * as `0003`'s policies are for the two domain tables.
   *
   * THE REFUSAL SHAPES ARE DIFFERENT HERE, and reading them wrong is the
   * mistake this block exists to make impossible. PostgREST refuses an update
   * silently with 204 and no rows; the storage service refuses everything with
   * HTTP 400 and puts the real code in the body. So every assertion below reads
   * `statusCode` through `storageRefusal` and then re-reads the database as the
   * owner, which is the standard the rest of this file holds itself to.
   *
   * Every case writes to a SEEDED organization's folder, because there is no
   * throwaway organization to aim at: the caller's claim pins the folder it may
   * write to, and no session may create a tenant. So each case cleans up after
   * itself as the owner, and `afterAll` empties the bucket whatever happened —
   * both fixtures are seeded logo-less and the neutral-fallback case needs them
   * to stay that way.
   */

  it.skipIf(noApi).each(FIXTURES)(
    'permits the $fixture admin one object in their own folder, however often they replace it',
    async ({ slug, admin }) => {
      // The positive control every refusal below needs. A policy that refused
      // everything — misspelt, written `to anon`, or with a `with check` nobody
      // satisfies — produces the identical 403 this block teaches a reader to
      // read as a refusal, so without this the whole story can ship broken.
      //
      // And the second half is the matrix's "one object, never two": replacing
      // a logo is an upsert of the SAME key, which the service performs as an
      // update of the existing row — so this exercises the update policy as
      // well, and would notice a bucket accumulating a row per upload.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);

        const first = await putLogo(token, logoPath(own));
        expect(
          first.status,
          `the ${slug} admin could not write a logo in their own folder: ${await first.text()}`,
        ).toBe(200);

        const replaced = await putLogo(token, logoPath(own));
        expect(replaced.status, `the ${slug} admin could not replace their own logo`).toBe(200);

        expect(
          await logoObjects(client, own),
          `replacing the ${slug} logo left more than one object behind`,
        ).toEqual([logoPath(own)]);
      } finally {
        await removeLogoObjects(client, await organizationId(client, slug));
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture member-role session the write, and leaves the folder empty',
    async ({ slug, member }) => {
      // Q2 on the storage side: read and write are different populations here,
      // and a member-role account is in the first and not the second. Insert has
      // no USING clause to fail, so WITH CHECK raises rather than filtering —
      // which is why this asserts a code rather than re-reading a row count
      // alone. It does both anyway.
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const response = await putLogo(token, logoPath(own));

        expect(response.status, 'a refused write reaches the caller as an error').toBe(400);
        expect(
          (await storageRefusal(response)).code,
          'a row level security refusal on storage is 403',
        ).toBe('403');
        expect(
          await logoObjects(client, own),
          `a ${slug} member-role session wrote the organization logo`,
        ).toEqual([]);
      } finally {
        await removeLogoObjects(client, await organizationId(client, slug));
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noApi).each(CROSS_TENANT)(
    'refuses the $fixture admin an object in the $otherFixture folder',
    async ({ slug, admin, otherSlug }) => {
      // Q1 on the write side. The claim is the caller's own and the folder is
      // somebody else's, so the folder comparison is the only thing in the way
      // — which is exactly the conjunct a copy-paste from the members policy
      // would lose, since `storage.objects` has no `organization_id` column for
      // the habitual clause to name.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const other = await organizationId(client, otherSlug);
        const response = await putLogo(token, logoPath(other));

        expect(response.status, 'a cross-tenant write reaches the caller as an error').toBe(400);
        expect((await storageRefusal(response)).code, 'a policy refusal is 403').toBe('403');
        expect(
          await logoObjects(client, other),
          `the ${slug} admin wrote into the ${otherSlug} folder`,
        ).toEqual([]);
      } finally {
        await removeLogoObjects(client, await organizationId(client, otherSlug));
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses an anonymous write into the $fixture folder',
    async ({ slug }) => {
      // Every policy `0005` writes names `to authenticated`, so an anonymous
      // caller matches none. This is the case that would go quiet if a single
      // `to` clause were dropped — and nothing about the diff would look
      // different.
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const response = await putLogo(undefined, logoPath(own));

        expect(response.status, 'an anonymous write reaches the caller as an error').toBe(400);
        expect((await storageRefusal(response)).code, 'a policy refusal is 403').toBe('403');
        expect(
          await logoObjects(client, own),
          `an anonymous caller wrote into the ${slug} folder`,
        ).toEqual([]);
      } finally {
        await removeLogoObjects(client, await organizationId(client, slug));
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noApi).each(CROSS_TENANT)(
    'returns no bytes and no signed URL when the $fixture admin asks for the $otherFixture logo',
    async ({ slug, admin, otherSlug }) => {
      // THE ACCEPTANCE CLAUSE, and both halves of it: no signed URL and no
      // bytes. Asserting only the first would leave a policy that refused the
      // signing endpoint while the download served the object, which is two
      // different code paths through the same service.
      //
      // The object genuinely exists, written by the tenant that owns it, so a
      // refusal here is the policy rather than an absence.
      const owner = await tokenFor(
        FIXTURES.find((entry) => entry.slug === otherSlug)?.admin ?? '',
        otherSlug,
      );
      const intruder = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const other = await organizationId(client, otherSlug);
        const written = await putLogo(owner, logoPath(other));
        expect(written.status, `${otherSlug} could not write its own logo`).toBe(200);

        const signed = await signLogo(intruder, logoPath(other));
        const downloaded = await downloadLogo(intruder, logoPath(other));

        expect(signed.status, `the ${slug} admin was given a URL for the ${otherSlug} logo`).toBe(
          400,
        );
        expect((await storageRefusal(signed)).code, 'a hidden object reads as 404').toBe('404');
        expect(
          downloaded.status,
          `the ${slug} admin read the ${otherSlug} logo bytes`,
        ).toBe(400);
        expect((await storageRefusal(downloaded)).code, 'a hidden object reads as 404').toBe('404');
      } finally {
        await removeLogoObjects(client, await organizationId(client, otherSlug));
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'gives any active $fixture member a URL for their own logo, and an anonymous caller none',
    async ({ slug, admin, member }) => {
      // READ AND WRITE ARE DIFFERENT POPULATIONS, executed. The member-role
      // account may not write the logo and must be able to see it — it is on
      // every screen they open — so this is the positive control the refusals
      // above need on the SELECT policy specifically, which none of them
      // exercises. The anonymous half is in the same case because it is the
      // same object and the same endpoint, differing only in the session.
      const owner = await tokenFor(admin, slug);
      const reader = await tokenFor(member, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const written = await putLogo(owner, logoPath(own));
        expect(written.status, `${slug} could not write its own logo`).toBe(200);

        const signed = await signLogo(reader, logoPath(own));
        expect(
          signed.status,
          `a ${slug} member-role session could not see its own organization logo`,
        ).toBe(200);

        const anonymous = await signLogo(undefined, logoPath(own));
        expect(anonymous.status, `an anonymous caller was given a URL for the ${slug} logo`).toBe(
          400,
        );
        expect((await storageRefusal(anonymous)).code, 'a hidden object reads as 404').toBe('404');
      } finally {
        await removeLogoObjects(client, await organizationId(client, slug));
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses the $fixture admin a delete on their own object, which no policy admits',
    async ({ slug, admin }) => {
      // Nothing in this story removes a logo, so `0005` writes no DELETE policy
      // and the verb is refused by matching none at all — the same shape FR-2
      // gives `organizations`. Asserted rather than assumed, so the later story
      // that wants deletion has to delete this to get it.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        expect((await putLogo(token, logoPath(own))).status).toBe(200);

        const removed = await storageApi(`object/${LOGO_BUCKET}/${logoPath(own)}`, {
          token,
          method: 'DELETE',
        });

        // THE STATUS AND THE BODY, like every sibling here. `not.toBe(200)` was
        // satisfied by a 500, by a gateway timeout and by the storage service
        // being down — three ways of proving nothing about the policy.
        expect(removed.status, 'a refused delete reaches the caller as an error').toBe(400);
        expect(
          (await storageRefusal(removed)).code,
          'a delete with no matching policy is refused as 403',
        ).toBe('403');
        expect(
          await logoObjects(client, own),
          `the ${slug} admin deleted their own logo object`,
        ).toEqual([logoPath(own)]);
      } finally {
        await removeLogoObjects(client, await organizationId(client, slug));
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses the $fixture admin a file over the bucket size bound, at the bucket',
    async ({ slug, admin }) => {
      // MATRIX ROW 3, proved against the ENFORCEMENT POINT rather than against a
      // stub body. `@/organization/logo` also refuses an oversized file before
      // it sends it, which is a courtesy and not a gate: AD-9 leaves no server
      // tier, so the only thing standing between a 50 MB upload and the bucket
      // is `file_size_limit`, and reading the column out of `storage.buckets`
      // says nothing about whether the service honours it.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const response = await storageApi(`object/${LOGO_BUCKET}/${logoPath(own)}`, {
          token,
          method: 'POST',
          body: Buffer.alloc(3 * 1024 * 1024, 1),
          contentType: 'image/png',
        });

        expect(response.status, 'an oversized upload reaches the caller as an error').toBe(400);
        expect(
          (await storageRefusal(response)).code,
          'the bucket size bound is not enforced by the service',
        ).toBe('413');
        expect(
          await logoObjects(client, own),
          `the ${slug} admin wrote a file over the bucket bound`,
        ).toEqual([]);
      } finally {
        await removeLogoObjects(client, await organizationId(client, slug));
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses the $fixture admin a type outside the bucket allowlist, at the bucket',
    async ({ slug, admin }) => {
      // MATRIX ROW 4, and the same argument. The picker's `accept` hint is a
      // hint — a file renamed to `.png` and a direct API call both walk past it
      // — so the allowlist is the rule, and this is what executes it.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const response = await storageApi(`object/${LOGO_BUCKET}/${logoPath(own)}`, {
          token,
          method: 'POST',
          body: Buffer.from('%PDF-1.4', 'utf8'),
          contentType: 'application/pdf',
        });

        expect(response.status, 'a disallowed type reaches the caller as an error').toBe(400);
        expect(
          (await storageRefusal(response)).code,
          'the bucket type allowlist is not enforced by the service',
        ).toBe('415');
        expect(
          await logoObjects(client, own),
          `the ${slug} admin wrote a type the bucket does not accept`,
        ).toEqual([]);
      } finally {
        await removeLogoObjects(client, await organizationId(client, slug));
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses the $fixture admin any key but the one this story defines',
    async ({ slug, admin }) => {
      // "ONE OBJECT, NEVER TWO" AS A POLICY rather than as a client convention.
      // Scoped by folder alone, an entitled admin could write `<own id>/anything`
      // through a direct API call — as many objects as they liked, each one
      // perfectly isolated and each one unreclaimable, because `0005` writes no
      // DELETE policy. The key is pinned, so this is refused where it is made.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);

        for (const key of [`${own}/second-logo`, `${own}/nested/logo`, `${own}/logo.png`]) {
          const response = await storageApi(`object/${LOGO_BUCKET}/${key}`, {
            token,
            method: 'POST',
            body: ONE_PIXEL_PNG,
            contentType: 'image/png',
          });

          expect(response.status, `${key} was accepted as an error-free write`).toBe(400);
          expect((await storageRefusal(response)).code, `${key} is not refused by policy`).toBe(
            '403',
          );
        }

        expect(
          await logoObjects(client, own),
          `the ${slug} admin wrote a key outside the one this story defines`,
        ).toEqual([]);
      } finally {
        await removeLogoObjects(client, await organizationId(client, slug));
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses an injected $fixture admin an object the moment they are banned',
    async ({ slug, admin }) => {
      // AD-10's freshness guarantee on the new policies. Claims-injection
      // rather than HTTP, and deliberately: banning a fixture account over the
      // wire would have to be undone outside any transaction, and a failure
      // between the two would leave every other suite unable to sign that
      // account in. Inside a rolled-back transaction the ban never happened.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const folder = caller.organizationId;

        await actAs(client, caller.authUserId, folder);
        const permitted = await client.query(
          `insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)`,
          [LOGO_BUCKET, logoPath(folder), caller.authUserId],
        );
        await actAsOwner(client);

        expect(
          permitted.rowCount,
          `the ${slug} admin could not write a logo before the ban`,
        ).toBe(1);

        await client.query(
          `update auth.users set banned_until = now() + interval '1 day' where id = $1`,
          [caller.authUserId],
        );

        await actAs(client, caller.authUserId, folder);
        const refusal = await refusedThenContinue(client, () =>
          client.query(
            `insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)`,
            [LOGO_BUCKET, `${folder}/after-the-ban`, caller.authUserId],
          ),
        );
        const renamed = await client.query(
          `update storage.objects set name = $1 where bucket_id = $2 and name = $3`,
          [`${folder}/renamed`, LOGO_BUCKET, logoPath(folder)],
        );
        await actAsOwner(client);

        expect(refusal.code, 'a banned admin kept writing until the token expired').toBe('42501');
        expect(renamed.rowCount, 'a banned admin kept editing until the token expired').toBe(0);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses an injected $fixture session with no organization claim at all',
    async ({ slug, admin }) => {
      // Every session minted before the hook existed looks like this, and the
      // claim's absence has to fail CLOSED here as it does everywhere else:
      // `nullif(...)` yields null, the comparison is null, which is not true,
      // which matches no row and satisfies no check.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await actAs(client, caller.authUserId, null);
        const refusal = await refusedThenContinue(client, () =>
          client.query(
            `insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)`,
            [LOGO_BUCKET, logoPath(caller.organizationId), caller.authUserId],
          ),
        );
        await actAsOwner(client);

        expect(refusal.code, `a claimless ${slug} session wrote a logo`).toBe('42501');
        expect(await logoObjects(client, caller.organizationId)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses an injected $fixture admin an object at the bucket root, with no folder at all',
    async ({ slug, admin }) => {
      // The fail-closed direction. `storage.foldername` returns an empty array
      // for a name with no `/` in it, so `[1]` is null, and null compared to
      // anything is null — an object written at the root would be shared rather
      // than unreachable if the comparison were the other way round.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, () =>
          client.query(
            `insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)`,
            [LOGO_BUCKET, LOGO_OBJECT, caller.authUserId],
          ),
        );
        await actAsOwner(client);

        expect(refusal.code, `a ${slug} admin wrote an object outside every folder`).toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'refuses an injected $fixture admin renaming their object into the $otherFixture folder',
    async ({ slug, admin, otherSlug }) => {
      // The storage equivalent of moving a row between tenants, and the case a
      // USING-only policy fails: USING passes — the object IS the caller's — and
      // WITH CHECK is the only thing standing between an otherwise-legal update
      // and an object that has left the folder it was reachable in.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const other = await organizationId(client, otherSlug);

        await client.query(
          `insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)`,
          [LOGO_BUCKET, logoPath(caller.organizationId), caller.authUserId],
        );

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, () =>
          client.query(
            `update storage.objects set name = $1 where bucket_id = $2 and name = $3`,
            [logoPath(other), LOGO_BUCKET, logoPath(caller.organizationId)],
          ),
        );
        await actAsOwner(client);

        expect(refusal.code, 'a WITH CHECK refusal is 42501').toBe('42501');
        expect(
          refusal.message,
          `the ${slug} admin moved their object into the ${otherSlug} folder`,
        ).toContain('row-level security');
        expect(await logoObjects(client, other)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase)('holds exactly the three storage policies this story wrote', () => {
    // The exact set as a fact about the DATABASE rather than about the
    // migration text, which `test/supabase-scaffold.test.ts` reads. A fourth
    // policy — on either table, from any source, including a later Supabase
    // image that ships one — is what this notices.
    return inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ table: string; policy: string; command: string }>(
        `select tablename as "table", policyname as "policy", cmd as "command"
           from pg_policies where schemaname = 'storage' order by policyname`,
      );

      expect(
        rows.map((row) => `${row.table}.${row.policy} ${row.command}`),
        'the storage policy set changed',
      ).toEqual([
        'objects.organization_logos_insert_by_own_active_admin INSERT',
        'objects.organization_logos_select_by_own_active_member SELECT',
        'objects.organization_logos_update_by_own_active_admin UPDATE',
      ]);
      expect(
        rows.filter((row) => row.table === 'buckets'),
        'a policy on storage.buckets lets a session enumerate buckets',
      ).toEqual([]);
    });
  });

  it.skipIf(noDatabase)('holds exactly one bucket, private and bounded by size and type', () => {
    // A public bucket serves every object to anybody who can guess a path, with
    // no policy consulted at all — which would make all three policies above
    // decorative while every one of them still read as correct.
    return inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{
        id: string;
        public: boolean;
        limit: string;
        types: string[];
      }>(
        `select id, public, file_size_limit::text as "limit", allowed_mime_types as types
           from storage.buckets order by id`,
      );

      expect(rows.map((row) => row.id), 'the bucket set changed').toEqual([LOGO_BUCKET]);
      expect(rows[0]?.public, 'the branding bucket is public').toBe(false);
      expect(rows[0]?.limit, 'the branding bucket has no size bound').toBe('2097152');
      expect(rows[0]?.types, 'the branding bucket accepts a type it should not').toEqual([
        'image/png',
        'image/jpeg',
        'image/webp',
      ]);
    });
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    'leaves the $fixture fixture logo-less, which is the neutral-fallback case',
    async ({ slug }) => {
      // `seed.sql` writes no logo for either fixture and must not start: the
      // acceptance criterion about the neutral mark is only executable against
      // an organization that has none, and a fixture that quietly gained one
      // would make that case unreachable while every assertion here stayed
      // green.
      await inRolledBackTransaction(async (client) => {
        const { rows } = await client.query<{ path: string | null }>(
          'select logo_path as path from organizations where slug = $1',
          [slug],
        );

        expect(rows[0]?.path, `the ${slug} fixture was seeded with a logo`).toBeNull();
      });
    },
  );
});

describe('role and active state are re-read on the next statement, not at token expiry', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses the very next administrative write after the $fixture admin is downgraded',
    async ({ slug, admin, bystander }) => {
      // Two statements inside one transaction, with the downgrade between them.
      // A single-statement case could not tell a re-resolved answer from one
      // the STABLE helper cached for the duration of that statement, and the
      // whole point of AD-10 reading the role from the table is that the
      // account loses access on its next query rather than at token expiry.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await memberByUsername(client, slug, bystander);

        await actAs(client, caller.authUserId, caller.organizationId);
        const permitted = await client.query(
          'update members set leave_allowance_days = leave_allowance_days + 1 where id = $1',
          [target.id],
        );
        await actAsOwner(client);

        expect(permitted.rowCount, `the ${slug} admin could not write before the downgrade`).toBe(1);

        await client.query(`update members set role = 'member_role' where id = $1`, [caller.id]);

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusedNow = await client.query(
          'update members set leave_allowance_days = leave_allowance_days + 1 where id = $1',
          [target.id],
        );
        await actAsOwner(client);

        expect(
          refusedNow.rowCount,
          'a downgraded account kept its administrative write until the token expired',
        ).toBe(0);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'returns zero rows from both tables on the very next read after the $fixture account is banned',
    async ({ slug, admin }) => {
      // Both tables, because `organizations_select_own_organization` carries
      // its own `where access.is_active` and a members-only count leaves that
      // clause unasserted — and the migration says story 1.4 will build the
      // `organizations` write policy by copying this one, so a drift here
      // propagates rather than staying local.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await actAs(client, caller.authUserId, caller.organizationId);
        const before = await visibleToSession(client);
        await actAsOwner(client);

        expect(before.members, `the ${slug} account read no members before the ban`).toBeGreaterThan(0);
        expect(
          before.organizations,
          `the ${slug} account read no organization before the ban`,
        ).toBeGreaterThan(0);

        await client.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [
          caller.authUserId,
        ]);

        await actAs(client, caller.authUserId, caller.organizationId);
        const after = await visibleToSession(client);
        await actAsOwner(client);

        expect(after.members, 'a banned account kept reading members until the token expired').toBe(0);
        expect(
          after.organizations,
          'a banned account kept reading its organization until the token expired',
        ).toBe(0);
      });
    },
  );

  /** The number of members a session can currently see, as the owner sees it. */
  async function memberCount(client: Client, organization: string): Promise<number> {
    const { rows } = await client.query<{ total: number }>(
      'select count(*)::int as total from members where organization_id = $1',
      [organization],
    );
    const counted = rows[0]?.total;
    if (counted === undefined) throw new Error('the member count query returned no row');
    return counted;
  }

  it.skipIf(noDatabase).each(FIXTURES)(
    'affects no rows on the very next update or delete after the $fixture admin is banned',
    async ({ slug, admin }) => {
      // `is_active` gates the three write policies as well as the two read
      // ones, and nothing else asserts it for update and delete. Half of
      // AD-10's freshness guarantee is about writes: with the clause dropped, a
      // banned administrator keeps full write access.
      //
      // NO `where` CLAUSE, AND A CONSTANT ON THE RIGHT OF `set` — deliberately,
      // and this is the only shape that can prove the clause. PostgreSQL
      // applies the SELECT policy to an `update`/`delete` as well as the write
      // policy whenever the statement reads a column (a `where` on `id`, or
      // `leave_allowance_days + 1`), and the SELECT policy carries its own
      // `is_active`. So the obvious `... where id = $1` form is refused either
      // way and proves nothing about the write policy at all — verified live:
      // with the clause dropped from all three write policies, `update members
      // set leave_allowance_days = 7 where id = $1` still affects zero rows
      // while the column-free form updates every own-organization row.
      //
      // PostgREST cannot issue an unfiltered write, which is why this case is
      // claims-injection only. It is a statement about the policy, not about
      // the transport.
      const settled = 7;

      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = await memberCount(client, caller.organizationId);

        await actAs(client, caller.authUserId, caller.organizationId);
        const permitted = await client.query('update members set leave_allowance_days = $1', [
          settled,
        ]);
        await actAsOwner(client);

        expect(
          permitted.rowCount,
          `the ${slug} admin could not write to their own organization before the ban`,
        ).toBe(own);

        await client.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [
          caller.authUserId,
        ]);

        await actAs(client, caller.authUserId, caller.organizationId);
        const updated = await client.query('update members set leave_allowance_days = $1', [
          settled + 1,
        ]);
        const deleted = await client.query('delete from members');
        await actAsOwner(client);

        expect(updated.rowCount, 'a banned admin kept updating until the token expired').toBe(0);
        expect(deleted.rowCount, 'a banned admin kept deleting until the token expired').toBe(0);

        // The rows themselves, not only the counts: a `rowCount` of zero from a
        // statement that nevertheless changed something would be the one shape
        // these two assertions could not see.
        const { rows: survivors } = await client.query<{ total: number; settled: number }>(
          `select count(*)::int as total,
                  count(*) filter (where leave_allowance_days = $2)::int as settled
             from members where organization_id = $1`,
          [caller.organizationId, settled],
        );
        expect(survivors[0]?.total, 'a banned admin deleted rows').toBe(own);
        expect(survivors[0]?.settled, 'a banned admin changed rows').toBe(own);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses the very next insert with 42501 after the $fixture admin is banned',
    async ({ slug, admin }) => {
      // Insert is the one write that raises rather than filtering, so it needs
      // its own case: the refusal aborts the transaction, which is why nothing
      // follows it here.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        // Both accounts up front: `members.auth_user_id` is a foreign key, and
        // after the refusal no further statement in this transaction can run.
        const { rows: accounts } = await client.query<{ id: string }>(
          `insert into auth.users (id, email)
           select gen_random_uuid(), gen_random_uuid()::text || '@' || $1
             from generate_series(1, 2)
           returning id`,
          [`${THROWAWAY}.shift.invalid`],
        );
        const [beforeBan, afterBan] = accounts;
        if (beforeBan === undefined || afterBan === undefined) {
          throw new Error('auth.users insert returned fewer than two rows');
        }

        await actAs(client, caller.authUserId, caller.organizationId);
        const permitted = await client.query(
          `insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
           values ($1, $2::uuid, $3, $2::uuid::text, 'member_role', 20)`,
          [caller.organizationId, beforeBan.id, `${THROWAWAY} before the ban`],
        );
        await actAsOwner(client);

        expect(permitted.rowCount, `the ${slug} admin could not insert before the ban`).toBe(1);

        await client.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [
          caller.authUserId,
        ]);

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refused(() =>
          client.query(
            `insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
             values ($1, $2::uuid, $3, $2::uuid::text, 'member_role', 20)`,
            [caller.organizationId, afterBan.id, `${THROWAWAY} after the ban`],
          ),
        );

        expect(refusal.code, 'a banned admin kept inserting until the token expired').toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'treats a ban that has already expired on the $fixture account as active',
    async ({ slug, admin }) => {
      // The negative control for both ban cases. `banned_until is null` alone
      // would pass them and make every lifted ban permanent — the column
      // records when a ban ends, not whether one was ever imposed.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);

        await client.query(`update auth.users set banned_until = now() - interval '1 day' where id = $1`, [
          caller.authUserId,
        ]);

        await actAs(client, caller.authUserId, caller.organizationId);
        const visible = await visibleToSession(client);
        const written = await client.query(
          'update members set leave_allowance_days = leave_allowance_days + 1 where id = $1',
          [target.id],
        );
        await actAsOwner(client);

        expect(visible.members, `an expired ban still hid members from ${slug}`).toBeGreaterThan(0);
        expect(
          visible.organizations,
          `an expired ban still hid the organization from ${slug}`,
        ).toBeGreaterThan(0);
        expect(written.rowCount, `an expired ban still refused a ${slug} admin write`).toBe(1);
      });
    },
  );
});

describe('the helper other empty result: the caller own member row stops existing', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'closes the $fixture session on the very next statement after its member row is deleted',
    async ({ slug, admin }) => {
      // The third way `current_member_access()` can stop yielding a row, and
      // the one no case reached: demotion and ban both leave the row in place
      // and change what it says, while stories 1.5 and 1.6 delete member rows
      // outright. Two statements in one transaction, for the same reason every
      // other freshness case is: a STABLE function caches within a statement,
      // so a single-statement version would prove the cache and not the
      // freshness.
      //
      // The delete is the owner's, not the session's — an admin deleting its
      // own row is a different rule (the zero-admins trigger) and not what this
      // is about.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await actAs(client, caller.authUserId, caller.organizationId);
        const before = await visibleToSession(client);
        await actAsOwner(client);

        await client.query('delete from members where id = $1', [caller.id]);

        await actAs(client, caller.authUserId, caller.organizationId);
        const after = await visibleToSession(client);
        const written = await refusedThenContinue(client, () =>
          client.query(
            `insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
             values ($1, gen_random_uuid(), $2, gen_random_uuid()::text, 'member_role', 20)`,
            [caller.organizationId, `${THROWAWAY} after deletion`],
          ),
        );
        await actAsOwner(client);

        expect(before.members, `${slug} could not read its own members to begin with`).toBeGreaterThan(0);
        expect(
          after.members,
          `a deleted ${slug} member still read the member list on the next statement`,
        ).toBe(0);
        expect(
          after.organizations,
          `a deleted ${slug} member still read the organization row on the next statement`,
        ).toBe(0);
        expect(written.code, 'a write with no member row behind it is refused 42501').toBe('42501');
      });
    },
  );
});

describe('the member list is one organization own list, at the scale Q20 names', () => {
  /**
   * Story 1.5a: `/ljudi` reads the whole member list through one PostgREST
   * call, and `0002:141-148` names story 1.5 as the one that proves that read
   * holds at several hundred members. The index comment asks for the scale to
   * be PROVED rather than assumed, and `ARCHITECTURE-SPINE.md:337` asks for the
   * same thing about Q17's budget.
   *
   * THE SCALE ROWS ARE GENERATED HERE AND NOT IN `supabase/seed.sql`. The seed
   * is shared by every suite and several assertions count fixture members
   * exactly — `provisioning.test.ts` among them — so growing it to Q20 scale
   * would rewrite unrelated expectations and slow every `db reset`. The index
   * comment asks for the scale to be proved, not for the pilot organization to
   * be enlarged.
   *
   * THE FOLLOW-UP INSERTS KEY OFF THE IDS THIS BLOCK JUST GENERATED, in one
   * statement, and never re-select by the throwaway domain. Re-selecting would
   * adopt every throwaway account the rest of this file has created into the
   * pilot organization — and, worse, would adopt any left behind by an
   * interrupted earlier run.
   *
   * CLEANED UP IN A `finally` rather than only at file scope. `afterAll`
   * already sweeps the throwaway domain, and it is not enough on its own: a
   * failure here would leave four hundred members in the pilot organization for
   * every case that runs after this one, so the failure would be reported as
   * half a dozen unrelated ones.
   */

  /** Q20's "several hundred", as the number this block actually inserts. */
  const SCALE = 400;

  /** Q17's budget for a surface read, in milliseconds
   *  (`ARCHITECTURE-SPINE.md:337`). */
  const READ_BUDGET_MS = 2000;

  /** The columns `apps/web/src/members/list.ts` selects, written out here
   *  rather than imported: this file asserts what the DATABASE does, and
   *  reading the list from the client would let a renamed column agree with
   *  itself on both sides while every existing read broke. */
  const LIST_COLUMNS = 'organization_id,id,name,email,role,leave_allowance_days';

  /**
   * `count` members in one organization, in ONE statement, returning the
   * `auth.users` ids so the cleanup can name exactly what it created.
   *
   * Identities are inserted alongside the accounts for the reason
   * `addThrowawayMember` does it: `provisioning.test.ts` asserts one identity
   * per account, and a run that left four hundred accounts without one would
   * fail that file rather than this one.
   */
  async function addScaleMembers(
    client: Client,
    organization: string,
    count: number,
  ): Promise<string[]> {
    const { rows } = await client.query<{ id: string }>(
      `with generated as (
         select gen_random_uuid() as id, ordinal
           from generate_series(1, $2) as ordinal
       ),
       created_users as (
         insert into auth.users (
           instance_id, id, aud, role, email, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
           confirmation_token, recovery_token, email_change, email_change_token_new
         )
         select '00000000-0000-0000-0000-000000000000',
                generated.id,
                'authenticated',
                'authenticated',
                generated.id::text || '@' || $3,
                now(),
                jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
                '{}'::jsonb,
                now(),
                now(),
                '', '', '', ''
           from generated
         returning id
       ),
       created_identities as (
         insert into auth.identities (
           provider_id, user_id, identity_data, provider, created_at, updated_at
         )
         select u.id::text,
                u.id,
                jsonb_build_object(
                  'sub', u.id::text,
                  'email', u.id::text || '@' || $3,
                  'email_verified', true,
                  'phone_verified', false
                ),
                'email',
                now(),
                now()
           from created_users u
         returning user_id
       ),
       created_members as (
         insert into members (
           organization_id, auth_user_id, name, username, email, role, leave_allowance_days
         )
         select $1,
                u.id,
                $4 || ' ' || lpad(row_number() over (order by u.id)::text, 4, '0'),
                -- \`0007\`: lowercase, no whitespace, no at-sign, and unique
                -- per organization in ANY casing. The account id satisfies all
                -- four and needs no counter of its own.
                u.id::text,
                -- A tenth of them carry no address, which is the case the
                -- surface sorts last in both directions and the schema permits
                -- outright (\`0002:135\`).
                case when row_number() over (order by u.id) % 10 = 0
                     then null
                     else u.id::text || '@' || $3
                end,
                'member_role',
                20
           from created_users u
         returning auth_user_id
       )
       select auth_user_id as id
         from created_members`,
      [organization, count, `${THROWAWAY}.shift.invalid`, `${THROWAWAY} scale`],
    );

    const created = rows.map((row) => row.id);

    // Asserted rather than assumed: a CTE that inserted nothing would leave
    // every assertion below comparing the seeded four against the seeded four
    // and passing having proved nothing about scale.
    //
    // AND IT CLEANS UP WHAT IT MADE BEFORE IT THROWS. The statement is atomic,
    // so a short answer means the generator disagreed with the request rather
    // than that half of it landed — but the rows it DID create are committed,
    // and an assertion thrown from here escapes before the caller's own
    // `finally` has anything to clean up with, since it never receives the ids.
    // Every later case in this file would then run against an organization with
    // several hundred extra members.
    if (created.length !== count) {
      await client.query('delete from auth.users where id = any($1::uuid[])', [created]);
    }

    expect(created, 'the scale insert created no members').toHaveLength(count);

    return created;
  }

  it.skipIf(noApi).each(FIXTURES)(
    'returns the $fixture list with every column the surface renders, and no other organization rows',
    async ({ slug, admin }) => {
      // The read the surface actually makes, with the column list it actually
      // sends — `members?select=organization_id,id,name,email,role,
      // leave_allowance_days` — rather than `select=*`, which is a different
      // request and the one already covered above.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const rows = await restRows(`members?select=${LIST_COLUMNS}`, { token });

        expect(rows.length, `${slug} read no members at all`).toBeGreaterThan(0);
        expect(
          [...new Set(rows.map((row) => row['organization_id']))],
          `a ${slug} session read members belonging to another organization`,
        ).toEqual([own]);
        // Q5, asserted against what comes BACK rather than against what was
        // asked for: no health data and no absence-reason field reaches the
        // client, because the six columns the surface names are the six it gets.
        for (const row of rows) {
          expect([...Object.keys(row)].sort(), `${slug} read a column nothing asked for`).toEqual(
            [...LIST_COLUMNS.split(',')].sort(),
          );
        }
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'hands a $fixture member-role session the same list, because the database is the enforcement point',
    async ({ slug, member, admin }) => {
      // THE CLAIM THE WHOLE ROUTE GUARD RESTS ON, and nothing pinned it.
      // `/ljudi` refuses a member-role session in the INTERFACE, and both the
      // spec and `routes/ljudi.tsx` say out loud that this protects nothing
      // against a direct API call: `members_select_own_organization` carries no
      // role filter by design (`0003:286-288`), because a member has to read the
      // list to see who is on a team. If that were ever to stop being true, the
      // guard would silently become a boundary the application relies on — and
      // AD-10 says the boundary is the database. So the fact is asserted rather
      // than described.
      const memberRows = await restRows(`members?select=${LIST_COLUMNS}`, {
        token: await tokenFor(member, slug),
      });
      const adminRows = await restRows(`members?select=${LIST_COLUMNS}`, {
        token: await tokenFor(admin, slug),
      });

      expect(memberRows.length, `a ${slug} member-role session read no members`).toBeGreaterThan(0);
      // THE SAME ROWS, not merely some rows: the member sees exactly what the
      // admin sees, which is what makes the route guard an IA decision about
      // which SCREEN a level reaches rather than a data one.
      expect(
        memberRows.map((row) => row['id']).sort(),
        `a ${slug} member-role session reads a different list from its admin`,
      ).toEqual(adminRows.map((row) => row['id']).sort());
      // Including the columns the surface renders — the addresses and the leave
      // allowances the guard exists to keep off a member's screen are reachable
      // to them over REST, and that is the state AD-10 describes.
      expect([...Object.keys(memberRows[0] ?? {})].sort()).toEqual(
        [...LIST_COLUMNS.split(',')].sort(),
      );
    },
    20_000,
  );

  it.skipIf(noApi)(
    'keeps the list one organization own at several hundred members, inside Q17 budget',
    async () => {
      const client = await connect();
      let created: string[] = [];

      try {
        const pilot = FIXTURES[0];
        const other = FIXTURES[1];
        const own = await organizationId(client, pilot.slug);
        const seeded = await restRows('members?select=id', {
          token: await tokenFor(pilot.admin, pilot.slug),
        });
        // READ BEFORE, COMPARED AFTER, rather than asserted against the seed's
        // own three. Earlier cases in this file commit throwaway members into
        // both fixtures and clean them up in `afterAll`, so "three" is true of
        // `seed.sql` and not of the database at the moment this case runs —
        // and an assertion that is only true in isolation is one that fails for
        // a reason that has nothing to do with what it guards. The claim is
        // that the scale insert changed this organization by EXACTLY nothing.
        const otherBefore = await restRows('members?select=id', {
          token: await tokenFor(other.admin, other.slug),
        });

        created = await addScaleMembers(client, own, SCALE);

        const token = await tokenFor(pilot.admin, pilot.slug);
        const started = Date.now();
        const rows = await restRows(`members?select=${LIST_COLUMNS}`, { token });
        const elapsed = Date.now() - started;

        // EXACTLY the seeded members plus the ones this block created. Not
        // "at least": a read that silently truncated at `max_rows` would
        // satisfy a lower bound, and truncation is precisely what
        // `members/list.ts` refuses on the client.
        expect(rows, 'the scale read did not return every member of the organization').toHaveLength(
          seeded.length + SCALE,
        );
        expect(
          [...new Set(rows.map((row) => row['organization_id']))],
          'the scale read reached more than one organization',
        ).toEqual([own]);

        // THE OTHER FIXTURE IS UNTOUCHED, and asserted EXACTLY rather than as
        // "fewer than four hundred": the failure worth catching is the scale
        // insert having adopted rows into the wrong organization, and a bound
        // that loose passes while a three-member organization has become four
        // hundred and three.
        expect(otherBefore.length, 'the other fixture had no members to begin with').toBeGreaterThan(
          0,
        );
        expect(
          await restRows('members?select=id', {
            token: await tokenFor(other.admin, other.slug),
          }),
          `the scale insert changed how many members ${other.fixture} has`,
        ).toHaveLength(otherBefore.length);

        // THE EXACT COUNT, OBSERVED RATHER THAN ASSUMED, and this is the one
        // place it can be. `members/list.ts` refuses a truncated answer by
        // comparing the rows it received against the count the transport
        // reported — and it FAILS OPEN when that count is `null`, which is the
        // right call for a header a proxy might strip but useless as a defence
        // if the transport never sends one at all. `list.test.ts` cannot tell
        // the difference: it hands the reader whatever count it likes. Only a
        // real request to a real PostgREST can say whether `Prefer: count=exact`
        // produces a number, and the surface's whole truncation defence rests on
        // it doing so.
        //
        // Asked exactly the way the client asks — supabase-js turns
        // `select(columns, { count: 'exact' })` into this header — and read off
        // `Content-Range`, whose `*/N` tail is where the count arrives.
        const counted = await rest(`members?select=${LIST_COLUMNS}`, {
          token,
          prefer: 'count=exact',
        });
        const range = counted.headers.get('content-range');

        expect(range, 'PostgREST returned no Content-Range for an exact count').not.toBeNull();
        const reported = Number((range ?? '').split('/')[1]);

        expect(
          reported,
          `Content-Range reported "${String(range)}" — the truncation defence has no count to compare against`,
        ).toBe(seeded.length + SCALE);
        expect(Number.isNaN(reported), 'the reported count is not a number').toBe(false);

        // Q17, measured rather than assumed. One local round trip over one
        // range scan on `members_organization_id_id_key`; if this ever reads as
        // noise rather than as a property of the read it belongs on the
        // deferred ledger, not at a loosened threshold (the spec's recorded
        // disagreement says exactly that).
        expect(
          elapsed,
          `reading ${String(rows.length)} members took ${String(elapsed)}ms`,
        ).toBeLessThan(READ_BUDGET_MS);
      } finally {
        // IN A `finally`, not only in `afterAll`. Four hundred members left in
        // the pilot organization would fail every later case in this file for
        // reasons that have nothing to do with what broke — and they are named
        // by the ids this block generated rather than found by a pattern, so a
        // concurrent throwaway account belonging to some other case is never
        // swept up with them.
        //
        // NESTED, so the connection is returned even when the DELETE is what
        // fails. Written as two statements in one `finally`, a delete that threw
        // — a lock timeout, a connection already broken by whatever failed above
        // — skipped `client.end()` and leaked the connection for the rest of the
        // run, which surfaces much later as other cases waiting on a pool that
        // never refills.
        try {
          if (created.length > 0) {
            await client.query('delete from auth.users where id = any($1::uuid[])', [created]);
          }
        } finally {
          await client.end();
        }
      }
    },
    120_000,
  );
});

describe('0007 gives the issued username a shape and a per-organization unique', () => {
  /**
   * WHY THESE ARE CONSTRAINTS AND NOT REGEXES IN THE EDGE FUNCTION.
   * `members_update_by_own_active_admin` (`0003:331-351`) admits an active
   * admin to EVERY COLUMN of every row in their own organization through an
   * ordinary PostgREST PATCH — so a username rule that lives only in
   * `admin-auth` is a rule the one caller who can break it never meets. Every
   * case below writes as the CALLER, through the same transport the SPA uses or
   * with the caller's claims injected, because that is the path the rule has to
   * survive.
   */

  it.skipIf(noDatabase).each(FIXTURES)(
    'stores each $fixture member the username their own address is built from',
    async ({ slug }) => {
      // THE INVARIANT THE DUPLICATION BUYS AND CANNOT ENFORCE: `members.username`
      // is the local part of `auth.users.email`, and nothing in PostgreSQL can
      // hold the two together across the `auth` boundary — which is why
      // `updateUserById` writes both and carries a compensating restore.
      //
      // SCOPED AWAY FROM THROWAWAY ROWS, deliberately. This file creates
      // members with usernames unrelated to their addresses on purpose, so an
      // unscoped invariant would go red on a run that died before its cleanup —
      // reporting the previous run's crash rather than what actually broke.
      const client = await connect();

      try {
        const { rows } = await client.query<{ scanned: number; disagreeing: number }>(
          `select count(*)::int as scanned,
                  count(*) filter (
                    where m.username is distinct from split_part(u.email, '@', 1)
                  )::int as disagreeing
             from members m
             join auth.users u on u.id = m.auth_user_id
             join organizations o on o.id = m.organization_id
            where o.slug = $1
              and u.email not like $2`,
          [slug, `%@${THROWAWAY}.shift.invalid`],
        );

        expect(rows[0]?.scanned, `no ${slug} members to check the invariant over`).toBeGreaterThan(1);
        expect(
          rows[0]?.disagreeing,
          `a ${slug} member stores a username that is not the local part of their address`,
        ).toBe(0);
      } finally {
        await client.end();
      }
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses two $fixture usernames that differ only in case',
    async ({ slug, admin }) => {
      // `Ana.Kovac` and `ana.kovac` are TWO ROWS AND ONE ADDRESS: the address
      // builder lowercases, so a case-sensitive unique would let the database
      // hold a collision the address space cannot express — and the second
      // account would authenticate as the first. The index is on
      // `lower(username)` for exactly this.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const first = await addThrowawayMember(client, caller.organizationId);
        const second = await addThrowawayMember(client, caller.organizationId);

        await client.query('update members set username = $2 where id = $1', [
          first.id,
          'petra.babic.case',
        ]);

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, () =>
            client.query('update members set username = $2 where id = $1', [
            second.id,
            'Petra.Babic.Case',
          ]),
        );
        await actAsOwner(client);

        // THE CHECK FIRES FIRST, and that is the right order: an uppercase
        // username is refused outright, so the unique never has to decide. The
        // two are not redundant — see the index case below, which asserts the
        // unique is case-insensitive as well, because a check relaxed one day
        // for a case nobody anticipated must not take the collision guard with
        // it.
        expect(refusal.code, 'an uppercase username was admitted').toBe('23514');
      });
    },
  );

  it.skipIf(noDatabase)('scopes the unique to the organization AND to the folded case', () => {
    // READ OFF THE RUNNING DATABASE rather than off the migration text, which
    // is what makes it a fact about the schema rather than about a string in a
    // file. It cannot be asserted by writing two colliding rows: the check
    // constraint refuses an uppercase username before the index is consulted,
    // so the only way to see WHICH expression the index is on is to look.
    //
    // `Ana.Kovac` and `ana.kovac` are two rows and ONE address — the builder
    // lowercases — so a case-sensitive unique would let the database hold a
    // collision the address space cannot express, and the second account would
    // authenticate as the first.
    return connect().then(async (client) => {
      try {
        const { rows } = await client.query<{ definition: string }>(
          `select indexdef as definition
             from pg_indexes
            where schemaname = 'public'
              and tablename = 'members'
              and indexdef ilike '%username%'`,
        );

        expect(rows, 'members carries no unique index over username at all').toHaveLength(1);
        expect(rows[0]?.definition, 'the username index is not unique').toContain('UNIQUE');
        expect(
          rows[0]?.definition,
          'the username unique is case-sensitive, so two casings of one address can coexist',
        ).toContain('lower(username)');
        expect(
          rows[0]?.definition,
          'the username unique is not scoped to the organization',
        ).toContain('organization_id');
      } finally {
        await client.end();
      }
    });
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second $fixture member holding a username already issued',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const first = await addThrowawayMember(client, caller.organizationId);
        const second = await addThrowawayMember(client, caller.organizationId);

        await client.query('update members set username = $2 where id = $1', [
          first.id,
          'marko.novak.taken',
        ]);

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, () =>
            client.query('update members set username = $2 where id = $1', [
            second.id,
            'marko.novak.taken',
          ]),
        );
        await actAsOwner(client);

        expect(refusal.code, 'a duplicate username was admitted').toBe('23505');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'lets $fixture and the other tenant both issue the same username',
    async ({ slug, admin }) => {
      // The unique is scoped to the ORGANIZATION for the same reason the
      // address is namespaced by the slug: two tenants may both issue the
      // username an operator finds obvious, and a global unique would make the
      // first organization to use `ivan` own it everywhere.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const other = FIXTURES.find((entry) => entry.slug !== slug);
        if (other === undefined) throw new Error('this file needs two fixtures');

        const here = await addThrowawayMember(client, caller.organizationId);
        const there = await addThrowawayMember(client, await organizationId(client, other.slug));

        await client.query('update members set username = $2 where id = $1', [here.id, 'ivan']);
        const across = await client.query('update members set username = $2 where id = $1', [
          there.id,
          'ivan',
        ]);

        expect(across.rowCount, 'one tenant issuing a username blocked the other').toBe(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture username carrying whitespace or a second at-sign',
    async ({ slug, admin }) => {
      // Either makes the address built from it something other than the address
      // the account holds — so it authenticates nothing, silently, for ever.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);

        for (const attempted of ['ivan maric', 'ivan@maric', '']) {
          await actAs(client, caller.authUserId, caller.organizationId);
          const refusal = await refusedThenContinue(client, () =>
            client.query('update members set username = $2 where id = $1', [target.id, attempted]),
          );
          await actAsOwner(client);

          expect(refusal.code, `the username "${attempted}" was admitted`).toBe('23514');
        }
      });
    },
  );
});

describe('an admin creates and edits a member through the same policies the SPA uses', () => {
  it.skipIf(noApi).each(FIXTURES)(
    'lets the $fixture admin insert a member and read it straight back',
    async ({ slug, admin }) => {
      // THE POSITIVE CONTROL FOR THE WHOLE WRITE PATH, and it is the shape
      // `admin-auth` performs: the `auth.users` row exists first (the foreign
      // key forces it), and the `members` row goes through the CALLER'S token
      // so `members_insert_by_own_active_admin` and AD-11's attribution both
      // apply. A policy that refused every insert would satisfy every refusal
      // case in this file.
      const token = await tokenFor(admin, slug);
      const client = await connect();

      try {
        const own = await organizationId(client, slug);
        const { rows } = await client.query<{ id: string }>(
          `insert into auth.users (
             instance_id, id, aud, role, email, email_confirmed_at,
             raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
             confirmation_token, recovery_token, email_change, email_change_token_new
           )
           select '00000000-0000-0000-0000-000000000000',
                  gen_random_uuid(), 'authenticated', 'authenticated',
                  gen_random_uuid()::text || '@' || $1, now(),
                  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
                  '{}'::jsonb, now(), now(), '', '', '', ''
           returning id`,
          [`${THROWAWAY}.shift.invalid`],
        );
        const account = rows[0];
        if (account === undefined) throw new Error('auth.users insert returned no row');

        const issued = `${THROWAWAY}-${account.id}`;
        const created = await rest('members', {
          token,
          method: 'POST',
          body: {
            organization_id: own,
            auth_user_id: account.id,
            name: `${THROWAWAY} created`,
            username: issued,
            email: null,
            role: 'member_role',
            leave_allowance_days: 22,
          },
        });

        expect(created.status, 'a permitted insert answers 201').toBe(201);

        // READ BACK AS THE CALLER, through the same transport: an insert the
        // policy admitted and the select policy hides would be an account
        // nobody can see they created.
        const found = await restRows(`members?username=eq.${issued}&select=username,role`, {
          token,
        });

        expect(found).toEqual([{ username: issued, role: 'member_role' }]);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture member-role session renaming anybody, silently',
    async ({ slug, member }) => {
      // The update policy fails USING, so the statement matches nothing and
      // raises nothing — which is why this reads the row back rather than
      // expecting a throw.
      const token = await tokenFor(member, slug);
      const client = await connect();

      try {
        const target = await addThrowawayMember(client, await organizationId(client, slug));
        const attempted = `${THROWAWAY}-renamed-by-a-member`;
        const response = await rest(`members?id=eq.${target.id}`, {
          token,
          method: 'PATCH',
          body: { username: attempted },
        });

        expect(response.status, 'a refused update matches no row and raises nothing').toBe(204);

        const { rows } = await client.query<{ username: string }>(
          'select username from members where id = $1',
          [target.id],
        );

        expect(rows[0]?.username, `a ${slug} member renamed somebody`).not.toBe(attempted);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses demoting the last $fixture admin, at commit',
    async ({ slug, admin }) => {
      // Q6's other half, and the reason the trigger is DEFERRABLE INITIALLY
      // DEFERRED: only the state at COMMIT is a fact about the organization.
      // The edit form can express this — the control offers both levels — and
      // the database is what says no, which is the same division every other
      // refusal on that surface follows.
      const client = await connect();

      try {
        const caller = await memberByUsername(client, slug, admin);

        await client.query('begin');
        await actAs(client, caller.authUserId, caller.organizationId);
        // The statement itself SUCCEEDS: the trigger is deferred, so nothing is
        // refused until the transaction tries to commit.
        const demoted = await client.query(
          "update members set role = 'member_role' where id = $1",
          [caller.id],
        );

        expect(demoted.rowCount, `the ${slug} admin could not reach their own row`).toBe(1);

        const refusal = await refused(() => client.query('commit'));

        expect(refusal.message, 'an organization was left with no admin').toBe(
          'ORGANIZATION_WOULD_HAVE_NO_ADMIN',
        );
      } finally {
        await client.query('rollback').catch(() => undefined);
        await client.end();
      }
    },
  );
});

describe('an account issued the way admin-auth issues one actually signs in', () => {
  /**
   * THE FIRST ACCEPTANCE CRITERION, off the stub.
   *
   * Every case in `test/admin-auth-boundary.test.ts` drives `createUser`
   * against a stubbed `auth.admin`, which proves the ORDER, the compensation
   * and the refusals and proves nothing at all about whether GoTrue's admin API
   * produces an account somebody can sign in to. This repository already holds
   * that invariant for its other two account recipes — `seed.sql` and the
   * operator script, through `recipeHealth`/`expectSignInCapable` in
   * `test/provisioning.test.ts` — and the third recipe had it asserted by
   * nothing.
   *
   * It drives the same endpoint and the same attributes `auth.admin.createUser`
   * sends (`POST /auth/v1/admin/users` with `email`, `password`,
   * `email_confirm`), then exchanges the issued credential for a token at the
   * SYNTHESIZED address. Skipped, never silently green, without a stack.
   */
  const ISSUED_PASSWORD = 'an-issued-throwaway-password';

  async function createAccount(address: string): Promise<Response> {
    const endpoint = apiEndpoint;
    if (endpoint === undefined || adminKey === undefined) {
      throw new Error('unreachable: gated by skipIf');
    }

    return fetch(`${endpoint.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: adminKey,
        Authorization: `Bearer ${adminKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: address,
        password: ISSUED_PASSWORD,
        email_confirm: true,
      }),
    });
  }

  it.skipIf(noAdminApi).each(FIXTURES)(
    'issues a $fixture credential the account can then sign in with',
    async ({ slug }) => {
      const endpoint = apiEndpoint;
      if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

      const username = `${THROWAWAY}-issued-${slug}`;
      // AD-12's address, built the way both builders build it. A case that used
      // an ordinary address would prove GoTrue works and nothing about ours.
      const issued = address(username, slug);
      const client = await connect();

      try {
        await client.query('delete from auth.users where email = $1', [issued]);

        const created = await createAccount(issued);

        expect(
          created.status,
          `the admin API refused the account: ${created.status} ${await created.clone().text()}`,
        ).toBe(200);

        // THE IDENTITY ROW, confirmed rather than assumed. A password grant
        // resolves through `auth.identities`, not through `auth.users.email` —
        // `seed.sql` and the operator script both write one by hand for exactly
        // that reason, and this is where the admin API is held to producing it.
        const { rows } = await client.query<{ identities: number; confirmed: number }>(
          `select count(i.*)::int as identities,
                  count(u.*) filter (where u.email_confirmed_at is not null)::int as confirmed
             from auth.users u
             left join auth.identities i on i.user_id = u.id
            where u.email = $1`,
          [issued],
        );

        expect(rows[0]?.identities, 'the created account has no identity to resolve through').toBe(
          1,
        );
        expect(rows[0]?.confirmed, 'the created account was left unconfirmed').toBe(1);

        // AND IT AUTHENTICATES. Counting rows cannot tell a usable account from
        // one that is merely present — the whole point of the recipe.
        const grant = await fetch(`${endpoint.url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: endpoint.key, 'content-type': 'application/json' },
          body: JSON.stringify({ email: issued, password: ISSUED_PASSWORD }),
        });
        const body: unknown = await grant.json();
        const token =
          typeof body === 'object' && body !== null
            ? (body as Record<string, unknown>)['access_token']
            : undefined;

        expect(
          typeof token === 'string' && token.length > 0,
          `the issued credential did not authenticate: ${grant.status} ${JSON.stringify(body)}`,
        ).toBe(true);

        // THE NEGATIVE CONTROL: without it, a GoTrue that accepted anything
        // would satisfy the assertion above.
        const rejected = await fetch(`${endpoint.url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: endpoint.key, 'content-type': 'application/json' },
          body: JSON.stringify({ email: issued, password: 'not-the-issued-password' }),
        });

        expect(rejected.ok, 'a wrong password was accepted').toBe(false);

        // AND THE SECOND ISSUE OF THE SAME ADDRESS IS REFUSED BY CODE, which is
        // what `createUser` maps to USERNAME_TAKEN — by GoTrue's own code and
        // never by `status === 422`, which every other validation shares.
        const duplicate = await createAccount(issued);
        const refusal: unknown = await duplicate.json();
        const refusalCode =
          typeof refusal === 'object' && refusal !== null
            ? (refusal as Record<string, unknown>)['error_code']
            : undefined;

        expect(duplicate.ok, 'the same address was issued twice').toBe(false);
        expect(
          refusalCode,
          `GoTrue no longer answers a duplicate address with the code the function maps: ${JSON.stringify(refusal)}`,
        ).toBe('email_exists');
      } finally {
        await client.query('delete from auth.users where email = $1', [issued]).catch(() => undefined);
        await client.end();
      }
    },
    20_000,
  );
});

describe('an admin-issued reset replaces the credential and ends every session it had', () => {
  /**
   * THE OPERATION ITSELF, over the real transport, against the real database.
   *
   * Every case in `test/admin-auth-boundary.test.ts` drives `resetPassword`
   * against stubs, which proves the ORDER and the refusals and proves nothing
   * about whether the credential actually moves in GoTrue or whether a session
   * minted from the old one stops working. Those are the two acceptance
   * criteria a stub cannot answer at all — so the two seams are built here out
   * of real HTTP: the caller's client is PostgREST carrying a real ES256 token,
   * so row level security decides which rows exist, and the privileged client
   * is GoTrue's admin API carrying the secret key.
   *
   * THE REVOCATION IS THE PASSWORD SET, and this is where that claim is held to
   * account rather than asserted in a comment. GoTrue's admin user update logs
   * an account out of every session it holds; there is no per-user session
   * endpoint in the admin API to call instead. A build that stopped using it —
   * or a GoTrue that stopped doing it — fails the two cases below, which is the
   * only place either could be noticed.
   */
  const ISSUED = 'reset-fixture-password-before';

  /** The caller's client, as `resetPassword` narrowly uses it: one RPC and one
   *  `select(...).eq(...).limit(...)`, both over the shipped REST path. */
  function callerOver(token: string): CallerClient {
    const settle = async (response: Response): Promise<PostgrestAnswer> => {
      const body: unknown = await response.json();

      if (response.ok) return { data: body, error: null };

      const fields =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

      return {
        data: null,
        error: { code: typeof fields['code'] === 'string' ? fields['code'] : String(response.status) },
      };
    };

    return {
      rpc: (name) => settle_rpc(name, token),
      from: (table) => ({
        select: (columns) => ({
          eq: (column, value) => ({
            limit: async (count) =>
              settle(
                await rest(`${table}?select=${columns}&${column}=eq.${value}&limit=${count}`, {
                  token,
                }),
              ),
          }),
        }),
        // Named because the interface names them; a reset reaches neither, and
        // the cases below assert exactly that by counting `members` afterwards.
        insert: () => ({ select: () => Promise.reject(new Error('a reset must not insert')) }),
        update: () => ({
          eq: () => ({ select: () => Promise.reject(new Error('a reset must not update')) }),
        }),
      }),
    } as CallerClient;
  }

  async function settle_rpc(name: string, token: string): Promise<{ data: unknown; error: null }> {
    const rows = await restRows(`rpc/${name}`, { token, method: 'POST', body: {} });

    return { data: rows, error: null };
  }

  /** The privileged client, as `resetPassword` narrowly uses it: GoTrue's admin
   *  API under the secret key, and nothing that can touch a domain table. */
  function privilegedOverAdminApi(): PrivilegedAccounts {
    const endpoint = apiEndpoint;
    if (endpoint === undefined || adminKey === undefined) {
      throw new Error('unreachable: gated by skipIf');
    }

    const headers = {
      apikey: adminKey,
      Authorization: `Bearer ${adminKey}`,
      'content-type': 'application/json',
    };

    return {
      auth: {
        admin: {
          createUser: () => Promise.reject(new Error('a reset must not create an account')),
          deleteUser: () => Promise.reject(new Error('a reset must not delete an account')),
          updateUserById: async (id, attributes) => {
            const response = await fetch(`${endpoint.url}/auth/v1/admin/users/${id}`, {
              method: 'PUT',
              headers,
              body: JSON.stringify(attributes),
            });
            const body: unknown = await response.json();
            const fields =
              typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

            return response.ok
              ? { data: { user: { id: fields['id'] } }, error: null }
              : { data: null, error: { status: response.status } };
          },
        },
      },
    } as PrivilegedAccounts;
  }

  async function grant(address: string, password: string): Promise<Response> {
    const endpoint = apiEndpoint;
    if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

    return fetch(`${endpoint.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: endpoint.key, 'content-type': 'application/json' },
      body: JSON.stringify({ email: address, password }),
    });
  }

  /** Whether a token is still accepted — the only honest question about a
   *  session, since a revoked one is refused rather than absent. */
  async function stillAuthenticates(token: string): Promise<boolean> {
    const endpoint = apiEndpoint;
    if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

    const response = await fetch(`${endpoint.url}/auth/v1/user`, {
      headers: { apikey: endpoint.key, Authorization: `Bearer ${token}` },
    });

    return response.ok;
  }

  /** A throwaway member of `slug`'s organization, with a credential it can sign
   *  in with — the state a reset is issued against. */
  async function targetIn(
    client: Client,
    organization: string,
  ): Promise<{ member: MemberRow; address: string }> {
    const member = await addThrowawayMember(client, organization);
    const { rows } = await client.query<{ email: string }>(
      'select email from auth.users where id = $1',
      [member.authUserId],
    );
    const email = rows[0]?.email ?? '';
    const endpoint = apiEndpoint;
    if (endpoint === undefined || adminKey === undefined) {
      throw new Error('unreachable: gated by skipIf');
    }

    const seeded = await fetch(`${endpoint.url}/auth/v1/admin/users/${member.authUserId}`, {
      method: 'PUT',
      headers: {
        apikey: adminKey,
        Authorization: `Bearer ${adminKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ password: ISSUED, email_confirm: true }),
    });

    expect(seeded.ok, `the throwaway credential could not be seeded: ${seeded.status}`).toBe(true);

    return { member, address: email };
  }

  it.skipIf(noAdminApi).each(FIXTURES)(
    'replaces the $fixture credential, refuses the old one, and writes no members row',
    async ({ slug, admin }) => {
      const client = await connect();

      try {
        const organization = (await memberByUsername(client, slug, admin)).organizationId;
        const { member, address: target } = await targetIn(client, organization);
        const before = await memberById(client, member.id);

        // A REAL SESSION, held before the reset. Proving it works first is what
        // makes its refusal afterwards mean anything.
        const signedIn = await grant(target, ISSUED);
        const session = (await signedIn.json()) as Record<string, unknown>;
        const held = String(session['access_token'] ?? '');

        expect(signedIn.status, 'the throwaway could not sign in before the reset').toBe(200);
        expect(await stillAuthenticates(held), 'the held session was never valid').toBe(true);

        const reply = await resetPassword(
          {
            privileged: privilegedOverAdminApi(),
            caller: callerOver(await tokenFor(admin, slug)),
          },
          { memberId: member.id },
        );

        expect(reply.status, `the reset was refused: ${JSON.stringify(reply.body)}`).toBe(200);
        expect(reply.body['code']).toBe(PASSWORD_RESET);

        const issued = String(reply.body['password'] ?? '');

        expect(issued.length, 'the reply carried no credential').toBeGreaterThan(0);

        // THE NEW ONE GRANTS.
        expect((await grant(target, issued)).status, 'the new credential did not sign in').toBe(200);
        // AND THE OLD ONE IS REFUSED — the negative control, without which a
        // GoTrue that accepted anything would satisfy the line above.
        expect((await grant(target, ISSUED)).ok, 'the previous credential still signs in').toBe(
          false,
        );

        // AND THE `members` ROW IS UNTOUCHED. The credential lives in
        // `auth.users`; this story adds no column and writes no row.
        expect(await memberById(client, member.id)).toEqual(before);
      } finally {
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noAdminApi).each(FIXTURES)(
    'ends a $fixture session that was held before the reset',
    async ({ slug, admin }) => {
      // A RESET ISSUED BECAUSE A CREDENTIAL IS COMPROMISED IS WORTHLESS while a
      // session minted from that credential still authenticates. Human decision
      // 2026-09-22, and the only place it can be observed.
      const client = await connect();

      try {
        const organization = (await memberByUsername(client, slug, admin)).organizationId;
        const { member, address: target } = await targetIn(client, organization);

        const signedIn = await grant(target, ISSUED);
        const session = (await signedIn.json()) as Record<string, unknown>;
        const held = String(session['access_token'] ?? '');
        const refresh = String(session['refresh_token'] ?? '');

        expect(await stillAuthenticates(held), 'the held session was never valid').toBe(true);

        await resetPassword(
          {
            privileged: privilegedOverAdminApi(),
            caller: callerOver(await tokenFor(admin, slug)),
          },
          { memberId: member.id },
        );

        expect(
          await stillAuthenticates(held),
          'a session minted from the replaced credential still authenticates',
        ).toBe(false);

        // AND IT CANNOT BE RENEWED EITHER. An access token expires on its own;
        // a refresh token is what would quietly mint a new session for ever.
        const endpoint = apiEndpoint;
        if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

        const renewed = await fetch(`${endpoint.url}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: endpoint.key, 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        });

        expect(renewed.ok, 'the refresh token outlived the credential it came from').toBe(false);
      } finally {
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noAdminApi).each(FIXTURES)(
    'refuses a $fixture member-role caller against the database, and changes nothing',
    async ({ slug, admin, member: memberUsername }) => {
      const client = await connect();

      try {
        const organization = (await memberByUsername(client, slug, admin)).organizationId;
        const { member, address: target } = await targetIn(client, organization);

        const reply = await resetPassword(
          {
            privileged: privilegedOverAdminApi(),
            caller: callerOver(await tokenFor(memberUsername, slug)),
          },
          { memberId: member.id },
        );

        expect(reply.status).toBe(403);
        expect(reply.body).toEqual({ code: NOT_AN_ADMIN });
        // NOTHING CHANGED: the credential the account already held still works.
        expect((await grant(target, ISSUED)).status, 'a refused reset moved the password').toBe(200);
      } finally {
        await client.end();
      }
    },
    30_000,
  );

  /** Both directions of the cross-tenant pairing, carrying the OTHER tenant's
   *  admin — `CROSS_TENANT` names the other slug but not the account, and this
   *  case needs a token for it. */
  const FOREIGN_ADMINS = FIXTURES.flatMap((self) =>
    FIXTURES.filter((other) => other.slug !== self.slug).map((other) => ({
      fixture: self.fixture,
      slug: self.slug,
      admin: self.admin,
      otherFixture: other.fixture,
      otherSlug: other.slug,
      otherAdmin: other.admin,
    })),
  );

  it.skipIf(noAdminApi).each(FOREIGN_ADMINS)(
    'refuses the $otherFixture admin resetting a $fixture member, as an unknown row',
    async ({ slug, admin, otherSlug, otherAdmin }) => {
      // THE CROSS-TENANT CASE ANSWERS `MEMBER_UNKNOWN` RATHER THAN `NOT_AN_ADMIN`,
      // and that is the policy working rather than a weaker refusal:
      // `members_select_own_organization` means another tenant's row is not
      // there to be read, so the operation never gets far enough to authorize
      // anything. The other tenant's admin cannot learn that the member exists.
      const client = await connect();

      try {
        const organization = (await memberByUsername(client, slug, admin)).organizationId;
        const { member, address: target } = await targetIn(client, organization);

        const reply = await resetPassword(
          {
            privileged: privilegedOverAdminApi(),
            caller: callerOver(await tokenFor(otherAdmin, otherSlug)),
          },
          { memberId: member.id },
        );

        expect(reply.status).toBe(404);
        expect(reply.body).toEqual({ code: MEMBER_UNKNOWN });
        expect((await grant(target, ISSUED)).status, 'a refused reset moved the password').toBe(200);
      } finally {
        await client.end();
      }
    },
    30_000,
  );

  it('names the two refusal codes it asserts, so neither can be renamed into agreement', () => {
    // Read off the function's own modules rather than written out here: the
    // cases above compare replies to these values, so importing them is what
    // makes a rename a failure here instead of a silent agreement.
    expect(NOT_AN_ADMIN).toBe('NOT_AN_ADMIN');
    expect(MEMBER_UNKNOWN).toBe('MEMBER_UNKNOWN');
    expect(ACCESS_UNREADABLE).toBe('ACCESS_UNREADABLE');
  });
});

describe('the zero-admins refusal reaches a direct API caller as a code it can map', () => {
  it.skipIf(noApi).each(FIXTURES)(
    'refuses the $fixture admin demoting themselves, through PostgREST',
    async ({ slug, admin }) => {
      // NOTHING OBSERVED THE BODY POSTGREST ACTUALLY SENDS. Both unit cases hand
      // `editFailureOf` an error object they built themselves, and the database
      // case reads the pg driver — so the client's substring match was made
      // against a shape nothing had ever seen come off the wire. If PostgREST
      // carries the raised message somewhere other than where the client looks,
      // demoting the last administrator renders "correct a value" with no value
      // on the form to correct, and every existing case stays green.
      const token = await tokenFor(admin, slug);
      const client = await connect();

      try {
        const caller = await memberByUsername(client, slug, admin);
        const response = await rest(`members?id=eq.${caller.id}`, {
          token,
          method: 'PATCH',
          body: { role: 'member_role' },
        });

        // A deferred constraint trigger raises `check_violation`, which is what
        // makes PostgREST answer 400 rather than 500 (`0002:193-223`).
        expect(response.ok, 'an organization was left with no admin').toBe(false);

        const refusal = await restRefusal(response);

        expect(refusal.code, 'a deferred check violation is 23514').toBe('23514');
        expect(
          refusal.message,
          'the stable code is not in the body the client actually reads',
        ).toContain('ORGANIZATION_WOULD_HAVE_NO_ADMIN');

        // AND THE ROW IS UNCHANGED: the trigger is DEFERRABLE INITIALLY
        // DEFERRED, so the statement succeeded and the COMMIT is what was
        // refused — the whole transaction, including the demotion, is gone.
        expect(
          (await memberById(client, caller.id))?.role,
          `the ${slug} admin demoted themselves anyway`,
        ).toBe('admin');
      } finally {
        await client.end();
      }
    },
    20_000,
  );
});
