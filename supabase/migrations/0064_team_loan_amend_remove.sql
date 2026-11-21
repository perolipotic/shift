-- 0064_team_loan_amend_remove.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 18.4: an admin amends, ends early or removes a loan (FR-91, FR-62,
-- AD-3, AD-11). Six deferred-work entries addressed to 18.4, answered here.
--
-- 1. TWO ATTRIBUTED DEFINERS, the only way a loan changes (0062 grants no
--    update and no delete, and still grants none):
--
--      * `remove_team_loan(p_loan_id)` soft-removes a live loan:
--        `removed_by = auth.uid()`, `removed_at = now()`.
--      * `amend_team_loan(p_loan_id, p_team_id, p_from, p_to, p_reason)`
--        soft-removes it and inserts the replacement — the same member, the
--        named team and inclusive range, and `p_reason`, or the old row's
--        reason when it is null — in one transaction, attributed by 0062's
--        defaults, and answers the replacement's id. Changing the dates, the
--        team, or ending the loan early (an earlier last date) are all this
--        one amend; the dates already worked stay covered by the replacement.
--
--    Each takes 0023's organization lock as its first act, keyed exactly as
--    0023 keys it, then re-reads the caller (an active admin of the claimed
--    organization, else 42501 `TEAM_LOAN_AMEND_REFUSED` /
--    `TEAM_LOAN_REMOVAL_REFUSED`), as 0036's `remove_leave_record` and 0058's
--    `amend_leave_record` do. A loan not live in the caller's organization is
--    P0002 `TEAM_LOAN_NOT_LIVE`. The replacement is refused by the table as an
--    insert is: 23P01 when it shares a date with another live loan of the
--    member (the old row is already removed, so it never refuses itself),
--    23514 / 22000 for a bad range or reason, 23503 for another tenant's team.
--
--    A DEFINER RUNS AS THE OWNER, past 0062's insert policy, so it asks the
--    policy's two team conjuncts itself: a loan team that is archived, or the
--    member's team on any covered date, is 42501 `TEAM_LOAN_TEAM_REFUSED`.
--    The two conjuncts are one function, `private.team_loan_team_refused`,
--    which the re-check in (4) calls too, so the rule is stated once more
--    beside 0062's policy, never differently.
--
-- 2. ONE NOTICE PER CHANGE (0043's amend flag). The amend sets
--    `shift.notify_suppress = 'amend'` around its removal and insert, so
--    0063's `LOAN_MADE` is never sent for the replacement. Instead
--    `private.notify_team_loan()` is replaced in place, on 0060's
--    `notify_leave_record` pattern, and also bound to the removal
--    (`team_loans_notify_removal`, AFTER UPDATE OF `removed_at`):
--
--      * a plain insert: `LOAN_MADE`, exactly as 0063;
--      * an amend: one `LOAN_CHANGED`, with the replacement's operands, to
--        the member when the old or the new range is current; none when only
--        the reason changed (the same team and dates; FR-92 never shows it);
--      * a removal: `LOAN_REMOVED`, with the removed loan's operands, when it
--        was current.
--
--    "Current" is 0063's rule: the last day is on or after the
--    organization's today; a correction of history is not news. Operands are
--    `startDate`, `endDate`, `teamName`; no reason (FR-92), no author. 0063's
--    header line "a removal or an amend (story 18.4) notifies nobody yet" is
--    superseded by this paragraph (0063 is forward-only and not edited).
--
-- 3. AN ARCHIVE WAITS FOR A LOAN, AND A LOAN FOR AN ARCHIVE. `team_loans`
--    inserts take 0023's lock (`team_loans_serialize_organization_writes`,
--    BEFORE STATEMENT), as a team archive already does (0035), so the two
--    serialize per organization.
--
-- 4. THE CALLER AND THE TEAM, RE-READ BEHIND THE LOCK (0035).
--    `team_loans_refuse_write_by_stale_admin` (BEFORE ROW on insert) runs
--    0035's `refuse_write_by_stale_admin()`, which is replaced here with one
--    more branch: for a `team_loans` insert, `private.team_loan_team_refused`
--    with fresh reads (42501, the policy's own refusal). So an admin demoted
--    or deactivated while their insert waited, a team archived meanwhile, and
--    a team move written meanwhile that makes the loan point home are all
--    refused. Its gate is 0023's (`authenticated`, a top-level statement),
--    which an amend's insert passes too: a definer keeps the session's role
--    setting.
--
-- 5. A TEAM WITH A CURRENT OR FUTURE LOAN IS NOT ARCHIVED.
--    `teams_refuse_write_while_lent_to` (BEFORE UPDATE OF `archived`, on the
--    change to archived) refuses with 23514 `TEAM_HAS_LOANS` while a live
--    loan to the team ends on or after the organization's today: an archived
--    team would otherwise keep a lent member on its roster. A wholly past
--    loan does not block (history is kept, and the snapshot reads archived
--    teams). Its name orders it after `teams_refuse_write_by_stale_admin`, so
--    a demoted caller still hears 42501 first. The admin ends or removes the
--    loans, then archives.
--
-- A member inactive on covered dates is not refused: the domain puts them on
-- no roster on those dates, and the dialog warns (story 18.4, design notes).
--
-- No new table, column, policy or grant on a table. Nothing here computes a
-- figure (AD-7).

-- --------------------------------------------- the team rule, stated once

-- 0062's two team conjuncts: the loan team is archived, or it is the member's
-- team (by their membership versions) on some date of `p_during`. VOLATILE,
-- so a caller behind the lock reads what was committed while it waited.
create function private.team_loan_team_refused(
  p_organization_id uuid,
  p_member_id uuid,
  p_team_id uuid,
  p_during daterange
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
           select 1
             from public.teams team
            where team.organization_id = p_organization_id
              and team.id = p_team_id
              and team.archived
         )
      or exists (
           select 1
             from public.team_membership_versions version
            where version.organization_id = p_organization_id
              and version.member_id = p_member_id
              and version.team_id = p_team_id
              and version.effective_from < pg_catalog.upper(p_during)
              and not exists (
                select 1
                  from public.team_membership_versions later
                 where later.organization_id = version.organization_id
                   and later.member_id = version.member_id
                   and later.effective_from > version.effective_from
                   and later.effective_from <= pg_catalog.lower(p_during)
              )
         )
$$;

revoke execute on function private.team_loan_team_refused(uuid, uuid, uuid, daterange)
  from public, anon, authenticated, service_role;

-- -------------------------------------------------------------- the removal

create function public.remove_team_loan(p_loan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
begin
  if claimed is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('shift.organization_writes:' || claimed::text, 0)
    );
  end if;

  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'TEAM_LOAN_REMOVAL_REFUSED';
  end if;

  update public.team_loans l
     set removed_by = auth.uid(),
         removed_at = now()
   where l.id = p_loan_id
     and l.organization_id = claimed
     and l.removed_at is null;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'TEAM_LOAN_NOT_LIVE';
  end if;
end;
$$;

revoke execute on function public.remove_team_loan(uuid) from public;
revoke execute on function public.remove_team_loan(uuid) from anon;
revoke execute on function public.remove_team_loan(uuid) from service_role;
grant execute on function public.remove_team_loan(uuid) to authenticated;

-- ---------------------------------------------------------------- the amend

create function public.amend_team_loan(
  p_loan_id uuid,
  p_team_id uuid,
  p_from date,
  p_to date,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  amended_member uuid;
  amended_reason text;
  replacement uuid;
  replacement_during daterange;
begin
  if claimed is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('shift.organization_writes:' || claimed::text, 0)
    );
  end if;

  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'TEAM_LOAN_AMEND_REFUSED';
  end if;

  -- 0043: one `LOAN_CHANGED`, never removed + made.
  perform pg_catalog.set_config('shift.notify_suppress', 'amend', true);

  update public.team_loans l
     set removed_by = auth.uid(),
         removed_at = now()
   where l.id = p_loan_id
     and l.organization_id = claimed
     and l.removed_at is null
  returning l.member_id, l.reason into amended_member, amended_reason;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'TEAM_LOAN_NOT_LIVE';
  end if;

  -- A reversed range is 22000 here, as an insert's literal is.
  replacement_during := pg_catalog.daterange(p_from, p_to, '[]');

  -- 0062's policy does not see this insert (the owner writes it): its two
  -- team conjuncts, asked here.
  if private.team_loan_team_refused(claimed, amended_member, p_team_id, replacement_during) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'TEAM_LOAN_TEAM_REFUSED';
  end if;

  insert into public.team_loans (organization_id, member_id, team_id, during, reason)
  values (claimed, amended_member, p_team_id, replacement_during, coalesce(p_reason, amended_reason))
  returning id into replacement;

  perform pg_catalog.set_config('shift.notify_suppress', '', true);

  return replacement;
end;
$$;

revoke execute on function public.amend_team_loan(uuid, uuid, date, date, text) from public;
revoke execute on function public.amend_team_loan(uuid, uuid, date, date, text) from anon;
revoke execute on function public.amend_team_loan(uuid, uuid, date, date, text) from service_role;
grant execute on function public.amend_team_loan(uuid, uuid, date, date, text) to authenticated;

-- ------------------------------------------------------------ the notices

-- 0063's body for a plain insert; 0064: the amend and the removal, on 0060's
-- `notify_leave_record` pattern.
create or replace function private.notify_team_loan() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  suppressed text := private.notify_suppression();
  today date := public.organization_today(new.organization_id);
  current_live boolean;
  previous jsonb;
  team_name text;
  operands jsonb;
begin
  if today is null then
    return null;
  end if;

  -- Not wholly before today: the last day is upper - 1.
  current_live := pg_catalog.upper(new.during) - 1 >= today;

  -- An amend's removal: kept for the insert that follows in the same call.
  if tg_op = 'UPDATE' and suppressed = 'amend' then
    perform private.remember_amended(pg_catalog.jsonb_build_object(
      'members', case when current_live then pg_catalog.jsonb_build_array(old.member_id) else '[]'::jsonb end,
      'team', old.team_id,
      'during', old.during::text
    ));
    return null;
  end if;

  if tg_op = 'INSERT' and suppressed = 'amend' then
    previous := private.take_amended();
    -- A reason-only amend (the same team and dates) is not news: the member
    -- is never shown the reason (FR-92), so nobody is told.
    if previous ->> 'team' = new.team_id::text and previous ->> 'during' = new.during::text then
      return null;
    end if;
  end if;

  select t.name into team_name
    from public.teams t
   where t.organization_id = new.organization_id
     and t.id = new.team_id;
  if team_name is null then
    return null;
  end if;

  operands := pg_catalog.jsonb_build_object(
    'startDate', pg_catalog.to_char(pg_catalog.lower(new.during), 'YYYY-MM-DD'),
    'endDate', pg_catalog.to_char(pg_catalog.upper(new.during) - 1, 'YYYY-MM-DD'),
    'teamName', team_name
  );

  if tg_op = 'INSERT' then
    if suppressed = 'amend' then
      perform private.notify_members(
        new.organization_id, 'LOAN_CHANGED', new.id,
        private.amended_members(previous)
          || case when current_live then array[new.member_id] else '{}'::uuid[] end,
        operands
      );
    elsif current_live then
      perform private.notify_members(
        new.organization_id, 'LOAN_MADE', new.id, array[new.member_id], operands
      );
    end if;
    return null;
  end if;

  -- The removal.
  if current_live then
    perform private.notify_members(
      new.organization_id, 'LOAN_REMOVED', new.id, array[new.member_id], operands
    );
  end if;
  return null;
end;
$$;

revoke execute on function private.notify_team_loan() from public, anon, authenticated, service_role;

create trigger team_loans_notify_removal
  after update of removed_at on public.team_loans
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function private.notify_team_loan();

-- ---------------------------------------------- 3. the lock on an insert

create trigger team_loans_serialize_organization_writes
  before insert on public.team_loans
  for each statement
  execute function public.serialize_organization_writes();

-- -------------------------------------- 4. the caller and the team, re-read

-- 0036's re-check; 0064: plus the loan's team rule.
create or replace function public.refuse_write_by_stale_admin() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed record;
begin
  if tg_op = 'DELETE' then
    changed := old;
  else
    changed := new;
  end if;

  -- 0023's gate: a request session's own statement.
  if pg_catalog.current_setting('role') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- The caller, re-read. The policy read it on the statement's snapshot.
  if not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = changed.organization_id
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = pg_catalog.format('new row violates row-level security policy for table "%s"', tg_table_name);
  end if;

  -- The team, re-read: the insert policies read `archived` inline. Nested, so
  -- `new.team_id` is only read on the two tables that have it.
  if tg_op = 'INSERT' and tg_table_name in ('team_membership_versions', 'rotation_assignments') then
    if new.team_id is not null and exists (
      select 1
        from public.teams team
       where team.organization_id = new.organization_id
         and team.id = new.team_id
         and team.archived
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = pg_catalog.format('new row violates row-level security policy for table "%s"', tg_table_name);
    end if;
  end if;

  -- The step's type, re-read: 0016's step policy reads `archived` inline.
  if tg_op = 'INSERT' and tg_table_name = 'rotation_steps' then
    if exists (
      select 1
        from public.shift_types shift_type
       where shift_type.organization_id = new.organization_id
         and shift_type.id = new.shift_type_id
         and shift_type.archived
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = pg_catalog.format('new row violates row-level security policy for table "%s"', tg_table_name);
    end if;
  end if;

  -- 0064: the loan's team, re-read: 0062's policy reads both conjuncts inline.
  if tg_op = 'INSERT' and tg_table_name = 'team_loans' then
    if private.team_loan_team_refused(new.organization_id, new.member_id, new.team_id, new.during) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = pg_catalog.format('new row violates row-level security policy for table "%s"', tg_table_name);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.refuse_write_by_stale_admin() from public;
revoke execute on function public.refuse_write_by_stale_admin() from anon;
revoke execute on function public.refuse_write_by_stale_admin() from authenticated;
revoke execute on function public.refuse_write_by_stale_admin() from service_role;

create trigger team_loans_refuse_write_by_stale_admin
  before insert on public.team_loans
  for each row
  execute function public.refuse_write_by_stale_admin();

-- --------------------------------- 5. no archive while a loan is current

create function private.refuse_archive_while_lent_to() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 0023's gate: a request session's own statement.
  if pg_catalog.current_setting('role') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1 then
    return new;
  end if;

  -- An organization with no today (none is) refuses on any live loan: never a pass on null.
  if exists (
    select 1
      from public.team_loans l
     where l.organization_id = new.organization_id
       and l.team_id = new.id
       and l.removed_at is null
       and (
         public.organization_today(new.organization_id) is null
         or pg_catalog.upper(l.during) - 1 >= public.organization_today(new.organization_id)
       )
  ) then
    raise exception using
      errcode = 'check_violation',
      message = 'TEAM_HAS_LOANS';
  end if;

  return new;
end;
$$;

revoke execute on function private.refuse_archive_while_lent_to() from public, anon, authenticated, service_role;

create trigger teams_refuse_write_while_lent_to
  before update of archived on public.teams
  for each row
  when (new.archived and not old.archived)
  execute function private.refuse_archive_while_lent_to();
