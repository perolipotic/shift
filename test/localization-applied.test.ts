import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The localization layer is not only built but actually WIRED (story 1.1c).
 *
 * This is the assertion whose absence let the layer ship unreachable. Code
 * review deleted `await initLocalization()`, the `<I18nextProvider>` wrapper
 * and both imports from `main.tsx`, and the result built clean, linted clean,
 * type-checked clean and passed all 648 tests — because every localization
 * assertion in the suite imports `t` and the formatters DIRECTLY, and none of
 * them cares whether the application ever calls them. That is exactly the shape
 * of story 1.1b's loopback, where all 46 theme tokens were defined and the
 * built stylesheet consumed none of them.
 *
 * Source-level assertions structurally cannot see this: the question is whether
 * the SHIPPED chunk contains the wiring, which is a property of the build. So
 * every marker below was chosen empirically — built once with the wiring and
 * once with it removed, keeping only strings that vanish in the second build.
 *
 * `apps/web/src/i18n/format.test.ts` covers the module's behaviour; this covers
 * its reachability. Both are needed and neither substitutes.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const webRoot = join(repoRoot, 'apps', 'web');
const assets = join(webRoot, 'dist', 'assets');
// `dist` can exist while `assets` does not, after a partial or cleaned build.
const notBuilt = !existsSync(assets);

/** Every source file whose content must be reflected in the built chunk. */
const SOURCES = [
  join(webRoot, 'src', 'main.tsx'),
  join(webRoot, 'src', 'i18n', 'index.ts'),
  join(webRoot, 'src', 'i18n', 'format.ts'),
  join(webRoot, 'src', 'i18n', 'locales', 'hr.json'),
];

/** The built entry chunk, whose name carries a content hash. */
function entryChunkPath(): string {
  const chunks = readdirSync(assets).filter((name) => name.endsWith('.js'));
  expect(chunks.length, 'expected exactly one built entry chunk').toBe(1);

  return join(assets, chunks[0] ?? '');
}

function entryChunk(): string {
  return readFileSync(entryChunkPath(), 'utf8');
}

/**
 * Freshness, asserted before content.
 *
 * `pnpm test` does not build (`package.json`: `pnpm -r test && vitest run`, no
 * `pretest`), `dist/` is gitignored, and there is no CI — so without this, a
 * `dist` produced before the last edit to `main.tsx` satisfies every assertion
 * below and the wiring could be deleted without a single test noticing.
 *
 * This FAILS rather than skips, because a stale build is a wrong answer while an
 * absent one is merely no answer — the reasoning `test/theme-applied.test.ts`
 * established. Note the same coarse-mtime caveat recorded in deferred-work.md
 * applies here, and its resolution will cover both files.
 */
describe('the build being read reflects the current localization source', () => {
  it.skipIf(notBuilt)('is newer than every source it was built from', () => {
    const built = statSync(entryChunkPath()).mtimeMs;

    for (const source of SOURCES) {
      expect(
        built,
        `dist is older than ${source} — run \`pnpm build\`; these assertions would otherwise pass against stale output`,
      ).toBeGreaterThan(statSync(source).mtimeMs);
    }
  });
});

/**
 * Markers, grouped by the half of the wiring each one proves. Every string here
 * was measured present with the wiring and ABSENT without it — a marker that
 * survives the deletion proves nothing and does not belong.
 */
