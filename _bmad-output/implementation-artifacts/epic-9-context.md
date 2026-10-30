# Epic 9 Context: A member asks for leave, and an admin decides

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Before this epic, only an admin could enter leave. Epic 9 lets a member request a leave range from their phone and see what it would cost before sending it. An admin sees the request in *Za odluku*, next to the conflicts that approval would raise, and decides it. Approval creates a Leave Record exactly as if the admin had entered it. Until then nothing in the schedule, the hours or the balance moves. Admin-entered leave keeps working, and requests add a second path into it. These are the product's first member-role domain writes. All five stories are done: the queue is now *Za odluku* and no Croatian string says "konflikt" (9.1); the request record exists with its RLS, its withdraw and decide functions (9.2); a member can request leave from *Godišnji* and withdraw a pending request (9.3); the admin decides on its own screen (9.4); and *Za odluku* lists requests beside collisions (9.5). Epic 12 reuses this item model for swaps.

## Stories

- Story 9.1: Raspored becomes Za odluku, and no screen says konflikt (done)
- Story 9.2: The leave request record (done)
- Story 9.3: A member requests leave and sees what it costs (done)
- Story 9.4: An admin decides a leave request on its own screen (done)
- Story 9.5: Za odluku lists requests beside collisions (done)

## Requirements & Constraints

- **Members propose and admins decide.** A member inserts requests only for themselves and withdraws only their own pending request. A member writes no decision, no Leave Record and no colleague's request, whether through the UI or a direct API call. A member cannot read another member's requests. A request has no reason field.
- **A pending request derives nothing.** It raises no conflict, charges no balance, and changes no shift, hours or roster on any surface.
- **Decisions.** Approval creates one Leave Record for the requested range, attributed to the approving admin. From then on it behaves like any direct leave record: its conflicts appear and the request reads as approved. Rejection records only the decision (and closes the request: `closed_by`, `closed_at`, as every decision does). Every decision carries the acting admin and a timestamp. If the schedule has changed so that the request no longer applies, approval is refused as stale and the request stays pending. A decided request cannot be withdrawn; an admin changes approved leave the usual way.
- **The preview never blocks.** Before deciding, the admin sees the cost, the balance after it and every conflict that approval would create. Short-staffed shifts join this preview once Epic 11 ships. All of it uses the same rules as a direct leave save, never a second implementation.
- **Queue count.** The admin's Danas count equals the number of items in *Čeka odluku* exactly (unresolved collisions plus pending requests). It is shown even at zero.
- ***Odlučeno* is not a history surface.** It reads stored resolutions and request decisions only. The change history is Epic 14.
- **No "konflikt" in the Croatian UI.** A hygiene test fails the build if the stem returns to `hr.json`. "Conflict" stays the domain term in code, docs and the glossary.
- **Offline (Epic 8).** Every new write control (approve, reject) is refused offline and says why. Every new surface reads offline as one whole snapshot under the as-of note.
- **Docs in the same change.** Each story updates the UX-DR, EXPERIENCE.md and DESIGN.md lines it changes in its own PR: 9.4 → UX-DR33 and 46; 9.5 → UX-DR25, 46 and 52. The story that ships a "Planned … rewritten by the story that ships it" note turns that note into present-tense fact.

## Technical Decisions

