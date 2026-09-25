---
title: 'Story 1.8: A member sees who is on a team'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'f3353e47dba53dfd78db57fa1aa5cb9130ea092c'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member cannot see who is on a team. The database also leaks too much: `members_select_own_organization` (`0003:289`) lets any member-role session read every colleague's `email`, `leave_allowance_days`, `username` and `role` through PostgREST. CAP-5 says the roster carries names and membership only, and the epic says the database, not the interface, enforces this.

**Approach:** Narrow `members` SELECT so an active admin reads their whole organization and a member-role account reads only its own row. Add one SQL reading, `team_roster(team)`, returning the team's name, archived flag and today's active members as id plus name only. Add a read-only route `/smjene/$id` for every role. It is not a destination. `Danas` gains one line naming the caller's team today, linked to that route, or "Bez smjene". This covers epics.md story 1.8 (CAP-5, UX-DR31/32/33).

## Boundaries & Constraints

**Always:**
- Change the select policy with `alter policy members_select_own_organization … using (…)` in `0011`, adding `access.member_role = 'admin' or auth_user_id = auth.uid()`. 0003 is never edited.
- `team_roster(team uuid)` is `SECURITY DEFINER STABLE`, `search_path = ''`, executable by `authenticated` only (the four-line grant pattern).
  - It returns zero rows unless the caller is active today and the team is in the caller's own organization. Otherwise it returns one row: `(name, archived, members jsonb)`, where `members` is `[{id, name}]`.
  - Membership is `member_team_on(m, organization_today(org)) = team and member_active_on(m, today)`. Scheduled joiners and inactive members are excluded.
  - Its comment argues why the `team` argument discloses nothing a member may not already read.
- The screen sorts names with `compareText` (Croatian collation), tie-broken by id, and shows the ICU plural count (`smjene.roster.count`, one/few/other).
- All logic lives in `.ts` modules. The `.tsx` renders values it is handed. Every string goes through `t()`. New keys live under `smjene.*`. "No team" is said as `smjene.membership.none`, never with `Nema`. Controls are `h-11`.
- Danas derives the caller's team today from its own `members` row. The read embeds `team_membership_versions(team_id,effective_from,teams(name)),organizations(timezone)` and is reused through `teamVersionsIn` / `memberTeamOn`. It is one query under one key.

**Ask First:**
- Showing scheduled joiners, inactive members, or any field besides name.
- Adding a link to the roster from any other surface.

**Never:**
- No write, form, `useMutation` or `.delete(` on either surface, and no navigation destination. No change to `/ljudi/smjene/$id`, the auth function, seed or provisioning.
- No new dependency, trigger or Edge Function operation. No calendar, dashboard or schedule work beyond the Danas line.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Member reads colleagues | member-role, `select * from members` | Only own row | N/A |
| Admin reads list | admin | Every own-org row, as today | N/A |
| Roster | Team T, A and B on T today | `{T, false, [A, B]}` | N/A |
| Scheduled joiner | C moves onto T tomorrow | C absent today | N/A |
| Inactive today | D on T, deactivated from today | D absent | N/A |
| Empty team | Nobody on T | Name and a count of 0 via `smjene.roster.count` | N/A |
| Archived team | T archived | Name, archived note, count 0 | N/A |
| Foreign or unknown team | Other org's id, random uuid | Zero rows → `smjene.error.unknown` | Named, no leak |
| Inactive caller | Caller inactive today | Zero rows | N/A |
| Timezone edge | Org midnight ≠ UTC midnight | Today in org time | N/A |
| Danas with team | Caller on T today | "Tvoja smjena" + link to `/smjene/T` | N/A |
| Danas no team | No version or `team_id` null | "Bez smjene", no link | N/A |
| Read fails | RPC or own-row read errors | Alert paragraph | Message key, no values invented |

</frozen-after-approval>

## Code Map

Baseline: the current `main` HEAD. Run the suite there first and record the counts. `nvm use`, then `pnpm build` before `pnpm test`.

**Database:** new `supabase/migrations/0011_team_roster.sql`, contiguous with 0010.
- Definer precedents: `current_member_access` `0008:268-281` (STABLE definer calling VOLATILE readers, `0008:261-267`). Reuse `organization_today` `0008:138`, `member_active_on` `0008:169`, `member_team_on` `0010:118`. Grants follow `0010:204-222`.
- Copy the ALTER pattern from `0010:304`.
- Banned text in comments: `supabase-scaffold.test.ts:208-226`.

