-- 0067_calendar_feed_tokens.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 16.3: a member's feed token is a revocable secret (D-S1 ratified
-- 2026-11-21 at its defaults; AD-14 `calendar-feed`, AD-11, AD-17).
--
-- A calendar app sends no session, so the feed URL itself authorizes. Its
-- secret is a TOKEN: 32 bytes from `extensions.gen_random_bytes`, written as
-- unpadded base64url (43 characters), returned once to the member who asked
-- and never again. Only `sha256(convert_to(token, 'UTF8'))` is stored: the
-- hash of the 43-character text, never of the decoded bytes.
--
-- THE HASH IS A CREDENTIAL TOO. Anyone with the publishable key may call the
-- lookup, so whoever reads a stored hash could fetch the feed. No session role
-- holds any privilege on the table, and no policy, view, read or audit row
-- returns `token_hash`. Every access is one of the definers below.
--
-- WHAT THIS FILE DOES, in order:
--
--   (i)    `calendar_feed_tokens`: one row per token ever issued. At most one
--          UNREVOKED row per member (a partial unique key). No expiry. Both
--          keys cascade, as 0045's devices: a deleted member's or
--          organization's tokens go with it.
--   (ii)   `create_calendar_feed_token()`: the caller's own token, created or
--          regenerated (the old one revoked in the same transaction), returned
--          once. Any active account of the claimed organization, with or
--          without a team (ratified: a member with no team may be lent).
--   (iii)  `revoke_own_calendar_feed_token()`: the member turns the feed off.
--          `revoke_member_calendar_feed_token(member)`: an active admin turns
--          off a member's feed in their organization, and never sees it.
--   (iv)   `calendar_feed_status()` and `member_calendar_feed_status(member)`:
--          `{ live, created_at, last_fetched_at }` and nothing else.
--   (v)    `calendar_feed_inputs(p_token_hash)`: the lookup, `anon`'s one
--          function. 64 lowercase hex characters in; on a hit the window and
--          AD-19's assembly out; null for every miss.
--   (vi)   The status trigger: a deactivation already in effect when it is
--          written revokes the member's live token in the same transaction,
--          and a reactivation revokes any token still live.
--   (vii)  The change history (AD-11): the table is audited by its own
--          recorder, which drops `token_hash` (a credential) and
--          `last_fetched_at` (no change anybody made) from both rows, so an
--          update of `last_fetched_at` alone records nothing.
--
-- SERIALIZED PER MEMBER. Creation, both revokes and the status trigger take
-- one transaction-scoped advisory lock per member
-- (`shift.calendar_feed_tokens:<member>`) before they read or write, so two
-- regenerations cannot both survive, and a creation racing a deactivation
-- either sees it and is refused or is revoked by it. The status trigger runs
-- under 0023's organization lock, and nothing here takes that lock after the
-- member's, so the order is always organization, then member.
--
-- THE LOOKUP IS NOT SUSPENSION-AWARE YET. AD-10 (Architect pass 2) names it
-- among `private.organization_live`'s callers; that helper does not exist
-- before epic 19, whose story re-creates the lookup over it.
--
-- DEPLOY ORDER: `db push` alone. No SPA or Edge Function change; 16.4's
-- `calendar-feed` is the lookup's first caller.

-- -------------------------------------------------------------- (i) the table

create table public.calendar_feed_tokens (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references public.organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  member_id uuid not null,

  -- SHA-256 of the token's 43-character text. Never readable by a session.
  token_hash bytea not null,

  -- AD-11. Written only by the definers below, from `auth.uid()`.
  created_by uuid not null,
  created_at timestamptz not null default now(),

  -- Revocation, the repository's removal pair (so the change history reads it
  -- as a removal): by the member, an admin, or the status trigger (the
  -- version's author). The author only with the instant.
  removed_by uuid,
  removed_at timestamptz,

  -- The lookup's last hit, at most every 15 minutes. Never recorded in the
  -- change history: no audit row holds it, and a stamp alone writes none.
  last_fetched_at timestamptz,

  constraint calendar_feed_tokens_token_hash_key unique (token_hash),

  constraint calendar_feed_tokens_token_hash_length
    check (octet_length(token_hash) = 32),

  constraint calendar_feed_tokens_removal_complete
    check (removed_by is null or removed_at is not null),

  -- To 0002's unique (organization_id, id): a token naming another tenant's
  -- member is unrepresentable. A token goes with its member.
  constraint calendar_feed_tokens_member_fkey
    foreign key (organization_id, member_id)
    references public.members (organization_id, id)
    on delete cascade
);

