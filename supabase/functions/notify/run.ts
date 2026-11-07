/**
 * notify — the run: `createHandler`, which checks the invoke secret, claims a
 * batch, hands each row to its channel (`email.ts`, `push.ts`) within the
 * run's time budget, and settles it. Split out of `handler.ts` with no change
 * in behaviour (story 12.3b, retro 10).
 *
 * Imports only `handler.ts`, `email.ts` and `push.ts`.
 */

import { deliverEmail } from './email.ts';
import {
  BATCH_SIZE,
  CLAIM_FAILED,
  CLAIM_RPC,
  CLIENT_CONSTRUCTION_FAILED,
  DELETE_SUBSCRIPTION_RPC,
  INVOKE_SECRET_REFUSED,
  METHOD_NOT_ALLOWED,
  NOTIFY_RAN,
  PACE_MS,
  PROVIDER_UNAUTHORIZED,
  PUSH_DELETE_FAILED,
  PUSH_DEVICES_MISSING,
  PUSH_DEVICES_RPC,
  PUSH_DEVICES_UNAVAILABLE,
  PUSH_LEASE_LOST,
  PUSH_RUN_DEADLINE_MS,
  ROW_INVALID,
  RUN_DEADLINE,
  RUN_DEADLINE_MS,
  SEND_TIMEOUT_MS,
  SETTLE_FAILED,
  SETTLE_RPC,
  type ClaimedNotification,
  type ConfigurationResult,
  type Delivery,
  type HandlerDependencies,
  type OutboxClient,
  type PushSubscriptionRow,
  type RpcAnswer,
  type Settlement,
} from './handler.ts';
import { deliverPush, deviceReadOf, type DeviceRead } from './push.ts';

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

    // An RPC after the claim, bounded like a send: one that never answers
    // must not hold the row's settle, nor the run's time budget. `null` when
    // it threw or did not answer in time.
    const bounded = async (call: () => PromiseLike<RpcAnswer>): Promise<RpcAnswer | null> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          Promise.resolve(call()),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), SEND_TIMEOUT_MS);
          }),
        ]);
      } catch {
        return null;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    const settle = async (id: string, token: unknown, settlement: Settlement): Promise<boolean> => {
      // Bounded like every RPC after the claim, so a settle that never
      // answers cannot carry the run past pg_net's 55 s (A7).
      const settled = await bounded(() =>
        client.rpc(SETTLE_RPC, {
          p_id: id,
          p_claimed_at: token,
          p_result: settlement.result,
          p_failure_code: settlement.result === 'sent' ? null : settlement.failureCode,
        }),
      );
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

    // A push row's devices, read at send time under the row's lease (A2).
    const readDevices = async (row: ClaimedNotification): Promise<DeviceRead> => {
      const read = deviceReadOf(
        await bounded(() => client.rpc(PUSH_DEVICES_RPC, { p_id: row.id, p_claimed_at: row.claimed_at })),
      );
      if (read.status === 'unavailable') console.error(PUSH_DEVICES_UNAVAILABLE, row.id);
      if (read.status === 'missing') console.error(PUSH_DEVICES_MISSING, row.id);
      if (read.status === 'lease_lost') console.error(PUSH_LEASE_LOST, row.id);
      return read;
    };

    // A gone device: deleted, and nothing else. A failed delete is logged
    // with the subscription's id; its next push answers 404 or 410 again.
    const deleteSubscription = async (device: PushSubscriptionRow): Promise<void> => {
      const deleted = await bounded(() =>
        client.rpc(DELETE_SUBSCRIPTION_RPC, { p_id: device.id, p_endpoint: device.endpoint, p_member: device.member_id }),
      );
      if (deleted === null || deleted.error !== null) console.error(PUSH_DELETE_FAILED, device.id);
    };

    // Why the run stopped trying a channel, if it did: every later row of
    // that channel is given back untried, without spending its attempt. Per
    // channel (A1): Resend refusing the key never holds a push row, and the
    // push deadline, earlier than email's (A7), never holds an email.
    const stopped: { email: typeof PROVIDER_UNAUTHORIZED | typeof RUN_DEADLINE | null; push: typeof RUN_DEADLINE | null } = {
      email: null,
      push: null,
    };
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

      const isPush = row.channel === 'push';
      if (isPush) {
        if (stopped.push === null && now() - started >= PUSH_RUN_DEADLINE_MS) stopped.push = RUN_DEADLINE;
      } else if (stopped.email === null && now() - started >= RUN_DEADLINE_MS) {
        stopped.email = RUN_DEADLINE;
      }
      const stop = isPush ? stopped.push : stopped.email;
      if (stop !== null) {
        if (await settle(row.id, row.claimed_at, { result: 'released', failureCode: stop })) counts.released += 1;
        continue;
      }

      // The pace: an email starts no sooner than PACE_MS after the last one.
      // A push goes to the device's push service, not Resend, and is not paced.
      if (lastSend !== null && !isPush) {
        const wait = lastSend + PACE_MS - now();
        if (wait > 0) await sleep(wait);
        // The deadline again, after the pace: an email STARTS no later than
        // RUN_DEADLINE_MS, so its send and settle stay inside the budget.
        if (now() - started >= RUN_DEADLINE_MS) {
          stopped.email = RUN_DEADLINE;
          if (await settle(row.id, row.claimed_at, { result: 'released', failureCode: RUN_DEADLINE })) {
            counts.released += 1;
          }
          continue;
        }
      }
      const usesProvider = !isPush && (row.email ?? '').trim() !== '';
      if (usesProvider) lastSend = now();

      const delivery: Delivery | { readonly result: 'skip' } = isPush
        ? await deliverPush(
            row,
            configuration.configuration,
            dependencies.fetch,
            dependencies.encryptPush,
            readDevices,
            deleteSubscription,
          )
        : await deliverEmail(row, configuration.configuration, dependencies.fetch);

      // The row is no longer this run's (A2's read found the lease lost):
      // nothing was posted, and nothing is settled with a stale token.
      if (delivery.result === 'skip') {
        counts.unsettled += 1;
        continue;
      }

      if (delivery.result === 'stop') {
        stopped.email = delivery.failureCode;
        if (await settle(row.id, row.claimed_at, { result: 'released', failureCode: delivery.failureCode })) {
          counts.released += 1;
        }
        continue;
      }

      if (!(await settle(row.id, row.claimed_at, delivery))) continue;

      if (delivery.result === 'sent') counts.sent += 1;
      else if (delivery.result === 'permanent') counts.failed += 1;
      else if (delivery.result === 'released') counts.released += 1;
      else counts.retried += 1;
    }

    // `stopped`, per channel: why the run stopped sending email, push, or
    // both; a channel that never stopped is absent, and so is `stopped` when
    // neither did.
    const stoppedBy: { email?: string; push?: string } = {
      ...(stopped.email === null ? {} : { email: stopped.email }),
      ...(stopped.push === null ? {} : { push: stopped.push }),
    };
    return respond(200, { code: NOTIFY_RAN, ...counts, ...(Object.keys(stoppedBy).length === 0 ? {} : { stopped: stoppedBy }) });
  };
}
