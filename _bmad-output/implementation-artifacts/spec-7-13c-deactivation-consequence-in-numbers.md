---
title: 'The deactivation question states its consequence in numbers (7.13c)'
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: '91be3bc4cba6dcbc8eaaf299284b0727ebce739b'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The member page's *Deaktivacija osobe* dialog asks its question in words only (`hr.json` `deactivatePrompt*`). The admin does not see what the deactivation costs the team. Its final button says only *Deaktiviraj*. Story 7.13 AC3 and UX-DR27 ask for "a date and the consequence in numbers".

**Approach:** Follow `mockups/people-1.html` §3. While *Vrijedi od* holds a date, the dialog adds one computed line under the shipped question:
- `{team} od tada ima {n} od {m} članova, a {monthIn} je to {k} smjena.` (for example *Smjena B od tada ima 3 od 4 člana, a u listopadu je to 7 smjena.*)
- The final button reads `Deaktiviraj od {dd.mm.}`.

## Boundaries & Constraints

**Always:**
- **One computation, in a pure `.ts` that node tests.** The consequence comes from the calendar snapshot. Given the member and the day:
  - `team` is the member's team on the day (`membershipOn`).
  - `m` is the size of that team's roster on the day (`shiftRoster`), counted before the change.
  - `n` is the size of the same roster on the day in the "after" snapshot. The "after" is built by the 5.5e recipe `memberChangeSnapshotOf` with a deactivation (`MEMBER_CHANGE_STATUS`, `active: false`). Do not build a second "after".
  - `k` counts the member's own-team DUTIES (not `viaOverride`) from the day through the end of the day's month: the working shifts from `memberScheduleOfMonth(memberScheduleInputOf(snapshot, member), monthOf(day))` on the "before" snapshot, grouped by the domain's `dutiesOf` (story 6.2), where a duty of touching shifts (Dan + Noć) counts once and a shift alone counts once. Leave days are not excluded. (Human decision 2026-10-10.)
  - The function returns codes and operands only. It returns `null` in these cases: the member has no team that day; the snapshot is not ready; `memberChangeSnapshotOf` refuses; the domain throws (log it, never rethrow).
- **The line is neutral text** (no `destructive`, no ⚠). It sits inside the dialog's described prompt, so `aria-describedby` reads it. It never gates the save. When the result is `null`, the line is left out and the shipped question stands alone.
- If `k` is 0, the month clause is dropped: `{team} od tada ima {n} od {m} članova.`
- **The button.** Only for a deactivation, and only while the field holds a valid date, the final button reads `Deaktiviraj od {dd.mm.}` (`formatIsoDayMonth`). Otherwise it reads the shipped *Deaktiviraj*. Reactivation is unchanged.
- **The data.** `use-member-edit` observes the calendar snapshot under the same key and arguments as `use-member-leave`. The page already reads it there, so this adds no request. There is no optimistic state. A landed write still invalidates as shipped.
- **Copy and docs:**
  - All copy goes in `hr.json`, using ICU plurals for `m` (`# člana / # člana / # članova`) and `k` (`# smjena / # smjene / # smjena`). The month is `filter.monthIn` through `monthInMessageKey`. The team name stands in apposition.
  - Docs go in the same PR: EXPERIENCE.md :141 (the deactivation question carries the numbers) and :102 (member page); epics.md UX-DR27 note.
  - sprint-status: 7.13c and 7.13 move with the workflow; `epic-7` → `done` when this lands.
  - `deferred-work.md`: close the 7.13c entry. `epic-7-context.md`: 7.13c shipped.

**Ask First:** a migration; any RPC or Edge Function change; any change to `packages/domain`; a new dependency; offering deactivation anywhere but the member page.

**Never:**
- a second roster, schedule or "after" computation;
- deactivation offered from Ljudi (decided 2026-10-08);
- `destructive` styling or a toast;
- blocking the save on a missing consequence;
- changing the erasure guard's flow.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy | Zoran on Smjena B (4 active), date 05.10., 7 own B duties (Dan+Noć pairs) 05.–31.10. | `Smjena B od tada ima 3 od 4 člana, a u listopadu je to 7 smjena.`; button `Deaktiviraj od 05.10.` | N/A |
| Late in month | date on the last day, no B shift left | `… ima 3 od 4 člana.` with no month clause | N/A |
| Next month | date 03.11. | the month clause says `u studenome`; it counts 03.–30.11. | N/A |
| Moved off by override | an override took the member off one B shift in range | that shift is not counted in `k` | N/A |
| Duty split by month end | a duty whose first shift is on the month's last day and whose next leg is dated the 1st | counts 1 (only the in-range legs are grouped) | N/A |
| Past date | date before the offer's minimum | no line; button still dated | N/A |
| Reactivation line | reactivation dialog with a date | no consequence line | N/A |
| No team | member has no team on the date | question only; button still repeats the date | N/A |
| Snapshot pending or failed | calendar read not ready | question only | no alert, save allowed |
| Empty or bad date | field cleared | no question and no line (as shipped); button `Deaktiviraj` | N/A |
| Reactivation | dialog for a reactivation | shipped copy and button unchanged | N/A |

