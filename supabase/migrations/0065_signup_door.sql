-- 0065_signup_door.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 19.1: the signup door's database switch (AD-21, AD-12, AD-10). Three
-- things, and nothing writes a domain table:
--
-- 1. ONE ADDRESS PREDICATE (AD-12). `private.address_kind(address)` answers
--    `synthesized`, `email` or `malformed`, and `private.is_synthesized_address`
--    is its first answer as a boolean. The rule, word for word the one Kong's
--    rendered Lua and (from 19.2) the SPA state, and bound to them by
--    `test/fixtures/synthesized-addresses.json`:
--
--      * trim ASCII white space (tab, line feed, vertical tab, form feed,
--        carriage return, space) and lower-case ASCII letters only. A Unicode
--        case fold could make the homes disagree (D5), so `lower()` is not used:
--        `translate` over the 26 letters is the same in every locale;
--      * malformed: no `@`, more than one `@`, a double or single quote, or an
--        empty local part or domain;
--      * the domain is what follows the `@`, with one trailing `.` removed;
--      * synthesized: that domain is `shift.invalid` or ends in `.shift.invalid`.
--
--    Immutable, reads no table, and executable by no session role: the hook
--    below (a definer) is its only caller today, and 19.3's
--    `create_organization` will be another.
--
-- 2. THE SWITCH. `private.signup_settings` is a singleton (`id boolean primary
--    key default true check (id)`), seeded here CLOSED: `open = false`,
--    `accounts_per_day = 100`, `organizations_per_day = 20`,
--    `attempts_per_account = 10`. No session role holds any privilege on it
--    (the revokes below name each one, because Supabase's defaults grant them
--    one by one), and RLS is on with no policy. The operator opens it on
--    staging by SQL over the tailnet (DEPLOY.md §9.9); `supabase/seed.sql`
--    opens it on the local stack only. Closing it is the circuit breaker: the
--    hook refuses every new account at once, and 19.3's `create_organization`
--    every new organization. It carries no `organization_id`, so it is outside
--    the change history (AD-11 names it excluded; the scaffold pins it).
--
-- 3. THE BEFORE-USER-CREATED HOOK (AD-21). `public.before_user_created_hook`
--    is `SECURITY DEFINER` with `search_path = ''`, executable by
--    `supabase_auth_admin` only, with 0003's access token hook grants. GoTrue
--    v2.196.0 calls it on every user-creating path but `POST /admin/users`
--    (so `admin-auth`'s `createUser` and the operator script are unaffected),
--    and only for an address with no user yet. It answers ONE refusal,
--    `{"error": {"http_code": 403, "message": "SIGNUP_REFUSED"}}`, for every
--    reason, so the reason is never named:
--
--      * `signup_settings` is missing, or `open` is false;
--      * the address is synthesized or malformed (1);
--      * its local part, lower-cased ASCII-only, would fail
--        `members_username_check` (19.3's Founding Admin username, which
--        19.3 derives the same way);
--      * the last 24 hours already hold `accounts_per_day` auth accounts with
--        no `members` row (D4). Outside a transaction with the insert, so the
--        ceiling is approximate under concurrency (AD-21 accepts it).
--
--    Otherwise it answers `{}`. It writes nothing. ORDER RULE (AD-10): this
--    migration is pushed before GoTrue starts or restarts with
--    `GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true` (D2: on in every
--    environment, because the door is shut by `GOTRUE_DISABLE_SIGNUP` and by
--    the switch above, never by the hook being off).

-- ------------------------------------------------------------ 1. the predicate

create function private.address_kind(address text) returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  normalized  text;
  local_part  text;
  domain_part text;
begin
  if address is null then
    return 'malformed';
  end if;

  normalized := pg_catalog.translate(
    pg_catalog.btrim(address, pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11)
                              || pg_catalog.chr(12) || pg_catalog.chr(13) || pg_catalog.chr(32)),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  );

  if pg_catalog.strpos(normalized, '"') > 0 or pg_catalog.strpos(normalized, '''') > 0 then
    return 'malformed';
  end if;
  if pg_catalog.length(normalized) - pg_catalog.length(pg_catalog.replace(normalized, '@', '')) <> 1 then
    return 'malformed';
  end if;

  local_part := pg_catalog.split_part(normalized, '@', 1);
  domain_part := pg_catalog.split_part(normalized, '@', 2);
  if pg_catalog.right(domain_part, 1) = '.' then
    domain_part := pg_catalog.left(domain_part, -1);
  end if;
  if local_part = '' or domain_part = '' then
    return 'malformed';
  end if;

  if domain_part = 'shift.invalid' or pg_catalog.right(domain_part, 14) = '.shift.invalid' then
    return 'synthesized';
  end if;
  return 'email';
end;
$$;

create function private.is_synthesized_address(address text) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select private.address_kind(address) = 'synthesized';
$$;

revoke execute on function private.address_kind(text) from public;
revoke execute on function private.address_kind(text) from anon;
revoke execute on function private.address_kind(text) from authenticated;
revoke execute on function private.address_kind(text) from service_role;
revoke execute on function private.is_synthesized_address(text) from public;
revoke execute on function private.is_synthesized_address(text) from anon;
revoke execute on function private.is_synthesized_address(text) from authenticated;
revoke execute on function private.is_synthesized_address(text) from service_role;

-- --------------------------------------------------------------- 2. the switch

create table private.signup_settings (
  id                    boolean primary key default true check (id),
  open                  boolean not null default false,
  accounts_per_day      integer not null default 100 check (accounts_per_day > 0),
  organizations_per_day integer not null default 20 check (organizations_per_day > 0),
  attempts_per_account  integer not null default 10 check (attempts_per_account > 0)
);

alter table private.signup_settings enable row level security;

revoke all on table private.signup_settings from public;
revoke all on table private.signup_settings from anon;
revoke all on table private.signup_settings from authenticated;
revoke all on table private.signup_settings from service_role;

-- Seeded closed. `supabase/seed.sql` opens it on the local stack only.
insert into private.signup_settings (id) values (true);

-- ------------------------------------------------------------------ 3. the hook

create function public.before_user_created_hook(event jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  refused   constant jsonb := '{"error": {"http_code": 403, "message": "SIGNUP_REFUSED"}}'::jsonb;
  settings  private.signup_settings%rowtype;
  address   text := event -> 'user' ->> 'email';
  candidate text;
  recent    bigint;
begin
  select s.* into settings from private.signup_settings s where s.id;
  if not found or not settings.open then
    return refused;
  end if;

  if private.address_kind(address) <> 'email' then
    return refused;
  end if;

  -- 19.3's Founding Admin username: the local part of the trimmed address,
  -- lower-cased ASCII-only as the predicate does (D5), then held to exactly
  -- what `members_username_check` (0007) would refuse on it: white space or
  -- an `@`, or a letter `lower()` would still change (a non-ASCII capital).
  -- An account that could never found an organization is never created.
  candidate := pg_catalog.translate(
    pg_catalog.split_part(
      pg_catalog.btrim(address, pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11)
                                || pg_catalog.chr(12) || pg_catalog.chr(13) || pg_catalog.chr(32)),
      '@', 1),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  );
  if not (candidate ~ '^[^[:space:]@]+$' and candidate = pg_catalog.lower(candidate)) then
    return refused;
  end if;

  select pg_catalog.count(*) into recent
    from auth.users u
   where u.created_at > pg_catalog.now() - interval '24 hours'
     and not exists (select 1 from public.members m where m.auth_user_id = u.id);
  if recent >= settings.accounts_per_day then
    return refused;
  end if;

  return '{}'::jsonb;
end;
$$;

-- 0003's grants, for the same reasons: Supabase's defaults grant EXECUTE on a
-- new `public` function to each request role one by one, so each is revoked
-- by name, and the auth service is the only grantee.
revoke execute on function public.before_user_created_hook(jsonb) from public;
revoke execute on function public.before_user_created_hook(jsonb) from anon;
revoke execute on function public.before_user_created_hook(jsonb) from authenticated;
revoke execute on function public.before_user_created_hook(jsonb) from service_role;
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;
