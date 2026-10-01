---
title: 'A leave record is amended or removed in one attributed step, and the balance follows (5.2a)'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: 'ed1446c6eaeb74ba7ebf1fe20904e935deeb1103'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A saved leave record (5.1b) cannot be changed. 0028 left `removed_by`/`removed_at` with no writer and named removal as story 5.2's, so a mistyped or changed range is permanent and its cost stays in the balance.

**Approach:** Migration `0029_amend_remove_leave_record.sql` adds two SECURITY DEFINER functions, copied from 0027 (removal) and 0022's `amend_shift_type_override` (amend):
- `remove_leave_record(p_record_id)` soft-removes a live record.
- `amend_leave_record(p_record_id, p_from, p_to)` soft-removes it and inserts the replacement range for the same member in one transaction, returning the new id.

The client gets `removeLeave` and `amendLeave` beside `recordLeave`. The balance follows on its own, because `readLeaveRecords` reads live records only and `domain/leave` computes from them. No UI (5.2b).

## Boundaries & Constraints

**Always:**
- **Both functions, as 0027:**
  - The caller must be an active admin of the JWT's organization, else 42501.
  - The record must be live and in that organization, else P0002. Another tenant's id is indistinguishable from none.
  - `removed_by = auth.uid()`, `removed_at = now()`.
  - `search_path = ''` and every name qualified.
  - Revoke execute from `public`, `anon` and `service_role`; grant it to `authenticated`.
  - No table grant, policy or trigger change: a session still holds no update or delete on `leave_records`.
- **Amend:**
  - The new row takes the old row's organization and member, `during = daterange(p_from, p_to, '[]')`, and `created_by`/`created_at` from their defaults.
  - Any refusal of the insert rolls back the removal, so the old record stays live: the exclusion (23P01) or a range the 0028 checks refuse (22000, 22008, 23514).
  - The new range may overlap the old one, because the old one leaves the exclusion first.
- **Client:**
  - Outcome codes: `LEAVE_GONE` (P0002) is added; `LEAVE_OVERLAP`, `LEAVE_DENIED` and `LEAVE_FAILED` keep their meaning.
  - The rpc seam mirrors `RosterRemoval`.
  - On amend `LEAVE_OVERLAP`, the conflict read-back excludes the record being amended, so the named conflict is never the record itself.
  - A successful amend returns the new id.
- **Tests:** register both functions in every inventory listed in the Code Map, and update the 0028-era comments and asserts that say removal is 5.2's.

**Ask First:**
- A column linking the replacement to the record it replaced.
- Hard delete, an update grant or policy, or any trigger.
- Seeding leave in `seed.sql` or the demo organization.

**Never:**
- No UI and no member read path (5.2b, 5.2c).
- No conflicts or resolutions (5.3, 5.4).
- No change to `domain/leave`.
- No balance check in the database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Remove | admin, live record | `removed_by`/`removed_at` set; live read drops it; balance restored by its cost; schedule fingerprint unchanged | N/A |
| Remove again | already removed, unknown, or another tenant's id | refused, nothing changes | P0002 → `LEAVE_GONE` |
| Amend | live 10.09–14.09 → 12.09–20.09 | old removed, new live row returned; balance reflects only the new cost | N/A |
| Amend onto another record | another live record 18.09–25.09 | refused; both records unchanged and live | 23P01 → `LEAVE_OVERLAP` naming 18.09–25.09, never the amended record |
| Amend to a bad range | reversed, infinite, 367 days | refused; old record still live | `LEAVE_FAILED` |
| Member or banned admin | member-role session or inactive admin calls either | refused, nothing changes | 42501 → `LEAVE_DENIED` |
| anon over REST | either rpc | permission denied for function | `LEAVE_FAILED` |
| Then re-record | after removal, insert the same range | stored (the removed row has left the exclusion) | N/A |

## Epic AC Deviations

