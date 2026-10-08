---
title: 'Sign-in is one form (7.7)'
type: 'feature'
created: '2026-10-08'
status: 'done'
baseline_commit: 'ef99e99ccb3a40ce24ab9cd6ca84bef77031dd47'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Signing in takes two screens: `/prijava` asks for the organization, then `/prijava/$slug` asks for the username and password. The error names only the username and password (redesign decisions 12 and 12a).

**Approach:** `/prijava` and `/prijava/$slug` render one form with Organizacija, Korisničko ime and Lozinka, and one `Prijava` button. The slug comes from the URL (read-only, with `Promijeni`), or from the last organization signed into on this device, or from what the person types. Mockup: `ux-designs/ux-shift-2026-10-01-redesign/mockups/sign-in-1.html`. Its logo and name row is narrowed to the slug.

## Boundaries & Constraints

**Always:**
- **Organization row, slug in URL:** a labelled `Organizacija` row shows the slug as text, not an input, with a `Promijeni` button (accessible name `Promijeni organizaciju`). Pressing it swaps in the editable field, prefilled with that slug and focused. The URL does not change. Focus opens on Korisničko ime.
- **Organization field, no slug in URL:**
  - It is an `Input` with `autoComplete="off"`, no autocapitalize, no autocorrect, no spellcheck, `required` and `h-11`.
  - It is prefilled from `lastOrganization()`, with the hint `Zapamćeno na ovom uređaju.` plus how to find the slug. When empty, it shows only the how-to hint and takes the focus.
- **Storage:** a pure `features/auth/services/last-organization.ts`.
  - `read(storage)` and `remember(storage, slug)` take the `Storage` as a parameter (AD-15) and wrap every access in try/catch, as `lib/theme.ts:41-53` does.
  - The value is written only after a successful sign-in, as the normalized slug. Nothing else is stored: no username, no password, nothing per person.
  - A stored value `organizationDestination` rejects reads as empty.
- **One exchange:** `useSignIn` takes the URL slug (or none). It reads the organization from the row or the field and passes it to the unchanged `signIn()`. The service's local refusal and its one mapping stay. A wrong organization, username or password all give `auth.error.credentials` = `Organizacija, korisničko ime ili lozinka nisu točni.`, bound to all three fields.
- **Refusal:** every typed value is kept (UX-DR34), and focus goes to the password, as today.
- **Password:** a show/hide toggle sits inside the field. It is `type="button"`, `aria-pressed`, 44 px, and named `Prikaži lozinku`. It switches between `type="password"` and `text`. The password keeps `autoComplete="current-password"`.
- **Button:** `Prijava`; while signing in it reads `Prijava…` with `aria-disabled` and `aria-busy`, as today.
- **`Zaboravljena lozinka?`** is a `type="button"` disclosure (`aria-expanded`, `aria-controls`). It opens in place, below the button, the panel `Lozinku postavlja administrator`, with `Javi se administratoru svoje organizacije. On ti daje novu lozinku, a stare prijave tada prestaju vrijediti.` That is true: `admin-auth/operations.ts:954` revokes sessions.
- The routes keep their guards: a malformed slug redirects to `/prijava` with the search, a signed-in visitor goes to `/`, the reads fail open, and `povratak` is honoured on both routes.
- The form stays `method="post"`. Every string goes through `t()`.
- Update in the same change:
  - EXPERIENCE.md §Key Flows: a new sign-in line.
  - DESIGN.md:329: "remember me" means a session. Remembering the organization slug is allowed.

**Ask First:** storing anything beyond the slug; looking up an organization before sign-in; clearing the password on a refusal.

**Never:** an anonymous organization lookup, name or logo (NFR-4, 1.3b); a message that tells the fields apart; a new runtime dependency; `disabled` on the submit button.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| From the DVD link | `/prijava/dvd-demo` | Row `dvd-demo` + `Promijeni`; focus on username; sign-in reaches `/danas` and stores `dvd-demo` | N/A |
| Change | press `Promijeni`, type `x-y` | Field focused with `dvd-demo`; the attempt uses `x-y` | Wrong → generic message |
| Returning device | `/prijava` after sign-out, storage `dvd-demo` | Field prefilled `dvd-demo`, focus on username | N/A |
| New device or blocked storage | `/prijava`, `getItem` throws | Empty field, focused; no error | Swallowed |
| Unknown or malformed org | `nepostoji` / `Under_Score` | Same message as a wrong password, values kept | Local refusal for malformed, no request |
| Service down | fetch fails | `auth.error.unavailable` | Logged, as today |

### Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/prijava.tsx` -- the screen and the `/prijava/$slug` route. The bare `/prijava` route moves in here, with the same component and its current `beforeLoad`. Rewrite the stale "exactly two fields" rationale.
- `apps/web/src/pages/prijava-organizacija.tsx` -- delete it. `router.ts:18-19,100-101` imports and registers it.
- `features/auth/hooks/use-sign-in.ts` -- add the organization ref and the URL slug. Remember the slug on success. Add the `editing` and `passwordShown` state. `:51` reads `povratak` non-strictly, which suits both routes.
- `features/auth/components/sign-in-form.tsx` -- three fields, the row or field, the toggle and the disclosure. `components/ui/input-group.tsx` holds the toggle. `components/filter-bar.tsx:316` is the `aria-expanded` pattern.
- `features/auth/services/address.ts:116` `organizationDestination` -- the callers change: the prompt goes and the form arrives. Update its comment.
- `features/auth/services/sign-in.ts:122` -- update the comment only; the logic does not change.
- `features/auth/sign-in-screen.fixture.ts:20` `SIGN_IN_PARTS` -- the new service file is not a screen part.
- `lib/i18n/locales/hr.json:2-22`:
  - Change `auth.submit` and `auth.error.credentials`.
  - Add `pending`, `organization.{label,change,changeLabel,remembered,hint}`, `password{Show}`, and `forgot.{trigger,heading,body}`.
  - Remove `organization.{heading,submit}` and `passwordReset`.
- `pages/prijava.test.ts` (biggest diff):
  - `:104` and `:616`, `:968-973`, `:2049`, `:7547-7590` are the prompt entries; remove them. `:3180`/`:3211` counts change.
  - `:614`/`:2047`/`:4263`/`:6401`/`:7385`/`:7532` are the control, input, string and `required` counts; recount them with comments.
  - `:6503` (reset id) and `:6540` (masked password) are rewritten for the disclosure and the toggle.
  - `:7411` "slug from the URL" becomes "the URL slug or the field".
  - `:7104` forbids `localStorage` in parts; keep that rule (the storage is in the service). `:9291,:9460,:9685` pin the ids and keys.
- `router.test.ts:48-49,372,398-408,610` -- bare `/prijava` now renders `SignInScreen`; `:1025-1120` slug guards stay.
- `features/navigation/components/chrome.tsx:412-425` -- sign-out still lands on bare `/prijava`. Rewrite the comment: the prefill now gives the slug back.
- Stale comments: `components/layout/auth-layout.tsx:10`, `lib/supabase/client.ts:180`, `lib/supabase/session-cache.ts:33-36`, `features/auth/services/address.test.ts:133,194`, `return-target.ts:7-8`.
- e2e:
  - `e2e/pages/login.page.ts:11-52` -- one form and an `organizationRow`.
  - `e2e/tests/auth/sign-in.spec.ts:45-193`.
  - `layout/phone-navigation.spec.ts:204`, `layout/responsive.spec.ts:47`, `layout/numerals.spec.ts:25,97`.

## Tasks & Acceptance

**Execution:**
- [x] `features/auth/services/last-organization.ts` + `last-organization.test.ts` -- read and remember with injected storage; cover throw, absent, malformed and success.
- [x] `use-sign-in.ts`, `sign-in-form.tsx`, `pages/prijava.tsx` -- one form on both routes, as above.
- [x] Delete `prijava-organizacija.tsx`; update `router.ts` and `router.test.ts`.
- [x] `hr.json` -- the keys above.
- [x] `prijava.test.ts`, the fixture -- recount with comments. Pin the toggle's `aria-pressed`, the disclosure's `aria-expanded` and `aria-controls`, the error bound to all three fields, no `localStorage` in parts, and no `disabled`.
- [x] Stale comments -- the files listed in the Code Map.
- [x] e2e -- update the page object and specs. Add tests for: a slug-URL sign-in; `Promijeni`; the prefill after sign-out; a wrong org giving the same message as a wrong password; the toggle; the disclosure.
- [x] Docs -- EXPERIENCE.md §Key Flows sign-in line, DESIGN.md:329.

