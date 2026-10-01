---
title: 'An admin sees every unresolved conflict on the calendar without opening a day, and leave shows as a hatch (5.3c)'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: '3c9a0057abd8bf0cc4ee2857d9739a2914b18249'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 5.3a derives conflicts and 5.3b lists them, but the calendar shows none of them. An admin scanning the month cannot see that a shift has nobody to cover it. The conflict, leave and uncovered vocabulary already exists in `modifiers.ts` (classes, labels, legend), but nothing sets it. The leave hatch also fails contrast on `shift-slot-2` (UX-DR8, Q21).

**Approach:** Set the conflict and leave modifiers on calendar cells. For an admin they come from `collisionsOf` over the calendar snapshot plus the organization's leave. For a member they come from their own records only. Draw the hatch in the slot's own foreground, and use lucide icons for leave and uncovered. Nothing is stored.

## Boundaries & Constraints

**Always:**
- **Admin (human, 2026-10-01).**
  - **Sve grid.** A team/date cell gets `conflict` and `leave` when any collision has that `(teamId, date)`.
  - **Member-centric views.** This covers the person view (`?osoba`) and the admin's own Moj list. Every date covered by that member's live leave gets `leave`. This includes non-working dates (human). A cell matching a collision `(memberId, date, teamId)` also gets `conflict`.
  - **Source.** The input is built through 5.3b's `collisionInputOf` and `organizationLeaveRecordsQueryOptions`. Do not re-implement it.
- **Member (human).** The member sees no conflict marks anywhere and nothing new on the Sve grid. Their own Moj list and their own person view hatch every date covered by their live leave, read through `my_leave_records` (`MY_LEAVE_RECORDS_KEY`). The member never sees another member's leave.
- **Never hidden.** The calendar waits for both of its reads. A failed leave read shows the calendar's existing unavailable state and retry. It never shows a month without marks.
- **Drawing.**
  - Marks render through the existing `modifierTreatmentOf`, `cellLabelOf` and `legendOf`.
  - The cell's accessible label names each mark, and the legend lists each mark shown.
  - The leave and uncovered hatches are drawn in the slot's own foreground (`currentColor`), not in a fixed `modifier-*` tint.
  - The leave and uncovered marks become lucide `Clock` and `CircleDashed` (human), `aria-hidden`. `⚠` and `✎` stay text.
- **Contrast.** `test/theme-contrast.test.ts` sweeps every fill, `shift-slot-2` included, in both themes. Glyph and hatch are measured against the slot's own foreground, and the existing thresholds hold.
- **Refresh.** Leave writes already refresh `ORGANIZATION_LEAVE_RECORDS_KEY` and `MY_LEAVE_RECORDS_KEY`. Calendar writes refresh `CALENDAR_KEY`. The marks follow both without a reload.

**Ask First:**
- Any change to `packages/domain`, any migration, or any change to an existing threshold in `theme-contrast.test.ts`.

**Never:**
- No `uncovered` derivation and no marks in the day detail. Both are 5.4's work.
- No hours-surface change. That is 5.3d.
- No stored or cached conflict set.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Worked example, admin grid | leave 10.09–14.09 over `Dan, Noć, Slobodno, Slobodno, Dan` | the team's 10, 11 and 14 cells carry `⚠` + ring + hatch; 12 and 13 carry nothing; the legend shows Konflikt and Godišnji | N/A |
| Admin person view | the same member, `?osoba` | 10–14 hatched (12 and 13 too); 10, 11 and 14 also `⚠` | N/A |
| Two teams | a roster override puts the member on a second team that date | both teams' cells marked | N/A |
| Overridden + conflict | an override cell that collides | nested rings, `⚠` and `✎`, both labels | N/A |
| Member own | the member views Moj | own leave dates hatched, no `⚠` | N/A |
| Member, other's leave | a teammate is on leave | nothing shown to this member | N/A |
| Removed leave | the record is removed | marks gone after the refresh | N/A |
| Leave read fails | network error | unavailable state, retry restores the marks | no partial month |

## Epic AC Deviations

- **Met here:** "[an unresolved conflict] visible without opening a detail view, carrying `⚠` and its inset ring in the reserved hue" (UX-DR8, Q21).
- **NARROWED:** "unresolved" means every derived collision until 5.4 adds resolutions. Ledger: the "Story 5.4 collisionKeyOf filter" entry, which also covers the calendar.
- **Elsewhere, unchanged:** the queue (5.3b), the hours state (5.3d), and the day detail and the uncovered mark (5.4).

