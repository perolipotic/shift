---
title: 'Every hours figure that includes a shift in unresolved conflict says so, on screen and in the export (5.3d)'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: '21d1cb8370cb46db2b0664d751e781220f474768'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A shift whose rostered member is on leave still counts in that member's band hours, and nothing on *Sati* or in the `.xlsx` says so. A total can therefore be silently wrong (FR-41, the 4.3 AC, Epic 4 retro R1). *Sati* reads no leave at all today.

**Approach:** *Sati* reads leave the way the calendar does since 5.3c. Collisions are derived through 5.3b's `collisionInputOf` and `collisionsOf`. Each member's figures then carry a count of their shifts in unresolved conflict for the month. The member view, the organization table and the export each show that count distinctly.

## Boundaries & Constraints

**Always:**
- **Counting (human, 2026-10-01).** A shift in conflict still counts in band hours, total and shift count, exactly as today. The count is added beside the figures and changes no figure. `leaveMinutes` stays 0 and the leave figure stays empty, because 5.4's "accept as uncovered" fills it.
- **The count.** The count is the member's collisions whose date falls in the shown month. One collision is one rostered working shift. "Unresolved" means every derived collision until 5.4 adds resolutions.
- **Reads.**
  - **Admin:** the calendar snapshot plus `organizationLeaveRecordsQueryOptions`. This covers both their own *Moji sati* and the organization table.
  - **Member:** their own `my_leave_records` only. A member sees their own count and nobody else's.
  - Role-gated `enabled`, as in `use-calendar-screen.ts`. Leave writes already invalidate both keys.
- **Never hidden.** *Sati* waits for both reads. A failed or paused leave read shows the existing unavailable notice with a retry. Untrusted rows or a `RangeError` show the notice without a retry, as 5.3c's `calendarRefusalOf` does. It never shows figures without the count.
- **Display.**
  - ***Moji sati*:** with a count above 0, a line with `⚠` and a plural, e.g. `2 smjene u neriješenom konfliktu`. With 0, nothing is added.
  - **Organization table:** a new column `Neriješeni konflikti`. A row above 0 shows `⚠` and the number. A zero shows `0`.
  - **Export (human):** the same column in the `.xlsx`, mapped once in `hoursExportOf`. The count is a number cell, and the header names it. The state is carried by the column and the number, not by colour.
- `⚠` is `aria-hidden` and the words carry the meaning. `destructive` styling may mark the count, and only the count. Every string goes through `t()`.

**Ask First:**
- Any change to `packages/domain`, including `hours.ts`, or any migration.

**Never:**
- No move of hours between members, no leave hours, no resolution UI. Those are 5.4's work.
- No sort by the new column. No optimistic figures.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Worked example | leave 10.09–14.09 over `Dan, Noć, Slobodno, Slobodno, Dan`, September shown | count 3; band hours, total and shift count unchanged from no leave | N/A |
| Month boundary | leave 29.09–02.10 over working days in both months | each month counts only its own dates | N/A |
| Two teams | a roster override adds a second shift that date | count 2 for that date | N/A |
| None | no leave, or leave only over non-working days | admin column `0`; *Moji sati* adds nothing; xlsx `0` | N/A |
| Member own | a member with their own collisions | sees their own count; never reads others' | N/A |
| Export | one row with 3 | the `Neriješeni konflikti` cell is 3, and other rows are 0 | N/A |
| Leave read fails | network error | unavailable notice and retry, no figures | retry restores |

## Epic AC Deviations

- **Met here:** "a member with a shift in unresolved conflict in the period … that row carries the same distinct state the table shows" (4.3, FR-41). This closes R1.
- **NARROWED:** "unresolved" means every derived collision until 5.4. The ledger entry "Story 5.4 collisionKeyOf filter" is widened to name the hours surfaces too.

</frozen-after-approval>

## Code Map

- `packages/domain/src/hours.ts` -- `memberHoursOfMonth` (:151), `MemberHours` (:67-80), `leaveMinutes: 0` (:211). Read-only. `collisions.ts` `collisionsOf` (:155): every record's member must be in `members`, and a member's records must not overlap.
- `apps/web/src/features/calendar/services/marks.ts` -- the gating precedent: `calendarMarksOf` (:72), `calendarMarksStateOf` (:112), `calendarRefusalOf` (:146) with `retryable`. For a member it returns `collisions: []`, so hours needs the member's own collisions. Map `leaveRecordsOf` rows to `{ ...r, memberId: viewer.memberId }` before `collisionInputOf`.
- `apps/web/src/features/conflicts/services/conflicts-queue.ts:107` -- `collisionInputOf`.
- `apps/web/src/features/leave/services/leave-list.ts` -- `organizationLeaveRecordsQueryOptions` (:438), `organizationLeaveRecordsOf` (:466), `leaveRecordsOf` (:94), `MY_LEAVE_RECORDS_KEY` (:267).
- `apps/web/src/features/hours/`
  - **`hooks/use-hours.ts`:** a single `CALENDAR_KEY` query today (:39), `useMemo(hoursSurfaceOf)` (:50). The two-read pattern is in `use-calendar-screen.ts:101-125`, and its retry at :200.
  - **`services/my-hours.ts`:** `MyHoursView` (:239-258), `myHoursViewOf` (:270), `myHoursOf` guard (:295), `myHoursSurfaceOf` (:353), and the leave-empty rule (:205-226).
  - **`services/organization-hours.ts`:** `OrganizationHoursRow` (:72-92), `organizationHoursRowsOf` (:169), `organizationHoursViewOf` (:381) with `columnCount`, `organizationHoursOf` (:426), `hoursSurfaceOf` (:458).
  - **`services/hours-export.ts`:** `HoursExportCell` (:24-31), `cellsOf` (:92-109), `hoursExportOf` (:117-143). `services/xlsx.ts`: `columnWidthsOf` (:32) and `cellOf` (:41).
  - **`components/`:** `hours-summary.tsx` (:54-58), `organization-hours-table.tsx` (:107-158), `hours-body.tsx` (:20-25).
