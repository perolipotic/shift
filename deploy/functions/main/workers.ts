/**
 * How the router hands a request to a function's worker (story 20.2). Imports
 * nothing: `index.ts` injects the runtime's `readFile`, `userWorkers.create`
 * and environment, and Vitest injects fakes (AD-15).
 *
 * Each worker runs from the eszip the image built for it, with its npm
 * dependencies inside, so a cold start reads a local file and fetches
 * nothing. `allowRemoteModules: false` turns a stray remote import into a
 * failure instead of a download. There is no fall-back to the source tree.
 */

import type { FunctionEntry } from './router.ts';

/** Where the Dockerfile puts each function and its `bundle.eszip`. */
export const FUNCTIONS_ROOT = 'file:///home/deno/functions/';

/** The hosted platform's 150 MB, and a wall clock under Kong's 150 s read timeout. */
export const MEMORY_LIMIT_MB = 150;
export const WORKER_TIMEOUT_MS = 140_000;

export interface Worker {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerOptions {
  readonly servicePath: string;
  readonly maybeEszip: Uint8Array;
  readonly envVars: [string, string][];
  readonly allowRemoteModules: boolean;
  readonly forceCreate: boolean;
  readonly memoryLimitMb: number;
  readonly workerTimeoutMs: number;
}

export interface WorkerDependencies {
  readonly readFile: (path: URL) => Promise<Uint8Array>;
  readonly createWorker: (options: WorkerOptions) => Promise<Worker>;
  readonly getEnv: (name: string) => string | undefined;
}

/** The router's `forward`: start (or reuse) the named function's worker and hand it the ORIGINAL request. */
export function createForward(
  dependencies: WorkerDependencies,
): (name: string, entry: FunctionEntry, request: Request) => Promise<Response> {
  /** Each bundle is read once, on first use, and kept; a failed read is not kept. */
  const bundles = new Map<string, Promise<Uint8Array>>();

  function bundleOf(name: string): Promise<Uint8Array> {
    let bundle = bundles.get(name);
    if (bundle === undefined) {
      bundle = dependencies.readFile(new URL(`${name}/bundle.eszip`, FUNCTIONS_ROOT));
      bundle.catch(() => bundles.delete(name));
      bundles.set(name, bundle);
    }
    return bundle;
  }

  return async function forward(name, entry, request) {
    // Only the variables this function's own handler reads, by name.
    const envVars: [string, string][] = [];
    for (const variable of entry.environment) {
      const value = dependencies.getEnv(variable);
      if (value !== undefined) envVars.push([variable, value]);
    }

    const start = async (): Promise<Worker> =>
      dependencies.createWorker({
        servicePath: new URL(`${name}/`, FUNCTIONS_ROOT).pathname,
        maybeEszip: await bundleOf(name),
        envVars,
        allowRemoteModules: false,
        forceCreate: false,
        memoryLimitMb: MEMORY_LIMIT_MB,
        workerTimeoutMs: WORKER_TIMEOUT_MS,
      });

    try {
      return await (await start()).fetch(request);
    } catch (error) {
      // A pooled worker that retired between `create` and `fetch`: start a
      // fresh one, once, and only while the body is still unread. Anything
      // else is the router's FUNCTION_UNAVAILABLE.
      if ((error as { name?: unknown } | null)?.name !== 'WorkerAlreadyRetired' || request.bodyUsed) throw error;
      return await (await start()).fetch(request);
    }
  };
}
