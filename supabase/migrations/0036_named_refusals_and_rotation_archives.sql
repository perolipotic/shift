-- 0036_named_refusals_and_rotation_archives.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Refusals that told the wrong reason now tell the right one, an archive no
-- longer strands a rotation, member rows are never deleted by a session, and
-- the definers 0035 left out take its lock. Seven deferred-work entries and
-- 0035's own NOT CLOSED paragraph, closed together because they touch the same
-- policies, triggers and definers.
--
-- 1. AN OVERRIDE ON AN ARCHIVED TEAM OR TYPE SAYS SO. 0019's and 0026's insert
--    policies fold "an active admin" and "not archived" into one WITH CHECK,
--    so a team or type archived while the day detail was open arrived as
--    42501 and was shown as "you need admin rights".
--    `refuse_override_on_archived()` is a BEFORE INSERT ROW trigger on both
--    tables. A row trigger fires before WITH CHECK, so for an ACTIVE ADMIN it
--    answers first, with fresh reads (a VOLATILE definer takes a new snapshot
--    per query, so an archive committed after the statement began is seen):
--
--      * `shift_type_overrides`: the team or the type archived — 23514 with
--        the message `SHIFT_TYPE_OVERRIDE_ARCHIVED`, the message 0022's amend
--        and confirmation already raise (as P0001) for the same fact;
--      * `roster_overrides`: the team archived — 23514 `ROSTER_OVERRIDE_ARCHIVED`.
--
--    Anybody else is left to the policy: a caller who is not an active admin
--    of the row's organization gets the policy's 42501 exactly as before, so
--    the trigger tells a non-admin nothing. THE GATE is 0023's: the session
--    role is `authenticated`. An owner or `service_role` insert (seeds,
--    fixtures) is not refused here, as no policy governs it either. The
--    policies keep their not-archived conjuncts: they still decide for the
--    statement's snapshot, and the trigger only names the refusal.
--
-- 2. A TEAM IN A ROTATION IS NOT ARCHIVED (deferred-work: a team with a
--    rotation assignment could be archived and kept projecting shifts).
--    `refuse_archive_in_rotation()` is a BEFORE UPDATE OF `archived` ROW
--    trigger on `teams`, firing only on the change to archived. It refuses
--    while the team has an assignment IN FORCE OR SCHEDULED: 23514
--    `TEAM_IN_ROTATION`. A version is never ended by a "no rotation" one
--    (`offset_step_id` is not null), so a team with any version has one in
--    force or scheduled; cancelling its only, still scheduled, version frees
--    it. The membership rule (0010's `team_in_use`, 42501) is unchanged.
--    0035's lock on the archive and on every assignment insert makes the two
--    wait for each other, and the trigger's fresh reads see the commit.
--
-- 3. A TYPE IN A ROTATION IS NOT ARCHIVED (deferred-work: a type used by a
--    rotation step could be archived, and the rotation kept projecting it). The
--    same trigger on `shift_types` refuses while a pattern IN FORCE OR
--    SCHEDULED for any team has a step of the type: 23514
--    `SHIFT_TYPE_IN_ROTATION`. In force is the version with the greatest
--    `effective_from` on or before the organization's today; scheduled is one
--    after it. A pattern only a superseded version names, or none, does not
--    block. `rotation_steps_shift_type_id_idx` is the index that question
--    reads by. 0013's scheduled-change rule (42501) is unchanged.
--
--    SERIALIZED (0035's NOT CLOSED paragraph). `shift_types` archiving now
--    takes the organization lock (`serialize_organization_writes()`, BEFORE
--    STATEMENT on `update of archived`) and `refuse_write_by_stale_admin()`
--    re-checks the caller there. A step insert already took the lock (0035),
--    but its policy reads `shift_types.archived` inline, on the statement's
--    snapshot; the re-check now reads it again after the lock and refuses a
--    step on a type archived meanwhile (42501, the policy's own refusal). In
--    the other order the archive's trigger reads the committed step. A rename
--    names `name` only, fires nothing and waits on nobody.
--
--    The trigger fires AFTER the stale-admin re-check on both tables (trigger
--    names order them: `..._refuse_write_by_stale_admin` before
--    `..._refuse_write_while_in_rotation`), so a demoted caller still hears
--    42501. Its gate is 0023's: `authenticated`, a top-level statement.
--
-- 4. NO SESSION DELETES A MEMBER (deferred-work: a delete cascaded away the
--    member's status and team history, and failed 23503 once they had leave).
--    Deactivation is the only removal path; no surface ever deleted a member.
--    `members_delete_by_own_active_admin` (0003) is dropped, so a session's
--    delete matches no row, as on every table with no delete policy. The
--    owner's deletes (an operator, the demo script, a cascade from
--    `auth.users`) are unaffected, and 0002's zero-admins trigger still runs.
--
-- 5. THE REASON IS TRIMMED BY CODE POINT, NOT BY COLLATION. 0019's and 0026's
--    reason checks trimmed with `[[:space:]]`, which follows the collation (see
--    0024's header): on this stack it misses U+FEFF, and on a `C` collation it
--    would miss U+00A0 too. Both now trim with `btrim(reason, <0024's literal
--    list>)`, linear and collation-independent, under the same constraint
--    names, so a refusal is still 23514 naming the same constraint.
--
-- 6. ONE MAXIMUM NAME LENGTH, 100 characters (deferred-work: an unbounded
--    name overflowed the unique index's btree entry, 54000, read as "try
--    again"). `organizations`, `members`, `teams`, `hour_bands` and
--    `shift_types` each gain `<table>_name_length`, `char_length(name) <= 100`
--    (code points, as every length here counts). A refusal is 23514 naming the
--    constraint, which the browser maps to "too long". Members carry one
--    `name`; there are no separate first and last name columns. Adding a check
--    validates every stored row, so a longer name stops the migration whole;
--    no seeded or demo name comes close.
--
-- 7. THE REMAINING DEFINERS TAKE THE LOCK, AND THE AMEND CARRIES THE TOKEN
--    (0035's NOT CLOSED paragraph). `remove_leave_record` and
--    `amend_leave_record` (0029, as 0031 re-created them) and
--    `replace_conflict_member` (0032) take the claimed organization's advisory
--    lock as their first act, before their admin check, keyed as 0023 keys
--    it, for 0035's reason; each body is otherwise unchanged. `amend_shift_type_override` now takes
--    `p_governing_saved_at`, as 0035's confirmation does, and refuses with
--    P0001 `SHIFT_TYPE_OVERRIDE_CHANGED` when the version governing the
--    override's date is no longer the one the review showed. The three-argument
--    signature is dropped, so no caller can amend without the token.
--
-- AD-3's one constraint trigger stays the only one: these are ordinary
-- triggers, and none of them decides a rule a policy or a check did not
-- already state, except (2) and (3), which are new archive rules of the same
-- kind as 0010's and 0013's.
--
-- IDEMPOTENT: `create or replace` for the functions, `drop ... if exists`
-- before each trigger, constraint, policy and dropped signature,
-- `create index if not exists`, and a revoke of a privilege that is not held
-- is a no-op.

-- ------------------------------------------- 1. an override on an archived row

create or replace function public.refuse_override_on_archived() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 0023's gate: a request session. The owner is governed by no policy here.
  if pg_catalog.current_setting('role') <> 'authenticated' then
    return new;
  end if;

  -- Anybody but an active admin of the row's organization is the policy's to
  -- refuse, with its own 42501.
  if not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = new.organization_id
       and access.is_active
       and access.member_role = 'admin'
  ) then
    return new;
  end if;

  if exists (
    select 1
      from public.teams team
     where team.organization_id = new.organization_id
       and team.id = new.team_id
       and team.archived
  ) then
    raise exception using
      errcode = 'check_violation',
      message = case tg_table_name
        when 'shift_type_overrides' then 'SHIFT_TYPE_OVERRIDE_ARCHIVED'
        else 'ROSTER_OVERRIDE_ARCHIVED'
      end;
  end if;

  -- Nested, so `new.shift_type_id` is only read on the table that has it.
  if tg_table_name = 'shift_type_overrides' then
    if exists (
      select 1
        from public.shift_types shift_type
       where shift_type.organization_id = new.organization_id
         and shift_type.id = new.shift_type_id
         and shift_type.archived
    ) then
      raise exception using
        errcode = 'check_violation',
        message = 'SHIFT_TYPE_OVERRIDE_ARCHIVED';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.refuse_override_on_archived() from public;
revoke execute on function public.refuse_override_on_archived() from anon;
revoke execute on function public.refuse_override_on_archived() from authenticated;
revoke execute on function public.refuse_override_on_archived() from service_role;

drop trigger if exists shift_type_overrides_refuse_write_while_archived on public.shift_type_overrides;
create trigger shift_type_overrides_refuse_write_while_archived
  before insert on public.shift_type_overrides
  for each row
  execute function public.refuse_override_on_archived();

drop trigger if exists roster_overrides_refuse_write_while_archived on public.roster_overrides;
create trigger roster_overrides_refuse_write_while_archived
  before insert on public.roster_overrides
  for each row
  execute function public.refuse_override_on_archived();

-- ------------------------------------------- 2, 3. an archive in a rotation

create index if not exists rotation_steps_shift_type_id_idx
  on public.rotation_steps (shift_type_id);

create or replace function public.refuse_archive_in_rotation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 0023's gate: a request session's own statement.
  if pg_catalog.current_setting('role') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_table_name = 'teams' then
    -- No version ends a rotation, so any version is in force or scheduled.
    if exists (
      select 1
        from public.rotation_assignments a
       where a.organization_id = new.organization_id
         and a.team_id = new.id
    ) then
      raise exception using
        errcode = 'check_violation',
        message = 'TEAM_IN_ROTATION';
    end if;
  else
    -- A step of the type in a pattern that some team's version in force
    -- today, or scheduled after today, names.
    if exists (
      select 1
        from public.rotation_steps step
        join public.rotation_assignments a
          on a.organization_id = step.organization_id
         and a.pattern_id = step.pattern_id
       where step.organization_id = new.organization_id
         and step.shift_type_id = new.id
         and (
           a.effective_from > public.organization_today(a.organization_id)
           or a.effective_from = (
             select max(b.effective_from)
               from public.rotation_assignments b
              where b.team_id = a.team_id
                and b.effective_from <= public.organization_today(b.organization_id)
           )
         )
    ) then
      raise exception using
        errcode = 'check_violation',
        message = 'SHIFT_TYPE_IN_ROTATION';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.refuse_archive_in_rotation() from public;
revoke execute on function public.refuse_archive_in_rotation() from anon;
revoke execute on function public.refuse_archive_in_rotation() from authenticated;
revoke execute on function public.refuse_archive_in_rotation() from service_role;

drop trigger if exists teams_refuse_write_while_in_rotation on public.teams;
create trigger teams_refuse_write_while_in_rotation
  before update of archived on public.teams
  for each row
  when (new.archived and not old.archived)
  execute function public.refuse_archive_in_rotation();

drop trigger if exists shift_types_serialize_organization_writes on public.shift_types;
create trigger shift_types_serialize_organization_writes
  before update of archived on public.shift_types
  for each statement
  execute function public.serialize_organization_writes();

drop trigger if exists shift_types_refuse_write_by_stale_admin on public.shift_types;
create trigger shift_types_refuse_write_by_stale_admin
  before update of archived on public.shift_types
  for each row
  execute function public.refuse_write_by_stale_admin();

drop trigger if exists shift_types_refuse_write_while_in_rotation on public.shift_types;
create trigger shift_types_refuse_write_while_in_rotation
  before update of archived on public.shift_types
  for each row
  when (new.archived and not old.archived)
  execute function public.refuse_archive_in_rotation();

-- 0035's re-check, and one more fresh read: a step's type, archived while the
-- step insert waited on the lock.
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

  -- The step's type, re-read: 0016's step policy reads `archived` inline.
  if tg_op = 'INSERT' and tg_table_name = 'rotation_steps' then
    if exists (
      select 1
        from public.shift_types shift_type
       where shift_type.organization_id = new.organization_id
         and shift_type.id = new.shift_type_id
         and shift_type.archived
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

-- --------------------------------------------- 4. no session deletes a member

drop policy if exists members_delete_by_own_active_admin on public.members;

-- ---------------------------------------- 5. the reason, trimmed by code point

alter table public.shift_type_overrides drop constraint if exists shift_type_overrides_reason_length;
alter table public.shift_type_overrides
  add constraint shift_type_overrides_reason_length check (
    char_length(
      pg_catalog.btrim(
        reason,
        U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
      )
    ) between 1 and 200
  );

alter table public.roster_overrides drop constraint if exists roster_overrides_reason_length;
alter table public.roster_overrides
  add constraint roster_overrides_reason_length check (
    char_length(
      pg_catalog.btrim(
        reason,
        U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
      )
    ) between 1 and 200
  );

-- ------------------------------------------------- 6. one maximum name length

alter table public.organizations drop constraint if exists organizations_name_length;
alter table public.organizations
  add constraint organizations_name_length check (char_length(name) <= 100);

alter table public.members drop constraint if exists members_name_length;
alter table public.members
  add constraint members_name_length check (char_length(name) <= 100);

alter table public.teams drop constraint if exists teams_name_length;
alter table public.teams
  add constraint teams_name_length check (char_length(name) <= 100);

alter table public.hour_bands drop constraint if exists hour_bands_name_length;
alter table public.hour_bands
  add constraint hour_bands_name_length check (char_length(name) <= 100);

alter table public.shift_types drop constraint if exists shift_types_name_length;
alter table public.shift_types
  add constraint shift_types_name_length check (char_length(name) <= 100);

-- ------------------------------------------- 7. the definers, behind the lock

-- 0031's removal (0029's, with the lifetime rule), behind the lock.
create or replace function public.remove_leave_record(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  removed_member uuid;
  removed_during daterange;
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
      message = 'LEAVE_RECORD_REMOVAL_REFUSED';
  end if;

  update public.leave_records r
     set removed_by = auth.uid(),
         removed_at = now()
   where r.id = p_record_id
     and r.organization_id = claimed
     and r.removed_at is null
  returning r.member_id, r.during into removed_member, removed_during;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_RECORD_NOT_LIVE';
  end if;

  -- The lifetime rule: no live leave covers these dates any more.
  update public.conflict_resolutions c
     set removed_by = auth.uid(),
         removed_at = now()
   where c.organization_id = claimed
     and c.member_id = removed_member
     and c.removed_at is null
     and c.date <@ removed_during;
end;
$$;

-- 0031's amend (0029's, with the lifetime rule), behind the lock.
create or replace function public.amend_leave_record(p_record_id uuid, p_from date, p_to date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  amended_member uuid;
  amended_during daterange;
  replacement uuid;
  replacement_during daterange;
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
      message = 'LEAVE_RECORD_AMEND_REFUSED';
  end if;

  update public.leave_records r
     set removed_by = auth.uid(),
         removed_at = now()
   where r.id = p_record_id
     and r.organization_id = claimed
     and r.removed_at is null
  returning r.member_id, r.during into amended_member, amended_during;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_RECORD_NOT_LIVE';
  end if;

  -- `created_by` and `created_at` come from 0028's defaults: the caller, now.
  -- Any refusal here aborts the call, and the removal above with it.
  insert into public.leave_records (organization_id, member_id, during)
  values (claimed, amended_member, pg_catalog.daterange(p_from, p_to, '[]'))
  returning id, during into replacement, replacement_during;

  -- The lifetime rule: the dates the old range covered and the new one does
  -- not. A date that stays covered keeps its resolution.
  update public.conflict_resolutions c
     set removed_by = auth.uid(),
         removed_at = now()
   where c.organization_id = claimed
     and c.member_id = amended_member
     and c.removed_at is null
     and c.date <@ amended_during
     and not (c.date <@ replacement_during);

  return replacement;
end;
$$;

-- 0032's replacement, behind the lock.
create or replace function public.replace_conflict_member(
  p_member_id uuid,
  p_date date,
  p_team_id uuid,
  p_replacement_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  override_id uuid;
  resolution_id uuid;
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
      message = 'CONFLICT_REPLACEMENT_REFUSED';
  end if;

  -- 0026's insert policy: never on an archived team. Another tenant's team is
  -- not found here and is refused by the composite key below (23503).
  if exists (
    select 1
      from public.teams team
     where team.organization_id = claimed
       and team.id = p_team_id
       and team.archived
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'CONFLICT_REPLACEMENT_REFUSED';
  end if;

  -- The absent member stays on the roster: putting them on their own shift
  -- replaces nobody.
  if p_replacement_id is not distinct from p_member_id then
    raise exception using
      errcode = 'check_violation',
      message = 'CONFLICT_REPLACEMENT_IS_ABSENT_MEMBER';
  end if;

  -- Already resolved: the resolution's live key, before the override's, so
  -- the caller hears "no longer open" rather than "taken". The insert below
  -- still holds the key against a race (23505 either way).
  if exists (
    select 1
      from public.conflict_resolutions c
     where c.organization_id = claimed
       and c.member_id = p_member_id
       and c.date = p_date
       and c.team_id = p_team_id
       and c.removed_at is null
  ) then
    raise exception using
      errcode = 'unique_violation',
      message = 'CONFLICT_RESOLUTION_EXISTS';
  end if;

  -- The override: an addition alone. `created_by` and `created_at` come from
  -- 0026's defaults.
  begin
    insert into public.roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason)
    values (claimed, p_team_id, p_date, null, p_replacement_id, p_reason)
    returning id into override_id;
  exception
    when unique_violation then
      raise exception using
        errcode = 'unique_violation',
        message = 'CONFLICT_REPLACEMENT_TAKEN';
  end;

  -- The decision, linked to it. 0031's trigger refuses it off leave (P0002),
  -- and its live key refuses a second (23505); either aborts the override too.
  insert into public.conflict_resolutions (organization_id, member_id, date, team_id, kind, roster_override_id)
  values (claimed, p_member_id, p_date, p_team_id, 'replace_member', override_id)
  returning id into resolution_id;

  return resolution_id;
end;
$$;

-- ------------------------------------------------------ 7. the amend's token

drop function if exists public.amend_shift_type_override(uuid, uuid, text);

-- 0035's amend, with the confirmation's token. The refusals in order: the
-- caller (42501), the override not live (P0002), the governing version
-- changed (P0001 `SHIFT_TYPE_OVERRIDE_CHANGED`), the team or type archived
-- (P0001 `SHIFT_TYPE_OVERRIDE_ARCHIVED`), then the insert's own (23514 the
-- reason). Each raise rolls the function's removal back.
create or replace function public.amend_shift_type_override(
  p_override_id uuid,
  p_shift_type_id uuid,
  p_reason text,
  p_governing_saved_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  amended_team uuid;
  amended_date date;
  governing_saved_at timestamptz;
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

  -- The version governing the override's date now, as 0035's confirmation
  -- reads it.
  select a.created_at
    into governing_saved_at
    from public.rotation_assignments a
   where a.organization_id = claimed
     and a.team_id = amended_team
     and a.effective_from <= amended_date
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

-- 0022's grants, written again for the new signature.
revoke execute on function public.amend_shift_type_override(uuid, uuid, text, timestamptz) from public;
revoke execute on function public.amend_shift_type_override(uuid, uuid, text, timestamptz) from anon;
revoke execute on function public.amend_shift_type_override(uuid, uuid, text, timestamptz) from service_role;
grant execute on function public.amend_shift_type_override(uuid, uuid, text, timestamptz) to authenticated;
