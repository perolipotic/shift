-- 0035_serialize_teams_rotation_and_definers.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- 0023's per-organization lock, extended to the writes it left out, a fresh
-- re-check of the caller behind it, and a concurrency token on the override
-- confirmation. Five deferred-work entries, closed together because each one
-- leans on the same lock.
--
-- 1. A TEAM ARCHIVE WAITS, AND AN ASSIGNMENT RE-READS THE TEAM (0010's KNOWN
--    GAP, as 0023 narrowed it). `serialize_organization_writes()` now fires
--    BEFORE STATEMENT on `update of archived on teams`. In each order:
--
--      * an assignment first, the archive waiting: the archive's WITH CHECK
--        asks `team_in_use`, a VOLATILE reader, after the lock, sees the
--        committed version and refuses (42501). The lock alone closes this.
--      * the archive first, an assignment waiting: the insert policy reads
--        `teams.archived` inline, on the statement's snapshot, taken before
--        the wait, and still sees the team active. The re-check below reads it
--        again after the lock and refuses (42501, the policy's own refusal).
--
--    A rename names `name` only, fires nothing, and waits on nobody.
--
-- 2. ROTATION WRITES WAIT (0016's and 0025's KNOWN GAP). The lock fires BEFORE
--    STATEMENT on insert and delete of `rotation_steps` and
--    `rotation_assignments`, the only verbs a session holds on them. Every
--    rule those policies state reads through a VOLATILE reader
--    (`rotation_pattern_in_use`, `rotation_assignment_latest_version`,
--    `rotation_assignment_on`), so after the lock each sees the commit it
--    waited for: a step insert or delete and a first assignment of the same
--    pattern no longer both pass, and neither do two assignment inserts for
--    one team on different future dates. The assignment insert's inline read
--    of `teams.archived` is the one stale read, and the re-check covers it as
--    in (1). `rotation_patterns` takes no lock: a pattern's insert reads
--    nothing, and its delete is guarded by `rotation_pattern_in_use` and by
--    `rotation_assignments_pattern_fkey` (0025), which no race gets past.
--
-- 3. THE CALLER, RE-READ BEHIND THE LOCK. `current_member_access()` is STABLE,
--    so a policy reads the caller on the statement's snapshot, taken before
--    the statement waited. A caller demoted or deactivated while a write
--    waited still passed as an active admin; 0023 re-read the caller only on
--    `member_status_versions`. `refuse_write_by_stale_admin()` is a BEFORE ROW
--    trigger on every other table the lock covers: `members` (insert, update
--    of `role`, delete), `team_membership_versions`, `teams` (update of
--    `archived`), `rotation_steps` and `rotation_assignments`. It asks again,
--    with fresh reads, as the owner:
--
--      * is the caller still an ACTIVE ADMIN of the row's organization? If not,
--        42501 with the message the policy itself raises;
--      * for an insert into `team_membership_versions` or
--        `rotation_assignments` naming a team: is that team still not
--        archived? If not, the same 42501.
--
--    WHY BEFORE ROW, where 0023's status re-check is AFTER ROW. A row trigger
--    fires once the BEFORE STATEMENT trigger has taken the lock, and BEFORE
--    the row is written, so the caller's own member row is read as it stood:
--    an admin who removes or demotes themself (the policies admit both, and
--    0002's zero-admins check decides at commit) is still the admin who
--    asked. An AFTER trigger would read that admin as gone. For an update or
--    a delete it fires only for a row the policy's USING already admitted, so
--    a refused delete still answers zero rows, as the policies decide. For an
--    insert it fires before WITH CHECK, and so answers a refused caller
--    before the policy does, with the same code and message. 0023's status
--    trigger stays AFTER: its last-admin question has to see the row written.
--
--    THE GATE is 0023's: the session role is `authenticated` and the write is
--    a top-level statement (`pg_trigger_depth() = 1`), so an owner, a
--    `service_role` or a cascade write is never re-checked. A MULTI-ROW
--    statement that removes or demotes the caller's own row before another row
--    is refused for that later row: the caller is no longer an admin by then.
--    The SPA always writes one row.
--
-- 4. THE OVERRIDE DEFINERS TAKE THE LOCK. `remove_shift_type_override` (0021),
--    `remove_roster_override` (0027, as 0033 re-created it),
--    `confirm_shift_type_override` and `amend_shift_type_override` (0022) read
--    the caller themselves, past every policy, and took no lock: a removal
--    racing the caller's own demotion or deactivation could land. Each now
--    takes the claimed organization's advisory lock as its first act, before
--    its admin check, keyed exactly as 0023 keys it. A definer is one
--    PostgREST statement that holds no tuple lock before it, so the lock
--    cannot deadlock for 0023's reason. Each body is otherwise unchanged.
--
-- 5. THE CONFIRMATION CARRIES A CONCURRENCY TOKEN (story 3.5c's review). An
--    admin reviews a pending override against the rotation version that
--    governs its date, then confirms. Another admin may save a newer change
--    in between, and the confirmation then re-anchored the override to a
--    version this admin never saw. `confirm_shift_type_override` now takes
--    `p_governing_saved_at`, the `created_at` of the version the review showed
--    governing the override's date (`null` where none did), and compares it,
--    after the lock, with the version governing that date now. A mismatch is
--    refused with P0001 and the message `SHIFT_TYPE_OVERRIDE_CHANGED`, which
--    the browser says as "the rotation changed; look again". The one-argument
--    signature is dropped, so no caller can confirm without the token. A
--    rotation save takes the same lock (2), so the comparison cannot race it.
--
-- NOT CLOSED HERE: other definers that write as the caller
-- (`remove_leave_record`, `amend_leave_record`, `replace_conflict_member`)
-- take no lock, and `amend_shift_type_override` takes the lock but no token.
-- `shift_types` archiving takes no lock, so a step insert's inline read of
-- `shift_types.archived` keeps 0016's reading.
--
-- AD-3's one constraint trigger stays the only one: these are ordinary
-- triggers, and none of them decides a rule the schema did not already state.
--
-- IDEMPOTENT: `create or replace` for the functions, `drop ... if exists`
-- before each trigger and before the dropped signature, and a revoke of a
-- privilege that is not held is a no-op.

-- ------------------------------------------------------ 1, 2. the lock, wider

drop trigger if exists teams_serialize_organization_writes on public.teams;
create trigger teams_serialize_organization_writes
  before update of archived on public.teams
  for each statement
  execute function public.serialize_organization_writes();

drop trigger if exists rotation_steps_serialize_organization_writes on public.rotation_steps;
create trigger rotation_steps_serialize_organization_writes
  before insert or delete on public.rotation_steps
  for each statement
  execute function public.serialize_organization_writes();

drop trigger if exists rotation_assignments_serialize_organization_writes on public.rotation_assignments;
create trigger rotation_assignments_serialize_organization_writes
  before insert or delete on public.rotation_assignments
  for each statement
  execute function public.serialize_organization_writes();

-- ---------------------------------------------- 3. the caller, after the lock

create or replace function public.refuse_write_by_stale_admin() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed record;
begin
  if tg_op = 'DELETE' then
    changed := old;
  else
    changed := new;
  end if;

  -- 0023's gate: a request session's own statement.
  if pg_catalog.current_setting('role') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- The caller, re-read. The policy read it on the statement's snapshot.
  if not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = changed.organization_id
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = pg_catalog.format('new row violates row-level security policy for table "%s"', tg_table_name);
  end if;

  -- The team, re-read: the insert policies read `archived` inline. Nested, so
  -- `new.team_id` is only read on the two tables that have it.
  if tg_op = 'INSERT' and tg_table_name in ('team_membership_versions', 'rotation_assignments') then
    if new.team_id is not null and exists (
      select 1
        from public.teams team
       where team.organization_id = new.organization_id
         and team.id = new.team_id
         and team.archived
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = pg_catalog.format('new row violates row-level security policy for table "%s"', tg_table_name);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_write_by_stale_admin() from public;
revoke execute on function public.refuse_write_by_stale_admin() from anon;
revoke execute on function public.refuse_write_by_stale_admin() from authenticated;
revoke execute on function public.refuse_write_by_stale_admin() from service_role;

drop trigger if exists members_refuse_write_by_stale_admin on public.members;
create trigger members_refuse_write_by_stale_admin
  before insert or update of role or delete on public.members
  for each row
  execute function public.refuse_write_by_stale_admin();

drop trigger if exists team_membership_versions_refuse_write_by_stale_admin on public.team_membership_versions;
create trigger team_membership_versions_refuse_write_by_stale_admin
  before insert or update or delete on public.team_membership_versions
  for each row
  execute function public.refuse_write_by_stale_admin();

drop trigger if exists teams_refuse_write_by_stale_admin on public.teams;
create trigger teams_refuse_write_by_stale_admin
  before update of archived on public.teams
  for each row
  execute function public.refuse_write_by_stale_admin();

drop trigger if exists rotation_steps_refuse_write_by_stale_admin on public.rotation_steps;
create trigger rotation_steps_refuse_write_by_stale_admin
  before insert or delete on public.rotation_steps
  for each row
  execute function public.refuse_write_by_stale_admin();

drop trigger if exists rotation_assignments_refuse_write_by_stale_admin on public.rotation_assignments;
create trigger rotation_assignments_refuse_write_by_stale_admin
  before insert or delete on public.rotation_assignments
  for each row
  execute function public.refuse_write_by_stale_admin();

-- ----------------------------------------------- 4. the definers, behind it

-- 0021's body, behind the lock.
create or replace function public.remove_shift_type_override(p_override_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
begin
  if claimed is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('shift.organization_writes:' || claimed::text, 0)
    );
  end if;

  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'SHIFT_TYPE_OVERRIDE_REMOVAL_REFUSED';
  end if;

  update public.shift_type_overrides o
     set removed_by = auth.uid(),
         removed_at = now()
   where o.id = p_override_id
     and o.organization_id = claimed
     and o.removed_at is null;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'SHIFT_TYPE_OVERRIDE_NOT_LIVE';
  end if;
end;
$$;

-- 0033's body (0027's, ending the linked resolution), behind the lock.
create or replace function public.remove_roster_override(p_override_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
begin
  if claimed is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('shift.organization_writes:' || claimed::text, 0)
    );
  end if;

  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'ROSTER_OVERRIDE_REMOVAL_REFUSED';
  end if;

  update public.roster_overrides o
     set removed_by = auth.uid(),
         removed_at = now()
   where o.id = p_override_id
     and o.organization_id = claimed
     and o.removed_at is null;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'ROSTER_OVERRIDE_NOT_LIVE';
  end if;

  update public.conflict_resolutions c
     set removed_by = auth.uid(),
         removed_at = now()
   where c.organization_id = claimed
     and c.roster_override_id = p_override_id
     and c.removed_at is null;
end;
$$;

-- 0022's amend, behind the lock.
create or replace function public.amend_shift_type_override(p_override_id uuid, p_shift_type_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  amended_team uuid;
  amended_date date;
  replacement uuid;
begin
  if claimed is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('shift.organization_writes:' || claimed::text, 0)
    );
  end if;

  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'SHIFT_TYPE_OVERRIDE_AMEND_REFUSED';
  end if;

  update public.shift_type_overrides o
     set removed_by = auth.uid(),
         removed_at = now()
   where o.id = p_override_id
     and o.organization_id = claimed
     and o.removed_at is null
  returning o.team_id, o.date into amended_team, amended_date;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'SHIFT_TYPE_OVERRIDE_NOT_LIVE';
  end if;

  if exists (
    select 1
      from public.teams team
     where team.organization_id = claimed
       and team.id = amended_team
       and team.archived
  ) or exists (
    select 1
      from public.shift_types shift_type
     where shift_type.organization_id = claimed
       and shift_type.id = p_shift_type_id
       and shift_type.archived
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SHIFT_TYPE_OVERRIDE_ARCHIVED';
  end if;

  insert into public.shift_type_overrides (organization_id, team_id, date, shift_type_id, reason)
  values (claimed, amended_team, amended_date, p_shift_type_id, p_reason)
  returning id into replacement;

  return replacement;
end;
$$;

-- ------------------------------------------------- 5. the confirmation token

drop function if exists public.confirm_shift_type_override(uuid);

-- 0022's confirmation, behind the lock, with the token. The refusals in
-- order: the caller (42501), the override not live (P0002), the governing
-- version changed (P0001 `SHIFT_TYPE_OVERRIDE_CHANGED`), the team or type
-- archived (P0001 `SHIFT_TYPE_OVERRIDE_ARCHIVED`). Each raise rolls the
-- function's update back.
create or replace function public.confirm_shift_type_override(p_override_id uuid, p_governing_saved_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  confirmed_team uuid;
  confirmed_date date;
  confirmed_type uuid;
  governing_saved_at timestamptz;
begin
  if claimed is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('shift.organization_writes:' || claimed::text, 0)
    );
  end if;

  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'SHIFT_TYPE_OVERRIDE_CONFIRMATION_REFUSED';
  end if;

  update public.shift_type_overrides o
     set confirmed_by = auth.uid(),
         confirmed_at = now()
   where o.id = p_override_id
     and o.organization_id = claimed
     and o.removed_at is null
  returning o.team_id, o.date, o.shift_type_id into confirmed_team, confirmed_date, confirmed_type;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'SHIFT_TYPE_OVERRIDE_NOT_LIVE';
  end if;

  -- The version governing the override's date now: the greatest
  -- `effective_from` on or before it, as `overrideStandingOf` reads it.
  select a.created_at
    into governing_saved_at
    from public.rotation_assignments a
   where a.organization_id = claimed
     and a.team_id = confirmed_team
     and a.effective_from <= confirmed_date
   order by a.effective_from desc
   limit 1;

  if governing_saved_at is distinct from p_governing_saved_at then
    raise exception using
      errcode = 'P0001',
      message = 'SHIFT_TYPE_OVERRIDE_CHANGED';
  end if;

  if exists (
    select 1
      from public.teams team
     where team.organization_id = claimed
       and team.id = confirmed_team
       and team.archived
  ) or exists (
    select 1
      from public.shift_types shift_type
     where shift_type.organization_id = claimed
       and shift_type.id = confirmed_type
       and shift_type.archived
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SHIFT_TYPE_OVERRIDE_ARCHIVED';
  end if;
end;
$$;

-- 0022's grants, written again for the new signature.
revoke execute on function public.confirm_shift_type_override(uuid, timestamptz) from public;
revoke execute on function public.confirm_shift_type_override(uuid, timestamptz) from anon;
revoke execute on function public.confirm_shift_type_override(uuid, timestamptz) from service_role;
grant execute on function public.confirm_shift_type_override(uuid, timestamptz) to authenticated;
