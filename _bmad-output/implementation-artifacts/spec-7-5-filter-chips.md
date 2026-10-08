---
title: 'Filters are chips that say what is shown and clear in one action (7.5)'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: '94c88f0ec67ac0afc3ce393c2d014564bd9fd504'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Kalendar filters through one native Select („Smjena ili osoba”), with a reset that appears and disappears. Sati has two labelled Selects and its own `?tim=` parameter for the same concept. Neither screen says what it is showing, and Sati's empty result („Nijedna osoba ne odgovara odabranom filtru.”) reads as missing data.

**Approach:** Both screens get one shared filter bar under the month toolbar. It shows two chips, Smjena and Osoba, each `Ključ: vrijednost ▾`. An active chip gets a separate ✕. A summary line `Prikazano: …` ends with one `Poništi filtre` while any filter is on. On desktop a chip opens the 7.4 `Popover`. Below 640 px a `Filtri · N` button opens a bottom sheet on the native `Dialog`, and the active chips stay visible. Kalendar keeps 3.3b: a person replaces the team. In Sati the two filters combine. Sati moves to `?smjena=`, and `?tim=` redirects. Mockup: `ux-designs/ux-shift-2026-10-01-redesign/mockups/filters-and-month-nav-1.html` (direction A, phone pattern from C).

## Boundaries & Constraints

**Always:**
- **Chips.**
  - A chip is a `Button` (`aria-haspopup="dialog"`, `aria-expanded`) reading `Smjena: sve` / `Smjena: Smjena B`.
  - ✕ is a separate ≥ 44 px `Button` named `Ukloni filtar smjena: Smjena B` / `Ukloni filtar osoba: Luka Knežević`. After ✕, focus goes to the next chip, or else to the first chip.
  - In Kalendar, with a person chosen, the Smjena chip is hidden.
  - Below 640 px only active chips show.
- **Smjena picker.** One choice among `Sve smjene ({count})` and each team, every option with its person count (`4 osobe`), from live records (UX-DR19, UX-DR36).
- **Osoba picker.**
  - A search `Input` filters the list live, and the list is grouped by team.
  - A team-less person goes under `Bez smjene`.
  - It shows `{n} od {total}`.
  - Picking closes the picker and returns focus to the chip.
- **Summary line** (`role="status"`, always shown under the chips):
  - no filter → `Prikazano: sve smjene (4) · 17 osoba`
  - team → `Prikazano: Smjena B · 4 osobe od 17`
  - person → `Prikazano: Luka Knežević · Smjena A`
  - team and person (Sati only) → `Prikazano: Smjena B i Luka Knežević · 0 osoba`
  - `Poništi filtre` clears both and moves focus to the first chip. It never leaves the screen (FR-36).
- **A person's team for the month** is ONE rule, shared by Kalendar and Sati: membership on their last active date of the month. The private `lastActiveDateOf` + `membershipOn` in `organization-hours.ts` moves to `features/calendar/utils/month.ts` and is exported. Counts are people active in the month whose team for the month is that team.
- **Phone sheet.**
  - It holds Smjena as a `RadioRow` choice with counts, Osoba as the same search list, and in Kalendar the note `U Kalendaru osoba zamjenjuje smjenu.`.
  - Its footer has `Poništi` and `Prikaži {n} osoba`, and that count updates live.
  - Every choice writes the URL at once, so Back works.
  - The sheet closes on `Prikaži…`, on Escape and when the viewport turns wide (`useCloseWhenWide`).
- **Sati empty result** (a filter leaves no row; the month has rows):
  - `Luka Knežević nije u smjeni Smjena B u listopadu 2026.`, then `Luka Knežević je u smjeni Smjena A.` or `Luka Knežević nije ni u jednoj smjeni u listopadu 2026.`
  - Then the actions `Ukloni filtar: Smjena B` and `Poništi filtre`.
  - The month locative is 12 `hr.json` keys (`u siječnju` … `u prosincu`).
  - Team names are never declined.
  - The domain returns codes and operands. `emptyMonth` stays.
- **URL.**
  - Sati reads `smjena`.
  - `/sati?tim=X` replaces the URL with `?smjena=X` and keeps every other param. `smjena` wins if both are present.
  - `sort=tim` stays as a sort value.
  - Month changes keep the filters.
- Export still exports exactly the filtered rows.
- No user-facing literal outside i18n. Counts use ICU plurals.
- Update in the same change:
  - EXPERIENCE.md §Interaction Primitives filter line (:96), hours table and export lines (:111-112), empty states (:116)
  - DESIGN.md: a Filter chip row and a Filter sheet row
  - `epics.md` UX-DR19, UX-DR20, UX-DR34, UX-DR36

