---
title: 'The swap request record'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '27f4e92c33c7cb7ec4c9c4b794b6084ec5bdf960'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member cannot propose a swap. No table holds one, so no one can answer it, and no decision can turn it into roster overrides.

**Approach:** Add migration `0049_swap_requests.sql` as the whole data layer of a swap, on 9.2's pattern (0040/0041). It holds `swap_requests` (a proposer-owned insert), the addressee's answer, `swap_request_decisions`, three definers (`withdraw_swap_request`, `answer_swap_request`, `decide_swap_request`), and a deactivation close. No app, domain or UI code; 12.2–12.4 build on this.

## Boundaries & Constraints

**Always:**
- **The row.** Tenant first. Composite keys to `members` for `proposer_id` and `addressee_id` (distinct), and to `teams` for `team_id` and `return_team_id`. A shift is `(team_id, date)`; the return shift `(return_team_id, return_date)` is both null or both set, and is never the given shift. Dates are finite, as 0026 checks. AD-11 `created_by`/`created_at`. `on delete cascade` from the organization only.
- **Answer and close.** `answer in ('accepted','declined')`, `answered_by` and `answered_at` are set together, and only by `answer_swap_request`. `closed_by`/`closed_at` are set together, and only by the definers and the deactivation trigger. A decline closes in the same call.
- **Status is derived, never stored twice:**
  - open, no answer → proposed;
  - open and accepted → waits for an admin;
  - closed and declined → declined;
  - closed with a decision → its outcome;
  - closed otherwise → withdrawn, and `closed_by` says by whom.
