---
title: 'Confirming or amending a pending override cannot quietly erase a pending conflict (5.5h)'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: '97049ccb95cb977596d48f82b5dfe30e8d394285'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-5f-override-erasure-guard.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In the rotation builder's override review (3.5c), confirming or amending a pending shift-type override puts it in force. When the override's type is non-working on a day the projection works, every member on that day's roster who is on leave loses their unresolved conflict, and no one decides them.

**Approach:** Guard confirm and amend with the shared erasure pieces and 5.5f's `overrideErasureCheckOf`. Follow the calendar override form's flow. Move the review's logic into a hook so the component stays a renderer. Discard stays unguarded.

## Boundaries & Constraints

**Always:**
- **Same rules as 5.5f.**
  - The diff runs from the override's date.
  - Each erasure is a row with "Potvrdi brisanje" / "Zadrži". The save stays `aria-disabled` until every row is confirmed.
  - Confirming re-derives the rows. A changed list is shown again with every row undecided.
  - If the check cannot be derived, the write is refused with "Pokušaj ponovno". Nothing new is written.
  - The dialog is the shared `ErasureDialog` with `scrollRows`.
- **Order.**
  1. The existing `governed` refusal from `rowOffersOf`.
  2. For amend only, the `amendEntryOf` preflight, which refuses inside the amend dialog with no check.
  3. The check, using the change `{confirm | amend, overrideId: row.id, shiftTypeId}`. The override is matched by id in the fresh calendar.

  How refusals and the check's outcome are handled:
  - `gone` and `archived` take the review's existing stale path: re-read, close, and say it in the review.
  - `sameAsProjected` stays in the amend dialog, with focus on the type field.
  - `taken` is logged and handled as `failed`.
  - Unavailable shows a refusal with a retry: in the review for confirm, inside the amend dialog for amend.
- **Confirm (human, 2026-10-05, 5.5f pattern).** A confirm that erases nothing stays one click. If it erases, the erasure dialog opens. "Natrag na uređivanje" returns focus to that row's confirm button, or to the review heading.
- **Amend.** The amend dialog's submit runs the check. When there are rows, the amend dialog closes with the entered type and reason captured, and the erasure dialog opens. "Natrag na uređivanje" reopens the amend dialog with the entered values restored.
- **Row text.** Use a new `rotation.builder.overrides.erasures.*` block: "{member} na godišnjem · nakon promjene: {team} taj dan slobodna". The done notice adds "Uklonjen N konflikt." when rows were confirmed.
- **Refresh.** A landed confirm or amend uses `refreshAfterWrite(ROTATION_KEY, ROTATION_SAVE_DEPENDENTS)`, which refreshes the calendar, the organization leave and the resolutions. Refusals keep re-reading `ROTATION_KEY`.
- **Self-contained.** All logic lives in the review and a new hook (`features/rotation/hooks/use-override-review.ts`), never in `rotation-section.tsx`. The review component reads no query directly.
- Every string goes through `t()`. Update the UX docs and the AD-5 "as shipped" line.

**Ask First:**
- Any migration or server-side check.

**Never:**
- Discarding a pending override is never guarded (human, 2026-10-05).
- No change to the rotation save or cancel flows, or to the calendar override form.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Confirm erases | pending Slobodno override on Smjena C +4; Mirela on leave +4, projected Dan | confirm → dialog, 1 row "… taj dan slobodna"; confirm all → confirmed, queue −1 | N/A |
| Confirm working | pending Noć override on a Dan day | one click, as today | N/A |
| Amend erases | pending Noć override amended to Slobodno, leave that day | amend submit → dialog; back restores Slobodno + reason; confirm → amended | N/A |
| Amend preflight | amend to the projected type | existing refusal in the amend dialog, no check | existing |
| Gone | override removed meanwhile | stale path: re-read, said in the review | existing |
| Archived | type archived meanwhile | stale path | existing |
| Resolved | Mirela's +4 conflict was accepted | no dialog | N/A |
| Keep | row "Zadrži" | locked; back as above | N/A |
| Read failed | resolutions read returns 500 | retry (review for confirm, amend dialog for amend); nothing written | refusal |
| Discard | discard a pending override | unchanged, no check | N/A |

## Epic AC Deviations

- **NARROWED:** "a rotation, roster or membership change". 5.5h covers the override review's confirm and amend. Discard is unguarded because a pending override is not applied (human, 2026-10-05).
- **INTERPRETED:** "surfaced in the rotation save confirmation dialog". The shared dialog follows the review's own action (human, 2026-10-05).
- **DEFERRED:** the sticky save bar is 5.5c, already in `deferred-work.md`.
- **INTERPRETED:** "explicit confirm, amend or discard". Each row offers "Potvrdi brisanje" / "Zadrži"; amend is "Zadrži" then "Natrag na uređivanje" back to the amend, and discard stays the review's own unguarded action (human, 2026-10-05).
- **NARROWED:** "only an erasure blocks". A confirm or amend is also refused while its erasures cannot be checked, so nothing is written unchecked (human, 2026-10-05, AD-5).

</frozen-after-approval>

## Code Map

Paths are under `apps/web/src` unless they say otherwise.

- **The review today.** `features/rotation/components/override-review.tsx`:
  - props :77-88;
  - state :89-114;
  - `reread()` :124-130;
  - `dispose()` :137-188;
  - confirm :243-245;
  - amend `arm` :190, `submitAmend` :207-216, `renderAmend` :280-362 (uncontrolled `defaultValue` from `amendDefaultsOf`; extend `Armed` with optional `entered`);
  - discard :365-409.

  It is mounted at `rotation-section.tsx:1451`.
