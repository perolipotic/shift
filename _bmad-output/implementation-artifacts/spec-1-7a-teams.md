---
title: 'Story 1.7a: An admin creates, renames and archives teams'
type: 'feature'
created: '2026-09-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: '04f8768b372f81bca365db8c51d23a9230a6e7ae'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No `teams` table exists, so the rotation (Epic 2) has nothing to project onto and membership (1.7b) nothing to point at. An admin cannot name the teams their organization runs.

**Approach:** Add a current-state `teams` table (AD-2 versions membership, not the team) with RLS: own-organization members read, own-organization active admins create, rename and archive. There is no delete path; archiving is one-way and freezes the row. A new admin screen `/ljudi/smjene` lists active and archived teams with counts and creates one; `/ljudi/smjene/$id` renames or archives. Epics.md story 1.7 acceptance clauses 1 and 4 (CAP-6, DI-8, R7.6).

## Boundaries & Constraints

**Always:**
- Any count works identically, including zero and one; no code, test fixture name, constant or copy assumes four, and nothing branches on a team's name (DI-8).
- "Remove" always archives — no DELETE policy, DELETE revoked. Archive is `archived boolean not null default false` (`timestamptz` is reserved for `created_at`). The update policy's USING admits only `archived = false`, so an archived row can never be renamed or unarchived. Human decision 2026-09-23.
- Name: `btrim(name) <> ''`, trimmed by the client; unique per organization case-insensitively **among non-archived teams** (partial unique index), so an archived name can be reused.
- Archived teams stay readable to every own-organization member and are shown on the screen in their own labelled group, with a count.
- `unique (organization_id, id)` on `teams` so 1.7b can take a composite FK.
- Every string through `t()` and every gate; `Smjena` means Team only. Controls `h-11`; a refused save names the problem and keeps the entered value; archive uses neutral styling and one confirmation naming the team.

**Ask First:**
- Unarchiving, deleting an unreferenced team, or any per-team attribute beyond the name.

**Never:**
- No membership, no `team_id` on `members`, no team filter on the member list — 1.7b.
- No seeded teams in `seed.sql` (attribution would need a forged `created_by`); tests create their own.
- No trigger, no function, no new dependency, no new navigation destination.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create 1, then 4, then 9 | Admin, fresh org | Each count listed and counted identically | N/A |
| Empty name | `"   "` | Refused, nothing written | Named refusal, value kept |
| Duplicate active name | `" noć "` while `Noć` active | Refused | Named refusal |
| Reuse archived name | `Noć` archived | Admitted | N/A |
| Rename | Active team | Name changes; id unchanged | N/A |
| Archive | Active team, confirmed | Row kept, `archived = true`, listed under archived | N/A |
| Rename or unarchive archived | Archived team | Zero rows updated | Stale refusal: screen no longer matches |
| Delete | Any caller via PostgREST | Refused, row kept | Permission refusal |
| Member-role write | Insert/update | Refused | RLS |
| Member-role read | Own org | Sees active and archived teams | N/A |
| Foreign org | Read or write other org's team | Zero rows / refused | RLS |
| No teams | Fresh org | Screen states `0 smjena` in words, offers create | N/A |

</frozen-after-approval>

## Code Map

Baseline `04f8768`; run the suite there first and record the real counts (1.6 recorded none after merge). `nvm use` (24.19.0); `pnpm build` before `pnpm test`.

**Database** — new `supabase/migrations/0009_teams.sql` (numbering `supabase-scaffold.test.ts:81-108`).
- Shape per `0008:64-106`: `organization_id` first with cascade, `id` default, `name`, `archived`, attribution defaults, `(organization_id, id)` unique, RLS on, `(organization_id)` index. Username uniqueness precedent `0007:92`.
- Policies: select copies `0003:289-299`; insert copies `0008:441-449` (pins `created_by`); update copies `0003:331-351` plus `archived = false` in USING. Grants per `0008:541-553`: insert on `(organization_id, name)`, update on `(name, archived)`, revoke delete/truncate/references/trigger and all of `anon`.
- Migration text bans `supabase-scaffold.test.ts:196-235` — **"four teams"**, `dan|noć|slobodno`, zones, fixture names — comments included. No "create constraint trigger" (`:176-182`).

