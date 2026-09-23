/**
 * admin-auth — the one privileged boundary (AD-16), and it may not think.
 *
 * This is the only server-side component in the system (AD-14). It exposes
 * `createUser`, `updateUserById` and `resetPassword` — the three operations in
 * `OPERATIONS` — and nothing else. It
 * performs no domain calculation and contains no rule from `engine-rules.md`;
 * adding either is a defect, not a refactor.
 *
 * Two clients, because the secret key bypasses RLS entirely:
 *
 *   - the SECRET client (`sb_secret_*`) is used ONLY for the Supabase Auth
 *     admin call. Nothing else. A domain-table write made with it is a defect,
 *     because AD-11's `created_by default auth.uid()` and its `with check`
 *     would never fire and attribution would die silently.
 *   - the CALLER client is built from the caller's JWT and the publishable key,
 *     and every domain-table write — the `members` row above all — goes through
 *     it, so RLS and attribution still apply.
 *
 * Organization provisioning does NOT come through here: it is an operator CLI
 * task and the single write in the system exempt from attribution, because no
 * admin exists yet to attribute it to.
 *
 * WHY THERE IS NO `ban` OR `unban`
 * Story 1.6 removed them from the vocabulary rather than implementing them.
 * Deactivation is a versioned domain row (`0008_member_status.sql`) written
 * through PostgREST under row level security: the helper every policy re-reads
 * ends data access on the date, and the access token hook ends sign-in and
 * refresh. The secret key could only have added a session revocation, which
 * GoTrue does not offer without changing the password. Human decision
 * 2026-09-23.
 *
 * This file holds only what is Deno-specific: the environment, the client
 * construction, and the server. Every decision lives in `handler.ts`, which
 * imports nothing and is therefore assertable from Vitest's node environment
 * (AD-15) without deploying anything.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.113.0';

import { createHandler, readConfiguration } from './handler.ts';

/**
 * Per-environment configuration. `SUPABASE_URL` is injected by the Edge
 * Runtime; the two keys are set explicitly per environment (see DEPLOY.md).
 * The `SUPABASE_` prefix is reserved, so our own names are prefixed `SHIFT_`.
 *
 * AD-17: `sb_secret_*` exists in exactly one place, and this is it.
 */
const configuration = readConfiguration((name) => Deno.env.get(name));

if (!configuration.ok) {
  console.error(`admin-auth is misconfigured: ${configuration.code}`);
}

const handle = createHandler(configuration, {
  /**
   * The privileged client. Its ONLY permitted use is `client.auth.admin.*`.
   * Reaching for `.from(...)` on this client is the defect AD-16 exists to
   * prevent — use the caller-scoped client instead.
   */
  makePrivilegedClient: () => {
    if (!configuration.ok) throw new Error(configuration.code);
    return createClient(configuration.configuration.projectUrl, configuration.configuration.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  },

  /**
   * The caller's client: publishable key plus the caller's own JWT. Every
   * domain-table read and write this function performs goes through here, so
   * RLS and the `auth.uid()` attribution defaults apply exactly as they do to a
   * direct PostgREST call from the browser.
   */
  makeCallerClient: (authorization: string) => {
    if (!configuration.ok) throw new Error(configuration.code);
    return createClient(
      configuration.configuration.projectUrl,
      configuration.configuration.publishableKey,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: authorization } },
      },
    );
  },
});

Deno.serve(handle);
