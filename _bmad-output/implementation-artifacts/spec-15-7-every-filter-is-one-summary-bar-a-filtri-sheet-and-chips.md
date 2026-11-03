---
title: 'Every filter is one summary bar, a Filtri sheet and removable chips (15.7)'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: '578fa905529ee077fdc654530bf5a6fc0ec2138f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The four filter surfaces (*Kalendar*, *Sati*, *Ljudi*, *Godišnji* overview) draw filters as a row of chip-pickers that changes shape at 640 px, which the PO finds bolted on next to the 15.1 glass shell (reference `ux-designs/ux-shift-2026-10-30-glass/filters-15-7-po-reference.png`).

**Approach:** One pattern at every width, made once in the two shared bars (`FilterBar`, `OptionFilterBar`): a summary card (icon, muted tabular summary, `Filtri` + count Badge), one removable chip per active filter with `Očisti sve`, and a `Filtri` sheet (bottom below 1024 px, side from 1024 px) where each filter's value is picked in a Popover with a searchable option list. No `cmdk`; built on the app's Dialog and Popover.

## Boundaries & Constraints

**Always:** Keep every 7.4/7.5/7.13/7.15 behaviour: URL search params (live writes, Back, survives a month change), counts, the Kalendar replace / Sati combine rule, offline read, disabled-while-unanswered, the phone sticky head repeating the filters (`StickyHead` measures the bar as its `nextElementSibling`), the empty-*Sati* ways out (`FilterBarHandle`). Targets ≥ 44 px. A chip reads by its words and ✕, never colour; the chosen option is marked (`aria-pressed`), not only tinted. The Badge is never `destructive`. Search folds diacritics (reuse the `peopleMatching` fold). All copy through `t()`; new keys in `hr.json`. Ljudi's Status default `aktivni` stays a drawn chip that counts in the Badge, without `Očisti sve` (7.13).

**Ask First:** Any new dependency; changing the month control or `MonthNav`'s phone sheet; changing what a filter does to data or the URL.

**Never:** The month control and the `Ovaj mjesec` Badge (story 15.7b, deferred). A Popover with `glass-panel` inside the sheet (a blurred ancestor clips it). Glass utilities named in a screen. Rebase or force push.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No filter | Kalendar, defaults | Card: summary, `Filtri` with no Badge; no chips, no `Očisti sve` | N/A |
| Two active | `?smjena=B&osoba=x` (Sati) | Badge `2`; chips `Smjena: B ✕`, `Osoba: … ✕`; `Očisti sve` | N/A |
| ✕ on a chip | two chips, ✕ on first | URL drops it; focus to the next chip, else `Filtri` | N/A |
| `Očisti sve` | any active | all cleared; focus to `Filtri` (Ljudi, Godišnji: the search, as today) | N/A |
| Chip body press | active chip | opens the sheet, `aria-controls` = sheet id | N/A |
| Picker in sheet | Smjena field → Popover | search empty, focus on chosen option; ↑↓ Home End, Enter picks and writes the URL; Escape closes only the Popover, focus to its field | no match → muted "Nema rezultata" line |
| Sheet close | `Prikaži {n}`, Escape, crossing 1024 px | sheet closes, focus to `Filtri` | N/A |
| Unanswered list | Ljudi/Godišnji loading | `Filtri` and chips disabled, `aria-describedby` the refusal | as today |

## Epic AC Deviations

- "The month control … is a compact header control … `Ovaj mjesec` Badge is removed" — **DEFERRED** to story 15.7b (deferred-work, 2026-11-03), PO's split choice; the PO confirmed the Badge's removal there.
- "one summary bar is drawn as a glass-reading card" — **REINTERPRETED** as an opaque reading Card: glass rule "cards, tables, lists never carry backdrop-filter", and the Popover/sheet must not sit in a blurred ancestor.
- "every filter surface: *Kalendar*, *Sati* and *Ljudi*" — **WIDENED** to *Godišnji*'s overview, which shares `OptionFilterBar` (PO choice, 2026-11-03).
- "a searchable Command list" — **NARROWED** to the app's own `OptionList` with a search field, no `cmdk` (PO choice).

</frozen-after-approval>

## Code Map

