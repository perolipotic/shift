-- 0043_notification_events.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 10.2: email tells people what concerns them (AD-18).
--
-- The facts a member or an admin hears about are written by AFTER triggers on
-- the tables that assert them, in the same transaction as the write: a
-- refused or rolled-back write leaves no row. TRIGGERS, NOT RPCs, because
-- three of the five tables are written by direct PostgREST inserts; a trigger
-- covers every path (the browser, `replace_conflict_member`, the amends, the
-- owner) without touching the SPA.
--
-- RECIPIENTS ARE STORED FACTS ONLY. Nothing here projects a roster:
--
--   * a leave record, recorded, amended or removed: its member;
--   * a roster override, set, amended or removed: `member_in_id` (put on)
--     and `member_out_id` (taken off), each with its own code; a member an
--     amend drops gets the removal code;
--   * a shift-type override, set, amended or removed: the team's members on
--     that date who are active on it (`member_team_on`, `member_active_on`);
--   * a rotation assignment inserted with today <= `effective_from` <=
--     today + 30, or a SCHEDULED one cancelled (today < `effective_from` <=
--     today + 30): the team's active members on its `effective_from`, once
--     per assignment. A delete cascading from the organization notifies
--     nobody;
--   * a leave request inserted: every admin of the organization active today.
--
-- One `email` row per recipient, through `private.notify_members`, which
-- skips the member whose session made the write (`auth.uid()`, what
-- `current_member_access` reads), any member with no `members.email`, and any
-- member not active today. A write with no session member (the owner, the
-- seed) notifies normally. A leave record or override whose dates all lie
-- before the organization's today notifies nobody: a correction of history
-- is not news.
--
-- OPERANDS are ISO dates, ids and snapshot names only (the shift type's name;
-- for the admins' email, the requesting member's name). A snapshot name that
-- cannot be read writes no row rather than a row `notify` cannot render. An
-- email to a member-role account names no other member and no absence type
-- (Q5).
--
-- AN AMEND IS ONE `*_CHANGED`, never removed + recorded, and AN APPROVAL'S
-- LEAVE IS ONLY THE DECISION EMAIL: the definers set the transaction-local
-- flag `shift.notify_suppress` (`amend` or `approval`) around their writes,
-- and the triggers read it with `current_setting(…, true)`, so a missing
-- setting is no error. Under `amend` the removal writes nothing and leaves
-- what the replaced row would have notified in `shift.notify_amend_previous`;
-- the insert that follows writes the `*_CHANGED` rows to them and its own.
--
-- `claim_notifications` also returns the organization's name, so every email
-- names it (dropped and re-created: its return type changes). And 0042's
-- recipient key now cascades from the member (section o).
--
-- Not here: collisions (derived in the browser, AD-4; deferred), swaps
-- (Epic 12), `confirm_*` dispositions, 0041's deactivation, retention.

-- ------------------------------------------------- (o) the recipient's key

-- 0042's recipient key, now CASCADING. Until 0043 only a decision wrote a
-- row; now every recorded fact does, so nearly every member is some row's
-- recipient, and a key that does not cascade would refuse deleting any member
-- who was ever told anything. An outbox row is a delivery, not a record: the
-- facts it reports keep their own non-cascading keys, and a row whose
-- recipient is gone has nobody to be sent to (the claim joins `members`).
alter table public.notification_outbox drop constraint notification_outbox_recipient_fkey;
alter table public.notification_outbox
  add constraint notification_outbox_recipient_fkey
  foreign key (organization_id, recipient_member_id)
  references public.members (organization_id, id)
  on delete cascade;

-- ------------------------------------------------------------ (i) the helper

