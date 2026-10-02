-- 0032_replace_conflict_member.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 5.4c: an admin resolves a conflict by putting someone else on the
-- shift.
--
-- A `replace_member` RESOLUTION IS TWO ROWS, WRITTEN TOGETHER: 0026's roster
-- override that PUTS THE REPLACEMENT ON the absent member's shift, and 0031's
-- resolution that records the decision and NAMES that override. Either alone
-- is wrong — an override with no decision leaves the conflict open, and a
-- decision with no override hides it while nobody covers the shift — so both
-- are inserted by the one function below, in one transaction.
--
-- THE OVERRIDE ONLY ADDS (human, 2026-10-02). `member_in_id` is the
-- replacement and `member_out_id` is null: the absent member stays on the
-- roster, the collision still derives, and the resolution hides it. Their
-- balance does not change and the shift's duration goes to their leave hours,
-- exactly as for `accept_uncovered`. Nothing here writes, reads or refers to a
-- rotation, membership or status row (DI-2).
--
--   * `roster_overrides` gains `unique (organization_id, id)`, the key the
--     link below references, as 0002's and 0009's do for members and teams.
--   * `conflict_resolutions.roster_override_id` is that link: a composite key
--     to the same organization's override, so another tenant's override is
--     unrepresentable, and NO cascade. The check
--     `(kind = 'replace_member') = (roster_override_id is not null)` makes a
--     replacement without its override, or a link on any other kind,
--     unrepresentable. The column has NO grant: a session's direct insert
--     cannot name it, so a direct `replace_member` insert is refused by the
--     check (23514), and this function is the only way one is written.
--
-- WHEN THE LINKED OVERRIDE IS REMOVED LATER (0027) the resolution stays live:
-- ledgered for story 5.5, as 0031's lifetime rule is only the leave's.
--
-- A DELIBERATE EXCEPTION to "no new function" (AD-11), scoped to this one
-- paired insert, as 0027 and 0029 are. SECURITY DEFINER, so the inserts run as
-- the owner, past both tables' insert policies (RLS is enabled, not forced).
-- What the policies would check, the function checks itself: the claim and
-- `current_member_access()` as an ACTIVE ADMIN, and — 0026's insert policy —
-- a team that is NOT ARCHIVED. The attribution is still the columns'
-- defaults, `created_by default auth.uid()` and `created_at default now()`,
-- which read the caller's token here as anywhere. The organization written is
-- the claimed one, never an argument. `search_path` is emptied and every name
-- qualified, as 0002's definer writes it.
--
-- THE OVERRIDE FIRST, THEN THE RESOLUTION, so 0031's trigger runs on the
-- resolution as it does on a direct insert: no live leave of the member on the
-- date refuses the call (P0002), and its share lock serialises against a
-- concurrent leave removal or amend. Any refusal of either insert aborts the
-- whole call, so no override is ever left without its resolution.
--
-- THE REFUSALS, as SQLSTATEs the browser maps (the existing codes):
--
--   * 42501 (`insufficient_privilege`) unless the caller is an active admin of
--     the claimed organization, or when the team is archived;
--   * 23505 — the resolution's live key (already resolved), checked FIRST,
--     before the override is written, so an already-resolved conflict is
--     never mistaken for a taken replacement; or, as
--     `CONFLICT_REPLACEMENT_TAKEN`, the override's live key: the replacement
--     is already put on that team's shift that date;
--   * P0002 (`CONFLICT_RESOLUTION_NOT_ON_LEAVE`) — 0031's trigger;
--   * 23514 — a check: the replacement is the absent member, a reason 0026
--     refuses, or a date out of range;
--   * 23503 — a composite key: another tenant's member, replacement or team.
--
-- The candidates, and whether the collision exists at all, are
-- `packages/domain`'s and the browser's questions (AD-4): nothing here
-- derives either.

-- -------------------------------------------------------------- the link's key