</frozen-after-approval>

## Code Map

- `apps/web/src/features/calendar/utils/month.ts`
  - `CalendarCell` (:511-529).
  - `cellOf(lookup, teamId, shiftTypeId, date, overridden)` (:720-755) only sets `NO_MODIFIERS`/`OVERRIDDEN_MODIFIERS` (:531-535). Widen it to a modifiers list.
  - Callers: `calendarMonthOf` (:902-975, call at :951) and `calendarDayListOf` (:818, call at :840).
  - Also `calendarModeOf` (:281) and `MODE_MOJ`/`MODE_SVE` (:188-194).
- `apps/web/src/features/calendar/utils/modifiers.ts`
  - Ids (:22-25) and `CALENDAR_MODIFIERS` (:52-57). `glyph: string` needs an icon form.
  - The hatch and ring classes (:94-105), `modifierTreatmentOf` (~:150), `legendOf` (~:180) and `cellLabelOf`.
- `apps/web/src/features/calendar/components/`
  - `calendar-cell.tsx:48-83`: the glyph span is at :64-66 and is already in the slot foreground.
  - `calendar-legend.tsx:9-34`, `calendar-grid.tsx:18-50,85` and `calendar-month-body.tsx:14`.
- `apps/web/src/features/calendar/hooks/use-calendar-screen.ts` -- reads the role at :104. Add the role-appropriate leave query here and gate on both reads. `features/conflicts/hooks/use-conflicts-queue.ts` and `conflicts-queue.ts:107` (`collisionInputOf`) and `:229` (two-read gating) are the precedent.
- `apps/web/src/features/leave/services/leave-list.ts` -- `organizationLeaveRecordsQueryOptions` (:438), `organizationLeaveRecordsOf` (:466), `MY_LEAVE_RECORDS_KEY` (:267-282).
- `apps/web/src/index.css`
  - `modifier-hatch-leave` (:499), `-uncovered` (:513) and `-leave-uncovered` (:527). Switch them to `color-mix(in oklch, currentColor N%, transparent)`.
  - The design comment (:445-469) and the tokens (:202-206, :274-278).
  - Slot text classes come from `SLOT_CHIP_CLASSES` (`features/shift-types/services/list.ts:383-390`).
- `test/theme-contrast.test.ts` -- the slot-2 exclusion (`OVERLAY_FILLS` :95, `GLYPH_FILLS` :107-108, comments :83-106), the glyph sweep (:619-636) and the hatch ΔE sweep (:638-667). `test/typography-coverage.test.ts:48-58,169-174` asserts ◷/◌ are uncovered; retire it or re-aim it once those glyphs are gone.
- `apps/web/src/features/calendar/calendar-screen.fixture.ts` -- `CALENDAR_SCREEN_PARTS` (:22) and `CALENDAR_SCREEN_EXEMPT` (:51). Register new files here.
- Tests:
  - Unit: `utils/modifiers.test.ts`, `utils/month.test.ts` and `conflicts-queue.test.ts` (snapshot builders).
  - e2e: `e2e/tests/calendar/calendar.spec.ts` (✎ cases :812-946, no legend :491), `e2e/pages/calendar.page.ts` (`legendOf` :253), and `e2e/tests/conflicts/conflicts-queue.spec.ts` (leave seeding).
  - Seed helpers are in `e2e/utils/database-helper.ts`.