- **The data model, as shipped in 9.2 (migration 0040).** The tables are `leave_requests` and `leave_request_decisions`, both scoped to the organization under RLS and attributed through column defaults (AD-11). A request's status is derived and never stored twice: pending means `closed_at IS NULL`, approved or rejected is the decision's `outcome`, and a closed request with no decision was withdrawn. Each request has at most one decision row. The member's `withdraw_leave_request` closes a request without a decision. Only an active admin decides, through `decide_leave_request`.
- **Self-owned insert (AD-10 amendment).** The policy `leave_requests_insert_own_by_active_member` matches `member_id` against `members.auth_user_id = auth.uid()` in the claimed organization. Active status comes from `current_member_access()`, never from the request row.
- ***Za odluku* is a union (AD-4 amendment).** It joins three sets: derived collisions that have no resolution, pending leave requests, and (in Epic 12) pending swap requests. There is still no conflicts table.
- **Approval and the erasure diff.** Approval only adds leave, so it can add collisions but never erase one. AD-5's erasure diff therefore does not apply to approval.
- **Overlap refusal (AD-3).** Two pending requests of one member cannot overlap, and an exclusion constraint enforces it. A request that overlaps the member's live leave spans two tables, so the named exception trigger `refuse_leave_request_over_leave()` refuses it with 23P01 `LEAVE_REQUEST_OVERLAPS_LEAVE`. No other refusing trigger is allowed. An admin's direct leave record is never refused because a pending request overlaps it. In that case approval later aborts on the leave exclusion.
- **No server tier (AD-9).** Writes go through PostgREST under RLS, or through the shipped definer functions above. Any rule that cannot be expressed declaratively is escalated to the architecture spine; it does not become a new function.
- **Domain logic.** Cost, balance-after and the collision preview come from the pure functions in `packages/domain` (`domain/leave` and `domain/collisions`). These return codes and operands, never prose. Components and SQL never recompute them.
- **Mutations.** When a decision lands, it invalidates the queue, leave, balance, conflict, request and Danas-count keys, plus every key that depends on them. No update is optimistic.

## UX & Interaction Patterns

- **Vocabulary (shipped in 9.1).**
  - The queue is *Za odluku* at `/za-odluku`, with the tabs *Čeka odluku* (the default, with its count shown even at zero) and *Odlučeno*.
  - A collision is *Odsutnost u smjeni*. The decide button is *Odluči*, and the back link is *Natrag na Za odluku*.
  - The count has three plural forms (`1 čeka odluku`, `3 čekaju odluku`, `5 čeka odluku`).
  - The accent colour is reserved for items that wait for a decision.
- **What 9.3 shipped.**
  - A member's *Godišnji* offers *Zatraži godišnji*, which opens *Zatraži godišnji odmor* at `/godisnji/zatrazi`. An admin who opens that page is sent to the overview.
  - The form takes *Od* and *Do*. It shows the cost in days, the part charged to the current leave year when the range crosses it, and the balance after the request. Going over the balance, or overlapping the member's own leave, appears as a note and never blocks. The single *Pošalji* stays available over the balance.
  - *Godišnji* lists the member's own requests soonest-first. Each shows its range, its cost and a status badge (*Čeka odluku*, *Odobren*, *Odbijen* or *Povučen*). A closed request also shows its date. A pending request has *Povuci zahtjev*, with no confirmation. With no requests, the list reads "Nemaš zahtjeva za godišnji."
- **Decision screen (9.4).** This is a new surface: each kind of item has its own decision screen. It shows the preview with approve and reject, and nothing on it blocks. It takes the surface inventory from 19 to 20 of the planned 23.
- **Queue (9.5).** *Čeka odluku* sorts soonest-first across every kind of item, and each item names its kind in words. *Odlučeno* lists decided requests next to decided collisions, each with the decision, the acting admin and the time.

## Cross-Story Dependencies

- **Within the epic.** 9.4 depends on 9.2, and 9.5 depends on 9.4.
- **Earlier work.** 9.4 builds on the leave dialog's preview of cost, balance and conflicts (7.12). In code, the "conflict" naming stays (`features/conflicts` and `conflict_resolutions`). 9.3's request services and hooks live under `features/leave`.
- **Epic 8.** Its rules for refusing writes offline and for reading offline apply to every new surface and control.
- **Epic 10.** Notification story 10.2 depends on 9.4: a member is told when their request is decided, and admins are told when a new item reaches *Za odluku*.
- **Epic 11.** It adds short-staffed shifts to 9.4's preview.
- **Epic 12.** Swaps reuse the *Za odluku* item model, the self-owned RLS pattern and *Odlučeno*.
- **Epic 13.** It adds the absence type and the half day to the request form and to approval.
