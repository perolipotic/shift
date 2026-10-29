---
title: 'The outbox and the notify function'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: '7083a986e235e06d4b4847e25a4c157aade5f593'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-10-v1-scope-expansion.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing leaves the app. A member whose leave request is decided learns about it only when they next open *Godišnji*. There is no place a notification can be written, and no runtime that could send one.

**Approach:** Add `notification_outbox` and the second Edge Function, `notify`. The request that asserts a fact writes the outbox row in the same transaction, as a code and operands (AD-18). pg_cron with pg_net invokes `notify` every minute. `notify` claims rows, renders them with the locale messages, sends email through Resend, and writes only delivery columns. The proof event is `decide_leave_request`: the requesting member gets one email saying their request was approved or rejected. 10.2 adds the other events and the final email wording.

## Boundaries & Constraints

**Always:**
- Apply the §5.4 proposal wording to ARCHITECTURE-SPINE.md:
  - AD-14: exactly two functions;
  - AD-17: the Resend and VAPID keys live only in `notify`'s environment;
  - new AD-18;
  - AD-9's "sole exception" becomes both functions;
  - the source tree lists `notify/`;
  - Deferred gains "Shift reminders (needs projection outside the browser)".
- Outbox rows carry no prose and no address. `notify` resolves the email, locale and timezone at send time through one service-role-only claim RPC.
- `notify` writes only through two RPCs, `claim_notifications` and `settle_notification`, both executable by `service_role` only. It reads no table directly and computes no domain answer.
- At-most-once per recipient and channel:
  - a unique key (`code`, `subject_id`, `recipient_member_id`, `channel`);
  - a claim lease with `FOR UPDATE SKIP LOCKED`;
  - Resend's `Idempotency-Key` header set to the row id;
  - at most 5 attempts.
- A failed send never blocks or rolls back the decision.
- Text comes from the `obavijesti` namespace in `hr.json`, through a copy in `notify` pinned by a root test (the admin-auth precedent). It is plain `{name}` interpolation only, with dates formatted the way the SPA's `formatIsoDate` formats them.
- No secret value or secret name appears in `.sql`, `.toml` or `apps/web`. The cron job reads the function URL and the invoke secret from Vault.

**Ask First:** Writing outbox rows from any write other than `decide_leave_request`. Adding a push send path. Changing `admin-auth`.

**Never:** Push delivery (10.4). Settings (10.3). Other events (10.2). Notifying the `deactivated` outcome of the 0041 trigger. Outbox retention or cleanup. Any SPA surface change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Decided | Admin approves or rejects a pending request | Same transaction inserts one `email` row: code `LEAVE_REQUEST_APPROVED` or `LEAVE_REQUEST_REJECTED`, operands `{startDate, endDate}`, recipient is the requester | A refused decision writes no row |
| Sent | Claimed row, member has `members.email` | One Resend call with `Idempotency-Key` = row id; `sent_at` set | N/A |
| No address | `members.email` is null | No call; `failed_at` set, `failure_code` `RECIPIENT_NO_EMAIL` | N/A |
| Transient | Network error, 408, 409, 429 or 5xx | Claim released, `attempts`+1, `failure_code` kept | `failed_at` set at 5 attempts (`ATTEMPTS_EXHAUSTED`) |
| Provider auth | 401 or 403 | Run stops; every row it still holds is released without spending the attempt, `failure_code` `PROVIDER_UNAUTHORIZED` | Retried next run |
| Permanent | Any other 4xx | `failed_at` set, `failure_code` `PROVIDER_REFUSED` | Not retried |
| Crash mid-send | Claim older than 10 min, not sent | Re-claimed; the idempotency key prevents a second email | N/A |
| Concurrent runs | Two invocations at once | Disjoint claims | N/A |
| Bad caller | Missing or wrong invoke secret | 401; nothing claimed | Constant-time compare |

## Epic AC Deviations

