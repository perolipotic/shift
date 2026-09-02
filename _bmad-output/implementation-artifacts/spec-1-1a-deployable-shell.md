---
title: 'Story 1.1a — A deployable shell'
type: 'feature'
created: '2026-09-02'
status: 'done'
review_loop_iteration: 0
baseline_commit: '6a4a0b370dfaa066208dda56cbceff0f250b5714'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repository holds only planning artifacts. Every later story inherits the workspace shape, the domain-purity guarantee and the migration path from this one, and none exist.

**Approach:** Author the workspace directly — no generated starter — as a pnpm monorepo of `packages/domain`, `apps/web` and `supabase/`, where `packages/domain` declaring zero dependencies makes purity a module-resolution property rather than a review convention. Ship the one privileged Edge Function as a deployable boundary, forward-only migrations, and a Cloudflare Pages deploy path the human executes.

## Boundaries & Constraints

**Always:**
- `packages/domain` has no `dependencies` key — build-time-only `devDependencies` (typescript, vitest) are fine, since purity is about the runtime graph. pnpm strict isolation makes `import 'react'` or `import '@supabase/supabase-js'` there an unresolvable-module build failure; an ESLint `no-restricted-imports` override restates it readably.
- Versions pinned exactly as listed in `epic-1-context.md` — no ranges, no upgrades.
- The bundle ships `sb_publishable_*` only; `sb_secret_*` lives solely in the Edge Function's per-environment env (AD-17).
- Migrations are forward-only git files, promoted local→staging→production, never edited after promotion.
- Vitest in the node environment; no jsdom in the dependency tree (AD-15).
- Directory shape exactly as the spine fixes it: `packages/domain/{src,test}`, `apps/web/src/{routes,surfaces,components,i18n,supabase}`, `supabase/{migrations,functions/admin-auth}`.

**Ask First:**
- A second Edge Function, any server tier, any SSR (amends AD-14).
- Deviating from a pinned version, or a runtime dependency not named in the spine.
- Any typed-lint setup — the TypeScript 5.x fallback was declined.

**Never:**
- No theme tokens, no i18n resources, no sign-in screen, no user-facing string of any kind — story 1.1b. `apps/web` renders a shell with no text.
- No auth wiring, no session handling, no Supabase queries from the UI — story 1.3.
- No domain logic or `engine-rules.md` rule in the Edge Function, and no domain-table write with the secret key (AD-16).
- No tables, no RLS, no members — schema arrives in 1.2.
- No starter boilerplate left behind: no template README, no demo component, no unused asset.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Domain purity | `import 'react'` or `'@supabase/supabase-js'` in `packages/domain/src` | `pnpm build` fails: module not resolvable | Exits non-zero |
| Secret key leak | Built `dist/` grepped for `sb_secret_` | Zero matches | Verification fails |
| Function invoked | createUser / updateUserById / ban | `{ code: 'NOT_IMPLEMENTED' }`, HTTP 501 | Authorization lands in 1.2 |
| Function misconfigured | Secret env absent | Fails fast with a stable code | Never falls back to publishable |
| Migration reset | `supabase db reset` on clean local | `btree_gist` enabled, seed loads | Non-zero on any SQL error |
| SPA deep link | `GET /some/deep/route` on the host | Serves `index.html`, HTTP 200 | No 404 for client routes |

</frozen-after-approval>

## Code Map

Greenfield — no source file exists. Commit `455f2d2` holds planning artifacts only. Every path below is created here.

- `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`, `.npmrc` -- workspace over `packages/*` and `apps/*`; `.npmrc` must not relax strict isolation or the purity guard dies
- `eslint.config.js` -- flat config; the `packages/domain/**` override is the second purity layer
- `packages/domain/{package.json,tsconfig.json,src/index.ts,test/}` -- the pure leaf; `test/` is where 1.2+ put the pilot and UJ-5 fixtures
- `apps/web/{package.json,vite.config.ts,vitest.config.ts,index.html,src/main.tsx}` -- SPA entry; Tailwind and shadcn initialised, no tokens authored
- `apps/web/src/{routes,surfaces,components,i18n,supabase}/` -- all five spine directories; empty ones get a one-line README naming what belongs there
- `supabase/{config.toml,migrations/0001_extensions.sql,seed.sql}` -- local CLI config, first forward-only migration, both fixture sections
- `supabase/functions/admin-auth/index.ts` -- the single privileged boundary; two clients, secret for the auth call only
- `DEPLOY.md` -- Cloudflare Pages setup, env placement, and the migration promotion runbook

