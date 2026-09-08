---
title: 'Story 1.3b — The SPA sign-in path'
type: 'feature'
created: '2026-09-07'
status: 'done'
review_loop_iteration: 2
baseline_commit: 'fe2596fadeea2dd65a25227c8c98ee72ad096aa9'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.3's first acceptance clause — a member with no email address signs in with an admin-issued username — is entirely unbuilt. 1.3a made the database enforce isolation and role, but nothing reaches it: `prijava.tsx` renders a form whose only handler is `preventDefault()`, `apps/web/src/supabase/` holds a README and no client, `@supabase/supabase-js` appears in no manifest and zero times in `pnpm-lock.yaml`, and `/` redirects unconditionally to `/prijava`, so there is no signed-in destination to land on.

**Approach:** Add the browser Supabase client and an address module that turns a username plus an organization slug into AD-12's synthesized address. Move the existing two-field credential form to a per-tenant route `/prijava/$slug` so the slug is in scope without changing the frozen form, give bare `/prijava` a one-field organization prompt that navigates on, and make `/`'s `beforeLoad` session-conditional with a minimal signed-in placeholder. Every assertion this breaks is narrowed to the new truth, never deleted.

## Boundaries & Constraints

**Always:**
- The credential form keeps **exactly** its two frozen fields. The organization reaches it through the URL, never a third input (human decision, 2026-09-07).
- The address is `username + '@' + slug + '.shift.invalid'` (AD-12), built in `apps/web/src/supabase/`, never in a `.tsx` and never in `packages/domain`. `prijava.test.ts:127-151` makes every non-import literal in a screen an offence, and `eslint.config.js:253` plus `packages/domain/test/purity.test.ts` forbid the other home.
- `@supabase/supabase-js` is pinned at exactly `2.113.0`, matching the Edge Function's Deno specifier (`admin-auth/index.ts:44`) and the architecture spine's stack list.
- The client is constructed from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` only (AD-17). Both are already declared and typed non-optional; this story adds the runtime absence check, not a new variable.
- **Both** branches of `/`'s `beforeLoad` resolve — one throws a redirect, the other renders a component. `index.tsx:21-25` names a conditional that falls through as the blank page 1.1d removed. `search: true` and `hash: true` survive on the redirecting branch.
- A refused sign-in and a deactivated account produce the **same** message. Distinguishing them tells an anonymous caller which usernames exist.
- New keys are added to `SANCTIONED_SCREEN_KEYS` (`resource-hygiene.test.ts:42-50`) in the same commit — that list is an equality assertion. Messages are ICU single-brace, carry no `!`, no `smjen`, and an en dash for any range.
- Every new `.tsx` carrying strings joins `SCREENS` (`prijava.test.ts:49-52`) and `SOURCES` (`localization-applied.test.ts:48-57`), or it is swept by nothing and fails the freshness guard respectively.
- Assertions this story invalidates are **narrowed to the new truth**, never deleted, and each is a review moment.

**Ask First:**
- Any npm dependency other than `@supabase/supabase-js@2.113.0`.
- Adding a second Edge Function, or touching `admin-auth`, whose 501 path is pinned in three places.
- Persisting a session anywhere other than the client library's own default storage.
- Any anonymous read path, RPC or view that resolves a username or enumerates organizations.

**Never:**
- No jsdom, no `.tsx` test, no rendered component (AD-15). Correctness is asserted at source and data level only.
- No third field on the credential form; no globally-unique usernames; no anonymous username-resolution RPC. All three were considered and refused on 2026-09-07.
- No navigation shell, no sign-out affordance — `Odjava` stays reserved and the shell stays deferred.
- No `destructive` on any screen (UX-DR4 reserves it for an unresolved conflict).
- No secret key, and no database write outside PostgREST.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid credentials | `/prijava/dvd-kastel-novi`, correct username and password | Session established; navigation to `/`, which renders the signed-in placeholder | N/A |
| Wrong password | Correct username, wrong password | Stays on the screen, both entered values kept, one refusal message | Mapped, not raw |
| Unknown username | A username no member holds | **Identical** message and shape to the wrong-password case | Mapped, not raw |
| Deactivated account | `banned_until` in the future | Identical message again — no third shape | Mapped, not raw |
| Network or service failure | Auth endpoint unreachable | A distinct "try again" message, entered values kept | Mapped, not raw |
| Unknown slug | `/prijava/no-such-org` | The form renders; sign-in fails with the standard refusal, disclosing nothing about the slug | Mapped, not raw |
| Bare `/prijava` | No slug in the URL | One-field organization prompt; submitting navigates to `/prijava/<slug>` | Empty input refused inertly |
| `/` while signed out | No session | Redirect to `/prijava`, carrying search and hash | N/A |
| `/` while signed in | Session present | The signed-in placeholder renders; no redirect | N/A |
| Missing environment | `VITE_SUPABASE_URL` or the key absent at runtime | Fails fast and loudly at client construction, never a silent unauthenticated client | Throws a stable code |

</frozen-after-approval>

## Code Map

**Baseline `fe2596fadeea2dd65a25227c8c98ee72ad096aa9`**, green: 939 root tests plus 172 web and 4 domain. `nvm use` first (Node 24.19.0). `pnpm test` never builds, and `localization-applied.test.ts` **fails** rather than skips on a stale build — so `pnpm build` before `pnpm test` whenever a source in `SOURCES` or `hr.json` changes.

### Routing

- `apps/web/src/router.ts:7` — `rootRoute.addChildren([indexRoute, prijavaRoute])`, code-based, no generated tree. A new route is a file exporting `createRoute({ getParentRoute: () => rootRoute, path, component })` plus an import and an entry here.
- `apps/web/src/routes/index.tsx:27-33` — `/`, `beforeLoad` takes **no argument** today and throws unconditionally; no `component` by design. `:21-25` is the comment authorising exactly this story's change and naming the invariant: no branch may end with neither a redirect nor a component.
- `apps/web/src/routes/prijava.tsx:106-110` — `prijavaRoute` at `/prijava` rendering `SignInScreen`. The form is `:51-57`; the only seam is its inline `onSubmit`.
- `apps/web/src/routes/__root.tsx:26-29` — root with `notFoundComponent: NotFoundScreen`. Do not add a `/$` route; `router.test.ts:96-102` forbids it and `:66-71` depends on its absence.
- `apps/web/src/supabase/README.md` — exists, specifies the client's two inputs. No client module yet.

### Assertions this story must change — each an intended review moment

- `router.test.ts:29-34` — exhaustive `routesById` equals `['/', '/prijava', '__root__']`. Extend, do not relax.
- `router.test.ts:44-54` — pins `prijavaRoute.options.component === SignInScreen` **by identity**. `/prijava` becomes the organization prompt, so this splits into two identity assertions.
- `router.test.ts:113-132` — the `beforeLoad()` helper invokes `run?.({})`, an empty object as the entire context, and asserts it **always** throws. A session-aware `beforeLoad` must either tolerate that shape or the helper gains a context parameter; then `:127`, `:134` and `:138` each split into a signed-out and a signed-in case.
- `router.test.ts:148-150` — `/` registers **no** component. Invert to an identity assertion on the placeholder; `toBeDefined` would lose the mutation resistance.
- `prijava.test.ts:420-452` — the whole "inert until story 1.3 wires it" block, including the forbidden-token sweep over `supabase`, `fetch(`, `useState`, `localStorage`. It is self-labelled for this story. Replace with the inverse claim — that the screen reaches the auth seam — rather than renaming state hooks to evade the tokens.
- `prijava.test.ts:434-440` — the `onSubmit` regex requires a non-async inline arrow whose body contains no `}`. Any real handler fails it. Replace with an assertion about the real handler.
- `prijava.test.ts:242-247` — exact key counts, and `:250-267` — rendered set equals declared set. `used()` at `:251` is sorted but **not deduped**, so a key rendered at two call sites fails even when the sets match.
- `prijava.test.ts:367-381` — `aria-describedby` is read as a single value by `attributeOf`, which matches `name="…"` only. A token list fails the id lookup; a `{expression}` value returns `null` and fails harder.
- `resource-hygiene.test.ts:180-189` — `organizacija` is reserved. `:176-179` records the precedent: 1.1d removed `prijava` and `lozinka` on earning them. This story earns `organizacija` the same way.
- `localization-applied.test.ts:303-318` — `Organizacija` is asserted **absent** from every chunk, as a plain substring so inflections trip too. Move it into `AUTHORED_VOCABULARY` (`:293-299`), which holds an exact-count equality instead. `Nema` and `Odjava` stay banned.

### Must stay green, untouched

- `prijava.test.ts:280-302` — the 44 px floor on both inputs and the button, mutation-proven. Keep `className` first on `<Button>`: `buttonElements` at `:177` captures `[^>]*?`, so an arrow function in an earlier attribute truncates the match and silently voids the height check.
- `prijava.test.ts:454-460` — `destructive` appears in no screen, comments included.
- `prijava.test.ts:332-365`, `:383-417` — label binding, `autoComplete` values, masking, `spellCheck={false}`.
- `router.test.ts:66-71` (`_notFound`), `:96-102` (no `/$`).
- `localization-applied.test.ts:225-258` — `main.tsx` must still gate `createRoot` behind `await bootLocalization(initLocalization)` with no `catch`.

### Gates a new string clears

Three, in the same commit: `resource-hygiene.test.ts:100` (equality over the sanctioned list), `prijava.test.ts:245`/`:257-259` (counts and set equality), and the voice rules at `resource-hygiene.test.ts:141-199`. ICU is single-brace `{name}`; a missing interpolation value degrades the **whole** message to `⟦key⟧` rather than rendering partially. `i18n/index.ts:100-106` types the resource tree, so a key that is not in `hr.json` is a `pnpm typecheck` failure.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/package.json` — add `@supabase/supabase-js` pinned to `2.113.0`; `pnpm install` to update the lockfile.
- [x] `apps/web/src/supabase/client.ts` — the single browser client from the two `VITE_*` variables, failing fast with a stable `SCREAMING_SNAKE` code when either is absent. No secret key path.
- [x] `apps/web/src/supabase/address.ts` — `username + '@' + slug + '.shift.invalid'`, plus slug validation matching `0002`'s DNS-label check. Pure, no client import, so it is unit-testable.
- [x] `apps/web/src/supabase/sign-in.ts` — exchange credentials for a session and map every outcome to a stable code. Refused credentials, an unknown username and a banned account collapse to **one** code; transport failure is a second.
- [x] `apps/web/src/supabase/*.test.ts` — the I/O matrix's mapping rows, executed. Assert the collapse explicitly: three distinct upstream failures, one code out.
- [x] `apps/web/src/routes/prijava.tsx` — move to `/prijava/$slug`, read the slug from params, wire the real handler through the modules above, render one error message. Keep both fields, `h-11` on all three controls, `className` first on `<Button>`, and no literal that is not an import.
- [x] `apps/web/src/routes/prijava-organizacija.tsx` — the one-field organization prompt at bare `/prijava`, navigating to `/prijava/$slug`.
- [x] `apps/web/src/routes/index.tsx` — session-conditional `beforeLoad` where both branches resolve, plus the signed-in placeholder component. No navigation shell.
- [x] `apps/web/src/router.ts` — register both routes.
- [x] `apps/web/src/i18n/locales/hr.json` — the six new keys, verbatim from **Proposed copy** below. Author them exactly; each was checked against all three gates.
- [x] `test/resource-hygiene.test.ts` — extend `SANCTIONED_SCREEN_KEYS`; remove `organizacija` from the reserved list with a comment recording that this story earned it, in the shape of `:176-179`.
- [x] `test/localization-applied.test.ts` — move `Organizacija` from `NAVIGATION_AND_TERMINOLOGY` to `AUTHORED_VOCABULARY`; add both new `.tsx` files to `SOURCES`.
- [x] `apps/web/src/routes/prijava.test.ts` — add the new screens to `SCREENS`; narrow the frozen-boundary block to the inverse claim; replace the `onSubmit` regex; dedupe `used()`; teach `aria-describedby` about a token list. Extend the detector self-tests for every matcher loosened.
- [x] `apps/web/src/router.test.ts` — extend `routesById`; split the component-identity, redirect and `search`/`hash` assertions into signed-out and signed-in cases; give the `beforeLoad` helper a context parameter.