-- At most one live token per member, and the index every member read uses.
create unique index calendar_feed_tokens_one_live
  on public.calendar_feed_tokens (organization_id, member_id)
  where removed_at is null;

-- On, never forced, with NO policy: no session reads or writes a row.
alter table public.calendar_feed_tokens enable row level security;

-- Supabase's default privileges grant every table privilege to `anon`,
-- `authenticated` and `service_role`. Take them all, TRUNCATE included (no row
-- trigger sees it), so no role holds a table or column privilege on
-- `token_hash` or anything else.
revoke all on table public.calendar_feed_tokens from public, anon, authenticated, service_role;

-- ---------------------------------------------------- the per-member lock

-- The one lock key, stated once. Executable by nobody: the definers below,
-- owned by the migration role, call it.
create function private.lock_calendar_feed_tokens(p_member uuid) returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shift.calendar_feed_tokens:' || p_member::text, 0)
  );
$$;

revoke execute on function private.lock_calendar_feed_tokens(uuid) from public, anon, authenticated, service_role;

-- --------------------------------------------- (ii) create or regenerate

-- The caller's own token: any live one revoked, a new one issued, and its
-- text returned once. The hash alone is stored.
create function public.create_calendar_feed_token()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  own_member uuid;
  token text;
begin
  if claimed is not null then
    select m.id
      into own_member
      from public.members m
     where m.organization_id = claimed
       and m.auth_user_id = (select auth.uid());
  end if;

  if own_member is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'CALENDAR_FEED_REFUSED';
  end if;

  -- The lock before the access check, so a deactivation committed while we
  -- waited is seen by the check's own snapshot.
  perform private.lock_calendar_feed_tokens(own_member);

  if not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'CALENDAR_FEED_REFUSED';
  end if;

  update public.calendar_feed_tokens t
     set removed_by = (select auth.uid()),
         removed_at = now()
   where t.organization_id = claimed
     and t.member_id = own_member
     and t.removed_at is null;

  -- 32 random bytes are 44 base64 characters with one `=`: never a line
  -- break, and 43 after the padding is trimmed.
  token := pg_catalog.rtrim(
    pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
    '='
  );

  insert into public.calendar_feed_tokens (organization_id, member_id, token_hash, created_by)
  values (claimed, own_member, pg_catalog.sha256(pg_catalog.convert_to(token, 'UTF8')), (select auth.uid()));

  return token;
end;
$$;

revoke execute on function public.create_calendar_feed_token() from public, anon, service_role;
grant execute on function public.create_calendar_feed_token() to authenticated;

-- ------------------------------------------------------------ (iii) revoke

-- The member turns their own feed off. Nothing live is no error.
create function public.revoke_own_calendar_feed_token()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  own_member uuid;
begin
  if claimed is not null then
    select m.id
      into own_member
      from public.members m
     where m.organization_id = claimed
       and m.auth_user_id = (select auth.uid());
  end if;

  if own_member is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'CALENDAR_FEED_REFUSED';
  end if;

  perform private.lock_calendar_feed_tokens(own_member);

  if not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'CALENDAR_FEED_REFUSED';
  end if;

  update public.calendar_feed_tokens t
     set removed_by = (select auth.uid()),
         removed_at = now()
   where t.organization_id = claimed
     and t.member_id = own_member
     and t.removed_at is null;
end;
$$;

revoke execute on function public.revoke_own_calendar_feed_token() from public, anon, service_role;
grant execute on function public.revoke_own_calendar_feed_token() to authenticated;

-- An active admin turns off a member's feed in the claimed organization. A
-- member of another organization, or no member, is one answer: P0002.
create function public.revoke_member_calendar_feed_token(p_member uuid)
returns void
language plpgsql
volatile
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
      message = 'CALENDAR_FEED_REFUSED';
  end if;

  if p_member is null or not exists (
    select 1
      from public.members m
     where m.organization_id = claimed
       and m.id = p_member
  ) then
    raise exception using
      errcode = 'no_data_found',
      message = 'CALENDAR_FEED_MEMBER_UNKNOWN';
  end if;

  perform private.lock_calendar_feed_tokens(p_member);

  update public.calendar_feed_tokens t
     set removed_by = (select auth.uid()),
         removed_at = now()
   where t.organization_id = claimed
     and t.member_id = p_member
     and t.removed_at is null;
