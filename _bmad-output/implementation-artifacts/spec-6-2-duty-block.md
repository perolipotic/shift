---
title: 'Danas reads a 24 h duty as one duty-block (6.2)'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: 'e23920abec270a0e9a957dd9c79727aeda37843f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two working shifts that touch, such as a taken-over Dan 07:00–19:00 followed by one's own Noć 19:00–07:00, show on Danas as two unrelated rows under "Danas radiš". The member cannot see when they finish or how far along they are. An evening duty that started yesterday reads as "Danas ne radiš" after midnight.

**Approach:**
- A pure domain rule groups touching working shifts into duties and places `now` within a duty.
- Danas gets a fourth today case, `duty`, rendered as one duty-block: the end time as the headline, a progress bar, and one leg per shift.
- The data stays unchanged: two scheduled shifts on their own dates.

## Boundaries & Constraints

**Always:**
- **Grouping** (`packages/domain/src/duty.ts`):
  - A leg is `(date, startMinute, durationMinutes)` over nominal wall-clock time. Its absolute start is `civilDayNumber(date)·1440 + startMinute`.
  - Legs sorted by start join one duty when a leg's start EQUALS the previous leg's end. Overlapping or gapped legs never join.
  - A duty has ≥2 legs, a start, an end and a total in minutes.
  - `dutyProgressOf(duty, nowMinute)` gives:
    - the phase `upcoming | running | done`;
    - elapsed and remaining minutes;
    - each leg's state `upcoming | running | done`.
  - Codes and numbers only. Pure, and re-exported from `index.ts`.
- **Today's duty** (`features/today/services`):
  - The candidates are the viewer's working shifts from Kalendar's day list (`dayLookupOf`). Legs on dates the viewer's own leave covers are excluded.
  - The window is today−1…today+1, extended day by day while a duty touches the window's edge, at most 7 days each way.
  - Today's duty is the duty running at `now`. When none is running, it is the earliest upcoming duty with a leg dated today, and only then the earliest done one.
  - Precedence: leave > duty > working > free. A duty running at `now` whose legs are all dated yesterday is still today's case.
  - The next shift skips every leg of today's duty.
- **Leg notes:**
  - own team: "tvoja smjena · ‹tim›";
  - via a roster override with `memberOutId`: "zamjena za ‹ime› (‹tim›)", with the name in the nominative form from `snapshot.members`;
  - via an override without `memberOutId`: "dodatna smjena · ‹tim›".
- **Duty-block:**
  - The h2 kicker is "Na dužnosti · ‹ukupno› bez pauze".
  - The headline is "do ‹HH:MM›" while upcoming or running, and "Završeno u ‹HH:MM›" when done.
  - The end line:
    - running: "‹dan u tjednu›, ‹dd.mm.› · još ‹trajanje›";
    - upcoming: "‹dan u tjednu›, ‹dd.mm.› · počinje u ‹HH:MM›";
    - done: no end line.
  - A `role="progressbar"` in `primary` with `aria-valuetext` "‹odrađeno› od ‹ukupno›". Under it: the start "‹dd.mm.› ‹HH:MM›", that same text, and the end.
  - Each leg shows its state in words with a lucide icon: Odrađeno, U tijeku or Slijedi. It also shows the type name, the range and the note.
  - The card has a `card` background, a 1 px `border` and `rounded.lg`. Figures use `tabular-nums`. No state is shown by colour alone.
- **Time:**
  - `now` is the organization zone's wall clock, from a new `format.ts` helper. All `Intl` stays in `format.ts`.
  - Danas re-derives every minute through a ticker in `use-today.ts`.
  - Durations format through `durationValuesOf`/`durationMessageKey`.
- Copy lives only in `hr.json` under `danas.duty.*`, registered in the hygiene and string tests. No `count === 1` check. Nothing scrolls sideways at 390 px.

**Ask First:**
- Any migration, RLS change, new query key or read.
- Any change to Kalendar, Sati, or existing domain functions' behavior.

**Never:**
- Storing a duty or any derived figure.
- Grouping in the 7-day list or the next-shift card.
- The admin's Danas (6.3).
- A spinner.
- Re-implementing projection outside `memberScheduleOfMonth`/`calendarDayListOf`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Running | Dan✎ 07–19 + own Noć 19–07, both 01.10., now 01.10. 21:10 | "do 07:00", "petak, 02.10. · još 9 h 50 min", 14 h 10 min od 24 h; Dan Odrađeno, Noć U tijeku | N/A |
| Past midnight | same duty, now 02.10. 03:00, 02.10. free | duty case, not "Danas ne radiš" | N/A |
| Upcoming | same duty, now 01.10. 06:00 | "do 07:00", "počinje u 07:00", 0 %, both Slijedi | N/A |
| Done | Noć 30.09. + Dan 01.10., now 01.10. 20:00 | "Završeno u 19:00", 100 %, both Odrađeno | N/A |
| Gap | Dan 07–19, Noć 20–08 | not joined; working case, two rows | N/A |
| Overlap | two Dan 07–19 same date | not joined; working case | N/A |
| Single overnight | own Noć only | working case as in 6.1a | N/A |
| Added leg | override with no `memberOutId` | "dodatna smjena · ‹tim›" | N/A |
| Leave | leave today | leave case wins | N/A |
| Next shift | Noć 01.10. + Dan 02.10., today 01.10. | next skips Dan 02.10. | N/A |
| Bad version | a type's version breaks a precondition | unavailable state | RangeError → logged |

