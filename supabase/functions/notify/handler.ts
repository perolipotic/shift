/**
 * notify — sends what `notification_outbox` holds, and it may not think.
 *
 * The second of exactly two Edge Functions (AD-14, amended by story 10.1). The
 * `notify` cron job (0042) calls it every minute with the invoke secret from
 * Vault as its bearer token. Each run:
 *
 *   1. refuses any caller without the invoke secret (401, compared in
 *      constant time), before anything is claimed;
 *   2. claims a batch through `claim_notifications` — the row, the
 *      recipient's email, the organization's locale, timezone and slug;
 *   3. renders each row by its code from the pinned locale messages
 *      (`messages.ts`), never from prose in the row;
 *   4. sends it through Resend with `Idempotency-Key` = the row id, so a
 *      re-claim after a crash cannot send a second email;
 *   5. settles it through `settle_notification` with the lease token the
 *      claim returned: sent; transient (the claim released, the next attempt
 *      backed off by attempts x 10 minutes, failed on the fifth); released
 *      (given back without spending the attempt, when the run stops before
 *      trying: the provider refused the key, or the time budget ran out); or
 *      permanent (failed).
 *
 * THE TIME BUDGET. pg_net waits 55 s for an answer. One run claims at most
 * {@link BATCH_SIZE} rows, spaces sends {@link PACE_MS} apart (Resend's
 * default limit is about two requests a second), gives each send
 * {@link SEND_TIMEOUT_MS}, and stops sending past {@link RUN_DEADLINE_MS},
 * releasing what it did not try.
 *
 * It writes nothing but those two RPCs, reads no table directly, and computes
 * no domain answer (AD-18): every fact arrives decided, in the row. Adding a
 * rule here is a defect, not a refactor (AD-16's spirit).
 *
 * This module imports only `messages.ts`, takes its environment, its client
 * factory and its `fetch` as arguments, and so is asserted from Vitest's node
 * environment (AD-15) with no deployment. `index.ts` holds the Deno wiring.
 */

import { render } from './messages.ts';

// ------------------------------------------------------------------ the codes

export const METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED';
/** The bearer token is missing or is not the invoke secret. Nothing was claimed. */
export const INVOKE_SECRET_REFUSED = 'INVOKE_SECRET_REFUSED';
export const CLIENT_CONSTRUCTION_FAILED = 'CLIENT_CONSTRUCTION_FAILED';
/** `claim_notifications` answered an error, threw, or answered no list. Nothing was sent. */
export const CLAIM_FAILED = 'CLAIM_FAILED';
/** The run finished. Its counts say what happened to the batch. */
export const NOTIFY_RAN = 'NOTIFY_RAN';

/** The failure codes a row is settled with. */
export const RECIPIENT_NO_EMAIL = 'RECIPIENT_NO_EMAIL';
export const PROVIDER_REFUSED = 'PROVIDER_REFUSED';
export const PROVIDER_RATE_LIMITED = 'PROVIDER_RATE_LIMITED';
export const PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE';
/** 408: the provider timed out reading the request. Retried. */
export const PROVIDER_TIMEOUT = 'PROVIDER_TIMEOUT';
/** 409: an idempotent request with this key is still in flight, or was sent. Retried, and the key keeps it to one email. */
export const PROVIDER_CONFLICT = 'PROVIDER_CONFLICT';
/** 401 or 403: the key or the domain is wrong. The run stops and gives every row back. */
export const PROVIDER_UNAUTHORIZED = 'PROVIDER_UNAUTHORIZED';
export const NETWORK_ERROR = 'NETWORK_ERROR';
/** The run's time budget ran out before this row was tried. */
export const RUN_DEADLINE = 'RUN_DEADLINE';
/** A claimed row that is not the shape the claim returns. */
export const ROW_INVALID = 'ROW_INVALID';
/** Set by the database, never by this function, on the fifth failed attempt. */
export const ATTEMPTS_EXHAUSTED = 'ATTEMPTS_EXHAUSTED';
/** Logged when a settle itself fails; the row's lease then expires and it is re-claimed. */
export const SETTLE_FAILED = 'SETTLE_FAILED';
/** Logged with the row id and the HTTP status, never the body, on a non-2xx answer. */
export const PROVIDER_STATUS = 'PROVIDER_STATUS';

export const CLAIM_RPC = 'claim_notifications';
export const SETTLE_RPC = 'settle_notification';

