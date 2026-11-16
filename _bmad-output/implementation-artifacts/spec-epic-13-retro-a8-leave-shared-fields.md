---
title: 'Epic 13 retro A8: one shared copy of a leave row''s fields, leave-section split by concern, the leave-year duplicates collapsed'
type: 'refactor'
created: '2026-11-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: 'a3885906f27732678c4452db857f4ca0dd9ce3d7'
baseline_revision: 'a3885906f27732678c4452db857f4ca0dd9ce3d7'
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The fetch-paused name 'paused' is still declared in several leave modules (FETCH_PAUSED in leave-section-base, LEAVE_RECORDS_FETCH_PAUSED in leave-list, local copies in leave-conflicts, leave-overview and my-leave).
    evidence: |-
      Blind review of A8. Pre-existing duplication (the split kept one copy per module it had); not one of A8's three named duplicates.
    location: >-
      apps/web/src/features/leave/services/
    severity: low
---

<intent-contract>

## Intent

**Problem:** A leave row's fields (id, dates, type, draws, half) are copied field by field in about ten places, so 13.5 had to add `...halfFieldOf(...)` at nine sites and found sites that had silently dropped fields (retro A-mappers). `leave-section.ts` is 1527 lines mixing ids, key pickers, half state, preview, sources and hand-off (A-size). The leave-year start from the organization answer, the allowance in a leave year and the balance input are each written twice (A-dup). Epic 13 retro action A8.

**Approach:** Add the shared copies — `leaveSpanOf` / `leaveChargeOf` / `leaveAllowanceOn` in `@shift/domain`, `leaveRecordFieldsOf` and `LEAVE_ROW_COLUMNS` in `leave-list.ts` — and route every copy through them. Move `leave-section.ts`'s non-key concerns into `leave-section-*.ts` modules, leaving `leave-section.ts` as the key pickers plus an explicit re-export of the same public names. Collapse each duplicate onto one copy. No behaviour change: every output is the same object shape and value.

## Boundaries & Constraints

**Always:**
- Pure refactor: same outputs, same object keys (a whole day never gains a `half` key; no site gains or loses `drawsAllowance`, `id` or `memberId`), same selects byte for byte, same logs.
- `@/features/leave/services/leave-section` exports exactly the names it exports at baseline, so no importer outside the leave feature changes and `FEATURE_PUBLIC` is untouched. Re-exports are explicit named lists, never `export *`.
- Every i18n key literal of the leave card stays in `leave-section.ts`, so `LEAVE_SECTION_KEYS` (`strings: 38`) is unchanged. The new modules hold no key literal.
- The new `leave-section-*.ts` modules never import `leave-section.ts`; no new import cycle (`test/import-cycles.test.ts`).
- Existing tests pass unchanged, except fixtures that must list the new files.

**Block If:** removing the duplication at a site would change what it outputs.

**Never:**
- Touch `hr.json`, migrations, SQL, `supabase/functions/notify` or e2e.
- Unify the two raw leave-year-start parsers (`members/services/list.ts` `leaveYearStartIn`, `organization/services/snapshot.ts` `organizationSnapshotOf`): they read different raw rows with different refusal policies (range-checked and absence-tolerant vs. finite number only), so one copy would change which rows are refused.
- Touch the other A-dup items (two type-parse policies, `LEAVE_TYPES_UNAVAILABLE` vs `ABSENCE_TYPES_UNAVAILABLE`, the two draws key pickers, unused `leaveCostOf`): not in A8's three; deferred.
- Run DB-connecting root tests, apply migrations, or run e2e locally.

</intent-contract>

## Code Map

Shared copies (new):
- `packages/domain/src/leave.ts` -- beside `halfFieldOf` (`:149`): `leaveSpanOf(range)` = `{ from, to, ...halfFieldOf(range) }` (where a leave lies and how much of the date); `leaveChargeOf(range)` = span plus `drawsAllowance` only when the input has it (what the balance reads); `leaveAllowanceOn(allowance, date, start)` = `leaveAllowanceOf(allowance, leaveYearNumberOf(date, start))`. `:932` `extra` becomes `leaveSpanOf(preview.range)`. Export all three from `packages/domain/src/index.ts`.
- `apps/web/src/features/leave/services/leave-list.ts` -- `LEAVE_ROW_COLUMNS = 'id,member_id,during,absence_type_id,half'`; `LEAVE_RECORDS_COLUMNS` = it + `',...absence_types(draws_allowance)'`. `leaveRecordFieldsOf(record: LeaveRecord): LeaveRecord` = `{ id, absenceTypeId, drawsAllowance, ...leaveSpanOf(record) }` (drops `memberId`). Parser `:184` builds through it.

