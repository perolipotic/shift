---
title: 'A leave record is stored, overlap is refused by the database, and the schedule is untouched (5.1b)'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: '1a7493191878aca38f50983d8f1d910769b74367'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-shift/engine-rules.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 5.1 needs leave to be recordable. There is no table yet. The epic requires the database, not the interface, to refuse an overlapping range for the same member (AD-3, R4.4), and recording leave must change nothing in the schedule (R4.1, DI-3). The cost rule already exists in `domain/leave` (5.1a).

**Approach:**
- Migration `0028_leave_records.sql`: an organization-first `leave_records` table holding one member's inclusive date range, with an exclusion constraint on member and live range, attribution, soft-removal columns for 5.2, and RLS (an active admin inserts and reads the organization's records; a member reads only their own).
- A client write service in a new `leave` feature. It inserts a record and maps an overlap to a code that names the conflicting record's dates, read back with one follow-up select.
- No UI.

## Boundaries & Constraints

**Always:**
- **Table shape, following 0026.**
  - `organization_id` first, cascading from organizations; `id` uuid.
  - `member_id` with a composite FK `(organization_id, member_id) → members (organization_id, id)`, no cascade.
  - `during daterange not null`: lower bound inclusive, bounded, non-empty, within `0001-01-01`–`9999-12-31`, at most 366 days. The cap matches `MAX_LEAVE_RANGE_DAYS`.
  - `created_by default auth.uid()`, `created_at default now()`.
  - `removed_by`/`removed_at`, plus the `_removal_complete` check.
  - `EXCLUDE USING gist (member_id WITH =, during WITH &&) WHERE (removed_at is null)`. `btree_gist` already exists (0001).
- **RLS and grants, following 0026's policy text and naming.**
  - Insert: an active admin of the JWT's organization, with `created_by = auth.uid()`.
  - Select: an admin sees the organization's records; a member sees rows whose member is their own `auth_user_id`.
  - Grants: insert of the named columns only. No update or delete grant; removal is 5.2.
- **No balance check in the database.** An over-balance record saves (R4.7).
- **Client.** Write and read only through `apps/web/src/features/leave/services/`.
  - Outcome codes: `LEAVE_OVERLAP` (23P01), `LEAVE_DENIED` (42501) and `LEAVE_FAILED` (anything else).
  - On `LEAVE_OVERLAP`, select the member's live record overlapping the entered range and return its `from` and `to`. If that read fails, return the code without dates.
  - Register the feature in the eslint feature-boundary config.
- **Tests** follow the existing helpers and register the new table and policies in every inventory list (see Code Map).

**Ask First:**
- A SECURITY DEFINER insert function in place of a direct insert.
- Any trigger, including `serialize_organization_writes`.
- Seeding leave in `seed.sql` or the demo organization.

**Never:**
- No UI, no removal or amend function (5.2), no conflicts (5.3), no change to the domain.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin records | active admin, member of the same org, 10.09–14.09 | row stored with `created_by` set; the schedule fingerprint is unchanged | N/A |
| Overlap | an existing live record 12.09–20.09 | refused 23P01; the client returns `LEAVE_OVERLAP` with 12.09–20.09 | the code, plus dates when readable |
| Touching | an existing record ends 09.09; new from 10.09 | stored | N/A |
| After removal | a soft-removed record overlaps | stored | N/A |
| Over balance | cost far above the allowance | stored | N/A |
| Member writes | member-role session inserts | refused | 42501 → `LEAVE_DENIED` |
| Member reads | a member selects | only their own rows | N/A |
| Cross-tenant | an admin of org B inserts or reads org A's member | refused / no rows | 42501 / empty |
| Bad range | empty, unbounded, `to < from`, 367 days | refused | check violation → `LEAVE_FAILED` |

## Epic AC Deviations

