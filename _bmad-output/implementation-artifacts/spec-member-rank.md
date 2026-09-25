---
title: 'Member rank: an organization that uses fire ranks records each member''s rank and sees it on the team roster'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '44e06a07fb5a83e337416ec823d393505ec087af'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4c-brand-accent-and-lockup.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-8-team-roster.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The pilot's crews are organised by rank, but a member has no rank. This is part A of "rank and team position" (human decisions 2026-09-25). Part B, the team position on the membership, waits in `deferred-work.md`.

**Approach:**
- A new organization setting, "uses fire ranks and positions" (`uses_fire_ranks`, default off), is switched on the Organizacija screen.
- When it is on:
  - the member create and edit forms offer a rank from a fixed list;
  - the team roster shows each member's rank beside their name.
- A rank is current-state, like a name: it has no history and no versions.

## Boundaries & Constraints

**Always:**
- **Rank codes**, lowest to highest. They are stored as stable ASCII codes and labelled only through i18n:
  - `trainee` = vatrogasac pripravnik
  - `firefighter` = vatrogasac
  - `firefighter_1` = vatrogasac I. klase
  - `nco` = vatrogasni dočasnik
  - `nco_1` = vatrogasni dočasnik I. klase
  - `senior_nco` = viši vatrogasni dočasnik
  - `senior_nco_1` = viši vatrogasni dočasnik I. klase
  - `officer` = vatrogasni časnik
  - `officer_1` = vatrogasni časnik I. klase
  - `senior_officer` = viši vatrogasni časnik
  - `senior_officer_1` = viši vatrogasni časnik I. klase
- **Migration `0014`:**
  - `organizations.uses_fire_ranks boolean not null default false`, with `grant update (uses_fire_ranks)`. This mirrors `0006`.
  - `members.fire_rank text null`, with a check constraint over exactly these codes. Admins write it under the existing member policies.
  - `create or replace function public.team_roster`, whose members' jsonb adds `'fire_rank', m.fire_rank`. The signature and everything else stay the same.
- **The setting gates display and entry only; it never deletes data.** Switching it off hides the rank control and the rank everywhere, and stored ranks survive.
- **Create path:** the rank travels in the `admin-auth` `createUser` payload. It is validated strictly (a known code or absent) and inserted in the same row. An unknown value is refused, never dropped.
- **Edit path:** the rank goes in `saveMember`'s PATCH. The empty choice (`—`) stores `null`.
- **Mirror the accent pattern:**
  - a `RANK_CODES` const;
  - a test that parses the SQL check and asserts equality in both directions;
  - `rankMessageKey` returning a literal key union;
  - options `[null, ...RANK_CODES]`, in list order;
  - the setting written on its own, as a fourth disjoint `OrganizationWrite` shape, immediately on change.
- **Seed:**
  - The pilot gets `uses_fire_ranks = true`. Ivan Marić is `officer`, Ana Kovač `nco`, Marko Novak `firefighter`, and Petra Babić has no rank (the null case).
  - UJ-5 keeps the default and has no ranks.
- **UI rules:** use the `components/ui` primitives, controls `h-11`, all strings through `t()`, `Notice` for refusals, and no colour-only meaning. The rank on the roster is text.

**Ask First:**
- Versioned rank history.
- A rank column on the member list.
- Per-organization rank lists.
- Any second RPC.
- Changing the `team_roster` signature.

