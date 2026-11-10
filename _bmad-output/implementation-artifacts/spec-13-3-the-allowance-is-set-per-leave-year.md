---
title: 'Story 13.3: The allowance is set per leave year'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'ddd530bc5bbf16932cc7cf5002b6d03bf0538baf'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-13-2-leave-has-a-type-everywhere-it-is-recorded-or-reported.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member has one allowance, `members.leave_allowance_days`. Changing it recomputes every leave year with the new value, past ones included, and 13.4's carry-over must read last year's allowance as it was.

**Approach:** This is the read side and schema; the PO split the story at the checkpoint on 2026-11-10, and the write side is 13.3b.
- Migration `0055` adds `leave_allowances`: append-only versions of a member's allowance, each for one leave year.
- `members.leave_allowance_days` stays as the member's starting allowance.
- `packages/domain/leave` resolves the allowance of any leave year.
- Every balance surface uses the allowance of the leave year it counts.

The app writes no version yet, so every figure reads as before.

## Boundaries & Constraints

**Always:**
- **`supabase/migrations/0055_leave_allowances.sql`, modelled on 0028:**
  - Columns: `organization_id` first (FK to organizations, on delete cascade); `id bigint generated always as identity primary key`; `member_id`; `leave_year smallint` (1–9999, the calendar year in which the leave year begins); `days smallint >= 0`; `created_by default auth.uid()`; `created_at default now()`.
  - A composite FK to `members (organization_id, id)`, no cascade, and an `(organization_id, member_id)` index.
  - Select: an active admin of the token's organization, or a member for their own rows (0028's select policy shape).
  - Insert: an active admin, with `created_by` pinned.
  - Grants: insert `(organization_id, member_id, leave_year, days)` only. No update, delete or `anon` privilege: a version is never changed (AD-2).
  - No trigger, no function, no backfill, and no leave-year arithmetic in SQL (AD-7).
- **Resolution (PO, 2026-11-10):** the allowance of leave year Y is, in this order:
  1. the version for Y with the highest `id`;
  2. otherwise, the highest-`id` version of the latest year before Y;
  3. otherwise, the starting allowance.
- **Domain:**
  - `LeaveAllowance = { startingDays, versions: { id, leaveYear, days }[] }`, with a resolver for a leave year and a leave-year number helper next to `leaveYearOf`.
  - `LeaveBalanceInput.allowance` replaces `allowanceDays`. The balance and preview resolve it for the leave year of `today`, and `LeaveBalance.allowanceDays` is the resolved value.
  - Malformed input throws `RangeError`.
- **Read:**
  - `MEMBERS_COLUMNS` embeds `leave_allowances(id,leave_year,days)` and adds `leave_year_start_month,leave_year_start_day` to its `organizations(...)` embed.
  - `MemberListRow` gains `leaveAllowance: LeaveAllowance` and `leaveYearStart: LeaveYearStart | null`.
  - A row without the `leave_allowances` field (a cache from before 13.3) has no versions. A row without the start fields has a `null` start. A malformed version makes the row malformed.
- **Surfaces:**
  - *Godišnji*, *Danas*'s tile, the member page card, the leave overview (unscheduled rows too) and the request review all show the allowance through the domain resolver.
  - The resolution screen's balances already pass their own `today`, so they follow.
  - The Ljudi *Godišnji* column shows the current leave year's allowance, empty while today or the start is unknown, and sorts by it.
- **E2E cleanup:** `e2e/utils/database-helper.ts` deletes `leave_allowances` before every deletion of members or their `auth.users`, in the same transaction.

**Ask First:** any write of a version from the app, or touching members' privileges (13.3b); a copy or `hr.json` change.

