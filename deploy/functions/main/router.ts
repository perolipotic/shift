/**
 * The functions router (story 20.2; AD-14 as amended): the `edge-runtime`
 * main service of the self-hosted stack. PLATFORM PLUMBING, NOT AN EDGE
 * FUNCTION, and it may not think.
 *
 * It does three things and nothing else:
 *
 *   1. It serves only the functions in `FUNCTIONS`, which are exactly the
 *      `[functions.*]` tables of `supabase/config.toml` (pinned by
 *      `test/functions-router.test.ts`). Any other first path segment is 404.
 *   2. For a function with `verify_jwt = true`, it forwards the request only
 *      after GoTrue's `GET /user` has accepted the caller's bearer token
 *      (a 200 carrying a user). It
 *      verifies nothing itself: it holds no key and no JWT signing secret.
 *   3. It hands the request, untouched, to that function's worker.
 *
 * It reads no table, builds no client, holds no key, and contains no rule
 * (AD-16): adding one is a defect, not a refactor. It logs fixed codes only,
 * never a URL, a header or a token: a path may carry a bearer secret (v2's
 * `calendar-feed`, NFR-27).
 *
 * This file imports nothing, so Vitest asserts it without a runtime (AD-15).
 * `index.ts` is the Deno wiring.
 */

/** One routable function: whether it needs a session, and what its worker may read. */
export interface FunctionEntry {
  /** `config.toml`'s `verify_jwt` for this function. */
  readonly verifyJwt: boolean;
  /**
   * The ONLY variables its worker is given: exactly the names its own
   * handler's `readConfiguration` reads (pinned by the router test), so
   * `admin-auth` never sees the Resend key, the invoke secret or the VAPID
   * private key, and `notify` never sees the publishable key.
   */
  readonly environment: readonly string[];
}

/**
 * The route table. A `Map`, so `__proto__`, `constructor` and friends are not
 * names; a function is added here, in `config.toml`, and in the Dockerfile,
 * together, or the router test fails.
 */
export const FUNCTIONS: ReadonlyMap<string, FunctionEntry> = new Map([
  [
    'admin-auth',
    {
      verifyJwt: true,
      environment: ['SUPABASE_URL', 'SHIFT_SECRET_KEY', 'SHIFT_PUBLISHABLE_KEY', 'SHIFT_ALLOWED_ORIGINS'],
    },
  ],
  [
    'notify',
    {
      verifyJwt: false,
      environment: [
        'SUPABASE_URL',
        'SHIFT_SECRET_KEY',
        'NOTIFY_INVOKE_SECRET',
        'RESEND_API_KEY',
        'NOTIFY_EMAIL_FROM',
        'SHIFT_APP_URL',
        'VAPID_PUBLIC_KEY',
        'VAPID_PRIVATE_KEY',
        'VAPID_SUBJECT',
      ],
    },
  ],
]);

/** No such function: any name not in `FUNCTIONS`. */
export const FUNCTION_NOT_FOUND = 'FUNCTION_NOT_FOUND';
/**
 * No session GoTrue accepts. The same code `admin-auth` answers for a missing
 * header, which the SPA already maps to "sign in again" (`WIRE_CODES`).
 */
export const AUTHORIZATION_MISSING = 'AUTHORIZATION_MISSING';
/**
 * GoTrue could not be asked (down, slow, rate-limited, answering a 3xx or a
 * 200 that is not a user, or `SHIFT_AUTH_URL` unset). Fail closed, and never
 * with the sign-out code: an outage is not a lost session. (A 4xx is GoTrue
 * refusing the session, 404 for a deleted user included, so a host
 * misaddressed to answer 404 would read as a refusal: the compose pins
 * `SHIFT_AUTH_URL`, and `test/self-hosted-stack.test.ts` holds it.)
 */
export const AUTHORIZATION_UNVERIFIED = 'AUTHORIZATION_UNVERIFIED';
/** The function's worker could not be started (its bundle is missing, or the runtime refused). */
export const FUNCTION_UNAVAILABLE = 'FUNCTION_UNAVAILABLE';

/** How long GoTrue may take to answer before the request is refused 503. */
export const VERIFY_TIMEOUT_MS = 5_000;
/** GoTrue's user is a few kB; a larger 200 is not GoTrue's answer. */
const MAX_USER_BYTES = 65_536;

