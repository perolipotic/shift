---
title: '13.7: A half day is named as a half wherever leave is shown'
type: 'feature'
created: '2026-11-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'df2f67f969f97832f6d3e9461c4992ce9c8dd0d1'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The client mappers drop a record's or request's `half`, even though every source returns it (0058, 0059). As a result:
- The member's *Danas* draws a half day as a whole day of leave and joins it to the records next to it.
- Admin *Danas*, *Treba tebe*, *Odlučeno*, the deactivation question, the resolution screen, the calendar collision line and *Za odluku* all show the half as a whole-day range.
- The request review shows *0 dana* without saying why (epic 13 retro B4, B5, A5).

**Approach:** Carry `half` through each mapper. Name it after the range with the existing `ljudi.leaveRecord.rangeHalfFirst/Second` keys through `leaveRangeHalfMessageKey`. On the member's *Danas*, a half day becomes the working case with the absent half named. The review explains a 0 cost. Notifications are split to 13.7b (PO, 2026-11-16).

## Boundaries & Constraints

**Always:**
- A half-day record is a one-date absence of its own. In `absenceOn`, it never joins its neighbours and nothing joins across it.
- A half day counts as at work (R10.1). The member's duty legs, next shift, week strip and "Vraćaš se" treat it as a working day (`!isHalfDay`), as `admin-today.ts:682` already does.
- On a half day with a working shift, member *Danas* is the working case.
  - The shift row shows the worked half's times.
  - One added line names the type and the absent half, with the cost when it draws.
  - Times come from `shiftHalvesOf` / `halfDayShiftOf`, never from a second split.
- A stored half with no working shift left stays the leave case, named `{range} (prvi dio smjene)`, with no cost line.
- Every other surface names the half by passing the end of the range (or its one date) through `leaveRangeHalfMessageKey`. No new range keys.
- The review flags a requested half whose date holds no working shift (the domain costs it 0) and shows one reason line under *Trošak*.
- The keys appear only in `hr.json` and are registered in `key-sources.fixture.ts`.
- Whole-day text stays byte-identical.

**Ask First:**
- A calendar half-day mark.
- Any DB or migration change.
- Changing whether a half-day member is listed in *Odsutnost danas*. They stay listed, with the half named.

**Never:**
- Notifications, `notify/messages.ts` or SQL (13.7b).
- Drawing the kept half in the Izmijeni dialog (open deferral).
- Running DB-connecting root tests, applying migrations, or patching `test/database.ts` / `e2e/utils/*`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| Member, half today, one working shift | FIRST half of an 08–20 shift, drawing type | Working case. The row reads 14:00–20:00. The line names the type, *prvi dio smjene* and 0,5 dana. |
| Half between whole days | Whole day yesterday, half today, whole day tomorrow | Today is the working case. Yesterday's range is not joined to tomorrow's. |
| Half, shift gone | Stored SECOND half, no working shift | Leave case, `01.10.2026 (drugi dio smjene)`, no cost line |
| Half tomorrow | A half day tomorrow | `nextShiftOf` and the week strip still show tomorrow's shift |
| Admin absent line | A member with a half today | `{team} · odsutnost 01.10.2026 (prvi dio smjene)` |
| Review, no shift | Requested FIRST half on a date with no working shift | *0 dana* plus the reason line |
| Review, two shifts | Requested half on a two-shift date | 0,5 dana, no reason line |
| Whole day anywhere | half null | Text unchanged |

## Epic AC Deviations

- "**When** a notification is sent for it, including an amend that changes only the half **Then** the text names the half". **DEFERRED** to Story 13.7b. The operands are written by SQL triggers (0043, 0059), so this needs migration 0060, new `obavijesti` copy and the notify boundary pin. It is a separately shippable goal (PO split, 2026-11-16).
- **Widened** (PO, 2026-11-16): the resolution screen, the calendar collision line, *Za odluku* and *Treba tebe* also name the half (deferred-work 13.5 entry).

</frozen-after-approval>

## Code Map

