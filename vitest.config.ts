import { defineConfig } from 'vitest/config';

// AD-15: every rule is asserted without a browser, so the node environment is
// explicit and jsdom must never enter this dependency tree.
//
// This project covers repository-level invariants that belong to no single
// package: the privileged boundary's transport decisions, key hygiene across
// the client tree, the static-host fallback, and the shape of the Supabase
// scaffold. Package-local tests stay in their own package and run via `pnpm -r`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
