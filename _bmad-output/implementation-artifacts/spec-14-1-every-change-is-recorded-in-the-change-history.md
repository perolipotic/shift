---
title: 'Story 14.1: Every change is recorded in the change history'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_revision: '820db3e5c8668091d71211fe1fbd0f922f6c8a41'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
warnings: [oversized]
deferred:
  - summary: >-
      0061 sets no lock_timeout, so a long transaction holding a lock on an audited table can make the push wait while writers queue behind it.
    evidence: |-
      Edge case and blind review: 42 CREATE TRIGGERs take SHARE ROW EXCLUSIVE on 21 tables in one transaction; DEPLOY.md mitigates by pushing outside working hours. Whether the CLI wraps the file in one transaction (needed for `set local`) is unverified here.
    location: >-
      supabase/migrations/0061_audit_events.sql
    severity: low
  - summary: >-
      No index serves a read of audit_events by transaction_id or by (table_name, row_id); 14.2 should decide whether its amend pairing and any per-record read need one.
    evidence: |-
      Blind review: the only index is (organization_id, occurred_at desc, id desc); 14.2 reads one period by keyset and pairs in the browser, so the need depends on 14.2's design.
    location: >-
      supabase/migrations/0061_audit_events.sql
    severity: low
---

<intent-contract>

## Intent

**Problem:** Q12 (amended) asks that every write to an organization's records can be reconstructed — author, time, before and after — but today only some rows carry attribution columns, current-state edits overwrite their past, and a hard delete leaves no trace.

**Approach:** One forward-only migration applies the Architect pass's AD-3/AD-11 amendments exactly: an append-only `audit_events` table, one definer trigger function `private.record_audit_event()` attached as two AFTER ROW triggers to each of the 21 audited tables, admin-only read (D4), append-only by privilege, and a backfill from the attribution columns plus a `HISTORY_BEGINS` marker. Static pins (run locally) and DB tests (CI) prove it. No UI (14.2), no domain module (14.2), no PDF (14.3).

## Boundaries & Constraints

**Always:**
- The binding design is the spine's AD-3 and AD-11 "Amended 2026-11-16" clauses, the "Change history" conventions row, the CAP-24 row and the Deferred entries (rationale in `.memlog.md` beside the spine). Implement them exactly; where code reality forces a difference, follow the code and amend the spine in the same change.
- The trigger function copies and inserts; it reads no other table, computes nothing, refuses nothing, and is not gated on `pg_trigger_depth()`.
- `audit_events` has no foreign key; one index `(organization_id, occurred_at desc, id desc)`; RLS enabled, never forced.
- STRICT DATABASE RULE: never apply the migration to the local stack, never run a DB-connecting root test locally. DB tests are written unrun; CI is the gate.
- DB-free root tests (`test/resource-hygiene.test.ts`, `test/supabase-scaffold.test.ts`, `test/import-cycles.test.ts`, `test/feature-boundaries.test.ts`, `test/key-hygiene.test.ts`) run locally and pass.
- Existing DB tests that pin an exact trigger list on an audited table are updated in the same change (unrun) so they keep pinning the story's own triggers.

**Block If:**
- Implementing the design would need a product-scope change, a paid service, a credential, or an irreversible data action outside the agreed design.

**Never:**
- No change history UI, no `packages/domain` history module, no PDF, no SPA or Edge Function change.
- No refusing trigger on `audit_events` or anywhere else; no constraint trigger.
- No insert/update/delete policy on `audit_events`; no session privilege beyond `authenticated` SELECT.
- No column pruning; no audit triggers on `notification_outbox`, `push_subscriptions`, `notification_settings` or `audit_events`.
- No `replaced_by`/`amended_from` link column (lineage is the shared `transaction_id`, read by 14.2).
- Never `supabase db reset`, `migration up`, `psql` writes, or e2e against the shared stack.

</intent-contract>

## Code Map

