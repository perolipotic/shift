---
title: 'CI/CD pipeline on GitHub Actions: quality, build, E2E, staging, smoke, gated production'
type: 'chore'
created: '2026-09-25'
status: 'done'
baseline_commit: '7381a15ba96d11c76b8a2d914cfd46ad38a55ae4'
review_loop_iteration: 0
context: ['{project-root}/DEPLOY.md', '{project-root}/e2e/README.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no CI. Lint, typecheck, the DB-gated Vitest suites and the E2E suite (#42) run only when someone remembers to run them. Deployment is a manual runbook (DEPLOY.md §5), and the Git-connected Cloudflare Pages project would publish `main` with no gate.

**Approach:** One GitHub Actions workflow follows the human's diagram. Stage 1 runs Gitleaks and ESLint. Stage 2 runs typecheck and the build. Before any deploy, the Vitest suite and the full E2E suite run against a local Supabase in the runner. On `main` the pipeline continues: deploy staging (migrations, config, function, Pages via wrangler Direct Upload), run a read-only smoke against the staging URL, then deploy production behind a manual approval. Human decisions of 2026-09-25, not to be relitigated:
1. The hosted projects do not exist yet, so deploy jobs skip with a notice until they are configured.
2. Smoke runs both ways: the full E2E suite locally in CI, and a short read-only smoke on staging.
3. Migrations, config and the function are deployed automatically.
4. Production requires an approval in the `production` Environment.

## Boundaries & Constraints

**Always:**
- Pull requests run Stage 1, Stage 2, `test` and `e2e` only. Pushes to `main` run the whole chain.
- Pin every third-party action to a full commit SHA with a version comment. Default `permissions: contents: read`, widened per job only where needed.
- Take Node from `.nvmrc` and pnpm from `packageManager`, with a cached store, and install with `pnpm install --frozen-lockfile`.
- Deploy order per environment follows DEPLOY.md §5.2/§5.2b: `link` → `db push` → `migration list` → `config push` → `secrets set --env-file` → `functions deploy admin-auth` → build with that environment's `VITE_*` → `wrangler pages deploy`. `db push` always runs before `config push`.
- `site_url`/`additional_redirect_urls` are set for the target environment by rewriting the runner's copy of `supabase/config.toml` just before `config push`. The committed file keeps its local values.
- Deploys are enabled by the repository variable `DEPLOY_ENABLED == 'true'`. When it is unset, the deploy jobs are skipped and the run summary says what to configure. When it is set but a required secret or variable is missing, the job fails and names the missing item.
- Secrets never reach a log or a committed file. Env files are written with a heredoc from `${{ secrets.* }}` and deleted after use.

**Ask First:**
- Any change under `apps/web/src`, `supabase/migrations` or `supabase/functions`, or to `supabase/config.toml`.
- A Gitleaks finding that is not one of the known fake or local values (Code Map). Do not allowlist it silently.

**Never:**
- `db push --include-seed`, `db reset` against a hosted project, or `--no-verify`-style bypasses.
- Automatic deploys through the Pages Git integration.
- Secret values in `.github/**`: no `sb_secret_` followed by 20+ characters (`test/key-hygiene.test.ts:39`).
- Automating the manual steps: creating projects, un-pausing a project, provisioning organizations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pull request | any PR to `main` | quality → build → test + e2e run; no deploy job runs | red check blocks merge |
| Push to main, not configured | `DEPLOY_ENABLED` unset | CI green; deploy/smoke/production skipped with a summary notice | N/A |
| Push to main, configured | all secrets and vars set | staging deploy → smoke → waits for approval → production deploy | a failing job stops the chain, and production never starts |
| Enabled but incomplete | a required secret is missing | the deploy job fails and names it | no remote command runs |
| Secret committed | a new real key in the diff | the gitleaks job fails | N/A |

</frozen-after-approval>

## Code Map

- `DEPLOY.md:43-62,173-205,209-266,302-309,350-375,474-483,582-587` -- CLI auth via `SUPABASE_ACCESS_TOKEN` + `link --password`; function secrets from an env file; Pages §4 (to rewrite as Direct Upload); promotion commands; hook order; the signup probe (422 `signup_disabled`)
- `supabase/config.toml:22-24,37-38` -- seed is local only; `site_url`/redirects are the only values that differ per environment (no `env()` today; `test/supabase-scaffold.test.ts` parses this file)
- `package.json` -- `lint`, `typecheck`, `build`, `test`, `test:e2e`; `supabase@2.116.0`, `@playwright/test@1.63.0` as dev dependencies
- Test prerequisites:
  - build-gated: `test/static-hosting.test.ts:22`, `test/key-hygiene.test.ts:131`, `theme-applied`, `localization-applied` (the freshness check fails on a stale build);
  - DB-gated: `test/rls-isolation.test.ts:935-975` needs the full `supabase start` (API + secret key from `supabase status -o json`);
  - order: `supabase start` → `pnpm build` → `pnpm test`.
- `playwright.config.ts`, `e2e/README.md` -- E2E needs `apps/web/.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) and `supabase/functions/.env` (`SHIFT_SECRET_KEY`, `SHIFT_PUBLISHABLE_KEY`, `SHIFT_ALLOWED_ORIGINS` incl. `http://127.0.0.1:5173`), generated from `supabase status -o json` keys `API_URL`, `PUBLISHABLE_KEY`, `SECRET_KEY`; Chromium via `playwright install --with-deps chromium`; E2E and `pnpm test` must not share one stack (separate jobs are separate runners)
- `e2e/support/sign-in.ts:13-27`, `e2e/support/database.ts:85-112` -- sign-in steps and the admin-auth CORS probe, both reusable for the remote smoke
- Known fake or local values Gitleaks may flag, to allowlist narrowly:
  - `test/key-hygiene.test.ts:423`;
  - `test/admin-auth-boundary.test.ts` `*_test_value`;
  - `*.env.example` placeholders;
  - the local `postgres:postgres@127.0.0.1:54322` URLs;
  - `local-fixture-password`;
  - `apps/web/src/supabase/client.test.ts:63`.

## Tasks & Acceptance

**Execution:**
- [x] `.github/workflows/pipeline.yml` -- jobs:
  - `quality`: gitleaks over the full history, plus `pnpm lint`.
  - `build`: `pnpm typecheck` + `pnpm build`, and upload `apps/web/dist` as an artifact.
  - `test`: `supabase start`, build, `pnpm test`, fail if the root Vitest run reports any skipped test.
  - `e2e`: `supabase start`, generate both env files, install Chromium, `pnpm test:e2e`, upload the report on failure.
  - `deploy-staging` (environment `staging`), then `smoke-staging`, then `deploy-production` (environment `production`), then an anonymous `smoke-production`.
  - `notify`: on failure on `main`, a summary line, plus a Slack post only if `SLACK_WEBHOOK_URL` is set.
  - `concurrency` per ref; deploys never cancel in progress.
- [x] `.github/actions/setup/action.yml` -- a composite for Node + pnpm + install, reused by every job.
- [x] `scripts/ci/` -- small Node scripts (`.mjs`):
  - write the local env files from `supabase status -o json`;
  - rewrite `site_url`/redirects in the runner's `config.toml` for a given origin;
  - check the required secrets/vars and name the missing ones;
  - assert zero skipped tests from Vitest's JSON report.
- [x] `.gitleaks.toml` -- extend the default rules; allowlist only the Code Map values, by path + regex.
- [x] `smoke/` + `playwright.smoke.config.ts` -- remote smoke with `baseURL` from `SMOKE_BASE_URL`, no webServer and no globalSetup:
  - `/` and a deep route return 200;
  - `/prijava` renders;
  - no `SUPABASE_ENVIRONMENT_MISSING` in the console;
  - signup is refused with 422;
  - the admin-auth OPTIONS reply admits the Pages origin;
  - with `SMOKE_ORG`/`SMOKE_USERNAME`/`SMOKE_PASSWORD` set: sign in → `/danas`, and never sign out.
- [x] `package.json` -- `wrangler` (exact), plus a `test:smoke` script; `tsconfig`/`eslint` wiring for `smoke/` and `scripts/ci/`.
- [x] `DEPLOY.md` -- §4 rewritten for Direct Upload (create the Pages project with no Git connection, or disconnect it). A new CI/CD section covering:
  - the required repository vars and secrets and the per-environment ones;
  - creating the Environments, with a required reviewer on `production`;
  - `DEPLOY_ENABLED`;
  - the smoke account (provisioned by hand via §7);
  - the manual runbook, kept as the fallback.

**Acceptance Criteria:**
- Given the branch, when `actionlint` runs over `.github/workflows`, then it reports nothing.
- Given the repo, when gitleaks runs locally with `.gitleaks.toml` over the full history, then it finds nothing.
- Given the PR for this branch, when GitHub runs it, then `quality`, `build`, `test` and `e2e` pass, and no deploy job runs.
- Given `pnpm lint`, `pnpm typecheck` and `pnpm test` locally, when run, then they pass (the new files are covered).

## Design Notes

**Stage 2 artifact.** Vite inlines `VITE_*` at build time, so the Stage 2 artifact (built with local values) proves only that the build works. Each deploy job rebuilds with its own environment's variables. Do not try to reuse one bundle across environments.

**Why Direct Upload.** The gate lives in Actions, and the Git integration would publish `main` before approval. Staging deploys with `--branch staging` (a stable preview alias `staging.<project>.pages.dev`), and production with `--branch main`.

## Verification

**Commands:**
- `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest` -- expected: no output
- `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:<pinned> git /repo --config /repo/.gitleaks.toml` -- expected: no leaks
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: pass
- `SMOKE_BASE_URL=http://127.0.0.1:5173 pnpm test:smoke` against the local dev server -- expected: anonymous checks pass

## Suggested Review Order

**Job graph and gates**

- Entry point: the job chain, PR vs push scope, `DEPLOY_ENABLED` gating and concurrency.
  [`pipeline.yml:20`](../../.github/workflows/pipeline.yml#L20)

- Production waits on staging smoke and the `production` Environment reviewer.
  [`pipeline.yml:334`](../../.github/workflows/pipeline.yml#L334)

- Failed or cancelled main runs are named in the summary; Slack only if configured.
  [`pipeline.yml:425`](../../.github/workflows/pipeline.yml#L425)

**Deploy order**

- One composite for both environments, in the DEPLOY.md §5.2b order.
  [`deploy/action.yml:52`](../../.github/actions/deploy/action.yml#L52)

- Drift check reads JSON output and fails when it recognises no rows.
  [`check-migrations.mjs:28`](../../scripts/ci/check-migrations.mjs#L28)

- Origins normalised once, reused for auth URLs, CORS, Environment URL and smoke.
  [`origins.mjs:25`](../../scripts/ci/origins.mjs#L25)

- Missing, padded or malformed config fails before any remote command.
  [`require-config.mjs:63`](../../scripts/ci/require-config.mjs#L63)

**Pre-deploy verification**

- Vitest on a runner-local stack, failing on any skipped root test.
  [`pipeline.yml:119`](../../.github/workflows/pipeline.yml#L119)
  [`assert-no-skipped.mjs:34`](../../scripts/ci/assert-no-skipped.mjs#L34)

- E2E plus the smoke suite against locally started Vite and functions.
  [`pipeline.yml:149`](../../.github/workflows/pipeline.yml#L149)

- Gitleaks over full history, then ESLint.
  [`pipeline.yml:46`](../../.github/workflows/pipeline.yml#L46)

**Remote smoke**

- HTTP 200s, env sanity, refused signup, admin-auth CORS, optional sign-in.
  [`deployment.spec.ts:24`](../../smoke/deployment.spec.ts#L24)

**Peripherals**

- Allowlist narrowed to known fakes, two human-confirmed entries.
  [`.gitleaks.toml:1`](../../.gitleaks.toml#L1)

- Secrets/vars layout, Environments, rollback, config-push safety.
  [`DEPLOY.md:764`](../../DEPLOY.md#L764)

- Script unit and CLI tests.
  [`ci-scripts.test.ts:1`](../../test/ci-scripts.test.ts#L1)
