---
title: 'Web Push reaches members without email'
type: 'feature'
created: '2026-10-30'
status: 'done'
baseline_commit: 'c16220a2146398f4881a026d0aa7448512ac9b4e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-10-3-notification-settings-in-vise.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Notifications go only by email, so a member with no address, usually one who only has a phone, never hears that their leave was decided or their shifts changed.

**Approach:**
- **Data:** a self-owned `push_subscriptions` table, one row per device.
- **Outbox:** a `push` channel. Every event writes a `push` row for each recipient who has at least one subscription, beside the existing `email` row.
- **`notify`:** claims push rows with their subscriptions and sends the same rendered text with VAPID to every device. It deletes a subscription the push service answers 404 or 410 for.
- **Service worker:** gains `push` and `notificationclick` handlers.
- **`/obavijesti`:** gains a per-device push on/off.

## Boundaries & Constraints

**Always:**
- **Channels are independent.** Email and push each follow their own switch, and the same event reaches every channel that is on. The organization's `email_notifications` switch stops email only, never push.
- **Per device.** The push control turns this device on or off.
  - On: the browser asks permission (only on this press), subscribes with the VAPID public key, and registers the endpoint.
  - Off: the browser unsubscribes, and the row is deleted.
  - Sign-out also unsubscribes this device and deletes its row, best-effort; that never blocks the sign-out.
- **Endpoint ownership.**
  - The endpoint is unique. Registering it through the definer RPC `register_push_subscription(endpoint, p256dh, auth)` gives it to the caller, removing any other member's row for that endpoint.
  - A member reads and deletes only their own rows. There is no update.
- **Writers.** `private.notify_members` and `decide_leave_request` write a `push` row under the same recipient rules as email: no actor, active today, nothing wholly past, at most once by the unique key. The push row needs a subscription, not an email address.
- **Claim.**
  - `claim_notifications` claims `email` and `push` rows.
  - A push row comes with its member's subscriptions (id, endpoint, p256dh, auth).
  - A push row whose member has no subscription left settles failed with `PUSH_NO_SUBSCRIPTION`.
- **Send.**
  - The payload is `{title, body, url}`. Title is the rendered subject, body is the rendered body without the email footer, and url is the `/prijava/<slug>?povratak=` link.
  - A row is `sent` if at least one device accepted it.
  - A 404 or 410 deletes that subscription through the service-role-only `delete_push_subscription(id)`.
  - If every device is gone, the row fails permanently with `PUSH_SUBSCRIPTION_GONE`.
  - Other statuses follow the email classification, except a push 401 or 403: it is retried for that row (up to the attempt limit) and never stops the run, since it concerns one device or key, not the provider account.
- **Keys.** `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` are read only in `notify`. The SPA gets the public key as the build variable `VITE_VAPID_PUBLIC_KEY`, which AD-17 is amended to allow.
- **Push availability.**
  - Push is offered wherever the browser has `PushManager` and a service worker.
  - On iOS before install, the screen reads `Instaliraj aplikaciju za obavijesti (iOS 16.4+)`.
  - Without support, the screen says the browser cannot receive notifications.
  - With permission denied, it says notifications are blocked in the browser settings.
- **Service worker.** Push handlers live in `apps/web/public/push-sw.js`, loaded by generateSW's `importScripts`. It has no `fetch` handler, so the runtime-cache pins still hold.
- **Text.** Push text reuses the `obavijesti` messages. Screen text goes under `postavkeObavijesti`.

**Ask First:**
- `npm:web-push` failing under the Edge Runtime, or any other push library.
- Switching to injectManifest.
- Any change to the email path's behaviour.

