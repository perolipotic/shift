/**
 * admin-auth transport, separated from the Deno runtime so AD-15 can reach it.
 *
 * `index.ts` owns everything runtime-specific — `Deno.env`, the `npm:` import
 * of the Supabase client, `Deno.serve`. This module owns the decisions, takes
 * its environment and its client factories as arguments, and imports nothing.
 * That is what lets Vitest assert the boundary's behaviour in the node
 * environment, with no browser and no deployed function.
 *
 * The client factories are typed as returning `unknown` on purpose: this
 * module still never touches a client itself. What it does now is hand both
 * values to the operation modules, which cast them to their own narrow
 * structural interfaces — the shape `features/members/services/list.ts`'s `MembersTable`
 * established, and the reason a `.ts` extension appears on the three imports
 * below: Deno requires it, Vitest resolves it, and an extensionless import
 * works in exactly one of the two runtimes.
 */

import {
  OPERATION_FAILED,
  createUser,
  resetPassword,
  updateUserById,
  type CallerClient,
  type OperationReply,
  type PrivilegedAccounts,
} from './operations.ts';

/**
 * The complete set of operations this boundary will ever expose (AD-16).
 *
 * THREE, and `ban`/`unban` LEFT in story 1.6 rather than being implemented.
 * Active state is a versioned domain table (`0008_member_status.sql`) written
 * through PostgREST under row level security; sign-in is ended by the access
 * token hook and data access by the helper every policy re-reads. The only
 * thing the secret key could have added is a session revocation, and GoTrue
 * offers none without changing the password — so a pass-through operation here
 * would have been ceremony on the one component AD-16 keeps small. Human
 * decision 2026-09-23.
 */
export const OPERATIONS = ['createUser', 'updateUserById', 'resetPassword'] as const;

export type Operation = (typeof OPERATIONS)[number];

/**
 * The codes the TRANSPORT answers with, before any operation runs.
 *
 * NAMED AND EXPORTED, which they were not: they lived as bare literals in the
 * replies below and so escaped the contract case in
 * `test/admin-auth-boundary.test.ts` entirely — the SPA had a mapping for every
 * code an OPERATION emits and none for any of these, so all seven fell through
 * to "the service is unavailable, try again". The one that matters is
 * `AUTHORIZATION_MISSING`: a session that expired while a form was open is
 * fixed by signing in again and by nothing else, and "try again" repeats the
 * request that carries no credential.
 */
export const AUTHORIZATION_MISSING = 'AUTHORIZATION_MISSING';
export const METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED';
export const BODY_NOT_JSON = 'BODY_NOT_JSON';
/** The request did not declare `application/json`. Refused before the body is read. */
export const CONTENT_TYPE_UNSUPPORTED = 'CONTENT_TYPE_UNSUPPORTED';
/** The body is larger than {@link BODY_LIMIT_BYTES}. Refused before it is parsed. */
export const BODY_TOO_LARGE = 'BODY_TOO_LARGE';
export const OPERATION_UNKNOWN = 'OPERATION_UNKNOWN';
export const CLIENT_CONSTRUCTION_FAILED = 'CLIENT_CONSTRUCTION_FAILED';

/** Every code the transport can put on the wire. Bound to the SPA's own copy
 *  alongside `OPERATION_CODES` by the contract case. */
export const TRANSPORT_CODES = [
  AUTHORIZATION_MISSING,
  METHOD_NOT_ALLOWED,
  BODY_NOT_JSON,
  CONTENT_TYPE_UNSUPPORTED,
  BODY_TOO_LARGE,
  OPERATION_UNKNOWN,
  CLIENT_CONSTRUCTION_FAILED,
] as const;

/**
 * The largest body this boundary will read, in bytes.
 *
 * 16 KiB. The largest legitimate request is a `createUser` payload — a name, a
 * username, an email and four small fields — which is well under 1 KiB. The
 * bound is what stops a caller making the function buffer an arbitrary body
 * before anything has refused it.
 */
export const BODY_LIMIT_BYTES = 16 * 1024;

/** Whether the request declares a JSON body. Parameters such as `charset` are allowed. */
function declaresJson(contentType: string | null): boolean {
  if (contentType === null) return false;
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  return mediaType === 'application/json';
}

type BodyOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: typeof BODY_TOO_LARGE | typeof BODY_NOT_JSON };

/**
 * The body as text, read no further than `limit` bytes.
 *
 * READ AS A STREAM, never with `request.text()`: a declared `content-length`
 * can be absent or wrong, and `text()` buffers the whole body before anything
 * can look at its size. The declared length is still checked first, so an
 * honest oversized request is refused without reading a byte of it.
 */
