---
title: 'Ljudi filters by status and marks scheduled changes in a status column (7.13a)'
type: 'feature'
created: '2026-10-08'
status: 'done'
baseline_commit: '8e9572654df380aeb51046c996af216d0266bd97'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ljudi cannot filter by status (FR-15), and nothing shows a scheduled reactivation. Its filters are still the 1.5a search and two `<select>`s held in component state, so a filtered list cannot be linked or restored after Back. Four stat cards sit where the mockup has one summary line.

**Approach:** Follow `mockups/people-1.html` §1 and §6. Ljudi gets the 7.5 chip pattern: chips for `Razina`, `Smjena` and `Status` beside the search, a `Poredano` control, and one summary line `Prikazano: {n} osoba · {a} administrator · {s} zakazana promjena`. The page also gets a **Status** column that shows today's status, or the scheduled change as `Od {dd.mm.}: neaktivno|aktivno`. Search, filters and sort move into the URL (`?trazi=&razina=&smjena=&status=&sort=`).

## Boundaries & Constraints

**Always:**
- The status filter has three values: `aktivni` (the default, meaning active today), `neaktivni` and `svi`. The default view is `aktivni`, so its chip draws as set and its ✕ shows `svi`. `Poništi filtre` returns the URL to its defaults: no search, every level, every team, `aktivni`, sort by name ascending. It is shown only while the URL differs from the defaults.
- The status column states one fact per row:
  - `Aktivno` in muted text;
  - `Neaktivno`;
  - when a change is scheduled, an outline badge `Od {dd.mm.}: neaktivno|aktivno`, which covers a scheduled reactivation too.
  - The fact comes from `memberStatusOf`, the one rule already used by the member page's Status card.
  - The name cell no longer carries the status badge. The team cell's scheduled-move marker stays.
- The summary line counts the rows shown. Its `zakazana promjena` count is shown rows with a scheduled status change. It replaces `MemberStats` and `MemberCount`, it is the one `role="status"`, and it shows zero counts. While today is unknown it states no status figure (the shipped `null` rule).
- Reuse the 7.5 drawing: the chip with its ✕, the option-list picker, the phone `Filtri · N` sheet with one radio group per chip, and focus after a removal. Generalise `components/filter-bar.tsx` so it draws a list of option chips. *Kalendar* and *Sati* keep their behaviour, URLs and tests.
- The Ljudi route validates its search. An unknown value falls back to the default, and a stale team id to every team (the shipped `teamToStore` rule). Typing in the search replaces the history entry rather than pushing one.
- On phones the rows stay 7.6 `StackedRow`s. The status fact is a labelled field, and a row stays one link.
- All copy goes in `hr.json`. The domain and services return codes and operands.
- Docs go in the same PR: DESIGN.md §Components, EXPERIENCE.md §Component Patterns (a Ljudi bullet), §IA (L66) and §Interaction Primitives L136 (a scheduled change shows in the status column). sprint-status: 7.12 → done, and 7.13 moves with the workflow.

