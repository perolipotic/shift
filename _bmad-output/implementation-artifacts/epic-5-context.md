# Epic 5 Context: Leave is recorded, and every collision is surfaced and decided

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An admin records a member's annual leave as a date range and sees what it costs before saving. Leave never removes a shift or touches the rotation. Instead, every working shift the member is rostered for on a leave date becomes a visible conflict. The conflict stands until an admin decides it: accept as uncovered, replace the member, or amend the leave. Each decision is attributable and taken on its own screen, with its consequences stated in the same three terms. This is the product's distinguishing stance: an absence never silently becomes an uncovered shift discovered on the day. Epic 5 also fills the leave-hours column that Epic 4 left empty, and supplies the unresolved-conflict state that Epic 4's hours surfaces must show. Status: all five stories are in the backlog. Epics 2–4 are done.

## Stories

- Story 5.1: An admin records leave and sees what it costs first
- Story 5.2: An admin amends or deletes leave, and the balance follows
- Story 5.3: A collision with a rostered shift becomes a visible conflict
- Story 5.4: An admin decides each conflict on its own screen
- Story 5.5: A configuration change cannot quietly erase a pending decision

## Requirements & Constraints

- **Leave record.** A date range for one member, entered by an admin only. Members never request leave or resolve conflicts. Annual leave is the only absence type: no reason field, part days, carry-over, accrual or holiday calendar.
- **Cost.** The count of dates in the range on which the member has a working scheduled shift. Non-working dates cost nothing. A pilot date with both `Dan` and `Noć` counts as one date. Show the cost before saving, and recompute it when an override changes whether a date is working. This counting rule is inferred, not confirmed by the pilot. It is the highest-cost open question, so it must live in one isolated function whose answer can change without a schema change.
- **Worked example.** Leave 10.09–14.09 over `Dan`, `Noć`, `Slobodno`, `Slobodno`, `Dan` costs 3 leave days and raises 3 conflicts.
- **Overlap refused.** A range overlapping an existing record for the same member is refused by the database, not by the interface. The refusal names the conflict and keeps every entered value.
- **Over-balance warns.** Leave whose cost exceeds the balance saves with a warning, never a refusal.
- **Balance.** Balance = allowance − leave days consumed in the current leave year. The three figures agree at every observable moment. Only days inside the current leave year count, and the leave year need not be the calendar year. Allowance is current-state, per member, in whole days. Changing it recomputes the balance and invalidates no record. Deleting a record restores the balance. Amending a record recomputes cost, balance and conflicts.
- **Member view.** A member sees their own allowance, days used and balance, and nobody else's leave.
- **Conflict.** A conflict exists when a working shift's roster includes a member on leave that date and no resolution is recorded. There is one conflict per affected working shift. A non-working shift raises nothing. Detection deletes, hides and alters no shift. Nothing expires, auto-clears or suppresses a conflict. A member with no team, or a deactivated member's future dates, raises nothing.
- **Exactly three resolutions**, each recording the acting admin and a timestamp:
  - **Accept as uncovered.** The shift stays and is marked uncovered on the calendar. The absent member's hours count as leave hours.
  - **Replace member.** This is a roster override. The replacement's band hours rise and the absent member's do not. It warns without blocking if the replacement is on leave or already rostered that date. Where the organization uses fire ranks, candidates may show rank and position, as information only.
  - **Amend leave.** Recomputes per the balance rule. Deleting the record clears every conflict it caused.
- **Leave never silently reverts a replacement.** Deleting or amending leave whose conflict was resolved by Replace member must not silently revert that roster override. The situation is surfaced to the admin.
- **Leave hours.** The nominal durations of leave-covered working shifts are reported as leave hours. They are never added into band hours or the total.
- **Queue.** Unresolved conflicts are listed soonest first, with date, team, shift type, member and the causing leave record. Past unresolved conflicts stay listed and are visually distinguished from upcoming ones.
- **Erasure guard (5.5).** Any write that can change the projected schedule (rotation, roster override, membership, deactivation) computes the unresolved collision set before and after. It surfaces every collision it would erase for confirm, amend or discard, and is not applied until they are dispositioned. Only an erasure blocks, never a warning. The diff is bounded by the union of existing leave ranges intersected with the change's validity range.
- **Quality.** Every rule above has a node-environment assertion against both fixtures, including the overlap refusal. There are no literal strings, and Croatian's three plural forms apply to days and conflicts. No horizontal page scroll at phone width. Every admin task completes on a phone.

### Carried constraints from earlier epics

