---
title: 'Story 2.1a: Hour bands are stored as start times and derived into a full-day partition'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '78e3419679caa49962a670cb7ffbfd242a57b4f1'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Day and night are not yet an organization setting, so Epic 4's band hours have nothing to intersect, and `packages/domain` holds no rule. This part covers epics.md story 2.1's shape clause, its three-band clause (CAP-3) and its domain/fixture clause (Q7, Q9, Q10). The editor screen, 2.1b, waits in `deferred-work.md`.

**Approach:** Add a current-state `hour_bands` table that stores a name and a start time only, with RLS. Add a pure `packages/domain` bands module that derives every window and the 24-hour partition from sorted start times. Seed both fixtures.

## Boundaries & Constraints

**Always:**
- Shape, not validation (AD-3). Store `name` and `start_time` only. The window, duration and midnight flag are never stored.
  - `unique (organization_id, start_time)`.
  - Checks: `start_time < '24:00'` and whole minutes.
  - `btrim(name) <> ''`, and the name is unique per organization ignoring case.
- Zero bands is a valid stored state (human decision 2026-09-25). Any band, including the last one, may be deleted.
- Derivation:
  - Sort bands by start time. Each band ends where the next begins, and the last wraps to the first.
  - `durationMinutes = (next − start) mod 1440`, or 1440 for a single band.
  - `crossesMidnight = start + duration > 1440`.
  - Durations sum to exactly 1440 whenever at least one band exists.
- Partition segments are `{fromMinute, toMinute, bandId | null}` over 0–1440. A crossing band yields two segments. Zero bands yield one uncovered segment of 0–1440.
- The domain uses integer minutes (0–1439) and returns values only, never strings. The type is `HourBand`, per the glossary. Nothing branches on a name.
- Current-state and retroactive (CAP-3), with no versioning.
  - No `created_by`: AD-11 does not require it, and a seed would have to forge it.
  - Keep `created_at default now()`, with a comment giving the reason.
- RLS: members of the organization read. Active admins of the organization insert, update and delete. Every policy is `to authenticated`, and `anon` gets nothing.