**DB tests** — inventories: `supabase-scaffold.test.ts:317-346` (policy names), `:635-686` (verbs; add "no DELETE on teams"); `rls-isolation.test.ts:925-943` (policy list, message "nine" `:930`), `:218-220` `OWN_ORGANIZATION_READS` add `teams`; `provisioning.test.ts:750-773` (RLS tables), `:775-793` (privilege matrix pattern), `:826` anon readers stay two. Harness: `actAs` `:554-568`, `inRolledBackTransaction` `:232-241`, `tokenFor`/`rest` `:317,:360`; templates `:1774`/`:2158` (update), `:4162` (REST insert), `:1226` (member refusal). Fixtures `:182-197`.

**Surface** — new `apps/web/src/teams/{list,write}.ts` (+ tests) copying `members/list.ts` (key `:69`, failures `:170-174`, row validation `:480`, reader `:585`, message key `:1054`, role guard `mayReadMembers` `:691`) and `members/write.ts:458-509` (zero rows = refused/stale `:492-496`) with `wire.ts:451` `editFailureOf` and an exhaustive message switch like `:492`. `23505` → name taken, `23514` → empty. No `useMutation`; pending ref + `invalidateQueries` (`ljudi.novi.tsx:200`).
- Routes `routes/ljudi.smjene.tsx`, `routes/ljudi.smjene.$id.tsx`, registered in `router.ts`; `router.test.ts:212-251` `routesById`, `:191-206` `LEVEL_GUARDED_ROUTES`, and a static-wins assertion like `:1602` for `/ljudi/smjene` over `/ljudi/$id`. Ljudi tab lights via `destinations.ts:138`; destinations stay 8.
- Links: `ljudi.tsx` → Smjene, and Smjene → Ljudi. `ljudi.tsx` must keep one query (`prijava.test.ts:2184-2199`); give the teams list the same one-query assertion.

**Terminology gates** — `resource-hygiene.test.ts:561-569` bans `smjen` in every message: narrow it to keys outside the teams namespace, keep its self-test `:694-700` meaningful. `localization-applied.test.ts:766` bans `Smjena|Smjene|smjena` by substring in chunks: move each shipped word into `AUTHORED_VOCABULARY` (`:435-747`) with its count; `Nema` stays banned. Namespace keys `smjene.*`, never `smjena.*` (the key itself would ship the substring). Plurals as ICU (`hr.json:31-34` feminine pattern) in `SANCTIONED_PLURAL_KEYS` `:37`; others in `SANCTIONED_SCREEN_KEYS` `:70`; imperative pins `:616-679`. `SOURCES` `:48`. `prijava.test.ts` `SCREENS`/`expectedControls` `:234-329` (length 16 `:1341`), `KEY_SOURCES` `:1088` (21 `:1342`), `FORM_SCREENS` `:341`, in-flight pins `:3112,:3122`.

