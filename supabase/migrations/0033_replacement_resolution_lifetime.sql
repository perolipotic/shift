-- 0033_replacement_resolution_lifetime.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 5.5d: a replacement that no longer applies stops hiding its conflict.
--
-- A `replace_member` RESOLUTION IS ONLY AS GOOD AS ITS OVERRIDE (human,
-- 2026-10-05). 0032 links the decision to the roster override that puts the
-- replacement on the shift, and left what happens when that override is
-- removed to story 5.5. The answer has two halves:
--
--   * IN THE BROWSER, `apps/web/src/features/conflicts/services/
--     replacement-effect.ts` stops counting a `replace_member` resolution
--     once the calendar snapshot holds its linked override pending after a
--     rotation save, or inert (the replacement inactive or already rostered
--     that day). Whether it applies is a roster computation, and NO roster is
--     computed here (AD-4).
--   * HERE, removing the linked override ENDS the decision: the live
--     resolution that names it is soft-removed in the same transaction,
--     attributed to the admin who removed the override. That frees the live
--     key, so the conflict that reappears can be decided again.
--
-- What this file does, in order:
--
--   (i)   `remove_roster_override` re-created: 0027's body and refusals,
--         unchanged, plus the soft-removal of the live resolution whose
--         `roster_override_id` is the removed override. `create or replace`
--         keeps 0027's grants.
--   (ii)  A backfill: every live resolution whose linked override was already
--         removed before this file is soft-removed, copying the override's
--         `removed_by` and `removed_at` — the removal that ended it.
--   (iii) `my_conflict_resolutions()` dropped and re-created with
--         `roster_override_id` as its last column, so a member's own hours
--         apply the same rule the admin's do. A function's result shape
--         cannot be changed in place, hence the drop; the grants are 0031's,
--         written again.
--
-- 0032's `conflict_resolutions_roster_override_idx` on
-- `(organization_id, roster_override_id)` already serves (i) and (ii), so no
-- index is added. 0031 set no comment on `my_conflict_resolutions()`, so the
-- drop loses none.
--
-- No trigger, no new table grant, no policy change. `accept_uncovered` rows
-- are untouched: they carry no link (0032's check), so neither (i) nor (ii)
-- can reach one.

-- ------------------------------------------------- (i) the removal cascade

create or replace function public.remove_roster_override(p_override_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
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
      message = 'ROSTER_OVERRIDE_REMOVAL_REFUSED';
  end if;

  update public.roster_overrides o
     set removed_by = auth.uid(),
         removed_at = now()
   where o.id = p_override_id
     and o.organization_id = claimed
     and o.removed_at is null;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'ROSTER_OVERRIDE_NOT_LIVE';
  end if;

  -- 5.5d: the decision this override carried out ends with it. At most one
  -- live row names it (0032 writes one resolution per override, and the live
  -- key holds one per conflict); none for an override no decision wrote.
  update public.conflict_resolutions c
     set removed_by = auth.uid(),
         removed_at = now()
   where c.organization_id = claimed
     and c.roster_override_id = p_override_id
     and c.removed_at is null;
end;
$$;

-- ---------------------------------------------------------- (ii) the backfill

-- Rows 0032's ledgered gap left behind: a live decision whose override is
-- already gone. The override's own removal is the attribution.
update public.conflict_resolutions c
   set removed_by = o.removed_by,
       removed_at = o.removed_at
  from public.roster_overrides o
 where o.organization_id = c.organization_id
   and o.id = c.roster_override_id
   and o.removed_at is not null
   and c.removed_at is null;

-- ---------------------------------------------------- (iii) the member's read

drop function public.my_conflict_resolutions();

-- 0031's read, shaped and pinned the same way, plus the link: the caller's own
-- LIVE resolutions, `member_id, date, team_id, kind, roster_override_id`. No
-- author and no removal. The link is the id of an override of the caller's own
-- organization, which every active member already reads, live, through
-- `calendar_roster_overrides()`; it says nothing that read does not.
create function public.my_conflict_resolutions()
returns table (
  member_id uuid,
  date date,
  team_id uuid,
  kind text,
  roster_override_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.member_id,
         c.date,
         c.team_id,
         c.kind,
         c.roster_override_id
    from public.conflict_resolutions c
    join public.members m
      on m.organization_id = c.organization_id
     and m.id = c.member_id
   where c.organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
     and c.organization_id = (
       select access.organization_id
         from public.current_member_access() as access
        where access.is_active
     )
     and m.auth_user_id = (select auth.uid())
     and c.removed_at is null
   order by c.date, c.team_id
$$;

-- 0031's explicit grants, written again for the re-created function.
revoke execute on function public.my_conflict_resolutions() from public;
revoke execute on function public.my_conflict_resolutions() from anon;
revoke execute on function public.my_conflict_resolutions() from service_role;
grant execute on function public.my_conflict_resolutions() to authenticated;
