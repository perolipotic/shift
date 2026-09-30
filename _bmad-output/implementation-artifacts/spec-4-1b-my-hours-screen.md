---
title: 'My hours: the viewer''s month on the Sati screen (4.1b)'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_commit: '43e039ca6475696a3eee6798fcc3efbba675fc8b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1a-hours-rule.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/sati` is still a titled placeholder. A member cannot see how many hours they worked in a month, or how those hours split across bands.

**Approach:** Add the organization's hour bands to the calendar snapshot, so `Sati` reads the same one snapshot as the calendar. Compute the viewer's month with 4.1a's `memberHoursOfMonth` and render it with a month nav shared with the calendar. Member and admin both see only their own hours (4.2 adds the organization view).

## Boundaries & Constraints

**Always:**
- One read: `CALENDAR_KEY`, extended with an `hour_bands(organization_id,id,name,start_time)` embed mapped by `hourBandRowOf`. Refuse other-tenant rows the same way the other embeds do. Every band write must also invalidate `CALENDAR_KEY`.
- The month comes only from `?mjesec=YYYY-MM`, and an invalid value is dropped. The default is the organization's today (`calendarTodayOf`). The shared nav gives previous / `Ovaj mjesec` / next.
- Show: total hours and shift count; per band (in band order, the name as stored), its hours and shift count; a separate leave row (`0 h`); and, only when `untimedShiftCount > 0`, a note that those shifts have no times and are not counted.
- Hours render as `N h`, or `N h M min` when minutes remain, through the existing `durationValuesOf`/`durationMessageKey`. Figures use `tabular-nums`. Shift counts use an ICU plural key.
- No literals: keys live in `hr.json` under `sati.*`. Skeleton while loading, no spinner, no optimistic figure. A read failure, or a `RangeError` from the domain, shows `Notice` with `sati.error.unavailable`.
- Every rule lives in node-tested `.ts` (AD-15). Components and hooks are wiring only. No hour arithmetic in web code.
- Feature boundaries: `features/hours` imports only `FEATURE_PUBLIC` modules. Update the consumer comments in `eslint.config.js`.

**Ask First:** a schema/RLS/SQL change; widening `FEATURE_PUBLIC` beyond the consumer comments; changing any calendar behaviour other than the extra embed and the relocated nav.

**Never:** an organization-wide view, sorting/filtering or export (4.2/4.3); conflict state; a second query for bands; new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Member month | demo member, month with 15 shifts | total, count, per-band hours and counts equal `memberHoursOfMonth` | N/A |
| Odd minutes | a band total of 750 min | `12 h 30 min` | N/A |
| No shifts | admin with no team | `0 h`, 0 shifts, every band `0 h` | N/A |
| Zero bands | organization with no bands | total shown, no band rows | N/A |
| Untimed | `untimedShiftCount` 2 | note shown with count 2 | N/A |
| Bad month | `?mjesec=2026-13` | param dropped, current month | N/A |
| Read fails | snapshot error or `RangeError` | no figures, `sati.error.unavailable` | logged, not thrown |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/calendar/services/snapshot.ts:100,107-115,255-296,905,950` -- `CALENDAR_KEY`, `CALENDAR_COLUMNS` (add the embed), `CalendarSnapshot` (add `bands`), query options, surface state. Tenant tripwire: `organization_id` on each embed. Tests: `snapshot.test.ts` (fixture stubs from `@/features/rotation/rotation.fixture`; source sweep at ~:1100 covers `features/calendar` only).
- `apps/web/src/features/calendar/utils/month.ts:83,119,138,143,344,476,761-806,857` -- in-force standings, `workingShiftTypeIdsOf`, `mjesec` validation, `calendarTodayOf`, and `calendarDayListOf`, the exact recipe for building `MemberScheduleInput` from `snapshot.viewer`. `calendarMonthOf` builds `monthName` via `capitalized(formatIsoMonthName)`, with `adjacentMonth`.
- `apps/web/src/features/calendar/components/calendar-month-nav.tsx` -- move it to `apps/web/src/components/month-nav.tsx`. Narrow props to `{monthName, year, previous, next, isCurrent} | null` plus a heading id, and keep `kalendar.*` keys or move them to a neutral namespace. The calendar keeps passing `MONTH_HEADING_ID`.
- `apps/web/src/features/hour-bands/services/list.ts:135,250,263` -- `hourBandRowOf`, `durationValuesOf`, `durationMessageKey` (public). Hooks `use-hour-band-edit.ts:94` and `use-hour-band-list.ts:126` invalidate only `HOUR_BANDS_LIST_KEY` today.
- `apps/web/src/features/teams/services/dependents.ts` -- pattern for lists of dependent keys.
- `packages/domain/src/hours.ts` -- `memberHoursOfMonth`, `MemberHoursInput`, `ShiftTypeWithVersions`. `snapshot.types` rows are `ShiftType` + `versions`.
- `apps/web/src/pages/sati.tsx`, `pages/kalendar.tsx` -- placeholder to replace, and the composition pattern (`validateSearch`, `useNavigate`).
- `apps/web/src/components/ui/{stat-card,card,notice,page-header}.tsx` -- primitives. Skeleton = `animate-pulse rounded-sm bg-muted`.
- `apps/web/src/lib/i18n/hr.json:24,265` -- ICU plural shape, `nav.sati`.
- `eslint.config.js:111-153` -- `FEATURE_PUBLIC`.
- `e2e/pages/calendar.page.ts`, `e2e/tests/calendar/`, `e2e/custom-fixtures.ts`, `e2e/utils/run-fixture.ts`, `e2e/utils/database-helper.ts:276` -- page-object and seeding pattern (`seedTeamRotation`; the per-run org has two bands and no rotation).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/calendar/services/snapshot.ts` (+ test) -- add the bands embed and field, with a tenant check -- one snapshot for both surfaces.
- [x] `apps/web/src/features/hour-bands/hooks/*` -- also invalidate `CALENDAR_KEY` after band writes -- keeps hours fresh.
- [x] `apps/web/src/components/month-nav.tsx`, calendar call sites -- relocate and narrow the nav -- shared by both screens.
- [x] `apps/web/src/features/hours/services/my-hours.ts` (+ `my-hours.test.ts`) -- pure: search parsing, month header, snapshot to `MemberHoursInput`, an outcome guarded against `RangeError`, and display rows with message keys and values -- every matrix row runs in node over both fixtures.
- [x] `apps/web/src/features/hours/{hooks,components}/*`, `apps/web/src/pages/sati.tsx` -- wire the query, nav, skeleton, notice and figures.
- [x] `apps/web/src/lib/i18n/hr.json`, `eslint.config.js` -- `sati.*` keys and consumer comments.
- [x] `e2e/pages/hours.page.ts`, `e2e/tests/hours/hours.spec.ts`, `e2e/custom-fixtures.ts` -- seed a rotation for Lana's team. As the member, `/sati` shows a non-zero total equal to the seeded shifts × duration.

