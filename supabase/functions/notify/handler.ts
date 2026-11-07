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
 *      row (story 10.4), reads the recipient's devices AGAIN through
 *      `push_devices_for_send` (retro 10 A2: an endpoint handed to another
 *      member since the claim is not this row's), posts the encrypted
 *      payload with a VAPID header to each, and deletes through
 *      `delete_push_subscription` each device its push service answers 404
 *      or 410 for;
 *   5. settles it through `settle_notification` with the lease token the
 *      claim returned: sent; transient (the claim released, the next attempt
 *      backed off by attempts x 10 minutes, failed on the fifth); released
 *      (given back without spending the attempt, when the run stops trying a
 *      channel: Resend refused the key, or the channel's time budget ran
 *      out); or permanent (failed).
 *
 * CHANNELS ARE INDEPENDENT (retro 10 A1). A Resend 401 or 403 stops the
 * run's EMAIL rows only; push rows go on. Nothing push answers stops email.
 *
 * THE TIME BUDGET. pg_net waits 55 s for an answer; the run's work fits in
 * 50 s. One run claims at most {@link BATCH_SIZE} rows, spaces emails
 * {@link PACE_MS} apart (Resend's default limit is about two requests a
 * second), and bounds every call to a provider or to the database after the
 * claim by {@link SEND_TIMEOUT_MS}. An email (one send) starts no later than
 * {@link RUN_DEADLINE_MS}; a push row (the device read, the sends in parallel,
 * the deletes in parallel: three bounded steps) no later than
 * {@link PUSH_RUN_DEADLINE_MS} (retro 10 A7). A row past its channel's
 * deadline is released untried.
 *
 * It writes nothing but those four RPCs, reads no table directly, and computes
 * no domain answer (AD-18): every fact arrives decided, in the row. Adding a
 * rule here is a defect, not a refactor (AD-16's spirit).
 *
 * THE MODULES (story 12.3b, retro 10), each importing only the ones below it:
 *
 *   - `handler.ts` (this file): the codes, the constants, the configuration
 *     and the shared types. It imports nothing.
 *   - `email.ts`: Resend delivery.
 *   - `push.ts`: push delivery and the send-time device read.
 *   - `run.ts`: `createHandler`, the run loop.
 *   - `messages.ts`: the pinned text and its rendering, imported by
 *     `email.ts` and `push.ts`; it imports nothing.
 *
 * None imports anything Deno-specific: each takes its environment, its client
 * factory and its `fetch` as arguments, and so is asserted from Vitest's node
 * environment (AD-15) with no deployment. `index.ts` holds the Deno wiring.
 */

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
/** 401 or 403: the key or the domain is wrong. The run stops sending email and gives every email row back; push goes on. */
export const PROVIDER_UNAUTHORIZED = 'PROVIDER_UNAUTHORIZED';
export const NETWORK_ERROR = 'NETWORK_ERROR';
/** The row's channel's time budget ran out before this row was tried. */
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
/**
 * Retro 10 A2 (0046): a push row's devices, read right before it is posted,
 * while the lease is still this run's. Only these are sent to.
 */
export const PUSH_DEVICES_RPC = 'push_devices_for_send';

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
/**
 * The send-time device read failed, threw, answered no list, or did not answer
 * in time: nothing was posted, and the row is retried.
 */
export const PUSH_DEVICES_UNAVAILABLE = 'PUSH_DEVICES_UNAVAILABLE';
/**
 * The device read found the row no longer this run's (re-claimed or settled
 * since the claim). Logged; the row is not settled, because it is not this
 * run's to settle.
 */
export const PUSH_LEASE_LOST = 'PUSH_LEASE_LOST';
/** Set by the claim, or by this function from the device read: the recipient is not active today. */
export const RECIPIENT_INACTIVE = 'RECIPIENT_INACTIVE';
/**
 * The device read's function does not exist (a `notify` deployed before the
 * migration that adds it): the row is given back without spending its attempt.
 */
export const PUSH_DEVICES_MISSING = 'PUSH_DEVICES_MISSING';
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

/** No email starts this long after the run began; the rest are released untried. One send fits before 50 s. */
export const RUN_DEADLINE_MS = 45_000;

/**
 * No push row starts this long after the run began (retro 10 A7): its device
 * read, its sends and its deletes, each bounded by {@link SEND_TIMEOUT_MS},
 * fit before 50 s. The rest are released untried.
 */
export const PUSH_RUN_DEADLINE_MS = 35_000;

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
 * and to its four functions. No `from(...)`: reading or writing a table
 * directly is unrepresentable.
 */
export interface OutboxClient {
  rpc(
    fn: typeof CLAIM_RPC | typeof SETTLE_RPC | typeof DELETE_SUBSCRIPTION_RPC | typeof PUSH_DEVICES_RPC,
    args: Record<string, unknown>,
  ): PromiseLike<RpcAnswer>;
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** One device, as `push_devices_for_send` (and the claim) returns it with a push row. */
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

export interface HandlerDependencies {
  /** Constructs the secret-key client. Its only permitted use is the four RPCs. */
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
  /**
   * Story 10.4: a push row's devices at claim time (0045); `null` for an
   * email row. Kept for compatibility and never sent to: the send reads them
   * again ({@link PUSH_DEVICES_RPC}, retro 10 A2).
   */
  readonly subscriptions?: unknown;
}

export type SettleResult = 'sent' | 'transient' | 'released' | 'permanent';

export type Settlement =
  | { readonly result: 'sent' }
  | { readonly result: 'transient' | 'permanent' | 'released'; readonly failureCode: string };

/** A send's outcome: a settlement, or Resend refusing the key, which stops the run's email. */
export type Delivery = Settlement | { readonly result: 'stop'; readonly failureCode: typeof PROVIDER_UNAUTHORIZED };
