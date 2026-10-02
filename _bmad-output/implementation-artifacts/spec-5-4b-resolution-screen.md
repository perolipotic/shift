---
title: 'An admin opens a conflict on its own screen and accepts it as uncovered (5.4b)'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_commit: '42ea8e336bee42bce762a64b914c3f00c9ec89c1'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An admin sees every unresolved conflict on Raspored, but cannot decide any of them. Since 5.4a a resolution can be stored, yet nothing in the app writes one. The leave-hours figure is still always empty.

**Approach:** Each queue row links to its own resolution screen. The screen shows the facts and the one outcome 5.4b ships, "Prihvati kao nepokriveno", as a radio card with its consequence strip, plus ‹ › to the adjacent conflict. Saving inserts an `accept_uncovered` resolution. The shift is then marked uncovered on the admin calendar, and its hours become the absent member's leave hours.

## Boundaries & Constraints

**Always:**
- **Route.** `/raspored/$memberId/$date/$teamId`, admin-only with the Raspored guard. It reads the queue's three sources and finds the conflict among the unresolved. If it is missing (already resolved, bad params, or no longer on leave), the screen says so and links back. Each queue row becomes a link to its screen; there are no checkboxes and no bulk action.
- **Header and facts** (mockup `conflicts-1.html` §3):
  - the back link "‹ Raspored · N neriješenih", the heading "Konflikt", and "K od N · odluči što vrijedi za ovu smjenu.";
  - ‹ › outline icon buttons (`month-nav` pattern), which move to the adjacent unresolved conflict in queue order without saving. Each is disabled at its end, with an aria-label naming the target date. They are visible at every width;
  - the facts: shift type and times, team, date; the absent member with rank and position (information only); the leave range and its cost in days; and "Taj dan rade i ({tim}): …" (human, 2026-10-02: a team name cannot be declined) from `dayDetailOf`'s roster, excluding members on leave that date.
- **Choice.**
  - `role="radiogroup"` labelled "Što odlučuješ?" with the hint "redoslijed je uvijek isti". It is built on `@radix-ui/react-radio-group` as a shadcn `components/ui/radio-group.tsx`, so it moves by arrow keys.
  - 5.4b renders ONE `resolution-option` card, "Prihvati kao nepokriveno" (human, 2026-10-02). 5.4c and 5.4d insert theirs at fixed positions 2 and 3.
  - Nothing is preselected, and no card is primary-styled or labelled recommended. The selected card gets a primary border plus a ring and a filled radio, with no fill change.
- **Consequence strip**, three terms in this order:
  - coverage: "{covered} od {total} člana/članova · Nepokriveno" with `CircleDashed`. Total is the roster length; covered excludes every roster member on live leave that date;
  - the absent member's hours: "{h} h kao godišnji", from the shift's duration, or "—" when untimed;
  - the balance: "{n} dana preostalo · bez promjene", from `leaveBalanceOf`.

  Croatian plurals go through ICU.
- **Save.**
  - "Spremi odluku" stays `aria-disabled` until a card is chosen. Before a choice the hint reads "Odaberi odluku." (human, 2026-10-02: one card until 5.4d restores "Odaberi jednu od tri odluke."), and after one, "Odluka se bilježi s tvojim imenom i vremenom." "Odustani" returns to the queue.
  - Saving inserts `(organization_id, member_id, date, team_id, kind='accept_uncovered')` directly, the way leave is written. The button shows pending, and nothing is optimistic.
  - Refusals: 23505 or P0002 say the conflict is no longer open and link back. 42501 is denied. Anything else is failed, with a retry.
  - On success the screen invalidates a new `CONFLICT_RESOLUTION_WRITE_DEPENDENTS` list (both resolution keys) and returns to `/raspored`. There a `Notice role="status"` names what was saved (shift · date · member, accepted as uncovered). The notice comes through router state only, never the URL or storage, and is gone on navigation or reload.
