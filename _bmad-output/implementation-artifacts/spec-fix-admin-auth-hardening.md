---
title: 'admin-auth refuses malformed requests early, logs only codes, and the SPA ships its security headers'
type: 'bugfix'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '66a29f6612f48502b703c955cd7c4e6e90ee6a53'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
  - '{project-root}/DEPLOY.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A deferred-work triage on 2026-09-27 grouped four boundary-hardening entries as "package 1b". All are still real on main:
1. **Request hardening** ("Add request hardening to `admin-auth` — a `content-type` check, a body-size bound, and abuse control…"). `handler.ts` calls `request.json()` with no content-type check and no size bound.
2. **Log policy** ("Constrain what `admin-auth` writes to its logs — codes, never operands or key material"). Some `console.error` calls log a whole `cause` or an operand:
   - `handler.ts:239` and `:283` log `cause`;
   - `authorize.ts:143` and `:158` log `cause` and `answered.error`;
   - `operations.ts:728` and `:843` log `accountId` and `memberId`.
3. **Non-UUID memberId** ("A `memberId` that is a well-formed string but not a UUID reaches Postgres and returns as an outage…"). `operations.ts` parses `memberId` without a UUID check.
4. **Security headers** ("Add `apps/web/public/_headers` with a Content-Security-Policy and the standard security headers"). `apps/web/public/` has only `_redirects`.

**Approach:**
- **Request hardening:** before parsing, refuse a non-`application/json` content type and a body over a small fixed bound, for example 16 KiB. Read the body as text with the bound, then parse it. Each refusal maps to an existing refusal code where one fits (e.g. `PAYLOAD_INVALID`), or a new stable code with an HTTP status in the boundary's existing style. Rate limiting is out of scope: it is an ops or platform decision. Leave that part in `deferred-work.md`, reworded to say so.
- **Log policy:** every `console.error` in `supabase/functions/admin-auth/` logs only a stable code plus non-sensitive scalars: an error `code`, an HTTP `status`, an operation name. Never a whole error object, cause, user-supplied operand, id, username, password or key. Pin this with a source guard over the function's files.
- **Non-UUID memberId:** a `memberId` that is not a UUID answers the same refusal an unknown member gets today, before any query.
- **Security headers:** add `apps/web/public/_headers` for all paths with:
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: DENY`
  - a restrictive `Permissions-Policy`

  A full CSP needs the deployed Supabase origin in `connect-src` and `img-src`, and cannot be verified while deploys are off. Add it only if it can be derived at build time and checked by a test. Otherwise leave a reworded deferred-work entry, "CSP pending a deployed origin to verify against".

## Boundaries & Constraints

**Always:**
- **Tests:**
  - Unit or boundary tests in the existing `test/admin-auth-boundary.test.ts` style cover: wrong content type, oversized body, non-UUID `memberId` on each operation that takes one, and a well-formed request still succeeding.
  - A test asserts that `_headers` exists, carries each header, and is copied into `apps/web/dist` by the build.
- Every refusal keeps the boundary's existing shape: `{ code }`, CORS headers, and the status conventions in `handler.ts`.
- Mutation proof: remove each check and show its test fails.
- Remove or reword the deferred-work entries this closes.

**Ask First:**
- Any change to `config.toml` `verify_jwt` or to CORS or the allowlist. Those are separate open decisions.
- Any header or CSP that could break the SPA's own requests (Supabase REST, auth, storage, fonts).

**Never:**
- No change to what the operations do on valid input.
- No new UI text.

</frozen-after-approval>

## Code Map

- `supabase/functions/admin-auth/handler.ts` -- request parsing (`request.json()`), status mapping, logs at 239, 283 and 292.
- `supabase/functions/admin-auth/authorize.ts` -- logs at 143, 152 and 158.
- `supabase/functions/admin-auth/operations.ts` -- the `memberId` parsers (about 529-573); logs at 608-994.
- `supabase/functions/admin-auth/index.ts` -- config log.
- `test/admin-auth-boundary.test.ts` -- the existing boundary tests.
- `apps/web/public/_redirects` -- the only public file today; the build copies `public/` into `dist/`.
- `DEPLOY.md` -- mention the headers file where hosting is described.

## Tasks & Acceptance

**Execution:**
- [x] Add the content-type and size checks.
- [x] Apply the log policy and add its source guard.
- [x] Add the UUID check.
- [x] Add `_headers` and its test. Decide on the CSP.
- [x] Clean up `deferred-work.md`.

**Acceptance Criteria:**
- Given each fix reverted, when the new tests run, then they fail.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test` (after a web build) and `pnpm test:e2e` run, then all pass.

