/**
 * The functions router's Deno wiring (story 20.2): the environment, the
 * runtime's worker API, the server. Every decision is in `router.ts` and
 * `workers.ts`, which import nothing runtime-specific and are asserted from
 * Vitest.
 *
 * This file reads ONE variable for itself, `SHIFT_AUTH_URL` (GoTrue's internal
 * address; not a key). `workers.ts` passes each worker the variables in that
 * function's `FUNCTIONS` entry, by name, and nothing uses, logs or sends them.
 */

import { createRouter } from './router.ts';
import { createForward } from './workers.ts';

const runtime = (globalThis as unknown as { Deno: RouterDenoRuntime }).Deno;
const edgeRuntime = (globalThis as unknown as { EdgeRuntime: RouterEdgeRuntime }).EdgeRuntime;

const authUrl = runtime.env.get('SHIFT_AUTH_URL') ?? null;
if (authUrl === null || authUrl.trim() === '') {
  // Every `verify_jwt` function is then refused 503, never let through.
  console.error('router is misconfigured: AUTH_URL_MISSING');
}

runtime.serve(
  createRouter({
    authUrl,
    fetch: (input, init) => fetch(input, init),
    forward: createForward({
      readFile: (path) => runtime.readFile(path),
      createWorker: (options) => edgeRuntime.userWorkers.create(options),
      getEnv: (name) => runtime.env.get(name),
    }),
    log: (code) => console.error(`router: ${code}`),
  }),
);
