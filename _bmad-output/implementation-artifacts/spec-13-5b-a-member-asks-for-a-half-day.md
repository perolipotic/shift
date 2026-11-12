---
title: 'Story 13.5b: A member asks for a half day'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_commit: '33475c80bda3a965cc5ee19e170a648bb1aac45c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-13-5-a-half-day-record-costs-half-a-day.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 13.5 only an admin can record a half day. A member who wants half a shift off must request a whole day, which costs 1 and shows the wrong absence until an admin fixes it (R9.2).

**Approach:** `leave_requests` gains `half`, with the same shape as `leave_records.half`. The member's request form offers *Pola dana* the way the admin dialog does, and the preview costs it through 13.5's domain rule. The review and *Za odluku* name the half, and `decide_leave_request` carries it to the record.

Baseline is 33475c80 (13.5 merged). This story touches hot files (`hr.json`), so no other hot-file story runs in parallel.

## Boundaries & Constraints

**Always:**
- **Schema (0059):**
  - The column and checks mirror 0058: `half in ('FIRST','SECOND')`, and `half` is null or the range is one date.
  - `grant insert (half)`.
  - `decide_leave_request` is replaced in place (same signature) and copies `half` into the record.
  - The overlap rules are unchanged, so a half request on a date that already has any record is still refused.
- **Form:**
  - The order is range, type, half day, then cost and balance after, with one *Pošalji*.
  - The half-day controls are the admin dialog's 13.5 helpers (`leaveHalfOfferedOf`, `leaveHalfOptionsOf`, `leavePreviewStateOf(…, halfChoice)`), with their own element IDs:
    - the switch shows only while Od = Do;
    - two cards show with times, neither preselected;
    - a switch with no card chosen cannot be sent;
    - a multi-date range clears the half.
  - The refusal is addressed to the member: *Taj dan nemaš točno jednu radnu smjenu.*
  - The cost reads *0,5 dana*.
