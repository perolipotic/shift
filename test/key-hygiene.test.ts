import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * AD-17 — the secret key exists in exactly one place: the admin-auth Edge
 * Function's per-environment env.
 *
 * Two different fears, so two different scans:
 *
 *   - NAMING. Nothing in the client tree or the workspace configuration may
 *     reference the secret at all, and within `supabase/` only the function may.
 *     That is what makes a leak into the bundle impossible rather than merely
 *     absent today. Comment-aware, because prose documenting the secret's
 *     absence — as `vite-env.d.ts` does — is exactly what we want to keep
 *     writing, and matching it would punish the fix.
 *   - KEY MATERIAL. No committed file anywhere may hold a plausible key value.
 *     DEPLOY.md names "a committed file, or a migration" as the feared paths, so
 *     this scan covers the whole repository and is deliberately comment-BLIND:
 *     a real key pasted into a comment is still a leaked key.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** The one directory permitted to name the secret key. */
const PRIVILEGED_DIRECTORY = join(repoRoot, 'supabase', 'functions');

const SECRET_VALUE_PREFIX = 'sb_secret_';
const SECRET_ENV_NAME = 'SHIFT_SECRET_KEY';

/**
 * A plausible key value: the prefix followed by a long run of key characters.
 * Real secret keys carry ~40; the documented placeholders (`sb_secret_*`,
 * `sb_secret_...`) and the short test fixtures carry far fewer, so they pass.
 */
const PLAUSIBLE_KEY = new RegExp(`${SECRET_VALUE_PREFIX}[A-Za-z0-9_-]{20,}`);

// --------------------------------------------------------------- comment rules

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** `//` to end of line. The leading class keeps `http://` in a string intact. */
const LINE_SLASH = /(^|[\s;,{}()[\]])\/\/[^\n]*/g;
/** `--` to end of line. SQL only: in TypeScript this is the decrement operator. */
const LINE_DASH = /(^|[\s;,()])--[^\n]*/g;
/** `#` to end of line, for the configuration formats that use it. */
const LINE_HASH = /(^|[\s])#[^\n]*/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Comment syntax by file type. Applying one language's rule to another file is
 * how a scanner goes quietly blind: the SQL `--` rule against TypeScript erases
 * everything after `return --i`, and against CSS everything after a custom
 * property such as `--brand`, hiding any secret later on that line.
 */
const COMMENT_RULES: Readonly<Record<string, readonly RegExp[]>> = {
  '.ts': [BLOCK_COMMENT, LINE_SLASH],
  '.tsx': [BLOCK_COMMENT, LINE_SLASH],
  '.js': [BLOCK_COMMENT, LINE_SLASH],
  '.mjs': [BLOCK_COMMENT, LINE_SLASH],
  '.css': [BLOCK_COMMENT],
  '.sql': [BLOCK_COMMENT, LINE_DASH],
  '.html': [HTML_COMMENT],
  '.toml': [LINE_HASH],
  '.yaml': [LINE_HASH],
  '.yml': [LINE_HASH],
  '.npmrc': [LINE_HASH],
  '.json': [],
};

/** Keyed by extension, or by basename for the dotfiles that have none. */
function commentRulesFor(file: string): readonly RegExp[] {
  return COMMENT_RULES[extname(file)] ?? COMMENT_RULES[basename(file)] ?? [];
}

function stripComments(file: string, source: string): string {
  return commentRulesFor(file).reduce(
    (text, rule) => text.replace(rule, (...groups) => (typeof groups[1] === 'string' ? groups[1] : ' ')),
    source,
  );
}

// ------------------------------------------------------------- file collection

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.temp',
  '.branches',
  // Vendored BMAD tooling: not our source, and not shipped.
  '_bmad',
]);

function collectFiles(directory: string, keep: (file: string) => boolean): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...collectFiles(absolute, keep));
    } else if (keep(absolute)) {
      found.push(absolute);
    }
  }
  return found;
}

const byExtension =
  (...extensions: readonly string[]) =>
  (file: string): boolean =>
    extensions.includes(extname(file));

