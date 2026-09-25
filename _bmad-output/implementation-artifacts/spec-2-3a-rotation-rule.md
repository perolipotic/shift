---
title: 'Story 2.3a: A rotation is stored as a pattern of steps and versioned team assignments, and projects any date'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '270f10d8bea8e5f4ed828aaa38b3baf7c5ef1efc'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2a-shift-type-rule.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Shift types exist, but nothing repeats them. There is no rotation schema and no projection, so no team has a shift on any date. This part covers epics.md story 2.3 clauses 2, 3 and 5 (CAP-8, CAP-11, AD-2, AD-3, AD-7, R1.1–R1.7). The builder, offsets UI and cycle preview (clauses 1 and 4) are 2.3b, which waits in `deferred-work.md`.

**Approach:**
- Migration `0016_rotation.sql` adds three tables:
  - `rotation_patterns`: immutable.
  - `rotation_steps`: ordered and immutable, insertable only while the pattern has no assignment.
  - `rotation_assignments`: versioned per team, following 0010's rules. The offset is a composite FK to a step of the same pattern.
- A pure `packages/domain/src/projection.ts` computes the projection.
- Both fixtures and the demo organization are seeded with teams and a rotation.

## Boundaries & Constraints

**Always:**
- **Shape, not checks (AD-3):**
  - `rotation_assignments.offset_step_id` is `not null`, with FK `(organization_id, pattern_id, offset_step_id) → rotation_steps (organization_id, pattern_id, id)`.
  - So an offset outside the cycle, or on an empty pattern, cannot be stored.
  - `rotation_steps` has `unique (pattern_id, position)` and `position >= 0`.
  - Gaps in `position` are harmless. Projection orders the steps by position and uses their index.
- **Immutability:**
  - Patterns and steps have insert and select grants only. No update, no delete.
  - A step insert is refused (42501) once any assignment references its pattern, through a reader `rotation_pattern_in_use(uuid)`.
  - A step's shift type must be of the same organization and not archived.
- **Assignments follow `0010_team_membership.sql` without change:**
  - Append-only.
  - `effective_from >= public.organization_today(org)`.
  - Strictly increasing dates per team.
  - At most one scheduled after today; only that one may be deleted, while it is in the future.
  - A new version must change pattern, offset step or anchor. The comparison uses a table-returning reader `rotation_assignment_on(team, date)`, not a self-subquery (see `0015:115-156`, 42P17).
  - The team is not archived.
  - `created_by = auth.uid()` in WITH CHECK, and `created_by`/`created_at` come from defaults.
  - `anchor_date` and `effective_from` are finite. The anchor may be any date, past or future.
- **Readers:** plpgsql, `volatile`, `security invoker`, `set search_path = ''`, with 0010's four-line execute grants. Readers: `rotation_pattern_in_use`, `rotation_assignment_on`, `rotation_assignment_latest_version`.
- **RLS:** members of the organization read. Active admins write, using the inline claim-plus-`current_member_access()` check. Every policy is `to authenticated`, and `anon` gets nothing.
- **Domain (`projection.ts`):**
  - `daysBetween(from, to)` over `YYYY-MM-DD` strings uses civil-day arithmetic, never `Date`.
  - The modulo is a true modulo: `((n % m) + m) % m`.
  - `rotationAssignmentOn(versions, date)` returns the greatest `effectiveFrom <= date`, or `null`.
  - The projection returns `steps[(offsetIndex + daysBetween(anchor, date)) mod cycleLength].shiftTypeId`.
  - It throws a `RangeError` naming the value for:
    - empty steps;
    - an offset step not in the pattern;
    - mixed patterns or teams;
    - a duplicate position or date;
    - a malformed date.
  - Types use the glossary names (`RotationPattern`, `RotationStep`, `RotationAssignment`).
  - It returns ids, not prose, and nothing branches on a name.
- **Seed** (human decision 2026-09-25):
  - Pilot (`dvd-kastel-novi`): teams `Smjena A`–`D`, pattern `[Dan, Noć, Slobodno, Slobodno]`, offsets 0–3.
  - UJ-5 (`zastita-split`): teams `Smjena A`–`C`, pattern `[Jutarnja, Popodnevna, Noćna, Slobodno, Slobodno]`, offsets 0, 1 and 2.
  - The anchor and `effective_from` are `2020-01-01`.
  - `created_by` is the fixture admin, and `created_at` is explicit and ascending.
  - Memberships are NOT seeded.
  - The demo organization gets the pilot rotation for `Smjena A`–`D`.

