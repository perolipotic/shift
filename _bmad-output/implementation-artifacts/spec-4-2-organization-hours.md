---
title: 'Organization hours: every member''s month on Sati, for an admin (4.2)'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_commit: '25a61606c50ad0179ffeda41fe9bb5346a0d1bf4'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1b-my-hours-screen.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An admin on `Sati` sees only their own hours. They cannot close the month: they need every member's counts, band hours, total and leave, and a way to explain a surprising figure.

**Approach:** On `/sati`, an admin sees a table of every member, and a member keeps 4.1b's own view. Each row is `memberHoursOfMonth` run for that member over the same calendar snapshot. The table can be sorted, filtered by team and person, and a member's name links to their calendar month, which already shows the roster changes that explain the figure.

## Boundaries & Constraints

**Always:**
- One read: the existing `CALENDAR_KEY` snapshot. Role comes from `snapshot.viewer.role === 'admin'`. A member-role viewer sees exactly 4.1b's screen.
- Rows: every member active on at least one date of the month, plus any member with `shiftCount > 0`. The team is the membership in force on the member's last active date in the month (`membershipOn`). With none, show `—`. The same team decides the team filter.
- Columns: Member, Team, shift count, one per band (in band order, the name as stored; cell = hours and that band's shift count), Total, Leave (`0 h` until Epic 5).
- URL state, validated in `hoursSearchOf`: `mjesec`, `tim`, `osoba`, `sort` (`ime|tim|smjene|ukupno|dopust|pojas-<bandId>`), `smjer` (`uzlazno|silazno`). An invalid value, or an id the snapshot does not name, is dropped. The default is `ime` ascending. Team and person filters combine (AND).
- Sorting: pressing a new column sorts it ascending, and pressing it again flips the direction. Names and teams compare with `compareText`. Ties break by name, then id. `aria-sort` is on the sorted header.
- The person filter offers the members in the table. The team filter offers the teams that appear in a row. Both are native `Select`s, and "all" is an option.
- The member name links to `/kalendar?prikaz=sve&osoba=<id>&mjesec=<month>`.
- If any row's computation throws `RangeError`, the whole table is refused with `sati.error.unavailable`. No partial table is ever shown.
- Untimed shifts: when the untimed shifts of the shown rows add up to more than zero, one note under the table gives that sum (the `sati.untimed` plural).
- Formatting reuses 4.1b's `durationValuesOf`/`durationMessageKey` path. Figures use `tabular-nums`. The table scrolls horizontally inside its own container. Skeleton while loading, no spinner, no optimistic figure. Keys go under `sati.organization.*`, with no literals.
- Every rule lives in node-tested `.ts` (AD-15). Components and hooks only wire. No hour arithmetic in web code beyond summing untimed counts.

**Ask First:** schema/RLS/SQL changes; a second query; widening `FEATURE_PUBLIC` beyond consumer comments; changing calendar behaviour.

**Never:** export (4.3); a per-member detail screen; a mode switch for the admin's own view; conflict state; totals row; new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reconcile | admin, demo month | every row equals `memberHoursOfMonth` for that member; the viewer's row equals `myHoursOf` | N/A |
| Split bands | security fixture | band cells show split hours; the bands sum to Total on every row | N/A |
| Deactivated before month | status inactive all month, no shifts | not listed | N/A |
| Moved team mid-month | A until 15th, B after | team B; filter B includes them | N/A |
| No team | active, no membership | team `—`, `0 h`; hidden under any team filter | N/A |
| Sort | `sort=ukupno&smjer=silazno` | descending total, ties by name | N/A |
| Stale params | `osoba=<unknown>`, `sort=pojas-<deleted>` | dropped; all rows, sorted by name | N/A |
| Zero bands | no bands | no band columns; totals shown | N/A |
| Domain refuses | `RangeError` for one member | no table, `sati.error.unavailable` | logged, not thrown |
| Member role | member viewer | 4.1b view unchanged | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/hours/services/my-hours.ts` -- `hoursSearchOf` (extend it with the new params), `memberHoursInputOf` (viewer-only; generalize it to a member history), `myHoursOf`, `myHoursSurfaceOf`, `figureOf` (private; share it), `HOURS_UNAVAILABLE`.
- `apps/web/src/features/calendar/utils/month.ts:786` -- `memberScheduleInputOf(snapshot, {memberId, memberships, statuses})`, which works for any member (`{...m, memberId: m.id}`, as at ~:955). `isCalendarMonth`, `calendarTodayOf`, and `MODE_SVE`/`PERSON_SEARCH_PARAM`/`MODE_SEARCH_PARAM`/`MONTH_SEARCH_PARAM` for the link.
- `packages/domain/src/roster.ts:109,122` -- `activeOn`, `membershipOn`. `schedule.ts:103` `datesOfMonth`. `hours.ts:151` `memberHoursOfMonth`. A member with no team is fine (0 h).
- `apps/web/src/features/calendar/services/snapshot.ts:234,264` -- `CalendarMember {id,name,fireRank,memberships,statuses}`. `members` is already name-sorted. `teams` includes archived teams.
- `apps/web/src/lib/i18n/format.ts:406` -- `compareText`.
- `apps/web/src/features/members/services/list.ts:1378-1449`, `components/member-table.tsx:80`, `utils/sort-glyphs.ts` -- the sort UX pattern (ghost `Button` in `TableHead`, `aria-sort`, `aria-hidden` glyph) to mirror. Do not import it: its keys are `MemberColumnKey`.
- `apps/web/src/components/ui/{table,select,card,notice}.tsx` -- primitives.
- `apps/web/src/features/hours/{hooks/use-my-hours.ts,components/*}`, `pages/sati.tsx` -- one query, then the surface state. Add the admin branch there.
- `apps/web/src/features/hours/hours-screen.fixture.ts` -- list every new non-test file in `HOURS_SCREEN_PARTS` (read by `pages/prijava.test.ts`).
- `eslint.config.js:111-160` -- `FEATURE_PUBLIC`. Update consumer comments if hours gains an import.
- `apps/web/src/lib/i18n/locales/hr.json:147` -- `sati.*`.
- `e2e/pages/hours.page.ts`, `e2e/tests/hours/hours.spec.ts:188` (the admin test "reads their own 0 h, never the organization", which must be inverted), `e2e/utils/custom-fixtures.ts`, `e2e/utils/database-helper.ts:276` `seedTeamRotation`, `run-fixture.ts:37` `ADMIN_STATE`/`MEMBER_STATE`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/hours/services/organization-hours.ts` (+ `organization-hours.test.ts`), `my-hours.ts` -- pure: search params, rows (inclusion, team, figures), filter options, filter, sort, link search, untimed sum, a surface guarded against `RangeError` -- every matrix row runs in node over both fixtures.
- [x] `apps/web/src/features/hours/{hooks,components}/*`, `apps/web/src/pages/sati.tsx`, `hours-screen.fixture.ts` -- the admin branch: filters, sortable table, link, skeleton, notice.
- [x] `apps/web/src/lib/i18n/locales/hr.json`, `eslint.config.js` -- `sati.organization.*` keys (caption, column headers, filter labels, "all", no team) and consumer comments.
- [x] `e2e/pages/hours.page.ts`, `e2e/tests/hours/hours.spec.ts` -- replace the admin-own-hours test: the admin sees the seeded member's row equal to what that member reads, filters by team, sorts by total, the name link opens their calendar month, and there is no page scroll at phone width.

**Acceptance Criteria:**
- Given a member and an admin viewing the same month, when both render, then the admin's row for that member shows exactly the member's own figures.
- Given an admin changes a filter or sort, when the URL is reloaded, then the same rows appear in the same order.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm typecheck && pnpm lint && pnpm vitest run` -- expected: clean, including feature-boundary and resource-hygiene tests
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm test:e2e e2e/tests/hours e2e/tests/calendar` -- expected: pass (local Supabase running)

## Suggested Review Order

**Every member's hours from the one snapshot**

- Entry point: one guarded pass over all rows; any `RangeError` refuses the whole table.
  [`organization-hours.ts:426`](../../apps/web/src/features/hours/services/organization-hours.ts#L426)

- Row inclusion, team on the last active date, figures from `memberHoursOfMonth`.
  [`organization-hours.ts:169`](../../apps/web/src/features/hours/services/organization-hours.ts#L169)

- The member recipe now takes any member, so admin row and own view reconcile.
  [`my-hours.ts:178`](../../apps/web/src/features/hours/services/my-hours.ts#L178)

- Role decides the surface: admin gets the table, a member keeps 4.1b.
  [`organization-hours.ts:458`](../../apps/web/src/features/hours/services/organization-hours.ts#L458)

**URL state: filters and sort**

- Parsing `tim`, `osoba`, `sort`, `smjer`; invalid values dropped.
  [`my-hours.ts:124`](../../apps/web/src/features/hours/services/my-hours.ts#L124)

- A stale sort falls back to the full default, direction included.
  [`organization-hours.ts:279`](../../apps/web/src/features/hours/services/organization-hours.ts#L279)

- Changes keep the other params; a member's month nav writes only `mjesec`.
  [`my-hours.ts:156`](../../apps/web/src/features/hours/services/my-hours.ts#L156)
  [`organization-hours.ts:363`](../../apps/web/src/features/hours/services/organization-hours.ts#L363)

- Sorting with ties by name then id; a new column starts ascending.
  [`organization-hours.ts:249`](../../apps/web/src/features/hours/services/organization-hours.ts#L249)
  [`organization-hours.ts:295`](../../apps/web/src/features/hours/services/organization-hours.ts#L295)

**Screen**

- The view the table draws: rows, filter options, empty state, caption, untimed note.
  [`organization-hours.ts:381`](../../apps/web/src/features/hours/services/organization-hours.ts#L381)

- Sortable headers with `aria-sort`, name links to the member's calendar month.
  [`organization-hours-table.tsx:77`](../../apps/web/src/features/hours/components/organization-hours-table.tsx#L77)

- Team and person selects; "all" drops the parameter.
  [`organization-hours-filters.tsx:20`](../../apps/web/src/features/hours/components/organization-hours-filters.tsx#L20)

- One query, renamed hook, both roles.
  [`use-hours.ts:38`](../../apps/web/src/features/hours/hooks/use-hours.ts#L38)
  [`sati.tsx:35`](../../apps/web/src/pages/sati.tsx#L35)

**Peripherals**

- Copy under `sati.organization.*`.
  [`hr.json:157`](../../apps/web/src/lib/i18n/locales/hr.json#L157)

- Node tests over both fixtures, one per matrix row.
  [`organization-hours.test.ts:1`](../../apps/web/src/features/hours/services/organization-hours.test.ts#L1)

- E2E: admin row equals the member's own screen, filters, sort, month nav, link, phone width.
  [`hours.spec.ts:194`](../../e2e/tests/hours/hours.spec.ts#L194)
