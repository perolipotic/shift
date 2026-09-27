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
 * Sets the run organization's `uses_fire_ranks` and answers what it was, so
 * the caller can restore it. Call it under {@link holdFireRanks}.
 */
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
  /** The organization's today, `YYYY-MM-DD`: the version's effective date and anchor. */
  readonly today: string;
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
 *
 * CALL IT UNDER {@link holdRotation}, and undo it with
 * {@link removeSeededRotation} before releasing the hold, so no other spec
 * ever lists, counts or ramps these types.
 */
export async function seedTeamRotation(slug: string, teamId: string, suffix: string): Promise<SeededRotation> {
  const client = await connect();
  try {
    await client.query('begin');
    const found = await client.query<{ organization_id: string; admin_user: string; today: string }>(
      `select o.id as organization_id, m.auth_user_id as admin_user,
              to_char(public.organization_today(o.id), 'YYYY-MM-DD') as today
         from organizations o
         join members m on m.organization_id = o.id and m.role = 'admin'
        where o.slug = $1
        order by m.created_at, m.id
        limit 1`,
      [slug],
    );
    const organization = found.rows[0];
    if (organization === undefined) throw new Error(`E2E: no organization ${slug} to seed a rotation in`);
    const { organization_id: organizationId, admin_user: admin, today } = organization;

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
      [organizationId, teamId, patternId, firstStep, today, admin],
    );
    await client.query('commit');

    return {
      today,
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
 * Deletes everything {@link seedTeamRotation} wrote — the version, the steps,
 * the pattern, the times and the three types — and every override naming one
 * of those types ({@link seedShiftTypeOverride}), in one transaction, so the
 * run organization is as it was. Safe to call twice.
 */
export async function removeSeededRotation(seeded: SeededRotation): Promise<void> {
  const client = await connect();
  try {
    await client.query('begin');
    const scope = [seeded.organizationId, seeded.patternId];
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