- [x] `apps/web/src/supabase/address.ts` — added `organizationDestination`, extracting the prompt's normalize-and-guard decision out of the `.tsx` so it is executed rather than regexed, on the `i18n/boot.ts` precedent. Closed a matrix-audit failure: row "Bare `/prijava`" had no covering test, because the screen cannot be rendered. Mutation-proven — bypassing the guard turns 8 cases red.
- [x] `test/key-hygiene.test.ts` — NOT anticipated by this spec. `@supabase/supabase-js` puts the literal `sb_secret_` in the bundle as its own key-shape check, which the bare `includes` read as a leak. Narrowed to the pre-existing `PLAUSIBLE_KEY` (prefix + 20 key characters, the standard the repo-wide committed scan already uses) and paired with a new assertion that every occurrence carries no trailing key material. Verified: the prefix appears exactly once in the chunks, followed by nothing.

**Acceptance Criteria:**
- Given the local stack and a seeded fixture, when a member with no email address signs in at `/prijava/<slug>` with their username and password, then a session is established and `/` renders the signed-in placeholder.
- Given a wrong password, an unknown username and a deactivated account, when each is attempted, then all three produce the identical message and the entered values remain.
- Given `nvm use && pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test`, when all run with the stack up, then each exits 0, no suite is skipped, and the test count exceeds the 939 + 172 + 4 baseline.
- Given the built chunk, when the vocabulary sweep runs, then `Nema` and `Odjava` are still absent and `Organizacija`'s count matches the resource file exactly.

