# DEPLOY

Everything needed to take this repository from a clean checkout to a live
staging and production deployment, and to promote a migration through them.

There are exactly three moving parts, because the architecture has no server
tier:

| Part | Where it runs | What it holds |
| --- | --- | --- |
| `apps/web` | Cloudflare Pages, static | the publishable key only |
| `supabase/migrations` | Supabase Postgres | the schema, forward-only |
| `supabase/functions/admin-auth` | Supabase Edge Functions | the secret key |

The secret key exists in exactly one place: the `admin-auth` function's
per-environment secrets. If you ever find `sb_secret_*` in a Pages environment
variable, in a committed file, or in a migration, stop and rotate it — every RLS
policy in the system is decorative until you do.

---

## 0. Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node | `24.19.0` (see `.nvmrc`) | pnpm 11 requires ≥ 22.13 |
| pnpm | `11.25.0` | pinned in `package.json` → `packageManager` |
| Docker Desktop | current | the Supabase CLI runs Postgres locally |
| Supabase CLI | `2.116.0` | installed as a workspace dev dependency |

```bash
nvm use                 # picks up .nvmrc
corepack enable pnpm    # picks up packageManager
pnpm install
```

The Supabase CLI is local to the repo, so invoke it through pnpm:

```bash
pnpm exec supabase --version
```

### Authenticating the CLI

Everything in §1 works offline. Everything that touches a remote project —
`link`, `db push`, `config push`, `secrets set`, `functions deploy` — needs a
Supabase account token first, and two prompts catch people out:

```bash
pnpm exec supabase login          # opens a browser, stores the token
# or, non-interactively (CI, or a machine with no browser):
export SUPABASE_ACCESS_TOKEN=sbp_...
```

`supabase link` then asks for that project's **database password** — the one set
when the project was created, not your account password, and not recoverable
(reset it under *Project Settings → Database* if it is lost). Pass it
non-interactively with `--password`, or let the prompt take it.

Without the token, `link` fails with an authorization error that reads exactly
like the paused-project failure §2 warns about. Log in first and you can tell
the two apart.

---

## 1. Local

```bash
pnpm install
pnpm exec supabase start        # boots Postgres, PostgREST, Auth, Studio
pnpm exec supabase db reset     # applies every migration, then loads seed.sql
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @shift/web dev
```

`supabase start` prints the local API URL and keys. Put the URL and the
**publishable** key into `apps/web/.env.local`. `seed.sql` is local and
test-only: it is never applied to staging or production.

To run the Edge Function locally, copy its env template and fill it in with an
editor. Do not `printf` or `echo` a key into place and do not pass one as a
command-line argument: either way `sb_secret_*` lands in your shell history,
which is a committed-file leak with extra steps.

```bash
cp supabase/functions/.env.example supabase/functions/.env
$EDITOR supabase/functions/.env        # gitignored; paste the local keys here

pnpm exec supabase functions serve admin-auth
```

`supabase functions serve` reads `supabase/functions/.env` by default, so no
flag is needed. `supabase start` printed the local keys; `SUPABASE_URL` is
injected for you.

Every operation currently answers `501 { "code": "NOT_IMPLEMENTED" }` — the
boundary cannot authorize until the `members` table lands in story 1.2.

Gate before you push anything:

```bash
pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test
```

---

## 2. Supabase projects

Create **two** projects on the free plan — that is exactly the two active
projects the free plan allows.

| Environment | Project name | Note |
| --- | --- | --- |
| staging | `shift-staging` | the rehearsal for every promotion |
| production | `shift-production` | the pilot organization |

For each, record from *Project Settings → API keys*:

- the project URL,
- the **publishable** key (`sb_publishable_*`),
- the **secret** key (`sb_secret_*`).

Do not use the legacy `anon` / `service_role` keys. They are deprecated at the
end of 2026 and this system does not read them.

> **Free-plan catch.** A project with no API requests for a week is paused
> automatically. Before any promotion to staging, open the staging project in
> the dashboard and confirm it is active, or the first `db push` will fail in a
> way that looks like a credentials problem.

---

## 3. Where each key goes