- `apps/web/src/components/filter-bar.tsx` -- `FilterBar` (99–256: `sm:hidden` Filtri, chip `onToggle` phone→sheet / ≥640→Popover, focus-wait 126–147, `useCloseWhenWide` 168), `SummaryLine` 271, `ChipFrame` 374 (inactive `max-sm:hidden` 406, own Popover), `OptionList` 466 (reuse as the Command list), `PersonOptions` 586 (search pattern to generalise), `SheetDialog`/`SheetHeader`/`SheetFooter` 701–758, `SheetContent` 761 (RadioGroup → picker fields). `SheetDialog` is also used by `month-nav.tsx:242`: keep its bottom dock.
- `apps/web/src/utils/filter-bar.ts` -- the model; `focusAfterRemovalOf` 245 and `focusAfterOptionRemovalOf` (~280) may name chips no longer drawn: `drawn()` → `Filtri` fallback covers it.
- `apps/web/src/components/option-filter-bar.tsx` -- same mechanics with `stateKey`; `leading` (search) / `trailing` (sort) stay in the card row.
- `features/members/components/member-filters.tsx`, `features/leave/components/leave-overview-filters.tsx`, `features/calendar/components/calendar-filters.tsx`, `features/hours/components/organization-hours-filters.tsx`, `organization-hours-empty.tsx:50–97` -- consumers; props should not need to change.
- `apps/web/src/components/ui/dialog.tsx:154–160` -- docked classes (pinned verbatim by `structural-pins-shell.test.ts:727–760`); add a responsive side variant.
- `apps/web/src/components/ui/popover.tsx`, `hooks/dismiss.ts` -- document-level Escape; inside a native `<dialog>` one Escape would also cancel the dialog.
- `apps/web/src/hooks/viewport.ts`, `utils/viewport.ts:11,14` -- `PHONE_MEDIA_QUERY`, `WIDE_QUERY`; no 1024 query yet.
- `apps/web/src/components/ui/badge.tsx`, `button.tsx` (no 44 px size; screens add `h-11`), `card.tsx`.
- `apps/web/src/lib/i18n/locales/hr.json:182` -- `filter.*`; `Očisti sve`, option search label and no-match are missing.
- Pins that move: `pages/screens-sweep.test.ts:499–620`, `pages/literal-sweep.test.ts:158`, `structural-pins-shell.test.ts:727–760`, `structural-pins-members.test.ts:1058–1115`, `pages/key-sources.fixture.ts`, `pages/source-guards.fixture.ts`, `utils/filter-bar.test.ts`.
- e2e: `e2e/pages/filter-bar.ts` (chooseTeam/choosePerson, `lastControl`, pickers), `people.page.ts:152–191`, `leave.page.ts:75–100`; specs `calendar.spec.ts:753,2149–2661`, `calendar-conflicts.spec.ts:188,289,355`, `layout.spec.ts:262,445–561,826`, `hours.spec.ts:477–893`, `people.spec.ts:362–515`, `my-leave.spec.ts:321`.
- Docs: DESIGN.md:359–360 (*Filter chip row*, *Filter sheet*), :305, :338; EXPERIENCE.md:101–102; epics.md:138 UX-DR19.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/ui/dialog.tsx` -- add a `side` docking (bottom below `lg`, full-height right panel from `lg`, safe-area kept) as classes only; pin it beside the docked pin -- the one sheet primitive, restyled once.
- [x] `apps/web/src/components/ui/popover.tsx` -- add an opaque variant for use inside a panel (no glass utility, own border/shadow) that handles Escape itself so the dialog does not cancel -- glass rule 1; one Escape closes one layer.
- [x] `apps/web/src/hooks/viewport.ts`, `utils/viewport.ts` -- a 1024 px query and a close-on-crossing hook -- the sheet changes dock at 1024.
- [x] `apps/web/src/components/filter-bar.tsx` -- shared pieces: `FilterSummaryCard` (Card, icon, `role="status"` summary, `Filtri` `h-11` with count Badge), `ActiveChips` (active chips only, chip body opens the sheet, ✕ `size-11`, `Očisti sve`), `FilterField` (label + value button opening the opaque Popover with a searchable `OptionList`, counts muted tabular). Rewrite `FilterBar` on them; the sheet is `side`, has one field per filter, the `replaceNote`, `Poništi` and `Prikaži {n}`. Remove chip Popovers and `useCloseWhenWide` from the bar.
- [x] `apps/web/src/components/option-filter-bar.tsx` -- same pieces; `leading`/`trailing` stay in the card row (own row below `sm`).
- [x] `apps/web/src/utils/filter-bar.ts` + test -- a generic diacritic-folding `optionsMatching`; active-count for the Badge.
- [x] `apps/web/src/lib/i18n/locales/hr.json` -- `filter.clearAll` "Očisti sve", option search label, no-match, Badge accessible name (`Filtri, aktivno: {n}`).
- [x] Unit/structural pins and fixtures listed in the Code Map -- update to the new structure and counts.
- [x] e2e page objects and specs in the Code Map -- picking goes through `Filtri` → field → option; focus expectations per the I/O matrix; 44 px checks at 320 px; side sheet at 1280, bottom at 390.
- [x] Docs -- DESIGN.md *Filter chip row* + *Filter sheet* rewritten, `updated:` bumped; EXPERIENCE.md:101–102; epics.md UX-DR19.

**Acceptance Criteria:**
- Given any of the four surfaces at 390 px and 1280 px in both themes, when it renders, then it matches the I/O matrix and the PO reference's bar and chips, and no `.tsx` names a glass utility.
- Given the sheet at 1280 px, then it is docked at the right; at 390 px at the bottom; opening a picker inside it never shows blur on the Popover.
- Given the keyboard only, when filtering each surface end to end, then every control is reachable, focus never lands on `body`, and the sticky head still repeats the filters on a phone.
- Given the PR, then lint, typecheck, unit and e2e are green, and no new dependency is added.

## Design Notes

**Why the phone pattern everywhere.** The new pattern is today's phone flow (Filtri, active chips, sheet) at every width, so focus rules, live URL writes and the `drawn()` fallback carry over; what goes is the ≥ 640 chip-as-picker and its source pins.

**Popover inside the sheet.** The native `<dialog>` is a glass backdrop root; a glass Popover inside it would blur only the panel. The opaque variant reads on the .85/.92 panel and keeps one layer count.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && pnpm typecheck && pnpm test` -- expected: green.
- e2e -- CI on the PR (port 5173 may belong to another session).

