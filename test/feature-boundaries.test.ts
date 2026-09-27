import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * Feature boundaries (source-structure A2b). `eslint.config.js` defines a local
 * rule, `shift/feature-boundaries`, driven by its `FEATURE_PUBLIC` map: a
 * feature reaches another feature only through that feature's listed modules,
 * never app-level code; every other file under `apps/web/src` may also use a
 * feature's `components/**` and `hooks/**`. A rule like this is easy to ship
 * broken — one that reports nothing lints clean and reads exactly like
 * compliance — so every case below is linted through the REAL config, the way
 * `localization-guard.test.ts` does: `lintText` under a synthetic path selects
 * the block, and the probe files need not exist.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const webSrc = `${repoRoot}apps/web/src`;
const featuresDir = `${webSrc}/features`;
const RULE = 'shift/feature-boundaries';

/** The config's own lists, loaded by a computed URL rather than a static
 *  import so `tsc` (`checkJs` on) does not pull the untyped config in. */
const configUrl = new URL('../eslint.config.js', import.meta.url).href;
const { FEATURES, FEATURE_PUBLIC } = (await import(configUrl)) as {
  FEATURES: string[];
  FEATURE_PUBLIC: Record<string, string[]>;
};

let eslint: ESLint | null = null;

type Finding = { messageId: string; message: string };

async function report(source: string, filePath: string): Promise<Finding[]> {
  eslint ??= new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(source, { filePath });
  const messages = result?.messages ?? [];
  // A parse error has no rule id and would make every "passes" case vacuous.
  expect(messages.filter((message) => message.fatal)).toEqual([]);

  return messages
    .filter((message) => message.ruleId === RULE)
    .map((message) => ({ messageId: message.messageId ?? '', message: message.message }));
}

const ids = async (source: string, filePath: string): Promise<string[]> =>
  (await report(source, filePath)).map((finding) => finding.messageId);

const importing = (specifier: string): string =>
  `import { probe } from '${specifier}';\n\nexport { probe };\n`;

/** Probe files — inside features, and in each kind of non-feature file. */
const IN_TEAMS = `${featuresDir}/teams/components/synthetic-probe.tsx`;
const IN_TEAMS_TS = `${featuresDir}/teams/services/synthetic-probe.ts`;
const IN_NAVIGATION = `${featuresDir}/navigation/components/synthetic-probe.tsx`;
const IN_PAGES = `${webSrc}/pages/synthetic-probe.tsx`;
const IN_ROUTER = `${webSrc}/router.ts`;
const IN_APP = `${webSrc}/App.tsx`;
const IN_MAIN = `${webSrc}/main.tsx`;
const IN_NEW_TOP = `${webSrc}/new-top.ts`;
const NON_FEATURE = [
  IN_PAGES,
  `${webSrc}/components/layout/synthetic-probe.tsx`,
  `${webSrc}/lib/synthetic-probe.ts`,
  `${webSrc}/utils/synthetic-probe.ts`,
  IN_ROUTER,
  IN_APP,
  IN_MAIN,
  IN_NEW_TOP,
];

const NOT_PUBLIC = 'notPublic';
const APP_LEVEL = 'appLevel';
const NOT_PLAIN = 'notPlain';
const WIRE = '@/features/members/services/wire';