- **One open swap per given shift.** A partial unique key on `(organization_id, proposer_id, team_id, date) where closed_at is null` refuses a second one with 23505. A second partial key does the same for the return shift and the addressee.
- **Insert.** Any active account inserts only as its own proposer, under a self-owned policy (0040's lookup by `auth_user_id`, the organization from the claim, active status from `current_member_access()`). `created_by = auth.uid()` is pinned. Both dates must be `>= organization_today(organization_id)`. A refusal is 42501. The column grant covers exactly the seven proposal columns.
- **Read.** An active admin reads the organization's swaps and decisions. A member-role account reads those where it is the proposer or the addressee.
- **Decisions.** `request_id` is the key, with a composite FK to the request. `outcome in ('approved','rejected','deactivated')`. `roster_override_id` is not null exactly when the outcome is approved. `return_roster_override_id` is null unless approved. Both use composite FKs to 0032's `roster_overrides (organization_id, id)`. `decided_by`/`decided_at` come from defaults. Sessions hold only read.
- **Definers** follow 0040: the claim, the organization lock inline, an empty `search_path`, and EXECUTE for `authenticated` only.
  - `answer_swap_request(id, answer)`: only the addressee, only while proposed. Otherwise P0002 `SWAP_REQUEST_NOT_OPEN`. An inactive caller gets 42501 `SWAP_REQUEST_ANSWER_REFUSED`. A bad answer gets 22023.
  - `withdraw_swap_request(id)`: the proposer, while proposed or accepted, or the addressee once accepted. Otherwise P0002. An inactive caller gets 42501 `SWAP_REQUEST_WITHDRAWAL_REFUSED`.
  - `decide_swap_request(id, outcome, reason)`: an active admin only (42501 `SWAP_REQUEST_DECISION_REFUSED`), and only for an open, accepted swap (P0002). A bad outcome gets 22023.
    - On approval, in one transaction, it inserts a roster override taking the proposer off and putting the addressee on the given shift, plus the reverse on the return shift if there is one. Each override uses `p_reason`. Then it writes the decision with both override ids and closes the request.
    - Any refusal of an override insert (0026's 23505 or 23514) aborts the whole call, and the swap stays accepted.
    - An admin may decide a swap they are part of.
- **Deactivation** works as 0041 does. An AFTER INSERT trigger on `member_status_versions`, for an inactive version, closes every open swap where that member is the proposer or the addressee and either date is `>=` the version's date. Each gets a `deactivated` decision attributed to the version's `created_by`.
- `swap_requests` takes 0023's statement lock trigger.
- **Docs** (`ARCHITECTURE-SPINE.md`): AD-4 and AD-10 amendments as shipped, a CAP-22 row, and the erDiagram entries.

**Ask First:** any change to `roster_overrides`, `leave_requests`, `current_member_access()` or 0043's notify triggers; any app, domain or UI code.

**Never:**
- No reader of `swap_requests` in `apps` or `packages` (R9.1).
- No roster projected in SQL: the database never checks whether a shift is a working shift on someone's roster (AD-1, AD-3).
- No new refusing trigger.
- No new outbox code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Propose | Own row; with and without a return shift | Proposed, `created_by` = caller | — |
| Forged | Colleague as proposer; a named `answer`/`closed_at`/`created_by` | Refused | 42501 |
| Past / self / same shift | Date before today; addressee = proposer; return = given | Refused | 42501 / 23514 / 23514 |
| Duplicate | Second open swap of one given shift | Refused; allowed after close | 23505 |
| Answer | Addressee accepts or declines; proposer or admin answers; answer twice | Accepted, or closed as declined / refused / refused | — / P0002 / P0002 |
| Withdraw | Proposer (proposed or accepted); addressee once accepted; addressee while proposed; a third member | Withdrawn / withdrawn / refused / refused | — / — / P0002 / P0002 |
| Decide | Member decides; admin decides a proposed swap; admin approves an accepted one | Refused / refused / overrides, decision and close attributed to the admin | 42501 / P0002 / — |
| Approval collides | A live override already takes the proposer off that shift | Call aborts, swap stays accepted | 23505 |
| Reject | Admin rejects | Decision, no override | — |
| Deactivation | Proposer or addressee deactivated on or before a swap date | Closed, `deactivated` | — |
| Inactive party (F1, 2026-11-06) | Addressee inactive on the given date, or proposer inactive on the return date (a scheduled deactivation counts) | Insert refused; approval refused, swap stays accepted; rejection lands | 42501 / 55000 `SWAP_REQUEST_MEMBER_INACTIVE` / — |
| Nothing derives | Proposed or accepted swap | `calendar_roster_overrides()` and the outbox are unchanged | — |
| Approval notifies | Approved swap | 0043's `ROSTER_PUT_ON`/`ROSTER_TAKEN_OFF` reach both members, not the admin | — |
| Cross-tenant | Another organization's member, team or swap | Invisible; refused | 42501 / 23503 / P0002 |

## Epic AC Deviations

- Quote: "only the proposer inserts and withdraws".
  - Choice: the addressee may also withdraw an accepted swap; before accepting, they decline.
  - Reason: PRD FR-69 and CAP-22 say "Either Member can withdraw a swap before an Admin decides it." Approved by the product owner, 2026-11-05.
- Quote: "its states are proposed → accepted or declined → approved or rejected, or withdrawn".
  - Choice: a fourth closing outcome, `deactivated`: deactivating the proposer or the addressee closes their open swaps with a `deactivated` decision, as 0041 does for leave requests.
  - Reason: product-owner decision 4 (2026-11-05); listed here on the product owner's approval, 2026-11-06.
- Quote (12.4's AC, which 12.1's approval now serves): "it writes Roster Overrides … with reason `swap`".
  - Choice: the override's reason is the admin's `p_reason` (the 12.4 screen supplies the Croatian words), and "this is a swap" is recorded structurally by the decision's two override ids, not by a literal `swap`.
  - Reason: product-owner decision 3 (2026-11-05); `roster_overrides.reason` is shown to people as written, and `roster_overrides` stays untouched. Listed here on the product owner's approval, 2026-11-06.
- Addition (F1, product owner 2026-11-06), narrowing "only the proposer inserts" and "only an admin approves": a swap that would put an inactive member on a shift (the addressee on the given date, or the proposer on the return date) is refused at insert by the policy (42501, through a narrow definer helper) and at approval with 55000 `SWAP_REQUEST_MEMBER_INACTIVE`, as 0041 refuses leave for an inactive member.
- (Not a 12.1 AC; recorded for the epic.) FR-66 says a given shift that is not on the proposer's roster is refused when sent. The database cannot project a roster, so the refusal is the 12.2 form's domain check. A direct API call can store such a swap. Its approval writes an override the domain treats as inert (0026), and 12.4's stale check refuses it. A `deferred-work.md` entry for 12.2 and 12.4 records this.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0040_leave_requests.sql` -- the template: header style, table, policies (:255, :289), column grant (:350), lock trigger (:362), definers (:434, :492).
- `supabase/migrations/0041_deactivation_closes_leave_requests.sql:127-179` -- the deactivation trigger to mirror, with its revokes.
- `supabase/migrations/0026_roster_overrides.sql:52-130` -- the override shape, the reason check, the live unique keys that abort a colliding approval.
- `supabase/migrations/0032_replace_conflict_member.sql:75,173` -- `roster_overrides_organization_id_id_key`; a definer inserting an override.
- `supabase/migrations/0043_notification_events.sql:263-334` -- the roster notify trigger that the approval fires (no change).
- `supabase/migrations/0008_member_status.sql:138` -- `organization_today(uuid)`, granted to `authenticated`.
- `test/rls-isolation.test.ts` -- helpers `tokenFor` :255, `restRefusal` :329, `actAs` :493 (file-local, so the suite lives here); the policy and function lists :961-1170; the 9.2 block :20224.
- `test/supabase-scaffold.test.ts:534, 3028-3090` -- the exact policy list and the column/grant/definer source pins.
- `test/provisioning.test.ts:700-722, 1573-1640` -- the RLS table list, privileges and constraint pins, the `ACCESS_CONTROL_FUNCTIONS` and grantee lists.
- `test/concurrent-writes.test.ts:1164, 1205-1215, 1687` -- definer lock CALLS, the decide-against-withdraw race, the exact trigger list.
- `ARCHITECTURE-SPINE.md` -- AD-4 :87, AD-10 :125, erDiagram :305, CAP map :384.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0049_swap_requests.sql` -- tables, keys, checks, policies, grants, the lock trigger, the three definers and the deactivation trigger, with a header listing every refusal -- the whole data layer.
- [x] `test/rls-isolation.test.ts` -- a 12.1 block for every matrix row on both fixtures, including at least one real-token insert and one refusal; register the policies and functions -- proves Q2 and R9.1.
- [x] `test/supabase-scaffold.test.ts`, `test/provisioning.test.ts`, `test/concurrent-writes.test.ts` -- register everything new; add races of decide against withdraw and answer against withdraw -- the schema sweeps fail on anything unregistered.
- [x] `ARCHITECTURE-SPINE.md` -- AD-4 and AD-10 amendments, a CAP-22 row, erDiagram entries -- docs ship with the change.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the 10.2 "Swap-driven shift changes notify nobody yet" entry `RESOLVED in part (shift changes, through 0043's roster trigger)`. Add entries for the swap proposed, answered and decided notifications (owner 12.3/12.4), and for the FR-66 send-time roster refusal (owner 12.2, with the stale check in 12.4).

**Acceptance Criteria:**
- Given CI's fresh stack, when `pnpm test` runs, then every new case passes with nothing skipped. (Locally, the DB cases that need 0049 fail; the shared stack is never reset.)
- Given `grep -rn swap_request apps packages`, when it runs, then there are no hits.

## Design Notes

**Decided at the spec checkpoint (product owner, 2026-11-05), each the recommended default:** (1) the addressee may withdraw an accepted swap (FR-69); (2) the approval writes the overrides in 12.1; (3) `p_reason` comes from the 12.4 screen; (4) deactivation closes open swaps; (5) no new outbox codes; (6) past dates are refused by the insert policy; (7) an admin who is a party may decide the swap. Both Epic AC Deviations are accepted as listed.

**Review finding F1 (product owner, 2026-11-06):** the inactive-party refusal. At insert it is a policy condition through a SECURITY DEFINER helper (the policy cannot read `member_status_versions` itself), so it is a bare 42501 like decision 6 and AD-3 needs no exception; at approval it is the named 55000, placed as 0041's `decide_leave_request` places its own.

**Input from `deferred-work.md` (10.2, "Swap-driven shift changes notify nobody yet"):** answered in part. An approval's overrides notify both members through 0043's roster trigger; the swap proposed, answered and decided events move to 12.3 and 12.4.

The definer takes the approval's reason as `p_reason`, so the 12.4 screen supplies the Croatian words. "Reason swap" is recorded structurally by the decision's override ids, and `roster_overrides` stays untouched.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: green.
- `pnpm test` -- expected: non-DB suites green; the DB suites go to CI.

## Suggested Review Order

**The record and its derived status**

- Entry point: the header defines status as derived and lists every refusal.
  [`0049_swap_requests.sql:44`](../../supabase/migrations/0049_swap_requests.sql#L44)

- The swap row: two shifts, two members, answer and close set only by definers.
  [`0049_swap_requests.sql:178`](../../supabase/migrations/0049_swap_requests.sql#L178)

- One open swap per given shift and per return shift; 0026 backstops the cross case.
  [`0049_swap_requests.sql:282`](../../supabase/migrations/0049_swap_requests.sql#L282)

**Who writes what (AD-10, Q2)**

- Self-owned insert: proposer by `auth.uid()`, dates from today, attribution pinned.
  [`0049_swap_requests.sql:387`](../../supabase/migrations/0049_swap_requests.sql#L387)

- Reads: the admin all, a member only swaps they are party to.
  [`0049_swap_requests.sql:351`](../../supabase/migrations/0049_swap_requests.sql#L351)

- Seven-column insert grant: the second lock against forged answer or close.
  [`0049_swap_requests.sql:450`](../../supabase/migrations/0049_swap_requests.sql#L450)

- Addressee alone answers a proposed swap; a decline closes it.
  [`0049_swap_requests.sql:470`](../../supabase/migrations/0049_swap_requests.sql#L470)

- Proposer withdraws while undecided; addressee once accepted (FR-69).
  [`0049_swap_requests.sql:538`](../../supabase/migrations/0049_swap_requests.sql#L538)

**Decision and approval**

- Approval writes one or two overrides, the decision and the close atomically.
  [`0049_swap_requests.sql:598`](../../supabase/migrations/0049_swap_requests.sql#L598)

- The decision row links the overrides, which is what marks them as a swap.
  [`0049_swap_requests.sql:292`](../../supabase/migrations/0049_swap_requests.sql#L292)

- Deactivation closes open swaps, judged by the earliest date reached, as 0041.
  [`0049_swap_requests.sql:681`](../../supabase/migrations/0049_swap_requests.sql#L681)

**Architecture**

- AD-4: the third *Za odluku* set, and what the screens alone check.
  [`ARCHITECTURE-SPINE.md:88`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L88)

- AD-10: answering and withdrawing by the addressee.
  [`ARCHITECTURE-SPINE.md:127`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L127)

- The CAP-22 row.
  [`ARCHITECTURE-SPINE.md:393`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L393)

**Tests (DB-backed ones run in CI only)**

- Approval: overrides, decision and close attributed to the admin.
  [`rls-isolation.test.ts:23838`](../../test/rls-isolation.test.ts#L23838)

- R9.1: nothing derives before approval; the approval notifies both members.
  [`rls-isolation.test.ts:24014`](../../test/rls-isolation.test.ts#L24014)

- Lock races: decide, answer, withdraw and deactivation.
  [`concurrent-writes.test.ts:1230`](../../test/concurrent-writes.test.ts#L1230)

- Source pins: the policies, the grant, the definers, no refusing trigger.
  [`supabase-scaffold.test.ts:3144`](../../test/supabase-scaffold.test.ts#L3144)

- Catalog: RLS table list, privileges, constraints and triggers.
  [`provisioning.test.ts:702`](../../test/provisioning.test.ts#L702)
