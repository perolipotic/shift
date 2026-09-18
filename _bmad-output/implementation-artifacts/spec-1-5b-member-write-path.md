---
title: 'Story 1.5b: An admin creates and edits members'
type: 'feature'
created: '2026-09-18'
status: 'done'
review_loop_iteration: 1
baseline_commit: '81b76c384a54fad44bf2becccb1edf4c2d99ce79'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The privileged auth boundary answers `501 NOT_IMPLEMENTED` for every operation (`handler.ts:195`), so no account can be issued after provisioning — story 1.5a reads a member list nobody can add to. The username an admin issues exists only as the local part of `auth.users.email`, which the application cannot read, so an admin cannot tell a member their own sign-in name.

**Approach:** Implement `createUser` and `updateUserById` behind the database-verified authorization AD-16 requires, give `members` a `username` column so the issued credential is readable and searchable, and add two routes that create and edit a member. Editing name, email, permission level and leave allowance needs no privileged call — the RLS update policy already admits an active admin — so the function is reached only when the sign-in identity itself changes.

## Boundaries & Constraints

**Always:**
- The privileged client is used for `auth.admin.*` and nothing else; every `members` write goes through the caller's JWT client so RLS and attribution still apply (AD-16, AD-17, AD-11).
- Authorize against the database, never the request: the caller must be an **active admin of the target member's own organization**, established through `current_member_access()` (`0003:107-120`) read as the caller.
- The synthesized address is built by `signInAddress` (`apps/web/src/supabase/address.ts`) and by the same expression in the function — the domain and the `@` live nowhere else.
- Errors are `{ code, ...operands }` with stable SCREAMING_SNAKE codes, translated only at the edge.
- Every user-facing string goes through `t()`, with its key registered in `hr.json`, `SANCTIONED_SCREEN_KEYS`, `AUTHORED_VOCABULARY` and `KEY_SOURCES` **in the same commit**.
- Every new control carries a height class resolving to ≥44 px (`h-11`).

**Ask First:**
- Any change to `members`' existing RLS policies, or a column-level restriction on the update policy (none exists today and adding one needs a trigger).
- A second Edge Function — that amends AD-16.
- Any new runtime dependency.

**Never:**
- `ban` / `unban` — story 1.6 owns them; they keep answering 501.
- The admin-issued password **reset** — deferred (`deferred-work.md:609`). This story issues an initial credential only.
- `destructive` styling anywhere (UX-DR4), including in comments on a screen.
- Optimistic cache patching — invalidate and refetch, as `organizacija.tsx:254` does.
- Rendering a component in a test, or jsdom in any config (AD-15).
- Storing or re-displaying the generated password after its one showing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create, no email | admin caller; name, username, level, allowance; email blank | `auth.users` + `auth.identities` + `members` row; generated password returned once | N/A |
| Create, caller is `member_role` | valid payload | Nothing written anywhere | `403 NOT_AN_ADMIN` |
| Create, caller admin of another organization | target `organization_id` not the caller's | Nothing written | `403 NOT_AN_ADMIN` |
| Create, username already issued in that organization | duplicate username | Nothing written; auth user removed if already made | `409 USERNAME_TAKEN` |
| Create, `members` insert fails after auth user exists | RLS or constraint refusal | Auth user deleted, so no account can sign in reaching nothing | `409`/`403` with the underlying code |
| Edit name, email, level or allowance | admin caller, unchanged username | Plain PostgREST update under `members_update_by_own_active_admin`; the function is never called | refusal code from the seam |
| Edit username | new username, free in the organization | `members.username` then `auth.users.email`, both changed | on auth failure the row is restored and `USERNAME_NOT_APPLIED` returned |
| Demote the only admin | level `admin` → `member_role` | Refused at commit by the deferred trigger | `ORGANIZATION_WOULD_HAVE_NO_ADMIN` |
| Generated password | any successful create | Shown exactly once; never retrievable again | N/A |

