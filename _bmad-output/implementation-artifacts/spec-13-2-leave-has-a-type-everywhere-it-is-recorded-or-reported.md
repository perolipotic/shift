---
title: 'Story 13.2: Leave is reported and balanced by type'
type: 'feature'
created: '2026-11-08'
status: 'done'
baseline_commit: '55527e9d2dedccaf8b558a7be4a11961c62c67b1'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-13-1-absence-types-are-organization-data.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 13.1, every leave record has an absence type, but every balance still counts every record, and *Sati* and the Excel file still have one hard-coded *Godišnji odmor* column. Once 13.2b lets anyone record sick leave, it would be charged to the allowance and reported as annual leave.

**Approach:** This is the read side only. Split at the checkpoint (PO, 2026-11-08); the write side is 13.2b.
- Leave reads carry each record's type and whether it draws the allowance.
- The calendar snapshot carries the organization's absence types.
- `packages/domain/leave` counts only drawing records in the balance.
- *Sati*, the member's *Sati* and the Excel file show one days column per drawing type and one *Ostala odsutnost* column, each named by organization data.

No session can write a non-annual record until 13.2b, so every figure on screen stays the same.

## Boundaries & Constraints

**Always:**
- **Migration `0053`, read side only:**
  - A select policy lets an active member of the token's organization read `absence_types` (PO Q2). It replaces the admin-only select policy. Admins keep insert and update.
  - `my_leave_records()` and `leave_overview_records()` are dropped and recreated, returning `absence_type_id` and `draws_allowance` as well. Their bodies, checks and grants are otherwise unchanged.
  - No other grant, no write path, no trigger.
- **Reads:**
  - Admin selects on `leave_records` add `absence_type_id,...absence_types(draws_allowance)`.
  - The parsed record carries `absenceTypeId` and `drawsAllowance`. A row with neither field (a cache written before 13.2) is annual leave and draws. Any other malformed value makes the read unavailable.
- **Calendar snapshot:**
  - It embeds `absence_types(organization_id,id,name,draws_allowance)` with the usual tenant tripwire.
  - A cached snapshot without the field gives `null` types, and *Sati* is unavailable until it is read again.
- **Domain:**
  - `LeaveRange.drawsAllowance?: boolean`; absent means it draws.
  - The balance counts only drawing records.
  - A non-drawing preview range charges 0 in-year and is never "exceeds".
  - The overlap check, cost, `leaveDaysOfMonth`, collisions and staffing still see every record (CAP-23).
- **Columns:**
  - Drawing types come first: annual leave, then the rest by Croatian collation, each named by its stored name.
  - *Ostala odsutnost* is added only when the organization has a non-drawing type (PO Q4).
  - A record whose type is not in the snapshot makes *Sati* unavailable, never guessed.
  - Each column has its own figure, footer total and ⓘ dates.
  - Excel headers are "{name} (dani)" and "Ostala odsutnost (dani)". The file equals the screen (FR-42a).
- **Sort (PO Q5):** `dopust` stays annual leave. Every other drawing type sorts by `odsutnost-<typeId>`, and the rest by `ostala-odsutnost`. A stale key falls back to the default.
- **Invalidation:** saving an absence type also invalidates the calendar snapshot and the leave reads.
- DI-8: no type is named in code; *Ostala odsutnost* names no type.

**Ask First:** a new table or trigger; any write-side change (13.2b); any change to collisions or staffing.

**Never:** a type picker, a type grant on `leave_records` or `leave_requests`, or changes to approval, amend or Q5 wording (13.2b); half days, per-year allowance or carry-over; applying 0053 locally, patching the harness, or running DB-connecting root tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Fresh org | annual only | one column named *Godišnji odmor*, no *Ostala*; figures as before | N/A |
| Mixed | annual 2 days, *Bolovanje* (not drawing) 3 | annual 2, *Ostala odsutnost* 3; balance charged 2 | N/A |
| Two drawing | annual 1, *Edukacija* (drawing) 2 | two columns, balance charged 3 | N/A |
| Collision | non-drawing record over a rostered shift | collision still raised | N/A |
| Unknown type | record names a type not in the snapshot | *Sati* unavailable | logged |
| Member reads catalog | member session | sees types; sees no one else's records | N/A |
| Old cache | record rows without type fields | annual leave | N/A |

