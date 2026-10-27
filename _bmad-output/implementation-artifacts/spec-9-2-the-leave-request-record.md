---
title: 'The leave request record'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: '7496675f1dbd63f4c534215e55295219b2525ffa'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only an admin can enter leave. Epic 9 lets a member ask for it, but no table holds a request, no member-role account may write anything, and no decision can turn a request into leave.

**Approach:** Add migration `0040_leave_requests.sql` as the whole data layer of a request:
- `leave_requests`: the member inserts their own request under a self-owned RLS policy.
- `leave_request_decisions`: one approve or reject per request.
- `withdraw_leave_request`: the member withdraws their own pending request.
- `decide_leave_request`: the admin approves (Leave Record, decision and close in one transaction) or rejects.

No UI and no client code. 9.3 and 9.4 build on this layer.

## Boundaries & Constraints

**Always:**
- **The request row.**
  - It copies `leave_records`' shape: tenant first, a composite key to `members`, the same `during` checks, AD-11 `created_by`/`created_at`, and `on delete cascade` from the organization.
  - `closed_by`/`closed_at` are set together or not at all, and only by the two definers.
  - Pending means `closed_at is null`. A decision row on a closed request means approved or rejected. A closed request with no decision means withdrawn.
- **Overlap.**
  - Two pending requests of one member overlap: refused by `exclude using gist (member_id with =, during with &&) where (closed_at is null)`.
  - A request overlaps the member's live leave: refused by a BEFORE INSERT row trigger `refuse_leave_request_over_leave()` with `23P01` and message `LEAVE_REQUEST_OVERLAPS_LEAVE`. Its gates follow 0036's archived-override trigger: it acts only for the `authenticated` role and only when the caller is an active account inserting for its own member row. Any other insert is left to the policy's 42501.
  - `leave_requests` takes 0023's statement lock trigger, so a decision and an insert do not interleave.
- **Insert.**
  - Any active account (member or admin) may insert only for its own member row.
  - The policy matches `member_id` against `members.auth_user_id = auth.uid()` in the claimed organization. The organization comes from the claim and the active status from `current_member_access()`, never from the request.
  - Column grant: insert of `(organization_id, member_id, during)` only.
- **Read.** An active admin reads the organization's requests and decisions. A member-role account reads only its own.
- **`leave_request_decisions`.**
  - The key `request_id` has a composite foreign key to the request, so a request is decided at most once.
  - `outcome in ('approved','rejected')`, and `leave_record_id` is not null exactly when the outcome is approved (composite foreign key to `leave_records`).
  - `decided_by default auth.uid()` and `decided_at default now()`.
  - No session holds an insert, update or delete grant. Only the definer writes it.
- **Definers.** Each copies 0036's `remove_leave_record`: the claim, the organization lock, an empty `search_path`, EXECUTE granted to `authenticated` only, and named refusals:
  - `withdraw_leave_request(uuid)`:
    - an inactive caller → 42501 `LEAVE_REQUEST_WITHDRAWAL_REFUSED`;
    - not the caller's own pending request → P0002 `LEAVE_REQUEST_NOT_PENDING`.
  - `decide_leave_request(uuid, text)` returns the new leave record id, or null:
    - not an active admin → 42501 `LEAVE_REQUEST_DECISION_REFUSED`;
    - not pending in this organization → P0002 `LEAVE_REQUEST_NOT_PENDING`;
    - a bad outcome → 22023;
    - the approval's leave insert refused (23P01) → the whole call aborts and the request stays pending.
- **Docs in the same change** (`ARCHITECTURE-SPINE.md`):
  - AD-3: the overlap trigger as a named, non-computing exception.
  - AD-4 and AD-10: the amendment rows as shipped text.
  - A CAP-19 row in the CAP map.
  - Both tables in the structural seed diagram.

**Ask First:**
- Any change to `leave_records`, its policies or triggers, or to `current_member_access()`.
- Any app, domain or UI code.

**Never:**
- No surface, hook or domain function reads `leave_requests` (R9.1). 9.3–9.5 add those readers.
- Do not refuse an admin's direct leave record because a pending request overlaps it.
- No optimistic or client-side overlap check.
- No notification and no outbox.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Own request | Member inserts for own row | Row pending, `created_by` = caller | N/A |
| Colleague's request | Member inserts with a colleague's `member_id` | Refused | 42501 |
| Forged attribution | Insert names `created_by` or `closed_at` | Refused by the column grant | 42501 |
| Pending overlap | Second pending request shares a date | Refused | 23P01 exclusion |
| Leave overlap | Range shares a date with live leave | Refused | 23P01 `LEAVE_REQUEST_OVERLAPS_LEAVE` |
| Touching / closed | Range touches, or overlaps a withdrawn or decided request | Inserted | N/A |
| Withdraw | Own pending / colleague's / already closed | Closed, by the member / refused / refused | — / P0002 / P0002 |
| Member decides | Member calls decide, or inserts a decision or a leave record | Refused | 42501 |
| Approve | Admin approves a pending request | Leave record and decision both attributed to the admin, request closed | N/A |
| Approve over new leave | Admin recorded overlapping leave after the request | Call aborts, request still pending | 23P01 |
| Reject / twice | Admin rejects; then decides again | Decision, no leave record / refused | — / P0002 |
| Pending derives nothing | A pending request exists | `my_leave_records()` and `leave_overview_records` are unchanged | N/A |
| Cross-tenant | Other organization's request or member | Not visible; the insert is refused | 42501 / 23503 |

