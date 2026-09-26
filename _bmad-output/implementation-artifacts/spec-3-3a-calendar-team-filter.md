---
title: 'Story 3.3a: Filtering the calendar to one team'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: '0a289978bffcb146283a55d95eb6c99725233144'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** *Sve smjene* always shows every active team, so there is no way to narrow the grid to the one team a reader cares about (CAP-13, UX-DR19, UX-DR36). Story 3.3 was split (2026-09-26): this part is the team filter only. The person filter needs a new members read and a migration, so it is deferred to 3.3b.

**Approach:** Add a native `Select` above the grid. Its first option is `Sve smjene (N)`, and every active team is listed under a labelled heading. The chosen team is the search parameter `smjena`, which month navigation keeps. A reset button, shown only while a team is chosen, clears the filter in one action. The work stays in `apps/web` and makes no new read.

## Boundaries & Constraints

**Always:**
- **Search:** `smjena=<team id>`.
  - `calendarSearchOf` keeps any non-empty string.
  - `calendarSearchTo` keeps `smjena` on a month change and on a mode change, and takes a new change `{ smjena: string | null }`, where `null` drops it.
  - A mode or filter the viewer never chose is never written in.
- **Model (`month.ts`, pure):**
  - The filter's options are exactly the active teams (`splitTeams(snapshot.teams).active`), in column order, with nothing hard-coded.
  - The chosen team is `smjena` only when it names one of those teams. An unknown or archived id counts as no filter: every column shows, and the Select reads the all-teams option.
  - When a team is chosen, `columns` and every row's `cells` narrow to that team.
  - Team letters are still computed over **all** active teams, so a column keeps the same letter with or without the filter.
  - `CalendarMonth` gains `filter: { teams, chosen }`, where `teams` are the active columns and `chosen` is an id or `null`.
- **Screen (`kalendar.tsx`, markup only):**
  - The Select and the reset button render only in *Sve smjene*, and only when there is at least one active team.
  - `<Label>` `kalendar.filter.label` ("Smjena").
  - First option: `kalendar.filter.all` = `Sve smjene ({count})`, where `count` is the number of active teams.
  - Then one `<optgroup label={t('kalendar.filter.group')}>` ("Smjene") holding each team's name as data.
  - The Select is `h-11` (44 px) and full width on a phone.
  - The reset button `kalendar.filter.reset` ("Poništi filtar") renders only while a team is chosen and navigates with `{ smjena: null }`.
  - *Moj raspored* ignores `smjena` but keeps it in the URL.
- **Grid focus:** the remembered tab stop resets when the chosen team changes, exactly as it does on a month change.
- **Persistence:** state lives only in the URL. The navigation link opens `/kalendar` with no search, so nothing carries over between sessions.
- **Text:** the new keys go in `hr.json` and are registered in every inventory. A team is `smjena`, never a shift type.

**Ask First:** any migration or change to the calendar read or `CALENDAR_COLUMNS`; any change to *Moj raspored*; changing the ≥ 640 px layout beyond adding the filter row.