**Never:**
- the allowance dialog or `members` privileges (13.3b); carry-over (13.4); the overview year stepper (deferred).
- applying 0055 to the local stack, patching `test/database.ts` or `e2e/utils/*` to apply it, or running DB-connecting root tests locally.
- committing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| No versions | starting 20 | every year → 20 | N/A |
| Changed this year | starting 20; v(2026)=25 | 2026 → 25; 2025 → 20 | N/A |
| Inherited | v(2026)=25; year 2027 | 25 | N/A |
| Corrected | v(2026)=25 id 1, v(2026)=24 id 2 | 24 | N/A |
| Past balance | v(2026)=25; `today` in leave year 2025 | balance uses 20 | N/A |
| Member reads | member session | own versions only | 0 rows for others |
| Session update/delete | any version | refused | 42501 |
| Old cache | row without `leave_allowances` | starting allowance | N/A |
| Bad version | `days: -1` or non-integer `leave_year` | row malformed; domain throws | logged / RangeError |

## Epic AC Deviations

- AC 1 ("each member's current single value becomes their allowance for the current leave year"): REINTERPRETED (PO, 2026-11-10). The value stays in `members.leave_allowance_days` as the starting allowance, which covers every leave year until a version sets another. No row is backfilled. A backfill would compute the current leave year in SQL (AD-7) and would duplicate the value. Every balance reads as before.
- AC 2 ("Given an allowance changed for this year, a past year's balance uses that year's allowance"): met at the engine and database level, with node assertions (Q9) and CI DB cases. The dialog that changes it is 13.3b (`deferred-work.md`). No surface shows a past year; the overview year stepper's entry is now unblocked and open.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0028_leave_records.sql` -- header style, policies :140-190, revoke/grant :195-205 to copy
- `packages/domain/src/leave.ts` -- `LeaveBalanceInput` :79, `leaveYearOf` :292, `checkBalanceInput` :316, `balanceOf` :337, `leaveBalanceOf` :361, `leavePreviewOf` :379; `packages/domain/test/leave.test.ts` (23 `allowanceDays` inputs); `packages/domain/src/index.ts` exports
- `apps/web/src/features/members/services/list.ts` -- `MEMBERS_COLUMNS` :126, `MemberListRow` :250, `memberRowOutcomeOf` :678 (organizations embed parse :740), `LEAVE_COLUMN` cell :1144; fixtures in `list.test.ts`, `write.test.ts`, `member-facts.test.ts`, `leave-overview.test.ts`, `teams/services/directory.test.ts`
- `apps/web/src/features/leave/services/leave-section.ts:66,259-265` -- `LeaveMembersSource` and the input; `my-leave.ts:174-186,237`; `leave-overview.ts:553` (unscheduled rows: resolve with today and the start); `leave-request-review.ts:94`; `conflicts/services/resolution-screen.ts:349,850`
- `e2e/utils/database-helper.ts:220,484,671` -- deletions of `auth.users`/members (cascade to members)
- `test/supabase-scaffold.test.ts` (0052/0053 blocks), `test/provisioning.test.ts:690-745,889-905` (RLS table list, privileges), `test/rls-isolation.test.ts` (leave cases ~17072, absence types ~25393)
- `ARCHITECTURE-SPINE.md:50-71` -- AD-2 table row *Leave allowance* and amendment clauses

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0055_leave_allowances.sql` -- the table, checks, FK, index, RLS, grants
- [x] `ARCHITECTURE-SPINE.md` -- AD-2 *Leave allowance* becomes **Versioned per leave year**, with an `Amended 2026-11-10 (story 13.3)` clause (starting allowance, resolution, append-only)
- [x] `test/supabase-scaffold.test.ts`, `test/provisioning.test.ts`, `test/rls-isolation.test.ts` -- pin 0055; add the table to the lists and probes; the matrix's DB rows (CI)
- [x] `packages/domain/src/leave.ts` (+`test/leave.test.ts`) -- the type, the resolver, the year number, the input change; the matrix's domain rows
- [x] `members/services/list.ts` (+tests, fixtures) -- the embed, the parse, the Ljudi cell and sort
- [x] `leave/services/*`, `conflicts/services/resolution-screen.ts`, `today/services/*` (+tests) -- pass `allowance`
- [x] `e2e/utils/database-helper.ts` -- the cleanup

**Acceptance Criteria:**
- Given the migrated database and no version, when any balance, the overview or Ljudi renders, then it equals its pre-migration value.
- Given `e2e/`, when grepped for the allowance, then no spec asserts behaviour this story changes.

## Design Notes

Append-only versions follow AD-2's "never updated in place": a same-year correction is a new row with a higher `id`, and Epic 14 can read who made each one. Keeping the starting column means member creation stays one insert (`admin-auth`, seeds, operator scripts unchanged), and caches from before 13.3 stay correct.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && … pnpm typecheck` -- pass
- `… pnpm --filter ./packages/domain exec vitest run`, `… pnpm --filter ./apps/web exec vitest run` -- pass
- `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:1/postgres … pnpm exec vitest run test/supabase-scaffold.test.ts test/resource-hygiene.test.ts` (and the other DB-free root files) -- pass; DB-connecting files skip or fail on the dead port, which is expected. DB tests and e2e run in CI.

## Suggested Review Order

**The resolution rule**

- Entry point: the year's highest-id version, else the latest earlier year's, else the starting allowance.
  [`leave.ts:385`](../../packages/domain/src/leave.ts#L385)

- Every balance and preview resolves the allowance for the leave year of `today`.
  [`leave.ts:418`](../../packages/domain/src/leave.ts#L418)

- The leave-year number: the calendar year in which the leave year begins.
  [`leave.ts:345`](../../packages/domain/src/leave.ts#L345)

**Schema**

- Append-only versions with AD-11 attribution; no backfill, no SQL leave-year arithmetic.
  [`0055_leave_allowances.sql:42`](../../supabase/migrations/0055_leave_allowances.sql#L42)

- Admin reads all, a member only their own; insert-only grant.
  [`0055_leave_allowances.sql:90`](../../supabase/migrations/0055_leave_allowances.sql#L90)

- AD-2: leave allowance becomes versioned per leave year.
  [`ARCHITECTURE-SPINE.md:74`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L74)

**The read and surfaces**

- One members read embeds the versions and the leave-year start.
  [`list.ts:136`](../../apps/web/src/features/members/services/list.ts#L136)

- A pre-13.3 cache reads as no versions; a malformed version refuses the row.
  [`list.ts:664`](../../apps/web/src/features/members/services/list.ts#L664)

- Ljudi's *Godišnji* column: the current year's allowance, empty while today or the start is unknown.
  [`list.ts:714`](../../apps/web/src/features/members/services/list.ts#L714)

- Overview's unscheduled rows resolve through the domain too.
  [`leave-overview.ts:459`](../../apps/web/src/features/leave/services/leave-overview.ts#L459)

- The member card and *Godišnji* pass the whole allowance into the balance.
  [`leave-section.ts:266`](../../apps/web/src/features/leave/services/leave-section.ts#L266)

- Saving the leave-year start re-reads the members list (review fix).
  [`use-organization-settings.ts:406`](../../apps/web/src/features/organization/hooks/use-organization-settings.ts#L406)

**Peripherals**

- E2E cleanup deletes versions before members and their accounts.
  [`database-helper.ts:223`](../../e2e/utils/database-helper.ts#L223)

- Domain node assertions for the matrix (Q9).
  [`leave.test.ts:654`](../../packages/domain/test/leave.test.ts#L654)

- RLS cases: append, correction, refusals, own-only, cross-tenant, inactive (CI only).
  [`rls-isolation.test.ts:25907`](../../test/rls-isolation.test.ts#L25907)

- Source pins of 0055.
  [`supabase-scaffold.test.ts:3258`](../../test/supabase-scaffold.test.ts#L3258)
