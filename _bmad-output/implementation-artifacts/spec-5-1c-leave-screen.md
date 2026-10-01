---
title: 'An admin records a member''s leave on their page and sees what it costs first (5.1c)'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: '37f5d4c09260113a629704bdbc32cf1bf44360bb'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The leave rule (5.1a, `domain/leave`) and the record (5.1b, `leave_records` + `recordLeave`) exist, but an admin cannot record leave anywhere. Story 5.1 asks that the cost be seen before saving, that an overlap refusal name the conflict and keep every entered value, and that an over-balance record save with a warning.

**Approach:** Add a "Godišnji" card to the admin's member page (`ljudi.$id.tsx`). The human placed it there on 2026-10-01.
- It shows allowance, days used this leave year and balance.
- It has an od–do form that shows, once both dates are valid, the cost, the balance after, and any overlap or over-balance note, all from `leavePreviewOf`.
- It saves through `recordLeave`. All decisions are pure functions in `features/leave/services`; the hook only wires them.

## Boundaries & Constraints

**Always:**
- **One computation.** Figures come from `@shift/domain` (`leavePreviewOf`/`leaveBalanceOf`), never recomputed. The member's schedule input is `memberScheduleInputOf(calendarSnapshot, member)` over the calendar snapshot (the `use-hours` precedent).
  - Allowance: the member row's `leaveAllowanceDays`.
  - Leave year start: the organization snapshot.
  - Today: `calendarTodayOf`.
  - Records: a new read of the member's live `leave_records` (`during`, parsed by `leaveRangeOf`) under its own query key.
- **Before saving** (both dates valid, `od <= do`):
  - The cost in days (`count.days` plural) and the balance after.
  - "Overlaps an existing record" when `overlapsRecord` is set.
  - A non-blocking over-balance note when `exceedsBalance` is set.
  - No preview for incomplete, reversed or over-366-day input; a short reason replaces it.
- **On save:**
  - Reversed or over-366 input is refused in the client before any request, and the refused field is focused.
  - `LEAVE_OVERLAP` gives an alert naming the conflict's dates (`formatIsoDate` with an en dash), or a generic overlap line when `conflict` is null. Every entered value stays and the od field takes focus.
  - Success shows a status line with the cost, plus the over-balance warning with its number when the save exceeded the balance (never a lasting banner). Then the form clears.
  - Denied and failed outcomes have their own lines.
- **After any write outcome,** re-read the leave key and the dependents declared in `teams/services/dependents.ts` (`LEAVE_WRITE_DEPENDENTS`, empty today: no other read embeds leave). No optimistic figures; skeletons while loading.
- In-flight guard and focus via `focusLater`. Copy only from `hr.json`, registered in the hygiene and string tests. Neutral styling; `destructive` stays reserved for conflicts. No horizontal scroll at 390 px.

**Ask First:**
- Showing the member's record list, or amend and delete actions (5.2).
- Drawing leave on the calendar or in hours (5.3).
- Any migration or RLS change.

**Never:**
- No member-facing leave view (the Godišnji tab stays as it is).
- No change to `domain/leave` or `leave-write.ts` beyond a read function beside them.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Figures | allowance 20, one record costing 3 this year | 20 / 3 / 17 | skeleton while loading |
| Preview | od–do over Dan, Noć, Slobodno, Slobodno, Dan | "5 dana" range costs 3; balance after 14 | N/A |
| Incomplete or reversed | od only; do < od | no preview; reason shown | save refused in client, field focused |
| Over a year | 367 days | no preview; reason | refused in client |
| Overlap known | range over an existing record | preview notes the overlap | save → alert with that record's dates, values kept |
| Over balance | cost 3, balance 1 | preview note "−2" | save succeeds; status shows the warning with −2 |
| Denied or failed | 42501 / other | alert line | values kept |
| Read fails | records or calendar read fails | figures and preview replaced by an unavailable line | form disabled |

## Epic AC Deviations