**Status** — `sprint-status.yaml`: `1-7-…` → `in-progress`, add `1-7a-teams` under the split convention comment.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0009_teams.sql` -- table, index, policies, grants -- the whole enforcement.
- [x] `test/rls-isolation.test.ts`, `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts` -- every matrix row over both fixtures (SQL and one live REST path per verb); forged `created_by` refused; inventories moved -- the database is where the matrix is proven.
- [x] `apps/web/src/teams/list.ts`, `teams/write.ts` (+ tests) -- read, validate rows, split active/archived with counts, create/rename/archive with failure mapping, pure surface state -- logic executable without a browser (AD-15).
- [x] `apps/web/src/routes/ljudi.smjene.tsx`, `ljudi.smjene.$id.tsx`, `ljudi.tsx`, `router.ts`, `hr.json` + gate tests -- the two screens and the cross-links.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- keys per Code Map.

**Acceptance Criteria:**
- Given an org with one, four and then nine teams, when the list renders, then counts and plural forms are correct at each and the same code path produced all three.
- Given an archived team, when anyone in the org reads teams, then it is returned unchanged with `archived = true`.
- Given the teams screens at phone width, when used, then every control clears 44 px with no horizontal page scroll.

## Verification

**Commands:**
- `pnpm exec supabase db reset` -- exit 0.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `git diff --stat package.json pnpm-lock.yaml apps/web/package.json` -- empty.
- Mutation probes, each must fail the suite: add a DELETE policy; drop `archived = false` from USING; make the unique index total instead of partial; drop the `created_by` pin; map `23505` to the generic message; hard-code a team count anywhere.

## Suggested Review Order

**Enforcement: the table and its policies**

- Entry point: current-state table, composite key ready for 1.7b's membership FK.
  [`0009_teams.sql:27`](../../supabase/migrations/0009_teams.sql#L27)

- `archived = false` in USING makes archive one-way with no trigger.
  [`0009_teams.sql:108`](../../supabase/migrations/0009_teams.sql#L108)

- Partial unique index: active names unique ignoring case; archived names reusable.
  [`0009_teams.sql:66`](../../supabase/migrations/0009_teams.sql#L66)

- Insert pins `created_by`; every policy requires an active own-organization caller.
  [`0009_teams.sql:88`](../../supabase/migrations/0009_teams.sql#L88)

- No delete policy, delete revoked, column grants keep attribution unforgeable.
  [`0009_teams.sql:143`](../../supabase/migrations/0009_teams.sql#L143)

**Client write path and refusal mapping**

- 23505 → name taken, 23514 → empty, 42501 → refused; one exhaustive map.
  [`write.ts:103`](../../apps/web/src/teams/write.ts#L103)

- Zero rows back reads as stale: the screen no longer matches the database.
  [`write.ts:168`](../../apps/web/src/teams/write.ts#L168)

- Form key excludes the name, so a refused rename never loses typed text.
  [`write.ts:304`](../../apps/web/src/teams/write.ts#L304)

- Create takes the tenant from the token claim, keeping the list to one read.
  [`write.ts:200`](../../apps/web/src/teams/write.ts#L200)

**Read path and the two screens**

- Exact-count read; zero rows is a valid empty answer, never a refusal.
  [`list.ts:123`](../../apps/web/src/teams/list.ts#L123)

- Active/archived split; archived rows get a view label, not edit.
  [`list.ts:194`](../../apps/web/src/teams/list.ts#L194)

- List screen: counts in words, create form, only confirmations are live regions.
  [`ljudi.smjene.tsx:75`](../../apps/web/src/routes/ljudi.smjene.tsx#L75)

- Detail screen keyed by id so state never leaks between teams.
  [`ljudi.smjene.$id.tsx:70`](../../apps/web/src/routes/ljudi.smjene.$id.tsx#L70)

- Archive: one neutral confirmation, its own refusal, its own success message.
  [`ljudi.smjene.$id.tsx:158`](../../apps/web/src/routes/ljudi.smjene.$id.tsx#L158)

- Static `/ljudi/smjene` registered to win over `/ljudi/$id`.
  [`router.ts:57`](../../apps/web/src/router.ts#L57)

- Cross-link from the member list; no new navigation destination.
  [`ljudi.tsx:253`](../../apps/web/src/routes/ljudi.tsx#L253)

**Terminology gates**

- `smjen` now allowed only inside `smjene.*`, still refused as a shift type.
  [`resource-hygiene.test.ts:497`](../../test/resource-hygiene.test.ts#L497)

- Team words move from banned to counted authored vocabulary; `Nema` stays banned.
  [`localization-applied.test.ts:755`](../../test/localization-applied.test.ts#L755)

**Peripherals: proofs and inventories**

- Deactivated admin: insert without RETURNING, so the select policy can't mask it.
  [`rls-isolation.test.ts:6169`](../../test/rls-isolation.test.ts#L6169)

- The I/O matrix over both fixtures, SQL then live PostgREST.
  [`rls-isolation.test.ts:6741`](../../test/rls-isolation.test.ts#L6741)

- RLS-enabled tables and the privilege matrix grow by `teams`.
  [`provisioning.test.ts:758`](../../test/provisioning.test.ts#L758)

- Source inventory: policy names, and deliberately no DELETE policy.
  [`supabase-scaffold.test.ts:338`](../../test/supabase-scaffold.test.ts#L338)
