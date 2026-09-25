import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// AD-15: node environment, explicitly. jsdom must never enter this dependency
// tree — a rule exercised only through a rendered component is not covered.
//
// `include` names `.ts` only, deliberately: with jsdom banned there is no DOM
// to render into, so a `.tsx` test here could only be a component test that
// AD-15 does not accept. `passWithNoTests` stays off — this package has tests,
// and a config that hides their disappearance is the defect it once was.
//
// The `@` alias is declared here as well as in `vite.config.ts`. This config
// does not extend that one on purpose: tests need no React plugin and no
// Tailwind pass, and inheriting them would make every run slower and couple the
// suite to the build pipeline.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // STORY 2.1b. Read from source, as `vite.config.ts` does, so the suite
      // needs no domain build.
      '@shift/domain': fileURLToPath(
        new URL('../../packages/domain/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
