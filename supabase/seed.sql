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
-- created_by or created_at — with two exceptions, whose `created_by` has no
-- session to default from and is each fixture's own admin, and whose rows
-- carry an explicit ascending `created_at` because this file runs in one
-- transaction: the shift types and their versions (story 2.2a), and the teams
-- and the rotation — pattern, steps and assignments (story 2.3a). No team
-- membership is seeded.
--
-- Both fixtures are provisioned the way a real organization is — see
-- `supabase/operator/provision-organization.sql`, which carries the same
-- auth.users recipe and explains every part of it. The recipe is duplicated
-- rather than shared because that script must be one prepared statement and
-- so cannot be included from here.
--
-- EVERY ACCOUNT BELOW SHARES ONE PASSWORD, `local-fixture-password`. That is
-- safe precisely because this file never reaches an environment where it would
-- not be: it is local and test only, and the addresses it issues resolve
-- nowhere (RFC 2606 `.invalid`).


-- ===========================================================================
-- Fixture 1 — the pilot organization
-- ===========================================================================
-- Populated in story 1.2 onward, in dependency order:
--   organizations -> members -> teams -> team_membership_versions
--   -> hour_bands -> shift_types -> shift_type_versions
--   -> rotation_patterns -> rotation_steps -> rotation_assignments
--   -> leave_records
-- Attribution comes from column defaults (AD-11), so inserts here must not
-- forge created_by or created_at — except the teams, the shift types and their
-- versions, and the rotation, as the header explains.

insert into organizations (
  slug, name, short_name, description, address, contact_email,
  organization_type, timezone, locale,
  leave_year_start_month, leave_year_start_day,
  uses_fire_ranks
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
  1,
  -- Member rank: the pilot organises its crews by fire rank (0014). UJ-5
  -- keeps the default and has no ranks.
  true
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
      ('Ivan Marić',   'ivan.maric',   'ivan.maric@example.com',  'admin',       20, 'officer'),
      ('Ana Kovač',    'ana.kovac',    null,                      'member_role', 20, 'nco'),
      -- No email at all: CAP-1's account for a member who has none.
      ('Marko Novak',  'marko.novak',  null,                      'member_role', 20, 'firefighter'),
      -- A different allowance in the same organization, because leave
      -- allowance is per member and there is no organization-wide constant.
      -- No rank: the null case of 0014's `fire_rank`.
      ('Petra Babić',  'petra.babic',  'petra.babic@example.com', 'member_role', 25, null)
    ) as fixture (full_name, username, email, role, leave_allowance_days, fire_rank)
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
      organization_id, auth_user_id, name, username, email, role, leave_allowance_days,
      fire_rank
    ) values (
      fixture_organization,
      seeded_user,
      seeded.full_name,
      seeded.username,
      seeded.email,
      seeded.role,
      seeded.leave_allowance_days,
      seeded.fire_rank
    );
  end loop;
end
$$;

-- Story 2.3a: the pilot's four teams, attributed to its admin, in creation
-- order. No member is placed on one: memberships are not seeded.
insert into teams (organization_id, name, created_by, created_at)
select organizations.id,
       team.name,
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'ivan.maric'),
       now() + team.position * interval '1 millisecond'
  from organizations
  cross join (values
    (1, 'Smjena A'),
    (2, 'Smjena B'),
    (3, 'Smjena C'),
    (4, 'Smjena D')
  ) as team (position, name)
 where organizations.slug = 'dvd-kastel-novi';

-- Story 2.1a: the pilot's two hour bands. Only name and start are stored; each
-- window is derived (Dan 07:00–19:00, Noć 19:00–07:00, crossing midnight).
insert into hour_bands (organization_id, name, start_time)
select organizations.id, band.name, band.start_time::time
  from organizations
  cross join (values
    ('Dan', '07:00'),
    ('Noć', '19:00')
  ) as band (name, start_time)
 where organizations.slug = 'dvd-kastel-novi';

