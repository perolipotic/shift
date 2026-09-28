-- 0022_shift_type_override_disposition.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 3.5c: overrides under a rotation change wait for the admin's
-- disposition (completes CAP-9).
--
-- THE PENDING STATE IS DERIVED, NOT STORED. `packages/domain` decides it: a
-- live override is pending when no rotation version governs its date, or when
-- the version governing it was created after the override was written or last
-- confirmed (the user's decision, 2026-09-28). Nothing here reads a rotation
-- row, and nothing here writes one, so those rows are byte-identical before
-- and after any disposition (DI-2).
--
-- THE THREE DISPOSITIONS:
--
--   * CONFIRM, below: `confirmed_by` and `confirmed_at` are set to the caller
--     and now, attributed on the server. The override is re-anchored to the
--     version in force at that moment and applies again.
--   * AMEND, below: in one transaction the live row is soft-removed, attributed
--     as 0021 attributes a removal, and a new row with the same team and date,
--     the new type and the new reason is inserted, attributed by 0019's
--     defaults. A failing insert rolls the removal back with it.
--   * DISCARD is 0021's `remove_shift_type_override`, unchanged.
--
-- A DELIBERATE EXCEPTION to "no new function" (AD-11), as 0021 is: a column
-- default cannot attribute an UPDATE. No table grant and no policy changes: no
-- session holds a privilege to write `confirmed_by` or `confirmed_at` — the
-- insert grant of 0019 names five columns, and there is no update grant — so
-- these two functions are the only writers. An admin READS the new columns
-- through 0019's table-level select and its admin-only policy.
--
-- SECURITY DEFINER, `search_path` emptied and every name qualified, as 0021.
-- RLS is enabled, not forced, so the owner is past it; the scope is each
-- function's own checks.
--
-- THE REFUSALS, as SQLSTATEs the browser maps:
--
--   * 42501 (`insufficient_privilege`) unless the caller is an ACTIVE ADMIN of
--     the organization the token claims.
--   * P0002 (`no_data_found`) when no LIVE override with that id is in that
--     organization. Another tenant's id is indistinguishable from none.
--   * P0001 with the message `SHIFT_TYPE_OVERRIDE_ARCHIVED` when the team, or
--     the type the override would then name, is archived: 0019's insert policy
--     refuses an override on either, and a definer is past that policy, so
--     each function says it itself. A code of its own, not 42501, so the
--     browser tells "archived meanwhile" from "not an admin". Nothing changes:
--     the raise rolls the function's update back.
--   * The amend's insert meets the table's own checks: 23514 for a reason
--     outside 1–200 characters, 23503 for a type that is not the
--     organization's.
--
-- No trigger.

-- ------------------------------------------------------------ the confirmation

alter table public.shift_type_overrides
  add column confirmed_by uuid,
  add column confirmed_at timestamptz,
  add constraint shift_type_overrides_confirmation_complete
    check ((confirmed_by is null) = (confirmed_at is null));

create function public.confirm_shift_type_override(p_override_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  confirmed_team uuid;
  confirmed_type uuid;
begin
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
  returning o.team_id, o.shift_type_id into confirmed_team, confirmed_type;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'SHIFT_TYPE_OVERRIDE_NOT_LIVE';
  end if;

  -- 0019's insert policy, which the owner is past: no archived team or type.
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

revoke execute on function public.confirm_shift_type_override(uuid) from public;
revoke execute on function public.confirm_shift_type_override(uuid) from anon;
revoke execute on function public.confirm_shift_type_override(uuid) from service_role;
grant execute on function public.confirm_shift_type_override(uuid) to authenticated;

-- ------------------------------------------------------------------ the amend

create function public.amend_shift_type_override(p_override_id uuid, p_shift_type_id uuid, p_reason text)
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

  -- 0019's insert policy, which the owner is past: no archived team or type.
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

  -- `created_by` and `created_at` come from 0019's defaults: the caller, now.
  insert into public.shift_type_overrides (organization_id, team_id, date, shift_type_id, reason)
  values (claimed, amended_team, amended_date, p_shift_type_id, p_reason)
  returning id into replacement;

  return replacement;
end;
$$;

revoke execute on function public.amend_shift_type_override(uuid, uuid, text) from public;
revoke execute on function public.amend_shift_type_override(uuid, uuid, text) from anon;
revoke execute on function public.amend_shift_type_override(uuid, uuid, text) from service_role;
grant execute on function public.amend_shift_type_override(uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------- the calendar read

-- 0019's read, replaced so it also returns `confirmed_at`: the domain needs
-- the instant an override was written or last confirmed to tell whether a
-- later rotation change left it pending. Nothing else is new — `confirmed_by`,
-- like `created_by`, is an auth user id and never leaves this function.
-- Dropped and created, because a function's result columns cannot change in
-- place; the grants are written again for that reason.
drop function public.calendar_shift_type_overrides();

create function public.calendar_shift_type_overrides()
returns table (
  id uuid,
  team_id uuid,
  date date,
  shift_type_id uuid,
  reason text,
  created_at timestamptz,
  confirmed_at timestamptz,
  author_member_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id,
         o.team_id,
         o.date,
         o.shift_type_id,
         o.reason,
         o.created_at,
         o.confirmed_at,
         (
           select m.id
             from public.members m
            where m.organization_id = o.organization_id
              and m.auth_user_id = o.created_by
         )
    from public.shift_type_overrides o
   where o.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and o.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and o.removed_at is null
   order by o.team_id, o.date, o.id
$$;

revoke execute on function public.calendar_shift_type_overrides() from public;
revoke execute on function public.calendar_shift_type_overrides() from anon;
revoke execute on function public.calendar_shift_type_overrides() from service_role;
grant execute on function public.calendar_shift_type_overrides() to authenticated;
