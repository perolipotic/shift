# E2E smoke suite

Playwright, Chromium only, against the real local Supabase stack (GoTrue, the
access token hook, PostgREST and the admin-auth Edge Function) and Vite on
`http://127.0.0.1:5173`.

## Run it

```bash
pnpm exec supabase start          # once; the stack is shared by every worktree
pnpm exec playwright install chromium   # once per Playwright version
pnpm test:e2e                     # or: pnpm test:e2e:ui
```

Prerequisites:

- **Node 24** (`.nvmrc`). `playwright.config.ts` runs `e2e/support/require-stack.ts`
  with Node's own type stripping.
- **The local stack is running.** Without it the run stops before any test, with
  a message naming `supabase start`.
- `apps/web/.env.local` and `supabase/functions/.env` exist (see `DEPLOY.md` §1).
  A new worktree needs a copy of both.

Vite and `supabase functions serve` are started for you, and an already served
function is reused. Before any test, globalSetup checks the database, GoTrue and
that admin-auth answers CORS for `http://127.0.0.1:5173`, and stops with a message
naming `supabase start` or `supabase functions serve` if one is missing.

> **An existing dev server on 127.0.0.1:5173 is reused — whichever checkout
> started it.** If the main checkout (or another worktree) is serving that port,
> the suite tests THAT checkout's frontend, not the branch you are on, and still
> passes or fails as if it were yours. When testing a branch, stop the other dev
> server first (or run `pnpm test:e2e` from the checkout that owns it). The port
> cannot simply be changed: the Edge Function's CORS admits only that origin.

## Isolation

Every run provisions its own organization, `e2e-<runId>`, with the operator
script (`supabase/operator/provision-organization.sql`), adds two members, a team
and two hour bands, and deletes the organization and its auth users when the run
ends (`e2e/support/fixture.ts`). Tests write only inside that organization; the
seeded `dvd-kastel-novi` and `zastita-split` are never touched, and nothing runs
`db reset`.

A run that crashed leaves its organization behind. The next run deletes any
`e2e-%` organization older than one hour; a younger one may be a concurrent run
in another worktree, so it is kept.

> **A single live run longer than one hour can be swept from under you.** The
> sweep cannot tell a crashed run from a slow one, so a UI-mode session
> (`pnpm test:e2e:ui`) kept open past an hour loses its organization as soon as
> any other worktree starts a run. Restart the UI session to get a fresh one.

Stored sessions and the run's fixture facts live in `e2e/.auth/` (gitignored) and
are deleted at the end of the run.

## Do not run it concurrently with `pnpm test`

`test/rls-isolation.test.ts` counts every organization before and after one of
its cases. An E2E run provisioning or deleting its organization in between makes
that count differ and the case fail. Run the two one after the other.

## Writing a spec

- Locators by role, label or text only, with names from
  `apps/web/src/i18n/locales/hr.json` (`e2e/support/i18n.ts`). No CSS or id
  selectors, no `waitForTimeout`; web-first assertions.
- A test that writes creates its own rows, unique per ATTEMPT (a retry or a
  `--repeat-each` copy runs against the same organization). The fixture is
  read-only; take it from the `fixture` fixture of `e2e/support/test.ts`, never
  at module level, so `playwright test --list` works without a run.
- Authenticated specs use the stored `ADMIN_STATE` / `MEMBER_STATE`. Never sign
  out with those accounts: a sign-out revokes every session of the account.