end;
$$;

revoke execute on function public.revoke_member_calendar_feed_token(uuid) from public, anon, service_role;
grant execute on function public.revoke_member_calendar_feed_token(uuid) to authenticated;

-- ------------------------------------------------------------- (iv) state

-- Whether a member's feed may be served: active in the organization's today
-- (0008's one reading of the status versions) AND an account that may sign in,
-- `current_member_access()`'s own clause (not deleted, not banned). Stated
-- once, for the state and the lookup. Executable by nobody.
create function private.calendar_feed_member_live(p_organization uuid, p_member uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.members m
      join auth.users u on u.id = m.auth_user_id
     where m.organization_id = p_organization
       and m.id = p_member
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until <= now())
       and public.member_active_on(m.id, public.organization_today(m.organization_id))
  )
$$;

revoke execute on function private.calendar_feed_member_live(uuid, uuid) from public, anon, authenticated, service_role;

-- A member's feed state, the one shape both reads return. LIVE is what the
-- lookup would serve: an unrevoked token whose member is live
-- (`calendar_feed_member_live`). The stamps are the live token's, else null. No id,
-- no hash, no token. Executable by nobody: the two reads below call it.
create function private.calendar_feed_state(p_organization uuid, p_member uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  found_created timestamptz;
  found_fetched timestamptz;
  is_live boolean;
begin
  select t.created_at, t.last_fetched_at, true
    into found_created, found_fetched, is_live
    from public.calendar_feed_tokens t
   where t.organization_id = p_organization
     and t.member_id = p_member
     and t.removed_at is null
     and private.calendar_feed_member_live(t.organization_id, t.member_id);

  if not coalesce(is_live, false) then
    return pg_catalog.jsonb_build_object('live', false, 'created_at', null, 'last_fetched_at', null);
  end if;

  return pg_catalog.jsonb_build_object(
    'live', true,
    'created_at', found_created,
    'last_fetched_at', found_fetched
  );
end;
$$;

revoke execute on function private.calendar_feed_state(uuid, uuid) from public, anon, authenticated, service_role;

-- The caller's own feed state.
create function public.calendar_feed_status()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  own_member uuid;
begin
  if claimed is not null and exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
  ) then
    select m.id
      into own_member
      from public.members m
     where m.organization_id = claimed
       and m.auth_user_id = (select auth.uid());
  end if;

  if own_member is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'CALENDAR_FEED_REFUSED';
  end if;

  return private.calendar_feed_state(claimed, own_member);
end;
$$;

revoke execute on function public.calendar_feed_status() from public, anon, service_role;
grant execute on function public.calendar_feed_status() to authenticated;

-- An active admin's read of a member's feed state in the claimed organization.
create function public.member_calendar_feed_status(p_member uuid)
returns jsonb
language plpgsql
volatile
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
      message = 'CALENDAR_FEED_REFUSED';
  end if;

  if p_member is null or not exists (
    select 1
      from public.members m
     where m.organization_id = claimed
       and m.id = p_member
  ) then
    raise exception using
      errcode = 'no_data_found',
      message = 'CALENDAR_FEED_MEMBER_UNKNOWN';
  end if;

  return private.calendar_feed_state(claimed, p_member);
end;
$$;

revoke execute on function public.member_calendar_feed_status(uuid) from public, anon, service_role;
grant execute on function public.member_calendar_feed_status(uuid) to authenticated;

-- ------------------------------------------------------------ (v) the lookup

