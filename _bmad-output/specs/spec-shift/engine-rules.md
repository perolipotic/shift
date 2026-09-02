# Engine Rules

The computation rules the domain logic must implement, with the worked examples that decide them. Vocabulary per `glossary.md`. Every rule here is testable without a browser or a rendered component; the pilot's seed configuration referenced in examples is defined in the adopted addendum, §1.

---

## 1. Rotation projection

The Projected Schedule is a pure function:

```
projectedShiftType(team, date) =
    pattern[ (offset + daysBetween(anchorDate, date)) mod cycleLength ]
```

Rules:

- **R1.1** Deterministic and repeatable. Two evaluations for the same team and date agree, always.
- **R1.2** Defined for dates *before* the Anchor Date as well as after. `daysBetween` may be negative; the modulo must be a true mathematical modulo, not a language remainder that returns negatives.
- **R1.3** Cycle Length is arbitrary. Nothing may assume 7, or any relationship to a week.
- **R1.4** The same Shift Type may appear more than once in a Pattern.
- **R1.5** An empty Pattern is **refused at save** — `cycleLength` of 0 leaves the modulo undefined. Same class as R1.6: refused because the result is unrepresentable, not because it is unwise.
- **R1.6** Offset must be within `[0, cycleLength)`, **refused at save** — an offset outside the cycle names no position in the pattern, so `projectedShiftType` has no defined answer. This is one of the product's save refusals, not a warning (§5).
- **R1.7** Teams may share a Pattern at different Offsets, or at the same Offset. The same Offset is legal and produces warnings, not an error (§5).

**Worked example — the pilot.** Pattern `[Dan, Noć, Slobodno, Slobodno]`, cycle length 4, teams at offsets 0–3, shared anchor date. Day grid over one cycle:

```
          A         B         C         D
Day 1    Dan       Noć       Slob      Slob
Day 2    Noć       Slob      Slob      Dan
Day 3    Slob      Slob      Dan       Noć
Day 4    Slob      Dan       Noć       Slob
```

Each day has exactly one team on `Dan` and one on `Noć`. This is a property of this configuration, not a guarantee of the engine.

---

## 2. Override layering

```
scheduledShift(team, date) = applyOverrides(projectedShiftType(team, date))
shiftRoster(team, date)    = activeMembers(team) modified by rosterOverrides(team, date)
```

Rules:

- **R2.1** No Override may write to a Rotation Pattern or Rotation Assignment. The rule records are byte-identical before and after any override operation.
- **R2.2** Removing every Override returns the Schedule to the pure projection exactly, and returns every roster to its default membership.
- **R2.3** A Roster Override's *replace* operation is one atomic action recording both the removed and the added Member — not a remove plus an unrelated add.
- **R2.4** A Member may be added by Roster Override to a shift on a date their own Team is non-working.
- **R2.5** Every Override carries author, timestamp, and reason, and that record outlives the schedule entry it modified.
- **R2.6** Removing an Override is itself an attributable action.
- **R2.7** An overridden date is distinguishable from a projected one without opening a detail view, and the detail exposes the projected value the override replaced.

### Rotation change reconciliation

- **R2.8** A rotation edit takes an effective date. Shifts before it are unchanged.
- **R2.9** Overrides dated on or after the effective date are enumerated for explicit admin disposition — confirm, amend, or discard. None may be silently discarded, and none may be silently reapplied to a shift it was not written for.
- **R2.10** A rotation change creates a new **versioned** Rotation Assignment with a validity range; no Assignment row is ever updated in place, and projection selects the version covering the date being derived. Team membership, Member active status, and Shift Type times are versioned the same way and for the same reason. See `ARCHITECTURE-SPINE.md` AD-2.

---

## 3. Hour computation

Hours are derived, never entered. Two stages: nominal duration, then band intersection.

### Nominal duration

- **R3.1** `nominalDuration = endTime - startTime`, and where `endTime <= startTime`, `+ 24h`. Derived from the times; never entered by hand.
- **R3.2** A non-working Shift Type has zero Nominal Duration and needs no times.
- **R3.3** A midnight-crossing Shift Type produces exactly **one** Scheduled Shift, of its full Nominal Duration, attributed to its **start date**. Never two rows, never two dates, never counted twice.
- **R3.4** A 24-hour Shift Type (e.g. 08:00–08:00) is valid and yields 24 hours.
- **R3.5** Nominal Duration is authoritative for all accounting. Elapsed Duration — real time between absolute instants — differs on daylight-saving transition dates and must never enter an hour total. A 19:00–07:00 shift reports 12 hours on every date of the year.

### Band intersection