- `supabase/migrations/0060_half_day_notifications.sql` -- highest existing migration; the new file is `0061_audit_events.sql` (scaffold test enforces contiguous `NNNN_snake.sql`).
- `supabase/migrations/0055_leave_allowances.sql` -- house style for a new table: forward-only header, `organization_id` first, `bigint generated always as identity`, RLS on, policy pinning claim + `public.current_member_access()` (returns `organization_id, member_role, is_active`), revokes then grants.
- `supabase/migrations/0052_absence_types.sql:178-197` -- house style for a definer trigger function in `private` (`returns trigger`, `security definer`, `set search_path = ''`, `return null`, revoke execute from `public, anon, authenticated, service_role`); 13.1's `organizations_seed_absence_types` is the computing-nothing class AD-3 now names.
- The 24 organization tables and their columns (all `organization_id` first except `organizations`): attribution `created_by`/`created_at` on exactly 15 — `member_status_versions, teams, team_membership_versions, shift_types, shift_type_versions, rotation_patterns, rotation_steps, rotation_assignments, shift_type_overrides, roster_overrides, leave_records, conflict_resolutions, leave_requests, swap_requests, leave_allowances`. Later lifecycle pairs: `shift_type_overrides` and `roster_overrides` (`confirmed_by/confirmed_at` from 0022/0039, `removed_by/removed_at`); `leave_records`, `conflict_resolutions` (`removed_*`); `leave_requests` (`closed_*`); `swap_requests` (`answer`+`answered_by`+`answered_at`, then `closed_*`). Decision tables `leave_request_decisions`, `swap_request_decisions`: key `request_id`, `decided_by/decided_at`. `leave_allowances.id` is bigint; `absence_types` key is `(organization_id, id)`. No author column: `organizations, members, hour_bands, absence_types`.
- `test/supabase-scaffold.test.ts` -- static pins. Helpers `migrationNames`, `migrationStatements` (comments stripped), `stripLineComments`, `policyDeclarations`, `columnsOf` (inside a describe), `policyBody` (inside 'the access-control migration' describe). `:483` test title "sixty policies" and `:527-655` declared policy list need `audit_events_select_by_own_active_admin` (title becomes sixty-one, 14.1 named). The 13.x per-migration pins (`:3264` on) are the style for the new 0061 block.
- `test/provisioning.test.ts` -- catalog pins (CI only). `:688-752` RLS table list (add `audit_events`). Definer list `ACCESS_CONTROL_FUNCTIONS` ending `:2436` and `grantees` list ending `:2634` (add `record_audit_event`, schema `private`, argumentCount 0, expected `[]`). Exact trigger pins on audited tables that the new triggers would break — add `and tgfoid <> 'private.record_audit_event()'::regprocedure` to each query: `:1561-1566` (conflict_resolutions), `:1634-1642` (leave_records), `:1713-1716` (leave_allowances), `:1804-1814` (organizations, absence_types), `:1957-1970` (leave_requests/decisions), `:2084-2100` (swap tables + `member_status_versions_close_swap_requests`). `heldPrivileges` helper `:1170` (anon, authenticated).
- `test/rls-isolation.test.ts` -- behaviour tests (CI only). Helpers: `actAs(client, authUserId, org)` (sets `request.jwt.claims` + `set local role authenticated`), `actAsOwner`, `refusedThenContinue`, `memberByUsername`, `addThrowawayAdmin`, `organizationDay`, `ownerVersion` (deactivate), `tokenFor`, `rest`, `restRows`, `restRefusal`, `seededTeam(client, org, 'Smjena B')`, `seededShiftType(client, org, 'Slobodno')`, `FIXTURES`, `CROSS_TENANT`, `noApi`. Policy inventory `:940-1060` (add the new policy, alphabetical first). Style template: the 13.3 block at `:26550-26760`.
- `test/concurrent-writes.test.ts:1853-1925` -- trigger inventory filtered by function oid; unaffected (left).
- `e2e/utils/database-helper.ts`, `test/demo-organization.test.ts`, `test/e2e-fixture.test.ts` -- checked: no assertion counts or empties `audit_events`, no TRUNCATE by a session role; the new table has no FK, so the e2e cleanup is left unchanged.
- `scripts/ci/check-migrations.mjs` -- compares a `supabase migration list` output (local vs remote); needs a linked project, nothing to satisfy locally. Left.
- `DEPLOY.md:792-845` -- epic 13 deploy-order notes (retro A4); the 0061 note goes after them. `DEPLOY.md:1052` TRUNCATE section gets one sentence on the revoke.
- `_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md` -- AD-3 and AD-11 amendments (lines ~88 and ~141-154).
- `_bmad-output/implementation-artifacts/deferred-work.md:504`, `:655`, `:1407` -- entries addressed to Epic 14/14.1 (see Design Notes).

## Tasks & Acceptance

