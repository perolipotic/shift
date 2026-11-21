---
title: 'Story 20.6: The pipeline deploys through Coolify'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
baseline_revision: '5dfb1def7b47d6927afaf7d30524647a23488f94'
baseline_commit: '5dfb1def7b47d6927afaf7d30524647a23488f94'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-20-self-hosting.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The deploy jobs still target Supabase cloud and Cloudflare Pages (`link`, `config push`, `secrets set`, `functions deploy`, `wrangler`) and read every runtime secret from GitHub. Self-hosting (H-8, H-9) puts runtime secrets in Coolify only, so nothing can deploy to our stacks.

**Approach:** Rewrite `.github/actions/deploy` for a Coolify stack: check the new configuration, build and probe both images on the runner, join the tailnet as an ephemeral `tag:ci` node, gate production migrations on a recorded backup, `db push --db-url`, push the probed images to GHCR with `GITHUB_TOKEN`, point the environment's channel tag at the probed digest, ask Coolify (deploy-only token) to deploy, and prove what is live. The job graph and its gates stay. Inert until the founder configures it (`DEPLOY_ENABLED`, Environments).

## Boundaries & Constraints

**Always:**
- Secrets reach only the deploy jobs: `environment`-scoped, `push` to `main`, `vars.DEPLOY_ENABLED == 'true'`. No `pull_request_target`. Job-level least-privilege `permissions`; only the two deploy jobs get `packages: write`. Actions pinned by full SHA. Every secret reaches a command through the environment or stdin, never an argument (the DB password is `PGPASSWORD`; the URL carries none).
- The deployed image is the probed image: the deploy job probes with the same `probe-*-image.sh` scripts, pushes that local image, and moves `:<environment>` to the pushed digest with `docker buildx imagetools create`, verifying the tag resolves to it before Coolify is called.
- Production deploys staging's functions digest (no rebuild); each environment builds its own `shift-web` from its own `VITE_*`.
- Order: config check → images built, bundle-checked, probed → tailnet → `migration list` → production backup gate → `db push` → `migration list` + `check-migrations.mjs` → functions → `notify` probe → web → live-origin check → outputs.
- Public repository: names only (`vars.`/`secrets.`), placeholders, no host, tailnet, IP or owner.

**Ask First:** none (the founder approved self-hosting and asked for no questions; decisions are recorded here).

**Never:** touch the host or Coolify, create a secret or variable, run a container, a DB-connecting test or a `supabase` command locally; push GoTrue's environment from CI; hold a runtime secret (`sb_secret_`, Resend, invoke, VAPID private) in GitHub.

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|----------|-------|----------|
| Not enabled | `DEPLOY_ENABLED` ≠ `true` | deploy jobs skipped; `build` posts a "Deploys skipped" summary listing the names to set |
| Misconfigured | enabled, an item missing/malformed | `require-config.mjs` fails naming each item, before any remote call |
| Production, pending migrations | no/old/future `PRE_MIGRATION_BACKUP_AT` | fail before `db push`, saying how to back up and re-run |
| Functions unchanged | `:<env>` already at the digest | no stack restart; `notify` probe only |
| Functions changed | new digest | tag moved, `POST /services/{uuid}/restart?latest=true`, wait for Postgres to have restarted after the request, then the probe (retried) |
| Web | new build | `POST /deploy?uuid=`; poll the origin until `/` equals the built `index.html`, then each `dist/_headers` header exact |
| Bundle | secret-shaped value | fail: `sb_secret_` key, non-`anon` JWT, Resend key, the VAPID public key's private half |

## Epic AC Deviations

