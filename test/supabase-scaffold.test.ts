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

  it('declares exactly the six policies stories 1.3a and 1.4a reviewed, and no seventh', () => {
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
      'members_delete_by_own_active_admin',
      'members_insert_by_own_active_admin',
      'members_select_own_organization',
      'members_update_by_own_active_admin',
      'organizations_select_own_organization',
      'organizations_update_by_own_active_admin',
    ]);
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

    const granted =
      /grant\s+update\s*\(([\s\S]*?)\)\s*on\s+table\s+public\.organizations\s+to\s+authenticated/i.exec(
        statements,
      )?.[1] ?? '';

    expect(granted, 'no column-level UPDATE grant on organizations').not.toBe('');
    expect(
      granted
        .split(',')
        .map((column) => column.trim())
        .filter((column) => column !== '')
        .sort(),
      'the editable column set changed',
    ).toEqual([
      'leave_year_start_day',
      'leave_year_start_month',
      'name',
      'organization_type',
      'timezone',
    ]);
    for (const forbidden of ['slug', 'locale', 'id']) {
      expect(granted, `${forbidden} is writable by authenticated`).not.toContain(forbidden);
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
