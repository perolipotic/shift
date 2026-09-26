-- 0017_calendar_people.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 3.3b: the calendar filters to one person.
--
-- Since 0011 a member-role session reads exactly its own `members` row, so the
-- calendar cannot name a colleague to filter by. This migration opens the one
-- narrow reading the filter needs and changes no policy:
--
--   * `calendar_people()` answers the id and name of every member of the
--     caller's own organization who is active on the organization's today.
--     Nothing else leaves it: no email, leave allowance, username, role, rank
--     or position. Which team each person is on is not its business either;
--     `team_membership_versions` is already readable by any active member.
--
-- WHY A FUNCTION AND NOT A POLICY CHANGE. Widening `members` select would hand
-- every column of every colleague to a member-role session through PostgREST.
-- `team_roster` (0011) set the precedent this follows: a SECURITY DEFINER
-- function whose own WHERE clause is its scope, and id and name its only
-- output. What it discloses — the names of today's active colleagues — is what
-- `team_roster` already discloses team by team, now read organization-wide.
--
-- SECURITY DEFINER, because the narrowed policy on `members` would otherwise
-- show a member-role caller only themselves. The readers it calls are INVOKER
-- and so run as the owner here, which is what lets them read every member's
-- status versions; the scope is this function's WHERE clause, not the tables'
-- policies.
--
-- STABLE, THOUGH IT CALLS VOLATILE READERS, for the reason 0008 gives for
-- `current_member_access()`: within one statement it answers the same rows for
-- the same caller, and nothing it reaches writes.
--
-- Zero rows unless the caller is active today and the token's organization is
-- the caller's own, with the same claim and helper pins `team_roster` writes.
create function public.calendar_people()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id,
         m.name
    from public.members m
   -- The organization's today, read ONCE per member row and judged the same
   -- way for every member.
   cross join lateral (select public.organization_today(m.organization_id) as day) as today
   where m.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and m.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and public.member_active_on(m.id, today.day)
   order by m.id
$$;

-- The same explicit grants 0008, 0010 and 0011 write, for the same reason:
-- Supabase's default privileges grant EXECUTE to `anon`, `authenticated` and
-- `service_role` individually. Only a signed-in session calls this.
revoke execute on function public.calendar_people() from public;
revoke execute on function public.calendar_people() from anon;
revoke execute on function public.calendar_people() from service_role;
grant execute on function public.calendar_people() to authenticated;
