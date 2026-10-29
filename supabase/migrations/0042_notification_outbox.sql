-- 0042_notification_outbox.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 10.1: the outbox and the notify function (AD-14 amended, AD-17
-- amended, AD-18).
--
-- AD-18: A NOTIFICATION IS WRITTEN BY THE REQUEST THAT ASSERTS THE FACT IT
-- REPORTS, in the same transaction, as a code and operands. No prose and no
-- address is stored: the `notify` Edge Function resolves the recipient's
-- email, the organization's locale and timezone at send time, through one
-- service-role-only claim, and renders the text by code from the locale
-- messages. `notify` computes no domain answer.
--
-- WHAT THIS FILE DOES, in order:
--
--   (i)   the extensions: `pg_cron` (the schedule), `pg_net` (the HTTP call
--         the schedule makes) and `supabase_vault` (where the function URL
--         and the invoke secret live, per environment, never in a file).
--   (ii)  `notification_outbox`: organization-scoped, row level security on
--         and NO POLICY, so no session reads or writes a row; and no table
--         privilege for `anon`, `authenticated` or `service_role`. Only the
--         definers below touch it. One row per (code, subject, recipient,
--         channel): the unique key that makes a notification at most once.
--   (iii) `claim_notifications(p_limit)`: leases up to `p_limit` deliverable
--         EMAIL rows with `FOR UPDATE SKIP LOCKED` (two concurrent runs claim
--         disjoint rows), increments `attempts`, and returns each row with
--         its lease token `claimed_at`, the recipient's `members.email` (the
--         real address, never AD-12's synthesized one) and the organization's
--         locale, timezone and slug. A row is deliverable while neither sent
--         nor failed, past its `next_attempt_at` backoff, and unclaimed or
--         claimed more than 10 minutes ago (a crashed run's lease). A row
--         whose lease expired on its fifth attempt is failed
--         `ATTEMPTS_EXHAUSTED` instead of claimed again.
--   (iv)  `settle_notification(p_id, p_claimed_at, p_result, p_failure_code)`:
--         writes the delivery columns of one row, and only while the caller
--         still holds its lease (`p_claimed_at` is the token the claim
--         returned), so a stale run cannot settle a re-claimed row. `sent`
--         sets `sent_at`; `transient` releases the claim, keeps the code and
--         backs off (`next_attempt_at` = now + attempts x 10 minutes), and on
--         the fifth attempt fails the row `ATTEMPTS_EXHAUSTED`; `released`
--         gives the claim back WITHOUT spending the attempt (the run stopped
--         before trying: provider auth, or its time budget); `permanent` sets
--         `failed_at` with the code.
--   (v)   `decide_leave_request` re-created from 0041's body, plus the one
--         outbox row for the requester: `LEAVE_REQUEST_APPROVED` or
--         `LEAVE_REQUEST_REJECTED`, operands `{startDate, endDate}` (the
--         inclusive range, ISO dates). Same transaction: a refused or
--         rolled-back decision leaves no row. 0041's deactivation trigger
--         writes no row (story 10.1 does not notify it).
--   (vi)  `private.invoke_notify()` and the `notify` cron job, every minute.
--         The job POSTs to the Vault secret `notify_url` with the Vault
--         secret `notify_invoke_secret` as its bearer token, and does
--         nothing while either is absent: a fresh local stack, CI, and an
--         environment whose Vault has not been set up yet (DEPLOY.md §3a).
--
-- A FAILED SEND NEVER BLOCKS THE DECISION: the decision only inserts a row;
-- the send happens later, in another transaction, in another runtime.
--
-- EXECUTE on the claim and the settle is `service_role`'s alone: the `notify`
-- function calls them with the secret key, and no session may.
--
-- No retention or cleanup (out of scope), no push channel (story 10.4), no
-- other event (story 10.2).

-- ----------------------------------------------------------- (i) extensions

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- ------------------------------------------------------------- (ii) the outbox

create table notification_outbox (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  -- What happened, as a stable SCREAMING_SNAKE code (AD-8), and its operands.
  -- Never prose: `notify` renders the text by code.
  code text not null check (code ~ '^[A-Z][A-Z0-9_]*$' and length(code) <= 64),

  -- The row the fact is about (for a leave decision, the request).
  subject_id uuid not null,

  recipient_member_id uuid not null,

  -- Email only until story 10.4 adds push.
  channel text not null check (channel in ('email')),

  operands jsonb not null default '{}'::jsonb check (jsonb_typeof(operands) = 'object'),

  created_at timestamptz not null default now(),

  -- The delivery columns: the only ones `settle_notification` writes.
  claimed_at timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  -- The transient backoff: not claimed again before this instant.
  next_attempt_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  failure_code text check (failure_code ~ '^[A-Z][A-Z0-9_]*$' and length(failure_code) <= 64),

  constraint notification_outbox_sent_or_failed check (sent_at is null or failed_at is null),

  -- At most once per recipient and channel.
  constraint notification_outbox_once_key unique (code, subject_id, recipient_member_id, channel),

  -- To 0002's unique (organization_id, id), so a row naming another tenant's
  -- member is unrepresentable. No cascade, as 0040's.
  constraint notification_outbox_recipient_fkey
    foreign key (organization_id, recipient_member_id)
    references members (organization_id, id)
);

-- The claim's scan: the rows still to deliver, oldest first.
create index notification_outbox_deliverable_idx
  on notification_outbox (created_at, id)
  where sent_at is null and failed_at is null;

alter table notification_outbox enable row level security;

-- No policy, and no privilege for any request role: nobody reads or writes a
-- row but the definers below. `service_role` bypasses row level security, so
-- its table privileges are revoked too: `notify` reaches the outbox through
-- the two functions and never through a table.
revoke all on table public.notification_outbox from anon, authenticated, service_role;

-- -------------------------------------------------------------- (iii) the claim

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
  slug text
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

  -- A lease that expired on the fifth attempt is not claimed a sixth time.
  -- Whether that attempt reached the provider is unknown, so the row fails
  -- rather than risk a second email outside the idempotency window.
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

  -- The lease token is the WALL clock, not the transaction's: two claims of
  -- one row never carry the same token, even inside one transaction.
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
         member.email, organization.locale, organization.timezone, organization.slug
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

-- ------------------------------------------------------------- (iv) the settle

create function public.settle_notification(
  p_id uuid,
  p_claimed_at timestamptz,
  p_result text,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_result is null or p_result not in ('sent', 'transient', 'released', 'permanent') then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'NOTIFICATION_RESULT_UNKNOWN';
  end if;

  if p_result <> 'sent' and (p_failure_code is null or p_failure_code !~ '^[A-Z][A-Z0-9_]*$'
                             or length(p_failure_code) > 64) then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'NOTIFICATION_FAILURE_CODE_INVALID';
  end if;

  -- Only the delivery columns, and only of a row that is still open and
  -- whose lease is the caller's: `claimed_at` is the token the claim
  -- returned. A run whose lease expired and was re-claimed holds an old
  -- token and settles nothing.
  if p_result = 'sent' then
    update public.notification_outbox o
       set sent_at = now()
     where o.id = p_id
       and o.claimed_at = p_claimed_at
       and o.sent_at is null
       and o.failed_at is null;
  elsif p_result = 'transient' then
    update public.notification_outbox o
       set claimed_at = null,
           failure_code = case when o.attempts >= 5 then 'ATTEMPTS_EXHAUSTED' else p_failure_code end,
           failed_at = case when o.attempts >= 5 then now() else null end,
           next_attempt_at = case when o.attempts >= 5 then null
                                  else now() + o.attempts * interval '10 minutes' end
     where o.id = p_id
       and o.claimed_at = p_claimed_at
       and o.sent_at is null
       and o.failed_at is null;
  elsif p_result = 'released' then
    -- Not tried: the attempt the claim counted is given back.
    update public.notification_outbox o
       set claimed_at = null,
           attempts = greatest(o.attempts - 1, 0),
           failure_code = p_failure_code
     where o.id = p_id
       and o.claimed_at = p_claimed_at
       and o.sent_at is null
       and o.failed_at is null;
  else
    update public.notification_outbox o
       set failed_at = now(),
           failure_code = p_failure_code
     where o.id = p_id
       and o.claimed_at = p_claimed_at
       and o.sent_at is null
       and o.failed_at is null;
  end if;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'NOTIFICATION_NOT_CLAIMED';
  end if;
end;
$$;

revoke execute on function public.settle_notification(uuid, timestamptz, text, text) from public;
revoke execute on function public.settle_notification(uuid, timestamptz, text, text) from anon;
revoke execute on function public.settle_notification(uuid, timestamptz, text, text) from authenticated;
grant execute on function public.settle_notification(uuid, timestamptz, text, text) to service_role;

-- --------------------------------------------- (v) the decision writes the row

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
    -- 0041: never leave for a member on a date they are inactive. The raise
    -- aborts the call, and the close above with it: the request stays
    -- pending, to be rejected.
    if public.member_inactive_within(requested_member, requested_during) then
      raise exception using
        errcode = 'object_not_in_prerequisite_state',
        message = 'LEAVE_REQUEST_MEMBER_INACTIVE';
    end if;

    -- `created_by` and `created_at` come from 0028's defaults: the approving
    -- admin, now. 0028's exclusion refuses it when live leave sharing a date
    -- was recorded since the request; the refusal is named and aborts the
    -- call, and the close above with it.
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
  end if;

  -- `decided_by` and `decided_at` from their defaults: the caller, now.
  insert into public.leave_request_decisions (organization_id, request_id, outcome, leave_record_id)
  values (claimed, p_request_id, p_outcome, created_record);

  -- 0042 (AD-18): the requester hears about the decision. One email row, in
  -- this transaction, as a code and operands: the inclusive range as ISO
  -- dates (a daterange is stored half-open, so the last day is upper - 1).
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

-- ------------------------------------------------------- (vi) the schedule

-- The cron job's one statement. Reads the function URL and the invoke secret
-- from Vault, by name, and POSTs with the secret as a bearer token. Answers
-- the pg_net request id, or null, sending nothing, while either secret is
-- absent. The secrets' VALUES live in Vault, per environment (DEPLOY.md §3a),
-- and never in a file.
create function private.invoke_notify()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  target text;
  secret text;
begin
  select s.decrypted_secret into target
    from vault.decrypted_secrets s
   where s.name = 'notify_url';
  select s.decrypted_secret into secret
    from vault.decrypted_secrets s
   where s.name = 'notify_invoke_secret';

  if target is null or btrim(target) = '' or secret is null or btrim(secret) = '' then
    return null;
  end if;

  return net.http_post(
    url := btrim(target),
    body := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || btrim(secret)
    ),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke execute on function private.invoke_notify() from public;
revoke execute on function private.invoke_notify() from anon;
revoke execute on function private.invoke_notify() from authenticated;
revoke execute on function private.invoke_notify() from service_role;

-- Every minute. `cron.schedule` with a name replaces a job of that name, so
-- re-running this statement leaves exactly one job.
select cron.schedule('notify', '* * * * *', 'select private.invoke_notify()');
