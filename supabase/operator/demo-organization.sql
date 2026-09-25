-- demo-organization.sql — OPERATOR TASK, LOCAL AND STAGING ONLY. NEVER PRODUCTION.
--
-- Creates the pilot demo organization, `dvd-demo`: one admin, four crews of
-- four (a commander, a driver and two firefighters each, all ranked), the
-- pilot's hour bands, its shift types and its rotation. It is what a human
-- looks at on a local stack or on staging. It is NOT a test fixture: the
-- fixtures live in `supabase/seed.sql`, which tests pin exactly, and this file
-- touches neither them nor any other organization.
--
-- Every value below is fixed on purpose, because this file IS demo data. That
-- is also why `test/supabase-scaffold.test.ts` leaves it out of the
-- organization-specifics ban that covers the migrations and the provisioning
-- script: those run in production, and this refuses to.
--
-- Run it with (see DEPLOY.md §7.5):
--
--   pnpm db:demo                                          -- local
--
--   PGOPTIONS="-c shift.demo_target=staging -c shift.demo_password=..." \
--     pnpm exec supabase db query --linked -f supabase/operator/demo-organization.sql
--
-- Both refusals raise SQLSTATE P0001 (raise_exception) with a named message,
-- as does DEMO_ROTATION_INCOMPLETE, raised if the rotation's steps or
-- assignments would be written short.
--
-- Two session settings, both required:
--
--   * `shift.demo_target` must be `local` or `staging`. Anything else, unset
--     included, is refused with DEMO_TARGET_REFUSED before anything is written.
--   * `shift.demo_password` is every demo account's password. It has no
--     default; unset, empty or whitespace-only is refused with
--     DEMO_PASSWORD_MISSING. A real password is used untrimmed.
--
-- RE-RUNNING REPLACES THE DEMO. The existing `dvd-demo` organization (its
-- members, teams, memberships, bands, shift types and rotation cascade with
-- it) and every auth user under `@dvd-demo.shift.invalid` are deleted, and
-- everything is created again. Nothing else is touched.
--
-- One `do $$ … $$;` block, for the reason `provision-organization.sql` gives:
-- `supabase db query` sends the file as one prepared statement, and a do block
-- is one transaction — the demo is replaced whole, or not at all.
--
-- The auth.users recipe is `provision-organization.sql`'s, which explains every
-- part of it: the four empty token columns, the identity row, bcrypt cost 10.
-- `test/provisioning.test.ts` asserts it for this organization too.
--
-- The rotation is the pilot's (story 2.3a): one pattern, [Dan, Noć,
-- Slobodno, Slobodno], and Smjena A–D bound to it at offsets 0–3 from the
-- anchor 2020-01-01, effective from the same date, so any date projects.

do $$
declare
  demo_target   text := nullif(btrim(coalesce(current_setting('shift.demo_target', true), '')), '');
  -- Used exactly as given; only the missing check trims, so a whitespace-only
  -- password counts as missing but a real one keeps its spaces.
  demo_password text := current_setting('shift.demo_password', true);

  demo_slug     text := 'dvd-demo';
  demo_domain   text := 'dvd-demo.shift.invalid';

  demo_organization uuid;
  demo_admin        uuid := gen_random_uuid();
  seeded            record;
  seeded_user       uuid;
  seeded_member     uuid;
  seeded_address    text;
  demo_pattern      uuid;
  written           integer;