/** How many rows one run claims. With the pace and the timeout below, the worst case stays inside pg_net's 55 s. */
export const BATCH_SIZE = 8;

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** How long one send may take before it counts as a network failure. */
export const SEND_TIMEOUT_MS = 5_000;

/** The least time between two sends' starts: Resend's default limit is about 2 a second. */
export const PACE_MS = 550;

/** No send starts this long after the run began; the rest are released untried. */
export const RUN_DEADLINE_MS = 45_000;

/** The shortest invoke secret accepted: a guessable one is no secret. */
export const INVOKE_SECRET_MIN_LENGTH = 32;

/** The invoke secret's shape, the same rule the deploy check applies (`scripts/ci/require-config.mjs`). */
export const INVOKE_SECRET_SHAPE = /^[A-Za-z0-9_-]{32,}$/;

/** `addr@domain` or `Name <addr@domain>`. */
const EMAIL_FROM_SHAPE = /^(?:[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+|[^<>]+ <[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>)$/;

// ----------------------------------------------------------- the configuration

export interface Configuration {
  readonly projectUrl: string;
  readonly secretKey: string;
  readonly invokeSecret: string;
  readonly resendApiKey: string;
  readonly emailFrom: string;
  readonly appUrl: string;
}

export type ConfigurationErrorCode =
  | 'PROJECT_URL_MISSING'
  | 'PROJECT_URL_INVALID'
  | 'SECRET_KEY_MISSING'
  | 'SECRET_KEY_INVALID'
  | 'INVOKE_SECRET_MISSING'
  | 'INVOKE_SECRET_INVALID'
  | 'RESEND_API_KEY_MISSING'
  | 'RESEND_API_KEY_INVALID'
  | 'EMAIL_FROM_MISSING'
  | 'EMAIL_FROM_INVALID'
  | 'APP_URL_MISSING'
  | 'APP_URL_INVALID';

export type ConfigurationResult =
  | { readonly ok: true; readonly configuration: Configuration }
  | { readonly ok: false; readonly code: ConfigurationErrorCode };

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
 * Read and validate the environment once, at module load: one code per
 * missing or malformed variable, and no fallback (as `admin-auth`'s).
 */
export function readConfiguration(getEnv: (name: string) => string | undefined): ConfigurationResult {
  const read = (name: string): string => (getEnv(name) ?? '').trim();

  const projectUrl = read('SUPABASE_URL');
  const secretKey = read('SHIFT_SECRET_KEY');
  const invokeSecret = read('NOTIFY_INVOKE_SECRET');
  const resendApiKey = read('RESEND_API_KEY');
  const emailFrom = read('NOTIFY_EMAIL_FROM');
  const appUrl = read('SHIFT_APP_URL');

  if (projectUrl === '') return { ok: false, code: 'PROJECT_URL_MISSING' };
  if (!isHttpUrl(projectUrl)) return { ok: false, code: 'PROJECT_URL_INVALID' };
  if (secretKey === '') return { ok: false, code: 'SECRET_KEY_MISSING' };
  if (!secretKey.startsWith('sb_secret_')) return { ok: false, code: 'SECRET_KEY_INVALID' };
  if (invokeSecret === '') return { ok: false, code: 'INVOKE_SECRET_MISSING' };
  if (!INVOKE_SECRET_SHAPE.test(invokeSecret)) return { ok: false, code: 'INVOKE_SECRET_INVALID' };
  if (resendApiKey === '') return { ok: false, code: 'RESEND_API_KEY_MISSING' };
  if (!resendApiKey.startsWith('re_')) return { ok: false, code: 'RESEND_API_KEY_INVALID' };
  if (emailFrom === '') return { ok: false, code: 'EMAIL_FROM_MISSING' };
  if (!EMAIL_FROM_SHAPE.test(emailFrom)) return { ok: false, code: 'EMAIL_FROM_INVALID' };
  if (appUrl === '') return { ok: false, code: 'APP_URL_MISSING' };
  if (!isHttpUrl(appUrl)) return { ok: false, code: 'APP_URL_INVALID' };

  return {
    ok: true,
    configuration: { projectUrl, secretKey, invokeSecret, resendApiKey, emailFrom, appUrl },
  };
}

// ------------------------------------------------------------------ the client

export interface RpcAnswer {
  readonly data: unknown;
  readonly error: { readonly code?: string; readonly message?: string } | null;
}

/**
 * The secret-key client, narrowed to the one method this function may use.
 * No `from(...)`: reading or writing a table directly is unrepresentable.
 */
export interface OutboxClient {
  rpc(fn: typeof CLAIM_RPC | typeof SETTLE_RPC, args: Record<string, unknown>): PromiseLike<RpcAnswer>;
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface HandlerDependencies {
  /** Constructs the secret-key client. Its only permitted use is the two RPCs. */
  readonly makeClient: () => unknown;
  readonly fetch: Fetch;
  /** Milliseconds since the epoch. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Waits `ms`. Defaults to a timer. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** One claimed row, as `claim_notifications` returns it. */
export interface ClaimedNotification {
  readonly id: string;
  readonly code: string;
  readonly channel: string;
  readonly operands: unknown;
  readonly attempts: number;
  /** The lease token, handed back to the settle unchanged. */
  readonly claimed_at: string;
  readonly email: string | null;
  readonly locale: string | null;
  readonly timezone: string | null;
  readonly slug: string | null;
}

export type SettleResult = 'sent' | 'transient' | 'released' | 'permanent';

type Settlement =
  | { readonly result: 'sent' }
  | { readonly result: 'transient' | 'permanent' | 'released'; readonly failureCode: string };

/** A send's outcome: a settlement, or the provider refusing the key, which stops the run. */
type Delivery = Settlement | { readonly result: 'stop'; readonly failureCode: typeof PROVIDER_UNAUTHORIZED };

// --------------------------------------------------------------- the decisions

/**
 * Whether `given` is `expected`, in time that does not depend on where they
 * first differ. The loop runs over the longer of the two, so the only thing
 * the timing can tell a caller is the length of what they sent.
 */
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function bearerOf(authorization: string | null): string | null {
  if (authorization === null) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() ?? null;
}

/**
 * A provider answer, as a delivery. 2xx is sent; 401 and 403 stop the run;
 * 408, 409, 429 and 5xx retry; any other 4xx is final.
 */
export function deliveryOfStatus(status: number): Delivery {
  if (status >= 200 && status < 300) return { result: 'sent' };
  if (status === 401 || status === 403) return { result: 'stop', failureCode: PROVIDER_UNAUTHORIZED };
  if (status === 408) return { result: 'transient', failureCode: PROVIDER_TIMEOUT };
  if (status === 409) return { result: 'transient', failureCode: PROVIDER_CONFLICT };
  if (status === 429) return { result: 'transient', failureCode: PROVIDER_RATE_LIMITED };
  if (status >= 400 && status < 500) return { result: 'permanent', failureCode: PROVIDER_REFUSED };
  return { result: 'transient', failureCode: PROVIDER_UNAVAILABLE };
}

function isClaimedNotification(value: unknown): value is ClaimedNotification {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['id'] === 'string' &&
    typeof row['code'] === 'string' &&
    typeof row['channel'] === 'string' &&
    typeof row['claimed_at'] === 'string'
  );
}

async function deliver(row: ClaimedNotification, configuration: Configuration, fetch: Fetch): Promise<Delivery> {
  const address = (row.email ?? '').trim();
  if (address === '') return { result: 'permanent', failureCode: RECIPIENT_NO_EMAIL };

  // TRANSIENT, not permanent: a code this deployment cannot render yet is
  // most likely one a newer migration writes before the newer function is
  // deployed. The backoff gives the deploy time; five misses fail the row.
  const rendered = render(row.code, row.locale, row.operands, configuration.appUrl);
  if (!rendered.ok) return { result: 'transient', failureCode: rendered.code };

  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${configuration.resendApiKey}`,
        'Content-Type': 'application/json',
        // The row id: Resend answers a repeat within 24 hours with the first
        // send's result and sends nothing. Five attempts, with the leases and
        // the backoff between them, stay well inside that window, which is
        // what makes a re-claim after a crash safe.
        'Idempotency-Key': row.id,
      },
      body: JSON.stringify({
        from: configuration.emailFrom,
        to: [address],
        subject: rendered.subject,
        text: rendered.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return { result: 'transient', failureCode: NETWORK_ERROR };
  }

  // The body is never read: it may echo the address, and the status decides.
  await response.body?.cancel().catch(() => undefined);

  if (response.status < 200 || response.status >= 300) {
    console.error(PROVIDER_STATUS, row.id, response.status);
  }

  return deliveryOfStatus(response.status);
}

function respond(status: number, body: { code: string; [operand: string]: unknown }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build the request handler. When `configuration` failed to read, every
 * request answers 500 with that code (AD-17's fail-fast).
 */
export function createHandler(
  configuration: ConfigurationResult,
  dependencies: HandlerDependencies,
): (request: Request) => Promise<Response> {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? defaultSleep;

  return async function handle(request: Request): Promise<Response> {
    if (!configuration.ok) return respond(500, { code: configuration.code });

    if (request.method !== 'POST') {
      return respond(405, { code: METHOD_NOT_ALLOWED, method: request.method });
    }

    const given = bearerOf(request.headers.get('Authorization'));
    if (given === null || !sameSecret(given, configuration.configuration.invokeSecret)) {
      return respond(401, { code: INVOKE_SECRET_REFUSED });
    }

    const started = now();

    let client: OutboxClient;
    try {
      client = dependencies.makeClient() as OutboxClient;
    } catch {
      // THE CODE AND NOTHING ELSE: a construction error can carry the key.
      console.error(CLIENT_CONSTRUCTION_FAILED);
      return respond(500, { code: CLIENT_CONSTRUCTION_FAILED });
    }

    let claimed: RpcAnswer;
    try {
      claimed = await client.rpc(CLAIM_RPC, { p_limit: BATCH_SIZE });
    } catch {
      console.error(CLAIM_FAILED);
      return respond(500, { code: CLAIM_FAILED });
    }
    if (claimed.error !== null || !Array.isArray(claimed.data)) {
      console.error(CLAIM_FAILED, claimed.error?.code ?? '');
      return respond(500, { code: CLAIM_FAILED });
    }

    const counts = { claimed: 0, sent: 0, failed: 0, retried: 0, released: 0, unsettled: 0 };

    const settle = async (id: string, token: unknown, settlement: Settlement): Promise<boolean> => {
      let settled: RpcAnswer | null;
      try {
        settled = await client.rpc(SETTLE_RPC, {
          p_id: id,
          p_claimed_at: token,
          p_result: settlement.result,
          p_failure_code: settlement.result === 'sent' ? null : settlement.failureCode,
        });
      } catch {
        settled = null;
      }
      if (settled === null || settled.error !== null) {
        // The row id and the code, never the address or the error's text. The
        // lease expires in ten minutes and the row is claimed again; the
        // idempotency key keeps a sent email from going twice.
        console.error(SETTLE_FAILED, id);
        counts.unsettled += 1;
        return false;
      }
      return true;
    };

    // Why the run stopped sending, if it did: every row after it is given
    // back untried, without spending its attempt.
    let stopped: typeof PROVIDER_UNAUTHORIZED | typeof RUN_DEADLINE | null = null;
    let lastSend: number | null = null;

    for (const row of claimed.data as unknown[]) {
      if (!isClaimedNotification(row)) {
        const raw = (row ?? {}) as Record<string, unknown>;
        const id = raw['id'];
        if (typeof id === 'string') {
          if (await settle(id, raw['claimed_at'] ?? null, { result: 'permanent', failureCode: ROW_INVALID })) {
            counts.failed += 1;
          }
        } else {
          counts.unsettled += 1;
        }
        continue;
      }
      counts.claimed += 1;

      if (stopped === null && now() - started >= RUN_DEADLINE_MS) stopped = RUN_DEADLINE;
      if (stopped !== null) {
        if (await settle(row.id, row.claimed_at, { result: 'released', failureCode: stopped })) counts.released += 1;
        continue;
      }

      // The pace: a send starts no sooner than PACE_MS after the last one.
      if (lastSend !== null) {
        const wait = lastSend + PACE_MS - now();
        if (wait > 0) await sleep(wait);
      }
      const usesProvider = (row.email ?? '').trim() !== '';
      if (usesProvider) lastSend = now();

      const delivery = await deliver(row, configuration.configuration, dependencies.fetch);

      if (delivery.result === 'stop') {
        stopped = delivery.failureCode;
        if (await settle(row.id, row.claimed_at, { result: 'released', failureCode: delivery.failureCode })) {
          counts.released += 1;
        }
        continue;
      }

      if (!(await settle(row.id, row.claimed_at, delivery))) continue;

      if (delivery.result === 'sent') counts.sent += 1;
      else if (delivery.result === 'permanent') counts.failed += 1;
      else counts.retried += 1;
    }

    return respond(200, { code: NOTIFY_RAN, ...counts, ...(stopped === null ? {} : { stopped }) });
  };
}