**Ask First:** Showing filters in *Moj raspored*. A sticky phone header or swipe to change month. Changing what the export contains. Renaming `sort=tim`.

**Never:** A new runtime dependency. Declining a data name. Toasts or banners. A per-screen fork of the chip, picker or sheet. `destructive` styling. Filter state outside the URL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Kalendar, team | `?prikaz=sve&smjena=B` | Chips `Smjena: Smjena B ✕`, `Osoba: sve`; `Prikazano: Smjena B · 4 osobe od 17` | N/A |
| Kalendar, pick person | team B chosen, pick Luka (A) | `?osoba=luka`, `smjena` dropped; Smjena chip hidden; `Prikazano: Luka Knežević · Smjena A` | N/A |
| Sati, combine | `?smjena=B&osoba=luka` (Luka in A) | No rows; the empty sentences + `Ukloni filtar: Smjena B` → `?osoba=luka` | N/A |
| Old URL | `/sati?tim=B&mjesec=2026-07` | Replaced by `/sati?mjesec=2026-07&smjena=B` | N/A |
| Unknown id | `?smjena=nope` | Read as no filter (today's rule); chips show `sve` | N/A |
| ✕ on Smjena | Sati, both chips active | `smjena` dropped, focus on the Osoba chip | N/A |
| Phone, open sheet | 390 px, `Filtri · 1` | Sheet; choosing a team updates the URL and `Prikaži 4 osobe` | Escape closes it, focus on `Filtri` |
| Loading | snapshot unanswered | Month toolbar shown, filter bar omitted, skeleton below | N/A |

### Epic AC Deviations

- "`Luka Knežević nije u Smjeni B u listopadu 2026.`": the team name stays undeclined, as an apposition: `nije u smjeni Smjena B u listopadu 2026.`. Why: team names are data. A declension heuristic would be wrong for arbitrary names. The existing `ljudi.*` copy uses the same apposition. Human decision, 2026-10-07.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/calendar/components/calendar-filter.tsx` -- the Select being replaced. Rewrite it as `calendar-filters.tsx`, and swap the name in `calendar-screen.fixture.ts` `CALENDAR_SCREEN_PARTS.filter`.
- `apps/web/src/features/calendar/hooks/use-calendar-screen.ts:244,267-275` -- `filterRef` (Select), `filter`, `resetFilter` (focus → filterRef). Retarget `filterRef` to the first chip. `:67,204` `phoneStoreOf(window.matchMedia)` is the existing JS phone switch; reuse it, never a new hook.
- `apps/web/src/features/calendar/utils/month.ts`:
  - `:183-195,325-334` `ALL_TEAMS_FILTER`, `PERSON_FILTER_PREFIX`, `personFilterValueOf`, `calendarFilterChangeOf` are Select-only. Remove them, with their pins in `month.test.ts:884,1049-1066`.
  - `:731` `CalendarFilterPerson` and `:756` `CalendarPersonMonth` gain `teamId: string | null`.
  - `:1079-1155` `calendarMonthOf` builds people. Add per-team counts to `filter`.
  - `:209,229` `PHONE_MEDIA_QUERY`.
  - `utils/screen-keys.ts:9-13` keys the grid on `filter.chosen` and `filter.person`. Keep that.
- `apps/web/src/features/hours/services/organization-hours.ts`:
  - `:169-177,207` the team-of-month rule to move.
  - `:408-452` `organizationHoursViewOf` (AND filter; `search` writes `tim` at :440).
  - `:335-346` `ALL_FILTER`/`hours*ChangeOf`.
  - `:367-381` `HoursEmptyMessageKey`/`hoursEmptyMessageKey`. These become the empty-result model with operands.
- `apps/web/src/features/hours/services/my-hours.ts:75,114,144-190` -- `HOURS_TEAM_PARAM='tim'` becomes `'smjena'`, and so do `HoursSearch.tim`, `hoursSearchOf`, `HoursSearchChange` and `hoursSearchTo`. `SORT_TEAM='tim'` (:88) stays.
- `apps/web/src/features/hours/components/organization-hours-filters.tsx`, `hours-body.tsx:83`, `organization-hours-table.tsx:162-168` -- the filters and the empty row (`t(view.empty)`).
- `apps/web/src/pages/sati.tsx:77-82` -- add `beforeLoad` with `throw redirect({ ..., replace: true })`, following `pages/index.tsx:113-115`. `pages/kalendar.tsx:109-121` holds the toolbar and the filter mount (Sve smjene only).
- `apps/web/src/components/ui/popover.tsx`, `components/month-nav.tsx:143-211` -- the trigger and region pattern: a `relative` region, `onBlur` close, `aria-controls` while open, focus back to the trigger.
- `apps/web/src/components/ui/dialog.tsx` (`Dialog`, `DialogHeader`, `DialogFooter`), `features/navigation/components/chrome.tsx:704-710` (the Više sheet classes), `features/navigation/hooks/wide.ts` (`useCloseWhenWide`), `components/ui/radio-group.tsx` (`RadioRow`).
- `apps/web/src/lib/i18n/locales/hr.json:165` `kalendar.filter.*` and `:405` `sati.organization.*` -- replace these with one shared `filter.*` namespace (ICU plurals). Add `filter.monthIn.1`…`12`.
- `apps/web/src/pages/prijava.test.ts`:
  - Kalendar controls 28 (:766, comment :740) and Sati 12 (:781).
  - Strings: Kalendar 121 (:2512), Sati 41 (:2569).
  - `ORGANIZATION_HOURS_KEYS` (:424, :2661).
  - `selectClasses()` length 17 → 16 (:5820).
  - File-set sweeps (:3175-3227).
  - `aria-haspopup` (:1630, :8930-8947).
- e2e:
  - `e2e/pages/calendar.page.ts:677-705` and `e2e/pages/hours.page.ts:181-206` (combobox helpers).
  - `e2e/tests/calendar/calendar.spec.ts:1927-2174` (filter describes) and `:705,1192,1489`.
  - `layout.spec.ts:242,648`.
  - `calendar-conflicts.spec.ts:187,276,342`.
  - `e2e/tests/hours/hours.spec.ts:458-540,575-586` (`/[?&]tim=/`).
- `apps/web/src/features/auth/services/return-target.ts:11`, `pages/_app.tsx:121`, `router.test.ts`, `return-target.test.ts` -- `?tim=` appears only as a generic example. Leave them.
- `_bmad-output/implementation-artifacts/deferred-work.md:598-611` -- Epic 4 retro entry: P2 (`tim` vs `smjena`) is resolved here.

## Tasks & Acceptance

**Execution:**
- [x] `features/calendar/utils/month.ts` (+test) -- export `monthTeamOf(member, dates)`; people carry `teamId`; per-team counts; remove the Select-only helpers.
- [x] `features/hours/services/organization-hours.ts`, `my-hours.ts` (+tests) -- use `monthTeamOf`; `tim` → `smjena`; empty-result model `{ person, personTeam, team, month }` codes.
- [x] `features/<calendar|hours>/utils` or `services` -- a pure filter-bar model per screen (chips, summary operands, counts, the next focus after ✕), unit-tested against the I/O matrix.
- [x] `components/filter-bar.tsx` -- the one chip row, pickers, summary, `Filtri · N` button and sheet, driven by the model. It holds `t()` calls, like `month-nav.tsx`. Add it to both fixture sets.
- [x] `features/calendar/components/calendar-filters.tsx`, `features/hours/components/organization-hours-filters.tsx`, `organization-hours-table.tsx`, `use-calendar-screen.ts`, `use-hours.ts` -- mount the bar and render the empty result with its two actions.
- [x] `pages/sati.tsx` -- the `?tim=` redirect.
- [x] `hr.json` -- the `filter.*` keys and the month locatives; remove the dead keys.
- [x] `prijava.test.ts`, fixtures -- re-count with comments. Pin: no `<Select` in either filter, ✕ names are expressions, the redirect exists.
- [x] e2e page objects + specs -- chips, ✕ focus, `Poništi filtre`, the person replacing the team (Kalendar), combining (Sati), `?tim=` redirect, the empty sentences, a 390 px sheet with chips visible, a 320 px no-scroll check.
- [x] Binding docs -- EXPERIENCE.md, DESIGN.md, `epics.md` UX-DR19/20/34/36.
- [x] `deferred-work.md` -- mark the Epic 4 P2 entry resolved. Ledger the sticky phone header, swipe to change month, and the *Moj raspored* "Filtri vrijede za Sve smjene" sentence.

**Acceptance Criteria:**
- Given Kalendar *Sve smjene* or Sati (admin) with a filter, when it renders, then each active filter is a chip with ✕, the summary says what is shown, and `Poništi filtre` clears all without leaving the screen.
- Given 390 px, when `Filtri` is pressed, then the sheet opens, and the active chips stay visible above the content when it closes.
- Given the suite, when `pnpm test`, lint, typecheck and the calendar, hours and layout e2e run, then they pass.

## Design Notes

The bar is presentational: each screen builds a model and the bar draws it, so the 3.3b replace rule and Sati's combine rule live in the models, never in the component. Picker lists are a roving-tabindex set of `Button`s with `aria-pressed` for the chosen one, matching 7.4's month grid, so no ARIA `listbox`/`combobox` semantics are needed. The search `Input` has a label and filters only what is drawn.

## Verification

**Commands:**
- `pnpm --filter ./apps/web test && pnpm exec vitest run && pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm test:e2e e2e/tests/calendar e2e/tests/hours e2e/tests/layout` -- expected: pass

**Manual checks:**
- Demo at 1440 and 390 px, both themes: team chip, person chip, ✕, `Poništi filtre`, the sheet, and `/sati?tim=…`.

## Suggested Review Order

**One bar, two rules**

- Entry point: the pure model; `combine` is the only difference between the screens
  [`filter-bar.ts:99`](../../apps/web/src/utils/filter-bar.ts#L99)

- Kalendar's model: a person replaces the team
  [`filters.ts:14`](../../apps/web/src/features/calendar/utils/filters.ts#L14)

- Sati's model: the two filters combine
  [`organization-hours.ts:430`](../../apps/web/src/features/hours/services/organization-hours.ts#L430)

- After ✕, focus goes to the next chip, or else to the first
  [`filter-bar.ts:245`](../../apps/web/src/utils/filter-bar.ts#L245)

**The component**

- One chip row, pickers, summary and phone sheet, drawn from the model
  [`filter-bar.tsx:98`](../../apps/web/src/components/filter-bar.tsx#L98)

- Focus moves only after the post-change model has rendered (review fix)
  [`filter-bar.tsx:140`](../../apps/web/src/components/filter-bar.tsx#L140)

- Chip: popover from 640 px, sheet below it, ARIA follows whichever opens
  [`filter-bar.tsx:263`](../../apps/web/src/components/filter-bar.tsx#L263)

- Sheet remounts per opening: empty search, focus on the Smjena choice
  [`filter-bar.tsx:555`](../../apps/web/src/components/filter-bar.tsx#L555)

- One phone store and the wide-close, shared with chrome and the calendar
  [`viewport.ts:13`](../../apps/web/src/hooks/viewport.ts#L13)

**Data the bar reads**

- A person's team for the month: one rule, moved from Sati
  [`month.ts:1004`](../../apps/web/src/features/calendar/utils/month.ts#L1004)

- Search that ignores diacritics, `dj` reading as `đ`
  [`filter-bar.ts:265`](../../apps/web/src/utils/filter-bar.ts#L265)

**Sati: URL and empty result**

- `tim` becomes `smjena`; `sort=tim` stays a sort value
  [`my-hours.ts:78`](../../apps/web/src/features/hours/services/my-hours.ts#L78)

- The old URL is rewritten, every other parameter kept
  [`my-hours.ts:172`](../../apps/web/src/features/hours/services/my-hours.ts#L172)

- `beforeLoad` replaces the old URL in history
  [`sati.tsx:90`](../../apps/web/src/pages/sati.tsx#L90)

- Empty result as codes and operands, never throwing
  [`organization-hours.ts:381`](../../apps/web/src/features/hours/services/organization-hours.ts#L381)

- Two sentences plus `Ukloni filtar` and `Poništi filtre`
  [`organization-hours-table.tsx:102`](../../apps/web/src/features/hours/components/organization-hours-table.tsx#L102)

**Binding docs**

- UX-DR19 rewritten for the chip bar
  [`epics.md:129`](../planning-artifacts/epics.md#L129)

- Filter chips interaction primitive
  [`EXPERIENCE.md:96`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L96)

- Filter chip row and Filter sheet
  [`DESIGN.md:308`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L308)

**Tests**

- Kalendar's team filter: chips, ✕ focus, Poništi filtre, picker keys
  [`calendar.spec.ts:1938`](../../e2e/tests/calendar/calendar.spec.ts#L1938)

- Loading: the bar waits for the month
  [`calendar.spec.ts:2222`](../../e2e/tests/calendar/calendar.spec.ts#L2222)

- Sati phone sheet: the two filters combine
  [`hours.spec.ts:732`](../../e2e/tests/hours/hours.spec.ts#L732)

- Source pins: no Select, no rAF, no feature imports in the bar
  [`prijava.test.ts:3318`](../../apps/web/src/pages/prijava.test.ts#L3318)

- Model unit tests against the I/O matrix
  [`filter-bar.test.ts:152`](../../apps/web/src/utils/filter-bar.test.ts#L152)
