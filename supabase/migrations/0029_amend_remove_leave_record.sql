-- 0029_amend_remove_leave_record.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 5.2a: a leave record is amended or removed in one attributed step, and
-- the balance follows.
--
-- THE REMOVAL 0028 DEFERRED. 0028 created `removed_by` and `removed_at` on
-- `leave_records` with no writer and left how a removal is attributed to
-- story 5.2; this file is that answer. The removal is copied from 0027's
-- removal of a roster override, and the amend from 0022's
-- `amend_shift_type_override`.
--
-- RECORDING is still 0028's plain insert, whose `created_by` default and WITH
-- CHECK attribute it. The AMEND's replacement insert is not: it runs here, as
-- the definer's owner, past 0028's insert policy. What attributes and guards
-- it instead is this function's own active-admin check (the same claim and
-- helper pins that policy writes), the `created_by default auth.uid()`, and
-- the organization and member taken from the live row itself, under 0028's
-- composite key. REMOVING is `remove_leave_record`: it soft-removes a
-- live leave record by setting `removed_by` and `removed_at` together,
-- attributed here, on the server — a column default cannot attribute an
-- UPDATE, and a removal time a client supplied could be backdated. The row
-- stays as the record of what was taken, and it leaves 0028's exclusion, so
-- the same dates may be recorded again.
--
-- AMENDING is `amend_leave_record`: the removal, then the insert of the
-- replacement range for the same organization and member, in ONE transaction,
-- returning the new record's id. There is NO in-place change: the old row is
-- kept as history, and the new one is attributed by 0028's defaults
-- (`created_by` the caller, `created_at` now). Because the old record leaves
-- the exclusion before the new one is inserted, the new range may overlap the
-- old one. Any refusal of the insert — 0028's exclusion against ANOTHER live
-- record (23P01), a reversed range (22000), an infinite bound (22008) or a
-- range 0028's checks refuse (23514) — aborts the whole call, so the removal
-- is rolled back with it and the old record stays live and unchanged.
--
-- NO BALANCE CHECK (R4.7). What a record costs, and what the balance becomes,
-- is `packages/domain`'s question alone (AD-7): the client reads the live
-- records again and the domain computes from them, so the balance follows a
-- removal or an amend with no write here beyond the two rows.
--
-- A DELIBERATE EXCEPTION to "no new function" (AD-11), scoped to this one
-- soft-remove and its amend, as 0021, 0022 and 0027 are. No table grant and
-- no policy changes: a session still holds no update or delete on
-- `leave_records`, and these two functions are the only way a session (`anon`
-- or `authenticated`) ever writes `removed_by` and `removed_at`. The owner and
-- `service_role` can still write them directly. Nothing here writes, reads or refers to a
-- rotation, membership, status or override row, so those are byte-identical
-- before and after (DI-3).
--
-- SECURITY DEFINER, because no session may update the table; the scope is
-- each function's own checks, not the table's policies (RLS is enabled, not
-- forced, so the owner is past it). `search_path` is emptied and every name
-- qualified, as 0002's definer writes it.
--
-- THE REFUSALS, as SQLSTATEs the browser maps:
--
--   * 42501 (`insufficient_privilege`) unless the caller is an ACTIVE ADMIN of
--     the organization the token claims — the claim and helper pins 0028's
--     insert policy writes.
--   * P0002 (`no_data_found`) when no LIVE leave record with that id is in
--     that organization: already removed, never there, or another tenant's.
--     Another tenant's id is indistinguishable from none, so nothing about it
--     leaks.
--   * The amend's insert, refused by 0028 as above: 23P01, 22000, 22008,
--     23514.
--
-- No trigger.

-- ---------------------------------------------------------------- the removal

create function public.remove_leave_record(p_record_id uuid)
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
      message = 'LEAVE_RECORD_REMOVAL_REFUSED';
  end if;

  update public.leave_records r
     set removed_by = auth.uid(),
         removed_at = now()
   where r.id = p_record_id
     and r.organization_id = claimed
     and r.removed_at is null;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_RECORD_NOT_LIVE';
  end if;
end;
$$;

-- The same explicit grants 0027 writes: Supabase's default privileges grant
-- EXECUTE to `anon`, `authenticated` and `service_role` individually. Only a
-- signed-in session calls this, and the function itself decides who of them
-- may.
revoke execute on function public.remove_leave_record(uuid) from public;
revoke execute on function public.remove_leave_record(uuid) from anon;
revoke execute on function public.remove_leave_record(uuid) from service_role;
grant execute on function public.remove_leave_record(uuid) to authenticated;

-- ------------------------------------------------------------------ the amend

create function public.amend_leave_record(p_record_id uuid, p_from date, p_to date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  amended_member uuid;
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
      message = 'LEAVE_RECORD_AMEND_REFUSED';
  end if;

  update public.leave_records r
     set removed_by = auth.uid(),
         removed_at = now()
   where r.id = p_record_id
     and r.organization_id = claimed
     and r.removed_at is null
  returning r.member_id into amended_member;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_RECORD_NOT_LIVE';
  end if;

  -- `created_by` and `created_at` come from 0028's defaults: the caller, now.
  -- Any refusal here aborts the call, and the removal above with it.
  insert into public.leave_records (organization_id, member_id, during)
  values (claimed, amended_member, pg_catalog.daterange(p_from, p_to, '[]'))
  returning id into replacement;

  return replacement;
end;
$$;

revoke execute on function public.amend_leave_record(uuid, date, date) from public;
revoke execute on function public.amend_leave_record(uuid, date, date) from anon;
revoke execute on function public.amend_leave_record(uuid, date, date) from service_role;
grant execute on function public.amend_leave_record(uuid, date, date) to authenticated;
