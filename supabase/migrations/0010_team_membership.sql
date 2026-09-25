-- 0010_team_membership.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 1.7b: an admin moves a member between teams from a chosen date.
--
-- AD-2 classifies team membership as VERSIONED, so "which team was this member
-- on at date D" stays answerable after a move. This migration adds the
-- versioned table and reuses 0008's rules for `member_status_versions`
-- unchanged:
--
--   * `team_membership_versions` holds one row per change, effective from a
--     date. A version is never updated in place: there is no update policy and
--     the privilege is revoked. The team as at date D is the row with the
--     greatest `effective_from <= D`. A null `team_id` means "no team from that
--     date", and a member with no row at all is on no team, so member creation,
--     the seed and the operator script write nothing here.
--   * Versions APPEND IN DATE ORDER AND EACH ONE CHANGES THE TEAM, and at most
--     ONE version, the latest, is dated after the organization's today: the
--     one scheduled change. Only that one may be cancelled — deleted — and only
--     while it is still in the future.
--   * A version names a team of the member's own organization (a composite
--     foreign key) that is not archived at the moment it is written.
--   * `member_team_on(uuid, date)` is the one reading of the table, used by the
--     policies and the tests; the SPA derives the same thing from the rows.
--
-- ARCHIVING A TEAM IN USE IS REFUSED. 0009's update policy on `teams` gains a
-- WITH CHECK conjunct: `archived = true` is admitted only while no version for
-- that team is in effect today or dated after today. Whether the member is
-- active does not matter. The policy is ALTERED here, never re-created, and
-- 0009 is untouched. Refusal rather than ending the memberships, because an
-- archive that ended them would be a write to another table hidden inside an
-- update, which would need a trigger or a function AD-3/AD-5 forbid. So no
-- reading of today or later ever meets an archived team, by the policies alone
-- and within one transaction at a time (see KNOWN GAP); past versions may still
-- point at one, and it stays readable.
--
-- Status and team are independent: nothing here reads `member_status_versions`,
-- and nothing there reads this table. An admin may set their own team.
--
-- WHY NO REFUSAL CARRIES ITS OWN CODE HERE, as 0008 gives: every rule is a WITH
-- CHECK clause, so every refused insert arrives as 42501 and a refused
-- cancellation deletes zero rows. The named messages are the surface's reading
-- of what it sent.
--
-- KNOWN GAP, as in 0008: a concurrent archive and assign under READ COMMITTED
-- can both pass. Neither sees the other's uncommitted row. Likewise two
-- concurrent inserts for one member on different future dates can both pass
-- the date-order and one-scheduled rules; the unique key catches only the same
-- date. Both are the cross-transaction serialization entry in deferred-work.

create table team_membership_versions (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  -- A composite foreign key to 0002's unique (organization_id, id), so a
  -- version naming another tenant's member is unrepresentable.
  member_id uuid not null,

  -- Null is "no team from this date". The composite foreign key below is MATCH
  -- SIMPLE, so a null here is not checked against `teams` at all.
  team_id uuid,

  -- A date, never an instant. Whether it may lie in the past is the insert
  -- policy's rule; finiteness is the row's, for the reason 0008 gives.
  effective_from date not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the policy pins `created_by` as well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  constraint team_membership_versions_member_fkey
    foreign key (organization_id, member_id)
    references members (organization_id, id)
    on delete cascade,

  -- To 0009's unique (organization_id, id), so a version naming another
  -- tenant's team is unrepresentable. NO cascade: teams are never deleted
  -- (0009 revokes the verb), and history must not vanish if one ever were.
  constraint team_membership_versions_team_fkey
    foreign key (organization_id, team_id)
    references teams (organization_id, id),

  constraint team_membership_versions_effective_from_finite
    check (isfinite(effective_from) and effective_from < date '10000-01-01'),

  -- One version per member per date, and the index every read uses.
  constraint team_membership_versions_member_id_effective_from_key
    unique (member_id, effective_from)
);

alter table team_membership_versions enable row level security;

-- Q3: every policy below filters by the tenant first, and the unique index
-- leads with `member_id`, so the tenant column gets its own index.
create index team_membership_versions_organization_id_idx
  on team_membership_versions (organization_id);

-- `team_in_use` reads by team; without this it scans the organization.
create index team_membership_versions_team_id_idx
  on team_membership_versions (team_id);

-- ------------------------------------------------------------------ the readers

-- VOLATILE PL/pgSQL, SECURITY INVOKER, for the reasons 0008 gives: a
-- multi-row insert must see the rows the same statement wrote a moment earlier,
-- which a STABLE or inlined SQL function would not, and a session learns
-- nothing through these that the select policy would not already show it.

-- The team a member is on at a date: the version with the greatest
-- `effective_from` on or before it, and null when there is none or when that
-- version is "no team". `'infinity'::date` as the date is the member's LATEST
-- state, which the insert policy's changes-the-team rule compares against.
create function public.member_team_on(member uuid, on_date date) returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return (
    select v.team_id
      from public.team_membership_versions v
     where v.member_id = member
       and v.effective_from <= on_date
     order by v.effective_from desc
     limit 1
  );
end;
$$;

-- Whether a member has any version at all. `member_team_on` answers null both
-- for "no row" and for "a row saying no team", and a "no team" version is only
-- a change when there is a history to change.
create function public.member_team_has_version(member uuid) returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return exists (
    select 1
      from public.team_membership_versions v
     where v.member_id = member
  );
