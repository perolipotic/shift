---
title: 'Epic 14 retro A9: Povijest promjena names departed members, proves its amend pairing, renders in steps, and has its missing e2e'
type: 'bugfix'
created: '2026-11-17'
status: 'done'
baseline_revision: '20d5b5b9b9d8dbae697fd9966be95bdd3a6e910b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-epic-14-retro-a3-a6-history-gaps.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-retro-2026-11-16.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The four 14.2 review deferrals (deferred-work, "code review of spec-14-2…"): (1) a member deleted by an auth-user cascade is *Nepoznata osoba* as author or subject unless a `members` event lies in the period read; (2) amend pairing treats any soft-remove + insert of one key in one transaction as an amend, unproven; (3) *Povijest promjena* renders every row; (4) no e2e covers the unavailable alert and retry, the filtered-out line, or a second keyset page. Founder decision 2026-11-17 (retro A9): fix all four 14.2 deferrals.

**Approach:** (1) Inside the period query, after the events and the A3 request read, read the organization's `members` DELETE events for the member ids and auth users the read names but holds no `members` row for (chunks of 100), and name them from the DELETE's old row. (2) A DB-free migration scan pins the exact set of functions that soft-remove and insert one amend-keyed table. (3) Render 200 rows, *Prikaži još* adds 200; filters, counts and export keep the whole read. (4) Playwright specs.

## Boundaries & Constraints

