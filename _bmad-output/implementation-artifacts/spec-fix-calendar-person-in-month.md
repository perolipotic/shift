---
title: 'The calendar person filter offers everyone active in the month shown, so a Sati name always opens that member'
type: 'bugfix'
created: '2026-10-01'
status: 'done'
baseline_commit: 'abe40f42864792b36a2fd08d593fecf3fe6d894e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-retro-2026-10-01.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On Sati (4.2), every member's name links to `/kalendar?prikaz=sve&osoba=<id>&mjesec=<m>`. Sati has a row for everyone active on at least one date of the month. The calendar accepts `osoba` only for members active **today** (3.3b), so for anyone deactivated since, the link opens the whole-organization grid instead of that member. "Explain any figure" breaks for exactly the people who left (Epic 4 retro, finding C1).

**Approach:** Change the calendar's people rule from "active today" to "active on at least one date of the month shown", the same membership rule as a Sati row. The human decided this on 2026-10-01. The filter's options and `chosenPersonOf` both read the new list, so a Sati link and the Select always agree.

## Boundaries & Constraints

**Always:**
- One rule. The people list is computed in `calendarMonthOf` from the snapshot's status versions with the domain's `activeOn`, over `datesOfMonth` of the month shown.
- The snapshot's name order is kept.
- A person still wins over a team (3.3b).
- An `osoba` that names no one active in the month shown is still "no person", the harmless direction. It is kept in the URL as today.
- The person's day list draws inactive dates as "no team", which the existing day-list rule already does.
- E2E follows `e2e/README.md`: locators live in page objects, there is no `waitForTimeout`, and every test seeds its own data.

**Ask First:**
- Any change to the snapshot read, an RPC, RLS or a migration.
- Marking former members differently in the Select (a label or a separate group).

**Never:**
- No change to Sati's row rule or its link.
- No change to the team filter.
- No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Left this month | retired from 2026-09-10, today 2026-09-25, month 2026-09 | listed in `filter.people`; `osoba=<id>` shows their day list | N/A |
| Left before the month | same member, month 2026-10 | not listed; `osoba=<id>` is no person, whole grid | N/A |
| Joins later in the month | first active 2026-09-16, month 2026-09 | listed | N/A |
| Inactive all month, active later | month 2026-08, active from 2026-09-01 only | not listed | N/A |
| Kept across months | person chosen, next month they are inactive throughout | whole grid; URL keeps `osoba` | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/calendar/utils/month.ts:919-925` -- `calendarMonthOf` builds `people` with `activeOn(member.statuses, today)`, plus the comment about 3.3b's `calendar_people()`. This is the one line to change: use active on any of `datesOfMonth(month)`. `month` is already computed at the top via `monthShownOf`.
- `apps/web/src/features/calendar/utils/month.ts:877-886` -- `chosenPersonOf` and its doc ("the members active today"). The logic is unchanged; update the doc.
- `apps/web/src/features/hours/services/organization-hours.ts:150-182` -- Sati's row rule (`lastActiveDateOf` over `datesOfMonth`) and `calendarLinkSearchOf` (`:147-149`). Read-only. They are the reference the new rule must match.
- `packages/domain/src/roster.ts:109` (`activeOn`) and `packages/domain/src/schedule.ts:103` (`datesOfMonth`) -- reuse both and add nothing to the domain.
- `apps/web/src/features/calendar/utils/month.test.ts:1185-1240` -- the `withStatuses` fixture (RETIRED from 2026-09-10, LATER joins 2026-09-16, RETURNED inactive 09-01 to 09-19, TODAY in 2026-09). The test "offers only the members active on the organization today" (`:1229`) pins the old rule and becomes the month rule. `:1128-1132` checks `chosenPersonOf` against the offered list.
- `apps/web/src/features/calendar/components/calendar-filter.tsx:71-75` -- it renders `filter.people` and needs no change.
- `e2e/tests/calendar/calendar.spec.ts:1709+` (person filter at 1280 px) and `e2e/tests/hours/hours.spec.ts:407-411` (the Sati name link, currently with an active member). Page objects are in `e2e/pages/calendar.page.ts` and `e2e/pages/hours.page.ts`. Look in `e2e/utils/database-helper.ts` for a status-version seeding helper; if one is missing, add it there.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/calendar/utils/month.ts` -- `people` = members active on at least one date of the month shown. Rewrite the comment and the `chosenPersonOf` doc to the month rule -- one rule for the Select and the link.
- [x] `apps/web/src/features/calendar/utils/month.test.ts` -- replace the "active today" test with the matrix rows: left this month, left before, joins later, inactive all month, and kept across months through `calendarMonthOf` with a different `mjesec` -- pins the new rule.
- [x] `e2e/tests/hours/hours.spec.ts` (plus `e2e/utils/database-helper.ts` if needed) -- seed a member who was active earlier in the shown month and is deactivated since. From Sati, follow their name and expect the calendar person heading and day list for that member -- the end-to-end proof of C1.

**Acceptance Criteria:**
- Given a member deactivated after the start of the shown month, when an admin clicks their name on Sati, then the calendar opens on that month showing that member's heading and day list, not the whole grid.
- Given the calendar on any month, when the person filter opens, then it lists exactly the members that Sati's table would list for that month (allowing for Sati's extra "has a shift" clause, which cannot add anyone, because a shift requires an active date).

## Design Notes

Sati also includes "any member with a shift in the month". Every shift comes from a membership, and a roster override only puts on members who are active on that date (3.6b), so a member with a shift is always active on some date of the month. The active-in-month rule alone therefore covers every Sati row.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green
- `pnpm exec playwright test e2e/tests/calendar e2e/tests/hours` -- expected: all pass

## Suggested Review Order

**The people rule**

- Entry point: people are members active on any date of the month shown.
  [`month.ts:928`](../../apps/web/src/features/calendar/utils/month.ts#L928)

- The choice still reads that list, so the Select and a Sati link agree.
  [`month.ts:884`](../../apps/web/src/features/calendar/utils/month.ts#L884)

**Drift guard**

- Sati rows and calendar people compared on two fixtures across three months.
  [`organization-hours.test.ts:306`](../../apps/web/src/features/hours/services/organization-hours.test.ts#L306)

**End to end**

- A former member's Sati name opens their calendar month, with team-labelled days.
  [`hours.spec.ts:424`](../../e2e/tests/hours/hours.spec.ts#L424)

- Seeds a past-dated member over SQL, guarded, and states what it bypasses.
  [`database-helper.ts:141`](../../e2e/utils/database-helper.ts#L141)

- Cleanup refuses any member without the seeded username prefix.
  [`database-helper.ts:197`](../../e2e/utils/database-helper.ts#L197)

**Peripherals**

- Matrix rows, all failing under the old rule.
  [`month.test.ts:1285`](../../apps/web/src/features/calendar/utils/month.test.ts#L1285)

- Day buttons labelled with a team, for the e2e check.
  [`calendar.page.ts:571`](../../e2e/pages/calendar.page.ts#L571)

- The member recipe moved to the shared helper unchanged.
  [`database-helper.ts:55`](../../e2e/utils/database-helper.ts#L55)