</frozen-after-approval>

## Code Map

**Baseline `81b76c3`**, green: **1286 root / 924 web / 4 domain**, 0 skipped, `pnpm build` exit 0. `nvm use` first (Node 24.19.0). `pnpm build` **before** `pnpm test`: the freshness guards at `localization-applied.test.ts:220-231` fail rather than skip on a stale `dist/`.

### The privileged boundary

- `supabase/functions/admin-auth/handler.ts` — `OPERATIONS` `:16` already declares both target operations. The 501 to replace is `:195`. `reply` `:144` is the only way to build a response. Both clients are already constructed at `:180-181` inside the `CLIENT_CONSTRUCTION_FAILED` try/catch — **reuse those values, do not call the factories again**. The factories are typed `unknown` on purpose (`:10-12`); the operation code casts to its own narrow structural interface, exactly as `MembersTable` (`members/list.ts:192`) does.
- `supabase/functions/admin-auth/index.ts:67-72` privileged client, `:80-90` caller client with the `Authorization` header. supabase-js specifier `npm:@supabase/supabase-js@2.113.0` `:44`.
- `supabase/config.toml:95-102` — `verify_jwt = true`, so a caller JWT is already verified by the runtime before the handler sees it. That is **not** authorization; AD-16's check is still this story's.
- No payload validation exists beyond `operation`. Each operation needs its own.
- `handler.ts` imports nothing today, by design (`:1-12`). The new sibling modules are its first imports, so they are referenced with an explicit `.ts` extension — Deno requires it and Vitest resolves it, which is what keeps `test/admin-auth-boundary.test.ts` able to import the handler by path (`tsconfig.json:10`). An extensionless import works in one runtime and not the other.

### What the database already gives you

- `members_insert_by_own_active_admin` `0003:306-317` and `members_update_by_own_active_admin` `0003:331-351` **already exist** — an active admin may insert and update any column on any row in their own organization. **No policy work is needed.** The update policy pins `organization_id` on both sides, so a row cannot move tenants.
- `custom_access_token_hook` `0003:181-206` derives the `organization_id` claim **live from the `members` row** at token mint, and removes the key when no row exists. So the function sets nothing on `auth.users` for the claim — it only has to make the `members` row exist.
- `refuse_organization_with_no_admin` `0002:193-223`, trigger `0002:242-246`: `AFTER DELETE OR UPDATE`, deferred to commit, raises `ORGANIZATION_WOULD_HAVE_NO_ADMIN`. It does not fire on insert.
- `members` `0002:115-158` — `auth_user_id` is `not null references auth.users(id) on delete cascade` `:128`, so **the auth user must exist before the members row**; that ordering is forced by the schema, not chosen.
- `seed.sql:89-133` is the shape to match. `auth.admin.createUser` produces the `auth.users` and `auth.identities` rows itself; the four empty-string columns GoTrue requires are its problem, not ours. Confirm the identity row appears rather than assuming it.

### The surface

- `apps/web/src/routes/organizacija.tsx` is the only form-with-writes precedent, and the whole pattern is copied from it: uncontrolled `<Input ref=… defaultValue=…>` `:140-145,575` so a refused save keeps every entered value (UX-DR34); a `useRef(false)` re-entrancy guard plus a `useState` pending flag `:146-151`; `submit` `:205-270` reading `.current`, resetting both in `finally`; a discriminated outcome from a seam module, `invalidateQueries` on success `:254`, never an optimistic patch; one always-mounted `role="alert"` region `:790-798`; `<Button type="reset">` as cancel `:755-762`.
- **No `useMutation` anywhere in the app** — every write is a raw seam call in a guarded handler. Do not introduce one here; the deferred entry at `deferred-work.md:501` is where that decision belongs.
- `apps/web/src/members/list.ts` — the seam to extend: `MEMBERS_TABLE` `:51`, the discriminated `MembersOutcome` `:151`, the injected `MembersTable` `:192`, the validated mapper `memberListRowOf` `:313`, `mayReadMembers` `:460`. Write functions join it, or a sibling `members/write.ts` if it grows past reading comfortably.
- `apps/web/src/routes/ljudi.tsx` — `beforeLoad` `:378-403` is the guard pattern the two new routes copy verbatim (role read through router context, never a client constructed in a guard). `MEMBER_COLUMNS` `list.ts:558` drives the table; a row action column is new.
- `components/ui/` holds **only** `button, card, input, label, table`. No Dialog, Select, Checkbox or Alert. The established substitute for a select is a bare native `<select>` with inline Tailwind (`organizacija.tsx:683-724`) — follow it rather than vendoring a primitive.
- **No client-side Edge Function call exists anywhere.** `functions.invoke` appears nowhere; this story establishes that seam from scratch, injected the way `MembersTable` is so the node suite can drive it.