- **Review:**
  - It shows the half next to the range, and its cost and conflict preview use the half.
  - It never refuses a decision because of the half. If the date no longer has one working shift, the cost follows the domain (0 days, as 13.5's Design Note says).
- **Lists:**
  - The *Za odluku* row, the review and the member's own request list show *(prvi dio smjene)* / *(drugi dio smjene)* after the range.
  - The member's list costs the request with `leaveRangeCostOf` (half-aware).
- **Parsing:**
  - Rows parse `half` tolerantly with `leaveRecordHalfOf`, so an old cache without `half` reads as a whole day.

**Ask First:** any notification text change; showing the half on admin *Danas*, *Odlučeno* or the deactivation list.

**Never:** a partial Roster Override; two halves on one date; a second cost implementation; applying anything to the local DB or running DB-connecting root tests (strict DB rule); committing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Send half | one date, one working shift, FIRST | row `half='FIRST'`; preview 0,5 dana; pending charges nothing |
| Approve | pending FIRST request | one record, `half='FIRST'`, attributed to the admin; balance −0.5 |
| Reject | pending half request | no record |
| Switch on, no card | Od = Do | *Pošalji* refused (`LEAVE_HALF_UNCHOSEN`), switch carries the message |
| No / two working shifts | half chosen | refused with the member's wording |
| Range widened | half chosen, then Do > Od | half cleared, switch hidden |
| Forced multi-date half | direct insert | DB check refuses it (23514 → `REQUEST_FAILED`) |
| Shift gone before review | approved anyway | record kept with its half, costs 0 |
| Old cache | request row without `half` | whole day |

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0040_leave_requests.sql:133-197,302` -- table, checks, insert grant; new **0059_half_day_requests.sql** mirrors `0058_half_day_leave.sql:41-50`
- `0054_absence_type_writes.sql:68-168` -- latest `decide_leave_request`: `RETURNING … absence_type_id` :113, record insert :134 copies columns by name (add `half` to both), overlap → `LEAVE_REQUEST_APPROVAL_OVERLAPS_LEAVE` :141
- Domain (read-only reuse): `leave.ts` `halfDayShiftOf` :422, `checkHalfDay` :442, `leaveRangeCostOf` :408, `leavePreviewOf` :865
- `leave/services/leave-section.ts` -- `LeaveHalfChoice`/`LEAVE_WHOLE_DAY` :521, `leaveHalfOfferedOf` :535, `leaveSentHalfOf` :543, `leaveHalfOptionsOf` :564 (needs the snapshot), `leaveCostHalfMessageKey` :609, `leavePreviewStateOf` :701 (half :717-735); `leaveHalfSwitchDescribedByOf` :513 hardcodes admin IDs, so parameterize it
- Form: `leave/components/leave-request-form.tsx` (types :206-227, preview :117-158, half block goes between :227 and :228); `hooks/use-leave-request-form.ts` (state :103, preview :116, send :176); `services/my-leave.ts` (`myLeaveRequestPreviewOf` :359 takes a half, IDs :300-312, reason keys :376-411 replace the "13.5b" comment :398, list cost :599-603); `hooks/use-my-leave.ts:119` returns the snapshot; admin pattern `member-leave-dialog.tsx:240-292`, `use-member-leave.ts:260,342,628,634`
- `services/leave-request-write.ts:219-259` -- payload :236, add `...(half === null ? {} : { half })` as in `leave-write.ts:311`
- `services/leave-request-list.ts` -- both column constants :56/:76, `LeaveRequest` :147, `requestRowOf` :275, field-by-field rebuild :322-324; parse with `leave-list.ts:143` `leaveRecordHalfOf`
- `services/leave-request-review.ts` -- `ReviewFacts` :134, `previewOf` :270-314 (pass the half at :289); `components/leave-request-review-body.tsx` range :65, cost :94
- `conflicts/services/conflicts-queue.ts` `RequestRow` :118, `requestRowsOf` :280; `conflicts/components/conflicts-list.tsx:90`; `components/my-leave-requests.tsx:75`
- `hr.json` -- reuse `ljudi.leaveRecord.half*` :1111-1120 for cards, times and suffix; new `godisnji.request.halfRefused`; `godisnji.request` :585
- Tests: `leave-request-{write,list,review}.test.ts`, `my-leave.test.ts`, `leave-section.test.ts:1493`, `conflicts-queue.test.ts`, `persistence.test.ts`; `test/provisioning.test.ts` request privileges :1851-1869 + constraints :1885, and the `leave_records` pin :1573-1599 still lacks `half` (13.5 gap); `test/rls-isolation.test.ts` models 13.2b :25996 and 13.5 :26131
- E2E: `e2e/pages/leave.page.ts:169-233` (+ half getters as `people.page.ts:793-805`); `e2e/tests/leave/leave-request.spec.ts`, `leave-decision.spec.ts:119`; `e2e/utils/database-helper.ts` `seedLeaveRequest` :778/:804/~815 copies columns explicitly
- Docs: `ux-designs/ux-shift-2026-09-02/EXPERIENCE.md:40,64,69`; `DESIGN.md:347` (the Switch row says one use)

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0059_half_day_requests.sql` -- column, two named checks, grant, `decide_leave_request` carrying `half` -- schema owns the shape
- [x] `test/provisioning.test.ts`, `test/rls-isolation.test.ts` -- request privileges/constraints include `half`; `leave_records` pin gains `half`; block: a member sends a half, approval writes it, multi-date half refused (CI only)
- [x] `leave-section.ts`, `my-leave.ts`, `use-my-leave.ts`, `use-leave-request-form.ts`, `leave-request-form.tsx`, `leave-request-write.ts` (+tests) -- half block, refusal, preview, payload
- [x] `leave-request-list.ts`, `leave-request-review.ts`, `leave-request-review-body.tsx`, `conflicts-queue.ts`, `conflicts-list.tsx`, `my-leave-requests.tsx` (+tests) -- carry, cost and show the half
- [x] `hr.json` -- member refusal; any new label keys
- [x] `e2e/pages/leave.page.ts`, `leave-request.spec.ts`, `leave-decision.spec.ts`, `database-helper.ts` -- send a half (0,5 dana), approve it, the record reads *0,5 dana (prvi dio smjene)*; grep e2e for asserted form text
- [x] `EXPERIENCE.md`, `DESIGN.md`, `deferred-work.md` (mark the 13.5b entry `RESOLVED by 13.5b`), `epic-13-context.md` as-built bullet, `sprint-status.yaml`

**Acceptance Criteria:**
- Given no half requests, when any request surface renders, then every figure and existing assertion is unchanged.
- Given an approved half request, when *Godišnji*, the member card, Sati and the overview render, then they match an admin-recorded half day of the same half.

## Design Notes

The review does not re-run the form's refusal. The form checks the member's schedule when the request is sent. The admin decides later against a schedule that may have changed. Refusing the decision there would strand the request, so it costs whatever the domain says, as a record does.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && … pnpm typecheck` -- pass
- `… pnpm --filter @shift/domain test`, `… pnpm --filter ./apps/web exec vitest run` -- pass
- DB tests for 0059 and e2e run in CI only. The migration is not applied locally (strict DB rule), so a local DB failure caused by it is expected.

## Suggested Review Order

**Approval carries the half (schema)**

- Entry point: decide reads the request's half and writes it onto the record.
  [`0059_half_day_requests.sql:98`](../../supabase/migrations/0059_half_day_requests.sql#L98)

- Record insert names `half` beside the type; overlap handling is 0054's.
  [`0059_half_day_requests.sql:120`](../../supabase/migrations/0059_half_day_requests.sql#L120)

- Column and named shape checks mirror 0058's on `leave_records`.
  [`0059_half_day_requests.sql:36`](../../supabase/migrations/0059_half_day_requests.sql#L36)

**The member's form**

- Preview goes through the admin dialog's pipeline with the half choice.
  [`my-leave.ts:375`](../../apps/web/src/features/leave/services/my-leave.ts#L375)

- Cards that cannot be drawn become a refusal, never "choose a half".
  [`my-leave.ts:404`](../../apps/web/src/features/leave/services/my-leave.ts#L404)

- Turns that failure into `LEAVE_HALF_REFUSED` on the half field.
  [`my-leave.ts:429`](../../apps/web/src/features/leave/services/my-leave.ts#L429)

- Both half reasons spoken in the member's own words.
  [`my-leave.ts:439`](../../apps/web/src/features/leave/services/my-leave.ts#L439)

- Switch and cards between the type and the cost.
  [`leave-request-form.tsx:132`](../../apps/web/src/features/leave/components/leave-request-form.tsx#L132)

- A multi-date half is refused before any request.
  [`leave-request-write.ts:239`](../../apps/web/src/features/leave/services/leave-request-write.ts#L239)

**Review and lists**

- The review previews the stored half and never refuses it.
  [`leave-request-review.ts:310`](../../apps/web/src/features/leave/services/leave-request-review.ts#L310)

- `refuseHalf`: the one switch separating review from form.
  [`leave-section.ts:723`](../../apps/web/src/features/leave/services/leave-section.ts#L723)

- One key helper for "{range} (prvi/drugi dio smjene)".
  [`leave-section.ts:631`](../../apps/web/src/features/leave/services/leave-section.ts#L631)

- Rows parse `half` tolerantly; old caches read as a whole day.
  [`leave-request-list.ts:296`](../../apps/web/src/features/leave/services/leave-request-list.ts#L296)

- *Za odluku* row names the half.
  [`conflicts-list.tsx:77`](../../apps/web/src/features/conflicts/components/conflicts-list.tsx#L77)

- Decision screen range names the half.
  [`leave-request-review-body.tsx:56`](../../apps/web/src/features/leave/components/leave-request-review-body.tsx#L56)

- Member's own list costs half-aware and names the half.
  [`my-leave.ts:674`](../../apps/web/src/features/leave/services/my-leave.ts#L674)
  [`my-leave-requests.tsx:69`](../../apps/web/src/features/leave/components/my-leave-requests.tsx#L69)

**Peripherals**

- Review never refusing a gone shift: costs 0.
  [`leave-request-review.test.ts:280`](../../apps/web/src/features/leave/services/leave-request-review.test.ts#L280)

- DB block: send, approve, reject, shape refusals, two pending halves (CI only).
  [`rls-isolation.test.ts:26247`](../../test/rls-isolation.test.ts#L26247)

- E2E: send with refusals and focus; approve and read the record.
  [`leave-request.spec.ts:236`](../../e2e/tests/leave/leave-request.spec.ts#L236)
  [`leave-decision.spec.ts:211`](../../e2e/tests/leave/leave-decision.spec.ts#L211)
