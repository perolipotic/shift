-- 0014_member_fire_rank.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Member rank, part A of "rank and team position" (human decisions
-- 2026-09-25): an organization that organises its crews by fire rank records
-- each member's rank and sees it on the team roster.
--
-- Three changes, and nothing else:
--
--   * `organizations.uses_fire_ranks`, a setting that GATES DISPLAY AND ENTRY
--     ONLY. Off, the interface offers no rank control and shows no rank; the
--     stored ranks survive, because switching a setting off must never delete
--     data.
--   * `members.fire_rank`, a fixed list of stable ASCII codes. The labels live
--     in the interface's message catalogue and nowhere here. A rank is
--     CURRENT-STATE, like a name: no history and no versions.
--   * `team_roster` replaced, its members' jsonb carrying `fire_rank` beside id
--     and name. Its signature, its scope and its grants are unchanged.
--
-- A FIXED LIST IN CORE SCHEMA, BEHIND A SETTING. Per-organization lists were
-- weighed and declined (human decision). The price of a fixed list is that it
-- is one kind of organization's vocabulary, so it sits behind a setting that
-- defaults to off: every other tenant renders exactly what it rendered before.
-- A later organization type adds its own setting rather than reusing this one.
--
-- WHY `fire_rank` AND NOT `rank`. `rank` already means role ordering in the
-- interface's navigation module, and one word must not mean two things.

-- ------------------------------------------------------------- the setting

-- NOT NULL DEFAULT FALSE. `0002:38-41` forbids a default that encodes one
-- organization's answer; false is not an answer but the absence of the
-- feature, which is what every tenant has had until now. The pilot's `true`
-- lives in seed.sql.
alter table public.organizations
  add column uses_fire_ranks boolean not null default false;

-- `uses_fire_ranks` JOINS the column grants rather than replacing them, as
-- `0005` and `0006` did: column grants are unioned, so this line adds an
-- eighth writable column and leaves the other seven — `0004`'s five, `0005`'s
-- `logo_path` and `0006`'s `brand_accent` — exactly as they were. WHO may
-- write it is `organizations_update_by_own_active_admin` (`0004`), unchanged.
grant update (uses_fire_ranks) on table public.organizations to authenticated;

-- ---------------------------------------------------------------- the rank

-- NULLABLE, and null is "no rank" rather than a missing value.
--
-- A COLUMN-LEVEL CHECK, so PostgreSQL names it `members_fire_rank_check` and a
-- value outside the list is refused with 23514 rather than stored. The list is
-- ordered lowest to highest, and `apps/web/src/members/rank.test.ts` parses it
-- out of this file and compares it to the interface's own list in both
-- directions, so the two cannot drift. Adding a code is a value here and a
-- label in the message catalogue, moving together.
--
-- `check (fire_rank in (...))` is null-tolerant by construction: null `in`
-- anything is null, which is not false, and a check refuses only on FALSE.
--
-- No grant: `members` keeps the table privileges `0002` left in place, and
-- the existing member policies (`0003`) are the whole of who writes a row —
-- an active admin of the member's own organization.
alter table public.members
  add column fire_rank text
  check (fire_rank in (
    'trainee',
    'firefighter',
    'firefighter_1',
    'nco',
    'nco_1',
    'senior_nco',
    'senior_nco_1',
    'officer',
    'officer_1',
    'senior_officer',
    'senior_officer_1'
  ));

-- -------------------------------------------------------------- the roster

-- `0011`'s function, replaced in place: same name, same argument, same return
-- columns, same definer scope. The one change is `'fire_rank', m.fire_rank`
-- in each member object.
--
-- The rank is returned WHATEVER THE SETTING SAYS. The setting gates display,
-- not disclosure: a rank is no more private than the name beside it, and a
-- reading that answered differently by setting would make the interface's
-- gate and the database's disagree about what a roster is. The interface
-- decides whether to show it.
--
-- `create or replace` keeps the function's existing grants, so the four grant
-- lines are repeated below only to state them where a review reads this file,
-- not because replacement drops them.
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
                     jsonb_build_object('id', m.id, 'name', m.name, 'fire_rank', m.fire_rank)
                     order by m.id
                   )
              from public.members m
             where m.organization_id = t.organization_id
               and public.member_team_on(m.id, today.day) = t.id
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