**Ask First:**
- Band-hours intersection (Epic 4's `domain/hours`), versioning, or any attribute beyond name and start time.

**Never:**
- No UI, route, i18n key, or `apps/web` change, including no `@shift/domain` dependency (all of that is 2.1b).
- No trigger or function.
- No `dan|noć|slobodno` in migration text, comments included (`supabase-scaffold.test.ts:214`).
- No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pilot | 07:00, 19:00 | 07:00–19:00, 720 min; 19:00–07:00, 720 min, crosses | N/A |
| UJ-5 | 05:00, 13:00, 21:00 | Three 480-min windows; 21:00 crosses; four segments summing to 1440 | N/A |
| One band | 07:00 | 1440 min, crosses | N/A |
| One band at 00:00 | 00:00 | 1440 min, does not cross; one segment | N/A |
| Zero bands | none | No windows; one null segment 0–1440; covered 0 | N/A |
| Unsorted input | 19:00, 07:00 | Same result as sorted | N/A |
| Duplicate start | second 07:00 | Refused, nothing written | 23505 |
| `24:00` or seconds | `24:00`, `07:00:30` | Refused | 23514 |
| Duplicate or empty name | `" noć "` beside `Noć`; `"  "` | Refused | 23505 / 23514 |
| Member-role write | insert, update or delete | Refused or zero rows | RLS |
| Other organization | read or write | Zero rows or refused | RLS |

</frozen-after-approval>

## Code Map

Baseline: `nvm use` (24.19.0), then `pnpm build && pnpm test` at HEAD. Record the counts.

**Migration** — new `supabase/migrations/0012_hour_bands.sql` (numbering per `supabase-scaffold.test.ts:81-108`).
- Shape per `0009_teams.sql:27-68`, without `archived`, without `created_by`, and with no partial `where` on the lower-name unique index.
- Policies:
  - select per `0009:74-84`;
  - insert per `0009:88-100`, without the `created_by` conjunct;
  - update per `0009:108-129`, without `archived`;
  - delete per `0003:358-369`.
- Grants per `0008:541-553`:
  - authenticated keeps SELECT and DELETE;
  - column grants `insert (organization_id, name, start_time)` and `update (name, start_time)`;
  - revoke insert, update, truncate, references and trigger from authenticated;
  - revoke everything from anon.

**Seed** — `supabase/seed.sql`, looking each organization up by slug:
- pilot (`dvd-kastel-novi`, `:64`) after `:142`;
- UJ-5 (`zastita-split`, `:178`) at the end of the file.
- The order comment `:37` already lists `hour_bands`.

**DB tests**
- `supabase-scaffold.test.ts`:
  - exact policy inventory `:296-359` ("eighteen" becomes twenty-two, including the "no nineteenth" wording);
  - `to authenticated` and no `for all` `:272-293`;
  - source blocks per the teams ones `:833-902`.
- `rls-isolation.test.ts`:
  - `OWN_ORGANIZATION_READS` `:226-231` and its count `:890-894`;
  - pg_policies list `:969-1003` ("fifteen" becomes nineteen);
  - matrix per the teams helpers `:6858-6907`, SQL `:6909` and REST `:7245`;
  - helpers `inRolledBackTransaction` `:243`, `refusedThenContinue` `:280`, `tokenFor` `:328`, `rest*` `:371-411`, `actAs` `:565`, cleanup `:814-830`.
  - Prefer rolled-back SQL. A committed REST row uses start times other than 05, 07, 13, 19 or 21, and is cleaned up.
- `provisioning.test.ts`: RLS tables `:751-782`, privilege matrix per teams `:812-847`, indexes `:912-931`.

**Domain**
- `packages/domain/src/bands.ts`, re-exported from `src/index.ts`. `DOMAIN_PACKAGE_NAME` may stay.
- Tests in `packages/domain/test/`. `purity.test.ts` must stay green: src imports nothing bare, and tests import only `node:` and `vitest`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/bands.ts`, `src/index.ts` -- `deriveHourBands` (windows) and `partitionOfDay` (segments and covered minutes) -- the rule lives in one pure place (AD-7).
- [x] `packages/domain/test/fixtures.ts`, `test/bands.test.ts` -- both fixtures; every domain row of the matrix; a randomized check (seeded PRNG, 1–12 distinct starts) that durations sum to 1440 and the segments tile 0–1440 with no gap and no overlap -- Q7/Q9, R3.9.
- [x] `supabase/migrations/0012_hour_bands.sql` -- table, checks, indexes, policies, grants -- the whole enforcement.
- [x] `supabase/seed.sql` -- pilot `Dan@07:00, Noć@19:00`; UJ-5 `Jutro@05:00, Popodne@13:00, Noć@21:00` -- Q10, where UJ-5's 06/14/22 shifts straddle every edge.
- [x] `test/rls-isolation.test.ts`, `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts` -- every DB row of the matrix over both fixtures (SQL plus one live REST path per verb); each fixture's seeded start times and names; inventories -- the database proves the matrix.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `epic-2` and `2-1-…` go to `in-progress`; add `2-1a-hour-band-rule: in-progress` with a split-convention comment (2.1b is deferred, and the parent closes with it).

**Acceptance Criteria:**
- Given the UJ-5 fixture, when its bands derive, then three windows result through the same code path as the pilot's two, with no branch on count (CAP-3).
- Given `packages/domain`, when `pnpm --filter @shift/domain test` runs, then every band rule is asserted in the node environment without a browser (Q7, Q9).
- Given `pnpm exec supabase db reset`, when the seeded bands are read, then each fixture has exactly its own bands.

## Design Notes

A gap or overlap is unrepresentable because each band's end is the next band's start. The only uncovered configuration is the empty set, which a new organization starts in. So "refuse a gap" reduces to the start-time unique, which prevents a zero-length band, plus the empty-set segment that 2.1b's bar will hatch.

## Verification

**Commands:**
- `pnpm exec supabase db reset` -- exit 0.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `git diff --stat package.json pnpm-lock.yaml apps/` -- empty.
- Mutation probes, each of which must fail the suite:
  - drop the start-time unique;
  - drop the `< '24:00'` check;
  - return 0 for a single band;
  - compute `crossesMidnight` as `start + duration >= 1440`;
  - skip sorting;
  - drop the delete policy's admin check;
  - grant anon select.

## Suggested Review Order

**The rule: start times in, a full-day partition out**

- Entry point: each band ends at the next start, so gaps are unrepresentable.
  [`bands.ts:102`](../../packages/domain/src/bands.ts#L102)

- A zero gap means "next band is itself": a full day, no count branch.
  [`bands.ts:112`](../../packages/domain/src/bands.ts#L112)

- Preconditions throw rather than silently breaking the 1440 invariant.
  [`bands.ts:77`](../../packages/domain/src/bands.ts#L77)

- Crossing bands split in two; zero bands leave one uncovered segment.
  [`bands.ts:131`](../../packages/domain/src/bands.ts#L131)

**Enforcement: shape, not validation**

- Name and start only; no `created_by`, so the seed forges nothing.
  [`0012_hour_bands.sql:28`](../../supabase/migrations/0012_hour_bands.sql#L28)

- Before 24:00, whole minutes, one band per start — the only refusals.
  [`0012_hour_bands.sql:51`](../../supabase/migrations/0012_hour_bands.sql#L51)

- Four `to authenticated` policies, each pinned to an active own-org caller.
  [`0012_hour_bands.sql:76`](../../supabase/migrations/0012_hour_bands.sql#L76)

- Delete is admitted (current-state), narrowed by policy to active admins.
  [`0012_hour_bands.sql:130`](../../supabase/migrations/0012_hour_bands.sql#L130)

- Column grants keep `id`/`created_at` unwritable; anon holds nothing.
  [`0012_hour_bands.sql:153`](../../supabase/migrations/0012_hour_bands.sql#L153)

**Fixtures: one source of truth**

- Pilot bands coincide with changeovers; UJ-5's 05/13/21 are straddled.
  [`seed.sql:146`](../../supabase/seed.sql#L146)

- The DB expectation is built from the domain fixtures, so they cannot drift.
  [`rls-isolation.test.ts:9242`](../../test/rls-isolation.test.ts#L9242)

**Peripherals: proofs and inventories**

- Randomized 1–12 bands: durations sum to 1440, segments tile the day.
  [`bands.test.ts:226`](../../packages/domain/test/bands.test.ts#L226)

- Deactivated admin: column-free writes, insert without RETURNING, all refused.
  [`rls-isolation.test.ts:6425`](../../test/rls-isolation.test.ts#L6425)

- Admin write matrix over both fixtures, down to zero bands, in SQL.
  [`rls-isolation.test.ts:9346`](../../test/rls-isolation.test.ts#L9346)

- The same rules through live PostgREST, check refusals included.
  [`rls-isolation.test.ts:9565`](../../test/rls-isolation.test.ts#L9565)

- Privilege matrix: nothing held that no policy needs.
  [`provisioning.test.ts:850`](../../test/provisioning.test.ts#L850)

- Exact column set, whatever the type — a derived column fails it.
  [`supabase-scaffold.test.ts:896`](../../test/supabase-scaffold.test.ts#L896)