## Epic AC Deviations

- AC 1 ("a radio card group chooses the type"): DEFERRED to 13.2b (PO split, 2026-11-08). See `deferred-work.md`.
- AC 2 ("it raises a conflict"): met for every type. The UI keeps *Odsutnost u smjeni* and never says *konflikt*.
- AC 3 (member reads *odsutan*, never the type): DEFERRED to 13.2b (the wording). Unchanged here: a member still reads only their own records (0028, 0030), and the catalog shows no person.
- AC 4 ("one for the rest"): NARROWED. The *Ostala odsutnost* column is shown only when the organization has a non-drawing type (PO Q4, 2026-11-08; amendment approved by the PO 2026-11-09).
- AC 5: NARROWED to UX-DR17 and its DESIGN.md / EXPERIENCE.md lines. UX-DR12, 47 and 50 go to 13.2b.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0052_absence_types.sql` -- policy names; `0030:28`, `0034:31` -- the bodies to recreate
- `packages/domain/src/leave.ts` -- `LeaveRange` :49, `balanceOf`, `leavePreviewOf` :360; `collisions.ts` -- doc comment on cost equality
- `apps/web/src/features/leave/services/leave-list.ts` -- `LEAVE_RECORDS_COLUMNS` :44, `LeaveRecord`, `leaveRecordsOf` :94 (the single parser, also behind `organizationLeaveRecordsOf` and `myLeaveOf`)
- `apps/web/src/features/leave/services/leave-section.ts:170-181` -- the row's `range` must keep `drawsAllowance`
- `apps/web/src/features/calendar/services/snapshot.ts` -- `CALENDAR_COLUMNS` :117, `CalendarSnapshot` :271, parse :489-560; `features/rotation/rotation.fixture.ts:330-356` -- the fixture row
- `apps/web/src/features/absence-types/services/list.ts` -- the ordering to reuse; `features/organization/hooks/use-organization-absence-types.ts` -- invalidation
- `apps/web/src/features/hours/services/` -- `hours-conflicts.ts:115` (`LeaveRecordsByMember`), `my-hours.ts:179-310`, `organization-hours.ts` (rows, sort, footer), `hours-search.ts:47`, `hours-export.ts:131-197`, `hours-explanation.ts:294,346`
- `apps/web/src/features/hours/components/` -- `organization-hours-table.tsx:98,154`, `organization-hours-rows.tsx`, `hours-summary.tsx:97`, `hours-explanation.tsx`
- `hr.json` `sati.*`; `test/resource-hygiene.test.ts:1569-1600`
- e2e: `tests/hours/hours.spec.ts:223,1133`, `tests/conflicts/conflict-resolution.spec.ts:345`, `utils/database-helper.ts:1112`
- Docs: `epics.md:136` (UX-DR17), `DESIGN.md` hours table, `EXPERIENCE.md:126`

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0053_absence_type_reads.sql` -- the policy swap; recreate both functions
- [x] `test/supabase-scaffold.test.ts`, `provisioning.test.ts`, `rls-isolation.test.ts` -- pin 0053; the member select case flips to rows; functions return the type (CI)
- [x] `packages/domain/src/leave.ts` (+`test/leave.test.ts`) -- the drawing filter; node assertions (Q9)
- [x] `leave-list.ts`, `leave-section.ts` (+tests) -- columns, parsing, keeping the flag
- [x] `calendar/services/snapshot.ts`, `rotation.fixture.ts` (+tests) -- types in the snapshot
- [x] `hours/services/*`, `hours/components/*` (+tests) -- columns, sort, footer, ⓘ, export
- [x] `use-organization-absence-types.ts` -- invalidate the calendar and leave keys
- [x] `hr.json`, `resource-hygiene.test.ts` -- *Ostala odsutnost* and the header patterns; drop the fixed leave headers
- [x] `e2e/` -- update the hours and conflict specs that look up the leave column by its old key
- [x] Docs -- UX-DR17, DESIGN.md, EXPERIENCE.md hours table

