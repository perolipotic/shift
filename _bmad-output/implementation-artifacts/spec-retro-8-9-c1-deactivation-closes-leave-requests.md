---
title: 'Deactivation closes a member''s pending leave requests (retro 8–9, C1 + C4)'
type: 'bugfix'
created: '2026-10-28'
status: 'done'
baseline_commit: '686daa40310684e5846803db06a634f9ba996a6f'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A deactivated member's pending leave request stays in Za odluku, its review prices it as if they were active, *Odobri* writes leave for an inactive member, and the member can no longer withdraw it (retro C1). The deactivation erasure dialog says it removes "N stavki koje čekaju odluku" but counts only collisions, not requests (C4).

**Approach:** Human decision 2026-10-28: deactivation CLOSES the member's pending requests that reach the deactivation date or later. The database does it, in the same statement as the status version, and records the close as its own outcome, `deactivated`. The approval and a new request both refuse any date on which the member is inactive. The deactivation question names the requests it will close. The erasure copy names collisions as collisions.

## Boundaries & Constraints

**Always:**
- Migration `supabase/migrations/0041_deactivation_closes_leave_requests.sql`. It is forward-only: 0040 and 0008 are not edited, and functions are replaced with `create or replace`.
- The close happens wherever a deactivation is written, so it is a trigger on `member_status_versions` insert with `active = false`. It is SECURITY DEFINER with an empty `search_path`, as 0040's trigger is.
- A closed-by-deactivation request carries `closed_by` = the deactivating admin, `closed_at = now()`, and a `leave_request_decisions` row with outcome `deactivated`, `decided_by` the admin and no leave record. Status stays derived, never stored twice.
- The migration backfills existing data: every pending request with an inactive date in its range is closed the same way, attributed to the status version's `created_by`.
- Named refusals, mapped by message in the browser:
  - `LEAVE_REQUEST_MEMBER_INACTIVE` (55000) on an insert that reaches an inactive date, scheduled deactivation included;
  - the same message from `decide_leave_request` on an *approval* that does. A rejection stays allowed.
- Croatian copy is added to `hr.json` only, as before.

**Ask First:** Any change to the shared `ErasureDialog` or `ErasureRow` shape. Undoing closes when a scheduled deactivation is cancelled.

