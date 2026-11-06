# Epic 12 Context: Members swap shifts, and an admin signs it off

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Today, members arrange swaps between themselves by phone, and the rota never finds out. In this epic, a member proposes to give one of their working shifts to a colleague, and may optionally take one of the colleague's working shifts in return. Without a return shift, the swap is a one-way cover (adopted 2026-10-10). The colleague accepts or declines. An accepted swap waits in *Za odluku*, and an admin approves it after seeing what it does. Nothing in the schedule, the hours or any figure moves until the admin approves. Approval writes only ordinary Roster Overrides attributed to the admin, so the rotation stays untouched and the hours follow by themselves. The 2026-10-10 scope expansion (CAP-22, decision D2: member → colleague → admin) added this epic to v1. It reuses Epic 9's request pattern: the self-owned RLS policies, the *Za odluku* item model, a decision screen per kind of item, and *Odlučeno*.

## Stories

- Story 12.1: The swap request record
- Story 12.2: A member proposes a swap from the day detail
- Story 12.3: The colleague accepts or declines
- Story 12.4: An admin decides a swap on its own screen

## Requirements & Constraints

- **States:** proposed → accepted or declined → approved or rejected; withdrawn by either member at any point before the admin decides. A proposal names the proposer's shift (date, team), the addressee, and optionally the addressee's shift in return. A declined, rejected or withdrawn swap creates nothing. A withdrawn swap leaves *Za odluku*.
- **Who writes what (Q2):** only the proposer inserts. Either member withdraws before the decision. Only the addressee accepts or declines. Only an active admin approves or rejects. The same refusals apply to the UI and to a direct API call. These member writes are not administrative writes.
- **Nothing derives before approval (R9.1):** a proposed or accepted swap changes no Scheduled Shift, roster, hours, balance, collision or short-staffed figure on any surface.
- **Validity:** a given shift that is not a working shift on the proposer's roster is refused when the swap is sent, and so is a return shift that is not on the colleague's roster. If either shift has changed so that the swap no longer applies, approval is refused as stale.
- **The preview never blocks (R9.3):** the proposer sees, before sending, who works which date and each member's hour delta. Before deciding, the admin sees each member's hour delta, any leave or double booking either member would have, and any short-staffed shift. All of it warns and never blocks, and it runs the same rules as a direct roster override save, never a second implementation.
- **Approval (R9.2):** approval writes one Roster Override that replaces the proposer with the addressee on the given shift. When there is a return shift, it writes a second one that replaces the addressee with the proposer. Each override has reason `swap`, is attributed to the approving admin, and passes the AD-5 erasure check. Rejection records only the decision.
- **Queue count:** *Za odluku* counts accepted swaps (the ones waiting for an admin) beside unresolved collisions and pending leave requests. The admin *Danas* figure equals the queue exactly, including at zero.
- **Notifications (deferred from 10.2):** a member is told when a swap is proposed to them, when it is decided, and when their shifts change through a swap. Every admin is told when a new item waits in *Za odluku*.
- **Offline (Epic 8):** every new write control (send, accept, decline, withdraw, approve, reject) is refused offline and says why. Every new surface reads offline as one snapshot.
- **Docs in the same change:** each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes, and turns each "Planned … (story 12.x)" note into present-tense fact. Those lines are 12.2: EXPERIENCE.md §IA, UX-DR31, 33 and 47; 12.4: UX-DR33, 46 and 52.

## Technical Decisions

