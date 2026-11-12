---
title: 'Story 13.4b: Carry-over is derived and shown'
type: 'feature'
created: '2026-11-12'
status: 'done'
baseline_commit: '16459ee3758e5cf271f61ca0af854d10a754d27b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 13.4 stores the carry-over setting, but no balance uses it. A member's unused days are still lost at the turn of the year, against R4.13–R4.15.

**Approach:** `@shift/domain` derives carried days from the setting inside `leaveBalanceOf` / `leavePreviewOf`, so every balance surface gets them from one rule. The Danas tile, *Godišnji*, the member page leave card and the leave overview show a carried line with its expiry.

Baseline is 16459ee3 (13.4 merged). This story touches hot files (`hr.json`), so it is not run in parallel with another hot-file story.

## Boundaries & Constraints

**Always:**
- **Rule (R4.13–R4.15, PO 2026-11-11):**
  - Carried into leave year Y = min(cap, max(0, balance of Y−1 at its end)), only for Y ≥ the setting's first leave year. Into the first year it comes from Y−1's balance with nothing carried into Y−1.
  - The chain recomputes from the first year, using each year's allowance (`leaveAllowanceOf`) and its drawing records.
  - Expiry in Y follows the 13.4 spec's Design Notes. Consumed = min(carried, drawing leave days of Y dated on or before the expiry).
  - While `today` ≤ expiry: the shown carried = carried, and lapsed = 0. After the expiry: the shown carried = consumed, and lapsed = carried − consumed.
  - `balanceDays = allowanceDays + carriedDays − usedDays` always. `LeaveBalance` gains `carriedDays`, `lapsedDays` and `carryOverExpiry` (the ISO date, or null when nothing was carried).
- `LeaveBalanceInput.carryOver?` is optional. Absent or null means no carry-over, and every current result stays identical. A malformed setting throws a `RangeError` naming it, like every other precondition.
- **Preview (PO 2026-11-12, real coverage):**
  - `balanceAfterDays` is the balance with the range added as a record.
  - `exceedsBalance` is true when the charge is positive and the year's balance after the expiry, with the range, would be negative. So days after the expiry are never covered by carried days.
  - Without carry-over, this equals today's rule.
- **Web:**
  - `LeaveOrganizationAnswer` carries the setting, read with `carryOverOf`. A missing field is none, so old caches and fixtures stay valid.
  - Every `leaveBalanceOf` / `leavePreviewOf` input passes it: `memberLeaveBaseOf`, `myLeaveInputOf`, the resolution screen, the request form and the review.
- **Line (PO 2026-11-12):**
  - Before expiry: "Preneseno 5 dana (istječu 30.06.)".
  - After expiry with lapsed days: "Preneseno 3 dana (2 istekla 30.06.)".
  - After expiry with none lapsed: "Preneseno 5 dana".
  - Day count, verb and lapsed count are ICU plurals. No line when nothing was carried.
  - The line shows on the Danas leave tile, *Godišnji* (under the three figures) and the member leave card (a *Preneseno* row).
  - The leave overview gets a *Preneseno* column after *Pravo* (number, plus the same parenthetical), and a field in the stacked rows. Its sum joins the summary line. No sort, no filter.

**Ask First:** storing any derived figure; a carried line on a preview or request surface; changing the identity or the chain's start.

**Never:** a migration; a change to the setting or its card; a sort or filter on carried days; setting carry-over on the shared e2e organization while other specs run. Never apply anything to the local DB or run DB-connecting root tests (strict DB rule). Never commit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Worked example | cap 5; Y−1: 20, used 14; Y: 20, 3 days before 30.06., today after | carried 3, lapsed 2, balance 20 |
| Before expiry | same, today before 30.06. | carried 5, lapsed 0, balance 22 |
| Capped / overdrawn | Y−1 balance 9 / −4 | carried 5 / 0 |
| Before first year | Y < first leave year | carried 0, no line |
| Chain | first = Y−1; Y−2 unused 5, Y−1 unused 0 + its carry | Y's carry includes Y−1's unconsumed carried days |
| Preview after expiry | today before expiry, 4 carried days left, own allowance 0 left, range of 2 days after expiry | `exceedsBalance` true |
| No setting / old cache | `carryOver` absent | figures as today |
| Malformed | cap 0, 31.06. | RangeError |

## Epic AC Deviations

