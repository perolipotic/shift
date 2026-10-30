---
title: 'Notification settings in Više'
type: 'feature'
created: '2026-10-30'
status: 'done'
baseline_commit: '6726b35b53e669f651549f43c67709ca6aa8cabb'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-10-2-email-tells-people-what-concerns-them.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 10.2 every event emails its people, and nobody can stop that: not a member who does not want the emails, and not an organization that does not want to send them at all.

**Approach:** A member's own `notification_settings` row (self-owned, 9.2 pattern) and an admin's `organizations.email_notifications` switch. A BEFORE INSERT trigger on `notification_outbox` drops an `email` row when either is off, so no writer (the 0043 triggers, `decide_leave_request`, Epic 12 later) can bypass it. A new surface `/obavijesti`, reached from *Više* and the desktop profile menu, shows the address and the email on/off. The Organizacija page gains the org switch. Every email ends with a line linking to `/obavijesti`.

## Boundaries & Constraints

**Always:**
- No settings row means email is on. The member reads and writes only their own row: insert and update with column grants (`organization_id, member_id, email`; update `email` only); no delete.
- `organizations.email_notifications boolean not null default true`, written only by the existing admin update policy plus a column grant.
- The outbox filter is one definer trigger function. It returns NULL for an `email` row whose organization switch is off or whose recipient's setting is off. The org switch stops the writes, not only the sends.
- *Obavijesti* is a fixed row like *Instaliraj*, for every role, never a `DESTINATIONS` entry. On desktop it sits in the profile menu.
- The screen shows the member's address read-only with the on/off control, or reads `Nemaš upisan e-mail` with no control. When the organization switch is off, it states that the organization sends no email, with no control.
- The control saves at once and shows pending and failure states (a `Notice`), as the organization settings do. The browser asks no permission.
- The email footer line is `obavijesti` text, mirrored deep-equal in `messages.ts`, and links through `/prijava/<slug>?povratak=/obavijesti`.
- Screen text gets a new top-level i18n key, never under `obavijesti`.

**Ask First:** Any change to `notify`'s delivery logic beyond the claim-time switch check below. Any push column, table or UI. Letting a member edit their address.

**Never:**
- Push settings, push subscriptions, or the `Instaliraj aplikaciju za obavijesti` row (10.4).
- A `List-Unsubscribe` header or an unauthenticated unsubscribe endpoint.
- A `members` self-update policy.
- Deleting outbox rows when a switch turns off (the claim settles them instead).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | Member has no settings row | Events write rows as in 10.2 | N/A |
| Member off | M sets email off, then an admin records leave for M | No row for M; other recipients unaffected | N/A |
| Member back on | M sets email on again | The next event writes M's row | N/A |
| Decision | M off, an admin decides M's request | No decision row | N/A |
| Org off | Admin turns the org switch off | No `email` row for any member of that org | N/A |
| Other org | Org A off | Org B's rows are unaffected | N/A |
| Foreign row | M writes a settings row for N, or for another org | Refused by RLS | Save shows the failure notice |
| Member writes org switch | Member-role update of `email_notifications` | Refused | N/A |
| No address | `members.email` null or blank | `Nemaš upisan e-mail`, no control | N/A |
| Save fails | Network or RLS error | Control returns to the stored value, failure notice | Retry by toggling again |
| Queued | Row written, then M (or the org) turns off before `notify` claims it, including a row awaiting a retry | The claim settles it as failed and does not return it; nothing is sent | N/A |

## Epic AC Deviations

