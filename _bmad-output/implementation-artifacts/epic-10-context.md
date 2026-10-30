# Epic 10 Context: People hear about what concerns them

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A member learns by email or push that their leave request was decided or their own shifts changed, and every admin learns that a new item waits in *Za odluku*, without opening the app. A member with no email address gets push once they turn it on on a device: in any browser that supports Web Push, and on iOS in the installed app. Every fact a notification reports already exists on a surface. Notifications only carry it out and never compute anything of their own. Stories 10.1–10.3 have shipped email end to end: the outbox, the `notify` function, every v1 email event, and the member and organization on/off switches. Story 10.4 (in progress) adds Web Push as a second channel on the same pipeline, switched per device. iOS Web Push works only in an installed PWA on 16.4+.

## Stories

- Story 10.1: The outbox and the notify function (done)
- Story 10.2: Email tells people what concerns them (done)
- Story 10.3: Notification settings in Više (done)
- Story 10.4: Web Push reaches members without email (in progress)

## Requirements & Constraints

- **Events (as shipped for email; push carries the same set):**
  - To the member: their leave request is decided; leave is recorded, changed or removed for them; a roster override puts them on or takes them off; a shift-type override changes their team's day; a rotation change takes effect today to today+30, or a scheduled one is cancelled.
  - To every active admin: a new leave request.
  - Deferred: collision notices (collisions are derived in the browser, so no stored fact exists to write from) and swap events (Epic 12).
- **Recipients:** stored facts only. The member whose session made the write gets nothing. No row is written for a recipient who is inactive today, or for a fact that lies wholly in the past. An amend is one `*_CHANGED` notification. An approval sends only the decision.
- **Q25:** the notifier makes no calculation of its own. Each event is sent at most once per recipient and channel.
- **Content:** the text states facts in the organization's locale and names the organization. It links through `/prijava/<slug>?povratak=<path>`, and every email ends with a line linking to `/obavijesti`. Nothing sent to a member-role account names another member or an absence type (Q5).
- **Switches:** a member's own setting (no row means on) and the organization's `email_notifications` switch. When either is off, nothing is written, and any queued or retry-waiting row is settled as failed at claim time.
- **Push (10.4):**
  - Per device, not per member (AC deviation, product owner 2026-10-30): a subscription is one device's row, stored only for the member who turned push on there, in any browser that supports Web Push (Android and desktop in a tab too); only iOS needs the installed app. The browser permission prompt follows only that press.
  - On iOS before install, the settings say push needs the installed app (iOS 16.4+).
  - Channels are independent: the organization's email switch and the member's email setting never stop push.
  - A shared device follows the last member who turned push on there; off, sign-out and any other session end unsubscribe the device.
  - When the push service reports a subscription gone (404, 410), that subscription is removed and nothing else changes.
- **Out of scope:** shift reminders, messaging, broadcast, SMS, a List-Unsubscribe header or an unauthenticated unsubscribe endpoint, and a members self-update policy.
- **Ops:** each environment needs Resend with a sending domain (SPF/DKIM), VAPID keys, and the cron job with its Vault entries. DEPLOY.md names all of them and gives the migration order: each migration ships before the `notify` that depends on it.

## Technical Decisions

- **AD-14:** there are exactly two Edge Functions, `admin-auth` and `notify`. `notify` touches the database only through `service_role`-only functions: `claim_notifications` returns each row with the recipient's email and the organization's name, locale, timezone and slug, and `settle_notification` writes only the delivery columns. Story 10.4 adds deleting gone push subscriptions in the same way. The pg_cron `notify` job runs every minute using `notify_url` and `notify_invoke_secret` from Vault.
- **AD-9 exception:** `notify` writes no domain table. Settings and subscriptions are self-owned member writes through PostgREST under RLS, using the 9.2 pattern: own-row policies plus column grants, with no delete unless the story needs one.
- **AD-17:** the email key and the VAPID private key live only in `notify`'s environment. Only `supabase/functions/notify/` may name them in code (`test/key-hygiene.test.ts`). The SPA ships only the publishable key, plus the VAPID public key as `VITE_VAPID_PUBLIC_KEY` (amended by 10.4).
- **AD-18:** the request that asserts a fact writes the outbox row in the same transaction, as a code plus operands (ISO dates, ids and snapshot names), never prose or an address. As shipped:
  - Definer AFTER triggers on the fact tables call `private.notify_members`.
  - `decide_leave_request` inserts its row directly.
  - The transaction-local flag `shift.notify_suppress` (`approval` or `amend`) collapses an approval or an amend into one notification.
- **Outbox:** `notification_outbox` is organization-scoped, has RLS with no policy, and grants no table privileges. Its unique key is (`code`, `subject_id`, `recipient_member_id`, `channel`). `channel` is `in ('email', 'push')` since 10.4.
  - The switch filter is one definer BEFORE INSERT trigger, and it drops only `email` rows. Push needs its own rule.
  - Every writer emits `email` rows today. Writing push rows as well means touching both `private.notify_members` and `decide_leave_request`.
- **Delivery:**
  - A claim takes a 10-minute `FOR UPDATE SKIP LOCKED` lease, and `claimed_at` is the settle token.
  - A row gets at most 5 attempts, with a backoff of attempts × 10 minutes. Transient failures release the row; a 401/403 or the 45 s budget hands rows back without spending an attempt; any other 4xx fails the row.
  - The Resend `Idempotency-Key` is the row id.
- **Text (AD-8):** rendered by code from the `hr.json` `obavijesti` namespace. `supabase/functions/notify/messages.ts` holds a copy pinned deep-equal by a test, so each new code or line needs both. Screen text lives under its own top-level key, never under `obavijesti`.
- **PWA:** push builds on Epic 8's service worker. The worker still caches nothing at runtime from Supabase or any other cross-origin source.

## UX & Interaction Patterns

- `/obavijesti` is a surface for every role, reached by a fixed row in *Više* (after *Prikaz*, before *Instaliraj*) and in the desktop profile menu. As shipped it shows:
  - the address, read-only, with an email on/off that saves at once and shows pending and failure in a `Notice`;
  - `Nemaš upisan e-mail` with no control when there is no address;
  - a statement that the organization sends no email, with no control, when *Organizacija* → *Obavijesti e-poštom* is off.
- **10.4:** adds its own section, *Obavijesti na uređaju*: this device's push on/off, or `Instaliraj aplikaciju za obavijesti (iOS 16.4+)` on iOS before install, or that the browser cannot receive or has blocked notifications. It reuses 8.4's install detection. Nothing opens unprompted.
- All user-facing text lives in i18n. A shipping story rewrites the UX-DR49 and EXPERIENCE.md lines it changes in the same change; UX-DR49 now describes the push section as shipped by 10.4.

## Cross-Story Dependencies

- **10.4** depends on 10.3 (the settings screen and its switches) and on 8.1 (the manifest and the service worker). It closes the deferred-work entry for the missing push row and control.
- **Epic 12** (swaps) reuses this outbox for the swap-proposed, swap-decided and swap-driven shift-change events, and passes through the same switch filter.
