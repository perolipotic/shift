---
title: 'Epic 18 retro A4, A5, A7: loan race tests, loan-mark e2e, residual-risk rule'
type: 'chore'
created: '2026-11-21'
status: 'done'
baseline_commit: '7041ce5ddbab6619b50054ecf4516266ce9d38b9'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-retro-2026-11-21.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The epic 18 retrospective left three dev-owned items. A4: `0064`'s lock and re-check on `team_loans` inserts, and its definers' lock, have no two-transaction race test (`deferred-work.md` 18.4 entries). A5: no e2e asserts the drawn loan marks of 18.5. A7: specs 18.1–18.4 still say their DB tests and e2e "have never run" after CI ran them green, and the process has no rule that would have kept them current, or that catches a DB-test scene built after `actAs` (18.4's CI-only failure, `e0e5359`).

**Approach:** Add `team_loans` race cases to `test/concurrent-writes.test.ts` on its `race`/`waitUntilBlocked` pattern, in both orders. Add one e2e to `member-loan.spec.ts` that lends a member through the dialog and asserts every drawn mark. Rewrite the stale lines in specs 18.1–18.4 to the retro's CI facts, and add the two rules (build facts and a review layer). Mark items 75, 76 and 78 done in sprint status.

## Boundaries & Constraints

**Always:**
- A4 races, each with T2 proven waiting on the organization's advisory key:
  - a loan insert, and `amend_team_loan` (moving a loan onto the team), behind an archive of that team, and behind a team move that makes it the member's own on a covered date: refused 42501 (the insert: the re-check's `new row violates row-level security policy for table "team_loans"`; the amend: `TEAM_LOAN_TEAM_REFUSED`); a rolled-back T1 admits the same write (the control);
  - a loan insert behind a demotion of its caller: 42501; `amend_team_loan` and `remove_team_loan` behind a demotion: their own refusals, in the "remaining definers" list;
  - the other order: an archive behind a loan insert, and behind an amend moving a loan onto the team: 23514 `TEAM_HAS_LOANS`, with a rollback control; a team move behind a loan insert waits and is admitted (18.4 design note 15).