**Ask First:**
- An RPC or trigger, for example to make pattern-plus-steps-plus-assignments atomic.
- A column not named here.
- Seeding memberships.
- Changing `0013`'s archive rule, for example refusing to archive a shift type that a step uses.

**Never:**
- No UI, route, i18n key or `apps/web` change.
- No `dan|noć|slobodno`, "four teams" or organization wording in the migration, comments included (`supabase-scaffold.test.ts:216-233`).
- No stored cycle length, offset integer or projected shift.
- Projection never reads rank or position.
- No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pilot grid | pilot, 2020-01-01…04 | Rows are A B C D. 01: Dan Noć Slob Slob. 02: Noć Slob Slob Dan. 03: Slob Slob Dan Noć. 04: Slob Dan Noć Slob (engine-rules §1) | N/A |
| Before anchor | pilot A, 2019-12-31 | `daysBetween = −1` gives Slobodno (index 3) | N/A |
| Far past / future | A on 1900-03-01, 2100-02-28 | Equal to a brute-force day walk | N/A |
| UJ-5 | 5 steps, offsets 0/1/2 | Deterministic. Every date has a working team; on some dates a working shift type has nobody (2.5 will warn) | N/A |
| No assignment yet | date < earliest `effective_from` | `null`, never invented | N/A |
| Version switch | versions 2020-01-01 and 2026-10-01 | Dates before 2026-10-01 use the first; on or after use the second | N/A |
| Empty / outside | no steps / step of another pattern | Domain: RangeError. DB: nothing written | 23502 / 23503 |
| Step after use | step insert on a pattern with an assignment | Nothing written | 42501 |
| Step on archived / other-org type | step insert | Nothing written | 42501 / 23503 |
| Duplicate position | same `(pattern_id, position)` | Nothing written | 23505 |
| Pattern or step edit | update or delete | Refused | privilege 42501 |
| Backdated / second scheduled / same value / archived team | assignment insert | Nothing written | 42501 |
| Cancel | delete the latest future version / a past one | Row removed / 0 rows | RLS |
| Member-role / other org / anon | any write, or a cross-org read | Refused / 0 rows | RLS |

</frozen-after-approval>

## Code Map

Paths are relative to the worktree `.claude/worktrees/2-3a-rotation-rule`. Baseline: `nvm use` (Node 24), then `pnpm build && pnpm test` at `270f10d`; record the counts.

**Migration** `supabase/migrations/0016_rotation.sql`. The numbering test (`supabase-scaffold.test.ts:89-116`) passes on its own.
- Tables:
  - Shape follows `0009:27-52` (with `unique (organization_id, id)` at `:51`) and `0013:52-80`.
  - Versioned shape follows `0010:53-94`, with the finite check at `:88-89`.
  - Composite FKs follow `0013:119-121`, with no cascade toward rules and cascade from `organizations`.
  - `rotation_steps` needs `unique (organization_id, pattern_id, id)` as the FK target.
- Readers follow `0010:109-198`, with grants per `0010:204-222`. The table-returning reader follows `0015:75-98`.
- Policies:
  - select per `0010:228-238`;
  - assignment insert per `0015:115-156` (the current 0010 shape), with team-not-archived per the 0010 conjunct;
  - delete per `0010:284-297`;
  - step insert adds `not public.rotation_pattern_in_use(pattern_id)` and a not-archived-type check per `0013:308-338`.
- Grants per `0010:323-333` and `0009:143-148`:
  - patterns `insert (organization_id)`;
  - steps `insert (organization_id, pattern_id, position, shift_type_id)`;
  - assignments `insert (organization_id, team_id, pattern_id, offset_step_id, anchor_date, effective_from)`.
- The role check is inline. There is no `is_active_admin`. `organization_today` is at `0008:138`.

**Seed** `supabase/seed.sql`
- The header exception (`:20-24`) extends to teams and the rotation tables.
- Order comment `:38-48`: teams go after members (before bands); the rotation goes after the versions (`:205` pilot, `:365` UJ-5).
- Admin lookup per `:177-178` and `:335-336`. `created_at` is explicit per `:168-186`.
- The stale comment "The seed carries no teams" at `test/rls-isolation.test.ts:1268-1292` must be rewritten.

**Demo** `supabase/operator/demo-organization.sql`
- Replace `:45` "No rotation yet…".
- Add the rotation block after `:220`. The teams are created at `:175-190`.
- `test/demo-organization.test.ts`:
  - snapshot `:124-172`;
  - fingerprint `:179-213`;
  - counts `:309-333`;
  - attribution union `:436-448` (currently 4+16+3+2);
  - re-run lengths `:537-545`.

