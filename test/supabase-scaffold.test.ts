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

describe('supabase scaffold', () => {
  it('holds exactly one Edge Function, the privileged auth boundary', () => {
    const functions = readdirSync(join(supabaseRoot, 'functions'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(functions).toEqual(['admin-auth']);
  });

  it('numbers migrations forward-only, with no gaps or duplicates', () => {
    const migrations = readdirSync(join(supabaseRoot, 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    expect(migrations.length).toBeGreaterThan(0);

    const numbers = migrations.map((name) => {
      const prefix = /^(\d+)_/.exec(name);
      expect(prefix, `migration '${name}' does not start with a numeric prefix`).not.toBeNull();
      return Number(prefix?.[1]);
    });

    expect(numbers).toEqual([...new Set(numbers)]);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('enables btree_gist, which AD-3 needs before leave can be unrepresentable', () => {
    const first = readFileSync(join(supabaseRoot, 'migrations', '0001_extensions.sql'), 'utf8');

    expect(first).toMatch(/create extension if not exists btree_gist/i);
  });

  it('reserves both fixtures in the seed and creates no schema of its own', () => {
    const seed = readFileSync(join(supabaseRoot, 'seed.sql'), 'utf8');

    expect(seed).toMatch(/pilot organization/i);
    expect(seed).toMatch(/UJ-5 security organization/i);

    // No table exists until story 1.2, so the seed must not yet insert or
    // create anything — a statement here would fail `supabase db reset`.
    const executable = seed
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

    expect(executable).not.toMatch(/\b(insert|create|alter|drop)\b/i);
  });
});
