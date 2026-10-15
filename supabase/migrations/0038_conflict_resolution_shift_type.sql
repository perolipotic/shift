-- 0038_conflict_resolution_shift_type.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- A decision remembers the shift it was made on (deferred work, dormant-key
-- revival and the *Riješeni* type name; human, 2026-10-13).
--
-- A resolution is keyed by `(member, date, team)` (0031). When that key stops
-- colliding (the team goes off that day, the member leaves the team) the row
-- lies dormant, and a later change that makes the same key collide again —
-- possibly on a DIFFERENT shift — silently re-applied the old decision. And
-- *Riješeni* could only name the shift type the schedule has today.
--
-- THE SHIFT TYPE AT DECISION TIME is now stored, as `shift_type_id`:
--
--   * NULLABLE. Rows written before this file have none, and a client that
--     names none writes none; such a row matches its key as before.
--   * WHETHER IT MATCHES IS THE BROWSER'S QUESTION (AD-4). The schedule is
--     never computed here, so this file only stores the type. The browser's
--     one resolution filter (`effectiveResolutionsOf`) ignores a row whose
--     stored type differs from the type the team's schedule has on that date
--     today: its conflict shows as unresolved again, everywhere.
--   * A NEW DECISION SUPERSEDES SUCH A ROW. An ignored row still holds the
--     live key, so a new decision on the same key would be refused (23505)
--     with nothing to undo it. 0031's trigger function, re-created below,
--     therefore soft-removes the live row of the same key whose stored type is
--     set and differs from the new row's set type, in the same statement,
--     attributed to the new decision's author, before the live key is
--     checked. Only stored values are compared; nothing is derived. A row with
--     no stored type, or a new row naming none, supersedes nothing, so the
--     live key refuses exactly as before. 0032's replacement is re-created to
--     pass the type through and to skip such a row in its "already resolved"
--     pre-check.
--
-- What this file does, in order:
--
--   (i)   `conflict_resolutions.shift_type_id`: a composite key to the same
--         organization's shift type, NO cascade, and an insert grant, so the
--         direct `accept_uncovered` insert names it. No index: it is never
--         looked up by type.
--   (ii)  `refuse_conflict_resolution_off_leave()` re-created: 0031's body
--         and refusal, unchanged, then the supersede. `create or replace`
--         keeps the trigger and 0031's revokes.
--   (iii) `replace_conflict_member` dropped and re-created with a sixth
--         argument, `p_shift_type_id uuid default null` (a client from before
--         this file still calls it with five), on 0036's body and lock; its
--         grants are 0032's, written again.
--   (iv)  `my_conflict_resolutions()` dropped and re-created with
--         `shift_type_id` as its last column, so a member's own hours apply
--         the same rule; 0033's grants, written again.
--
-- No policy change, no new trigger, no new table grant beyond the column.

-- ------------------------------------------------------------ (i) the column

alter table public.conflict_resolutions
  add column shift_type_id uuid;

-- NO cascade: a shift type is archived, never deleted.
alter table public.conflict_resolutions
  add constraint conflict_resolutions_shift_type_fkey
    foreign key (organization_id, shift_type_id)
    references public.shift_types (organization_id, id);

-- 0031's five facts, and now the type they were decided on.
grant insert (shift_type_id) on table public.conflict_resolutions to authenticated;

-- ------------------------------------------- (ii) the trigger, and the supersede

