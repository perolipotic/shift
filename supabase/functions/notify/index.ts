/**
 * notify — the Deno wiring, and nothing else (AD-14, amended by story 10.1).
 *
 * Every decision lives in `handler.ts`, which imports nothing Deno-specific
 * and is asserted from Vitest (AD-15). This file reads the environment, builds
 * the secret-key client and serves.
 *
 * AD-17 (amended): the Resend key, and from story 10.4 the VAPID key pair and
 * its subject, are read here and nowhere else. The secret key is read here
 * too, for ONE use: calling `claim_notifications`, `settle_notification` and
 * (story 10.4) `delete_push_subscription`, which only `service_role` may
 * execute. `handler.ts` narrows the client to `rpc`, so a
 * direct table read or write is unrepresentable.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.113.0';
import webpush from 'npm:web-push@3.6.7';

import { createHandler, pushEncryptorOf, readConfiguration } from './handler.ts';

/**
 * `admin-auth/deno-runtime.d.ts` declares the global `Deno` for the one
 * type-check project both functions share, and a second declaration would
 * collide with it. So this file names the runtime through `globalThis`, typed
 * by its own shim (`deno-runtime.d.ts`).
 */
const runtime = (globalThis as unknown as { Deno: NotifyDenoRuntime }).Deno;

const configuration = readConfiguration((name) => runtime.env.get(name));

if (!configuration.ok) {
  console.error(`notify is misconfigured: ${configuration.code}`);
}

/**
 * Story 10.4: `web-push`'s request builder, without its sender
 * (`pushEncryptorOf`, asserted in Vitest against the same library). The POST
 * is the handler's own `fetch`.
 */
const encryptPush = pushEncryptorOf(webpush.generateRequestDetails);

if (configuration.ok && configuration.configuration.vapidProblem !== null) {
  // Push only: email runs; every push row is retried as PUSH_NOT_CONFIGURED.
  console.error(`notify cannot send push: ${configuration.configuration.vapidProblem}`);
}

const handle = createHandler(configuration, {
  makeClient: () => {
    if (!configuration.ok) throw new Error(configuration.code);
    return createClient(configuration.configuration.projectUrl, configuration.configuration.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  },
  fetch: (input, init) => fetch(input, init),
  encryptPush,
});

runtime.serve(handle);
