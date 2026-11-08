---
title: 'Story 13.1: Absence types are organization data'
type: 'feature'
created: '2026-11-08'
status: 'done'
baseline_commit: '30c1dde6e518a53fda0df2da72c66a286967a2f7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every leave record is implicitly annual leave, so an organization cannot record sick leave or training without charging the allowance. Epic 13 needs absence types as organization data before any surface can choose one.

**Approach:** Database layer only (the screen is 13.1b). Migration `0052` adds `absence_types` (a name and `draws_allowance`, nothing else), seeds **annual leave** (*Godišnji odmor*, drawing) in every organization, and gives every leave record an `absence_type_id` that defaults to annual leave, so every existing and every newly written record is annual leave and every figure reads as before.

## Boundaries & Constraints

**Always:**
- Q5: no reason, diagnosis or free-text column on `absence_types` or `leave_records`.
- Annual leave has one fixed id, `00000000-0000-0000-0000-000000000001`, in every organization; the table's key is `(organization_id, id)`. `leave_records.absence_type_id` is `not null default` that id, with a composite FK to `absence_types (organization_id, id)`, no cascade. No trigger on `leave_records` (AD-3).
- Every organization has annual leave: the migration seeds existing ones; an `AFTER INSERT` row trigger on `organizations` (definer, `search_path = ''`) seeds each new one. It refuses nothing and computes nothing.
- Annual leave may be renamed, is never deleted, and always draws (check `id <> <annual id> or draws_allowance`). `draws_allowance` of any other type is current-state and may change (13.2 decides on a warning).
- Names follow 0024/0036: `private.name_key(name) <> ''`, `char_length(name) <= 100`, unique on `(organization_id, private.name_key(name))`.
- RLS, like 0012's hour bands: an active admin of the token's organization selects, inserts `(organization_id, name, draws_allowance)` and updates `(name, draws_allowance)`. Member-role accounts read nothing. No delete grant or policy. `anon` holds nothing.
- **Existing data — what is migrated and what stays unchanged:**
  - Leave records (live and removed): each gets annual leave through the column default when the column is added; `during`, attribution and removal are untouched, so every cost, balance, conflict and report figure is identical.
  - Leave requests and decisions: no column; an approval inserts a record that defaults to annual leave, as it means today. 13.2 adds the request's type.
  - Allowances (`members.leave_allowance_days`): unchanged (13.3).
  - Reports (Sati, Excel, leave overview, tiles), conflicts, staffing, notifications and outbox operands: unchanged; nothing reads the type yet.
  - `amend_leave_record` (0043), `decide_leave_request` (0046), `replace_conflict_member` (0036), the deactivation close (0041): unchanged; their inserts take the default.
- Sessions get no privilege on `leave_records.absence_type_id` in 13.1: amend copies no type yet, so a non-annual record must not be writable before 13.2 carries the type through amend and approval.
- Pilot sick leave (epic AC 3): Not confirmed by the product owner as of 2026-11-08; if recorded, the type name is visible only to admins and the member (GDPR Art. 9(2)(b)).

**Ask First:** any change to a leave function, the domain balance or a report; any `apps/web` change beyond what a test needs.

**Never:** a UI (13.1b); a type delete (deferred); member-role read of types (13.2); a type filter in `packages/domain` or a report, or a type on `leave_requests` (13.2); touching allowances (13.3); applying `0052` to the local stack or running DB-connecting root tests locally.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Backfill | org with live and removed records | one annual type; every record names it | N/A |
| New org | operator inserts an organization | its annual leave row exists | N/A |
| Define | admin inserts *Bolovanje*, not drawing | stored | N/A |
| Duplicate | admin inserts ` godišnji odmor ` | refused | 23505 |
| Annual non-drawing / blank name | update annual `draws_allowance = false`; name of spaces | refused | 23514 |
| Member, other tenant, delete | member-role select; insert for another org; any delete | no rows; refused; refused | 42501 / 0 rows |
| Leave insert | admin inserts a leave record naming no type | record is annual leave | N/A |

## Epic AC Deviations

