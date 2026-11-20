---
title: 'Story 20.1: The self-hosted stack is defined in the repository'
type: 'feature'
created: '2026-11-20'
status: 'in-review'
baseline_revision: '6344faed04509441f55f6a85591c4e986b5daf02'
baseline_commit: '6344faed04509441f55f6a85591c4e986b5daf02'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-20-self-hosting.md'
warnings: [oversized]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Staging and production will be self-hosted Supabase stacks run by Coolify (founder decision 2026-11-20), but nothing in the repository defines that stack. `config push` used to guarantee GoTrue's settings; nothing guarantees them for a compose file. AD-17's key form (opaque `sb_` keys or the stack's role JWTs) is still open.

**Approach:** Add `deploy/coolify/supabase/docker-compose.yml`, derived from Coolify's Supabase template at the tag of the Coolify installed (v4.7.6, commit `b7cbdb480faa1a124423e3c3c886481848c96cf9`), trimmed to the eight services, pinned to Supabase CLI 2.116.0's images, with per-environment env templates holding placeholders only. Tests pin GoTrue/PostgREST to `config.toml`, the exposure rules, the pins, the secrets and the limits. AD-17 is settled from the pinned sources: the opaque `sb_` form stands, with Kong mapping each `sb_` key to the stack's role JWT, as the CLI's own local stack does.

## Boundaries & Constraints

**Always:**
- The repository is public: no server address, hostname, tailnet name, host port, SSH setting or secret anywhere. Placeholders (`<domain>`, `<loopback-port>`) only. A test refuses any IPv4 literal but `127.0.0.1` under `deploy/`.
- Every stack secret is a Coolify-generated `SERVICE_PASSWORD_*` (or Coolify's `SERVICE_SUPABASEANON_KEY` / `SERVICE_SUPABASESERVICE_KEY` JWTs), never with a default. The secrets no generator can make (the Resend key, the VAPID pair) are operator-set variables with no default.
- The JWT signing secret reaches only GoTrue, PostgREST, Storage and Studio; never Kong or `edge-runtime` (AD-17 as amended).
- `supabase/config.toml` stays the single source of auth settings; the compose mirrors it.

**Ask First:** none in scope (founder: no questions; decisions are recorded here).

**Never:** start Docker, touch the local dev stack, deploy, touch the host, Coolify, firewall or SSH; create a real secret; run a DB-connecting test locally; change the functions' key guards (the `sb_` branch keeps them as they are).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Parity | compose GoTrue/PostgREST env vs `config.toml` | equal per the mapping table | test names the variable and both values |
| Drift | `config.toml` `jwt_expiry` changed, compose not | parity test fails | — |
| Exposure | a `ports:` entry without `127.0.0.1:` | test fails | — |
| Secret default | `${SERVICE_PASSWORD_X:-abc}` | test fails | — |
| Image | unpinned, `latest`, or not CLI 2.116.0's version | test fails; a CLI bump fails it until the table is rechecked | — |
| Limits | a service with no `mem_limit`/`cpus`, or staging ≥ production | test fails | — |

## Epic AC Deviations

- "**Given** the stack started locally under its own project name and ports **When** `supabase db push --db-url` applies every migration **Then** it succeeds from nothing, `pg_cron`, `pg_net` and Vault work, the `0005` bucket exists, a provisioned admin signs in … carries `organization_id`, and a signup is refused" — DEFERRED to 20.5. This session may not start containers (the shared dev stack is under a manual test). The rehearsal is written in DEPLOY.md, step by step, and runs as 20.5's first act on staging. `deferred-work.md` entry added.
- "**And** the result of probing whether this stack accepts opaque `sb_publishable_`/`sb_secret_` keys is recorded" — REINTERPRETED: answered from the pinned sources (CLI 2.116.0's Kong template and auth headers, Coolify v4.7.6's template), not by a live probe. The live confirmation is a precise probe in DEPLOY.md and in the 20.5 deferral.
- "**every secret is a Coolify-generated variable (`SERVICE_PASSWORD_*`)**" — NARROWED: Resend key and VAPID pair cannot be generated; they are operator-set with no default.
- "**every image is pinned … at the versions the pinned Supabase CLI runs locally**" — met, with Kong at the CLI's `kong:2.8.1` rather than the template's 3.9.1.

</frozen-after-approval>

## Code Map

- `supabase/config.toml` -- the auth/api source mirrored by the compose (read-only).
- `test/supabase-scaffold.test.ts` -- `describe('the local auth provider configuration')` and its `setting()` reader; the parity tests join it.
- `supabase/functions/{admin-auth,notify}/handler.ts` `readConfiguration` -- env names `SUPABASE_URL`, `SHIFT_SECRET_KEY`, `SHIFT_PUBLISHABLE_KEY`, `SHIFT_ALLOWED_ORIGINS`, `NOTIFY_INVOKE_SECRET` (`/^[A-Za-z0-9_-]{32,}$/`), `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM`, `SHIFT_APP_URL`, `VAPID_*`; prefix guards `sb_secret_` / `sb_publishable_` stay (read-only).
- `test/key-hygiene.test.ts` -- `PLAUSIBLE_KEY` (`sb_secret_` + 20 key chars) scans every committed file; `sb_secret_${…}` passes it.
- `supabase/migrations/0005_*` -- inserts the logo bucket into `storage.buckets`: Storage must have run its own migrations before `db push`.
- Upstream sources (read-only): the template, https://github.com/coollabsio/coolify/blob/b7cbdb480faa1a124423e3c3c886481848c96cf9/templates/compose/supabase.yaml; the CLI's image pins, https://github.com/supabase/cli/blob/v2.116.0/apps/cli-go/pkg/config/templates/Dockerfile (CLI pins: postgres 17.6.1.165, kong 2.8.1 as `kong:2.8.1`, postgrest v16.1, postgres-meta v0.98.0, studio 2026.08.17-sha-0c1da8f, edge-runtime v1.74.3, gotrue v2.196.0, storage-api v1.70.3); the CLI's `sb_` mapping, https://github.com/supabase/cli/blob/v2.116.0/apps/cli/src/legacy/commands/start/services/kong.service.ts (`legacyBuildKongBearerToken`) and the same tag's `legacy-kong-auth.ts`.
- Coolify template `templates/compose/supabase.yaml` @ `b7cbdb48…` -- source of the derivation; CLI `apps/cli-go/pkg/config/templates/Dockerfile` @ v2.116.0 (`997a1e69…`) -- the image pins.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `pnpm-lock.yaml` -- add devDependency `yaml` 2.9.1 -- the tests parse the real compose and Kong config instead of regexes.
- [x] `deploy/coolify/supabase/docker-compose.yml` -- the trimmed stack (Design Notes) -- AC 1–3.
- [x] `deploy/coolify/supabase/staging.env.example`, `production.env.example` -- placeholders and limits, staging lower -- operator inputs per environment.
- [x] `test/self-hosted-stack.test.ts` -- services, pins, ports, Kong routes, secrets, limits, env templates, public-repo guard -- AC 1, 3.
- [x] `test/supabase-scaffold.test.ts` -- GoTrue/PostgREST parity with `config.toml` -- AC 2.
- [x] `DEPLOY.md` -- new section "Self-hosted stack (story 20.1)": what runs, what does not and why, keys, the order rule, the local rehearsal, the key probe -- AC 5.
- [x] `ARCHITECTURE-SPINE.md` -- `Amended 2026-11-20 (20.1)` clause on AD-17 recording the key form and its evidence -- AC 4.
- [x] `deferred-work.md` -- the rehearsal and live probe deferred to 20.5.
- [x] `sprint-status.yaml` -- 20.1 `review`, "built, CI pending".

**Acceptance Criteria:**
- Given the compose, when the tests run, then it has exactly the eight services, each image equals CLI 2.116.0's, Postgres is 17 as `[db] major_version`, and the header records the template commit.
- Given GoTrue's and PostgREST's environment, when `test/supabase-scaffold.test.ts` runs, then each mirrored variable equals its `config.toml` value.
- Given the compose, when its ports and Kong config are read, then only db and studio publish, both on `127.0.0.1`, and Kong has no route to Studio or pg-meta and no catch-all.
- Given AD-17, when the spine is read, then its 20.1 amendment names the `sb_` form and the source evidence.

### Review Findings (second review, 2026-11-20, security focus)

Layers: blind hunter, edge-case hunter, verification gap, acceptance auditor and epic-AC auditor (artifact renderer: no generated file). Run unattended; every finding resolved here.

**Kong's `sb_` translation, verified.** The only path to `Bearer <service_role JWT>` is `headers.apikey` equal to the whole secret key. A forged key falls through to `headers.apikey`, which is forwarded as it came and refused upstream (no valid signature). A missing key is refused by key-auth on auth, REST and GraphQL, and gives an empty `Authorization` that the storage route clears. A duplicated `apikey` is refused 401 by key-auth (Kong 2.8.1's handler). The expression is the CLI 2.116.0 `legacyBuildKongBearerToken` term for term (checked against the tag).

- [x] [Review][Patch] The §9.5 rehearsal pushed migrations before GoTrue had ever run. `0003`'s SQL function reads `auth.users.deleted_at`/`banned_until` (GoTrue's columns), so the push would fail. Now GoTrue and Storage start first with `--wait`, then the push, then GoTrue restarts; §9.4 rule 1 says why [DEPLOY.md §9.4, §9.5]
- [x] [Review][Patch] The rehearsal had no errexit, did not wait for health, and spliced the admin password into `\set` and JSON unescaped. Now `set -eo pipefail`, `up -d --wait`, and a letters-and-digits password check [DEPLOY.md §9.5]
- [x] [Review][Patch] key-auth also took `?apikey=` from the query string. The mapping reads the header only, and Kong's access log would record the key. Now `key_in_query: false` on auth, REST and GraphQL, and a test pins key-auth, header-only, and the role ACL on those routes [docker-compose.yml, self-hosted-stack.test.ts]
- [x] [Review][Patch] The fail-closed guard checked only length. A quote, backslash or space in a key would break out of the Lua string. Equal keys or equal JWTs would give one credential two roles. Now each of the four values is limited to `[A-Za-z0-9._-]` and must differ from its pair, with no external tool, brace expansion or `eval`. The refusal cases are tested under the host's `sh` and also under busybox `sh`/`awk` when present; the render is tested the same way [docker-compose.yml, self-hosted-stack.test.ts]
- [x] [Review][Patch] "No service behind Kong ever sees an `sb_` key" was false, because `hide_credentials: false` forwards `apikey`. The wording now reads "is ever authenticated by". `hide_credentials: false` is kept, as in the CLI [docker-compose.yml header, DEPLOY.md §9.2, spine AD-17]
- [x] [Review][Patch] "Coolify's template does the same" overstated the match. That template maps to asymmetric JWTs, and only when the operator sets the keys. The wording is corrected, and the spine now names the one accepted difference from the hosted platform: there is no browser refusal of `sb_secret_` [DEPLOY.md §9.2, spine AD-17]
- [x] [Review][Patch] No `restart:` policy was set; DEPLOY relied on Coolify to inject one. Every service is now `restart: unless-stopped`, and a test checks it [docker-compose.yml]
- [x] [Review][Patch] Gaps in the tests, now closed:
  - The signing-secret holder test matched only the literal `${SERVICE_PASSWORD_JWT}`. It now matches by name, with any modifier.
  - The domain test counted bare declarations only. It now also refuses referenced `SERVICE_URL_*`/`SERVICE_FQDN_*` names, `labels:` and `expose:` on services other than Kong.
  - The DEPLOY §9 slice could silently become one character when the heading was missing.
  - No test checked that the edge-runtime gets every variable both handlers read, from the right source.
  - No test checked that connection URLs carry only the generated password.
  [self-hosted-stack.test.ts]