### Gates this story must register with

- `apps/web/src/routes/prijava.test.ts` — `SCREENS` `:192-263` (length pinned 14 at `:1024`) gains **two** entries for the new routes, each with an exact `expectedControls`; `/ljudi` `:228` moves from 3 only if a row action is added to the list. `KEY_SOURCES` `:866` (pinned 18 at `:1025`) gains entries and the existing member-list counts change. `STRUCTURAL_ATTRIBUTES` `:456-530` is the allowlist — a `placeholder` or `aria-label` literal is an offence, so those go through `t()`.
- `test/resource-hygiene.test.ts` — `SANCTIONED_KEYS` `:282` is an exhaustive sorted **equality** against `hr.json` `:372`. Voice rules: no `!` `:414-421`, no `smjen` `:423-431`, en dash for ranges `:433-441`, actions in the second-person singular imperative pinned by `toBe` against `Spremi`/`Odustani` `:497-502`. `RESERVED_STEMS` `:314` is **currently empty** — no member-form vocabulary is banned today.
- `test/localization-applied.test.ts` — every new module joins `SOURCES` `:48-153` or the freshness guard cannot see it; every new Croatian word joins `AUTHORED_VOCABULARY` `:418-594` with an exact count (build occurrences must equal `hr.json` occurrences); `Nema` stays absent `:595`.
- `eslint.config.js:163-232` — merge-blocking L2: no bare JSX text, no literal on `placeholder`/`aria-label`/`title`/`alt`, no `label` on `option`.
- `test/admin-auth-boundary.test.ts` — `it.each(OPERATIONS)` asserting 501 `:53-60` must narrow to `ban`/`unban`; the six CORS and misconfiguration tests that use `post('createUser')` as a representative operation (`:173,184,194,288,306,318`) must repoint to a still-501 operation; the `post()` helper `:37-43` sends `{ operation }` only and needs a body.
- `test/rls-isolation.test.ts` — conventions to copy: `tokenFor` `:267-290` (real password grant), `restRefusal` `:310-346`, `addThrowawayMember` `:663-728`, cleanup by `THROWAWAY` address pattern in `afterAll` `:730+`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0007_member_username.sql` — add `username text not null`, backfilled from the local part of each member's `auth.users.email`. Two constraints, not one: a CHECK giving the username its shape (non-empty, no whitespace, no `@`, lowercase) and a **case-insensitive** unique index per organization. The RLS update policy lets any active admin PATCH this column straight through PostgREST, so a rule enforced only by the function's regexes is not enforced at all, and a case-sensitive unique lets `Ana.Kovac` and `ana.kovac` coexist while the addresses they build collide. Human decision 2026-09-18.
- [x] `test/provisioning.test.ts` — **execute the backfill over a row.** `supabase db reset` applies migrations before `seed.sql`, so `members` is empty when `0007` runs and every statement in it is unverified by construction: `split_part(u.email, '@', 1)` could read `, 2)` and the whole suite stays green. Read the migration's update statement from the file as `provisioning.test.ts:101` already reads the operator script, apply it in a rolled-back transaction over a member whose username has been nulled, and assert the result equals the account's local part.
- [x] `supabase/seed.sql`, `supabase/operator/provision-organization.sql` — write `username` at insert time. The provisioning script's value must be **asserted**, not merely executed: swapping `admin_username` for `admin_name` currently leaves every case green while the provisioned admin's username disagrees with the address they sign in with.
- [x] `supabase/functions/admin-auth/authorize.ts` — AD-16's check as a pure function over `current_member_access()`, read through the caller's client. Active, admin, and same organization, each refused as `NOT_AN_ADMIN` so nothing is disclosed.
- [x] `supabase/functions/admin-auth/password.ts` — `crypto.getRandomValues` over an unambiguous alphabet, rejection-sampled. **Every figure in the prose must be computed from the literal, not asserted beside it** — the alphabet, the entropy and the discard rate — and a test must pin `PASSWORD_ALPHABET.length` to its actual value. The ambiguity rule applies to **both halves of every pair**: excluding `0`, `O`, `1`, `l`, `I` while keeping lowercase `o` and `i` leaves exactly the confusion the exclusion exists to prevent, on a credential read aloud to somebody with no mailbox.
- [x] `supabase/functions/admin-auth/operations.ts` — `createUser` and `updateUserById` as pure functions over narrow interfaces. Slug read from `organizations` as the caller, never from the payload. `createUser` writes the `members` row through the caller's client and deletes the auth account if that insert is refused. `updateUserById` moves `members.username` first, then the address, restoring the row on failure. A duplicate address is recognised by GoTrue's **code**, never by `status === 422` alone — every other validation refusal shares that status and would tell an admin to change a username that is not the problem.
- [x] `supabase/functions/admin-auth/handler.ts` — dispatch the two implemented operations, keep `ban`/`unban` at 501, reuse the clients at `:180-181`. **The dispatch is wrapped**: a throw escaping an operation must become a stable `{ code }` carrying the same CORS headers every other reply does, not a runtime 500 the SPA cannot map.
- [x] `test/admin-auth-boundary.test.ts` — the refusal matrix, and the **literal pins this iteration was reverted for**. Every constant that decides a security outcome or crosses the wire is asserted against the value the database or the client actually carries — `ADMIN_ROLE` against `members.role`'s check value, `CURRENT_MEMBER_ACCESS` against the function `0003:107` creates — never against itself. A test that imports a constant, builds the stub's answer from it and compares the two asserts nothing.
- [x] `test/admin-auth-boundary.test.ts` — **one contract case binding the two vocabularies.** This file can import both trees, so it asserts that every code the function emits is a code `memberWriteFailureOf` matches and that the success gates agree. Written twice and bound by nothing, renaming the value of `MEMBER_CREATED` reports a successful create as a failure and discards the one unrecoverable value in the system, with both suites green.
- [x] `apps/web/src/members/write.ts` — the client seam: injected `functions.invoke`, the PostgREST edit path, and the branch that reaches the function only when the username changed. `editFailureOf` maps `23502` the way the function's equivalent does, so a not-null refusal is "correct a value" on both paths rather than "try again" on one. An id that reaches no member is its **own** code, not the refusal that tells a proven admin to sign out and back in.
- [x] `apps/web/src/members/write.ts` — **the create screen's "is there anything to seed this form from" decision lives here**, as `memberFormRefusalOf` already does for the edit screen, and is executed by a test. A `.tsx` is rendered by nothing under AD-15, so a decision left in the component is unverifiable by construction.
- [x] `apps/web/src/members/write.ts` — an edit reports a **partial save** when the ordinary fields were written and the rename was then refused. The four fields really are in the database; a flat failure tells the admin nothing stuck. Human decision 2026-09-18. `renameMember`'s log and its returned code must name the same thing.
- [x] `apps/web/src/members/write.test.ts` — execute every outcome, including the PostgREST-versus-function branch, the partial save, and the create-side form gate.
- [x] `apps/web/src/routes/ljudi.novi.tsx`, `apps/web/src/routes/ljudi.$id.tsx` — the two forms, copying `organizacija.tsx:551-561`'s read gating **in full**: a skeleton while the read is pending, no form once it has settled failed, and the alert rendered outside that branch. A form whose Save silently returns because the snapshot never arrived is the blank-page defect `index.tsx:21-25` warns about wearing a different shape. Both screens offer a way back to the list — neither route is a destination, so `type="reset"` is not an exit. The edit form's uncontrolled inputs remount with the row the way its `<select>` already does, or a refetch leaves the fields and the level control disagreeing.
- [x] `apps/web/src/routes/ljudi.tsx` — add and row actions. `aria-sort` is rendered **only** for columns that sort; the actions column currently announces `aria-sort="none"`, offering assistive technology exactly the affordance `sortable: false` exists to withhold. The row action's accessible name distinguishes the member it acts on, or several hundred rows give one repeated name.
- [x] `apps/web/src/i18n/locales/hr.json` — a `ljudi.form.*` block shaped like `organization.*`, actions in the second-person singular imperative.
- [x] `apps/web/src/router.test.ts` — drive both new guards with real outcomes.
- [x] `apps/web/src/routes/prijava.test.ts` — register both screens with exact control counts, and the write-rules module as its own `KEY_SOURCES` entry: the failure-to-message union cannot live in a `.tsx`, so there are **three** new sources, not two. Where the prose states a count it must state the number actually asserted. The show-once sweep forbids persisting the credential **and logging it** — `console` puts the one unrecoverable value somewhere readable while every current assertion stays green.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts` — every new key sanctioned and every new Croatian word counted, **including the words the refusal messages introduce**. A word in `hr.json` and in neither list lets a hard-coded rendering of that refusal ship unnoticed.
- [x] `test/rls-isolation.test.ts` — over both fixtures: an admin creates and reads back a member; a `member_role` caller's insert and update are refused; a caller cannot insert into another organization; two usernames differing only in case are refused; demoting the only admin raises `ORGANIZATION_WOULD_HAVE_NO_ADMIN`. The username/address invariant check is **scoped away from throwaway rows**, which are deliberately created with unrelated usernames — otherwise a run that dies before cleanup leaves the next run red on the invariant rather than on what broke.

