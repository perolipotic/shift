import { readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import globals from 'globals';

/**
 * ESLint flat config.
 *
 * TypeScript is parsed by `@babel/eslint-parser` rather than
 * `@typescript-eslint/parser`, because TypeScript 7 ships no programmatic API
 * until 7.1 — `typescript@7.0.2`'s only export is its version string. That also
 * means there is no typed linting here, deliberately: the TypeScript 5.x
 * fallback was declined, so lint stays syntactic and `tsc` owns type errors.
 */

/** Shared Babel parser wiring. JSX is enabled per-extension, not globally. */
function babel({ jsx }) {
  return {
    parser: babelParser,
    parserOptions: {
      requireConfigFile: false,
      babelOptions: {
        presets: ['@babel/preset-typescript'],
        plugins: jsx ? ['@babel/plugin-syntax-jsx'] : [],
      },
    },
    sourceType: 'module',
    ecmaVersion: 'latest',
  };
}

/**
 * Selector fragments for the L2 block below.
 *
 * Named once and composed, because the rule is a matrix — string form ×
 * position × nesting — and every hand-written derivation of it so far has
 * covered one axis and missed another. See the commentary on the block itself.
 */

/** One character that makes a string CONTENT rather than separator punctuation.
 *  A character class, not `\S`: `{start} – {end}` and `{label}:` leave text
 *  nodes holding nothing but a dash or a colon, and firing on those is a false
 *  positive in a merge-blocking rule. Human-approved 2026-09-04. */
const CONTENT = '[^\\s\\-–—:,.()\\/|•]';

/** A quoted string or a template literal carrying text of its own. Used where
 *  the string is CONTENT, so the punctuation exemption applies. */
const CONTENT_STRING = `:matches(Literal[raw=/^['"]/][value=/${CONTENT}/], TemplateLiteral:has(TemplateElement[value.raw=/${CONTENT}/]))`;

/** The same, without the punctuation exemption, for attributes: an `aria-label`
 *  of " – " names nothing and is still a defect. A template interpolating only
 *  a value still passes — `aria-label={`${n}`}` is not a hard-coded string. */
const ANY_STRING = `:matches(Literal[raw=/^['"]/], TemplateLiteral:has(TemplateElement[value.raw=/${CONTENT}/]))`;

/** A ternary or a guard. Both are branches, and a literal in either is a
 *  hard-coded string; a branch between two words is also how a plural gets
 *  hand-rolled (L7). */
const BRANCH = ':matches(ConditionalExpression, LogicalExpression)';

/** An expression container that is an element's own child — as opposed to one
 *  on an attribute, where a string is usually structural. */
const CHILD_CONTAINER = ':matches(JSXElement, JSXFragment) > JSXExpressionContainer';

/** The seven attributes whose string value reaches a user or an assistive
 *  technology. */
const GUARDED_ATTRIBUTE =
  'JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|aria-valuetext|placeholder|title|alt)$/]';

/** `label` on the three built-ins where it renders. */
const LABEL_ATTRIBUTE =
  'JSXOpeningElement[name.name=/^(optgroup|option|track)$/] > JSXAttribute[name.name="label"]';

const BRANCH_MESSAGE =
  'L2: a literal in a ternary or a guard is still a hard-coded string, and a branch between two words is also how a plural gets hand-rolled (L7). Add both outcomes to apps/web/src/lib/i18n/locales/hr.json and branch between t() calls.';
const ATTRIBUTE_MESSAGE =
  'L2: an assistive-technology or placeholder string is user-facing too — braces, a template literal and a ternary do not change that. Add it to apps/web/src/lib/i18n/locales/hr.json and pass t() instead.';
const LABEL_MESSAGE =
  'L2: the label on an optgroup, option or track renders to the user. Add it to apps/web/src/lib/i18n/locales/hr.json and pass t().';

/**
 * Feature boundaries — the modules of each `apps/web/src/features/<m>` that
 * code OUTSIDE that feature may import. Module paths, never folder globs, and
 * each names its consumers today.
 *
 * Deliberately a list rather than an `index.ts` barrel per feature (human
 * decision 2026-09-27): whole-feature barrels would join navigation,
 * organization, members, teams, rotation, shift-types and hour-bands into one
 * import cycle, put two top-level consts in TDZ reach
 * (`members/services/list.ts` `LEVEL_FILTERS`, `rotation/utils/draft.ts`
 * `NO_CLOCK_RANGE`), and make a service-only importer load the other
 * feature's components.
 *
 * The rules, enforced by the local `shift/feature-boundaries` rule below and
 * proved in `test/feature-boundaries.test.ts`:
 *   - a feature deep-imports its own modules freely;
 *   - a feature imports another feature's module only if it is listed here,
 *     matched exactly by module path (extension stripped), never by prefix;
 *   - a feature never imports app-level code (`pages/**`, `router`, `App`,
 *     `main`);
 *   - every other file under `apps/web/src` may import a feature's listed
 *     modules plus any of its `components/**` and `hooks/**`, but never the
 *     bare `@/features/<m>`;
 *   - tests (`*.test.*`, `*.spec.*`), fixtures (`*.fixture.*`) and anything
 *     under `__tests__/` are exempt.
 *
 * Adding a module here is a deliberate widening of that feature's API.
 */
export const FEATURE_PUBLIC = {
  // Story 7.8: the signed-in layout holds a flagged session at the
  // set-password step through `mustSetPassword`, never a reading of its own.
  auth: [
    'services/address', // pages
    'services/return-target', // pages
    'services/set-password', // pages
    'services/sign-out', // navigation
  ],
  // Story 5.3d: *Sati* reads leave by the marks' own role rule
  // (`readsOrganizationLeave`), and draws the conflict's one glyph
  // (`CONFLICT_GLYPH`) from the modifier vocabulary.
  // Story 5.4b: the resolution screen reads who works that day off the day
  // detail's own roster (`dayDetailOf`), never a second one, and draws the
  // conflict's glyph.
  // Story 6.1a: *Danas* reads the calendar's own snapshot and builds each
  // day with *Moj raspored*'s own derivation (`calendarDayListOf`), and draws
  // a day's shift with the calendar's one cell renderer and the leave glyph,
  // so its seven days equal the calendar's.
  // SINCE STORY 6.3: an admin's *Danas* draws its week and today's coverage from
  // the calendar's own months under the admin's own marks (`marks`), and
  // picks its skeleton by the chrome's cached role, as *Kalendar* does
  // (`cachedRoleOf`), and its week is Kalendar's grid model: one tab stop and
  // the arrow keys (`grid-keys`).
  calendar: [
    'components/calendar-cell', // today
    'components/modifier-glyphs', // today
    'services/marks', // hours, today
    'services/snapshot', // conflicts, hours, leave, members, pages, teams, today
    'utils/day-detail', // conflicts
    'utils/grid-keys', // today
    'utils/modifiers', // conflicts, hours, today
    'utils/month', // conflicts, hours, leave, pages, today
    'utils/skeleton', // today
    // Story 5.4c: the replacement candidates, grouped once, for the conflict
    // screen's second card (and story 7.9's roster dialog). Story 7.9: their
    // group headings (`candidateGroupMessageKey`) live beside them.
    'utils/replacement-candidates', // conflicts
  ],
  // Story 5.3c: the calendar's marks derive every collision through
  // *Raspored*'s own recipe (`collisionInputOf`), never a second one. Story
  // 5.3d: so does *Sati*'s conflict count. Story 5.4a: the calendar's marks
  // and *Sati*'s count read the live resolutions through `resolutions`, and
  // the teams feature's dependents name both its keys, so a leave write
  // re-reads them.
  // Story 5.5b: the erasure guard, lifted out of the rotation builder, is
  // shared by the builder and the calendar's roster changes — the diff, rows
  // and decisions, the never-throwing check run, the three fresh reads, the
  // confirmation's state and freshness loop, and the dialog itself. Story
  // 5.5e: the member page's team and status cards use the same pieces.
  // Story 5.5f: the shift-type override's "after" for its four writes (set,
  // remove, confirm, amend), surface-neutral: the calendar's set and removal
  // use it, and so does the rotation builder's override review for its
  // confirm and amend (story 5.5h). Story 5.5d: whether a replacement still
  // applies, the one test the hours' member path and the leave screen's
  // replacement guard share with the queue. Story 6.1b: *Danas*'s hours tile
  // reads the viewer's own resolutions and re-reads a replacement's link, as
  // *Sati*'s member branch does. SINCE STORY 6.3: an admin's *Danas* stands on the
  // queue's own gating and rows (`conflictsQueueOf`), its effective
  // resolutions and the organization's resolutions read, so its count equals
  // *Raspored*'s.
  // Story 7.12: the leave dialog's conflict preview derives through the
  // queue's own recipe (`collisionInputOf`) and funnel (`resolutionsOf`), so
  // the conflicts it says a save creates are the rows the queue then lists.
  conflicts: [
    'components/erasure-dialog', // calendar, members, rotation
    'hooks/use-erasure-confirmation', // calendar, members, rotation
    'hooks/use-erasure-reads', // calendar, members, rotation
    'hooks/use-replacement-link-refresh', // calendar, hours, today
    'services/conflicts-queue', // calendar, hours, leave, today
    'services/erasure-check', // calendar, members, rotation
    'services/erasures', // calendar, members, rotation
    'services/override-erasures', // calendar, rotation
    'services/replacement-effect', // hours, leave
    'services/resolutions', // calendar, hours, teams, today
  ],
  'hour-bands': [
    'services/list', // calendar, conflicts, hours, shift-types, pages
    'services/write', // pages
  ],
  // Story 6.1b: *Danas*'s hours tile is *Sati*'s own surface for the
  // viewer's month (`myHoursSurfaceOf`), over the conflicts state *Sati*
  // derives (`hoursConflictsStateOf`), so the tile equals *Sati*.
  // Story 7.9: the day detail's *Što se mijenja* counts each member's hours
  // through *Sati*'s own input (`memberHoursInputOf`) and leave-hours keys
  // (`hoursLeaveKeysOf`), never a second recipe.
  hours: [
    'services/hours-conflicts', // calendar, today
    'services/my-hours', // calendar, pages, today
  ],
  // Story 5.1c: the member page composes `components/member-leave-card`,
  // which every page may import. Story 5.2c: the teams feature's dependents
  // name the viewer's own leave key, so a leave write re-reads *Godišnji*.
  // The root database test `test/rls-isolation.test.ts` imports
  // `leave-write.ts` directly, to drive `recordLeave` over real PostgREST: a
  // test-only consumer outside `apps/web/src`, which this rule does not govern.
  // Story 5.3b: the conflicts queue reads the organization's records, and the
  // table's name, through `leave-list`, and writes a record's range as the
  // member's card does (`leave-section`). Story 5.3c: the calendar's marks
  // read the organization's records or the viewer's own through `leave-list`,
  // and since story 5.3d so does *Sati*'s conflict count. Story 6.1a:
  // *Danas* reads the viewer's own records through the same query options.
  // Story 6.1b: *Danas*'s leave tile is *Godišnji*'s own state (`myLeaveOf`).
  // SINCE STORY 6.3: an admin's *Danas* reads the organization's records through
  // the queue's own query options.
  leave: [
    'services/leave-list', // calendar, conflicts, hours, teams, today
    'services/leave-section', // conflicts
    'services/my-leave', // today
  ],
  // Story 6.1b: *Danas*'s leave tile reads the viewer's allowance, as *Godišnji* does.
  members: [
    'services/list', // conflicts, hour-bands, leave, shift-types, teams, today, pages
    'utils/position', // calendar, conflicts, teams
    'utils/rank', // calendar, conflicts, organization, teams
  ],
  // SINCE STORY 6.3: *Danas* reads the chrome's cached role under its key, never
  // a read of its own, and narrows it as the calendar does.
  navigation: [
    'services/profile', // teams
    'services/role', // calendar, members, pages, router, teams, today
    'utils/destinations', // calendar, members, pages, today
  ],
  // Story 6.1b: *Danas*'s leave tile reads the leave year, as *Godišnji* does.
  organization: [
    'components/lockup', // navigation
    'hooks/logo-url', // navigation
    'services/snapshot', // conflicts, leave, members, navigation, teams, today
    'utils/accent', // navigation
  ],
  rotation: [
    'services/list', // calendar, shift-types, teams
  ],
  'shift-types': [
    'services/list', // calendar, rotation, pages
    'services/write', // pages
  ],
  // Story 6.1b: *Danas*'s retry reads the team line's key again with the rest.
  teams: [
    'services/dependents', // conflicts, hour-bands, leave, members
    'services/list', // calendar, members, rotation, pages
    'services/roster', // pages, today
    'services/write', // calendar, hour-bands, rotation, shift-types, pages
  ],
  // SINCE STORY 6.3: the *Danas* page picks the admin's body by role and states
  // the admin's own today in its subtitle, from the rules that executes.
  today: [
    'services/admin-today', // pages
  ],
};

/** `apps/web/src` on disk — the root of the `@/` alias. */
const WEB_SRC = fileURLToPath(new URL('./apps/web/src', import.meta.url));
const FEATURES_DIR = `${WEB_SRC}/features`;

/** Every feature folder, read from disk so a new feature is covered the day
 *  it is created — with an empty public surface until it is listed above. */
export const FEATURES = (() => {
  let entries;
  try {
    entries = readdirSync(FEATURES_DIR, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `eslint.config.js: the feature-boundaries rule reads its feature list from ${FEATURES_DIR}, which could not be read (${error.code ?? error.message}). If the features folder moved, update WEB_SRC/FEATURES_DIR in eslint.config.js.`,
      { cause: error },
    );
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
})();

/** Source extensions the rule covers, and that every parser block below lints. */
const SOURCE_EXTENSION = /\.(?:ts|tsx|js|jsx|mts|cts)$/;

/** Not bound by the rule: tests, specs, fixtures and anything under `__tests__/`. */
const isExempt = (file) =>
  /\.(?:test|spec|fixture)\.[^/]+$/.test(file) || file.split('/').includes('__tests__');

/** App-level files a feature may not reach: they compose features, not the
 *  other way round. Compared case-insensitively, first segment of the path
 *  relative to `apps/web/src`, extension stripped. */
const APP_LEVEL = new Set(['pages', 'router', 'app', 'main']);

/**
 * Whether a specifier is written as a plain path. A relative specifier may
 * open with `./` or with a run of `../`; after that — and anywhere in an `@/`
 * specifier — a `.` or `..` segment, or an empty one (`//`, a trailing `/`),
 * could walk a path across a boundary its text does not show, so it is refused
 * outright rather than resolved and trusted.
 */
function isPlainPath(specifier) {
  const segments = specifier.split('/');
  let index = 1;
  if (segments[0] === '..') {
    while (segments[index] === '..') index += 1;
  } else if (segments[0] !== '.' && segments[0] !== '@') {
    return true;
  }
  return segments.slice(index).every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** The absolute path a specifier names, or null for a package import. */
function resolveSpecifier(specifier, importer) {
  if (specifier.startsWith('@/')) return posix.normalize(`${WEB_SRC}/${specifier.slice(2)}`);
  if (specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')) {
    return posix.normalize(`${posix.dirname(importer)}/${specifier}`);
  }
  return null;
}

/** Where a path under `apps/web/src` sits: its feature (name as on disk, or
 *  null), the case it was written in, and the path inside the feature with the
 *  extension stripped. Null for a path outside `apps/web/src`. */
function locate(file) {
  const relative = posix.relative(WEB_SRC, file);
  if (relative.startsWith('..') || posix.isAbsolute(relative)) return null;
  const segments = relative.split('/');
  if (segments[0]?.toLowerCase() !== 'features') {
    return { feature: null, relative, segments, exactCase: true };
  }
  if (segments.length < 2) {
    // `@/features` itself: no feature, and no barrel to land on.
    return { feature: '', known: false, exactCase: false, module: '', relative, segments };
  }
  const feature = FEATURES.find((name) => name.toLowerCase() === segments[1]?.toLowerCase()) ?? null;
  return {
    feature: feature ?? segments[1],
    known: feature !== null,
    exactCase: segments[0] === 'features' && feature === segments[1],
    module: segments.slice(2).join('/').replace(SOURCE_EXTENSION, ''),
    relative,
    segments,
  };
}

const listPublic = (feature) =>
  (FEATURE_PUBLIC[feature] ?? []).map((module) => `\`${module}\``).join(', ') || 'none yet';

/**
 * `shift/feature-boundaries` — the rule stated on `FEATURE_PUBLIC`. It
 * RESOLVES every specifier (the `@/` alias and relative paths alike) before it
 * decides, so the verdict follows where an import lands, not how it is spelt.
 * A local rule rather than `no-restricted-imports`, whose patterns match the
 * specifier's text and so miss `./features/…`, `..` mid-path, `//`, a
 * mis-cased path and dynamic `import()`.
 */
const featureBoundaries = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      notPublic:
        'Feature boundaries: `{{module}}` is not a public module of the {{target}} feature{{outside}}. Import it from one of {{target}}\'s public modules (FEATURE_PUBLIC in eslint.config.js: {{list}}){{extra}}, or add a module there deliberately.',
      appLevel:
        'Feature boundaries: the {{feature}} feature may not import app-level code (`{{path}}`). pages/, router.ts, App.tsx and main.tsx compose features, never the other way round; move what is shared into lib/, utils/, components/ or a feature\'s public module.',
      notPlain:
        'Feature boundaries: write `{{specifier}}` as a plain, exact-case path ({{reason}}). A `.` or `..` segment after the start, a `//`, or a case that differs from the folder on disk can hide which feature an import reaches.',
    },
  },
  create(context) {
    const importer = context.filename;
    const from = locate(importer);
    if (from === null || isExempt(importer) || !SOURCE_EXTENSION.test(importer)) return {};

    function check(node, specifier) {
      if (typeof specifier !== 'string') return;
      const target = resolveSpecifier(specifier, importer);
      if (target === null) return;

      const to = locate(target);
      if (!isPlainPath(specifier)) {
        context.report({
          node,
          messageId: 'notPlain',
          data: { specifier, reason: 'it has a `.`, `..` or empty segment' },
        });
        return;
      }
      if (to === null) return;
      if (!to.exactCase) {
        context.report({
          node,
          messageId: 'notPlain',
          data: {
            specifier,
            reason: to.known ? `the folder on disk is \`features/${to.feature}\`` : 'no feature has that name',
          },
        });
        return;
      }

      if (from.feature !== null) {
        if (to.feature === null) {
          const head = (to.segments[0] ?? '').replace(SOURCE_EXTENSION, '').toLowerCase();
          if (APP_LEVEL.has(head)) {
            context.report({ node, messageId: 'appLevel', data: { feature: from.feature, path: to.relative } });
          }
          return;
        }
        if (to.feature === from.feature) return;
      } else if (to.feature === null) {
        return;
      }

      const outsideFeatures = from.feature === null;
      const isPublic = (FEATURE_PUBLIC[to.feature] ?? []).includes(to.module);
      const isScreenPart =
        outsideFeatures && /^(?:components|hooks)\/[^/].*$/.test(to.module ?? '');
      if (isPublic || isScreenPart) return;

      context.report({
        node,
        messageId: 'notPublic',
        data: {
          module: to.module || '(the whole feature)',
          target: to.feature,
          outside: outsideFeatures ? '' : ` for the ${from.feature} feature`,
          list: listPublic(to.feature),
          extra: outsideFeatures ? ', from its components/ or hooks/' : '',
        },
      });
    }

    /** The string a source node carries: a literal, or a template with no
     *  interpolation. Anything computed is left to `tsc` and review. */
    const text = (node) => {
      if (!node) return undefined;
      if (node.type === 'Literal') return node.value;
      if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked;
      if (node.type === 'TSLiteralType') return text(node.literal);
      return undefined;
    };

    return {
      ImportDeclaration: (node) => check(node, text(node.source)),
      ExportNamedDeclaration: (node) => node.source && check(node, text(node.source)),
      ExportAllDeclaration: (node) => check(node, text(node.source)),
      ImportExpression: (node) => check(node, text(node.source)),
      TSImportType: (node) => check(node, text(node.source ?? node.argument)),
      TSExternalModuleReference: (node) => check(node, text(node.expression)),
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === 'Import' || (callee.type === 'Identifier' && callee.name === 'require')) {
          check(node, text(node.arguments[0]));
        }
      },
    };
  },
};

