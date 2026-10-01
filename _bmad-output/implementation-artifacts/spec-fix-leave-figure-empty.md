---
title: 'The leave figure reads empty, not 0 h, on Sati, in the organization table and in the Excel file'
type: 'bugfix'
created: '2026-10-01'
status: 'done'
baseline_commit: '4a1b9058caeab8a56bdecf5267d1a9dd09f58605'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-retro-2026-10-01.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 4 says the leave-hours column "exists and is empty" until Epic 5 brings leave records (`epics.md` 4.2 and 4.3; `epic-4-context.md:24`). The as-built shows `0 h` on Sati and in the organization table, and writes the number `0` (`0:00`) into the `.xlsx`. That claims a zero rather than an absence (Epic 4 retro, finding R2). On 2026-10-01 the human decided: empty.

**Approach:** Where a member's leave is zero, the figure is empty: `—` on screen and an empty cell in the file. Any leave above zero still renders as a duration, so the column fills once Epic 5 supplies leave minutes, with no change to the screen or the export. The domain is unchanged.

## Boundaries & Constraints

**Always:**
- Leave is never added into a band or the total. The DI-7 sum invariant is untouched.
- `—` comes from `i18n`. No literal is added outside `hr.json`.
- Sorting by the leave column still orders by `leaveMinutes`. Zero sorts as 0, so it sorts with the lowest values.
- The member's own leave (4.1b) and the admin's row for that member (4.2) stay equal (Q19).
- E2E follows `e2e/README.md`: locators live in page objects, and there is no `waitForTimeout`.

**Ask First:**
- Any change to `packages/domain` (for example, making `leaveMinutes` nullable).

**Never:**
- No leave records, no leave computation, no Epic 5 work.
- No change to the other figures: bands, the total, the shift count.
- No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Today (no leave exists) | `leaveMinutes: 0` | Sati leave row reads `—`. The table's leave cell reads `—`. The xlsx leave cell is empty (no value). | N/A |
| Leave present (Epic 5) | `leaveMinutes: 750` | `12 h 30 min` on screen. In the xlsx, a number cell `750/1440` with format `[h]:mm`. | N/A |
| Sort by leave | rows all at 0 | Order falls back to the tie-break (name, then id), as today. | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/hours/services/my-hours.ts:190-200` -- `HoursFigure`, `figureOf`. `MyHoursView.leave` (`:216-217`) is set at `:249` as `figureOf(hours.leaveMinutes)`. Make it `HoursFigure | null`, with null for 0, and update the doc comment.
- `apps/web/src/features/hours/services/organization-hours.ts:84-85, 198` -- `OrganizationHoursRow.leave` is copied from `myHoursViewOf` (`figures.leave`), so the type follows. The sort at `:236` reads `leaveMinutes` and stays as it is.
- `apps/web/src/features/hours/components/hours-summary.tsx:52-53` -- the Sati leave row renders `t(view.leave.key, view.leave.values)`.
- `apps/web/src/features/hours/components/organization-hours-table.tsx:131-133` -- the table's leave cell.
- `apps/web/src/features/hours/services/hours-export.ts:83-106` -- `cellsOf`, with leave at `:104`. `HoursExportCell` (a kind union) gains an empty kind.
- `apps/web/src/features/hours/services/xlsx.ts:40-49` -- `cellOf` maps kinds to writer cells. `write-excel-file`'s `Cell` admits `null` (`types/SheetData.d.ts:42`).
- `apps/web/src/lib/i18n/locales/hr.json:147-168` -- the `sati` block. Precedent: `sati.organization.noTeam: "—"`. Add one empty-figure key and register it in `test/resource-hygiene.test.ts`, as the other `sati.*` keys are.
- Tests to update:
  - `my-hours.test.ts:172` and `organization-hours.test.ts:188` (both assert `'0 h'`).
  - `hours-export.test.ts:157` (the expected leave cell).
  - `e2e/tests/hours/hours.spec.ts:224` (Sati leave row) and `:309` (table cell). Both use `hoursOf(0)`.
  - The `expectExportIsTable` loop (`:139-156`) treats leave as a duration.
- `e2e/utils/xlsx.ts:95-112` -- the reader pads only up to the last cell written. Leave is the LAST column, so an empty trailing cell may be absent and the row shorter than the headings (`hours.spec.ts:138`).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/lib/i18n/locales/hr.json` and `test/resource-hygiene.test.ts` -- add the empty-figure key `—` under `sati` and register it -- one source for the mark.
- [x] `apps/web/src/features/hours/services/my-hours.ts` -- `leave` becomes `HoursFigure | null`, with null exactly when `leaveMinutes === 0` -- this is the one place the rule lives. The row in `organization-hours.ts` inherits it.
- [x] `apps/web/src/features/hours/components/hours-summary.tsx` and `organization-hours-table.tsx` -- render the empty-figure key when `leave` is null -- the screen shows the absence.
- [x] `apps/web/src/features/hours/services/hours-export.ts` and `xlsx.ts` -- a zero leave becomes an empty cell kind that `cellOf` maps to `null`, while a positive leave stays an `hours` cell -- so the file says the same as the screen.
- [x] `my-hours.test.ts`, `organization-hours.test.ts`, `hours-export.test.ts` -- assert null/empty at 0 and a duration at a positive `leaveMinutes`. Use a hand-built `MemberHours`, since the domain always gives 0 -- this pins the "fills with no further change" property.
- [x] `e2e/tests/hours/hours.spec.ts` (and `e2e/pages/hours.page.ts` if a locator changes) -- expect `—` on the Sati leave row and in the table cell. In `expectExportIsTable`, a screen `—` maps to an absent or empty xlsx cell, with the row padded to the heading count before the length check -- this keeps the file-equals-table proof.