Pinned versions, the directory tree and AD-14/16/17 are in the loaded `epic-1-context.md` — do not re-derive them.

## Tasks & Acceptance

**Execution:**
- [x] `pnpm-workspace.yaml`, `package.json`, `.npmrc`, `.gitignore`, `tsconfig.base.json` -- workspace, pinned versions, strict TS base, root scripts `build`/`lint`/`typecheck`/`test` fanning out -- fixes the shape everything inherits
- [x] `packages/domain/*` -- no `dependencies` key, strict tsconfig extending the base, placeholder `src/index.ts`, empty `test/` -- makes purity a resolution property
- [x] `eslint.config.js` -- flat config plus a `packages/domain/**` override banning `react`, `react-*`, `@supabase/*` -- readable failure alongside the resolution failure
- [x] `apps/web/*` -- Vite + React + Tailwind + shadcn init + TanStack Router; create all five directories; strip every trace of starter boilerplate -- the skeleton, rendering no text
- [x] `apps/web/vitest.config.ts`, `packages/domain/vitest.config.ts` -- node environment explicitly, no jsdom -- AD-15
- [x] `packages/domain/test/purity.test.ts` -- assert no `dependencies` key and no banned specifier in sources -- catches regressions without needing a failed build
- [x] `supabase/config.toml`, `supabase/migrations/0001_extensions.sql` -- local config; enable `btree_gist`, which AD-3's leave exclusion needs downstream -- makes the path real enough to promote
- [x] `supabase/seed.sql` -- pilot and UJ-5 section headers, no executable rows yet (no tables exist), marked local/test-only -- reserves the shape 1.2 fills
- [x] `supabase/functions/admin-auth/index.ts` -- secret-key client for auth only, caller-JWT client for domain writes, fail fast on missing secret env, all operations return `NOT_IMPLEMENTED` / 501 -- AD-16, AD-17
- [x] SPA fallback + build-env config for Cloudflare Pages -- deep links serve `index.html`; publishable key injected at build -- the deploy shape
- [x] `DEPLOY.md` -- project setup, which key goes where per environment, ordered local→staging→production promotion runbook -- the human executes this and reports back

**Acceptance Criteria:**
- Given a clean checkout, when `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` runs, then every command exits 0
- Given the repository tree, when inspected, then the spine's exact directory shape exists with a forward-only `migrations/` and a `seed.sql`
- Given the built output, when inspected, then it is a static SPA with no server runtime and no SSR output, and exactly one Edge Function exists in the repository
- Given `DEPLOY.md`, when a human follows it end to end, then the local→staging→production migration path is exercisable with no further decisions

## Spec Change Log

## Design Notes

**Why purity is a resolution property.** pnpm links only what a package declares. Declaring nothing means `import 'react'` cannot resolve, so the build fails before any lint rule runs. npm workspaces were rejected because hoisting lets that import resolve locally and fail only in CI. Consequence: `.npmrc` must never set `node-linker=hoisted` or `shamefully-hoist=true`.

**`seed.sql` and the fixture contradiction.** SPEC forbids pilot specifics in the core; the spine mandates a seed carrying both fixtures. Reconciled by treating seed data as local and test-only — never bundled, never a default, never branched on by code.

**The boundary exists but cannot yet authorize.** AD-16 requires authorization against the database, and no `members` table exists until 1.2. So it ships with the security-critical parts correct — two-client construction, env handling — and returns `NOT_IMPLEMENTED`.

## Verification

