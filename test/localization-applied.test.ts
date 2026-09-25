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
  // The organization prompt at bare `/prijava`, and `/`. A `.tsx` carrying a
  // string that is absent from this list is swept by nothing — the freshness
  // guard would not notice a build that predates it.
  //
  // `/` IS HERE FOR FRESHNESS ALONE, and no longer for the reason 1.3b added
  // it: it renders no heading and no string at all now, it decides where a
  // signed-in person belongs and redirects. It stays listed because it is still
  // wiring the built chunk depends on — the redirect target and the forward are
  // behaviour a stale build would misreport — not because it carries a key.
  join(webRoot, 'src', 'routes', 'prijava-organizacija.tsx'),
  join(webRoot, 'src', 'routes', 'index.tsx'),
  // The sign-in steps' shared frame (visual refresh A), which renders the
  // brand panel's three strings around both steps.
  join(webRoot, 'src', 'components', 'auth-layout.tsx'),
  // NOT `.tsx`, and that is the point. This list guards build FRESHNESS, and
  // the file that owns `auth.error.credentials` and `auth.error.unavailable` is
  // a plain module: story 1.3b moved the failure-to-message pairing out of the
  // screen and into `sign-in.ts` precisely so a node test could execute it, and
  // then added that file to `prijava.test.ts`'s KEY_SOURCES while leaving it
  // out of here. So the one file invented to hold message keys was swept for
  // keys and not for staleness — edit `signInMessageKey`, skip the build, and
  // every chunk sweep below reads output that predates the edit and passes.
  //
  // Its two neighbours join it for the same reason rather than a different one:
  // `client.ts` and `address.ts` hold the stable codes the screens import and
  // log, so a chunk built before an edit to either is equally stale.
  join(webRoot, 'src', 'supabase', 'sign-in.ts'),
  join(webRoot, 'src', 'supabase', 'client.ts'),
  join(webRoot, 'src', 'supabase', 'address.ts'),
  // The navigation shell's route skeleton: the pathless layout plus the eight
  // titled destinations. Every one of the eight renders a `nav.*` label, and
  // those eight words are held to a COUNT in `AUTHORED_VOCABULARY` below — a
  // count read off a chunk built before the screen existed compares the
  // resource file against output that never saw it, which is the exact
  // staleness this list exists to refuse. The layout renders no string of its
  // own and is here anyway: it is what puts the eight in the graph at all, so
  // a build predating it has none of them.
  join(webRoot, 'src', 'routes', '_app.tsx'),
  join(webRoot, 'src', 'routes', 'danas.tsx'),
  join(webRoot, 'src', 'routes', 'kalendar.tsx'),
  join(webRoot, 'src', 'routes', 'sati.tsx'),
  join(webRoot, 'src', 'routes', 'godisnji.tsx'),
  join(webRoot, 'src', 'routes', 'raspored.tsx'),
  join(webRoot, 'src', 'routes', 'ljudi.tsx'),
  join(webRoot, 'src', 'routes', 'postavke-rotacije.tsx'),
  join(webRoot, 'src', 'routes', 'organizacija.tsx'),
  // Story 1.4a's two modules. `organizacija.tsx` above is no longer a
  // placeholder and `messages.ts` owns four `t()` keys the way `sign-in.ts`
  // owns two — so a chunk built before an edit to either compares `hr.json`
  // against output that never saw it, which is the staleness this list refuses.
  // `snapshot.ts` renders nothing and is here for the same reason `client.ts`
  // is: it holds the stable codes the screen imports and logs.
  join(webRoot, 'src', 'organization', 'snapshot.ts'),
  join(webRoot, 'src', 'organization', 'messages.ts'),
  // Story 1.4b's module. `logo.ts` renders nothing and is here for the reason
  // `snapshot.ts` is: it holds the stable codes `messages.ts` pairs with keys,
  // and it owns the `accept` hint the screen imports rather than writes — so a
  // chunk built before an edit to it compares `hr.json` against output that
  // never saw the four logo messages.
  join(webRoot, 'src', 'organization', 'logo.ts'),
  // Story 1.4c's two. `accent.ts` owns five `t()` keys as a return-type union,
  // exactly as `messages.ts` does, AND the Tailwind class literals the tint is
  // made of — so a chunk built before an edit to it compares `hr.json` against
  // output that never saw the accent names. `lockup.tsx` is the component that
  // renders `organization.lockup`, and it renders in the chrome as well as on
  // the settings surface, which makes a stale build here wrong on every
  // signed-in screen rather than on one.
  join(webRoot, 'src', 'organization', 'accent.ts'),
  join(webRoot, 'src', 'organization', 'lockup.tsx'),
  // The one signed-URL read behind every lockup. It renders nothing and is here
  // for the reason `snapshot.ts` and `client.ts` are: it holds the query key,
  // the cache bound and the stable code both surfaces now depend on, so a chunk
  // built before an edit to it is stale in a way no vocabulary sweep can see.
  join(webRoot, 'src', 'organization', 'logo-url.ts'),
  // The navigation chrome, part B. `chrome.tsx` is the only thing in the
  // application that renders a `nav.*` label more than once — every destination
  // appears in the tab bar and in the sidebar — and the eight words are held to
  // a COUNT in `AUTHORED_VOCABULARY` below, so a chunk built before it existed
  // compares `hr.json` against output that never saw the component doing the
  // rendering. `_app.tsx` is already listed above and is what puts the chrome in
  // the graph at all.
  //
  // The other four render nothing and are here for the reason `snapshot.ts` and
  // `client.ts` are: `role.ts` and `sign-out.ts` own the stable codes,
  // `messages.ts` owns the two `t()` keys those codes resolve to, and `icons.ts`
  // is what pulls `lucide-react` into the bundle — so a chunk built before an
  // edit to any of them is stale in a way the vocabulary sweeps cannot see.
  join(webRoot, 'src', 'navigation', 'destinations.ts'),
  join(webRoot, 'src', 'navigation', 'chrome.tsx'),
  join(webRoot, 'src', 'navigation', 'icons.ts'),
  join(webRoot, 'src', 'navigation', 'messages.ts'),
  join(webRoot, 'src', 'navigation', 'role.ts'),
  join(webRoot, 'src', 'supabase', 'sign-out.ts'),
  // Story 1.5a's member list. `routes/ljudi.tsx` is already listed above with
  // the other seven destinations, and it is no longer a placeholder: it renders
  // a table, a search field, a level filter and a refusal, so a chunk built
  // before an edit to it compares `hr.json` against output that never saw any
  // of them.
  //
  // `members/list.ts` renders nothing and is here for the reason `snapshot.ts`
  // and `accent.ts` are — and more so than either: it owns the stable codes,
  // AND the two-key refusal mapping, AND the two permission-level labels, AND
  // the three counted filter options, AND the column table whose four `label`
  // entries are the headings. Eleven of this story's fourteen keys reach the
  // build through this one module, so a chunk built before an edit to it is
  // stale in a way no vocabulary sweep could see.
  //
  // `components/ui/table.tsx` is vendored and text-free, and it is listed for
  // freshness rather than for strings: it is what puts a `<table>` in the graph
  // at all, so a build predating it has no member list to sweep.
  join(webRoot, 'src', 'members', 'list.ts'),
  join(webRoot, 'src', 'components', 'ui', 'table.tsx'),
  // Story 1.5b's three. `members/write.ts` renders nothing and is here for the
  // reason `members/list.ts` is, and more so: it owns the ELEVEN refusal keys
  // the two forms show, as a return-type union plus one named constant, so a
  // chunk built before an edit to it compares `hr.json` against output that
  // never saw any of them.
  //
  // The two screens are `.tsx` that render — twelve keys between them — and
  // neither is a destination, so neither is listed anywhere else in this file.
  // A screen absent from this list is a screen the freshness guard cannot see.
  join(webRoot, 'src', 'members', 'write.ts'),
  // The wire vocabulary `write.ts` re-exports. It renders nothing and is here
  // for the reason `snapshot.ts` and `client.ts` are: it holds the stable codes
  // the two screens' messages are chosen by, so a chunk built before an edit to
  // it is stale in a way no vocabulary sweep can see.
  join(webRoot, 'src', 'members', 'wire.ts'),
  join(webRoot, 'src', 'routes', 'ljudi.novi.tsx'),
  join(webRoot, 'src', 'routes', 'ljudi.$id.tsx'),
  // Story 1.8's two. `teams/roster.ts` renders nothing and owns the five keys
  // the roster and the Danas line are chosen by, as return-type unions; the
  // roster screen renders four more and is no destination, so it is listed
  // nowhere else in this file. `danas.tsx` is already listed above.
  join(webRoot, 'src', 'teams', 'roster.ts'),
  join(webRoot, 'src', 'routes', 'smjene.$id.tsx'),
  // Visual refresh B's layout primitives and the initials module. All five are
  // text-free and here for freshness rather than for strings: they are what
  // every screen's header, the summary row, the badges and the avatar chips
  // are drawn from, so a chunk built before an edit to one is stale on every
  // screen at once.
  join(webRoot, 'src', 'components', 'initials.ts'),
  join(webRoot, 'src', 'components', 'ui', 'page-header.tsx'),
  join(webRoot, 'src', 'components', 'ui', 'stat-card.tsx'),
  join(webRoot, 'src', 'components', 'ui', 'badge.tsx'),
  join(webRoot, 'src', 'components', 'ui', 'avatar.tsx'),
  // The refusal and confirmation box every screen draws through, for the same
  // freshness reason.
  join(webRoot, 'src', 'components', 'ui', 'notice.tsx'),
  // Story 2.1b's four. The two band screens render and are no destination, so
  // they are listed nowhere else in this file; the two `@/hour-bands` modules
  // own the duration shapes and the refusals as return-type unions, so a chunk
  // built before an edit to either is stale in a way no sweep could see.
  // `pojasi` is deliberately NOT counted in `AUTHORED_VOCABULARY`: it is also
  // the registered route path `/organizacija/satni-pojasi`, which ships as data.
  join(webRoot, 'src', 'hour-bands', 'list.ts'),
  join(webRoot, 'src', 'hour-bands', 'write.ts'),
  join(webRoot, 'src', 'routes', 'organizacija.satni-pojasi.tsx'),
  join(webRoot, 'src', 'routes', 'organizacija.satni-pojasi.$id.tsx'),
  // Story 2.2b's four. `postavke-rotacije.tsx` is listed above with the
  // destinations; the edit screen renders and is no destination, and the two
  // `@/shift-types` modules own the duration shapes, the kinds and the
  // refusals as return-type unions, so a chunk built before an edit to any of
  // them is stale in a way no sweep could see. The ramp module holds the chip
  // classes' slot numbering.
  join(webRoot, 'src', 'shift-types', 'list.ts'),
  join(webRoot, 'src', 'shift-types', 'write.ts'),
  join(webRoot, 'src', 'shift-types', 'ramp.ts'),
  join(webRoot, 'src', 'routes', 'postavke-rotacije.tipovi-smjena.$id.tsx'),
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

  it('mounts only inside the boot-gate if, not merely after it', () => {
    // The assertion above is ORDER only: `await bootLocalization(...);
    // createRoot(...)` — the boolean discarded, mounting unconditionally —
    // satisfies it too. This requires `createRoot(` to be the very next
    // token after the `if` opens, which only an actual conditional mount can
    // be.
    const source = main();

    expect(
      source,
      'createRoot is not the first statement inside `if (await bootLocalization(...))`',
    ).toMatch(/if\s*\(\s*await\s+bootLocalization\(initLocalization\)\s*\)\s*\{\s*createRoot\(/);
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

/** The words the application authors, so the chunk may hold them — but only
 *  from `hr.json`. Five are story 1.1d's; `Organizacija` is story 1.3b's, and
 *  it MOVED here from the absent list below rather than being deleted from it.
 *  That is the stronger claim of the two: absence said nothing may say this
 *  word, and a count says `hr.json` is the only thing that may.
 *
 *  SIX MORE MOVED the same way with the navigation shell's route skeleton —
 *  `Danas`, `Kalendar`, `Godišnji`, `Raspored`, `Ljudi` and `Postavke`, which
 *  are now `nav.*` labels rendered by eight placeholder destinations. Note
 *  `Organizacija` is now in `hr.json` TWICE, as the organization prompt's
 *  heading and as a destination label, and the count assertion holds because it
 *  compares the chunk against the resource file rather than against a number
 *  written here.
 *
 *  `Sati` is on this list and was on NEITHER before: it appeared in no absence
 *  sweep and no count, so it was the one destination label a hard-coded literal
 *  could have shipped unnoticed. Adding it is closing a gap rather than moving
 *  a word. */
const AUTHORED_VOCABULARY = [
  'Prijava',
  'Prijavi',
  'Lozinka',
  'Korisničko',
  'Zaboravljena',
  'Organizacija',
  'Danas',
  'Kalendar',
  'Sati',
  'Godišnji',
  'Raspored',
  'Ljudi',
  'Postavke',
  // THE WHOLE PHRASE, because the second word cannot be counted on its own.
  // `Postavke` is guarded above and `rotacije` was in neither list, so a
  // literal carrying only the second word was swept by nothing. A bare
  // `rotacije` entry cannot close that: `/postavke-rotacije` is a REGISTERED
  // ROUTE PATH and ships in the chunk as data, so the word legitimately occurs
  // twice against `hr.json`'s once and the count assertion would fail on
  // correct code. The phrase occurs once on each side — the hyphenated path is
  // not a match for it — and it is also the string a hard-coded label would
  // actually carry.
  'Postavke rotacije',
  // TWO MORE MOVED by story 1.4a, and they are the first two words to leave the
  // ban list for a reason other than a screen's name: the organization settings
  // surface is the first screen in the application that SAVES anything, so it is
  // the first that may say `Spremi` and `Odustani` at all. They were banned
  // outright in `NAVIGATION_AND_TERMINOLOGY` below until this commit; the count
  // is the stronger claim in exactly the way the six navigation words were.
  'Spremi',
  'Odustani',
  // TWO MORE from story 1.4b, and they close a gap rather than moving a word:
  // neither was in the ban list below, so a hard-coded `Logotip` on the
  // settings surface would have shipped unnoticed. Both are held to a COUNT
  // rather than to an absence, which is the stronger of the two claims: absence
  // says nothing may say the word, a count says `hr.json` is the only thing
  // that may — and the count is read off the resource file rather than written
  // here, so the inflected `logotip` in one refusal changes nothing.
  'Logotip',
  'Odaberi',
  // THE NAVIGATION CHROME'S THREE, and the first of them is the word this
  // application has been holding in reserve since story 1.1c. `Odjavi` MOVED
  // here from the ban list below — the stronger claim, as every move before it
  // was — and `Odjava` moved with it, because the refused-sign-out message says
  // the noun in a sentence even though the button says the imperative.
  //
  // COUNTED SEPARATELY AND NOT AS ONE STEM, which is what the word boundary
  // buys: `Odjavi` and `Odjava` are two distinct whole words, they occur once
  // each in `hr.json`, and a component hard-coding either is a count that no
  // longer matches. The stem `odjav` could not have made that distinction and
  // was never meant to — it was an ABSENCE guard, and absence is what this list
  // exists to replace.
  'Odjavi',
  'Odjava',
  // The chrome's own words, all of them closing a gap rather than moving one:
  // none was in the ban list below, so a hard-coded collapse label, landmark
  // name or retry would have shipped unnoticed. `Izbornik` and `izbornik` are
  // counted SEPARATELY, which is what the word boundary buys — the capitalized
  // form opens the failure message and the lowercase form ends three control
  // names, and a component hard-coding either is a count that no longer matches.
  // Every count is read off `hr.json` rather than written here, so a reworded
  // message changes nothing in this list.
  'Izbornik',
  'izbornik',
  'Glavni',
  'Prikaži',
  'Sakrij',
  // STORY 1.4c's SIX, and every one of them closes a gap rather than moving a
  // word: none was in the ban list below, so a hard-coded `Plava` on an accent
  // option would have shipped unnoticed. Four colour names, the control's own
  // label, and the name of the untinted default.
  //
  // `Neutralna` is on this list rather than the ban list for the reason every
  // other count here is: the claim is not "nobody says it" but "only `hr.json`
  // does". It is also the word that exists because `Nema` may not — the voice
  // rule states the fact rather than the absence, and `Nema` is banned outright
  // below.
  //
  // `Logotip` is NOT repeated here, and the reason is worth naming: it is
  // already counted above, and the count is read off `hr.json` rather than
  // written down — so `organization.lockup` adding a second occurrence of the
  // word moves both sides of the comparison at once and needs no edit here.
  'Naglasak',
  'Neutralna',
  'Plava',
  'Zelena',
  'Jantarna',
  'Ljubičasta',
  // STORY 1.5a's TWENTY-EIGHT, and every one of them closes a gap rather than
  // moving a word: not one was in the ban list below, so a hard-coded `Ime` on
  // a column heading or a hard-coded `Administrator` in a cell would have
  // shipped unnoticed. They are the member list's whole vocabulary — the
  // caption, the search field, the four headings, the two permission levels,
  // the counted noun in all its forms, and both refusals.
  //
  // COUNTED SEPARATELY AND NOT AS STEMS, which is what the word boundary buys.
  // `osoba` and `osobe` are two distinct whole words because Croatian needs all
  // three plural forms and two of them share a spelling — `osoba` occurs in
  // the `one` and `other` branch of four messages and `osobe` in the `few`
  // branch of the same four — and every count is read off `hr.json` rather than
  // written here, so a reworded message moves both sides at once.
  // `Administrator` and `Administratori` are likewise two words and not one
  // stem: the singular names the level in a cell, the plural names the filter
  // option, and a component hard-coding either is a count that no longer
  // matches.
  //
  // Six of them were already in `hr.json` before this story — `ovlasti`,
  // `godišnjeg`, `odmora`, `prikazati`, `moguće`, `trenutačno` — and were in
  // NEITHER list, so they are joining the count rather than moving into it.
  // That is the same gap `Sati` was in until the navigation shell.
  'Popis',
  'osoba',
  'osobe',
  'organizaciji',
  'Pretraga',
  'imenu',
  'adresi',
  'Ime',
  'Adresa',
  'pošte',
  'Razina',
  'razine',
  'ovlasti',
  'Dani',
  'godišnjeg',
  'odmora',
  'Administrator',
  'Administratori',
  'Član',
  'Članovi',
  'Prikazana',
  'Prikazane',
  'Prikazano',
  'Sve',
  'prikazati',
  'učitati',
  'moguće',
  'trenutačno',
  // THREE MORE from story 1.5a's round-2 review, and they arrive with the
  // reworded refusal rather than with the screen. `ljudi.error.refused` used to
  // end `Pokušaj ponovno.` — an instruction that cannot work, because a refusal
  // is the database declining this session and asking again asks the same
  // question of the same claim. It names the action that CAN change the answer
  // instead, which is signing in again.
  //
  // `prijavi` is the lowercase form and is counted SEPARATELY from `Prijavi`
  // above, which is what the word boundary buys: the capitalized form is the
  // sign-in button and the lowercase one ends this sentence, and a component
  // hard-coding either is a count that no longer matches. `Odjavi` needs no
  // entry of its own — it is already counted, and every count here is read off
  // `hr.json`, so a second occurrence moves both sides at once.
  //
  // `Pokušaj` and `ponovno` close a gap rather than moving a word: both have
  // been in `hr.json` since story 1.1d and were in neither list, so a hard-coded
  // retry instruction would have shipped unnoticed on any screen.
  'prijavi',
  'Pokušaj',
  'ponovno',
  // STORY 1.5b's FORTY, and every one of them closes a gap rather than
  // moving a word: not one was in the ban list below, so a hard-coded `Dodaj
  // osobu` on the list's own action or a hard-coded refusal in either form
  // would have shipped unnoticed. They are the two member forms' whole
  // vocabulary — the two headings, the three imperatives, the actions column,
  // the credential panel's three strings, and the eleven refusals the write
  // path maps to.
  //
  // COUNTED SEPARATELY AND NOT AS STEMS, which is what the word boundary buys.
  // `Osoba`, `osobu`, `osoba` and `osobe` are four distinct whole words because
  // Croatian declines, and three of them were already counted by story 1.5a —
  // so only the two this story introduces are added here. `korisničko` is
  // counted apart from `Korisničko` for the same reason `izbornik` is counted
  // apart from `Izbornik`: the capitalized form is a field's label and the
  // lowercase one sits inside four sentences, and a component hard-coding
  // either is a count that no longer matches.
  //
  // Every count is read off `hr.json` rather than written here, so a reworded
  // message moves both sides at once and needs no edit to this list.
  'Dodaj',
  'Nova',
  'Osoba',
  'Ostali',
  'Ova',
  'Ovo',
  'Poslije',
  'Posljednjem',
  'Početna',
  'Potrebna',
  'Promjena',
  'Promjene',
  'Radnje',
  'Račun',
  'Uredi',
  'Uređivanje',
  'Zapiši',
  'izrađen',
  'izrađena',
  'korisničko',
  'lozinku',
  'osobu',
  'administratoru',
  'dostupno',
  'oduzeti',
  'operatera',
  'podaci',
  'pomoć',
  'popis',
  'promijenjeno',
  'razmak',
  'sadržavati',
  'smije',
  'spremljena',
  'spremljene',
  'spremljeni',
  'usklađeno',
  'već',
  'više',
  'znak',
  // THE ADMIN-ISSUED RESET'S THIRTEEN, and every one of them is a word this
  // story introduces: the offer's verb, the confirmation's sentence about
  // existing sessions, the confirm, the shown panel's two lines, and the
  // refusal that says the credential did not move.
  //
  // `nije` IS NOT AMONG THEM, and the reason is worth naming rather than
  // leaving to be rediscovered: `index.html`'s boot fallback says "Shift se
  // nije pokrenuo", and that string may not come from a key at all — the
  // translation layer is what failed. Every word on this list is swept out of
  // the HTML as well as counted in the chunk, so `nije` cannot join it while
  // the fallback exists.
  //
  // COUNTED SEPARATELY AND NOT AS STEMS, which is what the word boundary buys.
  // `lozinka`, `lozinke`, `lozinku` and `Lozinka` are four distinct whole words
  // because Croatian declines and the sign-in field capitalizes; two of the
  // four were already counted, so only the two this story introduces are added.
  // `novu` and `nove` are likewise two words and not one stem.
  //
  // THE FUNCTION WORDS IN THE SAME SENTENCES — `za`, `od`, `je` — ARE
  // DELIBERATELY ABSENT, and their absence is a rule this list has followed
  // since it was written rather than an oversight: one- and two-letter tokens
  // occur in a minified chunk as identifiers, so a count over them compares
  // `hr.json` against the bundler's variable names and fails on correct code.
  // Every count here is read off the resource file rather than written down, so
  // a reworded message moves both sides at once and needs no edit to this list.
  'Dodijeli',
  'Potvrdi',
  'dobiva',
  'dodijeljena',
  'lozinka',
  'lozinke',
  'nove',
  'novu',
  'osobi',
  'Postojeće',
  'prestaju',
  'prijave',
  'vrijediti',
  // STORY 1.6's, and every one of them closes a gap rather than moving a word:
  // the inactive marker, the status block's line, label, offer, confirmation
  // and cancel, and the three refusals a status change can earn. Counted as
  // whole words for the reason every entry above is, and read off `hr.json`,
  // so a reworded message moves both sides at once.
  'neaktivna',
  'Vrijedi',
  'Deaktiviraj',
  'Ponovno',
  'aktiviraj',
  'može',
  'prijaviti',
  'ulazi',
  'buduće',
  'rasporede',
  'Prošli',
  'rasporedi',
  'ostaju',
  'nepromijenjeni',
  'deaktivaciju',
  'ponovnu',
  'aktivaciju',
  'promjene',
  'statusa',
  'Datum',
  'biti',
  'prošlosti',
  'Vlastiti',
  'možeš',
  'taj',
  'datum',
  'postoji',
  'promjena',
  'drugi',
  // STORY 1.6, ITERATION 1: the scheduled change and its cancellation, the
  // future-tense prompts, and the three refusals the date-order,
  // changes-something and in-effect rules earn.
  'aktivna',
  'zakazanu',
  'Zakazana',
  'Poništi',
  'poništavanje',
  'poništena',
  'poništiti',
  'neće',
  'moći',
  'ulaziti',
  'mora',
  'zadnje',
  'već',
  'snazi',
  // The stale-status refusal, and the self refusal reworded to cover any
  // change to one's own status rather than only a deactivation.
  'međuvremenu',
  'promijenio',
  'Provjeri',
  'mijenjati',
  // STORY 1.7a's THREE, moved out of `NAVIGATION_AND_TERMINOLOGY` below the way
  // every earned word has moved: the team screens are the first that may say
  // the Team at all, so absence becomes a count. Lowercase `smjene` is NOT
  // here, and cannot be: it is the key namespace (`smjene.*`) and a route
  // segment (`/ljudi/smjene`), both of which ship in the chunk as data, so the
  // word legitimately occurs more often there than in `hr.json`. The component
  // names (`LjudiSmjeneScreen`) are excluded by the word boundary.
  'Smjena',
  'Smjene',
  'smjena',
  // STORY 1.8: the roster and the Danas line are the first screens that speak
  // to the caller about their own team, and the first to send them back to
  // Danas by name.
  'Tvoja',
  'Tvoju',
  'Vrati',
  'arhivirana',
  'smjeni',
];

/** Everything the terminology contract and the unshipped affordances still own.
 *  None of it may reach the build. `Spremi` and `Odustani` LEFT in story 1.4a,
 *  which ships the first screen that saves anything; they are held to a count
 *  above now. `Nema` stays, and it is the one that bites: the voice rules say
 *  state the fact rather than the absence, so a refusal worded `Nemaš ovlasti`
 *  fails this sweep by SUBSTRING — which is why 1.4a's refusal says what is
 *  needed instead.
 *
 *  `Odjava` LEFT with the navigation chrome, and it is worth saying why it left
 *  rather than simply being satisfied. The shipped label is `Odjavi se`, and
 *  `'Odjavi se'.includes('Odjava')` is FALSE — so this entry would have passed a
 *  build that ships the exit, and would have gone on reading as protection while
 *  protecting nothing. A ban the shipped word walks straight past is worse than
 *  no ban, because it stops anybody looking. Both forms are counted above
 *  instead, which is the claim this list cannot make: not "nobody says it" but
 *  "only `hr.json` does". */
const NAVIGATION_AND_TERMINOLOGY = ['Nema'];

/** The static Croatian in `index.html` (story 1.1d): the boot fallback, shown
 *  when localization init rejects or the bundle never loads at all. It cannot
 *  come from a key, because the translation layer is what failed. */
const BOOT_FALLBACK = 'Shift se nije pokrenuo. Osvježi stranicu.';

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Word-bounded occurrence count, for the AUTHORED_VOCABULARY sweep below.
 *  Plain `occurrences` matches a substring anywhere, which was safe while the
 *  authored list held five words that happened to sit inside no longer one —
 *  a coincidence rather than a guarantee, and one the list has since outgrown:
 *  it has grown with every story since, and every destination label is also a
 *  component name in the build (`DanasScreen`, `PostavkeRotacijeScreen`), so
 *  the boundary is what keeps those from counting. `\p{L}` rather than `\w`,
 *  because `\w` is ASCII-only and would misplace a boundary around every
 *  diacritic these words carry (č, ž…). */
function wordOccurrences(haystack: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu');

  return (haystack.match(pattern) ?? []).length;
}

/**
 * Registered route SEGMENTS that are also counted words, and ship in the chunk
 * as data rather than as copy. Story 2.2b's `/postavke-rotacije/tipovi-smjena/$id`
 * is the first: its `smjena` is a path segment (the route definition and every
 * `<Link to>` carry it), and the word boundary cannot tell it from a hard-coded
 * label because `-` and `/` are both boundaries. Removed as the WHOLE route
 * path prefix, so a bare `smjena` literal — or the segment under any other
 * path — still counts.
 */
const ROUTE_SEGMENTS = ['/postavke-rotacije/tipovi-smjena/'];

function withoutRouteSegments(chunk: string): string {
  return ROUTE_SEGMENTS.reduce((text, segment) => text.replaceAll(segment, ''), chunk);
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
    const inChunk = wordOccurrences(withoutRouteSegments(allChunks()), word);
    const inResource = wordOccurrences(resourceSource(), word);

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

  it('counts whole words only, unlike the sweep above assumes of occurrences', () => {
    // The gap `wordOccurrences` exists for: `occurrences` would count 2 here,
    // since "Prijava" sits inside "Prijavatelj" as a plain substring.
    expect(wordOccurrences('Prijava i Prijavatelj', 'Prijava')).toBe(1);
    expect(wordOccurrences('Prijava, Prijava.', 'Prijava')).toBe(2);
    expect(wordOccurrences('Korisničko ime', 'Korisničko')).toBe(1);
    expect(wordOccurrences('abc', 'X')).toBe(0);
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
    // `visibility: hidden` keeps the fallback out of the accessibility tree
    // until it is actually revealed — opacity alone does not remove an
    // element from it, so a screen reader could announce a false failure
    // during the delay or a genuinely slow, still-succeeding load.
    expect(
      source,
      'the fallback stays exposed to the accessibility tree during the reveal delay',
    ).toMatch(/visibility:\s*hidden/);
    // The two lines above are satisfied by static, permanently-hidden rules
    // too — deleting the reveal animation leaves them untouched. This
    // requires the delayed-reveal mechanism itself: a non-zero-delay,
    // forwards-filled animation, and a keyframe rule that actually reaches
    // full opacity and visibility.
    expect(
      source,
      'the reveal animation is missing or no longer forwards its end state — the fallback would stay invisible forever on a real failure',
    ).toMatch(/animation:\s*[\w-]+\s+0s\s+linear\s+[1-9][\d.]*s\s+forwards/);
    const keyframesName = /animation:\s*([\w-]+)/.exec(source)?.[1];

    expect(keyframesName, 'no animation name to look up the keyframes rule by').not.toBeUndefined();
    const keyframesRule = new RegExp(`@keyframes\\s+${keyframesName}\\s*\\{[^}]*to\\s*\\{([^}]*)\\}`).exec(
      source,
    )?.[1];

    expect(keyframesRule, `@keyframes ${keyframesName} has no "to" state`).not.toBeUndefined();
    expect(
      keyframesRule,
      `@keyframes ${keyframesName} does not reach opacity: 1 — the fallback never becomes visible`,
    ).toMatch(/opacity:\s*1/);
    expect(
      keyframesRule,
      `@keyframes ${keyframesName} does not reach visibility: visible — the fallback stays hidden from assistive technology`,
    ).toMatch(/visibility:\s*visible/);
    // The fallback carries no reserved word and no authored word: it is
    // untranslated by necessity, so it must not become a second home for
    // vocabulary that belongs in hr.json.
    for (const word of [...NAVIGATION_AND_TERMINOLOGY, ...AUTHORED_VOCABULARY]) {
      expect(source, `${word} is in index.html`).not.toContain(word);
    }
  });
});
