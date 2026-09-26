---
title: 'Story 3.2a: The month on a phone — Moj raspored and the compressed grid'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: '33f78b7c027bb2a27920e992573a9960710d43c2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On a phone, `/kalendar` shows the full grid, with team names and type names in every cell. A member cannot see their own month at a glance. Nothing offers the compressed grid of UX-DR41 and UX-DR42.

**Approach:** Add a two-mode switch, *Moj raspored* and *Sve smjene*:
- *Moj raspored* is a day list of the viewer's own team on each date.
- *Sve smjene* is the 3.1 grid. Below 640 px the same table narrows to one-letter team columns and one-letter type cells.

Both modes are derived from the one calendar read. That read is extended with the viewer's own member row.

## Boundaries & Constraints

**Always:**
- **One read (AD-13), extended:**
  - Add `members(organization_id,id,role,team_membership_versions(organization_id,team_id,effective_from))` to `CALENDAR_COLUMNS`. Filter the embed to `members.auth_user_id = <session uid>`, with the session injected as `readOwnTeamToday` does.
  - The answer must contain exactly one member. Otherwise the read is `CALENDAR_UNAVAILABLE`, and so is no session.
  - The role is checked by `memberRoleOf`. Each version passes the tenant tripwire. Its `team_id` is `null` or a team in the answer. Two versions on one date are unavailable.
  - There is still one select under `CALENDAR_KEY`: no position, no rank, no name, no `created_*`.
- **Domain (AD-7):** add `memberScheduleOfMonth({ memberships, assignments, steps }, month)` to `packages/domain/src/schedule.ts`.
  - It returns `{ date, teamId | null, shiftTypeId | null }[]`.
  - The team on a date comes from the version with the greatest `effectiveFrom` ≤ that date. The type is `projectedShiftTypeOn` for that team's versions.
  - It returns ids only, and a broken precondition throws `RangeError`.
- **Mode:**
  - Search param `prikaz` = `moj` | `sve`. Invalid values are dropped. Month navigation and `Ovaj mjesec` keep it.
  - When the param is absent, the pure `defaultModeOf(role, isPhone)` decides: `moj` only for `member_role` below 640 px (`(max-width: 639px)`, read live), and `sve` in every other case.
  - The control is a segmented pair of buttons with `aria-pressed`, each ≥ 44 px, at every width.
- **Day list (`moj`):**
  - One row per date: day, weekday, the type name with its slot fill, and the range for a working type. A `null` cell renders as in 3.1.
  - A date without a team reads `kalendar.day.noTeam`.
  - When the viewer has no team on any date of the month, only the notice `kalendar.noTeam` shows ("Nisi član nijedne smjene"), never an empty list.
  - Today's row has `aria-current="date"`. Archived teams still count, because the list follows membership.
- **Compressed grid (`sve`, < 640 px):**
  - It is the same `Table` and cells as 3.1. Visibility is switched by CSS (`sm:`), with no second grid component.
  - Team headers show a letter from `teamLettersOf`: the first letter of the name's last word, uppercased. Colliding teams all take the first two letters of that word, and teams still colliding take the whole word. The full name is `sr-only`.
  - Cells show the type letter from `typeLettersOf`: the first letter of the name, with the same collision widening. The full name is `sr-only`. Cells are ≥ 44 × 44 px.
  - From 640 px up the grid is unchanged from 3.1.
- The page never scrolls sideways at 320 px, in either mode.
- **Text:** `kalendar.*` in `hr.json`, registered in the inventories. `Smjena` always means team.

**Ask First:** any migration or policy; reading another member's rows; changing the 3.1 grid at ≥ 640 px.

