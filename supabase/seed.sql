-- seed.sql — LOCAL AND TEST ONLY.
--
-- This file is loaded by `supabase db reset` against a local database and by
-- the test harness. It is never bundled into the SPA, never applied to staging
-- or production, never a default for a real organization, and no application
-- code branches on anything defined here.
--
-- Two fixtures live here, and every rule in the system is asserted against
-- both (AD-15):
--
--   * the pilot organization — the real shape the MVP was designed around;
--   * the UJ-5 security organization — structurally different, and the fixture
--     that proves isolation: a valid session in one must never read the other.
--
-- Story 1.2 fills the first two sections of each fixture — the organization and
-- its members, including its own admin. The later sections stay reserved: their
-- tables do not exist yet, and the order below is what tells the story that
-- adds one where its inserts belong.
--
-- Attribution comes from column defaults (AD-11), so nothing here sets
-- created_by or created_at. Both fixtures are provisioned the way a real
-- organization is — see `supabase/operator/provision-organization.sql`, which
-- carries the same auth.users recipe and explains every part of it. The recipe
-- is duplicated rather than shared because that script must be one prepared
-- statement and so cannot be included from here.
--
-- EVERY ACCOUNT BELOW SHARES ONE PASSWORD, `local-fixture-password`. That is
-- safe precisely because this file never reaches an environment where it would
-- not be: it is local and test only, and the addresses it issues resolve
-- nowhere (RFC 2606 `.invalid`).


-- ===========================================================================
-- Fixture 1 — the pilot organization
-- ===========================================================================
-- Populated in story 1.2 onward, in dependency order:
--   organizations -> members -> teams -> team_memberships
--   -> hour_bands -> shift_types -> shift_type_versions
--   -> rotation_patterns -> rotation_steps -> rotation_assignments
--   -> leave_records
-- Attribution comes from column defaults (AD-11), so inserts here must not
-- forge created_by or created_at.

insert into organizations (
  slug, name, short_name, description, address, contact_email,
  organization_type, timezone, locale,
  leave_year_start_month, leave_year_start_day
) values (
  'dvd-kastel-novi',
  'DVD Kaštel Novi',
  'DVD Kaštel Novi',
  'Dobrovoljno vatrogasno društvo.',
  'Trg braće Radić 1, Kaštel Novi',
  'kontakt@dvd-kastel-novi.example.com',
  'Fire Department',
  'Europe/Zagreb',
  'hr',
  1,
  1
);

do $$
declare
  fixture_organization uuid := (select id from organizations where slug = 'dvd-kastel-novi');
  fixture_slug         text := 'dvd-kastel-novi';
  fixture_password     text := 'local-fixture-password';
  seeded               record;
  seeded_user          uuid;
  seeded_address       text;
