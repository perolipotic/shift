---
title: "A member's first sign-in makes them set their own password (7.8)"
type: 'feature'
created: '2026-10-08'
status: 'done'
baseline_commit: '57b0028f1d24d68437de3ec608dc43bdc8ed0687'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The password an admin issues or resets, which they read out to the member, stays that member's password indefinitely. It is also 16 random characters, which is hard to read aloud (FR-3a, redesign decision 12b).

**Approach:**
- admin-auth flags every account it issues or resets with `app_metadata.must_set_password`.
- A route guard sends a flagged session to `/postavi-lozinku`. The member saves their own password there, a new admin-auth operation clears the flag for the caller only, and the member continues to `/`.
- The issued password becomes four words, and the one-time display gains `Kopiraj`.
- Mockup: `ux-designs/ux-shift-2026-10-01-redesign/mockups/sign-in-1.html` (set-password panel, issued-password panel).

## Boundaries & Constraints

**Always:**
- **Flag on issue:** `createUser` sends `app_metadata: { must_set_password: true }` alongside its existing attributes. `resetPassword` sends `{ password, app_metadata: { must_set_password: true } }`.
- **The one added operation, `clearMustSetPassword`:**
  - It identifies the caller only from the request's JWT, through `auth.getUser(<jwt>)`.
  - It writes `updateUserById(<that id>, { app_metadata: { must_set_password: false } })`, so the password is untouched and no session is revoked.
  - Anything in the body other than `operation` is ignored, so no caller can name another account.
  - Codes: success `PASSWORD_FLAG_CLEARED` (200); an unusable token `AUTHORIZATION_MISSING`-class refusal (401); a GoTrue failure `PASSWORD_FLAG_NOT_CLEARED` (502).
  - It does no domain read or write and is open to any role.
- **Four words:**
  - `password.ts` draws 4 words, uniformly and independently, from a 2048-entry list and joins them with `-`.
  - The list holds unique lowercase Croatian words of 3–6 letters, `a–z` only (no č ć š ž đ). It contains no offensive word and no near-duplicates (e.g. `kuca`/`kuce`).
  - Each word takes 11 bits from the injected `ByteSource`, with no modulo bias. Entropy (44 bits) is computed, never written in prose.
- **Guard:**
  - `_app.tsx` `beforeLoad` redirects a session whose `user.app_metadata.must_set_password === true` to `/postavi-lozinku`.
  - `/postavi-lozinku` is a root route with `AuthLayout` and no chrome:
    - no session goes to `/prijava` with `povratak`;
    - an unflagged session goes to `/`;
    - session reads fail closed, as in `_app`.
- **Set-password screen** (copy from the mockup):
  - Heading `Postavi svoju lozinku` and the lede `Prijavio si se početnom lozinkom koju ti je dao administrator. Prije prvog koraka postavi lozinku koju znaš samo ti.`
  - `Nova lozinka` (`autoComplete="new-password"`, with the 7.7 show/hide toggle) and `Ponovi novu lozinku`.
  - Live `role="status"` checks: `Najmanje 10 znakova ({count} upisano)` and `Lozinke se podudaraju`.
  - `Spremi i nastavi`, plus an `Odjava` button that uses the auth sign-out service.
  - Submit is refused locally under 10 characters or on a mismatch: the message is bound to the field, there is no request, and no `disabled` button.
- **Save sequence:**
  1. `supabase.auth.updateUser({ password })`.
  2. Then `clearMustSetPassword`.
  3. Then `refreshSession()`, `router.invalidate()` and navigate to `/`.

  If step 2 fails after step 1 succeeded, a retry repeats only step 2 (the password is already saved).
- `supabase/config.toml` `[auth] minimum_password_length = 10`.
- **`Kopiraj` beside both one-time displays** (`member-create-card.tsx`, `member-reset-card.tsx`):
  - It copies with `navigator.clipboard.writeText` and reports `Kopirano.` or `Kopiranje nije uspjelo. Zapiši lozinku.` in a `Notice role="status"`.
  - The password stays in a monospace face.
  - `credentialOnce` gains `Kod prve prijave osoba postavlja svoju lozinku.`