**Domain** `packages/domain/src/projection.ts`, re-exported from `src/index.ts:24-31`.
- Style per `duration.ts`: doc comment citing CAP/AD, readonly camelCase interfaces, and a `RangeError` with the message shape and `@throws` of `:76-86`.
- `checkDate` is private in `duration.ts`. Share it through a small internal module, not a copy.
- There is no date arithmetic yet. `apps/web/src/i18n/format.ts:244` uses `Date` and is off-limits.
- `test/fixtures.ts` gains `PILOT_TEAMS`, `PILOT_ROTATION_STEPS`, `PILOT_ROTATION_ASSIGNMENTS` and the UJ-5 equivalents, as the single source of truth (ids like `pilot-smjena-a`).
- `test/purity.test.ts` must stay green.

**DB test inventories.** Current numbers are 28 scaffold / 25 pg_policies / 14 functions / 7 read tables × 2 / 8 RLS tables / 14 grantees / 11 INVOKER. The new migration adds 7 policies and 3 functions.
- `supabase-scaffold.test.ts`:
  - inventory `:304-385`: 28 becomes 35, and the "no thirty-sixth" wording is updated;
  - column sets per `:1229-1265`;
  - append-only per `:1267-1331`;
  - INVOKER readers per `:1333-1356`.
- `rls-isolation.test.ts`:
  - `OWN_ORGANIZATION_READS` `:233-251`: 7 becomes 10, with the count at `:928-932`;
  - pg_policies `:1006-1052`: 25 becomes 32;
  - functions `:1054-1103`: 14 becomes 17;
  - cleanup `:834-915`: rotation rows go before throwaway teams and types;
  - membership-style helpers `~:7554-7700`;
  - seeded read-back per `:10930-11023`.
