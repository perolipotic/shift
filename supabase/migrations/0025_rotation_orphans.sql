-- 0025_rotation_orphans.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- A never-assigned rotation pattern can be removed, the rotation read is
-- bounded, and moving the anchor by whole cycles changes nothing.
--
-- THREE GAPS 0016 LEFT, each closed below.
--
--   1. ORPHAN PATTERNS. 0016's save is not atomic, by decision (2026-09-25):
--      a failure after the pattern's insert leaves a pattern, possibly with
--      steps, that no team stands on. 0016 revoked delete on both tables, so
--      no session could remove one, and a wrong step added before the first
--      assignment could not be taken back.
--   2. AN UNBOUNDED READ. The builder's one read embedded every step and every
--      assignment the organization ever had, so it grew with every save.
--   3. A LITERAL "CHANGES THE VALUE" RULE. 0016's insert policy compared the
--      pattern, the offset step and the anchor as they are written, so moving
--      the anchor by a whole number of cycles, on the same pattern and step,
--      wrote a version that projects exactly the same shifts.
--
-- WHAT DOES NOT CHANGE. No update grant and no update policy on patterns or
-- steps: they stay immutable. No stored row is rewritten, so nothing projects
-- differently on any date. The save stays three writes, not atomic.
--
-- IDEMPOTENT: `drop policy if exists` before each new policy, `alter policy`
-- for the changed one, `create or replace` for the functions, and grants and
-- revokes are no-ops when repeated.

-- ------------------------------------------------ 1. removing a never-assigned pattern

-- "REFERENCED" IS ANY ASSIGNMENT, IN ANY VERSION: `rotation_pattern_in_use`
-- (0016), the same reader that already refuses a step insert once a team
-- stands on the pattern. Past, in force, scheduled or cancelled-and-gone: only
-- rows that exist count, so a scheduled version cancelled through 0016's
-- delete policy leaves its pattern removable again, which projects nothing.
--
-- TWO LOCKS ON A PATTERN, as on every rule here:
--
--   * the policy: a delete of a referenced pattern, or of a step of one,
--     matches no row, so it removes nothing and answers zero rows (as a
--     refused cancellation does in 0016);
--   * the keys: `rotation_assignments_pattern_fkey` is NO ACTION, so a delete
--     of a pattern an assignment names fails with 23503 whatever any policy
--     says, and an assignment committed while the delete waited is caught by
--     the key's check at the end of the statement. A referenced pattern is
--     therefore never removed, concurrently or not.
--
-- THE STEPS FIRST. `rotation_steps_pattern_fkey` does not cascade (0016's
-- reason: history must not vanish), so a pattern that still has steps is
-- refused by that key (23503). The builder's cleanup deletes the steps, then
-- the pattern.
--
-- KNOWN GAP, 0016's own, now covering delete as well as insert: under READ
-- COMMITTED a step delete and a concurrent FIRST assignment of the same
-- pattern can both pass. The assignment's offset key locks its own step, so
-- that step is never removed; another step of the pattern can be. The
-- deferred-work entry this story adds (rotation writes are not serialized per
-- organization) records it.
--
-- Both policies pin the tenant from the claim and re-read the caller through
-- the fresh helper as an ACTIVE ADMIN, as every rotation write policy does. A
-- member-role session, a deactivated admin and another tenant's admin match
-- no row.

drop policy if exists rotation_patterns_delete_unassigned_by_own_active_admin on public.rotation_patterns;
create policy rotation_patterns_delete_unassigned_by_own_active_admin on public.rotation_patterns
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
    and not public.rotation_pattern_in_use(id)
  );

drop policy if exists rotation_steps_delete_unassigned_by_own_active_admin on public.rotation_steps;
create policy rotation_steps_delete_unassigned_by_own_active_admin on public.rotation_steps
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
    and not public.rotation_pattern_in_use(pattern_id)
  );

-- The privilege the policies above narrow. Delete only: update stays revoked
-- on both tables (0016), so neither is ever edited.
grant delete on table public.rotation_patterns to authenticated;
grant delete on table public.rotation_steps to authenticated;

