import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  MUST_SET_PASSWORD,
  PASSWORD_FLAG_CLEARED,
  PASSWORD_RESET,
  clearMustSetPassword,
  createUser,
  resetPassword,
  updateUserById,
  type CallerClient,
  type PostgrestAnswer,
  type PrivilegedAccounts,
} from '../supabase/functions/admin-auth/operations.ts';
import {
  TEAM_HISTORY,
  TEAM_HISTORY_ANSWERS,
  TEAM_HISTORY_SPAN,
} from '../apps/web/src/features/members/team-history.fixture.ts';
import {
  PILOT_HOUR_BANDS,
  PILOT_ROTATION_ASSIGNMENTS,
  PILOT_ROTATION_STEPS,
  PILOT_SHIFT_TYPES,
  PILOT_SHIFT_TYPE_VERSIONS,
  PILOT_TEAMS,
  SEEDED_ANCHOR_DATE,
  SEEDED_EFFECTIVE_FROM,
  UJ5_HOUR_BANDS,
  UJ5_ROTATION_ASSIGNMENTS,
  UJ5_ROTATION_STEPS,
  UJ5_SHIFT_TYPES,
  UJ5_SHIFT_TYPE_VERSIONS,
  UJ5_TEAMS,
  type FixtureTeam,
} from '../packages/domain/test/fixtures.ts';
import {
  collisionKeyOf,
  collisionsOf,
  type CollisionInput,
  leaveBalanceOf,
  leaveCostOf,
  leavePreviewOf,
  leaveYearOf,
  type LeaveRange,
  projectedShiftTypeOn,
  type MemberScheduleInput,
  type RotationAssignment,
  type RotationStep,
  type ShiftType,
} from '../packages/domain/src/index.ts';
import {
  LEAVE_DENIED,
  LEAVE_FAILED,
  LEAVE_GONE,
  LEAVE_OVERLAP,
  amendLeave,
  leaveRangeOf,
  recordLeave,
  removeLeave,
  type LeaveAmendAnswer,
  type LeaveQuery,
  type LeaveReadAnswer,
  type LeaveRecordRpc,
  type LeaveTable,
  type LeaveWriteAnswer,
} from '../apps/web/src/features/leave/services/leave-write.ts';

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

/** Both fixtures against every organization-scoped table a session reads:
 *  `organizations`, `members`, since story 1.7a `teams`, since story 1.7b
 *  `team_membership_versions`, since story 2.1a `hour_bands`, since story
 *  2.2a `shift_types` and `shift_type_versions`, and since story 2.3a the
 *  three rotation tables. */
const OWN_ORGANIZATION_READS = FIXTURES.flatMap((entry) =>
  (
    [
      'organizations',
      'members',
      'teams',
      'team_membership_versions',
      'hour_bands',
      'shift_types',
      'shift_type_versions',
      'rotation_patterns',
      'rotation_steps',
      'rotation_assignments',
    ] as const
  ).map((table) => ({
    ...entry,
    table,
  })),
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
  /** One row, or (a bulk insert, since story 2.3a) several. */
  readonly body?: Readonly<Record<string, unknown>> | readonly Readonly<Record<string, unknown>>[];
  /**
   * PostgREST's `Prefer` header, for the one case that needs `count=exact`.
   *
   * Story 1.5a: `apps/web/src/features/members/services/list.ts` asks for an exact count and
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

/**
 * A team committed into `organization` as the owner, attributed to
 * `createdBy`, for a case that runs outside a transaction. Named with the
 * throwaway prefix and its own random suffix, so no two collide under the
 * per-organization unique and `afterAll` reaches every one of them.
 */
async function addThrowawayTeam(
  client: Client,
  organization: string,
  createdBy: string,
  archived = false,
): Promise<{ readonly id: string; readonly name: string }> {
  const { rows } = await client.query<{ id: string; name: string }>(
    `insert into teams (organization_id, name, archived, created_by)
     values ($1, $2 || ' ' || gen_random_uuid()::text, $3, $4)
     returning id, name`,
    [organization, `${THROWAWAY} team`, archived, createdBy],
  );
  const team = rows[0];
  if (team === undefined) throw new Error('teams insert returned no row');
  return team;
}

afterAll(async () => {
  if (noDatabase) return;
  const client = await connect();
  try {
    // STORY 2.3a. No rotation key cascades, so the rotation rows go before
    // the throwaway teams and types they name. The REST cases clean up in
    // `finally`; this is the backstop: assignments on a throwaway team or on a
    // pattern with a throwaway type's step, then those patterns' steps, then
    // any pattern in a fixture that nothing references any more (the seed
    // leaves none).
    await client.query(
      `delete from rotation_assignments
        where team_id in (select id from teams where name like $1)
           or pattern_id in (
             select pattern_id from rotation_steps
              where shift_type_id in (select id from shift_types where name like $1)
           )`,
      [`${THROWAWAY}%`],
    );
    await client.query(
      `delete from rotation_steps
        where pattern_id in (
          select pattern_id from rotation_steps
           where shift_type_id in (select id from shift_types where name like $1)
        )`,
      [`${THROWAWAY}%`],
    );
    await client.query(
      `delete from rotation_patterns p
        where p.organization_id in (select id from organizations where slug = any($1::text[]))
          and not exists (select 1 from rotation_steps s where s.pattern_id = p.id)
          and not exists (select 1 from rotation_assignments a where a.pattern_id = p.id)`,
      [FIXTURES.map((entry) => entry.slug)],
    );
    // STORY 1.7b. Membership versions reference teams with no cascade, so the
    // versions naming a throwaway team go first.
    await client.query(
      'delete from team_membership_versions where team_id in (select id from teams where name like $1)',
      [`${THROWAWAY}%`],
    );
    // STORY 2.1a. The REST band cases delete their own rows in `finally`; this
    // is the backstop for a run that died between the two.
    await client.query('delete from hour_bands where name like $1', [`${THROWAWAY}%`]);
    // STORY 2.2a. Versions reference types with no cascade, so the versions of
    // a throwaway type go first; the REST cases clean up in `finally`, and this
    // is the backstop.
    await client.query(
      'delete from shift_type_versions where shift_type_id in (select id from shift_types where name like $1)',
      [`${THROWAWAY}%`],
    );
    await client.query('delete from shift_types where name like $1', [`${THROWAWAY}%`]);
    // STORY 1.7a. Teams are never deleted through the product, but the owner
    // may; scoped to the names this file issues, like every cleanup here.
    await client.query('delete from teams where name like $1', [`${THROWAWAY}%`]);
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
    // MEMBER RANK, for the same reason: the setting case writes the real row.
    for (const [seededSlug, uses] of Object.entries(SEEDED_USES_FIRE_RANKS)) {
      await client.query('update organizations set uses_fire_ranks = $1 where slug = $2', [
        uses,
        seededSlug,
      ]);
    }
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
      'OWN_ORGANIZATION_READS must cover all ten readable tables per fixture (teams since 1.7a, team membership since 1.7b, hour bands since 2.1a, shift types and their versions since 2.2a, the rotation patterns, steps and assignments since 2.3a)',
    ).toBe(FIXTURES.length * 10);
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
        'stories 1.3a, 1.4a, 1.6, 1.7a, 1.7b, 2.1a, 2.2a, 2.3a, 3.5a, 3.6a, 5.1b, 5.4a and 0025 own exactly these policies; a missing one refuses silently and looks like a working refusal',
      ).toEqual([
        // STORY 5.4a: read and insert alone, and both an active admin's only;
        // a member reads their own live rows through `my_conflict_resolutions`.
        // No update and no delete: the lifetime rule soft-removes through
        // 0031's re-created leave definer functions.
        'conflict_resolutions_insert_by_own_active_admin',
        'conflict_resolutions_select_own_active_admin',
        // STORY 2.1a: read, and all three writes for an active admin. Bands are
        // current-state and any of them may be deleted, the last one included.
        'hour_bands_delete_by_own_active_admin',
        'hour_bands_insert_by_own_active_admin',
        'hour_bands_select_own_organization',
        'hour_bands_update_by_own_active_admin',
        // STORY 5.1b: an active admin inserts; the read is an active admin's
        // for the organization and an active member's for their own rows. No
        // update and no delete: removal and amend are 0029's definer
        // functions (story 5.2a).
        'leave_records_insert_by_own_active_admin',
        'leave_records_select_own_organization',
        // STORY 1.6: select, insert, and a delete that reaches only a version
        // not yet in effect — and never update: a status version is appended,
        // and cancelled only before it has decided any day.
        'member_status_versions_delete_scheduled_by_own_active_admin',
        'member_status_versions_insert_by_own_active_admin',
        'member_status_versions_select_own_organization',
        'members_delete_by_own_active_admin',
        'members_insert_by_own_active_admin',
        'members_select_own_organization',
        'members_update_by_own_active_admin',
        'organizations_select_own_organization',
        'organizations_update_by_own_active_admin',
        // STORY 3.6a: read and insert alone, and both an active admin's only,
        // as 3.5a's; members read the live rows through
        // `calendar_roster_overrides`. No update and no delete.
        'roster_overrides_insert_by_own_active_admin',
        'roster_overrides_select_by_own_active_admin',
        // STORY 2.3a: the membership table's three on the assignments — a
        // version is appended, and cancelled only before it has decided any
        // day — and read and insert alone on the immutable patterns and steps.
        'rotation_assignments_delete_scheduled_by_own_active_admin',
        'rotation_assignments_insert_by_own_active_admin',
        'rotation_assignments_select_own_organization',
        // 0025: a delete each, reaching only a pattern no version names.
        'rotation_patterns_delete_unassigned_by_own_active_admin',
        'rotation_patterns_insert_by_own_active_admin',
        'rotation_patterns_select_own_organization',
        'rotation_steps_delete_unassigned_by_own_active_admin',
        'rotation_steps_insert_by_own_active_admin',
        'rotation_steps_select_own_organization',
        // STORY 3.5a: read and insert alone, and both an active admin's only;
        // members read the live rows through `calendar_shift_type_overrides`.
        // No update and no delete: story 3.5b removes through 0021's definer.
        'shift_type_overrides_insert_by_own_active_admin',
        'shift_type_overrides_select_by_own_active_admin',
        // STORY 2.2a: the membership table's three on the times versions — a
        // version is appended, and cancelled only before it has decided any
        // day — and the teams' three on the types, which archive and are never
        // deleted.
        'shift_type_versions_delete_scheduled_by_own_active_admin',
        'shift_type_versions_insert_by_own_active_admin',
        'shift_type_versions_select_own_organization',
        'shift_types_insert_by_own_active_admin',
        'shift_types_select_own_organization',
        'shift_types_update_by_own_active_admin',
        // STORY 1.7b: the status table's three, for the same reason — a
        // membership version is appended, and cancelled only before it has
        // decided any day.
        'team_membership_versions_delete_scheduled_by_own_active_admin',
        'team_membership_versions_insert_by_own_active_admin',
        'team_membership_versions_select_own_organization',
        // STORY 1.7a: read, create, and an update that renames or archives.
        // Never delete — removing a team archives it.
        'teams_insert_by_own_active_admin',
        'teams_select_own_organization',
        'teams_update_by_own_active_admin',
      ]);

      const { rows: functions } = await client.query<{ proname: string }>(
        `select proname from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'amend_leave_record',
              'amend_shift_type_override',
              'calendar_members',
              'calendar_people',
              'calendar_roster_overrides',
              'calendar_shift_type_overrides',
              'confirm_shift_type_override',
              'current_member_access',
              'custom_access_token_hook',
              'leave_overview_records',
              'member_active_from',
              'member_active_on',
              'member_latest_version',
              'member_team_has_version',
              'member_team_on',
              'member_team_version_on',
              'my_conflict_resolutions',
              'my_leave_records',
              'organization_today',
              'remove_leave_record',
              'remove_roster_override',
              'remove_shift_type_override',
              'replace_conflict_member',
              'rotation_assignment_latest_version',
              'rotation_assignment_on',
              'rotation_assignments_in_view',
              'rotation_overrides_in_view',
              'rotation_pattern_in_use',
              'rotation_steps_in_view',
              'shift_type_latest_version',
              'shift_type_times_on',
              'team_in_use',
              'team_membership_latest_version',
              'team_roster'
            )
          order by proname`,
      );
      expect(
        functions.map((row) => row.proname),
        'the helper and the hook are what every policy and every claim depend on, and since story 1.6 both read active state through the status readers',
      ).toEqual([
        // STORY 5.2a: the atomic amend of a leave record — soft-remove and
        // insert the replacement range in one transaction, attributed to the
        // caller, copied from 3.5c's.
        'amend_leave_record',
        // STORY 3.5c: the atomic amend — soft-remove and insert in one
        // transaction, both attributed to the caller.
        'amend_shift_type_override',
        // STORY 3.4a: the one reading the calendar learns every colleague's
        // id, name and rank through, active or not. It REPLACED 3.3b's
        // `calendar_people`, which is gone — asked for above, and absent.
        'calendar_members',
        // STORY 3.6a: the one every member reads the live roster overrides
        // through, shaped as 3.5a's, with the author as a member id.
        'calendar_roster_overrides',
        // STORY 3.5a: the one every member reads the live overrides through,
        // with the author as a member id.
        'calendar_shift_type_overrides',
        // STORY 3.5c: an active admin's attributed confirmation of an override
        // a rotation change left pending.
        'confirm_shift_type_override',
        'current_member_access',
        'custom_access_token_hook',
        // STORY 7.15: the one an active admin reads the organization's live
        // leave records through, shaped as 5.2c's, refusing anybody else.
        'leave_overview_records',
        'member_active_from',
        'member_active_on',
        'member_latest_version',
        'member_team_has_version',
        'member_team_on',
        // TEAM POSITION: team and position at a date, for the insert policy's
        // changes-the-value rule and the roster.
        'member_team_version_on',
        // STORY 5.4a: the one a member reads their own live conflict
        // resolutions through, shaped `member_id, date, team_id, kind`, with
        // no author.
        'my_conflict_resolutions',
        // STORY 5.2c: the one a member reads their own live leave records
        // through, shaped `id, member_id, during`, with no author.
        'my_leave_records',
        'organization_today',
        // STORY 5.2a: an active admin's attributed soft-remove of a live
        // leave record, copied from 3.6b's.
        'remove_leave_record',
        // STORY 3.6b: an active admin's attributed soft-remove of a live
        // roster override, copied from 3.5b's.
        'remove_roster_override',
        // STORY 3.5b: the one function that writes — an active admin's
        // attributed soft-remove of a live override.
        'remove_shift_type_override',
        // STORY 5.4c: an active admin's replacement — the override that puts
        // someone on the absent member's shift and the resolution linked to
        // it, in one transaction.
        'replace_conflict_member',
        // STORY 2.3a: the three readers the rotation policies call.
        'rotation_assignment_latest_version',
        'rotation_assignment_on',
        // 0025: the builder's bounded read, as computed relationships.
        'rotation_assignments_in_view',
        'rotation_overrides_in_view',
        'rotation_pattern_in_use',
        'rotation_steps_in_view',
        // STORY 2.2a: the two readers the version and archive policies call.
        'shift_type_latest_version',
        'shift_type_times_on',
        'team_in_use',
        'team_membership_latest_version',
        // STORY 1.8: the one reading a member-role session learns a colleague's
        // name through, now that the select policy shows it only itself.
        'team_roster',
      ]);
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
        // STORY 1.7a. Since story 2.3a the seed carries each fixture's teams,
        // attributed to its admin; this case still makes a throwaway one in
        // each fixture, so the read covers a team no seed decided — the other
        // fixture's is what a leak would show.
        if (table === 'teams') {
          for (const entry of FIXTURES) {
            const organization = await organizationId(client, entry.slug);
            const creator = await memberByUsername(client, entry.slug, entry.admin);
            await addThrowawayTeam(client, organization, creator.authUserId);
          }
        }
        // STORY 1.7b. Nor any membership, for the same reason: a throwaway
        // member on a throwaway team, in each fixture.
        if (table === 'team_membership_versions') {
          for (const entry of FIXTURES) {
            const organization = await organizationId(client, entry.slug);
            const creator = await memberByUsername(client, entry.slug, entry.admin);
            const team = await addThrowawayTeam(client, organization, creator.authUserId);
            const target = await addThrowawayMember(client, organization);
            await client.query(
              `insert into team_membership_versions
                 (organization_id, member_id, team_id, effective_from, created_by)
               values ($1, $2, $3, public.organization_today($1), $4)`,
              [organization, target.id, team.id, creator.authUserId],
            );
          }
        }
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
    'returns a $fixture member-role session exactly its own member row, and no colleague',
    async ({ slug, member }) => {
      // STORY 1.8 (CAP-5). Until 0011 a member-role account read every
      // colleague's row whole — email, leave allowance, username, role. Now it
      // reads its own row and nothing else; who is on a team reaches it through
      // `team_roster`, as id and name only.
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const self = await memberByUsername(client, slug, member);
        const rows = await restRows(
          'members?select=id,organization_id,email,leave_allowance_days,username,role',
          { token },
        );

        expect(
          rows.map((row) => row['id']),
          `a ${slug} member-role session read a row other than its own`,
        ).toEqual([self.id]);
        expect(rows[0]?.['organization_id']).toBe(self.organizationId);
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

  it.skipIf(noDatabase)('grants authenticated UPDATE on exactly the eight writable columns', () => {
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
        // privilege (`@/features/organization/services/snapshot` makes the accent a shape
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
        // privilege but a TYPE — `@/features/organization/services/snapshot` makes the logo write
        // a shape disjoint from the five fields — so a save of the identity
        // fields cannot carry a stale path over a logo uploaded seconds earlier.
        'logo_path',
        'name',
        'organization_type',
        'timezone',
        // MEMBER RANK. `0014` adds `uses_fire_ranks` with its own column grant,
        // unioned with the rest, written on its own disjoint shape.
        'uses_fire_ranks',
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
    'names the leave-year constraint the settings form attributes to its control on $fixture',
    async ({ slug, admin }) => {
      // THE SETTINGS FIX maps each check's name to the control it refuses for
      // (`ORGANIZATION_CONSTRAINT_FIELDS` in `@/features/organization/services/snapshot`),
      // so the `aria-invalid` mark and the focus land on that control. Asserted
      // against the live database, as `organizations_name_check` is above and
      // `organizations_brand_accent_check` is below, so a renamed constraint
      // fails here rather than silently marking nothing.
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const before = await organizationById(client, own);

        for (const [body, constraint] of [
          [{ leave_year_start_day: 29 }, 'organizations_leave_year_start_day_check'],
          [{ leave_year_start_month: 13 }, 'organizations_leave_year_start_month_check'],
        ] as const) {
          const response = await rest(`organizations?id=eq.${own}`, { token, method: 'PATCH', body });
          const refusal = await restRefusal(response);

          expect(refusal.code, `${constraint} is not a check violation`).toBe('23514');
          expect(refusal.message, 'the refusal does not name the constraint the form reads').toContain(
            constraint,
          );
        }
        expect(await organizationById(client, own), `the ${slug} organization changed`).toEqual(before);
      } finally {
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
        // The constant `@/features/organization/services/snapshot` reads to tell this refusal from
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
    // reading exactly as it does today. `apps/web/src/features/organization/utils/accent.test.ts`
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
      // stub body. `@/features/organization/services/logo` also refuses an oversized file before
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

  /** The columns `apps/web/src/features/members/services/list.ts` selects, written out here
   *  rather than imported: this file asserts what the DATABASE does, and
   *  reading the list from the client would let a renamed column agree with
   *  itself on both sides while every existing read broke. */
  const LIST_COLUMNS =
    'organization_id,id,auth_user_id,name,username,email,role,leave_allowance_days,' +
    'member_status_versions(active,effective_from),' +
    'team_membership_versions(team_id,position,effective_from,teams(name)),organizations(timezone)';

  /** The keys each row of that read carries: the eight columns, and the three
   *  embeds under their relation names (story 1.6, and the team history since
   *  story 1.7b). */
  const LIST_KEYS = [
    'organization_id',
    'id',
    'auth_user_id',
    'name',
    'username',
    'email',
    'role',
    'leave_allowance_days',
    'member_status_versions',
    'team_membership_versions',
    'organizations',
  ];

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
      // sends — `LIST_COLUMNS`, embeds included — rather than `select=*`,
      // which is a different request and the one already covered above.
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
            [...LIST_KEYS].sort(),
          );
        }
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'hands a $fixture member-role session only its own row of the list, because the database is the enforcement point',
    async ({ slug, member, admin }) => {
      // THE CLAIM THE WHOLE ROUTE GUARD RESTS ON, inverted by story 1.8.
      // `/ljudi` refuses a member-role session in the INTERFACE, and until 0011
      // the database did not: `members_select_own_organization` carried no role
      // filter, so the addresses and leave allowances the guard keeps off a
      // member's screen were reachable over REST. CAP-5 says the DATABASE
      // enforces that a member sees names and membership only, so the member
      // now reads exactly its own row of the list the admin reads whole.
      const client = await connect();
      try {
        const self = await memberByUsername(client, slug, member);
        const memberRows = await restRows(`members?select=${LIST_COLUMNS}`, {
          token: await tokenFor(member, slug),
        });
        const adminRows = await restRows(`members?select=${LIST_COLUMNS}`, {
          token: await tokenFor(admin, slug),
        });

        expect(adminRows.length, `a ${slug} admin read only itself`).toBeGreaterThan(1);
        expect(
          memberRows.map((row) => row['id']),
          `a ${slug} member-role session reads colleagues' rows`,
        ).toEqual([self.id]);
        expect(
          adminRows.map((row) => row['id']),
          `a ${slug} admin no longer reads the member's row`,
        ).toContain(self.id);
        expect([...Object.keys(memberRows[0] ?? {})].sort()).toEqual([...LIST_KEYS].sort());
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'embeds the $fixture organization as an object and the status versions as an array for an admin, and none of it to a member',
    async ({ slug, admin, member }) => {
      // STORY 1.6's TWO EMBEDS, as the database shapes them. `organizations`
      // is a to-one relation and must arrive as an OBJECT; the versions are
      // to-many and must arrive as an ARRAY the reader can see. `features/members/services/list.ts`
      // refuses a row carrying either the other way round, so a shape nobody
      // sent live is a list that renders "malformed" in production.
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, own);
        const { rows } = await client.query<{ day: string }>(
          // TODAY, so the committed version is in effect: a scheduled one would
          // be cancellable, and the unfiltered delete elsewhere in this file
          // would count it.
          'select public.organization_today($1)::text as day',
          [own],
        );
        const day = rows[0]?.day ?? '';
        await client.query(
          `insert into member_status_versions (organization_id, member_id, active, effective_from, created_by)
           values ($1, $2, false, $3::date, $4)`,
          [own, target.id, day, caller.authUserId],
        );
        const { rows: zone } = await client.query<{ timezone: string }>(
          'select timezone from organizations where id = $1',
          [own],
        );

        // STORY 1.8: the admin reads the list whole; a member-role session reads
        // only its own row, so the throwaway's embeds never reach it.
        const memberRead = await restRows(`members?select=${LIST_COLUMNS}&id=eq.${target.id}`, {
          token: await tokenFor(member, slug),
        });
        expect(memberRead, `${slug}/${member} read a colleague's row and its versions`).toEqual([]);

        for (const reader of [admin]) {
          const read = await restRows(`members?select=${LIST_COLUMNS}`, {
            token: await tokenFor(reader, slug),
          });
          for (const row of read) {
            const organization = row['organizations'];
            expect(
              typeof organization === 'object' && organization !== null && !Array.isArray(organization),
              `${slug}/${reader}: organizations did not arrive as an object`,
            ).toBe(true);
            expect(organization).toEqual({ timezone: zone[0]?.timezone });
            expect(
              Array.isArray(row['member_status_versions']),
              `${slug}/${reader}: the versions did not arrive as an array`,
            ).toBe(true);
          }
          expect(
            read.find((row) => row['id'] === target.id)?.['member_status_versions'],
            `${slug}/${reader} could not see the version it is shown`,
          ).toEqual([{ active: false, effective_from: day }]);
        }
      } finally {
        await client.end();
      }
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
        // `features/members/services/list.ts` refuses on the client.
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
        // place it can be. `features/members/services/list.ts` refuses a truncated answer by
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
        // STORY 7.8: whose token this is, as `supabase-js`'s `auth.getUser(jwt)`
        // asks GoTrue — the one read `clearMustSetPassword` names its target by.
        getUser: async (jwt) => {
          const response = await fetch(`${endpoint.url}/auth/v1/user`, {
            headers: { apikey: adminKey, Authorization: `Bearer ${jwt}` },
          });
          const body: unknown = await response.json();
          const fields =
            typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

          return response.ok
            ? { data: { user: { id: fields['id'] } }, error: null }
            : { data: { user: null }, error: { status: response.status } };
        },
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

        // STORY 1.8: since 0011 a member-role caller reads only its own row, so
        // a colleague is not there to authorize against — the refusal arrives
        // as the unknown row, before any authorization runs.
        expect(reply.status).toBe(404);
        expect(reply.body).toEqual({ code: MEMBER_UNKNOWN });
        // NOTHING CHANGED: the credential the account already held still works.
        expect((await grant(target, ISSUED)).status, 'a refused reset moved the password').toBe(200);
      } finally {
        await client.end();
      }
    },
    30_000,
  );

  /** A fixture member's username, read as the owner, so a refused rename can
   *  be shown to have changed nothing. */
  async function usernameOf(client: Client, member: string): Promise<string | undefined> {
    const { rows } = await client.query<{ username: string }>(
      'select username from members where id = $1',
      [member],
    );
    return rows[0]?.username;
  }

  it.skipIf(noAdminApi).each(FIXTURES)(
    'refuses a $fixture member-role caller resetting its OWN row as NOT_AN_ADMIN, and changes nothing',
    async ({ slug, member: memberUsername }) => {
      // STORY 1.8. Since 0011 a member-role caller reads only its own row, so
      // this is the one target that still reaches the admin gate itself.
      const client = await connect();

      try {
        const self = await memberByUsername(client, slug, memberUsername);
        const reply = await resetPassword(
          {
            privileged: privilegedOverAdminApi(),
            caller: callerOver(await tokenFor(memberUsername, slug)),
          },
          { memberId: self.id },
        );

        expect(reply.status).toBe(403);
        expect(reply.body).toEqual({ code: NOT_AN_ADMIN });
        // NOTHING CHANGED: the fixture credential still signs in.
        expect(
          (await grant(address(memberUsername, slug), FIXTURE_PASSWORD)).status,
          'a refused reset moved the password',
        ).toBe(200);
      } finally {
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noAdminApi).each(FIXTURES)(
    'refuses a $fixture member-role caller renaming its OWN row as NOT_AN_ADMIN, and changes nothing',
    async ({ slug, member: memberUsername }) => {
      const client = await connect();

      try {
        const self = await memberByUsername(client, slug, memberUsername);
        const before = await usernameOf(client, self.id);
        const reply = await updateUserById(
          {
            privileged: privilegedOverAdminApi(),
            caller: callerOver(await tokenFor(memberUsername, slug)),
          },
          { memberId: self.id, username: `${memberUsername}.renamed` },
        );

        expect(reply.status).toBe(403);
        expect(reply.body).toEqual({ code: NOT_AN_ADMIN });
        expect(await usernameOf(client, self.id), 'a refused rename moved the username').toBe(before);
        expect(
          (await grant(address(memberUsername, slug), FIXTURE_PASSWORD)).status,
          'a refused rename moved the sign-in address',
        ).toBe(200);
      } finally {
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noAdminApi).each(FIXTURES)(
    'answers a $fixture member-role caller renaming a colleague as MEMBER_UNKNOWN, and changes nothing',
    async ({ slug, member: memberUsername, bystander }) => {
      // STORY 1.8: the colleague's row is not there to read, so the refusal is
      // the unknown row, before any authorization runs.
      const client = await connect();

      try {
        const colleague = await memberByUsername(client, slug, bystander);
        const before = await usernameOf(client, colleague.id);
        const reply = await updateUserById(
          {
            privileged: privilegedOverAdminApi(),
            caller: callerOver(await tokenFor(memberUsername, slug)),
          },
          { memberId: colleague.id, username: `${bystander}.renamed` },
        );

        expect(reply.status).toBe(404);
        expect(reply.body).toEqual({ code: MEMBER_UNKNOWN });
        expect(await usernameOf(client, colleague.id), 'a refused rename moved the username').toBe(
          before,
        );
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

  // ------------------------------------------------- the first sign-in (7.8)

  /** The flag as GoTrue stores it, read as the owner: `true`, `false`, or
   *  `null` when the account has none. */
  async function flagOf(client: Client, authUserId: string): Promise<boolean | null> {
    const { rows } = await client.query<{ flag: boolean | null }>(
      `select (raw_app_meta_data->>'${MUST_SET_PASSWORD}')::boolean as flag from auth.users where id = $1`,
      [authUserId],
    );

    return rows[0]?.flag ?? null;
  }

  /** A JWT's claims, unverified — GoTrue minted it a line earlier. */
  function claimsOf(token: string): Record<string, unknown> {
    const payload = token.split('.')[1] ?? '';

    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  }

  it.skipIf(noAdminApi).each(FIXTURES)(
    'flags a $fixture account createUser issues, so its first sign-in is held at the step',
    async ({ slug, admin }) => {
      // THE REAL OPERATION, against the stack: GoTrue's admin API for the
      // account, and PostgREST as the admin for the `members` row.
      const client = await connect();
      const endpoint = apiEndpoint;
      if (endpoint === undefined || adminKey === undefined) throw new Error('unreachable: gated by skipIf');
      const username = `${THROWAWAY}-created-${slug}`;
      const issuedAddress = address(username, slug);
      const token = await tokenFor(admin, slug);
      const base = callerOver(token);
      const caller: CallerClient = {
        ...base,
        from: (table) => ({
          ...base.from(table),
          insert: (values) => ({
            select: async (columns) => {
              const response = await rest(`${table}?select=${columns}`, {
                token,
                method: 'POST',
                body: values,
                prefer: 'return=representation',
              });
              const body: unknown = await response.json();

              return response.ok
                ? { data: body, error: null }
                : { data: null, error: { code: String((body as Record<string, unknown>)['code'] ?? response.status) } };
            },
          }),
        }),
      };
      const headers = {
        apikey: adminKey,
        Authorization: `Bearer ${adminKey}`,
        'content-type': 'application/json',
      };
      const privileged = privilegedOverAdminApi();
      const accounts: PrivilegedAccounts = {
        auth: {
          ...privileged.auth,
          admin: {
            ...privileged.auth.admin,
            createUser: async (attributes) => {
              const response = await fetch(`${endpoint.url}/auth/v1/admin/users`, {
                method: 'POST',
                headers,
                body: JSON.stringify(attributes),
              });
              const body = (await response.json()) as Record<string, unknown>;

              return response.ok
                ? { data: { user: { id: body['id'] } }, error: null }
                : { data: null, error: { status: response.status, code: String(body['error_code'] ?? '') } };
            },
            deleteUser: async (id) => {
              const response = await fetch(`${endpoint.url}/auth/v1/admin/users/${id}`, {
                method: 'DELETE',
                headers,
              });

              return { error: response.ok ? null : { status: response.status } };
            },
          },
        },
      };

      try {
        const organization = (await memberByUsername(client, slug, admin)).organizationId;

        await client.query('delete from members where username = $1 and organization_id = $2', [
          username,
          organization,
        ]);
        await client.query('delete from auth.users where email = $1', [issuedAddress]);

        const reply = await createUser(
          { privileged: accounts, caller },
          {
            organizationId: organization,
            name: 'Prva Prijava',
            username,
            email: null,
            role: 'member_role',
            leaveAllowanceDays: 20,
          },
        );

        expect(reply.status, `the create was refused: ${JSON.stringify(reply.body)}`).toBe(201);

        const { rows } = await client.query<{ id: string }>('select id from auth.users where email = $1', [
          issuedAddress,
        ]);

        expect(await flagOf(client, rows[0]?.id ?? ''), 'createUser left the flag off').toBe(true);
        expect(String(reply.body['password'])).toMatch(/^[a-z]{3,6}(-[a-z]{3,6}){3}$/);
      } finally {
        await client
          .query('delete from members where username = $1', [username])
          .catch(() => undefined);
        await client.query('delete from auth.users where email = $1', [issuedAddress]).catch(() => undefined);
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noAdminApi).each(FIXTURES)(
    'flags a $fixture member on reset, so the next sign-in is held at the set-password step',
    async ({ slug, admin }) => {
      const client = await connect();

      try {
        const organization = (await memberByUsername(client, slug, admin)).organizationId;
        const { member, address: target } = await targetIn(client, organization);

        expect(await flagOf(client, member.authUserId), 'a seeded account already carried the flag').not.toBe(true);

        const reply = await resetPassword(
          { privileged: privilegedOverAdminApi(), caller: callerOver(await tokenFor(admin, slug)) },
          { memberId: member.id },
        );

        expect(reply.status).toBe(200);
        expect(await flagOf(client, member.authUserId), 'the reset left the flag off').toBe(true);

        // AND THE SESSION THE NEW CREDENTIAL MINTS CARRIES IT, which is what the
        // route guard reads.
        const signedIn = (await (await grant(target, String(reply.body['password']))).json()) as Record<
          string,
          unknown
        >;
        const user = signedIn['user'] as { app_metadata?: Record<string, unknown> } | undefined;

        expect(user?.app_metadata?.[MUST_SET_PASSWORD]).toBe(true);
      } finally {
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noAdminApi).each(FIXTURES)(
    'lets a $fixture member set their own password and clear their own flag, keeping the session',
    async ({ slug, admin }) => {
      const client = await connect();
      const endpoint = apiEndpoint;
      if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

      try {
        const organization = (await memberByUsername(client, slug, admin)).organizationId;
        const { member, address: target } = await targetIn(client, organization);
        const reset = await resetPassword(
          { privileged: privilegedOverAdminApi(), caller: callerOver(await tokenFor(admin, slug)) },
          { memberId: member.id },
        );
        const issued = String(reset.body['password']);
        const session = (await (await grant(target, issued)).json()) as Record<string, unknown>;
        const held = String(session['access_token'] ?? '');
        const refresh = String(session['refresh_token'] ?? '');
        const chosen = 'moja-vlastita-lozinka-7';

        const asMember = (body: Readonly<Record<string, unknown>>): Promise<Response> =>
          fetch(`${endpoint.url}/auth/v1/user`, {
            method: 'PUT',
            headers: {
              apikey: endpoint.key,
              Authorization: `Bearer ${held}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          });

        // THE REASON STEP 2 EXISTS: GoTrue's own user update will not let the
        // member write `app_metadata`, so the flag cannot be cleared from the
        // browser.
        await asMember({ app_metadata: { [MUST_SET_PASSWORD]: false } });
        expect(await flagOf(client, member.authUserId), 'a member cleared their own app_metadata').toBe(true);

        // STEP 1, AS THE MEMBER: their own password.
        const updated = await asMember({ password: chosen });

        expect(updated.status, 'the member could not set their own password').toBe(200);
        expect(await flagOf(client, member.authUserId), 'setting a password cleared the flag').toBe(true);

        // STEP 2: the operation, with the member's own token.
        const cleared = await clearMustSetPassword({ privileged: privilegedOverAdminApi() }, `Bearer ${held}`);

        expect(cleared).toEqual({ status: 200, body: { code: PASSWORD_FLAG_CLEARED } });
        expect(await flagOf(client, member.authUserId)).toBe(false);
        // NO SESSION REVOKED: the token the member is continuing in still works.
        expect(await stillAuthenticates(held), 'the clear ended the member\'s session').toBe(true);

        // STEP 3: the refreshed token carries the flag false — what the guard reads.
        const renewed = await fetch(`${endpoint.url}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: endpoint.key, 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        const fresh = (await renewed.json()) as Record<string, unknown>;

        expect(renewed.status, 'the session could not be refreshed').toBe(200);
        expect(
          (claimsOf(String(fresh['access_token'] ?? ''))['app_metadata'] as Record<string, unknown>)[
            MUST_SET_PASSWORD
          ],
        ).toBe(false);
        // AND THE PASSWORD IS THE MEMBER'S NOW.
        expect((await grant(target, chosen)).status).toBe(200);
        expect((await grant(target, issued)).ok, 'the issued password still signs in').toBe(false);
      } finally {
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noAdminApi).each(FIXTURES)(
    'leaves another $fixture member\'s flag alone, whatever the body names',
    async ({ slug, admin }) => {
      const client = await connect();

      try {
        const organization = (await memberByUsername(client, slug, admin)).organizationId;
        const adminToken = await tokenFor(admin, slug);
        const first = await targetIn(client, organization);
        const second = await targetIn(client, organization);

        for (const target of [first, second]) {
          await resetPassword(
            { privileged: privilegedOverAdminApi(), caller: callerOver(adminToken) },
            { memberId: target.member.id },
          );
        }

        // The first member's own session, from a credential set through the
        // admin API so the issued one need not be carried.
        const endpoint = apiEndpoint;
        if (endpoint === undefined || adminKey === undefined) throw new Error('unreachable: gated by skipIf');
        await fetch(`${endpoint.url}/auth/v1/admin/users/${first.member.authUserId}`, {
          method: 'PUT',
          headers: { apikey: adminKey, Authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ password: ISSUED }),
        });
        const session = (await (await grant(first.address, ISSUED)).json()) as Record<string, unknown>;

        expect(
          await clearMustSetPassword(
            { privileged: privilegedOverAdminApi() },
            `Bearer ${String(session['access_token'] ?? '')}`,
          ),
        ).toEqual({ status: 200, body: { code: PASSWORD_FLAG_CLEARED } });
        expect(await flagOf(client, first.member.authUserId)).toBe(false);
        expect(await flagOf(client, second.member.authUserId), 'a clear reached another account').toBe(true);
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

// ------------------------------------------------------------------ story 1.6

/**
 * Deactivation changes the future and rewrites no history (story 1.6).
 *
 * `0008_member_status.sql` is the whole enforcement: a versioned table written
 * under one insert policy, the helper every policy re-reads, the access token
 * hook and the zero-admins function. So this is where the story's I/O matrix is
 * proven, over both fixtures, with claims injected for the policy cases and a
 * real password grant for the sign-in case.
 *
 * `now()` is frozen for the length of a transaction, so every date below is
 * computed by the database from the same instant the policy reads — never by
 * this process's clock, which could straddle a midnight the database did not.
 */

/** A date `offset` days from the organization's own today, as the database
 *  computes it. */
async function organizationDay(client: Client, organization: string, offset = 0): Promise<string> {
  const { rows } = await client.query<{ day: string }>(
    'select (public.organization_today($1) + $2::int)::text as day',
    [organization, offset],
  );
  const day = rows[0]?.day;
  if (day === undefined || day === null) throw new Error('organization_today answered nothing');
  return day;
}

/** One version, written as whoever the connection currently is. The four
 *  columns a session may name, and nothing else. */
async function insertVersion(
  client: Client,
  version: { organization: string; member: string; active: boolean; from: string },
): Promise<{ rowCount: number | null }> {
  return client.query(
    `insert into member_status_versions (organization_id, member_id, active, effective_from)
     values ($1, $2, $3, $4::date)`,
    [version.organization, version.member, version.active, version.from],
  );
}

/** One version written as the OWNER, past every policy — the state a case
 *  starts from, never the write it is about. */
async function ownerVersion(
  client: Client,
  version: { organization: string; member: string; active: boolean; from: string; by: string },
): Promise<void> {
  await client.query(
    `insert into member_status_versions (organization_id, member_id, active, effective_from, created_by)
     values ($1, $2, $3, $4::date, $5)`,
    [version.organization, version.member, version.active, version.from, version.by],
  );
}

/** Every version of one member, oldest first, read as the owner. */
async function versionsOf(
  client: Client,
  member: string,
): Promise<{ id: string; active: boolean; from: string; createdBy: string; createdAt: string }[]> {
  const { rows } = await client.query<{
    id: string;
    active: boolean;
    from: string;
    createdBy: string;
    createdAt: string;
  }>(
    `select id, active, effective_from::text as "from", created_by as "createdBy",
            created_at::text as "createdAt"
       from member_status_versions where member_id = $1 order by effective_from`,
    [member],
  );
  return rows;
}

/** A second administrator in `organization`, so a last-admin case has somebody
 *  other than the fixture's only admin to be about. */
async function addThrowawayAdmin(client: Client, organization: string): Promise<MemberRow> {
  const member = await addThrowawayMember(client, organization);
  await client.query(`update members set role = 'admin' where id = $1`, [member.id]);
  return { ...member, role: 'admin' };
}

/** What the hook answers for one account, called the way GoTrue calls it. */
async function hookFor(client: Client, authUserId: string): Promise<Record<string, unknown>> {
  const { rows } = await client.query<{ answer: Record<string, unknown> }>(
    `select public.custom_access_token_hook(
              jsonb_build_object(
                'user_id', $1::text,
                'claims', jsonb_build_object('role', 'authenticated')
              )
            ) as answer`,
    [authUserId],
  );
  const answer = rows[0]?.answer;
  if (answer === undefined) throw new Error('the hook answered nothing');
  return answer;
}

/** The refusal the hook must answer with, exactly: a 4xx that is not 429, so the
 *  SPA renders the generic credentials message and nothing distinct. */
const INACTIVE_REFUSAL = { error: { http_code: 403, message: 'SIGN_IN_REFUSED' } };

/** Whether the helper reports the connection's current session as active. */
async function helperIsActive(client: Client): Promise<boolean | null> {
  const { rows } = await client.query<{ active: boolean }>(
    'select is_active as active from public.current_member_access()',
  );
  return rows[0]?.active ?? null;
}

describe('an admin deactivates a member from a date, and the table only ever grows', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'appends a $fixture deactivation from today and changes no existing version',
    async ({ slug, admin }) => {
      // AC 1. A version that already exists — here one written as history by
      // the owner, the only way a past date can exist — is byte-identical
      // afterwards, and exactly one row is new.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const today = await organizationDay(client, caller.organizationId);

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: true,
          from: await organizationDay(client, caller.organizationId, -30),
          by: caller.authUserId,
        });
        const before = await versionsOf(client, target.id);

        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await insertVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: false,
          from: today,
        });
        await actAsOwner(client);

        const after = await versionsOf(client, target.id);

        expect(written.rowCount, `the ${slug} admin could not deactivate a member`).toBe(1);
        expect(after, 'an existing version changed').toEqual(expect.arrayContaining(before));
        expect(after.length, 'the deactivation did not add exactly one row').toBe(before.length + 1);

        const added = after.find((version) => !before.some((old) => old.id === version.id));
        expect(added?.active).toBe(false);
        expect(added?.from).toBe(today);
        // THE COLUMN-FREE INSERT: the session named four columns and the
        // attribution came from the defaults, pinned to the caller (AD-11).
        expect(added?.createdBy, 'the attribution is not the caller').toBe(caller.authUserId);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'lets no $fixture session name its own attribution',
    async ({ slug, admin }) => {
      // The column grant admits the four facts and nothing else, so a session
      // cannot write a version attributed to somebody else, or dated earlier.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const today = await organizationDay(client, caller.organizationId);

        await actAs(client, caller.authUserId, caller.organizationId);
        const forged = await refusedThenContinue(client, () =>
          client.query(
            `insert into member_status_versions
               (organization_id, member_id, active, effective_from, created_by)
             values ($1, $2, false, $3::date, $4)`,
            [caller.organizationId, target.id, today, target.authUserId],
          ),
        );
        const backdated = await refusedThenContinue(client, () =>
          client.query(
            `insert into member_status_versions
               (organization_id, member_id, active, effective_from, created_at)
             values ($1, $2, false, $3::date, now() - interval '1 year')`,
            [caller.organizationId, target.id, today],
          ),
        );
        await actAsOwner(client);

        expect(forged.code, 'a session named its own created_by').toBe('42501');
        expect(backdated.code, 'a session named its own created_at').toBe('42501');
        expect(await versionsOf(client, target.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'updates no $fixture version, and deletes none already in effect, whoever asks',
    async ({ slug, admin }) => {
      // NO UPDATE POLICY, and a delete policy that reaches only a version dated
      // after today. Column-free and unfiltered, for the reason the freshness
      // block gives: a `where` reads a column and so brings the select policy
      // in, which would refuse for the wrong reason. Every version here is in
      // effect — one from today, one in the past — so an unfiltered delete that
      // removed either would be history rewritten.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const outToday = await addThrowawayMember(client, caller.organizationId);
        const back = await addThrowawayMember(client, caller.organizationId);

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: outToday.id,
          active: false,
          from: await organizationDay(client, caller.organizationId),
          by: caller.authUserId,
        });
        await ownerVersion(client, {
          organization: caller.organizationId,
          member: back.id,
          active: false,
          from: await organizationDay(client, caller.organizationId, -5),
          by: caller.authUserId,
        });
        await ownerVersion(client, {
          organization: caller.organizationId,
          member: back.id,
          active: true,
          from: await organizationDay(client, caller.organizationId, -1),
          by: caller.authUserId,
        });
        const before = [
          ...(await versionsOf(client, outToday.id)),
          ...(await versionsOf(client, back.id)),
        ];

        await actAs(client, caller.authUserId, caller.organizationId);
        // NO UPDATE PRIVILEGE AT ALL since `0008` revokes it, so the statement
        // is refused outright rather than matching no row.
        const updated = await refusedThenContinue(client, () =>
          client.query('update member_status_versions set active = true'),
        );
        const deleted = await client.query('delete from member_status_versions');
        await actAsOwner(client);

        expect(updated.code, 'an admin rewrote a status version').toBe('42501');
        expect(deleted.rowCount, 'an admin deleted a version already in effect').toBe(0);
        expect([
          ...(await versionsOf(client, outToday.id)),
          ...(await versionsOf(client, back.id)),
        ]).toEqual(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture deactivation dated yesterday, and writes nothing',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const yesterday = await organizationDay(client, caller.organizationId, -1);

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, () =>
          insertVersion(client, {
            organization: caller.organizationId,
            member: target.id,
            active: false,
            from: yesterday,
          }),
        );
        await actAsOwner(client);

        expect(refusal.code, 'a past date would rewrite past rosters').toBe('42501');
        expect(await versionsOf(client, target.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second $fixture version on the same date',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        // TODAY, so the first version is IN EFFECT and the at-most-one-scheduled
        // rule admits the second: the date-order rule is then the only thing
        // between it and the unique constraint.
        const day = await organizationDay(client, caller.organizationId);

        await actAs(client, caller.authUserId, caller.organizationId);
        await insertVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: false,
          from: day,
        });
        const refusal = await refusedThenContinue(client, () =>
          insertVersion(client, {
            organization: caller.organizationId,
            member: target.id,
            active: true,
            from: day,
          }),
        );
        await actAsOwner(client);

        // THE DATE-ORDER RULE refuses it first, as the policy's 42501: a version
        // on the latest version's date is not after it. The unique constraint
        // stands behind it for a writer no policy governs — the owner below.
        expect(refusal.code, 'two versions on one date leave that date undefined').toBe('42501');
        expect((await versionsOf(client, target.id)).length).toBe(1);

        const underneath = await refusedThenContinue(client, () =>
          ownerVersion(client, {
            organization: caller.organizationId,
            member: target.id,
            active: true,
            from: day,
            by: caller.authUserId,
          }),
        );
        expect(underneath.code, 'the table itself admits two versions on one date').toBe('23505');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses the $fixture admin deactivating their own row',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        // A SECOND ADMIN, so the only thing left to refuse is the self rule:
        // without one the last-admin rule would refuse this too, and the case
        // would pass with the self clause deleted.
        await addThrowawayAdmin(client, caller.organizationId);
        const future = await organizationDay(client, caller.organizationId, 7);

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, () =>
          insertVersion(client, {
            organization: caller.organizationId,
            member: caller.id,
            active: false,
            from: future,
          }),
        );
        await actAsOwner(client);

        expect(refusal.code, 'an admin deactivated themselves').toBe('42501');
        expect(await versionsOf(client, caller.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role account, and an admin naming the other tenant',
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, member);
        const target = await addThrowawayMember(client, caller.organizationId);
        const today = await organizationDay(client, caller.organizationId);
        const other = FIXTURES.find((entry) => entry.slug !== slug);
        if (other === undefined) throw new Error('no second fixture');
        const foreign = await memberByUsername(client, other.slug, other.admin);

        await actAs(client, caller.authUserId, caller.organizationId);
        const byMember = await refusedThenContinue(client, () =>
          insertVersion(client, {
            organization: caller.organizationId,
            member: target.id,
            active: false,
            from: today,
          }),
        );
        await actAsOwner(client);

        // THE FOREIGN ADMIN, with its own organization's claim, naming this
        // organization's row: the claim does not match, so the policy refuses.
        await actAs(client, foreign.authUserId, foreign.organizationId);
        const byForeigner = await refusedThenContinue(client, () =>
          insertVersion(client, {
            organization: caller.organizationId,
            member: target.id,
            active: false,
            from: today,
          }),
        );
        await actAsOwner(client);

        expect(byMember.code, 'a member-role account deactivated somebody').toBe('42501');
        expect(byForeigner.code, 'an admin deactivated another tenant member').toBe('42501');
        expect(await versionsOf(client, target.id)).toEqual([]);
      });
    },
  );
});

describe('status as at a date is the latest version on or before it', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'reads a $fixture member inactive on exactly [D, D2) after a deactivation and a reactivation',
    async ({ slug, admin }) => {
      // AC 2, over every date across the period rather than at two points. A
      // reading with the boundary on the wrong side of either date, or one that
      // ignored the reactivation, disagrees on at least one day here.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        // D IS TODAY, so the deactivation is in effect when the reactivation is
        // written: only one change may be scheduled at a time.
        const deactivated = await organizationDay(client, caller.organizationId);
        const reactivated = await organizationDay(client, caller.organizationId, 5);

        await actAs(client, caller.authUserId, caller.organizationId);
        await insertVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: false,
          from: deactivated,
        });
        await insertVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: true,
          from: reactivated,
        });
        await actAsOwner(client);

        const { rows } = await client.query<{ day: string; active: boolean }>(
          `select day::date::text as day, public.member_active_on($1, day::date) as active
             from generate_series(public.organization_today($2) - 5,
                                  public.organization_today($2) + 10,
                                  interval '1 day') as day
            order by day`,
          [target.id, caller.organizationId],
        );

        expect(rows.length).toBe(16);
        for (const { day, active } of rows) {
          const expected = !(day >= deactivated && day < reactivated);
          expect(active, `${slug} status as at ${day}`).toBe(expected);
        }
        // The member has no row before D at all, and no row means active.
        expect(await versionsOf(client, target.id)).toHaveLength(2);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'keeps a $fixture member deactivated from next week active until then',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const nextWeek = await organizationDay(client, caller.organizationId, 7);

        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await insertVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: false,
          from: nextWeek,
        });
        await actAsOwner(client);

        expect(written.rowCount).toBe(1);

        await actAs(client, target.authUserId, target.organizationId);
        const visible = await visibleToSession(client);
        await actAsOwner(client);

        expect(visible.members, 'a member scheduled out next week lost access today').toBeGreaterThan(0);
        expect(await hookFor(client, target.authUserId)).toMatchObject({
          claims: { organization_id: target.organizationId },
        });

        const { rows } = await client.query<{ before: boolean; on: boolean }>(
          `select public.member_active_on($1, $2::date - 1) as before,
                  public.member_active_on($1, $2::date) as on`,
          [target.id, nextWeek],
        );
        expect(rows[0]).toEqual({ before: true, on: false });
      });
    },
  );
});

/** One cancellation, as whoever the connection currently is: the delete the
 *  edit screen sends, filtered by the member and the date it names. */
async function cancelVersion(
  client: Client,
  version: { member: string; from: string },
): Promise<{ rowCount: number | null }> {
  return client.query(
    'delete from member_status_versions where member_id = $1 and effective_from = $2::date',
    [version.member, version.from],
  );
}

describe('versions append in date order, each one changes something, and a scheduled one may be cancelled', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture version dated before the member latest one',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const later = await organizationDay(client, caller.organizationId, 10);
        const earlier = await organizationDay(client, caller.organizationId, 4);

        await actAs(client, caller.authUserId, caller.organizationId);
        await insertVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: false,
          from: later,
        });
        // A REACTIVATION dated before the scheduled deactivation would change
        // nothing (the member is active then anyway); a DEACTIVATION dated
        // before it would leave the later one changing nothing. Both are out of
        // order, and the first is refused even though it "differs" from the
        // latest state.
        const reactivation = await refusedThenContinue(client, () =>
          insertVersion(client, {
            organization: caller.organizationId,
            member: target.id,
            active: true,
            from: earlier,
          }),
        );
        await actAsOwner(client);

        expect(reactivation.code, 'a version was inserted before the latest one').toBe('42501');
        expect((await versionsOf(client, target.id)).map((version) => version.from)).toEqual([
          later,
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second $fixture change while one is already scheduled',
    async ({ slug, admin }) => {
      // AT MOST ONE VERSION AFTER TODAY. "Inactive from day 7" then "active
      // from day 14" is in date order and changes something each time, and
      // still stacks two scheduled changes the surface cannot show and only
      // the reverse order could cancel.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);

        await actAs(client, caller.authUserId, caller.organizationId);
        const first = await insertVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: false,
          from: await organizationDay(client, caller.organizationId, 7),
        });
        const second = await refusedThenContinue(client, async () =>
          insertVersion(client, {
            organization: caller.organizationId,
            member: target.id,
            active: true,
            from: await organizationDay(client, caller.organizationId, 14),
          }),
        );
        await actAsOwner(client);

        expect(first.rowCount, 'the first scheduled change was refused').toBe(1);
        expect(second.code, 'a second change was scheduled on top of the first').toBe('42501');
        expect(await versionsOf(client, target.id)).toHaveLength(1);

        // THE CONTROL: once the first is in effect, the next may be scheduled.
        const inEffect = await addThrowawayMember(client, caller.organizationId);
        await ownerVersion(client, {
          organization: caller.organizationId,
          member: inEffect.id,
          active: false,
          from: await organizationDay(client, caller.organizationId),
          by: caller.authUserId,
        });
        await actAs(client, caller.authUserId, caller.organizationId);
        const next = await insertVersion(client, {
          organization: caller.organizationId,
          member: inEffect.id,
          active: true,
          from: await organizationDay(client, caller.organizationId, 14),
        });
        await actAsOwner(client);

        expect(next.rowCount, 'a change after one in effect was refused').toBe(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a redundant $fixture version in either direction',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const active = await addThrowawayMember(client, caller.organizationId);
        const inactive = await addThrowawayMember(client, caller.organizationId);

        await actAs(client, caller.authUserId, caller.organizationId);
        await insertVersion(client, {
          organization: caller.organizationId,
          member: inactive.id,
          active: false,
          from: await organizationDay(client, caller.organizationId, 1),
        });
        const reactivateActive = await refusedThenContinue(client, async () =>
          insertVersion(client, {
            organization: caller.organizationId,
            member: active.id,
            active: true,
            from: await organizationDay(client, caller.organizationId, 2),
          }),
        );
        const deactivateInactive = await refusedThenContinue(client, async () =>
          insertVersion(client, {
            organization: caller.organizationId,
            member: inactive.id,
            active: false,
            from: await organizationDay(client, caller.organizationId, 5),
          }),
        );
        await actAsOwner(client);

        expect(reactivateActive.code, 'an active member was reactivated').toBe('42501');
        expect(deactivateInactive.code, 'an inactive member was deactivated again').toBe('42501');
        expect(await versionsOf(client, active.id)).toEqual([]);
        expect(await versionsOf(client, inactive.id)).toHaveLength(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'judges every row of one multi-row $fixture insert against the rows before it',
    async ({ slug, admin }) => {
      // ONE STATEMENT, TWO ROWS — a PostgREST insert takes a JSON array. A
      // reader that saw only the statement's snapshot judged the second row
      // against a history without the first, and admitted both.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const first = await organizationDay(client, caller.organizationId, 1);
        const second = await organizationDay(client, caller.organizationId, 3);

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, () =>
          client.query(
            `insert into member_status_versions (organization_id, member_id, active, effective_from)
             values ($1, $2, false, $3::date), ($1, $2, false, $4::date)`,
            [caller.organizationId, target.id, first, second],
          ),
        );
        await actAsOwner(client);

        expect(refusal.code, 'two deactivations landed in one statement').toBe('42501');
        expect(await versionsOf(client, target.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture version dated infinity or in year 10000, at the table',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);

        for (const from of ['infinity', '10000-01-01']) {
          const refusal = await refusedThenContinue(client, () =>
            ownerVersion(client, {
              organization: caller.organizationId,
              member: target.id,
              active: false,
              from,
              by: caller.authUserId,
            }),
          );
          expect(refusal.code, `${from} was admitted as a date`).toBe('23514');
        }
        expect(await versionsOf(client, target.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'cancels a $fixture scheduled change, and the state before it continues on every date',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        // OUT FROM TODAY, so the reactivation can be scheduled on top of it.
        const out = await organizationDay(client, caller.organizationId);
        const back = await organizationDay(client, caller.organizationId, 6);

        await actAs(client, caller.authUserId, caller.organizationId);
        await insertVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: false,
          from: out,
        });
        await insertVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: true,
          from: back,
        });
        // NOT THE LATEST, and in effect besides: cancelling the deactivation
        // would rewrite today and leave the reactivation changing nothing.
        const notLatest = await cancelVersion(client, { member: target.id, from: out });
        const cancelled = await cancelVersion(client, { member: target.id, from: back });
        await actAsOwner(client);

        expect(notLatest.rowCount, 'a version that is not the latest was cancelled').toBe(0);
        expect(cancelled.rowCount, 'the scheduled reactivation was not cancelled').toBe(1);

        const { rows } = await client.query<{ day: string; active: boolean }>(
          `select day::date::text as day, public.member_active_on($1, day::date) as active
             from generate_series(public.organization_today($2) - 2,
                                  public.organization_today($2) + 12,
                                  interval '1 day') as day`,
          [target.id, caller.organizationId],
        );
        for (const { day, active } of rows) {
          expect(active, `${slug} status as at ${day}`).toBe(day < out);
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses cancelling a $fixture change already in effect, and one on the caller own row',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const second = await addThrowawayAdmin(client, caller.organizationId);
        const target = await addThrowawayMember(client, caller.organizationId);
        const today = await organizationDay(client, caller.organizationId);

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: false,
          from: today,
          by: caller.authUserId,
        });
        // THE CALLER'S OWN reactivation, scheduled: cancelling it would be a
        // self-deactivation. A second admin keeps the last-admin rule out of it.
        await ownerVersion(client, {
          organization: caller.organizationId,
          member: caller.id,
          active: false,
          from: await organizationDay(client, caller.organizationId, 2),
          by: second.authUserId,
        });
        await ownerVersion(client, {
          organization: caller.organizationId,
          member: caller.id,
          active: true,
          from: await organizationDay(client, caller.organizationId, 4),
          by: second.authUserId,
        });
        const before = await versionsOf(client, caller.id);

        await actAs(client, caller.authUserId, caller.organizationId);
        const inEffect = await cancelVersion(client, { member: target.id, from: today });
        const own = await cancelVersion(client, {
          member: caller.id,
          from: await organizationDay(client, caller.organizationId, 4),
        });
        await actAsOwner(client);

        expect(inEffect.rowCount, 'a version already in effect was deleted').toBe(0);
        expect(own.rowCount, 'an admin cancelled their own reactivation').toBe(0);
        expect(await versionsOf(client, target.id)).toHaveLength(1);
        expect(await versionsOf(client, caller.id)).toEqual(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'lets no $fixture member-role account or foreign admin cancel anything',
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, member);
        const target = await addThrowawayMember(client, caller.organizationId);
        const other = FIXTURES.find((entry) => entry.slug !== slug);
        if (other === undefined) throw new Error('no second fixture');
        const foreign = await memberByUsername(client, other.slug, other.admin);
        const from = await organizationDay(client, caller.organizationId, 3);

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: false,
          from,
          by: foreign.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const byMember = await cancelVersion(client, { member: target.id, from });
        await actAsOwner(client);
        await actAs(client, foreign.authUserId, foreign.organizationId);
        const byForeigner = await cancelVersion(client, { member: target.id, from });
        await actAsOwner(client);

        expect(byMember.rowCount, 'a member-role account cancelled a change').toBe(0);
        expect(byForeigner.rowCount, 'an admin cancelled another tenant change').toBe(0);
        expect(await versionsOf(client, target.id)).toHaveLength(1);
      });
    },
  );
});

describe('never zero active admins, on any date from the change onward', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses deactivating the $fixture admin while the only other admin is scheduled out',
    async ({ slug, admin }) => {
      // NOT TODAY'S READING. The second admin is scheduled out next week and is
      // still active today; deactivating the fixture admin today would leave
      // the organization with nobody from next week on.
      await inRolledBackTransaction(async (client) => {
        const incumbent = await memberByUsername(client, slug, admin);
        const second = await addThrowawayAdmin(client, incumbent.organizationId);
        const today = await organizationDay(client, incumbent.organizationId);
        const nextWeek = await organizationDay(client, incumbent.organizationId, 7);

        await actAs(client, incumbent.authUserId, incumbent.organizationId);
        const scheduled = await insertVersion(client, {
          organization: incumbent.organizationId,
          member: second.id,
          active: false,
          from: nextWeek,
        });
        await actAsOwner(client);

        expect(scheduled.rowCount, 'the incumbent could not schedule the second admin out').toBe(1);

        await actAs(client, second.authUserId, second.organizationId);
        const refusal = await refusedThenContinue(client, () =>
          insertVersion(client, {
            organization: incumbent.organizationId,
            member: incumbent.id,
            active: false,
            from: today,
          }),
        );
        await actAsOwner(client);

        expect(refusal.code, 'the organization was left with no admin going forward').toBe('42501');
        expect(await versionsOf(client, incumbent.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses the $fixture gap: an admin out today with a reactivation scheduled does not count',
    async ({ slug, admin }) => {
      // THE MATRIX'S GAP ROW, and the case a "latest version" reading admits.
      // B is out today and back in ten days. A schedules C out from day 2
      // (admitted: A covers every date). C then schedules A out from day 4:
      // days 4 to 9 would have no admin at all, because B's LATEST version is
      // active and still B is not active on any of those days.
      await inRolledBackTransaction(async (client) => {
        const a = await memberByUsername(client, slug, admin);
        const b = await addThrowawayAdmin(client, a.organizationId);
        const c = await addThrowawayAdmin(client, a.organizationId);
        const organization = a.organizationId;

        await ownerVersion(client, {
          organization,
          member: b.id,
          active: false,
          from: await organizationDay(client, organization),
          by: a.authUserId,
        });
        await ownerVersion(client, {
          organization,
          member: b.id,
          active: true,
          from: await organizationDay(client, organization, 10),
          by: a.authUserId,
        });

        await actAs(client, a.authUserId, organization);
        const first = await insertVersion(client, {
          organization,
          member: c.id,
          active: false,
          from: await organizationDay(client, organization, 2),
        });
        await actAsOwner(client);

        await actAs(client, c.authUserId, organization);
        const second = await refusedThenContinue(client, async () =>
          insertVersion(client, {
            organization,
            member: a.id,
            active: false,
            from: await organizationDay(client, organization, 4),
          }),
        );
        // THE CONTROL: from day 10 on, B covers every date, so the same write
        // dated then is admitted.
        const covered = await insertVersion(client, {
          organization,
          member: a.id,
          active: false,
          from: await organizationDay(client, organization, 10),
        });
        await actAsOwner(client);

        expect(first.rowCount, 'A could not schedule C out').toBe(1);
        expect(second.code, 'the second deactivation left days with no admin').toBe('42501');
        expect(covered.rowCount, 'a deactivation B covers was refused').toBe(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses two $fixture admins deactivated in one statement, each counting the other',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const a = await memberByUsername(client, slug, admin);
        const b = await addThrowawayAdmin(client, a.organizationId);
        const c = await addThrowawayAdmin(client, a.organizationId);
        const organization = a.organizationId;
        const day = await organizationDay(client, organization, 3);

        // A is out from day 3 as well, so after the statement nobody would be.
        await ownerVersion(client, { organization, member: a.id, active: false, from: day, by: b.authUserId });

        await actAs(client, a.authUserId, organization);
        const refusal = await refusedThenContinue(client, () =>
          client.query(
            `insert into member_status_versions (organization_id, member_id, active, effective_from)
             values ($1, $2, false, $4::date), ($1, $3, false, $4::date)`,
            [organization, b.id, c.id, day],
          ),
        );
        await actAsOwner(client);

        expect(refusal.code, 'one statement left the organization with no admin').toBe('42501');
        expect(await versionsOf(client, b.id)).toEqual([]);
        expect(await versionsOf(client, c.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'admits deactivating a $fixture member-role account while every other admin is scheduled out',
    async ({ slug, admin }) => {
      // A CHANGE TO A NON-ADMIN NEVER CONSULTS THE RULE.
      await inRolledBackTransaction(async (client) => {
        const incumbent = await memberByUsername(client, slug, admin);
        const second = await addThrowawayAdmin(client, incumbent.organizationId);
        const target = await addThrowawayMember(client, incumbent.organizationId);
        const organization = incumbent.organizationId;

        await ownerVersion(client, {
          organization,
          member: incumbent.id,
          active: false,
          from: await organizationDay(client, organization, 5),
          by: second.authUserId,
        });
        await ownerVersion(client, {
          organization,
          member: second.id,
          active: false,
          from: await organizationDay(client, organization, 5),
          by: incumbent.authUserId,
        });

        await actAs(client, incumbent.authUserId, organization);
        const written = await insertVersion(client, {
          organization,
          member: target.id,
          active: false,
          from: await organizationDay(client, organization, 1),
        });
        await actAsOwner(client);

        expect(written.rowCount, 'a non-admin deactivation consulted the last-admin rule').toBe(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses cancelling a $fixture admin reactivation that no other admin covers',
    async ({ slug, admin }) => {
      // Cancelling B's reactivation from day 6 makes B inactive from day 6 on,
      // so it is a deactivation dated day 6 and meets the same rule.
      await inRolledBackTransaction(async (client) => {
        const a = await memberByUsername(client, slug, admin);
        const b = await addThrowawayAdmin(client, a.organizationId);
        const c = await addThrowawayAdmin(client, a.organizationId);
        const organization = a.organizationId;
        const back = await organizationDay(client, organization, 6);

        await ownerVersion(client, {
          organization,
          member: b.id,
          active: false,
          from: await organizationDay(client, organization, 1),
          by: a.authUserId,
        });
        await ownerVersion(client, { organization, member: b.id, active: true, from: back, by: a.authUserId });
        // C is out from day 3; A remains, so the cancellation is admitted only
        // while A covers every date from day 6 on.
        await ownerVersion(client, {
          organization,
          member: c.id,
          active: false,
          from: await organizationDay(client, organization, 3),
          by: a.authUserId,
        });
        // A IS OUT ON DAYS 8 TO 19 and back from day 20, so A's LATEST version
        // is active — a "latest version" reading would count A as covering,
        // and leave those twelve days with no admin at all.
        await ownerVersion(client, {
          organization,
          member: a.id,
          active: false,
          from: await organizationDay(client, organization, 8),
          by: c.authUserId,
        });
        await ownerVersion(client, {
          organization,
          member: a.id,
          active: true,
          from: await organizationDay(client, organization, 20),
          by: c.authUserId,
        });

        await actAs(client, a.authUserId, organization);
        const refused = await cancelVersion(client, { member: b.id, from: back });
        await actAsOwner(client);

        expect(refused.rowCount, 'a cancellation left days with no admin').toBe(0);

        // THE CONTROL: with A's scheduled absence gone, A covers every date.
        await client.query(
          'delete from member_status_versions where member_id = $1',
          [a.id],
        );
        await actAs(client, a.authUserId, organization);
        const admitted = await cancelVersion(client, { member: b.id, from: back });
        await actAsOwner(client);

        expect(admitted.rowCount, 'a covered cancellation was refused').toBe(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'admits deactivating a $fixture admin while another admin stays active',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const incumbent = await memberByUsername(client, slug, admin);
        const second = await addThrowawayAdmin(client, incumbent.organizationId);
        const today = await organizationDay(client, incumbent.organizationId);

        await actAs(client, second.authUserId, second.organizationId);
        const written = await insertVersion(client, {
          organization: incumbent.organizationId,
          member: incumbent.id,
          active: false,
          from: today,
        });
        await actAsOwner(client);

        expect(written.rowCount).toBe(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses demoting the $fixture admin while the only other admin is scheduled out',
    async ({ slug, admin }) => {
      // 0002's deferred trigger, with the extended body. Checked immediately so
      // the rolled-back transaction still reaches it.
      await inRolledBackTransaction(async (client) => {
        const incumbent = await memberByUsername(client, slug, admin);
        const second = await addThrowawayAdmin(client, incumbent.organizationId);

        await ownerVersion(client, {
          organization: incumbent.organizationId,
          member: second.id,
          active: false,
          from: await organizationDay(client, incumbent.organizationId, 3),
          by: incumbent.authUserId,
        });

        await client.query(`update members set role = 'member_role' where id = $1`, [incumbent.id]);
        const refusal = await refusedThenContinue(client, () =>
          client.query('set constraints members_organization_keeps_an_admin immediate'),
        );

        expect(refusal.code).toBe('23514');
        expect(refusal.message).toContain('ORGANIZATION_WOULD_HAVE_NO_ADMIN');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses demoting the $fixture admin while the other admin is out today with a reactivation scheduled',
    async ({ slug, admin }) => {
      // The matrix's second demotion row, and the one a "latest version"
      // reading admits: the other admin's latest version is active, and still
      // nobody would be an admin today.
      await inRolledBackTransaction(async (client) => {
        const incumbent = await memberByUsername(client, slug, admin);
        const second = await addThrowawayAdmin(client, incumbent.organizationId);
        const organization = incumbent.organizationId;

        await ownerVersion(client, {
          organization,
          member: second.id,
          active: false,
          from: await organizationDay(client, organization, -2),
          by: incumbent.authUserId,
        });
        await ownerVersion(client, {
          organization,
          member: second.id,
          active: true,
          from: await organizationDay(client, organization, 4),
          by: incumbent.authUserId,
        });

        await client.query(`update members set role = 'member_role' where id = $1`, [incumbent.id]);
        const refusal = await refusedThenContinue(client, () =>
          client.query('set constraints members_organization_keeps_an_admin immediate'),
        );

        expect(refusal.code).toBe('23514');
        expect(refusal.message).toContain('ORGANIZATION_WOULD_HAVE_NO_ADMIN');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'admits an unrelated $fixture edit while admins hand over to one another across the calendar',
    async ({ slug, admin }) => {
      // The trigger fires on EVERY update of `members`. Here no single admin is
      // active on every date from today — A leaves on day 6, B arrives on day
      // 3 — yet every date has one, so a rename must still commit.
      await inRolledBackTransaction(async (client) => {
        const a = await memberByUsername(client, slug, admin);
        const b = await addThrowawayAdmin(client, a.organizationId);
        const organization = a.organizationId;

        await ownerVersion(client, {
          organization,
          member: b.id,
          active: false,
          from: await organizationDay(client, organization, -1),
          by: a.authUserId,
        });
        await ownerVersion(client, {
          organization,
          member: b.id,
          active: true,
          from: await organizationDay(client, organization, 3),
          by: a.authUserId,
        });
        await ownerVersion(client, {
          organization,
          member: a.id,
          active: false,
          from: await organizationDay(client, organization, 6),
          by: b.authUserId,
        });

        await client.query(`update members set name = name || ' ' where id = $1`, [a.id]);
        await client.query('set constraints members_organization_keeps_an_admin immediate');

        // And the gap is still refused by the same trigger once B's return is
        // moved past A's departure.
        await client.query(
          `update member_status_versions set effective_from = $2::date
            where member_id = $1 and active`,
          [b.id, await organizationDay(client, organization, 8)],
        );
        // The constraint is immediate from the statement above on, so the
        // rename itself is what raises.
        const refusal = await refusedThenContinue(client, () =>
          client.query(`update members set name = name || ' ' where id = $1`, [a.id]),
        );
        expect(refusal.message).toContain('ORGANIZATION_WOULD_HAVE_NO_ADMIN');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'admits demoting the $fixture admin while another admin stays active',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const incumbent = await memberByUsername(client, slug, admin);
        await addThrowawayAdmin(client, incumbent.organizationId);

        await client.query(`update members set role = 'member_role' where id = $1`, [incumbent.id]);
        await client.query('set constraints members_organization_keeps_an_admin immediate');

        expect((await memberById(client, incumbent.id))?.role).toBe('member_role');
      });
    },
  );
});

describe('a deactivated member loses access on the very next statement', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'returns zero rows from both tables on the next read after the $fixture account is deactivated',
    async ({ slug, admin }) => {
      // AC 3 with claims injected: the token was minted before the version, and
      // the helper is read fresh on every statement.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        // STORY 1.7a: a team to read, so the teams count below is not 0 = 0.
        await client.query(
          'insert into teams (organization_id, name, created_by) values ($1, $2, $3)',
          [caller.organizationId, `${THROWAWAY} deactivation read`, caller.authUserId],
        );
        const teamsVisible = async (): Promise<number> =>
          (await client.query<{ total: number }>('select count(*)::int as total from teams'))
            .rows[0]?.total ?? -1;

        await actAs(client, caller.authUserId, caller.organizationId);
        const before = await visibleToSession(client);
        const teamsBefore = await teamsVisible();
        await actAsOwner(client);

        expect(before.members).toBeGreaterThan(0);
        expect(before.organizations).toBeGreaterThan(0);
        expect(teamsBefore, 'an active account read no teams').toBeGreaterThan(0);

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: caller.id,
          active: false,
          from: await organizationDay(client, caller.organizationId),
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const after = await visibleToSession(client);
        const versions = await client.query<{ total: number }>(
          'select count(*)::int as total from member_status_versions',
        );
        const teamsAfter = await teamsVisible();
        await actAsOwner(client);

        expect(teamsAfter, 'a deactivated account kept reading teams').toBe(0);
        expect(after.members, 'a deactivated account kept reading members').toBe(0);
        expect(after.organizations, 'a deactivated account kept reading its organization').toBe(0);
        expect(versions.rows[0]?.total, 'a deactivated account kept reading versions').toBe(0);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'affects no rows on the next update or delete after the $fixture admin is deactivated',
    async ({ slug, admin }) => {
      // Column-free, for the reason the ban twin of this case gives: only that
      // shape proves the write policies' own `is_active`.
      const settled = 7;

      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await actAs(client, caller.authUserId, caller.organizationId);
        const permitted = await client.query('update members set leave_allowance_days = $1', [
          settled,
        ]);
        await actAsOwner(client);

        expect(permitted.rowCount).toBeGreaterThan(0);

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: caller.id,
          active: false,
          from: await organizationDay(client, caller.organizationId),
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const updated = await client.query('update members set leave_allowance_days = $1', [
          settled + 1,
        ]);
        const deleted = await client.query('delete from members');
        await actAsOwner(client);

        expect(updated.rowCount, 'a deactivated admin kept updating').toBe(0);
        expect(deleted.rowCount, 'a deactivated admin kept deleting').toBe(0);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses the next team insert and matches no team on the next update after the $fixture admin is deactivated',
    async ({ slug, admin }) => {
      // STORY 1.7a. COLUMN-FREE updates — a constant SET and no WHERE — for the
      // reason the members case above gives: a statement that reads a column
      // is also filtered by the select policy, which would refuse it on its own
      // and hide a write policy that lost its `is_active`. The insert likewise
      // carries no RETURNING: returning a row is checked against the select
      // policy too, which would refuse it and mask the insert policy. The team
      // is fresh and active, so `archived = false` in USING cannot be what
      // refuses the update.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const { rows } = await client.query<{ id: string }>(
          `insert into teams (organization_id, name, created_by) values ($1, $2, $3) returning id`,
          [caller.organizationId, `${THROWAWAY} deactivation write`, caller.authUserId],
        );
        const team = rows[0]?.id ?? '';

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: caller.id,
          active: false,
          from: await organizationDay(client, caller.organizationId),
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const insertRefusal = await refusedThenContinue(client, () =>
          client.query('insert into teams (organization_id, name) values ($1, $2)', [
            caller.organizationId,
            `${THROWAWAY} after deactivation`,
          ]),
        );
        const archived = await client.query('update teams set archived = true');
        await actAsOwner(client);

        expect(insertRefusal.code, 'a deactivated admin kept creating teams').toBe('42501');
        expect(archived.rowCount, 'a deactivated admin kept archiving teams').toBe(0);
        expect((await teamById(client, team))?.archived).toBe(false);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses the next status write with 42501 after the $fixture admin is deactivated',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const today = await organizationDay(client, caller.organizationId);

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: caller.id,
          active: false,
          from: today,
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refused(() =>
          insertVersion(client, {
            organization: caller.organizationId,
            member: target.id,
            active: false,
            from: today,
          }),
        );

        expect(refusal.code, 'a deactivated admin kept deactivating').toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'reads no band, and changes, deletes or creates none, after the $fixture admin is deactivated',
    async ({ slug, admin }) => {
      // STORY 2.1a. Column-free writes and an insert without RETURNING, for the
      // reason the teams case above gives: only that shape reaches the write
      // policies' own `is_active` rather than the select policy's.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const bandsVisible = async (): Promise<number> => {
          const total = (
            await client.query<{ total: number }>('select count(*)::int as total from hour_bands')
          ).rows[0]?.total;
          if (total === undefined) throw new Error('the hour band count returned no row');
          return total;
        };

        await actAs(client, caller.authUserId, caller.organizationId);
        const before = await bandsVisible();
        await actAsOwner(client);
        expect(before, 'an active admin read no seeded bands').toBe(seededBandsOf(slug).length);

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: caller.id,
          active: false,
          from: await organizationDay(client, caller.organizationId),
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const after = await bandsVisible();
        const renamed = await client.query(`update hour_bands set name = '${THROWAWAY} renamed'`);
        const deleted = await client.query('delete from hour_bands');
        const insertRefusal = await refusedThenContinue(client, () =>
          client.query(
            "insert into hour_bands (organization_id, name, start_time) values ($1, $2, '03:17')",
            [caller.organizationId, `${THROWAWAY} after deactivation`],
          ),
        );
        await actAsOwner(client);

        expect(after, 'a deactivated admin kept reading bands').toBe(0);
        expect(renamed.rowCount, 'a deactivated admin kept renaming bands').toBe(0);
        expect(deleted.rowCount, 'a deactivated admin kept deleting bands').toBe(0);
        expect(insertRefusal.code, 'a deactivated admin kept creating bands').toBe('42501');
        expect(await visibleHourBands(client, caller.organizationId)).toEqual(seededBandsOf(slug));
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'reads no rotation row, and writes or cancels none, after the $fixture admin is deactivated',
    async ({ slug, admin }) => {
      // STORY 2.3a, the hour-band case over the three rotation tables. Inserts
      // without RETURNING and a column-free delete, so each reaches the write
      // policy's own `is_active` rather than the select policy's.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const seeded = await seededPattern(client, own);
        const types = await seededTypeIds(client, slug, own);
        const team = await seededTeam(client, own, seededRotationOf(slug).teams[0]!);
        const scheduled = await organizationDay(client, own, 4);
        const open = await ownerPattern(client, own, caller.authUserId, []);
        await ownerAssignment(client, {
          organization: own,
          team,
          pattern: seeded.id,
          offsetStep: seeded.steps.at(-1)!,
          anchor: SEEDED_ANCHOR_DATE,
          from: scheduled,
          by: caller.authUserId,
        });
        const rotationVisible = async () =>
          (
            await client.query<{ patterns: number; steps: number; assignments: number }>(
              `select (select count(*)::int from rotation_patterns) as patterns,
                      (select count(*)::int from rotation_steps) as steps,
                      (select count(*)::int from rotation_assignments) as assignments`,
            )
          ).rows[0];

        await actAs(client, caller.authUserId, own);
        const before = await rotationVisible();
        await actAsOwner(client);
        expect(before?.steps, 'an active admin read no seeded steps').toBe(seededRotationOf(slug).steps.length);
        expect(before?.assignments, 'an active admin read no seeded assignments').toBe(
          seededRotationOf(slug).teams.length + 1,
        );

        await ownerVersion(client, {
          organization: own,
          member: caller.id,
          active: false,
          from: await organizationDay(client, own),
          by: caller.authUserId,
        });
        const later = await organizationDay(client, own, 8);

        await actAs(client, caller.authUserId, own);
        const after = await rotationVisible();
        const pattern = await refusedThenContinue(client, () =>
          client.query('insert into rotation_patterns (organization_id) values ($1)', [own]),
        );
        const step = await refusedThenContinue(client, () =>
          client.query(
            'insert into rotation_steps (organization_id, pattern_id, position, shift_type_id) values ($1, $2, 0, $3)',
            [own, open.id, types[0]],
          ),
        );
        const assignment = await refusedThenContinue(client, () =>
          insertAssignment(client, {
            organization: own,
            team,
            pattern: seeded.id,
            offsetStep: seeded.steps[1]!,
            anchor: SEEDED_ANCHOR_DATE,
            from: later,
          }),
        );
        const cancelled = await client.query('delete from rotation_assignments');
        await actAsOwner(client);

        expect(after, 'a deactivated admin kept reading the rotation').toEqual({
          patterns: 0,
          steps: 0,
          assignments: 0,
        });
        expect(pattern.code, 'a deactivated admin kept creating patterns').toBe('42501');
        expect(step.code, 'a deactivated admin kept adding steps').toBe('42501');
        expect(assignment.code, 'a deactivated admin kept writing assignments').toBe('42501');
        expect(cancelled.rowCount, 'a deactivated admin kept cancelling a scheduled assignment').toBe(0);
        expect((await assignmentsOf(client, team)).map((version) => version.from)).toEqual([
          SEEDED_EFFECTIVE_FROM,
          scheduled,
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'reads no rotation row after a $fixture member-role reader is deactivated',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const reader = await memberByUsername(client, slug, member);
        const count = `select (select count(*)::int from rotation_patterns)
                            + (select count(*)::int from rotation_steps)
                            + (select count(*)::int from rotation_assignments) as total`;

        await actAs(client, reader.authUserId, reader.organizationId);
        const before = (await client.query<{ total: number }>(count)).rows[0]?.total;
        await actAsOwner(client);
        const seeded = seededRotationOf(slug);
        expect(before, 'an active member-role reader read no seeded rotation').toBe(
          1 + seeded.steps.length + seeded.teams.length,
        );

        await ownerVersion(client, {
          organization: reader.organizationId,
          member: reader.id,
          active: false,
          from: await organizationDay(client, reader.organizationId),
          by: owner.authUserId,
        });

        await actAs(client, reader.authUserId, reader.organizationId);
        const after = (await client.query<{ total: number }>(count)).rows[0]?.total;
        await actAsOwner(client);

        expect(after, 'a deactivated member-role reader kept reading the rotation').toBe(0);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'reads no band after a $fixture member-role reader is deactivated',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const reader = await memberByUsername(client, slug, member);
        const count = 'select count(*)::int as total from hour_bands';

        await actAs(client, reader.authUserId, reader.organizationId);
        const before = (await client.query<{ total: number }>(count)).rows[0]?.total;
        await actAsOwner(client);
        expect(before, 'an active member-role reader read no seeded bands').toBe(
          seededBandsOf(slug).length,
        );

        await ownerVersion(client, {
          organization: reader.organizationId,
          member: reader.id,
          active: false,
          from: await organizationDay(client, reader.organizationId),
          by: owner.authUserId,
        });

        await actAs(client, reader.authUserId, reader.organizationId);
        const after = (await client.query<{ total: number }>(count)).rows[0]?.total;
        await actAsOwner(client);

        expect(after, 'a deactivated member-role reader kept reading bands').toBe(0);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'treats a $fixture deactivation from tomorrow, and one already reversed, as active',
    async ({ slug, admin }) => {
      // The negative control for the three above: a helper that read "any
      // inactive version at all" would pass them and lock out everybody ever
      // scheduled or reactivated.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const scheduled = await addThrowawayMember(client, caller.organizationId);
        const reversed = await addThrowawayMember(client, caller.organizationId);

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: scheduled.id,
          active: false,
          from: await organizationDay(client, caller.organizationId, 1),
          by: caller.authUserId,
        });
        await ownerVersion(client, {
          organization: caller.organizationId,
          member: reversed.id,
          active: false,
          from: await organizationDay(client, caller.organizationId, -10),
          by: caller.authUserId,
        });
        await ownerVersion(client, {
          organization: caller.organizationId,
          member: reversed.id,
          active: true,
          from: await organizationDay(client, caller.organizationId),
          by: caller.authUserId,
        });

        for (const subject of [scheduled, reversed]) {
          await actAs(client, subject.authUserId, subject.organizationId);
          const visible = await visibleToSession(client);
          await actAsOwner(client);

          expect(visible.members, `an active ${slug} member read nothing`).toBeGreaterThan(0);
        }
      });
    },
  );
});

describe('the access token hook refuses a member inactive today, and agrees with the helper', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'answers a $fixture member deactivated today with a 403 and no claims, called directly',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: false,
          from: await organizationDay(client, caller.organizationId),
          by: caller.authUserId,
        });

        // EXACTLY, so a 500 or a missing `http_code` fails here: either one
        // would reach the sign-in screen as an outage rather than as the
        // generic credentials message.
        expect(await hookFor(client, target.authUserId)).toEqual(INACTIVE_REFUSAL);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture token exactly when the helper reads the account inactive',
    async ({ slug, admin }) => {
      // Four states, and for each the hook's answer and the helper's must be
      // the same fact: a hook that refused a member the policies still admit
      // locks out a working account, and the reverse mints a token that reads
      // nothing.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const organization = caller.organizationId;
        const states = [
          { what: 'no version', versions: [] as { active: boolean; offset: number }[] },
          { what: 'scheduled out tomorrow', versions: [{ active: false, offset: 1 }] },
          { what: 'deactivated today', versions: [{ active: false, offset: 0 }] },
          {
            what: 'reactivated today',
            versions: [
              { active: false, offset: -3 },
              { active: true, offset: 0 },
            ],
          },
        ];
        const seen: boolean[] = [];

        for (const state of states) {
          const subject = await addThrowawayMember(client, organization);
          for (const version of state.versions) {
            await ownerVersion(client, {
              organization,
              member: subject.id,
              active: version.active,
              from: await organizationDay(client, organization, version.offset),
              by: caller.authUserId,
            });
          }

          await actAs(client, subject.authUserId, organization);
          const active = await helperIsActive(client);
          await actAsOwner(client);
          const answer = await hookFor(client, subject.authUserId);

          seen.push(active === true);
          expect(answer['error'] === undefined, `${slug}, ${state.what}`).toBe(active === true);
        }

        // Both answers occurred, so the agreement above is not vacuous.
        expect(seen).toEqual([true, true, false, true]);
      });
    },
  );
});

describe('today is the organization today, and a zone nobody can resolve is UTC', () => {
  /** A zone whose date differs from UTC's at this instant. One of these two
   *  always does: fourteen hours ahead and eleven behind cannot both agree
   *  with UTC at any moment. */
  const ZONES = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'];

  it.skipIf(noDatabase).each(FIXTURES)(
    'dates the $fixture policy and helper by the organization zone, never by UTC',
    async ({ slug, admin }) => {
      let differed = 0;

      for (const zone of ZONES) {
        await inRolledBackTransaction(async (client) => {
          const caller = await memberByUsername(client, slug, admin);
          const organization = caller.organizationId;

          await client.query('update organizations set timezone = $1 where id = $2', [
            zone,
            organization,
          ]);
          const { rows } = await client.query<{ utc: string; local: string }>(
            `select (now() at time zone 'UTC')::date::text as utc,
                    public.organization_today($1)::text as local`,
            [organization],
          );
          const utc = rows[0]?.utc;
          const local = rows[0]?.local;
          if (utc === undefined || local === undefined) throw new Error('no dates');
          if (utc === local) return;
          differed += 1;

          const today = local;
          const yesterday = await organizationDay(client, organization, -1);
          const tomorrow = await organizationDay(client, organization, 1);
          const outToday = await addThrowawayMember(client, organization);
          const outTomorrow = await addThrowawayMember(client, organization);

          await actAs(client, caller.authUserId, organization);
          const past = await refusedThenContinue(client, () =>
            insertVersion(client, { organization, member: outToday.id, active: false, from: yesterday }),
          );
          const admitted = await insertVersion(client, {
            organization,
            member: outToday.id,
            active: false,
            from: today,
          });
          await insertVersion(client, {
            organization,
            member: outTomorrow.id,
            active: false,
            from: tomorrow,
          });
          await actAsOwner(client);

          expect(past.code, `${zone}: the organization's yesterday was admitted`).toBe('42501');
          expect(admitted.rowCount, `${zone}: the organization's today was refused`).toBe(1);

          await actAs(client, outToday.authUserId, organization);
          const gone = await visibleToSession(client);
          await actAsOwner(client);
          await actAs(client, outTomorrow.authUserId, organization);
          const kept = await visibleToSession(client);
          await actAsOwner(client);

          expect(gone.members, `${zone}: a member out from today still reads`).toBe(0);
          expect(kept.members, `${zone}: a member out from tomorrow lost access`).toBeGreaterThan(0);
          expect(await hookFor(client, outToday.authUserId)).toEqual(INACTIVE_REFUSAL);
          expect((await hookFor(client, outTomorrow.authUserId))['error']).toBeUndefined();
        });
      }

      expect(differed, 'neither zone differed from UTC, so nothing was proven').toBeGreaterThan(0);
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'falls back to UTC for an unresolvable $fixture zone, and still mints a token',
    async ({ slug, admin }) => {
      // The hook must never raise: `organizations.timezone` is unchecked
      // (0002:89-92), and a typo there must not lock the organization out.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await client.query(`update organizations set timezone = 'Not/A_Zone' where id = $1`, [
          caller.organizationId,
        ]);
        const { rows } = await client.query<{ same: boolean }>(
          `select public.organization_today($1) = (now() at time zone 'UTC')::date as same`,
          [caller.organizationId],
        );

        expect(rows[0]?.same, 'an unknown zone did not fall back to UTC').toBe(true);
        expect(await hookFor(client, caller.authUserId)).toMatchObject({
          claims: { organization_id: caller.organizationId },
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const active = await helperIsActive(client);
        const visible = await visibleToSession(client);
        await actAsOwner(client);

        expect(active).toBe(true);
        expect(visible.members).toBeGreaterThan(0);
      });
    },
  );
});

describe('a deactivation reaches a direct API caller and ends a real sign-in', () => {
  const ISSUED = 'deactivation-fixture-password';

  /** A committed throwaway in `organization` with a credential it can sign in
   *  with. Committed because GoTrue reads on its own connection; removed by the
   *  file's `afterAll`, which the status rows cascade from. */
  async function signableIn(
    client: Client,
    organization: string,
  ): Promise<{ member: MemberRow; address: string }> {
    const member = await addThrowawayMember(client, organization);
    const { rows } = await client.query<{ email: string }>(
      'select email from auth.users where id = $1',
      [member.authUserId],
    );
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

    return { member, address: rows[0]?.email ?? '' };
  }

  async function passwordGrant(email: string): Promise<Response> {
    const endpoint = apiEndpoint;
    if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

    return fetch(`${endpoint.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: endpoint.key, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: ISSUED }),
    });
  }

  async function refreshGrant(refreshToken: string): Promise<Response> {
    const endpoint = apiEndpoint;
    if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

    return fetch(`${endpoint.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: endpoint.key, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  }

  it.skipIf(noAdminApi).each(FIXTURES)(
    'refuses the $fixture sign-in and refresh, and the earlier token reads nothing',
    async ({ slug, admin }) => {
      const client = await connect();

      try {
        const caller = await memberByUsername(client, slug, admin);
        const { member, address: email } = await signableIn(client, caller.organizationId);

        // THE CONTROL: the account signs in before it is deactivated.
        const first = await passwordGrant(email);
        const session = (await first.json()) as Record<string, unknown>;
        const token = session['access_token'];
        const refresh = session['refresh_token'];

        expect(first.ok, `the throwaway could not sign in: ${first.status}`).toBe(true);
        if (typeof token !== 'string' || typeof refresh !== 'string') {
          throw new Error('the grant carried no tokens');
        }
        expect(
          (await restRows('members?select=id', { token })).length,
          'the throwaway read nothing before it was deactivated',
        ).toBeGreaterThan(0);

        // THE ADMIN'S OWN WRITE, through PostgREST with the admin's real token —
        // the same call the edit screen makes.
        const adminToken = await tokenFor(admin, slug);
        const written = await rest('member_status_versions', {
          token: adminToken,
          method: 'POST',
          body: {
            organization_id: caller.organizationId,
            member_id: member.id,
            active: false,
            effective_from: await organizationDay(client, caller.organizationId),
          },
        });

        expect(written.status, `the admin deactivation was refused: ${await written.clone().text()}`).toBe(201);

        // SIGN-IN AND REFRESH ARE BOTH REFUSED, as a 4xx that is not 429 — the
        // shape `sign-in.ts` renders as the generic credentials message.
        const again = await passwordGrant(email);
        const refreshed = await refreshGrant(refresh);

        for (const [what, response] of [
          ['sign-in', again],
          ['refresh', refreshed],
        ] as const) {
          expect(response.ok, `a deactivated account completed ${what}`).toBe(false);
          expect(response.status, `${what} was refused as an outage`).toBeGreaterThanOrEqual(400);
          expect(response.status).toBeLessThan(500);
          expect(response.status).not.toBe(429);
        }

        // AC 3 over the shipped path: the token minted before the version still
        // authenticates to PostgREST and reads nothing from any table.
        // STORY 1.7a: a committed team, so the teams read below has something
        // to leak.
        await addThrowawayTeam(client, caller.organizationId, caller.authUserId);

        // STORY 2.3a: the seeded rotation is there to leak, in every fixture.
        for (const table of [
          'members',
          'organizations',
          'member_status_versions',
          'teams',
          'rotation_patterns',
          'rotation_steps',
          'rotation_assignments',
        ]) {
          expect(
            await restRows(`${table}?select=id`, { token }),
            `a deactivated account read ${table} with its earlier token`,
          ).toEqual([]);
        }
      } finally {
        await client.end();
      }
    },
    30_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'cancels the $fixture scheduled version over PostgREST exactly as the edit screen asks, and nothing in effect',
    async ({ slug, admin }) => {
      // THE REQUEST `sendStatus` SENDS: supabase-js turns
      // `.delete().eq('member_id', …).eq('effective_from', …).select('effective_from')`
      // into this DELETE with `Prefer: return=representation`. The row count
      // it answers IS the outcome, so it is asserted over the real transport.
      const client = await connect();

      try {
        const caller = await memberByUsername(client, slug, admin);
        const scheduled = await addThrowawayMember(client, caller.organizationId);
        const inEffect = await addThrowawayMember(client, caller.organizationId);
        const later = await organizationDay(client, caller.organizationId, 5);
        const today = await organizationDay(client, caller.organizationId);

        for (const [member, from] of [
          [scheduled, later],
          [inEffect, today],
        ] as const) {
          await client.query(
            `insert into member_status_versions (organization_id, member_id, active, effective_from, created_by)
             values ($1, $2, false, $3::date, $4)`,
            [caller.organizationId, member.id, from, caller.authUserId],
          );
        }

        const token = await tokenFor(admin, slug);
        const cancel = (member: string, from: string) =>
          rest(
            `member_status_versions?member_id=eq.${member}&effective_from=eq.${from}&select=effective_from`,
            { token, method: 'DELETE', prefer: 'return=representation' },
          );

        const cancelled = await cancel(scheduled.id, later);
        expect(cancelled.status, `the cancellation failed: ${await cancelled.clone().text()}`).toBe(200);
        expect(await cancelled.json()).toEqual([{ effective_from: later }]);

        const kept = await cancel(inEffect.id, today);
        expect(kept.status).toBe(200);
        expect(await kept.json(), 'a version in effect was cancelled').toEqual([]);

        expect(await versionsOf(client, scheduled.id)).toEqual([]);
        expect(await versionsOf(client, inEffect.id)).toHaveLength(1);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture member-role token deactivating anybody over PostgREST',
    async ({ slug, member }) => {
      const client = await connect();

      try {
        const caller = await memberByUsername(client, slug, member);
        const target = await addThrowawayMember(client, caller.organizationId);
        const token = await tokenFor(member, slug);

        const response = await rest('member_status_versions', {
          token,
          method: 'POST',
          body: {
            organization_id: caller.organizationId,
            member_id: target.id,
            active: false,
            effective_from: await organizationDay(client, caller.organizationId),
          },
        });
        const refusal = await restRefusal(response);

        expect(response.ok, 'a member-role account deactivated somebody').toBe(false);
        expect(refusal.code).toBe('42501');
        expect(await versionsOf(client, target.id)).toEqual([]);
      } finally {
        await client.end();
      }
    },
    20_000,
  );
});

// ---------------------------------------------------------------------- teams

/**
 * STORY 1.7a. Every team the SQL cases below write is inside a rolled-back
 * transaction, so none of them outlives its case; the REST cases commit, and
 * name their teams with the throwaway prefix `afterAll` removes.
 */
interface TeamRow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly archived: boolean;
  readonly createdBy: string;
}

/** One team re-read as the owner, so RLS hides nothing. */
async function teamById(client: Client, id: string): Promise<TeamRow | undefined> {
  const { rows } = await client.query<TeamRow>(
    `select id,
            organization_id as "organizationId",
            name,
            archived,
            created_by as "createdBy"
       from teams where id = $1`,
    [id],
  );
  return rows[0];
}

/** Insert one team as the current session, returning its id. */
async function insertTeam(client: Client, organization: string, name: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'insert into teams (organization_id, name) values ($1, $2) returning id',
    [organization, name],
  );
  const team = rows[0];
  if (team === undefined) throw new Error('teams insert returned no row');
  return team.id;
}

/** The teams the current session can see, active and archived, counted. */
async function visibleTeams(client: Client): Promise<{ active: number; archived: number }> {
  const { rows } = await client.query<{ active: number; archived: number }>(
    `select count(*) filter (where not archived)::int as active,
            count(*) filter (where archived)::int as archived
       from teams`,
  );
  const counted = rows[0];
  if (counted === undefined) throw new Error('the count query returned no row');
  return counted;
}

describe('an admin creates, renames and archives teams, and any count is just a count', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'lets the $fixture admin create one, then four, then nine teams, each read back and counted',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);

        const before = await visibleTeams(client);
        const made: string[] = [];
        for (const target of [1, 4, 9]) {
          while (made.length < target) {
            made.push(
              await insertTeam(client, caller.organizationId, `${THROWAWAY} team ${made.length + 1}`),
            );
          }
          expect(
            (await visibleTeams(client)).active - before.active,
            `the ${slug} admin does not see exactly ${target} of the teams they created`,
          ).toBe(target);
        }

        // SCOPED TO THE ROWS THIS CASE MADE, by id: other cases commit
        // throwaway teams outside any transaction, and a name prefix would
        // read theirs too.
        const { rows } = await client.query<{ createdBy: string; total: number }>(
          `select created_by as "createdBy", count(*)::int as total
             from teams where id = any($1::uuid[]) group by created_by`,
          [made],
        );
        expect(rows, 'a team was attributed to somebody other than its creator').toEqual([
          { createdBy: caller.authUserId, total: made.length },
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a blank $fixture team name and writes nothing',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);
        const before = await visibleTeams(client);

        const refusal = await refusedThenContinue(client, () =>
          insertTeam(client, caller.organizationId, '   '),
        );

        expect(refusal.code, 'a blank name is a check violation').toBe('23514');
        expect(await visibleTeams(client)).toEqual(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture team name an active team already carries, in any case and padding',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);
        await insertTeam(client, caller.organizationId, `${THROWAWAY} Čvor`);

        const refusal = await refusedThenContinue(client, () =>
          insertTeam(client, caller.organizationId, ` ${THROWAWAY} čvor `.toUpperCase()),
        );

        expect(refusal.code, 'a duplicate active name is a unique violation').toBe('23505');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'admits a $fixture team name that only an archived team carries',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);
        const name = `${THROWAWAY} reused`;
        const first = await insertTeam(client, caller.organizationId, name);
        const archived = await client.query('update teams set archived = true where id = $1', [
          first,
        ]);

        expect(archived.rowCount).toBe(1);

        const second = await insertTeam(client, caller.organizationId, name);

        expect(second).not.toBe(first);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses renaming a $fixture team into the name another active team carries',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);
        await insertTeam(client, caller.organizationId, `${THROWAWAY} taken`);
        const other = await insertTeam(client, caller.organizationId, `${THROWAWAY} other`);

        const refusal = await refusedThenContinue(client, () =>
          client.query('update teams set name = $1 where id = $2', [` ${THROWAWAY} TAKEN `, other]),
        );
        await actAsOwner(client);

        expect(refusal.code, 'a rename into an active name is a unique violation').toBe('23505');
        expect((await teamById(client, other))?.name).toBe(`${THROWAWAY} other`);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'admits renaming a $fixture team to a name only an archived team carries',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);
        const retired = await insertTeam(client, caller.organizationId, `${THROWAWAY} retired name`);
        await client.query('update teams set archived = true where id = $1', [retired]);
        const other = await insertTeam(client, caller.organizationId, `${THROWAWAY} renamed later`);

        const renamed = await client.query('update teams set name = $1 where id = $2', [
          `${THROWAWAY} retired name`,
          other,
        ]);
        await actAsOwner(client);

        expect(renamed.rowCount, 'a name only an archived team carries was refused').toBe(1);
        expect((await teamById(client, other))?.name).toBe(`${THROWAWAY} retired name`);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'renames a $fixture team in place and archives it without removing the row',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);
        const id = await insertTeam(client, caller.organizationId, `${THROWAWAY} before`);

        const renamed = await client.query('update teams set name = $1 where id = $2', [
          `${THROWAWAY} after`,
          id,
        ]);
        const archived = await client.query('update teams set archived = true where id = $1', [
          id,
        ]);
        await actAsOwner(client);

        expect(renamed.rowCount, `the ${slug} admin could not rename a team`).toBe(1);
        expect(archived.rowCount, `the ${slug} admin could not archive a team`).toBe(1);
        expect(await teamById(client, id)).toMatchObject({
          id,
          name: `${THROWAWAY} after`,
          archived: true,
        });
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'freezes an archived $fixture team: no rename and no unarchive',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);
        const id = await insertTeam(client, caller.organizationId, `${THROWAWAY} frozen`);
        await client.query('update teams set archived = true where id = $1', [id]);

        const renamed = await client.query('update teams set name = $1 where id = $2', [
          `${THROWAWAY} thawed`,
          id,
        ]);
        const unarchived = await client.query('update teams set archived = false where id = $1', [
          id,
        ]);
        await actAsOwner(client);

        expect(renamed.rowCount, 'an archived team was renamed').toBe(0);
        expect(unarchived.rowCount, 'an archived team was unarchived').toBe(0);
        expect(await teamById(client, id)).toMatchObject({
          name: `${THROWAWAY} frozen`,
          archived: true,
        });
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses the $fixture admin deleting a team, and keeps the row',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);
        const id = await insertTeam(client, caller.organizationId, `${THROWAWAY} kept`);

        const refusal = await refusedThenContinue(client, () =>
          client.query('delete from teams where id = $1', [id]),
        );
        await actAsOwner(client);

        expect(refusal.code, 'the delete privilege is revoked, so this is 42501').toBe('42501');
        expect(await teamById(client, id), 'a team was deleted').toBeDefined();
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture admin forging the attribution of a team',
    async ({ slug, admin, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const other = await memberByUsername(client, slug, bystander);
        await actAs(client, caller.authUserId, caller.organizationId);

        const refusal = await refusedThenContinue(client, () =>
          client.query('insert into teams (organization_id, name, created_by) values ($1, $2, $3)', [
            caller.organizationId,
            `${THROWAWAY} forged`,
            other.authUserId,
          ]),
        );

        expect(refusal.code, 'created_by is not a column a session may name').toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role session creating, renaming or archiving a team',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const caller = await memberByUsername(client, slug, member);
        const { rows } = await client.query<{ id: string }>(
          `insert into teams (organization_id, name, created_by) values ($1, $2, $3) returning id`,
          [owner.organizationId, `${THROWAWAY} admin made`, owner.authUserId],
        );
        const id = rows[0]?.id ?? '';

        await actAs(client, caller.authUserId, caller.organizationId);
        const insertRefusal = await refusedThenContinue(client, () =>
          insertTeam(client, caller.organizationId, `${THROWAWAY} member made`),
        );
        const renamed = await client.query('update teams set name = $1 where id = $2', [
          `${THROWAWAY} member renamed`,
          id,
        ]);
        const archived = await client.query('update teams set archived = true where id = $1', [id]);
        await actAsOwner(client);

        expect(insertRefusal.code, 'a member-role insert is refused by WITH CHECK').toBe('42501');
        expect(renamed.rowCount, `a ${slug} member renamed a team`).toBe(0);
        expect(archived.rowCount, `a ${slug} member archived a team`).toBe(0);
        expect(await teamById(client, id)).toMatchObject({
          name: `${THROWAWAY} admin made`,
          archived: false,
        });
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'shows a $fixture member-role session active and archived teams alike, unchanged',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const caller = await memberByUsername(client, slug, member);
        const { rows: made } = await client.query<{ id: string }>(
          `insert into teams (organization_id, name, archived, created_by)
           values ($1, $2, false, $4), ($1, $3, true, $4)
           returning id`,
          [owner.organizationId, `${THROWAWAY} in use`, `${THROWAWAY} retired`, owner.authUserId],
        );

        await actAs(client, caller.authUserId, caller.organizationId);
        const { rows } = await client.query<{ name: string; archived: boolean }>(
          'select name, archived from teams where id = any($1::uuid[]) order by name',
          [made.map((row) => row.id)],
        );

        expect(rows).toEqual([
          { name: `${THROWAWAY} in use`, archived: false },
          { name: `${THROWAWAY} retired`, archived: true },
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'keeps $otherFixture teams out of reach of the $fixture admin',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const other = await organizationId(client, otherSlug);
        const { rows } = await client.query<{ id: string }>(
          `insert into teams (organization_id, name, created_by) values ($1, $2, $3) returning id`,
          [other, `${THROWAWAY} foreign`, caller.authUserId],
        );
        const foreign = rows[0]?.id ?? '';

        await actAs(client, caller.authUserId, caller.organizationId);
        const read = await client.query('select id from teams where organization_id = $1', [other]);
        const renamed = await client.query('update teams set name = $1 where id = $2', [
          `${THROWAWAY} hijacked`,
          foreign,
        ]);
        const archived = await client.query('update teams set archived = true where id = $1', [
          foreign,
        ]);
        const insertRefusal = await refusedThenContinue(client, () =>
          insertTeam(client, other, `${THROWAWAY} planted`),
        );
        const own = await insertTeam(client, caller.organizationId, `${THROWAWAY} own`);
        const moved = await refusedThenContinue(client, () =>
          client.query('update teams set organization_id = $1 where id = $2', [other, own]),
        );
        await actAsOwner(client);

        expect(read.rowCount, `a ${slug} admin read ${otherSlug} teams`).toBe(0);
        expect(renamed.rowCount, `a ${slug} admin renamed a ${otherSlug} team`).toBe(0);
        expect(archived.rowCount, `a ${slug} admin archived a ${otherSlug} team`).toBe(0);
        expect(insertRefusal.code).toBe('42501');
        expect(moved.code, 'organization_id is not a column a session may update').toBe('42501');
        expect(await teamById(client, foreign)).toMatchObject({
          name: `${THROWAWAY} foreign`,
          archived: false,
        });
      });
    },
  );
});

describe('a direct API call writes teams under exactly the same rules', () => {
  it.skipIf(noApi).each(FIXTURES)(
    'lets the $fixture admin create, rename and archive a team over PostgREST',
    async ({ slug, admin }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const name = `${THROWAWAY} rest ${crypto.randomUUID()}`;
        const created = await rest('teams?select=id', {
          token,
          method: 'POST',
          body: { organization_id: own, name },
          prefer: 'return=representation',
        });
        expect(created.status, 'a permitted insert answers 201').toBe(201);
        const [row] = (await created.json()) as readonly { id: string }[];
        const id = row?.id ?? '';

        const renamed = await rest(`teams?id=eq.${id}&select=id`, {
          token,
          method: 'PATCH',
          body: { name: `${name} renamed` },
          prefer: 'return=representation',
        });
        expect(await renamed.json(), 'the rename reached no row').toEqual([{ id }]);

        const archived = await rest(`teams?id=eq.${id}&select=id`, {
          token,
          method: 'PATCH',
          body: { archived: true },
          prefer: 'return=representation',
        });
        expect(await archived.json(), 'the archive reached no row').toEqual([{ id }]);

        const unarchived = await rest(`teams?id=eq.${id}&select=id`, {
          token,
          method: 'PATCH',
          body: { archived: false },
          prefer: 'return=representation',
        });
        expect(await unarchived.json(), 'an archived team was unarchived').toEqual([]);

        expect(await teamById(client, id)).toMatchObject({
          name: `${name} renamed`,
          archived: true,
        });
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture admin deleting a team over PostgREST, and keeps the row',
    async ({ slug, admin }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const caller = await memberByUsername(client, slug, admin);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);

        const response = await rest(`teams?id=eq.${team.id}`, { token, method: 'DELETE' });
        const refusal = await restRefusal(response);

        expect(response.ok, 'a team was deleted over PostgREST').toBe(false);
        expect(refusal.code).toBe('42501');
        expect(await teamById(client, team.id)).toBeDefined();
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture member-role token creating or renaming a team over PostgREST',
    async ({ slug, admin, member }) => {
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const owner = await memberByUsername(client, slug, admin);
        const team = await addThrowawayTeam(client, owner.organizationId, owner.authUserId);

        const created = await rest('teams', {
          token,
          method: 'POST',
          body: { organization_id: owner.organizationId, name: `${THROWAWAY} by a member` },
        });
        const refusal = await restRefusal(created);
        const renamed = await rest(`teams?id=eq.${team.id}`, {
          token,
          method: 'PATCH',
          body: { name: `${THROWAWAY} renamed by a member` },
        });

        expect(created.ok, 'a member-role account created a team').toBe(false);
        expect(refusal.code).toBe('42501');
        expect(renamed.status, 'a refused update matches no row and raises nothing').toBe(204);
        expect((await teamById(client, team.id))?.name).toBe(team.name);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture member-role token archiving a team over PostgREST, row unchanged',
    async ({ slug, admin, member }) => {
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const owner = await memberByUsername(client, slug, admin);
        const team = await addThrowawayTeam(client, owner.organizationId, owner.authUserId);

        const archived = await rest(`teams?id=eq.${team.id}&select=id`, {
          token,
          method: 'PATCH',
          body: { archived: true },
          prefer: 'return=representation',
        });

        expect(await archived.json(), 'a member-role account archived a team').toEqual([]);
        expect(await teamById(client, team.id)).toMatchObject({ name: team.name, archived: false });
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'returns archived teams to a $fixture member-role token, unchanged',
    async ({ slug, admin, member }) => {
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const owner = await memberByUsername(client, slug, admin);
        const team = await addThrowawayTeam(client, owner.organizationId, owner.authUserId, true);

        expect(
          await restRows(`teams?id=eq.${team.id}&select=id,name,archived`, { token }),
        ).toEqual([{ id: team.id, name: team.name, archived: true }]);
      } finally {
        await client.end();
      }
    },
    20_000,
  );
});

// ------------------------------------------------------------ team membership

/**
 * STORY 1.7b. A member moves between teams from a chosen date, and history is
 * never rewritten. `0010_team_membership.sql` is the whole enforcement: one
 * versioned table under the status table's rules, one reading of it
 * (`member_team_on`), and the teams update policy's archive refusal. Every SQL
 * case below runs in a rolled-back transaction; the REST cases commit, on
 * throwaway members and teams `afterAll` removes (versions first, since they
 * reference teams with no cascade).
 */
interface MembershipRow {
  readonly organizationId: string;
  readonly id: string;
  readonly memberId: string;
  readonly teamId: string | null;
  /** TEAM POSITION (`0015`): the position the version records, or null. */
  readonly position: string | null;
  readonly from: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** Every membership version of one member, oldest first, read as the owner:
 *  every column of the table, so an equality is a whole-row equality. */
async function membershipsOf(client: Client, member: string): Promise<MembershipRow[]> {
  const { rows } = await client.query<MembershipRow>(
    `select organization_id as "organizationId", id, member_id as "memberId",
            team_id as "teamId", position, effective_from::text as "from",
            created_by as "createdBy", created_at::text as "createdAt"
       from team_membership_versions where member_id = $1 order by effective_from`,
    [member],
  );
  return rows;
}

/**
 * The position a helper writes when a case names none. TEAM POSITION (`0015`):
 * the pilot uses fire ranks and positions, so a version naming a team there
 * carries {@link DEFAULT_TEST_POSITION}; UJ-5 does not, so it carries null and
 * the cases written before positions existed keep exercising the null path.
 * Either way every version a case writes in one organization carries the same
 * position, so those cases keep meaning what they meant: dates and teams.
 */
const DEFAULT_TEST_POSITION = 'firefighter';

/** The position a version naming a team carries by default in `slug`. */
function defaultPositionIn(slug: string): string | null {
  return SEEDED_USES_FIRE_RANKS[slug] === true ? DEFAULT_TEST_POSITION : null;
}

/** The default position by the organization's SEEDED setting, read as the
 *  owner's view of its slug so it holds whoever the connection is acting as. */
async function positionFor(
  client: Client,
  version: { organization: string; team: string | null; position?: string | null },
): Promise<string | null> {
  if (version.position !== undefined) return version.position;
  if (version.team === null) return null;

  const slug = FIXTURE_SLUG_BY_ORGANIZATION.get(version.organization) ?? (await slugOf(client, version.organization));

  return slug === undefined ? null : defaultPositionIn(slug);
}

/** Organization id → slug, filled as `slugOf` learns them. */
const FIXTURE_SLUG_BY_ORGANIZATION = new Map<string, string>();

/** The slug of an organization, as whoever the connection is acting as: a
 *  row the session cannot see (another tenant's) has no default at all. */
async function slugOf(client: Client, organization: string): Promise<string | undefined> {
  const { rows } = await client.query<{ slug: string }>(
    'select slug from organizations where id = $1',
    [organization],
  );
  const slug = rows[0]?.slug;
  if (slug !== undefined) FIXTURE_SLUG_BY_ORGANIZATION.set(organization, slug);
  return slug;
}

/** One membership version, as whoever the connection currently is: the five
 *  columns a session may name, and nothing else. */
async function insertMembership(
  client: Client,
  version: {
    organization: string;
    member: string;
    team: string | null;
    from: string;
    position?: string | null;
  },
): Promise<{ rowCount: number | null }> {
  return client.query(
    `insert into team_membership_versions (organization_id, member_id, team_id, position, effective_from)
     values ($1, $2, $3, $4, $5::date)`,
    [version.organization, version.member, version.team, await positionFor(client, version), version.from],
  );
}

/** One membership version written as the OWNER, past every policy — the state
 *  a case starts from (a past date is only reachable this way). */
async function ownerMembership(
  client: Client,
  version: {
    organization: string;
    member: string;
    team: string | null;
    from: string;
    by: string;
    position?: string | null;
  },
): Promise<void> {
  await client.query(
    `insert into team_membership_versions
       (organization_id, member_id, team_id, position, effective_from, created_by)
     values ($1, $2, $3, $4, $5::date, $6)`,
    [
      version.organization,
      version.member,
      version.team,
      await positionFor(client, version),
      version.from,
      version.by,
    ],
  );
}

/** The cancellation the edit screen sends, as whoever the connection is. */
async function cancelMembership(
  client: Client,
  version: { member: string; from: string },
): Promise<{ rowCount: number | null }> {
  return client.query(
    'delete from team_membership_versions where member_id = $1 and effective_from = $2::date',
    [version.member, version.from],
  );
}

/** `member_team_on`, the one SQL reading, as whoever the connection is. */
async function teamOn(client: Client, member: string, day: string): Promise<string | null> {
  const { rows } = await client.query<{ team: string | null }>(
    'select public.member_team_on($1, $2::date) as team',
    [member, day],
  );
  return rows[0]?.team ?? null;
}

/** Archive a team as whoever the connection is. */
async function archiveTeam(client: Client, team: string): Promise<{ rowCount: number | null }> {
  return client.query('update teams set archived = true where id = $1', [team]);
}

describe('an admin moves a member between teams from a date, and the table only ever grows', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'assigns a $fixture member with no team to a team from today, attributed to the caller',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const today = await organizationDay(client, caller.organizationId);
        const yesterday = await organizationDay(client, caller.organizationId, -1);

        expect(await teamOn(client, target.id, today), 'a fresh member is on a team').toBeNull();

        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await insertMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          from: today,
        });
        await actAsOwner(client);

        expect(written.rowCount, `the ${slug} admin could not assign a team`).toBe(1);
        const [row] = await membershipsOf(client, target.id);
        expect(row).toMatchObject({ teamId: team.id, from: today, createdBy: caller.authUserId });
        expect(await teamOn(client, target.id, today)).toBe(team.id);
        expect(await teamOn(client, target.id, yesterday), 'the assignment reached back').toBeNull();
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'lets the $fixture admin set their own team',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);

        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await insertMembership(client, {
          organization: caller.organizationId,
          member: caller.id,
          team: team.id,
          from: await organizationDay(client, caller.organizationId),
        });
        await actAsOwner(client);

        expect(written.rowCount, 'an admin could not set their own team').toBe(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'moves a $fixture member from a later date with one new row and the earlier row byte-identical',
    async ({ slug, admin }) => {
      // AC 1, and the past-team row of the matrix.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const first = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const second = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const joined = await organizationDay(client, caller.organizationId, -10);
        const moved = await organizationDay(client, caller.organizationId, 5);

        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: first.id,
          from: joined,
          by: caller.authUserId,
        });
        const before = await membershipsOf(client, target.id);

        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await insertMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: second.id,
          from: moved,
        });
        await actAsOwner(client);

        const after = await membershipsOf(client, target.id);
        expect(written.rowCount).toBe(1);
        expect(after.length, 'the move did not add exactly one row').toBe(before.length + 1);
        expect(after[0], 'the earlier row changed').toEqual(before[0]);

        const { rows } = await client.query<{ day: string; team: string | null }>(
          `select day::date::text as day, public.member_team_on($1, day::date) as team
             from generate_series(public.organization_today($2) - 12,
                                  public.organization_today($2) + 10,
                                  interval '1 day') as day
            order by day`,
          [target.id, caller.organizationId],
        );
        expect(rows.length).toBe(23);
        for (const { day, team } of rows) {
          const expected = day < joined ? null : day < moved ? first.id : second.id;
          expect(team, `${slug} team as at ${day}`).toBe(expected);
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'reads a $fixture member\'s team on every date exactly as the member list derives it',
    async ({ slug, admin }) => {
      // AC 2: `member_team_on` over THE SAME history and written-out answers
      // `apps/web/src/features/members/services/list.test.ts` asserts `memberTeamOn` against, so
      // the two readings agree on every date rather than each on its own.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const teams = {
          A: await addThrowawayTeam(client, caller.organizationId, caller.authUserId),
          B: await addThrowawayTeam(client, caller.organizationId, caller.authUserId),
        } as const;

        for (const { offset, team } of TEAM_HISTORY) {
          await ownerMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: team === null ? null : teams[team].id,
            from: await organizationDay(client, caller.organizationId, offset),
            by: caller.authUserId,
          });
        }

        const { rows } = await client.query<{ offset: number; team: string | null }>(
          `select offset_day as "offset",
                  public.member_team_on($1, public.organization_today($2) + offset_day) as team
             from generate_series($3::int, $4::int) as offset_day
            order by offset_day`,
          [target.id, caller.organizationId, TEAM_HISTORY_SPAN.from, TEAM_HISTORY_SPAN.to],
        );
        expect(rows.length).toBe(TEAM_HISTORY_ANSWERS.size);
        for (const { offset, team } of rows) {
          const answer = TEAM_HISTORY_ANSWERS.get(offset);
          expect(answer, `no written answer for offset ${offset}`).not.toBeUndefined();
          expect(team, `${slug} team at offset ${offset}`).toBe(
            answer === null || answer === undefined ? null : teams[answer].id,
          );
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'removes a $fixture member from their team from a date, and they are on none from then',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const removed = await organizationDay(client, caller.organizationId, 3);

        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          from: await organizationDay(client, caller.organizationId, -5),
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await insertMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: null,
          from: removed,
        });
        await actAsOwner(client);

        expect(written.rowCount, 'a removal was refused').toBe(1);
        expect(await teamOn(client, target.id, await organizationDay(client, caller.organizationId, 2))).toBe(
          team.id,
        );
        expect(await teamOn(client, target.id, removed)).toBeNull();
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'lets no $fixture session name its own attribution',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const today = await organizationDay(client, caller.organizationId);

        await actAs(client, caller.authUserId, caller.organizationId);
        const forged = await refusedThenContinue(client, () =>
          client.query(
            `insert into team_membership_versions
               (organization_id, member_id, team_id, effective_from, created_by)
             values ($1, $2, $3, $4::date, $5)`,
            [caller.organizationId, target.id, team.id, today, target.authUserId],
          ),
        );
        const backdated = await refusedThenContinue(client, () =>
          client.query(
            `insert into team_membership_versions
               (organization_id, member_id, team_id, effective_from, created_at)
             values ($1, $2, $3, $4::date, now() - interval '1 year')`,
            [caller.organizationId, target.id, team.id, today],
          ),
        );
        await actAsOwner(client);

        expect(forged.code, 'a session named its own created_by').toBe('42501');
        expect(backdated.code, 'a session named its own created_at').toBe('42501');
        expect(await membershipsOf(client, target.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'updates no $fixture version, and deletes none already in effect, whoever asks',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const first = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const second = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);

        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: first.id,
          from: await organizationDay(client, caller.organizationId, -5),
          by: caller.authUserId,
        });
        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: second.id,
          from: await organizationDay(client, caller.organizationId),
          by: caller.authUserId,
        });
        const before = await membershipsOf(client, target.id);

        await actAs(client, caller.authUserId, caller.organizationId);
        const updated = await refusedThenContinue(client, () =>
          client.query('update team_membership_versions set team_id = null'),
        );
        const deleted = await client.query('delete from team_membership_versions');
        await actAsOwner(client);

        expect(updated.code, 'an admin rewrote a membership version').toBe('42501');
        expect(deleted.rowCount, 'an admin deleted a version already in effect').toBe(0);
        expect(await membershipsOf(client, target.id)).toEqual(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture assignment dated yesterday, and writes nothing',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);

        await actAs(client, caller.authUserId, caller.organizationId);
        const past = await refusedThenContinue(client, async () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: team.id,
            from: await organizationDay(client, caller.organizationId, -1),
          }),
        );
        await actAsOwner(client);

        expect(past.code, 'a past date would rewrite past rosters').toBe('42501');
        expect(await membershipsOf(client, target.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second $fixture version on the latest one date, and the table itself refuses it too',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const first = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const second = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const today = await organizationDay(client, caller.organizationId);

        await actAs(client, caller.authUserId, caller.organizationId);
        await insertMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: first.id,
          from: today,
        });
        const refusal = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: second.id,
            from: today,
          }),
        );
        await actAsOwner(client);

        // THE DATE-ORDER RULE refuses it first, as the policy's 42501; the
        // unique constraint stands behind it for the owner.
        expect(refusal.code, 'a version on the latest version date was admitted').toBe('42501');
        expect(await membershipsOf(client, target.id)).toHaveLength(1);

        const underneath = await refusedThenContinue(client, () =>
          ownerMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: second.id,
            from: today,
            by: caller.authUserId,
          }),
        );
        expect(underneath.code, 'the table itself admits two versions on one date').toBe('23505');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture version that leaves the team unchanged, or "no team" for a member on none',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const onTeam = await addThrowawayMember(client, caller.organizationId);
        const removed = await addThrowawayMember(client, caller.organizationId);
        const fresh = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const today = await organizationDay(client, caller.organizationId);
        const later = await organizationDay(client, caller.organizationId, 3);

        await ownerMembership(client, {
          organization: caller.organizationId,
          member: removed.id,
          team: team.id,
          from: await organizationDay(client, caller.organizationId, -5),
          by: caller.authUserId,
        });
        await ownerMembership(client, {
          organization: caller.organizationId,
          member: removed.id,
          team: null,
          from: await organizationDay(client, caller.organizationId, -3),
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        await insertMembership(client, {
          organization: caller.organizationId,
          member: onTeam.id,
          team: team.id,
          from: today,
        });
        const sameTeam = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: onTeam.id,
            team: team.id,
            from: later,
          }),
        );
        const noneAgain = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: removed.id,
            team: null,
            from: today,
          }),
        );
        const noneFresh = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: fresh.id,
            team: null,
            from: today,
          }),
        );
        await actAsOwner(client);

        expect(sameTeam.code, 'a version onto the team the member is on').toBe('42501');
        expect(noneAgain.code, '"no team" for a member already on none').toBe('42501');
        expect(noneFresh.code, '"no team" for a member with no history').toBe('42501');
        expect(await membershipsOf(client, onTeam.id)).toHaveLength(1);
        expect(await membershipsOf(client, removed.id)).toHaveLength(2);
        expect(await membershipsOf(client, fresh.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second $fixture change while one is scheduled, in or out of date order',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const first = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const second = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const scheduled = await organizationDay(client, caller.organizationId, 5);

        await actAs(client, caller.authUserId, caller.organizationId);
        await insertMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: first.id,
          from: scheduled,
        });
        const stacked = await refusedThenContinue(client, async () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: second.id,
            from: await organizationDay(client, caller.organizationId, 10),
          }),
        );
        const earlier = await refusedThenContinue(client, async () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: second.id,
            from: await organizationDay(client, caller.organizationId, 2),
          }),
        );
        await actAsOwner(client);

        expect(stacked.code, 'a second future version was admitted').toBe('42501');
        expect(earlier.code, 'a version before the scheduled one was admitted').toBe('42501');
        expect((await membershipsOf(client, target.id)).map((row) => row.from)).toEqual([scheduled]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'cancels a $fixture scheduled move, and the prior team continues',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const first = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const second = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const moved = await organizationDay(client, caller.organizationId, 5);

        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: first.id,
          from: await organizationDay(client, caller.organizationId, -5),
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        await insertMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: second.id,
          from: moved,
        });
        const cancelled = await cancelMembership(client, { member: target.id, from: moved });
        await actAsOwner(client);

        expect(cancelled.rowCount, 'the scheduled move could not be cancelled').toBe(1);
        expect(await membershipsOf(client, target.id)).toHaveLength(1);
        expect(await teamOn(client, target.id, moved)).toBe(first.id);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses cancelling a $fixture version in effect today or earlier, and keeps the row',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const today = await addThrowawayMember(client, caller.organizationId);
        const past = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const todayDate = await organizationDay(client, caller.organizationId);
        const pastDate = await organizationDay(client, caller.organizationId, -4);

        await ownerMembership(client, {
          organization: caller.organizationId,
          member: past.id,
          team: team.id,
          from: pastDate,
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        await insertMembership(client, {
          organization: caller.organizationId,
          member: today.id,
          team: team.id,
          from: todayDate,
        });
        const fromToday = await cancelMembership(client, { member: today.id, from: todayDate });
        const fromPast = await cancelMembership(client, { member: past.id, from: pastDate });
        await actAsOwner(client);

        expect(fromToday.rowCount, 'a version in effect from today was cancelled').toBe(0);
        expect(fromPast.rowCount, 'a past version was cancelled').toBe(0);
        expect(await membershipsOf(client, today.id)).toHaveLength(1);
        expect(await membershipsOf(client, past.id)).toHaveLength(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture move onto an archived team',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const archived = await addThrowawayTeam(
          client,
          caller.organizationId,
          caller.authUserId,
          true,
        );

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, async () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: archived.id,
            from: await organizationDay(client, caller.organizationId),
          }),
        );
        await actAsOwner(client);

        expect(refusal.code, 'a member was moved onto an archived team').toBe('42501');
        expect(await membershipsOf(client, target.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'refuses a $fixture admin naming a $otherFixture team, member or organization',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = await addThrowawayMember(client, caller.organizationId);
        const ownTeam = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const other = await organizationId(client, otherSlug);
        const otherAdmin = FIXTURES.find((entry) => entry.slug === otherSlug)?.admin ?? '';
        const otherCreator = await memberByUsername(client, otherSlug, otherAdmin);
        const foreignMember = await addThrowawayMember(client, other);
        const foreignTeam = await addThrowawayTeam(client, other, otherCreator.authUserId);
        const today = await organizationDay(client, caller.organizationId);
        const otherToday = await organizationDay(client, other);

        await actAs(client, caller.authUserId, caller.organizationId);
        const byTeam = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: own.id,
            team: foreignTeam.id,
            from: today,
          }),
        );
        const byMember = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: foreignMember.id,
            team: ownTeam.id,
            from: today,
          }),
        );
        const byOrganization = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: other,
            member: foreignMember.id,
            team: foreignTeam.id,
            from: otherToday,
          }),
        );
        await actAsOwner(client);

        expect(['42501', '23503'], `a ${otherSlug} team was named`).toContain(byTeam.code);
        expect(['42501', '23503'], `a ${otherSlug} member was named`).toContain(byMember.code);
        expect(byOrganization.code, `a ${otherSlug} version was written`).toBe('42501');
        expect(await membershipsOf(client, own.id)).toEqual([]);
        expect(await membershipsOf(client, foreignMember.id)).toEqual([]);

        // THE TABLE ITSELF, past every policy: the composite keys make a
        // cross-tenant reference unrepresentable, not merely refused.
        const underneath = await refusedThenContinue(client, () =>
          ownerMembership(client, {
            organization: caller.organizationId,
            member: own.id,
            team: foreignTeam.id,
            from: today,
            by: caller.authUserId,
          }),
        );
        expect(underneath.code, 'the table admits another tenant team').toBe('23503');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role account writing or cancelling, and a foreign admin too',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const caller = await memberByUsername(client, slug, member);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, owner.authUserId);
        const today = await organizationDay(client, caller.organizationId);
        const scheduled = await organizationDay(client, caller.organizationId, 4);
        const other = FIXTURES.find((entry) => entry.slug !== slug);
        if (other === undefined) throw new Error('no second fixture');
        const foreign = await memberByUsername(client, other.slug, other.admin);
        const scheduledMember = await addThrowawayMember(client, caller.organizationId);

        await ownerMembership(client, {
          organization: caller.organizationId,
          member: scheduledMember.id,
          team: team.id,
          from: scheduled,
          by: owner.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const byMember = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: team.id,
            from: today,
          }),
        );
        const memberCancel = await cancelMembership(client, {
          member: scheduledMember.id,
          from: scheduled,
        });
        await actAsOwner(client);

        await actAs(client, foreign.authUserId, foreign.organizationId);
        const byForeigner = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: team.id,
            from: today,
          }),
        );
        const foreignCancel = await cancelMembership(client, {
          member: scheduledMember.id,
          from: scheduled,
        });
        await actAsOwner(client);

        expect(byMember.code, 'a member-role account assigned a team').toBe('42501');
        expect(byForeigner.code, 'an admin assigned another tenant member').toBe('42501');
        expect(memberCancel.rowCount, 'a member-role account cancelled a move').toBe(0);
        expect(foreignCancel.rowCount, 'a foreign admin cancelled a move').toBe(0);
        expect(await membershipsOf(client, target.id)).toEqual([]);
        expect(await membershipsOf(client, scheduledMember.id)).toHaveLength(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'shows a $fixture member-role account every version in its own organization',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const caller = await memberByUsername(client, slug, member);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, owner.authUserId);

        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          from: await organizationDay(client, caller.organizationId, -3),
          by: owner.authUserId,
        });
        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: null,
          from: await organizationDay(client, caller.organizationId, 3),
          by: owner.authUserId,
        });
        const { rows: truth } = await client.query<{ total: number }>(
          'select count(*)::int as total from team_membership_versions where organization_id = $1',
          [caller.organizationId],
        );

        await actAs(client, caller.authUserId, caller.organizationId);
        const { rows: seen } = await client.query<{ total: number; foreign: number }>(
          `select count(*)::int as total,
                  count(*) filter (where organization_id <> $1)::int as "foreign"
             from team_membership_versions`,
          [caller.organizationId],
        );
        await actAsOwner(client);

        expect(truth[0]?.total).toBeGreaterThanOrEqual(2);
        expect(seen[0], 'a member-role account does not see every version').toEqual({
          total: truth[0]?.total,
          foreign: 0,
        });
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses an unbounded $fixture date in the table itself',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);

        for (const from of ['infinity', '10000-01-01']) {
          const refusal = await refusedThenContinue(client, () =>
            ownerMembership(client, {
              organization: caller.organizationId,
              member: target.id,
              team: team.id,
              from,
              by: caller.authUserId,
            }),
          );
          expect(refusal.code, `${from} was stored`).toBe('23514');
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'keeps $fixture team and status independent: a deactivated member still moves',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const today = await organizationDay(client, caller.organizationId);

        await ownerVersion(client, {
          organization: caller.organizationId,
          member: target.id,
          active: false,
          from: await organizationDay(client, caller.organizationId, -2),
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await insertMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          from: today,
        });
        await actAsOwner(client);

        expect(written.rowCount, 'an inactive member could not be assigned').toBe(1);
        expect(await versionsOf(client, target.id), 'the move rewrote status').toHaveLength(1);
      });
    },
  );
});

describe('archiving a team anyone is on today, or is scheduled onto, is refused', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses archiving a $fixture team a member is on today, active or not, or scheduled onto',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const onToday = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const onInactive = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const scheduledOnto = await addThrowawayTeam(
          client,
          caller.organizationId,
          caller.authUserId,
        );
        const leavingLater = await addThrowawayTeam(
          client,
          caller.organizationId,
          caller.authUserId,
        );
        const first = await addThrowawayMember(client, caller.organizationId);
        const inactive = await addThrowawayMember(client, caller.organizationId);
        const joining = await addThrowawayMember(client, caller.organizationId);
        const leaving = await addThrowawayMember(client, caller.organizationId);
        const byOwner = (member: string, team: string | null, from: string) =>
          ownerMembership(client, {
            organization: caller.organizationId,
            member,
            team,
            from,
            by: caller.authUserId,
          });

        await byOwner(first.id, onToday.id, await organizationDay(client, caller.organizationId, -3));
        await byOwner(inactive.id, onInactive.id, await organizationDay(client, caller.organizationId, -3));
        await ownerVersion(client, {
          organization: caller.organizationId,
          member: inactive.id,
          active: false,
          from: await organizationDay(client, caller.organizationId, -1),
          by: caller.authUserId,
        });
        await byOwner(joining.id, scheduledOnto.id, await organizationDay(client, caller.organizationId, 6));
        await byOwner(leaving.id, leavingLater.id, await organizationDay(client, caller.organizationId, -8));
        await byOwner(leaving.id, null, await organizationDay(client, caller.organizationId, 2));

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusals = [];
        for (const team of [onToday, onInactive, scheduledOnto, leavingLater]) {
          refusals.push((await refusedThenContinue(client, () => archiveTeam(client, team.id))).code);
        }
        // A RENAME of a team in use still passes: `archived` stays false.
        const renamed = await client.query('update teams set name = name || $2 where id = $1', [
          onToday.id,
          ' renamed',
        ]);
        await actAsOwner(client);

        expect(refusals, 'a team in use was archived').toEqual(['42501', '42501', '42501', '42501']);
        expect(renamed.rowCount, 'renaming a team in use was refused').toBe(1);
        for (const team of [onToday, onInactive, scheduledOnto, leavingLater]) {
          expect((await teamById(client, team.id))?.archived).toBe(false);
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'archives a $fixture team only past versions name, and those still read it',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const past = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const current = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const target = await addThrowawayMember(client, caller.organizationId);
        const back = await organizationDay(client, caller.organizationId, -5);

        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: past.id,
          from: await organizationDay(client, caller.organizationId, -10),
          by: caller.authUserId,
        });
        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: current.id,
          from: await organizationDay(client, caller.organizationId, -2),
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const archived = await archiveTeam(client, past.id);
        await actAsOwner(client);

        expect(archived.rowCount, 'a team only history names could not be archived').toBe(1);
        expect((await teamById(client, past.id))?.archived).toBe(true);
        expect(await teamOn(client, target.id, back), 'history lost its archived team').toBe(past.id);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'reads "today" for the $fixture archive rule in the organization zone, never UTC',
    async ({ slug, admin }) => {
      // Two histories per zone: one that left the team on the organization's
      // today (free to archive), and one that leaves it on the organization's
      // tomorrow (still in use). A rule reading UTC's date gets one of them
      // wrong in whichever zone differs from UTC.
      const ZONES = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'];
      let differed = 0;

      for (const zone of ZONES) {
        await inRolledBackTransaction(async (client) => {
          const caller = await memberByUsername(client, slug, admin);
          const organization = caller.organizationId;
          await client.query('update organizations set timezone = $1 where id = $2', [
            zone,
            organization,
          ]);
          const { rows } = await client.query<{ same: boolean }>(
            `select public.organization_today($1) = (now() at time zone 'UTC')::date as same`,
            [organization],
          );
          if (rows[0]?.same !== false) return;
          differed += 1;

          const left = await addThrowawayTeam(client, organization, caller.authUserId);
          const staying = await addThrowawayTeam(client, organization, caller.authUserId);
          const elsewhere = await addThrowawayTeam(client, organization, caller.authUserId);
          const mover = await addThrowawayMember(client, organization);
          const stayer = await addThrowawayMember(client, organization);
          const byOwner = (member: string, team: string, offset: number) =>
            organizationDay(client, organization, offset).then((from) =>
              ownerMembership(client, { organization, member, team, from, by: caller.authUserId }),
            );

          await byOwner(mover.id, left.id, -5);
          await byOwner(mover.id, elsewhere.id, 0);
          await byOwner(stayer.id, staying.id, -5);
          await byOwner(stayer.id, elsewhere.id, 1);
          const joiner = await addThrowawayMember(client, organization);
          const today = await organizationDay(client, organization);

          await actAs(client, caller.authUserId, organization);
          const free = await archiveTeam(client, left.id);
          const inUse = await refusedThenContinue(client, () => archiveTeam(client, staying.id));
          const joinToday = await insertMembership(client, {
            organization,
            member: joiner.id,
            team: elsewhere.id,
            from: today,
          });
          await actAsOwner(client);

          expect(free.rowCount, `${zone}: a team left on the organization's today stayed in use`).toBe(1);
          expect(inUse.code, `${zone}: a team left tomorrow was archived today`).toBe('42501');
          expect(joinToday.rowCount, `${zone}: the organization's today was refused`).toBe(1);
        });
      }

      expect(differed, 'neither zone differed from UTC, so nothing was proven').toBeGreaterThan(0);
    },
  );
});

describe('a direct API call moves members between teams under exactly the same rules', () => {
  it.skipIf(noApi).each(FIXTURES)(
    'lets the $fixture admin assign over PostgREST, and the shipped list read embeds the team for the admin and not a member',
    async ({ slug, admin, member }) => {
      const client = await connect();
      try {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const today = await organizationDay(client, caller.organizationId);
        const token = await tokenFor(admin, slug);
        // TEAM POSITION: what the edit screen sends — a position while the
        // setting is on, null while it is off.
        const position = SEEDED_USES_FIRE_RANKS[slug] === true ? 'driver' : null;

        const written = await rest('team_membership_versions', {
          token,
          method: 'POST',
          body: {
            organization_id: caller.organizationId,
            member_id: target.id,
            team_id: team.id,
            position,
            effective_from: today,
          },
        });
        expect(written.status, `the assignment was refused: ${await written.clone().text()}`).toBe(201);

        // THE SELECT `features/members/services/list.ts` SENDS, embeds included, as both levels.
        const columns =
          'organization_id,id,auth_user_id,name,username,email,role,leave_allowance_days,' +
          'member_status_versions(active,effective_from),' +
          'team_membership_versions(team_id,position,effective_from,teams(name)),organizations(timezone)';
        // STORY 1.8: a member-role session reads only its own row, so a
        // colleague's team reaches it through `team_roster`, never this embed.
        expect(
          await restRows(`members?select=${columns}&id=eq.${target.id}`, {
            token: await tokenFor(member, slug),
          }),
          `${member} read a colleague's row`,
        ).toEqual([]);
        for (const reader of [admin]) {
          const rows = await restRows(`members?select=${columns}&id=eq.${target.id}`, {
            token: await tokenFor(reader, slug),
          });
          expect(rows[0]?.['team_membership_versions'], `${reader} read no team`).toEqual([
            { team_id: team.id, position, effective_from: today, teams: { name: team.name } },
          ]);
        }
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'still embeds an archived team\'s name in the $fixture shipped list read for the admin, and none to a member',
    async ({ slug, admin, member }) => {
      // R7.6: an archived team stays readable. `features/members/services/list.ts` refuses a whole
      // row whose version names a team with no embedded name, so a past version
      // on an archived team that the embed could not see would make the member
      // unlistable.
      const client = await connect();
      try {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const joined = await organizationDay(client, caller.organizationId, -10);
        const left = await organizationDay(client, caller.organizationId, -2);

        for (const [teamId, from] of [
          [team.id, joined],
          [null, left],
        ] as const) {
          await ownerMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: teamId,
            from,
            by: caller.authUserId,
          });
        }
        await client.query('update teams set archived = true where id = $1', [team.id]);

        const columns =
          'organization_id,id,auth_user_id,name,username,email,role,leave_allowance_days,' +
          'member_status_versions(active,effective_from),' +
          'team_membership_versions(team_id,position,effective_from,teams(name)),organizations(timezone)';
        expect(
          await restRows(`members?select=${columns}&id=eq.${target.id}`, {
            token: await tokenFor(member, slug),
          }),
          `${member} read a colleague's row`,
        ).toEqual([]);
        for (const reader of [admin]) {
          const rows = await restRows(`members?select=${columns}&id=eq.${target.id}`, {
            token: await tokenFor(reader, slug),
          });
          const versions = [
            ...((rows[0]?.['team_membership_versions'] ?? []) as { effective_from: string }[]),
          ].sort((first, second) => first.effective_from.localeCompare(second.effective_from));
          expect(versions, `${reader} lost the archived team's name`).toEqual([
            {
              team_id: team.id,
              position: defaultPositionIn(slug),
              effective_from: joined,
              teams: { name: team.name },
            },
            { team_id: null, position: null, effective_from: left, teams: null },
          ]);
        }
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'cancels the $fixture scheduled move over PostgREST exactly as the edit screen asks, and nothing in effect',
    async ({ slug, admin }) => {
      const client = await connect();
      try {
        const caller = await memberByUsername(client, slug, admin);
        const scheduled = await addThrowawayMember(client, caller.organizationId);
        const inEffect = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const later = await organizationDay(client, caller.organizationId, 5);
        const today = await organizationDay(client, caller.organizationId);

        for (const [row, from] of [
          [scheduled, later],
          [inEffect, today],
        ] as const) {
          await ownerMembership(client, {
            organization: caller.organizationId,
            member: row.id,
            team: team.id,
            from,
            by: caller.authUserId,
          });
        }

        const token = await tokenFor(admin, slug);
        const cancel = (memberId: string, from: string) =>
          rest(
            `team_membership_versions?member_id=eq.${memberId}&effective_from=eq.${from}&select=effective_from`,
            { token, method: 'DELETE', prefer: 'return=representation' },
          );

        const cancelled = await cancel(scheduled.id, later);
        expect(cancelled.status, `the cancellation failed: ${await cancelled.clone().text()}`).toBe(200);
        expect(await cancelled.json()).toEqual([{ effective_from: later }]);

        const kept = await cancel(inEffect.id, today);
        expect(kept.status).toBe(200);
        expect(await kept.json(), 'a version in effect was cancelled').toEqual([]);

        expect(await membershipsOf(client, scheduled.id)).toEqual([]);
        expect(await membershipsOf(client, inEffect.id)).toHaveLength(1);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture member-role token assigning or cancelling over PostgREST',
    async ({ slug, admin, member }) => {
      const client = await connect();
      try {
        const owner = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, owner.organizationId);
        const scheduled = await addThrowawayMember(client, owner.organizationId);
        const team = await addThrowawayTeam(client, owner.organizationId, owner.authUserId);
        const later = await organizationDay(client, owner.organizationId, 5);
        await ownerMembership(client, {
          organization: owner.organizationId,
          member: scheduled.id,
          team: team.id,
          from: later,
          by: owner.authUserId,
        });
        const token = await tokenFor(member, slug);

        const response = await rest('team_membership_versions', {
          token,
          method: 'POST',
          body: {
            organization_id: owner.organizationId,
            member_id: target.id,
            team_id: team.id,
            effective_from: await organizationDay(client, owner.organizationId),
          },
        });
        const refusal = await restRefusal(response);
        const cancel = await rest(
          `team_membership_versions?member_id=eq.${scheduled.id}&effective_from=eq.${later}&select=effective_from`,
          { token, method: 'DELETE', prefer: 'return=representation' },
        );

        expect(response.ok, 'a member-role account assigned a team').toBe(false);
        expect(refusal.code).toBe('42501');
        expect(await cancel.json(), 'a member-role account cancelled a move').toEqual([]);
        expect(await membershipsOf(client, target.id)).toEqual([]);
        expect(await membershipsOf(client, scheduled.id)).toHaveLength(1);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses the $fixture admin archiving a team in use over PostgREST as 42501, row unchanged',
    async ({ slug, admin }) => {
      // THE REFUSAL `features/teams/services/write.ts` MAPS TO `TEAM_IN_USE`: WITH CHECK failing
      // raises 42501 — unlike a USING miss, which matches no row silently.
      const client = await connect();
      try {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          from: await organizationDay(client, caller.organizationId),
          by: caller.authUserId,
        });
        const token = await tokenFor(admin, slug);

        const archived = await rest(`teams?id=eq.${team.id}&select=id`, {
          token,
          method: 'PATCH',
          body: { archived: true },
          prefer: 'return=representation',
        });
        const refusal = await restRefusal(archived);

        expect(archived.ok, 'a team in use was archived').toBe(false);
        expect(refusal.code).toBe('42501');
        expect((await teamById(client, team.id))?.archived).toBe(false);
      } finally {
        await client.end();
      }
    },
    20_000,
  );
});

// ------------------------------------------------------------ story 1.8: roster

interface RosterRow {
  readonly name: string;
  readonly archived: boolean;
  readonly members: readonly Record<string, unknown>[];
}

/** `team_roster`, as whoever the connection currently is. */
async function rosterOf(client: Client, team: string): Promise<RosterRow[]> {
  const { rows } = await client.query<RosterRow>(
    'select name, archived, members from public.team_roster($1)',
    [team],
  );
  return rows;
}

/** The ids a roster names, in the order the function returned them. */
function rosterIds(rows: readonly RosterRow[]): unknown[] {
  return (rows[0]?.members ?? []).map((entry) => entry['id']);
}

describe('a member sees who is on a team, and nothing more about a colleague', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'shows a $fixture member-role session its own member row only, and the admin every row',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const self = await memberByUsername(client, slug, member);
        const owner = await memberByUsername(client, slug, admin);
        const { rows: all } = await client.query<{ id: string }>(
          'select id from members where organization_id = $1 order by id',
          [self.organizationId],
        );

        await actAs(client, self.authUserId, self.organizationId);
        const { rows: seenByMember } = await client.query<{ id: string }>(
          'select * from members order by id',
        );
        await actAsOwner(client);
        await actAs(client, owner.authUserId, owner.organizationId);
        const { rows: seenByAdmin } = await client.query<{ id: string }>(
          'select id from members order by id',
        );
        await actAsOwner(client);

        expect(all.length, `${slug} has no colleagues to hide`).toBeGreaterThan(1);
        expect(seenByMember.map((row) => row.id), `${slug}: a member read a colleague`).toEqual([
          self.id,
        ]);
        expect(seenByAdmin.map((row) => row.id), `${slug}: the admin lost a row`).toEqual(
          all.map((row) => row.id),
        );
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'returns the $fixture team with today\'s active members as id and name, to member and admin alike',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const today = await organizationDay(client, organization);
        const tomorrow = await organizationDay(client, organization, 1);
        const earlier = await organizationDay(client, organization, -3);

        await actAs(client, owner.authUserId, organization);
        const team = await insertTeam(client, organization, `${THROWAWAY} roster`);
        await actAsOwner(client);

        const onToday = await addThrowawayMember(client, organization);
        const onEarlier = await addThrowawayMember(client, organization);
        const scheduled = await addThrowawayMember(client, organization);
        const inactive = await addThrowawayMember(client, organization);
        for (const [who, from] of [
          [onToday, today],
          [onEarlier, earlier],
          [scheduled, tomorrow],
          [inactive, earlier],
        ] as const) {
          await ownerMembership(client, {
            organization,
            member: who.id,
            team,
            from,
            by: owner.authUserId,
          });
        }
        await ownerVersion(client, {
          organization,
          member: inactive.id,
          active: false,
          from: today,
          by: owner.authUserId,
        });

        const expected = [onToday.id, onEarlier.id].sort();
        for (const reader of [self, owner]) {
          await actAs(client, reader.authUserId, organization);
          const rows = await rosterOf(client, team);
          await actAsOwner(client);

          expect(rows, `${slug}: the roster is not one row`).toHaveLength(1);
          expect(rows[0]?.name).toBe(`${THROWAWAY} roster`);
          expect(rows[0]?.archived).toBe(false);
          expect(
            rosterIds(rows),
            `${slug}: a scheduled joiner or an inactive member is on today's roster`,
          ).toEqual(expected);
          for (const entry of rows[0]?.members ?? []) {
            // MEMBER RANK: `0014` adds `fire_rank`, returned whatever the
            // setting says — the interface decides whether to show it.
            // TEAM POSITION: `0015` adds `position`, the one in effect today,
            // on the same terms.
            expect(
              Object.keys(entry).sort(),
              `${slug}: the roster names a field besides id, name, rank and position`,
            ).toEqual(['fire_rank', 'id', 'name', 'position']);
            expect(entry['name']).toBe(`${THROWAWAY} target`);
            expect(entry['fire_rank'], `${slug}: a throwaway member carries a rank`).toBeNull();
            expect(entry['position'], `${slug}: the roster lost today's position`).toBe(
              defaultPositionIn(slug),
            );
          }
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'returns an empty $fixture team and an archived one with a name and nobody on it',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;

        await actAs(client, owner.authUserId, organization);
        const empty = await insertTeam(client, organization, `${THROWAWAY} empty`);
        const archived = await insertTeam(client, organization, `${THROWAWAY} archived`);
        await archiveTeam(client, archived);
        await actAsOwner(client);

        await actAs(client, self.authUserId, organization);
        const emptyRows = await rosterOf(client, empty);
        const archivedRows = await rosterOf(client, archived);
        await actAsOwner(client);

        expect(emptyRows, `${slug}: an empty team`).toEqual([
          { name: `${THROWAWAY} empty`, archived: false, members: [] },
        ]);
        expect(archivedRows, `${slug}: an archived team`).toEqual([
          { name: `${THROWAWAY} archived`, archived: true, members: [] },
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'answers a $fixture caller zero rows for a $otherFixture team and for an id that never existed',
    async ({ slug, admin, member, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const foreignOwner = await memberByUsername(
          client,
          otherSlug,
          FIXTURES.find((entry) => entry.slug === otherSlug)?.admin ?? '',
        );
        const foreignTeam = await addThrowawayTeam(
          client,
          foreignOwner.organizationId,
          foreignOwner.authUserId,
        );
        const ownTeam = await addThrowawayTeam(client, owner.organizationId, owner.authUserId);
        const { rows: random } = await client.query<{ id: string }>(
          'select gen_random_uuid()::text as id',
        );
        const unknown = random[0]?.id ?? '';

        for (const reader of [self, owner]) {
          await actAs(client, reader.authUserId, reader.organizationId);
          expect(await rosterOf(client, foreignTeam.id), `${slug}: another tenant's team`).toEqual([]);
          expect(await rosterOf(client, unknown), `${slug}: an unknown id`).toEqual([]);
          expect(await rosterOf(client, ownTeam.id), `${slug}: its own team`).toHaveLength(1);
          await actAsOwner(client);

          // A claim naming the other organization pins neither: the fresh
          // helper still says the caller belongs to its own.
          await actAs(client, reader.authUserId, foreignOwner.organizationId);
          expect(
            await rosterOf(client, foreignTeam.id),
            `${slug}: a forged claim reached another tenant's team`,
          ).toEqual([]);
          expect(
            await rosterOf(client, ownTeam.id),
            `${slug}: a claim for another organization read its own team`,
          ).toEqual([]);
          await actAsOwner(client);
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'answers a $fixture caller inactive today zero rows',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const team = await addThrowawayTeam(client, organization, owner.authUserId);
        const caller = await addThrowawayMember(client, organization);
        await ownerMembership(client, {
          organization,
          member: caller.id,
          team: team.id,
          from: await organizationDay(client, organization, -1),
          by: owner.authUserId,
        });

        await actAs(client, caller.authUserId, organization);
        const whileActive = await rosterOf(client, team.id);
        await actAsOwner(client);
        await ownerVersion(client, {
          organization,
          member: caller.id,
          active: false,
          from: await organizationDay(client, organization),
          by: owner.authUserId,
        });
        await actAs(client, caller.authUserId, organization);
        const whileInactive = await rosterOf(client, team.id);
        await actAsOwner(client);

        expect(whileActive, `${slug}: the active caller read nothing`).toHaveLength(1);
        expect(whileInactive, `${slug}: an inactive caller read a roster`).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'reads the $fixture roster as at the organization today, never UTC\'s',
    async ({ slug, admin, member }) => {
      const ZONES = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'];
      let differed = 0;

      for (const zone of ZONES) {
        await inRolledBackTransaction(async (client) => {
          const owner = await memberByUsername(client, slug, admin);
          const self = await memberByUsername(client, slug, member);
          const organization = owner.organizationId;
          await client.query('update organizations set timezone = $1 where id = $2', [
            zone,
            organization,
          ]);
          const { rows } = await client.query<{ utc: string; local: string }>(
            `select (now() at time zone 'UTC')::date::text as utc,
                    public.organization_today($1)::text as local`,
            [organization],
          );
          const utc = rows[0]?.utc;
          const local = rows[0]?.local;
          if (utc === undefined || local === undefined) throw new Error('no dates');
          if (utc === local) return;
          differed += 1;

          const team = await addThrowawayTeam(client, organization, owner.authUserId);
          const fromLocal = await addThrowawayMember(client, organization);
          const fromUtc = await addThrowawayMember(client, organization);
          for (const [who, from] of [
            [fromLocal, local],
            [fromUtc, utc],
          ] as const) {
            await ownerMembership(client, {
              organization,
              member: who.id,
              team: team.id,
              from,
              by: owner.authUserId,
            });
          }

          await actAs(client, self.authUserId, organization);
          const read = await rosterOf(client, team.id);
          await actAsOwner(client);

          // Whoever joined on or before the ORGANIZATION's today is on it.
          const expected = [fromLocal, fromUtc]
            .filter((_, index) => (index === 0 ? local : utc) <= local)
            .map((who) => who.id)
            .sort();
          expect(rosterIds(read), `${zone}: the roster was dated by UTC`).toEqual(expected);
        });
      }

      expect(differed, 'no zone differed from UTC, so nothing was tested').toBeGreaterThan(0);
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'drops a $fixture member moved off the team or to no team today, and lists them where they moved',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const today = await organizationDay(client, organization);
        const earlier = await organizationDay(client, organization, -5);
        const from = await addThrowawayTeam(client, organization, owner.authUserId);
        const to = await addThrowawayTeam(client, organization, owner.authUserId);

        const stayer = await addThrowawayMember(client, organization);
        const mover = await addThrowawayMember(client, organization);
        const leaver = await addThrowawayMember(client, organization);
        for (const who of [stayer, mover, leaver]) {
          await ownerMembership(client, {
            organization,
            member: who.id,
            team: from.id,
            from: earlier,
            by: owner.authUserId,
          });
        }
        // Effective TODAY: the mover onto the other team, the leaver onto none.
        for (const [who, team] of [
          [mover, to.id],
          [leaver, null],
        ] as const) {
          await ownerMembership(client, {
            organization,
            member: who.id,
            team,
            from: today,
            by: owner.authUserId,
          });
        }

        await actAs(client, self.authUserId, organization);
        const fromRoster = await rosterOf(client, from.id);
        const toRoster = await rosterOf(client, to.id);
        await actAsOwner(client);

        expect(rosterIds(fromRoster), `${slug}: a member moved off today is still listed`).toEqual([
          stayer.id,
        ]);
        expect(rosterIds(toRoster), `${slug}: a member moved on today is not listed`).toEqual([
          mover.id,
        ]);
      });
    },
  );

  it.skipIf(noApi).each(FIXTURES)(
    'hands a $fixture member-role session its own row with the team embed Danas reads',
    async ({ slug, admin, member }) => {
      // STORY 1.8. Danas derives the caller's team from its own row, read with
      // `OWN_TEAM_COLUMNS`. Restated rather than imported: `@/features/teams/services/roster`
      // reaches `@/lib/i18n` through a path alias the root project cannot resolve.
      // `apps/web/src/features/teams/services/roster.test.ts` pins the constant to this literal.
      const OWN_TEAM_COLUMNS =
        'team_membership_versions(team_id,position,effective_from,teams(name)),organizations(timezone)';
      const client = await connect();
      try {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const team = await addThrowawayTeam(client, owner.organizationId, owner.authUserId);
        const today = await organizationDay(client, owner.organizationId);
        const { rows: zone } = await client.query<{ timezone: string }>(
          'select timezone from organizations where id = $1',
          [owner.organizationId],
        );

        const assigned = await rest('team_membership_versions', {
          token: await tokenFor(admin, slug),
          method: 'POST',
          body: {
            organization_id: owner.organizationId,
            member_id: self.id,
            team_id: team.id,
            // TEAM POSITION: a position while the setting is on, none while off.
            position: SEEDED_USES_FIRE_RANKS[slug] === true ? 'driver' : null,
            effective_from: today,
          },
        });
        expect(assigned.status, `the assignment was refused: ${await assigned.clone().text()}`).toBe(201);

        const rows = await restRows(
          `members?select=${OWN_TEAM_COLUMNS}&auth_user_id=eq.${self.authUserId}`,
          { token: await tokenFor(member, slug) },
        );

        expect(rows, `${slug}: the member did not read exactly its own row`).toHaveLength(1);
        expect(rows[0]?.['team_membership_versions']).toEqual([
          {
            team_id: team.id,
            position: SEEDED_USES_FIRE_RANKS[slug] === true ? 'driver' : null,
            effective_from: today,
            teams: { name: team.name },
          },
        ]);
        expect(rows[0]?.['organizations']).toEqual({ timezone: zone[0]?.timezone });
      } finally {
        // The fixture account goes back to no team, so no later case starts
        // from a membership it did not write.
        const self = await memberByUsername(client, slug, member);
        await client.query('delete from team_membership_versions where member_id = $1', [self.id]);
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'answers the $fixture roster over PostgREST to member and admin, and refuses an anonymous caller',
    async ({ slug, admin, member }) => {
      const client = await connect();
      try {
        const owner = await memberByUsername(client, slug, admin);
        const team = await addThrowawayTeam(client, owner.organizationId, owner.authUserId);
        const target = await addThrowawayMember(client, owner.organizationId);
        await ownerMembership(client, {
          organization: owner.organizationId,
          member: target.id,
          team: team.id,
          from: await organizationDay(client, owner.organizationId),
          by: owner.authUserId,
        });

        for (const reader of [member, admin]) {
          const response = await rest('rpc/team_roster', {
            token: await tokenFor(reader, slug),
            method: 'POST',
            body: { team: team.id },
          });
          expect(response.status, `${reader}: ${await response.clone().text()}`).toBe(200);
          expect(await response.json(), `${slug}/${reader} read a different roster`).toEqual([
            {
              name: team.name,
              archived: false,
              members: [
                {
                  id: target.id,
                  name: `${THROWAWAY} target`,
                  fire_rank: null,
                  position: defaultPositionIn(slug),
                },
              ],
            },
          ]);
        }

        const anonymous = await rest('rpc/team_roster', {
          method: 'POST',
          body: { team: team.id },
        });
        // THE GRANT refusing, not a policy: `anon` holds no EXECUTE on the
        // function, so PostgREST answers 401 with Postgres's privilege code.
        expect(anonymous.status, 'an anonymous caller reached the roster').toBe(401);
        const refusal = await restRefusal(anonymous);
        expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
        expect(refusal.message).toBe('permission denied for function team_roster');
      } finally {
        await client.end();
      }
    },
    20_000,
  );
});

// --------------------------------------------- story 3.4a: calendar members

interface CalendarMemberRow {
  readonly id: string;
  readonly name: string;
  readonly fire_rank: string | null;
}

/** `calendar_members()`, as whoever the connection currently is: every column it returns. */
async function calendarMembersOf(client: Client): Promise<Record<string, unknown>[]> {
  const { rows } = await client.query<Record<string, unknown>>('select * from public.calendar_members()');
  return rows;
}

/** Every member of `organization`, active or not, read as the owner, ids sorted. */
async function allMemberIds(client: Client, organization: string): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `select m.id::text as id
       from members m
      where m.organization_id = $1
      order by m.id`,
    [organization],
  );
  return rows.map((row) => row.id);
}

function memberIdsOf(rows: readonly Record<string, unknown>[]): unknown[] {
  return rows.map((row) => row['id']).sort();
}

describe('the calendar names every colleague, active or not, as id, name and rank only', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'returns every $fixture member to member and admin alike, a deactivated colleague and a rank included',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const colleague = await addThrowawayMember(client, organization);
        const deactivated = await addThrowawayMember(client, organization);
        await client.query(`update members set fire_rank = 'nco' where id = $1`, [colleague.id]);
        await client.query(`update members set fire_rank = 'senior_officer' where id = $1`, [deactivated.id]);
        await ownerVersion(client, {
          organization,
          member: deactivated.id,
          active: false,
          from: await organizationDay(client, organization),
          by: owner.authUserId,
        });

        const expected = await allMemberIds(client, organization);
        const { rows: status } = await client.query<{ active: boolean }>(
          'select public.member_active_on($1, public.organization_today($2)) as active',
          [deactivated.id, organization],
        );

        expect(status[0]?.active, `${slug}: the deactivation did not take`).toBe(false);
        expect(expected).toEqual(expect.arrayContaining([self.id, owner.id, colleague.id, deactivated.id]));

        for (const reader of [self, owner]) {
          await actAs(client, reader.authUserId, organization);
          const rows = await calendarMembersOf(client);
          await actAsOwner(client);

          expect(memberIdsOf(rows), `${slug}: the members are not every member`).toEqual(expected);
          for (const row of rows) {
            expect(Object.keys(row).sort(), `${slug}: a field besides id, name and fire_rank`).toEqual([
              'fire_rank',
              'id',
              'name',
            ]);
            expect(typeof row['name']).toBe('string');
          }
          const named = rows as unknown as CalendarMemberRow[];

          expect(named.find((row) => row.id === colleague.id)).toEqual({
            id: colleague.id,
            name: `${THROWAWAY} target`,
            fire_rank: 'nco',
          });
          // The newly disclosed history (FR-12): a colleague inactive today,
          // named and ranked.
          expect(named.find((row) => row.id === deactivated.id), `${slug}: the deactivated colleague`).toEqual({
            id: deactivated.id,
            name: `${THROWAWAY} target`,
            fire_rank: 'senior_officer',
          });
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'answers a $fixture caller inactive today zero rows',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const caller = await addThrowawayMember(client, organization);

        await actAs(client, caller.authUserId, organization);
        const whileActive = await calendarMembersOf(client);
        await actAsOwner(client);
        await ownerVersion(client, {
          organization,
          member: caller.id,
          active: false,
          from: await organizationDay(client, organization),
          by: owner.authUserId,
        });
        await actAs(client, caller.authUserId, organization);
        const whileInactive = await calendarMembersOf(client);
        await actAsOwner(client);

        expect(memberIdsOf(whileActive), `${slug}: the active caller is not among the members`).toContain(caller.id);
        expect(whileInactive, `${slug}: an inactive caller read the members`).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'answers a $fixture caller nothing of $otherFixture, and nothing under a forged claim',
    async ({ slug, admin, member, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const foreignOwner = await memberByUsername(
          client,
          otherSlug,
          FIXTURES.find((entry) => entry.slug === otherSlug)?.admin ?? '',
        );
        const foreign = await allMemberIds(client, foreignOwner.organizationId);

        expect(foreign.length, `${otherSlug} has nobody to leak`).toBeGreaterThan(0);

        for (const reader of [self, owner]) {
          await actAs(client, reader.authUserId, reader.organizationId);
          const own = await calendarMembersOf(client);
          await actAsOwner(client);

          expect(own.length, `${slug}: its own members`).toBeGreaterThan(0);
          for (const id of memberIdsOf(own)) {
            expect(foreign, `${slug}: another tenant's member`).not.toContain(id);
          }

          // A claim naming the other organization pins neither: the fresh
          // helper still says the caller belongs to its own.
          await actAs(client, reader.authUserId, foreignOwner.organizationId);
          expect(await calendarMembersOf(client), `${slug}: a forged claim read members`).toEqual([]);
          await actAsOwner(client);
          await actAs(client, reader.authUserId, null);
          expect(await calendarMembersOf(client), `${slug}: no claim read members`).toEqual([]);
          await actAsOwner(client);
        }
      });
    },
  );

  it.skipIf(noDatabase)('no longer declares 3.3b\'s calendar_people', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query(
        `select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'calendar_people'`,
      );
      expect(rows, 'calendar_people survived 0018').toEqual([]);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noApi).each(FIXTURES)(
    'answers the $fixture members over PostgREST to member and admin, and refuses an anonymous caller',
    async ({ slug, admin, member }) => {
      const client = await connect();
      try {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        // COMMITTED data other suites may add to while this runs, so the
        // answer is held to the organization's members rather than to an
        // exact list; the exact list is the rolled-back case above.
        const { rows: all } = await client.query<{ id: string }>(
          'select id::text as id from members where organization_id = $1',
          [owner.organizationId],
        );
        const own = all.map((row) => row.id);

        for (const reader of [member, admin]) {
          const response = await rest('rpc/calendar_members', {
            token: await tokenFor(reader, slug),
            method: 'POST',
            body: {},
          });
          expect(response.status, `${reader}: ${await response.clone().text()}`).toBe(200);
          const rows = (await response.json()) as Record<string, unknown>[];

          expect(memberIdsOf(rows), `${slug}/${reader} lost the fixture accounts`).toEqual(
            expect.arrayContaining([self.id, owner.id]),
          );
          for (const id of memberIdsOf(rows)) {
            expect(own, `${slug}/${reader}: a member of another organization`).toContain(id);
          }
          for (const row of rows) {
            // No email, username, role, allowance or position.
            expect(Object.keys(row).sort(), `${slug}/${reader}: a field besides id, name and fire_rank`).toEqual([
              'fire_rank',
              'id',
              'name',
            ]);
          }
        }

        const anonymous = await rest('rpc/calendar_members', { method: 'POST', body: {} });
        // THE GRANT refusing, not a policy: `anon` holds no EXECUTE on the
        // function, so PostgREST answers 401 with Postgres's privilege code.
        expect(anonymous.status, 'an anonymous caller reached the members').toBe(401);
        const refusal = await restRefusal(anonymous);
        expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
        expect(refusal.message).toBe('permission denied for function calendar_members');
      } finally {
        await client.end();
      }
    },
    20_000,
  );
});

// ------------------------------------------------------------ member rank

/**
 * MEMBER RANK (`0014`). An organization setting that gates display and entry,
 * a fixed list of rank codes on `members`, and `team_roster` carrying the rank.
 * The SQL cases run in rolled-back transactions; the REST cases write only a
 * throwaway member or restore the setting they touch in `finally`, and
 * `afterAll` is the backstop.
 */

/** The two fixtures, read off `FIXTURES` rather than restated. */
const [PILOT, SECOND_FIXTURE] = FIXTURES;

/** The seeded setting per fixture: the pilot records ranks, UJ-5 does not. */
const SEEDED_USES_FIRE_RANKS: Readonly<Record<string, boolean>> = {
  [PILOT.slug]: true,
  [SECOND_FIXTURE.slug]: false,
};

/** The seeded pilot ranks, by username; Petra, not a named fixture role, is
 *  the null case. */
const SEEDED_PILOT_RANKS: Readonly<Record<string, string | null>> = {
  [PILOT.admin]: 'officer',
  [PILOT.member]: 'nco',
  [PILOT.bystander]: 'firefighter',
  'petra.babic': null,
};

/** The rank a seeded member of `slug` carries: the pilot's table, else none. */
function seededRankOf(slug: string, username: string): string | null {
  return slug === PILOT.slug ? (SEEDED_PILOT_RANKS[username] ?? null) : null;
}

async function usesFireRanks(client: Client, organization: string): Promise<boolean | undefined> {
  const { rows } = await client.query<{ uses: boolean }>(
    'select uses_fire_ranks as uses from organizations where id = $1',
    [organization],
  );
  return rows[0]?.uses;
}

async function fireRankOf(client: Client, member: string): Promise<string | null | undefined> {
  const { rows } = await client.query<{ rank: string | null }>(
    'select fire_rank as rank from members where id = $1',
    [member],
  );
  return rows[0]?.rank;
}

describe('a member carries a rank from a fixed list, behind a setting an admin owns', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'seeds the $fixture setting and ranks the fixtures describe',
    async ({ slug }) => {
      await inRolledBackTransaction(async (client) => {
        const organization = await organizationId(client, slug);

        expect(await usesFireRanks(client, organization)).toBe(SEEDED_USES_FIRE_RANKS[slug]);

        const { rows } = await client.query<{ username: string; rank: string | null }>(
          'select username, fire_rank as rank from members where organization_id = $1',
          [organization],
        );

        expect(rows.length, `${slug} has no members`).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.rank, `${slug}/${row.username}`).toBe(seededRankOf(slug, row.username));
        }
      });
    },
  );

  it.skipIf(noDatabase)('returns the seeded pilot ranks on the roster, and null for none', async () => {
    // The acceptance criterion: each roster entry carries `id`, `name` and
    // `fire_rank` with the seeded values.
    await inRolledBackTransaction(async (client) => {
      const slug = PILOT.slug;
      const owner = await memberByUsername(client, slug, PILOT.admin);
      const organization = owner.organizationId;
      const team = await addThrowawayTeam(client, organization, owner.authUserId);
      const today = await organizationDay(client, organization);
      const seeded = await Promise.all(
        Object.keys(SEEDED_PILOT_RANKS).map((username) => memberByUsername(client, slug, username)),
      );
      for (const who of seeded) {
        await ownerMembership(client, {
          organization,
          member: who.id,
          team: team.id,
          from: today,
          by: owner.authUserId,
        });
      }

      const reader = await memberByUsername(client, slug, PILOT.member);
      await actAs(client, reader.authUserId, organization);
      const rows = await rosterOf(client, team.id);
      await actAsOwner(client);

      const byId = new Map((rows[0]?.members ?? []).map((entry) => [entry['id'], entry]));

      expect(byId.size, 'the roster does not carry the four seeded members').toBe(4);
      for (const [index, [username, rank]] of Object.entries(SEEDED_PILOT_RANKS).entries()) {
        const entry = byId.get(seeded[index]?.id);

        expect(Object.keys(entry ?? {}).sort()).toEqual(['fire_rank', 'id', 'name', 'position']);
        expect(entry?.['fire_rank'], `${username} on the roster`).toBe(rank);
      }
    });
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    'lets the $fixture admin set, clear and never mis-set a member rank',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, owner.organizationId);

        await actAs(client, owner.authUserId, owner.organizationId);
        const set = await client.query('update members set fire_rank = $1 where id = $2', [
          'nco',
          target.id,
        ]);
        const refusal = await refusedThenContinue(client, () =>
          client.query('update members set fire_rank = $1 where id = $2', ['general', target.id]),
        );
        await actAsOwner(client);

        expect(set.rowCount, `the ${slug} admin could not set a rank`).toBe(1);
        expect(refusal.code, 'a rank outside the list is not a check violation').toBe('23514');
        expect(refusal.message).toContain('members_fire_rank_check');
        expect(await fireRankOf(client, target.id), 'the refused rank was written').toBe('nco');

        await actAs(client, owner.authUserId, owner.organizationId);
        const cleared = await client.query('update members set fire_rank = null where id = $1', [
          target.id,
        ]);
        await actAsOwner(client);

        expect(cleared.rowCount).toBe(1);
        expect(await fireRankOf(client, target.id), 'no rank is not null').toBeNull();
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role session a rank, by the database',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const target = await addThrowawayMember(client, owner.organizationId);

        await actAs(client, self.authUserId, self.organizationId);
        const other = await client.query('update members set fire_rank = $1 where id = $2', [
          'officer',
          target.id,
        ]);
        const own = await client.query('update members set fire_rank = $1 where id = $2', [
          'senior_officer_1',
          self.id,
        ]);
        await actAsOwner(client);

        expect(other.rowCount, `a ${slug} member-role session ranked a colleague`).toBe(0);
        expect(own.rowCount, `a ${slug} member-role session ranked itself`).toBe(0);
        expect(await fireRankOf(client, target.id)).toBeNull();
        expect(await fireRankOf(client, self.id)).toBe(seededRankOf(slug, member));
      });
    },
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses the $fixture admin a rank outside the list over PostgREST, writing nothing',
    async ({ slug, admin }) => {
      const client = await connect();
      let target: MemberRow | undefined;
      try {
        const owner = await memberByUsername(client, slug, admin);
        target = await addThrowawayMember(client, owner.organizationId);

        const response = await rest(`members?id=eq.${target.id}`, {
          token: await tokenFor(admin, slug),
          method: 'PATCH',
          body: { fire_rank: 'general' },
        });

        expect(response.ok, 'a rank outside the list was accepted').toBe(false);
        const refusal = await restRefusal(response);
        expect(refusal.code).toBe('23514');
        expect(await fireRankOf(client, target.id), 'the refused rank was written').toBeNull();
      } finally {
        // The throwaway was committed, so it is removed here; the member row
        // cascades from its account. `afterAll` is the backstop.
        if (target !== undefined) {
          await client.query('delete from auth.users where id = $1', [target.authUserId]);
        }
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'lets the $fixture admin switch the setting, and refuses the member-role session',
    async ({ slug, admin, member }) => {
      const client = await connect();
      const own = await organizationId(client, slug);
      const seeded = SEEDED_USES_FIRE_RANKS[slug];
      try {
        expect(
          await usesFireRanks(client, own),
          `${slug} does not hold its seeded setting — a previous run did not restore it; run \`supabase db reset\``,
        ).toBe(seeded);

        const refused = await rest(`organizations?id=eq.${own}`, {
          token: await tokenFor(member, slug),
          method: 'PATCH',
          body: { uses_fire_ranks: !seeded },
        });

        expect(refused.status, 'a refused update affects zero rows and raises nothing').toBe(204);
        expect(await usesFireRanks(client, own), `a ${slug} member-role session switched it`).toBe(
          seeded,
        );

        const switched = await rest(`organizations?id=eq.${own}`, {
          token: await tokenFor(admin, slug),
          method: 'PATCH',
          body: { uses_fire_ranks: !seeded },
        });

        expect(switched.status).toBe(204);
        expect(await usesFireRanks(client, own), `the ${slug} admin could not switch it`).toBe(
          !seeded,
        );
        // SWITCHING IT DELETES NOTHING: every stored rank survives.
        const { rows } = await client.query<{ ranked: number }>(
          'select count(*)::int as ranked from members where organization_id = $1 and fire_rank is not null',
          [own],
        );
        expect(rows[0]?.ranked).toBe(
          slug === PILOT.slug
            ? Object.values(SEEDED_PILOT_RANKS).filter((rank) => rank !== null).length
            : 0,
        );
      } finally {
        await client.query('update organizations set uses_fire_ranks = $1 where id = $2', [
          seeded,
          own,
        ]);
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noDatabase)('admits exactly the eleven codes, asked of the constraint itself', () => {
    return inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ definition: string }>(
        `select pg_get_constraintdef(c.oid) as definition
           from pg_constraint c
           join pg_class t on t.oid = c.conrelid
           join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'public'
            and t.relname = 'members'
            and c.conname = 'members_fire_rank_check'`,
      );
      const definition = rows[0]?.definition ?? '';

      expect(definition, 'no check constraint on members.fire_rank').not.toBe('');
      expect([...definition.matchAll(/'([a-z0-9_]+)'/g)].map((found) => found[1])).toEqual([
        'trainee',
        'firefighter',
        'firefighter_1',
        'nco',
        'nco_1',
        'senior_nco',
        'senior_nco_1',
        'officer',
        'officer_1',
        'senior_officer',
        'senior_officer_1',
      ]);
    });
  });
});

// ---------------------------------------------------------- team position

/**
 * TEAM POSITION, part B of "rank and team position". `0015_team_position.sql`
 * is the whole enforcement: `team_membership_versions.position` under a check
 * of three codes and "no team, no position", `member_team_version_on` as the
 * one reading of team and position at a date, `0010`'s insert policy ALTERED
 * so a version changes the team OR the position and carries a position while
 * the organization uses fire ranks and positions, and `team_roster` returning
 * today's position. Every SQL case runs in a rolled-back transaction and sets
 * the setting it is about explicitly, so both fixtures prove both states; the
 * REST case commits on a throwaway member and team, and restores nothing it
 * did not write.
 */

/** Switch the setting inside the case's own transaction, as the owner. */
async function setUsesFireRanks(client: Client, organization: string, uses: boolean): Promise<void> {
  await client.query('update organizations set uses_fire_ranks = $1 where id = $2', [
    uses,
    organization,
  ]);
}

/** `member_team_version_on`, as whoever the connection is: no row is none. */
async function teamVersionOn(
  client: Client,
  member: string,
  day: string,
): Promise<{ team_id: string | null; position: string | null } | null> {
  const { rows } = await client.query<{ team_id: string | null; position: string | null }>(
    'select team_id, position from public.member_team_version_on($1, $2::date)',
    [member, day],
  );
  expect(rows.length, 'the reader returned more than one version').toBeLessThanOrEqual(1);
  return rows[0] ?? null;
}

/** The position one member carries on a roster, or `undefined` when absent. */
function rosterPositionOf(rows: readonly RosterRow[], member: string): unknown {
  return (rows[0]?.members ?? []).find((entry) => entry['id'] === member)?.['position'];
}

describe('a member holds a position in their team from a date, under the membership rules', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'moves a $fixture member into a team as driver with the setting on, and the roster says so',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const reader = await memberByUsername(client, slug, member);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const today = await organizationDay(client, caller.organizationId);
        await setUsesFireRanks(client, caller.organizationId, true);

        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await insertMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          position: 'driver',
          from: today,
        });
        await actAsOwner(client);

        expect(written.rowCount, `the ${slug} admin could not move a member in as driver`).toBe(1);
        expect(await membershipsOf(client, target.id)).toMatchObject([
          { teamId: team.id, position: 'driver', from: today },
        ]);
        expect(await teamVersionOn(client, target.id, today)).toEqual({
          team_id: team.id,
          position: 'driver',
        });

        // The ROSTER, as the member role and as the admin: today's position.
        for (const who of [reader, caller]) {
          await actAs(client, who.authUserId, who.organizationId);
          const rows = await rosterOf(client, team.id);
          await actAsOwner(client);
          expect(rosterPositionOf(rows, target.id), `${slug}: the roster lost the position`).toBe(
            'driver',
          );
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'schedules a $fixture position-only change, and the roster shows the old position until its date',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const joined = await organizationDay(client, caller.organizationId, -3);
        const today = await organizationDay(client, caller.organizationId);
        const promoted = await organizationDay(client, caller.organizationId, 7);
        await setUsesFireRanks(client, caller.organizationId, true);
        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          position: 'driver',
          from: joined,
          by: caller.authUserId,
        });
        const before = await membershipsOf(client, target.id);

        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await insertMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          position: 'commander',
          from: promoted,
        });
        const rows = await rosterOf(client, team.id);
        await actAsOwner(client);

        expect(written.rowCount, 'a position-only change was refused').toBe(1);
        const after = await membershipsOf(client, target.id);
        expect(after).toHaveLength(2);
        expect(after[0], 'the earlier row changed').toEqual(before[0]);
        expect(after[1]).toMatchObject({ teamId: team.id, position: 'commander', from: promoted });
        // SAME TEAM throughout; the position changes on its date.
        expect(await teamOn(client, target.id, promoted)).toBe(team.id);
        expect((await teamVersionOn(client, target.id, today))?.position).toBe('driver');
        expect((await teamVersionOn(client, target.id, promoted))?.position).toBe('commander');
        expect(rosterPositionOf(rows, target.id), 'the roster read the scheduled position').toBe(
          'driver',
        );
        // And it is WITHDRAWN exactly like a move.
        await actAs(client, caller.authUserId, caller.organizationId);
        const cancelled = await cancelMembership(client, { member: target.id, from: promoted });
        await actAsOwner(client);
        expect(cancelled.rowCount, 'the scheduled position change could not be cancelled').toBe(1);
        expect(await membershipsOf(client, target.id)).toEqual(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture version that changes neither the team nor the position',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const joined = await organizationDay(client, caller.organizationId, -3);
        const today = await organizationDay(client, caller.organizationId);
        await setUsesFireRanks(client, caller.organizationId, true);
        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          position: 'driver',
          from: joined,
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: team.id,
            position: 'driver',
            from: today,
          }),
        );
        await actAsOwner(client);

        expect(refusal.code, 'an unchanged team and position was admitted').toBe('42501');
        expect(await membershipsOf(client, target.id)).toHaveLength(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture team with no position while the setting is on, and admits it while off',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const today = await organizationDay(client, caller.organizationId);
        const version = {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          position: null,
          from: today,
        };

        await setUsesFireRanks(client, caller.organizationId, true);
        await actAs(client, caller.authUserId, caller.organizationId);
        const refusal = await refusedThenContinue(client, () => insertMembership(client, version));
        await actAsOwner(client);

        expect(refusal.code, 'a team was joined with no position while the setting is on').toBe(
          '42501',
        );
        expect(await membershipsOf(client, target.id)).toEqual([]);

        // THE SETTING OFF: the client sends null, and it is admitted.
        await setUsesFireRanks(client, caller.organizationId, false);
        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await insertMembership(client, version);
        await actAsOwner(client);

        expect(written.rowCount, 'a null position was refused with the setting off').toBe(1);
        expect(await membershipsOf(client, target.id)).toMatchObject([
          { teamId: team.id, position: null },
        ]);
        await actAs(client, caller.authUserId, caller.organizationId);
        const rows = await rosterOf(client, team.id);
        await actAsOwner(client);
        expect(rosterPositionOf(rows, target.id), 'the roster invented a position').toBeNull();
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture position on "no team", and a code outside the list, in the table itself',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const joined = await organizationDay(client, caller.organizationId, -3);
        const today = await organizationDay(client, caller.organizationId);
        await setUsesFireRanks(client, caller.organizationId, true);
        // A version to follow, so "no team" passes every policy conjunct and
        // only the table's own check is left to refuse it.
        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          position: 'driver',
          from: joined,
          by: caller.authUserId,
        });

        await actAs(client, caller.authUserId, caller.organizationId);
        const noTeam = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: null,
            position: 'driver',
            from: today,
          }),
        );
        const unknown = await refusedThenContinue(client, () =>
          insertMembership(client, {
            organization: caller.organizationId,
            member: target.id,
            team: team.id,
            position: 'chief',
            from: today,
          }),
        );
        await actAsOwner(client);

        expect(noTeam.code, 'a position was stored on "no team"').toBe('23514');
        expect(noTeam.message).toContain('team_membership_versions_position_needs_team');
        expect(unknown.code, 'a code outside the list was stored').toBe('23514');
        expect(unknown.message).toContain('team_membership_versions_position_code_check');
        expect(await membershipsOf(client, target.id)).toHaveLength(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses every $fixture member-role insert, with or without a position',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const team = await addThrowawayTeam(client, owner.organizationId, owner.authUserId);
        const today = await organizationDay(client, owner.organizationId);

        for (const uses of [true, false]) {
          await setUsesFireRanks(client, owner.organizationId, uses);
          for (const position of ['commander', null]) {
            await actAs(client, self.authUserId, self.organizationId);
            const refusal = await refusedThenContinue(client, () =>
              insertMembership(client, {
                organization: self.organizationId,
                member: self.id,
                team: team.id,
                position,
                from: today,
              }),
            );
            await actAsOwner(client);
            expect(refusal.code, `a ${slug} member-role session wrote a membership`).toBe('42501');
          }
        }
        expect(await membershipsOf(client, self.id)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'offers a $fixture legacy version with no position a change to a position, once the setting is on',
    async ({ slug, admin }) => {
      // A version written while the setting was off keeps its null position;
      // switching the setting on rewrites nothing, and giving that member a
      // position in the same team IS a change.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const joined = await organizationDay(client, caller.organizationId, -3);
        const today = await organizationDay(client, caller.organizationId);
        await setUsesFireRanks(client, caller.organizationId, false);
        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          position: null,
          from: joined,
          by: caller.authUserId,
        });
        await setUsesFireRanks(client, caller.organizationId, true);

        expect(await membershipsOf(client, target.id), 'switching the setting rewrote a row').toMatchObject([
          { teamId: team.id, position: null },
        ]);
        await actAs(client, caller.authUserId, caller.organizationId);
        expect(
          rosterPositionOf(await rosterOf(client, team.id), target.id),
          'the roster invented a legacy position',
        ).toBeNull();
        const written = await insertMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          position: 'firefighter',
          from: today,
        });
        await actAsOwner(client);

        expect(written.rowCount, 'a legacy member could not be given a position').toBe(1);
        expect(await teamVersionOn(client, target.id, today)).toEqual({
          team_id: team.id,
          position: 'firefighter',
        });
      });
    },
  );

  it.skipIf(noDatabase)('reads no version for a member with none, and the latest one at infinity', () => {
    return inRolledBackTransaction(async (client) => {
      const caller = await memberByUsername(client, PILOT.slug, PILOT.admin);
      const target = await addThrowawayMember(client, caller.organizationId);
      const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
      const joined = await organizationDay(client, caller.organizationId, -3);
      const later = await organizationDay(client, caller.organizationId, 4);

      expect(await teamVersionOn(client, target.id, 'infinity')).toBeNull();
      for (const [position, from] of [
        ['driver', joined],
        ['commander', later],
      ] as const) {
        await ownerMembership(client, {
          organization: caller.organizationId,
          member: target.id,
          team: team.id,
          position,
          from,
          by: caller.authUserId,
        });
      }
      expect(await teamVersionOn(client, target.id, 'infinity')).toEqual({
        team_id: team.id,
        position: 'commander',
      });
      expect(await teamVersionOn(client, target.id, await organizationDay(client, caller.organizationId, -4))).toBeNull();
    });
  });

  it.skipIf(noDatabase)('runs the position rule fail-closed, as the database holds it', () => {
    // FAIL CLOSED (`0015`): a null position is admitted only on a VISIBLE
    // organization row that says the setting is off — never on the absence of
    // a row that says it is on. The on and off behaviour is proven by the
    // cases above; an invisible row cannot be staged on its own, because
    // `organization_today` reads the same row and refuses first. So the policy
    // the database RUNS is read here, from the catalogue rather than the file.
    return inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ check: string }>(
        `select with_check as check from pg_policies
          where schemaname = 'public'
            and tablename = 'team_membership_versions'
            and policyname = 'team_membership_versions_insert_by_own_active_admin'`,
      );
      const check = (rows[0]?.check ?? '').replace(/\s+/g, ' ');

      expect(check, 'no insert policy on team_membership_versions').not.toBe('');
      expect(check).toMatch(
        /\(team_id IS NULL\) OR \("position" IS NOT NULL\) OR \(EXISTS \( SELECT 1 FROM organizations organization WHERE \(\(organization\.id = team_membership_versions\.organization_id\) AND \(NOT organization\.uses_fire_ranks\)\)\)\)/,
      );
      expect(check, 'the position rule fails open').not.toMatch(
        /NOT \(EXISTS \( SELECT 1 FROM organizations/,
      );
    });
  });

  it.skipIf(noDatabase)('admits exactly the three codes, asked of the constraint itself', () => {
    return inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ definition: string }>(
        `select pg_get_constraintdef(c.oid) as definition
           from pg_constraint c
           join pg_class t on t.oid = c.conrelid
           join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'public'
            and t.relname = 'team_membership_versions'
            and c.conname = 'team_membership_versions_position_code_check'`,
      );
      const definition = rows[0]?.definition ?? '';

      expect(definition, 'no check constraint on team_membership_versions.position').not.toBe('');
      expect([...definition.matchAll(/'([a-z0-9_]+)'/g)].map((found) => found[1])).toEqual([
        'commander',
        'driver',
        'firefighter',
      ]);
    });
  });

  it.skipIf(noApi)(
    'moves a pilot member in over PostgREST as the edit screen sends it, then refuses an unchanged repeat',
    async () => {
      const client = await connect();
      try {
        const caller = await memberByUsername(client, PILOT.slug, PILOT.admin);
        const target = await addThrowawayMember(client, caller.organizationId);
        const team = await addThrowawayTeam(client, caller.organizationId, caller.authUserId);
        const today = await organizationDay(client, caller.organizationId);
        const later = await organizationDay(client, caller.organizationId, 3);
        const token = await tokenFor(PILOT.admin, PILOT.slug);
        const body = (position: string | null, from: string) => ({
          organization_id: caller.organizationId,
          member_id: target.id,
          team_id: team.id,
          position,
          effective_from: from,
        });

        expect(SEEDED_USES_FIRE_RANKS[PILOT.slug], 'the pilot does not use positions').toBe(true);
        const moved = await rest('team_membership_versions', {
          token,
          method: 'POST',
          body: body('driver', today),
        });
        expect(moved.status, await moved.clone().text()).toBe(201);

        const unchanged = await rest('team_membership_versions', {
          token,
          method: 'POST',
          body: body('driver', later),
        });
        expect(unchanged.status, 'an unchanged team and position was admitted').toBe(403);
        expect((await restRefusal(unchanged)).code).toBe('42501');

        const none = await rest('team_membership_versions', {
          token,
          method: 'POST',
          body: body(null, later),
        });
        expect(none.status, 'a team with no position was admitted').toBe(403);

        const unknown = await rest('team_membership_versions', {
          token,
          method: 'POST',
          body: body('chief', later),
        });
        expect(unknown.status, 'a code outside the list was admitted').toBe(400);
        expect((await restRefusal(unknown)).code).toBe('23514');

        const promoted = await rest('team_membership_versions', {
          token,
          method: 'POST',
          body: body('commander', later),
        });
        expect(promoted.status, await promoted.clone().text()).toBe(201);
        expect(await membershipsOf(client, target.id)).toMatchObject([
          { teamId: team.id, position: 'driver', from: today },
          { teamId: team.id, position: 'commander', from: later },
        ]);
      } finally {
        await client.end();
      }
    },
    20_000,
  );
});

// ------------------------------------------------------------ story 2.1a: bands

/**
 * STORY 2.1a. An organization's hour bands are a name and a start time, and
 * `0012_hour_bands.sql` is the whole enforcement: two checks, two uniques,
 * four policies and the column grants. The window, duration and midnight flag
 * are `packages/domain`'s, and are asserted there.
 *
 * Every SQL case below runs in a rolled-back transaction. The REST cases
 * commit, at start times neither fixture seeds (none on 05, 07, 13, 19 or 21),
 * under the throwaway prefix, and delete their own rows in `finally`;
 * `afterAll` is the backstop.
 */
interface HourBandRow {
  readonly organizationId: string;
  readonly id: string;
  readonly name: string;
  readonly startTime: string;
}

/** A domain start minute as PostgreSQL prints a `time`: `HH:MM:SS`. */
function asTime(startMinute: number): string {
  const hours = String(Math.floor(startMinute / 60)).padStart(2, '0');
  const minutes = String(startMinute % 60).padStart(2, '0');
  return `${hours}:${minutes}:00`;
}

/**
 * What `supabase/seed.sql` gives each fixture, in start order (Q10).
 *
 * DERIVED FROM THE DOMAIN FIXTURES, not written out a second time: the arrays
 * `packages/domain` asserts its band rule against are the one source of truth,
 * and every case below that reads the seed compares it with them. A seed that
 * drifts from the domain's fixtures — or the other way round — fails here.
 */
const SEEDED_HOUR_BANDS: Readonly<Record<string, readonly { name: string; startTime: string }[]>> =
  Object.fromEntries(
    (
      [
        ['dvd-kastel-novi', PILOT_HOUR_BANDS],
        ['zastita-split', UJ5_HOUR_BANDS],
      ] as const
    ).map(([slug, bands]) => [
      slug,
      [...bands]
        .sort((a, b) => a.startMinute - b.startMinute)
        .map((band) => ({ name: band.name, startTime: asTime(band.startMinute) })),
    ]),
  );

function seededBandsOf(slug: string): readonly { name: string; startTime: string }[] {
  const seeded = SEEDED_HOUR_BANDS[slug];
  if (seeded === undefined) throw new Error(`no seeded hour bands are recorded for ${slug}`);
  return seeded;
}

/** One band re-read as the owner, so RLS hides nothing. */
async function hourBandById(client: Client, id: string): Promise<HourBandRow | undefined> {
  const { rows } = await client.query<HourBandRow>(
    `select organization_id as "organizationId", id, name, start_time::text as "startTime"
       from hour_bands where id = $1`,
    [id],
  );
  return rows[0];
}

/** The bands the current session can see in one organization, in start order. */
async function visibleHourBands(
  client: Client,
  organization: string,
): Promise<readonly { name: string; startTime: string }[]> {
  const { rows } = await client.query<{ name: string; startTime: string }>(
    `select name, start_time::text as "startTime"
       from hour_bands where organization_id = $1 order by start_time`,
    [organization],
  );
  return rows;
}

/** Insert one band as the current session, returning its id. */
async function insertHourBand(
  client: Client,
  organization: string,
  name: string,
  startTime: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'insert into hour_bands (organization_id, name, start_time) values ($1, $2, $3) returning id',
    [organization, name, startTime],
  );
  const band = rows[0];
  if (band === undefined) throw new Error('hour_bands insert returned no row');
  return band.id;
}

describe('each organization holds exactly its own seeded hour bands', () => {
  it('converts a domain start minute to the time PostgreSQL prints', () => {
    // The conversion every seeded-band comparison goes through; a wrong one
    // would compare both sides through the same mistake.
    expect([0, 7 * 60, 19 * 60 + 5, 1439].map(asTime)).toEqual([
      '00:00:00',
      '07:00:00',
      '19:05:00',
      '23:59:00',
    ]);
  });

  it('records the bands both fixtures are seeded with', () => {
    // A guard on the table below: with a fixture missing from it, the cases
    // that read it would throw rather than assert, and with an entry for a
    // fixture that is not in FIXTURES they would never read it at all.
    expect(Object.keys(SEEDED_HOUR_BANDS).sort()).toEqual(FIXTURES.map((f) => f.slug).sort());
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    'shows the $fixture admin and member-role session exactly its own seeded bands',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const own = await organizationId(client, slug);

        for (const username of [admin, member]) {
          const caller = await memberByUsername(client, slug, username);
          await actAs(client, caller.authUserId, caller.organizationId);
          const { rows } = await client.query<{ organizationId: string; name: string; startTime: string }>(
            `select organization_id as "organizationId", name, start_time::text as "startTime"
               from hour_bands order by start_time`,
          );
          await actAsOwner(client);

          expect(
            rows,
            `${slug}/${username} does not read exactly its own seeded bands`,
          ).toEqual(seededBandsOf(slug).map((band) => ({ organizationId: own, ...band })));
        }
      });
    },
  );
});

describe('an admin creates, renames, moves and deletes hour bands, and any count is just a count', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'lets the $fixture admin add, rename, move and delete a band, down to zero bands',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);
        const own = caller.organizationId;

        const id = await insertHourBand(client, own, `${THROWAWAY} band`, '03:17');
        expect(await visibleHourBands(client, own)).toHaveLength(seededBandsOf(slug).length + 1);

        const renamed = await client.query('update hour_bands set name = $1 where id = $2', [
          `${THROWAWAY} renamed`,
          id,
        ]);
        const moved = await client.query("update hour_bands set start_time = '03:41' where id = $1", [
          id,
        ]);
        expect(renamed.rowCount, 'the rename reached no row').toBe(1);
        expect(moved.rowCount, 'the move reached no row').toBe(1);

        // Zero bands is a valid stored state: every band, the last included,
        // may go. The domain derives one uncovered segment from it.
        const deleted = await client.query('delete from hour_bands where organization_id = $1', [own]);
        expect(deleted.rowCount).toBe(seededBandsOf(slug).length + 1);
        expect(await visibleHourBands(client, own)).toEqual([]);
        await actAsOwner(client);

        expect(await hourBandById(client, id), 'a deleted band is still there').toBeUndefined();
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second $fixture band at a start that is already taken, and writes nothing',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);
        const taken = seededBandsOf(slug)[0]?.startTime;
        if (taken === undefined) throw new Error(`${slug} records no seeded band to collide with`);

        const refusal = await refusedThenContinue(client, () =>
          insertHourBand(client, caller.organizationId, `${THROWAWAY} twin`, taken),
        );
        const { rows } = await client.query<{ id: string }>(
          'select id from hour_bands where organization_id = $1 order by start_time limit 1',
          [caller.organizationId],
        );
        const first = rows[0]?.id;
        if (first === undefined) throw new Error(`${slug} admin reads no hour band to keep in place`);
        const moveRefusal = await refusedThenContinue(client, () =>
          client.query('update hour_bands set start_time = $1 where organization_id = $2 and id <> $3', [
            taken,
            caller.organizationId,
            first,
          ]),
        );

        expect(refusal.code, 'a duplicate start is a unique violation').toBe('23505');
        expect(moveRefusal.code, 'moving onto a taken start is a unique violation').toBe('23505');
        // STORY 2.1b. The constraint `@/features/hour-bands/services/write` reads to tell a taken
        // start from a taken name — both are 23505 — asserted against the live
        // database, as `organizations_name_check` is, so a rename fails here.
        for (const named of [refusal, moveRefusal]) {
          expect(named.message, 'the refusal does not name the start unique').toContain(
            'hour_bands_organization_id_start_time_key',
          );
        }
        expect(await visibleHourBands(client, caller.organizationId)).toEqual(seededBandsOf(slug));
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture band at 24:00 or at a start with seconds',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);

        // STORY 2.1b: each with the constraint `@/features/hour-bands/services/write` reads, since
        // three checks share 23514.
        for (const [start, constraint] of [
          ['24:00', 'hour_bands_start_before_midnight'],
          ['07:00:30', 'hour_bands_start_whole_minute'],
          ['03:17:00.5', 'hour_bands_start_whole_minute'],
        ] as const) {
          const refusal = await refusedThenContinue(client, () =>
            insertHourBand(client, caller.organizationId, `${THROWAWAY} ${start}`, start),
          );
          expect(refusal.code, `${start} is not a check violation`).toBe('23514');
          expect(refusal.message, `${start} does not name ${constraint}`).toContain(constraint);
        }
        expect(await visibleHourBands(client, caller.organizationId)).toEqual(seededBandsOf(slug));

        // The edges that ARE admitted, so the checks are not simply refusing
        // everything near midnight.
        await insertHourBand(client, caller.organizationId, `${THROWAWAY} midnight`, '00:00');
        await insertHourBand(client, caller.organizationId, `${THROWAWAY} last`, '23:59');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture band name another band carries in any case and padding, or a blank one',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);

        // Both fixtures seed a band named `Noć`.
        const duplicate = await refusedThenContinue(client, () =>
          insertHourBand(client, caller.organizationId, ' noć ', '03:17'),
        );
        const blank = await refusedThenContinue(client, () =>
          insertHourBand(client, caller.organizationId, '  ', '03:17'),
        );

        expect(duplicate.code, 'a duplicate name is a unique violation').toBe('23505');
        expect(blank.code, 'a blank name is a check violation').toBe('23514');
        // STORY 2.1b: the constraint names `@/features/hour-bands/services/write` reads.
        expect(duplicate.message, 'the refusal does not name the name index').toContain(
          'hour_bands_organization_name_key',
        );
        expect(blank.message, 'the refusal does not name the blank-name check').toContain(
          'hour_bands_name_not_blank',
        );
        expect(await visibleHourBands(client, caller.organizationId)).toEqual(seededBandsOf(slug));
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture admin naming a band column the grant does not admit',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);

        const forgedAt = await refusedThenContinue(client, () =>
          client.query(
            "insert into hour_bands (organization_id, name, start_time, created_at) values ($1, $2, '03:17', now())",
            [caller.organizationId, `${THROWAWAY} forged`],
          ),
        );
        const forgedId = await refusedThenContinue(client, () =>
          client.query('update hour_bands set id = gen_random_uuid() where organization_id = $1', [
            caller.organizationId,
          ]),
        );

        expect(forgedAt.code, 'created_at is not a column a session may name').toBe('42501');
        expect(forgedId.code, 'id is not a column a session may update').toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role session creating, changing or deleting a band',
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, member);
        await actAs(client, caller.authUserId, caller.organizationId);

        const insertRefusal = await refusedThenContinue(client, () =>
          insertHourBand(client, caller.organizationId, `${THROWAWAY} member made`, '03:17'),
        );
        const renamed = await client.query('update hour_bands set name = name || $1', ['!']);
        const moved = await client.query(
          "update hour_bands set start_time = start_time + interval '1 minute'",
        );
        const deleted = await client.query('delete from hour_bands');
        await actAsOwner(client);

        expect(insertRefusal.code, 'a member-role insert is refused by WITH CHECK').toBe('42501');
        expect(renamed.rowCount, `a ${slug} member renamed a band`).toBe(0);
        expect(moved.rowCount, `a ${slug} member moved a band`).toBe(0);
        expect(deleted.rowCount, `a ${slug} member deleted a band`).toBe(0);
        expect(await visibleHourBands(client, caller.organizationId)).toEqual(seededBandsOf(slug));
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'keeps $otherFixture hour bands out of reach of the $fixture admin',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const other = await organizationId(client, otherSlug);

        await actAs(client, caller.authUserId, caller.organizationId);
        const read = await client.query('select id from hour_bands where organization_id = $1', [
          other,
        ]);
        const renamed = await client.query(
          'update hour_bands set name = name || $1 where organization_id = $2',
          [' hijacked', other],
        );
        const deleted = await client.query('delete from hour_bands where organization_id = $1', [
          other,
        ]);
        const insertRefusal = await refusedThenContinue(client, () =>
          insertHourBand(client, other, `${THROWAWAY} planted`, '03:17'),
        );
        const own = await insertHourBand(client, caller.organizationId, `${THROWAWAY} own`, '03:17');
        const movedAway = await refusedThenContinue(client, () =>
          client.query('update hour_bands set organization_id = $1 where id = $2', [other, own]),
        );
        await actAsOwner(client);

        expect(read.rowCount, `a ${slug} admin read ${otherSlug} bands`).toBe(0);
        expect(renamed.rowCount, `a ${slug} admin renamed a ${otherSlug} band`).toBe(0);
        expect(deleted.rowCount, `a ${slug} admin deleted a ${otherSlug} band`).toBe(0);
        expect(insertRefusal.code).toBe('42501');
        expect(movedAway.code, 'organization_id is not a column a session may update').toBe('42501');
        expect(await visibleHourBands(client, other)).toEqual(seededBandsOf(otherSlug));
      });
    },
  );

  it.skipIf(noDatabase)('refuses an anonymous session every verb on hour bands', async () => {
    await inRolledBackTransaction(async (client) => {
      const own = await organizationId(client, FIXTURES[0].slug);
      await client.query('set local role anon');

      const verbs = [
        () => client.query('select id from hour_bands'),
        () => insertHourBand(client, own, `${THROWAWAY} anonymous`, '03:17'),
        () => client.query("update hour_bands set name = 'x'"),
        () => client.query('delete from hour_bands'),
      ];
      for (const verb of verbs) {
        const refusal = await refusedThenContinue(client, verb);
        expect(refusal.code, 'anon holds a privilege on hour_bands').toBe('42501');
      }
    });
  });
});

describe('a direct API call writes hour bands under exactly the same rules', () => {
  it.skipIf(noApi).each(FIXTURES)(
    'lets the $fixture admin create, rename, move and delete a band over PostgREST',
    async ({ slug, admin }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      let id: string | undefined;
      try {
        const own = await organizationId(client, slug);
        const name = `${THROWAWAY} rest ${crypto.randomUUID()}`;
        const created = await rest('hour_bands?select=id', {
          token,
          method: 'POST',
          body: { organization_id: own, name, start_time: '03:17' },
          prefer: 'return=representation',
        });
        expect(created.status, 'a permitted insert answers 201').toBe(201);
        const [row] = (await created.json()) as readonly { id: string }[];
        id = row?.id;
        if (id === undefined) throw new Error('a permitted band insert returned no row');

        const changed = await rest(`hour_bands?id=eq.${id}&select=id`, {
          token,
          method: 'PATCH',
          body: { name: `${name} renamed`, start_time: '03:41' },
          prefer: 'return=representation',
        });
        expect(await changed.json(), 'the update reached no row').toEqual([{ id }]);
        expect(await hourBandById(client, id)).toEqual({
          organizationId: own,
          id,
          name: `${name} renamed`,
          startTime: '03:41:00',
        });

        const duplicate = await rest('hour_bands', {
          token,
          method: 'POST',
          body: { organization_id: own, name: `${name} twin`, start_time: '03:41' },
        });
        expect(duplicate.ok, 'a second band at a taken start was admitted').toBe(false);
        const duplicateRefusal = await restRefusal(duplicate);
        expect(duplicateRefusal.code).toBe('23505');
        // STORY 2.1b: PostgREST carries the constraint in `message`, which is
        // where `@/features/hour-bands/services/write` reads it.
        expect(duplicateRefusal.message).toContain('hour_bands_organization_id_start_time_key');

        // Both fixtures seed a band named `Noć`: a padded, lowercased twin.
        const twinName = await rest('hour_bands', {
          token,
          method: 'POST',
          body: { organization_id: own, name: ' noć ', start_time: '03:42' },
        });
        expect(twinName.ok, 'a second band with a taken name was admitted').toBe(false);
        const twinRefusal = await restRefusal(twinName);
        expect(twinRefusal.code).toBe('23505');
        expect(twinRefusal.message).toContain('hour_bands_organization_name_key');

        const deleted = await rest(`hour_bands?id=eq.${id}&select=id`, {
          token,
          method: 'DELETE',
          prefer: 'return=representation',
        });
        expect(await deleted.json(), 'the delete reached no row').toEqual([{ id }]);
        expect(await hourBandById(client, id)).toBeUndefined();
      } finally {
        if (id !== undefined) await client.query('delete from hour_bands where id = $1', [id]);
        // Only a name index that failed to refuse leaves the padded twin; no
        // fixture seeds a band at 03:42.
        await client.query("delete from hour_bands where start_time = '03:42'");
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture member-role token creating, changing or deleting a band over PostgREST',
    async ({ slug, member }) => {
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);

        const created = await rest('hour_bands', {
          token,
          method: 'POST',
          body: { organization_id: own, name: `${THROWAWAY} by a member`, start_time: '10:11' },
        });
        const refusal = await restRefusal(created);
        const changed = await rest(`hour_bands?organization_id=eq.${own}&select=id`, {
          token,
          method: 'PATCH',
          body: { start_time: '10:11' },
          prefer: 'return=representation',
        });
        const deleted = await rest(`hour_bands?organization_id=eq.${own}&select=id`, {
          token,
          method: 'DELETE',
          prefer: 'return=representation',
        });

        expect(created.ok, 'a member-role account created a band').toBe(false);
        expect(refusal.code).toBe('42501');
        expect(await changed.json(), 'a member-role account changed a band').toEqual([]);
        expect(await deleted.json(), 'a member-role account deleted a band').toEqual([]);
        expect(await visibleHourBands(client, own)).toEqual(seededBandsOf(slug));
      } finally {
        await client.query('delete from hour_bands where name like $1', [`${THROWAWAY} by a member%`]);
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture admin a band at 24:00, at a start with seconds, or with a blank name over PostgREST',
    async ({ slug, admin }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        // STORY 2.1b: each attempt names the constraint `@/features/hour-bands/services/write`
        // reads, since all three share 23514.
        const attempts = [
          {
            body: { name: `${THROWAWAY} rest midnight`, start_time: '24:00' },
            constraint: 'hour_bands_start_before_midnight',
          },
          {
            body: { name: `${THROWAWAY} rest seconds`, start_time: '07:00:30' },
            constraint: 'hour_bands_start_whole_minute',
          },
          { body: { name: '   ', start_time: '10:11' }, constraint: 'hour_bands_name_not_blank' },
        ];

        for (const { body: attempt, constraint } of attempts) {
          const response = await rest('hour_bands', {
            token,
            method: 'POST',
            body: { organization_id: own, ...attempt },
          });
          const refusal = await restRefusal(response);

          expect(response.ok, `${JSON.stringify(attempt)} was admitted`).toBe(false);
          expect(refusal.code, `${JSON.stringify(attempt)} is not a check violation`).toBe('23514');
          expect(refusal.message, `${JSON.stringify(attempt)} does not name ${constraint}`).toContain(
            constraint,
          );
        }
        expect(await visibleHourBands(client, own)).toEqual(seededBandsOf(slug));
      } finally {
        // Only a check that failed to refuse leaves a row; the blank name
        // cannot be stored at all, so the two named attempts are all there is.
        await client.query('delete from hour_bands where name = any($1::text[])', [
          [`${THROWAWAY} rest midnight`, `${THROWAWAY} rest seconds`],
        ]);
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi)('refuses an anonymous caller any hour band', async () => {
    const response = await rest('hour_bands?select=*');
    const refusal = await restRefusal(response);

    expect(response.status, 'an anonymous caller read hour bands').toBe(401);
    expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
  });
});

// ------------------------------------------------------ story 2.2a: shift types

/**
 * STORY 2.2a. A shift type is current-state (`shift_types`, 0009's shape) and
 * a working type's times are versioned (`shift_type_versions`, 0010's rules
 * unchanged). `0013_shift_types.sql` is the whole enforcement; the duration is
 * `packages/domain`'s and is asserted there.
 *
 * Every SQL case below runs in a rolled-back transaction. The REST cases commit
 * on throwaway types only, never on a seeded one, and delete their own rows in
 * `finally` (versions first — they reference types with no cascade);
 * `afterAll` is the backstop.
 */
interface ShiftTypeRow {
  readonly organizationId: string;
  readonly id: string;
  readonly name: string;
  readonly isWorking: boolean;
  readonly archived: boolean;
  readonly createdBy: string;
}

interface ShiftTypeVersionRow {
  readonly organizationId: string;
  readonly id: string;
  readonly shiftTypeId: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly from: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

interface SeededShiftType {
  readonly name: string;
  readonly isWorking: boolean;
  readonly versions: readonly { startTime: string; endTime: string; from: string }[];
}

/**
 * What `supabase/seed.sql` gives each fixture, in creation order, with the
 * admin every row is attributed to.
 *
 * DERIVED FROM THE DOMAIN FIXTURES, as the bands are: the arrays
 * `packages/domain` asserts its duration rule against are the one source of
 * truth, so a seed that drifts from them — or they from it — fails here.
 */
const SEEDED_SHIFT_TYPES: Readonly<
  Record<string, { readonly admin: string; readonly types: readonly SeededShiftType[] }>
> = Object.fromEntries(
  (
    [
      ['dvd-kastel-novi', 'ivan.maric', PILOT_SHIFT_TYPES, PILOT_SHIFT_TYPE_VERSIONS],
      ['zastita-split', 'josip.peric', UJ5_SHIFT_TYPES, UJ5_SHIFT_TYPE_VERSIONS],
    ] as const
  ).map(([slug, admin, types, versions]) => [
    slug,
    {
      admin,
      types: types.map((type) => ({
        name: type.name,
        isWorking: type.isWorking,
        versions: versions
          .filter((version) => version.shiftTypeId === type.id)
          .map((version) => ({
            startTime: asTime(version.startMinute),
            endTime: asTime(version.endMinute),
            from: version.effectiveFrom,
          })),
      })),
    },
  ]),
);

function seededShiftTypesOf(slug: string): readonly SeededShiftType[] {
  const seeded = SEEDED_SHIFT_TYPES[slug];
  if (seeded === undefined) throw new Error(`no seeded shift types are recorded for ${slug}`);
  return seeded.types;
}

/** One type re-read as the owner, so RLS hides nothing. */
async function shiftTypeById(client: Client, id: string): Promise<ShiftTypeRow | undefined> {
  const { rows } = await client.query<ShiftTypeRow>(
    `select organization_id as "organizationId", id, name, is_working as "isWorking",
            archived, created_by as "createdBy"
       from shift_types where id = $1`,
    [id],
  );
  return rows[0];
}

/** A seeded type of one organization found by name, as the owner. */
async function seededShiftType(client: Client, organization: string, name: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'select id from shift_types where organization_id = $1 and name = $2',
    [organization, name],
  );
  const found = rows[0];
  if (found === undefined) throw new Error(`no seeded shift type ${name}`);
  return found.id;
}

/** Every version of one type, oldest first, read as the owner: every column,
 *  so an equality is a whole-row equality. */
async function shiftTypeVersionsOf(client: Client, type: string): Promise<ShiftTypeVersionRow[]> {
  const { rows } = await client.query<ShiftTypeVersionRow>(
    `select organization_id as "organizationId", id, shift_type_id as "shiftTypeId",
            start_time::text as "startTime", end_time::text as "endTime",
            effective_from::text as "from", created_by as "createdBy",
            created_at::text as "createdAt"
       from shift_type_versions where shift_type_id = $1 order by effective_from`,
    [type],
  );
  return rows;
}

/** Every version of every type in one organization, as the owner. */
async function organizationShiftTypeVersions(
  client: Client,
  organization: string,
): Promise<ShiftTypeVersionRow[]> {
  const { rows } = await client.query<ShiftTypeVersionRow>(
    `select organization_id as "organizationId", id, shift_type_id as "shiftTypeId",
            start_time::text as "startTime", end_time::text as "endTime",
            effective_from::text as "from", created_by as "createdBy",
            created_at::text as "createdAt"
       from shift_type_versions where organization_id = $1 order by shift_type_id, effective_from`,
    [organization],
  );
  return rows;
}

/** `shift_type_times_on`, the one SQL reading: the times in effect on a date
 *  (the greatest `effective_from` on or before it), as whoever the connection
 *  is. The same reading the domain's `shiftTypeVersionOn` makes. */
async function shiftTimesOn(
  client: Client,
  type: string,
  day: string,
): Promise<{ startTime: string; endTime: string } | null> {
  const { rows } = await client.query<{ startTime: string; endTime: string }>(
    `select start_time::text as "startTime", end_time::text as "endTime"
       from public.shift_type_times_on($1, $2::date)`,
    [type, day],
  );
  return rows[0] ?? null;
}

/** Insert one type as the current session, returning its id. */
async function insertShiftType(
  client: Client,
  organization: string,
  name: string,
  isWorking: boolean,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'insert into shift_types (organization_id, name, is_working) values ($1, $2, $3) returning id',
    [organization, name, isWorking],
  );
  const type = rows[0];
  if (type === undefined) throw new Error('shift_types insert returned no row');
  return type.id;
}

/** A throwaway type written as the OWNER — the state a case starts from. */
async function addThrowawayShiftType(
  client: Client,
  organization: string,
  createdBy: string,
  options: { isWorking?: boolean; archived?: boolean } = {},
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into shift_types (organization_id, name, is_working, archived, created_by)
     values ($1, $2 || ' ' || gen_random_uuid()::text, $3, $4, $5)
     returning id`,
    [
      organization,
      `${THROWAWAY} shift type`,
      options.isWorking ?? true,
      options.archived ?? false,
      createdBy,
    ],
  );
  const type = rows[0];
  if (type === undefined) throw new Error('shift_types insert returned no row');
  return type.id;
}

interface VersionFacts {
  readonly organization: string;
  readonly type: string;
  readonly start: string;
  readonly end: string;
  readonly from: string;
}

/** One version, as whoever the connection currently is: the five columns a
 *  session may name, and nothing else. */
async function insertShiftTypeVersion(
  client: Client,
  version: VersionFacts,
): Promise<{ rowCount: number | null }> {
  return client.query(
    `insert into shift_type_versions
       (organization_id, shift_type_id, start_time, end_time, effective_from)
     values ($1, $2, $3, $4, $5::date)`,
    [version.organization, version.type, version.start, version.end, version.from],
  );
}

/** One version written as the OWNER, past every policy (a past or second
 *  scheduled date is only reachable this way). */
async function ownerShiftTypeVersion(
  client: Client,
  version: VersionFacts & { readonly by: string },
): Promise<void> {
  await client.query(
    `insert into shift_type_versions
       (organization_id, shift_type_id, start_time, end_time, effective_from, created_by)
     values ($1, $2, $3, $4, $5::date, $6)`,
    [version.organization, version.type, version.start, version.end, version.from, version.by],
  );
}

/** The cancellation a surface would send, as whoever the connection is. */
async function cancelShiftTypeVersion(
  client: Client,
  version: { type: string; from: string },
): Promise<{ rowCount: number | null }> {
  return client.query(
    'delete from shift_type_versions where shift_type_id = $1 and effective_from = $2::date',
    [version.type, version.from],
  );
}

describe('each organization holds exactly its own seeded shift types and times', () => {
  it('records the types both fixtures are seeded with', () => {
    expect(Object.keys(SEEDED_SHIFT_TYPES).sort()).toEqual(FIXTURES.map((f) => f.slug).sort());
    expect(SEEDED_EFFECTIVE_FROM).toBe('2020-01-01');
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    'shows the $fixture admin and member-role session exactly its own types, times and dates',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const own = await organizationId(client, slug);

        for (const username of [admin, member]) {
          const caller = await memberByUsername(client, slug, username);
          await actAs(client, caller.authUserId, caller.organizationId);
          const { rows: types } = await client.query<{
            organizationId: string;
            id: string;
            name: string;
            isWorking: boolean;
            archived: boolean;
          }>(
            `select organization_id as "organizationId", id, name, is_working as "isWorking", archived
               from shift_types order by created_at`,
          );
          const { rows: versions } = await client.query<{
            organizationId: string;
            shiftTypeId: string;
            startTime: string;
            endTime: string;
            from: string;
          }>(
            `select organization_id as "organizationId", shift_type_id as "shiftTypeId",
                    start_time::text as "startTime", end_time::text as "endTime",
                    effective_from::text as "from"
               from shift_type_versions order by effective_from`,
          );
          await actAsOwner(client);

          expect(
            types.map((type) => ({
              organizationId: type.organizationId,
              name: type.name,
              isWorking: type.isWorking,
              archived: type.archived,
              versions: versions
                .filter((version) => version.shiftTypeId === type.id)
                .map(({ startTime, endTime, from }) => ({ startTime, endTime, from })),
            })),
            `${slug}/${username} does not read exactly its own seeded types, in creation order`,
          ).toEqual(
            seededShiftTypesOf(slug).map((type) => ({
              organizationId: own,
              archived: false,
              ...type,
            })),
          );
          expect(
            [...new Set(versions.map((version) => version.organizationId))],
            `${slug}/${username} read another organization's versions`,
          ).toEqual([own]);
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'attributes every seeded $fixture type and version to its own admin',
    async ({ slug }) => {
      await inRolledBackTransaction(async (client) => {
        const seeded = SEEDED_SHIFT_TYPES[slug];
        if (seeded === undefined) throw new Error(`no seeded shift types are recorded for ${slug}`);
        const owner = await memberByUsername(client, slug, seeded.admin);

        const { rows } = await client.query<{ table: string; createdBy: string; ties: number }>(
          `select 'shift_types' as table, created_by as "createdBy",
                  (count(*) - count(distinct created_at))::int as ties
             from shift_types where organization_id = $1 group by created_by
           union all
           select 'shift_type_versions', created_by, 0
             from shift_type_versions where organization_id = $1 group by created_by
           order by 1`,
          [owner.organizationId],
        );
        expect(rows, `${slug} seed attribution is not its admin alone`).toEqual([
          { table: 'shift_type_versions', createdBy: owner.authUserId, ties: 0 },
          // Distinct `created_at`s: the seed runs in one transaction, where
          // `now()` would tie, and 2.2b reads creation order.
          { table: 'shift_types', createdBy: owner.authUserId, ties: 0 },
        ]);
      });
    },
  );
});

describe('an admin creates, renames and archives shift types, and never deletes one', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'lets the $fixture admin create a working and a non-working type, rename and archive them, attributed to the caller',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);

        const working = await insertShiftType(client, caller.organizationId, `${THROWAWAY} working`, true);
        const resting = await insertShiftType(client, caller.organizationId, `${THROWAWAY} resting`, false);
        const renamed = await client.query('update shift_types set name = $1 where id = $2', [
          `${THROWAWAY} renamed`,
          working,
        ]);
        const archived = await client.query('update shift_types set archived = true where id = $1', [
          resting,
        ]);
        // One-way: an archived type matches no update at all.
        const revived = await client.query('update shift_types set archived = false where id = $1', [
          resting,
        ]);
        const renamedArchived = await client.query('update shift_types set name = $1 where id = $2', [
          `${THROWAWAY} renamed while archived`,
          resting,
        ]);
        await actAsOwner(client);

        expect(renamed.rowCount, 'the rename reached no row').toBe(1);
        expect(archived.rowCount, 'the archive reached no row').toBe(1);
        expect(revived.rowCount, `a ${slug} archived type was brought back`).toBe(0);
        expect(renamedArchived.rowCount, `a ${slug} archived type was renamed`).toBe(0);
        expect(await shiftTypeById(client, working)).toEqual({
          organizationId: caller.organizationId,
          id: working,
          name: `${THROWAWAY} renamed`,
          isWorking: true,
          archived: false,
          createdBy: caller.authUserId,
        });
        expect(await shiftTypeById(client, resting)).toMatchObject({
          name: `${THROWAWAY} resting`,
          isWorking: false,
          archived: true,
          createdBy: caller.authUserId,
        });
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses the $fixture admin flipping is_working, deleting a type, or naming a column the grant does not admit',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const type = await seededShiftType(client, caller.organizationId, seededShiftTypesOf(slug)[0]!.name);
        await actAs(client, caller.authUserId, caller.organizationId);

        const flipped = await refusedThenContinue(client, () =>
          client.query('update shift_types set is_working = false where id = $1', [type]),
        );
        const deleted = await refusedThenContinue(client, () =>
          client.query('delete from shift_types where id = $1', [type]),
        );
        const forgedBy = await refusedThenContinue(client, () =>
          client.query(
            'insert into shift_types (organization_id, name, is_working, created_by) values ($1, $2, true, $3)',
            [caller.organizationId, `${THROWAWAY} forged`, caller.authUserId],
          ),
        );
        const forgedAt = await refusedThenContinue(client, () =>
          client.query(
            "insert into shift_types (organization_id, name, is_working, created_at) values ($1, $2, true, now() - interval '1 year')",
            [caller.organizationId, `${THROWAWAY} forged`],
          ),
        );
        const movedAway = await refusedThenContinue(client, () =>
          client.query('update shift_types set organization_id = organization_id where id = $1', [type]),
        );
        await actAsOwner(client);

        expect(flipped.code, 'is_working is updatable').toBe('42501');
        expect(deleted.code, 'the delete privilege on shift_types is held').toBe('42501');
        expect(forgedBy.code, 'a session named its own created_by').toBe('42501');
        expect(forgedAt.code, 'a session named its own created_at').toBe('42501');
        expect(movedAway.code, 'organization_id is updatable').toBe('42501');
        expect(await shiftTypeById(client, type)).toMatchObject({ isWorking: true, archived: false });
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture type name another active type carries in any case and padding, or a blank one, and frees an archived one',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);

        // The matrix's `" noć "` beside `Noć`, for every seeded name.
        for (const { name } of seededShiftTypesOf(slug)) {
          const padded = ` ${name.toLowerCase()} `;
          const duplicate = await refusedThenContinue(client, () =>
            insertShiftType(client, caller.organizationId, padded, true),
          );
          expect(duplicate.code, `${JSON.stringify(padded)} is not a unique violation`).toBe('23505');
          expect(duplicate.message).toContain('shift_types_organization_name_key');
        }
        const blank = await refusedThenContinue(client, () =>
          insertShiftType(client, caller.organizationId, '   ', true),
        );
        expect(blank.code, 'a blank name is a check violation').toBe('23514');
        expect(blank.message).toContain('shift_types_name_not_blank');

        // PARTIAL: an archived type's name is free to be taken again.
        const first = await insertShiftType(client, caller.organizationId, `${THROWAWAY} reused`, true);
        await client.query('update shift_types set archived = true where id = $1', [first]);
        const second = await insertShiftType(client, caller.organizationId, `${THROWAWAY} REUSED `, true);
        expect(second).not.toBe(first);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role session creating, renaming or archiving a type',
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, member);
        await actAs(client, caller.authUserId, caller.organizationId);

        const created = await refusedThenContinue(client, () =>
          insertShiftType(client, caller.organizationId, `${THROWAWAY} member made`, true),
        );
        const renamed = await client.query('update shift_types set name = name || $1', ['!']);
        const archived = await client.query('update shift_types set archived = true');
        await actAsOwner(client);

        expect(created.code, 'a member-role insert is refused by WITH CHECK').toBe('42501');
        expect(renamed.rowCount, `a ${slug} member renamed a type`).toBe(0);
        expect(archived.rowCount, `a ${slug} member archived a type`).toBe(0);
      });
    },
  );
});

describe('shift type times are versioned: appended in date order, each one a change, one scheduled at most', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'gives a new $fixture working type its first times from today, attributed to the caller',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const today = await organizationDay(client, caller.organizationId);
        const yesterday = await organizationDay(client, caller.organizationId, -1);
        await actAs(client, caller.authUserId, caller.organizationId);

        const type = await insertShiftType(client, caller.organizationId, `${THROWAWAY} new`, true);
        expect(await shiftTimesOn(client, type, today), 'a new type invented times').toBeNull();
        const written = await insertShiftTypeVersion(client, {
          organization: caller.organizationId,
          type,
          start: '07:00',
          end: '07:00',
          from: today,
        });
        await actAsOwner(client);

        expect(written.rowCount, `the ${slug} admin could not give a type its times`).toBe(1);
        expect(await shiftTypeVersionsOf(client, type)).toMatchObject([
          {
            organizationId: caller.organizationId,
            shiftTypeId: type,
            startTime: '07:00:00',
            endTime: '07:00:00',
            from: today,
            createdBy: caller.authUserId,
          },
        ]);
        expect(await shiftTimesOn(client, type, yesterday), 'the first times reached back').toBeNull();
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'corrects a seeded $fixture type from today, renames it, and earlier dates keep the old times',
    async ({ slug, admin }) => {
      // The time-correction row and AC 3: one new row, the seeded one
      // byte-identical, the name current on every date, the times per date.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const seeded = seededShiftTypesOf(slug).find((type) => type.isWorking);
        if (seeded === undefined) throw new Error(`${slug} seeds no working type`);
        const type = await seededShiftType(client, caller.organizationId, seeded.name);
        const today = await organizationDay(client, caller.organizationId);
        const yesterday = await organizationDay(client, caller.organizationId, -1);
        const before = await shiftTypeVersionsOf(client, type);

        await actAs(client, caller.authUserId, caller.organizationId);
        const written = await insertShiftTypeVersion(client, {
          organization: caller.organizationId,
          type,
          start: '05:30',
          end: '17:30',
          from: today,
        });
        const renamed = await client.query('update shift_types set name = $1 where id = $2', [
          `${THROWAWAY} renamed`,
          type,
        ]);
        const { rows: named } = await client.query<{ name: string }>(
          'select name from shift_types where id = $1',
          [type],
        );
        const rows = [];
        for (const day of ['2019-12-31', SEEDED_EFFECTIVE_FROM, yesterday, today]) {
          rows.push({
            name: named[0]?.name,
            day,
            startTime: (await shiftTimesOn(client, type, day))?.startTime ?? null,
          });
        }
        await actAsOwner(client);

        expect(written.rowCount).toBe(1);
        expect(renamed.rowCount).toBe(1);
        const after = await shiftTypeVersionsOf(client, type);
        expect(after.length).toBe(before.length + 1);
        expect(after[0], 'the seeded version changed').toEqual(before[0]);
        expect(rows).toEqual([
          { name: `${THROWAWAY} renamed`, day: '2019-12-31', startTime: null },
          { name: `${THROWAWAY} renamed`, day: SEEDED_EFFECTIVE_FROM, startTime: seeded.versions[0]!.startTime },
          { name: `${THROWAWAY} renamed`, day: yesterday, startTime: seeded.versions[0]!.startTime },
          { name: `${THROWAWAY} renamed`, day: today, startTime: '05:30:00' },
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a backdated $fixture version, and writes nothing',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const type = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId);
        const yesterday = await organizationDay(client, caller.organizationId, -1);
        await actAs(client, caller.authUserId, caller.organizationId);

        const refusal = await refusedThenContinue(client, () =>
          insertShiftTypeVersion(client, {
            organization: caller.organizationId,
            type,
            start: '07:00',
            end: '19:00',
            from: yesterday,
          }),
        );
        await actAsOwner(client);

        expect(refusal.code, 'a backdated version was admitted').toBe('42501');
        expect(await shiftTypeVersionsOf(client, type)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second scheduled $fixture version, or one on or before the latest, and writes nothing',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const type = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId);
        const facts = { organization: caller.organizationId, type };
        await ownerShiftTypeVersion(client, {
          ...facts,
          start: '07:00',
          end: '19:00',
          from: SEEDED_EFFECTIVE_FROM,
          by: caller.authUserId,
        });
        await ownerShiftTypeVersion(client, {
          ...facts,
          start: '08:00',
          end: '20:00',
          from: await organizationDay(client, caller.organizationId, 5),
          by: caller.authUserId,
        });
        const before = await shiftTypeVersionsOf(client, type);
        await actAs(client, caller.authUserId, caller.organizationId);

        for (const offset of [0, 3, 5, 10]) {
          const refusal = await refusedThenContinue(client, async () =>
            insertShiftTypeVersion(client, {
              ...facts,
              start: '09:00',
              end: '21:00',
              from: await organizationDay(client, caller.organizationId, offset),
            }),
          );
          expect(refusal.code, `a version at today+${offset} was admitted beside a scheduled one`).toBe(
            '42501',
          );
        }
        await actAsOwner(client);

        expect(await shiftTypeVersionsOf(client, type)).toEqual(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture version with the latest version own times, and admits a change of either time alone',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const today = await organizationDay(client, caller.organizationId);
        const types = [];
        for (let index = 0; index < 3; index += 1) {
          const type = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId);
          await ownerShiftTypeVersion(client, {
            organization: caller.organizationId,
            type,
            start: '19:00',
            end: '07:00',
            from: SEEDED_EFFECTIVE_FROM,
            by: caller.authUserId,
          });
          types.push(type);
        }
        const [same, startOnly, endOnly] = types as [string, string, string];
        await actAs(client, caller.authUserId, caller.organizationId);

        const refusal = await refusedThenContinue(client, () =>
          insertShiftTypeVersion(client, {
            organization: caller.organizationId,
            type: same,
            start: '19:00',
            end: '07:00',
            from: today,
          }),
        );
        const moveStart = await insertShiftTypeVersion(client, {
          organization: caller.organizationId,
          type: startOnly,
          start: '18:00',
          end: '07:00',
          from: today,
        });
        const moveEnd = await insertShiftTypeVersion(client, {
          organization: caller.organizationId,
          type: endOnly,
          start: '19:00',
          end: '08:00',
          from: today,
        });
        await actAsOwner(client);

        expect(refusal.code, 'a version that changes nothing was admitted').toBe('42501');
        expect(await shiftTypeVersionsOf(client, same)).toHaveLength(1);
        expect(moveStart.rowCount, 'a change of the start alone was refused').toBe(1);
        expect(moveEnd.rowCount, 'a change of the end alone was refused').toBe(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture version on a non-working or archived type',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const resting = seededShiftTypesOf(slug).find((type) => !type.isWorking);
        if (resting === undefined) throw new Error(`${slug} seeds no non-working type`);
        const nonWorking = await seededShiftType(client, caller.organizationId, resting.name);
        const archived = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId, {
          archived: true,
        });
        const today = await organizationDay(client, caller.organizationId);
        await actAs(client, caller.authUserId, caller.organizationId);

        for (const [label, type] of [
          ['non-working', nonWorking],
          ['archived', archived],
        ] as const) {
          const refusal = await refusedThenContinue(client, () =>
            insertShiftTypeVersion(client, {
              organization: caller.organizationId,
              type,
              start: '07:00',
              end: '19:00',
              from: today,
            }),
          );
          expect(refusal.code, `a version on a ${label} type was admitted`).toBe('42501');
        }
        await actAsOwner(client);

        expect(await shiftTypeVersionsOf(client, nonWorking)).toEqual([]);
        expect(await shiftTypeVersionsOf(client, archived)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'cancels the latest future $fixture version, and no version in effect or before it',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const today = await organizationDay(client, caller.organizationId);
        const scheduled = await organizationDay(client, caller.organizationId, 7);
        const facts = { organization: caller.organizationId, by: caller.authUserId };

        const pending = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId);
        await ownerShiftTypeVersion(client, { ...facts, type: pending, start: '07:00', end: '19:00', from: SEEDED_EFFECTIVE_FROM });
        await ownerShiftTypeVersion(client, { ...facts, type: pending, start: '08:00', end: '20:00', from: scheduled });
        const current = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId);
        await ownerShiftTypeVersion(client, { ...facts, type: current, start: '07:00', end: '19:00', from: SEEDED_EFFECTIVE_FROM });
        await ownerShiftTypeVersion(client, { ...facts, type: current, start: '08:00', end: '20:00', from: today });
        const pendingBefore = await shiftTypeVersionsOf(client, pending);
        const currentBefore = await shiftTypeVersionsOf(client, current);

        await actAs(client, caller.authUserId, caller.organizationId);
        const past = await cancelShiftTypeVersion(client, { type: pending, from: SEEDED_EFFECTIVE_FROM });
        const inEffect = await cancelShiftTypeVersion(client, { type: current, from: today });
        const whole = await client.query('delete from shift_type_versions where shift_type_id = $1', [
          current,
        ]);
        const cancelled = await cancelShiftTypeVersion(client, { type: pending, from: scheduled });
        await actAsOwner(client);

        expect(past.rowCount, 'a past version was deleted').toBe(0);
        expect(inEffect.rowCount, 'a version in effect today was deleted').toBe(0);
        expect(whole.rowCount, 'versions in effect were deleted').toBe(0);
        expect(cancelled.rowCount, 'the scheduled version could not be cancelled').toBe(1);
        expect(await shiftTypeVersionsOf(client, pending)).toEqual(pendingBefore.slice(0, 1));
        expect(await shiftTypeVersionsOf(client, current)).toEqual(currentBefore);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture version at 24:00 or with seconds, in either time',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const type = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId);
        const today = await organizationDay(client, caller.organizationId);
        await actAs(client, caller.authUserId, caller.organizationId);

        for (const [start, end, constraint] of [
          ['24:00', '07:00', 'shift_type_versions_start_before_midnight'],
          ['07:00', '24:00', 'shift_type_versions_end_before_midnight'],
          ['07:00:30', '19:00', 'shift_type_versions_start_whole_minute'],
          ['07:00', '19:00:00.5', 'shift_type_versions_end_whole_minute'],
        ] as const) {
          const refusal = await refusedThenContinue(client, () =>
            insertShiftTypeVersion(client, { organization: caller.organizationId, type, start, end, from: today }),
          );
          expect(refusal.code, `${start}–${end} is not a check violation`).toBe('23514');
          expect(refusal.message, `${start}–${end} does not name ${constraint}`).toContain(constraint);
        }
        await actAsOwner(client);
        expect(await shiftTypeVersionsOf(client, type)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'updates no $fixture version, and lets no session name the attribution',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const type = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId);
        const today = await organizationDay(client, caller.organizationId);
        await actAs(client, caller.authUserId, caller.organizationId);

        const updated = await refusedThenContinue(client, () =>
          client.query("update shift_type_versions set start_time = '06:00' where organization_id = $1", [
            caller.organizationId,
          ]),
        );
        const forgedBy = await refusedThenContinue(client, () =>
          client.query(
            `insert into shift_type_versions
               (organization_id, shift_type_id, start_time, end_time, effective_from, created_by)
             values ($1, $2, '07:00', '19:00', $3::date, $4)`,
            [caller.organizationId, type, today, caller.authUserId],
          ),
        );
        const forgedAt = await refusedThenContinue(client, () =>
          client.query(
            `insert into shift_type_versions
               (organization_id, shift_type_id, start_time, end_time, effective_from, created_at)
             values ($1, $2, '07:00', '19:00', $3::date, now() - interval '1 year')`,
            [caller.organizationId, type, today],
          ),
        );
        await actAsOwner(client);

        expect(updated.code, 'a version is updatable').toBe('42501');
        expect(forgedBy.code, 'a session named its own created_by').toBe('42501');
        expect(forgedAt.code, 'a session named its own created_at').toBe('42501');
        expect(await shiftTypeVersionsOf(client, type)).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role session writing or cancelling a version',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const caller = await memberByUsername(client, slug, member);
        const type = await addThrowawayShiftType(client, caller.organizationId, owner.authUserId);
        const scheduled = await organizationDay(client, caller.organizationId, 3);
        await ownerShiftTypeVersion(client, {
          organization: caller.organizationId,
          type,
          start: '07:00',
          end: '19:00',
          from: scheduled,
          by: owner.authUserId,
        });
        const before = await organizationShiftTypeVersions(client, caller.organizationId);
        await actAs(client, caller.authUserId, caller.organizationId);

        const written = await refusedThenContinue(client, async () =>
          insertShiftTypeVersion(client, {
            organization: caller.organizationId,
            type: await seededShiftType(client, caller.organizationId, seededShiftTypesOf(slug)[0]!.name),
            start: '05:30',
            end: '17:30',
            from: await organizationDay(client, caller.organizationId),
          }),
        );
        const cancelled = await cancelShiftTypeVersion(client, { type, from: scheduled });
        const wiped = await client.query('delete from shift_type_versions');
        await actAsOwner(client);

        expect(written.code, 'a member-role version insert is refused by WITH CHECK').toBe('42501');
        expect(cancelled.rowCount, `a ${slug} member cancelled a scheduled version`).toBe(0);
        expect(wiped.rowCount, `a ${slug} member deleted a version`).toBe(0);
        expect(await organizationShiftTypeVersions(client, caller.organizationId)).toEqual(before);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'keeps $otherFixture shift types and versions out of reach of the $fixture admin',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const other = await organizationId(client, otherSlug);
        const otherAdmin = await memberByUsername(
          client,
          otherSlug,
          FIXTURES.find((entry) => entry.slug === otherSlug)!.admin,
        );
        const otherType = await seededShiftType(
          client,
          other,
          seededShiftTypesOf(otherSlug).find((type) => type.isWorking)!.name,
        );
        const scheduled = await organizationDay(client, other, 4);
        await ownerShiftTypeVersion(client, {
          organization: other,
          type: otherType,
          start: '05:30',
          end: '17:30',
          from: scheduled,
          by: otherAdmin.authUserId,
        });
        const typesBefore = await client.query(
          'select * from shift_types where organization_id = $1 order by id',
          [other],
        );
        const versionsBefore = await organizationShiftTypeVersions(client, other);
        const today = await organizationDay(client, caller.organizationId);
        await actAs(client, caller.authUserId, caller.organizationId);

        const readTypes = await client.query('select id from shift_types where organization_id = $1', [other]);
        const readVersions = await client.query(
          'select id from shift_type_versions where organization_id = $1',
          [other],
        );
        const renamed = await client.query(
          'update shift_types set name = name || $1 where organization_id = $2',
          [' hijacked', other],
        );
        const cancelled = await cancelShiftTypeVersion(client, { type: otherType, from: scheduled });
        const plantedType = await refusedThenContinue(client, () =>
          insertShiftType(client, other, `${THROWAWAY} planted`, true),
        );
        const plantedVersion = await refusedThenContinue(client, () =>
          insertShiftTypeVersion(client, {
            organization: other,
            type: otherType,
            start: '06:30',
            end: '18:30',
            from: today,
          }),
        );
        // Own tenant named, the other tenant's type: the composite key makes it
        // unrepresentable, and the policy refuses it first.
        const crossedVersion = await refusedThenContinue(client, () =>
          insertShiftTypeVersion(client, {
            organization: caller.organizationId,
            type: otherType,
            start: '06:30',
            end: '18:30',
            from: today,
          }),
        );
        await actAsOwner(client);

        expect(readTypes.rowCount, `a ${slug} admin read ${otherSlug} types`).toBe(0);
        expect(readVersions.rowCount, `a ${slug} admin read ${otherSlug} versions`).toBe(0);
        expect(renamed.rowCount, `a ${slug} admin renamed a ${otherSlug} type`).toBe(0);
        expect(cancelled.rowCount, `a ${slug} admin cancelled a ${otherSlug} version`).toBe(0);
        expect(plantedType.code).toBe('42501');
        expect(plantedVersion.code).toBe('42501');
        expect(crossedVersion.code).toBe('42501');
        expect(
          (await client.query('select * from shift_types where organization_id = $1 order by id', [other]))
            .rows,
        ).toEqual(typesBefore.rows);
        expect(await organizationShiftTypeVersions(client, other)).toEqual(versionsBefore);
      });
    },
  );

  it.skipIf(noDatabase)('refuses an anonymous session every verb on shift types and their versions', async () => {
    await inRolledBackTransaction(async (client) => {
      const own = await organizationId(client, FIXTURES[0].slug);
      const type = await seededShiftType(client, own, seededShiftTypesOf(FIXTURES[0].slug)[0]!.name);
      await client.query('set local role anon');

      const verbs = [
        () => client.query('select id from shift_types'),
        () => insertShiftType(client, own, `${THROWAWAY} anonymous`, true),
        () => client.query("update shift_types set name = 'x'"),
        () => client.query('delete from shift_types'),
        () => client.query('select id from shift_type_versions'),
        () =>
          insertShiftTypeVersion(client, {
            organization: own,
            type,
            start: '05:30',
            end: '17:30',
            from: '2999-01-01',
          }),
        () => client.query("update shift_type_versions set start_time = '06:00'"),
        () => client.query('delete from shift_type_versions'),
      ];
      for (const verb of verbs) {
        const refusal = await refusedThenContinue(client, verb);
        expect(refusal.code, 'anon holds a privilege on shift types or their versions').toBe('42501');
      }
    });
  });
});

describe('shift type names, archives and times hold across renames, schedules and many versions', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses renaming a $fixture type onto another active type name in any case and padding, and admits an archived one',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        await actAs(client, caller.authUserId, caller.organizationId);

        const taken = seededShiftTypesOf(slug)[0]!.name;
        const mover = await insertShiftType(client, caller.organizationId, `${THROWAWAY} mover`, true);
        const retired = await insertShiftType(client, caller.organizationId, `${THROWAWAY} retired`, true);
        await client.query('update shift_types set archived = true where id = $1', [retired]);

        const onto = await refusedThenContinue(client, () =>
          client.query('update shift_types set name = $1 where id = $2', [` ${taken.toUpperCase()} `, mover]),
        );
        const ontoArchived = await client.query('update shift_types set name = $1 where id = $2', [
          ` ${THROWAWAY.toUpperCase()} RETIRED `,
          mover,
        ]);
        await actAsOwner(client);

        expect(onto.code, 'a rename onto an active type name is not a unique violation').toBe('23505');
        expect(onto.message).toContain('shift_types_organization_name_key');
        expect(ontoArchived.rowCount, 'a rename onto an archived type name was refused').toBe(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses archiving a $fixture type with a change scheduled, and admits it once the change is cancelled',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const facts = { organization: caller.organizationId, by: caller.authUserId };
        const scheduled = await organizationDay(client, caller.organizationId, 4);
        const pending = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId);
        await ownerShiftTypeVersion(client, { ...facts, type: pending, start: '07:00', end: '19:00', from: SEEDED_EFFECTIVE_FROM });
        await ownerShiftTypeVersion(client, { ...facts, type: pending, start: '08:00', end: '20:00', from: scheduled });
        // A version in effect today, and none after, does not block the archive.
        const current = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId);
        await ownerShiftTypeVersion(client, {
          ...facts,
          type: current,
          start: '07:00',
          end: '19:00',
          from: await organizationDay(client, caller.organizationId),
        });
        await actAs(client, caller.authUserId, caller.organizationId);

        const refused = await refusedThenContinue(client, () =>
          client.query('update shift_types set archived = true where id = $1', [pending]),
        );
        const renamed = await client.query('update shift_types set name = $1 where id = $2', [
          `${THROWAWAY} renamed while scheduled`,
          pending,
        ]);
        const cancelled = await cancelShiftTypeVersion(client, { type: pending, from: scheduled });
        const archived = await client.query('update shift_types set archived = true where id = $1', [pending]);
        const archivedCurrent = await client.query('update shift_types set archived = true where id = $1', [
          current,
        ]);
        await actAsOwner(client);

        expect(refused.code, 'a type with a change scheduled was archived').toBe('42501');
        expect(renamed.rowCount, 'a rename of a type with a change scheduled was refused').toBe(1);
        expect(cancelled.rowCount).toBe(1);
        expect(archived.rowCount, 'the archive was refused after the cancellation').toBe(1);
        expect(archivedCurrent.rowCount, 'a version in effect blocked the archive').toBe(1);
        expect(await shiftTypeById(client, pending)).toMatchObject({ archived: true });
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'reads a $fixture type with two versions on every date, and compares a new version with the latest times only',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const today = await organizationDay(client, caller.organizationId);
        const yesterday = await organizationDay(client, caller.organizationId, -1);
        const facts = { organization: caller.organizationId, by: caller.authUserId };
        const [repeatLatest, repeatOlder] = [
          await addThrowawayShiftType(client, caller.organizationId, caller.authUserId),
          await addThrowawayShiftType(client, caller.organizationId, caller.authUserId),
        ];
        for (const type of [repeatLatest, repeatOlder]) {
          await ownerShiftTypeVersion(client, { ...facts, type, start: '19:00', end: '07:00', from: SEEDED_EFFECTIVE_FROM });
          await ownerShiftTypeVersion(client, { ...facts, type, start: '20:00', end: '08:00', from: today });
        }
        await actAs(client, caller.authUserId, caller.organizationId);

        const old = { startTime: '19:00:00', endTime: '07:00:00' };
        const current = { startTime: '20:00:00', endTime: '08:00:00' };
        expect(await shiftTimesOn(client, repeatLatest, '2019-12-31')).toBeNull();
        expect(await shiftTimesOn(client, repeatLatest, SEEDED_EFFECTIVE_FROM)).toEqual(old);
        expect(await shiftTimesOn(client, repeatLatest, yesterday)).toEqual(old);
        expect(await shiftTimesOn(client, repeatLatest, today)).toEqual(current);
        expect(await shiftTimesOn(client, repeatLatest, 'infinity')).toEqual(current);

        const future = await organizationDay(client, caller.organizationId, 3);
        const sameAsLatest = await refusedThenContinue(client, () =>
          insertShiftTypeVersion(client, { organization: caller.organizationId, type: repeatLatest, start: '20:00', end: '08:00', from: future }),
        );
        const backToOlder = await insertShiftTypeVersion(client, {
          organization: caller.organizationId,
          type: repeatOlder,
          start: '19:00',
          end: '07:00',
          from: future,
        });
        await actAsOwner(client);

        expect(sameAsLatest.code, 'a version repeating the latest times was admitted').toBe('42501');
        expect(backToOlder.rowCount, 'a version returning to older times was refused').toBe(1);
        expect(await shiftTypeVersionsOf(client, repeatLatest)).toHaveLength(2);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'cancels only the latest of two future $fixture versions',
    async ({ slug, admin }) => {
      // Two future versions are only reachable as the owner; the delete
      // policy's latest-only conjunct is what refuses the earlier one.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const facts = { organization: caller.organizationId, by: caller.authUserId };
        const [soon, later] = [
          await organizationDay(client, caller.organizationId, 3),
          await organizationDay(client, caller.organizationId, 5),
        ];
        const type = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId);
        await ownerShiftTypeVersion(client, { ...facts, type, start: '07:00', end: '19:00', from: soon });
        await ownerShiftTypeVersion(client, { ...facts, type, start: '08:00', end: '20:00', from: later });
        await actAs(client, caller.authUserId, caller.organizationId);

        const earlier = await cancelShiftTypeVersion(client, { type, from: soon });
        const latest = await cancelShiftTypeVersion(client, { type, from: later });
        await actAsOwner(client);

        expect(earlier.rowCount, 'a future version other than the latest was cancelled').toBe(0);
        expect(latest.rowCount, 'the latest future version could not be cancelled').toBe(1);
        expect((await shiftTypeVersionsOf(client, type)).map((row) => row.from)).toEqual([soon]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses one $fixture statement inserting two future versions of one type',
    async ({ slug, admin }) => {
      // The one-scheduled rule sees the statement's own earlier row, which is
      // what the VOLATILE readers are for: a STABLE one would admit both.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const type = await addThrowawayShiftType(client, caller.organizationId, caller.authUserId);
        const [first, second] = [
          await organizationDay(client, caller.organizationId, 2),
          await organizationDay(client, caller.organizationId, 4),
        ];
        await actAs(client, caller.authUserId, caller.organizationId);

        const refusal = await refusedThenContinue(client, () =>
          client.query(
            `insert into shift_type_versions
               (organization_id, shift_type_id, start_time, end_time, effective_from)
             values ($1, $2, '07:00', '19:00', $3::date),
                    ($1, $2, '08:00', '20:00', $4::date)`,
            [caller.organizationId, type, first, second],
          ),
        );
        await actAsOwner(client);

        expect(refusal.code, 'two scheduled versions in one statement were admitted').toBe('42501');
        expect(await shiftTypeVersionsOf(client, type)).toEqual([]);
      });
    },
  );
});

describe('a direct API call writes shift types and their times under exactly the same rules', () => {
  it.skipIf(noApi).each(FIXTURES)(
    'lets the $fixture admin create, rename and time a type, schedule and cancel a change, and archive it over PostgREST',
    async ({ slug, admin }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      let id: string | undefined;
      try {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const today = await organizationDay(client, own);
        const yesterday = await organizationDay(client, own, -1);
        const scheduled = await organizationDay(client, own, 6);
        const name = `${THROWAWAY} rest ${crypto.randomUUID()}`;

        const created = await rest('shift_types?select=id', {
          token,
          method: 'POST',
          body: { organization_id: own, name, is_working: true },
          prefer: 'return=representation',
        });
        expect(created.status, 'a permitted insert answers 201').toBe(201);
        const [row] = (await created.json()) as readonly { id: string }[];
        id = row?.id;
        if (id === undefined) throw new Error('a permitted shift type insert returned no row');

        const renamed = await rest(`shift_types?id=eq.${id}&select=id`, {
          token,
          method: 'PATCH',
          body: { name: `${name} renamed` },
          prefer: 'return=representation',
        });
        expect(await renamed.json(), 'the rename reached no row').toEqual([{ id }]);

        const timed = await rest('shift_type_versions', {
          token,
          method: 'POST',
          body: { organization_id: own, shift_type_id: id, start_time: '19:00', end_time: '07:00', effective_from: today },
        });
        expect(timed.status, 'the first times were refused').toBe(201);

        for (const [label, body] of [
          ['the same times', { start_time: '19:00', end_time: '07:00', effective_from: scheduled }],
          ['a backdated change', { start_time: '20:00', end_time: '08:00', effective_from: yesterday }],
        ] as const) {
          const response = await rest('shift_type_versions', {
            token,
            method: 'POST',
            body: { organization_id: own, shift_type_id: id, ...body },
          });
          expect(response.ok, `${label} was admitted`).toBe(false);
          expect((await restRefusal(response)).code, label).toBe('42501');
        }

        for (const [times, constraint] of [
          [{ start_time: '19:00', end_time: '24:00' }, 'shift_type_versions_end_before_midnight'],
          [{ start_time: '07:00:30', end_time: '19:00' }, 'shift_type_versions_start_whole_minute'],
        ] as const) {
          const outOfRange = await rest('shift_type_versions', {
            token,
            method: 'POST',
            body: { organization_id: own, shift_type_id: id, ...times, effective_from: scheduled },
          });
          const refusal = await restRefusal(outOfRange);
          expect(outOfRange.ok, `${JSON.stringify(times)} was admitted`).toBe(false);
          expect(refusal.code, `${JSON.stringify(times)} is not a check violation`).toBe('23514');
          expect(refusal.message).toContain(constraint);
        }

        const change = await rest('shift_type_versions', {
          token,
          method: 'POST',
          body: { organization_id: own, shift_type_id: id, start_time: '20:00', end_time: '08:00', effective_from: scheduled },
        });
        expect(change.status, 'a scheduled change was refused').toBe(201);
        const archivedEarly = await rest(`shift_types?id=eq.${id}`, {
          token,
          method: 'PATCH',
          body: { archived: true },
        });
        expect(archivedEarly.ok, 'a type with a change scheduled was archived').toBe(false);
        expect((await restRefusal(archivedEarly)).code).toBe('42501');
        const second = await rest('shift_type_versions', {
          token,
          method: 'POST',
          body: { organization_id: own, shift_type_id: id, start_time: '21:00', end_time: '09:00', effective_from: await organizationDay(client, own, 9) },
        });
        expect(second.ok, 'a second scheduled change was admitted').toBe(false);
        expect((await restRefusal(second)).code).toBe('42501');

        const pastCancel = await rest(
          `shift_type_versions?shift_type_id=eq.${id}&effective_from=eq.${today}&select=id`,
          { token, method: 'DELETE', prefer: 'return=representation' },
        );
        expect(await pastCancel.json(), 'a version in effect was cancelled').toEqual([]);
        const cancel = await rest(
          `shift_type_versions?shift_type_id=eq.${id}&effective_from=eq.${scheduled}&select=effective_from`,
          { token, method: 'DELETE', prefer: 'return=representation' },
        );
        expect(await cancel.json(), 'the scheduled change was not cancelled').toEqual([
          { effective_from: scheduled },
        ]);

        const flipped = await rest(`shift_types?id=eq.${id}`, {
          token,
          method: 'PATCH',
          body: { is_working: false },
        });
        expect(flipped.ok, 'is_working was flipped').toBe(false);
        expect((await restRefusal(flipped)).code).toBe('42501');
        const removed = await rest(`shift_types?id=eq.${id}`, { token, method: 'DELETE' });
        expect(removed.ok, 'a type was deleted').toBe(false);
        expect((await restRefusal(removed)).code).toBe('42501');

        const archived = await rest(`shift_types?id=eq.${id}&select=archived`, {
          token,
          method: 'PATCH',
          body: { archived: true },
          prefer: 'return=representation',
        });
        expect(await archived.json()).toEqual([{ archived: true }]);

        expect(await shiftTypeById(client, id)).toEqual({
          organizationId: own,
          id,
          name: `${name} renamed`,
          isWorking: true,
          archived: true,
          createdBy: caller.authUserId,
        });
        expect(await shiftTypeVersionsOf(client, id)).toMatchObject([
          { startTime: '19:00:00', endTime: '07:00:00', from: today, createdBy: caller.authUserId },
        ]);
      } finally {
        if (id !== undefined) {
          await client.query('delete from shift_type_versions where shift_type_id = $1', [id]);
          await client.query('delete from shift_types where id = $1', [id]);
        }
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture member-role token writing a type or a version over PostgREST',
    async ({ slug, member }) => {
      const token = await tokenFor(member, slug);
      const client = await connect();
      let type: string | undefined;
      try {
        const own = await organizationId(client, slug);
        const owner = await memberByUsername(client, slug, FIXTURES.find((f) => f.slug === slug)!.admin);
        // A committed throwaway type, so every write below aims at a row this
        // test owns: a PATCH that wrongly succeeded could otherwise rename
        // seeded types into the THROWAWAY prefix, which `afterAll` then deletes.
        await client.query('begin');
        type = await addThrowawayShiftType(client, own, owner.authUserId);
        await client.query('commit');
        const typesBefore = (await client.query('select * from shift_types where organization_id = $1 order by id', [own])).rows;
        const versionsBefore = await organizationShiftTypeVersions(client, own);

        const created = await rest('shift_types', {
          token,
          method: 'POST',
          body: { organization_id: own, name: `${THROWAWAY} by a member`, is_working: true },
        });
        const renamed = await rest(`shift_types?id=eq.${type}&select=id`, {
          token,
          method: 'PATCH',
          body: { name: `${THROWAWAY} by a member` },
          prefer: 'return=representation',
        });
        const timed = await rest('shift_type_versions', {
          token,
          method: 'POST',
          body: {
            organization_id: own,
            shift_type_id: type,
            start_time: '05:30',
            end_time: '17:30',
            effective_from: await organizationDay(client, own),
          },
        });
        const cancelled = await rest(`shift_type_versions?shift_type_id=eq.${type}&select=id`, {
          token,
          method: 'DELETE',
          prefer: 'return=representation',
        });

        expect(created.ok, 'a member-role account created a type').toBe(false);
        expect((await restRefusal(created)).code).toBe('42501');
        expect(await renamed.json(), 'a member-role account renamed a type').toEqual([]);
        expect(timed.ok, 'a member-role account wrote a version').toBe(false);
        expect((await restRefusal(timed)).code).toBe('42501');
        expect(await cancelled.json(), 'a member-role account deleted a version').toEqual([]);
        expect(
          (await client.query('select * from shift_types where organization_id = $1 order by id', [own])).rows,
        ).toEqual(typesBefore);
        expect(await organizationShiftTypeVersions(client, own)).toEqual(versionsBefore);
      } finally {
        // Only the rows this test made, or a policy that failed to refuse made:
        // its own throwaway type, and a type created under the member's name.
        await client.query(
          `delete from shift_type_versions
            where shift_type_id = $1
               or shift_type_id in (select id from shift_types where name like $2)`,
          [type ?? null, `${THROWAWAY} by a member%`],
        );
        if (type !== undefined) await client.query('delete from shift_types where id = $1', [type]);
        await client.query('delete from shift_types where name like $1', [`${THROWAWAY} by a member%`]);
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(['shift_types', 'shift_type_versions'] as const)(
    'refuses an anonymous caller any %s row',
    async (table) => {
      const response = await rest(`${table}?select=*`);
      const refusal = await restRefusal(response);

      expect(response.status, `an anonymous caller read ${table}`).toBe(401);
      expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
    },
  );
});

// ================================================================= STORY 2.3a

/**
 * Story 2.3a — a rotation is stored as an immutable pattern of ordered steps
 * and versioned team assignments (`0016_rotation.sql`), and projected by
 * `packages/domain`. The assignment rules are `0010`'s, unchanged; the offset
 * is a key to a step of the same pattern, so an empty pattern or an offset
 * outside the cycle cannot be stored.
 *
 * Every SQL case below runs in a rolled-back transaction. The REST cases
 * commit on a throwaway team and a throwaway shift type only, never on seeded
 * rows, and delete their own rows in `finally` (assignments, then steps, then
 * the pattern — no key cascades); `afterAll` is the backstop.
 */
interface SeededRotation {
  readonly admin: string;
  readonly teams: readonly string[];
  /** The one pattern's steps by position, each as its shift type's name. */
  readonly steps: readonly { readonly position: number; readonly shiftType: string }[];
  /** Each team's one version, its offset as the step's position. */
  readonly assignments: readonly {
    readonly team: string;
    readonly offsetPosition: number;
    readonly anchor: string;
    readonly from: string;
  }[];
  /** The domain fixture, for projecting the seeded rows against. */
  readonly domain: {
    readonly teams: readonly FixtureTeam[];
    readonly types: readonly ShiftType[];
    readonly steps: readonly RotationStep[];
    readonly assignments: readonly RotationAssignment[];
  };
}

/**
 * What `supabase/seed.sql` gives each fixture.
 *
 * DERIVED FROM THE DOMAIN FIXTURES, as the bands and types are: the teams,
 * steps and assignments `packages/domain` asserts its projection against are
 * the one source of truth, so a seed that drifts from them fails here.
 */
const SEEDED_ROTATIONS: Readonly<Record<string, SeededRotation>> = Object.fromEntries(
  (
    [
      [
        'dvd-kastel-novi',
        'ivan.maric',
        PILOT_TEAMS,
        PILOT_SHIFT_TYPES,
        PILOT_ROTATION_STEPS,
        PILOT_ROTATION_ASSIGNMENTS,
      ],
      ['zastita-split', 'josip.peric', UJ5_TEAMS, UJ5_SHIFT_TYPES, UJ5_ROTATION_STEPS, UJ5_ROTATION_ASSIGNMENTS],
    ] as const
  ).map(([slug, admin, teams, types, steps, assignments]) => {
    const typeName = (id: string) => types.find((type) => type.id === id)?.name ?? `<${id}>`;
    const teamName = (id: string) => teams.find((team) => team.id === id)?.name ?? `<${id}>`;
    const stepPosition = (id: string) => steps.find((step) => step.id === id)?.position ?? -1;
    return [
      slug,
      {
        admin,
        teams: teams.map((team) => team.name),
        steps: [...steps]
          .sort((a, b) => a.position - b.position)
          .map((step) => ({ position: step.position, shiftType: typeName(step.shiftTypeId) })),
        assignments: assignments.map((assignment) => ({
          team: teamName(assignment.teamId),
          offsetPosition: stepPosition(assignment.offsetStepId),
          anchor: assignment.anchorDate,
          from: assignment.effectiveFrom,
        })),
        domain: { teams, types, steps, assignments },
      },
    ];
  }),
);

function seededRotationOf(slug: string): SeededRotation {
  const seeded = SEEDED_ROTATIONS[slug];
  if (seeded === undefined) throw new Error(`no seeded rotation is recorded for ${slug}`);
  return seeded;
}

interface RotationRead {
  readonly teams: readonly { organizationId: string; id: string; name: string }[];
  readonly patterns: readonly { organizationId: string; id: string }[];
  readonly steps: readonly {
    organizationId: string;
    id: string;
    patternId: string;
    position: number;
    shiftTypeId: string;
    shiftType: string;
  }[];
  readonly assignments: readonly {
    organizationId: string;
    teamId: string;
    patternId: string;
    offsetStepId: string;
    anchorDate: string;
    effectiveFrom: string;
  }[];
}

/**
 * Everything a rotation is, read as whoever the connection currently is. The
 * teams exclude this file's throwaway ones: the read cases above commit one
 * per fixture, and `afterAll` removes them.
 */
async function readRotation(client: Client): Promise<RotationRead> {
  const { rows: teams } = await client.query<RotationRead['teams'][number]>(
    `select organization_id as "organizationId", id, name from teams
      where name not like $1 order by created_at, name`,
    [`${THROWAWAY}%`],
  );
  const { rows: patterns } = await client.query<RotationRead['patterns'][number]>(
    `select organization_id as "organizationId", id from rotation_patterns order by created_at`,
  );
  const { rows: steps } = await client.query<RotationRead['steps'][number]>(
    `select s.organization_id as "organizationId", s.id, s.pattern_id as "patternId", s.position,
            s.shift_type_id as "shiftTypeId", t.name as "shiftType"
       from rotation_steps s join shift_types t on t.id = s.shift_type_id
      order by s.pattern_id, s.position`,
  );
  const { rows: assignments } = await client.query<RotationRead['assignments'][number]>(
    `select organization_id as "organizationId", team_id as "teamId", pattern_id as "patternId",
            offset_step_id as "offsetStepId", anchor_date::text as "anchorDate",
            effective_from::text as "effectiveFrom"
       from rotation_assignments order by created_at, team_id`,
  );
  return { teams, patterns, steps, assignments };
}

/** A seeded team of one organization found by name, as the owner. */
async function seededTeam(client: Client, organization: string, name: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'select id from teams where organization_id = $1 and name = $2',
    [organization, name],
  );
  const found = rows[0];
  if (found === undefined) throw new Error(`no seeded team ${name}`);
  return found.id;
}

/** An organization's one seeded pattern and its steps by position, as the owner. */
async function seededPattern(
  client: Client,
  organization: string,
): Promise<{ readonly id: string; readonly steps: readonly string[] }> {
  const { rows } = await client.query<{ patternId: string; stepId: string }>(
    `select s.pattern_id as "patternId", s.id as "stepId"
       from rotation_steps s
      where s.organization_id = $1
        and s.pattern_id in (select pattern_id from rotation_assignments where organization_id = $1)
      order by s.position`,
    [organization],
  );
  const id = rows[0]?.patternId;
  if (id === undefined || rows.some((row) => row.patternId !== id)) {
    throw new Error(`${organization} does not have exactly one seeded pattern`);
  }
  return { id, steps: rows.map((row) => row.stepId) };
}

/** Insert one pattern as the current session, returning its id. */
async function insertPattern(client: Client, organization: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'insert into rotation_patterns (organization_id) values ($1) returning id',
    [organization],
  );
  const pattern = rows[0];
  if (pattern === undefined) throw new Error('rotation_patterns insert returned no row');
  return pattern.id;
}

/** All of a pattern's steps in ONE insert, as the current session, by position. */
async function insertSteps(
  client: Client,
  organization: string,
  pattern: string,
  shiftTypes: readonly string[],
  positions: readonly number[] = shiftTypes.map((_type, index) => index),
): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `insert into rotation_steps (organization_id, pattern_id, position, shift_type_id)
     select $1, $2, step.position, step.shift_type_id
       from unnest($3::int[], $4::uuid[]) with ordinality as step (position, shift_type_id, ordinal)
      order by step.ordinal
     returning id`,
    [organization, pattern, positions, shiftTypes],
  );
  return rows.map((row) => row.id);
}

/** A pattern and its steps written as the OWNER — the state a case starts from. */
async function ownerPattern(
  client: Client,
  organization: string,
  by: string,
  shiftTypes: readonly string[],
): Promise<{ readonly id: string; readonly steps: readonly string[] }> {
  const { rows } = await client.query<{ id: string }>(
    'insert into rotation_patterns (organization_id, created_by) values ($1, $2) returning id',
    [organization, by],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('rotation_patterns insert returned no row');
  const { rows: steps } = await client.query<{ id: string }>(
    `insert into rotation_steps (organization_id, pattern_id, position, shift_type_id, created_by)
     select $1, $2, (step.ordinal - 1)::int, step.shift_type_id, $4
       from unnest($3::uuid[]) with ordinality as step (shift_type_id, ordinal)
      order by step.ordinal
     returning id`,
    [organization, id, shiftTypes, by],
  );
  return { id, steps: steps.map((step) => step.id) };
}

interface AssignmentFacts {
  readonly organization: string;
  readonly team: string;
  readonly pattern: string;
  readonly offsetStep: string | null;
  readonly anchor: string;
  readonly from: string;
}

/** One version, as whoever the connection currently is: the six columns a
 *  session may name, and nothing else. */
async function insertAssignment(client: Client, facts: AssignmentFacts): Promise<{ rowCount: number | null }> {
  return client.query(
    `insert into rotation_assignments
       (organization_id, team_id, pattern_id, offset_step_id, anchor_date, effective_from)
     values ($1, $2, $3, $4, $5::date, $6::date)`,
    [facts.organization, facts.team, facts.pattern, facts.offsetStep, facts.anchor, facts.from],
  );
}

/** One version written as the OWNER, past every policy. */
async function ownerAssignment(client: Client, facts: AssignmentFacts & { readonly by: string }): Promise<void> {
  await client.query(
    `insert into rotation_assignments
       (organization_id, team_id, pattern_id, offset_step_id, anchor_date, effective_from, created_by)
     values ($1, $2, $3, $4, $5::date, $6::date, $7)`,
    [facts.organization, facts.team, facts.pattern, facts.offsetStep, facts.anchor, facts.from, facts.by],
  );
}

/** The cancellation a surface would send, as whoever the connection is. */
async function cancelAssignment(
  client: Client,
  version: { team: string; from: string },
): Promise<{ rowCount: number | null }> {
  return client.query('delete from rotation_assignments where team_id = $1 and effective_from = $2::date', [
    version.team,
    version.from,
  ]);
}

/** `rotation_assignment_on`, the one SQL reading, as whoever the connection is. */
async function rotationOn(
  client: Client,
  team: string,
  day: string,
): Promise<{ patternId: string; offsetStepId: string; anchorDate: string } | null> {
  const { rows } = await client.query<{ patternId: string; offsetStepId: string; anchorDate: string }>(
    `select pattern_id as "patternId", offset_step_id as "offsetStepId", anchor_date::text as "anchorDate"
       from public.rotation_assignment_on($1, $2::date)`,
    [team, day],
  );
  return rows[0] ?? null;
}

/** Every assignment version of one team, oldest first, as the owner. */
async function assignmentsOf(
  client: Client,
  team: string,
): Promise<{ patternId: string; offsetStepId: string; anchor: string; from: string; createdBy: string }[]> {
  const { rows } = await client.query<{
    patternId: string;
    offsetStepId: string;
    anchor: string;
    from: string;
    createdBy: string;
  }>(
    `select pattern_id as "patternId", offset_step_id as "offsetStepId", anchor_date::text as anchor,
            effective_from::text as "from", created_by as "createdBy"
       from rotation_assignments where team_id = $1 order by effective_from`,
    [team],
  );
  return rows;
}

/** The ids of an organization's seeded shift types, by name, as the owner. */
async function shiftTypeIdsByName(client: Client, organization: string): Promise<Map<string, string>> {
  const { rows } = await client.query<{ id: string; name: string }>(
    'select id, name from shift_types where organization_id = $1',
    [organization],
  );
  return new Map(rows.map((row) => [row.name, row.id]));
}

/** An organization's seeded working and non-working type ids, as the owner. */
async function seededTypeIds(client: Client, slug: string, organization: string): Promise<string[]> {
  const byName = await shiftTypeIdsByName(client, organization);
  return seededRotationOf(slug).domain.types.map((type) => {
    const id = byName.get(type.name);
    if (id === undefined) throw new Error(`no seeded shift type ${type.name}`);
    return id;
  });
}

describe('each organization holds exactly its own seeded teams and rotation, and it projects', () => {
  it('records the rotation both fixtures are seeded with', () => {
    expect(Object.keys(SEEDED_ROTATIONS).sort()).toEqual(FIXTURES.map((f) => f.slug).sort());
    expect(SEEDED_ANCHOR_DATE).toBe('2020-01-01');
    expect(seededRotationOf('dvd-kastel-novi').steps.map((step) => step.shiftType)).toEqual([
      'Dan',
      'Noć',
      'Slobodno',
      'Slobodno',
    ]);
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    'shows the $fixture admin and member-role session exactly its own teams, pattern, steps and assignments',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const own = await organizationId(client, slug);
        const seeded = seededRotationOf(slug);

        for (const username of [admin, member]) {
          const caller = await memberByUsername(client, slug, username);
          await actAs(client, caller.authUserId, caller.organizationId);
          const read = await readRotation(client);
          await actAsOwner(client);

          const label = `${slug}/${username}`;
          const organizations = new Set([
            ...read.teams.map((row) => row.organizationId),
            ...read.patterns.map((row) => row.organizationId),
            ...read.steps.map((row) => row.organizationId),
            ...read.assignments.map((row) => row.organizationId),
          ]);
          expect([...organizations], `${label} read another organization's rotation`).toEqual([own]);
          expect(read.teams.map((team) => team.name), `${label} teams`).toEqual(seeded.teams);
          expect(read.patterns, `${label} does not read exactly one pattern`).toHaveLength(1);
          expect(
            read.steps.map(({ position, shiftType }) => ({ position, shiftType })),
            `${label} steps`,
          ).toEqual(seeded.steps);
          const teamName = new Map(read.teams.map((team) => [team.id, team.name]));
          const stepPosition = new Map(read.steps.map((step) => [step.id, step.position]));
          expect(
            read.assignments.map((assignment) => ({
              team: teamName.get(assignment.teamId),
              offsetPosition: stepPosition.get(assignment.offsetStepId),
              anchor: assignment.anchorDate,
              from: assignment.effectiveFrom,
            })),
            `${label} assignments`,
          ).toEqual(seeded.assignments);
          expect(
            read.assignments.filter((assignment) => assignment.patternId !== read.patterns[0]?.id),
            `${label} has an assignment on another pattern`,
          ).toEqual([]);
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'projects the seeded $fixture rotation through @shift/domain exactly as the domain fixtures project',
    async ({ slug, member }) => {
      await inRolledBackTransaction(async (client) => {
        const seeded = seededRotationOf(slug);
        const caller = await memberByUsername(client, slug, member);
        await actAs(client, caller.authUserId, caller.organizationId);
        const read = await readRotation(client);
        await actAsOwner(client);

        // The rows as the domain takes them: ids are the database's own.
        const steps: RotationStep[] = read.steps.map((step) => ({
          id: step.id,
          patternId: step.patternId,
          position: step.position,
          shiftTypeId: step.shiftTypeId,
        }));
        const typeName = new Map(read.steps.map((step) => [step.shiftTypeId, step.shiftType]));
        const fixtureTypeName = new Map(seeded.domain.types.map((type) => [type.id, type.name]));

        const days: string[] = [];
        for (const from of ['1999-12-01', '2019-12-20', '2026-09-01', '2100-02-20']) {
          for (let offset = 0; offset < 12; offset += 1) {
            const { rows } = await client.query<{ day: string }>('select ($1::date + $2::int)::text as day', [
              from,
              offset,
            ]);
            days.push(rows[0]!.day);
          }
        }

        for (const team of read.teams) {
          const versions: RotationAssignment[] = read.assignments
            .filter((assignment) => assignment.teamId === team.id)
            .map((assignment) => ({
              teamId: assignment.teamId,
              patternId: assignment.patternId,
              offsetStepId: assignment.offsetStepId,
              anchorDate: assignment.anchorDate,
              effectiveFrom: assignment.effectiveFrom,
            }));
          const fixtureTeam = seeded.domain.teams.find((candidate) => candidate.name === team.name);
          if (fixtureTeam === undefined) throw new Error(`no fixture team ${team.name}`);
          const fixtureVersions = seeded.domain.assignments.filter((a) => a.teamId === fixtureTeam.id);

          for (const day of days) {
            const fromSeed = projectedShiftTypeOn(versions, steps, day);
            const fromFixture = projectedShiftTypeOn(fixtureVersions, seeded.domain.steps, day);
            expect(
              fromSeed === null ? null : typeName.get(fromSeed),
              `${slug} ${team.name} on ${day}`,
            ).toBe(fromFixture === null ? null : fixtureTypeName.get(fromFixture));
          }
          // Before the first version: nothing, never invented.
          expect(projectedShiftTypeOn(versions, steps, '2019-12-31'), `${team.name} before 2020`).toBeNull();
        }

        if (slug === 'dvd-kastel-novi') {
          // Engine rules §1, from the database's own rows.
          const grid = ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04'].map((day) =>
            read.teams.map((team) => {
              const versions = read.assignments.filter((assignment) => assignment.teamId === team.id);
              const projected = projectedShiftTypeOn(versions, steps, day);
              return projected === null ? null : typeName.get(projected);
            }),
          );
          expect(read.teams.map((team) => team.name)).toEqual(['Smjena A', 'Smjena B', 'Smjena C', 'Smjena D']);
          expect(grid).toEqual([
            ['Dan', 'Noć', 'Slobodno', 'Slobodno'],
            ['Noć', 'Slobodno', 'Slobodno', 'Dan'],
            ['Slobodno', 'Slobodno', 'Dan', 'Noć'],
            ['Slobodno', 'Dan', 'Noć', 'Slobodno'],
          ]);
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'attributes every seeded $fixture team and rotation row to its own admin, in strictly ascending creation',
    async ({ slug }) => {
      await inRolledBackTransaction(async (client) => {
        const seeded = seededRotationOf(slug);
        const owner = await memberByUsername(client, slug, seeded.admin);

        const { rows } = await client.query<{ table: string; createdBy: string; ties: number; rows: number }>(
          `select 'rotation_assignments' as table, created_by as "createdBy",
                  (count(*) - count(distinct created_at))::int as ties, count(*)::int as rows
             from rotation_assignments where organization_id = $1 group by created_by
           union all
           select 'rotation_patterns', created_by, (count(*) - count(distinct created_at))::int, count(*)::int
             from rotation_patterns where organization_id = $1 group by created_by
           union all
           select 'rotation_steps', created_by, (count(*) - count(distinct created_at))::int, count(*)::int
             from rotation_steps where organization_id = $1 group by created_by
           union all
           select 'teams', created_by, (count(*) - count(distinct created_at))::int, count(*)::int
             from teams where organization_id = $1 and name not like $2 group by created_by
           order by 1`,
          [owner.organizationId, `${THROWAWAY}%`],
        );
        expect(rows, `${slug} seed attribution is not its admin alone`).toEqual([
          { table: 'rotation_assignments', createdBy: owner.authUserId, ties: 0, rows: seeded.teams.length },
          { table: 'rotation_patterns', createdBy: owner.authUserId, ties: 0, rows: 1 },
          { table: 'rotation_steps', createdBy: owner.authUserId, ties: 0, rows: seeded.steps.length },
          { table: 'teams', createdBy: owner.authUserId, ties: 0, rows: seeded.teams.length },
        ]);

        // The seed places no member on a team (human decision 2026-09-25).
        // Scoped to the seeded members: the read cases above commit throwaway
        // memberships of this file's own members, which `afterAll` removes.
        const { rows: memberships } = await client.query<{ total: number }>(
          `select count(*)::int as total
             from team_membership_versions v
             join members m on m.id = v.member_id
             join auth.users u on u.id = m.auth_user_id
            where v.organization_id = $1 and u.email not like $2`,
          [owner.organizationId, `%@${THROWAWAY}.shift.invalid`],
        );
        expect(memberships[0]?.total, `${slug} seeds a membership`).toBe(0);
      });
    },
  );
});

describe('an admin saves a rotation: a pattern, its steps, then the assignments', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'lets the $fixture admin save a new pattern and bind every team to it from today, attributed to the caller',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const today = await organizationDay(client, own);
        const yesterday = await organizationDay(client, own, -1);
        const types = await seededTypeIds(client, slug, own);
        const teams = await Promise.all(
          seededRotationOf(slug).teams.map((name) => seededTeam(client, own, name)),
        );
        const before = await Promise.all(teams.map((team) => rotationOn(client, team, yesterday)));
        await actAs(client, caller.authUserId, own);

        // Any length; a type repeated; the anchor in the past.
        const pattern = await insertPattern(client, own);
        const steps = await insertSteps(client, own, pattern, [types[0]!, types[0]!, types.at(-1)!, types[1]!, types.at(-1)!]);
        const written = await client.query(
          `insert into rotation_assignments
             (organization_id, team_id, pattern_id, offset_step_id, anchor_date, effective_from)
           select $1, team.id, $2, step.id, date '2021-06-15', $3::date
             from unnest($4::uuid[], $5::uuid[]) as pair (team_id, step_id)
             join teams team on team.id = pair.team_id
             join rotation_steps step on step.id = pair.step_id`,
          [own, pattern, today, teams, teams.map((_team, index) => steps[index % steps.length]!)],
        );
        const after = await Promise.all(teams.map((team) => rotationOn(client, team, today)));
        const earlier = await Promise.all(teams.map((team) => rotationOn(client, team, yesterday)));
        await actAsOwner(client);

        expect(steps, 'the bulk step insert did not write every step').toHaveLength(5);
        expect(written.rowCount, 'the bulk assignment insert did not bind every team').toBe(teams.length);
        expect(after.map((row) => row?.patternId)).toEqual(teams.map(() => pattern));
        expect(after.map((row) => row?.anchorDate)).toEqual(teams.map(() => '2021-06-15'));
        expect(earlier, 'a change from today rewrote yesterday').toEqual(before);
        for (const team of teams) {
          const versions = await assignmentsOf(client, team);
          expect(versions.at(-1), 'the new version is not attributed to the caller').toMatchObject({
            from: today,
            createdBy: caller.authUserId,
          });
        }
        const { rows } = await client.query<{ createdBy: string }>(
          `select created_by as "createdBy" from rotation_patterns where id = $1
           union all select created_by from rotation_steps where pattern_id = $1`,
          [pattern],
        );
        expect(new Set(rows.map((row) => row.createdBy))).toEqual(new Set([caller.authUserId]));
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'stores no $fixture offset on an empty pattern, and none outside its own pattern',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const today = await organizationDay(client, own);
        const team = await seededTeam(client, own, seededRotationOf(slug).teams[0]!);
        const seeded = await seededPattern(client, own);
        const types = await seededTypeIds(client, slug, own);
        await actAs(client, caller.authUserId, own);

        const empty = await insertPattern(client, own);
        const other = await insertPattern(client, own);
        const [otherStep] = await insertSteps(client, own, other, [types[0]!]);
        const facts = { organization: own, team, pattern: empty, anchor: today, from: today };

        const noOffset = await refusedThenContinue(client, () => insertAssignment(client, { ...facts, offsetStep: null }));
        const foreignStep = await refusedThenContinue(client, () =>
          insertAssignment(client, { ...facts, offsetStep: otherStep! }),
        );
        const seededStep = await refusedThenContinue(client, () =>
          insertAssignment(client, { ...facts, offsetStep: seeded.steps[0]! }),
        );
        const invented = await refusedThenContinue(client, () =>
          insertAssignment(client, { ...facts, offsetStep: crypto.randomUUID() }),
        );
        // Outside the cycle of a pattern that HAS steps: another pattern's step.
        const outside = await refusedThenContinue(client, () =>
          insertAssignment(client, { ...facts, pattern: seeded.id, offsetStep: otherStep! }),
        );
        await actAsOwner(client);

        expect(noOffset.code, 'a null offset is not a not-null violation').toBe('23502');
        expect(noOffset.message).toContain('offset_step_id');
        for (const [label, refusal] of [
          ['a step of another pattern on an empty one', foreignStep],
          ['a seeded step on an empty pattern', seededStep],
          ['a step that does not exist', invented],
          ['a step outside the seeded pattern', outside],
        ] as const) {
          expect(refusal.code, `${label} is not a foreign key violation`).toBe('23503');
          expect(refusal.message, label).toContain('rotation_assignments_offset_step_fkey');
        }
        expect(await assignmentsOf(client, team), 'a refused offset was written').toHaveLength(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture step on a pattern a team stands on, on an archived or foreign type, or at a taken or negative position',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const other = FIXTURES.find((entry) => entry.slug !== slug)!;
        const otherOrganization = await organizationId(client, other.slug);
        const seeded = await seededPattern(client, own);
        const types = await seededTypeIds(client, slug, own);
        const foreignTypes = await seededTypeIds(client, other.slug, otherOrganization);
        const archivedType = await addThrowawayShiftType(client, own, caller.authUserId, { archived: true });
        const team = await addThrowawayTeam(client, own, caller.authUserId);
        const today = await organizationDay(client, own);
        await actAs(client, caller.authUserId, own);

        const inUse = await refusedThenContinue(client, () =>
          insertSteps(client, own, seeded.id, [types[0]!], [99]),
        );
        // A fresh pattern stays open until its first assignment, then closes.
        const fresh = await insertPattern(client, own);
        const [first] = await insertSteps(client, own, fresh, [types[0]!]);
        const second = await insertSteps(client, own, fresh, [types[1]!], [1]);
        await insertAssignment(client, {
          organization: own,
          team: team.id,
          pattern: fresh,
          offsetStep: first!,
          anchor: today,
          from: today,
        });
        const closed = await refusedThenContinue(client, () => insertSteps(client, own, fresh, [types[0]!], [2]));

        const open = await insertPattern(client, own);
        const archived = await refusedThenContinue(client, () => insertSteps(client, own, open, [archivedType]));
        const foreign = await refusedThenContinue(client, () => insertSteps(client, own, open, [foreignTypes[0]!]));
        await insertSteps(client, own, open, [types[0]!], [4]);
        const taken = await refusedThenContinue(client, () => insertSteps(client, own, open, [types[1]!], [4]));
        const twice = await refusedThenContinue(client, () =>
          insertSteps(client, own, open, [types[0]!, types[1]!], [7, 7]),
        );
        const negative = await refusedThenContinue(client, () => insertSteps(client, own, open, [types[0]!], [-1]));
        // Gaps are harmless.
        const gapped = await insertSteps(client, own, open, [types[1]!], [40]);
        await actAsOwner(client);

        expect(second, 'a second step before any assignment was refused').toHaveLength(1);
        expect(inUse.code, 'a step was added to the seeded pattern teams stand on').toBe('42501');
        expect(closed.code, 'a step was added once an assignment named the pattern').toBe('42501');
        expect(archived.code, 'a step names an archived type').toBe('42501');
        expect(foreign.code, 'a step names another tenant type').toBe('23503');
        expect(foreign.message).toContain('rotation_steps_shift_type_fkey');
        expect(taken.code, 'two steps share a position').toBe('23505');
        expect(taken.message).toContain('rotation_steps_pattern_id_position_key');
        expect(twice.code, 'one insert put two steps at one position').toBe('23505');
        expect(negative.code, 'a negative position is not a check violation').toBe('23514');
        expect(negative.message).toContain('rotation_steps_position_not_negative');
        expect(gapped, 'a gap in positions was refused').toHaveLength(1);
        const { rows } = await client.query<{ total: number }>(
          'select count(*)::int as total from rotation_steps where pattern_id = $1',
          [seeded.id],
        );
        expect(rows[0]?.total, 'the seeded pattern gained a step').toBe(seededRotationOf(slug).steps.length);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'refuses a $fixture step under its own tenant naming the $otherFixture pattern, on the pattern key',
    async ({ slug, admin, otherSlug }) => {
      // SMUGGLING: the row's tenant is the caller's own, so every policy
      // conjunct passes; the other fixture's pattern is named inside it. The
      // composite key (organization_id, pattern_id) is what refuses it —
      // 23503, not a 42501 a tenant check would give.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const types = await seededTypeIds(client, slug, own);
        const other = await organizationId(client, otherSlug);
        const otherAdmin = await memberByUsername(client, otherSlug, seededRotationOf(otherSlug).admin);
        // A pattern no team stands on, so "not in use" passes too.
        const otherOpen = await ownerPattern(client, other, otherAdmin.authUserId, []);
        const otherSeeded = await seededPattern(client, other);
        await actAs(client, caller.authUserId, own);

        const onOpen = await refusedThenContinue(client, () => insertSteps(client, own, otherOpen.id, [types[0]!], [0]));
        const onSeeded = await refusedThenContinue(client, () =>
          insertSteps(client, own, otherSeeded.id, [types[0]!], [60]),
        );
        await actAsOwner(client);

        expect(onOpen.code, 'a step smuggled onto another tenant pattern is not a key violation').toBe('23503');
        expect(onOpen.message).toContain('rotation_steps_pattern_fkey');
        // On a pattern in use the in-use conjunct reads no row (the session
        // cannot see the other tenant's assignments), so the key refuses it too.
        expect(onSeeded.code).toBe('23503');
        expect(onSeeded.message).toContain('rotation_steps_pattern_fkey');
        const { rows } = await client.query<{ total: number }>(
          'select count(*)::int as total from rotation_steps where pattern_id = any($1::uuid[])',
          [[otherOpen.id, otherSeeded.id]],
        );
        expect(rows[0]?.total).toBe(seededRotationOf(otherSlug).steps.length);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'stores no $fixture anchor or effective date that is infinite, BC or in year 10000',
    async ({ slug, admin }) => {
      // The checks bound both ends: PostgreSQL admits BC dates, which
      // PostgREST prints as `0044-03-15 BC` and no `YYYY-MM-DD` reader of the
      // row accepts, so one such row would make every projection of the team
      // throw. Written as the owner, past every policy: the check is the row's.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const seeded = await seededPattern(client, own);
        const team = await addThrowawayTeam(client, own, caller.authUserId);
        const valid = '2030-01-01';
        const refusals: Record<string, { code: string; constraint: boolean }> = {};
        for (const column of ['anchor', 'from'] as const) {
          for (const value of ['infinity', '-infinity', '0044-03-15 BC', '0001-12-31 BC', '10000-01-01']) {
            const refusal = await refusedThenContinue(client, () =>
              ownerAssignment(client, {
                organization: own,
                team: team.id,
                pattern: seeded.id,
                offsetStep: seeded.steps[0]!,
                anchor: column === 'anchor' ? value : valid,
                from: column === 'from' ? value : valid,
                by: caller.authUserId,
              }),
            );
            const constraint =
              column === 'anchor'
                ? 'rotation_assignments_anchor_date_finite'
                : 'rotation_assignments_effective_from_finite';
            refusals[`${column} ${value}`] = { code: refusal.code, constraint: refusal.message.includes(constraint) };
          }
        }
        // The edges themselves are admitted.
        await ownerAssignment(client, {
          organization: own,
          team: team.id,
          pattern: seeded.id,
          offsetStep: seeded.steps[0]!,
          anchor: '0001-01-01',
          from: '9999-12-31',
          by: caller.authUserId,
        });

        expect(refusals).toEqual(
          Object.fromEntries(Object.keys(refusals).map((key) => [key, { code: '23514', constraint: true }])),
        );
        expect(Object.keys(refusals)).toHaveLength(10);
        expect(await assignmentsOf(client, team.id)).toMatchObject([{ anchor: '0001-01-01', from: '9999-12-31' }]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses the $fixture admin editing a pattern or a step, removing one a team stands on, or naming a column the grant does not admit',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const seeded = await seededPattern(client, own);
        const types = await seededTypeIds(client, slug, own);
        await actAs(client, caller.authUserId, own);

        const attempts = {
          'update a pattern': () => client.query('update rotation_patterns set organization_id = organization_id where id = $1', [seeded.id]),
          'reorder a step': () => client.query('update rotation_steps set position = position + 10 where id = $1', [seeded.steps[0]]),
          'retype a step': () => client.query('update rotation_steps set shift_type_id = $2 where id = $1', [seeded.steps[0], types[1]]),
          'forge a pattern created_by': () =>
            client.query('insert into rotation_patterns (organization_id, created_by) values ($1, $2)', [own, caller.authUserId]),
          'forge a pattern id': () =>
            client.query('insert into rotation_patterns (organization_id, id) values ($1, gen_random_uuid())', [own]),
          'forge a step created_at': () =>
            client.query(
              "insert into rotation_steps (organization_id, pattern_id, position, shift_type_id, created_at) values ($1, $2, 50, $3, now() - interval '1 year')",
              [own, seeded.id, types[0]],
            ),
          'update an assignment': () =>
            client.query('update rotation_assignments set anchor_date = anchor_date + 1 where pattern_id = $1', [seeded.id]),
          'forge an assignment created_by': () =>
            client.query(
              `insert into rotation_assignments
                 (organization_id, team_id, pattern_id, offset_step_id, anchor_date, effective_from, created_by)
               select organization_id, team_id, pattern_id, offset_step_id, anchor_date, public.organization_today($1) + 3, $2
                 from rotation_assignments where pattern_id = $3 limit 1`,
              [own, caller.authUserId, seeded.id],
            ),
        } as const;
        const refusals: Record<string, string> = {};
        for (const [label, attempt] of Object.entries(attempts)) {
          refusals[label] = (await refusedThenContinue(client, attempt)).code;
        }
        // 0025: a delete of a pattern a team stands on, or of its step,
        // matches no row — the policy's refusal, as a cancelled past version's.
        const patternRemoved = await client.query('delete from rotation_patterns where id = $1', [seeded.id]);
        const stepRemoved = await client.query('delete from rotation_steps where id = $1', [seeded.steps[0]]);
        await actAsOwner(client);

        expect(refusals).toEqual(Object.fromEntries(Object.keys(attempts).map((label) => [label, '42501'])));
        expect(patternRemoved.rowCount, 'a pattern a team stands on was removed').toBe(0);
        expect(stepRemoved.rowCount, 'a step of a pattern a team stands on was removed').toBe(0);
        const { rows } = await client.query<{ total: number }>(
          'select count(*)::int as total from rotation_steps where pattern_id = $1',
          [seeded.id],
        );
        expect(rows[0]?.total).toBe(seededRotationOf(slug).steps.length);
      });
    },
  );
});

describe('rotation assignments are versioned: appended in date order, each one a change, one scheduled at most', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture version that is backdated, a second scheduled one, dated before a scheduled one, the same value, or on an archived team',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const today = await organizationDay(client, own);
        const yesterday = await organizationDay(client, own, -1);
        const soon = await organizationDay(client, own, 5);
        const later = await organizationDay(client, own, 9);
        const seeded = await seededPattern(client, own);
        const team = await seededTeam(client, own, seededRotationOf(slug).teams[0]!);
        const archivedTeam = await addThrowawayTeam(client, own, caller.authUserId, true);
        const types = await seededTypeIds(client, slug, own);
        const latest = (await assignmentsOf(client, team)).at(-1)!;
        await actAs(client, caller.authUserId, own);

        const on = { organization: own, team, pattern: seeded.id } as const;
        const backdated = await refusedThenContinue(client, () =>
          insertAssignment(client, { ...on, offsetStep: seeded.steps[1]!, anchor: latest.anchor, from: yesterday }),
        );
        const sameValue = await refusedThenContinue(client, () =>
          insertAssignment(client, { ...on, offsetStep: latest.offsetStepId, anchor: latest.anchor, from: today }),
        );
        const onArchived = await refusedThenContinue(client, () =>
          insertAssignment(client, {
            ...on,
            team: archivedTeam.id,
            offsetStep: seeded.steps[0]!,
            anchor: today,
            from: today,
          }),
        );
        // A change of ONE fact each is a change: the offset, then the anchor.
        const offsetOnly = await insertAssignment(client, {
          ...on,
          offsetStep: seeded.steps[1]!,
          anchor: latest.anchor,
          from: soon,
        });
        const second = await refusedThenContinue(client, () =>
          insertAssignment(client, { ...on, offsetStep: seeded.steps[2]!, anchor: latest.anchor, from: later }),
        );
        // BEFORE THE SCHEDULED ONE, from today. Refused — but by the
        // one-scheduled conjunct (the latest version is after today), not by
        // the date-order one alone: no state isolates that conjunct short of
        // the unique key. A date on or before the latest version is either in
        // the past (refused by "today or later"), or today or later while the
        // latest is in the future (refused by "one scheduled"), or equal to it
        // (the unique key). So date order is IMPLIED by those three, and the
        // conjunct is kept as 0010 writes it, a second lock on the same door.
        const beforeScheduled = await refusedThenContinue(client, () =>
          insertAssignment(client, { ...on, offsetStep: seeded.steps[2]!, anchor: latest.anchor, from: today }),
        );
        await actAsOwner(client);

        expect(backdated.code, 'a version dated yesterday was admitted').toBe('42501');
        expect(sameValue.code, 'a version changing nothing was admitted').toBe('42501');
        expect(onArchived.code, 'an archived team was given a rotation').toBe('42501');
        expect(offsetOnly.rowCount, 'a change of the offset alone was refused').toBe(1);
        expect(second.code, 'a second scheduled change was admitted').toBe('42501');
        expect(beforeScheduled.code, 'a version before a scheduled one was admitted').toBe('42501');

        // The anchor alone is a change too, once the scheduled one is gone.
        await cancelAssignment(client, { team, from: soon });
        await actAs(client, caller.authUserId, own);
        const anchorOnly = await insertAssignment(client, {
          ...on,
          offsetStep: latest.offsetStepId,
          anchor: '2019-06-01',
          from: today,
        });
        // And a different pattern at the same step position is a change.
        const fresh = await insertPattern(client, own);
        const freshSteps = await insertSteps(client, own, fresh, types);
        const patternOnly = await insertAssignment(client, {
          ...on,
          pattern: fresh,
          offsetStep: freshSteps[0]!,
          anchor: '2019-06-01',
          from: soon,
        });
        await actAsOwner(client);
        expect(anchorOnly.rowCount, 'a change of the anchor alone was refused').toBe(1);
        expect(patternOnly.rowCount, 'a change of the pattern alone was refused').toBe(1);
        expect((await assignmentsOf(client, team)).map((version) => version.from)).toEqual([
          SEEDED_EFFECTIVE_FROM,
          today,
          soon,
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'reads the $fixture version in effect by date, and lets the admin cancel only the latest future one',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const scheduled = await organizationDay(client, own, 6);
        const dayBefore = await organizationDay(client, own, 5);
        const seeded = await seededPattern(client, own);
        const team = await seededTeam(client, own, seededRotationOf(slug).teams[0]!);
        const first = (await assignmentsOf(client, team))[0]!;
        await actAs(client, caller.authUserId, own);

        await insertAssignment(client, {
          organization: own,
          team,
          pattern: seeded.id,
          offsetStep: seeded.steps.at(-1)!,
          anchor: SEEDED_ANCHOR_DATE,
          from: scheduled,
        });
        const beforeSwitch = await rotationOn(client, team, dayBefore);
        const onSwitch = await rotationOn(client, team, scheduled);
        const beforeAny = await rotationOn(client, team, '2019-12-31');
        const pastCancel = await cancelAssignment(client, { team, from: SEEDED_EFFECTIVE_FROM });
        const cancel = await cancelAssignment(client, { team, from: scheduled });
        const afterCancel = await rotationOn(client, team, scheduled);
        await actAsOwner(client);

        expect(beforeAny, 'a rotation was invented before the first version').toBeNull();
        expect(beforeSwitch).toEqual({ patternId: seeded.id, offsetStepId: first.offsetStepId, anchorDate: SEEDED_ANCHOR_DATE });
        expect(onSwitch?.offsetStepId, 'the scheduled version is not in effect on its date').toBe(seeded.steps.at(-1));
        expect(pastCancel.rowCount, 'a version in effect was cancelled').toBe(0);
        expect(cancel.rowCount, 'the scheduled version was not cancelled').toBe(1);
        expect(afterCancel?.offsetStepId, 'the cancellation did not restore the old rotation').toBe(first.offsetStepId);
        expect(await assignmentsOf(client, team)).toHaveLength(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role session any rotation write, and shows it the rotation all the same',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const own = await organizationId(client, slug);
        const owner = await memberByUsername(client, slug, admin);
        const caller = await memberByUsername(client, slug, member);
        const seeded = await seededPattern(client, own);
        const types = await seededTypeIds(client, slug, own);
        const team = await seededTeam(client, own, seededRotationOf(slug).teams[0]!);
        const scheduled = await organizationDay(client, own, 4);
        const open = await ownerPattern(client, own, owner.authUserId, []);
        await ownerAssignment(client, {
          organization: own,
          team,
          pattern: seeded.id,
          offsetStep: seeded.steps.at(-1)!,
          anchor: SEEDED_ANCHOR_DATE,
          from: scheduled,
          by: owner.authUserId,
        });
        await actAs(client, caller.authUserId, own);

        const pattern = await refusedThenContinue(client, () => insertPattern(client, own));
        const step = await refusedThenContinue(client, () => insertSteps(client, own, open.id, [types[0]!]));
        const later = await organizationDay(client, own, 8);
        const assignment = await refusedThenContinue(client, () =>
          insertAssignment(client, {
            organization: own,
            team,
            pattern: seeded.id,
            offsetStep: seeded.steps[1]!,
            anchor: SEEDED_ANCHOR_DATE,
            from: later,
          }),
        );
        const cancel = await cancelAssignment(client, { team, from: scheduled });
        const read = await readRotation(client);
        await actAsOwner(client);

        expect(pattern.code, 'a member-role account created a pattern').toBe('42501');
        expect(step.code, 'a member-role account added a step').toBe('42501');
        expect(assignment.code, 'a member-role account wrote an assignment').toBe('42501');
        expect(cancel.rowCount, 'a member-role account cancelled a version').toBe(0);
        expect(read.steps.length, 'a member-role account cannot read the steps').toBeGreaterThan(0);
        expect(read.assignments.length, 'a member-role account cannot read the assignments').toBeGreaterThan(0);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'refuses the $fixture admin reading or writing the $otherFixture rotation',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const other = await organizationId(client, otherSlug);
        const otherPattern = await seededPattern(client, other);
        const otherTeam = await seededTeam(client, other, seededRotationOf(otherSlug).teams[0]!);
        const otherTypes = await seededTypeIds(client, otherSlug, other);
        const scheduled = await organizationDay(client, other, 3);
        const otherAdmin = await memberByUsername(client, otherSlug, seededRotationOf(otherSlug).admin);
        const openOther = await ownerPattern(client, other, otherAdmin.authUserId, []);
        await ownerAssignment(client, {
          organization: other,
          team: otherTeam,
          pattern: otherPattern.id,
          offsetStep: otherPattern.steps.at(-1)!,
          anchor: SEEDED_ANCHOR_DATE,
          from: scheduled,
          by: otherAdmin.authUserId,
        });
        const later = await organizationDay(client, other, 9);
        await actAs(client, caller.authUserId, caller.organizationId);

        const { rows: seen } = await client.query<{ total: number }>(
          `select ((select count(*) from rotation_patterns where organization_id = $1)
                 + (select count(*) from rotation_steps where organization_id = $1)
                 + (select count(*) from rotation_assignments where organization_id = $1))::int as total`,
          [other],
        );
        const pattern = await refusedThenContinue(client, () => insertPattern(client, other));
        const step = await refusedThenContinue(client, () => insertSteps(client, other, openOther.id, [otherTypes[0]!]));
        const assignment = await refusedThenContinue(client, () =>
          insertAssignment(client, {
            organization: other,
            team: otherTeam,
            pattern: otherPattern.id,
            offsetStep: otherPattern.steps[1]!,
            anchor: SEEDED_ANCHOR_DATE,
            from: later,
          }),
        );
        // Its own tenant on the row, another tenant's team and pattern in it.
        const smuggled = await refusedThenContinue(client, () =>
          insertAssignment(client, {
            organization: caller.organizationId,
            team: otherTeam,
            pattern: otherPattern.id,
            offsetStep: otherPattern.steps[1]!,
            anchor: SEEDED_ANCHOR_DATE,
            from: scheduled,
          }),
        );
        const cancel = await cancelAssignment(client, { team: otherTeam, from: scheduled });
        await actAsOwner(client);

        expect(seen[0]?.total, `${slug} read the ${otherSlug} rotation`).toBe(0);
        expect(pattern.code).toBe('42501');
        expect(step.code).toBe('42501');
        expect(assignment.code).toBe('42501');
        // The team is not visible, so the not-archived conjunct fails first.
        expect(smuggled.code).toBe('42501');
        expect(cancel.rowCount, `${slug} cancelled a ${otherSlug} version`).toBe(0);
      });
    },
  );
});

describe('a direct API call writes a rotation under exactly the same rules', () => {
  it.skipIf(noApi).each(FIXTURES)(
    'lets the $fixture admin save a pattern, its steps and an assignment, schedule and cancel a change, over PostgREST',
    async ({ slug, admin }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      let team: string | undefined;
      let type: string | undefined;
      let pattern: string | undefined;
      try {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const today = await organizationDay(client, own);
        const yesterday = await organizationDay(client, own, -1);
        const scheduled = await organizationDay(client, own, 6);
        await client.query('begin');
        team = (await addThrowawayTeam(client, own, caller.authUserId)).id;
        type = await addThrowawayShiftType(client, own, caller.authUserId, { isWorking: false });
        await client.query('commit');
        const working = (await seededTypeIds(client, slug, own))[0]!;

        const created = await rest('rotation_patterns?select=id', {
          token,
          method: 'POST',
          body: { organization_id: own },
          prefer: 'return=representation',
        });
        expect(created.status, 'a permitted pattern insert answers 201').toBe(201);
        pattern = ((await created.json()) as readonly { id: string }[])[0]?.id;
        if (pattern === undefined) throw new Error('a permitted pattern insert returned no row');

        const stepped = await rest('rotation_steps?select=id,position', {
          token,
          method: 'POST',
          body: [
            { organization_id: own, pattern_id: pattern, position: 0, shift_type_id: working },
            { organization_id: own, pattern_id: pattern, position: 1, shift_type_id: type },
            { organization_id: own, pattern_id: pattern, position: 2, shift_type_id: type },
          ],
          prefer: 'return=representation',
        });
        expect(stepped.status, 'the bulk step insert was refused').toBe(201);
        const steps = ((await stepped.json()) as readonly { id: string; position: number }[])
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((step) => step.id);
        expect(steps).toHaveLength(3);

        const bound = await rest('rotation_assignments', {
          token,
          method: 'POST',
          body: [
            {
              organization_id: own,
              team_id: team,
              pattern_id: pattern,
              offset_step_id: steps[1],
              anchor_date: SEEDED_ANCHOR_DATE,
              effective_from: today,
            },
          ],
        });
        expect(bound.status, 'the assignment was refused').toBe(201);

        const read = await restRows(`rotation_assignments?team_id=eq.${team}&select=offset_step_id,effective_from`, {
          token,
        });
        expect(read).toEqual([{ offset_step_id: steps[1], effective_from: today }]);

        for (const [label, body, code] of [
          ['the same value', { offset_step_id: steps[1], anchor_date: SEEDED_ANCHOR_DATE, effective_from: scheduled }, '42501'],
          ['a backdated change', { offset_step_id: steps[2], anchor_date: SEEDED_ANCHOR_DATE, effective_from: yesterday }, '42501'],
          ['no offset', { offset_step_id: null, anchor_date: SEEDED_ANCHOR_DATE, effective_from: scheduled }, '23502'],
        ] as const) {
          const response = await rest('rotation_assignments', {
            token,
            method: 'POST',
            body: { organization_id: own, team_id: team, pattern_id: pattern, ...body },
          });
          expect(response.ok, `${label} was admitted`).toBe(false);
          expect((await restRefusal(response)).code, label).toBe(code);
        }

        const lateStep = await rest('rotation_steps', {
          token,
          method: 'POST',
          body: { organization_id: own, pattern_id: pattern, position: 3, shift_type_id: working },
        });
        expect(lateStep.ok, 'a step was added to a pattern in use').toBe(false);
        expect((await restRefusal(lateStep)).code).toBe('42501');

        const reordered = await rest(`rotation_steps?id=eq.${steps[0]}`, {
          token,
          method: 'PATCH',
          body: { position: 9 },
        });
        expect(reordered.ok, 'a step was edited').toBe(false);
        expect((await restRefusal(reordered)).code).toBe('42501');
        // 0025: a pattern a team stands on, and its steps, match no delete.
        for (const path of [`rotation_steps?pattern_id=eq.${pattern}&select=id`, `rotation_patterns?id=eq.${pattern}&select=id`]) {
          const removed = await rest(path, { token, method: 'DELETE', prefer: 'return=representation' });
          expect(removed.ok, `${path} was refused outright`).toBe(true);
          expect(await removed.json(), `${path} removed a row a team stands on`).toEqual([]);
        }

        const change = await rest('rotation_assignments', {
          token,
          method: 'POST',
          body: {
            organization_id: own,
            team_id: team,
            pattern_id: pattern,
            offset_step_id: steps[0],
            anchor_date: SEEDED_ANCHOR_DATE,
            effective_from: scheduled,
          },
        });
        expect(change.status, 'a scheduled change was refused').toBe(201);
        const pastCancel = await rest(
          `rotation_assignments?team_id=eq.${team}&effective_from=eq.${today}&select=id`,
          { token, method: 'DELETE', prefer: 'return=representation' },
        );
        expect(await pastCancel.json(), 'a version in effect was cancelled').toEqual([]);
        const cancel = await rest(
          `rotation_assignments?team_id=eq.${team}&effective_from=eq.${scheduled}&select=effective_from`,
          { token, method: 'DELETE', prefer: 'return=representation' },
        );
        expect(await cancel.json(), 'the scheduled change was not cancelled').toEqual([{ effective_from: scheduled }]);

        expect(await assignmentsOf(client, team)).toEqual([
          { patternId: pattern, offsetStepId: steps[1], anchor: SEEDED_ANCHOR_DATE, from: today, createdBy: caller.authUserId },
        ]);
      } finally {
        if (team !== undefined) await client.query('delete from rotation_assignments where team_id = $1', [team]);
        if (pattern !== undefined) {
          await client.query('delete from rotation_assignments where pattern_id = $1', [pattern]);
          await client.query('delete from rotation_steps where pattern_id = $1', [pattern]);
          await client.query('delete from rotation_patterns where id = $1', [pattern]);
        }
        if (type !== undefined) await client.query('delete from shift_types where id = $1', [type]);
        if (team !== undefined) await client.query('delete from teams where id = $1', [team]);
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(FIXTURES)(
    'refuses a $fixture member-role token any rotation write over PostgREST, and lets it read',
    async ({ slug, member }) => {
      const token = await tokenFor(member, slug);
      const client = await connect();
      try {
        const own = await organizationId(client, slug);
        const seeded = await seededPattern(client, own);
        const team = await seededTeam(client, own, seededRotationOf(slug).teams[0]!);
        const types = await seededTypeIds(client, slug, own);
        const before = await readRotation(client);

        const pattern = await rest('rotation_patterns', { token, method: 'POST', body: { organization_id: own } });
        const step = await rest('rotation_steps', {
          token,
          method: 'POST',
          body: { organization_id: own, pattern_id: seeded.id, position: 50, shift_type_id: types[0] },
        });
        const assignment = await rest('rotation_assignments', {
          token,
          method: 'POST',
          body: {
            organization_id: own,
            team_id: team,
            pattern_id: seeded.id,
            offset_step_id: seeded.steps[1],
            anchor_date: SEEDED_ANCHOR_DATE,
            effective_from: await organizationDay(client, own, 2),
          },
        });
        const cancelled = await rest(`rotation_assignments?team_id=eq.${team}&select=id`, {
          token,
          method: 'DELETE',
          prefer: 'return=representation',
        });
        const read = await restRows('rotation_steps?select=id', { token });

        for (const [label, response] of [
          ['a pattern', pattern],
          ['a step', step],
          ['an assignment', assignment],
        ] as const) {
          expect(response.ok, `a member-role account wrote ${label}`).toBe(false);
          expect((await restRefusal(response)).code, label).toBe('42501');
        }
        expect(await cancelled.json(), 'a member-role account deleted a version').toEqual([]);
        expect(read.length, 'a member-role account cannot read the steps').toBe(seededRotationOf(slug).steps.length);
        expect(await readRotation(client)).toEqual(before);
      } finally {
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noApi).each(['rotation_patterns', 'rotation_steps', 'rotation_assignments'] as const)(
    'refuses an anonymous caller any %s row',
    async (table) => {
      const response = await rest(`${table}?select=*`);
      const refusal = await restRefusal(response);

      expect(response.status, `an anonymous caller read ${table}`).toBe(401);
      expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
    },
  );
});

// ------------------------------- 0025: orphan patterns, whole cycles, the bound

/**
 * `0025_rotation_orphans.sql`. A pattern no version names — and its steps —
 * may be removed by an active admin of its organization, and by nobody else;
 * a version whose anchor moves by whole cycles on the same pattern and step
 * is the same value; and the builder's read embeds only what is in force from
 * the horizon on. Every SQL case runs in a rolled-back transaction; the REST
 * case deletes its own rows in `finally`.
 */

/** `day` moved by `days`, as a date string, in SQL. */
async function dayPlus(client: Client, day: string, days: number): Promise<string> {
  const { rows } = await client.query<{ day: string }>('select ($1::date + $2::int)::text as day', [day, days]);
  const moved = rows[0]?.day;
  if (moved === undefined) throw new Error('date arithmetic answered nothing');
  return moved;
}

/** How many of a pattern, and of its steps, the owner still sees. */
async function patternLeft(client: Client, pattern: string): Promise<{ patterns: number; steps: number }> {
  const { rows } = await client.query<{ patterns: number; steps: number }>(
    `select (select count(*)::int from rotation_patterns where id = $1) as patterns,
            (select count(*)::int from rotation_steps where pattern_id = $1) as steps`,
    [pattern],
  );
  return rows[0] ?? { patterns: -1, steps: -1 };
}

describe('a never-assigned pattern can be removed by an active admin, and nothing else can (0025)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'lets the $fixture admin take back one step, then remove the pattern with its steps, steps first',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const types = await seededTypeIds(client, slug, own);
        await actAs(client, caller.authUserId, own);

        const pattern = await insertPattern(client, own);
        const steps = await insertSteps(client, own, pattern, [types[0]!, types[1]!, types.at(-1)!]);
        // A wrong step added before the first assignment is taken back.
        const oneStep = await client.query('delete from rotation_steps where id = $1', [steps[1]]);
        // The key refuses a pattern that still has steps: the steps go first.
        const withSteps = await refusedThenContinue(client, () =>
          client.query('delete from rotation_patterns where id = $1', [pattern]),
        );
        const remaining = await client.query('delete from rotation_steps where pattern_id = $1', [pattern]);
        const removed = await client.query('delete from rotation_patterns where id = $1', [pattern]);
        await actAsOwner(client);

        expect(oneStep.rowCount, 'a step of a never-assigned pattern was not removed').toBe(1);
        expect(withSteps.code, 'a pattern was removed from under its steps').toBe('23503');
        expect(remaining.rowCount).toBe(2);
        expect(removed.rowCount, 'a never-assigned pattern was not removed').toBe(1);
        expect(await patternLeft(client, pattern)).toEqual({ patterns: 0, steps: 0 });
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses the $fixture admin and member a pattern any version names, and the member every pattern',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const own = await organizationId(client, slug);
        const owner = await memberByUsername(client, slug, admin);
        const caller = await memberByUsername(client, slug, member);
        const seeded = await seededPattern(client, own);
        const types = await seededTypeIds(client, slug, own);
        const team = await seededTeam(client, own, seededRotationOf(slug).teams[0]!);
        // Named by a SCHEDULED version alone: still referenced, still kept.
        const scheduledOnly = await ownerPattern(client, own, owner.authUserId, [types[0]!, types.at(-1)!]);
        await ownerAssignment(client, {
          organization: own,
          team,
          pattern: scheduledOnly.id,
          offsetStep: scheduledOnly.steps[0]!,
          anchor: SEEDED_ANCHOR_DATE,
          from: await organizationDay(client, own, 4),
          by: owner.authUserId,
        });
        const open = await ownerPattern(client, own, owner.authUserId, [types[0]!]);

        // Steps first, then the pattern, as the builder's cleanup sends them.
        const attempt = async () => {
          const removed: number[] = [];
          for (const pattern of [seeded.id, scheduledOnly.id, open.id]) {
            removed.push((await client.query('delete from rotation_steps where pattern_id = $1', [pattern])).rowCount ?? -1);
            removed.push(await patternDeleteProbe(client, pattern));
          }
          return removed;
        };

        await actAs(client, caller.authUserId, own);
        const byMember = await attempt();
        await actAsOwner(client);
        await actAs(client, owner.authUserId, own);
        const byAdmin = await attempt();
        await actAsOwner(client);

        // The member removes nothing, never-assigned pattern included: every
        // delete matches no row.
        expect(byMember, 'a member-role account removed a pattern or a step').toEqual([0, 0, 0, 0, 0, 0]);
        // The admin: nothing of a referenced pattern, all of the open one.
        expect(byAdmin, 'the admin removed a referenced pattern or step').toEqual([0, 0, 0, 0, 1, 1]);
        expect(await patternLeft(client, seeded.id)).toEqual({ patterns: 1, steps: seeded.steps.length });
        expect(await patternLeft(client, scheduledOnly.id)).toEqual({ patterns: 1, steps: 2 });
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'refuses the $fixture admin the $otherFixture never-assigned pattern and its steps',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const other = await organizationId(client, otherSlug);
        const otherAdmin = await memberByUsername(client, otherSlug, seededRotationOf(otherSlug).admin);
        const otherTypes = await seededTypeIds(client, otherSlug, other);
        const open = await ownerPattern(client, other, otherAdmin.authUserId, [otherTypes[0]!]);
        await actAs(client, caller.authUserId, caller.organizationId);

        const steps = await client.query('delete from rotation_steps where pattern_id = $1', [open.id]);
        const removed = await patternDeleteProbe(client, open.id);
        await actAsOwner(client);

        expect(steps.rowCount, `${slug} removed a ${otherSlug} step`).toBe(0);
        expect(removed, `${slug} removed a ${otherSlug} pattern`).toBe(0);
        expect(await patternLeft(client, open.id)).toEqual({ patterns: 1, steps: 1 });
      });
    },
  );

  it.skipIf(noApi).each(FIXTURES)(
    'lets the $fixture admin remove a never-assigned pattern over PostgREST, the way the builder cleans up',
    async ({ slug, admin }) => {
      const token = await tokenFor(admin, slug);
      const client = await connect();
      let pattern: string | undefined;
      try {
        const own = (await memberByUsername(client, slug, admin)).organizationId;
        const working = (await seededTypeIds(client, slug, own))[0]!;
        const created = await restRows('rotation_patterns?select=id', {
          token,
          method: 'POST',
          body: { organization_id: own },
          prefer: 'return=representation',
        });
        pattern = created[0]?.['id'] as string | undefined;
        if (pattern === undefined) throw new Error('a permitted pattern insert returned no row');
        await restRows('rotation_steps?select=id', {
          token,
          method: 'POST',
          body: [0, 1].map((position) => ({ organization_id: own, pattern_id: pattern, position, shift_type_id: working })),
          prefer: 'return=representation',
        });

        const steps = await restRows(`rotation_steps?organization_id=eq.${own}&pattern_id=eq.${pattern}&select=id`, {
          token,
          method: 'DELETE',
          prefer: 'return=representation',
        });
        const removed = await restRows(`rotation_patterns?organization_id=eq.${own}&id=eq.${pattern}&select=id`, {
          token,
          method: 'DELETE',
          prefer: 'return=representation',
        });

        expect(steps).toHaveLength(2);
        expect(removed).toEqual([{ id: pattern }]);
        expect(await patternLeft(client, pattern)).toEqual({ patterns: 0, steps: 0 });
      } finally {
        if (pattern !== undefined) {
          await client.query('delete from rotation_steps where pattern_id = $1', [pattern]);
          await client.query('delete from rotation_patterns where id = $1', [pattern]);
        }
        await client.end();
      }
    },
    20_000,
  );
});

/** A pattern delete in a savepoint, answering the rows removed, or -1 when a key refused it. */
async function patternDeleteProbe(client: Client, pattern: string): Promise<number> {
  await client.query('savepoint pattern_probe');
  try {
    return (await client.query('delete from rotation_patterns where id = $1', [pattern])).rowCount ?? -1;
  } catch {
    return -1;
  } finally {
    await client.query('rollback to savepoint pattern_probe');
  }
}

describe('an anchor moved by whole cycles is the same value (0025)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture version moving the anchor by +1, +2 or −1 cycles, and admits a non-multiple, another step or pattern',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);
        const own = caller.organizationId;
        const soon = await organizationDay(client, own, 5);
        const seeded = await seededPattern(client, own);
        const team = await seededTeam(client, own, seededRotationOf(slug).teams[0]!);
        const types = await seededTypeIds(client, slug, own);
        const latest = (await assignmentsOf(client, team)).at(-1)!;
        const cycle = seeded.steps.length;
        const otherStep = seeded.steps.find((step) => step !== latest.offsetStepId)!;
        await actAs(client, caller.authUserId, own);

        const on = { organization: own, team, pattern: seeded.id, offsetStep: latest.offsetStepId, from: soon } as const;
        const refusals: Record<string, string> = {};
        for (const cycles of [1, 2, -1, 0]) {
          const anchor = await dayPlus(client, latest.anchor, cycles * cycle);
          refusals[String(cycles)] = (
            await refusedThenContinue(client, () => insertAssignment(client, { ...on, anchor }))
          ).code;
        }
        const admitted: Record<string, number | null> = {};
        const changes = {
          'a non-multiple': { ...on, anchor: await dayPlus(client, latest.anchor, cycle + 1) },
          'one day': { ...on, anchor: await dayPlus(client, latest.anchor, -1) },
          'another step': { ...on, offsetStep: otherStep, anchor: latest.anchor },
        } as const;
        for (const [label, facts] of Object.entries(changes)) {
          admitted[label] = (await insertAssignment(client, facts)).rowCount;
          await cancelAssignment(client, { team, from: soon });
        }
        const fresh = await insertPattern(client, own);
        const freshSteps = await insertSteps(client, own, fresh, seededRotationOf(slug).steps.map(() => types[0]!));
        admitted['another pattern'] = (
          await insertAssignment(client, { ...on, pattern: fresh, offsetStep: freshSteps[0]!, anchor: latest.anchor })
        ).rowCount;
        await actAsOwner(client);

        expect(refusals, 'a whole-cycle move of the anchor was admitted as a change').toEqual({
          '1': '42501',
          '2': '42501',
          '-1': '42501',
          '0': '42501',
        });
        expect(admitted).toEqual({ 'a non-multiple': 1, 'one day': 1, 'another step': 1, 'another pattern': 1 });
      });
    },
  );
});

describe('the builder read embeds what is in force from the horizon on (0025)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'selects the $fixture versions in force yesterday or on a pending override date, and later, their or unassigned patterns steps, and the pending overrides',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const viewer = await memberByUsername(client, slug, member);
        const own = owner.organizationId;
        const types = await seededTypeIds(client, slug, own);
        const today = await organizationDay(client, own);
        // One throwaway team per case. Every version is saved at the
        // transaction's `now()`; an override's stamps are set against that.
        const [plain, margin, pending, confirmed, future] = [
          await addThrowawayTeam(client, own, owner.authUserId),
          await addThrowawayTeam(client, own, owner.authUserId),
          await addThrowawayTeam(client, own, owner.authUserId),
          await addThrowawayTeam(client, own, owner.authUserId),
          await addThrowawayTeam(client, own, owner.authUserId),
        ];
        const labels = [
          'oldest', 'previous', 'inForce', 'scheduled', 'open',
          'beforeMidnight', 'fromToday',
          'beforePending', 'afterPending',
          'beforeConfirmed', 'afterConfirmed',
          'futureInForce', 'futureScheduled',
        ] as const;
        const pattern = {} as Record<(typeof labels)[number], { readonly id: string; readonly steps: readonly string[] }>;
        for (const label of labels) {
          pattern[label] = await ownerPattern(client, own, owner.authUserId, [types[0]!, types.at(-1)!]);
        }
        const version = async (team: { id: string }, label: (typeof labels)[number], days: number) =>
          ownerAssignment(client, {
            organization: own,
            team: team.id,
            pattern: pattern[label].id,
            offsetStep: pattern[label].steps[0]!,
            anchor: SEEDED_ANCHOR_DATE,
            from: await dayPlus(client, today, days),
            by: owner.authUserId,
          });
        const override = async (
          team: { id: string },
          days: number,
          stamps: { created: string; confirmed?: string; removed?: boolean },
        ): Promise<string> => {
          const { rows } = await client.query<{ id: string }>(
            `insert into shift_type_overrides
               (organization_id, team_id, date, shift_type_id, reason, created_by, created_at,
                confirmed_by, confirmed_at, removed_by, removed_at)
             values ($1, $2, $3::date, $4, 'rls-isolation-test override', $5::uuid, now() + $6::interval,
                     case when $7::interval is null then null else $5::uuid end, now() + $7::interval,
                     case when $8::boolean then $5::uuid end, case when $8::boolean then now() end)
             returning id`,
            [own, team.id, await dayPlus(client, today, days), types.at(-1), owner.authUserId, stamps.created, stamps.confirmed ?? null, stamps.removed ?? false],
          );
          const id = rows[0]?.id;
          if (id === undefined) throw new Error('shift_type_overrides insert returned no row');
          return id;
        };

        // PLAIN: yesterday's version, the one scheduled, and the older ones,
        // which nothing keeps. A removed override, and a pending one no
        // version governs (before the oldest), move nothing.
        await version(plain, 'oldest', -400);
        await version(plain, 'previous', -30);
        await version(plain, 'inForce', -10);
        await version(plain, 'scheduled', 5);
        await override(plain, -60, { created: '-1 year', removed: true });
        const ungoverned = await override(plain, -500, { created: '-1 year' });
        // THE MARGIN: a version from today keeps the one in force yesterday.
        await version(margin, 'beforeMidnight', -50);
        await version(margin, 'fromToday', 0);
        // PENDING: written a year before its governing version was saved.
        await version(pending, 'beforePending', -400);
        await version(pending, 'afterPending', -20);
        const pendingPast = await override(pending, -25, { created: '-1 year' });
        // CONFIRMED after its governing version was saved: in force, not pending.
        await version(confirmed, 'beforeConfirmed', -400);
        await version(confirmed, 'afterConfirmed', -20);
        await override(confirmed, -25, { created: '-1 year', confirmed: '1 minute' });
        // FUTURE: pending under the scheduled version, later than yesterday.
        await version(future, 'futureInForce', -10);
        await version(future, 'futureScheduled', 5);
        const pendingFuture = await override(future, 8, { created: '-1 year' });

        const teams = [plain, margin, pending, confirmed, future].map((team) => team.id);
        const name = new Map(labels.map((label) => [pattern[label].id, label]));
        const read = async () => {
          const { rows: kept } = await client.query<{ patternId: string }>(
            `select a.pattern_id as "patternId"
               from organizations o, public.rotation_assignments_in_view(o) as a
              where o.id = $1 and a.team_id = any($2::uuid[])`,
            [own, teams],
          );
          const { rows: steps } = await client.query<{ patternId: string }>(
            `select distinct s.pattern_id as "patternId"
               from organizations o, public.rotation_steps_in_view(o) as s
              where o.id = $1 and s.pattern_id = any($2::uuid[])`,
            [own, labels.map((label) => pattern[label].id)],
          );
          const { rows: overrides } = await client.query<{ id: string }>(
            `select v.id
               from organizations o, public.rotation_overrides_in_view(o) as v
              where o.id = $1 and v.team_id = any($2::uuid[])`,
            [own, teams],
          );
          const { rows: seededKept } = await client.query<{ total: number }>(
            `select count(*)::int as total
               from organizations o, public.rotation_assignments_in_view(o) as a
              where o.id = $1 and a.team_id <> all($2::uuid[])`,
            [own, teams],
          );
          return {
            kept: kept.map((row) => name.get(row.patternId)).sort(),
            steps: steps.map((row) => name.get(row.patternId)).sort(),
            overrides: overrides.map((row) => row.id).sort(),
            seeded: seededKept[0]?.total,
          };
        };

        await actAs(client, owner.authUserId, own);
        const asAdmin = await read();
        await actAsOwner(client);
        await actAs(client, viewer.authUserId, own);
        const asMember = await read();
        await actAsOwner(client);

        // Every team keeps what is in force YESTERDAY and later; the pending
        // override keeps the older version governing its date. The confirmed
        // one keeps nothing older, and the future one does not pin its team
        // on its own date, past the version in force now.
        const always = ['afterConfirmed', 'afterPending', 'beforeMidnight', 'fromToday', 'futureInForce', 'futureScheduled', 'inForce', 'scheduled'];
        expect(asAdmin.kept).toEqual([...always, 'beforePending'].sort());
        expect(asAdmin.steps).toEqual([...always, 'beforePending', 'open'].sort());
        // The pending overrides alone, the ungoverned one included: not the
        // confirmed one, and not the removed one.
        expect(asAdmin.overrides).toEqual([ungoverned, pendingPast, pendingFuture].sort());
        // The member reads no override, so every horizon is yesterday.
        expect(asMember.kept).toEqual([...always].sort());
        expect(asMember.steps).toEqual([...always, 'open'].sort());
        expect(asMember.overrides).toEqual([]);
        // The seeded rotation: one version per team, in force today, all kept.
        expect(asAdmin.seeded).toBe(seededRotationOf(slug).teams.length);
      });
    },
  );

  it.skipIf(noApi).each(FIXTURES)(
    'embeds the $fixture bounded steps, assignments and overrides, and every version as history, over PostgREST',
    async ({ slug, admin, member }) => {
      for (const username of [admin, member]) {
        const token = await tokenFor(username, slug);
        // The builder's own shape: the overrides aliased, and filtered by the alias.
        const rows = await restRows(
          'organizations?select=id,rotation_steps:rotation_steps_in_view(id),rotation_assignments:rotation_assignments_in_view(id),rotation_history:rotation_assignments(id),shift_type_overrides:rotation_overrides_in_view(id)&shift_type_overrides.removed_at=is.null',
          { token },
        );

        expect(rows).toHaveLength(1);
        expect((rows[0]?.['rotation_steps'] as unknown[]).length, username).toBe(seededRotationOf(slug).steps.length);
        expect((rows[0]?.['rotation_assignments'] as unknown[]).length, username).toBe(seededRotationOf(slug).teams.length);
        expect((rows[0]?.['rotation_history'] as unknown[]).length, username).toBe(seededRotationOf(slug).teams.length);
        expect(rows[0]?.['shift_type_overrides'], username).toEqual([]);
      }
    },
    20_000,
  );
});

// ---------------------------------------- story 3.5a: shift-type overrides

/**
 * STORY 3.5a (`0019`). One live shift-type override per team and date, read
 * and written by an active admin alone, read by every active member through
 * `calendar_shift_type_overrides()`. Every SQL case runs in a rolled-back
 * transaction; the REST cases write nothing.
 */

/** The seeded override per fixture: its team, date, type and reason. */
const SEEDED_OVERRIDES: Readonly<Record<string, { team: string; date: string; type: string; reason: string }>> = {
  'dvd-kastel-novi': { team: 'Smjena A', date: '2026-09-14', type: 'Noć', reason: 'Zamjena sa Smjenom B zbog vježbe.' },
  'zastita-split': {
    team: 'Smjena B',
    date: '2026-09-14',
    type: 'Jutarnja',
    reason: 'Pokrivanje izvanrednog događaja.',
  },
};

function seededOverrideOf(slug: string): { team: string; date: string; type: string; reason: string } {
  const seeded = SEEDED_OVERRIDES[slug];
  if (seeded === undefined) throw new Error(`no seeded override is recorded for ${slug}`);
  return seeded;
}

/** `calendar_shift_type_overrides()`, as whoever the connection currently is. */
async function calendarOverridesOf(client: Client): Promise<Record<string, unknown>[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    `select id::text as id, team_id::text as team_id, date::text as date, shift_type_id::text as shift_type_id,
            reason, created_at, author_member_id::text as author_member_id
       from public.calendar_shift_type_overrides()`,
  );
  return rows;
}

/** The columns the function answers, exactly, whatever the caller. */
async function calendarOverrideColumns(client: Client): Promise<string[]> {
  const { fields } = await client.query('select * from public.calendar_shift_type_overrides() limit 0');
  return fields.map((field) => field.name);
}

/** One override, written as whoever the connection currently is: the five columns a session may name. */
async function insertOverride(
  client: Client,
  override: { organization: string; team: string; date: string; type: string; reason: string },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into shift_type_overrides (organization_id, team_id, date, shift_type_id, reason)
     values ($1, $2, $3::date, $4, $5)
     returning id`,
    [override.organization, override.team, override.date, override.type, override.reason],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('the override insert returned no id');
  return id;
}

/** Every rotation rule row of every organization, whole, as text: byte-identity (CAP-12, DI-2). */
async function rotationFingerprint(client: Client): Promise<string> {
  const { rows } = await client.query<{ digest: string }>(
    `select md5(coalesce(string_agg(body, E'\\n' order by body), '')) as digest
       from (
         select 'p:' || to_jsonb(x)::text as body from rotation_patterns x
         union all select 's:' || to_jsonb(x)::text from rotation_steps x
         union all select 'a:' || to_jsonb(x)::text from rotation_assignments x
       ) as everything`,
  );
  return rows[0]?.digest ?? '';
}

describe('a shift-type override is recorded by an admin alone and read by every member (story 3.5a)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'seeds one $fixture override, attributed to its admin, and names that admin as a member',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const seeded = seededOverrideOf(slug);
        const team = await seededTeam(client, owner.organizationId, seeded.team);
        const type = await seededShiftType(client, owner.organizationId, seeded.type);

        const { rows: stored } = await client.query<{ createdBy: string; removedAt: unknown }>(
          `select created_by as "createdBy", removed_at as "removedAt" from shift_type_overrides
            where organization_id = $1`,
          [owner.organizationId],
        );
        expect(stored, `${slug}: the seed is not one live override by its admin`).toEqual([
          { createdBy: owner.authUserId, removedAt: null },
        ]);

        for (const reader of [self, owner]) {
          await actAs(client, reader.authUserId, owner.organizationId);
          const rows = await calendarOverridesOf(client);
          const columns = await calendarOverrideColumns(client);
          await actAsOwner(client);

          expect(columns, `${slug}: the read answers another shape`).toEqual([
            'id',
            'team_id',
            'date',
            'shift_type_id',
            'reason',
            'created_at',
            // STORY 3.5c (0022): when the override was last confirmed, and nothing else new.
            'confirmed_at',
            'author_member_id',
          ]);
          expect(
            rows.map(({ id: _id, created_at: _at, ...rest }) => rest),
            `${slug} as ${reader.role}`,
          ).toEqual([
            {
              team_id: team,
              date: seeded.date,
              shift_type_id: type,
              reason: seeded.reason,
              author_member_id: owner.id,
            },
          ]);
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'records a $fixture admin override on a non-working type, past or future, attributed by default, and leaves every rotation row byte-identical',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');
        const off = await seededShiftType(client, organization, 'Slobodno');
        const before = await rotationFingerprint(client);

        await actAs(client, owner.authUserId, organization);
        const past = await insertOverride(client, { organization, team, date: '2021-03-04', type: off, reason: 'x' });
        const future = await insertOverride(client, {
          organization,
          team,
          date: '2031-03-04',
          type: off,
          reason: 'y'.repeat(200),
        });
        const { rows: visible } = await client.query<{ id: string }>(
          'select id from shift_type_overrides where id in ($1, $2) order by date',
          [past, future],
        );
        await actAsOwner(client);

        expect(visible.map((row) => row.id), `${slug}: the admin cannot read what it wrote`).toEqual([past, future]);
        const { rows } = await client.query<{ createdBy: string; recent: boolean }>(
          `select created_by as "createdBy", created_at > now() - interval '1 minute' as recent
             from shift_type_overrides where id in ($1, $2)`,
          [past, future],
        );
        expect(rows).toEqual([
          { createdBy: owner.authUserId, recent: true },
          { createdBy: owner.authUserId, recent: true },
        ]);
        expect(await rotationFingerprint(client), `${slug}: an override touched a rotation row`).toBe(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'shows a $fixture member-role account no table row, refuses its insert, and answers it the rpc',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');
        const type = await seededShiftType(client, organization, 'Slobodno');

        await actAs(client, self.authUserId, organization);
        const { rows: table } = await client.query('select * from shift_type_overrides');
        const viaRpc = await calendarOverridesOf(client);
        const refusal = await refusedThenContinue(client, () =>
          insertOverride(client, { organization, team, date: '2026-10-01', type, reason: 'x' }),
        );
        await actAsOwner(client);

        expect(table, `${slug}: a member-role account read the table`).toEqual([]);
        expect(viaRpc.length, `${slug}: a member-role account lost the rpc`).toBe(1);
        expect(refusal.code, `${slug}: a member-role account wrote an override`).toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'answers a $fixture caller inactive today nothing, and refuses an inactive admin',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const other = await addThrowawayAdmin(client, organization);
        const team = await seededTeam(client, organization, 'Smjena A');
        const type = await seededShiftType(client, organization, 'Slobodno');
        await ownerVersion(client, {
          organization,
          member: other.id,
          active: false,
          from: await organizationDay(client, organization),
          by: owner.authUserId,
        });

        await actAs(client, other.authUserId, organization);
        const rows = await calendarOverridesOf(client);
        const { rows: table } = await client.query('select * from shift_type_overrides');
        const refusal = await refusedThenContinue(client, () =>
          insertOverride(client, { organization, team, date: '2026-10-01', type, reason: 'x' }),
        );
        await actAsOwner(client);

        expect(rows, `${slug}: an inactive caller read the overrides`).toEqual([]);
        expect(table, `${slug}: an inactive admin read the table`).toEqual([]);
        expect(refusal.code, `${slug}: an inactive admin wrote an override`).toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'answers a $fixture caller nothing of $otherFixture, under its own claim, a forged one or none',
    async ({ slug, admin, member, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const foreignOwner = await memberByUsername(
          client,
          otherSlug,
          FIXTURES.find((entry) => entry.slug === otherSlug)?.admin ?? '',
        );
        const { rows: foreign } = await client.query<{ id: string }>(
          'select id::text as id from shift_type_overrides where organization_id = $1',
          [foreignOwner.organizationId],
        );
        expect(foreign.length, `${otherSlug} has no override to leak`).toBeGreaterThan(0);
        const foreignTeam = await seededTeam(client, foreignOwner.organizationId, 'Smjena A');
        const ownType = await seededShiftType(client, owner.organizationId, 'Slobodno');

        for (const reader of [self, owner]) {
          await actAs(client, reader.authUserId, reader.organizationId);
          const own = await calendarOverridesOf(client);
          const { rows: table } = await client.query<{ id: string }>('select id::text as id from shift_type_overrides');
          await actAsOwner(client);

          expect(own.length, `${slug}: its own overrides`).toBeGreaterThan(0);
          for (const row of [...own, ...table]) {
            expect(foreign.map((one) => one.id), `${slug}: another tenant's override`).not.toContain(row['id']);
          }

          await actAs(client, reader.authUserId, foreignOwner.organizationId);
          expect(await calendarOverridesOf(client), `${slug}: a forged claim read overrides`).toEqual([]);
          await actAsOwner(client);
          await actAs(client, reader.authUserId, null);
          expect(await calendarOverridesOf(client), `${slug}: no claim read overrides`).toEqual([]);
          await actAsOwner(client);
        }

        // Another tenant's team under the admin's own tenant: the key refuses it.
        await actAs(client, owner.authUserId, owner.organizationId);
        const crossTeam = await refusedThenContinue(client, () =>
          insertOverride(client, {
            organization: owner.organizationId,
            team: foreignTeam,
            date: '2026-10-01',
            type: ownType,
            reason: 'x',
          }),
        );
        // An override written into the other tenant: the policy refuses it.
        const crossTenant = await refusedThenContinue(client, () =>
          insertOverride(client, {
            organization: foreignOwner.organizationId,
            team: foreignTeam,
            date: '2026-10-01',
            type: ownType,
            reason: 'x',
          }),
        );
        await actAsOwner(client);

        expect(crossTeam.code, `${slug}: another tenant's team was overridden`).toBe('23503');
        expect(crossTenant.code, `${slug}: an override was written into ${otherSlug}`).toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second live $fixture override of one team and date, and admits one again once the first is removed',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');
        const type = await seededShiftType(client, organization, 'Slobodno');
        const override = { organization, team, date: '2026-10-01', type, reason: 'x' };

        await actAs(client, owner.authUserId, organization);
        const first = await insertOverride(client, override);
        const duplicate = await refusedThenContinue(client, () => insertOverride(client, override));
        await actAsOwner(client);
        expect(duplicate.code, `${slug}: two live overrides on one team and date`).toBe('23505');

        // Here the owner records the removal directly; 3.5b's definer
        // function is exercised in the story 3.5b block below.
        await client.query('update shift_type_overrides set removed_by = $2, removed_at = now() where id = $1', [
          first,
          owner.authUserId,
        ]);
        await actAs(client, owner.authUserId, organization);
        const second = await insertOverride(client, override);
        const read = await calendarOverridesOf(client);
        await actAsOwner(client);

        expect(read.map((row) => row['id']), `${slug}: the removed override is read`).not.toContain(first);
        expect(read.map((row) => row['id'])).toContain(second);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a blank or overlong $fixture reason, an archived team or type, a forged author, an update, a delete and a half-recorded removal',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');
        const type = await seededShiftType(client, organization, 'Slobodno');
        const archivedType = await addThrowawayShiftType(client, organization, owner.authUserId, { archived: true });
        const archivedTeam = (await addThrowawayTeam(client, organization, owner.authUserId, true)).id;

        await actAs(client, owner.authUserId, organization);
        const codes: Record<string, string> = {};
        for (const [label, reason] of [
          ['blank', '  '],
          ['empty', ''],
          // White space that is not a space: tabs and line breaks alone.
          ['tabs and line breaks', '\t\n\r\t'],
          ['overlong', 'z'.repeat(201)],
        ] as const) {
          codes[label] = (
            await refusedThenContinue(client, () =>
              insertOverride(client, { organization, team, date: '2026-10-01', type, reason }),
            )
          ).code;
        }
        codes['archived type'] = (
          await refusedThenContinue(client, () =>
            insertOverride(client, { organization, team, date: '2026-10-01', type: archivedType, reason: 'x' }),
          )
        ).code;
        codes['archived team'] = (
          await refusedThenContinue(client, () =>
            insertOverride(client, { organization, team: archivedTeam, date: '2026-10-01', type, reason: 'x' }),
          )
        ).code;
        // No session names the attribution or the removal, updates or deletes.
        codes['forged author'] = (
          await refusedThenContinue(client, () =>
            client.query(
              `insert into shift_type_overrides (organization_id, team_id, date, shift_type_id, reason, created_by)
               values ($1, $2, '2026-10-01', $3, 'x', $4)`,
              [organization, team, type, owner.authUserId],
            ),
          )
        ).code;
        codes['update'] = (
          await refusedThenContinue(client, () => client.query('update shift_type_overrides set removed_at = now()'))
        ).code;
        codes['delete'] = (
          await refusedThenContinue(client, () => client.query('delete from shift_type_overrides'))
        ).code;
        await actAsOwner(client);

        const halfRemoved = await refusedThenContinue(client, () =>
          client.query('update shift_type_overrides set removed_at = now() where organization_id = $1', [organization]),
        );

        expect(codes, slug).toEqual({
          blank: '23514',
          empty: '23514',
          'tabs and line breaks': '23514',
          overlong: '23514',
          'archived type': '42501',
          'archived team': '42501',
          'forged author': '42501',
          update: '42501',
          delete: '42501',
        });
        expect(halfRemoved.code, `${slug}: a removal without its author`).toBe('23514');
      });
    },
  );

  it.skipIf(noDatabase)('names an author who is no member of the organization as nobody', async () => {
    await inRolledBackTransaction(async (client) => {
      const [fixture, other] = FIXTURES;
      const owner = await memberByUsername(client, fixture.slug, fixture.admin);
      const self = await memberByUsername(client, fixture.slug, fixture.member);
      const stranger = await memberByUsername(client, other.slug, other.admin);
      const organization = owner.organizationId;
      const team = await seededTeam(client, organization, 'Smjena B');
      const type = await seededShiftType(client, organization, 'Slobodno');
      // As the owner, past the policy: an auth user of ANOTHER organization, and nobody at all.
      const { rows } = await client.query<{ id: string }>(
        `insert into shift_type_overrides (organization_id, team_id, date, shift_type_id, reason, created_by)
         values ($1, $2, '2026-10-01', $3, 'x', $4), ($1, $2, '2026-10-02', $3, 'x', gen_random_uuid())
         returning id::text as id`,
        [organization, team, type, stranger.authUserId],
      );

      await actAs(client, self.authUserId, organization);
      const read = await calendarOverridesOf(client);
      await actAsOwner(client);

      expect(rows).toHaveLength(2);
      for (const { id } of rows) {
        const row = read.find((one) => one['id'] === id);
        expect(row, id).toBeDefined();
        expect(row?.['author_member_id'], id).toBeNull();
      }
    });
  });

  it.skipIf(noApi)('refuses an anonymous caller the table and the rpc', async () => {
    const table = await rest('shift_type_overrides?select=*');
    expect(table.status, 'an anonymous caller read shift_type_overrides').toBe(401);
    expect((await restRefusal(table)).code, 'a privilege refusal is 42501').toBe('42501');

    const rpc = await rest('rpc/calendar_shift_type_overrides', { method: 'POST', body: {} });
    expect(rpc.status, 'an anonymous caller reached the overrides').toBe(401);
    const refusal = await restRefusal(rpc);
    expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
    expect(refusal.message).toBe('permission denied for function calendar_shift_type_overrides');
  });

  it.skipIf(noApi).each(FIXTURES)(
    'answers the $fixture overrides over PostgREST to member and admin, and the table to the admin alone',
    async ({ slug, admin, member }) => {
      for (const reader of [member, admin]) {
        const token = await tokenFor(reader, slug);
        const response = await rest('rpc/calendar_shift_type_overrides', { token, method: 'POST', body: {} });
        expect(response.status, `${reader}: ${await response.clone().text()}`).toBe(200);
        const rows = (await response.json()) as Record<string, unknown>[];

        expect(rows.some((row) => row['date'] === seededOverrideOf(slug).date), `${slug}/${reader}`).toBe(true);
        for (const row of rows) {
          expect(Object.keys(row).sort(), `${slug}/${reader}: another shape`).toEqual([
            'author_member_id',
            'confirmed_at',
            'created_at',
            'date',
            'id',
            'reason',
            'shift_type_id',
            'team_id',
          ]);
        }
        const table = await restRows('shift_type_overrides?select=id', { token });
        expect(table.length > 0, `${slug}/${reader} reads the table`).toBe(reader === admin);
      }
    },
    20_000,
  );
});

// ------------------------------- story 3.5b: removing a shift-type override

/**
 * STORY 3.5b (`0021`). An active admin soft-removes a live override through
 * `remove_shift_type_override()`, which attributes the removal itself; every
 * other caller is refused, and nothing but that one row's `removed_by` and
 * `removed_at` changes. Every SQL case runs in a rolled-back transaction; the
 * REST cases name an id no override has, and so write nothing.
 */

/** `remove_shift_type_override(id)`, as whoever the connection currently is. */
async function removeOverride(client: Client, id: string): Promise<void> {
  await client.query('select public.remove_shift_type_override($1::uuid)', [id]);
}

/** One override row, whole, as the owner sees it. */
async function overrideRow(client: Client, id: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await client.query<Record<string, unknown>>(
    'select to_jsonb(o) as row from shift_type_overrides o where id = $1',
    [id],
  );
  return rows[0]?.['row'] as Record<string, unknown> | undefined;
}

describe('a shift-type override is removed by an active admin alone, attributed on the server (story 3.5b)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'removes a $fixture override as its admin: attributed, gone from the read, set again on the date, and every rotation row byte-identical',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');
        const type = await seededShiftType(client, organization, 'Slobodno');
        const override = { organization, team, date: '2026-10-01', type, reason: 'Zamjena' };
        const before = await rotationFingerprint(client);

        await actAs(client, owner.authUserId, organization);
        const first = await insertOverride(client, override);
        await actAsOwner(client);
        const live = await overrideRow(client, first);
        await actAs(client, owner.authUserId, organization);
        await removeOverride(client, first);
        const read = await calendarOverridesOf(client);
        // RE-SET: the partial key admits a new live override on the date.
        const second = await insertOverride(client, override);
        const again = await calendarOverridesOf(client);
        await actAsOwner(client);

        const { rows } = await client.query<{ removedBy: string; recent: boolean; reason: string }>(
          `select removed_by as "removedBy", removed_at > now() - interval '1 minute' as recent, reason
             from shift_type_overrides where id = $1`,
          [first],
        );
        expect(rows, `${slug}: the removal is not attributed to its caller`).toEqual([
          { removedBy: owner.authUserId, recent: true, reason: 'Zamjena' },
        ]);
        // Nothing but the removal pair changed on the row.
        const removed = await overrideRow(client, first);
        const { removed_by: _liveBy, removed_at: _liveAt, ...liveRest } = live ?? {};
        const { removed_by: _by, removed_at: _at, ...removedRest } = removed ?? {};
        expect(live?.['removed_at'], `${slug}: the override was not live`).toBeNull();
        expect(removedRest, `${slug}: a removal changed more than removed_by and removed_at`).toEqual(liveRest);
        expect(read.map((row) => row['id']), `${slug}: a removed override is read`).not.toContain(first);
        expect(again.map((row) => row['id']), `${slug}: the date cannot be set again`).toContain(second);
        expect(again.map((row) => row['id'])).not.toContain(first);
        expect(await rotationFingerprint(client), `${slug}: a set or a removal touched a rotation row`).toBe(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second removal of one $fixture override with P0002, and a removed row stays as it was',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');
        const type = await seededShiftType(client, organization, 'Slobodno');

        await actAs(client, owner.authUserId, organization);
        const id = await insertOverride(client, { organization, team, date: '2026-10-01', type, reason: 'x' });
        await removeOverride(client, id);
        await actAsOwner(client);
        const removed = await overrideRow(client, id);

        await actAs(client, owner.authUserId, organization);
        const twice = await refusedThenContinue(client, () => removeOverride(client, id));
        const unknown = await refusedThenContinue(client, () =>
          removeOverride(client, '00000000-0000-4000-8000-000000000000'),
        );
        await actAsOwner(client);

        expect(twice.code, `${slug}: an override was removed twice`).toBe('P0002');
        expect(unknown.code, `${slug}: an unknown override was removed`).toBe('P0002');
        expect(await overrideRow(client, id), `${slug}: a second removal changed the row`).toEqual(removed);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role account and an inactive admin with 42501, and changes nothing',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const other = await addThrowawayAdmin(client, organization);
        const team = await seededTeam(client, organization, 'Smjena A');
        const type = await seededShiftType(client, organization, 'Slobodno');

        await actAs(client, owner.authUserId, organization);
        const id = await insertOverride(client, { organization, team, date: '2026-10-01', type, reason: 'x' });
        await actAsOwner(client);
        await ownerVersion(client, {
          organization,
          member: other.id,
          active: false,
          from: await organizationDay(client, organization),
          by: owner.authUserId,
        });
        const before = await overrideRow(client, id);

        await actAs(client, self.authUserId, organization);
        const asMember = await refusedThenContinue(client, () => removeOverride(client, id));
        await actAsOwner(client);
        await actAs(client, other.authUserId, organization);
        const asInactive = await refusedThenContinue(client, () => removeOverride(client, id));
        await actAsOwner(client);
        await actAs(client, owner.authUserId, null);
        const noClaim = await refusedThenContinue(client, () => removeOverride(client, id));
        await actAsOwner(client);

        expect(asMember.code, `${slug}: a member-role account removed an override`).toBe('42501');
        expect(asInactive.code, `${slug}: an inactive admin removed an override`).toBe('42501');
        expect(noClaim.code, `${slug}: a session with no claim removed an override`).toBe('42501');
        expect(await overrideRow(client, id), `${slug}: a refused removal changed the row`).toEqual(before);
        expect(before?.['removed_at'], `${slug}: the override was not live`).toBeNull();
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'never lets a $fixture admin remove a $otherFixture override, under its own claim or a forged one',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const foreignOwner = await memberByUsername(
          client,
          otherSlug,
          FIXTURES.find((entry) => entry.slug === otherSlug)?.admin ?? '',
        );
        const { rows: foreign } = await client.query<{ id: string }>(
          'select id::text as id from shift_type_overrides where organization_id = $1 and removed_at is null',
          [foreignOwner.organizationId],
        );
        const target = foreign[0]?.id;
        expect(target, `${otherSlug} has no live override to remove`).toBeDefined();
        const id = target ?? '';
        const before = await overrideRow(client, id);

        await actAs(client, owner.authUserId, owner.organizationId);
        const ownClaim = await refusedThenContinue(client, () => removeOverride(client, id));
        await actAsOwner(client);
        await actAs(client, owner.authUserId, foreignOwner.organizationId);
        const forged = await refusedThenContinue(client, () => removeOverride(client, id));
        await actAsOwner(client);

        // Another tenant's id is indistinguishable from none under one's own
        // claim; a forged claim is refused before any row is looked at.
        expect(ownClaim.code, `${slug}: removed an override of ${otherSlug}`).toBe('P0002');
        expect(forged.code, `${slug}: a forged claim removed an override of ${otherSlug}`).toBe('42501');
        expect(await overrideRow(client, id), `${slug}: ${otherSlug}'s override changed`).toEqual(before);
      });
    },
  );

  it.skipIf(noApi)('refuses an anonymous caller the removal', async () => {
    const response = await rest('rpc/remove_shift_type_override', {
      method: 'POST',
      body: { p_override_id: '00000000-0000-4000-8000-000000000000' },
    });
    expect(response.status, 'an anonymous caller reached the removal').toBe(401);
    const refusal = await restRefusal(response);
    expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
    expect(refusal.message).toBe('permission denied for function remove_shift_type_override');
  });

  it.skipIf(noApi).each(FIXTURES)(
    'answers the $fixture removal over PostgREST: 42501 to a member, P0002 to an admin naming no live override',
    async ({ slug, admin, member }) => {
      const body = { p_override_id: '00000000-0000-4000-8000-000000000000' };
      const asMember = await rest('rpc/remove_shift_type_override', {
        token: await tokenFor(member, slug),
        method: 'POST',
        body,
      });
      expect(asMember.ok, `${slug}: a member-role account reached the removal`).toBe(false);
      expect((await restRefusal(asMember)).code).toBe('42501');

      const asAdmin = await rest('rpc/remove_shift_type_override', {
        token: await tokenFor(admin, slug),
        method: 'POST',
        body,
      });
      expect(asAdmin.ok, `${slug}: an unknown override was removed`).toBe(false);
      expect((await restRefusal(asAdmin)).code).toBe('P0002');
    },
    20_000,
  );
});

// ------------------------ story 3.5c: disposition of a pending override

/**
 * STORY 3.5c (`0022`). After a rotation change an admin confirms an override
 * through `confirm_shift_type_override()`, or amends it through
 * `amend_shift_type_override()`, which soft-removes the live row and inserts
 * its replacement in one transaction; discarding is 3.5b's removal. Both
 * attribute on the server, and every other caller is refused. Every SQL case
 * runs in a rolled-back transaction; the REST cases name an id no override
 * has, and so write nothing.
 */

/** `confirm_shift_type_override(id)`, as whoever the connection currently is. */
async function confirmOverride(client: Client, id: string): Promise<void> {
  await client.query('select public.confirm_shift_type_override($1::uuid)', [id]);
}

/** `amend_shift_type_override(id, type, reason)`, as whoever the connection currently is; the new id. */
async function amendOverride(client: Client, id: string, type: string, reason: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'select public.amend_shift_type_override($1::uuid, $2::uuid, $3)::text as id',
    [id, type, reason],
  );
  const replacement = rows[0]?.id;
  if (replacement === undefined) throw new Error('the amend returned no id');
  return replacement;
}

describe('a pending override is confirmed or amended by an active admin alone, attributed on the server (story 3.5c)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'confirms a $fixture override as its admin: attributed, read back as confirmed_at, nothing else changed, rotation rows byte-identical',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');
        const type = await seededShiftType(client, organization, 'Slobodno');
        const before = await rotationFingerprint(client);

        await actAs(client, owner.authUserId, organization);
        const id = await insertOverride(client, { organization, team, date: '2026-10-01', type, reason: 'x' });
        await actAsOwner(client);
        const live = await overrideRow(client, id);

        await actAs(client, owner.authUserId, organization);
        await confirmOverride(client, id);
        await actAsOwner(client);
        await actAs(client, self.authUserId, organization);
        const { rows: read } = await client.query<{ id: string; confirmed: boolean }>(
          `select id::text as id, confirmed_at is not null as confirmed from public.calendar_shift_type_overrides()`,
        );
        await actAsOwner(client);

        const confirmed = await overrideRow(client, id);
        expect(live?.['confirmed_at'], `${slug}: a fresh override is confirmed`).toBeNull();
        expect(confirmed?.['confirmed_by'], `${slug}: the confirmation is not attributed to its caller`).toBe(
          owner.authUserId,
        );
        expect(confirmed?.['confirmed_at'], `${slug}: the confirmation has no time`).not.toBeNull();
        const { confirmed_by: _liveBy, confirmed_at: _liveAt, ...liveRest } = live ?? {};
        const { confirmed_by: _by, confirmed_at: _at, ...confirmedRest } = confirmed ?? {};
        expect(confirmedRest, `${slug}: a confirmation changed more than confirmed_by and confirmed_at`).toEqual(liveRest);
        expect(read.find((row) => row.id === id), `${slug}: the member read lost confirmed_at`).toEqual({
          id,
          confirmed: true,
        });
        expect(await rotationFingerprint(client), `${slug}: a confirmation touched a rotation row`).toBe(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'amends a $fixture override as its admin: the old row removed, one live replacement, both attributed, rotation rows byte-identical',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');
        const off = await seededShiftType(client, organization, 'Slobodno');
        const { rows: types } = await client.query<{ id: string }>(
          `select id::text as id from shift_types where organization_id = $1 and id <> $2 and not archived order by name limit 1`,
          [organization, off],
        );
        const working = types[0]?.id ?? '';
        const before = await rotationFingerprint(client);

        await actAs(client, owner.authUserId, organization);
        const first = await insertOverride(client, { organization, team, date: '2026-10-01', type: off, reason: 'x' });
        await confirmOverride(client, first);
        const second = await amendOverride(client, first, working, '  Zamjena  ');
        const read = await calendarOverridesOf(client);
        await actAsOwner(client);

        const removed = await overrideRow(client, first);
        const replacement = await overrideRow(client, second);
        expect(second, `${slug}: the amend returned the old id`).not.toBe(first);
        expect(removed?.['removed_by'], `${slug}: the old row is not removed by the caller`).toBe(owner.authUserId);
        expect(removed?.['removed_at']).not.toBeNull();
        expect(replacement, `${slug}: the replacement is not the new fact, attributed by default`).toMatchObject({
          organization_id: organization,
          team_id: team,
          date: '2026-10-01',
          shift_type_id: working,
          reason: '  Zamjena  ',
          created_by: owner.authUserId,
          removed_by: null,
          removed_at: null,
          confirmed_by: null,
          confirmed_at: null,
        });
        const { rows: live } = await client.query<{ id: string }>(
          `select id::text as id from shift_type_overrides
            where organization_id = $1 and team_id = $2 and date = '2026-10-01' and removed_at is null`,
          [organization, team],
        );
        expect(live.map((row) => row.id), `${slug}: not exactly one live row after the amend`).toEqual([second]);
        expect(read.map((row) => row['id'])).toContain(second);
        expect(read.map((row) => row['id'])).not.toContain(first);
        expect(await rotationFingerprint(client), `${slug}: an amend touched a rotation row`).toBe(before);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'refuses a $fixture amend with a blank reason (23514) or a $otherFixture type (23503), and the old row stays live',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const foreignOwner = await memberByUsername(
          client,
          otherSlug,
          FIXTURES.find((entry) => entry.slug === otherSlug)?.admin ?? '',
        );
        const team = await seededTeam(client, organization, 'Smjena A');
        const type = await seededShiftType(client, organization, 'Slobodno');
        const foreignType = await seededShiftType(client, foreignOwner.organizationId, 'Slobodno');

        await actAs(client, owner.authUserId, organization);
        const id = await insertOverride(client, { organization, team, date: '2026-10-01', type, reason: 'x' });
        await actAsOwner(client);
        const before = await overrideRow(client, id);

        await actAs(client, owner.authUserId, organization);
        const blank = await refusedThenContinue(client, () => amendOverride(client, id, type, ' \t\n '));
        const long = await refusedThenContinue(client, () => amendOverride(client, id, type, 'y'.repeat(201)));
        const foreign = await refusedThenContinue(client, () => amendOverride(client, id, foreignType, 'Zamjena'));
        await actAsOwner(client);

        expect(blank.code, `${slug}: a blank reason was admitted`).toBe('23514');
        expect(long.code, `${slug}: a 201-character reason was admitted`).toBe('23514');
        expect(foreign.code, `${slug}: a type of ${otherSlug} was admitted`).toBe('23503');
        expect(await overrideRow(client, id), `${slug}: a refused amend removed the old row`).toEqual(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture confirm or amend over an archived team or type with P0001, and the old row stays live and unchanged',
    async ({ slug, admin }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');
        const off = await seededShiftType(client, organization, 'Slobodno');
        const { rows: types } = await client.query<{ id: string }>(
          `select id::text as id from shift_types where organization_id = $1 and id <> $2 and not archived order by name limit 1`,
          [organization, off],
        );
        const other = types[0]?.id ?? '';

        await actAs(client, owner.authUserId, organization);
        const id = await insertOverride(client, { organization, team, date: '2026-10-01', type: off, reason: 'x' });
        await actAsOwner(client);
        const before = await overrideRow(client, id);

        /** Archive `table`'s row `target` as the owner, run `work` as the admin, and put it back. */
        async function whileArchived(table: 'teams' | 'shift_types', target: string, work: () => Promise<unknown>) {
          await client.query(`update ${table} set archived = true where id = $1`, [target]);
          await actAs(client, owner.authUserId, organization);
          const refusal = await refusedThenContinue(client, work);
          await actAsOwner(client);
          await client.query(`update ${table} set archived = false where id = $1`, [target]);

          return refusal;
        }

        const cases = {
          'amend to an archived type': await whileArchived('shift_types', other, () =>
            amendOverride(client, id, other, 'Zamjena'),
          ),
          'amend on an archived team': await whileArchived('teams', team, () => amendOverride(client, id, other, 'Zamjena')),
          'confirm on an archived team': await whileArchived('teams', team, () => confirmOverride(client, id)),
          'confirm of an archived type': await whileArchived('shift_types', off, () => confirmOverride(client, id)),
        };

        for (const [label, refusal] of Object.entries(cases)) {
          expect(refusal, `${slug}: ${label}`).toEqual({ code: 'P0001', message: 'SHIFT_TYPE_OVERRIDE_ARCHIVED' });
        }
        expect(await overrideRow(client, id), `${slug}: a refused disposition changed the row`).toEqual(before);
        const { rows: live } = await client.query<{ id: string }>(
          `select id::text as id from shift_type_overrides
            where organization_id = $1 and team_id = $2 and date = '2026-10-01' and removed_at is null`,
          [organization, team],
        );
        expect(live.map((row) => row.id), `${slug}: the old row is not the one live row`).toEqual([id]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role account, an inactive admin and a session with no claim with 42501, and changes nothing',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const other = await addThrowawayAdmin(client, organization);
        const team = await seededTeam(client, organization, 'Smjena A');
        const type = await seededShiftType(client, organization, 'Slobodno');

        await actAs(client, owner.authUserId, organization);
        const id = await insertOverride(client, { organization, team, date: '2026-10-01', type, reason: 'x' });
        await actAsOwner(client);
        await ownerVersion(client, {
          organization,
          member: other.id,
          active: false,
          from: await organizationDay(client, organization),
          by: owner.authUserId,
        });
        const before = await overrideRow(client, id);

        const callers = [
          { label: 'a member-role account', user: self.authUserId, claim: organization as string | null },
          { label: 'an inactive admin', user: other.authUserId, claim: organization as string | null },
          { label: 'a session with no claim', user: owner.authUserId, claim: null },
        ];
        for (const { label, user, claim } of callers) {
          await actAs(client, user, claim);
          const confirm = await refusedThenContinue(client, () => confirmOverride(client, id));
          const amend = await refusedThenContinue(client, () => amendOverride(client, id, type, 'Zamjena'));
          await actAsOwner(client);
          expect(confirm.code, `${slug}: ${label} confirmed an override`).toBe('42501');
          expect(amend.code, `${slug}: ${label} amended an override`).toBe('42501');
        }
        expect(await overrideRow(client, id), `${slug}: a refused disposition changed the row`).toEqual(before);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'never lets a $fixture admin confirm or amend a $otherFixture override, or a removed one of its own',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const organization = owner.organizationId;
        const foreignOwner = await memberByUsername(
          client,
          otherSlug,
          FIXTURES.find((entry) => entry.slug === otherSlug)?.admin ?? '',
        );
        const { rows: foreign } = await client.query<{ id: string }>(
          'select id::text as id from shift_type_overrides where organization_id = $1 and removed_at is null',
          [foreignOwner.organizationId],
        );
        const target = foreign[0]?.id ?? '';
        expect(target, `${otherSlug} has no live override`).not.toBe('');
        const team = await seededTeam(client, organization, 'Smjena A');
        const type = await seededShiftType(client, organization, 'Slobodno');
        const before = await overrideRow(client, target);

        await actAs(client, owner.authUserId, organization);
        const gone = await insertOverride(client, { organization, team, date: '2026-10-01', type, reason: 'x' });
        await removeOverride(client, gone);
        const results = {
          foreignConfirm: await refusedThenContinue(client, () => confirmOverride(client, target)),
          foreignAmend: await refusedThenContinue(client, () => amendOverride(client, target, type, 'Zamjena')),
          removedConfirm: await refusedThenContinue(client, () => confirmOverride(client, gone)),
          removedAmend: await refusedThenContinue(client, () => amendOverride(client, gone, type, 'Zamjena')),
        };
        await actAsOwner(client);
        await actAs(client, owner.authUserId, foreignOwner.organizationId);
        const forged = await refusedThenContinue(client, () => confirmOverride(client, target));
        await actAsOwner(client);

        for (const [label, refusal] of Object.entries(results)) {
          expect(refusal.code, `${slug}: ${label}`).toBe('P0002');
        }
        expect(forged.code, `${slug}: a forged claim confirmed an override of ${otherSlug}`).toBe('42501');
        expect(await overrideRow(client, target), `${slug}: ${otherSlug}'s override changed`).toEqual(before);
      });
    },
  );

  it.skipIf(noApi).each([
    { name: 'confirm_shift_type_override', body: { p_override_id: '00000000-0000-4000-8000-000000000000' } },
    {
      name: 'amend_shift_type_override',
      body: {
        p_override_id: '00000000-0000-4000-8000-000000000000',
        p_shift_type_id: '00000000-0000-4000-8000-000000000000',
        p_reason: 'x',
      },
    },
  ])('refuses an anonymous caller $name', async ({ name, body }) => {
    const response = await rest(`rpc/${name}`, { method: 'POST', body });
    expect(response.status, `an anonymous caller reached ${name}`).toBe(401);
    const refusal = await restRefusal(response);
    expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
    expect(refusal.message).toBe(`permission denied for function ${name}`);
  });

  it.skipIf(noApi).each(FIXTURES)(
    'answers the $fixture confirm and amend over PostgREST: 42501 to a member, P0002 to an admin naming no live override',
    async ({ slug, admin, member }) => {
      const nobody = '00000000-0000-4000-8000-000000000000';
      const calls = [
        { name: 'confirm_shift_type_override', body: { p_override_id: nobody } },
        { name: 'amend_shift_type_override', body: { p_override_id: nobody, p_shift_type_id: nobody, p_reason: 'x' } },
      ];
      for (const { name, body } of calls) {
        const asMember = await rest(`rpc/${name}`, { token: await tokenFor(member, slug), method: 'POST', body });
        expect(asMember.ok, `${slug}: a member-role account reached ${name}`).toBe(false);
        expect((await restRefusal(asMember)).code).toBe('42501');

        const asAdmin = await rest(`rpc/${name}`, { token: await tokenFor(admin, slug), method: 'POST', body });
        expect(asAdmin.ok, `${slug}: ${name} reached an unknown override`).toBe(false);
        expect((await restRefusal(asAdmin)).code).toBe('P0002');
      }
    },
    20_000,
  );
});

// ---------------------------------------------- story 3.6a: roster overrides

/**
 * STORY 3.6a (`0026`). One row per roster action — a member taken off a
 * team's shift on a date, one put on, or both at once — read and written by
 * an active admin alone, read by every active member through
 * `calendar_roster_overrides()`. Every SQL case runs in a rolled-back
 * transaction; the REST cases write nothing.
 */

/** The seeded roster override per fixture: its team, date, members by username, and reason. */
const SEEDED_ROSTER_OVERRIDES: Readonly<
  Record<string, { team: string; date: string; out: string | null; in: string | null; reason: string }>
> = {
  'dvd-kastel-novi': {
    team: 'Smjena A',
    date: '2026-09-14',
    out: 'ana.kovac',
    in: 'marko.novak',
    reason: 'Zamjena zbog bolovanja.',
  },
  'zastita-split': {
    team: 'Smjena B',
    date: '2026-09-14',
    out: null,
    in: 'tomislav.juric',
    reason: 'Pojačanje za izvanredni događaj.',
  },
};

function seededRosterOverrideOf(slug: string): { team: string; date: string; out: string | null; in: string | null; reason: string } {
  const seeded = SEEDED_ROSTER_OVERRIDES[slug];
  if (seeded === undefined) throw new Error(`no seeded roster override is recorded for ${slug}`);
  return seeded;
}

/** `calendar_roster_overrides()`, as whoever the connection currently is. */
async function calendarRosterOverridesOf(client: Client): Promise<Record<string, unknown>[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    `select id::text as id, team_id::text as team_id, date::text as date,
            member_out_id::text as member_out_id, member_in_id::text as member_in_id,
            reason, created_at, author_member_id::text as author_member_id
       from public.calendar_roster_overrides()`,
  );
  return rows;
}

/** The columns the function answers, exactly, whatever the caller. */
async function calendarRosterOverrideColumns(client: Client): Promise<string[]> {
  const { fields } = await client.query('select * from public.calendar_roster_overrides() limit 0');
  return fields.map((field) => field.name);
}

/** One roster override, written as whoever the connection currently is: the six columns a session may name. */
async function insertRosterOverride(
  client: Client,
  override: { organization: string; team: string; date: string; out: string | null; in: string | null; reason: string },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason)
     values ($1, $2, $3::date, $4, $5, $6)
     returning id`,
    [override.organization, override.team, override.date, override.out, override.in, override.reason],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('the roster override insert returned no id');
  return id;
}

/** Every rotation, membership and status row of every organization, whole, as text (CAP-12, DI-2). */
async function scheduleRulesFingerprint(client: Client): Promise<string> {
  const { rows } = await client.query<{ digest: string }>(
    `select md5(coalesce(string_agg(body, E'\\n' order by body), '')) as digest
       from (
         select 'p:' || to_jsonb(x)::text as body from rotation_patterns x
         union all select 's:' || to_jsonb(x)::text from rotation_steps x
         union all select 'a:' || to_jsonb(x)::text from rotation_assignments x
         union all select 'm:' || to_jsonb(x)::text from team_membership_versions x
         union all select 'v:' || to_jsonb(x)::text from member_status_versions x
         union all select 'u:' || to_jsonb(x)::text from members x
       ) as everything`,
  );
  return rows[0]?.digest ?? '';
}

describe('a roster override is recorded by an admin alone and read by every member (story 3.6a)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'seeds one $fixture roster override, attributed to its admin, and names that admin as a member',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const seeded = seededRosterOverrideOf(slug);
        const team = await seededTeam(client, owner.organizationId, seeded.team);
        const out = seeded.out === null ? null : (await memberByUsername(client, slug, seeded.out)).id;
        const put = seeded.in === null ? null : (await memberByUsername(client, slug, seeded.in)).id;

        const { rows: stored } = await client.query<{ createdBy: string; removedAt: unknown }>(
          `select created_by as "createdBy", removed_at as "removedAt" from roster_overrides
            where organization_id = $1`,
          [owner.organizationId],
        );
        expect(stored, `${slug}: the seed is not one live roster override by its admin`).toEqual([
          { createdBy: owner.authUserId, removedAt: null },
        ]);

        for (const reader of [self, owner]) {
          await actAs(client, reader.authUserId, owner.organizationId);
          const rows = await calendarRosterOverridesOf(client);
          const columns = await calendarRosterOverrideColumns(client);
          await actAsOwner(client);

          expect(columns, `${slug}: the read answers another shape`).toEqual([
            'id',
            'team_id',
            'date',
            'member_out_id',
            'member_in_id',
            'reason',
            'created_at',
            'author_member_id',
          ]);
          expect(
            rows.map(({ id: _id, created_at: _at, ...rest }) => rest),
            `${slug} as ${reader.role}`,
          ).toEqual([
            {
              team_id: team,
              date: seeded.date,
              member_out_id: out,
              member_in_id: put,
              reason: seeded.reason,
              author_member_id: owner.id,
            },
          ]);
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'records a $fixture admin replacement, addition and removal, attributed by default, and leaves every rotation, membership and status row byte-identical',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena C');
        const before = await scheduleRulesFingerprint(client);

        await actAs(client, owner.authUserId, organization);
        const replace = await insertRosterOverride(client, {
          organization,
          team,
          date: '2021-03-04',
          out: self.id,
          in: other.id,
          reason: 'x',
        });
        const add = await insertRosterOverride(client, {
          organization,
          team,
          date: '2031-03-04',
          out: null,
          in: self.id,
          reason: 'y'.repeat(200),
        });
        const remove = await insertRosterOverride(client, {
          organization,
          team,
          date: '2031-03-04',
          out: other.id,
          in: null,
          reason: 'z',
        });
        const { rows: visible } = await client.query<{ id: string }>(
          'select id from roster_overrides where id in ($1, $2, $3) order by date, reason',
          [replace, add, remove],
        );
        await actAsOwner(client);

        expect(visible.map((row) => row.id), `${slug}: the admin cannot read what it wrote`).toEqual([
          replace,
          add,
          remove,
        ]);
        const { rows } = await client.query<{ createdBy: string; recent: boolean }>(
          `select created_by as "createdBy", created_at > now() - interval '1 minute' as recent
             from roster_overrides where id in ($1, $2, $3)`,
          [replace, add, remove],
        );
        expect(rows).toEqual([
          { createdBy: owner.authUserId, recent: true },
          { createdBy: owner.authUserId, recent: true },
          { createdBy: owner.authUserId, recent: true },
        ]);
        expect(
          await scheduleRulesFingerprint(client),
          `${slug}: a roster override touched a rotation, membership or status row`,
        ).toBe(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'shows a $fixture member-role account no table row, refuses its insert, and answers it the rpc',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');

        await actAs(client, self.authUserId, organization);
        const { rows: table } = await client.query('select * from roster_overrides');
        const viaRpc = await calendarRosterOverridesOf(client);
        const refusal = await refusedThenContinue(client, () =>
          insertRosterOverride(client, { organization, team, date: '2026-10-01', out: null, in: other.id, reason: 'x' }),
        );
        await actAsOwner(client);

        expect(table, `${slug}: a member-role account read the table`).toEqual([]);
        expect(viaRpc.length, `${slug}: a member-role account lost the rpc`).toBe(1);
        expect(refusal.code, `${slug}: a member-role account wrote a roster override`).toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'answers a $fixture caller inactive today nothing, and refuses an inactive admin',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const other = await addThrowawayAdmin(client, organization);
        const team = await seededTeam(client, organization, 'Smjena A');
        await ownerVersion(client, {
          organization,
          member: other.id,
          active: false,
          from: await organizationDay(client, organization),
          by: owner.authUserId,
        });

        await actAs(client, other.authUserId, organization);
        const rows = await calendarRosterOverridesOf(client);
        const { rows: table } = await client.query('select * from roster_overrides');
        const refusal = await refusedThenContinue(client, () =>
          insertRosterOverride(client, { organization, team, date: '2026-10-01', out: null, in: self.id, reason: 'x' }),
        );
        await actAsOwner(client);

        expect(rows, `${slug}: an inactive caller read the roster overrides`).toEqual([]);
        expect(table, `${slug}: an inactive admin read the table`).toEqual([]);
        expect(refusal.code, `${slug}: an inactive admin wrote a roster override`).toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'answers a $fixture caller nothing of $otherFixture, under its own claim, a forged one or none, and refuses its team and members',
    async ({ slug, admin, member, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const foreignFixture = FIXTURES.find((entry) => entry.slug === otherSlug);
        const foreignOwner = await memberByUsername(client, otherSlug, foreignFixture?.admin ?? '');
        const foreignMember = await memberByUsername(client, otherSlug, foreignFixture?.member ?? '');
        const { rows: foreign } = await client.query<{ id: string }>(
          'select id::text as id from roster_overrides where organization_id = $1',
          [foreignOwner.organizationId],
        );
        expect(foreign.length, `${otherSlug} has no roster override to leak`).toBeGreaterThan(0);
        const ownTeam = await seededTeam(client, owner.organizationId, 'Smjena A');
        const foreignTeam = await seededTeam(client, foreignOwner.organizationId, 'Smjena A');

        for (const reader of [self, owner]) {
          await actAs(client, reader.authUserId, reader.organizationId);
          const own = await calendarRosterOverridesOf(client);
          const { rows: table } = await client.query<{ id: string }>('select id::text as id from roster_overrides');
          await actAsOwner(client);

          expect(own.length, `${slug}: its own roster overrides`).toBeGreaterThan(0);
          for (const row of [...own, ...table]) {
            expect(foreign.map((one) => one.id), `${slug}: another tenant's roster override`).not.toContain(row['id']);
          }

          await actAs(client, reader.authUserId, foreignOwner.organizationId);
          expect(await calendarRosterOverridesOf(client), `${slug}: a forged claim read roster overrides`).toEqual([]);
          await actAsOwner(client);
          await actAs(client, reader.authUserId, null);
          expect(await calendarRosterOverridesOf(client), `${slug}: no claim read roster overrides`).toEqual([]);
          await actAsOwner(client);
        }

        await actAs(client, owner.authUserId, owner.organizationId);
        const codes: Record<string, string> = {};
        // Another tenant's team, or member taken off or put on, under the admin's own tenant: the keys refuse it.
        codes['foreign team'] = (
          await refusedThenContinue(client, () =>
            insertRosterOverride(client, {
              organization: owner.organizationId,
              team: foreignTeam,
              date: '2026-10-01',
              out: null,
              in: self.id,
              reason: 'x',
            }),
          )
        ).code;
        codes['foreign member put on'] = (
          await refusedThenContinue(client, () =>
            insertRosterOverride(client, {
              organization: owner.organizationId,
              team: ownTeam,
              date: '2026-10-01',
              out: null,
              in: foreignMember.id,
              reason: 'x',
            }),
          )
        ).code;
        codes['foreign member taken off'] = (
          await refusedThenContinue(client, () =>
            insertRosterOverride(client, {
              organization: owner.organizationId,
              team: ownTeam,
              date: '2026-10-01',
              out: foreignMember.id,
              in: self.id,
              reason: 'x',
            }),
          )
        ).code;
        // A roster override written into the other tenant: the policy refuses it.
        codes['foreign tenant'] = (
          await refusedThenContinue(client, () =>
            insertRosterOverride(client, {
              organization: foreignOwner.organizationId,
              team: foreignTeam,
              date: '2026-10-01',
              out: null,
              in: foreignMember.id,
              reason: 'x',
            }),
          )
        ).code;
        await actAsOwner(client);

        expect(codes, slug).toEqual({
          'foreign team': '23503',
          'foreign member put on': '23503',
          'foreign member taken off': '23503',
          'foreign tenant': '42501',
        });
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member taken off or put on one live shift twice, and admits it again once the first is removed',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');
        const elsewhere = await seededTeam(client, organization, 'Smjena B');
        const on = { organization, team, date: '2026-10-01', reason: 'x' };

        await actAs(client, owner.authUserId, organization);
        const first = await insertRosterOverride(client, { ...on, out: self.id, in: other.id });
        const outTwice = await refusedThenContinue(client, () =>
          insertRosterOverride(client, { ...on, out: self.id, in: null }),
        );
        const inTwice = await refusedThenContinue(client, () =>
          insertRosterOverride(client, { ...on, out: null, in: other.id }),
        );
        // The same member on another team's shift, or on another date, is another action.
        await insertRosterOverride(client, { ...on, team: elsewhere, out: null, in: other.id });
        await insertRosterOverride(client, { ...on, date: '2026-10-02', out: self.id, in: null });
        await actAsOwner(client);
        expect(outTwice.code, `${slug}: one member taken off one shift twice`).toBe('23505');
        expect(inTwice.code, `${slug}: one member put on one shift twice`).toBe('23505');

        // Story 3.6b's removal, as the admin: 0027's definer attributes it.
        await actAs(client, owner.authUserId, organization);
        await removeRosterOverride(client, first);
        const second = await insertRosterOverride(client, { ...on, out: self.id, in: other.id });
        const read = await calendarRosterOverridesOf(client);
        await actAsOwner(client);

        expect(read.map((row) => row['id']), `${slug}: the removed roster override is read`).not.toContain(first);
        expect(read.map((row) => row['id'])).toContain(second);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture roster override naming no member or one member twice, a blank or overlong reason, an archived team, a forged author, an update, a delete and a half-recorded removal',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');
        const archivedTeam = (await addThrowawayTeam(client, organization, owner.authUserId, true)).id;
        const valid = { organization, team, date: '2026-10-01', out: self.id, in: other.id, reason: 'x' };

        await actAs(client, owner.authUserId, organization);
        const codes: Record<string, string> = {};
        for (const [label, change] of [
          ['no member', { out: null, in: null }],
          ['one member twice', { out: self.id, in: self.id }],
          ['blank', { reason: '  ' }],
          ['empty', { reason: '' }],
          ['tabs and line breaks', { reason: '\t\n\r\t' }],
          ['overlong', { reason: 'z'.repeat(201) }],
          ['archived team', { team: archivedTeam }],
        ] as const) {
          codes[label] = (await refusedThenContinue(client, () => insertRosterOverride(client, { ...valid, ...change })))
            .code;
        }
        codes['forged author'] = (
          await refusedThenContinue(client, () =>
            client.query(
              `insert into roster_overrides (organization_id, team_id, date, member_in_id, reason, created_by)
               values ($1, $2, '2026-10-01', $3, 'x', $4)`,
              [organization, team, other.id, owner.authUserId],
            ),
          )
        ).code;
        codes['update'] = (
          await refusedThenContinue(client, () => client.query('update roster_overrides set removed_at = now()'))
        ).code;
        codes['delete'] = (await refusedThenContinue(client, () => client.query('delete from roster_overrides'))).code;
        await actAsOwner(client);

        const halfRemoved = await refusedThenContinue(client, () =>
          client.query('update roster_overrides set removed_at = now() where organization_id = $1', [organization]),
        );

        expect(codes, slug).toEqual({
          'no member': '23514',
          'one member twice': '23514',
          blank: '23514',
          empty: '23514',
          'tabs and line breaks': '23514',
          overlong: '23514',
          'archived team': '42501',
          'forged author': '42501',
          update: '42501',
          delete: '42501',
        });
        expect(halfRemoved.code, `${slug}: a removal without its author`).toBe('23514');
      });
    },
  );

  it.skipIf(noDatabase)('names an author who is no member of the organization as nobody', async () => {
    await inRolledBackTransaction(async (client) => {
      const [fixture, other] = FIXTURES;
      const owner = await memberByUsername(client, fixture.slug, fixture.admin);
      const self = await memberByUsername(client, fixture.slug, fixture.member);
      const stranger = await memberByUsername(client, other.slug, other.admin);
      const organization = owner.organizationId;
      const team = await seededTeam(client, organization, 'Smjena B');
      // As the owner, past the policy: an auth user of ANOTHER organization, and nobody at all.
      const { rows } = await client.query<{ id: string }>(
        `insert into roster_overrides (organization_id, team_id, date, member_in_id, reason, created_by)
         values ($1, $2, '2026-10-01', $3, 'x', $4), ($1, $2, '2026-10-02', $3, 'x', gen_random_uuid())
         returning id::text as id`,
        [organization, team, self.id, stranger.authUserId],
      );

      await actAs(client, self.authUserId, organization);
      const read = await calendarRosterOverridesOf(client);
      await actAsOwner(client);

      expect(rows).toHaveLength(2);
      for (const { id } of rows) {
        const row = read.find((one) => one['id'] === id);
        expect(row, id).toBeDefined();
        expect(row?.['author_member_id'], id).toBeNull();
      }
    });
  });

  it.skipIf(noApi)('refuses an anonymous caller the table and the rpc', async () => {
    const table = await rest('roster_overrides?select=*');
    expect(table.status, 'an anonymous caller read roster_overrides').toBe(401);
    expect((await restRefusal(table)).code, 'a privilege refusal is 42501').toBe('42501');

    const rpc = await rest('rpc/calendar_roster_overrides', { method: 'POST', body: {} });
    expect(rpc.status, 'an anonymous caller reached the roster overrides').toBe(401);
    const refusal = await restRefusal(rpc);
    expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
    expect(refusal.message).toBe('permission denied for function calendar_roster_overrides');
  });

  it.skipIf(noApi).each(FIXTURES)(
    'answers the $fixture roster overrides over PostgREST to member and admin, and the table to the admin alone',
    async ({ slug, admin, member }) => {
      for (const reader of [member, admin]) {
        const token = await tokenFor(reader, slug);
        const response = await rest('rpc/calendar_roster_overrides', { token, method: 'POST', body: {} });
        expect(response.status, `${reader}: ${await response.clone().text()}`).toBe(200);
        const rows = (await response.json()) as Record<string, unknown>[];

        expect(rows.some((row) => row['date'] === seededRosterOverrideOf(slug).date), `${slug}/${reader}`).toBe(true);
        for (const row of rows) {
          expect(Object.keys(row).sort(), `${slug}/${reader}: another shape`).toEqual([
            'author_member_id',
            'created_at',
            'date',
            'id',
            'member_in_id',
            'member_out_id',
            'reason',
            'team_id',
          ]);
        }
        const table = await restRows('roster_overrides?select=id', { token });
        expect(table.length > 0, `${slug}/${reader} reads the table`).toBe(reader === admin);
      }
    },
    20_000,
  );
});

// ------------------------------------ story 3.6b: removing a roster override

/**
 * STORY 3.6b (`0027`). An active admin soft-removes a live roster override
 * through `remove_roster_override()`, which attributes the removal itself;
 * every other caller is refused, and nothing but that one row's `removed_by`
 * and `removed_at` changes. Every SQL case runs in a rolled-back transaction;
 * the REST cases name an id no roster override has, and so write nothing.
 */

/** `remove_roster_override(id)`, as whoever the connection currently is. */
async function removeRosterOverride(client: Client, id: string): Promise<void> {
  await client.query('select public.remove_roster_override($1::uuid)', [id]);
}

/** One roster override row, whole, as the owner sees it. */
async function rosterOverrideRow(client: Client, id: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await client.query<Record<string, unknown>>(
    'select to_jsonb(o) as row from roster_overrides o where id = $1',
    [id],
  );
  return rows[0]?.['row'] as Record<string, unknown> | undefined;
}

describe('a roster override is removed by an active admin alone, attributed on the server (story 3.6b)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'removes a $fixture replacement as its admin: attributed, gone from the read, written again, and every rotation, membership and status row byte-identical',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena C');
        const change = { organization, team, date: '2026-10-01', out: self.id, in: other.id, reason: 'Zamjena' };
        const before = await scheduleRulesFingerprint(client);

        await actAs(client, owner.authUserId, organization);
        const first = await insertRosterOverride(client, change);
        await actAsOwner(client);
        const live = await rosterOverrideRow(client, first);
        const afterInsert = await scheduleRulesFingerprint(client);
        await actAs(client, owner.authUserId, organization);
        await removeRosterOverride(client, first);
        const read = await calendarRosterOverridesOf(client);
        // RE-INSERT: the partial keys admit the same members on the shift again.
        const second = await insertRosterOverride(client, change);
        const again = await calendarRosterOverridesOf(client);
        await actAsOwner(client);

        const { rows } = await client.query<{ removedBy: string; recent: boolean; reason: string }>(
          `select removed_by as "removedBy", removed_at > now() - interval '1 minute' as recent, reason
             from roster_overrides where id = $1`,
          [first],
        );
        expect(rows, `${slug}: the removal is not attributed to its caller`).toEqual([
          { removedBy: owner.authUserId, recent: true, reason: 'Zamjena' },
        ]);
        // Nothing but the removal pair changed on the row.
        const removed = await rosterOverrideRow(client, first);
        const { removed_by: _liveBy, removed_at: _liveAt, ...liveRest } = live ?? {};
        const { removed_by: _by, removed_at: _at, ...removedRest } = removed ?? {};
        expect(live?.['removed_at'], `${slug}: the roster override was not live`).toBeNull();
        expect(removedRest, `${slug}: a removal changed more than removed_by and removed_at`).toEqual(liveRest);
        expect(read.map((row) => row['id']), `${slug}: a removed roster override is read`).not.toContain(first);
        expect(again.map((row) => row['id']), `${slug}: the members cannot be changed again`).toContain(second);
        expect(again.map((row) => row['id'])).not.toContain(first);
        expect(afterInsert, `${slug}: an insert touched a rotation, membership or status row`).toBe(before);
        expect(
          await scheduleRulesFingerprint(client),
          `${slug}: a removal touched a rotation, membership or status row`,
        ).toBe(before);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second removal of one $fixture roster override with P0002, and a removed row stays as it was',
    async ({ slug, admin, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const team = await seededTeam(client, organization, 'Smjena A');

        await actAs(client, owner.authUserId, organization);
        const id = await insertRosterOverride(client, {
          organization,
          team,
          date: '2026-10-01',
          out: null,
          in: other.id,
          reason: 'x',
        });
        await removeRosterOverride(client, id);
        await actAsOwner(client);
        const removed = await rosterOverrideRow(client, id);

        await actAs(client, owner.authUserId, organization);
        const twice = await refusedThenContinue(client, () => removeRosterOverride(client, id));
        const unknown = await refusedThenContinue(client, () =>
          removeRosterOverride(client, '00000000-0000-4000-8000-000000000000'),
        );
        await actAsOwner(client);

        expect(twice.code, `${slug}: a roster override was removed twice`).toBe('P0002');
        expect(unknown.code, `${slug}: an unknown roster override was removed`).toBe('P0002');
        expect(await rosterOverrideRow(client, id), `${slug}: a second removal changed the row`).toEqual(removed);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role account, an inactive admin and a session with no claim with 42501, and changes nothing',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const bystanding = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const other = await addThrowawayAdmin(client, organization);
        const team = await seededTeam(client, organization, 'Smjena A');

        await actAs(client, owner.authUserId, organization);
        const id = await insertRosterOverride(client, {
          organization,
          team,
          date: '2026-10-01',
          out: null,
          in: bystanding.id,
          reason: 'x',
        });
        await actAsOwner(client);
        await ownerVersion(client, {
          organization,
          member: other.id,
          active: false,
          from: await organizationDay(client, organization),
          by: owner.authUserId,
        });
        const before = await rosterOverrideRow(client, id);

        await actAs(client, self.authUserId, organization);
        const asMember = await refusedThenContinue(client, () => removeRosterOverride(client, id));
        await actAsOwner(client);
        await actAs(client, other.authUserId, organization);
        const asInactive = await refusedThenContinue(client, () => removeRosterOverride(client, id));
        await actAsOwner(client);
        await actAs(client, owner.authUserId, null);
        const noClaim = await refusedThenContinue(client, () => removeRosterOverride(client, id));
        await actAsOwner(client);

        expect(asMember.code, `${slug}: a member-role account removed a roster override`).toBe('42501');
        expect(asInactive.code, `${slug}: an inactive admin removed a roster override`).toBe('42501');
        expect(noClaim.code, `${slug}: a session with no claim removed a roster override`).toBe('42501');
        expect(await rosterOverrideRow(client, id), `${slug}: a refused removal changed the row`).toEqual(before);
        expect(before?.['removed_at'], `${slug}: the roster override was not live`).toBeNull();
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'never lets a $fixture admin remove a $otherFixture roster override, under its own claim or a forged one',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const foreignOwner = await memberByUsername(
          client,
          otherSlug,
          FIXTURES.find((entry) => entry.slug === otherSlug)?.admin ?? '',
        );
        const foreignMember = await memberByUsername(
          client,
          otherSlug,
          FIXTURES.find((entry) => entry.slug === otherSlug)?.member ?? '',
        );
        const foreignTeam = await seededTeam(client, foreignOwner.organizationId, 'Smjena A');
        // The target is written here, as the other tenant's admin, so the case
        // never rests on what that fixture happens to seed.
        await actAs(client, foreignOwner.authUserId, foreignOwner.organizationId);
        const id = await insertRosterOverride(client, {
          organization: foreignOwner.organizationId,
          team: foreignTeam,
          date: '2026-10-07',
          out: null,
          in: foreignMember.id,
          reason: 'x',
        });
        await actAsOwner(client);
        const before = await rosterOverrideRow(client, id);
        expect(before?.['removed_at'], `${otherSlug}'s roster override is not live`).toBeNull();

        await actAs(client, owner.authUserId, owner.organizationId);
        const ownClaim = await refusedThenContinue(client, () => removeRosterOverride(client, id));
        await actAsOwner(client);
        await actAs(client, owner.authUserId, foreignOwner.organizationId);
        const forged = await refusedThenContinue(client, () => removeRosterOverride(client, id));
        await actAsOwner(client);

        // Another tenant's id is indistinguishable from none under one's own
        // claim; a forged claim is refused before any row is looked at.
        expect(ownClaim.code, `${slug}: removed a roster override of ${otherSlug}`).toBe('P0002');
        expect(forged.code, `${slug}: a forged claim removed a roster override of ${otherSlug}`).toBe('42501');
        expect(await rosterOverrideRow(client, id), `${slug}: ${otherSlug}'s roster override changed`).toEqual(before);
      });
    },
  );

  it.skipIf(noApi)('refuses an anonymous caller the removal', async () => {
    const response = await rest('rpc/remove_roster_override', {
      method: 'POST',
      body: { p_override_id: '00000000-0000-4000-8000-000000000000' },
    });
    expect(response.status, 'an anonymous caller reached the removal').toBe(401);
    const refusal = await restRefusal(response);
    expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
    expect(refusal.message).toBe('permission denied for function remove_roster_override');
  });

  it.skipIf(noApi).each(FIXTURES)(
    'answers the $fixture roster removal over PostgREST: 42501 to a member, P0002 to an admin naming no live roster override',
    async ({ slug, admin, member }) => {
      const body = { p_override_id: '00000000-0000-4000-8000-000000000000' };
      const asMember = await rest('rpc/remove_roster_override', {
        token: await tokenFor(member, slug),
        method: 'POST',
        body,
      });
      expect(asMember.ok, `${slug}: a member-role account reached the removal`).toBe(false);
      expect((await restRefusal(asMember)).code).toBe('42501');

      const asAdmin = await rest('rpc/remove_roster_override', {
        token: await tokenFor(admin, slug),
        method: 'POST',
        body,
      });
      expect(asAdmin.ok, `${slug}: an unknown roster override was removed`).toBe(false);
      expect((await restRefusal(asAdmin)).code).toBe('P0002');
    },
    20_000,
  );
});

// ------------------------------------------------ story 5.1b: leave records

/**
 * STORY 5.1b (`0028`). An active admin records one member's leave as an
 * inclusive date range; the database refuses a live overlap for the same
 * member by exclusion (R4.4, AD-3, R8.3), saves an over-balance record (R4.7),
 * and nothing in the schedule changes (R4.1, DI-3). A member reads their own
 * records alone. Every SQL case runs in a rolled-back transaction; the REST
 * cases commit inside year 2040 and delete what they wrote in `finally`.
 */

/**
 * One leave record, written as whoever the connection currently is: the three
 * columns a session may name. `by` is for the owner alone, past the policy,
 * where `auth.uid()` — the attribution's default — is null.
 */
async function insertLeave(
  client: Client,
  leave: { organization: string; member: string; during: string; by?: string },
): Promise<string> {
  const { rows } =
    leave.by === undefined
      ? await client.query<{ id: string }>(
          `insert into leave_records (organization_id, member_id, during)
           values ($1, $2, $3::daterange)
           returning id::text as id`,
          [leave.organization, leave.member, leave.during],
        )
      : await client.query<{ id: string }>(
          `insert into leave_records (organization_id, member_id, during, created_by)
           values ($1, $2, $3::daterange, $4)
           returning id::text as id`,
          [leave.organization, leave.member, leave.during, leave.by],
        );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('the leave record insert returned no id');
  return id;
}

/**
 * Every shift-type override, roster override and shift-type times version
 * (`shift_type_versions`) of every organization, whole, as text: the rows
 * `scheduleRulesFingerprint` leaves out that also decide a scheduled shift.
 */
async function overridesFingerprint(client: Client): Promise<string> {
  const { rows } = await client.query<{ digest: string }>(
    `select md5(coalesce(string_agg(body, E'\\n' order by body), '')) as digest
       from (
         select 't:' || to_jsonb(x)::text as body from shift_type_overrides x
         union all select 'r:' || to_jsonb(x)::text from roster_overrides x
         union all select 'y:' || to_jsonb(x)::text from shift_type_versions x
       ) as everything`,
  );
  return rows[0]?.digest ?? '';
}

/** The ids of the leave records the connection currently sees, oldest range first. */
async function visibleLeave(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    'select id::text as id from leave_records order by lower(during), id',
  );
  return rows.map((row) => row.id);
}

/**
 * `recordLeave`'s table, over real PostgREST with a real token: the insert and
 * the one overlap read, sent the way supabase-js sends them.
 */
function restLeaveTable(token: string): LeaveTable {
  return {
    async insert(values): Promise<LeaveWriteAnswer> {
      const response = await rest('leave_records', { token, method: 'POST', body: values });
      return { error: response.ok ? null : await restRefusal(response) };
    },
    select(columns) {
      const params = [`select=${encodeURIComponent(columns)}`];
      const query: LeaveQuery = {
        eq(column, value) {
          params.push(`${column}=eq.${encodeURIComponent(value)}`);
          return query;
        },
        neq(column, value) {
          params.push(`${column}=neq.${encodeURIComponent(value)}`);
          return query;
        },
        is(column, value) {
          params.push(`${column}=is.${String(value)}`);
          return query;
        },
        overlaps(column, range) {
          params.push(`${column}=ov.${encodeURIComponent(range)}`);
          return query;
        },
        order(column, options) {
          params.push(`order=${column}.${options.ascending ? 'asc' : 'desc'}`);
          return query;
        },
        async limit(count): Promise<LeaveReadAnswer> {
          params.push(`limit=${String(count)}`);
          const response = await rest(`leave_records?${params.join('&')}`, { token });
          if (!response.ok) return { data: null, error: await restRefusal(response) };
          return { data: (await response.json()) as unknown[], error: null };
        },
      };
      return query;
    },
  };
}

/**
 * The organization-wide schedule fields `packages/domain` reads, from the rows
 * as the connection sees them: every member with their memberships and
 * statuses, every rotation version and step, the live shift-type and roster
 * overrides, and the working shift types.
 */
async function organizationScheduleInputOf(
  client: Client,
  organization: string,
): Promise<Omit<CollisionInput, 'leaveRecords'>> {
  const { rows: memberships } = await client.query<{ member: string; teamId: string | null; position: string | null; effectiveFrom: string }>(
    `select member_id::text as member, team_id::text as "teamId", position, effective_from::text as "effectiveFrom"
       from team_membership_versions where organization_id = $1`,
    [organization],
  );
  const { rows: statuses } = await client.query<{ member: string; active: boolean; effectiveFrom: string }>(
    `select member_id::text as member, active, effective_from::text as "effectiveFrom"
       from member_status_versions where organization_id = $1`,
    [organization],
  );
  const { rows: members } = await client.query<{ id: string }>(
    'select id::text as id from members where organization_id = $1',
    [organization],
  );
  const { rows: assignments } = await client.query<RotationAssignment>(
    `select team_id::text as "teamId", pattern_id::text as "patternId", offset_step_id::text as "offsetStepId",
            anchor_date::text as "anchorDate", effective_from::text as "effectiveFrom"
       from rotation_assignments where organization_id = $1`,
    [organization],
  );
  const { rows: steps } = await client.query<RotationStep>(
    `select id::text as id, pattern_id::text as "patternId", position, shift_type_id::text as "shiftTypeId"
       from rotation_steps where organization_id = $1`,
    [organization],
  );
  const { rows: overrides } = await client.query<{ teamId: string; date: string; shiftTypeId: string }>(
    `select team_id::text as "teamId", date::text as date, shift_type_id::text as "shiftTypeId"
       from shift_type_overrides where organization_id = $1 and removed_at is null`,
    [organization],
  );
  const { rows: rosterOverrides } = await client.query<{
    id: string;
    teamId: string;
    date: string;
    memberOutId: string | null;
    memberInId: string | null;
  }>(
    `select id::text as id, team_id::text as "teamId", date::text as date,
            member_out_id::text as "memberOutId", member_in_id::text as "memberInId"
       from roster_overrides where organization_id = $1 and removed_at is null`,
    [organization],
  );
  const { rows: working } = await client.query<{ id: string }>(
    'select id::text as id from shift_types where organization_id = $1 and is_working',
    [organization],
  );
  const membershipsOfMember = (id: string) =>
    memberships
      .filter((row) => row.member === id)
      .map(({ teamId, position, effectiveFrom }) => ({ teamId, position, effectiveFrom }));
  const statusesOfMember = (id: string) =>
    statuses.filter((row) => row.member === id).map(({ active, effectiveFrom }) => ({ active, effectiveFrom }));

  return {
    assignments,
    steps,
    overrides,
    members: members.map(({ id }) => ({ id, memberships: membershipsOfMember(id), statuses: statusesOfMember(id) })),
    rosterOverrides,
    workingShiftTypeIds: working.map((row) => row.id),
  };
}

/**
 * One member's schedule input as `packages/domain` reads it, from the rows as
 * the owner sees them: their memberships and statuses, every rotation version
 * and step of the organization, its live shift-type and roster overrides, and
 * every member a roster override could be judged against.
 *
 * @throws Error when `memberId` is not among the organization's members — a
 *   wrong id would otherwise read as a member on no team, costing nothing.
 */
async function memberScheduleInputOf(
  client: Client,
  organization: string,
  memberId: string,
): Promise<MemberScheduleInput> {
  const shared = await organizationScheduleInputOf(client, organization);
  const member = shared.members.find((one) => one.id === memberId);
  if (member === undefined) throw new Error(`member ${memberId} is not among the members of ${organization}`);
  return {
    memberId,
    memberships: member.memberships,
    statuses: member.statuses,
    ...shared,
  };
}

describe('a leave record is recorded by an admin, refused on overlap by the database, and touches no schedule (story 5.1b)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'records a $fixture admin\'s 10.09–14.09 for a member, attributed by default, and leaves every rotation, membership, status, member, shift-type times and override row byte-identical',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const rulesBefore = await scheduleRulesFingerprint(client);
        const overridesBefore = await overridesFingerprint(client);

        await actAs(client, owner.authUserId, organization);
        const id = await insertLeave(client, { organization, member: self.id, during: '[2026-09-10,2026-09-14]' });
        const visible = await visibleLeave(client);
        await actAsOwner(client);

        expect(visible, `${slug}: the admin cannot read what it wrote`).toContain(id);
        const { rows } = await client.query<{ createdBy: string; recent: boolean; during: string; removedAt: unknown }>(
          `select created_by as "createdBy", created_at > now() - interval '1 minute' as recent,
                  during::text as during, removed_at as "removedAt"
             from leave_records where id = $1`,
          [id],
        );
        expect(rows).toEqual([
          { createdBy: owner.authUserId, recent: true, during: '[2026-09-10,2026-09-15)', removedAt: null },
        ]);
        expect(
          await scheduleRulesFingerprint(client),
          `${slug}: a leave record touched a rotation, membership or status row`,
        ).toBe(rulesBefore);
        expect(await overridesFingerprint(client), `${slug}: a leave record touched a time or an override`).toBe(
          overridesBefore,
        );
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture range overlapping a live record of the same member (23P01), and stores a touching range, one over a removed record and another member\'s',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;

        await actAs(client, owner.authUserId, organization);
        const existing = await insertLeave(client, { organization, member: self.id, during: '[2026-09-12,2026-09-20]' });
        const codes: Record<string, string> = {};
        for (const [label, during] of [
          ['inside its start', '[2026-09-10,2026-09-14]'],
          ['inside its end', '[2026-09-20,2026-09-25]'],
          ['within', '[2026-09-15,2026-09-15]'],
          ['around', '[2026-09-01,2026-09-30]'],
          ['equal', '[2026-09-12,2026-09-20]'],
        ] as const) {
          codes[label] = (
            await refusedThenContinue(client, () => insertLeave(client, { organization, member: self.id, during }))
          ).code;
        }
        // Touching at either end shares no date; another member shares none of this one's.
        const before = await insertLeave(client, { organization, member: self.id, during: '[2026-09-01,2026-09-11]' });
        const after = await insertLeave(client, { organization, member: self.id, during: '[2026-09-21,2026-09-25]' });
        const colleague = await insertLeave(client, { organization, member: other.id, during: '[2026-09-12,2026-09-20]' });
        await actAsOwner(client);

        expect(codes, slug).toEqual({
          'inside its start': '23P01',
          'inside its end': '23P01',
          within: '23P01',
          around: '23P01',
          equal: '23P01',
        });

        // Story 5.2a's soft-removal, through 0029: the removed record leaves the key.
        await actAs(client, owner.authUserId, organization);
        await removeLeaveRecord(client, existing);
        const replacement = await insertLeave(client, { organization, member: self.id, during: '[2026-09-12,2026-09-20]' });
        const visible = await visibleLeave(client);
        await actAsOwner(client);

        for (const id of [existing, before, after, colleague, replacement]) {
          expect(visible, `${slug}: a stored record is not read by its admin`).toContain(id);
        }
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'stores a $fixture record whose cost the domain puts above the member\'s balance: no balance is checked here (R4.7)',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const settings = await organizationById(client, organization);
        if (settings === undefined) throw new Error(`${slug} is not in the database`);
        const today = await organizationDay(client, organization);
        const leaveYearStart = { month: settings.leaveYearStartMonth, day: settings.leaveYearStartDay };
        // The whole current leave year: at most 366 days, so 0028 admits it.
        const range = leaveYearOf(today, leaveYearStart);
        // The fixture member is on no team, so nothing would cost a day: put
        // them on a seeded team from the leave year's first day.
        await ownerMembership(client, {
          organization,
          member: self.id,
          team: await seededTeam(client, organization, 'Smjena A'),
          from: range.from,
          by: owner.authUserId,
        });
        const { rows: existing } = await client.query<{ from: string; to: string }>(
          `select lower(during)::text as "from", (upper(during) - 1)::text as "to"
             from leave_records where member_id = $1 and removed_at is null`,
          [self.id],
        );
        const preview = leavePreviewOf({
          input: await memberScheduleInputOf(client, organization, self.id),
          allowanceDays: self.leaveAllowanceDays,
          records: existing,
          today,
          leaveYearStart,
          range,
        });

        expect(preview.overlapsRecord, `${slug}: the member already has leave this year`).toBe(false);
        expect(preview.costInYearDays, `${slug}: the range does not cost more than the balance`).toBeGreaterThan(
          preview.balanceDays,
        );
        expect(preview.exceedsBalance).toBe(true);

        await actAs(client, owner.authUserId, organization);
        const id = await insertLeave(client, { organization, member: self.id, during: `[${range.from},${range.to}]` });
        const visible = await visibleLeave(client);
        await actAsOwner(client);

        expect(visible, `${slug}: the over-balance record was not stored`).toContain(id);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture empty, unbounded, reversed, infinite or 367-day range, and stores 366 days and the last representable date',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;

        await actAs(client, owner.authUserId, organization);
        const codes: Record<string, string> = {};
        for (const [label, during] of [
          ['empty', '[2026-09-10,2026-09-10)'],
          ['empty literal', 'empty'],
          ['no end', '[2026-09-10,)'],
          ['no start', '(,2026-09-10]'],
          ['reversed', '[2026-09-14,2026-09-10]'],
          ['infinite end', '[2026-09-10,infinity)'],
          ['infinite start', '[-infinity,2026-09-10]'],
          ['before year 1', '[0001-01-01 BC,0001-01-05 BC]'],
          ['after year 9999', '[9999-12-31,10000-01-01]'],
          ['367 days', '[2026-01-01,2027-01-02]'],
        ] as const) {
          codes[label] = (
            await refusedThenContinue(client, () => insertLeave(client, { organization, member: self.id, during }))
          ).code;
        }
        const longest = await insertLeave(client, { organization, member: self.id, during: '[2027-01-01,2028-01-01]' });
        const last = await insertLeave(client, { organization, member: self.id, during: '[9999-12-31,9999-12-31]' });
        const first = await insertLeave(client, { organization, member: self.id, during: '[0001-01-01,0001-01-01]' });
        await actAsOwner(client);

        expect(codes, slug).toEqual({
          empty: '23514',
          'empty literal': '23514',
          'no end': '23514',
          'no start': '23514',
          reversed: '22000',
          // `infinity` is past every date a range can be canonicalized around.
          'infinite end': '22008',
          'infinite start': '22008',
          'before year 1': '23514',
          'after year 9999': '23514',
          '367 days': '23514',
        });
        const { rows } = await client.query<{ days: number }>(
          'select upper(during) - lower(during) as days from leave_records where id = any($1::uuid[]) order by lower(during)',
          [[longest, last, first]],
        );
        expect(rows.map((row) => row.days)).toEqual([1, 366, 1]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role account\'s insert, and shows it its own records and no colleague\'s',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;

        await actAs(client, owner.authUserId, organization);
        const own = await insertLeave(client, { organization, member: self.id, during: '[2026-09-10,2026-09-14]' });
        const colleague = await insertLeave(client, { organization, member: other.id, during: '[2026-09-10,2026-09-14]' });
        const adminOwn = await insertLeave(client, { organization, member: owner.id, during: '[2026-10-10,2026-10-14]' });
        await actAsOwner(client);

        await actAs(client, self.authUserId, organization);
        const asSelf = await visibleLeave(client);
        const forSelf = await refusedThenContinue(client, () =>
          insertLeave(client, { organization, member: self.id, during: '[2026-11-10,2026-11-14]' }),
        );
        const forOther = await refusedThenContinue(client, () =>
          insertLeave(client, { organization, member: other.id, during: '[2026-11-10,2026-11-14]' }),
        );
        await actAsOwner(client);
        await actAs(client, other.authUserId, organization);
        const asOther = await visibleLeave(client);
        await actAsOwner(client);
        await actAs(client, owner.authUserId, organization);
        const asAdmin = await visibleLeave(client);
        await actAsOwner(client);

        expect(asSelf, `${slug}: a member reads other than their own leave`).toEqual([own]);
        expect(asOther, `${slug}: a bystander reads other than their own leave`).toEqual([colleague]);
        expect(asAdmin, `${slug}: the admin does not read the organization's leave`).toEqual(
          expect.arrayContaining([own, colleague, adminOwn]),
        );
        expect(forSelf.code, `${slug}: a member recorded their own leave`).toBe('42501');
        expect(forOther.code, `${slug}: a member recorded a colleague's leave`).toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'answers a $fixture admin or member-role account inactive today nothing, its own records included, and refuses an inactive admin',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const inactive = await addThrowawayAdmin(client, organization);
        const inactiveMember = await addThrowawayMember(client, organization);
        const by = owner.authUserId;
        await insertLeave(client, { organization, member: inactive.id, during: '[2026-09-10,2026-09-14]', by });
        await insertLeave(client, { organization, member: inactiveMember.id, during: '[2026-09-10,2026-09-14]', by });
        await insertLeave(client, { organization, member: self.id, during: '[2026-09-10,2026-09-14]', by });
        const day = await organizationDay(client, organization);
        for (const deactivated of [inactive, inactiveMember]) {
          await ownerVersion(client, { organization, member: deactivated.id, active: false, from: day, by });
        }

        await actAs(client, inactive.authUserId, organization);
        const read = await visibleLeave(client);
        const refusal = await refusedThenContinue(client, () =>
          insertLeave(client, { organization, member: self.id, during: '[2026-11-10,2026-11-14]' }),
        );
        await actAsOwner(client);
        await actAs(client, inactiveMember.authUserId, organization);
        const readByMember = await visibleLeave(client);
        await actAsOwner(client);

        expect(read, `${slug}: an inactive admin read leave, its own included`).toEqual([]);
        expect(readByMember, `${slug}: an inactive member-role account read its own leave`).toEqual([]);
        expect(refusal.code, `${slug}: an inactive admin recorded leave`).toBe('42501');
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'answers a $fixture caller nothing of $otherFixture, under its own claim, a forged one or none, and refuses its members and its tenant',
    async ({ slug, admin, member, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const foreignFixture = FIXTURES.find((entry) => entry.slug === otherSlug);
        const foreignOwner = await memberByUsername(client, otherSlug, foreignFixture?.admin ?? '');
        const foreignMember = await memberByUsername(client, otherSlug, foreignFixture?.member ?? '');
        // As the owner: one record in each tenant, so a leak has something to show.
        const ownRecord = await insertLeave(client, {
          organization: owner.organizationId,
          member: self.id,
          during: '[2026-09-10,2026-09-14]',
          by: owner.authUserId,
        });
        const foreignRecord = await insertLeave(client, {
          organization: foreignOwner.organizationId,
          member: foreignMember.id,
          during: '[2026-09-10,2026-09-14]',
          by: foreignOwner.authUserId,
        });

        for (const reader of [self, owner]) {
          await actAs(client, reader.authUserId, reader.organizationId);
          const own = await visibleLeave(client);
          await actAsOwner(client);
          expect(own, `${slug} as ${reader.role}: its own leave`).toContain(ownRecord);
          expect(own, `${slug} as ${reader.role}: another tenant's leave`).not.toContain(foreignRecord);

          await actAs(client, reader.authUserId, foreignOwner.organizationId);
          expect(await visibleLeave(client), `${slug}: a forged claim read leave`).toEqual([]);
          await actAsOwner(client);
          await actAs(client, reader.authUserId, null);
          expect(await visibleLeave(client), `${slug}: no claim read leave`).toEqual([]);
          await actAsOwner(client);
        }

        await actAs(client, owner.authUserId, owner.organizationId);
        const codes: Record<string, string> = {};
        // Another tenant's member under the admin's own tenant: the key refuses it.
        codes['foreign member'] = (
          await refusedThenContinue(client, () =>
            insertLeave(client, {
              organization: owner.organizationId,
              member: foreignMember.id,
              during: '[2026-11-10,2026-11-14]',
            }),
          )
        ).code;
        // A record written into the other tenant: the policy refuses it.
        codes['foreign tenant'] = (
          await refusedThenContinue(client, () =>
            insertLeave(client, {
              organization: foreignOwner.organizationId,
              member: foreignMember.id,
              during: '[2026-11-10,2026-11-14]',
            }),
          )
        ).code;
        await actAsOwner(client);

        expect(codes, slug).toEqual({ 'foreign member': '23503', 'foreign tenant': '42501' });
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture forged author, an update, a delete and a half-recorded removal',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const id = await insertLeave(client, { organization, member: self.id, during: '[2026-09-10,2026-09-14]', by: owner.authUserId });

        await actAs(client, owner.authUserId, organization);
        const codes: Record<string, string> = {};
        // Another user's id as the author: the policy pins `created_by` to the caller.
        codes['forged author'] = (
          await refusedThenContinue(client, () =>
            client.query(
              `insert into leave_records (organization_id, member_id, during, created_by)
               values ($1, $2, '[2026-11-10,2026-11-14]', $3)`,
              [organization, self.id, self.authUserId],
            ),
          )
        ).code;
        codes['update'] = (
          await refusedThenContinue(client, () => client.query('update leave_records set removed_at = now()'))
        ).code;
        codes['delete'] = (await refusedThenContinue(client, () => client.query('delete from leave_records'))).code;
        await actAsOwner(client);

        const halfRemoved = await refusedThenContinue(client, () =>
          client.query('update leave_records set removed_at = now() where id = $1', [id]),
        );

        expect(codes, slug).toEqual({ 'forged author': '42501', update: '42501', delete: '42501' });
        expect(halfRemoved.code, `${slug}: a removal without its author`).toBe('23514');
      });
    },
  );

  it.skipIf(noDatabase)('deletes an organization whose members hold live and removed leave, through the cascade, with no 23503', async () => {
    await inRolledBackTransaction(async (client) => {
      const [fixture] = FIXTURES;
      const owner = await memberByUsername(client, fixture.slug, fixture.admin);
      const self = await memberByUsername(client, fixture.slug, fixture.member);
      const organization = owner.organizationId;
      const by = owner.authUserId;
      await insertLeave(client, { organization, member: self.id, during: '[2026-09-10,2026-09-14]', by });
      const removed = await insertLeave(client, { organization, member: owner.id, during: '[2026-09-10,2026-09-14]', by });
      await client.query('update leave_records set removed_by = $1, removed_at = now() where id = $2', [by, removed]);

      const deleted = await client.query('delete from organizations where id = $1', [organization]);
      // The zero-admins trigger is deferred to commit; this transaction rolls back.
      const { rows } = await client.query<{ left: number }>(
        'select count(*)::int as left from leave_records where organization_id = $1',
        [organization],
      );

      expect(deleted.rowCount).toBe(1);
      expect(rows).toEqual([{ left: 0 }]);
    });
  });

  it.skipIf(noApi)('refuses an anonymous caller the table', async () => {
    const read = await rest('leave_records?select=*');
    expect(read.status, 'an anonymous caller read leave_records').toBe(401);
    expect((await restRefusal(read)).code, 'a privilege refusal is 42501').toBe('42501');
  });

  it.skipIf(noApi).each(FIXTURES)(
    'maps a $fixture overlap over PostgREST to LEAVE_OVERLAP naming the earliest live record of that member, and a member\'s insert to LEAVE_DENIED',
    async ({ slug, admin, member, bystander }) => {
      const client = await connect();
      const year2040 = '[2040-01-01,2041-01-01)';
      let cleanup: string[] = [];
      try {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        cleanup = [self.id, other.id];
        const by = owner.authUserId;
        // Leftovers of an interrupted run, before anything is seeded.
        await client.query('delete from leave_records where member_id = any($1::uuid[]) and during && $2::daterange', [
          cleanup,
          year2040,
        ]);

        // As the owner, committed. Inside the entered 2040-09-10–2040-09-20, in
        // order: a REMOVED record of the member from 09-08 (not a conflict), the
        // EARLIEST live one from 09-12, a later live one from 09-18, and a live
        // record of ANOTHER member from 09-09 (not this member's conflict).
        const removed = await insertLeave(client, { organization, member: self.id, during: '[2040-09-08,2040-09-16]', by });
        await client.query('update leave_records set removed_by = $1, removed_at = now() where id = $2', [by, removed]);
        await insertLeave(client, { organization, member: self.id, during: '[2040-09-12,2040-09-15]', by });
        await insertLeave(client, { organization, member: self.id, during: '[2040-09-18,2040-09-25]', by });
        await insertLeave(client, { organization, member: other.id, during: '[2040-09-09,2040-09-20]', by });
        const asAdmin = restLeaveTable(await tokenFor(admin, slug));

        expect(await recordLeave(asAdmin, organization, self.id, '2040-09-10', '2040-09-20'), slug).toEqual({
          ok: false,
          code: LEAVE_OVERLAP,
          conflict: { from: '2040-09-12', to: '2040-09-15' },
        });
        expect(await recordLeave(asAdmin, organization, self.id, '2040-09-26', '2040-09-30'), slug).toEqual({
          ok: true,
        });
        expect(
          await recordLeave(restLeaveTable(await tokenFor(member, slug)), organization, self.id, '2040-10-01', '2040-10-02'),
          slug,
        ).toEqual({ ok: false, code: LEAVE_DENIED });

        const { rows } = await client.query<{ during: string; createdBy: string; live: boolean }>(
          `select during::text as during, created_by as "createdBy", removed_at is null as live from leave_records
            where member_id = $1 and during && $2::daterange order by lower(during)`,
          [self.id, year2040],
        );
        expect(rows).toEqual([
          { during: '[2040-09-08,2040-09-17)', createdBy: by, live: false },
          { during: '[2040-09-12,2040-09-16)', createdBy: by, live: true },
          { during: '[2040-09-18,2040-09-26)', createdBy: by, live: true },
          { during: '[2040-09-26,2040-10-01)', createdBy: by, live: true },
        ]);
      } finally {
        if (cleanup.length > 0) {
          await client.query('delete from leave_records where member_id = any($1::uuid[]) and during && $2::daterange', [
            cleanup,
            year2040,
          ]);
        }
        await client.end();
      }
    },
    20_000,
  );
});

// ------------------------------- story 5.2a: amending and removing leave records

/**
 * STORY 5.2a (`0029`). An active admin soft-removes a live leave record
 * through `remove_leave_record()`, or amends it through
 * `amend_leave_record()`, which soft-removes it and inserts the replacement
 * range for the same member in one transaction; both attribute on the server.
 * Every other caller is refused, any refused amend leaves the original live and
 * unchanged, and the balance `packages/domain` computes from the live read
 * follows. Every SQL case runs in a rolled-back transaction; the REST cases
 * commit inside year 2041 and delete what they wrote in `finally`.
 */

/** `remove_leave_record(id)`, as whoever the connection currently is. */
async function removeLeaveRecord(client: Client, id: string): Promise<void> {
  await client.query('select public.remove_leave_record($1::uuid)', [id]);
}

/** `amend_leave_record(id, from, to)`, as whoever the connection currently is: the replacement's id. */
async function amendLeaveRecord(client: Client, id: string, from: string, to: string): Promise<string> {
  const { rows } = await client.query<{ id: string | null }>(
    'select public.amend_leave_record($1::uuid, $2::date, $3::date)::text as id',
    [id, from, to],
  );
  const replacement = rows[0]?.id;
  if (replacement === undefined || replacement === null) throw new Error('the amend returned no id');
  return replacement;
}

/** One leave record row, whole, as the owner sees it. */
async function leaveRow(client: Client, id: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await client.query<Record<string, unknown>>(
    'select to_jsonb(r) as row from leave_records r where id = $1',
    [id],
  );
  return rows[0]?.['row'] as Record<string, unknown> | undefined;
}

/**
 * The member's live records as the CURRENT SESSION reads them — the filter
 * `readLeaveRecords` sends (`removed_at is null`) — each parsed by the
 * client's own `leaveRangeOf`, with their ids.
 */
async function liveLeaveOf(client: Client, memberId: string): Promise<{ id: string; range: LeaveRange }[]> {
  const { rows } = await client.query<{ id: string; during: string }>(
    `select id::text as id, during::text as during from leave_records
      where member_id = $1 and removed_at is null order by during`,
    [memberId],
  );
  return rows.map((row) => {
    const range = leaveRangeOf(row.during);
    if (range === null) throw new Error(`a live record does not parse: ${row.during}`);
    return { id: row.id, range };
  });
}

/** The two functions over real PostgREST with a real token, sent the way supabase-js sends `rpc`. */
function restLeaveRpc(token: string): LeaveRecordRpc {
  return {
    async rpc(fn: string, args: Readonly<Record<string, unknown>>): Promise<LeaveAmendAnswer> {
      const response = await rest(`rpc/${fn}`, { token, method: 'POST', body: args });
      if (!response.ok) return { data: null, error: await restRefusal(response) };
      const text = await response.text();
      return { data: text === '' ? null : (JSON.parse(text) as unknown), error: null };
    },
  } as LeaveRecordRpc;
}

/**
 * A member put on a seeded team for the whole current leave year, with an
 * allowance of 20, and the first range from the year's start costing exactly
 * `cost` leave days, for each cost asked, by `packages/domain`'s own rule.
 */
async function leaveYearSetup(
  client: Client,
  organization: string,
  owner: MemberRow,
  memberId: string,
  costs: readonly number[],
): Promise<{
  today: string;
  leaveYearStart: { month: number; day: number };
  ranges: LeaveRange[];
  balance: () => Promise<number>;
}> {
  const settings = await organizationById(client, organization);
  if (settings === undefined) throw new Error(`${organization} is not in the database`);
  const today = await organizationDay(client, organization);
  const leaveYearStart = { month: settings.leaveYearStartMonth, day: settings.leaveYearStartDay };
  const year = leaveYearOf(today, leaveYearStart);
  // A future fixture change that seeds leave would otherwise fail as a bare
  // 23P01 or a wrong balance.
  expect(
    await liveLeaveOf(client, memberId),
    `${organization}: the member already holds live leave, so the 5.2a balance cases cannot start from 20`,
  ).toEqual([]);
  await ownerMembership(client, {
    organization,
    member: memberId,
    team: await seededTeam(client, organization, 'Smjena A'),
    from: year.from,
    by: owner.authUserId,
  });
  await client.query('update members set leave_allowance_days = 20 where id = $1', [memberId]);
  const input = await memberScheduleInputOf(client, organization, memberId);

  const ranges = costs.map((cost) => {
    const end = new Date(`${year.from}T00:00:00Z`);
    for (;;) {
      const to = end.toISOString().slice(0, 10);
      if (to > year.to) throw new Error(`no range from ${year.from} inside the leave year costs ${String(cost)}`);
      if (leaveCostOf(input, year.from, to) === cost) return { from: year.from, to };
      end.setUTCDate(end.getUTCDate() + 1);
    }
  });

  return {
    today,
    leaveYearStart,
    ranges,
    // The balance from the records the admin's session reads live, as the
    // member page computes it.
    balance: async () => {
      await actAs(client, owner.authUserId, organization);
      const live = await liveLeaveOf(client, memberId);
      await actAsOwner(client);
      return leaveBalanceOf({
        input,
        allowanceDays: 20,
        records: live.map((record) => record.range),
        today,
        leaveYearStart,
      }).balanceDays;
    },
  };
}

describe('a leave record is amended or removed by an active admin alone, attributed on the server, and the balance follows (story 5.2a)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'removes a $fixture record costing 3 as its admin: attributed, dropped from the live read, the balance back to 20, the range recordable again, and no schedule row touched',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const setup = await leaveYearSetup(client, organization, owner, self.id, [3]);
        const [range] = setup.ranges;
        if (range === undefined) throw new Error('no range');
        const rulesBefore = await scheduleRulesFingerprint(client);
        const overridesBefore = await overridesFingerprint(client);

        await actAs(client, owner.authUserId, organization);
        const id = await insertLeave(client, { organization, member: self.id, during: `[${range.from},${range.to}]` });
        await actAsOwner(client);
        const live = await leaveRow(client, id);
        expect(await setup.balance(), `${slug}: the record does not cost 3`).toBe(17);

        await actAs(client, owner.authUserId, organization);
        await removeLeaveRecord(client, id);
        const read = await liveLeaveOf(client, self.id);
        await actAsOwner(client);

        const { rows } = await client.query<{ removedBy: string; recent: boolean }>(
          `select removed_by as "removedBy", removed_at > now() - interval '1 minute' as recent
             from leave_records where id = $1`,
          [id],
        );
        expect(rows, `${slug}: the removal is not attributed to its caller`).toEqual([
          { removedBy: owner.authUserId, recent: true },
        ]);
        const removed = await leaveRow(client, id);
        const { removed_by: _liveBy, removed_at: _liveAt, ...liveRest } = live ?? {};
        const { removed_by: _by, removed_at: _at, ...removedRest } = removed ?? {};
        expect(live?.['removed_at'], `${slug}: the record was not live`).toBeNull();
        expect(removedRest, `${slug}: a removal changed more than removed_by and removed_at`).toEqual(liveRest);
        expect(read, `${slug}: a removed record is read live`).toEqual([]);
        expect(await setup.balance(), `${slug}: the removal did not restore the balance`).toBe(20);
        expect(await scheduleRulesFingerprint(client), `${slug}: a removal touched a rotation, membership or status row`).toBe(
          rulesBefore,
        );
        expect(await overridesFingerprint(client), `${slug}: a removal touched a time or an override`).toBe(overridesBefore);

        // THEN RE-RECORD: the removed row has left the exclusion.
        await actAs(client, owner.authUserId, organization);
        const again = await insertLeave(client, { organization, member: self.id, during: `[${range.from},${range.to}]` });
        const reread = await liveLeaveOf(client, self.id);
        await actAsOwner(client);
        expect(reread.map((record) => record.id), `${slug}: the same range cannot be recorded again`).toEqual([again]);
        expect(await setup.balance()).toBe(17);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'amends a $fixture record costing 3 to an overlapping range costing 5: the old removed, the new returned and live alone, attributed, the same member, and the balance 15',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const setup = await leaveYearSetup(client, organization, owner, self.id, [3, 5]);
        const [costing3, costing5] = setup.ranges;
        if (costing3 === undefined || costing5 === undefined) throw new Error('no range');
        const rulesBefore = await scheduleRulesFingerprint(client);
        const overridesBefore = await overridesFingerprint(client);

        await actAs(client, owner.authUserId, organization);
        const id = await insertLeave(client, { organization, member: self.id, during: `[${costing3.from},${costing3.to}]` });
        await actAsOwner(client);
        expect(await setup.balance()).toBe(17);

        await actAs(client, owner.authUserId, organization);
        // The new range overlaps the old one: the old leaves the exclusion first.
        const replacement = await amendLeaveRecord(client, id, costing5.from, costing5.to);
        const read = await liveLeaveOf(client, self.id);
        await actAsOwner(client);

        expect(replacement, `${slug}: the amend returned the old id`).not.toBe(id);
        expect(read, `${slug}: not exactly the replacement is live`).toEqual([{ id: replacement, range: costing5 }]);
        expect(await setup.balance(), `${slug}: the balance does not reflect only the new cost`).toBe(15);
        const { rows } = await client.query<{
          id: string;
          organization: string;
          member: string;
          createdBy: string;
          removedBy: string | null;
          live: boolean;
          recent: boolean;
        }>(
          `select id::text as id, organization_id::text as organization, member_id::text as member,
                  created_by::text as "createdBy", removed_by::text as "removedBy", removed_at is null as live,
                  coalesce(removed_at, created_at) > now() - interval '1 minute' as recent
             from leave_records where id = any($1::uuid[]) order by removed_at is null`,
          [[id, replacement]],
        );
        expect(rows, slug).toEqual([
          { id, organization, member: self.id, createdBy: owner.authUserId, removedBy: owner.authUserId, live: false, recent: true },
          { id: replacement, organization, member: self.id, createdBy: owner.authUserId, removedBy: null, live: true, recent: true },
        ]);
        expect(await scheduleRulesFingerprint(client), `${slug}: an amend touched a rotation, membership or status row`).toBe(
          rulesBefore,
        );
        expect(await overridesFingerprint(client), `${slug}: an amend touched a time or an override`).toBe(overridesBefore);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture amend onto another live record (23P01) or to a reversed, infinite or 367-day range, and every original stays live and unchanged',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;

        await actAs(client, owner.authUserId, organization);
        const amended = await insertLeave(client, { organization, member: self.id, during: '[2026-09-10,2026-09-14]' });
        const other = await insertLeave(client, { organization, member: self.id, during: '[2026-09-18,2026-09-25]' });
        await actAsOwner(client);
        const before = [await leaveRow(client, amended), await leaveRow(client, other)];

        await actAs(client, owner.authUserId, organization);
        const codes: Record<string, string> = {};
        for (const [label, from, to] of [
          ['onto another record', '2026-09-12', '2026-09-20'],
          ['reversed', '2026-09-14', '2026-09-10'],
          ['infinite end', '2026-09-10', 'infinity'],
          ['infinite start', '-infinity', '2026-09-14'],
          ['no end', '2026-09-10', null],
          ['367 days', '2026-01-01', '2027-01-02'],
        ] as const) {
          codes[label] = (await refusedThenContinue(client, () => amendLeaveRecord(client, amended, from, to as string))).code;
        }
        const live = await liveLeaveOf(client, self.id);
        await actAsOwner(client);

        expect(codes, slug).toEqual({
          'onto another record': '23P01',
          reversed: '22000',
          'infinite end': '22008',
          'infinite start': '22008',
          'no end': '23514',
          '367 days': '23514',
        });
        expect([await leaveRow(client, amended), await leaveRow(client, other)], `${slug}: a refused amend changed a row`).toEqual(
          before,
        );
        expect(live.map((record) => record.id), `${slug}: a refused amend left the originals not live`).toEqual([
          amended,
          other,
        ]);
        const { rows } = await client.query<{ count: number }>(
          'select count(*)::int as count from leave_records where member_id = $1',
          [self.id],
        );
        expect(rows, `${slug}: a refused amend left a row behind`).toEqual([{ count: 2 }]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second $fixture removal, an amend of a removed record and an unknown id with P0002, and a removed row stays as it was',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const unknown = '00000000-0000-4000-8000-000000000000';

        await actAs(client, owner.authUserId, organization);
        const id = await insertLeave(client, { organization, member: self.id, during: '[2026-09-10,2026-09-14]' });
        await removeLeaveRecord(client, id);
        await actAsOwner(client);
        const removed = await leaveRow(client, id);

        await actAs(client, owner.authUserId, organization);
        const codes = {
          'remove twice': (await refusedThenContinue(client, () => removeLeaveRecord(client, id))).code,
          'amend removed': (
            await refusedThenContinue(client, () => amendLeaveRecord(client, id, '2026-09-10', '2026-09-14'))
          ).code,
          'remove unknown': (await refusedThenContinue(client, () => removeLeaveRecord(client, unknown))).code,
          'amend unknown': (
            await refusedThenContinue(client, () => amendLeaveRecord(client, unknown, '2026-09-10', '2026-09-14'))
          ).code,
        };
        const live = await liveLeaveOf(client, self.id);
        await actAsOwner(client);

        expect(codes, slug).toEqual({
          'remove twice': 'P0002',
          'amend removed': 'P0002',
          'remove unknown': 'P0002',
          'amend unknown': 'P0002',
        });
        expect(await leaveRow(client, id), `${slug}: a refused call changed a removed row`).toEqual(removed);
        expect(live, `${slug}: a refused amend of a removed record wrote one`).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role account, an inactive admin and a session with no claim either call with 42501, and changes nothing',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const inactive = await addThrowawayAdmin(client, organization);

        await actAs(client, owner.authUserId, organization);
        const id = await insertLeave(client, { organization, member: self.id, during: '[2026-09-10,2026-09-14]' });
        await actAsOwner(client);
        await ownerVersion(client, {
          organization,
          member: inactive.id,
          active: false,
          from: await organizationDay(client, organization),
          by: owner.authUserId,
        });
        const before = await leaveRow(client, id);

        const codes: Record<string, string> = {};
        for (const [label, caller, claim] of [
          ['member', self.authUserId, organization],
          ['inactive admin', inactive.authUserId, organization],
          ['no claim', owner.authUserId, null],
        ] as const) {
          await actAs(client, caller, claim);
          codes[`${label} removes`] = (await refusedThenContinue(client, () => removeLeaveRecord(client, id))).code;
          codes[`${label} amends`] = (
            await refusedThenContinue(client, () => amendLeaveRecord(client, id, '2026-09-11', '2026-09-12'))
          ).code;
          await actAsOwner(client);
        }

        expect(Object.values(codes), `${slug}: ${JSON.stringify(codes)}`).toEqual(Array(6).fill('42501'));
        expect(await leaveRow(client, id), `${slug}: a refused call changed the row`).toEqual(before);
        expect(before?.['removed_at'], `${slug}: the record was not live`).toBeNull();
        const { rows } = await client.query<{ count: number }>(
          'select count(*)::int as count from leave_records where member_id = $1',
          [self.id],
        );
        expect(rows, `${slug}: a refused amend wrote a row`).toEqual([{ count: 1 }]);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'never lets a $fixture admin remove or amend a $otherFixture record, under its own claim or a forged one',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const foreignFixture = FIXTURES.find((entry) => entry.slug === otherSlug);
        const foreignOwner = await memberByUsername(client, otherSlug, foreignFixture?.admin ?? '');
        const foreignMember = await memberByUsername(client, otherSlug, foreignFixture?.member ?? '');
        // The target is written here, as the other tenant's admin, so the case
        // never rests on what that fixture happens to seed.
        await actAs(client, foreignOwner.authUserId, foreignOwner.organizationId);
        const id = await insertLeave(client, {
          organization: foreignOwner.organizationId,
          member: foreignMember.id,
          during: '[2026-10-07,2026-10-09]',
        });
        await actAsOwner(client);
        const before = await leaveRow(client, id);

        const codes: Record<string, string> = {};
        for (const [label, claim] of [
          ['own claim', owner.organizationId],
          ['forged claim', foreignOwner.organizationId],
        ] as const) {
          await actAs(client, owner.authUserId, claim);
          codes[`${label} removes`] = (await refusedThenContinue(client, () => removeLeaveRecord(client, id))).code;
          codes[`${label} amends`] = (
            await refusedThenContinue(client, () => amendLeaveRecord(client, id, '2026-10-07', '2026-10-08'))
          ).code;
          await actAsOwner(client);
        }

        // Another tenant's id is indistinguishable from none under one's own
        // claim; a forged claim is refused before any row is looked at.
        expect(codes, `${slug} against ${otherSlug}`).toEqual({
          'own claim removes': 'P0002',
          'own claim amends': 'P0002',
          'forged claim removes': '42501',
          'forged claim amends': '42501',
        });
        expect(await leaveRow(client, id), `${slug}: ${otherSlug}'s record changed`).toEqual(before);
        expect(before?.['removed_at'], `${otherSlug}'s record is not live`).toBeNull();
      });
    },
  );

  it.skipIf(noApi).each(['remove_leave_record', 'amend_leave_record'])(
    'refuses an anonymous caller %s',
    async (fn) => {
      const response = await rest(`rpc/${fn}`, {
        method: 'POST',
        body:
          fn === 'remove_leave_record'
            ? { p_record_id: '00000000-0000-4000-8000-000000000000' }
            : { p_record_id: '00000000-0000-4000-8000-000000000000', p_from: '2041-09-10', p_to: '2041-09-14' },
      });
      expect(response.status, `an anonymous caller reached ${fn}`).toBe(401);
      const refusal = await restRefusal(response);
      expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
      expect(refusal.message).toBe(`permission denied for function ${fn}`);
    },
  );

  it.skipIf(noApi).each(FIXTURES)(
    'maps the $fixture amend and removal over PostgREST: the new id, LEAVE_OVERLAP naming the other record and never the amended one, LEAVE_FAILED, LEAVE_GONE and LEAVE_DENIED',
    async ({ slug, admin, member }) => {
      const client = await connect();
      const year2041 = '[2041-01-01,2042-01-01)';
      let cleanup: string[] = [];
      try {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        cleanup = [self.id];
        const by = owner.authUserId;
        // Leftovers of an interrupted run, before anything is seeded.
        await client.query('delete from leave_records where member_id = any($1::uuid[]) and during && $2::daterange', [
          cleanup,
          year2041,
        ]);

        // As the owner, committed: the record amended, and another from 18.09.
        const amended = await insertLeave(client, { organization, member: self.id, during: '[2041-09-10,2041-09-14]', by });
        await insertLeave(client, { organization, member: self.id, during: '[2041-09-18,2041-09-25]', by });
        const adminToken = await tokenFor(admin, slug);
        const asAdmin = restLeaveRpc(adminToken);
        const table = restLeaveTable(adminToken);

        // The entered 12.09–20.09 overlaps the amended record too, which the
        // read-back leaves out: the conflict named is 18.09–25.09.
        expect(await amendLeave(asAdmin, table, organization, self.id, amended, '2041-09-12', '2041-09-20'), slug).toEqual({
          ok: false,
          code: LEAVE_OVERLAP,
          conflict: { from: '2041-09-18', to: '2041-09-25' },
        });
        expect(await amendLeave(asAdmin, table, organization, self.id, amended, '2041-09-14', '2041-09-10'), slug).toEqual({
          ok: false,
          code: LEAVE_FAILED,
        });
        expect(
          await amendLeave(restLeaveRpc(await tokenFor(member, slug)), table, organization, self.id, amended, '2041-09-11', '2041-09-12'),
          slug,
        ).toEqual({ ok: false, code: LEAVE_DENIED });
        expect(await removeLeave(restLeaveRpc(await tokenFor(member, slug)), amended), slug).toEqual({
          ok: false,
          code: LEAVE_DENIED,
        });

        const landed = await amendLeave(asAdmin, table, organization, self.id, amended, '2041-09-11', '2041-09-15');
        expect(landed.ok, `${slug}: ${JSON.stringify(landed)}`).toBe(true);
        const replacement = landed.ok ? landed.id : '';
        expect(replacement).toMatch(/^[0-9a-f-]{36}$/);
        expect(await removeLeave(asAdmin, amended), `${slug}: the amended record is still live`).toEqual({
          ok: false,
          code: LEAVE_GONE,
        });
        expect(await removeLeave(asAdmin, replacement), slug).toEqual({ ok: true });
        expect(await removeLeave(asAdmin, replacement), slug).toEqual({ ok: false, code: LEAVE_GONE });

        const { rows } = await client.query<{ id: string; during: string; createdBy: string; removedBy: string | null }>(
          `select id::text as id, during::text as during, created_by::text as "createdBy", removed_by::text as "removedBy"
             from leave_records where member_id = $1 and during && $2::daterange order by lower(during), created_at`,
          [self.id, year2041],
        );
        expect(rows).toEqual([
          { id: amended, during: '[2041-09-10,2041-09-15)', createdBy: by, removedBy: by },
          { id: replacement, during: '[2041-09-11,2041-09-16)', createdBy: by, removedBy: by },
          { id: expect.any(String) as string, during: '[2041-09-18,2041-09-26)', createdBy: by, removedBy: null },
        ]);
      } finally {
        if (cleanup.length > 0) {
          await client.query('delete from leave_records where member_id = any($1::uuid[]) and during && $2::daterange', [
            cleanup,
            year2041,
          ]);
        }
        await client.end();
      }
    },
    20_000,
  );
});

// ------------------------------------ story 5.2c: a member's own leave records

/**
 * STORY 5.2c (`0030`). *Godišnji* reads the caller's own live leave records
 * through `my_leave_records()`, shaped `id, member_id, during`: never an
 * author or a removal, never another member's row and never another
 * organization's. It answers an admin's own member row the same way, because
 * admins see the tab too. Every SQL case runs in a rolled-back transaction;
 * the REST case commits inside year 2042 and deletes what it wrote in
 * `finally`.
 */

/** `my_leave_records()`, as whoever the connection currently is: each row's id, member and range as text. */
async function myLeaveRecords(client: Client): Promise<{ id: string; memberId: string; during: string }[]> {
  const { rows } = await client.query<{ id: string; memberId: string; during: string }>(
    `select id::text as id, member_id::text as "memberId", during::text as during
       from public.my_leave_records()`,
  );
  return rows;
}

describe("a member reads their own live leave records alone, with no author and no removal (story 5.2c)", () => {
  it.skipIf(noDatabase)('returns exactly id, member_id and during', async () => {
    const client = await connect();
    try {
      const { fields } = await client.query('select * from public.my_leave_records() limit 0');
      expect(fields.map((field) => field.name)).toEqual(['id', 'member_id', 'during']);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    "gives the $fixture member their own live records, never a removed one or the bystander's, and the admin their own",
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;

        await actAs(client, owner.authUserId, organization);
        const kept = await insertLeave(client, { organization, member: self.id, during: '[2042-03-02,2042-03-06]' });
        const removed = await insertLeave(client, { organization, member: self.id, during: '[2042-04-06,2042-04-10]' });
        await removeLeaveRecord(client, removed);
        const later = await insertLeave(client, { organization, member: self.id, during: '[2042-05-04,2042-05-05]' });
        await insertLeave(client, { organization, member: other.id, during: '[2042-03-02,2042-03-06]' });
        const own = await insertLeave(client, { organization, member: owner.id, during: '[2042-06-01,2042-06-03]' });

        await actAs(client, self.authUserId, organization);
        const asMember = await myLeaveRecords(client);
        await actAs(client, other.authUserId, organization);
        const asBystander = await myLeaveRecords(client);
        await actAs(client, owner.authUserId, organization);
        const asAdmin = await myLeaveRecords(client);
        await actAsOwner(client);

        expect(asMember, `${slug}: the member's own live records`).toEqual([
          { id: kept, memberId: self.id, during: '[2042-03-02,2042-03-07)' },
          { id: later, memberId: self.id, during: '[2042-05-04,2042-05-06)' },
        ]);
        expect(asBystander.map((row) => row.memberId), `${slug}: the bystander read another member's record`).toEqual([
          other.id,
        ]);
        // AN ADMIN READS THEIR OWN, never the organization's: the tab is personal.
        expect(asAdmin, `${slug}: the admin's own record`).toEqual([
          { id: own, memberId: owner.id, during: '[2042-06-01,2042-06-04)' },
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'gives a $fixture member with no claim, or an inactive one, nothing',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        await actAs(client, owner.authUserId, organization);
        await insertLeave(client, { organization, member: self.id, during: '[2042-03-02,2042-03-06]' });
        await actAsOwner(client);

        await actAs(client, self.authUserId, null);
        expect(await myLeaveRecords(client), `${slug}: a session with no organization claim read a record`).toEqual([]);
        await actAsOwner(client);

        // Banned: `current_member_access()` reports the account inactive.
        await client.query("update auth.users set banned_until = now() + interval '1 day' where id = $1", [
          self.authUserId,
        ]);
        await actAs(client, self.authUserId, organization);
        expect(await myLeaveRecords(client), `${slug}: an inactive member read a record`).toEqual([]);
        await actAsOwner(client);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'never gives a $fixture member a $otherFixture record, under its own claim or a forged one',
    async ({ slug, member, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const self = await memberByUsername(client, slug, member);
        const foreignFixture = FIXTURES.find((entry) => entry.slug === otherSlug);
        const foreignOwner = await memberByUsername(client, otherSlug, foreignFixture?.admin ?? '');
        const foreignMember = await memberByUsername(client, otherSlug, foreignFixture?.member ?? '');
        await actAs(client, foreignOwner.authUserId, foreignOwner.organizationId);
        await insertLeave(client, {
          organization: foreignOwner.organizationId,
          member: foreignMember.id,
          during: '[2042-03-02,2042-03-06]',
        });

        await actAs(client, self.authUserId, self.organizationId);
        const ownClaim = await myLeaveRecords(client);
        await actAs(client, self.authUserId, foreignOwner.organizationId);
        const forgedClaim = await myLeaveRecords(client);
        await actAsOwner(client);

        expect(ownClaim, `${slug} read a ${otherSlug} record`).toEqual([]);
        expect(forgedClaim, `${slug} read a ${otherSlug} record under a forged claim`).toEqual([]);
      });
    },
  );

  it.skipIf(noApi)('refuses an anonymous caller', async () => {
    const response = await rest('rpc/my_leave_records', { method: 'POST', body: {} });
    expect(response.status, 'an anonymous caller reached my_leave_records').toBe(401);
    const refusal = await restRefusal(response);
    expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
    expect(refusal.message).toBe('permission denied for function my_leave_records');
  });

  it.skipIf(noApi).each(FIXTURES)(
    'answers the $fixture member over PostgREST with their own rows alone, none carrying created_by or removed_by',
    async ({ slug, admin, member, bystander }) => {
      const client = await connect();
      const year2042 = '[2042-01-01,2043-01-01)';
      let cleanup: string[] = [];
      try {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const by = owner.authUserId;
        cleanup = [self.id, other.id];
        // Leftovers of an interrupted run, before anything is seeded.
        await client.query('delete from leave_records where member_id = any($1::uuid[]) and during && $2::daterange', [
          cleanup,
          year2042,
        ]);

        const kept = await insertLeave(client, { organization, member: self.id, during: '[2042-09-10,2042-09-14]', by });
        await insertLeave(client, { organization, member: other.id, during: '[2042-09-10,2042-09-14]', by });

        const response = await rest('rpc/my_leave_records', {
          token: await tokenFor(member, slug),
          method: 'POST',
          body: {},
        });
        expect(response.status, slug).toBe(200);
        const rows = (await response.json()) as Record<string, unknown>[];
        const inYear = rows.filter((row) => typeof row['during'] === 'string' && row['during'].startsWith('[2042-'));

        expect(rows.length, `${slug}: no row came back`).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row['member_id'], `${slug}: a row of another member`).toBe(self.id);
          expect(Object.keys(row).sort(), `${slug}: a row carries more than its three columns`).toEqual([
            'during',
            'id',
            'member_id',
          ]);
        }
        expect(inYear, slug).toEqual([{ id: kept, member_id: self.id, during: '[2042-09-10,2042-09-15)' }]);
        // The client's own parser reads the range the function returns.
        expect(leaveRangeOf(inYear[0]?.['during']), slug).toEqual({ from: '2042-09-10', to: '2042-09-14' });
      } finally {
        if (cleanup.length > 0) {
          await client.query('delete from leave_records where member_id = any($1::uuid[]) and during && $2::daterange', [
            cleanup,
            year2042,
          ]);
        }
        await client.end();
      }
    },
    20_000,
  );
});

// ------------------------------- story 7.15: the admin's leave overview

/**
 * STORY 7.15 (`0034`). An admin's *Godišnji* reads every live leave record of
 * the organization through `leave_overview_records()`, shaped
 * `id, member_id, during` as 0030's are: never an author or a removal, never
 * another organization's row. A member-role session, an inactive admin and a
 * session with no claim are REFUSED with 42501 `LEAVE_OVERVIEW_REFUSED` —
 * the select policy would quietly show a member their own rows, so the
 * refusal is the function's. Every SQL case runs in a rolled-back
 * transaction; the REST case commits inside year 2043 and deletes what it
 * wrote in `finally`.
 */

/** `leave_overview_records()`, as whoever the connection currently is: each row's id, member and range as text. */
async function leaveOverviewRecords(client: Client): Promise<{ id: string; memberId: string; during: string }[]> {
  const { rows } = await client.query<{ id: string; memberId: string; during: string }>(
    `select id::text as id, member_id::text as "memberId", during::text as during
       from public.leave_overview_records()`,
  );
  return rows;
}

describe("an active admin reads the organization's live leave records, and nobody else does (story 7.15)", () => {
  it.skipIf(noDatabase)('returns exactly id, member_id and during', async () => {
    const client = await connect();
    try {
      const { fields } = await client.query('select * from public.leave_overview_records() limit 0');
      expect(fields.map((field) => field.name)).toEqual(['id', 'member_id', 'during']);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    "gives the $fixture admin every member's live record and never a removed one",
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;

        await actAs(client, owner.authUserId, organization);
        const before = await leaveOverviewRecords(client);
        const kept = await insertLeave(client, { organization, member: self.id, during: '[2042-03-02,2042-03-06]' });
        const removed = await insertLeave(client, { organization, member: self.id, during: '[2042-04-06,2042-04-10]' });
        await removeLeaveRecord(client, removed);
        const others = await insertLeave(client, { organization, member: other.id, during: '[2042-03-02,2042-03-06]' });
        const own = await insertLeave(client, { organization, member: owner.id, during: '[2042-06-01,2042-06-03]' });
        const after = await leaveOverviewRecords(client);
        await actAsOwner(client);

        const added = after.filter((row) => !before.some((earlier) => earlier.id === row.id));
        expect(
          [...added].sort((first, second) => first.id.localeCompare(second.id)),
          `${slug}: the organization's new live records`,
        ).toEqual(
          [
            { id: kept, memberId: self.id, during: '[2042-03-02,2042-03-07)' },
            { id: others, memberId: other.id, during: '[2042-03-02,2042-03-07)' },
            { id: own, memberId: owner.id, during: '[2042-06-01,2042-06-04)' },
          ].sort((first, second) => first.id.localeCompare(second.id)),
        );
        expect(after.map((row) => row.id), `${slug}: a removed record was read`).not.toContain(removed);
        // EVERY live record the table holds for the organization, as the owner sees it.
        const { rows } = await client.query<{ count: number }>(
          'select count(*)::int as count from leave_records where organization_id = $1 and removed_at is null',
          [organization],
        );
        expect(after.length, `${slug}: the overview missed a live record`).toBe(rows[0]?.count);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture member-role account, an inactive admin, a session with no claim and a claim that is no UUID with 42501',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const inactive = await addThrowawayAdmin(client, organization);

        await actAs(client, owner.authUserId, organization);
        await insertLeave(client, { organization, member: self.id, during: '[2042-09-10,2042-09-14]' });
        await actAsOwner(client);
        await ownerVersion(client, {
          organization,
          member: inactive.id,
          active: false,
          from: await organizationDay(client, organization),
          by: owner.authUserId,
        });

        const refusals: Record<string, Refusal> = {};
        for (const [label, caller, claim] of [
          ['member', self.authUserId, organization],
          ['inactive admin', inactive.authUserId, organization],
          ['no claim', owner.authUserId, null],
          // A malformed claim is no organization: 42501, never the cast's 22P02.
          ['claim that is no UUID', owner.authUserId, 'not-a-uuid'],
        ] as const) {
          await actAs(client, caller, claim);
          refusals[label] = await refusedThenContinue(client, () => leaveOverviewRecords(client));
          await actAsOwner(client);
        }

        for (const [label, refusal] of Object.entries(refusals)) {
          expect(refusal, `${slug}: ${label}`).toEqual({ code: '42501', message: 'LEAVE_OVERVIEW_REFUSED' });
        }
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'never gives a $fixture admin a $otherFixture record, and refuses a forged claim',
    async ({ slug, admin, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const foreignFixture = FIXTURES.find((entry) => entry.slug === otherSlug);
        const foreignOwner = await memberByUsername(client, otherSlug, foreignFixture?.admin ?? '');
        const foreignMember = await memberByUsername(client, otherSlug, foreignFixture?.member ?? '');
        await actAs(client, foreignOwner.authUserId, foreignOwner.organizationId);
        const foreign = await insertLeave(client, {
          organization: foreignOwner.organizationId,
          member: foreignMember.id,
          during: '[2042-03-02,2042-03-06]',
        });

        await actAs(client, owner.authUserId, owner.organizationId);
        const ownClaim = await leaveOverviewRecords(client);
        await actAsOwner(client);
        await actAs(client, owner.authUserId, foreignOwner.organizationId);
        const forged = await refusedThenContinue(client, () => leaveOverviewRecords(client));
        await actAsOwner(client);

        expect(ownClaim.map((row) => row.id), `${slug} read a ${otherSlug} record`).not.toContain(foreign);
        const { rows } = await client.query<{ id: string }>(
          'select id::text as id from members where organization_id = $1',
          [owner.organizationId],
        );
        const own = new Set(rows.map((row) => row.id));
        for (const row of ownClaim) expect(own.has(row.memberId), `${slug} read a foreign member's record`).toBe(true);
        expect(forged.code, `${slug} read ${otherSlug} under a forged claim`).toBe('42501');
      });
    },
  );

  it.skipIf(noApi)('refuses an anonymous caller', async () => {
    const response = await rest('rpc/leave_overview_records', { method: 'POST', body: {} });
    expect(response.status, 'an anonymous caller reached leave_overview_records').toBe(401);
    const refusal = await restRefusal(response);
    expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
    expect(refusal.message).toBe('permission denied for function leave_overview_records');
  });

  it.skipIf(noApi).each(FIXTURES)(
    'refuses the $fixture member over PostgREST, and answers the admin with three columns and an exact count',
    async ({ slug, admin, member }) => {
      const client = await connect();
      const year2043 = '[2043-01-01,2044-01-01)';
      let cleanup: string[] = [];
      try {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const by = owner.authUserId;
        cleanup = [self.id];
        // Leftovers of an interrupted run, before anything is seeded.
        await client.query('delete from leave_records where member_id = any($1::uuid[]) and during && $2::daterange', [
          cleanup,
          year2043,
        ]);

        const kept = await insertLeave(client, { organization, member: self.id, during: '[2043-09-10,2043-09-14]', by });

        const refusedResponse = await rest('rpc/leave_overview_records', {
          token: await tokenFor(member, slug),
          method: 'POST',
          body: {},
        });
        expect(refusedResponse.status, `${slug}: the member was not refused`).toBe(403);
        const refusal = await restRefusal(refusedResponse);
        expect(refusal.code, slug).toBe('42501');
        expect(refusal.message, slug).toBe('LEAVE_OVERVIEW_REFUSED');

        const response = await rest('rpc/leave_overview_records?order=id.asc', {
          token: await tokenFor(admin, slug),
          method: 'POST',
          body: {},
          prefer: 'count=exact',
        });
        expect(response.status, slug).toBe(200);
        const rows = (await response.json()) as Record<string, unknown>[];
        const range = response.headers.get('content-range') ?? '';
        expect(range.split('/')[1], `${slug}: the count is not exact`).toBe(String(rows.length));
        for (const row of rows) {
          expect(Object.keys(row).sort(), `${slug}: a row carries more than its three columns`).toEqual([
            'during',
            'id',
            'member_id',
          ]);
        }
        expect(rows.filter((row) => row['id'] === kept), slug).toEqual([
          { id: kept, member_id: self.id, during: '[2043-09-10,2043-09-15)' },
        ]);
      } finally {
        if (cleanup.length > 0) {
          await client.query('delete from leave_records where member_id = any($1::uuid[]) and during && $2::daterange', [
            cleanup,
            year2043,
          ]);
        }
        await client.end();
      }
    },
    20_000,
  );
});

/**
 * STORY 5.3a. A collision is derived on read, `leave ∩ working shift ∩
 * roster` (AD-4), by `packages/domain` alone: no table holds one and no
 * routine computes one. From the live rows, the collisions a record raises
 * agree with its cost; amended through `amend_leave_record()` (0029) onto
 * non-working dates, every collision it caused is gone, and removed through
 * `remove_leave_record()`, none remain — and nothing but the leave rows was
 * written to clear them. Every case runs in a rolled-back transaction.
 */

/**
 * The organization-wide collision input from the rows as the connection sees
 * them: the shared schedule fields and every live leave record, parsed by the
 * client's own `leaveRangeOf`.
 */
async function collisionInputOf(client: Client, organization: string): Promise<CollisionInput> {
  const shared = await organizationScheduleInputOf(client, organization);
  const { rows } = await client.query<{ id: string; memberId: string; during: string }>(
    `select id::text as id, member_id::text as "memberId", during::text as during
       from leave_records where organization_id = $1 and removed_at is null`,
    [organization],
  );
  return {
    ...shared,
    leaveRecords: rows.map((row) => {
      const range = leaveRangeOf(row.during);
      if (range === null) throw new Error(`a live record does not parse: ${row.during}`);
      return { id: row.id, memberId: row.memberId, ...range };
    }),
  };
}

describe('a collision is derived from the live leave rows, agrees with the cost, and clears when the leave is amended off working days or removed (story 5.3a)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'raises a $fixture record\'s collisions on its working dates alone, clears them when 0029 amends it onto non-working dates, and leaves none after its removal',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const setup = await leaveYearSetup(client, organization, owner, self.id, [3]);
        const [range] = setup.ranges;
        if (range === undefined) throw new Error('no range');
        const input = await memberScheduleInputOf(client, organization, self.id);
        const baseline = collisionsOf(await collisionInputOf(client, organization));
        expect(
          baseline.filter((one) => one.memberId === self.id),
          `${slug}: the member collides before any leave`,
        ).toEqual([]);

        // Two consecutive non-working dates for the member after the range, inside the current leave year and
        // clear of every other live record of theirs: where the amend moves it, so 0029 cannot refuse it for an
        // unrelated overlap.
        const year = leaveYearOf(setup.today, setup.leaveYearStart);
        const others = (await liveLeaveOf(client, self.id)).map((record) => record.range);
        const end = new Date(`${range.to}T00:00:00Z`);
        let off: LeaveRange | undefined;
        for (let day = 0; day < 60 && off === undefined; day += 1) {
          end.setUTCDate(end.getUTCDate() + 1);
          const from = end.toISOString().slice(0, 10);
          const next = new Date(end);
          next.setUTCDate(next.getUTCDate() + 1);
          const to = next.toISOString().slice(0, 10);
          if (to > year.to) break;
          if (others.some((other) => other.from <= to && other.to >= from)) continue;
          if (leaveCostOf(input, from, to) === 0) off = { from, to };
        }
        if (off === undefined) {
          throw new Error(
            `${slug}: no two non-working dates after ${range.to} inside the leave year ${year.from}–${year.to} and clear of live leave`,
          );
        }

        // RECORD: one collision per working date of the range, agreeing with its cost of 3.
        const rulesBeforeInsert = await scheduleRulesFingerprint(client);
        const overridesBeforeInsert = await overridesFingerprint(client);
        await actAs(client, owner.authUserId, organization);
        const id = await insertLeave(client, { organization, member: self.id, during: `[${range.from},${range.to}]` });
        await actAsOwner(client);
        expect(await scheduleRulesFingerprint(client), `${slug}: recording touched a rotation, membership or status row`).toBe(
          rulesBeforeInsert,
        );
        expect(await overridesFingerprint(client), `${slug}: recording touched a time or an override`).toBe(overridesBeforeInsert);
        const recorded = collisionsOf(await collisionInputOf(client, organization));
        const own = recorded.filter((one) => one.memberId === self.id);
        expect(own.length, `${slug}: the record raises no collision`).toBeGreaterThan(0);
        expect(own.every((one) => one.leaveRecordId === id), `${slug}: a collision names another record`).toBe(true);
        expect(new Set(own.map((one) => one.date)).size, `${slug}: the collision dates disagree with the cost`).toBe(
          leaveCostOf(input, range.from, range.to),
        );
        expect(
          new Set(own.map((one) => one.date)).size,
          `${slug}: leaveYearSetup(..., [3]) chose a range costing 3, so it raises collisions on exactly 3 dates`,
        ).toBe(3);
        expect(
          recorded.filter((one) => one.memberId !== self.id).map(collisionKeyOf),
          `${slug}: recording one member's leave changed another's collisions`,
        ).toEqual(baseline.map(collisionKeyOf));

        // AMEND onto non-working dates: every collision it caused is gone, and only the leave rows were written.
        const rulesBefore = await scheduleRulesFingerprint(client);
        const overridesBefore = await overridesFingerprint(client);
        await actAs(client, owner.authUserId, organization);
        const replacement = await amendLeaveRecord(client, id, off.from, off.to);
        await actAsOwner(client);
        const amended = collisionsOf(await collisionInputOf(client, organization));
        expect(amended.filter((one) => one.leaveRecordId === id), `${slug}: a collision still names the amended record`).toEqual([]);
        expect(amended.filter((one) => one.memberId === self.id), `${slug}: leave on non-working dates collides`).toEqual([]);
        expect(amended, `${slug}: the amend left the organization's collisions changed`).toEqual(baseline);
        expect(await scheduleRulesFingerprint(client), `${slug}: clearing touched a rotation, membership or status row`).toBe(
          rulesBefore,
        );
        expect(await overridesFingerprint(client), `${slug}: clearing touched a time or an override`).toBe(overridesBefore);
        const { rows: leaveRows } = await client.query<{ id: string; live: boolean }>(
          `select id::text as id, removed_at is null as live from leave_records
            where id = any($1::uuid[]) order by id`,
          [[id, replacement]],
        );
        const expectedRows = [
          { id, live: false },
          { id: replacement, live: true },
        ].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
        expect(leaveRows, `${slug}: the amend did not leave the original removed and the replacement live`).toEqual(expectedRows);
        const { rows: liveRows } = await client.query<{ id: string }>(
          'select id::text as id from leave_records where member_id = $1 and removed_at is null',
          [self.id],
        );
        expect(liveRows.map((row) => row.id), `${slug}: the amend left more than the replacement live`).toEqual([replacement]);

        // REMOVE: none remain.
        await actAs(client, owner.authUserId, organization);
        await removeLeaveRecord(client, replacement);
        await actAsOwner(client);
        expect(await scheduleRulesFingerprint(client), `${slug}: removing touched a rotation, membership or status row`).toBe(
          rulesBefore,
        );
        expect(await overridesFingerprint(client), `${slug}: removing touched a time or an override`).toBe(overridesBefore);
        const removed = collisionsOf(await collisionInputOf(client, organization));
        expect(
          removed.filter((one) => one.memberId === self.id || one.leaveRecordId === id || one.leaveRecordId === replacement),
          `${slug}: a collision survives the removal`,
        ).toEqual([]);
        expect(removed, `${slug}: the removal left the organization's collisions changed`).toEqual(baseline);
      });
    },
  );
});

/**
 * STORY 5.4a. A resolution is stored against `collisionKeyOf`'s `(member,
 * date, team)`, attributed, one live per conflict, by an active admin alone
 * (0031); a member reads their own live rows through
 * `my_conflict_resolutions()` and the table not at all. A resolution lives
 * while a live leave record of its member covers its date: 0031's re-created
 * `remove_leave_record()` and `amend_leave_record()` soft-remove the ones they
 * uncover, in the same call. No database routine derives a collision, so the
 * rows here need none. Every case runs in a rolled-back transaction.
 */

/** Two teams of the organization, in name order: a resolution's key needs a team, not a collision. */
async function twoTeamsOf(client: Client, organization: string): Promise<[string, string]> {
  const { rows } = await client.query<{ id: string }>(
    'select id::text as id from teams where organization_id = $1 order by name limit 2',
    [organization],
  );
  const [first, second] = rows;
  if (first === undefined || second === undefined) throw new Error(`organization ${organization} has fewer than two teams`);
  return [first.id, second.id];
}

/** The leave every resolution case stands on (0031's trigger): 10.–14.09.2042 for each of `members`, as the current session. */
async function leaveOver(client: Client, organization: string, members: readonly string[]): Promise<void> {
  for (const member of members) await insertLeave(client, { organization, member, during: '[2042-09-10,2042-09-14]' });
}

/** One resolution, written as whoever the connection currently is: the five columns a session may name. */
async function insertResolution(
  client: Client,
  resolution: { organization: string; member: string; date: string; team: string; kind?: string },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into conflict_resolutions (organization_id, member_id, date, team_id, kind)
     values ($1, $2, $3::date, $4, $5)
     returning id::text as id`,
    [resolution.organization, resolution.member, resolution.date, resolution.team, resolution.kind ?? 'accept_uncovered'],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('the resolution insert returned no id');
  return id;
}

/** Every resolution of the member, whole and in date order, as the owner sees it. */
async function resolutionRowsOf(
  client: Client,
  memberId: string,
): Promise<{ id: string; date: string; teamId: string; createdBy: string; removedBy: string | null; live: boolean }[]> {
  const { rows } = await client.query<{ id: string; date: string; teamId: string; createdBy: string; removedBy: string | null; live: boolean }>(
    `select id::text as id, date::text as date, team_id::text as "teamId", created_by::text as "createdBy",
            removed_by::text as "removedBy", removed_at is null as live
       from conflict_resolutions where member_id = $1 order by date, team_id, created_at`,
    [memberId],
  );
  return rows;
}

/** `my_conflict_resolutions()`, as whoever the connection currently is. */
async function myConflictResolutions(
  client: Client,
): Promise<{ memberId: string; date: string; teamId: string; kind: string }[]> {
  const { rows } = await client.query<{ memberId: string; date: string; teamId: string; kind: string }>(
    `select member_id::text as "memberId", date::text as date, team_id::text as "teamId", kind
       from public.my_conflict_resolutions()`,
  );
  return rows;
}

describe('a conflict resolution is recorded by an active admin alone, one live per conflict, and read by its member alone (story 5.4a)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'records a $fixture resolution as its admin, attributed by default, with two teams of one date keyed apart',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const [team, otherTeam] = await twoTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        const id = await insertResolution(client, { organization, member: self.id, date: '2042-09-12', team });
        // Two teams on one date are two conflicts, so two keys.
        const second = await insertResolution(client, {
          organization,
          member: self.id,
          date: '2042-09-12',
          team: otherTeam,
          // Not `replace_member`: since story 5.4c that kind is written only
          // through 0032's function, with its override.
          kind: 'amend_leave',
        });
        const { rows: read } = await client.query<{ id: string }>(
          'select id::text as id from conflict_resolutions where member_id = $1 order by team_id',
          [self.id],
        );
        await actAsOwner(client);

        expect(new Set(read.map((row) => row.id)), `${slug}: the admin does not read the organization's rows`).toEqual(
          new Set([id, second]),
        );
        const { rows } = await client.query<{ createdBy: string; recent: boolean; removedBy: string | null; removedAt: string | null }>(
          `select created_by::text as "createdBy", created_at > now() - interval '1 minute' as recent,
                  removed_by::text as "removedBy", removed_at::text as "removedAt"
             from conflict_resolutions where id = $1`,
          [id],
        );
        expect(rows, `${slug}: the resolution is not attributed to its caller`).toEqual([
          { createdBy: owner.authUserId, recent: true, removedBy: null, removedAt: null },
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a second live $fixture resolution of one key (23505), an unknown kind (23514), and admits the key again once the first is removed',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const [team] = await twoTeamsOf(client, organization);
        const key = { organization, member: self.id, date: '2042-09-12', team };

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        await insertResolution(client, key);
        const codes = {
          duplicate: (await refusedThenContinue(client, () => insertResolution(client, { ...key, kind: 'amend_leave' }))).code,
          'unknown kind': (
            await refusedThenContinue(client, () => insertResolution(client, { ...key, date: '2042-09-13', kind: 'uncovered' }))
          ).code,
        };
        await actAsOwner(client);
        expect(codes, slug).toEqual({ duplicate: '23505', 'unknown kind': '23514' });

        // A removed row leaves the key.
        await client.query(
          'update conflict_resolutions set removed_by = $2, removed_at = now() where member_id = $1',
          [self.id, owner.authUserId],
        );
        await actAs(client, owner.authUserId, organization);
        await insertResolution(client, key);
        await actAsOwner(client);
        expect((await resolutionRowsOf(client, self.id)).map((row) => row.live), slug).toEqual([false, true]);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'refuses a $fixture member, a forged author, another organization and an update or a delete (42501), another tenant\'s team (23503), and another tenant\'s member as off leave (P0002)',
    async ({ slug, admin, member, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const [team] = await twoTeamsOf(client, organization);
        const foreignFixture = FIXTURES.find((entry) => entry.slug === otherSlug);
        const foreignOwner = await memberByUsername(client, otherSlug, foreignFixture?.admin ?? '');
        const foreignMember = await memberByUsername(client, otherSlug, foreignFixture?.member ?? '');
        const [foreignTeam] = await twoTeamsOf(client, foreignOwner.organizationId);
        const key = { organization, member: self.id, date: '2042-09-12', team };

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        const id = await insertResolution(client, key);
        const codes: Record<string, string> = {};
        codes['forged author'] = (
          await refusedThenContinue(client, () =>
            client.query(
              `insert into conflict_resolutions (organization_id, member_id, date, team_id, kind, created_by)
               values ($1, $2, '2042-09-13', $3, 'accept_uncovered', $4)`,
              [organization, self.id, team, self.authUserId],
            ),
          )
        ).code;
        codes['another organization'] = (
          await refusedThenContinue(client, () =>
            insertResolution(client, {
              organization: foreignOwner.organizationId,
              member: foreignMember.id,
              date: '2042-09-12',
              team: foreignTeam,
            }),
          )
        ).code;
        codes['another tenant\'s member'] = (
          await refusedThenContinue(client, () => insertResolution(client, { ...key, member: foreignMember.id }))
        ).code;
        codes['another tenant\'s team'] = (
          await refusedThenContinue(client, () => insertResolution(client, { ...key, team: foreignTeam }))
        ).code;
        codes['update'] = (
          await refusedThenContinue(client, () =>
            client.query('update conflict_resolutions set removed_by = $2, removed_at = now() where id = $1', [id, owner.authUserId]),
          )
        ).code;
        codes['delete'] = (await refusedThenContinue(client, () => client.query('delete from conflict_resolutions'))).code;

        await actAs(client, owner.authUserId, foreignOwner.organizationId);
        codes['forged claim'] = (
          await refusedThenContinue(client, () =>
            insertResolution(client, {
              organization: foreignOwner.organizationId,
              member: foreignMember.id,
              date: '2042-09-12',
              team: foreignTeam,
            }),
          )
        ).code;
        const { rows: forgedRead } = await client.query('select 1 from conflict_resolutions');

        await actAs(client, self.authUserId, organization);
        codes['member'] = (await refusedThenContinue(client, () => insertResolution(client, { ...key, date: '2042-09-13' }))).code;
        const { rows: memberRead } = await client.query('select 1 from conflict_resolutions');
        await actAsOwner(client);

        expect(codes, slug).toEqual({
          'forged author': '42501',
          'another organization': '42501',
          // 0031's trigger runs before the key: no live leave of that member in this organization.
          'another tenant\'s member': 'P0002',
          'another tenant\'s team': '23503',
          update: '42501',
          delete: '42501',
          'forged claim': '42501',
          member: '42501',
        });
        expect(forgedRead, `${slug}: a forged claim read ${otherSlug}'s resolutions or its own`).toEqual([]);
        expect(memberRead, `${slug}: a member-role session read the table, authors and all`).toEqual([]);
        expect(await resolutionRowsOf(client, self.id), `${slug}: a refused write changed a row`).toEqual([
          { id, date: '2042-09-12', teamId: team, createdBy: owner.authUserId, removedBy: null, live: true },
        ]);
      });
    },
  );

  it.skipIf(noDatabase)('my_conflict_resolutions returns exactly member_id, date, team_id, kind and, since 0033, roster_override_id', async () => {
    const client = await connect();
    try {
      const { fields } = await client.query('select * from public.my_conflict_resolutions() limit 0');
      expect(fields.map((field) => field.name)).toEqual(['member_id', 'date', 'team_id', 'kind', 'roster_override_id']);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    "gives the $fixture member their own live resolutions, never a removed one or the bystander's, and nothing with no claim or inactive",
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const [team, otherTeam] = await twoTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id, other.id]);
        await insertResolution(client, { organization, member: self.id, date: '2042-09-14', team: otherTeam, kind: 'amend_leave' });
        await insertResolution(client, { organization, member: self.id, date: '2042-09-12', team });
        await insertResolution(client, { organization, member: self.id, date: '2042-09-13', team });
        await insertResolution(client, { organization, member: other.id, date: '2042-09-12', team });
        await actAsOwner(client);
        await client.query(
          "update conflict_resolutions set removed_by = $2, removed_at = now() where member_id = $1 and date = '2042-09-13'",
          [self.id, owner.authUserId],
        );

        await actAs(client, self.authUserId, organization);
        const asMember = await myConflictResolutions(client);
        await actAs(client, other.authUserId, organization);
        const asBystander = await myConflictResolutions(client);
        await actAs(client, self.authUserId, null);
        const noClaim = await myConflictResolutions(client);
        await actAsOwner(client);
        await client.query("update auth.users set banned_until = now() + interval '1 day' where id = $1", [self.authUserId]);
        await actAs(client, self.authUserId, organization);
        const inactive = await myConflictResolutions(client);
        await actAsOwner(client);

        expect(asMember, `${slug}: the member's own live resolutions, soonest first`).toEqual([
          { memberId: self.id, date: '2042-09-12', teamId: team, kind: 'accept_uncovered' },
          { memberId: self.id, date: '2042-09-14', teamId: otherTeam, kind: 'amend_leave' },
        ]);
        expect(asBystander.map((row) => row.memberId), `${slug}: the bystander read another member's resolution`).toEqual([other.id]);
        expect(noClaim, `${slug}: a session with no organization claim read a resolution`).toEqual([]);
        expect(inactive, `${slug}: an inactive member read a resolution`).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'never gives a $fixture member a $otherFixture resolution, under its own claim or a forged one',
    async ({ slug, member, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const self = await memberByUsername(client, slug, member);
        const foreignFixture = FIXTURES.find((entry) => entry.slug === otherSlug);
        const foreignOwner = await memberByUsername(client, otherSlug, foreignFixture?.admin ?? '');
        const foreignMember = await memberByUsername(client, otherSlug, foreignFixture?.member ?? '');
        const [foreignTeam] = await twoTeamsOf(client, foreignOwner.organizationId);
        await actAs(client, foreignOwner.authUserId, foreignOwner.organizationId);
        await leaveOver(client, foreignOwner.organizationId, [foreignMember.id]);
        await insertResolution(client, {
          organization: foreignOwner.organizationId,
          member: foreignMember.id,
          date: '2042-09-12',
          team: foreignTeam,
        });

        await actAs(client, self.authUserId, self.organizationId);
        const ownClaim = await myConflictResolutions(client);
        await actAs(client, self.authUserId, foreignOwner.organizationId);
        const forgedClaim = await myConflictResolutions(client);
        await actAsOwner(client);

        expect(ownClaim, `${slug} read a ${otherSlug} resolution`).toEqual([]);
        expect(forgedClaim, `${slug} read a ${otherSlug} resolution under a forged claim`).toEqual([]);
      });
    },
  );

  it.skipIf(noApi)('refuses an anonymous caller of my_conflict_resolutions and of the table', async () => {
    const response = await rest('rpc/my_conflict_resolutions', { method: 'POST', body: {} });
    expect(response.status, 'an anonymous caller reached my_conflict_resolutions').toBe(401);
    const refusal = await restRefusal(response);
    expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
    expect(refusal.message).toBe('permission denied for function my_conflict_resolutions');
    const table = await rest('conflict_resolutions?select=id');
    expect(table.status, 'an anonymous caller read conflict_resolutions').toBe(401);
    expect((await restRefusal(table)).code).toBe('42501');
  });
});

describe('a resolution lives while a live leave record of its member covers its date (story 5.4a, human 2026-10-02)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'a $fixture removal soft-removes the resolutions dated in the removed range, attributed to the admin, and nothing else; new leave over the date finds it unresolved',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const other = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const [team, otherTeam] = await twoTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        const leave = await insertLeave(client, { organization, member: self.id, during: '[2042-09-10,2042-09-14]' });
        await insertLeave(client, { organization, member: self.id, during: '[2042-09-20,2042-09-21]' });
        await insertLeave(client, { organization, member: other.id, during: '[2042-09-10,2042-09-14]' });
        await insertResolution(client, { organization, member: self.id, date: '2042-09-10', team });
        await insertResolution(client, { organization, member: self.id, date: '2042-09-12', team });
        await insertResolution(client, { organization, member: self.id, date: '2042-09-12', team: otherTeam });
        await insertResolution(client, { organization, member: self.id, date: '2042-09-20', team });
        await insertResolution(client, { organization, member: other.id, date: '2042-09-12', team });

        await removeLeaveRecord(client, leave);
        await actAsOwner(client);

        const rows = await resolutionRowsOf(client, self.id);
        const byDateThenTeam = (left: { date: string; teamId: string }, right: { date: string; teamId: string }): number =>
          left.date !== right.date ? (left.date < right.date ? -1 : 1) : left.teamId < right.teamId ? -1 : left.teamId > right.teamId ? 1 : 0;
        expect(
          rows.map(({ date, teamId, removedBy, live }) => ({ date, teamId, removedBy, live })),
          `${slug}: the removal did not end exactly the resolutions in its range, as the admin`,
        ).toEqual(
          [
            { date: '2042-09-10', teamId: team, removedBy: owner.authUserId, live: false },
            { date: '2042-09-12', teamId: team, removedBy: owner.authUserId, live: false },
            { date: '2042-09-12', teamId: otherTeam, removedBy: owner.authUserId, live: false },
            { date: '2042-09-20', teamId: team, removedBy: null, live: true },
          ].sort(byDateThenTeam),
        );
        expect(
          (await resolutionRowsOf(client, other.id)).map((row) => row.live),
          `${slug}: another member's resolution was ended`,
        ).toEqual([true]);

        // REMOVE THEN RE-ADD: new leave over 12.09 finds no live resolution there.
        await actAs(client, owner.authUserId, organization);
        await insertLeave(client, { organization, member: self.id, during: '[2042-09-11,2042-09-13]' });
        await actAs(client, self.authUserId, organization);
        const asMember = await myConflictResolutions(client);
        await actAsOwner(client);
        expect(asMember.map((row) => row.date), `${slug}: a resolution came back with new leave`).toEqual(['2042-09-20']);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'a $fixture amend ends only the resolutions dated in the old range and not the new one; one whose date stays covered survives unchanged',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const [team] = await twoTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        const leave = await insertLeave(client, { organization, member: self.id, during: '[2042-09-10,2042-09-14]' });
        await insertResolution(client, { organization, member: self.id, date: '2042-09-11', team });
        await insertResolution(client, { organization, member: self.id, date: '2042-09-12', team });
        await insertResolution(client, { organization, member: self.id, date: '2042-09-14', team });
        await actAsOwner(client);
        const before = await resolutionRowsOf(client, self.id);

        // AMEND KEEP: 10–14.09 to 12–16.09. 11.09 leaves the cover; 12.09 and 14.09 stay.
        await actAs(client, owner.authUserId, organization);
        const kept = await amendLeaveRecord(client, leave, '2042-09-12', '2042-09-16');
        await actAsOwner(client);
        const afterKeep = await resolutionRowsOf(client, self.id);
        expect(afterKeep.find((row) => row.date === '2042-09-11'), `${slug}: 11.09 left the cover and kept its resolution`).toMatchObject({
          removedBy: owner.authUserId,
          live: false,
        });
        expect(
          afterKeep.filter((row) => row.date !== '2042-09-11'),
          `${slug}: a resolution whose date stays covered changed`,
        ).toEqual(before.filter((row) => row.date !== '2042-09-11'));

        // AMEND SHRINK: 12–16.09 to 15–16.09. 12.09 and 14.09 leave the cover.
        await actAs(client, owner.authUserId, organization);
        await amendLeaveRecord(client, kept, '2042-09-15', '2042-09-16');
        await actAsOwner(client);
        expect(
          (await resolutionRowsOf(client, self.id)).map(({ date, removedBy, live }) => ({ date, removedBy, live })),
          `${slug}: the shrink did not end the resolutions it uncovered`,
        ).toEqual([
          { date: '2042-09-11', removedBy: owner.authUserId, live: false },
          { date: '2042-09-12', removedBy: owner.authUserId, live: false },
          { date: '2042-09-14', removedBy: owner.authUserId, live: false },
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'a refused $fixture amend or removal leaves every resolution live and unchanged',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const [team] = await twoTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        const leave = await insertLeave(client, { organization, member: self.id, during: '[2042-09-10,2042-09-14]' });
        await insertLeave(client, { organization, member: self.id, during: '[2042-09-18,2042-09-25]' });
        await insertResolution(client, { organization, member: self.id, date: '2042-09-11', team });
        await actAsOwner(client);
        const before = await resolutionRowsOf(client, self.id);

        await actAs(client, owner.authUserId, organization);
        const overlap = (await refusedThenContinue(client, () => amendLeaveRecord(client, leave, '2042-09-13', '2042-09-20'))).code;
        await actAs(client, self.authUserId, organization);
        const asMember = (await refusedThenContinue(client, () => removeLeaveRecord(client, leave))).code;
        await actAsOwner(client);

        expect({ overlap, asMember }, slug).toEqual({ overlap: '23P01', asMember: '42501' });
        expect(await resolutionRowsOf(client, self.id), `${slug}: a refused leave write ended a resolution`).toEqual(before);
      });
    },
  );
});

describe('a resolution is born on live leave, and races neither a removal nor an amend (story 5.4a, 0031 trigger)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture resolution with no leave or only removed leave (P0002), and admits one on every date of a live range alone',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const [team] = await twoTeamsOf(client, organization);
        const on = (date: string) => ({ organization, member: self.id, date, team });

        await actAs(client, owner.authUserId, organization);
        const none = await refusedThenContinue(client, () => insertResolution(client, on('2042-09-12')));
        const removed = await insertLeave(client, { organization, member: self.id, during: '[2042-09-10,2042-09-14]' });
        await removeLeaveRecord(client, removed);
        const onlyRemoved = await refusedThenContinue(client, () => insertResolution(client, on('2042-09-12')));
        await insertLeave(client, { organization, member: self.id, during: '[2042-09-20,2042-09-22]' });
        const before = await refusedThenContinue(client, () => insertResolution(client, on('2042-09-19')));
        const after = await refusedThenContinue(client, () => insertResolution(client, on('2042-09-23')));
        for (const date of ['2042-09-20', '2042-09-21', '2042-09-22']) await insertResolution(client, on(date));
        await actAsOwner(client);

        for (const refusal of [none, onlyRemoved, before, after]) {
          expect(refusal, slug).toEqual({ code: 'P0002', message: 'CONFLICT_RESOLUTION_NOT_ON_LEAVE' });
        }
        expect((await resolutionRowsOf(client, self.id)).map((row) => row.date), slug).toEqual([
          '2042-09-20',
          '2042-09-21',
          '2042-09-22',
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'never tells a $fixture member about anyone\'s leave: their insert is the policy\'s 42501, with leave or without',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const [team] = await twoTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        await insertLeave(client, { organization, member: self.id, during: '[2042-09-10,2042-09-14]' });
        await actAs(client, self.authUserId, organization);
        const onLeave = await refusedThenContinue(client, () =>
          insertResolution(client, { organization, member: self.id, date: '2042-09-12', team }),
        );
        const offLeave = await refusedThenContinue(client, () =>
          insertResolution(client, { organization, member: self.id, date: '2042-09-20', team }),
        );
        await actAsOwner(client);

        expect([onLeave.code, offLeave.code], slug).toEqual(['42501', '42501']);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'serialises a $fixture insert against a removal of the leave it stands on, in either order',
    async ({ slug, admin, member }) => {
      const setup = await connect();
      const first = await connect();
      const second = await connect();
      const year2043 = '[2043-01-01,2044-01-01)';
      let memberId: string | null = null;
      try {
        const owner = await memberByUsername(setup, slug, admin);
        const self = await memberByUsername(setup, slug, member);
        memberId = self.id;
        const organization = owner.organizationId;
        const [team] = await twoTeamsOf(setup, organization);
        const clear = async (): Promise<void> => {
          await setup.query("delete from conflict_resolutions where member_id = $1 and date >= '2043-01-01' and date < '2044-01-01'", [
            self.id,
          ]);
          await setup.query('delete from leave_records where member_id = $1 and during && $2::daterange', [self.id, year2043]);
        };
        await clear();
        const key = { organization, member: self.id, date: '2043-09-12', team };

        // REMOVAL FIRST: the insert waits on the leave row, then finds it removed.
        const leave = await insertLeave(setup, { organization, member: self.id, during: '[2043-09-10,2043-09-14]', by: owner.authUserId });
        await first.query('begin');
        await actAs(first, owner.authUserId, organization);
        await removeLeaveRecord(first, leave);
        await second.query('begin');
        await actAs(second, owner.authUserId, organization);
        const waiting = refused(() => insertResolution(second, key));
        await new Promise((resolve) => setTimeout(resolve, 300));
        await first.query('commit');
        expect(await waiting, `${slug}: an insert after a committed removal stood`).toEqual({
          code: 'P0002',
          message: 'CONFLICT_RESOLUTION_NOT_ON_LEAVE',
        });
        await second.query('rollback');

        // INSERT FIRST: the removal waits on the share lock, then ends the new resolution with the rest.
        const again = await insertLeave(setup, { organization, member: self.id, during: '[2043-09-10,2043-09-14]', by: owner.authUserId });
        await second.query('begin');
        await actAs(second, owner.authUserId, organization);
        const id = await insertResolution(second, key);
        await first.query('begin');
        await actAs(first, owner.authUserId, organization);
        const removal = removeLeaveRecord(first, again);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await second.query('commit');
        await removal;
        await first.query('commit');
        const { rows } = await setup.query<{ live: boolean; removedBy: string | null }>(
          'select removed_at is null as live, removed_by::text as "removedBy" from conflict_resolutions where id = $1',
          [id],
        );
        expect(rows, `${slug}: a resolution outlived the leave it was recorded on`).toEqual([
          { live: false, removedBy: owner.authUserId },
        ]);
        await clear();
      } finally {
        await first.query('rollback').catch(() => undefined);
        await second.query('rollback').catch(() => undefined);
        if (memberId !== null) {
          await setup
            .query("delete from conflict_resolutions where member_id = $1 and date >= '2043-01-01' and date < '2044-01-01'", [memberId])
            .catch(() => undefined);
          await setup
            .query('delete from leave_records where member_id = $1 and during && $2::daterange', [memberId, year2043])
            .catch(() => undefined);
        }
        await Promise.all([setup.end(), first.end(), second.end()]);
      }
    },
    20_000,
  );
});

describe('an admin who is no longer an active admin reads no resolution (story 5.4a)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'shows a $fixture admin the rows, then none once demoted, and none once inactive',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const [team] = await twoTeamsOf(client, organization);
        const visible = async (): Promise<number> => {
          await actAs(client, owner.authUserId, organization);
          const { rows } = await client.query<{ count: number }>('select count(*)::int as count from conflict_resolutions');
          await actAsOwner(client);

          return rows[0]?.count ?? -1;
        };

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        await insertResolution(client, { organization, member: self.id, date: '2042-09-12', team });
        await actAsOwner(client);
        expect(await visible(), `${slug}: the active admin does not read the row`).toBeGreaterThan(0);

        await client.query('savepoint before_demotion');
        await client.query(`update members set role = 'member_role' where id = $1`, [owner.id]);
        expect(await visible(), `${slug}: a demoted admin read the resolutions`).toBe(0);
        await client.query('rollback to savepoint before_demotion');
        expect(await visible(), `${slug}: the admin lost the rows with the demotion rolled back`).toBeGreaterThan(0);

        // Banned: `current_member_access()` reports the account inactive.
        await client.query("update auth.users set banned_until = now() + interval '1 day' where id = $1", [owner.authUserId]);
        expect(await visible(), `${slug}: an inactive admin read the resolutions`).toBe(0);
      });
    },
  );
});

/**
 * STORY 5.4c. A conflict resolved by putting someone else on the shift is two
 * rows written together by 0032's `replace_conflict_member()`: a roster
 * override that ONLY ADDS the replacement (nobody taken off), and a
 * `replace_member` resolution linked to it. The link has no grant and a check
 * ties it to the kind, so a direct `replace_member` insert is 23514. The
 * function re-checks what the insert policies would — an active admin of the
 * claim, a team that is not archived — and any refusal leaves neither row.
 * Every case runs in a rolled-back transaction.
 */

/**
 * Two teams of the organization that are NOT archived, in name order: 0032
 * refuses an archived team, and the REST cases above commit archived teams of
 * their own until the file's cleanup.
 */
async function twoLiveTeamsOf(client: Client, organization: string): Promise<[string, string]> {
  const { rows } = await client.query<{ id: string }>(
    'select id::text as id from teams where organization_id = $1 and not archived order by name limit 2',
    [organization],
  );
  const [first, second] = rows;
  if (first === undefined || second === undefined) throw new Error(`organization ${organization} has fewer than two live teams`);
  return [first.id, second.id];
}

/** `replace_conflict_member()`, as whoever the connection currently is: the resolution's id. */
async function replaceConflictMember(
  client: Client,
  call: { member: string; date: string; team: string; replacement: string; reason?: string },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'select public.replace_conflict_member($1, $2::date, $3, $4, $5)::text as id',
    [call.member, call.date, call.team, call.replacement, call.reason ?? 'Zamjena za člana (godišnji)'],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('replace_conflict_member returned no id');
  return id;
}

/** Every roster override of the team, whole, as the owner sees it. */
async function rosterOverrideRowsOf(
  client: Client,
  team: string,
): Promise<{ id: string; date: string; memberOutId: string | null; memberInId: string | null; reason: string; createdBy: string; live: boolean }[]> {
  const { rows } = await client.query<{
    id: string;
    date: string;
    memberOutId: string | null;
    memberInId: string | null;
    reason: string;
    createdBy: string;
    live: boolean;
  }>(
    `select id::text as id, date::text as date, member_out_id::text as "memberOutId", member_in_id::text as "memberInId",
            reason, created_by::text as "createdBy", removed_at is null as live
       from roster_overrides where team_id = $1 and date between '2042-09-10' and '2042-09-14' order by created_at, id`,
    [team],
  );
  return rows;
}

describe('a conflict is resolved by putting someone else on the shift, the override and its resolution in one call (story 5.4c)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'records a $fixture replacement as an addition alone, linked from a replace_member resolution, both attributed to the admin',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const replacement = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const [team] = await twoLiveTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        const id = await replaceConflictMember(client, {
          member: self.id,
          date: '2042-09-12',
          team,
          replacement: replacement.id,
          reason: 'Zamjena za Anu (godišnji)',
        });
        await actAsOwner(client);

        const overrides = await rosterOverrideRowsOf(client, team);
        expect(overrides, `${slug}: the override is not the replacement's addition alone`).toEqual([
          {
            id: overrides[0]?.id,
            date: '2042-09-12',
            memberOutId: null,
            memberInId: replacement.id,
            reason: 'Zamjena za Anu (godišnji)',
            createdBy: owner.authUserId,
            live: true,
          },
        ]);
        const { rows } = await client.query<{ kind: string; link: string | null; createdBy: string; live: boolean }>(
          `select kind, roster_override_id::text as link, created_by::text as "createdBy", removed_at is null as live
             from conflict_resolutions where id = $1`,
          [id],
        );
        expect(rows, `${slug}: the resolution is not linked to its override`).toEqual([
          { kind: 'replace_member', link: overrides[0]?.id, createdBy: owner.authUserId, live: true },
        ]);
        expect(
          (await resolutionRowsOf(client, self.id)).map((row) => ({ date: row.date, teamId: row.teamId, live: row.live })),
          `${slug}: the resolution is not the conflict's key`,
        ).toEqual([{ date: '2042-09-12', teamId: team, live: true }]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a direct $fixture replace_member insert (23514) and a session naming the link (42501), and, past the grants, a link on another kind (23514)',
    async ({ slug, admin, member }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const organization = owner.organizationId;
        const [team] = await twoLiveTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        const codes = {
          'direct replace_member': (
            await refusedThenContinue(client, () =>
              insertResolution(client, { organization, member: self.id, date: '2042-09-12', team, kind: 'replace_member' }),
            )
          ).code,
          'named link': (
            await refusedThenContinue(client, () =>
              client.query(
                `insert into conflict_resolutions (organization_id, member_id, date, team_id, kind, roster_override_id)
                 values ($1, $2, '2042-09-12', $3, 'accept_uncovered', null)`,
                [organization, self.id, team],
              ),
            )
          ).code,
        };
        await actAsOwner(client);
        // As the owner, past the column grant: a link on another kind is the check's to refuse.
        const { rows: written } = await client.query<{ id: string }>(
          `insert into roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason, created_by)
           values ($1, $2, '2042-09-12', null, $3, 'Zamjena', $4)
           returning id::text as id`,
          [organization, team, owner.id, owner.authUserId],
        );
        const linked = await refusedThenContinue(client, () =>
          client.query(
            `insert into conflict_resolutions (organization_id, member_id, date, team_id, kind, created_by, roster_override_id)
             values ($1, $2, '2042-09-12', $3, 'accept_uncovered', $4, $5)`,
            [organization, self.id, team, owner.authUserId, written[0]?.id],
          ),
        );
        expect(codes, slug).toEqual({ 'direct replace_member': '23514', 'named link': '42501' });
        expect(linked.code, slug).toBe('23514');
        expect(linked.message, `${slug}: the link on another kind is not the linked check's refusal`).toMatch(
          /conflict_resolutions_replacement_linked/,
        );
        expect(await resolutionRowsOf(client, self.id), `${slug}: a refused insert wrote a row`).toEqual([]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'leaves no $fixture override behind when the resolution is refused inside the call: already resolved (23505) or off leave (P0002)',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const replacement = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const [team] = await twoLiveTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        await insertResolution(client, { organization, member: self.id, date: '2042-09-12', team });
        const resolved = await refusedThenContinue(client, () =>
          replaceConflictMember(client, { member: self.id, date: '2042-09-12', team, replacement: replacement.id }),
        );
        // 2042-09-20 is outside the leave: 0031's trigger refuses the resolution.
        const offLeave = await refusedThenContinue(client, () =>
          replaceConflictMember(client, { member: self.id, date: '2042-09-20', team, replacement: replacement.id }),
        );
        await actAsOwner(client);

        expect({ resolved: resolved.code, offLeave: offLeave.code }, slug).toEqual({ resolved: '23505', offLeave: 'P0002' });
        expect(resolved.message, `${slug}: an already-resolved conflict is not refused before the override`).toBe(
          'CONFLICT_RESOLUTION_EXISTS',
        );
        expect(offLeave.message, slug).toBe('CONFLICT_RESOLUTION_NOT_ON_LEAVE');
        const { rows } = await client.query<{ count: number }>(
          `select count(*)::int as count from roster_overrides
            where team_id = $1 and member_in_id = $2 and date between '2042-09-10' and '2042-09-20'`,
          [team, replacement.id],
        );
        expect(rows[0]?.count, `${slug}: a refused call left its override behind`).toBe(0);
      });
    },
  );

  it.skipIf(noDatabase).each(CROSS_TENANT)(
    'refuses a $fixture member, a forged claim and an archived team (42501), a replacement already put on (23505), the absent member themself (23514), and another tenant\'s replacement or team (23503)',
    async ({ slug, admin, member, otherSlug }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const replacement = await memberByUsername(client, slug, FIXTURES.find((entry) => entry.slug === slug)?.bystander ?? '');
        const organization = owner.organizationId;
        const [team, otherTeam] = await twoLiveTeamsOf(client, organization);
        const foreignFixture = FIXTURES.find((entry) => entry.slug === otherSlug);
        const foreignOwner = await memberByUsername(client, otherSlug, foreignFixture?.admin ?? '');
        const foreignMember = await memberByUsername(client, otherSlug, foreignFixture?.member ?? '');
        const [foreignTeam] = await twoTeamsOf(client, foreignOwner.organizationId);
        const call = { member: self.id, date: '2042-09-12', team, replacement: replacement.id };

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        // The replacement is already put on the shift.
        await client.query(
          `insert into roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason)
           values ($1, $2, '2042-09-12', null, $3, 'Već dodan')`,
          [organization, team, replacement.id],
        );
        const refusals: Record<string, Refusal> = {};
        refusals['taken'] = await refusedThenContinue(client, () => replaceConflictMember(client, call));
        refusals['absent member'] = await refusedThenContinue(client, () =>
          replaceConflictMember(client, { ...call, date: '2042-09-13', replacement: self.id }),
        );
        refusals['another tenant\'s replacement'] = await refusedThenContinue(client, () =>
          replaceConflictMember(client, { ...call, date: '2042-09-13', replacement: foreignMember.id }),
        );
        refusals['another tenant\'s team'] = await refusedThenContinue(client, () =>
          replaceConflictMember(client, { ...call, date: '2042-09-13', team: foreignTeam }),
        );

        await actAs(client, owner.authUserId, foreignOwner.organizationId);
        refusals['forged claim'] = await refusedThenContinue(client, () =>
          replaceConflictMember(client, { ...call, date: '2042-09-13' }),
        );
        await actAs(client, self.authUserId, organization);
        refusals['member'] = await refusedThenContinue(client, () => replaceConflictMember(client, { ...call, date: '2042-09-13' }));
        await actAsOwner(client);
        await client.query('update teams set archived = true where id = $1', [otherTeam]);
        await actAs(client, owner.authUserId, organization);
        refusals['archived team'] = await refusedThenContinue(client, () =>
          replaceConflictMember(client, { ...call, date: '2042-09-13', team: otherTeam }),
        );
        await actAsOwner(client);

        expect(
          Object.fromEntries(Object.entries(refusals).map(([name, refusal]) => [name, refusal.code])),
          slug,
        ).toEqual({
          taken: '23505',
          'absent member': '23514',
          'another tenant\'s replacement': '23503',
          'another tenant\'s team': '23503',
          'forged claim': '42501',
          member: '42501',
          'archived team': '42501',
        });
        expect(refusals['taken']?.message, `${slug}: a replacement already put on is not named`).toBe('CONFLICT_REPLACEMENT_TAKEN');
        expect(await resolutionRowsOf(client, self.id), `${slug}: a refused call wrote a resolution`).toEqual([]);
        expect(
          (await rosterOverrideRowsOf(client, team)).map((row) => row.reason),
          `${slug}: a refused call wrote an override`,
        ).toEqual(['Već dodan']);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses a $fixture conflict already resolved by that very replacement as resolved (plain 23505), never as taken',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const replacement = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const [team] = await twoLiveTeamsOf(client, organization);
        const call = { member: self.id, date: '2042-09-12', team, replacement: replacement.id };

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        await replaceConflictMember(client, call);
        // Again, with the same replacement: both live keys are taken, and the resolution's is said.
        const again = await refusedThenContinue(client, () => replaceConflictMember(client, call));
        await actAsOwner(client);

        expect(again.code, slug).toBe('23505');
        expect(again.message, `${slug}: an already-resolved conflict was refused as taken`).toBe('CONFLICT_RESOLUTION_EXISTS');
        expect((await rosterOverrideRowsOf(client, team)).length, `${slug}: a refused call wrote an override`).toBe(1);
      });
    },
  );

  it.skipIf(noApi)('refuses an anonymous caller of replace_conflict_member', async () => {
    const response = await rest('rpc/replace_conflict_member', {
      method: 'POST',
      body: {
        p_member_id: '00000000-0000-0000-0000-000000000000',
        p_date: '2042-09-12',
        p_team_id: '00000000-0000-0000-0000-000000000000',
        p_replacement_id: '00000000-0000-0000-0000-000000000001',
        p_reason: 'x',
      },
    });
    expect(response.status, 'an anonymous caller reached replace_conflict_member').toBe(401);
    const refusal = await restRefusal(response);
    expect(refusal.code, 'a privilege refusal is 42501').toBe('42501');
    expect(refusal.message).toBe('permission denied for function replace_conflict_member');
  });
});

/**
 * Story 5.5d's half in the database (0033): removing the override behind a
 * `replace_member` resolution ends that resolution in the same call,
 * attributed to the admin who removed it, which frees the conflict's key; the
 * rows 0032's gap left behind are backfilled; and a member reads their own
 * link.
 */
describe('removing the override behind a replacement ends its resolution, and frees the key (story 5.5d)', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'soft-removes the $fixture replacement with its override, attributed to the remover, and admits a new decision on the key',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const replacement = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const [team] = await twoLiveTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        const replaced = await replaceConflictMember(client, { member: self.id, date: '2042-09-12', team, replacement: replacement.id });
        const accepted = await insertResolution(client, { organization, member: self.id, date: '2042-09-13', team });
        // An override no decision wrote, on another day: removing it touches no resolution.
        await client.query(
          `insert into roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason)
           values ($1, $2, '2042-09-13', null, $3, 'Dodatni')`,
          [organization, team, replacement.id],
        );
        // One transaction, one `now()`: told apart by date, never by creation order.
        const overrides = await rosterOverrideRowsOf(client, team);
        const linked = overrides.find((row) => row.date === '2042-09-12');
        const unrelated = overrides.find((row) => row.date === '2042-09-13');
        if (linked === undefined || unrelated === undefined) throw new Error(`${slug}: the overrides were not written`);

        // A member may not remove it: nothing ends.
        await actAs(client, self.authUserId, organization);
        const refused = await refusedThenContinue(client, () => removeRosterOverride(client, linked.id));
        await actAs(client, owner.authUserId, organization);
        await removeRosterOverride(client, unrelated.id);
        const afterUnrelated = await resolutionRowsOf(client, self.id);
        await removeRosterOverride(client, linked.id);
        // The key is free: the admin decides again, and it saves.
        const again = await insertResolution(client, { organization, member: self.id, date: '2042-09-12', team });
        await actAsOwner(client);

        expect(refused.code, slug).toBe('42501');
        expect(
          afterUnrelated.map((row) => ({ id: row.id, live: row.live })),
          `${slug}: removing an override no decision wrote ended a resolution`,
        ).toEqual([
          { id: replaced, live: true },
          { id: accepted, live: true },
        ]);
        const { rows } = await client.query<{ id: string; removedBy: string | null; same: boolean }>(
          `select c.id::text as id, c.removed_by::text as "removedBy", c.removed_at = o.removed_at as same
             from conflict_resolutions c join roster_overrides o on o.id = c.roster_override_id
            where c.id = $1`,
          [replaced],
        );
        expect(rows, `${slug}: the replacement did not end with its override, attributed to the remover`).toEqual([
          { id: replaced, removedBy: owner.authUserId, same: true },
        ]);
        expect(
          (await resolutionRowsOf(client, self.id)).map((row) => ({ id: row.id, date: row.date, live: row.live })),
          `${slug}: the accepted conflict was touched, or the key was not freed`,
        ).toEqual([
          { id: replaced, date: '2042-09-12', live: false },
          { id: again, date: '2042-09-12', live: true },
          { id: accepted, date: '2042-09-13', live: true },
        ]);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'backfills a $fixture replacement whose override was removed before 0033, copying the removal, and nothing else',
    async ({ slug, admin, member, bystander }) => {
      // 0033's backfill, executed as written against rows 0032's gap left behind.
      const migration = readFileSync(
        join(repoRoot, 'supabase', 'migrations', '0033_replacement_resolution_lifetime.sql'),
        'utf8',
      ).replaceAll(/--[^\n]*/g, '');
      const backfill = /update public\.conflict_resolutions c\s+set removed_by = o\.removed_by,[\s\S]*?;/.exec(migration)?.[0];
      expect(backfill, '0033 has no backfill').toBeDefined();

      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const replacement = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const [team] = await twoLiveTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        const orphaned = await replaceConflictMember(client, { member: self.id, date: '2042-09-12', team, replacement: replacement.id });
        const standing = await replaceConflictMember(client, { member: self.id, date: '2042-09-13', team, replacement: replacement.id });
        const accepted = await insertResolution(client, { organization, member: self.id, date: '2042-09-14', team });
        await actAsOwner(client);
        // As 0027 removed it before 0033: the override alone, removed an hour ago by the bystander.
        await client.query(
          `update roster_overrides set removed_by = $2, removed_at = now() - interval '1 hour'
            where team_id = $1 and date = '2042-09-12'`,
          [team, replacement.authUserId],
        );
        await client.query(backfill ?? '');

        const { rows } = await client.query<{ id: string; live: boolean; removedBy: string | null; same: boolean | null }>(
          `select c.id::text as id, c.removed_at is null as live, c.removed_by::text as "removedBy",
                  c.removed_at = o.removed_at as same
             from conflict_resolutions c left join roster_overrides o on o.id = c.roster_override_id
            where c.member_id = $1 order by c.date`,
          [self.id],
        );
        expect(rows, `${slug}: the backfill did not end exactly the orphaned replacement, as its override's removal`).toEqual([
          { id: orphaned, live: false, removedBy: replacement.authUserId, same: true },
          { id: standing, live: true, removedBy: null, same: null },
          { id: accepted, live: true, removedBy: null, same: null },
        ]);
      });
    },
  );

  it.skipIf(noDatabase)('leaves no live replacement linked to a removed override anywhere once 0033 has run', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ count: number }>(
        `select count(*)::int as count
           from conflict_resolutions c join roster_overrides o
             on o.organization_id = c.organization_id and o.id = c.roster_override_id
          where c.removed_at is null and o.removed_at is not null`,
      );
      expect(rows[0]?.count).toBe(0);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    'gives the $fixture member the override their own replacement names, and none for an accepted one',
    async ({ slug, admin, member, bystander }) => {
      await inRolledBackTransaction(async (client) => {
        const owner = await memberByUsername(client, slug, admin);
        const self = await memberByUsername(client, slug, member);
        const replacement = await memberByUsername(client, slug, bystander);
        const organization = owner.organizationId;
        const [team] = await twoLiveTeamsOf(client, organization);

        await actAs(client, owner.authUserId, organization);
        await leaveOver(client, organization, [self.id]);
        await replaceConflictMember(client, { member: self.id, date: '2042-09-12', team, replacement: replacement.id });
        await insertResolution(client, { organization, member: self.id, date: '2042-09-13', team });
        const [linked] = await rosterOverrideRowsOf(client, team);
        await actAs(client, self.authUserId, organization);
        const { rows } = await client.query<{ date: string; kind: string; link: string | null }>(
          `select date::text as date, kind, roster_override_id::text as link from public.my_conflict_resolutions()`,
        );
        await actAsOwner(client);

        expect(rows, slug).toEqual([
          { date: '2042-09-12', kind: 'replace_member', link: linked?.id },
          { date: '2042-09-13', kind: 'accept_uncovered', link: null },
        ]);
      });
    },
  );
});
