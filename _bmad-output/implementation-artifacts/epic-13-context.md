# Epic 13 Context: Absence has a type, unused leave carries over, and a half day exists

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Annual leave is not the only absence an organization records. Unused leave should carry into the next leave year, and some absences last half a shift. In this epic, an organization defines its own absence types: each has a name and says whether it draws down the allowance. No record ever says why someone is absent. Unused leave carries into the next leave year up to a cap and expires on a set date, and a half-day record costs 0.5. All of this is organization data or derived from it. The 2026-10-10 scope expansion added the epic to v1 (CAP-23, decisions D1 "absence types are organization data, no reason recorded, a type's name is admin- and self-only" and D3 "the part-day unit is a half day"). The epic is standalone: existing leave becomes annual leave and reads exactly as before. New stories change the leave surfaces of 5.1, 5.2, 7.12 and 7.15; the original criteria of those stories stay in history.

## Stories

- Story 13.1: Absence types are organization data
- Story 13.2: Leave has a type everywhere it is recorded or reported
- Story 13.3: The allowance is set per leave year
- Story 13.4: Unused leave carries over and expires
- Story 13.5: A half-day record costs half a day

## Requirements & Constraints

- **Absence type:** organization data with a name and a "draws down the allowance" flag. Every organization starts with one drawing type for annual leave. Every Leave Record has exactly one type. Existing Leave Records become annual leave, and their figures do not change.
- **No reason, ever (Q5/NFR-5):** no absence type and no Leave Record has a reason, diagnosis or free-text field. A type's name is visible only to admins and to the member themselves. To any other member, the absent member reads as *odsutan*. If an organization names a type for sick leave, that fact is health data and stays under this visibility rule. Notifications never send another member's absence or absence type to a member-role account.
- **Open question for the pilot (13.1):** does the pilot record sick leave at all? The answer comes at the presentation and is recorded in the 13.1 story spec. If the pilot does, admin-only visibility of the type is the minimum its legal basis requires (GDPR Art. 9(2)(b)).
- **Collisions and balance:** every type, drawing or not, raises a collision against a rostered working shift, exactly as annual leave does. Only Leave Days of drawing types change the Leave Balance. A member absent by any type is not at work for staffing. A member on a half day counts as at work.
- **Reporting (13.2):** *Sati* and the Excel export show one days column per drawing type and one column for the rest, named by organization data. Nothing names a type in code (DI-8).
- **Allowance per leave year (13.3):** the migration turns each member's current single allowance into their allowance for the current leave year, and every balance reads as before. A past year's balance uses that year's allowance.
- **Carry-over (13.4):** an organization setting holds the maximum days and the expiry date. Croatian practice is 30.06., but the core has no default; an empty or zero maximum means no carry-over. Carried days are the previous year's unused balance capped by the maximum. They are derived and never stored. A drawing record uses carried days before the current allowance, and carried days not used by the expiry date lapse. Balance = allowance + unexpired carried days − Leave Days of drawing types, and it holds on every row and every surface (Q19).
- **Half day (13.5):** a one-date record covering the first or second half of the member's working shift costs 0.5 and raises one collision. The interval of the worked half counts in Band Hours by intersection. A half day on a date without a working shift is refused. The story spec may refine this default.
- **Tests (Q9):** each new engine rule (types and drawing, half-day cost, carry-over derivation, cap and expiry, allowance per year, carried days consumed first) gets a node-level assertion with no rendering.
- **Docs in the same change:** 13.2, 13.4 and 13.5 update the DESIGN.md, EXPERIENCE.md and UX-DR lines they change (UX-DR12, 17, 47, 50).

## Technical Decisions

- **AD-2 amendment:** the table gains *absence type* as **current-state** (like a shift type name; 13.1 applies this row) and changes *leave allowance* from current-state to **versioned per leave year** (13.3). Carry-over has to read the previous year's allowance as it was. A new rule kind stays unclassified until it appears in the AD-2 table.
- **Data model (planned):** an organization-scoped `absence_types` table, a type reference on `leave_records`, a `leave_allowances` table versioned per leave year, and carry-over setting columns on `organizations`. Each table follows the standard rules: `organization_id` as its first column, RLS, AD-11 attribution (`created_by default auth.uid()`, `created_at default now()`), and no derived values (AD-1).
- **AD-3:** prefer schema shape to checks. The "no reason field" rule is enforced by leaving the column out. A refusing trigger needs its own named exception in the spine.
- **AD-9:** writes go through PostgREST under RLS. A rule that cannot be declared goes to the spine, not into a new function.
- **AD-1 / AD-7 / AD-8:** `packages/domain/leave` is extended for types, half days and carry-over. It derives carried days, expiry and balance on read and returns codes and operands, never prose.
- **Glossary:** a Leave Record is a date range of absence of one Absence Type for one member. A one-date record may be a Half-day Record, which counts 0.5 Leave Days.

## UX & Interaction Patterns

- **UX-DR50:** the absence type is chosen with a radio card group in the admin's leave dialog and in the member's request form (UX-DR47: range, type, half day, then cost and balance after, one *Pošalji*). The calendar legend's ◷ entry reads *odsutnost*.
- **UX-DR12 / 17:** the glyph legend and the hours table change with the new wording and the per-type days columns.
- The member's tiles and the admin leave overview show carried days and their expiry (13.4).
- The UI never says *konflikt*. A collision is *Odsutnost u smjeni*.

## Cross-Story Dependencies

- 13.1 and 13.3 have no dependencies. 13.2 depends on 13.1, 13.4 on 13.3, and 13.5 on 13.2.
- 13.1 must keep every existing leave surface working as before. Types appear in the dialogs and reports only in 13.2.
- The epic touches shipped leave work: leave records and cost (Epic 5), leave requests and their decision screen (Epic 9; an approval creates a Leave Record, which now needs a type), *Za odluku* collisions (AD-4/AD-5), staffing (Epic 11), notifications (Epic 10) and the offline snapshot (Epic 8).
- Epic 14's change history will read the attributed rows of the new tables.
