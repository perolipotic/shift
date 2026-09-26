# Sprint Change Proposal — Hours export to Excel

- **Date:** 2026-09-26
- **Author:** Developer (correct-course workflow), for Perolipotic
- **Mode:** Batch
- **Status:** Approved 2026-09-26 (batch) — applied on `docs/correct-course-hours-export`

## 1. Issue Summary

**What changes.** An admin can export the organization hours for a period to an Excel (`.xlsx`) file. It is a new Story 4.3 in Epic 4.

**Why.** UJ-4 ends with Damir reporting the month's figures "onward". The PRD assumed that reading the figures on screen is enough (`[ASSUMPTION: on-screen reporting suffices for the pilot; no export in MVP.]`). In practice the month-end numbers leave the application: they go to the DVD's leadership, the treasurer or the city. Without an export, someone retypes them into a spreadsheet, which puts manual recomputation back, the very thing SM-3 measures.

**How it was discovered.** In a v2 planning discussion on 2026-09-26, the human asked how hard an export would be for v1. The answer was that it is cheap once Story 4.2 exists, and the human decided to add it to the MVP.

**Category.** A new requirement from the stakeholder. It overturns an explicit `[ASSUMPTION]`, not a design invariant.

**Evidence.**
- PRD §2.3 UJ-4, §5.10 "Out of Scope for MVP: export (CSV, Excel, PDF)", §7.2 "Export in any format", §12 assumptions index.
- Epic 4 has not started. No code, spec or epic context exists for it yet.

## 2. Impact Analysis

### 2.1 Epic Impact

- **Epic 4 (backlog):** gains Story 4.3, after 4.2, which it depends on. The epic's goal gets one clause. It stays standalone.
- **Epic 5:** no story changes. When leave records arrive, the export's leave-hours column fills automatically, because the export reads the same derived rows as the table (see 4.3's acceptance criteria).
- **Epics 1–3 and 6:** no impact.
- No epic becomes obsolete, no new epic is needed, and the order does not change.

### 2.2 Story Impact

- **Current:** none. Epic 3 continues (3.2 next).
- **Future:** 4.2 is unchanged. 4.3 is new. Nothing else changes.

### 2.3 Artifact Conflicts

**PRD.** The conflict is with an assumption and three out-of-scope lines, not with a design invariant. What still holds:
- **§1 "Payroll and finance functions … does not export to payroll."** Still true. This is a file of the same figures the screen shows, with no rates, pay or payroll format.
- **§6 "not a payroll or time-and-attendance system".** Still true, for the same reason.
- **DI-7, DI-8.** The export has one column per Hour Band, named by the organization's bands, never hard-coded day and night columns.

CSV and PDF stay out of scope.

**Architecture.** No AD conflicts, but the export must obey four ADs, and the story states them:
- **AD-7:** the domain package gains nothing and takes no dependency. The XLSX writer lives in `apps/web`.
- **AD-13:** the file is built from the same snapshot the hours table rendered. It is not a second read, so the file and the screen cannot disagree.
- **AD-14:** the file is generated in the browser. There is no server runtime and no new Edge Function.
- **AD-8 and Strings:** column headers, the sheet name and the file name come from `i18n`.

The one real addition is a **new runtime dependency**, a client-side XLSX writer. The Stack table records every runtime library, so it gets a row. The writer must be **lazy-loaded** on the export action, so it never enters the main bundle (NFR-22 and Q17 budgets). The library is chosen at build time, not in this proposal.

**UX (EXPERIENCE.md).** The hours table gets one action. Terminology: `Izvezi u Excel`. The action is admin-only and sits on the Organization hours surface.

**Other artifacts:**
- sprint-status: add a key.
- E2E: 4.3 adds an E2E test for the download.
- CI and DEPLOY.md: none. There is no migration and no function.

### 2.4 Technical Impact

- No schema change, no migration, no RLS change. Admin-only access is inherited from the existing hours reads.
- One new dependency in `apps/web`, lazy-loaded.
- Effort: about one day plus tests, after 4.2.

## 3. Recommended Approach

