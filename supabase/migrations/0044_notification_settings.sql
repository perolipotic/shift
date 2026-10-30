-- 0044_notification_settings.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 10.3: notification settings in Više.
--
-- WHAT THIS FILE DOES, in order:
--
--   (i)   `notification_settings`: one self-owned row per member (9.2's
--         pattern, as 0040's `leave_requests`). No row means email is on. A
--         member reads, inserts and updates only their own row, through
--         column grants: insert names `organization_id, member_id, email`,
--         update names `email` alone. No delete, and no admin reads another
--         member's row.
--   (ii)  `organizations.email_notifications`: the organization's switch,
--         NOT NULL DEFAULT TRUE (every tenant has sent email since 10.1). It
--         joins the column grants; WHO may write it is 0004's
--         `organizations_update_by_own_active_admin`, unchanged.
--   (iii) The outbox filter: one SECURITY DEFINER BEFORE INSERT trigger on
--         `notification_outbox`. It returns NULL for an `email` row whose
--         organization switch is off, or whose recipient's own setting is off,
--         so the row is never written. Every writer passes through it: 0043's
--         triggers, `decide_leave_request`'s direct insert, and Epic 12's
--         later ones. A writer's `on conflict do nothing` is unaffected: a
--         skipped row is no conflict.
--   (iv)  `claim_notifications` re-created from 0043's body (same signature,
--         same grants), with the switches checked at claim time too: before
--         claiming, it settles as failed (`failure_code = 'EMAIL_TURNED_OFF'`)
--         every pending `email` row not in flight — new, or waiting out a
--         retry's backoff — whose recipient's setting or whose organization's
--         switch is now off, and it never returns such a row.
--
-- A SWITCH STOPS THE WRITES AND THE QUEUE. A row written before a switch
-- turned off is settled failed at the next claim, retries included; nothing
-- deletes it. Only a row already claimed and in flight (its 10-minute lease)
-- when the switch turns off can still send.
--
-- No push setting, column or table (story 10.4).

-- ---------------------------------------------------- (i) the member's setting

create table public.notification_settings (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references public.organizations (id) on delete cascade,

  member_id uuid not null,

  email boolean not null default true,

  updated_at timestamptz not null default now(),

  constraint notification_settings_pkey primary key (organization_id, member_id),

  -- To 0002's unique (organization_id, id): a row naming another tenant's
  -- member is unrepresentable. A setting is the member's own and goes with
  -- them.
  constraint notification_settings_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade
);

alter table public.notification_settings enable row level security;

-- The own row only. Every rule is one conjunct, as 0040's insert policy:
--
--   * the tenant, from the claim and from the fresh helper, as an ACTIVE
--     account of any role;
--   * the member, the caller's own row in that organization, matched by
--     `auth_user_id`, never taken from the request.
create policy notification_settings_select_own on public.notification_settings
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
       where member.organization_id = notification_settings.organization_id
         and member.id = notification_settings.member_id
         and member.auth_user_id = (select auth.uid())
    )
  );

create policy notification_settings_insert_own on public.notification_settings
  for insert
  to authenticated
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and exists (
      select 1
        from public.members member
       where member.organization_id = notification_settings.organization_id
         and member.id = notification_settings.member_id
         and member.auth_user_id = (select auth.uid())
    )
  );

create policy notification_settings_update_own on public.notification_settings
  for update
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
       where member.organization_id = notification_settings.organization_id
         and member.id = notification_settings.member_id
         and member.auth_user_id = (select auth.uid())
    )
  )
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and exists (
      select 1
        from public.members member
       where member.organization_id = notification_settings.organization_id
         and member.id = notification_settings.member_id
         and member.auth_user_id = (select auth.uid())
    )
  );

-- The writable columns. Insert names the three facts of the row; update only
-- the switch, so a row never moves to another member or tenant. No delete:
-- a member turns email back on by updating. `anon` reads and writes nothing.
revoke all on table public.notification_settings from anon;
revoke insert, update, delete, truncate, references, trigger on table public.notification_settings
  from authenticated;
grant select on table public.notification_settings to authenticated;
grant insert (organization_id, member_id, email) on table public.notification_settings
  to authenticated;
grant update (email) on table public.notification_settings to authenticated;

-- `updated_at` is the server's, on every update.
create function private.touch_notification_settings() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger notification_settings_touch
  before update on public.notification_settings
  for each row execute function private.touch_notification_settings();

-- --------------------------------------------- (ii) the organization's switch

-- NOT NULL DEFAULT TRUE: every tenant has sent email since 10.1, and turning
-- it off is the organization's own answer.
alter table public.organizations
  add column email_notifications boolean not null default true;

-- JOINS the column grants, as 0014's `uses_fire_ranks` did.
grant update (email_notifications) on table public.organizations to authenticated;

-- ------------------------------------------------------- (iii) the outbox filter

-- SECURITY DEFINER with an empty search path: it reads another member's
-- setting and the organization's switch directly, so the writing session's
-- row level security does not hide them. NULL skips the row silently.
create function private.filter_notification_outbox() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel = 'email' then
    if exists (
      select 1
        from public.organizations o
       where o.id = new.organization_id
         and not o.email_notifications
    ) then
      return null;
    end if;

    if exists (
      select 1
        from public.notification_settings s
       where s.organization_id = new.organization_id
         and s.member_id = new.recipient_member_id
         and not s.email
    ) then
      return null;
    end if;
  end if;

  return new;
end;
$$;

create trigger notification_outbox_filter
  before insert on public.notification_outbox
  for each row execute function private.filter_notification_outbox();

revoke execute on function private.touch_notification_settings() from public, anon, authenticated, service_role;
revoke execute on function private.filter_notification_outbox() from public, anon, authenticated, service_role;

-- ------------------------------------------------- (iv) the claim, switch-aware

-- 0043's claim, unchanged but for the switches. `create or replace` with the
-- same signature and return shape keeps its owner and its grants; they are
-- restated below all the same.
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

  -- 0044: a pending email row whose recipient or organization turned email
  -- off is never sent. Not in flight (unclaimed, or its lease expired), so no
  -- run that holds it is settled under; a row waiting out its backoff is
  -- settled now rather than at its `next_attempt_at`.
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
          -- Belt and braces: a row the settle above skipped (locked by a
          -- concurrent run) is still never returned while a switch is off.
          and not exists (
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