**Never:**
- Reopening closed requests on cancel or on reactivation. Cancelling leaves them closed, and the member asks again.
- Partially shrinking a request.
- The C3 decisions (below), notifications (Epic 10), or the `leave-requests.ts` split (action 5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Deactivate today | Pending requests A (future), B (past, ended before D) | A closed as `deactivated`. B stays pending and approvable. | N/A |
| Straddling | Request 1.–10. 11., deactivation from 5. 11. | The whole request is closed. Nothing is shrunk. | N/A |
| Scheduled | Deactivation from D+30, request D+40 → D+45 | Closed now, at scheduling. A new request reaching D+30 or later is refused. | `LEAVE_REQUEST_MEMBER_INACTIVE` → form says the member is inactive in that range |
| Approve inactive | A pending request with an inactive date (e.g. a race) | Approval refused. Rejection allowed. | Review shows "member not active on those dates, only rejection possible" |
| Reactivation | `active = true` version | Nothing is closed. | N/A |
| Reads | Request with a `deactivated` decision | Status `closedOnDeactivation`: "Zatvoren deaktivacijom". It sits in Odlučeno, never in the pending count. | An unknown outcome stays untrusted, as today |

**C3 decisions (recorded for a follow-up, not built here):** (a) a member may not request leave starting before the organization's today, refused by both the form and the DB; (b) an approved request whose leave record was later removed or amended still reads *Odobren*, plus a note that the record was later removed or amended.

## Epic AC Deviations

C4 asked to fix the *erasure dialog* wording. The requests are named in the deactivation question (status card), which is always shown, and not as rows in the shared erasure dialog. The erasure dialog only opens when collisions are erased, and its rows are conflict-shaped (Ask First). Its `ljudi.erasures.*` copy now says "odsutnost u smjeni" instead of "stavka".

</frozen-after-approval>

## Code Map

- `supabase/migrations/0040_leave_requests.sql:234` -- `outcome_known` check (approved/rejected). 0041 drops it and re-adds it with `deactivated`. `:237` (leave record iff approved) still holds.
- `0040:369-430` -- `refuse_leave_request_over_leave()`. 0041 replaces it, adding the inactive-date refusal behind the same gates.
- `0040:492-565` -- `decide_leave_request`. Replaced: on an approval, refuse when any date in `during` has `member_active_on = false`.
- `0008:169-210` -- `member_active_on`, `member_active_from`: the readers to reuse. `0008:437-528` -- the insert and cancel policies, untouched. `0023:183` takes the org lock on `member_status_versions`.
- `apps/web/src/features/leave/services/leave-requests.ts:88-168` -- status constants and `leaveRequestStatusOf`. Add `REQUEST_CLOSED_ON_DEACTIVATION`. `:551-640` -- the failure kinds and mappers: add `REQUEST_MEMBER_INACTIVE` to the send and decide mappers (by message). `ORGANIZATION_LEAVE_REQUESTS_KEY` `:444`.
- `features/leave/services/my-leave.ts`, `leave-request-review.ts` -- the status switches. `conflicts/services/conflicts-queue.ts:222-236` -- pending only, unchanged.
- `features/members/hooks/use-member-status.ts:141-169,284-323` -- the consequence held per opening, and `writeStatus`'s refresh. `features/members/components/member-status-card.tsx:262-279` -- the `<output>` line. `features/teams/services/dependents.ts:77-84` -- `MEMBERSHIP_WRITE_DEPENDENTS`: add the requests keys.
- `apps/web/src/lib/i18n/locales/hr.json` -- `godisnji.request.status` ~502, `godisnji.request.*` refusals ~490, `ljudi.status` ~855, `ljudi.erasures` ~877.
- Tests: `test/rls-isolation.test.ts:20302` (9.2 describe), `test/concurrent-writes.test.ts:1200`, `e2e/tests/people/member-erasures.spec.ts`, `e2e/utils/database-helper.ts:567` `seedLeaveRequest`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0041_deactivation_closes_leave_requests.sql` -- header in the house style; outcome check; AFTER INSERT row trigger on `member_status_versions` (inactive only) that closes and records `deactivated` for requests with `upper(during) > effective_from`; the replaced insert trigger and `decide_leave_request`; backfill; grants as 0040 -- the server owns the rule.
- [x] `test/rls-isolation.test.ts` -- a new describe covering every matrix row, backfill included; `test/concurrent-writes.test.ts` -- a deactivation and an approval of the same member serialize -- proves it at the DB.
- [x] `apps/web/src/features/leave/services/leave-requests.ts` (+ `.test.ts`) -- the new status and failure kinds -- reads and refusals.
- [x] `my-leave.ts`, `leave-request-review.ts`, the request form/review hooks, `hr.json` -- show "Zatvoren deaktivacijom", the inactive refusals, and `ljudi.erasures` reworded to "odsutnost u smjeni".
- [x] `use-member-status.ts`, `member-status-card.tsx`, `dependents.ts` (+ tests) -- the deactivation question lists the member's pending requests reaching D or later ("Zatvaraju se 2 zahtjeva za godišnji koji čekaju odluku: 08.11.2026–12.11.2026 i …"), read from `organizationLeaveRequestsQueryOptions`; an unread list hides the line and never gates; refresh the requests after the write.
- [x] `e2e/tests/people/member-erasures.spec.ts` -- deactivating a member with a pending request names it in the question, and Za odluku no longer counts it.

**Acceptance Criteria:**
- Given a member with a pending request, when an admin deactivates them from a date on or before the request's end, then Za odluku's count drops by it and the member's list (if they can still sign in) reads "Zatvoren deaktivacijom".
- Given the deactivation dialog, when the member has no such request, then no request line shows.

## Design Notes

Why a decision row and not "closed without decision": that already means *withdrawn*. A scheduled-deactivation member who still signs in would see "Povučen" for something they never withdrew. A trigger, not an RPC, because deactivation is a plain RLS insert from the browser, and an RPC would leave the insert path open.

## Verification

**Commands:**
- `pnpm db:reset && pnpm test` -- the DB and unit suites are green (the stack is shared with other sessions: check before resetting).
- `pnpm typecheck && pnpm lint` -- clean.
- `pnpm test:e2e e2e/tests/people/member-erasures.spec.ts e2e/tests/leave e2e/tests/conflicts/conflicts-queue.spec.ts` -- green.

## Suggested Review Order

**The database closes and refuses**

- Entry point: the trigger closes pending requests reaching the deactivation date, with a `deactivated` decision.
  [`0041_deactivation_closes_leave_requests.sql:127`](../../supabase/migrations/0041_deactivation_closes_leave_requests.sql#L127)

- Inactive-date reading shared by the insert refusal and the approval.
  [`0041_deactivation_closes_leave_requests.sql:101`](../../supabase/migrations/0041_deactivation_closes_leave_requests.sql#L101)

- A new request reaching an inactive date is refused with `LEAVE_REQUEST_MEMBER_INACTIVE`.
  [`0041_deactivation_closes_leave_requests.sql:185`](../../supabase/migrations/0041_deactivation_closes_leave_requests.sql#L185)

- Approval onto an inactive date refused; rejection still allowed.
  [`0041_deactivation_closes_leave_requests.sql:251`](../../supabase/migrations/0041_deactivation_closes_leave_requests.sql#L251)

- Backfill closes stranded requests, attributed to the governing inactive version.
  [`0041_deactivation_closes_leave_requests.sql:347`](../../supabase/migrations/0041_deactivation_closes_leave_requests.sql#L347)

**The browser reads the new status and refusals**

- The `deactivated` outcome becomes its own derived status.
  [`leave-requests.ts:183`](../../apps/web/src/features/leave/services/leave-requests.ts#L183)

- Send and decide failures map the 55000 by message.
  [`leave-requests.ts:701`](../../apps/web/src/features/leave/services/leave-requests.ts#L701)

- Odlučeno labels each outcome through an exhaustive switch.
  [`resolved-list.tsx:75`](../../apps/web/src/features/conflicts/components/resolved-list.tsx#L75)

- Review refreshes the member's status after an inactive refusal.
  [`leave-request-review.ts:408`](../../apps/web/src/features/leave/services/leave-request-review.ts#L408)

**The deactivation question names what closes**

- Which pending requests a deactivation from the entered day closes.
  [`deactivation-requests.ts:21`](../../apps/web/src/features/members/services/deactivation-requests.ts#L21)

- Read only for a deactivation, held only from a fetch finished after opening.
  [`use-member-status.ts:186`](../../apps/web/src/features/members/hooks/use-member-status.ts#L186)

- The plural line, hidden when empty or unknown, never gating the save.
  [`member-status-card.tsx:289`](../../apps/web/src/features/members/components/member-status-card.tsx#L289)

- A status write now refreshes the request reads.
  [`dependents.ts:87`](../../apps/web/src/features/teams/services/dependents.ts#L87)

**Tests**

- Every matrix row plus backfill and owner-path reactivation, against the DB.
  [`rls-isolation.test.ts:21006`](../../test/rls-isolation.test.ts#L21006)

- Deactivation and approval serialize in both orders.
  [`concurrent-writes.test.ts:1329`](../../test/concurrent-writes.test.ts#L1329)

- The question names the request; Za odluku drops it; Odlučeno labels it.
  [`member-erasures.spec.ts:274`](../../e2e/tests/people/member-erasures.spec.ts#L274)
