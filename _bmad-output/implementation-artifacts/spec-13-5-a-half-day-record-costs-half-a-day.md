---
title: 'Story 13.5: A half-day record costs half a day'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_commit: '098759dc6c272c21616d1784ee45329ae1c7449d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every leave record is whole days. Half a shift away costs a full day, its worked half vanishes from Band Hours, and the member counts as absent for staffing, against R4.12 and R10.1.

**Approach:** A leave record gains a nullable `half` (`FIRST`/`SECOND`), allowed only on a one-date range. The domain costs it 0.5, splits the shift at its nominal midpoint for hours, and counts the member at work. The admin's leave dialog records and amends it, and every surface that shows days shows 0,5. The member's request is 13.5b (deferred-work).

Baseline is 098759dc (13.4b merged). Hot files (`hr.json`, `components/ui/*`), so this does not run in parallel with another hot-file story.

## Boundaries & Constraints

**Always:**
- **Rule (R4.12, PO 2026-11-12):**
  - A half-day is allowed only when the member has exactly one working Scheduled Shift that date. Otherwise the dialog refuses it.
  - The midpoint is start + ⌊duration/2⌋ on the nominal interval (overnight shifts included). FIRST is absent before the midpoint, SECOND after it.
  - It costs 0.5 Leave Days for balance, carry-over, preview, Sati and Excel. A non-drawing type costs 0.5 days and draws nothing.
  - It raises one collision.
  - Hours (PO 2026-11-12): whether the collision is unresolved or accepted as uncovered, the worked half counts in Band Hours and the total by intersection, and the absent half counts as leave minutes. *Zamijeni člana* is unchanged.
  - Staffing: the member counts at work (R10.1). This answers the deferred-work entry addressed to 13.5.
- One record per member per date stays. Two halves on one date are refused like any overlap (`LEAVE_OVERLAP`). A full day is one record.
- The schema enforces the shape: `half` is null or the range is one date. It is granted for insert, and `amend_leave_record` takes `p_half`, where null means a whole day. Every reader tolerates a missing `half` (old caches) as a whole day.
- **Dialog:**
  - After the type group, while Od = Do, a *Pola dana* switch. When it is on, two RadioCards, *Prvi dio smjene* and *Drugi dio smjene*, each with its times (e.g. 07:00–13:00).
  - Neither card is preselected, and the switch on with no half chosen cannot be saved.
  - Changing the range to more than one date clears the half.
  - The preview's cost reads *0,5 dana*. An amend that changes only the half is a change.
- Lists show *0,5 dana (prvi dio smjene)* / *(drugi dio smjene)*. Every day figure renders through the locale (no "0.5").

**Ask First:** allowing two halves on one date; a half-day mark on the calendar; any change to notifications text.

**Never:**
- The request flow (`leave_requests`, the request form, `decide_leave_request`). That is 13.5b.
- A partial Roster Override.
- Applying anything to the local DB, or running DB-connecting root tests (strict DB rule).
- Committing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Day shift | 07:00–19:00, FIRST | cost 0.5; worked 13:00–19:00 in bands, 6 h leave minutes; 1 collision |
| Night shift | 19:00–07:00, SECOND | worked 19:00–01:00, absent 01:00–07:00 (crosses midnight) |
| Odd minutes | 07:00–07:59, FIRST | absent 29 min, worked 30 min |
| Untimed working shift | half set | cost 0.5, untimed term, no leave minutes |
| No / two working shifts | half on that date | dialog refuses; domain `RangeError` if forced |
| Multi-date range | half set | `RangeError`; DB check refuses |
| Staffing | min 3, team 3, one on half-day | 3 at work, not short-staffed |
| Carry-over | balance ends at 2.5, cap 5 | carried 2.5 |
| Old cache | row without `half` | whole day |

## Epic AC Deviations

