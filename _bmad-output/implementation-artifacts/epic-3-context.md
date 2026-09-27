# Epic 3 Context: Anyone can read the schedule, and an admin can record what actually happened

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make the projected rota readable and correctable. Any member opens any month, past or future, and reads their own schedule or every team's, filtered to one team or one person. Midnight-crossing shifts render once, on their start date. A member can open a day to see who is actually rostered. An admin records what really happened: a team's shift type changed on one date, or a member added, removed or replaced on one shift. Each change is attributed and shows what it replaced. The rotation rule itself is never touched. The epic proves "nothing derived is persisted" as strongly as it can be proved: remove every override and the schedule equals the pure projection exactly. Status: 3.1 to 3.4 are done. Story 3.5 is split into three parts: 3.5a (record and display the override) has landed, 3.5b (the admin's set and remove form) and 3.5c (disposition of overrides on a rotation change) remain. Story 3.6 is in the backlog.

## Stories

- Story 3.1: Anyone reads a month
- Story 3.2: The month is readable on a phone, and by a screen reader
- Story 3.3: Filtering to one team or one person
- Story 3.4: Opening a day to see who is actually on it
- Story 3.5: An admin changes a team's shift type on one date
- Story 3.6: An admin adds, removes or replaces someone on a shift

## Requirements & Constraints

- **The schedule is the projection plus an override layer.** Shift-type overrides replace the projected type for a (team, date). The roster is the team's active members as at that date, changed by roster overrides. There is no generation step.
- **Overrides never write to a pattern or an assignment.** Those rows are byte-identical before and after an override. Removing an override restores the projected value and the default roster exactly.
- **Replacing a member is one atomic action.** It records both the removed and the added member. A member may be added to a shift on a date when their own team is not working. Hours follow the roster.
- **Attribution.** Every override records its author, a timestamp and a reason, and that record outlives the entry it changed. There is no audit-log UI.
- **Overridden state is visible without opening detail.** The detail names the author, the timestamp, the reason and the projected value that was replaced.
- **Rotation change disposition (completes CAP-9).** When a rotation change is applied, every override dated on or after its effective date is listed for the admin to confirm, amend or discard. None is dropped silently, and none is reapplied to a shift it was not written for.
- **The member filter** includes shifts a member holds only through a roster override. These arrive with 3.6.
- **Rank and position are information only.** They may appear in the roster, the day detail and the replacement candidates. Nothing blocks, warns or suggests from them. They get no colour coding and are not a filter.
- **Performance.** An all-teams month at pilot scale renders within 2 s on a mid-range phone over a typical mobile network. An unvisited month performs like a visited one.
- **Accessibility.** No state is shown by colour alone. Every state has a glyph or fill treatment, asserted for each state as it lands. Cells expose their date, team, shift type, times and modifiers to assistive technology. The grid works from the keyboard. The target is WCAG 2.1 AA, and every state must stay legible in both themes.
- **Localization.** No hard-coded strings, and Croatian needs three plural forms. Dates are written `12.09.2026` and times `19:00–07:00`, in the organization's timezone. `Smjena` means a team and `Tip smjene` means a shift type.

## Technical Decisions

- **Only overrides are stored.** There are no tables for schedules, shifts, shift members or conflicts. `shift_type_overrides` is keyed by (team, date) and exists since migration 0019. `roster_overrides` is keyed by (member, shift) and comes with 3.6. Both are organization-scoped, with `organization_id` as the first column, and use the standard RLS helper pattern. Member-role writes are refused, including direct API calls. Re-run the cross-tenant and direct-API refusal tests against each new table.
- **Attribution comes from column defaults.** Use `created_by uuid default auth.uid()` and `created_at timestamptz default now()`, with RLS `WITH CHECK (created_by = auth.uid())`. Writes go directly through PostgREST, with no server tier and no new function.
- **Schema shape over validation.** Use FKs and uniqueness. Triggers are forbidden apart from the existing zero-admins trigger.
- **All calculation lives in `packages/domain`.** It is pure TypeScript with no React, no Supabase and no I/O: `(config snapshot, exception layer, window) -> derived values`. Override application and roster derivation belong there. The UI never re-derives.
- **Versioned rules are selected by the date being derived.** These are the assignment, the team membership and position, the active status, the pattern and steps, and the shift-type times. The shift-type name, the hour bands and the rank are current-state.
- **Time is integer minutes since midnight, over nominal wall-clock.** No `Date` enters a calculation. A midnight-crossing shift belongs to its start date.
- **One snapshot per surface.** The calendar's composite read lives in `features/calendar/services/snapshot.ts` under one query key. Later epics extend it. A write invalidates exactly its surface's key. Nothing is updated optimistically for hours, leave or conflicts.
- **Any write that can change the projected schedule** must, once leave exists, diff the unresolved collision set before and after. It surfaces every erased collision for disposition before it applies. This covers override writes and rotation writes.
- **The domain returns codes and operands, not prose.** Output has the shape `{ code, ...operands }` and i18n renders it.
- **Source layout.** Pages in `apps/web/src/pages/` only compose: no query, mutation or derivation. Feature code goes in `features/<m>/{components,hooks,services,utils}`. There are no `index.ts` barrels. Cross-feature imports are allowed only through modules listed in `FEATURE_PUBLIC`, and the `shift/feature-boundaries` lint rule enforces this. E2E specs drive screens through page objects in `e2e/pages/`, which hold locators and actions and no assertions.
- **Tests.** Every rule gets a Vitest assertion in the node environment against the pilot fixture and the security fixture, including "all overrides removed equals the pure projection". There is no realtime: surfaces refetch.

## UX & Interaction Patterns

- **shift-cell.** The base fill comes from the shift type's ramp slot, and the label is always visible. The minimum height is 30 px and the touch target is at least 44 px. The time range is shown when it fits and dropped, never abbreviated, when it does not. Tapping a cell opens the day detail.
- **Modifiers are a fixed set, and they compose.**
  - Overridden: a 2 px inset ring in `modifier-overridden` plus `✎`.
  - Conflict: a `destructive` ring plus `⚠`.
  - Leave: a hatch plus `◷`.
  - Uncovered: a hatch plus `◌`.

  A persistent legend appears wherever these glyphs render. `destructive` is reserved for conflicts, and the organization's accent never marks a shift state.
- **Mode, filter and navigation.** The mode switch offers *Moj raspored* and *Sve smjene*. The filter Select shows a count, and its all-teams option reads `Sve smjene (N)`. One action clears the filter. Filter and mode survive month navigation but not the session. Navigation is symmetric and unbounded, and loading shows skeletons, not spinners.
- **Layout.** Below 640 px a member sees the day list by default, with the compressed one-letter grid one tap away. That grid is the same component as the full grid. The page never scrolls sideways.
- **Dialogs.** A small record is added or edited in a dialog. Removing an override needs one neutral modal confirmation that names what is being removed. A dialog cannot be dismissed while its write is in flight, and a refused save keeps what the user entered. Screens compose the shared primitives and never restyle them.
- **Roster line:** `Ime · čin · položaj`, where the organization uses ranks.

## Cross-Story Dependencies

- **Upstream.** Epic 1 provides the teams, versioned membership and position, active status, rank, the RLS helper and the attribution defaults. Epic 2 provides the projection, the versioned assignments, the slot ramp and the rotation-change flow of 2.6, which 3.5c extends with override disposition.
- **Within the epic.**
  - The snapshot and calendar surface from 3.1 carry 3.2 to 3.4.
  - The `✎` modifier from 3.2 is used by 3.5.
  - The roster derivation from 3.4 is the base for the roster overrides in 3.6.
  - 3.5a's read and display path is the base for 3.5b's form and for 3.5c.
- **Downstream.**
  - Epic 4: hours and the Excel export follow the overridden roster, from the same snapshot.
  - Epic 5: a conflict is leave ∩ working shift ∩ roster, including overrides. Replace-member is a roster override. The before/after collision diff guards override writes.
  - Epic 6: the dashboards extend the same snapshot.
