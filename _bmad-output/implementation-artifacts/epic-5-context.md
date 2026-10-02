# Epic 5 Context: Leave is recorded, and every collision is surfaced and decided

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An admin records a member's annual leave as a date range and sees what it costs before saving. Leave never removes a shift or touches the rotation. Instead, every working shift the member is rostered for on a leave date becomes a visible conflict, and it stays until an admin decides it: accept as uncovered, replace the member, or amend the leave. Each decision is attributable, is taken on its own screen, and states its consequences in the same three terms. This is the product's distinguishing stance: an absence never silently becomes an uncovered shift that someone discovers on the day. Status (2026-10-02): 5.1–5.3 are done. In 5.4, the resolutions store with its unresolved filter (5.4a), the resolution screen with accept-as-uncovered (5.4b) and replace member (5.4c) are done. Amend leave (5.4d) and the erasure guard (5.5) remain.

## Stories

- Story 5.1: An admin records leave and sees what it costs first (done)
- Story 5.2: An admin amends or deletes leave, and the balance follows (done)
- Story 5.3: A collision with a rostered shift becomes a visible conflict (done)
- Story 5.4: An admin decides each conflict on its own screen (5.4a, 5.4b, 5.4c replace member done; 5.4d amend leave open)
- Story 5.5: A configuration change cannot quietly erase a pending decision

## Requirements & Constraints

- **Leave.** Only an admin enters leave. Members never request leave or resolve conflicts, and a member sees only their own leave. Cost is the number of leave dates on which the member has a working shift. Balance = allowance − days used in the current leave year. Going over the balance warns and never refuses. The database refuses overlapping leave.
- **Conflict.** A conflict is a rostered working shift whose member is on leave that date and that has no live resolution. Detection never deletes, hides or alters a shift. Nothing expires, auto-clears or suppresses a conflict, neither the passing of time nor an unrelated data change.
- **Exactly three outcomes**, each recorded with the acting admin and a timestamp:
  - **Accept as uncovered** (shipped). The shift stays and is marked uncovered. The absent member's hours become leave hours, not band hours.
  - **Replace member.** A roster override, with the rotation untouched. The replacement gains band hours and the absent member does not. If the replacement is on leave or already rostered that date, the outcome warns and never blocks. The shift is then neither in conflict nor uncovered. The override and its resolution are written atomically.
  - **Amend leave.** Recomputes cost, balance and conflicts. Removing the leave restores the balance and clears every conflict it caused.
- **Leave never silently reverts a replacement.** If a conflict was resolved by Replace member, amending or removing its leave must tell the admin before it reverts that override. The leave call soft-removes resolutions inside the database, so this check runs before that call. 5.4d also decides what, if anything, an `amend_leave` row records, because an amend that uncovers a date already clears its conflict by derivation.
- **Resolution lifetime.** A resolution lives while live leave of that member covers its date. Only leave changes end one. Open question for 5.4c and 5.5: a later override, rotation or membership change on the same key can make a collision reappear while the old resolution still hides it, or can leave the resolution matching nothing.
- **Erasure guard (5.5).** Every write that can change the projected schedule computes the unresolved collision set before and after the change: rotation, roster override, membership and deactivation. Each collision the change would erase is confirmed, amended or discarded before the change applies. Only an erasure blocks, never a warning. The diff is bounded by the union of existing leave ranges intersected with the change's validity range.
- **Quality.** Every rule has node assertions against both fixtures. No literal UI strings. Days and conflicts use Croatian's three plural forms through ICU. No horizontal scroll at phone width, and every admin task completes on a phone. The resolution radio group needs a test that drives two or more cards with the arrow keys.

## Technical Decisions

