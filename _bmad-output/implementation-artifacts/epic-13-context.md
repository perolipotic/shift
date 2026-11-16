# Epic 13 Context: Absence has a type, unused leave carries over, and a half day exists

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Organizations record more absence than annual leave, unused leave should not vanish when the leave year turns, and some absences last only half a shift. This epic makes absence types organization data. Each type has a name and a setting for whether it draws down the allowance, and no type ever records a reason. Unused leave carries into the next leave year up to a cap and expires on a set date. A half-day record costs 0.5. Every one of these is organization data or is derived from it. The epic stands alone: existing leave becomes annual leave, and every figure reads as it did before. It changes the leave surfaces built in Epics 5, 7 and 9 through new stories.

Status on 2026-11-16: 13.1 to 13.5b have shipped, and so has the retrospective. Two stories came out of PO decisions at the retro on 2026-11-13 and are in the backlog. 13.6 counts carry-over only for the time a member was active. 13.7 names a half day as a half on every surface and in every notification. The pilot's sick-leave answer is settled: the pilot records *Bolovanje* as a type that does not draw, and only admins and the member see its name.

## Stories

- Story 13.1: Absence types are organization data (follow-up 13.1b: the admin defines types on *Organizacija*)
- Story 13.2: Leave has a type everywhere it is recorded or reported (13.2b: type chosen when recording; 13.2c: absence lines read neutral)
- Story 13.3: The allowance is set per leave year (13.3b: the allowance dialog sets the current leave year)
- Story 13.4: Unused leave carries over and expires (13.4b: carry-over is derived and shown)
- Story 13.5: A half-day record costs half a day (13.5b: a member asks for a half day)
- Story 13.6: Carry-over counts only the time a member was active
- Story 13.7: A half day is named as a half wherever leave is shown

## Requirements & Constraints

- **No reason, ever.** No absence type, Leave Record or Leave Request has a reason, diagnosis or free-text field. Only admins and the member themselves see a type's name. Every other member reads the absence as *odsutan*, never the type. A type named for sick leave is health data and follows the same rule. Notifications never tell a member-role account about another member's absence or its type.
- **Collisions and staffing.** Every type raises a collision against a rostered working shift, whether or not it draws. A member absent under any type is not at work. A member on a half day counts as at work.
- **Balance.** Balance = allowance + unexpired carried days − Leave Days of drawing types. Only drawing types change it. The member's view, the admin overview and the dashboard must show the same figure at any given moment.
- **Allowance per leave year.** A past year's balance uses that year's allowance. Changing this year's allowance leaves past figures as they were.
- **Carry-over.** Carried days are the previous year's unused balance, capped by the organization's maximum. They are derived, never entered or stored, and they are used before the current allowance. Days still unused at the expiry date lapse. An empty or zero maximum means no carry-over. The core has no default: Croatian practice is 30.06., but the core does not assume it. On every row, allowance + carried − used = balance.
- **Carry-over for part-year members (13.6).** If a member was active for only part of the previous leave year, that year's allowance counts in proportion to the days they were active. The days they took are subtracted, and the cap still applies. A member who was never active that year carries nothing. A member active the whole year carries what 13.4b gives today.
- **Half day.** A one-date record of the first or second half of the member's working shift costs 0.5 Leave Days and raises one collision, like a full day. The worked half counts in Band Hours and Total Hours by band intersection. The absent half counts in neither. A half day is refused at entry on a date without exactly one working shift. Entry covers a new record, a member's request, and an amend that picks another date or the other half. A stored half is never refused because the schedule changed: its request decision and an amend that keeps its date and half both stand. On a date with no working shift left, it costs 0.
- **Half-day request (13.5b).** A Leave Request may carry the half on a one-date range. The form previews the 0.5 cost through the same domain rule, never a second implementation. Approval creates one half-day record with the request's range, type and half, attributed to the approving admin. A pending request charges nothing and raises no collision.
- **Naming the half (13.7).** The member's own *Danas* names the half (*prvi* / *drugi dio smjene*). It never draws the half day as a whole day of leave or joins it to the records next to it. Every notification about a half-day record or request names the half, including an amend that changes only the half. The admin's *Danas*, *Odlučeno* and the deactivation question name the half beside the range. When a request's date no longer has a working shift, the decision screen says why it costs 0 days.
- **Reporting.** *Sati* and the Excel export show one days column per drawing type. They add one column for the rest only when the organization has a type that does not draw. Columns take their names from organization data, and no type name appears in code.
- **Tests and docs.** Every new engine rule gets a node-level assertion that renders nothing. Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same change (UX-DR12, 17, 47, 50).

