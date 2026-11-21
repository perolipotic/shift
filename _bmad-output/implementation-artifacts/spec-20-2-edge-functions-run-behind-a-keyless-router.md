---
title: 'Story 20.2: Edge Functions run on the self-hosted runtime behind a keyless router'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_revision: '4fd6a30fc250b9829f8253ab8a47dd612900202c'
baseline_commit: '4fd6a30fc250b9829f8253ab8a47dd612900202c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-20-1-the-self-hosted-stack-is-defined-in-the-repository.md'
warnings: [oversized]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 20.1 stack runs `edge-runtime` with no code: no main service, no gate for `verify_jwt`, Kong's `/functions/v1/` route has no control and a wide-open CORS, and Kong's access log records full URIs (Storage's `?token=`, later the calendar-feed token).

**Approach:** A router (`deploy/functions/main`) that is plumbing only: a table pinned to `config.toml`, GoTrue asked for every `verify_jwt` call, no key, no table, no rule. A `shift-functions` image (pinned `edge-runtime` base, each function bundled into an eszip at build time). The compose runs that image; Kong's functions CORS is pinned to the app origin and its access log is redacted. CI builds the image and probes it offline.

## Boundaries & Constraints

**Always:**
- The router serves only `FUNCTIONS` (the `[functions.*]` names of `config.toml`, with their `verify_jwt`), compares the first path segment undecoded, and answers 404 `FUNCTION_NOT_FOUND` for anything else (empty, `_internal`, `__proto__`, a percent-encoded name).
- `verify_jwt = true`: forward only when GoTrue's `GET /user` (internal `SHIFT_AUTH_URL`, never through Kong, whose auth route needs an `apikey`) answers 200 for the caller's `Authorization: Bearer …`. Missing/non-Bearer header or a GoTrue 4xx → 401 `AUTHORIZATION_MISSING` (the code the SPA already maps to "sign in again"). GoTrue 5xx, 3xx, timeout (5 s), network error, or `SHIFT_AUTH_URL` unset → 503 `AUTHORIZATION_UNVERIFIED` (fail closed; never a sign-out code for an outage). The request body is never read by the router.
- Each worker runs from its build-time eszip (`allowRemoteModules: false`) and gets only the variables its own handler's `readConfiguration` reads. A missing bundle → 500 `FUNCTION_UNAVAILABLE`, never a fall-back to source.
- The router logs only fixed codes: never a URL, header or token.
- Public repository: no address, hostname, registry owner or secret; placeholders only.

**Ask First:** none in scope (founder: no questions; decisions recorded here).

**Never:** start, stop or create a Docker container locally; push an image; create a secret or registry credential; touch the host, Coolify or Traefik; run a DB-connecting test; change the handlers' key guards (AD-17's `sb_` form stands, 20.1).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unknown | `/nope`, `/`, `/_internal/health`, `/admin%2Dauth` | 404 `FUNCTION_NOT_FOUND`; GoTrue not called | — |
| Open function | `POST /notify`, any or no token | forwarded to `notify`'s worker unchanged | its own 401 `INVOKE_SECRET_REFUSED` |
| Gated, no session | `POST /admin-auth` without `Authorization`, or `Basic …` | 401 `AUTHORIZATION_MISSING`; GoTrue not called; worker not created | — |
| Gated, refused | GoTrue answers 401/403/404 | 401 `AUTHORIZATION_MISSING` | — |
| Gated, accepted | GoTrue 200 | original request forwarded, body intact | — |
| GoTrue down | 500, timeout, network error, unset URL | 503 `AUTHORIZATION_UNVERIFIED` | code logged |
| Worker fails | bundle missing / create throws | 500 `FUNCTION_UNAVAILABLE` | code logged |

## Epic AC Deviations