- Fixtures and scenes are built as the owner before any `actAs` (A7's lesson).
- A5 is one test, under the run's rotation hold: team T with the seeded rotation from today, team H with none, a fresh member P on H from today, lent through the dialog to T from today to today + 3. It asserts T's day detail today lists P with `posudba iz tima H`; the Osoba picker, searched for P, places P under T with the mark; the admin's *Ljudi* row of P says `trenutno u timu T`; *Povijest promjena* filtered to P has one `Posudba · dodano` row; and P, signed in to a fresh context, sees `U timu T do {to}.` on *Danas* and on *Moj raspored*, and `trenutno u timu T` under H in the members' directory. Everything written is removed in `afterEach`.
- Specs 18.1–18.4: the `Status:` line and each residual-risk line about unrun tests are rewritten to the retro's CI facts (PR, squash, failed runs and why, CI-only fixes); 18.4 names both failed runs and `e0e5359`. Other residual risks stay or are marked settled with their evidence.
- `deferred-work.md`: the two race-test entries and the loan-mark e2e entry are marked `RESOLVED by epic 18 retro A4/A5 (2026-11-21)`, CI pending.

**Ask First:** none (founder: do not ask).

**Never:** no migration, no app code change, no change to `test/database.ts` or `e2e/utils/*` beyond what the new cases need. Never run DB-connecting tests, e2e or `supabase`, and never touch docker. Run only typecheck, lint, the web tests, the two DB-free root files and `playwright test --list`.

</frozen-after-approval>

## Code Map

- `test/concurrent-writes.test.ts` -- helpers `:57-376` (`addTeam` gains an optional name: team names are unique per organization); "a team archive and an assignment" `:693` is the model for both orders; demotion loop `:931`; definer list `:1173`; the new loan block `:1640`.
- `supabase/migrations/0064_team_loan_amend_remove.sql` -- read-only evidence: amend `:187` (lock, admin check, `TEAM_LOAN_TEAM_REFUSED`), insert lock `:360`, re-check `:368-458`, `TEAM_HAS_LOANS` `:462-500`. `0062_team_loans.sql:193` the insert policy.
- `e2e/tests/people/member-loan.spec.ts` -- `setUp`, `afterEach` and the lend steps to reuse.
- `e2e/pages/calendar.page.ts` (`cellOf`, `detailOf`, `rosterLinesIn`, `filters`), `filter-bar.ts` (`choosePerson` pieces, `personSearch`, `personGroup`), `people.page.ts` (`memberRow`, `searchInput`, `directoryGroup`), `history.page.ts` (`kindText`, `table`), `today.page.ts`, `login.page.ts` (`signIn`).
- `e2e/utils/database-helper.ts` -- `seedExtraTeam`, `seedTeamRotation`, `seedLeaveMember` (credentials), `removeLeaveMemberInSql` (removes the member's loans).
- `apps/web/src/components/loan-mark.tsx`, `filter-bar.tsx:700`, `day-detail-dialog.tsx:99`, `loan-notice-line.tsx`, `pages/kalendar.tsx:196` -- where each mark is drawn (read-only).
- Specs `spec-18-1…md:181,202-205`, `spec-18-2…md:130-135`, `spec-18-3…md:174-179`, `spec-18-4…md:142-147,200-202`.
- `_bmad/custom/bmad-build.toml`, `_bmad/custom/bmad-code-review.toml` -- the rules.

## Tasks & Acceptance

**Execution:**
- [x] `test/concurrent-writes.test.ts` -- the A4 cases above -- CI-only proof of 0064 §3-§5.
- [x] `e2e/tests/people/member-loan.spec.ts` -- the A5 test -- the marks in a browser.
- [x] `_bmad-output/implementation-artifacts/spec-18-{1,2,3,4}-*.md` -- rewrite the stale lines -- R4.
- [x] `_bmad/custom/bmad-build.toml` -- facts: residual-risk lines rewritten when a story is set done; DB-test scenes built as the owner before `actAs`; plus a review layer for unrun DB tests -- A7.
- [x] `_bmad/custom/bmad-code-review.toml` -- the same review layer -- A7.
- [x] `deferred-work.md`, `sprint-status.yaml` -- resolved entries; items 75, 76, 78 done (CI pending noted).

**Acceptance Criteria:**
- Given the new cases, when `vitest run test/concurrent-writes.test.ts` and the e2e suite run in CI, then they pass (not run locally: STRICT DATABASE RULE).
- Given `playwright test --list`, then the new e2e test is listed.
- Given specs 18.1–18.4, when grepped for "never run" or "CI pending", then no line describes the merged state wrongly.

## Spec Change Log

## Design Notes

1. **Scope of the A5 e2e.** It asserts the marks retro A5 names, plus the picker and the history record the founder asked for. "The Team filter" of 18.5 AC 1 is the Osoba picker, as 18.5's own recorded deviation reads it. The words are asserted, not the glyph: the glyph is `aria-hidden`, and the words carry the meaning (NFR-25). A loan ahead (`Od … u timu …`), a teamless lent member (`posudba, bez svog tima`), the hours source `posudba` and the export are not driven in a browser. They stay covered at the service level (`loan-marks.test.ts`, `loans.test.ts`).
2. **Midnight.** The suite's auto `midnightGuard` fixture holds every test away from 00:00 Europe/Zagreb, this one included. Nothing more is needed here.
3. **Definer placeholders.** `amend_team_loan` and `remove_team_loan` join the "remaining definers" list with that list's placeholder id. Each takes the lock and then makes its admin check before it reads any argument (0064:207-221, 148-162), so the demotion is the only way to reach its refusal.
4. **Status.** The founder asked for items 75, 76 and 78 to be marked done when the work was completed. They are `done`, and each note says the new DB and e2e cases are CI-only and CI pending. The deferred entries say `RESOLVED … written unrun; CI is the gate` in the same way. If CI fails on the PR, they reopen.
5. **Process note.** The orchestrating session implemented the change itself, not a fresh step-03 subagent, because it already held the investigation (precedent: 18.4 and 18.5, retro P5). Review ran in five context-free layers. One of them was this change's own new `unrun-db-test-auditor`, which the rendered workflow did not list yet.

## Review Triage Log

### 2026-11-21 — Review pass
- Layers: blind, edge-case, verification-gap, epic AC, and the new unrun DB test auditor (5). Artifact renderer: not applicable, no generated file.
- intent_gap 0, bad_spec 0, patch 6, defer 0, the rest rejected.
- Patched:
  - the Osoba-picker regex used JS `\b`, which is ASCII-only; it is now `(?=,|\s|$)`;
  - the `lendingScene` comment and the archive message now say "current or future", the migration's terms;
  - 18.2's CI line now says `44831942009` failed overall and only its Vitest job passed;
  - 18.2 and 18.4 now say the A4 races are "written unrun";
  - the e2e comments claimed a position the test does not assert, so the claim is dropped;
  - the *Što se mijenja* wait step was dropped from the new test, because the marks do not depend on it;
  - the Code Map anchors were refreshed.
- Verified sound by the auditor and the verification-gap layer:
  - every expected code and message matches 0064 word for word;
  - every scene is built as the owner before `actAs`;
  - the rollback controls separate each rule from any side effect;
  - every e2e locator matches its page object and `hr.json`.
- Rejected:
  - status `done` before CI (the founder's explicit instruction; design note 4);
  - the gitleaks run on 18.2. It is out of scope, and the retro has already flagged it to epic 20's retro (P3);
  - more orders (an archive behind a removal, an amend off the team). The retro and the deferrals did not ask for them;
  - one shared review-layer file. The two workflows read separate tomls by design;
  - midnight (design note 2);
  - the placeholder definer ids (design note 3).

## Verification

**Results (2026-11-21, after the review patches):** typecheck and lint clean; web 176 files, 6640 passed; DB-free root 2 files, 2055 passed; `playwright test --list` shows 570 tests in 58 files, the new `member-loan.spec.ts:206` among them.

**Commands:**
- `pnpm typecheck` and `pnpm lint` -- clean.
- `pnpm --filter ./apps/web test` -- passes.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts` -- passes.
- `pnpm exec playwright test --list` (in `e2e/`) -- lists the new test.
- Not run locally: `test/concurrent-writes.test.ts` and e2e (STRICT DATABASE RULE; a manual-test stack is running). CI is the gate.

## Suggested Review Order

**A4: the loan races**

- The scene, all built as the owner before any role switch.
  [`concurrent-writes.test.ts:1649`](../../test/concurrent-writes.test.ts#L1649)
- A loan insert or amend behind an archive or a team move: 42501, with controls.
  [`concurrent-writes.test.ts:1674`](../../test/concurrent-writes.test.ts#L1674)
- The other order: an archive behind a loan or amend is 23514 `TEAM_HAS_LOANS`.
  [`concurrent-writes.test.ts:1738`](../../test/concurrent-writes.test.ts#L1738)
- A team move behind a loan waits and lands (18.4 note 15).
  [`concurrent-writes.test.ts:1784`](../../test/concurrent-writes.test.ts#L1784)
- Demotion: a loan insert joins the 0035 loop; both definers join the definer list.
  [`concurrent-writes.test.ts:932`](../../test/concurrent-writes.test.ts#L932)
  [`concurrent-writes.test.ts:1220`](../../test/concurrent-writes.test.ts#L1220)

**A5: the drawn marks**

- Day detail, then the Osoba picker's placement and mark.
  [`member-loan.spec.ts:252`](../../e2e/tests/people/member-loan.spec.ts#L252)
- As the member: Danas, Moj raspored, the directory.
  [`member-loan.spec.ts:289`](../../e2e/tests/people/member-loan.spec.ts#L289)

**A7: the rules and the specs**

- The two new build facts.
  [`bmad-build.toml:33`](../../_bmad/custom/bmad-build.toml#L33)
- The unrun-DB-test review layer (also in `bmad-code-review.toml`).
  [`bmad-build.toml:61`](../../_bmad/custom/bmad-build.toml#L61)
- 18.4's residual risk now names both failed runs and `e0e5359`.
  [`spec-18-4-an-admin-amends-ends-early-or-removes-a-loan.md:146`](./spec-18-4-an-admin-amends-ends-early-or-removes-a-loan.md#L146)

**Peripherals**

- The loan helpers.
  [`concurrent-writes.test.ts:370`](../../test/concurrent-writes.test.ts#L370)
