-- 0018_calendar_members.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 3.4a: the roster as at a date.
--
-- The day detail lists the members of a team who were active ON A DATE, past
-- or future, not today (CAP-11, AD-2). `calendar_people()` (0017) answered
-- only the colleagues active on the organization's today, so a member
-- deactivated since could never be named on the day they worked. This
-- migration REPLACES it and changes no policy:
--
--   * `calendar_people()` is dropped. 0017 is not edited.
--   * `calendar_members()` answers the id, name and fire rank of EVERY member
--     of the caller's own organization, active or not. Nothing else leaves
--     it: no email, leave allowance, username or role. Which team each member
--     is on, with what position, and when each was active are not its
--     business either; `team_membership_versions` and `member_status_versions`
--     are already readable by any active member, and "active on a date"
--     becomes a rule in `packages/domain` over those versions.
--
-- WHAT IS NEWLY DISCLOSED to an active member-role session: the names and
-- fire ranks of colleagues who are inactive today. That is the history FR-12
-- keeps — a past shift's roster names who worked it — and the user chose it
-- (2026-09-27). The rank is shown, never used (the epic's rank rule).
--
-- WHY REPLACE, NOT ADD. One narrow read serves both the calendar's person
-- filter (which now judges "active today" itself) and the roster, so there is
-- one definer function to reason about rather than two overlapping ones.
--
-- SECURITY DEFINER, because the narrowed policy on `members` would otherwise
-- show a member-role caller only themselves; the scope is this function's
-- WHERE clause, not the table's policies.
--
-- STABLE, for the reason 0008 gives for `current_member_access()`: within one
-- statement it answers the same rows for the same caller, and nothing it
-- reaches writes.
--
-- Zero rows unless the caller is active today and the token's organization is
-- the caller's own, with the same claim and helper pins 0017 writes.
drop function public.calendar_people();

create function public.calendar_members()
returns table (id uuid, name text, fire_rank text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id,
         m.name,
         m.fire_rank
    from public.members m
   where m.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and m.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
   order by m.id
$$;

-- The same explicit grants 0008, 0010, 0011 and 0017 write, for the same
-- reason: Supabase's default privileges grant EXECUTE to `anon`,
-- `authenticated` and `service_role` individually. Only a signed-in session
-- calls this.
revoke execute on function public.calendar_members() from public;
revoke execute on function public.calendar_members() from anon;
revoke execute on function public.calendar_members() from service_role;
grant execute on function public.calendar_members() to authenticated;