- **Hours (human, 2026-10-02).**
  - `domain/hours` takes the member's accepted-uncovered `(date, teamId)` list. A matching shift's duration goes to `leaveMinutes` and out of the bands, the total and `shiftCount`. An untimed match adds nothing anywhere.
  - Web passes only `accept_uncovered` rows. The leave figure then fills on *Moji sati*, the organization table and the `.xlsx` through the existing empty-at-0 rule.
- **Calendar.** `CalendarMarks` gains `uncovered`, the admin's accepted-uncovered keys, and the grid cell for that team and date carries the existing `uncovered` modifier (hatch plus `CircleDashed`, already in the legend). Members read no organization resolutions and get no uncovered mark.
- **Docs.** In the same PR, apply sprint change §4.3's DESIGN.md, EXPERIENCE.md and UX-DR lines for decisions 15, 21, 22 and the ‹ › half of 20, only as far as this story ships them.
- Every string goes through `t()`.

**Ask First:**
- Any migration, or any change to 0031.
- Any dependency beyond `@radix-ui/react-radio-group`.

**Never:**
- No replace or amend card, no candidate list, and no computed amend date (5.4c, 5.4d).
- No *Riješeni* tab (7.16), no upcoming/past sections, and no toast.
- Never compute a collision in the database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | queue of 3, open the 2nd | "2 od 3"; ‹ and › both enabled | N/A |
| Ends | 1st / last | ‹ disabled / › disabled | N/A |
| Strip | team of 4, absent member only on leave, 12 h shift, balance 16 | "3 od 4 člana · Nepokriveno", "12 h kao godišnji", "16 dana preostalo · bez promjene" | N/A |
| No choice | press Spremi | nothing saved; hint stays | N/A |
| Accept | choose, save | row stored; queue −1 with status Notice; grid cell uncovered; *Sati* leave 12 h, band/total/shift count −12 h/−1; xlsx leave 12 | N/A |
| Untimed | accepted untimed shift | leave stays empty; shift leaves count | N/A |
| Gone | resolved meanwhile (23505) or leave removed (P0002) | "no longer open" + back link | refusal |
| Failed | network error | failure line, Spremi retries | retry |
| Missing | URL for a non-conflict | "no longer open" + back link | N/A |
| Member | member opens the URL | redirected as Raspored | guard |

## Epic AC Deviations

- **NARROWED:** "exactly three outcomes … in a fixed order". 5.4b renders one card, and 5.4c and 5.4d add theirs at fixed positions 2 and 3 (human, 2026-10-02).
- **MET for the shipped card:** the consequence strip, recording with leave hours, no bulk affordance, the `Notice`, and ‹ ›.
- **DEFERRED:** replace-candidate grouping goes to 5.4c, and the amend start date to 5.4d. Both are already ledgered.
- **DEFERRED (mockup, not an AC):** the leave author in the facts ("upisao …"), because the leave read has no author column. Ledgered in this story.

</frozen-after-approval>

## Code Map

