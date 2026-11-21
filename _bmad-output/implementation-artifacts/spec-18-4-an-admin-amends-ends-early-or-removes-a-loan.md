---
title: '18.4 An admin amends, ends early or removes a loan'
type: 'feature'
created: '2026-11-21'
status: 'done'
baseline_commit: '93740d3b01d0bc3aec60964355bc446668384cc2'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-18-3-an-admin-lends-a-member-to-another-team.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A loan, once saved (18.3), can be corrected only by SQL: no session may update `team_loans` (0062), so an admin cannot change its dates or team, end it early or remove it (FR-91), and the member is not told of a change (FR-62).

**Approach:** Migration `0064` adds two attributed definers, `amend_team_loan` (soft-remove + replacement insert, one transaction) and `remove_team_loan`, behind 0023's organization lock; notifies one `LOAN_CHANGED` or `LOAN_REMOVED`; puts `team_loans` inserts behind the lock and 0035's stale-admin re-check; and refuses archiving a team with a current or future live loan. The member page lists the member's live loans; each opens the 18.3 dialog in amend mode (team, *Od*, *Do*, optional *Razlog*, *Završi danas*, *Ukloni posudbu*), whose *Što se mijenja*, short-staffed block and erasure check derive from one "after" as the lend does.

## Boundaries & Constraints

**Always:**
- Required inputs (deferred-work, all answered here): (1) definers set `removed_by = auth.uid()`, `removed_at = now()` and insert the replacement attributed by 0062's defaults; (2) archiving a team refuses (23514 `TEAM_HAS_LOANS`) while a live loan to it ends on or after the organization's today; past loans do not block; (3) the amend sets `shift.notify_suppress = 'amend'` around its two writes and one `LOAN_CHANGED` is sent, `LOAN_REMOVED` on a removal; (4) a member inactive on covered dates is warned (a preview line with the count), never refused; (5) `team_loans` inserts take 0023's lock and 0035's re-check, which also re-reads the archived and home-team conjuncts; (6) an e2e spec drives the dialog.
- The definers run as the owner, past the insert policy, so they ask the archived and home-team rule themselves through one shared `private.team_loan_team_refused(...)` the re-check trigger also calls.
- "After": amend = the member's loans with the old one replaced by the draft; remove = without it. The preview, short-staffed block and erasure check read the window from the earlier first date to the later last date of the old and new ranges (removal: the old range). Overlap is checked against the member's other live loans.
- History pairing: `AMEND_KEYS.team_loans = ['member_id']`; the scaffold pin names `amend_team_loan`. Record and wording of loan events stay 18.5's.
- Copy in `hr.json` (`loans.*`, `obavijesti.loanChanged`/`loanRemoved`, `smjene.error.lentTo`), mirrored in `notify/messages.ts`.
- Never run DB-connecting tests, e2e, `supabase` or docker; their pins are updated unrun.

**Ask First:** none (founder: decide and record).

**Never:** no change to 0062 or 0063 (forward-only; 0064's header supersedes 0063's "an amend notifies nobody yet"); no update or delete grant on `team_loans`; no loan marks, history record or wording, `posudba` source (18.5); no in-dialog override removal.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Amend | live loan 10.–12. → 10.–14. | preview lists the 13.–14. changes; rpc returns the new id; one `LOAN_CHANGED` | none |
| Change team | C → D | lost C, gained D | none |
| End early | from ≤ today < to, *Završi danas* | *Do* = today; saved as an amend | none |
| Remove | *Ukloni posudbu* | preview: home shifts regained; row soft-removed; `LOAN_REMOVED`; dates derive as with no loan | none |
| Overlap | amended range meets another live loan | nothing sent / 23P01 | overlap |
| Home / archived | new team is home on a covered date, or archived | refused before deriving / 42501 | named refusal |
| Gone | loan removed or amended meanwhile | P0002 `TEAM_LOAN_NOT_LIVE` | stale |
| Inactive | member inactive on 2 covered dates | warning line `2` days | none |
| Archive | team with a loan ending today or later | 23514 `TEAM_HAS_LOANS` | `smjene.error.lentTo` |
| Member role | rpc as a member | 42501 | denied |
| Past | loan wholly before today amended/removed | stored, no notification | none |

## Epic AC Deviations

