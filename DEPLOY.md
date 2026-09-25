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

> **The access token hook needs a restart, not a reset.** `config.toml`'s
> `[auth.hook.custom_access_token]` becomes a `GOTRUE_HOOK_*` environment
> variable on the auth container, and an edit to that file does not reach a
> container that is already running — `supabase db reset` will not do it either,
> because it restarts containers without recreating them from the config. After
> any change to that section, run a full stop and start:
>
> ```bash
> pnpm exec supabase stop && pnpm exec supabase start
> docker inspect supabase_auth_shift \
>   --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i hook
> # -> GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true
> # -> GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/public/custom_access_token_hook
> ```
>
> With no hook, tokens carry no `organization_id` and every policy reads zero
> rows — which looks exactly like a broken policy and is not one.
> `test/rls-isolation.test.ts` names this in its failure message for that
> reason.

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

`createUser` and `updateUserById` are implemented (story 1.5b). Both authorize
against the database before they act — the caller must be an active admin of the
target member's own organization, read through `current_member_access()` as the
caller — and both use the secret key ONLY for the `auth.admin.*` call, with every
`members` write going through the caller's own JWT so row level security and
attribution still apply.

There is no `ban` or `unban` (story 1.6, human decision 2026-09-23).
Deactivation is an RLS-governed PostgREST insert into `member_status_versions`
(`0008_member_status.sql`), not a function call — and cancelling a change
that is not yet in effect is an RLS-governed delete of that row. `current_member_access()`
reads the version covering today in the organization's zone, so a deactivated
member reads nothing on their next statement, and `custom_access_token_hook`
refuses them a token with a 403, so sign-in and refresh both fail with the
ordinary credentials message. Nothing is written to GoTrue: a token minted
before the date keeps authenticating to GoTrue's own endpoints until it
expires, and reads no organization data.
An existing `auth.users.banned_until` is still honoured — `current_member_access()`
ANDs it with the version covering today — but nothing in the product sets it any
more.

The first organization does not go through this function at all — see §7.

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
| project URL | derived from the `staging` Environment's `SUPABASE_PROJECT_REF` into the build's `VITE_SUPABASE_URL` **and** function env (auto) | same, `production` Environment |
| `sb_publishable_*` | `staging` Environment variable `SUPABASE_PUBLISHABLE_KEY` → the build's `VITE_SUPABASE_PUBLISHABLE_KEY` + function secret `SHIFT_PUBLISHABLE_KEY` | same, `production` Environment |
| `sb_secret_*` | `staging` Environment secret `SUPABASE_SECRET_KEY` → function secret `SHIFT_SECRET_KEY` **only** | same, `production` Environment |

The pipeline (§8) sets the function secrets itself on every deploy, from those
GitHub Environment values, through a temporary env file exactly like the one
below. The manual commands in this section are the fallback.

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

One Pages project, **with no Git connection**. The pipeline publishes to it by
Direct Upload (`wrangler pages deploy`, §8), after every gate has passed and —
for production — after a human has approved. A Git-connected project would
build and publish `main` on its own, before any of that, so the Git integration
is not used at all.

Create it once, from a machine logged in to Cloudflare (`pnpm exec wrangler
login`), or in the dashboard via *Workers & Pages → Create → Pages → Upload
assets* (**not** *Connect to Git*):

```bash
pnpm exec wrangler pages project create <project> --production-branch main
```

| Setting | Value |
| --- | --- |
| Production branch | `main` — the pipeline's production deploy uses `--branch main` |
| Preview branch alias | `staging` — the staging deploy uses `--branch staging`, served at `https://staging.<project>.pages.dev` |
| Build settings | none: Cloudflare never builds this project, the pipeline uploads `apps/web/dist` |

**If the project already exists connected to Git**, a Git-connected project
cannot switch to Direct Upload. Create a new project as above (a new
`<project>.pages.dev` hostname), move any custom domain to it, and delete the
old one — or, at the very least, turn off *Settings → Builds & deployments →
Automatic deployments* for both production and preview so nothing publishes
without the pipeline.

There are **no Pages environment variables** to set. `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` are build-time values, and the build now runs in
the pipeline's deploy job, which reads them from that GitHub Environment (§8):

