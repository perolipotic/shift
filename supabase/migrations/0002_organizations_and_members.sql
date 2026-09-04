-- 0002_organizations_and_members.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- The first two tables: a tenant, and the people who belong to it. Q3 makes the
-- tenant reference structural rather than conventional — organization_id is the
-- first column of every organization-scoped table, not null, and a foreign key
-- — so no row can exist outside a tenant, and AD-10's policies have something
-- to compare their claim against when story 1.3 writes them.
--
-- Both tables enable row level security here and declare no policy at all.
-- That is deny-all, deliberately: story 1.3 owns every policy, the
-- SECURITY DEFINER STABLE role helper and the access-token hook that supplies
-- the organization claim. Until it lands, the only safe posture is that a
-- session reads nothing, and a permissive policy written early would be
-- invisible until the story that was supposed to author it.
--
-- Q6 — an organization may never be left with zero admins, and the last admin's
-- role may not be downgraded — is the one refusal AD-3 cannot turn into a
-- shape, because it is a cross-row cardinality rule rather than a property of
-- a row. AD-3 names it as its single exception and spends the whole budget
-- here: the constraint trigger at the bottom of this file is the only one this
-- schema will ever have. A second one is a signal that AD-9's no-server-tier
-- decision needs revisiting, not that another trigger should be written.
--
-- AD-11 does not reach these two tables. Attribution attaches to overrides,
-- leave records and resolutions — the things an admin later changes — and the
-- first organization is provisioned by an operator before any admin exists to
-- attribute it to, so there is no created_by default anywhere below.
--
-- Q5 bounds the personal data to what scheduling requires: name, optional
-- email, role, leave allowance. No phone number, no health data, no absence
-- reason. Team membership and active status are absent on purpose — AD-2
-- classifies both as versioned, so each arrives as its own table with a
-- validity range in a later story, and never as a column here.
--
-- Nothing below carries a default that encodes one organization's answer. A
-- default is where an organization specific hides (SPEC.md), so timezone,
-- locale, organization type and leave-year start are all required values with
-- no preset, and no check enumerates the labels or languages that exist today.

-- pgcrypto, for the bcrypt hashing that `supabase/operator/provision-organization.sql`
-- and `supabase/seed.sql` use when they write an account's password directly.
-- The Supabase image happens to install it already, so nothing would visibly
-- break without this line today — which is exactly why it is here. 0001 exists
-- to declare the extensions this schema depends on rather than inherit them
-- from whatever image is underneath, and a dependency that only works by
-- accident fails on the first platform that does not share the accident. It
-- goes in 0002 and not in 0001: migrations are forward-only, and a promoted
-- file is never edited.
--
-- `with schema extensions` puts it where Supabase keeps extensions rather than
-- in `public`, which is why every caller writes `extensions.crypt(...)` rather
-- than trusting the connection's search_path.
create extension if not exists pgcrypto with schema extensions;

create table organizations (
  id uuid primary key default gen_random_uuid(),

  -- The label AD-12's synthesized sign-in addresses are built from, so it has
  -- to be unique and has to be a legal DNS label. Story 1.5 issues further
  -- credentials against the same organization and rebuilds the same addresses
  -- from this column, which is why it is stored rather than derived from the
  -- name: transliterating a name is not a reproducible function.
  --
  -- 63 characters is the DNS label limit. Without that half the pattern admits
  -- a slug that cannot appear in a hostname, and the first thing built from it
  -- is the domain part of every account's sign-in address.
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 63),

  name text not null check (btrim(name) <> ''),
  short_name text,
  description text,
  address text,

  -- Contact details, email only. No phone number is collected anywhere in this
  -- system (AD-12), and an organization's switchboard is not an exception
  -- worth carving out for a field nothing reads.
  contact_email text,

  -- Glossary: a descriptive label such as a service or sector name. Inert by
  -- contract — two organizations differing only in type produce byte-identical
  -- output — so it is free text and never an enum, which would be a list of
  -- the types we happened to think of on this date.
  organization_type text not null check (btrim(organization_type) <> ''),

  -- The organization is the frame: every date and time renders in this zone,
  -- never the device's. An IANA name. Not checked against pg_timezone_names,
  -- because that view is not immutable and so cannot appear in a constraint;
  -- an unknown zone surfaces the first time a value is rendered in it.
  timezone text not null check (btrim(timezone) <> ''),

  -- A BCP 47 language tag. No check listing the tags that exist today: adding
  -- a language must mean a resource file and nothing else, least of all a
  -- migration.
  locale text not null check (btrim(locale) <> ''),

  -- The Leave Year need not align to the calendar year, so it is a month and a
  -- day rather than a date — a date would carry a year that means nothing and
  -- invite arithmetic against it. Days 29 to 31 are excluded rather than
  -- validated: a leave year starting on the 30th has no boundary in February,
  -- and AD-3 prefers a shape that cannot express the broken case to a check
  -- that explains it afterwards.
  leave_year_start_month smallint not null check (leave_year_start_month between 1 and 12),
  leave_year_start_day smallint not null check (leave_year_start_day between 1 and 28),

  -- The one timestamptz the conventions permit. Not attribution: AD-11's
  -- created_by belongs to overrides, leave records and resolutions, and this
  -- row predates every account that could have authored it.
  created_at timestamptz not null default now()
);