- AC 1, "ends it early": met as an amend of *Do* (FR-91 calls it a change of dates); *Završi danas* is a shortcut that sets *Do* to today. A loan wholly in the future is ended by removing it.
- AC 2, "recorded in the change history": met by 0062's audit triggers and the amend pairing (`AMEND_KEYS`); the event is shown as record `other` until 18.5 adds its record and wording.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0064_team_loan_amend_remove.sql` (new) -- the definers (shape of 0058 `amend_leave_record`, 0036 `remove_leave_record`), `private.team_loan_team_refused` (0062's two conjuncts as a function), `private.notify_team_loan()` replaced (0060 `notify_leave_record` shape) + `team_loans_notify_removal`, lock/re-check triggers on `team_loans` insert, `refuse_write_by_stale_admin` replaced (0036 body + `team_loans` branch), `private.refuse_archive_while_lent_to` + `teams_refuse_write_while_lent_to` (orders after `teams_refuse_write_by_stale_admin`).
- `packages/domain/src/history.ts:297` -- `AMEND_KEYS.team_loans`; test in `packages/domain/test/history.test.ts`.
- `apps/web/src/features/members/services/loan.ts` -- `LoanEdit` (member, `replaces: Loan | null`, `span | null`), `loanEditSnapshotOf`, `loanEditWindowOf`, preview `inactiveDays`, `memberLoansOf`, `amendLoan`/`removeLoan` (rpc, as `leave-write.ts` `amendLeave`), P0002 → stale; tests in `loan.test.ts`.
- `apps/web/src/features/members/hooks/use-member-loan.ts`, `components/member-loan-dialog.tsx`, `components/member-team-card.tsx` -- amend mode, loan list, saved/removed notices.
- `apps/web/src/features/teams/services/write.ts` `archiveFailureOf` -- `TEAM_LENT_TO`; test in `write.test.ts`.
- `apps/web/src/lib/i18n/locales/hr.json`, `test/resource-hygiene.test.ts`, `supabase/functions/notify/messages.ts`.
- `test/supabase-scaffold.test.ts` (run) -- AMEND_TABLES/pairing/removers/inserters, 0064 shape block. `test/provisioning.test.ts`, `test/rls-isolation.test.ts`, `test/notify-boundary.test.ts` (unrun) -- function/trigger pins and behaviour.
- `e2e/tests/people/member-loan.spec.ts` (new, unrun).
- `test/concurrent-writes.test.ts` (unrun) -- the lock/re-check trigger pin gains `team_loans`.
- `e2e/utils/database-helper.ts` -- read-only `teamLoansOfInSql`; `e2e/pages/people.page.ts` -- the loan locators. The cleanup already deletes loans and their outbox rows (18.2); no new table, so no cleanup change.
- `apps/web/src/pages/key-sources.fixture.ts`, `source-guards.fixture.ts` -- structural counts (member edit form 190→201 keys, 41→43 buttons; loan rules 18→22; team write rules 11→12).
- Docs: spine AD-2, AD-5, AD-11, AD-18 amended; `EXPERIENCE.md` member page; `epics.md` UX-DR23, UX-DR58.

## Tasks & Acceptance

