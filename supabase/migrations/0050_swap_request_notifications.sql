-- 0050_swap_request_notifications.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 12.3b: a swap proposed to a member, and its answer to the proposer,
-- are notified (FR-62, AD-18).
--
-- ONE TRIGGER FUNCTION, `private.notify_swap_request()`, on 0043's pattern
-- (`notify_leave_record`): an AFTER trigger in the same transaction as the
-- write, so a refused or rolled-back insert or answer leaves no row. It runs
-- on two triggers on `swap_requests`:
--
--   * `swap_requests_notify_insert`, AFTER INSERT, when the swap is open and
--     unanswered (a row inserted already answered, which only the owner can
--     write, is no proposal): `SWAP_REQUEST_PROPOSED` to the addressee;
--   * `swap_requests_notify_answer`, AFTER UPDATE OF `answer`, when the
--     answer goes from null to set: `SWAP_REQUEST_ACCEPTED` or
--     `SWAP_REQUEST_DECLINED` to the proposer, by an explicit match on the
--     answer: any other value writes nothing (0049's check admits none). A decline closes the swap in
--     the same update that sets `answer` (0049's `answer_swap_request`), so
--     this trigger sees both, and the close needs no trigger of its own.
--
-- ROWS. The subject is the swap's id. The operands are `date` (the given
-- shift's date) and, only when the swap has a return shift, `returnDate`, as
-- ISO dates. No member's name, no team and no shift type (Q5): either party
-- may be a member-role account. The rows go through
-- `private.notify_members` (0045), so its recipient rules hold: never the
-- member whose session made the write, active today, an email row only with
-- an address, a push row only with a device, and 0044's email switch.
--
-- A WHOLLY PAST SWAP NOTIFIES NOBODY, as 0043's "a correction of history is
-- not news": no row when the given date, and the return date if there is
-- one, are all before the organization's today. 0049 lets an open swap whose
-- dates have passed still be answered.
--
-- NOT HERE (12.4 owns them): a withdrawal, a close on deactivation and a
-- decision notify nobody, and an accepted swap writes no admin row. No change
-- to 0049, to `notify_members` or to any earlier migration.

create function private.notify_swap_request() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := public.organization_today(new.organization_id);
  -- Not wholly before today: the given date, or the return date if any.
  live boolean := new.date >= today or (new.return_date is not null and new.return_date >= today);
  operands jsonb := pg_catalog.jsonb_build_object('date', pg_catalog.to_char(new.date, 'YYYY-MM-DD'))
    || case
         when new.return_date is null then '{}'::jsonb
         else pg_catalog.jsonb_build_object('returnDate', pg_catalog.to_char(new.return_date, 'YYYY-MM-DD'))
       end;
  code text;
begin
  if today is null or not live then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform private.notify_members(
      new.organization_id, 'SWAP_REQUEST_PROPOSED', new.id, array[new.addressee_id], operands
    );
    return null;
  end if;

  -- The answer: the trigger's `when` admits only null → set. An explicit
  -- match on both answers; any other value writes nothing.
  code := case new.answer
            when 'accepted' then 'SWAP_REQUEST_ACCEPTED'
            when 'declined' then 'SWAP_REQUEST_DECLINED'
          end;
  if code is null then
    return null;
  end if;

  perform private.notify_members(new.organization_id, code, new.id, array[new.proposer_id], operands);
  return null;
end;
$$;

create trigger swap_requests_notify_insert
  after insert on public.swap_requests
  for each row
  when (new.closed_at is null and new.answer is null)
  execute function private.notify_swap_request();

create trigger swap_requests_notify_answer
  after update of answer on public.swap_requests
  for each row
  when (old.answer is null and new.answer is not null)
  execute function private.notify_swap_request();

-- Nothing calls it by hand; Postgres checks EXECUTE when a trigger is
-- created, not when it fires.
revoke execute on function private.notify_swap_request() from public, anon, authenticated, service_role;