-- ------------------------------------------- 3. whole cycles are the same value

-- 0016's insert policy, conjunct for conjunct, with ONE change: an assignment
-- is the latest version's value when it has the same pattern, the same offset
-- step, and an anchor that differs from the latest one's by a WHOLE MULTIPLE
-- OF THE PATTERN'S CYCLE LENGTH IN DAYS — the number of its steps, as
-- `packages/domain`'s projection counts it. Every date then projects the same
-- step, so such a version changes nothing, and it is refused as a literal
-- no-op is (42501). A difference of zero is a multiple, so the literal no-op
-- is still refused. This rule guards DIRECT API callers: the builder always
-- saves a fresh pattern, so its versions never share this one's pattern, and
-- its own no-op is caught before anything is sent by its preflight
-- (`draftUnchangedOf`), which judges by projection.
--
-- THE COUNT is of the pattern's steps as this session sees them, which is all
-- of them: the insert is an active admin's of this organization. Steps of a
-- pattern a team stands on are fixed (0016), so the count cannot move under
-- the latest version. `nullif(…, 0)` keeps a pattern with no step visible —
-- one the offset key refuses anyway — from dividing by zero: the conjunct is
-- then unknown, the `exists` finds no row, and the key decides.
alter policy rotation_assignments_insert_by_own_active_admin on public.rotation_assignments
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
         and (rotation_assignments.anchor_date - latest.anchor_date) % nullif((
               select count(*)::integer
                 from public.rotation_steps step
                where step.organization_id = rotation_assignments.organization_id
                  and step.pattern_id = rotation_assignments.pattern_id
             ), 0) = 0
    )
    and exists (
      select 1
        from public.teams team
       where team.organization_id = rotation_assignments.organization_id
         and team.id = rotation_assignments.team_id
         and not team.archived
    )
  );

-- --------------------------------------------------------- 2. the bounded read

-- Three COMPUTED RELATIONSHIPS PostgREST embeds from `organizations`, as the
-- builder's one read does (`@/features/rotation/services/list`): each takes an
-- organization row and returns rows of the table it bounds, so the read keeps
-- its one request and its one query key.
--
-- SECURITY INVOKER, STABLE SQL, `search_path` emptied: every row still passes
-- the table's own select policy as the caller, so a function answers nothing
-- the plain embed would not. The organization is only the row PostgREST hands
-- over; the tenant is the policies'.
--
-- PENDING, the rule of story 3.5c (`overrideStandingOf` in `packages/domain`):
-- a live override is pending when no version of its team governs its date, or
-- when the version governing it — the one with the greatest `effective_from`
-- on or before the date — was saved after `coalesce(confirmed_at,
-- created_at)`. Every other live override is in force, and the builder reads
-- none of those: it lists only the pending ones.
--
-- THE SELECTION, per team:
--
--   * THE HORIZON is the organization's YESTERDAY, or the date of the team's
--     earliest PENDING override that a version governs, when that is earlier.
--     A DAY OF MARGIN: the builder's "today" is the device clock read in the
--     organization's zone, so a device a few minutes behind at midnight is
--     still on yesterday — and finds the version in force then. The overrides
--     are an active admin's alone to read (0019), and the builder is an
--     admin's; for any other caller the horizon is yesterday.
--   * An ASSIGNMENT is kept when it is in force on the horizon or starts
--     after it: no later version of its team starts on or before the horizon.
--     So the versions in force yesterday and today and the one scheduled after
--     them are always kept, and so is every version that governs a pending
--     override's date.
--   * A STEP is kept when its pattern is named by a kept assignment, or by no
--     assignment at all — a pattern not yet assigned, which the builder's
--     cleanup may still remove.
--   * An OVERRIDE is kept when it is live and pending.
--
-- WHY PENDING OVERRIDES MOVE THE HORIZON, and nothing else does: story 3.5c
-- lists a pending override beside the type the rotation projects on its
-- date, which may lie before yesterday and under an older version. Dropping
-- that version would show such an override as governed by nothing. An
-- override in force is never read, and a pending one no version governs is
-- governed by nothing in any selection, so neither keeps a version. A future
-- override's date is later than yesterday, so `least` ignores it. Once an
-- admin confirms, amends or discards it, the horizon moves up again.
--
-- WHAT IS NOT BOUNDED, and why: the rotation HISTORY (story 2.6, `Povijest
-- rotacije`) lists every saved change, the previous ones included, and 3.5c
-- decides which overrides are pending from every version's save time. Both
-- read only the attribution columns of `rotation_assignments` (id, team,
-- pattern, effective date, author, save time), never a step, so the read
-- still embeds those columns of every version, and nothing else of them.
--
-- The calendar's own read (`CALENDAR_KEY`) projects any month, past ones
-- included, and does not use these.

