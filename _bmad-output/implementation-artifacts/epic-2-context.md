# Epic 2 Context: The rota is defined once, and projects itself

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic turns a secured, populated tenant into one with a working schedule, without anyone typing in a single date. An admin defines the organization's hour bands, its shift types (including one that crosses midnight), and a repeating rotation pattern of any length. The admin then binds each team to that pattern at an offset from a shared anchor date. Before saving, the admin sees the next full cycle rendered from their own configuration, with the coverage and rest-gap consequences stated in numbers. After saving, the shift for any team on any date, past or future, can be answered. This is the product's critical path. It is also where the pure domain package, the browser-free test suite with both fixtures, and the versioning pattern for rules begin.

## Stories

- Story 2.1: An admin defines the day's hour bands so a gap cannot be expressed
- Story 2.2: An admin defines shift types, including one that crosses midnight
- Story 2.3: An admin builds the rotation and sees the cycle before saving
- Story 2.4: Rotation configuration completes on a phone
- Story 2.5: Saving a rotation reports what it will actually do
- Story 2.6: An admin changes the rotation from a date forward

## Requirements & Constraints

- **Hour bands** partition the full 24 hours. A band may cross midnight. Any number of bands is allowed: three bands must produce three figures with no code change. Moving a boundary recomputes band hours and changes no total. Bands apply retroactively by design.
- **Shift types:** duration is derived and never entered. The rule is `end - start`, plus 1440 minutes when `end <= start`. A 19:00–07:00 type is 12 h and produces exactly one scheduled shift, attributed to its start date. It is never split and never counted twice. A 24-hour type (e.g. 07:00–07:00) is valid. A non-working type has no times and zero duration. No field names or implies an hour band. Editing a type's times leaves past hours unchanged. A rename takes effect everywhere.
- **Projection:** `pattern[(offset + daysBetween(anchor, date)) mod cycleLength]`. It is deterministic and repeatable, and uses a true mathematical modulo so it works for dates before the anchor. Cycle length is arbitrary, and nothing may assume a week. A shift type may repeat within a pattern. Teams may share a pattern at the same or different offsets, and sharing an offset is legal (it only produces warnings). Projection works for arbitrary dates with no generation run.
- **Exactly three save refusals**, each one because the state cannot be represented: a gap or overlap in hour bands, an empty pattern, and an offset outside the cycle. A refused save names the problem and keeps every value entered. The UX doc says "two refusals"; that is out of date, and three is correct.
- **Warnings inform and never block.** They are computed over the next full cycle and reported at save time only, never as a standing banner:
  - Coverage gap: a date with no working team.
  - Duplicate coverage: two or more teams on the same working type on the same date. Two teams at the same offset trigger both a duplicate and a gap warning.
  - Rest gap: consecutive working types with no non-working step between them. It states the continuous duration from nominal minutes, so it stays the same across daylight-saving changes.
  - The pilot must report 0 gaps, 0 duplicates, and a rest gap of 24 h. That warning is intentional and is not a misconfiguration.
- **Rotation change:** takes an effective date. Every shift before that date is unchanged, and the change is attributable to an admin and a timestamp.
- **Testing:** every rule has an assertion that runs in Vitest in the node environment, with no jsdom and no browser. Each assertion runs against both fixtures:
  - **Pilot:** Dan 07:00–19:00, Noć 19:00–07:00, Slobodno non-working. Bands Dan@07:00 and Noć@19:00. Pattern `[Dan, Noć, Slobodno, Slobodno]`. Teams A–D at offsets 0–3.
  - **UJ-5 security organization:** 3 teams, a 5-step pattern, 8-hour shifts, and band boundaries that shifts straddle, so band splitting is exercised.

  Required explicit cases: each of the three refusals, a negative `daysBetween`, and a midnight-crossing band intersection.
- **Definition of done:** usable from 320 px upward, with no horizontal page scroll. No colour-only meaning. All strings come through i18n.

## Technical Decisions

- **Nothing derived is persisted.** There are no shifts or schedule tables. The projected schedule, cycle preview and warnings are all computed on read by `packages/domain`. That package is pure TypeScript with zero dependencies and no React, Supabase or I/O. It is the only implementation of each calculation. Its planned modules are `projection`, `duration`, `bands` and `warnings`. Its shape is `(config snapshot, exceptions, window) -> derived values`, over plain serializable objects.
- **Time is integer minutes since midnight, over nominal wall-clock time.** No `Date`, `timestamptz` or instant enters any calculation. Shift types store `start_time`/`end_time` as `time` plus `is_working`.
- **Which rules are versioned and which are current-state:**
  - Versioned: rotation assignment, rotation pattern and steps, and shift type times. A versioned rule carries a validity range, is never updated in place, and is selected by the date being derived.
  - Current-state: shift type name and hour bands.

  A rotation change closes the current assignment version and opens a new one. Follow the same versioning approach already built for team membership and active status.