- **Met here:** "every scheduled shift is still in place and the rotation is untouched", and "an overlapping range … refused by the database … an exclusion constraint on the member and the date range".
- **Partly here:** "the refusal names the specific conflict and keeps every entered value". 5.1b returns the conflicting record's dates; showing them and keeping the form values is 5.1c (ledger: the "Story 5.1c" entry).
- **Deferred to 5.1c:** "the cost is shown before saving", and the over-balance warning on save. 5.1b only guarantees the save is not refused (ledger: the "Story 5.1c" entry).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0026_roster_overrides.sql`:
  - :52-118 table, composite FKs, attribution, removal check and date-range check style;
  - :123 the org index;
  - :136-171 RLS policy text (JWT org claim plus `current_member_access()` admin and `is_active`);
  - :181-187 grants.
  - The member-own-row select pattern is `0011:36-52`.
- `supabase/migrations/0001_extensions.sql:11` -- `btree_gist`, already created for this table.
- `apps/web/src/features/calendar/services/roster-write.ts` -- the shape to mirror: `RosterWriteError`, the `RosterTable` seam, SQLSTATE constants, `rosterInsertFailureOf`, `{ok}|{ok:false,code}` outcomes. Its unit tests are in `roster-write.test.ts`.
- `apps/web/src/features/members/services/list.ts:72, :804` and `apps/web/src/pages/ljudi.$id.tsx` -- where 5.1c will read. Not changed here.
- `eslint.config.js:117` (`FEATURE_PUBLIC`) -- add `leave`.
- `test/rls-isolation.test.ts`:
  - helpers: `connect`, `inRolledBackTransaction`, `refusedThenContinue`, `actAs`, `memberByUsername`, `addThrowawayMember`;
  - `scheduleRulesFingerprint` (:15388), used for "unchanged" at :15460;
  - the policy list at :1055-1125 and a refusal-test model at :15721.
- Other inventories:
  - `test/supabase-scaffold.test.ts` (the policy mirror at ~:330-380, per-table tests at ~:2007-2170);
  - `test/provisioning.test.ts` (RLS-on list :785-819, privilege model :1351-1403).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0028_leave_records.sql` -- table, checks, exclusion, index, RLS, grants -- the record (AD-3).
- [x] `apps/web/src/features/leave/services/leave-write.ts` (+ `.test.ts`) -- `recordLeave(table, organizationId, memberId, from, to)` and the failure mapping, with the overlap read-back -- the client path, unit-tested with fake seams.
- [x] `eslint.config.js` -- the `leave` feature boundary.
- [x] `test/rls-isolation.test.ts`, `test/supabase-scaffold.test.ts`, `test/provisioning.test.ts` -- every matrix row against both fixtures where applicable. Include the schedule fingerprint before and after an insert. Register the table and policies in the inventories -- R8.3 overlap coverage in node.

**Acceptance Criteria:**
- Given both fixtures, when the root suite runs, then the overlap refusal, the touching and after-removal cases, the RLS cases and the fingerprint test pass.
- Given a refused overlap, when the client maps it, then the outcome is `LEAVE_OVERLAP` with the existing record's inclusive dates.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (the local stack applies 0028; do not run `db reset`, use `supabase migration up`)

## Suggested Review Order

**The record**

- Entry point: the table, its range checks and the live-only exclusion that refuses overlap.
  [`0028_leave_records.sql:52`](../../supabase/migrations/0028_leave_records.sql#L52)

- The exclusion constraint itself; removed records never block.
  [`0028_leave_records.sql:111`](../../supabase/migrations/0028_leave_records.sql#L111)

- Select: an active admin's organization, or the member's own rows.
  [`0028_leave_records.sql:130`](../../supabase/migrations/0028_leave_records.sql#L130)

- Insert: an active admin only, attributed to the caller.
  [`0028_leave_records.sql:165`](../../supabase/migrations/0028_leave_records.sql#L165)

**Client**

- Record leave; overlap becomes LEAVE_OVERLAP with the conflicting dates.
  [`leave-write.ts:228`](../../apps/web/src/features/leave/services/leave-write.ts#L228)

- The read-back is tenant-pinned and gives the member's earliest live record.
  [`leave-write.ts:182`](../../apps/web/src/features/leave/services/leave-write.ts#L182)

- Dates checked before any range literal is built.
  [`leave-write.ts:128`](../../apps/web/src/features/leave/services/leave-write.ts#L128)

**Tests and inventories**

- Policy inventory, then the 5.1b block: overlap shapes, RLS, fingerprints, REST read-back, org delete.
  [`rls-isolation.test.ts:1080`](../../test/rls-isolation.test.ts#L1080)
