# Epic 3 Context: Anyone can read the schedule, and an admin can record what actually happened

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make the projected rota readable and correctable. Any member opens any month, past or future, and reads either their own schedule or every team's, filtered to one team or one person, with midnight-crossing shifts shown once on their start date. They can open a day to see who is actually rostered. An admin records what really happened: a team's shift type changed on one date, or a member added, removed or replaced on one shift. Each change is attributed and shows what it replaced, and the rotation rule itself is never touched. The epic proves "nothing derived is persisted" as strongly as it can be proved: remove every override and the schedule must equal the pure projection exactly. It also introduces the canonical one-snapshot-per-surface read model that later epics extend.

## Stories

- Story 3.1: Anyone reads a month
- Story 3.2: The month is readable on a phone, and by a screen reader
- Story 3.3: Filtering to one team or one person
- Story 3.4: Opening a day to see who is actually on it
- Story 3.5: An admin changes a team's shift type on one date
- Story 3.6: An admin adds, removes or replaces someone on a shift

## Requirements & Constraints

- **Schedule = projection + override layer.** `scheduledShift(team, date)` applies shift-type overrides to the projected type. `shiftRoster(team, date)` is the team's active members as at that date, changed by roster overrides. There is no generation step, and repeated reads agree.
- **Overrides never write to a rotation pattern or assignment.** Those rule rows are byte-identical before and after. Removing an override restores the projected value and the default roster exactly.
- **Replacing a member is one atomic action** that records both the removed and the added member, not a remove followed by an unrelated add. A member may be added to a shift on a date when their own team is not working. Hours follow the roster, so a replacement moves hours between those two members only.
- **Attribution.** Every override records its author, a timestamp and a **reason**, and that record outlives the schedule entry it changed. Removing an override is also attributable. There is no audit-log UI, but the data must let someone reconstruct who changed what and when.
- **Overridden state is visible.** It can be seen on the calendar and in a member's schedule without opening detail. The detail names the author, timestamp, reason and the projected value that was replaced.
- **Finishing the rotation-change work.** When a rotation change is applied, every override dated on or after its effective date is listed for the admin to confirm, amend or discard. None is dropped silently, and none is silently reapplied to a shift it was not written for. Epic 2 deferred this because no overrides existed yet.
- **Member filter.** It shows that member's shifts, including shifts held only through a roster override, and their leave once leave exists.
- **Rank and position are shown, never used.** Where the organization uses fire ranks, the roster, day detail and replacement candidates may show rank and position as information only. Nothing blocks, warns or suggests based on them, and neither is colour-coded or offered as a filter.
- **Performance.** An all-teams month at pilot scale renders within 2 s on a mid-range phone over a typical mobile network. Any month, visited or not, performs about the same. Both are measured on the pilot fixture in this epic.
- **Accessibility.** No state is shown by colour alone, and this is checked in the compressed grid, pips and badges. The calendar grid works from the keyboard. Every cell exposes its date, team, shift type, times and modifiers to assistive technology. The target is WCAG 2.1 AA.
- **Localization.** No hard-coded strings. Croatian needs three plural forms. Dates use `12.09.2026` and times `19:00–07:00` with an en dash, in the organization's timezone. `Smjena` means team and `Tip smjene` means shift type; never write *smjena* for a shift type.

## Technical Decisions

