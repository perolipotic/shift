import { defineConfig } from 'vitest/config';

// AD-15: every rule is asserted without a browser. The node environment is
// explicit here and jsdom must never enter this dependency tree.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
