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
  // Two boundaries are drawn deliberately, and both are asserted in
  // `test/localization-guard.test.ts` with cases of BOTH polarities.
  //
  //   - SEPARATOR PUNCTUATION IS NOT CONTENT. `{start} – {end}` and `{label}:`
  //     leave `JSXText` nodes holding nothing but a dash or a colon, and firing
  //     on those is a false positive in a merge-blocking rule — the fastest
  //     route to someone reaching for `eslint-disable`, which costs more than
  //     the rule earns. Hence the character class rather than `\S`. Human-
  //     approved 2026-09-04. `<p>Danas</p>` still fires; so does any text with
  //     one letter or digit in it.
  //   - A BRACED STRING IS STILL A STRING, but only where the string is
  //     content. `{'Danas'}` as an element child is a literal in disguise;
  //     `className={'flex'}` is not user-facing and must stay silent, so the
  //     child selectors are parented to `JSXElement`/`JSXFragment` and the
  //     attribute case is named separately against the guarded attributes only.
  //     `{' '}` — the JSX space idiom — is whitespace and passes.
  {
    files: ['apps/web/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/[^\\s\\-–—:,.()\\/|•]/]',
          message:
            'L2: no user-facing literal in a component. Add the string to apps/web/src/i18n/locales/hr.json and render it through t(). If this text is not user-facing, it does not belong in JSX.',
        },
        {
          selector:
            ":matches(JSXElement, JSXFragment) > JSXExpressionContainer > Literal[raw=/^['\"]/][value=/[^\\s\\-–—:,.()\\/|•]/]",
          message:
            'L2: a string in braces is still a hard-coded string. Add it to apps/web/src/i18n/locales/hr.json and render it through t().',
        },
        {
          selector:
            ':matches(JSXElement, JSXFragment) > JSXExpressionContainer > TemplateLiteral:has(TemplateElement[value.raw=/[^\\s\\-–—:,.()\\/|•]/])',
          message:
            'L2: a template literal is still a hard-coded string, and assembling one around a value is also how a date gets built by hand (L6). Add the message to apps/web/src/i18n/locales/hr.json and let t() interpolate.',
        },
        {
          selector:
            'JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|aria-valuetext|placeholder|title|alt)$/] > Literal',
          message:
            'L2: an assistive-technology or placeholder string is user-facing too. Add it to apps/web/src/i18n/locales/hr.json and pass t() instead of a literal.',
        },
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|aria-description|aria-roledescription|aria-valuetext|placeholder|title|alt)$/] > JSXExpressionContainer > Literal[raw=/^['\"]/]",
          message:
            'L2: braces do not make an assistive-technology string acceptable. Add it to apps/web/src/i18n/locales/hr.json and pass t().',
        },
        {
          // Element-qualified, because `label` is user-facing on these three
          // built-ins and structural on plenty of components — and only type
          // information could tell those apart, which this config has not got.
          selector:
            'JSXOpeningElement[name.name=/^(optgroup|option|track)$/] > JSXAttribute[name.name="label"] > Literal',
          message:
            'L2: the label on an optgroup, option or track renders to the user. Add it to apps/web/src/i18n/locales/hr.json and pass t().',
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