end;
$$;

-- The date of a member's latest version, or null when they have none. What
-- the date-order rule compares against, and what makes only the latest
-- version cancellable.
create function public.team_membership_latest_version(member uuid) returns date
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return (
    select max(v.effective_from)
      from public.team_membership_versions v
     where v.member_id = member
  );
end;
$$;

-- Whether anyone is on a team today, or is scheduled onto it: some version
-- naming it is dated after its organization's today, or is the version in
-- effect today for its member. Only past versions that a later one has
-- superseded leave a team free to archive. Today is read per version from the
-- version's own organization, which is the team's (the composite key).
--
-- A FUNCTION rather than a subquery in the teams policy so that it reads
-- versions through one reviewed path, and INVOKER for the reason the readers
-- above are.
create function public.team_in_use(team uuid) returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return exists (
    select 1
      from public.team_membership_versions v
     where v.team_id = team
       and (
         v.effective_from > public.organization_today(v.organization_id)
         or public.member_team_on(v.member_id, public.organization_today(v.organization_id)) = team
       )
  );
end;
$$;

-- The same explicit grants 0008 writes, for the same reason: Supabase's
-- default privileges grant EXECUTE to `anon`, `authenticated` and
-- `service_role` individually. `authenticated` keeps it because the policies
-- call every one of them as the querying role.
revoke execute on function public.member_team_on(uuid, date) from public;
revoke execute on function public.member_team_on(uuid, date) from anon;
revoke execute on function public.member_team_on(uuid, date) from service_role;
grant execute on function public.member_team_on(uuid, date) to authenticated;

revoke execute on function public.member_team_has_version(uuid) from public;
revoke execute on function public.member_team_has_version(uuid) from anon;
revoke execute on function public.member_team_has_version(uuid) from service_role;
grant execute on function public.member_team_has_version(uuid) to authenticated;

revoke execute on function public.team_membership_latest_version(uuid) from public;
revoke execute on function public.team_membership_latest_version(uuid) from anon;
revoke execute on function public.team_membership_latest_version(uuid) from service_role;
grant execute on function public.team_membership_latest_version(uuid) to authenticated;

revoke execute on function public.team_in_use(uuid) from public;
revoke execute on function public.team_in_use(uuid) from anon;
revoke execute on function public.team_in_use(uuid) from service_role;
grant execute on function public.team_in_use(uuid) to authenticated;

-- ------------------------------------------------------------- the policies

-- Any active member reads their own organization's versions: the list states
-- each member's team, and later epics' derivations select by date.
create policy team_membership_versions_select_own_organization on public.team_membership_versions
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
  );

-- The only way a version is written. Every rule of the story is one conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an active admin;
--   * the attribution, pinned to the caller;
--   * TODAY OR LATER in the organization's zone — a past date would rewrite
--     past rosters;
--   * AFTER the member's latest version, so versions append in date order;
--   * AT MOST ONE CHANGE SCHEDULED: the member's latest version is already in
--     effect, or there is none;
--   * CHANGING THE TEAM — `team_id` differs from the member's latest state, and
--     "no team" only when there is a version to follow;
--   * a named team is one that is not archived.
create policy team_membership_versions_insert_by_own_active_admin on public.team_membership_versions
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
    and effective_from >= public.organization_today(organization_id)
    and effective_from > coalesce(public.team_membership_latest_version(member_id), '-infinity'::date)
    and coalesce(public.team_membership_latest_version(member_id), '-infinity'::date)
          <= public.organization_today(organization_id)
    and team_id is distinct from public.member_team_on(member_id, 'infinity'::date)
    and (team_id is not null or public.member_team_has_version(member_id))
    and (
      team_id is null
      or exists (
        select 1
          from public.teams team
         where team.organization_id = team_membership_versions.organization_id
           and team.id = team_membership_versions.team_id
           and not team.archived
      )
    )
  );

-- Cancelling a change that has not happened yet: the same tenant and role
-- rules as the insert, NOT YET IN EFFECT, and the member's LATEST version.
create policy team_membership_versions_delete_scheduled_by_own_active_admin on public.team_membership_versions
  for delete
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
    and effective_from > public.organization_today(organization_id)
    and effective_from = public.team_membership_latest_version(member_id)
  );

-- --------------------------------------------- archiving a team in use, refused

-- 0009's WITH CHECK, unchanged, and one more conjunct. USING is untouched, so
-- archiving stays one-way. A rename of a team in use passes: `archived` is
-- false on the new row.
alter policy teams_update_by_own_active_admin on public.teams
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
    and (not archived or not public.team_in_use(id))
  );

-- ------------------------------------------------------- the writable columns

-- A session names the four facts and nothing else. `created_by` and
-- `created_at` come from their defaults (AD-11). Delete stays a table grant;
-- the policy above narrows it to a scheduled version. No session updates,
-- truncates, references or triggers on this table, and `anon` reads and
-- writes none of it.
revoke update, truncate, references, trigger on table public.team_membership_versions
  from anon, authenticated;
revoke select, insert, delete on table public.team_membership_versions from anon;
revoke insert on table public.team_membership_versions from authenticated;

grant insert (
  organization_id,
  member_id,
  team_id,
  effective_from
) on table public.team_membership_versions to authenticated;
