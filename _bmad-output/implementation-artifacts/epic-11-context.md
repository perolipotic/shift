# Epic 11 Context: A shift short of people is impossible to miss

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

An organization sets one number, how many people a working shift needs (*Najmanje ljudi u smjeni*). Wherever a working shift falls below it, the app says so plainly and in numbers: before every save that would cause it, on the admin's calendar day, and as a count on admin *Danas*. It warns and never blocks, because the admin may have no one else to send. With the setting empty, nothing is reported anywhere. The 2026-10-10 scope expansion (CAP-21) added it to v1, narrowing the earlier non-goal "no minimum-staffing rules" to exactly this one number. All four stories have shipped (#268–#271); the epic closed accepted-with-open-items (retro 2026-11-05), with follow-ups #273 (retro A2, A6) and #274 (retro A7: the rotation cancel and the override review show the block).

## Stories

- Story 11.1: The staffing rule and the minimum-members setting
- Story 11.2: Every save that can cause it shows a short-staffed shift
- Story 11.3: The calendar day marks a short-staffed shift
- Story 11.4: Admin Danas counts short-staffed shifts

## Requirements & Constraints

- **People at work** on a working Scheduled Shift = its Shift Roster after Roster Overrides, minus every member absent that date by a Leave Record of any absence type, with replacements placed by an override counted. A member on a half day counts as at work (half days arrive in Epic 13).
- **Short-staffed** ⟺ the shift is working AND people at work < Minimum Members. Non-working shifts are never short-staffed. Empty setting ⟹ nothing is short-staffed, and no extra read is made.
- Derived on read, never stored, never "resolved": it ends only when the roster, the absence or the setting changes. Changing the setting changes past and future shifts alike.
- Never blocks a save. Never reads fire rank or team position.
- Worked example (holds against both fixtures): a team of four on a working shift, minimum 3. One on leave → 3 at work, not short. Two on leave → 2, short. One of those replaced by an override → 3, not short. Minimum empty → never short.
- The setting is organization data: a positive whole number or empty, no core default. The demo seed sets 3.
- A member deactivated from a date leaves their future shifts short-staffed where the count falls below the setting.
- **Admin Danas (11.4, shipped):** while the setting is set, the *Premalo ljudi* card, directly after *Treba tebe*, counts the short-staffed shifts of this week (today plus 6, the week *Ovaj tjedan* draws), is shown at zero with the calm line, and its first 3 rows open their day detail, then `i još {n}` and *Otvori kalendar*. With the setting empty the card is not shown. The count must equal the calendar's marks from the same snapshot (dashboard figures equal their detail views).
- Each story updates the DESIGN.md / EXPERIENCE.md / UX-DR lines it changes in the same change; 11.4 updated the admin *Danas* entry in EXPERIENCE.md, UX-DR4, UX-DR23 and UX-DR48 as shipped.

## Technical Decisions

- **AD-1:** no column holds a computable value; only `organizations.minimum_members` (nullable `smallint`, `>= 1`, migration `0048`) is stored. No count or state is stored anywhere.
- **AD-2:** Minimum Members is a **current-state** rule (like hour bands); its row is in the spine's AD-2 table (shipped by 11.1).
- **AD-7:** the rule lives only in the pure `packages/domain` → `staffing` module (zero runtime deps, no React/Supabase/I/O). Shipped derivations: `peopleAtWorkOn`, `shortStaffedShiftsOf` (the calendar marks), `newlyShortStaffedOf` (the save blocks). Recomputing the rule anywhere else is a defect; the Danas count must reuse what the calendar uses.
- **AD-8:** the domain returns codes and operands (`SHORT_STAFFED`, `atWork`, `minimum`), never prose; i18n resolves them.
- **AD-13 (one snapshot per surface):** every figure on a surface comes from one shared query key per fact, read through the detail view's own query options, so a figure equals its detail view by construction. Its recorded exception — admin *Danas* coverage computed by its own `coverageOf` in `admin-today.ts` — was closed by 11.4: *Pokrivenost danas* derives from the day detail's `dayDetailOf`, and AD-13 carries `Amended 2026-11-04 (story 11.4)`.
- Writes invalidate their surface's snapshot key and every dependent key (AD-13 mutation rule); no optimistic updates for conflict or staffing state.
- **AD-15:** Vitest in node, no jsdom; every rule asserted against both the pilot and the UJ-5 security fixture.
- Organization writes are direct PostgREST under RLS; migrations forward-only in `supabase/migrations`.

## UX & Interaction Patterns

- **Wording:** numbers, not adjectives — `rade 2 od najmanje 3` (`radi 1`, `ne radi nitko` at zero); a save row reads `Smjena B, 14.10. Dan: rade 2 od najmanje 3`; the mark's name is *Premalo ljudi* / `premalo ljudi`.
- **`warning` token** (light `#BF6A14`, dark `#F59145`, no foreground): reserved for short-staffed only — the cell's 3 px bottom bar, the block's border and its glyph (on opaque `muted`), and the *Danas* card's left edge. Never a glyph on glass: the day-detail line, the resolution strip and the *Danas* card glyph draw `UsersThree` in `foreground` (retro A6, #273); `text-warning` is pinned to the block alone. Never `destructive`, never the accent, never text on it; words beside it stay `foreground`. Contrast is pinned in `test/theme-contrast.test.ts`.
- **Glyph:** Phosphor `UsersThree` (cell: `UsersThreeBold` in the cell's own foreground) through the icon facade; never colour alone; a persistent legend entry wherever the mark renders (five-mark state vocabulary).
- **Calendar (shipped 11.3):** admin month grid only (not person view, *Moj raspored* or day lists); admin *Danas*'s *Ovaj tjedan* week already shows the same mark beside the letter, with a legend entry while any shown cell is short. Day detail adds one line under *Sastav* on every working shift of an active team while the setting is set: `rade 3 od najmanje 3`, or `Premalo ljudi: rade 2 od najmanje 3` with the glyph in `foreground`.
- **Save blocks (shipped 11.2):** a *Premalo ljudi u smjeni* block in *Što se mijenja*, inside the existing polite live region, from the surface's own "after" snapshot; first five rows then `i još {n}`; never an alert. If leave can't be read or derivation fails: `Popunjenost smjena sada ne mogu provjeriti.` Consequence-strip coverage term states people at work vs. minimum.
- **Standing state:** short-staffed is the second named exception (after conflicts) to "warnings never persist as standing banners" — it stands on the calendar and on admin *Danas* while it lasts.
- **Admin *Danas* layout:** *Treba tebe* (the *Za odluku* count at every value incl. 0, `destructive` edge + ⚠ above zero, ending `Otvori Za odluku ({count})`), then *Pokrivenost danas* (per working team: type, range, team, phase, `{present} od {total} članova`, each rostered member on leave with the decision, or `✓ puna smjena`; teams off on one line; link to calendar), then *Odsutni danas*, then *Ovaj tjedan*. The 11.4 *Premalo ljudi* card sits directly after *Treba tebe* and every summary links to its list view.
- Empty states state what is true; a zero count is still shown.

## Cross-Story Dependencies

- 11.2 and 11.3 depend on 11.1; 11.4 depends on 11.3 (reuses its calendar derivation so the count equals the marks).
- Epic 9's request approval preview already carries the short-staffed block (via 11.2).
- Epic 12's swap approval (12.4) runs the staffing check, depending on 11.1.
- Epic 13 adds absence types and half days; the rule must count any absence type as absent and a half day as at work.
- Deferred from 11.2: the override review after a rotation save and the rotation cancel do not show the block yet.
