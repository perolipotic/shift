import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The Supabase scaffold's shape: forward-only migrations, a seed carrying both
 * fixtures, and exactly one Edge Function (AD-14, AD-15).
 *
 * These are structural assertions. Whether `supabase db reset` actually applies
 * the migrations and loads the seed is a live-database check: what the schema
 * does once applied is asserted in `test/provisioning.test.ts`, and the
 * end-to-end runbook lives in DEPLOY.md because it needs Docker rather than a
 * test runner.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const supabaseRoot = join(repoRoot, 'supabase');
const operatorRoot = join(supabaseRoot, 'operator');

/** `0001_extensions.sql` — four digits, then the name. */
const MIGRATION_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

function migrationNames(): string[] {
  return readdirSync(join(supabaseRoot, 'migrations')).filter((name) => name.endsWith('.sql'));
}

/** Every migration's text, concatenated — what "no migration may say X" reads. */
function allMigrations(): string {
  return migrationNames()
    .sort()
    .map((name) => readFileSync(join(supabaseRoot, 'migrations', name), 'utf8'))
    .join('\n');
}

/**
 * Every migration's text with its comments removed.
 *
 * A source-text assertion that runs over prose is satisfiable by prose: the
 * whole of this file's job is to catch a missing statement, and every
 * statement it looks for is also *described* in a comment a line above.
 *
 * Module scope because two describe blocks need it: the access-control
 * migration's statement assertions, and the auth-provider block's cross-check
 * that the configured hook URI names a function some migration actually
 * creates.
 */
function migrationStatements(): string {
  return allMigrations().replaceAll(/--[^\n]*/g, '');
}

/**
 * Everything that is core rather than fixture.
 *
 * The migrations, plus the operator provisioning script: it is applied to
 * production, it creates the very first organization, and a default in it
 * would seed one organization's answer into every tenant just as surely as a
 * default in a migration would. `seed.sql` is deliberately absent — it is
 * where the pilot's values are *supposed* to live.
 */
function coreSql(): string {
  const operator = existsSync(operatorRoot)
    ? readdirSync(operatorRoot)
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map((name) => readFileSync(join(operatorRoot, name), 'utf8'))
    : [];
  return [allMigrations(), ...operator].join('\n');
}