## Epic AC Deviations

- AC3 is delivered here. The question keeps the shipped sentence and adds the numbers line. The mockup's hint under the date (*Najranije danas…*) is not part of the AC and is not added.
- AC1, AC2 and AC4 shipped in 7.13a and 7.13b. This spec updates only the docs it changes.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/members/services/member-erasures.ts` :~170 `memberChangeSnapshotOf(calendar, change, today)` -- the canonical "after"; `MEMBER_CHANGE_STATUS`. Read only.
- `apps/web/src/features/calendar/utils/month.ts` :898 `memberScheduleInputOf(snapshot, {memberId, memberships, statuses})`; :156 `workingShiftTypeIdsOf`. Calendar's `FEATURE_PUBLIC` (eslint.config.js :135-149) already allows `services/snapshot` and `utils/month`; add members to the `utils/month` consumer comment.
- `packages/domain` -- `membershipOn`, `shiftRoster` (roster.ts :122, :137), `memberScheduleOfMonth`, `monthOf` (schedule.ts :277, :120). Read only.
- NEW `apps/web/src/features/members/services/deactivation-consequence.ts` (+ `.test.ts`) -- `deactivationConsequenceOf(snapshot, memberId, day, today)` returns `{team, members, total, month, shifts} | null`.
- `apps/web/src/features/members/hooks/use-member-edit.ts` -- add `useQuery(calendarQueryOptions(...))` exactly as `use-member-leave.ts:236-242`, read via `calendarSurfaceStateOf`. Expose `statusDialog.consequence`, memoised on snapshot, member, `statusDialog.day` (:1533-1545) and `today` (:349).
- `apps/web/src/features/members/components/member-status-card.tsx` -- the prompt :222-232 gains the line in the same described element; the submit button :282 uses the dated key for DEACTIVATE.
- `apps/web/src/features/members/services/wire.ts` :190 `statusActionMessageKey` (re-exported write.ts :2048) -- add a dated-action key helper beside it.
- `apps/web/src/utils/filter-bar.ts` :377 `monthInMessageKey`; `apps/web/src/lib/i18n/format.ts` :356 `formatIsoDayMonth`.
- `apps/web/src/lib/i18n/locales/hr.json` :743-766 `ljudi.status` -- add `deactivateConsequence`, `deactivateConsequenceTeam` and `deactivateActionFrom`. Precedent for plurals: :132.
- `apps/web/src/pages/prijava.test.ts` -- `MEMBER_EDIT` set :277-290 (add the new service if a sweep requires it); the member write rules strings count (61 → 64); `KEY_SOURCES`/`SCREENS` lengths :3551/:3505 only if a source is added.
- `apps/web/src/features/members/services/write.test.ts` :1952-1988, :2288 -- status key tests.
- e2e `e2e/pages/people.page.ts` :400 `deactivateSaveButton` matches *Deaktiviraj* exactly. It becomes a regex `^Deaktiviraj od \d\d\.\d\d\.$` or a date-aware locator. Callers: people.spec :278, :332, :683; member-erasures.spec :192, :481, :496; the `deactivate()` helper ~:415.
- Docs: `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md` :102, :141; `epics.md` :141.

## Tasks & Acceptance

**Execution:**
- [x] `services/deactivation-consequence.ts` + `.test.ts` -- the pure computation and every row of the matrix (also: a member deactivated with another member already inactive; a domain throw → `null`) -- one rule, executed by node
- [x] `services/wire.ts` / `write.ts` + `write.test.ts` -- the dated deactivate action key -- copy rule
- [x] `hooks/use-member-edit.ts` -- observe the calendar and expose `consequence` -- wiring
- [x] `components/member-status-card.tsx` -- the line and the dated button -- surface
- [x] `hr.json`, `prijava.test.ts`, `eslint.config.js` comment -- keys and sweeps
- [x] e2e page object and specs -- the dated button; a member-erasures.spec case asserting the numbers line for a seeded member at 1280 and 390 -- churn and coverage
- [x] EXPERIENCE.md, epics.md, `deferred-work.md`, `epic-7-context.md`, sprint-status -- docs

**Acceptance Criteria:**
- Given an admin deactivating an active team member, when a date is entered, then the dialog states the team's size before and after and the shifts left that month, and the button repeats the date.
- Given 390 px, when the dialog shows the line, then there is no horizontal scroll and the button stays at least 44 px.
- Lint (including feature boundaries), typecheck, and unit and e2e tests pass.

## Spec Change Log

- 2026-10-10, review loop 1 (intent gap): the mockup's "7 smjena" counts 24 h duties, while the code counted each working shift (13 for 05.10. on the fixture). The human chose duties and chose not to exclude leave days; the frozen `k` rule and matrix were amended. Also patched: no line for a date before the offer's minimum; a node test that a reactivation never gets a line; DESIGN.md Dialog row; the hook comment's `use-member-leave` path; e2e negative modulo and the no-team assertion waiting for the calendar. KEEP: the pure `deactivationConsequenceOf` shape, the "after" from `memberChangeSnapshotOf`, the hr.json keys and plurals, the dated button, the e2e case in member-erasures.spec, the resource-hygiene exception.

## Design Notes

`n` comes from the "after" snapshot, not `m − 1`. Both give the same number today, but the "after" is the one rule the erasure guard already trusts, and it stays right if a status rule changes.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm --filter ./apps/web test` -- expected: all green
- `pnpm e2e` (people, member-erasures, responsive) -- expected: green at 1280 and 390