**Acceptance Criteria:**
- Given `/prijava` or `/prijava/<slug>`, when it renders, then there is one form with three labelled values and one `Prijava` button, and no other step.
- Given the suite, when unit, lint, typecheck and the auth and layout e2e run, then they pass.

## Design Notes

Remembering the slug discloses nothing: it is on the DVD's public link, and it is written only after a successful sign-in, so a typo is never remembered. Keeping one `signIn()` keeps the CAP-1 mapping in one tested place. The new field is only one more input to it.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm --filter ./apps/web test && pnpm exec vitest run && pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm test:e2e e2e/tests/auth e2e/tests/layout` -- expected: pass

**Manual checks:**
- Demo at 390 and 1440 px, both themes: the DVD link, `Promijeni`, the prefill after sign-out, the toggle, the disclosure and a wrong org.

## Suggested Review Order

**One form on both routes**

- Entry point: both routes render this screen; the slug is optional
  [`prijava.tsx:37`](../../apps/web/src/pages/prijava.tsx#L37)

- Each slug link opens afresh: the route remounts per slug
  [`prijava.tsx:107`](../../apps/web/src/pages/prijava.tsx#L107)

- Bare `/prijava` keeps the old prompt's guards, now on the form
  [`prijava.tsx:134`](../../apps/web/src/pages/prijava.tsx#L134)

**The organization value**

- URL slug normalized once; row, prefill and request all use it
  [`use-sign-in.ts:77`](../../apps/web/src/features/auth/hooks/use-sign-in.ts#L77)

- Row with `Promijeni`, or the field with prefill, hint and placeholder
  [`sign-in-form.tsx:205`](../../apps/web/src/features/auth/components/sign-in-form.tsx#L205)

- Hidden input carries the slug in row mode for form data
  [`sign-in-form.tsx:280`](../../apps/web/src/features/auth/components/sign-in-form.tsx#L280)

- "Zapamćeno" shows only while the field still holds the remembered slug
  [`use-sign-in.ts:212`](../../apps/web/src/features/auth/hooks/use-sign-in.ts#L212)

**Remembering the slug**

- Written only after `signIn` succeeds; a typo is never stored
  [`use-sign-in.ts:165`](../../apps/web/src/features/auth/hooks/use-sign-in.ts#L165)

- Injected storage, every access guarded, malformed values read as empty
  [`last-organization.ts:33`](../../apps/web/src/features/auth/services/last-organization.ts#L33)

- The one guarded `localStorage` accessor, kept out of screen parts
  [`last-organization.ts:73`](../../apps/web/src/features/auth/services/last-organization.ts#L73)

**Password and help**

- Re-masked before the exchange, so a refusal never focuses plain text
  [`use-sign-in.ts:137`](../../apps/web/src/features/auth/hooks/use-sign-in.ts#L137)

- Toggle inside the field: `aria-pressed`, icon shows the state
  [`sign-in-form.tsx:128`](../../apps/web/src/features/auth/components/sign-in-form.tsx#L128)

- `Zaboravljena lozinka?` disclosure; panel always rendered, only `hidden`
  [`sign-in-form.tsx:172`](../../apps/web/src/features/auth/components/sign-in-form.tsx#L172)

- New primitive slot that holds the toggle
  [`input-group.tsx`](../../apps/web/src/components/ui/input-group.tsx)

**Copy and docs**

- One message for org, username or password
  [`hr.json:10`](../../apps/web/src/lib/i18n/locales/hr.json#L10)

- §Key Flows sign-in subsection
  [`EXPERIENCE.md:191`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L191)

- "Remember me" clarified: slug allowed, lasting session not
  [`DESIGN.md:329`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L329)

**Tests**

- Wrong org gives the same message, and nothing is remembered
  [`sign-in.spec.ts:52`](../../e2e/tests/auth/sign-in.spec.ts#L52)

- Signing in after `Promijeni` stores the typed slug
  [`sign-in.spec.ts:114`](../../e2e/tests/auth/sign-in.spec.ts#L114)

- Remount keyed on the slug is pinned
  [`router.test.ts:401`](../../apps/web/src/router.test.ts#L401)

- Source pin: remember only after success
  [`prijava.test.ts:7623`](../../apps/web/src/pages/prijava.test.ts#L7623)

- Page object: one form, an `organizationRow`
  [`login.page.ts:25`](../../e2e/pages/login.page.ts#L25)
