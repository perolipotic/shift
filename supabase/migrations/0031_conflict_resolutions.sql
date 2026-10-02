-- 0031_conflict_resolutions.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 5.4a: a recorded resolution takes its conflict off every unresolved
-- surface.
--
-- CONFLICTS ARE DERIVED; ONLY RESOLUTIONS ARE STORED (AD-4). A conflict is a
-- collision `packages/domain` derives on read (`collisionsOf`), never a row:
-- no table here holds a collision, and no routine here derives one. What is
-- stored is the DECISION on one, keyed by the same `(organization_id,
-- member_id, date, team_id)` that `collisionKeyOf` produces. `team_id` is part
-- of the key because a roster override can put one member on two teams'
-- shifts on one date, and those are two conflicts. A resolution is NEVER keyed
-- on a leave record: an amend replaces the record (0029), and the decision on
-- a date that stays on leave must survive it.
--
--   * THE KIND is one of three: `accept_uncovered`, `replace_member` or
--     `amend_leave`. ("Uncovered" alone already means hour-band coverage in
--     the code, so the kind says what is accepted.) What each kind does to the
--     schedule, the hours or the leave is stories 5.4b–d's; this file stores
--     the decision and nothing it causes.
--   * ONE LIVE RESOLUTION PER KEY: the partial unique index below refuses a
--     second with 23505. A soft-removed row leaves the key.
--   * ATTRIBUTED (AD-11): `created_by` and `created_at` come from defaults the
--     client cannot forge, and the insert policy pins `created_by` as well.
--   * SOFT-REMOVED, by the lifetime rule below only: `removed_by` and
--     `removed_at`, both null or both set. No session holds an update or a
--     delete.
--
-- THE LIFETIME RULE (human, 2026-10-02). A resolution lives while a live
-- leave record of its member covers its date. Both leave writes that can end
-- that cover are 0029's definer calls, re-created below with their bodies and
-- refusals unchanged, and each soft-removes the resolutions it uncovers in the
-- same transaction, attributed to the acting admin:
--
--   * `remove_leave_record` soft-removes the member's live resolutions dated
--     in the removed range;
--   * `amend_leave_record` soft-removes only those dated in the old range and
--     not in the new one. A resolution on a date that stays covered survives,
--     unchanged.
--
-- One live leave record of a member covers a date at most once (0028's
-- exclusion), so "dated in the removed range" is exact. Nothing else removes
-- a resolution: not time, and no other data change. So a resolution never
-- lingers to hide a later conflict from new leave, and an amend never reopens
-- a decision whose date stays on leave.
--
-- AND IT IS BORN ON LEAVE. The trigger below refuses an insert unless a live
-- leave record of the same organization and member covers its date — a
-- resolution recorded off leave would never be ended, and would hide a
-- conflict from leave recorded later. It takes a share lock on that leave
-- row, so an insert and a concurrent `remove_leave_record` or
-- `amend_leave_record` serialise: whichever waits sees the other's commit.
-- The removal or amend that waited for the insert soft-removes the new row
-- with the rest; the insert that waited for the removal re-reads the row,
-- finds it removed, and is refused.
--
-- WHO READS WHAT: an ACTIVE ADMIN of the token's organization inserts and
-- reads that organization's rows. A member reads their own live rows through
-- `my_conflict_resolutions()` alone, shaped `member_id, date, team_id, kind`:
-- no author and no removal, as 0030's read.
--
-- A refused insert arrives as one of:
--
--   * 23505 — the live key: a live resolution of that key exists;
--   * 42501 — the policy or the privilege: not an active admin of the claimed
--     organization, a forged `created_by`, an update or a delete;
--   * 23503 — a composite key: another tenant's member or team;
--   * 23514 — a check: an unknown kind, a non-finite or out-of-range date, or
--     a half-recorded removal;
--   * P0002 (`no_data_found`, `CONFLICT_RESOLUTION_NOT_ON_LEAVE`) — the
--     trigger: no live leave record of the member covers the date. Only an
--     active admin inserting into the token's own organization (or the owner,
--     with no session at all) reaches that check; every other caller passes
--     through to the policy's 42501, so nobody learns of anyone's leave from
--     a refusal.
--
-- One trigger, that one.

