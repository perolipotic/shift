-- 0019_shift_type_overrides.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 3.5a: a shift-type override is recorded and shown.
--
-- One table. `shift_type_overrides` records that a team worked ANOTHER SHIFT
-- TYPE ON ONE DATE than its rotation projects (CAP-12). It is the exception
-- layer the schedule applies OVER the projection in `packages/domain`
-- (overrides); nothing here writes, reads or refers to a rotation pattern, step
-- or assignment, so those rule rows are byte-identical before and after any
-- override (DI-2). Removing an override restores the projected type exactly.
--
--   * ANY TYPE, a non-working one included, and ANY DATE, past or future (the
--     user's decision, 2026-09-27). Whether a rotation is in effect on the date
--     is the domain's question: an override on a date with no rotation is
--     ignored there, never refused here.
--   * A REASON IS REQUIRED: 1–200 characters once surrounding white space —
--     spaces, tabs and line breaks alike (`[[:space:]]`) — is trimmed.
--     `btrim` would trim spaces alone, and a reason of tabs or line breaks
--     only would pass as a reason.
--   * ATTRIBUTED (AD-11): `created_by` and `created_at` come from defaults the
--     client cannot forge, and the insert policy pins `created_by` as well.
--   * SOFT-REMOVED. `removed_by` and `removed_at` exist now, both null or both
--     set, but no session sets them: there is no update or delete grant. How a
--     removal is attributed — a column default cannot attribute an UPDATE — is
--     story 3.5b's decision. The partial unique key and the calendar read
--     below already honour them: AT MOST ONE LIVE OVERRIDE PER TEAM AND DATE,
--     and a removed one stays as the record of what was changed.
--
-- WHO READS WHAT. The table itself is readable, and insertable, only by an
-- ACTIVE ADMIN of the token's organization, as 0016's writes are. Every active
-- member reads the LIVE overrides of their organization through
-- `calendar_shift_type_overrides()` below, which names the author by their
-- `members.id` — never by `auth_user_id`, which no member-role session is
-- shown.
--
-- WHY NO REFUSAL CARRIES ITS OWN CODE HERE, as in 0010: every rule is a WITH
-- CHECK clause, a key, a check or a grant, so a refused insert arrives as
-- 42501 (or as 23502, 23503, 23505 or 23514).
--
-- No trigger. In this story only seeds and fixtures write overrides; the admin
-- form is 3.5b's, and the review of overrides on a rotation change is 3.5c's.

create table shift_type_overrides (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  team_id uuid not null,

  -- A date, never an instant: the civil day the team worked `shift_type_id`.
  date date not null,

  shift_type_id uuid not null,

  reason text not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the insert policy pins `created_by` as
  -- well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- The removal, set together or not at all. No session holds a privilege on
  -- either; story 3.5b decides how they are written.
  removed_by uuid,
  removed_at timestamptz,

  -- To 0009's unique (organization_id, id), so an override naming another
  -- tenant's team is unrepresentable. NO cascade: teams are never deleted, and
  -- the record must outlive what it changed.
  constraint shift_type_overrides_team_fkey
    foreign key (organization_id, team_id)
    references teams (organization_id, id),

  -- To 0013's unique (organization_id, id), so an override naming another
  -- tenant's type is unrepresentable. NO cascade, for the same reason.
  constraint shift_type_overrides_shift_type_fkey
    foreign key (organization_id, shift_type_id)
    references shift_types (organization_id, id),

  -- Finite and in years 0001–9999, for the reason 0016 gives.
  constraint shift_type_overrides_date_finite
    check (isfinite(date) and date >= date '0001-01-01' and date < date '10000-01-01'),

  constraint shift_type_overrides_reason_length
    check (char_length(regexp_replace(reason, '^[[:space:]]+|[[:space:]]+$', '', 'g')) between 1 and 200),

  constraint shift_type_overrides_removal_complete
    check ((removed_by is null) = (removed_at is null))
);

alter table shift_type_overrides enable row level security;

-- Q3: every policy below filters by the tenant first.
create index shift_type_overrides_organization_id_idx on shift_type_overrides (organization_id);

-- ONE LIVE OVERRIDE PER TEAM AND DATE, and the index every read uses. A
-- removed override leaves the key, so the date can be overridden again.
create unique index shift_type_overrides_live_team_date_key
  on shift_type_overrides (organization_id, team_id, date)
  where removed_at is null;

-- ------------------------------------------------------------------ the policies

-- Only an active admin of the token's organization reads the table: it carries
-- `created_by` and `removed_by`, auth user ids that no member-role session is
-- shown. Every member reads the live rows through the function below.
create policy shift_type_overrides_select_by_own_active_admin on public.shift_type_overrides
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

-- The only way an override is written. Every rule is one conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an active admin;
--   * the attribution, pinned to the caller;
--   * a team that is NOT ARCHIVED, and a type that is NOT ARCHIVED. That both
--     are of the same organization is the composite keys' rule, not this one's,
--     so another tenant's team or type — which this session cannot see —
--     passes here and is refused by the key (23503).
create policy shift_type_overrides_insert_by_own_active_admin on public.shift_type_overrides
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
       where team.organization_id = shift_type_overrides.organization_id
         and team.id = shift_type_overrides.team_id
         and team.archived
    )
    and not exists (
      select 1
        from public.shift_types shift_type
       where shift_type.organization_id = shift_type_overrides.organization_id
         and shift_type.id = shift_type_overrides.shift_type_id
         and shift_type.archived
    )
  );

