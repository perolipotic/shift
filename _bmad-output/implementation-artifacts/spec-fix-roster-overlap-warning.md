---
title: 'Putting someone on a shift they would double-book warns, without blocking'
type: 'bugfix'
created: '2026-10-01'
status: 'done'
baseline_commit: '4f1d1b37ea066fc836b79925e02e0476006810c3'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-retro-2026-10-01.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 3.6b roster form ("Dolazi") offers every member active on the date, including one who already works an overlapping shift, for example their own team's shift on the same day. Nothing warns the admin. Hours then count that window twice on Sati, in the organization table and in the Excel file (Epic 4 retro, finding C2). On 2026-10-01 the human decided: warn, do not block.

**Approach:**
- When the admin picks a member in "Dolazi", compute whether any shift that member is already scheduled on overlaps the nominal window of the shift being changed. "Already scheduled" means their own team's shift or one an override puts them on, on D-1, D or D+1, since a shift can cross midnight.
- If one overlaps, show a non-blocking hint beside the select, naming the overlapping team and its times.
- Saving stays exactly as it is.

## Boundaries & Constraints

**Always:**
- The overlap rule is pure and lives in `apps/web/src/features/calendar/utils/day-detail.ts`, unit-tested in node (AD-15). The hook only holds the chosen id.
- Intervals are nominal: integer minutes on an absolute axis (day offset × 1440 + start, + duration from `deriveShiftTimes`). Touching ends (07:00 end, 07:00 start) do not overlap.
- Only working shift types count. A null type or version is skipped.
- The member's schedule comes from `memberScheduleInputOf` + `memberScheduleOfMonth`, with overrides in force. When D-1 or D+1 falls in another month, also query `monthOf` of that date.
- The shift being changed (team and D) is never counted against itself.
- Copy comes from `hr.json`. The hint is announced politely (`role="status"`) and tied to the select with `aria-describedby`. It is neutral in tone: `destructive` stays reserved for conflicts, and it carries no refusal icon.
- Picking "— nitko —" or a non-overlapping member clears the hint. A new day or a successful save also clears it.
- The "Dolazi" select stays uncontrolled; a refusal keeps the fields.

**Ask First:**
- Blocking the save, a confirmation step, or any server or RLS check.
- Marking candidates in the option list itself.
- Any change to `packages/domain`.

**Never:**
- No change to how hours count, no change to the roster write, no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Own team same window | A on Smjena 1 Dan 07–19 on D; put on Smjena 2 Dan 07–19 on D | hint names Smjena 1, 07:00–19:00 | N/A |
| Night crosses into D | A's own Noć 19–07 on D-1; put on a 06–18 shift on D | hint (06–07 overlaps) | N/A |
| Touching only | own Noć 19–07 on D-1; put on Dan 07–19 on D | no hint | N/A |
| Next-day start | put on Noć 19–07 on D; own Dan 06–18 on D+1 | hint | N/A |
| Already put on elsewhere | an override puts A on Smjena 3 same window on D | hint names Smjena 3 | N/A |
| Own day off | A's own team off on D | no hint | N/A |
| Month edge | D = 1st, own Noć on the last day of the previous month | hint | N/A |
| Nobody chosen | "— nitko —" | no hint | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/calendar/utils/day-detail.ts`
  - `DayDetail` (:162-192) carries `range` (a string) but not the scheduled type id. `dayDetailOf` (:217) has `scheduled.shiftTypeId` (:269) and `typeOf(...)` (:303). Add the scheduled type id to `DayDetail` so the window can be derived.
  - `rosterOffersOf` (:632-677) builds the "in" candidates. Its docblock (:616-624) says "nothing is warned" and must be updated.
  - Add the new pure function here, for example `rosterOverlapOf(snapshot, detail, memberId) → { teamName, range } | null`, plus an exported helper for a ±1 UTC day.
- `apps/web/src/features/calendar/utils/month.ts`
  - `memberScheduleInputOf` (:786) and `typeRangeOn` (:763) show the "HH:MM–HH:MM" pattern.
  - `snapshot.members[i]` already carries `memberships` and `statuses`.
- `packages/domain` (read-only): `memberScheduleOfMonth` (`schedule.ts:277`; `MemberShift` at :239 has no date, the day has it), `shiftTypeVersionOn` and `deriveShiftTimes` (`duration.ts:105, :81`), `monthOf`, `MINUTES_PER_DAY`, `daysBetween`. All are exported from `index.ts`.
- `apps/web/src/features/shift-types/services/list.ts:430` -- `shiftTimesShownOf(version).range` for the hint's times. It is public to calendar.
- `apps/web/src/features/calendar/components/roster-form.tsx:61-128` -- `RosterSetForm`. The "Dolazi" `<Select ref={inField} defaultValue={ROSTER_NOBODY}>` is at :112-128. Put the hint after it, inside the same `grid gap-2`.
- `apps/web/src/features/calendar/hooks/use-roster-form.ts:70` -- `inField` ref. Add the chosen-id state plus an `onChange`, reset per day (`shownFor`) and after a save. The form is keyed at `components/day-detail-dialog.tsx:298`.
- `apps/web/src/lib/i18n/locales/hr.json` `kalendar.detail.rosterChange.set` -- add the hint copy. Suggested: `"overlap": "{name} tada već radi: {team}, {range}. Sati bi se brojali dvaput."` Register the new key wherever the resource-hygiene and `prijava.test.ts` string checks require.
- Tests:
  - `apps/web/src/features/calendar/utils/day-detail.test.ts:847` (the 3.6b describe).
  - `e2e/tests/calendar/calendar.spec.ts:1120` (`an admin changes a shift roster at 1280 px`).
  - Page object `e2e/pages/calendar.page.ts:401-446` (`rosterInIn`, `memberOptionIn`, …). Add a hint locator.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/calendar/utils/day-detail.ts` -- add the scheduled type id to `DayDetail`, `rosterOverlapOf` and the date helper, and update the `rosterOffersOf` doc -- the rule, in one pure place.