alter table public.roster_overrides
  add constraint roster_overrides_organization_id_id_key unique (organization_id, id);

-- ------------------------------------------------------------------- the link

alter table public.conflict_resolutions
  add column roster_override_id uuid;

-- NO cascade: the override a resolution names is soft-removed, never deleted.
alter table public.conflict_resolutions
  add constraint conflict_resolutions_roster_override_fkey
    foreign key (organization_id, roster_override_id)
    references public.roster_overrides (organization_id, id);

alter table public.conflict_resolutions
  add constraint conflict_resolutions_replacement_linked
    check ((kind = 'replace_member') = (roster_override_id is not null));

-- The key's index: a removal or a lookup of the override reaches its
-- resolution without a scan.
create index conflict_resolutions_roster_override_idx
  on public.conflict_resolutions (organization_id, roster_override_id);

-- No grant on `roster_override_id`: 0031's column grant names the five facts
-- a session may insert, and this column is not one of them.

-- ---------------------------------------------------------------- the function

create function public.replace_conflict_member(
  p_member_id uuid,
  p_date date,
  p_team_id uuid,
  p_replacement_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  override_id uuid;
  resolution_id uuid;
begin
  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'CONFLICT_REPLACEMENT_REFUSED';
  end if;

  -- 0026's insert policy: never on an archived team. Another tenant's team is
  -- not found here and is refused by the composite key below (23503).
  if exists (
    select 1
      from public.teams team
     where team.organization_id = claimed
       and team.id = p_team_id
       and team.archived
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'CONFLICT_REPLACEMENT_REFUSED';
  end if;

  -- The absent member stays on the roster: putting them on their own shift
  -- replaces nobody.
  if p_replacement_id is not distinct from p_member_id then
    raise exception using
      errcode = 'check_violation',
      message = 'CONFLICT_REPLACEMENT_IS_ABSENT_MEMBER';
  end if;

  -- Already resolved: the resolution's live key, before the override's, so
  -- the caller hears "no longer open" rather than "taken". The insert below
  -- still holds the key against a race (23505 either way).
  if exists (
    select 1
      from public.conflict_resolutions c
     where c.organization_id = claimed
       and c.member_id = p_member_id
       and c.date = p_date
       and c.team_id = p_team_id
       and c.removed_at is null
  ) then
    raise exception using
      errcode = 'unique_violation',
      message = 'CONFLICT_RESOLUTION_EXISTS';
  end if;

  -- The override: an addition alone. `created_by` and `created_at` come from
  -- 0026's defaults.
  begin
    insert into public.roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason)
    values (claimed, p_team_id, p_date, null, p_replacement_id, p_reason)
    returning id into override_id;
  exception
    when unique_violation then
      raise exception using
        errcode = 'unique_violation',
        message = 'CONFLICT_REPLACEMENT_TAKEN';
  end;

  -- The decision, linked to it. 0031's trigger refuses it off leave (P0002),
  -- and its live key refuses a second (23505); either aborts the override too.
  insert into public.conflict_resolutions (organization_id, member_id, date, team_id, kind, roster_override_id)
  values (claimed, p_member_id, p_date, p_team_id, 'replace_member', override_id)
  returning id into resolution_id;

  return resolution_id;
end;
$$;

-- The same explicit grants 0027 writes: Supabase's default privileges grant
-- EXECUTE to `anon`, `authenticated` and `service_role` individually. Only a
-- signed-in session calls this, and the function itself decides who of them
-- may.
revoke execute on function public.replace_conflict_member(uuid, date, uuid, uuid, text) from public;
revoke execute on function public.replace_conflict_member(uuid, date, uuid, uuid, text) from anon;
revoke execute on function public.replace_conflict_member(uuid, date, uuid, uuid, text) from service_role;
grant execute on function public.replace_conflict_member(uuid, date, uuid, uuid, text) to authenticated;
