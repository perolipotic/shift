# Sprint Change Proposal — Source structure for `apps/web` and `e2e/`

- **Date:** 2026-09-27
- **Author:** Developer (correct-course workflow), for Perolipotic
- **Mode:** Batch
- **Status:** Approved 2026-09-27 (batch) — applied on `docs/correct-course-source-structure`

## 1. Issue Summary

**What changes.** The web app's `src/` and the Playwright suite in `e2e/` move to the conventional layout the human supplied (§4.1, §4.2): feature modules under `src/features/<module>/{components,hooks,services,types,utils,index.ts}`, thin screens under `src/pages/`, third-party setup under `src/lib/`, and a Page Object Model under `e2e/pages/` with specs grouped under `e2e/tests/<feature>/`.

**Why.** A layout that any React or Playwright developer recognises on sight. The human chose this over a narrower hybrid (keep the flat modules, only split the large screens) on 2026-09-27. The value is a known convention, not a defect fix.

**How it was discovered.** In a session on 2026-09-27 the human asked how hard the change would be. The assessment:

- Feature modules already exist, flat in `src/` (`calendar/`, `members/`, `rotation/`, `teams/`, `hour-bands/`, `shift-types/`, `organization/`, `navigation/`). They hold reads (`list.ts`), writes (`write.ts`) and pure rules, but no UI.
- The UI lives in route files: `ljudi.$id.tsx` has 1,674 lines, `organizacija.tsx` 1,013, `kalendar.tsx` 925. There are 9,075 lines in `routes/` in total.
- Every import goes through the `@/` alias (0 relative imports), so the move itself can be done mechanically.
- 18 unit tests read source files from disk (`readFileSync`) as source guards. They name paths and must follow the move.
- `e2e/` already has the setup project, a worker fixture (`support/test.ts`), a database helper and global setup and teardown. It has no page objects. About 280 `getBy…`/`locator` calls are spread over 11 specs, most of them in `calendar.spec.ts` (81) and `rotation.spec.ts` (65).

**Category.** A technical and structural change. It overturns no PRD requirement and no design invariant (AD-1…AD-17). It rewrites one descriptive section of the spine (Source tree) and one convention (`components/` README).

## 2. Impact Analysis

### 2.1 Epic Impact

- **Epics 1–6:** no scope, acceptance-criterion or order change. The move changes where code lives, not what it does.
- **Epic 3 (in progress):** PR #71 (`feat/3-5a-shift-type-override`, open, in a locked worktree) touches `src/`. The move must land **after #71 merges**, or #71 faces a large rebase.
- **Epics 4–6 (backlog):** new screens (hours, leave, conflicts, dashboards) are built directly in the new layout. This is the main payoff.
- No epic becomes obsolete. No new epic is needed. The work is tracked as orphan keys, the same convention as `navigation-shell-*` and `visual-refresh-*`.

### 2.2 Story Impact

