---
title: 'Day detail changes open in their own dialogs (7.9)'
type: 'feature'
created: '2026-10-08'
status: 'done'
baseline_commit: 'c46c2caba077a9cc657990a53f0c39c9206aafd7'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Day detail mixes facts with two inline forms (type override, roster change). The admin cannot see the day at a glance or see what a change does before saving. An unresolved conflict on the day is not shown there at all.

**Approach:** Day detail becomes one dialog of facts: the conflict with `Riješi konflikt`, the roster as `Ime · čin · položaj`, and the changes. Its footer offers `Promijeni sastav` and `Promijeni tip smjene` (admin only). Each opens its own small dialog with one Save and a computed *Što se mijenja*. The roster dialog's `Dolazi` candidates are grouped by 5.4's `replacementCandidatesOf`. The groups inform and never block.

## Boundaries & Constraints

**Always:**
- Reuse the existing writes, validation, erasure preflight and confirmations, the shared write latch, and the invalidation (`useOverrideForm`, `useRosterForm`, `*ChangeSnapshotOf`, `*ErasureCheckOf`, `CALENDAR_KEY` + `*_WRITE_DEPENDENTS`). Only the surface moves.
- *Što se mijenja* reuses domain functions. The new day's type and roster come from the `after` snapshot of `overrideChangeSnapshotOf` / `rosterChangeSnapshotOf`. Hour deltas are `memberHoursOfMonth` (via `memberHoursInputOf`) over the before and after snapshots for the date's month. Hour deltas cover every member whose hours change. The preview is codes plus operands, translated in i18n, and it updates as the admin chooses. It shows nothing until a choice is made.
- Conflict facts list each unresolved collision of this team and date (`calendarMarksStateOf(...).collisions`). Each line gives the member's name, the leave dates and a `Riješi konflikt` link to `/raspored/$memberId/$date/$teamId`. It is admin only. A member's day detail shows no conflict and no change buttons.
- Each `Ukloni` on a change line in *Izmjene* opens the existing neutral `ConfirmDialog`.
- Focus returns to the opener (the cell, or the day-detail button). The status after a write is `Notice role="status"` in day detail.
- Croatian copy per the epic rules (`12.09.2026`, `19:00–07:00`, no *smjena* for a type). All literals live in `hr.json`.
- FEATURE_PUBLIC holds. `candidateGroupMessageKey` moves from `conflicts/services/resolution-screen.ts` to calendar's public `utils/replacement-candidates.ts`, and conflicts imports it from there. No barrels.
- Update `sprint-status.yaml`: 7.8 `done`, 7.9 as the workflow moves it.

**Ask First:** a migration or Edge Function change; changing any write, RPC or validation rule; adding a dependency (for example a combobox library).

**Never:** a second implementation of hours, roster or type projection; blocking Save because of a candidate's group; showing the conflict section to a member-role account; toasts or standing banners.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Facts | admin opens a day with an override, a roster change and one collision | type + range, conflict line + `Riješi konflikt`, roster lines, *Izmjene* lists both changes; no `<form>` in day detail | N/A |
| No changes | no override/roster change | *Izmjene* reads `Za ovaj dan nema izmjena tipa smjene ni sastava.` | N/A |
| Type preview | Noć → Slobodno on a 4-member team | *Što se mijenja*: type from → to; `−12 h` for each of the 4 (members grouped by equal delta) | N/A |
| Roster preview | out A, in B (B works Dan same day) | *Što se mijenja*: A leaves, B arrives, A −12 h, B +12 h; B listed under the "working" group | overlap hint stays informational |
| Same as projected | the type chosen equals the rotation's | existing `sameAsProjected` refusal; no preview | existing refusal |
| Taken / gone | concurrent write | existing refused notices, `CALENDAR_KEY` refetched | existing |
| Erasures | the change would erase resolutions | Save → the existing erasure confirm, then write | existing |
| Member | member-role account opens a day | facts only: no conflict, no buttons, no `Ukloni` | N/A |

## Epic AC Deviations