- **R3.6** Band Hours are computed by intersecting the shift's **nominal wall-clock interval** with each Hour Band. Operating on nominal intervals is what makes results DST-stable per R3.5.
- **R3.7** Band Hours always sum exactly to Nominal Duration, and Total Hours always equals the summed Nominal Durations of the member's working shifts. This is an invariant to assert, not an expectation.
- **R3.8** A shift straddling a band boundary is **split**, never rounded to one band.
- **R3.9** Hour Bands partition the full 24 hours. A configuration with a gap or an overlap is refused at configuration time, so no working hour is unclassified and none is counted twice.
- **R3.10** A band may cross midnight, and its intersection with a midnight-crossing shift must be computed as one continuous interval on both sides.
- **R3.11** Hours follow the Shift Roster. A Roster Override moves hours between Members; the added Member's rise and the removed Member's fall, with no effect on anyone else.
- **R3.12** Shift **counts** per band are reported alongside hours.
- **R3.13** Moving a band boundary recomputes Band Hours for affected shifts and modifies no Shift Type record and no Total Hours.

**Worked example A — the pilot.** Bands `Dan` starting 07:00 and `Noć` starting 19:00, so `Dan` = 07:00–19:00 and `Noć` = 19:00–07:00. These coincide with the shift changeover times, so no shift straddles a boundary:

| Shift | Nominal | Day hours | Night hours |
|---|---|---|---|
| `Dan` 07:00–19:00 | 12h | 12 | 0 |
| `Noć` 19:00–07:00 | 12h | 0 | 12 |

Five `Dan` shifts and four `Noć` shifts in a month: **60 day, 48 night, 108 total**, with counts 5 and 4.

**Worked example B — bands diverging from shifts.** Same shift types, bands moved to `Dan` starting 06:00 and `Noć` starting 21:00:

| Shift | Nominal | Day hours | Night hours |
|---|---|---|---|
| `Dan` 07:00–19:00 | 12h | 12 | 0 |
| `Noć` 19:00–07:00 | 12h | **3** (19:00–21:00, 06:00–07:00) | **9** (21:00–06:00) |

Same shift records, same nominal durations, different split. **The pilot exercises only example A**, so example B — or an equivalent configuration whose bands and shifts diverge — must exist as a second test fixture or R3.6 and R3.8 ship unverified.

**Worked example C — a 24-hour shift.** A single 07:00–07:00 Shift Type under the pilot's bands yields 12 day and 12 night hours. Recorded to show band intersection is independent of how a duty period is decomposed; the pilot nonetheless models its 24-hour duty as two consecutive 12-hour shifts, because per-band shift counts (R3.12) require day and night to be distinct Shift Types.

---

## 4. Leave accounting

- **R4.1** A Leave Record is a date range for one Member, entered by an Admin. Recording it modifies no Rotation Pattern, no Rotation Assignment, and no Scheduled Shift.
- **R4.2** **Cost** = the count of dates in the range on which the Member had a **working** Scheduled Shift. Non-working dates inside the range cost nothing. *This rule is inferred, not confirmed by the pilot organization — see SPEC open questions.*
- **R4.3** Cost is shown before saving, and is recomputed if an Override later changes whether a date in the range is working.
- **R4.4** A range overlapping an existing Leave Record for the same Member is refused, so no date is charged twice.
- **R4.5** `Leave Balance = Leave Allowance − Leave Days consumed in the Leave Year`. The three figures are internally consistent at every observable moment.
- **R4.6** Only Leave Days inside the current Leave Year count toward Balance. The Leave Year need not align to the calendar year.
- **R4.7** A record whose cost exceeds remaining Balance is saved **with a warning**, not refused, so a real agreement is never unrecordable.
- **R4.8** Deleting a Leave Record restores consumed Balance. Amending recomputes cost, Balance, and Conflicts for the new range.
- **R4.9** Changing a Member's Leave Allowance recomputes Balance and never retroactively invalidates an existing Leave Record.
- **R4.10** Hours from a working shift covered by a Leave Record are reported as **Leave Hours**, and are never added into Band Hours or Total Hours.

**Worked example.** Leave 10.09–14.09 against a schedule of `Dan`, `Noć`, `Slobodno`, `Slobodno`, `Dan`: cost is **3 Leave Days** and **3 Conflicts** are raised. The two `Slobodno` dates cost nothing and raise nothing.

---

## 5. Configuration warnings

Both are reported on save, never persist as standing alerts, and never block.