**Never:**
- No team position (part B).
- No automatic behaviour driven by rank.
- No word matching the organization-specifics ban in migration text (`supabase-scaffold.test.ts:195-234`; e.g. no `fire department`, `DVD`, `Croatian`).
- No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Setting on | admin switches it on | Saved, status line confirms; rank control appears on both member forms | N/A |
| Setting off with ranks stored | pilot switches it off | Ranks hidden on forms and roster, still stored; on again shows them | N/A |
| Create with rank | `nco` | Member row carries `nco` in the one insert | N/A |
| Create, bad rank | `general` via direct call | Nothing created | function refuses (400) |
| Edit to none | `—` | `fire_rank` null | N/A |
| Direct PATCH, bad rank | `general` | Nothing written | 23514 → INVALID |
| Member-role writes | rank or setting | Refused | RLS |
| Roster, setting on | pilot team | `Ivan Marić · vatrogasni časnik`; Petra shows name only | N/A |
| Roster, setting off | UJ-5 | Names only; RPC still returns `fire_rank: null` | N/A |
| Unknown code in a row | code this build lacks | Shown as an "unknown rank" option or text, never crashes | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0006_organization_accent.sql:61-80` -- the add-column + check + grant shape to copy.
- `supabase/migrations/0011_team_roster.sql:79-115` -- `team_roster` to replace. Keep `security definer`, `search_path=''` and the grants.
- `apps/web/src/organization/snapshot.ts` -- the organization read and writes:
  - `ORGANIZATION_COLUMNS` (:92), `organizationSnapshotOf` (:404)
  - `OrganizationWrite` (:223), with the guards at :238-282
  - `organizationEditColumns` (:471), `failureOf` (:516)
  - `snapshot.test.ts:203` fixtures
- `apps/web/src/organization/accent.ts` + `accent.test.ts:42-170` -- the fixed-list pattern and the SQL-parsing test.
- `apps/web/src/routes/organizacija.tsx` -- `applyAccent` (:375-431) is the immediate-save and queue pattern; the accent `<select>` (:685-738).
- `supabase/functions/admin-auth/operations.ts` -- `CreatePayload` (:424), `createPayloadOf` (:446), the insert (:662). Tests: `test/admin-auth-boundary.test.ts`.
- `apps/web/src/members/write.ts` -- `saveMember` (:473), `MEMBER_EDIT_COLUMNS` (:250), `MemberEdits` (:310), `createMember` (:555). The update body is pinned at `write.test.ts:796`.
- `apps/web/src/routes/ljudi.novi.tsx`:
  - already reads `ORGANIZATION_SNAPSHOT_KEY` (:120);
  - the role `<select>` is at :342.
- `apps/web/src/routes/ljudi.$id.tsx`:
  - the role `<select>` is at :721;
  - it must add the organization snapshot query, `useQuery(organization…)` with the shared key.
- `apps/web/src/teams/roster.ts:54-138` -- `TeamRosterMember`. Parsing is strict, so add `fireRank: string|null`. The display is `routes/smjene.$id.tsx:71-79`.
- `supabase/seed.sql:50-146` -- the pilot organization and members.
- Inventories to amend:
  - `test/supabase-scaffold.test.ts`: the org update grants (:620), the roster function regex (:828-849), which must also read the replacing migration
  - `test/rls-isolation.test.ts`: org `column_privileges` (:2130), roster keys `['id','name']` (:8910)
  - `test/resource-hygiene.test.ts`: the sanctioned keys
  - `test/localization-applied.test.ts`: `SOURCES`
  - `routes/prijava.test.ts`: `SCREENS` controls (settings 10, create 8, edit 21) and `KEY_SOURCES` strings; add a `RANK_KEYS` entry like ACCENT_KEYS (:188)

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0014_member_fire_rank.sql` -- Add the setting, the rank column, the check constraint and the grant, and replace `team_roster`.
- [x] `supabase/seed.sql` -- Seed the pilot's flag and ranks.
- [x] `supabase/functions/admin-auth/operations.ts` (+ its tests) -- Add `fireRank` to the create payload, validation and insert.
- [x] `apps/web/src/members/rank.ts` (+ `rank.test.ts`) -- Add the codes, the key union, the options, and `fireRankOf` for an unknown code. The test parses the check out of `0014`.
- [x] `apps/web/src/organization/snapshot.ts` (+ test) -- Add `usesFireRanks` to the read and a fourth write shape.
- [x] `apps/web/src/members/write.ts`, `members/wire.ts` (+ tests) -- Carry `fireRank` through the edit PATCH and the create payload.
- [x] `apps/web/src/teams/roster.ts` (+ test) -- Parse `fire_rank`.
- [x] `apps/web/src/routes/organizacija.tsx`, `ljudi.novi.tsx`, `ljudi.$id.tsx`, `smjene.$id.tsx` -- Add the setting control, the rank select (only when the setting is on) and the roster text.
- [x] `apps/web/src/i18n/locales/hr.json` -- Add the setting label and status, 11 rank labels, "no rank" and "unknown rank".
- [x] Root and screen inventories listed in the Code Map -- Amend them. Add RLS tests for the rank check (23514), a member-role refusal, a setting write by admin and by member role, and the roster returning `fire_rank`.

