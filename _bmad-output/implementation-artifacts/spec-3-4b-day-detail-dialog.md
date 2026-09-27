---
title: 'Story 3.4b: Opening a day to see who is on it'
type: 'feature'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'fc7b3a3f90c5cdd5a307734e1a8f6feb3eb0e0ba'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-4a-roster-as-at-a-date.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The calendar shows what each team works, but not who works it (CAP-11). Its cells are inert until 3.4, and 3.4a derived the roster as at a date (`shiftRoster`) without showing it.

**Approach:** A grid cell, or a day in a day list, opens a read-only Dialog. It shows the team, the date, the shift type, its times and the roster as `Ime · čin · položaj`. The user decided this on 2026-09-27:
- every cell opens the Dialog;
- an off day or a day with no rotation says so and shows no roster;
- rank and position are shown when the organization uses them;
- the state lives in `useState`, not in the URL;
- the roster is sorted by name only.

## Boundaries & Constraints

**Always:**
- **Model (`apps/web/src/calendar/day-detail.ts`, pure):** `dayDetailOf(snapshot, teamId, date)` returns `null` for an unknown team. Otherwise it returns:
  - `teamName`;
  - `date`, in the calendar's existing weekday and date wording;
  - `kind`: `'working'`, `'off'` (a non-working type) or `'noRotation'` (no rotation version in effect);
  - `typeName` and `range`, both `null` unless the kind is `working`; the range comes from the same derivation `cellOf` uses, never a second one;
  - `roster`: `{ id, name, fireRank, position }[]`. It comes from `shiftRoster(snapshot.members, teamId, date)` and is sorted by `compareText(name)`, then by id. It is empty unless the kind is `working`.
- **Opening:**
  - A grid cell opens its detail on click, and on Enter or Space while focused. `grid-keys.ts` replaces `isInertGridKey` with an open-key predicate. Space's default is still prevented, so the page never scrolls.
  - A day-list day with a team (the viewer's or the chosen person's) holds a button that opens that team's detail. A day with no team stays plain text.
- **Dialog (`kalendar.tsx`):** the shared `Dialog` and `DialogHeader` are used as-is.
  - The title is `{team} · {date}`, and `closeLabel` is `kalendar.detail.close`.
  - When working: the type name, the range, the heading `kalendar.detail.roster`, and a `<ul>` with one line per member. Each line goes through `rosterRankMessageKey`, `rosterPositionMessageKey` and `rosterLineOf`, with `ranksShown` and `positionsShown` given `{ usesFireRanks: snapshot.usesFireRanks }`.
  - An empty roster shows `kalendar.detail.empty`.
  - `off` shows `kalendar.detail.off`, and `noRotation` shows `kalendar.detail.noRotation`, with no list.
  - Escape or close returns focus to the control that opened it.
  - The detail is re-derived from the current snapshot while it is open, and closes if the team disappears.
- **Text (`hr.json`):**
  - `kalendar.detail.close` = "Zatvori"
  - `roster` = "Raspored"
  - `empty` = "Taj dan nitko nije raspoređen."
  - `off` = "{team} taj dan ne radi."
  - `noRotation` = "{team} taj dan nema rotacije." (the user reworded it on 2026-09-27, in review: after "Za" the name would need the accusative)
  - Register them in every inventory, commented "story 3.4b".
  - Rank and position labels reuse the existing keys through the members modules.
- **`sprint-status.yaml`:** `3-4-…` is done, with the comment updated so that 3.4b has landed. Mark the 3.4b deferred-work entry resolved.

**Ask First:**
- showing overrides;
- ordering or marking the roster by rank or position;
- storing the open day in the URL;
- changing `Dialog` itself.