- Every string goes through `t()`. Every code goes through `WIRE_CODES` and the contract test.
- **Docs in the same change:**
  - ARCHITECTURE-SPINE.md: AD-16 (four operations, the flag) and the claim-code note at :359 (partly reversed).
  - EXPERIENCE.md §Key Flows sign-in: the first-sign-in line.

**Ask First:** a migration; flagging accounts other than through `createUser`/`resetPassword` (seeds, fixtures, provisioning); any guard at the data layer (RLS/hook) instead of the route; dropping `Odjava`.

**Never:** a body-supplied user id in `clearMustSetPassword`; clearing the flag inside `resetPassword`/`updateUserById`; `user_metadata` for the flag; logging a password; a new runtime dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First sign-in | Flagged member signs in | Lands on `/postavi-lozinku`; `/kalendar` typed redirects there | N/A |
| Save | 12 chars, both equal | Flag false, session kept, lands on `/danas` with no new sign-in | N/A |
| Same as issued | New = initial password | GoTrue `same_password` → `Nova lozinka mora biti drukčija od početne.` | Bound to field |
| Too short / mismatch | 9 chars, or repeat differs | Local message, no request | — |
| Clear fails | updateUser ok, function 502 | `Lozinka je spremljena, ali nastavak nije uspio. Pokušaj ponovno.`; retry calls only the clear | Logged code |
| Admin reset | Admin resets a member who already set one | Flag true again; next sign-in shows the step | N/A |
| Other account | Body names another user id | Only the caller's flag changes | Ignored field |
| Unflagged visits | `/postavi-lozinku` without flag | Redirect `/` | N/A |
| No clipboard | `writeText` rejects | `Kopiranje nije uspjelo. Zapiši lozinku.` | Swallowed |

## Epic AC Deviations

- **"the admin's dialog shows the new four-word password once, with `Kopiraj`"** — narrowed. The password and `Kopiraj` are shown in the existing inline one-time display on `/ljudi/novi` and the member page, not in a dialog. Why: 7.11 (the member page opens a dialog for each change) and 7.13 (adding a member in a dialog) own those dialogs. Moving them into a dialog here would be rewritten twice. Deferred: the dialog form, in `deferred-work.md`.

</frozen-after-approval>

## Code Map

- `supabase/functions/admin-auth/password.ts` -- rewrite as the word generator, and keep `ByteSource`/`cryptoRandomBytes`. The list goes in a new `words.ts`.
- `supabase/functions/admin-auth/operations.ts`:
  - `:143-162` `OPERATION_CODES` gains the two new codes.
  - `:713-717` createUser attributes.
  - `:949` `resetAttributes`.
  - `PrivilegedAccounts` (`:281`) gains `auth.getUser(jwt)` (the real client has it).
  - Add `clearMustSetPassword(deps, authorization)`.
- `supabase/functions/admin-auth/handler.ts`: `:41` `OPERATIONS` (rewrite the "exactly three" comment), `:358-372` dispatch, `:290` the `authorization` header in scope (strip `Bearer `).
- `features/members/services/wire.ts:26-60,448-497` -- the codes and `WIRE_CODES`. The self-service call lives in a new `features/auth/services/set-password.ts` (updateUser, clear and refresh, with an injected client).
- Guard: `pages/_app.tsx:96-131` reads `session.user.app_metadata` (`router.test.ts:1424` forbids `role`/`admin` substrings in `_app.tsx`). `router.ts:97-102` registers the new root route.
- `lib/supabase/session-cache.ts:97-140` ignores a same-user refresh, so call `router.invalidate()` after `refreshSession()`.
- New `pages/postavi-lozinku.tsx`, `features/auth/hooks/use-set-password.ts` and `features/auth/components/set-password-form.tsx`. Reuse the 7.7 toggle (`sign-in-form.tsx:128`, `components/ui/input-group.tsx`).
- `features/auth/set-password-screen.fixture.ts` -- a new disjoint parts set. `pages/prijava.test.ts`: `:4177-4230` the exemption walk, `:607` `SCREENS` (count `:3179`), `IN_FLIGHT_SCREENS` `:965` (count `:7310`), `:689`/`:726` control counts +1 for `Kopiraj`, and the `MEMBER_CREATE`/`MEMBER_EDIT` sets `:185,:228` if a new component is added.
- `eslint.config.js:111` `FEATURE_PUBLIC`, only if the page needs a service.
- `lib/i18n/locales/hr.json:2-31` (`auth.setPassword.*`), `:528-539` (`ljudi.form.copy*`, `credentialOnce`).
- Tests:
  - `test/admin-auth-boundary.test.ts`: `:157,201-207` the operations; `:815-905` the generator; `:1196-1205,1778,1809,2163` attribute pins; `:645-690,775,782` the vocabulary; `callerThat` `:947`.
  - `test/rls-isolation.test.ts:4681-5260` gets live cases.
  - `features/members/services/write.test.ts:1109,1133,1213`.
