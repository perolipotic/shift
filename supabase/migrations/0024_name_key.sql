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
-- ONE HELPER, ONE WHITESPACE CLASS. `public.name_key(text)` trims, then
-- normalizes to NFC, then lower-cases. Every name check below is
-- `name_key(name) <> ''` and every name unique index is on `name_key(name)`, so
-- the class is written exactly once. The client mirror is
-- `apps/web/src/utils/name.ts`; `test/name-key.test.ts` asserts the two agree
-- on every BMP code point.
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
-- A literal list is the same everywhere, and it is what makes the index
-- expression genuinely immutable.
--
-- EXISTING DATA IS NEVER REWRITTEN. Before any check or index changes, the
-- guard below looks for rows the new rules would refuse — a blank name, or two
-- rows that compete for one key — and raises `NAME_KEY_CONFLICT` naming every
-- offending table if it finds any. The migration then stops and changes
-- nothing. Stored values are not touched either way, and what a name that is
-- valid today stores does not change.
--
-- REFUSALS KEEP THEIR CODES AND NAMES. Each check keeps its constraint name
-- (`organizations_name_check`, `members_name_check`, `teams_name_not_blank`,
-- `hour_bands_name_not_blank`, `shift_types_name_not_blank`) and each index its
-- index name, so a refusal is still 23514 or 23505 naming the same constraint
-- the client reads.
--
-- WHY `authenticated` HOLDS EXECUTE. A check constraint and an index
-- expression are permission-checked against the WRITING role: with EXECUTE
-- revoked, an admin's PostgREST insert of a team fails with `permission denied
-- for function name_key` (verified). `authenticated` is the role every request
-- write runs as, so it keeps EXECUTE. Granting it discloses nothing: the
-- function is immutable, reads no table and answers only about its argument.
-- `anon` writes none of these tables and `service_role` makes no domain-table
-- write (`supabase/functions/admin-auth/operations.ts`), so both are revoked;
-- the owner holds it implicitly.
--
-- IDEMPOTENT: `create or replace` keeps the ACL, revokes and grants are
-- no-ops when repeated, and every constraint and index is dropped `if exists`
-- before it is recreated under the same name.

create or replace function public.name_key(name text) returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(
    normalize(
      pg_catalog.regexp_replace(
        name,
        '^[\u0009-\u000d\u001c-\u001f\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u001c-\u001f\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
        '',
        'g'
      ),
      NFC
    )
  );
$$;

revoke execute on function public.name_key(text) from public;
revoke execute on function public.name_key(text) from anon;
revoke execute on function public.name_key(text) from service_role;
grant execute on function public.name_key(text) to authenticated;

-- ------------------------------------------------------------- the guard

do $$
declare
  offending text[] := '{}';
begin
  if exists (select 1 from public.organizations where public.name_key(name) = '') then
    offending := offending || 'organizations (blank name)'::text;
  end if;
  if exists (select 1 from public.members where public.name_key(name) = '') then
    offending := offending || 'members (blank name)'::text;
  end if;
  if exists (select 1 from public.teams where public.name_key(name) = '') then
    offending := offending || 'teams (blank name)'::text;
  end if;
  if exists (select 1 from public.hour_bands where public.name_key(name) = '') then
    offending := offending || 'hour_bands (blank name)'::text;
  end if;
  if exists (select 1 from public.shift_types where public.name_key(name) = '') then
    offending := offending || 'shift_types (blank name)'::text;
  end if;

  -- The duplicates each index would refuse, with its own predicate.
  if exists (
    select 1 from public.teams where not archived
     group by organization_id, public.name_key(name) having count(*) > 1
  ) then
    offending := offending || 'teams (duplicate name)'::text;
  end if;
  if exists (
    select 1 from public.hour_bands
     group by organization_id, public.name_key(name) having count(*) > 1
  ) then
    offending := offending || 'hour_bands (duplicate name)'::text;
  end if;
  if exists (
    select 1 from public.shift_types where not archived
     group by organization_id, public.name_key(name) having count(*) > 1
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
  add constraint organizations_name_check check (public.name_key(name) <> '');

alter table public.members drop constraint if exists members_name_check;
alter table public.members
  add constraint members_name_check check (public.name_key(name) <> '');

alter table public.teams drop constraint if exists teams_name_not_blank;
alter table public.teams
  add constraint teams_name_not_blank check (public.name_key(name) <> '');

alter table public.hour_bands drop constraint if exists hour_bands_name_not_blank;
alter table public.hour_bands
  add constraint hour_bands_name_not_blank check (public.name_key(name) <> '');

alter table public.shift_types drop constraint if exists shift_types_name_not_blank;
alter table public.shift_types
  add constraint shift_types_name_not_blank check (public.name_key(name) <> '');

-- ------------------------------------------------------------- the indexes

-- The same predicates 0009, 0012 and 0013 chose: an archived team or type
-- never blocks its name being reused, and a band is never archived.
drop index if exists public.teams_organization_name_key;
create unique index teams_organization_name_key
  on public.teams (organization_id, public.name_key(name))
  where not archived;

drop index if exists public.hour_bands_organization_name_key;
create unique index hour_bands_organization_name_key
  on public.hour_bands (organization_id, public.name_key(name));

drop index if exists public.shift_types_organization_name_key;
create unique index shift_types_organization_name_key
  on public.shift_types (organization_id, public.name_key(name))
  where not archived;