**Acceptance Criteria:**
- Given `pnpm exec supabase db reset`, when the pilot roster RPC is called, then each entry carries `id`, `name` and `fire_rank` with the seeded values.
- Given the setting off, when any screen renders, then no rank control or rank text appears.

## Design Notes

A fire-specific list sits in core schema only behind an organization setting. That is the price of a fixed list, which was chosen over per-organization lists (human decision). A later organization type would add its own setting rather than reuse this one. The migration names no organization, so the scaffold ban holds. `fire_rank`, not `rank`, because `rank` already means role ordering in `navigation/role.ts`.

## Verification

**Commands:**
- `pnpm exec supabase db reset` -- exit 0. This is a shared stack. The human approved the reset on 2026-09-25, knowing other worktrees' DB inventory tests fail until they rebase.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips.
- Mutation probes that must fail the suite:
  - drop one code from the check;
  - grant `uses_fire_ranks` to nobody;
  - drop `fire_rank` from `team_roster`;
  - silently drop an unknown `fireRank` in the function.

**Manual checks:**
- At 390 px: the setting control and the rank select are 44 px and there is no horizontal scroll.

## Suggested Review Order

**Schema: a gated, fixed-list rank**

- Entry point: rank is a nullable code under a check of exactly eleven.
  [`0014_member_fire_rank.sql:65`](../../supabase/migrations/0014_member_fire_rank.sql#L65)

- The setting: boolean, default off, its own column grant.
  [`0014_member_fire_rank.sql:38`](../../supabase/migrations/0014_member_fire_rank.sql#L38)

- Roster RPC replaced in place; only `fire_rank` added to each member.
  [`0014_member_fire_rank.sql:95`](../../supabase/migrations/0014_member_fire_rank.sql#L95)

**Rank rules in one executed module**

- Codes in list order, pinned to the SQL check by `rank.test.ts`.
  [`rank.ts:30`](../../apps/web/src/members/rank.ts#L30)

- What an edit sends: untouched stored codes survive, unknown ones too.
  [`rank.ts:188`](../../apps/web/src/members/rank.ts#L188)

- A stored code this build lacks reads as unknown, never as no rank.
  [`rank.ts:79`](../../apps/web/src/members/rank.ts#L79)

- The setting's queue, refusal and follow-up rules, out of the `.tsx`.
  [`rank.ts:256`](../../apps/web/src/members/rank.ts#L256)

- Roster label, lowercase beside a name, only when the setting is on.
  [`rank.ts:212`](../../apps/web/src/members/rank.ts#L212)

**Write paths**

- Create: strict payload check, unknown refused, rank in the one insert.
  [`operations.ts:509`](../../supabase/functions/admin-auth/operations.ts#L509)

- Edit: PATCH carries `fire_rank` only when offered, null for none.
  [`write.ts:501`](../../apps/web/src/members/write.ts#L501)

- The setting as a fourth disjoint organization write.
  [`snapshot.ts:232`](../../apps/web/src/organization/snapshot.ts#L232)

**Screens**

- Setting select: saves on change, remounts to the row on refusal.
  [`organizacija.tsx:877`](../../apps/web/src/routes/organizacija.tsx#L877)

- One drain after every handler, so writes never interleave.
  [`organizacija.tsx:549`](../../apps/web/src/routes/organizacija.tsx#L549)

- Edit form sends the rank through `rankEditOf`, one call.
  [`ljudi.$id.tsx:647`](../../apps/web/src/routes/ljudi.$id.tsx#L647)

- Create form, same helper with no stored rank.
  [`ljudi.novi.tsx:198`](../../apps/web/src/routes/ljudi.novi.tsx#L198)

- Roster: `Ivan Marić · vatrogasni časnik`, as text.
  [`smjene.$id.tsx:99`](../../apps/web/src/routes/smjene.$id.tsx#L99)

**Reads**

- Roster entries must carry `fire_rank`, text or null.
  [`roster.ts:128`](../../apps/web/src/teams/roster.ts#L128)

- Member rows read the rank for the form; a non-text value refuses the row.
  [`list.ts:663`](../../apps/web/src/members/list.ts#L663)

**Peripherals**

- Pilot switched on with three ranks and one null; UJ-5 untouched.
  [`seed.sql:93`](../../supabase/seed.sql#L93)

- The list-to-constraint pin, both directions and order.
  [`rank.test.ts:39`](../../apps/web/src/members/rank.test.ts#L39)