**Acceptance Criteria:**
- Given a member on the calendar and on `Sati` for the same month, when both render, then the shifts counted in hours are exactly the working shifts in their day list.
- Given an admin edits a band boundary, when they open `Sati`, then band hours reflect the new boundary and the total is unchanged.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm --filter web test` -- expected: all pass
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm typecheck && pnpm lint && pnpm vitest run` -- expected: clean, including feature-boundary tests
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm test:e2e e2e/tests/hours e2e/tests/calendar` -- expected: pass (local Supabase running)

## Suggested Review Order

**Hours from the one snapshot**

- Entry point: the viewer's month, guarded so a domain `RangeError` becomes one message.
  [`my-hours.ts:155`](../../apps/web/src/features/hours/services/my-hours.ts#L155)

- One schedule recipe shared with the calendar day list, so both count the same shifts.
  [`month.ts:786`](../../apps/web/src/features/calendar/utils/month.ts#L786)

- Surface state: skeleton, message or figures, and whether the nav stays.
  [`my-hours.ts:213`](../../apps/web/src/features/hours/services/my-hours.ts#L213)

- Display rows: message keys and values, no hour arithmetic.
  [`my-hours.ts:130`](../../apps/web/src/features/hours/services/my-hours.ts#L130)

**Snapshot extension**

- Bands embedded in the calendar read, with a tenant tripwire.
  [`snapshot.ts:119`](../../apps/web/src/features/calendar/services/snapshot.ts#L119)

- A bad, duplicate or foreign band refuses the read.
  [`snapshot.ts:339`](../../apps/web/src/features/calendar/services/snapshot.ts#L339)

- Band writes now also refresh the calendar snapshot.
  [`dependents.ts:75`](../../apps/web/src/features/teams/services/dependents.ts#L75)

**Screen and shared nav**

- The nav moved out of calendar, with narrowed props and a heading id.
  [`month-nav.tsx:30`](../../apps/web/src/components/month-nav.tsx#L30)

- The month header is shared by both screens.
  [`month.ts:499`](../../apps/web/src/features/calendar/utils/month.ts#L499)

- Page composition; branching lives in the body's early returns.
  [`sati.tsx:33`](../../apps/web/src/pages/sati.tsx#L33)
  [`hours-body.tsx:10`](../../apps/web/src/features/hours/components/hours-body.tsx#L10)

**Peripherals**

- Copy, including ICU plurals for shift counts and the untimed note.
  [`hr.json:147`](../../apps/web/src/lib/i18n/locales/hr.json#L147)

- The new feature's public module.
  [`eslint.config.js:125`](../../eslint.config.js#L125)

- Node tests over both fixtures, one per matrix row.
  [`my-hours.test.ts:122`](../../apps/web/src/features/hours/services/my-hours.test.ts#L122)

- E2E: member figures per band, admin reads own 0 h.
  [`hours.spec.ts:111`](../../e2e/tests/hours/hours.spec.ts#L111)
