# Epic 9 Context: A member asks for leave, and an admin decides

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Until now only an admin could enter leave. This epic lets a member request a leave range from their phone and see what it would cost before sending it. An admin sees the request in *Za odluku* next to the conflicts that approval would raise, and then decides it. Approval creates a Leave Record attributed to that admin. Until then nothing in the schedule moves. Admin-entered leave keeps working, and requests add a second path into it. These are the product's first member-role domain writes. The epic was added to v1 on 2026-10-10. Its risk is low, because a leave request is a Leave Record that has not been asserted yet. Story 9.1 is done: the queue is now *Za odluku*, and the Croatian UI no longer says "konflikt". The remaining stories (9.2–9.5) add the request record, the member's request form, the admin's decision screen, and the merged queue. Epic 12 reuses this item model for swaps.

## Stories

- Story 9.1: Raspored becomes Za odluku, and no screen says konflikt (done)
- Story 9.2: The leave request record
- Story 9.3: A member requests leave and sees what it costs
- Story 9.4: An admin decides a leave request on its own screen
- Story 9.5: Za odluku lists requests beside collisions

## Requirements & Constraints

- **Members propose and admins decide.** A member may insert a request only for themselves, and may withdraw only their own pending request. A member writes no decision, no Leave Record and no one else's request, through the UI or a direct API call. Members never resolve conflicts.
- **A pending request derives nothing.** It creates no conflict, charges no balance, and changes no shift, hours or roster on any surface.
- **Overlap is refused by schema shape, not by client validation.** This covers a request that overlaps the member's existing leave or another pending request of theirs.
- **Decisions.** Approval creates a Leave Record attributed to the approving admin, its conflicts appear, and the request reads as approved. Rejection records only the decision. Every decision carries the acting admin and a timestamp from column defaults. The member sees each request's status: pending, approved, rejected or withdrawn.
- **Previews never block,** not even a range that goes over the balance. The member sees the cost in days and the balance after it. The admin sees the cost, the balance after it, and the conflicts approval would create, computed with the same rules as a direct leave save. Short-staffed shifts appear in the admin's preview only after Epic 11 ships.
- **Queue count.** The admin Danas count equals the number of items in *Čeka odluku* exactly (collisions plus pending requests). It is shown even at zero.
- ***Odlučeno* is not a history surface.** It reads stored decisions only. The change history is a separate surface (Epic 14).
- **No "konflikt" in the Croatian UI.** A hygiene test fails the build if the stem returns to `hr.json`. "Conflict" stays the domain term in code, docs and the glossary.
- **Offline (Epic 8).** Every new write control (*Pošalji*, withdraw, approve, reject) refuses offline and states why. Every new surface reads offline as one whole snapshot under an as-of note, and never mixes cached and fresh data.
- **Docs in the same change.** Each story updates, in the same PR, the EXPERIENCE.md §IA, DESIGN.md and UX-DR lines it changes: 9.3 → UX-DR31, 33, 47; 9.4 → UX-DR33, 46; 9.5 → UX-DR25, 46, 52. Each story turns its line's "Planned … rewritten by the story that ships it" note into present-tense fact.

## Technical Decisions