| Variable | Where it comes from |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<SUPABASE_PROJECT_REF>.supabase.co`, from the environment's `SUPABASE_PROJECT_REF` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the environment's `SUPABASE_PUBLISHABLE_KEY` variable (`sb_publishable_*`) |

Vite inlines `VITE_*` variables into the bundle at build time, which is why the
secret key can never appear here.

Both values are checked at runtime, and a bad one throws the stable code
`SUPABASE_ENVIRONMENT_MISSING` rather than degrading quietly. Five things count
as bad: either variable absent, either one whitespace-only, a `VITE_SUPABASE_URL`
that is not an `http(s)` URL — a bare project ref is the usual way to get this
wrong — and a `VITE_SUPABASE_PUBLISHABLE_KEY` that does not begin
`sb_publishable_`. That last one is a security check as much as a correctness
one: a secret key pasted into this variable would be inlined into every chunk
served to every browser.

**The symptom, if you get one wrong.** The client is built on first use, not at
boot, so the throw is caught by whichever screen needed it first. A visitor sees
either the sign-in form saying *"Prijava trenutačno nije moguća. Pokušaj
ponovno."* on every attempt, or a redirect to that form when they expected to
already be signed in. Both look exactly like a Supabase outage. The way to tell
them apart is the browser console, which carries the stable code and the cause;
if you are debugging what looks like an outage and the console names
`SUPABASE_ENVIRONMENT_MISSING`, the project is misconfigured and Supabase is
fine. Fix it by correcting the GitHub Environment variable (§8) and **redeploying** —
these are build-time values, so changing the GitHub Environment variable does
nothing until the next deploy (re-run the deploy job, or push to `main`).

The deploy job builds with `pnpm --filter "@shift/web..." build`. The `...` in
`--filter @shift/web...` is pnpm's dependency ellipsis: it builds
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

Migrations are **hand-numbered**. Do not run `supabase migration new`: it emits
a timestamp-prefixed filename (`20260904131500_name.sql`), and
`test/supabase-scaffold.test.ts` requires `<0000>_<snake_case>.sql`, contiguous
from `0001`, so that lexicographic order — which is the order the CLI applies
migrations in — matches numeric order. Create the file yourself with the next
number.

```bash
# 1. Write the migration. Number it above the highest existing file.
$EDITOR supabase/migrations/0003_<name>.sql

# 2. Prove it applies from nothing, not just from your current state.
pnpm exec supabase db reset

# 3. Prove the workspace is still green.
pnpm build && pnpm lint && pnpm typecheck && pnpm test

# 4. Commit the migration together with the code that needs it.
git add supabase/migrations/0003_<name>.sql && git commit
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
| `[auth.email] enable_signup` | `true` | **not** the signup door — see below |
| `[auth] enable_anonymous_sign_ins` | `false` | an anonymous session has no organization |
| `[auth] site_url` | that environment's Pages URL | where a recovery link returns to |
| `[auth] additional_redirect_urls` | that environment's Pages URL(s) | an unlisted redirect is refused |
| `[auth.hook.custom_access_token]` | `enabled = true` + the `pg-functions://` URI | without it no token carries `organization_id` and every policy reads zero rows — see §5.2b |

<a id="the-two-enable-signup-keys"></a>

> **The two `enable_signup` keys are not two halves of the same switch**, and
> the names mislead. `[auth] enable_signup` becomes `GOTRUE_DISABLE_SIGNUP` and
> is the only one that refuses self-registration. `[auth.email] enable_signup`
> becomes `GOTRUE_EXTERNAL_EMAIL_ENABLED` and turns the **email/password
> provider** on or off in its entirety, sign-in included. Set it to `false` and
> every admin-issued credential stops working — a password grant answers
> `422 "Email logins are disabled"` — while open signup is no more refused than
> it already was. It is `true` on purpose, and `test/supabase-scaffold.test.ts`
> pins both values.

#### 5.2b The access token hook: order matters, in one direction only

`[auth.hook.custom_access_token]` names
`pg-functions://postgres/public/custom_access_token_hook`, and that function is
created by `supabase/migrations/0003_access_control.sql`. So the two commands in
§5.2 are not interchangeable:

```bash
pnpm exec supabase db push      # FIRST — creates the hook function
pnpm exec supabase config push  # THEN  — tells GoTrue to call it
```

Backwards, GoTrue is told to call a function that does not exist and **every
sign-in fails** for the window between the two commands. In the documented
order the worst case is harmless: between the push and the config push, tokens
are minted with no `organization_id` claim, and a token with no claim reads zero
rows rather than another tenant's — the policies fail closed on the claim's
absence by design.

**If you already pushed backwards**, sign-in is down until one of these lands,
and either is a single command:

```bash
# Preferred — finish what was started. The function is what the hook wants.
pnpm exec supabase db push

# Or back the hook out first, then push the migration and re-enable it.
$EDITOR supabase/config.toml     # [auth.hook.custom_access_token] enabled = false
pnpm exec supabase config push   # sign-in recovers immediately, without the claim
pnpm exec supabase db push       # then the function the hook wants
$EDITOR supabase/config.toml     # enabled = true again
pnpm exec supabase config push   # and the claim comes back at the next sign-in
```

With the hook off, sign-in works and every token is claimless — so sessions
read zero rows until you re-enable it. That is a degraded read, not an outage,
and it is the state to be in while the migration is fixed.

Three consequences worth knowing before the first promotion:

- **A claim-carrying token is only issued at the next sign-in.** The hook runs
  when a token is minted, not retroactively. Sessions held across the promotion
  keep their claimless tokens until they expire (`jwt_expiry = 3600`) or refresh,
  and until then those sessions read nothing. There is no backfill to write —
  nothing is stored on the account — but expect existing sessions to look
  logged-in and empty for up to an hour.
- **Remotely, `config push` is the only thing that enables it.** Nothing in a
  migration carries auth configuration (§5.2a), so an environment that has
  never had `config push` run against it has the function and no hook.
- **Verify the outcome, per environment**, by decoding a real token rather than
  trusting the command's exit code.

Read the password rather than typing it into the command. A `-d` argument lands
in shell history and in `ps` output for every other user on the machine — the
same leak §3 refuses to accept for the secret key, and this is a live member
credential against a real project. `jq --arg` is the same leak wearing a
different hat: an argument is an argument, and `ps` shows it. Pass both values
through the environment instead, which `jq` reads as `$ENV`, and unset them
after:

```bash
read -rsp 'password: ' SHIFT_PROBE_PASSWORD; echo
read -rp 'sign-in address: ' SHIFT_PROBE_ADDRESS

export SHIFT_PROBE_ADDRESS SHIFT_PROBE_PASSWORD

jq -n '{email: $ENV.SHIFT_PROBE_ADDRESS, password: $ENV.SHIFT_PROBE_PASSWORD}' \
  | curl -s -X POST 'https://<ref>.supabase.co/auth/v1/token?grant_type=password' \
      -H 'apikey: <that environment sb_publishable_*>' \
      -H 'content-type: application/json' \
      --data @- \
  | jq -r '.access_token | split(".")[1] | @base64d | fromjson'

unset SHIFT_PROBE_PASSWORD SHIFT_PROBE_ADDRESS
# -> "organization_id": "<that member organization>"   the hook runs  ✅
# -> "role": "authenticated"                           always, and never a domain role
# -> no organization_id at all                          config push has not run ❌
```

`jq`'s `@base64d` is what decodes the payload, not `base64 -d`: a JWT segment is
**unpadded base64url**, which GNU `base64` rejects outright and macOS spells
`-D` anyway — so the obvious pipeline fails, and a `2>/dev/null` on it hides the
failure and prints nothing at all.

`site_url` and `additional_redirect_urls` differ per environment while
`config.toml` holds the local values, so **set them for the target environment
before pushing** — either edit them for the push, or set them in the dashboard
and confirm `config push` does not revert them. Whichever you choose, §6
verifies the outcome rather than the intent.

> A `config push` failure is not cosmetic. Until it succeeds, that environment
> accepts self-service signups. Treat it as a blocking step, not a follow-up.

#### 5.2c The SPA and the schema: order matters, in one direction only

The same shape as §5.2b, one layer up, and it became an application-wide risk in
story 1.4c. `apps/web/src/organization/snapshot.ts` names every column it reads
in one constant, and the navigation chrome reads that row on **every signed-in
screen** to draw the organization's lockup and its accent. So a build that
selects a column the database does not have yet does not degrade — PostgREST
answers `42703 column organizations.brand_accent does not exist`, the whole read
fails, and the shell falls back everywhere at once.

```bash
pnpm exec supabase db push      # FIRST — adds the column
# THEN deploy the SPA that selects it
```

Backwards, the window between the two is an application in which no signed-in
screen can read its own organization. In the documented order the window is
harmless in the way this system's windows are meant to be: the column exists and
the old build simply does not ask for it.

This is not specific to `brand_accent`. It is true of **every column added to
`ORGANIZATION_COLUMNS`**, and it is worse than the same mistake looked in story
1.4b, where `logo_path` was read by `/organizacija` alone: one screen degrading
is a screen somebody can avoid, and the chrome is on all of them. Pages
deployments and `db push` are separate commands with no ordering between them,
so the ordering is this runbook's to state — and the pipeline's deploy job
(§8) runs them in this order for every environment.

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

With the pipeline enabled (§8), merging to `main` is what promotes: staging is
deployed and smoked, then production waits for an approval, and each deploy
pushes migrations **before** it publishes the SPA. Without it, nothing publishes
on its own — the Pages project has no Git connection (§4) — so a manual
promotion ends with a manual upload, built with that environment's values:

```bash
VITE_SUPABASE_URL=https://<production-ref>.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=<production sb_publishable_*> \
  pnpm --filter "@shift/web..." build
pnpm exec wrangler pages deploy apps/web/dist --project-name <project> --branch main
# staging: the staging values, and --branch staging
```

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

# `resetPassword` WITH NO PAYLOAD, and NOT `createUser`: every operation is
# implemented, so the smoke test must be one the function refuses before it
# acts. A reset with no `memberId` is refused by its own validation, before
# either client is used.
curl -s -X POST https://<ref>.supabase.co/functions/v1/admin-auth \
  -H 'Authorization: Bearer <a real user JWT>' \
  -H 'content-type: application/json' \
  -d '{"operation":"resetPassword"}'