- **Only overrides are stored.** Schedules, shifts, rosters and conflicts are derived, so there are no `schedules`, `shifts` or `shift_members` tables. The new tables are `shift_type_overrides` (team, date) and `roster_overrides` (member, shift). Each is organization-scoped, with `organization_id` as its first column, and gets the standard RLS pattern: the organization comes from the JWT claim, and role and active status come from the `SECURITY DEFINER STABLE` helper. Member-role accounts are refused on writes, including direct API calls. Re-run the cross-tenant and direct-API refusal tests against the new tables.
- **Attribution comes from column defaults the client cannot forge.** Use `created_by uuid default auth.uid()` and `created_at timestamptz default now()`, with RLS `WITH CHECK (created_by = auth.uid())`. There is no server tier: writes go directly through PostgREST, and the only Edge Function is the auth boundary, which is not used here.
- **Illegal states are made impossible by schema shape** where they can be, for example FKs and uniqueness, rather than by client-side validation. Triggers are forbidden apart from the existing one that prevents an organization having zero admins.
- **All calculation lives in `packages/domain`.** It is pure TypeScript with no React, no Supabase and no I/O, shaped as `(config snapshot, exception layer, window) -> derived values`. Override application and roster derivation go there. The UI must not duplicate projection or modulo logic.
- **Versioned rules are selected by the date being derived.** These are rotation assignment, team membership (including position), member active status, pattern and steps, and shift-type times. Shift-type name, hour bands and rank are current-state.
- **Time is integer minutes since midnight**, measured on nominal wall-clock time. No `Date` object, `timestamptz` or instant enters a calculation. A midnight-crossing shift belongs to its start date.
- **One snapshot per surface.** The calendar is the first surface that defines the canonical `OrganizationSnapshot(window)`: configuration plus the exception layer for the window, fetched as one composite read under one query key. Surfaces narrow it by selecting fields and never define their own shape for it. Later epics extend it. A write invalidates exactly its surface's key. Hours, leave and conflict state are never updated optimistically.
- **The domain returns codes and operands, not prose.** Warnings and states have the shape `{ code, ...operands }`, and the i18n layer translates them.
- **Test without a browser.** Every rule gets a Vitest assertion in the node environment against both fixtures, the pilot and the UJ-5 security organization. Include the "all overrides removed equals the pure projection" assertion.
- **Deferred.** Materialization is revisited only if the 2 s budget is missed on real, measured data. There is no realtime; surfaces refetch.

## UX & Interaction Patterns

- **shift-cell.** The base fill comes from the shift type's ramp slot, and the label is always visible. Minimum height is 30 px, and the touch target is at least 44 px. The time range shows when the width allows and is **dropped, never abbreviated**, when it does not. Tapping a cell opens day detail. Shift cells use the small radius.
- **Modifiers** can be combined on any cell and with each other:
  - conflict: 2 px inset ring in `destructive` plus `⚠`
  - overridden: 2 px inset ring in `modifier-overridden` plus `✎`
  - leave: hatch fill plus `◷`
  - uncovered: hatch fill plus `◌`

  A **persistent legend** appears wherever these glyphs render, not in a tooltip or behind an info icon. `destructive` is reserved for conflicts, and the organization accent never touches a shift state.
- **Mode switch.** A segmented control with two modes, *Moj raspored* and *Sve smjene*. *Moj raspored* is the default for member-role accounts on mobile.
- **Filters.** A Select populated from live records that shows a count in its label. The all-teams option reads `Sve smjene (N)`, with its options under a labelled heading. One action resets the filter to all teams without leaving the calendar. Filter and mode survive month navigation within a session and are not kept across sessions.
- **Responsive layout.**
  - Phone (<640 px): the *Moj raspored* day list by default, with the compressed grid one tap away and teams as one-letter columns.
  - Tablet (640–1024 px): the full grid with team names.
  - Desktop (>1024 px): times visible in cells.

  The compressed grid is the same component as the full grid, not a separate mobile calendar. The page never scrolls sideways; the grid owns its own horizontal overflow.
- **Month navigation** is symmetric and unbounded in both directions. Loading shows skeletons that match the final layout, with no spinners, so a visited month and an unvisited one feel the same.
- **Empty states say what is true.** A member with no team gets an explanation, never a blank schedule.
- **Dialogs and confirmation.** Adding or editing a small record happens in a dialog. A destructive action, such as removing an override, needs one modal confirmation with neutral styling that names what is being removed. The dialog cannot be dismissed while the write is in flight. A refused save keeps the values the user entered.
- **Roster line format:** `Ime · čin · položaj`, where the organization uses ranks.

## Cross-Story Dependencies

- **Builds on Epic 2.** It uses the projection function, the versioned assignments and the shift-type slot ramp. It also uses Epic 2's rotation-change flow (2.6), which 3.5 extends with the override disposition review.
- **Builds on Epic 1.** It uses teams, versioned team membership and position, member active status, rank, the RLS helper and attribution defaults.
- **Order within the epic.** 3.1 defines `OrganizationSnapshot` and the calendar surface, which 3.2, 3.3 and 3.4 build on. The modifier and legend vocabulary from 3.2 is used by 3.5 (`✎`) and later by Epic 5 (`⚠`, `◷`, `◌`). The roster derivation in 3.4 is the base for the roster overrides in 3.6.
- **Downstream.**
  - Epic 4: hours follow the overridden roster.
  - Epic 5: conflicts are leave ∩ working shift ∩ roster including overrides. Replace Member is implemented as a roster override, and the before/after collision diff guards override and rotation writes.
  - Epic 6: the dashboards extend the same snapshot.
