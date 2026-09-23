-- 0008_member_status.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 1.6: deactivating a member changes the future and rewrites no history.
--
-- AD-2 classifies member active status as VERSIONED. Until this file the only
-- active state in the schema was `auth.users.banned_until`, which is
-- current-state: it cannot answer "was this member active on a given date", and
-- nothing in the product could set it. This migration adds the versioned table
-- and makes it the authority for active state:
--
--   * `member_status_versions` holds one row per change, effective from a date.
--     A version is never updated in place: there is no update policy, so that
--     verb matches no row. The status as at date D is the row with the greatest
--     `effective_from <= D`; a member with no row at all is active, so member
--     creation, the seed and the operator script write nothing here.
--   * Versions APPEND IN DATE ORDER AND EACH ONE CHANGES SOMETHING: a new
--     version is dated after the member's latest one, and its `active` differs
--     from the state it follows — and only while the member's latest version
--     is already in effect. So the history alternates, and at most ONE version,
--     the latest, is in the future: the one scheduled change.
--   * A version NOT YET IN EFFECT may be cancelled — deleted — by an admin of
--     the organization, while its date is after the organization's today. It has
--     changed no day yet, so deleting it rewrites nothing that has happened. A
--     version in effect is never deleted. Only a member's LATEST version is
--     cancellable: removing an earlier scheduled one would leave the next one
--     changing nothing, which is exactly what the insert rule refuses.
--   * `organization_today(uuid)` is the date in the organization's own zone.
--   * `member_active_on(uuid, date)` is the one reading of the table, used by
--     the helper, the hook, the policies and the zero-admins function.
--   * `current_member_access()` (0003) is EXTENDED, not replaced: same return
--     shape, same grants, and the `deleted_at` / `banned_until` clause stays and
--     is ANDed with the version covering today.
--   * `custom_access_token_hook` (0003) refuses to mint a token for a member who
--     is inactive today, so sign-in and refresh both end on the date.
--   * `refuse_organization_with_no_admin()` (0002) now requires an active admin
--     on every date from the organization's today onward.
--
-- NEVER ZERO ACTIVE ADMINS, ON ANY DATE. A change that makes an ADMIN inactive
-- from date D — a deactivation dated D, or cancelling their reactivation dated
-- D — is admitted only if ANOTHER admin is active on every date from D onward,
-- scheduled versions included: active on D and with no inactive version dated
-- after D (`member_active_from`). A check at "today" would let the only other
-- admin be scheduled out next week; a check on each admin's latest version
-- would count an admin who is out NOW with a reactivation scheduled, leaving
-- the days in between with nobody. A change to a non-admin never consults the
-- rule.
--
-- WHY NO REFUSAL CARRIES ITS OWN CODE HERE. Every rule on the insert is a WITH
-- CHECK clause of one policy, so every refusal arrives as 42501, and a refused
-- cancellation deletes zero rows. AD-3 permits exactly one constraint trigger
-- and 0002 spent it; the named messages the surface shows are the surface's
-- reading of what it sent, and these policies are what make each of them true
-- whoever calls.
--
-- WHAT THIS DOES NOT DO. It writes nothing to GoTrue: no ban, no session
-- revocation (GoTrue offers none without a password change). A token minted
-- before the date keeps authenticating to GoTrue's own endpoints until it
-- expires, and reads no organization data, because every policy re-reads the
-- helper on every statement (AD-10).

create table member_status_versions (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  -- A composite foreign key to 0002:157's unique (organization_id, id), so a
  -- version naming another tenant's member is unrepresentable rather than
  -- merely refused by a policy.
  member_id uuid not null,

  active boolean not null,

  -- A date, never an instant (the conventions). Whether it may lie in the past
  -- is not a property of the row but of the moment it is written, which is why
  -- that rule is the insert policy's rather than a check. Finiteness IS a
  -- property of the row: `infinity` would sort after every real date and make
  -- the member's status unreadable by the surface, and a five-digit year is no
  -- date an `<input type="date">` or an ISO string can carry.
  effective_from date not null,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the policy pins `created_by` as well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  constraint member_status_versions_member_fkey
    foreign key (organization_id, member_id)
    references members (organization_id, id)
    on delete cascade,

  constraint member_status_versions_effective_from_finite
    check (isfinite(effective_from) and effective_from < date '10000-01-01'),

  -- One version per member per date. Two rows for one date would leave the
  -- status as at that date undefined. It is also the index every read uses.
  constraint member_status_versions_member_id_effective_from_key
    unique (member_id, effective_from)
);

alter table member_status_versions enable row level security;

