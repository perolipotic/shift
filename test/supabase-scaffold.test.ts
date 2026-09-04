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
      expect(migrations, `${table} must be deny-all until story 1.3 writes its policies`).toMatch(
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

  it('declares no policy at all, because story 1.3 owns every one of them', () => {
    // EXPECTED TO BE DELETED IN STORY 1.3. That story writes the RLS policies
    // and the role helper, and the first one it writes makes this assertion
    // wrong by construction — remove it then rather than weakening it, and let
    // 1.3's own two security tests be the check. Until then a permissive policy
    // written early stays invisible until the story that was supposed to author
    // it, which is exactly when nobody is looking.
    expect(allMigrations()).not.toMatch(/create policy/i);
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

describe('the local auth provider configuration', () => {
  /** `key = value` within one `[section]` of config.toml. */
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
      if (pair !== null) return pair[1];
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

    expect(setting('auth', 'enable_anonymous_sign_ins')).toBe('false');
  });
});
