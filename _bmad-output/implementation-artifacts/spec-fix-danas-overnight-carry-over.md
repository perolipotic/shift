---
title: 'Danas: a shift from yesterday still running is today''s working case'
type: 'bugfix'
created: '2026-10-10'
status: 'done'
baseline_commit: '46ec52569f3f06d8600d00cd8fec231c5ef0aabf'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After midnight, Danas reads only shifts dated today. A member still on last night's lone Noć reads "Danas ne radiš". If their leave starts today, they read the leave case and its cost, with no duty (retro C1/R2, `epic-5-6-7-retro-2026-10-09.md` item 2, decided 2026-10-09: fix).

**Approach:** A working shift dated yesterday that is running now, at the organization's wall clock, makes today the working case. It beats both the free case and the leave case. The working case lists it, marked `od jučer`, before today's own working shifts. A running duty keeps its duty-block, exactly as today.

## Boundaries & Constraints

**Always:** Leg times and running state come from the same recipe the duty uses (`shiftLegOn`, half-open `[start, start+duration)`). If own leave covers yesterday, that date has no leg. On a leave day, only the carried-over shift is listed; today's shifts stay hidden by the leave. When the carried-over shift ends, the screen falls back to the free or leave case as it is now. Codes and data only in `.ts`. The component translates.

**Ask First:** Any change to admin coverage (`admin-today.ts` `coverageOf`) or to the next-shift and week derivations.

**Never:** Showing a running yesterday's shift in admin coverage. `spec-6-3` keeps it out on purpose, and this spec does not change that. No change to Kalendar, to the domain's `dutiesOf`, or to how a joined duty is chosen. No new reads.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lone Noć, free today | Noć 01.10 19:00–07:00, nothing 02.10, now 02.10 03:00 | working: `[Noć 19:00–07:00, fromYesterday]` | N/A |
| Same, ended | now 02.10 07:00 | free, as before | N/A |
| Leave from today | Noć 05.10, leave 06.10–08.10, now 06.10 03:00 | working: the Noć only; `returning` false; next shift = first after leave | N/A |
| Same, ended | now 06.10 07:30 | leave case with range and cost, as before | N/A |
| Yesterday on leave | leave covers 01.10, now 02.10 03:00 | no carry-over; today's case as before | N/A |
| Noć, then Noć tonight | Noć 01.10 and Noć 02.10 (gap 07:00–19:00), now 02.10 03:00 | working: `[Noć fromYesterday, Noć]` | N/A |
| Joined duty | Dan + Noć touching, running | duty-block, unchanged | N/A |
| Carry-over beats upcoming duty | lone Noć running, today's duty starts 08:00 | working: carried Noć plus today's working shifts | N/A |

## Epic AC Deviations

- **6.1 "Danas states each case in words: … on leave today"**: REINTERPRETED. On the first day of leave, while a shift or duty dated yesterday is still running, Danas shows that shift or duty and not the leave case. The leave case comes back when the shift or duty ends. Decided at the 2026-10-09 retro (C1/R2, item 2).
- **6.2 "consecutive working shifts … presented as one duty"**: REINTERPRETED. While a carry-over runs, today's upcoming duty is listed as separate working-case rows after the carried shift. It becomes the duty-block once the carry-over ends. This follows the running > upcoming > done rule (2026-10-06).

</frozen-after-approval>

## Code Map