- AC 1 ("When an admin defines one / Then it has a name and whether it draws down the allowance…"): NARROWED. 13.1 delivers defining a type at the database and API level (table, policies, grants, tested in CI). The *Organizacija* screen to define and edit types is story 13.1b (`13-1b-the-admin-defines-absence-types-on-organizacija`), split at this spec's checkpoint (product owner, 2026-11-08) to keep each spec in scope; `deferred-work.md` holds its entry.
- AC 3 ("whether the pilot records sick leave at all is recorded in the story spec"): met. Recorded under Always: not confirmed by the product owner as of 2026-11-08.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0028_leave_records.sql` -- the table, policies and column grant that 0052 extends (grant stays `organization_id, member_id, during`)
- `supabase/migrations/0012_hour_bands.sql`, `0036_named_refusals_and_rotation_archives.sql:390-406` -- current-state org data shape, policies, name length checks
- `supabase/migrations/0024_name_key.sql` -- `private.name_key`
- `supabase/migrations/0043_notification_events.sql:189-254,533-542` -- definer trigger function form and its `revoke execute`
- `supabase/migrations/0043:738`, `0046:100`, `0036:466`, `0041:316` -- leave-record inserts relying on the default (read-only)
- `test/supabase-scaffold.test.ts` (~926, ~1255, ~3321) -- migration-text pins; add a 0052 block
- `test/provisioning.test.ts:690-745, 889-905` -- RLS table list and privilege probes
- `test/name-key.test.ts:110-160, 350` -- name tables lists
- `test/rls-isolation.test.ts` (~17072) -- leave isolation cases; add absence-type cases
- `test/demo-organization.test.ts:132,200,677` -- demo org content; annual leave now appears
- `e2e/utils/database-helper.ts` -- unchanged: the new table references only `organizations`, the FK runs from `leave_records` to it, and e2e never deletes organizations
- `ARCHITECTURE-SPINE.md:50-71` -- AD-2 table and amendment clauses

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0052_absence_types.sql` -- table, checks, index, RLS, grants; seed annual leave per organization; org seeding trigger and its function with `revoke execute`; `leave_records.absence_type_id` default, FK, index -- in that order so the FK validates
- [x] `_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md` -- AD-2 row *Absence type: Current-state* and an `Amended 2026-11-08 (story 13.1)` clause naming the fixed annual id, the default and the seeding trigger
- [x] `test/supabase-scaffold.test.ts` -- pin 0052's shape: no free-text column, the default and FK, the annual check, grants, no delete, the trigger
- [x] `test/provisioning.test.ts`, `test/name-key.test.ts`, `test/demo-organization.test.ts` -- add `absence_types` where tables are listed; privilege probes; demo content includes annual leave
- [x] `test/rls-isolation.test.ts` -- the matrix's DB cases (CI only)

**Acceptance Criteria:**
- Given the migrated database, when any balance, Sati, Excel or conflict view renders, then it equals its pre-migration value (no `apps/web` or `packages/domain` change).
- Given an approved request or an amended record after 0052, when it is stored, then it is annual leave.

## Design Notes

A fixed annual id beats a defaulting trigger: the default is pure schema, and every existing insert path keeps working unchanged. The organization trigger is the one way to make "every organization has annual leave" hold for every creation path (operator scripts, `seed.sql`, test fixtures) without editing each.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint` and `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm typecheck` -- pass
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm exec vitest run test/supabase-scaffold.test.ts` -- pass (file-reading, no DB)
- DB-connecting root tests are NOT run locally (strict database rule); they would fail on the unapplied 0052 and are verified in CI.

## Suggested Review Order

**Schema and the annual-leave default**

- Entry point: the type is a name and a flag; key `(organization_id, id)` allows one fixed annual id.
  [`0052_absence_types.sql:55`](../../supabase/migrations/0052_absence_types.sql#L55)

- Annual leave always draws, enforced as a check, not a trigger.
  [`0052_absence_types.sql:80`](../../supabase/migrations/0052_absence_types.sql#L80)

- The column default makes every existing insert path write annual leave unchanged.
  [`0052_absence_types.sql:205`](../../supabase/migrations/0052_absence_types.sql#L205)

**Backfill and seeding**

- Seeding trigger: every new organization gets annual leave, whatever creates it.
  [`0052_absence_types.sql:178`](../../supabase/migrations/0052_absence_types.sql#L178)

- The trigger itself, after the backfill of existing organizations.
  [`0052_absence_types.sql:190`](../../supabase/migrations/0052_absence_types.sql#L190)

**Access**

- Admin-only select, insert and update; no delete; members read nothing.
  [`0052_absence_types.sql:98`](../../supabase/migrations/0052_absence_types.sql#L98)

**Architecture**

- AD-2 gains the current-state absence-type row and its amendment clause.
  [`ARCHITECTURE-SPINE.md:69`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L69)

**Tests (CI only for DB files)**

- The matrix as DB cases: backfill, define, refusals, tenants, leave default, cross-tenant FK.
  [`rls-isolation.test.ts:25393`](../../test/rls-isolation.test.ts#L25393)

- RLS table list, FK, privileges, trigger and function lists.
  [`provisioning.test.ts:703`](../../test/provisioning.test.ts#L703)

- Source pins of 0052's shape and grants.
  [`supabase-scaffold.test.ts:943`](../../test/supabase-scaffold.test.ts#L943)
