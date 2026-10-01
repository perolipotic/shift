---
title: 'An admin amends or removes a member''s leave on their page, and the figures follow (5.2b)'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: '25958da82fb325a4912af868fc880e607a95eb21'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 5.2a gave leave records an attributed amend and removal (`amendLeave`/`removeLeave`, migration 0029), but no admin can reach either. A mistyped range stays on the member's page and in their balance.

**Approach:** The member page's Godišnji card (5.1c) gains a list of the member's live records. Each record has two actions:
- **Izmijeni** puts the existing od–do form into amend mode for that record. The preview leaves the record out of `leavePreviewOf`'s records, and the save goes through `amendLeave`.
- **Ukloni** opens a single `ConfirmDialog` that names the range and its cost. Confirming calls `removeLeave`.

The figures re-read after every outcome.

## Boundaries & Constraints

**Always:**
- **One computation.** Each record's cost and every preview come from `@shift/domain` (`leaveCostOf`, `leavePreviewOf`, `leaveBalanceOf`). The pure decisions live in `features/leave/services`, and the hook only wires them.
- **Records carry `id`.**
  - Add `id` to `LEAVE_RECORDS_COLUMNS`.
  - `leaveRecordsOf` refuses a row with no string id.
  - The list is sorted by `from`, soonest first, and shows each range as `formatIsoDate` dates joined by an en dash, with its cost (`count.days`).
  - A member with no live record shows an empty line that states what is true.
- **Amend mode.**
  - The form's heading names the record being amended, and its fields are prefilled with that record's range.
  - The submit reads as an amend save, and a cancel returns the form to new-record mode.
  - The preview excludes that record.
  - A range equal to the record's current one shows a reason in place of a preview and is never sent.
  - Only one record is in amend mode at a time. The form's single od/do pair is reused, so labels stay unique on the page.
- **Removal.**
  - Exactly one confirmation step: `ConfirmDialog`, copied from `override-form.tsx`'s remove confirm.
  - The prompt names the range and its cost in words.
  - Cancel is `outline` and confirm the default variant. No `destructive` anywhere (UX-DR4, UX-DR27).
  - The remove action carries an icon and an sr-only name of the range, as `hour-band-remove.tsx` does.
- **Outcomes** (each its own `hr.json` line):
  - Amend saved shows a status with the new cost and any over-balance warning, costed from the re-read records by the returned id.
  - Removed shows a status.
  - `LEAVE_OVERLAP` on amend names the other record, keeps the values, and keeps amend mode.
  - `LEAVE_GONE` closes the dialog or amend mode, says the record is already gone, and refreshes the list.
  - `LEAVE_DENIED` and `LEAVE_FAILED` get amend- and remove-specific wording.
  - A failed remove keeps the dialog open with its alert inside and focuses Cancel. Focus returns to the action after a cancel.
- **After every outcome,** re-read `LEAVE_RECORDS_KEY` and `LEAVE_WRITE_DEPENDENTS`. No optimistic figures. Each handler has an in-flight guard and uses `focusLater`.
- **Registration.** Copy comes only from `hr.json` and is registered in the hygiene and string tests. No horizontal scroll at 390 px.

**Ask First:**
- A dedicated leave page or a record history (removed records) view.
- Hiding past records, or any filter on the list.
- Any migration, RLS change or change to `leave-write.ts`'s contract.

**Never:**
- No member-facing view (5.2c), and no conflicts or calendar drawing (5.3).
- No bulk removal, and no change to `domain/leave`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List | two live records | soonest first, range + cost each | skeleton while loading |
| Empty | no live records | empty line | N/A |
| Amend preview | record 10.09–14.09 (cost 3), allowance 20; amend to 10.09–16.09 | cost of the new range; balance after = 20 − new cost; no overlap note for its own dates | N/A |
| Unchanged | amend range = current range | reason, no preview | save refused in client |
| Amend saved | valid amend | status with new cost; figures re-read; form back to new mode | N/A |
| Amend overlap | onto another record 18.09–25.09 | alert names 18.09–25.09; values and amend mode kept | N/A |
| Remove confirmed | confirm in dialog | status; record leaves list; balance restored | N/A |
| Remove cancelled | cancel / Esc | nothing sent; focus back on Ukloni | N/A |
| Gone | record removed elsewhere, then amend or remove | gone line; list refreshed; mode/dialog closed | `LEAVE_GONE` |
| Denied / failed | 42501 / other | own amend or remove line | dialog stays open on remove |