**Execution:**
- `supabase/migrations/0061_audit_events.sql` -- create: header (forward-only, story, what it records, the unrecoverable-before statement, deploy order); the table; the index; RLS + the one select policy; revokes/grants on `audit_events` and its identity sequence; `private.record_audit_event()`; the 42 triggers on the 21 tables; TRUNCATE revoke on the 21 tables; then the backfill between the literal marker lines `-- BACKFILL BEGINS` and `-- BACKFILL ENDS` (its statements only), then nothing else. Exact shapes in Design Notes.
- `test/supabase-scaffold.test.ts` -- add a describe/it block for story 14.1 (source text only): table columns exact list and types; no `references` in the table; the index; RLS enabled, not forced; the one policy (select, to authenticated, claim + `member_role = 'admin'` + `is_active`); the revoke-all and the only grant; function attributes (definer, `search_path = ''`, `returns trigger`, `pg_current_xact_id()`, `auth.uid()`, `current_setting('role')`, no `raise`, no `pg_trigger_depth`, no `from public.` read); execute revoke; TRUNCATE revoke naming all 21 tables. THE PIN: every `create table` whose first column is `organization_id` (plus `organizations`) is either audited — both triggers declared with the exact shape and the expected `tg_argv` — or in the excluded list exactly `audit_events, notification_outbox, notification_settings, push_subscriptions`; the audited set equals the 21 exactly; non-vacuity (≥ 25 tables read, and the matcher fails a synthetic unaudited table). Also: no migration other than 0061 writes `audit_events` (`insert into|update|delete from` it). Update the declared policy list and title.
- `test/provisioning.test.ts` -- add `audit_events` to the RLS list; `record_audit_event` to both definer lists; a new test: privileges on `audit_events` for `anon, authenticated, service_role` are exactly `authenticated:SELECT`; no session role holds TRUNCATE on any of the 21; no FK on `audit_events`; the index def; exactly one policy; for each of the 21 tables exactly the two audit triggers with the expected `tgtype` (INSERT|DELETE row after; UPDATE row after with a WHEN of `old.* IS DISTINCT FROM new.*`) and args; the 3 excluded organization tables plus `audit_events` carry none. Add the `tgfoid` filter to the six existing exact trigger pins listed in the Code Map.
- `test/rls-isolation.test.ts` -- add the policy to the inventory; add a story 14.1 describe block (see Acceptance Criteria for the cases).
- `DEPLOY.md` -- deploy-order note for `0061`; TRUNCATE note.
- `_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md` -- add `Applied 2026-11-16 (story 14.1, 0061)` clauses to AD-3's and AD-11's 2026-11-16 amendments recording the migration number and any refinements the code made (shape checks, sequence revoke, backfill `session_role`, id order) — SPINE AMENDMENTS ARE TASKS.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the three entries RESOLVED by story 14.1 (2026-11-16) with the answers in Design Notes.

**Acceptance Criteria:**
- Given any of the 21 audited tables, when a row is inserted, updated (changing something) or deleted by a request session, then exactly one `audit_events` row is written in the same transaction with `operation`, `table_name`, `row_id`, whole `old_row`/`new_row` (null where none), `actor = auth.uid()`, `session_role = 'authenticated'`, `origin = 'trigger'`, `transaction_id = pg_current_xact_id()`.
- Given an UPDATE that changes no column, when it runs, then no event is written.
- Given an owner write (no JWT), when it runs, then the event's `actor` is null and `session_role` is the raw role setting.
- Given RLS on `audit_events`, when a member-role account or an inactive admin reads (SQL session or a real PostgREST call with its token), then it reads nothing; when an active admin reads, then it reads its own organization's events and never another's; `anon` and `service_role` are refused the read.
- Given any session (admin included, and `service_role`), when it attempts INSERT, UPDATE, DELETE or TRUNCATE on `audit_events`, or TRUNCATE on an audited table, then it is refused (42501); a PostgREST POST to `audit_events` with an admin token is refused.
- Given rows that existed before the migration, when the backfill runs, then: each attributed row has one `INSERT` event at `created_at` by `created_by` with later pairs nulled; each later pair (same-instant pairs merged) one `UPDATE` event at its instant by its author with whole rows; each decision one `INSERT` event at `decided_at` by `decided_by` with `row_id` = request id; `organizations, members, hour_bands, absence_types` none; one `HISTORY_BEGINS` per organization with null rows and actor. (A DB test runs the migration's backfill block — DML only — inside a rolled-back transaction on CI's fresh stack.)
- Given `pnpm exec vitest run test/supabase-scaffold.test.ts`, when a new organization-scoped table is neither audited nor named excluded, then it fails.

## Spec Change Log

## Review Triage Log

