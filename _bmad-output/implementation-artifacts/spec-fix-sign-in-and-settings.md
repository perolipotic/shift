---
title: 'Sign-in keeps the deep link and the keyboard position, and organization settings name the refused field, show their loading shape and offer a retry'
type: 'bugfix'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '2f85a699f7b8e81ecd553e1e866abde2f30ca6a2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The deferred-work triage on 2026-09-27 put six entries still open on main into "package 3b".
1. **Deep link lost** ("The deep-link search and hash are preserved for exactly one hop and then lost, and the bounced visitor also loses the organization they were on"; its duplicate is the signed-out redirect entry from nav-shell-a). A signed-out visitor to `/kalendar?x#y` ends up on `/` after sign-in, not back on `/kalendar?x#y`.
2. **Focus drops on submit** ("No focus management or busy state around a refused sign-in, and `disabled={pending}` drops keyboard focus to `<body>` mid-flow").
3. **Refused field not named** ("A refused value is never attributed to the field that caused it…", organization settings). No input carries `aria-invalid`, although PostgREST returns the constraint name, from which the column can be derived.
4. **Skeleton is one bar** ("The loading skeleton is a single 44px bar standing in for a five-field form, with no `aria-busy`…").
5. **No retry** ("There is no retry affordance on the read-failure path, although the message tells the person to try again", organization settings).
6. **Invalidation failure reported as refusal** ("`invalidateQueries` rejecting after a successful write reports that write as a refusal, in `submit` and `uploadLogo`…").

**Approach:**
- **Deep link:** the signed-out redirect carries the intended in-app location (path, search, hash) through `/prijava` and `/prijava/$slug`, and a successful sign-in navigates there.
  - Validate it strictly as a same-app relative path: no scheme, no `//`, no backslash, and a known route. Anything else falls back to `/`, so this adds no open redirect.
  - Keep the organization slug when the visitor came from `/prijava/$slug`.
- **Focus:** while pending, the submit button stays focusable, using `aria-disabled` plus a guard in the handler instead of `disabled`, or focus is kept by an equivalent mechanism. On refusal, focus moves to the refusal message or to the named field, following the pattern the member screens already use.
- **Refused field:** map the check-constraint name to its field and set `aria-invalid` on that input, with focus there. When the constraint cannot be mapped, keep the current general message and mark nothing.
- **Skeleton:** reserve the form's shape (one placeholder per field row) and add `aria-busy="true"` on the region, plus an accessible loading label drawn from an existing i18n key, if one exists.
- **Retry:** on a read failure, show a retry button that calls `refetch`. Use an existing i18n key for its label. If none fits, stop and ask (Ask First).
- **Invalidation after write:** move the invalidation out of the write's `try` in `submit` and `uploadLogo`, as part C did on the accent path. A rejected invalidation must never report a successful write as refused.

## Boundaries & Constraints

**Always:**
- **Tests:**
  - A unit test for the deep-link validator, covering good paths and every rejected shape: absolute URL, `//evil`, `/\evil`, `javascript:`, an unknown path.
  - E2E: a signed-out deep link to `/kalendar` with a search param lands back there after sign-in.
  - Unit or source tests for the constraint-to-field map and for the invalidation-outside-try shape.
  - E2E or a unit-level check for the focus kept on a pending submit and moved on refusal, where it can be driven.
- Mutation-prove every new test.
- Remove the deferred-work entries this closes, including the duplicate.

**Ask First:**
- Any new i18n text.
- Any change to how `/` or `_app` resolve sessions beyond carrying the location.