create or replace function public.rotation_assignments_in_view(public.organizations)
returns setof public.rotation_assignments
language sql
stable
security invoker
set search_path = ''
as $$
  select a.*
    from public.rotation_assignments a
   where a.organization_id = ($1).id
     and not exists (
       select 1
         from public.rotation_assignments later
        where later.team_id = a.team_id
          and later.effective_from > a.effective_from
          and later.effective_from <= least(
                public.organization_today(($1).id) - 1,
                (
                  select min(o.date)
                    from public.shift_type_overrides o
                   where o.organization_id = ($1).id
                     and o.team_id = a.team_id
                     and o.removed_at is null
                     and (
                       select governing.created_at
                         from public.rotation_assignments governing
                        where governing.team_id = o.team_id
                          and governing.effective_from <= o.date
                        order by governing.effective_from desc
                        limit 1
                     ) > coalesce(o.confirmed_at, o.created_at)
                )
              )
     )
$$;

create or replace function public.rotation_steps_in_view(public.organizations)
returns setof public.rotation_steps
language sql
stable
security invoker
set search_path = ''
as $$
  select s.*
    from public.rotation_steps s
   where s.organization_id = ($1).id
     and (
       s.pattern_id in (select kept.pattern_id from public.rotation_assignments_in_view($1) as kept)
       or not exists (
         select 1
           from public.rotation_assignments a
          where a.organization_id = s.organization_id
            and a.pattern_id = s.pattern_id
       )
     )
$$;

-- A pending override no version governs is kept too: the admin still
-- disposes of it (discard), and `coalesce(…, true)` keeps it.
create or replace function public.rotation_overrides_in_view(public.organizations)
returns setof public.shift_type_overrides
language sql
stable
security invoker
set search_path = ''
as $$
  select o.*
    from public.shift_type_overrides o
   where o.organization_id = ($1).id
     and o.removed_at is null
     and coalesce(
           (
             select governing.created_at
               from public.rotation_assignments governing
              where governing.team_id = o.team_id
                and governing.effective_from <= o.date
              order by governing.effective_from desc
              limit 1
           ) > coalesce(o.confirmed_at, o.created_at),
           true
         )
$$;

-- The explicit grants every reader here writes: `authenticated` keeps EXECUTE
-- because PostgREST calls each as the request role; `anon` and `service_role`
-- have no read that needs any.
revoke execute on function public.rotation_assignments_in_view(public.organizations) from public;
revoke execute on function public.rotation_assignments_in_view(public.organizations) from anon;
revoke execute on function public.rotation_assignments_in_view(public.organizations) from service_role;
grant execute on function public.rotation_assignments_in_view(public.organizations) to authenticated;

revoke execute on function public.rotation_steps_in_view(public.organizations) from public;
revoke execute on function public.rotation_steps_in_view(public.organizations) from anon;
revoke execute on function public.rotation_steps_in_view(public.organizations) from service_role;
grant execute on function public.rotation_steps_in_view(public.organizations) to authenticated;

revoke execute on function public.rotation_overrides_in_view(public.organizations) from public;
revoke execute on function public.rotation_overrides_in_view(public.organizations) from anon;
revoke execute on function public.rotation_overrides_in_view(public.organizations) from service_role;
grant execute on function public.rotation_overrides_in_view(public.organizations) to authenticated;
