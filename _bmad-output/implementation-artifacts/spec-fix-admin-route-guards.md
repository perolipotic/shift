---
title: 'Every admin-only screen guards its route, a session change clears every cached answer, and the zero-admin trigger runs only for its owner'
type: 'bugfix'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '66a29f6612f48502b703c955cd7c4e6e90ee6a53'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
  - '{project-root}/apps/web/src/pages/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A deferred-work triage on 2026-09-27 grouped five access-related entries as "package 1a". All are still real on main:
1. **Missing route guards** (entries "Three other ADMIN_ONLY destinations carry no route guard…" and "`/raspored` and `/organizacija` have no route-level admin guard…"):
   - A member who types `/organizacija` or `/raspored` reaches an admin screen shell. The data is still refused by RLS.
   - Nothing derives which routes must be guarded from `destinations.ts` `roles: ADMIN_ONLY`.
2. **Cached answers outlive a session change** (entry "The calendar snapshot now carries the viewer … `CALENDAR_KEY` has no user in it…"):
   - `chrome.tsx` calls `queryClient.clear()` on an in-tab sign-out only.
   - An account switch in another tab, a session expiry, or a sign-in over a stale cache can briefly show the previous viewer's calendar, role, team and organization. This affects `CALENDAR_KEY`, `MEMBER_ROLE_KEY`, `OWN_TEAM_KEY` and the rest.
3. **Leftover EXECUTE grants on the zero-admin trigger function** (the three entries starting "`revoke execute ... from public` does not actually make a function…", "`functionSecurity`'s exact-grantee capability is unused…" and "`refuse_organization_with_no_admin` still carries the default `anon`, `authenticated` and `service_role` EXECUTE grants…"):
   - The trigger function `refuse_organization_with_no_admin` still carries Supabase's default EXECUTE grants for `anon`, `authenticated` and `service_role`.
   - Its test asserts only that PUBLIC is revoked.

**Approach:**
- **Guards:** give every route whose destination is `ADMIN_ONLY` the same admin `beforeLoad` guard the other admin routes use. Add a completeness test that derives the admin-only paths from `destinations.ts` and fails when any matching route lacks the guard. It lives in `router.test.ts` or `prijava.test.ts`, whichever already drives the guards. Folding the nine copies into one shared helper is allowed if it is small and keeps the guard's behaviour identical. Otherwise keep the copies.
- **Session change:** install one app-wide rule in `App.tsx` or `main.tsx`. A `supabase.auth.onAuthStateChange` listener clears the whole `queryClient` whenever the signed-in user id changes or becomes null. It must not clear on token refreshes for the same user. Keep the chrome's explicit `clear()` on sign-out.
- **Grants:** add a new migration that revokes EXECUTE on `refuse_organization_with_no_admin` from `anon`, `authenticated` and `service_role`, exactly as 0003 does for its functions. Extend the provisioning test to assert the exact grantee list with `functionSecurity`'s exact-grantee capability.

## Boundaries & Constraints

**Always:**
- The guard's behaviour is unchanged: the same redirect and the same refusal handling as the existing admin routes. A member sent away from `/organizacija` or `/raspored` lands where a member sent away from `/ljudi` lands today.
- The completeness test fails when a guard is removed from any admin-only route (prove it by planting the removal).
- The session rule has a unit test that uses a stub auth client with no browser (AD-15):
  - a user change clears the cache;
  - a sign-out event (user becomes null) clears it;
  - a token refresh for the same user does not.
- The migration is additive and idempotent in the repo's migration style. `supabase db reset` passes. The trigger still fires: the zero-admin refusal tests keep passing.
- E2E: a member session opening `/organizacija` and `/raspored` by URL is redirected. Extend the existing authorization spec in `e2e/tests/auth/authorization.spec.ts`.
- Remove the deferred-work entries this closes.

**Ask First:**
- If any `ADMIN_ONLY` destination is a placeholder where a guard would change a flow a spec pins. Stop and report.
- Anything beyond revoking those three roles, such as `alter default privileges`.

