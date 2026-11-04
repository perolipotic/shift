---
title: 'Story 11.1: The staffing rule and the minimum-members setting'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '661a1850c7297b2be9e8bcc8c7e346804a9de69e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing tells an admin that a working shift has fewer people than it needs. There is no rule for that, and the organization has no setting to say how many people a shift needs. Stories 11.2–11.4 report short-staffed shifts and need both.

**Approach:** Add a pure `domain/staffing` module (R10.1–R10.5). It counts the people at work on a working shift and returns `SHORT_STAFFED` codes for a window, plus the shifts a change would newly make short-staffed. Add a nullable `organizations.minimum_members` column, current-state (AD-2), edited on *Organizacija* as *Najmanje ljudi u smjeni*. The demo seed sets 3. Nothing calls the rule yet.

## Boundaries & Constraints

**Always:**
- People at work = `rosterOn` (the roster after roster overrides, replacements included) minus each member on that list whose leave record of any type covers the date. A member taken off the shift is not subtracted twice.
- Short-staffed means: the scheduled type is a working type, and people at work < minimum. A non-working day, a team with no rotation yet, and a minimum of `null` are never short-staffed.
- Results are plain data (AD-8): `{ code: 'SHORT_STAFFED', date, teamId, shiftTypeId, atWork, minimum }`, ordered by date, then team. No prose, no names.
- Reuse `scheduleOfMonth`, `rosterOn` and `CollisionLeaveRecord` rather than re-deriving the schedule or the roster (AD-7).
- Never read rank or position (FR-18a). Assert this with a source scan, as `warnings.test.ts:269` does.
- The column is `smallint`, nullable, with `check (minimum_members >= 1)` and its own `grant update (minimum_members)`. There is no default (DI-8).
- The client sends only this column. It refuses an entry that is not a whole number from 1 to 32767 before writing. An empty field saves `null`.
- The new migration is `0048_minimum_members.sql`.

**Ask First:**
- Any change to how existing collision, leave or roster functions behave.
- Placing the rule's result in any surface's snapshot or UI beyond *Organizacija*.

**Never:**
- No reporting surface (*Što se mijenja*, the calendar mark, the *Danas* card, the `warning` token). Those are stories 11.2–11.4.
- Never store a derived count (AD-1). No blocking.
- Never run `supabase db reset` on the shared stack.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| R10.5 one on leave | team of 4 on a working shift, minimum 3, 1 on leave | atWork 3, not short | N/A |
| R10.5 two on leave | as above, 2 on leave | one `SHORT_STAFFED`, atWork 2, minimum 3 | N/A |
| R10.5 replaced | 2 on leave, one replaced by an override | atWork 3, not short | N/A |
| Setting empty | minimum `null` | nothing, ever | N/A |
| Replacement on leave | the member put on is also on leave | not counted | N/A |
| Non-working / no rotation | Slobodno, or before the first version | never short | N/A |
| Deactivated member | inactive from a date | absent from later rosters; a shift can become short | N/A |
| Newly short | before: atWork 3; after: atWork 2 | reported. A shift short in both is not reported; one short only before is not reported | N/A |
| Bad window | `to < from`, or a non-calendar date | — | `RangeError` naming the value |
| Setting saved | `3`, or an empty field | stored `3`, or `null`; the card shows the value or that it is not set | N/A |
| Setting refused | `0`, `-1`, `2.5`, `abc`, `40000` | nothing is sent; the field is marked and focused | client check. A server 23514 on `organizations_minimum_members_check` maps to the field |
| Restored old cache | a cached organization without the field | read as not set | N/A |

## Epic AC Deviations

- *"people at work = … (R10.1)"*: R10.1 also says a member on a half-day record counts as at work. Half-day records do not exist until story 13.5. The rule counts every leave record as absent today, and 13.5 must keep half days counted as at work. A `deferred-work.md` entry hands this to 13.5.
- *"empty reports nothing"*: there are no reporting surfaces in 11.1. This is asserted at the domain level: `null` yields no results. Stories 11.2–11.4 assert it on their surfaces.
- R10.4's operand `team` is named `teamId`, as `Collision` names it, and `shiftTypeId` is added. This keeps the result ids-only (AD-8).

</frozen-after-approval>

## Code Map

