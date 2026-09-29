-- 0024_name_key.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Every name check strips all whitespace, and name uniqueness compares
-- Unicode-normalized names.
--
-- THE GAP THIS CLOSES. 0002, 0009, 0012 and 0013 refused a blank name with
-- `btrim(name) <> ''` and keyed name uniqueness on `lower(btrim(name))`.
-- `btrim` strips the space character alone, so a direct API caller could store
-- a name made only of tabs, line breaks or NBSP, and could store `'Tim\t'`
-- beside an active `'Tim'`. `lower` alone also left NFC `Noć` and NFD `Noć`
-- (`c` + U+0301) as two distinct active names that render identically.
--
-- ONE HELPER, ONE WHITESPACE CLASS. `private.name_key(text)` trims, then
-- normalizes to NFC, then lower-cases. Every name check below is
-- `private.name_key(name) <> ''` and every name unique index is on
-- `private.name_key(name)`, so the class is written exactly once in SQL. The
-- client mirror is `apps/web/src/utils/name.ts` (and its Deno copy in
-- `supabase/functions/admin-auth/operations.ts`); `test/name-key.test.ts`
-- asserts the database and the client agree on every BMP code point. The
-- architecture spine's Consistency Conventions make this the rule for every
-- later name column.
--
-- THE CLASS, AND WHY IT IS SPELLED OUT. It is the union of what either side
-- counts as white space:
--
--   * JavaScript's `String.prototype.trim` (every client and the Edge Function
--     trim with it): U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A, U+2028,
--     U+2029, U+202F, U+205F, U+3000 and U+FEFF;
--   * Postgres's own `\s` and `[[:space:]]` on this stack (ICU): the same,
--     less U+FEFF, plus U+001C–001F and U+0085 (NEL).
--
-- Verified on the local stack (Postgres 17, ICU `en-US`): `\s` and
-- `[[:space:]]` match U+00A0, U+2007 and U+202F and do NOT match U+FEFF. The
-- class is a literal list rather than `[[:space:]]` because the named class
-- follows the collation: under `C` or a libc `C.utf8` it matches ASCII alone,
-- so U+00A0 would stop being white space on a stack provisioned differently.
--
-- TRIMMED WITH `btrim(name, <the list>)`, NOT A REGEX. An anchored
-- `[class]+$` retries from every run start, so `'a' || repeat(' ', n) || 'b'`
-- costs O(n²); `btrim` with a character list is linear in the input.
--
-- WHAT "IMMUTABLE" RESTS ON. The trim half is collation-independent: a
-- literal list compares code points. The other two halves are not frozen
-- forever: `lower()` follows the database's collation and its ICU version, and
-- `normalize()` follows the Unicode tables Postgres was built with. A major
-- Postgres or ICU upgrade that changes either may require a REINDEX of the
-- three name indexes (and a re-validation of the checks). `normalize()` also
-- requires a UTF-8 server encoding, which every Supabase database has.
--
-- A SCHEMA POSTGREST DOES NOT EXPOSE. `supabase/config.toml` exposes `public`
-- and `graphql_public` only, so a function in `private` is not an RPC: no
-- member can call `POST /rest/v1/rpc/name_key` with an arbitrary argument.
--
-- EXISTING DATA IS NEVER REWRITTEN. Before any check or index changes, the
-- guard below looks for rows the new rules would refuse — a blank name, or two
-- rows that compete for one key — and raises `NAME_KEY_CONFLICT` naming every
-- offending table if it finds any. The migration then stops and changes
-- nothing. Stored values are not touched either way, and what a name that is
-- valid today stores does not change. (A write landing between the guard and
-- the constraint step fails that step with a raw 23514 or 23505 instead; the
-- migration still rolls back whole.)
--
-- REFUSALS KEEP THEIR CODES AND NAMES. Each check keeps its constraint name
-- (`organizations_name_check`, `members_name_check`, `teams_name_not_blank`,
-- `hour_bands_name_not_blank`, `shift_types_name_not_blank`) and each index its
-- index name, so a refusal is still 23514 or 23505 naming the same constraint
-- the client reads.
--
-- WHO HOLDS EXECUTE, AND WHY. A check constraint and an index expression are
-- permission-checked against the WRITING role: with EXECUTE revoked, an
-- admin's PostgREST insert of a team fails with `permission denied for
-- function name_key` (verified), and a check runs on EVERY update of a row,
-- whatever column it names. So both roles that write these tables hold USAGE
-- on `private` and EXECUTE: `authenticated` (every request write) and
-- `service_role` (a secret-key operator update of any column of these five
-- tables). Granting it discloses nothing: the function is immutable, reads no
-- table and answers only about its argument. PUBLIC and `anon` are revoked;
-- the owner holds it implicitly.
--
-- IDEMPOTENT: `create schema if not exists`, `create or replace` keeps the
-- ACL, revokes and grants are no-ops when repeated, and every constraint and
-- index is dropped `if exists` before it is recreated under the same name.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;
grant usage on schema private to service_role;

create or replace function private.name_key(name text) returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(
    normalize(
      pg_catalog.btrim(
        name,
        U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
      ),
      NFC
    )
  );
$$;

revoke execute on function private.name_key(text) from public;
revoke execute on function private.name_key(text) from anon;
grant execute on function private.name_key(text) to authenticated;
grant execute on function private.name_key(text) to service_role;

-- ------------------------------------------------------------- the guard

do $$
declare
  offending text[] := '{}';
begin
  if exists (select 1 from public.organizations where private.name_key(name) = '') then
    offending := offending || 'organizations (blank name)'::text;
  end if;
  if exists (select 1 from public.members where private.name_key(name) = '') then
    offending := offending || 'members (blank name)'::text;
  end if;
  if exists (select 1 from public.teams where private.name_key(name) = '') then
    offending := offending || 'teams (blank name)'::text;
  end if;
  if exists (select 1 from public.hour_bands where private.name_key(name) = '') then
    offending := offending || 'hour_bands (blank name)'::text;
  end if;
  if exists (select 1 from public.shift_types where private.name_key(name) = '') then
    offending := offending || 'shift_types (blank name)'::text;
  end if;

  -- The duplicates each index would refuse, with its own predicate.
  if exists (
    select 1 from public.teams where not archived
     group by organization_id, private.name_key(name) having count(*) > 1
  ) then
    offending := offending || 'teams (duplicate name)'::text;
  end if;
  if exists (
    select 1 from public.hour_bands
     group by organization_id, private.name_key(name) having count(*) > 1
  ) then
    offending := offending || 'hour_bands (duplicate name)'::text;
  end if;
  if exists (
    select 1 from public.shift_types where not archived
     group by organization_id, private.name_key(name) having count(*) > 1
  ) then
    offending := offending || 'shift_types (duplicate name)'::text;
  end if;

  if pg_catalog.cardinality(offending) > 0 then
    raise exception using
      errcode = 'check_violation',
      message = 'NAME_KEY_CONFLICT',
      detail = pg_catalog.array_to_string(offending, ', '),
      hint = 'Correct these rows by hand; this migration never rewrites a stored name.';
  end if;
end;
$$;

-- ------------------------------------------------------------- the checks

alter table public.organizations drop constraint if exists organizations_name_check;
alter table public.organizations
  add constraint organizations_name_check check (private.name_key(name) <> '');

alter table public.members drop constraint if exists members_name_check;
alter table public.members
  add constraint members_name_check check (private.name_key(name) <> '');

alter table public.teams drop constraint if exists teams_name_not_blank;
alter table public.teams
  add constraint teams_name_not_blank check (private.name_key(name) <> '');

alter table public.hour_bands drop constraint if exists hour_bands_name_not_blank;
alter table public.hour_bands
  add constraint hour_bands_name_not_blank check (private.name_key(name) <> '');

alter table public.shift_types drop constraint if exists shift_types_name_not_blank;
alter table public.shift_types
  add constraint shift_types_name_not_blank check (private.name_key(name) <> '');

-- ------------------------------------------------------------- the indexes

-- The same predicates 0009, 0012 and 0013 chose: an archived team or type
-- never blocks its name being reused, and a band is never archived.
drop index if exists public.teams_organization_name_key;
create unique index teams_organization_name_key
  on public.teams (organization_id, private.name_key(name))
  where not archived;

drop index if exists public.hour_bands_organization_name_key;
create unique index hour_bands_organization_name_key
  on public.hour_bands (organization_id, private.name_key(name));

drop index if exists public.shift_types_organization_name_key;
create unique index shift_types_organization_name_key
  on public.shift_types (organization_id, private.name_key(name))
  where not archived;