-- `calendar-feed`'s one read (AD-14). It receives only the hash, as 64
-- lowercase hex characters, and decodes it itself, so no `bytea` wire format
-- can turn every fetch into a silent miss. VOLATILE, so PostgREST must POST
-- it (a GET `/rpc` is read-only), and the plaintext never reaches Postgres.
--
-- A malformed, unknown, revoked or replaced hash, or a member not active in
-- the organization's today (or whose account is deleted or banned), is the
-- same null with no write. On a hit the row
-- is locked (a revoke committing meanwhile wins), `last_fetched_at` is set
-- when it is null or older than 15 minutes, and the answer is the window,
-- today − 31 through today + 182 inclusive (D2), and AD-19's assembly for it.
create function public.calendar_feed_inputs(p_token_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  hit_id uuid;
  hit_organization uuid;
  hit_member uuid;
  today date;
  window_from date;
  window_to date;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select t.id, t.organization_id, t.member_id
    into hit_id, hit_organization, hit_member
    from public.calendar_feed_tokens t
   where t.token_hash = pg_catalog.decode(p_token_hash, 'hex')
     and t.removed_at is null
     and private.calendar_feed_member_live(t.organization_id, t.member_id)
     for update of t;

  if hit_id is null then
    return null;
  end if;

  update public.calendar_feed_tokens t
     set last_fetched_at = now()
   where t.id = hit_id
     and (t.last_fetched_at is null or t.last_fetched_at < now() - interval '15 minutes');

  today := public.organization_today(hit_organization);
  window_from := today - 31;
  window_to := today + 182;

  return pg_catalog.jsonb_build_object(
    'window', pg_catalog.jsonb_build_object('from', window_from, 'to', window_to),
    'inputs', private.member_schedule_inputs(hit_member, window_from, window_to)
  );
end;
$$;

revoke execute on function public.calendar_feed_inputs(text) from public, authenticated, service_role;
grant execute on function public.calendar_feed_inputs(text) to anon;

-- ---------------------------------------------- (vi) deactivation, reactivation

-- AFTER INSERT on `member_status_versions`, every writer's (0041's reason: a
-- deactivation is a plain RLS insert). A deactivation dated in the future can
-- be cancelled (0008), so it revokes nothing: the lookup's "active in the
-- organization's today" ends the feed on its date. An inactive version already
-- in effect when it is written revokes the live token now; an active version
-- written after an inactive one (a reactivation) revokes any token still live,
-- so a link issued before a deactivation never works again.
create function private.revoke_calendar_feed_on_status_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (not new.active and new.effective_from <= public.organization_today(new.organization_id))
     or (new.active and exists (
           select 1
             from public.member_status_versions earlier
            where earlier.organization_id = new.organization_id
              and earlier.member_id = new.member_id
              and not earlier.active
              and earlier.effective_from < new.effective_from
         )) then
    perform private.lock_calendar_feed_tokens(new.member_id);

    update public.calendar_feed_tokens t
       set removed_by = new.created_by,
           removed_at = now()
     where t.organization_id = new.organization_id
       and t.member_id = new.member_id
       and t.removed_at is null;
  end if;

  return null;
end;
$$;

revoke execute on function private.revoke_calendar_feed_on_status_change() from public, anon, authenticated, service_role;

create trigger member_status_versions_revoke_calendar_feed
  after insert on public.member_status_versions
  for each row
  execute function private.revoke_calendar_feed_on_status_change();

-- ------------------------------------------------ (vii) the change history

-- 0061's recorder, for this table alone, with `token_hash` and
-- `last_fetched_at` dropped from both rows: no audit row holds hash material
-- or a fetch. 0061's own recorder is never replaced (its scaffold pin), so
-- this is a second one, read by 14.2 as any audited table.
create function private.record_calendar_feed_token_event() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op in ('UPDATE', 'DELETE') then pg_catalog.to_jsonb(old) - 'token_hash' - 'last_fetched_at' end;
  new_row jsonb := case when tg_op in ('INSERT', 'UPDATE') then pg_catalog.to_jsonb(new) - 'token_hash' - 'last_fetched_at' end;
  written jsonb := coalesce(new_row, old_row);
begin
  insert into public.audit_events (organization_id, table_name, operation, row_id, old_row, new_row,
                                   actor, session_role, origin, transaction_id)
  values ((written ->> 'organization_id')::uuid, tg_table_name, tg_op, written ->> 'id', old_row, new_row,
          auth.uid(), pg_catalog.current_setting('role'), 'trigger', pg_catalog.pg_current_xact_id());
  return null;
end;
$$;

revoke execute on function private.record_calendar_feed_token_event() from public, anon, authenticated, service_role;

create trigger calendar_feed_tokens_audit after insert or delete on public.calendar_feed_tokens
  for each row execute function private.record_calendar_feed_token_event();
-- A fetch stamp alone is not a change anybody made.
create trigger calendar_feed_tokens_audit_update after update on public.calendar_feed_tokens
  for each row when ((pg_catalog.to_jsonb(old) - 'last_fetched_at') is distinct from (pg_catalog.to_jsonb(new) - 'last_fetched_at'))
  execute function private.record_calendar_feed_token_event();
