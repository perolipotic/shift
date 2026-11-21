-- 0063_team_loan_notifications.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 18.3: the lent member is told (FR-62, AD-18).
--
-- ONE TRIGGER FUNCTION, `private.notify_team_loan()`, on 0043's pattern
-- (`notify_leave_record`): an AFTER INSERT trigger on `team_loans` (0062), in
-- the same transaction as the write, so a refused or rolled-back insert
-- leaves no row. It writes `LOAN_MADE` to the lent member through
-- `private.notify_members` (0045), so its recipient rules hold: never the
-- member whose session made the write (an admin lending themselves is not
-- told), active today, an email row only with an address, a push row only
-- with a device, and 0044's email switch.
--
-- ROWS. The subject is the loan's id. The operands are `startDate` and
-- `endDate` (the inclusive range, as ISO dates) and `teamName` (the loan
-- team's name as stored, read in the loan's own organization). No reason
-- (admin-only, FR-92) and no author. The recipient is the member themselves.
--
-- A WHOLLY PAST LOAN NOTIFIES NOBODY, as 0043's "a correction of history is
-- not news": no row when the loan's last day is before the organization's
-- today. 0062 lets a past loan be recorded (story 18.3, design note 1).
--
-- NOT HERE: a removal or an amend (story 18.4) notifies nobody yet; 0062 has
-- no update grant. No change to 0062, to `notify_members` or to any earlier
-- migration. No new table, column, policy or grant.

create function private.notify_team_loan() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := public.organization_today(new.organization_id);
  team_name text;
begin
  -- Not wholly before today: the last day is upper - 1.
  if today is null or pg_catalog.upper(new.during) - 1 < today then
    return null;
  end if;

  select t.name into team_name
    from public.teams t
   where t.organization_id = new.organization_id
     and t.id = new.team_id;
  if team_name is null then
    return null;
  end if;

  perform private.notify_members(
    new.organization_id, 'LOAN_MADE', new.id, array[new.member_id],
    pg_catalog.jsonb_build_object(
      'startDate', pg_catalog.to_char(pg_catalog.lower(new.during), 'YYYY-MM-DD'),
      'endDate', pg_catalog.to_char(pg_catalog.upper(new.during) - 1, 'YYYY-MM-DD'),
      'teamName', team_name
    )
  );
  return null;
end;
$$;

create trigger team_loans_notify_insert
  after insert on public.team_loans
  for each row
  when (new.removed_at is null)
  execute function private.notify_team_loan();

-- Nothing calls it by hand; Postgres checks EXECUTE when a trigger is
-- created, not when it fires. As 0043.
revoke execute on function private.notify_team_loan() from public, anon, authenticated, service_role;