- `provisioning.test.ts`:
  - RLS tables `:781-817`: 8 becomes 11;
  - privilege blocks per `:1010-1057`;
  - index blocks per `:1089`;
  - grantees `:1331-1364`: 14 becomes 17;
  - INVOKER `:1366-1378`: 11 becomes 14.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/projection.ts`, `src/index.ts` (plus the shared date helper) -- `daysBetween`, the true modulo, `rotationAssignmentOn`, the projection -- the only projection implementation (AD-7, Q8).
- [x] `packages/domain/test/fixtures.ts`, `test/projection.test.ts` -- every domain row of the matrix, for both fixtures.
  - A seeded-PRNG property check: the projection equals a brute-force day walk from the anchor, for random dates across ±100 years and random patterns of 1–30 steps (Q9, R1.2, R1.3).
- [x] `supabase/migrations/0016_rotation.sql` -- tables, checks, indexes, readers, policies, grants.
- [x] `supabase/seed.sql` -- the teams and rotation for both fixtures, per the seed rule.
- [x] `supabase/operator/demo-organization.sql`, `test/demo-organization.test.ts` -- the pilot rotation, plus snapshot, fingerprint, count and attribution updates.
- [x] `test/rls-isolation.test.ts`, `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts`:
  - every DB row of the matrix over both fixtures, in SQL, plus one live REST path per verb;
  - the seeded read-back, compared with the domain fixtures and projected through `@shift/domain`;
  - the inventories.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `2-3-…: in-progress`, add `2-3a-rotation-rule: in-progress`, with a split comment (the parent closes with 2.3b).

**Acceptance Criteria:**
- Given `pnpm exec supabase db reset`, when each fixture's seeded rotation is read and projected through `@shift/domain`, then each fixture holds exactly its own teams, pattern and assignments, and the pilot's 2020-01-01…04 grid matches engine-rules §1.
- Given `pnpm --filter @shift/domain test`, when it runs in node, then every projection rule, including a negative `daysBetween`, is asserted for both fixtures (Q9, Q10).
- Given `packages/domain`, when it is inspected, then projection has no React, Supabase or I/O import, and no other package computes it (AD-7).

## Design Notes

- **Pattern changes (2.6) create a new pattern** and a new assignment version pointing at it. The old pattern and steps stay, so past dates still project through them. Nothing is edited in place, and no step versioning is needed.
- **Saving is non-atomic** (human decision 2026-09-25): a pattern, then all steps in one bulk insert, then all assignments in one bulk insert. A failure after the first write leaves an unreferenced pattern, which projects nothing.
- **The anchor lives on the assignment** (glossary). "Shared" is a UI convention for 2.3b.
- **Why an FK instead of an integer offset:**
  ```
  offsetIndex = indexOf(sortedSteps, offsetStepId)
  shift       = sortedSteps[mod(offsetIndex + daysBetween(anchor, date), sortedSteps.length)]
  ```

## Verification

**Commands:**
- `pnpm exec supabase db reset` -- exit 0. This touches the shared stack; tell the human first, then rerun `pnpm db:demo` afterwards.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `git diff --stat apps/ package.json pnpm-lock.yaml` -- empty.
- Mutation probes, each of which must fail the suite:
  - `%` instead of the true modulo;
  - an FK to `rotation_steps (id)` only;
  - drop `not rotation_pattern_in_use`;
  - drop the "changes the value" conjunct;
  - grant `update` on steps;
  - grant anon select.

## Suggested Review Order

**The offset as a reference: an illegal rotation cannot be stored**

- Entry point: a three-column key, so the offset names a step of that same pattern.
  [`0016_rotation.sql:176`](../../supabase/migrations/0016_rotation.sql#L176)

- The key's target: steps unique on `(organization_id, pattern_id, id)`, ordered by `position`.
  [`0016_rotation.sql:83`](../../supabase/migrations/0016_rotation.sql#L83)

- Both dates bounded to 0001–9999, so nothing stored is unreadable by the domain.
  [`0016_rotation.sql:179`](../../supabase/migrations/0016_rotation.sql#L179)

**Immutability: a pattern is sealed once a team stands on it**

- A step insert refused once any assignment names its pattern; archived types refused.
  [`0016_rotation.sql:345`](../../supabase/migrations/0016_rotation.sql#L345)

- The in-use reader the step policy calls: INVOKER, empty search_path.
  [`0016_rotation.sql:213`](../../supabase/migrations/0016_rotation.sql#L213)

- Insert and select grants only: no update, no delete on patterns or steps.
  [`0016_rotation.sql:459`](../../supabase/migrations/0016_rotation.sql#L459)

**Assignments: 0010's versioning, applied to a team's rotation**

- Today or later, one scheduled, a real change read through a table-returning reader.
  [`0016_rotation.sql:396`](../../supabase/migrations/0016_rotation.sql#L396)

- The reader that avoids the 42P17 self-reference, as in 0015.
  [`0016_rotation.sql:234`](../../supabase/migrations/0016_rotation.sql#L234)

- Only the latest future version may be cancelled.
  [`0016_rotation.sql:430`](../../supabase/migrations/0016_rotation.sql#L430)

**Projection: the one implementation, pure**

- The formula: offset index plus days from the anchor, true modulo over sorted steps.
  [`projection.ts:174`](../../packages/domain/src/projection.ts#L174)

- `((n % m) + m) % m`, so dates before the anchor resolve.
  [`projection.ts:69`](../../packages/domain/src/projection.ts#L69)

- Version in effect: greatest `effectiveFrom <= date`, else `null`; old dates keep the old pattern.
  [`projection.ts:214`](../../packages/domain/src/projection.ts#L214)

- Validation once per call: empty, foreign step, duplicate position all name the value.
  [`projection.ts:133`](../../packages/domain/src/projection.ts#L133)

- Civil-day numbers without `Date`; year 0 and 10000 refused, like the schema.
  [`calendar.ts:38`](../../packages/domain/src/calendar.ts#L38)

**Seed and demo: every fixture now has a rotation**

- Pilot and UJ-5 teams and rotation, attributed to each admin, ascending `created_at`.
  [`seed.sql:231`](../../supabase/seed.sql#L231)

- Demo rotation with row-count guards, so a name mismatch on staging raises.
  [`demo-organization.sql:231`](../../supabase/operator/demo-organization.sql#L231)

**Peripherals: proofs and inventories**

- The pilot grid of engine-rules §1, and the brute-force property checks.
  [`projection.test.ts:216`](../../packages/domain/test/projection.test.ts#L216)

- Seeded read-back projected through `@shift/domain`, compared with the fixtures.
  [`rls-isolation.test.ts:12605`](../../test/rls-isolation.test.ts#L12605)

- Every refusal of the matrix in SQL, both fixtures.
  [`rls-isolation.test.ts:12789`](../../test/rls-isolation.test.ts#L12789)

- A deactivated admin reads and writes no rotation row.
  [`rls-isolation.test.ts:6596`](../../test/rls-isolation.test.ts#L6596)

- The same rules over PostgREST, per verb, member-role and anon.
  [`rls-isolation.test.ts:13358`](../../test/rls-isolation.test.ts#L13358)

- Policy inventory 28 → 35.
  [`supabase-scaffold.test.ts:364`](../../test/supabase-scaffold.test.ts#L364)
