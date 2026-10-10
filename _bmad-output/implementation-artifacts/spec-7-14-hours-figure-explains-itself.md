---
title: 'Story 7.14: An hours figure explains itself'
type: 'feature'
created: '2026-10-08'
status: 'done'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An hours figure on *Sati* cannot be traced to the shifts behind it; the admin reconstructs it by hand (FR-42b). The organization table has no footer total, the export gives no word about the downloaded file, and a member's page is titled *Sati*.

**Approach:** `domain/hours` explains a figure as codes and operands (one term per shift, summing exactly to the figure, built from the same walk as `memberHoursOfMonth`). Each figure gets an ⓘ that opens a dialog listing the terms with dates. Add the table's footer total, the export's status line, the member title *Moji sati*, and the binding docs.

## Boundaries & Constraints

**Always:** the domain returns codes and operands, never prose (AD-8); the operands sum to the figure (DI-7); no hour is computed in the UI beyond the footer's sum of the rows' domain minutes; app text through `i18n`, Croatian.

**Ask First:** any migration or new read.

**Never:** a second implementation of the hours maths outside `domain/hours`; changing any existing figure; changing the `.xlsx` columns or rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Total / band / leave | a member's month | operands (date, team, shift type, source code, minutes) summing to the figure | N/A |
| Zero figure | leave 0, band 0 | no operands, sum 0 | dialog says nothing composes it |
| Untimed shift | shift before type's first version | not an operand of any hours figure | N/A |
| Band split | shift straddling a band edge | one operand per band touched, minutes of that band | N/A |

## Epic AC Deviations

- "a drawer lists the shifts and bands that compose it": drawn in the shared modal `Dialog` (the app's one modal primitive, EXPERIENCE.md), not a new side-sheet component, so the epic's "drawer" is a modal dialog.
- "any figure on Sati": the hours figures (total, each band, leave) get an ⓘ; shift counts do not, they are counts, not hours.
- "any figure on Sati": the organization table's footer totals have no ⓘ. The footer is the sum of the rows above it, and each row's figure has its own ⓘ (review of PR #179).
- "the shifts and bands that compose it": the Total dialog lists each shift with its whole duration; the split of a shift across bands is shown in each band's own dialog, not in the Total's (review of PR #179).

</frozen-after-approval>

## Code Map

- `packages/domain/src/hours.ts` -- one walk of the month yields per-shift terms; `memberHoursOfMonth` aggregates them; new `explainMemberHours`.
- `packages/domain/src/index.ts` -- exports.
- `apps/web/src/features/hours/services/hours-explanation.ts` -- snapshot to dialog rows (names, dates, figures); footer total.
- `apps/web/src/features/hours/components/` -- `hours-explanation.tsx` (ⓘ + dialog), summary, table, rows, export.
- `apps/web/src/lib/i18n/locales/hr.json`, `pages/sati.tsx` -- copy, *Moji sati*.
- `DESIGN.md`, `EXPERIENCE.md`, `epics.md` UX-DR lines.

## Tasks & Acceptance

**Execution:**
- [x] domain explanation + tests
- [x] web explanation service + tests
- [x] ⓘ and dialog on member page, table and phone rows
- [x] footer total, export status line, *Moji sati*
- [x] DESIGN.md / EXPERIENCE.md / UX-DR33 updates

**Acceptance Criteria:**
- As the epic's Story 7.14.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm --filter @shift/domain test`, `pnpm --filter ./apps/web test`, root `vitest run test/resource-hygiene.test.ts test/localization-*.test.ts`