- **Data model:** two organization-scoped tables, `swap_requests` and `swap_request_decisions`, on the pattern of `leave_requests` and `leave_request_decisions` (0040). Store no state twice and no derived value (AD-1). Leave requests derive their status: pending is `closed_at IS NULL`, the outcome lives on the decision row, and a closed request with no decision was withdrawn. Story 12.1 settles how the addressee's answer (accepted or declined) is stored.
- **AD-10 (self-owned rows):** the insert policy matches the proposer's `member_id` against `members.auth_user_id = auth.uid()` in the claimed organization. The organization comes from the JWT claim, and the role and active status come from `current_member_access()`, never from the request row. The spine already names answering a swap addressed to the member as Epic 12's addition. Shipped precedent: the member withdraws through a definer (`withdraw_leave_request`), and only an active admin decides through a definer (`decide_leave_request`).
- **AD-11:** proposals, answers, decisions and the approval's overrides carry `created_by default auth.uid()` and `created_at default now()`, checked with `WITH CHECK (created_by = auth.uid())`. The attribution outlives the request (Q11).
- **AD-4:** *Za odluku* is a union of unresolved derived collisions, pending leave requests and swap requests waiting for an admin. There is still no conflicts table. Only a decision clears a request.
- **AD-5:** a leave approval only adds leave, so it is exempt from the erasure check. A swap approval is not exempt, because its roster overrides change the projected schedule and can erase an unresolved collision (for example, a proposer on leave who is swapped out). It runs through the calendar roster guard's diff and its `ErasureDialog`. Only erasures block.
- **AD-9 / AD-3 / AD-1:** writes go through PostgREST under RLS or through narrow definer functions. A rule that cannot be declared is escalated to the spine, never solved with a new trigger or function. The database never projects a roster. "Is this a working shift on their roster" and "is this stale" are therefore questions the browser's domain answers, as the replace-member resolution already does. Story 12.1 decides how the send-time refusal is enforced within these rules.
- **AD-7 / AD-8:** hour deltas, leave and double booking, collisions and short-staffed results come from `packages/domain` (`hours`, `collisions`, `staffing`; the planned `domain/requests` preview). Results are returned as codes and operands. The staffing logic lives in `features/staffing/services/short-staffed.ts` (405 lines); the retro flagged it to watch as swap approval adds to it.
- **AD-18:** a notification is written to the outbox, as codes and operands, by the same transaction that asserts the fact, through `private.notify_members`. It never goes to the member whose session made the write. The retro asked that `notify/handler.ts` be split before Epic 12 adds codes.
- **AD-13:** writes invalidate their surface's key and every dependent key (queue, Danas count, calendar, hours, roster). No update is optimistic. AD-15: the rules are tested in node against both fixtures.

## UX & Interaction Patterns

- **Proposing (12.2):** a member's day detail on their own working shift offers *Predloži zamjenu*. The form takes a colleague and an optional return shift, and shows the colleague's own consequence and each member's hours. It has one *Pošalji*. This is a new surface, request swap.
- **Answering (12.3):** the addressee sees the swap on *Danas*, with its consequence for them, and the buttons *Prihvati* and *Odbij*. The proposer sees a declined swap as declined.
- **Deciding (12.4):** the swap is a third kind of item in *Za odluku*. Its decision screen follows the leave request decision screen's pattern and is not a separate surface; the inventory goes from 21 to 23 with request swap and change history. *Čeka odluku* sorts soonest-first across every kind of item and names each kind in words. The accent colour is reserved for items waiting for a decision. A landed decision returns to the queue with a focused status line, as leave requests do.
- ***Odlučeno* (UX-DR52):** lists a decided swap with its decision, the admin and the time (`Odluka: {admin}, {datum} u {vrijeme}`), newest first and read-only. A withdrawn swap was never decided and is not listed. *Odlučeno* is not a history surface.
- **Vocabulary:** the UI never says *konflikt*, and a hygiene test enforces it. A collision is *Odsutnost u smjeni*. A roster replacement is called *zamjena* everywhere it already appears (the hours source, `zamjena za {ime}`, the replacement guard). The short-staffed block and the `warning` token behave as in Epic 11.

## Cross-Story Dependencies

- 12.1 depends on 9.2 (the request pattern and the self-owned policy). 12.2 depends on 12.1, 12.3 on 12.2, and 12.4 on 12.3 and on 11.1 (the staffing rule, shipped).
- 12.4 reuses Epic 3/5's roster override write path and its AD-5 guard. It also reuses 9.4's decision screen and 9.5's queue and *Odlučeno*.
- Epic 10's outbox gains the swap events listed under Notifications (deferred from 10.2).
- Epic 14's change history will read the swap's attributed rows.
