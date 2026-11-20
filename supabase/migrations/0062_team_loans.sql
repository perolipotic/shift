-- 0062_team_loans.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 18.2: a loan is a recorded exception (FR-88, AD-2, AD-3, AD-11).
--
-- One table. `team_loans` records that ONE MEMBER works with ONE OTHER TEAM of
-- the same organization over ONE INCLUSIVE RANGE OF CALENDAR DATES (R11). It
-- is an EXCEPTION, date-ranged like a leave record, never versioned (AD-2). It
-- is read beside the schedule, never written into it: nothing here writes a
-- rotation, membership, status or override row, so those are byte-identical
-- before and after a loan is saved (R11.5). Which team a member is on, on a
-- date, is `packages/domain`'s question alone (`effectiveTeamOn`, AD-7).
--
--   * THE RANGE is a `daterange`, inclusive at its lower bound (Postgres keeps
--     every date range canonical as `[from, to + 1)`), bounded at both ends,
--     never empty and inside years 0001–9999. No length cap: a loan "for a
--     while" has no stated limit, unlike leave's 366 days.
--   * NO OVERLAP (R11.3, AD-3). Two LIVE loans of one member never share a
--     date: the exclusion constraint below refuses the second with 23P01. A
--     soft-removed loan leaves the key. Ending a loan early is story 18.4's
--     amend: the old row is removed and a shorter replacement inserted, so the
--     past dates stay covered.
--   * NOT TO THE HOME TEAM, NOT TO AN ARCHIVED TEAM (FR-88). Both are
--     conjuncts of the insert policy, decided on the statement's snapshot. A
--     team move written after the loan can still make it point home; the
--     domain derives such a date as the home team (R11.3). A team archived
--     concurrently is a residual race, as for leave records.
--   * A REASON, 1–200 code points after 0036's code-point trim, because FR-88
--     records it.
--   * ATTRIBUTED (AD-11): `created_by` and `created_at` come from defaults the
--     client cannot forge, and the insert policy pins `created_by` as well.
--   * SOFT-REMOVED. `removed_by` and `removed_at` exist now, both null or both
--     set, but no session sets them: there is no update or delete grant. How a
--     removal is attributed is story 18.4's.
--   * AUDITED (AD-3, AD-11): the two change-history triggers, attached here.
--
-- WHO READS WHAT: only an ACTIVE ADMIN of the token's organization inserts and
-- reads the table: it holds the reason (admin-only, FR-92) and `created_by` and
-- `removed_by`, auth user ids. Every active member reads the LIVE loans of the
-- organization, without reason or author, through `calendar_team_loans()`:
-- R11.2 needs every member's loans to derive any roster a member is shown.
--
-- Every rule is a WITH CHECK clause, a key, a check, an exclusion or a grant,
-- so a refused insert arrives as one of:
--
--   * 23P01 — the exclusion: a live loan of the same member shares a date;
--   * 42501 — the policy or the privilege: not an active admin of the claimed
--     organization, a forged `created_by`, a loan to an archived team or to
--     the member's team on a covered date, an update or a delete;
--   * 23503 — a composite key: another tenant's member or team;
--   * 23514 — a check: an empty or unbounded range, a bound outside years
--     0001–9999, a blank or over-200 reason, or a half-recorded removal;
--   * 22000 — a reversed range (`to` before `from`), and 22008 — an
--     `infinity` or `-infinity` bound. Postgres refuses both while building
--     and canonicalizing the range value, before any check is evaluated.
--
-- No trigger but AD-3's two audit triggers, and one definer read.

create table team_loans (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  -- The member lent.
  member_id uuid not null,

  -- The team the member works with over the range (the loan team).
  team_id uuid not null,

  -- The loan itself: civil dates, never instants, both ends included.
  during daterange not null,

  -- Why. Shown to admins only (FR-92).
  reason text not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the insert policy pins `created_by` as
  -- well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- The removal, set together or not at all. No session holds a privilege on
  -- either; story 18.4 decides how they are written.
  removed_by uuid,
  removed_at timestamptz,

  -- To 0002's unique (organization_id, id), so a loan naming another tenant's
  -- member is unrepresentable. NO cascade: a member a loan names is not
  -- deleted from under it.
  constraint team_loans_member_fkey
    foreign key (organization_id, member_id)
    references members (organization_id, id),

  -- To 0009's unique (organization_id, id), so a loan naming another tenant's
  -- team is unrepresentable. NO cascade: teams are never deleted, and the
  -- record must outlive what it changed.
  constraint team_loans_team_fkey
    foreign key (organization_id, team_id)
    references teams (organization_id, id),

  -- Each property of the range is its own check, so each holds on its own: a
  -- bound function answers null on an empty or unbounded range, and a check
  -- that is null passes.
  constraint team_loans_during_non_empty
    check (not isempty(during)),

  constraint team_loans_during_bounded
    check (not lower_inf(during) and not upper_inf(during)),

  constraint team_loans_during_lower_inclusive
    check (lower_inc(during)),

  -- In years 0001–9999, for the reason 0016 gives. The upper bound is
  -- exclusive, so the last date a loan may include is 9999-12-31. An
  -- `infinity` bound never reaches this check: canonicalizing the range
  -- refuses it first (22008).
  constraint team_loans_during_in_years
    check (lower(during) >= date '0001-01-01' and upper(during) <= date '10000-01-01'),

  -- 0036's trim, by code point and not by collation.
  constraint team_loans_reason_length
    check (
      char_length(
        pg_catalog.btrim(
          reason,
          U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
        )
      ) between 1 and 200
    ),

  constraint team_loans_removal_complete
    check ((removed_by is null) = (removed_at is null)),

  -- R11.3: no two live loans of one member share a date. `btree_gist` (0001)
  -- lets the uuid take part in a gist exclusion beside the range.
  constraint team_loans_no_overlap
    exclude using gist (member_id with =, during with &&)
    where (removed_at is null)
);

