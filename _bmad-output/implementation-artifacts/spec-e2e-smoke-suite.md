---
title: 'Playwright E2E smoke suite for what already ships'
type: 'chore'
created: '2026-09-25'
status: 'done'
baseline_commit: 'e0b49cedc6b0378d1a1deed20382dc665796eb0a'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Browser-only acceptance criteria (no horizontal scroll at 320 px, 44 px controls, real sign-in through GoTrue and the admin-auth Edge Function) are checked by no test. Story 2.4 (the phone stepper) cannot be verified without a browser. The human decided on 2026-09-25 that this suite ships before story 2.3.

**Approach:** Add a Playwright suite at the repo root, Chromium only, running against the real local Supabase stack and Vite on `http://127.0.0.1:5173`. Every run provisions its own throwaway organization `e2e-<runId>` with the operator script and deletes it afterwards. Tests write only inside that organization, so the shared stack and the seeded fixtures stay untouched.

## Boundaries & Constraints

**Always:**
- Use locators by role, label or text only, with names taken from the imported `apps/web/src/i18n/locales/hr.json`. Use web-first assertions (`expect(locator).toBeVisible()`, `toHaveURL`). Use no `waitForTimeout` and no CSS or id selectors.
- Tests are independent: each works on data it created or on the read-only per-run fixture, and parallel workers must not collide.
- Store auth state from a `setup` project in `e2e/.auth/` (gitignored). Only the sign-in specs go through the full sign-in flow per test.
- E2E users carry `'{}'` app/user metadata, matching the seed recipe (the guard is in `provisioning.test.ts:1395-1408`).
- Pin exact dependency versions, as the repo does.

**Ask First:**
- A responsive or 44 px check fails on an existing screen. Either fix it in this story or record it in `deferred-work.md` with the check marked `test.fixme`.
- Any change under `apps/web/src`, `supabase/migrations` or `supabase/functions`.

