---
title: 'Source structure D — E2E page objects in e2e/pages/'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: '5b22bb4ef707c94e43f56bc2bc7e43e5c7fbada7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There are 286 `page.getBy…`/`page.locator` calls across the 11 specs, most of them in `calendar.spec.ts` (83) and `rotation.spec.ts` (65). Screen knowledge also sits in spec-local helpers (`gridOf`, `cellOf`, `detailOf`, `dragOnto`, …) and in `utils/{sign-in,rotation,members}.ts`. A UI change therefore means edits in several places.

**Approach:** Add a Page Object Model in `e2e/pages/`, one class per screen, that owns every locator and every screen action. The page objects are injected as Playwright fixtures through `utils/custom-fixtures.ts`. Specs keep every assertion and read as intent.

## Boundaries & Constraints

**Always:**
- A page object holds locators (getters or methods returning `Locator`) and actions. It may `expect` only as a readiness wait inside an action (e.g. `signIn` waiting for `/danas`). Every assertion a spec makes stays in the spec.
- Locators stay role- and label-based through `hr` from `utils/i18n.ts`.
- The test count stays at **68 in 12 files**, and every test keeps its title and its steps in order.

**Ask First:**
- Any change to what a test asserts, or to its order of actions.
- Adding a `data-testid` or touching `apps/web`.

**Never:**
- No assertion helpers disguised as page methods (`expectX…` belongs to specs or `utils/layout.ts`).
- No `data/` folder and no retries or timeouts added.
- No change to `smoke/`'s behaviour.

</frozen-after-approval>

## Code Map

- `e2e/tests/**/*.spec.ts`: 286 direct locator calls. The spec-local screen helpers to lift out:
  - `calendar.spec.ts`: `gridOf:147`, `cellOf:152`, `dayList:332`, `modes:337`, `focusedCell:481`, `detailOf:624`, `legendOf:799`, `teamFilterOf:913`, `columnCountOf:918`, `moveTabStopOffToday:939`, `personListOf:1052`, `peopleOptionsOf:1059`. `expectTabStopOnToday:950` is an assertion, so it stays in the spec.
  - `rotation.spec.ts`: `dragOnto:36`, `announced:55`, `afterPendingTimers:66`.
  - `responsive.spec.ts`: `checkScreen:27` and `checkRotationSteps:128` are assertion flows and stay; their locators move to the pages.
- `e2e/utils/sign-in.ts`: `submitSignIn`, `signIn` and `navigation`. They become `LoginPage` and `BasePage.navigation`. `smoke/deployment.spec.ts:4` imports `signIn`, so repoint that import (a behaviour-neutral change).
- `e2e/utils/rotation.ts`: `addShiftType`, `previewCell`, `stepProgress`, `stepBar`, `stepButton`, `STEP_*`/`NEXT_LABELS`. They go into `RotationPage`. The constants may stay in utils if they are data.
- `e2e/utils/members.ts`: `submitNewMember` and `createMember` go into `PeoplePage`. `uniqueMember` is data and stays in utils.
- `e2e/utils/custom-fixtures.ts`: `test = base.extend<…>` holds the worker `fixture`. Add test-scoped page-object fixtures.
- Screens, by the specs' `goto`s:
  - `/prijava*`: login
  - `/danas`: the landing heading only, via base
  - `/kalendar`
  - `/ljudi`, `/ljudi/novi`, `/ljudi/:id`: people
  - `/ljudi/smjene`, `/ljudi/smjene/:id`: teams
  - `/organizacija`: organization settings, including fire ranks
  - `/organizacija/satni-pojasi`: hour bands
  - `/postavke-rotacije`: rotation, including shift types
- `e2e/tests/auth.setup.ts`: uses `signIn` and `navigation`.

## Tasks & Acceptance

**Execution:**
- [x] `e2e/pages/base.page.ts` -- `BasePage(page)`: `navigation`, `heading(name)` (the h1), `goto()` from each subclass's `path` -- the shared chrome.
- [x] `e2e/pages/{login,calendar,people,teams,organization,hour-bands,rotation}.page.ts` -- one class per screen. Lift the spec-local helpers and the utils actions listed above, then move every remaining locator the spec uses -- the model.
- [x] `e2e/utils/custom-fixtures.ts` -- add `loginPage`, `calendarPage`, `peoplePage`, `teamsPage`, `organizationPage`, `hourBandsPage`, `rotationPage` fixtures -- specs receive pages, not `new`.
- [x] `e2e/tests/**` -- rewrite each spec onto the pages, one file at a time, keeping titles, steps and assertions -- intent-level specs.
- [x] `e2e/utils/{sign-in,rotation,members}.ts` -- remove what moved. Delete a file that is left empty. Repoint `smoke/deployment.spec.ts` -- no second home.
- [x] `e2e/README.md` -- add `pages/` to the Layout, the POM rules (locators and actions, no assertions), and "a new locator goes in its page" under Writing a spec -- the map.

**Acceptance Criteria:**
- Given the suite, when `grep -rnE "\bpage\.(getBy|locator)" e2e/tests` runs, then it finds nothing.
- Given `e2e/pages/`, when `grep -rn "expect(" e2e/pages` runs, then every hit is a readiness wait inside an action, never a public `expect…` method.
- Given the local stack, when `pnpm test:e2e` runs twice in a row, then 68/68 pass both times.

## Verification

**Commands:**
- `pnpm typecheck` and `pnpm lint` -- expected: exit 0.
- `pnpm exec playwright test --list | tail -1` -- expected: `Total: 68 tests in 12 files`, with titles identical to the baseline (diff the `--list` output).
- `pnpm test:e2e`, twice -- expected: 68 passed each time. Stop any other dev server on 5173 first (`e2e/README.md`).

## Suggested Review Order

**The model**

- The shared chrome every page inherits: path-based goto, navigation, headings, dialogs.
  [`base.page.ts:1`](../../e2e/pages/base.page.ts#L1)

- The largest page: the grid, cells, day list, detail and filters lifted from the spec.
  [`calendar.page.ts:25`](../../e2e/pages/calendar.page.ts#L25)

- The page-wide today-row count, restored after review so the check stays as strong as before.
  [`calendar.page.ts:115`](../../e2e/pages/calendar.page.ts#L115)

- Sign-in as an action; its URL waits are readiness, not assertions.
  [`login.page.ts:41`](../../e2e/pages/login.page.ts#L41)

**Wiring**

- Page objects reach specs as test-scoped fixtures.
  [`custom-fixtures.ts:30`](../../e2e/utils/custom-fixtures.ts#L30)

**Specs on the pages**

- A representative rewrite: steps and assertions unchanged, locators gone.
  [`rotation.spec.ts:38`](../../e2e/tests/rotation/rotation.spec.ts#L38)

**Peripherals**

- The POM rules and the structural-selector exception.
  [`README.md:59`](../../e2e/README.md#L59)

- Date formatting moved out of the page into utils.
  [`dates.ts:1`](../../e2e/utils/dates.ts#L1)
