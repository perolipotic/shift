---
title: 'The free-day Danas e2e cases fail before 07:00 Zagreb, not across midnight'
type: 'bugfix'
created: '2026-11-20'
status: 'in-review'
baseline_commit: '61976e7'
review_loop_iteration: 0
context: ['_bmad-output/implementation-artifacts/spec-today-spec-midnight-safe.md']
---

Baseline: `origin/main` at 61976e7. Not an epic story: a CI failure after spec-today-spec-midnight-safe (PR #316).

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On 2026-11-20 four `today.spec.ts` cases (:285 "a free day…", :343 "a failed resolutions read…", :391 ×2 "a failed read of their own leave / the calendar snapshot…") failed in shard 4 of CI run 44832080218 (PR #324), retries included, and the same four failed on PR #325 (run 44831942009) — the same four that failed on PR #310 and were blamed on a midnight crossing.

**Evidence:** the shard's blob report (`e2e-blob-4`) shows the midnight guard worked: both workers carry `midnight-wait` "started 404 s before 00:00:05 Europe/Zagreb; waited until then". The four then started at 00:07:03–00:08:13 Zagreb, wholly on 2026-11-21: seed, page and server read one date. Each failed on `getByRole('region', { name: 'Danas ne radiš' })` not found — the page showed a different case.

**Root cause:** the four seed `daysBefore` 2: today is the first Slobodno, right after the Noć 19:00–07:00. Since spec-fix-danas-overnight-carry-over, *Danas* reads a shift from yesterday still running as "Danas radiš … od jučer", so from 00:00 to 07:00 Zagreb today is not the free case. The tests were time-of-day dependent; the guard (which only waits out a crossing) cannot help. The sibling cases that passed (:336 asserts no case, :365 seeds today's Noć after a Dan) fit.

**Approach:** the free-day cases seed the second Slobodno (`daysBefore` 3: yesterday is a Slobodno too), free at every hour; the next shift is the Dan tomorrow. The decision lives DB-free in `e2e/utils/seeded-pattern.ts` (`SEEDED_STEPS`, `seededStepAt`, `freeAllDay`, `FREE_ALL_DAY_DAYS_BEFORE`), and `seedTeamRotation` takes its Dan/Noć times from `SEEDED_STEPS` so the two cannot drift. The midnight guard stays as it is.

## Boundaries & Constraints

**Always:** Change only `e2e/`, `test/e2e-midnight-guard.test.ts` and BMAD artifacts. The lone-Noć carry-over test keeps `daysBefore` 2 with its pinned 03:00 clock.

**Never:** Run e2e locally or touch the local Supabase stack; change app code or the guard's margin.

</frozen-after-approval>

## Code Map

- `e2e/utils/seeded-pattern.ts` -- new: the seeded pattern and the free-all-day decision.
- `e2e/utils/database-helper.ts` -- `seedTeamRotation` reads the Dan/Noć times from `SEEDED_STEPS`.
- `e2e/tests/today/today.spec.ts` -- the free-day cases (and the tiles case, for consistency) seed `FREE_ALL_DAY_DAYS_BEFORE`; the free-day case expects the Dan in 1 day.
- `test/e2e-midnight-guard.test.ts` -- DB-free: the pattern, step arithmetic, `freeAllDay` for offsets 0–3 and 7, the guard not waiting at 00:07:03, and a source pin that `today.spec.ts` seeds offset 2 only in the clock-pinned carry-over test and every free-card test seeds `FREE_ALL_DAY_DAYS_BEFORE`.

## Guard gaps considered (none found)

- Retries: a retry is a fresh worker; the auto fixture runs again and re-decides.
- `beforeAll`/worker fixtures: no `beforeAll` in `e2e/tests`; the worker `fixture` reads a file, no date.
- Margin: the longest timeout is 360 s, under the 8 min floor.

## Verification

Results seen 2026-11-20:
- `pnpm typecheck`, `pnpm lint` -- clean.
- `pnpm exec vitest run test/e2e-midnight-guard.test.ts test/e2e-fixture.test.ts test/resource-hygiene.test.ts` -- 3 files, 1924 tests pass.
- `pnpm exec playwright test --list` -- 567 tests in 57 files.
- E2E: CI only (not run locally, by rule). Until merged, the four cases fail on main for any run reaching them between 00:00 and 07:00 Zagreb.
