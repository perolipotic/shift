-- 0021_remove_shift_type_override.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 3.5b: an admin sets or removes a shift-type override.
--
-- THE REMOVAL 0019 DEFERRED. 0019 created `removed_by` and `removed_at` with
-- no writer and left how a removal is attributed to story 3.5b; this file is
-- that answer, and 0019 itself stays as it was written (forward-only).
--
-- SETTING is 0019's plain insert, whose `created_by` default and WITH CHECK
-- already attribute it. REMOVING is this one function: it soft-removes a live
-- override by setting `removed_by` and `removed_at` together, attributed here,
-- on the server — a column default cannot attribute an UPDATE, and a removal
-- time a client supplied could be backdated. The row stays as the record of
-- what was changed, and the partial unique key of 0019 then admits a new live
-- override on the same team and date. There is NO in-place change: to change
-- an override, remove it and set a new one (the user's decision, 2026-09-27).
--
-- A DELIBERATE EXCEPTION to "no new function" (AD-11), scoped to this one
-- soft-remove. No table grant and no policy changes: a session still holds no
-- update or delete on `shift_type_overrides`, and this function is the only
-- way `removed_by` and `removed_at` are ever written. Nothing here writes,
-- reads or refers to a rotation row, so those are byte-identical before and
-- after a removal (DI-2), and the removed override's projected type is
-- restored exactly.
--
-- SECURITY DEFINER, because no session may update the table; the scope is this
-- function's own checks, not the table's policies (RLS is enabled, not forced,
-- so the owner is past it). `search_path` is emptied and every name qualified,
-- as 0002's definer writes it.
--
-- THE REFUSALS, as SQLSTATEs the browser maps:
--
--   * 42501 (`insufficient_privilege`) unless the caller is an ACTIVE ADMIN of
--     the organization the token claims — the claim and helper pins 0019's
--     insert policy writes.
--   * P0002 (`no_data_found`) when no LIVE override with that id is in that
--     organization: already removed, never there, or another tenant's. Another
--     tenant's id is indistinguishable from none, so nothing about it leaks.
--
-- No trigger.

create function public.remove_shift_type_override(p_override_id uuid)
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

-- The same explicit grants 0018 and 0019 write: Supabase's default privileges
-- grant EXECUTE to `anon`, `authenticated` and `service_role` individually.
-- Only a signed-in session calls this, and the function itself decides who of
-- them may.
revoke execute on function public.remove_shift_type_override(uuid) from public;
revoke execute on function public.remove_shift_type_override(uuid) from anon;
revoke execute on function public.remove_shift_type_override(uuid) from service_role;
grant execute on function public.remove_shift_type_override(uuid) to authenticated;
