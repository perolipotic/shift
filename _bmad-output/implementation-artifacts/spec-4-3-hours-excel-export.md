---
title: 'Hours export: an admin downloads the month on screen as an Excel file (4.3)'
type: 'feature'
created: '2026-09-30'
status: 'done'
baseline_commit: 'beed62efa75c03b43d6279ec6266501e243ee35e'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-2-organization-hours.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An admin closing the month on `Sati` can read every member's hours, but has to retype them to send them onward.

**Approach:** An `Izvezi u Excel` action on the admin's Organization hours downloads an `.xlsx` of exactly `view.rows`, in the order, filter and period shown. A pure node-tested module turns the view into a sheet, and a lazy-loaded `write-excel-file@4.1.1` writes it in the browser.

## Boundaries & Constraints

**Always:**
- The source is the `OrganizationHoursView` the table rendered, and nothing is read again. The figures come from `row.hours` in minutes, never from parsed display text.
- Columns: Member, Team, shift count, one per `view.bands` (the name as stored, in band order), Total, Leave. There is one header row, then one row per `view.rows` entry in order. There is no totals row, no title row, and no band shift counts.
- Hours are **number** cells holding a duration (`minutes / 1440`, a spreadsheet day fraction) with the cell format `[h]:mm`, so 750 minutes reads `12:30`, as the screen's `12 h 30 min`. Shift count is a number cell. Member and team are text. A missing team is the same `sati.organization.noTeam` text the screen shows. Leave is `leaveMinutes / 1440` (0 until Epic 5), so it fills with no export change.
- Headers reuse the `sati.organization.*` column keys. The sheet name, file name and action labels are new `sati.organization.export.*` keys. File name: `Sati {organization} {month} {year}.xlsx` (lowercase month via `formatIsoMonthName`), with `\ / : * ? " < > |` removed from the organization name.
- The organization name joins the calendar snapshot: `name` is added to `CALENDAR_COLUMNS` and parsed into `CalendarSnapshot.organizationName`. This is the same row and the same query, so no second read happens.
- The action is admin-only because it renders only where `organization !== null`. It is a secondary `Button`, disabled while building (label `…export.pending`) and when `view.rows` is empty. A failed build or import shows `…export.failed` in `role="alert"`, is logged, and is never thrown.
- The writer is loaded by dynamic `import('write-excel-file/browser')` inside the export action only. Pin it exactly in `apps/web`.
- Every rule is in node-tested `.ts` (AD-15). Components and hooks only wire.

**Ask First:** schema/RLS/SQL changes; a second query; a different library; a format picker or CSV/PDF.