const WIRING_MARKERS: { name: string; marker: string; proves: string }[] = [
  {
    name: 'the resource file reached the bundle',
    marker: '# dana',
    proves: 'hr.json is imported and not tree-shaken away',
  },
  {
    name: 'both resource messages reached it',
    marker: 'konflikata',
    proves: 'the whole resource object ships, not just the first key',
  },
  {
    name: 'the messages ship as ICU plurals',
    marker: 'plural',
    proves: 'L7 is resolved by ICU rather than a count === 1 branch',
  },
  {
    name: 'init is called with the missing-key handler',
    marker: 'parseMissingKeyHandler',
    proves: 'L5 degradation is configured in the shipped build',
  },
  {
    name: 'init is called with the format-error handler',
    marker: 'parseErrorHandler',
    proves: 'an unformattable message degrades instead of leaking ICU source',
  },
  {
    name: 'the ICU plugin is configured',
    marker: 'i18nFormat',
    proves: 'the ICU backend is wired, not merely installed',
  },
  {
    name: 'the single locale is declared',
    marker: 'supportedLngs',
    proves: 'initLocalization() itself is in the graph',
  },
  {
    name: 'the missing-key placeholder ships',
    marker: '⟦',
    proves: 'missingKeyPlaceholder survived tree-shaking',
  },
  {
    name: 'the provider receives the instance',
    marker: 'i18n:',
    proves:
      'the I18nextProvider prop is emitted — the only marker of the provider that survives minification, since react-i18next has no distinctive runtime string left',
  },
];

describe('the shipped bundle carries the localization wiring', () => {
  it.each(WIRING_MARKERS)('$name', ({ marker }) => {
    if (notBuilt) return;

    expect(
      entryChunk().includes(marker),
      `the built chunk is missing ${JSON.stringify(marker)} — the localization layer is built but not reachable from the application`,
    ).toBe(true);
  });

  it.skipIf(notBuilt)('ships the i18next runtime, not just the call sites', () => {
    // Sanity on magnitude: i18next plus ICU plus intl-messageformat is ~80 kB
    // of the chunk. A build that had dropped them while keeping a stray marker
    // would be far smaller, and this notices without pinning an exact size.
    expect(statSync(entryChunkPath()).size).toBeGreaterThan(300_000);
  });
});

/**
 * Acceptance criterion 6, corrected and automated.
 *
 * As originally written — "the built bundle holds no user-facing text beyond
 * the existing `<title>`" — the criterion was false by construction: the two
 * ICU plural messages are user-facing text and MUST be in the bundle, which is
 * the whole point of bundling the resource file. `# dana`, `konflikata` and
 * `⟦` are all present and all correct.
 *
 * The real rule, and the one worth enforcing, is that the resource file is the
 * ONLY place user-facing Croatian enters the build. So the vocabulary below is
 * everything story 1.1d and the navigation shell will introduce: if any of it
 * appears before 1.1d has authored its resource entries, a literal has been
 * written into a component and the L2 lint rule missed it.
 */
const NAVIGATION_AND_TERMINOLOGY = [
  'Danas',
  'Kalendar',
  'Godišnji',
  'Raspored',
  'Ljudi',
  'Organizacija',
  'Postavke',
  'Smjena',
  'Smjene',
  'smjena',
  'Prijava',
  'Prijavi',
  'Odjava',
  'Lozinka',
  'Korisničko',
  'Zaboravljena',
  'Nema',
  'Spremi',
  'Odustani',
];

describe('the resource file is the only user-facing Croatian in the build', () => {
  it.each(NAVIGATION_AND_TERMINOLOGY)('does not ship the literal %s', (word) => {
    if (notBuilt) return;

    expect(
      entryChunk().includes(word),
      `${word} is in the built chunk — a screen literal has been hard-coded instead of added to hr.json (L1/L2)`,
    ).toBe(false);
  });

  it.skipIf(notBuilt)('ships the two sanctioned messages, so the sweep is not vacuous', () => {
    // Guard: if the chunk were unreadable or empty, every assertion above would
    // pass having proved nothing at all.
    const chunk = entryChunk();

    expect(chunk.length).toBeGreaterThan(1000);
    expect(chunk).toContain('dan');
    expect(chunk).toContain('konflikt');
  });

  it('keeps the document title as the one literal in the HTML', () => {
    const html = join(webRoot, 'dist', 'index.html');
    if (!existsSync(html)) return;

    const source = readFileSync(html, 'utf8');

    expect(source).toContain('<title>Shift</title>');
    // `lang="hr"` is 1.1a's and stays; anything else user-facing would be new.
    expect(source).toContain('lang="hr"');
    for (const word of NAVIGATION_AND_TERMINOLOGY) {
      expect(source, `${word} is in index.html`).not.toContain(word);
    }
  });
});
