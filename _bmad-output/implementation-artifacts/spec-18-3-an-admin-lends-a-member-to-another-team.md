---
title: '18.3 An admin lends a member to another team'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_commit: '4fd6a30fc250b9829f8253ab8a47dd612900202c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-18-2-a-loan-is-a-recorded-exception.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 18.2 stores `team_loans`, but nothing writes one: an admin can lend a member only through SQL, sees nothing of what a loan changes before saving (FR-90), and the member is not told (FR-62).

**Approach:** The member page's *Smjena* card gains *Posudi drugom timu*, opening a dialog (team, *Od*, *Do*, *Razlog*) with *Što se mijenja* and one *Spremi*, built exactly as the team-move dialog (story 7.11/5.5e/11.2): one "after" snapshot — the calendar with the draft loan on the member — feeds the preview, the short-staffed block and the AD-5 erasure check; the write is 0062's plain insert. Migration `0063` adds an AFTER INSERT trigger writing `LOAN_MADE` to the lent member through `notify_members`; `notify` renders it.

## Boundaries & Constraints

**Always:**
- One "after" (`loanChangeSnapshotOf`): the member's `members` entry (and the viewer, when it is them) with the draft loan appended. Before deriving it refuses as the database would: team missing (stale) or archived, the member's home team on any covered date (`membershipOn`), a live loan sharing a date, `to < from`.
- *Što se mijenja* (warn, never block): per date in `[from, to]`, the working shifts the member loses and gains (first 10 lines, `i još {n}`); every pair of working legs of two different teams that overlap (double booking) or join with no rest (`dutiesOf`, the duty's total as FR-26's figure) over `[from − 1, to + 1]`; the short-staffed block over `[from, to]` (`configurationReportOf`, both teams); every in-force roster override dated in the range that applies before and not after. Overrides are kept as they are and listed with where to remove them; nothing is discarded.
- The erasure check (AD-5) re-reads the three core reads, rebuilds the same "after", runs `erasuresOf` from `from`; erasures open the shared `ErasureDialog`; refused or unavailable as the team move does.
- Reason required: 1–200 code points after 0036's trim, checked before sending; 23514 `team_loans_reason_length` maps to the same message.
- Notification `LOAN_MADE` to the member, operands `startDate`, `endDate`, `teamName`; none when the loan ends before the organization's today, the author is the member, or the member has no channel (0045's rules). No reason, no author in it.
- Copy in `hr.json`'s `loans` namespace (and `obavijesti.loanMade`, mirrored in `notify/messages.ts`), saying *tim* as UX-DR58/59 do and never `smjen`.
- Never run DB-connecting tests, e2e, `supabase` or docker; pins are updated unrun.

**Ask First:** none (founder: decide and record).