- `_bmad-output/implementation-artifacts/deferred-work.md:44-55` -- the slot-2 and glyph entries. Mark them RESOLVED by 5.3c.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/calendar/utils/month.ts` -- widen `cellOf` to modifiers and thread a collision/leave lookup through `calendarMonthOf` and `calendarDayListOf` -- one place sets the marks.
- [x] `apps/web/src/features/calendar/utils/modifiers.ts` and `components/calendar-cell.tsx`, `calendar-legend.tsx` -- add icon glyphs for leave and uncovered (lucide `Clock`, `CircleDashed`).
- [x] `apps/web/src/features/calendar/hooks/use-calendar-screen.ts` (and services as needed) -- add the role-appropriate leave read, two-read gating and the unavailable state.
- [x] `apps/web/src/index.css` -- draw the hatches in `currentColor`.
- [x] `test/theme-contrast.test.ts`, `test/typography-coverage.test.ts` -- restore slot-2 in every sweep and re-aim the glyph-coverage test.
- [x] `apps/web/src/features/calendar/services/marks.test.ts` (new; planned as `utils/month.test.ts`), `modifiers.test.ts` -- cover every matrix row except Removed leave and Leave read fails.
- [x] `e2e/tests/calendar/calendar-conflicts.spec.ts` (new) plus page-object helpers -- the admin worked example (grid, person view, legend, cell labels), the member's own hatch with no `⚠`, removal clearing the marks, and a failed leave read with retry.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the slot-2 and glyph entries resolved.

**Acceptance Criteria:**
- Given an admin records leave on the member's page, when they open Kalendar, then the marks are there without a reload.
- Given any cell carrying a mark, when it is read by a screen reader, then its label names the mark; and no mark is conveyed by colour alone.

## Spec Change Log

- **2026-10-01, review (patch round, no loopback).**
  - The matrix coverage landed in a new `services/marks.test.ts` beside the new `services/marks.ts`, not in `month.test.ts`; the task line is updated.
  - The calendar had no retry before, so the "existing … retry" in the frozen Always line is new here. Retry is offered only for a failed or paused read, never for a deterministic refusal.
  - A no-rotation cell (`shiftTypeId === null`) carries no marks: there is no schedule to mark, and its surface is outside the contrast sweep.
  - KEEP: the two-read gating, the `currentColor` hatch at 16%, and slot-2 back in every sweep.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green, including `theme-contrast` with slot-2 swept
- `pnpm exec playwright test calendar conflicts` -- expected: green

## Suggested Review Order

**Where the marks come from**

- Entry point: admin marks from 5.3b's collision input; member marks from their own records only.
  [`marks.ts:72`](../../apps/web/src/features/calendar/services/marks.ts#L72)

- Loading, unavailable or ready; unavailable says whether a retry can help.
  [`marks.ts:112`](../../apps/web/src/features/calendar/services/marks.ts#L112)
  [`marks.ts:146`](../../apps/web/src/features/calendar/services/marks.ts#L146)

- One leave read per role, picked by `enabled`; the month waits for both reads.
  [`use-calendar-screen.ts:106`](../../apps/web/src/features/calendar/hooks/use-calendar-screen.ts#L106)

**Where the marks land**

- The one place a cell's modifiers are set.
  [`month.ts:607`](../../apps/web/src/features/calendar/utils/month.ts#L607)

- The grid marks by `(teamId, date)`; member views mark every leave date, plus their own collisions.
  [`month.ts:621`](../../apps/web/src/features/calendar/utils/month.ts#L621)
  [`month.ts:632`](../../apps/web/src/features/calendar/utils/month.ts#L632)

- A no-rotation cell stays unmarked.
  [`month.ts:828`](../../apps/web/src/features/calendar/utils/month.ts#L828)

**Drawing**

- Leave and uncovered become lucide icons; `⚠` and `✎` stay text.
  [`modifiers.ts:86`](../../apps/web/src/features/calendar/utils/modifiers.ts#L86)
  [`modifier-glyphs.tsx:11`](../../apps/web/src/features/calendar/components/modifier-glyphs.tsx#L11)

- The hatch draws in `currentColor`, which fixes `shift-slot-2`.
  [`index.css:507`](../../apps/web/src/index.css#L507)

- The retry is shown only when reading again can help.
  [`kalendar.tsx:95`](../../apps/web/src/pages/kalendar.tsx#L95)

**Tests**

- The matrix, the no-rotation gap, and the retry split.
  [`marks.test.ts`](../../apps/web/src/features/calendar/services/marks.test.ts)

- e2e: an in-app round trip proves the no-reload refresh; the member's own hatch; failure and retry.
  [`calendar-conflicts.spec.ts:109`](../../e2e/tests/calendar/calendar-conflicts.spec.ts#L109)

- Contrast sweeps include slot-2 again, measured against the slot's own foreground.
  [`theme-contrast.test.ts`](../../test/theme-contrast.test.ts)
  [`typography-coverage.test.ts`](../../test/typography-coverage.test.ts)