## Technical Decisions

- **AD-2 classification.** The absence type and the carry-over setting are **current-state**, so a change to either re-derives every balance. The leave allowance is **versioned per leave year**. `leave_allowances` holds append-only versions, and a same-year correction is a new row. `members.leave_allowance_days` is the starting allowance, written only when a member is created (`0056`). Allowance resolution lives only in `packages/domain/leave`, and SQL does no leave-year arithmetic.
- **Absence types.** `absence_types` (`0052`) holds a name and `draws_allowance`, nothing else. Annual leave has the same fixed id in every organization and is seeded by trigger. It can be renamed but never deleted, and it always draws. `leave_records.absence_type_id` defaults to annual leave.
- **Carry-over setting.** Four nullable `smallint` columns on `organizations` (`0057`): the cap, the expiry month, the expiry day, and the first leave year carried into. A check requires all four or none. `leaveBalanceOf` / `leavePreviewOf` derive the carried days, their expiry and the balance on read, and return codes and operands, never prose (AD-1, AD-7, AD-8). In leave year Y, the days expire on the first date on or after Y's first day that has the stored day and month. 13.6's proration is derived the same way, from active-status versions, and nothing is stored.
- **Half day.** A half day is a fact of the record, not a rule. `leave_records.half` (`0058`) and `leave_requests.half` (`0059`) hold `FIRST`, `SECOND` or null (a whole day). Named checks (`…_half_check`, `…_half_one_date`) allow a half only on a one-date range. `amend_leave_record` takes `p_half` (null amends to a whole day). `decide_leave_request` copies the request's half and never chooses one. The database cannot check the one-working-shift rule because it is derived (AD-1), so the client refuses it at entry. The domain costs a half day at 0.5 on a valid date and 0 otherwise. For hours, it splits the shift at start + ⌊duration/2⌋. The review previews a stored half with `leavePreviewStateOf(…, refuseHalf = false)`.
- **Schema rules.** Every table has `organization_id` first, RLS, and AD-11 attribution through column defaults. Schema shape is preferred to checks: the no-reason rule holds because no such column exists. A refusing trigger needs its own named exception in the spine (AD-3). Writes go through PostgREST under RLS (AD-9).

## UX & Interaction Patterns

- The admin's leave dialog and the member's request form both read in this order: *Od*/*Do*, then a `RadioCard` group for the type, then the half-day block while *Od* = *Do*, then the cost and the balance after. The member's form has one *Pošalji*. No type is preselected, and a type is required even when only one exists. A type that does not draw says that the balance stays unchanged.
- The half-day block is a *Pola dana* switch, then two cards, *Prvi dio smjene* and *Drugi dio smjene*, each showing its times, neither preselected. Widening the range clears the block. Wherever a half day is named, it follows the range as `(prvi dio smjene)` or `(drugi dio smjene)`.
- Day figures render through the locale (`0,5 dana`), and `—` stands for 0.
- The ◷ legend and the cell label read *Odsutnost*, never the type. The UI never says *konflikt*: a collision is *Odsutnost u smjeni*.
- *Organizacija* has a *Prijenos godišnjeg* card, edited in its own dialog. The expiry is a day and a month, never a date picker. The member's tiles and the leave overview show carried days and their expiry.

## Cross-Story Dependencies

- 13.2 depends on 13.1, 13.4 on 13.3, and 13.5 on 13.2. 13.5b depends on 13.5 and on Epic 9's request flow (form, review, `decide_leave_request`). 13.6 depends on 13.4/13.4b and on member active-status versions (Epic 1). 13.7 depends on 13.5b and on Epic 10's notifications.
- Half days and carry-over affect leave cost, balance, collisions, Band Hours, staffing (Epic 11), the request preview and approval (Epic 9), *Za odluku*, notifications (Epic 10) and the offline snapshot (Epic 8). Each surface must read one snapshot, and a change to a persisted mapped shape must bump the snapshot buster.
- Epic 14's change history will read the attributed rows of the new tables and settings.
