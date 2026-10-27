-- 0040_leave_requests.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 9.2: the leave request record.
--
-- Until now only an admin entered leave (0028). A LEAVE REQUEST is a leave
-- record a member has asked for and nobody has asserted yet: ONE MEMBER, ONE
-- INCLUSIVE RANGE OF CALENDAR DATES, inserted by that member themself. It
-- derives nothing. A pending request is no leave record, so it charges no
-- balance, raises no collision and moves no shift: `leave_records`,
-- `my_leave_records()` and `leave_overview_records()` do not read this table,
-- and nothing here writes a schedule row. These are the product's first
-- member-role domain writes (AD-10's amendment).
--
-- Two tables and two definers:
--
--   * `leave_requests`, shaped as 0028's `leave_records`: the tenant first, a
--     composite key to `members`, the same five checks on `during`, AD-11's
--     `created_by` and `created_at`, and `on delete cascade` from the
--     organization alone. `closed_by` and `closed_at` are set together or not
--     at all, and only by the two definers below.
--   * `leave_request_decisions`: one approve or reject per request, keyed by
--     the request, attributed by `decided_by default auth.uid()` and
--     `decided_at default now()`. No session holds a write on it.
--   * `withdraw_leave_request(uuid)`: the member closes their own pending
--     request, with no decision.
--   * `decide_leave_request(uuid, text)`: an active admin approves (the leave
--     record, the decision and the close in ONE transaction) or rejects (the
--     decision and the close).
--
-- STATUS IS DERIVED, NEVER STORED TWICE. Pending is `closed_at is null`. A
-- closed request with a decision row is approved or rejected, as the
-- decision's `outcome` says. A closed request with no decision is withdrawn.
-- Only the two definers close a request, and each closes it in the same
-- transaction as its own write, so the two tables cannot disagree.
--
-- OVERLAP, TWO WAYS (R9.4, AD-3):
--
--   * two PENDING requests of one member never share a date: the exclusion
--     constraint `leave_requests_no_pending_overlap` refuses the second with
--     23P01, as 0028's refuses overlapping leave. A closed request leaves the
--     key, and ranges that only touch share no date.
--   * a request never shares a date with the member's LIVE LEAVE. That rule
--     crosses two tables, which no exclusion can span, so a BEFORE INSERT row
--     trigger, `refuse_leave_request_over_leave()`, refuses it with 23P01 and
--     the message `LEAVE_REQUEST_OVERLAPS_LEAVE` (human decision 2026-10-27,
--     AD-3's named exception). Its gates are 0036's archived-override
--     trigger's: it acts only for the `authenticated` role, and only when the
--     caller is an active account of the claimed organization inserting for
--     its own member row. Every other insert is left to the policy's 42501.
--   * NOT the other way round: an admin's direct leave record is never
--     refused because a pending request overlaps it (0028 is unchanged). The
--     approval of that request then aborts on 0028's exclusion (23P01), so no
--     date is ever charged twice.
--
-- THE LOCK. `leave_requests` takes 0023's statement trigger
-- `serialize_organization_writes()` on insert, update and delete, and both
-- definers take the same key inline before their first check, as 0036's
-- definers do. So an insert and a decision of the same organization do not
-- interleave: an insert that waited for an approval sees its new leave record
-- (the trigger's read is a fresh one), and a withdrawal and a decision of one
-- request are served one after the other, the second finding it closed.
-- `leave_records` takes no lock (0028 has no trigger), so a request and an
-- admin's leave insert that commit at the same moment can both stand: the
-- known race, accepted, because the approval aborts on 0028's exclusion.
--
-- WHO READS WHAT: an ACTIVE ADMIN of the token's organization reads all of its
-- requests and decisions; an active member-role account reads only its own
-- requests and their decisions. ANY active account, admin or member-role,
-- inserts a request only for its own member row (the self-owned row policy,
-- AD-10's amendment): the member is matched through `members.auth_user_id =
-- auth.uid()` in the claimed organization, the organization comes from the
-- claim and the active status from `current_member_access()`, never from the
-- request.
--
-- THE REFUSALS, as SQLSTATEs the browser maps:
--
--   An insert into `leave_requests`:
--   * 23P01 — the exclusion: a pending request of the same member shares a
--     date; or the trigger, message `LEAVE_REQUEST_OVERLAPS_LEAVE`: a live
--     leave record of the same member shares a date;
--   * 42501 — the policy or the privilege: not an active account of the
--     claimed organization, a member row other than the caller's own, a
--     forged `created_by`, a named `closed_by` or `closed_at`, an update or a
--     delete;
--   * 23503 — the composite key: another tenant's member (reached only past
--     the policy, which refuses a session first);
--   * 23514 — a check: an empty, unbounded or over-366-day range, a bound
--     outside years 0001–9999, or a half-recorded close;
--   * 22000 — a reversed range, and 22008 — an `infinity` bound, as 0028.
--
--   `withdraw_leave_request(id)`:
--   * 42501 `LEAVE_REQUEST_WITHDRAWAL_REFUSED` — the caller is not an active
--     account of the claimed organization;
--   * P0002 `LEAVE_REQUEST_NOT_PENDING` — no pending request of the caller's
--     own member row has that id in that organization: already closed, a
--     colleague's, another tenant's or never there, indistinguishably.
--
--   `decide_leave_request(id, outcome)`, returning the new leave record's id
--   on an approval and null on a rejection. An admin may decide their own
--   request:
--   * 42501 `LEAVE_REQUEST_DECISION_REFUSED` — the caller is not an active
--     admin of the claimed organization;
--   * 22023 `LEAVE_REQUEST_OUTCOME_UNKNOWN` — the outcome is neither
--     `approved` nor `rejected`;
--   * P0002 `LEAVE_REQUEST_NOT_PENDING` — no pending request with that id in
--     that organization: already decided, withdrawn, another tenant's or never
--     there;
--   * 23P01 `LEAVE_REQUEST_APPROVAL_OVERLAPS_LEAVE` — the approval's leave
--     insert is refused by 0028's exclusion, because live leave sharing a date
--     was recorded since the request (R9.4: a stale approval is refused). The
--     whole call aborts, so the close is rolled back with it and the request
--     stays pending, to be rejected.
--
-- AN APPROVAL ONLY ADDS LEAVE. It inserts one leave record and removes or
-- changes nothing, so it can add collisions and erase none: AD-5's erasure
-- diff does not apply to it.
--
--   `leave_request_decisions`: every session write is 42501, by privilege.
--
-- SECURITY DEFINER, both definers and the trigger, as 0036's: the claim, the
-- lock, an empty `search_path` and every name qualified. EXECUTE on the two
-- definers is `authenticated`'s alone; on the trigger function, nobody's.
--
-- No notification and no outbox (Epic 10). No reader in `apps` or `packages`
-- (stories 9.3–9.5 add those).

-- ------------------------------------------------------------------ the request

create table leave_requests (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  member_id uuid not null,

  -- The leave asked for: civil dates, never instants, both ends included.
  during daterange not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the insert policy pins `created_by` as
  -- well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- The close, set together or not at all, and only by the two definers. No
  -- session holds a privilege on either.
  closed_by uuid,
  closed_at timestamptz,

  -- The key `leave_request_decisions` refers to, so a decision naming another
  -- tenant's request is unrepresentable.
  constraint leave_requests_organization_id_id_key unique (organization_id, id),

  -- To 0002's unique (organization_id, id), so a request naming another
  -- tenant's member is unrepresentable. NO cascade, as 0028's.
  constraint leave_requests_member_fkey
    foreign key (organization_id, member_id)
    references members (organization_id, id),

  -- 0028's five checks on the range, each its own, for 0028's reasons.
  constraint leave_requests_during_non_empty
    check (not isempty(during)),

  constraint leave_requests_during_bounded
    check (not lower_inf(during) and not upper_inf(during)),

  constraint leave_requests_during_lower_inclusive
    check (lower_inc(during)),

  constraint leave_requests_during_in_years
    check (lower(during) >= date '0001-01-01' and upper(during) <= date '10000-01-01'),

  constraint leave_requests_during_at_most_366_days
    check (upper(during) - lower(during) <= 366),

  constraint leave_requests_close_complete
    check ((closed_by is null) = (closed_at is null)),

  -- R9.4: no two PENDING requests of one member share a date. `btree_gist`
  -- (0001) lets the uuid take part beside the range, as in 0028.
  constraint leave_requests_no_pending_overlap
    exclude using gist (member_id with =, during with &&)
    where (closed_at is null)
);

alter table leave_requests enable row level security;

-- Q3: every policy below filters by the tenant first.
create index leave_requests_organization_id_idx on leave_requests (organization_id);

-- One member's requests: the member's own read and the overlap trigger ask
-- for them by organization and member.
create index leave_requests_organization_member_idx on leave_requests (organization_id, member_id);

-- ----------------------------------------------------------------- the decision

-- 0028 gave `leave_records` no (organization_id, id) key. The decision's
-- composite key to the leave it created needs one; `id` is already the
-- primary key, so this admits and refuses exactly the rows it did before
-- (0032 added the same key to `roster_overrides`). No policy, grant or trigger
-- of `leave_records` changes.
alter table public.leave_records
  add constraint leave_records_organization_id_id_key unique (organization_id, id);

create table leave_request_decisions (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  -- The key, so a request is decided at most once.
  request_id uuid primary key,

  outcome text not null,

  -- The leave record an approval created; null exactly when rejected.
  leave_record_id uuid,

  -- AD-11, from defaults alone: no session writes this table, and the definer
  -- names neither column.
  decided_by uuid not null default auth.uid(),
  decided_at timestamptz not null default now(),

  constraint leave_request_decisions_request_fkey
    foreign key (organization_id, request_id)
    references leave_requests (organization_id, id),

  constraint leave_request_decisions_leave_record_fkey
    foreign key (organization_id, leave_record_id)
    references leave_records (organization_id, id),

  constraint leave_request_decisions_outcome_known
    check (outcome in ('approved', 'rejected')),

  constraint leave_request_decisions_leave_record_when_approved
    check ((outcome = 'approved') = (leave_record_id is not null)),

  -- One leave record backs at most one decision. A rejection's null is not
  -- equal to another's, so any number of rejections stand. It also indexes
  -- the key to `leave_records`.
  constraint leave_request_decisions_leave_record_key
    unique (organization_id, leave_record_id)
);

alter table leave_request_decisions enable row level security;

create index leave_request_decisions_organization_id_idx on leave_request_decisions (organization_id);

-- ------------------------------------------------------------------ the policies

-- 0028's read: an active admin of the token's organization reads all of its
-- requests; an active member-role account reads its own member row's alone.
create policy leave_requests_select_own_organization on public.leave_requests
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and (
      organization_id = (
        select access.organization_id
          from public.current_member_access() as access
         where access.is_active
           and access.member_role = 'admin'
      )
      or exists (
        select 1
          from public.members member
         where member.organization_id = leave_requests.organization_id
           and member.id = leave_requests.member_id
           and member.auth_user_id = (select auth.uid())
      )
    )
  );

-- The self-owned row (AD-10's amendment). Every rule is one conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an ACTIVE
--     account of any role;
--   * the member, the caller's own row in that organization, matched by
--     `auth_user_id`, never taken from the request;
--   * the attribution, pinned to the caller.
create policy leave_requests_insert_own_by_active_member on public.leave_requests
  for insert
  to authenticated
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and exists (
      select 1
        from public.members member
       where member.organization_id = leave_requests.organization_id
         and member.id = leave_requests.member_id
         and member.auth_user_id = (select auth.uid())
    )
    and created_by = (select auth.uid())
  );

-- The decisions follow their requests: an active admin reads the
-- organization's, an active member-role account those on its own requests.
create policy leave_request_decisions_select_own_organization on public.leave_request_decisions
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and (
      organization_id = (
        select access.organization_id
          from public.current_member_access() as access
         where access.is_active
           and access.member_role = 'admin'
      )
      or exists (
        select 1
          from public.leave_requests request
          join public.members member
            on member.organization_id = request.organization_id
           and member.id = request.member_id
         where request.organization_id = leave_request_decisions.organization_id
           and request.id = leave_request_decisions.request_id
           and member.auth_user_id = (select auth.uid())
      )
    )
  );

-- ------------------------------------------------------- the writable columns

-- As 0028: a session names the three facts of a request on insert and nothing
-- else. No update and no delete: the definers close a request. `anon` reads
-- and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.leave_requests
  from anon, authenticated;
revoke select on table public.leave_requests from anon;

grant insert (organization_id, member_id, during) on table public.leave_requests
  to authenticated;

-- A decision is read, and only `decide_leave_request` writes one.
revoke insert, update, delete, truncate, references, trigger on table public.leave_request_decisions
  from anon, authenticated;
revoke select on table public.leave_request_decisions from anon;

-- ------------------------------------------------------------------- the lock

-- 0023's statement lock, as 0035 attaches it. The definers' close is an
-- update, and takes the same key again (an advisory lock is re-entrant).
create trigger leave_requests_serialize_organization_writes
  before insert or update or delete on public.leave_requests
  for each statement
  execute function public.serialize_organization_writes();

-- -------------------------------------------------- no request over live leave

create function public.refuse_leave_request_over_leave() returns trigger
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
  -- is read for them.
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

-- As 0023's trigger functions (0020): nothing calls it by hand, and Postgres
-- checks EXECUTE when the trigger is created, not when it fires.
revoke execute on function public.refuse_leave_request_over_leave() from public;
revoke execute on function public.refuse_leave_request_over_leave() from anon;
revoke execute on function public.refuse_leave_request_over_leave() from authenticated;
revoke execute on function public.refuse_leave_request_over_leave() from service_role;

create trigger leave_requests_refuse_over_leave
  before insert on public.leave_requests
  for each row
  execute function public.refuse_leave_request_over_leave();

-- -------------------------------------------------------------- the withdrawal

create function public.withdraw_leave_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
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
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'LEAVE_REQUEST_WITHDRAWAL_REFUSED';
  end if;

  -- The caller's own pending request alone, its member matched as the insert
  -- policy matches it.
  update public.leave_requests r
     set closed_by = auth.uid(),
         closed_at = now()
   where r.id = p_request_id
     and r.organization_id = claimed
     and r.closed_at is null
     and exists (
       select 1
         from public.members member
        where member.organization_id = claimed
          and member.id = r.member_id
          and member.auth_user_id = auth.uid()
     );

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_REQUEST_NOT_PENDING';
  end if;
end;
$$;

-- 0029's explicit grants.
revoke execute on function public.withdraw_leave_request(uuid) from public;
revoke execute on function public.withdraw_leave_request(uuid) from anon;
revoke execute on function public.withdraw_leave_request(uuid) from service_role;
grant execute on function public.withdraw_leave_request(uuid) to authenticated;

-- ---------------------------------------------------------------- the decision

create function public.decide_leave_request(p_request_id uuid, p_outcome text)
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
