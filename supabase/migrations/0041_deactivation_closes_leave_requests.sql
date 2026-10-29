-- 0041_deactivation_closes_leave_requests.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Retro 8–9, C1: a deactivated member's pending leave request stayed in
-- *Za odluku*, was priced as if they were active, could be approved into
-- leave for an inactive member, and could no longer be withdrawn by them.
--
-- THE RULE (human decision 2026-10-28): DEACTIVATION CLOSES the member's
-- pending requests that reach the deactivation date or later, and no request
-- is ever approved, or sent, onto a date on which its member is inactive.
--
-- WHAT THIS FILE DOES, in order:
--
--   (i)   `leave_request_decisions.outcome` admits a third outcome,
--         `deactivated`: a request closed because its member was deactivated.
--         0040's other checks hold as they are: a `deactivated` decision, like
--         a rejection, carries no leave record. STATUS IS STILL DERIVED, NEVER
--         STORED TWICE: a closed request with a `deactivated` decision reads
--         "closed on deactivation". A decision row, and not a close without
--         one, because a close without a decision already means WITHDRAWN,
--         and a member who still signs in until a scheduled deactivation must
--         not read "withdrawn" for something they never withdrew.
--   (ii)  `member_inactive_within(member, range)`: whether the member is
--         inactive on ANY date of the range, from 0008's one reading of
--         `member_status_versions`. Versions alternate (0008), so that is: not
--         active on the range's first date, or an inactive version dated
--         inside it.
--   (iii) `close_leave_requests_on_deactivation()`, an AFTER INSERT row
--         trigger on `member_status_versions` for an inactive version only. A
--         deactivation from D leaves the member inactive on every date from D
--         on (the latest version, 0008's date order), so it closes every
--         pending request of that member whose range reaches D or later
--         (`upper(during) > effective_from`): closed by the version's
--         `created_by`, now, with a `deactivated` decision by the same admin
--         and no leave record. THE WHOLE REQUEST, never a shrunk one: a range
--         that straddles D is closed whole, and the member asks again. A
--         request that ended before D stays pending, and approvable. A
--         reactivation closes nothing.
--
--         A TRIGGER, NOT AN RPC: a deactivation is a plain RLS insert from the
--         browser (0008), and a definer beside it would leave that path open.
--         It fires wherever a deactivation is written, the owner's included,
--         in the same statement as the version, so a refused version (the
--         policy, 0023's re-check, the zero-admins rule) closes nothing.
--         CANCELLING a scheduled deactivation reopens nothing (human decision):
--         the requests stay closed, and the member asks again.
--
--         THE LOCK: the version insert takes 0023's statement lock, and the
--         close is an update of `leave_requests`, whose own statement trigger
--         takes the same key again (re-entrant). `decide_leave_request` takes
--         it before its first check. So a deactivation and an approval of one
--         organization are served one after the other: an approval that waited
--         finds the request closed (P0002), and a deactivation that waited for
--         an approval finds it decided and leaves it be.
--   (iv)  `refuse_leave_request_over_leave()`, REPLACED: behind 0040's gates,
--         unchanged, a request that reaches a date on which its member is
--         inactive — a scheduled deactivation included — is refused with
--         55000 `LEAVE_REQUEST_MEMBER_INACTIVE`, before the overlap test.
--   (v)   `decide_leave_request(id, outcome)`, REPLACED: an APPROVAL of a
--         request reaching a date on which its member is inactive is refused
--         with 55000 `LEAVE_REQUEST_MEMBER_INACTIVE`, after the request is
--         found pending and before any leave is written; the whole call
--         aborts, so the request stays pending, to be rejected. A REJECTION
--         stays allowed. Reachable only by a request the trigger never saw (a
--         race the lock rules out for sessions, or an owner's write). The
--         outcome a session may name is still `approved` or `rejected`
--         (22023 otherwise): `deactivated` is the trigger's alone.
--   (vi)  THE BACKFILL: every request still pending with an inactive date in
--         its range is closed the same way, attributed to the `created_by` of
--         the earliest inactive version that reaches it.
--
-- THE REFUSALS ADDED, as SQLSTATEs the browser maps by message:
--
--   * an insert into `leave_requests`: 55000 `LEAVE_REQUEST_MEMBER_INACTIVE`;
--   * `decide_leave_request(id, 'approved')`: 55000
--     `LEAVE_REQUEST_MEMBER_INACTIVE`.
--
-- SECURITY DEFINER, the new trigger function as 0040's: an empty
-- `search_path` and every name qualified. EXECUTE on the trigger function and
-- the helper is nobody's; on `decide_leave_request` still `authenticated`'s
-- alone. No policy and no grant of any table changes.
--
-- No notification and no outbox (Epic 10).

-- --------------------------------------------------------- (i) the outcome

alter table public.leave_request_decisions
  drop constraint leave_request_decisions_outcome_known;

alter table public.leave_request_decisions
  add constraint leave_request_decisions_outcome_known
    check (outcome in ('approved', 'rejected', 'deactivated'));

-- ---------------------------------------------------- (ii) inactive in range

-- VOLATILE PL/pgSQL, as 0008's readers, so a caller that waited for the lock
-- reads the versions committed meanwhile. INVOKER: only the definers below
-- call it, as the owner.
create or replace function public.member_inactive_within(member uuid, within daterange) returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return not public.member_active_on(member, lower(within))
      or exists (
        select 1
          from public.member_status_versions v
         where v.member_id = member
           and not v.active
           and v.effective_from > lower(within)
           and v.effective_from < upper(within)
      );
end;
$$;

revoke execute on function public.member_inactive_within(uuid, daterange) from public;
revoke execute on function public.member_inactive_within(uuid, daterange) from anon;
revoke execute on function public.member_inactive_within(uuid, daterange) from authenticated;
revoke execute on function public.member_inactive_within(uuid, daterange) from service_role;

-- ------------------------------------------------- (iii) the close on deactivation

create or replace function public.close_leave_requests_on_deactivation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The close and its decision in one statement: each closed request gets
  -- exactly one `deactivated` decision, by the deactivating admin.
  --
  -- A request lying wholly after a LATER version of the member is not this
  -- version's to close: that later version (a reactivation) governs its
  -- dates. The policy path cannot produce one — a session appends versions
  -- in date order, so the deactivation is always the latest — but an owner
  -- write can, so the guard mirrors the backfill's.
  with closed as (
    update public.leave_requests r
       set closed_by = new.created_by,
           closed_at = now()
     where r.organization_id = new.organization_id
       and r.member_id = new.member_id
       and r.closed_at is null
       and upper(r.during) > new.effective_from
       and not exists (
         select 1
           from public.member_status_versions later
          where later.organization_id = new.organization_id
            and later.member_id = new.member_id
            and later.effective_from > new.effective_from
            and later.effective_from <= lower(r.during)
       )
    returning r.organization_id, r.id
  )
  insert into public.leave_request_decisions (organization_id, request_id, outcome, decided_by)
  select closed.organization_id, closed.id, 'deactivated', new.created_by
    from closed;

  return null;
end;
$$;

-- As 0023's trigger functions (0020): nothing calls it by hand, and Postgres
-- checks EXECUTE when the trigger is created, not when it fires.
revoke execute on function public.close_leave_requests_on_deactivation() from public;
revoke execute on function public.close_leave_requests_on_deactivation() from anon;
revoke execute on function public.close_leave_requests_on_deactivation() from authenticated;
revoke execute on function public.close_leave_requests_on_deactivation() from service_role;

drop trigger if exists member_status_versions_close_leave_requests on public.member_status_versions;
create trigger member_status_versions_close_leave_requests
  after insert on public.member_status_versions
  for each row
  when (not new.active)
  execute function public.close_leave_requests_on_deactivation();

-- ------------------------------------------- (iv) no request onto an inactive date

-- THE NAME IS KEPT, though since 0041 it also refuses a request reaching an
-- inactive date: `leave_requests_refuse_over_leave` (0040) is bound to it.
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
  -- its own member row is the policy's to refuse, with its own 42501: no leave
  -- and no status is read for them.
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

-- --------------------------------------------- (v) no approval onto an inactive date

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
  created_record uuid;
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
  returning r.member_id, r.during into requested_member, requested_during;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_REQUEST_NOT_PENDING';
  end if;

  if p_outcome = 'approved' then
    -- 0041: never leave for a member on a date they are inactive. The raise
    -- aborts the call, and the close above with it: the request stays
    -- pending, to be rejected.
    if public.member_inactive_within(requested_member, requested_during) then
      raise exception using
        errcode = 'object_not_in_prerequisite_state',
        message = 'LEAVE_REQUEST_MEMBER_INACTIVE';
    end if;

    -- `created_by` and `created_at` come from 0028's defaults: the approving
    -- admin, now. 0028's exclusion refuses it when live leave sharing a date
    -- was recorded since the request; the refusal is named and aborts the
    -- call, and the close above with it.
    begin
      insert into public.leave_records (organization_id, member_id, during)
      values (claimed, requested_member, requested_during)
      returning id into created_record;
    exception
      when exclusion_violation then
        raise exception using
          errcode = 'exclusion_violation',
          message = 'LEAVE_REQUEST_APPROVAL_OVERLAPS_LEAVE';
    end;
  end if;

  -- `decided_by` and `decided_at` from their defaults: the caller, now.
  insert into public.leave_request_decisions (organization_id, request_id, outcome, leave_record_id)
  values (claimed, p_request_id, p_outcome, created_record);

  return created_record;
end;
$$;

revoke execute on function public.decide_leave_request(uuid, text) from public;
revoke execute on function public.decide_leave_request(uuid, text) from anon;
revoke execute on function public.decide_leave_request(uuid, text) from service_role;
grant execute on function public.decide_leave_request(uuid, text) to authenticated;

-- ------------------------------------------------------------- (vi) the backfill

-- Every pending request with an inactive date in its range, closed as the
-- trigger closes one, attributed to the earliest inactive version reaching it:
-- an inactive version dated before the range's end whose inactive stretch
-- (until the member's next version) reaches the range's start. One statement,
-- so each closed request gets exactly one decision.
with stranded as (
  select distinct on (r.id) r.organization_id, r.id, v.created_by
    from public.leave_requests r
    join public.member_status_versions v
      on v.organization_id = r.organization_id
     and v.member_id = r.member_id
     and not v.active
     and v.effective_from < upper(r.during)
   where r.closed_at is null
     and not exists (
       select 1
         from public.member_status_versions later
        where later.organization_id = v.organization_id
          and later.member_id = v.member_id
          and later.effective_from > v.effective_from
          and later.effective_from <= lower(r.during)
     )
   order by r.id, v.effective_from
), closed as (
  update public.leave_requests r
     set closed_by = stranded.created_by,
         closed_at = now()
    from stranded
   where r.id = stranded.id
     and r.closed_at is null
  returning r.organization_id, r.id, stranded.created_by
)
insert into public.leave_request_decisions (organization_id, request_id, outcome, decided_by)
select closed.organization_id, closed.id, 'deactivated', closed.created_by
  from closed;