**Never:**
- Push rows for an organization's email switch.
- A push channel for anything email does not already send.
- A runtime cache in the service worker.
- A browser permission prompt not caused by a press.
- A third Edge Function.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No email, push on | Admin records leave for M; M has 1 subscription and no address | One `push` row, no `email` row | N/A |
| Both on | M has an address and 2 devices | One `email` row and one `push` row; push goes to both devices | N/A |
| Push only off | M has no subscription | `email` row only | N/A |
| Org email off | Organization switch off, M subscribed | `push` row written and sent | N/A |
| Gone | One device answers 410, the other 201 | 410 subscription deleted, row `sent` | N/A |
| All gone | Only device answers 404 | Subscription deleted, row failed `PUSH_SUBSCRIPTION_GONE`, nothing else changes | N/A |
| Unsubscribed later | Row queued, then M turns off the last device | Claim settles it `PUSH_NO_SUBSCRIPTION` | N/A |
| Shared device | Member N registers the endpoint M had | M's row removed, N owns it | N/A |
| Foreign write | M deletes or reads N's subscription | Refused or invisible under RLS | N/A |
| Decision | Admin decides M's request; M has push only | Decision `push` row | N/A |
| iOS tab | iOS Safari, not installed | `Instaliraj aplikaciju za obavijesti (iOS 16.4+)`, no control | N/A |
| Denied | Permission denied | Blocked message, no control | N/A |
| Subscribe fails | Subscribe or register throws | Control returns to off, failure notice | Retry by pressing again |

## Epic AC Deviations

- "**Given** an installed app with permission granted". **Reinterpreted:** push is offered wherever the browser supports it (Android and desktop in a tab as well). Only iOS needs the installed app, which matches the epic's iOS AC. Product owner, 2026-10-30.
- "the member turns push on". **Reinterpreted:** the switch is per device, not per member. Product owner, 2026-10-30.

</frozen-after-approval>

## Code Map

- **SQL:**
  - `supabase/migrations/0042_notification_outbox.sql:91`: `channel in ('email')`, to widen.
  - `0042:221-299`: `settle_notification`, unchanged.
  - `0043_notification_events.sql:80-112`: `private.notify_members` inserts `email` only when an address exists (:102-107).
  - `0043:637`, `:713-725`: `decide_leave_request`'s direct email insert, which has no `on conflict`.
  - `0044_notification_settings.sql`: the self-owned table, policy and grant pattern; `private.filter_notification_outbox` drops email rows only; `claim_notifications` (third version) hard-codes `c.channel = 'email'` and settles `EMAIL_TURNED_OFF`.
  - The next migration is `0045`.
- **`notify`** (`supabase/functions/notify/`):
  - `handler.ts`: `readConfiguration` :143-170; `OutboxClient.rpc` is typed to two RPCs (:183); `deliveryOfStatus` :253-260; `deliver` treats a blank email as `RECIPIENT_NO_EMAIL` (:276).
  - `messages.ts`: `render` :246-286, `linkOf` :177. The footer is email-only.
  - `index.ts`: reads env and passes `fetch`.
  - `deno-runtime.d.ts`: ambient `npm:` module declarations.
- **Service worker:**
  - `apps/web/vite.config.ts:38-75`: generateSW. Add `workbox.importScripts` and keep `push-sw.js` out of the precache glob.
  - `test/static-hosting.test.ts:32-48,299-325`: dist entries and runtime-cache pins.
- **SPA:**
  - `apps/web/src/lib/pwa/install.ts:21-67` and `use-install.ts`: `kind === 'ios'` means iOS before install.
  - `apps/web/src/features/notifications/` (`services/settings.ts`, `hooks/use-notification-settings.ts`, `components/notification-settings-card.tsx`): the `noAddress` view hides the whole control today, so it must become per-section.
  - `apps/web/src/lib/supabase/client.ts:8` and `apps/web/src/vite-env.d.ts`: the AD-17 inputs.
  - The sign-out path: find where `shell.signOut` runs in `features/navigation`.
- **Tests and inventories:**
  - `test/notify-boundary.test.ts`: four-file list :851, two-RPC pin :860, env/heredoc pin :496-516, live claim columns :873, deep-equal pin :168.
  - `test/key-hygiene.test.ts:333-392`.
  - `test/provisioning.test.ts`: RLS tables :695-730, privileges :773, grantees :2085-2160, sweep :2198.
  - `test/supabase-scaffold.test.ts:484-557`: the exact policy count.
  - `test/rls-isolation.test.ts`: policy list :978, the 0044 suite :22007 as template.
  - `test/resource-hygiene.test.ts`: sanctioned keys.
  - Web pins: `key-sweep`, `structural-pins-settings`, `source-guards.fixture`, `router.test`, `notifications-screen.fixture`.