- AC 2, "one collision, worked half in Band Hours by intersection; the spec may refine": refined. The worked half counts whether the collision is unresolved or accepted as uncovered. *Zamijeni člana* moves the whole shift. Two halves on one date are not allowed. The spec may refine this, and the PO chose it on 2026-11-12.
- The member's half-day request (R9.2, the epic context's request-form order) is deferred to 13.5b. It has a deferred-work entry.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0028_leave_records.sql` -- table :52-113, `during` daterange `[)`, overlap exclusion :110, insert grant :191; new **0058** adds `half text null check (half in ('FIRST','SECOND'))` + check `half is null or upper(during)-lower(during)=1`, `grant insert (half)`
- `supabase/migrations/0054_*.sql` -- `amend_leave_record` :180-250 (drop/recreate with `p_half`, insert at :236 copies it); `decide_leave_request` :134 untouched (writes null)
- `supabase/migrations/0053_*.sql` -- `my_leave_records()` :56-90, `leave_overview_records()` ~:110-150: drop/recreate returning `half`
- `packages/domain/src/leave.ts` -- `LeaveRange` :82 (+`half?`), `checkRange` :238 (refuse half on multi-date / bad value), `intersect` :271 (must keep `half`), `costCounter` :308 (×0.5), `leaveCostOf` :323 (half-aware variant), `leaveDaysOfMonth` :353 (needs per-date weight), `leavePreviewOf` :731 (pass `preview.range`), `carriedInto` :643; exports `index.ts:83-101`
- `packages/domain/src/hours.ts` -- `MemberHoursInput` :50 (+`halfDays`), `walkMonth` :249 (half check before `leaveShifts` :274: WORKED term with half's bands + LEAVE term); `deriveShiftTimes` `duration.ts:81`, `minutesByBand` :114 handles ≤2880
- `packages/domain/src/staffing.ts` -- `leaveIndexOf` :115-119 skip half records; header :16
- `packages/domain/src/collisions.ts` -- header :18-24 (dates ≠ days now); no logic change
- Domain tests: `leave.test.ts` :182, :289, :420, :758, :973; `hours.test.ts` oracle :85, :419, :443, :565, :686, :781, :847; `staffing.test.ts` :133; `collisions.test.ts` :198, :370; fixtures `test/fixtures.ts` (pilot night 19:00–07:00)
- `apps/web/src/features/leave/services/leave-list.ts` -- `LEAVE_RECORDS_COLUMNS` :60, `LeaveRecord` :76, tolerant parse like `leaveRecordTypeOf` :117, `leaveRecordsOf` :138, `organizationLeaveRecordsOf` :591
- Mappers that drop fields: `calendar/utils/month.ts:1080` (staffing — carry `half`), `hours/services/hours-conflicts.ts:149` (carry), `conflicts/services/resolution-screen.ts:774` (carry; cost :848), `conflicts-queue.ts:345` (harmless)
- Hours inputs: `hours/services/my-hours.ts:119-132` `memberHoursInputOf` (+`halfDays`), :286/:325/:359 leave days per column; `hours-explanation.ts:317` (weight per line); callers `organization-hours.ts`, `calendar/utils/change-preview.ts:130`, `swaps/services/my-swaps.ts:~402`
- Cost sites: `today/services/today.ts:525`, `leave/services/leave-section.ts:189/:197/:572/:915`, unchanged-check `:564`
- Dialog: `leave/components/member-leave-dialog.tsx` (types :191-217/:285, preview :121-180); `leave/hooks/use-member-leave.ts` (from/to state :580, preview :316, save :712, amend :818, reset :627/:744); `leave/services/leave-write.ts` (insert :302, amend args :141/:436, `LEAVE_OVERLAP` :183); shift times via `memberScheduleOfMonth`/`shiftTypeVersionOn`/`deriveShiftTimes` as in `resolution-screen.ts:647`
- New `components/ui/switch.tsx` on `@radix-ui/react-switch` (pattern: `radio-group.tsx`, add dep to `apps/web/package.json`)
- Raw-number renders to fix: `leave-overview-rows.tsx:76/83/87`, `leave-overview-table.tsx:97/109/111`, `leave-tile.tsx:36` (`leaveHint {used}` `hr.json:106`); list row `member-leave-records.tsx:128`
- `hr.json` -- `count.days` :63 already gives "0,5 dana"; add switch, half cards, list suffix
- E2E: `e2e/pages/people.page.ts:783-798` (+switch, half cards), `e2e/tests/people/leave.spec.ts` (new half-day test; amend :388)
- Docs: `EXPERIENCE.md:106` (dialog), `:49/:66` (overview), `:127` (Sati); `DESIGN.md:346` (+Switch row); `ARCHITECTURE-SPINE.md` untouched (check, not trigger)

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0058_half_day_leave.sql` -- column, checks, grant, `amend_leave_record` and the two read functions recreated -- schema owns the shape
- [x] `packages/domain/src/leave.ts`, `hours.ts`, `staffing.ts`, `collisions.ts` header, `index.ts` (+tests) -- half cost, per-date weight, hours split, staffing, refusals; every matrix row tested
- [x] `leave-list.ts`, the mappers, `my-hours.ts`, `hours-explanation.ts`, `organization-hours.ts`, `change-preview.ts`, `my-swaps.ts`, cost sites (+tests) -- carry `half`; Sati and explanation sum weights
- [x] `components/ui/switch.tsx`, `member-leave-dialog.tsx`, `use-member-leave.ts`, `leave-write.ts`, `leave-section.ts` -- switch, half cards with times, refusal, save/amend payload, unchanged check
- [x] `member-leave-records.tsx`, overview rows/table, `leave-tile.tsx`, `hr.json` -- 0,5 and half suffix through the locale
- [x] `e2e/pages/people.page.ts`, `e2e/tests/people/leave.spec.ts` -- record a half day: list reads 0,5 dana (prvi dio smjene), balance drops 0.5; grep e2e for asserted dialog text
- [x] `EXPERIENCE.md`, `DESIGN.md` -- dialog, lists, Switch row; `deferred-work.md` mark the staffing entry RESOLVED by 13.5; `epic-13-context.md` as-built bullet; `sprint-status.yaml` adds `13-5b-a-member-asks-for-a-half-day: backlog`

**Acceptance Criteria:**
- Given no half-day records, when any surface renders, then every figure and existing assertion is unchanged.
- Given a half-day of a drawing type, when *Godišnji*, the member card, the overview and Sati render, then each shows 0,5 and the balance identity holds.

