# Epic 5 Context: Leave is recorded, and every collision is surfaced and decided

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An admin records a member's annual leave as a date range and sees what it costs before saving. Leave never removes a shift or touches the rotation. Instead, every working shift the member is rostered for on a leave date becomes a visible conflict. The conflict stands until an admin decides it: accept as uncovered, replace the member, or amend the leave. Each decision is attributable and is taken on its own screen, with its consequences stated in the same three terms. This is the product's distinguishing stance: an absence never silently becomes an uncovered shift that someone discovers on the day. Status (2026-10-02): 5.1–5.3 are done, including leave records, amend and removal, the member's leave view, the derived collision rule, the Raspored queue, the calendar marks and the conflict count on the hours surfaces. 5.4 and 5.5 remain. The approved UX redesign of 2026-10-01/02 folded decisions 15, 21, 22 and the ‹ › navigation half of 20 into 5.4, and decisions 25 and 26 into 5.5. The rest of the redesign is Epic 7.

## Stories

- Story 5.1: An admin records leave and sees what it costs first (done)
- Story 5.2: An admin amends or deletes leave, and the balance follows (done)
- Story 5.3: A collision with a rostered shift becomes a visible conflict (done)
- Story 5.4: An admin decides each conflict on its own screen
- Story 5.5: A configuration change cannot quietly erase a pending decision

## Requirements & Constraints

- **Leave.** A leave record is a date range for one member, entered by an admin only. Members never request leave or resolve conflicts. Cost is the number of dates in the range on which the member has a working shift. Non-working dates cost nothing, and a date with both `Dan` and `Noć` counts once. That rule is inferred, so it lives in one isolated function. Balance = allowance − days consumed in the current leave year. Overlapping ranges for one member are refused by the database. Going over the balance warns and never refuses. A member sees only their own leave.
- **Conflict.** A conflict is one rostered working shift whose member is on leave that date and that has no recorded resolution. Non-working shifts, members with no team, and a deactivated member's future dates raise nothing. Detection never deletes, hides or alters a shift. Nothing expires, auto-clears or suppresses a conflict, whether time passes or unrelated data changes.
- **Exactly three resolutions**, each recorded with the acting admin and a timestamp:
  - **Accept as uncovered.** The shift stays and is marked uncovered on the calendar. The absent member's hours become leave hours, not band hours.
  - **Replace member.** A roster override, with the rotation untouched. The replacement's band hours rise and the absent member's do not. It warns without blocking if the replacement is on leave or already rostered that date. The shift is then neither in conflict nor uncovered.
  - **Amend leave.** Recomputes cost, balance and conflicts. Deleting the record restores the balance and clears every conflict it caused.
- **Resolved conflicts.** A resolved conflict never reappears as unresolved. The queue, its header count, the calendar marks and the conflict count on Sati, Moji sati and the `.xlsx` export must all drop resolved collisions. Until 5.4 ships, "unresolved" means every derived collision.
- **Leave hours.** 5.4's accept-as-uncovered fills the leave-hours figure, which is still `leaveMinutes: 0` and renders empty on screen and in the export. A shift in unresolved conflict still counts in band hours, the total and the shift count.
- **Leave never silently reverts a replacement.** If a conflict was resolved by Replace member, amending or removing its leave must not silently revert the roster override. The admin is told. Today an amended record cannot be told apart from a removal followed by a new record, because there is no link from the new record to the old one. Add that link if 5.4 needs it.
- **Erasure guard (5.5).** Every write that can change the projected schedule computes the unresolved collision set before and after the change: rotation, roster override, membership and deactivation. Each collision the change would erase must be confirmed, amended or discarded before the change applies. Only an erasure blocks. The diff is bounded by the union of existing leave ranges intersected with the change's own validity range, never computed over all future dates.
- **Still open from earlier stories.**
  - **Positive leave figure.** No test yet renders a positive leave figure. The story that fills `leaveMinutes` (5.4b) adds one on screen and in the `.xlsx`.
  - **Decimal convention.** `formatNumber` defaults to two fraction digits, while ICU `#` in a plural drops trailing zeros. Day counts are whole and render as integers through the plural messages. If a non-integer day figure ever appears, decide the convention and record it.
  - **Overlap refusal.** It names the conflict and keeps every entered value.
  - **UJ-3, the reference journey for 5.4b and 5.4c.** Damir enters 10.09–16.09 for Ana (30 allocated, 12 used, 18 remaining) and sees the cost before saving. Four conflicts are queued soonest first. He resolves two by replacement and two as uncovered, each on its own screen.
- **Quality.** Every rule has a node-environment assertion against both fixtures. No literal strings in the UI. Croatian's three plural forms apply to days and conflicts, and day counts are integers. No horizontal page scroll at phone width. Every admin task completes on a phone.

## Technical Decisions

