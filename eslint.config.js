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
  {
    files: ['**/*.config.ts', '**/*.config.js', 'packages/*/test/**/*.ts', 'test/**/*.ts'],
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
