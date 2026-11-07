-- 0051_swap_request_decision_notifications.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 12.4b: every admin is told that an accepted swap waits in *Za odluku*,
-- and both members are told when an admin decides it (epic 10.2, AD-18).
--
-- ONE TRIGGER FUNCTION, `private.notify_swap_request_decision()`, on 0050's
-- pattern: an AFTER trigger in the same transaction as the write, so a
-- refused or rolled-back accept or decision leaves no row. One fact: a swap
-- reached the admin step, or left it. It runs on two triggers, and branches on
-- the table that fired it:
--
--   * `swap_requests_notify_waiting`, AFTER UPDATE OF `answer` on
--     `swap_requests`, when the answer goes from null to `accepted` on an open
--     swap: `SWAP_REQUEST_WAITING` to every admin of the organization (0043's
--     `notify_leave_request` set). The operands are `requestId`,
--     `proposerName`, `addresseeName` (snapshots from `members.name`; the
--     recipients are admins only, so Q5 holds) and `date`.
--   * `swap_request_decisions_notify_insert`, AFTER INSERT on
--     `swap_request_decisions`, when the outcome is `approved` or `rejected`:
--     `SWAP_REQUEST_APPROVED` or `SWAP_REQUEST_REJECTED`, by an explicit match
--     on the outcome, to both members of the swap. The operands are `date`
--     and, only when the swap has a return shift, `returnDate`, as ISO dates.
--     No member's name (Q5): either party may be a member-role account. The
--     trigger sits on the decision row, not on the close, because the
--     decision row is the only place the outcome lives (AD-1). 0049's
--     `decide_swap_request` inserts it last, so a refused approval (stale,
--     inactive or erasure) never reaches it.
--
-- ROWS. The subject is always the swap's id, so the outbox deletes by swap id
-- cover these rows too. They go through `private.notify_members` (0045), so
-- its recipient rules hold: never the member whose session made the write,
-- active today, an email row only with an address, a push row only with a
-- device, and 0044's email switch. An admin who is a party is an admin like
-- any other.
--
-- A WHOLLY PAST SWAP NOTIFIES NOBODY, by 0050's rule: no row when the given
-- date, and the return date if there is one, are all before the
-- organization's today.
--
-- NOT HERE: a withdrawal, a decline, a close on deactivation (`outcome =
-- 'deactivated'`) and a refused decision notify nobody. 0043's
-- `ROSTER_PUT_ON` / `ROSTER_TAKEN_OFF` rows for the approval's overrides stay
-- as they are (product owner, 2026-11-07). No change to 0049, 0050,
-- `notify_members` or any earlier migration.

create function private.notify_swap_request_decision() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  swap public.swap_requests;
  today date;
  live boolean;
  admins uuid[];
  proposer text;
  addressee text;
  code text;
begin
  if tg_table_name = 'swap_requests' then
    swap := new;
  else
    select r.* into swap
      from public.swap_requests r
     where r.organization_id = new.organization_id
       and r.id = new.request_id;
    if not found then
      return null;
    end if;
  end if;

  today := public.organization_today(swap.organization_id);
  -- Not wholly before today: the given date, or the return date if any.
  live := swap.date >= today or (swap.return_date is not null and swap.return_date >= today);
  if today is null or not live then
    return null;
  end if;

  if tg_table_name = 'swap_requests' then
    -- An accepted swap waits in *Za odluku*: every admin hears of it.
    select m.name into proposer
      from public.members m
     where m.organization_id = swap.organization_id
       and m.id = swap.proposer_id;
    select m.name into addressee
      from public.members m
     where m.organization_id = swap.organization_id
       and m.id = swap.addressee_id;
    if proposer is null or addressee is null then
      return null;
    end if;

    select coalesce(pg_catalog.array_agg(m.id), '{}'::uuid[]) into admins
      from public.members m
     where m.organization_id = swap.organization_id
       and m.role = 'admin';

    perform private.notify_members(
      swap.organization_id, 'SWAP_REQUEST_WAITING', swap.id, admins,
      pg_catalog.jsonb_build_object(
        'requestId', swap.id::text,
        'proposerName', proposer,
        'addresseeName', addressee,
        'date', pg_catalog.to_char(swap.date, 'YYYY-MM-DD')
      )
    );
    return null;
  end if;

  -- The decision: an explicit match on both outcomes; any other value
  -- (`deactivated`, which the trigger's `when` already excludes) writes
  -- nothing.
  code := case new.outcome
            when 'approved' then 'SWAP_REQUEST_APPROVED'
            when 'rejected' then 'SWAP_REQUEST_REJECTED'
          end;
  if code is null then
    return null;
  end if;

  perform private.notify_members(
    swap.organization_id, code, swap.id, array[swap.proposer_id, swap.addressee_id],
    pg_catalog.jsonb_build_object('date', pg_catalog.to_char(swap.date, 'YYYY-MM-DD'))
      || case
           when swap.return_date is null then '{}'::jsonb
           else pg_catalog.jsonb_build_object('returnDate', pg_catalog.to_char(swap.return_date, 'YYYY-MM-DD'))
         end
  );
  return null;
end;
$$;

create trigger swap_requests_notify_waiting
  after update of answer on public.swap_requests
  for each row
  when (old.answer is null and new.answer = 'accepted' and new.closed_at is null)
  execute function private.notify_swap_request_decision();

create trigger swap_request_decisions_notify_insert
  after insert on public.swap_request_decisions
  for each row
  when (new.outcome in ('approved', 'rejected'))
  execute function private.notify_swap_request_decision();

-- Nothing calls it by hand; Postgres checks EXECUTE when a trigger is
-- created, not when it fires.
revoke execute on function private.notify_swap_request_decision() from public, anon, authenticated, service_role;