alter table team_loans enable row level security;

-- Q3: every policy below filters by the tenant first.
create index team_loans_organization_id_idx on team_loans (organization_id);

-- One member's loans: the overlap read-back and the member detail ask for
-- them by organization and member.
create index team_loans_organization_member_idx on team_loans (organization_id, member_id);

-- ------------------------------------------------------------------ the policies

-- Only an active admin of the token's organization reads the table: it holds
-- the reason and auth user ids that no member-role session is shown. Every
-- member reads the live loans through the function below.
create policy team_loans_select_by_own_active_admin on public.team_loans
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

-- The only way a loan is written. Every rule is one conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an active admin;
--   * the attribution, pinned to the caller;
--   * a loan team that is NOT ARCHIVED;
--   * a loan team that is NOT THE MEMBER'S TEAM ON ANY COVERED DATE. A
--     membership version `v` of the member to the loan team is in effect on
--     some date of `[lower, upper)` iff `v` starts before `upper` and no LATER
--     version (any one starting after `v`) starts on or before `lower`. Two
--     versions of one member never share a date (0010's key
--     `team_membership_versions_member_id_effective_from_key`), so "later" is
--     strict and unambiguous. The admin reads every version of the
--     organization (0010).
--
-- That the member and the team are of the same organization is the composite
-- keys' rule, not this one's, so another tenant's member or team — which this
-- session cannot see — passes here and is refused by the key (23503).
create policy team_loans_insert_by_own_active_admin on public.team_loans
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
    and not exists (
      select 1
        from public.teams team
       where team.organization_id = team_loans.organization_id
         and team.id = team_loans.team_id
         and team.archived
    )
    and not exists (
      select 1
        from public.team_membership_versions version
       where version.organization_id = team_loans.organization_id
         and version.member_id = team_loans.member_id
         and version.team_id = team_loans.team_id
         and version.effective_from < upper(team_loans.during)
         and not exists (
           select 1
             from public.team_membership_versions later
            where later.organization_id = version.organization_id
              and later.member_id = version.member_id
              and later.effective_from > version.effective_from
              and later.effective_from <= lower(team_loans.during)
         )
    )
  );

-- ------------------------------------------------------- the writable columns

-- As 0028: Supabase's default privileges grant every table privilege to `anon`
-- and `authenticated`. A session names the five facts of a loan on insert and
-- nothing else; `id`, `created_by` and `created_at` come from their defaults
-- (AD-11), and `removed_by` and `removed_at` stay null. No update and no
-- delete: there is no policy for either, and the privilege is the second lock.
-- `anon` reads and writes none of it. TRUNCATE is taken from every session
-- role, as 0061 takes it from every audited table: no row trigger sees it.
revoke insert, update, delete, truncate, references, trigger on table public.team_loans
  from anon, authenticated;
revoke select on table public.team_loans from anon;
revoke truncate on table public.team_loans from anon, authenticated, service_role;

grant insert (organization_id, member_id, team_id, during, reason) on table public.team_loans
  to authenticated;

-- ------------------------------------------------------------- the calendar read

-- The LIVE loans of the caller's own organization, for every active member:
-- every roster the calendar shows derives from every member's loans (R11.2).
-- The range is answered as its inclusive first and last date. Nothing else
-- leaves it: no reason (FR-92), no author, nothing about a removed loan.
--
-- SECURITY DEFINER, because the table is readable only by an admin; the scope
-- is this function's WHERE clause, not the table's policy. STABLE, for the
-- reason 0008 gives. Zero rows unless the caller is active today and the
-- token's organization is the caller's own, with the claim and helper pins
-- 0018 writes. Every month is read at once.
create function public.calendar_team_loans()
returns table (
  id uuid,
  member_id uuid,
  team_id uuid,
  starts_on date,
  ends_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id,
         l.member_id,
         l.team_id,
         lower(l.during),
         upper(l.during) - 1
    from public.team_loans l
   where l.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and l.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and l.removed_at is null
   order by l.member_id, lower(l.during), l.id
$$;

-- The same explicit grants 0018 writes, for the same reason: Supabase's
-- default privileges grant EXECUTE to `anon`, `authenticated` and
-- `service_role` individually. Only a signed-in session calls this.
revoke execute on function public.calendar_team_loans() from public;
revoke execute on function public.calendar_team_loans() from anon;
revoke execute on function public.calendar_team_loans() from service_role;
grant execute on function public.calendar_team_loans() to authenticated;

-- --------------------------------------------------------------- the triggers

-- AD-3's two change-history triggers, attached in the migration that creates
-- the table (AD-11), in 0061's exact shape.
create trigger team_loans_audit after insert or delete on public.team_loans
  for each row execute function private.record_audit_event('organization_id', 'id');
create trigger team_loans_audit_update after update on public.team_loans
  for each row when (old.* is distinct from new.*)
  execute function private.record_audit_event('organization_id', 'id');
