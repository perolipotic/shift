import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BLOCK_COMMENT,
  HTML_COMMENT,
  LINE_DASH,
  LINE_HASH,
  LINE_SLASH,
  collectFiles,
} from './source-scan.ts';

/**
 * AD-17 — the secret key exists only in the Edge Functions' per-environment
 * env (admin-auth, and notify for its two RPCs).
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

/**
 * How many trailing key characters make an occurrence key MATERIAL, DERIVED
 * from the pattern above rather than restated.
 *
 * The built-bundle scans read the same threshold, and a second copy of `20`
 * would let the two drift: raising the pattern's bound while a hard-coded
 * literal stayed behind would leave a window in which a value is short enough
 * for the per-occurrence check and long enough to be a key.
 */
const KEY_MATERIAL_LENGTH = Number(/\{(\d+),\}/.exec(PLAUSIBLE_KEY.source)?.[1]);


// --------------------------------------------------------------- comment rules
// The patterns themselves live in `test/source-scan.ts`, shared by the root
// source scans; which pattern applies to which file type is this file's own.

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
// `collectFiles` and its skip list live in `test/source-scan.ts`.

const byExtension =
  (...extensions: readonly string[]) =>
  (file: string): boolean =>
    extensions.includes(extname(file));

/** Where the build lands, and whether it is there at all. */
const distRoot = join(repoRoot, 'apps', 'web', 'dist');
const notBuilt = collectFiles(distRoot, byExtension('.js')).length === 0;
/**
 * Everything a build emits that a key could ride out in.
 *
 * ONE definition, because the relaxed bundle scan and the assertion that
 * justifies relaxing it must read the same files. They did not: the scan took
 * `.js|.css|.html|.map` and its justification took `.js`, so the three
 * occurrences of the prefix in the sourcemap were covered by the loosened
 * regex and by no claim about why the loosening is safe.
 */
const BUNDLE_EXTENSIONS = byExtension('.js', '.css', '.html', '.map');

/**
 * The build output for the two scans that read it.
 *
 * `pnpm test` does not build and `dist/` is gitignored, so "nothing to scan" is
 * the ordinary state of a fresh checkout. The two scans below are gated on
 * `notBuilt` with `it.skipIf` rather than failing, which is the same answer
 * `test/localization-applied.test.ts` reaches and for the reason it states: a
 * stale build is a wrong answer while an absent one is merely no answer. What
 * must never happen is the third thing — reporting a PASS having read nothing,
 * which is what the removed `if (…) return;` guards did.
 *
 * The assertion stays as a floor rather than being dropped: `skipIf` is
 * evaluated once at collection time, so a `dist` that disappears between then
 * and the run would otherwise land back in the vacuous case.
 */
