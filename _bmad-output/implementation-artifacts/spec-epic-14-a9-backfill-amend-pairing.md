---
title: 'Epic 14 retro A9: prove the backfilled half of the amend pairing over every version of every writer'
type: 'chore'
created: '2026-11-17'
status: 'done'
baseline_commit: 'bb661d8c1c92889356b4c1c8f0a0075834b51875'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-epic-14-retro-a9-history-page.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Deferred-work entry "code review of spec-epic-14-retro-a9-history-page.md": the amend-writer pin proves the live half of `amendPairsOf` (one `transaction_id`), not the backfilled half: a `removed` UPDATE and an INSERT, both `origin = 'backfill'`, at one `occurred_at`, sharing the key, are read as one *izmijenjeno*. Pre-0061 rows were written by every version of every function since 0019, not only the final ones. Founder decision 2026-11-17 (retro A9): fix all A9 items.

**Approach:** Prove it from source, DB-free, in `test/supabase-scaffold.test.ts`: (1) 0061 dates a backfilled removal at `removed_at` and an insert at `created_at`; (2) both are always a transaction's `now()`; (3) over EVERY version of every function ever created (drops forget nothing) and every migration's own top-level DML, only the three `amend_*` functions soft-remove and insert one of `leave_records`, `roster_overrides`, `shift_type_overrides`. If the proof fails, narrow the backfill branch of `amendPairsOf` instead.

## Boundaries & Constraints

**Always:** reuse the existing pin's parser (`amendWritersOf`), extended, not a second one. Every new parser path has a synthetic self-test and a non-vacuity floor. What the proof cannot reach from source (two transactions beginning in the same microsecond; operator scripts run outside migrations) is said in the test and here, not queried.

**Ask First:** a migration, or a change to `amendPairsOf`'s live branch.

