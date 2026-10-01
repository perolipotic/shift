-- 0028_leave_records.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 5.1b: a leave record is stored, overlap is refused by the database,
-- and the schedule is untouched.
--
-- One table. `leave_records` records that ONE MEMBER is on annual leave over
-- ONE INCLUSIVE RANGE OF CALENDAR DATES, entered by an admin (R4.1). It is
-- read beside the schedule, never written into it: nothing here writes, reads
-- or refers to a rotation, membership, status or override row, so those are
-- byte-identical before and after a leave record is saved (DI-3).
--
--   * THE RANGE is a `daterange`, inclusive at its lower bound (Postgres keeps
--     every date range canonical as `[from, to + 1)`), bounded at both ends,
--     never empty, inside years 0001–9999, and at most 366 days long — the
--     cap `MAX_LEAVE_RANGE_DAYS` in `packages/domain` holds a range to.
--   * NO OVERLAP (R4.4, AD-3). Two LIVE records of one member never share a
--     date: the exclusion constraint below refuses the second with 23P01, so
--     no date is ever charged twice. A soft-removed record leaves the key, and
--     ranges that only touch (one ends 09.09, the next begins 10.09) share no
--     date and both stand.
--   * NO BALANCE CHECK (R4.7). What a record costs and whether it exceeds the
--     member's balance is `packages/domain`'s question alone (AD-7); an
--     over-balance record saves here, and the interface warns.
--   * ATTRIBUTED (AD-11): `created_by` and `created_at` come from defaults the
--     client cannot forge, and the insert policy pins `created_by` as well.
--   * SOFT-REMOVED. `removed_by` and `removed_at` exist now, both null or both
--     set, but no session sets them: there is no update or delete grant. How a
--     removal is attributed is story 5.2's, as 0027 was 3.6b's.
--
-- WHO READS WHAT: an ACTIVE ADMIN of the token's organization inserts and
-- reads that organization's records; an active member-role account reads only
-- the records of its own member row (0011's own-row pattern) and inserts none.
--
-- Every rule is a WITH CHECK clause, a key, a check, an exclusion or a grant,
-- so a refused insert arrives as one of:
--
--   * 23P01 — the exclusion: a live record of the same member shares a date;
--   * 42501 — the policy or the privilege: not an active admin of the claimed
--     organization, a forged `created_by`, an update or a delete;
--   * 23503 — the composite key: another tenant's member;
--   * 23514 — a check: an empty, unbounded or over-366-day range, a bound
--     outside years 0001–9999, or a half-recorded removal;
--   * 22000 — a reversed range (`to` before `from`), and 22008 — an
--     `infinity` or `-infinity` bound. Postgres refuses both while building
--     and canonicalizing the range value, before any check is evaluated.
--
-- No trigger and no function.

create table leave_records (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  member_id uuid not null,

  -- The leave itself: civil dates, never instants, both ends included.
  during daterange not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the insert policy pins `created_by` as
  -- well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- The removal, set together or not at all. No session holds a privilege on
  -- either; story 5.2 decides how they are written.
  removed_by uuid,
  removed_at timestamptz,

  -- To 0002's unique (organization_id, id), so a record naming another
  -- tenant's member is unrepresentable. NO cascade: a member a live or removed
  -- leave record names is not deleted from under it.
  constraint leave_records_member_fkey
    foreign key (organization_id, member_id)
    references members (organization_id, id),

  -- Each property of the range is its own check, so each holds on its own: a
  -- bound function answers null on an empty or unbounded range, and a check
  -- that is null passes.
  constraint leave_records_during_non_empty
    check (not isempty(during)),

  constraint leave_records_during_bounded
    check (not lower_inf(during) and not upper_inf(during)),

  constraint leave_records_during_lower_inclusive
    check (lower_inc(during)),

  -- In years 0001–9999, for the reason 0016 gives. The upper bound is
  -- exclusive, so the last date a record may include is 9999-12-31. An
  -- `infinity` bound never reaches this check: canonicalizing the range
  -- refuses it first (22008).
  constraint leave_records_during_in_years
    check (lower(during) >= date '0001-01-01' and upper(during) <= date '10000-01-01'),

  -- At most 366 dates, both ends included: `upper - lower` of a canonical
  -- range is its count of dates. `MAX_LEAVE_RANGE_DAYS` in `packages/domain`.
  constraint leave_records_during_at_most_366_days
    check (upper(during) - lower(during) <= 366),

  constraint leave_records_removal_complete
    check ((removed_by is null) = (removed_at is null)),

  -- R4.4: no two live records of one member share a date. `btree_gist` (0001)
  -- lets the uuid take part in a gist exclusion beside the range.
  constraint leave_records_no_overlap
    exclude using gist (member_id with =, during with &&)
    where (removed_at is null)
);

alter table leave_records enable row level security;

-- Q3: every policy below filters by the tenant first.
create index leave_records_organization_id_idx on leave_records (organization_id);

-- One member's records: the member's own read, the overlap read-back and the
-- balance (story 5.1c) all ask for them by organization and member.
create index leave_records_organization_member_idx on leave_records (organization_id, member_id);

-- ------------------------------------------------------------------ the policies

-- An active admin of the token's organization reads all of its records; an
-- active member-role account reads the records of its own member row and no
-- colleague's. The member is matched through `members`, whose own select
-- policy (0011) shows a member-role session its own row alone.
create policy leave_records_select_own_organization on public.leave_records
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
         where member.organization_id = leave_records.organization_id
           and member.id = leave_records.member_id
           and member.auth_user_id = (select auth.uid())
      )
    )
  );

-- The only way a leave record is written. Every rule is one conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an active admin;
--   * the attribution, pinned to the caller.
--
-- That the member is of the same organization is the composite key's rule,
-- not this one's, so another tenant's member — which this session cannot see —
-- passes here and is refused by the key (23503).
create policy leave_records_insert_by_own_active_admin on public.leave_records
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

-- As 0026: Supabase's default privileges grant every table privilege to `anon`
-- and `authenticated`. A session names the three facts of a leave record on
-- insert and nothing else; `id`, `created_by` and `created_at` come from their
-- defaults (AD-11), and `removed_by` and `removed_at` stay null. No update and
-- no delete: there is no policy for either, and the privilege is the second
-- lock. `anon` reads and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.leave_records
  from anon, authenticated;
revoke select on table public.leave_records from anon;

grant insert (organization_id, member_id, during) on table public.leave_records
  to authenticated;
