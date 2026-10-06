import { randomBytes } from 'node:crypto';

import pg from 'pg';

/**
 * The database the E2E run provisions into: the Supabase CLI's fixed local
 * default, or `SUPABASE_DB_URL` when set to something — the same resolution
 * `test/provisioning.test.ts` uses, so no credential for any other database is
 * written down here and no key is involved at all. `||` rather than `??`, so an
 * exported-but-empty variable still means the local stack.
 */
export const DATABASE_URL =
  process.env['SUPABASE_DB_URL'] || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** The local API gateway (Kong): GoTrue, PostgREST and the Edge Functions. */
export const API_URL = process.env['SUPABASE_API_URL'] || 'http://127.0.0.1:54321';

/** The one origin the admin-auth function's CORS admits locally, and the
 *  origin the suite runs the app on. */
export const APP_ORIGIN = 'http://127.0.0.1:5173';

const REQUEST_TIMEOUT_MS = 3000;

/** What a run without the stack says, naming the command that fixes it. */
export function stackDownMessage(what: string): string {
  return (
    `E2E: ${what} is not reachable. ` +
    'Start the stack with `pnpm exec supabase start` and run `pnpm test:e2e` again.'
  );
}

/** What a run without the served function says. */
export function functionDownMessage(detail: string): string {
  return (
    `E2E: the admin-auth Edge Function is not served for ${APP_ORIGIN} (${detail}). ` +
    'Run `pnpm exec supabase functions serve admin-auth` (it reads supabase/functions/.env, ' +
    `whose allowed origins must include ${APP_ORIGIN}) and run \`pnpm test:e2e\` again.`
  );
}

/** A connected client. The caller ends it. */
export async function connect(url: string = DATABASE_URL): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: REQUEST_TIMEOUT_MS });
  await client.connect();
  return client;
}

/** The address domain every member of the run organization `slug` signs in under. */
export function addressDomain(slug: string): string {
  return `${slug}.shift.invalid`;
}

/** The seed recipe (`supabase/seed.sql`): an auth user, its identity and its
 *  member row, `'{}'` user metadata and the four empty-string token columns. */
export async function insertMember(
  client: pg.Client,
  organizationId: string,
  slug: string,
  person: { readonly name: string; readonly username: string },
  password: string,
): Promise<{ memberId: string; authUserId: string }> {
  const address = `${person.username}@${addressDomain(slug)}`;
  const { rows } = await client.query<{ id: string }>(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
       confirmation_token, recovery_token, email_change, email_change_token_new
     ) values (
       '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       $1, extensions.crypt($2, extensions.gen_salt('bf', 10)), now(),
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
       '{}'::jsonb, now(), now(), '', '', '', ''
     )
     returning id`,
    [address, password],
  );
  const authUserId = rows[0]?.id;
  if (authUserId === undefined) throw new Error('auth.users insert returned no row');

  await client.query(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
     values ($1::text, $1::uuid,
             jsonb_build_object('sub', $1::text, 'email', $2::text,
                                'email_verified', true, 'phone_verified', false),
             'email', now(), now())`,
    [authUserId, address],
  );

  const member = await client.query<{ id: string }>(
    `insert into members (organization_id, auth_user_id, name, username, email, role, leave_allowance_days)
     values ($1, $2, $3, $4, null, 'member_role', 20)
     returning id`,
    [organizationId, authUserId, person.name, person.username],
  );
  const memberId = member.rows[0]?.id;
  if (memberId === undefined) throw new Error('members insert returned no row');

  return { memberId, authUserId };
}

/** What {@link seedFormerMember} wrote, and the month to read them in. */
export interface SeededFormerMember {
  readonly id: string;
  readonly name: string;
  /** The month before the organization's current one, `YYYY-MM`: active throughout it. */
  readonly month: string;
}

/**
 * The username prefix of every member {@link seedFormerMember} writes — and
 * the only members {@link removeFormerMemberInSql} will delete. Neither the
 * fixture's admin (`e2e.admin`) nor its members carry it.
 */
export const FORMER_MEMBER_USERNAME_PREFIX = 'e2e.bivsi.';

/**
 * A member who has LEFT (epic 4 retro, C1), with a fresh name and username
 * under {@link FORMER_MEMBER_USERNAME_PREFIX}: on `teamId` from the first day
 * of the month before the organization's current one, and inactive from the
 * first day of the current one — so they are active on every date of the
 * month returned and inactive today.
 *
 * ACTIVE ALL LAST MONTH relies on the member having NO status version before
 * the inactive one: a member with none is active (0008), and this member is
 * new. No explicit active version is written, because one would change
 * nothing, which the product's history never holds.
 *
 * WHAT THE SQL PATH BYPASSES. This connection is the `postgres` superuser,
 * which is exempt from row level security, so the two insert POLICIES do not
 * apply: `member_status_versions_insert_by_own_active_admin` (0008) and
 * `team_membership_versions_insert_by_own_active_admin` (0010, altered by
 * 0015). Both require a session admin and `effective_from >=
 * organization_today(...)`, and a member who left needs past-dated versions,
 * which only an operator can write. TRIGGERS still fire: the per-statement
 * `*_serialize_organization_writes` (0023) and `member_status_versions_keeps_an_admin`
 * (0023), which this member-role account passes.
 *
 * Call it under the run's rotation hold, and remove the member with
 * {@link removeFormerMemberInSql} before releasing it.
 */
export async function seedFormerMember(slug: string, teamId: string): Promise<SeededFormerMember> {
  const suffix = randomBytes(3).toString('hex');
  const person = { name: `Bivši Član ${suffix}`, username: `${FORMER_MEMBER_USERNAME_PREFIX}${suffix}` };
  const client = await connect();
  try {
    await client.query('begin');
    const found = await client.query<{
      organization_id: string;
      admin_user: string | null;
      this_month: string | null;
      month: string | null;
    }>(
      `select o.id as organization_id,
              (select m.auth_user_id from members m
                where m.organization_id = o.id and m.role = 'admin'
                order by m.created_at, m.id limit 1) as admin_user,
              to_char(date_trunc('month', public.organization_today(o.id)), 'YYYY-MM-DD') as this_month,
              to_char(date_trunc('month', public.organization_today(o.id)) - interval '1 month', 'YYYY-MM') as month
         from organizations o
        where o.slug = $1`,
      [slug],
    );
    const organization = found.rows[0];
    if (organization === undefined) throw new Error(`E2E: no organization ${slug}`);
    const { organization_id: organizationId, admin_user: adminUser, this_month: thisMonth, month } = organization;
    if (adminUser === null) throw new Error(`E2E: the organization ${slug} has no admin to write as`);
    if (thisMonth === null || month === null) throw new Error(`E2E: organization_today is null for ${slug}`);
    const { memberId } = await insertMember(client, organizationId, slug, person, randomBytes(18).toString('base64url'));
    await client.query(
      `insert into team_membership_versions (organization_id, member_id, team_id, effective_from, created_by)
       values ($1, $2, $3, $4::date, $5)`,
      [organizationId, memberId, teamId, `${month}-01`, adminUser],
    );
    await client.query(
      `insert into member_status_versions (organization_id, member_id, active, effective_from, created_by)
       values ($1, $2, false, $3::date, $4)`,
      [organizationId, memberId, thisMonth, adminUser],
    );
    await client.query('commit');

    return { id: memberId, name: person.name, month };
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    await client.end();
  }
}