create table conflict_resolutions (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  -- The key of the conflict: `collisionKeyOf`'s `(memberId, date, teamId)`.
  member_id uuid not null,
  date date not null,
  team_id uuid not null,

  kind text not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the insert policy pins `created_by` as
  -- well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- The removal, set together or not at all, by the lifetime rule's two
  -- definer functions below only.
  removed_by uuid,
  removed_at timestamptz,

  -- To 0002's unique (organization_id, id), so a resolution naming another
  -- tenant's member is unrepresentable. NO cascade: a member a resolution
  -- names is not deleted from under it.
  constraint conflict_resolutions_member_fkey
    foreign key (organization_id, member_id)
    references members (organization_id, id),

  -- To 0009's unique (organization_id, id), the same way. NO cascade.
  constraint conflict_resolutions_team_fkey
    foreign key (organization_id, team_id)
    references teams (organization_id, id),

  -- Finite and in years 0001–9999, for the reason 0016 gives.
  constraint conflict_resolutions_date_finite
    check (isfinite(date) and date >= date '0001-01-01' and date < date '10000-01-01'),

  constraint conflict_resolutions_kind_known
    check (kind in ('accept_uncovered', 'replace_member', 'amend_leave')),

  constraint conflict_resolutions_removal_complete
    check ((removed_by is null) = (removed_at is null))
);

alter table conflict_resolutions enable row level security;

-- Q3: every policy below filters by the tenant first.
create index conflict_resolutions_organization_id_idx on conflict_resolutions (organization_id);

-- ONE LIVE RESOLUTION PER CONFLICT. A removed resolution leaves the key. The
-- lifetime rule's updates find one member's rows by date through it, too.
create unique index conflict_resolutions_live_key
  on conflict_resolutions (organization_id, member_id, date, team_id)
  where removed_at is null;

-- ------------------------------------------------------------------ the policies

-- Only an active admin of the token's organization reads the table: it carries
-- `created_by` and `removed_by`, auth user ids that no member-role session is
-- shown. A member reads their own live rows through the function below.
create policy conflict_resolutions_select_own_active_admin on public.conflict_resolutions
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- The only way a resolution is written. Every rule is one conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an active admin;
--   * the attribution, pinned to the caller.
--
-- That the member and the team are of the same organization is the composite
-- keys' rule, not this one's (23503).
create policy conflict_resolutions_insert_by_own_active_admin on public.conflict_resolutions
  for insert
  to authenticated
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
    and created_by = (select auth.uid())
  );

-- ------------------------------------------------------- the writable columns

-- As 0028: a session names the five facts of a resolution on insert and
-- nothing else; `id`, `created_by` and `created_at` come from their defaults
-- (AD-11), and `removed_by` and `removed_at` stay null. No update and no
-- delete: there is no policy for either, and the privilege is the second lock.
-- `anon` reads and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.conflict_resolutions
  from anon, authenticated;
revoke select on table public.conflict_resolutions from anon;

grant insert (organization_id, member_id, date, team_id, kind) on table public.conflict_resolutions
  to authenticated;

-- ------------------------------------------------------- born on live leave

create function public.refuse_conflict_resolution_off_leave() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
begin
  -- A session that is not an active admin of the claimed organization, or
  -- writes into another one, is the insert policy's to refuse (42501): no
  -- leave is read for it.
  if (select auth.uid()) is not null and (
    claimed is null
    or new.organization_id is distinct from claimed
    or not exists (
      select 1
        from public.current_member_access() as access
       where access.organization_id = claimed
         and access.is_active
         and access.member_role = 'admin'
    )
  ) then
    return new;
  end if;

  -- The share lock serialises against 0029's soft-remove of the same row:
  -- after a wait, the re-check reads `removed_at` as committed.
  perform 1
     from public.leave_records r
    where r.organization_id = new.organization_id
      and r.member_id = new.member_id
      and r.removed_at is null
      and new.date <@ r.during
      for share;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'CONFLICT_RESOLUTION_NOT_ON_LEAVE';
  end if;

  return new;