-- ------------------------------------------------------- the writable columns

-- SUPABASE'S DEFAULT PRIVILEGES grant every table privilege to `anon` and
-- `authenticated`. A session names the five facts of an override on insert and
-- nothing else; `id`, `created_by` and `created_at` come from their defaults
-- (AD-11), and `removed_by` and `removed_at` stay null. No update and no
-- delete: there is no policy for either, and the privilege is the second lock.
-- `anon` reads and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.shift_type_overrides
  from anon, authenticated;
revoke select on table public.shift_type_overrides from anon;

grant insert (organization_id, team_id, date, shift_type_id, reason) on table public.shift_type_overrides
  to authenticated;

-- ------------------------------------------------------------- the calendar read

-- The LIVE overrides of the caller's own organization, for every active
-- member: the calendar marks each overridden cell and the day detail names its
-- author, time, reason and the projected type it replaced.
--
-- The author is named by `author_member_id`: the `members.id` of the member
-- in THIS organization whose auth user wrote the row, or null when there is
-- none. `calendar_members()` (0018) names that member. `created_by` itself —
-- an auth user id — never leaves this function, and neither does anything
-- about a removed override.
--
-- SECURITY DEFINER, because the table is readable only by an admin and
-- `members` shows a member-role caller only themselves (0011); the scope is
-- this function's WHERE clause, not the tables' policies. STABLE, for the
-- reason 0008 gives. Zero rows unless the caller is active today and the
-- token's organization is the caller's own, with the claim and helper pins
-- 0018 writes. Every month is read at once: a window by month is not this
-- story's.
create function public.calendar_shift_type_overrides()
returns table (
  id uuid,
  team_id uuid,
  date date,
  shift_type_id uuid,
  reason text,
  created_at timestamptz,
  author_member_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id,
         o.team_id,
         o.date,
         o.shift_type_id,
         o.reason,
         o.created_at,
         (
           select m.id
             from public.members m
            where m.organization_id = o.organization_id
              and m.auth_user_id = o.created_by
         )
    from public.shift_type_overrides o
   where o.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and o.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and o.removed_at is null
   order by o.team_id, o.date, o.id
$$;

-- The same explicit grants 0018 writes, for the same reason: Supabase's
-- default privileges grant EXECUTE to `anon`, `authenticated` and
-- `service_role` individually. Only a signed-in session calls this.
revoke execute on function public.calendar_shift_type_overrides() from public;
revoke execute on function public.calendar_shift_type_overrides() from anon;
revoke execute on function public.calendar_shift_type_overrides() from service_role;
grant execute on function public.calendar_shift_type_overrides() to authenticated;