**Never:** export for member-role accounts; any change to `packages/domain`; conflict state (Epic 5 supplies it on the row); pay rates; hour arithmetic other than `/ 1440`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Screen equals file | demo, filtered by team, sorted by total descending | the same rows in the same order; the figures equal `row.hours` / 1440 | N/A |
| Split bands | security fixture | band cells show the split hours; the band cells sum to Total on every row (in minutes) | N/A |
| Half hours | 750 minutes | cell `750 / 1440`, number type, format `[h]:mm` (reads `12:30`) | N/A |
| No team | row.team null | team cell = `noTeam` text | N/A |
| Zero bands | no bands | columns Member, Team, shifts, Total, Leave | N/A |
| Unsafe org name | `DVD "A/B"` | file `Sati DVD AB rujan 2026.xlsx` | N/A |
| No rows | filter leaves 0 rows | action disabled | N/A |
| Import fails | chunk load rejects | `export.failed` alert, button re-enabled | logged |
| Member | member viewer | no action | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/hours/services/organization-hours.ts:72,107,381` -- `OrganizationHoursRow` (`hours: MemberHours` holds the minutes, and `team`), `OrganizationHoursView` (`bands`, `rows`, `header` {month, monthName, year}). This is the export's only input.
- `apps/web/src/features/calendar/services/snapshot.ts:115-124,265,444-457` -- `CALENDAR_COLUMNS`, `CalendarSnapshot`, and the organization parse (add `name`, reject non-string as `unavailable('organization')`). Fixtures and test builders of `CalendarSnapshot` gain `organizationName`.
- `apps/web/src/features/hours/components/hours-body.tsx:55-61` -- the admin branch (filters + table). The export action sits beside the filters. `pages/sati.tsx:35-66` is the wiring. `hooks/use-hours.ts` gives the surface.
- `apps/web/src/components/ui/button.tsx` -- the `Button` with `variant`.
- `apps/web/src/lib/i18n/{index.ts,format.ts}` -- `t`, `formatIsoMonthName`. Only `format.ts` touches `Intl`.
- `apps/web/src/lib/i18n/locales/hr.json` (`sati.organization.*`), `test/resource-hygiene.test.ts:~1055-1077` (the sanctioned key list; voice rules at ~1400: imperative action, no `!`).
- `test/localization-applied.test.ts:614-618,627,841` -- `entryChunkPath()` asserts that `dist/assets` holds exactly one `.js`, which fails on the first split. Resolve the entry from `dist/index.html`'s module script instead. `allChunks()` sweeps every chunk.
- `eslint.config.js:111,347` -- `FEATURE_PUBLIC.hours`, which also checks dynamic `import()`. A new module internal to hours needs no change.
- `packages/domain/test/purity.test.ts:91` -- the domain has no dependencies. It must stay untouched.
- `e2e/pages/hours.page.ts`, `e2e/tests/hours/hours.spec.ts:194` (admin describe, `seeded(slug, teamId)`, `minutesOfFigure`). No download precedent exists, and no xlsx reader is installed.
- `_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md:229` -- the Stack row "chosen and pinned in Story 4.3".
- `.npmrc` sets `save-exact=true`. The dependencies are `write-excel-file` 4.1.1 (MIT, only dependency is fflate, `./browser` export, `{type: Number, value, format}` cells, `.toFile(name)`) and `fflate` 0.8.3 (zero deps).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/calendar/services/snapshot.ts` (+ its tests/fixtures) -- select and parse `name` as `organizationName` -- the file name needs the organization without a second read.
- [x] `apps/web/src/features/hours/services/hours-export.ts` (+ `hours-export.test.ts`) -- pure `hoursExportOf(view, organizationName)` → `{fileName, sheetName, columns, rows}`, where each cell is `{kind:'text',value}` or `{kind:'hours'|'count',value:number}` -- every matrix row runs in node over both fixtures.
- [x] `apps/web/src/features/hours/services/xlsx.ts` -- `writeHoursExport(sheet)`: dynamically imports `write-excel-file/browser`, maps cells to its schema (Number and `[h]:mm` for hours), and calls `.toFile` -- the only file that knows the library.
- [x] `apps/web/src/features/hours/{hooks/use-hours-export.ts,components/organization-hours-export.tsx,components/hours-body.tsx}` -- pending and failed state, the button, and the alert.
- [x] `apps/web/package.json`, `pnpm-lock.yaml` -- add `write-excel-file` 4.1.1 exactly. Add root devDep `fflate` 0.8.3 for the E2E reader.
- [x] `apps/web/src/lib/i18n/locales/hr.json`, `test/resource-hygiene.test.ts` -- the keys `sati.organization.export.{action,pending,failed,sheetName,fileName}`.
- [x] `test/localization-applied.test.ts` -- find the entry chunk from `index.html`, and assert that the entry chunk does not contain the writer (e.g. no `xl/worksheets/` string) while some other chunk does.
- [x] `e2e/utils/xlsx.ts`, `e2e/pages/hours.page.ts`, `e2e/tests/hours/hours.spec.ts` -- the admin filters and sorts, then exports. `waitForEvent('download')` receives the file. It is unzipped with fflate and its cells read. The file name, headers, row order and number cells equal the table. A member sees no action.
- [x] `ARCHITECTURE-SPINE.md:229` -- the Stack row becomes `write-excel-file` `4.1.1`.

**Acceptance Criteria:**
- Given an admin on a filtered, sorted month, when they export, then the downloaded file's rows, order and figures equal the table and every figure is a number cell.
- Given the production build, when the app loads, then the entry chunk holds no XLSX writer, and the writer loads only when the action is chosen.
- Given `packages/domain`, when inspected, then it is unchanged.

## Spec Change Log

- **Review 1 (2026-09-30), human-approved amendment of the frozen block.** Trigger: all three reviewers found that the `0.##` format shows a stray separator on whole hours (`180,`) and that full-precision thirds (`7,333…`) do not visibly add up. Amended: hours are written as durations (`minutes / 1440`, format `[h]:mm`) in Always, Never, the matrix and Design Notes. The spec's `test/` paths are corrected to the repository root. Known-bad state avoided: decimal hours with `0.##`. The human chose to fix it in place, without a revert. KEEP: the whole existing implementation (the snapshot `organizationName`, pure `hoursExportOf`, `xlsx.ts` as the only library module, the lazy chunk and the entry-chunk test, the E2E reader with fflate). Change only the hours value and format, and the patch findings.