**Never:**
- a second query key, or any write;
- rank or position used by any rule, colour or filter;
- roster overrides, which belong to 3.6;
- new dependencies, render tests, or web storage.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Working day | Alfa works Noć on D; A, B on Alfa | `working`, Noć, `19:00–07:00`, roster sorted by name (Ana before Boris) whatever input order | N/A |
| Deactivated since / inactive on date | B inactive from D+10 / D−3 | B listed / B absent | N/A |
| Ranks on | `usesFireRanks` true, rank and position set | `Ana · vatrogasac · vozač` | unknown rank → `rankUnknown` |
| Ranks off | `usesFireRanks` false | `Ana` | N/A |
| Off day | non-working type | `off`, no roster, no range | N/A |
| No rotation | no version in effect on D | `noRotation` | N/A |
| Nobody | working, no active member | `working`, empty roster → `detail.empty` | N/A |
| Unknown team | teamId not in snapshot | `null`; Dialog closes | N/A |
| Keys | Enter / Space on a focused cell | detail opens; Space does not scroll | N/A |
| Day list | viewer's day on no team | not a button | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/calendar/month.ts`:
  - `CalendarCell` :398, `CalendarDay` :479;
  - `cellOf` :577, whose range comes from `shiftTypeVersionOn` then `shiftTimesShownOf` at :611. Extract or reuse it so there is no second derivation.
  - `calendarDayListOf` :636, `calendarMonthOf` :719.
- `apps/web/src/calendar/snapshot.ts`: `CalendarMember` :155, `CalendarSnapshot` :181 (with `usesFireRanks` :186).
- `packages/domain/src/roster.ts`: `shiftRoster` :134 and `RosterEntry` :56. The default export is `packages/domain/src/index.ts`.
- `apps/web/src/calendar/modifiers.ts`: `cellLabelOf` :212, which holds the date and weekday wording to reuse.
- `apps/web/src/calendar/grid-keys.ts`: `isInertGridKey` ~:102, and the comments at :58 and :102.
- `apps/web/src/routes/kalendar.tsx`:
  - the query at :135;
  - `moveGridFocus` :274, with the inert branch at :282;
  - `renderCell` :300, `renderDay` :452, `renderDayList` :482, `renderPerson` :514, `renderGrid` :525, and the `onKeyDown` at :540.
- Reuse:
  - `components/ui/dialog.tsx` (`Dialog`, `DialogHeader`), used as in `routes/ljudi.smjene.tsx:234`;
  - the roster line in `routes/smjene.$id.tsx:85-118`;
  - `members/rank.ts:202,212` and `members/position.ts:112,121,167`;
  - `compareText` in `i18n/format.ts:406`.
- Tests and inventories:
  - `calendar/grid-keys.test.ts`;
  - a new `calendar/day-detail.test.ts`, with snapshots built like `month.test.ts` `snapshotOf`;
  - `routes/prijava.test.ts`: Kalendar `expectedControls: 7` :431 (the cell and day buttons and the Dialog close each add one), the comment at :425, Kalendar `strings: 20` :1754, and `KEY_SOURCES` :1405 / :2088 if a new key source is added;
  - `test/resource-hygiene.test.ts` :881-916;
  - `test/localization-applied.test.ts` :251-256, adding `day-detail.ts`.
