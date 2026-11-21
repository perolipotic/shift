---
title: 'Story 20.3: The SPA ships as a static image with its headers'
type: 'feature'
created: '2026-11-21'
status: 'done'
baseline_revision: '3b7d7d934c32116fdddf0562df21ad59d3c7a4c4'
baseline_commit: '3b7d7d934c32116fdddf0562df21ad59d3c7a4c4'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-20-2-edge-functions-run-behind-a-keyless-router.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The SPA can only be served by Cloudflare Pages (`_redirects`, `_headers`), which self-hosting drops. Nothing serves `apps/web/dist` with its security headers, the SPA fallback and correct caching, there is no CSP and no HSTS.

**Approach:** A `shift-web` image (`deploy/web/Dockerfile`): pinned `nginxinc/nginx-unprivileged` (alpine, uid 101), the built `dist` without maps or the Pages files, and an nginx config whose header lines are translated at image build from `dist/_headers`' `/*` block. The Vite build derives a `Content-Security-Policy-Report-Only` from `VITE_SUPABASE_URL` and the inline script hashes and appends it to `dist/_headers`; HSTS joins `public/_headers`. CI builds the image (never pushed) and probes it with no network.

## Boundaries & Constraints

**Always:**
- Every response, errors included, carries every header of `dist/_headers`' `/*` block with its exact value; nothing else in the image sets a security header. The translation refuses (fails the image build) a block other than `/*`, a `!` detach, a duplicate name, or a value with `"`, `$`, `\` or a control character.
- Cache: `/assets/*` → `public, max-age=31536000, immutable` (success only, never on a 404); everything else (`index.html`, the fallback, `sw.js`, `push-sw.js`, the manifest, icons) → `no-cache`.
- Fallback: an unknown path outside `/assets/` answers `index.html` with 200; a missing `/assets/…` file is a plain 404, never `index.html`; `*.map` is 404 and no map is in the image (`.dockerignore` keeps maps out of the context; the build fails if one remains).
- The image runs as uid 101, its config and files root-owned and not writable by it; `server_tokens off`; it validates its config at build (`nginx -t`).
- CSP: `default-src 'self'`; `script-src 'self'` plus each inline script's `sha256`; `style-src 'self' 'unsafe-inline'`; `img-src` and `connect-src` `'self'` plus the Supabase origin; `font-src`, `worker-src`, `manifest-src`, `base-uri`, `form-action` `'self'`; `object-src`, `frame-src`, `frame-ancestors` `'none'`. A non-http(s) or unparseable `VITE_SUPABASE_URL` fails the build; an empty one yields the policy without an origin.
- Public repository: placeholders only; no address, hostname, registry owner or secret.

**Ask First:** none (founder: no questions; decisions recorded here).

**Never:** start, run, stop or push a container or image locally; touch the host, Coolify or Traefik; create a secret or registry credential; enforce the CSP (20.5); change the deploy action (20.6).

## I/O & Edge-Case Matrix

| Scenario | Request | Expected |
|----------|---------|----------|
| Root, deep link | `/`, `/kalendar/2026-09` | 200 `index.html`, `no-cache`, all `_headers` headers |
| Worker | `/sw.js`, `/push-sw.js` | 200 JS, `no-cache` |
| Hashed asset | `/assets/index-….js` | 200, immutable one year |
| Missing asset | `/assets/nope.js` | 404 not HTML, headers present, no immutable |
| Map | `/assets/x.js.map` | 404 |
| Manifest | `/site.webmanifest` | `application/manifest+json`, `no-cache` |

## Epic AC Deviations