- `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-10-01-redesign/mockups/conflicts-1.html` -- §3 :511-528 (screen), §4 :530-548 (phone and Notice), §6 :560-563 (rules). The copy is verbatim there.
- `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md:181-190, 247, 274, 292-293` and `EXPERIENCE.md:95-96, 124-125, 134, 149` -- the tokens and behaviour. The edits come from sprint change `sprint-change-proposal-2026-10-02-ux-redesign.md:154-170`. UX-DR10/11/28/29 are at `epics.md:120-143`.
- `apps/web/src/pages/raspored.tsx` -- the guard (`beforeLoad`, `mayReadMembers`) to copy. Its param precedent is `ljudi.$id.tsx:33` (`useParams`, the back link at :89-103).
- `apps/web/src/router.ts:39-82` -- register the route (code-based, no generated tree). `router.test.ts:227` `LEVEL_GUARDED_ROUTES`, :320-345 the id list, :1711 the length.
- `features/conflicts/services/conflicts-queue.ts` -- `ConflictRow` (:53) needs `memberId`, `teamId`, `shiftTypeId` and the leave record; also `queueOrderOf` (:97) and `conflictsQueueOf` (:275). `components/conflicts-list.tsx` `ConflictItem` becomes a `Link`, on the precedent of `shift-type-table.tsx:95`. `hooks/use-conflicts-queue.ts` holds the three reads to reuse.
- `features/conflicts/services/resolutions.ts` -- `ORGANIZATION_CONFLICT_RESOLUTIONS_KEY` and `MY_…`, and the parser that splits by kind.
- `features/calendar/utils/day-detail.ts:239` `dayDetailOf(...).roster` -- coverage and "rade i". Domain `leaveBalanceOf` (`leave.ts:289`); the web inputs come from `leave/services/leave-section.ts:199` `memberLeaveBaseOf`.
- Write pattern: `leave/services/leave-write.ts:304` `recordLeave`, failure mappers at :199/:214, and `use-member-leave.ts:332-348` (manual pending, `refreshAfterWrite`). The 0031 refusal codes are at `0031_conflict_resolutions.sql:64-77`. `teams/services/dependents.ts:97` takes the new list; `dependents.test.ts:128` classifies every key.
- `packages/domain/src/hours.ts` -- `MemberHoursInput` (:42), `memberHoursOfMonth` (:151), and `leaveMinutes: 0` (:211; docs at :22 and :76). Tests: `test/hours.test.ts`, where the oracle at :117 and the invariant at :125 assert 0. Update both against both fixtures. The web consumes `dist`, so rebuild it.
- Hours web: `my-hours.ts:191, 218-240, 308, 328`, `organization-hours.ts:192, 251`, `hours-export.ts:107`, and `use-hours.ts:74-140` (the resolutions are already read).
- Calendar: `utils/modifiers.ts:20, 35, 98-120, 150` (`MODIFIER_UNCOVERED`, never derived until now), `utils/month.ts:535-612` (`CalendarMarks`, `cellModifiersOf`, `gridCellMarksOf`), and `services/marks.ts:73`.
- UI: `components/ui/notice.tsx` (precedent `roster-form.tsx:252`) and `components/month-nav.tsx`. The skeleton is inline, like `conflicts-skeleton.tsx`.
- Registries:
  - `conflicts-screen.fixture.ts`: split into per-screen `*_PARTS` the way `hour-band-screens.fixture.ts` does.
  - `pages/prijava.test.ts`: Raspored `expectedControls` at :701, `strings: 9` at :2234, plus a new screen entry.
  - `test/resource-hygiene.test.ts`: `SANCTIONED_PLURAL_KEYS` :37 and `SANCTIONED_SCREEN_KEYS` :1200.
  - `eslint.config.js` `FEATURE_PUBLIC` :132, `test/key-hygiene.test.ts`.
