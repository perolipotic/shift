# Epic 4 Context: Hours compute themselves

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Hours are derived, never entered. A member sees their own shift counts, hours per band, total and leave hours for a period. An admin sees the same figures for everyone, sortable and filterable, and can explain any figure. The admin can also export the month to an Excel file that matches the screen exactly. Nobody enters or reconciles an hour by hand, and a member's figures always equal the admin's view of that member. This is the epic the second fixture (the UJ-5 security organization) exists for. The pilot's bands coincide with its shift changeovers and never split a shift, so band splitting is proven only against the security fixture. The leave-hours column is created here and stays empty until Epic 5 brings leave records. Epic 4 is complete for every hour actually worked. Status: all three stories are in the backlog. Epic 3 (overrides and roster changes) is done up to 3.6b.

## Stories

- Story 4.1: A member sees their own hours, split by band
- Story 4.2: An admin sees hours for everyone and can explain any figure
- Story 4.3: An admin exports the month's hours to Excel

## Requirements & Constraints

- **What is computed.** For each member and period: the shift count, the hours in each hour band, the total hours and the leave hours. Shift counts per band are reported next to hours, because "5 day shifts, 60 hours" is how people check the numbers.
- **Band intersection.** Band hours come from intersecting each working shift's nominal wall-clock interval with the organization's bands. They always sum exactly to the shift's nominal duration. Total hours equals the sum of nominal durations of the member's working shifts. Assert this invariant, including across randomized configurations.
- **Split, never round.** With bands starting at 06:00 and 21:00, a 19:00–07:00 shift gives 3 day hours and 9 night hours. Under the pilot's bands (07:00 and 19:00) the same shift does not split: five `Dan` and four `Noć` shifts give 60 day hours, 48 night hours, 108 in total, with counts 5 and 4. A single 07:00–07:00 type under the pilot's bands gives 12 and 12.
- **Midnight crossing.** A midnight-crossing shift is one continuous interval. It contributes its full duration once, to the period of its start date. A band may also cross midnight, and its intersection with a crossing shift is computed as one continuous interval.
- **DST.** A 12-hour shift on each daylight-saving transition date reports 12 hours with an unchanged split. Elapsed real time never enters a total.
- **Hours follow the roster, overrides included.** A roster override moves hours from the removed member to the added member and affects nobody else. A non-working shift type contributes zero.
- **Current-state bands.** Moving a band boundary recomputes band hours retroactively, including for past periods. It changes no total and no shift-type record. Shift-type times are versioned, so editing times does not change past hours.
- **Leave hours** are never added into band hours or the total. The column exists now and is empty until Epic 5.
- **Conflicts.** A shift in unresolved conflict is shown in a distinct state, in the member view, the organization view and the export, so no total is silently wrong. Conflicts arrive in Epic 5, so the state must be representable before any conflict exists.
- **Period** is at least a calendar month.
- **The organization hours view** is admin-only. It is sortable and filterable by team and member, and reachable in one navigation step from the admin dashboard. The same member's figures reconcile exactly across both views.
- **Export (4.3).** An `.xlsx` file with exactly the rows, order and figures on screen for the current period, filter and sort. Columns: Member, Team, shift count, one column per band named by the organization's bands, Total, Leave Hours. Every figure is a number, not text. Headers, sheet name and file name come from i18n, and the file name carries the organization and the period. There is no export for member-role accounts, not even of their own hours. CSV, PDF and payroll formats are out of scope. There are no pay rates, overtime or period locking.
- **Localization.** No literal strings. Numbers and plurals go through the central locale layer, which handles Croatian's three plural forms for hours and shifts. Band, team and shift-type names are organization data: they are displayed as stored, never translated, and no code matches on them. Nothing in code names "day" or "night".
- **Quality.** No horizontal page scroll at phone width. A member reads their hours on a phone. The all-teams budget of two seconds on a mid-range phone still holds.

## Technical Decisions

- **`packages/domain` holds the only hour calculation** (`domain/hours`). It is pure TypeScript with zero runtime dependencies, no React, no Supabase and no I/O. Its shape is `(config snapshot, exception layer, window) -> derived values`. It builds on the existing projection, rosters and bands modules. Recomputing hours anywhere else is a defect, even when the answer matches. The export adds no code or dependency to the domain package.
- **Time is integer minutes since midnight, over nominal wall-clock.** No `Date`, no `timestamptz` and no instant in the calculation. Duration is derived: when `end <= start`, add 1440.
- **The domain returns numbers and codes, never formatted strings.** It returns `12`, never `"12 sati"`. The conflict state is returned as data too.
- **One snapshot per surface.** My hours and Organization hours each load one composite payload (config plus exception layer for the window) under one query key, from `features/<module>/services/snapshot.ts`. Every figure on a surface derives from that snapshot. The export renders the snapshot the table already rendered and never makes a second read. Extend the existing snapshot patterns rather than adding parallel queries.
- **No optimistic updates** for hours, leave balance or conflict state. A figure waits and does not flicker.
- **No schema change is expected.** Nothing derived is stored: there is no hours table. Admin-only access to the export is inherited from the existing reads, and no new RLS path is added.
- **XLSX writer.** It is a new client-side runtime dependency, in `apps/web` only. Choose and pin it in 4.3 and record it in the Stack table. Lazy-load it on the export action so it never enters the main bundle. There is no Edge Function and no server runtime.
- **Tests.** Use Vitest in the node environment with no browser. Every rule is asserted against both the pilot fixture and the security fixture, including the band-split cases, both DST dates, midnight-crossing intersection and the sum invariant. A rule exercised only through a rendered component does not count as covered. 4.3 adds an E2E test for the download, and E2E specs go through page objects.

## UX & Interaction Patterns

- **Navigation.** Member tab *Sati* opens My hours ("How much have I worked?"). The admin sidebar group *Sati* opens Organization hours. On a phone, hours rank after today's shift, next shift and calendar.
- **Hours table.** Tabular numerals (the `numeric` token). Sortable and filterable by team and member. It scrolls inside its own container, never the page.
- **Hours export.** There is one secondary action, `Izvezi u Excel`, on Organization hours only, for admins only. It shows progress and is disabled while the file is being built. There is no format picker.
- **Numbers the product is trusted for.** Skeleton loading, no spinners and no optimistic figures. The conflict state is never conveyed by colour alone: use the `⚠` glyph and keep `destructive` for conflicts.
- **UJ-4.** Damir picks September. He sees every member with counts, band hours, total and a separate leave column. He drills into a low total and finds it explained by the reassigned shifts. Then he exports, and the file matches the screen.

## Cross-Story Dependencies

- **Upstream.**
  - Epic 2 provides the hour bands, the shift types with derived duration, the projection, and both fixtures.
  - Epic 3 provides the roster derivation with shift-type and roster overrides, the snapshot pattern, and the calendar's conflict and leave modifiers. Hours must follow the overridden roster.
- **Within the epic.**
  - 4.1's `domain/hours` is the single computation that 4.2 reuses. Reconciliation between the two views holds because both use it.
  - 4.3 depends on 4.2's table and snapshot, including its filter and sort state.
- **Downstream.**
  - Epic 5 fills the leave-hours column. It uses the rule that hours of a leave-covered working shift count as leave hours, and that replace-member moves band hours. Epic 5 also supplies the unresolved-conflict state. The table and the export should need no change when either arrives.
  - Epic 6's member dashboard shows band hours and the total. Every dashboard figure must equal this epic's detail view, which is guaranteed by the one-snapshot rule.