- `e2e/calendar.spec.ts`:
  - `gridOf` / `cellOf` :119-145;
  - the keyboard test :461-560, whose Enter/Space-inert block at :542-552 changes;
  - the fixture in `e2e/support/fixture.ts:146-230`: *Smjena Alfa*, Lana on it from today, Toni on no team.
  - `fire-ranks.spec.ts` may leave ranks on, so match names with `toContainText`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/calendar/day-detail.ts`, `day-detail.test.ts` -- `dayDetailOf` -- every non-E2E matrix row
- [x] `apps/web/src/calendar/grid-keys.ts`, `grid-keys.test.ts` -- the open-key predicate, with Space still prevented -- cells stop being inert
- [x] `apps/web/src/routes/kalendar.tsx` -- the cell `onClick`, Enter/Space, the day-list buttons, and the Dialog -- AC1
- [x] `hr.json`, `resource-hygiene.test.ts`, `prijava.test.ts`, `localization-applied.test.ts` -- the keys, the counts and the source
- [x] `e2e/calendar.spec.ts`:
  - as an admin at 1280 px, clicking Alfa's working cell today shows the type, the range and Lana; Escape closes it and focus returns to the cell;
  - Enter on a focused cell opens it, and Space opens it without scrolling (this replaces the inert block);
  - yesterday's cell does not list Lana (her membership starts today);
  - an off-day cell shows the off text;
  - as a member-role account at 390 px in *Moj raspored*, tapping today's day opens the detail naming her.
- [x] `sprint-status.yaml`, `deferred-work.md` -- 3-4 done, and the entry resolved

**Acceptance Criteria:**
- Given a working shift on a date, when its detail is opened, then it shows the shift type, both clock times, and the roster of the team's members active on that date (CAP-11, AD-2).
- Given a member with no team, when their schedule is opened, then it explains why it is empty (UX-DR20). This is unchanged from 3.2a and pinned by 3.4a.
- Given `apps/web/src/calendar` and `kalendar.tsx`, when they are swept, then there is one query key, no writes and no web storage, and rank and position are read only to display them.

## Design Notes

The Dialog reads the snapshot the calendar already holds. That snapshot is the canonical `OrganizationSnapshot` for this surface, so opening a day triggers no fetch. The detail re-derives each time the snapshot refetches, which keeps it consistent with the grid behind it.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips
- `pnpm test:e2e` -- green; stop Vite on 5173 first
- `git diff --stat package.json pnpm-lock.yaml` -- empty

**Manual checks:**
- Demo org at 390 and 1280 px: open a working cell, an off cell and a day-list day by keyboard and by tap. Check both themes.

## Suggested Review Order

**The detail model**

- Entry point: one pure derivation of team, date, kind, type, range and roster.
  [`day-detail.ts:88`](../../apps/web/src/calendar/day-detail.ts#L88)

- What the open Dialog shows after a refetch, or a close signal (no ghost reopen).
  [`day-detail.ts:157`](../../apps/web/src/calendar/day-detail.ts#L157)

- The range is extracted from the grid's cell, so detail and grid never disagree.
  [`month.ts:621`](../../apps/web/src/calendar/month.ts#L621)

**Opening and closing**

- Enter opens on keydown (no repeat, not while composing); Space arms the cell.
  [`grid-keys.ts:137`](../../apps/web/src/calendar/grid-keys.ts#L137)

- Space opens on keyup, so its keyup never hits the Dialog's close button.
  [`grid-keys.ts:149`](../../apps/web/src/calendar/grid-keys.ts#L149)

- The opener is recorded from the event target; every close funnels into one path.
  [`kalendar.tsx:268`](../../apps/web/src/routes/kalendar.tsx#L268)

- The browser's late `close` event is ignored once, fixing an Escape-then-Space race.
  [`kalendar.tsx:287`](../../apps/web/src/routes/kalendar.tsx#L287)

**The Dialog**

- The shared Dialog, with the title carrying the year and `onCancel`/`onClose` props.
  [`kalendar.tsx:897`](../../apps/web/src/routes/kalendar.tsx#L897)

- Roster lines through the members modules; rank and position only when used.
  [`kalendar.tsx:613`](../../apps/web/src/routes/kalendar.tsx#L613)

- A day-list button named by the grid's full cell label, `aria-haspopup="dialog"`.
  [`kalendar.tsx:595`](../../apps/web/src/routes/kalendar.tsx#L595)

**Peripherals**

- Unit tests: every matrix row, archived team, refetch and close signals.
  [`day-detail.test.ts:111`](../../apps/web/src/calendar/day-detail.test.ts#L111)

- Counted allowlist: rank and position read only for display.
  [`snapshot.test.ts:839`](../../apps/web/src/calendar/snapshot.test.ts#L839)

- E2E admin detail: click, keys, focus return, Back closes, exact rank lines on and off.
  [`calendar.spec.ts:635`](../../e2e/calendar.spec.ts#L635)

- E2E rank-setting lock, shared with the fire-rank and position specs.
  [`database.ts:163`](../../e2e/support/database.ts#L163)

- Copy: the `kalendar.detail.*` keys, `noRotation` as the user reworded it.
  [`hr.json:61`](../../apps/web/src/i18n/locales/hr.json#L61)
