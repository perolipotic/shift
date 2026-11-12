-- 0059_half_day_requests.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 13.5b: a member asks for a half day (R9.2).
--
--   * A LEAVE REQUEST MAY BE A HALF DAY. `leave_requests` gains a nullable
--     `half`, `FIRST` or `SECOND`, with 0058's two checks on `leave_records`
--     restated under the request's names: the value is one of the two, and a
--     half is set only on a one-date range. Null is a whole day, so every
--     existing request and every insert that names no half reads as before.
--   * A MEMBER NAMES THE HALF on insert: 0040's insert grant (0054 added the
--     type) gains `half`.
--   * APPROVAL CARRIES THE HALF. `decide_leave_request` is replaced in place
--     (same signature): 0054's body, plus the request's half copied into the
--     record it creates. Approval never chooses or changes a half. Whether the
--     date still holds exactly one working shift is derived (AD-1), so the
--     decision never refuses on it: `packages/domain` costs a stored half on a
--     date with no working shift at 0, as it does an admin's record.
--   * THE OVERLAP RULES ARE UNCHANGED. 0040's pending-overlap exclusion, 0047's
--     rules and 0028's record exclusion still hold, so a half request on a
--     date that already has any record is refused as before, and approval
--     onto one is still `LEAVE_REQUEST_APPROVAL_OVERLAPS_LEAVE`.
--
-- A refused write arrives as one of, beside the earlier refusals:
--
--   * 23514 — `leave_requests_half_check` or `leave_requests_half_one_date`:
--     the half is not one of the two, or the range is more than one date.
--
-- No trigger and no other policy. Nothing here computes a figure (AD-7).

-- ------------------------------------------------------------- the column

alter table public.leave_requests
  add column half text
    constraint leave_requests_half_check check (half in ('FIRST', 'SECOND'));

-- A half day is one date. `upper - lower` of a canonical range is its count
-- of dates (0058 reads `leave_records` the same way).
alter table public.leave_requests
  add constraint leave_requests_half_one_date
    check (half is null or upper(during) - lower(during) = 1);

-- As 0054, plus the half: a session now names organization_id, member_id,
-- during, absence_type_id and half on insert, and nothing else.
grant insert (half) on table public.leave_requests to authenticated;

-- ------------------------------------------------------------- the decision

-- 0054's body, but the record an approval writes carries the request's half.
create or replace function public.decide_leave_request(p_request_id uuid, p_outcome text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  requested_member uuid;
  requested_during daterange;
  requested_type uuid;
  requested_half text;
  created_record uuid;
  decision_code text;
  decision_operands jsonb;
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
      message = 'LEAVE_REQUEST_DECISION_REFUSED';
  end if;

  if p_outcome is null or p_outcome not in ('approved', 'rejected') then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'LEAVE_REQUEST_OUTCOME_UNKNOWN';
  end if;

  update public.leave_requests r
     set closed_by = auth.uid(),
         closed_at = now()
   where r.id = p_request_id
     and r.organization_id = claimed
     and r.closed_at is null
  returning r.member_id, r.during, r.absence_type_id, r.half
       into requested_member, requested_during, requested_type, requested_half;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_REQUEST_NOT_PENDING';
  end if;

  if p_outcome = 'approved' then
    if public.member_inactive_within(requested_member, requested_during) then
      raise exception using
        errcode = 'object_not_in_prerequisite_state',
        message = 'LEAVE_REQUEST_MEMBER_INACTIVE';
    end if;

    -- 0043: the leave this approval writes sends nothing of its own; the
    -- decision rows below are the requester's one notification per channel.
    perform pg_catalog.set_config('shift.notify_suppress', 'approval', true);
    begin
      -- 0054: the record is of the type the member asked for; 0059: and of
      -- the half (null, a whole day, unless the request named one).
      insert into public.leave_records (organization_id, member_id, during, absence_type_id, half)
      values (claimed, requested_member, requested_during, requested_type, requested_half)
      returning id into created_record;
    exception
      when exclusion_violation then
        raise exception using
          errcode = 'exclusion_violation',
          message = 'LEAVE_REQUEST_APPROVAL_OVERLAPS_LEAVE';
    end;
    perform pg_catalog.set_config('shift.notify_suppress', '', true);
  end if;

  insert into public.leave_request_decisions (organization_id, request_id, outcome, leave_record_id)
  values (claimed, p_request_id, p_outcome, created_record);

  decision_code := case p_outcome when 'approved' then 'LEAVE_REQUEST_APPROVED' else 'LEAVE_REQUEST_REJECTED' end;
  decision_operands := pg_catalog.jsonb_build_object(
    'startDate', pg_catalog.to_char(pg_catalog.lower(requested_during), 'YYYY-MM-DD'),
    'endDate', pg_catalog.to_char(pg_catalog.upper(requested_during) - 1, 'YYYY-MM-DD')
  );

  -- 0046 (A4): the same recipient rules as every other event, on both
  -- channels.
  perform private.notify_members(
    claimed, decision_code, p_request_id, array[requested_member], decision_operands
  );

  return created_record;
end;
$$;

revoke execute on function public.decide_leave_request(uuid, text) from public;
revoke execute on function public.decide_leave_request(uuid, text) from anon;
revoke execute on function public.decide_leave_request(uuid, text) from service_role;
grant execute on function public.decide_leave_request(uuid, text) to authenticated;
