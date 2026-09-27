---
title: 'Source structure A2b — a lint rule holds each feature to its public modules'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: '8d3be9e4fe2c0f9fc4c4c6e84fafd208ca5993fc'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing enforces the feature boundaries in `apps/web/src/features/`. Any file may deep-import any module of any other feature. The approved proposal (§4.1) and the spine's Module-boundaries convention name `features/<m>/index.ts` barrels as the public API. On 2026-09-27 the human decided against whole-feature barrels, because they would join navigation, organization, members, teams, rotation, shift-types and hour-bands into one import cycle. Two top-level consts would then face TDZ crashes (`members/services/list.ts` `LEVEL_FILTERS`, `rotation/utils/draft.ts` `NO_CLOCK_RANGE`). Barrels would also make a service-only importer load the other feature's components.

**Approach:** Enforce boundaries with ESLint `no-restricted-imports` blocks generated in `eslint.config.js` from one explicit map, `FEATURE_PUBLIC`. The map lists, per feature, the modules other features may import. The rules:
- A feature may deep-import its own modules freely.
- A feature may import another feature's modules only if `FEATURE_PUBLIC` lists them.
- Pages and the other non-feature files may also import any feature's `components/**` and `hooks/**`. The non-feature files are `pages/**`, `components/**`, `lib/**`, `utils/**`, `router.ts`, `App.tsx` and `main.tsx`.
- Tests (`*.test.*`) and fixtures (`*.fixture.*`) are exempt.

No barrel files are added. No import changes, because the map starts as exactly what is imported across features today. Update the spine and the proposal to state the rule.

## Boundaries & Constraints

**Always:**
- `FEATURE_PUBLIC` is derived from today's actual cross-feature and page imports, not guessed. Every entry is a module path, never a folder glob. It carries a one-line comment naming its consumers.
- The blocks do not overlap. In flat config a later object that matches the same file replaces the rule rather than merging it. So generate:
  - one object per feature, `files: ['apps/web/src/features/<m>/**']`;
  - one object for the non-feature files.

  The feature list comes from `readdirSync` over `apps/web/src/features`, so a new feature is covered automatically.
- Error messages name the rule and the fix. For example: "import it from one of `<m>`'s public modules (`FEATURE_PUBLIC` in eslint.config.js), or add a module there deliberately."
- Add a test that lints probe files through the real config (the `test/localization-guard.test.ts` pattern). It proves that:
  - a cross-feature deep import of a non-public module fails;
  - a public module passes;
  - a same-feature deep import passes;
  - a page importing another feature's `components/`/`hooks/` passes;
  - a feature importing another feature's `components/`/`hooks/` fails, unless that module is public;
  - a relative `../../<feature>/…` import across features fails too.
- Replace the spine's Module-boundaries convention row with the lint-rule wording. The proposal gets a dated note under §4.1 recording the decision and why.

**Ask First:**
- Any import that would have to change for the rule to pass.
- Any feature that needs a folder-wide allowance.

**Never:**
- No `index.ts`/barrel files.
- No change to any source import or behaviour.
- No change to test guards that pin literal import paths.

</frozen-after-approval>

## Code Map

- `eslint.config.js` -- a single root flat config (about 318 lines). `no-restricted-imports` is used only for `packages/domain/**`. Add the generated blocks after the `apps/web` blocks.
- Today's cross-feature public surface (from investigation, to be re-derived by script):
  - **auth:** `services/sign-out` (navigation).
  - **hour-bands:** `services/list` and `services/write` (shift-types, teams).
  - **members:** `services/list`, `utils/rank`, `utils/position` (organization, teams, hour-bands, shift-types, calendar, navigation?).
  - **navigation:** `services/role`, `utils/destinations` (members, calendar, others).
  - **organization:** `services/snapshot`, `components/lockup`, `hooks/logo-url`, `utils/accent` (members, navigation, teams).
  - **rotation:** `services/list`, `services/write`?, `utils/*` as used (teams, shift-types, calendar).
  - **shift-types:** `services/list` (calendar, rotation).
  - **teams:** `services/list`, `services/write`, `services/roster` (members, hour-bands, rotation, shift-types, calendar).
  - **calendar:** none (only `rotation/rotation.fixture.ts`, which is exempt).
- Pages today also import from feature `services`/`utils` (e.g. `mayReadMembers`, the `*MessageKey` functions). Each such module joins that feature's `FEATURE_PUBLIC`, with the page named as its consumer.
- `test/localization-guard.test.ts` -- the probe-lint pattern to mirror, in a new `test/feature-boundaries.test.ts`.
- `ARCHITECTURE-SPINE.md` -- the Consistency Conventions row "Module boundaries".

## Tasks & Acceptance

**Execution:**
- [x] `eslint.config.js` -- add `FEATURE_PUBLIC` and the generated blocks.
- [x] `test/feature-boundaries.test.ts` -- add probes through the real config.
- [x] `ARCHITECTURE-SPINE.md`, `sprint-change-proposal-2026-09-27-source-structure.md` -- update the convention and add the dated note.
- [x] `deferred-work.md` -- remove the A2b entry.

**Acceptance Criteria:**
- Given the repo, when `pnpm lint` runs, then it exits 0 with no import changed (`git diff -- apps` shows only `eslint.config.js` if that is where the config lives, and nothing under `apps/web/src`).
- Given a planted cross-feature deep import of a non-public module in a component, when `pnpm lint` runs, then it fails with the rule's message. Revert afterwards.
- Given the suite, when `pnpm typecheck`, `pnpm test` and `pnpm test:e2e` run, then all pass. Counts grow only by the new test file, and E2E stays 78/78.

## Verification

**Commands:**
- `pnpm lint`, `pnpm typecheck` -- expected: exit 0.
- `pnpm exec vitest run test/feature-boundaries.test.ts` -- expected: pass.
- `pnpm test`, `pnpm test:e2e` -- expected: pass. Do not run them in parallel.

## Spec Change Log

- **Review round 1 (2026-09-27).** Both reviewers verified that the regex `no-restricted-imports` approach missed every one of these (0 reports):
  - `./features/…` from root files;
  - `..` mid-path and `//` in the path;
  - mis-cased paths;
  - dynamic `import()`;
  - new top-level files;
  - `.mts`, `.cts` and `.jsx` files.

  A second `no-restricted-syntax` object would also have replaced the L2 string rule.

  **Amended:** a local rule, `shift/feature-boundaries`, driven by `FEATURE_PUBLIC`, resolves and normalises every specifier (all import forms). It refuses any specifier that isn't plain or is mis-cased, and matches public modules exactly. It covers all of `apps/web/src` and forbids feature → app-level imports.

  **KEEP:** the `FEATURE_PUBLIC` map and the fact that no source import changes.

## Suggested Review Order

- The public-module map, one line per consumer set.
  [`eslint.config.js:111`](../../eslint.config.js#L111)

- The local rule: resolve, normalise, decide by where the path lands.
  [`eslint.config.js:96`](../../eslint.config.js#L96)

- Probes through the real config, every import form and every bypass the review found.
  [`feature-boundaries.test.ts:1`](../../test/feature-boundaries.test.ts#L1)
