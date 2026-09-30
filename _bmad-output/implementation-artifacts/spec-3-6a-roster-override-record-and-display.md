---
title: 'Story 3.6a: A roster override is recorded and shown'
type: 'feature'
created: '2026-09-30'
status: 'done'
review_loop_iteration: 1
baseline_commit: '0cf9082ec710488899d2032eef9bcb268aecba1b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-5a-shift-type-override-record-and-display.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-5c-override-disposition-on-rotation-change.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A shift's roster is always the team's default (CAP-12). Nothing can record that a member was taken off a shift, put on another team's shift, or replaced, so hours cannot follow who actually worked.

**Approach:** Add a `roster_overrides` table: one row per action, taking a member off and/or putting one on a (team, date) shift, so a replace is one atomic row. The domain layers in-force overrides over `shiftRoster` and over a member's month. The calendar shows the existing `✎`, and the day detail lists each change. The human decided on 2026-09-30: split into 3.6a (record + display, only seeds and fixtures write) and 3.6b (the admin form + removal); reuse `✎`; reuse 3.5c's derived pending rule, with builder disposition deferred.

## Boundaries & Constraints

**Always:**
- **Migration `0026_roster_overrides.sql`**, copying 0019:
  - Columns: `organization_id` first, then `id`, `team_id`, `date`, `member_out_id`, `member_in_id`, `reason`, `created_by default auth.uid()`, `created_at default now()`, `removed_by`, `removed_at`.
  - Composite FKs to `teams` and `members` on `(organization_id, …)`.
  - 0019's date, reason and removal-pair checks, plus: at least one member set, and the two members distinct.
  - Partial unique indexes on live rows: `(organization_id, team_id, date, member_out_id)` and `(organization_id, team_id, date, member_in_id)`.
  - Policies: admin-only select, and admin insert `WITH CHECK (created_by = auth.uid())` on a non-archived team. Insert grant on the six writable columns only; no update or delete grant.
  - `calendar_roster_overrides()`, a definer read shaped like 0022's `calendar_shift_type_overrides()`. It returns live rows as `(id, team_id, date, member_out_id, member_in_id, reason, created_at, author_member_id)`, and never `created_by`.
