---
title: 'A calendar roster change cannot quietly erase a pending conflict (5.5b)'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: 'ff08ee801c59d5b8b0dce0b0d9b22bb44f1c6a29'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-5a-rotation-erasure-guard.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An admin can take a member on leave off a day's roster in the calendar ("skini ga, na godišnjem je"), or remove an override that put that member on. Either way the unresolved conflict vanishes from the queue without a decision. 5.5a guards only the rotation save.

**Approach:**
- Lift 5.5a's guard out of the rotation builder into shared pieces: a surface-neutral diff service over an "after" snapshot, a three-read check, and a reusable erasure dialog with the same freshness loop.
- Guard both calendar roster-override writes with them: saving a change and removing one.
- The rotation builder uses the shared pieces with no change in behaviour.

## Boundaries & Constraints

**Always:**
- **Same rules as 5.5a.** These carry over unchanged:
  - Erased means unresolved before and absent after, with leave clipped from the change's date onward (`erasedCollisionsOf`, `leaveRecordsFrom`).
  - Added collisions and warnings never block.
  - The dialog has one row per erasure, ordered by date and then team, each with "Potvrdi brisanje" / "Zadrži" and nothing preselected.
  - "Spremi" stays `aria-disabled` until every row is confirmed. "Zadrži" shows the kept hint.
  - Saving re-fetches the reads. Confirming re-derives; a changed list re-shows undecided, with the changed status line.
  - Not derivable means the write is refused with "Ne mogu provjeriti konflikte koje bi promjena izbrisala." and "Pokušaj ponovno". Nothing new is written.
- **"After" for a roster override.**
  - A save appends `{id: synthetic, teamId, date, memberOutId, memberInId}` with a `createdAt` newer than every instant in the snapshot.
  - A removal filters that override out by id.
  - The diff range is `from = date`.
- **Shared check.**
  - The core reads are calendar, organization leave and resolutions, each fresh (`staleTime: 0`, `networkMode: 'always'`).
  - The rotation read stays an addition used only by the rotation builder. 5.5a's behaviour and tests stay green.
- **Row text (human, 2026-10-04).** Outside the rotation, the second part reads "{member} na godišnjem · nakon promjene: {team} taj dan bez {member}", or "… nakon promjene: {team} taj dan slobodna". The rotation keeps "nova rotacija: …".
- **Dialog (human, 2026-10-04).**
  - It is a separate dialog beside the day dialog, following the roster removal confirmation's pattern.
  - A roster save that erases nothing still saves in one click.
  - A removal goes through its existing confirmation first. Its confirm button runs the check, and on erasures the erasure dialog follows.
  - "Natrag na uređivanje" returns to the roster form with its inputs kept, or to the day dialog for a removal. After a close, focus returns to the control that opened it.
- After a guarded roster write lands, it also refreshes the organization leave and the resolutions, next to `CALENDAR_KEY`.
- Every string goes through `t()`. Update the UX docs and the AD-5 "as shipped" line to name the calendar roster as guarded.

**Ask First:**
- Any migration or server-side check.

**Never:**
- No guard on member, status, shift-type override or rotation-cancel writes (5.5e, 5.5f, 5.5g).
- Removing the override behind a `replace_member` erases nothing. Leave it to 5.5d.
- No change to 5.5a's rotation dialog behaviour or its strings.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Take off | Mirela on leave 06.11., on the Smjena C roster; save "Mirela out" | dialog, 1 row "… nakon promjene: Smjena C taj dan bez Mirela…"; confirm → saved, queue −1 | N/A |
| Remove put-on | override put Mirela (on leave) onto Smjena C 06.11.; remove it | removal confirm → erasure dialog, 1 row; confirm → removed | N/A |
| No erasure | take off a member who is not on leave | saves in one click | N/A |
| Resolved | Mirela's 06.11. conflict was accepted; take her off | no dialog | N/A |
| Remove take-off | remove an override that took someone off | no dialog (it only adds) | N/A |
| Replace link | remove the override behind a `replace_member` | no dialog | N/A |
| Keep | row "Zadrži" | Spremi locked; back keeps the form inputs | N/A |
| Read failed | resolutions read 500 | refusal + retry; nothing written | refusal |
| Rotation intact | 5.5a scenarios | unchanged behaviour | existing |

## Epic AC Deviations

- **NARROWED:** "a rotation, roster or membership change". 5.5b covers calendar roster overrides only. Members are 5.5e, shift-type overrides 5.5f and rotation cancel 5.5g, all in `deferred-work.md`.
- **INTERPRETED:** "surfaced in the rotation save confirmation dialog". Outside the rotation builder, the same dialog opens beside the surface's own form (human, 2026-10-04).

</frozen-after-approval>

## Code Map

Paths are under `apps/web/src` unless they say otherwise.

- **5.5a pieces to lift into a shared place.** A good home is `features/conflicts/services/erasures.ts` plus `hooks/` and `components/`. The pieces:
  - `features/rotation/services/erasures.ts`: `rotationErasuresOf` :130 (generalize to `erasuresOf(before, after, from, records, resolutions)` and keep the rotation team-set cross-check rotation-only), the row parts and `teamWorks`, and `sameErasuresOf` / decisions :195-269.
  - `services/erasure-check.ts` and `hooks/use-erasure-check.ts`: the 3-read core plus the optional rotation read.
  - `components/rotation-section.tsx`: `renderErasures` :1349, `ShownErasures`, `requestSave` :522 and `confirmErasures` :590. Extract an `<ErasureDialog>` and a freshness hook.