/**
 * Deletes a member {@link seedFormerMember} wrote, through their auth user, from
 * which the member row and its versions cascade. Their conflict resolutions
 * (story 5.4a) go first: 0031's member key does not cascade. Safe to call
 * twice: a member already gone is nothing to do. REFUSES any member of `slug`
 * whose username lacks {@link FORMER_MEMBER_USERNAME_PREFIX}, so a wrong id
 * never deletes the fixture's admin or members.
 */
export async function removeFormerMemberInSql(slug: string, memberId: string): Promise<void> {
  const client = await connect();
  try {
    const found = await client.query<{ username: string | null }>(
      `select m.username from members m join organizations o on o.id = m.organization_id
        where o.slug = $1 and m.id = $2`,
      [slug, memberId],
    );
    const member = found.rows[0];
    if (member === undefined) return;
    if (member.username === null || !member.username.startsWith(FORMER_MEMBER_USERNAME_PREFIX)) {
      throw new Error(`E2E: refusing to delete ${memberId}, not a member seedFormerMember wrote (${member.username})`);
    }
    await client.query(
      `delete from conflict_resolutions c
        using organizations o
        where o.slug = $1 and c.organization_id = o.id and c.member_id = $2`,
      [slug, memberId],
    );
    await client.query(
      `delete from auth.users u
        using members m join organizations o on o.id = m.organization_id
        where m.auth_user_id = u.id and m.id = $2 and o.slug = $1 and m.username like $3`,
      [slug, memberId, `${FORMER_MEMBER_USERNAME_PREFIX.replace(/[\\%_]/g, (c) => `\\${c}`)}%`],
    );
  } finally {
    await client.end();
  }
}

/** What every username {@link seedLeaveMember} writes starts with. */
const LEAVE_MEMBER_USERNAME_PREFIX = 'e2e.godisnji.';

/** A member {@link seedLeaveMember} wrote. */
export interface SeededLeaveMember {
  readonly id: string;
  readonly name: string;
  /**
   * Its credentials (story 5.2c), so a test can sign the member in to a fresh
   * context of its own and read *Godišnji* as them — the shared fixture
   * member then never holds leave. Random per member, never logged.
   */
  readonly username: string;
  readonly password: string;
}

/**
 * A fresh active member-role account of the run organization, on `teamId`
 * from `today` — the organization's, as the caller already read it (a
 * {@link SeededRotation}'s `today`) — with `allowanceDays` of annual leave, in SQL
 * (story 5.1c). FRESH PER TEST: leave records persist for the run and a
 * member a record names is never deleted (0028's key does not cascade), so
 * each test records leave on a member nobody else has touched. The member
 * stays until the run's organization is deleted at teardown.
 *
 * Same SQL path as {@link seedFormerMember}: the superuser bypasses the
 * insert policies, and the per-statement triggers still fire.
 */
export async function seedLeaveMember(
  slug: string,
  teamId: string,
  today: string,
  allowanceDays: number,
  /** Words after the fresh `Godišnji {suffix}`, for a longer name (story 5.4c's phone test). */
  nameTail = '',
): Promise<SeededLeaveMember> {
  const suffix = randomBytes(3).toString('hex');
  const person = { name: `Godišnji ${suffix}${nameTail === '' ? '' : ` ${nameTail}`}`, username: `${LEAVE_MEMBER_USERNAME_PREFIX}${suffix}` };
  const client = await connect();
  try {
    await client.query('begin');
    const found = await client.query<{ organization_id: string; admin_user: string | null }>(
      `select o.id as organization_id,
              (select m.auth_user_id from members m
                where m.organization_id = o.id and m.role = 'admin'
                order by m.created_at, m.id limit 1) as admin_user
         from organizations o
        where o.slug = $1`,
      [slug],
    );
    const organization = found.rows[0];
    if (organization === undefined) throw new Error(`E2E: no organization ${slug}`);
    const { organization_id: organizationId, admin_user: adminUser } = organization;
    if (adminUser === null) throw new Error(`E2E: the organization ${slug} has no admin to write as`);
    const password = randomBytes(18).toString('base64url');
    const { memberId } = await insertMember(client, organizationId, slug, person, password);
    await client.query('update members set leave_allowance_days = $2 where id = $1', [memberId, allowanceDays]);
    await client.query(
      `insert into team_membership_versions (organization_id, member_id, team_id, effective_from, created_by)
       values ($1, $2, $3, $4::date, $5)`,
      [organizationId, memberId, teamId, today, adminUser],
    );
    await client.query('commit');

    return { id: memberId, name: person.name, username: person.username, password };
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    await client.end();
  }
}

/**
 * Status versions of a member {@link seedLeaveMember} wrote (story 5.5e), in
 * SQL, attributed to the run organization's first admin — a deactivation from
 * a date and a reactivation scheduled after it, say. The superuser bypasses
 * the insert policy (0008); the triggers still fire. The versions cascade
 * with the member ({@link removeLeaveMemberInSql}).
 */
export async function seedMemberStatusVersions(
  slug: string,
  memberId: string,
  versions: readonly { readonly active: boolean; readonly effectiveFrom: string }[],
): Promise<void> {
  const client = await connect();
  try {
    await client.query('begin');
    const found = await client.query<{ organization_id: string; admin_user: string | null }>(
      `select o.id as organization_id,
              (select a.auth_user_id from members a
                where a.organization_id = o.id and a.role = 'admin'
                order by a.created_at, a.id limit 1) as admin_user
         from organizations o join members m on m.organization_id = o.id
        where o.slug = $1 and m.id = $2`,
      [slug, memberId],
    );
    const organization = found.rows[0];
    if (organization === undefined) throw new Error(`E2E: no member ${memberId} in the organization ${slug}`);
    if (organization.admin_user === null) throw new Error(`E2E: the organization ${slug} has no admin to write as`);
    for (const version of versions) {
      await client.query(
        `insert into member_status_versions (organization_id, member_id, active, effective_from, created_by)
         values ($1, $2, $3, $4::date, $5)`,
        [organization.organization_id, memberId, version.active, version.effectiveFrom, organization.admin_user],
      );
    }
    await client.query('commit');
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    await client.end();
  }
}