**Acceptance Criteria:**
- Given only annual records, when the balance, *Sati* or Excel renders, then the figures are unchanged and the single column carries the type's stored name.
- Given a non-drawing record, when balances derive, then it is not charged, while collisions and staffing count it.

## Design Notes

The drawing flag travels with each leave read (`draws_allowance`, current-state), so every balance surface is right with no new query. The type catalog travels in the calendar snapshot, as hour bands do, because *Sati* adds no read (human amendment, 2026-10-21).

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && … pnpm typecheck` -- pass
- `… pnpm --filter ./packages/domain exec vitest run`, `… pnpm --filter ./apps/web exec vitest run`, `… pnpm exec vitest run test/supabase-scaffold.test.ts test/resource-hygiene.test.ts` -- pass (no DB)
- DB tests and e2e run in CI only.

## Suggested Review Order

**The drawing rule**

- Entry point: only drawing records count in the balance; collisions still see all.
  [`leave.ts:341`](../../packages/domain/src/leave.ts#L341)

- Absent flag means drawing, so pre-13.2 records and callers read as before.
  [`leave.ts:68`](../../packages/domain/src/leave.ts#L68)

- A non-drawing preview charges nothing in-year and never "exceeds".
  [`leave.ts:389`](../../packages/domain/src/leave.ts#L389)

**The reads**

- Members read the type catalog; insert and update stay admin-only.
  [`0053_absence_type_reads.sql:37`](../../supabase/migrations/0053_absence_type_reads.sql#L37)

- Own and overview reads return the type and its current flag.
  [`0053_absence_type_reads.sql:56`](../../supabase/migrations/0053_absence_type_reads.sql#L56)

- Admin selects carry the flag through a PostgREST spread (CI-verified only).
  [`leave-list.ts:60`](../../apps/web/src/features/leave/services/leave-list.ts#L60)

- One parser: neither field means annual; anything malformed is unavailable.
  [`leave-list.ts:117`](../../apps/web/src/features/leave/services/leave-list.ts#L117)

- The calendar snapshot embeds the catalog, as it does hour bands.
  [`snapshot.ts:136`](../../apps/web/src/features/calendar/services/snapshot.ts#L136)

- A pre-13.2 cached snapshot answers null; Sati is unavailable until re-read.
  [`snapshot.ts:431`](../../apps/web/src/features/calendar/services/snapshot.ts#L431)

**Sati and the file**

- Columns from organization data; *Ostala* only with a non-drawing type.
  [`my-hours.ts:242`](../../apps/web/src/features/hours/services/my-hours.ts#L242)

- Records routed per column; a catalog/record flag mismatch is unavailable.
  [`my-hours.ts:286`](../../apps/web/src/features/hours/services/my-hours.ts#L286)

- Sort keys: `dopust` stays annual leave; prefix and fixed key for the rest.
  [`hours-search.ts:52`](../../apps/web/src/features/hours/services/hours-search.ts#L52)

- The file writes one `{name} (dani)` column per screen column.
  [`hours-export.ts:204`](../../apps/web/src/features/hours/services/hours-export.ts#L204)

**Balances and invalidation**

- A non-drawing row states no in-year part.
  [`leave-section.ts:183`](../../apps/web/src/features/leave/services/leave-section.ts#L183)

- Saving a type re-reads the snapshot and every leave read.
  [`use-organization-absence-types.ts:215`](../../apps/web/src/features/organization/hooks/use-organization-absence-types.ts#L215)

**Peripherals**

- e2e: leave-column tests hold the absence-types lock against parallel specs.
  [`hours.spec.ts:114`](../../e2e/tests/hours/hours.spec.ts#L114)

- UX-DR17 rewritten for the per-type columns.
  [`epics.md:136`](../planning-artifacts/epics.md#L136)
