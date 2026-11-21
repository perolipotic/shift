---
title: '19.1 The signup door opens safely on staging'
type: 'feature'
created: '2026-11-21'
status: 'done'
baseline_commit: '6baf5ff7d13bc2e52b1ec56fb44e05bf2fe9b17c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/SECURITY-REVIEW-EPIC-19.md'
---

Baseline: `origin/main` at #338 (AP2). Touches the hot file `hr.json` (and `test/resource-hygiene.test.ts`'s key list); story 16.2, built in parallel, does not touch them. Migration `0065` was the next free number at the time of writing; story 16.2 (PR #339) took `0065` (`0065_member_schedule_inputs.sql`), so this story's migration is renumbered `0066_signup_door.sql`.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Signup is shut everywhere by one GoTrue flag. Opening it on staging, as epic 19 needs, must not open production by accident, must not let an unverified or synthesized address in, must not let a caller learn which addresses exist, and must leave every claimless account reading nothing (AD-21, AD-22, AD-10; D-S3, D-S4, D-S5, D-S9).

**Approach:** Build AD-21's three switches, each shut by default: GoTrue's environment, guarded by an entrypoint wrapper that refuses a half-built open door; `private.signup_settings` with the before-user-created hook; and the SPA flag, refused for production by `require-config.mjs`. Add Kong's per-IP limits and client-IP chain, and replace Kong's `/auth/v1/` catch-all with AD-22's allow-list, including `auth-v1-mail`'s immediate `200 {}` and its background relay (F1). Send Auth email over Resend SMTP with Croatian templates built from `hr.json`. Prove from the catalog that a confirmed claimless account reads and writes nothing.

## Boundaries & Constraints