**Never:** connect to any database or run DB-connecting tests; edit `sprint-status.yaml` or `apps/web` (another session holds them).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dropped writer | a function that removed and inserted, later dropped | history mode still reports it as pairing | final mode forgets it |
| Migration fixup | a migration's own `insert` plus a removal through a called function | reported in `fixups` | `grant execute on function f(` is not a call |
| `do` block | `do $$ … perform f() … $$` | its call is read | — |
| Removal instant | `update <amend> set removed_at = X` anywhere | X is `now()` | any other X fails the pin |

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- `test/supabase-scaffold.test.ts` `amendWritersOf` (~4849) -- the A9 parser; gains `{ history }` (a drop forgets nothing), `fixups` (each migration's top-level DML, closed over calls) and `dmlFiles` (a floor).
- `test/supabase-scaffold.test.ts` new pin "gives a backfilled removal and insert one instant only when one amend wrote both…" and self-test "keeps every version ever created in history mode…".
- `supabase/migrations/0061_audit_events.sql` BACKFILL block -- read-only evidence: `pairs` dates the three tables' removals at `removed_at`; INSERT events at `created_at`.
- `supabase/migrations/0019`, `0026`, `0028` -- `created_at … default now()`, column-scoped insert grants without `created_at`/`removed_at`, no update grant (read-only evidence).
- `supabase/operator/demo-organization.sql` -- local/staging only; inserts one shift-type and one roster override with `created_at = now() + 10/11 ms`, never removes. `seed.sql` -- local/CI fixtures only.
- `packages/domain/src/history.ts` `amendPairsOf` / `pairKeyOf` (~950) -- unchanged: the proof holds.

## Tasks & Acceptance

**Execution:**
- [x] `test/supabase-scaffold.test.ts` -- extend `amendWritersOf` with history mode, migration fixups and `dmlFiles`; add the backfill pin and the self-test -- the proof.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the entry `RESOLVED by spec-epic-14-a9-backfill-amend-pairing (2026-11-17) — `.

**Acceptance Criteria:**
- Given the migrations as they stand, when the scaffold test runs, then history-mode pairing is exactly the three `amend_*` functions, removers exactly `amend_*` and `remove_*`, no trigger removes or inserts an amend table, no dynamic SQL names one, and no migration's own DML writes one.
- Given any `update` of an amend table's `removed_at` in any migration, then its value is `now()`; no insert into one names `created_at` or `removed_at`; no grant lets a session write either.

## Design Notes

Why equal instants mean one transaction: `now()` is the transaction's start, constant within it. The removal instant is only ever `now()` (session has no update grant; every function writes `now()`), the insert instant only ever `created_at`'s default `now()` (no insert names it; the session grant excludes it; `service_role` writes these tables from no Edge Function). PostgREST runs each request in its own transaction, so one transaction that both removes and inserts is one function call or one migration.

What the proof rests on outside source (stated, not queried): two DIFFERENT transactions whose `now()` agree to the microsecond, one removing a row and the other inserting one of the same member (or team and date) before 0061. Postgres takes each transaction's start from the clock independently, so this is not impossible, only vanishingly unlikely at pilot volume; if it happened, the two rows would read as one amend. The demo script's `now() + 10 ms` insert could meet a removal of that instant only on staging or local, never production. The proof also assumes production's functions and data were changed only by these migrations: an SQL-editor hotfix or a manual `psql` write before 0061 is outside what source can show.

Review hardening (patch findings, step 2): the removal value is read whole (`now() - interval …` fails); no update of `created_at`, no upsert, no `new.created_at|removed_at :=`, no rule, no block comment, no add/drop/rename of either column, no `alter default privileges` or `on all tables in schema` grant, the default-privilege revoke is pinned per table, every operator script (listed, not named) is read, and a `do` block's dynamic SQL and a quoted call name are read in fixups.

Historical writers found: the history-mode pin returns the same sets as the final-definition pin. No renamed or dropped function ever soft-removed an amend table; the inserters across history are the three `amend_*`, `decide_leave_request`, `decide_swap_request` and `replace_conflict_member`; no migration's top-level DML writes an amend table (0033's fixup updates `conflict_resolutions` only; 0061's backfill writes `audit_events` only).

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean.
- `pnpm lint` -- expected: clean.
- `pnpm --filter @shift/domain test` -- expected: all pass (no domain change).
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- expected: all pass.

**Observed failing when broken (temporary edits, reverted):** `removed_at = now() - interval '1 ms'` in 0029 fails "a removal is dated by something other than now()"; a function created and dropped in 0040 that removes and inserts `leave_records` fails the history pin (`zz_probe` in pairing) while the final-definition pin still passes. No test connects to a database; DB-connecting tests are CI's.

## Suggested Review Order

**The proof**

- The pin: three steps from 0061's instants to "only an amend wrote both".
  [`supabase-scaffold.test.ts:5032`](../../test/supabase-scaffold.test.ts#L5032)

- Step 2: every way an instant column could be written is shut, or is `now()`.
  [`supabase-scaffold.test.ts:5070`](../../test/supabase-scaffold.test.ts#L5070)

- Step 3: history-mode writers and migration fixups equal the final-definition sets.
  [`supabase-scaffold.test.ts:5156`](../../test/supabase-scaffold.test.ts#L5156)

**The parser**

- History mode: a drop forgets nothing, so every version ever live is read.
  [`supabase-scaffold.test.ts:4903`](../../test/supabase-scaffold.test.ts#L4903)

- A migration's own DML, closed over its calls; dynamic SQL refused.
  [`supabase-scaffold.test.ts:4963`](../../test/supabase-scaffold.test.ts#L4963)

- Synthetic self-test of history mode and fixups.
  [`supabase-scaffold.test.ts:5224`](../../test/supabase-scaffold.test.ts#L5224)

**Ledger**

- The deferral marked resolved.
  [`deferred-work.md:1575`](deferred-work.md#L1575)