**DB tests**
- `rls-isolation.test.ts`:
  - Rewrite `:1242-1265` so a member sees exactly its own row.
  - `:3831-3866` currently expects the member's ids to equal the admin's; invert it.
  - `:3868-3925` has a loop over `[admin, member]`; the admin keeps it and the member expects zero.
  - Function lists `:979-1007`.
  - New block after the 1.7b block, covering every matrix row over both fixtures (`FIXTURES :187`). It uses `actAs :564`, `inRolledBackTransaction :242`, `insertTeam :6767`, `insertMembership :7314`, status `insertVersion :4947`, `organizationDay :4935`, plus one live REST `rpc` path per role (`tokenFor :327`).
- `supabase-scaffold.test.ts`: an altered-policy regex modelled on `:763-780`. The create-policy count at `:296` is unchanged.
- `provisioning.test.ts`: `ACCESS_CONTROL_FUNCTIONS` `:1032` (definer, `expectRunsAsOwner :311`) and `grantees` `:1062-1090`.
- `supabase/functions/admin-auth/operations.ts:738`: its comment cites the old policy; reword it.

**SPA**
- New `apps/web/src/teams/roster.ts` (+ `roster.test.ts`):
  - `TEAM_ROSTER_KEY(id)`.
  - `readTeamRoster({rpc})` with a structural rpc type (no `.rpc(` exists yet), following the outcome union of `readTeams` `teams/list.ts:123`.
  - Parse and refuse malformed input, sort, and provide `teamRosterSurfaceStateOf` and `teamRosterMessageKey` with an exhaustive `never`.
  - Also `readOwnTeamToday` for Danas: filter `auth_user_id` as `navigation/role.ts:269-272` does, reusing `teamVersionsIn` `members/list.ts:326`, `memberTeamOn` `:369` and `organizationIsoDate` `i18n/format.ts:188`.
- New `routes/smjene.$id.tsx`: keyed remount as in `ljudi.smjene.$id.tsx:67`, no `beforeLoad` (the `_app.tsx:92-122` session guard suffices), back link to `/danas`. Register it at `router.ts:42-61`.
- `routes/danas.tsx`: keep the `nav.danas` `<h1>`, and add the line.
- `hr.json`: `smjene.roster.*` and `smjene.today.*`.

**Gates** (grow counts; never loosen rules)
- `router.test.ts`: `routesById :240-270`. Not in `DESTINATION_ROUTES`, `ROLE_GUARDED_PATHS` or `LEVEL_GUARDED_ROUTES`.
- `prijava.test.ts`:
  - New screen consts `:100-102`.
  - Move `danas` from `PLACEHOLDER_SLUGS :196` to `BUILT_SLUGS :214`.
  - `SCREENS :238`, `KEY_SOURCES :1145`, lengths `:1465-1466`.
  - A one-query pin modelled on `:2334-2355`, and a no-field detector for the new screen modelled on `:2130-2204`.
