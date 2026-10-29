---
title: 'Email tells people what concerns them'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_commit: '9bea0943554b41fd052d01f0df37c383163faf78'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-10-1-the-outbox-and-the-notify-function.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only a leave-request decision reaches the outbox. A member whose leave is recorded or whose shifts change, and an admin with a new request waiting in *Za odluku*, still learn nothing until they open the app.

**Approach:** Security-definer AFTER triggers on the tables that assert each fact write the outbox rows in the same transaction (AD-18). Recipients are stored facts only: the record's member, a roster override's members, a team's active members on the date (`member_team_on` + `member_active_on`), or the organization's active admins. `notify` gains the new codes, links through `/prijava/<slug>?povratak=<path>`, and names the organization.

## Boundaries & Constraints

**Always:**
- Events and recipients (one `email` row each; nobody else):
  - leave record recorded, amended or removed → its member, link `/godisnji`;
  - roster override set, amended or removed → `member_in_id` (put on) and `member_out_id` (taken off), each with its own message; a member an amend drops gets the removal message, link `/kalendar`;
  - shift-type override set, amended or removed → the team's active members on that date, link `/kalendar`;
  - rotation assignment inserted, or a scheduled one deleted, with `organization_today <= effective_from <= organization_today + 30` (a cancel: `effective_from > organization_today`); only the cancel of a scheduled version notifies, never a delete cascading from a team, pattern or organization → the team's active members on `effective_from`, link `/kalendar`;
  - leave request inserted → every active admin of the org, link `/za-odluku/zahtjev/<id>`.
- The member whose session made the write (`current_member_access`) gets no row. A write with no session member (service role, seed) notifies normally.
- No row for a recipient with a null `members.email`, or not active today.
- No row for a leave record or override whose dates all lie before `organization_today`.
- An amend is one `*_CHANGED` email, never removed + recorded. An approval's leave insert sends nothing beyond the decision email (a transaction-local flag set by `decide_leave_request` / the amend RPCs).
- Operands are ISO dates, ids and snapshot names only. An email to a member-role account names no other member and no absence type (Q5).
- `subject_id` is the row's id. For a rotation assignment it is the assignment id. The unique key stays as is.
- `claim_notifications` also returns the organization's name. Every body names it and links via `/prijava/<slug>?povratak=<path>`.
- Text lives in `hr.json` `obavijesti`, copied into `messages.ts` deep-equal.

**Ask First:** Any SQL that projects a roster or detects collisions. Any SPA write-path change. Changing the outbox unique key or channel set.

