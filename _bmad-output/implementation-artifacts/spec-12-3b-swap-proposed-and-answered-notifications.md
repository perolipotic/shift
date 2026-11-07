---
title: 'A swap proposed to a member, and its answer to the proposer, are notified'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: '75530717de259baf435c332a1f7efb0f68d3ab5f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-3-the-colleague-accepts-or-declines.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nobody is told about a swap. The addressee learns of a proposal only by opening *Danas*, and the proposer learns of the answer the same way (FR-62: "when a swap is proposed to them").

**Approach:** Migration 0050 adds AFTER triggers on `swap_requests` that write three outbox codes through `private.notify_members`. `notify` renders them. First, `notify/handler.ts` is split into modules with no change in behaviour (retro 10).

## Boundaries & Constraints

**Always:**
- **The split comes first, as a pure refactor.** `handler.ts` keeps the codes, constants, configuration and shared types. `email.ts` gets Resend delivery, `push.ts` gets push delivery and the device read, and `run.ts` gets `createHandler` and the run loop. There are no import cycles: each module imports only from modules below it. `index.ts` imports `createHandler` from `run.ts`. Tests import each symbol from the module that defines it. No behaviour, code or constant changes.
- **0050 is one trigger function, `private.notify_swap_request()`**, a security definer with `search_path = ''`, callable by nobody. It runs on two triggers:
  - `swap_requests_notify_insert`, AFTER INSERT, `when (new.closed_at is null)`: `SWAP_REQUEST_PROPOSED` to `addressee_id`.
  - `swap_requests_notify_answer`, AFTER UPDATE OF `answer`, `when (old.answer is null and new.answer is not null)`: `SWAP_REQUEST_ACCEPTED` or `SWAP_REQUEST_DECLINED` to `proposer_id`.