-- One `email` row per recipient, skipping the actor, anybody with no address
-- and anybody not active today. `on conflict do nothing`: the unique key
-- (code, subject, recipient, channel) is at most once, and a repeat is not an
-- error.
create function private.notify_members(
  p_organization uuid,
  p_code text,
  p_subject uuid,
  p_recipients uuid[],
  p_operands jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := public.organization_today(p_organization);
begin
  if today is null or p_recipients is null or pg_catalog.cardinality(p_recipients) = 0 then
    return;
  end if;

  insert into public.notification_outbox (
    organization_id, code, subject_id, recipient_member_id, channel, operands
  )
  select p_organization, p_code, p_subject, m.id, 'email', p_operands
    from public.members m
   where m.organization_id = p_organization
     and m.id = any(p_recipients)
     and m.email is not null
     and pg_catalog.btrim(m.email) <> ''
     and m.auth_user_id is distinct from (select auth.uid())
     and public.member_active_on(m.id, today)
  on conflict on constraint notification_outbox_once_key do nothing;
end;
$$;

-- The team's members on a date who are active on it: the stored versions,
-- read as 0008 and 0010 read them. No projection.
create function private.team_members_on(p_organization uuid, p_team uuid, p_date date)
returns uuid[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return coalesce((
    select pg_catalog.array_agg(m.id)
      from public.members m
     where m.organization_id = p_organization
       and public.member_team_on(m.id, p_date) = p_team
       and public.member_active_on(m.id, p_date)
  ), '{}'::uuid[]);
end;
$$;

-- The flag the definers set, or '' when none is.
create function private.notify_suppression()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.current_setting('shift.notify_suppress', true), '')
$$;

-- An amend's removal: what the replaced row would have notified, kept for the
-- insert that follows in the same call.
create function private.remember_amended(p_previous jsonb)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.set_config('shift.notify_amend_previous', p_previous::text, true)
$$;

-- What the amend's removal left, consumed: `{}` when nothing was left.
create function private.take_amended()
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  kept text := coalesce(pg_catalog.current_setting('shift.notify_amend_previous', true), '');
begin
  perform pg_catalog.set_config('shift.notify_amend_previous', '', true);
  if kept = '' then
    return '{}'::jsonb;
  end if;
  return kept::jsonb;
end;
$$;

-- The `members` list of what `remember_amended` kept.
create function private.amended_members(p_previous jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select pg_catalog.array_agg(value::uuid)
       from pg_catalog.jsonb_array_elements_text(coalesce(p_previous -> 'members', '[]'::jsonb))),
    '{}'::uuid[]
  )
$$;

-- ------------------------------------------------------ (ii) leave records

create function private.notify_leave_record() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  suppressed text := private.notify_suppression();
  today date := public.organization_today(new.organization_id);
  -- Not wholly before today: the last day is upper - 1.
  current_live boolean := pg_catalog.upper(new.during) - 1 >= today;
  operands jsonb := pg_catalog.jsonb_build_object(
    'startDate', pg_catalog.to_char(pg_catalog.lower(new.during), 'YYYY-MM-DD'),
    'endDate', pg_catalog.to_char(pg_catalog.upper(new.during) - 1, 'YYYY-MM-DD')
  );
  previous jsonb;
begin
  if tg_op = 'INSERT' then
    -- The approval's leave: the decision email is the only one.
    if suppressed = 'approval' then
      return null;
    end if;

    if suppressed = 'amend' then
      previous := private.take_amended();
      perform private.notify_members(
        new.organization_id, 'LEAVE_RECORD_CHANGED', new.id,
        private.amended_members(previous)
          || case when current_live then array[new.member_id] else '{}'::uuid[] end,
        operands
      );
    elsif current_live then
      perform private.notify_members(
        new.organization_id, 'LEAVE_RECORDED', new.id, array[new.member_id], operands
      );
    end if;
    return null;
  end if;

  -- The removal.
  if suppressed = 'amend' then
    perform private.remember_amended(pg_catalog.jsonb_build_object(
      'members', case when current_live then pg_catalog.jsonb_build_array(old.member_id) else '[]'::jsonb end
    ));
    return null;
  end if;

  if current_live then
    perform private.notify_members(
      new.organization_id, 'LEAVE_RECORD_REMOVED', new.id, array[new.member_id], operands
    );
  end if;
  return null;
end;
$$;

create trigger leave_records_notify_insert
  after insert on public.leave_records
  for each row
  when (new.removed_at is null)
  execute function private.notify_leave_record();

create trigger leave_records_notify_removal
  after update of removed_at on public.leave_records
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function private.notify_leave_record();