- "**Given** the 20.1 local stack running the image **When** the router's tests and an end-to-end probe run **Then** `notify` without a token answers `401 INVOKE_SECRET_REFUSED`, `admin-auth` without a session is refused before the handler runs, and an admin's `resetPassword` with no payload answers `400 PAYLOAD_INVALID` **And** the pg_cron job reaches `notify` at `http://supabase-kong:8000/functions/v1/notify`, and the outbox drains" — PARTLY DEFERRED to 20.5. No container may be started here. The router's tests run; CI builds the image and probes it offline for the first two refusals and the 404. The `resetPassword` probe, the cron call and the outbox drain are added to DEPLOY.md §9.5's rehearsal (20.5's first act). `deferred-work.md` entry added.
- "**Given** a function path that carries a bearer secret **When** Kong logs the request **Then** the path after `/functions/v1/calendar-feed/` is redacted" — met for Kong's access log, WIDENED to every sub-path of every function and every query string (Storage's `?token=`, the 20.1 deferral). Kong's error log, which can print a request line on an upstream failure, and Traefik's access log (Coolify's; off by default) are not redactable from the repository: checked on the host by 20.5 and before 16.4 ships (`deferred-work.md`).
- "`SUPABASE_URL` is the stack's internal Kong URL, and the secret key, Resend key, invoke secret and VAPID keys come from the container's environment only" — met; NARROWED further: each worker sees only its own handler's variables.
- "a `security-review` of the router precedes production" — not this story's gate; it stays open for 20.9 (sprint status note).
- "forwards the request only when GoTrue's `GET /auth/v1/user` accepts the bearer token" — REINTERPRETED (added after review, see Spec Change Log): the router calls the same GoTrue endpoint directly, `GET /user` at `SHIFT_AUTH_URL` on the stack's network, not through Kong's `/auth/v1/` route, whose key-auth would need an `apikey` the router may not hold. Recorded in the spine's `Amended 2026-11-20 (20.2)` clause.

</frozen-after-approval>

## Code Map

- `supabase/config.toml:121-132` -- `[functions.admin-auth] verify_jwt = true`, `[functions.notify] verify_jwt = false`: the router table's source (read-only).
- `supabase/functions/{admin-auth,notify}/handler.ts` `readConfiguration` -- `getEnv('…')` / `read('…')` names: each worker's environment (read-only). `admin-auth`'s `AUTHORIZATION_MISSING` and the SPA's `WIRE_CODES` (`apps/web/src/features/members/services/wire.ts:437`) and `set-password.ts:219` already map it.
- `supabase/functions/*/index.ts` -- `npm:@supabase/supabase-js@2.113.0`, `npm:web-push@3.6.7`: the dependencies the eszip carries.
- `deploy/coolify/supabase/docker-compose.yml` -- `supabase-kong` env + `kong.yml` `functions-v1` service (plain `cors`), `KONG_PROXY_ACCESS_LOG=/dev/stdout combined`; `supabase-edge-functions` (image, `echo` healthcheck, env, `command`).
- `test/self-hosted-stack.test.ts` -- `CLI_IMAGES` (edge-runtime pin), `runKongEntrypoint`, env-source test, "has files to read", public-repo scans over every `deploy/` file.
- `deploy/coolify/supabase/{staging,production}.env.example` -- operator inputs; the inputs test demands every `${VAR}` there.
- `.github/workflows/pipeline.yml` -- `ci-passed.needs`; jobs pin actions by SHA.
- `DEPLOY.md` §9.1, §9.4, §9.5 -- the edge-runtime row, "Until story 20.2", the rehearsal.
- `edge-runtime` v1.74.3 (commit `47d04fdd`): `bundle --output --entrypoint`; `EdgeRuntime.userWorkers.create({ servicePath, maybeEszip, envVars, allowRemoteModules, … })`; `worker.fetch(request)` needs the original request (its Supabase tag); default port 9000; base is Debian bookworm-slim (has `bash`), runs as root.

## Tasks & Acceptance

**Execution:**
- [x] `deploy/functions/main/router.ts` -- `FUNCTIONS`, codes, `createRouter(deps)`; imports nothing -- testable in Vitest.
- [x] `deploy/functions/main/workers.ts` -- `createForward(deps)`: eszip per function (read once, a failed read not kept), `userWorkers.create` options, retry once on a retired worker while the body is unread; imports only a type -- testable in Vitest.
- [x] `deploy/functions/main/index.ts`, `deploy/functions/main/edge-runtime.d.ts` -- the Deno wiring: `SHIFT_AUTH_URL`, the runtime's `readFile`/`userWorkers`, `Deno.serve`.
- [x] `.dockerignore` -- keep `.git`, `node_modules` and local `.env*` out of the build context.
- [x] `deploy/functions/Dockerfile` -- `FROM supabase/edge-runtime:v1.74.3`; copy router and the two functions; `edge-runtime bundle` each; `CMD start --main-service`.
- [x] `deploy/coolify/supabase/docker-compose.yml` -- edge-functions image `${SHIFT_FUNCTIONS_IMAGE:?}`, `SHIFT_AUTH_URL`, depends on auth, TCP healthcheck; Kong: `SHIFT_APP_URL` (checked in the entrypoint), functions `cors` pinned, `KONG_NGINX_HTTP_INCLUDE` + redacting `log_format`.
- [x] `deploy/coolify/supabase/{staging,production}.env.example` -- `SHIFT_FUNCTIONS_IMAGE` placeholder.
- [x] `test/functions-router.test.ts` -- the matrix; table = config.toml; env = handlers' reads; Dockerfile bundles exactly the table; no key, table, client or logged URL in the router.
- [x] `test/self-hosted-stack.test.ts` -- edge-runtime pin moves to the Dockerfile; CORS, log format (an nginx-free regex check of the map), `SHIFT_APP_URL` refusal, healthcheck.
- [x] `tsconfig.json`, `eslint.config.js` -- include `deploy/functions/**/*.ts`.
- [x] `.github/workflows/pipeline.yml`, `scripts/ci/probe-functions-image.sh` -- job `functions-image`: build (no push), run offline with fake values, probe; required by `ci-passed`.
- [x] `DEPLOY.md` §9 -- new §9.6 (router, image, CORS, log redaction, Traefik), §9.1/§9.5 updated.
- [x] `ARCHITECTURE-SPINE.md` -- `Amended 2026-11-20 (20.2)` on AD-14.
- [x] `deferred-work.md` -- mark the 20.2 entry RESOLVED in part; add the 20.5 probe and the error-log/Traefik check.
- [x] `sprint-status.yaml` -- 20.1 `done  # #324`; 20.2 `review  # built, CI pending`.

**Acceptance Criteria:**
- Given `config.toml`, when the router test runs, then `FUNCTIONS` has exactly its `[functions.*]` names, each `verify_jwt` equal, and the Dockerfile copies and bundles exactly those.
- Given the router's source, when scanned, then it holds no key literal, no signing secret, no client, no table or `/rest/` path, and no import but its own `./router.ts` and `./workers.ts`.
- Given Kong's config, when parsed, then `functions-v1`'s `cors` allows only `$SHIFT_APP_URL`, no credentials, and the access log uses the redacting format.

## Spec Change Log

- 2026-11-21, review (epic-AC auditor): the epic's `GET /auth/v1/user` vs the router's direct `GET /user` was decided in Design Notes and the spine but missing from `## Epic AC Deviations`. Amended: the deviation line added there (recording only; the intent is unchanged, and the founder said to decide and record). Known-bad state avoided: an unlisted deviation. KEEP: GoTrue asked directly; the router holds no apikey.
- 2026-11-21, review (blind layer): the Always rule reads "a GoTrue 4xx → 401"; the code reads 429 as "cannot be asked" (503). Kept, under the same rule's "never a sign-out code for an outage": a rate limit is not a refused session. Recorded in Design Notes and the spine.

## Design Notes

GoTrue directly, not Kong: Kong's `/auth/v1/` route has key-auth, so a call through it needs an `apikey`, and the router must hold none. `GET /user` with the caller's bearer is the same check the epic names. Kong's CORS (pinned) rather than the router's: Kong answers the preflight itself, so the router needs no origin logic and its refusals still carry CORS; the handlers keep theirs. The eszip carries the npm packages, so a cold start reads a local file; `allowRemoteModules: false` makes a stray remote import fail instead of fetching.

GoTrue 429 is 503 `AUTHORIZATION_UNVERIFIED`, not 401: a rate-limited GoTrue has not refused the session, and the SPA must not sign anyone out for it. Any 2xx but 200 and any 3xx are 503 too. Only a live user session passes, which is stricter than the hosted gateway (any validly signed JWT, the anon key's included); every `admin-auth` operation needs a session anyway.

## Verification

**Commands:**
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/self-hosted-stack.test.ts test/key-hygiene.test.ts test/functions-router.test.ts test/admin-auth-boundary.test.ts test/ci-scripts.test.ts` -- all pass (`test/notify-boundary.test.ts` holds the key-guard cases too but connects to a database: CI only).
- `pnpm typecheck`, `pnpm lint` -- clean.

**Manual checks:**
- The pinned `edge-runtime` binary, taken from the local image with `docker image save` and run under `chroot` in a private network namespace (no container): bundle both functions, start the router, probe the matrix offline.

**Result (2026-11-21):** the seven test files above: 2335 passed, 2 skipped (key-hygiene's built-bundle scans, no build); typecheck and lint clean. No container was started and no image built. Instead, with the pinned images taken by `docker image save` and run under `chroot` in private network namespaces (loopback only):
- `edge-runtime` v1.74.3 bundled both functions (≈8 MB eszips each, npm inside) and ran the router: every matrix row answered as specified, offline, and with a stand-in GoTrue answering 200 an admin-shaped `resetPassword` with no payload reached the handler: `400 PAYLOAD_INVALID`. First run found `import.meta.url` virtual in the main service (bundles not found); fixed with the absolute `FUNCTIONS_ROOT`.
- `scripts/ci/probe-functions-image.sh` itself, driven through a stand-in `docker` that ran the same chroot and busybox httpd: 9/9 ok.
- `kong:2.8.1` with the compose's own entrypoint, `kong.yml` and `log-redaction.conf`: Kong started; the preflight and every functions reply named `https://app.example.test` only; the access log showed `/functions/v1/calendar-feed[redacted]` (also for `%2F`, `//` and upper-case spellings), `…/x.png?[redacted]` for a Storage `?token=`, and 0 occurrences of any probe secret.

### Review Findings (2026-11-21)

Layers: blind hunter, edge-case hunter, verification gap, epic-AC auditor. Run unattended.

- [x] [Review][Patch] The retired-worker retry could replay a request whose body was already read → retry only while `request.bodyUsed` is false [workers.ts]
- [x] [Review][Patch] `index.ts`'s wiring (bundle cache, env filtering, retry) was asserted only as source text → extracted to `workers.ts` (`createForward`) and tested with fakes [workers.ts, functions-router.test.ts]
- [x] [Review][Patch] CI never started `admin-auth`'s worker → the probe runs on an `--internal` network with a busybox stand-in GoTrue and expects `400 PAYLOAD_INVALID`; deadlines (`timeout 30`), a "never listened" failure, and status-line plus body matching [probe-functions-image.sh, pipeline.yml]
- [x] [Review][Patch] Nothing pinned Kong's `strip_path` on the functions route, which the router depends on → asserted [self-hosted-stack.test.ts]
- [x] [Review][Patch] `SHIFT_APP_URL` with an empty host or upper case passed Kong's check → refused [docker-compose.yml, self-hosted-stack.test.ts]
- [x] [Review][Patch] Worker wall clock equal to Kong's 150 s → 140 s [workers.ts]
- [x] [Review][Patch] No `.dockerignore`: local `.env*` and `node_modules` went into the build context → added and pinned [.dockerignore]
- [x] [Review][Patch] Rehearsal 7b: the token file could outlive a failure → kept in the scratch directory the trap removes; a real redaction check added (a marker in a function sub-path and a Storage `?token=`, then `grep -c` on Kong's log = 0) [DEPLOY.md §9.5]
- [x] [Review][Patch] Key-only callers are now refused where the hosted gateway let any signed JWT through → stated [DEPLOY.md §9.6, spine AD-14]
- [x] [Review][Patch] Sprint status left `in-progress` without the security-review note → `review`, with the note [sprint-status.yaml]
- [x] [Review][Patch] Epic AC 1's endpoint deviation unlisted → listed (Spec Change Log) [this spec]
- [x] [Review][Patch] Stale eslint block heading [eslint.config.js]
- [x] [Review][Defer] The bundle's transitive npm packages are not locked → 20.9 (deferred-work)

Rejected, with reasons: exit at start on a missing `SHIFT_AUTH_URL` (the frozen rule is fail-closed 503, and a restart loop would also stop `notify`); preloading bundles in the healthcheck (the CI probe starts both workers from the built image); a multi-stage image without source and a non-root user (the source is not loadable with remote modules off and an eszip given; the base runs as root as the CLI's does; 20.9 may revisit with digests); a function name that is itself a token (`/functions/v1/<token>`: no function takes one, and it is a 404); chunked responses in the probe (the runtime answered with a length, and the probe now matches the body anywhere); skipping the image job on docs-only PRs and layer caching (minutes, not correctness); committing the chroot harness (a one-off verification method, described here); the outbox drain with no seeded row (with none queued, `waiting = 0` and a 200 are what the rehearsal can show; 20.5 runs it on real data); `ci-passed` reading `needs` (verified: it reads the whole object).

## Suggested Review Order

**The router: which function, and who may call it**

- The table, pinned to config.toml; each worker's variables are its own handler's.
  [`router.ts:43`](../../deploy/functions/main/router.ts#L43)

- The gate: GoTrue directly, 4xx → sign in again, anything else → 503.
  [`router.ts:126`](../../deploy/functions/main/router.ts#L126)

- Name lookup, the `verify_jwt` branch, the forward; nothing else.
  [`router.ts:151`](../../deploy/functions/main/router.ts#L151)

**Workers from build-time bundles**

- Bundle per function, remote modules off, one retry only while the body is unread.
  [`workers.ts:42`](../../deploy/functions/main/workers.ts#L42)

- Each function bundled at build time on the CLI's edge-runtime.
  [`Dockerfile:24`](../../deploy/functions/Dockerfile#L24)

**The gateway: CORS and the redacted log**

- Kong's functions route: no key-auth, CORS for the app's origin alone.
  [`docker-compose.yml:664`](../../deploy/coolify/supabase/docker-compose.yml#L664)

- The `shift_redacted` format: no query, nothing after a function's name.
  [`docker-compose.yml:463`](../../deploy/coolify/supabase/docker-compose.yml#L463)

- Kong refuses an app origin it would read as a regex or never match.
  [`docker-compose.yml:414`](../../deploy/coolify/supabase/docker-compose.yml#L414)

- The edge-runtime service: the built image, GoTrue's address, a TCP healthcheck.
  [`docker-compose.yml:883`](../../deploy/coolify/supabase/docker-compose.yml#L883)

**CI and the runbook**

- Build only, then the probe on an internal network with a stand-in GoTrue.
  [`pipeline.yml:139`](../../.github/workflows/pipeline.yml#L139)

- The probe's matrix, `PAYLOAD_INVALID` through the gated path included.
  [`probe-functions-image.sh:103`](../../scripts/ci/probe-functions-image.sh#L103)

- The runbook section, and the live probe 20.5 runs.
  [`DEPLOY.md:2074`](../../DEPLOY.md#L2074)
  [`DEPLOY.md:2022`](../../DEPLOY.md#L2022)

- The AD-14 amendment.
  [`ARCHITECTURE-SPINE.md:222`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L222)

**Tests**

- The matrix, the table's sources, the image, the no-rule scans, the worker wiring.
  [`functions-router.test.ts:93`](../../test/functions-router.test.ts#L93)

- Kong's route, CORS refusals and the redaction map applied to real paths.
  [`self-hosted-stack.test.ts:705`](../../test/self-hosted-stack.test.ts#L705)