**Never:**
- modifiers, glyphs, legend, keyboard grid, composite cell `aria-label`s (3.2b);
- filters (3.3);
- day detail (3.4);
- overrides;
- a second query or key;
- `localStorage`/`sessionStorage` for the mode;
- reading rank or position;
- `destructive` or the accent on shift state;
- new dependencies;
- render tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Member, phone | member_role, 390 px, no `prikaz` | Day list of own team | N/A |
| Admin, phone | admin, 390 px | Compressed grid | N/A |
| Member, desktop | member_role, 1280 px | Full grid; switch offers day list | N/A |
| Explicit mode | `?prikaz=moj`, any role or width | Day list; kept on next/previous | N/A |
| Team move mid-month | versions A on 1st, B on 15th | 1–14 from A's rotation, 15+ from B's | N/A |
| Left team | version `team_id null` on 10th | 10+ read `kalendar.day.noTeam` | N/A |
| No team | no versions | `kalendar.noTeam` notice, no list | N/A |
| Letters | Smjena A–D; Dan, Noć, Slobodno | A B C D; D N S | N/A |
| Letter collision | Alfa, Ante / Dan, Dežurstvo | AL AN / DA DE | N/A |
| Bad member embed | 0 or 2 members, foreign version, unknown team | Alert, no grid | `CALENDAR_UNAVAILABLE` |

</frozen-after-approval>

## Code Map