- **R5.1 Coverage Warning.** Over the next full cycle, report dates with no working Team, and dates with more than one working Team on the same Shift Type.
- **R5.2** Two Teams at the same Offset produce both a duplicate-coverage and a gap warning.
- **R5.3** The pilot configuration reports zero coverage gaps and zero duplicates.
- **R5.4 Rest Gap Warning.** Report where a Team is scheduled for consecutive working Shift Types with no non-working interval between, stating the resulting continuous duration.
- **R5.5** The reported duration is computed from Nominal Durations, so it is stable across daylight-saving transitions.
- **R5.6** The pilot configuration **does** produce a rest-gap report — `Dan` immediately precedes `Noć`, giving 24 continuous hours — and this is a deliberate design, not a misconfiguration. Warnings must therefore be informational at save time only, so a deliberate pattern generates no recurring noise.
- **R5.7** A pattern with a non-working slot between every pair of working slots produces no rest-gap report.

---

## 6. Conflict lifecycle

```
Conflict exists  ⟺  a working Scheduled Shift's roster includes a Member
                    covered by a Leave Record on that shift's date,
                    and no Resolution has been recorded
```

- **R6.1** Detection creates a Conflict per affected working Scheduled Shift. Non-working shifts coinciding with leave create nothing.
- **R6.2** Detection deletes, hides, and alters no Scheduled Shift.
- **R6.3** A Conflict persists until an explicit Resolution is recorded. Nothing expires it, auto-clears it, or suppresses it from view.
- **R6.4** Detection re-runs when: leave is recorded, amended, or deleted; an Override changes a shift type or a roster; a Member changes Team; a Member is deactivated; a Rotation changes.
- **R6.5** There is no recomputation. A Conflict is derived on read from the Schedule and Leave Records, so R6.3 holds by construction — no event can be missed, because no event is what creates it. Only the Conflict Resolution is stored. See `ARCHITECTURE-SPINE.md` AD-4.
- **R6.6** Exactly three Resolutions exist, each recording the acting Admin and a timestamp:

| Resolution | Effect |
|---|---|
| **Accept as Uncovered** | Shift remains, marked Uncovered, stays visible on the Calendar. Absent Member's hours count as Leave Hours, not Band Hours. |
| **Replace Member** | Implemented as a Roster Override (§2). Replacement's Band Hours rise; absent Member's do not. Shift is neither in Conflict nor Uncovered. Warns without blocking if the replacement is themselves on leave or already rostered that date. |
| **Amend Leave** | Recomputes cost, Balance, and Conflicts for the new range (R4.8). Deleting the record clears every Conflict from it and restores Balance. |

- **R6.7** Deleting or amending a Leave Record whose Conflict was already resolved by **Replace Member** must not silently revert that Roster Override; the situation is surfaced to the Admin.
- **R6.8** Unresolved Conflicts are listed soonest-first, with date, Team, Shift Type, Member, and the causing Leave Record. Conflicts for past dates remain listed and distinguishable from upcoming ones.

---

## 7. Member lifecycle effects on the engine

- **R7.1** A Member with no Team has an empty schedule and generates no Conflicts.
- **R7.2** Moving a Member between Teams changes their schedule from the move date forward and rewrites no history.
- **R7.3** Deactivating a Member preserves all historical Scheduled Shifts, Overrides, hours, and Leave Records; removes them from **future** Shift Rosters; alters no past shift; and generates no new Conflicts.
- **R7.4** Deactivation removes a Member from **future** Shift Rosters and alters no past roster, because active status is versioned (`ARCHITECTURE-SPINE.md` AD-2). *Open:* whether the vacated shift stays silently short-handed or raises a signal. It would not be a Conflict, which is specifically Leave against a rostered working Shift, so raising one means defining a second derived signal. Product decision.
- **R7.5** Adding an active Member to a Team adds them to that Team's future Shift Rosters without touching past ones.
- **R7.6** A Team with historical Scheduled Shifts is archived rather than deleted, and its history remains readable.

---

## 8. Required test coverage

- **R8.1** Every constraint in SPEC.md and every rule in this document has at least one automated assertion, executable without rendering a component or starting a browser.
- **R8.2** Two configuration fixtures at minimum: the pilot, and a structurally different organization differing in team count, cycle length, shift durations, **and** band boundaries such that shifts straddle a band edge (worked example B). The second fixture is the UJ-5 configuration from `EXPERIENCE.md`: a security organization, three teams, a five-slot rotation pattern, eight-hour shifts, and its own band boundaries. It is named rather than left to the test author because the pilot's bands coincide with its shift changeovers (R3.8, R8.2 note), so an abstractly-chosen second fixture can satisfy the wording while still never exercising band splitting.
- **R8.3** Explicit cases for all three save refusals — empty pattern (R1.5), offset outside cycle (R1.6), and an hour-band gap or overlap — and for: negative `daysBetween` (R1.2), midnight-crossing intersection (R3.10), both daylight-saving transition dates (R3.5), band-hours-sum invariant across randomized configurations (R3.7), and the leave-overlap refusal (R4.4).