None. The three ACs that 13.4 deferred are met here, and AC 4's docs are updated. Two additions were approved by the PO on 2026-11-11 and 2026-11-12 and narrow nothing:
- the first leave year carried into;
- the carried line on *Godišnji* and the member card, beyond "tiles and the overview".

</frozen-after-approval>

## Code Map

- `packages/domain/src/leave.ts` -- `LeaveBalanceInput` :104, `LeaveBalance` :124, `checkBalanceInput` :431, `balanceOf` :450, `leaveBalanceOf` :459, `leavePreviewOf` :477; reuse `leaveYearOf` :318, `leaveYearNumberOf` :345, `leaveAllowanceOf` :385, `costCounter`/`leaveDatesCollector` (dated leave days), `intersect`. Header comment documents the rules.
- `packages/domain/test/leave.test.ts` -- `base()` :422; balance :431-466, preview :470+; 13.3 describe :654 is the shape to copy
- `apps/web/src/features/organization/services/snapshot.ts` -- `CarryOverSetting` :133, `carryOverOf` :244 (lenient; the fetched row already has the columns)
- `apps/web/src/features/organization/utils/carry-over.ts` / `leave-start.ts` -- `formatIsoDayMonth` for "30.06."
- `apps/web/src/features/leave/services/leave-section.ts` -- `LeaveOrganizationAnswer` :85, `LeaveRecordsInput` :139, `leaveYearStartOf` :223, `memberLeaveBaseOf` :236 (input :264, balance :277); previews :189, :432, :772
- `apps/web/src/features/leave/services/my-leave.ts` -- `leaveYearStartOf` :148, `myLeaveInputOf` :173, balance :241, tiles :258/:272, request preview :354
- `apps/web/src/features/conflicts/services/resolution-screen.ts` -- :349/:353/:850 reuse `base.input` (gets the setting through `memberLeaveBaseOf` :766)
- `apps/web/src/features/leave/services/leave-overview.ts` -- `LeaveOverviewFigures` :372, row :378, summary :392, rows :565-579, `leaveOverviewSummaryOf` ~:649
- UI: `today/services/today-tiles.ts:46,95`, `today/components/leave-tile.tsx:31-34`; `leave/components/my-leave-summary.tsx:18-22`; `leave/components/member-leave-card.tsx:96-110`; `leave/components/leave-overview-table.tsx:73-109` (colSpans 2 and 5 grow by one), `leave-overview-rows.tsx:73-84`, `leave-overview-filters.tsx:75-79`
- `hr.json` -- `count.days` :62 (plural pattern), `danas.tiles` :101, `godisnji` :527-566, `ljudi.leaveRecord` :1046
- Fixtures of `LeaveOrganizationAnswer` (stay valid): `today-tiles.test.ts:124`, `leave-overview.test.ts:176`, `my-leave.test.ts:137`, `leave-section.test.ts:161`, `leave-request-review.test.ts:142`, `resolution-screen.test.ts:211`
- E2E: `e2e/pages/leave.page.ts:29-50,116,148`, `today.page.ts:113-129`, `people.page.ts:620`; specs asserting the overview cells by index: `e2e/tests/leave/my-leave.spec.ts:297-300`; `e2e/tests/organization/carry-over.spec.ts:12` (first year 2027)
- Docs: `EXPERIENCE.md:40,49,106` (Godišnji, overview columns, member card)

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/leave.ts` (+`test/leave.test.ts`) -- `LeaveCarryOver` input, the chain, consumption, lapse, the three new fields, the preview rule, export from `index.ts`; every matrix row tested
- [x] `leave/services/leave-section.ts`, `my-leave.ts`, `leave-overview.ts` (+tests) -- carry the setting into every input; overview row and summary gain carried figures
- [x] `today-tiles.ts`, `leave-tile.tsx`, `my-leave-summary.tsx`, `member-leave-card.tsx`, `leave-overview-table.tsx`, `leave-overview-rows.tsx`, `leave-overview-filters.tsx` -- the line, the row, the column (colSpans), the stacked field, the summary
- [x] `hr.json` -- the three line shapes, `godisnji.overview.carried`, the summary's carried part
- [x] `e2e/tests/organization/carry-over.spec.ts` -- the first year moves to 2099, so the setting stays inert while the shared organization runs other specs
- [x] `e2e/tests/leave/carry-over.spec.ts` (+page objects) -- answer the organization GET with a carry-over through `page.route` (no shared write); assert the Danas line, *Godišnji* (line and balance = allowance + carried − used) and the overview column; fix `my-leave.spec.ts` cell indexes
- [x] `EXPERIENCE.md` -- the line on Danas, Godišnji and the member card, and the overview column
- [x] `deferred-work.md` -- mark the 13.4b entry RESOLVED; `epic-13-context.md` gets an as-built bullet; `sprint-status.yaml` sets 13.4 `done  # #292`