/**
 * Deletes a member {@link seedLeaveMember} wrote (story 5.5a's cleanup), with
 * everything that names them: their conflict resolutions and leave records —
 * neither key cascades (0028, 0031) — and then their auth user, from which
 * the member row and its versions cascade. Run it after the rotation seed is
 * removed, so no roster override names them. Safe to call twice: a member
 * already gone is nothing to do. REFUSES any member whose username is not one
 * {@link seedLeaveMember} writes, so a wrong id never deletes the fixture's
 * admin or members.
 */
export async function removeLeaveMemberInSql(slug: string, memberId: string): Promise<void> {
  const client = await connect();
  try {
    const found = await client.query<{ username: string | null; organization_id: string }>(
      `select m.username, m.organization_id from members m join organizations o on o.id = m.organization_id
        where o.slug = $1 and m.id = $2`,
      [slug, memberId],
    );
    const member = found.rows[0];
    if (member === undefined) return;
    if (member.username === null || !member.username.startsWith(LEAVE_MEMBER_USERNAME_PREFIX)) {
      throw new Error(`E2E: refusing to delete ${memberId}, not a member seedLeaveMember wrote (${member.username})`);
    }
    await client.query('begin');
    const scope = [member.organization_id, memberId];
    await client.query('delete from conflict_resolutions where organization_id = $1 and member_id = $2', scope);
    await client.query('delete from leave_records where organization_id = $1 and member_id = $2', scope);
    await client.query(
      'delete from auth.users u using members m where m.auth_user_id = u.id and m.organization_id = $1 and m.id = $2',
      scope,
    );
    await client.query('commit');
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    await client.end();
  }
}

/**
 * Makes a member {@link seedLeaveMember} wrote an ADMIN of the run
 * organization, in SQL (story 6.3): an admin of the test's own, on the test's
 * own team, so the shared fixture admin is never put on a team under a
 * concurrent spec. {@link removeLeaveMemberInSql} deletes them as any other.
 * REFUSES any member whose username is not one {@link seedLeaveMember} writes.
 */
export async function promoteToAdminInSql(slug: string, memberId: string): Promise<void> {
  const client = await connect();
  try {
    const { rowCount } = await client.query(
      `update members m set role = 'admin'
         from organizations o
        where o.id = m.organization_id and o.slug = $1 and m.id = $2 and m.username like $3`,
      [slug, memberId, `${LEAVE_MEMBER_USERNAME_PREFIX}%`],
    );
    if (rowCount !== 1) throw new Error(`E2E: ${memberId} is not a member seedLeaveMember wrote in ${slug}`);
  } finally {
    await client.end();
  }
}

/** Where the run organization's leave year begins (story 5.1c): a month 1–12 and a day 1–28. */
export async function leaveYearStartOf(slug: string): Promise<{ readonly month: number; readonly day: number }> {
  const client = await connect();
  try {
    const { rows } = await client.query<{ month: number; day: number }>(
      `select leave_year_start_month as month, leave_year_start_day as day from organizations where slug = $1`,
      [slug],
    );
    const start = rows[0];
    if (start === undefined) throw new Error(`E2E: no organization ${slug}`);

    return { month: Number(start.month), day: Number(start.day) };
  } finally {
    await client.end();
  }
}

/**
 * A live leave record of `memberId` from `from` to `to` (both `YYYY-MM-DD`,
 * both included), in SQL (story 5.2b), attributed to the run organization's
 * first admin. 0028's checks and its exclusion constraint still apply: the
 * superuser bypasses only the insert policy. Throws naming the lookup that
 * failed: the member in the organization, or its admin.
 */
export async function seedLeaveRecord(slug: string, memberId: string, from: string, to: string): Promise<string> {
  const client = await connect();
  try {
    const found = await client.query<{ organization_id: string; admin_user: string | null }>(
      `select o.id as organization_id,
              (select a.auth_user_id from members a
                where a.organization_id = o.id and a.role = 'admin'
                order by a.created_at, a.id limit 1) as admin_user
         from organizations o join members m on m.organization_id = o.id
        where o.slug = $1 and m.id = $2`,
      [slug, memberId],
    );
    const organization = found.rows[0];
    if (organization === undefined) throw new Error(`E2E: no member ${memberId} in the organization ${slug}`);
    if (organization.admin_user === null) {
      throw new Error(`E2E: the organization ${slug} has no admin to attribute the leave record to`);
    }
    const { rows } = await client.query<{ id: string }>(
      `insert into leave_records (organization_id, member_id, during, created_by)
       values ($1, $2, daterange($3::date, $4::date, '[]'), $5)
       returning id`,
      [organization.organization_id, memberId, from, to, organization.admin_user],
    );
    const record = rows[0];
    if (record === undefined) throw new Error(`E2E: the leave record ${from}–${to} of ${memberId} was not inserted`);

    return record.id;
  } finally {
    await client.end();
  }
}

/**
 * A live conflict resolution of `memberId`'s conflict on `date` on `teamId`
 * (`YYYY-MM-DD`), in SQL (story 5.4a), attributed to the run organization's
 * first admin: what 5.4b–d's screen will record. 0031's checks and its live
 * key still apply: the superuser bypasses only the insert policy. No collision
 * need exist — none is stored — but a test seeds one on a collision it reads.
 *
 * A `replace_member` resolution (story 5.4c) names its roster override, which
 * 0032's check requires: pass `replacementId`, and the override putting them
 * on the shift is written first, in the same transaction, as 0032's function
 * writes it — call it under the rotation hold, so {@link removeSeededRotation}
 * deletes both. Throws naming the lookup that failed: the member or team in
 * the organization, or its admin.
 */
