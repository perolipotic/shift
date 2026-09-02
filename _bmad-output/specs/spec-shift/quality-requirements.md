# Quality Requirements

Cross-cutting non-functional requirements. Vocabulary per `glossary.md`.

## Tenancy and security

- **Q1.** Tenant isolation is enforced at the database layer (row-level security or equivalent), not in application or frontend code. A test issuing a cross-tenant read with a valid session must fail closed.
- **Q2.** Role enforcement lives at the same layer. Every administrative write is refused for a Member Role account identically whether attempted through the UI or a direct API call. This is more than tenant scoping and needs its own policy design.
- **Q3.** Every Organization-scoped record carries its Organization reference; no record is reachable without it.
- **Q4.** Uploaded branding assets are readable only by Members of the owning Organization.
- **Q5.** Personal data is limited to what scheduling requires: name, optional email, team, hours, leave. No health data, and no absence-reason field that invites it.
- **Q6.** An Organization can never be left with zero Admins, and the last Admin's Role cannot be downgraded.

## Domain logic isolation

- **Q7.** Rotation projection, schedule generation, hour computation, leave-day counting, and conflict detection are pure, framework-free, unit-testable logic — no React dependency, no direct data-access dependency.
- **Q8.** Exactly one canonical implementation of each domain calculation. The same input yields the same output regardless of call site. A calculation duplicated across client and database violates this even when both copies agree today. A declarative database *constraint* is not a calculation: an exclusion constraint refusing overlapping leave, or a foreign key making an out-of-range value unrepresentable, reimplements nothing and does not violate this. A database routine that *computes* a domain answer does.
- **Q9.** Every constraint in SPEC.md and every rule in `engine-rules.md` has at least one automated assertion, executable without rendering a component or starting a browser.
- **Q10.** Two configuration fixtures minimum: the pilot, and a structurally different organization whose bands and shifts diverge. See `engine-rules.md` §8.

## Auditability

- **Q11.** Every Override and Conflict Resolution records the acting Admin, a timestamp, and the affected records, and that record outlives the schedule entry it modified.
- **Q12.** The data model supports reconstructing who changed a schedule entry and when. No audit-log interface exists in MVP.

## Platform and responsiveness

- **Q13.** Responsive web application supporting mobile, tablet, and desktop. No native application.
- **Q14.** Members are primarily on phones. Small-viewport priority order: today's shift, next shift, calendar, hours, leave.
- **Q15.** Admins are primarily on desktop or tablet, with every administrative task also completable on mobile — degraded in comfort, never in capability.
- **Q16.** No screen requires horizontal scrolling at phone width. Wide content — the Calendar, member list, hours table — scrolls within its own container.

## Performance and consistency

- **Q17.** A monthly Calendar in the all-teams view renders within two seconds on a mid-range phone over typical mobile network conditions, at the pilot's scale (tens of members, single-digit teams).
- **Q18.** Navigating to any month, past or future, performs comparably whether or not that range has been visited before.
- **Q19.** Hour and leave figures are consistent across every surface displaying them at a given moment. No screen shows a stale total beside a fresh one.
- **Q20.** The member list remains usable at the pilot's scale and at several hundred members.

## Accessibility

- **Q21.** No information is conveyed by color alone. Shift types, conflicts, uncovered shifts, overridden state, and leave each carry a non-color signal.
- **Q22.** The Calendar and both dashboards are keyboard navigable and expose meaningful labels to assistive technology.
- **Q23.** Target is WCAG 2.1 AA, without formal audit in MVP. Assumed, not confirmed.