### Review Findings

Code review of `fe2596f..9107896`, 2026-09-08. Four layers: blind-hunter,
edge-case-hunter, verification-gap, acceptance-auditor. Gate verified green
before review: 946 root / 315 web / 4 domain, 0 skipped, lint and typecheck clean.

- [x] [Review][Decision — RESOLVED 2026-09-08: redirect to `/prijava`] A malformed slug in the URL refuses every correct credential, forever — `/prijava/under_score` renders the form, `organizationDestination` returns `null`, and `signIn` refuses locally with the wrong-password message on every attempt. Normalization closed the capital-letter case the spec's "Known-bad state avoided" names; the malformed case still reaches it. Two defensible readings: (a) `beforeLoad` redirects a slug that cannot be one to `/prijava`, matching the organization prompt's own inert-refusal philosophy; (b) leave it, because refusing identically regardless of slug shape IS the anti-enumeration posture the module argues for. [apps/web/src/routes/prijava.tsx:215, apps/web/src/supabase/sign-in.ts:141]

- [x] [Review][Patch] The organization prompt's navigation destination is pinned by nothing [apps/web/src/routes/prijava-organizacija.tsx:55]
- [x] [Review][Patch] The post-sign-in landing `navigate({ to: '/' })` is pinned by nothing [apps/web/src/routes/prijava.tsx:102]
- [x] [Review][Patch] The in-flight test cannot observe what the `finally` block does [apps/web/src/routes/prijava.test.ts:812]
- [x] [Review][Patch] Every `SUPABASE_ENVIRONMENT_MISSING` throw is swallowed with no log, and two comments claim otherwise [apps/web/src/routes/prijava.tsx:103, apps/web/src/routes/index.tsx:60]
- [x] [Review][Patch] No runtime guard that the publishable key is publishable [apps/web/src/supabase/client.ts:91]
- [x] [Review][Patch] The relaxed bundle scan and its compensating assertion cover different file sets [test/key-hygiene.test.ts:281]
- [x] [Review][Patch] `sign-in.ts` owns two message keys but is absent from the `SOURCES` freshness guard [test/localization-applied.test.ts:48]
- [x] [Review][Patch] `createClient`'s argument order is asserted by nothing [apps/web/src/supabase/client.test.ts]
- [x] [Review][Patch] Neither credential field carries `required`, while the sibling screen's field does [apps/web/src/routes/prijava.tsx:144]
- [x] [Review][Patch] `autoComplete="organization"` asks the browser for the organization's name, not its slug [apps/web/src/routes/prijava-organizacija.tsx:75]
- [x] [Review][Patch] `DEPLOY.md` documents neither `SUPABASE_ENVIRONMENT_MISSING` nor the new URL-shape requirement [DEPLOY.md:162]
- [x] [Review][Patch] Story status metadata is inconsistent three ways [_bmad-output/implementation-artifacts/spec-1-3b-spa-sign-in-path.md:5]
- [x] [Review][Patch] `void navigate(...)` discards a rejection in the organization prompt [apps/web/src/routes/prijava-organizacija.tsx:55]
- [x] [Review][Patch] `KEY_MATERIAL_LENGTH` is a derived constant with no self-test, in the file that self-tests every other detector [test/key-hygiene.test.ts:50]
- [x] [Review][Patch] The generalized tap-target sweep asserts nothing when it finds no controls [apps/web/src/routes/prijava.test.ts]
- [x] [Review][Patch] The `onSubmit` replacement matcher got no self-test and carries an unasserted 160-character window [apps/web/src/routes/prijava.test.ts:777]
- [x] [Review][Patch] `stripTypeArguments` over-consumes JSX and the failing polarity is untested [apps/web/src/routes/prijava.test.ts:264]
- [x] [Review][Patch] `README.md` describes a generated database-types file that does not exist [apps/web/src/supabase/README.md:3]
- [x] [Review][Patch] `organizationDestination`'s doc describes only its navigation caller, not the auth one [apps/web/src/supabase/address.ts:70]

