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
  -- Organization. No value is defaulted: a default here is where one
  -- organization's answer becomes every organization's answer.
  organization_slug          text     := nullif(btrim(coalesce(current_setting('shift.organization_slug', true), '')), '');
  organization_name          text     := nullif(btrim(coalesce(current_setting('shift.organization_name', true), '')), '');
  organization_short_name    text     := nullif(btrim(coalesce(current_setting('shift.organization_short_name', true), '')), '');
  organization_description   text     := nullif(btrim(coalesce(current_setting('shift.organization_description', true), '')), '');
  organization_address       text     := nullif(btrim(coalesce(current_setting('shift.organization_address', true), '')), '');
  organization_contact_email text     := nullif(btrim(coalesce(current_setting('shift.organization_contact_email', true), '')), '');
  organization_type          text     := nullif(btrim(coalesce(current_setting('shift.organization_type', true), '')), '');
  organization_timezone      text     := nullif(btrim(coalesce(current_setting('shift.organization_timezone', true), '')), '');
  organization_locale        text     := nullif(btrim(coalesce(current_setting('shift.organization_locale', true), '')), '');
  leave_year_start_month     smallint := nullif(btrim(coalesce(current_setting('shift.leave_year_start_month', true), '')), '')::smallint;
  leave_year_start_day       smallint := nullif(btrim(coalesce(current_setting('shift.leave_year_start_day', true), '')), '')::smallint;

  -- The first admin. AD-12: the operator issues a username, not an address.
  admin_name                 text     := nullif(btrim(coalesce(current_setting('shift.admin_name', true), '')), '');
  admin_username             text     := lower(nullif(btrim(coalesce(current_setting('shift.admin_username', true), '')), ''));
  admin_password             text     := nullif(current_setting('shift.admin_password', true), '');
  admin_email                text     := nullif(btrim(coalesce(current_setting('shift.admin_email', true), '')), '');
  admin_leave_allowance_days smallint := nullif(btrim(coalesce(current_setting('shift.admin_leave_allowance_days', true), '')), '')::smallint;

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

  insert into members (
    organization_id, auth_user_id, name, email, role, leave_allowance_days
  ) values (
    new_organization_id, new_auth_user_id, admin_name, admin_email, 'admin', admin_leave_allowance_days
  );

  -- The operator needs the address back: it is what the admin signs in with,
  -- and it is derived rather than supplied.
  raise notice 'organization % provisioned; admin signs in as %', new_organization_id, synthesized_address;
end
$$;