- "push has an on/off, or reads `Instaliraj aplikaciju za obavijesti` where install is required (UX-DR49)". **Deferred** to 10.4, which ships push. 10.3 has no push channel to switch. A deferred-work entry records it.
- "a channel turned off … nothing is sent on that channel". **Met at two points:** nothing is written after the switch, and `claim_notifications` settles as failed any pending `email` row whose recipient or organization switch is now off, retries included. Only a row already claimed and in flight when the switch turns off can still send.
- "*Više* → *Obavijesti*" (a member's *Više*). **Reinterpreted:** the row is shown to every role, because admins receive emails too.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0043_notification_events.sql:80-112`: `private.notify_members` (left as is); `decide_leave_request` inserts directly at :713-726. This is why the filter is an outbox trigger.
- `supabase/migrations/0042_notification_outbox.sql:75-129`: the outbox table, `channel in ('email')`, RLS with no policy.
- `supabase/migrations/0040_leave_requests.sql:282-307,346-351`: the self-owned policy and column-grant pattern to copy.
- `supabase/migrations/0014_*.sql:37-45`: precedent for an org boolean column plus `grant update (…)`.
- `apps/web/src/features/navigation/components/chrome.tsx`:
  - `renderMore` :888 (sheet order: groups → Prikaz → Instaliraj → Odjava);
  - `renderProfile` :788;
  - `renderInstall` :731, the fixed-row precedent;
  - the `MEMBER_NAME_KEY` query :302.
- `apps/web/src/features/navigation/services/profile.ts:24`: `readMemberName`, the pattern for reading the own `email`.
- `apps/web/src/pages/godisnji.zatrazi.tsx:106` and `apps/web/src/router.ts:6,47-68`: route shape and registration.
- `apps/web/src/features/organization/`:
  - `components/organization-fire-ranks-card.tsx`: dialog plus `RadioGroup`, the precedent for the org switch card;
  - `hooks/use-organization-settings.ts:419`: `saveFireRanks`;
  - `services/snapshot.ts`: select list :115, parse :523-563, `organizationEditColumns` :589/:604, `updateOrganization` :842.
- `apps/web/src/features/auth/services/return-target.ts:36`: `povratak` must accept `/obavijesti`.
- `supabase/functions/notify/messages.ts`: `OBAVIJESTI` copy, `render`. Add the footer line.
- `apps/web/src/lib/i18n/locales/hr.json`: `obavijesti` (emails) and a new top-level key for the screen.
- New feature folder `features/notifications/`: register it in `eslint.config.js:124,338` (`FEATURES`, `FEATURE_PUBLIC`).
- Inventories that must list the new pieces:
  - `test/resource-hygiene.test.ts` `SANCTIONED_SCREEN_KEYS` :247;
  - `apps/web/src/router.test.ts` (routesById :415, per-route block like :2763);
  - `apps/web/src/pages/source-guards.fixture.ts` `SCREENS` :696;
  - `pages/screens-sweep.test.ts`, `pages/key-sources.fixture.ts`, `test/localization-applied.test.ts` `SOURCES` :391;
  - `pages/structural-pins-shell.test.ts`;
  - `test/supabase-scaffold.test.ts` (0044 numbering, policy mirror, org update columns ~:890);
  - `test/provisioning.test.ts` (RLS tables :687, column privileges, function grantees :2066/:2156);
  - `test/rls-isolation.test.ts` (pg_policies :935, pg_proc :1027, org column privileges :2205, the 0043 block :21515 with `cast`/`setEmail`/`inRolledBackTransaction`);
  - `test/demo-organization.test.ts:113,294`; `test/notify-boundary.test.ts:165-172`.
- Docs:
  - `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md` (§IA :25-41, inventory :51-75);
  - `_bmad-output/planning-artifacts/epics.md` UX-DR31 :156, UX-DR33 :158, UX-DR49 :183;
  - `DEPLOY.md` §5.2c :585.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0044_notification_settings.sql`:
  - `notification_settings (organization_id, member_id, email boolean not null default true, updated_at)` with PK `(organization_id, member_id)`, FKs that cascade on member delete, RLS, the self-owned select/insert/update policies and column grants;
  - `organizations.email_notifications` with its column grant;
  - the definer BEFORE INSERT filter trigger on `notification_outbox`.
- [x] `apps/web/src/features/notifications/` (services, hook, component) plus `apps/web/src/pages/obavijesti.tsx` and `router.ts`: read the own name, email and setting, plus the org switch; upsert the own row; render the screen.
- [x] `chrome.tsx`: the *Obavijesti* row in the sheet (after Prikaz, before Instaliraj) and in the profile menu.
- [x] `features/organization/`: an email-notifications card with dialog and `RadioGroup`, `saveEmailNotifications`, the snapshot column.
- [x] `hr.json` and `messages.ts`: the screen keys, and the `obavijesti` footer line rendered into every email.
- [x] `return-target.ts`, if needed, so `/obavijesti` is a valid `povratak`.
- [x] Tests:
  - every DB matrix row in `rls-isolation.test.ts`, in rolled-back transactions;
  - the screen's states as view-state unit tests (`notificationsViewOf` in `settings.test.ts`) plus E2E (`e2e/tests/notifications/settings.spec.ts`); component render tests are deferred project-wide;
  - the footer in `notify-boundary.test.ts`;
  - every inventory listed in the Code Map.
- [x] Docs: EXPERIENCE.md §IA and inventory (20 → 21), UX-DR31/33/49 rewritten as shipped (push still planned for 10.4), DEPLOY.md order (0044 before the new `notify`).
- [x] `deferred-work.md`: the push row and control deferred to 10.4.

**Acceptance Criteria:**
- Given *Više* or the profile menu, when *Obavijesti* is chosen, then `/obavijesti` opens and shows the address with the on/off control, or `Nemaš upisan e-mail`.
- Given any email, when it renders, then it ends with the line linking to `/prijava/<slug>?povratak=/obavijesti`.
- Given the tree, when `pnpm db:reset && pnpm lint && pnpm typecheck && pnpm test` run, then all pass.

## Spec Change Log

- 2026-10-30, review 1 (human-approved intent amendment, code kept):
  - Trigger: Blind Hunter found the "at most about a minute old" claim false. A row that fails is retried up to 5 times over about 100 minutes, so an email could go out an hour after a member or organization switched email off.
  - Amended: the claim also checks both switches. Pending `email` rows whose switch is off are settled as failed, not returned. Ask First, Never, the Queued matrix row and the Epic AC deviation were rewritten to match. Human chose this over correcting the wording only (2026-10-30).
  - Known-bad state avoided: stale emails delivered long after opt-out.
  - KEEP: the BEFORE INSERT filter trigger; `notification_settings` with column grants and no delete; the fixed *Obavijesti* row; every review patch applied in this loop.

## Design Notes

- The trigger rather than `notify_members` covers `decide_leave_request`'s direct insert and every future writer with one rule. Returning NULL from a BEFORE row trigger skips the row silently, and the writer's `on conflict do nothing` is unaffected.
- The trigger function is `security definer` with `search_path=''`. It reads `notification_settings` and `organizations` directly, so the session's RLS does not hide another member's row.

## Verification

**Commands:**
- `pnpm db:reset && pnpm test`: expected green. The DB is shared; no other shift session is running now.
- `pnpm lint && pnpm typecheck`: expected clean.

**Manual checks:**
- Run the app, open *Više* → *Obavijesti* on a phone viewport and the profile menu on desktop, toggle email, reload, and the value persists.

## Suggested Review Order

**The switches stop the writes and the sends**

- Entry point: one BEFORE INSERT filter drops an email row when either switch is off.
  [`0044_notification_settings.sql:185`](../../supabase/migrations/0044_notification_settings.sql#L185)

- The claim settles queued and retry-waiting rows unsent once a switch turns off.
  [`0044_notification_settings.sql:228`](../../supabase/migrations/0044_notification_settings.sql#L228)

- Self-owned settings table: own-row policies, column grants, no delete.
  [`0044_notification_settings.sql:43`](../../supabase/migrations/0044_notification_settings.sql#L43)

- Organization switch column, written through the existing admin policy.
  [`0044_notification_settings.sql:175`](../../supabase/migrations/0044_notification_settings.sql#L175)

**The /obavijesti screen**

- Read of the own address, role, setting and org switch.
  [`settings.ts:148`](../../apps/web/src/features/notifications/services/settings.ts#L148)

- Update-then-insert write; a refusal on any path reads as REFUSED.
  [`settings.ts:210`](../../apps/web/src/features/notifications/services/settings.ts#L210)

- The screen's states: no address, org off, control.
  [`settings.ts:278`](../../apps/web/src/features/notifications/services/settings.ts#L278)

- Save with pending, failure and saved notices.
  [`use-notification-settings.ts:46`](../../apps/web/src/features/notifications/hooks/use-notification-settings.ts#L46)

- The card; the group stays focusable while saving.
  [`notification-settings-card.tsx:41`](../../apps/web/src/features/notifications/components/notification-settings-card.tsx#L41)

**Navigation and the organization switch**

- Fixed Obavijesti row for every role, in the sheet and the profile menu.
  [`chrome.tsx:731`](../../apps/web/src/features/navigation/components/chrome.tsx#L731)

- Org switch save also refreshes the settings screen's read.
  [`use-organization-settings.ts:436`](../../apps/web/src/features/organization/hooks/use-organization-settings.ts#L436)

**Email footer**

- Every email ends with the line linking to /obavijesti.
  [`messages.ts:283`](../../supabase/functions/notify/messages.ts#L283)

- The Croatian wording to review (screen keys and footer).
  [`hr.json:1597`](../../apps/web/src/lib/i18n/locales/hr.json#L1597)

**Peripherals**

- Deploy order and the expected EMAIL_TURNED_OFF failure code.
  [`DEPLOY.md:645`](../../DEPLOY.md#L645)

- Every matrix row against the real triggers and claim, rolled back.
  [`rls-isolation.test.ts:22014`](../../test/rls-isolation.test.ts#L22014)

- E2E: phone sheet, desktop menu, failed save, org off, admin switch.
  [`settings.spec.ts:26`](../../e2e/tests/notifications/settings.spec.ts#L26)

- UX-DR49 rewritten as shipped; push still planned for 10.4.
  [`epics.md:183`](../planning-artifacts/epics.md#L183)
