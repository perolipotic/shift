-- 0046_notification_recipient_rules.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Retro 10 batch (A2, A3, A4): one recipient rule for every row, checked when
-- the row is written AND when it is sent, and a device read at send time.
--
-- WHAT THIS FILE DOES, in order:
--
--   (i)   `decide_leave_request` re-created: the decision's rows are written
--         through `private.notify_members`, as every other event's (A4, PO
--         decision 2026-10-30). Not the deciding admin's own session, only a
--         requester active today, an email row only with an address, a push
--         row only with a device. 0045 wrote the email row unconditionally.
--   (ii)  `claim_notifications` re-created, same signature and return type:
--         a pending row (either channel) whose recipient is not active today
--         in their organization is settled failed `RECIPIENT_INACTIVE` and
--         never claimed (A3). "Active today" was checked only at write; a
--         member deactivated after the row was written got it anyway.
--   (iii) `push_devices_for_send(p_id, p_claimed_at)`: `service_role` only.
--         `notify` calls it right before it posts a push row, and sends only
--         to what it returns: the row recipient's CURRENT devices, while the
--         caller still holds the row's lease (A2). An endpoint handed to
--         another member since the claim (a shared phone, even another
--         organization's) is that member's now, and the earlier member's
--         notification never reaches it. The claim's `subscriptions` column
--         stays for compatibility; `notify` no longer sends to it.
--
-- Every re-created function keeps every earlier clause (0042 → 0043 → 0044
-- → 0045) and restates its grants.

-- ------------------------------------------------------------ (i) the decision

-- 0045's body, but for the outbox writes at the end: one call to the shared
-- helper, which applies the recipient rules on both channels.
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
  decision_code text;
  decision_operands jsonb;
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
    -- decision rows below are the requester's one notification per channel.
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

  decision_code := case p_outcome when 'approved' then 'LEAVE_REQUEST_APPROVED' else 'LEAVE_REQUEST_REJECTED' end;
  decision_operands := pg_catalog.jsonb_build_object(
    'startDate', pg_catalog.to_char(pg_catalog.lower(requested_during), 'YYYY-MM-DD'),
    'endDate', pg_catalog.to_char(pg_catalog.upper(requested_during) - 1, 'YYYY-MM-DD')
  );

  -- 0046 (A4): the same recipient rules as every other event, on both
  -- channels. An admin deciding their own request, a requester not active
  -- today, and (for email) a requester without an address get no row.
  perform private.notify_members(
    claimed, decision_code, p_request_id, array[requested_member], decision_operands
  );

  return created_record;
end;
$$;

revoke execute on function public.decide_leave_request(uuid, text) from public;
revoke execute on function public.decide_leave_request(uuid, text) from anon;
revoke execute on function public.decide_leave_request(uuid, text) from service_role;
grant execute on function public.decide_leave_request(uuid, text) to authenticated;

-- --------------------------------------------------------------- (ii) the claim

-- 0045's claim, with one settle more (and the same rule in the claim's own
-- filter): a recipient not active today in their organization. Same
-- signature and return type, so `create or replace`.
create or replace function public.claim_notifications(p_limit integer)
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
  organization_name text,
  subscriptions jsonb
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

  -- 0046 (A3): a pending row, either channel, whose recipient is not active
  -- today in their organization is never sent. Not in flight, as below.
  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'RECIPIENT_INACTIVE',
         next_attempt_at = null
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.channel in ('email', 'push')
        and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        and not public.member_active_on(c.recipient_member_id, public.organization_today(c.organization_id))
      for update skip locked
   );

  -- 0044: a pending email row whose recipient or organization turned email
  -- off is never sent.
  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'EMAIL_TURNED_OFF',
         next_attempt_at = null
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.channel = 'email'
        and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        and (
          exists (
            select 1
              from public.organizations org
             where org.id = c.organization_id
               and not org.email_notifications
          )
          or exists (
            select 1
              from public.notification_settings s
             where s.organization_id = c.organization_id
               and s.member_id = c.recipient_member_id
               and not s.email
          )
        )
      for update skip locked
   );

  -- 0045: a pending push row whose member has no device left (turned off on
  -- the last one, signed out, or every one gone) has nowhere to go. Not in
  -- flight, as above.
  update public.notification_outbox o
     set failed_at = now(),
         failure_code = 'PUSH_NO_SUBSCRIPTION',
         next_attempt_at = null
   where o.id in (
     select c.id
       from public.notification_outbox c
      where c.sent_at is null
        and c.failed_at is null
        and c.channel = 'push'
        and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
        and not exists (
          select 1
            from public.push_subscriptions s
           where s.organization_id = c.organization_id
             and s.member_id = c.recipient_member_id
        )
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
          and c.channel in ('email', 'push')
          and c.attempts < 5
          and (c.next_attempt_at is null or c.next_attempt_at <= now())
          and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
          -- Belt and braces, as 0044: a row the settles above skipped (locked
          -- by a concurrent run) is still never returned while its channel
          -- cannot deliver, nor (0046) while its recipient is inactive.
          and public.member_active_on(c.recipient_member_id, public.organization_today(c.organization_id))
          and (
            c.channel <> 'email'
            or (
              not exists (
                select 1
                  from public.organizations org
                 where org.id = c.organization_id
                   and not org.email_notifications
              )
              and not exists (
                select 1
                  from public.notification_settings s
                 where s.organization_id = c.organization_id
                   and s.member_id = c.recipient_member_id
                   and not s.email
              )
            )
          )
          and (
            c.channel <> 'push'
            or exists (
              select 1
                from public.push_subscriptions s
               where s.organization_id = c.organization_id
                 and s.member_id = c.recipient_member_id
            )
          )
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
         organization.name,
         case when claimed.channel = 'push' then (
           select pg_catalog.jsonb_agg(
                    pg_catalog.jsonb_build_object(
                      'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                      'member_id', s.member_id
                    )
                    order by s.created_at, s.id
                  )
             from public.push_subscriptions s
            where s.organization_id = claimed.organization_id
              and s.member_id = claimed.recipient_member_id
         ) end
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

-- ------------------------------------------------------ (iii) the send's read

-- `notify`'s fourth RPC (A2). The devices a push row may be posted to, read
-- at send time, as one object `{status, devices}`:
--   - `lease_lost`: the caller's lease token no longer matches an open push
--     row (re-claimed, settled, or not a push row). `notify` settles nothing:
--     the row is not the caller's to settle.
--   - `inactive`: the row's recipient is not active today (A3 again, for a
--     deactivation that landed after the claim). `notify` settles it failed
--     `RECIPIENT_INACTIVE` and posts nothing.
--   - `ready`: `devices` are the ones registered NOW to the recipient in the
--     row's organization, as `[{id, endpoint, p256dh, auth, member_id}]` (the
--     claim's shape); `[]` when none is left. A device handed to another
--     member since the claim is not among them.
-- Reads only; a millisecond window between this read and the POST is accepted.
create function public.push_devices_for_send(p_id uuid, p_claimed_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  row_organization uuid;
  row_recipient uuid;
begin
  select o.organization_id, o.recipient_member_id
    into row_organization, row_recipient
    from public.notification_outbox o
   where o.id = p_id
     and o.claimed_at = p_claimed_at
     and o.channel = 'push'
     and o.sent_at is null
     and o.failed_at is null;

  if row_organization is null then
    return pg_catalog.jsonb_build_object('status', 'lease_lost', 'devices', '[]'::jsonb);
  end if;

  if not public.member_active_on(row_recipient, public.organization_today(row_organization)) then
    return pg_catalog.jsonb_build_object('status', 'inactive', 'devices', '[]'::jsonb);
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'ready',
    'devices', coalesce((
      select pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                 'member_id', s.member_id
               )
               order by s.created_at, s.id
             )
        from public.push_subscriptions s
       where s.organization_id = row_organization
         and s.member_id = row_recipient
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.push_devices_for_send(uuid, timestamptz) from public;
revoke execute on function public.push_devices_for_send(uuid, timestamptz) from anon;
revoke execute on function public.push_devices_for_send(uuid, timestamptz) from authenticated;
grant execute on function public.push_devices_for_send(uuid, timestamptz) to service_role;