**Ask First:** a migration, an RPC or Edge Function change, any change to `packages/domain`, a new dependency, any change to *Kalendar*/*Sati* filter behaviour.

**Never:**
- The *Dodaj osobu* dialog or deactivation numbers. Both are deferred, see `deferred-work.md`.
- Deactivation offered from Ljudi.
- Filter state persisted beyond the URL.
- Colour as the only status signal.
- A second status rule.
- Removing the email column.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | `/ljudi` with 2 inactive among 17 | the 15 active rows; chip `Status: aktivni` is set; summary counts 15 | N/A |
| All | ✕ on the status chip | `?status=svi`, 17 rows, inactive rows read `Neaktivno` | N/A |
| Scheduled deactivation | active today, inactive from 05.10. | row in `aktivni`; status cell `Od 05.10.: neaktivno`; summary `1 zakazana promjena` | N/A |
| Scheduled reactivation | inactive today, active from 12.10. | row in `neaktivni`; `Od 12.10.: aktivno` | N/A |
| Deep link | `/ljudi?razina=admin&smjena=<id>&sort=-ime` | chips and sort restored; Back after a change restores the previous filter | N/A |
| Bad URL | `?status=x&smjena=<gone id>` | defaults for the bad values | no throw |
| Reset | any narrowed state | `Poništi filtre` → `/ljudi`, focus to the search | N/A |
| Today unknown / loading | zone not settled, or the read pending | skeleton rows, chips drawn from the URL, no status figure | shipped notice on failure |

## Epic AC Deviations

- AC2 "`Novi član` … a short dialog creates the member and ends by showing the password once" is **DEFERRED** (7.13b). The story holds three independently shippable goals, and the human chose to split it on 2026-10-08. See `deferred-work.md`.
- AC3 "a deactivation … one neutral question … with a date and the consequence in numbers" is **DEFERRED** (7.13c), for the same reason. See `deferred-work.md`.
- AC4 is narrowed to the docs this part changes.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/ljudi.tsx` -- `LjudiScreen` :40 composes the stats, `#ljudi-error`, the table and the count; `ljudiRoute` :93 needs `validateSearch`, modelled on `pages/kalendar.tsx` `calendarSearchOf`.
- `apps/web/src/features/members/hooks/use-member-list.ts` -- `useState` for search, level, team and sort (:45-49) → URL search plus `navigate`; `resetFilters` :112; `teamToStore` settle :96; `NarrowingInputs` :73 gains `status`.
- `apps/web/src/features/members/services/list.ts` -- `MEMBER_COLUMNS` :1076 (comment :1066 says "no status column", now reversed); `INACTIVE_NAME_CELL`/`SCHEDULED_INACTIVE_NAME_CELL` :958-965 become a status cell; `memberStatusOf` :588; `memberStatusMessageKey` :1233; `statusLookOf` :1301; `membersSummaryOf` :1372 → the summary line's operands; `ALL_LEVELS`/`chooseLevel` :1487; `ALL_TEAMS`/`NO_TEAM`/`chooseTeam`/`teamToStore` :1522-1645; `isNarrowed` :1647; `narrowMembers` :1942; `membersViewOf` :2108. Add the status filter, URL parse/serialise of the search, and the default-state test.
- `apps/web/src/utils/filter-bar.ts` + `components/filter-bar.tsx` -- the 7.5 model (`FilterKey` :26 is two keys, `FilterChange {smjena, osoba}`), `FilterBar` :98, `Chip` :263, `OptionList` :366, `FilterSheet` :555 / `SheetContent` :604. Generalise the drawing for N option chips. The person picker stays *Kalendar*/*Sati*-only.
- `apps/web/src/features/members/components/member-filters.tsx` (search + selects → search + chips), `member-table.tsx` :62 (status column; the phone `SortControl`), `member-rows.tsx` :61 (status field), `cell-view.tsx` :20 (drop the status badge), `member-stats.tsx` + `member-count.tsx` (replaced by the summary line).
- `apps/web/src/lib/i18n/locales/hr.json` -- `ljudi` :540-772 (`count` :551, `stats` :556, `reset`, `status.inactive*` :657); `filter.*` :172-231 (chip, remove and summary keys are two-key only).
- `e2e/pages/people.page.ts` -- list locators :30-100 (filters move to chips; `e2e/pages/filter-bar.ts` and `sort-control.ts` are the helpers). `e2e/tests/people/people.spec.ts` :13, :267 (scheduled marker), :432-503 (phone); member-erasures and teams specs that look for a deactivated person in the list need `?status=svi`.
- Unit: `features/members/services/list.test.ts` -- columns :512, narrowing :661, team filter :914, reset :1162, cell kinds :1230, status :1889, summary :2350. `utils/filter-bar.test.ts` keeps Kalendar/Sati green. `pages/prijava.test.ts` `MEMBER_LIST` sweeps :164-189.
- Docs (`_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/`): DESIGN.md :281 Table, :310 Filter chip, :311 Filter sheet; EXPERIENCE.md :66 IA, :96 filter chips, :136 scheduled change, :177/:179 responsive.

## Tasks & Acceptance

**Execution:**
- [x] `features/members/services/list.ts` + `list.test.ts` -- the status filter, the status cell and its codes, summary operands (shown, admins, scheduled), URL search parse/serialise with defaults, `isNarrowed` against the defaults -- the one rule set, executed by node
- [x] `utils/filter-bar.ts`, `components/filter-bar.tsx` + tests -- option chips generalised; Kalendar/Sati unchanged -- shared drawing
- [x] `pages/ljudi.tsx`, `hooks/use-member-list.ts` -- `validateSearch`, URL-driven state, replace on typing, reset → defaults with focus to the search -- wiring
- [x] `member-filters.tsx`, `member-table.tsx`, `member-rows.tsx`, `cell-view.tsx`; delete `member-stats.tsx`, `member-count.tsx` -- chips, the status column/field, the summary line -- surface
- [x] `hr.json`, `pages/prijava.test.ts` sweeps -- keys (plural-aware), file lists -- i18n
- [x] `e2e/pages/people.page.ts` + specs -- drive the chips; assert the default `aktivni`, `?status=svi`, a scheduled deactivation's status cell, a deep link and Back, and 390 px -- churn
- [ ] DESIGN.md, EXPERIENCE.md, sprint-status -- docs

