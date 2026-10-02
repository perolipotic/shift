---
title: 'An admin resolves a conflict by putting someone else on the shift (5.4c)'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_commit: 'e5469ec251630145325d792698369e6ca8bf959e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The resolution screen offers one outcome, "Prihvati kao nepokriveno". An admin who wants someone else to work the absent member's shift has to leave the screen, change the roster in the calendar, and the conflict then stays unresolved.

**Approach:** Add the "Zamijeni osobu" card at fixed position 2. Choosing it opens a grouped list of replacement candidates. Saving calls a new definer function, 0032. In one transaction it inserts a roster override that adds the replacement and a `replace_member` resolution linked to that override. The absent member stays rostered on leave, so the leave cost and the leave hours are the same as in 5.4b.

## Boundaries & Constraints

**Always:**
- **The override only adds (human, 2026-10-02).** `member_in_id` is the replacement and `member_out_id` is null. The absent member stays on the roster, the collision still derives, and the resolution hides it. Their balance does not change, and the shift's duration goes to their leave hours exactly as for `accept_uncovered`. The rotation is untouched.
- **Migration 0032 (human-approved).**
  - It adds `unique (organization_id, id)` on `roster_overrides`.
  - It adds `conflict_resolutions.roster_override_id uuid`. This column has a composite FK to that key, a check `(kind = 'replace_member') = (roster_override_id is not null)`, and NO column grant. The definer function is therefore the only way to write `replace_member`, and a direct insert of it gets 23514.
  - It adds `replace_conflict_member(p_member_id, p_date, p_team_id, p_replacement_id, p_reason) returns uuid`. This is `security definer`, `search_path = ''`, with grants as in 0027. The function re-checks what RLS would: an active admin of the claimed organization and a team that is not archived (42501 otherwise). It inserts the override first and then the resolution, so 0031's on-leave trigger still runs.
  - It refuses with the existing codes: 23505 (resolution key, or the replacement is already put on), P0002 (not on leave), 23514 and 23503.
- **The reason (human, 2026-10-02)** is generated at write time through `t()`, "Zamjena za {member} (godišnji)". There is no reason field.
- **Candidates** come from one exported domain-free helper in `features/calendar/utils/` that story 7.9 reuses. It takes a snapshot, the leave records, a team and a date:
  - The candidates are the members active that date, except the absent member, the members on that team's roster that date, and anyone a live override already puts on it.
  - Three groups, in this order (human, 2026-10-02):
    - `slobodan`: no working shift that date and not on leave.
    - `radi taj dan · 24 h bez pauze`: they have a working shift that date (any team).
    - `na godišnjem taj dan`: live leave covers the date. This takes precedence over the other two groups.
  - Within a group, candidates are ordered by name. Each line is `Ime · čin · položaj`, as `outOptionOf` builds it. Every candidate is selectable. A group only informs and never blocks or disables.
- **Card 2** says "Zamijeni osobu" and "Netko drugi odrađuje smjenu, a osoba na godišnjem ostaje na godišnjem."
  - Its strip shows the coverage "{covered+1} od {total} člana/članova". After a pick it also shows "· {ime}". It never says "Nepokriveno". The hours and balance terms are the same as card 1's.
  - The picker is a SIBLING after the card, because `RadioCard` is a button. It appears only while card 2 is chosen. It is labelled "Tko odrađuje smjenu", uses its own radio group, and has the group headings. Nothing in it is preselected.
- **Save.**
  - With card 2 chosen and no candidate, Spremi stays `aria-disabled`, and the hint reads "Odaberi tko odrađuje smjenu."
  - Refusals map as in 5.4b: 23505 on the resolution key or P0002 means gone, and 42501 means denied. A 23505 on the override key means the replacement is already on the shift ("taken"): the candidates re-read and the hint names it. Anything else is failed, with a retry.
  - On success the saved notice reads "Odluka je spremljena: {type} · {team} · {date} · {member}, zamjena: {replacement}." Saving invalidates the two resolution keys and `CALENDAR_KEY`.
- **Hours.** A new splitter feeds the leave hours from `accept_uncovered` AND `replace_member`, on the admin path and on the member path. The calendar's `uncovered` mark stays `accept_uncovered` only. The replacement's band hours rise through the override with no new code.
- The radio group is tested with two cards: arrow keys move the selection, and Tab reaches only the checked card (or the first one).
- Every string goes through `t()`. In the same PR, update the UX docs and the UX-DR lines for what ships.

**Ask First:**
- Any change to 0026–0031, or a second migration.
- Making the leave writes remove the linked override.

