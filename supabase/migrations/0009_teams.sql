-- 0009_teams.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 1.7a: an admin creates, renames and archives teams.
--
-- AD-2 classifies team MEMBERSHIP as versioned, not the team itself, so this is
-- a current-state table: one row per team, its name edited in place. Membership
-- is story 1.7b's and points here through the composite key below.
--
--   * ANY COUNT. Nothing here knows how many teams an organization runs, and
--     nothing branches on what one is called: a name is a label an admin chose,
--     never a key the schema or the product reads meaning into (DI-8).
--   * REMOVAL ARCHIVES. There is no delete policy and the delete privilege is
--     revoked, so a team that later carries history can never vanish from under
--     it. `archived` is one-way: the update policy's USING admits only a row
--     that is not archived, so an archived team can be neither renamed nor
--     brought back — the row is frozen as it was on the day it was archived.
--   * THE NAME is non-blank and unique per organization, case-insensitively,
--     among teams that are NOT archived. The partial index is what lets an
--     archived team's name be taken again by a new team.
--
-- No trigger and no function: every rule is a check, an index, a policy or a
-- grant.

create table teams (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  name text not null,

  -- A flag, not an instant: `timestamptz` in this schema is reserved for
  -- `created_at`, and nothing reads when a team was archived — only whether.
  archived boolean not null default false,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the insert policy pins `created_by` as
  -- well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- The client trims; this refuses a name that is nothing but whitespace from
  -- any caller at all.
  constraint teams_name_not_blank check (btrim(name) <> ''),

  -- The target of 1.7b's composite foreign key, so a membership naming another
  -- tenant's team is unrepresentable rather than merely refused by a policy.
  constraint teams_organization_id_id_key unique (organization_id, id)
);

alter table teams enable row level security;

-- Q3: every policy below filters by the tenant first. The composite unique
-- index above leads with it too, but this is the index the policies are
-- written against, kept separate so the key above can change without taking it.
create index teams_organization_id_idx on teams (organization_id);

-- Case-insensitive per organization, as `members_organization_username_key`
-- (0007) is, and PARTIAL: only teams still in use compete for a name, so an
-- archived one never blocks its name being reused. Trimmed inside the index as
-- well, so a caller that skips the client's trim cannot slip a padded duplicate
-- past it.
create unique index teams_organization_name_key
  on teams (organization_id, lower(btrim(name)))
  where not archived;

-- ------------------------------------------------------------- the policies

-- Every active member reads their own organization's teams, archived ones
-- included: an archived team is still the team some past day was worked by.
create policy teams_select_own_organization on public.teams
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
create policy teams_insert_by_own_active_admin on public.teams
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

-- Rename and archive. USING reaches only a team of the caller's organization
-- that is NOT archived, which is the whole of "archiving is one-way": an
-- archived row matches no update at all, so it cannot be renamed and
-- `archived = false` cannot be written back to it. WITH CHECK pins the tenant
-- so a reachable row cannot be moved to another one, for the reason 0003 gives
-- on `members_update_by_own_active_admin`.
create policy teams_update_by_own_active_admin on public.teams
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
  );

-- ------------------------------------------------------- the writable columns

-- A session names a team's tenant and name on insert, and changes its name or
-- archives it on update; nothing else. `id`, `created_by` and `created_at` come
-- from their defaults (AD-11). The grant is the column rule, the policy the row
-- rule.
--
-- SUPABASE'S DEFAULT PRIVILEGES grant every table privilege to `anon` and
-- `authenticated`. Delete is revoked outright — there is no delete policy, and
-- the privilege is the second lock on the verb that destroys rather than
-- discloses. No session truncates, references or triggers on this table, and
-- `anon` reads and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.teams
  from anon, authenticated;
revoke select on table public.teams from anon;

grant insert (organization_id, name) on table public.teams to authenticated;
grant update (name, archived) on table public.teams to authenticated;
