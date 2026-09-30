-- 0027_remove_roster_override.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 3.6b: an admin adds, removes or replaces someone on a shift.
--
-- THE REMOVAL 0026 DEFERRED. 0026 created `removed_by` and `removed_at` on
-- `roster_overrides` with no writer and left how a removal is attributed to
-- story 3.6b; this file is that answer, copied from 0021's removal of a
-- shift-type override.
--
-- WRITING is 0026's plain insert, whose `created_by` default and WITH CHECK
-- already attribute it: one row takes a member off, puts one on, or both (a
-- replacement). REMOVING is this one function: it soft-removes a live roster
-- override by setting `removed_by` and `removed_at` together, attributed here,
-- on the server — a column default cannot attribute an UPDATE, and a removal
-- time a client supplied could be backdated. The row stays as the record of
-- what was changed, and 0026's partial unique keys then admit a new live
-- override naming the same members on the same team and date. There is NO
-- in-place change: to change a roster change, remove it and save a new one.
--
-- A DELIBERATE EXCEPTION to "no new function" (AD-11), scoped to this one
-- soft-remove, as 0021 is. No table grant and no policy changes: a session
-- still holds no update or delete on `roster_overrides`, and this function is
-- the only way `removed_by` and `removed_at` are ever written. Nothing here
-- writes, reads or refers to a rotation, membership or status row, so those
-- are byte-identical before and after a removal (DI-2), and the shift's
-- default roster is restored exactly.
--
-- SECURITY DEFINER, because no session may update the table; the scope is this
-- function's own checks, not the table's policies (RLS is enabled, not forced,
-- so the owner is past it). `search_path` is emptied and every name qualified,
-- as 0002's definer writes it.
--
-- THE REFUSALS, as SQLSTATEs the browser maps:
--
--   * 42501 (`insufficient_privilege`) unless the caller is an ACTIVE ADMIN of
--     the organization the token claims — the claim and helper pins 0026's
--     insert policy writes.
--   * P0002 (`no_data_found`) when no LIVE roster override with that id is in
--     that organization: already removed, never there, or another tenant's.
--     Another tenant's id is indistinguishable from none, so nothing about it
--     leaks.
--
-- No trigger.

create function public.remove_roster_override(p_override_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
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
end;
$$;

-- The same explicit grants 0021 writes: Supabase's default privileges grant
-- EXECUTE to `anon`, `authenticated` and `service_role` individually. Only a
-- signed-in session calls this, and the function itself decides who of them
-- may.
revoke execute on function public.remove_roster_override(uuid) from public;
revoke execute on function public.remove_roster_override(uuid) from anon;
revoke execute on function public.remove_roster_override(uuid) from service_role;
grant execute on function public.remove_roster_override(uuid) to authenticated;