**Acceptance Criteria:**
- Given any month before Epic 5, when a member opens Sati or an admin opens the organization table, then every leave figure reads `—` and no `0 h` appears in the leave column.
- Given the admin exports that view, when the file is opened, then every leave cell is empty while every other figure cell is unchanged, and the e2e file-equals-table check passes.
- Given a row whose `leaveMinutes` is positive (unit test), when it is rendered and exported, then it reads as a duration on screen and as a `[h]:mm` number cell in the file, with no further code change.

## Design Notes

The rule is "zero means empty", not "before Epic 5 means empty". There is no leave-exists flag to consult, and once Epic 5 lands, a member with no leave in the month honestly reads `—` (none). This avoids touching the domain (AD-7) and needs no follow-up change, which the epic requires.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm test` -- expected: all green (run `pnpm build` first, for `localization-applied`)
- `pnpm exec playwright test e2e/tests/hours` -- expected: all pass

## Suggested Review Order

**The zero rule, once**

- Entry point: zero leave means empty, the single predicate both screen and file use.
  [`my-hours.ts:205`](../../apps/web/src/features/hours/services/my-hours.ts#L205)

- The view model's leave becomes null at zero; positive stays a duration.
  [`my-hours.ts:210`](../../apps/web/src/features/hours/services/my-hours.ts#L210)

- The screen's choice between `—` and the figure, pure and unit-tested.
  [`my-hours.ts:226`](../../apps/web/src/features/hours/services/my-hours.ts#L226)

**Screen**

- Sati leave row renders the shared choice.
  [`hours-summary.tsx:15`](../../apps/web/src/features/hours/components/hours-summary.tsx#L15)

- Organization table leave cell renders the same choice.
  [`organization-hours-table.tsx:112`](../../apps/web/src/features/hours/components/organization-hours-table.tsx#L112)

**Export**

- The file decides from minutes alone, so it cannot disagree with the screen.
  [`hours-export.ts:107`](../../apps/web/src/features/hours/services/hours-export.ts#L107)

- An empty kind maps to no cell in the writer.
  [`xlsx.ts:49`](../../apps/web/src/features/hours/services/xlsx.ts#L49)

**Tests and copy**

- The file-equals-table proof accepts an empty cell only in the leave column, padding strictly.
  [`hours.spec.ts:142`](../../e2e/tests/hours/hours.spec.ts#L142)

- Positive and zero leave through the view model and the shown choice.
  [`my-hours.test.ts:358`](../../apps/web/src/features/hours/services/my-hours.test.ts#L358)

- The export's empty and positive leave cells.
  [`hours-export.test.ts:223`](../../apps/web/src/features/hours/services/hours-export.test.ts#L223)

- The `—` mark, from i18n.
  [`hr.json:153`](../../apps/web/src/lib/i18n/locales/hr.json#L153)
