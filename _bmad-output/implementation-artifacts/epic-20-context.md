# Epic 20 Context: Shift runs on our own server, and comes back from a backup

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Move every Shift environment off hosted platforms (no Supabase cloud, no Cloudflare Pages) onto our own server, run by Coolify: each environment is a self-hosted, trimmed Supabase stack plus a static SPA image, with only HTTPS public, off-host backups with a rehearsed restore, and external uptime alerts. No product behaviour changes. Nothing has ever been deployed, so there is nothing to migrate. The pilot's production go-live waits for this epic. Stories 20.1–20.3 and 20.4's scripts are code and docs that can be built now. Applying 20.4, and stories 20.5–20.9, wait for the founder to ratify decisions H-1 to H-15 and to supply credentials and DNS. Nothing in this epic touches the host, Coolify or a credential before that.

## Stories

- Story 20.1: The self-hosted stack is defined in the repository
- Story 20.2: Edge Functions run on the self-hosted runtime behind a keyless router
- Story 20.3: The SPA ships as a static image with its headers
- Story 20.4: The host is closed to everything but the web
- Story 20.5: Staging stands up on Coolify
- Story 20.6: The pipeline deploys through Coolify
- Story 20.7: Backups leave the host, and a restore is rehearsed
- Story 20.8: Someone hears when Shift is down
- Story 20.9: Production stands up, and DEPLOY.md is the self-hosting runbook

## Requirements & Constraints

- Every production component and the first copy of every backup runs on infrastructure we control. Off-host copies are encrypted at rest and stored in the EU.
- Recovery targets: RPO ≤ 24 h (daily dump, plus a manual backup before every production migration). RTO ≤ 4 h on the same host and ≤ 1 working day on a new host. A restore drill runs before go-live and then quarterly, and its duration is recorded.
- Only 443 and its port-80 redirect are reachable from the internet, over both IPv4 and IPv6. The database, Studio, the Coolify UI and API, and SSH are reachable only over the private tailnet.
- An outage of the app or the API is detected from outside the host and reported to the founder within 10 minutes.
- Security reviews: a `security-review` of the 20.2 router before production, and of the 20.4 firewall rules before they are applied.
- **Public repository.** Never commit server addresses, hostnames, tailnet names, ports observed on the host, SSH settings or secrets. Use placeholders such as `app.<domain>`.
- No new paid service. Only the backup target (H-11) and a future dedicated production host (H-14) could cost money, and both are founder decisions.
- Every story updates `DEPLOY.md` for what it ships and keeps `test/supabase-scaffold.test.ts` and `test/key-hygiene.test.ts` green. By 20.9, `DEPLOY.md` contains no Supabase-cloud or Cloudflare instruction.

## Technical Decisions

- **Stack file.** `deploy/coolify/supabase/docker-compose.yml` is derived from Coolify's Supabase service template at a recorded commit. It runs only Postgres 17 (`supabase/postgres`), Kong, GoTrue, PostgREST, Storage (file backend on a named volume), postgres-meta, Studio and `edge-runtime`. It does not run Realtime, analytics/Logflare, Vector, the pooler, MinIO or imgproxy.
  - Every image is pinned at the version the pinned Supabase CLI runs locally.
  - Secrets are Coolify-generated `SERVICE_PASSWORD_*` variables with no defaults.
  - Memory and CPU limits are set per service, with staging's lower (about 2.9 GiB for production, about 2.2 GiB and 1 CPU for staging).
  - The repository's file is the source of truth and is never hand-edited in Coolify.
- **Auth configuration (AD-10 as amended).** GoTrue is configured by compose environment variables, not `config push`: signup off, email provider on, anonymous sign-ins off, autoconfirm on, and JWT expiry, refresh rotation, reuse interval and a minimum password length of 10, all matching `config.toml`. The access token hook is enabled with the URI `pg-functions://postgres/public/custom_access_token_hook`. PostgREST's schemas, extra search path and max rows match `[api]`. A test pins these values to `supabase/config.toml`, which stays the single source of truth. Order rule: the migration that creates the hook (`0003`) is pushed before GoTrue starts or restarts with the hook enabled.
- **Exposure.** No service publishes on `0.0.0.0` or `[::]`. Postgres and Studio bind to `127.0.0.1` and are reached through `tailscale serve`. Kong has no Studio route. Kong is the only public route into a stack, at `api.<domain>`.
- **Migrations.** Applied with `supabase db push --db-url` and checked with `migration list --db-url` plus `check-migrations.mjs`, over the tailnet. CI joins the tailnet as an ephemeral `tag:ci` node. Migrations are never applied through a public Postgres port or by a container inside the stack. Migrations stay forward-only.
- **Functions (AD-14 as amended).** The `shift-functions` image is a pinned `edge-runtime` base with the router, every function and dependencies cached at build time, so a cold start fetches nothing.
  - The router (`deploy/functions/main`) is platform plumbing, not a counted Edge Function. It serves only the functions named in `config.toml`'s `[functions.*]` tables and returns 404 for any other name. When a function has `verify_jwt = true`, the router forwards only if GoTrue's `GET /auth/v1/user` accepts the bearer token. It holds no key or JWT secret, reads no table and contains no rule (AD-16). Adding a rule to it is a defect.
  - `SUPABASE_URL` inside the runtime is the internal Kong URL.
  - Cron-invoked functions are reached on the stack's internal network: Vault's `notify_url` is `http://supabase-kong:8000/functions/v1/notify`, never the public origin. Later, `remind` follows the same rule.
  - Kong and Traefik access logs must redact the path after `/functions/v1/calendar-feed/` (NFR-27; prepares story 16.4).
