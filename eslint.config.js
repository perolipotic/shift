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
  'L2: a literal in a ternary or a guard is still a hard-coded string, and a branch between two words is also how a plural gets hand-rolled (L7). Add both outcomes to apps/web/src/i18n/locales/hr.json and branch between t() calls.';
const ATTRIBUTE_MESSAGE =
  'L2: an assistive-technology or placeholder string is user-facing too — braces, a template literal and a ternary do not change that. Add it to apps/web/src/i18n/locales/hr.json and pass t() instead.';
const LABEL_MESSAGE =
  'L2: the label on an optgroup, option or track renders to the user. Add it to apps/web/src/i18n/locales/hr.json and pass t().';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '_bmad/**',
      '_bmad-output/**',
    ],
  },

  js.configs.recommended,

  // ---------------------------------------------------------------- TypeScript
  {
    files: ['**/*.ts'],
    languageOptions: babel({ jsx: false }),
  },
  {
    files: ['**/*.tsx'],
    languageOptions: babel({ jsx: true }),
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
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
            'L2: no user-facing literal in a component. Add the string to apps/web/src/i18n/locales/hr.json and render it through t(). If this text is not user-facing, it does not belong in JSX.',
        },
        // ---- a string as an element child, braced or templated, branch or not
        {
          selector: `${CHILD_CONTAINER} > ${CONTENT_STRING}`,
          message:
            'L2: a string in braces is still a hard-coded string, and a template literal assembled around a value is also how a date gets built by hand (L6). Add it to apps/web/src/i18n/locales/hr.json and render it through t().',
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
                'packages/domain is pure (AD-7): no Supabase client. Data access belongs in apps/web/src/supabase.',
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
    ],
    languageOptions: {
      globals: globals.node,
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
