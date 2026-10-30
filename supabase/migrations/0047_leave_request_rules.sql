-- 0047_leave_request_rules.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Retro 8–9, action item 17 (C3): the two leave-request questions 9.2 and 9.3
-- left open, decided by the product owner on 2026-10-30.
--
-- (i) A MEMBER REQUESTS LEAVE FROM TODAY ON. A request whose first day is
--     before the organization's today (`organization_today`, 0008) is refused
--     with 55000 `LEAVE_REQUEST_IN_PAST`. Past leave is recorded by an admin
--     as a leave record (0028), which is unchanged and still takes any date.
--     The rule is the first check of `refuse_leave_request_over_leave()`
--     (0040, replaced by 0041), REPLACED here behind the same gates: only a
--     request session (the `authenticated` role) of an active account
--     inserting for its own member row is checked; every other insert is the
--     policy's 42501, and an owner's write is governed by no rule here. Then,
--     unchanged, 0041's inactive-date refusal and 0040's overlap refusal.
--
--     The trigger reads today when the row is inserted, so the database and
--     not the browser's clock decides. A request already pending whose first
--     day has since passed stays pending and may still be decided: an admin
--     may record past leave, so approving it is no different.
--
-- (ii) AN APPROVED REQUEST SAYS WHEN ITS LEAVE CHANGED. An approval creates
--     one leave record (`leave_request_decisions.leave_record_id`). An admin
--     may later amend it (`amend_leave_record`, 0029: the old row is removed
--     and a replacement inserted in ONE transaction) or remove it
--     (`remove_leave_record`). The request keeps its status, *Odobren*; what
--     changed is derived on read, never stored, by the computed field
--     `leave_record_change(leave_request_decisions)`:
--
--       * null      — the record is live, or the decision is no approval, or
--                     the caller may not read the record;
--       * 'amended' — the record was replaced, and the last replacement in
--                     the chain is live;
--       * 'removed' — the last record in the chain is removed, with no
--                     replacement: the leave is gone, whether it was removed
--                     at once or amended first and removed later.
--
--     AN AMEND'S SIGNATURE. 0029 writes no link from the old row to the new.
--     Both writes run in one transaction, so the replacement's `created_at`
--     (its default, `now()`) equals the old row's `removed_at` (`now()`), its
--     `created_by` (`auth.uid()`) equals the old row's `removed_by`, and its
--     member and organization are the old row's. No other path removes one
--     record and inserts another for the same member in one transaction, so
--     that match is the amend. The chain follows it from replacement to
--     replacement, never revisiting a record and bounded at 1000 steps; a
--     branch, which no path writes, is resolved the same way on every read.
--
--     A COMPUTED FIELD, so PostgREST embeds it beside `outcome`
--     (`leave_request_decisions(outcome,leave_record_change)`) on every read
--     that already embeds the decision: the member's own list and *Odlučeno*.
--     It is SQL, STABLE and SECURITY INVOKER: it reads `leave_records` under
--     the caller's own policy (0028), so an admin reads the organization's
--     and a member-role account its own, which is the request's member. It
--     writes nothing.
--
-- THE REFUSAL ADDED, as a SQLSTATE the browser maps by message:
--
--   * an insert into `leave_requests`: 55000 `LEAVE_REQUEST_IN_PAST`.
--
-- No table, policy or column grant changes. EXECUTE on the trigger function
-- stays nobody's; on `leave_record_change`, `authenticated`'s alone.
--
-- No notification (0043's `notify_leave_request` fires after the insert,
-- which this refusal aborts).

-- -------------------------------------------- (i) no request starting in the past

-- THE NAME IS KEPT: `leave_requests_refuse_over_leave` (0040) is bound to it.
create or replace function public.refuse_leave_request_over_leave() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
begin
  -- 0023's gate: a request session. The owner is governed by no policy here.
  if pg_catalog.current_setting('role') <> 'authenticated' then
    return new;
  end if;

  -- Anybody but an active account of the claimed organization inserting for
  -- its own member row is the policy's to refuse, with its own 42501: no
  -- leave, status or date is read for them.
  if claimed is null
     or new.organization_id is distinct from claimed
     or not exists (
       select 1
         from public.current_member_access() as access
        where access.organization_id = claimed
          and access.is_active
     )
     or not exists (
       select 1
         from public.members member
        where member.organization_id = claimed
          and member.id = new.member_id
          and member.auth_user_id = (select auth.uid())
     ) then
    return new;
  end if;

  -- 0047: the first day before the organization's today. Past leave is an
  -- admin's to record. `lower(during)` is the first day: 0040's checks keep
  -- the range bounded and its lower bound inclusive.
  if lower(new.during) < public.organization_today(new.organization_id) then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'LEAVE_REQUEST_IN_PAST';
  end if;

  -- 0041: a date on which the member is inactive, a scheduled deactivation's
  -- included.
  if public.member_inactive_within(new.member_id, new.during) then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = 'LEAVE_REQUEST_MEMBER_INACTIVE';
  end if;

  if exists (
    select 1
      from public.leave_records r
     where r.organization_id = new.organization_id
       and r.member_id = new.member_id
       and r.removed_at is null
       and r.during && new.during
  ) then
    raise exception using
      errcode = 'exclusion_violation',
      message = 'LEAVE_REQUEST_OVERLAPS_LEAVE';
  end if;

  return new;
end;
$$;

revoke execute on function public.refuse_leave_request_over_leave() from public;
revoke execute on function public.refuse_leave_request_over_leave() from anon;
revoke execute on function public.refuse_leave_request_over_leave() from authenticated;
revoke execute on function public.refuse_leave_request_over_leave() from service_role;

-- ------------------------------------- (ii) what became of an approval's leave

create function public.leave_record_change(decision public.leave_request_decisions)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive chain as (
    select r.id, r.organization_id, r.member_id, r.removed_at, r.removed_by, 0 as step, array[r.id] as path
      from public.leave_records r
     where r.organization_id = decision.organization_id
       and r.id = decision.leave_record_id

    union all

    -- The replacement an amend inserted in the transaction that removed the
    -- previous row (0029): same tenant and member, created when and by whom
    -- the previous row was removed.
    select next.id, next.organization_id, next.member_id, next.removed_at, next.removed_by, chain.step + 1,
           chain.path || next.id
      from chain
      join public.leave_records next
        on next.organization_id = chain.organization_id
       and next.member_id = chain.member_id
       and next.created_at = chain.removed_at
       and next.created_by = chain.removed_by
       and next.id <> all (chain.path)
     where chain.removed_at is not null
       and chain.step < 1000
  ),
  -- The furthest record; should the chain ever branch (one transaction
  -- inserting two records for the member, which no path writes today), a
  -- live leaf wins, then the lowest id, so the answer never flips between reads.
  last as (
    select chain.removed_at, chain.step
      from chain
     order by chain.step desc, chain.removed_at is null desc, chain.id
     limit 1
  )
  select case
           when last.removed_at is not null then 'removed'
           when last.step > 0 then 'amended'
         end
    from last;
$$;

-- 0029's explicit grants: only a signed-in session reads it, through
-- PostgREST's embed, and RLS decides what it sees.
revoke execute on function public.leave_record_change(public.leave_request_decisions) from public;
revoke execute on function public.leave_record_change(public.leave_request_decisions) from anon;
revoke execute on function public.leave_record_change(public.leave_request_decisions) from service_role;
grant execute on function public.leave_record_change(public.leave_request_decisions) to authenticated;
