---
title: 'No e2e test runs across midnight Europe/Zagreb'
type: 'bugfix'
created: '2026-11-17'
status: 'done'
baseline_commit: '20d5b5b9b9d8dbae697fd9966be95bdd3a6e910b'
review_loop_iteration: 0
context: []
---

Baseline: `origin/main` at 20d5b5b. Not an epic story: the intent is the `deferred-work.md` entry from `epic-14-retro-2026-11-16.md` ("The `today.spec.ts` e2e is not safe across midnight Europe/Zagreb").

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** E2E tests read "today" in three places at different instants: the seed (`public.organization_today()` in SQL, or `new Date()` in Zagreb in Node), the page (the browser clock), and the RPCs the page calls (`organization_today()` again, server-side). A test that starts before 00:00 Zagreb and ends after it sees two different days; four `today.spec.ts` cases failed that way on PR #310 (shard 4 ran 23:55–00:05). About 30 specs seed relative to today in the same way.

**Approach:** One auto fixture in `e2e/utils/custom-fixtures.ts`, applied to every test: read one `now` when the test starts; if Zagreb midnight is less than a margin (8 min, more than the slowest test's timeout of 360 s) away, extend the test's timeout by the wait and wait until just past midnight before the test body (and its `beforeEach` hooks) run. Every read of today in the test then falls on the same date.

## Boundaries & Constraints

**Always:** Change only `e2e/` and the BMAD artifacts. The wait happens before any seed; it is one wait per worker per run at most; it is annotated on the test so a report shows it.

**Ask First:** Any change to `playwright.config.ts`, CI workflow timeouts, or app code.

**Never:** Run e2e locally or touch the local Supabase stack. No per-spec `page.clock` pins added for midnight safety (existing ones at fixed hours stay as they are).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ordinary hour | test starts 14:00 Zagreb | no wait, no annotation | N/A |
| Near midnight | test starts 23:55:00 Zagreb | waits ~5 min 5 s, timeout raised by the wait, annotation `midnight-wait` | N/A |
| Just past midnight | test starts 00:00:30 | no wait | N/A |
| DST change day | last Sunday of March/October | wall-clock based: transitions are at 02:00/03:00, so the distance to the next 00:00 is still right | N/A |

</frozen-after-approval>

## Code Map

- `e2e/utils/custom-fixtures.ts` -- `test = base.extend<…>`: every spec under `e2e/tests` (and `auth.setup.ts`) imports `test` from here; add the auto fixture.
- `e2e/utils/dates.ts` -- date helpers; add `msUntilMidnight(now, timeZone)` and `midnightWait(now, timeZone, timeoutMs)` (the decision, pure).
- `test/e2e-midnight-guard.test.ts` -- new DB-free root vitest file over both (precedent: `test/e2e-fixture.test.ts` imports `e2e/utils`).
- `e2e/utils/run-fixture.ts:30` -- `RUN_TIMEZONE = 'Europe/Zagreb'`, the zone to read in; the run organization is provisioned with it (`organization_timezone: RUN_TIMEZONE`, line 120), and `playwright.config.ts` sets `timezoneId: 'Europe/Zagreb'`, so seed, server and browser change date at the same instant.
- `playwright.config.ts` -- default 30 s timeout; `conflict-resolution.spec.ts` sets 120 s and `test.slow()` (×3 = 360 s), the longest. Read-only.
- Seeds that read today, read-only evidence: `seedTeamRotation` (`database-helper.ts:1500`, `organization_today`), `today()` helpers on `new Date()` in `offline-write`, `sign-out-clears`, `organization-switch`, `people`, `offline-read`, `rotation`, `hours` specs. No spec seeds in `beforeAll`.

## Tasks & Acceptance

**Execution:**
- [x] `e2e/utils/dates.ts` -- add `msUntilMidnight(now: Date, timeZone: string): number` from the zone's wall clock -- the pure part, checkable without a browser.
- [x] `e2e/utils/custom-fixtures.ts` -- add auto test fixture `midnightGuard`: when `midnightWait(new Date(), RUN_TIMEZONE, testInfo.timeout) > 0`, raise the timeout by the wait (unless it is 0, no timeout), annotate `midnight-wait`, sleep the wait -- one now per test, the same date for seed, page and server.
- [x] `test/e2e-midnight-guard.test.ts` -- CET, CEST, 00:00, both DST eves, the spring-forward day, another zone, the margin boundary, a long timeout, timeout 0 -- the matrix rows, run in CI.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- prefix the entry with `RESOLVED by spec-today-spec-midnight-safe (2026-11-17) — `.

**Acceptance Criteria:**
- Given a test starts within 8 minutes before 00:00 Zagreb, when its fixtures set up, then the body starts after 00:00 and the test's timeout covers the wait.
- Given any other start time, when the test runs, then nothing changes.

## Spec Change Log

- Review 1 (blind, edge-case, verification-gap layers; epic AC auditor not run: not an epic story). (a) The wait branch had no committed check: the decision moved into pure `midnightWait` and `test/e2e-midnight-guard.test.ts` covers it (outside `e2e/`, as `test/e2e-fixture.test.ts` already is). (b) A timeout of 0 (no timeout) became exactly the wait: now left alone. (c) A test whose timeout is known to exceed 8 min would start uncovered: the margin is `max(8 min, timeout + 1 min)`; a `test.slow()` called in a body is still unknown at setup, which the 8 min floor covers today (360 s). (d) A missing wall-clock part read as 0 and silently disabled the guard: it now throws. (e) The DST claim was overstated: the doc says exact within hours of midnight. KEEP: one auto fixture, no per-spec `page.clock` changes.
- Not acted on: `beforeAll`/worker-fixture seeds stay uncovered (none today; stated in the fixture's doc); the run fixture's membership is dated on the provisioning day, which stays effective after midnight; there is no switch to force the wait path in e2e (the unit test covers the decision; the sleep and timeout raise are three lines).

## Design Notes

Why not `page.clock` per test (the entry's first suggestion): a pinned browser clock agrees with the seed, but not with RPCs that read `organization_today()` server-side at request time, nor with tests that open their own contexts, and it means editing ~30 specs blind (CI is the only e2e gate). The guard makes all three readers agree with one change. Cost: in a run that reaches 23:52 Zagreb, each worker idles once, at most ~8 min (shards take 10–15 min; the job limit is 30); a retry after midnight does not wait.

## Verification

Results seen 2026-11-17:
- `pnpm exec tsc -p e2e/tsconfig.json` and `pnpm exec tsc -p tsconfig.json` -- 0 errors.
- `pnpm exec eslint e2e test/e2e-midnight-guard.test.ts` -- clean.
- `pnpm exec vitest run test/e2e-midnight-guard.test.ts test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- 3 files, 1983 tests pass.
- `pnpm exec playwright test --list` -- 563 tests in 56 files load with the new fixture.
- E2E: CI only (not run locally, by rule). Status stays `in-review` (built, CI pending) until merged with CI green.
