---
title: 'Team position: a member''s position in their team is recorded from a date and shown on the roster'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '7381a15ba96d11c76b8a2d914cfd46ad38a55ae4'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-member-rank.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-7b-team-membership.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The pilot's crews are a commander, a driver and firefighters, but a membership records only the team. This is part B of "rank and team position" (human decisions 2026-09-25). Part A (`spec-member-rank.md`) shipped the setting and the rank.

**Approach:**
- A fixed-list `position` goes on `team_membership_versions`.
- A position change is a new membership version from a date. It is the same team with a different position, under the existing versioning rules.
- When the organization's `uses_fire_ranks` setting is on:
  - the member edit screen offers a position beside the team move;
  - the roster shows each member's position.

## Boundaries & Constraints

**Always:**
- **Codes:** `commander` = zapovjednik, `driver` = vozač, `firefighter` = vatrogasac. They are stored as codes and labelled only through i18n, under `smjene.position.*`. There is no limit per team.
- **Migration `0015`.** It is forward-only; `0010` is untouched.
  - `position text null`, with a check over the three codes and `team_id is null ⇒ position is null`. There is no column default and no trigger.
  - A new reader, `member_team_version_on(member, date) returns table(team_id, position)`, written in the style of `shift_type_times_on` and granted like `0010`'s helpers.
  - The insert policy is altered, not recreated:
    - "changes the value" becomes "team OR position differs from the latest version";
    - a version with a team in an organization with `uses_fire_ranks` on must carry a position.
    - Every other conjunct stays as it is.
  - `grant insert (position)`.
  - `team_roster` is replaced again. Each member adds `'position'`: the position in effect today, or null.
