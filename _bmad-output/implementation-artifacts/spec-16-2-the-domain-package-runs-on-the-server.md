---
title: '16.2 The domain package runs on the server'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
baseline_commit: 'ce82d6cff83d72132dd5a14cf73719d56ff9bf7c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-16-context.md'
---

Status: built, CI pending (no PR yet). Baseline: `main` at #337 (Architect pass 1); touches no hot file.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The feed (16.4) and the reminders (17.2) must say exactly what the app says, but `@shift/domain` has only ever run in the browser: nothing proves it loads under the pinned Deno, no SQL assembles a member's inputs, R12 is not a function, and no instant can be computed without a second conversion (AD-1 note, AD-6, AD-7, AD-19).

**Approach:** Add R12 (`atWorkShiftsOf`) and its input type `ScheduleInputs` to the domain, and `zone.ts` (AD-6's one `Intl` module). Add `private.member_schedule_inputs` (0065) over four shared "live" helpers, and `apps/web`'s one adapter. Prove parity twice: a DB suite (server assembly ≡ browser read, written unrun) and a runtime probe byte-compared between Node and the pinned `edge-runtime` from `dist` through a `deno.json` map (a CI job). Hash the domain into the functions image's source key.

## Boundaries & Constraints

**Always:**
- Domain stays dependency-free; only `zone.ts` names `Intl`/`Date` (purity test). Deno consumes `dist` via `"@shift/domain": "<rel>/packages/domain/dist/index.js"` — never `src/`, `npm:`/`jsr:`, or a copy.
- R12.1: the working, timed shifts of `memberScheduleOfMonth` after overrides IN FORCE (`overrideStandingOf` over stamps) and loans, none on a full-day leave date. R12.2: a half day keeps the date's one working shift with the worked half (`shiftHalvesOf`); with two working shifts nothing is split (as hours). A shift with no version in effect, or a non-working type, is not at work.
- `member_schedule_inputs`: definer, no role may execute; camelCase `ScheduleInputs` jsonb; versioned rules whole, overrides by date, loans/leave by overlap; µs = `(extract(epoch from t)*1000000)::bigint`; no name, reason, author, rank, account, type name, drawing flag; only the member's own leave; `half` key only when set; unknown member → null; bad window → 22023 `SCHEDULE_INPUTS_WINDOW`.
- "Live" is stated once: `private.live_*` helpers; `calendar_shift_type_overrides`, `calendar_roster_overrides`, `calendar_team_loans`, `my_leave_records` re-created over them (`create or replace`, signatures and grants kept).
- Required input (deferred-work, 18.2 → 16.2): the assembly returns each member's live loans as `calendar_team_loans()` does, with a parity test. Answered here.

**Ask First:** none (founder: decide and record).

**Never:** a new table or Edge Function; `calendar_feed_inputs`/tokens (16.3–16.4); `@shift/ics` (16.4); running DB tests, e2e, `supabase` or docker containers locally (the chroot of the pinned image is the local runtime check).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Loan | member lent across a date | shift on the loan team with `loanId` | none |
| Roster override in force / pending | put on, taken off; stamp older than version | applied / ignored | none |
| Full-day / half-day leave | whole date; `FIRST` on Dan 07–19 | date dropped; `780–1140 workedHalf SECOND` | overlapping records → RangeError |
| Night half | `FIRST` on Noć 19–07 | `1500–1860` (starts past midnight, start date kept) | none |
| DST gap / overlap | 02:30 Zagreb 2026-03-29 / 2026-10-25 | 01:30Z / 00:30Z (earlier) | unknown zone → RangeError |
| Window | `to < from`, > 732 days | — | RangeError |

## Epic AC Deviations

- "imported by an Edge Function under Deno" — **narrowed**: imported by the parity entry under the functions' pinned runtime, with the map a function will use; the first Edge Function import is 16.4's (decision 2).
- "the Deno projection, hours and R12 … equal the browser's for every member and every date" — **reinterpreted**: the browser's engine is represented by Node over the same `dist` (both V8); the probe covers R12, the month schedule and every member's hours for every parity-fixture member and every date of 2026-03-01…2027-10-31 (all 20 months). Read parity covers every member who can sign in (decision 4).

</frozen-after-approval>

## Code Map

- `packages/domain/src/at-work.ts` (new) -- `ScheduleInputs` (+ `ScheduleTeam`, `ScheduleMember`, `ScheduleLeave`, `StampedRosterOverride`), `atWorkShiftsOf`, `MAX_AT_WORK_RANGE_DAYS`; reuses `memberScheduleOfMonth`, `overrideStandingOf`, `shiftHalvesOf`, `checkRange`.
- `packages/domain/src/zone.ts` (new) -- `instantOf`, `offsetMinutesAt`, `utcIsoOf`, `zoneTransitionsOf`, `checkTimeZone`.
- `packages/domain/src/index.ts` -- exports both.
- `packages/domain/parity/{fixtures,probe}.ts` (new) -- the parity fixture (both fixtures + every exception kind at the DST dates, token vector) and the probe; import nothing at run time.
- `deploy/parity/{index.ts,deno.json}` (new) -- the Deno entry and its map onto `dist`; not an Edge Function.
- `apps/web/src/features/calendar/services/schedule-inputs.ts` (new) -- `scheduleInputsOfCalendar(snapshot, ownLeave, window)`; `calendar-screen.fixture.ts` lists it.
- `supabase/migrations/0065_member_schedule_inputs.sql` (new) -- helpers, re-created reads, the assembly.
- Mappers of the rows read (rule A11), deliberately left: `snapshot.ts` (`readCalendar`, `loansOf`, overrides parsers), `leave-list.ts` (`leaveRecordsOf`); no column is added, the adapter reads their output.
- `scripts/ci/deploy-images.sh` -- `FUNCTIONS_SOURCES` + domain src/package/tsconfigs, base tsconfig, lockfile.
- `scripts/ci/runtime-parity.sh` (new), `.github/workflows/pipeline.yml` -- job `runtime-parity`, in `ci-passed`, ShellCheck.
- `test/runtime-parity.test.ts`, `test/schedule-inputs-parity.test.ts` (new); `test/coolify-deploy.test.ts`, `test/supabase-scaffold.test.ts` extended.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/{zone,at-work,index}.ts` -- R12, the assembly type, zone conversions -- AD-6, AD-7, R12.
- [x] `packages/domain/test/{zone,at-work,parity-fixture,purity}.test.ts` -- both fixtures, the matrix, `Intl`/`Date` only in `zone.ts`.
- [x] `packages/domain/parity/*`, `deploy/parity/*`, `test/runtime-parity.test.ts`, `scripts/ci/runtime-parity.sh`, `pipeline.yml` -- runtime parity (AD-19 test 2).
- [x] `supabase/migrations/0065_member_schedule_inputs.sql`, `test/supabase-scaffold.test.ts` -- the assembly and its source pins.
- [x] `apps/web/.../schedule-inputs.ts` + test -- the adapter.
- [x] `test/schedule-inputs-parity.test.ts` -- read parity (AD-19 test 1), unrun.
- [x] `scripts/ci/deploy-images.sh`, `test/coolify-deploy.test.ts` -- the source hash covers the domain.
- [x] `_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md` -- `Amended 2026-11-21 (16.2)` clauses on AD-6, AD-7, AD-19.
- [x] `_bmad-output/specs/spec-shift/engine-rules.md` -- R12 written as a rule.
- [x] `deferred-work.md` -- 18.2 entry RESOLVED; new entries for 16.4 and 17.2.

**Acceptance Criteria:**
- Given the built `dist`, when the probe runs under Node and under `edge-runtime` v1.74.3 (bundled, `--network none`), then the two bodies are byte-identical.
- Given both fixtures' members who can sign in, when the browser's reads and `member_schedule_inputs` are compared, then the ordered assemblies and their R12 are deep-equal.
- Given `anon`, `authenticated`, `service_role`, when they ask for EXECUTE on the assembly, then none has it.
- Given a change to `packages/domain/src` alone, when the deploy hashes `FUNCTIONS_SOURCES`, then the key changes.

## Design Notes

Decisions (founder: decide and record):
1. **Names.** R12 is `atWorkShiftsOf(inputs, from, to)`; the assembly keeps AD-19's `ScheduleInputs`; an `AtWorkShift` is `{date, teamId, shiftTypeId, startMinute, endMinute, viaOverride, loanId?, workedHalf?}`, minutes after the start date's midnight.
2. **No Edge Function imports the domain yet.** The Deno consumer in 16.2 is the parity entry, mapped exactly as a function's will be. The Dockerfile copy of `dist` (and building it before the image) lands with `calendar-feed` (16.4); the source hash covers the domain now.
3. **Local Deno check** (20.2 approach): image saved, chrooted with `/proc`, private netns. Bundled and served from the eszip; after review, every month of the window: 981 717 bytes, SHA-256 `567e1330…34dc`, identical to Node 24.19.0 under Vitest. CLI `functions serve` over the map was not run (no `supabase` commands); 16.4's e2e serves it.
4. **Read parity scope:** every member active today with an account (the browser path needs a session); the scene is committed as the owner 150–165 days ahead and deleted in `afterAll` with its outbox rows.
5. **`zone.ts`:** gap → offset before the gap; overlap → earlier instant. `reminderDueAt` is 17.2's (lead kinds are its decision); "the last transition before the window" is `@shift/ics`'s choice over `zoneTransitionsOf`.
6. **Token vector** `shift-parity-vector_0123456789abcdefghijklA` → `2375020b…c232`, pinned for 16.3's SQL suite.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build` -- pass.
- `pnpm --filter @shift/domain test` -- 20 files, 950 tests pass.
- `pnpm --filter ./apps/web test` -- 178 files, 6665 tests pass (after listing the new service in `calendar-screen.fixture.ts`).
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/functions-router.test.ts test/self-hosted-stack.test.ts test/coolify-deploy.test.ts test/ci-scripts.test.ts test/runtime-parity.test.ts` -- 7 files, 2227 tests pass.

**Residual risk (CI settles):** `test/schedule-inputs-parity.test.ts`, the provisioning entries and 0065 have never run against a database (STRICT DATABASE RULE); the `runtime-parity` job has never run on a runner (docker there, chroot here). The existing DB suites now exercise the four re-created reads.

**Review (five layers):** patched — the probe projects every month of the window (Epic AC auditor); a transition at a range's first instant is kept, an unreadable `Intl` part throws, a team given twice throws (edge cases); the purity scan tokenizes comments, strings and template interpolations in one pass; the read-parity scene adds loans and leave wholly outside the window and one straddling it, a confirmed shift-type override and a pending roster override (verification gap, blind hunter); the parity script stops waiting on a crashed container; `test/provisioning.test.ts` lists the five new `private` functions in its grantee sweep, owner and invoker inventories (unrun DB test auditor: the sweep would have failed CI); deferred-work records that the assembly's callers are its gate and that `deploy-staging` waits on `runtime-parity` from 16.4. Rejected or left: non-inlined `SET` helpers (pilot scale; the browser reads return the same rows), tag-only image pins (an existing 20.9 item), historic LMT and double transitions, non-canonical zone aliases, audit rows the scene leaves (no FK; fresh CI stack).

**Review 2 (2026-11-21, unattended; blind hunter, edge cases, verification gap, acceptance + epic AC, unrun DB test; no generated file, so no artifact render):**
- **The migration.** The four re-created reads were diffed against 0022, 0039, 0062 and 0058. Columns, order, the claim pin, the active-caller pin, definer, `search_path` and the author subquery are all unchanged. `create or replace` keeps the grants. The claim and `removed_at` moved into `private.live_*(claim)`, which means the same thing. The assembly is definer, executable by no role, has an empty `search_path`, and is scoped to the member's organization in every subquery. It carries no name, reason, author or flag beyond team and shift-type names (the SUMMARY needs them). The provisioning inventories match 0065 exactly. The scene violates no constraint or trigger, and the one expected code matches 0065's raise.
- **Patched:**
  - **The purity scan could be fooled.** Regex literals with a quote or `//`, a `}` inside `${…}`, `globalThis['Date']`, an escaped identifier, and `localeCompare`/`toLocale*`, which read ICU without naming `Intl`, all got past it. The rule is now also in eslint, scope-aware: `no-restricted-globals` bans `Date`, `Intl`, `Temporal`, `globalThis` and `performance` in `packages/domain/src`, with `zone.ts` allowed `Intl` only. `no-restricted-properties` bans the locale methods. All four bypass shapes were confirmed to fail lint.
  - **R12 parity was nearly vacuous.** The seed gives nobody a team, so the shift-type override and both leave records changed no shift. The scene's loan now runs 150–166, and the override is on the lent team. The window test asserts R12 over the server assembly: shifts on the loan, the override's type on its date, nothing on the full days, and only the SECOND half on the half day.
  - **A CI mismatch printed only digests.** `runtime-parity.sh` now prints the first differing byte with context. The comparison was exercised locally on both outcomes.
  - **Stale text:** the probe's header ("each transition month"), the parity file's CI note, the root `vitest.config.ts` alias comment, and deferred-work's 18.2 RESOLVED, which is now marked pending the first CI run.
- **Rejected:**
  - **Read parity sorts lists before comparing.** R12 is order-independent (`at-work.test.ts`), and an unrun suite should not hinge on jsonb's array order. The canonical order holds by construction on both sides.
  - **`effectiveFrom` sorts with no tie-break.** One version per date is each table's key.
  - **A half with one timed and one untimed working shift is not split.** That is hours' rule (`hours.ts` counts working shifts, timed or not), and R12.2 says "as in hours".
  - **A multi-day half is not refused.** `checkRange` already refuses it.
  - **`archived` is never read by R12.** The browser shows an archived team's shifts too, and the feed decides presentation.
  - **No window cap in SQL.** The callers' windows are fixed (16.4, 17.2) and R12 refuses more than 732 days.
  - **The "Node" side runs under Vitest.** It loads the same `dist` in V8, and a transform cannot change the bytes the answer serializes.
  - **The script is mode 644.** It is run with `bash`.
  - **The image might lack `bash`, `/dev/tcp` or `timeout`.** The functions-image probe already uses all three on this base.
  - **The tag-only pin.** An existing 20.9 item.
  - **`runtime-parity` runs on docs-only PRs.** So does `functions-image`. It is one image pull.
  - **`FUNCTIONS_SOURCES` hashes more than it needs.** That is AC 4 by intent: a redundant image is cheaper than a stale one.
  - **Importing `snapshot.ts` from the root suite.** The client throws only on first use, `@/` is aliased at the root, and the module graph holds only `apps/web` dependencies.
  - **A partial `beforeAll` or audit rows leave residue.** CI's stack is fresh, and the `test/rls-isolation.test.ts` precedent is noted.
  - **LMT sub-minute offsets, non-canonical zone ids, double transitions within 12 h or 24 h, and instants past ±8.64e15.** As in review 1. Native `Intl` errors are `RangeError`s too.
  - **The AD-1/AD-7 spine notes predate this change (AP1, #337).** The story's "Depends on" line names that.

**CI, first run (2026-11-21, run 44903974050 on 18d0eb6): a one-off refusal, not a product bug and not a scene defect.** `test/schedule-inputs-parity.test.ts` failed one case: the browser snapshot refused `members` for the pilot admin `ivan.maric` (`CALENDAR_UNAVAILABLE members`). Every other suite passed, UJ-5 included, under the same scene.
- **What `members` means.** `identitiesOf` refuses in only two cases. Either the `calendar_members()` answer is not a 2xx JSON array, or a row has a non-uuid or empty `id`, a blank `name`, a non-text `fire_rank`, or a repeated `id`. No pilot state reaches the row checks. `id` is the primary key. `members_name_check` (0024) trims the same Unicode set as JS `trim()`. `fire_rank` is text or null. The rpc returns the organization's members, which are the same rows for every caller, so a data defect would refuse every pilot viewer, and `rls-isolation` (same job, earlier) would have failed its `calendar_members` case for that same admin. The scene adds no member and no team, only rows that `calendar_members()` does not read. The loan, the override on the lent team and the leave rows are checked by other mappers, which would refuse under their own names (`loan`, `override`), not `members`.
- **So the rpc's answer for that one request was not 2xx.** The organizations select on the same token, in the same `Promise.all`, had already validated, so the token and the viewer were sound. The response body was not captured, because the snapshot logs only the check's name. The test's transport now records each answer's path, status and body (first 600 characters) and the viewer's position, and prints them on a refusal (commit `test(domain): read parity prints what PostgREST answered on a refusal`).
- **Run 44905714485 on that commit passed.** All six cases passed, with the same scene and code, on a fresh stack. The failure is therefore not deterministic. No product or scene change was made. Residual risk: if it recurs, the failure message now carries PostgREST's status and body, so it names its own cause.


- 2026-11-21, CI root cause: the read-parity refusal was PostgREST answering `organizations` 401 PGRST303 "JWT issued at future" for a token GoTrue had just issued (run on 76e6f63, captured by the diagnostic transport). A test defect, not a product one: the test now waits until the token's issuing second has passed before its first read (`usableAfterIssue`).
