-- 0015_team_position.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Team position, part B of "rank and team position" (human decisions
-- 2026-09-25): a member's position in their team is recorded from a date and
-- shown on the team roster. `0014` shipped the setting and the rank.
--
-- THE POSITION IS PART OF THE MEMBERSHIP VERSION. A change of position is a new
-- `team_membership_versions` row from a date — the same team with a different
-- position — under `0010`'s versioning rules, unchanged: today or later, in
-- date order, at most one scheduled, cancellable only while still in the
-- future. So a promotion from next month is scheduled and can be withdrawn,
-- exactly like a move.
--
-- Five changes, and nothing else:
--
--   * `team_membership_versions.position`, a fixed list of stable ASCII codes,
--     null-tolerant, and null whenever the version names no team. The labels
--     live in the interface's message catalogue and nowhere here.
--   * `member_team_version_on(member, date)`, the one reading of team AND
--     position as at a date, in the shape of `0013`'s `shift_type_times_on`.
--   * `0010`'s insert policy ALTERED, never re-created: "changes the value" is
--     now "the team or the position differs from the latest version", and a
--     version naming a team in an organization that uses fire ranks and
--     positions must carry a position. Every other conjunct is `0010`'s, as
--     written there.
--   * the column joins the insert grant.
--   * `team_roster` replaced again, each member carrying the position in
--     effect today beside id, name and rank.
--
-- REQUIRED ONLY WHILE THE SETTING IS ON, and enforced in the policy rather than
-- by a column check: a check cannot read `organizations`, and the setting can
-- be switched on after memberships exist. Versions written before keep a null
-- position; nothing rewrites them, and the interface treats one as "choose a
-- position". No column default and no trigger.

-- ------------------------------------------------------------- the position

-- NULLABLE. `check (position in (...))` is null-tolerant by construction, as
-- `0014`'s rank check is. The list is parsed out of this file by
-- `apps/web/src/members/position.test.ts` and compared to the interface's own
-- list in both directions.
--
-- A second table check: a version that names no team names no position
-- either, because "no team from this date" has no place in one.
--
-- BOTH CHECKS ARE NAMED here rather than left to PostgreSQL's generated names,
-- and BOTH raise 23514 when refused, naming the constraint.
alter table public.team_membership_versions
  add column position text
  constraint team_membership_versions_position_code_check
  check (position in (
    'commander',
    'driver',
    'firefighter'
  ));

alter table public.team_membership_versions
  add constraint team_membership_versions_position_needs_team
    check (team_id is not null or position is null);

-- -------------------------------------------------------------- the reader

-- The team and position of a member at a date: the version with the greatest
-- `effective_from` on or before it, and NO ROW when there is none.
-- `'infinity'::date` as the date is the member's LATEST version, which the
-- insert policy's changes-the-value rule compares against. A FUNCTION, not a
-- subquery in that policy, because a policy on this table that selected from
-- it directly would recurse (42P17) — `0013`'s reason. VOLATILE PL/pgSQL,
-- SECURITY INVOKER, for the reasons `0008` and `0010` give. `"position"` is
-- quoted in the return columns because PostgreSQL does not admit that keyword
-- as a bare parameter name; everywhere else it is an ordinary column name.
create function public.member_team_version_on(member uuid, on_date date)
returns table (team_id uuid, "position" text)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return query
    select v.team_id, v.position
      from public.team_membership_versions v
     where v.member_id = member
       and v.effective_from <= on_date
     order by v.effective_from desc
     limit 1;
end;
$$;

-- `0010`'s explicit grants, for `0010`'s reason: Supabase's default privileges
-- grant EXECUTE to `anon`, `authenticated` and `service_role` individually.
revoke execute on function public.member_team_version_on(uuid, date) from public;
revoke execute on function public.member_team_version_on(uuid, date) from anon;
revoke execute on function public.member_team_version_on(uuid, date) from service_role;
grant execute on function public.member_team_version_on(uuid, date) to authenticated;

-- ------------------------------------------------------- the insert policy

-- `0010`'s WITH CHECK, conjunct for conjunct, with two changes:
--
--   * CHANGING THE VALUE — no latest version carries this team AND this
--     position. A first version has no latest one, so the reader returns no
--     row and the rule holds by itself; "no team" for a member with no
--     history is still refused by the next conjunct, `0010`'s own.
--   * A POSITION WHILE THE SETTING IS ON — a version naming a team carries a
--     position, and is admitted without one ONLY when this organization's row
--     is visible and says it does not use fire ranks and positions. FAIL
--     CLOSED: a row the session cannot read admits no null position.
--
-- ALTERED, never re-created, so the one `create policy` for this insert is
-- still `0010`'s and the policy inventories hold.
alter policy team_membership_versions_insert_by_own_active_admin on public.team_membership_versions
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
    and not exists (
      select 1
        from public.member_team_version_on(team_membership_versions.member_id, 'infinity'::date) as latest
       where latest.team_id is not distinct from team_membership_versions.team_id
         and latest.position is not distinct from team_membership_versions.position
    )
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
    and (
      team_id is null
      or position is not null
      or exists (
        select 1
          from public.organizations organization
         where organization.id = team_membership_versions.organization_id
           and not organization.uses_fire_ranks
      )
    )
  );

-- ------------------------------------------------------- the writable column

-- JOINS `0010`'s insert grant rather than replacing it: column grants are
-- unioned, so the four fact columns stay exactly as they were and this adds a
-- fifth. Attribution is still unforgeable.
grant insert (position) on table public.team_membership_versions to authenticated;

-- -------------------------------------------------------------- the roster

-- `0014`'s function, replaced in place: same name, same argument, same return
-- columns, same definer scope. The one change is `'position'` in each member
-- object: the position in effect TODAY, or null. ONE LATERAL READ of
-- `member_team_version_on` per member serves both the team filter and the
-- position, so they are read off the very same version.
--
-- Returned WHATEVER THE SETTING SAYS, for `0014`'s reason: the setting gates
-- display, not disclosure, and the interface decides whether to show it.
--
-- `create or replace` keeps the grants; they are repeated to state them here.
create or replace function public.team_roster(team uuid)
returns table (name text, archived boolean, members jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select t.name,
         t.archived,
         coalesce(
           (select jsonb_agg(
                     jsonb_build_object(
                       'id', m.id,
                       'name', m.name,
                       'fire_rank', m.fire_rank,
                       'position', today_version.position
                     )
                     order by m.id
                   )
              from public.members m
             cross join lateral public.member_team_version_on(m.id, today.day) as today_version
             where m.organization_id = t.organization_id
               and today_version.team_id = t.id
               and public.member_active_on(m.id, today.day)),
           '[]'::jsonb
         )
    from public.teams t
   cross join lateral (select public.organization_today(t.organization_id) as day) as today
   where t.id = team
     and t.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and t.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
$$;

revoke execute on function public.team_roster(uuid) from public;
revoke execute on function public.team_roster(uuid) from anon;
revoke execute on function public.team_roster(uuid) from service_role;
grant execute on function public.team_roster(uuid) to authenticated;
