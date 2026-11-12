# Epic 13 Context: Absence has a type, unused leave carries over, and a half day exists

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Organizations record more absence than annual leave, unused leave should not vanish at the turn of the leave year, and some absences last only half a shift. This epic makes absence types organization data, each with a name and whether it draws down the allowance, and never a reason. Unused leave carries into the next leave year up to a cap and expires on a set date. A half-day record costs 0.5. Everything is either organization data or derived from it. The epic stands alone: existing leave becomes annual leave and every figure reads as before. It changes the leave surfaces built in Epics 5, 7 and 9 through new stories. As of 2026-11-11, types (13.1), typed recording and reporting (13.2 with follow-ups 13.2b and 13.2c), the per-year allowance (13.3 with follow-up 13.3b) and the carry-over setting (13.4) have shipped. Carry-over was split: 13.4b derives carried days and shows them on every balance surface. The half day (13.5) remains.

## Stories

- Story 13.1: Absence types are organization data
- Story 13.2: Leave has a type everywhere it is recorded or reported
- Story 13.3: The allowance is set per leave year
- Story 13.4: Unused leave carries over and expires
- Story 13.5: A half-day record costs half a day

## Requirements & Constraints

- **No reason, ever:** no absence type and no Leave Record has a reason, diagnosis or free-text field. Only admins and the member themselves see a type's name. Every other member reads the absence as *odsutan*, never the type. A type named for sick leave is health data and stays under this visibility rule. Notifications never tell a member-role account about another member's absence or its type.
- **Collisions and staffing:** every type raises a collision against a rostered working shift, whether it draws or not. A member absent under any type is not at work.
- **Balance:** only Leave Days of drawing types change the balance. Balance = allowance + unexpired carried days − Leave Days of drawing types. It must match on every row and every surface at a given moment.
- **Allowance per leave year:** a past year's balance uses that year's allowance, and changing this year's allowance leaves past figures as they were.
- **Carry-over (13.4):** an organization setting holds the maximum days and the expiry date. Croatian practice is 30.06., but the product sets no default. Carried days are the previous year's unused balance, capped by the maximum. They are derived and never stored, and they expire on the date. A drawing record uses carried days before the current allowance. The member's tiles and the admin leave overview show carried days and their expiry.
- **Carry-over derivation (13.4b, PO decisions 2026-11-11):** carried days into leave year Y = min(cap, max(0, Y−1's balance at its end)), and only from the setting's first carried-into year on. Drawing Leave Days consume carried days first, in date order. Expiry in Y is the first date on or after Y's first day with the stored day and month. Carried days are usable through that date and lapse after it, and moving the leave-year start moves the expiry. After expiry a row reads the consumed part and the lapsed days (e.g. *Preneseno 3 dana (2 istekla 30.06.)*), so allowance + carried − used = balance holds. The carried line with its expiry shows on the *Danas* tile, *Godišnji*, the leave overview (as a column) and the member page leave card. The request preview, request review and resolution screen use only the new balance, all from one snapshot.
- **Half day (13.5):** a one-date record marked as the first or second half of the member's working shift costs 0.5. By default it raises one collision, the interval of the worked half counts in Band Hours by intersection, and the member counts as at work for staffing. The story spec may refine these defaults.
- **Reporting:** *Sati* and the Excel export show one days column per drawing type and one column for the rest, each named from organization data. No type name appears in code.
- **Tests:** every new engine rule gets a node-level assertion that renders nothing: drawing by type, half-day cost, carry-over derivation, cap and expiry, allowance per year, and carried days consumed first.
- **Docs in the same change:** each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes.

## Technical Decisions

- **AD-2 classification:** absence type is **current-state**, like a shift type name. A rename is cosmetic, and whether a type draws is its present setting, so changing it re-derives every balance. Leave allowance is **versioned per leave year**, because carry-over has to read the previous year's allowance as it was.
- **As built, absence types:** `absence_types` holds a name and `draws_allowance` and nothing else. Annual leave has one fixed id in every organization. It can be renamed, never deleted, and always draws. A trigger seeds it for each new organization. `leave_records.absence_type_id` defaults to annual leave, so a record or insert that names no type is annual leave.
- **As built, allowance:** `members.leave_allowance_days` is the starting allowance, and no session may update it. `leave_allowances` holds append-only versions per `leave_year`, and a correction is a new row with a higher `id`. Resolution lives only in `packages/domain/leave`: year Y takes the highest-id version for Y, otherwise the highest-id version of the latest earlier year, otherwise the starting allowance. SQL does no leave-year arithmetic.
- **As built, carry-over setting (13.4, `0057`):** four nullable `smallint` columns on `organizations`, no default: `carry_over_max_days` (`>= 1`), `carry_over_expiry_month` (1–12), `carry_over_expiry_day` (1 to the month's last day, February at 28) and `carry_over_first_leave_year` (1–9999, the first leave year carried INTO; nothing carries into an earlier one). A named check admits all four null (no carry-over) or all four set. It is current-state (AD-2), so a change re-derives every balance, and the admin edits it in one dialog on *Organizacija* (*Prijenos godišnjeg*; an empty or `0` cap clears all four). Carried days, expiry and balance are derived in the domain on read (AD-1, AD-7) and returned as codes and operands, never prose (AD-8); that derivation is 13.4b.
- **As built, carry-over derivation (13.4b):** `@shift/domain` derives it inside `leaveBalanceOf` / `leavePreviewOf` from an optional `carryOver` on the balance input (absent or `null` is none, so every earlier figure is unchanged; a malformed setting throws a `RangeError`). The chain runs from the later of the first year's predecessor and the year before the member's earliest drawing record, each year with its own allowance; a year's end balance is always post-expiry. `LeaveBalance` gains `carriedDays` (all carried days until the expiry, the consumed part after it), `lapsedDays` and `carryOverExpiry` (ISO, `null` when nothing was carried), and `balance = allowance + carried − used`. The preview's `balanceAfterDays` is the balance with the range added as a record, and `exceedsBalance` judges the year's post-expiry balance with the range, so days after the expiry never borrow carried days. The web reads the setting off the organization snapshot (`leaveCarryOverOf`, lenient like `carryOverOf`) into every input; `leaveCarriedLineOf` picks the line's shape (pending, lapsed, kept) by today against the expiry.
- **Schema rules:** each table has `organization_id` first, RLS, and AD-11 attribution through column defaults. Prefer schema shape to checks: the "no reason" rule holds because the column does not exist. A refusing trigger needs its own named exception in the spine (AD-3). Writes go through PostgREST under RLS (AD-9).
- **Glossary:** a Leave Record is a date range of absence of one Absence Type for one member. A one-date record may be a Half-day Record, which counts 0.5 Leave Days.

## UX & Interaction Patterns

- The admin's leave dialog and the member's request form choose the type with a `RadioCard` group after *Od*/*Do* and before the preview. Nothing is preselected, and a type is required even when only one exists. A type that does not draw leaves the balance unchanged and says so. The request form's order is range, type, half day (from 13.5), then cost and balance after, with one *Pošalji*.
- The legend and cell label for the ◷ mark read *Odsutnost*, never the type. Other members see *Zamjena za {member} (odsutnost)*.
- *Organizacija* has a *Prijenos godišnjeg* fact card after *Vrijeme i godina* ("Najviše 5 dana, istječu 30.06., od godine godišnjeg 2027." or "Bez prijenosa."), edited in its own dialog from `Uredi` in the header, with one Spremi beside Odustani. The expiry is a day and a month, never a date picker.
- The UI never says *konflikt*. A collision is *Odsutnost u smjeni*.
- Leave figures read in days (`3 dana`, `—` at 0), with per-type columns and an ⓘ that lists the charged dates. Carried days and their expiry join the member's tiles and the leave overview, and every row still balances.

## Cross-Story Dependencies

- 13.2 depends on 13.1, 13.4 on 13.3, and 13.5 on 13.2.
- Carry-over and half days ripple through leave cost, balance, collisions, Band Hours, staffing, the leave request preview and approval (Epic 9), *Za odluku* (AD-4/AD-5), notifications (Epic 10), the short-staffed check (Epic 11) and the offline snapshot (Epic 8). Each surface must read one snapshot.
- Epic 14's change history will read the attributed rows of the new tables and settings.