**Manual checks:**
- Screenshots on a temporary Vite on port 5174 against the shared stack, no reset: each surface at 390 and 1280, both themes, sheet and an open picker.

## Suggested Review Order

**One pattern, one shared state**

- Entry point: focus-wait, opener tracking and sheet close shared by both bars.
  [`filter-bar.tsx:106`](../../apps/web/src/components/filter-bar.tsx#L106)

- The summary card: opaque Card, status summary, `Filtri` with its count Badge.
  [`filter-bar.tsx:350`](../../apps/web/src/components/filter-bar.tsx#L350)

- Active chips only; the body opens the sheet, only the opener reads expanded.
  [`filter-bar.tsx:425`](../../apps/web/src/components/filter-bar.tsx#L425)

- Kalendar/Sati bar rebuilt on the pieces; chip popovers and 640 px split gone.
  [`filter-bar.tsx:253`](../../apps/web/src/components/filter-bar.tsx#L253)

- Ljudi/Godišnji bar on the same pieces; sheet outside the group, "all" kept.
  [`option-filter-bar.tsx:60`](../../apps/web/src/components/option-filter-bar.tsx#L60)

**The sheet and its pickers**

- Field value agrees with its picker: "Zamijenjeno osobom" while a person replaces the team.
  [`filter-bar.tsx:870`](../../apps/web/src/components/filter-bar.tsx#L870)

- Searchable list: pinned "all" rows, live no-match line, scroll inside the picker.
  [`filter-bar.tsx:726`](../../apps/web/src/components/filter-bar.tsx#L726)

- Side docking from 1024 px, classes only; the month picker keeps the bottom dock.
  [`dialog.tsx:96`](../../apps/web/src/components/ui/dialog.tsx#L96)

- Opaque Popover: glass inside a backdrop root would blur only the panel.
  [`popover.tsx:24`](../../apps/web/src/components/ui/popover.tsx#L24)

- One Escape or backdrop press closes one layer; IME composition ignored.
  [`dismiss.ts:22`](../../apps/web/src/hooks/dismiss.ts#L22)

- The sheet closes when the width crosses 1024 px.
  [`viewport.ts:50`](../../apps/web/src/hooks/viewport.ts#L50)

**Model**

- Next active chip or `null` for `Filtri` after a ✕.
  [`filter-bar.ts:271`](../../apps/web/src/utils/filter-bar.ts#L271)

- Generic diacritic fold, now under `peopleMatching` too.
  [`filter-bar.ts:326`](../../apps/web/src/utils/filter-bar.ts#L326)

- A typed character on the list goes to the search; Space and chords do not.
  [`filter-bar.ts:233`](../../apps/web/src/utils/filter-bar.ts#L233)

**Docs**

- Filter chip row and Filter sheet rewritten for 15.7.
  [`DESIGN.md:359`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L359)

- Filter chips behaviour: focus, sheet, pickers, URL.
  [`EXPERIENCE.md:101`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L101)

- UX-DR19 rewritten, not appended.
  [`epics.md:138`](../planning-artifacts/epics.md#L138)

**Tests**

- Opaque Popover pairs measured in light and dark.
  [`theme-contrast.test.ts:1348`](../../test/theme-contrast.test.ts#L1348)

- Kalendar: replaced Smjena field marks nothing.
  [`calendar.spec.ts:2389`](../../e2e/tests/calendar/calendar.spec.ts#L2389)

- Page object: picking goes through `Filtri` → field → option.
  [`filter-bar.ts`](../../e2e/pages/filter-bar.ts)