**Commands:**
- `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- expected: exit 0
- `printf "\nimport 'react'\n" >> packages/domain/src/index.ts && pnpm build; git checkout packages/domain/src/index.ts` -- expected: non-zero on unresolvable module, then reverted
- `grep -rn "sb_secret_" apps/web/dist/ || echo CLEAN` -- expected: `CLEAN`
- `pnpm ls --recursive jsdom || echo NO-JSDOM` -- expected: `NO-JSDOM`
- `supabase db reset` -- expected: migration applies, seed loads without error
- `ls supabase/functions/` -- expected: exactly one entry, `admin-auth`

**Manual checks (if no CLI):**
- `apps/web/dist/` contains no starter boilerplate and no user-facing text
- Live Cloudflare Pages deploy and the staging→production promotion, per `DEPLOY.md` — executed by the human, then reported back

## Suggested Review Order

**The purity guard — the story's central mechanism**

- Start here: strict isolation is what makes an impure import unresolvable rather than merely discouraged.
  [`.npmrc:4`](../../.npmrc#L4)

- No `dependencies` key at all, so pnpm links nothing for the resolver to find.
  [`package.json:2`](../../packages/domain/package.json#L2)

- The readable second layer, so the failure names the invariant instead of the resolver.
  [`eslint.config.js:67`](../../eslint.config.js#L67)

- Allowlist, not denylist: `src/` permits relative specifiers only, so `npm:` and `jsr:` fail too.
  [`purity.test.ts:31`](../../packages/domain/test/purity.test.ts#L31)

- Asserts the guard's own precondition, since flipping the linker would silently disarm it.
  [`workspace-isolation.test.ts:13`](../../test/workspace-isolation.test.ts#L13)

**The privileged boundary**

- Env validation with no fallback: a wrong-shaped secret refuses every request rather than downgrading.
  [`handler.ts:72`](../../supabase/functions/admin-auth/handler.ts#L72)

- Two clients — secret for the auth call only, caller JWT for domain writes, so RLS survives.
  [`index.ts:63`](../../supabase/functions/admin-auth/index.ts#L63)

- Refuses to act: authorization needs a `members` table that arrives in 1.2.
  [`handler.ts:191`](../../supabase/functions/admin-auth/handler.ts#L191)

- `Vary` is unconditional so a shared cache cannot replay a header-less response to an allowed origin.
  [`handler.ts:107`](../../supabase/functions/admin-auth/handler.ts#L107)

- The gap the reviews caught: inverting the allowlist used to keep every test green.
  [`admin-auth-boundary.test.ts:170`](../../test/admin-auth-boundary.test.ts#L170)

**Key containment**

- Two passes: comment-aware for naming, comment-blind for real key material over tracked files.
  [`key-hygiene.test.ts:58`](../../test/key-hygiene.test.ts#L58)

**The Supabase scaffold**

- The first forward-only migration; `btree_gist` is what lets AD-3's leave constraint be pure schema.
  [`0001_extensions.sql:11`](../../supabase/migrations/0001_extensions.sql#L11)

- Both fixtures reserved in order, executable in 1.2 — deliberately empty while no table exists.
  [`seed.sql:22`](../../supabase/seed.sql#L22)

- Asserts the contiguity its name promises, so a missing migration cannot pass.
  [`supabase-scaffold.test.ts:8`](../../test/supabase-scaffold.test.ts#L8)

**The static host**

- No server can route a deep link, so every unmatched path is index.html at 200 — never a redirect.
  [`_redirects:4`](../../apps/web/public/_redirects#L4)

- Skips visibly rather than passing vacuously when nothing has been built.
  [`static-hosting.test.ts:20`](../../test/static-hosting.test.ts#L20)

**The deploy path — you execute this**

- `config.toml` is local-only, so this blocking step is what keeps signup closed on staging and production.
  [`DEPLOY.md:46`](../../DEPLOY.md#L46)

- The dependency ellipsis keeps the build correct once `apps/web` imports the domain package.
  [`DEPLOY.md:73`](../../DEPLOY.md#L73)

**Peripherals**

- Code-based routing keeps every route in `routes/`; the plugin is not published at the pinned version.
  [`router.ts:8`](../../apps/web/src/router.ts#L8)

- Type-checks the privileged boundary and the tests, which sat outside every project.
  [`tsconfig.json:16`](../../tsconfig.json#L16)