- **Domain (`packages/domain`):**
  - `RosterOverride { id, teamId, date, memberOutId, memberInId }`.
  - An override **applies** on a (team, date) whose scheduled type is working. Its out-member must be on the default roster. Its in-member must not be on it, and must be active on the date. Anything else is inert. The in-member's own team may work that date too, which is a double shift: the member's day shows both shifts.
  - `rosterOn(members, overrides, teamId, date)` returns the roster (entries flag `added`; an added member's `position` is `null`), the removed member ids, and the applied overrides.
  - `ScheduleInput` and `MemberScheduleInput` gain `rosterOverrides` and `workingShiftTypeIds`, and `ScheduleInput` also gains `members`. `ScheduleCell` gains `rosterChanged`.
  - `MemberScheduleDay` becomes `{ date, shifts }`. Each shift carries `teamId`, the type fields, `overridden`, `rosterChanged` and `viaOverride`. A working own-team shift the member was taken off is dropped, and an added shift appears.
  - `overrideStandingOf` is loosened to `{ id, teamId, date, writtenAt }`. The one-per-(team, date) check moves to the shift-type callers. A roster override's `writtenAt` is `createdAt`. Only `inForce` roster overrides reach any rule.
- **Snapshot:** a third rpc in `readCalendar`'s `Promise.all`, under `CALENDAR_KEY`. A bad row gives the refusal `'rosterOverride'`. `CalendarSnapshot.rosterOverrides` holds `{ id, teamId, date, memberOutId, memberInId, reason, createdAt, authorMemberId }`.
- **Calendar:**
  - A cell's `✎` is `overridden || rosterChanged`, OR-ed at the `cellOf` call sites.
  - The day list and the person view render one row per shift.
  - Day detail: the roster follows `rosterOn`. A "Promjene sastava" block lists every applied change as added, removed or replaced, with author, time and reason. A pending one is listed under "Promjena sastava čeka pregled".
  - Copy: `kalendar.detail.rosterChange.{heading,added,removed,replaced,pendingHeading}`, which read "Promjene sastava", "Dodano: {name}", "Uklonjeno: {name}", "Zamjena: {out} → {in}" and "Promjena sastava čeka pregled". Author, time and reason reuse `kalendar.detail.override.{author,unknownAuthor,savedAt,reason}`, and an unknown member name reads `unknownAuthor`. Register everything under "story 3.6a".
- **Seeds:** one pilot replace and one UJ-5 add in `seed.sql`, and one replace in the demo. Update every inventory, count and fingerprint.

**Ask First:**
- any app write path;
- an update or delete policy;
- a new modifier or legend entry;
- `confirmed_*` columns or builder disposition;
- exposing `auth_user_id`.

**Never:**
- a write to a rotation, membership or status row;
- a trigger;
- a second query key;
- roster derivation in `apps/web`;
- `destructive` or the accent;
- 3.6b's form;
- new dependencies or render tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Replace | Alfa works D; out A, in B | Alfa's roster has B, not A; `✎`; detail "Zamjena: A → B"; A's month drops D, B's month gains Alfa on D | N/A |
| Add only | in C (whose team is off on D) | C on the roster; C's day shows Alfa's shift | N/A |
| Inactive in | in C, inactive on D | inert: roster unchanged, no `✎` | N/A |
| Double shift | in C, whose own team also works D | C on Alfa's roster; C's day shows both shifts | N/A |
| Remove only | out A | A missing; A's day on D is empty | N/A |
| Inert | out a non-member, or the day is off | roster and cell unchanged, no `✎` | N/A |
| Pending | override written before a newer rotation version | not applied; listed as pending | N/A |
| None | no roster overrides, both fixtures | every roster = `shiftRoster`, every month unchanged | N/A |
| Removed | `removed_at` set | not returned by the rpc; default roster exactly | N/A |
| Member / other org / anon | member selects or inserts; org-B token; anon | table 0 rows, rpc rows; insert refused; rpc 0 rows; no execute | 42501 |
| Bad shape | both members null, or out = in; blank reason | refused | 23514 |
| Duplicate live | same member out twice on one (team, date) | refused | 23505 |
| Foreign member | member of org B | refused | 23503 |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0019_shift_type_overrides.sql`:
  - table :46-94; checks :86-93; live index :103; policies :112-159 (the `current_member_access()` pattern); grants :169-174.
  - `0022_…:208-253`: the latest calendar read to copy. `0002:157` and `0009:51` hold the `(organization_id, id)` keys.
- `packages/domain/src/roster.ts`: `shiftRoster` :134 (doc :10 promises 3.6). `overrides.ts`: `keyOf` :49, `overridesByTeamAndDate` :59, `overrideStandingOf` :174-208 (the constraint and the uniqueness call :192 must loosen; error text :197). `schedule.ts`: `ScheduleCell` :44, doc :10-11, `scheduleOfMonth` :130, `MemberScheduleDay` :173, `memberScheduleOfMonth` :196, `cellOf` :222. `index.ts` blocks :44-52, :67-78, :80-89.
- Domain tests: `overrides.test.ts` (FIXTURES :32, none = projection :55, all pending :359), `roster.test.ts:121,232`, `schedule.test.ts:101,201`, `fixtures.ts` (pilot :100-118, UJ-5 :127-145).
- `apps/web/src/features/calendar/`:
  - `services/snapshot.ts`: key :90, rpc names :108-111, `Promise.all` :366, `CalendarOverride` :187, `CalendarSnapshot` :227-262, `overridesOf` :532.
  - `utils/month.ts`: `overrideStandingOfCalendar` :78 (add a roster twin), `cellOf` :623 (✎ :657), `calendarDayListOf` :696-728, `CalendarDay` :525, `calendarMonthOf` :785-846.
  - `utils/day-detail.ts`: `DayDetail` :108-128, `dayDetailOf` :147-211 (roster :194), `authorNameOf` :230, `overrideOf` :268.
  - `components/day-detail-dialog.tsx`: `renderRoster` :33, `renderOverride` :65, `renderPending` :98, `renderDetail` :123.
  - `components/calendar-day-list.tsx`: `renderDay` :48, legend :104.
- Guards in `snapshot.test.ts`: call list :112-115; `:189` bans `override` in `CALENDAR_COLUMNS` (so use an rpc); `SNAPSHOT_CARRIES`/`DETAIL_CARRIES`/`SCREEN_SHOWS` :964-993; the modifier source rule :1046-1070 (keep the one `modifiers:` ternary); `.rpc(` count :1079; one `queryKey` :1109.
- DB inventories:
  - `test/supabase-scaffold.test.ts`: contiguity :91, policy list :306/:379, override blocks :1731-1996.
  - `test/rls-isolation.test.ts`: policies :1055, functions :1122-1200, the 3.5a matrix :14301-14758 to copy.
  - `test/provisioning.test.ts`: RLS tables :780, privileges :1288, FKs :1317, definers :1564, execute grantees :1650-1720.
  - `test/demo-organization.test.ts`: :182, :228, :350, :524, :545, :659.
- Seeds: `supabase/seed.sql` (order :44-50, overrides :289, :543); `supabase/operator/demo-organization.sql:292`.
- i18n: `hr.json` `kalendar.detail` :55-100; `test/resource-hygiene.test.ts` sanctioned keys (3.5c block ends :1011); `test/localization-applied.test.ts:310,333`; `apps/web/src/pages/prijava.test.ts` Kalendar `strings` :1984, lengths :2356.
- E2E: `e2e/utils/database-helper.ts` `seedShiftTypeOverride` :377 (pg as postgres), cleanup :553; `e2e/pages/calendar.page.ts` :255-294; `e2e/tests/calendar/calendar.spec.ts` (detail :563, override :767, person filter :1188).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0026_roster_overrides.sql` -- table, checks, indexes, policies, grants, rpc -- the record
- [x] `test/supabase-scaffold.test.ts`, `rls-isolation.test.ts`, `provisioning.test.ts` -- inventories plus the DB matrix rows -- refusals proven
- [x] `packages/domain/src/{roster,overrides,schedule,index}.ts` + tests -- `rosterOn`, the applies rule, `rosterChanged`, member shifts, the loosened standing; none = default and all pending = default on both fixtures -- the rule
- [x] `supabase/seed.sql`, `operator/demo-organization.sql`, `test/demo-organization.test.ts` -- seeded overrides and counts
- [x] `calendar/services/snapshot.ts`, `utils/month.ts`, `utils/day-detail.ts` + tests -- the read, `✎`, shifts per day, the detail -- web matrix rows
- [x] `components/day-detail-dialog.tsx`, `calendar-day-list.tsx`, `hr.json`, the hygiene, localization and prijava inventories -- blocks and copy
- [x] `e2e/utils/database-helper.ts`, `e2e/pages/calendar.page.ts`, `e2e/tests/calendar/calendar.spec.ts` -- seed a replace on Alfa today: `✎` at 1280 px; the detail roster and change block; B's Moj raspored at 390 px shows Alfa's shift; the person filter on A lacks it -- the flow
- [x] `sprint-status.yaml` -- `3-6-…` in-progress, with a split comment

**Acceptance Criteria:**
- Given any roster override, when it is written, then pattern, assignment, membership and status rows are byte-identical before and after (CAP-12, DI-2).
- Given every roster override removed or pending, when the month renders, then every roster and every member's month equals the default derivation exactly.

## Spec Change Log

- **2026-09-30, review loop 1 (intent gaps resolved by the human).** Trigger: the review found that a member inactive on the date could be put on a shift (a test pinned it), and that a double shift was neither allowed nor refused by the rule. Amended: the applies rule now requires the in-member to be active on the date, and it explicitly allows a double shift. Two matrix rows were added. Known-bad state avoided: a deactivated member shown working a shift. The human chose to keep the implemented code and patch it rather than re-derive it. KEEP: the one-row-per-action table, `rosterOn`, `{ date, shifts }` member days, the extra `memberId`/`members` inputs to `MemberScheduleInput`, the loosened `overrideStandingOf`, and the 3.6a RLS matrix.

## Design Notes

One row per action makes a replace atomic without a function, and 3.6b's plain insert attributes itself through the defaults. Epic 5's `conflict_resolutions` can reference the row's id. The applies rule keeps a stale override inert rather than wrong: an off day, or someone already off the roster, is left unchanged. 3.6b's form offers only changes that apply. Known limit: an inert override is not shown anywhere. That is acceptable while only seeds write, and 3.6b's removal will list it.

```ts
rosterOn(members, [{ id, teamId: 'alfa', date, memberOutId: 'a', memberInId: 'b' }], 'alfa', date)
// → { roster: [..., { memberId: 'b', position: null, added: true }], removed: ['a'], applied: [that one] }
```

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips
- `pnpm test:e2e` -- green; stop Vite on 5173 first
- `git diff --stat package.json pnpm-lock.yaml` -- empty

**Manual checks:**
- Demo org at 390 and 1280 px, in light and dark: the `✎` cell, the detail's change block, and the added member's Moj raspored.

## Suggested Review Order

**The record**

- Entry point: one row per action; a replace is one row with both members.
  [`0026_roster_overrides.sql:52`](../../supabase/migrations/0026_roster_overrides.sql#L52)

- At least one member, two distinct members, 0019's reason and removal checks.
  [`0026_roster_overrides.sql:111`](../../supabase/migrations/0026_roster_overrides.sql#L111)

- One live change per member taken off, and one per member put on, per shift.
  [`0026_roster_overrides.sql:128`](../../supabase/migrations/0026_roster_overrides.sql#L128)

- Admin-only select and attributed insert on a non-archived team; six insertable columns.
  [`0026_roster_overrides.sql:162`](../../supabase/migrations/0026_roster_overrides.sql#L162)

- Members read live rows through a definer; the author as a member id.
  [`0026_roster_overrides.sql:212`](../../supabase/migrations/0026_roster_overrides.sql#L212)

**The rule in the domain**

- Applies only if the change is real: out on the roster, in off it and active.
  [`roster.ts:265`](../../packages/domain/src/roster.ts#L265)

- The shift's roster: default, minus those taken off, plus those put on.
  [`roster.ts:294`](../../packages/domain/src/roster.ts#L294)

- Team cells get `rosterChanged` only on working days an override applies to.
  [`schedule.ts:192`](../../packages/domain/src/schedule.ts#L192)

- A member's day is now a list of shifts: dropped, added, or both (double shift).
  [`schedule.ts:277`](../../packages/domain/src/schedule.ts#L277)

- 3.5c's pending rule, loosened to any override keyed by team and date.
  [`overrides.ts:187`](../../packages/domain/src/overrides.ts#L187)

**Reading and showing it**

- A third rpc beside the others, under the one `CALENDAR_KEY`; its own refusal.
  [`snapshot.ts:590`](../../apps/web/src/features/calendar/services/snapshot.ts#L590)

- Pending roster overrides by the same stamp rule; shift-type uniqueness kept.
  [`month.ts:91`](../../apps/web/src/features/calendar/utils/month.ts#L91)

- The one `✎`: shift type overridden or roster changed, OR-ed at the call sites.
  [`month.ts:909`](../../apps/web/src/features/calendar/utils/month.ts#L909)

- The detail's roster comes from `rosterOn`; changes and pending listed apart.
  [`day-detail.ts:255`](../../apps/web/src/features/calendar/utils/day-detail.ts#L255)

- The "Promjene sastava" and "čeka pregled" blocks.
  [`day-detail-dialog.tsx:153`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L153)

- One opener per shift in the day list; the legend reads every shift.
  [`calendar-day-list.tsx:69`](../../apps/web/src/features/calendar/components/calendar-day-list.tsx#L69)

**Peripherals**

- Rule tests: replace, add, remove, inert, inactive, double shift, all pending.
  [`roster-overrides.test.ts:232`](../../packages/domain/test/roster-overrides.test.ts#L232)

- DB matrix: attribution, byte-identical rows, member/inactive/foreign/anon, shape refusals.
  [`rls-isolation.test.ts:15400`](../../test/rls-isolation.test.ts#L15400)

- E2E: replacement at 1280 px, person filter, double shift, pending block.
  [`calendar.spec.ts:905`](../../e2e/tests/calendar/calendar.spec.ts#L905)

- Demo puts on a firefighter whose crew is off today, derived from the rotation.
  [`demo-organization.sql:325`](../../supabase/operator/demo-organization.sql#L325)

- Seeds: a pilot replacement and a UJ-5 addition.
  [`seed.sql:315`](../../supabase/seed.sql#L315)

- The seed helper refuses a missing or ambiguous member name.
  [`database-helper.ts:478`](../../e2e/utils/database-helper.ts#L478)

- Copy: `kalendar.detail.rosterChange.*`.
  [`hr.json:62`](../../apps/web/src/lib/i18n/locales/hr.json#L62)
