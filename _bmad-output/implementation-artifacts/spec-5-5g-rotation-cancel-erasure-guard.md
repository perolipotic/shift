---
title: 'Cancelling a scheduled rotation cannot quietly erase a pending conflict (5.5g)'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: 'ea6261a73cbc10e7b9361516b9822911d4c154f6'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-5a-rotation-erasure-guard.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Cancelling a scheduled rotation version reverts its dates to the previous version and brings back into force the overrides that the cancelled stamp had made pending. A conflict that only the scheduled version caused, or one that a returning override clears, then disappears without a decision. 5.5a guards the save, not the cancel.

**Approach:** Guard the cancel with the shared erasure pieces. The cancel's own confirmation runs the check. Only when something would be erased does a separate erasure dialog follow. A successful cancel also refreshes the calendar, leave and resolutions, which it does not do today.

## Boundaries & Constraints

**Always:**
- **Same rules as 5.5a/5.5b.**
  - The diff runs from the scheduled date.
  - Added collisions never block.
  - The dialog has one row per erasure, with "Potvrdi brisanje" / "Zadrži".
  - The save is `aria-disabled` until every row is confirmed.
  - Confirming re-derives the rows. A changed list is shown again with every row undecided.
  - If the diff cannot be derived, the cancel is refused with "Pokušaj ponovno".
  - Nothing new is written.
- **"After"** is the calendar snapshot without the `assignments` and `assignmentStamps` dated the scheduled date, for active teams only. Archived teams keep theirs, as the delete does. Steps stay. No new stamp is added, because the previous version governs from then on.
  - The check also reads the rotation fresh.
  - If the active team sets differ, or the calendar's count of scheduled versions differs from the rotation's, the result is unavailable.
- **Refused before deriving.** `today` is taken once at the press. If the fresh rotation has no scheduled date, or a different one from the confirmed date, the check is skipped and the existing STALE path runs.
- **Flow (human, 2026-10-05, 5.5b pattern).**
  - The cancel's `ConfirmDialog` confirm runs the check.
  - If there are rows, the confirmation closes and the erasure dialog opens. It uses its own `useErasureConfirmation` instance, separate from the save's.
  - "Natrag na uređivanje" closes it. Focus returns to the cancel offer, falling back to Spremi.
  - The dialog's save re-checks and then cancels, using the check's rotation and `today`.
  - It shares the `saving` / `pending` guard with the save.
- **Row text.** This is a new `rotation.builder.cancelScheduled.erasures.*` block:
  - row: "{member} na godišnjem · nakon poništavanja: {team} taj dan slobodna" or "… taj dan bez {member}";
  - lede ending "Prije poništavanja odluči za svaki.";
  - kept hint: "Zadržan konflikt: odustani od poništavanja.";
  - the dialog's save label is the existing cancel confirm label.
- The done Notice adds "Uklonjen N konflikt." when rows were confirmed.
- After a landed cancel, refresh with `refreshAfterWrite(ROTATION_KEY, <calendar, leave, resolutions>)`.
- Every string goes through `t()`. Update the UX docs and AD-5's "as shipped" line.

**Ask First:**
- Any migration or server-side check.

**Never:**
- No change to the save's erasure flow or its strings (5.5a).
- No guard in the override review (5.5h).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plain revert | the scheduled version makes Mirela's leave day +4 a Dan; the previous version makes it Slobodno | confirm → erasure dialog, 1 row "… nakon poništavanja: … slobodna"; confirm → cancelled, queue −1 | N/A |
| Override returns | a Slobodno override written before the scheduled stamp, on a date where the scheduled version works and Mirela is on leave | listed | N/A |
| Roster returns | a take-off of Mirela written in that window | listed, "bez Mirela" | N/A |
| No erasure | the cancel changes no leave date | cancels in one click after the confirmation, as today | N/A |
| Stale | the scheduled date changed or passed | the existing STALE refusal, no dialog | existing |
| Archived team | an archived team holds a scheduled version | it is kept in "after" | N/A |
| Keep | row "Zadrži" | locked; back keeps the scheduled change | N/A |
| Read failed | resolutions read returns 500 | refusal + retry inside the cancel confirmation; nothing deleted | refusal |
| Refresh | landed cancel | the calendar and the queue reflect the revert without a reload | N/A |

## Epic AC Deviations

- **NARROWED:** "a rotation, roster or membership change". 5.5g covers cancelling a scheduled rotation. The override review is 5.5h, already in `deferred-work.md`.
- **INTERPRETED:** "surfaced in the rotation save confirmation dialog". The shared dialog follows the cancel's own confirmation (human, 2026-10-05).
- **DEFERRED:** the sticky save bar is 5.5c, already in `deferred-work.md`.
- **INTERPRETED:** "explicit confirm, amend or discard". A cancel has nothing to amend: confirm is "Potvrdi brisanje", and "Zadrži" followed by "Natrag" abandons the cancel, keeping the scheduled change (human, 2026-10-05).
- **NARROWED:** "only an erasure blocks". A cancel is also refused while its erasures cannot be checked (a failed or pending read, or calendar and rotation disagreeing), so nothing is deleted unchecked (human, 2026-10-05, AD-5).

</frozen-after-approval>

## Code Map

Paths are under `apps/web/src` unless they say otherwise. Line numbers as shipped (refreshed after the review patch).

