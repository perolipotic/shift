-- 0045_push_subscriptions.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 10.4: Web Push reaches members without email.
--
-- WHAT THIS FILE DOES, in order:
--
--   (i)   `push_subscriptions`: one row per DEVICE, owned by the member who
--         turned push on there. A member reads and deletes only their own
--         rows (9.2's pattern, as 0044's), and never inserts or updates one
--         directly: the endpoint is unique, and only the definer below may
--         hand it from one member to another.
--   (ii)  `register_push_subscription(endpoint, p256dh, auth)`: the caller's
--         own registration. An endpoint another member held (a shared phone)
--         becomes the caller's, so the next person signed in on a device never
--         receives the previous one's notifications. Only a known push
--         service's host is accepted (the table checks it too), and a member
--         holds at most ten devices.
--   (iii) `delete_push_subscription(id, endpoint, member)`: `service_role`
--         only. `notify` calls it when a push service answers 404 or 410 for
--         a subscription: that device is gone, and nothing else changes. It
--         matches all three, so a stale answer never deletes an endpoint
--         registered again since the claim.
--   (iv)  The outbox's channel check widens to `push`.
--   (v)   `private.notify_members` and `decide_leave_request` re-created: beside
--         each `email` row, one `push` row per recipient who has at least one
--         subscription, under the same recipient rules. A push row needs a
--         subscription, not an address.
--   (vi)  `claim_notifications` re-created (dropped: its return type gains the
--         subscriptions). It claims `email` and `push` rows; a push row comes
--         with its member's subscriptions, and a pending push row whose member
--         has none left is settled failed `PUSH_NO_SUBSCRIPTION`.
--
-- CHANNELS ARE INDEPENDENT. 0044's outbox filter drops `email` rows only, and
-- stays as it is: the organization's `email_notifications` switch and the
-- member's email setting never stop a push row. Push is on per device: no
-- subscription, no push row.

-- --------------------------------------------------- (i) the subscriptions

create table public.push_subscriptions (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references public.organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  member_id uuid not null,

  -- The push service's URL for this device. Unique: one device, one owner.
  -- Only the push services a browser subscribes through (FCM for Chrome,
  -- Edge and Android; Mozilla's autopush; Apple's; Microsoft's WNS): `notify`
  -- posts to this URL with the secret-key function, so no other host may be
  -- named.
  endpoint text not null check (endpoint ~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)(/|$)' and length(endpoint) <= 2048),

  -- The device's keys, base64url, as `PushSubscription.toJSON()` gives them:
  -- a P-256 public key (65 bytes) and the 16-byte auth secret.
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]+={0,2}$' and length(p256dh) between 80 and 100),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]+={0,2}$' and length(auth) between 16 and 44),

  created_at timestamptz not null default now(),

  constraint push_subscriptions_endpoint_key unique (endpoint),

  -- To 0002's unique (organization_id, id): a row naming another tenant's
  -- member is unrepresentable. A device goes with its member.
  constraint push_subscriptions_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade
);

-- The claim's lookup: a recipient's devices.
create index push_subscriptions_member_idx on public.push_subscriptions (organization_id, member_id);

alter table public.push_subscriptions enable row level security;

-- The own rows only, as 0044's settings.
create policy push_subscriptions_select_own on public.push_subscriptions
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and exists (
      select 1
        from public.members member
       where member.organization_id = push_subscriptions.organization_id
         and member.id = push_subscriptions.member_id
         and member.auth_user_id = (select auth.uid())
    )
  );

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and exists (
      select 1
        from public.members member
       where member.organization_id = push_subscriptions.organization_id
         and member.id = push_subscriptions.member_id
         and member.auth_user_id = (select auth.uid())
    )
  );

-- Read and delete; never insert or update (the register definer does both).
-- `anon` reads and writes nothing, and `service_role` reaches the table only
-- through the claim and `delete_push_subscription`, as with the outbox.
revoke all on table public.push_subscriptions from anon, service_role;
revoke insert, update, truncate, references, trigger on table public.push_subscriptions
  from authenticated;
grant select, delete on table public.push_subscriptions to authenticated;

-- ---------------------------------------------------- (ii) the registration

-- The caller's own device. SECURITY DEFINER because the endpoint may be held
-- by another member (or another tenant's member) on the same browser, and the
-- caller can neither see nor delete that row: the row is handed over in one
-- statement. The caller is an ACTIVE account of the organization in the
-- token, matched by `auth_user_id`, never taken from the request.
create function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  own_member uuid;
  registered uuid;
  held integer;
begin
  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'PUSH_SUBSCRIPTION_REFUSED';
  end if;

  select m.id
    into own_member
    from public.members m
   where m.organization_id = claimed
     and m.auth_user_id = (select auth.uid());

  if own_member is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'PUSH_SUBSCRIPTION_REFUSED';
  end if;

  if p_endpoint is null or p_endpoint !~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)(/|$)' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'PUSH_ENDPOINT_NOT_ALLOWED';
  end if;

  if length(p_endpoint) > 2048
     or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]+={0,2}$' or length(p_p256dh) not between 80 and 100
     or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]+={0,2}$' or length(p_auth) not between 16 and 44 then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'PUSH_SUBSCRIPTION_INVALID';
  end if;

  -- At most ten devices a member: an eleventh is refused, never a silent
  -- eviction. Serialized per member, so two registrations cannot both pass.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shift.push_subscriptions:' || own_member::text, 0)
  );
  select count(*)
    into held
    from public.push_subscriptions s
   where s.organization_id = claimed
     and s.member_id = own_member
     and s.endpoint <> p_endpoint;
  if held >= 10 then
    raise exception using
      errcode = 'program_limit_exceeded',
      message = 'PUSH_SUBSCRIPTION_LIMIT';
  end if;

  insert into public.push_subscriptions (organization_id, member_id, endpoint, p256dh, auth)
  values (claimed, own_member, p_endpoint, p_p256dh, p_auth)
  on conflict on constraint push_subscriptions_endpoint_key do update
     set organization_id = excluded.organization_id,
         member_id = excluded.member_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         created_at = now()
  returning id into registered;

  return registered;
