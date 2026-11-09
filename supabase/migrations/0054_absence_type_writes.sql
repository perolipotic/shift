-- 0054_absence_type_writes.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 13.2b: the type is chosen when absence is recorded. THE WRITE SIDE of
-- 13.2 (0053 is the read side).
--
--   * AN ADMIN NAMES THE TYPE OF A RECORD. 0028's insert grant on
--     `leave_records` gains `absence_type_id`. 0052's composite foreign key
--     already pins it to a type of the record's own organization, so another
--     tenant's type is 23503.
--   * A MEMBER NAMES THE TYPE OF A REQUEST. `leave_requests` gains
--     `absence_type_id`, defaulting to annual leave, with the same composite
--     foreign key as 0052's (no cascade) and an index; 0040's insert grant
--     gains the column. A member may request any type of their organization.
--   * APPROVAL COPIES THE REQUEST'S TYPE. `decide_leave_request` (0046's body)
--     writes the request's type into the record it creates. Approval never
--     chooses or changes a type.
--   * AMEND CARRIES THE TYPE. `amend_leave_record` is dropped and recreated
--     with `p_absence_type_id uuid default null`: null keeps the record's own
--     type, anything else is the replacement's type. 0043's body and 0029's
--     grants are otherwise restated unchanged.
--
-- OLD CLIENTS. Every default writes annual leave: a cached client that names
-- no type on insert, request or amend keeps writing what it wrote before
-- (amend now keeps the record's type, which before 13.2b was always annual).
--
-- No trigger and no check on the type; collisions, staffing and balances are
-- unchanged (they read the type since 0053).
--
-- A refused write arrives as one of, beside the earlier refusals:
--
--   * 23503 — `leave_records_absence_type_fkey` or
--     `leave_requests_absence_type_fkey`: the type is not one of the
--     organization's own.

-- ------------------------------------------------------- the record's grant

-- As 0028, plus the type: a session now names organization_id, member_id,
-- during and absence_type_id on insert, and nothing else.
grant insert (absence_type_id) on table public.leave_records to authenticated;

-- ---------------------------------------------------------- the request's type

-- A constant default: every existing request, open or closed, takes annual
-- leave as the column is added, which is what each one asked for.
alter table public.leave_requests
  add column absence_type_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid;

-- As 0052's on `leave_records`: to the type of the request's own organization,
-- NO cascade.
alter table public.leave_requests
  add constraint leave_requests_absence_type_fkey
    foreign key (organization_id, absence_type_id)
    references public.absence_types (organization_id, id);

create index leave_requests_organization_absence_type_idx
  on public.leave_requests (organization_id, absence_type_id);

-- As 0040, plus the type: a session now names organization_id, member_id,
-- during and absence_type_id on insert, and nothing else.
grant insert (absence_type_id) on table public.leave_requests to authenticated;

-- ------------------------------------------------------------- the decision

-- 0046's body, but the record an approval writes carries the request's type.
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
  returning r.member_id, r.during, r.absence_type_id
       into requested_member, requested_during, requested_type;

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
      -- 0054: the record is of the type the member asked for.
      insert into public.leave_records (organization_id, member_id, during, absence_type_id)
      values (claimed, requested_member, requested_during, requested_type)
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

-- ---------------------------------------------------------------- the amend

-- A new parameter is a new signature, so the three-argument function is
-- dropped rather than left beside an overload PostgREST could not choose
-- between. The three-argument call of an old cached client resolves to the
-- new function through the default.
drop function public.amend_leave_record(uuid, date, date);

-- 0043's body, plus the type: null keeps the amended record's own type.
create function public.amend_leave_record(
  p_record_id uuid,
  p_from date,
  p_to date,
  p_absence_type_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  amended_member uuid;
  amended_during daterange;
  amended_type uuid;
  replacement uuid;
  replacement_during daterange;
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
      message = 'LEAVE_RECORD_AMEND_REFUSED';
  end if;

  -- 0043: one `LEAVE_RECORD_CHANGED`, never removed + recorded.
  perform pg_catalog.set_config('shift.notify_suppress', 'amend', true);

  update public.leave_records r
     set removed_by = auth.uid(),
         removed_at = now()
   where r.id = p_record_id
     and r.organization_id = claimed
     and r.removed_at is null
  returning r.member_id, r.during, r.absence_type_id
       into amended_member, amended_during, amended_type;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_RECORD_NOT_LIVE';
  end if;

  -- 0054: the named type, or the amended record's own. Another tenant's type
  -- is refused by 0052's composite foreign key (23503).
  insert into public.leave_records (organization_id, member_id, during, absence_type_id)
  values (
    claimed,
    amended_member,
    pg_catalog.daterange(p_from, p_to, '[]'),
    coalesce(p_absence_type_id, amended_type)
  )
  returning id, during into replacement, replacement_during;

  perform pg_catalog.set_config('shift.notify_suppress', '', true);

  update public.conflict_resolutions c
     set removed_by = auth.uid(),
         removed_at = now()
   where c.organization_id = claimed
     and c.member_id = amended_member
     and c.removed_at is null
     and c.date <@ amended_during
     and not (c.date <@ replacement_during);

  return replacement;
end;
$$;

revoke execute on function public.amend_leave_record(uuid, date, date, uuid) from public;
revoke execute on function public.amend_leave_record(uuid, date, date, uuid) from anon;
revoke execute on function public.amend_leave_record(uuid, date, date, uuid) from service_role;
grant execute on function public.amend_leave_record(uuid, date, date, uuid) to authenticated;