-- Story 2.2a: the pilot's shift types, in creation order (2.2b takes each
-- working type's ramp slot from it), attributed to its admin. A working type's
-- times are a version effective from 2020-01-01, so any past date projects;
-- the duration is derived (Dan 720 min; Noć 720 min, crossing midnight, one
-- span on its start date). Slobodno is non-working and has no version.
insert into shift_types (organization_id, name, is_working, created_by, created_at)
select organizations.id,
       shift_type.name,
       shift_type.is_working,
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'ivan.maric'),
       now() + shift_type.position * interval '1 millisecond'
  from organizations
  cross join (values
    (1, 'Dan', true),
    (2, 'Noć', true),
    (3, 'Slobodno', false)
  ) as shift_type (position, name, is_working)
 where organizations.slug = 'dvd-kastel-novi';

insert into shift_type_versions (
  organization_id, shift_type_id, start_time, end_time, effective_from, created_by
)
select organizations.id,
       shift_types.id,
       version.start_time::time,
       version.end_time::time,
       date '2020-01-01',
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'ivan.maric')
  from organizations
  join shift_types on shift_types.organization_id = organizations.id
  cross join (values
    ('Dan', '07:00', '19:00'),
    ('Noć', '19:00', '07:00')
  ) as version (name, start_time, end_time)
 where organizations.slug = 'dvd-kastel-novi'
   and shift_types.name = version.name;

-- Story 2.3a: the pilot's rotation. One pattern, [Dan, Noć, Slobodno,
-- Slobodno] at positions 0–3 (24 hours on, 48 off), and Smjena A–D bound to it
-- at offsets 0–3 from one shared anchor, 2020-01-01, effective from the same
-- date so any past date projects. The offset is the step at that position.
-- Attributed to the admin, with ascending `created_at`.
insert into rotation_patterns (organization_id, created_by, created_at)
select organizations.id,
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'ivan.maric'),
       now()
  from organizations
 where organizations.slug = 'dvd-kastel-novi';

insert into rotation_steps (organization_id, pattern_id, position, shift_type_id, created_by, created_at)
select organizations.id,
       rotation_patterns.id,
       step.position,
       shift_types.id,
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'ivan.maric'),
       now() + (step.position + 1) * interval '1 millisecond'
  from organizations
  join rotation_patterns on rotation_patterns.organization_id = organizations.id
  cross join (values
    (0, 'Dan'),
    (1, 'Noć'),
    (2, 'Slobodno'),
    (3, 'Slobodno')
  ) as step (position, shift_type)
  join shift_types on shift_types.organization_id = organizations.id
                  and shift_types.name = step.shift_type
 where organizations.slug = 'dvd-kastel-novi';

insert into rotation_assignments (
  organization_id, team_id, pattern_id, offset_step_id, anchor_date, effective_from,
  created_by, created_at
)
select organizations.id,
       teams.id,
       rotation_patterns.id,
       rotation_steps.id,
       date '2020-01-01',
       date '2020-01-01',
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'ivan.maric'),
       now() + (assignment.offset_position + 1) * interval '1 millisecond'
  from organizations
  join rotation_patterns on rotation_patterns.organization_id = organizations.id
  cross join (values
    ('Smjena A', 0),
    ('Smjena B', 1),
    ('Smjena C', 2),
    ('Smjena D', 3)
  ) as assignment (team, offset_position)
  join teams on teams.organization_id = organizations.id
            and teams.name = assignment.team
  join rotation_steps on rotation_steps.pattern_id = rotation_patterns.id
                     and rotation_steps.position = assignment.offset_position
 where organizations.slug = 'dvd-kastel-novi';


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

-- Story 2.3a: UJ-5's three teams, attributed to its admin. No memberships.
insert into teams (organization_id, name, created_by, created_at)
select organizations.id,
       team.name,
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'josip.peric'),
       now() + team.position * interval '1 millisecond'
  from organizations
  cross join (values
    (1, 'Smjena A'),
    (2, 'Smjena B'),
    (3, 'Smjena C')
  ) as team (position, name)
 where organizations.slug = 'zastita-split';

