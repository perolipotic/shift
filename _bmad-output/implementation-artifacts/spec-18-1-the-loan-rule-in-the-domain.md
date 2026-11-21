---
title: '18.1 The loan rule in the domain'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_commit: '5a8bb9560b79d727587075a678771b621f044766'
review_loop_iteration: 1
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A member's team on a date comes from the membership versions alone. A temporary loan to another team (PRD §5.23, FR-88 to FR-92, engine rules R11) can only be written today as repeated roster overrides. Every figure that reads a roster has to follow a loan, and none may get its own copy of the rule.

**Approach:** Add the R11 loan rule once, in `packages/domain/src/roster.ts`. A `Loan` (id, loan team, inclusive from and to) rides on each member as an optional `loans` list. `effectiveTeamOn` gives the loan team on a covered date and the home team otherwise. `shiftRoster` and `memberScheduleOfMonth` both derive from that effective team, so rosters, the member's month, hours, leave cost, collisions, staffing and the web's swap validity (which reads `rosterOn`) all follow a loan. A member with no loans derives exactly as before. A digest pinned on the unchanged engine proves it over both fixtures.

## Boundaries & Constraints

**Always:**
- R11.1: the effective team on `d` is the loan team if a loan covers `d`, else the home team (`membershipOn`). A member on no team can be lent (FR-88).
- R11.2: the base roster of T on `d` is the active members whose effective team on `d` is T. Roster overrides apply on top through the existing rule. An inactive member is on no roster, lent or not.
- R11.4: no loans (absent, `[]`, or none covering the date) gives output identical to the engine at `baseline_commit`. Output shapes do not change: `MemberShift`, `RosterEntry`, `ScheduleCell` and `Collision` keep their fields.
- R11.5: the engine never writes to an input. A loan changes no membership version and no rotation assignment.
- The domain stays pure (AD-7) and returns ids and codes only (AD-8).

**Block If:** the no-loan digest changes under the implementation (it would mean R11.4 is broken).