-- --------------------------------------------------- (iii) roster overrides

-- The member put on (`member_in_id`) and the member taken off
-- (`member_out_id`) each get their own code: `ROSTER_PUT_ON*` and
-- `ROSTER_TAKEN_OFF*`, for the set, the amend (`_CHANGED`) and the removal
-- (`_REMOVED`). An amend that drops a member of the replaced row sends them
-- that side's `_REMOVED`. Neither email names the other member.
create function private.notify_roster_override() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  suppressed text := private.notify_suppression();
  live boolean := new.date >= public.organization_today(new.organization_id);
  operands jsonb := pg_catalog.jsonb_build_object('date', pg_catalog.to_char(new.date, 'YYYY-MM-DD'));
  previous jsonb;
  previous_in uuid;
  previous_out uuid;
begin
  if tg_op = 'INSERT' then
    if suppressed = 'amend' then
      previous := private.take_amended();
      if not live then
        return null;
      end if;
      previous_in := nullif(previous ->> 'in', '')::uuid;
      previous_out := nullif(previous ->> 'out', '')::uuid;

      perform private.notify_members(new.organization_id, 'ROSTER_PUT_ON_CHANGED', new.id,
        array_remove(array[new.member_in_id], null), operands);
      perform private.notify_members(new.organization_id, 'ROSTER_TAKEN_OFF_CHANGED', new.id,
        array_remove(array[new.member_out_id], null), operands);
      if previous_in is distinct from new.member_in_id and previous_in is distinct from new.member_out_id then
        perform private.notify_members(new.organization_id, 'ROSTER_PUT_ON_REMOVED', new.id,
          array_remove(array[previous_in], null), operands);
      end if;
      if previous_out is distinct from new.member_out_id and previous_out is distinct from new.member_in_id then
        perform private.notify_members(new.organization_id, 'ROSTER_TAKEN_OFF_REMOVED', new.id,
          array_remove(array[previous_out], null), operands);
      end if;
      return null;
    end if;

    if live then
      perform private.notify_members(new.organization_id, 'ROSTER_PUT_ON', new.id,
        array_remove(array[new.member_in_id], null), operands);
      perform private.notify_members(new.organization_id, 'ROSTER_TAKEN_OFF', new.id,
        array_remove(array[new.member_out_id], null), operands);
    end if;
    return null;
  end if;

  if suppressed = 'amend' then
    perform private.remember_amended(pg_catalog.jsonb_build_object('in', old.member_in_id, 'out', old.member_out_id));
    return null;
  end if;

  if live then
    perform private.notify_members(new.organization_id, 'ROSTER_PUT_ON_REMOVED', new.id,
      array_remove(array[new.member_in_id], null), operands);
    perform private.notify_members(new.organization_id, 'ROSTER_TAKEN_OFF_REMOVED', new.id,
      array_remove(array[new.member_out_id], null), operands);
  end if;
  return null;
end;
$$;

create trigger roster_overrides_notify_insert
  after insert on public.roster_overrides
  for each row
  when (new.removed_at is null)
  execute function private.notify_roster_override();

create trigger roster_overrides_notify_removal
  after update of removed_at on public.roster_overrides
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function private.notify_roster_override();

-- ----------------------------------------------- (iv) shift-type overrides

create function private.notify_shift_type_override() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  suppressed text := private.notify_suppression();
  live boolean := new.date >= public.organization_today(new.organization_id);
  people uuid[];
  day text := pg_catalog.to_char(new.date, 'YYYY-MM-DD');
  type_name text;
  previous jsonb;