**Always:** AD-11 "Attribution" (a departed actor is named from its DELETE event's old row) is what (1) implements; spine gets an `Amended 2026-11-17 (epic 14 retro A9)` clause. Any refusal or malformed row of the new read makes the whole read `HISTORY_UNAVAILABLE`. The current members list still wins over any event row. Every word in `hr.json`. The full re-read on focus/reconnect stays (it picks up late-committing events). Step count resets when the period or a chip changes, not on a refetch.

**Ask First:** a migration, index or grant (none expected: RLS + the organization prefix of the existing index serve the read).

**Never:** touch the local Supabase stack or run DB-connecting tests/e2e locally (CI is the gate); the 14.3 PDF deferrals; `e2e/tests/today`; read the `members` table's own history beyond DELETE events.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Departed subject | event names `member_id` M; M not current, no `members` event in read; DELETE event of M exists | subject and option named from its old row | — |
| Departed author | `actor` A; no member row for A in read or list; DELETE event whose `old_row.auth_user_id` = A | author is that member's name | — |
| Never named | no DELETE event found | *Nepoznata osoba*, as before | — |
| All named in read | every id has a `members` row in the read | no extra read | — |
| Read refused / wrong row | PostgREST error, or a row not a `members` DELETE of an asked id | view unavailable | `HISTORY_UNAVAILABLE` |
| 1101 rows | filtered rows > 200 | 200 drawn, *Prikazano 200 od 1101 unosa.*, *Prikaži još* | — |
| Last step | *Prikaži još* reaches all rows | button gone, focus on the status line | — |

## Epic AC Deviations

None. (Story 14.2's ACs are met more fully; the step-rendering is presentation only: every entry stays reachable, and filters, counts and the PDF cover the whole read.)

</frozen-after-approval>

## Code Map

- `packages/domain/src/history.ts` -- `memberIdentitiesOf` (:705), `MEMBER_COLUMNS` (:731), `HistoryContext` (:1066), `historyEntriesOf` (:1130), `AMEND_KEYS` (:297), `amendPairsOf`. Gains `historyUnnamedMembersOf` and `HistoryContext.departed`.
- `packages/domain/src/index.ts` -- re-exports.
- `apps/web/src/features/history/services/history-read.ts` -- `historyQueryOptions`, `readHistoryRequests` (chunk pattern to reuse). Gains `readHistoryDeparted`, `HistoryRead.departed`. Column-mapper rule: no row gains a column; the read reuses `HISTORY_COLUMNS` and `readAuditEventOf`.
- `apps/web/src/features/history/hooks/use-change-history.ts` -- passes `departed` into `historyEntriesOf` and, first, into `historyNamesOf`.
- `apps/web/src/features/history/services/history-rows.ts` -- `namesFrom` (first event row wins after reverse — departed rows go first); `HISTORY_ROWS_STEP`.
- `apps/web/src/features/history/components/history-body.tsx` -- renders `HistoryTable`/`HistoryStackedRows` with all rows today; the stepped wrapper goes here, keyed on `screen.stateKey`.
- `test/supabase-scaffold.test.ts` -- `stripLineComments`, `sqlStatements` helpers; the amend-writer pin goes here (DB-free, run locally).
- Evidence (2): final definitions that soft-remove `leave_records`/`roster_overrides`/`shift_type_overrides`: `remove_leave_record`, `remove_roster_override`, `remove_shift_type_override`, `amend_leave_record`, `amend_roster_override`, `amend_shift_type_override`; inserters: the three `amend_*`, `decide_leave_request`, `decide_swap_request`, `replace_conflict_member`. Only the `amend_*` do both; no function calls a remover. PostgREST runs one statement set per request, so direct writes cannot pair.
- `e2e/tests/history/history.spec.ts`, `e2e/pages/history.page.ts` (`filteredLine` unused), `e2e/utils/database-helper.ts` (`seedExtraTeam`, `backdateHistoryOfRowInSql`, `removeTeamInSql`), `e2e/tests/conflicts/conflicts-queue.spec.ts:417` (500 route pattern).

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/history.ts` + `index.ts` -- `historyUnnamedMembersOf(events)` → `{ memberIds, authUserIds }`: member ids the events (MEMBER_COLUMNS) name, and actors, minus those a `members` event row in the read carries; deduped. (Request rows are not asked: their member keys do not cascade, so their members exist.) `HistoryContext.departed?` rows feed `memberIdentitiesOf` (below the read's rows and the current list).
- [x] `packages/domain/test/history.test.ts` -- unnamed ids; departed author resolves to member; current list still wins.
- [x] `apps/web/src/features/history/services/history-read.ts` (+ test) -- `readHistoryDeparted(audit, unnamed, signal)`: `table_name = members`, `operation = DELETE`, `row_id in` chunk and `old_row->>auth_user_id in` chunk (≤100 each, in parallel, newest first, a page of 1000, a full page refused, deduped by id); validate; `HistoryRead.departed`; issued beside the A3 request read; no call when nothing is unnamed.
- [x] `apps/web/src/features/history/hooks/use-change-history.ts` -- wire `departed`.
- [x] `apps/web/src/features/history/services/history-rows.ts` (+ test) -- `HISTORY_ROWS_STEP = 200`, `historyRowsShownOf(rows, limit)`.
- [x] `apps/web/src/features/history/components/history-body.tsx` -- stepped rows: status line `history.partial` when rows > step, *Prikaži još* (`history.more`) while rows remain, focus to the status line on the last step; keyed on `stateKey`.
- [x] `apps/web/src/lib/i18n/locales/hr.json` -- `history.more` "Prikaži još", `history.partial` "Prikazano {shown} od {total} unosa." (genitive *unosa* fits every count).
- [x] `test/supabase-scaffold.test.ts` -- amend-writer pin (statement-ordered final definitions; transitive through calls; exact list = the three `amend_*`; removers list pinned too).
- [x] `e2e/pages/history.page.ts`, `e2e/utils/database-helper.ts`, `e2e/tests/history/history-states.spec.ts` -- unavailable + retry; filtered line + *Poništi filtre*; 1100 renames of one team in one transaction (ties on `occurred_at`) back-dated 200 days in that transaction, `?smjena=…&razdoblje=365-dana` shows 200 of 1101, steps to all, rows 1000/1001 across the page boundary in id order, the INSERT last; a member deleted before the period named as subject and chip.
- [x] `ARCHITECTURE-SPINE.md` + `.memlog.md` -- AD-11 A9 clause (departed read, pairing proof, stepped rendering, full re-read kept).
- [x] `deferred-work.md` -- RESOLVED prefixes on the four entries; `sprint-status.yaml` item 69 comment.

- [x] `EXPERIENCE.md`, `epics.md` UX-DR51 -- the stepped rows and *Prikaži još*; the PDF prints every filtered row (review: epic AC auditor, 14.2 AC2).

**Acceptance Criteria:**
- Given a member deleted before the period whose ids an in-period event names, when the history renders, then author and subject read the member's last name, not *Nepoznata osoba*.
- Given a migration adds a function that soft-removes and inserts one amend-keyed table, when the root DB-free tests run, then the pin fails.
- Given more than 200 rows, when the page renders, then 200 are drawn and *Prikaži još* adds 200, while the summary, chips and PDF count every row.

## Spec Change Log

None. No bad_spec or intent_gap loopback.

## Design Notes

The full re-read on focus and reconnect is kept on purpose: every load reads the whole period afresh, which is how an event that committed behind the keyset cursor is picked up (14.2). Stepping cuts only the drawing.

The departed read's calls go out on most loads: the history query does not hold the current members list (a separate key), so a current member with no `members` event in the period is asked for too; the answers hold only deleted members. Subtracting the list would need it inside the history query (a key change) — not worth it at Q20 scale.

DELETE-only, not "latest before/after row of any `members` event": the current members list holds every member that still exists (it has no status filter), so an unnamed member is a deleted one, and its DELETE event's old row is its last row by construction — one row per member, no paging. Authors are auth users, not `row_id`s, so the author read filters `old_row->>auth_user_id` (no index; inside RLS's organization and a `table_name`/`operation` filter, small at Q20 scale). The rows the read finds feed names and identities only, never entries.

## Verification

**Commands:**
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- pass.
- `pnpm --filter @shift/domain test && pnpm --filter web test` -- pass.
- `pnpm lint && pnpm typecheck` -- pass.
- e2e and DB tests: CI only (STRICT DATABASE RULE).

**Results (2026-11-17, local, after the review fixes):** `pnpm typecheck` and `pnpm lint` clean; `pnpm -r test` — domain 854/854, web 6474/6474; `pnpm build` ok; DB-free root files (resource-hygiene, supabase-scaffold, import-cycles, feature-boundaries, key-hygiene, localization-applied, localization-guard, e2e-plural, typography-coverage, workspace-isolation, static-hosting, theme-contrast, no-jsdom) 3273/3273. Not run locally: `e2e/tests/history/*` and every DB-connecting root file — CI is the gate.

**Residual risk (until CI):** the four new e2e tests have never run; in particular `.in('old_row->>auth_user_id', …)` against real PostgREST is proven only by CI's departed-member e2e (which exercises the `row_id` path; the auth-user path is unit-tested against a stub only). The stepped focus move and the step reset on a chip change have no component test (the web suite has no DOM); the reset is by `key={stateKey}`.

## Review Triage Log

### 2026-11-17 — Review pass (blind, edge-case, verification-gap, epic AC auditor)
- intent_gap: 0
- bad_spec: 0
- patch: 12
- defer: 0
- addressed_findings:
  - `[medium]` `[patch]` UX docs said the PDF prints "exactly the rows shown"; with stepping the screen draws a subset. EXPERIENCE.md (*Povijest promjena*, **History export**) and UX-DR51 now describe the steps and that the PDF prints every filtered row (epic AC auditor, 14.2 AC2).
  - `[medium]` `[patch]` The auth-user departed read was capped at `chunk.length` ascending, so a second DELETE of one auth user could crowd out other ids or give an old name. Now newest first, a page of 1000, a full page refused.
  - `[medium]` `[patch]` No test of the hook wiring or a real departed member: added e2e *names a member deleted before the period…* (subject and *Osoba* chip, through the `row_id` path).
  - `[medium]` `[patch]` The departed read ran after the request read; request rows never name a deleted member (no-cascade FKs), so `historyUnnamedMembersOf` takes the events alone and both reads run at once.
  - `[low]` `[patch]` The spine and Design Notes overstated how rarely the departed read runs; reworded (calls on most loads, answers only the deleted).
  - `[low]` `[patch]` The amend-writer pin: reads any schema, `create or replace trigger`, every body a name had since its last drop (overloads), every name a `drop function` lists; pins the six inserters; refuses a trigger function that inserts into an amend table and dynamic SQL naming one; states its limits.
  - `[low]` `[patch]` The paging e2e now checks rows 1000/1001 across the page boundary in id order and each rename once; the back-date check requires exactly `count + 1` rows.
  - `[low]` `[patch]` A weakened unit assertion again pins the call count (4).
  - `[low]` `[patch]` The e2e header's event count, deferred-work's "CI pending" wording.
- Rejected (with reason):
  - Subtract the current members list from the departed read: needs the list inside the history query's key; documented as a cost instead.
  - Abort not passed into each chunk call: the same pattern as the A3 request read; a cancelled load's few small reads are harmless.
  - Focus falls to the body when a refetch shrinks the rows under a focused *Prikaži još*: needs a shrink of more than a step between two refetches; rare.
  - The status line stays after all rows are drawn and may be announced twice: it is the focus target that says the list is complete.
  - Two "Prikazano" lines: the summary counts changes, the new line drawn rows; their wording differs on purpose.
  - Persisting 1101 back-dated events on a reused database: CI runs a fresh stack; locally e2e is not run.
  - 1100 round trips in the seed helper: one local transaction, well under the test timeout; simpler than a `DO` block with no parameters.
  - Step reset and phone stacking e2e: the reset is by React `key`, the phone path shares `historyRowsShownOf`, unit-tested; a second 1100-event seed at phone width is not worth its CI time.
  - Departed rows ordered "after" in the domain and "first" for `namesFrom`: each matches its consumer's convention, now commented at the read.
  - The frozen Approach says the departed read runs "after the events and the A3 request read"; it now runs beside it. A wording difference inside the frozen block, recorded here instead of edited.

## Suggested Review Order

**Departed members named**

- Entry point: one read beside the A3 request read, inside the period query.
  [`history-read.ts:478`](../../apps/web/src/features/history/services/history-read.ts#L478)

- DELETE events by row_id and by the old row's auth user, validated.
  [`history-read.ts:436`](../../apps/web/src/features/history/services/history-read.ts#L436)

- Who the read names but cannot name; request rows deliberately excluded.
  [`history.ts:876`](../../packages/domain/src/history.ts#L876)

- Departed rows feed author identity; the current list still wins.
  [`history.ts:712`](../../packages/domain/src/history.ts#L712)

- Hook passes departed rows to entries, and first to names.
  [`use-change-history.ts:198`](../../apps/web/src/features/history/hooks/use-change-history.ts#L198)

**Amend pairing proof**

- Final function definitions closed over calls; exact lists pinned.
  [`supabase-scaffold.test.ts:4849`](../../test/supabase-scaffold.test.ts#L4849)

- The pin itself, with its stated limits.
  [`supabase-scaffold.test.ts:4922`](../../test/supabase-scaffold.test.ts#L4922)

**Rendering in steps**

- Stepped rows keyed on the URL state, so refetches keep the count.
  [`history-body.tsx:94`](../../apps/web/src/features/history/components/history-body.tsx#L94)

- Button, status line and focus move on the last step.
  [`history-body.tsx:132`](../../apps/web/src/features/history/components/history-body.tsx#L132)

- The step size and slicing helper.
  [`history-rows.ts:837`](../../apps/web/src/features/history/services/history-rows.ts#L837)

**Docs and e2e**

- AD-11 A9 clause.
  [`ARCHITECTURE-SPINE.md:187`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L187)

- Unavailable, filtered-out, keyset paging and departed-member e2e.
  [`history-states.spec.ts:34`](../../e2e/tests/history/history-states.spec.ts#L34)

- 1100 renames in one transaction, back-dated in it.
  [`database-helper.ts:1748`](../../e2e/utils/database-helper.ts#L1748)