**Never:**
- a person filter (3.3b);
- rank or position as a filter;
- `localStorage` or `sessionStorage`;
- a second query;
- new dependencies, render tests, or a custom listbox.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No filter | 4 active teams, no `smjena` | 4 columns; Select reads `Sve smjene (4)` | N/A |
| Team chosen | `smjena=<A>` | only A's column and cells; A keeps its unfiltered letter | N/A |
| Unknown / archived id | `smjena=<x>` | all columns; `chosen` is `null` | silently ignored |
| Month change | `smjena=<A>&prikaz=sve`, next | `{mjesec, prikaz, smjena}` all kept | N/A |
| Reset | `smjena=<A>` | search without `smjena`, other params kept | N/A |
| Mode change | `smjena=<A>`, choose `moj` | `smjena` kept; day list unchanged | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/calendar/month.ts`:
  - `CalendarSearch` :110, `calendarSearchTo` :138, `calendarSearchOf` :193;
  - `calendarMonthOf` :536, where the columns and letters are built; narrow after the letters;
  - `CalendarMonth` :363.

  Tests are in `month.test.ts`.
- `apps/web/src/calendar/grid-keys.ts` -- `gridTabStopOf` is keyed by month. Resetting on a filter change is done in `kalendar.tsx`, as with `focusMonth` :131-139: key it on `month + chosen`.
- `apps/web/src/routes/kalendar.tsx`:
  - `show()` and `choose()` :145-151, which gain a `filter(smjena)`;
  - the month header card :478-525, where the Select row goes under the switch in *Sve smjene*;
  - `renderGrid` :389.
- `apps/web/src/components/ui/select.tsx` -- the native `Select` primitive. Compose it with `className="h-11"` and do not restyle it.
- `apps/web/src/routes/ljudi.tsx:360-420` -- the precedent for a native team filter, its `Label` and its reset `Button`. `members/list.ts:1497` `chooseTeam` is the lookup-with-fallback precedent.
- `apps/web/src/i18n/locales/hr.json:27` -- the `kalendar` object; add `filter.{label,all,group,reset}`.
- Inventories:
  - `test/resource-hygiene.test.ts:885-907` -- the kalendar keys;
  - `test/localization-applied.test.ts:991-997` -- `AUTHORED_VOCABULARY`, for any new word such as `filtar`;
  - `apps/web/src/routes/prijava.test.ts:429` -- the Kalendar controls, 5 → 7 with the Select and the reset;
  - `:1740-1751` -- the Kalendar string count, 14 plus the new keys.
- `e2e/calendar.spec.ts` -- helpers `gridOf` :110 and `cellOf` :115, and the fixture's `fixture.team`. The run org may hold teams other specs create, so count the columns rather than assuming a number. Remember the 3.2b rules: `gridcell`, and the organizations counter.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/calendar/month.ts`, `month.test.ts` -- add `smjena` parsing and keeping, the `{ smjena }` change, `filter` on `CalendarMonth`, and narrowing that keeps the letters. The tests cover every matrix row, archived teams never becoming options, and option order equal to column order.
- [x] `apps/web/src/routes/kalendar.tsx` -- the Label, Select and optgroup, the conditional reset, the filter navigation, and the tab stop resetting on a filter change.
- [x] `apps/web/src/i18n/locales/hr.json` -- `kalendar.filter.label`, `.all`, `.group` and `.reset`.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` -- register the keys and words, and update the counts with comments naming story 3.3a.
- [x] `e2e/calendar.spec.ts`, as an admin at 1280 px:
  - the Select's first option is `Sve smjene (N)`, where N is the column count, and the teams sit under the `Smjene` group;
  - choosing the fixture team leaves one column;
  - next month keeps the filter;
  - reset brings every column back;
  - at 320 px the filter row does not scroll the page sideways, and the Select and reset are touch targets.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- set `3-3-…` to `in-progress`, with a comment: split into 3.3a (team filter) and 3.3b (person filter, deferred-work.md).

**Acceptance Criteria:**
- Given a chosen team, when the user presses the reset, then every active team's column returns without leaving `/kalendar`, and the reset disappears.
- Given `apps/web/src/calendar` and `kalendar.tsx`, when they are swept, then there is still one `organizations` select, no writes, and no `localStorage` or `sessionStorage`.

## Design Notes

**Why the letters are computed before narrowing.** On a phone the compressed grid shows letters. If letters were recomputed over one column, `Alfa` could switch from `AL` to `A` when filtered. The reader would then see the same team drawn two ways.

**Why an unknown id is ignored rather than refused.** A bookmarked or shared link can outlive its team. Showing everything, with the Select reading all teams, is the harmless direction, as in `chooseTeam`.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above the baseline.
- `pnpm test:e2e` -- green. Stop Vite on 5173 first, and do not run it alongside `pnpm test`.
- `git diff --stat supabase/ package.json pnpm-lock.yaml` -- empty.

**Manual checks:**
- Demo org (`dvd-demo`, 4 teams) at 390 and 1280 px: `Sve smjene (4)` is shown; choose a team, go to the next month, then reset.

## Suggested Review Order

**The filter model**

- Entry point: the chosen team is `smjena` only when it names an active team.
  [`month.ts:599`](../../apps/web/src/calendar/month.ts#L599)

- Letters over every active team first, then columns narrowed — a column keeps its letter.
  [`month.ts:615`](../../apps/web/src/calendar/month.ts#L615)

- `filter: { teams, chosen }` — the unfiltered options beside the narrowed columns.
  [`month.ts:394`](../../apps/web/src/calendar/month.ts#L394)

**The search parameter**

- `smjena` rides along on month and mode changes; `null` drops it.
  [`month.ts:167`](../../apps/web/src/calendar/month.ts#L167)

- The one owner of "the all-teams option means no filter".
  [`month.ts:184`](../../apps/web/src/calendar/month.ts#L184)

- Any non-empty string kept; an unknown id is ignored later, never refused.
  [`month.ts:233`](../../apps/web/src/calendar/month.ts#L233)

**The screen**

- Native Select: `Sve smjene (N)`, then the teams under the `Smjene` optgroup.
  [`kalendar.tsx:366`](../../apps/web/src/routes/kalendar.tsx#L366)

- Reset shown only while a team is chosen; focus returns to the Select.
  [`kalendar.tsx:399`](../../apps/web/src/routes/kalendar.tsx#L399)

- The grid's tab stop is forgotten when the month or the chosen team changes.
  [`kalendar.tsx:145`](../../apps/web/src/routes/kalendar.tsx#L145)

- The filter row exists only in *Sve smjene*.
  [`kalendar.tsx:590`](../../apps/web/src/routes/kalendar.tsx#L590)

**Peripherals**

- Unit tests: every matrix row, letters stable under narrowing, the day list untouched.
  [`month.test.ts:718`](../../apps/web/src/calendar/month.test.ts#L718)

- E2E: options, narrowing, next month, reset and focus, unknown id, Moj raspored.
  [`calendar.spec.ts:620`](../../e2e/calendar.spec.ts#L620)

- The URL key `smjena` ships as code, not copy — exempted in its code shapes only.
  [`localization-applied.test.ts:1071`](../../test/localization-applied.test.ts#L1071)

- Copy and inventories: `kalendar.filter.*`, controls 5 → 7.
  [`hr.json:44`](../../apps/web/src/i18n/locales/hr.json#L44)
  [`prijava.test.ts:429`](../../apps/web/src/routes/prijava.test.ts#L429)