const shiftPlugin = { rules: { 'feature-boundaries': featureBoundaries } };

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '_bmad/**',
      '_bmad-output/**',
      // Other sessions' worktrees live here; their unfinished code is not this checkout's.
      '.claude/**',
    ],
  },

  js.configs.recommended,

  // ---------------------------------------------------------------- TypeScript
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    languageOptions: babel({ jsx: false }),
  },
  {
    // `.jsx` too, so every extension the feature-boundaries rule names is
    // actually parsed and linted.
    files: ['**/*.tsx', '**/*.jsx'],
    languageOptions: babel({ jsx: true }),
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      // `tsc` reports these with types; ESLint's untyped versions produce
      // false positives on type-only declarations.
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },

  // ------------------------------------------------- localization: no literals
  // L2 — a user-facing string introduced during development goes through the
  // translation system, and the rule is merge-blocking rather than advisory.
  // This is the merge block: `pnpm lint` refuses the literal.
  //
  // Scoped to `.tsx` under `apps/web`, which is where a rendered literal can
  // exist at all — `packages/domain` returns keys and values (L4) and
  // `supabase/functions` returns stable codes, neither of which renders.
  //
  // The selectors are AST-SHAPE based, never type-aware: TSX here parses
  // through `@babel/eslint-parser`, which is syntax only (see the header), so a
  // rule needing type information would silently match nothing. `Literal` and
  // not Babel's `StringLiteral` for the same reason — that parser converts to
  // ESTree, and a selector naming `StringLiteral` lints clean forever.
  //
  // They are COMPOSED from the fragments above rather than written out, because
  // hand-writing them is what let the gaps in. Every string form has to be
  // refused in every position that renders, and the first two derivations each
  // covered one axis and missed the other: story 1.1c's covered bare text and
  // four attributes but no braces or branches, and 1.1d's first pass added
  // branches for `Literal` only — so a template literal in a branch, a nested
  // ternary, and every braced, template and branch form of an `option` label
  // all still linted clean. The matrix is: three string forms (bare text,
  // quoted, template) × three positions (element child, guarded attribute,
  // `label` on the three built-ins where it renders) × two nestings (direct,
  // inside a branch).
  //
  // Three boundaries are drawn deliberately, and all three are asserted in
  // `test/localization-guard.test.ts` with cases of BOTH polarities.
  //
  //   - SEPARATOR PUNCTUATION IS NOT CONTENT. `{start} – {end}` and `{label}:`
  //     leave `JSXText` nodes holding nothing but a dash or a colon, and firing
  //     on those is a false positive in a merge-blocking rule — the fastest
  //     route to someone reaching for `eslint-disable`, which costs more than
  //     the rule earns. Hence `CONTENT` rather than `\S`. Human-approved
  //     2026-09-04. `<p>Danas</p>` still fires; so does any text with one
  //     letter or digit in it. Note the exemption applies to CONTENT positions
  //     only: an `aria-label` of " – " names nothing and still fires, which is
  //     why the attribute selectors use `ANY_STRING`.
  //   - A BRACED STRING IS STILL A STRING, but only where the string is
  //     content. `{'Danas'}` as an element child is a literal in disguise;
  //     `className={'flex'}` is not user-facing and must stay silent, so the
  //     child selectors are parented to `JSXElement`/`JSXFragment` and the
  //     attribute cases are named separately against the guarded attributes
  //     only. `{' '}` — the JSX space idiom — is whitespace and passes, and so
  //     does a template that interpolates a value and carries no text of its
  //     own.
  //   - A LITERAL IS A DIRECT CHILD OF ITS BRANCH. The branch selectors let the
  //     CONDITIONAL nest — `{a ? 'x' : b ? 'y' : 'z'}` fires on all three — but
  //     the string must be a direct child of a branch node, never a descendant
  //     of one. That is what keeps `{cond ? t('a') : t('b')}` clean: those
  //     literals are call ARGUMENTS one level deeper, and a descendant sweep
  //     would refuse the very fix the message asks for. `t(cond ? 'a' : 'b')`
  //     stays clean for the same reason from the other side — the container's
  //     own child is a call, not a branch.
  {
    files: ['apps/web/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        // ---- bare JSX text
        {
          selector: `JSXText[value=/${CONTENT}/]`,
          message:
            'L2: no user-facing literal in a component. Add the string to apps/web/src/lib/i18n/locales/hr.json and render it through t(). If this text is not user-facing, it does not belong in JSX.',
        },
        // ---- a string as an element child, braced or templated, branch or not
        {
          selector: `${CHILD_CONTAINER} > ${CONTENT_STRING}`,
          message:
            'L2: a string in braces is still a hard-coded string, and a template literal assembled around a value is also how a date gets built by hand (L6). Add it to apps/web/src/lib/i18n/locales/hr.json and render it through t().',
        },
        {
          selector: `${CHILD_CONTAINER} > ${BRANCH} > ${CONTENT_STRING}`,
          message: BRANCH_MESSAGE,
        },
        {
          selector: `${CHILD_CONTAINER} > ${BRANCH} ${BRANCH} > ${CONTENT_STRING}`,
          message: BRANCH_MESSAGE,
        },
        // ---- an assistive-technology or placeholder string
        {
          selector: `${GUARDED_ATTRIBUTE} > Literal`,
          message: ATTRIBUTE_MESSAGE,
        },
        {
          selector: `${GUARDED_ATTRIBUTE} > JSXExpressionContainer > ${ANY_STRING}`,
          message: ATTRIBUTE_MESSAGE,
        },
        {
          selector: `${GUARDED_ATTRIBUTE} > JSXExpressionContainer > ${BRANCH} > ${ANY_STRING}`,
          message: ATTRIBUTE_MESSAGE,
        },
        {
          selector: `${GUARDED_ATTRIBUTE} > JSXExpressionContainer > ${BRANCH} ${BRANCH} > ${ANY_STRING}`,
          message: ATTRIBUTE_MESSAGE,
        },
        // ---- `label`, on the three built-ins where it renders to the user.
        // Element-qualified, because `label` is user-facing on these three and
        // structural on plenty of components — and only type information could
        // tell those apart, which this config has not got.
        {
          selector: `${LABEL_ATTRIBUTE} > Literal`,
          message: LABEL_MESSAGE,
        },
        {
          selector: `${LABEL_ATTRIBUTE} > JSXExpressionContainer > ${ANY_STRING}`,
          message: LABEL_MESSAGE,
        },
        {
          selector: `${LABEL_ATTRIBUTE} > JSXExpressionContainer > ${BRANCH} > ${ANY_STRING}`,
          message: LABEL_MESSAGE,
        },
        {
          selector: `${LABEL_ATTRIBUTE} > JSXExpressionContainer > ${BRANCH} ${BRANCH} > ${ANY_STRING}`,
          message: LABEL_MESSAGE,
        },
      ],
    },
  },

  // ------------------------------------------------------------ domain purity
  // The second purity layer. The first is module resolution: `packages/domain`
  // declares no dependencies, so with pnpm's isolated linker these specifiers
  // are unresolvable and the build fails. This override restates the rule
  // readably, so the failure names the invariant instead of the resolver.
  {
    files: ['packages/domain/**/*.ts', 'packages/domain/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-*', 'react/*', 'react-dom/*'],
              message:
                'packages/domain is pure (AD-7): no React. UI belongs in apps/web.',
            },
            {
              group: ['@supabase/*'],
              message:
                'packages/domain is pure (AD-7): no Supabase client. Data access belongs in apps/web/src/features/<module>/services, and the client lives in apps/web/src/lib/supabase.',
            },
          ],
        },
      ],
    },
  },

  // ------------------------------------------------------ browser: apps/web
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // ------------------------------------------------ feature boundaries
  // The local rule above, over every source file in the web app. A plugin rule
  // of its own, so it overlaps nothing: a second `no-restricted-imports` or
  // `no-restricted-syntax` object here would REPLACE the one already matching
  // these files (flat config does not merge a rule's options).
  {
    files: ['apps/web/src/**/*.{ts,tsx,js,jsx,mts,cts}'],
    plugins: { shift: shiftPlugin },
    rules: {
      'shift/feature-boundaries': 'error',
    },
  },

  // ------------------------------------------------------------ node: configs
  // `apps/web/src/**/*.test.ts` is here as well as under the browser block
  // above, and this one wins by coming later: those files run under Vitest in
  // the node environment (AD-15), and `format.test.ts` genuinely uses
  // `node:child_process` and `process`. Without this they were linted against
  // browser globals and survived only because `no-undef` is off for `.ts`.
  {
    files: [
      '**/*.config.ts',
      '**/*.config.js',
      'packages/*/test/**/*.ts',
      'test/**/*.ts',
      'apps/web/src/**/*.test.ts',
      // The pipeline's helpers (`.github/workflows/pipeline.yml`): plain Node ESM.
      'scripts/**/*.mjs',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },

  // ------------------------------------------------ node + browser: e2e
  // The Playwright suite runs under Node, and its `page.evaluate` callbacks run
  // in the page, so both sets of globals are real here. The remote smoke
  // (`smoke/`) is the same kind of file.
  {
    files: ['e2e/**/*.ts', 'smoke/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // ------------------------------------------- Deno: the one Edge Function
  {
    files: ['supabase/functions/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.worker,
        Deno: 'readonly',
      },
    },
    rules: {
      // The function is the only place a bare `console` log is worth having:
      // it is the only component with no browser to inspect.
      'no-console': 'off',
    },
  },
];
