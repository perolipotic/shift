-- 0065_member_schedule_inputs.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 16.2: the domain package runs on the server (AD-1 scope note, AD-7,
-- AD-19). The ONE assembly of asserted rows every server projection reads.
-- No table, no column, no trigger, no policy, and nothing derived is stored.
--
-- 1. "LIVE", STATED ONCE (AD-19). Four private helpers answer an
--    organization's live rows of the four soft-removable tables a projection
--    reads, `removed_at is null`:
--
--      * `private.live_shift_type_overrides(p_organization)`
--      * `private.live_roster_overrides(p_organization)`
--      * `private.live_team_loans(p_organization)`
--      * `private.live_leave_records(p_organization)`
--
--    The browser's four reads of those rows are re-created over them, with
--    their signatures, columns, order, pins and grants unchanged
--    (`create or replace` keeps the grants): `calendar_shift_type_overrides()`
--    (as 0022), `calendar_roster_overrides()` (as 0039), `calendar_team_loans()`
--    (as 0062) and `my_leave_records()` (as 0058). So the browser's read and
--    the server's assembly can never mean two different things by "live".
--    Each helper is STABLE SQL, SECURITY INVOKER, `search_path` emptied, and
--    executable by no role: only a definer owned by the migration role calls it.
--
-- 2. `private.member_schedule_inputs(p_member, p_from, p_to)` (AD-19):
--    SECURITY DEFINER, STABLE, `search_path` emptied, and executable by NO
--    role (`public`, `anon`, `authenticated`, `service_role` all revoked):
--    only the two definer entry points of AD-14 will call it
--    (`calendar_feed_inputs`, story 16.4; `reminder_inputs`, story 17.2). It
--    answers ONE `jsonb` already in the domain's `ScheduleInputs` shape
--    (`packages/domain/src/at-work.ts`), camelCase keys, every list in the
--    canonical order `apps/web`'s `scheduleInputsOfCalendar` writes:
--
--      * `organizationId`, `timeZone`, `memberId`;
--      * `teams`: id, name, archived — every team;
--      * `shiftTypes`: `{ type: { id, name, isWorking }, versions: [...] }`
--        for every shift type, archived ones included, each version's times
--        as whole minutes;
--      * `steps`, `assignments`, and `assignmentStamps` (each version's
--        `created_at` as integer µs);
--      * `members`: every member of the organization, active or not — id,
--        membership versions (team, position, date), status versions, and the
--        live loans overlapping the window (id, team, inclusive first and last
--        date) — and no name, rank, role, address or account;
--      * `overrides` and `rosterOverrides`: the live ones dated in the window,
--        in force or pending alike, each with `writtenAt`
--        (`confirmed_at ?? created_at`, µs), and no reason and no author;
--      * `leave`: THE member's own live leave records overlapping the window
--        — id, inclusive first and last date, `half` only when set, and the
--        absence type's id — and nobody else's, no type name, no reason.
--
--    A µs stamp is `(extract(epoch from t) * 1000000)::bigint`, exact under
--    PostgreSQL 17's numeric `extract`, the value `instantMicrosOf` gives in
--    the browser. A member that does not exist answers null. A window that is
--    null or ends before it starts is 22023 `SCHEDULE_INPUTS_WINDOW`.
--
--    Versioned rules come whole, as the browser reads them; overrides are
--    filtered by date, loans and leave by overlap (AD-19). Nothing is derived:
--    which overrides are in force, who is on which roster, and every at-work
--    shift are `packages/domain`'s (R12, `atWorkShiftsOf`).
--
-- The read-parity suite (`test/schedule-inputs-parity.test.ts`) holds this
-- assembly deep-equal to what the browser's reads yield through the adapter,
-- for every member of both fixtures, and the R12 each projects.

-- ------------------------------------------------------------ (1) live rows

create function private.live_shift_type_overrides(p_organization uuid)
returns setof public.shift_type_overrides
language sql
stable
security invoker
set search_path = ''
as $$
  select o.*
    from public.shift_type_overrides o
   where o.organization_id = p_organization
     and o.removed_at is null