function builtFiles(keep: (file: string) => boolean): string[] {
  const built = collectFiles(distRoot, keep);

  expect(
    built.length,
    `nothing to scan in ${relative(repoRoot, distRoot)} — run \`pnpm build\` first; the narrowed secret-key scans rest on this output and must not report a pass without it`,
  ).toBeGreaterThan(0);

  return built;
}

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

  it.skipIf(notBuilt)('is absent from the built bundle', () => {
    // NARROWED by story 1.3b, which put `@supabase/supabase-js` in the bundle
    // for the first time. The library's own key-format check reads
    // `e.startsWith('sb_publishable_') || e.startsWith('sb_secret_')`, so the
    // PREFIX is now in every build as vendored source — and the old bare
    // `includes` reported the built chunk and its sourcemap as leaks.
    //
    // The narrowing is to the fear rather than away from it. What may not reach
    // a browser is a secret KEY VALUE, and `PLAUSIBLE_KEY` is exactly that
    // claim: the prefix followed by a long run of key characters, the same
    // standard the repository-wide committed-file scan above already applies. A
    // real key inlined through a misnamed `VITE_*` variable still matches it,
    // while a string comparison against the prefix does not. Our own env NAME
    // stays absent outright — nothing in the client tree has any business
    // reading it, which the naming scans prove at source.
    //
    // FAILS rather than returns when there is nothing to read. The early return
    // this used to carry reported green on no evidence, and it did so in
    // exactly the state the narrowing is least safe in: `pnpm test` does not
    // build, so an unbuilt or half-cleaned `dist` silently retired the only
    // assertion standing between a relaxed check and a shipped key.
    const built = builtFiles(BUNDLE_EXTENSIONS);

    const offences = built.filter((file) => {
      const contents = readFileSync(file, 'utf8');
      return PLAUSIBLE_KEY.test(contents) || contents.includes(SECRET_ENV_NAME);
    });

    expect(show(offences)).toEqual([]);
  });

  it.skipIf(notBuilt)('carries the prefix only as a library key-shape check, never as a value', () => {
    // The other half of the narrowing, and what keeps it honest: the reason the
    // assertion above was relaxed is a claim about WHY `sb_secret_` is in the
    // bundle, so that claim is asserted rather than assumed. Every occurrence
    // must be followed by too little to be key material — which is what a
    // `startsWith` comparison looks like and what an inlined key never does.
    //
    // Neither the missing-build case nor the no-occurrence case is skipped
    // quietly. If the prefix ever leaves the bundle the narrowing is no longer
    // needed, and this failing is how anybody finds that out: the strict
    // `includes` check belongs back in the test above.
    // THE SAME EXTENSION SET the relaxed scan above reads, and that pairing is
    // the point: this test is the entire justification for widening that one
    // from a bare `includes` to `PLAUSIBLE_KEY`, so anything the relaxation
    // covers has to be covered here or the narrowing applies to files nothing
    // checks the claim on. It read `.js` only while the scan above read
    // `.js|.css|.html|.map`, and the prefix occurs three times in the
    // sourcemap — so every occurrence outside a chunk was held to the
    // ≥20-character regex and to nothing else.
    const chunks = builtFiles(BUNDLE_EXTENSIONS);
    const naming = chunks.filter((chunk) => readFileSync(chunk, 'utf8').includes(SECRET_VALUE_PREFIX));

    expect(
      naming.length,
      `no built chunk names ${SECRET_VALUE_PREFIX} any more — the narrowing in the test above has nothing left to justify it, so restore the strict includes check`,
    ).toBeGreaterThan(0);

    for (const chunk of naming) {
      const contents = readFileSync(chunk, 'utf8');
      const followed = [
        ...contents.matchAll(new RegExp(`${SECRET_VALUE_PREFIX}([A-Za-z0-9_-]*)`, 'g')),
      ];

      expect(followed.length, `${relative(repoRoot, chunk)} lost the prefix`).toBeGreaterThan(0);
      for (const [, trailing = ''] of followed) {
        expect(
          trailing.length,
          `${relative(repoRoot, chunk)} carries ${SECRET_VALUE_PREFIX}${trailing} — that is key material, not a shape check`,
        ).toBeLessThan(KEY_MATERIAL_LENGTH);
      }
    }
  });
});

/**
 * AD-17, amended by story 10.1: the email provider key, the notify invoke
 * secret and the VAPID private key live only in `notify`'s environment.
 *
 * Supabase function secrets are per PROJECT, so `admin-auth` receives the
 * values too; the guarantee is that nothing but `supabase/functions/notify/`
 * names them in code. The operator-facing places that must name them —
 * DEPLOY.md, the functions' `.env.example` and the deploy action — are
 * asserted to, so a rename cannot leave the runbook behind.
 */
const NOTIFY_SECRET_NAMES = ['RESEND_API_KEY', 'NOTIFY_INVOKE_SECRET', 'VAPID_PRIVATE_KEY'] as const;

/** The one directory permitted to read the notify secrets. */
const NOTIFY_DIRECTORY = join(repoRoot, 'supabase', 'functions', 'notify');

/**
 * A plausible Resend key: `re_` at a word start, then a long run of key
 * characters. The documented placeholder (`re_...`) and the test fixture
 * (`re_test`) are far shorter.
 */
const PLAUSIBLE_RESEND_KEY = /\bre_[A-Za-z0-9_-]{20,}/;

function namesANotifySecret(file: string): boolean {
  const code = stripComments(file, readFileSync(file, 'utf8'));
  return NOTIFY_SECRET_NAMES.some((name) => code.includes(name));
}