- "in order: `require-config.mjs` … the runner joins the tailnet … `db push` … `shift-functions:<sha>` is pushed and deployed … `apps/web` is built … `shift-web` is pushed and deployed" — REINTERPRETED: both images are built, bundle-checked, probed AND pushed to GHCR under their commit tags BEFORE the tailnet and `db push`, so no migration is applied for a release whose images would be refused. Pushing a commit tag changes nothing that runs (nothing pulls it); every step that changes what runs (migration, channel-tag moves, Coolify calls) keeps the AC's order.
- "`shift-functions:<sha>` is pushed and deployed" — REINTERPRETED: pushed as `:<sha>` and `:src-<hash of its sources>` (an unchanged source reuses the probed digest), deployed through the moving `:<environment>` tag, because a deploy-only Coolify token cannot change a resource's image reference (v4.7.6 API: env and tag edits need `write`). The digest is verified at the registry before the call and recorded in the summary.
- "redeploying the previous image tag through Coolify restores the SPA and the functions" — met, by digest: DEPLOY.md §8.7 sets the resource to the previous release's digest from its run summary (`sha256-<hex>` as the application's tag; `…@sha256:<hex>` as `SHIFT_FUNCTIONS_IMAGE`) and redeploys. Commit tags can be overwritten by a re-run, digests cannot.
- "the job graph … unchanged in behaviour" — met: `deploy-production` also `needs: deploy-staging` (already transitive through `smoke-staging`) to read the functions digest.

</frozen-after-approval>

## Code Map

- `.github/workflows/pipeline.yml:129-143` -- "Deploys skipped" summary (old names); `:457-643` deploy/smoke jobs (old config set); `:85-92` ShellCheck.
- `.github/actions/deploy/action.yml` -- rewritten whole.
- `scripts/ci/require-config.mjs` `FORMATS` -- add url/host/port/uuid/token shapes; old formats stay (manual runbook, tests).
- `scripts/ci/check-migrations.mjs` `parseMigrationList` -- reused by the backup gate (pending = local without remote).
- `scripts/ci/probe-functions-image.sh`, `probe-web-image.sh <image> <dist>` -- reused as-is in the deploy.
- `deploy/coolify/supabase/docker-compose.yml:885-891` -- `image: ${SHIFT_FUNCTIONS_IMAGE:?}`; templates `staging|production.env.example`.
- Coolify v4.7.6 `routes/api.php` (read upstream): `POST /deploy` and `POST /services/{uuid}/restart` are `api.ability:deploy`; `PATCH /services/{uuid}/envs` is `write`; `RestartService` = stop + `compose pull` (with `latest`) + `up --force-recreate` of the whole stack; a single service-application restart is `docker restart` (no pull).
- Supabase CLI 2.116.0 (bundled JS): `--db-url` (percent-encoded), password falls back to `PGPASSWORD`; `--output-format` is global.
- Tests pinning the old action: `test/static-hosting.test.ts:267` (maps before `wrangler`), `test/notify-boundary.test.ts:948` (heredoc env file; superseded by `test/self-hosted-stack.test.ts:620-656`), `test/key-hygiene.test.ts:387` (names notify secrets in the action), `test/web-image.test.ts:337` (web-image never pushes — kept).

## Tasks & Acceptance

