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
 * structural interfaces — the shape `members/list.ts`'s `MembersTable`
 * established, and the reason a `.ts` extension appears on the three imports
 * below: Deno requires it, Vitest resolves it, and an extensionless import
 * works in exactly one of the two runtimes.
 */

import {
  OPERATION_FAILED,
  createUser,
  updateUserById,
  type CallerClient,
  type OperationReply,
  type PrivilegedAccounts,
} from './operations.ts';

/** The complete set of operations this boundary will ever expose (AD-16). */
export const OPERATIONS = ['createUser', 'updateUserById', 'ban', 'unban'] as const;

export type Operation = (typeof OPERATIONS)[number];

/**
 * The operations that still refuse to act, and why they are named here rather
 * than inferred from the dispatch below.
 *
 * `ban` and `unban` version an account's ACTIVE STATE, which AD-2 says lives in
 * `auth.users` and story 1.6 owns together with the versioned shape that records
 * it. Shipping them here would mean guessing that shape a story early, so they
 * keep answering 501 — and `test/admin-auth-boundary.test.ts` drives this list
 * rather than `OPERATIONS`, so an operation that quietly stopped being
 * implemented reads as a failing test rather than as a shorter `it.each`.
 */
export const UNIMPLEMENTED_OPERATIONS = ['ban', 'unban'] as const;

/** The operations this story implements. The two lists partition
 *  {@link OPERATIONS}, which the boundary suite asserts rather than assumes. */
export const IMPLEMENTED_OPERATIONS = ['createUser', 'updateUserById'] as const;

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
export const OPERATION_UNKNOWN = 'OPERATION_UNKNOWN';
export const NOT_IMPLEMENTED = 'NOT_IMPLEMENTED';
export const CLIENT_CONSTRUCTION_FAILED = 'CLIENT_CONSTRUCTION_FAILED';

/** Every code the transport can put on the wire. Bound to the SPA's own copy
 *  alongside `OPERATION_CODES` by the contract case. */
export const TRANSPORT_CODES = [
  AUTHORIZATION_MISSING,
  METHOD_NOT_ALLOWED,
  BODY_NOT_JSON,
  OPERATION_UNKNOWN,
  NOT_IMPLEMENTED,
  CLIENT_CONSTRUCTION_FAILED,
] as const;

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

    let payload: unknown;
    try {
      payload = await request.json();
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
    } catch (cause) {
      console.error('admin-auth could not construct its clients', cause);
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

      if (answered !== null) return reply(answered.status, answered.body);
    } catch (cause) {
      console.error(OPERATION_FAILED, operation, cause);

      return reply(500, { code: OPERATION_FAILED, operation });
    }

    // `ban` and `unban` only. Active state lives in `auth.users` (AD-2) and the
    // versioned shape that records it is story 1.6's, so shipping either here
    // would mean guessing that shape a story early. See
    // {@link UNIMPLEMENTED_OPERATIONS}.
    return reply(501, { code: NOT_IMPLEMENTED, operation });
  };
}