- [x] [Review][Defer] Neither sign-in route redirects an already-signed-in visitor [apps/web/src/routes/prijava.tsx:215] — deferred, belongs with the navigation shell that introduces sign-out
- [x] [Review][Defer] `STRUCTURAL_EXPRESSION` exempts every present and future structural attribute in expression form [apps/web/src/routes/prijava.test.ts:160] — deferred, design judgement, no current defect
- [x] [Review][Defer] The `SESSION` test fixture is declared verbatim in three files [apps/web/src/router.test.ts] — deferred, pre-existing shape
- [x] [Review][Defer] `client.test.ts` constructs a real client with auto-refresh timers in the node suite [apps/web/src/supabase/client.test.ts] — deferred, pairs with the open client-options ledger entry
- [x] [Review][Defer] `iceberg-js@0.8.1` entered the browser bundle's dependency graph transitively [pnpm-lock.yaml] — deferred, falsifies the spec's "and nothing else" expectation

**Outcome.** All 20 patches applied and all 5 defers ledgered. The decision was
resolved in favour of the redirect and implemented as `prijavaRoute.beforeLoad`.

Gate after the patches: **948 root / 338 web / 4 domain, 0 skipped**, `pnpm build`,
`pnpm lint` and `pnpm typecheck` all clean — up from 946 / 315 / 4 before review.