-- Q3: every policy below filters by the tenant first, and the unique index
-- leads with `member_id`, so the tenant column gets its own index.
create index member_status_versions_organization_id_idx
  on member_status_versions (organization_id);

-- ------------------------------------------------------------------ the readers

-- WHY THE THREE ROW READERS BELOW ARE VOLATILE PL/pgSQL. The policies judge a
-- new or cancelled version against the member's history, and one statement can
-- carry several rows: a PostgREST insert takes a JSON array. A STABLE function,
-- or a SQL one the planner inlines into the policy, reads the statement's own
-- snapshot and so cannot see a row the same statement wrote a moment earlier —
-- which let one request append two deactivations for one member, or deactivate
-- two admins who each counted the other as remaining (verified against the
-- running stack). A VOLATILE PL/pgSQL function takes a fresh snapshot per
-- query and sees them, so every row of a multi-row write is judged against the
-- rows before it, exactly as separate statements would be.

-- The date in an organization's own zone, or UTC's when the zone cannot be
-- resolved.
--
-- WHY A FALLBACK RATHER THAN A RAISE. `organizations.timezone` is deliberately
-- unchecked (0002:89-92), and this function is reached from the access token
-- hook. A raise there would lock the whole organization out of signing in over
-- a typo on the settings surface; answering UTC's date is off by at most a day
-- and keeps every account working. The unknown-zone error is
-- `invalid_parameter_value`, and it is the only one caught.
--
-- SECURITY INVOKER. It is reached from the helper, the hook and the trigger
-- function, which all run as the owner, and from the policies below as an
-- active admin, who can read their own organization's row. A caller naming
-- another organization reads no row and gets null, which no comparison accepts.
create function public.organization_today(organization uuid) returns date
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  zone text;
begin
  select o.timezone into zone from public.organizations o where o.id = organization;

  if zone is null then
    return null;
  end if;

  begin
    return (now() at time zone zone)::date;
  exception when invalid_parameter_value then
    return (now() at time zone 'UTC')::date;
  end;
end;
$$;

-- Whether a member is active on a date: the version with the greatest
-- `effective_from` on or before it, and active when there is none.
--
-- `'infinity'::date` as the date is the member's LATEST state, which is what
-- the insert policy's changes-something rule compares against.
--
-- SECURITY INVOKER, so a session learns nothing through it that the select
-- policy below would not already show it.
create function public.member_active_on(member uuid, on_date date) returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return coalesce(
    (select v.active
       from public.member_status_versions v
      where v.member_id = member
        and v.effective_from <= on_date
      order by v.effective_from desc
      limit 1),
    true
  );
end;
$$;

-- Whether a member is active on EVERY date from `from_date` onward: active on
-- that date, and no inactive version dated after it. The reading the
-- never-zero-admins rule is made of.
--
-- A FUNCTION, not a subquery in the policy, because a policy on this table
-- that selects from this table is refused by PostgreSQL as recursion. INVOKER
-- for the reason `member_active_on` is.
create function public.member_active_from(member uuid, from_date date) returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return public.member_active_on(member, from_date)
     and not exists (
       select 1
         from public.member_status_versions v
        where v.member_id = member
          and v.effective_from > from_date
          and not v.active
     );
end;
$$;

-- The date of a member's latest version, or null when they have none. What
-- the date-order rule compares a new version against, and what makes only the
-- latest version cancellable.
create function public.member_latest_version(member uuid) returns date
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  return (
    select max(v.effective_from)
      from public.member_status_versions v
     where v.member_id = member
  );
end;
$$;

-- The same explicit grants 0003 writes, for the same reason: Supabase's default
-- privileges grant EXECUTE to `anon`, `authenticated` and `service_role`
-- individually. `authenticated` keeps it because the policies below call every
-- one of them as the querying role.
revoke execute on function public.organization_today(uuid) from public;
revoke execute on function public.organization_today(uuid) from anon;
revoke execute on function public.organization_today(uuid) from service_role;
grant execute on function public.organization_today(uuid) to authenticated;

revoke execute on function public.member_active_on(uuid, date) from public;
revoke execute on function public.member_active_on(uuid, date) from anon;
revoke execute on function public.member_active_on(uuid, date) from service_role;
grant execute on function public.member_active_on(uuid, date) to authenticated;

revoke execute on function public.member_active_from(uuid, date) from public;
revoke execute on function public.member_active_from(uuid, date) from anon;
revoke execute on function public.member_active_from(uuid, date) from service_role;
grant execute on function public.member_active_from(uuid, date) to authenticated;

revoke execute on function public.member_latest_version(uuid) from public;
revoke execute on function public.member_latest_version(uuid) from anon;
revoke execute on function public.member_latest_version(uuid) from service_role;
grant execute on function public.member_latest_version(uuid) to authenticated;