## Suggested Review Order

**The consequence rule**

- Entry point: one pure function — team, roster before/after, duties left in the month.
  [`deactivation-consequence.ts:49`](../../apps/web/src/features/members/services/deactivation-consequence.ts#L49)

- "After" is the erasure guard's own recipe, never a second one.
  [`deactivation-consequence.ts:70`](../../apps/web/src/features/members/services/deactivation-consequence.ts#L70)

- Duties: in-range legs grouped by the domain's `dutiesOf`; a lone shift counts once.
  [`deactivation-consequence.ts:97`](../../apps/web/src/features/members/services/deactivation-consequence.ts#L97)

- A member not on that day's roster gets no line, never "4 od 4".
  [`deactivation-consequence.ts:103`](../../apps/web/src/features/members/services/deactivation-consequence.ts#L103)

- What the dialog may show: deactivation only, valid date, not before the minimum.
  [`deactivation-consequence.ts:126`](../../apps/web/src/features/members/services/deactivation-consequence.ts#L126)

- Shift times lifted out of Danas so both read one derivation.
  [`month.ts:894`](../../apps/web/src/features/calendar/utils/month.ts#L894)

**Wiring and surface**

- The dialog holds the snapshot it opened on; a re-read never redraws it.
  [`use-member-edit.ts:464`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L464)

- Calendar observed under the leave card's key: no extra request.
  [`use-member-edit.ts:329`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L329)

- The line in a polite live region inside the described prompt.
  [`member-status-card.tsx:253`](../../apps/web/src/features/members/components/member-status-card.tsx#L253)

- The final button repeats the date while the field holds one.
  [`member-status-card.tsx:315`](../../apps/web/src/features/members/components/member-status-card.tsx#L315)

- Copy: plurals for members and duties, verb agreeing with the count.
  [`hr.json:756`](../../apps/web/src/lib/i18n/locales/hr.json#L756)

**Peripherals**

- Unit: matrix rows, duty grouping, the shown-line guard.
  [`deactivation-consequence.test.ts:149`](../../apps/web/src/features/members/services/deactivation-consequence.test.ts#L149)

- Key helpers for the dated button and the month clause.
  [`wire.ts:201`](../../apps/web/src/features/members/services/wire.ts#L201)

- Hygiene: `smjena` here counts duties, not a shift type.
  [`resource-hygiene.test.ts:2058`](../../test/resource-hygiene.test.ts#L2058)

- Danas now reads its legs through `shiftLegOn`.
  [`today-duty.ts:18`](../../apps/web/src/features/today/services/today-duty.ts#L18)

- EXPERIENCE.md: the confirmation bullet with the numbers line.
  [`EXPERIENCE.md:141`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L141)