export async function seedConflictResolution(
  slug: string,
  memberId: string,
  date: string,
  teamId: string,
  kind: 'accept_uncovered' | 'replace_member' | 'amend_leave' = 'accept_uncovered',
  replacementId: string | null = null,
): Promise<string> {
  if ((kind === 'replace_member') !== (replacementId !== null)) {
    throw new Error('E2E: a replace_member resolution, and only one, names its replacement');
  }
  const client = await connect();
  try {
    await client.query('begin');
    const found = await client.query<{ organization_id: string; admin_user: string | null }>(
      `select o.id as organization_id,
              (select a.auth_user_id from members a
                where a.organization_id = o.id and a.role = 'admin'
                order by a.created_at, a.id limit 1) as admin_user
         from organizations o
         join members m on m.organization_id = o.id
         join teams t on t.organization_id = o.id
        where o.slug = $1 and m.id = $2 and t.id = $3`,
      [slug, memberId, teamId],
    );
    const organization = found.rows[0];
    if (organization === undefined) throw new Error(`E2E: no member ${memberId} and team ${teamId} in the organization ${slug}`);
    if (organization.admin_user === null) {
      throw new Error(`E2E: the organization ${slug} has no admin to attribute the resolution to`);
    }
    let overrideId: string | null = null;
    if (replacementId !== null) {
      const written = await client.query<{ id: string }>(
        `insert into roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason, created_by)
         values ($1, $2, $3::date, null, $4, 'E2E zamjena', $5)
         returning id`,
        [organization.organization_id, teamId, date, replacementId, organization.admin_user],
      );
      overrideId = written.rows[0]?.id ?? null;
      if (overrideId === null) throw new Error(`E2E: the replacement's override on ${date} was not inserted`);
    }
    const { rows } = await client.query<{ id: string }>(
      `insert into conflict_resolutions (organization_id, member_id, date, team_id, kind, created_by, roster_override_id)
       values ($1, $2, $3::date, $4, $5, $6, $7)
       returning id`,
      [organization.organization_id, memberId, date, teamId, kind, organization.admin_user, overrideId],
    );
    const resolution = rows[0];
    if (resolution === undefined) throw new Error(`E2E: the resolution of ${memberId} on ${date} was not inserted`);
    await client.query('commit');

    return resolution.id;
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    await client.end();
  }
}

/**
 * Soft-removes every live leave record of `memberId` in SQL, as 0031's
 * `remove_leave_record` would (stories 5.2b, 5.4a): `removed_by` and
 * `removed_at` together, attributed to the organization's first admin, and
 * the lifetime rule with them — every live conflict resolution of the member
 * dated in a removed range is soft-removed the same way, in the same
 * transaction. For a test that needs a record gone from under the screen
 * showing it. Throws when it removes nothing, so a test never goes on
 * believing a record is gone.
 */
export async function removeLeaveRecordsInSql(slug: string, memberId: string): Promise<void> {
  const client = await connect();
  try {
    await client.query('begin');
    const { rowCount } = await client.query(
      `with admin as (
         select o.id as organization_id,
                (select a.auth_user_id from members a
                  where a.organization_id = o.id and a.role = 'admin'
                  order by a.created_at, a.id limit 1) as auth_user_id
           from organizations o
          where o.slug = $1
       ),
       removed as (
         update leave_records r
            set removed_by = admin.auth_user_id,
                removed_at = now()
           from admin
          where r.organization_id = admin.organization_id and r.member_id = $2 and r.removed_at is null
         returning r.organization_id, r.member_id, r.during, r.removed_by
       ),
       ended as (
         update conflict_resolutions c
            set removed_by = removed.removed_by,
                removed_at = now()
           from removed
          where c.organization_id = removed.organization_id
            and c.member_id = removed.member_id
            and c.removed_at is null
            and c.date <@ removed.during
         returning c.id
       )
       select 1 from removed`,
      [slug, memberId],
    );
    if (rowCount === null || rowCount === 0) {
      throw new Error(`E2E: no live leave record of ${memberId} in ${slug} to remove`);
    }
    await client.query('commit');
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    await client.end();
  }
}

/** How long a test waits for another to release the run's rotation. */
const ROTATION_LOCK_WAIT_MS = 60_000;
const ROTATION_LOCK_POLL_MS = 250;

/** A hold on the run organization's rotation (`holdRotation`). */
export interface RotationHold {
  /** Resolves once the lock is held and the rotation reset; rejects naming the lock otherwise. */
  readonly ready: Promise<void>;
  /** Ends the connection — and with it the lock, or the wait for it. Safe at any point, and twice. */
  release(): Promise<void>;
}

/**
 * The run organization's rotation, held by ONE test at a time, freshly reset.
 *
 * A rotation save binds every active team of the organization and a team's
 * rotation changes at most once per date, so two tests that save a rotation
 * (`rotation.spec.ts`, `rotation-phone.spec.ts`) cannot run side by side in
 * one organization: the second save would be refused as already changed
 * today, and the first test's prefill would show the second one's rotation. A
 * session-level advisory lock, keyed by the run's slug, serializes them across
 * workers; it is released when the connection ends.
 *
 * THE WAIT IS BOUNDED: `pg_try_advisory_lock` is polled for
 * {@link ROTATION_LOCK_WAIT_MS}, then `ready` rejects naming the lock. The
 * hold is returned SYNCHRONOUSLY, so a caller can store it before awaiting
 * `ready` and its `afterEach` can release it even when the test timed out
 * mid-wait — the connection is ended on every path, and never left to take
 * the lock later.
 *
 * Once held, the versions an earlier attempt or test dated today or later are
 * removed — in this run's organization only, which is deleted at teardown
 * anyway — so the builder opens on an empty draft.
 */
export function holdRotation(slug: string): RotationHold {
  return holdLock(`e2e-rotation:${slug}`, async (client) => {
    await client.query(
      `delete from rotation_assignments a
        using organizations o
        where a.organization_id = o.id and o.slug = $1
          and a.effective_from >= public.organization_today(o.id)`,
      [slug],
    );
  });
}

/**
 * The run organization's fire-rank setting, held by ONE test at a time (story
 * 3.4b). `fire-ranks.spec.ts` and `team-position.spec.ts` switch it on and
 * read rank lines; `calendar.spec.ts` switches it on and off to read the day
 * detail's roster both ways, then restores it. Under the same bounded,
 * session-level advisory lock as {@link holdRotation}, so none of them reads
 * a setting another is in the middle of changing.
 */
export function holdFireRanks(slug: string): RotationHold {
  return holdLock(`e2e-fire-ranks:${slug}`, async () => undefined);
}

/**
 * A session-level advisory lock on `key`, polled for at most
 * {@link ROTATION_LOCK_WAIT_MS}, with `onHeld` run once it is held. The hold is
 * returned synchronously; see {@link holdRotation}.
 */