- "renders text from the shared locale resource by code". **Reinterpreted:** `notify` cannot import `apps/web`. It renders from a copy of `hr.json`'s `obavijesti` namespace that a root test pins deep-equal. One source of truth, checked in CI.
- "a fact is asserted that a notification reports". **Narrowed:** only the leave-request decision writes the outbox in 10.1. 10.2 owns the other events.
- "the email provider key and the VAPID private key exist only in notify's environment". **Reinterpreted:** Supabase function secrets are per project, so `admin-auth`'s environment holds them too. The guarantee is that only `notify` reads them, enforced by `test/key-hygiene.test.ts` and stated in AD-17.
- "the VAPID private key exists only in notify's environment". **Narrowed:** it is named in DEPLOY.md, `.env.example` and the deploy action. Nothing reads it until 10.4.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0040_leave_requests.sql:492`, `0041_deactivation_closes_leave_requests.sql:251-331`: the current `decide_leave_request` (security definer, advisory lock, `leave_request_decisions` insert). 0042 must `create or replace` it from the 0041 body plus the outbox insert. `leave_requests.during` is a daterange; the outcome is `approved` or `rejected`.
- `0040:146-147, 346-356`: AD-11 defaults and the revoke/grant pattern to copy. `members.email` is the real address (0002:131). `organizations.locale/timezone/slug` are at 0002:70-98. Only `btree_gist` and `pgcrypto` are installed, so 0042 adds `pg_cron`, `pg_net` and Vault.
- `supabase/functions/admin-auth/{index,handler}.ts`: the template. `index.ts` is Deno-only wiring. `handler.ts` is pure, with injected env, client and fetch. `readConfiguration` gives one code per missing variable. `deno-runtime.d.ts` holds the type shims.
- `supabase/config.toml:112-119`: the "exactly one Edge Function" comment, and `[functions.admin-auth]`.
- `apps/web/src/lib/i18n/locales/hr.json` and `apps/web/src/lib/i18n/format.ts:346` (`formatIsoDate`).
- Tests:
  - `test/admin-auth-boundary.test.ts`: the handler-test style.
  - `test/rls-isolation.test.ts:20302,21006`: `actAs`, and the 9.2 and 0041 blocks.
  - `test/concurrent-writes.test.ts`, `test/database.ts`.
- Guards that change:
  - `test/supabase-scaffold.test.ts:182-190`: the function list, the migration numbering.
  - `test/key-hygiene.test.ts`.
  - `test/resource-hygiene.test.ts:2450`: `SANCTIONED_SCREEN_KEYS`, voice rules.
- `DEPLOY.md:8-20,173-212,337-345,511-520,556`, `.github/actions/deploy/action.yml:125-149`, `scripts/ci/require-config.mjs`.
- `_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md`: AD-9 at 110-114, AD-14 at 149-153, AD-17 at 175-179. AD-18 goes before line 181. Source tree at 312-340, Deferred at 368-378.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0042_notification_outbox.sql`:
  - extensions;
  - `notification_outbox`: org-scoped, RLS on, no policies, no `authenticated`/`anon` grants; `channel` check `('email')`; delivery columns `claimed_at`, `attempts`, `sent_at`, `failed_at`, `failure_code`; the unique key;
  - `claim_notifications(p_limit)`, returning row, email, locale, timezone and slug;
  - `settle_notification(p_id, p_result, p_failure_code)`, which touches delivery columns only;
  - `decide_leave_request` replaced to insert the row;
  - `cron.schedule('notify', '* * * * *', …)`, a no-op while the Vault secrets `notify_url` and `notify_invoke_secret` are absent.
- [x] `supabase/functions/notify/{index,handler,messages,deno-runtime.d}.ts`:
  - pure handler: auth, claim, render, send, settle;
  - env `SUPABASE_URL`, `SHIFT_SECRET_KEY`, `NOTIFY_INVOKE_SECRET`, `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM`, `SHIFT_APP_URL`;
  - the link is `SHIFT_APP_URL + /godisnji`.
- [x] `apps/web/src/lib/i18n/locales/hr.json`: `obavijesti.leaveRequestApproved` and `obavijesti.leaveRequestRejected`, each with a `subject` and `body`. Add the keys to `SANCTIONED_SCREEN_KEYS`.
- [x] `supabase/config.toml`: add `[functions.notify] verify_jwt = false` and rewrite the comment.
- [x] `supabase/functions/.env.example`, `DEPLOY.md`, `.github/actions/deploy/action.yml`, `scripts/ci/require-config.mjs`:
  - the new secrets;
  - Vault setup for each environment;
  - Resend domain (SPF/DKIM);
  - `functions deploy notify`;
  - the post-deploy listing.
- [x] `ARCHITECTURE-SPINE.md`: the amendments listed under Always.
- [x] Tests:
  - `test/notify-boundary.test.ts`: every row of the matrix, plus the messages copy deep-equal to `hr.json`;
  - `test/rls-isolation.test.ts`: outbox invisible and unwritable to members and admins; the RPCs refused to `authenticated`; the decision writes exactly one row, and a refused decision and the deactivation trigger write none;
  - `test/concurrent-writes.test.ts`: disjoint claims;
  - scaffold and key-hygiene updates (`re_…` key pattern, secret names only under `notify/`, DEPLOY.md and the deploy action).

**Acceptance Criteria:**
- Given a pending request, when an admin approves it, then one outbox row exists in the same transaction, and rolling the decision back leaves no row.
- Given the tree, when `pnpm lint`, `pnpm typecheck` and `pnpm test` run, then they pass with `supabase/functions` = `['admin-auth', 'notify']`.