-- Story 2.1a: UJ-5's three hour bands, eight hours each. Its shifts start at
-- 06:00, 14:00 and 22:00, so every one straddles a band edge (Q10) and band
-- splitting is exercised.
insert into hour_bands (organization_id, name, start_time)
select organizations.id, band.name, band.start_time::time
  from organizations
  cross join (values
    ('Jutro',   '05:00'),
    ('Popodne', '13:00'),
    ('Noć',     '21:00')
  ) as band (name, start_time)
 where organizations.slug = 'zastita-split';

-- Story 2.2a: UJ-5's shift types, 8 hours each, attributed to its admin. Each
-- straddles a band edge (05:00, 13:00, 21:00); Noćna crosses midnight.
insert into shift_types (organization_id, name, is_working, created_by, created_at)
select organizations.id,
       shift_type.name,
       shift_type.is_working,
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'josip.peric'),
       now() + shift_type.position * interval '1 millisecond'
  from organizations
  cross join (values
    (1, 'Jutarnja', true),
    (2, 'Popodnevna', true),
    (3, 'Noćna', true),
    (4, 'Slobodno', false)
  ) as shift_type (position, name, is_working)
 where organizations.slug = 'zastita-split';

insert into shift_type_versions (
  organization_id, shift_type_id, start_time, end_time, effective_from, created_by
)
select organizations.id,
       shift_types.id,
       version.start_time::time,
       version.end_time::time,
       date '2020-01-01',
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'josip.peric')
  from organizations
  join shift_types on shift_types.organization_id = organizations.id
  cross join (values
    ('Jutarnja', '06:00', '14:00'),
    ('Popodnevna', '14:00', '22:00'),
    ('Noćna', '22:00', '06:00')
  ) as version (name, start_time, end_time)
 where organizations.slug = 'zastita-split'
   and shift_types.name = version.name;

-- Story 2.3a: UJ-5's rotation. One five-step pattern, [Jutarnja,
-- Popodnevna, Noćna, Slobodno, Slobodno], and Smjena A–C at offsets 0, 1 and 2
-- from the anchor 2020-01-01, effective from the same date.
insert into rotation_patterns (organization_id, created_by, created_at)
select organizations.id,
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'josip.peric'),
       now()
  from organizations
 where organizations.slug = 'zastita-split';

insert into rotation_steps (organization_id, pattern_id, position, shift_type_id, created_by, created_at)
select organizations.id,
       rotation_patterns.id,
       step.position,
       shift_types.id,
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'josip.peric'),
       now() + (step.position + 1) * interval '1 millisecond'
  from organizations
  join rotation_patterns on rotation_patterns.organization_id = organizations.id
  cross join (values
    (0, 'Jutarnja'),
    (1, 'Popodnevna'),
    (2, 'Noćna'),
    (3, 'Slobodno'),
    (4, 'Slobodno')
  ) as step (position, shift_type)
  join shift_types on shift_types.organization_id = organizations.id
                  and shift_types.name = step.shift_type
 where organizations.slug = 'zastita-split';

insert into rotation_assignments (
  organization_id, team_id, pattern_id, offset_step_id, anchor_date, effective_from,
  created_by, created_at
)
select organizations.id,
       teams.id,
       rotation_patterns.id,
       rotation_steps.id,
       date '2020-01-01',
       date '2020-01-01',
       (select auth_user_id from members
         where organization_id = organizations.id and username = 'josip.peric'),
       now() + (assignment.offset_position + 1) * interval '1 millisecond'
  from organizations
  join rotation_patterns on rotation_patterns.organization_id = organizations.id
  cross join (values
    ('Smjena A', 0),
    ('Smjena B', 1),
    ('Smjena C', 2)
  ) as assignment (team, offset_position)
  join teams on teams.organization_id = organizations.id
            and teams.name = assignment.team
  join rotation_steps on rotation_steps.pattern_id = rotation_patterns.id
                     and rotation_steps.position = assignment.offset_position
 where organizations.slug = 'zastita-split';
