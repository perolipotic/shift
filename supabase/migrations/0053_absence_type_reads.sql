-- 0053_absence_type_reads.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 13.2: leave is reported and balanced by type. THE READ SIDE ONLY; the
-- write side (a type on a request, amend and approval carrying it, a session's
-- privilege on `leave_records.absence_type_id`) is 13.2b's.
--
--   * EVERY ACTIVE MEMBER READS THE CATALOG (PO Q2). The admin-only select
--     policy of 0052 is replaced by one that lets any active member of the
--     token's organization read its absence types: the member's own balance
--     and hours split by type, and a type row names no person. Admins keep
--     0052's insert and update policies and grants unchanged.
--   * THE MEMBER'S AND THE OVERVIEW'S LEAVE READS CARRY THE TYPE. 0030's
--     `my_leave_records()` and 0034's `leave_overview_records()` are dropped
--     and recreated (a function's return type cannot be replaced in place),
--     returning `absence_type_id` and the type's current `draws_allowance` as
--     well. Their bodies, checks, refusal and grants are otherwise unchanged.
--     The flag is current-state (AD-2): it is read, never stored on a record.
--
-- ORDER OF DEPLOY: apply this migration BEFORE the web build that embeds
-- `absence_types` in the calendar snapshot. Under 0052's admin-only policy a
-- member session's embed answers an empty catalog, and the member's *Sati* is
-- then unavailable (it refuses a catalog without annual leave) until 0053 is in.
--
-- No other grant, no write path and no trigger. Nothing here computes a figure
-- (AD-7): which records draw the allowance is `packages/domain`'s question,
-- answered from the flag returned here.

-- ------------------------------------------------------------ the catalog read

drop policy absence_types_select_by_own_active_admin on public.absence_types;

-- An active member of the token's organization, of either role, reads its
-- types. Another tenant's types and an inactive member's session read none.
create policy absence_types_select_by_own_active_member on public.absence_types
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
  );

-- -------------------------------------------------------- the member's own read

-- As 0030, plus the record's type and whether that type draws the allowance.
-- The join is to the type of the record's own organization (0052's composite
-- foreign key guarantees it exists).
drop function public.my_leave_records();

create function public.my_leave_records()
returns table (
  id uuid,
  member_id uuid,
  during daterange,
  absence_type_id uuid,
  draws_allowance boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         r.member_id,
         r.during,
         r.absence_type_id,
         t.draws_allowance
    from public.leave_records r
    join public.members m
      on m.organization_id = r.organization_id
     and m.id = r.member_id
    join public.absence_types t
      on t.organization_id = r.organization_id
     and t.id = r.absence_type_id
   where r.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and r.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and m.auth_user_id = (select auth.uid())
     and r.removed_at is null
   order by r.during, r.id
$$;

revoke execute on function public.my_leave_records() from public;
revoke execute on function public.my_leave_records() from anon;
revoke execute on function public.my_leave_records() from service_role;
grant execute on function public.my_leave_records() to authenticated;

-- ------------------------------------------------------ the organization's read

-- As 0034, plus the record's type and whether that type draws the allowance.
drop function public.leave_overview_records();

create function public.leave_overview_records()
returns table (
  id uuid,
  member_id uuid,
  during daterange,
  absence_type_id uuid,
  draws_allowance boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claim text := nullif(((select auth.jwt()) ->> 'organization_id'), '');
  claimed uuid;
begin
  -- Cast only a claim shaped as a UUID: anything else is refused below.
  if claim ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    claimed := claim::uuid;
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
      message = 'LEAVE_OVERVIEW_REFUSED';
  end if;

  return query
    select r.id,
           r.member_id,
           r.during,
           r.absence_type_id,
           t.draws_allowance
      from public.leave_records r
      join public.absence_types t
        on t.organization_id = r.organization_id
       and t.id = r.absence_type_id
     where r.organization_id = claimed
       and r.removed_at is null
     order by r.id;
end;
$$;

revoke execute on function public.leave_overview_records() from public;
revoke execute on function public.leave_overview_records() from anon;
revoke execute on function public.leave_overview_records() from service_role;
grant execute on function public.leave_overview_records() to authenticated;