- `packages/domain/src/schedule.ts:115` -- `scheduleOfMonth`, the model for `memberScheduleOfMonth`; export it from `index.ts`. Tests in `packages/domain/test/schedule.test.ts` with the PILOT/UJ5 fixtures (`test/fixtures.ts`).
- `apps/web/src/calendar/snapshot.ts:51` -- `CALENDAR_COLUMNS`. `:106` is the `CalendarTable` interface, which gains `.filter(column, 'eq', value)` after `select`. `:155` is `readCalendar`, which takes a session reader. `:260` is `calendarQueryOptions`, which passes it (`currentSession` from `@/supabase/client`).
- `apps/web/src/teams/roster.ts:340` -- `readOwnTeamToday`, the precedent for the session and the `auth_user_id` filter. `members/list.ts:400` `memberTeamOn` is the same reading in the web app; do not reuse it (it requires `position` and `teams(name)`).
- `apps/web/src/navigation/role.ts:195` -- `memberRoleOf`, the guard for `role`.
- `apps/web/src/calendar/month.ts` -- `calendarSearchOf` :69 (add `prikaz`), `calendarMonthOf` :179 (add letters to columns and cells), `cellOf` :137. Add `calendarDayListOf`, `defaultModeOf`, `teamLettersOf` and `typeLettersOf` here, all tested in `month.test.ts`.
- `apps/web/src/routes/kalendar.tsx` -- `show()` :72 must keep `prikaz`, plus the mode switch, the day list and the dual-visibility cells. `navigation/chrome.tsx:64` gives the `sm:` 640 px convention.
- `apps/web/src/calendar/snapshot.test.ts`, `rotation/rotation.fixture.ts` -- the stubs gain the filter and a members embed.
- Inventories: `test/resource-hygiene.test.ts:881` (the `kalendar.*` list, and `:949` the namespace rule that `smjen` means team), `test/localization-applied.test.ts:96,249,979`, `apps/web/src/routes/prijava.test.ts`.
- e2e: `e2e/calendar.spec.ts` (`seeded`, the organizations request counter), `e2e/support/fixture.ts:62-68` (`member` on `team`, and a member on no team), `e2e/support/layout.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/schedule.ts`, `index.ts`, `test/schedule.test.ts` -- add `memberScheduleOfMonth`. Tests: every row equals `projectedShiftTypeOn` of the team on that date, on both fixtures; a move mid-month; leaving a team; no versions; duplicate dates throw.
- [x] `apps/web/src/calendar/snapshot.ts`, `snapshot.test.ts` -- add the members embed, the filter, the session, and the parsing and tripwire for every bad-embed row of the matrix.
- [x] `apps/web/src/calendar/month.ts`, `month.test.ts` -- add `prikaz` parsing, `defaultModeOf`, the day-list model, the letter rules and collisions, and letters on the grid columns and cells.
- [x] `apps/web/src/routes/kalendar.tsx` -- add the switch, the day list, the no-team notice and the compressed treatment, and keep `prikaz` on navigation.
- [x] `apps/web/src/i18n/locales/hr.json` -- add `kalendar.mode.moj`, `kalendar.mode.sve`, `kalendar.mode.label`, `kalendar.noTeam` and `kalendar.day.noTeam`.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` -- register the new keys and controls.
- [x] `e2e/calendar.spec.ts` -- tests at 390 px:
  - a member lands on the day list with the seeded types;
  - the switch shows letters;
  - an admin lands on the grid;
  - `prikaz` survives next;
  - the member on no team sees the notice;
  - one `organizations` request;
  - no horizontal scroll at 320 px in both modes;
  - the switch and the compressed cells are touch targets.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `3-2-…: in-progress`.

**Acceptance Criteria:**
- Given the calendar in either mode, when network traffic is inspected, then there is exactly one `organizations` select, it carries the `members.auth_user_id` filter, and it selects no `position`, `rank`, `name` of a member, or `created_*`.
- Given `apps/web/src/calendar` and `kalendar.tsx`, when they are swept, then they contain no `%` projection, no writes, and no second grid component.
- Given a member-role account under 640 px, when the calendar opens without `prikaz`, then the day list shows, and the compressed all-teams grid is one tap away.

## Design Notes

**Why the member row joins the snapshot.** "My schedule" needs the viewer's membership history. A second query would break AD-13's one read per surface. PostgREST filters an embedded resource without filtering the parent (`.filter('members.auth_user_id','eq',uid)`), so it is still one `organizations` select. The RLS on `members` already allows it. `role` rides along only to pick the default mode. Authorization never reads it here.

**Letters are presentation.** `teamLettersOf` and `typeLettersOf` are pure `(names) → letters` functions over the displayed list, so the compressed grid can never show two identical headers.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above the baseline.
- `pnpm test:e2e` -- green. Stop Vite on 5173 first, and do not run it alongside `pnpm test`.
- `git diff --stat supabase/ package.json pnpm-lock.yaml` -- empty.

**Manual checks:**
- Demo org at 320, 390, 800 and 1280 px, as a member and as an admin: the default mode, the letters, and no sideways scroll.

## Suggested Review Order

**The viewer joins the one read**

- Entry point: the members embed rides the same `organizations` select, with no position, rank or name.
  [`snapshot.ts:62`](../../apps/web/src/calendar/snapshot.ts#L62)

- The embed is filtered to the session's `auth_user_id`; no session means no read.
  [`snapshot.ts:206`](../../apps/web/src/calendar/snapshot.ts#L206)

- Exactly one viewer, role guarded, versions tripwired and pointing at known teams.
  [`snapshot.ts:316`](../../apps/web/src/calendar/snapshot.ts#L316)

**My month, derived in the domain**

- Team on each date by the latest version, then `projectedShiftTypeOn`; ids only.
  [`schedule.ts:180`](../../packages/domain/src/schedule.ts#L180)

**Mode**

- `moj` by default only for a member-role account under 640 px.
  [`month.ts:123`](../../apps/web/src/calendar/month.ts#L123)

- Navigation keeps `prikaz` and never writes in a mode nobody chose.
  [`month.ts:137`](../../apps/web/src/calendar/month.ts#L137)

- One shared media query list, read live through `useSyncExternalStore`.
  [`month.ts:88`](../../apps/web/src/calendar/month.ts#L88)

**Day list and compressed grid**

- A day-list failure stays local: Sve smjene still renders.
  [`month.ts:504`](../../apps/web/src/calendar/month.ts#L504)

- Letters widen one → two → word → full name, so headers never repeat; NFC first.
  [`month.ts:223`](../../apps/web/src/calendar/month.ts#L223)

- Type letters are computed over the types the month actually shows.
  [`month.ts:399`](../../apps/web/src/calendar/month.ts#L399)

- The segmented switch: two 44 px buttons, filled from `aria-pressed`.
  [`kalendar.tsx:145`](../../apps/web/src/routes/kalendar.tsx#L145)

- The day list as an ordered list under the month heading.
  [`kalendar.tsx:216`](../../apps/web/src/routes/kalendar.tsx#L216)

- Same table, CSS-only compression: letter below `sm`, full name `sr-only` there.
  [`kalendar.tsx:239`](../../apps/web/src/routes/kalendar.tsx#L239)

**Peripherals**

- Domain tests: move, leave, no versions, both fixtures.
  [`schedule.test.ts:201`](../../packages/domain/test/schedule.test.ts#L201)

- Phone e2e: member day list, switch, letters, targets, one read.
  [`calendar.spec.ts:305`](../../e2e/calendar.spec.ts#L305)

- Copy: the new `kalendar.*` keys.
  [`hr.json:35`](../../apps/web/src/i18n/locales/hr.json#L35)