function holdLock(key: string, onHeld: (client: pg.Client) => Promise<void>): RotationHold {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: REQUEST_TIMEOUT_MS });
  let released = false;
  let ended: Promise<void> | null = null;

  const end = (): Promise<void> => {
    // Bounded as well: an end asked for while the connect is still under way
    // must not hold up the caller's teardown. The socket goes with the worker.
    ended ??= Promise.race([
      client.end().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, REQUEST_TIMEOUT_MS)),
    ]);
    return ended;
  };

  const ready = (async () => {
    try {
      await client.connect();
      const deadline = Date.now() + ROTATION_LOCK_WAIT_MS;

      for (;;) {
        if (released) throw new Error(`E2E: the wait for the lock ${key} was released before it was held`);

        const answer = await client.query<{ held: boolean }>('select pg_try_advisory_lock(hashtext($1)) as held', [
          key,
        ]);

        if (answer.rows[0]?.held === true) break;
        if (Date.now() >= deadline) {
          throw new Error(`E2E: the lock ${key} was not released within ${ROTATION_LOCK_WAIT_MS} ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, ROTATION_LOCK_POLL_MS));
      }

      await onHeld(client);
    } catch (cause) {
      await end();
      throw cause;
    }
  })();

  return {
    ready,
    async release() {
      released = true;
      await end();
    },
  };
}

/**
 * Archives the run organization's active shift type by that name, if there is
 * one: a test's own cleanup, run from a `finally` so a failure part-way leaves
 * no active type behind in the shared organization. Idempotent.
 */
export async function archiveShiftType(slug: string, name: string): Promise<void> {
  const client = await connect();
  try {
    await client.query(
      `update shift_types set archived = true
        where not archived and name = $2
          and organization_id = (select id from organizations where slug = $1)`,
      [slug, name],
    );
  } finally {
    await client.end();
  }
}

/**
 * The run organization's name as stored (story 4.3): what the hours export's
 * file name carries. Read, never assumed from how the fixture was provisioned.
 */
export async function organizationNameOf(slug: string): Promise<string> {
  const client = await connect();
  try {
    const answer = await client.query<{ name: string }>('select name from organizations where slug = $1', [slug]);
    const name = answer.rows[0]?.name;

    if (name === undefined) throw new Error(`E2E: no organization ${slug}`);

    return name;
  } finally {
    await client.end();
  }
}

/**
 * Sets the run organization's `uses_fire_ranks` and answers what it was, so
 * the caller can restore it. Call it under {@link holdFireRanks}.
 */
export async function setFireRanks(slug: string, on: boolean): Promise<boolean> {
  const client = await connect();
  try {
    const before = await client.query<{ uses_fire_ranks: boolean }>(
      'select uses_fire_ranks from organizations where slug = $1',
      [slug],
    );
    const was = before.rows[0]?.uses_fire_ranks;
    if (was === undefined) throw new Error(`E2E: no organization ${slug}`);
    await client.query('update organizations set uses_fire_ranks = $2 where slug = $1', [slug, on]);

    return was;
  } finally {
    await client.end();
  }
}

/** A member's rank and their position on a team, as {@link setRankAndPosition} found them. */
export interface RankAndPosition {
  readonly fireRank: string | null;
  readonly position: string | null;
}

/**
 * Gives the run organization's member named `name` a rank and, on EVERY
 * membership version of theirs on `teamId`, a position — in place, since the
 * fixture's one version is dated today — and answers what they were, so the
 * caller can restore them with the same call.
 */
export async function setRankAndPosition(
  slug: string,
  name: string,
  teamId: string,
  { fireRank, position }: RankAndPosition,
): Promise<RankAndPosition> {
  const client = await connect();
  try {
    await client.query('begin');
    const found = await client.query<{ id: string; organization_id: string; fire_rank: string | null }>(
      `select m.id, m.organization_id, m.fire_rank
         from members m join organizations o on o.id = m.organization_id
        where o.slug = $1 and m.name = $2`,
      [slug, name],
    );
    const member = found.rows[0];
    if (member === undefined || found.rows.length !== 1) throw new Error(`E2E: no one member ${name} in ${slug}`);
    const versions = await client.query<{ position: string | null }>(
      `select position from team_membership_versions
        where organization_id = $1 and member_id = $2 and team_id = $3
        order by effective_from desc limit 1`,
      [member.organization_id, member.id, teamId],
    );
    await client.query('update members set fire_rank = $2 where id = $1', [member.id, fireRank]);
    await client.query(
      `update team_membership_versions set position = $4
        where organization_id = $1 and member_id = $2 and team_id = $3`,
      [member.organization_id, member.id, teamId, position],
    );
    await client.query('commit');

    return { fireRank: member.fire_rank, position: versions.rows[0]?.position ?? null };
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    await client.end();
  }
}

/** What {@link seedTeamRotation} wrote: the four-step pattern's type names and the date it starts. */
export interface SeededRotation {
  /** The organization's today, `YYYY-MM-DD`. */
  readonly today: string;
  /** The version's effective date and anchor, `YYYY-MM-DD`: `today`, unless the seed started earlier. */
  readonly start: string;
  /** The pattern's step types in order — working, working, non-working, non-working. */
  readonly steps: readonly [string, string, string, string];
  /** Each step's `19:00–07:00` as the calendar shows it, from the times seeded; `null` for a non-working one. */
  readonly ranges: readonly [string | null, string | null, string | null, string | null];
  /** What {@link removeSeededRotation} deletes. */
  readonly organizationId: string;
  readonly patternId: string;
  readonly shiftTypeIds: readonly string[];
}

/**
 * Gives ONE team of the run organization a rotation from today, in SQL (story
 * 3.1): three new shift types — `Dan <suffix>` 07:00–19:00, `Noć <suffix>`
 * 19:00–07:00 and `Slobodno <suffix>` — a pattern `[Dan, Noć, Slobodno,
 * Slobodno]`, and a version for `teamId` effective from and anchored on the
 * organization's today at the first step, attributed to the run's admin.
 * `daysBefore` starts the version that many days before today instead (story
 * 5.3b), so dates already past are scheduled too; the policy that refuses a
 * past version is the API's, and this SQL path bypasses it.
 *
 * CALL IT UNDER {@link holdRotation}, and undo it with
 * {@link removeSeededRotation} before releasing the hold, so no other spec
 * ever lists, counts or ramps these types.
 */
export async function seedTeamRotation(
  slug: string,
  teamId: string,
  suffix: string,
  daysBefore = 0,
): Promise<SeededRotation> {
  const client = await connect();
  try {
    await client.query('begin');
    const found = await client.query<{ organization_id: string; admin_user: string; today: string; start: string }>(
      `select o.id as organization_id, m.auth_user_id as admin_user,
              to_char(public.organization_today(o.id), 'YYYY-MM-DD') as today,
              to_char(public.organization_today(o.id) - $2::int, 'YYYY-MM-DD') as start
         from organizations o
         join members m on m.organization_id = o.id and m.role = 'admin'
        where o.slug = $1
        order by m.created_at, m.id
        limit 1`,
      [slug, daysBefore],
    );
    const organization = found.rows[0];
    if (organization === undefined) throw new Error(`E2E: no organization ${slug} to seed a rotation in`);
    const { organization_id: organizationId, admin_user: admin, today, start } = organization;

    const names = [`Dan ${suffix}`, `Noć ${suffix}`, `Slobodno ${suffix}`] as const;
    const typeIds: string[] = [];
    for (const [index, name] of names.entries()) {
      const type = await client.query<{ id: string }>(
        `insert into shift_types (organization_id, name, is_working, created_by)
         values ($1, $2, $3, $4) returning id`,
        [organizationId, name, index < 2, admin],
      );
      const id = type.rows[0]?.id;
      if (id === undefined) throw new Error('E2E: shift_types insert returned no row');
      typeIds.push(id);
    }
    const [dan, noc, slobodno] = typeIds as [string, string, string];
    const times = [
      [dan, '07:00', '19:00'],
      [noc, '19:00', '07:00'],
    ] as const;
    for (const [shiftTypeId, start, end] of times) {
      await client.query(
        `insert into shift_type_versions (organization_id, shift_type_id, start_time, end_time, effective_from, created_by)
         values ($1, $2, $3::time, $4::time, date '2020-01-01', $5)`,
        [organizationId, shiftTypeId, start, end, admin],
      );
    }

    const pattern = await client.query<{ id: string }>(
      'insert into rotation_patterns (organization_id, created_by) values ($1, $2) returning id',
      [organizationId, admin],
    );
    const patternId = pattern.rows[0]?.id;
    if (patternId === undefined) throw new Error('E2E: rotation_patterns insert returned no row');

    let firstStep: string | undefined;
    for (const [position, shiftTypeId] of [dan, noc, slobodno, slobodno].entries()) {
      const step = await client.query<{ id: string }>(
        `insert into rotation_steps (organization_id, pattern_id, position, shift_type_id, created_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [organizationId, patternId, position, shiftTypeId, admin],
      );
      firstStep ??= step.rows[0]?.id;
    }
    if (firstStep === undefined) throw new Error('E2E: rotation_steps insert returned no row');

    await client.query(
      `insert into rotation_assignments
         (organization_id, team_id, pattern_id, offset_step_id, anchor_date, effective_from, created_by)
       values ($1, $2, $3, $4, $5::date, $5::date, $6)`,
      [organizationId, teamId, patternId, firstStep, start, admin],
    );
    await client.query('commit');

    return {
      today,
      start,
      steps: [names[0], names[1], names[2], names[2]],
      ranges: [`${times[0][1]}–${times[0][2]}`, `${times[1][1]}–${times[1][2]}`, null, null],
      organizationId,
      patternId,
      shiftTypeIds: typeIds,
    };
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    await client.end();
  }
}

/** What {@link seedShiftTypeOverride} wrote, as the day detail names it (story 3.5a). */
export interface SeededOverride {
  /** The type worked in place of the projected one. */
  readonly typeName: string;
  readonly reason: string;
  /** When it was saved, in the organization's zone: `12.09.2026` and `19:05`. */
  readonly savedDate: string;
  readonly savedTime: string;
}

/**
 * Overrides `teamId`'s type on `date` with the seeded rotation's step type at
 * `step` (story 3.5a), attributed to the run's admin, in SQL — no product
 * surface writes one yet (3.5b). Call it after {@link seedTeamRotation}, under
 * the same hold; {@link removeSeededRotation} deletes it with the types.
 */
export async function seedShiftTypeOverride(
  rotation: SeededRotation,
  teamId: string,
  date: string,
  step: 0 | 1 | 2 | 3,
  reason: string,
): Promise<SeededOverride> {
  const client = await connect();
  try {
    const typeName = rotation.steps[step];
    const { rows } = await client.query<{ saved_date: string; saved_time: string }>(
      `with admin as (
         select m.auth_user_id from members m
          where m.organization_id = $1 and m.role = 'admin'
          order by m.created_at, m.id limit 1
       ),
       written as (
         insert into shift_type_overrides (organization_id, team_id, date, shift_type_id, reason, created_by)
         select $1, $2, $3::date, t.id, $5, (select auth_user_id from admin)
           from shift_types t
          where t.organization_id = $1 and t.id = any($6::uuid[]) and t.name = $4
         returning created_at
       )
       select to_char(w.created_at at time zone o.timezone, 'DD.MM.YYYY') as saved_date,
              to_char(w.created_at at time zone o.timezone, 'HH24:MI') as saved_time
         from written w cross join organizations o
        where o.id = $1`,
      [rotation.organizationId, teamId, date, typeName, reason, rotation.shiftTypeIds],
    );
    const written = rows[0];
    if (written === undefined || rows.length !== 1) throw new Error('E2E: the shift-type override was not written');

    return { typeName, reason, savedDate: written.saved_date, savedTime: written.saved_time };
  } finally {
    await client.end();
  }
}

/**
 * A second active team in the run organization (story 3.6a), attributed to
 * its admin, in SQL — so a member of the fixture team can be put on another
 * team's shift while their own works: a double shift. Other specs already
 * leave teams of their own in the run organization, so nothing counts on one.
 * {@link removeTeamInSql} deletes it.
 */
export async function seedExtraTeam(slug: string, name: string): Promise<{ readonly id: string; readonly name: string }> {
  const client = await connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `insert into teams (organization_id, name, created_by)
       select o.id, $2,
              (select m.auth_user_id from members m
                where m.organization_id = o.id and m.role = 'admin'
                order by m.created_at, m.id limit 1)
         from organizations o
        where o.slug = $1
       returning id::text as id`,
      [slug, name],
    );
    const id = rows[0]?.id;
    if (id === undefined || rows.length !== 1) throw new Error(`E2E: the team ${name} was not written`);

    return { id, name };
  } finally {
    await client.end();
  }
}

/**
 * Deletes a team {@link seedExtraTeam} wrote, once its rotation and every
 * roster override naming it are gone ({@link removeSeededRotation}). Safe to
 * call twice.
 */
export async function removeTeamInSql(slug: string, teamId: string): Promise<void> {
  const client = await connect();
  try {
    await client.query(
      `delete from teams where id = $2 and organization_id = (select id from organizations where slug = $1)`,
      [slug, teamId],
    );
  } finally {
    await client.end();
  }
}

/**
 * Takes every member off `teamId` in SQL (story 6.2): deletes the membership
 * versions naming it, so {@link removeTeamInSql} can delete the team a test
 * put a fresh member on. The member stays, on no team.
 */
export async function removeTeamMembershipsInSql(slug: string, teamId: string): Promise<void> {
  const client = await connect();
  try {
    await client.query(
      `delete from team_membership_versions
        where team_id = $2 and organization_id = (select id from organizations where slug = $1)`,
      [slug, teamId],
    );
  } finally {
    await client.end();
  }
}

/**
 * The instant at which the run organization's wall clock reads `time` on
 * `date` (story 6.2), from the database's own zone rules — what a test sets
 * `page.clock` to, so "21:10 today" is the organization's, never the
 * machine's.
 */
export async function organizationInstant(slug: string, date: string, time: string): Promise<Date> {
  const client = await connect();
  try {
    const { rows } = await client.query<{ epoch_ms: string }>(
      `select (extract(epoch from (($2::date + $3::time) at time zone o.timezone)) * 1000)::bigint::text as epoch_ms
         from organizations o
        where o.slug = $1`,
      [slug, date, time],
    );
    const found = rows[0];
    if (found === undefined) throw new Error(`E2E: no organization ${slug} to read the clock of`);

    return new Date(Number(found.epoch_ms));
  } finally {
    await client.end();
  }
}

/** What {@link seedRosterOverride} wrote, as the day detail names it (story 3.6a). */
export interface SeededRosterOverride {
  readonly reason: string;
  /** When it was saved, in the organization's zone: `12.09.2026` and `19:05`. */
  readonly savedDate: string;
  readonly savedTime: string;
}

/**
 * A roster override on `teamId`'s shift on `date` (story 3.6a): the member
 * named `outName` taken off and the one named `inName` put on — either
 * `null` — attributed to the run's admin, in SQL, as the admin's form (story
 * 3.6b) would write it; an inert one, too, which the form never offers.
 * Written now, after the seeded rotation, so it is in force.
 * Call it after {@link seedTeamRotation}, under the same hold;
 * {@link removeSeededRotation} deletes it.
 */
export async function seedRosterOverride(
  rotation: SeededRotation,
  teamId: string,
  date: string,
  outName: string | null,
  inName: string | null,
  reason: string,
): Promise<SeededRosterOverride> {
  const client = await connect();
  try {
    // Each named member resolves to exactly one, or the seed throws: a name
    // that silently became null would turn a replacement into an addition or
    // a removal.
    const idOf = async (name: string | null): Promise<string | null> => {
      if (name === null) return null;
      const { rows: found } = await client.query<{ id: string }>(
        'select id::text as id from members where organization_id = $1 and name = $2',
        [rotation.organizationId, name],
      );
      const [only] = found;
      if (only === undefined || found.length !== 1) {
        throw new Error(`E2E: the roster override names ${name}, who is ${String(found.length)} members, not one`);
      }
      return only.id;
    };
    const outId = await idOf(outName);
    const inId = await idOf(inName);
    const { rows } = await client.query<{ saved_date: string; saved_time: string }>(
      `with admin as (
         select m.auth_user_id from members m
          where m.organization_id = $1 and m.role = 'admin'
          order by m.created_at, m.id limit 1
       ),
       written as (
         insert into roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason, created_by)
         select $1, $2, $3::date, $4::uuid, $5::uuid, $6, (select auth_user_id from admin)
         returning created_at
       )
       select to_char(w.created_at at time zone o.timezone, 'DD.MM.YYYY') as saved_date,
              to_char(w.created_at at time zone o.timezone, 'HH24:MI') as saved_time
         from written w cross join organizations o
        where o.id = $1`,
      [rotation.organizationId, teamId, date, outId, inId, reason],
    );
    const written = rows[0];
    if (written === undefined || rows.length !== 1) throw new Error('E2E: the roster override was not written');

    return { reason, savedDate: written.saved_date, savedTime: written.saved_time };
  } finally {
    await client.end();
  }
}

/**
 * Soft-removes the live override of `teamId` on `date` in SQL, attributed to
 * its own author (story 3.5b) — as another admin's removal landing while the
 * screen still shows it. {@link removeSeededRotation} deletes it with the
 * types.
 */
export async function removeOverrideInSql(rotation: SeededRotation, teamId: string, date: string): Promise<void> {
  const client = await connect();
  try {
    const { rowCount } = await client.query(
      `update shift_type_overrides set removed_by = created_by, removed_at = now()
        where organization_id = $1 and team_id = $2 and date = $3::date and removed_at is null`,
      [rotation.organizationId, teamId, date],
    );
    if (rowCount !== 1) throw new Error('E2E: no live shift-type override to remove');
  } finally {
    await client.end();
  }
}

/**
 * Soft-removes every live roster override of `teamId` on `date` in SQL,
 * attributed to its own author (story 3.6b) — as another admin's removal
 * landing while the screen still shows it. {@link removeSeededRotation}
 * deletes it.
 */
export async function removeRosterOverridesInSql(rotation: SeededRotation, teamId: string, date: string): Promise<void> {
  const client = await connect();
  try {
    const { rowCount } = await client.query(
      `update roster_overrides set removed_by = created_by, removed_at = now()
        where organization_id = $1 and team_id = $2 and date = $3::date and removed_at is null`,
      [rotation.organizationId, teamId, date],
    );
    if ((rowCount ?? 0) < 1) throw new Error('E2E: no live roster override to remove');
  } finally {
    await client.end();
  }
}

/**
 * A rotation change of `teamId` from `date`, in SQL (story 3.5c): a second
 * version of the seeded pattern, anchored on `date` at the seeded step
 * `step`, attributed to the run's admin and saved NOW — after every override
 * written before it, which it therefore leaves pending review. Call it under
 * the seed's hold; {@link removeSeededRotation} deletes it with the pattern.
 */
export async function seedRotationChange(
  rotation: SeededRotation,
  teamId: string,
  date: string,
  step: 0 | 1 | 2 | 3,
): Promise<void> {
  const client = await connect();
  try {
    const { rowCount } = await client.query(
      `insert into rotation_assignments
         (organization_id, team_id, pattern_id, offset_step_id, anchor_date, effective_from, created_by)
       select $1, $2, $3, s.id, $4::date, $4::date,
              (select m.auth_user_id from members m
                where m.organization_id = $1 and m.role = 'admin'
                order by m.created_at, m.id limit 1)
         from rotation_steps s
        where s.organization_id = $1 and s.pattern_id = $3 and s.position = $5`,
      [rotation.organizationId, teamId, rotation.patternId, date, step],
    );
    if (rowCount !== 1) throw new Error('E2E: the rotation change was not written');
  } finally {
    await client.end();
  }
}

/**
 * What is left of one rotation pattern, by id: the pattern row, and its steps.
 * A failed save that cleaned up after itself (`0025`) leaves `{ patterns: 0,
 * steps: 0 }`. Scoped to the one id, so no other session's patterns count.
 */
export async function patternRowsLeft(patternId: string): Promise<{ patterns: number; steps: number }> {
  const client = await connect();
  try {
    const { rows } = await client.query<{ patterns: number; steps: number }>(
      `select (select count(*)::int from rotation_patterns where id = $1) as patterns,
              (select count(*)::int from rotation_steps where pattern_id = $1) as steps`,
      [patternId],
    );

    return rows[0] ?? { patterns: -1, steps: -1 };
  } finally {
    await client.end();
  }
}

/** The database's own now, as text: a stamp to scope a test's cleanup by. */
export async function databaseNow(): Promise<string> {
  const client = await connect();
  try {
    const { rows } = await client.query<{ now: string }>('select now()::text as now');
    const now = rows[0]?.now;
    if (now === undefined) throw new Error('E2E: the database answered no time');

    return now;
  } finally {
    await client.end();
  }
}

/**
 * Undoes a rotation change the BUILDER saved over {@link seedTeamRotation}'s
 * rotation (story 3.5c), so {@link removeSeededRotation} can then delete the
 * seeded types. Only what the test wrote SINCE `since` (a database instant
 * taken at its start, {@link databaseNow}): the versions saved since then and
 * dated after the seed's today, and every pattern created since then that no
 * version names any more and whose steps name a seeded type, with its steps.
 * In this run's organization only, under the seed's hold. Safe to call twice.
 */
export async function removeRotationChangesOver(seeded: SeededRotation, since: string): Promise<void> {
  const client = await connect();
  try {
    await client.query('begin');
    await client.query(
      `delete from rotation_assignments
        where organization_id = $1 and effective_from > $2::date and created_at >= $3::timestamptz`,
      [seeded.organizationId, seeded.today, since],
    );
    const { rows } = await client.query<{ id: string }>(
      `select p.id from rotation_patterns p
        where p.organization_id = $1 and p.id <> $2 and p.created_at >= $4::timestamptz
          and not exists (select 1 from rotation_assignments a
                           where a.organization_id = p.organization_id and a.pattern_id = p.id)
          and exists (select 1 from rotation_steps s
                       where s.organization_id = p.organization_id and s.pattern_id = p.id
                         and s.shift_type_id = any($3::uuid[]))`,
      [seeded.organizationId, seeded.patternId, seeded.shiftTypeIds, since],
    );
    const orphans = rows.map((row) => row.id);
    await client.query('delete from rotation_steps where organization_id = $1 and pattern_id = any($2::uuid[])', [
      seeded.organizationId,
      orphans,
    ]);
    await client.query('delete from rotation_patterns where organization_id = $1 and id = any($2::uuid[])', [
      seeded.organizationId,
      orphans,
    ]);
    await client.query('commit');
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    await client.end();
  }
}

/**
 * Deletes everything {@link seedTeamRotation} wrote — the version, the steps,
 * the pattern, the times and the three types — every override naming one of
 * those types ({@link seedShiftTypeOverride}), and every roster override of
 * the run organization ({@link seedRosterOverride}, written only under the
 * same hold) with every resolution linked to one (story 5.4c's replacements,
 * whose key does not cascade), in one transaction, so the run organization is
 * as it was. Safe to call twice.
 */
export async function removeSeededRotation(seeded: SeededRotation): Promise<void> {
  const client = await connect();
  try {
    await client.query('begin');
    const scope = [seeded.organizationId, seeded.patternId];
    // Before the overrides: a replacement's resolution keys to its override (0032).
    await client.query('delete from conflict_resolutions where organization_id = $1 and roster_override_id is not null', [
      seeded.organizationId,
    ]);
    await client.query('delete from roster_overrides where organization_id = $1', [seeded.organizationId]);
    await client.query('delete from rotation_assignments where organization_id = $1 and pattern_id = $2', scope);
    await client.query('delete from rotation_steps where organization_id = $1 and pattern_id = $2', scope);
    await client.query('delete from rotation_patterns where organization_id = $1 and id = $2', scope);
    const types = [seeded.organizationId, seeded.shiftTypeIds];
    // Before the types: an override keys to its type (0019).
    await client.query(
      'delete from shift_type_overrides where organization_id = $1 and shift_type_id = any($2::uuid[])',
      types,
    );
    await client.query(
      'delete from shift_type_versions where organization_id = $1 and shift_type_id = any($2::uuid[])',
      types,
    );
    await client.query('delete from shift_types where organization_id = $1 and id = any($2::uuid[])', types);
    await client.query('commit');
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    throw cause;
  } finally {
    await client.end();
  }
}

/**
 * Fails fast, naming `supabase start`, when the database or GoTrue is not
 * reachable. GoTrue too, because every spec signs in through it and a stack
 * that is half up fails every test for a reason none of them names.
 */
export async function requireStack(
  databaseUrl: string = DATABASE_URL,
  apiUrl: string = API_URL,
): Promise<void> {
  let client: pg.Client;
  try {
    client = await connect(databaseUrl);
  } catch (cause) {
    throw new Error(stackDownMessage(`the local Supabase database at ${databaseUrl}`), { cause });
  }
  await client.end();

  const health = `${apiUrl}/auth/v1/health`;
  let status: number;
  try {
    status = (await fetch(health, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })).status;
  } catch (cause) {
    throw new Error(stackDownMessage(`GoTrue at ${health}`), { cause });
  }
  if (status !== 200) throw new Error(stackDownMessage(`GoTrue at ${health} (HTTP ${status})`));
}