# -> 400 {"code":"PAYLOAD_INVALID"}
```

If the function returns `500 {"code":"SECRET_KEY_MISSING"}` or
`500 {"code":"SECRET_KEY_INVALID"}`, its secrets are not set for that project.
It never falls back to the publishable key. `500 {"code":"PROJECT_URL_INVALID"}`
means `SUPABASE_URL` is not a parseable http(s) URL.

### When a member write half-happened

`admin-auth` performs two writes per operation against two services, and nothing
spans them (§ `supabase/functions/admin-auth/operations.ts`). Each pair carries a
compensating action, and each carries a distinct code for the case where the
COMPENSATION itself failed. Those two codes are the only states in this system a
person at a screen cannot resolve, so they are operator work. Both are logged by
the function with the identifier you need; the reply carries the code alone.

**`ACCOUNT_NOT_REMOVED`** — an `auth.users` row was created, its `members` row was
refused, and deleting the account failed too. The account can sign in, carries no
`organization_id` claim, and therefore reads nothing anywhere. It also holds the
synthesized address, so re-issuing that username answers `USERNAME_TAKEN` for
ever until it is removed.

```bash
# The function logged `ACCOUNT_NOT_REMOVED <auth user id>`.
# Confirm it really has no member row before removing anything.
select u.id, u.email, m.id as member
  from auth.users u left join members m on m.auth_user_id = u.id
 where u.id = '<auth user id>';
-- member IS NULL -> safe to delete; the row is an orphan by definition.
delete from auth.users where id = '<auth user id>';
```

**`USERNAME_NOT_RESTORED`** — `members.username` was moved, the address would not
follow, and putting the row back failed. The two stores now disagree: the member
signs in at the OLD address and the list shows the NEW username. Nothing in
PostgreSQL can hold the two together (`0007`), so the reconciliation is manual —
and the address is the authority, because it is what authenticates.

```bash
# The function logged `USERNAME_NOT_RESTORED <member id>`.
select m.id, m.username, split_part(u.email, '@', 1) as signs_in_as
  from members m join auth.users u on u.id = m.auth_user_id
 where m.id = '<member id>';
-- Put the row back to what the account actually answers to:
update members m
   set username = lower(split_part(u.email, '@', 1))
  from auth.users u
 where u.id = m.auth_user_id and m.id = '<member id>';
```

Then ask the admin to try the rename again. If it keeps failing, the cause is in
the function's log line above the code.

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

---

## 7. Provisioning an organization

An organization is created by an operator, by hand, once per tenant. **No
product surface creates one** (FR-2) and none ever will, so this section is the
only way a tenant comes into existence.

### 7.1 What the operator holds, and what they do not

| Credential | Needed here | Why |
| --- | --- | --- |
| The database password (the same one `supabase db push` uses) | **yes** | the script connects as `postgres` and writes rows |
| The secret key (`sb_secret_*`) | **no** | AD-17 confines it to the `admin-auth` function's environment |
| The publishable key | **no** | nothing in this path goes through PostgREST |

`supabase/operator/provision-organization.sql` is SQL rather than a Node CLI for
exactly that reason. A script calling the Admin API to create the first user
would put the secret key into an operator's shell, which amends AD-17 rather
than obeying it. Writing `auth.users` directly needs no key at all, and it makes
"one transaction" literally true across the auth rows and the domain rows: an
organization and its first admin are created together or not at all.

### 7.2 Run it

Every value arrives as a session setting, so nothing is interpolated into SQL
text and a name with an apostrophe in it is data rather than syntax. `PGOPTIONS`
is how libpq carries them: `-c <name>=<value>` per setting, with any space in a
value escaped as `\ `.

```bash
PGOPTIONS="\
-c shift.organization_slug=vatrogasci-primjer \
-c shift.organization_name=Vatrogasci\ Primjer \
-c shift.organization_type=Fire\ Department \
-c shift.organization_timezone=Europe/Zagreb \
-c shift.organization_locale=hr \
-c shift.leave_year_start_month=1 \
-c shift.leave_year_start_day=1 \
-c shift.admin_name=Ime\ Prezime \
-c shift.admin_username=ime.prezime \
-c shift.admin_password=<a long generated password> \
-c shift.admin_leave_allowance_days=20" \
  pnpm db:provision
