# Epic 2 Context: The rota is defined once, and projects itself

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic gives a secured, populated tenant a working schedule without anyone typing in a date. An admin defines the organization's hour bands and its shift types, including one that crosses midnight. The admin then builds a repeating rotation of any length and binds each team to it at an offset from a shared anchor date. Before saving, the admin sees the next full cycle rendered from their own configuration, with the coverage and rest-gap consequences stated in numbers. After saving, the shift for any team on any date, past or future, can be answered. This is the product's critical path. The pure domain package, the browser-free test suite with both fixtures, and the versioning pattern for rules all start here.

## Stories

- Story 2.1: An admin defines the day's hour bands so a gap cannot be expressed
- Story 2.2: An admin defines shift types, including one that crosses midnight
- Story 2.3: An admin builds the rotation and sees the cycle before saving
- Story 2.4: Rotation configuration completes on a phone
- Story 2.5: Saving a rotation reports what it will actually do
- Story 2.6: An admin changes the rotation from a date forward

## Requirements & Constraints

- **Hour bands** partition the full 24 hours, and a band may cross midnight. Any number of bands is allowed; three bands must produce three figures with no code change. Moving a boundary recomputes band hours and changes no total. Bands are retroactive by design.
- **Shift types:** duration is derived, never entered: `end - start`, plus 1440 when `end <= start`. A 19:00–07:00 type is 12 h and produces exactly one scheduled shift, attributed to its start date. It is never split and never counted twice. A 24-hour type (e.g. 07:00–07:00) is valid. A non-working type has no times and zero duration. No field names or implies an hour band. Editing a type's times leaves past hours unchanged; a rename takes effect everywhere.
- **Projection:** `pattern[(offset + daysBetween(anchor, date)) mod cycleLength]`. It is deterministic and uses a true mathematical modulo, so dates before the anchor resolve. The cycle length is arbitrary and nothing assumes a week. A shift type may repeat within a pattern. Teams may share a pattern at the same or different offsets; a shared offset is legal and only warns. Any date resolves with no generation run.
- **Exactly three refusals**, each because the state cannot be represented: a gap or overlap in bands, an empty pattern, and an offset outside the cycle. A refused save names the problem and keeps every entered value. The UX doc says "two refusals"; that is out of date, and three is correct.
- **Warnings inform and never block.** They are computed over the next full cycle and shown at save time only, never as a standing banner:
  - Coverage gap: a date with no working team — or a working shift type with nobody on it; the two differ for UJ-5, and 2.5 must settle which (see `deferred-work.md`).
  - Duplicate coverage: two or more teams on the same working type on the same date. Two teams at the same offset trigger both a duplicate and a gap warning.
  - Rest gap: consecutive working types with no non-working step between them. It states the continuous duration from nominal minutes, so it does not change across daylight-saving transitions.
  - The pilot must report 0 gaps, 0 duplicates and a 24 h rest gap. That warning is intentional, not a misconfiguration.
- **Rotation change** takes an effective date. Every shift before it is unchanged, and the change is attributable to an admin and a timestamp.
- **Fire rank and team position are inert.** Nothing in projection, bands, duration or warnings may read them.
- **Testing:** Vitest in the node environment, with no jsdom and no browser. Every rule is asserted against both fixtures:
  - **Pilot:** Dan 07:00–19:00, Noć 19:00–07:00, and Slobodno (non-working). Bands Dan@07:00 and Noć@19:00. Pattern `[Dan, Noć, Slobodno, Slobodno]`. Teams A–D at offsets 0–3: a 24-on / 48-off rota.
  - **UJ-5 security organization:** 3 teams, a 5-step pattern, 8-hour shifts, and band boundaries that shifts straddle, so band splitting is exercised. Its seeded rotation (2.3a) is `[Jutarnja, Popodnevna, Noćna, Slobodno, Slobodno]` at offsets 0, 1 and 2.
  - Required explicit cases: each refusal, a negative `daysBetween`, and a midnight-crossing band.
- **Definition of done:** usable from 320 px up with no horizontal page scroll, no meaning carried by colour alone, and every string through i18n.

## Technical Decisions