**Always:**
- The compose defaults `GOTRUE_DISABLE_SIGNUP=${SHIFT_DISABLE_SIGNUP:-true}` and `GOTRUE_MAILER_AUTOCONFIRM=${SHIFT_MAILER_AUTOCONFIRM:-true}`. `production.env.example` keeps both `true`, and `staging.env.example` sets both `false`. `config.toml` carries staging's values: signup on, confirmations on, `otp_expiry = 3600`, `otp_length = 10`, and the before-user-created hook. The parity test pins all of these.
- The auth entrypoint (run under `sh` by the test, as Kong's is) refuses any boolean it reads that is not exactly `true` or `false`. With signup on, it also refuses each of these: autoconfirm, missing SMTP, the hook off, no rate-limit header, an OTP longer than 3600 s or not 10 characters long, and a template URL whose body lacks `token_hash`.
- The hook answers one refusal, `403 SIGNUP_REFUSED`, for every reason, writes nothing, and is executable by `supabase_auth_admin` only. `signup_settings` is closed by default, and no session role holds a privilege on it. Locally, `seed.sql` opens it.
- One address predicate (trim ASCII whitespace, lower-case ASCII only; malformed means no `@`, more than one `@`, a quote, an empty part; synthesized means the domain, with one trailing `.` removed, is `shift.invalid` or ends in `.shift.invalid`). The SQL and Lua homes each run `test/fixtures/synthesized-addresses.json`.
- Kong's `/auth/v1/` is an allow-list (AD-22 table), and its limits come from compose variables with staging defaults. It uses `KONG_TRUSTED_IPS=${SHIFT_PROXY_CIDR:?}` (it refuses `0.0.0.0/0` and `::/0`), `KONG_REAL_IP_*`, `KONG_HEADERS=off`, and GoTrue's `GOTRUE_RATE_LIMIT_HEADER=X-Real-IP` with its own limits set.
- No literal secret anywhere. `GOTRUE_SMTP_PASS` appears only as `${GOTRUE_SMTP_PASS:-}`.

**Ask First:** none (the founder ratified D-S1–D-S10 and said decide and record).

**Never:** open production in any file. Do not build `/registracija`, `/potvrda`, email sign-in, the SPA home of the predicate, `create_organization` or the probe (19.2/19.3). Do not run docker containers, `supabase`, e2e or DB-connecting tests. Do not use a Traefik label middleware.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Production env | template values | GoTrue starts with the door shut | n/a |
| Half-built open door | `SHIFT_DISABLE_SIGNUP=false`, any guard unmet | the auth entrypoint exits non-zero and names the guard | no start |
| Odd boolean | `0`, `f`, `False` | refused | no start |
| Mail route | any body to signup/recover/resend | `200 {}` at once; relayed only for an `email` address with its route's fields | relay failure logged as a fixed code |
| Verify | anything but `{token_hash, type}` (+ supabase-js's `gotrue_meta_security`) | `400 {}`; a GET is 404 | n/a |
| `PUT /user` | body with `email` or `phone`, or unreadable | `422 {}` | n/a |
| Path variant | `/auth/v1/signup/`, `//`, `;`, `%75`, `otp`, `magiclink` … | 404 | n/a |
| Claimless confirmed account | every table, view, executable function, Storage, the functions | zero rows, a null or a refusal; every write refused | n/a |

## Epic AC Deviations

- "Auth email goes over SMTP … with Croatian templates from the locale resource (D-S4)": met for staging. Locally, the CLI's default templates and its mail catcher stay in place, because the template links need `/potvrda`, which 19.2 builds. **Narrowed; DEFERRED to 19.2** (deferred-work entry).
- "every table, every RPC, storage and all four Edge Functions": two functions exist (`admin-auth`, `notify`). The suite enumerates `supabase/functions/`, so `calendar-feed` and `remind` are covered when they land. **Reinterpreted.**
- "`clearMustSetPassword` stays harmless": proven in the same unrun DB suite, as a claimless caller. CI is its first run. **Not deviated.**
- AD-22's "relays the original body": the relay sends a body rebuilt from the route's fields only (`email`, plus `password` for signup, plus `type = signup` for resend). Verify forwards a rebuilt `{token_hash, type}`. This narrows AD-22, and the spine records it. **Narrowed.**
- AD-21's "120 per 5 minutes" and "30 per 5 minutes": Kong 2.8's `rate-limiting` has no 5-minute window. The limits are /auth/v1/token 60 a minute and 1440 an hour, and /auth/v1/verify 15 a minute and 360 an hour. The spine records it. **Reinterpreted.**

</frozen-after-approval>

## Code Map

- `supabase/migrations/0066_signup_door.sql` -- new: `private.address_kind`, `private.is_synthesized_address`, `private.signup_settings` (seeded, closed, all revoked), `public.before_user_created_hook` (definer, `search_path = ''`, `supabase_auth_admin` only), modelled on `0003`'s access-token hook grants.
- `supabase/seed.sql` -- opens `signup_settings` locally.
- `supabase/config.toml` -- `[auth] enable_signup`, `[auth.email] enable_confirmations`/`otp_expiry`/`otp_length`, `[auth.hook.before_user_created]`; "no open signup" comment rewritten.
- `deploy/coolify/supabase/docker-compose.yml` -- Kong (allow-list, post-functions, `rate-limiting`, trusted IPs, headers off, sandbox requires, entrypoint guards); GoTrue (switches, SMTP, hook, limits, OTP, templates, subjects, entrypoint wrapper).
- `deploy/coolify/supabase/{staging,production}.env.example` -- new operator inputs.
- `test/fixtures/synthesized-addresses.json` -- the vectors.
- `test/self-hosted-stack.test.ts`, `test/supabase-scaffold.test.ts`, `test/key-hygiene.test.ts`, `test/ci-scripts.test.ts` -- pins (existing "no open signup", "confirmations off" and the Kong route pins are rewritten).
- `test/claimless-account.test.ts` -- new DB suite (unrun): catalog sweep, hook refusals, clearMustSetPassword.
- `apps/web/src/lib/i18n/locales/hr.json` (`signup.email.*`), `apps/web/vite.config.ts` (emit `auth-email/*.html`, kept out of the precache), `test/resource-hygiene.test.ts` (sanctioned keys), `test/auth-email.test.ts` (new: templates and subjects pinned to `hr.json`).
- `scripts/ci/require-config.mjs`, `.github/workflows/pipeline.yml` -- refuse `VITE_SIGNUP_ENABLED` for production.
- `devDependency fengari 0.1.5` -- runs the rendered Lua predicate in Node (no Lua on the runners).
- `DEPLOY.md`, the spine (AD-21/AD-22 applied clauses), `deferred-work.md`, `sprint-status.yaml`.

## Tasks & Acceptance

**Execution:**
- [x] migration, seed and config.toml, as mapped.
- [x] compose and env templates, as mapped; Kong render plus F1 rehearsal on the pinned Kong (chroot, private netns).
- [x] templates build, hr.json, require-config and workflow.
- [x] tests, as mapped; DEPLOY.md, spine, deferred-work and sprint-status.

**Acceptance Criteria:**
- Given the repo, when the allowed root suites, web tests, typecheck, lint and build run, then they pass.
- Given the rendered Kong config, when the rehearsal sends the matrix's requests, then each answer is as listed, and the F1 result is recorded below.

## Spec Change Log

- 2026-11-21 (build) — The Code Map grew, outside the frozen block: `apps/web/src/lib/auth-email.ts` (the template builder the Vite plugin and `test/auth-email.test.ts` share), `apps/web/src/pages/key-sweep.test.ts` (leaves `signup.email.*` out of the screen-key sweep, as it leaves `obavijesti.*`), `test/static-hosting.test.ts` (`auth-email` sanctioned in `dist/`), `test/provisioning.test.ts` (grantee and attribute entries for 0066's three functions, unrun), `smoke/deployment.spec.ts` (the signup probe now asserts Kong's one `200 {}` for a synthesized address, which writes nothing, and 404s on closed paths; the old `422 signup_disabled` can no longer be seen through Kong). `test/self-hosted-stack.test.ts` "has files to read" did not break: the auth wrapper is a `content:` bind in the compose, as Kong's entrypoint is.
- 2026-11-21 (build, rehearsal) — Kong 2.8.1 matches a regex route on the NORMALIZED path (`//`, `%75` reached the signup route). Each allow-listed route therefore carries a raw-path guard that passes only its paths as written and answers anything else with Kong's own 404 body. Recorded in the spine (AD-22 as amended).
- 2026-11-21 (review 1, applied) — the guards moved to a `pre-function` (in `KONG_PLUGINS`), which runs before cors, key-auth and the limits, so a variant is 404 with or without a key (rehearsed again); the admin route took methods, lost cors and gained a prefix guard; the mail route logs `AUTH_MAIL_RELAY <route> UNREAD`; verify takes a hex hash only; Kong refuses a trusted network wider than an IPv4 /8 or an IPv6 /32; the auth wrapper retries each template fetch 6 times 5 s apart and checks the OTP and templates whenever SMTP is set; nginx serves `/auth-email/` as itself or a plain 404, never index.html, and the web probe asserts the three templates; the hook's username reason is ASCII-only and no longer tautological; the smoke tells the local CLI stack (403 `SIGNUP_REFUSED`) from a deployed one; the stack test runs every rendered chunk in fengari behind a stand-in PDK and refuses Lua 5.3-only syntax; the claimless sweep counts only 42501 or zero rows as refused, counts real ids, names unswept functions and runs in repeatable read.

## Design Notes

Decisions (founder: decide and record): D1 the scope split above. D2 the hook is enabled in every environment, because the door is shut by `GOTRUE_DISABLE_SIGNUP` and `signup_settings`. D3 the limits: mail 5/h and 20/day; token 60/min and 1440/h; verify 15/min and 360/h; `rpc/create_organization` 10/h. The REST catch-all refuses (404) any other spelling of `create_organization` (percent-encoded, doubled `/`, upper case), so the limit cannot be bypassed. D4 the `accounts_per_day` ceiling counts `auth.users` rows accounts with no `members` row created in the last 24 h. D5 the predicate lower-cases ASCII only, in every home, so a Unicode case fold cannot make the homes disagree. D6 the template fetch at start goes to the app origin over HTTPS (busybox `wget` and `ssl_client` are in the GoTrue image). D7 the CORS preflight is allowed on every browser-called auth route (methods include `OPTIONS`). D8 a mail relay that fails logs `AUTH_MAIL_RELAY <route> <status>` and never the address.

Findings from planning, checked against the pinned images. The rootfs extracted with `docker image save` is in the scratchpad: Kong at `/tmp/claude-0/-root-ai-agency-projects-shift/15d9a6a8-661d-4657-8658-921e573ab7c3/scratchpad/kongroot`, GoTrue at `…/scratchpad/gtroot`.
- **Kong 2.8.1's sandbox** (`kong/tools/sandbox.lua`, `kong-lua-sandbox.lua`, `pre-function/_handler.lua`). The function environment is the sandbox's base set (`type`, `pairs`, `ipairs`, `tostring`, `pcall`, `string.*`, `table.*`, `math.*`, `os.time`/`clock`/`date`) plus the real `kong` and `ngx`, so `ngx.timer.at` is reachable. `require` loads only the names in `untrusted_lua_sandbox_requires`. That makes the setting `KONG_UNTRUSTED_LUA_SANDBOX_REQUIRES=resty.http,cjson.safe`. LuaJIT runs with no instruction quota. Offline, this shows that F1 is *allowed*. Whether it *works* (DNS from a timer, the cosocket) is what the chroot rehearsal shows.
- **Kong's nginx template already sends `X-Real-IP $remote_addr` upstream**, and it overwrites a client's value. With trusted IPs and `real_ip_header`, `$remote_addr` is the resolved client. Only the timer relay sets `X-Real-IP` itself, from `kong.client.get_forwarded_ip()`. Defaults: `headers = server_tokens, latency_tokens`, `trusted_ips = NONE`, `real_ip_header = X-Real-IP`.
- **No `$` followed by a letter or `_` in any Lua or YAML inside the compose `content:`.** The Kong entrypoint's awk substitutes `$NAME` for every name in its environment, and Coolify reads `${…}`. Lua anchors such as `$"` or `$` at the end of a line are safe. A trailing trim is a byte loop, not `%s+$`.
- **Kong route paths.** A Kong 2.x path is a prefix, so each allow-listed route is a regex anchored with a trailing `$` (`/auth/v1/signup$`). Whether 2.8.1 matches the raw or the normalized URI (`%75`, `//`, `;`) is settled by the rehearsal, not assumed.
- **Plugin order** in the access phase follows priority: cors 2000, key-auth 1250, acl 950, rate-limiting 901, request-transformer 801, post-function −1000. A 429 or 401 therefore comes before the mail route's `200 {}`. A preflight is answered by cors before key-auth.
- **supabase-js 2.113 bodies** carry `gotrue_meta_security` (and optionally `code_challenge`, `data`). Verify must therefore tolerate `gotrue_meta_security`, and forward a rebuilt `{token_hash, type}` with `kong.service.request.set_raw_body`.
- **GoTrue v2.196.0.** The image runs `auth` (no entrypoint) as user `supabase`, on Alpine with busybox `sh`, `wget` and `/usr/bin/ssl_client`. The hook input is `{metadata:{uuid,time,name,ip_address}, user:{…, email, …}}`, and it refuses with `{error:{http_code,message}}`. Env names: `GOTRUE_SMTP_{HOST,PORT,USER,PASS,ADMIN_EMAIL,SENDER_NAME,MAX_FREQUENCY}`, `GOTRUE_MAILER_OTP_{EXP,LENGTH}`, `GOTRUE_MAILER_TEMPLATES_{CONFIRMATION,RECOVERY,EMAIL_CHANGE}`, `GOTRUE_MAILER_SUBJECTS_*`, `GOTRUE_RATE_LIMIT_{HEADER,EMAIL_SENT,VERIFY,TOKEN_REFRESH}`, `GOTRUE_HOOK_BEFORE_USER_CREATED_{ENABLED,URI}`.
- **Every account the system creates today is confirmed at creation.** That covers `admin-auth` (`email_confirm: true`, `operations.ts:746`, `:943`), `seed.sql`, `provision-organization.sql`, `demo-organization.sql` and the test helpers (`email_confirmed_at`). So turning autoconfirm off breaks no username sign-in. `POST /admin/users` does not run the hook.
- **Pins the change breaks:** `test/supabase-scaffold.test.ts` "leaves the email provider on while open signup stays refused", "keeps email confirmations off, outright" and `GOTRUE_MIRROR`; `test/ci-scripts.test.ts:218` (`enable_signup = false`); and `test/self-hosted-stack.test.ts`'s route and key-auth tests (`auth-v1` and its catch-all go away) and "has files to read".
- **The CLI 2.116.0 config** knows `[auth.hook.before_user_created]` and `[auth.email] otp_length`/`otp_expiry`.
- **DB test helpers.** `test/database.ts` (`connect`, `noDatabase`, `localApiEndpoint`, `localSecretKey`). For the `actAs` pattern, see `test/rls-isolation.test.ts:493`. For live admin-API and token use, and `clearMustSetPassword` called in-process, see `:4700` and `:5440`.
- **The F1 rehearsal** follows 20.2's method (`spec-20-2-…md`, Verification). Render `kong.yml` with the compose's own entrypoint, minus its `exec`. Then run `/usr/local/bin/kong` from the Kong rootfs under `chroot` inside `unshare -n` (loopback only), with `/etc/hosts` mapping `supabase-auth`/`supabase-rest` to 127.0.0.1 and busybox listeners standing in for GoTrue and PostgREST. No docker container is ever started.

D3, as built: Kong 2.8 has no 5-minute window, so the per-minute windows (token 60, verify 15) allow bursts up to 2.5 times AD-21's 5-minute figures (300 token grants and 75 verifies in 5 minutes); only the hourly ceilings (1440, 360) hold AD-21's rate. Accepted for staging, revisited at D-S5; the values are unchanged.

Epic AC readings recorded after review:

- "production is unchanged" is read as "production's door stays shut". The shared compose does change production's Kong (the allow-list, `SHIFT_PROXY_CIDR` required, headers off, the limits) and GoTrue (the hook enabled, the SMTP and template variables), and the smoke's signup expectation.
- The 20.1 client-IP deferral is closed in the repository and confirmed on the host by 20.5.
- The DB suite's RPC criterion is "the same answer with real ids as with absent ids, and nothing for functions without ids" (D14), and the suite is unrun until CI.

Decisions taken while building (decide and record):

- D9. A single quote is malformed, as a double one is (AD-12 says "a quote"): no Founding Admin address needs one, and it keeps every home's string handling simple. The vector file pins it.
- D10. The predicate's SQL home is `private.address_kind(text)` (three answers) with `private.is_synthesized_address(text)` as its boolean; no session role may execute either (their callers are definers).
- D11. The mail routes are ONE Kong route with three paths, because Kong 2.8's `rate-limiting` counts per route: one route is what makes "signup, recover and resend together" one count.
- D12. GoTrue's sender is the operator input `SHIFT_AUTH_EMAIL_FROM`, and its hourly mail budget `SHIFT_AUTH_EMAIL_PER_HOUR` (10); host `smtp.resend.com`, port 465, user `resend` and sender name `Shift` are literals (AD-17 as amended).
- D13. `require-config.mjs` refuses `VITE_SIGNUP_ENABLED` for production from its own table (`REFUSED_BY_ENVIRONMENT`), not from a requirement word, so the two deploy jobs' requirement lists stay equal (`test/coolify-deploy.test.ts`); unset, empty or exactly `false` passes, anything else fails the job.
- D14. The claimless sweep holds every function to "the same answer with the pilot's real ids as with ids that exist nowhere" (and a function with no id argument to answering nothing), plus a row-count snapshot of public, private, Storage and Auth before and after: a precise form of "zero rows, a null or a refusal" that a defaulting reader (`member_active_on` answers `true` for an unknown member) cannot fail by accident.

## Verification

**Commands:**
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/self-hosted-stack.test.ts test/key-hygiene.test.ts test/functions-router.test.ts test/coolify-deploy.test.ts test/ci-scripts.test.ts test/auth-email.test.ts` -- pass
- `pnpm --filter ./apps/web test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` -- pass
- `test/claimless-account.test.ts` -- DB-connecting, not run locally (STRICT DATABASE RULE). CI is its first run, and locally it skips with no stack.

**Results (2026-11-21, build):**
- `pnpm typecheck`, `pnpm lint` -- clean.
- `pnpm build` -- pass; `dist/auth-email/{confirmation,recovery,email-change}.html` emitted, absent from `sw.js`'s precache.
- `pnpm --filter ./apps/web test` -- 177 files, 6658 passed (after `key-sweep.test.ts` left `signup.email.*` out of the screen sweep).
- The eight DB-free root files above -- pass (self-hosted-stack 54, supabase-scaffold 115, auth-email 6, key-hygiene, resource-hygiene, ci-scripts, coolify-deploy, functions-router).
- NOT RUN locally (the STRICT DATABASE RULE and the caller's rules): `test/claimless-account.test.ts` (new, unrun: CI is its first run), `test/provisioning.test.ts` (three entries added, unrun), `test/static-hosting.test.ts` (one entry added; DB-free, but not on this run's allowed list), `smoke/deployment.spec.ts` (remote), e2e. gitleaks was not run: no change was committed, and running its container is outside this run's rules.
- The SQL home was also run, outside any test and on no shared database, in an in-process PGlite (Postgres 17) holding stand-ins for `auth.users` and `members`: all 38 vectors agree with the fixture, and the hook answered `{}` for an email identity with the door open and `SIGNUP_REFUSED` for a closed door, a synthesized, malformed, null or whitespace-local address, and the ceiling, and `{}` again one row below it.

**The Kong rehearsal and F1 (recorded here, as the AC asks).** Kong 2.8.1 run from its saved image (`kongroot`) under `chroot` inside `unshare -n -m` (loopback only), with the compose's own entrypoint, `temp.yml` and log format, fake keys, `KONG_TRUSTED_IPS=127.0.0.1` standing for Traefik's network, and Python stand-ins for GoTrue (9999: the mail routes answer 500 after 1.5 s) and PostgREST (3000). No docker container was started. Every row of the matrix answered as listed:
- **F1: the relay works; F1 does not open.** `POST /auth/v1/signup` answered `200 {}` in 6–7 ms while the stand-in took 1.5 s; the stand-in then received `POST /signup` with exactly `{"email","password"}` (the client's `data` and `gotrue_meta_security` dropped) and `X-Real-IP` = the resolved client (a client-sent `X-Real-IP` was not used), and Kong logged `AUTH_MAIL_RELAY signup 500, context: ngx.timer` with no address (the log held none). Recover relayed `{"email"}`; resend's `type` became `signup`.
- Synthesized (`ana@dvd.SHIFT.invalid.`), malformed (`a@@example.com`) and unreadable bodies: `200 {}`, nothing relayed. The same two response headers (`Content-Type`, `Access-Control-Allow-Origin`) on every mail answer; no `Server`, `Via` or `X-Kong-*` on Kong's own answers.
- Limits: the sixth mail request in the hour from one client answered 429; another client's still passed (one shared count for the three routes). No apikey: 401. Preflight: 200 with CORS, before key-auth.
- Verify: `{token_hash, type, gotrue_meta_security}` proxied as `{"type","token_hash"}`; email-plus-code, a `magiclink` type and an array body answered `400 {}`; a GET answered 404.
- `PUT /user` with `email`, `EMAIL`, `phone` or an unreadable body: `422 {}`; with `password`: proxied. Token, logout, health, jwks and admin (secret key) proxied; admin with the publishable key 403.
- Closed paths and variants, with a key, all 404: otp, magiclink, reauthenticate, invite, authorize, callback, factors, sso, settings, `signup/`, `/auth/v1//signup`, `//auth/v1/signup`, `signup;x`, `sign%75p`, `SIGNUP`, `token/`, `verify/`, `user/`, `admin`, `/auth/v1/`, `recover%2f` and two jwks look-alikes. Before the raw-path guards, `//signup`, `%75` and `//auth/v1/signup` reached the signup route (Kong normalizes before matching); the guards were added and the run repeated.
- `rpc/create_organization`: proxied with its client address; `%5F`, `%6F`, `//`, upper case, a trailing `/`, `%255F` and `/rest/v1//rpc/…` all 404; `/rest/v1/members` still proxied.
- An untrusted peer (127.0.0.2) sending `X-Forwarded-For` and `X-Real-IP` reached GoTrue as `X-Real-IP: 127.0.0.2`: neither header was believed.

**The auth wrapper under the GoTrue image's own busybox** (saved image `gtroot`, `chroot`, private namespaces, the built templates served over HTTPS from a stand-in origin whose self-signed certificate was trusted inside the mount namespace only): staging's environment with every guard met passed the wrapper and started GoTrue (which then stopped on the absent database, as expected); a missing recovery template, autoconfirm on, `GOTRUE_DISABLE_SIGNUP=False` and an empty SMTP key each refused with the guard's message; production's shut environment with no key started. Without the trusted certificate busybox's `ssl_client` refused the fetch (`certificate verify failed`): the D6 fetch verifies TLS.

**The templates (A GENERATED FILE IS OPENED).** The three built files were read back from `dist/auth-email/`: Croatian copy from `hr.json`, two links each of the form `{{ .SiteURL }}/potvrda?token_hash={{ .TokenHash }}&amp;type=<signup|recovery|email_change>`, inline styles only, no image, script or remote resource. They were not rasterized: this machine's Chromium lacks its shared libraries (`libatk`), so how a mail client draws them is unseen; 19.2 receives a real one in the mail catcher.

**Residual risks:**
- `test/claimless-account.test.ts` has never run. Its function sweep is generic (every `public` function `authenticated` may execute, called twice), so CI may find a function whose answer depends on its argument rather than on a row (a false positive) or a refusal code that differs between a real and an absent id; either is a finding to read, not to silence. The live-API cases assume the CLI's GoTrue answers a hook refusal at `/signup` as 403 with `SIGNUP_REFUSED` in the body.
- The CLI's local stack now has signup and confirmations on; the CI test job runs without the mail catcher (`mailpit` is excluded), so a local `/signup` of an email address there would fail to send. No test signs up an email address.
- GoTrue's own template fetch at mail time, and Resend's delivery, are unexercised until staging (20.5).

**Results (2026-11-21, review 1 applied):**
- `pnpm typecheck`, `pnpm lint`, `pnpm build` -- clean / pass. `pnpm --filter ./apps/web test` -- 177 files, 6658 passed.
- The eight allowed DB-free root files plus `test/static-hosting.test.ts` (DB-free; it opens no connection and starts nothing) -- 9 files, 2310 passed. The stack test now RUNS every rendered Kong chunk in fengari behind a Lua stand-in for the PDK, ngx, `cjson.safe` and `resty.http` (mail relays and their bodies, verify, `PUT /user`, the REST guard, every raw-path guard and its variants), refuses Lua 5.3-only syntax in every chunk, and drives the closed-path list through the Lua; the auth wrapper's retry (a stub `wget` that fails five times, then answers) and the mail checks on a shut stack with a key are tested.
- The Kong rehearsal was run again on the pinned image with the `pre-function` guards: every earlier row held; the five path variants sent WITHOUT a key answered 404 (before key-auth); the admin variants (`//`, `;`, `%75`, `./`, `../`), PATCH and an admin preflight answered 404; a `pkce_` hash answered 400; the untrusted peer was still seen as itself. The auth wrapper was run again under the GoTrue image's busybox: the retry loop and `$((…))` work there (a missing template refused after the six tries).
- NOT RUN locally: `test/claimless-account.test.ts` (rewritten: 42501 or zero rows only, real-id counting, unswept functions named, repeatable read), `test/provisioning.test.ts`, `test/web-image.test.ts` (the `/auth-email/` location pins: DB-free, but not on this run's allowed list), `scripts/ci/probe-web-image.sh` (needs docker), `smoke/deployment.spec.ts`, e2e. gitleaks not run (no commit; its container is outside this run's rules).
- Residual: the claimless sweep's stricter refusal rule may meet a BEFORE trigger or a constraint that answers before row-level security on some table (an SQLSTATE other than 42501); CI is where that is read. The hook's non-ASCII-capital refusal follows the database's `lower()`, exactly as `members_username_check` does, so it is locale-bound by design and asserted only in PGlite here.

## Suggested Review Order

**The door's three switches**

- GoTrue's switch, shut by default; production's template keeps it shut.
  [`docker-compose.yml:1317`](../../deploy/coolify/supabase/docker-compose.yml#L1317)

- The wrapper that refuses a half-built open door.
  [`docker-compose.yml:1388`](../../deploy/coolify/supabase/docker-compose.yml#L1388)

- The database switch and the one-answer hook.
  [`0066_signup_door.sql:151`](../../supabase/migrations/0066_signup_door.sql#L151)

- The SPA switch, refused for production.
  [`require-config.mjs:203`](../../scripts/ci/require-config.mjs#L203)

**Kong as the anti-enumeration boundary**

- The mail route answers `200 {}` and relays a rebuilt body from a timer (F1).
  [`docker-compose.yml:592`](../../deploy/coolify/supabase/docker-compose.yml#L592)

- The raw-path guards run first, so a variant is 404 with or without a key.
  [`docker-compose.yml:605`](../../deploy/coolify/supabase/docker-compose.yml#L605)

- Trusted proxy network: required, and never wider than /8 or /32.
  [`docker-compose.yml:363`](../../deploy/coolify/supabase/docker-compose.yml#L363)

**The address predicate**

- The SQL home; the Lua home is in the mail route, and both run the vector file.
  [`0066_signup_door.sql:66`](../../supabase/migrations/0066_signup_door.sql#L66)

**Auth email**

- Croatian templates built from `hr.json` at web build.
  [`vite.config.ts:98`](../../apps/web/vite.config.ts#L98)

**Tests**

- The claimless catalog sweep (unrun; CI is its first run).
  [`claimless-account.test.ts:385`](../../test/claimless-account.test.ts#L385)

- Kong's Lua run in fengari behind stand-ins.
  [`self-hosted-stack.test.ts:1648`](../../test/self-hosted-stack.test.ts#L1648)

- The GoTrue wrapper run under sh and busybox.
  [`self-hosted-stack.test.ts:1474`](../../test/self-hosted-stack.test.ts#L1474)