## Spec Change Log

- 2026-09-27, implementation choices, recorded after review:
  - **Refusal codes.** A wrong media type is `415 CONTENT_TYPE_UNSUPPORTED`, and a body over 16 KiB (`BODY_LIMIT_BYTES`) is `413 BODY_TOO_LARGE`. Both are new transport codes, because no existing code fits "too large", and a separate code points an operator at the right cause. They are listed in `TRANSPORT_CODES` and in the SPA's `WIRE_CODES`, where they fall through to the existing "unavailable" message, so there is no new UI text. A stream that errors while it is read keeps `400 BODY_NOT_JSON`. The media type is checked before the size, and the size before the parse. A declared `content-length` counts only when it is strictly digits; otherwise the bound on the bytes read decides. Cancelling the stream is best effort and cannot change the code.
  - **UUID form.** `isUuid` accepts the canonical hyphenated form only (8-4-4-4-12 hex, any case). This is intentional: the SPA sends only ids it read back from PostgREST, which prints them this way. A bare 32-hex id or a braced one is refused as `MEMBER_UNKNOWN`, the reply an unknown member gets.
  - **CSP.** Deferred ("CSP pending a deployed origin to verify against"): it needs the deployed Supabase origin, and a wrong policy breaks the SPA's own requests (an Ask First item).

## Verification

**Executed mutants** (each planted, its test file run, then restored; all 30 were killed):

| # | Mutant | Killed by |
|---|---|---|
| 1 | `await reader.cancel()` inside the decision | cancel rejects → still 413 |
| 2 | `content-length` read with `Number()` | 4 non-digit declared-length cases |
| 3 | `NO_ROW` token dropped | restore-matched-no-row log test |
| 4a | parse before the bound | bound-before-parse, declared-length, cancel and stop-reading tests |
| 4b | size checked before media type | oversized `text/plain` → 415 |
| 5 | full buffer, counting characters | bytes-not-characters, stop-reading, stream-error, declared-length tests |
| 6 | full buffer, counting bytes | stop-reading, stream-error, declared-length tests |
| 7 | stream error answered as 413 | stream error → 400 `BODY_NOT_JSON` |
| 8a | declared-length check dropped | declared-over-bound, no read |
| 8b | stream bound dropped | 7 oversized-body tests |
| 9a–9d | `console.error` alias, `globalThis.console`, `console['error'](…, cause)`, a caps identifier that is not a code | log source guard (plus the run-time test for 9c) |
| 9e | `codeOf` returns a non-string code | `codeOf` unit test |
| 10a–10d | log the cause in authorize, `answered.error` in authorize, the cause in the construction catch, the cause in the dispatch catch | source guard plus the matching run-time log test |
| 11, 11b | a non-UUID id answers 400, not 404 (rename, reset) | non-UUID and same-reply tests |
| 12a, 12b | a later `_headers` block detaches or overrides `X-Frame-Options` | static-hosting header tests |
| orig | content-type check dropped; UUID check dropped (×2); `accountId` or `memberId` logged; `X-Frame-Options` removed; `Permissions-Policy` weakened | their original tests |
| orig | `dist/_headers` deleted | dist copy test |

**PR note:** in CI, E2E serves `admin-auth` from the branch under test. Locally the shared stack's edge runtime serves the main checkout's `supabase/functions` (`reuseExistingServer`), so the local E2E pass shows that the SPA still works, and the new handler was covered by the boundary suite.

**Commands:**
- `pnpm typecheck`, `pnpm lint` -- expected: exit 0.
- `pnpm test` -- expected: pass, after a rebuild.
- `pnpm test:e2e` -- expected: all pass.

## Suggested Review Order

1. `supabase/functions/admin-auth/handler.ts`: the content type check, then the strict `content-length`, then the byte-bounded stream read (best-effort cancel), then `JSON.parse`. Also the code-only logs.
2. `supabase/functions/admin-auth/operations.ts`: `isUuid` before any query, and the id-free logs.
3. `supabase/functions/admin-auth/authorize.ts`: `codeOf` and the code-only logs.
4. `test/admin-auth-boundary.test.ts`: the transport cases, the log-policy source guard and its self-tests, and the run-time log spies.
5. `apps/web/public/_headers` and `test/static-hosting.test.ts`.
6. `apps/web/src/features/members/services/wire.ts`: the two new codes in `WIRE_CODES`.