Copy sites routed (changed):
- `leave/services/leave-request-list.ts` -- both selects (`:58`, `:78`) start from `LEAVE_ROW_COLUMNS`; `requestRowOf` `:305-309` and `leaveRequestsOf` `:336` spread `leaveSpanOf(...)`.
- `conflicts/services/resolution-screen.ts` -- `:787-796` `.map(leaveRecordFieldsOf)` (or a lambda calling it); `:874` `leaveSpanOf({ ...record.record, from: collision.date, to: collision.date })`.
- `hours/services/hours-conflicts.ts` -- `byMemberOf` (`:145`) takes `(LeaveRecord & { memberId })[]` (both callers pass ids) and builds `const { id: _id, ...record } = leaveRecordFieldsOf(one)`.
- `staffing/services/short-staffed.ts:327`, `calendar/utils/month.ts:1083-1088` -- `{ id, memberId, ...leaveSpanOf(x) }`.
- `calendar/services/marks.ts:104,120`, `today/services/today.ts:462,497` -- `leaveSpanOf(record)`.
- `leave/services/leave-section.ts:206,1173` -- `leaveChargeOf(record)`.

Copy sites deliberately left (listed per A11):
- `hours/services/my-hours.ts:152` and `today/services/today.ts:696` read `halfFieldOf` into a view, they copy no row. `today.ts:518` (`dayLookupOf`) copies dates only on purpose (13.7: no calendar half mark). `leave/services/leave-conflicts.ts:156,169` give `collisionsOf` id and dates only. `leave-section.ts:826` builds a range from form input. `conflicts/services/resolution-screen.ts:456` builds the amend's staffing record from an amend target (`AMEND_STARTS`/`AMEND_ENDS` trim a record to more than one date or keep a longer one's end, never a half). Outside the leave rows: `organization/components/organization-time-card.tsx:118` builds the start from the settings form's own values, and `members/services/write.ts:760` numbers the leave year an allowance save writes (no allowance resolved). The view rows `half: x.half ?? null` (`conflicts-queue.ts:308,466`, `resolved-conflicts.ts:299`, `admin-today.ts:591,838,854`, `day-detail.ts:1226`) name the half on a surface. `organizationLeaveRecordsOf` (`leave-list.ts:652`) spreads the parsed record whole. `hours-export.ts` copies cells, no row. `supabase/functions/notify` reads SQL-written operands (out of the web app). The offline snapshot persists raw rows, read back through `leaveRecordsOf` / `requestRowOf`.

Duplicates:
- Leave-year start: `leave-overview.ts:475` uses `leaveYearStartOf(organization.data)` (`leave-section.ts:251`).
- Allowance in a year: `leave-overview.ts:470-478` `allowanceInYearOf` and `members/services/list.ts:714-718` `memberAllowanceOn` both call `leaveAllowanceOn`, keeping their own null/throw guards.
- Balance input: `leave-section.ts:301-308` and `my-leave.ts:182-198` `myLeaveInputOf` both build through one `leaveRecordsInputOf(snapshot, history, allowance, records, leaveYearStart, carryOver, now)` in the base module (`history` is the `CalendarMemberHistory` passed to `memberScheduleInputOf`). `myLeaveInputOf` stays as a one-line call.

