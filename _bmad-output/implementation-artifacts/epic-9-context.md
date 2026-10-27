# Epic 9 Context: A member asks for leave, and an admin decides

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Until now leave has been entered only by an admin. This epic lets a member request a leave range from their phone and see what it would cost before sending it. An admin sees the request in *Za odluku* next to the conflicts that approval would raise, then decides it. Approval creates a Leave Record attributed to that admin. Until then nothing in the schedule moves. The epic also renames the conflicts queue: *Raspored* becomes *Za odluku*, because going on leave is not a conflict, and the word "konflikt" leaves the Croatian UI. The pilot is expected to ask for leave requests within weeks of go-live. These are the product's first member-role domain writes. The epic was added to v1 on 2026-10-10 (D1). Its risk is low, because a leave request is simply a Leave Record that has not been asserted yet. Epic 12 reuses its *Za odluku* item model for swaps.

## Stories

- Story 9.1: Raspored becomes Za odluku, and no screen says konflikt
- Story 9.2: The leave request record
- Story 9.3: A member requests leave and sees what it costs
- Story 9.4: An admin decides a leave request on its own screen
- Story 9.5: Za odluku lists requests beside collisions

## Requirements & Constraints

- **Members propose; admins decide.** A member may insert a request only for themselves and may withdraw only their own pending request. A member writes no decision, no Leave Record and no one else's request, whether through the UI or a direct API call. Members never resolve conflicts. Role enforcement still refuses administrative writes the same way via UI and API.
- **A pending request derives nothing.** It creates no conflict, charges no balance, and changes no shift, hours or roster on any surface.
- **Overlap is refused.** A request that overlaps the member's existing leave, or another pending request of theirs, is refused by schema shape and not by client validation.
- **Approval** creates a Leave Record attributed to the approving admin. Its conflicts then appear, and the request reads as approved. **Rejection** records only the decision. Every decision carries the acting admin and a timestamp from column defaults the client cannot forge. The member always sees each request's status: pending, approved, rejected or withdrawn.
- **Cost preview.** The member sees the cost in days and the balance after it before sending. The admin's approval preview shows the cost, the balance after it, and the conflicts approval would create. It uses the same rules as a direct leave save. After Epic 11 it also shows short-staffed shifts. Nothing in either preview blocks, including a range that goes over the balance.
- **Queue count.** The admin Danas count equals the number of items in *Čeka odluku* exactly, collisions plus pending requests, and is shown even at zero.
- ***Odlučeno* is not a history surface.** It is a read of stored decisions. The change history is a separate surface (Epic 14).
- **No "konflikt" in Croatian UI.** A test fails the build if the word reappears in `hr.json`. "Conflict" stays the domain term in code, docs and the glossary.
- **Offline (Epic 8).** Every new write control (*Pošalji*, withdraw, approve, reject) refuses offline with a stated reason. New surfaces follow the offline-read rules: one snapshot with an as-of note, never mixed.
- **Docs in the same change.** Each story updates the EXPERIENCE.md §IA, DESIGN.md and UX-DR lines it changes (UX-DR12, 23, 25, 31–33, 46, 47, 52) in the same PR.

## Technical Decisions

- **New tables:** `leave_requests` and `leave_request_decisions`. Both are organization-scoped with RLS, carry AD-11 attribution (`created_by default auth.uid()`, `created_at default now()`, `WITH CHECK created_by = auth.uid()`), and store nothing derived.
- **AD-10 amendment (applied by 9.2).** A new "self-owned row" policy lets a member insert and withdraw their own requests. The policy reads the member as `member_id = current member` from the AD-10 `SECURITY DEFINER` helper, never from the request row.
- **AD-4 amendment (applied by 9.2).** *Za odluku* is a union of three things: derived collisions with no resolution, pending leave requests, and (later) pending swap requests. Requests are stored, and only their decision clears them. There is still no conflicts table.
- **AD-3.** Overlap refusal uses the existing exclusion-constraint pattern on leave (`EXCLUDE USING gist`, `btree_gist`). A validation that could be expressed as schema shape is a defect. No new refusing trigger is allowed.
- **AD-9.** There is no server tier. Every write, approval included, is a direct PostgREST call under RLS. A rule that cannot be expressed declaratively escalates to the architecture spine. It does not become a new function.
- **Domain.** Cost, the balance after it, and the collision preview come from `packages/domain`, through `domain/leave` and `domain/collisions`. These are pure functions that return codes and operands, never prose. The planned home for the approval preview is a new module, `domain/requests`. A preview runs the same collision rules as a direct leave save. Nothing is recomputed in a component or in SQL.
- **AD-5.** An approval writes leave. Any write that can change the projected schedule still goes through the erasure diff. Collisions that a write adds are never erasures.
- **Mutation.** A landed decision invalidates the queue, leave, balance, conflict and Danas-count keys, plus every dependent key. No update is optimistic.

## UX & Interaction Patterns

- **Rename vocabulary (9.1):**
  - *Raspored* → *Za odluku*, with tabs *Čeka odluku* (the default) and *Odlučeno*. The old URL redirects.
  - A collision item reads *Odsutnost u smjeni* (`{ime} je na godišnjem, a raspoređen je`).
  - The count uses three plural forms: `# čeka odluku` / `# čekaju odluku`.
  - The button is *Odluči*. The calendar legend reads ⚠ *čeka odluku*.
  - The erasure dialog reads *Promjena uklanja N stavki koje čekaju odluku*. The back link reads *Natrag na Za odluku*.
  - The accent colour is reserved for what waits for a decision.
  - The e2e page objects follow the new names.
- **Navigation.** *Za odluku* replaces *Raspored* in the admin's binding order and on the phone bar.
- **Request form (9.3, UX-DR47).** It sits on the member's *Godišnji* behind *Zatraži godišnji*. It takes the range and shows the cost and the balance after it, with one *Pošalji*. Epic 13 adds the absence type and half day later. *Godišnji* lists the member's requests by status, and a pending one has a withdraw action.
- **Decision screen (9.4).** Each request opens its own decision screen, a new surface. It shows the preview with approve and reject actions, and nothing in it blocks.
- **Queue (9.5, UX-DR46/52).** It sorts soonest-first across all item kinds, and each item names its kind in words. *Odlučeno* lists decided requests next to decided collisions, each with the decision, the acting admin and the time.
- **Surface count.** The request form and the decision screen are counted among the five new surfaces that bring the inventory from 18 to 23.

## Cross-Story Dependencies

- **Order within the epic.** 9.1 comes first. 9.2 depends on 9.1. 9.3 and 9.4 depend on 9.2. 9.5 depends on 9.4.
- **Shipped work that 9.1 renames.** 9.1 renames surfaces shipped in 5.3b, 5.4, 6.3 and 7.16 (the queue, the *Riješeni* tab, the Danas count, the resolution back link). 9.4 builds on the leave dialog's cost, balance and conflict preview from 7.12.
- **Epic 8.** Its offline write refusal and offline-read rules apply to every new surface and control in this epic.
- **Epic 10.** Notification 10.2 depends on 9.4: the member hears about a decided request, and admins hear about a new item in *Za odluku*.
- **Epic 11.** Short-staffed shifts appear in 9.4's preview only after Epic 11 ships.
- **Epic 12.** Swaps reuse the *Za odluku* item model, the self-owned RLS pattern and *Odlučeno*.
- **Epic 13.** It later adds the absence type and half day to the request form.
