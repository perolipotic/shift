import { supabaseClient } from '@/lib/supabase/client';

import {
  PUSH_SUBSCRIPTIONS_TABLE,
  REGISTER_PUSH_RPC,
  forgetPushDevice,
  pagePushSources,
  reconcilePushDevice,
  type PushBackend,
  type PushSources,
} from '@/features/notifications/services/push';

/**
 * The page's push (story 10.4): the sources over `window`, the backend over
 * the one Supabase client, and the VAPID public key from the build. The rules
 * are `./push`'s, executed by the node suite; this module only binds them.
 *
 * AD-17 (amended by story 10.4): `VITE_VAPID_PUBLIC_KEY` is the third and
 * last build input, and a PUBLIC key; the private key exists only in
 * `notify`'s environment.
 */

export const pagePush: PushSources = pagePushSources(() => window);

/** The build's VAPID public key, read the one way Vite substitutes statically. */
export function vapidPublicKey(): string | undefined {
  return import.meta.env.VITE_VAPID_PUBLIC_KEY;
}

interface Answer {
  readonly data: unknown;
  readonly error: unknown;
}

/** The member's own rows, through the one client: built inside a call, never at import. */
export function pushBackend(): PushBackend {
  const client = supabaseClient();
  const table = () =>
    client.from(PUSH_SUBSCRIPTIONS_TABLE) as unknown as {
      select(columns: string): { eq(column: string, value: string): { limit(count: number): PromiseLike<Answer> } };
      delete(): { eq(column: string, value: string): { select(columns: string): PromiseLike<Answer> } };
    };

  return {
    owns: async (endpoint) => {
      const answer = await table().select('id').eq('endpoint', endpoint).limit(1);
      if (answer.error !== null || !Array.isArray(answer.data)) return undefined;
      return answer.data.length > 0;
    },
    register: async ({ endpoint, p256dh, auth }) => {
      const answer = await client.rpc(REGISTER_PUSH_RPC, { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth });
      return answer.error === null;
    },
    // The rows it deleted: RLS lets a member delete only their own, so 0
    // means the endpoint is someone else's (a shared device), or nobody's.
    remove: async (endpoint) => {
      const answer = await table().delete().eq('endpoint', endpoint).select('id');
      if (answer.error !== null || !Array.isArray(answer.data)) return null;
      return answer.data.length;
    },
  };
}

/**
 * Sign-out's best-effort forgetting of this device (story 10.4). Called while
 * the session still holds; bounded and never throws, so it never holds a
 * sign-out up.
 */
export async function forgetThisPushDevice(): Promise<void> {
  try {
    await forgetPushDevice(pagePush, pushBackend());
  } catch {
    // `pushBackend` throws on a build with no environment; sign-out goes on.
  }
}

/**
 * Every other end of a session (an expiry, a revocation, a local sign-out),
 * caught on a signed-in load (story 10.4): a subscription the member does not
 * own, or one the permission no longer covers, is dropped. Silent and
 * best-effort; never throws.
 */
export async function reconcileThisPushDevice(): Promise<void> {
  try {
    await reconcilePushDevice(pagePush, pushBackend());
  } catch {
    // A build with no environment: nothing to reconcile.
  }
}