- **Schema shape stands in for validation:**
  - `hour_bands` stores name and start time only. The window, duration and midnight flag are derived, so a gap or overlap cannot be stored.
  - A rotation offset is a foreign key to a step of the same pattern, never an integer. An empty pattern has no step to reference.
  - No new triggers are allowed.
- **Domain returns codes and operands, never prose.** For example: `{ code: 'REST_GAP', hours: 24 }` and `{ code: 'COVERAGE_GAP', dates: [...] }`. Codes are stable `SCREAMING_SNAKE`, and the i18n layer resolves them, including Croatian's three plural forms.
- **Entities:** `hour_bands`, `shift_types`, `shift_type_versions` (times), `rotation_patterns`, `rotation_steps` (ordered, each referencing a shift type), and `rotation_assignments` (versioned; team, anchor date, offset-step FK). Every table has `organization_id` as its first column, RLS on the JWT claim plus the role helper, and admin-only writes that are refused through a direct API call too.
- **Attribution on assignment changes:** `created_by default auth.uid()` and `created_at default now()`, with `WITH CHECK (created_by = auth.uid())`.
- **Writes and reads:** writes are direct PostgREST calls. Each surface reads one snapshot, and a write invalidates only that surface's key. Use the glossary terms exactly: `ShiftType`, `HourBand`, `RotationAssignment`, `ScheduledShift`.

## UX & Interaction Patterns

- **Hour Band editor:** each band is a name plus a start time. The window, duration and midnight crossing are shown read-only. A 24-hour partition bar hatches and flags any uncovered region. Bands live under the Organizacija settings.
- **Shift types** live under Postavke rotacije. They take working ramp slots (`shift-slot-1..6`) in creation order: the pilot's Dan is slot 1 and Noć is slot 2. Beyond six types a slot repeats, and the always-visible label carries the distinction. Non-working types use `shift-nonworking`. Contrast for slots 3–6 is unverified (they are marked as an assumption) and must be checked in both themes before a second organization uses them. No `shift-day`/`shift-night` token may exist.
- **Pattern builder:** an ordered, reorderable list of steps of any length, where a type may repeat. Cycle length, working steps and hours per cycle update live beneath it.
- **Cycle preview:** renders the next full cycle from the unsaved pattern, offsets and anchor date, so the admin judges the configuration by its output.
- **Layout by width:** below 640 px, a four-step stepper (shift types → pattern → offsets → preview), where completed steps can be revisited. On tablet and desktop, one scrolling panel with no stepper. Both layouts have the same data, validations and order. Build against a 390 px viewport first, because this is the hardest admin surface to fit on a phone. Wide content scrolls inside its own container.
- **Warning copy:** states the consequence in numbers (`24 h bez pauze`), with no adjectives and no exclamation marks. Every count uses the plural forms, and a `count === 1` check is a defect. Times use an en dash (`19:00–07:00`). The team is `Smjena`; the shift type is `Tip smjene`, and it is never called *smjena*. Mockup reference: `ux-designs/…/mockups/rotation-config-1.html`.

## Cross-Story Dependencies

- **Relies on Epic 1:** teams of any count (archived, never deleted), the RLS and role pattern and its security regression tests, the versioning mechanism, attribution defaults, and the theme and i18n layers.
- **Order within the epic:**
  - 2.1 comes before 2.2. It seeds both fixtures and starts the domain test suite.
  - 2.2 comes before 2.3, because steps reference shift types.
  - 2.3 builds the projection and preview that 2.4 (phone layout), 2.5 (warnings at save) and 2.6 (versioned change) all depend on.
- **Later epics consume the projection:**
  - Epic 3 (calendar, overrides) and Epic 4 (hours by band intersection) use this projection, the band derivation and the duration logic. They must not reimplement them.
- **Deferred from 2.6 to later epics:**
  - CAP-9 also requires that overrides dated on or after a rotation change be listed for confirm, amend or discard. Overrides do not exist until Epic 3, so that disposition lands there.
  - The check that a configuration change must not silently erase a pending conflict lands in Story 5.5.
  - Keep assignment versioning ready for both.