| Value | staging | production |
| --- | --- | --- |
| project URL | Pages env `VITE_SUPABASE_URL` (Preview) **and** function env (auto) | Pages env `VITE_SUPABASE_URL` (Production) **and** function env (auto) |
| `sb_publishable_*` | Pages env `VITE_SUPABASE_PUBLISHABLE_KEY` (Preview) + function secret `SHIFT_PUBLISHABLE_KEY` | same, Production scope |
| `sb_secret_*` | function secret `SHIFT_SECRET_KEY` **only** | function secret `SHIFT_SECRET_KEY` **only** |

The function reads its project URL from `SUPABASE_URL`, which the Edge Runtime
injects — you never set it. It needs the publishable key too, because it builds
a second, caller-scoped client from the caller's JWT so that RLS and attribution
still apply to every domain-table write it makes.

Set the function secrets per project **from a file**, never as arguments — a
`NAME=VALUE` argument is recorded in shell history, and rotating a key you have
already leaked to your own history is the one avoidable step here:

```bash
cp supabase/functions/.env.example supabase/functions/.env.staging
$EDITOR supabase/functions/.env.staging       # gitignored

pnpm exec supabase secrets set \
  --env-file supabase/functions/.env.staging \
  --project-ref <staging-ref>
```

Repeat with `supabase/functions/.env.production` and `<production-ref>`. Every
`supabase/functions/.env*` file except `.env.example` is gitignored.

`SHIFT_ALLOWED_ORIGINS` is a comma-separated allowlist of exact origins. An
origin not on it receives no `Access-Control-Allow-*` header at all, so the
browser refuses the response — set it to the exact Pages hostname(s) for that
environment.

---

## 4. Cloudflare Pages

One Pages project, connected to this repository.