async function boundedBodyOf(request: Request, limit: number): Promise<BodyOutcome> {
  // STRICTLY DIGITS, or ignored. `Number` reads `1e9`, `0x10` and `' 7 '` as
  // lengths; a header this function did not write is a hint, and the stream
  // bound below is what actually holds.
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    return { ok: false, code: BODY_TOO_LARGE };
  }

  if (request.body === null) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        // BEST EFFORT, and outside the decision: the bound is already passed,
        // so a cancel that rejects must not turn a 413 into a 400.
        reader.cancel().catch(() => undefined);
        return { ok: false, code: BODY_TOO_LARGE };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, code: BODY_NOT_JSON };
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: new TextDecoder().decode(bytes) };
}

export interface Configuration {
  readonly projectUrl: string;
  readonly secretKey: string;
  readonly publishableKey: string;
  readonly allowedOrigins: readonly string[];
}

export type ConfigurationResult =
  | { readonly ok: true; readonly configuration: Configuration }
  | { readonly ok: false; readonly code: ConfigurationErrorCode };

export type ConfigurationErrorCode =
  | 'PROJECT_URL_MISSING'
  | 'PROJECT_URL_INVALID'
  | 'SECRET_KEY_MISSING'
  | 'SECRET_KEY_INVALID'
  | 'PUBLISHABLE_KEY_MISSING'
  | 'PUBLISHABLE_KEY_INVALID';

export interface HandlerDependencies {
  /** Constructs the secret-key client. Its only permitted use is `auth.admin.*`. */
  readonly makePrivilegedClient: () => unknown;
  /** Constructs the caller's client: publishable key plus the caller's JWT. */
  readonly makeCallerClient: (authorization: string) => unknown;
}

type EnvironmentSource = (name: string) => string | undefined;

/**
 * A malformed project URL must surface as a configuration code, not as a
 * `CLIENT_CONSTRUCTION_FAILED` from deep inside the Supabase client — the two
 * point an operator at completely different things.
 */
function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * Read and validate the environment, once, at module load.
 *
 * There is deliberately no fallback. A missing or wrong-shaped secret key makes
 * this function refuse every request rather than quietly downgrade to the
 * publishable key, which would turn a privileged operation into a silent no-op.
 * The shape check is what catches the likeliest misconfiguration of all:
 * pasting the publishable key into the secret slot.
 */