- `apps/web/src/features/today/services/today.ts`
  - `absenceOn` :361-398: the joins at :374-375 ignore `half`, and :393 drops it.
  - `todayCaseOf` :510-531: the `CASE_LEAVE` variant (:123-142) has no `half`.
  - `onLeave` :265, :285/:296, :301-311, `returning` :320, `nextShiftOf` :566 and `weekOf` :587 all use `leaveOn`. Each gets `!isHalfDay`.
  - `dayLookupOf` :416 is deliberately left: the calendar mark is Ask First.
- `today/components/today-card.tsx` :22-46, :94-96: the working row and the new half line.
- `today/services/admin-today.ts`
  - `absencesOf` :807-846 and `AbsentMember` :289-299: add `half`.
  - The keys at :1096-1120.
  - `NeedsYouRequestRow` :157-174 and its mapping :572-584 drop `RequestRow.half`.
  - `adminStatusOf` :975 follows the case.
- Today components: `absent-card.tsx` :19-63 and `needs-you-card.tsx` :74.
- Odlučeno: `conflicts/services/resolved-conflicts.ts` :101-129, :260-305 (`leaveRangeValuesOf` :280), and `components/resolved-list.tsx` :119-121.
- Za odluku: `conflicts/services/conflicts-queue.ts` (`ConflictRow` :88-115, :454-463) and `components/conflicts-list.tsx` :55-58. The request row :73-97 is the pattern to copy.
- Resolution screen: `conflicts/services/resolution-screen.ts` (view :501-505, :851-865) and `components/conflict-resolution-body.tsx` :132-134.
- Calendar collision line: `calendar/services/marks.ts` :102, :114-120 (add `...halfFieldOf`), `calendar/utils/day-detail.ts` :1175-1230, and `day-detail-dialog.tsx` :326-335.
- Deactivation question: `members/services/deactivation-requests.ts` :20-48 builds plain range strings. The half must reach them through a translator argument or through the component. `member-status-card.tsx` :288-296.
- Request review: `leave/services/leave-request-review.ts` `previewOf` :280-345 (READY :322-344), and `components/leave-request-review-body.tsx` :95-97.
- Reuse in `leave/services/leave-section.ts`:
  - `leaveRangeHalfMessageKey` :649, `leaveHalfOptionsOf` :586.
  - The `halfDayShiftOf` RangeError guard :784-789.
  - Domain: `isHalfDay`, `halfFieldOf`, `halfDayShiftOf` and `shiftHalvesOf` (`packages/domain/src/leave.ts`).
- `apps/web/src/pages/key-sources.fixture.ts`: register the new keys and helper uses, and bump the per-file `strings` counts.
- Mappers deliberately left:
  - `leave-list.ts` and `leave-request-list.ts`: they already carry `half`.
  - The offline readers: an old row reads as a whole day (leave-list.ts:146).
- Tests:
  - `today.test.ts` :382-389 pins half = CASE_LEAVE and changes.
  - `admin-today.test.ts`, `resolved-conflicts.test.ts`, `conflicts-queue.test.ts`, `resolution-screen.test.ts`, `day-detail.test.ts`, `deactivation-requests.test.ts` :74 and `leave-request-review.test.ts` :280-291.
- e2e: whole-day assertions are unchanged (`today.spec.ts:441,764`, `conflicts-queue.spec.ts:161,191,488`, `calendar-conflicts.spec.ts:410`, `member-erasures.spec.ts:82,274`). Grep them anyway.

## Tasks & Acceptance

**Execution:**
- [x] `today.ts`, `today-card.tsx`: half-day aware `absenceOn`, a working case with the absent half, and `!isHalfDay` on the leave tests. Add the `danas.today.halfLeave` key.
- [x] `admin-today.ts`, `absent-card.tsx`, `needs-you-card.tsx`: carry `half` and name it.
- [x] `resolved-conflicts.ts`, `resolved-list.tsx`, `conflicts-queue.ts`, `conflicts-list.tsx`, `resolution-screen.ts`, `conflict-resolution-body.tsx`: carry `half` and name it.
- [x] `marks.ts`, `day-detail.ts`, `day-detail-dialog.tsx`: carry `half` and name it.
- [x] `deactivation-requests.ts`, `member-status-card.tsx`: name the half per range.
- [x] `leave-request-review.ts`, `leave-request-review-body.tsx`: the no-shift flag and `godisnji.request.halfNoShift`.
- [x] `hr.json`, `key-sources.fixture.ts`: the new keys and counts.
- [x] The test files above: one test per matrix row and a half case per surface.
- [x] `EXPERIENCE.md` / `DESIGN.md` (and the UX-DR lines they quote): member *Danas* on a half day, and the half named on the admin and decision surfaces.
- [x] `epics.md`: add Story 13.7b, "A notification names the half", with the deferred AC. `sprint-status.yaml`: `13-7b-…: backlog`. `deferred-work.md`: add a 13.7b entry, and mark the 13.5 Danas, 13.5 decision-surfaces and 13.5b 0-dana entries RESOLVED. Mark the 13.5b notifications/surfaces entry RESOLVED in part (notifications open → 13.7b).