- [x] [Review][Patch] The parity test walked fixed lists, so a new `[auth*]`/`[api]` key in config.toml would go unenforced. Every key is now either mirrored or listed in `NOT_MIRRORED` with a reason. Proved by adding `secure_password_change` temporarily (the test failed) and then reverting [supabase-scaffold.test.ts]
- [x] [Review][Patch] Documentation fixes:
  - §9.2 understated who holds the Postgres password: it is a superuser password, held by five containers.
  - The rotation note left out `supabase_admin`.
  - §9.1 listed the required inputs incompletely.
  - The env templates now say to enter `NOTIFY_EMAIL_FROM` without quotes in Coolify.
  [DEPLOY.md, *.env.example]
- [x] [Review][Defer] Generated secrets and `SERVICE_URL_SUPABASEKONG` are referenced bare. Whether Coolify accepts `:?` on its magic variables needs the live Coolify → 20.5 (deferred-work)
- [x] [Review][Defer] pg-meta is unauthenticated on the stack network, and pg_net EXECUTE is granted to anon/authenticated → 20.4 or a migration (deferred-work)
- [x] [Review][Defer] The real client IP does not pass through Traefik and Kong (`KONG_TRUSTED_IPS`, `GOTRUE_RATE_LIMIT_HEADER`) → 19.1 with 20.5 (deferred-work)
- [x] [Review][Defer] The functions route has no gateway control; CORS is `*`; the access log keeps the Storage `?token=` and the calendar-feed path → 20.2 (deferred-work)
- [x] [Review][Defer] Docker Engine before 28 exposes loopback ports to the L2 segment → 20.4 (deferred-work)
- [x] [Review][Defer] Kong 2.8.1 is out of upstream support → 20.9 (deferred-work)