None. Together with 5.1a and 5.1b, every 5.1 AC is met: the cost before saving, the schedule untouched, the database-refused overlap that is named here with every value kept, and the over-balance save with a warning.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/ljudi.$id.tsx:31-71` -- the cards are siblings outside the basics form. Add `MemberLeaveCard` after `MemberStatusCard`. Copy the card shell from `members/components/member-status-card.tsx:223-229` and the date inputs from `:131-145` (`Input type="date"`, `Label`, `aria-invalid`/`aria-describedby`).
- `apps/web/src/features/members/hooks/use-member-edit.ts:204-246` -- the member row (`leaveAllowanceDays`, `organizationId`) and the organization snapshot (`leaveYearStartMonth/Day`, `organization/services/snapshot.ts:495-551`). It also shows the in-flight refs and `refreshAfterWrite` (:423-437).
- `apps/web/src/features/hours/hooks/use-hours.ts:38-48` -- reading the calendar snapshot (`calendarQueryOptions`, `calendarSurfaceStateOf`, `calendarTodayOf`).
- `apps/web/src/features/calendar/utils/month.ts:787` -- `memberScheduleInputOf`.
- `packages/domain/src/leave.ts:286, :304` -- `leaveBalanceOf`, `leavePreviewOf` (they throw `RangeError` on bad input, so guard them) and `MAX_LEAVE_RANGE_DAYS`.
- `apps/web/src/features/leave/services/leave-write.ts` -- `recordLeave`, `isCalendarDate`, `leaveRangeOf`, the outcome codes. Add the records read beside it, e.g. `leave-list.ts` with `LEAVE_RECORDS_KEY`.
- `apps/web/src/features/teams/services/dependents.ts:60-97` -- the registry, `refreshAfterWrite`. `dependents.test.ts` sweeps every `*_KEY`.
- `apps/web/src/utils/focus-later.ts`, `components/ui/notice.tsx` (`role` `alert`/`status`).
- `eslint.config.js:111-164` -- list the new leave modules as public, and add calendar/organization consumers to the comments.
- `apps/web/src/lib/i18n/locales/hr.json` -- reuse `count.days` (:24) and `ljudi.leave`. Register new keys in `test/resource-hygiene.test.ts` (`SANCTIONED_SCREEN_KEYS` :116) and update `apps/web/src/pages/prijava.test.ts` (the `MEMBER_EDIT` set, `expectedControls`, `IN_FLIGHT_HANDLERS`, `KEY_SOURCES`).
- e2e: `e2e/pages/people.page.ts` (add leave locators), `e2e/tests/people/`, and `seedTeamRotation`/`holdRotation` (the `hours.spec.ts:46-71` lifecycle). Use a fresh member per test, since `leave_records` persist within a run and the member key does not cascade.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/leave/services/leave-list.ts` (+test) -- the member's live records read and key.
- [x] `apps/web/src/features/leave/services/leave-section.ts` (+test) -- the pure view model: figures, preview state and reasons, outcome → message keys and values. It covers every matrix row.
- [x] `apps/web/src/features/leave/hooks/use-member-leave.ts`, `components/member-leave-card.tsx`, `pages/ljudi.$id.tsx` -- wiring and rendering.
- [x] `teams/services/dependents.ts`, `eslint.config.js`, `hr.json`, the hygiene and string tests -- registrations.
- [x] `e2e/tests/people/leave.spec.ts` + page object -- with a seeded rotation:
  - the preview cost equals the seeded working days;
  - save, and the figures update;
  - an overlapping range is refused, naming the dates, with values kept;
  - an over-balance save shows the warning;
  - 390 px has no horizontal scroll.

**Acceptance Criteria:**
- Given an admin on a member's page, when they enter a valid range, then the cost and balance after appear before any save, and they equal the domain's figures.
- Given an overlapping range, when saved, then the alert names the existing record's dates and both date fields still hold what was typed.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green
- `pnpm exec playwright test e2e/tests/people` -- expected: all pass

## Suggested Review Order

**View model (pure)**

- Entry point: four reads become loading, unavailable, unscheduled or ready figures, never a guess.
  [`leave-section.ts:131`](../../apps/web/src/features/leave/services/leave-section.ts#L131)

- The preview or its reason, straight from the domain.
  [`leave-section.ts:237`](../../apps/web/src/features/leave/services/leave-section.ts#L237)

- The saved line is costed against freshly re-read records, so the warning is real.
  [`leave-section.ts:308`](../../apps/web/src/features/leave/services/leave-section.ts#L308)

**Reads and wiring**

- The member's live records, under their own key.
  [`leave-list.ts:107`](../../apps/web/src/features/leave/services/leave-list.ts#L107)

- Save: in-flight guard, client refusals, recordLeave, re-read, focus.
  [`use-member-leave.ts:168`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L168)

- An edit clears whatever was raised.
  [`use-member-leave.ts:141`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L141)

- The card on the member page.
  [`ljudi.$id.tsx:72`](../../apps/web/src/pages/ljudi.$id.tsx#L72)

**End to end**

- Cost before save, figures after, overlap named with values kept.
  [`leave.spec.ts:119`](../../e2e/tests/people/leave.spec.ts#L119)

- Over-balance warning with its number; no sideways scroll on a phone.
  [`leave.spec.ts:170`](../../e2e/tests/people/leave.spec.ts#L170)

- A failed read disables the form; retry recovers.
  [`leave.spec.ts:204`](../../e2e/tests/people/leave.spec.ts#L204)