- **SPA (AD-14).** `deploy/web/Dockerfile` builds a pinned, non-root static server image (`shift-web`) from CI's `apps/web/dist`. It provides the SPA fallback (200 `index.html`), serves headers equal to `_headers`, sets `no-cache` on `index.html` and `sw.js`, makes `/assets/*` immutable for one year, sets HSTS, and ships no `*.map` file. The CSP is derived at build time from `VITE_SUPABASE_URL`. It ships as Report-Only in 20.3 and becomes enforcing in 20.5. Traefik terminates TLS with Let's Encrypt. Coolify never builds from Git.
- **Secrets (AD-17 as amended).**
  - The secret key (`SHIFT_SECRET_KEY`), Resend key, invoke secret and VAPID private key live only in the stack's `edge-runtime` environment in Coolify. The invoke secret is also kept in Vault.
  - GitHub Environments hold only deploy credentials (a deploy-scoped Coolify token and the Tailscale OAuth client) plus `SUPABASE_DB_PASSWORD`. Public values (publishable key, VAPID public key, API origin) are Environment variables.
  - The JWT signing secret is fresh per stack, is never the `.env.example` demo value and is never shared between staging and production. Only GoTrue, PostgREST and Storage hold it. The functions container, GitHub and the SPA never do.
  - Key form: if the stack accepts opaque `sb_publishable_`/`sb_secret_` keys (probed in 20.1), keep them. Otherwise use the `anon`/`service_role` JWTs, and have every shape guard decode the role claim. The SPA accepts only `anon`. The local CLI stack keeps its `sb_` keys either way.
- **Deploy pipeline.** The rewritten `.github/actions/deploy` runs these steps in order:
  1. `require-config.mjs` checks the new configuration set.
  2. The runner joins the tailnet.
  3. A pre-push backup runs (production).
  4. `db push` and the migration check run.
  5. `shift-functions:<sha>` is pushed and deployed, then the `notify` probe runs.
  6. The web build runs, followed by the bundle check (no `sb_secret_`, no non-`anon` JWT, no `re_`, no VAPID private key) and source-map removal.
  7. `shift-web` is pushed and deployed through the Coolify API.
  8. The step outputs the values the smoke tests need.

  GoTrue's environment is not pushed by CI. The pipeline uses no `supabase link`, `config push`, `secrets set`, `functions deploy` or `wrangler`. The job graph, `DEPLOY_ENABLED` gate, production approval, smoke jobs and `ci-passed` keep their behaviour. To roll back, redeploy the previous image tag.
- **Backups.** Postgres is dumped daily at 02:30 Europe/Zagreb, with 7 copies kept locally and 30 off-host (default target: Backblaze B2 EU). Use Coolify's scheduled backup, or a pinned `pg_dump` sidecar if 20.5 finds the scheduled backup unsupported. `restic` copies the storage volume and Coolify's data nightly. Until H-11 is decided, a founder device pulls the backups nightly over the tailnet, so the host holds no credential for the copy. After a restore, re-create the Vault secrets from the Coolify environment. Restore drills run in a throwaway stack, never in staging. Keep the Coolify `APP_KEY` copied offline.
- **Monitoring.** External checks (default: UptimeRobot free) cover the app root, `auth/v1/health`, and `notify` answering `401 INVOKE_SECRET_REFUSED`. Coolify notifications report failed backups and deploys, stopped containers and disk use above 80 %.
- **Host (20.4).**
  - `DOCKER-USER` rules for IPv4 and IPv6 on `eth0`: allow established connections, 80, 443/tcp and 443/udp, and drop all other new connections. Keep the existing drop rule for the dev stack.
  - `INPUT` admits sshd only from `tailscale0` and from Coolify's Docker bridge, because Coolify reaches its own host over SSH.
  - A systemd unit re-applies the rules after Docker starts.
  - The sshd drop-in sets key-only login with `prohibit-password` and is ordered before any cloud-init drop-in.
  - Add a 4 GiB swapfile with `vm.swappiness=10` and turn Coolify auto-update off.
  - The scripts are idempotent and are applied from the provider console with a timed auto-revert.
  - The rules must be re-inspected on the host before anything is changed.
- **Topology (H-1).** Staging and production are two isolated Coolify projects (`shift-staging`, `shift-production`) on one host. Each has its own network, volumes, secrets, Vault, domains and GitHub Environment. Staging never holds production data.

## Cross-Story Dependencies

- 20.2 depends on 20.1 for the local stack and for the settled key form. 20.3 and 20.4's scripts are independent.
- 20.5 needs 20.1–20.4, plus staging DNS, H-1/H-6/H-8, the Tailscale ACL and a GHCR read token. 20.6 needs 20.2, 20.3 and 20.5, plus the Coolify token and the Tailscale OAuth client. 20.7's interim backups need 20.5, and its off-host copy needs H-11/H-12. 20.8 needs 20.5 and H-13. 20.9 needs everything, plus a passed restore drill and the founder's go.
- 20.5 records whether Coolify can back up a database inside a service, which decides 20.7's mechanism. 20.5 also turns the CSP from 20.3 to enforcing and closes the CSP and HSTS entries in `deferred-work.md`.
- Other epics:
  - 16.2's Deno parity suite runs on 20.2's pinned `edge-runtime` image and router.
  - 16.4 (`calendar-feed`, `verify_jwt = false`) relies on 20.2's router table and log redaction.
  - 17.2 (`remind`) uses an internal Vault URL like `notify`.
  - Epic 19 configures GoTrue SMTP (Resend) and the signup settings in the production stack's environment, and adds Traefik rate limits on the auth endpoints.
  - 16.1 and Epic 18 need no hosting and can run in parallel.
