---
title: 'Story 2.2a: Shift types are stored with versioned times and a derived duration'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '4979509a6560547aa6c450dfaa3277615224e44b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1a-hour-band-rule.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The rotation (2.3) has nothing to repeat. No shift type exists, and `packages/domain` has no duration rule. This part covers epics.md story 2.2 clauses 1, 2 and 5 (CAP-7, DI-5, AD-2). The editor, the ramp slots and the slot contrast are 2.2b, which waits in `deferred-work.md`.

**Approach:**
- A current-state `shift_types` table holds the name, `is_working` and `archived`.
- A versioned `shift_type_versions` table holds the start time, end time and `effective_from`.
- A pure `packages/domain` module `duration.ts` derives each duration and selects the version in effect on a date.
- Both fixtures are seeded.

## Boundaries & Constraints

**Always:**
- **Duration is derived, never stored.**
  - `duration = end − start`, plus 1440 when `end <= start`. So 19:00–07:00 is 720, and 07:00–07:00 is 1440.
  - `crossesMidnight = start + duration > 1440`.
  - The result is one span, attributed to the start date and never split.
  - A non-working type has no times and a duration of 0.
- **`shift_types`** follows the shape of `0009_teams.sql`:
  - The name is not blank.
  - The name is unique per organization, trimmed and ignoring case, among non-archived rows.
  - `is_working` is set at insert and has no update grant.
  - Archiving is one-way.
  - There is no delete.
- **`shift_type_versions`** follows the rules of `0010_team_membership.sql` without change:
  - Each version is append-only.
  - `effective_from >= public.organization_today(org)`.
  - Versions come in strictly increasing date order.
  - At most one version is scheduled after today, and only that one may be deleted, while it is still in the future.
  - A new version must change the times.
  - Only a non-archived, working type of the same organization may have a version.
  - Both times are `< '24:00'` and whole minutes.
  - `created_by = auth.uid()`, pinned by the policy.
- **Seed** (human decision 2026-09-25): every version is effective from `2020-01-01`. `created_by` and `shift_types.created_by` are each fixture's admin: pilot `ivan.maric`, UJ-5 `josip.peric`.
- **RLS:** members of the organization read. Active admins write. Every policy is `to authenticated`, and `anon` gets nothing.
- **Domain:**
  - Integer minutes in 0–1439.
  - Dates are `YYYY-MM-DD` strings compared lexically, never `Date`.
  - The domain returns values, not prose, and nothing branches on a name.
  - Types are `ShiftType` and `ShiftTypeVersion`.

**Ask First:**
- A trigger.
- A stored duration or ramp slot.
- A new column beyond those named here.
- Refusing to archive a type that is in use (that belongs to 2.3, once steps exist).

**Never:**
- No UI, route, i18n key or `apps/web` change.
- No `dan|noć|slobodno` anywhere in the migration, comments included (`supabase-scaffold.test.ts:210`).
- No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Night | 19:00–07:00 | 720 min, crosses midnight, one span on its start date | N/A |
| Day | 07:00–19:00 | 720 min, does not cross | N/A |
| 24 h | 07:00–07:00 | 1440 min, crosses | N/A |
| 24 h at midnight | 00:00–00:00 | 1440 min, does not cross | N/A |
| UJ-5 night | 22:00–06:00 | 480 min, crosses | N/A |
| Non-working | `is_working = false`, no version | Valid; duration 0 | N/A |
| Version on date | versions 2020-01-01 and 2026-10-01 | Before 2026-10-01 → first; on or after → second; before 2020 → none | N/A |
| Time correction | new version from today | Earlier dates still read the old times | N/A |
| Backdated | `effective_from` < today | Nothing written | RLS 42501 |
| Second scheduled | a future version exists; insert a later one | Nothing written | RLS 42501 |
| Same times | same start and end as the latest version | Nothing written | RLS 42501 |
| Non-working version | version on a non-working type | Nothing written | RLS 42501 |
| Cancel | delete the latest future version / delete a past one | Row removed / zero rows | RLS |
| `is_working` flip | update `is_working` | Refused | privilege 42501 |
| `24:00` or seconds | either time | Refused | 23514 |
| Duplicate name | `" noć "` beside `Noć`, both not archived | Refused | 23505 |
| Member-role / other org | any write, or a cross-org read | Refused or zero rows | RLS |

</frozen-after-approval>

## Code Map

Baseline: run `nvm use` (24.19.0), then `pnpm build && pnpm test` at HEAD `4979509`. Record the counts. The last recorded counts, from 2.1a, were root 1920, web 1414 and domain 24.

