import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

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

/** Every case that leaves the database and speaks HTTP is gated on both. */
const noApi = noDatabase || apiEndpoint === undefined;

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
}

/** One real PostgREST request — the same transport the SPA uses. */
async function rest(path: string, call: RestCall = {}): Promise<Response> {
  const endpoint = apiEndpoint;
  if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

  const headers: Record<string, string> = { apikey: endpoint.key };
  if (call.token !== undefined) headers['Authorization'] = `Bearer ${call.token}`;
  if (call.body !== undefined) headers['content-type'] = 'application/json';

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
    `insert into members (organization_id, auth_user_id, name, role, leave_allowance_days)
     values ($1, $2, $3, 'member_role', 20)
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
      // EXPECTED TO CHANGE IN STORY 1.4, in the same spirit as the two
      // assertions 1.2 labelled for this story: 0003:243-245 hands 1.4 the
      // settings surface and tells it to build the `organizations` write policy
      // by copying the select one, so a sixth name belongs here then. Extend
      // the list — never relax it to a `toContain` or a count, which is the
      // shape that let the delete policy be deletable in the first place.
      // The same list is mirrored over migration source text in
      // `test/supabase-scaffold.test.ts`, which runs with no database.
      const { rows: policies } = await client.query<{ policyname: string }>(
        `select policyname from pg_policies where schemaname = 'public' order by policyname`,
      );
      expect(
        policies.map((row) => row.policyname),
        'story 1.3a owns exactly these five policies; a missing one refuses silently and looks like a working refusal',
      ).toEqual([
        'members_delete_by_own_active_admin',
        'members_insert_by_own_active_admin',
        'members_select_own_organization',
        'members_update_by_own_active_admin',
        'organizations_select_own_organization',
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
            `insert into members (organization_id, auth_user_id, name, role, leave_allowance_days)
             values ($1, gen_random_uuid(), $2, 'admin', 0)`,
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
          `insert into members (organization_id, auth_user_id, name, role, leave_allowance_days)
           values ($1, $2, $3, 'member_role', 20)`,
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

describe('organizations is readable and not writable, and the refusal is asserted rather than assumed', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses an injected $fixture admin every write to their own organization row',
    async ({ slug, admin }) => {
      // `organizations` carries a SELECT policy and nothing else, so INSERT,
      // UPDATE and DELETE are refused by *no policy matching* — the silent
      // failure mode this file goes out of its way to distinguish everywhere
      // else, and the one shape nothing asserted. It matters forward rather
      // than today: 0003:243-245 hands story 1.4 the settings surface and tells
      // it to build the write policy by copying the select one, so 1.4 could
      // add a write path that reaches every tenant and no existing case would
      // notice. This is the assertion 1.4 has to consciously edit.
      await inRolledBackTransaction(async (client) => {
        const caller = await memberByUsername(client, slug, admin);

        await actAs(client, caller.authUserId, caller.organizationId);
        const update = await client.query('update organizations set name = $1 where id = $2', [
          `${THROWAWAY} renamed`,
          caller.organizationId,
        ]);
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

        expect(update.rowCount, `a ${slug} admin renamed their own organization`).toBe(0);
        expect(remove.rowCount, `a ${slug} admin deleted their own organization`).toBe(0);
        expect(insertRefusal.code, 'an insert with no matching policy is 42501').toBe('42501');
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
          `insert into members (organization_id, auth_user_id, name, role, leave_allowance_days)
           values ($1, $2, $3, 'member_role', 20)`,
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
            `insert into members (organization_id, auth_user_id, name, role, leave_allowance_days)
             values ($1, $2, $3, 'member_role', 20)`,
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
            `insert into members (organization_id, auth_user_id, name, role, leave_allowance_days)
             values ($1, gen_random_uuid(), $2, 'member_role', 20)`,
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