end;
$$;

-- As 0023's trigger functions (0020): nothing calls it by hand, and Postgres
-- checks EXECUTE when the trigger is created, not when it fires.
revoke execute on function public.refuse_conflict_resolution_off_leave() from public;
revoke execute on function public.refuse_conflict_resolution_off_leave() from anon;
revoke execute on function public.refuse_conflict_resolution_off_leave() from authenticated;
revoke execute on function public.refuse_conflict_resolution_off_leave() from service_role;

create trigger conflict_resolutions_on_live_leave
  before insert on public.conflict_resolutions
  for each row
  execute function public.refuse_conflict_resolution_off_leave();

-- ---------------------------------------------------------- the member's read

-- Shaped and pinned as 0030's `my_leave_records()`: the caller's own LIVE
-- resolutions, `member_id, date, team_id, kind`, and nothing else. No author,
-- no removal, no other member's row and no other organization's. Zero rows
-- unless the caller is active and the token's organization is the caller's
-- own.
create function public.my_conflict_resolutions()
returns table (
  member_id uuid,
  date date,
  team_id uuid,
  kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.member_id,
         c.date,
         c.team_id,
         c.kind
    from public.conflict_resolutions c
    join public.members m
      on m.organization_id = c.organization_id
     and m.id = c.member_id
   where c.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and c.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and m.auth_user_id = (select auth.uid())
     and c.removed_at is null
   order by c.date, c.team_id
$$;

-- The same explicit grants 0030 writes: Supabase's default privileges grant
-- EXECUTE to `anon`, `authenticated` and `service_role` individually. Only a
-- signed-in session calls this.
revoke execute on function public.my_conflict_resolutions() from public;
revoke execute on function public.my_conflict_resolutions() from anon;
revoke execute on function public.my_conflict_resolutions() from service_role;
grant execute on function public.my_conflict_resolutions() to authenticated;

-- ------------------------------------------- the lifetime rule: the removal

-- 0029's body and refusals, unchanged, plus the soft-removal of the member's
-- live resolutions dated in the removed range. `create or replace` keeps
-- 0029's grants.
create or replace function public.remove_leave_record(p_record_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  removed_member uuid;
  removed_during daterange;
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
     and r.removed_at is null
  returning r.member_id, r.during into removed_member, removed_during;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_RECORD_NOT_LIVE';
  end if;

  -- The lifetime rule: no live leave covers these dates any more.
  update public.conflict_resolutions c
     set removed_by = auth.uid(),
         removed_at = now()
   where c.organization_id = claimed
     and c.member_id = removed_member
     and c.removed_at is null
     and c.date <@ removed_during;
end;
$$;

-- --------------------------------------------- the lifetime rule: the amend

-- 0029's body and refusals, unchanged, plus the soft-removal of the member's
-- live resolutions dated in the old range and not in the new one. It runs
-- after the replacement insert, so a refused insert aborts the call before
-- any resolution is touched, and the whole call is one transaction.
create or replace function public.amend_leave_record(p_record_id uuid, p_from date, p_to date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  amended_member uuid;
  amended_during daterange;
  replacement uuid;
  replacement_during daterange;
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
  returning r.member_id, r.during into amended_member, amended_during;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_RECORD_NOT_LIVE';
  end if;

  -- `created_by` and `created_at` come from 0028's defaults: the caller, now.
  -- Any refusal here aborts the call, and the removal above with it.
  insert into public.leave_records (organization_id, member_id, during)
  values (claimed, amended_member, pg_catalog.daterange(p_from, p_to, '[]'))
  returning id, during into replacement, replacement_during;

  -- The lifetime rule: the dates the old range covered and the new one does
  -- not. A date that stays covered keeps its resolution.
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
