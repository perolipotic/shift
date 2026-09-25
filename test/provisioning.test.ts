import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Story 1.2's refusals, executed rather than read.
 *
 * Everything below drives the real local Postgres, because every rule this
 * story owns is a database rule: Q6's zero-admins refusal is a deferred
 * constraint trigger, Q3's organization reference is a `not null`, and
 * deny-all is row level security with no policy. Reading the migration text
 * proves that the words are present; only the database proves what they do.
 * `test/supabase-scaffold.test.ts` keeps the source-text half.
 *
 * A database-less checkout reports every case here as SKIPPED, never as green
 * having asserted nothing — the same rule `test/static-hosting.test.ts` follows
 * for a build-less checkout, and the reason `it.skipIf` is used instead of an
 * early `return`. The consequence is that this file is not load-bearing until
 * something runs it with a database attached; that is on the deferred ledger.
 *
 * Nothing here leaves the database dirty. Every mutation runs inside a
 * transaction that is rolled back, and the deferred trigger is still exercised
 * because `set constraints all immediate` forces a deferred check at a chosen
 * point rather than at commit — which is also what proves the trigger is
 * deferred at all: an immediate trigger would have raised on the statement
 * before it.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * The Supabase CLI's fixed local default. Read from the environment when set,
 * so no credential for any other database is written down here.
 */
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

/**
 * The local auth endpoint and the key needed to reach it, or `undefined`.
 *
 * Read at run time and never written down: the publishable key is generated
 * per stack, so hard-coding one would both rot and put a key in a tracked
 * file. `supabase status -o json` is the only source, and it is spawned once,
 * here, rather than inside a test. When it cannot be obtained — no CLI, stack
 * not running, JSON shape changed — the one case that needs it skips rather
 * than failing for a reason that is not about this story.
 */
