-- 0060_half_day_notifications.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 13.7b: a notification names the half (epic 13 retro B5).
--
--   * A HALF DAY'S OPERANDS CARRY ITS HALF. The six leave codes
--     (`LEAVE_RECORDED`, `LEAVE_RECORD_CHANGED`, `LEAVE_RECORD_REMOVED`,
--     `LEAVE_REQUEST_CREATED`, `LEAVE_REQUEST_APPROVED`,
--     `LEAVE_REQUEST_REJECTED`) gain a `half` operand, `FIRST` or `SECOND`,
--     written from the row itself: `new.half` in the two trigger functions,
--     `requested_half` in `decide_leave_request`. A whole day writes no `half`
--     key at all, so its operands are byte-identical to before.
--   * AN AMEND NAMES THE NEW HALF. `amend_leave_record` (0058) is unchanged:
--     its replacement insert fires `notify_leave_record` with the new row, so
--     `LEAVE_RECORD_CHANGED` carries the replacement's half and a half-only
--     amend reads differently from its predecessor.
--   * `notify` picks a half variant of the message when `half` is set (the
--     way it picks a two-way swap's); an old `notify` ignores the unknown
--     operand and sends the whole-day text, so this migration may go first.
--
-- The three functions are replaced in place (`create or replace`, same
-- signatures): 0043's two trigger functions and 0059's `decide_leave_request`,
-- each with its body otherwise unchanged. The triggers stay bound. No operand
-- names a type (Q5): these codes reach only the subject member or admins.
--
-- No new table, column, trigger or policy.

-- ------------------------------------------------------------ leave records

-- 0043's body; 0060: plus the row's half.
create or replace function private.notify_leave_record() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  suppressed text := private.notify_suppression();
  today date := public.organization_today(new.organization_id);
  -- Not wholly before today: the last day is upper - 1.
  current_live boolean := pg_catalog.upper(new.during) - 1 >= today;
  operands jsonb := pg_catalog.jsonb_build_object(
    'startDate', pg_catalog.to_char(pg_catalog.lower(new.during), 'YYYY-MM-DD'),
    'endDate', pg_catalog.to_char(pg_catalog.upper(new.during) - 1, 'YYYY-MM-DD')
  )
  -- 0060: the row's half, on the insert (an amend's replacement included) and
  -- on the removal; a whole day writes no `half` key.
  || case when new.half is null then '{}'::jsonb else pg_catalog.jsonb_build_object('half', new.half) end;
  previous jsonb;
begin
  if tg_op = 'INSERT' then
    -- The approval's leave: the decision email is the only one.
    if suppressed = 'approval' then
      return null;
    end if;

    if suppressed = 'amend' then
      previous := private.take_amended();
      perform private.notify_members(
        new.organization_id, 'LEAVE_RECORD_CHANGED', new.id,
        private.amended_members(previous)
          || case when current_live then array[new.member_id] else '{}'::uuid[] end,
        operands
      );
    elsif current_live then
      perform private.notify_members(
        new.organization_id, 'LEAVE_RECORDED', new.id, array[new.member_id], operands
      );
    end if;
    return null;
  end if;

  -- The removal.
  if suppressed = 'amend' then
    perform private.remember_amended(pg_catalog.jsonb_build_object(
      'members', case when current_live then pg_catalog.jsonb_build_array(old.member_id) else '[]'::jsonb end
    ));
    return null;
  end if;

  if current_live then
    perform private.notify_members(
      new.organization_id, 'LEAVE_RECORD_REMOVED', new.id, array[new.member_id], operands
    );
  end if;
  return null;
end;
$$;

-- ----------------------------------------------------------- leave requests

-- 0043's body; 0060: plus the request's half.
create or replace function private.notify_leave_request() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admins uuid[];
  requester text;
begin
  select m.name into requester
    from public.members m
   where m.organization_id = new.organization_id
     and m.id = new.member_id;
  if requester is null then
    return null;
  end if;

  select coalesce(pg_catalog.array_agg(m.id), '{}'::uuid[]) into admins
    from public.members m
   where m.organization_id = new.organization_id
     and m.role = 'admin';

  perform private.notify_members(
    new.organization_id, 'LEAVE_REQUEST_CREATED', new.id, admins,
    pg_catalog.jsonb_build_object(
      'requestId', new.id::text,
      'memberName', requester,
      'startDate', pg_catalog.to_char(pg_catalog.lower(new.during), 'YYYY-MM-DD'),
      'endDate', pg_catalog.to_char(pg_catalog.upper(new.during) - 1, 'YYYY-MM-DD')
    )
    -- 0060: the request's half; a whole day writes no `half` key.
    || case when new.half is null then '{}'::jsonb else pg_catalog.jsonb_build_object('half', new.half) end
  );
  return null;
end;
$$;

-- Nothing calls these by hand; Postgres checks EXECUTE when a trigger is
-- created, not when it fires. As 0043.
revoke execute on function private.notify_leave_record() from public, anon, authenticated, service_role;
revoke execute on function private.notify_leave_request() from public, anon, authenticated, service_role;

-- ------------------------------------------------------------- the decision

-- 0059's body; 0060: the decision's operands carry the request's half.
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
  )
  -- 0060: the request's half; a whole day writes no `half` key.
  || case when requested_half is null then '{}'::jsonb else pg_catalog.jsonb_build_object('half', requested_half) end;

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