-- ------------------------------------------------------ the helper, extended

-- 0003's helper with one more conjunct. `create or replace` keeps its owner,
-- its grants and its return shape, which `admin-auth/authorize.ts` validates
-- exactly. The version is read as at the ORGANIZATION's today.
--
-- STILL STABLE, THOUGH IT CALLS A VOLATILE READER. Volatility is a promise to
-- the planner, not a rule PostgreSQL enforces on callees, and the promise holds:
-- within one statement this answers the same one row for the same caller, and
-- nothing it reaches writes. It is SECURITY DEFINER, so it is never inlined into
-- the calling query, and its one call to `member_active_on` reads a single
-- member's versions. Marking it volatile would cost every policy that reads it
-- the initplan it is evaluated as today — once per statement — for nothing.
create or replace function public.current_member_access()
returns table (organization_id uuid, member_role text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id,
         m.role,
         (u.deleted_at is null and (u.banned_until is null or u.banned_until <= now()))
           and public.member_active_on(m.id, public.organization_today(m.organization_id))
    from public.members m
    join auth.users u on u.id = m.auth_user_id
   where m.auth_user_id = (select auth.uid())
$$;

-- ------------------------------------------------------- the hook, extended

-- 0003's hook with one refusal. A member inactive today in their
-- organization's zone gets no token, on sign-in and on refresh alike.
--
-- THE REFUSAL IS A 403, and the number is load-bearing. The SPA shows the
-- generic credentials message for every 4xx but 429 (`sign-in.ts`), so a
-- deactivated account is indistinguishable from a wrong password — a distinct
-- message would tell an anonymous caller which usernames exist. A 5xx or a
-- missing `http_code` would read as an outage instead.
--
-- THE MESSAGE SAYS NOTHING ABOUT THE ACCOUNT. A direct GoTrue caller who
-- holds a correct password would otherwise learn from it that the account
-- exists and is deactivated; `SIGN_IN_REFUSED` is true of every refusal.
--
-- It never raises: `organization_today` falls back to UTC rather than failing.
--
-- STABLE while calling a volatile reader, for the reason the helper above
-- gives: SECURITY DEFINER, never inlined, and a single-row read of one
-- member's versions per call.
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  signer_claims       jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  signer_organization uuid;
  signer_member       uuid;
begin
  select m.organization_id, m.id
    into signer_organization, signer_member
    from public.members m
   where m.auth_user_id = (event ->> 'user_id')::uuid;

  if signer_organization is null then
    return jsonb_set(event, '{claims}', signer_claims - 'organization_id');
  end if;

  if not public.member_active_on(
    signer_member,
    coalesce(public.organization_today(signer_organization), (now() at time zone 'UTC')::date)
  ) then
    return jsonb_build_object(
      'error',
      jsonb_build_object('http_code', 403, 'message', 'SIGN_IN_REFUSED')
    );
  end if;

  return jsonb_set(
    event,
    '{claims}',
    jsonb_set(signer_claims, '{organization_id}', to_jsonb(signer_organization::text))
  );
end;
$$;

-- ------------------------------------------ Q6, on every date from today on

-- 0002's function body with one change: the organization must have an active
-- admin on every date from its own today onward, scheduled versions included.
-- The trigger that calls it is untouched, so this is still the one constraint
-- trigger AD-3 permits. It is what refuses demoting an admin while the only
-- other admin is out — today, or on some later date.
--
-- READ DATE BY DATE, NOT ADMIN BY ADMIN. Status only changes on a version's
-- date, so "every date from today" is today plus each admin version dated
-- after it, and each of those days needs SOME admin active on it. The
-- policies below are stricter — one other admin must cover every date from the
-- change on — so any state they admit passes here. Reading this one admin by
-- admin as well would refuse an unrelated edit (this trigger fires on every
-- update and delete of `members`) in an organization whose admins hand over to
-- one another across the calendar, which those policies do admit.
create or replace function refuse_organization_with_no_admin() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  losing_organization uuid := old.organization_id;
  organization_day    date;
begin
  if not exists (select 1 from public.organizations where id = losing_organization) then
    return null;
  end if;

  organization_day := coalesce(
    public.organization_today(losing_organization),
    (now() at time zone 'UTC')::date
  );

  if not exists (
    select 1
      from (
        select organization_day as day
        union
        select v.effective_from
          from public.member_status_versions v
          join public.members a on a.id = v.member_id
         where a.organization_id = losing_organization
           and a.role = 'admin'
           and v.effective_from > organization_day
      ) as change_point
     where not exists (
       select 1
         from public.members a
        where a.organization_id = losing_organization
          and a.role = 'admin'
          and public.member_active_on(a.id, change_point.day)
     )
  ) then
    return null;
  end if;

  raise exception using
    errcode = 'check_violation',
    message = 'ORGANIZATION_WOULD_HAVE_NO_ADMIN',
    detail = losing_organization::text;
end;
$$;

-- ------------------------------------------------------------- the policies

-- Any active member reads their own organization's versions: the list marks
-- inactive members, and the roster derivations of later epics select by date.
create policy member_status_versions_select_own_organization on public.member_status_versions
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
  );

