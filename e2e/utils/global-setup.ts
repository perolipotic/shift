import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { requireAdminAuth, requireStack } from './database-helper.ts';
import { provision, sweepStale } from './run-fixture.ts';

/** The dev server's checkout answer (`apps/web/vite.config.ts`, retro 10 A14). */
const CHECKOUT_URL = 'http://127.0.0.1:5173/__shift/checkout';

/** This checkout's repository root, as the dev server's plugin computes its own. */
const THIS_CHECKOUT = fileURLToPath(new URL('../..', import.meta.url));

function canonical(path: string): string {
  try {
    // `.native`: the filesystem's own spelling, so a case-insensitive volume
    // never makes this checkout's own server look like another's.
    return realpathSync.native(path).replace(/\/+$/, '');
  } catch {
    return path.replace(/\/+$/, '');
  }
}

/**
 * Refuse a dev server on 127.0.0.1:5173 that another checkout started (retro
 * 10 A14). `reuseExistingServer` keeps a server already on the port, and a
 * parallel session's Vite would otherwise serve this run another branch's
 * code, silently. A server that does not answer the checkout path (one started
 * before the plugin existed) is refused too. CI starts Vite from the same
 * checkout, so reuse still works there.
 */
export async function requireOwnDevServer(
  checkoutUrl: string = CHECKOUT_URL,
  thisCheckout: string = THIS_CHECKOUT,
): Promise<void> {
  let root: unknown = null;
  try {
    const response = await fetch(checkoutUrl, { signal: AbortSignal.timeout(5_000) });
    root = ((await response.json()) as { root?: unknown }).root;
  } catch {
    root = null;
  }
  if (typeof root !== 'string') {
    throw new Error(
      `E2E: the dev server on 127.0.0.1:5173 does not say which checkout it serves (${checkoutUrl}). ` +
        'It was started before this check existed, or is not this app. Stop it, or run the e2e from the checkout that owns it.',
    );
  }
  if (canonical(root) !== canonical(thisCheckout)) {
    throw new Error(
      `E2E: the dev server on 127.0.0.1:5173 serves another checkout (${root}), not this one (${thisCheckout}). ` +
        'Stop that server, or run the e2e from the checkout that owns it.',
    );
  }
}

/**
 * Before any test: refuse to start without the stack (database and GoTrue),
 * without the admin-auth function served for the app's origin, or against a
 * dev server another checkout started; clear what crashed runs left behind,
 * then provision this run's own organization.
 */
export default async function globalSetup(): Promise<void> {
  await requireStack();
  await requireAdminAuth();
  await requireOwnDevServer();
  await sweepStale();
  await provision();
}