**Acceptance Criteria:**
- Given an admin and a person with no email address, when the admin creates them, then the account exists, is usable at its issued username, and its `members.email` is null.
- Given any successful create, when the auth account is made but the `members` row is refused, then the auth account no longer exists — no account can sign in and reach nothing.
- Given a `member_role` session or an admin of another organization, when either calls the function directly with a valid payload, then it is refused against the database rather than the request and nothing is written.
- Given an admin editing only a name, level or leave allowance, when the form is saved, then the privileged function is not called at all.
- Given an admin changing a username, when the auth call fails after the row was written, then the row is restored and the failure is named rather than leaving the two stores disagreeing.
- Given an edit whose ordinary fields were saved and whose rename was refused, when the refusal is shown, then it says both what was written and what was not.
- Given a generated password, when the create succeeds, then it is displayed exactly once and no later read — and no log — can recover it.
- Given the only admin in an organization, when an admin tries to demote them, then the database refuses at commit.
- Given a username already issued in that organization in any casing, when another is created with it, then it is refused.
- Given an organization read that has settled failed, when the create screen renders, then it shows a message and no usable form.
- Given either new screen at phone width, when it is used, then every control clears 44 px and the whole task completes without a horizontal page scroll.

## Spec Change Log

### 2026-09-18 — iteration 0, three adversarial layers, bad_spec loopback

