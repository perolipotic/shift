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