**Never:**
- No `member_out_id`, no amend card and no computed amend date (that is 5.4d).
- No blocking, disabling or recommending a candidate based on rank, position or group.
- The database computes no collision and no candidate list.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Groups | Ana off, Ivo works Dan elsewhere, Eva on leave | slobodan: Ana; radi taj dan: Ivo; na godišnjem: Eva | N/A |
| Excluded | absent member, roster member, already-added, inactive | not listed | N/A |
| Strip | team of 4, pick Dino | "4 od 4 člana · Dino Grgić", "12 h kao godišnji", "16 dana preostalo · bez promjene" | N/A |
| No pick | card 2, no candidate, Spremi | nothing saved; candidate hint | N/A |
| Replace | pick, save | override + linked resolution; queue −1 + Notice; Dino on the day roster, no uncovered mark; Dino's band hours +12 h; absent member's leave hours 12 h | N/A |
| Leave pick | pick Eva | saved; Eva's own new conflict appears in the queue | N/A |
| Taken | Dino added meanwhile (23505 roster key) | taken line, candidates re-read | refusal |
| Gone | resolved meanwhile / leave removed | "no longer open" + back | refusal |
| Direct insert | client inserts `replace_member` | 23514 | DB |
| Atomic | resolution insert refused inside the function | no override row left | DB |

## Epic AC Deviations

- **NARROWED:** "exactly three outcomes". After 5.4c there are two cards, and 5.4d adds the third.
- **REINTERPRETED:** FR-50 "replacing the absent Member". The override adds the replacement and does not take the absent member off the roster (human, 2026-10-02), so that the balance stays unchanged and the absent member's hours count as leave hours, as the mockup and CAP-16 state.
- **WIDENED:** the epic names two candidate groups. The third group, `na godišnjem taj dan`, is the FR-50 leave warning (human, 2026-10-02).
- **DEFERRED:** removing the linked override later leaves the resolution live. This is already ledgered for 5.5.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0027_remove_roster_override.sql` -- the definer template (claim, `current_member_access()`, errcodes, revoke/grant). `0026_roster_overrides.sql:128-134` holds the live keys and `:162` the insert policy to re-check. `0031_conflict_resolutions.sql` holds the trigger and the live key.
- `features/conflicts/services/resolution-screen.ts`:
  - `RESOLUTION_OPTIONS` :76. The card ids :84-88 need a second set.
  - `ResolutionView` :125 gets the candidates and the replace strip.
  - `ResolutionSaved` :116 and `resolutionSavedOf` :513, together with `resolutionSavedMessageKey` :536, widen to the replace kind plus the replacement's name.
  - `resolutionScreenFrom` :322, where coverage is at :416.
- `resolution-write.ts` -- `acceptUncovered` :93 and the mapper :82. Add a `replaceMember` rpc call (style of `roster-write.ts:191`) and the taken mapping.
- `hooks/use-conflict-resolution.ts` -- `save` :189 branches on the choice, and it gains candidate state.
- `components/resolution-option.tsx` :37, `conflict-resolution-body.tsx` :131-165, `components/ui/radio-group.tsx` :39-55, and `conflicts-body.tsx:37` (the Notice).
- `features/calendar/utils/day-detail.ts` -- the candidate rules in `rosterOffersOf` :658. Use `memberScheduleOfMonth` via `memberScheduleInputOf` (`month.ts:952`) for "works that date". The line comes from `outOptionOf` :940 and `rosterLineOf` (`members/utils/position.ts:167`), with rank at `rank.ts:202/226`. `onLeave` is in `resolution-screen.ts:228`.
- `features/conflicts/services/resolutions.ts:298` `acceptedUncoveredOf`. Its consumers are `hours/services/hours-conflicts.ts:133-147` (switch to the new leave-hours splitter) and `calendar/services/marks.ts:115` (keep as is).
- `teams/services/dependents.ts:113` -- a replace list with `CALENDAR_KEY`, plus `dependents.test.ts`.
- Registries:
  - `hr.json` `raspored.resolution.*`;
  - `test/resource-hygiene.test.ts` (`SANCTIONED_SCREEN_KEYS` :1215, `SANCTIONED_PLURAL_KEYS` :120);
  - `pages/prijava.test.ts` (resolution `expectedControls` :724, string counts :2277-2299, `KEY_SOURCES` :2747);
  - `conflicts-screen.fixture.ts` `CONFLICT_RESOLUTION_PARTS`.
- DB tests (local stack, `pnpm test`):
  - `test/provisioning.test.ts` :1771/:1901 (the definer list and its grants);
  - `test/rls-isolation.test.ts` :1165-1260 (the function list) and the 5.4a block :17767;
  - `test/supabase-scaffold.test.ts` (the static blocks per migration, the function counts at :2192, and 0031 at :2298-2460).
- e2e:
  - `e2e/tests/conflicts/conflict-resolution.spec.ts` (`scenarioOf` ≈:85, cleanup in `afterEach`);
  - `e2e/pages/conflicts.page.ts:70` `ConflictResolutionPage`;
  - `e2e/utils/database-helper.ts` `seedRosterOverride` :921 and `seedConflictResolution` :361. Its `replace_member` seeding now needs an override id.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0032_replace_conflict_member.sql` -- the unique key, the column, the check and the function. Extend the scaffold, provisioning and rls tests with: the direct-insert 23514, an atomic rollback, the admin and archived refusals, the taken 23505, and the link row.
