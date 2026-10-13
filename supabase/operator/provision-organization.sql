-- provision-organization.sql — OPERATOR TASK, run by hand.
--
-- Creates an organization together with its first admin, in one transaction.
-- No product surface does this and none ever will (FR-2): a running system has
-- no screen, route or API that creates a tenant, so this file is the only way
-- one comes into existence.
--
-- It is SQL rather than a Node CLI on purpose. AD-17 confines the secret key to
-- the admin-auth Edge Function's environment; a script calling the Admin API
-- would put that key into an operator's shell and amend AD-17 rather than obey
-- it. This connects with the database password the operator already holds for
-- `supabase db push`, involves no key at all, and makes "one transaction"
-- literally true across the auth rows and the domain rows. It is also the one
-- write in the system exempt from AD-11's attribution, because no admin exists
-- yet to attribute it to.
--
-- Run it with (see DEPLOY.md §7 for the full runbook):
--
--   PGOPTIONS="-c shift.organization_slug=... -c shift.organization_name=..." \
--     pnpm db:provision
--
-- Every value arrives through a session setting read with current_setting(),
-- so nothing is interpolated into SQL text and a name containing an apostrophe
-- is data rather than syntax.
--
-- The whole file is a single `do $$ … $$;` statement, and that is a hard
-- requirement rather than a style: `supabase db query` sends the file as one
-- prepared statement, and Postgres refuses more than one command in a prepared
-- statement. A `begin; … commit;` file fails before it runs. A do block is
-- implicitly one transaction, which is exactly what is wanted — either an
-- organization and its admin both exist afterwards, or neither does.