### 2026-11-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 1, medium 3, low 2)
- defer: 2 (low 2)
- reject: 8 (low 8)
- addressed_findings:
  - `[high]` `[patch]` The owner-write case kept the earlier `actAs` claims (`actAsOwner` only resets the role), so `auth.uid()` would credit the admin; added `actAsSystem`, which clears both claim settings and asserts `auth.uid()` is null.
  - `[medium]` `[patch]` The backfill test covered only two of the six pair tables; it now stages declined and accepted-then-closed swaps and removals on roster overrides, leave records and conflict resolutions, asserted exactly, plus an independent count of the expected UPDATE events.
  - `[medium]` `[patch]` No behaviour test of a nested-trigger write; added the deactivation's swap close, credited to the admin in the admin's transaction.
  - `[medium]` `[patch]` The amend-lineage answer in deferred-work had no proof; added an `amend_leave_record` case (removal and replacement share one transaction_id).
  - `[low]` `[patch]` Scaffold pin hardened: any table spelling, `organization_id` anywhere, later migrations may not disable, drop, replace or grant on the recorder or table, a later audited table must revoke TRUNCATE, and the backfill's source tables are pinned from the schema.
  - `[low]` `[patch]` Docs: DEPLOY.md names the production approval as the off-hours step and `session_role = 'none'`; deferred-work lineage entries say how a pre-0061 amend pairs; Epic AC Deviations adds "updated" read as "changed".

## Design Notes