```

`pnpm db:provision` is
`supabase db query --local -f supabase/operator/provision-organization.sql`.
For a remote project, run the same file with `--linked` (after
`supabase link`) instead of `--local`.

| Setting | Required | Notes |
| --- | --- | --- |
| `shift.organization_slug` | yes | lowercase letters, digits and single hyphens; the sign-in addresses are built from it, so it cannot change later |
| `shift.organization_name` | yes | |
| `shift.organization_short_name` | no | |
| `shift.organization_description` | no | |
| `shift.organization_address` | no | |
| `shift.organization_contact_email` | no | the organization's own address, not a member's |
| `shift.organization_type` | yes | a descriptive label; inert, and it never affects scheduling |
| `shift.organization_timezone` | yes | IANA name — every date and time renders in it |
| `shift.organization_locale` | yes | BCP 47 tag |
| `shift.leave_year_start_month` | yes | 1–12 |
| `shift.leave_year_start_day` | yes | 1–28 |
| `shift.admin_name` | yes | |
| `shift.admin_username` | yes | lowercase; becomes the local part of the sign-in address |
| `shift.admin_password` | yes | |
| `shift.admin_email` | no | a real address if the admin has one; sign-in never uses it |
| `shift.admin_leave_allowance_days` | yes | |

The admin signs in with the **synthesized address**, not the username on its
own: `<shift.admin_username>@<shift.organization_slug>.shift.invalid`. The
script prints it as a `NOTICE` when it succeeds. `.invalid` is reserved by
RFC 2606 and resolves nowhere, which is what makes an account usable by someone
with no email address (AD-12).

### 7.3 Refusals

| What you did | What comes back |
| --- | --- |
| Supplied organization attributes and no admin | `ORGANIZATION_WITHOUT_ADMIN`, and the organization row is rolled back with it |
| Omitted a required organization attribute | a Postgres `23502` / `23514` — the schema refuses it, there is no separate validation |
| Reused a slug or a username within a slug | a unique violation, `23505` |

Later, once the organization exists, the database refuses any path that would
leave it with zero admins — deleting the last admin, or downgrading their role
— with `ORGANIZATION_WOULD_HAVE_NO_ADMIN`. That check is deferred to commit, so
swapping one admin for another inside a single transaction stays legal.

### 7.4 Verify

```bash
# Exactly one admin, and the whole schema still carries exactly one
# constraint trigger. `tgisinternal` matters: every foreign key is implemented
# as a trigger with a constraint too, so counting without it can never be 1.
pnpm exec supabase db query --local "
  select (select count(*) from members where role = 'admin') as admins,
         (select count(*) from pg_constraint
           where contype = 't' and connamespace = 'public'::regnamespace) as constraint_triggers"

# The admin authenticates. Use the local publishable key from `supabase status`.
curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
  -H "apikey: $(pnpm exec supabase status -o json | jq -r .PUBLISHABLE_KEY)" \
  -H 'content-type: application/json' \
  -d '{"email":"ime.prezime@vatrogasci-primjer.shift.invalid","password":"<the password>"}'
# -> an access_token   ✅
# -> 400 invalid_grant for a username that was never issued   ✅
# -> 422 "Email logins are disabled"   ❌ [auth.email] enable_signup is false
#    (see the blockquote in §5.2a — that key is the provider, not the signup door)
```

Reading `organizations` or `members` through PostgREST with the publishable key
and no session returns `[]`, not an error: row level security is on and every
policy is `to authenticated`, so an anonymous caller matches none of them. That
stays true forever — there is no anonymous read path in this system — and
`test/provisioning.test.ts` and `test/rls-isolation.test.ts` both assert it.

With a session it returns that organization's rows and no other:

```bash
# The token from the grant above, against the real HTTP path the SPA uses.
curl -s 'http://127.0.0.1:54321/rest/v1/members?select=name,role' \
  -H "apikey: $(pnpm exec supabase status -o json | jq -r .PUBLISHABLE_KEY)" \
  -H "Authorization: Bearer <the access_token>"