do $$
declare
  -- A setting is BLANK when nothing but white space is left of it, by the same
  -- class `private.name_key` strips (0024): a plain `btrim` removes spaces
  -- only, so a value of a tab or a no-break space would arrive as a name the
  -- schema then refuses as blank (23514) — or, for a column with no blank
  -- check, be stored as one. Copied rather than called, because the value is
  -- kept as written (trimmed, not lowercased or normalized);
  -- `test/supabase-scaffold.test.ts` holds the two copies equal.
  white_space constant text := U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';

  -- The first admin's password floor. The same as `[auth]
  -- minimum_password_length` in `supabase/config.toml`, which GoTrue enforces
  -- on every password the application later sets; a row written here bypasses
  -- GoTrue, so the floor is restated. `test/provisioning.test.ts` holds the
  -- two equal.
  minimum_password_length constant int := 10;

  -- Organization. No value is defaulted: a default here is where one
  -- organization's answer becomes every organization's answer.
  organization_slug          text     := nullif(btrim(coalesce(current_setting('shift.organization_slug', true), ''), white_space), '');
  organization_name          text     := nullif(btrim(coalesce(current_setting('shift.organization_name', true), ''), white_space), '');
  organization_short_name    text     := nullif(btrim(coalesce(current_setting('shift.organization_short_name', true), ''), white_space), '');
  organization_description   text     := nullif(btrim(coalesce(current_setting('shift.organization_description', true), ''), white_space), '');
  organization_address       text     := nullif(btrim(coalesce(current_setting('shift.organization_address', true), ''), white_space), '');
  organization_contact_email text     := nullif(btrim(coalesce(current_setting('shift.organization_contact_email', true), ''), white_space), '');
  organization_type          text     := nullif(btrim(coalesce(current_setting('shift.organization_type', true), ''), white_space), '');
  organization_timezone      text     := nullif(btrim(coalesce(current_setting('shift.organization_timezone', true), ''), white_space), '');
  organization_locale        text     := nullif(btrim(coalesce(current_setting('shift.organization_locale', true), ''), white_space), '');
  leave_year_start_month     smallint := nullif(btrim(coalesce(current_setting('shift.leave_year_start_month', true), ''), white_space), '')::smallint;
  leave_year_start_day       smallint := nullif(btrim(coalesce(current_setting('shift.leave_year_start_day', true), ''), white_space), '')::smallint;

  -- The first admin. AD-12: the operator issues a username, not an address.
  admin_name                 text     := nullif(btrim(coalesce(current_setting('shift.admin_name', true), ''), white_space), '');
  admin_username             text     := lower(nullif(btrim(coalesce(current_setting('shift.admin_username', true), ''), white_space), ''));
  admin_password             text     := nullif(current_setting('shift.admin_password', true), '');
  admin_email                text     := nullif(btrim(coalesce(current_setting('shift.admin_email', true), ''), white_space), '');
  admin_leave_allowance_days smallint := nullif(btrim(coalesce(current_setting('shift.admin_leave_allowance_days', true), ''), white_space), '')::smallint;

  new_organization_id uuid;
  new_auth_user_id    uuid := gen_random_uuid();
  synthesized_address text;
begin
  -- The organization first, so that refusing below rolls a written row back
  -- rather than merely declining to write one. "An organization is born with
  -- an admin" is a property of the transaction, not of the argument list.
  --
  -- A missing organization attribute needs no check here: the columns are not
  -- null and their values are constrained, so the schema refuses with 23502 or
  -- 23514 (AD-3 — a validation that could have been a shape is a defect).
  -- The timezone is an IANA `Area/Location` name the database knows, the one
  -- form both Postgres and the browser's `Intl` read the same way. An
  -- abbreviation (`CET`, `UTC`), a POSIX string (`CET-1CEST`) or a `posix/`
  -- or `right/` alias would be accepted by one side and refused, or read
  -- differently, by the other, and the timezone cannot be changed in the
  -- product afterwards. A missing one is left to the schema's `not null`.
  if organization_timezone is not null
     and (organization_timezone !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'
          or organization_timezone ~ '^(posix|right)/'
          or not exists (select 1 from pg_catalog.pg_timezone_names where name = organization_timezone))
  then
    raise exception using
      errcode = 'check_violation',
      message = 'ORGANIZATION_TIMEZONE_UNKNOWN',
      detail = organization_timezone;
  end if;

  insert into organizations (
    slug, name, short_name, description, address, contact_email,
    organization_type, timezone, locale,
    leave_year_start_month, leave_year_start_day
  ) values (
    organization_slug, organization_name, organization_short_name,
    organization_description, organization_address, organization_contact_email,
    organization_type, organization_timezone, organization_locale,
    leave_year_start_month, leave_year_start_day
  )
  returning id into new_organization_id;

  -- Q6's other end. The constraint trigger keeps an existing organization from
  -- losing its last admin; nothing in the schema can require that one is born
  -- with an admin in the first place, because at the moment the organization
  -- row is written there is no member row to constrain. So the rule lives here,
  -- and it is the reason this script creates both or neither.
  if admin_name is null
     or admin_username is null
     or admin_password is null
     or admin_leave_allowance_days is null
  then
    raise exception using
      errcode = 'check_violation',
      message = 'ORGANIZATION_WITHOUT_ADMIN',
      detail = new_organization_id::text;
  end if;

  -- Counted in characters. The account this creates can do anything, and it
  -- is the one password in the system that never passed through GoTrue's own
  -- check. An admin-issued reset (story 7.8) is the recovery for one already
  -- issued; this keeps a short one from being issued in the first place.
  if char_length(admin_password) < minimum_password_length then
    raise exception using
      errcode = 'check_violation',
      message = 'ADMIN_PASSWORD_TOO_SHORT',
      detail = format('at least %s characters', minimum_password_length);
  end if;

  -- AD-12: a non-routable synthesized address. `.invalid` is reserved by
  -- RFC 2606 and resolves nowhere, so nothing this system creates can send
  -- mail to a real person by accident, and an account is usable by someone who
  -- has no email address at all. The organization's slug namespaces it, so two
  -- organizations may both issue the username an operator finds obvious.
  synthesized_address := admin_username || '@' || organization_slug || '.shift.invalid';

  -- The GoTrue user row, written directly because no secret key is in play.
  --
  -- The four empty strings are not decoration. confirmation_token,
  -- recovery_token, email_change and email_change_token_new are nullable
  -- columns that GoTrue scans into non-nullable Go strings; leaving any of
  -- them null makes every sign-in fail with `500 "Database error querying
  -- schema"`, an error that names none of them. Re-verify this on each
  -- Supabase upgrade — it is an internal expectation, not a documented
  -- contract.
  --
  -- The password is hashed by pgcrypto, schema-qualified because pgcrypto is
  -- installed in `extensions` (declared by migration 0002) and this must not
  -- depend on the connection's search_path.
  --
  -- Cost 10 is not decoration. `gen_salt('bf')` alone defaults to cost 6, and
  -- GoTrue hashes at 10 — so a first admin provisioned here would carry a
  -- weaker hash than every member the application itself later creates, in
  -- production, for the one account that can do anything. The stored hash
  -- starts `$2a$10$`, and `test/provisioning.test.ts` asserts that prefix.
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000',
    new_auth_user_id,
    'authenticated',
    'authenticated',
    synthesized_address,
    extensions.crypt(admin_password, extensions.gen_salt('bf', 10)),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  -- Without a matching identity a password grant cannot resolve the user at
  -- all: GoTrue looks the account up through auth.identities, not through
  -- auth.users.email.
  insert into auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    created_at,
    updated_at
  ) values (
    new_auth_user_id::text,
    new_auth_user_id,
    jsonb_build_object(
      'sub', new_auth_user_id::text,
      'email', synthesized_address,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(),
    now()
  );

  -- `username` carries `admin_username` and nothing else (0007). It is the same
  -- value the synthesized address above was built from, and the two cannot be
  -- held together by any constraint — `admin_name` here would typecheck, run,
  -- and leave the provisioned admin with a stored username that authenticates
  -- nothing, which is why `test/provisioning.test.ts` reads it back and
  -- compares it against the local part of the address GoTrue actually holds.
  insert into members (
    organization_id, auth_user_id, name, username, email, role, leave_allowance_days
  ) values (
    new_organization_id, new_auth_user_id, admin_name, admin_username, admin_email, 'admin', admin_leave_allowance_days
  );

  -- The operator needs the address back: it is what the admin signs in with,
  -- and it is derived rather than supplied.
  raise notice 'organization % provisioned; admin signs in as %', new_organization_id, synthesized_address;
end
$$;
