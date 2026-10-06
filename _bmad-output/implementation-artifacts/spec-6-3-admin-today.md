---
title: 'Danas tells an admin what needs them, today''s coverage and the week (6.3)'
type: 'feature'
created: '2026-10-06'
baseline_commit: '73583e434bca3a4ab5df035dfc50be24e0822914'
status: 'done'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An admin opens Danas and sees the member screen, which tells an admin with no team only "Bez smjene". Nothing says how many conflicts are waiting, who is covering today, or how the week looks.

**Approach:**
- An admin gets their own Danas with four blocks, in this order:
  1. *Treba tebe*
  2. *Pokrivenost danas*
  3. *Odsutni danas*
  4. *Ovaj tjedan*
- All four derive from the reads the conflict queue uses, so every figure equals its list.
- The admin's own today becomes one line in the subtitle.
- Members keep today's screen unchanged. Reference: `danas-1.html` F/G/H.

## Boundaries & Constraints

**Always:**
- **Role and reads:**
  - The role comes from `snapshot.viewer.role`. While the snapshot is unanswered, the skeleton is chosen by `cachedRoleOf(MEMBER_ROLE_KEY)`, as Kalendar does.
  - The admin view reads only `CALENDAR_KEY`, `ORGANIZATION_LEAVE_RECORDS_KEY` and `ORGANIZATION_CONFLICT_RESOLUTIONS_KEY`, through the existing query options, plus `useReplacementLinkRefresh`. It never calls `useConflictsQueue` (that hook navigates).
  - Unavailable and loading follow `conflictsQueueOf`'s gating: an alert with retry, which invalidates the three keys, or a skeleton shaped like the final screen. Never a spinner.
- **Subtitle:**
  - It reads "‹dan›, ‹datum› · ‹status›". The status is one of:
    - "Danas radiš ‹tip› ‹raspon›", once per shift;
    - "Na dužnosti do ‹HH:MM›";
    - "Danas si na godišnjem odmoru";
    - "Danas ne radiš";
    - "Nisi raspoređen ni u jednu smjenu."
  - The status comes from the existing `useToday` case. When the admin is on a team today, the team name follows as a link to `/smjene/$id` (from the existing own-team read).
  - Admins get no "Tvoja smjena" card.
- **Treba tebe:**
  - `count` is `conflictsQueueOf(...).view.count`, shown at every count, 0 included, with the `raspored.count` plural.
  - Above 0:
    - a `destructive` left edge and `TriangleAlert`;
    - "‹n› na datum koji je prošao · najraniji ‹dd.mm.›" when any row is past;
    - up to 3 rows with the earliest dates first, past rows included. Each row is a link to `/raspored/$memberId/$date/$teamId` with the date, type, team and member, and an "prošlo" or "danas" badge.
  - At 0: neutral, with `CircleCheck` and "Svaki upisani godišnji odmor usklađen je s rasporedom."
  - It always ends with a link "Otvori konflikte (‹n›)" to `/raspored`.
- **Pokrivenost danas:**
  - One row per active team whose type today is working, in team order. A row shows:
    - the type and range, then "· ‹tim›";
    - its phase from `organizationWallClock`: "počinje u ‹HH:MM›", "u tijeku, do ‹HH:MM›" or "završeno u ‹HH:MM›";
    - "‹prisutni› od ‹N› člana", where `N` is `rosterOn(...).roster.length` and `prisutni` excludes roster members whose leave covers today;
    - per absent member, "‹ime› je na godišnjem · konflikt nije riješen", or "· prihvaćeno bez zamjene" when accepted uncovered;
    - otherwise "✓ puna smjena".
  - A closing line names the teams off today: "Slobodno: Smjena B, Smjena C".
  - It links to `/kalendar`.
- **Odsutni danas:**
  - It lists active members whose leave covers today, with name, team and merged range.
  - Then "Od sutra: ‹ime› (‹tim›), ‹raspon›" for leave starting tomorrow.
  - At 0: "Danas nitko nije na godišnjem odmoru."
  - It links to `/godisnji`.
