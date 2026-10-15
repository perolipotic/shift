-- 0039_roster_override_disposition.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- A roster override a rotation change left pending is confirmed, amended or
-- discarded in the builder's "Izmjene za pregled", as a shift-type override
-- is since story 3.5c (deferred work: the roster half of the review).
--
-- THE PENDING STATE IS STILL DERIVED, NOT STORED, by the one rule 3.6a gave
-- both layers (`overrideStandingOf` in `packages/domain`): a live roster
-- override is pending when no rotation version of its team governs its date,
-- or when the version governing it was saved after the override was written
-- or LAST CONFIRMED. Until this file a roster override had no confirmation,
-- so its instant was its `created_at` alone, and a pending one could only be
-- removed (the human's decision of 2026-09-30, which deferred the
-- disposition). Nothing here reads or writes a rotation, membership or status
-- row, so those rows are byte-identical before and after any disposition
-- (DI-2).
--
-- WHAT THIS FILE DOES, in order:
--
--   (i)   `roster_overrides.confirmed_by` and `confirmed_at`, both null or
--         both set, as 0022 added them to `shift_type_overrides`. No session
--         holds a privilege on either (0026 granted insert on six columns and
--         no update), so the two functions below are their only writers.
--   (ii)  `confirm_roster_override(id, governing_saved_at)`: 0035's
--         confirmation of a shift-type override, for the roster layer. It
--         takes the organization lock first, checks the caller, stamps
--         `confirmed_by` and `confirmed_at` on the server, and compares the
--         save time of the version governing the override's date with the
--         one the review was derived from.
--   (iii) `amend_roster_override(id, member_in_id, reason,
--         governing_saved_at)`: 0036's amend, for the roster layer. The admin
--         changes WHO ARRIVES: in one transaction the live row is
--         soft-removed and a new one with the same team, date and member
--         taken off, the new member put on and the new reason is inserted,
--         attributed by 0026's defaults. The live conflict resolution linked
--         to the old row (0032's `replace_member`) is linked to the new one:
--         the decision "someone replaces the member on leave" still stands,
--         carried out by the amended change. Removing a linked override ends
--         its decision (0033); amending one does not.
--   (iv)  DISCARD is 0027's `remove_roster_override`, as 0035 re-created it,
--         unchanged.
--   (v)   `calendar_roster_overrides()` dropped and re-created with
--         `confirmed_at`, as 0022 replaced the shift-type read, so every
--         member's calendar applies a confirmed override.
--   (vi)  `rotation_roster_overrides_in_view(organizations)`: the builder's
--         bounded read embeds the PENDING roster overrides, as 0025's
--         `rotation_overrides_in_view` embeds the shift-type ones, and
--         `rotation_assignments_in_view` is re-created so a pending roster
--         override's earlier date also moves its team's horizon.
--
-- THE REFUSALS, as SQLSTATEs the browser maps, in this order:
--
--   * 42501 (`insufficient_privilege`) unless the caller is an ACTIVE ADMIN of
--     the organization the token claims.
--   * P0002 (`no_data_found`) `ROSTER_OVERRIDE_NOT_LIVE` when no LIVE roster
--     override with that id is in that organization. Another tenant's id is
--     indistinguishable from none.
--   * P0001 `ROSTER_OVERRIDE_CHANGED` when the version governing the
--     override's date is no longer the one the review showed (`null` where
--     none did), 0035's token for this layer.
--   * P0001 `ROSTER_OVERRIDE_ARCHIVED` when the team is archived: 0026's
--     insert policy refuses an override on one, and a definer is past it.
--   * The amend's insert meets the table's own rules: 23514 for a reason
--     outside 1–200 characters (0036's trim) or the member put on being the
--     member taken off, 23503 for a member of another organization, 23505
--     when another live override of the team and date already puts that
--     member on.
--
--   Each raise rolls the function's update back.
--
-- A DELIBERATE EXCEPTION to "no new function" (AD-11), as 0022 is: a column
-- default cannot attribute an UPDATE. SECURITY DEFINER, `search_path` emptied
-- and every name qualified; RLS is enabled, not forced, so the owner is past
-- it, and the scope is each function's own checks. No table grant and no
-- policy changes. No trigger.
--
-- IDEMPOTENT where it can be: `add column if not exists`, `drop ... if
-- exists` before each constraint and dropped function, `create or replace`
-- for the rest.

-- ------------------------------------------------------- (i) the confirmation

alter table public.roster_overrides
  add column if not exists confirmed_by uuid,
  add column if not exists confirmed_at timestamptz;

alter table public.roster_overrides drop constraint if exists roster_overrides_confirmation_complete;
alter table public.roster_overrides
  add constraint roster_overrides_confirmation_complete
    check ((confirmed_by is null) = (confirmed_at is null));

-- --------------------------------------------------------- (ii) the confirm

create or replace function public.confirm_roster_override(p_override_id uuid, p_governing_saved_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  confirmed_team uuid;
  confirmed_date date;
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
      message = 'ROSTER_OVERRIDE_CONFIRMATION_REFUSED';
  end if;

  update public.roster_overrides o
     set confirmed_by = auth.uid(),
         confirmed_at = now()
   where o.id = p_override_id
     and o.organization_id = claimed
     and o.removed_at is null
  returning o.team_id, o.date into confirmed_team, confirmed_date;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'ROSTER_OVERRIDE_NOT_LIVE';
  end if;

  -- The version governing the override's date now, as 0035 reads it.
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
      message = 'ROSTER_OVERRIDE_CHANGED';
  end if;

  -- 0026's insert policy, which the owner is past: no archived team.
  if exists (
    select 1
      from public.teams team
     where team.organization_id = claimed
       and team.id = confirmed_team
       and team.archived
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ROSTER_OVERRIDE_ARCHIVED';
  end if;
end;
$$;

-- The same explicit grants 0022 writes: Supabase's default privileges grant
-- EXECUTE to `anon`, `authenticated` and `service_role` individually.
revoke execute on function public.confirm_roster_override(uuid, timestamptz) from public;
revoke execute on function public.confirm_roster_override(uuid, timestamptz) from anon;
revoke execute on function public.confirm_roster_override(uuid, timestamptz) from service_role;
grant execute on function public.confirm_roster_override(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------- (iii) the amend

create or replace function public.amend_roster_override(
  p_override_id uuid,
  p_member_in_id uuid,
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
  amended_out uuid;
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
      message = 'ROSTER_OVERRIDE_AMEND_REFUSED';
  end if;

  update public.roster_overrides o
     set removed_by = auth.uid(),
         removed_at = now()
   where o.id = p_override_id
     and o.organization_id = claimed
     and o.removed_at is null
  returning o.team_id, o.date, o.member_out_id into amended_team, amended_date, amended_out;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'ROSTER_OVERRIDE_NOT_LIVE';
  end if;

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
      message = 'ROSTER_OVERRIDE_CHANGED';
  end if;

  if exists (
    select 1
      from public.teams team
     where team.organization_id = claimed
       and team.id = amended_team
       and team.archived
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ROSTER_OVERRIDE_ARCHIVED';
  end if;

  -- `created_by` and `created_at` come from 0026's defaults: the caller, now.
  -- Any refusal here aborts the call, and the removal above with it.
  insert into public.roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason)
  values (claimed, amended_team, amended_date, amended_out, p_member_in_id, p_reason)
  returning id into replacement;

  -- 0032's link follows the change: the decision it carried out stands.
  update public.conflict_resolutions c
     set roster_override_id = replacement
   where c.organization_id = claimed
     and c.roster_override_id = p_override_id
     and c.removed_at is null;

  return replacement;
end;
$$;

revoke execute on function public.amend_roster_override(uuid, uuid, text, timestamptz) from public;
revoke execute on function public.amend_roster_override(uuid, uuid, text, timestamptz) from anon;
revoke execute on function public.amend_roster_override(uuid, uuid, text, timestamptz) from service_role;
grant execute on function public.amend_roster_override(uuid, uuid, text, timestamptz) to authenticated;

-- ------------------------------------------------------- (v) the calendar read

-- 0026's read, replaced so it also returns `confirmed_at`, exactly as 0022
-- replaced the shift-type read: the domain reads `confirmed_at ?? created_at`
-- as the instant the pending rule compares. `confirmed_by`, like
-- `created_by`, is an auth user id and never leaves this function. Dropped
-- and created, because a function's result columns cannot change in place;
-- the grants are written again for that reason.
drop function if exists public.calendar_roster_overrides();

create function public.calendar_roster_overrides()
returns table (
  id uuid,
  team_id uuid,
  date date,
  member_out_id uuid,
  member_in_id uuid,
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
         o.member_out_id,
         o.member_in_id,
         o.reason,
         o.created_at,
         o.confirmed_at,
         (
           select m.id
             from public.members m
            where m.organization_id = o.organization_id
              and m.auth_user_id = o.created_by
         )
    from public.roster_overrides o
   where o.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and o.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and o.removed_at is null
   order by o.team_id, o.date, o.id
$$;

revoke execute on function public.calendar_roster_overrides() from public;
revoke execute on function public.calendar_roster_overrides() from anon;
revoke execute on function public.calendar_roster_overrides() from service_role;
grant execute on function public.calendar_roster_overrides() to authenticated;

-- -------------------------------------------------------- (vi) the bounded read

-- 0025's computed relationship for the roster layer: the LIVE roster
-- overrides that are PENDING, a pending one no version governs included
-- (`coalesce(…, true)`), so the builder lists each for its disposition.
-- SECURITY INVOKER, STABLE SQL, `search_path` emptied, as 0025's: every row
-- still passes 0026's admin-only select policy as the caller, so a member
-- reads none.
create or replace function public.rotation_roster_overrides_in_view(public.organizations)
returns setof public.roster_overrides
language sql
stable
security invoker
set search_path = ''
as $$
  select o.*
    from public.roster_overrides o
   where o.organization_id = ($1).id
     and o.removed_at is null
     and coalesce(
           (
             select governing.created_at
               from public.rotation_assignments governing
              where governing.team_id = o.team_id
                and governing.effective_from <= o.date
              order by governing.effective_from desc
              limit 1
           ) > coalesce(o.confirmed_at, o.created_at),
           true
         )
$$;

revoke execute on function public.rotation_roster_overrides_in_view(public.organizations) from public;
revoke execute on function public.rotation_roster_overrides_in_view(public.organizations) from anon;
revoke execute on function public.rotation_roster_overrides_in_view(public.organizations) from service_role;
grant execute on function public.rotation_roster_overrides_in_view(public.organizations) to authenticated;

-- 0025's assignments in view, with ONE change: the horizon is also the date of
-- the team's earliest PENDING ROSTER override a version governs, when that is
-- earlier, so the review can show the version governing it. `least` ignores a
-- null, so a team with neither kind keeps yesterday. 0025's grants stand:
-- `create or replace` keeps them.
create or replace function public.rotation_assignments_in_view(public.organizations)
returns setof public.rotation_assignments
language sql
stable
security invoker
set search_path = ''
as $$
  select a.*
    from public.rotation_assignments a
   where a.organization_id = ($1).id
     and not exists (
       select 1
         from public.rotation_assignments later
        where later.team_id = a.team_id
          and later.effective_from > a.effective_from
          and later.effective_from <= least(
                public.organization_today(($1).id) - 1,
                (
                  select min(o.date)
                    from public.shift_type_overrides o
                   where o.organization_id = ($1).id
                     and o.team_id = a.team_id
                     and o.removed_at is null
                     and (
                       select governing.created_at
                         from public.rotation_assignments governing
                        where governing.team_id = o.team_id
                          and governing.effective_from <= o.date
                        order by governing.effective_from desc
                        limit 1
                     ) > coalesce(o.confirmed_at, o.created_at)
                ),
                (
                  select min(r.date)
                    from public.roster_overrides r
                   where r.organization_id = ($1).id
                     and r.team_id = a.team_id
                     and r.removed_at is null
                     and (
                       select governing.created_at
                         from public.rotation_assignments governing
                        where governing.team_id = r.team_id
                          and governing.effective_from <= r.date
                        order by governing.effective_from desc
                        limit 1
                     ) > coalesce(r.confirmed_at, r.created_at)
                )
              )
     )
$$;
