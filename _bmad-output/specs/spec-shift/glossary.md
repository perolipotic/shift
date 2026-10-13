# Glossary

Canonical vocabulary. Every consumer of this spec uses these terms exactly; introducing a synonym is a contract violation.

## Tenancy and people

- **Organization** — a tenant. Owns every other record. Carries name, short name, description, address, contact details, an Organization Type, a timezone, a locale, a Leave Year, Hour Bands, and branding. Has many Members, Teams, Shift Types, and Rotation Patterns.
- **Organization Type** — a descriptive label (e.g. "Fire Department"). May affect presentation and, later, onboarding templates. Never affects scheduling, hours, leave, or conflict logic.
- **Member** — a person belonging to exactly one Organization. Carries name, optional email, active/inactive status, a Role, at most one Team, and a Leave Allowance. *"Member" always means the person, never the permission level.*
- **Role** — a Member's permission level: **Admin** or **Member Role**. Where the permission level is meant, the term is always "Admin" or "Member Role", never bare "Member".
- **Team** — a named group of Members within an Organization sharing one Rotation Assignment. A Member belongs to at most one Team.

## Shifts and time

- **Shift Type** — a reusable named definition of a working or non-working period: start time, end time, and a working flag. Carries no hour classification of its own. A non-working Shift Type has zero duration and needs no times. A Shift Type whose end time is not after its start time crosses midnight.
- **Nominal Duration** — the configured wall-clock length of a Shift Type, independent of daylight-saving transitions. Authoritative for all hour accounting.
- **Elapsed Duration** — real time between a Scheduled Shift's absolute start and end instants. Equals Nominal Duration except across a daylight-saving transition. May be displayed; never used for accounting.
- **Hour Band** — an Organization-defined, named window of the day that hours are reported under, given by its name and start time. Consecutive Hour Bands partition the full 24 hours with no gap and no overlap; a band may cross midnight.
- **Band Hours** — the portions of a Member's working Scheduled Shifts' Nominal Durations falling within each Hour Band, summed per band.
- **Total Hours** — the sum of Band Hours across all Hour Bands. Always equals the summed Nominal Durations of the Member's working Scheduled Shifts.

## Rotation and schedule

- **Rotation Pattern** — an ordered, repeating sequence of Shift Types belonging to an Organization, optionally named. Its length is the **Cycle Length**. Arbitrary; no assumed relationship to a week.
- **Rotation Assignment** — the binding of a Team to a Rotation Pattern with a **Rotation Offset** (position within the Cycle) and an **Anchor Date** (the date at which the Team sits at that Offset). Together these fully determine the Team's Projected Schedule.
- **Projected Schedule** — the Shift Type a Team is assigned on each date, derived purely from its Rotation Assignment. Contains no exceptions.
- **Scheduled Shift** — one (date, Team, Shift Type) entry in the Schedule, with a Shift Roster. Derived from the Projected Schedule and then modified by applicable Overrides. A midnight-crossing Scheduled Shift belongs to the date on which it starts.
- **Shift Roster** — the Members expected to work a Scheduled Shift: the assigned Team's active Members, modified by Roster Overrides.
- **Schedule** — the Projected Schedule combined with the Override layer. What the Calendar shows. Never authored directly.
- **Override** — a recorded exception to the Projected Schedule on a specific date, of one of two kinds. Carries author, timestamp, and reason. Never modifies a Rotation Pattern or Rotation Assignment.
  - **Shift Type Override** — changes the Shift Type for a Team on a date.
  - **Roster Override** — adds, removes, or replaces a Member on a specific Scheduled Shift.
- **Coverage Warning** — a non-blocking notice that a Rotation configuration produces dates with no working Team, or more than one working Team on the same Shift Type.
- **Rest Gap Warning** — a non-blocking notice that a Rotation configuration schedules a Team for consecutive working Shift Types with no non-working interval between them.

## Leave and conflicts

- **Leave Allowance** — the Leave Days a Member is entitled to in a Leave Year.
- **Leave Year** — the Organization-defined annual period against which Leave Allowance is measured. Need not align to the calendar year.
- **Absence Type** — an Organization-defined kind of absence, given by its name and whether it draws down the Leave Allowance. Annual leave is the drawing type every Organization starts with. Never carries a reason. Its name is visible only to Admins and to the Member themselves.
- **Leave Record** — a date range of absence of one Absence Type for one Member, entered by an Admin or created by approving a Leave Request. A one-date record may be a Half-day Record.
- **Half-day Record** — a one-date Leave Record covering the first or the second half of the Member's working Scheduled Shift on that date. Costs 0.5 Leave Days.
- **Leave Request** — a Member's own request for a Leave Record, pending until an Admin approves or rejects it, or the Member withdraws it. While pending, it derives nothing.
- **Leave Day** — one date within a Leave Record on which the Member had a working Scheduled Shift. A Half-day Record counts 0.5. Only Leave Days of drawing Absence Types draw down Leave Balance, and the hours views report leave as Leave Days, never as hours.
- **Carried-over Days** — the unused Leave Balance of the previous Leave Year that moves into the current one, capped by the Organization's setting and expiring on the date that setting names. Derived, never entered.
- **Leave Balance** — Leave Allowance plus Carried-over Days not yet expired, minus Leave Days of drawing Absence Types consumed in the Leave Year.
- **Conflict** — the state of a working Scheduled Shift whose Shift Roster includes a Member covered by a Leave Record on that date. First-class and visible; derived from the Schedule and Leave Records rather than stored, so it can never be missed. What is stored is its Conflict Resolution. *UI vocabulary:* the Croatian UI renders a Conflict as an item *za odluku* (absence in a shift), never as "konflikt"; this term stays in code and docs.
- **Conflict Resolution** — the explicit Admin action clearing a Conflict: **Accept as Uncovered**, **Replace Member**, or **Amend Leave**.
- **Uncovered Shift** — a working Scheduled Shift deliberately recorded as having no Member to work it, via Accept as Uncovered.
- **Swap Request** — a Member's proposal to give a colleague their working Scheduled Shift, optionally taking one of the colleague's in return. The colleague accepts or declines; an Admin approves or rejects. Only approval writes anything, as Roster Overrides.

## Staffing, notifications and history (added 2026-10-10)

- **Minimum Members** — an Organization setting: how many people a working Scheduled Shift needs. Empty means no staffing signal at all.
- **Short-staffed Shift** — a working Scheduled Shift whose people at work — its Shift Roster after Overrides, minus every Member absent that date — number fewer than Minimum Members. Derived, never stored; it warns and never blocks.
- **Notification** — an email or push message telling a Member about their own schedule or requests, or an Admin about an item waiting for a decision. Written as a code and operands by the request that asserts the fact it reports.
- **Change History** — the Admin-only, append-only record of every write to an Organization's records: author, time, and values before and after.
