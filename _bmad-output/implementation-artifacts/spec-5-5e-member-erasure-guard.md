---
title: 'A member team or status change cannot quietly erase a pending conflict (5.5e)'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: 'ee32e7663086b6a0f82ae6c164d2605a7813fc83'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-5b-roster-erasure-guard.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On the member page, an admin can make a member on leave stop being rostered: by moving them to another team or to no team, by deactivating them, or by withdrawing a scheduled move or reactivation. Each of these makes the member's unresolved leave conflicts vanish without anyone deciding them.

**Approach:** Guard the team card's and the status card's writes with 5.5b's shared erasure pieces. The flow follows 5.5b's removal: the card's existing confirmation runs the check, and only when something would be erased does the erasure dialog follow. A change that erases nothing writes as it does today.

## Boundaries & Constraints

**Always:**
- **Same rules as 5.5a/5.5b.**
  - The diff is `erasedCollisionsOf` from the change's date.
  - Added collisions never block.
  - Each erasure is a row with "Potvrdi brisanje" / "Zadrži", ordered by date and then team.
  - The save stays `aria-disabled` until every row is confirmed. Confirming re-derives the list, and a changed list is shown again, undecided.
  - If the check cannot be derived, the write is refused with "Pokušaj ponovno".
  - Nothing new is written. A landed write also refreshes the organization's leave records and resolutions.
- **"After" (human, 2026-10-04, 5.5b pattern).** Only the target member in `calendar.members` changes. `from` is the change's day.
  - Move: append `{teamId | null, position, effectiveFrom: day}` to the member's memberships.
  - Team withdraw: remove the scheduled version.
  - Deactivate or reactivate: append `{active, effectiveFrom: day}` to the member's statuses.
  - Status withdraw: remove the scheduled version.
- **Refused before deriving.** Judge these against the fresh snapshot. When one applies, the check answers `refused` and goes straight to the write's own refusal path:
  - a version already dated `day`;
  - the scheduled version is gone;
  - the target team is missing or archived.
  
  Any other fault answers `unavailable`.
- **A move to another working team still blocks (human, 2026-10-04).** It erases the old team's key even though it adds a new one.
- **Row text.** "{member} na godišnjem · nakon promjene: {team} taj dan bez {member}". This is used for a move, a deactivation and a withdraw. The team here is the team the conflict was on.
- **Dialog.**
  - It is the shared `<ErasureDialog>`, opened after the card's own confirmation closes. The confirmation's subject travels with the erasure dialog, so a later re-check still has it.
  - "Natrag na uređivanje" returns to the card. Focus goes to the card's offer button, or to the date field if the button has gone.
  - The row list scrolls inside the dialog, because a deactivation can erase many rows. There is no page scroll and no horizontal scroll at 390 px.
- Changes that only add or only reposition run no check: a reactivation, withdrawing a scheduled deactivation, and a position-only change.
- Every string goes through `t()`. Update the UX docs and AD-5's "as shipped" line.

**Ask First:**
- Any migration or server-side check.
- Checking the last-admin rule before the dialog.

**Never:**
- No guard on shift-type overrides (5.5f) or on rotation cancel (5.5g). No change to resolution lifetime (5.5d).
- No change to the cards' existing preflights, refusal messages or confirmation copy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Move away | Mirela (Smjena C) on leave +4 (Dan); move to Smjena B from tomorrow | confirm → erasure dialog, 1 row "… Smjena C taj dan bez Mirela…"; confirm → moved, queue −1 | N/A |
| Deactivate | Mirela on leave +4 and +5 (both working) | 2 rows; confirm → inactive; queue −2 | N/A |
| No team | move Mirela to no team | 1 row; same flow | N/A |
| Withdraw move-in | scheduled move onto Smjena C, leave on a working day after it | withdraw → 1 row | N/A |
| No erasure | deactivate a member with no leave | writes as today | N/A |
| Only adds | reactivation, or position-only change | no check; writes as today | N/A |
| Resolved | Mirela's +4 conflict was accepted | no dialog | N/A |
| Date taken | a version already dated day | the card's existing refusal, no dialog | existing |
| Keep | row "Zadrži" | locked; back keeps the card's inputs | N/A |
| Read failed | resolutions read 500 | refusal + retry in the card; nothing written | refusal |
| Many rows | 12 erasures at 390 px | list scrolls in the dialog; no horizontal scroll | N/A |

## Epic AC Deviations

- **NARROWED:** "a rotation, roster or membership change". 5.5e covers the member page's team and status writes. Shift-type overrides are 5.5f and rotation cancel 5.5g, both in `deferred-work.md`.
- **INTERPRETED:** "surfaced in the rotation save confirmation dialog". The shared dialog opens after the card's own confirmation (human, 2026-10-04).
- **DEFERRED:** the sticky save bar is 5.5c, already in `deferred-work.md`.

</frozen-after-approval>

## Code Map

Paths are under `apps/web/src` unless they say otherwise.

- **Shared pieces** (reuse them as they are):
  - `features/conflicts/services/erasures.ts`: `erasuresOf`, `recheckOf` and the row parts;
  - `services/erasure-check.ts`: `checkedOf`;
  - `hooks/use-erasure-reads.ts`: `readAndShare`;
  - `hooks/use-erasure-confirmation.ts` and `components/erasure-dialog.tsx`.
  
  If the list needs to scroll inside the dialog, make that change in `erasure-dialog.tsx` and keep the rotation and calendar layouts intact.
