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
    // Two files in this project talk to one local Postgres:
    // `provisioning.test.ts` counts and health-checks the seeded fixture
    // organizations, and `rls-isolation.test.ts` commits throwaway members into
    // those same organizations and holds open transactions that write
    // `auth.users.banned_until` on fixture accounts. Run in parallel workers
    // they interleave, and the failure is a flake rather than a diagnosis: the
    // 1.3a review reproduced it as `nullTokens=1` and `identities != accounts`
    // in `provisioning.test.ts` while a throwaway member existed.
    //
    // Serializing is the blunt fix and the right one here. The whole project
    // runs in under four seconds, so the wall-clock cost is not worth a
    // per-file advisory lock, and unlike the narrower fixes it also covers the
    // lock waits and deadlocks the two files can produce against each other.
    fileParallelism: false,
  },
});