- **Pure domain.** `domain/leave` and `domain/collisions` are the only implementations of cost, balance and collision derivation. No database routine computes them; declarative constraints are fine. They return numbers and codes, never strings. 5.5's before/after diff belongs to the `collisions` family, and Epic 7's leave dialog (7.12) reuses it for its preview.
- **Conflicts are derived; only resolutions are stored.** `conflict_resolutions` is keyed by `(organization_id, member_id, date, team_id)`. `team_id` matters because an override can put a member on two teams in one day. Attribution comes from column defaults (`created_by default auth.uid()` plus `WITH CHECK`). Replace and amend rows reference the override or leave change they caused. A resolution is never keyed on the leave record. Every unresolved surface (the queue and its count, the calendar marks, the hours counts and the export) filters through the one `unresolvedCollisionsOf`.
- **Reads and writes.** Each surface reads one snapshot and derives every figure from it. Writes are direct PostgREST or definer calls, and each invalidates its own key and every dependent key it declares. There are no optimistic updates for hours, balance or conflict state.
- **Migrations** are forward-only. Parallel sessions share the stack, so check the main checkout for untracked migrations before picking a number.
- **5.5 placement.** The guard lives in the existing rotation save confirmation dialog, next to the non-blocking warnings. Pending roster overrides are still not dispositioned in the rotation builder's review card, as shift-type overrides are. That deferred work belongs beside this guard.

## UX & Interaction Patterns

- **Resolution screen.** One route per conflict, reached from a queue row. It shows "K od N", ‹ › to the adjacent unresolved conflict without saving, and the facts. Below the facts, `resolution-option` radio cards sit in a fixed order: uncovered, replace, amend. They form one arrow-key group. Nothing is preselected, no card is primary-styled or labelled recommended, and the selected card gets a border and a filled radio, not a new fill. "Spremi odluku" is disabled until a card is chosen. Once all three cards exist, the hint is "Odaberi jednu od tri odluke."
- **Consequence strip.** Each card states three terms in the same order: coverage, the absent member's hours ("12 h kao godišnji" / "12 h rada"), and the balance ("… dana preostalo · bez promjene" / "+1 dan"). The strip updates as choices are made inside a card.
- **Replace candidates.** They open inside the card and show rank and position as information only. They are grouped `slobodan` / `radi taj dan · 24 h bez pauze`, and the groups inform, never block. The grouping is one helper, reused by 7.9's roster dialog.
- **Amend option.** It shows the computed start date that would clear this conflict, for example "godišnji počinje 03.10.". The date is unselected and not labelled recommended. Saving opens the leave amend with that date filled in.
- **After a decision.** The screen returns to the queue with a `Notice role="status"` naming what was saved. It is not a toast, it is carried in router state only, and it is gone on navigation.
- **No bulk action anywhere**: no checkboxes and no select-all. The Riješeni history is 7.16, not this epic.
- **5.5 dialog.** Each erased collision is its own row with `⚠`, the shift and the reason, plus "Potvrdi brisanje" / "Zadrži". Saving waits until every row is decided. Rotation settings also get a sticky save bar (`Spremi`, `Odbaci promjene`, repeating "Vrijedi od") while changes are unsaved.
- **Signals.** `destructive` marks only unresolved conflicts (an inset ring plus `⚠`). Uncovered is a hatch plus `CircleDashed`, and leave is a hatch plus `Clock`. Nothing relies on colour alone. Removal takes one neutral confirmation step. Members see no conflict or uncovered marks.

## Cross-Story Dependencies

- **Upstream.** 5.4c reuses Epic 3's roster overrides. Epic 4's `domain/hours` takes the accepted-uncovered list for leave hours. 5.4c and 5.4d plug into 5.4b's screen at card positions 2 and 3.
- **Within the epic.** 5.5 needs 5.4's resolutions and adds a guard to Epic 2 and 3 configuration saves. It is the one place a later epic changes an earlier epic's surface, so it ships last.
- **Downstream.** Epic 6's admin "Treba tebe" count must equal the queue, zero included. Epic 7 reuses the candidate-grouping helper (7.9) and the 5.5 diff (7.12 preview), and adds resolved history (7.16). The order is 5.4 → 5.5 → 7.1–7.4 → Epic 6.