Rejected, with reasons:
- Duplicate `Authorization` header (a 500) and a lowercase `bearer sb_…`: both fail closed, never escalate, and match the CLI; supabase-js sends `Bearer`.
- Drop the role JWTs from key-auth: Studio calls Kong with the JWT as `apikey`, and removing it revokes nothing, because PostgREST trusts any validly signed bearer token. Revocation is rotating `SERVICE_PASSWORD_JWT`.
- CORS `*` on auth and REST: these are bearer-token APIs with no cookies, the Supabase norm. The functions route is deferred to 20.2.
- `GOTRUE_URI_ALLOW_LIST` is the bare origin: it mirrors config.toml's local list, and no redirect flow exists before Epic 19.
- IPv4 guard allows `0.0.0.0` and image tags: `0.0.0.0` is the in-container bind, and the exposure test refuses it in `ports:`. No IPv6 scan: no IPv6 is used.
- The frozen Always list says the signing secret reaches Studio. The code is stricter (never Studio) and matches spine clause (2). The frozen text is not edited here; the founder may correct it.
- "Settled" before the live probe: listed as REINTERPRETED, and the spine names the fallback.
- The first-pass process incident: already reported; not a code finding.
- `pnpm-lock.yaml` "missing": it is in the commit; the review diff left it out.

