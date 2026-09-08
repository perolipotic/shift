---
title: 'Navigation shell A — the route skeleton'
type: 'feature'
created: '2026-09-08'
status: 'done'
review_loop_iteration: 0
baseline_commit: '9e19f9ea980f41f90797519018e0880d55e2aae5'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The application has three routes — `/`, `/prijava`, `/prijava/$slug` — and no destinations. Nothing a signed-in member or admin is meant to reach exists, so no later story has anywhere to land. Six Croatian navigation words are held banned at `test/resource-hygiene.test.ts:202-210` "until the spec that owns them lands", and the eight destinations must all exist as registered routes before any navigation can compile against them: TanStack Router 1.170.32 typechecks `<Link to>` against the route tree.

**Approach:** A pathless layout route carries one session guard for every signed-in destination, and eight titled placeholder routes nest under it, each rendering its own `nav.*` key as an `<h1>`. The role-to-destination mapping is pure data in a `.ts` module, so the node suite executes it rather than regexing it. `/` and both sign-in routes stay outside the layout and unchanged. No navigation chrome — that is part B.

## Boundaries & Constraints

**Always:**
- The destination table stores translation **keys**, never labels, in a `.ts` module. `[{ label: 'Danas' }]` is not JSX, so no ESLint selector can reach it — this is the one L2 gap a syntactic rule cannot close, and pure data is what turns it into an executable assertion.
- Member-role maps to exactly four destinations — Danas, Kalendar, Sati, Godišnji — and to no configuration surface at all (UX-DR31, `epics.md:151`). Admin maps to those four plus Raspored, Ljudi, Postavke rotacije, Organizacija (UX-DR32, `:152`).
- `Sati` is ONE destination with role-scoped content, not two (human decision 2026-09-04, resolving the UX-DR31/UX-DR32 overlap). Eight total, not nine.
- The layout route is pathless. No `/$` catch-all: `router.test.ts:132-138` forbids it and `:119-130`'s `notFoundComponent` identity depends on its absence.
- Every new string is a `nav.*` key in `hr.json` with no literal in any component (L1/L2), authored **before** any `t()` call, because `i18n/index.ts:100-106` types the key argument off the resource file.

**Ask First:**
- Any change to `/`, `prijava.tsx` or `prijava-organizacija.tsx` beyond registering routes. Leaving all three untouched is what keeps `router.test.ts:47-49` and `:181-292` green, and that is a deliberate scope boundary, not an oversight.