describe('feature boundaries', () => {
  it('reads the same feature list as the disk', () => {
    const onDisk = readdirSync(featuresDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(FEATURES).toEqual(onDisk);
    expect(FEATURES.length).toBeGreaterThan(0);
  });

  it('refuses a cross-feature deep import of a non-public module', async () => {
    expect(await ids(importing(WIRE), IN_TEAMS)).toEqual([NOT_PUBLIC]);
  });

  it('allows a cross-feature import of a public module', async () => {
    expect(await ids(importing('@/features/members/services/list'), IN_TEAMS)).toEqual([]);
    expect(await ids(importing('@/features/members/utils/rank'), IN_TEAMS)).toEqual([]);
    expect(await ids(importing('@/features/members/utils/rank.ts'), IN_TEAMS)).toEqual([]);
    // Exact match, never a prefix.
    expect(await ids(importing('@/features/members/services/list-extra'), IN_TEAMS)).toEqual([NOT_PUBLIC]);
    expect(await ids(importing('@/features/members/services/list/deeper'), IN_TEAMS)).toEqual([NOT_PUBLIC]);
  });

  it('allows a same-feature deep import', async () => {
    expect(await ids(importing('@/features/teams/services/wire'), IN_TEAMS)).toEqual([]);
    expect(await ids(importing('../services/wire'), IN_TEAMS)).toEqual([]);
    expect(await ids(importing('../../teams/hooks/use-team-roster'), IN_TEAMS)).toEqual([]);
  });

  it('allows a feature shared app code that is not app-level', async () => {
    expect(await ids(importing('@/lib/i18n'), IN_TEAMS)).toEqual([]);
    expect(await ids(importing('@/components/ui/button'), IN_TEAMS)).toEqual([]);
    expect(await ids(importing('@/utils/initials'), IN_TEAMS)).toEqual([]);
    expect(await ids(importing('react'), IN_TEAMS)).toEqual([]);
  });

  it.each(NON_FEATURE)(
    'allows %s any feature’s components/ and hooks/ and its public modules',
    async (filePath) => {
      expect(await ids(importing('@/features/teams/components/team-roster'), filePath)).toEqual([]);
      expect(await ids(importing('@/features/members/hooks/use-member-edit'), filePath)).toEqual([]);
      expect(await ids(importing('@/features/teams/services/roster'), filePath)).toEqual([]);
    },
  );

  it.each(NON_FEATURE)('refuses %s a non-public service of a feature', async (filePath) => {
    expect(await ids(importing(WIRE), filePath)).toEqual([NOT_PUBLIC]);
  });

  it('refuses a feature another feature’s components/ and hooks/ unless the module is public', async () => {
    expect(await ids(importing('@/features/members/components/member-table'), IN_TEAMS)).toEqual([NOT_PUBLIC]);
    expect(await ids(importing('@/features/members/hooks/use-member-edit'), IN_TEAMS)).toEqual([NOT_PUBLIC]);
    expect(await ids(importing('@/features/organization/components/lockup'), IN_NAVIGATION)).toEqual([]);
    expect(await ids(importing('@/features/organization/hooks/logo-url'), IN_NAVIGATION)).toEqual([]);
  });

  it('refuses a relative import that climbs into another feature', async () => {
    expect(await ids(importing('../../members/services/wire'), IN_TEAMS)).toEqual([NOT_PUBLIC]);
    expect(await ids(importing('../../../features/members/services/wire'), IN_TEAMS)).toEqual([NOT_PUBLIC]);
    expect(await ids(importing('../features/members/services/wire'), IN_PAGES)).toEqual([NOT_PUBLIC]);
    // Still public when reached relatively.
    expect(await ids(importing('../../members/services/list'), IN_TEAMS)).toEqual([]);
  });

  it.each([IN_ROUTER, IN_APP, IN_MAIN])('resolves ./features/… from %s', async (filePath) => {
    expect(await ids(importing('./features/members/services/wire'), filePath)).toEqual([NOT_PUBLIC]);
    expect(await ids(importing('./features/teams/components/team-roster'), filePath)).toEqual([]);
  });

  it('refuses a whole-feature import, since there are no barrels', async () => {
    expect(await ids(importing('@/features/members'), IN_TEAMS)).toEqual([NOT_PUBLIC]);
    expect(await ids(importing('@/features/members'), IN_PAGES)).toEqual([NOT_PUBLIC]);
  });

  describe('every import form', () => {
    const FORMS: [string, string][] = [
      ['export-from', `export { probe } from '${WIRE}';\n`],
      ['export *', `export * from '${WIRE}';\n`],
      ['import type', `import type { Probe } from '${WIRE}';\n\nexport type { Probe };\n`],
      ['side-effect import', `import '${WIRE}';\n`],
      ['dynamic import()', `export const load = () => import('${WIRE}');\n`],
      ['dynamic import() of a plain template', `export const load = () => import(\`${WIRE}\`);\n`],
      ['require()', `export const probe = require('${WIRE}');\n`],
      ['typeof import()', `export type Probe = typeof import('${WIRE}');\n`],
      ['import = require()', `import probe = require('${WIRE}');\n\nexport { probe };\n`],
    ];

    it.each(FORMS)('refuses %s', async (_name, source) => {
      expect(await ids(source, IN_TEAMS_TS)).toEqual([NOT_PUBLIC]);
    });
  });

  describe('a specifier that is not a plain, exact-case path', () => {
    const CASES: [string, string, string][] = [
      ['./../../ from a feature', './../../members/services/wire', IN_TEAMS],
      ['./../../ to a public module', './../../members/services/list', IN_TEAMS],
      ['.. mid-path from a feature', '@/features/teams/../members/services/wire', IN_TEAMS],
      ['.. mid-path inside the target', '@/features/members/components/../services/wire', IN_PAGES],
      ['.. mid-path from a non-feature file', '@/lib/../features/members/services/wire', IN_PAGES],
      ['.. mid-path in a relative specifier', '../../teams/../members/services/list', IN_TEAMS],
      ['a . segment', '@/features/members/./services/wire', IN_TEAMS],
      ['//', '@/features/members//services/wire', IN_TEAMS],
      ['// from a non-feature file', '@/features//members/services/list', IN_PAGES],
      ['a trailing /', '@/features/members/services/list/', IN_TEAMS],
      ['a mis-cased feature', '@/features/Members/services/list', IN_TEAMS],
      ['a mis-cased features folder', '@/Features/members/services/list', IN_PAGES],
      ['a mis-cased relative path', '../../MEMBERS/services/list', IN_TEAMS],
      ['an unknown feature', '@/features/nope/services/list', IN_PAGES],
      ['the features folder itself', '@/features', IN_TEAMS],
    ];

    it.each(CASES)('refuses %s', async (_name, specifier, filePath) => {
      expect(await ids(importing(specifier), filePath)).toEqual([NOT_PLAIN]);
    });
  });

  it('refuses a feature app-level code: pages, router, App and main', async () => {
    for (const specifier of ['@/pages/kalendar', '@/router', '@/App', '@/main', '@/pages', '../../../router']) {
      expect(await ids(importing(specifier), IN_TEAMS), specifier).toEqual([APP_LEVEL]);
    }
  });

  it.each(['mts', 'cts', 'js', 'jsx', 'ts', 'tsx'])('lints a .%s file', async (extension) => {
    const filePath = `${featuresDir}/teams/synthetic-probe.${extension}`;

    expect(await ids(importing(WIRE), filePath)).toEqual([NOT_PUBLIC]);
  });

  it.each(FEATURES)('refuses %s as a target, from a feature and from a non-feature file', async (target) => {
    const importer = FEATURES.find((feature) => feature !== target) ?? '';
    const specifier = `@/features/${target}/synthetic-internal`;

    expect(await ids(importing(specifier), `${featuresDir}/${importer}/synthetic-probe.ts`)).toEqual([
      NOT_PUBLIC,
    ]);
    expect(await ids(importing(specifier), IN_PAGES)).toEqual([NOT_PUBLIC]);
  });

  it.each(FEATURES)('binds %s as an importer', async (feature) => {
    const target = feature === 'members' ? 'teams' : 'members';
    const probe = `${featuresDir}/${feature}/synthetic-probe.ts`;

    expect(await ids(importing(`@/features/${target}/synthetic-internal`), probe)).toEqual([NOT_PUBLIC]);
  });

  it.each([
    `${featuresDir}/teams/synthetic-probe.test.ts`,
    `${featuresDir}/teams/synthetic-probe.spec.ts`,
    `${featuresDir}/teams/synthetic-probe.fixture.ts`,
    `${featuresDir}/teams/__tests__/synthetic-probe.ts`,
    `${webSrc}/pages/synthetic-probe.test.tsx`,
    `${webSrc}/__tests__/synthetic-probe.ts`,
  ])('exempts tests, specs, fixtures and __tests__/: %s', async (filePath) => {
    expect(await ids(importing(WIRE), filePath)).toEqual([]);
    expect(await ids(importing('@/router'), filePath)).toEqual([]);
  });

  describe('messages', () => {
    it('names a non-public module, the public list and the fix', async () => {
      const [fromFeature] = await report(importing(WIRE), IN_TEAMS);
      const [fromPage] = await report(importing(WIRE), IN_PAGES);

      expect(fromFeature?.message).toBe(
        'Feature boundaries: `services/wire` is not a public module of the members feature for the teams feature. Import it from one of members\'s public modules (FEATURE_PUBLIC in eslint.config.js: `services/list`, `utils/position`, `utils/rank`), or add a module there deliberately.',
      );
      expect(fromPage?.message).toBe(
        'Feature boundaries: `services/wire` is not a public module of the members feature. Import it from one of members\'s public modules (FEATURE_PUBLIC in eslint.config.js: `services/list`, `utils/position`, `utils/rank`), from its components/ or hooks/, or add a module there deliberately.',
      );
    });

    it('names app-level code', async () => {
      const [finding] = await report(importing('@/router'), IN_TEAMS);

      expect(finding?.message).toBe(
        'Feature boundaries: the teams feature may not import app-level code (`router`). pages/, router.ts, App.tsx and main.tsx compose features, never the other way round; move what is shared into lib/, utils/, components/ or a feature\'s public module.',
      );
    });

    it('names a path that is not plain, and the exact case on disk', async () => {
      const [dotted] = await report(importing('@/features/teams/../members/services/wire'), IN_TEAMS);
      const [cased] = await report(importing('@/features/Members/services/list'), IN_TEAMS);

      expect(dotted?.message).toBe(
        'Feature boundaries: write `@/features/teams/../members/services/wire` as a plain, exact-case path (it has a `.`, `..` or empty segment). A `.` or `..` segment after the start, a `//`, or a case that differs from the folder on disk can hide which feature an import reaches.',
      );
      expect(cased?.message).toContain('(the folder on disk is `features/members`)');
    });
  });

  it('lists only features and modules that exist, in their exact case', () => {
    const entries = Object.entries(FEATURE_PUBLIC);
    expect(entries.length).toBeGreaterThan(0);

    for (const [feature, modules] of entries) {
      expect(FEATURES, feature).toContain(feature);
      for (const module of modules) {
        const directory = posix.dirname(module);
        const base = posix.basename(module);
        const names = readdirSync(`${featuresDir}/${feature}/${directory}`);
        const found = ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts'].some((extension) =>
          names.includes(`${base}.${extension}`),
        );

        expect(found, `${feature}/${module}`).toBe(true);
      }
    }
  });

  it('lists only modules something outside their feature imports', () => {
    const consumed = new Set<string>();
    const walk = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`],
      );
    const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"`]([^'"`]+)['"`]/g;

    for (const file of walk(webSrc)) {
      if (!/\.(?:ts|tsx|js|jsx|mts|cts)$/.test(file)) continue;
      if (/\.(?:test|spec|fixture)\./.test(file) || file.includes('/__tests__/')) continue;
      const importer = posix.relative(webSrc, file).split('/');
      const importerFeature = importer[0] === 'features' ? importer[1] : null;

      for (const [, specifier = ''] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        const resolved = specifier.startsWith('@/')
          ? posix.join(webSrc, specifier.slice(2))
          : specifier.startsWith('.')
            ? posix.join(posix.dirname(file), specifier)
            : null;
        if (resolved === null) continue;
        const [head, feature, ...rest] = posix.relative(webSrc, resolved).split('/');
        if (head !== 'features' || feature === undefined || feature === importerFeature) continue;
        consumed.add(`${feature}/${rest.join('/').replace(/\.(?:ts|tsx|js|jsx|mts|cts)$/, '')}`);
      }
    }

    for (const [feature, modules] of Object.entries(FEATURE_PUBLIC)) {
      for (const module of modules) {
        expect(consumed.has(`${feature}/${module}`), `${feature}/${module} has no outside consumer`).toBe(true);
      }
    }
    expect(consumed.size).toBeGreaterThan(0);
  });
});