create or replace function public.refuse_conflict_resolution_off_leave() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
begin
  -- A session that is not an active admin of the claimed organization, or
  -- writes into another one, is the insert policy's to refuse (42501): no
  -- leave is read for it, and nothing is superseded.
  if (select auth.uid()) is not null and (
    claimed is null
    or new.organization_id is distinct from claimed
    or not exists (
      select 1
        from public.current_member_access() as access
       where access.organization_id = claimed
         and access.is_active
         and access.member_role = 'admin'
    )
  ) then
    return new;
  end if;

  -- The share lock serialises against 0029's soft-remove of the same row:
  -- after a wait, the re-check reads `removed_at` as committed.
  perform 1
     from public.leave_records r
    where r.organization_id = new.organization_id
      and r.member_id = new.member_id
      and r.removed_at is null
      and new.date <@ r.during
      for share;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'CONFLICT_RESOLUTION_NOT_ON_LEAVE';
  end if;

  -- 0038: the live decision of this key made on another shift type no longer
  -- decides anything (the browser ignores it); the new one takes its key.
  -- Two concurrent inserts serialise on that row's lock, and the one that
  -- waited is refused by the live key (23505).
  update public.conflict_resolutions c
     set removed_by = new.created_by,
         removed_at = now()
   where c.organization_id = new.organization_id
     and c.member_id = new.member_id
     and c.date = new.date
     and c.team_id = new.team_id
     and c.removed_at is null
     and c.shift_type_id is not null
     and new.shift_type_id is not null
     and c.shift_type_id <> new.shift_type_id;

  return new;
end;
$$;

-- ------------------------------------------------------ (iii) the replacement

drop function public.replace_conflict_member(uuid, date, uuid, uuid, text);

-- 0036's replacement, behind the lock, with the type passed through.
create function public.replace_conflict_member(
  p_member_id uuid,
  p_date date,
  p_team_id uuid,
  p_replacement_id uuid,
  p_reason text,
  p_shift_type_id uuid default null
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
  -- the caller hears "no longer open" rather than "taken". A live row decided
  -- on another shift type does not count (0038): the insert below supersedes
  -- it. The insert still holds the key against a race (23505 either way).
  if exists (
    select 1
      from public.conflict_resolutions c
     where c.organization_id = claimed
       and c.member_id = p_member_id
       and c.date = p_date
       and c.team_id = p_team_id
       and c.removed_at is null
       and not (
         c.shift_type_id is not null
         and p_shift_type_id is not null
         and c.shift_type_id <> p_shift_type_id
       )
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

  -- The decision, linked to it and naming its type. 0031's trigger refuses it
  -- off leave (P0002) and supersedes a live row of another type (0038); its
  -- live key refuses a second (23505); either refusal aborts the override too.
  insert into public.conflict_resolutions (organization_id, member_id, date, team_id, kind, roster_override_id, shift_type_id)
  values (claimed, p_member_id, p_date, p_team_id, 'replace_member', override_id, p_shift_type_id)
  returning id into resolution_id;

  return resolution_id;
end;
$$;

-- 0032's explicit grants, written again for the re-created function.
revoke execute on function public.replace_conflict_member(uuid, date, uuid, uuid, text, uuid) from public;
revoke execute on function public.replace_conflict_member(uuid, date, uuid, uuid, text, uuid) from anon;
revoke execute on function public.replace_conflict_member(uuid, date, uuid, uuid, text, uuid) from service_role;
grant execute on function public.replace_conflict_member(uuid, date, uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------- (iv) the member's read

drop function public.my_conflict_resolutions();

-- 0033's read, shaped and pinned the same way, plus the type: the caller's own
-- LIVE resolutions, `member_id, date, team_id, kind, roster_override_id,
-- shift_type_id`. No author and no removal. The type is one of the caller's
-- own organization's, which every active member already reads.
create function public.my_conflict_resolutions()
returns table (
  member_id uuid,
  date date,
  team_id uuid,
  kind text,
  roster_override_id uuid,
  shift_type_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.member_id,
         c.date,
         c.team_id,
         c.kind,
         c.roster_override_id,
         c.shift_type_id
    from public.conflict_resolutions c
    join public.members m
      on m.organization_id = c.organization_id
     and m.id = c.member_id
   where c.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and c.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and m.auth_user_id = (select auth.uid())
     and c.removed_at is null
   order by c.date, c.team_id
$$;

-- 0031's explicit grants, written again for the re-created function.
revoke execute on function public.my_conflict_resolutions() from public;
revoke execute on function public.my_conflict_resolutions() from anon;
revoke execute on function public.my_conflict_resolutions() from service_role;
grant execute on function public.my_conflict_resolutions() to authenticated;
