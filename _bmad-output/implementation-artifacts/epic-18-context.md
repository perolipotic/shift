# Epic 18 Context: A member is lent to another team for a while

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An admin lends one member to another team of the same organization for an inclusive date range. On those dates the member's calendar, hours, conflicts and the staffing warnings of both teams follow the loan, and the day after the range they are back on their own team with nothing to undo. Until now this needed a Roster Override on every date, twice, with nothing tying them together. A Loan states it once, as a first-class exception that never touches a rotation or a team membership.

## Stories

- Story 18.1: The loan rule in the domain
- Story 18.2: A loan is a recorded exception
- Story 18.3: An admin lends a member to another team
- Story 18.4: An admin amends, ends early or removes a loan
- Story 18.5: Loans are visible wherever rosters are read

## Requirements & Constraints

- **Engine rules for loans:**
  - The effective team of a member on a date is the loan team if a Loan covers that date, otherwise the home team.
  - The base Shift Roster of team T on date d is the active members whose effective team on d is T. Roster Overrides then apply on top, unchanged.
  - Loans of one member never overlap. A loan to the member's own home team, or to an archived team, is refused.
  - **With no Loan, every roster, hour, conflict, staffing, swap and export output is byte-identical to before.** Assert this over both fixtures and keep the e2e month snapshots green. This is the epic's main safety guard, because the change sits under every figure.
  - A Loan never changes a Rotation Assignment, Rotation Pattern or team membership. Membership and rotations are byte-identical before and after.
  - Worked example on the pilot fixture: a Team A member is lent to Team C for the 10th–12th. A's rosters on those dates lose them, C's gain them, their hours follow C's Shift Types, and on the 13th they are on A again.
- A member with no team can be lent, and works with the loan team for the range.
- Hours follow the shifts worked with the loan team. Conflicts arise against the loan team's shifts. Short-staffed Shifts are derived for both teams. A swap may give or take a shift held through a loan.
- A loan records the member, loan team, inclusive from and to dates, a reason, and the author and timestamp.
- Removing a loan returns every covered date exactly to what it would be if no loan had ever been recorded.
- Saving, amending, ending early or removing a loan reports its consequences first and never blocks the save:
  - shifts gained and lost per date;
  - double booking on the range's boundary days;
  - the continuous duration where one team's shift runs into the other's with no rest, using the existing rest-gap figure;
  - every Short-staffed Shift caused in either team;
  - Roster Overrides on covered dates that the change makes inapplicable, for the admin to keep or remove. None is silently discarded.
- The member is notified when a loan is made, changed or removed, and the change history records each event.
- Loans are admin-only. A member-role account is refused every loan write at the data layer, including direct API calls. A member sees its own loans and other members' current team. Loan reasons are visible only to admins.
- Loans are not multi-membership and never cross organizations.

## Technical Decisions

- **Domain (18.1):** the per-date effective team is a new input to roster derivation inside the pure domain package. Hours, conflicts, staffing, swaps and the export inherit loans through the same canonical functions, so none of them gets a second implementation. Domain output is codes and operands, never prose.
- **Classification:** a Loan is an **Exception**, date-ranged like a Leave Record. It is never versioned and is not a rule version. 18.2 adds the Loan row to the spine's table that classifies every rule kind as versioned or current-state.
- **Table `team_loans` (18.2):**
  - organization-scoped, with `organization_id` as the first column;
  - RLS on: admins write; members read only their own loans;
  - attribution from column defaults (`created_by default auth.uid()`, `created_at default now()`, with an RLS `WITH CHECK (created_by = auth.uid())`);
  - the two standard audit triggers (`<table>_audit` and `<table>_audit_update`), attached in the migration that creates the table.
- **Illegal states by schema shape:** use an `EXCLUDE USING gist (member_id WITH =, during WITH &&)` exclusion constraint for overlap per member, as leave records do. Refuse a loan to the home team or to an archived team by shape or constraint. Do not use client-only validation or a new computing trigger.
- **Persistence:** nothing derived is persisted. No effective-team column or roster table is stored.
- **Read-set parity:** the browser snapshot feeds loans to the domain rule. If `member_schedule_inputs` (story 16.2) has shipped, it must return loans too, with a parity test proving both reads give equal projections. 18.2 is the first test of that read-set drift risk.
- **Erasure diff on every loan write:** a loan's save, amend or removal is a write that changes the projected schedule.
  - It runs the existing erasure diff, with the unresolved collision set before and after, and the "after" snapshot carrying the draft loan.
  - Erased collisions need explicit confirmation.
  - Overrides on covered dates whose target member is no longer on that roster are surfaced for review, the same way a rotation change surfaces them.
  - Everything else warns and never blocks.
- **Snapshots:** one snapshot per surface. The *Što se mijenja* preview derives everything from the same "after" snapshot.
- **Notification:** the request that writes the loan also writes the notification to the outbox, as codes and operands, through the existing notify-trigger pattern. The sender computes no domain answer.
- **Copy:** all Croatian strings go in the `loans` namespace of `hr.json`. The change history words loan events from codes.

## UX & Interaction Patterns

- **Loan dialog (member detail → *Posudi drugom timu*):**
  - Fields: team, *Od* and *Do*.
  - Then *Što se mijenja*, with the consequence list above, and one *Spremi*.
  - Amend, end early and remove use the same dialog and the same preview.
  - It follows the existing save-time warning pattern: warnings are shown in numbers at save and never as standing banners.
- **Loan marks:**
  - Calendar day detail and Team filter: a lent member appears under the loan team marked `posuđen iz {tim}`, with a glyph plus words and never colour alone.
  - The member's own schedule and *Danas*: `u timu {tim} do {datum}`.
  - Directory: the home team, plus `trenutno u timu {tim}` during a loan.
  - Hours explanation: the source is named `posudba`.
  - The Excel export follows rosters, with no column change.
- **Navigation:** the admin member detail gains *Posudi drugom timu*.
- **Docs:** stories that change UX-DR23, 31/32, 58 or 59 update DESIGN.md, EXPERIENCE.md and the UX-DR lines in the same change.

## Cross-Story Dependencies

- Stories run in strict order: 18.1 → 18.2 → 18.3 → 18.4 / 18.5. 18.1 can start now.
- 18.3 depends on story 11.2, the short-staffed warning at save.
- 18.2's parity requirement applies only if story 16.2 (`member_schedule_inputs`) has shipped. Epic 16 must then carry loans in its server-side read.
- The calendar feed (Epic 16) and reminders (Epic 17) inherit loans automatically through the domain package.
- Epic 18 depends on no pending founder decision and needs no Architect pass beyond the Loan rows it adds to the versioned-or-current-state table and to the erasure-diff rule.
