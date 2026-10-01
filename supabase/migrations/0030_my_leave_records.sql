-- 0030_my_leave_records.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 5.2c: a member opens *Godišnji* and sees their own allowance, days used
-- and balance.
--
-- THE MEMBER'S OWN READ. 0028's select policy already shows a member-role
-- session the records of its own member row, but a plain select on
-- `leave_records` carries `created_by` and `removed_by` — the auth user ids of
-- the admins who recorded and removed them. This function is what the member
-- surface reads instead: the caller's own LIVE records, shaped
-- `id, member_id, during`, and nothing else. No author, no removal, no other
-- member's row and no other organization's.
--
-- Shaped as 0026's `calendar_roster_overrides()`, and pinned the same way:
-- SECURITY DEFINER and STABLE with an empty search_path and no argument; zero
-- rows unless the caller is active and the token's organization is the
-- caller's own. The member is matched by `members.auth_user_id = auth.uid()`,
-- so there is no subject to point elsewhere with. An admin's own member row is
-- matched the same way: admins see the tab too.
--
-- NO FIGURE IS COMPUTED HERE (AD-7). What a record costs and what the balance
-- is stay `packages/domain`'s question alone; this returns the ranges as
-- stored. No table grant and no policy changes, and nothing here writes,
-- reads or refers to a rotation, membership, status or override row.
create function public.my_leave_records()
returns table (
  id uuid,
  member_id uuid,
  during daterange
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         r.member_id,
         r.during
    from public.leave_records r
    join public.members m
      on m.organization_id = r.organization_id
     and m.id = r.member_id
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

-- The same explicit grants 0026 writes: Supabase's default privileges grant
-- EXECUTE to `anon`, `authenticated` and `service_role` individually. Only a
-- signed-in session calls this.
revoke execute on function public.my_leave_records() from public;
revoke execute on function public.my_leave_records() from anon;
revoke execute on function public.my_leave_records() from service_role;
grant execute on function public.my_leave_records() to authenticated;