## Design Notes

**Why the dialog refuses, not the DB:** whether a date has exactly one working shift is derived (AD-1), so the DB can only enforce shape. A schedule change that later removes the shift makes the record cost 0 like a full day on a non-working date, and it raises nothing.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && … pnpm typecheck` -- pass
- `… pnpm --filter @shift/domain test`, `… pnpm --filter ./apps/web exec vitest run` -- pass
- DB tests for 0058 and e2e run in CI (migration not applied locally; strict DB rule).

## Suggested Review Order

**The rule (domain)**

- Entry point: a half weighs 0.5; every cost, balance and carry-over goes through it.
  [`leave.ts:143`](../../packages/domain/src/leave.ts#L143)

- Shape refusals shared by collisions and staffing: a half only on one date.
  [`leave.ts:293`](../../packages/domain/src/leave.ts#L293)

- The one working shift a half day may cover, or none (the dialog's refusal).
  [`leave.ts:422`](../../packages/domain/src/leave.ts#L422)

- Per-date weights for Sati; overlapping records take the larger weight, order-free.
  [`leave.ts:494`](../../packages/domain/src/leave.ts#L494)

- The split at start + ⌊duration/2⌋ on the nominal interval, overnight included.
  [`hours.ts:111`](../../packages/domain/src/hours.ts#L111)

- The walk: worked half into bands, absent half into leave minutes, before accepted keys.
  [`hours.ts:317`](../../packages/domain/src/hours.ts#L317)

- R10.1: a half-day member stays at work for staffing.
  [`staffing.ts:116`](../../packages/domain/src/staffing.ts#L116)

**Schema**

- Shape owned by a named check: `half` only on a one-date range.
  [`0058_half_day_leave.sql:47`](../../supabase/migrations/0058_half_day_leave.sql#L47)

- Amend takes `p_half`; null is a whole day.
  [`0058_half_day_leave.sql:66`](../../supabase/migrations/0058_half_day_leave.sql#L66)

**The dialog**

- Refusal order: no single working shift first, then an unchosen half.
  [`leave-section.ts:475`](../../apps/web/src/features/leave/services/leave-section.ts#L475)

- The half cards with derived times; both without times when the type is missing.
  [`leave-section.ts:564`](../../apps/web/src/features/leave/services/leave-section.ts#L564)

- The switch carries the refusal when no card is drawn.
  [`member-leave-dialog.tsx:249`](../../apps/web/src/features/leave/components/member-leave-dialog.tsx#L249)

- The half actually sent, reused for the payload and the short-staffed preview.
  [`use-member-leave.ts:390`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L390)

- The short-staffed preview keeps the half, so a half day warns nothing.
  [`short-staffed.ts:327`](../../apps/web/src/features/staffing/services/short-staffed.ts#L327)

- Write payload: `p_half` omitted for a whole day.
  [`leave-write.ts:146`](../../apps/web/src/features/leave/services/leave-write.ts#L146)

**Reading and showing**

- Parser: a missing or null half (old caches) reads as a whole day.
  [`leave-list.ts:33`](../../apps/web/src/features/leave/services/leave-list.ts#L33)

- Records to the hours input's half days.
  [`my-hours.ts:148`](../../apps/web/src/features/hours/services/my-hours.ts#L148)

- The admin's Sati and Excel split the half too.
  [`organization-hours.ts:260`](../../apps/web/src/features/hours/services/organization-hours.ts#L260)

- The ⓘ explanation sums weights, so its lines match the cell.
  [`hours-explanation.ts:323`](../../apps/web/src/features/hours/services/hours-explanation.ts#L323)

- Admin Danas coverage follows R10.1.
  [`admin-today.ts:682`](../../apps/web/src/features/today/services/admin-today.ts#L682)

- Swap previews read the viewer's own records, with a silent whole-day fallback.
  [`swap-proposal.ts:630`](../../apps/web/src/features/swaps/services/swap-proposal.ts#L630)

- Bare day figures through the locale: 0,5, never 0.5.
  [`format.ts:522`](../../apps/web/src/lib/i18n/format.ts#L522)

- The list row's half suffix.
  [`member-leave-records.tsx:35`](../../apps/web/src/features/leave/components/member-leave-records.tsx#L35)

**Peripherals**

- New Switch on Radix, shadcn style like `radio-group.tsx`.
  [`switch.tsx:17`](../../apps/web/src/components/ui/switch.tsx#L17)

- Domain cases: cost, weights, carry-over 2.5, refusals.
  [`leave.test.ts:968`](../../packages/domain/test/leave.test.ts#L968)

- Hours matrix: day, night, odd minutes, untimed, accepted.
  [`hours.test.ts:670`](../../packages/domain/test/hours.test.ts#L670)

- DB block for 0058 (runs in CI only).
  [`rls-isolation.test.ts:26134`](../../test/rls-isolation.test.ts#L26134)

- E2E: record, list, balance, half-only amend.
  [`leave.spec.ts:1021`](../../e2e/tests/people/leave.spec.ts#L1021)