**Function and triggers (golden shape):**
```sql
create function private.record_audit_event() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then pg_catalog.to_jsonb(old) end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then pg_catalog.to_jsonb(new) end;
  written jsonb := coalesce(new_row, old_row);
begin
  insert into public.audit_events (organization_id, table_name, operation, row_id, old_row, new_row,
                                   actor, session_role, origin, transaction_id)
  values ((written ->> tg_argv[0])::uuid, tg_table_name, tg_op, written ->> tg_argv[1], old_row, new_row,
          auth.uid(), pg_catalog.current_setting('role'), 'trigger', pg_catalog.pg_current_xact_id());
  return null;
end;
$$;
create trigger teams_audit after insert or delete on public.teams
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger teams_audit_update after update on public.teams
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');
```
`tg_argv`: `organizations` → `('id', 'id')`; the two decision tables → `('organization_id', 'request_id')`; the other 18 → `('organization_id', 'id')`. Execute is checked at CREATE TRIGGER, not at fire time, so revoking it from every role is safe (0052's note). `current_setting('role')` is the session's SET ROLE, unchanged inside a definer.

**Table:** columns in this order: `organization_id uuid not null`, `id bigint generated always as identity primary key`, `table_name text not null`, `operation text not null`, `row_id text not null`, `old_row jsonb`, `new_row jsonb`, `actor uuid`, `session_role text not null`, `origin text not null`, `transaction_id xid8`, `occurred_at timestamptz not null default now()`. Named shape checks the trigger always satisfies: `audit_events_operation_known` (four values), `audit_events_origin_known`, `audit_events_transaction_by_origin` (`(origin = 'trigger') = (transaction_id is not null)`), `audit_events_rows_by_operation` (INSERT: new only; UPDATE: both; DELETE: old only; HISTORY_BEGINS: neither, and backfill origin). Revoke `all` on the table from `public, anon, authenticated, service_role`, then `grant select ... to authenticated`; revoke all on sequence `public.audit_events_id_seq` from the same four.

**Policy:** `audit_events_select_by_own_active_admin` for select to authenticated using `organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid and organization_id = (select access.organization_id from public.current_member_access() as access where access.is_active and access.member_role = 'admin')` (0055's insert policy, as a read).

**Backfill (one `insert ... select` per kind, between the markers, after every trigger exists):** build each source row as `pg_catalog.to_jsonb(r)`, read keys with `->>`, so `row_id` and row shapes match live events exactly. A static map of lifecycle pairs `(table, rank, at_column, by_column, columns[])` drives the nulling: INSERT event `new_row = row || {every pair column of that table: null}`; for each distinct non-null pair instant `t` of a row, one UPDATE event with `old_row = row || {columns of pairs with at >= t: null}`, `new_row = row || {columns of pairs with at > t: null}`, actor = author of the lowest-rank pair at `t`. Use `'null'::jsonb` values and `coalesce(..., '{}'::jsonb)` (an empty `jsonb_object_agg` is SQL null, and `row || null` is null). `session_role = current_setting('role')`, `origin = 'backfill'`, `transaction_id` null. Insert the attributed and decision events ordered by `occurred_at`, INSERT before UPDATE, so ids follow time. Last, the `HISTORY_BEGINS` statement from `public.organizations`.

**Deferrals addressed to Epic 14 (inputs, answered):** (1) 3.5c amend lineage (`deferred-work.md:504`) and (2) 5.2a replacement link (`:655`): no link column — `amend_shift_type_override`, `amend_roster_override` and `amend_leave_record` remove and insert in one call, so the removal's UPDATE event and the replacement's INSERT event share one `transaction_id`; 14.2's domain reads an amend from that. (3) 13.1 absence-type attribution (`:1407`): `absence_types` is audited, so every create, rename and `draws_allowance` change is an event with its author; no attribution column is added.

## Epic AC Deviations

- "a member-role account reads … nothing, through the UI or a direct API call": the direct API call and SQL sessions are proven here; no history UI exists until 14.2, whose read is a PostgREST select under this same policy. Reinterpreted (UI half proven by construction; 14.2 adds its own surface tests).
- AC 1's "updated": an UPDATE that changes no column records no event (the trigger's `WHEN (old.* IS DISTINCT FROM new.*)`, AD-3 as amended), so "updated" reads as "changed". Reinterpreted.
- "deletions before it are stated as unrecoverable": stated in the migration header, DEPLOY.md and the spine; the on-screen statement of where history begins is 14.2's (`HISTORY_BEGINS`). Reinterpreted.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: exit 0.
- `pnpm lint` -- expected: exit 0.
- `pnpm -r test` -- expected: pass except the 4 known Node-22 `ERR_NO_TYPESCRIPT` cases in `apps/web/src/lib/i18n/format.test.ts`.
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts test/key-hygiene.test.ts` -- expected: all pass.

**Manual checks (if no CLI):**
- The migration, the provisioning and rls-isolation additions are NOT run locally (STRICT DATABASE RULE; no local stack). CI's fresh stack (`pnpm test`, zero skipped) is the gate. Re-read the SQL against 0052/0055 conventions and Postgres semantics before committing.
- `scripts/ci/check-migrations.mjs` needs a linked project's migration listing; not runnable here.

## Auto Run Result

Status: done (review complete; the DB tests are unrun locally and CI is the gate).

**Summary:** Migration `0061_audit_events.sql` adds the append-only `audit_events` table (no foreign key, one read index, four shape checks), the admin-only select policy (D4), the revokes (all from the session roles on the table and its sequence; `authenticated` keeps SELECT only; TRUNCATE revoked on the 21 audited tables), the definer recorder `private.record_audit_event()` as 42 AFTER ROW triggers, and the backfill (INSERT and UPDATE events from the attribution columns, decision events, and one `HISTORY_BEGINS` per organization). This follows the spine's AD-3 and AD-11 amendments of 2026-11-16.

**Files changed:**
- `supabase/migrations/0061_audit_events.sql`: new; the migration.
- `test/supabase-scaffold.test.ts`: the 14.1 pins; every organization table is audited or named excluded; the guards on later migrations; the policy list (61).
- `test/provisioning.test.ts`: `audit_events` catalog, privileges, triggers and definer pins; recorder filter on six existing trigger pins.
- `test/rls-isolation.test.ts`: 14.1 behaviour (recording, no-op update, owner, nested, amend lineage, reads by role, refusals, PostgREST, backfill block in a rolled-back transaction); policy inventory.
- `DEPLOY.md`: 0061 deploy-order note; TRUNCATE note.
- `ARCHITECTURE-SPINE.md`: "Applied (story 14.1, 0061)" clauses on AD-3 and AD-11.
- `deferred-work.md`: three Epic 14 entries resolved.
- `sprint-status.yaml`, `epic-14-context.md`, this spec.

**Review:** 6 patches applied (1 high, 3 medium, 2 low), 2 deferred, 8 rejected. Rejected: stale-claims attribution in owner sessions (by design: actor = `auth.uid()`); a pair instant before `created_at`; GDPR erasure (already in the spine's Deferred); test-list duplication; `session_user` recording; future-dated fixtures; HISTORY_BEGINS semantics (in the spine); the backfill's "values as at the migration" caveat (stated).

**Follow-up review:** recommended. A high-severity patch was applied (patched high 1, medium 3, low 2; score 3×3+2 = 11).

**Verification:** `pnpm typecheck` 0; `pnpm lint` 0; the 5 DB-free root tests passed 1896 (2 skipped); `pnpm -r test` passes except the 4 known Node-22 `format.test.ts` cases and a `leave-overview` property test that timed out under load and passes on rerun. The implementer also applied 0061 to stub tables in a throwaway PGlite in the scratchpad (not the local stack): the backfill, live recording, the no-op update, refusals and trigger definitions behaved as specified. `check-migrations.mjs` needs a linked project's listing and was not run.

**Residual risks:** The provisioning and rls-isolation additions have never run against Supabase (PostgREST status codes, GoTrue tokens, seed details). The amend-lineage case commits a leave record and deletes it in `finally`. Production push must be approved outside working hours (table locks).

