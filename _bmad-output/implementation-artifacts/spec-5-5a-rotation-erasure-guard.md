---
title: 'A rotation save cannot quietly erase a pending conflict (5.5a)'
type: 'feature'
created: '2026-10-03'
status: 'done'
baseline_commit: '9766323712640a38163e007b588e95fae8c4ae1a'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** "Spremi rotaciju" saves at once. A new rotation can make a member stop working on a leave date. The unresolved conflict then disappears from the queue, and nobody decided it.

**Approach:**
- One pure domain diff computes the unresolved collisions before and after the draft, bounded to the leave ranges from the draft's effective date onward.
- When the diff erases at least one, Spremi opens a confirmation dialog as in mockup `setup-1.html` §2. Each erased conflict gets its own row with "Potvrdi brisanje" / "Zadrži". The save waits until every row is confirmed.
- Nothing new is written. The conflict disappears because its cause does.

## Boundaries & Constraints

**Always:**
- **The diff (AD-5).**
  - "Before" is the calendar snapshot as read.
  - "After" is the same snapshot with:
    - the draft's steps;
    - one draft assignment per active team, with `effectiveFrom = draft.effectiveFrom`;
    - one assignment stamp per such team that is newer than all the others, so that shift-type and roster overrides on or after the effective date go pending, exactly as a real save makes them.
  - Leave records are clipped to `[max(from, effectiveFrom), to]`, and records ending before `effectiveFrom` are dropped.
  - Both sides use `unresolvedCollisionsOf` with the live resolutions. An erasure is a key in "before" that is absent from "after". Added collisions are never erasures and never block.
  - The bounding and the set difference live in `packages/domain/src/collisions.ts`, because Epic 7 reuses them.
- **Dialog (human, 2026-10-03, mockup).**
  - It opens only when the draft is not refused (`draftRefusalOf` is null) and the diff has at least one erasure. With no erasures, the save behaves exactly as today.
  - Title: "Promjena briše {count} konflikt(a)".
  - Lead: "Ova promjena uklanja uzrok {count} neriješenog konflikta. Prije spremanja odluči za svaki."
  - One row per erasure, ordered by date and then team. The row reads "{team} · {dan dd.mm.} · {type}" and then "{member} na godišnjem · nova rotacija: {team} taj dan slobodna". When the team still works that date, the second part ends "… taj dan bez {member}" instead.
  - Each row has two toggle buttons, "Potvrdi brisanje" and "Zadrži", using `aria-pressed`. Nothing is preselected.
  - Footer: "Natrag na uređivanje" closes the dialog and keeps the draft. "Spremi rotaciju" is `aria-disabled` until every row is confirmed. A row set to "Zadrži" keeps it disabled, and the hint reads "Zadržan konflikt: promijeni rotaciju ili se vrati na uređivanje."
  - The draft's rotation warnings also show in the dialog and never block.
- **Not derivable (human, 2026-10-03).** If the calendar, leave or resolutions read failed or is pending, or the diff throws, Spremi refuses with "Ne mogu provjeriti konflikte koje bi promjena izbrisala." and a "Pokušaj ponovno" button that re-reads them. Nothing is saved unchecked.
- **Freshness.**
  - Pressing Spremi re-fetches the three reads before computing.
  - Confirming re-derives the diff. If the erased set changed, the dialog re-shows with the new rows, all undecided.
  - A landed save also invalidates `CALENDAR_KEY`, the organization leave records and the resolutions.
- Every string goes through `t()`. In `rotation.builder.*`, "smjena" means the team. Update the UX docs, AD-5's line in the spine and UX-DR23 in the same PR.

**Ask First:**
- Any migration or server-side check.
- Recording who confirmed an erasure.

