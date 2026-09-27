---
title: 'Story 3.5a: A shift-type override is recorded and shown'
type: 'feature'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '29306f38f67c4e148c8ddc5440da994b23d5b479'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-4b-day-detail-dialog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The schedule can only show what the pattern says (CAP-12). Nothing can record that a team worked another shift type on one date, and the `✎` modifier from 3.2b has never been drawn.

**Approach:** Add a `shift_type_overrides` table. `packages/domain` applies an override over the projection. The calendar marks an overridden cell with `✎` and its ring, and the day detail names the author, time, reason and projected type. In this story only seeds and fixtures write overrides; the admin form is 3.5b and the CAP-9 disposition is 3.5c. The user decided this on 2026-09-27: split a/b/c; any type, including a non-working one; reason required, 1–200 characters; past and future dates allowed.

## Boundaries & Constraints

**Always:**
- **Migration `0019_shift_type_overrides.sql`:**
  - Columns: `organization_id` first, then `id`, `team_id`, `date`, `shift_type_id`, `reason`, `created_by default auth.uid()`, `created_at default now()`, `removed_by`, `removed_at`.
  - Composite FKs `(organization_id, team_id)` and `(organization_id, shift_type_id)`, as 0016 writes them. A finite date.
  - `reason` is checked as `char_length(btrim(reason)) between 1 and 200`. `removed_by` and `removed_at` are both null or both set.
  - A partial unique index on `(organization_id, team_id, date) where removed_at is null`.
- **Access:**
  - Select, and insert with `WITH CHECK (created_by = auth.uid())`, are open only to an active admin of the token's organization, and insert only on a team and a type that are not archived. This copies 0016.
  - No update or delete grant; removal is 3.5b's.
  - Members read through a new `SECURITY DEFINER STABLE` `calendar_shift_type_overrides()`, pinned like 0018. It returns only live rows, as `(id, team_id, date, shift_type_id, reason, created_at, author_member_id)`. `author_member_id` is the author's `members.id` in the same organization, or null. `auth_user_id` never reaches a member.
- **Domain (`packages/domain/src/overrides.ts`, exported from `index.ts`):**
  - `ShiftTypeOverride { teamId, date, shiftTypeId }`.
  - `scheduledShiftTypeOn(versions, steps, overrides, teamId, date)` returns `{ shiftTypeId, projectedShiftTypeId, overridden }`, or `null` when no rotation is in effect. An override on such a date is ignored.
  - `scheduleOfMonth` and `memberScheduleOfMonth` take `overrides`, and their cells carry `projectedShiftTypeId` and `overridden`.
  - Asserted against both fixtures: with no overrides, every cell equals `projectedShiftTypeOn`.
- **Snapshot:**
  - `readCalendar` adds the rpc beside `calendar_members`, under the same `CALENDAR_KEY`.
  - A bad row makes the read unavailable with the new refusal `'override'`.
  - `CalendarSnapshot.overrides` holds `{ id, teamId, date, shiftTypeId, reason, createdAt, authorMemberId }`.
- **Calendar:** `cellOf` gets `[MODIFIER_OVERRIDDEN]` when `overridden`. The grid, the day lists, the legend and `cellLabelOf` then show it through the existing 3.2b paths.
- **Day detail:**
  - `DayDetail.override` is `null`, or `{ projectedTypeName, authorName, savedAt, reason }`.
  - `authorName` comes from `snapshot.members`, and is `null` when unknown.
  - `savedAt` is `formatDate` + `formatTime` in `snapshot.timeZone`.
  - `kind`, the type and the range follow the overridden type.
  - `renderDetail` shows the override block on every kind: `kalendar.detail.override.{heading,projected,author,unknownAuthor,savedAt,reason}` ("Izmjena", "Prema rotaciji: {type}", "Autor: {name}", "Nepoznata osoba", "Vrijeme: {date} u {time}", "Razlog: {reason}"). Register them in the inventories under "story 3.5a".
- **Seeds:**
  - `seed.sql`: one pilot override and one UJ-5 override, with `created_by` set to the admin's `auth_user_id`.
  - Demo: one override.
  - Update every inventory, count and fingerprint test to match.

**Ask First:**
- any write path from the app;
- an update or delete policy;
- exposing `auth_user_id` to member-role accounts;
- windowing the read by month.

