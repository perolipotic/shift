-- 0037_team_archive_without_rotation_refusal.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- A team archives as it did before 0036.
--
-- 0036 refused archiving a team with a rotation version in force or scheduled
-- (23514 `TEAM_IN_ROTATION`). No version ends a team's rotation
-- (`offset_step_id` is not null, and there is no "no rotation" state), so the
-- rule made every team that had ever had a rotation impossible to archive.
-- That is a regression, and it is withdrawn until a rotation end-state is
-- designed. The deferred-work entry stays open as blocked on that design.
--
-- WHAT GOES: the BEFORE UPDATE trigger `teams_refuse_write_while_in_rotation`,
-- and the team branch of `refuse_archive_in_rotation()`. A team archive is
-- again decided by 0010's policy alone (`team_in_use`, 42501).
--
-- WHAT STAYS:
--
--   * 0035's organization lock on a team archive
--     (`teams_serialize_organization_writes`) and its caller re-check
--     (`teams_refuse_write_by_stale_admin`), untouched;
--   * 0036's shift-type rule: archiving a type that a pattern in force or
--     scheduled steps through is refused with 23514 `SHIFT_TYPE_IN_ROTATION`.
--     A newer rotation version can stop using a type, so that rule can always
--     be satisfied. `refuse_archive_in_rotation()` keeps its name and its
--     signature, so its grants (none to anyone but the owner) are unchanged.
--
-- IDEMPOTENT: `drop trigger if exists` and `create or replace`.

drop trigger if exists teams_refuse_write_while_in_rotation on public.teams;

-- 0036's function, with the shift-type branch alone.
create or replace function public.refuse_archive_in_rotation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 0023's gate: a request session's own statement.
  if pg_catalog.current_setting('role') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1 then
    return new;
  end if;

  -- A step of the type in a pattern that some team's version in force
  -- today, or scheduled after today, names.
  if exists (
    select 1
      from public.rotation_steps step
      join public.rotation_assignments a
        on a.organization_id = step.organization_id
       and a.pattern_id = step.pattern_id
     where step.organization_id = new.organization_id
       and step.shift_type_id = new.id
       and (
         a.effective_from > public.organization_today(a.organization_id)
         or a.effective_from = (
           select max(b.effective_from)
             from public.rotation_assignments b
            where b.team_id = a.team_id
              and b.effective_from <= public.organization_today(b.organization_id)
         )
       )
  ) then
    raise exception using
      errcode = 'check_violation',
      message = 'SHIFT_TYPE_IN_ROTATION';
  end if;

  return new;
end;
$$;
