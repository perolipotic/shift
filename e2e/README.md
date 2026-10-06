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

- **Node 24** (`.nvmrc`). `playwright.config.ts` runs `e2e/utils/require-stack.ts`
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

## Layout

```text
e2e/
├── pages/                # page objects: one class per screen, locators and actions
│   ├── base.page.ts      # the shared chrome: navigation, the h1, status, alert, dialog, goto()
│   └── <screen>.page.ts  # login, calendar, conflicts, people, teams, organization, hour-bands, hours, leave, rotation, today
├── tests/
│   ├── auth.setup.ts     # the setup project: signs in and stores the sessions
│   └── <feature>/        # auth, calendar, conflicts, people, teams, hour-bands, hours, leave, rotation, today, layout
└── utils/                # fixtures, database and run-fixture helpers, i18n, dates, layout checks,
                          # members and stepper data, stack check, global setup/teardown
```

Specs are grouped by feature under `tests/<feature>/` (`testDir` in
`playwright.config.ts`). A new spec goes in the folder of the screen it drives,
and a new feature gets its own folder; specs import helpers as
`../../utils/<name>.ts`. `custom-fixtures.ts` gives the `test` and `expect`
every spec imports, with every page object as a test fixture (`loginPage`,
`calendarPage`, `conflictsPage`, `resolutionPage`, `peoplePage`, `teamsPage`, `organizationPage`, `hourBandsPage`,
`hoursPage`, `leavePage`, `rotationPage`, `todayPage`), and `run-fixture.ts` provisions and deletes the run's
organization (`readFixture`).

### Page objects

- A page object owns its screen's **locators** (getters, or methods returning a
  `Locator`) and **actions** (`signIn`, `addShiftType`, `cellOf`, …). Each
  extends `BasePage`, which opens its `path` with `goto()`.
- **No assertions.** A page object `expect`s only to wait for the screen inside
  an action (`signIn` waiting for `/danas`, `cellOf` waiting for the grid). Every
  claim a test makes stays in its spec, and an assertion helper is never a page
  method: it belongs in the spec or in `utils/layout.ts`.
- Specs take page objects from their fixtures and never call `page.getBy…` or
  `page.locator` themselves. A second browser context (a member's view in an
  admin test) wraps its own page: `new TeamsPage(memberPage)`.
- Data that is not a locator stays in `utils/` (`uniqueMember`, the stepper's
  `STEP_*` and `NEXT_LABELS`, the calendar's `dayMonth` and `weekdayOf`).
- Locators are by role or label. A page object may use a structural or
  ARIA-attribute selector (`thead th`, `tr[aria-current="date"]`,
  `[data-row][data-column]`, `option:checked`) only where no role or label
  reaches the element, and never a class or an id.
- A new page fixture: add the page to the `PageObjects` type and to the
  `base.extend` block in `utils/custom-fixtures.ts`.

## Isolation

Every run provisions its own organization, `e2e-<runId>`, with the operator
script (`supabase/operator/provision-organization.sql`), adds two members, a team
and two hour bands, and deletes the organization and its auth users when the run
ends (`e2e/utils/run-fixture.ts`). Tests write only inside that organization; the
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
  `apps/web/src/lib/i18n/locales/hr.json` (`e2e/utils/i18n.ts`). No CSS or id
  selectors in a spec (the page-object exception is above), no
  `waitForTimeout`; web-first assertions.
- A new locator goes in its page (`e2e/pages/<screen>.page.ts`), never in the
  spec; a new screen gets its own page object and fixture.
- A test that writes creates its own rows, unique per ATTEMPT (a retry or a
  `--repeat-each` copy runs against the same organization). The fixture is
  read-only; take it from the `fixture` fixture of
  `e2e/utils/custom-fixtures.ts`, never at module level, so
  `playwright test --list` works without a run.
- Authenticated specs use the stored `ADMIN_STATE` / `MEMBER_STATE`. Never sign
  out with those accounts: a sign-out revokes every session of the account.
