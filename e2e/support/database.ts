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
  const key = `e2e-rotation:${slug}`;
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

      await client.query(
        `delete from rotation_assignments a
          using organizations o
          where a.organization_id = o.id and o.slug = $1
            and a.effective_from >= public.organization_today(o.id)`,
        [slug],
      );
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