**Execution:**
- [x] `0064` -- every Always rule on the database side.
- [x] domain `AMEND_KEYS` + test.
- [x] `loan.ts` + `loan.test.ts` -- every matrix row at the service level.
- [x] hook, dialog, card -- the surface.
- [x] teams archive mapping + test.
- [x] `hr.json`, `messages.ts`, resource-hygiene.
- [x] scaffold (run), provisioning/rls/notify-boundary (unrun).
- [x] e2e spec (unrun).
- [x] spine, EXPERIENCE.md, epics UX-DR58.
- [x] `deferred-work.md` -- mark the 18.4 entries RESOLVED (four wholly — the 18.2 entry holds three of the inputs — and 18.5's history entry in part); `sprint-status.yaml` -- 18.3 `done  # #328`, 18.4 `review  # built, CI pending`.

**Acceptance Criteria:**
- Given a member with no loan, when the member page renders, then it shows what it showed before.
- Given the allowed local commands, when run, then they pass.

## Design Notes

1. Removal is not a second dialog: the amend dialog's *Ukloni posudbu* switches the same preview to the removal's "after" (AC 1's "the same dialog").
2. An amend's empty *Razlog* keeps the stored reason (`p_reason` null): the admin never needs to re-read a reason only admins may see; a typed one replaces it.
3. Choices in amend mode are 18.3's plus the loan's own team when it is not archived.
4. Recipients follow 0060's leave amend: `LOAN_CHANGED` to the member when the old or the new range is current (ends on or after today); `LOAN_REMOVED` when the removed one was.
5. The amend changes dates and team (FR-91 "dates or Team"), not the member: a loan to another member is a removal and a new loan. The history pairs on `member_id` alone for that reason.
6. The definers rely on two guards for the replacement: their own call of `private.team_loan_team_refused` (named 42501 `TEAM_LOAN_TEAM_REFUSED`) and the re-check trigger, which a definer's insert also fires because the session's `role` setting stays `authenticated` inside a definer (0023's own reading). The duplicate read is deliberate: the definer's refusal is named, the trigger's is the policy's.
7. Archive refusal over "end the loans": ending loans silently on an archive would discard the admin's record and send notices from a team screen; a refusal names the cause and the admin amends or removes the loans first (as 0010 refuses an archive with members).
8. `conflict_resolutions` are not touched by an amend or a removal, as by a team move: a resolution is keyed by `team_id` (AD-4), so one keyed to the loan team matches no collision once the member is off it, and returns if the same loan is made again. A leave amend ends its resolutions because the leave itself is the collision's cause; a loan is not.
9. Wholly past loans are listed and amendable (a correction), and amending one notifies nobody (0063's rule).
10. A wholly past loan is amended or removed without a notice (0063's "a correction of history is not news"), so AC 2's "the member is notified" holds for a change whose old or new range is current. Recorded after the epic AC audit called this narrowing unlisted.
11. A wholly past loan to a team archived later can be removed but not re-dated: an archived team takes no loan dates, by the same rule as a lend. Recorded after review.
12. An amend that keeps the stored team and dates and names no new reason is refused before sending (`loans.error.unchanged`): it would replace the row by an identical one and notify the member of nothing (review).
13. The amend's own `TEAM_LOAN_TEAM_REFUSED` (team archived or made home after the fresh check) reads as `stale`, with the re-reads a refusal triggers (review).
14. Moving a loan's dates into the past is a correction, as a late-entered loan is (18.3 design note 1): *Što se mijenja* shows what changes; no separate warning.
15. A team move written after a loan, making the loan team the member's own on a covered date, is not refused: the domain derives such a date as the home team (R11.3, 18.2).
16. A reason-only amend (the same team and dates, a new reason) is saved and notifies nobody: the member is never shown the reason (FR-92), so it is not news. `notify_team_loan` remembers the old team and range beside the members and compares them on the replacement's insert (second review).
17. Copy that names a team for a loan says *tim*, never `smjen`, `smjene.error.lentTo` included, though its namespace says `Smjena` (founder's rule, second review).

## Review Triage Log

### 2026-11-21 — Review pass (unattended)
- Layers: blind, edge-case, verification-gap, epic AC (4 of 4; no generated file). The work was implemented in this session, not by a fresh subagent: the investigation was already loaded and the project's resource rules ask to avoid duplicate work.
- intent_gap 0, bad_spec 0, patch 14, defer 2, the rest rejected.
- Patched: a no-op amend wrote and notified (refused now); `TEAM_LOAN_TEAM_REFUSED` read as `denied` (now `stale`); *Izmijeni posudbu* did nothing when no team was left to offer, so a removal was unreachable (choices are `[]` once read); the inactive-days count included dates the old loan already covered; `organization_today` null let an archive pass (now refuses on any live loan); *Razlog* announced `required` in amend mode; focus after an amend fell to *Posudi drugom timu* (now the row, else the card); UX-DR58's circular sentence; a vacuous trigger-order assertion in the scaffold; the change-team unit test now checks the dates; rls-isolation gains an amend into the past (told), an amend of a wholly past loan (silent), another tenant's loan id (P0002, untouched) and a removed future loan that no longer blocks an archive; the e2e spec lends from today and ends the loan early with *Završi danas*, asserting the field; the spec's deferral count; design note 10 moved here.
- Deferred (`deferred-work.md`): two-transaction race tests for the new `team_loans` lock and re-check; naming the lent members in the archive refusal.
- Rejected: `LOAN_CHANGED` in the present tense for a range moved into the past, and not naming the old team (cosmetic; the operands carry the new loan); an index on `team_loans (organization_id, team_id)` (pilot scale, as 18.2 decided); `team_loan_team_refused` as invoker (its only callers run as the owner; a definer keeps the provisioning pins uniform); *Završi danas* decided at opening (an *Od* moved past today yields the order refusal, named); the unchecked rpc cast (`leave-write.ts`'s pattern, and `amendLoan`/`removeLoan` pin the parameter names); the e2e locator's strict mode with two loans to one team (the spec holds one at a time); the team move making a loan point home (design note 15); the acceptance criteria not restating the matrix (the matrix is the acceptance, frozen).
- Epic AC audit: one unlisted narrowing (past loans notify nobody), recorded as design note 10.

### 2026-11-21 — Second review pass (unattended, fresh-context layers)
- Layers: blind, edge-case, verification-gap, acceptance + epic AC (one subagent for both) — fresh-context subagents on `git diff origin/main...HEAD`; artifact renderer skipped (no generated file). The parent also read 0064 against 0023, 0035/0036, 0043, 0060, 0062 and 0063.
- Checked and found sound: both definers are `security definer` with `search_path = ''`, take 0023's key from the JWT claim first, re-read an active admin of the claimed organization after the lock, and scope the update to `organization_id = claimed` (another tenant's loan id is P0002 and untouched); `execute` is revoked from `public`, `anon` and `service_role` and granted to `authenticated` only; the private functions are revoked from all four. `refuse_write_by_stale_admin()` is 0036's body unchanged plus the `team_loans` branch (diffed; no migration between redefines it); `current_setting('role')` stays `authenticated` inside a definer, because a definer switches the user id, not the `role` GUC. `shift.notify_suppress` is transaction-local, reset after the insert, and a refused amend's savepoint rollback restores it, as in 0054/0058. A null `p_from`/`p_to` builds an unbounded range that 0062's `team_loans_during_bounded` refuses (23514). Duplicate recipients in `LOAN_CHANGED` are harmless (`= any`). The archive trigger orders after `teams_refuse_write_by_stale_admin` and reads committed loans behind the lock. The e2e locators match `hr.json`, and the cleanup already covers loans and their outbox rows.
- Patched: `smjene.error.lentTo` said *Smjenu* for a team (now *Tim … mu … ga*; resource-hygiene comment and EXPERIENCE.md follow); rls-isolation expected a trimmed reason (`'Kraće.'`) the database stores as sent (`'  Kraće.  '`, the project's precedent), so CI would have failed; a reason-only amend (or a retyped identical reason, which the browser cannot tell, as it never reads the reason) told the member nothing visible (now silent, design note 16; scaffold pin and an rls case); no case amended a wholly past loan into a current range (rls case added); focus after a landed amend or removal took the old row's button, which unmounts on the re-read (now the card heading); *Izmijeni posudbu* stayed enabled while the teams or today were unread and then did nothing (now disabled: `amendable`); the change-team unit test passed with no gained shifts (length asserted); `loans.inactive` read awkwardly (`Osoba nije aktivna {n} dana posudbe: …`); the dialog's `amending` test order; the e2e header comment ("ended later" → *Završi danas*); the Code Map's loan-rule count (22).
- Deferred (`deferred-work.md`): the reverse-order race (an archive waiting behind a loan); an amend whose joined window passes the preview cap; a data check, before promotion, for current loans to teams archived under 0062.
- Rejected: spec `status: done` (the project's convention for a built spec; sprint status carries `review` until CI); 18.3 marked `done  # #328` (#328 is merged); "RESOLVED" prefixed to the old deferred-work text (the ledger's convention, 256 entries); a server-side no-op refusal (the reason-only notice was the harm, now silent; an identical row is a harmless, audited correction); the short-staffed block missing the old team on a team change (`configurationReportOf` compares every team over the window); *Izmijeni posudbu* not gated offline (as *Posudi drugom timu*; the save path refuses offline); the inactive-days count narrowed for an amend (the matrix row is the new range's dates; the old range's already changed nothing, recorded in the first pass); the past-loan notice narrowing missing from the frozen Epic AC Deviations (frozen; design note 10 records it); more notice cases (self-made, push, no address) — 0043/0045's shared `notify_members`, already covered there; more e2e paths (unchanged, stale, archive, inactive) — covered at the service level, the spec asks for one dialog drive; `LOAN_REMOVED`'s subject without dates and `LOAN_CHANGED` not naming the old team (the body carries the dates; first pass's call); `organization_today` null returning before the amend's remember, unlike 0060's order (no organization lacks a today, and one call reads the same today for both rows, so the insert returns too).

## Verification

**Commands:**
- `pnpm --filter @shift/domain build && pnpm typecheck`, `pnpm lint` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter ./apps/web test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/key-hygiene.test.ts test/localization-guard.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts` -- pass.
- Not run locally: 0064, provisioning, rls-isolation, concurrent-writes, notify-boundary, e2e (STRICT DATABASE RULE); CI is the gate. They fail locally only because 0064 is unapplied.

**Results (2026-11-21, after the second review's patches):** typecheck and lint clean; domain 17 files, 894 passed; web 174 files, 6587 passed; DB-free root (6 files) 2436 passed, 2 skipped. The scaffold's new pins ran; the new rls-isolation cases (reason-only amend, past loan moved ahead) have not run, and CI is their gate.

**Results (2026-11-21, after the first review's patches):** typecheck and lint clean; domain 17 files, 894 passed; web 174 files, 6587 passed (58 in `loan.test.ts`); DB-free root (6 files) 2436 passed, 2 skipped. Every matrix row is covered at the service level in `loan.test.ts` or `teams/services/write.test.ts`, except the DB-only rows (notices, member-role refusal, the archive trigger, the definers' P0002/42501), which `rls-isolation.test.ts` covers unrun.

## Auto Run Result

Status: done (built; sprint status `review`, CI pending).

**Residual risks:**
- `0064`, its provisioning, concurrent-writes, rls-isolation and notify-boundary pins, and the e2e spec have never run; their codes, trigger texts and flows were reasoned, so CI may need small fixes.
- The definers rely on the session's `role` setting staying `authenticated` inside a SECURITY DEFINER function for the re-check trigger to fire on their insert (0023's reading); the definer's own team check stands either way.
- No race test exercises the new lock on `team_loans` inserts (deferred).

## Suggested Review Order

**The two definers**

- The amend: lock, caller, attributed removal, team rule, replacement, one notice.
  [`0064_team_loan_amend_remove.sql:186`](../../supabase/migrations/0064_team_loan_amend_remove.sql#L186)
- The removal, on 0036's `remove_leave_record` shape.
  [`0064_team_loan_amend_remove.sql:137`](../../supabase/migrations/0064_team_loan_amend_remove.sql#L137)
- 0062's two team conjuncts, stated once for the definers and the re-check.
  [`0064_team_loan_amend_remove.sql:95`](../../supabase/migrations/0064_team_loan_amend_remove.sql#L95)

**Notices, lock, archive**

- One `LOAN_CHANGED` per amend, `LOAN_REMOVED` per removal, on 0060's pattern.
  [`0064_team_loan_amend_remove.sql:270`](../../supabase/migrations/0064_team_loan_amend_remove.sql#L270)
- The insert re-check re-reads the loan team behind the lock.
  [`0064_team_loan_amend_remove.sql:426`](../../supabase/migrations/0064_team_loan_amend_remove.sql#L426)
- No archive while a loan to the team is current or ahead.
  [`0064_team_loan_amend_remove.sql:454`](../../supabase/migrations/0064_team_loan_amend_remove.sql#L454)

**The edit's one "after"**

- Replaced or removed loan; stale when gone.
  [`loan.ts:376`](../../apps/web/src/features/members/services/loan.ts#L376)
- Everything derives over the old-and-new window.
  [`loan.ts:397`](../../apps/web/src/features/members/services/loan.ts#L397)
- Amend preflight: kept reason, unchanged refused.
  [`loan.ts:273`](../../apps/web/src/features/members/services/loan.ts#L273)
- Inactive days warned, counting only newly covered dates.
  [`loan.ts:415`](../../apps/web/src/features/members/services/loan.ts#L415)
- The rpc writers and their refusal mapping.
  [`loan.ts:974`](../../apps/web/src/features/members/services/loan.ts#L974)
  [`loan.ts:844`](../../apps/web/src/features/members/services/loan.ts#L844)

**Surface**

- Opening the dialog on a live loan.
  [`use-member-loan.ts:250`](../../apps/web/src/features/members/hooks/use-member-loan.ts#L250)
- What *Spremi* writes: lend, amend or removal.
  [`use-member-loan.ts:427`](../../apps/web/src/features/members/hooks/use-member-loan.ts#L427)
- The card's loan list.
  [`member-team-card.tsx:201`](../../apps/web/src/features/members/components/member-team-card.tsx#L201)
- The removal switch in the dialog.
  [`member-loan-dialog.tsx:235`](../../apps/web/src/features/members/components/member-loan-dialog.tsx#L235)

**Peripherals**

- History pairing key.
  [`history.ts:303`](../../packages/domain/src/history.ts#L303)
- Amend pairing proof names the loan amend.
  [`supabase-scaffold.test.ts:5282`](../../test/supabase-scaffold.test.ts#L5282)
- DB behaviour, unrun.
  [`rls-isolation.test.ts:27331`](../../test/rls-isolation.test.ts#L27331)
- e2e, unrun.
  [`member-loan.spec.ts:1`](../../e2e/tests/people/member-loan.spec.ts#L1)

