-- 0026_roster_overrides.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 3.6a: a roster override is recorded and shown.
--
-- One table. `roster_overrides` records that ON ONE DATE a member was TAKEN
-- OFF a team's shift, a member was PUT ON it, or both at once — a
-- replacement, one row, so it is atomic without a function (CAP-12). It is the
-- exception layer the roster applies OVER the default roster in
-- `packages/domain` (`rosterOn`); nothing here writes, reads or refers to a
-- rotation, membership or status row, so those are byte-identical before and
-- after any roster override (DI-2). Removing one restores the default roster
-- exactly.
--
--   * ONE ROW PER ACTION. `member_out_id` is taken off, `member_in_id` is put
--     on; either may be null, never both, and never the same member. A member
--     may be put on a shift of a team that is not theirs, on a day their own
--     team is off.
--   * WHETHER IT APPLIES is the domain's question, never refused here: only on
--     a working shift, only when the member taken off is on its default roster
--     and the member put on is not. Anything else is inert — a stale override
--     leaves the shift unchanged rather than wrong.
--   * A REASON IS REQUIRED, 1–200 characters once surrounding white space is
--     trimmed, exactly as 0019 checks it.
--   * ATTRIBUTED (AD-11): `created_by` and `created_at` come from defaults the
--     client cannot forge, and the insert policy pins `created_by` as well.
--   * SOFT-REMOVED. `removed_by` and `removed_at` exist now, both null or both
--     set, but no session sets them: there is no update or delete grant. How a
--     removal is attributed is story 3.6b's, as 0021 was 3.5b's. The partial
--     unique keys and the calendar read below already honour them: ONE LIVE
--     OVERRIDE PER TEAM, DATE AND MEMBER TAKEN OFF, and one per team, date and
--     member put on.
--   * PENDING is derived, not stored (story 3.5c's rule): an override whose
--     governing rotation version was saved after it was written is not
--     applied. Its `created_at` is when it was written; there is no confirm
--     column, and the builder's disposition of roster overrides is not this
--     story's.
--
-- WHO READS WHAT, as 0019: the table is readable and insertable only by an
-- ACTIVE ADMIN of the token's organization, and every active member reads the
-- LIVE rows through `calendar_roster_overrides()` below, which names the
-- author by their `members.id` — never by `auth_user_id`.
--
-- Every rule is a WITH CHECK clause, a key, a check or a grant, so a refused
-- insert arrives as 42501 (or as 23502, 23503, 23505 or 23514).
--
-- No trigger. In this story only seeds and fixtures write roster overrides;
-- the admin's form and the removal are story 3.6b's.

create table roster_overrides (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  team_id uuid not null,

  -- A date, never an instant: the civil day of the team's shift.
  date date not null,

  -- Taken off the shift; null for an addition alone.
  member_out_id uuid,

  -- Put on the shift; null for a removal alone.
  member_in_id uuid,

  reason text not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the insert policy pins `created_by` as
  -- well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- The removal, set together or not at all. No session holds a privilege on
  -- either; story 3.6b decides how they are written.
  removed_by uuid,
  removed_at timestamptz,

  -- To 0009's unique (organization_id, id), so an override naming another
  -- tenant's team is unrepresentable. NO cascade: the record must outlive
  -- what it changed.
  constraint roster_overrides_team_fkey
    foreign key (organization_id, team_id)
    references teams (organization_id, id),

  -- To 0002's unique (organization_id, id), so an override naming another
  -- tenant's member is unrepresentable. NO cascade, for the same reason: a
  -- member a live or removed override names is not deleted from under it.
  constraint roster_overrides_member_out_fkey
    foreign key (organization_id, member_out_id)
    references members (organization_id, id),

  constraint roster_overrides_member_in_fkey
    foreign key (organization_id, member_in_id)
    references members (organization_id, id),

  -- Finite and in years 0001–9999, for the reason 0016 gives.
  constraint roster_overrides_date_finite
    check (isfinite(date) and date >= date '0001-01-01' and date < date '10000-01-01'),

  constraint roster_overrides_reason_length
    check (char_length(regexp_replace(reason, '^[[:space:]]+|[[:space:]]+$', '', 'g')) between 1 and 200),

  constraint roster_overrides_removal_complete
    check ((removed_by is null) = (removed_at is null)),

  -- A member taken off, put on, or both: never neither.
  constraint roster_overrides_member_present
    check (member_out_id is not null or member_in_id is not null),

  -- A replacement names two members. `is distinct from` is true when one is
  -- null, so an addition or a removal alone passes.
  constraint roster_overrides_members_distinct
    check (member_out_id is distinct from member_in_id)
);

alter table roster_overrides enable row level security;

-- Q3: every policy below filters by the tenant first.
create index roster_overrides_organization_id_idx on roster_overrides (organization_id);

-- ONE LIVE OVERRIDE PER TEAM, DATE AND MEMBER TAKEN OFF, and one per member put
-- on: a member is taken off one shift once, and put on it once. A removed
-- override leaves both keys. Rows with a null member are not keyed by it.
create unique index roster_overrides_live_member_out_key
  on roster_overrides (organization_id, team_id, date, member_out_id)
  where removed_at is null;

create unique index roster_overrides_live_member_in_key
  on roster_overrides (organization_id, team_id, date, member_in_id)
  where removed_at is null;

-- ------------------------------------------------------------------ the policies

-- Only an active admin of the token's organization reads the table: it carries
-- `created_by` and `removed_by`, auth user ids that no member-role session is
-- shown. Every member reads the live rows through the function below.
create policy roster_overrides_select_by_own_active_admin on public.roster_overrides
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

-- The only way a roster override is written. Every rule is one conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an active admin;
--   * the attribution, pinned to the caller;
--   * a team that is NOT ARCHIVED. That the team and both members are of the
--     same organization is the composite keys' rule, not this one's, so
--     another tenant's team or member — which this session cannot see — passes
--     here and is refused by the key (23503).
create policy roster_overrides_insert_by_own_active_admin on public.roster_overrides
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
       where team.organization_id = roster_overrides.organization_id
         and team.id = roster_overrides.team_id
         and team.archived
    )
  );