- Docs: `ARCHITECTURE-SPINE.md:130,143,151-161,359`; `EXPERIENCE.md:191-193`.
- Fixtures and seeds insert `auth.users` directly (`e2e/utils/database-helper.ts:55`, `supabase/operator/*.sql`). They stay unflagged, so the existing sign-in e2e are unaffected.

## Tasks & Acceptance

**Execution:**
- [x] `words.ts` + `password.ts` -- the list and the generator. Tests: uniqueness, `^[a-z]{3,6}$`, length 2048, consumes the source, 4 words.
- [x] `operations.ts`, `handler.ts` -- the flag on create and reset, `clearMustSetPassword`, the codes.
- [x] `test/admin-auth-boundary.test.ts` -- repin; the clear op ignores a body id and refuses a bad token.
- [x] `test/rls-isolation.test.ts` -- live:
  - a reset sets the flag;
  - a member `updateUser` then clear keeps the session, and the refreshed token has the flag false;
  - a second user's flag is untouched.
- [x] `config.toml` -- `minimum_password_length = 10`.
- [x] `wire.ts`, `set-password.ts` (+ test) -- the sequence and its retry-only-clear state.
- [x] `_app.tsx`, `router.ts`, `postavi-lozinku.tsx`, hook, form, fixture -- the guard and the screen; update `router.test.ts`, `prijava.test.ts`.
- [x] `member-create-card.tsx`, `member-reset-card.tsx` -- `Kopiraj` + status.
- [x] `hr.json` -- the strings above.
- [x] e2e: `e2e/tests/auth/first-sign-in.spec.ts` + page object:
  - create a member as admin, copy the shown password, then sign in as that member in a fresh context;
  - check a guarded redirect, the mismatch refusal, the save landing on `/danas`, and sign-out plus sign-in with the new password reaching `/danas` directly.
- [x] Docs -- AD-16, the claim-code note, EXPERIENCE.md.
- [x] `deferred-work.md` -- the dialog deviation entry.

**Acceptance Criteria:**
- Given an admin creates or resets a member, when the reply shows, then the password matches `^[a-z]{3,6}(-[a-z]{3,6}){3}$` and `Kopiraj` is present.
- Given unit, lint, typecheck, the root vitest (with stack) and the auth/people e2e, when run, then they pass.

## Design Notes

**Why the flag is cleared by the function:** a member's own `updateUser` cannot write `app_metadata`, which is why AD-16 gains this operation. It holds the secret key, so the target must come only from the verified JWT.

**Bypass:** a member who calls the clear without changing their password keeps the admin's password. That harms only their own account, and the route guard (FR-1's surface rule) is the agreed enforcement point.