- **Instants.** Snapshot override `createdAt` values are ISO strings (`instantMicrosOf`). The synthetic override needs a "newer than everything" ISO instant. 5.5a's numeric `latest + 1` is at erasures.ts:82-100.
- **Roster writes.**
  - `features/calendar/components/roster-form.tsx`: submit :189 and the removal `ConfirmDialog` :274-313.
  - `hooks/use-roster-form.ts`: `saveRoster` :179, `openRemove` :246, `removeChange` :266 and the refresh :158.
  - `services/roster-write.ts`: :162 and :189.
  - Nested dialogs pattern: `day-detail-dialog.tsx:326`.
- **Collision input.** `features/conflicts/services/conflicts-queue.ts:119` and `rosterStandingOfCalendar` (`calendar/utils/month.ts:136`).
- **Dependents.** `features/teams/services/dependents.ts` and its test: a roster-write list with `CALENDAR_KEY`, organization leave and resolutions.
- **Registries.**
  - `lib/i18n/locales/hr.json`: `rotation.builder.erasures` :~720. Move the shared keys to a neutral namespace only if the hygiene rules allow it; otherwise add the calendar-side keys.
  - `test/resource-hygiene.test.ts`.
  - `pages/prijava.test.ts`: the Kalendar controls (`CALENDAR_SCREEN_PARTS`), the rotation builder counts, `KEY_SOURCES`, and the `use-erasure-check` `staleTime` assertion around :4880.
  - `features/calendar/calendar-screen.fixture.ts` and `features/rotation/rotation.fixture.ts`.
- **e2e.**
  - Move the erasure locators from `e2e/pages/rotation.page.ts:454-480` into a shared helper.
  - Calendar: `e2e/pages/calendar.page.ts` (`changeRosterIn` :536, `rosterRemoveConfirmOf` :509) and `e2e/tests/calendar/calendar-conflicts.spec.ts`.
  - Model the new specs on `e2e/tests/rotation/rotation-erasures.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] Shared erasure service and check (with tests) -- lifted from rotation, rotation-only bits kept in rotation. The rotation unit tests still pass.
- [x] `<ErasureDialog>` plus the freshness hook -- extracted from `rotation-section.tsx`, which now uses them with no behaviour change.
- [x] Calendar roster-override "after" builder, plus the save and removal guards in `use-roster-form.ts` / `roster-form.tsx`, with tests covering every matrix row except Read failed and Rotation intact.
- [x] `dependents.ts` and its test, `hr.json`, and the registries.
- [x] `e2e/` -- shared locators, plus calendar specs for: Take off by keyboard (queue −1), Remove put-on, No erasure in one click, Keep, Read failed. The 5.5a rotation specs still pass.
- [x] Docs -- the UX docs and the AD-5 line. `sprint-status.yaml`: 5-5b. Mark the 5.5b ledger entry resolved.

**Acceptance Criteria:**
- Given the calendar erasure dialog, when only the keyboard is used, then focus starts on the first "Potvrdi brisanje", every toggle is reachable, and the save lands once all rows are confirmed.
- Given 390 px, when the dialog shows rows, then there is no horizontal scroll.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (shared stack, no `db:reset`)
- `pnpm exec playwright test rotation calendar conflicts` -- expected: green

## Suggested Review Order

**The calendar's "after"**

- Entry point: a save adds a newer override, a removal drops one; live-key hits are refusals.
  [`roster-erasures.ts:102`](../../apps/web/src/features/calendar/services/roster-erasures.ts#L102)

**The guard on the roster writes**

- Save: check first, write at once when nothing is erased.
  [`use-roster-form.ts:339`](../../apps/web/src/features/calendar/hooks/use-roster-form.ts#L339)

- Removal: its confirmation runs the check, then the erasure dialog follows.
  [`use-roster-form.ts:474`](../../apps/web/src/features/calendar/hooks/use-roster-form.ts#L474)

- Confirm re-derives; refused, unavailable or changed each take a defined path.
  [`use-roster-form.ts:530`](../../apps/web/src/features/calendar/hooks/use-roster-form.ts#L530)

- The dialog beside the day detail, with the removal copy.
  [`roster-form.tsx:385`](../../apps/web/src/features/calendar/components/roster-form.tsx#L385)

**Shared pieces lifted from 5.5a**

- Surface-neutral diff and the re-check verdict.
  [`erasures.ts:153`](../../apps/web/src/features/conflicts/services/erasures.ts#L153)
  [`erasures.ts:264`](../../apps/web/src/features/conflicts/services/erasures.ts#L264)

- Reads under the check's own key, shared to screens only when all answer.
  [`use-erasure-reads.ts:94`](../../apps/web/src/features/conflicts/hooks/use-erasure-reads.ts#L94)
  [`use-erasure-reads.ts:66`](../../apps/web/src/features/conflicts/hooks/use-erasure-reads.ts#L66)

- Decisions, the changed line and focus, used by the rotation and the calendar.
  [`use-erasure-confirmation.ts:38`](../../apps/web/src/features/conflicts/hooks/use-erasure-confirmation.ts#L38)
  [`erasure-dialog.tsx:47`](../../apps/web/src/features/conflicts/components/erasure-dialog.tsx#L47)

**Tests**

- e2e: take off by keyboard, remove put-on, one click, keep, read failed, changed, removal refused.
  [`calendar-roster-erasures.spec.ts:142`](../../e2e/tests/calendar/calendar-roster-erasures.spec.ts#L142)
  [`calendar-roster-erasures.spec.ts:346`](../../e2e/tests/calendar/calendar-roster-erasures.spec.ts#L346)
  [`calendar-roster-erasures.spec.ts:387`](../../e2e/tests/calendar/calendar-roster-erasures.spec.ts#L387)