## Epic AC Deviations

- Quote: "**Given** a request overlapping the member's existing leave or another pending request of theirs **When** it is inserted **Then** it is refused by schema shape (R9.4, AD-3)".
  - Choice: the overlap with another pending request is schema shape (an exclusion constraint). The overlap with existing leave crosses two tables, so a BEFORE INSERT trigger refuses it, and AD-3 is amended to name that trigger.
  - Reason: an exclusion constraint cannot span two tables. Human decision 2026-10-27 (option A).
- Quote: "the member is read from the AD-10 helper, never from the request (AD-10, Q1–Q3)".
  - Choice: `current_member_access()` gives the organization and the active status. The member row is matched in `members` by `auth_user_id = auth.uid()`, which is the same lookup the helper makes internally. It is never taken from the request.
  - Reason: the helper returns no member id, and changing it is Ask First. Human decision 2026-10-27 (review), so that no helper is added.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0028_leave_records.sql` -- the table shape, checks, policies and grants to copy.
- `supabase/migrations/0036_named_refusals_and_rotation_archives.sql:119-191` -- the archived-override trigger skeleton (gates, revoke, attach). `:411-520` -- the final `remove_leave_record`/`amend_leave_record` with the inline lock.
- `supabase/migrations/0031_conflict_resolutions.sql:195-250` -- `refuse_conflict_resolution_off_leave`, the closest overlap trigger, reading live `leave_records`.
- `supabase/migrations/0023_serialize_organization_writes.sql:142-193` -- the lock function and how a statement trigger is attached.
- `test/database.ts` -- `refused`, `inRolledBackTransaction`, `FIXTURES`.
- `test/rls-isolation.test.ts` -- `actAs` :493, `tokenFor`/`restRefusal` :255-329, the leave tests :17006-17805, `my_leave_records` :18220, the policy list :933-1014.
- `test/supabase-scaffold.test.ts:470-600` -- the exact policy list; the title counts the policies.
- `test/provisioning.test.ts` -- the RLS table list :687-735, `ACCESS_CONTROL_FUNCTIONS` :1707-1778, `grantees` :1806-1911 (definers `['authenticated']`, trigger functions `[]`). Trap at :1485: `leave_records` must keep zero triggers.
- `test/concurrent-writes.test.ts` -- definer `CALLS` :1131, the exact lock-trigger list :1458-1520.
- `_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md` -- AD-3 :71-76, AD-4 :78, AD-10 :114-118, erDiagram :284-302, CAP map :338-359.
- The amendment wording is in `sprint-change-proposal-2026-10-10-v1-scope-expansion.md:306-307`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0040_leave_requests.sql` -- Add both tables, the exclusion, the policies, the grants, the overlap trigger, the lock trigger and both definers. Write a header comment in 0028/0029's style that lists every refusal. -- This is the whole data layer.
- [x] `test/rls-isolation.test.ts` -- Add a 9.2 block covering every matrix row. Include at least one member insert and one refusal through a real token (`rest`/`restRefusal`), and register the new policies. -- Proves Q2 and R9.1/R9.4.
- [x] `test/supabase-scaffold.test.ts`, `test/provisioning.test.ts`, `test/concurrent-writes.test.ts` -- Register the policies, tables, functions, grantees, the definers' lock calls and the lock trigger. Add a lock race: a decision against a withdrawal of the same request. -- The schema sweeps fail on anything left unregistered.
- [x] `ARCHITECTURE-SPINE.md` -- Write the AD-3, AD-4 and AD-10 amendments, the CAP-19 row and the erDiagram entries. -- Docs ship with the change.

**Acceptance Criteria:**
- Given the local stack after `pnpm db:reset`, when `pnpm test` runs, then every new case passes with nothing skipped.
- Given `grep -rn leave_requests apps packages`, when it runs, then there are no hits.

## Design Notes

**Status is derived, never stored twice:** pending is `closed_at is null`, approved or rejected is the decision's outcome, and withdrawn is closed with no decision. Only the definers close a request, so the two tables cannot disagree.