- **Position is required only while the setting is on** (human decision 2026-09-25, confirmed at approval). With the setting off, the client sends `null`. Default choice when the setting is on: `firefighter` for a move into a team, and the current position for an unchanged team.
- **Offer:** while the setting is on and the member is in a team, the current team stays choosable, so a position-only change is possible. The unchanged preflight refuses only when both team and position are unchanged. A scheduled change still offers only withdraw.
- **Reads:** `team_membership_versions(team_id,position,effective_from,teams(name))` in both `MEMBERS_COLUMNS` and `OWN_TEAM_COLUMNS`. The parsers require `position` as a known code, null, or an unknown code kept as-is (the pattern of rank's `fireRankOf`).
- **Copy:** the confirmation prompt names the position when it changes. Labels are nouns and actions are imperatives, as the hygiene rules require.
- **Fix the pre-existing duplicate React key while here:** the sibling blocks keyed `statusBlockKey` and `teamBlockKey` both equal `member.id` for a member with no versions. Prefix the keys so they differ, and add a unit test.
- **E2E:** add `e2e/team-position.spec.ts`, which mirrors `fire-ranks.spec.ts`:
  1. switch the setting on;
  2. move a fresh member onto a fresh team as `driver`;
  3. the roster shows it, for the admin and for the member role;
  4. a position-only change to `commander`, from a later date, is scheduled.

**Ask First:**
- A column default.
- A trigger.
- Any limit per team.
- Changing `0010`'s other conjuncts.
- Positions on anything but memberships.

**Never:**
- No automatic assignment or suggestion driven by position.
- No coverage warnings.
- No text in the migration that matches the organization-specifics ban (`supabase-scaffold.test.ts:195-234`).
- No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Move in, setting on | team A, `driver`, today | Version (A, driver); roster `Ime · vozač` | N/A |
| Position-only change | in A as driver → A commander, later date | Scheduled version (A, commander); roster shows driver until that date | N/A |
| Nothing changed | A driver → A driver | Nothing sent | preflight UNCHANGED |
| Setting on, team without position | direct insert, position null | Refused | RLS 42501 |
| No team with position | team null, `driver` | Refused | 23514 |
| Setting off | move into A | Sent with position null; no position control; roster names only | N/A |
| Unknown code | direct insert `chief` | Refused | 23514 |
| Member role | any insert | Refused | RLS |
| Legacy version, setting on | (A, null) from before | Offered; default firefighter; roster name only | N/A |
| Fresh member edit screen | no status, no team versions | No duplicate-key warning | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0010_team_membership.sql` -- READ ONLY.
  - The insert WITH CHECK is at :252-280: conjunct 6 "changes the value" at `team_id is distinct from member_team_on(...)`, conjunct 7 at :275.
  - Helpers at :118-222; grant at :333.
- `supabase/migrations/0013_shift_types.sql:180,308-337` -- the multi-column "changes the value" precedent, through a table-returning reader to avoid the 42P17 recursion.
- `supabase/migrations/0014_member_fire_rank.sql:95-129` -- the current `team_roster`, to replace again.
- `apps/web/src/members/write.ts:1261-1580` -- `teamOfferOf` (:1332), `teamPickerDefault` (:1377), `teamPreflightOf` (:1400; unchanged at :1427), `teamFailureOf` (:1446), `sendTeam` (:1467), `changeMemberTeam` (:1500), `teamPromptKeyOf` (:1545), `teamBlockKey` (:1557). The status block key is at :1219.
- `apps/web/src/members/list.ts` -- `MEMBERS_COLUMNS` :120, `teamVersionsIn` :342, `MemberTeamVersion` :315, `memberTeamOn` :385.
- `apps/web/src/teams/roster.ts` -- `OWN_TEAM_COLUMNS` :271, `teamRosterOf` :111.
- `apps/web/src/members/rank.ts` -- `ranksShown` :202, `rosterRankMessageKey` :212 (the pattern), `fireRankOf` (the unknown-code pattern).
- `apps/web/src/routes/ljudi.$id.tsx` -- `offersRank` :287, `renderTeamPicker` :1204, the confirmation at :1265, the sibling blocks at :999/:1144.
- `apps/web/src/routes/smjene.$id.tsx:83-112` -- the roster item.
- `e2e/fire-ranks.spec.ts`, `e2e/support/fixture.ts:192-205` -- the fixture's raw membership insert. The org has the setting off, so a null position is valid there.
- Inventories to amend:
  - `test/rls-isolation.test.ts`: `membershipsOf` columns (:7542), the function list (:1055), the roster keys (:9364), the restated embeds (:3744, :8593, :8649, :9165)
  - `test/supabase-scaffold.test.ts`: the membership grant (:758) and "changes the value" (:780), which must read the altered policy in `0015`; roster "exactly once" (:863-887)
  - `test/provisioning.test.ts`: :1080-1119, and the function ACLs (:1322/:1339)
  - `routes/prijava.test.ts`: controls (:370), strings (:1608, :1640, :1459), `ROSTER_FIELDS` (:2935)
  - `test/resource-hygiene.test.ts`: the sanctioned keys
  - `test/localization-applied.test.ts`: `SOURCES`

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0015_team_position.sql` -- Add the column and the checks, the reader and its grants, the altered insert policy, the grant, and the replaced `team_roster`.
- [x] `apps/web/src/members/position.ts` (+ test) -- Add the codes, `positionOf` (with the unknown-code case), the message keys (form and roster), and the gate built on `ranksShown`. The test parses the check out of `0015`.
- [x] `apps/web/src/members/list.ts`, `teams/roster.ts` (+ tests) -- Read `position` in both embeds and on the roster.
- [x] `apps/web/src/members/write.ts`, `members/wire.ts` (+ tests) -- Add the position in the offer, default, preflight, send, prompt and block key, and prefix the status and team keys.
- [x] `apps/web/src/routes/ljudi.$id.tsx`, `smjene.$id.tsx` -- Add the position select (only when gated) and the roster text.
- [x] `apps/web/src/i18n/locales/hr.json` -- Add `smjene.position.*`, the position prompt and confirmation keys, and the roster form with position.
- [x] `e2e/team-position.spec.ts` -- The E2E case described above.
- [x] Inventories in the Code Map -- Amend them. Add RLS cases for every matrix row that reaches the database.

**Acceptance Criteria:**
- Given `pnpm exec supabase db reset`, when the whole suite runs, then it passes with no skips.
- Given the setting off, when a member moves team, then no position control appears and the stored version has a null position.

## Design Notes

"Required while in a team" is enforced in the insert policy, conditioned on the organization's setting, rather than as a column check. A column check cannot read `organizations`, and the setting can be switched on after memberships exist. Versions written earlier keep a null position, and the offer treats that as "choose one". Versioning the position with the team means a promotion to commander from next month is scheduled and can be withdrawn, exactly like a move.

## Verification

**Commands:**
- `pnpm exec supabase db reset` -- exit 0. The human approved shared-stack resets for this series on 2026-09-25. Tell them other worktrees need to rebase.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips.
- `pnpm test:e2e` -- all pass. First stop any dev server on 127.0.0.1:5173 and any `supabase functions serve` started from another checkout (the human approved stopping the main checkout's on 2026-09-25), so this branch's code is what gets tested; the orchestrating session restarts the main checkout's afterwards.
- Mutation probes that must fail the suite:
  - revert "changes the value" to team-only;
  - drop the setting conjunct;
  - drop `position` from `team_roster`;
  - let `teamOfferOf` exclude the current team.

## Suggested Review Order

**Schema: position versioned with the team**

- Entry point: the insert policy, altered — team OR position must change; position required fail-closed.
  [`0015_team_position.sql:115`](../../supabase/migrations/0015_team_position.sql#L115)

- Three named codes, and no position without a team.
  [`0015_team_position.sql:52`](../../supabase/migrations/0015_team_position.sql#L52)

- Roster: one lateral read of today's version gives both team and position.
  [`0015_team_position.sql:197`](../../supabase/migrations/0015_team_position.sql#L197)

- Column grant unioned with 0010's four.
  [`0015_team_position.sql:163`](../../supabase/migrations/0015_team_position.sql#L163)

**The offer: setting-aware, derived outside the screen**

- Setting pending or failed offers no move — never a silent null send.
  [`write.ts:1517`](../../apps/web/src/members/write.ts#L1517)

- Snapshot → offer → position to send, in one tested derivation.
  [`write.ts:1538`](../../apps/web/src/members/write.ts#L1538)

- Current team stays choosable while positions are on.
  [`write.ts:1361`](../../apps/web/src/members/write.ts#L1361)

- Default: current position on the same team, firefighter otherwise.
  [`write.ts:1482`](../../apps/web/src/members/write.ts#L1482)

- Unchanged vs position-unchanged vs position-required, chosen by the setting.
  [`write.ts:1674`](../../apps/web/src/members/write.ts#L1674)

- 42501 with a team and no position reads as position required.
  [`write.ts:1728`](../../apps/web/src/members/write.ts#L1728)

- Scheduled position-only change reads as a position, not a move.
  [`write.ts:1628`](../../apps/web/src/members/write.ts#L1628)

- Status and team block keys prefixed: the duplicate React key is gone.
  [`write.ts:1874`](../../apps/web/src/members/write.ts#L1874)

**Codes, labels and the roster line**

- Three codes, pinned to 0015's check; unknown codes kept, never nulled.
  [`position.ts:28`](../../apps/web/src/members/position.ts#L28)

- Roster line: name, rank, position, or both — all four branches tested.
  [`position.ts:167`](../../apps/web/src/members/position.ts#L167)

**Screens and reads**

- The edit screen makes one call for the whole offer.
  [`ljudi.$id.tsx:382`](../../apps/web/src/routes/ljudi.$id.tsx#L382)

- Position select, keyed to the picked team.
  [`ljudi.$id.tsx:1353`](../../apps/web/src/routes/ljudi.$id.tsx#L1353)

- Roster renders the line the module decides.
  [`smjene.$id.tsx:105`](../../apps/web/src/routes/smjene.$id.tsx#L105)

- Both membership embeds read `position`.
  [`list.ts:127`](../../apps/web/src/members/list.ts#L127)

**Peripherals**

- E2E: in as driver, schedule commander, withdraw it.
  [`team-position.spec.ts:104`](../../e2e/team-position.spec.ts#L104)

- E2E: the exact rank-and-position roster line.
  [`fire-ranks.spec.ts:66`](../../e2e/fire-ranks.spec.ts#L66)