- `apps/web/src/lib/i18n/locales/hr.json` -- the `sati.*` keys (:167-197). Add the count plural, the column header and the export header.
- Tests:
  - Unit: `services/my-hours.test.ts`, `organization-hours.test.ts`, `hours-export.test.ts` (column list :239), and `features/hours/hours-screen.fixture.ts` (`HOURS_SCREEN_PARTS`/`EXEMPT`).
  - `pages/prijava.test.ts` (Sati `strings: 27` :2209, `expectedControls` :690).
  - e2e: `e2e/tests/hours/hours.spec.ts` (member :199, admin :280, export :468), `e2e/pages/hours.page.ts`, `e2e/utils/xlsx.ts`. Seed leave with `e2e/utils/database-helper.ts` `seedLeaveRecord`.
- `apps/web/src/features/teams/services/dependents.ts:79-81` -- the comment "Sati starts reading leave in 5.3d". Update it.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/hours/services/` -- a pure per-member, per-month conflict count from the snapshot and leave rows, for both roles. Thread it into `MyHoursView`, `OrganizationHoursRow` and `hoursExportOf`, with the two-read surface state and the retry split -- one derivation for all three surfaces.
- [x] `apps/web/src/features/hours/hooks/use-hours.ts` -- the role-gated leave reads, gating, and a retry over all three keys.
- [x] `apps/web/src/features/hours/components/` and `pages/` as needed -- the *Moji sati* line, the table column, and the retry button.
- [x] `apps/web/src/lib/i18n/locales/hr.json` -- new keys, registered in `test/resource-hygiene.test.ts` and `test/localization-applied.test.ts` where required.
- [ ] Unit tests in `features/hours/services/*.test.ts` -- every matrix row except Leave read fails, plus the figures-unchanged property against the no-leave case.
- [x] `e2e/tests/hours/hours.spec.ts` -- admin: the worked example shows 3 in the table and in the downloaded `.xlsx`, and other rows show 0. Member: sees their own line. Plus a failed leave read with retry.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark R1 (:597) and the 5.3d split entry RESOLVED, and widen the 5.4 filter entry to name the hours surfaces.

**Acceptance Criteria:**
- Given an admin records leave and opens *Sati* in-app, when the figures appear, then the count is there without a reload.
- Given any member and month, when the count is computed, then it equals the number of that member's collisions dated in that month, and every other figure equals the figure computed without leave.

## Spec Change Log

- **2026-10-01, review (patch round, no loopback).**
  - The frozen Reads line says the admin read "covers both their own *Moji sati* and the organization table". An admin has no *Moji sati* view, so an admin's own count appears only in their row of the organization table.
  - Two deviations were decided but not listed under Epic AC Deviations. First, the new column is not sortable (4.2 "sortable"; Never: "No sort by the new column"). Second, the 4.2/4.3 leave-hours AC still waits on 5.4. The second one is ledgered.
  - Retry now shows the skeleton while an errored read refetches, and repeated clicks never cancel an in-flight read. The calendar's same gap is ledgered.
  - KEEP: one conflict count feeding the screen and the export, figures unchanged, and the role-gated reads.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green
- `pnpm exec playwright test hours` -- expected: green

## Suggested Review Order

**The count**

- Entry point: collisions for the viewer's role. An admin sees the whole organization; a member, their own records re-keyed to themselves.
  [`hours-conflicts.ts:65`](../../apps/web/src/features/hours/services/hours-conflicts.ts#L65)

- Grouped once per month, then looked up per row.
  [`hours-conflicts.ts:130`](../../apps/web/src/features/hours/services/hours-conflicts.ts#L130)

- Read states: a refetch after an error shows the skeleton; untrusted rows refuse with no retry.
  [`hours-conflicts.ts:101`](../../apps/web/src/features/hours/services/hours-conflicts.ts#L101)

**The surfaces**

- *Moji sati*: `null` at 0, so no line is drawn.
  [`my-hours.ts:310`](../../apps/web/src/features/hours/services/my-hours.ts#L310)
  [`hours-summary.tsx:38`](../../apps/web/src/features/hours/components/hours-summary.tsx#L38)

- The export: a number cell beside the same row the table draws.
  [`hours-export.ts:109`](../../apps/web/src/features/hours/services/hours-export.ts#L109)

- Role-gated leave reads, and retry only when it can help.
  [`use-hours.ts:74`](../../apps/web/src/features/hours/hooks/use-hours.ts#L74)
  [`sati.tsx:71`](../../apps/web/src/pages/sati.tsx#L71)

**Tests**

- The matrix, figures unchanged against no leave, grouping, and read states.
  [`hours-conflicts.test.ts`](../../apps/web/src/features/hours/services/hours-conflicts.test.ts)

- e2e: the admin's table and `.xlsx`, the member's own line, both retry paths, and a refusal with no retry.
  [`hours.spec.ts:738`](../../e2e/tests/hours/hours.spec.ts#L738)