**Migration**: `supabase/migrations/0013_shift_types.sql`. The numbering check `supabase-scaffold.test.ts:81-108` passes on its own.
- `shift_types`
  - Table per `0009:27-52`, with `is_working boolean not null`.
  - Partial name index per `0009:66-68`.
  - Policies per `0009:74-129`: select, insert, and an update whose USING includes `archived = false`.
  - Grants per `0009:143-148`: `insert (organization_id, name, is_working)` and `update (name, archived)`.
- `shift_type_versions`
  - Table per `0010:53-94`: composite FK to `shift_types (organization_id, id)`, finiteness check `:88-89`, and `unique (shift_type_id, effective_from)`.
  - Time checks per `0012:51,55`, applied to both columns.
- Helpers:
  - `shift_type_latest_version(uuid)` and `shift_type_has_version(uuid)` mirror `0010:139-170`: plpgsql, `volatile`, `security invoker`, `set search_path = ''`.
  - Execute grants per `0010:204-222`.
- Policies:
  - insert per `0010:252-280`, where "changes the value" compares both times with the latest version;
  - delete per `0010:284-297`;
  - no update policy.
  - Grants per `0010:323-333`: `insert (organization_id, shift_type_id, start_time, end_time, effective_from)`.

**Seed**: `supabase/seed.sql`.
- The pilot block goes after `:153`, and UJ-5 at the end of the file. Use the `cross join (values …) where slug =` style from `:144-153`.
- Look up the admin with `select auth_user_id from members where username = …`.
- Write an explicit, ascending `created_at` on `shift_types`. The seed runs in one transaction, so `now()` would tie, and 2.2b derives the ramp slot from creation order.
- The order comment at `:38` already lists both tables.

**Domain**
- `packages/domain/src/duration.ts`, re-exported from `src/index.ts:14-22`. Its style follows `bands.ts`:
  - `MINUTES_PER_DAY` reused;
  - readonly interfaces;
  - a `RangeError` that names the offending value, with `@throws` in the JSDoc.
- Exports:
  - `deriveShiftTimes(start, end)` returns `{startMinute, endMinute, durationMinutes, crossesMidnight}`;
  - `shiftTypeVersionOn(versions, date)` returns the version with the greatest `effectiveFrom <= date`, or `null`. It throws on a malformed date or two versions with the same date.
- `packages/domain/test/fixtures.ts` gains `PILOT_SHIFT_TYPES`/`UJ5_SHIFT_TYPES` and their versions. These are the one source of truth, like `:18-31`.
- `purity.test.ts:91-115` must stay green.

**DB tests**
- `supabase-scaffold.test.ts`:
  - policy inventory `:296-366`: twenty-two becomes twenty-eight, including the "no twenty-ninth" wording;
  - source blocks per the membership shape `:708-768`, the teams blocks `:840-894` and the column set `:896-934`.
- `rls-isolation.test.ts`:
  - `OWN_ORGANIZATION_READS` `:224-235` with its count `:897-900` (5 becomes 7);
  - pg_policies `:975-1022` (nineteen becomes twenty-five);
  - function list `:1024-1050` (11 becomes 13);
  - cleanup `:817-833`, with versions before types;
  - matrices per the membership helpers `:7492-7576`, SQL `:7578-8348` and REST `:8515-8779`;
  - seeded read-back built from the domain fixtures, per `:9234-9255`.