The split (all in `apps/web/src/features/leave/services/`):
- `leave-section-ids.ts` -- every DOM id, `LEAVE_LINE_SEPARATOR`, `LEAVE_NO_DATE`, `leaveHalfSwitchDescribedByOf`.
- `leave-section-base.ts` -- sources, `LEAVE_LOADING`…`LEAVE_READY`, `MemberLeaveBase`, `LeaveRecordsInput`, `LeaveRecordRow`, `leaveRangeValuesOf`, `leaveInYearChargeOf`, `leaveRecordRowsOf`, heading years, `leaveYearStartOf`, `leaveCarryOverOf`, `leaveRecordsInputOf`, `memberLeaveBaseOf`; a module-level `FETCH_PAUSED` exported for the replacements module only (not re-exported).
- `leave-section-carried.ts` -- `CARRIED_*`, `LeaveCarriedLine`, `leaveCarriedLineOf`, `LeaveExceeds`, `EXCEEDS_*`, `leaveExceedsOf`.
- `leave-section-half.ts` -- `LeaveHalfChoice`, `LEAVE_WHOLE_DAY`, `leaveHalfChoiceOf`, `leaveHalfRestoredOf`, `leaveHalfOfferedOf`, `leaveSentHalfOf`, `LeaveHalfOption`, `leaveHalfOptionsOf`.
- `leave-section-types.ts` -- `LeaveTypeChoice`, `LEAVE_TYPES_UNAVAILABLE`, `leaveTypesOf`, `leaveTypeChoiceOf`, `leaveTypeNameOf`, `typedLeaveBaseOf`.
- `leave-section-preview.ts` -- reason and field constants and types, `LEAVE_PREVIEW_REASON`/`READY`, `LeavePreviewState`, `leavePreviewStateOf`, `leavePreviewInYearOf`.
- `leave-section-replacements.ts` -- `leaveUncoversDate` through `replacementGuardOf`.
- `leave-section-outcome.ts` -- `LeaveSaved` through `leaveDescribedByOf`, minus `leaveRefusalMessageKey`.
- `leave-section-handoff.ts` -- `AMEND_*` through `leaveHandoffMissed`.
- `leave-section.ts` -- the module doc, every key picker (`leaveRemovePromptMessageKey`, the three carried pickers, `leaveBaseMessageKey`, `leaveHalfMessageKey`, `leaveCostHalfMessageKey`, `leaveRangeHalfMessageKey`, `LeaveRangeHalfKey`, `LeaveRangeHalfTranslate`, `leaveHalfNamedOf`, `leaveReasonMessageKey`, `leaveTypeDrawsMessageKey`, `leaveRefusalMessageKey`), and the named re-exports.
- `apps/web/src/features/leave/leave-screen.fixture.ts` -- `LEAVE_SCREEN_EXEMPT` lists each new module with its reason.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/leave.ts`, `index.ts`, `test/leave.test.ts` -- add and export the three helpers; use `leaveSpanOf` at `:932`; tests: whole day has no `half` key, a null half is dropped, a half is kept; `leaveChargeOf` keeps `drawsAllowance: false`, omits it when absent; `leaveAllowanceOn` equals `leaveAllowanceOf` of the containing year across a non-January start.
- `leave/services/leave-list.ts` (+ test) -- `LEAVE_ROW_COLUMNS`, `leaveRecordFieldsOf`, parser through it; test `leaveRecordFieldsOf` drops `memberId` and keeps a half.
- The changed copy sites in the Code Map -- route through the helpers.
- The duplicates in the Code Map -- collapse.
- The split -- create the nine modules by moving code verbatim (doc comments with it); reduce `leave-section.ts` to the key pickers and named re-exports; update `leave-screen.fixture.ts`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- add one entry (source this spec) for the A-dup items left out (Never list). No existing entry matches A8 (checked: none names the mapper copies, the split or these three duplicates), so none is marked RESOLVED.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `epic-13-retro-item-57-…` `status: done  # spec-epic-13-retro-a8-leave-shared-fields`.

**Acceptance Criteria:**
- Given the baseline export list of `leave-section.ts`, when the split is done, then the module exports the same names and every existing importer and test compiles and passes unchanged.
- Given `grep -rn "halfFieldOf" apps/web/src --include=*.ts` excluding tests, then it hits only `my-hours.ts` and `today.ts:696`'s view; every row copy goes through `leaveSpanOf`, `leaveChargeOf` or `leaveRecordFieldsOf`.
- Given `leave-section.ts`, then it is under 450 lines and holds every leave-card key literal; no `leave-section-*.ts` holds one.
- Given the three duplicates, then `leaveYearStartMonth` is read in `leave-section-base.ts` only among leave services, and `leaveAllowanceOf(…leaveYearNumberOf(` appears nowhere in `apps/web/src`.

## Spec Change Log

## Review Triage Log