## Design Notes

Durations with `[h]:mm` read as the screen does (`12:30`), show no stray separator on whole hours, and sum natively in Excel; `[h]` keeps totals past 24 hours (`108:00`). The DI-7 sum invariant is asserted in minutes, before the division, so float noise cannot hide a real mismatch. Conflict state is not in `OrganizationHoursRow` yet. When Epic 5 adds it to the row, `hoursExportOf` is the one place that maps it.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm typecheck && pnpm lint && pnpm build && pnpm vitest run` -- expected: clean, including the bundle, resource-hygiene and domain-purity tests
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm test:e2e e2e/tests/hours` -- expected: pass (local Supabase running)

## Suggested Review Order

**The sheet is the view the table rendered**

- Entry point: header and rows straight from `OrganizationHoursView`, in its order; nothing re-read.
  [`hours-export.ts:114`](../../apps/web/src/features/hours/services/hours-export.ts#L114)

- Each row's cells from `row.hours` minutes; a band the row lacks refuses the sheet.
  [`hours-export.ts:89`](../../apps/web/src/features/hours/services/hours-export.ts#L89)

- Hours become durations (`minutes / 1440`), the only arithmetic.
  [`hours-export.ts:56`](../../apps/web/src/features/hours/services/hours-export.ts#L56)

- File name: the organization sanitized once, then the period.
  [`hours-export.ts:69`](../../apps/web/src/features/hours/services/hours-export.ts#L69)

- Failures are logged and answered `false`, never thrown.
  [`hours-export.ts:174`](../../apps/web/src/features/hours/services/hours-export.ts#L174)

**The organization name, from the same read**

- `name` joins the calendar select and parse; same row, same query.
  [`snapshot.ts:450`](../../apps/web/src/features/calendar/services/snapshot.ts#L450)

**The writer, lazy and alone**

- The only module that knows the library; loaded by `import()` on the action.
  [`xlsx.ts:60`](../../apps/web/src/features/hours/services/xlsx.ts#L60)

- `[h]:mm` duration cells, numbers for counts, text for names.
  [`xlsx.ts:40`](../../apps/web/src/features/hours/services/xlsx.ts#L40)

- The build test proves the writer stays out of the entry chunk.
  [`localization-applied.test.ts:1615`](../../test/localization-applied.test.ts#L1615)

- The entry chunk is now found through `index.html`, since the build splits.
  [`localization-applied.test.ts:621`](../../test/localization-applied.test.ts#L621)

**Screen**

- In-flight ref, failure tied to its view, late results ignored.
  [`use-hours-export.ts:25`](../../apps/web/src/features/hours/hooks/use-hours-export.ts#L25)

- The button: `aria-disabled` while building keeps focus; native `disabled` with no rows.
  [`organization-hours-export.tsx:16`](../../apps/web/src/features/hours/components/organization-hours-export.tsx#L16)

- Rendered only in the admin branch, beside the filters.
  [`hours-body.tsx:65`](../../apps/web/src/features/hours/components/hours-body.tsx#L65)

**Peripherals**

- Copy under `sati.organization.export.*`.
  [`hr.json:171`](../../apps/web/src/lib/i18n/locales/hr.json#L171)

- The pinned dependency and its Stack row.
  [`package.json:35`](../../apps/web/package.json#L35)
  [`ARCHITECTURE-SPINE.md:229`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L229)

- E2E: the file equals the table, with and without filters; empty and failure paths.
  [`hours.spec.ts:124`](../../e2e/tests/hours/hours.spec.ts#L124)
  [`hours.spec.ts:415`](../../e2e/tests/hours/hours.spec.ts#L415)
  [`hours.spec.ts:430`](../../e2e/tests/hours/hours.spec.ts#L430)

- The E2E xlsx reader and the replicated file-name rule.
  [`xlsx.ts:80`](../../e2e/utils/xlsx.ts#L80)

- Node tests, one per matrix row, over both fixtures.
  [`hours-export.test.ts:1`](../../apps/web/src/features/hours/services/hours-export.test.ts#L1)