## Spec Change Log

- 2026-10-29, review loop 1 (human-approved intent amendment, code kept, not reverted, because the amendments only add behavior):
  - Trigger: the epic AC audit found AC3 "exist only in notify's environment" reinterpreted and unlisted. The edge-case and blind reviews found that 401/403 would permanently fail the whole queue, 409 would fail a possibly-sent email, and 408 is a timeout.
  - Amended: one Epic AC Deviations entry for AC3. Matrix: 408 and 409 are transient; 401 and 403 stop the run and release held rows without spending an attempt.
  - Known-bad state avoided: one key or domain misconfiguration silently and permanently fails every queued notification.
  - KEEP: RPC-only `notify` (claim and settle, service_role only); the unique key and idempotency key; messages pinned deep-equal to hr.json; the live matrix tests in rolled-back transactions; the spine and DEPLOY.md structure.

## Design Notes

Claim lease: `where sent_at is null and failed_at is null and (claimed_at is null or claimed_at < now() - interval '10 minutes')`. The claim increments `attempts`. A transient result clears `claimed_at`. The idempotency key covers the crash window, because Resend deduplicates for 24h and 5 attempts × 10 min stays inside it.

## Verification

**Commands:**
- `pnpm db:reset && pnpm test`: expected green.
- `pnpm lint && pnpm typecheck`: expected clean.

## Suggested Review Order

**The fact writes its own notification (AD-18)**

- Entry point: the decision inserts the outbox row in its own transaction.
  [`0042_notification_outbox.sql:386`](../../supabase/migrations/0042_notification_outbox.sql#L386)

- Outbox shape: codes, operands, delivery columns, unique key, no member grants.
  [`0042_notification_outbox.sql:75`](../../supabase/migrations/0042_notification_outbox.sql#L75)

**At-most-once delivery**

- Claim: lease token, backoff, email-only, `SKIP LOCKED`, returns address and locale.
  [`0042_notification_outbox.sql:133`](../../supabase/migrations/0042_notification_outbox.sql#L133)

- Settle: token-checked, delivery columns only, `released` returns the attempt.
  [`0042_notification_outbox.sql:221`](../../supabase/migrations/0042_notification_outbox.sql#L221)

- The run loop: auth, claim, pacing, deadline, 401/403 stop.
  [`handler.ts:330`](../../supabase/functions/notify/handler.ts#L330)

- Provider status to settlement, per the amended matrix.
  [`handler.ts:251`](../../supabase/functions/notify/handler.ts#L251)

- One Resend call with the row id as idempotency key.
  [`handler.ts:272`](../../supabase/functions/notify/handler.ts#L272)

**Text from the locale resource**

- The pinned copy of `obavijesti`, with plain interpolation and the Croatian fallback.
  [`messages.ts:18`](../../supabase/functions/notify/messages.ts#L18)

- The source namespace in the SPA's resource.
  [`hr.json:1587`](../../apps/web/src/lib/i18n/locales/hr.json#L1587)

**Schedule and secrets**

- The cron job reads the URL and invoke secret from Vault; a no-op without them.
  [`0042_notification_outbox.sql:417`](../../supabase/migrations/0042_notification_outbox.sql#L417)

- One code per missing or malformed variable; the invoke secret's charset.
  [`handler.ts:143`](../../supabase/functions/notify/handler.ts#L143)

- Deploy: notify deployed, then probed for 401.
  [`action.yml:184`](../../.github/actions/deploy/action.yml#L184)

- Ops runbook: Resend domain, Vault SQL, rotation, delivery rules.
  [`DEPLOY.md:241`](../../DEPLOY.md#L241)

**Architecture**

- AD-14 amended to two functions; AD-17 and the new AD-18 follow.
  [`ARCHITECTURE-SPINE.md:149`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L149)

- AD-18 itself.
  [`ARCHITECTURE-SPINE.md:183`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L183)

**Peripherals**

- Deno wiring only.
  [`index.ts:43`](../../supabase/functions/notify/index.ts#L43)

- `verify_jwt = false`, because the function checks its own bearer.
  [`config.toml:130`](../../supabase/config.toml#L130)

- Matrix against the real claim and settle, in rolled-back transactions.
  [`notify-boundary.test.ts:742`](../../test/notify-boundary.test.ts#L742)

- The cron job's send branch passes the handler's auth.
  [`notify-boundary.test.ts:1045`](../../test/notify-boundary.test.ts#L1045)

- The decision writes exactly one row, and refusals write none.
  [`rls-isolation.test.ts:21262`](../../test/rls-isolation.test.ts#L21262)

- Concurrent claims never share a row.
  [`concurrent-writes.test.ts:1975`](../../test/concurrent-writes.test.ts#L1975)
