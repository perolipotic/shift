# Epic 5 Context: Leave is recorded, and every collision is surfaced and decided

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An admin records a member's annual leave as a date range and sees its cost before saving. Leave never removes a shift or touches the rotation. Instead, every working shift the member is rostered for on a leave date becomes a visible conflict. The conflict stands until an admin decides it on its own screen: accept as uncovered, replace the member, or amend the leave. Each decision is attributable, and its consequences are stated in the same three terms. This is the product's core stance: an absence never quietly becomes an uncovered shift that someone discovers on the day. Status (2026-10-02): 5.1–5.3 are done. In 5.4, the resolution store (5.4a), the resolution screen with accept-as-uncovered (5.4b) and replace-member (5.4c) are done, and amend-leave (5.4d) is in review. The replacement guard (5.4e) and the erasure guard (5.5) remain.

## Stories

- Story 5.1: An admin records leave and sees what it costs first (done)
- Story 5.2: An admin amends or deletes leave, and the balance follows (done)
- Story 5.3: A collision with a rostered shift becomes a visible conflict (done)
- Story 5.4: An admin decides each conflict on its own screen (5.4a–c done; 5.4d amend leave in review; 5.4e replacement guard in backlog)
- Story 5.5: A configuration change cannot quietly erase a pending decision

## Requirements & Constraints