**Why this looped back rather than patched.** Four findings were demonstrated, not argued — the reviewer changed one value and the whole suite stayed green. `ADMIN_ROLE` set to `'administrator'` left 1412/1412 passing while the boundary would answer `403 NOT_AN_ADMIN` to every legitimate admin, so no account could ever be issued (re-verified here before reverting). Renaming the *value* of `MEMBER_CREATED` reports a successful create as a service failure and discards the generated password — the one value this story documents as unrecoverable — with both suites green, because the function's tests compare replies to the constant they imported and the client's tests compare against their own copies of the literal. `split_part(u.email, '@', 1)` changed to `, 2)` stayed green because `supabase db reset` applies migrations before `seed.sql`, so `members` is empty when `0007` runs and the "invariant" test compares a seed value against itself. Swapping `admin_username` for `admin_name` in the provisioning script stayed green for the same reason: nothing reads `members.username` back.

**The cause is one class, not four instances:** assertions that compare a value to itself. This is the class story 1.5a looped back for, and 1.5a's round two found three more of it — which is why the fix there closed the class rather than the instances. Patching these four would repeat 1.5a's round one exactly.

**What was amended.** The spec now requires that every constant deciding a security outcome or crossing the function↔SPA wire is pinned to the value the database or the client actually carries, and that one contract case binds the two vocabularies in the file that can import both trees. The `0007` backfill must be executed over a row by a test that reads the statement from the migration file. `username` gains a CHECK constraint and a case-insensitive unique index, because the RLS update policy admits a direct PostgREST PATCH that the function's regexes never see, and because `Ana.Kovac` and `ana.kovac` build the same address (human decision). The create screen must copy `organizacija.tsx:551-561`'s read gating in full and its "is there anything to seed this form from" decision moves into `write.ts` where a test can execute it. An edit reports a partial save when the ordinary fields were written and the rename refused (human decision). The handler's dispatch is wrapped so a throw becomes a coded, CORS-carrying reply. A duplicate address is recognised by GoTrue's code rather than by `status === 422`. The show-once sweep forbids logging the credential as well as persisting it. Smaller corrections: `aria-sort` only on sortable columns, `editFailureOf` mapping `23502`, an unknown member id getting its own code, both forms offering a way back, the edit form's inputs remounting with the row, three `KEY_SOURCES` entries rather than two, and every figure in `password.ts` computed from the literal rather than asserted beside it.