**Never:**
- No change to RLS policies or to the write paths.
- No new UI text.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/navigation/utils/destinations.ts` -- `ADMIN_ONLY` destinations (`/raspored`, `/organizacija`, …).
- `apps/web/src/pages/*.tsx` -- `beforeLoad` guards, for example `organizacija.satni-pojasi.tsx:98` ("the guard `/ljudi/smjene` carries, copied verbatim; `router.test.ts` drives it"). `organizacija.tsx` and `raspored.tsx` have none.
- `apps/web/src/router.test.ts`, `apps/web/src/pages/prijava.test.ts` -- existing guard tests.
- `apps/web/src/features/navigation/components/chrome.tsx:335-344` -- sign-out `queryClient.clear()` and its rationale.
- `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/src/lib/supabase/client.ts` -- where the listener belongs.
- `supabase/migrations/0002_organizations_and_members.sql`, `0003_*`, `0008_member_status.sql` -- the function and its ACL history.
- `test/provisioning.test.ts` -- `expectRunsAsOwner` / `functionSecurity`.
- `e2e/tests/auth/authorization.spec.ts`, `e2e/pages/` -- the member-session authorization spec.

## Tasks & Acceptance

**Execution:**
- [x] Add the route guards and the completeness test.
- [x] Add the session-change rule and its unit test.
- [x] Add the migration and the exact-grantee assertion.
- [x] Add the E2E redirect cases.
- [x] Clean up `deferred-work.md`.

**Acceptance Criteria:**
- Given each fix reverted, when the new tests run, then they fail.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test` (after a web build and a `supabase db reset` that applies the new migration) and `pnpm test:e2e` run twice, then all pass.

## Spec Change Log

- **2026-09-27, review triage 1 (session rule).**
  - **Trigger:** reviewers found that `QueryCache.clear()` in TanStack Query 5 removes queries without notifying mounted observers. A mounted screen kept the previous user's data, the orphaned queries could not be refetched, and the route guards did not re-run.
  - **Change:** `clearCacheOnSessionChange` became `resetOnSessionChange(source, { cache, router }, defer)`.
    - A user-to-user change calls `resetQueries()` and then a deferred `router.invalidate()`.
    - A sign-out calls `clear()` and then a deferred `router.invalidate()`, so `_app`'s guard sends the tab to `/prijava` and unmounts the orphaned observers. A reset would refetch as nobody on the way out.
    - A sign-in calls `clear()` only. The router is left alone because `SIGNED_IN` fires inside `signInWithPassword` before the hook navigates.
    - The invalidation waits for the next macrotask, so the chrome's own `navigate('/prijava')` starts first.
  - **Test:** the unit test now uses a real `QueryClient` and a subscribed `QueryObserver`.
  - **Scope:** the intent is unchanged.
- **2026-09-27, review triage 4 (deferred work).**
  - **Change:** the per-function revokes vs `alter default privileges` question is restored to `deferred-work.md` as an open Ask First decision. The entries this fix closed stay removed.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint` -- expected: exit 0.
- `pnpm exec supabase db reset`, then `pnpm test` -- expected: pass.
- `pnpm test:e2e`, run twice -- expected: all pass.

**Planted mutations** (each restored after the run):

| Mutation | Test that failed |
|---|---|
| `/organizacija` guard removed | 8 router cases, including the completeness test |
| `/raspored` guard and its table row removed | completeness test (3 cases) |
| `/raspored` guard removed (E2E) | `is sent from /raspored to Danas` |
| `/organizacija` admits `MEMBER_ROLE_REFUSED` | `forwards from '/organizacija' when the level comes back as 'MEMBER_ROLE_REFUSED'` |
| `/raspored` logs on every pass | `says nothing to the console on the ordinary admin path to '/raspored'` |
| `/raspored` fails closed to `/kalendar` | `fails closed on '/raspored' …` |
| guarded-routes entry for `/organizacija` names another route | `drives every admin-only destination …` (identity check) |
| session rule: plain `clear()` on a user switch | `a mounted screen stops showing the previous user …` |
| session rule: no router invalidation | 5 session-cache cases |
| session rule: invalidation run synchronously | 2 cases (deferral) |
| session rule: invalidation on a sign-in too | `on a sign-in clears the cache and leaves the router to the sign-in hook` |
| session rule: `resetQueries()` on a sign-out | 2 cases |
| `main.tsx` install line removed | snapshot test `installs the session rule on the one cache, once` |
| the three EXECUTE grants restored on the live DB | provisioning `grants execute on 'refuse_organization_with_no_admin' to [] …` |

## Suggested Review Order

1. `apps/web/src/lib/supabase/session-cache.ts` and its test: what a user switch, a sign-out and a sign-in each do (reset or clear, then the deferred router invalidation).
2. `apps/web/src/main.tsx`: the one install line.
3. `apps/web/src/pages/organizacija.tsx` and `raspored.tsx`: the two new guards, copied verbatim.
4. `apps/web/src/router.test.ts`: `ROLE_GUARDED_PATHS` derived from `DESTINATIONS`, the completeness and identity test, and the `it.each` cases.
5. `supabase/migrations/0020_refuse_no_admin_execute_grants.sql` and `test/provisioning.test.ts`: the revoke and the exact grantee list.
6. `e2e/tests/auth/authorization.spec.ts`: the two new redirects.
