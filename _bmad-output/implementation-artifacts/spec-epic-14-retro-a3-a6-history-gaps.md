---
title: 'Epic 14 retro A3–A6: every decision names its subject, every real change names a field, AD-3 inventory and CAP-24 settings scope'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_revision: '9497ac67ca8b7bc0a6489a5272737875f6aed209'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-retro-2026-11-16.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-14-2-an-admin-reads-the-change-history.md'
warnings: ['multiple-goals', 'oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The epic 14 retro (R1–R4) found four gaps the founder decided on 2026-11-16, answering "yes" to each recommendation: (A3) a leave/swap decision whose request event lies outside the read period has no member/team subject, so *Osoba*/*Smjena* never keep it, and the 14.2 "Applied" clause contradicts AD-11's "read from the period or the current requests"; (A4) real changes read *Bez promijenjenih polja* because `pattern_id`, `offset_step_id`, `roster_override_id` and the lifecycle `_at`/`_by` pairs are hidden; (A5) AD-3 names only two refusing triggers while 0023/0031/0035/0036/0039 ship more; (A6) CAP-24's "a setting" is ambiguous about a member's own `notification_settings`.

**Approach:** A3: one extra, batched, RLS-scoped read of the current `leave_requests`/`swap_requests` rows for the decisions whose request has no event in the read, inside the same period query (one snapshot, AD-13); the domain falls back to that row for the subject. A4: unhide the non-bookkeeping columns with typed operands resolved from rows the read already holds, and derive a `status` before/after line from the lifecycle columns on an UPDATE. A5/A6: spine (and PRD/SPEC/epics wording) amendments only.

## Boundaries & Constraints

**Always:** Domain stays pure (codes and operands, AD-7/AD-8); every word from `hr.json`; no raw uuid is ever the only text of a value; a request row that no longer exists leaves the decision subject-less, as before; the PDF consumes the same `rows` (no change to `history-export.ts` logic); the extra read runs only when an unmatched decision exists, chunks ids (≤100 per call), and any refusal or malformed row makes the whole read `HISTORY_UNAVAILABLE`; spine amendments carry `Amended 2026-11-16 (epic 14 retro A3|A5|A6)` clauses.

**Block If:** a migration would be needed (none is: the read is by primary key, under the existing `*_select_own_organization` policies).

**Never:** change SQL (A5 ratifies what exists); add a read of rotation/pattern lists or roster-override lists for names (resolve from events read, else a neutral word); audit `notification_settings`; re-decide AD-11's audited table list.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Decision, request outside period | decision event in read, no `leave_requests` event with its `row_id`; current row `{id, member_id: ANA}` | entry subjects `members: [ANA]`; *Osoba: Ana* keeps it | — |
| Request row gone | unmatched decision, current-requests read returns no row | subjects empty, entry still shown | — |
| No unmatched decision | every decision matched in read | no request read issued | — |
| Request read fails | PostgREST error on `leave_requests` | view unavailable | `HISTORY_UNAVAILABLE` |
| Status-only update | `leave_records` UPDATE, only `removed_at`/`removed_by` set | change `status`: `current` → `removed` | — |
| Request closed | `leave_requests` UPDATE `closed_*` set | `status`: `open` → `closed` | — |
| Assignment insert | `rotation_assignments` INSERT with `pattern_id`, `offset_step_id` | lines *Uzorak rotacije* and *Pomak* with resolved or neutral text | — |
| Resolution relinked | `conflict_resolutions` UPDATE of `roster_override_id` only (0043 amend) | *Zamjena osobe* line, before/after | — |
| Pattern insert | `rotation_patterns` INSERT (only bookkeeping columns) | one *Uzorak rotacije* line from its own id | — |

## Epic AC Deviations

- Epic 14 / CAP-24: "Every write to a rule, an exception, a decision, a request, a member or a setting appears…". Spec: "a setting" is an organization setting; a member's own `notification_settings` (e-mail opt-out) is not recorded. Why: founder decision 2026-11-16 (retro A6), matching AD-11's existing exclusion. Reinterpreted, not deferred.
- Every other epic 14 AC: none deviated; A3 and A4 bring the build closer to them.

</intent-contract>

## Code Map

- `packages/domain/src/history.ts` -- `HIDDEN_COLUMNS` (:273), `FIELD_OF_COLUMN` (:311), `historyOperandOf` (:429), `historyChangesOf` (:488), `subjectsOf`/`requestEventOf` (:657-711), `HistoryContext` (:894), `historyEntriesOf` (:946). All A3/A4 domain changes here.
- `packages/domain/src/index.ts` (~:240) -- re-exports; add new exports.
- `packages/domain/test/history.test.ts` -- existing subject test "leaves a decision whose request is not read without a subject" (:376) stays valid without context rows; add fallback, status, operand and per-table audit tests.
- `apps/web/src/features/history/services/history-read.ts` -- `HistoryRead`, `historyQueryOptions(table, period)` (single `audit_events` source). Gains the request read; source becomes a by-table factory. Column-mapper rule: the new `select(` lists for `leave_requests` (`id,member_id`) and `swap_requests` (`id,proposer_id,addressee_id,team_id,return_team_id`) are new readers, deliberately minimal; no existing request mapper (`features/leave-requests/*`, `features/swaps/*`) changes.
- `apps/web/src/features/history/services/history-read.test.ts` -- stubs `historyQueryOptions(() => table, …)` (:194, :271); update to the factory.
- `apps/web/src/features/history/hooks/use-change-history.ts` (:145, :186) -- passes the factory and `requests` into `historyEntriesOf`.
- `apps/web/src/features/history/services/history-rows.ts` -- `HistoryNames`, `historyNamesOf`, `historyOperandText`, `changeOperandText`, `ENUM_KEYS`, `FIELD_KEYS`: new operands/fields/enum words; rotation step position shown 1-based (as the builder's *Korak {n}*).
- `apps/web/src/features/history/services/history-rows.test.ts`, `history-export.test.ts`, `pdf.test.ts` -- extend/keep green (pdf test checks every `history.*` string is in Roboto).
- `apps/web/src/lib/i18n/locales/hr.json` -- `history.field.*`, `history.enum.status*`, `history.value.*` additions.
- `e2e/tests/history/history.spec.ts`, `e2e/utils/database-helper.ts` (`seedLeaveMember` :271, `seedLeaveRequest` :780, `removeLeaveMemberInSql` :407) -- A3 e2e.
- `_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md` -- AD-3 (:80-90), AD-11 (:138-174, "Reading it" :151, 14.2 Applied :167); `.memlog.md` beside it.
- `_bmad-output/planning-artifacts/prds/prd-shift-2026-09-01/prd.md` (:975), `_bmad-output/specs/spec-shift/SPEC.md` (:127), `_bmad-output/planning-artifacts/epics.md` (:53) -- "a setting" wording.
- Read-only evidence (A5): `refuse_status_version_leaving_no_admin` + `refuse_truncate` (0023), `refuse_conflict_resolution_off_leave` (0031, redefined 0038), `refuse_write_by_stale_admin` (0035, 0036), `refuse_override_on_archived` / `refuse_archive_in_rotation` (0036; teams trigger dropped 0037, shift-types one kept), `refuse_assignment_on_archived_type` (0039). Plus the named Q6 constraint trigger (0002) and `refuse_leave_request_over_leave` (0040/0041/0047). `serialize_organization_writes`, the deactivation closes, `filter_notification_outbox`, `touch_notification_settings`, `seed_absence_types` and the audit/notify triggers refuse nothing.
- Read-only evidence (A4 audit): column lists of the 21 tables (migrations 0002–0059); update grants show `conflict_resolutions.roster_override_id` is rewritten by 0039/0043 amend definers; `rotation_*`, decisions and `members.auth_user_id` have no UPDATE path.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/history.ts` -- A3: `HistoryRequestRow {tableName, id, row}`; `HistoryContext.requests?`; export `historyUnmatchedRequestIdsOf(events)` → `{ leave_requests: string[]; swap_requests: string[] }` (decisions with no request event read, deduped); `subjectsOf` falls back to the current row. A4: hidden set = `organization_id`, `id`, `created_*`, `decided_*`, lifecycle `removed_*`/`confirmed_*`/`closed_*`/`answered_*` (carried by the status line), `request_id`, `auth_user_id`, `leave_record_id`; unhide `pattern_id` (field `rotationPattern`, operand `rotation-pattern`), `offset_step_id` (`offsetStep`, `rotation-step`), `roster_override_id` (`rosterOverride`, `roster-override`), `return_roster_override_id` (`returnRosterOverride`, `roster-override`); new enum field `status` (`current|open|confirmed|answered|closed|removed`) emitted first on an UPDATE whose lifecycle state differs; `historyChangesOf(before, after, tableName?)` treats a `rotation_patterns` row's `id` as its pattern; export `HISTORY_HIDDEN_COLUMNS`.
- `packages/domain/src/index.ts` -- export the new names.
- `packages/domain/test/history.test.ts` -- fallback (found, gone, live-matched wins), unmatched ids, status lines, new operands, and the per-table audit: for each of the 21 tables and each non-hidden column (lifecycle `_at` included), an UPDATE changing only it yields ≥1 change; the hidden set equals the declared bookkeeping set.
- `apps/web/src/features/history/services/history-read.ts` -- `historyQueryOptions(source: (table) => HistoryTable, period)`; after the events, `readHistoryRequests` for the unmatched ids (chunks of 100, `.in('id', …)`), validated; `HistoryRead.requests`.
- `apps/web/src/features/history/services/history-read.test.ts` -- factory, no read when all matched, chunking, failure → unavailable, malformed row → unavailable.
- `apps/web/src/features/history/hooks/use-change-history.ts` -- factory and `requests` into the context.
- `apps/web/src/features/history/services/history-rows.ts` (+ test) -- names gain rotation steps (by id: pattern, position, shift type) and roster overrides (by id: date, out, in) from the events read; texts: step `Korak {position}: {name}`, pattern `{count} koraka: {steps}`, override `{date}: {memberIn} umjesto {memberOut}`, neutral `… spremljen ranije` words when the read lacks the row; status enum words; rotation step `position` shown 1-based.
- `apps/web/src/lib/i18n/locales/hr.json` -- the new keys.
- `e2e/tests/history/history.spec.ts` -- A3: a rejected request seeded for a fresh member, its request events back-dated 400 days in SQL, then `?osoba=<member>` keeps the decision row. Grep `e2e/` for `Bez promijenjenih` / `noChanges` / position words.
- `ARCHITECTURE-SPINE.md` -- AD-11: `Amended 2026-11-16 (epic 14 retro A3)` clause restoring the fallback and correcting the 14.2 Applied "no current-requests read" sentence; `Amended … (A4)` naming the hidden set; `Amended … (A6)` on the Excluded list; AD-3: `Amended 2026-11-16 (epic 14 retro A5)` inventory. `.memlog.md` event line.
- `prd.md`, `SPEC.md`, `epics.md`, `epic-14-context.md` -- "a setting" → "an organization setting", with the A6 note.
- `deferred-work.md` -- RESOLVED prefixes on the decision-subject and *Bez promijenjenih polja* entries.
- `sprint-status.yaml`, `epic-14-retro-2026-11-16.md` -- items 63–66 `done` with comments; retro action table gets an Outcome column.

**Acceptance Criteria:**
- Given a decision whose request has no event in the period but whose request row exists, when the admin filters *Osoba* by that member, then the decision row is shown, on screen and in the PDF.
- Given any of the 21 audited tables, when an UPDATE changes only one non-bookkeeping column, then the entry shows at least one change line and never *Bez promijenjenih polja*.
- Given a rotation assignment, step or relinked resolution, when its row is drawn, then no value's only text is a uuid.
- Given the spine, when AD-3 and AD-11 are read, then AD-11 states one decision-subject rule, AD-3 lists every refusing trigger in the migrations with its refusal and origin, and the excluded list says CAP-24's "setting" is organization settings only (founder, 2026-11-16).

## Design Notes

Status codes: a row with `removed_at` set is `removed`; else `closed_at` → `closed`; else `answered_at` → `answered`; else `confirmed_at` → `confirmed`; else `open` for `leave_requests`/`swap_requests` (row holds `closed_at`) and `current` otherwise. Emitted only when both rows exist and at least one lifecycle key is present, so inserts, deletes and amend pairs (both sides live) add no status line.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm -r test && pnpm build` -- expected: pass except the known 4 `format.test.ts` Node-22 failures.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts test/key-hygiene.test.ts test/theme-contrast.test.ts test/localization-applied.test.ts test/static-hosting.test.ts` -- expected: pass.
- e2e and DB tests: CI only (no local stack).

## Spec Change Log

None. No bad_spec or intent_gap loopback.

## Review Triage Log

### 2026-11-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 4, low 8)
- defer: 0
- reject: 16
- addressed_findings:
  - `[medium]` `[patch]` Two sides of a change could render the same neutral text (*Uzorak spremljen ranije* on both). They are now marked `(prethodna vrijednost)` / `(nova vrijednost)` (`history.value.differsBefore/After`), with a test.
  - `[medium]` `[patch]` The A4 audit was tied only to a hand-written fixture. `test/supabase-scaffold.test.ts` now parses every migration's live columns of the 21 tables and requires each one to be hidden bookkeeping or mapped to a named field (`historyFieldOfColumn`).
  - `[medium]` `[patch]` The roster-override wording put a nominative name after *umjesto*. It now reads `{date}: ulazi {in}, izlazi {out}`.
  - `[medium]` `[patch]` The spine's AD-11 14.2 "No index" bullet ("no per-record read") contradicted A3. It is amended in place. The A3 clause states the shared query key (not a DB snapshot) and why the read is admin-only in practice.
  - `[low]` `[patch]` The derived status line used the column key `status`, which could collide with a real `status` column. It now uses `$status` (`HISTORY_STATUS_COLUMN`).
  - `[low]` `[patch]` Restored the `Object.hasOwn` guard for decision tables (`requestTableOf`). Also fixed the same latent prototype-key lookup in `pairKeyOf` (pre-existing from 14.2), which the new test exposed.
  - `[low]` `[patch]` A position is shown 1-based only for a rotation step, labelled *Redni broj koraka*. A team position keeps *Položaj*.
  - `[low]` `[patch]` Request chunk reads now run in parallel after one abort check.
  - `[low]` `[patch]` `HistoryRequestRow.tableName` is typed as `HistoryRequestTableName`.
  - `[low]` `[patch]` The scaffold request-read pins are less brittle: both column lists are pinned, and the module makes no writes. A redundant test stub was removed.
  - `[low]` `[patch]` Spine A4 clause: named *Zamjena osobe za povrat*, documented why the status precedence differs from the action order (a swap decline reads *odgovoreno* and *Stanje* → *zatvoreno*), added a blank line before AD-12.
  - `[low]` `[patch]` UX docs: one sentence each in the EXPERIENCE.md *Povijest promjena* entry and in UX-DR51 (epics.md), for the 14.2 AC2 same-change rule. The epic AC auditor found this.
- Rejected (with reason):
  - A lifecycle `_at` re-set between two non-null values: no write path does this.
  - A partial step set: a pattern's steps are written in one save transaction.
  - Empty-string member ids: not representable.
  - Over-reading requests for decisions in the padding: harmless.
  - A malformed request row blanks the page: by design, per the spec's Always rule.
  - No PDF test for A3: the export consumes the same `rows` and is unchanged, so it holds by construction.
  - No A4 e2e: the unit and domain tests plus the migration-parsing test cover it.
  - Mismatched key shapes: OLD and NEW of one event share a shape.
  - Long pattern lists: the 14.3 fixed widths wrap.
  - Smjena on leave decisions: a leave request has no team, as before.
  - Items marked `done` ahead of CI: the comments record "built, CI pending" per retro A11, as the caller asked.
  - deferred-work RESOLVED format: follows the customization rule.
  - Loose `supabaseClient().from` cast: pre-existing pattern.
  - A3 "one extra read" being several calls: batched as the intent allows.
  - Spine "superseded" annotation rather than a rewrite: the spine now states one rule.
  - The story-versus-migration naming in A5: the origins are given by migration and PR, because those triggers came from fix PRs, not stories.

## Auto Run Result

Status: done

**Summary.** Epic 14 retro A3–A6, as decided by the founder on 2026-11-16.
- **A3.** A decision whose request has no event in the read takes its member and team from the current `leave_requests`/`swap_requests` row. That row comes from one batched, by-id, RLS-scoped read inside the period query, issued only for unmatched ids. A request row that is gone leaves the decision subject-less. The PDF exports the same `rows`, so it inherits the fix.
- **A4.** The hidden columns are now exactly the bookkeeping set. Pattern, offset step and roster-override links show as named fields (resolved from the events read, else a neutral *… spremljen(a) ranije*, never a uuid). A lifecycle change shows a *Stanje* before/after line. A rotation pattern insert names its pattern. Per-table domain tests and a migration-parsing scaffold test prove no real UPDATE reads *Bez promijenjenih polja*.
- **A5.** AD-3 lists every refusing trigger, with its refusal and origin.
- **A6.** CAP-24's "a setting" means an organization setting: in the spine (AD-11 Excluded), PRD FR-78, SPEC, epics and the epic 14 context.

**Files.**
- `packages/domain/src/history.ts`, `index.ts`, `test/history.test.ts`: subject fallback, unmatched ids, hidden set, new operands, status line, per-table audit.
- `apps/web/src/features/history/services/history-read.ts` (+test): the request read.
- `hooks/use-change-history.ts`: wiring.
- `services/history-rows.ts` (+test): wording.
- `apps/web/src/lib/i18n/locales/hr.json`: new keys.
- `apps/web/src/pages/key-sources.fixture.ts`, `test/resource-hygiene.test.ts`: key counts and the sanctioned list.
- `test/supabase-scaffold.test.ts`: request-read pins and the migration column audit.
- `e2e/tests/history/history.spec.ts`, `e2e/utils/database-helper.ts`: A3 e2e (back-dated request events, `?osoba=` keeps the decision).
- `ARCHITECTURE-SPINE.md` (+`.memlog.md`), `EXPERIENCE.md`, `epics.md`, `prd.md`, `SPEC.md`, `epic-14-context.md`: amendments.
- `deferred-work.md`: two entries RESOLVED.
- `sprint-status.yaml`: items 63–66 done.
- `epic-14-retro-2026-11-16.md`: Outcome column.

**Review.** 12 patches applied (4 medium, 8 low), 0 deferred, 16 rejected. Follow-up review recommended: true (3×4 + 8 = 20 ≥ 5).

**Verification (Node 22).**
- `pnpm typecheck` and `pnpm lint`: exit 0.
- `pnpm -r test`: domain 849/849; web 6461 passed, 4 failed (the known `format.test.ts` env failures).
- `pnpm build`: OK.
- The 8 DB-free root tests: 2948/2948.

**Residual risks.**
- The `.in('id', …)` request read under real RLS/PostgREST and the A3 e2e run only in CI. The e2e updates `audit_events.occurred_at` as the SQL owner.
- Pattern and step names resolve only when their rows were written inside the read window; otherwise the neutral word is shown.