/**
 * The files git actually tracks.
 *
 * The key-material scan below is about *committed* files, so it must ask git
 * rather than walk the working tree. Walking it instead reports every ignored
 * local file — and DEPLOY.md §1 tells every developer to create exactly one of
 * those, `supabase/functions/.env`, holding a real secret key. A scan that
 * failed on it would punish following the runbook, and the fix a developer
 * reached for would be to stop running the test.
 */
function trackedFiles(): string[] | null {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0')
      .filter((entry) => entry !== '')
      .map((entry) => join(repoRoot, entry));
  } catch {
    // Not a git work tree (a tarball export, say). Fall back to the walk.
    return null;
  }
}

const show = (files: readonly string[]): string[] => files.map((file) => relative(repoRoot, file));

/** Every language whose comment rules are defined — the naming scan's scope. */
const CODE_EXTENSIONS = Object.keys(COMMENT_RULES).filter((key) => key.startsWith('.'));

/** Text formats a committed key could hide in, beyond the code extensions. */
const PROSE_EXTENSIONS = ['.md', '.example', '.local', '.txt', '.csv', '.lock', ''];

function namesTheSecret(file: string): boolean {
  const code = stripComments(file, readFileSync(file, 'utf8'));
  return code.includes(SECRET_VALUE_PREFIX) || code.includes(SECRET_ENV_NAME);
}

// ------------------------------------------------------------------- the scans

describe('secret key hygiene: naming', () => {
  it('is named nowhere in the client tree or the workspace configuration', () => {
    const clientFiles = [
      ...collectFiles(join(repoRoot, 'apps'), byExtension(...CODE_EXTENSIONS)),
      ...collectFiles(join(repoRoot, 'packages'), byExtension(...CODE_EXTENSIONS)),
      // Root-level configuration: it feeds the build, so it is client tree too.
      ...readdirSync(repoRoot)
        .map((entry) => join(repoRoot, entry))
        .filter((file) => statSync(file).isFile())
        .filter((file) => CODE_EXTENSIONS.includes(extname(file)) || basename(file) === '.npmrc'),
    ];

    expect(clientFiles.length).toBeGreaterThan(0);
    expect(show(clientFiles.filter(namesTheSecret))).toEqual([]);
  });

  it('is read only inside the privileged Edge Function, never by a migration or by config.toml', () => {
    // `.sql` and `.toml` are in scope on purpose: a migration and the CLI config
    // are both committed, both applied to production, and neither may name it.
    const supabaseFiles = collectFiles(
      join(repoRoot, 'supabase'),
      byExtension('.ts', '.sql', '.toml'),
    );

    expect(supabaseFiles.length).toBeGreaterThan(0);

    const readers = supabaseFiles.filter(namesTheSecret);

    // Non-empty guard: if the function stopped reading it, this assertion would
    // otherwise pass by having nothing left to check.
    expect(readers.length).toBeGreaterThan(0);
    expect(show(readers.filter((file) => !file.startsWith(PRIVILEGED_DIRECTORY)))).toEqual([]);
  });
});

describe('secret key hygiene: key material', () => {
  it('holds no plausible key value in any committed file', () => {
    const inScope = byExtension(...CODE_EXTENSIONS, ...PROSE_EXTENSIONS);
    const tracked = trackedFiles();
    const committed = (tracked ?? collectFiles(repoRoot, inScope))
      .filter(inScope)
      .filter((file) => existsSync(file));

    expect(committed.length).toBeGreaterThan(0);

    // No comment stripping: a real key in a comment is still a leaked key.
    const offences = committed.filter((file) => PLAUSIBLE_KEY.test(readFileSync(file, 'utf8')));

    expect(show(offences)).toEqual([]);
  });

  it('exposes no build-time variable that could carry it', () => {
    // Vite inlines every VITE_* variable into the bundle. A secret reaching the
    // client would have to arrive through one, so none may be shaped like one.
    const example = readFileSync(join(repoRoot, 'apps', 'web', '.env.example'), 'utf8');
    const declared = [...example.matchAll(/^(VITE_[A-Z0-9_]+)=(.*)$/gm)];

    expect(declared.length).toBeGreaterThan(0);
    for (const [, name, value] of declared) {
      expect(name).not.toMatch(/SECRET/);
      expect(value ?? '').not.toContain(SECRET_VALUE_PREFIX);
    }
  });

  it('is absent from the built bundle', () => {
    const dist = join(repoRoot, 'apps', 'web', 'dist');
    const built = collectFiles(dist, byExtension('.js', '.css', '.html', '.map'));

    // A clean checkout has not built yet, and a partial build may hold no
    // matching file. Either way there is nothing to scan, and the source scans
    // above are the ones that make the leak impossible rather than absent.
    if (built.length === 0) return;

    const offences = built.filter((file) => {
      const contents = readFileSync(file, 'utf8');
      return contents.includes(SECRET_VALUE_PREFIX) || contents.includes(SECRET_ENV_NAME);
    });

    expect(show(offences)).toEqual([]);
  });
});

