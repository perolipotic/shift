# Epic 13 Context: Absence has a type, unused leave carries over, and a half day exists

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Organizations record more absence than annual leave, unused leave should not vanish when the leave year turns, and some absences last only half a shift. This epic makes absence types organization data. Each type has a name and a setting for whether it draws down the allowance, and no type ever records a reason. Unused leave carries into the next leave year up to a cap and expires on a set date. A half-day record costs 0.5. Every one of these is organization data or derived from it. The epic stands alone: existing leave becomes annual leave, and every figure reads as it did before. The epic changes the leave surfaces built in Epics 5, 7 and 9 through new stories.

Status on 2026-11-12: 13.1 to 13.5 have shipped, including the follow-ups 13.1b, 13.2b, 13.2c, 13.3b and 13.4b. On 2026-11-12 the PO split the half day in two; the member's half-day request, 13.5b, is in review.

## Stories

- Story 13.1: Absence types are organization data
- Story 13.2: Leave has a type everywhere it is recorded or reported
- Story 13.3: The allowance is set per leave year
- Story 13.4: Unused leave carries over and expires
- Story 13.5: A half-day record costs half a day
- Story 13.5b: A member asks for a half day (split from 13.5)

## Requirements & Constraints

- **No reason, ever.** No absence type, Leave Record or Leave Request has a reason, diagnosis or free-text field. Only admins and the member themselves see a type's name. Every other member reads the absence as *odsutan*, never the type. A type named for sick leave is health data and falls under the same rule. Notifications never tell a member-role account about another member's absence or its type.
- **Collisions and staffing.** Every type raises a collision against a rostered working shift, whether or not it draws. A member absent under any type is not at work, except on a half day, when they count as at work.
- **Balance.** Balance = allowance + unexpired carried days − Leave Days of drawing types. Only drawing types change it. The figure must match on every surface at any given moment: the member's view, the admin overview and the dashboard.
- **Allowance per leave year.** A past year's balance uses that year's allowance. Changing this year's allowance leaves past figures as they were.
- **Carry-over.** Carried days are the previous year's unused balance, capped by the organization's maximum. They are derived, never entered or stored, and they are consumed before the current allowance. Days still unused at the expiry date lapse. An empty or zero maximum means no carry-over, and there is no default (Croatian practice is 30.06., but the core does not assume it). The member's tiles and the leave overview show carried days and their expiry, and on every row allowance + carried − used = balance.
- **Half day.** A one-date record of the first or second half of the member's working shift costs 0.5 Leave Days and raises one collision, like a full day. The worked half counts in Band Hours and Total Hours by band intersection. The absent half counts in neither. A half day on a date without exactly one working shift is refused when it is recorded (the admin's dialog) or requested (the member's form). A stored half day whose shift has since gone is never refused afterwards, not at a request's review either: it costs 0, as the domain says.
- **Half-day request (13.5b).** A Leave Request may carry the half on a one-date range. The request form previews its cost at 0.5 through the same domain rule, never a second implementation. Approval creates one Half-day Record of the requested range, type and half, attributed to the approving admin. A pending request charges nothing and creates no collision. The request review and *Za odluku* show the half.
- **Reporting.** *Sati* and the Excel export show one days column per drawing type and one column for the rest, each named from organization data. No type name appears in code.
- **Tests.** Every new engine rule gets a node-level assertion that renders nothing.
- **Docs in the same change.** Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes (UX-DR12, 17, 47, 50).

## Technical Decisions

- **AD-2 classification.** The absence type and the carry-over setting are **current-state**, so changing either re-derives every balance. The leave allowance is **versioned per leave year**: `leave_allowances` holds append-only versions, and `members.leave_allowance_days` is the starting allowance. Allowance resolution lives only in `packages/domain/leave`, and SQL does no leave-year arithmetic.
- **Absence types.** `absence_types` holds a name and `draws_allowance`, nothing else. Annual leave has one fixed id in every organization, is seeded by trigger, can be renamed but never deleted, and always draws. `leave_records.absence_type_id` defaults to annual leave.
- **Carry-over setting.** It is stored as four nullable `smallint` columns on `organizations`: the cap, the expiry month, the expiry day, and the first leave year carried into. A check requires all four or none. The domain derives the rest on read inside `leaveBalanceOf` / `leavePreviewOf`, and returns codes and operands, never prose (AD-1, AD-7, AD-8). The expiry follows the leave-year start.
- **Half day.** `leave_records.half` holds `FIRST` or `SECOND`, or null for a whole day, and a named check allows it only on a one-date range. The rule that the date holds exactly one working shift is derived in the domain (AD-1), so the browser refuses a date that breaks it; the database checks only the shape. For hours, the shift splits at start + ⌊duration/2⌋. As built in 13.5b (`0059`): `leave_requests.half` mirrors the record's column and its two checks (`leave_requests_half_check`, `leave_requests_half_one_date`), the insert grant gains it, and `decide_leave_request`, replaced in place, copies it into the record an approval writes. The review previews a stored half through `leavePreviewStateOf(…, refuseHalf = false)` and never refuses a decision for it: a date that no longer holds one working shift costs 0.
- **Schema rules.** Every table has `organization_id` first, RLS, and AD-11 attribution through column defaults. Schema shape is preferred to checks: the "no reason" rule holds because no such column exists. A refusing trigger needs its own named exception in the spine (AD-3). Writes go through PostgREST under RLS (AD-9).
- **Glossary.** A Leave Record is a date range of absence of one Absence Type for one member. A one-date record may be a Half-day Record, which counts as 0.5 Leave Days.

## UX & Interaction Patterns

- The admin's leave dialog and the member's request form choose the type with a `RadioCard` group after *Od*/*Do* and before the preview. Nothing is preselected, a type is required even when only one exists, and a type that does not draw says that the balance stays unchanged.
- The admin dialog's half day: only while *Od* = *Do*, a *Pola dana* switch, then two `RadioCard`s, *Prvi dio smjene* and *Drugi dio smjene*, each with its times and neither preselected. The request form's order is range, type, half day (13.5b), then cost and balance after, with one *Pošalji*.
- Day figures render through the locale (`0,5`). Leave reads in days (`3 dana`, and `—` at 0).
- The ◷ legend and the cell label read *Odsutnost*, never the type. The UI never says *konflikt*: a collision is *Odsutnost u smjeni*.
- *Organizacija* has a *Prijenos godišnjeg* card, edited in its own dialog. The expiry is a day and a month, never a date picker.

## Cross-Story Dependencies

- 13.2 depends on 13.1, 13.4 on 13.3, 13.5 on 13.2, and 13.5b on 13.5 and on Epic 9's request flow (form, review, `decide_leave_request`).
- Half days and carry-over affect leave cost, balance, collisions, Band Hours, staffing (Epic 11), the request preview and approval (Epic 9), *Za odluku*, notifications (Epic 10) and the offline snapshot (Epic 8). Each surface must read one snapshot.
- Open PO questions from the 13.5 review: whether *Danas* shows a half-day member's worked half (open), and whether the decision surfaces name the half. For requests this is settled by 13.5b: *Za odluku*'s row, the request's decision screen and the member's own list name it. The collision lines (the resolution screen, the calendar day detail) still do not, and stay open in deferred-work.
- Epic 14's change history will read the attributed rows of the new tables and settings.
