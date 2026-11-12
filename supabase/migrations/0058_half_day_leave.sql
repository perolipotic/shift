-- 0058_half_day_leave.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 13.5: a half-day record costs half a day (R4.12, PO 2026-11-12).
--
--   * A LEAVE RECORD MAY BE A HALF DAY. `leave_records` gains a nullable
--     `half`, `FIRST` or `SECOND` of the member's working shift that date.
--     Null is a whole day, so every existing row and every insert that names
--     no half reads as before.
--   * THE SCHEMA OWNS THE SHAPE: a half is set only on a one-date range
--     (`upper - lower = 1` of the canonical `[)` range). Whether that date
--     holds exactly one working shift is derived (AD-1), so the database
--     cannot know it: the admin's dialog refuses it, and `packages/domain`
--     costs a stored half day on a date with no working shift at 0.
--   * ONE RECORD PER MEMBER PER DATE STAYS. 0028's exclusion is untouched, so
--     two halves on one date are refused like any overlap (23P01,
--     `LEAVE_OVERLAP` in the client).
--   * AN ADMIN NAMES THE HALF on insert: 0028's insert grant gains `half`.
--   * AMEND CARRIES THE HALF. `amend_leave_record` is dropped and recreated
--     with `p_half text default null`: null is a whole day, anything else is
--     the replacement's half. 0054's body and grants are otherwise restated
--     unchanged. A cached client that names no half amends to a whole day,
--     which is what it always wrote.
--   * BOTH LEAVE READS RETURN THE HALF. 0053's `my_leave_records()` and
--     `leave_overview_records()` are dropped and recreated (a function's
--     return type cannot be replaced in place), returning `half` as well.
--     Their bodies, checks, refusal and grants are otherwise unchanged.
--
-- NOT HERE: the member's half-day request (`leave_requests`, the request form,
-- `decide_leave_request`) is story 13.5b. An approval keeps writing a whole
-- day (null half).
--
-- No trigger and no other policy. Nothing here computes a figure (AD-7): what
-- a half day costs, and how it splits the shift's hours, is `packages/domain`'s.

-- ------------------------------------------------------------- the column

alter table public.leave_records
  add column half text
    constraint leave_records_half_check check (half in ('FIRST', 'SECOND'));

-- A half day is one date. `upper - lower` of a canonical range is its count
-- of dates (0028's 366-day check reads it the same way).
alter table public.leave_records
  add constraint leave_records_half_one_date
    check (half is null or upper(during) - lower(during) = 1);

grant insert (half) on table public.leave_records to authenticated;

-- ---------------------------------------------------------------- the amend

-- A new parameter is a new signature, so the four-argument function is
-- dropped rather than left beside an overload PostgREST could not choose
-- between. The three- and four-argument calls of an old cached client
-- resolve to the new function through the defaults.
drop function public.amend_leave_record(uuid, date, date, uuid);

-- 0054's body, plus the half: null is a whole day.
create function public.amend_leave_record(
  p_record_id uuid,
  p_from date,
  p_to date,
  p_absence_type_id uuid default null,
  p_half text default null
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

  -- 0054: the named type, or the amended record's own. 0058: the named half,
  -- null a whole day; a half on more than one date, or neither FIRST nor
  -- SECOND, is refused by the table's checks (23514).
  insert into public.leave_records (organization_id, member_id, during, absence_type_id, half)
  values (
    claimed,
    amended_member,
    pg_catalog.daterange(p_from, p_to, '[]'),
    coalesce(p_absence_type_id, amended_type),
    p_half
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

revoke execute on function public.amend_leave_record(uuid, date, date, uuid, text) from public;
revoke execute on function public.amend_leave_record(uuid, date, date, uuid, text) from anon;
revoke execute on function public.amend_leave_record(uuid, date, date, uuid, text) from service_role;
grant execute on function public.amend_leave_record(uuid, date, date, uuid, text) to authenticated;

-- -------------------------------------------------------- the member's own read

-- As 0053, plus the record's half.
drop function public.my_leave_records();

create function public.my_leave_records()
returns table (
  id uuid,
  member_id uuid,
  during daterange,
  absence_type_id uuid,
  draws_allowance boolean,
  half text
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
         t.draws_allowance,
         r.half
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

-- As 0053, plus the record's half.
drop function public.leave_overview_records();

create function public.leave_overview_records()
returns table (
  id uuid,
  member_id uuid,
  during daterange,
  absence_type_id uuid,
  draws_allowance boolean,
  half text
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
           t.draws_allowance,
           r.half
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