end;
$$;

revoke execute on function public.register_push_subscription(text, text, text) from public;
revoke execute on function public.register_push_subscription(text, text, text) from anon;
revoke execute on function public.register_push_subscription(text, text, text) from service_role;
grant execute on function public.register_push_subscription(text, text, text) to authenticated;

-- ------------------------------------------------- (iii) a gone subscription

-- `notify`'s third RPC: the push service answered 404 or 410, so the device
-- is gone. Only the subscription goes; nothing else changes. The id, the
-- endpoint AND the member the claim returned must all still match: an
-- endpoint handed to another member since (a shared phone) is that member's
-- live device, and a stale answer must not delete it. A row already gone is
-- no error.
create function public.delete_push_subscription(p_id uuid, p_endpoint text, p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_subscriptions s
   where s.id = p_id
     and s.endpoint = p_endpoint
     and s.member_id = p_member;
end;
$$;

revoke execute on function public.delete_push_subscription(uuid, text, uuid) from public;
revoke execute on function public.delete_push_subscription(uuid, text, uuid) from anon;
revoke execute on function public.delete_push_subscription(uuid, text, uuid) from authenticated;
grant execute on function public.delete_push_subscription(uuid, text, uuid) to service_role;

-- ------------------------------------------------------- (iv) the channel

alter table public.notification_outbox drop constraint notification_outbox_channel_check;
alter table public.notification_outbox
  add constraint notification_outbox_channel_check check (channel in ('email', 'push'));

-- ----------------------------------------------------------- (v) the writers

-- 0043's helper, with the push rows beside the email rows: the same
-- recipients (not the actor, active today), and a subscription in place of an
-- address. The callers decide what is wholly past, before they call.
create or replace function private.notify_members(
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

  insert into public.notification_outbox (
    organization_id, code, subject_id, recipient_member_id, channel, operands
  )
  select p_organization, p_code, p_subject, m.id, 'push', p_operands
    from public.members m
   where m.organization_id = p_organization
     and m.id = any(p_recipients)
     and exists (
       select 1
         from public.push_subscriptions s
        where s.organization_id = m.organization_id
          and s.member_id = m.id
     )
     and m.auth_user_id is distinct from (select auth.uid())
     and public.member_active_on(m.id, today)
  on conflict on constraint notification_outbox_once_key do nothing;
end;
$$;

revoke execute on function private.notify_members(uuid, text, uuid, uuid[], jsonb) from public, anon, authenticated, service_role;

-- 0043's decision, unchanged but for the push row after the email row. The
-- email row is written exactly as before; the push row only when the
-- requester has a device, and at most once by the unique key.
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

  insert into public.notification_outbox (
    organization_id, code, subject_id, recipient_member_id, channel, operands
  )
  values (claimed, decision_code, p_request_id, requested_member, 'email', decision_operands);

  -- 0045: the push row, when the requester has a device. The same recipient
  -- rules as `notify_members`: never the deciding admin's own session, and
  -- only a member active today.
  insert into public.notification_outbox (
    organization_id, code, subject_id, recipient_member_id, channel, operands
  )
  select claimed, decision_code, p_request_id, m.id, 'push', decision_operands
    from public.members m
   where m.organization_id = claimed
     and m.id = requested_member
     and exists (
       select 1
         from public.push_subscriptions s
        where s.organization_id = m.organization_id
          and s.member_id = m.id
     )
     and m.auth_user_id is distinct from (select auth.uid())
     and public.member_active_on(m.id, public.organization_today(claimed))
  on conflict on constraint notification_outbox_once_key do nothing;

  return created_record;
end;
$$;

revoke execute on function public.decide_leave_request(uuid, text) from public;
revoke execute on function public.decide_leave_request(uuid, text) from anon;
revoke execute on function public.decide_leave_request(uuid, text) from service_role;
grant execute on function public.decide_leave_request(uuid, text) to authenticated;

-- ------------------------------------------------------------- (vi) the claim

-- 0044's claim, with push. Dropped and re-created: the return type gains
-- `subscriptions`, every device of a push row's member as
-- `[{id, endpoint, p256dh, auth, member_id}]` (NULL for an email row); the
-- id, endpoint and member are what a delete must match.
drop function public.claim_notifications(integer);

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
          -- cannot deliver.
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
