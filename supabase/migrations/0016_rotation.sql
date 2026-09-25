-- 0016_rotation.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 2.3a: a rotation is stored as a pattern of steps and versioned team
-- assignments, and `packages/domain` (projection) projects any date from them.
--
-- Three tables, along AD-2's line:
--
--   * `rotation_patterns` is IMMUTABLE: one row per pattern, carrying nothing
--     but its tenant and its attribution. No session updates or deletes one.
--   * `rotation_steps` is IMMUTABLE and ORDERED: each step names a shift type
--     at a position within one pattern. Positions are non-negative and unique
--     per pattern; gaps are harmless, because the projection orders the steps
--     by position and reads them by index. A step is INSERTABLE ONLY WHILE ITS
--     PATTERN HAS NO ASSIGNMENT, so a pattern any team stands on can never
--     change under it. A rotation change (2.6) is a NEW pattern and a new
--     assignment version pointing at it; the old pattern and its steps stay, so
--     past dates still project through them.
--   * `rotation_assignments` is VERSIONED, under 0010's rules unchanged: one
--     row per change of a team's rotation, effective from a date, never
--     updated, appended in date order, at most one scheduled after the
--     organization's today, and only that one cancellable while it is still in
--     the future. A new version must change the pattern, the offset step or
--     the anchor. The rotation in effect at date D is the version with the
--     greatest `effective_from <= D`.
--
-- SHAPE, NOT VALIDATION (AD-3). The offset is a FOREIGN KEY to a step of THE
-- SAME pattern, never an integer: `(organization_id, pattern_id,
-- offset_step_id)` references `rotation_steps (organization_id, pattern_id,
-- id)`. So an offset outside the cycle names no row and cannot be stored, and
-- an empty pattern has no step to name at all. No cycle length, no offset
-- integer and no projected shift is stored anywhere; all three are derived.
--
--   * ANY COUNT. Nothing here knows how many steps a pattern has or how many
--     teams share one, and nothing branches on what a type or a team is called
--     (DI-8). Nothing assumes a week.
--   * The anchor date lives on the assignment and may be any date, past or
--     future. That teams share one is a convention of the interface.
--   * Nothing here reads a fire rank or a team position.
--
-- SAVING IS NOT ATOMIC, by decision: a pattern, then all its steps in one
-- insert, then all the assignments in one insert. A failure after the first
-- write leaves a pattern no team stands on, which projects nothing.
--
-- WHY NO REFUSAL CARRIES ITS OWN CODE HERE, as in 0010: every rule is a WITH
-- CHECK clause, a key or a grant, so a refused insert arrives as 42501 (or as
-- the key's 23502, 23503 or 23505) and a refused cancellation deletes zero
-- rows.
--
-- KNOWN GAP, as in 0010: under READ COMMITTED neither transaction sees the
-- other's uncommitted row, so two concurrent assignment inserts for one team on
-- different future dates can both pass the date-order and one-scheduled rules
-- (the unique key catches only the same date), and a concurrent step insert and
-- first assignment on one pattern can both pass. That is the cross-transaction
-- serialization entry in deferred-work.
--
-- No trigger and no RPC. The three functions below are readers, as 0010's are.

create table rotation_patterns (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the insert policy pins `created_by` as
  -- well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- The target of the steps' and assignments' composite foreign keys, so a row
  -- naming another tenant's pattern is unrepresentable rather than refused.
  constraint rotation_patterns_organization_id_id_key unique (organization_id, id)
);

alter table rotation_patterns enable row level security;

-- Q3: every policy below filters by the tenant first.
create index rotation_patterns_organization_id_idx on rotation_patterns (organization_id);

create table rotation_steps (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  pattern_id uuid not null,

  -- The order within the pattern. Gaps are harmless: the projection reads the
  -- steps by index once they are ordered.
  position integer not null,

  -- A type may appear at more than one position of one pattern.
  shift_type_id uuid not null,

  -- AD-11, as on the pattern.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- To the pattern's unique (organization_id, id), so a step of another
  -- tenant's pattern is unrepresentable. NO cascade: patterns are never
  -- deleted (the verb is revoked), and history must not vanish if one were.
  constraint rotation_steps_pattern_fkey
    foreign key (organization_id, pattern_id)
    references rotation_patterns (organization_id, id),

  -- To 0013's unique (organization_id, id), so a step naming another tenant's
  -- type is unrepresentable. NO cascade, for the same reason.
  constraint rotation_steps_shift_type_fkey
    foreign key (organization_id, shift_type_id)
    references shift_types (organization_id, id),

  constraint rotation_steps_position_not_negative check (position >= 0),

  -- One step per position of a pattern, and the index every read uses.
  constraint rotation_steps_pattern_id_position_key unique (pattern_id, position),

  -- The target of the assignment's offset key: a step, AND the pattern it
  -- belongs to, so an offset can only ever name a step of its own pattern.
  constraint rotation_steps_organization_id_pattern_id_id_key
    unique (organization_id, pattern_id, id)
);

alter table rotation_steps enable row level security;

-- Q3: every policy below filters by the tenant first, and the unique index
-- leads with `pattern_id`, so the tenant column gets its own index.
create index rotation_steps_organization_id_idx on rotation_steps (organization_id);

create table rotation_assignments (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  team_id uuid not null,

  pattern_id uuid not null,

  -- The step the team stands on at the anchor date. NOT NULL and a key to a
  -- step of this very pattern (below), so it is always inside the cycle.
  offset_step_id uuid not null,

  -- Dates, never instants. The anchor may be any date, past or future; whether
  -- `effective_from` may lie in the past is the insert policy's rule.
  -- Finiteness is the row's, for the reason 0008 gives, and so is a year in
  -- 0001–9999: PostgreSQL admits BC dates, which no `YYYY-MM-DD` reader of the
  -- row accepts, so one such row would make every projection of the team fail.
  anchor_date date not null,
  effective_from date not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the policy pins `created_by` as well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- To 0009's unique (organization_id, id), so an assignment naming another
  -- tenant's team is unrepresentable. NO cascade: teams are never deleted
  -- (0009 revokes the verb), and history must not vanish if one ever were.
  constraint rotation_assignments_team_fkey
    foreign key (organization_id, team_id)
    references teams (organization_id, id),

  -- To the pattern's unique (organization_id, id). NO cascade.
  constraint rotation_assignments_pattern_fkey
    foreign key (organization_id, pattern_id)
    references rotation_patterns (organization_id, id),

  -- THE OFFSET, AS SHAPE. Three columns to the step's (organization_id,
  -- pattern_id, id): the step must exist, in this tenant, IN THIS PATTERN. An
  -- offset outside the cycle, or any offset on an empty pattern, is a 23503.
  -- NO cascade.
  constraint rotation_assignments_offset_step_fkey
    foreign key (organization_id, pattern_id, offset_step_id)
    references rotation_steps (organization_id, pattern_id, id),

  constraint rotation_assignments_anchor_date_finite
    check (isfinite(anchor_date) and anchor_date >= date '0001-01-01' and anchor_date < date '10000-01-01'),

  constraint rotation_assignments_effective_from_finite
    check (isfinite(effective_from) and effective_from >= date '0001-01-01' and effective_from < date '10000-01-01'),

  -- One version per team per date, and the index every read uses.
  constraint rotation_assignments_team_id_effective_from_key
    unique (team_id, effective_from)
);