begin
  if live then
    people := private.team_members_on(new.organization_id, new.team_id, new.date);
  else
    people := '{}'::uuid[];
  end if;

  if tg_op = 'INSERT' then
    if suppressed = 'amend' then
      previous := private.take_amended();
      people := private.amended_members(previous) || people;
    end if;

    -- A snapshot of the name: `notify` never looks it up. None, no row.
    select t.name into type_name
      from public.shift_types t
     where t.organization_id = new.organization_id
       and t.id = new.shift_type_id;
    if type_name is null then
      return null;
    end if;

    perform private.notify_members(
      new.organization_id,
      case when suppressed = 'amend' then 'TEAM_SHIFT_TYPE_CHANGED' else 'TEAM_SHIFT_TYPE_SET' end,
      new.id, people,
      pg_catalog.jsonb_build_object('date', day, 'shiftTypeName', type_name)
    );
    return null;
  end if;

  if suppressed = 'amend' then
    perform private.remember_amended(pg_catalog.jsonb_build_object('members', pg_catalog.to_jsonb(people)));
    return null;
  end if;

  perform private.notify_members(
    new.organization_id, 'TEAM_SHIFT_TYPE_REMOVED', new.id, people,
    pg_catalog.jsonb_build_object('date', day)
  );
  return null;
end;
$$;

create trigger shift_type_overrides_notify_insert
  after insert on public.shift_type_overrides
  for each row
  when (new.removed_at is null)
  execute function private.notify_shift_type_override();

create trigger shift_type_overrides_notify_removal
  after update of removed_at on public.shift_type_overrides
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function private.notify_shift_type_override();

-- ------------------------------------------------ (v) rotation assignments

-- STATEMENT-LEVEL, with the transition table: a rotation save inserts every
-- team's assignment in one statement. Each row is its own new version, so
-- each team's members get one email for it. From today to today + 30 only.
create function private.notify_rotation_inserted() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment record;
begin
  for assignment in
    select a.organization_id, a.id, a.team_id, a.effective_from
      from inserted a
     where a.effective_from >= public.organization_today(a.organization_id)
       and a.effective_from <= public.organization_today(a.organization_id) + 30
  loop
    perform private.notify_members(
      assignment.organization_id, 'ROTATION_CHANGES', assignment.id,
      private.team_members_on(assignment.organization_id, assignment.team_id, assignment.effective_from),
      pg_catalog.jsonb_build_object('effectiveFrom', pg_catalog.to_char(assignment.effective_from, 'YYYY-MM-DD'))
    );
  end loop;
  return null;
end;
$$;

