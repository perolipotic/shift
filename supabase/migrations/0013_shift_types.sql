-- 0013_shift_types.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 2.2a: shift types, their versioned times and a derived duration.
--
-- Two tables, split along AD-2's line:
--
--   * `shift_types` is CURRENT-STATE, in 0009's shape: one row per type, its
--     name edited in place, so a rename takes effect on every date, past ones
--     included. `is_working` is fixed when the type is created — no session
--     holds the update privilege on it — because a working type that became
--     non-working would leave its times behind. Removal ARCHIVES, one-way, and
--     there is no delete. ARCHIVING A TYPE WITH A CHANGE SCHEDULED IS REFUSED:
--     an archived type's times must never change later, and its pending
--     version would stay cancellable, so the admin cancels the scheduled
--     version first. A version already in effect does not block it.
--   * `shift_type_versions` is VERSIONED, under 0010's rules unchanged: one row
--     per change of a working type's times, effective from a date, never
--     updated, appended in date order, at most one scheduled after the
--     organization's today, and only that one cancellable while it is still in
--     the future. The times in effect at date D are the version with the
--     greatest `effective_from <= D`, so a correction never rewrites a date
--     before it. A new version must change the times.
--
-- SHAPE, NOT VALIDATION (AD-3). A version stores a start and an end and
-- nothing more. The duration (`end - start`, plus a day when `end <= start`)
-- and the midnight flag are derived by `packages/domain` (duration), never
-- stored. A shift is one span attributed to its start date. A non-working type
-- has no version and no times, and a working type has none until its first
-- version is written; nothing invents them.
--
--   * ANY COUNT. Nothing here knows how many types an organization runs, and
--     nothing branches on what one is called (DI-8).
--   * No field names or implies an hour band.
--
-- WHY NO REFUSAL CARRIES ITS OWN CODE HERE, as in 0010: every version rule is
-- a WITH CHECK clause, so a refused insert arrives as 42501 and a refused
-- cancellation deletes zero rows.
--
-- KNOWN GAP, as in 0010: under READ COMMITTED neither transaction sees the
-- other's uncommitted row, so two concurrent inserts for one type on different
-- future dates can both pass the date-order and one-scheduled rules (the
-- unique key catches only the same date), and a concurrent archive and
-- version insert for one type can both pass — the archive's
-- nothing-scheduled rule and the insert's not-archived rule. That is the
-- cross-transaction serialization entry in deferred-work.
--
-- No trigger. The two functions below are readers, as 0010's are.

create table shift_types (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  name text not null,

  -- Chosen once, on insert; the column grant below admits no update of it.
  -- No default: whether a type is worked is always the admin's statement.
  is_working boolean not null,

  -- A flag, not an instant, for the reason 0009 gives on `teams`.
  archived boolean not null default false,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the insert policy pins `created_by` as
  -- well. `created_at` is also the creation order 2.2b reads a ramp slot from.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- The client trims; this refuses a name that is nothing but whitespace from
  -- any caller at all.
  constraint shift_types_name_not_blank check (btrim(name) <> ''),

  -- The target of the versions' composite foreign key, so a version naming
  -- another tenant's type is unrepresentable rather than merely refused.
  constraint shift_types_organization_id_id_key unique (organization_id, id)
);

alter table shift_types enable row level security;

-- Q3: every policy below filters by the tenant first.
create index shift_types_organization_id_idx on shift_types (organization_id);

-- Case-insensitive and trimmed per organization, as `teams_organization_name_key`
-- (0009) is, and PARTIAL: only types still in use compete for a name, so an
-- archived one never blocks its name being reused.
create unique index shift_types_organization_name_key
  on shift_types (organization_id, lower(btrim(name)))
  where not archived;