**Never:**
- a write to any rotation row;
- a trigger;
- a second query key;
- projection in `apps/web`;
- `destructive` or the accent on the override;
- 3.5b's form or 3.5c's disposition;
- new dependencies or render tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Override working | Alfa projects Dan on D, override Noć | cell Noć, `overridden`, `projectedShiftTypeId` Dan; detail "Prema rotaciji: Dan", author, time, reason | N/A |
| Off becomes working | projected non-working, override Dan | `kind` working, roster shown, override block | N/A |
| Working becomes off | override to a non-working type | `kind` off, override block shown | N/A |
| No rotation | override on a date with no version | ignored, `noRotation`, no modifier | N/A |
| Removed | `removed_at` set | not returned by rpc; cell equals projection | N/A |
| None | empty overrides, both fixtures | every cell equals pure projection | N/A |
| Unknown author | `author_member_id` null | "Nepoznata osoba" | N/A |
| Member role | member calls rpc / selects table | rpc rows, table 0 rows; insert refused | 42501 |
| Other org / inactive | token of org B, or inactive caller | rpc 0 rows | N/A |
| Duplicate live | second live row on same team, date | refused | 23505 |
| Blank reason | `'  '` or 201 chars | refused | 23514 |
| Bad row | rpc row missing `team_id` | snapshot unavailable, refusal `override` | refusal |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0016_rotation.sql`: the pattern to copy.
  - Composite FKs :111, :162; finite date :179-183.
  - Select policy :293-303; admin insert :307-319; not-archived conjuncts :358-364, :419-425.
  - Grants :455-484.
- `supabase/migrations/0018_calendar_members.sql:44-70`: the definer function and its grants. The `members` policy in 0011:36-52 is why names need a definer read.
- `packages/domain/src/projection.ts`: `projectedShiftTypeOn` :240. `schedule.ts`: `ScheduleCell` :34, `scheduleOfMonth` :116 (cell :134), `memberScheduleOfMonth` :175 (cell :194), with the 3.5 comment at :7. `index.ts` has per-module export blocks at :57-68. Fixtures and tests are in `packages/domain/test/fixtures.ts` and `schedule.test.ts:26`.
- `apps/web/src/calendar/snapshot.ts`:
  - `CALENDAR_KEY` :65; `CalendarSnapshot` :181-203; `CalendarRefusal` :221-242.
  - `readCalendar` :285-302, with its rpc pattern.
- `apps/web/src/calendar/month.ts`: `NO_MODIFIERS` :416, and `cellOf` :577 (modifiers at :591 and :610), called from :678 and :775.
- `apps/web/src/calendar/modifiers.ts`: `MODIFIER_OVERRIDDEN` :23, `legendOf` :175, `cellLabelOf` :212.
- `apps/web/src/calendar/day-detail.ts`: `DayDetail` :57-69, and `dayDetailOf` :88, whose `projectedShiftTypeOn` call at :93 must become `scheduledShiftTypeOn`.
- `apps/web/src/routes/kalendar.tsx`: `renderDetail` :639 (early returns), `renderLegend` :468, Dialog :897.
- The author lookup follows `rotation/history.ts:69,85-86`; the "{date} u {time}" wording is at `hr.json:439`.
- Guards to rewrite:
  - `calendar/snapshot.test.ts`: :172-179, which forbids `/override/`; :825-848, the detail token counts; :873-885, the `'overridden'` and `NO_MODIFIERS` counts.
  - `e2e/calendar.spec.ts:509-510`, which asserts no legend.
- Inventories:
  - `test/supabase-scaffold.test.ts`: policies :306 and :325-400, columns :1406-1523, grants :1584-1643.
  - `test/rls-isolation.test.ts`: :251-265, :1054-1160, :7106-7120, :12975-13005, :13789-13798.
  - `test/provisioning.test.ts`: :784-818, :1176-1275.
  - `test/demo-organization.test.ts`: :196-230, :330-350, :500-517, :605-625.
  - `test/resource-hygiene.test.ts:895-928` and `test/localization-applied.test.ts:252-261`.
- Seeds and E2E:
  - `supabase/seed.sql`: pilot :259-285, UJ-5 :493-517.
  - `supabase/operator/demo-organization.sql:258-282`.
  - `e2e/support/database.ts`: `pg` as superuser. `removeSeededRotation` :347 must delete overrides before `shift_types`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0019_shift_type_overrides.sql` -- table, index, checks, policies, grants, rpc -- the record
