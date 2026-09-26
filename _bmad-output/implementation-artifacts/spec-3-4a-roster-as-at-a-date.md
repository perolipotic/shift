---
title: 'Story 3.4a: The roster as at a date'
type: 'feature'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '726a9b9319e222217f6d86f4a479692bd4a2c886'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3b-calendar-person-filter.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The day detail (3.4b) must list the members of a team who were active on a date (CAP-11, AD-2). Today the calendar reads names only for members active today, has no status versions, position or rank, and has no domain rule for "active on a date". The day lists therefore also show shifts on days a member was inactive (a deferred item from 3.3b's review).

**Approach:**
- Migration `0018` replaces `calendar_people()` with `calendar_members()`, which returns id, name and rank for every member, active or not.
- The snapshot adds status versions, positions and `uses_fire_ranks`.
- `packages/domain` gains `activeOn`, `membershipOn` and `shiftRoster`, and the day lists honour active status.
- The screen does not change. The user chose these on 2026-09-27; the Dialog is 3.4b.

## Boundaries & Constraints

**Always:**
- **Migration `0018_calendar_members.sql`:**
  - drop `public.calendar_people()`;
  - create `public.calendar_members()`, which returns `(id uuid, name text, fire_rank text)` for every member of the caller's organization, with zero rows unless the caller is active. It copies 0017's claim and helper pins, `stable security definer set search_path = ''`, `order by m.id`, and the revoke and grant.
  - The header records why, and what is newly disclosed. No policy changes, and 0017 is not edited.
- **Domain (`packages/domain/src/roster.ts`, pure, exported):**
  - `activeOn(statuses, date)`: the latest version on or before the date, and `true` when there is none, exactly as `member_active_on`.
  - `membershipOn(memberships, date)`: `{ teamId, position } | null`.
  - `shiftRoster(members, teamId, date)`: `{ memberId, position }[]` for the members active on the date whose team on it is `teamId`, in input order.
  - `MembershipVersion` gains `position: string | null`.
  - `memberScheduleOfMonth` takes `statuses`. A day the member is inactive has `teamId` and `shiftTypeId` `null`.
  - A malformed date or a duplicate date throws a `RangeError`.
- **Snapshot (`snapshot.ts`):**
  - The organization row gains `uses_fire_ranks`.
  - The org-level `team_membership_versions` embed gains `position`.
  - A new org-level embed, `member_status_versions(organization_id,member_id,active,effective_from)`.
  - The rpc becomes `calendar_members`, still one query under `CALENDAR_KEY`.
  - `people` becomes `members: { id, name, fireRank, memberships, statuses }[]`, sorted as before (`compareText(name)`, then id). The snapshot gains `usesFireRanks`, and the viewer gains `statuses`.
  - Each of the following is `CALENDAR_UNAVAILABLE`, as the existing checks are:
    - an other-tenant status or membership row;
    - a row for an unknown member;
    - a duplicate date;
    - a non-boolean `active`;
    - a `position` that is neither a string nor null;
    - a `fire_rank` that is neither a string nor null.
- **Model (`month.ts`):**
  - `filter.people` = the members active on the organization's today (`activeOn`), so 3.3b's filter behaves exactly as before.
  - The viewer's and the chosen person's day lists pass their statuses.
- **AC2 (no team):** the existing `kalendar.noTeam` already covers it. Pin it with a unit assertion.

**Ask First:** any policy change; returning a column beyond id, name and fire_rank; any change to what the screen renders.

**Never:**
- the Dialog, cell interaction or new copy (these are 3.4b's);
- roster overrides (3.6's);
- a second query key;
- rank or position read by any rule, or used as a filter;
- new dependencies or render tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Roster | A, B on Alfa on D, both active | `shiftRoster(…, Alfa, D)` = A, B with positions | N/A |
| Deactivated since | B inactive from D+10 | B on D's roster | N/A |
| Inactive on date | B inactive from D−3 | B absent; B's day list: D has no team | N/A |
| Reactivated | B inactive D−3, active D | B present on D | N/A |
| Joined later / moved | A joins Alfa D+1 / moves to Beta D | absent on D / on Beta's roster on D | N/A |
| No status version | member never versioned | active | N/A |
| Filter | B inactive today | B not among `filter.people` | N/A |
| Duplicate status date | two versions same date | — | `RangeError` (domain), `CALENDAR_UNAVAILABLE` (snapshot) |
| DB: active member caller | — | every colleague incl. inactive; id, name, fire_rank only | N/A |
| DB: inactive caller / other org / anon | — | zero / zero / 401 `42501` | N/A |

</frozen-after-approval>

## Code Map

- **Migrations:**
  - `supabase/migrations/0017_calendar_people.sql:37-66` is the template.
  - `0008_member_status.sql:65-104` defines the status table, `:169` is `member_active_on` (no version means active), and `:410` is the select policy (any active member).
  - `0014_member_fire_rank.sql:37-77` holds `uses_fire_ranks` and `fire_rank`.
  - `0015_team_position.sql:51-62` holds `position`.
- **Domain:**
  - `packages/domain/src/schedule.ts`: `MembershipVersion` :143, and `memberScheduleOfMonth` :180, whose inline latest-version loop moves to `membershipOn`.
  - Exports are in `src/index.ts:14-70`.
  - Fixtures are in `test/fixtures.ts` (`PILOT_*`, `UJ5_*`). `test/purity.test.ts` allows no imports.
- **`apps/web/src/calendar/snapshot.ts`:**
  - `CALENDAR_COLUMNS` :69-76 and `CALENDAR_PEOPLE_FUNCTION` :79;
  - `CalendarPeopleRpc` :146, `CalendarPerson` :151, `CalendarViewer` :159, `CalendarSnapshot` :168;
  - `readCalendar` :232, with the `Promise.all` at :245;
  - `membershipOf` :376, `membershipsByMemberOf` :398, `comparePeople` :424, `peopleOf` :436, `viewerOf` :471;
  - `calendarQueryOptions` :513;
  - the header comment at :48-55.
- **`apps/web/src/calendar/month.ts`:** `CalendarFilter` :445, `calendarDayListOf` :624, the person lookup ~:689, `calendarMonthOf` :707. `kalendar.tsx:132` casts the rpc client and needs only its type name.
- **Stubs:**
  - `rotation/rotation.fixture.ts`: `calendarOrganizationRow` :200, `personRow` :221, `peopleAnswerOf` :226, `calendarTableOf` :243 (make it assert the function name);
  - `snapshot.test.ts`: `answeringInTurn` :460, `seen` :106, and the columns at :133-145;
  - `month.test.ts`: `snapshotOf` :59-88.
- **DB inventories:** swap `calendar_people` for `calendar_members` in:
  - `test/rls-isolation.test.ts`: the proname list at :1113-1141, and the behaviour tests at :9570-9747, rewritten and adding a deactivated colleague and rank;
  - `test/provisioning.test.ts`: :1496-1505 and :1532-1574;
  - `test/supabase-scaffold.test.ts`: :920-947, where `fire_rank` moves from forbidden to allowed.
- **Localization:** `test/localization-applied.test.ts` :251-256, only if a new web module is added.
- **E2E:** `e2e/calendar.spec.ts` :721 and :824 (the person filter) must stay green. Nothing new is visible.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0018_calendar_members.sql` -- drop the old function, create the new one, grant -- names as at any date, with the disclosure recorded
- [x] `test/rls-isolation.test.ts`, `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts` -- the inventories and the DB matrix rows -- as 3.3b did
- [x] `packages/domain/src/roster.ts`, `schedule.ts`, `index.ts`, `test/roster.test.ts`, `test/schedule.test.ts` -- the rules, and the inactive day -- the domain matrix rows, plus a roster on each fixture
- [x] `apps/web/src/calendar/snapshot.ts`, `rotation.fixture.ts`, `snapshot.test.ts` -- the columns, the rpc, `members`, `usesFireRanks`, the viewer's statuses -- one refusal test per new validation
- [x] `apps/web/src/calendar/month.ts`, `month.test.ts`, `routes/kalendar.tsx` (type rename only) -- `filter.people` from `activeOn`, day lists with statuses, and the AC2 assertion
- [x] `sprint-status.yaml` -- `3-4-…` in-progress, with a comment on the split (3.4a landed, 3.4b the Dialog) -- and mark the 3.3b status entry in `deferred-work.md` resolved

**Acceptance Criteria:**
- Given the snapshot, when a team's roster on a date is derived, then it is the team's members active on that date, including members deactivated since (CAP-11, AD-2, FR-12).
- Given the calendar, when it renders after this change, then the screen, the person filter and every E2E test behave as before, apart from days a member was inactive.

## Design Notes

**Why replace the function, not add one.** One narrow read serves both the filter and the roster, and "active today" becomes a domain rule over status versions that RLS already exposes. The new disclosure is the names and ranks of deactivated colleagues. That is the history FR-12 keeps, and the user chose it.

**An inactive day counts as no team.** The day list then shows "Bez smjene", so no new state or copy is needed. 3.6 will layer overrides on top of `shiftRoster`.

## Verification

**Commands:**
- `supabase migration up`, then `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips. Do not reset the shared DB.
- `pnpm test:e2e` -- green. Stop Vite on 5173 first.
- `git diff --stat package.json pnpm-lock.yaml` -- empty.

## Suggested Review Order

**The read of every member**

- Entry point: one narrow read of id, name and rank, active or not, replacing 0017.
  [`0018_calendar_members.sql:44`](../../supabase/migrations/0018_calendar_members.sql#L44)

- Scoped by the claim and an active caller; no status filter, so history survives.
  [`0018_calendar_members.sql:55`](../../supabase/migrations/0018_calendar_members.sql#L55)

- The old function is dropped, not left beside it.
  [`0018_calendar_members.sql:42`](../../supabase/migrations/0018_calendar_members.sql#L42)

**The domain rules**

- "Active on a date": the latest version on or before it, active when none, as SQL.
  [`roster.ts:106`](../../packages/domain/src/roster.ts#L106)

- The team and position on a date.
  [`roster.ts:119`](../../packages/domain/src/roster.ts#L119)

- The roster as at a date: active on it and on the team then; 3.6 layers overrides here.
  [`roster.ts:134`](../../packages/domain/src/roster.ts#L134)

- Day lists now honour status: an inactive day has no team and no shift type.
  [`schedule.ts:189`](../../packages/domain/src/schedule.ts#L189)

**The snapshot**

- Status versions, positions and the rank setting join the one select.
  [`snapshot.ts:72`](../../apps/web/src/calendar/snapshot.ts#L72)

- Select and `calendar_members` still run together under `CALENDAR_KEY`.
  [`snapshot.ts:298`](../../apps/web/src/calendar/snapshot.ts#L298)

- Versions of a member the rpc missed are ignored (the race); bad rows still refused.
  [`snapshot.ts:493`](../../apps/web/src/calendar/snapshot.ts#L493)

- The viewer's history is the members entry itself; an unnamed viewer is refused.
  [`snapshot.ts:583`](../../apps/web/src/calendar/snapshot.ts#L583)

- Refusal reasons are a closed union.
  [`snapshot.ts:221`](../../apps/web/src/calendar/snapshot.ts#L221)

**The model**

- The person filter keeps offering only today's active members, now judged client-side.
  [`month.ts:735`](../../apps/web/src/calendar/month.ts#L735)

- Day lists receive memberships and statuses together.
  [`month.ts:636`](../../apps/web/src/calendar/month.ts#L636)

**Peripherals**

- DB: the deactivated colleague's name and rank come back to a member-role caller.
  [`rls-isolation.test.ts:9606`](../../test/rls-isolation.test.ts#L9606)

- Source-text shape of the new function, `fire_rank` now allowed.
  [`supabase-scaffold.test.ts:924`](../../test/supabase-scaffold.test.ts#L924)

- Rank/position sweep: exact allowlist of what `snapshot.ts` may carry.
  [`snapshot.test.ts:822`](../../apps/web/src/calendar/snapshot.test.ts#L822)

- Domain matrix rows, both fixtures, status before membership.
  [`roster.test.ts:121`](../../packages/domain/test/roster.test.ts#L121)

- Snapshot-level roster, filter and the AC2 assertion.
  [`month.test.ts:1079`](../../apps/web/src/calendar/month.test.ts#L1079)