const authEndpoint: { readonly url: string; readonly key: string } | undefined = (() => {
  if (noDatabase) return undefined;
  try {
    const status = execFileSync(join(repoRoot, 'node_modules', '.bin', 'supabase'), [
      'status',
      '-o',
      'json',
    ], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
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

/** The two fixtures every rule is asserted against (AD-15). */
const FIXTURES = [
  { fixture: 'pilot', slug: 'dvd-kastel-novi' },
  { fixture: 'UJ-5', slug: 'zastita-split' },
] as const;

/**
 * GoTrue's password hashing cost. `gen_salt('bf')` alone is cost 6; GoTrue
 * itself uses 10, and an operator-provisioned first admin must not be weaker
 * than every member the application later creates.
 */
const BCRYPT_PREFIX = '$2a$10$';

/** Slug prefix for organizations this file creates outside a transaction. */
const THROWAWAY_SLUG = 'provisioning-test';

const provisioningScript = readFileSync(
  join(repoRoot, 'supabase', 'operator', 'provision-organization.sql'),
  'utf8',
);

/**
 * Migration `0007`, read as TEXT so its backfill can be EXECUTED over a row.
 *
 * `supabase db reset` applies migrations BEFORE `seed.sql`, so `members` is
 * empty at the moment `0007` runs and every character of its update statement
 * is unverified by construction: changing `split_part(u.email, '@', 1)` to
 * `, 2)` writes the DOMAIN as everybody's username, and the whole suite stays
 * green because nothing ever ran the statement over a row. Reading it from the
 * file and applying it to a member whose username has been nulled is what makes
 * that a failing case — the same idiom `provisioningScript` above established.
 */
const usernameMigration = readFileSync(
  join(repoRoot, 'supabase', 'migrations', '0007_member_username.sql'),
  'utf8',
);

/** The one `update` statement `0007` carries, extracted from the file. */
function backfillStatement(): string {
  return /update members m[\s\S]*?;/.exec(usernameMigration)?.[0] ?? '';
}

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
  readonly detail: string | undefined;
}

/**
 * Assert that `work` is refused, and hand back what the database raised.
 *
 * A refusal case that only asserts "it threw" passes when the schema breaks in
 * a different way — a typo in a column name throws too.
 */
async function refused(work: () => Promise<unknown>): Promise<Refusal> {
  try {
    await work();
  } catch (cause) {
    const error = cause as { code?: string; message?: string; detail?: string };
    return {
      code: error.code ?? '',
      message: error.message ?? '',
      detail: error.detail,
    };
  }
  throw new Error('nothing was refused: the statement was permitted');
}

interface RecipeHealth {
  /** Members of the organization that have an `auth.users` row. */
  readonly accounts: number;
  /** Accounts with a null in any of GoTrue's four scanned token columns. */
  readonly nullTokens: number;
  /** Matching `auth.identities` rows — one per account, or a grant cannot resolve. */
  readonly identities: number;
  /** Identities whose `sub` or `email` disagrees with the user they belong to. */
  readonly brokenIdentityData: number;
  /** Passwords not hashed at GoTrue's own bcrypt cost. */
  readonly weakHashes: number;
}

/**
 * Everything about one organization's accounts that GoTrue silently depends on.
 *
 * The same aggregate covers the seed's copy of the recipe and the operator
 * script's copy, because they are the same recipe written twice — the script
 * has to be a single prepared statement and cannot be included from the seed,
 * so the only thing keeping them in step is that both are asserted.
 */
async function recipeHealth(client: Client, slug: string): Promise<RecipeHealth> {
  const { rows } = await client.query<RecipeHealth>(
    `select count(u.*)::int as "accounts",
            count(u.*) filter (
              where u.confirmation_token is null
                 or u.recovery_token is null
                 or u.email_change is null
                 or u.email_change_token_new is null
            )::int as "nullTokens",
            count(i.*)::int as "identities",
            count(i.*) filter (
              where i.identity_data ->> 'sub' is distinct from u.id::text
                 or i.identity_data ->> 'email' is distinct from u.email
            )::int as "brokenIdentityData",
            count(u.*) filter (where u.encrypted_password not like $2)::int as "weakHashes"
       from organizations o
       join members m on m.organization_id = o.id
       join auth.users u on u.id = m.auth_user_id
       left join auth.identities i on i.user_id = u.id
      where o.slug = $1`,
    [slug, `${BCRYPT_PREFIX}%`],
  );
  const health = rows[0];
  if (health === undefined) throw new Error(`no aggregate returned for ${slug}`);
  return health;
}

/** Assert every GoTrue coupling holds for one organization's accounts. */
function expectSignInCapable(health: RecipeHealth, where: string): void {
  expect(health.accounts, `${where} has no accounts at all`).toBeGreaterThan(0);
  // GoTrue scans these four nullable columns into non-nullable Go strings. A
  // null in any of them makes every sign-in fail with a 500 that names none of
  // them, which no assertion about row counts would ever find.
  expect(
    health.nullTokens,
    `${where}: confirmation_token, recovery_token, email_change and email_change_token_new must each be an empty string`,
  ).toBe(0);
  // A password grant resolves the account through auth.identities, not through
  // auth.users.email, so one identity per account is not optional.
  expect(health.identities, `${where}: one auth.identities row per account`).toBe(health.accounts);
  expect(
    health.brokenIdentityData,
    `${where}: identity_data must carry the user's own sub and email`,
  ).toBe(0);
  expect(
    health.weakHashes,
    `${where}: passwords must be hashed at bcrypt cost 10 (gen_salt('bf', 10)), the cost GoTrue itself uses`,
  ).toBe(0);
}

interface FunctionSecurity {
  /** SECURITY DEFINER — the function runs as its owner, not as the caller. */
  readonly prosecdef: boolean;
  /** `pg_proc.proconfig`, where a pinned `search_path` shows up. */
  readonly proconfig: string[] | null;
  /** ACL entries granted to PUBLIC, which is the one grantee nobody may be. */
  readonly publicGrants: number;
  /** Every role holding an EXECUTE grant, comma-separated and sorted. */
  readonly grantees: string;
  /** The role that owns the function, which always holds EXECUTE implicitly. */
  readonly owner: string;
}

/**
 * The three security attributes every SECURITY DEFINER function here carries,
 * plus the grantee list.
 *
 * One query for all of them, because they are one decision: a function that
 * runs as the owner, resolves no name through a caller-controlled path, and is
 * not reachable by whoever happens to be asking. Asserting them separately is
 * how a function acquires two of the three.
 */
async function functionSecurity(
  client: Client,
  name: string,
  argumentCount: number,
): Promise<FunctionSecurity> {
  const { rows } = await client.query<FunctionSecurity & { hasAcl: boolean }>(
    `select p.prosecdef,
            p.proconfig,
            p.proacl is not null as "hasAcl",
            (select count(*)::int
               from unnest(coalesce(p.proacl, '{}'::aclitem[])) as entry
              where entry::text like '=%') as "publicGrants",
            (select coalesce(
                      string_agg(distinct split_part(entry::text, '=', 1), ',' order by split_part(entry::text, '=', 1)),
                      '')
               from unnest(coalesce(p.proacl, '{}'::aclitem[])) as entry) as grantees,
            pg_get_userbyid(p.proowner) as owner
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = $1
        and p.pronargs = $2`,
    [name, argumentCount],
  );

  // Exactly one, and qualified by argument count. `proname` alone matches every
  // overload, and reading `rows[0]` from an unordered result would let a second
  // definition decide which one the search_path and ACL assertions inspect —
  // silently, and in whichever direction the planner happened to return first.
  expect(
    rows.length,
    `expected exactly one public.${name} taking ${argumentCount} argument(s); found ${rows.length}`,
  ).toBe(1);
  const security = rows[0];
  if (security === undefined) throw new Error(`unreachable: public.${name} was asserted to exist`);

  // A null `proacl` means no grant or revoke was ever written, so the defaults
  // are in force — and it yields zero PUBLIC entries, which makes the check
  // below pass on precisely the function that has no access control at all.
  expect(
    security.hasAcl,
    `public.${name} has no ACL entries at all, so its default privileges are whatever the platform grants; write the revokes`,
  ).toBe(true);

  return security;
}

/** Assert one function runs as its owner and hands that power to nobody. */
function expectRunsAsOwner(security: FunctionSecurity, name: string): void {
  expect(security.prosecdef, `${name} must be SECURITY DEFINER`).toBe(true);

  // pg_proc stores it as `search_path=""` — the setting name, then the quoted
  // value. Both halves matter: present, and empty.
  const searchPath = (security.proconfig ?? []).find((entry) => entry.startsWith('search_path='));
  expect(searchPath, `${name} must pin a search_path`).toBeDefined();
  expect(
    (searchPath ?? '').slice('search_path='.length).replaceAll(/["']/g, ''),
    `${name}: the pinned search_path must be empty (set search_path = ''), so no name resolves through a caller-controlled path`,
  ).toBe('');
  expect(
    security.publicGrants,
    `${name} reads past RLS as its owner and must not be executable by PUBLIC`,
  ).toBe(0);
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
 * A second admin for `organization`, so that "the last admin" has a successor.
 *
 * The auth.users row carries only what the foreign key needs. It is rolled back
 * and never authenticates, so the full GoTrue recipe — the four empty token
 * columns above all — is not reproduced here; it lives in the operator script
 * and in seed.sql, where sign-in actually has to work.
 */
async function addAdmin(client: Client, organization: string, label: string): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`${label}@${THROWAWAY_SLUG}.shift.invalid`],
  );
  const created = rows[0];
  if (created === undefined) throw new Error('auth.users insert returned no row');
  // `username` since `0007`, and it is the LABEL rather than a constant: the
  // column carries a case-insensitive unique index per organization, so two
  // successors added to one tenant with the same username would be refused for
  // a reason that has nothing to do with the zero-admins rule these cases are
  // about.
  await client.query(
    `insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
     values ($1, $2, $3, $4, 'admin', 0)`,
    [organization, created.id, label, label],
  );
}

afterAll(async () => {
  if (noDatabase) return;
  const client = await connect();
  try {
    await client.query('delete from organizations where slug like $1', [`${THROWAWAY_SLUG}-%`]);
    // Members cascade from the organization, but their auth.users rows do not
    // — the cascade runs the other way. Every address this file ever issues
    // carries the throwaway slug in its domain, so this reaches all of them.
    await client.query('delete from auth.users where email like $1', [`%@${THROWAWAY_SLUG}%`]);
  } finally {
    await client.end();
  }
});

describe('the schema declares what it depends on', () => {
  it.skipIf(noDatabase)('installs pgcrypto in the extensions schema', async () => {
    // Both seed.sql and the operator script call `extensions.crypt`. The
    // Supabase image preinstalls pgcrypto, so this passes today whether or not
    // a migration declares it — which is why `test/supabase-scaffold.test.ts`
    // additionally asserts the `create extension` line exists. This half
    // asserts the outcome: the schema-qualified calls resolve.
    const client = await connect();
    try {
      const { rows } = await client.query<{ schema: string }>(
        `select n.nspname as schema
           from pg_extension e
           join pg_namespace n on n.oid = e.extnamespace
          where e.extname = 'pgcrypto'`,
      );

      expect(rows.length, 'pgcrypto is not installed').toBe(1);
      expect(rows[0]?.schema, 'pgcrypto must live in `extensions`, not `public`').toBe('extensions');
    } finally {
      await client.end();
    }
  });
});

describe('the seed carries both fixtures, so no rule is asserted against one tenant', () => {
  it.skipIf(noDatabase)('finds an organization and at least one admin for each', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ slug: string; admins: number; members: number }>(
        `select o.slug,
                count(m.*) filter (where m.role = 'admin')::int as admins,
                count(m.*)::int as members
           from organizations o
           left join members m on m.organization_id = o.id
          group by o.slug
          order by o.slug`,
      );

      // The vacuous-pass guard. Every case below looks a fixture up by slug, so
      // a seed that silently loaded nothing would skip past all of them.
      //
      // A superset check, not an equality one: an operator who follows
      // DEPLOY.md §7 against their own local stack leaves a real organization
      // in this database, and a test that turned red for that would be telling
      // them the runbook is wrong.
      const present = rows.map((row) => row.slug);
      expect(
        FIXTURES.map(({ slug }) => slug).filter((slug) => !present.includes(slug)),
        'seed.sql loaded no fixture; every assertion below would have nothing to assert against',
      ).toEqual([]);

      for (const { slug } of FIXTURES) {
        const row = rows.find((candidate) => candidate.slug === slug);
        expect(row?.admins, `${slug} has no admin`).toBeGreaterThan(0);
        expect(row?.members, `${slug} has no members`).toBeGreaterThan(0);
      }
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    'leaves every $fixture account able to sign in',
    async ({ slug, fixture }) => {
      // The seed carries its own copy of the GoTrue recipe — the four empty
      // token columns, the identity row, the bcrypt cost — because the operator
      // script cannot be included from it. Asserting only the script's copy
      // left this one free to rot: deleting the seed's `auth.identities` insert
      // used to leave the whole suite green while both fixture admins silently
      // lost the ability to sign in.
      const client = await connect();
      try {
        expectSignInCapable(await recipeHealth(client, slug), `the ${fixture} fixture`);
      } finally {
        await client.end();
      }
    },
  );
});

describe('an organization can never be left with zero admins', () => {
  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses the deletion of the last admin of the $fixture organization',
    async ({ slug }) => {
      await inRolledBackTransaction(async (client) => {
        const organization = await organizationId(client, slug);

        // The statement itself succeeds. That is the deferral: only the state
        // at check time is a fact about the organization.
        await client.query(`delete from members where organization_id = $1 and role = 'admin'`, [
          organization,
        ]);

        const refusal = await refused(() => client.query('set constraints all immediate'));

        expect(refusal.message).toBe('ORGANIZATION_WOULD_HAVE_NO_ADMIN');
        expect(refusal.code, 'a refusal must not reach PostgREST as a 500').toBe('23514');
        expect(refusal.detail, 'the operand is the organization that would be left empty').toBe(
          organization,
        );
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'refuses downgrading the last admin of the $fixture organization',
    async ({ slug }) => {
      await inRolledBackTransaction(async (client) => {
        const organization = await organizationId(client, slug);

        await client.query(
          `update members set role = 'member_role' where organization_id = $1 and role = 'admin'`,
          [organization],
        );

        const refusal = await refused(() => client.query('set constraints all immediate'));

        expect(refusal.message).toBe('ORGANIZATION_WOULD_HAVE_NO_ADMIN');
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'permits swapping the $fixture organization admin inside one transaction',
    async ({ slug }) => {
      await inRolledBackTransaction(async (client) => {
        const organization = await organizationId(client, slug);

        // Insert the replacement, demote the incumbent. An immediate trigger
        // would refuse this depending on statement order; a deferred one asks
        // only what is true at the end.
        await addAdmin(client, organization, 'successor');
        await client.query(
          `update members
              set role = 'member_role'
            where organization_id = $1 and role = 'admin' and name <> 'successor'`,
          [organization],
        );

        await client.query('set constraints all immediate');

        const { rows } = await client.query<{ admins: number }>(
          `select count(*)::int as admins from members where organization_id = $1 and role = 'admin'`,
          [organization],
        );
        expect(rows[0]?.admins).toBe(1);
      });
    },
  );

  it.skipIf(noDatabase).each(FIXTURES)(
    'permits deleting an admin of the $fixture organization who is not the last',
    async ({ slug }) => {
      await inRolledBackTransaction(async (client) => {
        const organization = await organizationId(client, slug);

        await addAdmin(client, organization, 'second-admin');
        await client.query(
          `delete from members where organization_id = $1 and role = 'admin' and name = 'second-admin'`,
          [organization],
        );

        await client.query('set constraints all immediate');

        const { rows } = await client.query<{ admins: number }>(
          `select count(*)::int as admins from members where organization_id = $1 and role = 'admin'`,
          [organization],
        );
        expect(rows[0]?.admins).toBe(1);
      });
    },
  );

  it.skipIf(noDatabase)('permits deleting an organization, admin and all', async () => {
    // The trigger's first branch returns early when the organization itself is
    // gone: members cascade from organizations, so at check time a deleted
    // tenant has no admin and never will. Without that branch every tenant is
    // permanently undeletable — and nothing else here would notice, because
    // every other case keeps its organization.
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into organizations (
           slug, name, organization_type, timezone, locale,
           leave_year_start_month, leave_year_start_day
         ) values ($1, 'Doomed', 'Some Type', 'UTC', 'en', 1, 1)
         returning id`,
        [`${THROWAWAY_SLUG}-doomed`],
      );
      const doomed = rows[0];
      if (doomed === undefined) throw new Error('organizations insert returned no row');

      await addAdmin(client, doomed.id, 'sole-admin');
      await client.query('delete from organizations where id = $1', [doomed.id]);

      // Must not raise. The deleted admin's row queued a deferred check.
      await client.query('set constraints all immediate');

      const { rows: left } = await client.query<{ surviving: number }>(
        'select count(*)::int as surviving from organizations where id = $1',
        [doomed.id],
      );
      expect(left[0]?.surviving, 'the organization outlived its own deletion').toBe(0);
    });
  });

  it.skipIf(noDatabase)('runs its check as the owner, past row level security', async () => {
    // Invisible to every other case in this file, because they all connect as
    // `postgres`, which is BYPASSRLS. A SECURITY INVOKER function would read
    // `members` as the caller, see zero rows under deny-all, and conclude that
    // every organization has no admin — so the first legal member delete story
    // 1.3 allows would be refused. The empty search_path is the other half:
    // a SECURITY DEFINER function that resolves names through a
    // caller-controlled path is the classic way to hand the owner's rights to
    // whoever can create a schema.
    const client = await connect();
    try {
      expectRunsAsOwner(
        await functionSecurity(client, 'refuse_organization_with_no_admin', 0),
        'refuse_organization_with_no_admin',
      );
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('is the only constraint trigger in the schema', async () => {
    const client = await connect();
    try {
      // NOT TO BE DELETED IN STORY 1.3, unlike its neighbours below. AD-3
      // permits exactly one constraint trigger for the life of this schema, so
      // this count stays 1 after 1.3, after 1.6's versioned status and after
      // 1.7's team moves. 1.3 is named here because it is the first story that
      // will be tempted: a cross-row rule that RLS cannot express looks like a
      // trigger, and AD-3 says it is a signal to revisit AD-9 instead.
      //
      // Foreign keys are implemented as triggers too, and they carry a
      // constraint oid. `tgisinternal` is what separates the ones a developer
      // wrote from the ones a reference generated — counting without it
      // reports every FK and can never equal one.
      const { rows } = await client.query<{ triggers: number; names: string }>(
        `select count(*)::int as triggers,
                coalesce(string_agg(c.conname, ', ' order by c.conname), '') as names
           from pg_constraint c
          where c.contype = 't'
            and c.connamespace = 'public'::regnamespace`,
      );

      expect(
        rows[0]?.triggers,
        `AD-3 permits exactly one constraint trigger; found: ${rows[0]?.names ?? ''}`,
      ).toBe(1);
    } finally {
      await client.end();
    }
  });
});

describe('every organization-scoped row carries its organization', () => {
  it.skipIf(noDatabase)('puts organization_id first on members, not null and a key', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable
           from information_schema.columns
          where table_schema = 'public' and table_name = 'members'
          order by ordinal_position
          limit 1`,
      );

      expect(rows[0]?.column_name, 'Q3: organization_id is the first column').toBe(
        'organization_id',
      );
      expect(rows[0]?.is_nullable, 'Q3 is a not null, not a convention').toBe('NO');

      const { rows: keys } = await client.query<{ referenced: string }>(
        `select confrelid::regclass::text as referenced
           from pg_constraint
          where contype = 'f'
            and conrelid = 'public.members'::regclass
            and conkey = array[
              (select attnum from pg_attribute
                where attrelid = 'public.members'::regclass and attname = 'organization_id')
            ]::smallint[]`,
      );
      expect(keys.map((key) => key.referenced)).toEqual(['organizations']);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('refuses a member with no organization', async () => {
    await inRolledBackTransaction(async (client) => {
      const refusal = await refused(() =>
        client.query(
          // EVERY OTHER NOT-NULL COLUMN IS SUPPLIED, and `username` is the
          // reason that now matters: `0007` made it not null too, so an insert
          // omitting both columns raises 23502 for WHICHEVER Postgres reaches
          // first — and this case would have gone on passing with
          // `organization_id` made nullable. The column is pinned below so the
          // case demonstrates its own name.
          `insert into members (auth_user_id, name, username, role, leave_allowance_days)
           values (gen_random_uuid(), 'orphan', 'orphan', 'member_role', 0)`,
        ),
      );

      expect(refusal.code, 'a not null violation is 23502').toBe('23502');
      expect(
        `${refusal.message} ${refusal.detail ?? ''}`,
        'some other not-null column raised, so this case no longer demonstrates organization_id',
      ).toContain('organization_id');
    });
  });

  it.skipIf(noDatabase)('carries neither active status nor a team, which AD-2 versions', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'members'`,
      );
      const columns = rows.map((row) => row.column_name);

      expect(columns.length, 'members has no columns at all').toBeGreaterThan(0);
      expect(
        columns.filter((column) => ['is_active', 'active', 'team_id'].includes(column)),
        'AD-2 classifies active status and team membership as versioned; they are 1.6s and 1.7s tables',
      ).toEqual([]);
    } finally {
      await client.end();
    }
  });
});

describe('the organization slug is a legal DNS label', () => {
  // It becomes the domain part of every account's sign-in address (AD-12), so
  // anything a hostname cannot carry has to be unrepresentable rather than
  // discovered at the first failed grant.
  async function insertSlug(client: Client, slug: string): Promise<unknown> {
    return client.query(
      `insert into organizations (
         slug, name, organization_type, timezone, locale,
         leave_year_start_month, leave_year_start_day
       ) values ($1, 'Slug Probe', 'Some Type', 'UTC', 'en', 1, 1)`,
      [slug],
    );
  }

  const rejected = [
    { what: 'longer than the 63-character DNS label limit', slug: 'a'.repeat(64) },
    { what: 'containing an uppercase letter', slug: 'Uppercase' },
    { what: 'containing an underscore', slug: 'under_score' },
    { what: 'with a leading hyphen', slug: '-leading' },
    { what: 'empty', slug: '' },
  ];

  it.skipIf(noDatabase).each(rejected)('refuses a slug $what', async ({ slug }) => {
    await inRolledBackTransaction(async (client) => {
      const refusal = await refused(() => insertSlug(client, slug));
      expect(refusal.code, 'a check violation is 23514').toBe('23514');
    });
  });

  it.skipIf(noDatabase)('accepts a slug of exactly 63 characters', async () => {
    // The boundary from the other side: a limit that refused 63 as well would
    // pass every case above while being wrong.
    await inRolledBackTransaction(async (client) => {
      await insertSlug(client, 'a'.repeat(63));
    });
  });
});

describe('every organization table carries row level security, and only its reviewed privileges open it', () => {
  it.skipIf(noDatabase)('has row level security on', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ relname: string; relrowsecurity: boolean }>(
        `select relname, relrowsecurity
           from pg_class
          where relnamespace = 'public'::regnamespace
            and relname in (
              'organizations', 'members', 'member_status_versions', 'teams',
              'team_membership_versions', 'hour_bands', 'shift_types',
              'shift_type_versions'
            )
          order by relname`,
      );

      // STORY 1.6 adds the versioned active status, which is organization data
      // like the other two and is born with row level security on. STORY 1.7a
      // adds the teams, born the same way, and STORY 1.7b the versioned team
      // membership. STORY 2.1a adds the hour bands, and STORY 2.2a the shift
      // types and their versioned times.
      expect(rows.map((row) => row.relname)).toEqual([
        'hour_bands',
        'member_status_versions',
        'members',
        'organizations',
        'shift_type_versions',
        'shift_types',
        'team_membership_versions',
        'teams',
      ]);
      for (const row of rows) {
        expect(row.relrowsecurity, `${row.relname} must have RLS enabled`).toBe(true);
      }
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('holds no privilege on member_status_versions that no policy needs', async () => {
    // STORY 1.6. Supabase's default privileges grant every table privilege to
    // both request roles; `0008` revokes what nothing uses, so a policy added
    // later cannot open a verb by accident. `authenticated` keeps SELECT and
    // DELETE (each narrowed by a policy) and a column-level INSERT; `anon`
    // keeps nothing.
    const client = await connect();
    try {
      const { rows } = await client.query<{ role: string; privilege: string; held: boolean }>(
        `select role, privilege,
                has_table_privilege(role, 'public.member_status_versions', privilege) as held
           from unnest(array['anon', 'authenticated']) as role,
                unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
                  as privilege`,
      );
      const held = rows.filter((row) => row.held).map((row) => `${row.role}:${row.privilege}`);

      expect(held.sort()).toEqual(['authenticated:DELETE', 'authenticated:SELECT']);

      const { rows: columns } = await client.query<{ held: boolean }>(
        `select has_column_privilege('authenticated', 'public.member_status_versions', 'effective_from', 'INSERT') as held`,
      );
      expect(columns[0]?.held, 'the four fact columns lost their INSERT grant').toBe(true);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('holds no privilege on teams that no policy needs, and no delete at all', async () => {
    // STORY 1.7a. "Remove" archives, so DELETE is revoked outright rather than
    // left to match no policy: the privilege is the second lock on the one verb
    // that destroys. `authenticated` keeps SELECT and column-level INSERT and
    // UPDATE; `anon` keeps nothing.
    const client = await connect();
    try {
      const { rows } = await client.query<{ role: string; privilege: string; held: boolean }>(
        `select role, privilege,
                has_table_privilege(role, 'public.teams', privilege) as held
           from unnest(array['anon', 'authenticated']) as role,
                unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
                  as privilege`,
      );
      const held = rows.filter((row) => row.held).map((row) => `${row.role}:${row.privilege}`);

      expect(held.sort()).toEqual(['authenticated:SELECT']);

      const { rows: columns } = await client.query<{ column: string; verb: string; held: boolean }>(
        `select column_name as column, verb,
                has_column_privilege('authenticated', 'public.teams', column_name, verb) as held
           from unnest(array['organization_id', 'id', 'name', 'archived', 'created_by', 'created_at'])
                  as column_name,
                unnest(array['INSERT', 'UPDATE']) as verb`,
      );
      expect(
        columns
          .filter((row) => row.held)
          .map((row) => `${row.verb}:${row.column}`)
          .sort(),
        'the writable team columns changed',
      ).toEqual(['INSERT:name', 'INSERT:organization_id', 'UPDATE:archived', 'UPDATE:name']);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('holds no privilege on hour_bands that no policy needs', async () => {
    // STORY 2.1a. Any band may be deleted, so `authenticated` keeps SELECT and
    // DELETE (each narrowed by a policy) and column-level INSERT and UPDATE on
    // the name and start alone; `anon` keeps nothing.
    const client = await connect();
    try {
      const { rows } = await client.query<{ role: string; privilege: string; held: boolean }>(
        `select role, privilege,
                has_table_privilege(role, 'public.hour_bands', privilege) as held
           from unnest(array['anon', 'authenticated']) as role,
                unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
                  as privilege`,
      );
      const held = rows.filter((row) => row.held).map((row) => `${row.role}:${row.privilege}`);

      expect(held.sort()).toEqual(['authenticated:DELETE', 'authenticated:SELECT']);

      const { rows: columns } = await client.query<{
        role: string;
        column: string;
        verb: string;
        held: boolean;
      }>(
        `select role, column_name as column, verb,
                has_column_privilege(role, 'public.hour_bands', column_name, verb) as held
           from unnest(array['anon', 'authenticated']) as role,
                unnest(array['organization_id', 'id', 'name', 'start_time', 'created_at'])
                  as column_name,
                unnest(array['SELECT', 'INSERT', 'UPDATE']) as verb`,
      );
      expect(
        columns
          .filter((row) => row.held)
          .map((row) => `${row.role}:${row.verb}:${row.column}`)
          .filter((entry) => !entry.startsWith('authenticated:SELECT:'))
          .sort(),
        'the writable hour band columns changed, or anon holds one',
      ).toEqual([
        'authenticated:INSERT:name',
        'authenticated:INSERT:organization_id',
        'authenticated:INSERT:start_time',
        'authenticated:UPDATE:name',
        'authenticated:UPDATE:start_time',
      ]);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('indexes hour_bands by its tenant, one start and one name per organization', async () => {
    // Q3, and the two uniques that are the whole of "a gap cannot be
    // expressed" and "a name means one band".
    const client = await connect();
    try {
      const { rows } = await client.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'hour_bands'`,
      );
      expect(
        rows.some((row) => /\(organization_id\)$/.test(row.indexdef)),
        'no index leads with organization_id alone',
      ).toBe(true);
      expect(
        rows.some((row) => /UNIQUE INDEX .* \(organization_id, start_time\)$/.test(row.indexdef)),
        'two bands may share a start',
      ).toBe(true);
      expect(
        rows.some((row) =>
          /UNIQUE INDEX .* \(organization_id, lower\(btrim\(name\)\)\)$/.test(row.indexdef),
        ),
        'two bands may share a name, or the unique is partial',
      ).toBe(true);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('holds no privilege on shift_types that no policy needs, and no delete at all', async () => {
    // STORY 2.2a, the teams matrix plus the working flag: removal archives, so
    // DELETE is revoked outright; `is_working` is insertable and never
    // updatable; `anon` keeps nothing.
    const client = await connect();
    try {
      const { rows } = await client.query<{ role: string; privilege: string; held: boolean }>(
        `select role, privilege,
                has_table_privilege(role, 'public.shift_types', privilege) as held
           from unnest(array['anon', 'authenticated']) as role,
                unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
                  as privilege`,
      );
      const held = rows.filter((row) => row.held).map((row) => `${row.role}:${row.privilege}`);

      expect(held.sort()).toEqual(['authenticated:SELECT']);

      const { rows: columns } = await client.query<{
        role: string;
        column: string;
        verb: string;
        held: boolean;
      }>(
        `select role, column_name as column, verb,
                has_column_privilege(role, 'public.shift_types', column_name, verb) as held
           from unnest(array['anon', 'authenticated']) as role,
                unnest(array['organization_id', 'id', 'name', 'is_working', 'archived',
                              'created_by', 'created_at']) as column_name,
                unnest(array['SELECT', 'INSERT', 'UPDATE']) as verb`,
      );
      expect(
        columns
          .filter((row) => row.held)
          .map((row) => `${row.role}:${row.verb}:${row.column}`)
          .filter((entry) => !entry.startsWith('authenticated:SELECT:'))
          .sort(),
        'the writable shift type columns changed, or anon holds one',
      ).toEqual([
        'authenticated:INSERT:is_working',
        'authenticated:INSERT:name',
        'authenticated:INSERT:organization_id',
        'authenticated:UPDATE:archived',
        'authenticated:UPDATE:name',
      ]);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('holds no privilege on shift_type_versions that no policy needs', async () => {
    // STORY 2.2a, the membership matrix exactly: `authenticated` keeps SELECT
    // and DELETE (each narrowed by a policy) and a column-level INSERT on the
    // five facts; `anon` keeps nothing, and no session names the attribution.
    const client = await connect();
    try {
      const { rows } = await client.query<{ role: string; privilege: string; held: boolean }>(
        `select role, privilege,
                has_table_privilege(role, 'public.shift_type_versions', privilege) as held
           from unnest(array['anon', 'authenticated']) as role,
                unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
                  as privilege`,
      );
      const held = rows.filter((row) => row.held).map((row) => `${row.role}:${row.privilege}`);

      expect(held.sort()).toEqual(['authenticated:DELETE', 'authenticated:SELECT']);

      const { rows: columns } = await client.query<{
        role: string;
        column: string;
        verb: string;
        held: boolean;
      }>(
        `select role, column_name as column, verb,
                has_column_privilege(role, 'public.shift_type_versions', column_name, verb) as held
           from unnest(array['anon', 'authenticated']) as role,
                unnest(array['organization_id', 'id', 'shift_type_id', 'start_time', 'end_time',
                              'effective_from', 'created_by', 'created_at']) as column_name,
                unnest(array['SELECT', 'INSERT', 'UPDATE']) as verb`,
      );
      expect(
        columns
          .filter((row) => row.held)
          .map((row) => `${row.role}:${row.verb}:${row.column}`)
          .filter((entry) => !entry.startsWith('authenticated:SELECT:'))
          .sort(),
        'the writable version columns changed, or anon holds one',
      ).toEqual([
        'authenticated:INSERT:effective_from',
        'authenticated:INSERT:end_time',
        'authenticated:INSERT:organization_id',
        'authenticated:INSERT:shift_type_id',
        'authenticated:INSERT:start_time',
      ]);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('indexes shift_types by its tenant, one active name per organization, and keys it for a composite reference', async () => {
    // Q3; the PARTIAL name unique that lets an archived type's name be reused;
    // and the key the versions take a composite foreign key to.
    const client = await connect();
    try {
      const { rows } = await client.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'shift_types'`,
      );
      expect(
        rows.some((row) => /\(organization_id\)$/.test(row.indexdef)),
        'no index leads with organization_id alone',
      ).toBe(true);
      expect(
        rows.some((row) => /UNIQUE INDEX .* \(organization_id, id\)$/.test(row.indexdef)),
        'no unique (organization_id, id) for a composite foreign key',
      ).toBe(true);
      expect(
        rows.some((row) =>
          /UNIQUE INDEX .* \(organization_id, lower\(btrim\(name\)\)\) WHERE \(NOT archived\)$/.test(
            row.indexdef,
          ),
        ),
        'two active types may share a name, or the unique also binds archived ones',
      ).toBe(true);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('indexes shift_type_versions by its tenant, one version per type per date', async () => {
    // Q3, as for the membership table: the unique index leads with the type.
    const client = await connect();
    try {
      const { rows } = await client.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'shift_type_versions'`,
      );
      expect(
        rows.some((row) => /\(organization_id\)$/.test(row.indexdef)),
        'no index leads with organization_id alone',
      ).toBe(true);
      expect(
        rows.some((row) => /UNIQUE INDEX .* \(shift_type_id, effective_from\)$/.test(row.indexdef)),
        'two versions may share a date',
      ).toBe(true);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('holds no privilege on team_membership_versions that no policy needs', async () => {
    // STORY 1.7b, the status table's matrix exactly: `authenticated` keeps
    // SELECT and DELETE (each narrowed by a policy) and a column-level INSERT
    // on the four facts (five since team position); `anon` keeps nothing, and no session names the
    // attribution.
    const client = await connect();
    try {
      const { rows } = await client.query<{ role: string; privilege: string; held: boolean }>(
        `select role, privilege,
                has_table_privilege(role, 'public.team_membership_versions', privilege) as held
           from unnest(array['anon', 'authenticated']) as role,
                unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
                  as privilege`,
      );
      const held = rows.filter((row) => row.held).map((row) => `${row.role}:${row.privilege}`);

      expect(held.sort()).toEqual(['authenticated:DELETE', 'authenticated:SELECT']);

      const { rows: columns } = await client.query<{ column: string; verb: string; held: boolean }>(
        `select column_name as column, verb,
                has_column_privilege('authenticated', 'public.team_membership_versions', column_name, verb) as held
           from unnest(array['organization_id', 'id', 'member_id', 'team_id', 'position',
                             'effective_from', 'created_by', 'created_at']) as column_name,
                unnest(array['INSERT', 'UPDATE']) as verb`,
      );
      expect(
        columns
          .filter((row) => row.held)
          .map((row) => `${row.verb}:${row.column}`)
          .sort(),
        'the writable membership columns changed',
      ).toEqual([
        'INSERT:effective_from',
        'INSERT:member_id',
        'INSERT:organization_id',
        // TEAM POSITION: a fifth fact, joined to the grant (`0015`).
        'INSERT:position',
        'INSERT:team_id',
      ]);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('indexes team_membership_versions by its tenant', async () => {
    // Q3, as for the status table: the unique index leads with `member_id`.
    const client = await connect();
    try {
      const { rows } = await client.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'team_membership_versions'`,
      );
      expect(
        rows.some((row) => /\(organization_id\)$/.test(row.indexdef)),
        'no index leads with organization_id alone',
      ).toBe(true);
      expect(
        rows.some((row) => /UNIQUE INDEX .* \(member_id, effective_from\)$/.test(row.indexdef)),
        'two versions may share a date',
      ).toBe(true);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('indexes teams by its tenant, and keys it for a composite reference', async () => {
    // Q3, and the key 1.7b's membership takes a composite foreign key to.
    const client = await connect();
    try {
      const { rows } = await client.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'teams'`,
      );
      expect(
        rows.some((row) => /\(organization_id\)$/.test(row.indexdef)),
        'no index leads with organization_id alone',
      ).toBe(true);
      expect(
        rows.some((row) => /UNIQUE INDEX .* \(organization_id, id\)$/.test(row.indexdef)),
        'no unique (organization_id, id) for a composite foreign key',
      ).toBe(true);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('indexes member_status_versions by its tenant', async () => {
    // Q3: every policy filters by `organization_id` first, and the unique
    // index leads with `member_id`, so the tenant needs an index of its own.
    const client = await connect();
    try {
      const { rows } = await client.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'member_status_versions'`,
      );
      expect(
        rows.some((row) => /\(organization_id\)$/.test(row.indexdef)),
        'no index leads with organization_id alone',
      ).toBe(true);
    } finally {
      await client.end();
    }
  });

  // One role, two tables. This was a two-role cross product until story 1.3
  // narrowed the `authenticated` half into the case below it; a `flatMap` over
  // a one-element array is what that edit would have left behind.
  const anonymousReaders = ['organizations', 'members'].map((table) => ({ role: 'anon', table }));

  it.skipIf(noDatabase).each(anonymousReaders)('returns zero rows to $role reading $table', async ({ role, table }) => {
    await inRolledBackTransaction(async (client) => {
      // THESE TWO ROWS STAY EXACTLY AS THEY ARE, FOREVER. Story 1.3's policies
      // are all `to authenticated`, so `anon` matches none of them and reads
      // nothing from either table; there is no anonymous read path anywhere in
      // this system, in 1.3 or after it. The `authenticated` rows that used to
      // sit beside them were narrowed by 1.3 into the case below.
      //
      // Exactly what PostgREST does with a publishable key and no session: it
      // switches to this role and selects. A privilege error rather than an
      // empty result would mean the grant is missing, not that RLS is working.
      await client.query(`set local role ${role}`);
      const { rows } = await client.query<{ visible: number }>(
        `select count(*)::int as visible from ${table}`,
      );
      await client.query('reset role');

      expect(rows[0]?.visible, `${role} can read ${table}`).toBe(0);
    });
  });

  it.skipIf(noDatabase).each(FIXTURES)(
    'gives an authenticated $fixture session its own organization and no other',
    async ({ slug }) => {
      // The narrowed half of what used to be "returns zero rows to
      // authenticated": a session now reads its own organization's rows, and
      // still reads nobody else's. Story 1.3 owns the full matrix — every
      // operation, both fixtures, through PostgREST with a real token as well
      // as with claims injected — in `test/rls-isolation.test.ts`. This case
      // stays here because this is the file that asserted deny-all, and the
      // line between the two postures is the one thing a later migration could
      // move without noticing.
      await inRolledBackTransaction(async (client) => {
        const organization = await organizationId(client, slug);
        const { rows: caller } = await client.query<{ authUserId: string }>(
          `select auth_user_id as "authUserId" from members
            where organization_id = $1 order by created_at limit 1`,
          [organization],
        );
        const subject = caller[0]?.authUserId;
        if (subject === undefined) throw new Error(`${slug} has no member to act as`);

        // Read as the connection's own role, before any claim is injected: the
        // vacuous-pass guard this file requires beside every sweep. With only
        // one organization loaded, "no foreign rows" is true of a policy that
        // filters nothing at all.
        const { rows: everything } = await client.query<{ total: number }>(
          'select count(*)::int as total from members',
        );

        await client.query('select set_config($1, $2, true)', [
          'request.jwt.claims',
          JSON.stringify({ sub: subject, role: 'authenticated', organization_id: organization }),
        ]);
        await client.query('set local role authenticated');
        const { rows } = await client.query<{ own: number; foreign: number }>(
          `select count(*) filter (where organization_id = $1)::int as own,
                  count(*) filter (where organization_id <> $1)::int as "foreign"
             from members`,
          [organization],
        );
        await client.query('reset role');

        expect(rows[0]?.own, `an authenticated ${slug} session read none of its own members`).toBeGreaterThan(0);
        expect(rows[0]?.foreign, `an authenticated ${slug} session read another organization`).toBe(0);
        expect(
          everything[0]?.total,
          'both fixtures must be loaded, or a zero foreign count proves nothing',
        ).toBeGreaterThan(rows[0]?.own ?? 0);
      });
    },
  );
});

describe('the access-control layer runs as the owner and hands that power to nobody', () => {
  /** `pronargs` per function, so an overload cannot decide what gets inspected. */
  const ACCESS_CONTROL_FUNCTIONS = [
    { name: 'current_member_access', argumentCount: 0 },
    { name: 'custom_access_token_hook', argumentCount: 1 },
    // STORY 1.8. The roster reads `members` past the narrowed select policy,
    // which is the whole point of it, so it carries the same three attributes.
    { name: 'team_roster', argumentCount: 1 },
  ];

  it.skipIf(noDatabase).each(ACCESS_CONTROL_FUNCTIONS)(
    'runs $name as the owner, past row level security',
    async ({ name, argumentCount }) => {
      // The same three attributes 0002's trigger function carries, and for the
      // same reason: both of these read `members` past row level security — the
      // helper because a policy on `members` cannot read `members` as the
      // caller, the hook because it resolves a subject before any policy exists
      // to consult. Either one reachable by PUBLIC, or resolving a name through
      // a caller-controlled search_path, is the owner's rights handed to
      // whoever can call it.
      const client = await connect();
      try {
        expectRunsAsOwner(await functionSecurity(client, name, argumentCount), name);
      } finally {
        await client.end();
      }
    },
  );

  // The grantee lists name every role but the function's owner, which is added
  // at assertion time from `pg_proc.proowner`. The owner always holds EXECUTE
  // and is not a security decision; hard-coding it as `postgres` made these
  // assertions specific to a stack whose migrations happen to be applied by
  // that role, and would fail elsewhere for a reason unrelated to access
  // control.
  const grantees = [
    // The request role has to hold EXECUTE or the policy that names the
    // function fails with `permission denied for function` instead of returning
    // rows — a policy expression is permission-checked against the querying
    // role. Granting it discloses nothing: the function takes no argument, so
    // there is no subject to name but `auth.uid()`.
    { name: 'current_member_access', argumentCount: 0, expected: ['authenticated'] },
    // The hook takes its subject as an argument, so anyone who can execute it
    // can ask about anybody. Nothing but the auth service may call it.
    {
      name: 'custom_access_token_hook',
      argumentCount: 1,
      expected: ['supabase_auth_admin'],
    },
    // STORY 1.6's four status readers. All are SECURITY INVOKER, so a session
    // learns nothing through them its own policies would not show it, and the
    // request role holds EXECUTE because the status policies call them as the
    // querying role. `anon` and `service_role` have no policy that needs
    // either.
    { name: 'organization_today', argumentCount: 1, expected: ['authenticated'] },
    { name: 'member_active_on', argumentCount: 2, expected: ['authenticated'] },
    { name: 'member_active_from', argumentCount: 2, expected: ['authenticated'] },
    { name: 'member_latest_version', argumentCount: 1, expected: ['authenticated'] },
    // STORY 1.7b's four membership readers, on the same terms.
    { name: 'member_team_on', argumentCount: 2, expected: ['authenticated'] },
    { name: 'member_team_has_version', argumentCount: 1, expected: ['authenticated'] },
    { name: 'team_membership_latest_version', argumentCount: 1, expected: ['authenticated'] },
    { name: 'team_in_use', argumentCount: 1, expected: ['authenticated'] },
    // TEAM POSITION's reader of team and position at a date, on the same terms.
    { name: 'member_team_version_on', argumentCount: 2, expected: ['authenticated'] },
    // STORY 2.2a's two version readers, on the same terms.
    { name: 'shift_type_latest_version', argumentCount: 1, expected: ['authenticated'] },
    { name: 'shift_type_times_on', argumentCount: 2, expected: ['authenticated'] },
    // STORY 1.8. The roster is called by a signed-in session over REST, and by
    // nobody else: an anonymous caller has no organization to scope it to.
    { name: 'team_roster', argumentCount: 1, expected: ['authenticated'] },
  ];

  it.skipIf(noDatabase).each([
    { name: 'organization_today', argumentCount: 1 },
    { name: 'member_active_on', argumentCount: 2 },
    { name: 'member_active_from', argumentCount: 2 },
    { name: 'member_latest_version', argumentCount: 1 },
    { name: 'member_team_on', argumentCount: 2 },
    { name: 'member_team_has_version', argumentCount: 1 },
    { name: 'team_membership_latest_version', argumentCount: 1 },
    { name: 'team_in_use', argumentCount: 1 },
    { name: 'member_team_version_on', argumentCount: 2 },
    { name: 'shift_type_latest_version', argumentCount: 1 },
    { name: 'shift_type_times_on', argumentCount: 2 },
  ])('runs $name as the caller, with an empty search_path', async ({ name, argumentCount }) => {
    // INVOKER, the opposite of the helper and the hook. They are reached from
    // the helper, the hook and the zero-admins function as the owner, and from
    // the status insert policy as the session — where running as the owner
    // would let any session read any organization's status history by id.
    const client = await connect();
    try {
      const security = await functionSecurity(client, name, argumentCount);
      expect(security.prosecdef, `${name} must be SECURITY INVOKER`).toBe(false);
      const searchPath = (security.proconfig ?? []).find((entry) =>
        entry.startsWith('search_path='),
      );
      expect(searchPath, `${name} must pin a search_path`).toBeDefined();
      expect(security.publicGrants, `${name} must not be executable by PUBLIC`).toBe(0);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase).each(grantees)('grants execute on $name to $expected and no one else', async ({ name, argumentCount, expected }) => {
    // An exact list, not a subset. Supabase's default privileges grant EXECUTE
    // on every new function in `public` to `anon`, `authenticated` and
    // `service_role` individually, so a `revoke ... from public` leaves all
    // three in place — the whole point of 0003's explicit revokes, and the
    // thing a subset check would not notice coming back.
    const client = await connect();
    try {
      const security = await functionSecurity(client, name, argumentCount);
      expect(
        security.grantees,
        `${name} is executable by a role that has no business calling it`,
      ).toBe([...expected, security.owner].sort().join(','));
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('keeps a role and an organization out of every account metadata column', async () => {
    // The hook writes `organization_id` and nothing else, and AD-10 keeps the
    // domain role out of every claim. GoTrue also copies the metadata columns
    // into a token wholesale, so a role that landed there would become a claim
    // without any hook writing it — which is why the seed and the operator
    // script put nothing but the provider there, and why this asserts it.
    //
    // Every `auth.users` row, not only those with a member row: an account with
    // no member is exactly the one the hook's fail-closed branch is for, and an
    // inner join would never scan it. Searched as rendered text rather than by
    // top-level key, so a role nested inside an object is caught too, and
    // coalesced so a null column — or a metadata value that is not an object at
    // all — is data rather than an error.
    const client = await connect();
    try {
      const { rows } = await client.query<{ leaking: number; scanned: number }>(
        `select count(*) filter (
                  where coalesce(u.raw_app_meta_data, '{}'::jsonb)::text ~* $1
                     or coalesce(u.raw_user_meta_data, '{}'::jsonb)::text ~* $1
                )::int as leaking,
                count(*)::int as scanned
           from auth.users u`,
        ['role|organization_id|admin|member_role'],
      );

      expect(rows[0]?.scanned, 'no accounts were scanned at all').toBeGreaterThan(0);
      expect(
        rows[0]?.leaking,
        'GoTrue copies account metadata into the token, so a role or organization there becomes an unrefreshed claim (AD-10)',
      ).toBe(0);
    } finally {
      await client.end();
    }
  });
});

describe('the operator provisioning script', () => {
  /** Session settings the script reads, so no value is interpolated into SQL. */
  async function parameterize(client: Client, values: Readonly<Record<string, string>>) {
    for (const [name, value] of Object.entries(values)) {
      await client.query('select set_config($1, $2, false)', [`shift.${name}`, value]);
    }
  }

  const organizationParameters = (slug: string): Record<string, string> => ({
    organization_slug: slug,
    organization_name: 'Provisioned Organization',
    organization_type: 'Provisioned Type',
    organization_timezone: 'UTC',
    organization_locale: 'en',
    leave_year_start_month: '1',
    leave_year_start_day: '1',
  });

  const adminParameters: Record<string, string> = {
    admin_name: 'Provisioned Admin',
    admin_username: 'operator',
    admin_password: 'a-long-throwaway-password',
    admin_leave_allowance_days: '20',
  };

  it.skipIf(noDatabase)('creates the organization and its first admin together', async () => {
    const slug = `${THROWAWAY_SLUG}-born-with-an-admin`;

    await inRolledBackTransaction(async (client) => {
      await parameterize(client, { ...organizationParameters(slug), ...adminParameters });
      await client.query(provisioningScript);

      const { rows } = await client.query<{
        admins: number;
        members: number;
        address: string;
      }>(
        `select count(m.*) filter (where m.role = 'admin')::int as admins,
                count(m.*)::int as members,
                min(u.email) as address
           from organizations o
           join members m on m.organization_id = o.id
           join auth.users u on u.id = m.auth_user_id
          where o.slug = $1`,
        [slug],
      );

      expect(rows[0]?.members, 'a newly provisioned organization has exactly one member').toBe(1);
      expect(rows[0]?.admins).toBe(1);
      // AD-12: a non-routable synthesized address, namespaced by the slug.
      expect(rows[0]?.address).toBe(`operator@${slug}.shift.invalid`);

      // THE STORED USERNAME IS ASSERTED, NOT MERELY WRITTEN. Swapping
      // `admin_username` for `admin_name` in the script's `members` insert left
      // every case here green while the provisioned admin's stored username
      // ("Provisioned Admin") disagreed with the address they actually sign in
      // with — the column is duplicated across the `auth` boundary on purpose
      // (`0007`), and nothing in PostgreSQL can hold the two together.
      //
      // Compared against the LOCAL PART of the address GoTrue holds rather than
      // against the parameter this test passed in: the parameter is what the
      // script was given, and the address is what the account answers to.
      const { rows: identity } = await client.query<{ username: string; local: string }>(
        `select m.username, split_part(u.email, '@', 1) as local
           from organizations o
           join members m on m.organization_id = o.id
           join auth.users u on u.id = m.auth_user_id
          where o.slug = $1`,
        [slug],
      );

      expect(identity[0]?.local, 'no provisioned account to read an address from').toBe('operator');
      expect(
        identity[0]?.username,
        'the stored username disagrees with the address the admin signs in with',
      ).toBe(identity[0]?.local);

      // The same GoTrue couplings the seed's copy of the recipe is held to.
      expectSignInCapable(await recipeHealth(client, slug), 'the provisioned organization');
    });
  });

  it.skipIf(noDatabase || authEndpoint === undefined)(
    'issues a credential that actually authenticates',
    async () => {
      // The one case that leaves the database and asks GoTrue. Every other case
      // here counts rows, and counting rows cannot tell a bcrypt hash from the
      // plaintext password sitting in the same column, or a correct `sub` from
      // a copied one — both of those mutations passed the whole suite before
      // this existed. Exchanging the credential for a token is the only check
      // that exercises what the recipe is for.
      //
      // Not inside a rolled-back transaction: GoTrue is a separate connection
      // and would never see uncommitted rows. So the organization is created
      // for real and removed in afterAll, like every other THROWAWAY_SLUG row.
      const slug = `${THROWAWAY_SLUG}-authenticates`;
      const endpoint = authEndpoint;
      if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

      const client = await connect();
      try {
        await client.query('delete from organizations where slug = $1', [slug]);
        await parameterize(client, { ...organizationParameters(slug), ...adminParameters });
        await client.query(provisioningScript);

        const grant = async (password: string): Promise<Response> =>
          fetch(`${endpoint.url}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { apikey: endpoint.key, 'content-type': 'application/json' },
            body: JSON.stringify({
              email: `operator@${slug}.shift.invalid`,
              password,
            }),
          });

        const accepted = await grant(adminParameters['admin_password'] ?? '');
        const body: unknown = await accepted.json();
        const token =
          typeof body === 'object' && body !== null
            ? (body as Record<string, unknown>)['access_token']
            : undefined;

        expect(
          typeof token === 'string' && token.length > 0,
          `the provisioned admin could not sign in: ${accepted.status} ${JSON.stringify(body)}`,
        ).toBe(true);

        // The negative control: without it, a GoTrue that accepted anything
        // would satisfy the assertion above.
        const rejected = await grant('not-the-password');
        expect(rejected.ok, 'a wrong password was accepted').toBe(false);
      } finally {
        await client.query('delete from organizations where slug = $1', [slug]).catch(() => undefined);
        await client.end();
      }
    },
    20_000,
  );

  it.skipIf(noDatabase)('refuses to leave an organization behind with no admin', async () => {
    const slug = `${THROWAWAY_SLUG}-without-an-admin`;

    // Deliberately NOT inside a transaction of ours. The do block is its own
    // transaction, and the claim being tested is that its rollback is what
    // removes the organization row — not that this test rolled it back.
    const client = await connect();
    try {
      await parameterize(client, organizationParameters(slug));
      const refusal = await refused(() => client.query(provisioningScript));

      expect(refusal.message).toBe('ORGANIZATION_WITHOUT_ADMIN');

      const { rows } = await client.query<{ surviving: number }>(
        'select count(*)::int as surviving from organizations where slug = $1',
        [slug],
      );
      expect(rows[0]?.surviving, 'the organization row outlived the refusal').toBe(0);
    } finally {
      await client.end();
    }
  });
});

describe('0007 backfills the username from the local part, executed over a row', () => {
  /**
   * THE STATEMENT `supabase db reset` NEVER RUNS OVER ANYTHING.
   *
   * Migrations are applied before `seed.sql`, so `members` is empty when `0007`
   * runs: its update touches zero rows, and every character of it is
   * unverified. The 1.5b review changed `split_part(u.email, '@', 1)` to
   * `, 2)` — which writes `dvd-kastel-novi.shift.invalid` as every member's
   * username, so `0007`'s per-organization unique index would refuse the second
   * member of every organization on a real backfill — and the whole suite
   * stayed green.
   *
   * So the statement is READ OUT OF THE MIGRATION FILE and applied here, in a
   * rolled-back transaction, to a seeded member whose username has been nulled.
   * A test that wrote its own copy of the statement would assert that a string
   * this file contains does what this file says.
   */

  it('finds the statement it is about to execute', () => {
    // Vacuous-pass guard. An extraction that returned nothing would make the
    // case below run no SQL and compare a value to itself.
    const statement = backfillStatement();

    expect(statement.length, '0007 carries no update statement').toBeGreaterThan(40);
    expect(statement).toContain('split_part');
    expect(statement).toContain('auth.users');
  });

  it.skipIf(noDatabase)('writes each member the local part of their own address', async () => {
    await inRolledBackTransaction(async (client) => {
      // DDL is transactional in PostgreSQL, so dropping the not-null here is
      // undone with everything else. It is what lets the column hold the state
      // the migration actually met: every row null.
      await client.query('alter table members alter column username drop not null');
      await client.query('update members set username = null');

      await client.query(backfillStatement());

      const { rows } = await client.query<{ scanned: number; disagreeing: number }>(
        `select count(*)::int as scanned,
                count(*) filter (
                  where m.username is distinct from split_part(u.email, '@', 1)
                )::int as disagreeing
           from members m
           join auth.users u on u.id = m.auth_user_id`,
      );

      // BOTH FIXTURES' SEVEN ACCOUNTS, so the statement is proved over rows
      // whose local parts differ from one another and from their domains.
      expect(rows[0]?.scanned, 'no members were backfilled at all').toBeGreaterThan(1);
      expect(
        rows[0]?.disagreeing,
        'a backfilled username is not the local part of that account address',
      ).toBe(0);

      // AND NOT THE DOMAIN, which is the mutation this exists for: reading
      // field 2 writes the same string into every row, so the count of DISTINCT
      // usernames would collapse to one per organization.
      const { rows: distinct } = await client.query<{ names: number; rows: number }>(
        'select count(distinct username)::int as names, count(*)::int as rows from members',
      );

      expect(distinct[0]?.names).toBe(distinct[0]?.rows);
    });
  });

  it.skipIf(noDatabase)('leaves every seeded member holding the username they sign in with', async () => {
    // The other half, and it is about the SEED rather than the migration: both
    // fixtures write `username` at insert time now, and a fixture whose stored
    // username disagreed with its address would be a fixture whose credential
    // authenticates nothing.
    const client = await connect();

    try {
      const { rows } = await client.query<{ disagreeing: number; scanned: number }>(
        `select count(*)::int as scanned,
                count(*) filter (
                  where m.username is distinct from split_part(u.email, '@', 1)
                )::int as disagreeing
           from members m
           join auth.users u on u.id = m.auth_user_id
           join organizations o on o.id = m.organization_id
          where o.slug = any($1::text[])`,
        [FIXTURES.map((entry) => entry.slug)],
      );

      expect(rows[0]?.scanned, 'no seeded members to check').toBeGreaterThan(1);
      expect(
        rows[0]?.disagreeing,
        'a seeded member stores a username that is not the local part of their address',
      ).toBe(0);
    } finally {
      await client.end();
    }
  });
});