*Workers & Pages → Create → Pages → Connect to Git*, then:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None |
| Root directory | `/` (repository root — the pnpm workspace lives there) |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @shift/web... build` |
| Build output directory | `apps/web/dist` |

Build-time environment variables — set them in **both** scopes, Production
pointing at `shift-production` and Preview pointing at `shift-staging`:

| Variable | Value |
| --- | --- |
| `NODE_VERSION` | `24.19.0` |
| `PNPM_VERSION` | `11.25.0` |
| `VITE_SUPABASE_URL` | that environment's project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | that environment's `sb_publishable_*` |

Vite inlines `VITE_*` variables into the bundle at build time, which is why the
secret key can never appear here.

The `...` in `--filter @shift/web...` is pnpm's dependency ellipsis: it builds
`@shift/web` **and everything it depends on**, in topological order. It is a
no-op today and stops being one the moment `apps/web` imports `@shift/domain`,
at which point the plain `--filter @shift/web` would deploy a bundle built
against a stale or missing `packages/domain/dist`. Do not remove it.

Deep links need no configuration beyond what is committed:
`apps/web/public/_redirects` contains `/*  /index.html  200`, so
`GET /some/deep/route` serves `index.html` with HTTP 200 rather than a 404.
There is no server to route it any other way.

---

## 5. Migration promotion runbook

Migrations are forward-only git files. **A file that has been promoted past
local is never edited.** A correction is a new migration with a higher number.

Run these in order. Do not skip staging.

### 5.1 Author locally

```bash
# 1. Write the migration. Number it above the highest existing file.
$EDITOR supabase/migrations/0002_<name>.sql

# 2. Prove it applies from nothing, not just from your current state.
pnpm exec supabase db reset

# 3. Prove the workspace is still green.
pnpm build && pnpm lint && pnpm typecheck && pnpm test

# 4. Commit the migration together with the code that needs it.
git add supabase/migrations/0002_<name>.sql && git commit
```

### 5.2 Promote to staging

```bash
# Confirm you are logged in (§0) and the staging project is not paused (§2):
pnpm exec supabase link --project-ref <staging-ref>
pnpm exec supabase db push                       # applies pending migrations only
pnpm exec supabase migration list                # local vs remote, must agree
pnpm exec supabase config push                   # see 5.2a — auth config is NOT in a migration
pnpm exec supabase functions deploy admin-auth   # only if the function changed
```

#### 5.2a Why `config push` is not optional

`supabase/config.toml` governs the **local** stack only. Nothing in a migration
carries it. So a remote project that has never had `config push` run against it
keeps Supabase's defaults — and Supabase's default is **signup enabled**, which
contradicts the system's own rule that there is no open signup anywhere:
credentials are admin-issued through `admin-auth`, and an account that can sign
itself up has no member row, no organization claim and no business existing.

`config push` is what makes these three true remotely, per environment:

| Setting in `config.toml` | Value | Why |
| --- | --- | --- |
| `[auth] enable_signup` | `false` | no self-registration; an admin issues credentials |
| `[auth.email] enable_signup` | `false` | the same door, via email |
| `[auth] enable_anonymous_sign_ins` | `false` | an anonymous session has no organization |
| `[auth] site_url` | that environment's Pages URL | where a recovery link returns to |
| `[auth] additional_redirect_urls` | that environment's Pages URL(s) | an unlisted redirect is refused |

`site_url` and `additional_redirect_urls` differ per environment while
`config.toml` holds the local values, so **set them for the target environment
before pushing** — either edit them for the push, or set them in the dashboard
and confirm `config push` does not revert them. Whichever you choose, §6
verifies the outcome rather than the intent.

> A `config push` failure is not cosmetic. Until it succeeds, that environment
> accepts self-service signups. Treat it as a blocking step, not a follow-up.

Then verify on staging, against the Preview deployment:

- the migration appears in `supabase migration list` as applied remotely;
- signup is off — the §6 signup probe is refused;
- the Preview URL loads and a deep link returns 200;
- `admin-auth` answers with a JSON `code` rather than a 500 without one.

### 5.3 Promote to production

Only after staging has been verified.

```bash
pnpm exec supabase link --project-ref <production-ref>
pnpm exec supabase db push
pnpm exec supabase migration list
pnpm exec supabase config push                   # 5.2a applies here too
pnpm exec supabase functions deploy admin-auth   # only if the function changed
```

Merging to `main` publishes the Production deployment on Pages. Push migrations
**before** the merge lands whenever the new code depends on the new schema.

### 5.4 If a push fails midway

`supabase db push` applies migrations one at a time and stops at the first
error, recording only what succeeded. Do not edit the failed file if it has
already been promoted anywhere else — write the fix as the next migration,
verify it with `supabase db reset` locally, and push again.

---

## 6. Post-deploy verification

```bash
# Static SPA, no server runtime, no SSR output
ls apps/web/dist                       # index.html, assets/, _redirects

# The bundle carries no secret
grep -rn "sb_secret_" apps/web/dist/ || echo CLEAN

# Exactly one Edge Function exists (AD-14)
ls supabase/functions/                 # -> admin-auth
```

Against the live host:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/                  # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/some/deep/route   # 200

curl -s -X POST https://<ref>.supabase.co/functions/v1/admin-auth \
  -H 'Authorization: Bearer <a real user JWT>' \
  -H 'content-type: application/json' \
  -d '{"operation":"createUser"}'
# -> 501 {"code":"NOT_IMPLEMENTED","operation":"createUser"}
```

If the function returns `500 {"code":"SECRET_KEY_MISSING"}` or
`500 {"code":"SECRET_KEY_INVALID"}`, its secrets are not set for that project.
It never falls back to the publishable key. `500 {"code":"PROJECT_URL_INVALID"}`
means `SUPABASE_URL` is not a parseable http(s) URL.

### Signup is off, remotely

`config push` (§5.2a) is the only thing that turns Supabase's default open
signup off on a remote project, so verify the outcome rather than trusting the
command's exit code. Run this against **each** environment:

```bash
curl -s -X POST 'https://<ref>.supabase.co/auth/v1/signup' \
  -H 'apikey: <that environment's sb_publishable_*>' \
  -H 'content-type: application/json' \
  -d '{"email":"probe@example.invalid","password":"a-long-throwaway-password"}'
# -> {"code":422,"error_code":"signup_disabled",...}   signup is off  ✅
# -> a user object, or a confirmation-sent reply       signup is OPEN ❌
```

An open result means that project accepts self-service accounts. Re-run
`supabase config push` for it, re-probe, and delete any account the probe
created before moving on.

Also confirm, in the dashboard under *Authentication → URL Configuration*, that
Site URL and Redirect URLs name that environment's Pages hostname — a stale
`http://127.0.0.1:5173` there sends every password-recovery link to localhost.