**Never:**
- No navigation component, no tab bar, no sidebar, no icons, no active-destination treatment — part B.
- No sign-out, and no `nav.odjava` key. `odjava` therefore stays banned in both gates; this story does not earn it.
- No `.tsx` test file: `apps/web/vitest.config.ts:25` collects `src/**/*.test.ts` only, so a `.tsx` test is silently uncollected — green while asserting nothing.
- No `destructive` token in any screen, comments included (UX-DR4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signed-in reaches a destination | session, `/kalendar` | The destination renders its `nav.kalendar` heading | N/A |
| Signed-out reaches a destination | no session, `/kalendar` | Layout `beforeLoad` redirects to `/prijava`, `search` and `hash` preserved | N/A |
| Session read throws | reader rejects, `/danas` | Same redirect, cause logged — never a blank shell | Logged, not swallowed |
| Destinations for a member | role `member_role` | Table yields exactly four keys, in binding order | N/A |
| Destinations for an admin | role `admin` | Table yields exactly eight, `Sati` appearing once | N/A |
| Unmatched deep link | `/kalendar/2026-09/nope` | Root `notFoundComponent`, `_notFound === true` | N/A |

</frozen-after-approval>

## Code Map

**Baseline `9e19f9e`**, green: **948 root / 338 web / 4 domain**, 0 skipped. `nvm use` first (Node 24.19.0). `pnpm test` never builds and `localization-applied.test.ts` **fails** rather than skips on a stale build — so `pnpm build` before `pnpm test` whenever a file in `SOURCES` or `hr.json` changes.

### Routing

- `router.ts:9` — the single registration point, `rootRoute.addChildren([...])`. Code-based, no generated tree. The layout joins this array; the eight nest under it.
- `router.ts:11-33` — the regression not to repeat: inlining `currentSession` as an arrow instead of importing the bound reader kept the suite green while every signed-in visitor bounced endlessly between `/` and `/prijava`.
- `__root.tsx:31-35` — `AppRouterContext` carries `currentSession: () => Promise<Session | null>`, a **reader, not a value** (`:18-27`). Read it as `await context.currentSession()`, as `index.tsx:44` does.
- `index.tsx:44-76` — the guard to copy: session → return; `null` or a caught throw (`:59-71`, logged `SESSION_UNRESOLVED`) → `throw redirect({ to: '/prijava', search: true, hash: true })`. Both branches resolve — `:21-25` warns a branch ending in neither is the blank page 1.1d removed.
- Route shape: `createRoute({ getParentRoute, path, component })` (`index.tsx:41-78`). **No pathless or layout route exists today**; the tree is flat.

### Assertions to change — each an intended review moment

- `router.test.ts:39-44` — exhaustive `routesById`. Extend by nine ids; do not relax.
- `router.test.ts:102-107` — `/kalendar/2026-09/does-not-exist` must yield `['__root__']`, `_notFound === true`. It names a segment this story creates. **Verify by running, not reasoning** — the likeliest break that still looks like a pass.
- `router.test.ts:167-179` — the `beforeLoad` helper passes `{ context: { currentSession } }` as the *entire* context; the layout must tolerate that shape.
- `router.test.ts:64-90` — components pinned **by identity**. Each destination needs an equivalent; `toBeDefined` loses the mutation resistance.

**Must stay green, untouched** — staying green is the evidence the scope boundary held: `router.test.ts:47-49` (`match('/')`), `:119-130` (`notFoundComponent` identity), `:132-138` (no `/$`), `:181-292` (the deployed-root block, incl. `SignedInScreen` identity), `:256-271` (context binding).

### The vocabulary gates — three files, one commit

- `resource-hygiene.test.ts:113` — `SANCTIONED_KEYS` is an **equality** assertion; append eight `nav.*` keys to `:43-63`.
- `resource-hygiene.test.ts:202-210` — reserved: `danas, kalendar, godišnji, raspored, ljudi, postavke, odjava`. This story earns **six**; `odjava` stays, since no sign-out ships. Record it in the shape of `:188-201`.
- `resource-hygiene.test.ts:154-182` — voice sweeps: no `!`, no `smjen`, en dash for ranges.
- `localization-applied.test.ts:328-342` — move `Danas, Kalendar, Godišnji, Raspored, Ljudi, Postavke` from `NAVIGATION_AND_TERMINOLOGY` (absence) into `AUTHORED_VOCABULARY` (`:317-324`, count equality). `Odjava`, `Nema`, the three `smjen` forms, `Spremi`, `Odustani` stay banned.
- **`Sati` is in neither list** — no guard at all today. Add it to `AUTHORED_VOCABULARY` rather than inherit the gap.
- `Organizacija` is already count-checked; `nav.organizacija` adds one occurrence each side, so equality holds — confirm, don't assume.
- `localization-applied.test.ts:48-78` — every new file joins `SOURCES` or the freshness guard (`:132-143`) misses it.

### The screen sweeps

- `prijava.test.ts:68-78` — `SCREENS` entries carry `expectedControls`; `:69-73` records why a count is mandatory (a loop with no count read as coverage while asserting nothing). Eight entries at `0`.
- `prijava.test.ts:405-419` — `KEY_SOURCES`, per-file exact counts (`:444-450`); `:453-478` set equality, `used()` deduped at `:462-463`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/i18n/locales/hr.json` — eight `nav.*` keys, authored first so `t()` typechecks: `Danas`, `Kalendar`, `Sati`, `Godišnji`, `Raspored`, `Ljudi`, `Postavke rotacije`, `Organizacija`.
- [x] `test/resource-hygiene.test.ts` — extend `SANCTIONED_SCREEN_KEYS`; remove the six earned words, keeping `odjava`, with a comment in the shape of `:188-201`.
- [x] `apps/web/src/navigation/destinations.ts` — the role-keyed table: translation key, route path, order. Pure data, no JSX, no labels.
- [x] `apps/web/src/navigation/destinations.test.ts` — member yields exactly four and admin exactly eight; `Sati` appears once; binding order holds; every key exists in `hr.json`; no entry carries a literal label.
- [x] `apps/web/src/routes/_app.tsx` — the pathless layout: `beforeLoad` reading `context.currentSession()`, both branches resolving, the caught throw logged and redirected. Renders an outlet only.
- [x] `apps/web/src/routes/{danas,kalendar,sati,godisnji,raspored,ljudi,postavke-rotacije,organizacija}.tsx` — eight destinations, each rendering its own `nav.*` key as an `<h1>` and nothing else.
- [x] `apps/web/src/router.ts` — register the layout and nest the eight under it.
- [x] `test/localization-applied.test.ts` — move six words to `AUTHORED_VOCABULARY`, add `Sati`, extend `SOURCES` by all nine new files.
- [x] `apps/web/src/routes/prijava.test.ts` — extend `SCREENS` and `KEY_SOURCES` with exact control and string counts.
- [x] `apps/web/src/router.test.ts` — extend `routesById`; add identity assertions for the eight components; test the layout's `beforeLoad` in both branches against the bare context shape; re-verify the deep-link 404.

**Acceptance Criteria:**
- Given a signed-out visitor, when they open any of the eight destination URLs directly, then they land on `/prijava` with `search` and `hash` preserved.
- Given a seeded member and a seeded admin, when the destination table is evaluated for each, then the member yields four keys and the admin eight, with `Sati` once.
- Given the built chunk, when the vocabulary sweep runs, then `Odjava`, `Nema` and the three `smjen` forms are still absent and every authored word's count matches `hr.json` exactly.
- Given `nvm use && pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test`, when all run with the stack up, then each exits 0, no suite is skipped, and counts exceed the 948 / 338 / 4 baseline.
- Given the untouched files, when the suite runs, then `router.test.ts:47-49` and `:181-292` are still green — the evidence that `/` and both sign-in routes were left alone.

## Spec Change Log

### 2026-09-08 — iteration 1, three adversarial layers, no loopback

**Triage deviation, recorded deliberately.** One finding had a spec-level root cause, which normally routes to `bad_spec` and a revert-and-re-derive: `Destination.path` was typed `string`, which **defeats the premise this spec rests on**. The Intent argues the eight routes must exist now because TanStack typechecks `<Link to>` against the route tree; `string` widens straight past that check, so part B's links would not have been validated at all. The spec asserted the premise and never made "type the path against the registered tree" a constraint.

It was routed to `patch` instead. The reasoning: the fix is one type annotation plus a type-only import (`keyof RegisteredRouter['routesByPath']`), it is additive and local, and the architecture the spec asked for held up under all three layers. Re-deriving roughly 1,500 lines to reach a single annotation would have been disproportionate and would have discarded a diff that survived the review — the same call, for the same reasons, that story 1.3b's review recorded.

**A spec-side error the patch pass caught.** The review instructed adding the bare word `rotacije` to `AUTHORED_VOCABULARY`. That fails on correct code: `/postavke-rotacije` is a registered route path that ships in the chunk as data, so the bare word occurs word-bounded twice against `hr.json`'s once. The implementer declined it, reported rather than applying silently, and substituted `'Postavke rotacije'` — one occurrence each side, and the string a hard-coded label would actually carry. Verified against the built chunk.

**KEEP — must survive any re-derivation.**
- `Destination.path` typed against the registered route tree, not `string`. It is what makes the whole "build the routes first" argument real rather than asserted, and a typo'd path a `pnpm typecheck` failure.
- The layout guard reading the session through `context.currentSession()` rather than importing a client — the shape that puts both branches and the rejection case in the node suite despite AD-15 banning jsdom.
- Source-level assertions wherever AD-15 forbids a render, and a **negative** one alongside each positive: the outlet is asserted present *and* unconditional, the log is asserted made on failure *and* not made on success. The one-directional pin was the shape three separate findings exploited.
- Every detector extracted into a callable the sweep itself uses and the self-test calls. The reserved-word self-test that tested `String.prototype.toLowerCase` instead of the sweep is what this rule exists to prevent.
- Pinning the *decision* where behaviour cannot be observed: the layout's session-only guard is held by a source assertion naming no `role`, because a role branch that is unreachable while every screen is empty cannot be caught behaviourally.

**Known-bad state avoided.** A navigation shell whose every destination renders a blank page at HTTP 200 with the suite green; two destinations rendering each other's heading; a vocabulary ban shrunk from seven words to one with a compensating test that asserted only that JavaScript lowercases strings; a sign-out label `Odjavi se` sailing past a ban written for the noun `Odjava`; and eight route files documenting, in a docblock copied eight times, the opposite of what their own tests assert.

## Design Notes

**Why `/` stays outside the layout.** Nesting it would break `router.test.ts:47-49`'s match chain and force the whole `:181-292` block — redirect cases, `search`/`hash` preservation, the `SignedInScreen` identity — to be re-derived against the layout, for no gain this story can use. `/` already carries an equivalent guard at `index.tsx:44-76`. Part B replaces `SignedInScreen` wholesale; until then the duplication is two call sites of a four-line guard, cheaper than re-deriving a 111-line block twice.

**Why the destination table is data, not JSX.** L2 is an ESLint `no-restricted-syntax` selector over JSX text. A label in an array literal is neither JSX nor a call, so the selector cannot reach it — the one L2 gap no rule closes. Keys in a `.ts` module move the guarantee from a rule that cannot see it to a test that executes it.

**A correction to the ledger.** `deferred-work.md:203` cites UX-DR41 for the 640–1024 collapsibility. UX-DR41 (`epics.md:163`) is about the calendar at each breakpoint and says nothing about navigation. The binding sources are UX-DR31/UX-DR32 (`epics.md:151-152`) and `EXPERIENCE.md`'s Responsive table.

## Verification

**Commands:**
- `nvm use` — expected: Node 24.19.0.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — expected: all exit 0, no skipped suite, counts above 948 / 338 / 4. Build **before** test.
- `pnpm dev`, sign in as `ivan.maric` at `/prijava/dvd-kastel-novi`, then open `/kalendar` — expected: the `Kalendar` heading renders.

**Manual checks:**
- Sign out by clearing site data, then open `/organizacija` directly — expected: redirected to `/prijava`, not a blank shell.

## Suggested Review Order

**The contract everything else derives from**

- Start here: the role-keyed table, pure data, keys not labels — the story's whole premise.
  [`destinations.ts:90`](../../apps/web/src/navigation/destinations.ts#L90)

- The type that makes "build the routes first" real: a typo'd path fails `pnpm typecheck`.
  [`destinations.ts:61`](../../apps/web/src/navigation/destinations.ts#L61)

- Filters, never sorts — the array order is the binding order, with one source of truth.
  [`destinations.ts:104`](../../apps/web/src/navigation/destinations.ts#L104)

**The guard, and where it deliberately stops**

- Three outcomes, not two: the rejection path is why the read is wrapped.
  [`_app.tsx:73`](../../apps/web/src/routes/_app.tsx#L73)

- Session only, by decision — AD-10 puts role in the database, the table owns visibility.
  [`_app.tsx:67`](../../apps/web/src/routes/_app.tsx#L67)

- The outlet every destination renders through; unconditional, and asserted to be.
  [`_app.tsx:59`](../../apps/web/src/routes/_app.tsx#L59)

**Registration**

- The eight nest under the layout; `/` and both sign-in routes stay flat and untouched.
  [`router.ts:30`](../../apps/web/src/router.ts#L30)

- One representative destination — the other seven are identical but for one word.
  [`danas.tsx:26`](../../apps/web/src/routes/danas.tsx#L26)

- The eight keys, authored before any `t()` call so the resource typing holds.
  [`hr.json:25`](../../apps/web/src/i18n/locales/hr.json#L25)

**The vocabulary gates — the review moments this story had to pass through**

- Seven banned words down to one stem; `odjav` catches `Odjavi se`, which `odjava` did not.
  [`resource-hygiene.test.ts:98`](../../test/resource-hygiene.test.ts#L98)

- Six words plus `Sati` move from absence-checked to count-checked.
  [`localization-applied.test.ts:347`](../../test/localization-applied.test.ts#L347)

- What stays banned: `Odjava` is not earned here, because no sign-out ships.
  [`localization-applied.test.ts:377`](../../test/localization-applied.test.ts#L377)

**Tests worth reading rather than skimming**

- The layout guard's three branches, plus the negative: no log on the signed-in path.
  [`router.test.ts:493`](../../apps/web/src/router.test.ts#L493)

- The re-derived deep link: `_notFound` pinned by index, chain pinned by equality.
  [`router.test.ts:254`](../../apps/web/src/router.test.ts#L254)

- Binds path to file to key, so two destinations cannot swap headings silently.
  [`prijava.test.ts:533`](../../apps/web/src/routes/prijava.test.ts#L533)

- Refuses a container that renders no outlet — the blank-shell failure mode.
  [`prijava.test.ts:552`](../../apps/web/src/routes/prijava.test.ts#L552)

- The table carries no user-facing string at any nesting depth.
  [`destinations.test.ts:183`](../../apps/web/src/navigation/destinations.test.ts#L183)

**Peripherals**

- Eight component identities and the router-versus-table cross-check.
  [`router.test.ts:203`](../../apps/web/src/router.test.ts#L203)

- The detectors, self-tested through the helpers the sweeps actually use.
  [`destinations.test.ts:240`](../../apps/web/src/navigation/destinations.test.ts#L240)