# -> that organization's members only  ✅
# -> []  the token carries no organization_id claim — see §5.2b   ❌
```

A member-role token reads the same list and changes nothing on it: a `PATCH`
answers `204` having affected zero rows, and a `POST` answers
`403 {"code":"42501"}`. Both are asserted in `test/rls-isolation.test.ts`
against both fixtures.

---

## 8. CI/CD

One GitHub Actions workflow, `.github/workflows/pipeline.yml`, runs on every
pull request to `main` and every push to `main`.

| Job | Runs on | What it does |
| --- | --- | --- |
| `quality` | PR + `main` | Gitleaks over the **full** history (`.gitleaks.toml`), then `pnpm lint` |
| `build` | PR + `main` | `pnpm typecheck`, `pnpm build`, uploads `apps/web/dist` as the `web-dist` artifact (built with no environment's values, so it proves the build and is never deployed) |
| `test` | PR + `main` | `supabase start` (the full stack), `pnpm build`, `pnpm test`; **fails if the root Vitest run skipped anything** (§8.5) |
| `e2e` | PR + `main` | `supabase start -x edge-runtime`, the two local env files from `supabase status` (`scripts/ci/write-local-env.mjs`), `supabase functions serve admin-auth` and Vite on `127.0.0.1:5173`, then `pnpm test:e2e`, then `pnpm test:smoke` against those same local servers (anonymous checks plus sign-in as the seeded `dvd-kastel-novi` / `ana.kovac`), so the smoke specs run on every PR. Reports are uploaded on failure. A runner of its own, so it never shares a stack with `test` (`e2e/README.md`) |
| `deploy-staging` | `main`, deploys enabled | §5.2 against the `staging` Environment, then Pages `--branch staging` |
| `smoke-staging` | after `deploy-staging` | `pnpm test:smoke` against the staging origin, with the smoke account if configured |
| `deploy-production` | after `smoke-staging`, **after approval** | §5.3 against the `production` Environment, then Pages `--branch main` |
| `smoke-production` | after `deploy-production` | `pnpm test:smoke`, anonymous |
| `notify` | any failed or cancelled job on `main` | an error annotation and a run-summary line naming the failed and cancelled jobs; a Slack post if `SLACK_WEBHOOK_URL` is set |

A failing job stops everything after it: production never starts unless
staging deployed **and** its smoke passed.

**Concurrency.** GitHub keeps at most one *running* and one *pending* run or
job per concurrency group, and when a newer one arrives it silently cancels the
older **pending** one — it does not form a queue. The workflow is built around
that rule:

- Pull requests: one group per PR, and a newer push cancels the run in progress.
- Pushes to `main`: no workflow-level group. Every push runs `quality`,
  `build`, `test` and `e2e` straight away, so CI on `main` is never held back —
  or dropped — behind a run parked at the production approval.
- `deploy-staging` and `deploy-production` each have a job-level group that
  never cancels a deploy in progress. While one runs, a newer run's deploy
  waits; if a third arrives meanwhile, the second's pending deploy is cancelled
  and only the newest is kept — which is the one worth shipping. Two runs can
  therefore interleave: staging can already hold run B while production is
  still waiting for approval of run A. Approve (or reject) the older production
  deploy first, and check which commit a pending approval is for.

### 8.1 What a deploy job does, in order

`.github/actions/deploy/action.yml`, once per environment — §5.2/§5.2b in the
same order, with nothing skipped:

1. check that every required secret and variable is set, has no leading or
   trailing whitespace, and — for the project ref, the publishable key and the
   secret key — has the right shape, naming each one that fails
   (`scripts/ci/require-config.mjs`), then parse `APP_ORIGINS` once into a
   normalized https-only list (`scripts/ci/origins.mjs`); all of this **before**
   any remote command;
2. `supabase link --project-ref …` — the database password reaches the CLI as
   `SUPABASE_DB_PASSWORD` in the environment, never as an argument;
3. `supabase db push` — migrations only, never `--include-seed`;
4. `supabase migration list --output-format json`, failing the job if local and
   remote disagree, or if it recognises no migration at all
   (`scripts/ci/check-migrations.mjs`);
5. rewrite `[auth] site_url` / `additional_redirect_urls` in the **runner's**
   copy of `supabase/config.toml` to the normalized origins
   (`scripts/ci/set-auth-urls.mjs`) — the committed file keeps its local values;
6. `supabase config push` — after `db push`, always (§5.2b; what it sends: §8.6);
7. `supabase secrets set --env-file` from a temporary file written by a heredoc
   and deleted when the step ends (`SHIFT_SECRET_KEY`, `SHIFT_PUBLISHABLE_KEY`,
   `SHIFT_ALLOWED_ORIGINS` = the normalized origins);
8. `supabase functions deploy admin-auth` — every time, which is idempotent;
9. `pnpm --filter "@shift/web..." build` with that environment's `VITE_*`
   values, then a check that neither this environment's secret key nor any
   key-shaped `sb_secret_` value is in `apps/web/dist`;
10. `wrangler pages deploy apps/web/dist --branch staging|main`.

### 8.2 Configure it

Nothing deploys until the repository variable `DEPLOY_ENABLED` is exactly
`true`. Until then, pushes to `main` run `quality`, `build`, `test` and `e2e`
only, stay green, and the run summary lists what is left to configure. Once it
is `true`, a missing or malformed item fails the deploy job by name rather than
being skipped.

**1. Create the hosted projects by hand** — the pipeline never creates, pauses
or un-pauses anything: the two Supabase projects (§2) and the Pages project with
no Git connection (§4).

**2. Create two Environments** under *Settings → Environments*. Both settings
marked required are the gate; do not skip either.

| Environment | Deployment branches (**required**) | Required reviewers |
| --- | --- | --- |
| `staging` | *Selected branches* → `main` only | none |
| `production` | *Selected branches* → `main` only | **required**: at least one person — `deploy-production` waits in the run until someone approves it |

**3. Every deploy credential is an Environment secret, never a repository
secret.** A repository secret is readable by any workflow job on any branch; an
Environment secret only by a job that names that Environment — and with the
branch restriction above, only from `main`, and for production only after
approval. Set these on **each** of `staging` and `production`, with that
environment's values:

| Name | Kind | Value |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | secret | a Supabase access token (`sbp_*`, §0) — see the warning below |
| `SUPABASE_DB_PASSWORD` | secret | that project's database password (§0) |
| `SUPABASE_SECRET_KEY` | secret | that project's `sb_secret_*` — reaches the `admin-auth` function secrets and nothing else |
| `CLOUDFLARE_API_TOKEN` | secret | a Cloudflare API token with *Account → Cloudflare Pages → Edit* |
| `SUPABASE_PROJECT_REF` | variable | the project ref (20 lowercase letters and digits); the project URL is `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | variable | `sb_publishable_*` — public by design, it is inlined into the bundle |
| `APP_ORIGINS` | variable | comma-separated bare **https** origins the app is served from, **primary first**: staging `https://staging.<project>.pages.dev`; production `https://<project>.pages.dev` or the custom domain first, then any other hostname. The first is the auth `site_url`, the Environment URL and the smoke's target; all of them are redirect URLs and `SHIFT_ALLOWED_ORIGINS`. No empty entries, no paths, no trailing slash |
| `CLOUDFLARE_ACCOUNT_ID` | variable | the Cloudflare account id |
| `CLOUDFLARE_PAGES_PROJECT` | variable | the Pages project name (`<project>`) |