begin
  for seeded in
    select *
    from (values
      -- Its own admin, and three member-role accounts: enough for a role
      -- refusal to have both a subject and a bystander. Story 1.5 grows the
      -- list to Q20 scale; four is what proves the rules.
      ('Ivan Marić',   'ivan.maric',   'ivan.maric@example.com',  'admin',       20),
      ('Ana Kovač',    'ana.kovac',    null,                      'member_role', 20),
      -- No email at all: CAP-1's account for a member who has none.
      ('Marko Novak',  'marko.novak',  null,                      'member_role', 20),
      -- A different allowance in the same organization, because leave
      -- allowance is per member and there is no organization-wide constant.
      ('Petra Babić',  'petra.babic',  'petra.babic@example.com', 'member_role', 25)
    ) as fixture (full_name, username, email, role, leave_allowance_days)
  loop
    seeded_user := gen_random_uuid();
    seeded_address := seeded.username || '@' || fixture_slug || '.shift.invalid';

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000',
      seeded_user,
      'authenticated',
      'authenticated',
      seeded_address,
      extensions.crypt(fixture_password, extensions.gen_salt('bf', 10)),
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      '{}'::jsonb,
      now(),
      now(),
      '', '', '', ''
    );

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, created_at, updated_at
    ) values (
      seeded_user::text,
      seeded_user,
      jsonb_build_object(
        'sub', seeded_user::text,
        'email', seeded_address,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now()
    );

    -- `username` is written here as well as into the address (0007). The two
    -- are the same value by contract and nothing in PostgreSQL can hold them
    -- together across the `auth` boundary, so a fixture that disagreed with
    -- itself would be a fixture whose stored username authenticates nothing —
    -- which is exactly what `test/rls-isolation.test.ts` asserts against.
    insert into members (
      organization_id, auth_user_id, name, username, email, role, leave_allowance_days
    ) values (
      fixture_organization,
      seeded_user,
      seeded.full_name,
      seeded.username,
      seeded.email,
      seeded.role,
      seeded.leave_allowance_days
    );
  end loop;
end
$$;


-- ===========================================================================
-- Fixture 2 — the UJ-5 security organization
-- ===========================================================================
-- Structurally different from the pilot on purpose: a different team count, a
-- different rotation shape and its own admin. Its only job is to be the other
-- tenant, so that a cross-tenant read with a valid session can be asserted to
-- fail closed and an administrative write by a member-role account can be
-- asserted to be refused identically via the UI and via direct API.
--
-- Its leave year deliberately does not start in January, and its members carry
-- allowances the pilot does not use. Where the two fixtures agree on a value,
-- an assertion cannot tell an organization's own answer from a constant.

insert into organizations (
  slug, name, short_name, description, address, contact_email,
  organization_type, timezone, locale,
  leave_year_start_month, leave_year_start_day
) values (
  'zastita-split',
  'Zaštita Split',
  'Zaštita',
  'Tvrtka za tehničku i tjelesnu zaštitu.',
  'Poljička cesta 5, Split',
  'kontakt@zastita-split.example.com',
  'Security',
  'Europe/Zagreb',
  'hr',
  4,
  1
);

do $$
declare
  fixture_organization uuid := (select id from organizations where slug = 'zastita-split');
  fixture_slug         text := 'zastita-split';
  fixture_password     text := 'local-fixture-password';
  seeded               record;
  seeded_user          uuid;
  seeded_address       text;
begin
  for seeded in
    select *
    from (values
      -- Its own admin, as this section has always required, and a smaller
      -- member list than the pilot's.
      ('Josip Perić',    'josip.peric',    'josip.peric@example.com', 'admin',       25),
      ('Lucija Šimić',   'lucija.simic',   null,                      'member_role', 22),
      ('Tomislav Jurić', 'tomislav.juric', null,                      'member_role', 22)
    ) as fixture (full_name, username, email, role, leave_allowance_days)
  loop
    seeded_user := gen_random_uuid();
    seeded_address := seeded.username || '@' || fixture_slug || '.shift.invalid';

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000',
      seeded_user,
      'authenticated',
      'authenticated',
      seeded_address,
      extensions.crypt(fixture_password, extensions.gen_salt('bf', 10)),
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      '{}'::jsonb,
      now(),
      now(),
      '', '', '', ''
    );

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, created_at, updated_at
    ) values (
      seeded_user::text,
      seeded_user,
      jsonb_build_object(
        'sub', seeded_user::text,
        'email', seeded_address,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now()
    );

    -- `username` is written here as well as into the address (0007). The two
    -- are the same value by contract and nothing in PostgreSQL can hold them
    -- together across the `auth` boundary, so a fixture that disagreed with
    -- itself would be a fixture whose stored username authenticates nothing —
    -- which is exactly what `test/rls-isolation.test.ts` asserts against.
    insert into members (
      organization_id, auth_user_id, name, username, email, role, leave_allowance_days
    ) values (
      fixture_organization,
      seeded_user,
      seeded.full_name,
      seeded.username,
      seeded.email,
      seeded.role,
      seeded.leave_allowance_days
    );
  end loop;
end
$$;
