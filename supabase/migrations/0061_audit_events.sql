-- 0061_audit_events.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 14.1: every change is recorded in the change history (CAP-24; AD-3 and
-- AD-11 as amended 2026-11-16; decision D4).
--
-- WHAT IT RECORDS. Every row write (INSERT, UPDATE that changes something,
-- DELETE) to the 21 audited organization tables becomes one `audit_events`
-- row in the writer's own transaction: the whole old and new rows as jsonb,
-- the request's `auth.uid()` as `actor`, the raw `current_setting('role')`,
-- `pg_current_xact_id()` and `now()`. One definer trigger function,
-- `private.record_audit_event()`, attached to each audited table as two AFTER
-- ROW triggers (`<table>_audit` on INSERT OR DELETE, `<table>_audit_update` on
-- UPDATE WHEN the row changed). It reads no other table, computes nothing,
-- refuses nothing and is not gated on `pg_trigger_depth()`, so a write made
-- inside a definer RPC or a nested trigger is recorded too (AD-3's second
-- permitted trigger class, which refuses nothing).
--
-- Excluded, as AD-11 names them: `audit_events` itself, `notification_outbox`,
-- `push_subscriptions` and `notification_settings`.
--
-- APPEND-ONLY BY PRIVILEGE. RLS is on (never forced) with one select policy,
-- an active admin's of the claimed organization. No session holds anything
-- but `authenticated` SELECT: no insert, update, delete or truncate, an
-- admin's and `service_role`'s included. Row triggers do not see TRUNCATE, so
-- TRUNCATE is also revoked on the 21 audited tables from `anon`,
-- `authenticated` and `service_role`. No refusing trigger guards the table.
--
-- NO FOREIGN KEY. History outlives what it records; a key to `organizations`
-- would abort the operator's organization delete on its own cascade's events.
--
-- THE BACKFILL, between its two literal marker lines at the end, runs after
-- every trigger exists, in this migration's one transaction (each CREATE
-- TRIGGER holds its table's lock to commit, so no write falls in the gap). It
-- reconstructs, with `origin = 'backfill'` and a null `transaction_id`, one
-- INSERT event per row of the 15 tables with `created_by`/`created_at`, one
-- UPDATE event per later attribution instant of a row (`confirmed_*`,
-- `removed_*`, `closed_*`, `answered_*` with `answer`; pairs of one row that
-- share an instant merged), one INSERT event per decision, and last one
-- `HISTORY_BEGINS` marker per existing organization.
--
-- UNRECOVERABLE BEFORE THIS MIGRATION: hard deletes and current-state edits
-- made before it (a rename, an archive flag, a member's details) were never
-- recorded, and no backfill can bring them back. A backfilled event carries
-- the row's other values as they stand at this migration, not as first
-- written. `organizations`, `members`, `hour_bands` and `absence_types` carry
-- no author column and get no backfilled event; their history begins at the
-- marker.
--
-- DEPLOY ORDER: `db push` alone, outside the pilot's working hours (each
-- CREATE TRIGGER holds its table's lock until the migration commits). No SPA or Edge Function change;
-- story 14.2's SPA ships after this.

-- ------------------------------------------------------------------ the table

create table audit_events (
  -- Q3: the tenant first. NO foreign key (AD-11).
  organization_id uuid not null,

  -- Write order. Never named by a session (`generated always`, and no grant).
  id bigint generated always as identity primary key,

  -- The audited table, and the audited row's key as text.
  table_name text not null,
  operation text not null,
  row_id text not null,

  -- Whole rows, never a diff; null where the operation has none.
  old_row jsonb,
  new_row jsonb,

  -- `auth.uid()`, null for a write with no JWT user (an owner, GoTrue's
  -- cascade, `service_role`), and the raw `current_setting('role')`.
  actor uuid,
  session_role text not null,

  origin text not null,

  -- `pg_current_xact_id()` on a live event; null on a backfilled one.
  transaction_id xid8,

  occurred_at timestamptz not null default now(),

  constraint audit_events_operation_known
    check (operation in ('INSERT', 'UPDATE', 'DELETE', 'HISTORY_BEGINS')),

  constraint audit_events_origin_known
    check (origin in ('trigger', 'backfill')),

  constraint audit_events_transaction_by_origin
    check ((origin = 'trigger') = (transaction_id is not null)),

  constraint audit_events_rows_by_operation
    check (
      (operation = 'INSERT' and old_row is null and new_row is not null)
      or (operation = 'UPDATE' and old_row is not null and new_row is not null)
      or (operation = 'DELETE' and old_row is not null and new_row is null)
      or (operation = 'HISTORY_BEGINS' and old_row is null and new_row is null and origin = 'backfill')
    )
);

-- The one read: one organization's period, newest first, keyset-paged.
create index audit_events_organization_occurred_idx
  on audit_events (organization_id, occurred_at desc, id desc);

alter table audit_events enable row level security;

-- ------------------------------------------------------------------ the policy

-- D4: an active admin of the claimed organization reads its events, and
-- nobody else reads any. 0055's insert policy, as a read.
create policy audit_events_select_by_own_active_admin on public.audit_events
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- -------------------------------------------------------------- the privileges

-- Supabase's default privileges grant every table and sequence privilege to
-- `anon`, `authenticated` and `service_role`. Take them all, TRUNCATE
-- included, then give `authenticated` its read alone.
revoke all on table public.audit_events from public, anon, authenticated, service_role;
grant select on table public.audit_events to authenticated;
revoke all on sequence public.audit_events_id_seq from public, anon, authenticated, service_role;

-- -------------------------------------------------------------- the recorder

-- Copies and inserts. `tg_argv[0]` names the organization column and
-- `tg_argv[1]` the key column. `current_setting('role')` is the session's SET
-- ROLE, which a definer does not change.
create function private.record_audit_event() returns trigger
language plpgsql
security definer
set search_path = ''
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

-- --------------------------------------------------------------- the triggers

create trigger organizations_audit after insert or delete on public.organizations
  for each row execute function private.record_audit_event('id', 'id');
create trigger organizations_audit_update after update on public.organizations
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('id', 'id');

create trigger members_audit after insert or delete on public.members
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger members_audit_update after update on public.members
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger member_status_versions_audit after insert or delete on public.member_status_versions
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger member_status_versions_audit_update after update on public.member_status_versions
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger team_membership_versions_audit after insert or delete on public.team_membership_versions
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger team_membership_versions_audit_update after update on public.team_membership_versions
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger teams_audit after insert or delete on public.teams
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger teams_audit_update after update on public.teams
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger hour_bands_audit after insert or delete on public.hour_bands
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger hour_bands_audit_update after update on public.hour_bands
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger shift_types_audit after insert or delete on public.shift_types
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger shift_types_audit_update after update on public.shift_types
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger shift_type_versions_audit after insert or delete on public.shift_type_versions
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger shift_type_versions_audit_update after update on public.shift_type_versions
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger rotation_patterns_audit after insert or delete on public.rotation_patterns
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger rotation_patterns_audit_update after update on public.rotation_patterns
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger rotation_steps_audit after insert or delete on public.rotation_steps
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger rotation_steps_audit_update after update on public.rotation_steps
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger rotation_assignments_audit after insert or delete on public.rotation_assignments
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger rotation_assignments_audit_update after update on public.rotation_assignments
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger shift_type_overrides_audit after insert or delete on public.shift_type_overrides
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger shift_type_overrides_audit_update after update on public.shift_type_overrides
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger roster_overrides_audit after insert or delete on public.roster_overrides
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger roster_overrides_audit_update after update on public.roster_overrides
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger leave_records_audit after insert or delete on public.leave_records
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger leave_records_audit_update after update on public.leave_records
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger conflict_resolutions_audit after insert or delete on public.conflict_resolutions
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger conflict_resolutions_audit_update after update on public.conflict_resolutions
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger leave_requests_audit after insert or delete on public.leave_requests
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger leave_requests_audit_update after update on public.leave_requests
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger leave_request_decisions_audit after insert or delete on public.leave_request_decisions
  for each row execute function private.record_audit_event('organization_id', 'request_id');
create trigger leave_request_decisions_audit_update after update on public.leave_request_decisions
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'request_id');