- **Deploy:**
  - `DEPLOY.md`: VAPID rows :14, :200, :230, :309-312, :1230, :1277.
  - `.github/actions/deploy/action.yml`: the env heredoc ~:170, build vars :213, leak check :240.
  - `supabase/functions/.env.example`, `apps/web/.env.example`.
- **Docs:** `epics.md` UX-DR49; EXPERIENCE.md's `/obavijesti` lines; `deferred-work.md`, where the 10.3 push entry closes.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0045_push_subscriptions.sql`:
  - the table, with id, organization_id, member_id, unique endpoint, p256dh, auth and created_at;
  - own select and delete policies, and their grants;
  - `register_push_subscription` (definer, the caller only);
  - `delete_push_subscription` (service_role only);
  - the widened channel check;
  - `notify_members` and `decide_leave_request` recreated with push rows;
  - `claim_notifications` recreated with push claims, subscriptions and the `PUSH_NO_SUBSCRIPTION` settle.
- [x] `supabase/functions/notify/`:
  - VAPID config;
  - a push sender using `npm:web-push`, with injected `fetch` where possible for tests;
  - the push branch in `deliver`, gone-handling and the third RPC;
  - payload rendering without the footer.
- [x] `apps/web/public/push-sw.js` and `vite.config.ts`: `push` (`showNotification`) and `notificationclick` (focus or open the url).
- [x] `apps/web/src/features/notifications/`:
  - device state: support, iOS-install, permission and subscription;
  - the subscribe or unsubscribe write;
  - the push section on the card;
  - the email section keeps its 10.3 states.
- [x] Sign-out: best-effort device unsubscribe and row delete.
- [x] `VITE_VAPID_PUBLIC_KEY`: `vite-env.d.ts`, `client.ts` comment, `.env.example`, the deploy action build vars.
- [x] `hr.json` and the `postavkeObavijesti` push keys, plus the sanctioned lists.
- [x] Tests:
  - every DB matrix row in `rls-isolation.test.ts`, rolled back;
  - the push send, the gone and partial-gone cases and the env pins in `notify-boundary.test.ts` with a fake `fetch`/web-push;
  - the device-state view function unit tests;
  - E2E for the push section states with `navigator.serviceWorker`, `PushManager` and `Notification` stubbed by `addInitScript`;
  - every inventory in the Code Map.
- [x] Docs:
  - DEPLOY.md: VAPID public, private and subject; the build variable; the order 0045 → SPA → `notify`;
  - UX-DR49 and EXPERIENCE.md as shipped;
  - close the 10.3 deferred push entry.

**Acceptance Criteria:**
- Given a supported browser and a member who turns push on, when an event is written for them, then the claimed push row carries that device's subscription and `notify` posts an encrypted payload with a VAPID header to its endpoint.
- Given the tree, when `pnpm db:reset && pnpm lint && pnpm typecheck && pnpm build && pnpm test` run, then all pass.

## Spec Change Log