- `packages/domain/src/collisions.ts` -- the template module: the header-doc style, the `CollisionLeaveRecord` and `CollisionInput` shapes, the ordering, and the `erasedCollisionsOf` before/after diff to mirror.
- `packages/domain/src/schedule.ts:160` `scheduleOfMonth`, `datesOfMonth`, `monthOf`, `adjacentMonth` -- each cell's scheduled `shiftTypeId` per team and date.
- `packages/domain/src/roster.ts:294` `rosterOn` -- the roster after overrides; `added` entries are replacements. Call it only for a working shift.
- `packages/domain/src/leave.ts` `checkRange`; `calendar.ts` `checkDate`.
- `packages/domain/src/index.ts` -- the export list. The new module goes there.
- `packages/domain/test/fixtures.ts` -- the pilot fixture (4 teams, Dan/Noć/Slobodno/Slobodno) and the UJ-5 fixture (3 teams, a 5-step cycle). `collisions.test.ts:40-60` shows the `FIXTURES` `describe.each` pattern.
- `supabase/migrations/0044_notification_settings.sql:172-178` -- the precedent for adding an organization column and its grant. `0004_organization_settings.sql:126` covers the column-grant model.
- `apps/web/src/features/organization/`:
  - `services/snapshot.ts`: select list :118; the type :162 and its `never` variants; `isEmailNotificationsEdit` :377; parse :576-605; edit columns :649; `ORGANIZATION_CONSTRAINT_FIELDS` :527.
  - `hooks/use-organization-settings.ts`: openers :146; `saveEmailNotifications` :437.
  - `components/organization-email-notifications-card.tsx`: the card and dialog to copy.
  - `organization-settings-card.tsx:80-87`: the card order.
  - `utils/dialogs.ts`, `utils/element-ids.ts`.
- `apps/web/src/features/members/services/write.ts:299` `enteredAllowance` -- the number-field parser precedent.
- `apps/web/src/lib/i18n/locales/hr.json` around :1052 -- the `organization.*` keys.
- `supabase/seed.sql:58`, `supabase/operator/demo-organization.sql:103` -- the organization inserts.
- Inventories that pin organization columns, keys and screens:
  - `test/supabase-scaffold.test.ts:905-920,1245`;
  - `test/rls-isolation.test.ts:2244-2263` (column privileges);
  - `test/demo-organization.test.ts:113,294-308`;
  - `test/provisioning.test.ts`;
  - `apps/web/src/pages/structural-pins-settings.test.ts`, `key-sources.fixture.ts`, `source-guards.fixture.ts`;
  - `test/resource-hygiene.test.ts`.