- **New tables (9.2):** `leave_requests` and `leave_request_decisions`. Both are scoped to the organization under RLS and carry AD-11 attribution (`created_by` and `created_at` from column defaults, with the insert check `created_by = auth.uid()`). Neither stores derived data.
- **AD-10 amendment (9.2).** A "self-owned row" policy lets a member insert and withdraw their own requests. The policy gets the current member from the AD-10 `SECURITY DEFINER` helper, never from the request row.
- **AD-4 amendment (9.2).** *Za odluku* is the union of three sets: derived collisions that have no resolution, pending leave requests, and (in Epic 12) pending swap requests. Requests are stored rows, and only a decision clears one. There is still no conflicts table.
- **AD-3.** Overlap refusal reuses the exclusion-constraint pattern from leave (`EXCLUDE USING gist` with `btree_gist`). A rule that could be schema shape but is written as validation is a defect. One named exception (9.2, human decision 2026-10-27): a request overlapping the member's live leave crosses two tables, which no exclusion can span, so the BEFORE INSERT trigger `refuse_leave_request_over_leave()` refuses it (23P01 `LEAVE_REQUEST_OVERLAPS_LEAVE`). It computes nothing, and the overlap between two pending requests stays an exclusion constraint. No other new refusing trigger is allowed.
- **AD-9.** There is no server tier. Every write, approval included, is a direct PostgREST call under RLS. A rule that cannot be expressed declaratively goes to the architecture spine for a decision; it does not become a new function.
- **Domain.** Cost, the balance after it, and the collision preview come from the pure functions in `packages/domain` (`domain/leave` and `domain/collisions`). These functions return codes and operands, never prose. The approval preview gets a new module, `domain/requests`. Components and SQL never recompute these values.
- **AD-5.** Approval writes leave. Any write that can change the projected schedule goes through the erasure diff, and a collision that a write adds is never counted as an erasure.
- **Mutations.** A decision that lands invalidates the queue, leave, balance, conflict and Danas-count keys and every key that depends on them. No update is optimistic.

## UX & Interaction Patterns

- **Vocabulary as shipped in 9.1:**
  - The queue is *Za odluku* at `/za-odluku`, and the old `/raspored` URLs redirect.
  - Its tabs are *Čeka odluku* (the default, with its count on the tab even at zero: `Čeka odluku · 0`) and *Odlučeno* (until 9.1 these were *Neriješeni* and *Riješeni*).
  - A collision is named *Odsutnost u smjeni*, plural *Odsutnosti u smjeni*. The button is *Odluči*, and the back link is *Natrag na Za odluku*.
  - The count uses three plural forms: `1 čeka odluku`, `3 čekaju odluku`, `5 čeka odluku`.
  - The legend reads ⚠ *čeka odluku*.
  - Empty states read "Ništa ne čeka odluku." and `0 odlučenih stavki`.
  - The erasure dialog reads *Promjena / Poništavanje / Izmjena uklanja N stavki koje čekaju odluku*, and a kept row reads "Zadržana stavka: …". Admin Danas ends in `Otvori Za odluku ({count})`.
  - The accent colour is reserved for what waits for a decision.
- **Navigation.** *Za odluku* holds *Raspored*'s old place in the admin's binding order and on the phone bar.
- **Request form (9.3, UX-DR47).** It opens from the member's *Godišnji* through *Zatraži godišnji*. It takes the range, shows the cost and the balance after it, and has one *Pošalji*. Epic 13 later adds the absence type and half day. *Godišnji* lists the member's requests by status, and a pending one can be withdrawn.
- **Decision screen (9.4).** Each request opens its own decision screen, which is a new surface. It shows the preview with approve and reject, and nothing on it blocks.
- **Queue (9.5, UX-DR46 and 52).** The queue sorts soonest-first across all kinds of item, and each item names its kind in words. *Odlučeno* lists decided requests next to decided collisions, each with the decision, the acting admin and the time.
- **Surface count.** The request form and the decision screen are two of the five planned surfaces that take the inventory from 18 to 23.

## Cross-Story Dependencies

- **Order within the epic.** 9.1 (done) comes first. 9.2 depends on 9.1. 9.3 and 9.4 depend on 9.2. 9.5 depends on 9.4.
- **Shipped work.** 9.1 renamed the surfaces from 5.3b, 5.4, 6.3 and 7.16. In code, "conflict" naming stays (the `features/conflicts` module and `conflict_resolutions`). 9.4 builds on the leave dialog's preview of cost, balance and conflicts from 7.12.
- **Epic 8.** Its offline write refusal and offline-read rules apply to every new surface and control in this epic.
- **Epic 10.** Notification story 10.2 depends on 9.4: a member is told when their request is decided, and admins are told when a new item reaches *Za odluku*.
- **Epic 11.** It adds short-staffed shifts to 9.4's preview.
- **Epic 12.** Swaps reuse the *Za odluku* item model, the self-owned RLS pattern and *Odlučeno*.
- **Epic 13.** It adds the absence type and half day to the request form.