**Direct Adjustment** (checklist option 1): add Story 4.3 and make the matching PRD, epics, architecture and UX edits.

- **Rollback (option 2):** not applicable. Nothing is built.
- **MVP review (option 3):** not needed. The MVP goals do not change. The export strengthens SM-3.
- **Effort:** low. **Risk:** low. The main risk is bundle size, which lazy loading removes.
- **Timeline:** about one day added to Epic 4.

## 4. Detailed Change Proposals

### 4.1 PRD (`prds/prd-shift-2026-09-01/prd.md`)

**§2.3 UJ-4.**

- OLD: "**Resolution:** they read the figures on screen and report them onward. `[ASSUMPTION: on-screen reporting suffices for the pilot; no export in MVP.]`"
- NEW: "**Resolution:** they export the month to Excel and send it onward, and the file carries exactly the figures on screen (FR-42a)."

**§5.10, a new FR after FR-42.**

NEW:

> #### FR-42a: Export organization hours (added 2026-09-26, sprint change)
> An Admin can export the Organization hours for a selected period to an Excel file. Realizes UJ-4.
>
> **Consequences (testable):**
> - The file holds exactly the rows the Organization hours view shows for that period and filter, in its sort order, with the same figures (FR-42). It is built from the same data the view rendered, never from a second read.
> - Columns: Member, Team, shift count, one column per Hour Band named by the Organization's bands, Total Hours, Leave Hours. No band is hard-coded (DI-8).
> - Figures are stored as numbers, not text, so they can be summed in the spreadsheet.
> - Column headers, sheet name and file name follow the Organization locale. The file name carries the Organization and the period.
> - A shift in unresolved Conflict is marked in the file as it is on screen (FR-41), so no exported total is silently wrong.
> - Only an Admin can export. A Member cannot export anyone's hours, their own included, in MVP.

**§5.10, "Out of Scope for MVP".**

- OLD: "export (CSV, Excel, PDF); pay rates …"
- NEW: "export as CSV or PDF, and any export other than FR-42a; pay rates …"

**§7.1, In Scope.** After "shift counts and Band Hours per Member and Organization", insert: "· Excel export of Organization hours".

**§7.2, "Deferred because MVP has no need".**

- OLD: "Export in any format; advanced reporting; analytics; team statistics."
- NEW: "Export beyond FR-42a's Excel file of Organization hours (CSV, PDF, payroll formats, other surfaces); advanced reporting; analytics; team statistics."

**§12, Assumptions Index.** Delete the line "**§2.3 UJ-4** — On-screen hour reporting is sufficient for the pilot; no export in MVP." It was resolved by this sprint change.

### 4.2 PRD addendum (`prds/prd-shift-2026-09-01/addendum.md`), §9

- OLD: "**Reporting** — Excel and PDF export · advanced hour reports …"
- NEW: "**Reporting** — PDF export, and Excel export beyond Organization hours (Excel export of Organization hours moved into MVP as FR-42a, 2026-09-26) · advanced hour reports …"

### 4.3 Epics (`epics.md`)

**CAP-14 (both occurrences, requirements inventory and capability list).** Append: "An admin can export the organization hours for a period to Excel, carrying exactly the figures on screen."

**UX Design Requirements. Add after UX-DR43:**

> - **UX-DR44** Hours export — one action on Organization hours, `Izvezi u Excel`, admin-only; exports the current period, filter and sort; the file's figures match the table exactly.

**UX design requirement allocation.**

- OLD: "UX-DR17, 29 land in Epic 4."
- NEW: "UX-DR17, 29, 44 land in Epic 4."

**FR Coverage Map, CAP-14 row.**

- OLD: "my hours, organization hours"
- NEW: "my hours, organization hours, Excel export"

**Epic List, Epic 4.** Append to the summary: "The admin can take the month away as an Excel file that matches the screen."

**Epic 4 header.**

- OLD: "**UX:** UX-DR17, 29"
- NEW: "**UX:** UX-DR17, 29, 44"

**Epic 4, a new story after 4.2.**