### 2026-11-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 0, low 6)
- defer: 1 (high 0, medium 0, low 1)
- reject: 9 (high 0, medium 0, low 9)
- addressed_findings:
  - `[low]` `[patch]` `leave-section.ts`'s module doc still described the whole card; rewritten to say it is the public face and the words, the rules in `leave-section-*.ts`.
  - `[low]` `[patch]` The barrel doc said it re-exports "the rest"; it now names the two deliberately unexported names (`leaveRecordsInputOf`, `FETCH_PAUSED`) and who imports them from `-base`.
  - `[low]` `[patch]` `leave-screen.fixture.ts`'s `leave-section.ts` reason updated to match.
  - `[low]` `[patch]` `LEAVE_ROW_COLUMNS`'s doc now says both request selects (another table) start from it, so a column there must exist on both tables.
  - `[low]` `[patch]` The shared balance input had no test of its own: `my-leave.test.ts` now asserts *Godišnji*'s input equals the admin card's for the same member.
  - `[low]` `[patch]` Code Map's deliberately-left list now names `resolution-screen.ts:456` (amend-target staffing record, never a half), `organization-time-card.tsx:118` and `members/services/write.ts:760`.

## Design Notes

Two domain helpers, not one: `leaveSpanOf` gives what staffing, marks, collisions and *Danas* read; adding `drawsAllowance` there would change their outputs. A new per-date column goes in `leaveSpanOf`; a new record column in `leaveRecordFieldsOf` and `LEAVE_ROW_COLUMNS`. The barrel keeps the public face stable; the split lowers the reader's load, not the importers'.

## Verification

**Commands:** (run `export PATH=/root/.local/bin:$PATH` first)
- `pnpm typecheck` -- expected: no errors.
- `pnpm lint` -- expected: no errors (feature boundaries included).
- `pnpm -r test` -- expected: every workspace suite passes (web, domain).
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts test/key-hygiene.test.ts` -- expected: pass (all DB-free).
- DB-connecting root tests and e2e are not run locally (STRICT DATABASE RULE, no local stack); nothing here touches SQL, so CI is the gate for them.

## Auto Run Result

Status: done

**Summary.** No-behaviour-change refactor for epic 13 retro A8. Shared copies: `leaveSpanOf`, `leaveChargeOf`, `leaveAllowanceOn` (`@shift/domain`), `leaveRecordFieldsOf` and `LEAVE_ROW_COLUMNS` (`leave-list.ts`); every row copy in the Code Map goes through them. `leave-section.ts` (1527 lines) is split into nine `leave-section-*.ts` modules; it keeps the key pickers and re-exports the same 139 public names (412 lines). The leave-year start from the organization answer, the allowance in a leave year and the balance input each have one copy.

**Files changed (31).** Domain: `packages/domain/src/leave.ts`, `index.ts`, `test/leave.test.ts`. Leave: `leave-list.ts` (+test), `leave-request-list.ts`, `leave-overview.ts`, `my-leave.ts` (+test), `leave-section.ts`, nine new `leave-section-*.ts`, `leave-screen.fixture.ts`. Copy sites: `calendar/services/marks.ts`, `calendar/utils/month.ts`, `conflicts/services/resolution-screen.ts`, `hours/services/hours-conflicts.ts`, `staffing/services/short-staffed.ts`, `today/services/today.ts`, `members/services/list.ts`. BMAD: `deferred-work.md` (one new entry), `sprint-status.yaml` (A8 done), this spec.

**Review.** Four layers (blind, edge-case, verification-gap, intent-alignment). 6 low patches applied, 1 low deferred (the `'paused'` copies, also in the new `deferred-work.md` entry), 9 rejected (object key order — same keys and values, nothing serializes these mapped objects; positional parameters; `HoursLeaveRecord` type copy; an exported `LeaveSpan` type; multi-date half passthrough, refused by the parsers upstream; no export-list pin test; sprint status timing; a pre-existing `try` placement; the notify/SQL layers, which no TS helper can bind and where no web code copies a leave row). No `deferred-work.md` entry matched A8, so none is marked RESOLVED. Follow-up review: patched high 0, medium 0, low 6, score 6, so recommended.

**Verification (Node 22.22.1 here; the project pins 24).**
- `pnpm typecheck`: pass. `pnpm lint`: pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts test/key-hygiene.test.ts`: 1894 passed, 2 skipped.
- `pnpm -r test`: domain 672/672; web 6349 passed, 4 failed, all in `src/lib/i18n/format.test.ts`'s foreign-timezone block, which spawns `node --experimental-strip-types` and fails with `ERR_NO_TYPESCRIPT` on this Node build. The same 4 fail at the baseline commit (checked with the change stashed), so they are environmental.
- DB-connecting root tests and e2e not run (STRICT DATABASE RULE, no local stack); CI is the gate. Nothing touches SQL.

**Residual risks.** Mapped leave objects now list their keys in a different order (same keys and values). The rule that new columns go through the shared helpers is enforced by doc comments and review, not by a test.