- **Leave.** Only an admin enters leave. Members never request leave or resolve conflicts, and a member sees only their own allowance, days used and balance. Cost is the count of leave dates on which the member has a working shift. This rule is inferred, so its function stays isolated. Balance = allowance − days used, counting the current leave year only, and it holds at every moment. A cost over the balance saves with a warning and is never refused. The database refuses overlapping leave for the same member. Amending leave recomputes cost, balance and conflicts. Deleting leave restores the balance.
- **Conflict.** A conflict is a working shift whose roster includes a member who is on leave that date, with no live resolution. A non-working shift raises nothing. Detection never deletes, hides or alters a shift. Nothing expires, auto-clears or suppresses a conflict: not time passing, not an unrelated data change. The queue is soonest first. Past unresolved conflicts stay in the queue, shown apart from upcoming ones.
- **Exactly three outcomes:**
  - **Accept as uncovered** (5.4b). Recorded with the acting admin and a timestamp. The shift stays, marked uncovered. The absent member's hours become leave hours, not band hours.
  - **Replace member** (5.4c). Recorded with the acting admin and a timestamp. This is a roster override, and the rotation stays as it is. The replacement gains band hours. If the replacement is on leave or already rostered that date, the screen warns and never blocks. The override and its resolution are written atomically.
  - **Amend leave** (5.4d). Writes no resolution row (human, 2026-10-02): the leave amend is the attributable write, and the conflict clears by derivation. The card states the range that would clear this conflict (rule A: start the day after; end the day before on the record's last day; remove a one-day record) and hands it to the member page's own amend or removal. Amending a record so it no longer collides clears every conflict it caused. That is removing the cause, not a bulk resolution.
- **A replacement is never silently reverted (5.4e).** Amending or deleting leave whose conflict was resolved by replace-member must tell the admin before that roster override is reverted. The leave call soft-removes resolutions inside the database, so the check runs before that call.
- **Resolution lifetime.** A resolution lives while live leave of that member covers its date. Only leave changes end one. Open question for 5.5: a later override, rotation or membership change on the same key can make a collision reappear while the old resolution still hides it, or can leave the resolution matching nothing.
- **Erasure guard (5.5).** Every write that can change the projected schedule computes the unresolved collision set before and after the change. Each collision the change would erase must be confirmed, amended or discarded before the change applies. Only an erasure blocks; warnings never do. The diff is bounded by the union of existing leave ranges intersected with the change's validity range.
- **Quality.** No literal UI strings. Counts use Croatian's three plural forms. Every admin task completes on a phone with no horizontal scroll. Nothing is shown by colour alone. Hours, balance and conflict state are never updated optimistically.

## Technical Decisions

- **Pure domain.** `domain/leave` and `domain/collisions` are the only places that compute cost, balance and collisions. They are pure TypeScript and return codes and numbers, never prose. 5.5's before/after diff belongs to the collisions family. Epic 7's leave-dialog preview reuses that diff.
- **Conflicts are derived; only resolutions are stored.** There is no conflicts table. `conflict_resolutions` is keyed by `(organization_id, member_id, date, team_id)`. `team_id` matters because an override can put a member on two teams' shifts on one day. Each row records the kind, `created_by default auth.uid()` with `WITH CHECK`, and `created_at default now()`. Replace rows reference the override they caused. The `kind` check still admits `amend_leave`, which nothing writes. Every unresolved surface filters through one unresolved-collisions function: the queue, its count, the calendar marks, the hours and the export.
- **Integrity by shape.** Leave overlap is enforced by `EXCLUDE USING gist` (`btree_gist`). There are no new triggers. Writes go through PostgREST or definer calls under RLS, and there is no server tier.
- **Migrations** are forward-only. Parallel sessions share the stack, so check the main checkout for untracked migrations before picking a number.
- **One snapshot per surface.** Every figure on a screen, the consequence strips included, derives from one composite read.
- **5.5 placement.** The guard lives in the existing rotation save confirmation dialog, next to the non-blocking warnings. Pending roster overrides are still not dispositioned in the rotation builder's review card, as shift-type overrides are. That deferred work belongs beside this guard.

## UX & Interaction Patterns

- **Resolution screen.** It has one route per conflict, opened from a queue row. A "K od N" line and ‹ › buttons move to the adjacent unresolved conflict in queue order without saving. The facts come first. Below them sit three `resolution-option` radio cards in a fixed order, one arrow-key group: Prihvati kao nepokriveno, Zamijeni osobu, Izmijeni godišnji odmor. Nothing is preselected. No card is primary-styled or labelled recommended. The selected card gets a border, a ring and a filled radio, never a new fill. "Spremi odluku" stays disabled until a card is chosen, and the hint reads "Odaberi jednu od tri odluke."
- **Consequence strip.** Every card shows three columns at every width: coverage, the absent member's hours, then the leave balance. Amend-leave's strip reads "4 od 4 člana · {ime} radi", "12 h rada", and "17 dana preostalo" over "+1 dan", in the conflict date's leave year.
- **Amend card (5.4d).** Its effect line states the computed date that would clear this conflict, for example "Mirela radi 02.10., a godišnji počinje 03.10. Otvara izmjenu godišnjeg s tim datumom." The date is a computation, not a recommendation. Saving opens the member page's leave amend with that range filled in (or the record's removal confirmation), once, through router state; the member page shows "Natrag na konflikte" while reached from a conflict.
- **Replace candidates.** They are a sibling radio group after the cards, grouped `slobodan` / `radi taj dan · 24 h bez pauze` / `na godišnjem taj dan`. Rank and position are shown as information only. The grouping is one helper, reused by 7.9.
- **After a decision.** A `Notice role="status"` line on the queue names what was saved. It is not a toast and is gone on navigation.
- **No bulk resolution anywhere.** Leave delete takes one neutral confirmation step.
- **Signals.** `destructive` marks only an unresolved conflict, as an inset ring plus `⚠`. Uncovered is a hatch plus `CircleDashed`, and leave is a hatch plus `Clock`. Members see no conflict or uncovered marks.
- **5.5.** Erasures appear in the rotation save confirmation dialog, one row each, and saving waits until every row is decided. Rotation settings get a sticky save bar with `Spremi` and `Odbaci promjene`.

## Cross-Story Dependencies

- 5.4d plugs into 5.4b's screen at card position 3 and reuses 5.2's leave amend flow. 5.4e adds the replace-member guard on the leave screen, accounting for the overrides 5.4c creates.
- Epic 4's hours take accepted-uncovered shifts as leave hours.
- 5.5 ships last. It adds a guard to the configuration saves of Epics 2 and 3.
- Order: 5.4 → 5.5 → 7.1–7.4 → Epic 6. Epic 6's admin conflict count must equal the queue, zero included. Epic 7 reuses the candidate helper (7.9) and the collision diff (7.12), and adds the Riješeni history (7.16).