**Known-bad state avoided.** A privileged boundary that refuses every administrator with a green suite; a successful account creation reported as a failure while the only copy of the password is thrown away; a migration that silently writes the domain part as everyone's username; a provisioned admin whose stored username authenticates nothing; an account-issuing form that is fully usable and completely inert; a username rule enforced everywhere except the path an admin can actually take; and a credential that is shown once and then written to the console.

**KEEP — must survive re-derivation.**
- **The two-client division and the compensating writes.** The privileged client for `auth.admin.*` only, the caller's JWT for every `members` write, the auth account created before the row because the foreign key forces it, the `members` row moved before the address because the unique constraint is the gate, and a distinct code when a compensation itself fails. This was right and the reviewers did not dispute it.
- **The slug read from `organizations` as the caller** rather than taken from the payload, so the address namespace is the database's choice.
- **`authorize.ts` as a separate pure module** over a narrow structural interface, refusing active, admin and same-organization each as one indistinguishable `NOT_AN_ADMIN`.
- **Rejection sampling in the password generator**, and the injected byte source that proves the generator consumes it. Only the arithmetic in the prose was wrong, not the method.
- **The edit path skipping the function when the username is unchanged**, executed rather than regexed. This was the story's central branch and it was built correctly.
- **`0007`'s own reasoning** about why the duplication exists, why no constraint can span the `auth` boundary and why it is not a view. The column gains constraints; the argument stays.
- **The three findings this review rejected as unreachable** and which must not be "fixed" on re-derivation: the password loop cannot hang from `cryptoRandomBytes` (~10.9% of bytes are discarded); the backfill cannot meet a null email, because all three account-creation paths synthesize an address; and two members of one organization cannot share a local part, because that would be one address and GoTrue's unique email index already forbids it.