describe('notify secret hygiene (story 10.1)', () => {
  it('names no notify secret in the client tree or the workspace configuration', () => {
    const clientFiles = [
      ...collectFiles(join(repoRoot, 'apps'), byExtension(...CODE_EXTENSIONS)),
      ...collectFiles(join(repoRoot, 'packages'), byExtension(...CODE_EXTENSIONS)),
      ...readdirSync(repoRoot)
        .map((entry) => join(repoRoot, entry))
        .filter((file) => statSync(file).isFile())
        .filter((file) => CODE_EXTENSIONS.includes(extname(file)) || basename(file) === '.npmrc'),
    ];

    expect(clientFiles.length).toBeGreaterThan(0);
    expect(show(clientFiles.filter(namesANotifySecret))).toEqual([]);
  });

  it('is read only inside the notify function, never by admin-auth, a migration or config.toml', () => {
    const supabaseFiles = collectFiles(join(repoRoot, 'supabase'), byExtension('.ts', '.sql', '.toml'));
    const readers = supabaseFiles.filter(namesANotifySecret);

    // Non-empty guard: the function must still read them, or this passes on nothing.
    expect(readers.length).toBeGreaterThan(0);
    expect(show(readers.filter((file) => !file.startsWith(NOTIFY_DIRECTORY)))).toEqual([]);
  });

  it('keeps the secret values out of every migration: the cron job reads them from Vault by name', () => {
    const migrations = collectFiles(join(repoRoot, 'supabase', 'migrations'), byExtension('.sql'));
    const outbox = migrations.find((file) => basename(file) === '0042_notification_outbox.sql');

    expect(outbox, '0042 is missing').toBeDefined();
    const code = stripComments(outbox ?? '', readFileSync(outbox ?? '', 'utf8'));
    expect(code).toContain("s.name = 'notify_url'");
    expect(code).toContain("s.name = 'notify_invoke_secret'");
    expect(code, 'a migration creates a Vault secret, so its value would be committed').not.toMatch(
      /vault\.(create|update)_secret/,
    );
  });

  it('names every notify secret in DEPLOY.md, the functions .env.example and the deploy action', () => {
    for (const relativePath of [
      'DEPLOY.md',
      join('supabase', 'functions', '.env.example'),
      join('.github', 'actions', 'deploy', 'action.yml'),
    ]) {
      const text = readFileSync(join(repoRoot, relativePath), 'utf8');
      for (const name of NOTIFY_SECRET_NAMES) {
        expect(text, `${relativePath} does not name ${name}`).toContain(name);
      }
    }
  });

  it('holds no plausible Resend key value in any committed file', () => {
    const inScope = byExtension(...CODE_EXTENSIONS, ...PROSE_EXTENSIONS);
    const committed = (trackedFiles() ?? collectFiles(repoRoot, inScope))
      .filter(inScope)
      .filter((file) => existsSync(file));

    expect(committed.length).toBeGreaterThan(0);
    expect(show(committed.filter((file) => PLAUSIBLE_RESEND_KEY.test(readFileSync(file, 'utf8'))))).toEqual([]);
  });

  it('tells a Resend key from a placeholder, both polarities', () => {
    expect(PLAUSIBLE_RESEND_KEY.test(`re_${'a'.repeat(8)}_${'B'.repeat(24)}`)).toBe(true);
    expect(PLAUSIBLE_RESEND_KEY.test('re_...')).toBe(false);
    expect(PLAUSIBLE_RESEND_KEY.test('re_test')).toBe(false);
    expect(PLAUSIBLE_RESEND_KEY.test(`store_${'a'.repeat(30)}`)).toBe(false);
  });
});

/**
 * Story 10.4 (AD-17, amended): the VAPID boundary. The private key is named
 * by `notify` and by the files that deploy it, and nowhere else; the SPA may
 * name the PUBLIC key's build variable, `VITE_VAPID_PUBLIC_KEY`, and so may
 * the scripts and the action that set it, and nothing on the server side.
 * Tests and planning documents are out of scope: they name what they pin.
 */