- **Met here, record half:** "When it is amended or deleted, Then the balance is recomputed so that allowance minus used equals balance at all times, from the current leave year only". The functions make the change; the existing live read and `leaveBalanceOf` give the balance. It is proven in a node assertion over the live read. Showing it on screen is 5.2b.
- **DEFERRED to 5.3:** "Given a leave record that caused conflicts, When it is amended so it no longer collides, Then every conflict it caused is cleared". Conflicts do not exist until 5.3. They are derived and never stored, so the removed row stops raising them with no further write here. 5.3 must assert it (ledger entry).
- **DEFERRED to 5.2b:** "the action passes through exactly one confirmation step, signalled by more than colour, using neutral styling". This is UI (ledger: the "Story 5.2b" entry).
- **DEFERRED to 5.2c:** "a member's own view … allowance, days used and balance, and no other member's". This is a separate surface and read path (ledger: the "Story 5.2c" entry).
- **DEFERRED to 5.4 (epic constraint, not a 5.2 AC):** "deleting or amending leave whose conflict was resolved by Replace member must not silently revert that roster override". Resolutions do not exist until 5.4 (ledger entry).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0027_remove_roster_override.sql`
  - :1-46 header style, ending "No trigger."
  - :48-80 the function: claim :55, admin check :57-67 (`insufficient_privilege`), soft-remove update :69-74, `no_data_found` :76-80.
  - :88-91 revokes and grant.
- `supabase/migrations/0022_shift_type_override_disposition.sql:129-198` -- `amend_shift_type_override`, the amend template: `update … returning … into`, P0002, then `insert … returning id into replacement`. Grants use the full signature.
- `supabase/migrations/0028_leave_records.sql` -- table, checks and exclusion. Its header says removal is 5.2's; a correction goes in 0029's header, never by editing 0028.
- `apps/web/src/features/leave/services/leave-write.ts`
  - codes :32-36, outcome :40-48, `LeaveQuery` :68-74 (add `neq`), `LeaveTable` :80-83, SQLSTATEs :87-88;
  - `conflictOf` :182-219 (give it an excluded id), `recordLeave` :228-281.
- `apps/web/src/features/calendar/services/roster-write.ts` -- the shapes to mirror:
  - function constant :31, `ROSTER_GONE` :36, `RosterRemoval` :72-78, `NO_DATA_FOUND` :84;
  - `rosterRemovalFailureOf` :116-121, `settled` :124-152, `removeRosterOverride` :189-194.
  - Its tests are at `roster-write.test.ts:181`.
- `apps/web/src/features/leave/services/leave-list.ts:107-115` -- `readLeaveRecords` already filters `removed_at is null`. Unchanged here; 5.2b will add `id` to `LEAVE_RECORDS_COLUMNS` (:38).
- Test inventories:
  - `test/rls-isolation.test.ts:1143-1211`: the sorted `pg_proc` name list and expected list.
  - `test/provisioning.test.ts`: `ACCESS_CONTROL_FUNCTIONS` :1722 (amend has `argumentCount: 3`), `grantees` :1814, leave asserts :1423, :1451, and the no-trigger check :1475-1479.
  - `test/supabase-scaffold.test.ts:2142-2186`: the static model for a definer migration. Add one for 0029, and update the leave messages at :2188-2255.
- `test/rls-isolation.test.ts` leave describe, :16296 to the end:
  - helpers `insertLeave`, `overridesFingerprint`, `visibleLeave`, `restLeaveTable` (:16130-16225);
  - `actAs` :616, `inRolledBackTransaction` :293, `refused` :330;
  - the rpc wrapper model :15882, REST anon model :16080-16102;
  - replace the raw owner soft-remove at :16371, :16682 and :16726 with the function where that reads better.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0029_amend_remove_leave_record.sql` -- the two functions, header and grants -- the attributed write path 0028 deferred.
- [x] `apps/web/src/features/leave/services/leave-write.ts` (+`leave-write.test.ts`) -- `LEAVE_GONE`, the rpc seam, `removeLeave` and `amendLeave`, and the read-back that excludes the amended record -- the client contract 5.2b will call.
- [x] `test/rls-isolation.test.ts` -- a 5.2a describe covering every matrix row in SQL and REST, including that the balance from the live read drops by the removed cost and equals the new cost after an amend -- the node assertion the epic requires.
- [x] `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts` -- register the functions, add the static 0029 test, update the "removal is 5.2's" asserts.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- the 5.3 and 5.4 deferral entries (written at planning).

**Acceptance Criteria:**
- Given a member with allowance 20 and one live record costing 3, when the admin removes it, then the live read gives balance 20; when they instead amend it to a range costing 5, then the balance is 15 and exactly one record is live.
- Given any refused amend, when the transaction ends, then the original record is live and unchanged.

## Design Notes

Amend is remove plus insert, not an update in place. This follows 0027's "no in-place change" and keeps the old row as history. 5.4's "amend leave" resolution can then reference the new record's id. A link column from replacement to original was considered and left to Ask First: no AC needs it.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green, including the rls-isolation leave describes

## Suggested Review Order

**The write path (0029)**

- Entry point: soft-remove and insert in one call, so a refused insert rolls the removal back.
  [`0029_amend_remove_leave_record.sql:121`](../../supabase/migrations/0029_amend_remove_leave_record.sql#L121)

- The replacement takes the organization and member from the live row, not from the caller.
  [`0029_amend_remove_leave_record.sql:160`](../../supabase/migrations/0029_amend_remove_leave_record.sql#L160)

- The removal is attributed on the server, copied from 0027.
  [`0029_amend_remove_leave_record.sql:74`](../../supabase/migrations/0029_amend_remove_leave_record.sql#L74)

**Client contract**

- Amend: the new id, or a code; the overlap read-back names the other record.
  [`leave-write.ts:429`](../../apps/web/src/features/leave/services/leave-write.ts#L429)

- The read-back leaves the amended record out, so it never names itself.
  [`leave-write.ts:272`](../../apps/web/src/features/leave/services/leave-write.ts#L272)

- P0002 becomes `LEAVE_GONE`; 42501 `LEAVE_DENIED`; the rest `LEAVE_FAILED`.
  [`leave-write.ts:214`](../../apps/web/src/features/leave/services/leave-write.ts#L214)

- Removal through the rpc seam that mirrors `RosterRemoval`.
  [`leave-write.ts:384`](../../apps/web/src/features/leave/services/leave-write.ts#L384)

**Proof against the database**

- The balance from the live read: 17 → 20 on removal, 15 after amend.
  [`rls-isolation.test.ts:16864`](../../test/rls-isolation.test.ts#L16864)

- Amend keeps one live record, attributed, same member.
  [`rls-isolation.test.ts:16985`](../../test/rls-isolation.test.ts#L16985)

- Every refused amend leaves the original live and unchanged.
  [`rls-isolation.test.ts:17039`](../../test/rls-isolation.test.ts#L17039)

- The client mapping over real PostgREST.
  [`rls-isolation.test.ts:17243`](../../test/rls-isolation.test.ts#L17243)

**Peripherals**

- Unit cases for both client functions and every outcome code.
  [`leave-write.test.ts:281`](../../apps/web/src/features/leave/services/leave-write.test.ts#L281)

- The static shape test for 0029: no trigger, no policy, the grants.
  [`supabase-scaffold.test.ts:2239`](../../test/supabase-scaffold.test.ts#L2239)

- The definer and grantee inventories.
  [`provisioning.test.ts:1726`](../../test/provisioning.test.ts#L1726)
