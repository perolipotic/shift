---
title: 'Leave requests start today or later, and an approved request says when its leave changed (retro 8–9 item 17)'
type: 'bugfix'
created: '2026-10-30'
status: 'done'
baseline_commit: 'dcac644cf0d38a27af64b2481168d65140dbf949'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member can request leave for dates already past, with no rule in the form or the database, and an approved request keeps reading *Odobren* with nothing more after an admin amends or removes the leave record it created (retro 8–9 C3, action item 17; deferred-work 9.2 and 9.3 entries).

**Approach:** Product owner decision 2026-10-30. (1) A member requests leave only from the organization's today on: the form sets `min` on both dates and refuses an earlier start with a Croatian reason saying past leave is recorded by an admin, and the database refuses the insert when `lower(during) < organization_today(organization_id)`. Admin-recorded leave is unchanged. (2) An approved request whose leave record was later amended or removed keeps the status *Odobren*, and under it reads `Godišnji je naknadno izmijenjen.` or `Godišnji je naknadno uklonjen.`, derived on read from the linked leave record, with no new request state. This shows on the member's *Godišnji* request list and on *Za odluku → Odlučeno* (UX-DR52).

## Boundaries & Constraints

**Always:**
- Migration `supabase/migrations/0047_leave_request_rules.sql`, forward-only: `create or replace` of `refuse_leave_request_over_leave()` behind its 0040 gates (authenticated role, the caller's own member row), adding the past-start refusal 55000 `LEAVE_REQUEST_IN_PAST` before the inactive and overlap checks.
- The amend/remove note is derived by a read-only SQL computed field on `leave_request_decisions` (`leave_record_change`), `stable`, `security invoker` (RLS applies), returning `amended`, `removed` or null. Status stays as 0040/0041 derive it.
- Croatian copy in `hr.json` only. UX-DR47, UX-DR52 and EXPERIENCE.md are updated in this change. AD-3's named exception gets an `Amended 2026-10-30` clause.
- A cached row without the new field reads as "unchanged" (old offline snapshots stay valid).

**Ask First:** A new request status or a stored column for the change; refusing an admin's approval of a pending request whose start has since passed.

**Never:** Changing admin leave recording, amend or removal; shrinking a request; showing the note on rejected, withdrawn or deactivation-closed requests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start today | `od` = organization's today | Sent as before | N/A |
| Past start | `od` < today (any `do`) | Form shows the past reason on *Od*; *Pošalji* refuses with *Od* focused; nothing sent | DB refuses a direct insert: 55000 `LEAVE_REQUEST_IN_PAST` → `Zahtjev nije poslan: …` alert |
| Admin records past leave | Admin dialog, past range | Unchanged, saved | N/A |
| Approved, record live | Linked record not removed | *Odobren*, no note | N/A |
| Approved, amended | Record replaced by `amend_leave_record` (replacement live) | *Odobren* + `Godišnji je naknadno izmijenjen.` | N/A |
| Approved, removed | Record removed, or amended and the replacement later removed | *Odobren* + `Godišnji je naknadno uklonjen.` | N/A |
| Unknown value | `leave_record_change` not null/amended/removed | Row untrusted → list unavailable, as an unknown outcome | Logged |

## Epic AC Deviations

None. Story 9.3 (UX-DR47) and 9.5 (UX-DR52) ACs stand; this adds a refusal and a note they did not decide.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0041_deactivation_closes_leave_requests.sql:185-242` -- current `refuse_leave_request_over_leave()` to replace (keep the gates, inactive and overlap checks).
- `supabase/migrations/0008_member_status.sql:138` -- `organization_today(uuid)`.
- `supabase/migrations/0029` + `0043:738` -- `amend_leave_record` removes the old row and inserts the replacement in one transaction: replacement `created_at` = old `removed_at` (same `now()`), `created_by` = old `removed_by`, same member. That is the amend's signature on read.
- `apps/web/src/features/leave/services/leave-request-list.ts` -- `LEAVE_REQUESTS_COLUMNS`, `LEAVE_REQUEST_COLUMNS`, `requestRowOf`, `LeaveRequest`: parse `leave_record_change` from the decision embed into `recordChange`.
- `apps/web/src/features/leave/services/leave-request-write.ts:136` -- `leaveRequestSendFailureOf`: add `REQUEST_IN_PAST` by 55000 + message.
- `apps/web/src/features/leave/services/my-leave.ts:293-330` -- `myLeaveRequestPreviewOf` (add the past reason using `leave.input.today`), reason and send message keys; a record-change message key helper.
- `apps/web/src/features/leave/components/leave-request-form.tsx` -- `min` on both inputs. `my-leave-requests.tsx` -- the note under the badge.
- `apps/web/src/features/conflicts/services/resolved-conflicts.ts:219-260` + `components/resolved-list.tsx` -- carry and render the note on a decided request.
- `apps/web/src/lib/i18n/locales/hr.json` -- `godisnji.request.*`.
- Tests: `test/rls-isolation.test.ts:20244` (request helpers), `e2e/tests/leave`, `e2e/tests/conflicts/conflicts-queue.spec.ts`, `e2e/utils/database-helper.ts` `seedLeaveRequest`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0047_leave_request_rules.sql` -- house-style header; replaced trigger function with the past refusal; `leave_record_change(leave_request_decisions)` following the amend chain; grants (execute to `authenticated` only).
- [x] `test/rls-isolation.test.ts` -- past start refused, today accepted, admin past leave still accepted; record change null / amended / removed / amended-then-removed, readable by the member and the admin.
- [x] `leave-request-list.ts`, `leave-request-write.ts`, `my-leave.ts` (+ tests) -- parse, failure kind, reason, message keys.
- [x] `leave-request-form.tsx`, `my-leave-requests.tsx`, `resolved-conflicts.ts` (+ test), `resolved-list.tsx`, `hr.json` -- render.
- [x] `e2e/tests/leave/*` and `e2e/tests/conflicts/*` -- form refuses a past start; the member list and *Odlučeno* show the note after an amend/removal.
- [x] `epics.md` UX-DR47/52, `EXPERIENCE.md` (lines 40, 64, 141), `ARCHITECTURE-SPINE.md` AD-3, `deferred-work.md` (mark 9.2 ×2 and 9.3 entries RESOLVED) -- docs.

**Acceptance Criteria:**
- Given today's org date, when the member opens *Zatraži godišnji odmor*, then both date inputs carry `min` = today.
- Given an approved request, when the admin amends its record, then the member's list and *Odlučeno* still read *Odobren* with `Godišnji je naknadno izmijenjen.`.

## Design Notes

The chain: from the decision's record, follow replacements (same organization and member, `created_at = removed_at`, `created_by = removed_by`). The last row live and the chain longer than one → `amended`; the last row removed → `removed`; the first row live → null. A record amended and then removed reads *uklonjen*, because the leave is gone. A computed field rather than a client-side read of removed records keeps one derivation, under RLS, and needs no new reads in the hooks.

Review notes (2026-10-30): the amend is recognised by its transaction signature, since 0029 stores no link; the chain never revisits a record and resolves a branch deterministically (a live leaf wins, then the lowest id). The *Odlučeno* line is read from the record its stored decision names, one line and never a list of changes, so UX-DR25's "not a history surface" holds (UX-DR25 amended to say so). An amend or removal now refreshes the request reads (`LEAVE_WRITE_DEPENDENTS`). An approved request keeps its original range and cost: the note says the leave changed, as decided. The decision screen does not show the note (out of scope); it reads the same columns as *Odlučeno*.

## Verification

**Commands:**
- `pnpm db:reset && pnpm lint && pnpm typecheck && pnpm build && pnpm test` -- green; then `pnpm db:demo`.
- `pnpm test:e2e e2e/tests/leave e2e/tests/conflicts` -- green (when port 5173 is free).

## Suggested Review Order

**The database refuses a past start**

- Entry point: the first check behind 0040's gates compares the first day with the organization's today.
  [`0047_leave_request_rules.sql:109`](../../supabase/migrations/0047_leave_request_rules.sql#L109)

- AD-3's named exception records the refusals the trigger now makes.
  [`ARCHITECTURE-SPINE.md:78`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L78)

**What became of an approval's leave, derived on read**

- Computed field follows the amend chain under the caller's RLS; null, amended or removed.
  [`0047_leave_request_rules.sql:147`](../../supabase/migrations/0047_leave_request_rules.sql#L147)

- Deterministic leaf choice if a chain ever branches.
  [`0047_leave_request_rules.sql:183`](../../supabase/migrations/0047_leave_request_rules.sql#L183)

- The embed asks for it beside the outcome; one parse for every read.
  [`leave-request-list.ts:54`](../../apps/web/src/features/leave/services/leave-request-list.ts#L54)

- Only approved rows carry it; absent reads unchanged, unknown is untrusted and logged.
  [`leave-request-list.ts:232`](../../apps/web/src/features/leave/services/leave-request-list.ts#L232)

- An amend or removal re-reads the requests too.
  [`dependents.ts:133`](../../apps/web/src/features/teams/services/dependents.ts#L133)

**The form and the two lists**

- The past start is the form's first reason, on Od.
  [`my-leave.ts:325`](../../apps/web/src/features/leave/services/my-leave.ts#L325)

- Both pickers start at the organization's today.
  [`leave-request-form.tsx:164`](../../apps/web/src/features/leave/components/leave-request-form.tsx#L164)

- The database's refusal maps by SQLSTATE and message.
  [`leave-request-write.ts:152`](../../apps/web/src/features/leave/services/leave-request-write.ts#L152)

- The note under Odobren on the member's Godišnji.
  [`my-leave-requests.tsx:88`](../../apps/web/src/features/leave/components/my-leave-requests.tsx#L88)

- The same note on Odlučeno.
  [`resolved-list.tsx:114`](../../apps/web/src/features/conflicts/components/resolved-list.tsx#L114)

**Tests**

- Past start refused for member and admin, today accepted, admin past leave recorded.
  [`rls-isolation.test.ts:21262`](../../test/rls-isolation.test.ts#L21262)

- Real RPCs over PostgREST: live, amended, removed, amended-then-removed, amended twice.
  [`rls-isolation.test.ts:21318`](../../test/rls-isolation.test.ts#L21318)
