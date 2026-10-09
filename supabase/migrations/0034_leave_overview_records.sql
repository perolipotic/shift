-- 0034_leave_overview_records.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 7.15: an admin opens *Godišnji* and sees every member's allowance,
-- days used and balance for the leave year, in one overview.
--
-- THE ORGANIZATION'S READ, WITH A REFUSAL. 0028's select policy already shows
-- an active admin every record of the organization — but it shows a
-- member-role session its own records, quietly, so a plain select cannot
-- refuse a member who asks for everyone's leave. This function is what the
-- overview reads instead: the caller organization's LIVE records, shaped
-- `id, member_id, during` as 0030's are, and nothing else — no author, no
-- removal. Any caller but an ACTIVE ADMIN of the organization the token
-- claims is refused with 42501 (`insufficient_privilege`) and
-- `LEAVE_OVERVIEW_REFUSED`. The caller is checked as 0029's removal checks
-- it: against both the token's claim and the fresh helper. A claim that is
-- not a UUID is no organization, so it is refused the same way, never a
-- 22P02 from the cast.
--
-- SECURITY DEFINER, STABLE, an empty search_path and no argument, as 0030's
-- `my_leave_records()`: there is no subject to point elsewhere with, and the
-- organization is the token's, re-checked against the fresh helper.
--
-- NO FIGURE IS COMPUTED HERE (AD-7). What a record costs and what a balance
-- is stay `packages/domain`'s question alone; this returns the ranges as
-- stored, and the app pages them under `max_rows` with an exact count, as it
-- pages 5.3b's select. No table grant and no policy changes, and nothing here
-- writes, reads or refers to a rotation, membership, status or override row.
create function public.leave_overview_records()
returns table (
  id uuid,
  member_id uuid,
  during daterange
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
           r.during
      from public.leave_records r
     where r.organization_id = claimed
       and r.removed_at is null
     order by r.id;
end;
$$;

-- The same explicit grants 0030 writes: Supabase's default privileges grant
-- EXECUTE to `anon`, `authenticated` and `service_role` individually. Only a
-- signed-in session calls this, and the function itself decides who of them
-- may.
revoke execute on function public.leave_overview_records() from public;
revoke execute on function public.leave_overview_records() from anon;
revoke execute on function public.leave_overview_records() from service_role;
grant execute on function public.leave_overview_records() to authenticated;