## Design Notes

**Why `username` becomes a column rather than staying derived.** `deferred-work.md:286` handed this decision to story 1.5 and named the cost of leaving it alone: the list "cannot show or search usernames without joining `auth`". An admin whose job is issuing credentials to several hundred people needs to answer "what is my username?" without a database console. The column duplicates the local part of `auth.users.email`, and nothing in PostgreSQL can enforce that equality across the `auth` boundary — which is precisely why `updateUserById` writes both and why the compensating restore exists. Human decision 2026-09-18.

**Why the two writes are ordered the way they are, in each direction.** On create the order is forced: `members.auth_user_id` is `not null references auth.users(id)` (`0002:128`), so the auth user must exist first, and the only available compensation is deleting it when the row is refused. On a username change the order is chosen: the `members` row goes first because `unique (organization_id, username)` is the real gate, so a collision is refused before any auth state moves. Neither pair is a transaction and the spec does not pretend otherwise — each names its compensating action and a distinct code for the case where the compensation itself fails, so the disagreement is visible rather than silent.

**Why the edit path usually skips the privileged function.** `members_update_by_own_active_admin` (`0003:331-351`) already admits an active admin to every column of every row in their organization, so routing an ordinary edit through the secret-key boundary would widen that boundary's blast radius for nothing. The function is reached only when the sign-in identity changes, which is the one thing RLS cannot do. This is the story's central branch and `write.test.ts` executes it rather than matching source text — the lesson 1.5a's loopback paid for.

**Why the password is generated rather than typed.** One admin issuing several hundred credentials converges on one password reused across the organization. Generating it in the function keeps it out of the form, out of the client, and out of any log, and the show-once surface is the shape the deferred reset story copies. Human decision 2026-09-18.

**Why the username gets a shape and a case-insensitive unique.** The function normalizes and validates a username, but `members_update_by_own_active_admin` (`0003:331-351`) admits an active admin to every column through PostgREST, so a rule that lives only in the function is a rule the one caller who can break it never meets. Case matters for the same reason the constraint is scoped to the organization: `Ana.Kovac` and `ana.kovac` are two rows and one address, so a case-sensitive unique lets the database hold a collision the address space cannot. `0007` has not been promoted past local, so it is still the file this belongs in rather than an `0008` correcting it. Human decision 2026-09-18.

**Why a refused rename reports a partial save.** The ordinary fields are written before the username moves, so a refusal leaves four values genuinely in the database and the sign-in identity genuinely unchanged. A flat failure is not wrong about the username but is silent about the rest, and the admin's next move — reopening the form — shows them the new values with no explanation of why the username is not among them. Naming both halves is the same stance the boundary already takes when a compensation fails: make the disagreement visible rather than tidy. Human decision 2026-09-18.

## Verification

**Commands:**
- `nvm use && node -v` — expected `v24.19.0`. Confirm rather than assume.
- `supabase db reset` — expected exit 0, `0007` applies, both fixtures load with usernames populated.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — expected all exit 0, no skips, counts above the **1286 / 924 / 4** baseline. Build precedes test.
- `git diff --stat package.json pnpm-lock.yaml apps/web/package.json` — expected **empty**. This story adds no dependency.
- Mutation probes — each must fail the suite: drop the AD-16 authorization check entirely; authorize against a field in the request body instead of the database; use the privileged client for the `members` insert; skip deleting the auth user when the members row is refused; replace the password generator with `Math.random`; let the edit path call the function when the username is unchanged; remove the unique constraint.
- **The four probes iteration 0 shipped green — each must now fail:**
  - Change `ADMIN_ROLE` to any value other than the one `members.role` carries, or `CURRENT_MEMBER_ACCESS` to any other function name.
  - Rename the *value* of `MEMBER_CREATED`, `USERNAME_CHANGED` or `USERNAME_TAKEN` on the function side only.
  - Change `0007`'s backfill from `split_part(u.email, '@', 1)` to `, 2)`.
  - Swap `admin_username` for `admin_name` in the provisioning script's `members` insert.