- [x] `test/supabase-scaffold.test.ts`, `rls-isolation.test.ts`, `provisioning.test.ts` -- inventories; member/cross-org/inactive/anon refusals; duplicate, blank reason; rpc author id -- DB matrix rows
- [x] `packages/domain/src/overrides.ts`, `schedule.ts`, `index.ts`, tests -- apply the override; the none-equals-projection check on both fixtures
- [x] `supabase/seed.sql`, `operator/demo-organization.sql`, `test/demo-organization.test.ts` -- the seeded overrides and counts
- [x] `apps/web/src/calendar/snapshot.ts`, `month.ts`, `day-detail.ts`, tests -- the read, the modifier and the detail -- web matrix rows
- [x] `apps/web/src/routes/kalendar.tsx`, `hr.json`, the hygiene and localization inventories -- the override block
- [x] `e2e/support/database.ts`, `e2e/calendar.spec.ts` -- insert an override on Alfa today. The cell shows `✎` and the legend is visible at 1280 px and in the 390 px day list. The detail shows the projected type, author, time and reason. Remove the no-legend assertion.
- [x] `sprint-status.yaml` -- `3-5-…` becomes in-progress, with a split comment

**Acceptance Criteria:**
- Given any override, when it is written, then rotation pattern and assignment rows are byte-identical before and after (CAP-12, DI-2).
- Given an overridden date, when the month renders, then `✎` with its inset ring and the legend show without opening detail, in both themes (UX-DR8, UX-DR24).

## Design Notes

A column default cannot attribute an UPDATE, so `removed_by`/`removed_at` exist now but only 3.5b decides how they are set (for example a definer RPC). The partial index and the reads already honour them. The rpc hides `auth_user_id` by returning the author's member id, which `calendar_members()` names.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips
- `pnpm test:e2e` -- green; stop Vite on 5173 first
- `git diff --stat package.json pnpm-lock.yaml` -- empty

**Manual checks:**
- Demo org at 390 and 1280 px, in light and dark: the overridden cell, the legend and the detail.

## Suggested Review Order

**The record**

- Entry point: the override table, composite FKs, reason check and `removed_*` pair.
  [`0019_shift_type_overrides.sql:46`](../../supabase/migrations/0019_shift_type_overrides.sql#L46)

- At most one live override per team and date, by a partial unique index.
  [`0019_shift_type_overrides.sql:103`](../../supabase/migrations/0019_shift_type_overrides.sql#L103)

- Admin-only select and insert; `created_by = auth.uid()`, no update or delete grant.
  [`0019_shift_type_overrides.sql:112`](../../supabase/migrations/0019_shift_type_overrides.sql#L112)

- Members read live rows through a definer function; the author as a member id.
  [`0019_shift_type_overrides.sql:195`](../../supabase/migrations/0019_shift_type_overrides.sql#L195)

**Applying it in the domain**

- One function answers scheduled, projected and overridden; no-rotation dates ignore overrides.
  [`overrides.ts:102`](../../packages/domain/src/overrides.ts#L102)

- The month schedules apply the same override over the projection, never a second rule.
  [`schedule.ts:143`](../../packages/domain/src/schedule.ts#L143)

**Reading and showing it**

- The overrides rpc rides beside the members read, under the one `CALENDAR_KEY`.
  [`snapshot.ts:342`](../../apps/web/src/calendar/snapshot.ts#L342)

- Row validation; the reason's content is left to the database's check.
  [`snapshot.ts:489`](../../apps/web/src/calendar/snapshot.ts#L489)

- An overridden cell carries `✎`, feeding 3.2b's ring, legend and labels.
  [`month.ts:422`](../../apps/web/src/calendar/month.ts#L422)

- The detail follows the worked type and carries author, time, reason, projected type.
  [`day-detail.ts:118`](../../apps/web/src/calendar/day-detail.ts#L118)

- The Izmjena block, shown on working and off days alike.
  [`kalendar.tsx:655`](../../apps/web/src/routes/kalendar.tsx#L655)

**Peripherals**

- The none-equals-projection assertion on both fixtures.
  [`overrides.test.ts:52`](../../packages/domain/test/overrides.test.ts#L52)

- DB refusals: member, cross-tenant, inactive, duplicate, blank reason, forged author, anon.
  [`rls-isolation.test.ts:13881`](../../test/rls-isolation.test.ts#L13881)

- E2E: the cell, legend and detail at 1280 px, incl. working made off.
  [`calendar.spec.ts:808`](../../e2e/calendar.spec.ts#L808)

- E2E: a member's day list at 390 px.
  [`calendar.spec.ts:883`](../../e2e/calendar.spec.ts#L883)

- Seeded overrides for the pilot, UJ-5 and the demo.
  [`seed.sql:289`](../../supabase/seed.sql#L289)

- Copy: the `kalendar.detail.override.*` keys.
  [`hr.json:62`](../../apps/web/src/i18n/locales/hr.json#L62)
