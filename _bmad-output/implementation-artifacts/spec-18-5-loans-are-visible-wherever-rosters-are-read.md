---
title: '18.5 Loans are visible wherever rosters are read'
type: 'feature'
created: '2026-11-21'
status: 'done'
baseline_commit: '3cd84d102cb50224b9b1129a221d3b5b53fee6b6'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-18-4-an-admin-amends-ends-early-or-removes-a-loan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 18.1–18.4 every roster, hour and staffing figure follows a loan, but nothing says so: a lent member appears on another team's day with no mark, *Danas* and the directory name only the home team, the hours explanation calls a loan shift `rotacija`, loan events read as record `Zapis` in *Povijest promjena*, and a lent member with no team reads as unscheduled on *Danas* and in leave costing (FR-92, UX-DR59).

**Approach:** The domain marks a shift held through a loan (`MemberShift.loanId`, present only then) and gives it the hours source `LOAN`, names the record `loan` for `team_loans`, and picks the loan to announce (`loanAheadOf`). The web draws one mark (`LoanMark`: an icon plus words, never colour alone) in the day detail and the Kalendar Osoba picker (`posudba iz tima {tim}`), a notice on *Moj raspored* and *Danas* (`U timu {tim} do {datum}`), a line in the directory (`trenutno u timu {tim}`), `posudba` in the hours explanation, and the record word `Posudba`; the readers that answer "with which team today" read the effective team.

## Boundaries & Constraints

**Always:**
- Required inputs (deferred-work, answered here): (1) `posudba`: `HOURS_SOURCE_LOAN`, precedence REPLACEMENT > LOAN > CHANGE > ROTATION; `MemberShift.loanId?: string` set on the effective-team shift when `effectiveTeamOn` returns a `loanId`, absent otherwise. (2) Home-team readers: switched to the effective team — admin today's absent members, leave overview's team today, the positions in swap proposals and replacement candidates (a loan team holds no position), the roster form's put-on candidates' team. Kept on the home team, deliberately: directory cell and filters (plus the loan line), *Danas*'s own-team line (plus the notice), `monthTeamOf` (Sati rows, the export's Team column), team-move preview, deactivation consequence, loan dialog. (3) Teamless lent member: *Danas* is unscheduled only with no membership and no live loan ending on or after today; leave sections (`leave-section-base`, `my-leave`) only with no membership and no loan. (4) History: record `loan` (`Posudba`) after `leave-allowance`, table `team_loans`; fields already named (member, team, during, reason, status); 18.4's `AMEND_KEYS` pairing reads it as `amended`.
- No-loan output is byte-identical (R11.4): every new field is absent, never `null`, without a loan.
- Privacy (18.2): no surface added here shows a loan's reason or author. The reason appears only where it already did (admin member page) and in *Povijest promjena*, whose events only an active admin reads (0061).
- The directory takes loans from the calendar snapshot (`CALENDAR_KEY`, shared, persisted offline); while it is pending or failed the list draws as before, with no loan line. Its rows, counts and filters stay the one members read.
- Kalendar Osoba picker: a person is placed under the loan team, marked, when a loan covers the loan reference date — today when the month shown holds today, else the month's last active date; `teamCounts` follow. Without such a loan the placement is `monthTeamOf`'s.
- Notice: the loan covering today, else the first starting after it: `U timu {tim} do {do}.` / `Od {od} u timu {tim} do {do}.`; none when no live loan ends on or after today.
- Copy in `hr.json` (`loans.mark.*`, `sati.explain.source.loan`, `history.record.loan`); a team is *tim*, never `smjena`.
- Never run DB-connecting tests, e2e, `supabase` or docker.

**Ask First:** none (founder: decide and record).

**Never:** no migration; no change to loan writes, the loan dialog or notifications; no new colour token; no column change in the export; no loan mark in the Sati table.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No loan | pilot fixture | every output equal to before; no field added | none |
| Day detail | A member lent to C 10.–12., C's 11th | listed under C with `posudba iz tima A` | none |
| Teamless lent | no team, lent to C | mark `posudba, bez svog tima`; *Danas* ready; leave costing ready | none |
| Hours | shift on a loan day | source `LOAN` → `posudba`; with a roster override → `zamjena` | none |
| Notice current | loan 10.–12., today 11th | `U timu C do 12.12.2026.` | none |
| Notice ahead | loan 20.–22., today 11th | `Od 20.12.2026. u timu C do 22.12.2026.` | none |
| Directory | loan covers today | home team, then `trenutno u timu C` | snapshot failed: no line |
| History | insert / removal / amend of `team_loans` | `Posudba` dodana / uklonjena / izmijenjena | none |
| Picker | loan covers today, current month | under C, marked | none |

