---
title: 'Admins are told a swap waits for them, and both members are told it was decided'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: 'e80a4a9bc3575ecf3ea7d38e8224635adf83fa5b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-3b-swap-proposed-and-answered-notifications.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An accepted swap waits in *Za odluku*, but no admin is told, and neither member is told when an admin approves or rejects it (epic 10.2 ACs; deferred from 12.1, 12.3 and 12.4).

**Approach:** Migration 0051 adds one trigger function on two AFTER triggers, on 0050's pattern. It writes `SWAP_REQUEST_WAITING` to admins on an accept and `SWAP_REQUEST_APPROVED` / `SWAP_REQUEST_REJECTED` to both members on a decision, through `private.notify_members`. `notify` renders the three codes.

## Boundaries & Constraints

**Always:**
- **`private.notify_swap_request_decision()`**: security definer, `search_path = ''`, callable by nobody, branching on `tg_table_name`:
  - `swap_requests_notify_waiting`, AFTER UPDATE OF `answer` on `swap_requests`, `when (old.answer is null and new.answer = 'accepted' and new.closed_at is null)`. It writes `SWAP_REQUEST_WAITING` to every `role = 'admin'` member of the organization (0043's `notify_leave_request` set). The operands are `{requestId, proposerName, addresseeName, date}`, with the names as snapshots from `members.name`.
  - `swap_request_decisions_notify_insert`, AFTER INSERT on `swap_request_decisions`, `when (new.outcome in ('approved', 'rejected'))`. It reads the swap and writes `SWAP_REQUEST_APPROVED` or `SWAP_REQUEST_REJECTED` (by explicit match) to `array[proposer_id, addressee_id]`. The operands are `{date}`, plus `returnDate` only with a return shift. No names (Q5).
- **Subject** is always the swap's id, so the existing e2e cleanups that delete outbox rows by swap id cover the new rows.
- **Recipient rules** are `notify_members`'s: never the session's own member, active today, email only with an address, push only with a device, and the email switch. An admin who is a party is an admin like any other.
- **A wholly past swap notifies nobody**, by 0050's `live` rule (the given date, or the return date if any, ≥ `organization_today`).
- **Messages**, written in `hr.json` `obavijesti` first, then copied to `messages.ts`:
  - `swapRequestWaiting`: "Nova zamjena za odluku: {proposerName} → {addresseeName}" / "{organizationName}: zamjena smjene {date}, {proposerName} → {addresseeName}. Čeka tvoju odluku: {link}". It links to `/za-odluku/zamjena/{requestId}`, and a missing or non-UUID `requestId` gives `OPERANDS_INVALID`, as `leaveRequestCreated` does.
  - `swapRequestApproved`: "Zamjena {date} je odobrena" / "{organizationName}: zamjena smjene {date} je odobrena. Pogledaj u aplikaciji: {link}". It links to `/danas`.
  - `swapRequestRejected`: "Zamjena {date} nije odobrena" / "{organizationName}: zamjena smjene {date} nije odobrena. Pogledaj u aplikaciji: {link}". It links to `/danas`.
- 0043's `ROSTER_PUT_ON` / `ROSTER_TAKEN_OFF` notices for the approval's overrides stay as they are (product owner, 2026-11-07).

**Ask First:** any change to 0049, 0050, `notify_members` or an earlier migration; any SPA change beyond `hr.json`; any rendering change beyond the three keys and their links.

**Never:**
- A withdrawal, a decline, a deactivation close (`outcome = 'deactivated'`) or a refused decision notifies anyone.
- A name in an operand of a member-bound code.
- Suppressing the roster notices.
- DB-connecting tests, migration apply or harness patches (CI is the gate).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Accept | The addressee accepts | `SWAP_REQUEST_WAITING` to every admin active today, the addressee excluded if an admin; 0050's `ACCEPTED` unchanged |
| Approve | An admin approves | `SWAP_REQUEST_APPROVED` to both members (the deciding admin excluded if a party), plus 0043's roster rows |
| Reject | An admin rejects | `SWAP_REQUEST_REJECTED` to both members; no roster rows |
| Deactivation close | A party is deactivated | No row from 0051 |
| Decline / withdraw | — | No row from 0051 |
| Past | Accept or decide with every date before today | No row |
| Refused approval | Stale, inactive or erasure refusal | No row (same transaction) |

## Epic AC Deviations

- **Reinterpreted.** 10.2 says: "their shifts change by … a swap … Then they receive one email". An approval writes `SWAP_REQUEST_APPROVED` and 0043's roster notice, which is one per override. The product owner chose to keep both on 2026-11-07. A leave approval suppresses `LEAVE_RECORDED`; a swap approval does not.
- **Narrowed.** 10.2 says: "a new item in *Za odluku* … every admin … receives one email". This holds under `notify_members`'s rules (active today, never the writer's own member), as for `LEAVE_REQUEST_CREATED`.
- **Narrowed.** A swap whose dates are all past still enters *Za odluku* but notifies no admin (0043's rule, product owner 2026-11-07).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0050_swap_request_notifications.sql`: the template (header, `live`, operands, revokes). Do not edit it.
- `0043_notification_events.sql:488-531`: the admin set and names in `notify_leave_request`. `0049:311-360`: the decision columns. `0049:690-780`: `decide_swap_request` closes the swap, writes the overrides, then inserts the decision. `0049:786`: the deactivation inserts `deactivated`.
- `supabase/functions/notify/messages.ts`: `OBAVIJESTI` :18, `MESSAGE_OF_CODE` :120, `linkPathOf` :150 (the `leaveRequestCreated` UUID case). `hr.json:1843-1858`.
- Tests:
  - `test/notify-boundary.test.ts`: `EVERY_CODE` :436-463; the code set :467; the Q5 filter :493 (exclude WAITING as LEAVE_REQUEST_CREATED is); the returnDate case :516; the bad requestId case :532.
  - `test/resource-hygiene.test.ts`: the keys :2281; `SWAP_NOTIFICATION_KEYS` :2661 (the `smjen` exemption for the bodies).
  - `test/supabase-scaffold.test.ts:3336-3395`: the swap trigger list and 0050's static pins. Add 0051's.
  - `test/provisioning.test.ts`: the trigger texts :1811; the grantees :2315.
  - `test/rls-isolation.test.ts`: :24017 asserts exact rows after an accept and an approval with the admin addressed, so it now gains WAITING and APPROVED rows. The 0050 suite (:24623+) has exact-row and "writes nothing beyond" cases to recheck.
- `e2e/utils/database-helper.ts` :418, :1535, :1838: the outbox deletes are by swap id and already cover 0051. Update their comments only.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0051_swap_request_decision_notifications.sql` -- the function, two triggers and the revoke, with a header saying what is and is not written.
- [x] `apps/web/src/lib/i18n/locales/hr.json`, `supabase/functions/notify/messages.ts` -- three keys, codes and links.
- [x] `test/notify-boundary.test.ts`, `test/resource-hygiene.test.ts` -- the three codes and keys, the Q5 exception for WAITING, `returnDate` for APPROVED and REJECTED, and the requestId refusal for WAITING.
- [x] `test/supabase-scaffold.test.ts`, `test/provisioning.test.ts` -- register 0051's function and triggers, with static pins as for 0050.
- [x] `test/rls-isolation.test.ts` -- update :24017 and any 0050-suite exact lists 0051 extends. Add a 0051 suite per fixture covering every matrix row, plus "never the writer" and the operands.
- [x] `e2e/utils/database-helper.ts` -- the comments name 0051.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- prefix the entries at :1100, :1310, :1343 and :1367 with RESOLVED by 12.4b.

**Acceptance Criteria:**
- Given the change, when typecheck, lint and the no-DB tests run, then they pass.
- Given CI's migrated stack, when rls-isolation and provisioning run, then every matrix row holds on both fixtures.

## Spec Change Log

- 2026-11-07, after review (PR #281): the product owner authorized and approved two edits to the frozen block. (1) The `swapRequestWaiting` body was "{addresseeName} preuzima smjenu {date} od {proposerName}…", which put a nominative name after *od* ("od Ana Kovač", where Croatian needs the genitive). It is now "zamjena smjene {date}, {proposerName} → {addresseeName}. Čeka tvoju odluku: {link}", with no preposition before a name; the subject is unchanged. (2) Epic AC Deviations gains the past-swap narrowing of 10.2's admin AC, which the epic AC auditor found unlisted. KEEP: the migration and the past rule are unchanged; only the text and the documentation moved.

## Design Notes

One function on two tables keeps 12.4b one fact: "a swap reached the admin step, or left it". The trigger sits on the decision row, not on the close, because the decision row is the only place the outcome lives (AD-1). It is inserted last in `decide_swap_request`, so a refused approval never reaches it.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm typecheck && pnpm lint` -- expected: clean
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- expected: pass. notify-boundary's pure cases run from a temporary copy with the DB import stubbed, as in 12.3b. The rest run in CI.

## Suggested Review Order

**The notification facts (0051)**

- One definer on two tables; the branch picks the swap from the row or the decision.
  [`0051_swap_request_decision_notifications.sql:49`](../../supabase/migrations/0051_swap_request_decision_notifications.sql#L49)

- 0050's past rule, read once for both branches.
  [`0051_swap_request_decision_notifications.sql:77`](../../supabase/migrations/0051_swap_request_decision_notifications.sql#L77)

- The waiting notice: every admin, names as snapshots, recipient rules left to `notify_members`.
  [`0051_swap_request_decision_notifications.sql:82`](../../supabase/migrations/0051_swap_request_decision_notifications.sql#L82)

- The decided notice: explicit outcome match, both members, dates only (Q5).
  [`0051_swap_request_decision_notifications.sql:116`](../../supabase/migrations/0051_swap_request_decision_notifications.sql#L116)

- The `when` clauses keep decline, withdrawal and deactivation out.
  [`0051_swap_request_decision_notifications.sql:136`](../../supabase/migrations/0051_swap_request_decision_notifications.sql#L136)

**Rendering**

- Three messages; WAITING alone names members, and goes to admins only.
  [`messages.ts:99`](../../supabase/functions/notify/messages.ts#L99)

- WAITING links to the swap's decision screen, refusing a non-UUID id.
  [`messages.ts:195`](../../supabase/functions/notify/messages.ts#L195)

**Tests and pins**

- The 0051 suite: recipients, writer exclusion, refusals, past rule (CI only).
  [`rls-isolation.test.ts:24983`](../../test/rls-isolation.test.ts#L24983)

- The accept-then-approve case now expects WAITING and APPROVED rows.
  [`rls-isolation.test.ts:24068`](../../test/rls-isolation.test.ts#L24068)

- Trigger definitions as Postgres prints them (CI only).
  [`provisioning.test.ts:1808`](../../test/provisioning.test.ts#L1808)

- Static pins on the swap trigger list and 0051's function.
  [`supabase-scaffold.test.ts:3324`](../../test/supabase-scaffold.test.ts#L3324)

- The three codes rendered, and the Q5 exception for WAITING.
  [`notify-boundary.test.ts:469`](../../test/notify-boundary.test.ts#L469)

- The keys and the `smjen` exemption for the bodies.
  [`resource-hygiene.test.ts:2289`](../../test/resource-hygiene.test.ts#L2289)