- **Model:** `features/calendar/services/roster-erasures.ts` (`rosterChangeSnapshotOf`, the explicit refused checks) and `features/calendar/hooks/use-roster-form.ts` (`removeChange` and `confirmErasures`: the discriminated subject, the refused, unavailable and changed paths, and focus fallbacks).
- **New:** `features/members/services/member-erasures.ts` (and test). It holds the after-builder and the check for the five changes. Version types are at `packages/domain/src/roster.ts:27-41`. `orderedVersions` throws on a duplicate `effectiveFrom`, which is why "date taken" must be judged first. `CalendarMember` is at `calendar/services/snapshot.ts:234`.
- **Writes.** `features/members/hooks/use-member-edit.ts`:
  - team: `armTeam` :301, `changeTeam` :381;
  - status: `armStatus` :455, `changeStatus` :499;
  - state :182-202;
  - standing confirmations :261/:277.
  
  `services/write.ts`: `changeMemberTeam` :1842 and `changeMemberStatus` :1170, with their failure mappers at :1772/:1095, stay as they are. The inner writers (`writeTeam` / `writeStatus`) are split out in `use-member-edit.ts`, as 5.5b split `writeSave` / `writeRemoval` in its hook.
- **Cards.** `components/member-team-card.tsx` (ConfirmDialog :272-323, offer :253) and `components/member-status-card.tsx` (:169-217, offer :150). Focus with `utils/focus-later`.
- **Dependents.** In `features/teams/services/dependents.ts`, `MEMBERSHIP_WRITE_DEPENDENTS` :65 gains the leave and resolutions keys, or use a member-erasure list. Update the test too.
- **Registries.**
  - `lib/i18n/locales/hr.json`: a new `ljudi.erasures.*` block (or within `smjene.membership` / `ljudi.status`), modelled on `kalendar.detail.rosterChange.erasures.*`.
  - `test/resource-hygiene.test.ts`.
  - `pages/prijava.test.ts`:
    - `MEMBER_EDIT` :224;
    - member-edit controls :668 and strings :2563;
    - `IN_FLIGHT_HANDLERS` :963 (status :984, team :997), with `writers`, and the count at :6485.
  - `features/conflicts/conflicts-screen.fixture.ts` exempt notes, and the conflicts list in `eslint.config.js` :139.
- **e2e.**
  - `e2e/pages/people.page.ts`: `deactivateButton` :116, the move and withdraw helpers :139-153, `moveToTeam` :307. Add a status confirm helper.
  - `e2e/pages/erasure-dialog.ts`.
  - Seeding: `e2e/utils/database-helper.ts` (`seedLeaveMember` :256 dates its membership today, so a move's earliest day is tomorrow; `seedLeaveRecord` :365, `seedExtraTeam` :934, `seedTeamRotation` :781, `holdRotation` :562).
  - The setup to copy is in `e2e/tests/calendar/calendar-roster-erasures.spec.ts` :100-120.

## Tasks & Acceptance

**Execution:**
- [x] `features/members/services/member-erasures.ts` and its test -- the after-builder for the five changes, the refused checks, and the check. Cover every matrix row except Keep, Read failed and Many rows.
- [x] `features/members/hooks/use-member-edit.ts` -- the inner writers `writeTeam` / `writeStatus`, the check in `changeTeam` / `changeStatus`, and `confirmTeamErasures` / `confirmStatusErasures`, following 5.5b. `services/write.ts` is unchanged.
- [x] Cards and the shared dialog (internal scroll) -- the erasure dialog after each card's confirmation, with focus fallbacks.
- [x] `dependents.ts` and its test, `hr.json`, and the registries.
- [x] `e2e/` -- add `e2e/tests/people/member-erasures.spec.ts` covering:
  - Move away by keyboard (queue −1);
  - Deactivate with 2 rows;
  - No erasure;
  - Keep;
  - Read failed;
  - Many rows at 390 px.
  
  The rotation and calendar erasure specs must still pass.
- [x] Docs -- the UX docs and the AD-5 line. `sprint-status.yaml`: 5-5e. Mark the 5.5e ledger entry resolved.

**Acceptance Criteria:**
- Given the member page, when the admin deactivates a member on leave using only the keyboard, then the card's confirmation leads to the erasure dialog with focus on the first "Potvrdi brisanje", and the write lands once all rows are confirmed.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (shared stack, no `db:reset`)
- `pnpm exec playwright test people rotation calendar conflicts` -- expected: green

## Suggested Review Order

**The member's "after"**

- Entry point: only the target member's versions change; refused cases are judged on the fresh snapshot first.
  [`member-erasures.ts:166`](../../apps/web/src/features/members/services/member-erasures.ts#L166)

- Which changes are checked at all: position-only and reactivation only add.
  [`member-erasures.ts:105`](../../apps/web/src/features/members/services/member-erasures.ts#L105)
  [`member-erasures.ts:136`](../../apps/web/src/features/members/services/member-erasures.ts#L136)

**The guard on the cards' writes**

- Team: the card's confirm runs the check; refused stays local; erasures open the dialog.
  [`use-member-edit.ts:524`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L524)
  [`use-member-edit.ts:603`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L603)

- Dialog save: re-check, history comparison, changed or unavailable paths, then the write.
  [`use-member-edit.ts:633`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L633)

- Status mirrors it.
  [`use-member-edit.ts:808`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L808)
  [`use-member-edit.ts:907`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L907)

- The shared dialog's optional inner scroll for long lists.
  [`erasure-dialog.tsx:59`](../../apps/web/src/features/conflicts/components/erasure-dialog.tsx#L59)

**Tests**

- e2e: move and deactivate by keyboard, keep, read failed, many rows, withdraw, changed, re-check unavailable.
  [`member-erasures.spec.ts:109`](../../e2e/tests/people/member-erasures.spec.ts#L109)
  [`member-erasures.spec.ts:173`](../../e2e/tests/people/member-erasures.spec.ts#L173)
  [`member-erasures.spec.ts:388`](../../e2e/tests/people/member-erasures.spec.ts#L388)