- **Nothing derived is persisted.** There is no shifts or schedule table. The schedule, cycle preview and warnings are computed on read by `packages/domain`. That package is pure TypeScript with zero dependencies and no React, Supabase or I/O. It holds the only implementation of each calculation (modules `projection`, `duration`, `bands`, `warnings`), shaped as `(config snapshot, exceptions, window) -> derived values` over plain objects.
- **Time is integer minutes since midnight, over nominal wall-clock time.** No `Date`, `timestamptz` or instant enters any calculation. Shift types store `start_time`/`end_time` as `time`, plus `is_working`.
- **Versioned or current-state.** Versioned: rotation assignment, rotation pattern and steps, and shift-type times. A versioned rule carries a validity range, is never updated in place, and is selected by the date being derived. Current-state: shift-type name and hour bands. A rotation change closes the current assignment version and opens a new one, following the pattern already used for team membership and active status. A new rule kind stays unclassified until the architecture's versioning table lists it.
- **Schema shape instead of validation.** Bands store only a name and a start time; the window, duration and midnight flag are derived, so a gap or overlap cannot be stored. A rotation offset is a foreign key to a step of that same pattern, never an integer, so an empty pattern has no step to reference. No new triggers.
- **Codes, not prose.** The domain returns data such as `{ code: 'REST_GAP', hours: 24 }` and `{ code: 'COVERAGE_GAP', dates: [...] }`. Codes are stable `SCREAMING_SNAKE`. The i18n layer resolves them, including Croatian's three plural forms.
- **Entities:** `rotation_patterns`, `rotation_steps` (ordered, each referencing a shift type), and `rotation_assignments` (versioned; team, anchor date, and an offset-step FK). These join the existing `hour_bands`, `shift_types` and `shift_type_versions`. Every table has `organization_id` as its first column and RLS on the JWT claim plus the role helper. Writes are admin-only and are refused through a direct API call as well.
- **Attribution:** assignment changes carry `created_by default auth.uid()` and `created_at default now()`, with `WITH CHECK (created_by = auth.uid())`.
- **Data flow:** writes are direct PostgREST calls. Each surface reads one snapshot, and a write invalidates only that surface's key. Use the glossary names exactly: `ShiftType`, `HourBand`, `RotationAssignment`, `ScheduledShift`.

## UX & Interaction Patterns

- **Visual register (refreshed):** slate surfaces, a navy sidebar in both themes, one blue `primary`, soft `shadow-sh` on cards, 12 px base radius, DM Sans body and Syne headings. Screens compose the `components/ui` primitives (Button, Card, Input, Table, PageHeader/PageTitle, StatCard, Badge, Notice) and may size or place them but never restyle colour, radius, border, shadow or type. A new look means changing or adding a primitive.
- **Page skeleton:** `mx-auto w-full max-w-5xl p-6`, `PageHeader` first (title top-left, actions right, stacking on a phone), then a table in a `Card`, or a form in a left-aligned `Card` (`max-w-lg`). Refusals and confirmations use `Notice` (`role="alert"` / `role="status"`). Controls are `h-11` (44 px floor).
- **The shiftapp-v2 mockups are for look only.** Its shift-type cards carry a colour picker, emoji, pay multiplier and valid days; none of these belong to Shift. Colour comes from the ramp slot, never a user choice, and all copy is Croatian.
- **Hour Band editor** (done in 2.1): name plus start time, derived window/duration/midnight read-only, a 24-hour partition bar that hatches and flags any uncovered region, under Organizacija.
- **Shift types** live under Postavke rotacije. They take working ramp slots (`shift-slot-1..6`) in creation order: Dan is slot 1, Noć slot 2. Beyond six a slot repeats and the always-visible label carries the distinction. Non-working types use `shift-nonworking`. Slots 3–6 are verified for contrast in both themes (2.2b, `test/theme-contrast.test.ts`). No `shift-day`/`shift-night` token may exist. `destructive` is reserved for conflicts; removal uses neutral styling plus one confirmation.
- **Pattern builder:** an ordered, reorderable list of steps of any length, where a type may repeat. Cycle length, working steps and hours per cycle update live beneath it.
- **Cycle preview:** renders the next full cycle from the unsaved pattern, offsets and anchor date.
- **Layout by width:** below 640 px, a four-step stepper (shift types → pattern → offsets → preview) with completed steps revisitable. Tablet and desktop get one scrolling panel with no stepper. Same data, validations and order in both. Build against 390 px first. Wide content scrolls inside its own container.
- **Copy:** warnings state the consequence in numbers (`24 h bez pauze`), with no adjectives and no exclamation marks. Every count uses the three plural forms; a `count === 1` check is a defect. Clock ranges use an en dash (`19:00–07:00`) and go through the i18n format layer, never an ad-hoc template. The team is `Smjena`; the shift type is `Tip smjene`, never *smjena*. Mockup reference: `ux-designs/ux-shift-2026-09-02/mockups/rotation-config-1.html` (layout and flow; take the look from the refreshed design system).

## Cross-Story Dependencies

- **From Epic 1:** teams of any count (archived, never deleted); the RLS and role pattern with its security regression tests; the versioning mechanism; attribution defaults; and the theme and i18n layers.
- **Within the epic:** 2.1 (bands, both fixtures seeded, `packages/domain` started) and 2.2 (shift types with versioned times) are done. 2.2 came before 2.3 because steps reference shift types. 2.3 is split: 2.3a (schema `0016_rotation.sql`, `domain/projection`, teams and rotation seeded for both fixtures and the demo) comes first; 2.3b (builder, offsets, preview) closes it. 2.3 builds the projection and cycle preview, and 2.4 (phone layout), 2.5 (warnings at save) and 2.6 (versioned change) all depend on it.
- **Later epics:** Epic 3 (calendar, overrides) and Epic 4 (hours by band intersection) consume this projection, the band derivation and the duration logic, and must not reimplement them.
- **Deferred out of 2.6:** CAP-9 also requires that overrides dated on or after a rotation change be listed for confirm, amend or discard. Overrides only arrive in Epic 3, so that disposition lands there. The guard that a configuration change must not silently erase a pending conflict lands in Story 5.5. Keep assignment versioning ready for both.