- `resource-hygiene.test.ts`: `SANCTIONED_PLURAL_KEYS :37-60`, `SANCTIONED_SCREEN_KEYS :422`.
- `localization-applied.test.ts`: `SOURCES :48-183`, `AUTHORED_VOCABULARY :435-758`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0011_team_roster.sql` -- alter the members select, add `team_roster` and its grants -- this is where CAP-5 is enforced.
- [x] `test/rls-isolation.test.ts`, `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts`, `operations.ts` comment -- the matrix over both fixtures, the rewritten premises and the inventories -- proof where enforcement lives.
- [x] `apps/web/src/teams/roster.ts` + `roster.test.ts` -- readers, parse, sort, own team today, states and keys -- logic runs without a browser (AD-15).
- [x] `routes/smjene.$id.tsx`, `routes/danas.tsx`, `router.ts`, `hr.json` + gate tests -- the surfaces.
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `1-8-…` done on landing, and `epic-1` done with it (its last story); the retrospective stays optional.

**Acceptance Criteria:**
- Given a member-role session, when it selects `email`, `leave_allowance_days` or `username` of any other member via PostgREST, then no such value is returned.
- Given the roster screen at phone width, when rendered, then there is no horizontal page scroll, every control clears 44 px, and no write control exists.
- Given the navigation as member and as admin, when inspected, then `/smjene/$id` is in neither destination list, and the existing UX-DR31/32 assertions still pass.

## Design Notes

**Why one RPC and not a view:** a view over `members` either inherits the narrowed policy (members see only themselves) or bypasses RLS entirely. The definer function states its own scope: an active caller, their own organization, id and name only. It also returns the team's name with the roster, so the surface stays one snapshot under one key (`surfaces/README.md`) rather than also reading `TEAMS_LIST_KEY`.

**Danas reads its own row, not an RPC:** the own-row read with embeds needs no new function and reuses 1.7b's derivation twin, so the SQL and SPA readings of "team today" cannot drift.

## Verification

**Commands:**
- `pnpm exec supabase db reset` -- exit 0.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `git diff --stat package.json pnpm-lock.yaml apps/web/package.json` -- empty.
- Mutation probes, each of which must fail the suite:
  - drop the own-row clause (member sees nothing, and Danas breaks)
  - drop the admin clause
  - the roster ignores `member_active_on`
  - the roster includes scheduled versions
  - the roster uses UTC today
  - drop the caller-org check
  - add `email` to the roster's jsonb
  - Danas maps no-team to a blank

## Suggested Review Order

**Enforcement: CAP-5 moves into the database**

- Entry point: an admin reads everyone, a member-role account only its own row.
  [`0011_team_roster.sql:36`](../../supabase/migrations/0011_team_roster.sql#L36)

- The one roster reading: id and name only, own organization, active caller.
  [`0011_team_roster.sql:79`](../../supabase/migrations/0011_team_roster.sql#L79)

- Today computed once per team, in the organization's timezone.
  [`0011_team_roster.sql:99`](../../supabase/migrations/0011_team_roster.sql#L99)

- Executable by `authenticated` only; anonymous callers get 401 / 42501.
  [`0011_team_roster.sql:115`](../../supabase/migrations/0011_team_roster.sql#L115)

**Roster read and screen**

- A non-UUID id answers unknown without a call, so retry is never offered.
  [`roster.ts:143`](../../apps/web/src/teams/roster.ts#L143)

- Parse refuses any shape but `{id, name}`; sorts with Croatian collation.
  [`roster.ts:101`](../../apps/web/src/teams/roster.ts#L101)

- Read-only screen, one query, remounted per id, back to Danas.
  [`smjene.$id.tsx:48`](../../apps/web/src/routes/smjene.$id.tsx#L48)

- Registered under the session-only layout, not as a destination.
  [`router.ts:20`](../../apps/web/src/router.ts#L20)

**Danas: your team today**

- Own-row read with the team-history embed, one query under one key.
  [`roster.ts:320`](../../apps/web/src/teams/roster.ts#L320)

- Reuses 1.7b's derivation twin, so SQL and SPA cannot drift.
  [`list.ts:329`](../../apps/web/src/members/list.ts#L329)

- "Bez smjene" in words, or a link to the roster.
  [`danas.tsx:56`](../../apps/web/src/routes/danas.tsx#L56)

**Peripherals: proofs and inventories**

- The matrix over both fixtures, SQL first.
  [`rls-isolation.test.ts:8687`](../../test/rls-isolation.test.ts#L8687)

- Moved off, to no team, and onto another team today.
  [`rls-isolation.test.ts:8958`](../../test/rls-isolation.test.ts#L8958)

- Member-role own row over REST carries the real team and timezone.
  [`rls-isolation.test.ts:9011`](../../test/rls-isolation.test.ts#L9011)

- Admin-auth: own row still gets NOT_AN_ADMIN; a colleague is now MEMBER_UNKNOWN.
  [`rls-isolation.test.ts:4817`](../../test/rls-isolation.test.ts#L4817)

- Policy altered, not re-created, so the create-policy count holds.
  [`supabase-scaffold.test.ts:792`](../../test/supabase-scaffold.test.ts#L792)

- Definer and grantee inventories grow by `team_roster`.
  [`provisioning.test.ts:1037`](../../test/provisioning.test.ts#L1037)