alter table rotation_assignments enable row level security;

-- Q3: every policy below filters by the tenant first, and the unique index
-- leads with `team_id`, so the tenant column gets its own index.
create index rotation_assignments_organization_id_idx
  on rotation_assignments (organization_id);

-- `rotation_pattern_in_use` reads by pattern, on every step insert; without
-- this it scans the organization's assignments.
create index rotation_assignments_pattern_id_idx
  on rotation_assignments (pattern_id);

-- ------------------------------------------------------------------ the readers

-- VOLATILE PL/pgSQL, SECURITY INVOKER, for the reasons 0008 and 0010 give: a
-- multi-row insert must see the rows the same statement wrote a moment
-- earlier, which a STABLE or inlined SQL function would not, and a session
-- learns nothing through these that the select policies would not already
-- show it.

-- Whether any team stands, or ever stood, on a pattern: any assignment names
-- it, in any version. What refuses a step insert once the pattern is in use,
-- so a pattern's steps are fixed from its first assignment on.
create function public.rotation_pattern_in_use(pattern uuid) returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return exists (
    select 1
      from public.rotation_assignments a
     where a.pattern_id = pattern
  );
end;
$$;

-- The rotation of a team at a date: the version with the greatest
-- `effective_from` on or before it, and NO ROW when there is none.
-- `'infinity'::date` as the date is the team's LATEST version, which the
-- insert policy's changes-the-value rule compares against. A FUNCTION, not a
-- subquery in that policy, because a policy on this table that selected from
-- it directly would recurse (42P17) — 0013's and 0015's reason.
create function public.rotation_assignment_on(team uuid, on_date date)
returns table (pattern_id uuid, offset_step_id uuid, anchor_date date)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return query
    select a.pattern_id, a.offset_step_id, a.anchor_date
      from public.rotation_assignments a
     where a.team_id = team
       and a.effective_from <= on_date
     order by a.effective_from desc
     limit 1;
