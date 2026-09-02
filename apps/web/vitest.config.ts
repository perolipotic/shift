import { defineConfig } from 'vitest/config';

// AD-15: node environment, explicitly. jsdom must never enter this dependency
// tree — a rule exercised only through a rendered component is not covered.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    passWithNoTests: true,
  },
});