## Epic AC Deviations

- **Met here (screen half), with 5.2a (record half):** "When it is amended or deleted, Then the balance is recomputed so that allowance minus used equals balance at all times". The figures re-read after every outcome and are never optimistic.
- **Met here:** "the action passes through exactly one confirmation step, signalled by more than colour, using neutral styling rather than the reserved hue (UX-DR27, UX-DR4)".
- **DEFERRED to 5.3 (unchanged from 5.2a):** "every conflict it caused is cleared". Ledger: the 5.2a "Story 5.3 must assert" entry.
- **DEFERRED to 5.2c:** "a member's own view … allowance, days used and balance". Ledger: the "Story 5.2c" entry.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/leave/components/member-leave-card.tsx`
  - `renderFigures` :49-81. Insert the records list between the figures and the form (:179-180).
  - `renderPreview` :103-140, `renderOutcome` :143-169.
  - The form and fieldset :180-219, with fields `member-leave-from`/`-to`.
- `apps/web/src/features/leave/hooks/use-member-leave.ts`
  - Refs :80-87, state :88-94, reads :96-114, `formDisabled` :138, `change` :141-149.
  - `save` :168-241: its guard, its use of `refreshAfterWrite` after every outcome (:210-218), and `leaveRecordsAfterWriteOf` → `leaveSavedOf` (:220-229).
  - Mirror it for `amend` (ref `amending`) and `remove` (ref `removing`).
- `apps/web/src/features/leave/services/leave-section.ts`
  - `memberLeaveBaseOf` :131-174.
  - `leavePreviewStateOf` :237-254: add the excluded record and the unchanged reason (the exhaustive `leaveReasonMessageKey` :257-279).
  - `leaveSavedOf` :308-326 (cost by returned id).
  - `LeaveFailure`/`leaveConflictOf` :329-337: widen to `LeaveChangeFailure`/`LeaveAmendOutcome`.
  - `leaveRefusalMessageKey` :340-362, `leaveRefusalValuesOf` :368-374 (`formatIsoDate ?? x`).
- `apps/web/src/features/leave/services/leave-list.ts`
  - Columns :38-42, `leaveRecordsOf` :77-100, and the record types at :45, :155, :174, :182, :213, :222.
  - A `LeaveRecord extends LeaveRange { id }` still fits `LeaveBalanceInput.records`.
  - Tests: `leave-list.test.ts` :67, :75-100, :201.
- `apps/web/src/features/leave/services/leave-write.ts`
  - Codes :48-59, outcomes :72-85.
  - `removeLeave` :384; `amendLeave` :429, whose doc :416-427 says to re-read on FAILED.
- Confirmation precedent:
  - `features/calendar/components/override-form.tsx:184-239`, with the GONE refusal :144-153.
  - Hook `features/calendar/hooks/use-override-form.ts:67-71, :190-258`.
  - `components/ui/dialog.tsx:174-197` (`ConfirmDialog`).
  - The icon and sr-only name: `features/hour-bands/components/hour-band-remove.tsx:41-58, :103`.
- `apps/web/src/lib/i18n/locales/hr.json:296-322` (`ljudi.leaveRecord`). Mirror the remove copy at :80-86. Register keys in:
  - `test/resource-hygiene.test.ts`: `SANCTIONED_PLURAL_KEYS` :106-109 and `SANCTIONED_SCREEN_KEYS` :1100-1133.
  - `apps/web/src/pages/prijava.test.ts`: `MEMBER_EDIT` :186-199 (add any new component file), `expectedControls` :609, `IN_FLIGHT_HANDLERS` :915-926 (one entry per new handler), and `KEY_SOURCES` strings :2182 and :2299.
- e2e:
  - `e2e/pages/people.page.ts:154-205`. Scope `leaveFromInput`/`leaveToInput` to the card, and add list, row action and confirm locators (`base.page.ts:76` `dialog`; `calendar.page.ts:374-388` `removeConfirmOf`).
  - `e2e/tests/people/leave.spec.ts`, which provides the `seeded` helper :103 and `workingDaysOf` :80. Use a fresh member per test.
  - For "gone", remove the record in the database first, through a helper in `e2e/utils/database-helper.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/leave/services/leave-list.ts` (+test) -- `id` in columns, parse and types.
- [x] `apps/web/src/features/leave/services/leave-section.ts` (+test) -- the list rows, amend preview (excluded record, unchanged reason), and amend and remove outcome → keys and values. Cover every matrix row.
- [x] `apps/web/src/features/leave/hooks/use-member-leave.ts`, `components/member-leave-card.tsx` (and a records component if it splits cleanly) -- amend mode, remove confirm, focus and wiring.
- [x] `hr.json`, `test/resource-hygiene.test.ts`, `apps/web/src/pages/prijava.test.ts` -- copy and registrations.
- [x] `e2e/tests/people/leave.spec.ts`, `e2e/pages/people.page.ts`, `e2e/utils/database-helper.ts` -- the following, with a seeded rotation:
  - amend preview and save update the figures;
  - an amend overlap names the other record;
  - remove through one confirmation restores the balance;
  - cancel sends nothing;
  - gone refreshes the list;
  - 390 px has no horizontal scroll with the list shown.

**Acceptance Criteria:**
- Given a member with allowance 20 and one record costing 3, when the admin removes it through the one confirmation, then the card shows 20 / 0 / 20 and no record. When the admin instead amends it to a range costing 5, the card shows 20 / 5 / 15 and one record.
- Given the remove dialog, then no element on the card or dialog uses the `destructive` token, and the prompt names the range in text.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green
- `pnpm exec playwright test e2e/tests/people` -- expected: all pass

## Suggested Review Order

**Amend**

- Entry point: amend writes, re-reads after every outcome (a throw included), keeps mode on refusal.
  [`use-member-leave.ts:395`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L395)

- The preview leaves the amended record out by id; an unchanged range is a reason.
  [`leave-section.ts:325`](../../apps/web/src/features/leave/services/leave-section.ts#L325)

- A landed amend is costed from the re-read records by its new id.
  [`leave-section.ts:428`](../../apps/web/src/features/leave/services/leave-section.ts#L428)

- Amend mode and the confirm close when their record leaves the live read.
  [`use-member-leave.ts:196`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L196)

**Removal**

- One confirmation; a refusal keeps the dialog open, gone closes it.
  [`use-member-leave.ts:478`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L478)

- The dialog: neutral variants, the prompt names the range and cost.
  [`member-leave-records.tsx:148`](../../apps/web/src/features/leave/components/member-leave-records.tsx#L148)

- The prompt states the in-year part when a record crosses the leave year.
  [`leave-section.ts:179`](../../apps/web/src/features/leave/services/leave-section.ts#L179)

**The list**

- Rows: range, cost, and the in-year line, from the domain.
  [`leave-section.ts:161`](../../apps/web/src/features/leave/services/leave-section.ts#L161)

- The row in amend mode is marked in words and `aria-current`.
  [`member-leave-records.tsx:57`](../../apps/web/src/features/leave/components/member-leave-records.tsx#L57)

- Records now carry `id`; a duplicate id or shared date refuses the read.
  [`leave-list.ts:88`](../../apps/web/src/features/leave/services/leave-list.ts#L88)

- Which failure shows on the list, the form or the dialog.
  [`leave-section.ts:546`](../../apps/web/src/features/leave/services/leave-section.ts#L546)

**End to end**

- Amend: preview, overlap names the other record, figures update.
  [`leave.spec.ts:276`](../../e2e/tests/people/leave.spec.ts#L276)

- Remove: one confirmation, cancel sends nothing, 390 px.
  [`leave.spec.ts:345`](../../e2e/tests/people/leave.spec.ts#L345)

- Gone, refused removal, failed amend, cancel paths.
  [`leave.spec.ts:394`](../../e2e/tests/people/leave.spec.ts#L394)
