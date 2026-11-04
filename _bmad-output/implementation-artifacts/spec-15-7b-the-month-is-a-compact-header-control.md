---
title: 'The month is a compact header control (15.7b)'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: 'c0180d0875abb08b252c8c3fb46e71a81a2ba7f7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On *Kalendar* and *Sati* the month control is a toolbar inside the screen's Card, with an `ovaj mjesec` Badge inside the trigger on the current month and a separate outline `Ovaj mjesec` button off it, which the PO finds heavy next to the glass header (epic 15.7 AC 3, split to 15.7b on 2026-11-03).

**Approach:** `MonthNav` becomes exactly ‹ month ›: 44 px icon buttons around the month-name button that opens the unchanged picker; the Badge and the separate `Ovaj mjesec` button go, and the way back is the picker footer's `Ovaj mjesec`. From 640 px the control sits in the `PageHeader` row beside the `<h1>` (right end); below 640 px it stays in the Card's sticky glass head. It is rendered once, its slot chosen by `usePhone()`.

## Boundaries & Constraints

**Always:** Keep every month behaviour of 7.4 / E792 / E795: group "Mjesec", PgUp/PgDn within it, bounds moving focus to the trigger, the picker (year ‹ ›, 4×3 grid, ← → ↑ ↓ Enter, footer keys hint and `Ovaj mjesec`, Popover from 640 px, bottom `SheetDialog` below, crossing 640 px closes it), the visually hidden `<h2 id={headingId}>`, the `month === null` placeholder. The trigger's accessible name keeps `, ovaj mjesec` on the current month; the picker's `ovaj` under today's month stays. Kalendar's mode switch stays in the Card's top row from 640 px and in the sticky head with the month below it. `StickyHead`'s mechanics (in-Card stickiness, `nextElementSibling` measurement, `--sticky-head`, summary line) are untouched. The control shows in exactly the states it shows today (Kalendar: no refusal; Sati: `navShown`). Targets ≥ 44 px; no sideways scroll at 320 px. Docs ship with the code.

**Ask First:** Moving the mode switch; changing `StickyHead`, the picker, the URL or any copy key.

**Never:** Two `MonthNav` instances at once (duplicate ids, heading and state). The phone page header as a sticky head. A glass utility named in a screen. New i18n keys or a new dependency. Rebase or force push.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Current month, ≥ 640 | Kalendar / Sati, no `mjesec` | header row: h1 left, ‹ [month ▾] › right; no Badge, no `Ovaj mjesec` button; trigger named `…, ovaj mjesec` | N/A |
| Other month | `?mjesec=2026-07` | same control, no `Ovaj mjesec` outside the picker; trigger → footer `Ovaj mjesec` drops `mjesec`, keeps other params, focus to trigger | N/A |
| Phone | 390 / 320 px | control in `[data-sticky-head]` (Kalendar with the mode switch), head ≤ 160 px, fits 320 px | N/A |
| Loading | `month === null` | placeholder bar in the same slot | N/A |
| Kalendar refusal | read failed | no month control (as today), alert + retry | as today |
| Sati, ≥ 640 | any branch | Card carries no empty toolbar row/head | N/A |

## Epic AC Deviations

- "it is a compact header control beside the page title" — **NARROWED** to ≥ 640 px; below 640 px it stays in the Card's sticky glass head so the phone head keeps working (PO choice 2A, 2026-11-03).
- "The current month's `Ovaj mjesec` Badge is removed (… planning confirms it)" — confirmed by the PO 2026-11-03; the off-month `Ovaj mjesec` button is removed too (PO choice 1a).
- "Returning to the current month stays one action, in the month picker" — **REINTERPRETED**: it is the picker footer's one `Ovaj mjesec`, reached by opening the picker (PO choice 1a).

</frozen-after-approval>

## Code Map