**Never:**
- No sticky save bar and no "Odbaci promjene" (5.5c). No roster or membership guard (5.5b). No change to resolution lifetime (5.5d).
- No diff computed over all future dates, and no blocking on warnings or on added collisions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Erases | Mirela on leave 06.–07.11., Smjena C works Dan 06., Noć 07.; draft makes both free | dialog with 2 rows; Spremi locked until both are confirmed; then it saves and the queue is −2 | N/A |
| No erasure | draft changes only dates without leave | saves at once, as today | N/A |
| Before effective | collision on a date before effectiveFrom | not in the diff | N/A |
| Resolved | resolved conflict on an erased date | not listed | N/A |
| Added | draft creates a new collision | no dialog for it; saves | N/A |
| Override pending | roster override that put Mirela on Smjena C goes pending | listed as erased | N/A |
| Keep | one row "Zadrži" | Spremi locked; "Natrag na uređivanje" returns with the draft intact | N/A |
| Changed meanwhile | a leave was added after the dialog opened | re-shown with the new rows | N/A |
| Read failed | leave read error | refusal + Pokušaj ponovno; nothing saved | refusal |
| Refused draft | EFFECTIVE_PAST etc. | today's refusal; no dialog | existing |

## Epic AC Deviations

- **INTERPRETED:** "explicit confirm, amend or discard". Confirm is "Potvrdi brisanje". Amend is "Zadrži", followed by "Natrag na uređivanje". Discarding the draft is 5.5c's "Odbaci promjene" (human, 2026-10-03, mockup).
- **NARROWED:** "a rotation, roster or membership change". This slice covers rotation only. Roster and membership are 5.5b, and the sticky save bar is 5.5c; both are in `deferred-work.md`.

</frozen-after-approval>

## Code Map

Paths are under `apps/web/src` unless they say otherwise.

- **Domain.** `packages/domain/src/collisions.ts`: `CollisionInput` :59, `collisionKeyOf` :86, `collisionsOf` :158 and `unresolvedCollisionsOf` :229. Add the clip and `erasedCollisionsOf`, with tests.
- **Schedule under a draft.** `features/rotation/utils/draft.ts`: `draftStepsOf` :96 and `draftAssignmentOf` :106. The latter sets `effectiveFrom: anchorDate`, so override it with `draft.effectiveFrom`. `draftRefusalOf` is at :816.
- **Collision input.** `features/conflicts/services/conflicts-queue.ts`: `collisionInputOf` :119 and `unresolvedOf` :164. The override standings come from `snapshot.assignmentStamps` (`features/calendar/utils/month.ts:100/136`, cached per snapshot object), which `overrideStandingOf` (`packages/domain/src/overrides.ts:187`) reads; it throws `RangeError` on a duplicate `(team, effectiveFrom)`. The row parts come from `conflicts-queue.ts:181-232`, `typeRangeOn` (month.ts:929) and `dayMonthOf` (:936).
- **Save flow.** `features/rotation/components/rotation-section.tsx`:
  - `save()` :342-420 (`savedToday` is taken at click time, and only `ROTATION_KEY` is invalidated, at :399);
  - the button :1104;
  - the `ConfirmDialog` pattern :1049-1086 (`components/ui/dialog.tsx:174`);
  - the warnings: `utils/warnings.ts:159/223`;
  - the draft store: `hooks/draft-store.ts:175`.
- **New reads** (as in `features/conflicts/hooks/use-conflicts-queue.ts:84-102`):
  - `calendarQueryOptions` (`calendar/services/snapshot.ts:947`);
  - `organizationLeaveRecordsQueryOptions` (`leave/services/leave-list.ts:438`);
  - `organizationConflictResolutionsQueryOptions` (`conflicts/services/resolutions.ts:202`).
  - The failure logic to copy is `queueReadFailed` (conflicts-queue.ts:274).
  - Add `ROTATION_SAVE_DEPENDENTS` to `features/teams/services/dependents.ts` (+ test).
- **Registries.**
  - `lib/i18n/locales/hr.json`: `rotation.builder` :615, plus a new `erasures` block.
  - `test/resource-hygiene.test.ts`: plurals :37/:76 and screen keys :145. Watch the "smjena = team" rule at :1351.
  - `pages/prijava.test.ts`: builder controls 16 :772, strings 64 :2100, `KEY_SOURCES` length 57 :2769, and the rotation source assertions :4863-5030.
  - `features/rotation/rotation.fixture.ts`.