- `apps/web/src/features/today/services/today.ts:204-234` -- `todayViewOf`. Line 212 ("Leave wins") skips `todayDutyOf` on a leave day. Lines 222-225 choose the case.
- `today.ts:392` `todayCaseOf` -- leave, then working, then free. Only today's `CalendarDay` is read.
- `today.ts:76` `TodayShift` -- the shape a working-case row takes. `admin-today.ts:778` maps it to `{name, range}` only, so it is unaffected.
- `apps/web/src/features/today/services/today-duty.ts` -- `legsOn` (yesterday's working legs, leave-aware), `runsAt`, `dayBefore`, `absoluteMinuteOf`, `todayDutyOf`. Reuse these for the carry-over. Add the new export here.
- `apps/web/src/features/today/components/today-card.tsx:16` `renderShift` -- each working-case row.
- `apps/web/src/lib/i18n/locales/hr.json:60` `danas.today` -- message keys.
- `apps/web/src/features/today/services/today.test.ts:672-675` -- this test pins `CASE_FREE` at 02.10 03:00 for a lone Noć, and must flip. The `pilot`, `takenOver`, `rowOf` and `zagrebOf` fixtures are here.
- `e2e/tests/today/today.spec.ts:455-530` -- duty e2e. Reuse its pattern: `seedTeamRotation`, `stepOn`, `page.clock.install(organizationInstant(...))`, `todayPage.todayCard(...)`.
- `_bmad-output/implementation-artifacts/deferred-work.md:811` -- the lone-Noć ledger entry to resolve.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/today/services/today-duty.ts` -- export `runningFromYesterdayOf(snapshot, sources, today, now): readonly CalendarDayShift[]`. It returns yesterday's legs from `legsOn` for which `runsAt` is true. It reuses the same leg recipe, so the case and the duty can never disagree.
- [x] `apps/web/src/features/today/services/today.ts` -- add `fromYesterday: boolean` to `TodayShift`. In `todayViewOf`, always compute `todayDutyOf`: on a leave day, today's legs are already dropped, so only a running duty can be found. Choose in this order: a running duty; the carry-over (working case: carried shifts first, then today's working shifts when there is no leave today, next-shift skip `NO_LEGS`); any other duty when there is no leave today; then `todayCaseOf` as now. Update the module doc's "EXACTLY ONE CASE" paragraph.
- [x] `apps/web/src/features/today/components/today-card.tsx` + `hr.json` -- a muted `od jučer` label (`danas.today.fromYesterday`) on a `fromYesterday` row.
- [x] `apps/web/src/features/today/services/today.test.ts` -- flip :672-675, and add a case for every matrix row.
- [x] `e2e/tests/today/today.spec.ts` -- a member's lone Noć dated yesterday, at 03:00 today: the "Danas radiš" card names the Noć with `od jučer`, at 390 px, with no horizontal scroll.
- [x] `deferred-work.md:811` -- prefix the summary with `RESOLVED by spec-fix-danas-overnight-carry-over.md —`, as other resolved entries do.

**Acceptance Criteria:**
- Given an admin on a team with a lone Noć from yesterday still running, when they open Danas, then their own-status subtitle reads "Danas radiš Noć 19:00–07:00" and coverage is unchanged.
- Given any viewer with no carry-over, when Danas renders, then every existing today, duty and admin test passes unchanged.

## Design Notes

A carry-over never joins a duty. If it touched a shift, `dutiesOf` would already have made it a running duty, and that case comes first. A carry-over that beats an upcoming duty still shows today's shifts as rows, so nothing is hidden. The running > upcoming > done order matches the 2026-10-06 duty decision.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm --filter ./apps/web test` -- expected: all pass
- `pnpm typecheck && pnpm lint` -- expected: clean
- `pnpm test:e2e e2e/tests/today/today.spec.ts` -- expected: all pass

## Suggested Review Order

**Case choice in Danas**

- Entry point: running duty, then carry-over, then other duty, then leave/working/free.
  [`today.ts:210`](../../apps/web/src/features/today/services/today.ts#L210)

- Carry-over computed only when no duty runs, so it never blanks a running duty.
  [`today.ts:240`](../../apps/web/src/features/today/services/today.ts#L240)

- Next-shift skip keeps today's upcoming duty legs out of the next card.
  [`today.ts:262`](../../apps/web/src/features/today/services/today.ts#L262)

- Yesterday's working legs running now, same leg recipe as the duty.
  [`today-duty.ts:319`](../../apps/web/src/features/today/services/today-duty.ts#L319)

**Presentation**

- New `fromYesterday` flag on a working-case row.
  [`today.ts:96`](../../apps/web/src/features/today/services/today.ts#L96)

- Muted `od jučer` label on a carried row.
  [`today-card.tsx:24`](../../apps/web/src/features/today/components/today-card.tsx#L24)

**Tests**

- Matrix rows: lone Noć, ended, leave from today, duty on first leave day, upcoming duty.
  [`today.test.ts:849`](../../apps/web/src/features/today/services/today.test.ts#L849)

- Admin own status reads the carried Noć; coverage unchanged.
  [`admin-today.test.ts:705`](../../apps/web/src/features/today/services/admin-today.test.ts#L705)

- E2E at 390 px: 03:00 reads Danas radiš, the Noć, od jučer.
  [`today.spec.ts:548`](../../e2e/tests/today/today.spec.ts#L548)