- "**When** CI builds it from the environment's `apps/web/dist`" — NARROWED: CI builds it from the `build` job's `dist` (no environment's `VITE_*`), proving the image only. Building it per environment from that environment's `dist` is 20.6's deploy job (`deferred-work.md` entry).
- "they equal `_headers`' headers … and HSTS is set" — REINTERPRETED: the image serves the BUILT `dist/_headers` (`public/_headers` plus the build's CSP line), and HSTS (`max-age=31536000; includeSubDomains`, no preload) is a line of `public/_headers` itself, so one file holds every security header. "A test starts the image": the CI `web-image` probe; locally no container may run, so Vitest asserts the translation and config.
- "closes the `deferred-work.md` CSP and HSTS entries there" — met as stated: the entry is marked RESOLVED in part (drafted, Report-Only; HSTS set); enforcing and verifying stay 20.5's.

</frozen-after-approval>

## Code Map

- `apps/web/public/_headers` -- the `/*` block (4 headers); Cloudflare's format; parsed by `test/static-hosting.test.ts` `headersForAllPaths`/`securityOverrides` (pins `SECURITY_HEADERS`).
- `apps/web/vite.config.ts` -- plugins list; `build.sourcemap: 'hidden'`; workbox `navigateFallback`, `importScripts: ['push-sw.js']`.
- `apps/web/index.html:39-53` -- the one inline `<script>` (theme pre-script); inline `<style>` blocks and a `style=` attribute (hence `'unsafe-inline'` styles).
- Built bundle: no `eval`; pdfmake's `Function('return this')` only as a guarded fallback; no `data:` in CSS; supabase-js' worker blob unused (no Realtime).
- `.dockerignore` -- shared build context (20.2); add maps.
- `.github/workflows/pipeline.yml:88-153,386-388` -- `build` uploads `web-dist`; `functions-image` pattern; `ci-passed.needs`; `actions/download-artifact@9000827c… # v8.0.2` already pinned.
- `scripts/ci/probe-functions-image.sh` -- probe pattern (trap cleanup, `expect`).
- `test/self-hosted-stack.test.ts:899-960` -- public-repo scans over every `deploy/` file and DEPLOY.md §9 onwards: hosts only as services, `127.0.0.1`, `<…>` or `$…`; avoid `scheme://literal` text.
- `nginxinc/nginx-unprivileged:1.30.6-alpine3.24` (stable line, 2026-10-19), index digest `sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03`: user `101`, listens 8080, `pid /tmp`, includes `conf.d/*.conf`; `mime.types` lacks `webmanifest`; `/etc/nginx` is uid-101 group-writable; no bash or curl, but busybox `nc`, `timeout`, `find`, `awk`, `wget`. Entrypoint scripts skip a read-only `default.conf`. Do NOT `listen [::]`: a container without IPv6 fails to bind.
- nginx pitfalls: a location with any `add_header` inherits none from the server, so each location includes the headers file; `always` on the security headers (errors too) but NOT on the immutable `Cache-Control`.
- CI probe shape: the container runs `--network none`; requests go through `docker exec … nc 127.0.0.1 8080` with raw `HTTP/1.0` (busybox `wget` hides error responses' headers). The headers to expect are parsed from the same `dist/_headers` on the runner.
- Root tests must not skip (`scripts/ci/assert-no-skipped.mjs`): no `skipIf` on a tool's presence; build-gated cases use the existing `notBuilt` pattern.
- `DEPLOY.md` §9.6 -- where §9.7 goes.
- `ARCHITECTURE-SPINE.md:221-222` -- AD-14's self-hosting and 20.2 amendments.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/lib/content-security-policy.ts` (+ colocated test) -- pure `supabaseOriginOf`, `inlineScriptsOf(html)`, `contentSecurityPolicy({ supabaseOrigin, scriptHashes })`, `CSP_HEADER` -- unit-testable policy.
- [x] `apps/web/vite.config.ts` -- build-only plugin: after the bundle is written, hash `dist/index.html`'s inline scripts and append `CSP_HEADER: <policy>` to `dist/_headers`' `/*` block; fail on a missing file.
- [x] `apps/web/public/_headers` -- HSTS line; comment names the image.
- [x] `deploy/web/render-headers.sh` -- POSIX sh + awk: `/*` block → `add_header Name "value" always;`, with the refusals above.
- [x] `deploy/web/default.conf` -- server on 8080: fallback, `/assets/` immutable + `=404`, `\.map$` 404, manifest type, gzip, `server_tokens off`, `absolute_redirect off`; the headers include in every location.
- [x] `deploy/web/Dockerfile` -- render stage + final stage on the pinned image (tag and digest), root-owned files, `nginx -t`, `USER 101`.
- [x] `.dockerignore` -- `**/*.map`.
- [x] `scripts/ci/probe-web-image.sh`, `.github/workflows/pipeline.yml` -- job `web-image` (needs `build`): download `web-dist`, build (no push), run `--network none --read-only`, probe the matrix plus uid, no map, no writable file; required by `ci-passed`.
- [x] `test/web-image.test.ts` -- render script run under `sh` (real `_headers` and refusals), config and Dockerfile pins, CI job shape (no secrets, no push, no login).
- [x] `test/static-hosting.test.ts` -- HSTS pinned; the built `_headers` carries the Report-Only CSP whose script hashes match the built page.
- [x] `DEPLOY.md` -- §9.7 the SPA image; §9.1 row.
- [x] `ARCHITECTURE-SPINE.md` -- `Amended 2026-11-21 (20.3)` on AD-14.
- [x] `deferred-work.md` -- CSP/HSTS entry RESOLVED in part; new 20.6 entry (per-environment build and push); 20.5 entry (verify then enforce).
- [x] `sprint-status.yaml` -- 20.3 `review  # built, CI pending`.

**Acceptance Criteria:**
- Given `public/_headers` and the render script, when run under `sh`, then it prints one `add_header … always;` per `/*` header with the identical value, and exits non-zero on each refusal.
- Given a build with `VITE_SUPABASE_URL` set, when `dist/_headers` is read, then its `/*` block has the Report-Only CSP naming that origin in `connect-src` and `img-src`, and a hash per inline script of `dist/index.html`.

## Design Notes

nginx-unprivileged over Caddy (root by default, larger) and static-web-server (smaller project): F5-maintained, ~20 MB, non-root by design. The CSP is computed in the Vite build, not in the image, so it is derived from the very `VITE_SUPABASE_URL` the bundle was built with and cannot drift from it; the image only translates. No `report-uri`: there is no endpoint to receive reports; 20.5 reads the browser's Report-Only console messages on staging. Enforcing = changing `CSP_HEADER`.

Reviewed decision (review, 2026-11-21): the fallback stays as frozen. Every unknown path outside `/assets/` answers `index.html` with 200, so a missing root file such as `/sw.js` keeps answering the shell, as Cloudflare Pages did (parity). Only `/assets/` is different: a missing file there, and the `/assets/` directory itself (which `try_files` would otherwise answer with 403), is a plain-text 404.

## Verification

**Commands:**
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/self-hosted-stack.test.ts test/static-hosting.test.ts test/key-hygiene.test.ts test/ci-scripts.test.ts test/web-image.test.ts` (after `pnpm build`) -- pass.
- `pnpm --filter ./apps/web exec vitest run src/lib/content-security-policy.test.ts`, `pnpm typecheck`, `pnpm lint` -- clean.

**Manual checks:**
- Render script under `busybox sh` (the image's shell); nginx config parsed by `crossplane`. The image itself is built and probed only in CI.

**Result (2026-11-21, after the review patches):** after `pnpm build` (no `VITE_SUPABASE_URL`), the seven root files above, run three times in a row: 2155 passed, 0 failed, 0 skipped each time. `content-security-policy.test.ts`: 20 passed. `pnpm typecheck` and `pnpm lint` clean. No container was started and no image built. Against a build with `VITE_SUPABASE_URL=https://api.example.test`, the same seven files: 2155 passed when the test process has the same variable, and 1 failed when it does not (`static-hosting.test.ts` › "names the Supabase origin the build was made with in connect-src and img-src": the test reads the origin the way Vite would and finds none). So the CI change writes the placeholder to `apps/web/.env.production.local` (gitignored) before the `test` job's build, which `vite build` and the test's `loadEnv('production')` both read and Vitest's `test` mode never does: with that file, the seven files passed 2155/2155 (2026-11-21, orchestrator rerun; file removed after). Before the patches, one run of the set reported 1 failed test out of 2142. Its name was not captured, and four later runs (one under `pnpm typecheck` load) passed. It stays unexplained.

Manual checks:
- `render-headers.sh` under `sh` (dash + gawk) and `busybox sh`/`awk` on `public/_headers`, the built `dist/_headers` and every refusal/edge case (a second `/*` block, a header nginx sets itself, a non-ASCII value included): identical output and exit codes in both.
- The built `dist/_headers` (no `VITE_SUPABASE_URL`) carries the Report-Only CSP with the theme pre-script's `sha256-…` and no origin; a scratch build with `VITE_SUPABASE_URL=https://api.example.test` names that origin in `img-src` and `connect-src`; `ftp://…` and a host with `"` fail the build.
- The image's own `nginx.conf` + `mime.types`, `deploy/web/default.conf` and the rendered headers (paths rewritten to a scratch dir) parsed by `crossplane`: status ok, no errors.
- `scripts/ci/probe-web-image.sh` driven through a stand-in `docker` (no container: `exec` ran the probe's own `sh -c … nc` through busybox against a Python stand-in serving the built `dist` with the rendered headers): every check ok, including `/assets/`, `POST /` (405), `HEAD /`, the hashed CSS and gzip (`Content-Encoding: gzip`, `Vary: Accept-Encoding` over HTTP/1.1); dropping one header from the stand-in, or a find hit, fails it.
- Not verifiable here, CI's `web-image` job only: `nginx -t` on the pinned image, the real nginx answers, uid 101, and the mode checks inside the built image.

### Review Findings (2026-11-21)

Layers: blind hunter, edge-case hunter, verification gap, epic-AC auditor (no unlisted deviation). Run unattended.

- [x] [Review][Patch] The plugin's origin wiring was never tested with an origin → `headersWithPolicy` extracted and unit-tested; CI's `test` job builds with a placeholder origin in `.env.production.local`; the test reads it through Vite's `loadEnv` [content-security-policy.ts, vite.config.ts, static-hosting.test.ts, pipeline.yml]
- [x] [Review][Patch] Inline-script hashing: `<!--` inside a script, `src` inside a quoted value, CRLF → script elements found before comments, `src` as an attribute name only, LF-normalised [content-security-policy.ts]
- [x] [Review][Patch] Repeated `/*` blocks, headers nginx sets itself, non-ASCII values → refused [content-security-policy.ts, render-headers.sh]
- [x] [Review][Patch] A dist without a CSP line could build; files not guaranteed readable; no healthcheck → build refuses it, `chmod a+rX`, busybox `wget` HEALTHCHECK [Dockerfile]
- [x] [Review][Patch] `/assets/` answered 403 → plain-text 404 [default.conf]
- [x] [Review][Patch] `.dockerignore` dropped every `.map` of the shared context → `apps/web/dist/**/*.map` only
- [x] [Review][Patch] Probe covered only 200s and hand-written 404s → `POST /` 405, `HEAD /`, `/assets/`, gzip, hashed CSS [probe-web-image.sh]
- [x] [Review][Patch] DEPLOY.md §4's header `grep` missed the new headers; HSTS/CSP reaching Pages and COOP/CORP left out unstated → fixed, stated [DEPLOY.md]
- [x] [Review][Patch] The 1-1a CSP/HSTS deferral contradicted itself → rewritten [deferred-work.md]
- [x] [Review][Defer] No automated refresh of the pinned base image → 20.9 (deferred-work)

Rejected, with reasons: a 404 for missing root-level files (the frozen fallback; parity with Pages, recorded above); a browser CSP check in e2e or a report endpoint (20.5 verifies on staging; a collector is a new service); `\.map$` matching a client route ending in `.map` (no route does); a founder sign-off on HSTS (the founder delegated the decision; recorded in the deviations); COOP/CORP (headers equal today's hosting; a later hardening choice).

## Suggested Review Order

**The policy, derived at build**

- Entry point: the Report-Only policy, its origin and inline-script hashes appended to `_headers`.
  [`content-security-policy.ts:184`](../../apps/web/src/lib/content-security-policy.ts#L184)

- Directive list; enforcing in 20.5 is the `CSP_HEADER` constant.
  [`content-security-policy.ts:101`](../../apps/web/src/lib/content-security-policy.ts#L101)

- The build-only plugin that reads `VITE_SUPABASE_URL` and rewrites `dist/_headers`.
  [`vite.config.ts:61`](../../apps/web/vite.config.ts#L61)

**The image**

- `_headers` to nginx `add_header`, with every refusal.
  [`render-headers.sh:35`](../../deploy/web/render-headers.sh#L35)

- Fallback, cache rules, header include per location.
  [`default.conf:42`](../../deploy/web/default.conf#L42)

- Pinned base twice, CSP guard, root-owned files, `nginx -t`, uid 101.
  [`Dockerfile:24`](../../deploy/web/Dockerfile#L24)

**CI**

- Build-only job from the build job's dist; required by `ci-passed`.
  [`pipeline.yml:165`](../../.github/workflows/pipeline.yml#L165)

- Offline probe: headers equal `dist/_headers` on every response.
  [`probe-web-image.sh:83`](../../scripts/ci/probe-web-image.sh#L83)

**Docs and tests**

- The runbook section for the image.
  [`DEPLOY.md:2172`](../../DEPLOY.md#L2172)

- Render script, config, Dockerfile and job pins.
  [`web-image.test.ts:1`](../../test/web-image.test.ts#L1)