- [x] `apps/web/src/features/calendar/utils/day-detail.test.ts` -- one test per matrix row -- pins the rule.
- [x] `apps/web/src/features/calendar/hooks/use-roster-form.ts` and `components/roster-form.tsx` (plus `day-detail-dialog.tsx` if props flow through it) -- hold the chosen "in" id and render the hint with `role="status"` and `aria-describedby` -- the admin sees it before saving.
- [x] `apps/web/src/lib/i18n/locales/hr.json` and the hygiene/string tests -- the hint copy -- no literal in `.tsx`.
- [x] `e2e/tests/calendar/calendar.spec.ts` and `e2e/pages/calendar.page.ts` -- with the seeded rotation, open another team's working day, pick a member whose own team works the same window: the hint is visible. Pick "— nitko —": the hint is gone. Save still succeeds, then remove the change -- end-to-end proof that it warns without blocking.

**Acceptance Criteria:**
- Given a member who already works an overlapping window, when the admin picks them in "Dolazi", then a hint naming the overlapping team and times appears and is announced, and the save stays enabled and succeeds.
- Given the hint is shown, when the admin picks nobody, picks a non-overlapping member, opens another day, or saves, then the hint is gone.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green
- `pnpm exec playwright test e2e/tests/calendar` -- expected: all pass

## Suggested Review Order

**The overlap rule**

- Entry point: the member's shifts on D-1..D+1 against this shift's nominal window.
  [`day-detail.ts:837`](../../apps/web/src/features/calendar/utils/day-detail.ts#L837)

- Guarded wrapper: a broken snapshot means no hint, never a broken form.
  [`day-detail.ts:893`](../../apps/web/src/features/calendar/utils/day-detail.ts#L893)

- Whole-day shifting with a round-trip check, for the month and year edges.
  [`day-detail.ts:716`](../../apps/web/src/features/calendar/utils/day-detail.ts#L716)

- The scheduled type id the window is derived from.
  [`day-detail.ts:192`](../../apps/web/src/features/calendar/utils/day-detail.ts#L192)

**Form wiring**

- Mirrors the chosen id, resets it when it is not offered, and memoizes the hint.
  [`use-roster-form.ts:24`](../../apps/web/src/features/calendar/hooks/use-roster-form.ts#L24)

- An always-present polite live region, tied to the select's description.
  [`roster-form.tsx:156`](../../apps/web/src/features/calendar/components/roster-form.tsx#L156)

**Tests and copy**

- Warns without blocking; cleared by nobody, save, remove and another day.
  [`calendar.spec.ts:1257`](../../e2e/tests/calendar/calendar.spec.ts#L1257)

- The hint locator, sibling of the Dolazi field.
  [`calendar.page.ts:435`](../../e2e/pages/calendar.page.ts#L435)

- Matrix rows, tie-break and guarded fallback.
  [`day-detail.test.ts:21`](../../apps/web/src/features/calendar/utils/day-detail.test.ts#L21)

- The hint copy, naming the day.
  [`hr.json:78`](../../apps/web/src/lib/i18n/locales/hr.json#L78)