**Known race, accepted:** `leave_records` takes no lock (provisioning keeps it at zero triggers). A request and an admin's leave insert that commit at the same moment can both stand. The approval then aborts on 0028's 23P01, so no date is ever charged twice.

**Decided in review (2026-10-27, human):**
- `leave_records` gains `unique (organization_id, id)`, the key the decision's composite foreign key needs, as 0032 did for `roster_overrides`. Its policies, grants and triggers are unchanged.
- An admin may decide their own request. An admin can already record their own leave directly, so a ban would protect nothing. A test pins this.
- A stale approval, where leave was recorded over the request after it was sent, is refused with 23P01 `LEAVE_REQUEST_APPROVAL_OVERLAPS_LEAVE`. The request stays pending for rejection (R9.4).

## Verification

**Commands:**
- `pnpm db:reset && pnpm test` -- expected: green with no skipped DB cases.
- `pnpm typecheck && pnpm lint` -- expected: green.

## Suggested Review Order

**The request and its pending overlap**

- Entry point: the request copies `leave_records`' shape, and `closed_at` marks it pending.
  [`0040_leave_requests.sql:132`](../../supabase/migrations/0040_leave_requests.sql#L132)

- Two pending requests of one member cannot share a date: the schema-shape part of R9.4.
  [`0040_leave_requests.sql:186`](../../supabase/migrations/0040_leave_requests.sql#L186)

- The header lists every refusal by SQLSTATE and message, for the browser to map.
  [`0040_leave_requests.sql:78`](../../supabase/migrations/0040_leave_requests.sql#L78)

**Self-owned writes (AD-10 amendment)**

- Any active account inserts only for its own member row; the member is matched by `auth.uid()`.
  [`0040_leave_requests.sql:289`](../../supabase/migrations/0040_leave_requests.sql#L289)

- An admin reads the whole organization and a member only their own; inactive accounts read nothing.
  [`0040_leave_requests.sql:255`](../../supabase/migrations/0040_leave_requests.sql#L255)

- The three-column insert grant is the second lock against forged attribution or close.
  [`0040_leave_requests.sql:350`](../../supabase/migrations/0040_leave_requests.sql#L350)

**Overlap with live leave (AD-3 named exception)**

- A cross-table overlap needs a trigger; it refuses with 23P01 and computes nothing.
  [`0040_leave_requests.sql:369`](../../supabase/migrations/0040_leave_requests.sql#L369)

- The statement lock makes an insert wait for an approval in flight and then see its leave.
  [`0040_leave_requests.sql:362`](../../supabase/migrations/0040_leave_requests.sql#L362)

**Decisions**

- One decision per request, at most one per leave record; attribution comes from defaults.
  [`0040_leave_requests.sql:209`](../../supabase/migrations/0040_leave_requests.sql#L209)

- Approval writes the leave, the decision and the close in one call; a stale approval keeps the request pending.
  [`0040_leave_requests.sql:492`](../../supabase/migrations/0040_leave_requests.sql#L492)

- The named stale-approval refusal (R9.4).
  [`0040_leave_requests.sql:555`](../../supabase/migrations/0040_leave_requests.sql#L555)

- Withdrawal closes only the caller's own pending request; anything else is P0002.
  [`0040_leave_requests.sql:434`](../../supabase/migrations/0040_leave_requests.sql#L434)

- The only change to `leave_records`: the key the decision's composite foreign key needs.
  [`0040_leave_requests.sql:207`](../../supabase/migrations/0040_leave_requests.sql#L207)

**Architecture**

- AD-3 now names the overlap trigger beside Q6.
  [`ARCHITECTURE-SPINE.md:77`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L77)

- AD-4: *Za odluku* is a union; an approval erases nothing, so AD-5 does not apply.
  [`ARCHITECTURE-SPINE.md:84`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L84)

- AD-10: the first member-role domain writes.
  [`ARCHITECTURE-SPINE.md:121`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L121)

**Tests**

- Every matrix row, both fixtures, cross-tenant, inactive reads and real-token PostgREST.
  [`rls-isolation.test.ts:20302`](../../test/rls-isolation.test.ts#L20302)

- The lock races: a decision against a withdrawal, and an insert against an approval.
  [`concurrent-writes.test.ts:1213`](../../test/concurrent-writes.test.ts#L1213)

- Catalog: privileges, keys, the exclusion and the exact triggers.
  [`provisioning.test.ts:1497`](../../test/provisioning.test.ts#L1497)

- Source: the forty-seven policies, and 0040 leaves `leave_records`' policies and grants alone.
  [`supabase-scaffold.test.ts:2964`](../../test/supabase-scaffold.test.ts#L2964)