**Never:** no migration, table, snapshot read or UI (those are 18.2 to 18.5). No change to any web call site. No new field on an output type. No refusal of a loan to the home team in the domain.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No loan | both fixtures, members with no `loans`, with `loans: []`, or with loans wholly outside the window | rosters, both schedules, hours, all explanations, leave cost, collisions and short-staffed shifts digest to the baseline | none |
| R11.6 | pilot member of A lent to C on the 10th to the 12th | A's rosters lose them and C's gain them (position `null`). Their month shows C's types. Hours, explanations, leave cost and collisions equal those of a C membership for those days. A has one fewer at work and C one more. The 9th and the 13th are A's | none |
| Override on top | on a covered date, an override on C takes the lent member off; an override on A takes them off | the C override applies; the A override is inert (they are not on A's base roster) | none |
| Teamless | a member with no membership is lent | on C's roster for the range, on none after | none |
| Inactive | lent member deactivated mid-loan | on no roster from the deactivation date | none |
| Loan to home | loan team equals the home team | derives as the home team | not refused here; refused by the store (18.2) |
| Bad loans | `from`/`to` not a date, `to < from`, duplicate id, two loans sharing a date | `checkLoans`, `shiftRoster` and `memberScheduleOfMonth` throw | `RangeError` naming the loan |

## Epic AC Deviations

- AC 2, "the existing suites and e2e month snapshots stay green": the domain and web suites and the DB-free root tests run locally. The e2e month snapshots and the DB-connecting root tests run in CI only (STRICT DATABASE RULE). Not a change of substance; the result is recorded under Verification when CI reports.
- AC 2, "swap validity ... byte-identical": swap validity is a web derivation (`apps/web/src/features/swaps/services/swap-proposal.ts`), not a domain one. It decides validity from `rosterOn`, which is covered by the digest. No swap-specific digest exists, and the domain cannot hold one. Reinterpreted, not deferred.

</intent-contract>

## Code Map

- `packages/domain/src/roster.ts` -- `Loan`, `EffectiveTeamOn`, optional `RosterMember.loans`, `checkLoans`, `loanOn`, `effectiveTeamOn`. `shiftRoster` now reads `effectiveTeamOn`; `rosterOn` and `rosterOverrideApplies` inherit it unchanged.
- `packages/domain/src/schedule.ts` -- `MemberScheduleInput.loans` (optional). `memberScheduleOfMonth` takes the team from `effectiveTeamOn` (one rule, no inline copy). Its loans come from `input.loans`, or, when that is absent, from the member's entry in `input.members` (`loansOf`). Two different lists throw. `scheduleOfMonth` inherits through `shiftRoster`.
- `packages/domain/src/collisions.ts` -- `collisionsOf` copies `member.loans` into the per-member schedule input (the one domain mapper from `RosterMember` to `MemberScheduleInput`).
- `packages/domain/src/hours.ts`, `leave.ts`, `staffing.ts` -- left unchanged. They take `MemberScheduleInput` or `rosterOn`, so they follow.
- `packages/domain/src/index.ts` -- exports the new names.
- `packages/domain/test/loans.test.ts` -- the R11.4 digest guard, R11.6 and the edge cases.
- Deliberately left (web; there are no loans to carry until 18.2 feeds the snapshot), and recorded in `deferred-work.md` for 18.2 and 18.5:
  - Mappers that rebuild a member's schedule input from `{memberId, memberships, statuses}` and would drop `loans`: `apps/web/src/features/calendar/utils/month.ts` (`CalendarMemberHistory`, `memberScheduleInputOf`), `calendar/utils/change-preview.ts:128`, `calendar/utils/day-detail.ts:984`, `calendar/utils/replacement-candidates.ts:178`, `members/services/deactivation-consequence.ts:88`, `members/services/team-move-preview.ts:100`, `swaps/services/swap-proposal.ts:356`. The snapshot reader is `calendar/services/snapshot.ts`.
  - Readers of the HOME team through `membershipOn` that 18.5's marks reword (today, Danas, directory, leave overview, admin today, day-detail's own team, positions in swap and replacement candidates, `month.ts`'s last team).

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/test/loans.test.ts` -- write the no-loan digest test first, run it on the baseline engine and pin both digests -- this is the "identical to before" proof, not new code compared with itself.
- [x] `packages/domain/src/roster.ts` -- add the loan types, `checkLoans`, `loanOn` and `effectiveTeamOn`; `shiftRoster` reads the effective team -- R11.1 and R11.2.
- [x] `packages/domain/src/schedule.ts` -- add `loans` to `MemberScheduleInput` and the effective team to `memberScheduleOfMonth` -- the member's month, and therefore hours and leave cost.
- [x] `packages/domain/src/collisions.ts` -- pass `member.loans` -- collisions follow.
- [x] `packages/domain/src/index.ts` -- export.
- [x] `packages/domain/test/loans.test.ts` -- add R11.6, the matrix rows and the `loans: []` and out-of-window digests.
- [x] `_bmad-output/specs/spec-shift/engine-rules.md` -- add §11 Loans (R11.1 to R11.6, as the proposal words them, plus this story's domain decisions) -- the rule implemented here had not yet been written into the SPEC.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add entries addressed to 18.2 (carry `loans` through the snapshot and every mapper above) and 18.5 (the `posudba` hours source and the home-team readers).
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 18.1 to `review`, "built, CI pending".

**Acceptance Criteria:**
- Given both fixtures and no loan, when every roster-derived figure is computed, then its digest equals the one pinned on `baseline_commit`.
- Given the R11.6 loan, when the pilot month is derived, then rosters, the member's month, hours, explanations, leave cost, collisions and staffing all follow C for the 10th to the 12th and A from the 13th, and no membership or assignment changes.
- Given the full domain and web suites, when they run, then they pass unchanged.

## Spec Change Log

- 2026-11-20, follow-up review: the AC 2 deviation in Epic AC Deviations now also names the DB-connecting root tests as CI-only. They were already listed under Verification as not run locally. The epic AC auditor found the deviation list left them out. No change of substance.

## Review Triage Log

### 2026-11-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 3, low 4)
- defer: 0
- reject: 11 (high 0, medium 0, low 11)
- addressed_findings:
  - `[medium]` `[patch]` `memberScheduleOfMonth` held an inline copy of the coverage rule (blind, intent, verification-gap). It now calls `effectiveTeamOn`.
  - `[medium]` `[patch]` `input.loans` and the member's `members` entry could disagree silently (all four code reviewers). `loansOf` now falls back to the entry when `input.loans` is absent and throws when both are given and differ. This also removes the risk of a web mapper that drops `loans` once 18.2 fills `members`.
  - `[medium]` `[patch]` The teamless and inactive matrix rows were only checked through `shiftRoster` (verification-gap). They are now also checked through `memberScheduleOfMonth`, day by day.
  - `[low]` `[patch]` A loan naming the home team set the position to `null` (edge-case). It now derives exactly as the home team, position kept (`effectiveTeamOn`, R11.3 text, test).
  - `[low]` `[patch]` Missing cases (blind). Added tests for a home-team move inside a loan, a loan that crosses a month, a loan to a team with no rotation, a home-team override that puts the lent member back on (a double shift that applies, documented in R11.3), and the team grid unchanged by a loan.
  - `[low]` `[patch]` `memberScheduleOfMonth` JSDoc `@throws` now covers "lent to" and the loan-list mismatch, and the rule paragraph says "effective team".
  - `[low]` `[patch]` `engine-rules.md` R11.3 now names the archived-team refusal (FR-88).
  - Rejected:
    - Empty `id` or `teamId` in a loan. The store refuses them (18.2), and no other domain id is checked for emptiness.
    - `checkLoans` re-run per member per call. It matches `membershipOn`'s per-call sort, and the cost is nil with no loans.
    - `teamIds` leaving out a loan team. This is the existing caller contract.
    - Freezing shared fixtures. Vitest isolates each file.
    - Brittle fixture ids and headcounts.
    - Import order. Lint is clean.
    - Line numbers in deferred-work entries.
    - Empty logs before review. That is by design.
    - The reproducibility of the digest. The command is now recorded in Design Note 7.
    - Swap validity untested in the web. It is the listed deviation; Design Note 8 clarifies it.
    - R11.5 not naming the Rotation Pattern. The proposal's wording is kept.

### 2026-11-20 — Follow-up review (fresh eyes, unattended)
- Layers: blind, edge-case, verification-gap, acceptance, epic AC (5 of 5; the artifact renderer was skipped because the diff generates no file).
- Digest provenance re-checked independently. `loans.test.ts` was copied into a detached worktree at `origin/main` (= `baseline_commit` 5a8bb95) and the two R11.4 tests were run on that engine. Both pinned digests matched. Coverage: every domain figure reached through a roster (`shiftRoster`, `rosterOn`, `scheduleOfMonth`, `memberScheduleOfMonth`) is in the digest or derives from a digested one. `leaveDaysOfMonth`, `halfDayShiftOf` and `checkHalfDay` read `memberScheduleOfMonth`. `peopleAtWorkOn` reads `scheduleOfMonth` and `rosterOn`.
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 1, low 5)
- defer: 0 (the out-of-scope items are folded into the existing 18.2 entry in `deferred-work.md`)
- reject: 14
- addressed_findings:
  - `[medium]` `[patch]` `loansOf` still let the month and the rosters read two different loan lists (edge-case, verification-gap, acceptance and blind, each on its own). If `input.loans` was non-empty and the member's `members` entry had no `loans`, nothing threw: the month put the member on the loan team while `shiftRoster` over `members` kept them home. An entry without `loans` now counts as holding none and is compared. A member with no entry is on no base roster, so `input.loans` is still read alone. Tests: both directions, no entry, and bad loans read from the entry.
  - `[low]` `[patch]` `loansKeyOf` sorted tuple arrays by their comma-joined strings, so ids holding a comma could make two loans compare as equal (edge-case, blind). Each loan is now JSON-encoded before sorting. Two such loans can only collide when they share every date, which is an overlap, so the old code gave the wrong error rather than a wrong figure. Test pins that the error is now "never overlap".
  - `[low]` `[patch]` The R11.4 test's comment says roster overrides are applied, but nothing asserted it (blind). It now asserts that some roster has an applied override.
  - `[low]` `[patch]` Staffing during a loan was tested only without leave (blind). New test: the lent member's leave on a covered date lowers C's count at work, and A's is unchanged.
  - `[low]` `[patch]` `loanOn` with a malformed date had no test (blind). Added.
  - `[low]` `[patch]` The 18.2 deferral did not warn about `members` lists filtered by home team, or about the new entry-has-no-loans throw. It also did not ask 18.2 to define a "live" loan, or name the snapshot's two `RosterMember` builders (blind). The entry is extended. The AC 2 deviation now also names the DB-connecting root tests (epic AC).
  - Rejected:
    - The spec says `done` while the sprint says `review` (blind, acceptance). The spec's `status` is bmad-build's lifecycle field. Delivery state is sprint-status, which correctly stays `review` (built, CI pending) under DONE MEANS MERGED WITH GREEN CI.
    - `deferred: []` and `defer: 0` beside two new ledger entries. Those entries were written in planning, as the build rules require, not deferred by review.
    - Excel export not in the digest (acceptance, blind). Story 18.1's AC 2 does not name export. The export is a web reader of `rosterOn` and `memberScheduleOfMonth`, which are digested. It has the same standing as swap validity.
    - The swap reinterpretation was not escalated (blind). The founder approved unattended decisions recorded in the spec, and Epic AC Deviations is the sanctioned place.
    - Repeated `checkLoans` and `membershipOn` checks per date (blind). They sort lists of a handful of loans or versions per member, the same per-call pattern as `membershipOn` before loans. No measured cost.
    - An opaque digest on failure (blind). It is the chosen guard. The R11.6 and matrix tests localise behaviour, and a moved digest is investigated by diffing `derivedFiguresOf` against `baseline_commit`.
    - The digest's provenance can't be checked (blind). It was re-run on the baseline engine in this review (above).
    - No collision test for the double shift R11.3 allows (blind). That collision rule is the existing one for any member put on a second team. It is not loan-specific and is covered by the collision suites.
    - The hours source reads "rotation" until 18.5 (blind). This is 18.5's AC and is already recorded. Sequencing 18.3 against 18.5 is sprint planning.
    - R11.5 leaves out the Rotation Pattern, and cross-organization loans are not covered (blind, acceptance). The proposal's wording is kept. Organization scoping is the store's (18.2).
    - The follow-up review is not tracked (blind). This is it.
    - Duplicate member ids in `members` (edge-case). This contract predates loans: no roster function checks for it.
    - The "differ" throw is missing from the I/O matrix (acceptance). It is a precondition breach documented in Design Note 1, the JSDoc and the tests. The matrix is frozen.
    - A `members` entry missing altogether is not refused (acceptance). This predates loans: such a member was never on a base roster, and memberships are read from the input alone too.

## Design Notes

Decisions made unattended (founder: decide and record):

1. **Loans ride on the member** (`RosterMember.loans`, `MemberScheduleInput.loans`, both optional), like `memberships` and `statuses`. Making them optional is what keeps every current caller and output identical (R11.4). 18.2 fills them from `team_loans`. A member's month reads the same list the rosters read: it falls back to the member's `members` entry, and two different lists throw.
2. **Position on a loan team is `null`.** A position is held in the home team. It is carried and never read by a rule, so no figure moves.
3. **A loan shift carries no new output field.** It reads as the loan team's own shift (`viaOverride: false`), so the hours explanation names its source "rotation" for now. 18.5 owns the `posudba` source (epic AC). It is recorded in `deferred-work.md` and was not added here, because a new field would change every output's shape.
4. **Overlap, bad dates and duplicate ids throw `RangeError`**, as overlapping leave records do (R4.4). The store refuses them (18.2), so here they are a breached precondition. **A loan to the home team is not a domain error.** The home team is versioned, so a later team move can make a stored loan point at it. On such dates it derives exactly as the home team, position kept.
5. **A home-team override that takes a lent member off is inert** on a covered date, by the existing applies rule. One that puts them back on applies, giving a double shift, as for any member. 18.3's preview surfaces both: the overrides for review (AD-5) and the double booking (FR-90).
6. **No spine amendment.** 18.1 amends no AD: the AD-2 Loan row is 18.2's and the AD-5 row is 18.3's. AD-7 is unchanged.
7. **The guard is a digest pinned on the old engine.** It covers both fixtures over two months, with:
   - memberships that move, a deactivation and a teamless member;
   - replacement and removal overrides, and shift-type overrides;
   - full and half-day leave, and minimum 3.

   How the digests were computed: the test file was written first. `packages/domain/src` was then reset to `baseline_commit` (`git checkout -- src`) and the digests came from `pnpm exec vitest run test/loans.test.ts -t 'is what it was before Loans'` (Vitest does not typecheck, so `loans: member.loans` in a test literal is inert there). The implementation was then restored. Re-pin the digests only for a change that is meant to move a no-loan figure, and say so in that change's spec.
8. **Swap validity follows today wherever it reads `rosterOn`.** Whether the colleague is on the shift is one of those reads. `swap-proposal.ts:356` rebuilds a schedule input without `loans`. Since this review, that path reads the member's `members` entry, so once 18.2 fills `members[].loans` it follows too. The 18.2 deferral stays open: the snapshot must still be fed and the mappers checked.

## Verification

**Follow-up review (2026-11-20, after its patches):** `pnpm --filter @shift/domain build && pnpm typecheck` clean. `pnpm lint` clean. Domain: 17 files, 886 tests passed (31 in `loans.test.ts`). Web: 172 files, 6507 passed. Root DB-free: 2 files, 1978 passed. Both baseline digests were re-run on the engine at `origin/main` (= `baseline_commit`) and matched. The DB-connecting root tests and e2e were not run locally (STRICT DATABASE RULE); CI is the gate.

**Commands (run 2026-11-20, after the review patches):**
- `pnpm --filter @shift/domain build && pnpm typecheck` -- clean.
- `pnpm lint` -- clean.
- `pnpm --filter @shift/domain test` -- 17 files, 884 tests passed (29 in `loans.test.ts`, the two baseline digests included).
- `pnpm --filter ./apps/web test` -- 172 files, 6507 tests passed.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- 2 files, 1978 tests passed.
- Not run locally: the DB-connecting root tests and e2e, including the month snapshots (STRICT DATABASE RULE; the stack is in use). CI is the gate.
- CI (recorded 2026-11-21, epic 18 retro A7): #323 merged with `CI passed` green, the DB-connecting Vitest job and all four Playwright shards included. Two earlier runs were cancelled by new pushes; none failed.

## Auto Run Result

Status: done (merged as #323, squash `61976e7`, with `CI passed` green; sprint status `done`). Residual risks rewritten to the CI facts by epic 18 retro A7 (2026-11-21).

**Summary:** R11 lives once in `@shift/domain`. `effectiveTeamOn` gives the loan team on a covered date and the home team otherwise. `shiftRoster` and `memberScheduleOfMonth` derive from it, so rosters, member months, hours, explanations, leave cost, collisions and staffing follow a loan. With no loan, every figure equals the baseline engine's over both fixtures (pinned digests).

**Files changed:**
- `packages/domain/src/roster.ts` -- the Loan types, `checkLoans`, `loanOn`, `effectiveTeamOn`; `shiftRoster` reads the effective team.
- `packages/domain/src/schedule.ts` -- `MemberScheduleInput.loans`, `loansOf`; the member's month uses `effectiveTeamOn`.
- `packages/domain/src/collisions.ts` -- carries `member.loans`.
- `packages/domain/src/index.ts` -- exports.
- `packages/domain/test/loans.test.ts` -- the R11.4 digests, R11.6 and the edge cases.
- `_bmad-output/specs/spec-shift/engine-rules.md` -- §11 Loans.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- two entries, for 18.2 and 18.5.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- 18.1 `review` (built, CI pending); epic 18 `in-progress`.
- `_bmad-output/implementation-artifacts/epic-18-context.md` -- the compiled epic context.

**Review:** 5 layers (blind, edge-case, verification-gap, intent, epic AC). 7 patches applied, 0 deferred, 11 rejected. The epic AC auditor found no unlisted deviation.

**Follow-up review:** recommended. Patched: high 0, medium 3, low 4. Score 3×3 + 4 = 13, which is 5 or more, so `followup_review_recommended: true`.

**Process note:** the implementation was written by the orchestrating session, not a fresh step-03 subagent. The no-loan digests had to be captured on the unchanged engine before any source edit, so test-first and implementation ran in one context. Review ran with the five context-free subagents.

**Residual risks:**
- Settled by CI: the e2e month snapshots and the DB-connecting suites passed on #323's green run. Two earlier runs were cancelled by new pushes; none failed, and no CI-only fix was pushed.
- Every web caller of `shiftRoster`/`rosterOn` now runs the loan path. With no loans it returns the old result, as the digests prove.
- `memberScheduleOfMonth` now throws if a caller passes `loans` that differ from the member's `members` entry. No web caller passes `loans` today.