export interface RouterDependencies {
  /** GoTrue's internal base URL (`SHIFT_AUTH_URL`), or null when unset. */
  readonly authUrl: string | null;
  /** The runtime's `fetch`, used for the one GoTrue call and nothing else. */
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** Hands the ORIGINAL request to the named function's worker. Throws if no worker can be started. */
  readonly forward: (name: string, entry: FunctionEntry, request: Request) => Promise<Response>;
  /** Where the fixed codes go. */
  readonly log: (code: string) => void;
}

function refuse(status: number, code: string): Response {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A spelling of the path that a URL parser would rewrite before the name is
 * read: a `.` or `..` segment, any `%2e` (WHATWG reads `%2e%2e` as `..`), or
 * a backslash (read as `/` for http). Kong 2.8 forwards these unnormalised
 * and logs the raw path, so `/notify/%2e%2e/admin-auth` would run `admin-auth`
 * under a Kong log line naming `notify`. The router refuses them all.
 */
const REWRITTEN_PATH = /\\|%2e|(?:^|\/)\.{1,2}(?:\/|$)/i;

/**
 * The first path segment, as sent. Never percent-decoded: `admin%2Dauth` is
 * not `admin-auth`. The name must also be the first segment of the RAW path
 * (no dot segment, no `%2e`, no backslash): otherwise it is `''`, which no
 * function is, so a function is only ever reached under the spelling Kong's
 * access log records.
 */
export function functionNameOf(url: string): string {
  const { pathname } = new URL(url);
  const name = pathname.split('/')[1] ?? '';

  const authority = url.indexOf('://');
  const pathStart = authority === -1 ? -1 : url.indexOf('/', authority + 3);
  const raw = pathStart === -1 ? '' : (url.slice(pathStart).split(/[?#]/)[0] ?? '');
  if (REWRITTEN_PATH.test(raw)) return '';
  if ((raw.split('/')[1] ?? '') !== name) return '';
  return name;
}

/** `Bearer <token>`, case-insensitive scheme, one token, nothing else. */
function bearerOf(authorization: string | null): string | null {
  if (authorization === null) return null;
  const match = /^Bearer +([^\s]+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

type Verdict = 'accepted' | 'refused' | 'unverified';

async function askGoTrue(dependencies: RouterDependencies, token: string): Promise<Verdict> {
  const base = dependencies.authUrl?.trim() ?? '';
  if (base === '') return 'unverified';

  let answer: Response;
  try {
    answer = await dependencies.fetch(`${base.replace(/\/+$/, '')}/user`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch {
    return 'unverified';
  }

  if (answer.status !== 200) {
    await answer.body?.cancel().catch(() => undefined);
    if (answer.status >= 400 && answer.status < 500 && answer.status !== 429) return 'refused';
    return 'unverified';
  }

  // A 200 counts only when it is GoTrue's user: a JSON object with a string
  // `id` and `aud`. Anything else answering 200 at that address (a
  // misaddressed or impostor host) has not accepted a session: 503, not a pass.
  try {
    const text = await answer.text();
    if (text.length > MAX_USER_BYTES) return 'unverified';
    const user = JSON.parse(text) as { id?: unknown; aud?: unknown } | null;
    if (typeof user?.id === 'string' && user.id !== '' && typeof user.aud === 'string') return 'accepted';
  } catch {
    // Not JSON, or the body did not arrive in time.
  }
  return 'unverified';
}

/** Build the main service's request handler. */
export function createRouter(dependencies: RouterDependencies): (request: Request) => Promise<Response> {
  return async function route(request: Request): Promise<Response> {
    const name = functionNameOf(request.url);
    const entry = FUNCTIONS.get(name);
    if (entry === undefined) return refuse(404, FUNCTION_NOT_FOUND);

    if (entry.verifyJwt) {
      const token = bearerOf(request.headers.get('authorization'));
      if (token === null) return refuse(401, AUTHORIZATION_MISSING);

      const verdict = await askGoTrue(dependencies, token);
      if (verdict === 'refused') return refuse(401, AUTHORIZATION_MISSING);
      if (verdict === 'unverified') {
        dependencies.log(AUTHORIZATION_UNVERIFIED);
        return refuse(503, AUTHORIZATION_UNVERIFIED);
      }
    }

    try {
      return await dependencies.forward(name, entry, request);
    } catch {
      dependencies.log(FUNCTION_UNAVAILABLE);
      return refuse(500, FUNCTION_UNAVAILABLE);
    }
  };
}
