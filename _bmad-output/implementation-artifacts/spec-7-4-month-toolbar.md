---
title: 'Kalendar and Sati share one month toolbar (7.4)'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: 'ca3fdc6a21e9032f2000e076528cf9e70d4590f1'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The shared `MonthNav` is a heading plus three equal buttons (‹, `Ovaj mjesec`, ›). On the current month, `Ovaj mjesec` is disabled, so it looks broken and drops focus to `<body>` when pressed (deferred-work, 4.1b review). No month can be reached except one step at a time.

**Approach:** `MonthNav` becomes one toolbar, ‹ month ▾ ›. The month name is a button that opens a 12-month grid popover with year ‹ ›. PgUp/PgDn step the month while focus is in the toolbar. On the current month, a non-interactive "ovaj mjesec" pill sits in the trigger. On any other month, an `Ovaj mjesec` button follows the group. Kalendar and Sati keep calling the one component. Mockup: `ux-designs/ux-shift-2026-10-01-redesign/mockups/filters-and-month-nav-1.html` §3 (direction A).

## Boundaries & Constraints

**Always:**
- The group is `role="group"`, named "Mjesec": ‹ (`kalendar.previous`), the trigger (`aria-haspopup="dialog"`, `aria-expanded`, accessible name "{Month} {year}, odaberi mjesec" plus the pill text), then › (`kalendar.next`). Every control is ≥ 44 px.
- The `h2` with `headingId` stays, visually hidden (`sr-only`, `tabIndex={-1}`). It still names the grid and the day list, and it is still the focus fallback for a closed day detail.
- PgUp is the previous month and PgDn is the next, handled on the group's `onKeyDown` with `preventDefault`. They do nothing at a bound, exactly like the disabled ‹ ›. Bounds stay `adjacentMonth`'s (0001-01…9999-12).
- Popover: `role="dialog"`, labelled "Odaberi mjesec". It shows the year with ‹ › for the year (disabled at 1 and 9999) and 12 month buttons with short names (`sij`…`pro`, from `Intl` `month:'short'`). The shown month is filled and `aria-current="true"`. The current month has an inset ring and a "ovaj" sub-label. It opens on the shown month's year, focused on the shown month. ←/→ move by one month and ↑/↓ by one row (4), wrapping across the year. Enter or a press picks the month. Escape and an outside press close it. On every close, focus returns to the trigger.
- Picking the shown month only closes the popover. Picking any other month calls `onShow(month)`, or `onShow(null)` when it is the current month, so the URL stays as today's rule has it.
- After `Ovaj mjesec` is pressed, focus moves to the trigger, never `<body>`.
- Changing the month keeps every other search param (`calendarSearchTo`, `hoursSearchTo`, unchanged).
- On a phone, the popover fits the viewport: `max-w-[calc(100vw-2rem)]`, left-aligned to the toolbar, with no horizontal page scroll at 320 px.
- Update EXPERIENCE.md (§Interaction Primitives month line, plus a Component Patterns "Month toolbar" entry), DESIGN.md (a Popover primitive row and the month toolbar), and UX-DR30 in `epics.md`, in the same change.

**Ask First:** Making PgUp/PgDn page-wide (outside the toolbar). Turning the popover into a bottom sheet on a phone. Touching filters or the mode switch (7.5).

**Never:** A new runtime dependency. A second month control or a per-screen fork. A user-facing literal in `components/ui/`. Swipe gestures. Changing the URL shape.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Current month | `/kalendar`, no `mjesec` | Trigger shows "Listopad 2026" + "ovaj mjesec" pill; no `Ovaj mjesec` button | N/A |
| Other month | `?mjesec=2026-07` | `Ovaj mjesec` button shown; pressing it drops `mjesec`, focus on the trigger | N/A |
| PgDn in toolbar | focus on ‹ | `mjesec` +1, focus stays on ‹ | N/A |
| PgUp at lower bound | `?mjesec=0001-01` | Nothing happens, ‹ disabled | N/A |
| Pick from popover | open, year ‹ to 2025, press `ožu` | `?mjesec=2025-03`, popover closed, focus on trigger, filters kept | N/A |
| Escape in popover | open | Closes, focus on trigger, month unchanged | N/A |
| Loading | `month === null` | Placeholder bar as today | N/A |

### Epic AC Deviations

