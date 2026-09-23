---
title: 'Story 1.5c: An admin issues a new password to a member'
type: 'feature'
created: '2026-09-18'
status: 'done'
review_loop_iteration: 1
baseline_commit: '750bb11a2c1d462fc4f74ce46da8bace382ee477'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An account with no email address has no self-service recovery, so a member who loses the credential issued at creation cannot sign in again and no admin can help them. `createUser` hands the password over exactly once (`operations.ts:626-635`) and story 1.5's acceptance clause 1 — "its password reset is an admin-issued action rather than a self-service email" (CAP-1, AD-12) — is the last unbuilt half of that clause.

**Approach:** Add one operation, `resetPassword`, to the privileged boundary: it authorizes against the database, generates a password with the existing generator, sets it through `auth.admin.updateUserById`, and revokes the member's existing sessions. Expose it on the existing member edit screen as a two-step confirm, showing the new password once in the shape the create screen already uses.

## Boundaries & Constraints

**Always:**
- Authorize against the database, never the request: read the target member's row as the caller to get its organization and `auth_user_id`, then `authorizeAdminOf` against **that** organization (the ordering `updateUserById` uses at `operations.ts:668-691`).
- The privileged client is used for `auth.admin.*` and nothing else; the caller's JWT client performs the one read.
- Reuse `generatePassword` (`password.ts:121`). A second generator is a defect.
- **A reply is a success only when the auth store says an account was updated.** A `200` whose body carries a password no account received is worse than any refusal: the admin reads it out and the member is locked out.
- **Revoke every existing session as part of the reset.** A reset issued because a credential is compromised is worthless while a session minted from that credential still authenticates. Human decision 2026-09-22.
- **An admin may reset their own password.** `/ljudi/$id` serves the caller's own row; the offer stands there, the revocation signs them out too, and that is coherent rather than an accident. Human decision 2026-09-22.
- The password travels to GoTrue and to the reply, nowhere else: never a log argument, never `user_metadata`, never browser storage, never the query cache.
- Errors are `{ code, ...operands }` with stable SCREAMING_SNAKE codes, translated only at the edge.
- Every user-facing string goes through `t()`, registered in `hr.json`, `SANCTIONED_SCREEN_KEYS`, `AUTHORED_VOCABULARY` and `KEY_SOURCES` **in the same commit**.
- The decision of which stage is showing is a pure function in `write.ts`, executed by a test — AD-15 renders no `.tsx`.
- Every new control carries a height class resolving to >=44 px (`h-11`).

**Ask First:**
- Any rate limit or audit record on the reset — neither exists on any operation today.
- Returning the member's username in the reply (the edit screen already displays it).

**Never:**
- No migration. `members` carries no password, reset-timestamp or audit column (`0002:115-158`) and this story adds none.
- No `ban`/`unban` — they stay at 501 and keep `STILL_UNIMPLEMENTED` (`admin-auth-boundary.test.ts:117`) pointing at `ban`.
- No Dialog primitive, no `window.confirm`, no new route, no search param.
- No compensating write or partial-save code: one store is written, so a disagreement is unrepresentable.
- No admin-typed password, and no reuse of the create screen's `ljudi.form.credential` ("Početna lozinka" — initial) for a reset.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reset succeeds | Active admin, member in own organization | 200 `{ code: PASSWORD_RESET, password }`; new password grants, old one refused | N/A |
| Sessions after a reset | Member held a live session or refresh token | Every session is revoked; the old token no longer authenticates | Revocation failure is reported, not swallowed |
| Admin resets their own row | Caller is the target | Succeeds like any other reset; the caller's own sessions are revoked too | N/A |
| Auth store reports no account | GoTrue answers `error: null` with no user | 502 `PASSWORD_NOT_APPLIED` — never 200 | No password is returned or shown |
| Caller is `member_role`, inactive, or another organization's admin | Valid payload sent directly | 403 `NOT_AN_ADMIN`, nothing written | One indistinguishable code — no oracle |
| Member id reaches no row | Unknown or other-tenant id | 404 `MEMBER_UNKNOWN` | Distinct from `NOT_AN_ADMIN` |
| Access row unreadable | RPC fails | 503 `ACCESS_UNREADABLE` | An outage is never a permanent no |
| GoTrue refuses the password set | Auth call returns an error | 502 `PASSWORD_NOT_APPLIED`, cause logged without the password | Nothing to compensate — no row was written |
| Payload missing `memberId` | `{}` | 400 `PAYLOAD_INVALID` | Checked before any read |
| Reply carries no password | 200 with absent/empty/non-string `password` | Treated as failure, not success | Mirrors `write.ts:461-472` |
| Reset in flight | Confirmation pressed, request outstanding | The confirmation stays on screen, busy and not pressable; the offer does not reappear | Re-entry refused by the ref |
| Credential shown, list refetches | The read re-settles or drops the row | The shown password stays on screen | It is the only copy |
| Credential dismissed | Admin closes the panel | The reset returns to its offer; the password is gone from state | A second reset is then possible |