- `apps/web/src/components/month-nav.tsx` -- `MonthNav`: trigger 197–217 (Badge 214, phone `flex-col` label span 212, `sm:min-w-44` 201), aria-label 205 (keep), off-month button 250–262 (remove; `focusTrigger` still used by `step`/`close`), `Badge` import 4 (drop). Doc comment 43–62 to rewrite. `MonthPicker` untouched.
- `apps/web/src/pages/kalendar.tsx:134–163` -- `PageHeader` (h1 only) and the `StickyHead` row holding `MonthNav` + `CalendarModeSwitch`; doc comment 54–67.
- `apps/web/src/pages/sati.tsx:69–97` -- `PageHeader`; `toolbar` prop into `HoursBody`.
- `apps/web/src/features/hours/components/hours-body.tsx:65–149` -- wraps `toolbar` in `StickyHead` in all four branches; make it skip the head when `toolbar` is `null`.
- `apps/web/src/components/ui/page-header.tsx` -- flex row `sm:justify-between`; second child lands at the right end. Read-only.
- `apps/web/src/hooks/viewport.ts:13` -- `usePhone()` (sync `useSyncExternalStore`, no flash).
- `apps/web/src/index.css:548,922` -- `--sticky-head` consumers; unset when no head is mounted. Read-only.
- Pins: `pages/screens-sweep.test.ts:558–590` (`/\{month\.isCurrent \? null : \(\s*<Button/` must invert to "no off-month button"); `pages/source-guards.fixture.ts:974–1023` (Kalendar 35→34, Sati 24→23 buttons, with comments).
- i18n: `kalendar.current` (footer) and `kalendar.thisMonthLabel` (aria-label) stay used; `test/resource-hygiene.test.ts:1140–1148` unchanged.
- e2e: `e2e/pages/calendar.page.ts:45–62`, `e2e/pages/hours.page.ts:65–77` (`currentButton`, `thisMonthLabel` go; add a "no `Ovaj mjesec` outside the picker" locator and a header-slot check); `e2e/tests/calendar/calendar.spec.ts:261–266,299–311,375–402,475–493`; `e2e/tests/hours/hours.spec.ts:367–369,440–450`; `e2e/tests/calendar/layout.spec.ts:445–561` (phone head, should pass unchanged).
- Docs: `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md:359` (*month toolbar*, `updated:` line 5), `EXPERIENCE.md:100` (and 101/155 wording "under the month toolbar"), `_bmad-output/planning-artifacts/epics.md:153` (UX-DR30), `_bmad-output/implementation-artifacts/deferred-work.md:1223` (mark RESOLVED).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/month-nav.tsx` -- drop the Badge and the phone label stack (trigger: bold month name + caret, a stable min width from 640 px), drop the off-month `Ovaj mjesec` button; rewrite the doc comment -- ‹ month › only.
- [x] `apps/web/src/pages/kalendar.tsx` -- `usePhone()`; one `MonthNav` element placed in `PageHeader` from 640 px, in the `StickyHead` row below it; the mode switch stays in the row; update the doc comment -- header control at desktop, phone head kept.
- [x] `apps/web/src/pages/sati.tsx`, `features/hours/components/hours-body.tsx` -- same slot choice; `toolbar` is `null` from 640 px and `HoursBody` then draws no `StickyHead` -- no empty head on desktop.
- [x] `apps/web/src/pages/screens-sweep.test.ts`, `pages/source-guards.fixture.ts` -- pin: no Badge import and no off-month button in `month-nav.tsx`, `aria-label` still adds `thisMonthLabel`, both pages choose the slot by `usePhone`; button counts −1 -- the structure stays pinned.
- [x] e2e page objects and specs in the Code Map -- returning goes trigger → `pickerCurrent`; current month asserted by the trigger's name; ≥ 640 the group is inside the page header (same row as the h1) and outside the Card; at 390 inside `[data-sticky-head]`; 320 px fit and targets kept.
- [x] Docs -- DESIGN.md *month toolbar* rewritten and `updated:` bumped; EXPERIENCE.md month toolbar (and its cross-references); epics.md UX-DR30 rewritten, not appended; deferred-work 15.7b entry prefixed `RESOLVED by 15.7b (2026-11-03) — `.

**Acceptance Criteria:**
- Given Kalendar and Sati at 1280 px in both themes, when they render, then the month control sits at the right of the title row and matches the I/O matrix, and the Card starts with the mode switch row (Kalendar) or the content (Sati).
- Given 390 and 320 px, when the month scrolls, then the sticky head holds the control (and Kalendar's mode switch), stays ≤ 160 px and repeats the filters as today.
- Given the keyboard only, when stepping, picking and returning to the current month, then focus never lands on `body`.
- Given the change, then lint, typecheck, unit, the root suite (after build) and the touched e2e are green.

## Spec Change Log

- **Verification (2026-11-04, epic 15 retro S7):** the local e2e run against a temporary Vite on port 5174 looped for about 10 hours and was stopped. CI was the e2e gate, with the product owner's approval, and PR #262 went green there; an admin e2e at 1280 px was added for the Card with no empty head.

## Design Notes

**Resizing across 640 px** remounts `MonthNav` in the other slot, so focus on it is lost and an open picker closes, as crossing already closes it today. Accepted: it needs a live resize with focus on the control, and a portal to keep one mount would cost more than it saves.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && pnpm typecheck && pnpm test` -- expected: green.
- `PATH=… pnpm --filter ./apps/web build` then the root vitest suite -- expected: green.
- Touched e2e specs against a temporary Vite on port 5174 (shared stack, no reset) -- expected: green.

**Manual checks:**
- Screenshots at 390 and 1280, both themes, Kalendar and Sati, current and another month, picker open.

## Suggested Review Order

**One control, one slot**

- Entry point: one `monthNav` element, placed by `usePhone()`.
  [`kalendar.tsx:121`](../../apps/web/src/pages/kalendar.tsx#L121)

- From 640 px it sits in the page header beside the `<h1>`.
  [`kalendar.tsx:148`](../../apps/web/src/pages/kalendar.tsx#L148)

- No empty head row opens the Card while the mode is unknown.
  [`kalendar.tsx:171`](../../apps/web/src/pages/kalendar.tsx#L171)

- Sati: same slot choice; the toolbar is `null` from 640 px.
  [`sati.tsx:87`](../../apps/web/src/pages/sati.tsx#L87)

- `HoursBody` draws no `StickyHead` without a toolbar.
  [`hours-body.tsx:98`](../../apps/web/src/features/hours/components/hours-body.tsx#L98)

**‹ month › only**

- The Badge and the off-month button are gone; the doc comment says so.
  [`month-nav.tsx:68`](../../apps/web/src/components/month-nav.tsx#L68)

- The trigger's name still says ", ovaj mjesec" for screen readers.
  [`month-nav.tsx:210`](../../apps/web/src/components/month-nav.tsx#L210)

**Docs**

- month toolbar row rewritten for 15.7b.
  [`DESIGN.md:359`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L359)

- Month toolbar behaviour, the way back through the picker.
  [`EXPERIENCE.md:100`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L100)

- UX-DR30 rewritten in place.
  [`epics.md:153`](../planning-artifacts/epics.md#L153)

**Tests**

- Source pins: no Badge, no off-month button, slot by `usePhone`.
  [`screens-sweep.test.ts:558`](../../apps/web/src/pages/screens-sweep.test.ts#L558)

- e2e: back to the current month through the picker footer.
  [`calendar.spec.ts:261`](../../e2e/tests/calendar/calendar.spec.ts#L261)

- e2e: the admin organization table has no head from 640 px.
  [`hours.spec.ts`](../../e2e/tests/hours/hours.spec.ts)