**Never:** no amend, end early or removal (18.4); no loan marks, history wording or `posudba` source (18.5); no change to 0062 or to what members can read; no new feature folder (the dialog is the member page's).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lend | active team C ≠ home, 10.–12., reason | preview lists A's shifts lost and C's gained; save inserts; card says saved; member gets `LOAN_MADE` | none |
| Boundary | home Noć on 9th, C Dan on 10th | rest-gap line `24 h rada bez odmora` | none |
| Overlap legs | home override puts member back on A on 11th | double-booking line | none |
| Override inert | override on A takes member off on 11th | listed as no longer applying, kept | none |
| Short-staffed | A falls below minimum on 10th | block row for A | unknown line while leave unread |
| Unpicked / dates / reason | placeholder; bad or reversed dates; blank or >200 | nothing sent | field alert, focus |
| Home team / archived / overlap | fresh read says so | nothing sent | named refusal |
| Erasure | member on leave on 11th | erasure dialog; save after confirming | as team move |
| DB refusal | 23P01 / 42501 / 23514 reason / other | refusal kept in dialog | overlap / denied / reason / failed |
| Past loan | ends before today | stored, no notification | none |

## Epic AC Deviations

- AC 1, "a dialog takes team, *Od* and *Do*": extended with *Razlog*, required by FR-88 and 0062 (18.2's deferral, answered here).
- AC 2, "double booking on the boundary days": reported over `[from − 1, to + 1]`, which contains the boundary days; a double shift an override causes inside the range is reported too.
- AC 2, "Roster Overrides on covered dates that need review": listed and kept; the admin removes one from the calendar's day detail, where removal already lives. No in-dialog removal (it would be a second, non-atomic write).
- AC 4, "UX-DR23, 31/32, 58": UX-DR23 and 58 are updated; 31/32 are unchanged because 18.3 adds no destination, only a card button.

</frozen-after-approval>

## Code Map

- `packages/domain/src/duty.ts` -- add `overlappingLegsOf(legs)` (pairs of legs whose half-open spans overlap); export from `index.ts`; tests in `packages/domain/test/duty.test.ts`.
- `packages/domain/src/schedule.ts` -- add `rosterOverridesMadeInertOf(before, after, from, to)` over two `ScheduleInput`s (working scheduled type, `rosterOverrideApplies` on each side's `shiftRoster`); export; tests in `packages/domain/test/loans.test.ts`.
- `apps/web/src/features/members/services/loan.ts` (new) -- codes, `loanChoicesOf`, `loanPreflightOf`, `loanChangeSnapshotOf`, `loanPreviewOf`, `shownLoanShortStaffedOf`, `loanErasureCheckOf` (on `checkedOf`/`erasuresOf`/`erasuresOutcomeOf`), `lendMember` (insert, as `recordLeave`), `loanWriteFailureOf`. Reuses `memberScheduleInputOf`, `shiftLegOn`, `typeRangeOn` (`calendar/utils/month.ts`), `snapshotScheduleInputOf`, `configurationReportOf` (`staffing/services/short-staffed.ts`).
- `apps/web/src/features/members/services/loan.test.ts` (new) -- matrix rows on `rotation.fixture.ts`'s `calendarTableOf`-built snapshots.
- `apps/web/src/features/members/hooks/use-member-loan.ts` (new) -- dialog state, as `use-member-team.ts` (in-flight ref, `raisedForMember`, `useErasureConfirmation`, `writesOnline`, `refreshAfterWrite(CALENDAR_KEY, MEMBERSHIP_WRITE_DEPENDENTS)`).
- `apps/web/src/features/members/hooks/use-member-edit.ts` -- spread `useMemberLoan(screen)`.
- `apps/web/src/features/members/components/member-loan-dialog.tsx` (new) -- dialog and its erasure dialog, as `member-team-card.tsx`'s; `member-team-card.tsx` gains the header button, the saved notice and renders it.
- `apps/web/src/lib/i18n/locales/hr.json` -- `loans.*`, `obavijesti.loanMade`; `test/resource-hygiene.test.ts` sanctions them.
- `supabase/migrations/0063_team_loan_notifications.sql` (new) -- `private.notify_team_loan()` + `team_loans_notify_insert`, revoke execute; `supabase/functions/notify/messages.ts` -- `loanMade`, `LOAN_MADE`, link `/kalendar`.
- `test/supabase-scaffold.test.ts` (run) -- 0063 shape block; `test/provisioning.test.ts`, `test/rls-isolation.test.ts`, `test/notify-boundary.test.ts` (unrun) -- trigger and function pins, a `LOAN_MADE` behaviour case, the render case.
- `e2e/` -- grep for the *Smjena* card's buttons and status; e2e cleanup already deletes loans and their outbox rows (18.2).
- Docs: `ARCHITECTURE-SPINE.md` AD-5 amended; `epics.md` UX-DR23, UX-DR58; `EXPERIENCE.md` member page; `DESIGN.md` untouched unless a component changes (none does).

## Tasks & Acceptance

**Execution:**
- [x] domain `duty.ts`, `schedule.ts`, `index.ts` + tests -- the two pure rules.
- [x] `members/services/loan.ts` + `loan.test.ts` -- every matrix row.
- [x] hook, dialog, team card, `use-member-edit.ts` -- the surface.
- [x] `hr.json`, `resource-hygiene.test.ts` -- copy.
- [x] `0063`, `messages.ts`, scaffold/provisioning/rls/notify-boundary pins -- the notification.
- [x] spine AD-5, `epics.md` UX-DR23/58, `EXPERIENCE.md` -- docs.
- [x] `deferred-work.md` -- mark the 18.3 reason entry RESOLVED.
- [x] `sprint-status.yaml` -- 18.2 `done  # #325`, 18.3 `review  # built, CI pending`.

**Acceptance Criteria:**
- Given no loan drafted, when the member page renders, then nothing it showed before changes but the card's new button.
- Given the DB-free root tests, domain and web suites, typecheck and lint, when run, then they pass.

### Review Findings

- [x] [Review][Patch] A no-rest run crossing the window is cut short [apps/web/src/features/members/services/loan.ts:loanPreviewOf]
- [x] [Review][Patch] A double booking's key follows the day's shift order [apps/web/src/features/members/services/loan.ts:loanPreviewOf]
- [x] [Review][Patch] A checked refusal does not re-read the members list [apps/web/src/features/members/hooks/use-member-loan.ts:refuseChecked]
- [x] [Review][Patch] The preview's log has no `LOAN_UNAVAILABLE` tag [apps/web/src/features/members/services/loan.ts:shownLoanPreviewOf]
- [x] [Review][Patch] The shift line's React key can collide [apps/web/src/features/members/components/member-loan-dialog.tsx]
- [x] [Review][Patch] No case for a loan ending yesterday [test/rls-isolation.test.ts]

## Design Notes

1. Past dates are allowed (as leave records): a late-entered loan is a correction; it is not notified when wholly past.
2. Choices are the active teams other than the member's team today; the home team on another covered date is the fresh check's refusal.
3. Gained/lost compares working shifts by team and type per date, so an unchanged date writes no line.
4. Double bookings and cross-team no-rest duties are reported only when the "before" over the same window does not already hold them (review). The preview and the short-staffed block are not derived for a span over 366 days (`LOAN_PREVIEW_MAX_DAYS`), so a year typed digit by digit never freezes the dialog; the save is unaffected.
5. Overrides the loan makes newly apply (e.g. one putting the lent member back on their home team) are not listed as override rows; their effect is in the gained lines and, when they overlap or chain, in the double-booking and no-rest lines. Only overrides made inert are listed (FR-90's "inapplicable"). Recorded after the epic AC audit called it an unlisted narrowing of AC 2.
6. Not notified, by 0043/0045's existing recipient rules: a loan wholly before the organization's today, the admin who lends themselves, and a member with no channel or inactive today. Recorded after the epic AC audit called AC 3's narrowing unlisted.
7. A 42501 at insert means not an active admin, or the policy refusing a home or archived team after the fresh check (a race); one neutral message names all three, and the calendar, teams and members are re-read.
8. AC 3's "the change history records it" is met by 18.2's two audit triggers on `team_loans` (one INSERT event per loan); *Povijest promjena* shows it as record `other` until 18.5 adds the record and its wording (Never list; `deferred-work.md`, 18.2's 18.5 entry). Recorded after the second review's epic AC audit.
9. Double bookings and no-rest runs are reported only across two teams (AC 2's "the rest gap" is the loan's boundary): inside the borrowing team alone the run is that team's own rotation, which the loan does not make. The legs are read 7 days either side of the range (`LOAN_DUTY_REACH_DAYS`) so a run crossing `from − 1` or `to + 1` keeps its whole total; a line is reported when one of its legs falls in `[from − 1, to + 1]`. Recorded after the second review.
10. The notification's copy is `obavijesti.loanMade`, not under `loans`: every `notify` message lives in `obavijesti`, mirrored in `messages.ts` and pinned by `notify-boundary`. The dialog's copy is all in `loans`. Recorded after the second review's epic AC audit.

## Verification

**Commands:**
- `pnpm --filter @shift/domain build && pnpm typecheck` -- clean.
- `pnpm lint` -- clean.
- `pnpm --filter @shift/domain test`, `pnpm --filter ./apps/web test` -- pass.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/key-hygiene.test.ts test/localization-guard.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts` -- pass.
- Not run locally: 0063, provisioning, rls-isolation, notify-boundary, e2e (STRICT DATABASE RULE); CI is the gate. They fail locally only because 0063 is unapplied; their expected trigger text, codes and operands were reasoned, not executed.
- CI (recorded 2026-11-21, epic 18 retro A7): #328 merged with `CI passed` green; the 0063 cases passed on their first run.

**Results (2026-11-21, after the second review's patches):** typecheck and lint clean; domain 17 files, 893 passed; web 174 files, 6560 passed (36 in `loan.test.ts`); DB-free root (resource-hygiene, supabase-scaffold, key-hygiene, localization-guard, import-cycles, feature-boundaries) 2415 passed, 2 skipped. Every matrix row is covered in `loan.test.ts` at the service level; the "card says saved" and erasure-dialog rows have no rendered or e2e test (deferred to 18.4). Matrix dates are illustrative: on the pilot fixture A is off on the 10th and 11th, so the tests use the dates the fixture works (the 12th).

## Spec Change Log

None (no bad_spec loopback). Design Notes 4–7 added from the review.

## Review Triage Log

### 2026-11-21 — Review pass (unattended)
- Layers: blind, edge-case, verification-gap, epic AC (4 of 4; no generated file).
- intent_gap 0, bad_spec 0, patch 10, defer 3, the rest rejected.
- Patched: the 42501 message named only the admin case (now neutral, with re-reads); `shownLoanShortStaffedOf` rethrew non-RangeErrors inside render; doubles and no-rest duties already in "before" were reported; a long span (a year typed digit by digit) froze the preview (366-day cap); an override naming a member missing from the snapshot blanked the preview; the dialog stayed open on a stale re-read; no trailing-boundary test; the `footer` line's formatting changed in `hr.json` and `messages.ts`; `loans.restGap` said "bez odmora" twice; *Razlog* had no limit hint.
- Deferred to 18.4 (`deferred-work.md`): 0063 would notify again on 18.4's amend insert; lending an inactive member; an e2e spec for the dialog.
- Rejected: dates read from refs and the team from state (the team dialog's own pattern); DESIGN.md untouched (no component changed: the dialog is the existing Dialog, Select, Input); cross-organization team in the notify trigger (0062's composite keys make it unrepresentable); a windowed snapshot missing loans (`calendar_team_loans()` returns every live loan); sprint-status and checkboxes (bookkeeping, done here).
- Epic AC audit: no AC not met; the two unlisted narrowings are recorded in Design Notes 5 and 6.

### 2026-11-21 — Second review pass (unattended)
- Layers: blind, edge-case, verification-gap, acceptance, epic AC (5 of 5; artifact renderer: no generated file).
- intent_gap 0, bad_spec 0, patch 6, defer 0, the rest rejected.
- Patched:
  - a no-rest run crossing `from − 1` or `to + 1` was cut at the window, understating FR-26's total and keying differently before and after; legs are now read `LOAN_DUTY_REACH_DAYS` (7) days either side, reported when a leg is in `[from − 1, to + 1]` (new test, which fails at a reach of 1);
  - a double booking's key followed the day's shift order, so a pre-existing pair could read as new; the key is now order-free;
  - a refusal from the fresh check re-read the calendar and teams but not the members list, unlike the team move's `refuseTeamChecked` and the insert's own re-reads;
  - `shownLoanPreviewOf` logged without the `LOAN_UNAVAILABLE` tag;
  - the shift line's React key joined user-entered names with no separator;
  - rls-isolation had no case for a loan ending yesterday (an off-by-one at the "wholly past" boundary passed every case); one is added (unrun, as the rest). EXPERIENCE.md now names every recipient rule.
- Epic AC audit: the history half of AC 3, the cross-team-only rest gap and `obavijesti.loanMade` are recorded in Design Notes 8–10. No AC is unmet.
- Rejected:
  - year bounds: `isIsoDate` years are 0001–9999, which 0062's check admits;
  - the self-lend case's team: `other` is a throwaway team, never the caller's;
  - 23503 as stale: teams are never deleted and composite keys keep tenants apart;
  - NUL in the reason: not typeable;
  - 42501 named as archived or home: the neutral message is Design Note 7;
  - untimed working shifts never flagged as double: a double is defined by time spans;
  - `dutiesOf` drops overlapping legs: the overlap is the double line;
  - `gone` closing on a transient null: query data is kept during a refetch;
  - no `stopped` guard on the erasure confirmation: the loan has no history key, and the fresh check refuses home, archived and overlap;
  - the header's wrapper `div`: nothing visible changes;
  - the notices in one card branch: `renderTeam` has one branch;
  - the "after" built twice: the same derivation, each memoised in the hook;
  - literal element ids: the team dialog's own pattern;
  - the team list frozen at open: the fresh check refuses;
  - silent trigger skips: 0043's pattern;
  - spec `status: done` beside sprint `review`: the workflow's convention;
  - the RESOLVED ledger entry keeping its old text: the ledger's convention;
  - existing loans not listed and a one-day loan read "Od X do X": 18.5's loan marks, and cosmetic;
  - the email switch and inactive recipients untested here: `notify_members` and its tests own them;
  - the matrix dates: frozen, and covered by Results;
  - the hook and dialog untested: already deferred to 18.4.

## Auto Run Result

Status: done (merged as #328, squash `93740d3`, with `CI passed` green; sprint status `done`). Residual risks rewritten to the CI facts by epic 18 retro A7 (2026-11-21).

**Residual risks:**
- Settled by CI: `0063`, the provisioning trigger pin, the rls-isolation `LOAN_MADE` cases and the notify-boundary render case passed on their first CI run (two earlier runs were cancelled by new pushes). No CI-only fix was pushed.
- Settled by 18.4: `e2e/tests/people/member-loan.spec.ts` drives the dialog (lend, a refusal kept, an erasure confirmed) and passed in #330's green run `44862703557` (575 e2e tests).
- Settled by 18.4: a loan is amended or removed through `amend_team_loan` and `remove_team_loan`.

## Suggested Review Order

**The one "after"**
- Refuses as the database would, then appends the draft loan to the member (and viewer).
  [`loan.ts:228`](../../apps/web/src/features/members/services/loan.ts#L228)
- Client preflight: team, dates, order, reason 1–200 code points.
  [`loan.ts:190`](../../apps/web/src/features/members/services/loan.ts#L190)

**Što se mijenja**
- Gained/lost per date, new doubles and no-rest duties, overrides made inert.
  [`loan.ts:413`](../../apps/web/src/features/members/services/loan.ts#L413)
- Overlapping legs, the domain's new rule.
  [`duty.ts:204`](../../packages/domain/src/duty.ts#L204)
- Overrides applying before and not after, the domain's new rule.
  [`schedule.ts:223`](../../packages/domain/src/schedule.ts#L223)
- Short-staffed over `[from, to]`, both teams, never throws.
  [`loan.ts:559`](../../apps/web/src/features/members/services/loan.ts#L559)

**Erasure check and write**
- AD-5: fresh reads, the same "after", `erasuresOf` from `from`.
  [`loan.ts:588`](../../apps/web/src/features/members/services/loan.ts#L588)
- 0062's plain insert and its refusal mapping.
  [`loan.ts:659`](../../apps/web/src/features/members/services/loan.ts#L659)
  [`loan.ts:642`](../../apps/web/src/features/members/services/loan.ts#L642)

**Surface**
- Spremi: preflight, check, erasure dialog or write.
  [`use-member-loan.ts:310`](../../apps/web/src/features/members/hooks/use-member-loan.ts#L310)
  [`use-member-loan.ts:340`](../../apps/web/src/features/members/hooks/use-member-loan.ts#L340)
- The dialog, as the team dialog.
  [`member-loan-dialog.tsx:51`](../../apps/web/src/features/members/components/member-loan-dialog.tsx#L51)
- The card's new header button.
  [`member-team-card.tsx:245`](../../apps/web/src/features/members/components/member-team-card.tsx#L245)

**Notification**
- `LOAN_MADE` to the lent member through `notify_members`.
  [`0063_team_loan_notifications.sql:30`](../../supabase/migrations/0063_team_loan_notifications.sql#L30)
- The rendered message.
  [`messages.ts:229`](../../supabase/functions/notify/messages.ts#L229)

**Peripherals**
- AD-5 amended for a loan's save.
  [`ARCHITECTURE-SPINE.md:116`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L116)
- Matrix tests.
  [`loan.test.ts:1`](../../apps/web/src/features/members/services/loan.test.ts#L1)