- **Conflict state on the hours surfaces (Epic 4 retro R1).** 5.3 and 5.4 must give the unresolved-conflict state to the hours surfaces, not only the calendar: `MemberHours`/`MyHoursView`, `OrganizationHoursRow` and the `.xlsx` row. `hoursExportOf` is the one mapping point for the export. Each surface shows the state distinctly, so no total is silently wrong. This closes the unmet 4.3 AC.
- **Leave figure fills itself.** The leave figure currently renders empty (a dash on screen, an empty cell in the file) because `domain/hours` returns `leaveMinutes: 0`. Epic 5 makes that value real. No test yet renders a positive leave figure, so add one once leave is seeded.
- **Leave overlay on `shift-slot-2`.** In the light theme, slot-2 (the pilot's `Noć`) is inverted. The fixed `modifier-leave` and `modifier-uncovered` foregrounds measure about 1.8:1 over it. Draw the leave and uncovered hatch and glyph in the slot's own foreground, then restore slot-2 to the overlay sweep in `test/theme-contrast.test.ts`. Leave on a night shift is exactly Epic 5's conflict case.
- **Decimal convention.** `formatNumber` defaults to two fraction digits, while ICU `#` in a plural message drops trailing zeros (`1.234,50` against `1.234,5 dana`). Hours avoided decimals, so the decision passes to the leave balance. Allowance and cost are whole days, so render day counts as integers through the plural messages. Decide and record the convention if any non-integer day figure appears.

## Technical Decisions

- **Domain modules.** `packages/domain` gains `leave` (leave-day counting, balance) and `collisions` (conflict derivation, collision-set diff). They are pure TypeScript with no React, no Supabase and no I/O. Each is the single canonical implementation: no database routine computes a cost, a balance or a conflict. A declarative constraint is allowed, because it is not a calculation. The domain returns numbers and codes, never formatted strings.
- **Conflicts are derived, not stored.** There is no conflicts table. A collision is `leave ∩ working shift ∩ roster`, computed on read. Only a `conflict_resolutions` row is stored, keyed by `(organization_id, member_id, date, team_id)`, with its kind and attribution. `team_id` is load-bearing: a roster override can put a member on another team's shift the same day, which gives two distinct collisions. Replace-member and amend-leave resolutions reference the override or leave change they caused. Resolutions are current-state rows.
- **Schema shape over checks.** `leave_records` refuses overlap with `EXCLUDE USING gist (member_id WITH =, during WITH &&)`, which needs `btree_gist`. `organization_id` is the first column, and RLS reads the organization from the JWT claim. Leave records and resolutions carry `created_by default auth.uid()` and `created_at default now()`, with `WITH CHECK (created_by = auth.uid())`. Migrations are forward-only. Check the main checkout for untracked migrations before picking a number.
- **Snapshots and writes.** One snapshot per surface under one query key. Leave, conflicts and hours figures derive from it. Writes are direct PostgREST calls. They invalidate their own key and every dependent key (calendar, hours, queue, member leave). No optimistic updates for leave balance, hours or conflict state.
- **Leave year** comes from organization settings (start day 1–28 and month), and dates resolve in the organization timezone.

## UX & Interaction Patterns

- **Surfaces.** My leave (member tab *Godišnji*: "How much is left?"), leave management (admin, from the member's record), Conflicts queue and Conflict resolution (admin sidebar group *Raspored*).
- **Resolution screen.** Three `resolution-option` radio cards in a fixed order, forming an arrow-navigable radio group. Exactly one can be selected. None is primary-styled or labelled recommended, and nothing is preselected or suggested. Each option carries a `consequence-strip` with three terms in a fixed order: coverage, the absent member's hours, the leave balance.
- **No bulk resolution anywhere.** Amending a leave record still clears every conflict it caused, because that removes the cause and is not batching.
- **Signals.** `destructive` is reserved for unresolved conflicts: an inset 2 px ring plus `⚠`. It is never used for delete buttons or errors. Uncovered uses hatch plus `◌`, and leave uses hatch plus `◷`. Use non-Unicode or covered marks, because Geist lacks U+25F7 and U+25CC. Keep a persistent legend wherever glyphs render. No state is conveyed by colour alone.
- **Deleting leave** takes exactly one confirmation step, with neutral styling.
- **Empty and zero.** Empty states state what is true: *"Nema konflikata između godišnjih odmora i rasporeda."* A zero count is still shown (`0 neriješenih konflikata`). Use skeletons, not spinners. Warnings appear at save time with numbers and never persist as banners.
- **UJ-3.** Damir opens Ana's record (30 allocated, 12 used, 18 remaining) and enters 10.09–16.09. He sees the cost in leave days before saving. On save, four conflicts are queued soonest first. He resolves two by replacement and two as uncovered, each on its own screen.

## Cross-Story Dependencies

- **Upstream.** Epic 1 provides member allowance and leave-year settings. Epic 2 provides projection and working/non-working shift types. Epic 3 provides roster derivation, roster overrides (Replace member reuses them), the calendar's conflict, leave and uncovered modifiers, and the double-booking warning. Epic 4 provides `domain/hours` with the leave column, plus the hours table and export.
- **Within the epic.** 5.1 builds `leave_records` and `domain/leave`. 5.2 builds on 5.1. 5.3 adds `domain/collisions`, which needs leave records. 5.4 needs 5.3's derived conflicts. 5.5 needs the collision derivation and is sequenced last. It retro-fits a guard onto Epic 2 and 3 configuration saves, the one place a later epic changes an earlier epic's surface. The pending roster-override disposition deferred from 3.6 sits next to it.
- **Downstream.** Epic 6's member dashboard shows leave used and remaining. The admin dashboard shows the unresolved-conflict count, even at zero, and it must equal the queue exactly.