begin
  -- Refusals first, so a refused run has written nothing at all.
  if demo_target is null or demo_target not in ('local', 'staging') then
    raise exception using
      errcode = 'raise_exception',
      message = 'DEMO_TARGET_REFUSED',
      detail = coalesce(demo_target, '(unset)'),
      hint = 'set shift.demo_target to local or staging; the demo never runs in production';
  end if;

  if nullif(btrim(coalesce(demo_password, '')), '') is null then
    raise exception using
      errcode = 'raise_exception',
      message = 'DEMO_PASSWORD_MISSING',
      hint = 'set shift.demo_password; it has no default';
  end if;

  -- Two concurrent runs serialize here rather than racing on the deletes and
  -- the unique slug; the lock is released when this transaction ends.
  perform pg_advisory_xact_lock(hashtext('shift.dvd-demo'));

  -- Replace: the organization cascades to everything scoped to it, and the auth
  -- users are removed by their address domain, which only this demo issues.
  delete from organizations where slug = demo_slug;
  delete from auth.users where email like '%@' || demo_domain;

  insert into organizations (
    slug, name, organization_type, timezone, locale,
    leave_year_start_month, leave_year_start_day,
    uses_fire_ranks
  ) values (
    demo_slug,
    'DVD Kaštel Novi (demo)',
    'Fire Department',
    'Europe/Zagreb',
    'hr',
    1,
    1,
    true
  )
  returning id into demo_organization;

  -- The people. The admin comes first so every later row can be attributed to
  -- them. Names are invented; none is a real crew member.
  for seeded in
    select *
    from (values
      (0,  'Demo Admin',        'admin',             'admin',       null::text,      null::text, null::text),
      (1,  'Davor Horvat',      'davor.horvat',      'member_role', 'officer',       'Smjena A', 'commander'),
      (2,  'Luka Knežević',     'luka.knezevic',     'member_role', 'nco',           'Smjena A', 'driver'),
      (3,  'Mate Radić',        'mate.radic',        'member_role', 'firefighter',   'Smjena A', 'firefighter'),
      (4,  'Ivana Vuković',     'ivana.vukovic',     'member_role', 'trainee',       'Smjena A', 'firefighter'),
      (5,  'Zoran Pavić',       'zoran.pavic',       'member_role', 'nco',           'Smjena B', 'commander'),
      (6,  'Nikola Barišić',    'nikola.barisic',    'member_role', 'firefighter_1', 'Smjena B', 'driver'),
      (7,  'Stipe Matić',       'stipe.matic',       'member_role', 'firefighter',   'Smjena B', 'firefighter'),
      (8,  'Dino Grgić',        'dino.grgic',        'member_role', 'firefighter',   'Smjena B', 'firefighter'),
      (9,  'Mirela Kovačević',  'mirela.kovacevic',  'member_role', 'officer',       'Smjena C', 'commander'),
      (10, 'Ante Bilić',        'ante.bilic',        'member_role', 'firefighter_1', 'Smjena C', 'driver'),
      (11, 'Frane Lozić',       'frane.lozic',       'member_role', 'trainee',       'Smjena C', 'firefighter'),
      (12, 'Karlo Jelić',       'karlo.jelic',       'member_role', 'firefighter',   'Smjena C', 'firefighter'),
      (13, 'Duje Tomić',        'duje.tomic',        'member_role', 'nco',           'Smjena D', 'commander'),
      (14, 'Roko Vidović',      'roko.vidovic',      'member_role', 'nco',           'Smjena D', 'driver'),
      (15, 'Marin Šarić',       'marin.saric',       'member_role', 'firefighter',   'Smjena D', 'firefighter'),
      (16, 'Lea Bašić',         'lea.basic',         'member_role', 'trainee',       'Smjena D', 'firefighter')
    ) as person (ordinal, full_name, username, role, fire_rank, team_name, team_position)
    order by ordinal
  loop
    seeded_user := case when seeded.ordinal = 0 then demo_admin else gen_random_uuid() end;
    seeded_address := seeded.username || '@' || demo_domain;

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
      extensions.crypt(demo_password, extensions.gen_salt('bf', 10)),
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

    insert into members (
      organization_id, auth_user_id, name, username, role, leave_allowance_days, fire_rank
    ) values (
      demo_organization, seeded_user, seeded.full_name, seeded.username, seeded.role, 20, seeded.fire_rank
    )
    returning id into seeded_member;

    if seeded.team_name is not null then
      -- The crew, created on its first member.
      insert into teams (organization_id, name, created_by)
      select demo_organization, seeded.team_name, demo_admin
       where not exists (
         select 1 from teams where organization_id = demo_organization and name = seeded.team_name
       );

      insert into team_membership_versions (
        organization_id, member_id, team_id, position, effective_from, created_by
      )
      select demo_organization, seeded_member, teams.id, seeded.team_position, date '2020-01-01', demo_admin
        from teams
       where teams.organization_id = demo_organization
         and teams.name = seeded.team_name;
    end if;
  end loop;

  -- The pilot's hour bands: Dan from 07:00, Noć from 19:00.
  insert into hour_bands (organization_id, name, start_time)
  select demo_organization, band.name, band.start_time::time
    from (values ('Dan', '07:00'), ('Noć', '19:00')) as band (name, start_time);

  -- The pilot's shift types, with an explicit ascending `created_at` because
  -- this block is one transaction and the ramp slot follows creation order:
  -- Dan is slot 1, Noć slot 2. Slobodno is non-working and has no version.
  insert into shift_types (organization_id, name, is_working, created_by, created_at)
  select demo_organization, shift_type.name, shift_type.is_working, demo_admin,
         now() + shift_type.ordinal * interval '1 millisecond'
    from (values
      (1, 'Dan', true),
      (2, 'Noć', true),
      (3, 'Slobodno', false)
    ) as shift_type (ordinal, name, is_working);

  insert into shift_type_versions (
    organization_id, shift_type_id, start_time, end_time, effective_from, created_by
  )
  select demo_organization, shift_types.id, version.start_time::time, version.end_time::time,
         date '2020-01-01', demo_admin
    from shift_types
    join (values
      ('Dan', '07:00', '19:00'),
      ('Noć', '19:00', '07:00')
    ) as version (name, start_time, end_time) on version.name = shift_types.name
   where shift_types.organization_id = demo_organization;

  -- The pilot's rotation: one pattern, its four steps by position, and each
  -- crew at the step of its offset, all from 2020-01-01 and attributed to the
  -- admin, with ascending `created_at` as for the shift types.
  insert into rotation_patterns (organization_id, created_by, created_at)
  values (demo_organization, demo_admin, now())
  returning id into demo_pattern;

  insert into rotation_steps (organization_id, pattern_id, position, shift_type_id, created_by, created_at)
  select demo_organization, demo_pattern, step.position, shift_types.id, demo_admin,
         now() + (step.position + 1) * interval '1 millisecond'
    from (values
      (0, 'Dan'),
      (1, 'Noć'),
      (2, 'Slobodno'),
      (3, 'Slobodno')
    ) as step (position, shift_type)
    join shift_types on shift_types.organization_id = demo_organization
                    and shift_types.name = step.shift_type;

  -- The steps and assignments join by name, so a missing type or crew would
  -- write fewer rows without an error. Refuse that: the demo is whole or not
  -- at all, and the raise rolls back everything above.
  get diagnostics written = row_count;
  if demo_pattern is null or written <> 4 then
    raise exception using
      errcode = 'raise_exception',
      message = 'DEMO_ROTATION_INCOMPLETE',
      detail = format('pattern %s, %s of 4 steps written', coalesce(demo_pattern::text, '(none)'), written);
  end if;

  insert into rotation_assignments (
    organization_id, team_id, pattern_id, offset_step_id, anchor_date, effective_from,
    created_by, created_at
  )
  select demo_organization, teams.id, demo_pattern, rotation_steps.id,
         date '2020-01-01', date '2020-01-01', demo_admin,
         now() + (assignment.offset_position + 1) * interval '1 millisecond'
    from (values
      ('Smjena A', 0),
      ('Smjena B', 1),
      ('Smjena C', 2),
      ('Smjena D', 3)
    ) as assignment (team, offset_position)
    join teams on teams.organization_id = demo_organization
              and teams.name = assignment.team
    join rotation_steps on rotation_steps.pattern_id = demo_pattern
                       and rotation_steps.position = assignment.offset_position;

  get diagnostics written = row_count;
  if written <> 4 then
    raise exception using
      errcode = 'raise_exception',
      message = 'DEMO_ROTATION_INCOMPLETE',
      detail = format('%s of 4 assignments written', written);
  end if;

  raise notice 'demo organization % (%) replaced on %; the admin signs in as admin@%',
    demo_slug, demo_organization, demo_target, demo_domain;
end
$$;