-- THE CANCEL of a scheduled assignment: still in the future, and within
-- today + 30. ONLY A DIRECT DELETE: a delete a foreign key cascades (the
-- organization's; teams and patterns refuse theirs) runs inside the
-- referential trigger, one trigger level deeper, and its organization or
-- team row is already gone. Either guard alone would hold; both are kept,
-- so an organization delete never mails a cancel and never fails on one.
create function private.notify_rotation_deleted() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment record;
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    return null;
  end if;

  for assignment in
    select a.organization_id, a.id, a.team_id, a.effective_from
      from deleted a
     where exists (
             select 1 from public.teams t
              where t.organization_id = a.organization_id
                and t.id = a.team_id
           )
       and a.effective_from > public.organization_today(a.organization_id)
       and a.effective_from <= public.organization_today(a.organization_id) + 30
  loop
    perform private.notify_members(
      assignment.organization_id, 'ROTATION_CHANGE_CANCELLED', assignment.id,
      private.team_members_on(assignment.organization_id, assignment.team_id, assignment.effective_from),
      pg_catalog.jsonb_build_object('effectiveFrom', pg_catalog.to_char(assignment.effective_from, 'YYYY-MM-DD'))
    );
  end loop;
  return null;
end;
$$;

create trigger rotation_assignments_notify_insert
  after insert on public.rotation_assignments
  referencing new table as inserted
  for each statement
  execute function private.notify_rotation_inserted();

create trigger rotation_assignments_notify_delete
  after delete on public.rotation_assignments
  referencing old table as deleted
  for each statement
  execute function private.notify_rotation_deleted();

-- ---------------------------------------------------- (vi) leave requests

-- A new item in *Za odluku*: every admin active today hears of it, with the
-- requesting member's name as a snapshot. Admins only, so Q5 holds.
create function private.notify_leave_request() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admins uuid[];
  requester text;
begin
  select m.name into requester
    from public.members m
   where m.organization_id = new.organization_id
     and m.id = new.member_id;
  if requester is null then
    return null;
  end if;

  select coalesce(pg_catalog.array_agg(m.id), '{}'::uuid[]) into admins
    from public.members m
   where m.organization_id = new.organization_id
     and m.role = 'admin';

  perform private.notify_members(
    new.organization_id, 'LEAVE_REQUEST_CREATED', new.id, admins,
    pg_catalog.jsonb_build_object(
      'requestId', new.id::text,
      'memberName', requester,
      'startDate', pg_catalog.to_char(pg_catalog.lower(new.during), 'YYYY-MM-DD'),
      'endDate', pg_catalog.to_char(pg_catalog.upper(new.during) - 1, 'YYYY-MM-DD')
    )
  );
  return null;
end;
$$;

create trigger leave_requests_notify_insert
  after insert on public.leave_requests
  for each row
  when (new.closed_at is null)
  execute function private.notify_leave_request();

-- Nothing calls these by hand; Postgres checks EXECUTE when a trigger is
-- created, not when it fires.
revoke execute on function private.notify_members(uuid, text, uuid, uuid[], jsonb) from public, anon, authenticated, service_role;
revoke execute on function private.team_members_on(uuid, uuid, date) from public, anon, authenticated, service_role;
revoke execute on function private.notify_suppression() from public, anon, authenticated, service_role;
revoke execute on function private.remember_amended(jsonb) from public, anon, authenticated, service_role;
revoke execute on function private.take_amended() from public, anon, authenticated, service_role;
revoke execute on function private.amended_members(jsonb) from public, anon, authenticated, service_role;
revoke execute on function private.notify_leave_record() from public, anon, authenticated, service_role;
revoke execute on function private.notify_roster_override() from public, anon, authenticated, service_role;
revoke execute on function private.notify_shift_type_override() from public, anon, authenticated, service_role;
revoke execute on function private.notify_rotation_inserted() from public, anon, authenticated, service_role;
revoke execute on function private.notify_rotation_deleted() from public, anon, authenticated, service_role;
revoke execute on function private.notify_leave_request() from public, anon, authenticated, service_role;

-- ---------------------------------------------- (vii) the claim, with the name

drop function public.claim_notifications(integer);

-- 0042's claim, unchanged but for one more column: the organization's name.
create function public.claim_notifications(p_limit integer)
returns table (
  id uuid,
  organization_id uuid,
  code text,
  subject_id uuid,
  recipient_member_id uuid,
  channel text,
  operands jsonb,
  attempts smallint,
  claimed_at timestamptz,
  email text,
  locale text,
  timezone text,
  slug text,
  organization_name text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'NOTIFICATION_LIMIT_INVALID';
  end if;

  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'ATTEMPTS_EXHAUSTED'
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.attempts >= 5
        and c.claimed_at < now() - interval '10 minutes'
      for update skip locked
   );

  return query
  with claimed as (
    update public.notification_outbox o
       set claimed_at = pg_catalog.clock_timestamp(),
           attempts = o.attempts + 1
     where o.id in (
       select c.id
         from public.notification_outbox c
        where c.sent_at is null
          and c.failed_at is null
          and c.channel = 'email'
          and c.attempts < 5
          and (c.next_attempt_at is null or c.next_attempt_at <= now())
          and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        order by c.created_at, c.id
        limit p_limit
        for update skip locked
     )
    returning o.id, o.organization_id, o.code, o.subject_id, o.recipient_member_id,
              o.channel, o.operands, o.attempts, o.claimed_at, o.created_at
  )
  select claimed.id, claimed.organization_id, claimed.code, claimed.subject_id,
         claimed.recipient_member_id, claimed.channel, claimed.operands, claimed.attempts,
         claimed.claimed_at,
         member.email, organization.locale, organization.timezone, organization.slug,
         organization.name
    from claimed
    join public.members member
      on member.organization_id = claimed.organization_id
     and member.id = claimed.recipient_member_id
    join public.organizations organization
      on organization.id = claimed.organization_id
   order by claimed.created_at, claimed.id;
end;
$$;

revoke execute on function public.claim_notifications(integer) from public;
revoke execute on function public.claim_notifications(integer) from anon;
revoke execute on function public.claim_notifications(integer) from authenticated;
grant execute on function public.claim_notifications(integer) to service_role;

-- ------------------------------------------------- (viii) the definers' flags

-- 0042's decision, with the `approval` flag around the leave insert only.
create or replace function public.decide_leave_request(p_request_id uuid, p_outcome text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  requested_member uuid;
  requested_during daterange;
  created_record uuid;
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
      message = 'LEAVE_REQUEST_DECISION_REFUSED';
  end if;

  if p_outcome is null or p_outcome not in ('approved', 'rejected') then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'LEAVE_REQUEST_OUTCOME_UNKNOWN';
  end if;

  update public.leave_requests r
     set closed_by = auth.uid(),
         closed_at = now()
   where r.id = p_request_id
     and r.organization_id = claimed
     and r.closed_at is null
  returning r.member_id, r.during into requested_member, requested_during;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_REQUEST_NOT_PENDING';
  end if;

  if p_outcome = 'approved' then
    if public.member_inactive_within(requested_member, requested_during) then
      raise exception using
        errcode = 'object_not_in_prerequisite_state',
        message = 'LEAVE_REQUEST_MEMBER_INACTIVE';
    end if;

    -- 0043: the leave this approval writes sends nothing of its own; the
    -- decision row below is the requester's one email.
    perform pg_catalog.set_config('shift.notify_suppress', 'approval', true);
    begin
      insert into public.leave_records (organization_id, member_id, during)
      values (claimed, requested_member, requested_during)
      returning id into created_record;
    exception
      when exclusion_violation then
        raise exception using
          errcode = 'exclusion_violation',
          message = 'LEAVE_REQUEST_APPROVAL_OVERLAPS_LEAVE';
    end;
    perform pg_catalog.set_config('shift.notify_suppress', '', true);
  end if;

  insert into public.leave_request_decisions (organization_id, request_id, outcome, leave_record_id)
  values (claimed, p_request_id, p_outcome, created_record);

  insert into public.notification_outbox (
    organization_id, code, subject_id, recipient_member_id, channel, operands
  )
  values (
    claimed,
    case p_outcome when 'approved' then 'LEAVE_REQUEST_APPROVED' else 'LEAVE_REQUEST_REJECTED' end,
    p_request_id,
    requested_member,
    'email',
    pg_catalog.jsonb_build_object(
      'startDate', pg_catalog.to_char(pg_catalog.lower(requested_during), 'YYYY-MM-DD'),
      'endDate', pg_catalog.to_char(pg_catalog.upper(requested_during) - 1, 'YYYY-MM-DD')
    )
  );

  return created_record;
end;
$$;

revoke execute on function public.decide_leave_request(uuid, text) from public;
revoke execute on function public.decide_leave_request(uuid, text) from anon;
revoke execute on function public.decide_leave_request(uuid, text) from service_role;
grant execute on function public.decide_leave_request(uuid, text) to authenticated;

-- 0036's leave amend, with the `amend` flag around the removal and the insert.
create or replace function public.amend_leave_record(p_record_id uuid, p_from date, p_to date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  amended_member uuid;
  amended_during daterange;
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
      message = 'LEAVE_RECORD_AMEND_REFUSED';
  end if;

  -- 0043: one `LEAVE_RECORD_CHANGED`, never removed + recorded.
  perform pg_catalog.set_config('shift.notify_suppress', 'amend', true);

  update public.leave_records r
     set removed_by = auth.uid(),
         removed_at = now()
   where r.id = p_record_id
     and r.organization_id = claimed
     and r.removed_at is null
  returning r.member_id, r.during into amended_member, amended_during;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'LEAVE_RECORD_NOT_LIVE';
  end if;

  insert into public.leave_records (organization_id, member_id, during)
  values (claimed, amended_member, pg_catalog.daterange(p_from, p_to, '[]'))
  returning id, during into replacement, replacement_during;

  perform pg_catalog.set_config('shift.notify_suppress', '', true);

  update public.conflict_resolutions c
     set removed_by = auth.uid(),
         removed_at = now()
   where c.organization_id = claimed
     and c.member_id = amended_member
     and c.removed_at is null
     and c.date <@ amended_during
     and not (c.date <@ replacement_during);

  return replacement;
end;
$$;

-- 0039's roster amend, with the `amend` flag around the removal and the insert.
create or replace function public.amend_roster_override(
  p_override_id uuid,
  p_member_in_id uuid,
  p_reason text,
  p_governing_saved_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  amended_team uuid;
  amended_date date;
  amended_out uuid;
  governing_saved_at timestamptz;
  replacement uuid;
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
      message = 'ROSTER_OVERRIDE_AMEND_REFUSED';
  end if;

  -- 0043: one `ROSTER_CHANGED`, never removed + added.
  perform pg_catalog.set_config('shift.notify_suppress', 'amend', true);

  update public.roster_overrides o
     set removed_by = auth.uid(),
         removed_at = now()
   where o.id = p_override_id
     and o.organization_id = claimed
     and o.removed_at is null
  returning o.team_id, o.date, o.member_out_id into amended_team, amended_date, amended_out;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'ROSTER_OVERRIDE_NOT_LIVE';
  end if;

  select a.created_at
    into governing_saved_at
    from public.rotation_assignments a
   where a.organization_id = claimed
     and a.team_id = amended_team
     and a.effective_from <= amended_date
   order by a.effective_from desc
   limit 1;

  if governing_saved_at is distinct from p_governing_saved_at then
    raise exception using
      errcode = 'P0001',
      message = 'ROSTER_OVERRIDE_CHANGED';
  end if;

  if exists (
    select 1
      from public.teams team
     where team.organization_id = claimed
       and team.id = amended_team
       and team.archived
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ROSTER_OVERRIDE_ARCHIVED';
  end if;

  insert into public.roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason)
  values (claimed, amended_team, amended_date, amended_out, p_member_in_id, p_reason)
  returning id into replacement;

  perform pg_catalog.set_config('shift.notify_suppress', '', true);

  update public.conflict_resolutions c
     set roster_override_id = replacement
   where c.organization_id = claimed
     and c.roster_override_id = p_override_id
     and c.removed_at is null;

  return replacement;
end;
$$;

-- 0036's shift-type amend, with the `amend` flag around the removal and the
-- insert.
create or replace function public.amend_shift_type_override(
  p_override_id uuid,
  p_shift_type_id uuid,
  p_reason text,
  p_governing_saved_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  amended_team uuid;
  amended_date date;
  governing_saved_at timestamptz;
  replacement uuid;
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
      message = 'SHIFT_TYPE_OVERRIDE_AMEND_REFUSED';
  end if;

  -- 0043: one `TEAM_SHIFT_TYPE_CHANGED`, never removed + set.
  perform pg_catalog.set_config('shift.notify_suppress', 'amend', true);

  update public.shift_type_overrides o
     set removed_by = auth.uid(),
         removed_at = now()
   where o.id = p_override_id
     and o.organization_id = claimed
     and o.removed_at is null
  returning o.team_id, o.date into amended_team, amended_date;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'SHIFT_TYPE_OVERRIDE_NOT_LIVE';
  end if;

  select a.created_at
    into governing_saved_at
    from public.rotation_assignments a
   where a.organization_id = claimed
     and a.team_id = amended_team
     and a.effective_from <= amended_date
   order by a.effective_from desc
   limit 1;

  if governing_saved_at is distinct from p_governing_saved_at then
    raise exception using
      errcode = 'P0001',
      message = 'SHIFT_TYPE_OVERRIDE_CHANGED';
  end if;

  if exists (
    select 1
      from public.teams team
     where team.organization_id = claimed
       and team.id = amended_team
       and team.archived
  ) or exists (
    select 1
      from public.shift_types shift_type
     where shift_type.organization_id = claimed
       and shift_type.id = p_shift_type_id
       and shift_type.archived
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SHIFT_TYPE_OVERRIDE_ARCHIVED';
  end if;

  insert into public.shift_type_overrides (organization_id, team_id, date, shift_type_id, reason)
  values (claimed, amended_team, amended_date, p_shift_type_id, p_reason)
  returning id into replacement;

  perform pg_catalog.set_config('shift.notify_suppress', '', true);

  return replacement;
end;
$$;