describe('supabase scaffold', () => {
  it('holds exactly one Edge Function, the privileged auth boundary', () => {
    const functions = readdirSync(join(supabaseRoot, 'functions'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(functions).toEqual(['admin-auth']);
  });

  it('numbers migrations 0001, 0002, … with no gaps and no duplicates', () => {
    const migrations = migrationNames();

    expect(migrations.length).toBeGreaterThan(0);

    // Zero-padded to a fixed width, so lexicographic order — which is what the
    // Supabase CLI applies migrations in — matches numeric order.
    const malformed = migrations.filter((name) => !MIGRATION_NAME.test(name));
    expect(malformed, 'migrations must be named <0000>_<snake_case>.sql').toEqual([]);

    const numbers = migrations
      .map((name) => Number(MIGRATION_NAME.exec(name)?.[1]))
      .sort((a, b) => a - b);

    expect(new Set(numbers).size, `duplicate migration numbers in ${migrations.join(', ')}`).toBe(
      numbers.length,
    );

    // Contiguity, which is what "no gaps" actually means: 0001, 0003 must fail.
    expect(numbers).toEqual(numbers.map((_value, index) => index + 1));

    // And the CLI's own ordering agrees with ours.
    expect([...migrations].sort()).toEqual(
      [...migrations].sort(
        (a, b) => Number(MIGRATION_NAME.exec(a)?.[1]) - Number(MIGRATION_NAME.exec(b)?.[1]),
      ),
    );
  });

  it('enables btree_gist, which AD-3 needs before leave can be unrepresentable', () => {
    const first = readFileSync(join(supabaseRoot, 'migrations', '0001_extensions.sql'), 'utf8');

    expect(first).toMatch(/create extension if not exists btree_gist/i);
  });

  it('reserves both fixtures in the seed', () => {
    const seed = readFileSync(join(supabaseRoot, 'seed.sql'), 'utf8');

    expect(seed).toMatch(/pilot organization/i);
    expect(seed).toMatch(/UJ-5 security organization/i);
  });

  it('keeps the operator provisioning script out of the Edge Function directory', () => {
    // `supabase/functions/` holds exactly one directory, asserted above, so the
    // provisioning artifact has to live somewhere else. It lives in
    // `supabase/operator/`, and that directory must not quietly become the
    // second Edge Function: a function is TypeScript with an entry point, and
    // nothing here is TypeScript at all (AD-16).
    //
    // Existence is asserted before the read, so a missing directory reports the
    // invariant it broke instead of a bare ENOENT from `readdirSync`.
    expect(existsSync(operatorRoot), `${operatorRoot} does not exist`).toBe(true);
    const operator = readdirSync(operatorRoot, { withFileTypes: true });

    expect(operator.length, 'supabase/operator/ is empty').toBeGreaterThan(0);
    expect(
      operator
        .filter((entry) => !entry.isFile() || !entry.name.endsWith('.sql'))
        .map((entry) => entry.name),
      'supabase/operator/ holds SQL an operator runs by hand, and nothing else',
    ).toEqual([]);
    expect(operator.map((entry) => entry.name)).toContain('provision-organization.sql');
  });
});

describe('the first schema migration', () => {
  it('creates organizations and members, both denied by default', () => {
    const migrations = allMigrations();

    expect(
      migrationNames(),
      'story 1.2 owes migration 0002, hand-numbered because `supabase migration new` emits a timestamp name this suite rejects',
    ).toContain('0002_organizations_and_members.sql');

    for (const table of ['organizations', 'members']) {
      expect(migrations, `no migration creates ${table}`).toMatch(
        new RegExp(`create table ${table}\\b`, 'i'),
      );
      expect(migrations, `${table} must have row level security enabled; its policies are 0003's`).toMatch(
        new RegExp(`alter table ${table} enable row level security`, 'i'),
      );
    }
  });

  it('declares pgcrypto, which the password hashing depends on', () => {
    // Both `supabase/seed.sql` and the operator provisioning script call
    // `extensions.crypt`. The Supabase image preinstalls pgcrypto, so this
    // assertion protects against an inherited dependency rather than a broken
    // one — and an inherited dependency is exactly what 0001 exists to stop.
    expect(allMigrations()).toMatch(
      /create extension if not exists pgcrypto with schema extensions/i,
    );
  });

  it('spends the whole constraint-trigger budget on one deferred trigger', () => {
    const migrations = allMigrations();
    const triggers = migrations.match(/create constraint trigger/gi) ?? [];

    expect(
      triggers.length,
      'AD-3 permits exactly one constraint trigger; a second means AD-9 needs revisiting, not another trigger',
    ).toBe(1);

    // Deferred is what keeps a legal admin swap legal: insert the replacement,
    // demote the incumbent, and only the state at commit is a fact.
    expect(migrations, 'the zero-admins trigger must be deferrable initially deferred').toMatch(
      /create constraint trigger[\s\S]*?deferrable initially deferred/i,
    );

    // A downgrade is the other half of Q6, so delete alone is not enough.
    expect(migrations, 'a role downgrade removes the last admin just as a delete does').toMatch(
      /create constraint trigger[\s\S]*?after delete or update/i,
    );
  });

  it('carries no organization specific, not even in a comment', () => {
    // SPEC.md: no pilot specific may exist in the core. Team count and names,
    // shift-type names, organization type, timezone and locale are all
    // organization data, and a default or a branch encoding one of them is the
    // failure this guards. The pilot's own values live in seed.sql only.
    //
    // Scoped to `coreSql()`, so the operator provisioning script is in scope
    // too: it runs against production and creates the first organization, and
    // a default there would be the same defect one migration further along.
    const TIMEZONE_AREAS =
      'Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Etc|Europe|Indian|Pacific';

    const forbidden: readonly { readonly what: string; readonly pattern: RegExp }[] = [
      { what: 'the pilot organization', pattern: /DVD|Kaštel/i },
      { what: 'the second fixture organization', pattern: /Zaštita/i },
      // An IANA area/location, including `Etc/UTC` and `Etc/GMT+1`.
      { what: 'a timezone', pattern: new RegExp(String.raw`\b(${TIMEZONE_AREAS})/[A-Za-z_+-]+`) },
      { what: 'an organization type', pattern: /fire department/i },
      { what: 'a shift-type name', pattern: /\b(dan|noć|slobodno)\b/i },
      // Any BCP 47 tag written near the word `locale` — a default, an argument
      // or a comment naming one. Anchored on `locale` rather than on the tag
      // alone, because a bare two-letter quoted string is far too common in SQL
      // to forbid outright.
      {
        what: 'a locale',
        pattern: /\blocale\b[^\n]*['"][a-z]{2,3}(-[A-Za-z0-9]{2,8})*['"]/i,
      },
      { what: 'the pilot language', pattern: /\bcroatian\b/i },
      { what: 'the pilot team count', pattern: /\bfour teams\b/i },
      { what: 'the pilot shift length', pattern: /\btwelve[- ]hour\b/i },
    ];

    const core = coreSql();

    expect(core.length, 'coreSql() read nothing').toBeGreaterThan(0);
    expect(
      forbidden.filter(({ pattern }) => pattern.test(core)).map(({ what }) => what),
      'a migration or the operator script names an organization specific; it belongs in seed.sql',
    ).toEqual([]);
  });
});

describe('the access-control migration', () => {
  /** The `create policy <name> on <table> … ;` body for one policy, comments out. */
  function policyBody(name: string): string {
    const declaration = new RegExp(`create policy ${name}\\b[\\s\\S]*?;`, 'i').exec(
      migrationStatements(),
    );
    return declaration?.[0] ?? '';
  }

  it('is named 0003 and hand-numbered', () => {
    // Contiguity across the whole tree is asserted by "numbers migrations 0001,
    // 0002, … with no gaps and no duplicates" above; this is the narrower claim
    // that the file story 1.3 owes exists under the name the suite requires.
    expect(
      migrationNames(),
      'story 1.3 owes migration 0003, hand-numbered because `supabase migration new` emits a timestamp name this suite rejects',
    ).toContain('0003_access_control.sql');
  });

  it('writes the policies 0002 deliberately left out', () => {
    // The counterpart of the assertion 0002 carried and this story deleted:
    // "no migration declares a policy" was the deny-all posture, and the
    // posture now is that both tables carry policies. Source text only — what
    // those policies actually do is `test/rls-isolation.test.ts`.
    const statements = migrationStatements();

    expect(statements, 'no migration declares a policy').toMatch(/create policy/i);
    for (const table of ['organizations', 'members']) {
      expect(statements, `no policy is declared on ${table}`).toMatch(
        new RegExp(`create policy [a-z_]+ on public\\.${table}\\b`, 'i'),
      );
    }
  });

  it('grants every policy to authenticated and to no wider role', () => {
    // The only database-independent guard on policy *scope*, and the reason the
    // deleted `not.toMatch(/create policy/i)` assertion is replaced rather than
    // merely removed. A policy written `to anon`, `to public`, or with no `to`
    // clause at all opens both tables to an unauthenticated caller, and a
    // `for all` policy silently covers writes that were never reviewed as
    // writes. None of that needs a running stack to catch.
    const declarations = migrationStatements().match(/create policy[\s\S]*?;/gi) ?? [];

    expect(declarations.length, 'no policy declarations were found to check').toBeGreaterThan(0);
    expect(
      declarations
        .filter((declaration) => !/\bto authenticated\b/i.test(declaration))
        .map((declaration) => /create policy (\S+)/i.exec(declaration)?.[1] ?? declaration),
      'every policy must name `to authenticated`; anything wider gives an anonymous caller rows',
    ).toEqual([]);
    expect(
      declarations
        .filter((declaration) => /\bfor all\b/i.test(declaration))
        .map((declaration) => /create policy (\S+)/i.exec(declaration)?.[1] ?? declaration),
      'a `for all` policy covers writes that were reviewed as reads',
    ).toEqual([]);
  });

  it('declares exactly the twenty-eight policies stories 1.3a, 1.4a, 1.4b, 1.6, 1.7a, 1.7b, 2.1a and 2.2a reviewed, and no twenty-ninth', () => {
    // EXTENDED BY STORY 1.4a, exactly as this comment asked: `0004_organization
    // _settings.sql` adds `organizations_update_by_own_active_admin`, built by
    // copying `members_update_by_own_active_admin`, and its name is added here
    // rather than the assertion being weakened to a count or a `toContain`.
    //
    // What is NOT here is as load-bearing as what is: `organizations` gains no
    // insert and no delete policy, because no product surface creates or
    // destroys a tenant (FR-2). Both stay refused by matching no policy at all,
    // which `test/rls-isolation.test.ts` asserts rather than assumes.
    //
    // The exact set was asserted only against `pg_policies` in
    // `test/rls-isolation.test.ts`, which skips without a database, and there
    // is still no CI running one (deferred-work.md). That left the only bound
    // on *which* policies exist behind a gate a developer has to remember to
    // open: the scope guard above is happy with a sixth policy written
    // `using (true) to authenticated`, and so was everything else here.
    const declared = (migrationStatements().match(/create policy (\S+)/gi) ?? [])
      .map((match) => /create policy (\S+)/i.exec(match)?.[1] ?? match)
      .sort();

    expect(declared, 'the declared policy set changed').toEqual([
      // STORY 2.1a, and FOUR: bands are current-state and any band may be
      // deleted, the last one included, so an active admin holds every write
      // verb. Each is its own policy, never `for all`.
      'hour_bands_delete_by_own_active_admin',
      'hour_bands_insert_by_own_active_admin',
      'hour_bands_select_own_organization',
      'hour_bands_update_by_own_active_admin',
      // STORY 1.6, and THREE rather than four: a status version is appended,
      // cancelled only while it is not yet in effect, and never changed, so
      // there is no update policy and that verb matches no row. A fourth name
      // here is a version being rewritten, which is history being rewritten.
      'member_status_versions_delete_scheduled_by_own_active_admin',
      'member_status_versions_insert_by_own_active_admin',
      'member_status_versions_select_own_organization',
      'members_delete_by_own_active_admin',
      'members_insert_by_own_active_admin',
      'members_select_own_organization',
      'members_update_by_own_active_admin',
      // STORY 1.4b, on `storage.objects` rather than on a table in `public`,
      // and the three are named here for the reason the six above are: this is
      // the only bound on WHICH policies exist that needs no running stack, and
      // the scope guard above is happy with a fourth written `using (true)`.
      //
      // THREE, and the split is the point. Read and write are different
      // populations here for the first time in this schema — any active member
      // may see the logo, only an active admin may write it — so a single
      // `for all` policy would grant the write to the read's population. There
      // is deliberately NO fourth: no DELETE policy exists, because nothing in
      // this story removes a logo and replacing one is an upsert of the same
      // key. Deletion stays refused by matching no policy at all.
      'organization_logos_insert_by_own_active_admin',
      'organization_logos_select_by_own_active_member',
      'organization_logos_update_by_own_active_admin',
      'organizations_select_own_organization',
      'organizations_update_by_own_active_admin',
      // STORY 2.2a, and THREE for the reason the membership table has three:
      // a times version is appended, cancelled only while it is not yet in
      // effect, and never changed.
      'shift_type_versions_delete_scheduled_by_own_active_admin',
      'shift_type_versions_insert_by_own_active_admin',
      'shift_type_versions_select_own_organization',
      // STORY 2.2a, and THREE for the reason teams have three: removal
      // archives, so there is no delete policy and the privilege is revoked.
      'shift_types_insert_by_own_active_admin',
      'shift_types_select_own_organization',
      'shift_types_update_by_own_active_admin',
      // STORY 1.7b, and THREE for the reason the status table has three: a
      // membership version is appended, cancelled only while it is not yet in
      // effect, and never changed.
      'team_membership_versions_delete_scheduled_by_own_active_admin',
      'team_membership_versions_insert_by_own_active_admin',
      'team_membership_versions_select_own_organization',
      // STORY 1.7a, and THREE: read, create, and an update that renames or
      // archives. No fourth — removal archives, so there is no delete policy
      // and the delete privilege is revoked as well.
      'teams_insert_by_own_active_admin',
      'teams_select_own_organization',
      'teams_update_by_own_active_admin',
    ]);
  });

  it('scopes every storage policy to one bucket and to one organization folder', () => {
    // STORY 1.4b, and the storage twin of the `organizations` block below: the
    // patterns there all require the word `organization_id`, and a policy on
    // `storage.objects` names no such column — isolation is the first segment of
    // the object's NAME. So a storage policy written `using (true)` would
    // satisfy every other assertion in this file.
    //
    // Three conjuncts per clause, one per fear: the bucket, so a later bucket
    // does not inherit these rules; the folder, so one tenant cannot read
    // another's object; and the helper, so `is_active` and `member_role` are
    // re-read on every evaluation rather than trusted from a token minted
    // before a demotion.
    const storagePolicies = (migrationStatements().match(/create policy[\s\S]*?;/gi) ?? []).filter(
      (declaration) => /on storage\.objects\b/i.test(declaration),
    );

    expect(storagePolicies.length, 'no policy on storage.objects was found').toBe(3);

    for (const declaration of storagePolicies) {
      const name = /create policy (\S+)/i.exec(declaration)?.[1] ?? declaration;

      // THE BUCKET BY NAME. `'[a-z-]+'` matched any bucket at all, so a policy
      // scoped to some other bucket — or to one that does not exist — read as
      // correct while the branding bucket stood with no policy on it.
      expect(declaration, `${name} is not scoped to the branding bucket`).toContain(
        "bucket_id = 'organization-logos'",
      );
      // THE WHOLE KEY, not merely the folder. Scoped by folder alone an
      // entitled admin may write `<own id>/anything`, without bound and without
      // any way to reclaim it, since no DELETE policy exists.
      expect(declaration, `${name} does not pin the object key`).toMatch(
        /and name = nullif\(\(\(select auth\.jwt\(\)\) ->> 'organization_id'\), ''\) \|\| '\/logo'/,
      );
      expect(
        declaration,
        `${name} does not scope the object to its organization folder`,
      ).toMatch(/\(storage\.foldername\(name\)\)\[1\] = \(/);
      expect(declaration, `${name} does not pin the tenant from the signed claim`).toContain(
        "'organization_id'",
      );
      expect(declaration, `${name} does not re-read role and active state`).toContain(
        'current_member_access()',
      );
      expect(declaration, `${name} admits an inactive caller`).toContain('access.is_active');
    }
  });

  it('lets any active member read the logo and only an active admin write it', () => {
    // READ AND WRITE ARE DIFFERENT POPULATIONS, and this is the assertion that
    // makes that a fact rather than a comment. A copy-paste that carried the
    // admin clause into the select policy would lock every member-role account
    // out of a logo that is on every screen they open; one that dropped it from
    // the two write policies would let any member replace the organization's
    // branding — and neither is visible in a diff that already reads as four
    // near-identical blocks.
    const read = policyBody('organization_logos_select_by_own_active_member');
    const insert = policyBody('organization_logos_insert_by_own_active_admin');
    const update = policyBody('organization_logos_update_by_own_active_admin');

    expect(read, 'the storage select policy is not declared').not.toBe('');
    expect(insert, 'the storage insert policy is not declared').not.toBe('');
    expect(update, 'the storage update policy is not declared').not.toBe('');

    expect(read, 'a member-role account cannot see its own organization logo').not.toContain(
      "member_role = 'admin'",
    );
    expect(insert, 'any member may write the organization logo').toContain(
      "access.member_role = 'admin'",
    );
    // BOTH clauses on the update, for the reason `0003:316-323` gives:
    // PostgreSQL falls back to USING when WITH CHECK is omitted, so the check is
    // what stops an admin renaming their own object into another tenant folder
    // the day USING is loosened.
    expect(
      (update.match(/access\.member_role = 'admin'/g) ?? []).length,
      'a member-role account is refused by only one of the two update clauses',
    ).toBe(2);
    expect(update, 'an update may change what it may not reach').toMatch(/with check[\s\S]*bucket_id/i);
    // The key pin in BOTH clauses too, for the same reason: USING stops an
    // admin reaching another key, WITH CHECK stops them renaming their own
    // object into one.
    expect(
      (update.match(/\|\| '\/logo'/g) ?? []).length,
      'the object key is pinned by only one of the two update clauses',
    ).toBe(2);
  });

  it('opens no delete on storage objects, and no policy on storage buckets', () => {
    // Both absences are decisions (story 1.4b). Nothing removes a logo —
    // replacing one is an upsert of the same key — and a DELETE policy written
    // before the surface that needs it is the invisible-permission problem
    // `0002:12-17` describes, on the one verb where a mistake destroys rather
    // than discloses. `storage.buckets` needs no policy at all: the storage
    // service resolves a bucket on its own privileged connection, so deny-all
    // by absence is what should hold there.
    const statements = migrationStatements();
    const storagePolicies = (statements.match(/create policy[\s\S]*?;/gi) ?? []).filter(
      (declaration) => /on storage\./i.test(declaration),
    );

    expect(storagePolicies.length, 'no policy on storage was found').toBeGreaterThan(0);
    for (const verb of ['delete', 'all']) {
      expect(
        storagePolicies.filter((declaration) =>
          new RegExp(`\\bfor ${verb}\\b`, 'i').test(declaration),
        ),
        `a policy opens ${verb} on storage; nothing in this story removes an object`,
      ).toEqual([]);
    }
    expect(
      storagePolicies.filter((declaration) => /on storage\.buckets\b/i.test(declaration)),
      'a policy on storage.buckets lets a session enumerate buckets',
    ).toEqual([]);
  });

  it('creates exactly one bucket, private and bounded by size and type', () => {
    // The bucket is a MIGRATION rather than a `config.toml` section, so it is
    // promoted local -> staging -> production the way every other schema fact
    // is — and so it can be asserted here at all. Each of the three properties
    // is a refusal the product owes: a public bucket serves every object to
    // anybody who can guess a path with no policy consulted, and the size and
    // type bounds are the enforcement point AD-9 leaves no server tier for.
    const statements = migrationStatements();
    const buckets = statements.match(/insert into storage\.buckets[\s\S]*?;/gi) ?? [];

    expect(buckets.length, 'exactly one bucket may exist').toBe(1);

    const bucket = buckets[0] ?? '';

    // POSITIONAL-INDEPENDENT. `toMatch(/\bfalse\b/)` tied `false` to nothing:
    // it passed for a bucket declared public whose `avif_autodetection` happened
    // to be false, which is the one property here that must not be got wrong.
    const columns = /insert into storage\.buckets\s*\(([^)]*)\)/i.exec(bucket)?.[1] ?? '';
    const values = /values\s*\(([\s\S]*?)\)\s*(?:on conflict|;)/i.exec(bucket)?.[1] ?? '';
    const named = columns.split(',').map((column) => column.trim());
    const given = values.split(/,(?![^[\]]*\])/).map((value) => value.trim());

    expect(named.length, 'the bucket insert names no columns').toBeGreaterThan(0);
    expect(given.length, 'the bucket insert values do not line up with its columns').toBe(
      named.length,
    );

    const valueOf = (column: string): string => given[named.indexOf(column)] ?? '';

    expect(valueOf('id'), 'the bucket is not the one the client writes to').toBe(
      "'organization-logos'",
    );
    expect(valueOf('public'), 'the bucket is public, so no policy is consulted at all').toBe(
      'false',
    );
    expect(valueOf('file_size_limit'), 'the bucket has no size bound').toBe('2097152');
    // IDEMPOTENT on the row, so a pre-existing bucket does not abort the whole
    // migration and take the column, the grant and all three policies with it.
    expect(bucket, 'the bucket insert aborts where the bucket already exists').toMatch(
      /on conflict \(id\) do nothing/i,
    );
    expect(bucket, 'a migration silently rewrites an existing bucket properties').not.toMatch(
      /on conflict[\s\S]*do update/i,
    );
    expect(bucket, 'the bucket accepts any type at all').toMatch(
      /allowed_mime_types[\s\S]*?image\/png[\s\S]*?image\/jpeg[\s\S]*?image\/webp/,
    );
    expect(bucket, 'an SVG is a document rather than an image').not.toContain('svg');
  });

  it('pins the tenant in WITH CHECK on both write policies that can set it', () => {
    // Per policy by name, not as a count over the file. A bare count has no
    // margin — the real number is two and the assertion said "at least two" —
    // and it is anonymous: two `with check` clauses on two insert policies
    // would satisfy it while the update policy, the one that can move a row
    // between tenants, had none.
    const insert = policyBody('members_insert_by_own_active_admin');
    const update = policyBody('members_update_by_own_active_admin');

    expect(insert, 'the members insert policy is not declared').not.toBe('');
    expect(update, 'the members update policy is not declared').not.toBe('');

    expect(insert, 'insert has no USING clause to fail, so WITH CHECK is the only refusal').toMatch(
      /with check[\s\S]*organization_id/i,
    );
    expect(update, 'an update must be reachable only inside the caller organization').toMatch(
      /using[\s\S]*organization_id/i,
    );
    expect(
      update,
      'without WITH CHECK on update, an otherwise-legal update can move a row between tenants',
    ).toMatch(/with check[\s\S]*organization_id/i);
  });

  it('pins the tenant on the organizations write policy too, where the tenant is the key', () => {
    // STORY 1.4a. On `organizations` the tenant reference IS the primary key, so
    // the clause names `id` rather than `organization_id` and the block above
    // could not see it: its patterns all require the word `organization_id`, and
    // a policy written `with check (true)` on this table would have satisfied
    // every assertion in this file.
    //
    // Both halves, and both conjuncts of each: the claim pins the tenant, and
    // the helper is what makes `is_active` and `admin` fresh rather than a fact
    // about the moment the token was minted.
    const update = policyBody('organizations_update_by_own_active_admin');

    expect(update, 'the organizations update policy is not declared').not.toBe('');
    expect(update, 'an update must be reachable only on the caller own organization').toMatch(
      /using[\s\S]*id = nullif/i,
    );
    expect(
      update,
      'without WITH CHECK on update, an otherwise-legal update can change the row own identity',
    ).toMatch(/with check[\s\S]*id = nullif/i);
    expect(
      (update.match(/current_member_access\(\)/g) ?? []).length,
      'both USING and WITH CHECK must read the role and active state fresh',
    ).toBe(2);
    expect(
      (update.match(/access\.is_active/g) ?? []).length,
      'a deactivated admin must lose the write on its next statement, not at token expiry',
    ).toBe(2);
    expect(
      (update.match(/access\.member_role = 'admin'/g) ?? []).length,
      'a member-role account must be refused by both clauses',
    ).toBe(2);
  });

  it('bounds which organizations columns authenticated may update, as a grant', () => {
    // A policy constrains ROWS and never columns, so the update policy on its
    // own let an entitled admin write every one of the thirteen — proved live
    // during the 1.4a review, where `update organizations set slug = …` as the
    // pilot's admin reported one row updated. `slug` is the domain part of
    // every issued sign-in address (AD-12), so that is the frozen "Never".
    //
    // The REVOKE is asserted as well as the grant, and it is the half that is
    // easy to lose: a column grant does not narrow a table grant, the two are
    // unioned, so granting five columns while the table grant stood would change
    // nothing whatsoever and look exactly like this.
    const statements = migrationStatements();

    expect(statements, 'the table-wide UPDATE grant is never revoked').toMatch(
      /revoke\s+update\s+on\s+table\s+public\.organizations\s+from\s+authenticated/i,
    );

    // EVERY grant across the tree, unioned — not the first one. Column grants
    // do not narrow each other, so `0005` adds `logo_path` with a second
    // statement rather than by re-granting the five; reading only the first
    // match would report the 1.4a set forever and a later migration could add
    // `slug` in a third statement without this noticing.
    const grants = [
      ...statements.matchAll(
        /grant\s+update\s*\(([\s\S]*?)\)\s*on\s+table\s+public\.organizations\s+to\s+authenticated/gi,
      ),
    ].map((found) => found[1] ?? '');

    expect(grants.length, 'no column-level UPDATE grant on organizations').toBeGreaterThan(0);

    const granted = grants
      .flatMap((columns) => columns.split(','))
      .map((column) => column.trim())
      .filter((column) => column !== '')
      .sort();

    expect(granted, 'the editable column set changed').toEqual([
      // STORY 1.4c. The accent is writable for the same reason `logo_path` is —
      // it is the organization's own branding — and it is a SEVENTH column
      // rather than a sixth form field, on the same disjoint-write shape:
      // `@/organization/snapshot` types the accent write apart from the five
      // identity fields and from the logo, so none of the three can clobber
      // another. What it holds is a KEY and never a colour; `0006` says why.
      'brand_accent',
      'leave_year_start_day',
      'leave_year_start_month',
      // STORY 1.4b. The logo reference is writable because it is the
      // organization's own pointer at its own object — and it is a SIXTH column
      // rather than a sixth form field: `@/organization/snapshot` types the
      // logo write as a shape disjoint from the five, so a save of the identity
      // fields cannot carry it.
      'logo_path',
      'name',
      'organization_type',
      'timezone',
    ]);
    for (const forbidden of ['slug', 'locale', 'id']) {
      expect(granted.join(','), `${forbidden} is writable by authenticated`).not.toContain(
        forbidden,
      );
    }
  });

  it('opens no insert and no delete on organizations, in any migration', () => {
    // FR-2: no product surface creates or destroys a tenant — the operator
    // script in `supabase/operator/` is the only path, and it runs as the owner.
    // Asserted over the whole migration tree rather than over `0004`, because
    // the fear is a LATER file adding one, and the exact-policy-set assertion
    // above would notice the name while saying nothing about what it is for.
    const organizationPolicies = (
      migrationStatements().match(/create policy[\s\S]*?;/gi) ?? []
    ).filter((declaration) => /on public\.organizations\b/i.test(declaration));

    expect(organizationPolicies.length, 'no policy on organizations was found').toBe(2);
    for (const verb of ['insert', 'delete', 'all']) {
      expect(
        organizationPolicies.filter((declaration) =>
          new RegExp(`\\bfor ${verb}\\b`, 'i').test(declaration),
        ),
        `a policy opens ${verb} on organizations; provisioning is an operator task`,
      ).toEqual([]);
    }
  });

  it('appends status versions and never rewrites one, in any migration', () => {
    // STORY 1.6. AD-2 makes active status VERSIONED: a version is a new row,
    // never an update in place, so the table carries a select, an insert and a
    // delete policy and nothing else — and the delete reaches only a version
    // dated after today, which has decided no day yet. An update policy written
    // later would let an admin move a past deactivation, which rewrites past
    // rosters.
    const statusPolicies = (migrationStatements().match(/create policy[\s\S]*?;/gi) ?? []).filter(
      (declaration) => /on public\.member_status_versions\b/i.test(declaration),
    );

    expect(statusPolicies.length, 'no policy on member_status_versions was found').toBe(3);

    const deletes = statusPolicies.filter((declaration) => /\bfor delete\b/i.test(declaration));
    expect(deletes, 'the status table has no single cancellation policy').toHaveLength(1);
    expect(deletes[0], 'a version in effect can be cancelled').toMatch(
      /effective_from > public\.organization_today\(organization_id\)/,
    );
    expect(deletes[0], 'a version other than the latest can be cancelled').toMatch(
      /effective_from = public\.member_latest_version\(member_id\)/,
    );
    expect(deletes[0], 'an admin may cancel a change on their own row').toMatch(
      /self\.auth_user_id = \(select auth\.uid\(\)\)/,
    );

    for (const verb of ['update', 'all']) {
      expect(
        statusPolicies.filter((declaration) => new RegExp(`\\bfor ${verb}\\b`, 'i').test(declaration)),
        `a policy opens ${verb} on member_status_versions; a version is never rewritten`,
      ).toEqual([]);
    }
  });

  it('appends membership versions and never rewrites one, in any migration', () => {
    // STORY 1.7b, the status table's shape copied: select, insert and a delete
    // that reaches only the latest version while it is dated after today. No
    // update policy, and the privilege revoked.
    const statements = migrationStatements();
    const membershipPolicies = (statements.match(/create policy[\s\S]*?;/gi) ?? []).filter(
      (declaration) => /on public\.team_membership_versions\b/i.test(declaration),
    );

    expect(membershipPolicies.length, 'no policy on team_membership_versions was found').toBe(3);

    const deletes = membershipPolicies.filter((declaration) => /\bfor delete\b/i.test(declaration));
    expect(deletes, 'the membership table has no single cancellation policy').toHaveLength(1);
    expect(deletes[0], 'a version in effect can be cancelled').toMatch(
      /effective_from > public\.organization_today\(organization_id\)/,
    );
    expect(deletes[0], 'a version other than the latest can be cancelled').toMatch(
      /effective_from = public\.team_membership_latest_version\(member_id\)/,
    );

    for (const verb of ['update', 'all']) {
      expect(
        membershipPolicies.filter((declaration) =>
          new RegExp(`\\bfor ${verb}\\b`, 'i').test(declaration),
        ),
        `a policy opens ${verb} on team_membership_versions; a version is never rewritten`,
      ).toEqual([]);
    }
    expect(statements, 'the update privilege on team_membership_versions is never revoked').toMatch(
      /revoke update, truncate, references, trigger on table public\.team_membership_versions\s+from anon, authenticated/i,
    );
    expect(statements, 'the four fact columns are not the only insertable ones').toMatch(
      /grant insert \(\s*organization_id,\s*member_id,\s*team_id,\s*effective_from\s*\) on table public\.team_membership_versions to authenticated/i,
    );

    const insert = policyBody('team_membership_versions_insert_by_own_active_admin');
    expect(insert, 'the membership insert policy is not declared').not.toBe('');
    expect(insert, 'the tenant is not pinned from the signed claim').toMatch(
      /with check[\s\S]*organization_id = nullif/i,
    );
    expect(insert, 'role and active state are not re-read').toContain("access.member_role = 'admin'");
    expect(insert, 'the attribution is not pinned to the caller').toMatch(
      /created_by = \(select auth\.uid\(\)\)/,
    );
    expect(insert, 'a past date is admitted').toMatch(
      /effective_from >= public\.organization_today\(organization_id\)/,
    );
    expect(insert, 'a version may be dated on or before the latest one').toMatch(
      /effective_from > coalesce\(public\.team_membership_latest_version\(member_id\)/,
    );
    expect(insert, 'a second change may be scheduled on top of one').toMatch(
      /coalesce\(public\.team_membership_latest_version\(member_id\), '-infinity'::date\)\s*<= public\.organization_today\(organization_id\)/,
    );
    expect(insert, 'a version may leave the team unchanged').toMatch(
      /team_id is distinct from public\.member_team_on\(member_id, 'infinity'::date\)/,
    );
    expect(insert, 'an archived team may be joined').toMatch(/and not team\.archived/);
    expect(insert, 'membership reads status, which is independent of it').not.toMatch(
      /member_active_on|member_status_versions/,
    );
  });

  it('refuses archiving a team anyone is on or scheduled onto, by altering the update policy', () => {
    // STORY 1.7b. ALTERED, never re-created, so the one `create policy` on
    // teams update is still 0009's and the count above holds.
    const statements = migrationStatements();
    const altered = /alter policy teams_update_by_own_active_admin on public\.teams[\s\S]*?;/i.exec(
      statements,
    )?.[0];

    expect(altered, 'the teams update policy is not altered').toBeDefined();
    expect(altered, 'the archive in-use rule is missing').toMatch(
      /\(not archived or not public\.team_in_use\(id\)\)/,
    );
    expect(altered, 'the altered WITH CHECK lost the tenant pin').toMatch(
      /with check[\s\S]*organization_id = nullif/i,
    );
    expect(altered, 'the altered WITH CHECK lost the role re-read').toContain(
      "access.member_role = 'admin'",
    );
    expect(altered, 'the alter touched USING, so archiving may stop being one-way').not.toMatch(
      /\busing\b/i,
    );
  });

  it('narrows the members read to an admin, or the caller its own row, by altering the select policy', () => {
    // STORY 1.8 (CAP-5). ALTERED, never re-created, so the one `create policy`
    // on members select is still 0003's and the count above holds. What each
    // clause does is `test/rls-isolation.test.ts`.
    const statements = migrationStatements();
    const altered =
      /alter policy members_select_own_organization on public\.members[\s\S]*?;/i.exec(
        statements,
      )?.[0];

    expect(altered, 'the members select policy is not altered').toBeDefined();
    expect(altered, 'the altered USING lost the tenant pin').toMatch(
      /using[\s\S]*organization_id = nullif/i,
    );
    expect(altered, 'the altered USING lost the active re-read').toMatch(/where access\.is_active/);
    expect(altered, 'an admin no longer reads the organization').toContain(
      "access.member_role = 'admin'",
    );
    expect(altered, 'a member-role session no longer reads its own row').toMatch(
      /or auth_user_id = \(select auth\.uid\(\)\)/,
    );
    expect(altered, 'the alter touched WITH CHECK on a read policy').not.toMatch(/with check/i);
  });

  it('reads the roster through one definer function that names only id and name', () => {
    // STORY 1.8. Source text only; the matrix is `test/rls-isolation.test.ts`.
    const statements = migrationStatements();
    const roster = /create function public\.team_roster\(team uuid\)[\s\S]*?\$\$;/i.exec(
      statements,
    )?.[0];

    expect(roster, 'team_roster is not declared').toBeDefined();
    expect(roster).toMatch(/\bstable\b/i);
    expect(roster).toMatch(/security definer/i);
    expect(roster).toMatch(/set search_path = ''/);
    expect(roster, 'the roster names a member field besides id and name').toMatch(
      /jsonb_build_object\('id', m\.id, 'name', m\.name\)/,
    );
    expect(roster, 'the roster reads a private column').not.toMatch(
      /\b(email|leave_allowance_days|username|role)\b/,
    );
    expect(statements).toMatch(
      /grant execute on function public\.team_roster\(uuid\) to authenticated;/,
    );
    expect(statements).toMatch(/revoke execute on function public\.team_roster\(uuid\) from anon;/);
  });

  it('archives teams and never deletes one, in any migration', () => {
    // STORY 1.7a. "Remove" always archives: no DELETE policy, the delete
    // privilege revoked, and archiving one-way because the update policy
    // reaches only a row that is not archived yet. Source text only; what each
    // clause does is `test/rls-isolation.test.ts`.
    const statements = migrationStatements();
    const teamPolicies = (statements.match(/create policy[\s\S]*?;/gi) ?? []).filter(
      (declaration) => /on public\.teams\b/i.test(declaration),
    );

    expect(teamPolicies.length, 'no policy on teams was found').toBe(3);
    for (const verb of ['delete', 'all']) {
      expect(
        teamPolicies.filter((declaration) => new RegExp(`\\bfor ${verb}\\b`, 'i').test(declaration)),
        `a policy opens ${verb} on teams; removing a team archives it`,
      ).toEqual([]);
    }
    expect(statements, 'the delete privilege on teams is never revoked').toMatch(
      /revoke[^;]*\bdelete\b[^;]*on table public\.teams\s+from anon, authenticated/i,
    );
    expect(
      statements,
      'a later migration grants delete on teams back',
    ).not.toMatch(/grant[^;]*\bdelete\b[^;]*on table public\.teams\b/i);

    const update = policyBody('teams_update_by_own_active_admin');
    const using = /using\s*\(([\s\S]*?)\)\s*with check/i.exec(update)?.[1] ?? '';

    expect(update, 'the teams update policy is not declared').not.toBe('');
    expect(using, 'an archived team can be renamed or unarchived').toMatch(/\barchived = false\b/);
    expect(update, 'an update may move a team to another tenant').toMatch(
      /with check[\s\S]*organization_id = nullif/i,
    );
    expect(
      (update.match(/access\.member_role = 'admin'/g) ?? []).length,
      'a member-role account is refused by only one of the two update clauses',
    ).toBe(2);

    const insert = policyBody('teams_insert_by_own_active_admin');
    expect(insert, 'the teams insert policy is not declared').not.toBe('');
    expect(insert, 'the tenant is not pinned from the signed claim').toMatch(
      /with check[\s\S]*organization_id = nullif/i,
    );
    expect(insert, 'role and active state are not re-read').toContain("access.member_role = 'admin'");
    expect(insert, 'the attribution is not pinned to the caller').toMatch(
      /created_by = \(select auth\.uid\(\)\)/,
    );

    const read = policyBody('teams_select_own_organization');
    expect(read, 'the teams select policy is not declared').not.toBe('');
    expect(read, 'a member-role account cannot see its own organization teams').not.toContain(
      "member_role = 'admin'",
    );
    expect(read, 'archived teams are hidden from somebody').not.toMatch(/\barchived\b/);
  });

  it('stores an hour band as a name and a start, and derives everything else', () => {
    // STORY 2.1a (AD-3): shape, not validation. The window, duration and
    // midnight flag belong to `packages/domain`, so none is a column here; a
    // stored one could disagree with the starts it is derived from.
    const statements = migrationStatements();
    const table = /create table hour_bands \(([\s\S]*?)\n\);/i.exec(statements)?.[1] ?? '';

    expect(table, 'the hour_bands table is not declared').not.toBe('');
    // EVERY column definition, whatever its type: a line at the table's own
    // indent that opens with an identifier and is not a table constraint. A
    // type allowlist would let `duration_minutes integer` or
    // `crosses_midnight boolean` — exactly the derived values AD-3 forbids
    // storing — slip past unseen.
    const columns = [...table.matchAll(/^[ ]{2}([a-z_][a-z0-9_]*)[ ]+\S/gm)]
      .map((match) => match[1])
      .filter(
        (name) =>
          !['constraint', 'primary', 'unique', 'check', 'foreign', 'exclude'].includes(name ?? ''),
      );
    expect(columns, 'hour_bands stores something beyond a name and a start').toEqual([
      'organization_id',
      'id',
      'name',
      'start_time',
      'created_at',
    ]);
    expect(table, 'a band carries forged-able attribution').not.toMatch(/\bcreated_by\b/);
    expect(table, 'a start is not unique per organization').toMatch(
      /unique \(organization_id, start_time\)/,
    );
    expect(table, 'a start of 24:00 is admitted').toMatch(/check \(start_time < '24:00'\)/);
    expect(table, 'a start with seconds is admitted').toMatch(
      /check \(date_trunc\('minute', start_time\) = start_time\)/,
    );
    expect(table, 'a blank band name is admitted').toMatch(/check \(btrim\(name\) <> ''\)/);
    expect(statements, 'no total unique index scopes a band name to its organization').toMatch(
      /create unique index \w+\s+on hour_bands \(organization_id, lower\(btrim\(name\)\)\);/i,
    );
  });

  it('opens every hour band verb to an active admin of the row own organization alone', () => {
    // STORY 2.1a. Source text only; what each clause does is
    // `test/rls-isolation.test.ts`, which skips without a database.
    const statements = migrationStatements();
    const bandPolicies = (statements.match(/create policy[\s\S]*?;/gi) ?? []).filter(
      (declaration) => /on public\.hour_bands\b/i.test(declaration),
    );
    expect(bandPolicies.length, 'hour_bands does not carry exactly four policies').toBe(4);

    const read = policyBody('hour_bands_select_own_organization');
    expect(read, 'the hour_bands select policy is not declared').toMatch(/for select/);
    expect(read, 'the tenant is not pinned from the signed claim').toMatch(/organization_id = nullif/);
    expect(read, 'active state is not re-read').toContain('access.is_active');
    expect(read, 'a member-role account cannot read its own bands').not.toContain(
      "member_role = 'admin'",
    );

    const writes: readonly [string, string, number][] = [
      ['hour_bands_insert_by_own_active_admin', 'insert', 1],
      ['hour_bands_update_by_own_active_admin', 'update', 2],
      ['hour_bands_delete_by_own_active_admin', 'delete', 1],
    ];
    for (const [name, verb, clauses] of writes) {
      const body = policyBody(name);
      expect(body, `${name} is not declared for ${verb}`).toMatch(new RegExp(`for ${verb}\\b`));
      expect(
        (body.match(/organization_id = nullif/g) ?? []).length,
        `${name} does not pin the tenant in every clause`,
      ).toBe(clauses);
      expect(
        (body.match(/access\.member_role = 'admin'/g) ?? []).length,
        `${name} does not refuse a member-role account in every clause`,
      ).toBe(clauses);
      expect(
        (body.match(/access\.is_active/g) ?? []).length,
        `${name} does not re-read active state in every clause`,
      ).toBe(clauses);
    }

    expect(statements, 'authenticated may insert or update more than the name and start').toMatch(
      /grant insert \(organization_id, name, start_time\) on table public\.hour_bands to authenticated;/,
    );
    expect(statements).toMatch(
      /grant update \(name, start_time\) on table public\.hour_bands to authenticated;/,
    );
    expect(statements, 'anon keeps a privilege on hour_bands').toMatch(
      /revoke all on table public\.hour_bands from anon;/,
    );
    expect(statements, 'a later migration grants anon something on hour_bands').not.toMatch(
      /grant[^;]*on table public\.hour_bands to[^;]*\banon\b/i,
    );
  });

  it('stores a shift type as a name, a working flag and an archive flag, and never deletes one', () => {
    // STORY 2.2a, the teams shape of 1.7a: current-state, archived one-way, no
    // delete. `is_working` is written once, on insert. Source text only; what
    // each clause does is `test/rls-isolation.test.ts`.
    const statements = migrationStatements();
    const table = /create table shift_types \(([\s\S]*?)\n\);/i.exec(statements)?.[1] ?? '';

    expect(table, 'the shift_types table is not declared').not.toBe('');
    // EVERY column definition, whatever its type, as for hour_bands: a stored
    // duration or ramp slot fails here.
    const columns = [...table.matchAll(/^[ ]{2}([a-z_][a-z0-9_]*)[ ]+\S/gm)]
      .map((match) => match[1])
      .filter(
        (name) =>
          !['constraint', 'primary', 'unique', 'check', 'foreign', 'exclude'].includes(name ?? ''),
      );
    expect(columns, 'shift_types stores something beyond its reviewed columns').toEqual([
      'organization_id',
      'id',
      'name',
      'is_working',
      'archived',
      'created_by',
      'created_at',
    ]);
    expect(table, 'is_working has a default, so a type may be created without saying').toMatch(
      /^[ ]{2}is_working boolean not null,$/m,
    );
    expect(table, 'a blank type name is admitted').toMatch(/check \(btrim\(name\) <> ''\)/);
    expect(table, 'nothing gives the versions a composite key to reference').toMatch(
      /unique \(organization_id, id\)/,
    );
    expect(statements, 'no partial unique index scopes a type name to its organization').toMatch(
      /create unique index \w+\s+on shift_types \(organization_id, lower\(btrim\(name\)\)\)\s+where not archived;/i,
    );

    const typePolicies = (statements.match(/create policy[\s\S]*?;/gi) ?? []).filter(
      (declaration) => /on public\.shift_types\b/i.test(declaration),
    );
    expect(typePolicies.length, 'shift_types does not carry exactly three policies').toBe(3);
    for (const verb of ['delete', 'all']) {
      expect(
        typePolicies.filter((declaration) => new RegExp(`\\bfor ${verb}\\b`, 'i').test(declaration)),
        `a policy opens ${verb} on shift_types; removing a type archives it`,
      ).toEqual([]);
    }

    const update = policyBody('shift_types_update_by_own_active_admin');
    const using = /using\s*\(([\s\S]*?)\)\s*with check/i.exec(update)?.[1] ?? '';
    expect(update, 'the shift_types update policy is not declared').not.toBe('');
    expect(using, 'an archived type can be renamed or unarchived').toMatch(/\barchived = false\b/);
    expect(update, 'an update may move a type to another tenant').toMatch(
      /with check[\s\S]*organization_id = nullif/i,
    );
    const check = /with check\s*\(([\s\S]*)\)\s*;/i.exec(update)?.[1] ?? '';
    expect(check, 'a type with a change scheduled may be archived').toMatch(
      /not archived\s+or coalesce\(public\.shift_type_latest_version\(id\), '-infinity'::date\)\s+<= public\.organization_today\(organization_id\)/,
    );
    expect(using, 'the archive rule leaked into USING, so a scheduled type cannot be renamed').not.toMatch(
      /shift_type_latest_version/,
    );
    expect(
      (update.match(/access\.member_role = 'admin'/g) ?? []).length,
      'a member-role account is refused by only one of the two update clauses',
    ).toBe(2);

    const insert = policyBody('shift_types_insert_by_own_active_admin');
    expect(insert, 'the tenant is not pinned from the signed claim').toMatch(
      /with check[\s\S]*organization_id = nullif/i,
    );
    expect(insert, 'role and active state are not re-read').toContain("access.member_role = 'admin'");
    expect(insert, 'the attribution is not pinned to the caller').toMatch(
      /created_by = \(select auth\.uid\(\)\)/,
    );

    const read = policyBody('shift_types_select_own_organization');
    expect(read, 'a member-role account cannot see its own organization types').not.toContain(
      "member_role = 'admin'",
    );
    expect(read, 'archived types are hidden from somebody').not.toMatch(/\barchived\b/);

    expect(statements, 'the delete privilege on shift_types is never revoked').toMatch(
      /revoke insert, update, delete, truncate, references, trigger on table public\.shift_types\s+from anon, authenticated;/i,
    );
    expect(statements, 'authenticated may insert more than tenant, name and working flag').toMatch(
      /grant insert \(organization_id, name, is_working\) on table public\.shift_types to authenticated;/,
    );
    expect(statements, 'authenticated may update more than the name and archive flag').toMatch(
      /grant update \(name, archived\) on table public\.shift_types to authenticated;/,
    );
    expect(statements, 'a later migration grants delete on shift_types back').not.toMatch(
      /grant[^;]*\bdelete\b[^;]*on table public\.shift_types\b/i,
    );
    expect(statements, 'a later migration grants anon something on shift_types').not.toMatch(
      /grant[^;]*on table public\.shift_types to[^;]*\banon\b/i,
    );
  });

  it('stores a shift type version as two times and a date, and derives the duration', () => {
    // STORY 2.2a (AD-3): shape, not validation. The duration and the midnight
    // flag belong to `packages/domain`, so neither is a column here.
    const statements = migrationStatements();
    const table = /create table shift_type_versions \(([\s\S]*?)\n\);/i.exec(statements)?.[1] ?? '';

    expect(table, 'the shift_type_versions table is not declared').not.toBe('');
    const columns = [...table.matchAll(/^[ ]{2}([a-z_][a-z0-9_]*)[ ]+\S/gm)]
      .map((match) => match[1])
      .filter(
        (name) =>
          !['constraint', 'primary', 'unique', 'check', 'foreign', 'exclude'].includes(name ?? ''),
      );
    expect(columns, 'shift_type_versions stores something beyond its reviewed columns').toEqual([
      'organization_id',
      'id',
      'shift_type_id',
      'start_time',
      'end_time',
      'effective_from',
      'created_by',
      'created_at',
    ]);
    expect(table, 'a version may name another tenant type').toMatch(
      /foreign key \(organization_id, shift_type_id\)\s+references shift_types \(organization_id, id\)/,
    );
    for (const column of ['start_time', 'end_time']) {
      expect(table, `${column} of 24:00 is admitted`).toContain(`check (${column} < '24:00')`);
      expect(table, `${column} with seconds is admitted`).toContain(
        `check (date_trunc('minute', ${column}) = ${column})`,
      );
    }
    expect(table, 'an infinite effective_from is admitted').toMatch(
      /check \(isfinite\(effective_from\) and effective_from < date '10000-01-01'\)/,
    );
    expect(table, 'two versions may share a date').toMatch(/unique \(shift_type_id, effective_from\)/);
  });

  it('appends shift type versions and never rewrites one, in any migration', () => {
    // STORY 2.2a, the membership table's rules of 1.7b unchanged: select,
    // insert and a delete that reaches only the latest version while it is
    // dated after today. No update policy, and the privilege revoked.
    const statements = migrationStatements();
    const versionPolicies = (statements.match(/create policy[\s\S]*?;/gi) ?? []).filter(
      (declaration) => /on public\.shift_type_versions\b/i.test(declaration),
    );

    expect(versionPolicies.length, 'shift_type_versions does not carry exactly three policies').toBe(3);

    const deletes = versionPolicies.filter((declaration) => /\bfor delete\b/i.test(declaration));
    expect(deletes, 'the versions table has no single cancellation policy').toHaveLength(1);
    expect(deletes[0], 'a version in effect can be cancelled').toMatch(
      /effective_from > public\.organization_today\(organization_id\)/,
    );
    expect(deletes[0], 'a version other than the latest can be cancelled').toMatch(
      /effective_from = public\.shift_type_latest_version\(shift_type_id\)/,
    );
    expect(deletes[0], 'a member-role account can cancel').toContain("access.member_role = 'admin'");

    for (const verb of ['update', 'all']) {
      expect(
        versionPolicies.filter((declaration) => new RegExp(`\\bfor ${verb}\\b`, 'i').test(declaration)),
        `a policy opens ${verb} on shift_type_versions; a version is never rewritten`,
      ).toEqual([]);
    }
    expect(statements, 'the update privilege on shift_type_versions is never revoked').toMatch(
      /revoke update, truncate, references, trigger on table public\.shift_type_versions\s+from anon, authenticated/i,
    );
    expect(statements, 'the five fact columns are not the only insertable ones').toMatch(
      /grant insert \(\s*organization_id,\s*shift_type_id,\s*start_time,\s*end_time,\s*effective_from\s*\) on table public\.shift_type_versions to authenticated/i,
    );
    expect(statements, 'anon keeps a privilege on shift_type_versions').toMatch(
      /revoke select, insert, delete on table public\.shift_type_versions from anon;/,
    );

    const insert = policyBody('shift_type_versions_insert_by_own_active_admin');
    expect(insert, 'the version insert policy is not declared').not.toBe('');
    expect(insert, 'the tenant is not pinned from the signed claim').toMatch(
      /with check[\s\S]*organization_id = nullif/i,
    );
    expect(insert, 'role and active state are not re-read').toContain("access.member_role = 'admin'");
    expect(insert, 'the attribution is not pinned to the caller').toMatch(
      /created_by = \(select auth\.uid\(\)\)/,
    );
    expect(insert, 'a past date is admitted').toMatch(
      /effective_from >= public\.organization_today\(organization_id\)/,
    );
    expect(insert, 'a version may be dated on or before the latest one').toMatch(
      /effective_from > coalesce\(public\.shift_type_latest_version\(shift_type_id\)/,
    );
    expect(insert, 'a second change may be scheduled on top of one').toMatch(
      /coalesce\(public\.shift_type_latest_version\(shift_type_id\), '-infinity'::date\)\s*<= public\.organization_today\(organization_id\)/,
    );
    expect(insert, 'a version may leave the times unchanged').toMatch(
      /not exists \(\s*select 1\s+from public\.shift_type_times_on\(shift_type_versions\.shift_type_id, 'infinity'::date\) as latest\s+where latest\.start_time = shift_type_versions\.start_time\s+and latest\.end_time = shift_type_versions\.end_time\s*\)/,
    );
    expect(insert, 'the policy reads its own table directly, which recurses (42P17)').not.toMatch(
      /from public\.shift_type_versions\b/,
    );
    expect(insert, 'a non-working or archived type may be given times').toMatch(
      /and shift_type\.is_working\s+and not shift_type\.archived/,
    );
  });

  it('reads shift type versions through two invoker functions with an empty search_path', () => {
    // STORY 2.2a, 0010's readers copied. Source text only; the catalogue is
    // asserted in `test/provisioning.test.ts`.
    const statements = migrationStatements();
    for (const [name, signature] of [
      ['shift_type_latest_version', 'uuid'],
      ['shift_type_times_on', 'uuid, date'],
    ] as const) {
      const body = new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i').exec(
        statements,
      )?.[0];
      expect(body, `${name} is not declared`).toBeDefined();
      expect(body).toMatch(/\bvolatile\b/i);
      expect(body).toMatch(/security invoker/i);
      expect(body).toMatch(/set search_path = ''/);
      expect(statements).toContain(`grant execute on function public.${name}(${signature}) to authenticated;`);
      expect(statements).toContain(`revoke execute on function public.${name}(${signature}) from anon;`);
    }
    expect(
      readFileSync(join(supabaseRoot, 'migrations', '0013_shift_types.sql'), 'utf8'),
      'story 2.2a takes no trigger',
    ).not.toMatch(/create (or replace )?trigger/i);
  });

  it('keeps a team name unique among active teams only, and never blank', () => {
    // The partial index is what lets an archived team's name be reused; a
    // total one would refuse it, and a case-sensitive one would admit a
    // duplicate differing only in case.
    const statements = migrationStatements();

    expect(statements, 'no unique index scopes a team name to its organization').toMatch(
      /create unique index \w+\s+on teams \(organization_id, lower\(btrim\(name\)\)\)\s+where not archived;/i,
    );
    expect(statements, 'a blank team name is admitted').toMatch(/check \(btrim\(name\) <> ''\)/);
    expect(statements, 'nothing gives 1.7b a composite key to reference').toMatch(
      /unique \(organization_id, id\)/,
    );
  });

  it('refuses a past date, an out-of-order or redundant version, the caller own row and the last active admin in the insert policy', () => {
    // Source text only; what each clause does is `test/rls-isolation.test.ts`.
    // Asserted here as well because that file skips without a database, and
    // each clause is one line a later edit could drop in a diff that still
    // reads as a policy.
    const insert = policyBody('member_status_versions_insert_by_own_active_admin');

    expect(insert, 'the status insert policy is not declared').not.toBe('');
    expect(insert, 'the tenant is not pinned from the signed claim').toMatch(
      /with check[\s\S]*organization_id = nullif/i,
    );
    expect(insert, 'role and active state are not re-read').toContain("access.member_role = 'admin'");
    expect(insert, 'the attribution is not pinned to the caller').toMatch(
      /created_by = \(select auth\.uid\(\)\)/,
    );
    expect(insert, 'a past date is admitted').toMatch(
      /effective_from >= public\.organization_today\(organization_id\)/,
    );
    expect(insert, 'an admin may deactivate their own row').toMatch(
      /self\.auth_user_id = \(select auth\.uid\(\)\)/,
    );
    expect(insert, 'a version may be dated on or before the latest one').toMatch(
      /effective_from > coalesce\(public\.member_latest_version\(member_id\)/,
    );
    expect(insert, 'a second change may be scheduled on top of one').toMatch(
      /coalesce\(public\.member_latest_version\(member_id\), '-infinity'::date\)\s*<= public\.organization_today\(organization_id\)/,
    );
    expect(insert, 'a version may change nothing').toMatch(
      /active is distinct from public\.member_active_on\(member_id, 'infinity'::date\)/,
    );
    expect(
      insert,
      'the last active admin is not read as another admin active on every date from the change',
    ).toContain('public.member_active_from(admin.id, member_status_versions.effective_from)');
  });

  it('confines the access token hook to the auth service', () => {
    // A URI naming a function that the wrong roles may call is configuration
    // that looks right and hands the owner's rights to a session; a URI naming
    // one the auth service may NOT call breaks every sign-in. The database-side
    // half of this — the actual ACL — is asserted in
    // `test/provisioning.test.ts`.
    // Over `migrationStatements()` rather than `allMigrations()`: every grant
    // and revoke below is also *described* in a comment a line or two above it
    // in `0003`, so matching the raw file would let the prose satisfy the
    // assertion on its own. Same reason the rest of this block strips comments.
    const migrations = migrationStatements();

    expect(migrations, 'nothing grants the auth service execute on the hook').toMatch(
      /grant execute on function public\.custom_access_token_hook\(jsonb\) to supabase_auth_admin/i,
    );

    // Supabase's default privileges grant EXECUTE on a new function in `public`
    // to each of these individually, so revoking PUBLIC alone leaves all of
    // them holding it.
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      expect(migrations, `the hook is still executable by ${role}`).toMatch(
        new RegExp(
          `revoke execute on function public\\.custom_access_token_hook\\(jsonb\\) from ${role}`,
          'i',
        ),
      );
    }
  });
});

describe('the local auth provider configuration', () => {
  /**
   * `key = value` within one `[section]` of config.toml, unquoted.
   *
   * A hand-rolled reader rather than a TOML parser, because the only thing this
   * file needs is a handful of scalar values and a dependency for that would be
   * a dependency to keep. It strips the surrounding quotes from a string value:
   * a caller asserting against `'"pg-functions://…"'` would be baking this
   * reader's shortcomings into its own expected value.
   *
   * Note what it does NOT do: it ignores every section it was not asked about,
   * so a new section in config.toml is unenforced until something names it.
   */
  function setting(section: string, key: string): string | undefined {
    const config = readFileSync(join(supabaseRoot, 'config.toml'), 'utf8');
    let current = '';
    for (const line of config.split('\n')) {
      const header = /^\[([^\]]+)\]/.exec(line.trim());
      if (header !== null) {
        current = header[1] ?? '';
        continue;
      }
      if (current !== section) continue;
      const pair = new RegExp(`^${key}\\s*=\\s*(\\S+)`).exec(line.trim());
      if (pair !== null) return (pair[1] ?? '').replace(/^"(.*)"$/, '$1');
    }
    return undefined;
  }

  it('leaves the email provider on while open signup stays refused', () => {
    // Two switches with confusingly similar names, and only one of them is the
    // signup door. `[auth] enable_signup` becomes GOTRUE_DISABLE_SIGNUP and
    // refuses self-registration; `[auth.email] enable_signup` becomes
    // GOTRUE_EXTERNAL_EMAIL_ENABLED and turns the email/password provider off
    // entirely. With the second one false a provisioned admin cannot sign in
    // at all — a password grant answers 422 "Email logins are disabled" — and
    // signup is no more refused than it already was.
    expect(
      setting('auth.email', 'enable_signup'),
      'the email/password provider must be on, or every admin-issued credential is unusable',
    ).toBe('true');

    expect(
      setting('auth', 'enable_signup'),
      'there is no open signup anywhere in this system',
    ).toBe('false');

    expect(
      setting('auth', 'enable_anonymous_sign_ins'),
      'an anonymous session has no organization, so it has no business existing',
    ).toBe('false');
  });

  it('enables the custom access token hook and points it at the migrated function', () => {
    // The reader above walks `[section]` headers and silently ignores every
    // section it was not asked about, so a new section in config.toml is
    // unenforced until something asks for it by name. AD-10's organization
    // claim exists only because this hook runs, and nothing else in the
    // repository would notice the section being deleted.
    expect(
      setting('auth.hook.custom_access_token', 'enabled'),
      'without the hook no token carries organization_id, and every policy reads zero rows',
    ).toBe('true');

    // The URI names the database, the schema and the function, and the function
    // is created by a migration — so this string and that migration have to
    // agree or every sign-in fails on a missing function.
    expect(
      setting('auth.hook.custom_access_token', 'uri'),
      'the hook URI names the database, schema and function GoTrue will call',
    ).toBe('pg-functions://postgres/public/custom_access_token_hook');
    expect(
      migrationStatements(),
      'the hook URI names a function no migration creates',
    ).toMatch(/create function public\.custom_access_token_hook\(event jsonb\)/i);
  });
});