> ### Story 4.3: An admin exports the month's hours to Excel (added 2026-09-26, sprint change)
>
> As an admin,
> I want to download the hours I am looking at as an Excel file,
> So that I can send the month onward without retyping a number.
>
> **Acceptance Criteria:**
>
> **Given** the Organization hours view with a period, a team or member filter, and a sort
> **When** the admin chooses `Izvezi u Excel`
> **Then** an `.xlsx` file downloads with exactly the rows, order and figures on screen (FR-42a)
> **And** it is built from the surface's one snapshot, never a second read (AD-13, Q19)
>
> **Given** an organization with any number of Hour Bands
> **When** the file is built
> **Then** it has one column per band, named by the organization's bands, next to Member, Team, shift count, Total and Leave Hours; nothing names day or night in code (DI-8)
> **And** the security fixture, whose bands split shifts, exports its split figures exactly (AD-15)
>
> **Given** the exported figures
> **When** the file is opened in a spreadsheet
> **Then** every count and hour is a number, not text, and band hours sum to total on every row (DI-7)
>
> **Given** the organization locale
> **When** the file is built
> **Then** headers, sheet name and file name come from `i18n`, and the file name carries the organization and period; no literal string is added outside `i18n` (AD-8, L1–L8)
>
> **Given** a member with a shift in unresolved conflict in the period
> **When** the file is built
> **Then** that row carries the same distinct state the table shows (FR-41)
>
> **Given** Epic 5 not yet delivered
> **When** the file is built
> **Then** the leave-hours column exists and is empty, and fills with no change to the export once leave records exist
>
> **Given** a member-role account
> **When** any surface renders
> **Then** no export action is offered, and the export needs no new RLS path because it reads nothing the table did not (Q1–Q3)
>
> **Given** the main bundle
> **When** the app loads
> **Then** the XLSX writer is not in it; it loads only when the export is chosen (NFR-22, Q17)
>
> **Given** the domain package
> **When** it is inspected
> **Then** it has gained no dependency and no export code (AD-7)

### 4.4 Architecture (`architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md`)

**Stack table. Add a row:**

| Name | Version |
| --- | --- |
| XLSX writer (client-side, lazy-loaded; `apps/web` only) | chosen and pinned in Story 4.3 |

**Capability map, CAP-14 row.**

- OLD: "`domain/hours`"
- NEW: "`domain/hours`; the Excel export in `apps/web` renders the surface snapshot and computes nothing"

### 4.5 UX (`ux-designs/ux-shift-2026-09-02/EXPERIENCE.md`)

**Components, after "Hours table".**

NEW bullet:

> "**Hours export.** One secondary action on Organization hours, `Izvezi u Excel`, admin-only. It exports the current period, filter and sort, and nothing else. While the file is being built the action shows progress and is disabled. There is no format picker in MVP."

**UJ-4.** After "the number explains itself without reconstruction", append: "Damir exports the month with `Izvezi u Excel` and sends it onward. The file matches the screen."

### 4.6 Sprint status (`implementation-artifacts/sprint-status.yaml`)

Under Epic 4, after `4-2-…`:

```yaml
  # Added 2026-09-26 by sprint change (sprint-change-proposal-2026-09-26-hours-export.md).
  4-3-an-admin-exports-the-month-s-hours-to-excel: backlog
```

## 5. Implementation Handoff

- **Scope:** Minor. The Developer agent applies the documentation edits directly in this workflow, on the branch `docs/correct-course-hours-export`, as one PR.
- **Deliverables:** the edits in §4, applied verbatim, plus this proposal.
- **Success criteria:**
  - A grep of the planning artifacts finds FR-42a in the PRD, Story 4.3 and UX-DR44 in the epics, the XLSX row in the Stack, and the export in EXPERIENCE.md.
  - The UJ-4 assumption is gone from §12.
  - sprint-status has the 4.3 key as backlog.
  - Nothing else changes.
- **Next, unchanged by this proposal:** Epic 3 continues with 3.2. Story 4.3 is built after 4.2 with `/bmad-build 4.3`, which regenerates `epic-4-context.md` from the updated artifacts.
