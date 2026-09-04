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

/**
 * Every source file whose content must be reflected in the build.
 *
 * MUTATION-PROVEN GAP. The list held only the four localization sources, so
 * removing the boot fallback from `index.html` and running the suite WITHOUT
 * rebuilding left both of this story's new guards silent — the ordinary state
 * of a working tree, where the last build predates the last edit. The three
 * files 1.1d added are in scope now, and so is the boot module, whose
 * `LOCALIZATION_INIT_FAILED` marker is asserted in the chunk below.
 *
 * `index.html` is a build INPUT rather than an import: Vite processes it into
 * `dist/index.html` on every build, so its mtime belongs here for the same
 * reason `hr.json`'s does.
 */
const SOURCES = [
  join(webRoot, 'index.html'),
  join(webRoot, 'src', 'main.tsx'),
  join(webRoot, 'src', 'i18n', 'index.ts'),
  join(webRoot, 'src', 'i18n', 'boot.ts'),
  join(webRoot, 'src', 'i18n', 'format.ts'),
  join(webRoot, 'src', 'i18n', 'locales', 'hr.json'),
  join(webRoot, 'src', 'routes', 'prijava.tsx'),
  join(webRoot, 'src', 'routes', 'not-found.tsx'),
];

/**
 * Every built JavaScript chunk, whose names carry content hashes.
 *
 * `.endsWith('.js')` excludes `dist/assets/*.js.map` by construction, and that
 * exclusion is deliberate rather than incidental: a sourcemap contains the
 * ENTIRE original source — every comment, every explanation of why a reserved
 * word is absent — so sweeping it would report a vocabulary offence for prose
 * and make the whole sweep unusable. What ships to a browser and renders is the
 * chunk. (That the map ships at all is a deploy question, recorded in
 * deferred-work.md.)
 */
function chunkPaths(): string[] {
  const chunks = readdirSync(assets).filter((name) => name.endsWith('.js'));
  expect(chunks.length, 'expected at least one built chunk').toBeGreaterThan(0);

  return chunks.map((name) => join(assets, name));
}

/** The entry chunk. One today; named separately from the sweep below so a
 *  future code-split does not silently narrow what the sweep reads. */
function entryChunkPath(): string {
  const chunks = chunkPaths();
  expect(chunks.length, 'expected exactly one built entry chunk').toBe(1);

  return chunks[0] ?? '';
}

function entryChunk(): string {
  return readFileSync(entryChunkPath(), 'utf8');
}

/** The concatenation of every chunk, for the vocabulary sweeps: a literal
 *  hard-coded into a lazily split component is in the build just the same. */