- **Ovaj tjedan:**
  - Active teams × today…today+6, taken from `calendarMonthOutcomeOf` with the queue's marks (two months when the week crosses one).
  - Each cell shows `cell.letter`, with ⚠ when it has a conflict. Each cell's accessible name is "‹dan› ‹dd.mm.›, ‹tim›, ‹tip› ‹raspon›[, neriješen konflikt]".
  - A legend follows. It links to `/kalendar`.
  - No horizontal page scroll at 390 px; the grid may scroll inside its own region.
- **Rules and copy:**
  - Every rule lives in `.ts` services returning codes and key unions, reusing the domain, calendar and leave functions.
  - Focus order: the card, its rows, "Otvori konflikte", Pokrivenost, Tjedan.
  - No state is shown by colour alone. Figures use `tabular-nums`.
  - Copy lives under `danas.admin.*` in `hr.json`. Counts use ICU plurals, never `count === 1`.
- Everything is re-derived on each minute tick.

**Ask First:**
- A migration, an RLS change, or a new read or query key.
- A change to `conflictsQueueOf`, `unresolvedOf`, the marks, or the member Danas.

**Never:**
- A nav badge.
- Storing a count or a coverage figure.
- Optimistic updates.
- Pulling 7.5–7.18 forward.
- An admin branch with its own `useQuery` or `Link` inside `pages/danas.tsx`. The page only picks the body.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Zero | no unresolved conflicts | "0 neriješenih konflikata", neutral, link "Otvori konflikte (0)" | N/A |
| Seven, one past | 7 unresolved, 1 dated yesterday | count 7, "1 na datum koji je prošao · najraniji ‹jučer›", the past row first with "prošlo" | N/A |
| Equality | resolve one on Raspored, return | count 6 on both, with no optimistic step | N/A |
| Short team | A on Noć, a member on leave, unresolved | "3 od 4 člana", "‹ime› je na godišnjem · konflikt nije riješen" | N/A |
| Replaced | the same, resolved by replacement | "4 od 4 člana", "✓ puna smjena" | N/A |
| Phase | Dan 07–19 at 14:20; Noć 19–07 at 14:20 | "u tijeku, do 19:00"; "počinje u 19:00" | N/A |
| Many teams | 6 teams | 6 week rows, coverage per working team, no page scroll at 390 px | N/A |
| Admin off-team | no membership | subtitle "Nisi raspoređen ni u jednu smjenu.", no team link | N/A |
| Admin working | on A, Noć today | "Danas radiš Noć 19:00–07:00 · Smjena A" (link) | N/A |
| Member | member signs in | today's member Danas, unchanged | N/A |
| Read fails | leave read errors | alert and retry; no partial figures | logged when RangeError |

## Epic AC Deviations