describe('secret key hygiene: the scanner itself', () => {
  // Comment-stripping that swallowed too much would make every naming assertion
  // above pass vacuously, so each rule is proved to strip its own comments and
  // to leave every other language's syntax alone.

  it('strips the comment syntax each language actually has', () => {
    expect(stripComments('a.ts', '/* sb_secret_prose */')).not.toContain('sb_secret_prose');
    expect(stripComments('a.ts', '// sb_secret_prose')).not.toContain('sb_secret_prose');
    expect(stripComments('a.css', '/* sb_secret_prose */')).not.toContain('sb_secret_prose');
    expect(stripComments('a.sql', '-- sb_secret_prose')).not.toContain('sb_secret_prose');
    expect(stripComments('a.html', '<!-- sb_secret_prose -->')).not.toContain('sb_secret_prose');
    expect(stripComments('a.toml', '# sb_secret_prose')).not.toContain('sb_secret_prose');
    expect(stripComments('.npmrc', '# sb_secret_prose')).not.toContain('sb_secret_prose');
  });

  it('keeps a secret that is actually referenced in code', () => {
    expect(stripComments('a.ts', "const k = 'sb_secret_leak'; // note")).toContain('sb_secret_leak');
    expect(stripComments('a.sql', "select 'sb_secret_leak'; -- note")).toContain('sb_secret_leak');
    expect(stripComments('a.html', '<p>sb_secret_leak</p><!-- note -->')).toContain('sb_secret_leak');
    expect(stripComments('a.toml', 'key = "sb_secret_leak" # note')).toContain('sb_secret_leak');
  });

  it('does not apply one language’s comment rule to another’s syntax', () => {
    // The defect this replaces: the SQL `--` rule ran against every extension,
    // so a decrement operator or a CSS custom property erased the rest of the
    // line and hid any secret that followed it.
    expect(
      stripComments('a.ts', "let n = 2; n = n --1; const k = 'sb_secret_leak';"),
    ).toContain('sb_secret_leak');
    expect(
      stripComments('a.css', ':root { --brand: oklch(0 0 0); content: "sb_secret_leak"; }'),
    ).toContain('sb_secret_leak');
    // And the HTML rule does not run against TypeScript, where `<!--` cannot
    // open a comment but can appear inside a template literal.
    expect(stripComments('a.ts', "const t = `<!-- sb_secret_leak -->`;")).toContain(
      'sb_secret_leak',
    );
    // `#` opens no comment in TypeScript either.
    expect(stripComments('a.ts', "const h = '# sb_secret_leak';")).toContain('sb_secret_leak');
  });

  it('recognises a plausible key value and forgives a documented placeholder', () => {
    // Assembled at runtime rather than written as one literal: the key-material
    // scan above is comment-blind and covers this file too, so a verbatim
    // key-shaped string here would — correctly — be reported as a leak.
    const syntheticKey = SECRET_VALUE_PREFIX + '9xQv2LmP4rTz8WcN6bKdA1sYfH3eJu0G';

    expect(PLAUSIBLE_KEY.test(syntheticKey)).toBe(true);
    expect(PLAUSIBLE_KEY.test('sb_secret_*')).toBe(false);
    expect(PLAUSIBLE_KEY.test('sb_secret_...')).toBe(false);
    expect(PLAUSIBLE_KEY.test('a value starting with sb_secret_ here is a defect')).toBe(false);
  });
});