create table shift_type_versions (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  shift_type_id uuid not null,

  -- Nominal wall-clock times, never instants (AD-7 reads them as minutes). An
  -- end at or before the start is on the next day; equal times are 24 hours.
  start_time time not null,
  end_time time not null,

  -- A date, never an instant. Whether it may lie in the past is the insert
  -- policy's rule; finiteness is the row's, for the reason 0008 gives.
  effective_from date not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the policy pins `created_by` as well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- To the unique (organization_id, id) above, so a version naming another
  -- tenant's type is unrepresentable. NO cascade: types are never deleted
  -- (the verb is revoked), and history must not vanish if one ever were.
  constraint shift_type_versions_shift_type_fkey
    foreign key (organization_id, shift_type_id)
    references shift_types (organization_id, id),

  -- `time` admits '24:00', which would be a second midnight.
  constraint shift_type_versions_start_before_midnight check (start_time < '24:00'),
  constraint shift_type_versions_end_before_midnight check (end_time < '24:00'),

  -- Whole minutes only: the domain works in integer minutes.
  constraint shift_type_versions_start_whole_minute
    check (date_trunc('minute', start_time) = start_time),
  constraint shift_type_versions_end_whole_minute
    check (date_trunc('minute', end_time) = end_time),

  constraint shift_type_versions_effective_from_finite
    check (isfinite(effective_from) and effective_from < date '10000-01-01'),

  -- One version per type per date, and the index every read uses.
  constraint shift_type_versions_shift_type_id_effective_from_key
    unique (shift_type_id, effective_from)
);

alter table shift_type_versions enable row level security;

-- Q3: every policy below filters by the tenant first, and the unique index
-- leads with `shift_type_id`, so the tenant column gets its own index.
create index shift_type_versions_organization_id_idx
  on shift_type_versions (organization_id);

-- ------------------------------------------------------------------ the readers

-- VOLATILE PL/pgSQL, SECURITY INVOKER, for the reasons 0008 and 0010 give: a
-- multi-row insert must see the rows the same statement wrote a moment
-- earlier, which a STABLE or inlined SQL function would not, and a session
-- learns nothing through these that the select policy would not already show.

-- The date of a type's latest version, or null when it has none. What the
-- date-order and one-scheduled rules compare against, what makes only the
-- latest version cancellable, and what refuses archiving a type with a change
-- scheduled.
create function public.shift_type_latest_version(shift_type uuid) returns date
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return (
    select max(v.effective_from)
      from public.shift_type_versions v
     where v.shift_type_id = shift_type
  );
end;
$$;

-- The times of a type at a date: the version with the greatest
-- `effective_from` on or before it, and no row when there is none.
-- `'infinity'::date` as the date is the type's LATEST times, which the insert
-- policy's changes-the-times rule compares against — as 0010's
-- `member_team_on` is read. A FUNCTION, not a subquery in that policy, because
-- a policy on this table that selected from it directly would recurse (42P17).
create function public.shift_type_times_on(shift_type uuid, on_date date)
returns table (start_time time, end_time time)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return query
    select v.start_time, v.end_time
      from public.shift_type_versions v
     where v.shift_type_id = shift_type
       and v.effective_from <= on_date
     order by v.effective_from desc
     limit 1;
end;
$$;

-- The same explicit grants 0008 and 0010 write, for the same reason:
-- Supabase's default privileges grant EXECUTE to `anon`, `authenticated` and
-- `service_role` individually. `authenticated` keeps it because the policies
-- call both as the querying role.
revoke execute on function public.shift_type_latest_version(uuid) from public;
revoke execute on function public.shift_type_latest_version(uuid) from anon;
revoke execute on function public.shift_type_latest_version(uuid) from service_role;
grant execute on function public.shift_type_latest_version(uuid) to authenticated;

revoke execute on function public.shift_type_times_on(uuid, date) from public;
revoke execute on function public.shift_type_times_on(uuid, date) from anon;
revoke execute on function public.shift_type_times_on(uuid, date) from service_role;
grant execute on function public.shift_type_times_on(uuid, date) to authenticated;


-- ------------------------------------------------------ the shift type policies