describe('the VAPID boundary (story 10.4)', () => {
  /** Every committed or new (not ignored) file outside the tests and the planning output. */
  function inScope(): string[] {
    let listed: string[];
    try {
      listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
        .split('\0')
        .filter((entry) => entry !== '');
    } catch {
      listed = collectFiles(repoRoot, () => true).map((file) => relative(repoRoot, file));
    }
    return listed
      .filter((entry) => !entry.startsWith('test/') && !entry.startsWith('_bmad') && !entry.startsWith('.claude/'))
      .filter((entry) => !/\.(?:test|spec)\.tsx?$/.test(entry) && !entry.endsWith('.png') && entry !== 'pnpm-lock.yaml')
      .filter((entry) => existsSync(join(repoRoot, entry)) && statSync(join(repoRoot, entry)).isFile());
  }

  const naming = (name: string): string[] =>
    inScope().filter((entry) => readFileSync(join(repoRoot, entry), 'utf8').includes(name));

  it('names VAPID_PRIVATE_KEY only in notify, the deploy files and DEPLOY.md', () => {
    const allowed = (entry: string): boolean =>
      entry.startsWith('supabase/functions/notify/') ||
      [
        'supabase/functions/.env.example',
        '.github/actions/deploy/action.yml',
        '.github/workflows/pipeline.yml',
        'scripts/ci/require-config.mjs',
        'DEPLOY.md',
      ].includes(entry);
    const found = naming('VAPID_PRIVATE_KEY');

    expect(found, 'nothing names it, so this passes on nothing').toContain('supabase/functions/notify/handler.ts');
    expect(found.filter((entry) => !allowed(entry))).toEqual([]);
  });

  it('names VITE_VAPID_PUBLIC_KEY only in the SPA, scripts/ci, the deploy action and DEPLOY.md', () => {
    const allowed = (entry: string): boolean =>
      entry.startsWith('apps/web/') ||
      entry.startsWith('scripts/ci/') ||
      ['.github/actions/deploy/action.yml', 'DEPLOY.md'].includes(entry);
    const found = naming('VITE_VAPID_PUBLIC_KEY');

    expect(found).toContain('apps/web/src/features/notifications/services/page-push.ts');
    expect(found.filter((entry) => !allowed(entry))).toEqual([]);
    // The SPA reads the PUBLIC key alone: no private key's name anywhere under apps/.
    expect(naming('VAPID_PRIVATE_KEY').filter((entry) => entry.startsWith('apps/'))).toEqual([]);
  });
});

describe('secret key hygiene: the scanner itself', () => {
  // Comment-stripping that swallowed too much would make every naming assertion
  // above pass vacuously, so each rule is proved to strip its own comments and
  // to leave every other language's syntax alone.

  it('derives the key-material bound rather than trusting it, and notices when it cannot', () => {
    // The one detector in this file with no self-test, in the file that proves
    // every other one on both polarities. `KEY_MATERIAL_LENGTH` is PARSED out
    // of `PLAUSIBLE_KEY.source` with `/\{(\d+),\}/`, so an open-ended bound is
    // the only shape it can read: rewrite the regex as `{20,64}` and the exec
    // returns null, `Number(undefined)` is `NaN`, and every `toBeLessThan(NaN)`
    // above fails for a reason that has nothing to do with keys — which is a
    // confusing way to discover a one-character edit three lines away.
    expect(Number.isInteger(KEY_MATERIAL_LENGTH), 'the bound is not a number at all').toBe(true);
    expect(KEY_MATERIAL_LENGTH).toBe(20);
    expect(PLAUSIBLE_KEY.source).toContain(`{${String(KEY_MATERIAL_LENGTH)},}`);

    // Both polarities of the bound itself: the regex must match key material of
    // exactly this length and refuse one character less.
    expect(PLAUSIBLE_KEY.test(SECRET_VALUE_PREFIX + 'a'.repeat(KEY_MATERIAL_LENGTH))).toBe(true);
    expect(PLAUSIBLE_KEY.test(SECRET_VALUE_PREFIX + 'a'.repeat(KEY_MATERIAL_LENGTH - 1))).toBe(
      false,
    );
  });

  it('reads every artifact a build emits, not only its chunks', () => {
    // The pairing this file's narrowing rests on: the relaxed scan and the
    // assertion justifying it must agree on which files they read. A sourcemap
    // carries the same strings as the chunk it maps, so `.map` in one set and
    // not the other is a real hole rather than a tidiness point.
    for (const artifact of ['a.js', 'a.css', 'a.html', 'a.js.map']) {
      expect(BUNDLE_EXTENSIONS(artifact), `${artifact} is not scanned`).toBe(true);
    }

    expect(BUNDLE_EXTENSIONS('a.txt'), 'the bundle scan reaches outside the build').toBe(false);
  });

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