</frozen-after-approval>

## Code Map

**Baseline `750bb11a2c1d462fc4f74ce46da8bace382ee477`**, green: **1462 root / 1122 web / 4 domain**, measured at this baseline. (1.5b's Code Map reported 1286/924/4; that was measured at `81b76c3`, before 1.5b's own tests landed — do not copy that pair forward.) `nvm use` first (Node 24.19.0). `pnpm build` **before** `pnpm test` — the freshness guard at `localization-applied.test.ts:238` fails rather than skips on a stale `dist/`.

### The boundary

- `handler.ts:29` `OPERATIONS`, `:48` `IMPLEMENTED_OPERATIONS` — both gain `resetPassword`; `:44` `UNIMPLEMENTED_OPERATIONS` does **not**. Dispatch is two hand-written `if`s at `:273-278`; 501 is pure fall-through at `:291`, so nothing is removed.
- Clients are constructed at `handler.ts:242-244` and cast at `:260-261` — **reuse those values, do not call the factories again.** (1.5b's Code Map said `:180-181`; that is the middle of `respond()` and is wrong.)
- `reply` `handler.ts:204-205`; the dispatch try/catch `:270-285` already turns a throw into a CORS-carrying `OPERATION_FAILED`.
- `operations.ts:668-687` — the read-target-then-authorize sequence to copy. `authorizeAdminOf` `authorize.ts:134`; `authorizationRefusal` `operations.ts:345-349`.
- `operations.ts:237-248` `PrivilegedAccounts` already types `updateUserById` as `Readonly<Record<string, unknown>>`, so `{ password }` needs no interface change. **Session revocation needs a new member on that interface** — name only what is called, as the interface already does. Do **not** attach to `updateUserById` itself (`:710-713`): that call sits inside the rename compensation `:715-737`.
- **`createUser` proves its write landed via `accountIdOf` on the returned user; the reset must prove its own the same way.** Checking `error !== null` alone lets `{ data: { user: null }, error: null }` through as a success.
- `operations.ts:113-130` `OPERATION_CODES` — the contract test binds this to the SPA's `WIRE_CODES`.
- `password.ts:121` `generatePassword(randomBytes = cryptoRandomBytes)`; `PASSWORD_LENGTH` `:75` = 16. Mirror `CreateDependencies`' `randomBytes?: ByteSource` (`operations.ts:516`) so the suite can prove consumption.

### The surface

- `apps/web/src/members/wire.ts` — `RESET_PASSWORD_OPERATION` beside `:29-30`; success gate beside `:34-36`; `MemberWriteFailure` union `:94-105`; `WIRE_CODES` `:117-146`; `memberWriteMessageKey` `:324-368` with the new key **as a literal in the return signature** (`:335-346`) or the key sweep goes blind.
- `apps/web/src/members/write.ts` — `renameMember` `:306-332` is the template. Outcome mirrors `MemberCreateOutcome` `:412-414`; `IssuedCredential` `:407-410`. `raisedForMember` `:613`, `memberFormKey` `:636`.
- `apps/web/src/routes/ljudi.$id.tsx` — attach **outside** `<form>`: its own block in `CardContent` after `{renderBody()}` `:378`, before the back link `:379-384`. Inside the actions grid `:323-331` a button submits, and `key={memberFormKey(member)}` `:227` remounts on refetch. State scoped through `raisedForMember(..., id)` `:96-99`. One `role="alert"` region only `:355-365`; the panel uses `role="status"`.
- `apps/web/src/routes/ljudi.novi.tsx:230-249` — the show-once panel to copy: a `renderX()` function (not an inline ternary — L2 refuses a literal in a nested branch), `role="status"`, `break-all font-mono text-base`.
- **No confirm-in-place pattern exists anywhere** (`organizacija.tsx:753` records the accent control has none). This story establishes it.

### The stage machine — the root cause of iteration 0

The screen has **four** stages, not three, and each transition is named. A model that cannot represent in-flight forces the pending flag to be read by a control that has already unmounted.

- `idle` — the offer stands.
- `armed` — the confirmation stands, naming the member.
- `busy` — the request is outstanding. **The confirmation stays mounted**, disabled and `aria-busy`; the offer does not reappear. Iteration 0 cleared `armed` before awaiting, so the plain enabled offer rendered mid-flight and `resetPending` was observable by nobody.
- `shown` — the credential stands, and it **outranks every other consideration on the screen**: it survives a refetch, a read that re-settles failed, and a row that vanishes, because it is the only copy. Iteration 0 returned `null` above the stage check when `member === null`, erasing it.
- `shown` ends only by an explicit dismiss that clears the credential from state and returns the block to `idle`. Iteration 0 had no `setIssued(null)` anywhere while its doc comment described one.

The decision stays a pure function in `write.ts`. Its inputs must be sufficient to distinguish all four — a pending flag the component owns and the function never sees is what made iteration 0's in-flight stage unrepresentable.

### Gates

- `prijava.test.ts:284` `expectedControls: 8` for `MEMBER_EDIT` and `:1090` `strings: 10` both rise; `SCREENS` length pinned `:1220`, `KEY_SOURCES` `:1221`. `STRUCTURAL_ATTRIBUTES` `:558-653` excludes `aria-label` and `placeholder` — those must be `t()`. Extend the show-once shape test `:3774` to `MEMBER_EDIT`; `CREDENTIAL_PATH` `:3729-3733` already covers the file.
- **The in-flight sweeps are handler-scoped, and today they are not.** `submitHandler()` `:449-451` matches `function submit(` only; `finallyBlock()` `:471-473` returns the **first** `finally` in the file; the ref-guard sweep `:3028-3031` takes the first match. A second awaiting handler on this screen is invisible to all three, so `IN_FLIGHT_SCREENS` `:340-391` (count pinned `:3002`) counts screens rather than handlers. Widen them or add handler-scoped equivalents, or the reset's lifecycle is asserted by nothing.
- `admin-auth-boundary.test.ts:180` pins the four operation names and `:179`'s title says "four" — both change. Partition `:148` holds; `:157` and `STILL_UNIMPLEMENTED` `:117` are untouched. `post()` `:119-132` takes the payload. Add a dispatch case beside `:1625`/`:1637` and a no-leak pair mirroring `:1703`.
- `resource-hygiene.test.ts` — `SANCTIONED_SCREEN_KEYS` `:70-338` (exhaustive sorted equality `:428-432`); a new action label earns its own `toBe` pin in the imperative block `:537-575`. **Its prose enumerations at `:239` and `:299` state exact counts and must move with the lists they describe.**
- `localization-applied.test.ts` — `ljudi.$id.tsx` already in `SOURCES` `:182`; any **new** module must be appended. `AUTHORED_VOCABULARY` `:435-653` needs each new Croatian word at an exact count, **and the comment announcing how many are added must match the list**. `Nema` is a banned substring `:671/:705`.
- `rls-isolation.test.ts:4163` — the "an issued account actually signs in" describe to mirror. `tokenFor` `:298`, `addThrowawayMember` `:694`, cleanup `:761-809`; the username invariant `:3841-3876` stays scoped away from throwaway rows.
- `router.test.ts` — **no edit**. `LEVEL_GUARDED_ROUTES` stays at 3 (`:1528`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/functions/admin-auth/operations.ts` — `resetPassword` as a pure function over narrow interfaces: parse `{ memberId }`, read the member as the caller, authorize against the row's organization, generate, set the password, **prove an account came back before replying 200**, then revoke sessions. Its own dependencies interface carrying `randomBytes?: ByteSource`. Add its codes to `OPERATION_CODES`.
- [x] `supabase/functions/admin-auth/operations.ts` — **revoke the member's sessions** through the privileged client, naming the call on the narrow interface. A revocation that fails is reported, never swallowed: the credential has already changed, so silence would leave the admin believing the old session is gone.
- [x] `supabase/functions/admin-auth/handler.ts` — add to `OPERATIONS` and `IMPLEMENTED_OPERATIONS`, dispatch it, reuse the clients at `:242-244`.
- [x] `supabase/functions/admin-auth/operations.ts:531` — correct the comment attributing the reset to story 1.6; `epics.md` story 1.5 clause 1 owns it. Same at `apps/web/src/members/write.ts:404`, `apps/web/src/members/list.ts:33-37` and `prijava.test.ts:1080-1081`.
- [x] `test/admin-auth-boundary.test.ts` — every row of the I/O matrix, including the `error: null` with no user row and the revocation; the five-name `OPERATIONS` pin and its reworded title; a dispatch case; the no-leak pair. **Pin every security-deciding constant and every value crossing the wire to what the database or the client actually carries, never to itself.**
- [x] `apps/web/src/members/wire.ts` — operation name, success gate, failure codes, `WIRE_CODES`, and the message-key mapping with its literal in the return signature.
- [x] `apps/web/src/members/write.ts` — `resetPassword(functions, memberId)` beside `renameMember`; a success carrying no password is not a success; **the stage function deciding all four stages of the Code Map's stage machine**, including dismissal.
- [x] `apps/web/src/members/write.test.ts` — **assert the outbound operation name as a spelled-out literal**, the way `:521` and `:729` do for the two siblings; a constant compared to itself is the defect this story was looped back for. Plus every outcome through `functionsThat` `:141-160`, one `refusedForReal` `:198-209`, the no-password success, the code-it-logs case, and every stage branch including busy and dismissal.
- [x] `apps/web/src/routes/ljudi.$id.tsx` — the reset block outside `<form>`: a control whose accessible name distinguishes the member, a confirm/cancel pair replacing it, a busy state that keeps the confirmation mounted while the request is outstanding, the show-once panel, and a dismiss returning to the offer. The panel renders whatever the read is doing. Nothing persisted, nothing logged.
- [x] `apps/web/src/i18n/locales/hr.json` — a `ljudi.form.reset*` group plus `ljudi.form.error.reset*` and a dismiss label, imperative action labels, informal second person, no `!`, en dash in any range, no form of `Nema`.
- [x] `apps/web/src/routes/prijava.test.ts` — raise `expectedControls` and `strings` to the numbers actually asserted **and update the prose at `:276-283` that explains them**; extend the show-once shape test to the edit screen; sweep the confirm pair, the busy state and the dismiss.
- [x] `apps/web/src/routes/prijava.test.ts` — **make the in-flight sweeps reach `issue()`**: the ref guard, the `finally` clearing both flags, and the refused branch, asserted for the reset handler and not only for `submit`.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts` — sanction every new key, pin the new action labels, count every new Croatian word, **and correct every prose count these files state about themselves**.
- [x] `test/rls-isolation.test.ts` — over both fixtures: an admin resets a member of their own organization and the new password grants while the old is refused; **a session held before the reset no longer authenticates after it**; a `member_role` caller and a foreign admin are both refused; the reset writes no `members` row.

**Acceptance Criteria:**
- Given a member who has lost their password, when their admin resets it, then a new password is shown exactly once and the member signs in with it.
- Given any successful reset, when the member tries the previous password, then authentication is refused.
- Given a member holding a live session, when their password is reset, then that session no longer authenticates.
- Given an admin on their own row, when they reset their own password, then it succeeds and their own sessions are revoked with it.
- Given the auth store answering without an account, when the reset completes, then no password is shown and the failure is named.
- Given a `member_role` session or an admin of another organization, when either calls `resetPassword` directly with a valid payload, then it is refused against the database and no password changes.
- Given a reset, when the `members` table is inspected, then no row was written — the credential lives only in `auth.users`.
- Given a reset in flight, when the admin looks at the screen, then the confirmation is still there, busy and not pressable, and the offer has not reappeared.
- Given a shown credential, when the list refetches or the read re-settles failed, then the password is still on screen.
- Given a shown credential, when the admin dismisses it, then the reset returns to its offer and the password is gone.
- Given the reset control, when it is activated once, then nothing is reset until a second, distinct confirmation naming the member.
- Given the edit screen at phone width, when the reset is used, then every control clears 44 px with no horizontal page scroll.

## Spec Change Log

### 2026-09-22 — iteration 0, three adversarial layers, bad_spec loopback

**Why this looped back rather than patched.** Five findings shared one root cause: the spec named three stages — idle, armed, shown — and said nothing about the transitions between them, what the shown panel must survive, or how it ends. Every serious defect fell in that gap. `issue()` cleared `armed` before awaiting, so `resetStageOf(false, null)` returned idle for the whole request: the confirm pair carrying `disabled={resetPending}` unmounted and the plain **enabled** offer rendered in its place, making `resetPending` observable by nobody. `renderReset()` returned `null` when `member === null` above the shown branch, so a refetch erased the only copy of the credential. No `setIssued(null)` existed anywhere while the stage function's own doc comment described a dismiss control. Patching these individually would bolt a fourth flag beside a model that cannot express the state — which is what story 1.5a's round one did before its round two found three more of the same class.

**The verification defect, separately.** `write.test.ts:978` asserted the outbound body against `{ operation: RESET_PASSWORD_OPERATION }` — the constant compared to itself — while both siblings pin the literal (`:521`, `:729`). Misspelling `wire.ts:34` would make every browser reset arrive as an unknown operation, fall through `memberWriteFailureOf` to `MEMBER_WRITE_UNAVAILABLE`, and show "try again" forever to an admin whose member has no other recovery route, with the whole suite green. This is the exact class the epic looped back for twice, reintroduced in the one place the spec did not name.

**Two intent gaps, resolved by the human 2026-09-22 and now in the frozen block.** Sessions are revoked as part of the reset, because a reset issued against a compromised credential is worthless while a session minted from it still authenticates. An admin may reset their own password, sessions included.

**What was amended.** The Code Map gained the four-stage machine as an explicit section, naming each transition and stating that the shown credential outranks every other consideration on the screen; the function must prove an account came back before replying 200, the way `createUser` already does; the outbound operation name must be a spelled-out literal in the test; the in-flight sweeps must reach `issue()`, since `submitHandler`, `finallyBlock` and the ref-guard sweep are all scoped to the first match and cannot see a second handler; prose enumerations in `resource-hygiene` and `localization-applied` must move with the lists they describe; and the Verification section's stale 1286/924/4 baseline was corrected to 1462/1122/4.

**Known-bad state avoided.** A reset that hands over a password no account received; a credential erased by a background refetch before it is read; a panel that can never be dismissed and so blocks a second reset; a busy state no control can render; an operation name that can be misspelled into permanent failure with a green suite; and a compromised session surviving the reset that answered it.

**KEEP — must survive re-derivation.**
- **The boundary's authorization order**: read the member as the caller, resolve the organization from the row, authorize against that — never the request body. Correct in iteration 0 and undisputed.
- **`generatePassword` reused unchanged** with the injected byte source, generated only after the gate so a refused caller never causes a credential to exist.
- **No compensating write and no `saved: true`** — one store is written, and iteration 0's explicit test that a reset never reports a partial save was right.
- **The reset block placed outside `<form>`**, positionally asserted between `renderBody()` and the back link; inside the actions grid a button submits and `memberFormKey` remounts it.
- **State scoped through `raisedForMember`** so an armed confirmation or a credential cannot cross from one member's screen to another. The cross-member leak a reviewer alleged does not exist, and the scoping is why.
- **No `invalidateQueries` after a reset** — it writes no `members` row, so a refetch would be a render the shown credential must survive for no reason.
- **The four-variant no-password-success guard** (absent, empty, non-string) and the `it.each` mapping every wire code to its failure.
- **The `list.ts` misattribution fix** — a fourth site the spec had not enumerated, correctly found.

### 2026-09-23 — iteration 1, one targeted verification-gap layer, 3 patches

**Not a loopback.** The re-derived code held: all five iteration-0 defects were probed and caught, and 17 mutation probes passed. The targeted layer found three more instances of the same class, one demonstrated by mutation — `memberWriteMessageKey` returning the generic `unavailable` for `MEMBER_PASSWORD_NOT_APPLIED` left both suites green, because `EVERY_FAILURE` was never extended and the `never` exhaustiveness check forces *a* branch to exist but not *which* key it returns. So the one refusal on the one surface that recovers an email-less account would have read as an outage.

**Patched, each re-probed.** `EVERY_FAILURE` gained the code, plus a case that DERIVES the expected list from `WIRE_CODES` and `editFailureOf` rather than trusting the hand-written one — the hand-written list is what drifted, so the next code is added by a failing test rather than by memory. `adminKey` gained a presence assertion beside `apiEndpoint`'s: it gates the only cases that verify session revocation, and a CLI key rename would have skipped ~10 of them silently. `renderReset` now branches on `stage` for all four values instead of re-deriving armed-versus-idle inline, so the source sweep and the executed function hold one contract.

**Known-bad state avoided.** A reset failure indistinguishable from an outage; a revocation guarantee that could stop being verified without any failure; and a four-stage decision the screen consulted for only two of its stages.

## Design Notes

**Why a sibling operation rather than a password on `updateUserById`.** The deferred entry proposed "a password field on an `updateUserById` call that already exists". That call is at `operations.ts:710-713`, *after* the members-row write and inside the username-restore compensation `:715-737`, so a password hung there succeeds or fails with a rename the reset never performs. A sibling reuses what actually matters — account-id resolution `:668-687` and the `PrivilegedAccounts` seam `:237-248` — and keeps the reset's failure modes its own.

**Why there is no partial-save code here.** 1.5b needed compensating writes because it touched two stores in sequence. A reset writes one, so there is no state in which the stores disagree and no analogue to `USERNAME_NOT_RESTORED`.

**Why the shown credential outranks the read.** Every other thing on this screen can be recovered by looking again; the password cannot. So the panel is not subordinate to "is there still a row" — a refetch that drops the member, or a read that re-settles failed, must leave it standing. This inverts the gating rule the rest of the screen follows, deliberately.

**What story 1.6 should copy.** `ban`/`unban` are the other half of the same account-lifecycle question on the same function. They should take the four-stage shape this story establishes — a pure stage decision in `write.ts` with the component holding only the inputs — and the same refusal vocabulary. Nothing is abstracted for them here; one example is not a pattern.

## Verification

**Commands:**
- `nvm use && node -v` — expected `v24.19.0`. Confirm rather than assume.
- `pnpm exec supabase start && pnpm exec supabase db reset` — expected exit 0, both fixtures load.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — all exit 0, no skips, counts above the **1462 / 1122 / 4** baseline. Build precedes test.
- `git diff --stat package.json pnpm-lock.yaml apps/web/package.json` — expected **empty**. This story adds no dependency.
- `git status --porcelain supabase/migrations` — expected **empty**. This story adds no migration.
- Mutation probes, each of which must fail the suite: drop the authorization check; authorize against the organization in the request body; use the caller's client for the auth call; replace `generatePassword` with a second generator or `Math.random`; return success without a password; reply 200 when the auth store returned no account; skip the session revocation; `console.log` the password; let the first click reset without confirmation; keep `resetPassword` in `UNIMPLEMENTED_OPERATIONS`.
- **The iteration-0 probes, each of which must now fail:**
  - Misspell `RESET_PASSWORD_OPERATION`'s value in `wire.ts` only.
  - Clear the armed stage before awaiting, so the offer renders mid-flight.
  - Delete `setResetPending(false)` from the reset handler's `finally`, or the `finally` itself.
  - Return `null` from the reset block when the member row is absent while a credential is shown.
  - Remove the dismiss so a shown credential cannot be cleared.