Seven mutations were run against the new assertions to prove they observe what
they claim, each reverted after: post-sign-in `navigate({ to: '/' })` → `/prijava`;
`setPending(false)` deleted from the `finally`; the organization prompt's
`params: { slug }` hard-coded to one tenant; the catch's `console.error` removed;
the malformed-slug guard neutered to `if (false)`; `createClient`'s two arguments
swapped; and the publishable-key prefix check deleted. Every one of the seven
passed the suite before this review and fails it now.

## Spec Change Log

### 2026-09-08 — iteration 1, three adversarial layers, no loopback

**Triage deviation, recorded deliberately.** Four findings share a spec-level root cause, which normally routes to `bad_spec` and a revert-and-re-derive: this spec permitted **source-text assertions where the repository's own extraction precedent allowed executed ones**. The session-reader binding in `router.ts`, `buildEnvironment`, the failure-to-message ternary and the slug-to-`signIn` flow were each pinned only by reading the file as a string, and each survives a mutation that breaks the product. The spec's Code Map named `boot.ts` as the precedent for extracting a decision out of an unrenderable `.tsx` but never made it a constraint, so the implementer applied it in one place and not four.

They were routed to `patch` instead. The reasoning: every fix is additive and local, the architecture the spec asked for held up under all three layers (an injected auth client, decisions extracted to executable modules), and the diff had been driven in a real browser — a re-derive would have discarded that verification along with a genuine bug the implementer found by hand, in which both credential refs were declared but never attached, leaving the button inert with the whole suite green. Re-deriving 2233 lines to reach a set of mechanical extractions was disproportionate to the defect.