create table members (
  -- Q3, and the ordering rule the whole schema keeps: organization_id is the
  -- first column of every organization-scoped table, so the first line of any
  -- table definition answers "whose row is this". Not null and a foreign key,
  -- because Q3 is a constraint and not a convention.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  -- AD-12: sign-in is an admin-issued username mapped to a non-routable
  -- synthesized address in auth.users, so an account is usable by someone with
  -- no email address at all. One auth user is exactly one member, which is
  -- also what licenses AD-10's single organization_id claim.
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,

  name text not null check (btrim(name) <> ''),

  -- Optional by requirement. A member with no address is still a member, and
  -- this column is the real one — never the synthesized address above.
  email text,

  -- The glossary is binding here: "Member" always means the person and never
  -- the permission level, and a synonym is a contract violation. Spelling the
  -- non-admin level member_role keeps the forbidden synonym out of the data
  -- itself, where every later query and fixture would otherwise repeat it.
  role text not null check (role in ('admin', 'member_role')),

  -- AD-2 classifies leave allowance as current-state: allowance minus used
  -- equals balance at all times. Per member, with no organization-wide
  -- constant anywhere, and no default — an allowance nobody chose is a policy
  -- nobody wrote.
  leave_allowance_days smallint not null check (leave_allowance_days >= 0),

  created_at timestamptz not null default now(),

  -- Q20 asks the member list to stay usable at several hundred members. Every
  -- read of that list is filtered by organization, so an index whose leading
  -- column is organization_id turns it into one range scan instead of a filter
  -- over every tenant's rows. It is unique because id already is, and being
  -- unique is what lets a later organization-scoped table carry a composite
  -- foreign key to (organization_id, id) and so make a cross-tenant reference
  -- unrepresentable rather than merely unlikely.
  constraint members_organization_id_id_key unique (organization_id, id)
);

-- Deny-all until story 1.3. Enabling RLS with no policy is the whole point:
-- PostgREST reaches these tables as anon or authenticated, both of which now
-- match no policy and therefore see zero rows.
--
-- Zero rows, and specifically not "permission denied". Supabase's default
-- privileges in `public` already grant every table privilege to `anon`,
-- `authenticated` and `service_role` at creation time, so the SELECT is
-- allowed and row level security is what empties it. That distinction is the
-- assertion `test/provisioning.test.ts` makes: a privilege error would pass a
-- naive "it returned nothing" check while meaning something entirely
-- different, and it would start returning rows the moment a later migration
-- fixed the grant. No grant or revoke is written here for the same reason —
-- adding one would suggest the default is not already in force.
alter table organizations enable row level security;
alter table members enable row level security;

-- --------------------------------------------------------------- Q6, once only

-- SECURITY DEFINER because the check reads members, and members is deny-all: a
-- SECURITY INVOKER function running as authenticated would read zero rows and
-- so conclude that every organization has no admin. search_path is emptied and
-- every name qualified, so nothing here resolves through a caller-controlled
-- path.
--
-- The refusal carries a stable SCREAMING_SNAKE code and no prose (AD-8) —
-- user-facing text is the i18n edge's job. It travels as MESSAGE rather than
-- as ERRCODE because Postgres accepts only a five-character SQLSTATE or one of
-- its own condition names there, and rejects any other word outright
-- ("unrecognized exception condition"). ERRCODE therefore carries the nearest
-- true SQLSTATE — a deferred constraint trigger is a check violation — which
-- is also what makes PostgREST answer 400 rather than 500, and MESSAGE carries
-- the code the edge translates. DETAIL carries the one operand, the
-- organization, so the error is still {code, ...operands}.
create function refuse_organization_with_no_admin() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  losing_organization uuid := old.organization_id;
begin
  -- The organization itself may be gone. Members cascade from organizations,
  -- so at commit time a deleted tenant has no admin and never will; refusing
  -- here would not keep an organization intact, it would make an organization
  -- impossible to delete.
  if not exists (select 1 from public.organizations where id = losing_organization) then
    return null;
  end if;

  if exists (
    select 1
    from public.members
    where organization_id = losing_organization
      and role = 'admin'
  ) then
    return null;
  end if;

  raise exception using
    errcode = 'check_violation',
    message = 'ORGANIZATION_WOULD_HAVE_NO_ADMIN',
    detail = losing_organization::text;
end;
$$;

-- Nothing calls this by hand. It is SECURITY DEFINER and reads `members` past
-- row level security, so leaving the default PUBLIC grant in place would give
-- every role an entry point to a function that runs as the owner. Postgres
-- checks EXECUTE when the trigger is created, not when it fires, so the
-- trigger below is unaffected — verified against the running stack, including
-- a delete performed as `authenticated`.
revoke execute on function refuse_organization_with_no_admin() from public;

-- DEFERRABLE INITIALLY DEFERRED is the load-bearing half. Swapping one admin
-- for another — insert the replacement, demote the incumbent — passes through
-- a moment with two admins and a moment with one, and an immediate trigger
-- would refuse the transaction depending on which statement came first. Only
-- the state at commit is a fact about the organization.
--
-- It fires on update as well as delete because a downgrade is the other half
-- of Q6: an organization with one admin whose role becomes member_role has
-- lost its last admin just as surely as if the row had been removed.
create constraint trigger members_organization_keeps_an_admin
  after delete or update on members
  deferrable initially deferred
  for each row
  execute function refuse_organization_with_no_admin();
