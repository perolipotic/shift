-- 0055_leave_allowances.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 13.3: the allowance is set per leave year.
--
-- One table. `leave_allowances` holds the VERSIONS of a member's leave
-- allowance, each for ONE LEAVE YEAR. `members.leave_allowance_days` stays as
-- the member's STARTING allowance: it covers every leave year until a version
-- sets another, so member creation stays one insert and nothing is backfilled.
--
--   * VERSIONED, APPEND-ONLY (AD-2, amended for 13.3). A version is never
--     changed and never deleted: a same-year correction is a new row with a
--     higher `id`. No session holds an update or delete privilege, and there
--     is no policy for either.
--   * THE LEAVE YEAR is named by the calendar year in which it begins
--     (`leave_year`, 1–9999). Which leave year a date falls in, and which
--     version applies to a leave year, is `packages/domain/leave`'s question
--     alone (AD-7): the version for the year with the highest `id`, otherwise
--     the highest-`id` version of the latest year before it, otherwise the
--     starting allowance. No leave-year arithmetic is done here.
--   * ATTRIBUTED (AD-11): `created_by` and `created_at` come from defaults the
--     client cannot forge, and the insert policy pins `created_by` as well.
--   * The app writes no version yet (13.3b), so every balance reads as before.
--
-- WHO READS WHAT: an ACTIVE ADMIN of the token's organization inserts and
-- reads that organization's versions; an active member-role account reads
-- only the versions of its own member row (0028's own-row pattern) and inserts
-- none. `anon` holds nothing.
--
-- A refused write arrives as one of:
--
--   * 42501 — the policy or the privilege: not an active admin of the claimed
--     organization, a forged `created_by`, a column the grant does not admit,
--     an update or a delete;
--   * 23503 — the composite key: another tenant's member;
--   * 23514 — a check: a leave year outside 1–9999 or a negative allowance.
--
-- No trigger, no function and no backfill.

create table leave_allowances (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  -- Orders the versions of one year: the highest wins. Never named by a
  -- session (`generated always`, and no grant).
  id bigint generated always as identity primary key,

  member_id uuid not null,

  -- The calendar year in which the leave year begins.
  leave_year smallint not null,

  -- The allowance for that leave year, in whole days.
  days smallint not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the insert policy pins `created_by` as
  -- well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- To 0002's unique (organization_id, id), so a version naming another
  -- tenant's member is unrepresentable. NO cascade: a member a version names
  -- is not deleted from under it.
  constraint leave_allowances_member_fkey
    foreign key (organization_id, member_id)
    references members (organization_id, id),

  constraint leave_allowances_leave_year_range
    check (leave_year between 1 and 9999),

  constraint leave_allowances_days_non_negative
    check (days >= 0)
);

alter table leave_allowances enable row level security;

-- Q3: every policy below filters by the tenant first, and every read asks
-- for one member's versions, or the organization's.
create index leave_allowances_organization_member_idx on leave_allowances (organization_id, member_id);

-- ------------------------------------------------------------------ the policies

-- An active admin of the token's organization reads all of its versions; an
-- active member-role account reads the versions of its own member row and no
-- colleague's. The member is matched through `members`, whose own select
-- policy (0011) shows a member-role session its own row alone.
create policy leave_allowances_select_own_organization on public.leave_allowances
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
         where member.organization_id = leave_allowances.organization_id
           and member.id = leave_allowances.member_id
           and member.auth_user_id = (select auth.uid())
      )
    )
  );

-- The only way a version is written. Every rule is one conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an active admin;
--   * the attribution, pinned to the caller.
--
-- That the member is of the same organization is the composite key's rule,
-- not this one's (23503).
create policy leave_allowances_insert_by_own_active_admin on public.leave_allowances
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

-- As 0028: Supabase's default privileges grant every table privilege to `anon`
-- and `authenticated`. A session names the four facts of a version on insert
-- and nothing else; `id`, `created_by` and `created_at` come from their
-- defaults (AD-11). No update and no delete: a version is never changed
-- (AD-2). There is no policy for either, and the privilege is the second lock.
-- `anon` reads and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.leave_allowances
  from anon, authenticated;
revoke select on table public.leave_allowances from anon;

grant insert (organization_id, member_id, leave_year, days) on table public.leave_allowances
  to authenticated;
