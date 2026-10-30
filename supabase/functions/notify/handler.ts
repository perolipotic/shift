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
 *      recipient's email, the organization's locale, timezone, slug and name;
 *   3. renders each row by its code from the pinned locale messages
 *      (`messages.ts`), never from prose in the row;
 *   4. sends it through Resend with `Idempotency-Key` = the row id, so a
 *      re-claim after a crash cannot send a second email; or, for a `push`
 *      row (story 10.4), posts the encrypted payload with a VAPID header to
 *      every device the claim returned with it, deleting through
 *      `delete_push_subscription` each device its push service answers 404
 *      or 410 for;
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
 * It writes nothing but those three RPCs, reads no table directly, and computes
 * no domain answer (AD-18): every fact arrives decided, in the row. Adding a
 * rule here is a defect, not a refactor (AD-16's spirit).
 *
 * This module imports only `messages.ts`, takes its environment, its client
 * factory and its `fetch` as arguments, and so is asserted from Vitest's node
 * environment (AD-15) with no deployment. `index.ts` holds the Deno wiring.
 */

import { render, renderPush } from './messages.ts';

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
/** Story 10.4: a device its push service says is gone (404, 410) is deleted, and nothing else. */
export const DELETE_SUBSCRIPTION_RPC = 'delete_push_subscription';

/** A push row whose member has no device left when it is sent. */
export const PUSH_NO_SUBSCRIPTION = 'PUSH_NO_SUBSCRIPTION';
/** Every device of a push row answered 404 or 410: each was deleted, and the row fails. */
export const PUSH_SUBSCRIPTION_GONE = 'PUSH_SUBSCRIPTION_GONE';
/** A device's keys could not encrypt the payload: that device cannot receive. */
export const PUSH_SUBSCRIPTION_INVALID = 'PUSH_SUBSCRIPTION_INVALID';
/** The function was built without a push encryptor: a push row is retried, never sent. */
export const PUSH_ENCRYPTOR_MISSING = 'PUSH_ENCRYPTOR_MISSING';
/**
 * The function has no usable VAPID configuration (a variable missing or
 * malformed): a push row is retried, never sent. Email is unaffected.
 */
export const PUSH_NOT_CONFIGURED = 'PUSH_NOT_CONFIGURED';
/**
 * A push service's answers, kept apart from Resend's so a failure says which
 * channel failed. 401 and 403 are retried per row and never stop the run: a
 * push service refuses a VAPID key per device (human decision, 2026-10-30).
 */
export const PUSH_SERVICE_UNAUTHORIZED = 'PUSH_SERVICE_UNAUTHORIZED';
export const PUSH_SERVICE_TIMEOUT = 'PUSH_SERVICE_TIMEOUT';
export const PUSH_SERVICE_CONFLICT = 'PUSH_SERVICE_CONFLICT';
export const PUSH_SERVICE_RATE_LIMITED = 'PUSH_SERVICE_RATE_LIMITED';
export const PUSH_SERVICE_UNAVAILABLE = 'PUSH_SERVICE_UNAVAILABLE';
export const PUSH_SERVICE_REFUSED = 'PUSH_SERVICE_REFUSED';
export const PUSH_NETWORK_ERROR = 'PUSH_NETWORK_ERROR';
/** Logged when deleting a gone device fails; its next push answers 404 or 410 again. */
export const PUSH_DELETE_FAILED = 'PUSH_DELETE_FAILED';

/** How long a push service keeps a payload for a device that is offline: a day. */
export const PUSH_TTL_SECONDS = 86_400;

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

/** An uncompressed P-256 public key, 65 bytes, as unpadded base64url. */
const VAPID_PUBLIC_KEY_SHAPE = /^[A-Za-z0-9_-]{87}$/;

/** A P-256 private key, 32 bytes, as unpadded base64url. */
const VAPID_PRIVATE_KEY_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** `mailto:addr@domain`, or an `https:` URL: who a push service may contact. */
const VAPID_SUBJECT_SHAPE = /^(?:mailto:[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+|https:\/\/\S+)$/;

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
  /**
   * Story 10.4: the VAPID key pair (base64url, as `web-push` generates it)
   * and its subject, or `null` when any is missing or malformed. Push alone
   * depends on it: without it every push row is retried
   * ({@link PUSH_NOT_CONFIGURED}) and email runs as before.
   */
  readonly vapid: Vapid | null;
  /** Why {@link vapid} is `null`, logged once at start; `null` when it is set. */
  readonly vapidProblem: VapidProblem | null;
}

export interface Vapid {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

export type VapidProblem =
  | 'VAPID_PUBLIC_KEY_MISSING'
  | 'VAPID_PUBLIC_KEY_INVALID'
  | 'VAPID_PRIVATE_KEY_MISSING'
  | 'VAPID_PRIVATE_KEY_INVALID'
  | 'VAPID_SUBJECT_MISSING'
  | 'VAPID_SUBJECT_INVALID';

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
  const vapidPublicKey = read('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = read('VAPID_PRIVATE_KEY');
  const vapidSubject = read('VAPID_SUBJECT');

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

  // PUSH ONLY: a VAPID problem never stops the function, so email never
  // depends on push's configuration.
  const vapidProblem: VapidProblem | null =
    vapidPublicKey === ''
      ? 'VAPID_PUBLIC_KEY_MISSING'
      : !VAPID_PUBLIC_KEY_SHAPE.test(vapidPublicKey)
        ? 'VAPID_PUBLIC_KEY_INVALID'
        : vapidPrivateKey === ''
          ? 'VAPID_PRIVATE_KEY_MISSING'
          : !VAPID_PRIVATE_KEY_SHAPE.test(vapidPrivateKey)
            ? 'VAPID_PRIVATE_KEY_INVALID'
            : vapidSubject === ''
              ? 'VAPID_SUBJECT_MISSING'
              : !VAPID_SUBJECT_SHAPE.test(vapidSubject)
                ? 'VAPID_SUBJECT_INVALID'
                : null;

  return {
    ok: true,
    configuration: {
      projectUrl,
      secretKey,
      invokeSecret,
      resendApiKey,
      emailFrom,
      appUrl,
      vapid: vapidProblem === null ? { publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: vapidSubject } : null,
      vapidProblem,
    },
  };
}

// ------------------------------------------------------------------ the client

export interface RpcAnswer {
  readonly data: unknown;
  readonly error: { readonly code?: string; readonly message?: string } | null;
}

/**
 * The secret-key client, narrowed to the one method this function may use,
 * and to its three functions. No `from(...)`: reading or writing a table
 * directly is unrepresentable.
 */
export interface OutboxClient {
  rpc(
    fn: typeof CLAIM_RPC | typeof SETTLE_RPC | typeof DELETE_SUBSCRIPTION_RPC,
    args: Record<string, unknown>,
  ): PromiseLike<RpcAnswer>;
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** One device, as the claim returns it with a push row. */
export interface PushSubscriptionRow {
  readonly id: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  /** The member the claim found it registered to: a delete must still match it. */
  readonly member_id: string;
}

/** A push request, encrypted and signed, ready for `fetch`. */
export interface PushRequest {
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/**
 * Encrypts `payload` for one device (RFC 8291, `aes128gcm`) and signs the
 * request with the VAPID key pair (RFC 8292). `index.ts` wires `npm:web-push`'s
 * `generateRequestDetails`; the tests inject a fake. It may throw for keys it
 * cannot use; the send is `fetch`'s, so it is asserted here.
 */
export type PushEncryptor = (
  subscription: { readonly endpoint: string; readonly keys: { readonly p256dh: string; readonly auth: string } },
  payload: string,
  options: {
    readonly vapid: { readonly subject: string; readonly publicKey: string; readonly privateKey: string };
    readonly ttl: number;
  },
) => PushRequest;

/** As much of `web-push`'s `generateRequestDetails` as {@link pushEncryptorOf} calls. */
export type GenerateRequestDetails = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL: number;
    contentEncoding: 'aes128gcm';
  },
) => {
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string | number>>;
  readonly body: Uint8Array | ArrayLike<number> | null;
};

/**
 * `web-push`'s request builder, without its sender, as a {@link PushEncryptor}:
 * the payload encrypted (`aes128gcm`) and the VAPID header signed; the POST is
 * the handler's own `fetch`. Header values become strings, and
 * `Content-Length` is left to `fetch`. `index.ts` passes the real
 * `generateRequestDetails`; `test/notify-boundary.test.ts` does too, from the
 * same package version, so the adapter is asserted against the real library.
 */
export function pushEncryptorOf(generateRequestDetails: GenerateRequestDetails): PushEncryptor {
  return (subscription, payload, options) => {
    const details = generateRequestDetails(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } },
      payload,
      {
        vapidDetails: {
          subject: options.vapid.subject,
          publicKey: options.vapid.publicKey,
          privateKey: options.vapid.privateKey,
        },
        TTL: options.ttl,
        contentEncoding: 'aes128gcm',
      },
    );
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(details.headers)) {
      if (name.toLowerCase() !== 'content-length') headers[name] = String(value);
    }
    return { endpoint: details.endpoint, headers, body: new Uint8Array(details.body ?? []) };
  };
}