- 2026-10-30, review 1 (human-approved intent amendment, code kept):
  - Trigger: the implementer departed from "push follows the email classification" for 401/403, and the reviews confirmed it. As email, a push 403 from one device stops the run and hands every row back without spending an attempt, so one stale device blocks all notifications forever.
  - Amended: in the Send rules, a push 401/403 is retried for its row and never stops the run. The human chose this over deleting the device (which a VAPID misconfiguration would turn into deleting every member's devices) and over the literal email rule.
  - Known-bad state avoided: one device with a stale VAPID key halting every email and push.
  - KEEP: the 0045 table, RPCs and writers; the per-device design; the claim's subscriptions; push-sw.js through importScripts; the review patches applied in this loop (email independent of VAPID config, the host allowlist and device cap, the session-end unsubscribe, the key-rotation resubscribe).

## Design Notes

- **Push payloads cannot be made idempotent the way email is** (Resend has `Idempotency-Key`). So a row is settled `sent` after the first device accepts it, and a device that fails transiently in that run is not retried. Duplicates are worse than one missed device.
- **The endpoint is reassigned on register, not inserted per member.** Otherwise a shared phone would show one member's notifications to the next person who signs in.

## Verification

**Commands:**
- `pnpm db:reset && pnpm lint && pnpm typecheck && pnpm build && pnpm test`: expected green. The human approved resets of the shared local DB on 2026-10-30.
- `pnpm exec playwright test e2e/tests/notifications e2e/tests/layout`: expected green.

**Manual checks:**
- Real delivery needs VAPID keys and a deployed `notify`; it is not testable locally. Check the claimed row's subscriptions and the outgoing request in the fake-fetch tests instead.

## Suggested Review Order

**Devices and the push row (0045)**

- Entry point: one row per device, endpoint unique; only known push hosts.
  [`0045_push_subscriptions.sql:43`](../../supabase/migrations/0045_push_subscriptions.sql#L43)

- Register hands a shared endpoint to the caller; caps a member at ten devices.
  [`0045_push_subscriptions.sql:134`](../../supabase/migrations/0045_push_subscriptions.sql#L134)

- Writers add a push row beside email under the same recipient rules.
  [`0045_push_subscriptions.sql:257`](../../supabase/migrations/0045_push_subscriptions.sql#L257)

- The decision's direct insert gets its push row too.
  [`0045_push_subscriptions.sql:313`](../../supabase/migrations/0045_push_subscriptions.sql#L313)

- Claim returns each push row's devices; no device left settles PUSH_NO_SUBSCRIPTION.
  [`0045_push_subscriptions.sql:439`](../../supabase/migrations/0045_push_subscriptions.sql#L439)

- Gone-device delete matches id, endpoint and member, so a re-registered device survives.
  [`0045_push_subscriptions.sql:227`](../../supabase/migrations/0045_push_subscriptions.sql#L227)

**Sending (`notify`)**

- Per-device sends; sent if any accepts; 404/410 delete; all gone fails the row.
  [`handler.ts:565`](../../supabase/functions/notify/handler.ts#L565)

- Push statuses: 401/403 retried per row, never stopping the run (human decision).
  [`handler.ts:532`](../../supabase/functions/notify/handler.ts#L532)

- VAPID config optional: email never depends on it; push waits as PUSH_NOT_CONFIGURED.
  [`handler.ts:212`](../../supabase/functions/notify/handler.ts#L212)

- The web-push adapter, tested against the real library.
  [`handler.ts:346`](../../supabase/functions/notify/handler.ts#L346)

- Push text: the email subject and body without the footer, plus a tag.
  [`messages.ts:316`](../../supabase/functions/notify/messages.ts#L316)

**The device in the browser**

- Turning on asks permission only on the press and resubscribes under a rotated key.
  [`push.ts:210`](../../apps/web/src/features/notifications/services/push.ts#L210)

- Every signed-in load drops a subscription this member does not own or permission no longer covers.
  [`push.ts:317`](../../apps/web/src/features/notifications/services/push.ts#L317)

- Sign-out forgets the device within 3 s and always unsubscribes.
  [`push.ts:289`](../../apps/web/src/features/notifications/services/push.ts#L289)

- Both sign-out paths call it.
  [`chrome.tsx:449`](../../apps/web/src/features/navigation/components/chrome.tsx#L449)

- The worker shows the notification and opens its link.
  [`push-sw.js:17`](../../apps/web/public/push-sw.js#L17)

- The screen's states: iOS install, unsupported, blocked, not configured, control.
  [`push.ts:380`](../../apps/web/src/features/notifications/services/push.ts#L380)

**Peripherals**

- Deploy order 0045 → notify → SPA, the VAPID pair check, rotation.
  [`DEPLOY.md:687`](../../DEPLOY.md#L687)

- Every matrix row against the real triggers, claim and delete, rolled back.
  [`rls-isolation.test.ts:22342`](../../test/rls-isolation.test.ts#L22342)

- UX-DR49 as shipped.
  [`epics.md:183`](../planning-artifacts/epics.md#L183)