-- The only way a version is written. Every rule of the story is one conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an active admin;
--   * the attribution, pinned to the caller;
--   * TODAY OR LATER in the organization's zone — a past date would rewrite
--     past rosters;
--   * AFTER the member's latest version, so versions append in date order;
--   * AT MOST ONE CHANGE SCHEDULED: the member's latest version is already in
--     effect, or there is none. A second future version on top of a scheduled
--     one would stack changes nobody can cancel in any order but reverse, and
--     the surface models exactly one scheduled change;
--   * CHANGING SOMETHING — `active` differs from the member's latest state;
--   * never the caller's own member row;
--   * a deactivation of an ADMIN from D needs another admin active on every
--     date from D onward.
create policy member_status_versions_insert_by_own_active_admin on public.member_status_versions
  for insert
  to authenticated
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
    and created_by = (select auth.uid())
    and effective_from >= public.organization_today(organization_id)
    and effective_from > coalesce(public.member_latest_version(member_id), '-infinity'::date)
    and coalesce(public.member_latest_version(member_id), '-infinity'::date)
          <= public.organization_today(organization_id)
    and active is distinct from public.member_active_on(member_id, 'infinity'::date)
    and not exists (
      select 1
        from public.members self
       where self.id = member_status_versions.member_id
         and self.auth_user_id = (select auth.uid())
    )
    and (
      active
      or not exists (
        select 1
          from public.members target
         where target.id = member_status_versions.member_id
           and target.role = 'admin'
      )
      or exists (
        select 1
          from public.members admin
         where admin.organization_id = member_status_versions.organization_id
           and admin.role = 'admin'
           and admin.id <> member_status_versions.member_id
           and public.member_active_from(admin.id, member_status_versions.effective_from)
      )
    )
  );

-- Cancelling a change that has not happened yet. The same tenant and role
-- rules as the insert, and:
--
--   * NOT YET IN EFFECT — dated after the organization's today. A version in
--     effect has already decided some day's status, and deleting it would
--     rewrite that day;
--   * the member's LATEST version, so the history left behind still changes
--     something at every row;
--   * never the caller's own row — cancelling one's own reactivation is a
--     self-deactivation;
--   * cancelling an ADMIN's reactivation dated D makes them inactive from D, so
--     it needs another admin active on every date from D onward, exactly as a
--     deactivation dated D would.
create policy member_status_versions_delete_scheduled_by_own_active_admin on public.member_status_versions
  for delete
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
    and effective_from > public.organization_today(organization_id)
    and effective_from = public.member_latest_version(member_id)
    and not exists (
      select 1
        from public.members self
       where self.id = member_status_versions.member_id
         and self.auth_user_id = (select auth.uid())
    )
    and (
      not active
      or not exists (
        select 1
          from public.members target
         where target.id = member_status_versions.member_id
           and target.role = 'admin'
      )
      or exists (
        select 1
          from public.members admin
         where admin.organization_id = member_status_versions.organization_id
           and admin.role = 'admin'
           and admin.id <> member_status_versions.member_id
           and public.member_active_from(admin.id, member_status_versions.effective_from)
      )
    )
  );

-- ------------------------------------------------------- the writable columns

-- A session names the four facts and nothing else. `created_by` and
-- `created_at` come from their defaults (AD-11), so the grant is the column
-- rule and the policy is the row rule — the split 0004 makes for
-- `organizations`. Delete stays a table grant; the policy above is what
-- narrows it to a scheduled version.
--
-- SUPABASE'S DEFAULT PRIVILEGES grant every table privilege to `anon` and
-- `authenticated`. RLS already matches no row for the verbs no policy opens,
-- but a privilege nothing needs is one a later policy could open by accident:
-- no session updates, truncates, references or triggers on this table, and
-- `anon` reads and writes none of it.
revoke update, truncate, references, trigger on table public.member_status_versions
  from anon, authenticated;
revoke select, insert, delete on table public.member_status_versions from anon;
revoke insert on table public.member_status_versions from authenticated;

grant insert (
  organization_id,
  member_id,
  active,
  effective_from
) on table public.member_status_versions to authenticated;
