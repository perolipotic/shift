-- 0052_absence_types.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 13.1: absence types are organization data.
--
-- One table and one column. `absence_types` holds an organization's kinds of
-- absence: a NAME and whether a record of that type DRAWS DOWN THE ALLOWANCE,
-- and nothing else. `leave_records.absence_type_id` names the type of every
-- leave record. Nothing reads the type yet (13.2): every cost, balance,
-- collision, staffing and report figure is computed exactly as before.
--
--   * NO REASON, EVER (Q5/NFR-5). Neither table has a reason, diagnosis or
--     free-text column; the rule is the column left out (AD-3).
--   * CURRENT-STATE (AD-2, amended for 13.1). A type is renamed and its
--     drawing flag changed in place, with no version and no validity range.
--   * ANNUAL LEAVE has one fixed id, `00000000-0000-0000-0000-000000000001`,
--     in every organization; the table's key is `(organization_id, id)`. It may
--     be renamed, is never deleted (no session holds a delete privilege or
--     policy on the table), and always draws (a check).
--   * EVERY ORGANIZATION HAS ANNUAL LEAVE. This migration seeds the existing
--     ones; an AFTER INSERT row trigger on `organizations` seeds each new one,
--     whichever path creates it (the operator scripts, `seed.sql`, a test
--     fixture). It refuses nothing and computes nothing.
--   * EVERY LEAVE RECORD IS ANNUAL LEAVE until 13.2. The column defaults to
--     the fixed id, so every existing record (live and removed) takes it when
--     the column is added, and every insert path that names no type, 0043's
--     amend, 0046's approval, 0036's replacement and 0041's close among them,
--     keeps writing annual leave unchanged. No trigger on `leave_records`.
--   * NOT WRITABLE BY A SESSION YET. 0028's insert grant stays
--     `(organization_id, member_id, during)`: amend copies no type, so a
--     record of another type must not be writable before 13.2 carries the
--     type through amend and approval.
--   * THE NAME follows 0024 and 0036: non-blank by `private.name_key`, at most
--     100 characters, unique per organization by `private.name_key`.
--
-- WHO READS WHAT: an ACTIVE ADMIN of the token's organization reads, inserts
-- and renames its types and sets their drawing flag. A member-role account
-- reads none (a type's name may be health data, and the member's own view of
-- it is 13.2's). Nobody deletes one. `anon` holds nothing.
--
-- A refused write arrives as one of:
--
--   * 23505 — `absence_types_organization_name_key`: the name is taken;
--   * 23514 — `absence_types_name_not_blank`, `absence_types_name_length`, or
--     `absence_types_annual_draws`: annual leave set not to draw;
--   * 42501 — the policy or the privilege: not an active admin of the claimed
--     organization, a column the grant does not admit, or a delete.

-- The fixed id of annual leave, written once as a literal in each place that
-- needs it (the check, the seed, the trigger and the default): a constant
-- cannot be named from a check or a default in SQL.

create table absence_types (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid not null default gen_random_uuid(),

  name text not null,

  -- Whether a record of this type draws down the allowance. Current-state:
  -- 13.2 decides what changing it warns about. No default: an admin says it.
  draws_allowance boolean not null,

  -- No `created_by`, as 0012's hour bands: a type is current-state, and the
  -- seeded annual leave would have to forge an author.
  created_at timestamptz not null default now(),

  -- The key the leave record's composite foreign key references. Annual leave
  -- shares one id across organizations, so `id` alone is not a key.
  constraint absence_types_pkey primary key (organization_id, id),

  constraint absence_types_name_not_blank check (private.name_key(name) <> ''),

  constraint absence_types_name_length check (char_length(name) <= 100),

  -- Annual leave always draws down the allowance.
  constraint absence_types_annual_draws
    check (id <> '00000000-0000-0000-0000-000000000001'::uuid or draws_allowance)
);

alter table absence_types enable row level security;

-- Q3: every policy below filters by the tenant first. The primary key leads
-- with `organization_id` and serves it.

-- Unique per organization by `private.name_key` (0024). TOTAL: a type is never
-- archived and never deleted.
create unique index absence_types_organization_name_key
  on public.absence_types (organization_id, private.name_key(name));

-- ------------------------------------------------------------------ the policies

-- An active admin of the token's organization reads its types. A member-role
-- account reads none.
create policy absence_types_select_by_own_active_admin on public.absence_types
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- Insert has no USING clause to fail, so a member-role account or an admin
-- naming another tenant gets 42501.
create policy absence_types_insert_by_own_active_admin on public.absence_types
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
  );

-- Rename and set the drawing flag. WITH CHECK pins the tenant, as 0012's
-- hour band update does.
create policy absence_types_update_by_own_active_admin on public.absence_types
  for update
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  )
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- No delete policy: a type is never deleted in 13.1 (deferred). A session's
-- delete is refused by the missing privilege below.

-- ------------------------------------------------------- the writable columns

-- As 0012: Supabase's default privileges grant every table privilege to `anon`
-- and `authenticated`. A session names a type's tenant, name and drawing flag
-- on insert, and changes its name or flag on update; nothing else. `id` and
-- `created_at` come from their defaults. No delete and no truncate. `anon`
-- reads and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.absence_types
  from authenticated;
revoke all on table public.absence_types from anon;

grant insert (organization_id, name, draws_allowance) on table public.absence_types to authenticated;
grant update (name, draws_allowance) on table public.absence_types to authenticated;

-- ------------------------------------------------- annual leave, everywhere

-- Every existing organization gets annual leave, drawing.
insert into public.absence_types (organization_id, id, name, draws_allowance)
select organization.id, '00000000-0000-0000-0000-000000000001'::uuid, 'Godišnji odmor', true
  from public.organizations as organization;

-- Every new organization gets it too, from whichever path creates it. A
-- definer, so it writes past the table's policies and privileges, which no
-- creating path (the owner, the secret key) needs to hold. It refuses nothing
-- and computes nothing.
create function private.seed_absence_types() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.absence_types (organization_id, id, name, draws_allowance)
  values (new.id, '00000000-0000-0000-0000-000000000001'::uuid, 'Godišnji odmor', true);
  return null;
end;
$$;

create trigger organizations_seed_absence_types
  after insert on public.organizations
  for each row
  execute function private.seed_absence_types();

-- Nothing calls it by hand; Postgres checks EXECUTE when a trigger is created,
-- not when it fires.
revoke execute on function private.seed_absence_types() from public, anon, authenticated, service_role;

-- --------------------------------------------- the type of every leave record

-- A constant default: Postgres fills every existing row, live and removed,
-- with it as the column is added, without rewriting `during`, the attribution
-- or the removal. The foreign key below then validates against the seeded
-- annual leave of each record's own organization.
alter table public.leave_records
  add column absence_type_id uuid not null default '00000000-0000-0000-0000-000000000001'::uuid;

-- To the type of the record's own organization, so another tenant's type is
-- unrepresentable. NO cascade: a type a live or removed record names is not
-- deleted from under it.
alter table public.leave_records
  add constraint leave_records_absence_type_fkey
    foreign key (organization_id, absence_type_id)
    references public.absence_types (organization_id, id);

-- Serves the foreign key's check on a type's key change, and 13.2's reads by
-- type.
create index leave_records_organization_absence_type_idx
  on public.leave_records (organization_id, absence_type_id);