create trigger swap_requests_audit after insert or delete on public.swap_requests
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger swap_requests_audit_update after update on public.swap_requests
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger swap_request_decisions_audit after insert or delete on public.swap_request_decisions
  for each row execute function private.record_audit_event('organization_id', 'request_id');
create trigger swap_request_decisions_audit_update after update on public.swap_request_decisions
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'request_id');

create trigger absence_types_audit after insert or delete on public.absence_types
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger absence_types_audit_update after update on public.absence_types
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

create trigger leave_allowances_audit after insert or delete on public.leave_allowances
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger leave_allowances_audit_update after update on public.leave_allowances
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');

-- Nothing calls it by hand; Postgres checks EXECUTE when a trigger is created,
-- not when it fires (0052's note).
revoke execute on function private.record_audit_event() from public, anon, authenticated, service_role;

-- Row triggers do not see TRUNCATE. PostgREST never issues it; this closes
-- direct SQL for every session role.
revoke truncate on table
  public.organizations, public.members, public.member_status_versions,
  public.team_membership_versions, public.teams, public.hour_bands,
  public.shift_types, public.shift_type_versions, public.rotation_patterns,
  public.rotation_steps, public.rotation_assignments, public.shift_type_overrides,
  public.roster_overrides, public.leave_records, public.conflict_resolutions,
  public.leave_requests, public.leave_request_decisions, public.swap_requests,
  public.swap_request_decisions, public.absence_types, public.leave_allowances
  from anon, authenticated, service_role;

-- ---------------------------------------------------------------- the backfill
--
-- DML alone, two statements: every dated event in one statement, ordered by
-- its instant (an INSERT before an UPDATE of the same instant) so the ids
-- follow time; then the markers. Each source row is read as
-- `pg_catalog.to_jsonb(r)` and its keys with `->>`, so `row_id` and the row
-- shapes are exactly what a live event holds.
--
-- `pairs` is the static map of later attribution pairs: (table, rank, the
-- instant's column, the author's column, every column the pair sets). The
-- INSERT event's `new_row` nulls every pair of its table; an UPDATE event at
-- instant t has `old_row` with every pair at or after t nulled and `new_row`
-- with every pair after t nulled, and its author is the lowest-rank pair at t.
-- `'null'::jsonb` values, and `coalesce(…, '{}')` because an empty
-- `jsonb_object_agg` is SQL null and `row || null` is null.

-- BACKFILL BEGINS
with pairs (table_name, rank, at_column, by_column, columns) as (
  values
    ('shift_type_overrides', 1, 'confirmed_at', 'confirmed_by', array['confirmed_by', 'confirmed_at']),
    ('shift_type_overrides', 2, 'removed_at', 'removed_by', array['removed_by', 'removed_at']),
    ('roster_overrides', 1, 'confirmed_at', 'confirmed_by', array['confirmed_by', 'confirmed_at']),
    ('roster_overrides', 2, 'removed_at', 'removed_by', array['removed_by', 'removed_at']),
    ('leave_records', 1, 'removed_at', 'removed_by', array['removed_by', 'removed_at']),
    ('conflict_resolutions', 1, 'removed_at', 'removed_by', array['removed_by', 'removed_at']),
    ('leave_requests', 1, 'closed_at', 'closed_by', array['closed_by', 'closed_at']),
    ('swap_requests', 1, 'answered_at', 'answered_by', array['answer', 'answered_by', 'answered_at']),
    ('swap_requests', 2, 'closed_at', 'closed_by', array['closed_by', 'closed_at'])
),
attributed (table_name, source) as (
  select 'member_status_versions', pg_catalog.to_jsonb(r) from public.member_status_versions as r
  union all
  select 'teams', pg_catalog.to_jsonb(r) from public.teams as r
  union all
  select 'team_membership_versions', pg_catalog.to_jsonb(r) from public.team_membership_versions as r
  union all
  select 'shift_types', pg_catalog.to_jsonb(r) from public.shift_types as r
  union all
  select 'shift_type_versions', pg_catalog.to_jsonb(r) from public.shift_type_versions as r
  union all
  select 'rotation_patterns', pg_catalog.to_jsonb(r) from public.rotation_patterns as r
  union all
  select 'rotation_steps', pg_catalog.to_jsonb(r) from public.rotation_steps as r
  union all
  select 'rotation_assignments', pg_catalog.to_jsonb(r) from public.rotation_assignments as r
  union all
  select 'shift_type_overrides', pg_catalog.to_jsonb(r) from public.shift_type_overrides as r
  union all
  select 'roster_overrides', pg_catalog.to_jsonb(r) from public.roster_overrides as r
  union all
  select 'leave_records', pg_catalog.to_jsonb(r) from public.leave_records as r
  union all
  select 'conflict_resolutions', pg_catalog.to_jsonb(r) from public.conflict_resolutions as r
  union all
  select 'leave_requests', pg_catalog.to_jsonb(r) from public.leave_requests as r
  union all
  select 'swap_requests', pg_catalog.to_jsonb(r) from public.swap_requests as r
  union all
  select 'leave_allowances', pg_catalog.to_jsonb(r) from public.leave_allowances as r
),
decided (table_name, source) as (
  select 'leave_request_decisions', pg_catalog.to_jsonb(r) from public.leave_request_decisions as r
  union all
  select 'swap_request_decisions', pg_catalog.to_jsonb(r) from public.swap_request_decisions as r
),
instants (table_name, source, instant) as (
  select distinct attributed.table_name, attributed.source, (attributed.source ->> pairs.at_column)::timestamptz
    from attributed
    join pairs on pairs.table_name = attributed.table_name
   where attributed.source ->> pairs.at_column is not null
),
events (table_name, operation, source, row_id, old_row, new_row, actor, occurred_at, step) as (
  select attributed.table_name,
         'INSERT',
         attributed.source,
         attributed.source ->> 'id',
         null::jsonb,
         attributed.source || coalesce((
           select pg_catalog.jsonb_object_agg(pair_column, 'null'::jsonb)
             from pairs
             cross join lateral pg_catalog.unnest(pairs.columns) as pair_column
            where pairs.table_name = attributed.table_name
         ), '{}'::jsonb),
         (attributed.source ->> 'created_by')::uuid,
         (attributed.source ->> 'created_at')::timestamptz,
         0
    from attributed
  union all
  select instants.table_name,
         'UPDATE',
         instants.source,
         instants.source ->> 'id',
         instants.source || coalesce((
           select pg_catalog.jsonb_object_agg(pair_column, 'null'::jsonb)
             from pairs
             cross join lateral pg_catalog.unnest(pairs.columns) as pair_column
            where pairs.table_name = instants.table_name
              and (instants.source ->> pairs.at_column)::timestamptz >= instants.instant
         ), '{}'::jsonb),
         instants.source || coalesce((
           select pg_catalog.jsonb_object_agg(pair_column, 'null'::jsonb)
             from pairs
             cross join lateral pg_catalog.unnest(pairs.columns) as pair_column
            where pairs.table_name = instants.table_name
              and (instants.source ->> pairs.at_column)::timestamptz > instants.instant
         ), '{}'::jsonb),
         (
           select (instants.source ->> pairs.by_column)::uuid
             from pairs
            where pairs.table_name = instants.table_name
              and (instants.source ->> pairs.at_column)::timestamptz = instants.instant
            order by pairs.rank
            limit 1
         ),
         instants.instant,
         1
    from instants
  union all
  select decided.table_name,
         'INSERT',
         decided.source,
         decided.source ->> 'request_id',
         null::jsonb,
         decided.source,
         (decided.source ->> 'decided_by')::uuid,
         (decided.source ->> 'decided_at')::timestamptz,
         0
    from decided
)
insert into public.audit_events (organization_id, table_name, operation, row_id, old_row, new_row,
                                 actor, session_role, origin, transaction_id, occurred_at)
select (events.source ->> 'organization_id')::uuid,
       events.table_name,
       events.operation,
       events.row_id,
       events.old_row,
       events.new_row,
       events.actor,
       pg_catalog.current_setting('role'),
       'backfill',
       null::xid8,
       events.occurred_at
  from events
 order by events.occurred_at, events.step, events.table_name, events.row_id;

insert into public.audit_events (organization_id, table_name, operation, row_id, old_row, new_row,
                                 actor, session_role, origin, transaction_id, occurred_at)
select organization.id,
       'organizations',
       'HISTORY_BEGINS',
       organization.id::text,
       null::jsonb,
       null::jsonb,
       null::uuid,
       pg_catalog.current_setting('role'),
       'backfill',
       null::xid8,
       pg_catalog.now()
  from public.organizations as organization
 order by organization.id;
-- BACKFILL ENDS