export function readConfiguration(getEnv: EnvironmentSource): ConfigurationResult {
  // Trim first. A dashboard paste or a heredoc leaves a trailing newline, which
  // survives `startsWith` and then fails opaquely at the real auth call — the
  // shape check is only worth having if it sees the value the client will use.
  const projectUrl = (getEnv('SUPABASE_URL') ?? '').trim();
  const secretKey = (getEnv('SHIFT_SECRET_KEY') ?? '').trim();
  const publishableKey = (getEnv('SHIFT_PUBLISHABLE_KEY') ?? '').trim();

  if (projectUrl === '') return { ok: false, code: 'PROJECT_URL_MISSING' };
  if (!isHttpUrl(projectUrl)) return { ok: false, code: 'PROJECT_URL_INVALID' };
  if (secretKey === '') return { ok: false, code: 'SECRET_KEY_MISSING' };
  if (!secretKey.startsWith('sb_secret_')) return { ok: false, code: 'SECRET_KEY_INVALID' };
  if (publishableKey === '') return { ok: false, code: 'PUBLISHABLE_KEY_MISSING' };
  if (!publishableKey.startsWith('sb_publishable_')) {
    return { ok: false, code: 'PUBLISHABLE_KEY_INVALID' };
  }

  const allowedOrigins = (getEnv('SHIFT_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return { ok: true, configuration: { projectUrl, secretKey, publishableKey, allowedOrigins } };
}

export function isOperation(value: unknown): value is Operation {
  return typeof value === 'string' && (OPERATIONS as readonly string[]).includes(value);
}

/**
 * `Vary: Origin` is emitted on every reply, including the ones that carry no
 * `Access-Control-Allow-*` header at all. Without it a shared cache may store
 * the header-less response produced for an unlisted origin and replay it to an
 * allowed one, which breaks CORS in a way no single-request test can see.
 */
function corsHeaders(origin: string | null, allowedOrigins: readonly string[]): Record<string, string> {
  if (origin === null || !allowedOrigins.includes(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

/** Errors are `{ code, ...operands }` with stable SCREAMING_SNAKE codes, translated only at the edge. */
function respond(
  status: number,
  body: { code: string; [operand: string]: unknown },
  origin: string | null,
  allowedOrigins: readonly string[],
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin, allowedOrigins) },
  });
}

/**
 * Build the request handler.
 *
 * When `configuration` failed to read, every request except a CORS preflight
 * answers 500 with that stable code — the fail-fast AD-17 requires.
 */
export function createHandler(
  configuration: ConfigurationResult,
  dependencies: HandlerDependencies,
): (request: Request) => Promise<Response> {
  const allowedOrigins = configuration.ok ? configuration.configuration.allowedOrigins : [];

  return async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    const reply = (status: number, body: { code: string; [operand: string]: unknown }): Response =>
      respond(status, body, origin, allowedOrigins);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigins) });
    }

    if (!configuration.ok) {
      return reply(500, { code: configuration.code });
    }

    if (request.method !== 'POST') {
      return reply(405, { code: METHOD_NOT_ALLOWED, method: request.method });
    }

    const authorization = request.headers.get('Authorization');
    if (authorization === null || authorization === '') {
      return reply(401, { code: AUTHORIZATION_MISSING });
    }

    // THE MEDIA TYPE AND THE SIZE, BEFORE THE PARSE. Neither needs a client or
    // a query, so a malformed request costs the function a header read and at
    // most `BODY_LIMIT_BYTES` of buffering.
    if (!declaresJson(request.headers.get('content-type'))) {
      return reply(415, { code: CONTENT_TYPE_UNSUPPORTED });
    }

    const body = await boundedBodyOf(request, BODY_LIMIT_BYTES);
    if (!body.ok) {
      return reply(body.code === BODY_TOO_LARGE ? 413 : 400, { code: body.code });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body.text);
    } catch {
      return reply(400, { code: BODY_NOT_JSON });
    }

    const operation = (payload as { operation?: unknown } | null)?.operation;
    if (!isOperation(operation)) {
      return reply(400, { code: OPERATION_UNKNOWN, operations: OPERATIONS });
    }

    // Both clients are constructed here, on the real request, so the wiring is
    // exercised rather than merely written down: the privileged client for the
    // auth admin call, the caller-scoped client for every domain-table write.
    let privileged: unknown;
    let caller: unknown;

    try {
      privileged = dependencies.makePrivilegedClient();
      caller = dependencies.makeCallerClient(authorization);
    } catch {
      // THE CODE AND NOTHING ELSE. A construction error can carry the key it
      // was handed; the log policy is codes, never operands or key material.
      console.error(CLIENT_CONSTRUCTION_FAILED);
      return reply(500, { code: CLIENT_CONSTRUCTION_FAILED });
    }

    // THE TWO VALUES ALREADY IN HAND, never a second call to the factories. A
    // third construction would be a third client on a request that has proved
    // two, and on the privileged side it would be a second secret-key client
    // built outside the try/catch that reports `CLIENT_CONSTRUCTION_FAILED`.
    //
    // CAST HERE, at the one place that has both an `unknown` and an operation
    // to hand it to. `handler.ts` still touches neither client: the casts are
    // to the operations' own narrow structural interfaces, which name
    // `auth.admin` on one and `rpc`/`from` on the other and nothing else — so
    // a domain-table write with the secret key stays unrepresentable.
    const accounts = privileged as PrivilegedAccounts;
    const client = caller as CallerClient;

    // THE DISPATCH IS WRAPPED, and that is a transport decision rather than a
    // defensive habit. An operation that throws — a client method that is not
    // the shape it was cast to, a rejected fetch inside postgrest-js — would
    // otherwise escape `Deno.serve`, which answers 500 with a body the SPA
    // cannot map to any message AND WITHOUT THE CORS HEADERS every other reply
    // carries. In a browser that is not a 500 at all: it is an opaque network
    // failure with nothing on screen to explain it.
    try {
      let answered: OperationReply | null = null;

      if (operation === 'createUser') {
        answered = await createUser({ privileged: accounts, caller: client }, payload);
      }
      if (operation === 'updateUserById') {
        answered = await updateUserById({ privileged: accounts, caller: client }, payload);
      }
      // THE SAME TWO VALUES, never a third construction. The reset holds the
      // secret key for exactly one call — `auth.admin.updateUserById` — and
      // reads the member it is about through the CALLER's client, so row level
      // security decides which rows exist before the authorization decides
      // anything at all.
      if (operation === 'resetPassword') {
        answered = await resetPassword({ privileged: accounts, caller: client }, payload);
      }

      if (answered !== null) return reply(answered.status, answered.body);
    } catch {
      // The operation NAME, never the thrown value: a rejected fetch or a
      // PostgREST error can carry a request body, a row or a key.
      console.error(OPERATION_FAILED, operation);

      return reply(500, { code: OPERATION_FAILED, operation });
    }

    // UNREACHABLE: `isOperation` admitted only a member of `OPERATIONS`, and
    // every member is dispatched above. Answered as the operation failing
    // rather than falling off the end, so a fourth name added to the list
    // without a branch is a logged 500 and never a reply with no body.
    console.error(OPERATION_FAILED, operation);

    return reply(500, { code: OPERATION_FAILED, operation });
  };
}