- **Rows:** the subject is the swap's id. The operands are `{date}`, plus `returnDate` only when the swap has a return shift, as ISO dates. No names (Q5). The recipient rules are `notify_members`'s: never the session's own member, active today, an email row only with an address, a push row only with a device, and 0044's email switch.
- **A wholly past swap notifies nobody:** no row when the given date, and the return date if there is one, are all before `organization_today` (0043's "a correction of history is not news").
- **Messages**, in `hr.json` `obavijesti` first, then copied to `messages.ts`. Each names `{date}` only and links to `/danas`:
  - `swapRequestProposed`: "Predložena ti je zamjena {date}" / "{organizationName}: predložena ti je zamjena smjene {date}. Odgovori u aplikaciji: {link}"
  - `swapRequestAccepted`: "Zamjena {date} je prihvaćena" / "{organizationName}: tvoj prijedlog zamjene smjene {date} je prihvaćen i čeka odluku. Pogledaj u aplikaciji: {link}"
  - `swapRequestDeclined`: "Zamjena {date} je odbijena" / "{organizationName}: tvoj prijedlog zamjene smjene {date} je odbijen. Pogledaj u aplikaciji: {link}"
  - `returnDate` joins `DATE_OPERANDS`.
- **Pins:** the new codes in `notify-boundary` (`EVERY_CODE`, Q5); the function in `provisioning`'s grantee list; the triggers in `provisioning`'s swap trigger list and in `supabase-scaffold`'s swap trigger list, which now reads 0050 too. In `rls-isolation`, rewrite the test at :24017 and add the 0050 suite.
- **Deferral answered:** the 12.3 entry "decide in 12.3b whether a swap notification, or a focus refetch …" is answered by the notification alone. `MY_SWAP_REQUESTS_KEY` stays `refetchOnWindowFocus: false`, as every read here is. Mark the entry RESOLVED.

**Ask First:**
- Any change to 0049, to `notify_members` or to any earlier migration.
- Any SPA change beyond `hr.json`.
- Any rendering change in `notify` other than the three message keys and `returnDate`.

**Never:**
- A withdrawal, deactivation close or decision notifies anyone (12.4 owns the decision and the admin notices).
- An admin row for an accepted swap (12.4).
- A member's name, a team or a shift type in any operand.
- Running DB-connecting tests, applying a migration, or patching a test harness (CI is the gate).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Proposal | A member inserts a swap | One `SWAP_REQUEST_PROPOSED` per channel to the addressee; none to the proposer | — |
| Accept | The addressee accepts | `SWAP_REQUEST_ACCEPTED` to the proposer | — |
| Decline | The addressee declines | `SWAP_REQUEST_DECLINED` to the proposer | — |
| Withdraw | Either member, proposed or accepted | No row | — |
| Past | Answer when every date is before today | No row | — |
| No address, no device | The recipient has neither | No row | — |
| Return shift | The swap has a return shift | `returnDate` in the operands; the text is unchanged | — |
| Refused write | Insert or answer refused | No row (same transaction) | the write's SQLSTATE |

## Epic AC Deviations

- **Narrowed.** The epic says (Notifications): "a member is told when a swap is proposed to them, when it is decided … Every admin is told when a new item waits in *Za odluku*." Choice: this story does proposed (to the addressee) and answered (to the proposer). Decided, and the admin notice, belong to 12.4, as already recorded in `deferred-work.md` (product owner, 2026-11-06).
- **Added.** Telling the proposer about the answer is not in an epic AC. It follows from 12.3's "the proposer sees it declined" (product owner split, 2026-11-06).

</frozen-after-approval>

## Code Map

- `supabase/functions/notify/handler.ts`:
  - codes at :53-183; configuration at :185-307; client types at :309-452;
  - email at :482-550 (`deliveryOfStatus`, `deliverEmail`);
  - push at :552-722 (`deviceOutcomeOfStatus`, `settlementOfDevices`, `deliverPush`, `deviceReadOf`, `pushEncryptorOf` at :385);
  - run at :724-940 (`createHandler`, `sameSecret` at :461).
- `notify/index.ts:19` imports `createHandler`, `pushEncryptorOf`, `readConfiguration`. `messages.ts`: `OBAVIJESTI` :18, `MESSAGE_OF_CODE` :104, `linkPathOf` :132, `DATE_OPERANDS` :199. Precedent for the split: `supabase/functions/admin-auth/` (handler, authorize, operations).
- `supabase/migrations/0043_notification_events.sql`: the `notify_leave_record` and `notify_roster_override` pattern, with the trigger plus `when` clause and the "live" past rule. `0045:257` is the current `notify_members`. `0049:197-290` holds the `swap_requests` columns; `answer_swap_request` at :562 sets `answer` and closes on a decline in one update.
- `apps/web/src/lib/i18n/locales/hr.json:1733` holds `obavijesti`. It is a hot file; the baseline is main after #278.
- Tests:
  - `test/notify-boundary.test.ts`: imports at :12-77; the four-files pin at :929; the RPC scan of `handler.ts` only at :946 (scan every module); the VAPID check at :954; `EVERY_CODE` at :333; the code set at :448; Q5 at :472.
  - `test/key-hygiene.test.ts:460` expects `VAPID_PRIVATE_KEY` in `handler.ts`; it stays there.
  - `test/provisioning.test.ts`: the swap triggers at :1809; the grantees at :2304-2309.
  - `test/supabase-scaffold.test.ts:3238-3346`: the swap trigger pin reads 0049 only. Extend it to 0050's two AFTER triggers, and keep "no row-level BEFORE".
  - `test/resource-hygiene.test.ts:2197-2231` lists the `obavijesti` keys.
  - `test/rls-isolation.test.ts`: the swap helpers at :23346-23493; the outbox test at :24017.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/functions/notify/{handler,email,push,run,index}.ts` -- split as in Always. Move code only -- retro 10 asked for this before Epic 12 adds codes.
- [x] `test/notify-boundary.test.ts`, `test/key-hygiene.test.ts` -- point the imports and the file and RPC pins at the new modules, and pin the layering -- the behaviour tests stay unchanged. `key-hygiene` needed no change: `VAPID_PRIVATE_KEY` stays in `handler.ts`.
- [x] `supabase/migrations/0050_swap_request_notifications.sql` -- add the function, the two triggers and the revokes. The header says what it does and does not do.
- [x] `apps/web/src/lib/i18n/locales/hr.json`, `supabase/functions/notify/messages.ts` -- add the three keys, the codes, the `/danas` link and the `returnDate` date operand.
- [x] `test/notify-boundary.test.ts`, `test/resource-hygiene.test.ts` -- add the three codes and keys.
- [x] `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts` -- register 0050's function and triggers.
- [x] `test/rls-isolation.test.ts` -- rewrite :24017: a proposal writes exactly the addressee's row, and an accept exactly the proposer's. Add, per fixture: a decline to the proposer; a withdrawal and a deactivation close write nothing; a past answer writes nothing; never the actor; a push row with a device; `returnDate` only with a return shift.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark RESOLVED the 12.3b split entry, the 12.1 notification entry for its 12.3b part, and the 12.3 "reaches the card late" entry.

**Acceptance Criteria:**
- Given the split, when the typecheck and the pure notify tests run, then the behaviour assertions pass; only the file, import and layering pins change.
- Given a migration-applied stack (CI), when the rls-isolation and provisioning suites run, then every row in the matrix holds on both fixtures.

## Design Notes

One function on two triggers matches `notify_leave_record`. A decline closes the swap in the same update that sets `answer`, so the answer trigger sees both changes, and the close never needs a trigger of its own. The text omits the return date so that each code needs only one message. The addressee sees the full swap on *Danas*, where the link goes.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm typecheck` -- expected: no errors
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint` -- expected: clean
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm vitest run test/resource-hygiene.test.ts test/key-hygiene.test.ts test/supabase-scaffold.test.ts` -- expected: pass (no DB). notify-boundary, provisioning and rls-isolation run in CI only. notify-boundary's pure cases were also run locally, from a temporary copy with its `./database.js` import stubbed (`noDatabase = true`), and the copy was deleted.

## Suggested Review Order

**The notification facts (0050)**

- One definer function on two AFTER triggers. The past rule and operands are here.
  [`0050_swap_request_notifications.sql:41`](../../supabase/migrations/0050_swap_request_notifications.sql#L41)

- The insert fires only for an open, unanswered row. The answer fires only on null → set.
  [`0050_swap_request_notifications.sql:83`](../../supabase/migrations/0050_swap_request_notifications.sql#L83)

**Rendering**

- Three messages. Each names only `{date}`, with no names (Q5).
  [`messages.ts:18`](../../supabase/functions/notify/messages.ts#L18)

- Every swap code links to `/danas`, where the full swap is shown.
  [`messages.ts:170`](../../supabase/functions/notify/messages.ts#L170)

- `returnDate` is validated as a date even though it is not printed.
  [`messages.ts:222`](../../supabase/functions/notify/messages.ts#L222)

**The notify split (code moved only)**

- The wiring imports each name from its defining module.
  [`index.ts:20`](../../supabase/functions/notify/index.ts#L20)

- The run loop now lives in `run.ts`.
  [`run.ts:91`](../../supabase/functions/notify/run.ts#L91)

- Email delivery.
  [`email.ts:32`](../../supabase/functions/notify/email.ts#L32)

- Push delivery and the encryptor.
  [`push.ts:49`](../../supabase/functions/notify/push.ts#L49)

**Tests and pins**

- The module layering pin guards against cycles.
  [`notify-boundary.test.ts:976`](../../test/notify-boundary.test.ts#L976)

- The three codes are rendered in `EVERY_CODE`.
  [`notify-boundary.test.ts:445`](../../test/notify-boundary.test.ts#L445)

- Static pins on 0050: triggers, the past rule and operands.
  [`supabase-scaffold.test.ts:3350`](../../test/supabase-scaffold.test.ts#L3350)

- Trigger definitions as Postgres prints them. These run in CI only.
  [`provisioning.test.ts:1811`](../../test/provisioning.test.ts#L1811)

- The 0050 suite: recipients, past rule, withdrawal, refusals. These run in CI only.
  [`rls-isolation.test.ts:24623`](../../test/rls-isolation.test.ts#L24623)

- The `smjen` exemption for the three bodies, following the swaps namespace.
  [`resource-hygiene.test.ts:2613`](../../test/resource-hygiene.test.ts#L2613)