- [x] `features/calendar/utils/` (helper and test) -- the grouped candidates, covering the Groups and Excluded rows.
- [x] `features/conflicts/services/` and tests -- the option list, the view (candidates and strip), the saved kind, the rpc write and its mapping, and the leave-hours splitter.
- [x] `hours/services/hours-conflicts.ts` and test -- `replace_member` feeds the leave hours on both paths.
- [x] `features/conflicts/components/` and `hooks/` -- card 2, the picker, the save branch and the Notice.
- [x] `teams/services/dependents.ts` and test, `hr.json`, and the registries.
- [x] `e2e/` -- the page object, plus specs for: replace by keyboard end to end (queue Notice, day roster, *Sati* for both members), arrow keys across two cards, Taken, and Gone. Update `seedConflictResolution`.
- [x] UX docs and the UX-DR lines. `deferred-work.md`: mark the 5.4c entry and the two-card test entry resolved. `sprint-status.yaml`: 5-4c.

**Acceptance Criteria:**
- Given the resolution screen, when only the keyboard is used, then the admin can choose card 2, reach and pick a candidate, and save.
- Given 390 px, when the picker is open, then there is no horizontal scroll and every candidate line wraps rather than truncating.

## Design Notes

Why the override only adds: `leaveCostOf` and `memberHoursOfMonth` both follow the effective roster. A `member_out_id` would stop charging the leave day (balance +1) and would drop the absent member's 12 h altogether. Both contradict the mockup's "16 dana preostalo · bez promjene" and "12 h kao godišnji".

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (shared stack, apply 0032 with `supabase migration up`; no `db:reset`)
- `pnpm exec playwright test conflicts calendar hours` -- expected: green

## Suggested Review Order

**The atomic write**

- Entry point: one definer call checks the key, adds the replacement, then links the resolution.
  [`0032_replace_conflict_member.sql:102`](../../supabase/migrations/0032_replace_conflict_member.sql#L102)

- A live resolution answers plain 23505 before the override can claim "taken".
  [`0032_replace_conflict_member.sql:167`](../../supabase/migrations/0032_replace_conflict_member.sql#L167)

- Client call: the reason is clipped to 0026's 200 characters, and the two 23505s are told apart.
  [`resolution-write.ts:175`](../../apps/web/src/features/conflicts/services/resolution-write.ts#L175)
  [`resolution-write.ts:132`](../../apps/web/src/features/conflicts/services/resolution-write.ts#L132)

**Candidates**

- The one grouping helper 7.9 reuses: free, working that day, on leave.
  [`replacement-candidates.ts:79`](../../apps/web/src/features/calendar/utils/replacement-candidates.ts#L79)

**The screen**

- The save branch writes a replacement only while card 2 is chosen.
  [`use-conflict-resolution.ts:267`](../../apps/web/src/features/conflicts/hooks/use-conflict-resolution.ts#L267)

- The pick is dropped when the choice leaves card 2.
  [`use-conflict-resolution.ts:199`](../../apps/web/src/features/conflicts/hooks/use-conflict-resolution.ts#L199)

- Hint and focus cover no choice, no pick, and nobody to pick.
  [`resolution-screen.ts:503`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L503)
  [`resolution-screen.ts:535`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L535)

- Card 2 and its strip: covered + 1, never "Nepokriveno".
  [`resolution-option.tsx:85`](../../apps/web/src/features/conflicts/components/resolution-option.tsx#L85)

- The picker is a sibling radio group, since a card is a button.
  [`replacement-picker.tsx:33`](../../apps/web/src/features/conflicts/components/replacement-picker.tsx#L33)
  [`radio-group.tsx`](../../apps/web/src/components/ui/radio-group.tsx)

**Consequences**

- Leave hours come from accepted and replaced keys; the uncovered mark stays accept-only.
  [`resolutions.ts:324`](../../apps/web/src/features/conflicts/services/resolutions.ts#L324)
  [`hours-conflicts.ts:141`](../../apps/web/src/features/hours/services/hours-conflicts.ts#L141)

- A replace also refreshes the calendar snapshot, so the queue sees the new override.
  [`dependents.ts`](../../apps/web/src/features/teams/services/dependents.ts)

**Tests**

- DB: link row, direct-insert 23514, rollback, refusals, taken versus exists.
  [`rls-isolation.test.ts:18402`](../../test/rls-isolation.test.ts#L18402)

- e2e: arrow keys, keyboard replace end to end, taken, phone, pick dropped, leave pick.
  [`conflict-resolution.spec.ts:417`](../../e2e/tests/conflicts/conflict-resolution.spec.ts#L417)
  [`conflict-resolution.spec.ts:455`](../../e2e/tests/conflicts/conflict-resolution.spec.ts#L455)
  [`conflict-resolution.spec.ts:634`](../../e2e/tests/conflicts/conflict-resolution.spec.ts#L634)
