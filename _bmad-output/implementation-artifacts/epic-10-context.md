# Epic 10 Context: People hear about what concerns them

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A member learns by email or push that their leave request was decided or their own shifts changed, and every admin learns that a new item waits in *Za odluku*, without opening the app. A member with no email address gets push once they install the app. Every fact a notification reports already exists on a surface; notifications only carry it out and never compute anything of their own. This is the highest-risk epic of the v1 expansion: it adds the system's first server runtime beyond the auth boundary, depends on email deliverability, and iOS Web Push works only in an installed PWA on 16.4+. Story 10.1 has shipped the outbox, the `notify` function and the spine amendments (AD-14, AD-17, new AD-18, AD-9's exception), with the leave-request decision sent by email as the first event.

## Stories

- Story 10.1: The outbox and the notify function
- Story 10.2: Email tells people what concerns them
- Story 10.3: Notification settings in Više
- Story 10.4: Web Push reaches members without email

## Requirements & Constraints

- **Events to a member:** their leave request is decided; an admin records leave for them; their own shifts change through a roster or shift-type override, a swap, or a rotation change taking effect within the next 30 days. Swap events (proposed or decided) ship with Epic 12.
- **Events to admins:** every admin with an email address receives one notification when a new item appears in *Za odluku*. **As shipped in 10.2:** admins are notified of new leave requests only; collision emails are deferred (collisions are derived in the browser and have no stored fact to write from; see `deferred-work.md`).
- **Derived from a recorded fact (Q25):** the notifier makes no calculation of its own. Each event is sent at most once per recipient and channel.
- **Content:** a notification states facts in the organization's locale and links to the surface concerned. Nothing sent to a member-role account names another member's leave, absence or absence type (Q5).
- **Email:** goes only to the member's own recorded address, never to the synthesized sign-in address. A failed send is retried and never blocks or rolls back the write that caused it.
- **Push:** carries the same events as email. On iOS it is offered only to the installed app (16.4+), and the settings say so. A subscription the push service reports as gone is removed, and nothing else changes.
- **Settings:** each member turns email and push on or off for themselves; when a channel is off, nothing is sent on it. Settings and push subscriptions are self-owned member-role writes, not administrative writes.
- **Out of scope:** shift reminders or anything needing server-side projection (deferred: no request asserts that fact); messaging, broadcast, announcements, SMS.
- **Ops:** an email provider account (Resend), a sending domain (SPF/DKIM), VAPID keys, the cron job and its Vault entries, per environment, all named in DEPLOY.md.

## Technical Decisions

- **AD-14 (amended):** exactly two Edge Functions: `admin-auth` (unchanged) and `notify`. A third one amends the AD again. `notify` touches the database only through two `service_role`-only functions: `claim_notifications` (returns each row with the recipient's email and the organization's locale, timezone and slug) and `settle_notification` (writes only the outbox's delivery columns). Story 10.4 adds deleting expired push subscriptions in the same way. A pg_cron job `notify` (every minute) POSTs to the function using `notify_url` and `notify_invoke_secret` from Vault, and does nothing while either is missing.
- **AD-9 exception:** `notify` writes no domain table. Every other write, including settings and subscriptions, goes through PostgREST under RLS.
- **AD-17 (amended):** the email provider key and the VAPID private key live only in `notify`'s environment. Only `supabase/functions/notify/` may name them in code (enforced by `test/key-hygiene.test.ts`). No secret value or name appears in a migration, `config.toml` or `apps/web`. The SPA still ships only the publishable key.
- **AD-18 (new):** the request that asserts a fact (a decision, an approval, a roster change) inserts the outbox row in its own transaction, as a code plus operands. `notify` computes no domain answer; adding a domain rule or engine calculation to it is a defect.
- **Outbox shape (0042):** `notification_outbox` is organization-scoped, RLS on with no policy, and gives no table privilege to `anon`, `authenticated` or `service_role`. A row holds `code`, `operands`, `subject_id`, `recipient_member_id` and `channel`. It never holds prose or an address. The unique key (`code`, `subject_id`, `recipient_member_id`, `channel`) gives at-most-once delivery. The existing pattern: `decide_leave_request` writes `LEAVE_REQUEST_APPROVED`/`_REJECTED` with `{startDate, endDate}`; deactivation closing requests writes none. Story 10.2 adds the other events at the writes that assert them.
- **Delivery semantics:** a 10-minute `FOR UPDATE SKIP LOCKED` claim lease, with `claimed_at` as the settle token, so a stale run settles nothing. At most 5 attempts. The Resend `Idempotency-Key` is the row id. Transient failures (network, 408, 409, 429, 5xx, or a code the deployed function cannot render yet) release the row with a backoff of attempts × 10 minutes. A 401 or 403, or the run's 45 s budget, gives every held row back without spending its attempt. Any other 4xx fails the row.
- **Text (AD-8 / L4):** rendered by code from the `obavijesti` namespace. The function cannot import `apps/web`, so it holds a copy of `hr.json`'s namespace, which a root test pins deep-equal to the original. Each new code needs both the locale entry and the copy.
- **PWA:** push builds on Epic 8's service worker. The worker still caches nothing at runtime from Supabase or any other cross-origin source.
- New tables (`push_subscriptions`, notification settings) are organization-scoped with `organization_id` first, and use the self-owned row policy pattern from story 9.2.

## UX & Interaction Patterns

- *Više* → *Obavijesti* is a new row in a member's *Više* sheet (and in the desktop equivalent). It holds an email on/off control that shows the address, or reads `Nemaš upisan e-mail`, and a push on/off control, or `Instaliraj aplikaciju za obavijesti` where install is required (iOS before install).
- Nothing opens unprompted. The browser permission request follows only the member's own action of turning push on.
- All user-facing text lives in i18n, with no literal strings in the SPA or in `notify`.
- Story 10.3 updates EXPERIENCE.md §IA, UX-DR31, UX-DR33 and UX-DR49 in the same change.

## Cross-Story Dependencies

- **10.1** is done. It applied the spine amendments and shipped the first event (the leave decision by email).
- **10.2** depends on 10.1 and 9.4. It adds the remaining events at the writes that assert them: admin leave records, overrides and rotation changes, and new leave requests in *Za odluku* (collision emails deferred, see `deferred-work.md`).
- **10.3** depends on 10.2. **10.4** depends on 10.3 and on 8.1 (manifest and service worker), and uses 8.4's *Instaliraj* detection. Until 10.4 the outbox and `notify` handle email only.
- **Epic 12** (swaps) reuses this outbox for swap-proposed, swap-decided and swap-driven shift-change events.
