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
  await client.query(
    `insert into members (organization_id, auth_user_id, name, role, leave_allowance_days)
     values ($1, $2, $3, 'admin', 0)`,
    [organization, created.id, label],
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
      const { rows } = await client.query<{
        prosecdef: boolean;
        proconfig: string[] | null;
        publicGrants: number;
      }>(
        `select p.prosecdef,
                p.proconfig,
                (select count(*)::int
                   from unnest(coalesce(p.proacl, '{}'::aclitem[])) as entry
                  where entry::text like '=%') as "publicGrants"
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'refuse_organization_with_no_admin'`,
      );

      expect(rows.length, 'refuse_organization_with_no_admin does not exist').toBe(1);
      expect(rows[0]?.prosecdef, 'the trigger function must be SECURITY DEFINER').toBe(true);

      // pg_proc stores it as `search_path=""` — the setting name, then the
      // quoted value. Both halves matter: present, and empty.
      const searchPath = (rows[0]?.proconfig ?? []).find((entry) =>
        entry.startsWith('search_path='),
      );
      expect(searchPath, 'the trigger function must pin a search_path').toBeDefined();
      expect(
        (searchPath ?? '').slice('search_path='.length).replaceAll(/["']/g, ''),
        "the pinned search_path must be empty (set search_path = ''), so no name resolves through a caller-controlled path",
      ).toBe('');
      expect(
        rows[0]?.publicGrants,
        'a SECURITY DEFINER function that reads past RLS must not be executable by PUBLIC',
      ).toBe(0);
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
          `insert into members (auth_user_id, name, role, leave_allowance_days)
           values (gen_random_uuid(), 'orphan', 'member_role', 0)`,
        ),
      );

      expect(refusal.code, 'a not null violation is 23502').toBe('23502');
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

describe('both tables are deny-all until story 1.3 writes a policy', () => {
  it.skipIf(noDatabase)('has row level security on and no policy anywhere', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ relname: string; relrowsecurity: boolean }>(
        `select relname, relrowsecurity
           from pg_class
          where relnamespace = 'public'::regnamespace
            and relname in ('organizations', 'members')
          order by relname`,
      );

      expect(rows.map((row) => row.relname)).toEqual(['members', 'organizations']);
      for (const row of rows) {
        expect(row.relrowsecurity, `${row.relname} must have RLS enabled`).toBe(true);
      }

      // EXPECTED TO BE DELETED IN STORY 1.3. That story writes the RLS
      // policies, and the first one it writes makes this assertion wrong by
      // construction — remove it then rather than weakening it to a smaller
      // list, and let 1.3's own two security tests be the check. Until then,
      // deny-all is the only safe posture and a policy appearing here early
      // would go unnoticed until the story that was supposed to author it.
      const { rows: policies } = await client.query<{ policyname: string }>(
        `select policyname from pg_policies where schemaname = 'public'`,
      );
      expect(
        policies.map((policy) => policy.policyname),
        'story 1.3 owns every policy, and writes its two security tests with them',
      ).toEqual([]);
    } finally {
      await client.end();
    }
  });

  const readers = ['anon', 'authenticated'].flatMap((role) =>
    ['organizations', 'members'].map((table) => ({ role, table })),
  );

  it.skipIf(noDatabase).each(readers)('returns zero rows to $role reading $table', async ({ role, table }) => {
    await inRolledBackTransaction(async (client) => {
      // THE `authenticated` ROWS ARE EXPECTED TO CHANGE IN STORY 1.3, which
      // gives a session its own organization's rows — narrow them to "reads
      // its own organization and no other" rather than deleting them, and
      // leave the two `anon` rows exactly as they are: no session ever reads
      // anything, in 1.3 or after it.
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