- **e2e.**
  - `e2e/tests/rotation/rotation.spec.ts`: the 3.5c test :660-700 is the model (hold, seed, change, save).
  - `e2e/pages/rotation.page.ts`: `saveButton` :315 and `effectiveFromInput` :248.
  - `e2e/utils/database-helper.ts`: `holdRotation` :519, `seedTeamRotation` :738, `seedLeaveMember` :253, `seedLeaveRecord` :322, `seedConflictResolution` :368 and `removeRotationChangesOver` :1116.
- **Docs.**
  - `ux-shift-2026-09-02/EXPERIENCE.md:116`;
  - `architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md:84-88`;
  - `epics.md` UX-DR23 :135.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/collisions.ts` and its test -- the clip and `erasedCollisionsOf`.
- [x] `features/rotation/services/` (a new erasure service) and its test -- the after-snapshot from the draft, the erasures with their row parts, and the not-derivable state. Cover every matrix row except Changed meanwhile and Read failed.
- [x] `features/rotation/components/` -- the dialog, the row toggles, the hint, the refusal with retry, and the save branch in `rotation-section.tsx`, with the re-fetch and re-derive.
- [x] `features/teams/services/dependents.ts` and its test -- `ROTATION_SAVE_DEPENDENTS`.
- [x] `hr.json` and the registries.
- [x] `e2e/` -- a page object for the dialog, plus specs for: Erases (by keyboard, and the queue −2), Keep → back with the draft intact, No erasure saves at once, Read failed refuses.
- [x] Docs -- the UX docs, AD-5's spine line and UX-DR23. `deferred-work.md`: nothing to resolve beyond noting 5.5a. `sprint-status.yaml`: 5-5a.

**Acceptance Criteria:**
- Given the dialog, when only the keyboard is used, then focus starts on the first row's "Potvrdi brisanje", each toggle is reachable, and Spremi saves once all rows are confirmed.
- Given 390 px, when the dialog shows rows, then they wrap and there is no horizontal scroll.

## Design Notes

Why stamps matter: a real save makes every override on or after the effective date pending (`overrideStandingOf`). Without a matching stamp in the "after" snapshot, a roster override that rostered the member would still apply, and its erasure would be missed.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (shared stack, no `db:reset`)
- `pnpm exec playwright test rotation conflicts` -- expected: green

## Suggested Review Order

**The diff**

- Entry point: unresolved before minus unresolved after, from the effective date onward.
  [`collisions.ts:273`](../../packages/domain/src/collisions.ts#L273)
  [`collisions.ts:247`](../../packages/domain/src/collisions.ts#L247)

- The after-snapshot: draft versions plus a newer stamp, so later overrides go pending.
  [`erasures.ts:76`](../../apps/web/src/features/rotation/services/erasures.ts#L76)

- Rows: team still working is the team's own projection, not the viewer's.
  [`erasures.ts:130`](../../apps/web/src/features/rotation/services/erasures.ts#L130)

**The check**

- Four fresh reads; ready, refused or unavailable, and nothing saves unchecked.
  [`erasure-check.ts:`](../../apps/web/src/features/rotation/services/erasure-check.ts#L)
  [`use-erasure-check.ts:40`](../../apps/web/src/features/rotation/hooks/use-erasure-check.ts#L40)

**The save flow**

- One guard from the press to the write; refusals take today's path.
  [`rotation-section.tsx:522`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L522)

- Confirming re-derives; a changed list shows again, undecided, with a status line.
  [`rotation-section.tsx:590`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L590)
  [`erasures.ts:243`](../../apps/web/src/features/rotation/services/erasures.ts#L243)

- The dialog: rows with Potvrdi brisanje / Zadrži, warnings, the kept hint.
  [`rotation-section.tsx:1349`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L1349)

- The inner write uses the checked draft and today, and counts removed conflicts.
  [`rotation-section.tsx:452`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L452)

**Tests**

- e2e: keyboard confirm, keep, changed meanwhile, nothing erased, override pending, read failed.
  [`rotation-erasures.spec.ts:158`](../../e2e/tests/rotation/rotation-erasures.spec.ts#L158)
  [`rotation-erasures.spec.ts:277`](../../e2e/tests/rotation/rotation-erasures.spec.ts#L277)
  [`rotation-erasures.spec.ts:380`](../../e2e/tests/rotation/rotation-erasures.spec.ts#L380)
