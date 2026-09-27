---
title: 'Source structure A — apps/web/src moves into features/, lib/, pages/'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: 'f32f3723b34e12c411963956954e8f0177caf8a1'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/web/src` keeps its feature modules flat beside `routes/`, `i18n/`, `supabase/`, `theme/` and an empty `surfaces/`. The approved proposal (§4.1) and the spine's Source tree now describe `features/<m>/{components,hooks,services,utils}`, `pages/`, `lib/` and `utils/`.

**Approach:** A pure move. Every file goes to its target with `git mv`, and every reference to an old path is rewritten: module specifiers, paths that source-guard tests compute, config and comments. No file's logic changes.

## Boundaries & Constraints

**Always:** Use `git mv`. A test moves with its subject. Keep the `@/` alias style. A source guard keeps exactly its current scope: a directory scan that covered a flat folder covers the same files at their new place (recursively when they now span subfolders). Unit test count, typecheck, lint and `playwright test --list` are identical before and after.

**Ask First:** Any guard whose scope cannot be kept. Any change to logic, exports or file names beyond the mapping. An import cycle or a load-order failure that the move surfaces.

**Never:** No `features/*/index.ts` barrels, no lint boundary rule and no `App.tsx` (deferred to A2). Do not edit `supabase/migrations/*.sql`, which is forward-only even in comments. Do not touch historical specs under `_bmad-output/`. Do not split any page (part B).

</frozen-after-approval>

## Code Map

Mapping (`src/` = `apps/web/src/`, tests follow their subject):
- `routes/*` → `pages/*`, names unchanged, `README.md` included. `routes/prijava.test.ts` → `pages/prijava.test.ts`.
- `components/auth-layout.tsx` → `components/layout/`. `components/utils.ts` → `lib/utils.ts`. `components/initials.ts` → `utils/initials.ts`. `components/ui/` and `components/README.md` stay.
- `i18n/**` → `lib/i18n/**`. `supabase/client.ts` and `README.md` → `lib/supabase/`. `theme/theme.ts` → `lib/theme.ts`.
- `supabase/{address,sign-in,sign-out}.ts` → `features/auth/services/`.
- `calendar/snapshot.ts` → `features/calendar/services/`, and `day-detail`, `grid-keys`, `modifiers`, `month` → `features/calendar/utils/`.
- `hour-bands/{list,write}.ts` → `features/hour-bands/services/` (`list.domain.test.ts` too).
- `members/{list,write,wire}.ts` → `services/`, `position`, `rank` → `utils/`, `team-history.fixture.ts` → the feature root.
- `navigation/chrome.tsx` → `components/`, `dismiss.ts` → `hooks/`, `profile`, `role` → `services/` (they read `members`), `destinations`, `icons`, `messages` → `utils/`, `README.md` → the feature root.
- `organization/lockup.tsx` → `components/`, `snapshot`, `logo` → `services/`, `logo-url` → `hooks/` (`useRenderableLogo`), `accent`, `leave-start`, `messages` → `utils/`.
- `rotation/rotation-section.tsx` → `components/`, `list`, `write`, `history` → `services/`, `draft-store.ts` → `hooks/`, `draft`, `stepper`, `warnings` → `utils/`, `rotation.fixture.ts` → the feature root.
- `shift-types/{list,write}.ts` → `services/`, `ramp.ts` → `utils/`. `teams/{list,write,roster}.ts` → `services/` (`roster` calls an RPC).
- `surfaces/README.md` is deleted, because the spine now carries AD-13's home.

References to rewrite:
- About 480 `@/…` specifiers (`@/routes` 68, `@/components` 152, `@/i18n` 62, `@/navigation` 56, `@/rotation` 48, …). There are no relative imports today.
- Source guards that compute paths (`srcRoot`, `new URL('..')`, `join(srcRoot, 'routes', …)`, `readdirSync`), 18 files: `router.test.ts` (reads `./routes/index.tsx` and `_app.tsx`), `organization/{accent,snapshot,logo}.test.ts`, `calendar/{snapshot,modifiers}.test.ts` (snapshot scans its own directory), `navigation/{destinations,messages}.test.ts`, `supabase/address.test.ts`, `theme/theme.test.ts`, `members/{position,rank}.test.ts`, `rotation/{write,warnings,history,draft}.test.ts`, `i18n/format.test.ts` (walks `src`; allow-list `i18n/format.ts`), `routes/prijava.test.ts` (reads screens and primitives). Depth changes, so `new URL('..')` must be recomputed per file.
- Root tests: `test/admin-auth-boundary.test.ts:18-19`, `test/rls-isolation.test.ts:25`, `test/theme-contrast.test.ts:8` (imports). `test/localization-guard.test.ts:49-51,329` (synthetic probes under `surfaces/`, `routes/` and `components/`: move them to `features/calendar/components/`, `pages/` and `components/`, and point the message at the new `hr.json` path). Comments in `test/*.test.ts`.
- `eslint.config.js:73,75,77,178,184` (`hr.json` path in messages), `:255` (`apps/web/src/supabase` → `apps/web/src/lib/supabase`).
- `apps/web/components.json` aliases: `lib` → `@/lib`, `utils` → `@/lib/utils`, `hooks` → `@/hooks`.
- `hr.json` importers outside `src`: the E2E `i18n.ts` (`e2e/support/` on main today, `e2e/utils/` once part C merges; update whichever exists).
- Path comments: `apps/web/index.html:10`, `DEPLOY.md:458`, `supabase/functions/admin-auth/operations.ts:169,180,316,319`, `.gitleaks.toml:31,33` (the path regex too), `e2e/README.md:66`, and the in-`src` comments and READMEs naming old paths.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/**` -- `git mv` per the mapping. Delete `surfaces/` and the emptied folders -- the layout.
- [x] `apps/web/src/**` -- rewrite every `@/` specifier -- it compiles.
- [x] the 18 guard tests -- recompute path roots and targets for their new depth, and keep every guard's file set -- guards still bite.
- [x] `test/*.test.ts`, `eslint.config.js`, `components.json`, the E2E `i18n.ts`, `.gitleaks.toml` -- new paths.
- [x] comments and READMEs listed above, plus a `rg` sweep for the old folder names -- no stale map.

**Acceptance Criteria:**
- Given the move, when `find apps/web/src -maxdepth 1 -type d` runs, then it lists only `components`, `features`, `lib`, `pages`, `utils` (and `hooks` only if non-empty).
- Given the repo, when `rg -n "src/(routes|surfaces|i18n|supabase|theme|calendar|members|rotation|teams|organization|hour-bands|shift-types|navigation)/" -g '!supabase/migrations/**' -g '!_bmad-output/**' -g '!node_modules/**'` runs, then it finds nothing.
- Given any guard, when its target file is deliberately broken (spot-check three: `format.test.ts` Intl allow-list, `calendar/snapshot` directory scan, `prijava.test.ts` bare `<select>`), then the guard still fails. Revert afterwards.

## Spec Change Log

- **Iteration 1 (review of the first derivation).**
  - **Finding:** `navigation/{role,profile}.ts` and `teams/roster.ts` perform Supabase reads, and `organization/logo-url.ts` exports a `useQuery` hook. The mapping filed all four under `utils/`, which the spine defines as pure rules.
  - **Amended:** the mapping now sends `role`, `profile` and `roster` to `services/`, and `logo-url` to `hooks/`.
  - **Known-bad state avoided:** I/O modules under `utils/`.
  - **KEEP:** every other move, the specifier rewrites, the recursive calendar and rotation sweeps, the root-test and config edits, and the verified test counts.
  - **Re-derivation** applies the four moves on top of the first derivation.

## Verification

**Commands:**
- `pnpm typecheck` and `pnpm lint` -- expected: exit 0.
- `pnpm test` -- expected: pass, with the same test count as the baseline (record it first on the baseline commit).
- `pnpm exec playwright test --list | tail -1` -- expected: unchanged. `pnpm test:e2e` -- expected: all pass.
- `pnpm --filter @shift/web build` -- expected: exit 0.

## Suggested Review Order

**The new tree**

- Where every folder went; the renames are the change, and the contents move unchanged.
  [`spec mapping`](#code-map)

- A page keeps its route and composition; imports now reach into `features/`.
  [`kalendar.tsx:1`](../../apps/web/src/pages/kalendar.tsx#L1)

**Guards that had to follow the move**

- The calendar "only reads" sweep now walks the whole feature, recursively and separator-normalized.
  [`snapshot.test.ts:1`](../../apps/web/src/features/calendar/services/snapshot.test.ts#L1)

- The rotation write sweep pins the subfolders it must see before it checks them.
  [`write.test.ts:697`](../../apps/web/src/features/rotation/services/write.test.ts#L697)

- The Intl allow-list resolves `srcRoot` from the new depth.
  [`format.test.ts:57`](../../apps/web/src/lib/i18n/format.test.ts#L57)

- The localization rule is probed where components now live (four probes).
  [`localization-guard.test.ts:48`](../../test/localization-guard.test.ts#L48)

**Config**

- The domain-purity message points data access at `features/<module>/services`.
  [`eslint.config.js:255`](../../eslint.config.js#L255)

- The shadcn aliases follow `lib/`.
  [`components.json:1`](../../apps/web/components.json#L1)