- **Disposition.** `features/rotation/services/override-disposition.ts`: `PendingOverrideRow` :82-103 (`governed` :138, `options` :139), `rowOffersOf` :212, `amendEntryOf` :240-251, `dispositionFailureOf` :291-298, and the writes :330/:341.
- **Shared pieces.**
  - `features/conflicts/services/override-erasures.ts`: `overrideErasureCheckOf`, the change kinds, and the refusals. Match by id at :177; archived at :189.
  - `hooks/use-erasure-reads.ts` `readAndShare`, `hooks/use-erasure-confirmation.ts`, `components/erasure-dialog.tsx`.
  - Model: `features/calendar/hooks/use-override-form.ts` :386-695.
  - `utils/focus-later.ts` `firstEnabledOf`.
- **Dependents.** `features/teams/services/dependents.ts:163` `ROTATION_SAVE_DEPENDENTS`.
- **Registries.**
  - `pages/prijava.test.ts`:
    - review assertions :5174-5197 (no `useQuery(`, only `ROTATION_KEY` query keys, `invalidateQueries({ queryKey: ROTATION_KEY })`, no `@shift/domain`, latch and finally). Update them deliberately to read the review as the set component + hook.
    - review controls 9 at :803 and strings 26 at :2238;
    - the AD-7 sweep :5081;
    - `IN_FLIGHT_HANDLERS` (optional).
  - `test/resource-hygiene.test.ts` (plural keys ~:108, screen keys ~:1149) and `test/localization-applied.test.ts:566`.
  - `eslint.config.js` `FEATURE_PUBLIC.conflicts` comment.
  - `features/conflicts/conflicts-screen.fixture.ts` ~:70.
  - `rotation/utils/element-ids.ts` (new dialog id, per-row confirm ids).
- **e2e.**
  - `e2e/pages/rotation.page.ts` review helpers :355-424, plus erasure helpers modelled on `e2e/pages/calendar.page.ts`.
  - The 3.5c test is `e2e/tests/rotation/rotation.spec.ts:653`.
  - Seeding: `seedShiftTypeOverride(rotation, team, D, 2, reason)` gives a Slobodno override, and `seedRotationChange` makes it pending (`e2e/utils/database-helper.ts:932/:1134`). Hold the rotation lock with `holdRotation`.
  - The setup to copy is `e2e/tests/calendar/calendar-override-erasures.spec.ts:96-116, 478-501`.

## Tasks & Acceptance

**Execution:**
- [x] `features/rotation/hooks/use-override-review.ts` -- the latch, the check, confirm and amend handlers, `confirmReviewErasures`, unavailable/retry, focus, refresh. `override-review.tsx` renders it.
- [x] Node tests for the pure parts (the row → change mapping and the refusal → disposition code mapping). Cover every matrix row except Keep and Read failed, at unit or helper level.
- [x] `hr.json` and the registries, including the deliberate update of the review assertions in `prijava.test.ts`.
- [x] `e2e/tests/rotation/rotation-override-erasures.spec.ts` -- Confirm erases by keyboard (queue −1), Amend erases with back restoring the fields, Confirm working in one click, Keep, Read failed, Discard unchanged. The 3.5c test and the other erasure specs still pass.
- [x] Docs -- the UX docs and the AD-5 line. `sprint-status.yaml`: 5-5h. Mark the 5.5h ledger entry resolved.

**Acceptance Criteria:**
- Given a pending Slobodno override over a member on leave, when the admin confirms it using only the keyboard, then the erasure dialog opens with focus on the first "Potvrdi brisanje", and the override is confirmed once every row is confirmed.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (shared stack, no `db:reset`)
- `pnpm exec playwright test rotation calendar conflicts` -- expected: green

## Suggested Review Order

**Mapping a review row to the shared check**

- Entry point: a row becomes a confirm or amend change; check refusals become the review's codes.
  [`override-review-erasures.ts:40`](../../apps/web/src/features/rotation/services/override-review-erasures.ts#L40)
  [`override-review-erasures.ts:55`](../../apps/web/src/features/rotation/services/override-review-erasures.ts#L55)

**The hook**

- One latch, the busy guard and the generation guard for every handler.
  [`use-override-review.ts:131`](../../apps/web/src/features/rotation/hooks/use-override-review.ts#L131)

- Confirm: governed refusal, then the check; no rows stays one click.
  [`use-override-review.ts:450`](../../apps/web/src/features/rotation/hooks/use-override-review.ts#L450)

- Amend: preflight in the dialog, then the check; entered values travel with the dialog.
  [`use-override-review.ts:506`](../../apps/web/src/features/rotation/hooks/use-override-review.ts#L506)

- Dialog save: re-check, changed list, unavailable or refused paths, then the write while busy.
  [`use-override-review.ts:580`](../../apps/web/src/features/rotation/hooks/use-override-review.ts#L580)

- Reopening the amend looks the row up again; gone or archived fall back safely.
  [`use-override-review.ts:290`](../../apps/web/src/features/rotation/hooks/use-override-review.ts#L290)
  [`use-override-review.ts:661`](../../apps/web/src/features/rotation/hooks/use-override-review.ts#L661)

**The renderer**

- The review now only renders; the shared dialog with scrollRows.
  [`override-review.tsx:407`](../../apps/web/src/features/rotation/components/override-review.tsx#L407)

**Tests**

- e2e: confirm by keyboard, amend with back, working confirm, keep, read failed, changed, gone, retry, discard.
  [`rotation-override-erasures.spec.ts:149`](../../e2e/tests/rotation/rotation-override-erasures.spec.ts#L149)
  [`rotation-override-erasures.spec.ts:214`](../../e2e/tests/rotation/rotation-override-erasures.spec.ts#L214)