**Acceptance Criteria:**
- Given an admin on Ljudi, when it renders, then there are chips for Razina, Smjena and Status, a status column, and one summary line, and no `<select>` and no stat card remain.
- Given any filter or sort change, when the page is reloaded, then the same rows and chips show.
- Given 390 px, then there is no horizontal scroll, the inactive chips sit behind `Filtri · N`, and each row is one link with its status field.
- Lint (including feature boundaries), typecheck, unit and e2e tests pass at 1280 and 390.

## Spec Change Log

- 2026-10-08, code review patches (no spec amendment): the search box resyncs only on an outside URL change (Back, reload, link), so fast typing keeps its letters; with today unknown `aktivni`/`neaktivni` show skeletons, and the filter and counts read `memberStatusOf` like the cell; `Poništi filtre` hidden while unanswered; the sheet's `Poništi` resets without moving focus out of the sheet; an unchanged URL is never navigated; the URL state key is collision-free; one fallback for an unknown status; `trazi` trimmed; complete effect dependencies; chips described by the list's error notice; `OptionFilterBar` in its own module so *Kalendar*/*Sati* carry none of it; e2e for `?trazi=` with Back and the sheet's reset at 390 px. Rejected as matching the spec: the reset covers the sort; the scheduled count is status-only.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm --filter ./apps/web test` -- expected: all green
- `pnpm e2e` (people, teams, member-erasures, calendar, hours suites) -- expected: green at 1280 and 390

## Suggested Review Order

**The status rule and the URL state**

- Entry point: one status filter, read through `memberStatusOf` like the cell.
  [`list.ts:1688`](../../apps/web/src/features/members/services/list.ts#L1688)

- Defaults the reset returns to; the status chip opens on `aktivni`.
  [`list.ts:1722`](../../apps/web/src/features/members/services/list.ts#L1722)

- URL parse with fallbacks and trimmed search; serialise leaves defaults out.
  [`list.ts:1806`](../../apps/web/src/features/members/services/list.ts#L1806)

- With today unknown, a status filter waits on skeletons rather than guessing.
  [`list.ts:1701`](../../apps/web/src/features/members/services/list.ts#L1701)

- The status cell: today's fact, or the scheduled change either way.
  [`list.ts:1136`](../../apps/web/src/features/members/services/list.ts#L1136)

- The summary counts the rows shown, scheduled status changes included.
  [`list.ts:1383`](../../apps/web/src/features/members/services/list.ts#L1383)

**Wiring**

- One write path: skips an unchanged URL, replaces while typing, pushes otherwise.
  [`use-member-list.ts:130`](../../apps/web/src/features/members/hooks/use-member-list.ts#L130)

- Sheet reset keeps focus; page reset focuses the search.
  [`use-member-list.ts:182`](../../apps/web/src/features/members/hooks/use-member-list.ts#L182)

- The route validates its search and hands it to the hook.
  [`ljudi.tsx:114`](../../apps/web/src/pages/ljudi.tsx#L114)

**Surface**

- Option chips with the 7.5 picker, ✕ and phone sheet, in their own module.
  [`option-filter-bar.tsx:64`](../../apps/web/src/components/option-filter-bar.tsx#L64)

- The shared 7.5 primitives extracted; Kalendar and Sati unchanged.
  [`filter-bar.tsx:1`](../../apps/web/src/components/filter-bar.tsx#L1)

- Ljudi's search, three chips and summary line.
  [`member-filters.tsx:83`](../../apps/web/src/features/members/components/member-filters.tsx#L83)

- Phone rows carry the status as a labelled field.
  [`member-rows.tsx:74`](../../apps/web/src/features/members/components/member-rows.tsx#L74)

**Peripherals**

- e2e: default `aktivni`, the scheduled cell, ✕ to `svi`, deep link and Back, 390 px sheet.
  [`people.spec.ts:120`](../../e2e/tests/people/people.spec.ts#L120)

- EXPERIENCE.md: the Ljudi filters bullet.
  [`EXPERIENCE.md:97`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L97)