## Design Notes

**AD-17, settled.** Neither GoTrue, PostgREST nor Storage reads an `sb_` key; the gateway does. CLI 2.116.0's local stack (`apps/cli/src/legacy/commands/start/services/kong.service.ts`, `legacyBuildKongBearerToken`) has Kong's request-transformer replace `Authorization` with `Bearer <service_role JWT>` when `apikey` equals the secret key and `Bearer <anon JWT>` when it equals the publishable key, passing through any `Authorization` that is not `Bearer sb_…`; `legacy-kong-auth.ts` sends an `sb_` key as `apikey` only. Coolify v4.7.6's template does the same (`LUA_AUTH_EXPR`, key-auth consumers for both forms). So the opaque form works on the pinned images exactly as it works locally today, and the functions' and SPA's guards are unchanged. The stack's `sb_` keys are `sb_publishable_${SERVICE_PASSWORD_64_PUBLISHABLEKEY}` and `sb_secret_${SERVICE_PASSWORD_64_SECRETKEY}`, mapped to Coolify's HS256 role JWTs (no asymmetric keys needed). Kong holds both `sb_` keys and both role JWTs, not the signing secret.

**Mirror table** (compose literal ← `config.toml`): `GOTRUE_DISABLE_SIGNUP` ← !`[auth] enable_signup`; `GOTRUE_EXTERNAL_EMAIL_ENABLED` ← `[auth.email] enable_signup`; `GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED` ← `enable_anonymous_sign_ins`; `GOTRUE_MAILER_AUTOCONFIRM` ← !`[auth.email] enable_confirmations`; `GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED` ← `double_confirm_changes`; `GOTRUE_EXTERNAL_PHONE_ENABLED` ← `[auth.sms] enable_signup`; `GOTRUE_SMS_AUTOCONFIRM` ← !`[auth.sms] enable_confirmations`; `GOTRUE_JWT_EXP` ← `jwt_expiry`; `GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED`, `…_REUSE_INTERVAL`, `GOTRUE_PASSWORD_MIN_LENGTH`; `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_{ENABLED,URI}`; `PGRST_DB_SCHEMAS`, `PGRST_DB_EXTRA_SEARCH_PATH`, `PGRST_DB_MAX_ROWS` ← `[api]`. Not mirrored: `site_url`/redirects (per environment, `SHIFT_APP_URL`), `[auth.rate_limit]` (local only; 19.1 owns production limits).