- "symmetric and unbounded in both directions (UX-DR30)": navigation keeps the 0001-01…9999-12 calendar bounds that story 3.1 already read UX-DR30 as. ‹, › and PgUp/PgDn stop only there, the same as today. Why: `adjacentMonth` and `isCalendarMonth` define the representable months. No month in that range is slower to reach, and the popover makes far months faster.

</frozen-after-approval>

## Code Map

- `apps/web/src/components/month-nav.tsx` -- `MonthNav({month, headingId, onShow})` and `MonthNavMonth`. Rewrite it as the toolbar. It already calls `t()` (`kalendar.*`); keep that exception.
- `apps/web/src/features/navigation/hooks/dismiss.ts` -- `useDismiss(open, region, close)`, whose only user is `chrome.tsx:30,310`. Move it to `apps/web/src/hooks/dismiss.ts` (the `@/hooks` alias) so `components/` may use it.
- `apps/web/src/components/ui/dialog.tsx` -- modal-only (`showModal`). NOT reused. The new `ui/popover.tsx` is a non-modal anchored surface: `bg-popover`, `shadow-lg` (DESIGN: `sh-lg` is for Dialog, Sheet, Popover), no literals.
- `apps/web/src/lib/i18n/format.ts:86-92,388` -- `SHAPES`, `formatIsoMonthName`. Add `monthShortName: {month:'short'}` and `formatIsoMonthShortName`.
- `apps/web/src/lib/i18n/locales/hr.json:28-31` -- `kalendar.monthHeading/previous/next/current`. Add `kalendar.month` "Mjesec", `kalendar.chooseMonth` "{month} {year}, odaberi mjesec", `kalendar.monthPicker` "Odaberi mjesec", `kalendar.thisMonthLabel` "ovaj mjesec", `kalendar.thisMonthShort` "ovaj", `kalendar.previousYear` "Prethodna godina", `kalendar.nextYear` "Sljedeća godina".
- `apps/web/src/features/calendar/utils/month.ts:510-519` -- `monthHeaderOf` gives `month`, `previous`, `next`, `isCurrent`. The popover also needs the current month: add `current: monthOf(today)` to the header and to `MonthNavMonth`. Check the hours header (`features/hours/services/my-hours.ts`) builds the same shape.
- `apps/web/src/features/calendar/calendar-screen.fixture.ts:29`, `features/hours/hours-screen.fixture.ts:22` -- add any new screen file to BOTH sets. Files under `components/ui` are exempt.
- `apps/web/src/pages/prijava.test.ts` -- control counts :703-743 (Kalendar 24, Sati 8; detectors see `<Button`, `<Input />`, `<select` only). String counts :2360-2455 (Kalendar 110, Sati 30). Shared-nav set checks :3060-3105. Literal-attribute sweep :1479-1600 (`aria-label`/`aria-expanded` must be expressions). `aria-haspopup` value list :8753. Update the counts and comments to the new toolbar.
- `apps/web/src/features/calendar/utils/grid-keys.test.ts:125` -- the grid leaves `PageDown` alone; keep it that way.
- `e2e/pages/calendar.page.ts:35-50,282-293`, `e2e/pages/hours.page.ts:23-32` -- `monthHeading`, `next/previous/currentButton`, `showMonthOf`. `monthHeading()` with no name matches ANY h2, so the popover must not render an h2.
- `e2e/tests/calendar/calendar.spec.ts:228-277` (:262 `toBeDisabled` on `currentButton`, bounds :269-277), `e2e/tests/hours/hours.spec.ts:306,349`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/hooks/dismiss.ts` + `chrome.tsx` import -- move `useDismiss`, no behaviour change.
- [x] `format.ts` + its test -- `formatIsoMonthShortName`; the test pins `sij`…`pro`.
- [x] `month.ts` (+ hours header if separate) and tests -- add `current` to the header.
- [x] `apps/web/src/components/ui/popover.tsx` -- `Popover` surface (open, anchored below its relative parent, dismiss via `useDismiss`, `role="dialog"`, label passed in).
- [x] `month-nav.tsx` -- the toolbar, the popover grid with roving focus, the PgUp/PgDn handler, the pill/button rule, and focus return. Use `Button` for every control.
- [x] `hr.json` -- the new keys.
- [x] `prijava.test.ts` and the fixtures -- re-count controls and strings with updated comments. Add pins: no `disabled={month.isCurrent}`, `aria-haspopup="dialog"` on the trigger, a PageUp/PageDown handler in month-nav.
- [x] e2e page objects + `calendar.spec.ts` / `hours.spec.ts` -- replace the `toBeDisabled` checks with "label shown, no button". Add tests for PgUp/PgDn in the toolbar, picking a month in another year from the popover (filters kept), Escape returning focus, and focus on the trigger after `Ovaj mjesec`. Add a 320 px touch-target and no-scroll check with the popover open.
- [x] Binding docs -- EXPERIENCE.md, DESIGN.md, `epics.md` UX-DR30.
- [x] `deferred-work.md` -- mark the 4.1b focus-drop entry resolved by 7.4. Ledger the mockup extras not built: swipe to change month, the phone bottom-sheet variant of the picker, and the popover footer `Ovaj mjesec` link.

**Acceptance Criteria:**
- Given Kalendar or Sati, when it renders, then the month control is the ‹ month ▾ › group and the month opens the month-grid popover.
- Given focus anywhere in the toolbar, when PgUp/PgDn or ‹/› are used, then the month moves by one, the same in both directions.
- Given the current month, then "ovaj mjesec" is text with no button. Given another month, then `Ovaj mjesec` is a button that returns to the current month.
- Given the suite, when `pnpm test`, lint, typecheck and the calendar and hours e2e run, then they pass.

## Design Notes

The month grid is a roving-tabindex set of 12 `Button`s (one `tabIndex=0`), not ARIA `grid`, so no extra role semantics are needed. The arrow keys inside the popover stop propagation, so the calendar grid's keys are never reached. Keeping the `sr-only` h2 means `aria-labelledby={MONTH_HEADING_ID}` and `use-day-detail`'s focus fallback are untouched.

## Verification

**Commands:**
- `pnpm --filter ./apps/web test && pnpm exec vitest run && pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm test:e2e e2e/tests/calendar e2e/tests/hours e2e/tests/layout` -- expected: pass

**Manual checks:**
- Demo at 1440 and 390 px, both themes: open the picker, jump a year, PgUp/PgDn, return with `Ovaj mjesec`.

## Suggested Review Order

**One toolbar for both screens**

- Entry point: ‹ month ▾ › group, open state keyed to the shown month
  [`month-nav.tsx:55`](../../apps/web/src/components/month-nav.tsx#L55)

- ‹, › and PgUp/PgDn share one step; focus to the trigger at a bound
  [`month-nav.tsx:106`](../../apps/web/src/components/month-nav.tsx#L106)

- Tab out closes the picker without moving focus
  [`month-nav.tsx:143`](../../apps/web/src/components/month-nav.tsx#L143)

- Trigger: `aria-haspopup`/`aria-controls`, label on current month
  [`month-nav.tsx:169`](../../apps/web/src/components/month-nav.tsx#L169)

**The month picker**

- Roving focus over twelve months; year ‹ › keep focus inside at a bound
  [`month-nav.tsx:239`](../../apps/web/src/components/month-nav.tsx#L239)

- Key and grid arithmetic as a pure module, so screens hold no key literals
  [`month-keys.ts:37`](../../apps/web/src/utils/month-keys.ts#L37)

- New non-modal Popover primitive, unmounted when closed
  [`popover.tsx:29`](../../apps/web/src/components/ui/popover.tsx#L29)

- `useDismiss` moved to `@/hooks` so `components/` may use it
  [`dismiss.ts:8`](../../apps/web/src/hooks/dismiss.ts#L8)

**Data the toolbar reads**

- Header gains `current`, so the picker can mark today's month
  [`month.ts:517`](../../apps/web/src/features/calendar/utils/month.ts#L517)

- Short month names (`sij`…`pro`) from `Intl`
  [`format.ts:401`](../../apps/web/src/lib/i18n/format.ts#L401)

**Binding docs**

- UX-DR30 rewritten for the toolbar and the representable bounds
  [`epics.md:144`](../planning-artifacts/epics.md#L144)

- Month toolbar pattern and the month navigation primitive
  [`EXPERIENCE.md:95`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L95)

- Popover and month toolbar rows
  [`DESIGN.md:289`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L289)

**Tests**

- Rendered proof: label, PgUp/PgDn, picker, Escape, outside press, bounds, 320 px
  [`calendar.spec.ts:297`](../../e2e/tests/calendar/calendar.spec.ts#L297)

- Same toolbar on Sati
  [`hours.spec.ts:362`](../../e2e/tests/hours/hours.spec.ts#L362)

- Source pins: no disabled current button, group, sr-only heading, no page-wide listener
  [`prijava.test.ts:3125`](../../apps/web/src/pages/prijava.test.ts#L3125)