**KEEP — must survive any re-derivation.**
- `signIn(auth, credentials)` taking the auth client as a parameter rather than importing it. This is what puts the entire refusal matrix in the node suite despite AD-15 banning jsdom, and it is the shape every later data module should copy.
- The router context holding a session **reader**, not a session value. A snapshot is stale at exactly the moment sign-in navigates to `/`, and a client imported by the route makes the signed-in branch unassertable.
- Collapsing wrong password, unknown username and banned account into one outcome, with a test that compares the three results to **each other** rather than to a constant. That comparison is what stops a later added operand from quietly reopening the enumeration oracle.
- Extracting a decision out of a `.tsx` whenever one exists — `organizationDestination` and `boot.ts` are the two instances. A `.tsx` is collected by nothing, so a decision left inside one can only ever be regexed, and a regex cannot tell a guard that runs from a guard that was written and then bypassed.
- Narrowing a forbidden-token sweep to what must still never appear rather than deleting it. The frozen-boundary block dropped `supabase` and `useState`, which this story legitimises, and kept `fetch(`, `localStorage` and `createClient(` while adding `shift.invalid`.

**Known-bad state avoided.** A signed-in user bouncing endlessly between `/` and the sign-in form; a correctly configured deployment throwing `SUPABASE_ENVIRONMENT_MISSING` on every request from a single mistyped `import.meta.env` member; a wrong password reporting a service outage while an outage reported wrong credentials; `Ivan.Maric` and ` ivan.maric ` refused as bad credentials with no way for the user to discover why; a per-tenant URL carrying a capital letter refusing every correct credential forever; and `/` resolving to neither a redirect nor a component on a third path nobody enumerated.

## Design Notes

**Proposed copy.** Human-authored wording is UX-DR34's; these are drafted against the gates and are the human's to correct at approval.

| Key | Croatian | Why it clears the gates |
|-----|----------|-------------------------|
| `auth.organization.heading` | `Organizacija` | The exact capitalized standalone word, which `AUTHORED_VOCABULARY`'s equality assertion **requires** to exist in `hr.json` once it moves out of the absent list. |
| `auth.organization.label` | `Kratica organizacije` | `organizacije` is not the substring `organizacija`, so it clears the reserved sweep independently, and `wordOccurrences` is case-sensitive and word-bounded so it adds nothing to the `Organizacija` count. |
| `auth.organization.submit` | `Nastavi` | Neutral; touches no reserved word. |
| `auth.error.credentials` | `Korisničko ime ili lozinka nisu točni.` | Adds a second `Korisničko` to `hr.json` and to the chunk, so the counts still match. `lozinka` is lowercase and does not match capitalized `Lozinka`. No `!`. |
| `auth.error.unavailable` | `Prijava trenutačno nije moguća. Pokušaj ponovno.` | Adds a second `Prijava` on both sides, so the equality holds. States the problem, no exclamation, no blame. |
| `home.heading` | `Uspješna prijava` | Lowercase `prijava` matches neither `Prijava` nor `Prijavi`, so no count moves. Ungendered, unlike `Prijavljen si`. |

None contains `Nema`, `Odjava`, `smjen`, an exclamation mark, or a hyphen range. The placeholder heading is explicitly temporary — the navigation shell replaces it.

**Why the slug rides in the URL.** At the moment of sign-in there is no session, so there is no organization in scope — but the address AD-12 requires is namespaced by the organization's slug. Three ways out were weighed on 2026-09-07: globally-unique usernames (loses per-tenant namespacing and rewrites every issued address), a third form field (changes 1.1d's frozen form and its assertions), and an anonymous username-resolution RPC (an enumeration oracle exposed to `anon`). The URL was chosen because it changes neither the form nor the security surface. Bare `/prijava` needs the prompt because three places have no slug in scope: `/`'s redirect target, a typed `/prijava`, and `not-found.tsx:27`.

**Why all three refusals collapse to one message.** The screen is reachable by anyone. If "no such user" differed from "wrong password", the form would answer the question "does this username exist in this organization?" for an unauthenticated caller — the same enumeration oracle the RPC option was rejected for. The cost is a less specific message for a legitimate typo, which UX-DR34's "state the problem, keep every entered value" tolerates.

**Why the error surface cannot use `destructive`.** UX-DR4 reserves it exclusively for an unresolved conflict, and `theme-contrast.test.ts` measures it only against shift fills — so there is no contrast evidence for it on a form. The signal has to be built from tokens that do have it.

## Verification

