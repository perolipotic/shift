/**
 * notify — push delivery (story 10.4): the send-time device read (retro 10
 * A2), each device's encrypted POST, its answer judged, and a gone device
 * deleted. Split out of `handler.ts` with no change in behaviour (story
 * 12.3b, retro 10).
 *
 * Imports only `handler.ts` and `messages.ts`.
 */

import {
  PROVIDER_STATUS,
  PUSH_DEVICES_MISSING,
  PUSH_DEVICES_UNAVAILABLE,
  PUSH_ENCRYPTOR_MISSING,
  PUSH_NETWORK_ERROR,
  PUSH_NOT_CONFIGURED,
  PUSH_NO_SUBSCRIPTION,
  PUSH_SERVICE_CONFLICT,
  PUSH_SERVICE_RATE_LIMITED,
  PUSH_SERVICE_REFUSED,
  PUSH_SERVICE_TIMEOUT,
  PUSH_SERVICE_UNAUTHORIZED,
  PUSH_SERVICE_UNAVAILABLE,
  PUSH_SUBSCRIPTION_GONE,
  PUSH_SUBSCRIPTION_INVALID,
  PUSH_TTL_SECONDS,
  RECIPIENT_INACTIVE,
  SEND_TIMEOUT_MS,
  type ClaimedNotification,
  type Configuration,
  type Fetch,
  type GenerateRequestDetails,
  type PushEncryptor,
  type PushRequest,
  type PushSubscriptionRow,
  type RpcAnswer,
  type Settlement,
} from './handler.ts';
import { renderPush } from './messages.ts';

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

export async function deliverPush(
  row: ClaimedNotification,
  configuration: Configuration,
  fetch: Fetch,
  encryptPush: PushEncryptor | undefined,
  readDevices: (row: ClaimedNotification) => Promise<DeviceRead>,
  deleteSubscription: (device: PushSubscriptionRow) => Promise<void>,
): Promise<Settlement | { readonly result: 'skip' }> {
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

  // The devices NOW (retro 10 A2), never the claim's snapshot: a device
  // handed to another member since the claim is theirs, and is not posted to.
  const read = await readDevices(row);
  if (read.status === 'unavailable') return { result: 'transient', failureCode: PUSH_DEVICES_UNAVAILABLE };
  if (read.status === 'missing') return { result: 'released', failureCode: PUSH_DEVICES_MISSING };
  if (read.status === 'lease_lost') return { result: 'skip' };
  if (read.status !== 'ready') return { result: 'permanent', failureCode: RECIPIENT_INACTIVE };
  const devices = read.devices;
  if (devices.length === 0) return { result: 'permanent', failureCode: PUSH_NO_SUBSCRIPTION };

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

/**
 * The send-time device read (A2), as `push_devices_for_send` answers it:
 * `ready` with the recipient's current devices; `lease_lost` when the row is
 * no longer this run's; `inactive` when the recipient is not active today;
 * `unavailable` when the read failed, timed out or answered another shape;
 * `missing` when the function does not exist yet.
 */
export type DeviceRead =
  | { readonly status: 'ready'; readonly devices: readonly PushSubscriptionRow[] }
  | { readonly status: 'lease_lost' | 'inactive' | 'unavailable' | 'missing' };

/** A function PostgREST cannot find: PGRST202, or PostgreSQL's undefined_function. */
const FUNCTION_MISSING_CODES: ReadonlySet<string> = new Set(['PGRST202', '42883']);

/** `push_devices_for_send`'s answer, judged. Exported for the tests. */
export function deviceReadOf(answer: RpcAnswer | null): DeviceRead {
  if (answer === null) return { status: 'unavailable' };
  if (answer.error !== null) {
    return FUNCTION_MISSING_CODES.has(answer.error.code ?? '') ? { status: 'missing' } : { status: 'unavailable' };
  }
  const data = answer.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { status: 'unavailable' };
  const status = (data as Record<string, unknown>)['status'];
  if (status === 'lease_lost' || status === 'inactive') return { status };
  if (status !== 'ready') return { status: 'unavailable' };
  const listed = (data as Record<string, unknown>)['devices'];
  if (!Array.isArray(listed)) return { status: 'unavailable' };
  const devices = listed.filter(isSubscription);
  // Entries that are not devices: a shape this function cannot read, retried
  // rather than taken for "no device left".
  if (devices.length !== listed.length) return { status: 'unavailable' };
  return { status: 'ready', devices };
}