export interface HandlerDependencies {
  /** Constructs the secret-key client. Its only permitted use is the three RPCs. */
  readonly makeClient: () => unknown;
  readonly fetch: Fetch;
  /** Story 10.4: builds each device's push request. Without it a push row is retried, never sent. */
  readonly encryptPush?: PushEncryptor;
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
  /** The organization's name, which every email names (0043). */
  readonly organization_name: string | null;
  /** The fact the row is about; a push's `tag` names it. */
  readonly subject_id?: string | null;
  /** Story 10.4: a push row's devices (0045); `null` for an email row. */
  readonly subscriptions?: unknown;
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

async function deliverEmail(row: ClaimedNotification, configuration: Configuration, fetch: Fetch): Promise<Delivery> {
  const address = (row.email ?? '').trim();
  if (address === '') return { result: 'permanent', failureCode: RECIPIENT_NO_EMAIL };

  // TRANSIENT, not permanent: a code this deployment cannot render yet is
  // most likely one a newer migration writes before the newer function is
  // deployed. The backoff gives the deploy time; five misses fail the row.
  const rendered = render(row.code, row.locale, row.operands, {
    appUrl: configuration.appUrl,
    slug: row.slug,
    organizationName: row.organization_name,
  });
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

function isSubscription(value: unknown): value is PushSubscriptionRow {
  if (value === null || typeof value !== 'object') return false;
  const device = value as Record<string, unknown>;
  return (
    typeof device['id'] === 'string' &&
    typeof device['endpoint'] === 'string' &&
    typeof device['p256dh'] === 'string' &&
    typeof device['auth'] === 'string' &&
    typeof device['member_id'] === 'string'
  );
}

/** One device's answer: accepted, gone (404, 410), or a delivery like an email's. */
type DeviceOutcome = { readonly result: 'accepted' } | { readonly result: 'gone' } | Settlement;

/**
 * A push service's answer for one device, with codes of its own (never
 * Resend's). 2xx is accepted; 404 and 410 say the subscription is gone; 408,
 * 409, 429 and 5xx retry, as an email's would; any other 4xx is final. 401 and
 * 403 are retried and never stop the run (human decision, 2026-10-30): a push
 * service refuses a VAPID key per device (a subscription made under another
 * key pair), and a refusal that stopped the run would hold every row behind it.
 */
export function deviceOutcomeOfStatus(status: number): DeviceOutcome {
  if (status >= 200 && status < 300) return { result: 'accepted' };
  if (status === 404 || status === 410) return { result: 'gone' };
  if (status === 401 || status === 403) return { result: 'transient', failureCode: PUSH_SERVICE_UNAUTHORIZED };
  if (status === 408) return { result: 'transient', failureCode: PUSH_SERVICE_TIMEOUT };
  if (status === 409) return { result: 'transient', failureCode: PUSH_SERVICE_CONFLICT };
  if (status === 429) return { result: 'transient', failureCode: PUSH_SERVICE_RATE_LIMITED };
  if (status >= 400 && status < 500) return { result: 'permanent', failureCode: PUSH_SERVICE_REFUSED };
  return { result: 'transient', failureCode: PUSH_SERVICE_UNAVAILABLE };
}

/**
 * The row's settlement from its devices' answers. One device that accepted
 * makes it sent: a push cannot be made idempotent the way an email is, so a
 * device that failed transiently in this run is not tried again (a duplicate
 * on the others is worse). Every device gone fails it
 * {@link PUSH_SUBSCRIPTION_GONE}. Otherwise the first transient failure
 * retries it, and failing that, the first permanent one fails it.
 */
export function settlementOfDevices(outcomes: readonly DeviceOutcome[]): Settlement {
  if (outcomes.length === 0) return { result: 'permanent', failureCode: PUSH_NO_SUBSCRIPTION };
  if (outcomes.some((outcome) => outcome.result === 'accepted')) return { result: 'sent' };
  const failures = outcomes.filter(
    (outcome): outcome is Exclude<Settlement, { result: 'sent' }> =>
      outcome.result === 'transient' || outcome.result === 'permanent' || outcome.result === 'released',
  );
  if (failures.length === 0) return { result: 'permanent', failureCode: PUSH_SUBSCRIPTION_GONE };
  return failures.find((failure) => failure.result === 'transient') ?? failures[0] ?? {
    result: 'permanent',
    failureCode: PUSH_SUBSCRIPTION_GONE,
  };
}

async function deliverPush(
  row: ClaimedNotification,
  configuration: Configuration,
  fetch: Fetch,
  encryptPush: PushEncryptor | undefined,
  deleteSubscription: (device: PushSubscriptionRow) => Promise<void>,
): Promise<Settlement> {
  const devices = Array.isArray(row.subscriptions) ? row.subscriptions.filter(isSubscription) : [];
  if (devices.length === 0) return { result: 'permanent', failureCode: PUSH_NO_SUBSCRIPTION };

  // TRANSIENT, as the email's: a code this deployment cannot render yet.
  const rendered = renderPush(row.code, row.locale, row.operands, {
    appUrl: configuration.appUrl,
    slug: row.slug,
    organizationName: row.organization_name,
  });
  if (!rendered.ok) return { result: 'transient', failureCode: rendered.code };
  // Retried, never sent, and never anything email depends on.
  const vapid = configuration.vapid;
  if (vapid === null) return { result: 'transient', failureCode: PUSH_NOT_CONFIGURED };
  if (encryptPush === undefined) return { result: 'transient', failureCode: PUSH_ENCRYPTOR_MISSING };

  // `tag`: one notification per fact on a device, so a re-send replaces
  // rather than stacks.
  const tag = `${row.code}:${typeof row.subject_id === 'string' ? row.subject_id : row.id}`;
  const payload = JSON.stringify({ title: rendered.title, body: rendered.body, url: rendered.url, tag });

  // The devices IN PARALLEL: one row takes one send's timeout at most, so the
  // run's time budget holds however many devices a member has.
  const outcomes = await Promise.all(
    devices.map(async (device): Promise<DeviceOutcome> => {
      let request: PushRequest;
      try {
        request = encryptPush(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          payload,
          {
            vapid,
            ttl: PUSH_TTL_SECONDS,
          },
        );
      } catch {
        return { result: 'permanent', failureCode: PUSH_SUBSCRIPTION_INVALID };
      }

      let response: Response;
      try {
        response = await fetch(request.endpoint, {
          method: 'POST',
          headers: { ...request.headers },
          body: request.body,
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        return { result: 'transient', failureCode: PUSH_NETWORK_ERROR };
      }

      await response.body?.cancel().catch(() => undefined);

      if (response.status < 200 || response.status >= 300) {
        // The row id and the status, never the endpoint: it carries the
        // device's token.
        console.error(PROVIDER_STATUS, row.id, response.status);
      }

      const outcome = deviceOutcomeOfStatus(response.status);
      if (outcome.result === 'gone') await deleteSubscription(device);
      return outcome;
    }),
  );

  return settlementOfDevices(outcomes);
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

    // A gone device: deleted, and nothing else. A failed delete is logged
    // with the subscription's id; its next push answers 404 or 410 again.
    const deleteSubscription = async (device: PushSubscriptionRow): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let deleted: RpcAnswer | null;
      try {
        // Bounded like a send: a delete that never answers must not hold the
        // row's settle, nor the run's time budget.
        deleted = await Promise.race([
          Promise.resolve(
            client.rpc(DELETE_SUBSCRIPTION_RPC, { p_id: device.id, p_endpoint: device.endpoint, p_member: device.member_id }),
          ),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), SEND_TIMEOUT_MS);
          }),
        ]);
      } catch {
        deleted = null;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      if (deleted === null || deleted.error !== null) console.error(PUSH_DELETE_FAILED, device.id);
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

      // The pace: an email starts no sooner than PACE_MS after the last one.
      // A push goes to the device's push service, not Resend, and is not paced.
      if (lastSend !== null && row.channel !== 'push') {
        const wait = lastSend + PACE_MS - now();
        if (wait > 0) await sleep(wait);
      }
      const usesProvider = row.channel !== 'push' && (row.email ?? '').trim() !== '';
      if (usesProvider) lastSend = now();

      const delivery: Delivery =
        row.channel === 'push'
          ? await deliverPush(row, configuration.configuration, dependencies.fetch, dependencies.encryptPush, deleteSubscription)
          : await deliverEmail(row, configuration.configuration, dependencies.fetch);

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