**Never:**
- Write to `dvd-kastel-novi` or `zastita-split`, run `db reset`, or add a migration.
- Put `sb_secret_`/`SHIFT_SECRET_KEY` in any file (`key-hygiene.test.ts:208-219`). The DB connection uses the local `postgres` URL only.
- Add render tests, CI, or other browsers (all deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal run | stack up, no dev server | Vite (and `functions serve`) start, the org is provisioned, the suite passes, the org and its `auth.users` are deleted | N/A |
| Dev server already on 127.0.0.1:5173 | an existing server | it is reused (`reuseExistingServer`) | N/A |
| Earlier run crashed | `e2e-%` org older than 1 h | globalSetup deletes it first | orgs younger than 1 h are kept (a concurrent run in another worktree) |
| Supabase down | DB refuses the connection | globalSetup fails fast with a message naming `supabase start` | no tests run |

</frozen-after-approval>

## Code Map

- `supabase/operator/provision-organization.sql` -- one-transaction org + admin creation, parameters as `shift.*` GUCs; the reuse pattern with `pg` + `set_config` is in `test/provisioning.test.ts:1418-1432`, DB URL at `:39-40`
- `supabase/seed.sql:92-145,152-198` -- SQL recipe for extra members (auth.users + auth.identities + members, 4 empty-string token columns), hour bands and shift types
- `test/provisioning.test.ts:370-373,551-581` -- cleanup: `delete from organizations` cascades every domain table; auth users are deleted separately by `%@<slug>.shift.invalid`
- `test/rls-isolation.test.ts:2422-2458` -- a global org count before and after; running E2E concurrently with `pnpm test` can flake it (document this, don't change it)
- `apps/web/src/routes/prijava-organizacija.tsx`, `prijava.tsx` -- sign-in: slug step `/prijava`, then `/prijava/$slug` with username + password, error `role="alert"`, success → `/danas`
- `apps/web/src/navigation/destinations.ts`, `hr.json:118-127,203-206` -- nav labels and roles; "Odjava" signs out
- Admin screens: `/ljudi`, `/ljudi/novi` (createUser via Edge Function, returns a one-time password), `/ljudi/smjene` (teams), `/smjene/$id` (roster, every role), `/organizacija/satni-pojasi`
- `supabase/functions/.env` -- CORS admits only port 5173, so the dev server must stay on that port
- `tsconfig.json`, `eslint.config.js:277-288` -- root tsc includes only listed globs, and Node globals are scoped by glob; the new `e2e/` and `playwright.config.ts` need to be added to both

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `pnpm-lock.yaml` -- add `@playwright/test` (exact) and scripts `test:e2e` / `test:e2e:ui` -- a single entry point
- [x] `playwright.config.ts` -- `testDir: e2e`, `fullyParallel`, `forbidOnly: !!process.env.CI`, `retries` 0 locally, trace `on-first-retry`, `baseURL` 127.0.0.1:5173, projects `setup` → `chromium`, webServer entries for Vite (`--host 127.0.0.1 --port 5173 --strictPort`) and `supabase functions serve`, both with `reuseExistingServer` -- runner config
- [x] `e2e/support/fixture.ts` -- provision `e2e-<runId>` via the operator script, then insert 2 members, hour bands and one team with one member via SQL, and write fixture facts to `e2e/.auth/fixture.json`; also a teardown that deletes the org and its auth users -- isolation
- [x] `e2e/global-setup.ts`, `e2e/global-teardown.ts` -- stale sweep (> 1 h), provision, teardown -- lifecycle
- [x] `e2e/auth.setup.ts` -- sign in as admin and as member through the UI and save the storageStates -- fast authenticated specs
- [x] `e2e/sign-in.spec.ts` -- admin → `/danas`; member → `/danas` without admin destinations; wrong password → alert, stays on the page; Odjava → `/prijava`
- [x] `e2e/people.spec.ts` -- the list shows fixture members; creating a member shows the one-time password, and the new member is in the list
- [x] `e2e/teams.spec.ts` -- create a team, add a member, and the roster at `/smjene/$id` lists them, also as the member role
- [x] `e2e/hour-bands.spec.ts` -- the list shows fixture bands; adding a band shows it in the list
- [x] `e2e/responsive.spec.ts` + `e2e/support/layout.ts` -- at a 320×640 viewport, for sign-in, Danas, Ljudi, new member, teams, roster, hour bands and Organizacija: `scrollWidth <= clientWidth`, and every visible button/link/input/select/checkbox has a box height ≥ 44 (icon-only controls: width too)
- [x] `tsconfig.json`, `eslint.config.js`, `.gitignore` -- include `e2e/**` + `playwright.config.ts`, Node globals, ignore `e2e/.auth`, `test-results`, `playwright-report`
- [x] `DEPLOY.md` or a short `e2e/README.md` -- how to run, prerequisites (`supabase start`, Node 24), and not to run concurrently with `pnpm test`

**Acceptance Criteria:**
- Given the local stack is running, when `pnpm test:e2e` runs twice in a row, then both runs pass and no `e2e-%` organization or its auth users remain.
- Given a completed run, when `pnpm test` runs, then it passes unchanged, and the seeded fixtures are identical to before.
- Given `pnpm typecheck` and `pnpm lint`, when they run, then they cover `e2e/` and pass.

## Design Notes

The per-run organization is used instead of a second Supabase stack. Tenant isolation is the product's core guarantee (RLS), so a separate org is invisible to other worktrees. A second Docker stack would need its own ports, `.env`, CORS and Edge runtime. The `runId` (timestamp + random) keeps concurrent runs in different worktrees apart. The stale sweep only touches orgs older than one hour.

## Verification

**Commands:**
- `pnpm test:e2e` -- expected: all pass, run twice
- `pnpm typecheck && pnpm lint` -- expected: clean
- `pnpm test` -- expected: pass (run after E2E, not concurrently)
- `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select count(*) from organizations where slug like 'e2e-%'"` -- expected: 0

## Suggested Review Order

**Per-run isolation**

- Entry point: one transaction provisions the throwaway org, members, team and bands.
  [`fixture.ts:146`](../../e2e/support/fixture.ts#L146)

- Teardown deletes the org (cascade) and its auth users; refuses non-`e2e-` slugs.
  [`fixture.ts:262`](../../e2e/support/fixture.ts#L262)

- Sweep removes only orgs older than one hour, sparing concurrent runs elsewhere.
  [`fixture.ts:280`](../../e2e/support/fixture.ts#L280)

- Lifecycle: stack checks, sweep, provision; teardown always forgets the run.
  [`global-setup.ts:1`](../../e2e/global-setup.ts#L1)
  [`global-teardown.ts:1`](../../e2e/global-teardown.ts#L1)

**Stack readiness**

- Fails fast on Postgres/GoTrue down, naming `supabase start`.
  [`database.ts:51`](../../e2e/support/database.ts#L51)

- Proves admin-auth is really served via its own CORS methods header, not Kong's.
  [`database.ts:85`](../../e2e/support/database.ts#L85)

**Runner**

- Setup project, Vite and functions servers, reuse, trace/screenshot on failure.
  [`playwright.config.ts:29`](../../playwright.config.ts#L29)

- Worker-scoped fixture reads `fixture.json` lazily so `--list` works.
  [`test.ts:12`](../../e2e/support/test.ts#L12)

**Browser-only criteria**

- Horizontal scroll and 44 px target measurement, polled until layout settles.
  [`layout.ts:41`](../../e2e/support/layout.ts#L41)
  [`layout.ts:126`](../../e2e/support/layout.ts#L126)

- Eight screens at 320×640 with mobile + touch emulation.
  [`responsive.spec.ts:93`](../../e2e/responsive.spec.ts#L93)

**Flows**

- Sign-in, wrong password, Odjava on a spare account (sign-out revokes all sessions).
  [`sign-in.spec.ts:16`](../../e2e/sign-in.spec.ts#L16)

- Member refused on guarded admin routes; signed-out visitor sent to sign-in.
  [`authorization.spec.ts:13`](../../e2e/authorization.spec.ts#L13)

- Member creation through the Edge Function, one-time password shown.
  [`people.spec.ts:18`](../../e2e/people.spec.ts#L18)

- Team + roster with per-attempt data, retry-safe.
  [`teams.spec.ts:10`](../../e2e/teams.spec.ts#L10)

- Hour band add with a per-attempt start time.
  [`hour-bands.spec.ts:34`](../../e2e/hour-bands.spec.ts#L34)

**Peripherals**

- Sweep, teardown and stack-down behaviour asserted in Vitest.
  [`e2e-fixture.test.ts:100`](../../test/e2e-fixture.test.ts#L100)

- Own tsconfig for `dom` lib, chained into `typecheck`; scripts.
  [`package.json:13`](../../package.json#L13)

- Node + browser globals for `e2e/**`.
  [`eslint.config.js:290`](../../eslint.config.js#L290)

- How to run, isolation and reuse caveats.
  [`README.md:1`](../../e2e/README.md#L1)
