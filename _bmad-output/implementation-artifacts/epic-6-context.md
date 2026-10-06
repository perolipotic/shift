# Epic 6 Context: Each role lands on the answer to its standing question

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

*Danas* is each role's landing surface. It answers that role's standing question before anything is tapped. A member sees whether they work today, stated in words when they do not. They also see when they next work, their hours so far and how much leave remains. An admin sees today's coverage and the count of conflicts waiting for them. That count shows even when it is zero. The epic adds no new figure, because every figure already exists. Its job is to make the dashboard and the detail views agree exactly. This is where figure consistency across surfaces is proven. The epic also carries `duty-block`, the subtlest component: one card for a 24-hour duty that the data keeps as two shifts on two dates. It builds on Epic 7's shipped foundations (7.1 dark slot tokens, 7.2 DM Sans tabular figures, 7.3 phone bar with four tabs and *Više*, 7.4 month toolbar). The reference design is `ux-designs/ux-shift-2026-10-01-redesign/mockups/danas-1.html`.

## Stories

- Story 6.1: A member opens the app and already has their answer
- Story 6.2: A 24-hour duty reads as one duty, not two unrelated shifts
- Story 6.3: An admin opens the app and sees what needs them

## Requirements & Constraints

- **The member's *Danas*** states today in words, as exactly one of four cases:
  - on shift: "Danas radiš", with type and times
  - free: "Danas ne radiš"
  - on a 24 h duty: one duty-block
  - on leave today: "Danas si na godišnjem odmoru"
  It never shows an empty area the member has to interpret.
- **The next working shift** shows its date, shift type and both clock times, and skips non-working days. When the member is on leave, the next shift is their return.
- **Hours** show band hours and the total for the current period. **Leave** shows used and remaining. **Upcoming shifts** list at least the next seven days.
- **Phone priority order:** today's shift, next shift, the 7 days (calendar), hours, leave. No horizontal scrolling at phone width.
- **The admin's *Danas*:**
  - The unresolved-conflict card (*Treba tebe*) renders first. It always shows the count, `0 neriješenih konflikata` included, and the count equals the conflict queue exactly.
  - Today's coverage per team and shift type follows, for any number of teams, then the week. Nothing may assume four teams.
  - Each summary links to its list view.
- **Every dashboard figure equals its detail view:** hours equal Sati, the leave balance equals Godišnji, and the conflict count equals the queue.
- **Loading** uses a skeleton laid out like the final screen, never a spinner.
- **Keyboard and screen readers:** both dashboards are keyboard navigable and expose meaningful labels, to the same standard as the calendar and the conflict queue. WCAG 2.1 AA is the target. No state is shown by colour alone.
- **Localization:** there is no hard-coded string. Every count uses Croatian's three plural forms ("za 1 dan / 2 dana / 5 dana"); a check for `count === 1` is a defect. Dates read `01.10.2026.`, and time ranges use an en dash, `19:00–07:00`. "Today" and every time are in the organization's timezone.

## Technical Decisions

- **One snapshot per surface.** Each dashboard loads one composite read under one query key, from `features/<module>/services/snapshot.ts`, and narrows the canonical `OrganizationSnapshot(window)` by selection. Every figure on the screen derives from it, and no two figures come from two reads. This is what guarantees that a figure equals its detail view, not a separate check.
- **Nothing derived is persisted.** No duty entity, dashboard total or count is stored. Duty grouping is presentation only, and the data stays two scheduled shifts on two dates.
- **All calculation lives in `packages/domain`:** projection, hours, leave and collisions. It is pure TS, a leaf, and returns codes and operands, never prose. The dashboard reuses the existing functions and never re-implements one. If a grouping or "next shift" rule is a calculation, it belongs in the domain, not in a component.
- **Time is integer minutes over nominal wall-clock.** Duty progress and "until 07:00" are computed for display in the organization timezone only, never for accounting.
- **No optimistic updates** for hours, leave balance or conflict state.

## UX & Interaction Patterns

- **duty-block:**
  - It groups consecutive working shifts that have no non-working interval between them into one duty.
  - The headline is the end time ("do 07:00", with the day and time remaining), not the start. Mid-duty, it headlines when the member finishes.
  - The span and total hours are metadata, under a progress bar in `primary`.
  - Each constituent shift is one leg, marked "Odrađeno" or "U tijeku" in words with an icon, never by colour alone.
  - A replacement leg names the member replaced, for example "zamjena za Leu Bašić (Smjena D)".
  - Style: a `card` background, a 1 px `border` and `rounded.lg`.
- **The leave case** uses the calendar's ◷ glyph and hatch. It states the cost in leave days and which days it counts.
- **The admin's conflict card** keeps the same shape at every count. It shows a `destructive` edge and ⚠ only when the count is above zero. At zero it is neutral and has a sentence that states what is true. It lists the earliest conflicts soonest first; a past conflict carries "prošlo". It ends with an "Otvori konflikte (N)" action. The mockup also shows "Odsutni danas" and a week grid with D/N/S letters and a legend.
- **Numbers** are DM Sans tabular figures, never Syne. Use the `StatCard` and `StatTile` patterns for summary figures.
- **Voice:** state the fact, not the absence. Use numbers, not adjectives, no exclamation marks, and the informal second person.

## Cross-Story Dependencies

- 6.1's 24 h duty case renders 6.2's duty-block, so build 6.2's grouping before or alongside it.
- 6.3's count must match Epic 5's conflict queue, which is derived through `domain/collisions` and the stored resolutions. Hours must match Epic 4's Sati, and leave must match Epic 5's Godišnji.
- Epic 7 foundations 7.1–7.4 are done. Stories 7.5–7.18 follow this epic, so do not pull their changes forward.