$$;

create function private.live_roster_overrides(p_organization uuid)
returns setof public.roster_overrides
language sql
stable
security invoker
set search_path = ''
as $$
  select o.*
    from public.roster_overrides o
   where o.organization_id = p_organization
     and o.removed_at is null
$$;

create function private.live_team_loans(p_organization uuid)
returns setof public.team_loans
language sql
stable
security invoker
set search_path = ''
as $$
  select l.*
    from public.team_loans l
   where l.organization_id = p_organization
     and l.removed_at is null
$$;

create function private.live_leave_records(p_organization uuid)
returns setof public.leave_records
language sql
stable
security invoker
set search_path = ''
as $$
  select r.*
    from public.leave_records r
   where r.organization_id = p_organization
     and r.removed_at is null
$$;

revoke execute on function private.live_shift_type_overrides(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.live_roster_overrides(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.live_team_loans(uuid) from public, anon, authenticated, service_role;
revoke execute on function private.live_leave_records(uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------ the browser's reads, over them

-- As 0022: the claim pin, the active caller pin, the author as a member id.
create or replace function public.calendar_shift_type_overrides()
returns table (
  id uuid,
  team_id uuid,
  date date,
  shift_type_id uuid,
  reason text,
  created_at timestamptz,
  confirmed_at timestamptz,
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
         o.confirmed_at,
         (
           select m.id
             from public.members m
            where m.organization_id = o.organization_id
              and m.auth_user_id = o.created_by
         )
    from private.live_shift_type_overrides(nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid) o
   where o.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
   order by o.team_id, o.date, o.id
$$;

-- As 0039.
create or replace function public.calendar_roster_overrides()
returns table (
  id uuid,
  team_id uuid,
  date date,
  member_out_id uuid,
  member_in_id uuid,
  reason text,
  created_at timestamptz,
  confirmed_at timestamptz,
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
         o.confirmed_at,
         (
           select m.id
             from public.members m
            where m.organization_id = o.organization_id
              and m.auth_user_id = o.created_by
         )
    from private.live_roster_overrides(nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid) o
   where o.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
   order by o.team_id, o.date, o.id
$$;

-- As 0062: no reason, no author.
create or replace function public.calendar_team_loans()
returns table (
  id uuid,
  member_id uuid,
  team_id uuid,
  starts_on date,
  ends_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id,
         l.member_id,
         l.team_id,
         lower(l.during),
         upper(l.during) - 1
    from private.live_team_loans(nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid) l
   where l.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
   order by l.member_id, lower(l.during), l.id
$$;

-- As 0058: the caller's own live records, with the type's drawing flag and the half.
create or replace function public.my_leave_records()
returns table (
  id uuid,
  member_id uuid,
  during daterange,
  absence_type_id uuid,
  draws_allowance boolean,
  half text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         r.member_id,
         r.during,
         r.absence_type_id,
         t.draws_allowance,
         r.half
    from private.live_leave_records(nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid) r
    join public.members m
      on m.organization_id = r.organization_id
     and m.id = r.member_id
    join public.absence_types t
      on t.organization_id = r.organization_id
     and t.id = r.absence_type_id
   where r.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and m.auth_user_id = (select auth.uid())
   order by r.during, r.id
$$;

-- -------------------------------------------------------- (2) the assembly

create function private.member_schedule_inputs(p_member uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization uuid;
  v_zone text;
  v_window daterange;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception using errcode = 'invalid_parameter_value', message = 'SCHEDULE_INPUTS_WINDOW';
  end if;

  select m.organization_id, o.timezone
    into v_organization, v_zone
    from public.members m
    join public.organizations o on o.id = m.organization_id
   where m.id = p_member;

  if v_organization is null then
    return null;
  end if;

  v_window := daterange(p_from, p_to, '[]');

  return jsonb_build_object(
    'organizationId', v_organization,
    'timeZone', v_zone,
    'memberId', p_member,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'archived', t.archived) order by t.id)
        from public.teams t
       where t.organization_id = v_organization
    ), '[]'::jsonb),
    'shiftTypes', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'type', jsonb_build_object('id', s.id, 'name', s.name, 'isWorking', s.is_working),
                 'versions', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'shiftTypeId', v.shift_type_id,
                              'effectiveFrom', v.effective_from,
                              'startMinute', (extract(hour from v.start_time) * 60 + extract(minute from v.start_time))::integer,
                              'endMinute', (extract(hour from v.end_time) * 60 + extract(minute from v.end_time))::integer
                            )
                            order by v.effective_from
                          )
                     from public.shift_type_versions v
                    where v.organization_id = v_organization
                      and v.shift_type_id = s.id
                 ), '[]'::jsonb)
               )
               order by s.id
             )
        from public.shift_types s
       where s.organization_id = v_organization
    ), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', st.id, 'patternId', st.pattern_id, 'position', st.position, 'shiftTypeId', st.shift_type_id)
               order by st.id
             )
        from public.rotation_steps st
       where st.organization_id = v_organization
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'teamId', a.team_id,
                 'patternId', a.pattern_id,
                 'offsetStepId', a.offset_step_id,
                 'anchorDate', a.anchor_date,
                 'effectiveFrom', a.effective_from
               )
               order by a.team_id, a.effective_from
             )
        from public.rotation_assignments a
       where a.organization_id = v_organization
    ), '[]'::jsonb),
    'assignmentStamps', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'teamId', a.team_id,
                 'effectiveFrom', a.effective_from,
                 'createdAt', (extract(epoch from a.created_at) * 1000000)::bigint
               )
               order by a.team_id, a.effective_from
             )
        from public.rotation_assignments a
       where a.organization_id = v_organization
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', m.id,
                 'memberships', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('teamId', tv.team_id, 'position', tv.position, 'effectiveFrom', tv.effective_from)
                            order by tv.effective_from
                          )
                     from public.team_membership_versions tv
                    where tv.organization_id = v_organization
                      and tv.member_id = m.id
                 ), '[]'::jsonb),
                 'statuses', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('active', sv.active, 'effectiveFrom', sv.effective_from)
                            order by sv.effective_from
                          )
                     from public.member_status_versions sv
                    where sv.organization_id = v_organization
                      and sv.member_id = m.id
                 ), '[]'::jsonb),
                 'loans', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('id', l.id, 'teamId', l.team_id, 'from', lower(l.during), 'to', upper(l.during) - 1)
                            order by lower(l.during), l.id
                          )
                     from private.live_team_loans(v_organization) l
                    where l.member_id = m.id
                      and l.during && v_window
                 ), '[]'::jsonb)
               )
               order by m.id
             )
        from public.members m
       where m.organization_id = v_organization
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', o.id,
                 'teamId', o.team_id,
                 'date', o.date,
                 'shiftTypeId', o.shift_type_id,
                 'writtenAt', (extract(epoch from coalesce(o.confirmed_at, o.created_at)) * 1000000)::bigint
               )
               order by o.id
             )
        from private.live_shift_type_overrides(v_organization) o
       where o.date between p_from and p_to
    ), '[]'::jsonb),
    'rosterOverrides', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', o.id,
                 'teamId', o.team_id,
                 'date', o.date,
                 'memberOutId', o.member_out_id,
                 'memberInId', o.member_in_id,
                 'writtenAt', (extract(epoch from coalesce(o.confirmed_at, o.created_at)) * 1000000)::bigint
               )
               order by o.id
             )
        from private.live_roster_overrides(v_organization) o
       where o.date between p_from and p_to
    ), '[]'::jsonb),
    'leave', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', r.id,
                 'from', lower(r.during),
                 'to', upper(r.during) - 1,
                 'absenceTypeId', r.absence_type_id
               )
               || case when r.half is null then '{}'::jsonb else jsonb_build_object('half', r.half) end
               order by lower(r.during), r.id
             )
        from private.live_leave_records(v_organization) r
       where r.member_id = p_member
         and r.during && v_window
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function private.member_schedule_inputs(uuid, date, date) from public, anon, authenticated, service_role;
