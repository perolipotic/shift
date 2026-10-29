# Epic 10 Context: People hear about what concerns them

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A member learns by email or push that their leave request was decided or their own shifts changed, and every admin learns that a new item waits in *Za odluku*, without opening the app. A member with no email address gets push once they install the app. Every fact a notification reports already exists on a surface; notifications only carry it out. They never compute anything of their own. This epic adds the system's first server runtime beyond the auth boundary, which makes it the highest-risk epic of the v1 expansion (email deliverability, and iOS Web Push works only in an installed PWA on 16.4+). Story 10.1 applied the amendments to the architecture spine: AD-14 and AD-17 are amended, AD-18 is added, and AD-9's exception covers both Edge Functions.

## Stories

- Story 10.1: The outbox and the notify function
- Story 10.2: Email tells people what concerns them
- Story 10.3: Notification settings in Više
- Story 10.4: Web Push reaches members without email

## Requirements & Constraints

- **Events to a member:** their leave request is decided; an admin records leave for them; their own shifts change through a roster or shift-type override, a swap, or a rotation change taking effect within the next 30 days. The product requirements also list a swap proposed to them or decided. Swaps ship in Epic 12.
- **Events to admins:** every admin receives a notification when a new item appears in *Za odluku*.
- **Derived from a recorded fact (Q25):** the notifier never makes a calculation of its own. Each row is sent at most once per recipient and channel.
- **Content:** a notification states facts in the organization's locale and links to the surface concerned. Nothing sent to a member-role account names another member's leave, absence or absence type (Q5/NFR-5).
- **Email:** goes only to the member's own recorded address, never to the synthesized sign-in address (AD-12). A failed send is retried and never blocks the write that caused it. An email is sent only when the member has an address.
- **Push:** carries the same events as email. On iOS it is offered only to the installed app, and the settings say so. A subscription the push service reports as gone is removed, and nothing else changes.
- **Settings:** each member turns email and push on or off for themselves. When a channel is off, nothing is sent on it. Notification settings and push subscriptions are self-owned member-role writes. They are not administrative writes, so Q2 still holds.
- **Out of scope:** shift reminders, or any notification that needs projection; messaging, broadcast, announcements and SMS.
- **Ops:** an email provider account, a sending domain (SPF/DKIM), VAPID keys and a scheduled job, set up for each environment and named in DEPLOY.md.

## Technical Decisions

- **AD-14 (amended):** exactly two Edge Functions exist: `admin-auth` (AD-16, unchanged) and `notify`. `notify` runs on a schedule over `notification_outbox`, sends email and Web Push, and marks rows sent. It may read organization data with the secret key, but only to address and localize a message. It writes only the outbox's delivery columns and deletes expired push subscriptions. A third function would amend this AD again.
- **AD-17 (amended):** the email provider key and the VAPID private key exist only in `notify`'s environment, per environment. The SPA still ships only the publishable key.
- **AD-18 (new):** the request that asserts a fact (an approval, a decision, a roster change) writes the outbox row for it in the same request, as codes and operands. `notify` computes no domain answer.
- **AD-8 / L4:** outbox rows carry `{ code, ...operands }`. `notify` renders text by code from the shared locale resource, never from prose stored in the row.
- **AD-9/10/11:** writes still go through PostgREST under RLS. The new tables `notification_outbox` and `push_subscriptions` are scoped to the organization (`organization_id` first). A member reads and writes only their own subscription and settings, under the self-owned row policy pattern from story 9.2.
- **AD-16 spirit:** the function that holds the secret key may not think. It must contain no domain rule and no engine calculation. Adding either is a defect.
- **AD-14 (PWA):** push builds on Epic 8's service worker. The worker still caches nothing at runtime from Supabase or any other cross-origin source.

## UX & Interaction Patterns

- **UX-DR49:** *Više* → *Obavijesti* offers an email on/off control showing the address, or reads `Nemaš upisan e-mail`. It offers a push on/off control, or reads `Instaliraj aplikaciju za obavijesti` where install is required (iOS before install, 16.4+).
- **UX-DR31/33:** *Obavijesti* is a new row in a member's *Više* sheet (and in the desktop profile menu or sidebar, following the existing *Više* pattern). It is one of the three planned new surfaces (notification settings). Story 10.3 rewrites EXPERIENCE.md §IA, UX-DR31, UX-DR33 and UX-DR49 in the same change.
- Nothing opens by itself. The permission request follows the member's own action of turning push on, consistent with the *Instaliraj* rule of no unprompted prompts.
- All user-facing text lives in i18n. No literal strings, in the SPA or in `notify`.

## Cross-Story Dependencies

- **10.1** depends on the Architect pass, and applies the AD-14, AD-17 and AD-18 amendments to the spine.
- **10.2** depends on 10.1 and on 9.4 (leave request decisions). Each event is written by the existing write that asserts it: the leave decision, admin leave records, overrides and rotation changes, and new *Za odluku* items (collisions and leave requests, as listed since 9.5).
- **10.3** depends on 10.2. **10.4** depends on 10.3 and on 8.1 (manifest and service worker; *Instaliraj* detection from 8.4).
- **Epic 12** (swaps) reuses this outbox for swap-proposed and swap-decided events, and for swap-driven shift changes.
