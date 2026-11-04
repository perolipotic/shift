# Epic 11 Context: A shift short of people is impossible to miss

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An organization sets one number, how many people a working shift needs (*Najmanje ljudi u smjeni*). Wherever a working shift falls below it, the app says so plainly and in numbers: before every save that would cause it, on the admin's calendar day, and as a count on admin *Danas*. It warns and never blocks, because the admin may have no one else to send. With the setting empty, nothing is reported anywhere. This was added to v1 by the 2026-10-10 scope expansion (CAP-21); it narrows the earlier non-goal "no minimum-staffing rules" to exactly this one number.

## Stories

- Story 11.1: The staffing rule and the minimum-members setting
- Story 11.2: Every save that can cause it shows a short-staffed shift
- Story 11.3: The calendar day marks a short-staffed shift
- Story 11.4: Admin Danas counts short-staffed shifts

## Requirements & Constraints

- **People at work** on a working Scheduled Shift = its Shift Roster after Roster Overrides, minus every member covered that date by a Leave Record of any absence type, with replacements placed by an override counted. A member on a half day counts as at work (half days arrive in Epic 13).
- **Short-staffed** ⟺ the shift is working AND people at work < Minimum Members. Non-working shifts are never short-staffed. Empty setting ⟹ nothing is short-staffed.
- Derived on read, never stored, never "resolved": it ends only when the roster, the absence or the setting changes.
- Never blocks a save. A write that can change it reports the shifts it would newly make short-staffed, as `{ code: 'SHORT_STAFFED', date, team, atWork, minimum }`.
- Worked example (must hold against both fixtures): a team of four on a working shift, minimum 3. One on leave → 3 at work, not short. Two on leave → 2, short. One of those two replaced by an override → 3, not short. Minimum empty → never short.
- The setting is organization data: a positive whole number or empty, no core default. The demo seed sets 3 (the pilot's value).
- Changing the setting changes the state of past and future shifts alike.
- A member deactivated from a date leaves their future shifts short-staffed where the count falls below the setting (answers the deactivation open question).
- Never reads fire rank or team position; those stay inert.
- Reporting surfaces (11.2): leave record/amend, leave-request approval, roster and shift-type overrides, every conflict resolution (in the consequence strip's coverage term), member deactivation, rotation save; later swap approval (Epic 12). The report names date, team, people at work and the minimum, as a block in *Što se mijenja*, not a quiet line.
- Calendar (11.3): an admin's calendar only, glyph + legend, never colour alone; day detail states people at work against the minimum.
- Danas (11.4): count of short-staffed shifts ahead, shown at zero, linked to their dates; not shown when the setting is empty.

## Technical Decisions

- **AD-1:** no column may hold a value the domain can compute; only the setting is stored.
- **AD-2:** Minimum Members is a **current-state** rule (like hour bands); story 11.1 adds its row to the spine's AD-2 table, in the same change.
- **AD-7:** the rule lives in a new pure module `packages/domain` → `staffing`, zero runtime deps, no React/Supabase/I/O, shape `(snapshot, exception layer, window) → derived values`. Recomputing it anywhere else is a defect.
- **AD-8:** the domain returns codes and operands (`SHORT_STAFFED`, `atWork`, `minimum`), never prose; i18n resolves them.
- **AD-13:** a surface derives every figure from one snapshot; 11.4's count must equal the calendar marks from the same snapshot, and admin *Danas* coverage moves onto `dayDetailOf` (closing AD-13's recorded exception).
- **AD-15:** Vitest in node, no jsdom; every rule asserted against both the pilot and the UJ-5 security fixture.
- Organization writes are direct PostgREST under RLS (AD-9/AD-10); migrations forward-only in `supabase/migrations`.

## UX & Interaction Patterns

- *Organizacija* is a page of fact cards; each change opens its own small dialog with one Spremi beside Odustani, sending only what it shows.
- Warnings state consequences in numbers (`rade 2 od najmanje 3`, `Smjena B, 14.10. Dan: rade 2 od najmanje 3`).
- A new `warning` token is reserved for short-staffed: light and dark, contrast-verified, never `destructive`, never the accent (UX-DR4, UX-DR48). It is the fifth `shift-cell` modifier and state glyph, with a legend entry (UX-DR8, UX-DR12).
- Short-staffed is the second named exception (after conflicts) to "warnings never persist as standing banners" (UX-DR23).
- Each story updates the DESIGN.md / EXPERIENCE.md / UX-DR lines it changes in the same change.

## Cross-Story Dependencies

- 11.2 and 11.3 depend on 11.1 (the domain rule and the setting); 11.4 depends on 11.3.
- Epic 9's request approval preview gains the short-staffed result once Epic 11 lands (via 11.2).
- Epic 12's swap approval (12.4) runs the staffing check, depending on 11.1.
- Epic 13 adds absence types and half days; the staffing rule must count any absence type as absent and a half day as at work.