function allChunks(): string {
  return chunkPaths()
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
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
  // `skipIf` rather than an early `return`: a build-less checkout must report
  // these as SKIPPED, not green having asserted nothing. The early-return form
  // was the one shape in this file that still reported a pass on no evidence.
  it.skipIf(notBuilt).each(WIRING_MARKERS)('$name', ({ marker }) => {
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
 * A failed boot leaves the fallback on screen and mounts nothing (story 1.1d).
 *
 * The failure is unreachable from test code: resources are bundled, `init`
 * performs no I/O, and the only throw inside it would be a malformed resource
 * caught at build. AD-15 also rules out driving `main.tsx` in a DOM. So what is
 * asserted is the SHAPE of the handling — that the mount is inside the success
 * branch and the code reaches the shipped chunk — because the alternative
 * shape, `catch` and mount anyway, paints `⟦auth.heading⟧` over every string on
 * the screen and looks like a broken product rather than a failed boot.
 */
describe('a rejected initialization does not mount the application', () => {
  /**
   * POLARITY lives in `apps/web/src/i18n/boot.test.ts`, which executes the
   * decision — reject, synchronous throw and resolve — because a source-text
   * assertion structurally cannot see which branch renders. That was the
   * MUTATION-PROVEN GAP: rewriting the boot as `try`/`catch` around the render
   * mounted the application on a failed init with 900 tests green.
   *
   * What is left here is the two claims that test cannot make: that `main.tsx`
   * still routes the decision through that module rather than deciding again
   * inline, and that the module reached the shipped chunk at all.
   */
  const main = (): string =>
    readFileSync(join(webRoot, 'src', 'main.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[\s;,{}()[\]])\/\/[^\n]*/g, '$1');

  it('delegates the decision rather than taking it inline', () => {
    // Comment-blind: this file explains the decision in prose at length, and
    // the prose would otherwise satisfy every assertion here on its own.
    const source = main();
    const gate = source.indexOf('await bootLocalization(initLocalization)');
    const mount = source.indexOf('createRoot(');

    expect(gate, 'main.tsx no longer boots through @/i18n/boot').toBeGreaterThan(-1);
    expect(mount, 'the mount is not inside the boot gate').toBeGreaterThan(gate);
  });

  it('holds no failure handling of its own, which is what regressed before', () => {
    // The mutation rewrote this file as `try { await init(); render() } catch`.
    // Both halves of that shape are refused: the module may not catch, and it
    // may not call `initLocalization` except through the boot module.
    const source = main();

    expect(source).not.toContain('catch');
    expect(source).not.toMatch(/(?<!bootLocalization\()\binitLocalization\(/);
  });

  it.skipIf(notBuilt)('ships the handling, so it is not source-only', () => {
    expect(entryChunk()).toContain('LOCALIZATION_INIT_FAILED');
  });
});

/**
 * Acceptance criterion 6, corrected and automated — and re-derived by story
 * 1.1d, which is what made half of it false.
 *
 * As originally written — "the built bundle holds no user-facing text beyond
 * the existing `<title>`" — the criterion was false by construction: the two
 * ICU plural messages are user-facing text and MUST be in the bundle, which is
 * the whole point of bundling the resource file. `# dana`, `konflikata` and
 * `⟦` are all present and all correct.
 *
 * The real rule, and the one worth enforcing, is that the resource file is the
 * ONLY place user-facing Croatian enters the build. The vocabulary was one flat
 * list of nineteen words asserted ABSENT from the chunk; five of them are the
 * sign-in screen's, so absence is no longer the right claim for those — they
 * are in `hr.json`, `hr.json` is bundled, and it must be.
 *
 * So the list is partitioned rather than shortened, and the five authored words
 * are held to a COUNT instead: each may appear in the chunk exactly as many
 * times as it appears in the resource file, and no more. That is the assertion
 * "absent" was standing in for — a literal hard-coded into a component would
 * push the count above the resource's own, and a word deleted from `hr.json`
 * while a component kept saying it would too. The fourteen that belong to the
 * navigation shell and the terminology contract keep the absence assertion
 * until the spec that owns them lands.
 */

/** The five words story 1.1d authors, so the chunk may hold them — but only
 *  from `hr.json`. */
const AUTHORED_VOCABULARY = [
  'Prijava',
  'Prijavi',
  'Lozinka',
  'Korisničko',
  'Zaboravljena',
];

/** Everything the navigation shell and the terminology contract still own.
 *  None of it may reach the build. */
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
  'Odjava',
  'Nema',
  'Spremi',
  'Odustani',
];

/** The static Croatian in `index.html` (story 1.1d): the boot fallback, shown
 *  when localization init rejects or the bundle never loads at all. It cannot
 *  come from a key, because the translation layer is what failed. */
const BOOT_FALLBACK = 'Shift se nije pokrenuo. Osvježi stranicu.';

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function resourceSource(): string {
  return readFileSync(join(webRoot, 'src', 'i18n', 'locales', 'hr.json'), 'utf8');
}

describe('the resource file is the only user-facing Croatian in the build', () => {
  // `skipIf` rather than an early `return`, in both sweeps: the early-return
  // form reported green on a build-less checkout having read nothing.
  it.skipIf(notBuilt).each(NAVIGATION_AND_TERMINOLOGY)('does not ship the literal %s', (word) => {
    expect(
      allChunks().includes(word),
      `${word} is in a built chunk — a screen literal has been hard-coded instead of added to hr.json (L1/L2)`,
    ).toBe(false);
  });

  it.skipIf(notBuilt).each(AUTHORED_VOCABULARY)('ships %s only from the resource file', (word) => {
    const inChunk = occurrences(allChunks(), word);
    const inResource = occurrences(resourceSource(), word);

    // Both directions matter. Above the resource count means a component
    // hard-codes the word as well; below it means the chunk is stale or the
    // resource never reached it, which the freshness guard and the wiring
    // markers would also catch but not by name.
    expect(inResource, `${word} is in this list but not in hr.json`).toBeGreaterThan(0);
    expect(
      inChunk,
      `${word} appears ${inChunk} time(s) across the built chunks and ${inResource} time(s) in hr.json — the difference is a hard-coded literal (L1/L2)`,
    ).toBe(inResource);
  });

  it.skipIf(notBuilt)('ships the two sanctioned messages, so the sweep is not vacuous', () => {
    // Guard: if the chunk were unreadable or empty, every assertion above would
    // pass having proved nothing at all.
    const chunk = allChunks();

    expect(chunk.length).toBeGreaterThan(1000);
    expect(chunk).toContain('dan');
    expect(chunk).toContain('konflikt');
  });

  it.skipIf(notBuilt)('reads every chunk, not the entry alone', () => {
    // Vacuous-pass guard on the sweep's own reach. There is one chunk today, so
    // this is a claim about the mechanism rather than the current output: a
    // `chunkPaths` narrowed back to a single hard-coded name would make a
    // literal in a lazily split component invisible.
    expect(chunkPaths().length).toBeGreaterThan(0);
    expect(allChunks().length).toBeGreaterThanOrEqual(entryChunk().length);
  });

  it('counts occurrences the way the sweep above assumes', () => {
    // Detector self-test. An `occurrences` that always returned 0 would make
    // every count assertion above compare 0 to 0 and pass on any chunk.
    expect(occurrences('aXbXc', 'X')).toBe(2);
    expect(occurrences('abc', 'X')).toBe(0);
    expect(occurrences('', 'X')).toBe(0);
  });

  it('keeps the title and the boot fallback as the only literals in the HTML', () => {
    const html = join(webRoot, 'dist', 'index.html');
    if (!existsSync(html)) return;

    const source = readFileSync(html, 'utf8');

    expect(source).toContain('<title>Shift</title>');
    // `lang="hr"` is 1.1a's and stays; anything else user-facing would be new.
    expect(source).toContain('lang="hr"');
    // The fallback is the deliberate exception, and it is asserted PRESENT:
    // deleting it returns the boot-failure case to a blank page at HTTP 200,
    // which is the defect it exists to close.
    expect(
      source,
      'the boot fallback is missing from index.html — a failed boot renders a blank page again',
    ).toContain(BOOT_FALLBACK);
    // Inside the #root ELEMENT, matched as markup rather than by string index.
    // `indexOf` only proved the text came later in the file, which is also true
    // of a fallback in the footer — and one placed outside #root is never
    // cleared, so it stays on screen behind a perfectly healthy application.
    const rootBody = /<div id="root">([\s\S]*?)<\/div>/.exec(source)?.[1];

    expect(rootBody, 'no #root element in the built HTML').not.toBeUndefined();
    expect(
      rootBody,
      'the boot fallback sits outside #root, so a successful mount never clears it',
    ).toContain(BOOT_FALLBACK);
    // Hidden until the boot has actually taken too long. Painted from first
    // paint it showed a Croatian error telling the user to refresh on every
    // slow load, including the ones about to succeed.
    expect(source, 'the fallback is revealed immediately again').toMatch(/opacity:\s*0/);
    // The fallback carries no reserved word and no authored word: it is
    // untranslated by necessity, so it must not become a second home for
    // vocabulary that belongs in hr.json.
    for (const word of [...NAVIGATION_AND_TERMINOLOGY, ...AUTHORED_VOCABULARY]) {
      expect(source, `${word} is in index.html`).not.toContain(word);
    }
  });
});