**Execution:**
- [x] `scripts/ci/require-config.mjs` -- formats `https-origin`, `tailnet-host`, `port`, `tailnet-url`, `coolify-uuid`, `coolify-token`, `ts-oauth-secret`.
- [x] `scripts/ci/check-bundle.mjs` -- the bundle check (shapes; VAPID by deriving each quoted 43-char token's public key).
- [x] `scripts/ci/backup-gate.mjs` -- pending migrations; production requires a backup timestamp ≤ 24 h old.
- [x] `scripts/ci/coolify.mjs` -- `deploy-application`, `restart-service`; never prints the token.
- [x] `scripts/ci/wait-for-web.mjs` -- origin serves the built `index.html`, then the headers.
- [x] `scripts/ci/registry.sh` -- `push` (digest), `point` (tag → digest, verified), `digest` (a registry error fails; only "not found" is absent).
- [x] `scripts/ci/deploy-images.sh` -- `functions-image`, `deploy-functions`, `deploy-web`; restores a moved channel tag on failure.
- [x] `.github/actions/deploy/action.yml` -- rewrite in the order above.
- [x] `.github/workflows/pipeline.yml` -- new config set, permissions, outputs, summary, ShellCheck; drop `WRANGLER_SEND_METRICS`.
- [x] `deploy/coolify/supabase/*` -- `pull_policy: always` on edge-functions; templates name the channel tag.
- [x] `test/coolify-deploy.test.ts` (new) -- scripts and the action/pipeline structure; adjust the four pinned tests above.
- [x] `DEPLOY.md` §8, §8.1, §8.2, §8.4, §8.6, §8.7, §9.6, §9.7 -- the pipeline, the exact names to set, rollback.
- [x] `ARCHITECTURE-SPINE.md` AD-14 -- "Amended 2026-11-21 (20.6)".
- [x] `deferred-work.md` -- mark the 20.6 entries; new entries for 20.5/20.7/20.9.

**Acceptance Criteria:**
- Given the action, when grepped, then no `supabase link`, `config push`, `secrets set`, `functions deploy`, `wrangler`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `CLOUDFLARE_` or runtime secret name remains.
- Given a pull request, when the pipeline runs, then no job holds `packages: write`, an environment or a secret but the deploy jobs, which never run.
- Given the scripts, when `test/coolify-deploy.test.ts` runs, then every matrix row above holds with fakes.


## Spec Change Log

- **Review loop 1 (2026-11-21), patches only.** Four reviewers (blind, edge-case, verification-gap, epic-AC). Triggering findings and amendments: the AC1a deviation understated that both images are pushed before the tailnet (frozen wording corrected under the founder's standing delegation, no change of intent); the action's restart/reuse branches ran in no test, so they moved into `scripts/ci/deploy-images.sh` and are executed against stand-ins for docker, psql and Coolify; the source hash is held to cover every `COPY` of the functions Dockerfile and the probe script; `registry.sh digest` no longer reads a registry error as "absent"; a failed deploy puts the channel tag back; `psql`, a connection and `PGCONNECT_TIMEOUT` are checked before the migration; the restart call must say "queued"; the summary runs on failure; job timeout 45 min; `DB_HOST` and the Coolify URL must be tailnet hosts; the unused `timestamp` format dropped; `wait-for-web` keeps polling through a stale-header window and joins a repeated header; `check-bundle` ignores a role-less JWT and finds an unquoted or padded VAPID key; rollback is by digest (tags are not immutable); DEPLOY §8.4 says the manual path promotes only published digests. Known-bad states avoided: a skipped restart on an unreadable registry, an unverified image behind a channel tag after a failed deploy, a migration applied before discovering `psql` is missing. KEEP: deploy-only token, channel tags moved to the probed digest, production deploys staging's functions digest, build/probe/check before any server contact.

## Design Notes

- **Why channel tags, not digests, in Coolify.** H-9 limits the token to deploy. The digest is still the unit: CI is the tag's only writer (`GITHUB_TOKEN`, deploy jobs, per-environment concurrency groups), verifies it before deploying, and checks the web build live by content. Functions: no version endpoint exists (the router must stay plumbing), so the restart is shown (not which digest runs; 20.5 checks that on the host) by `pg_postmaster_start_time()` after the request (the whole stack is recreated) and the `notify` probe.
- **A functions release restarts the stack** (Postgres included, about a minute) because a deploy-only token has no per-service pull. The source-hash tag makes that happen only when `deploy/functions`, the two functions, `.dockerignore` or the functions probe changed.
- **Backup hook (H-12).** Coolify's backup API covers standalone databases only and needs `write`; 20.7 owns the real backup. Until then the operator backs up in Coolify and sets `PRE_MIGRATION_BACKUP_AT` before approving.
- **Deferred inputs answered:** registry push and digests (20.2, 20.3 entries) here; dedicated migration role (20.1 entry): kept `postgres` (db push needs owner rights on `public`, `cron`, `vault`, the auth hook grants), mitigated by tailnet ACL + Environment rules; re-owned to 20.9.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- clean.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/self-hosted-stack.test.ts test/ci-scripts.test.ts test/functions-router.test.ts test/web-image.test.ts test/host-hardening.test.ts test/coolify-deploy.test.ts` -- green.
- `uvx actionlint` (with ShellCheck), `shellcheck -x scripts/ci/registry.sh scripts/ci/deploy-images.sh`, ShellCheck over every `run:` of the composite action -- clean.

**Manual checks:**
- `test/static-hosting.test.ts`, `test/key-hygiene.test.ts` and `test/notify-boundary.test.ts` are edited but NOT run locally (outside the allowed list; `notify-boundary` opens a database). Unverified until CI runs them.
- Nothing ran against GHCR, Tailscale or Coolify (no credentials exist); the Coolify calls are written from v4.7.6's source and are 20.5's first-enable check (`deferred-work.md`).

## Suggested Review Order

**The deploy, in order**

- Entry point: the rewritten composite action; everything that can refuse runs before the tailnet.
  [`action.yml:160`](../../.github/actions/deploy/action.yml#L160)

- Ephemeral `tag:ci` node, SHA-pinned; first contact with the server.
  [`action.yml:187`](../../.github/actions/deploy/action.yml#L187)

- H-12 hook: production migrations need a recorded backup.
  [`action.yml:217`](../../.github/actions/deploy/action.yml#L217)

- Functions deploy delegates to the tested script.
  [`action.yml:256`](../../.github/actions/deploy/action.yml#L256)

**Probed image = deployed image**

- Reuse, given-digest validation, or build+probe+push.
  [`deploy-images.sh:60`](../../scripts/ci/deploy-images.sh#L60)

- Skip on `-live`, restart, Postgres start-time proof.
  [`deploy-images.sh:84`](../../scripts/ci/deploy-images.sh#L84)

- Channel tag restored if a later step fails.
  [`deploy-images.sh:41`](../../scripts/ci/deploy-images.sh#L41)

- Registry errors are failures, never "absent".
  [`registry.sh:33`](../../scripts/ci/registry.sh#L33)

- Carbon-copy tag move, verified digest.
  [`registry.sh:83`](../../scripts/ci/registry.sh#L83)

**Workflow security**

- Only the deploy jobs get `packages: write`.
  [`pipeline.yml:470`](../../.github/workflows/pipeline.yml#L470)

- Production takes staging's functions digest.
  [`pipeline.yml:577`](../../.github/workflows/pipeline.yml#L577)

**Checks**

- Tailnet-only DB host and Coolify URL.
  [`require-config.mjs:59`](../../scripts/ci/require-config.mjs#L59)

- Bundle secret shapes; VAPID by key derivation.
  [`check-bundle.mjs:43`](../../scripts/ci/check-bundle.mjs#L43)

- Deploy-only Coolify calls; restart must say queued.
  [`coolify.mjs:120`](../../scripts/ci/coolify.mjs#L120)

- Live origin serves this build with its headers.
  [`wait-for-web.mjs:84`](../../scripts/ci/wait-for-web.mjs#L84)

- Backup age and future-skew rules.
  [`backup-gate.mjs:39`](../../scripts/ci/backup-gate.mjs#L39)

**Docs and tests**

- The names the founder must set.
  [`DEPLOY.md:1543`](../../DEPLOY.md#L1543)

- Rollback by digest.
  [`DEPLOY.md:1731`](../../DEPLOY.md#L1731)

- Script branches run against docker/psql/Coolify stand-ins.
  [`coolify-deploy.test.ts:562`](../../test/coolify-deploy.test.ts#L562)