**Never:**
- Collision emails to admins (deferred).
- Swap events (Epic 12).
- Settings, push, List-Unsubscribe or a "how to stop" line (10.3, 10.4).
- `confirm_*` dispositions writing rows.
- Rows from the 0041 deactivation trigger.
- Outbox retention.
- Withdrawing pending rows whose fact no longer holds (deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin records leave | Admin A inserts leave for member M | One `LEAVE_RECORDED` row to M, `{startDate, endDate}` | Refused insert writes none |
| Self-recorded | A records leave for A | No row | N/A |
| Approval | `decide_leave_request` approves | Only the decision row | N/A |
| Amend | `amend_leave_record` / `amend_roster_override` / `amend_shift_type_override` | One `*_CHANGED` row per recipient | N/A |
| Swap on roster | Override moves M out, N in | One row each, neither names the other | N/A |
| Team type change | Shift-type override on team T, date D | One row per active member of T on D with an email | Members off T on D get none |
| Rotation far out | `effective_from` = today + 31 | No row | N/A |
| Rotation edge | `effective_from` = today + 30 | Rows | N/A |
| Past fact | Leave or override wholly before today | No row | N/A |
| Cascade delete | A team or organization with a scheduled rotation is deleted | No row, delete succeeds | N/A |
| Inactive | Recipient inactive today | No row | N/A |
| Rotation save | One statement inserts assignments for 3 teams | Rows for each team's members, once each | N/A |
| New request | Member M inserts a pending request | One `LEAVE_REQUEST_CREATED` row per active admin with email, `{memberName, startDate, endDate}` | M as admin gets none |
| No address | Recipient's email is null | No row | N/A |

## Epic AC Deviations

- "a new item in *Za odluku* … every admin … receives one email". **Narrowed:** only new leave requests. Collisions are derived in the browser (AD-4) and have no stored fact to write from. **Deferred**, with a deferred-work entry.
- "their shifts change by … a swap". **Deferred** to Epic 12, which reuses this outbox.
- "their shifts change by … a shift-type override … or a rotation change". **Reinterpreted:** the email reports the team's change on the date to the team's members. Whether one member's own shift actually differs needs the projection, which neither SQL nor `notify` may compute (Q25).
- "an email … names the facts and linking to the surface". **Narrowed:** no unsubscribe line until 10.3.
- "they receive one email". **Narrowed:** the member whose session made the write gets none, even when their own shifts change (an admin on their own roster override, team or rotation). They made the change and see it.
- "they receive one email". **Narrowed:** nothing for a recipient inactive today, or for a leave record or override wholly in the past. A correction of history is not news.
- "every admin with an email address receives one email". **Narrowed:** admins active today only, and never the requesting admin.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0042_notification_outbox.sql`:
  - table at :75, unique key at :109;
  - `claim_notifications` at :133-212, which returns the slug at :203 and must now also return the org name (drop and recreate);
  - `decide_leave_request` at :303, outbox insert at :383-399, leave insert at :368.
- Write paths (all direct PostgREST except where an RPC is named):
  - `leave_records`: direct insert from `apps/web/src/features/leave/services/leave-write.ts:293`; `amend_leave_record` at 0036:466 (soft-removes, then inserts); `remove_leave_record` at 0036:411.
  - `roster_overrides`: insert from `calendar/services/roster-write.ts:185`; `amend_roster_override` at 0039:195; `remove_roster_override` at 0035:271; `replace_conflict_member` at 0038:221 (an insert, so it notifies).
  - `shift_type_overrides`: insert from `calendar/services/override-write.ts:155`; `amend_shift_type_override` at 0036:639; `remove_shift_type_override` at 0035:228.
  - `rotation_assignments`: one multi-team insert at `rotation/services/write.ts:440`; cancel deletes at :510; `effective_from` at 0016:132.
  - `leave_requests`: insert from `leave/services/leave-request-write.ts:223`; trigger precedents at 0040:362 and 0040:427.
- Soft-remove is `removed_at` going non-null: 0028:72, 0026:80, 0021:68.
- Helpers:
  - `member_team_on` at 0010:118;
  - `member_active_on` and `organization_today` at 0008:169 and :138;
  - `current_member_access` at 0008:268;
  - `members.role`, `members.email` at 0002:134-140;
  - the AFTER-trigger precedent at 0041:175;
  - the advisory-lock and `role = 'authenticated'` gate in 0023.
- `supabase/functions/notify/messages.ts`: `OBAVIJESTI` at :18, `MESSAGE_OF_CODE` at :40, `LINK_PATH_OF_MESSAGE` at :46 (becomes a function of the operands for the request id), `render` at :109.
- `supabase/functions/notify/handler.ts`: the claim row type, and the render call at :276.
- `apps/web/src/lib/i18n/locales/hr.json:1587`; `apps/web/src/features/auth/services/return-target.ts:36` (`povratak`).
- Tests:
  - `test/notify-boundary.test.ts`: the deep-equal pin, and the render tests.
  - `test/rls-isolation.test.ts:21262`: the 10.1 outbox block to extend.
  - `test/resource-hygiene.test.ts`: `SANCTIONED_SCREEN_KEYS`.
  - `test/supabase-scaffold.test.ts`: migration numbering.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0043_notification_events.sql`:
  - a private definer helper that inserts one row per recipient, skipping the actor and null emails;
  - AFTER triggers on `leave_records` (insert, and update of `removed_at`), `roster_overrides`, `shift_type_overrides`, `rotation_assignments` (insert and delete, statement-level with transition tables) and `leave_requests` (insert);
  - recreate `claim_notifications` with the organization name;
  - recreate `decide_leave_request`, `amend_leave_record`, `amend_roster_override` and `amend_shift_type_override` from their latest bodies, adding only the transaction-local flags.
- [x] `apps/web/src/lib/i18n/locales/hr.json` and `supabase/functions/notify/messages.ts`:
  - new messages for every code: `LEAVE_RECORDED`, `LEAVE_RECORD_CHANGED`, `LEAVE_RECORD_REMOVED`; `ROSTER_ADDED`, `ROSTER_REMOVED`, `ROSTER_CHANGED`; `TEAM_SHIFT_TYPE_SET`, `TEAM_SHIFT_TYPE_CHANGED`, `TEAM_SHIFT_TYPE_REMOVED`; `ROTATION_CHANGES`, `ROTATION_CHANGE_CANCELLED`; `LEAVE_REQUEST_CREATED`;
  - every body names `{organizationName}`;
  - links through `/prijava/<slug>?povratak=<path>`;
  - add the keys to `SANCTIONED_SCREEN_KEYS`.
- [x] `supabase/functions/notify/handler.ts`: pass the org name and slug into `render`.
- [x] Tests:
  - `test/rls-isolation.test.ts`: every matrix row against the real triggers, in rolled-back transactions;
  - `test/notify-boundary.test.ts`: render every code, the link shape, and the deep-equal pin;
  - scaffold updates.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md`: already holds the collision and swap entries.

**Acceptance Criteria:**
- Given any matrix event, when its transaction rolls back, then no outbox row remains.
- Given a member-role recipient, when any of its rows renders, then the text contains no other member's name and no absence type.
- Given the tree, when `pnpm db:reset && pnpm lint && pnpm typecheck && pnpm test` run, then all pass.

## Spec Change Log

- 2026-10-29, review loop 1 (human-approved intent amendment, code kept, not reverted, because the amendments narrow or add behavior):
  - Trigger: the epic AC audit found the actor and active-today narrowings unlisted. The blind and edge reviews found that rotation deletes cascading from a team or organization notify (and can break an organization delete), past-dated facts and inactive recipients notify, and a roster email never says in or out.
  - Amended: the roster in/out messages; the rotation lower bound and cancel-only deletes; no rows for inactive recipients or wholly past facts; three Epic AC Deviations entries; the matrix rows for the edge, the past fact, the cascade and the inactive recipient. The recipient key's `on delete cascade` is approved.
  - Known-bad state avoided: an organization delete fails or mails a cancel; members are mailed about history or after deactivation; the member taken off a shift is not told.
  - KEEP: the trigger mechanism and `private.notify_members`; the suppress and amend-previous flags; the four recreated definers unchanged apart from the flags; the 0043 test block in rolled-back transactions; `linkPathOf` and the `/prijava/<slug>?povratak=` links; the deep-equal pin.

## Design Notes

- Triggers rather than RPCs: three of the five tables are written by direct PostgREST inserts. A trigger covers every path, including `replace_conflict_member` and the amends, without touching the SPA.
- Flags: `set_config('shift.notify_suppress', 'approval' | 'amend', true)`. The triggers read the flag with `current_setting(…, true)`, so a missing setting is not an error.
- Snapshot names, such as the shift-type name and, for admins, the requesting member's name, go into operands at write time. `notify` never looks them up.
- A rotation save inserts every team's assignment in one statement. Each row is a new version, so each team's members get one email.

## Verification

**Commands:**
- `pnpm db:reset && pnpm test`: expected green.
- `pnpm lint && pnpm typecheck`: expected clean.

## Suggested Review Order

**The fact writes its own notification (AD-18)**

- Entry point: one helper writes every row, skipping the actor, no address and the inactive.
  [`0043_notification_events.sql:80`](../../supabase/migrations/0043_notification_events.sql#L80)

- Leave record insert and removal; amend and approval collapse through the flag.
  [`0043_notification_events.sql:189`](../../supabase/migrations/0043_notification_events.sql#L189)

- Roster override: put-on and taken-off sides, amend drops told they are off.
  [`0043_notification_events.sql:263`](../../supabase/migrations/0043_notification_events.sql#L263)

- Shift-type override to the team's active members on the date, no projection.
  [`0043_notification_events.sql:338`](../../supabase/migrations/0043_notification_events.sql#L338)

- Rotation insert bounded to today…today+30, statement-level over all teams.
  [`0043_notification_events.sql:411`](../../supabase/migrations/0043_notification_events.sql#L411)

- Rotation delete: only a cancel; cascades skipped by trigger depth and team existence.
  [`0043_notification_events.sql:441`](../../supabase/migrations/0043_notification_events.sql#L441)

- New leave request to every active admin, never the requester.
  [`0043_notification_events.sql:490`](../../supabase/migrations/0043_notification_events.sql#L490)

**Suppression flags in the definers**

- Approval suppresses the leave insert's own row.
  [`0043_notification_events.sql:696`](../../supabase/migrations/0043_notification_events.sql#L696)

- Amend: one `*_CHANGED`, previous recipients carried through a transaction-local setting.
  [`0043_notification_events.sql:146`](../../supabase/migrations/0043_notification_events.sql#L146)

- Recipient key now cascades on member delete (approved).
  [`0043_notification_events.sql:72`](../../supabase/migrations/0043_notification_events.sql#L72)

**Rendering and links**

- Claim also returns the organization name.
  [`0043_notification_events.sql:551`](../../supabase/migrations/0043_notification_events.sql#L551)

- Links through `/prijava/<slug>?povratak=`; request link validated as a UUID.
  [`messages.ts:127`](../../supabase/functions/notify/messages.ts#L127)

- Only named date operands are formatted as dates.
  [`messages.ts:185`](../../supabase/functions/notify/messages.ts#L185)

- Handler passes slug and organization name to render.
  [`handler.ts:281`](../../supabase/functions/notify/handler.ts#L281)

- The Croatian wording to review.
  [`hr.json:1608`](../../apps/web/src/lib/i18n/locales/hr.json#L1608)

**Peripherals**

- Deploy order: migration 0043 before the new `notify`.
  [`DEPLOY.md:633`](../../DEPLOY.md#L633)

- Every matrix row against the real triggers, rolled back.
  [`rls-isolation.test.ts:21509`](../../test/rls-isolation.test.ts#L21509)

- Every code renders; real claim checks the organization name.
  [`notify-boundary.test.ts:116`](../../test/notify-boundary.test.ts#L116)

- Every link path survives the SPA's return-target check.
  [`router.test.ts:193`](../../apps/web/src/router.test.ts#L193)