end;
$$;

-- The date of a team's latest version, or null when it has none. What the
-- date-order and one-scheduled rules compare against, and what makes only the
-- latest version cancellable.
create function public.rotation_assignment_latest_version(team uuid) returns date
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return (
    select max(a.effective_from)
      from public.rotation_assignments a
     where a.team_id = team
  );
end;
$$;

-- The same explicit grants 0008 and 0010 write, for the same reason:
-- Supabase's default privileges grant EXECUTE to `anon`, `authenticated` and
-- `service_role` individually. `authenticated` keeps it because the policies
-- call every one of them as the querying role.
revoke execute on function public.rotation_pattern_in_use(uuid) from public;
revoke execute on function public.rotation_pattern_in_use(uuid) from anon;
revoke execute on function public.rotation_pattern_in_use(uuid) from service_role;
grant execute on function public.rotation_pattern_in_use(uuid) to authenticated;

revoke execute on function public.rotation_assignment_on(uuid, date) from public;
revoke execute on function public.rotation_assignment_on(uuid, date) from anon;
revoke execute on function public.rotation_assignment_on(uuid, date) from service_role;
grant execute on function public.rotation_assignment_on(uuid, date) to authenticated;

revoke execute on function public.rotation_assignment_latest_version(uuid) from public;
revoke execute on function public.rotation_assignment_latest_version(uuid) from anon;
revoke execute on function public.rotation_assignment_latest_version(uuid) from service_role;
grant execute on function public.rotation_assignment_latest_version(uuid) to authenticated;

-- ------------------------------------------------------------ the pattern policies

-- Every active member reads their own organization's patterns: the schedule
-- of every date is derived from them.
create policy rotation_patterns_select_own_organization on public.rotation_patterns
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
create policy rotation_patterns_insert_by_own_active_admin on public.rotation_patterns
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

-- --------------------------------------------------------------- the step policies

-- Every active member reads their own organization's steps.
create policy rotation_steps_select_own_organization on public.rotation_steps
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

-- The only way a step is written. Every rule is one conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an active admin;
--   * the attribution, pinned to the caller;
--   * a PATTERN NO TEAM STANDS ON yet — once any assignment names it, its
--     steps are fixed;
--   * a type that is NOT ARCHIVED. That the type is of the same organization is
--     the composite key's rule, not this one's, so another tenant's type — which
--     this session cannot see — passes here and is refused by the key (23503).
create policy rotation_steps_insert_by_own_active_admin on public.rotation_steps
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
    and not public.rotation_pattern_in_use(pattern_id)
    and not exists (
      select 1
        from public.shift_types shift_type
       where shift_type.organization_id = rotation_steps.organization_id
         and shift_type.id = rotation_steps.shift_type_id
         and shift_type.archived
    )
  );