**Never:**
- No change to write services, SQL, or auth configuration.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/index.tsx`, `_app.tsx`, `prijava.tsx`, `prijava-organizacija.tsx` -- the redirects and the `search: true`/`hash: true` preservation.
- `apps/web/src/features/auth/hooks/use-sign-in.ts` (`navigate({ to: '/' })`), `features/auth/components/sign-in-form.tsx` (`disabled={pending}`).
- `apps/web/src/features/organization/hooks/use-organization-settings.ts`, `features/organization/components/organization-settings-card.tsx` (the skeleton at ~123), `organization-logo-card.tsx`, `features/organization/services/*` (error mapping, `organization.error.invalid`).
- `apps/web/src/lib/i18n/locales/hr.json` -- existing keys only.
- `apps/web/src/router.test.ts`, `apps/web/src/pages/prijava.test.ts` -- guards on these screens.
- `e2e/tests/auth/`, `e2e/pages/`.

## Tasks & Acceptance

**Execution:**
- [x] Carry the deep link through sign-in, with the validator.
- [x] Keep focus on a pending submit and move it on refusal.
- [x] Organization settings: named refused field, skeleton shape and `aria-busy`, retry, invalidation outside the try.
- [x] Add the tests and clean up `deferred-work.md`.

**Acceptance Criteria:**
- Given each fix reverted, when the new tests run, then they fail.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test` (after a web build) and `pnpm test:e2e` run twice, then all pass.

## Spec Change Log

- 2026-09-28 (build). **Carrier.** The location rides one search key, `povratak`, holding the whole href (path, search, hash). The `_app` and `/` signed-out redirects now put it there instead of keeping `search: true` / `hash: true` on the prompt; a bare `/` carries nothing. The organization prompt hands it on to `/prijava/$slug`, and the malformed-slug bounce keeps it (`search: true`). Both sign-in routes validate their search to `{ povratak?: string }`. Neither route's session resolution changed, and `/`'s forward still drops `/`'s own parameters, as before.
- 2026-09-28 (build). **New public module.** `features/auth/services/return-target` holds the validator (`returnTargetOf`), the route predicate (`knownPathOf`, which asks the router's `matchRoutes` for a `_notFound`), and the search helpers. It was added to `FEATURE_PUBLIC` for `pages` on purpose, and to the sign-in set's exemptions (fixture, `prijava.test.ts`, `localization-applied.test.ts`).
- 2026-09-28 (build). **The hook reads the search non-strictly.** `useSearch({ strict: false })` stands in for the page reading it and passing it in. This keeps the pinned `useSignIn(slug)` signature, and it avoids a route-id literal on the sign-in screen, which `prijava.test.ts` refuses.
- 2026-09-28 (build). **Focus target.** A refused or unavailable sign-in focuses the password field. That field is described by the message, and it is what the person corrects next. The submit is `aria-disabled` + `aria-busy` (no new text), and the existing in-flight ref is the guard.
- 2026-09-28 (build). **Error mapping, not the write.** A failure outcome from `services/snapshot.ts` now carries an optional `field`, attributed by `refusedOrganizationFieldOf` over `ORGANIZATION_CONSTRAINT_FIELDS`. The four entries are the name check, the two leave-year checks and the accent check. The type, timezone and locale checks map to nothing. What is written and the codes and messages are unchanged, so the Never on write services holds. The settings screen marks the named control `aria-invalid`, and a refused save focuses it in the handler. A live-database test pins the two leave-year constraint names. The name and accent names were already pinned.
- 2026-09-28 (build). **Skeleton label skipped.** `hr.json` has no loading string, so the skeleton region carries `aria-busy` and no accessible label. The spec asked for a label only if a key exists, and new text is Ask First. This is recorded as a narrowed deferred entry.
- 2026-09-28 (build). **Retry.** The retry reuses the existing `shell.retry` key ("Pokušaj ponovno"), so no Ask First was needed. It is offered only for `ORGANIZATION_UNAVAILABLE` (`offersReadRetry`), because the refused-read message tells the person to sign out and back in.
- 2026-09-28 (review triage). **Validator hardened.** The `//` and backslash checks now also run on the RESOLVED pathname, because dot segments can manufacture `//evil`. Only the resolved pathname, search and hash are returned. A candidate over `RETURN_TARGET_MAX_LENGTH` (2048) falls back to `/`. `router.test.ts` pins that the tree does not know `//evil.example` or `//kalendar`.
- 2026-09-28 (review triage). **Sign-in navigation replaces history** (`replace: true`), so Back from the deep link does not land on the credential form. The refusal is committed through `flushSync` before `password.focus()`, so the field is announced with its error.
- 2026-09-28 (review triage). **Retry.** `retryRead` awaits `refetch()`, then `flushSync`-increments `readAttempts`. The alert `Notice` is keyed on it, so a second failure remounts it and is announced again with the same words. A success focuses the name field, since the button has just unmounted. A read whose query function THREW (`isError`, no data) is now `ORGANIZATION_UNAVAILABLE` through `readFailureOf`, so it gets the message and the retry instead of a blank card.
- 2026-09-28 (review triage). **Exact constraint match.** The constraint name is extracted from the MESSAGE only (`/check constraint "([^"]+)"/`) and compared exactly, for both the field and the blank-name code. `details` holds the typed values and is never read.
- 2026-09-28 (review triage). **More deferred entries:**
  - the slug half of the 1-3b bounce;
  - the signed-in `/prijava*` guards ignoring `povratak`;
  - a carried deep link followed by the next user on the same device;
  - `aria-busy` not being heard, folded into the skeleton-label entry.
- 2026-09-28 (build). **Residue recorded, not fixed.** An unmapped settings refusal still does not move focus, and Save and Cancel still use native `disabled={busy}`. Both are recorded as one new deferred entry. The signed-in guards on `/prijava` and `/prijava/$slug` still send a signed-in visitor to `/` rather than to the return target. Only the signed-out flow was in scope.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint` -- expected: exit 0.
- `pnpm test` after a build -- expected: pass.
- `pnpm test:e2e`, run twice -- expected: pass.

**Results (2026-09-28, after the review triage, rebased on `854fb5f`; every run under the `e2e.lock` mutex, no `db reset`):**
- `pnpm typecheck`, `pnpm lint`, and the web build: exit 0.
- `pnpm test`: domain 256, web 2752, root 3135 of 3139.
  - All 4 root failures are in the story 3.5a shift-type override block of `test/rls-isolation.test.ts` ("the read answers another shape"). The shared stack carries a column from `supabase/migrations/0022_shift_type_override_disposition.sql`, which is untracked in the main checkout (another session's 3.5 work).
  - Nothing in this change touches that table. Every test this change adds or edits passes.
- `pnpm test:e2e`: 91 passed, twice. The 3 sign-in tests and the settings-retry test are this change's.
- Scripts and logs are in the session scratchpad at `sign-in-settings/` (`unit_mutants.py`, `e2e_mutants.py`, and their `.log` files).

**Mutation proof.** Every mutant was executed with its named suite, then restored.

| # | Mutation | Result |
|---|---|---|
| M1 | `returnTargetOf` returns the candidate unvalidated | `return-target.test.ts`: 20 fail |
| M2 | known-route check removed | 4 fail |
| M3 | control/backslash check on the raw candidate removed | 1 fails (newline) |
| M4a | raw `//` check removed alone | **survives**: the origin check covers it (layered) |
| M4b | origin check removed alone | **survives**: the raw `//` check covers it (layered) |
| M4c | both removed | "refuses a protocol-relative URL" fails |
| M5 | `knownPathOf` always true | router + unit: 7 fail |
| N1 | resolved-pathname `//` / backslash check removed | 3 fail (the `/.//`, `/kalendar/..//` and `/%2e%2e//` rows, with an always-true tree) |
| N2 | length cap removed | "refuses a candidate longer than the bound" fails |
| N3 | returns the raw candidate instead of the resolved parts | "dot segments, normalized" fails |
| M6 | `_app` back to `search: true, hash: true` | router: 1 fails |
| M7 | `/` back to `search: true, hash: true` | router: 2 fail |
| M8 | malformed-slug bounce drops the target | router: 5 fail |
| M9 | prompt loses `validateSearch` | router: 1 fails |
| M10 | hook navigates to `/` | `prijava.test.ts` landing guard fails |
| M11 | hook follows raw `povratak` | `prijava.test.ts`: 2 fail |
| N4 | post-sign-in navigate pushes (no `replace: true`) | landing guard fails |
| M12 | submit back to `disabled={pending}` | focus guard fails |
| M13 / M14 | `password.focus()` removed (refused / thrown) | focus guard fails |
| N5 | refusal set without `flushSync` before focus | focus guard fails |
| M15 | constraint map drops the day | `snapshot.test.ts`: 4 fail |
| M16 | day mapped to month | 5 fail |
| M17 | outcome never carries `field` | 3 fail |
| M18 | non-23514 errors mapped | 1 fails |
| N6 | constraint read by substring over message and details | 4 fail |
| N7 | name code read by substring over message and details | 1 fails ("a typed value spells the name check") |
| M19 | day control marked by the month field | attribution guard fails |
| M20 | focus on the named control removed | attribution guard fails |
| N8 | `controls` map sends `name` to the day element | attribution guard fails |
| N9 | `applyAccent` drops `setRefusedField` | attribution guard fails |
| N10 | the `failure === null ? null : refusedField` gate removed | attribution guard fails |
| M21 | `submit` invalidation back inside the write's `try` | refetch guard (submit) fails |
| M22 | `uploadLogo` invalidation back inside the write's `try` | refetch guard (uploadLogo) fails |
| M23 / M24 | skeleton loses `aria-busy` / two rows | skeleton guard fails |
| M25 / M26 | retry never rendered / never refetches | retry guard fails |
| N11 | retry does not `flushSync` / count the attempt | retry guard fails |
| N12 | successful retry does not focus the name | retry guard fails |
| N13 | alert not keyed on the attempts | retry guard fails |
| M27 | retry offered for every code | `snapshot.test.ts`: 4 fail |
| N14 | `readFailureOf` ignores a thrown read | 1 fails |
| N15 | hook ignores a thrown read (answer only) | retry guard fails |
| E1 | prompt drops `search` on navigate | E2E: deep-link and off-app tests fail |
| E2 | hook navigates to `/` | E2E: deep-link test fails |
| E3 | submit back to `disabled={pending}` | E2E: focus test fails |
| E4 | no focus on refusal | E2E: focus test fails (`toBeFocused`) |
| E5 | hook follows raw `povratak` | E2E: off-app test fails |
| E6 | retry does not count the attempt | E2E: settings-retry fails (alert not remounted) |
| E7 | alert not keyed on the attempts | E2E: settings-retry fails (alert not remounted) |
| E8 | successful retry does not focus the name | E2E: settings-retry fails (`toBeFocused`) |
| E9 | hook ignores a thrown read (control) | E2E passes, as expected: the E2E read is answered, never thrown. N14/N15 cover it |

## Suggested Review Order

1. `apps/web/src/features/auth/services/return-target.ts` and its test: the validator, the only thing standing between `povratak` and an open redirect.
2. `apps/web/src/pages/_app.tsx`, `index.tsx`, `prijava-organizacija.tsx`, `prijava.tsx`: where the location is put into `povratak`, carried, and kept through the malformed-slug bounce.
3. `apps/web/src/features/auth/hooks/use-sign-in.ts` and `components/sign-in-form.tsx`: following the target, and `aria-disabled` plus focus on refusal. `lib/supabase/session-cache.ts` (comment only) records why there is no race.
4. `apps/web/src/features/organization/services/snapshot.ts`: `ORGANIZATION_CONSTRAINT_FIELDS` and `refusedOrganizationFieldOf`, and the optional `field` on a failure.
5. `apps/web/src/features/organization/hooks/use-organization-settings.ts`: `refusedField`, focus on the named control, the two invalidations moved into their own `try`, `readFailureOf` for a thrown read, and `readRetry` / `retryRead` with the attempt key and the focus after success. Then `utils/messages.ts` (`offersReadRetry`).
6. `apps/web/src/features/organization/components/organization-settings-card.tsx`: `aria-invalid` on four controls, the shaped skeleton, and the retry button.
7. Tests: `router.test.ts` (real-tree predicate, redirects), `pages/prijava.test.ts` (guards and counts), `services/snapshot.test.ts`, `test/rls-isolation.test.ts` (live constraint names), `test/localization-applied.test.ts`, `e2e/tests/auth/*.spec.ts`, `e2e/tests/organization/settings-retry.spec.ts`, `e2e/pages/login.page.ts`.
8. `eslint.config.js` (`FEATURE_PUBLIC`), and `deferred-work.md`: 7 entries removed, including the nav-shell-a duplicate, and 5 narrower ones added.