## Epic AC Deviations

- **"consecutive working shifts … When the member dashboard renders Then they are presented as one duty"**: NARROWED to the today card. The 7 days stay equal to Kalendar's day list (6.1a), and the next-shift card stays one shift. The human decided this on 2026-10-06. It is recorded in `deferred-work.md`.
- **"one leg per constituent shift marked done or in progress"**: EXTENDED. "Slijedi" covers a duty that has not started, and "Završeno u ‹HH:MM›" covers one that has ended. The human decided this on 2026-10-06.
- **"the name of the member replaced"**: REINTERPRETED to the nominative name ("zamjena za Lea Bašić"), because names cannot be declined. This matches the existing "Zamjena za {ime}". The human decided this on 2026-10-06.
- **"consecutive working shifts with no non-working interval between them"**: NARROWED. Only legs that touch exactly join. A leg that overlaps another never joins a duty, because an overlap is a roster defect, not one stretch. The human decided this on 2026-10-06.
- **Mockup span ends "čet 07:00"**: NARROWED to "01.10. 07:00". No short-weekday shape exists, and the date is unambiguous.

</frozen-after-approval>

## Code Map

- `packages/domain/src/calendar.ts:38,57` -- `civilDayNumber`, `dateOfCivilDay` (internal; usable inside domain). `bands.ts` `MINUTES_PER_DAY`; `duration.ts:81,105` `deriveShiftTimes`, `shiftTypeVersionOn`.
- `packages/domain/src/index.ts` -- one named-export block per module; add `./duty.js`. `test/purity.test.ts` allows relative imports only; tests in `test/duty.test.ts` with `test/fixtures.ts`.
- `apps/web/src/lib/i18n/format.ts` -- `organizationIsoDate` :227, `formatTime` :343, `SHAPES` :86–93, `formatMinuteOfDay` :65. Add a zone wall-clock helper `{date, minute}` here (format.test asserts Intl stays here).
- `features/today/services/today.ts` -- `TodayCase` :73, `todayViewOf`, `dayLookupOf`, `todayCaseOf` :344–392, `nextShiftOf`, `todayCaseMessageKey`. `CalendarDayShift {teamId, cell, viaOverride}` (`calendar/utils/month.ts:764`). Leg minutes: `snapshot.types[].versions` via `shiftTypeVersionOn` + `deriveShiftTimes` (as `typeRangeOn` :932). Replaced member: `snapshot.rosterOverrides` (teamId, date, `memberInId === viewer`) → `snapshot.members[].name`.
- `features/hour-bands/services/list.ts:~263` -- `durationValuesOf`, `durationMessageKey` (keys `organization.hourBands.duration.*`).
- `features/today/hooks/use-today.ts:98–110` -- memo of `todayOf`; add a minute ticker (no clock hook exists; `setInterval` 60 s, cleared on unmount) feeding `now` and the memo deps.
- `features/today/components/today-card.tsx` -- renders per case; add the duty branch via a new `duty-block.tsx`. lucide icons (`CircleCheck` exists in `ui/notice.tsx`). No Progress component in `components/ui`.
- Registrations:
  - `features/today/today-screen.fixture.ts`: `TODAY_SCREEN_PARTS` for new components, and `TODAY_SCREEN_EXEMPT` for a new non-rendering service.
  - `pages/prijava.test.ts`:
    - :722 (controls stay 1);
    - :2166–2194 (string counts);
    - :2000, :3052 (`KEY_SOURCES` length);
    - :3224–3244 (file set).
  - `test/resource-hygiene.test.ts:1480–1509`: `SANCTIONED_SCREEN_KEYS`. The vocabulary rule at :1580 refuses "tip … smjen…".
  - `hr.json` `danas.*` (:27).
- e2e:
  - `e2e/tests/today/today.spec.ts`: `seeded()` :71 and `holdRotation`.
  - `e2e/utils/database-helper.ts`:
    - `seedTeamRotation` :824 (pattern Dan, Noć, Slobodno, Slobodno; `daysBefore` 0 = Dan today, 1 = Noć today);
    - `seedExtraTeam`;
    - `seedRosterOverride` :1034 and `removeRosterOverridesInSql` :1113, with the cross-team pattern in `calendar.spec.ts:1255–1290`.
  - `page.clock` precedent: `layout/phone-navigation.spec.ts:357`.
  - `e2e/pages/today.page.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/duty.ts`, `index.ts`, `test/duty.test.ts` -- grouping and progress; the Gap, Overlap and Single rows plus the phase boundaries (exactly at the start and at the end).
