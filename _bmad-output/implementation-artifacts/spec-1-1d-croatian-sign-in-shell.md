---
title: 'Story 1.1d — The Croatian sign-in shell'
type: 'feature'
created: '2026-09-04'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'c7240664a3db2f82612bdb647180945816887f72'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/web` renders no text at all — `routes/index.tsx:7` is an empty `<main>`. The theme layer (1.1b) and localization layer (1.1c) are built but no surface consumes either, so story 1.1's acceptance — reach a working sign-in screen at a real URL, correct in both themes, every string through a key, diacritics intact — is met by nothing. `hr.json` holds two plural messages and no screen literal, `components/ui/` does not exist, and both an unknown path and a failed boot render a blank page at HTTP 200.

**Approach:** Author the first real screen: a presentational Croatian sign-in form at `/prijava` with `/` redirecting to it, a not-found component on the root route, and a static pre-mount boot fallback in `index.html`. Then close the three ledger items this screen is the trigger for — the L2 guard's coverage against real component shapes, the `--input` control-boundary contrast, and the unasserted React binding.

## Boundaries & Constraints

**Always:**
- No auth. No submit handler, no Supabase client, no session, no validation, no error state — 1.3 owns every one of those, and 1.1a's frozen boundary already says so.
- Every user-facing string resolves through `t()` from a key in `hr.json` (L1/L2).
- Components consume the module-level `t` from `@/i18n` — the only pattern the L2 guard has ever proved compliant (`test/localization-guard.test.ts:210-220`). `useTranslation` is not introduced.
- Voice: no exclamation mark, second person singular informal, state the fact never the absence, en dash U+2013 never a hyphen.
- Both themes correct via `prefers-color-scheme` only. No `.dark` class, no `data-theme`, no second `prefers-color-scheme` may reach `index.css` — three assertions enforce this.
- `destructive` is not used. It is reserved exclusively for an unresolved conflict.
- 44 px minimum touch targets. No horizontal page scroll at any width. Keyboard reachable, with an accessible name on every control.
- shadcn primitives are inherited unmodified into `components/ui/`; classes compose through `cn` (`components/utils.ts:5`).
- Exact version pins (`save-exact=true`); every new package must already be older than pnpm 11's 24-hour release-age gate.
- Run `pnpm build` before `pnpm test` — three suites assert the build is newer than its sources and fail rather than skip when stale.

**Ask First:**
- Any Radix package beyond `react-slot` and `react-label`, or `tw-animate-css`. The four chosen primitives need neither; an overlay primitive (Sheet, Dialog, Tooltip) would pull in both plus a motion layer this design has no token for.
- Weakening `.npmrc` or `pnpm-workspace.yaml` to satisfy a pin — lower the pin instead (1.1b KEEP).
- Changing any pinned contrast expectation other than the two `--input` rows.
- Adding a favicon, manifest, `robots.txt` or `_headers` — `test/static-hosting.test.ts:32-36` allowlists exactly `index.html`, `assets`, `_redirects` in `dist/`.

**Never:**
- No navigation of any kind — no tabs, no sidebar, no destination table, no `nav.*` key, no destination route. That is a separate spec; `Danas`, `Kalendar`, `Godišnji`, `Raspored`, `Ljudi`, `Organizacija`, `Postavke` and the `Smjena` family stay absent from the bundle.
- No organization logo, lockup or accent tint — no organization exists; branding is 1.4's, and UX-DR5 goes with it.
- No sign-out, save or cancel affordance; `Odjava`, `Spremi`, `Odustani` and `Nema` stay absent.
- No `--sidebar-*` token change, no `tabular-nums` surface, no clock-only formatter, no plural-category check — all in the ledger.
- No data fetching, no `surfaces/` implementation, no query key. Routes compose components only.
- No `Intl` construction and no `Date` accessor call outside `i18n/format.ts` — a repo-wide scan over `apps/web` enforces it.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Sign-in route | `GET /prijava` | Renders `Prijava`, `Korisničko ime`, `Lozinka`, `Prijavi se`, the reset line | N/A |
| Root | `GET /` | Redirects to `/prijava` | the seam 1.3 makes conditional |
| Unknown path | `/kalendar/2026-09/nope` | Root layout renders the not-found component; `_notFound === true` | never a blank page |
| Localization init rejects | `initLocalization()` throws | React never mounts; the static `index.html` fallback stays visible; `LOCALIZATION_INIT_FAILED` logged | fallback is untranslated by necessity |
| Missing key | a deleted `auth.*` key | `⟦auth.heading⟧` renders, nothing throws | never blank |
| Input boundary | `--input` vs its surface | ≥ 3:1 composited, both themes | below 3:1 fails |
| Reserved vocabulary | built chunk | the 5 words this story authors appear only inside the bundled resource; the other 14 appear nowhere | a component literal fails |
| L2, ternary literal | `{x ? 'Da' : 'Ne'}` in a `.tsx` | ESLint error naming L2 | guard self-test proves it fires |

</frozen-after-approval>

## Code Map

**Baseline `c7240664`**, green: build, lint, typecheck clean, 809 tests (689 root + 116 `apps/web` + 4 `packages/domain`).

- `apps/web/src/routes/index.tsx:6-14` -- the empty `<main>` and `createRoute({ path: '/' })`. Becomes the redirect; `beforeLoad` throwing `redirect({ to: '/prijava' })` is the seam 1.3 turns conditional.
- `apps/web/src/routes/__root.tsx:19` -- `createRootRoute({ component: AppShell })`; options carry only `component`, so `notFoundComponent` goes here. The doc comment at `:5-9` is **stale** — it says navigation arrives in 1.1b; navigation is now its own spec, so correct it to say the shell stays text-free and why.
- **Not-found shape is forced.** `apps/web/src/router.test.ts:39-40` asserts `match('/kalendar/2026-09/does-not-exist')` yields `['__root__']` with `matched[0]?._notFound === true`. A catch-all route (`/$` or `NotFoundRoute`) makes that list `['__root__','/$']` and `_notFound` falsy — it would invert the guard. `notFoundComponent` on the root route (declared into `UpdatableRouteOptionsExtensions`, `route.d.ts:14`) changes no route id and no `matchRoutes` output.
- `apps/web/src/router.test.ts:25` -- `expect(Object.keys(router.routesById).sort()).toEqual(['/', '__root__'])` is **exhaustive**; adding `/prijava` breaks it by design.
- `apps/web/src/main.tsx:11-16` -- `ROOT_ELEMENT_MISSING` throw (a code, leave it). `:22` top-level `await initLocalization()` with **no catch**. `:26` `<I18nextProvider i18n={i18n}>` wraps `RouterProvider`.
- **The provider must stay.** `test/localization-applied.test.ts:128` sweeps the built chunk for `'i18n:'` — "the only marker of the provider that survives minification". Dropping it for module-level `t` breaks that marker.
- `apps/web/src/i18n/index.ts:93` -- `export const t = i18n.t` by reference. `:100-106` `CustomTypeOptions.resources: { translation: typeof hr }`: keys are inferred from the JSON, so **new keys type themselves** — no hand-maintained list and no edit to this file. `t('auth.headng')` is a compile error.
- `apps/web/src/i18n/locales/hr.json` -- exactly `count.days` and `count.conflicts`. Both are wiring markers (`localization-applied.test.ts:88,93`) — do not rename or remove.
- `apps/web/src/components/utils.ts:5` -- `cn(...inputs: ClassValue[])`. Note the non-standard home: `components/utils.ts`, not `lib/utils.ts`; `components.json` re-points the `lib`/`utils` aliases there so no new top-level `src/` directory appears.
- `apps/web/components.json` -- `style: new-york`, `baseColor: neutral`, `cssVariables: true`, `iconLibrary: lucide`, `tailwind.config: ""` (CSS-first; no JS config exists and none may be created), `ui: @/components/ui` (does not exist yet).
- **shadcn peers are absent** — `class-variance-authority`, every `@radix-ui/*` and `tw-animate-css`, not even transitively, under `node-linker=isolated`. Present: `clsx 2.1.1`, `tailwind-merge 3.6.0`, `lucide-react 1.39.0`. Button needs cva + `@radix-ui/react-slot`; Label needs `@radix-ui/react-label`; Input and Card need nothing. Avoiding overlays is what keeps `tw-animate-css` unnecessary.
- `apps/web/src/index.css` -- `:55-112` light `:root`, `:114-171` the single dark `@media`, `:173-231` `@theme inline` (51 `--color-*` mappings), `:236-255` `@layer base`. Light `--input`/`--border` are both `oklch(0.922 0 0)`; dark `--border` is `oklch(1 0 0 / 10%)`, `--input` `oklch(1 0 0 / 15%)`.
- **Token-layer tripwires.** `test/theme-tokens.test.ts:140-142` fails on any `.dark` or `data-theme` in the stylesheet; `:158-160` requires `prefers-color-scheme` **exactly once**; `:132-134` requires all 51 mappings intact. shadcn's canonical install writes a `.dark {}` block — it must not be added.
- **`--input` is pinned below AA.** `test/theme-contrast.test.ts:199-204` `EXPECTED_RATIO` = light-border 1.26, light-input 1.26, dark-border 1.25, dark-input 1.47, each `toBeCloseTo(…,2)` **and** `:216` `expect(measured).toBeLessThan(AA_LARGE)` — that line actively forbids ≥3:1, so raising `--input` means splitting the block, not editing a number. `composite()` at `:89-96` handles the alpha tokens; a raw reading of dark `--border` reports a meaningless 19.79:1 uncomposited. `theme-fidelity` derives cases from DESIGN.md's front matter only and both tokens are `BASE_TOKENS` (`test/theme-css.ts:40-69`), so fidelity stays green.
- `test/resource-hygiene.test.ts:32` -- `SANCTIONED_KEYS = ['count.days','count.conflicts']`; `:69-73` asserts the key set is **exactly** that. **`:75-87` is `it.each(SANCTIONED_KEYS)` and requires every listed key to be a three-form ICU plural** — appending `auth.heading` to that one constant fails it as a non-plural, so the constant must be partitioned rather than extended. `:120-143` reserves ten words as an inline `const` with no allowlist; `prijava` and `lozinka` are this story's and must come out, the eight navigation words stay. Still binding: no `!` (`:91`), no `smjen` stem (`:100`), no hyphen range (`:110`).
- `test/localization-applied.test.ts:167-187` -- the nineteen-word sweep asserts each word is **absent** from the built chunk (`:190-197`) and from `dist/index.html` (`:209-221`). `hr.json` is bundled into that chunk, so the five sign-in words become false by construction. `:161-166` says the list is "everything story 1.1d and the navigation shell will introduce". `:35-40,67-78` is the strict-mtime freshness guard over `main.tsx`, `i18n/index.ts`, `i18n/format.ts`, `hr.json`.
- `eslint.config.js:97-142` -- six L2 selectors over `apps/web/**/*.tsx`. **Verified today:** `{'Danas'}`, template-literal children, `aria-label={'…'}` and `<option label>` all **fire** — the ledger is stale in claiming otherwise. Genuinely open and reachable from a form: a `Literal` inside a ternary or logical expression (the selectors require a **direct** child of the container) and a `TemplateLiteral` on a guarded attribute. Component props and imperative calls stay open and are unreachable here — no wrapper component and no imperative string exists in this scope. Parsing is `@babel/eslint-parser` syntax-only (`:16-29`): selectors must name ESTree `Literal`, never Babel `StringLiteral`, and nothing type-aware is possible. Separator punctuation is exempt by human decision (`:84-96`), asserted in both polarities. `apps/web` contains **zero** `eslint-disable` comments; keep it that way.
- `test/localization-guard.test.ts` -- drives the **real** config via `new ESLint({ cwd: repoRoot })` + `lintText` (`:86-103`) across three probe paths `surfaces/`, `routes/`, `components/` (`:48-52`; narrowing to one path once hid a real regression, `:41-46`). `VIOLATIONS` `:107-179`, `COMPLIANT` `:204-276`, `eqeqeq` vacuous-pass control `:309-322`. Violating JSX is assembled from fragment helpers so the file cannot trip its own rule.
- `apps/web/src/i18n/format.test.ts:683-757` -- scans **all** of `apps/web` (`.ts` + `.tsx`): no `Intl` outside `format.ts`, no `toLocale*`/`toISOString`/`getDate`/`getHours` family, no raw control byte. New screens are in scope automatically.
- `apps/web/public/_redirects` -- `/*  /index.html  200`. AD-14: the host answers every path with `index.html` at 200, so **the client** decides a path is unknown (`router.test.ts:32-35`).
- **Undecided Croatian — authored here, nowhere in the artifacts.** No planning file contains `Prijava`, `Prijavi se`, `Korisničko ime`, `Lozinka` or `Zaboravljena lozinka`; there is also **no sign-in mockup**. Voice rules `EXPERIENCE.md:76-82`; `destructive` reservation `DESIGN.md:130`; username-not-email identity and admin-issued reset `ARCHITECTURE-SPINE.md:124-128`.
- **Test idioms to copy.** Repo root via `fileURLToPath(new URL('..', import.meta.url))` (`test/theme-css.ts:18`); every read in a **lazy function, never module scope** (`:12-16`) or the failure surfaces as an unnamed collection error and the named assertion never runs; comment-blind scanning (`:77-86`); detector self-tests on synthetic sources (`packages/domain/test/purity.test.ts:117-158`); needles assembled at runtime so a file cannot trip its own scan (`:127-128`); vacuous-pass guards (`:104-106`); `describe` a plain claim and `it` a behavioural clause, never "should"; `it.each` object rows with `$name`; `it.skipIf(notBuilt)` over an early `return`. Tests are `.ts` only in the node environment — **a `.tsx` test is silently not collected**, so no rendered-component assertion is possible (AD-15).

## Tasks & Acceptance

**Execution:**

- [x] `apps/web/package.json` -- add `class-variance-authority`, `@radix-ui/react-slot`, `@radix-ui/react-label` as exact pins clearing the 24-hour gate -- Button and Label cannot resolve without them under isolated linking.
- [x] `apps/web/src/components/ui/{button,input,label,card}.tsx` -- add the four shadcn `new-york` primitives unmodified -- inherited wholesale per DESIGN.md. Strip any `.dark` selector the generator emits toward CSS; nothing may reach `index.css`.
- [x] `apps/web/src/i18n/locales/hr.json` -- add `auth.{heading,username,password,submit,passwordReset}` and `notFound.{heading,back}` -- the seven screen strings. Proposed copy in Design Notes.
- [x] `apps/web/src/routes/prijava.tsx` -- the sign-in screen: Card, Label + Input for username and password, a submit-type Button, the reset line. No handler, no state, no validation. `autoComplete` on both fields, the password field `type="password"`.
- [x] `apps/web/src/routes/not-found.tsx` -- the not-found component (a component, not a route): `notFound.heading` plus a `Link` to `/prijava` carrying `notFound.back`.
- [x] `apps/web/src/routes/index.tsx` -- replace the empty `<main>` with `beforeLoad` throwing `redirect({ to: '/prijava' })` -- so the deployed root is a real screen rather than a blank page, and 1.3 has one place to make the redirect conditional.
- [x] `apps/web/src/routes/__root.tsx` -- add `notFoundComponent`; correct the stale 1.1b comment -- the only shape that preserves `router.test.ts:39-40`.
- [x] `apps/web/src/router.ts` -- register `prijavaRoute` in `addChildren`.
- [x] `apps/web/index.html` -- static Croatian boot fallback inside `#root`, replaced when React mounts -- covers a rejected init *and* a bundle that never loads, and cannot itself be a translated string because the translation layer is what failed.
- [x] `apps/web/src/main.tsx` -- `catch` the init rejection, `console.error('LOCALIZATION_INIT_FAILED')`, and do **not** mount -- mounting would paint `⟦key⟧` over every surface. Keep `I18nextProvider`.
- [x] `apps/web/src/index.css` -- raise `--input` to ≥3:1 against its surface in both themes -- the form's border is the first control boundary that is a control's sole affordance (WCAG 1.4.11). `--border` stays stock: it edges cards and separators, not controls. Dark must be measured composited, not raw.
- [x] `test/theme-contrast.test.ts` -- split the pinned block: `--border` keeps its pinned sub-AA ratios, `--input` moves to a ≥3:1 assertion in both themes -- `:216`'s `toBeLessThan(AA_LARGE)` cannot cover both tokens any more.
- [x] `test/resource-hygiene.test.ts` -- partition the allowlist into `SANCTIONED_PLURAL_KEYS` and the full nine-key set so the three-form assertion runs only over plurals; drop `prijava` and `lozinka` from the reserved sweep and keep the eight navigation words; keep the `!`, `smjen`, hyphen-range and self-test blocks.
- [x] `test/localization-applied.test.ts` -- re-derive the vocabulary sweep: the five authored words must appear **only** inside the serialized resource object in the chunk (occurrence count in the chunk equals the count in `hr.json`), the other fourteen nowhere; add the boot-fallback text to the `index.html` assertions; keep all nine wiring markers.
- [x] `eslint.config.js` -- add three selectors: a `Literal` under a `ConditionalExpression`/`LogicalExpression` inside a JSX child container, and the ternary and template-literal shapes on the seven guarded attributes -- anchored at the branch node rather than as a descendant sweep, so a `t('key')` argument nested in a container is not a false positive.
- [x] `test/localization-guard.test.ts` -- both-polarity cases for the three new selectors across all three probe paths, plus positive controls proving `{cond ? t('a') : t('b')}` and `aria-label={t('a')}` still lint clean.
- [x] `apps/web/src/routes/prijava.test.ts` -- a source-level scan of the screen (a `.ts` test; a `.tsx` one is not collected): every user-facing string reaches `t()`, the key set matches `hr.json`, no `destructive` utility, both fields carry an accessible name, and a detector self-test on synthetic sources.
- [x] `apps/web/src/router.test.ts` -- update the exhaustive `routesById` list to `['/', '/prijava', '__root__']`; assert `/` redirects to `/prijava`; keep the `_notFound` assertion **unchanged** as the proof the not-found shape did not become a route.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append: the organization logo lockup and accent tint (UX-DR5, needs 1.4), the sign-in error and refused-save state (1.3, and it may not use `destructive`), and the `epics.md:193` vs `:254` UX-DR allocation discrepancy.

**Review patches (2026-09-04, iteration 1).** Fixed in place by human direction; see the Spec Change Log for the deviation and the KEEP list.

- [x] `apps/web/src/i18n/boot.ts` + `boot.test.ts` -- extract `bootLocalization(init: () => Promise<unknown>): Promise<boolean>` -- **MUTATION-PROVEN GAP.** The mount decision was asserted only by source wording, so a `try`/`catch` refactor mounted on a failed init with 900 green. An importable module lets the node suite execute the polarity: reject → `false`, resolve → `true`, and a **synchronous** throw → `false` too. `main.tsx` then holds only `if (await bootLocalization(initLocalization))`, and the chunk-marker sweep still proves it shipped.
- [x] `apps/web/src/index.css` -- resolve the `--ring` / `--input` adjacency (**1.06:1** light, 1.28:1 dark — the focus ring is invisible against the border it abuts); add a `@media (forced-colors: active)` rule in `@layer base` giving `:focus-visible` a real outline, because v4's `outline-none` emits `outline-style:none` where v3 drew a transparent 2 px outline and the ring is a `box-shadow`. Keep `--input` ≥3:1 against its surface. Do **not** add `.dark`, `data-theme`, or a second `prefers-color-scheme`.
- [x] `apps/web/index.html` -- reveal the fallback only after the boot has actually taken too long (`opacity: 0` plus a delayed reveal via a `<style>` in `<head>`) -- it is currently painted from first paint, so every slow load shows a false Croatian error telling the user to refresh. It must still work with no JavaScript and no external stylesheet.
- [x] `apps/web/src/routes/prijava.tsx` -- add `onSubmit` `preventDefault` (KEEP `method="post"`) so the only action on the screen stops navigating to a 405 and discarding every typed value; bind the reset guidance to the password field with `aria-describedby` so it is reachable in tab order; add `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}` to the username, which is admin-issued and never an email.
- [x] `apps/web/src/i18n/locales/hr.json` -- `auth.passwordReset` → `Zaboravljena lozinka? Administrator ti postavlja novu.` -- human-approved 2026-09-04. The proposed string was ungrammatical: the enclitic `je` and the explicit `novu` both filled the accusative slot.
- [x] `test/theme-contrast.test.ts` -- add a ring-versus-input pair at ≥3:1 in both themes; re-pin `--input`'s exact measured ratios alongside the ≥3:1 floor so it cannot drift inside [3, 4.5); add `--input` to the anti-revert `DEVIATIONS` registry, which still names three tokens while `index.css` now says five deviate; drop or justify the unexplained `toBeLessThan(AA_BODY)` upper bound; make the light compositing case non-vacuous or scope it to dark with the reason stated.
- [x] `test/theme-applied.test.ts` -- add the input boundary to the consumer list: the built sheet must emit a `.border-input` rule resolving to `var(--input)` -- **MUTATION-PROVEN GAP**, and the same shape as 1.1b's original loopback.
- [x] `apps/web/src/routes/prijava.test.ts` -- assert both inputs and the submit button carry a height class ≥44 px (**MUTATION-PROVEN GAP**); assert `input.tsx` names `border-input`; extend `unsanctionedLiterals` to backtick template literals, which the quote-only class cannot see; assert the two field ids are distinct and each `htmlFor` resolves; require `autoComplete` to carry a credential-manager value rather than merely being non-null, so `off` fails; assert the form is inert.
- [x] `test/localization-applied.test.ts` -- add `apps/web/index.html`, `routes/prijava.tsx` and `routes/not-found.tsx` to `SOURCES` (**MUTATION-PROVEN GAP**); add a source-level assertion matching the fallback inside the `#root` element body rather than by string index; sweep every `dist/assets/*.js`, not the entry chunk alone; convert both `if (notBuilt) return` bodies to the repo's `skipIf` idiom so a build-less checkout skips rather than reporting green; state explicitly why `.js.map` is excluded.
- [x] `apps/web/src/router.test.ts` -- tighten the registration assertion from `toBeTypeOf('function')` to identity, since `() => null` satisfies the weaker form and returns an unknown path to a blank page.
- [x] `apps/web/src/routes/index.tsx` -- carry `search` and `hash` through the redirect; dropping them makes a deep link's parameters unrecoverable.
- [x] `eslint.config.js` + `test/localization-guard.test.ts` -- the branch selectors match `Literal` only as a **direct** child of the outer conditional, so a template literal in a branch, a nested ternary, and every braced/template/branch form of an `option`/`optgroup`/`track` label all lint clean (verified). Accept `:matches(Literal, TemplateLiteral)` and allow the conditional to nest, while keeping the literal a direct branch child so `{cond ? t('a') : t('b')}` stays a false-positive-free negative control. Both polarities for every new shape, across all three probe paths.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- correct the "cosmetic only" claim about the v3→v4 mismatch to record semantic **renames** (`outline-none`, `shadow`), not just missing classes; note that both `--sidebar-primary` entries remain open by the append-only rule; add sourcemaps shipping full Croatian source to the CDN (a deploy decision), the still-absent `defaultErrorComponent`, `not-found.tsx` living in `routes/` rather than `components/`, the `CardTitle`-class duplication across both screens, and that story 1.3 must keep `/` rendering something once its `beforeLoad` becomes conditional.

**Acceptance Criteria:**
- Given a clean checkout, when `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` runs on Node 24.19.0, then every command exits 0 and no suite is skipped for want of a build
- Given the built `index.html`, when localization init is made to reject, then the static fallback remains visible, React does not mount, and no `⟦` placeholder is painted
- Given a `.tsx` under `apps/web` carrying a literal in a ternary, on a guarded attribute as a template literal, or as bare JSX text, when `pnpm lint` runs, then it exits non-zero naming L2
- Given a viewer whose system theme is dark, one whose is light, and one who has stamped an explicit choice, when each opens `/prijava`, then the palette resolves from the token layer and no theme toggle exists on any surface
- Given the rendering face, when the screen's strings are inspected, then **č ć ž š đ Č Ć Ž Đ Š** render from Geist without a mid-word fallback

## Spec Change Log

### 2026-09-04 — iteration 1, three adversarial layers

**Handling deviation, human-directed.** Six findings classified `bad_spec`, whose prescribed handling is revert-and-re-derive. The human directed **amend the spec, fix in place** instead: every finding is additive — missing assertions plus two token values — so a re-derive would regenerate near-identical code at full cost while risking the parts already proven. Recorded here because the deviation is the reason this log exists rather than a fresh implementation.

**Triggering findings.** Four mutations passed all 900 tests, each voiding a stated **Always** constraint: (1) `border-input` → `border-border` in `input.tsx` — the WCAG 1.4.11 raise measured a token nothing on screen consumed, which is precisely 1.1b's "theme defined but never applied" loopback in a new place; (2) rewriting the boot as `try`/`catch` — the app mounts on a failed init and paints `⟦auth.heading⟧` over every string, because the only assertion read source *wording* and cannot see polarity; (3) deleting all four `className="h-11"` — 44 px targets silently revert to the inherited 36 px on the one screen nobody can skip; (4) deleting the boot fallback without rebuilding — `index.html` and the two route files were absent from the freshness guard's `SOURCES`, so both new guards are silent in the ordinary state of a working tree. Two more: `--ring` (0.665) against the newly raised `--input` (0.65) measures **1.06:1**, so fixing one threshold broke the focus indicator on the same control; and the static fallback is visible from first paint, showing a false Croatian error on every slow load.

**What was amended.** Verification gained a mutation-proof list covering every **Always** constraint rather than five hand-picked ones — the omission that let all four through. Tasks gained: the boot decision extracted to an importable module so polarity is executed rather than read; a consumer-side assertion that the control's boundary draws from `--input`; a height floor assertion; `index.html` and both route files in `SOURCES`; a ring-versus-input contrast pair; and a forced-colors focus rule.

**Known-bad state avoided.** A green suite certifying an accessibility deliverable that no rendered pixel obeys, and a boot guard that survives the refactor it exists to prevent.

**KEEP — must survive any re-derivation.**
- `router.test.ts`'s companion assertion that `notFoundComponent` is *registered*. The spec's own mutation proof was unsatisfiable as written: `matchRoutes` reports `_notFound` from path resolution alone, so deleting the component left the suite green. The implementation caught the spec's error and closed it; do not lose it, and tighten it to identity rather than `toBeTypeOf('function')`.
- `method="post"` on the form. It was unspecified, and the reasoning is sound — the GET default would put a typed password in the URL, history and CDN log. Keep it and add the missing `preventDefault`; do not resolve this by reverting to GET.
- The occurrence-count shape of the authored-vocabulary sweep — counting each word in the chunk against its count in `hr.json` — which is a stronger claim than absence and the right re-derivation of 1.1c's tripwire. Widen it to every chunk; keep the counting idea.
- Four primitives inherited byte-verbatim, and the flat-shadow consequence disclosed rather than papered over. The v3→v4 class-name mismatch is now handled in our own CSS, not by re-inheriting.

## Design Notes

**Proposed Croatian copy — approve or amend at the checkpoint.** None of this is decided in any planning artifact, and no sign-in mockup exists; these strings become binding product vocabulary.

| Key | String | Why |
|---|---|---|
| `auth.heading` | `Prijava` | the screen's name |
| `auth.username` | `Korisničko ime` | identity is an admin-issued username, never an email (`ARCHITECTURE-SPINE.md:124-128`) |
| `auth.password` | `Lozinka` | |
| `auth.submit` | `Prijavi se` | informal singular, per `EXPERIENCE.md:79` |
| `auth.passwordReset` | `Zaboravljena lozinka? Administrator ti je postavlja novu.` | states the fact rather than hiding the affordance — self-service reset is impossible for these accounts. A question mark is fine; only `!` is banned |
| `notFound.heading` | `Stranica ne postoji` | states the fact, and avoids `Nema` so that word's absence assertion stays intact |
| `notFound.back` | `Vrati se na prijavu` | names where it goes; avoids `Danas`, which the navigation spec owns |
| `index.html` fallback | `Shift se nije pokrenuo. Osvježi stranicu.` | untranslated by necessity; carries no reserved word |

**Why the not-found component is not a route.** `router.test.ts:39-40` asserts an unknown path matches `['__root__']` with `_notFound === true`. A catch-all route satisfies the URL but inverts that assertion — the guard would pass while asserting the opposite of its purpose. `notFoundComponent` on the root route leaves both route ids and `matchRoutes` output untouched, which is why that one assertion must survive this story unedited.

**Why the boot fallback lives in HTML.** The failure being handled is the translation layer not starting, so the message cannot come from a key; and a literal in a `.tsx` would trip L2 or need this repo's first `eslint-disable`. Static markup inside `#root`, which `createRoot().render()` clears on a successful mount, is untranslated, needs no exception, and also covers a bundle that never loads at all.

**Why `useTranslation` is not introduced.** The ledger asks whether the provider reaches a component. With one locale, no language switch and module-level `t`, no surface depends on the React context — so there is nothing to assert, and the question dissolves rather than needing the jsdom test AD-15 forbids. The provider stays: it costs nothing, keeps L3's "a resource file and no component change" true, and `localization-applied.test.ts:128` pins it.

**Why only `--input` is raised.** WCAG 1.4.11 requires 3:1 where a boundary is a component's sole visual affordance — exactly a shadcn text input, whose fill matches the page. It says nothing about a decorative divider or a card edge, which is all `--border` does. Raising both would visibly heavy every surface in the interface for no accessibility gain, which is why the ledger parked the question rather than patching it.

## Verification

**Commands:**
- `nvm use` -- expected: Node 24.19.0. The shell default here is v20.20.2, which pnpm 11 rejects; nothing in the repo records this.
- `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- expected: exit 0, no skipped suites. Build must precede test.
- `TZ=Pacific/Kiritimati pnpm -C apps/web test` -- expected: exit 0, identical results
**Mutation proofs — one per stated invariant, not a hand-picked sample.** Each must fail, then be reverted. The five originally listed here missed four real gaps because they tested what the story *added* rather than what it *promised*; the rule is now that every **Always** constraint and every I/O matrix row carries one.

| Mutation | Must fail because |
|---|---|
| delete `notFoundComponent` from the root route | an unknown path renders an empty shell at 200 |
| set `notFoundComponent: () => null` | identity, not merely "a function", is what makes it a screen |
| `border-input` → `border-border` in `input.tsx` | the raised token must be the one the control draws |
| delete every `className="h-11"` | 44 px is an Always constraint |
| rewrite the boot as `try`/`catch` without the flag | polarity must be executed, not read as source text |
| `initLocalization` throws synchronously rather than rejecting | both failure shapes must suppress the mount |
| remove the `index.html` fallback, **without rebuilding** | freshness must cover `index.html` and both route files |
| replace one `t()` call with its literal | L2 at source and in the chunk |
| hard-code an authored word behind an identifier in `card.tsx` | the sweep must read every chunk, not the entry alone |
| revert `--input` to stock | ≥3:1 against its surface |
| move `--ring` to within 3:1 of `--input` | adjacent affordances must stay distinguishable |
| drop the `preventDefault` from the form | the screen must stay inert |
| widen a `t()` argument to a template literal in a ternary branch | the L2 branch selectors must see both node types at any nesting depth |

**Manual checks:**
- `/prijava` at 390 px and 1280 px in both system themes: no horizontal scroll, focus visible on both fields and the button, the input boundary discernible against the page, diacritics intact in `Korisničko` and `Osvježi`.
- `/` redirects; a typo path renders the not-found component rather than a blank shell.

## Suggested Review Order

**The screen, and why it is inert**

- The whole design intent in one file: real form, zero behaviour, 1.3's seam.
  [`prijava.tsx:53`](../../apps/web/src/routes/prijava.tsx#L53)

- `preventDefault` with `method="post"` kept: a POST to a static host is a 405 that eats the input.
  [`prijava.tsx:53`](../../apps/web/src/routes/prijava.tsx#L53)

- The reset guidance reachable in tab order rather than stranded after the button.
  [`prijava.tsx:83`](../../apps/web/src/routes/prijava.tsx#L83)

- An admin-issued username is not an email; mobile must not capitalize or correct it.
  [`prijava.tsx:70`](../../apps/web/src/routes/prijava.tsx#L70)

**The boot decision — the story's headline failure mode**

- Extracted so a node test can execute the polarity instead of reading source words.
  [`boot.ts:26`](../../apps/web/src/i18n/boot.ts#L26)

- `await` inside `try`: a synchronous throw escapes `.then(ok, bad)` entirely.
  [`boot.ts:26`](../../apps/web/src/i18n/boot.ts#L26)

- All `main.tsx` keeps is the branch; on false the static fallback stays on screen.
  [`main.tsx:31`](../../apps/web/src/main.tsx#L31)

- Reject, resolve and sync-throw each asserted — the mutation that shipped green before.
  [`boot.test.ts:46`](../../apps/web/src/i18n/boot.test.ts#L46)

**Never a blank page at HTTP 200**

- `notFoundComponent` on the root route: decides an unknown path without adding one.
  [`__root.tsx:28`](../../apps/web/src/routes/__root.tsx#L28)

- Identity, not `toBeTypeOf('function')` — `() => null` satisfied the weaker form.
  [`router.test.ts:80`](../../apps/web/src/router.test.ts#L80)

- The deployed root is a screen, and search/hash survive the hop.
  [`index.tsx:31`](../../apps/web/src/routes/index.tsx#L31)

- Delayed reveal, so a slow load no longer shows a false error telling you to refresh.
  [`index.html:29`](../../apps/web/index.html#L29)

**Contrast: fixing one threshold broke another**

- `--ring` moved because the raised `--input` left it at 1.06:1 against the border it abuts.
  [`index.css:96`](../../apps/web/src/index.css#L96)

- Light goes darker, not lighter: above a 0.65 border, 3:1 needs L 0.974 — invisible on white.
  [`index.css:154`](../../apps/web/src/index.css#L154)

- v4's `outline-none` removed the forced-colors focus indicator; our own rule restores it.
  [`index.css:295`](../../apps/web/src/index.css#L295)

- The pair that would have caught this at authoring time.
  [`theme-contrast.test.ts:171`](../../test/theme-contrast.test.ts#L171)

**Proof the invariants can actually fail**

- Source-side is load-bearing: the built sheet cannot say which component draws a boundary.
  [`prijava.test.ts:27`](../../apps/web/src/routes/prijava.test.ts#L27)

- 44 px asserted with a self-tested detector; deleting every `h-11` was green before.
  [`prijava.test.ts:192`](../../apps/web/src/routes/prijava.test.ts#L192)

- `index.html` and both route files added to `SOURCES` — the gap that made two guards silent.
  [`localization-applied.test.ts:48`](../../test/localization-applied.test.ts#L48)

- Every chunk swept, not the entry alone, with the `.js.map` exclusion reasoned out.
  [`localization-applied.test.ts:92`](../../test/localization-applied.test.ts#L92)

- The consumer-side half, weaker by necessity and honest about why.
  [`theme-applied.test.ts:92`](../../test/theme-applied.test.ts#L92)

**The merge-blocking L2 guard, widened**

- Composed from named fragments: three string forms × three positions, direct and nested.
  [`eslint.config.js:57`](../../eslint.config.js#L57)

- The literal stays a direct branch child, so `{cond ? t('a') : t('b')}` stays clean.
  [`eslint.config.js:161`](../../eslint.config.js#L161)
