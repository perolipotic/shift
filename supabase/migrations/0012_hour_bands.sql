-- 0012_hour_bands.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 2.1a: an organization's hour bands, stored as start times.
--
-- SHAPE, NOT VALIDATION (AD-3). A band is a name and a start time and nothing
-- more. Its window, duration and midnight flag are derived by
-- `packages/domain` (bands), never stored: sorted by start, each band ends
-- where the next begins and the last wraps to the first, so a gap or an
-- overlap is unrepresentable. The one uncovered configuration is the empty
-- set, which is a valid stored state — a new organization starts there, and
-- any band, the last one included, may be deleted.
--
--   * ANY COUNT. Nothing here knows how many bands an organization runs, and
--     nothing branches on what one is called (CAP-3, DI-8).
--   * CURRENT-STATE AND RETROACTIVE (CAP-3). Bands are edited in place and
--     apply to every day, past ones included, so there is no version and no
--     validity range.
--   * A START is unique per organization: two bands at the same start would be
--     a zero-length band. It is a whole minute before midnight.
--   * THE NAME is non-blank and unique per organization, case-insensitively.
--
-- No trigger and no function: every rule is a check, an index, a policy or a
-- grant.

create table hour_bands (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  name text not null,

  -- Nominal wall-clock time, never an instant (AD-7 reads it as minutes).
  start_time time not null,

  -- No `created_by`: bands are current-state and AD-11 does not ask this table
  -- for attribution, and a seeded row would have to forge one. `created_at` is
  -- kept as the one default every table in this schema carries, so a row's
  -- first appearance can still be read when diagnosing a fixture or a report.
  created_at timestamptz not null default now(),

  -- The client trims; this refuses a name that is nothing but whitespace from
  -- any caller at all.
  constraint hour_bands_name_not_blank check (btrim(name) <> ''),

  -- `time` admits '24:00', which would be a second midnight and a zero-length
  -- band beside a 00:00 one.
  constraint hour_bands_start_before_midnight check (start_time < '24:00'),

  -- Whole minutes only: the domain works in integer minutes, and a band
  -- starting at 07:00:30 has no minute to start at.
  constraint hour_bands_start_whole_minute check (date_trunc('minute', start_time) = start_time),

  -- Two bands at one start would be a zero-length band. This, with the
  -- derivation, is the whole of "a gap cannot be expressed".
  constraint hour_bands_organization_id_start_time_key unique (organization_id, start_time)
);

alter table hour_bands enable row level security;

-- Q3: every policy below filters by the tenant first.
create index hour_bands_organization_id_idx on hour_bands (organization_id);

-- Case-insensitive per organization, as `teams_organization_name_key` (0009)
-- is, and trimmed inside the index so a padded duplicate cannot slip past it.
-- TOTAL rather than partial: a band is never archived, only deleted.
create unique index hour_bands_organization_name_key
  on hour_bands (organization_id, lower(btrim(name)));

-- ------------------------------------------------------------- the policies

-- Every active member reads their own organization's bands.
create policy hour_bands_select_own_organization on public.hour_bands
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
-- naming another tenant gets 42501.
create policy hour_bands_insert_by_own_active_admin on public.hour_bands
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
  );

-- Rename and move a start. WITH CHECK pins the tenant so a reachable row
-- cannot be moved to another one, for the reason 0003 gives on
-- `members_update_by_own_active_admin`.
create policy hour_bands_update_by_own_active_admin on public.hour_bands
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
  )
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- Any band may be deleted, the last one included: zero bands is a valid state.
-- A member-role account deleting one is refused silently, by matching no row.
create policy hour_bands_delete_by_own_active_admin on public.hour_bands
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
  );

-- ------------------------------------------------------- the writable columns

-- A session names a band's tenant, name and start on insert, and changes its
-- name or start on update; nothing else. `id` and `created_at` come from their
-- defaults. Delete stays a table grant; the policy above narrows it to an
-- admin of the row's own organization.
--
-- SUPABASE'S DEFAULT PRIVILEGES grant every table privilege to `anon` and
-- `authenticated`. No session truncates, references or triggers on this table,
-- and `anon` reads and writes none of it.
revoke insert, update, truncate, references, trigger on table public.hour_bands
  from authenticated;
revoke all on table public.hour_bands from anon;

grant insert (organization_id, name, start_time) on table public.hour_bands to authenticated;
grant update (name, start_time) on table public.hour_bands to authenticated;