- **Cancel flow.** `features/rotation/components/rotation-section.tsx`:
  - state: `cancelArmed` (the armed date) :301, the cancel's own `useErasureConfirmation` :332 (focus back to the landed notice, the offer, or Spremi), `cancelUnchecked` (the date that could not be checked) :341;
  - `settleCancel` :668 (the notice and the re-read: `refreshAfterWrite(ROTATION_KEY, ROTATION_CANCEL_DEPENDENTS)` when landed, `ROTATION_KEY` alone when stale);
  - `writeCancel` :702;
  - `cancelScheduled` :747 (the guarded confirm and retry: today once, check, show, refusal kept mounted until the retry settles);
  - `confirmCancelErasures` :819 (today taken again; a turned day or a refused re-check is STALE with nothing deleted; the dialog stays open, busy, until the write settles);
  - `renderCancelConfirmation` :1426 (the refusal and retry inside it), `renderCancelErasures` :1579;
  - `cancelShown` and the disarm effect :1631 (never armed with no confirmation rendered; focus to Spremi);
  - the offer :1675 and the Notices :1712.

  The save's erasure wiring is at `requestSave` :553 and `confirmErasures` :620; `saveButton` :309.
- **Write.** `features/rotation/services/write.ts`: `cancelScheduledRotation` :496 (STALE when the date differs or the row count mismatches), `rotationCancelMessageKey` :560, `ROTATION_CANCELLED_MESSAGE_KEY` :582. The scheduled date comes from `rotationScheduledDateOf` in `list.ts:653`.
- **"After".** `features/rotation/services/erasures.ts`: `draftCalendarSnapshotOf` :46, `sameActiveTeamsOf` :77 (shared with the save), `cancelledCalendarSnapshotOf` :146, `rotationCancelErasuresOf` :188 (the team-set check, and the scheduled versions compared by team, pattern, offset step and anchor). `erasuresOf` is at `conflicts/services/erasures.ts:153`.
- **Check.** `features/rotation/services/erasure-check.ts`: `cancelErasureCheckOf` :98. `hooks/use-erasure-check.ts`: `useCancelErasureCheck` :42, over the same four fresh reads as the save's.
- **Dependents.** `features/teams/services/dependents.ts`: `ROTATION_SAVE_DEPENDENTS` :163 and its cancel twin `ROTATION_CANCEL_DEPENDENTS` :177 (+ `dependents.test.ts`).
- **Registries.**
  - `pages/prijava.test.ts`: rotation builder controls 18 :801 and strings 94 :2215; the dependents assertions :5018 (`refreshAfterWrite(` twice) and the cancel assertions :5159 (`cancelScheduled`, `writeCancel`, `settleCancel`, `confirmCancelErasures`); `.delete()` count 2.
  - `test/resource-hygiene.test.ts`: plurals :121, screen keys :1107 (with why the cancel keeps its own block).
  - `lib/i18n/locales/hr.json` `rotation.builder.cancelScheduled` :723, with its `erasures` block.
- **e2e.**
  - `e2e/pages/rotation.page.ts`: `cancelScheduledOffer` :347, `cancelScheduledConfirm` :352, the save's erasure helpers from :456, the cancel's (`cancelErasures`, refusal, retry, done notice) from :514.
  - `e2e/tests/rotation/rotation-cancel-erasures.spec.ts`: keyboard + queue −1 without a reload :133, keep :198, read failed at the confirm :234, no erasure :262, changed list :288, read failed at the dialog's save :327, stale :356.
  - The existing cancel test is at `e2e/tests/rotation/rotation.spec.ts:372`.

## Tasks & Acceptance

**Execution:**
- [x] `features/rotation/services/erasures.ts` and its test -- the cancel "after" and its cross-checks. Cover Plain revert, Override returns, Roster returns, No erasure and Archived team.
- [x] `rotation-section.tsx` -- the guarded cancel: check, second confirmation instance, re-check, write, focus, refresh, removed count.
- [x] `dependents.ts` and its test, `hr.json`, and the registries (including the deliberate update of the cancel refresh assertions).
- [x] `e2e/tests/rotation/rotation-cancel-erasures.spec.ts` -- Plain revert by keyboard (queue −1), Keep, Read failed, No erasure, Refresh. The existing cancel and erasure specs still pass.
- [x] Docs -- the UX docs and the AD-5 line. `sprint-status.yaml`: 5-5g. Mark the 5.5g ledger entry resolved.

**Acceptance Criteria:**
- Given a scheduled change whose cancel erases a conflict, when only the keyboard is used, then the cancel confirmation leads to the erasure dialog with focus on the first "Potvrdi brisanje", and the cancel lands once every row is confirmed.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (shared stack, no `db:reset`)
- `pnpm exec playwright test rotation calendar conflicts` -- expected: green

## Suggested Review Order

**The cancel's "after"**

- Entry point: drop active teams' versions and stamps on the scheduled date; archived teams keep theirs.
  [`erasures.ts:146`](../../apps/web/src/features/rotation/services/erasures.ts#L146)

- Cross-checked by identity against the fresh rotation before diffing from the scheduled date.
  [`erasures.ts:188`](../../apps/web/src/features/rotation/services/erasures.ts#L188)

- Refused when nothing (or another date) is scheduled; unavailable offline or on any fault.
  [`erasure-check.ts:98`](../../apps/web/src/features/rotation/services/erasure-check.ts#L98)

**The guarded cancel**

- Press: today once, then the check; no rows cancels at once, rows open the dialog.
  [`rotation-section.tsx:747`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L747)

- Dialog save: fresh today, re-check, changed or stale or unavailable paths, then the write.
  [`rotation-section.tsx:819`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L819)

- The delete and the settle: refresh of calendar, leave and resolutions, removed count, focus.
  [`rotation-section.tsx:702`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L702)
  [`rotation-section.tsx:668`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L668)

**Tests**

- e2e: keyboard cancel, keep, read failed, no erasure, changed, re-check failed, stale.
  [`rotation-cancel-erasures.spec.ts:133`](../../e2e/tests/rotation/rotation-cancel-erasures.spec.ts#L133)