-- ------------------------------------------------------- the writable columns

-- As 0019: Supabase's default privileges grant every table privilege to `anon`
-- and `authenticated`. A session names the six facts of a roster override on
-- insert and nothing else; `id`, `created_by` and `created_at` come from their
-- defaults (AD-11), and `removed_by` and `removed_at` stay null. No update and
-- no delete: there is no policy for either, and the privilege is the second
-- lock. `anon` reads and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.roster_overrides
  from anon, authenticated;
revoke select on table public.roster_overrides from anon;

grant insert (organization_id, team_id, date, member_out_id, member_in_id, reason) on table public.roster_overrides
  to authenticated;

-- ------------------------------------------------------------- the calendar read

-- The LIVE roster overrides of the caller's own organization, for every active
-- member: the calendar marks each changed shift, the day detail lists each
-- change with its author, time and reason, and a member's month follows the
-- shifts they were taken off or put on.
--
-- Shaped as 0022's `calendar_shift_type_overrides()`, and pinned the same way:
-- SECURITY DEFINER and STABLE with an empty search_path; zero rows unless the
-- caller is active and the token's organization is the caller's own. The
-- author is `author_member_id`, the `members.id` of the member in THIS
-- organization whose auth user wrote the row, or null. `created_by` itself —
-- an auth user id — never leaves this function, and neither does anything
-- about a removed override.
create function public.calendar_roster_overrides()
returns table (
  id uuid,
  team_id uuid,
  date date,
  member_out_id uuid,
  member_in_id uuid,
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
         o.member_out_id,
         o.member_in_id,
         o.reason,
         o.created_at,
         (
           select m.id
             from public.members m
            where m.organization_id = o.organization_id
              and m.auth_user_id = o.created_by
         )
    from public.roster_overrides o
   where o.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and o.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and o.removed_at is null
   order by o.team_id, o.date, o.id
$$;

-- The same explicit grants 0018 and 0019 write: Supabase's default privileges
-- grant EXECUTE to `anon`, `authenticated` and `service_role` individually.
-- Only a signed-in session calls this.
revoke execute on function public.calendar_roster_overrides() from public;
revoke execute on function public.calendar_roster_overrides() from anon;
revoke execute on function public.calendar_roster_overrides() from service_role;
grant execute on function public.calendar_roster_overrides() to authenticated;