**Commands:**
- `nvm use` — expected: Node 24.19.0.
- `pnpm install` — expected: the lockfile gains `@supabase/supabase-js@2.113.0` and nothing else.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — expected: all exit 0, no skipped suite while the stack is up, counts above baseline. Build **before** test.
- `pnpm dev`, then sign in as `ivan.maric` at `/prijava/dvd-kastel-novi` with `local-fixture-password` — expected: lands on `/` with the placeholder. Repeat with a wrong password and with `no-such-user` — expected: the identical message both times.

**Manual checks:**
- With the network offline, attempt a sign-in — expected: the transport message, not the refusal message, and both entered values still present.

## Suggested Review Order

**The security claim, and the shape that makes it testable**

- Start here: three upstream failures collapse to one code, so the form is not an enumeration oracle.
  [`sign-in.ts:33`](../../apps/web/src/supabase/sign-in.ts#L33)

- The assertion that keeps it honest — the three outcomes compared to *each other*, not to a constant.
  [`sign-in.test.ts:108`](../../apps/web/src/supabase/sign-in.test.ts#L108)

- The auth client arrives as a parameter, which is what puts the whole matrix in the node suite under AD-15.
  [`sign-in.ts:135`](../../apps/web/src/supabase/sign-in.ts#L135)

**Decisions extracted out of unrenderable `.tsx`, so they execute rather than get regexed**

- The message mapping; inside the screen, swapping its branches passed everything.
  [`sign-in.ts:55`](../../apps/web/src/supabase/sign-in.ts#L55)

- The prompt's normalize-and-guard, extracted on the `i18n/boot.ts` precedent.
  [`address.ts:70`](../../apps/web/src/supabase/address.ts#L70)

- Username normalization: the half that was raw while the slug half was trimmed and lowercased.
  [`address.ts:99`](../../apps/web/src/supabase/address.ts#L99)

- AD-12's address, with both halves now checked rather than interpolated.
  [`address.ts:122`](../../apps/web/src/supabase/address.ts#L122)

**The session reader, and why it is a reader and not a value**

- A snapshot would be stale at exactly the moment sign-in navigates to `/`.
  [`client.ts:151`](../../apps/web/src/supabase/client.ts#L151)

- The single bound instance the router names — mutating this was green until the assertion below existed.
  [`client.ts:162`](../../apps/web/src/supabase/client.ts#L162)

- The context type: a reader, so a route never reaches for a client and both branches stay assertable.
  [`__root.tsx:31`](../../apps/web/src/routes/__root.tsx#L31)

- Pins the real binding by identity. This is the gap that let an endless redirect loop ship green.
  [`router.test.ts:256`](../../apps/web/src/router.test.ts#L256)

**`/` resolves three ways and is never blank**

- Signed in returns, signed out redirects, and a reader that rejects fails closed rather than falling through.
  [`index.tsx:43`](../../apps/web/src/routes/index.tsx#L43)

- The placeholder that makes the signed-in branch renderable; the navigation shell stays deferred.
  [`index.tsx:32`](../../apps/web/src/routes/index.tsx#L32)

**The two screens**

- The slug comes from the URL, so the frozen two-field form never grew a third input.
  [`prijava.tsx:61`](../../apps/web/src/routes/prijava.tsx#L61)

- The handler: normalizes, maps, clears in-flight on every path, and surfaces a rejection instead of dying.
  [`prijava.tsx:75`](../../apps/web/src/routes/prijava.tsx#L75)

- The one-field prompt bare `/prijava` needed, because three places have no slug in scope.
  [`prijava-organizacija.tsx:38`](../../apps/web/src/routes/prijava-organizacija.tsx#L38)

**Environment and key containment**

- Reads exactly the two AD-17 variables, and fails fast on an absent or unparseable one.
  [`client.ts:91`](../../apps/web/src/supabase/client.ts#L91)

- The narrowed bundle scan: `sb_secret_` is now vendored as a shape check, so a key VALUE is the claim.
  [`key-hygiene.test.ts:260`](../../test/key-hygiene.test.ts#L260)

**Sweeps generalized across screens**

- The wiring guards run over every form screen; scoped to one, the prompt's missing ref was invisible.
  [`prijava.test.ts:777`](../../apps/web/src/routes/prijava.test.ts#L777)

- `organizacija` earned off the reserved list, in the shape 1.1d used for `prijava` and `lozinka`.
  [`resource-hygiene.test.ts:180`](../../test/resource-hygiene.test.ts#L180)