- [x] `apps/web/src/lib/i18n/format.ts` (+test) -- the zone wall-clock helper.
- [x] `features/today/services/today.ts` (+ a `today-duty.ts` if it grows; +tests) -- `CASE_DUTY`, the window, leg notes, the next-shift skip, and every matrix row.
- [x] `features/today/hooks/use-today.ts` -- minute ticker and `now`.
- [x] `features/today/components/duty-block.tsx`, `today-card.tsx` -- rendering.
- [x] `hr.json`, `resource-hygiene.test.ts`, `prijava.test.ts`, `today-screen.fixture.ts` -- registrations and re-derived pins.
- [x] `e2e/pages/today.page.ts`, `e2e/tests/today/today.spec.ts` -- with own team on Dan today, plus a second team on Noć today with the viewer replacing one of its members:
  - with `page.clock` at today 21:10 in the organization zone: the duty-block shows "do 07:00", Dan Odrađeno, Noć U tijeku with "zamjena za …", and the progress bar's valuetext;
  - Kalendar still shows two shifts that date;
  - 390 px has no horizontal scroll.

**Acceptance Criteria:**
- Given a running duty, when Danas opens, then the headline is the end time and stays correct as minutes pass without a reload.
- Given the same duty, when Kalendar or the database is inspected, then there are two scheduled shifts on their own dates and no stored duty.
- Given a screen reader, when the duty-block is read, then its heading, the progress valuetext and each leg's state are announced in words.

## Spec Change Log

- 2026-10-06, review (iteration 0, human-approved):
  - **Finding:** when no duty runs, the rule picked the earliest duty with a leg today even if it was done, which hid a later upcoming duty.
    **Amended:** the frozen rule now prefers an upcoming duty, then a done one.
  - **Finding:** the Epic AC Auditor found the overlap narrowing unlisted.
    **Amended:** it is now listed under Epic AC Deviations.
  - **KEEP:** everything else as implemented. Code was not reverted; the fix is a patch.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green
- `pnpm exec playwright test e2e/tests/today e2e/tests/calendar e2e/tests/layout` -- expected: all pass

## Suggested Review Order

**The grouping rule (domain)**

- Entry point: legs join only when one starts exactly where the last ends.
  [`duty.ts:141`](../../packages/domain/src/duty.ts#L141)

- A duty's phase and each leg's state at a nominal wall-clock minute.
  [`duty.ts:209`](../../packages/domain/src/duty.ts#L209)

- Date plus minute ↔ absolute nominal minute, the one time axis.
  [`duty.ts:86`](../../packages/domain/src/duty.ts#L86)

**Today's duty (view model)**

- Window widening, leave exclusion and running > upcoming > done selection.
  [`today-duty.ts:255`](../../apps/web/src/features/today/services/today-duty.ts#L255)

- The selection rule the human amended in review.
  [`today-duty.ts:306`](../../apps/web/src/features/today/services/today-duty.ts#L306)

- Candidate legs from Kalendar's day list; leave-covered dates give none.
  [`today-duty.ts:161`](../../apps/web/src/features/today/services/today-duty.ts#L161)

- Own, replacement or added note; a missing name falls back to added.
  [`today-duty.ts:217`](../../apps/web/src/features/today/services/today-duty.ts#L217)

- Leave > duty > working > free.
  [`today.ts:218`](../../apps/web/src/features/today/services/today.ts#L218)

- The next shift skips every leg of today's duty.
  [`today.ts:446`](../../apps/web/src/features/today/services/today.ts#L446)

**Time**

- The organization zone's wall clock; Intl stays in format.ts.
  [`format.ts:254`](../../apps/web/src/lib/i18n/format.ts#L254)

- Minute-aligned ticker, refreshed when the tab becomes visible.
  [`minute-ticker.ts:18`](../../apps/web/src/hooks/minute-ticker.ts#L18)

- Danas re-derives on each tick.
  [`use-today.ts:69`](../../apps/web/src/features/today/hooks/use-today.ts#L69)

**Rendering**

- Kicker, end-time headline, end line, progressbar and legs in words.
  [`duty-block.tsx:71`](../../apps/web/src/features/today/components/duty-block.tsx#L71)

- Upcoming reads the start's date; running reads the end's.
  [`today-duty.ts:346`](../../apps/web/src/features/today/services/today-duty.ts#L346)

- The today card hands the duty case over.
  [`today-card.tsx:63`](../../apps/web/src/features/today/components/today-card.tsx#L63)

**Peripherals**

- Domain tests: touch, gap, overlap (three legs), phase boundaries.
  [`duty.test.ts:48`](../../packages/domain/test/duty.test.ts#L48)

- Every matrix row, widening, selection and leave exclusion.
  [`today.test.ts:519`](../../apps/web/src/features/today/services/today.test.ts#L519)

- E2E: running at 21:10 (ticks without reload), upcoming at 06:00, Kalendar keeps two shifts.
  [`today.spec.ts:422`](../../e2e/tests/today/today.spec.ts#L422)

- New copy.
  [`hr.json:36`](../../apps/web/src/lib/i18n/locales/hr.json#L36)
