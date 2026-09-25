-- 0011_team_roster.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 1.8: a member sees who is on a team.
--
-- CAP-5 says the roster carries names and membership only, and that the
-- database, not the interface, enforces it. Until now 0003's select policy on
-- `members` let a member-role session read every colleague's row whole —
-- email, leave allowance, username and role included — through PostgREST.
-- This migration closes that and opens the one narrow reading the roster needs:
--
--   * `members_select_own_organization` is ALTERED, never re-created, and 0003
--     is untouched. Its tenant pins stay as they were, and one conjunct is
--     added: an active ADMIN still reads the whole organization, and anyone
--     else reads exactly their own row. The own row is what the navigation's
--     role read and the Danas line are made of.
--   * `team_roster(team)` is the only way a member-role session learns who else
--     is on a team: the team's name, whether it is archived, and today's active
--     members as id and name, and nothing more.
--
-- WHY A FUNCTION AND NOT A VIEW. A view over `members` either runs as the
-- querying role, and then inherits the narrowed policy and shows a member only
-- themselves, or runs as its owner and then bypasses RLS for every column the
-- view names, with its scope written nowhere a review would look. The function
-- states its own scope in its body: an active caller, their own organization,
-- one team, id and name only.

-- ------------------------------------------------------------ the select policy

-- 0003's USING, unchanged, and one more conjunct. `current_member_access()` is
-- SECURITY DEFINER, so reading the caller's role through it is no recursion on
-- this table. The role is the fresh one, not the token's claim, exactly as
-- every write policy reads it.
alter policy members_select_own_organization on public.members
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and (
      exists (
        select 1
          from public.current_member_access() as access
         where access.member_role = 'admin'
      )
      or auth_user_id = (select auth.uid())
    )
  );

-- ------------------------------------------------------------------ the roster

-- Who is on a team today: one row of the team's name, its archived flag and a
-- jsonb array of `{id, name}` for every member on it today and active today,
-- both read in the ORGANIZATION's zone. Scheduled joiners are not on it yet and
-- inactive members are not on it at all. Zero rows unless the caller is active
-- today and the team belongs to the caller's own organization.
--
-- WHY THE `team` ARGUMENT DISCLOSES NOTHING. A team of the caller's own
-- organization is already readable to them through `teams_select_own_organization`,
-- which admits any active member, so its name and archived flag are no news. A
-- team of another organization and an id that never existed both answer zero
-- rows, identically, so the argument is no oracle for which ids exist
-- elsewhere. What IS new — the names of colleagues — is the disclosure CAP-5
-- sanctions, and it is limited to id and name: no email, allowance, username or
-- role ever leaves this function.
--
-- SECURITY DEFINER, because the narrowed policy above would otherwise show a
-- member-role caller only themselves. The readers it calls are INVOKER and so
-- run as the owner here, which is what lets them read every member's versions;
-- the scope is this function's own WHERE clause, not the tables' policies.
--
-- STABLE, THOUGH IT CALLS VOLATILE READERS, for the reason 0008 gives for
-- `current_member_access()`: within one statement it answers the same row for
-- the same caller, and nothing it reaches writes.
create function public.team_roster(team uuid)
returns table (name text, archived boolean, members jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select t.name,
         t.archived,
         coalesce(
           (select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.id)
              from public.members m
             where m.organization_id = t.organization_id
               and public.member_team_on(m.id, today.day) = t.id
               and public.member_active_on(m.id, today.day)),
           '[]'::jsonb
         )
    from public.teams t
   -- The organization's today, read ONCE per team row and used by both
   -- predicates, so every member is judged against the same date.
   cross join lateral (select public.organization_today(t.organization_id) as day) as today
   where t.id = team
     and t.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and t.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
$$;

-- The same explicit grants 0008 and 0010 write, for the same reason: Supabase's
-- default privileges grant EXECUTE to `anon`, `authenticated` and
-- `service_role` individually. Only a signed-in session calls this.
revoke execute on function public.team_roster(uuid) from public;
revoke execute on function public.team_roster(uuid) from anon;
revoke execute on function public.team_roster(uuid) from service_role;
grant execute on function public.team_roster(uuid) to authenticated;