**Trim.** Kept from the template: Kong routes for auth (open + secure), rest, graphql, storage, functions; db init `webhooks.sql` and `roles.sql`. Dropped: Studio catch-all, `/pg/` (pg-meta through the public gateway), MCP, SAML, realtime, analytics; `jwt.sql`, `realtime.sql`, `_supabase.sql`, `pooler.sql`, `logs.sql`; `PGRST_APP_SETTINGS_JWT_SECRET`; the template's `main` function (20.2 brings the router; until then `edge-runtime` has no code). Kong's entrypoint substitutes `$VARS` with awk (not `eval echo`, which would run the Lua `$(…)` as shell) and runs `/docker-entrypoint.sh kong docker-start` under `sh`.

**Limits** are `${X_MEM_LIMIT:-<staging value>}`: a missing variable fails low, never letting staging starve production. Production's template raises them (≈2.9 GiB vs ≈2.2 GiB, staging 1.0 CPU in all).

## Verification

**Commands:**
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/self-hosted-stack.test.ts test/key-hygiene.test.ts` -- all pass.
- `pnpm typecheck`, `pnpm lint` -- clean.

**Manual checks:**
- No container was started; the rehearsal and live key probe are 20.5's (deferred-work).

**Result (2026-11-20):** the four test files 2028 passed, 2 skipped (key-hygiene's built-bundle scans, no build); typecheck and lint clean; `docker compose config --quiet` parses the rendered file (no daemon). Review (blind, edge-case, verification-gap, epic-AC): 15 patches applied, three items deferred (deferred-work). Second review (security focus, same date): 10 patch groups applied, 6 items deferred (deferred-work), 9 rejected (see Review Findings); the four test files then 2033 passed, 2 skipped; typecheck and lint clean; the rendered compose parses (`docker compose config --quiet`, no daemon). No container was started. Process incident: during the first implementation pass the full root suite was started without a file filter for about 3 minutes while the shared dev stack listened on 54322, so DB-connecting tests may have written to it (`rls-isolation` commits throwaway members and sets `banned_until`). Not inspected; reported to the founder.

## Suggested Review Order

**AD-17: the opaque key form, mapped at the gateway**

- The settlement and its source evidence; the open question this story closes.
  [`ARCHITECTURE-SPINE.md:248`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L248)

- Kong refuses empty or short keys before mapping anything.
  [`docker-compose.yml:369`](../../deploy/coolify/supabase/docker-compose.yml#L369)

- The Lua mapping; its clause order is the security property.
  [`docker-compose.yml:384`](../../deploy/coolify/supabase/docker-compose.yml#L384)

- The entrypoint really run under `sh` with fake keys, pairing asserted.
  [`self-hosted-stack.test.ts:183`](../../test/self-hosted-stack.test.ts#L183)

**The stack and its exposure**

- Header: template commit, CLI pins, secrets policy, what was trimmed.
  [`docker-compose.yml:1`](../../deploy/coolify/supabase/docker-compose.yml#L1)

- GoTrue's environment, mirrored literal for literal from config.toml.
  [`docker-compose.yml:634`](../../deploy/coolify/supabase/docker-compose.yml#L634)

- Loopback-only ports; Kong without Studio, pg-meta or a catch-all.
  [`self-hosted-stack.test.ts:350`](../../test/self-hosted-stack.test.ts#L350)

**Parity with config.toml**

- The mirror table enforced, plus the absolute confirmations pin.
  [`supabase-scaffold.test.ts:5438`](../../test/supabase-scaffold.test.ts#L5438)

**Runbook and peripherals**

- What runs, keys, order rules, and the rehearsal 20.5 runs first.
  [`DEPLOY.md:1669`](../../DEPLOY.md#L1669)

- Per-environment placeholders; staging strictly lower limits.
  [`staging.env.example:1`](../../deploy/coolify/supabase/staging.env.example#L1)