- `provisioning.test.ts`:
  - RLS tables `:751-783` (6 becomes 8);
  - privilege blocks per `:813-848` and `:927-967`;
  - index blocks per `:969-1009`;
  - INVOKER list `:1176-1202` (8 becomes 10).

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/duration.ts`, `src/index.ts` -- `deriveShiftTimes`, `shiftTypeVersionOn` -- one pure home for the duration rule (AD-7, NFR-19).
- [x] `packages/domain/test/fixtures.ts`, `test/duration.test.ts` -- both fixtures and every domain row of the matrix. Add a randomized check (seeded PRNG) that `durationMinutes` is in 1–1440 and that `crossesMidnight` holds exactly when `0 < end <= start` (19:00–00:00 ends at midnight and does not cross) -- Q7/Q9.
- [x] `supabase/migrations/0013_shift_types.sql` -- tables, checks, indexes, helpers, policies, grants.
- [x] `supabase/seed.sql` -- pilot: Dan 07:00–19:00, Noć 19:00–07:00, Slobodno. UJ-5: Jutarnja 06:00–14:00, Popodnevna 14:00–22:00, Noćna 22:00–06:00, Slobodno. Versions from `2020-01-01`, attributed to each fixture's admin.
- [x] `test/rls-isolation.test.ts`, `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts` -- every DB row of the matrix over both fixtures (SQL, plus one live REST path per verb); the seeded read-back; the inventories.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- move `2-2-…` to `in-progress` and add `2-2a-shift-type-rule: in-progress`, with a split comment per `:340-366` (the parent closes with 2.2b).

**Acceptance Criteria:**
- Given `pnpm exec supabase db reset`, when the seeded types are read, then each fixture has exactly its own types, times, `2020-01-01` versions and admin attribution.
- Given `packages/domain`, when `pnpm --filter @shift/domain test` runs, then every duration and version rule is asserted in node for both fixtures (Q7, Q9).
- Given a shift type renamed after a time correction, when any date is read, then it shows the new name, while each date's times come from the version in effect on it (AD-2, CAP-7).

## Design Notes

Versioning is by `effective_from` only. There is no end date. The version in effect on date D is the one with the greatest `effective_from <= D`, so a correction can never rewrite a date before it. Seeding from `2020-01-01` lets 2.3's projection read past dates for any anchor. A working type created by 2.2b gets its first version from today. Until that version exists it has no times, and nothing invents them.

## Verification

**Commands:**
- `pnpm exec supabase db reset` -- exit 0. The shared stack; this is a new migration only.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `git diff --stat apps/ package.json pnpm-lock.yaml` -- empty.
- Mutation probes, each of which must fail the suite:
  - use `end < start` for the +1440;
  - drop the `effective_from >= today` conjunct;
  - drop the "changes the value" conjunct;
  - grant `update (is_working)`;
  - make the name index total;
  - drop the delete policy's `> today`;
  - grant anon select.

## Suggested Review Order

**The rule: times in, one derived span out**

- Entry point: `end <= start` adds a day, so night and 24 h types need no branch.
  [`duration.ts:95`](../../packages/domain/src/duration.ts#L95)

- Version in effect is the greatest `effectiveFrom <= date`; mixed types and malformed versions throw.
  [`duration.ts:119`](../../packages/domain/src/duration.ts#L119)

- Non-working is 0, a working type without a version yet is `null`, never invented.
  [`duration.ts:160`](../../packages/domain/src/duration.ts#L160)

- Calendar dates checked as strings, never `Date`.
  [`duration.ts:76`](../../packages/domain/src/duration.ts#L76)

**Enforcement: 0010's versioning rules applied to times**

- Insert: today or later, date order, one scheduled, a real change, working and not archived.
  [`0013_shift_types.sql:308`](../../supabase/migrations/0013_shift_types.sql#L308)

- "Changes the times" reads through a helper; a same-table subquery recursed (42P17).
  [`0013_shift_types.sql:180`](../../supabase/migrations/0013_shift_types.sql#L180)

- Only the latest future version may be cancelled.
  [`0013_shift_types.sql:342`](../../supabase/migrations/0013_shift_types.sql#L342)

- Archive refused while a change is scheduled (human decision); cancel it first.
  [`0013_shift_types.sql:272`](../../supabase/migrations/0013_shift_types.sql#L272)

- Name unique among non-archived types; `is_working` has no update grant.
  [`0013_shift_types.sql:90`](../../supabase/migrations/0013_shift_types.sql#L90)
  [`0013_shift_types.sql:369`](../../supabase/migrations/0013_shift_types.sql#L369)

- Both times before 24:00 and whole minutes; duration is never a column.
  [`0013_shift_types.sql:124`](../../supabase/migrations/0013_shift_types.sql#L124)

- The known concurrency gap, now naming archive-vs-insert too.
  [`0013_shift_types.sql:42`](../../supabase/migrations/0013_shift_types.sql#L42)

**Fixtures: one source of truth**

- Versions from 2020-01-01, attributed to each fixture's admin; ascending `created_at` for 2.2b.
  [`seed.sql:163`](../../supabase/seed.sql#L163)

- Domain fixtures the DB read-back is built from.
  [`fixtures.ts:45`](../../packages/domain/test/fixtures.ts#L45)

**Peripherals: proofs and inventories**

- Seeded read-back per fixture, built from the domain fixtures.
  [`rls-isolation.test.ts:10034`](../../test/rls-isolation.test.ts#L10034)

- Version matrix: order, one scheduled, change, cancel, many versions.
  [`rls-isolation.test.ts:10272`](../../test/rls-isolation.test.ts#L10272)

- Archive-while-scheduled, renames onto taken names, multi-row insert.
  [`rls-isolation.test.ts:10785`](../../test/rls-isolation.test.ts#L10785)

- Same rules through live PostgREST.
  [`rls-isolation.test.ts:10965`](../../test/rls-isolation.test.ts#L10965)

- Randomized duration invariant with a seeded PRNG.
  [`duration.test.ts:245`](../../packages/domain/test/duration.test.ts#L245)

- Privilege matrix: no delete, no `is_working` update, anon holds nothing.
  [`provisioning.test.ts:931`](../../test/provisioning.test.ts#L931)

- Policy inventory 22 → 28.
  [`supabase-scaffold.test.ts:296`](../../test/supabase-scaffold.test.ts#L296)