- **"today's coverage across all of them"**: REINTERPRETED. Coverage lists today's dated shifts per team. A Noć from yesterday that is still running before 07:00 is not listed, because it belongs to yesterday's coverage. Off teams are named in one line.
- **Mockup's three earliest rows**: kept as in the mockup, with the earliest date first and past rows included. This differs from the queue's upcoming-first order, but not from its set or count.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/danas.tsx` -- keep 1 `useQuery`/1 `Link`; it picks `TodayBody` or `AdminTodayBody` and renders the subtitle. `prijava.test.ts:5683-5755` pins the page's reads and links.
- `features/conflicts/services/conflicts-queue.ts` -- `ConflictRow` :54 (`past`, `dateShown`, names, `times`), `conflictsQueueOf` :310, `ConflictsQueueSources` :297, `unresolvedOf` :182, `resolutionsOf` :171. Today = `calendarTodayOf` (calendar/utils/month.ts:493).
- `features/conflicts/hooks/use-conflicts-queue.ts:85-111` -- the three queries and the retry to mirror. `useReplacementLinkRefresh` :106. Routes: `pages/raspored.tsx` `/raspored`, `raspored.$memberId.$date.$teamId.tsx`.
- `features/calendar/services/marks.ts` -- `calendarMarksStateOf` :133 (collisions, uncovered, `leave` by member). `month.ts`: `calendarMonthOutcomeOf` :1169, `CalendarCell` :522 (letter, name, range, className, modifiers), `typeRangeOn` :932, `weekdayOf`/`dayMonthOf` :939/944, `rosterStandingOfCalendar` :136, `splitTeams`, private `onLeave` :606. `utils/modifiers.ts` `MODIFIER_CONFLICT`, `CONFLICT_GLYPH`. `components/calendar-legend.tsx`.
- `packages/domain` -- `rosterOn` (roster.ts:294), `scheduledShiftTypeOn` (overrides.ts:106), `shiftTypeVersionOn` and `deriveShiftTimes` (duration.ts), `isLeaveDay` (leave.ts:115).
- `features/leave/services/leave-list.ts` -- `organizationLeaveRecordsQueryOptions`, `organizationLeaveRecordsOf` → `{id, memberId, from, to}`. `today.ts` private `absenceOn` merges adjacent records; export it or move it to a shared helper.
- `features/conflicts/services/resolutions.ts:36/208` -- the resolutions key and options.
- `features/today/services/today.ts` -- `TodayCase` and `todayCaseOf`, for the subtitle status. `today-duty.ts` duty end. `hooks/minute-ticker.ts`, `lib/i18n/format.ts` `organizationWallClock` :254, `formatMinuteOfDay` :65, `formatIsoDayMonth` :355.
- `features/calendar/utils/skeleton.ts:39` -- `cachedRoleOf`. `navigation/services/role.ts:58` -- `MEMBER_ROLE_KEY`.
- `components/ui/` -- `card`, `stat-card`, `badge`, `notice`. Icons: `TriangleAlert`, `CircleCheck`.
- `eslint.config.js:111-230` `FEATURE_PUBLIC` -- open `conflicts/services/conflicts-queue`, `conflicts/services/resolutions`, `conflicts/hooks/use-replacement-link-refresh`, `calendar/services/marks`, `leave/services/leave-list` and `navigation/services/role` to `today`, and update the consumer comments.
- Registrations:
  - `features/today/today-screen.fixture.ts` (PARTS/EXEMPT);
  - `pages/prijava.test.ts`: :725 controls; :2191-2220 `KEY_SOURCES` counts; :3046/:3073 lengths; :3244 file set; :5683-5755 page pins;
  - `test/resource-hygiene.test.ts`: `SANCTIONED_SCREEN_KEYS` :1480-1526, `SANCTIONED_PLURAL_KEYS` :1766, the voice rules;
  - `hr.json` `danas` :27.
- e2e:
  - `e2e/tests/today/today.spec.ts` (`seeded` :110, `holdRotation`, `page.clock` :437);
  - `e2e/pages/today.page.ts`, `e2e/pages/conflicts.page.ts`;
  - `e2e/utils/database-helper.ts`: `seedLeaveMember` :256, `seedLeaveRecord` :408, `seedConflictResolution` :454, `seedExtraTeam` :977, `seedTeamRotation` :824;
  - `ADMIN_STATE` (`run-fixture.ts:37`); `expectNoHorizontalScroll` (`layout.ts:41`);
  - add an admin Danas entry to `layout/responsive.spec.ts:51`.

## Tasks & Acceptance

**Execution:**
- [x] `features/today/services/admin-today.ts` (+test) -- the gating, the Treba tebe view, the coverage, the absences, the week and the subtitle status, all as codes and key unions; every matrix row is a unit test.
- [x] `features/today/hooks/use-admin-today.ts` -- the three reads, the ticker, retry and replacement-link refresh.
- [x] `features/today/components/admin-today-body.tsx`, `needs-you-card.tsx`, `coverage-card.tsx`, `absent-card.tsx`, `week-grid.tsx`, `admin-today-skeleton.tsx` -- rendering.
- [x] `pages/danas.tsx` -- the role switch and the subtitle; no team card for admins.
- [x] `eslint.config.js`, `hr.json`, `resource-hygiene.test.ts`, `prijava.test.ts`, `today-screen.fixture.ts` -- registrations and re-derived pins, each with a "SINCE STORY 6.3" note.
- [x] `e2e/pages/today.page.ts`, `e2e/tests/today/today.spec.ts`, `layout/responsive.spec.ts` -- admin with `page.clock` at 14:20:
  - zero state;
  - a seeded leave conflict: count, row link to the resolution screen, "Otvori konflikte (1)" and Raspored's equal count, "3 od 4"-style coverage, the absent member, and ⚠ in the week cell's accessible name;
  - keyboard focus order;
  - no scroll at 390 px;
  - the member Danas is unchanged.

**Acceptance Criteria:**
- Given any number of teams, when an admin opens Danas, then *Treba tebe* comes first and its count equals Raspored's at every count, 0 included.
- Given a decision saved on Raspored, when the admin returns to Danas, then the count changes only after the save.
- Given keyboard or screen-reader use, when the dashboard is traversed, then every row, link and week cell is reachable in order and announced in words.

## Spec Change Log

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green
- `pnpm exec playwright test e2e/tests/today e2e/tests/conflicts e2e/tests/layout` -- expected: all pass

## Suggested Review Order

**One derivation over the queue's three reads**

- Entry point: gating from `conflictsQueueOf`, then every block from the same snapshot.
  [`admin-today.ts:308`](../../apps/web/src/features/today/services/admin-today.ts#L308)

- The view: count, coverage, absences, week, all narrowed from one read set.
  [`admin-today.ts:342`](../../apps/web/src/features/today/services/admin-today.ts#L342)

- The hook: the queue's three keys, minute ticker, retry; never `useConflictsQueue`.
  [`use-admin-today.ts:70`](../../apps/web/src/features/today/hooks/use-admin-today.ts#L70)

**Treba tebe**

- Count is the queue's own; three earliest rows, past first, prošlo/danas badges.
  [`admin-today.ts:446`](../../apps/web/src/features/today/services/admin-today.ts#L446)

- Same shape at every count; destructive edge only above zero.
  [`needs-you-card.tsx:59`](../../apps/web/src/features/today/components/needs-you-card.tsx#L59)

**Pokrivenost and Odsutni**

- A replaced absentee leaves N, so a replacement reads 4 od 4.
  [`admin-today.ts:557`](../../apps/web/src/features/today/services/admin-today.ts#L557)

- Staffing: full, short or nobody; an empty roster never reads as full.
  [`admin-today.ts:584`](../../apps/web/src/features/today/services/admin-today.ts#L584)

- Working, off and no-rotation teams together cover every active team.
  [`admin-today.ts:506`](../../apps/web/src/features/today/services/admin-today.ts#L506)

- Phase from the organization's wall clock: počinje, u tijeku, završeno.
  [`admin-today.ts:478`](../../apps/web/src/features/today/services/admin-today.ts#L478)

- Absences reuse the member's merged `absenceOn`, now exported unchanged.
  [`admin-today.ts:617`](../../apps/web/src/features/today/services/admin-today.ts#L617)

**Ovaj tjedan**

- Seven days across one or two months; a missing cell is empty, not a crash.
  [`admin-today.ts:690`](../../apps/web/src/features/today/services/admin-today.ts#L690)

- Kalendar's grid model: one tab stop, arrow keys, a named gridcell.
  [`week-grid.tsx:114`](../../apps/web/src/features/today/components/week-grid.tsx#L114)

**Page and role**

- Role from the snapshot, else the cached role, as Kalendar does.
  [`use-admin-today.ts:43`](../../apps/web/src/features/today/hooks/use-admin-today.ts#L43)

- The page picks the body; subtitle status plus team link; refusal for both roles.
  [`danas.tsx:134`](../../apps/web/src/pages/danas.tsx#L134)

- Subtitle status mapped from the member's today case.
  [`admin-today.ts:770`](../../apps/web/src/features/today/services/admin-today.ts#L770)

**Peripherals**

- Short weekday through Intl, kept in format.ts.
  [`format.ts:453`](../../apps/web/src/lib/i18n/format.ts#L453)

- E2E: zero, seeded conflict through a saved decision, admin on a team, failed read.
  [`today.spec.ts:601`](../../e2e/tests/today/today.spec.ts#L601)

- Unit tests for every matrix row.
  [`admin-today.test.ts:1`](../../apps/web/src/features/today/services/admin-today.test.ts#L1)

- New copy under danas.admin.
  [`hr.json:71`](../../apps/web/src/lib/i18n/locales/hr.json#L71)

- Feature boundaries opened to today.
  [`eslint.config.js:247`](../../eslint.config.js#L247)