-- --------------------------------------------------------- the assignment policies

-- Any active member reads their own organization's versions: the schedule of
-- every date selects one by date.
create policy rotation_assignments_select_own_organization on public.rotation_assignments
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

-- The only way a version is written. 0010's rules, conjunct for conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an active admin;
--   * the attribution, pinned to the caller;
--   * TODAY OR LATER in the organization's zone — a past date would rewrite
--     past schedules;
--   * AFTER the team's latest version, so versions append in date order;
--   * AT MOST ONE CHANGE SCHEDULED: the team's latest version is already in
--     effect, or there is none;
--   * CHANGING THE VALUE — no latest version carries this pattern, this offset
--     step AND this anchor. A first version has no latest one, so the reader
--     returns no row and the rule holds by itself;
--   * a team of the same organization that is not archived.
create policy rotation_assignments_insert_by_own_active_admin on public.rotation_assignments
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
    and effective_from > coalesce(public.rotation_assignment_latest_version(team_id), '-infinity'::date)
    and coalesce(public.rotation_assignment_latest_version(team_id), '-infinity'::date)
          <= public.organization_today(organization_id)
    and not exists (
      select 1
        from public.rotation_assignment_on(rotation_assignments.team_id, 'infinity'::date) as latest
       where latest.pattern_id = rotation_assignments.pattern_id
         and latest.offset_step_id = rotation_assignments.offset_step_id
         and latest.anchor_date = rotation_assignments.anchor_date
    )
    and exists (
      select 1
        from public.teams team
       where team.organization_id = rotation_assignments.organization_id
         and team.id = rotation_assignments.team_id
         and not team.archived
    )
  );

-- Cancelling a change that has not happened yet: the same tenant and role
-- rules as the insert, NOT YET IN EFFECT, and the team's LATEST version.
create policy rotation_assignments_delete_scheduled_by_own_active_admin on public.rotation_assignments
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
    and effective_from = public.rotation_assignment_latest_version(team_id)
  );

-- ------------------------------------------------------- the writable columns

-- SUPABASE'S DEFAULT PRIVILEGES grant every table privilege to `anon` and
-- `authenticated`.
--
-- `rotation_patterns` and `rotation_steps`: IMMUTABLE. A session names a
-- pattern's tenant, and a step's tenant, pattern, position and type, on
-- insert; nothing else, and never again. Update and delete are revoked
-- outright — there is no policy for either, and the privilege is the second
-- lock. `id`, `created_by` and `created_at` come from their defaults (AD-11).
revoke insert, update, delete, truncate, references, trigger on table public.rotation_patterns
  from anon, authenticated;
revoke select on table public.rotation_patterns from anon;

grant insert (organization_id) on table public.rotation_patterns to authenticated;

revoke insert, update, delete, truncate, references, trigger on table public.rotation_steps
  from anon, authenticated;
revoke select on table public.rotation_steps from anon;

grant insert (organization_id, pattern_id, position, shift_type_id) on table public.rotation_steps
  to authenticated;

-- `rotation_assignments`: a session names the six facts and nothing else.
-- Delete stays a table grant; the policy above narrows it to a scheduled
-- version. No session updates, truncates, references or triggers on it, and
-- `anon` reads and writes none of it.
revoke update, truncate, references, trigger on table public.rotation_assignments
  from anon, authenticated;
revoke select, insert, delete on table public.rotation_assignments from anon;
revoke insert on table public.rotation_assignments from authenticated;

grant insert (
  organization_id,
  team_id,
  pattern_id,
  offset_step_id,
  anchor_date,
  effective_from
) on table public.rotation_assignments to authenticated;
