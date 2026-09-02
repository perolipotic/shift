import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The Supabase scaffold's shape: forward-only migrations, a seed carrying both
 * fixtures, and exactly one Edge Function (AD-14, AD-15).
 *
 * These are structural assertions. Whether `supabase db reset` actually applies
 * the migration and loads the seed is a live-database check, and it lives in
 * DEPLOY.md because it needs Docker rather than a test runner.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const supabaseRoot = join(repoRoot, 'supabase');

/** `0001_extensions.sql` — four digits, then the name. */
const MIGRATION_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

describe('supabase scaffold', () => {
  it('holds exactly one Edge Function, the privileged auth boundary', () => {
    const functions = readdirSync(join(supabaseRoot, 'functions'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(functions).toEqual(['admin-auth']);
  });

  it('numbers migrations 0001, 0002, … with no gaps and no duplicates', () => {
    const migrations = readdirSync(join(supabaseRoot, 'migrations')).filter((name) =>
      name.endsWith('.sql'),
    );

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

  it('reserves both fixtures in the seed and creates no schema of its own', () => {
    const seed = readFileSync(join(supabaseRoot, 'seed.sql'), 'utf8');

    expect(seed).toMatch(/pilot organization/i);
    expect(seed).toMatch(/UJ-5 security organization/i);

    // EXPECTED TO BE DELETED IN STORY 1.2. No table exists until then, so any
    // statement here would fail `supabase db reset`. Once 1.2 lands the real
    // fixture inserts, this assertion is wrong by construction — remove it
    // rather than weakening it, and let `supabase db reset` be the check.
    const executable = seed
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

    expect(executable).not.toMatch(
      /\b(insert|create|alter|drop|update|delete|copy|truncate|grant|revoke|do)\b/i,
    );
  });
});