- **Pure domain.** `domain/leave` and `domain/collisions` are the only implementations of cost, balance and collision derivation. No database routine computes any of them, although declarative constraints are fine. They return numbers and codes, never strings. 5.5's before/after diff belongs to the `collisions` family. Epic 7's leave-dialog collision preview reuses it.
- **Conflicts are derived; only resolutions are stored.** A new `conflict_resolutions` table is keyed by `(organization_id, member_id, date, team_id)`, the key `collisionKeyOf` already produces. `team_id` matters because an override can put a member on two teams' shifts in one day. Each row stores its kind and attribution (`created_by default auth.uid()`, `created_at default now()`, `WITH CHECK (created_by = auth.uid())`). Replace and amend resolutions reference the override or leave change they caused. Rows hold current state. `organization_id` comes first, and RLS reads the organization from the JWT claim.
- **Writes and reads.** Each surface reads one snapshot under one query key, and every figure derives from it. Writes are direct PostgREST or definer calls. Each write invalidates its own key and every dependent key: calendar, hours, queue and member leave. There are no optimistic updates for hours, balance or conflict state.
- **Migrations** are forward-only. Parallel sessions share the database stack, so check the main checkout for untracked migrations before picking a number.
- **5.5 placement.** The guard goes into the existing rotation save confirmation dialog, next to the non-blocking rotation warnings. A roster-override disposition is still pending from 3.6: pending overrides should be listed for confirm, amend or discard in the builder's review card, as shift-type overrides already are. It belongs beside this guard.

## UX & Interaction Patterns

- **Resolution screen (5.4).** Reached from a queue row. The header shows the position, for example "Konflikt 2 od 7". Below it are the facts: shift, team, date, the absent member with rank and position, the leave range with its cost and author, and who else works that day. Then come three `resolution-option` radio cards in a fixed order (uncovered, replace, amend), forming one arrow-key radio group. Nothing is preselected, no card is primary-styled or labelled recommended, and the selected card gets a border and a filled radio, not a new background. "Spremi odluku" stays disabled until one card is chosen, with a sentence saying why. On a phone the cards stack and each consequence strip becomes three columns.
- **Consequence strip.** Every card has the same three terms in the same order: coverage (for example "3 od 4 člana · Nepokriveno"), the absent member's hours ("12 h kao godišnji" or "12 h rada") and the leave balance ("16 dana preostalo · bez promjene" or "+1 dan"). The strip updates as choices are made inside a card.
- **Replace candidates.** The picker opens inside the card. Candidates show rank and position as information only, grouped `slobodan` / `radi taj dan · 24 h bez pauze`. The groups inform and never block. Build the grouping as one helper, because Epic 7's roster dialog (7.9) reuses it.
- **Amend option.** It shows the computed start date that would clear this conflict, for example "godišnji počinje 03.10.". The date is unselected and not labelled recommended. Saving opens the leave amend with that date filled in.
- **‹ ›** move to the adjacent unresolved conflict in queue order, without saving.
- **After a decision.** The screen returns to the queue. A `Notice role="status"` line names what was saved, and the count and the tab badge drop. The line disappears on navigation. It is not a toast and is stored nowhere.
- **Queue.** Two groups: upcoming conflicts soonest first, then a separate section of past unresolved ones, newest first, muted and marked `prošlo`. The count shows even at zero (`0 neriješenih konflikata`), with copy that states what is true. There are no checkboxes, no select-all and no bulk action anywhere. The mockup also has Neriješeni / Riješeni tabs. The Riješeni history is story 7.16, not 5.4.
- **5.5 dialog.** The rotation save dialog shows the warnings in numbers, and they never block. Each collision the change would erase is listed as its own row with `⚠`, the shift and the reason, and "Potvrdi brisanje" / "Zadrži" actions. Saving waits until every row has a decision. Rotation settings also get a sticky save bar with `Spremi` and `Odbaci promjene` that stays in reach while there are unsaved changes, and it repeats "Vrijedi od".
- **Signals.** `destructive` is used only for unresolved conflicts, as an inset 2 px ring plus `⚠`, and never for delete buttons or errors. Leave is a hatch plus lucide `Clock`, uncovered is a hatch plus lucide `CircleDashed`, both drawn in the slot's own foreground. A legend is always visible. Nothing is signalled by colour alone. Removing anything takes one neutral confirmation step. Loading uses skeletons, never spinners. Members see no conflict marks.

## Cross-Story Dependencies

- **Upstream.** Epic 3 provides roster overrides (Replace member reuses them) and the calendar modifiers. Epic 4 provides `domain/hours` with its leave column, and the hours table and export. 5.3 provides `collisionsOf` and `collisionKeyOf`, the Raspored queue, the calendar marks and the hours conflict counts. 5.4 must filter all of these by resolution.
- **Within the epic.** 5.5 needs 5.4's resolutions and adds a guard to Epic 2 and 3 configuration saves. It is the one place where a later epic changes an earlier epic's surface.
- **Downstream.** Epic 6's admin Danas "Treba tebe" card shows the unresolved count even at zero, and that count must equal the queue exactly. Epic 7 reuses 5.4's candidate-grouping helper (7.9), adds the resolved-conflicts history (7.16) and adds the leave dialog that previews conflicts using 5.5's diff (7.12). The order is 5.4 → 5.5 → 7.1–7.4 → Epic 6.