- *"replacement candidates are grouped by availability with 5.4's helper"*: the groups render as native `<optgroup>`s in the existing `Dolazi` select, not the mockup's searchable combobox. This avoids a new dependency. A searchable combobox is DEFERRED (deferred-work entry).
- The mockup's coverage clause (*"Noć 10.10. tada ne radi nijedna smjena (0 članova)"*) is DEFERRED. The preview covers the type, the roster and the hours only.
- The mockup's in-place removal question inside the type dialog is narrowed: removal keeps the shipped `ConfirmDialog`, opened from the change line.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/calendar/components/day-detail-dialog.tsx` -- `DayDetailDialog` L332, `renderDetail` L210; drop `OverrideSetForm`/`RosterSetForm`/inline remove (L249, L299-308); confirms render beside it (L383-386)
- `apps/web/src/features/calendar/components/override-form.tsx` -- `OverrideSetForm` (the type dialog's body) and `OverrideChangeDialog` (the type dialog itself) live here; reuse refusals/notices/confirms
- `apps/web/src/features/calendar/components/roster-form.tsx` -- `RosterSetForm` (the roster dialog's body), `RosterChangeDialog` (the roster dialog itself) and `RosterFormLostNotice` live here; `rosterChangeLine`
- `apps/web/src/features/calendar/components/change-preview-output.tsx` (new) -- *Što se mijenja* (`ChangePreviewOutput`) and the dialogs' description (`ChangeContextDescription`), shared by both dialogs
- `apps/web/src/features/calendar/hooks/use-override-form.ts` / `use-roster-form.ts` -- state, latch, writes; add open/close for the dialogs; untouched write logic
- `apps/web/src/features/calendar/hooks/use-calendar-screen.ts` -- returns no `marks` today (return L355-379); expose this day's collisions + the leave rows for `replacementCandidatesOf`
- `apps/web/src/features/calendar/utils/day-detail.ts` -- `DayDetail` L178, `rosterOffersOf` L658 (in-candidates → helper groups), `inOptionOf` L961, `rosterEntryOf` L1002
- `apps/web/src/features/calendar/utils/replacement-candidates.ts` -- `replacementCandidatesOf(snapshot, leave, teamId, date)`, `CANDIDATE_GROUPS`; receives `candidateGroupMessageKey`
- `apps/web/src/features/conflicts/services/resolution-screen.ts` -- `candidateGroupMessageKey` L730 (move out), L558 usage
- `apps/web/src/features/conflicts/services/override-erasures.ts` L157 / `calendar/services/roster-erasures.ts` L102 -- `after` snapshots for the preview
- `apps/web/src/features/hours/services/my-hours.ts` L220 `memberHoursInputOf`; `hours-conflicts.ts` L148 `hoursLeaveKeysOf`; `packages/domain/src/hours.ts` L174 -- hour deltas
- `apps/web/src/features/members/utils/position.ts` `rosterLineOf` L167 -- `Ime · čin · položaj`
- `apps/web/src/components/ui/dialog.tsx` -- `Dialog`, `DialogFooter`, `ConfirmDialog`; copy pattern from `features/teams/components/team-add-dialog.tsx`
- `apps/web/src/pages/kalendar.tsx` L81-121 -- composes; no derivation in the page
- `apps/web/src/lib/i18n/locales/hr.json` L261-375 `kalendar.detail.*`; `raspored.resolution.candidates.*` L435
- `apps/web/src/features/calendar/utils/element-ids.ts` -- new dialog ids
- `e2e/pages/calendar.page.ts` -- form locators L422-574 move into the new dialogs (`setOverrideIn`, `changeRosterIn` open the dialog first)
- `e2e/tests/calendar/calendar.spec.ts`, `calendar-override-erasures.spec.ts`, `calendar-roster-erasures.spec.ts`, `conflicts/conflict-resolution.spec.ts`, `calendar/layout.spec.ts` L236 -- churn
- Docs: `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md` §Component Patterns L87-112, L122, L131; `DESIGN.md` L251/L290; `epics.md` UX-DR10 L120, UX-DR23 L135

## Tasks & Acceptance

**Execution:**
- [x] `calendar/utils/replacement-candidates.ts`, `conflicts/services/resolution-screen.ts` -- move `candidateGroupMessageKey` and update imports -- the boundary
- [x] `calendar/utils/change-preview.ts` (new) + test -- `overridePreviewOf` / `rosterPreviewOf` return codes + operands (type from/to, out/in, per-member hour deltas grouped by delta) from before/after snapshots -- one domain path
- [x] `calendar/utils/day-detail.ts` + test -- day collisions on `DayDetail` (or a sibling derivation); in-candidates from `replacementCandidatesOf` groups -- facts + grouping
- [x] `calendar/hooks/use-calendar-screen.ts`, `use-override-form.ts`, `use-roster-form.ts` -- expose collisions/leave; dialog open state; preview memo -- wiring
- [x] `calendar/components/day-detail-dialog.tsx`, `override-form.tsx` (`OverrideChangeDialog`), `roster-form.tsx` (`RosterChangeDialog`), `change-preview-output.tsx` (new) -- facts dialog + two dialogs, *Što se mijenja* block, `<optgroup>` candidates, conflict lines with `Riješi konflikt` -- the surface
- [x] `hr.json`, `element-ids.ts` -- new keys/ids -- i18n
- [x] `e2e/pages/calendar.page.ts` + specs above -- open the dialog before driving a form; assert *Što se mijenja*, the conflict link, the candidate groups, and no form in day detail; member sees no buttons -- churn
- [x] EXPERIENCE.md, DESIGN.md, epics.md UX-DR10/23, sprint-status.yaml -- docs in the same PR
- [x] `deferred-work.md` -- entries for the combobox and the coverage clause

**Acceptance Criteria:**
- Given an admin opens a day, then day detail is one dialog of facts with no `<form>`, and its footer has `Promijeni sastav` and `Promijeni tip smjene`.
- Given either button, then a separate dialog opens with one Save. *Što se mijenja* reflects the current choice before Save, and closing the dialog returns to day detail.
- Given `Dolazi`, then candidates appear under `slobodan` / `radi taj dan · 24 h bez pauze` / `na godišnjem taj dan`, every one is selectable, and none is preselected.
- Given `Riješi konflikt`, then it navigates to that collision's decision screen.
- Lint (including feature boundaries), typecheck, unit and e2e tests pass.

## Spec Change Log

## Design Notes

Preview shape (codes and operands only):

```ts
type ChangePreview = {
  type: { from: TypeFact | null; to: TypeFact | null } | null; // TypeFact = { name, range | null }; null side = no rotation
  roster: { out: string | null; in: string | null } | null;     // member ids; a roster change only
  hours: readonly { deltaMinutes: number; memberIds: readonly string[] }[]; // non-zero only, losses first
};
```

The "after" snapshot already exists for the erasure preflight. Compute the preview from it rather than patching the roster by hand.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean, boundary test passes
- `pnpm --filter ./apps/web test` -- expected: all green
- `pnpm e2e` (calendar, conflicts suites) -- expected: green at 1280 and 390

## Suggested Review Order

**Day detail as facts**

- Entry point: the dialog now only reads; openers sit in the admin footer.
  [`day-detail-dialog.tsx:432`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L432)

- Conflict lines with `Riješi konflikt`, admin only, never dropped.
  [`day-detail-dialog.tsx:272`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L272)

- Per-entry degrade: an undated line instead of hiding the day's conflicts.
  [`day-detail.ts:1171`](../../apps/web/src/features/calendar/utils/day-detail.ts#L1171)

- *Izmjene* with each `Ukloni` on its own line, or the empty sentence.
  [`day-detail-dialog.tsx:219`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L219)

**Što se mijenja (one domain path)**

- Before/after snapshots from the erasure preflight; no second projection.
  [`change-preview.ts:122`](../../apps/web/src/features/calendar/utils/change-preview.ts#L122)

- Hour deltas via `memberHoursOfMonth`, honouring Sati's leave keys.
  [`change-preview.ts:82`](../../apps/web/src/features/calendar/utils/change-preview.ts#L82)

- Codes and operands into Croatian, nothing until a choice is made.
  [`change-preview-output.tsx:52`](../../apps/web/src/features/calendar/components/change-preview-output.tsx#L52)

**The two change dialogs**

- Type dialog: placeholder choice, one Save, Escape guarded while pending.
  [`override-form.tsx:172`](../../apps/web/src/features/calendar/components/override-form.tsx#L172)

- Roster dialog: grouped `Dolazi`, nobody preselected, options built only while open.
  [`roster-form.tsx:278`](../../apps/web/src/features/calendar/components/roster-form.tsx#L278)

- Auto-close on re-read explains itself and moves focus somewhere real.
  [`use-roster-form.ts:206`](../../apps/web/src/features/calendar/hooks/use-roster-form.ts#L206)

- Preview memo and dialog state; write logic and latch unchanged.
  [`use-override-form.ts:243`](../../apps/web/src/features/calendar/hooks/use-override-form.ts#L243)

**Candidate grouping (5.4 helper)**

- Groups via `replacementCandidatesOf`; failure or unplaced falls back ungrouped.
  [`day-detail.ts:771`](../../apps/web/src/features/calendar/utils/day-detail.ts#L771)

- Leave is `null` until marks are ready, so nobody is guessed free.
  [`use-calendar-screen.ts:193`](../../apps/web/src/features/calendar/hooks/use-calendar-screen.ts#L193)

- Group label key moved here so conflicts and calendar share it across the boundary.
  [`replacement-candidates.ts:151`](../../apps/web/src/features/calendar/utils/replacement-candidates.ts#L151)

**Peripherals**

- Page object: separate open/fill helpers, optgroups by `data-kind`.
  [`calendar.page.ts:435`](../../e2e/pages/calendar.page.ts#L435)

- e2e: on-leave group, member sees no conflict.
  [`calendar-conflicts.spec.ts:421`](../../e2e/tests/calendar/calendar-conflicts.spec.ts#L421)

- Preview unit cases (leave keys, off-day type, empty choice).
  [`change-preview.test.ts`](../../apps/web/src/features/calendar/utils/change-preview.test.ts)

- EXPERIENCE.md Day detail pattern.
  [`EXPERIENCE.md:97`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L97)