- e2e: `e2e/pages/conflicts.page.ts` (add a resolution page object) and `e2e/tests/conflicts/conflicts-queue.spec.ts` (setup and cleanup pattern). Seeds are in `database-helper.ts` (:253, :320, :361).

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/hours.ts` and `test/hours.test.ts` -- the leave-shift input and rule, tested against both fixtures for the Accept and Untimed rows and for "no input means figures unchanged".
- [x] `apps/web/src/features/hours/services/*` and tests -- pass accept-uncovered rows per member. Cover the positive leave figure on screen and in the export.
- [x] `features/calendar/utils/month.ts`, `services/marks.ts` and tests -- the `uncovered` mark on the admin grid.
- [x] `components/ui/radio-group.tsx` and `apps/web/package.json` -- the radix primitive.
- [x] `features/conflicts/services/` -- the resolution view (facts, position, neighbours, strip) and the write with its failure mapping, each with unit tests for every service-level matrix row.
- [x] `features/conflicts/components/`, `hooks/`, `pages/raspored.$conflict.tsx` (or similar), `router.ts` -- the screen, row links, the Notice via router state, and the save flow.
- [x] `teams/services/dependents.ts` (+ test) -- `CONFLICT_RESOLUTION_WRITE_DEPENDENTS`.
- [x] `lib/i18n/locales/hr.json` and the registries.
- [x] `e2e/` -- a page object, plus specs for Open/Ends via ‹ ›, Accept end to end (queue Notice, calendar uncovered cell, *Sati* and `.xlsx` leave figure), Gone, Failed and Member.
- [x] UX docs (DESIGN.md, EXPERIENCE.md, the UX-DR lines) -- the §4.3 edits for what shipped.
- [x] `deferred-work.md` -- add the leave-author entry. `sprint-status.yaml` -- 5-4b.

**Acceptance Criteria:**
- Given the resolution screen, when only the keyboard is used, then the card is reachable and selectable by Tab/arrow/Space, and Spremi is reachable after it.
- Given a phone width (390 px), when the screen renders, then there is no horizontal scroll, the strip keeps three columns, and the footer buttons are full width.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (shared stack; no `db:reset`)
- `pnpm exec playwright test conflicts calendar hours` -- expected: green

## Suggested Review Order

**The decision and its write**

- Entry point: the save flow holds the screen until the queue re-reads, then leaves with the status line.
  [`use-conflict-resolution.ts:226`](../../apps/web/src/features/conflicts/hooks/use-conflict-resolution.ts#L226)

- The insert's refusals: 23505/P0002 mean gone, 42501 denied, the rest failed.
  [`resolution-write.ts:82`](../../apps/web/src/features/conflicts/services/resolution-write.ts#L82)

- After a gone refusal, the leave read is refreshed too, so the conflict really leaves.
  [`dependents.ts:113`](../../apps/web/src/features/teams/services/dependents.ts#L113)

**The screen's view**

- Ready, missing, loading and unavailable states; a failed read that is refetching counts as loading.
  [`resolution-screen.ts:211`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L211)

- One card for now; 5.4c and 5.4d add theirs at fixed positions.
  [`resolution-screen.ts:76`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L76)

- The card and its three-term strip.
  [`resolution-option.tsx:37`](../../apps/web/src/features/conflicts/components/resolution-option.tsx#L37)

- The Radix radio primitive: no preselection, and the ring only on the checked card.
  [`radio-group.tsx:36`](../../apps/web/src/components/ui/radio-group.tsx#L36)

- Route and admin guard.
  [`raspored.$memberId.$date.$teamId.tsx:50`](../../apps/web/src/pages/raspored.$memberId.$date.$teamId.tsx#L50)

- Status line: carried in router state, focused so it is announced, gone on navigation.
  [`conflicts-body.tsx:37`](../../apps/web/src/features/conflicts/components/conflicts-body.tsx#L37)

**Consequences**

- Hours: an accepted shift's minutes become leave and leave the bands, the total and the count.
  [`hours.ts:63`](../../packages/domain/src/hours.ts#L63)

- Only `accept_uncovered` rows feed the leave hours.
  [`resolutions.ts:298`](../../apps/web/src/features/conflicts/services/resolutions.ts#L298)

- Calendar: uncovered only where the team works a shift and the member is on its roster.
  [`month.ts:671`](../../apps/web/src/features/calendar/utils/month.ts#L671)

**Tests**

- e2e: open and navigate, accept by keyboard end to end, and every refusal.
  [`conflict-resolution.spec.ts:120`](../../e2e/tests/conflicts/conflict-resolution.spec.ts#L120)
  [`conflict-resolution.spec.ts:195`](../../e2e/tests/conflicts/conflict-resolution.spec.ts#L195)
  [`conflict-resolution.spec.ts:286`](../../e2e/tests/conflicts/conflict-resolution.spec.ts#L286)