**Word sampling:** 2048 = 2¹¹ and 65536 is a multiple of it, so the low 11 bits of a 16-bit draw are uniform. No rejection is needed.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm --filter ./apps/web test && pnpm exec vitest run && pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm test:e2e e2e/tests/auth e2e/tests/people` -- expected: pass

**Manual checks:**
- Demo at 390 and 1440 px in both themes: create a member, `Kopiraj`, first sign-in, save, landing.

## Suggested Review Order

**The flag and the one added operation**

- Entry point: clears only the JWT's own account; the body is never read
  [`operations.ts:1160`](../../supabase/functions/admin-auth/operations.ts#L1160)

- Create and reset both raise the flag next to the password
  [`operations.ts:740`](../../supabase/functions/admin-auth/operations.ts#L740)

- A 429 from GoTrue is an outage, not a missing credential
  [`operations.ts:1135`](../../supabase/functions/admin-auth/operations.ts#L1135)

- Four operations now; the dispatch passes the header, not the body
  [`handler.ts:49`](../../supabase/functions/admin-auth/handler.ts#L49)

**The guard and the step**

- The layout holds a flagged session at the step
  [`_app.tsx:126`](../../apps/web/src/pages/_app.tsx#L126)

- Root route, no chrome: no session → sign-in, unflagged → `/`
  [`postavi-lozinku.tsx:51`](../../apps/web/src/pages/postavi-lozinku.tsx#L51)

- The one reader of the flag the guard and the step share
  [`set-password.ts:64`](../../apps/web/src/features/auth/services/set-password.ts#L64)

**Saving**

- updateUser → clear → refresh; a retry after a saved password skips step 1
  [`set-password.ts:337`](../../apps/web/src/features/auth/services/set-password.ts#L337)

- Expired token asks for a new sign-in; still-flagged refresh is not "ok"
  [`set-password.ts:273`](../../apps/web/src/features/auth/services/set-password.ts#L273)

- Saved is recorded before navigating, so a failed navigation never repeats updateUser
  [`use-set-password.ts:143`](../../apps/web/src/features/auth/hooks/use-set-password.ts#L143)

- Save and Odjava exclude each other
  [`use-set-password.ts:98`](../../apps/web/src/features/auth/hooks/use-set-password.ts#L98)

- Live checks, one id per rule, not re-read whole on each keystroke
  [`set-password-form.tsx:118`](../../apps/web/src/features/auth/components/set-password-form.tsx#L118)

**Four words and Kopiraj**

- 11 bits per word from the injected source, no modulo bias
  [`password.ts:99`](../../supabase/functions/admin-auth/password.ts#L99)

- Refuses to load a list whose length is not a power of two
  [`password.ts:68`](../../supabase/functions/admin-auth/password.ts#L68)

- Monospace, `break-words` so a word never splits, copy with a status line
  [`credential-line.tsx:33`](../../apps/web/src/features/members/components/credential-line.tsx#L33)

- Reset says "next sign-in", create says "first sign-in"
  [`member-reset-card.tsx:176`](../../apps/web/src/features/members/components/member-reset-card.tsx#L176)

**Copy, config and docs**

- `auth.setPassword.*` strings
  [`hr.json:9`](../../apps/web/src/lib/i18n/locales/hr.json#L9)

- Server floor matches the page (local stack; hosted is deferred)
  [`config.toml:45`](../../supabase/config.toml#L45)

- AD-16 flag clause
  [`ARCHITECTURE-SPINE.md:159`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L159)

- First sign-in in §Key Flows
  [`EXPERIENCE.md:195`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L195)

**Tests**

- Boundary: body id ignored, bad token, 429, no logging
  [`admin-auth-boundary.test.ts:3038`](../../test/admin-auth-boundary.test.ts#L3038)

- Live against the stack: create/reset flag, clear keeps the session, others untouched
  [`rls-isolation.test.ts:5275`](../../test/rls-isolation.test.ts#L5275)

- e2e: first sign-in end to end
  [`first-sign-in.spec.ts:15`](../../e2e/tests/auth/first-sign-in.spec.ts#L15)

- e2e: failed clear retries only the clear
  [`first-sign-in.spec.ts:137`](../../e2e/tests/auth/first-sign-in.spec.ts#L137)

- e2e: admin reset holds the next sign-in
  [`first-sign-in.spec.ts:184`](../../e2e/tests/auth/first-sign-in.spec.ts#L184)