**Acceptance Criteria:**
- Given a member with a FIRST half today on a drawing type, when *Danas* renders, then it shows the working case with the second half's times and one line naming the type, *prvi dio smjene* and 0,5 dana.
- Given a half-day record or request, when admin *Danas*, *Treba tebe*, *Odlučeno*, the deactivation question, the resolution screen, the day detail or *Za odluku* names it, then `(prvi/drugi dio smjene)` follows its date.
- Given a requested half whose date has no working shift, when the review shows *0 dana*, then a line says why.

## Design Notes

The half is named on the date and not as a separate operand. Existing keys such as `"{team} · odsutnost {date}"` and `"odsutnost {from}–{to} · {days}"` then need no change: the component passes `to` (or `date`) as `t(rangeHalfFirst, { range: to })` when `half` is set. Services keep returning keys and operands. Proposed copy:
- `danas.today.halfLeave`: "{type}: {half} · troši {days} godišnjeg". `{half}` is the lower-case *prvi/drugi dio smjene*. With no draw, the line ends at the half.
- `godisnji.request.halfNoShift`: "Taj dan više nema radnu smjenu, pa pola dana ne troši ništa."

## Verification

**Commands:**
- `pnpm --filter ./apps/web exec vitest run src/features src/pages` -- expected: all pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- expected: pass.
- `pnpm --filter ./apps/web typecheck && pnpm lint` -- expected: clean.

## Suggested Review Order

**Member Danas on a half day**

- Entry point: which case wins on a half day (duty, carry-over, working, then leave).
  [`today.ts:675`](../../apps/web/src/features/today/services/today.ts#L675)

- The half-day facts: type, half, cost, any working shift, the split shift.
  [`today.ts:614`](../../apps/web/src/features/today/services/today.ts#L614)

- A half day never joins its neighbours; nothing joins across it.
  [`today.ts:456`](../../apps/web/src/features/today/services/today.ts#L456)

- Duty legs, next shift and week strip treat a half day as working.
  [`today.ts:433`](../../apps/web/src/features/today/services/today.ts#L433)

- The one half line, drawn in the duty block and the working case.
  [`today-card.tsx:38`](../../apps/web/src/features/today/components/today-card.tsx#L38)

**Naming the half on admin and decision surfaces**

- One helper names the half after a date or range end; six components use it.
  [`leave-section.ts:672`](../../apps/web/src/features/leave/services/leave-section.ts#L672)

- Admin Danas: a half day is its own absence; Od sutra still checked.
  [`admin-today.ts:818`](../../apps/web/src/features/today/services/admin-today.ts#L818)

- The deactivation question names each closed request's half.
  [`deactivation-requests.ts:53`](../../apps/web/src/features/members/services/deactivation-requests.ts#L53)

- Calendar marks keep the half so the day-detail collision line can name it.
  [`day-detail.ts:1226`](../../apps/web/src/features/calendar/utils/day-detail.ts#L1226)

**Why a half costs 0 days**

- Flag only a drawing type's half on a date with no working shift.
  [`leave-request-review.ts:295`](../../apps/web/src/features/leave/services/leave-request-review.ts#L295)

- The reason line sits directly under Trošak.
  [`leave-request-review-body.tsx:101`](../../apps/web/src/features/leave/components/leave-request-review-body.tsx#L101)

**Tests and docs**

- The half-day matrix, duty, carry-over and two-shift cases.
  [`today.test.ts:436`](../../apps/web/src/features/today/services/today.test.ts#L436)

- Story 13.7b takes the notifications, with its deploy order and no-reason AC.
  [`epics.md`](../planning-artifacts/epics.md)
