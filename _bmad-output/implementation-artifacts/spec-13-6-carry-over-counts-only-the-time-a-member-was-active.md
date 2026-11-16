---
title: 'Story 13.6: Carry-over counts only the time a member was active'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: 'df2f67f969f97832f6d3e9461c4992ce9c8dd0d1'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `carriedInto` (`packages/domain/src/leave.ts:759`) ends each earlier leave year at its full allowance and never reads the member's statuses. So a member who was deactivated for most of the previous year, or reactivated late in it, carries in days up to the cap for time they were not a member (epic 13 retro B2).

**Approach:** In the carry chain only, each earlier year's allowance is prorated by the calendar days the member was active in it, and rounded down to a half day. Everything stays in `@shift/domain`, so every balance surface picks it up with no change of its own. The baseline is df2f67f9. No hot files are touched.

## Boundaries & Constraints

**Always:**
- **Rule (PO 2026-11-16, answers to A3's three questions):** in the chain, year Y's end balance = `prorated(Y) + consumed(Y) − drawn(Y)`.
  - `prorated(Y) = floor(2 × allowance(Y) × activeDays(Y) / daysIn(Y)) / 2`.
  - `activeDays` is the count of dates of leave year Y on which `activeOn(input.statuses, date)` holds. `daysIn` counts every date of that year, including a year cut at 0001-01-01.
  - The cap, the expiry and consumption are unchanged.
- **"Active" means the status versions only (PO answer 1a).** A member with no status version is active on every date, as `0008` defines it, so a newly created member carries as before. `members.created_at` is not read.
- Proration applies to every year in the chain, not only Y−1. The current year's `allowanceDays`, `usedDays` and the preview's end balance stay as they are.
- A member active for the whole year: `prorated = allowance` exactly, so every 13.4b figure is unchanged.
- The chain's early start (`earliest − 1`) stays valid, because a year with no drawing days still ends at a figure that does not depend on what was carried into it. Its doc comment says so.

**Ask First:** any change outside `packages/domain` other than the doc tasks below, which would mean a caller does not pass the full status history.

**Never:** storing a derived figure (AD-1, AD-7, R4.15); prorating the current year's allowance; reading `created_at`; adding a column, a migration or an `hr.json` key; per-surface rounding.

## I/O & Edge-Case Matrix

Allowance 20, cap 5, first leave year 2027, leave year starting 01.01., `today` in 2027.

| Scenario | 2026 statuses | Expected carried into 2027 |
|---|---|---|
| Whole year active | none | as 13.4b (min(5, 20 − drawn)) |
| Reactivated 2026-10-02 (91 of 365 days active), drew 0 | inactive 2026-01-01, active 2026-10-02 | prorated = floor(2·20·91/365)/2 = 4.5 → carried 4.5 |
| Same, drew 2 in Q4 | as above | 4.5 − 2 = 2.5 |
| Inactive the whole of 2026 | inactive from 2025-06-01 | 0 |
| Deactivated 2026-03-01 (59 days active), drew 3 in Jan–Feb | inactive 2026-03-01 | floor(2·20·59/365)/2 = 3 → 3 − 3 = 0 |
| Prorated below drawn | active 30 days, drew 4 | max(0, …) → 0 |

</frozen-after-approval>

## Code Map

- `packages/domain/src/leave.ts:802-845` -- `carriedInto`; line 841 is the prorated end balance. The per-year range comes from `leaveYearNumbered` (674), and the active days from the private `activeDaysIn` (757). `balance.input.statuses` is already on the input (`LeaveBalanceInput.input`, 202-215).
- `packages/domain/src/leave.ts:34-61` -- the module header's CARRY-OVER paragraph, which states the rule.
- `packages/domain/src/roster.ts:109` -- `activeOn` re-sorts the versions on every call. Count a year's active days from one ordered pass over the versions (or one sort per call of `carriedInto`), not 366 `activeOn` calls per year.
- `packages/domain/test/leave.test.ts:763` -- the `carry-over (story 13.4b…)` suite, with its `at(...)`, `setting(...)` and `leaveDatesFrom` helpers. `inputOf(FIXTURES[0], 0)` gives an input whose `statuses` can be overridden.
- Callers, deliberately left: `apps/web/src/features/leave/services/leave-section.ts:302`, `my-leave.ts:191`, `today/services/today.ts:524`, `leave/services/leave-overview.ts:588` and `conflicts/services/resolution-screen.ts:350,873`. All of them build `input` through `memberScheduleInputOf`, from the snapshot's full status history (`calendar/services/snapshot.ts:667`). No row gains a column, so no mapper changes.
- Display, left: `formatLeaveDays` and the `godisnji.carriedDays.*` ICU plurals already render a half (`4,5 dana`), as they have since 13.5.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/leave.ts` -- prorate each chain year's allowance as stated in Always, using a private active-days counter. Update the CARRY-OVER header paragraph and `carriedInto`'s comment (story 13.6, PO 2026-11-16) -- a single rule (AD-7).
- [x] `packages/domain/test/leave.test.ts` -- add a `carry-over counts only active time (story 13.6)` block covering every row of the matrix. Add one case for a two-year chain in which the inactive year sits two years back, and one for a leave year starting 01.07., to check that `daysIn` follows the leave year -- this proves AC1–AC3.
- [x] `_bmad-output/specs/spec-shift/engine-rules.md` -- R4.13: add `(amended 2026-11-16, story 13.6)` with the proration and rounding sentence.
- [x] `_bmad-output/planning-artifacts/prds/prd-shift-2026-09-01/prd.md` -- FR-76: add one consequence line: the previous year's allowance counts only the days the Member was active, rounded down to a half day (story 13.6).
- [x] `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md` -- leave the lines as they are: no surface or wording changes. Record that in the Verification notes (AC4).
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- move `13-6-…` to `done` and the retro action A3 item, if it is not already done, at merge, following the repo's usual practice.

**Acceptance Criteria:**
- Given a member who was active in only part of the previous leave year, when the carry is derived, then it equals the matrix's figure on every balance surface (one domain rule), and nothing is stored.
- Given a member who was not active at any point in the previous leave year, when the carry is derived, then 0 days are carried and no carried line is shown.
- Given a member who was active the whole previous year, when the carry is derived, then every existing 13.4b test passes unchanged.
- Given the story merges, then R4.13 and FR-76 state the proration. DESIGN.md, EXPERIENCE.md and the UX-DRs need no edit, because no surface or wording changes.

## Epic AC Deviations

- *"the previous year's allowance is counted in proportion to the days the member was active"* -- narrowed. "Active" is read from status versions only (PO 2026-11-16, answer 1a). A member created during the year who has no status versions counts as active for the whole year, because pilot accounts are opened at onboarding for people who were members long before. The result is rounded down to a half day (answer 2a). Every year in the chain is prorated, not only the previous one (answer 3).

## Design Notes

The rounding is `Math.floor(2 * a * active / days) / 2`. Compute it with integers to avoid float drift (for example, 20·91·2 = 3640, and floor(3640/365) = 9 → 4.5). The other edge cases follow without special code: a year in which the member is wholly inactive has a prorated allowance of 0 and no drawn days, because inactive dates cost nothing (R4.2), so `max(0, …)` gives 0.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm --filter @shift/domain test` -- expected: green, with the new block included
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm typecheck && pnpm lint` -- expected: clean
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- expected: green (DB-free root tests)
- No migration, so no DB test changes. E2E members have no status versions, so `e2e/tests/organization/carry-over.spec.ts` is unaffected. CI is the e2e gate.

**Notes:**
- AC4: EXPERIENCE.md, DESIGN.md and the UX-DRs are left unedited. No surface or wording changes: the carried figure may now be a half (`4,5 dana`), which `formatLeaveDays` and the `godisnji.carriedDays.*` plurals already render since 13.5.

## Suggested Review Order

**The proration rule**

- Entry point: each chain year's allowance is prorated before consumed and drawn days apply.
  [`leave.ts:825`](../../packages/domain/src/leave.ts#L825)

- The one changed line: the end balance now uses the prorated allowance.
  [`leave.ts:841`](../../packages/domain/src/leave.ts#L841)

- One ordered pass over status versions; no version means active, as `0008` defines.
  [`leave.ts:757`](../../packages/domain/src/leave.ts#L757)

- Why the chain's early start still holds, and the status-version recompute.
  [`leave.ts:802`](../../packages/domain/src/leave.ts#L802)

- The module header states the rule once (AD-7).
  [`leave.ts:42`](../../packages/domain/src/leave.ts#L42)

- `@throws` now names malformed status versions read by a carry chain.
  [`leave.ts:899`](../../packages/domain/src/leave.ts#L899)

**Contract docs**

- R4.13 states proration and rounding; R4.15 adds status changes as a recompute trigger.
  [`engine-rules.md:124`](../specs/spec-shift/engine-rules.md#L124)

- FR-76 consequence line in product terms.
  [`prd.md:954`](../planning-artifacts/prds/prd-shift-2026-09-01/prd.md#L954)

**Tests**

- The 13.6 block: every matrix row plus the review's added cases.
  [`leave.test.ts:967`](../../packages/domain/test/leave.test.ts#L967)

- Two active segments in one year — the accumulation the review found untested.
  [`leave.test.ts:1062`](../../packages/domain/test/leave.test.ts#L1062)

- Compounding across two part years through the chain.
  [`leave.test.ts:1098`](../../packages/domain/test/leave.test.ts#L1098)

- The preview judges its warnings against the prorated carry.
  [`leave.test.ts:1118`](../../packages/domain/test/leave.test.ts#L1118)