- **Current:** 3.5a (PR #71) is unaffected if it merges first. 3.5 and 3.6 (backlog) will be specced against the new paths.
- **Future:** every spec written after the move names paths in the new layout. Historical specs in `implementation-artifacts/` are **not** rewritten, because they record what was true when they were written.

### 2.3 Artifact Conflicts

**PRD.** No conflict. N/A.

**Architecture spine** (`ARCHITECTURE-SPINE.md`):
- **§Source tree** lists `routes/ surfaces/ components/ i18n/ supabase/`. It must be rewritten (§4.3).
- **AD-13 (one snapshot per surface).** The rule stands. Its home moves: `surfaces/` holds only a README today, and the loaders live in `calendar/snapshot.ts` and `organization/snapshot.ts`. After the move a surface's loader is `features/<module>/services/snapshot.ts`, and the rule is stated in the spine rather than in a folder.
- **AD-7 (pure domain package).** Unaffected. `packages/domain` does not move. The ESLint message at `eslint.config.js:255` names `apps/web/src/supabase` and is updated to `apps/web/src/lib/supabase`.
- **Consistency conventions.** Gain one rule: a feature is imported only through its `index.ts` (§4.3).

**UX (`DESIGN.md`).** Its path references are `src/index.css`, `src/components/ui` and `components/README.md`. All three stay where they are. No change.

**Other artifacts:**
- `apps/web/components.json`: the shadcn aliases `lib` and `utils` move to `@/lib` and `@/lib/utils`, which is shadcn's own default.
- `eslint.config.js`: the four L2 messages naming `apps/web/src/i18n/locales/hr.json` become `apps/web/src/lib/i18n/locales/hr.json`. A new `no-restricted-imports` rule forbids deep imports into another feature.
- Folder READMEs (`components/`, `i18n/`, `navigation/`, `routes/`, `supabase/`, `surfaces/`) move with their folders and are rewritten where they describe the layout. `surfaces/README.md` is folded into the spine and deleted.
- `playwright.config.ts`: `testDir`, `testMatch`, `globalSetup` and `globalTeardown` paths change.
- `e2e/tsconfig.json`, `e2e/README.md` and the `e2e/**` ESLint block are updated.
- CI (`.github/workflows/`, `.github/actions/playwright`): calls `pnpm test:e2e` and needs no change. It is checked in the PR.
- `smoke/`: unchanged. It is a separate config with one spec.

### 2.4 Technical Impact

- **Behaviour:** none. The move is a refactor. All unit tests, the typecheck and the full E2E suite must pass unchanged in count.
- **Parallel sessions:** a wide rename diff breaks every open branch. Each PR below lands only when no other `src/` or `e2e/` PR is open, or its owners have agreed to rebase.
- **Shared Supabase stack:** unaffected (no migration).

## 3. Recommended Approach

**Direct adjustment**, in four parts, each its own spec and PR:

| Part | Content | Effort | Risk |
|---|---|---|---|
| **A — web move** | Mechanical move into `features/`, `lib/`, `utils/`, `hooks/`, `components/layout/`, `pages/`. Add `index.ts` per feature and the lint rule. Update the 18 source-guard tests, `components.json`, ESLint and READMEs. No file contents change beyond imports. | ~1 day | Low: codemod plus green gates |
| **B — thin pages** | Split each page into feature components so `pages/*.tsx` only composes. One PR per feature, largest first: members (`ljudi.*`), organization, calendar, rotation, then the rest. | ~4–6 days in total | Medium: UI regressions that only E2E would catch |
| **C — e2e layout** | Move specs into `tests/<feature>/` and helpers into `utils/`. Update the config. | ~0.5 day | Low |
| **D — e2e POM** | `pages/*.page.ts` for each screen. Move the ~280 locators out of the specs, and page objects are injected through `custom-fixtures.ts`. | ~1.5 days | Low: the suite is the test |

**Order:** A → B (per feature) and C → D in parallel. C and D touch only `e2e/`, so they can go before A if the web side has to wait for #71.

**Alternatives considered.**
- *Hybrid* (keep the flat modules, split the large screens only): cheaper and a smaller diff, but it is not the recognisable convention, which is the stated goal. The human rejected it.
- *Big bang* (A–D in one PR): rejected, because it is not reviewable and it blocks every parallel session for its whole life.

**Timeline impact.** About 7–9 working days of non-feature work. Epic 3's remaining stories (3.5, 3.6) and Epic 4 slip by that much, unless B runs between feature stories.

## 4. Detailed Change Proposals

### 4.1 Target layout — `apps/web/src`

Deviations from the supplied scheme are marked **Δ** with the reason.

```text
src/
├── components/
│   ├── ui/                     # unchanged (shadcn, restyled once)
│   └── layout/
│       └── auth-layout.tsx     # from components/
├── features/
│   ├── auth/
│   │   ├── components/         # sign-in form parts from pages/prijava*.tsx (part B)
│   │   ├── services/           # sign-in.ts, sign-out.ts, address.ts (from supabase/)
│   │   └── index.ts
│   ├── calendar/
│   │   ├── components/         # from pages/kalendar.tsx (part B)
│   │   ├── services/           # snapshot.ts
│   │   ├── utils/              # day-detail, grid-keys, modifiers, month   Δ1
│   │   └── index.ts
│   ├── hour-bands/             # services/{list,write}.ts
│   ├── members/                # services/{list,write,wire}.ts, utils/{position,rank}.ts, team-history.fixture.ts
│   ├── navigation/             # components/chrome.tsx   Δ2
│   │                           # hooks/use-dismiss.ts (dismiss.ts), utils/{destinations,icons,messages,profile,role}.ts
│   ├── organization/           # components/lockup.tsx, services/{snapshot,logo}.ts, utils/{accent,leave-start,logo-url,messages}.ts
│   ├── rotation/               # components/rotation-section.tsx, services/{list,write,history}.ts,
│   │                           # hooks/draft-store.ts, utils/{draft,stepper,warnings}.ts, rotation.fixture.ts
│   ├── shift-types/            # services/{list,write}.ts, utils/ramp.ts
│   └── teams/                  # services/{list,write}.ts, utils/roster.ts
├── hooks/                      # created when the first shared hook appears   Δ3
├── lib/
│   ├── i18n/                   # from i18n/ (index, boot, format, locales/hr.json, README)   Δ4
│   ├── supabase/               # client.ts (+ generated types), README
│   ├── theme.ts                # from theme/theme.ts
│   └── utils.ts                # shadcn cn, from components/utils.ts
├── pages/                      # from routes/ — file names keep the URL slugs   Δ5
│   ├── __root.tsx, _app.tsx, index.tsx, not-found.tsx
│   ├── prijava.tsx, prijava-organizacija.tsx
│   ├── danas.tsx, kalendar.tsx, raspored.tsx, sati.tsx, godisnji.tsx, smjene.$id.tsx
│   ├── ljudi.tsx, ljudi.novi.tsx, ljudi.$id.tsx, ljudi.smjene.tsx, ljudi.smjene.$id.tsx
│   ├── organizacija.tsx, organizacija.satni-pojasi.tsx, organizacija.satni-pojasi.$id.tsx
│   └── postavke-rotacije.tsx, postavke-rotacije.tipovi-smjena.$id.tsx
├── utils/
│   └── initials.ts             # from components/
├── App.tsx                     # QueryClientProvider + I18nextProvider + RouterProvider, from main.tsx   Δ6
├── router.ts                   # the route tree, unchanged
├── main.tsx                    # createRoot(<App />) only
└── index.css
```

Removed: `surfaces/` (README folded into the spine), `routes/`, `i18n/`, `supabase/`, `theme/`, and the flat feature folders.

**Rules carried with it:**
- Tests stay beside the file they test (`*.test.ts` moves with its subject).
- `features/<m>/index.ts` is the module's public API. Outside the module, only `@/features/<m>` may be imported, never `@/features/<m>/services/list`. ESLint enforces this with `no-restricted-imports`.
- A feature does not import another feature's internals. Cross-feature needs go through `index.ts`.
- `components/` stays free of `t()` and literals (unchanged). `features/*/components/` may call `t()`, because they are parts of a screen.
- `packages/domain` is untouched. Rules that belong there do not move into `features/*/utils/`.

> **Note (2026-09-27, A2b): no barrels; a lint rule over explicit public modules instead.** The human decided against the `features/<m>/index.ts` barrels in the two rules above. Whole-feature barrels would join navigation, organization, members, teams, rotation, shift-types and hour-bands into one import cycle. That cycle would put two top-level consts in TDZ reach (`members/services/list.ts` `LEVEL_FILTERS`, `rotation/utils/draft.ts` `NO_CLOCK_RANGE`), and a barrel would make a service-only importer load the other feature's components. The rule that replaces them is a local ESLint rule in `eslint.config.js`, `shift/feature-boundaries`, driven by one map, `FEATURE_PUBLIC`. The map lists per feature the modules other code may import, and it started as exactly the cross-feature imports that existed on 2026-09-27. A feature deep-imports its own modules freely, reaches another feature's only through that list, and never imports app-level code (pages, router, App, main). Every other file under `apps/web/src` may also import any feature's `components/**` and `hooks/**`. The rule resolves each specifier before it decides, so the `@/` alias, relative paths and dynamic imports are judged alike, and it refuses a path hidden behind a mid-path `..`, a `//` or a mis-cased folder. It is a local rule rather than `no-restricted-imports` because text patterns missed those forms. Tests, specs, fixtures and `__tests__/` are exempt. `test/feature-boundaries.test.ts` proves the rule through the real config. The spine's Module-boundaries convention states the same rule.

**Deviations (Δ):**
1. **`utils/` inside a feature.** The scheme has only `components/hooks/services/types`. Pure rules such as `month.ts` or `warnings.ts` are neither API calls nor hooks, and a global `utils/` would separate them from their feature.
2. **`chrome.tsx` stays in `features/navigation/components/`**, not `components/layout/`. It reads the role and the organization and renders translated labels, and `components/` holds no `t()`.
3. **No empty folders.** `hooks/`, `types/`, `context/`, `services/`, `config/` and `assets/` are created with their first file. None has content today: the Supabase env names live with the client, and there is no React context.
4. **`i18n` under `lib/`.** It is i18next's setup plus the one formatting module. The README's rule ("the single formatting module") is unchanged.
5. **`pages/` keeps `createRoute` in each file** (code-based TanStack Router, `router.ts` assembles the tree), and the file names stay the URL slugs, because the source-guard tests and `router.test.ts` key on them.
6. **`App.tsx` holds the providers, not the route tree.** A route tree is not JSX and stays `router.ts`.

### 4.2 Target layout — `e2e/`

```text
e2e/
├── pages/
│   ├── base.page.ts            # shared: navigation(), goto, the page's h1
│   ├── login.page.ts           # from support/sign-in.ts
│   ├── calendar.page.ts
│   ├── rotation.page.ts        # from support/rotation.ts (addShiftType, previewCell, stepper)
│   ├── people.page.ts          # from support/members.ts (+ rank/position controls)
│   ├── teams.page.ts
│   └── hour-bands.page.ts
├── tests/
│   ├── auth.setup.ts
│   ├── auth/                   # sign-in.spec.ts, authorization.spec.ts
│   ├── calendar/               # calendar.spec.ts
│   ├── people/                 # people.spec.ts, fire-ranks.spec.ts, team-position.spec.ts
│   ├── teams/                  # teams.spec.ts
│   ├── hour-bands/             # hour-bands.spec.ts
│   ├── rotation/               # rotation.spec.ts, rotation-phone.spec.ts
│   └── layout/                 # responsive.spec.ts
├── utils/
│   ├── custom-fixtures.ts      # from support/test.ts; adds the page objects as fixtures
│   ├── database-helper.ts      # from support/database.ts
│   ├── run-fixture.ts          # from support/fixture.ts (provision / teardown / readFixture)
│   ├── i18n.ts, layout.ts, require-stack.ts
│   ├── global-setup.ts, global-teardown.ts
├── README.md
└── tsconfig.json
```

**Deviations (Δ):**
- **The folder keeps its name, `e2e/`.** The supplied scheme's `my-playwright-tests/` is a placeholder for a standalone test repository. Here the suite lives inside the monorepo, beside `smoke/`. `e2e/` names what it is, not the tool, and it is already referenced by `playwright.config.ts`, `package.json` (`typecheck`), `eslint.config.js`, CI and the README. A rename would touch all of them for no gain.
- **No `data/user-data.json`.** Every run provisions its own organization with generated credentials (`run-fixture.ts`). A static accounts file would reintroduce shared state between runs. `data/` is created only if static test data appears.
- **No separate `.github/workflows/playwright.yml`.** The existing pipeline already runs the E2E job between `test` and deploy. Splitting it out would duplicate the stack setup.
- **`playwright.config.ts` stays at the repo root**, and so does `smoke/`.

**POM rules:** a page object holds locators and actions, never assertions. Specs keep every `expect`. Locators stay role- and i18n-based (`getByRole`, the `hr.json` strings through `utils/i18n.ts`). No new `data-testid`.

### 4.3 Architecture spine

```
Section: Source tree (apps/web)

OLD:
    web/
      src/
        routes/        # TanStack Router file routes
        surfaces/      # AD-13 — one snapshot loader per surface
        components/    # shadcn primitives + DESIGN.md domain components
        i18n/          # resources + the single formatting module
        supabase/      # generated types + client

NEW:
    web/
      src/
        pages/         # one file per route: createRoute + composition, no logic
        features/      # one module per capability; imported only through index.ts
          <module>/
            components/  # screen parts; may call t()
            hooks/
            services/    # reads, writes; snapshot.ts is the AD-13 loader
            utils/       # pure rules local to the feature
            index.ts
        components/    # shadcn primitives (ui/) + shared layout; no t(), no literals
        lib/           # i18n (resources + the single formatting module), supabase client, theme, cn
        utils/         # pure helpers shared by several features
  e2e/
    pages/             # page objects: locators and actions, no assertions
    tests/<feature>/   # specs
    utils/             # fixtures, database helper, run provisioning

Rationale: the conventional feature-module layout (human decision 2026-09-27).
```

```
Section: AD-13 — One snapshot per surface (append one sentence)

NEW: A surface's loader is `features/<module>/services/snapshot.ts`; there is no `surfaces/` folder.
```

```
Section: Consistency Conventions (new row)

| Module boundaries | A feature is imported only through `@/features/<m>` (its index.ts); ESLint forbids deep imports across features. |
```

### 4.4 Sprint status (new orphan keys, `backlog`)

```yaml
  # Source-structure change (sprint-change-proposal-2026-09-27-source-structure.md).
  # Derived from no epics.md criterion; reconcile with --set, same as navigation-shell.
  source-structure-a-web-move: backlog
  source-structure-b-thin-pages: backlog
  source-structure-c-e2e-layout: backlog
  source-structure-d-e2e-page-objects: backlog
```

## 5. Implementation Handoff

**Scope: Moderate.** No replan and no PM/Architect escalation (no invariant changes), but four sequenced chores that must be coordinated with parallel sessions.

- **Developer (bmad-build):** specs and implements A–D in the order of §3. Each PR is squash-merged as `chore: …` (C, D) or `refactor: …` (A, B).
- **Human:** confirms before A and before each B PR that no other `src/` PR is open, or that its owner will rebase. PR #71 merges first.
- **This proposal, on approval:** the spine edits (§4.3) and the sprint-status keys (§4.4) are applied on a `docs/correct-course-source-structure` branch.

**Success criteria:**
- Unit tests, the typecheck, lint and the full E2E suite pass, with the same test counts as before each PR (A, C: identical; B, D: identical E2E count).
- After A, no file remains in `routes/`, `surfaces/`, `i18n/`, `supabase/`, `theme/`, or the flat feature folders, and no deep cross-feature import passes lint.
- After B, no `pages/*.tsx` exceeds about 150 lines, and a page holds no query, mutation or derivation of its own.
- After D, no spec calls `page.getBy…` or `page.locator` directly. Every locator lives in `e2e/pages/`.