- `e2e/tests/organization/`, `e2e/pages/organization.page.ts` -- the organization E2E.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/staffing.ts` -- `StaffingInput` (the `ScheduleInput` fields, `leaveRecords`, `minimumMembers: number | null`), `peopleAtWorkOn(input, teamId, date)` (`null` when the shift is not working), `shortStaffedShiftsOf(input, from, to)`, `newlyShortStaffedOf(before, after, from, to)`, and `SHORT_STAFFED` -- R10.1–R10.4 in one place.
- [x] `packages/domain/src/index.ts` -- export them.
- [x] `packages/domain/test/staffing.test.ts` -- every matrix row of the domain, R10.5 under both fixtures, and the scan for rank, position and text.
- [x] `supabase/migrations/0048_minimum_members.sql` -- the column, the check and the grant.
- [x] `supabase/seed.sql` -- pilot 3, UJ-5 empty. `supabase/operator/demo-organization.sql` -- 3.
- [x] `apps/web/src/features/organization/**` -- the snapshot field `minimumMembers: number | null`, the edit write, the constraint-to-field mapping, a parser `enteredMinimumMembers`, `saveMinimumMembers`, and an `OrganizationMinimumMembersCard` with its dialog. The card goes after *Obavijesti e-poštom* and before *Satni pojasi*.
- [x] `hr.json` -- the card, field, empty-state, hint and refusal keys.
- [x] Inventories in the Code Map, plus unit tests for the parser and the snapshot parse, and an RLS test: an admin writes, a member is refused, the check refuses 0.
- [x] `e2e/tests/organization/*.spec.ts` -- set 3, clear it, and refuse 0. CI runs it, not local.
- [x] `ARCHITECTURE-SPINE.md` -- the AD-2 row *Minimum members | Current-state | FR-70: changing it re-reports past dates, as hour bands do* with an `Amended 2026-11-04 (story 11.1)` clause, and a CAP-21 row in the capability map.
- [x] `EXPERIENCE.md` :47 and :110 -- the new card.
- [x] `deferred-work.md` -- the 13.5 half-day entry (written during planning).

**Acceptance Criteria:**
- Given both fixtures, when `pnpm --filter @shift/domain test` runs, then R10.1–R10.5 hold. Rank and position are never read.
- Given *Organizacija*, when an admin saves 3, clears it, or enters 0, then the stored value is 3, then `null`, and the 0 is refused with nothing written.
- Given a member session, when it PATCHes `minimum_members`, then the write is refused.
- Given the merged change, then the spine's AD-2 table carries the minimum-members row.

## Spec Change Log

## Design Notes

The window is an inclusive `from`–`to` date range, not a month, because 11.2 diffs a change's range and 11.4 counts "ahead". The domain walks the months with `scheduleOfMonth`. It takes no range cap: callers bound the range, as `leaveRecordsFrom` callers do.

```ts
shortStaffedShiftsOf({ ...pilot, leaveRecords: twoOnLeave, minimumMembers: 3 }, '2026-10-14', '2026-10-14')
// → [{ code: 'SHORT_STAFFED', date: '2026-10-14', teamId: 'pilot-smjena-b', shiftTypeId: 'pilot-dan', atWork: 2, minimum: 3 }]
```

The UI parse treats a missing field as `null`, so a cache restored offline from before 0048 reads as not set. The migration must deploy before the SPA, because the select list names the new column.

## Verification

**Commands:**
- `pnpm --filter @shift/domain test && pnpm lint && pnpm typecheck` -- expected: all green.
- `pnpm test` -- expected: green. DB suites need 0048 on a stack. Apply it with `supabase migration up` only on a stack you own, never a reset of the shared one. Otherwise CI is the gate.

## Suggested Review Order

**The staffing rule (domain)**

- Entry point: people at work = roster after overrides minus those on leave.
  [`staffing.ts:144`](../../packages/domain/src/staffing.ts#L144)

- Short-staffed only on working shifts; a null minimum reports nothing.
  [`staffing.ts:181`](../../packages/domain/src/staffing.ts#L181)

- The change report for 11.2: matched by team and date, not type.
  [`staffing.ts:213`](../../packages/domain/src/staffing.ts#L213)

- One working shift's count, for day detail and previews later.
  [`staffing.ts:163`](../../packages/domain/src/staffing.ts#L163)

**The setting (schema)**

- Nullable smallint, named check `>= 1`, its own column grant.
  [`0048_minimum_members.sql:27`](../../supabase/migrations/0048_minimum_members.sql#L27)

- Pilot seeds 3, UJ-5 stays empty; the demo sets 3.
  [`seed.sql:58`](../../supabase/seed.sql#L58)

**The setting (Organizacija)**

- Invalid entry refused locally through the same refusal path; nothing sent.
  [`use-organization-settings.ts:461`](../../apps/web/src/features/organization/hooks/use-organization-settings.ts#L461)

- Digits only, 1–32767, empty is null.
  [`minimum-members.ts:23`](../../apps/web/src/features/organization/utils/minimum-members.ts#L23)

- Selected column, lenient parse, sixth disjoint write, check mapped to the field.
  [`snapshot.ts:122`](../../apps/web/src/features/organization/services/snapshot.ts#L122)

- Lenient read: a missing or invalid value is "not set".
  [`snapshot.ts:180`](../../apps/web/src/features/organization/services/snapshot.ts#L180)

- Server 23514 on the named check gets its own message.
  [`snapshot.ts:774`](../../apps/web/src/features/organization/services/snapshot.ts#L774)

- Card plus dialog; hint always describes the field, no maxLength truncation.
  [`organization-minimum-members-card.tsx:118`](../../apps/web/src/features/organization/components/organization-minimum-members-card.tsx#L118)

- Placed after Obavijesti e-poštom, before Satni pojasi.
  [`organization-settings-card.tsx:87`](../../apps/web/src/features/organization/components/organization-settings-card.tsx#L87)

**Docs and deploy**

- AD-2 gains the current-state row and its amendment clause.
  [`ARCHITECTURE-SPINE.md:68`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L68)

- 0048 must ship before the SPA, which selects the column.
  [`DEPLOY.md:777`](../../DEPLOY.md#L777)

- The Organizacija card and dialog as shipped.
  [`EXPERIENCE.md:110`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L110)

**Tests and inventories**

- R10.5 under both fixtures, then edges and the change report.
  [`staffing.test.ts:99`](../../packages/domain/test/staffing.test.ts#L99)

- RLS: seeded values, the check refuses 0/-1, admin writes, member refused.
  [`rls-isolation.test.ts:23222`](../../test/rls-isolation.test.ts#L23222)

- E2E: refused entries send no PATCH; set and clear round-trip.
  [`minimum-members.spec.ts:51`](../../e2e/tests/organization/minimum-members.spec.ts#L51)

- Voice rule narrowly admits "u smjeni" (the team's shift) for five keys.
  [`resource-hygiene.test.ts:2460`](../../test/resource-hygiene.test.ts#L2460)

- `inputMode` added to the structural-attribute allowlist.
  [`source-guards.fixture.ts:1435`](../../apps/web/src/pages/source-guards.fixture.ts#L1435)