- Further probes, each of which must fail: make an operation throw and watch for a reply with no code or no CORS headers; render `aria-sort` on the actions column; issue two usernames differing only in case; `console.log` the issued credential; return a form from the create screen after a settled failed organization read.
- `VITE_SUPABASE_URL="" pnpm --filter ./apps/web test src/router.test.ts` — expected exit 0. Neither new guard may need a build environment.

## Suggested Review Order

**Who may write, and how that is decided**

- Start here: AD-16's whole decision, as a pure function a test can execute.
  [`authorize.ts:134`](../../supabase/functions/admin-auth/authorize.ts#L134)

- The literal the database actually carries; pinned, because a rename refused every admin with a green suite.
  [`authorize.ts:45`](../../supabase/functions/admin-auth/authorize.ts#L45)

- An unreadable access row stays distinct from a refusal, so an outage is never a permanent no.
  [`authorize.ts:64`](../../supabase/functions/admin-auth/authorize.ts#L64)

**The two stores, and what happens when one refuses**

- The auth account first, because the foreign key forces that order.
  [`operations.ts:533`](../../supabase/functions/admin-auth/operations.ts#L533)

- The row moves before the address, so the unique constraint is the gate.
  [`operations.ts:654`](../../supabase/functions/admin-auth/operations.ts#L654)

- The compensation, and its own code when the compensation itself fails.
  [`operations.ts:618`](../../supabase/functions/admin-auth/operations.ts#L618)

- The slug is the database's answer, never the caller's claim.
  [`operations.ts:488`](../../supabase/functions/admin-auth/operations.ts#L488)

- A throw becomes a coded reply carrying CORS, like every other answer here.
  [`handler.ts:284`](../../supabase/functions/admin-auth/handler.ts#L284)

**The schema that makes an issued credential readable**

- The backfill, lowercased to satisfy the check it is followed by.
  [`0007_member_username.sql:76`](../../supabase/migrations/0007_member_username.sql#L76)

- Shape in the database, not only in the function an admin can bypass via PostgREST.
  [`0007_member_username.sql:88`](../../supabase/migrations/0007_member_username.sql#L88)

**The wire between the function and the SPA**

- One vocabulary, bound in the only file that can import both trees.
  [`wire.ts:117`](../../apps/web/src/members/wire.ts#L117)

- Read the body on its receiver: detached, every refusal became "try again".
  [`write.ts:143`](../../apps/web/src/members/write.ts#L143)

- Both paths answer the same thing for the same SQLSTATE class.
  [`wire.ts:283`](../../apps/web/src/members/wire.ts#L283)

- The story's central branch: the function is reached only when the identity changed.
  [`write.ts:385`](../../apps/web/src/members/write.ts#L385)

**What the screens do with an outcome**

- The credential is held before the cache is touched, so a refetch cannot destroy it.
  [`ljudi.novi.tsx:193`](../../apps/web/src/routes/ljudi.novi.tsx#L193)

- The refusal, including the partial save, survives a rejecting refetch.
  [`ljudi.$id.tsx:193`](../../apps/web/src/routes/ljudi.$id.tsx#L193)

- A successful edit says so, on a form whose fields remount unchanged.
  [`ljudi.$id.tsx:375`](../../apps/web/src/routes/ljudi.$id.tsx#L375)

**What the tests pin**

- A real `Response`, because the arrow-closure stub hid a runtime TypeError.
  [`write.test.ts:198`](../../apps/web/src/members/write.test.ts#L198)

- Every code the function emits is a code the client matches.
  [`write.test.ts:218`](../../apps/web/src/members/write.test.ts#L218)