## Epic AC Deviations

- AC 1, "the Team filter": read as Kalendar's Osoba picker, the one place the Team view lists people under teams; placement uses the reference date above, so a loan that covers neither today (current month) nor the month's last active date is not shown there (it is shown in the day detail of every covered date).
- AC 2, "`u timu {tim} do {datum}`": a loan ahead reads `Od {od} u timu {tim} do {do}.`, since "until" alone would misstate a loan that has not begun.
- AC 4, "the export follows rosters with no column change": hours follow the loan through the domain; the Team column stays the member's team for the month (`monthTeamOf`), as on *Sati*.

</frozen-after-approval>

## Code Map

- `packages/domain/src/schedule.ts:412` -- `memberScheduleOfMonth` takes `effectiveTeamOn(...)` once; adds `loanId` to the own-team shift when set.
- `packages/domain/src/hours.ts:217,296` -- `HOURS_SOURCE_LOAN`, `sourceOf`; `index.ts` exports it and `loanAheadOf`.
- `packages/domain/src/roster.ts` -- `loanAheadOf(loans, date)` beside `loanOn`.
- `packages/domain/src/history.ts:55,250` -- `HISTORY_RECORDS` + `RECORD_OF_TABLE.team_loans`; `test/history.test.ts` (TABLES, AUDITED 21→22, a loan's kind and fields); `test/loans.test.ts` (the `loanId` key, the `LOAN` source, `loanAheadOf`; the R11.6 explanation now differs from a team move only in the source).
- `apps/web/src/features/hours/services/hours-explanation.ts:166` -- `sati.explain.source.loan`.
- `apps/web/src/features/history/services/history-rows.ts:270` -- `history.record.loan`.
- `apps/web/src/components/loan-mark.tsx` (new) -- `LoanMark` (ArrowRight `aria-hidden` + words), `lentFromText`, `LoanTeamNote` (`trenutno u timu {tim}`); `apps/web/src/utils/loan-mark.ts` (new) -- the `LentFrom` type the filter bar and the calendar share.
- `apps/web/src/features/calendar/utils/loan-marks.ts` (new) -- `loanNoticeOf`, `loanNoticeMessageKey`, `lentFromOf`, `currentLoanTeamsOf`, `loanTeamsNowOf`; test `loan-marks.test.ts` (every matrix row at the service level, plus leave, positions and the export).
- `apps/web/src/features/calendar/hooks/use-loan-teams.ts` (new) -- the loan line's one read: the calendar snapshot's binding.
- `apps/web/src/features/calendar/components/loan-notice-line.tsx` (new) -- the notice on *Moj raspored* and *Danas*.
- `apps/web/src/features/calendar/utils/day-detail.ts:320,763` -- `DayDetailMember.lentFrom?`; put-on candidates' effective team. `components/day-detail-dialog.tsx` -- the mark.
- `apps/web/src/features/calendar/utils/month.ts` -- `filterTeamOf` (the Osoba picker's placement) and `ownLoan?` on `CalendarMonth`; `utils/filter-bar.ts` `FilterPersonOption.lentFrom?`; `components/filter-bar.tsx` the option's note; `pages/kalendar.tsx` the notice.
- `apps/web/src/features/today/services/today.ts` -- unscheduled rule, `TodayView.loan?`; `components/today-card.tsx`, `today-body.tsx` the notice; `services/admin-today.ts` `teamNameOn` on the effective team.
- `apps/web/src/features/leave/services/leave-section-base.ts`, `my-leave.ts` -- unscheduled rule; `leave-overview.ts` `teamTodayOf` on the effective team.
- `apps/web/src/features/swaps/services/swap-proposal.ts`, `calendar/utils/replacement-candidates.ts` -- position from `effectiveTeamOn`.
- `apps/web/src/features/members/hooks/use-member-list.ts`, `components/member-rows.tsx`, `member-table.tsx` -- the admin list's loan line; `features/teams/hooks/use-member-directory.ts`, `use-team-roster.ts`, `components/roster-lines.tsx`, `member-directory.tsx`, `team-roster.tsx` -- the members' directory's and a team roster's.
- Deliberately left on the home team: `members/services/list.ts` (`teamCellOf`, the filters and counts), `calendar/utils/month.ts` `monthTeamOf` (*Sati*, the export's Team column), `members/services/team-move-preview.ts`, `deactivation-consequence.ts`, `members/services/loan.ts`, `today.ts` `ownTeamOf`.
- `eslint.config.js` `FEATURE_PUBLIC.calendar` -- `utils/loan-marks`, `components/loan-notice-line`, `hooks/use-loan-teams`.
- `apps/web/src/lib/i18n/locales/hr.json` (`loans.mark.*`, `sati.explain.source.loan`, `history.record.loan`), `test/resource-hygiene.test.ts`; structural fixtures: `calendar-screen.fixture.ts` (the mark and the notice in the set; `loan-marks.ts`, `use-loan-teams.ts` exempt), `pages/key-sources.fixture.ts` (Kalendar 177→182, history rules 150→151, hours explanation 11→12, the loan marks' rules as a key source), `source-guards.fixture.ts` (`LOAN_MARKS_KEYS`), `screens-sweep.test.ts` (97 key sources, the shared mark), `calendar/services/snapshot.test.ts` (the mark swept).
- Docs: `EXPERIENCE.md` (loan marks, the hours explanation's source), `DESIGN.md` (`loan-mark`), `epics.md` UX-DR59, spine AD-13 amended (the loan line).

## Tasks & Acceptance

**Execution:**
- [x] domain -- `loanId`, `HOURS_SOURCE_LOAN`, `loanAheadOf`, history record; tests incl. no-loan byte-identity over both fixtures.
- [x] web pure modules -- every matrix row tested at the service level.
- [x] components -- the mark, the notice, the directory line.
- [x] `hr.json`, resource-hygiene, structural fixtures.
- [x] docs: EXPERIENCE.md, DESIGN.md, epics UX-DR59; spine AD-13 amended (the loan line reads the calendar snapshot outside the surfaces' freshness set).
- [x] `deferred-work.md` -- the three 18.5 entries RESOLVED; `sprint-status.yaml` -- 18.4 `done  # #330`, 18.5 `review  # built, CI pending`.

**Acceptance Criteria:**
- Given no loan anywhere, when any changed surface renders, then it shows exactly what it showed before.
- Given the allowed local commands, when run, then they pass.

## Spec Change Log

- 2026-11-21 (review 2) — the mark's copy, by founder decision relayed by the orchestrator: `posuđen iz {tim}` put the stored team name in the nominative after *iz* and was masculine for everyone; it now reads `posudba iz tima {tim}`, and the teamless one `posudba, bez svog tima`. The frozen Intent and matrix rows carry the new wording; the epic AC 1 and UX-DR59 (`epics.md`), EXPERIENCE.md, DESIGN.md, `epic-18-context.md`, `hr.json`, the code comments and the tests follow; the deferred entry is RESOLVED.

## Design Notes

1. Glyph: the existing `ArrowRight` icon, as the calendar's modifier icons are drawn (`size-3`, `aria-hidden`), followed by the words; no new asset, no colour.
2. `loanId` rather than a boolean: the web names the loan's team and dates from it.
3. A teamless lent member's mark reads `posudba, bez svog tima`: there is no team to name.
4. The directory does not read loans itself: the calendar snapshot already holds every live loan without reason (`calendar_team_loans()`), is cached and persisted, and is refreshed by every loan write (`use-member-loan.ts` invalidates `CALENDAR_KEY`).
5. "The directory" is two surfaces on `/ljudi`: the admin's list and, for a member-role session, the read-only directory of team rosters (story 7.17), whose lines are a team's roster's (`RosterLines`). All three draw the line. Those rosters come from `team_roster()` (membership only), so a lent member stays under the home team there with `trenutno u timu {tim}`; the loan team's own roster page does not list them (no migration in this story: deferred).
6. Ahead of a loan the notice adds its first date (`Od {od}. u timu …`), the date's ordinal dot kept mid-sentence, as the matrix writes it.
7. The Osoba picker's loan date is today only in the month holding today, so no loan-free placement changes (a mid-month team move still groups by the last active date). A loan to a team archived since places the person as before (review).
8. Every mark and notice is GUARDED (`lentFromShownOf`, `loanNoticeShownOf`, `currentLoanTeamsOf`): one that cannot be derived is absent and logged `LOAN_MARKS_UNAVAILABLE`, never a failed day detail, month, *Danas* or list (review).
9. *Danas* counts a teamless member as scheduled only for a loan covering today or ahead (today's view has nothing to show from a past loan); the leave sections count any live loan, because a past leave on a past loan's dates is still costed. An inactive member gets no directory line (review).
10. *Moj raspored*'s notice sits under its sentence (`ownNote`), which exists exactly when the mode is *Moj raspored*; the day detail never marks a member a roster override put on, which `rosterOn` cannot do for a member already on the default roster anyway.
11. The mark reads `posudba iz tima {tim}` (`posudba, bez svog tima` with no team): the founder replaced the approved `posuđen iz {tim}`, which put a stored team name in the nominative after `iz` and was masculine for everyone (review 2, see the Spec Change Log).

## Review Triage Log

### 2026-11-21 — Review pass (unattended)
- Layers: blind, edge-case, verification-gap, epic AC — fresh-context subagents on the diff from the baseline (re-launched once after an API limit). The implementation ran in this session, not a fresh subagent, as in 18.4 (the investigation was loaded; the resource rules ask for no duplicate work).
- intent_gap 0, bad_spec 0; patched: the notice could fail *Danas* and the mark the day detail (now guarded, logged `LOAN_MARKS_UNAVAILABLE`, also in place of `CALENDAR_UNAVAILABLE` on the month); `useLoanTeams` froze "today" on the snapshot (now derived each render); an inactive member got the directory line; a loan to a team archived since put a person under an archived team in the picker (and `filterTeamOf` now reads `effectiveTeamOn` once); the picker note lacked the hidden separator; tests added for LOAN over CHANGE, a definite REPLACEMENT check, admin *Danas* absences and the leave overview on a lent member, the swap colleague's position, the export's total hours, the guarded mark, the inactive line, the archived placement and the no-`smjena` guard over the hours source and the history record; import order; the spine's AD-13 clause names the new read.
- Deferred: the mark's Croatian case and gender (founder; copy fixed by the epic AC); an e2e for the drawn marks (no render tests in the web suite). The loan team's own roster page was already deferred (design note 5).
- Rejected: render tests (the web suite is node-only by convention, AD-15); the `RESOLVED …` prefix keeping the old text (the ledger's convention); Ljudi's and the roster's key-source counts (`@/components/loan-mark` is swept in the Kalendar set, and the key sweep passes); the spec's `Od {od}` in the frozen Always (design note 6 records the built `Od {od}.`, matching the frozen matrix); recording the loan team's roster as an epic AC deviation (no AC names it); one notice for a current and a later loan (the AC asks for the covering one).
- Epic AC audit: no unmet AC; the deviations listed match; two minor unlisted points (the teamless wording, one notice at a time) are recorded in design notes 3 and 11 and here.

### 2026-11-21 — Review pass 2 (unattended, `bmad-code-review`)
- Layers: blind, edge-case, verification-gap, acceptance, epic AC — fresh-context subagents on `git diff origin/main...HEAD`; the artifact renderer was skipped (no generated file).
- Copy (orchestrator decision): the mark is `posudba iz tima {tim}` / `posudba, bez svog tima` (Spec Change Log). Every other new string checked for case after a preposition and gender: `U timu {tim} do {do}.`, `Od {od}. u timu {tim} do {do}.`, `trenutno u timu {tim}` (the team name in apposition to *timu*, which takes the case), `posudba`, `Posudba` — correct, gender-neutral, and none calls a team `smjena`.
- Patched: the directory line's "today" froze with the page (`useLoanTeams` read `new Date()` on a render nothing triggered at midnight) — it now reads `useOrganizationToday` (the minute ticker, moved at the organization's midnight) and memoizes the map on the snapshot and the date; the dead zone guard (`organizationIsoDate` falls back to UTC, never throws) is gone with `loanTeamsNowOf`. `currentLoanTeamsOf` is guarded per member, so one underivable loan loses only its own line. An admin's *Danas* had no loan notice (epic AC 2 names *Danas*): `adminOwnLoanOf` states it under the subtitle. A team roster's line changed its markup with no loan (R11.4): the old span is kept unless the member is on loan today. `member-rows.tsx` formatting. Tests: the picker on a month's last active date (positive) and inactive on the loan date; the organization's zone against UTC across midnight; the guarded notice keeping *Danas* ready and the month whole; one member's bad loan leaving the others' lines; the admin notice; the domain's `loanId` check is no longer vacuous on a covered day without a shift, and the `REPLACEMENT` check now runs on a loan date the home team works (it had checked nothing).
- Deferred: the history record's team field reads the shared label `Smjena` (`history.field.team`) while loan copy says *tim* — an app-wide terminology decision (deferred-work).
- Rejected: a loan to an archived team in the notice, the directory line or the leave overview — 0064 refuses to archive a team while a live loan to it ends today or later, so only past loans can name an archived team, and only the picker (handled) reads past dates; the unguarded `loanAheadOf` in *Danas*'s unscheduled rule — it has `effectiveTeamOn`'s preconditions, which the schedule computed right after asserts on the same loans, so a guard would only move the failure; *Bez smjene* above a teamless member's notice (both true: no team of their own, with D until the date); the leave sections' any-loan rule (design note 9 gives the reason); `loans.length` unguarded in the leave sections (the type is required there; typecheck holds it); LOAN hiding a changed type on a loan day (the precedence is the spec's); the frozen `Od {od}` (rejected in pass 1); `status: 'done'` with sprint status `review` (the spec's status is the build's, the sprint status the merge's, as in 18.4); the shared `ljudi.status.separator` (one separator, reused deliberately); render and e2e coverage (deferred in pass 1); history actions `dodano` / `izmijenjeno` against the matrix's feminine forms (every record uses the neutral actions; the matrix names the events, not the words); the roster page (deferred in pass 1); the epic AC deviations the auditor found unlisted (the teamless wording, one notice at a time) — recorded in design notes 3 and 11 and pass 1, and the frozen section is not reopened for them.

## Verification

Baseline: `3cd84d1`, the 18.4 merge (#330), the latest merge touching the hot files (`hr.json`, the structural pins).

**Commands:**
- `pnpm --filter @shift/domain build && pnpm typecheck`, `pnpm lint` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter ./apps/web test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/key-hygiene.test.ts test/localization-guard.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts` -- pass.

**Results (2026-11-21, after review pass 2):** typecheck and lint clean; domain 17 files, 905 passed; web 176 files, 6640 passed; DB-free root (6 files) 2443 passed, 2 skipped.

**Results (2026-11-21, after the review's patches):** typecheck and lint clean; domain 17 files, 905 passed; web 176 files, 6636 passed; DB-free root (6 files) 2443 passed, 2 skipped. No migration, so no DB test is affected; no e2e was run locally (CI is the gate).

## Auto Run Result

Status: done (built; sprint status `review  # built, CI pending`).

**Residual risks:**
- The drawn marks (notice, picker note, directory line) are covered at the model level only; their e2e is deferred.
- The mark's Croatian is settled (`posudba iz tima {tim}`, founder decision in review 2).

## Suggested Review Order

**The domain's mark**

- The loan's id rides only on the shift a loan put there; no-loan output unchanged.
  [`schedule.ts:431`](../../packages/domain/src/schedule.ts#L431)
- `LOAN` below `REPLACEMENT`, above `CHANGE`.
  [`hours.ts:303`](../../packages/domain/src/hours.ts#L303)
- The loan announced: covering, else next.
  [`roster.ts:214`](../../packages/domain/src/roster.ts#L214)
- Loan events get their own record.
  [`history.ts:274`](../../packages/domain/src/history.ts#L274)

**Where a loan is said**

- Whom a lent member came from, by the one rule.
  [`loan-marks.ts:98`](../../apps/web/src/features/calendar/utils/loan-marks.ts#L98)
- The own loan's notice.
  [`loan-marks.ts:66`](../../apps/web/src/features/calendar/utils/loan-marks.ts#L66)
- Who is on loan today, for the directory and rosters.
  [`loan-marks.ts:123`](../../apps/web/src/features/calendar/utils/loan-marks.ts#L123)
- The day detail's mark, guarded.
  [`day-detail.ts:339`](../../apps/web/src/features/calendar/utils/day-detail.ts#L339)
- The Osoba picker's placement under the loan team.
  [`month.ts:1224`](../../apps/web/src/features/calendar/utils/month.ts#L1224)

**Teamless lent members**

- *Danas* scheduled while a loan covers today or lies ahead.
  [`today.ts:320`](../../apps/web/src/features/today/services/today.ts#L320)
- Leave costing scheduled with any loan.
  [`my-leave.ts:231`](../../apps/web/src/features/leave/services/my-leave.ts#L231)

**Surface**

- Glyph plus words, never colour.
  [`loan-mark.tsx:16`](../../apps/web/src/components/loan-mark.tsx#L16)
- The directory line's one read: the calendar snapshot.
  [`use-loan-teams.ts:12`](../../apps/web/src/features/calendar/hooks/use-loan-teams.ts#L12)
- The picker option's note.
  [`filter-bar.tsx:864`](../../apps/web/src/components/filter-bar.tsx#L864)

**Peripherals**

- Every matrix row at the service level.
  [`loan-marks.test.ts:131`](../../apps/web/src/features/calendar/utils/loan-marks.test.ts#L131)