**Acceptance Criteria:**
- Given an organization without the setting, when any balance surface renders, then every figure and every existing unit and e2e assertion is unchanged.
- Given carried days, when *Godišnji*, the tile, the member card and the overview render, then allowance + carried − used = balance on each.

## Design Notes

**One computation, two moments:** the derivation runs per leave year from `max(first, earliest needed)` to the current one. Each year's end balance (after its expiry) feeds the next year's carry. "Today" only decides whether the current year's carried days are shown pending or lapsed. The preview's warning always judges the year's post-expiry end, which is why a range after the expiry cannot borrow carried days.

**Preview warning wording (PO, 2026-11-12, review):** when the warning is caused only by the carried days expiring before the range's dates (balance after still ≥ 0), every warning surface reads "Preneseni dani istječu {dayMonth}; nakon toga preostaje {count} dana." instead of the over-balance text. `LeavePreview` carries `endBalanceAfterDays` and `exceedsAfterExpiry` for it.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && … pnpm typecheck` -- pass
- `… pnpm --filter @shift/domain test` and `… pnpm --filter ./apps/web exec vitest run` -- pass
- E2E runs in CI (no local e2e while 5173 is held by another session).

## Suggested Review Order

**The rule (domain)**

- Entry point: the setting enters the one balance input; absent means every result as before.
  [`leave.ts:125`](../../packages/domain/src/leave.ts#L125)

- The chain: each year's post-expiry end balance, capped, feeds the next year's carry.
  [`leave.ts:612`](../../packages/domain/src/leave.ts#L612)

- One balance computation, with an optional extra range for the preview.
  [`leave.ts:659`](../../packages/domain/src/leave.ts#L659)

- Expiry placed on or after the leave year's first day (13.4 Design Notes).
  [`leave.ts:531`](../../packages/domain/src/leave.ts#L531)

- The warning judges the post-expiry end; it fires when the range lowers the balance.
  [`leave.ts:735`](../../packages/domain/src/leave.ts#L735)

- Flags the expiry-caused warning, so its copy cannot contradict the balance.
  [`leave.ts:744`](../../packages/domain/src/leave.ts#L744)

**Wiring the setting**

- The leave answer reads the setting leniently; old caches read as none.
  [`leave-section.ts:244`](../../apps/web/src/features/leave/services/leave-section.ts#L244)

- The viewer's own input carries it too; every other surface reuses these two inputs.
  [`my-leave.ts:179`](../../apps/web/src/features/leave/services/my-leave.ts#L179)

**What is shown**

- The line's three shapes, pending / lapsed / kept, or none when nothing was carried.
  [`leave-section.ts:341`](../../apps/web/src/features/leave/services/leave-section.ts#L341)

- The warning's two shapes: over balance, or the carried days expiring first (PO 2026-11-12).
  [`leave-section.ts:410`](../../apps/web/src/features/leave/services/leave-section.ts#L410)

- Danas tile: the line under the hint.
  [`leave-tile.tsx:40`](../../apps/web/src/features/today/components/leave-tile.tsx#L40)

- Member card: the *Preneseno* row.
  [`member-leave-card.tsx:102`](../../apps/web/src/features/leave/components/member-leave-card.tsx#L102)

- Overview row figures keep the identity; the summary sums carried days.
  [`leave-overview.ts:375`](../../apps/web/src/features/leave/services/leave-overview.ts#L375)

- Member dialog: the expiry warning wording.
  [`member-leave-dialog.tsx:171`](../../apps/web/src/features/leave/components/member-leave-dialog.tsx#L171)

**Peripherals**

- Domain cases: worked example, cap, chain, first year, both preview warnings, malformed.
  [`leave.test.ts:758`](../../packages/domain/test/leave.test.ts#L758)

- E2E through a routed organization answer, so the shared organization is never written.
  [`carry-over.spec.ts:144`](../../e2e/tests/leave/carry-over.spec.ts#L144)

- The 13.4 setting spec moves to 2099 so it stays inert during parallel specs.
  [`carry-over.spec.ts:12`](../../e2e/tests/organization/carry-over.spec.ts#L12)
