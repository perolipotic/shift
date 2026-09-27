---
title: 'Source structure C — the E2E suite in tests/<feature>/ and utils/'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: 'f32f3723b34e12c411963956954e8f0177caf8a1'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 11 specs, the setup project and the helpers sit flat in `e2e/` and `e2e/support/`. The approved source-structure proposal (§4.2) wants specs grouped by feature and helpers under `utils/`, the layout part D's page objects will slot into.

**Approach:** Move the files with `git mv` into `e2e/tests/<feature>/`, `e2e/tests/auth.setup.ts` and `e2e/utils/`, rename three helpers, and rewrite every import and path reference. Behaviour does not change.

## Boundaries & Constraints

**Always:** Use `git mv` so history follows. Keep the folder name `e2e/`. `e2e/.auth/` stays where it is. Every spec keeps its file name. The `playwright test --list` total stays **68 tests in 12 files**.

**Ask First:** Any change to a test body, a locator or an assertion. Any change outside the files in the Code Map.

**Never:** No page objects (that is part D). No `data/` folder and no separate workflow file (proposal §4.2 Δ). No change to `apps/web`, `packages/`, `smoke/`'s own layout, or CI workflow files.

</frozen-after-approval>

## Code Map

- `e2e/*.spec.ts` → `e2e/tests/auth/{sign-in,authorization}`, `calendar/calendar`, `people/{people,fire-ranks,team-position}`, `teams/teams`, `hour-bands/hour-bands`, `rotation/{rotation,rotation-phone}`, `layout/responsive` (`.spec.ts`). Imports go from `./support/x.ts` to `../../utils/x.ts`.
- `e2e/auth.setup.ts` → `e2e/tests/auth.setup.ts`. Imports go to `../utils/`.
- `e2e/support/test.ts` → `e2e/utils/custom-fixtures.ts`. `support/database.ts` → `utils/database-helper.ts`. `support/fixture.ts` → `utils/run-fixture.ts`. `i18n`, `layout`, `members`, `rotation`, `sign-in` and `require-stack` keep their names in `utils/`.
- `e2e/global-setup.ts`, `e2e/global-teardown.ts` → `e2e/utils/`. Their imports become `./database-helper.ts` and `./run-fixture.ts`.
- Helper-to-helper imports: `run-fixture.ts:8` and `require-stack.ts:7` import `./database.ts`, and `rotation.ts:4` imports `./test.ts`. `custom-fixtures.ts:3` imports `./fixture.ts`.
- Path-by-URL code is depth-safe (`support/` and `utils/` sit at the same depth): `run-fixture.ts:34` `../.auth/`, `:41` `../../supabase/operator/…`, `i18n.ts:1` `../../apps/web/src/i18n/locales/hr.json`. Verify, do not change.
- `playwright.config.ts` -- `testDir: 'e2e'` (line 16), `globalSetup`/`globalTeardown` (20–21), `node e2e/support/require-stack.ts` (48), comment on line 9. `testMatch: /auth\.setup\.ts$/` is unchanged.
- `smoke/deployment.spec.ts:3-4,83` -- imports `../e2e/support/{i18n,sign-in}.ts`.
- `test/e2e-fixture.test.ts:8-9,220,231` -- imports `database`/`fixture`, and spawns `e2e/support/require-stack.ts` and `./e2e/global-setup.ts` by path.
- Comments: `e2e/tsconfig.json:14`, `smoke/tsconfig.json:11`, `e2e/README.md:17,41,66,70`. `eslint.config.js:297` (`e2e/**/*.ts`) and the `include` in `e2e/tsconfig.json` are glob-safe, so they are unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `e2e/` -- `git mv` every file per the Code Map, then delete the empty `support/` -- the layout itself.
- [x] `e2e/tests/**`, `e2e/utils/**` -- rewrite relative imports to the new paths and names -- the suite compiles.
- [x] `playwright.config.ts` -- `testDir: 'e2e/tests'`, `./e2e/utils/global-{setup,teardown}.ts`, `node e2e/utils/require-stack.ts`, doc comment -- Playwright finds the same tests.
- [x] `smoke/deployment.spec.ts`, `test/e2e-fixture.test.ts` -- point at `e2e/utils/…` -- the two outside consumers.
- [x] `e2e/README.md` -- rewrite the path references and add a short "Layout" section (`tests/<feature>/`, `utils/`, and `pages/` coming in part D) -- the README is the suite's map.
- [x] `e2e/tsconfig.json`, `smoke/tsconfig.json` -- fix the path comments.

**Acceptance Criteria:**
- Given the moved suite, when `pnpm exec playwright test --list` runs, then it reports 68 tests in 12 files, the setup project included.
- Given the repo, when `grep -rn "e2e/support" --exclude-dir=node_modules --exclude-dir=_bmad-output .` runs and `grep -rn "\./support/" e2e` runs, then neither finds anything (`smoke/support/` is smoke's own folder and stays).
- Given the local stack, when `pnpm test:e2e` runs, then every test passes as on `main`.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: exit 0 (covers `e2e/`, `smoke/` and `playwright.config.ts`).
- `pnpm lint` -- expected: exit 0.
- `pnpm exec playwright test --list | tail -1` -- expected: `Total: 68 tests in 12 files`.
- `pnpm exec vitest run test/e2e-fixture.test.ts` -- expected: pass (it spawns the moved scripts by path).
- `pnpm test:e2e` -- expected: all pass. Playwright starts Vite itself (`reuseExistingServer`).

## Suggested Review Order

**Discovery and lifecycle**

- Playwright now discovers only `e2e/tests`, so helpers can never be picked up as specs.
  [`playwright.config.ts:15`](../../playwright.config.ts#L15)

- Global setup, teardown and the stack check are pointed at `utils/`.
  [`playwright.config.ts:20`](../../playwright.config.ts#L20)

- The stack check runs by path before the web servers start.
  [`playwright.config.ts:48`](../../playwright.config.ts#L48)

**Moved specs and helpers**

- A representative spec: imports go two levels up to `utils/`.
  [`calendar.spec.ts:5`](../../e2e/tests/calendar/calendar.spec.ts#L5)

- `.auth/` and the operator SQL resolve by URL from the same depth as before.
  [`run-fixture.ts:34`](../../e2e/utils/run-fixture.ts#L34)

**Outside consumers**

- The smoke suite reuses the E2E sign-in and i18n helpers.
  [`deployment.spec.ts:3`](../../smoke/deployment.spec.ts#L3)

- The fixture unit test spawns the moved scripts by their new paths.
  [`e2e-fixture.test.ts:220`](../../test/e2e-fixture.test.ts#L220)

**Docs**

- The README's new Layout section is the suite's map.
  [`README.md:37`](../../e2e/README.md#L37)