/**
 * Fails, naming `supabase functions serve`, unless admin-auth itself answers a
 * CORS request from the app's origin.
 *
 * NOT A PREFLIGHT, and not the allow-origin header alone: Kong answers a request
 * carrying `Access-Control-Request-Method` itself, and it rewrites
 * `Access-Control-Allow-Origin` to `*` on everything it forwards. What only the
 * function sends is its own `Access-Control-Allow-Methods: POST, OPTIONS`, and it
 * sends it only for an origin its environment admits (`handler.ts`
 * `corsHeaders`), so this proves the function is served AND configured for this
 * origin.
 */
export async function requireAdminAuth(apiUrl: string = API_URL): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/functions/v1/admin-auth`, {
      method: 'OPTIONS',
      headers: { Origin: APP_ORIGIN },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error(functionDownMessage(`no answer from ${apiUrl}`), { cause });
  }

  const allowOrigin = response.headers.get('access-control-allow-origin');
  const allowMethods = response.headers.get('access-control-allow-methods');

  if (
    response.status !== 204 ||
    allowOrigin === null ||
    allowMethods?.replace(/\s/g, '') !== 'POST,OPTIONS'
  ) {
    throw new Error(
      functionDownMessage(
        `OPTIONS answered HTTP ${response.status}, allow-origin ${allowOrigin ?? 'absent'}, ` +
          `allow-methods ${allowMethods ?? 'absent'}`,
      ),
    );
  }
}