> **A Supabase personal access token is account-wide.** It is not scoped to a
> project: the token stored on `staging` can reach the production project too,
> and so can anything that reads it. So the real gate is not which token sits
> where — it is that the token exists only as an Environment secret, that both
> Environments accept `main` only, and that production needs a reviewer. Use a
> **separate token per environment** anyway (from separate Supabase accounts or
> organization members where you can), so one can be revoked without the other
> and a leak is attributable. The Cloudflare token can be narrowed to the one
> account; it still covers every Pages project in it.

Repository-level, only two things, neither a deploy credential:

| Name | Kind | Value |
| --- | --- | --- |
| `DEPLOY_ENABLED` | variable | `true` to turn deploys on; anything else (or unset) keeps them off |
| `SLACK_WEBHOOK_URL` | secret, optional | an incoming-webhook URL for `notify`; unset means no Slack post |

A secret key never goes into a variable, and a publishable key that starts
`sb_secret_` is refused by the pre-deploy check, by the app at runtime (§4) and
by the bundle check before upload.

**4. The smoke account (staging only, optional).** With all three set on the
`staging` Environment, `smoke-staging` also signs in and checks it lands on
`/danas`. With none of them set that one case is skipped and the rest still run;
with only one or two set, the smoke fails as misconfigured.

| Name | Kind | Value |
| --- | --- | --- |
| `SMOKE_ORG` | variable | the smoke organization's slug |
| `SMOKE_USERNAME` | variable | the smoke member's username |
| `SMOKE_PASSWORD` | secret | that member's password |

Provision it by hand with §7 against **staging**, as its own organization (for
example `smoke`), never inside a real tenant. `smoke-production` is anonymous;
production has no smoke account.

**5. Turn it on:** set `DEPLOY_ENABLED` to `true`, then push to `main` (or
re-run the latest `main` run).

### 8.3 The remote smoke

`smoke/` with `playwright.smoke.config.ts` — no web server, no global setup,
nothing provisioned. Against `SMOKE_BASE_URL` it checks that `/` and a deep link
answer 200 with the SPA shell, that `/prijava` renders with no
`SUPABASE_ENVIRONMENT_MISSING` in the console, that signup is refused with
`422 signup_disabled` (§6), that `admin-auth` answers CORS for the deployed
origin, and, with the smoke account configured, that sign-in lands on `/danas`.
It never signs out: a sign-out revokes every session of the account.

**It is not read-only in one case.** The signup probe posts a real signup. On a
correctly configured project it is refused; if signup is open, **the probe has
just created an account** (`smoke-probe-<uuid>@example.invalid`) on that
project. The failure message names the address: delete it under
*Authentication → Users*, re-run `supabase config push` and re-probe (§6). The
probe never retries, so one failed run creates at most one such account.

Run it locally against the dev server; the project URL and publishable key fall
back to `apps/web/.env.local`:

```bash
SMOKE_BASE_URL=http://127.0.0.1:5173 pnpm test:smoke
# with the sign-in case, against the local seed:
SMOKE_BASE_URL=http://127.0.0.1:5173 SMOKE_ORG=dvd-kastel-novi \
  SMOKE_USERNAME=ana.kovac SMOKE_PASSWORD=local-fixture-password pnpm test:smoke
```

### 8.4 When the pipeline is not an option

The manual runbook in §5 stays the fallback — a hotfix while Actions is down, or
a first promotion before the Environments exist. A manual promotion and a
pipeline deploy must never overlap, and nothing but you can stop that:

1. set the repository variable `DEPLOY_ENABLED` to anything but `true` (for
   example `paused`) — runs already past their deploy gate are not stopped, so
   let any in-flight deploy finish, or cancel it, first;
2. run §5.2 then §5.3 by hand, including the `wrangler pages deploy` at the end
   of §5.3, and verify with §6;
3. set `DEPLOY_ENABLED` back to `true`.

### 8.5 What "no test skipped" covers

Only the **root** Vitest run (`vitest run` over `test/**`, the last command of
`pnpm test`) is checked, from its JSON report
(`scripts/ci/assert-no-skipped.mjs`). The `pnpm -r test` package runs before it
are not. In CI every root `skipIf` prerequisite is present — the stack is up
and the app is built — so a skip there means a prerequisite silently went
missing. It also means **an `it.skip`, `it.todo` or `describe.skip` in a root
test now fails CI**: remove the case, or finish it, instead of parking it.

### 8.6 What `config push` sends, and whether that is safe

`supabase config push` sends the sections of `supabase/config.toml` that have a
hosted counterpart, and **overwrites** the hosted values with them. So for every
setting it covers, `config.toml` is the source of truth; anything changed in the
dashboard for those settings is reverted on the next deploy.

| Section | Sent | Hosted effect | Safe? |
| --- | --- | --- | --- |
| `project_id`, every `port` | no | local only | — |
| `[api]` `schemas`, `extra_search_path`, `max_rows` | yes | PostgREST exposes `public` and `graphql_public`, caps a response at 1000 rows | yes — the same values the local suite runs against |
| `[db]` `major_version = 17` | checked, not changed | the CLI compares it with the project's Postgres version | yes, **if the projects run Postgres 17** — create them on 17 (a mismatch is reported, not fixed) |
| `[db.seed]` | no | `db push` without `--include-seed` never applies `seed.sql` | — |
| `[studio]`, `[local_smtp]` | no | local only | — |
| `[auth]` `site_url`, `additional_redirect_urls` | yes | rewritten per environment first (§8.1 step 5) | yes |
| `[auth]` `jwt_expiry`, refresh-token rotation and reuse interval | yes | one-hour tokens, rotated refresh tokens | yes |
| `[auth]` `enable_signup = false`, `enable_anonymous_sign_ins = false` | yes | no self-service or anonymous accounts (§5.2a) | yes — this is the point of the push |
| `[auth.email]` `enable_signup = true`, `enable_confirmations = false`, `double_confirm_changes` | yes | the email/password provider on (sign-in needs it, §5.2a); no confirmation mail, since `.shift.invalid` addresses receive none | yes |
| `[auth.sms]` `enable_signup = false` | yes | no phone signup | yes |
| `[auth.hook.custom_access_token]` | yes | the hook on, calling the function `db push` just created (§5.2b) | yes, in this order only |
| auth sections **absent** from the file (SMTP, rate limits, MFA, external providers, templates) | defaults | the CLI may send its defaults for them, reverting any dashboard change | acceptable today — none is configured in the dashboard. Before configuring one there, put it in `config.toml` instead (Ask First: it changes `config.toml`) |
| `[edge_runtime]` | no | local only | — |
| `[functions.admin-auth]` `verify_jwt = true` | by `functions deploy`, not `config push` | the gateway rejects a call without a JWT before the function runs | yes |

Nothing in the file needs changing for hosted environments. The `config push`
step's log shows the diff it applied; read it on the first deploy to each
environment.

### 8.7 Rolling back

- **The SPA.** Cloudflare keeps every deployment. *Workers & Pages → <project> →
  Deployments*, pick the previous production deployment, *Rollback to this
  deployment* (for staging, the previous `staging` deployment). It is instant
  and changes nothing in Supabase. The next push to `main` deploys again.
- **The function.** Check out the previous commit and run
  `supabase functions deploy admin-auth --project-ref <ref>` (§5.2).
- **Migrations are forward-fix only** (§5.4). There is no down-migration and
  no `db reset` against a hosted project, ever. A bad migration is corrected by
  the next migration, promoted the same way.

Because the database cannot roll back, write schema changes so the SPA can —
**expand, then contract**:

1. **Expand:** a release adds only — a new column (nullable or with a default),
   a new table, a new function. The bundle already live does not ask for it, so
   rolling the SPA back is always safe (§5.2c is the same rule from the other
   side: the column exists before any bundle selects it).
2. **Migrate readers:** a later release switches the SPA to the new shape.
3. **Contract:** only once no live bundle — including the one you might roll
   back to — reads the old column, a further release drops or renames it.

Never drop or rename a column that the live bundle reads in the same release
that stops reading it: the deploy pushes the migration first, so between
`db push` and the upload every signed-in screen that reads it fails (§5.2c), and
rolling the SPA back afterwards lands on a bundle that reads a column that no
longer exists.