-- Every active member reads their own organization's types, archived ones
-- included: an archived type is still the type some past day was worked on.
create policy shift_types_select_own_organization on public.shift_types
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

-- Insert has no USING clause to fail, so a member-role account or an admin
-- naming another tenant gets 42501. The attribution is pinned to the caller.
create policy shift_types_insert_by_own_active_admin on public.shift_types
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

-- Rename and archive. USING reaches only a type that is NOT archived, which is
-- the whole of "archiving is one-way", as on 0009's teams. WITH CHECK pins the
-- tenant so a reachable row cannot be moved to another one, and admits
-- `archived = true` only while the type's latest version is already in effect
-- (or it has none) — nothing scheduled after the organization's today. A
-- rename of a type with a change scheduled passes: `archived` is false.
create policy shift_types_update_by_own_active_admin on public.shift_types
  for update
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
    and archived = false
  )
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
    and (
      not archived
      or coalesce(public.shift_type_latest_version(id), '-infinity'::date)
           <= public.organization_today(organization_id)
    )
  );

-- ----------------------------------------------------------- the version policies

-- Any active member reads their own organization's versions: later epics'
-- derivations select the times in effect by date.
create policy shift_type_versions_select_own_organization on public.shift_type_versions
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
--     past days' times;
--   * AFTER the type's latest version, so versions append in date order;
--   * AT MOST ONE CHANGE SCHEDULED: the type's latest version is already in
--     effect, or there is none;
--   * CHANGING THE TIMES — the start or the end differs from the latest
--     version's. A first version has no latest times, so the reader returns no
--     row and the rule holds by itself;
--   * a type of the same organization that is working and not archived.
create policy shift_type_versions_insert_by_own_active_admin on public.shift_type_versions
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
    and effective_from > coalesce(public.shift_type_latest_version(shift_type_id), '-infinity'::date)
    and coalesce(public.shift_type_latest_version(shift_type_id), '-infinity'::date)
          <= public.organization_today(organization_id)
    and not exists (
      select 1
        from public.shift_type_times_on(shift_type_versions.shift_type_id, 'infinity'::date) as latest
       where latest.start_time = shift_type_versions.start_time
         and latest.end_time = shift_type_versions.end_time
    )
    and exists (
      select 1
        from public.shift_types shift_type
       where shift_type.organization_id = shift_type_versions.organization_id
         and shift_type.id = shift_type_versions.shift_type_id
         and shift_type.is_working
         and not shift_type.archived
    )
  );

-- Cancelling a change that has not happened yet: the same tenant and role
-- rules as the insert, NOT YET IN EFFECT, and the type's LATEST version.
create policy shift_type_versions_delete_scheduled_by_own_active_admin on public.shift_type_versions
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
    and effective_from = public.shift_type_latest_version(shift_type_id)
  );

-- ------------------------------------------------------- the writable columns

-- SUPABASE'S DEFAULT PRIVILEGES grant every table privilege to `anon` and
-- `authenticated`.
--
-- `shift_types`: a session names a type's tenant, name and whether it is
-- working on insert, and renames or archives it on update; nothing else.
-- Delete is revoked outright, as on 0009's teams — removal archives.
revoke insert, update, delete, truncate, references, trigger on table public.shift_types
  from anon, authenticated;
revoke select on table public.shift_types from anon;

grant insert (organization_id, name, is_working) on table public.shift_types to authenticated;
grant update (name, archived) on table public.shift_types to authenticated;

-- `shift_type_versions`: a session names the five facts and nothing else.
-- Delete stays a table grant; the policy above narrows it to a scheduled
-- version. No session updates, truncates, references or triggers on it, and
-- `anon` reads and writes none of it.
revoke update, truncate, references, trigger on table public.shift_type_versions
  from anon, authenticated;
revoke select, insert, delete on table public.shift_type_versions from anon;
revoke insert on table public.shift_type_versions from authenticated;

grant insert (
  organization_id,
  shift_type_id,
  start_time,
  end_time,
  effective_from
) on table public.shift_type_versions to authenticated;
