/**
 * The runtime surface `deploy/functions/main/index.ts` touches, and nothing
 * more: `edge-runtime` v1.74.3's `EdgeRuntime.userWorkers` (its
 * `types/global.d.ts`) and the few `Deno` members the wiring reads.
 *
 * The global `Deno` is already declared, narrower, by
 * `supabase/functions/admin-auth/deno-runtime.d.ts` in the same type-check
 * project, so this shim names its own interfaces and `index.ts` reads both
 * globals through `globalThis`, as `notify/index.ts` does.
 */

interface RouterUserWorker {
  fetch(request: Request): Promise<Response>;
}

interface RouterUserWorkerOptions {
  readonly servicePath: string;
  readonly maybeEszip: Uint8Array;
  readonly envVars: [string, string][];
  readonly allowRemoteModules: boolean;
  readonly forceCreate: boolean;
  readonly memoryLimitMb: number;
  readonly workerTimeoutMs: number;
}

interface RouterEdgeRuntime {
  readonly userWorkers: {
    create(options: RouterUserWorkerOptions): Promise<RouterUserWorker>;
  };
}

interface RouterDenoRuntime {
  readonly env: {
    get(name: string): string | undefined;
  };
  readFile(path: URL): Promise<Uint8Array>;
  serve(handler: (request: Request) => Promise<Response>): unknown;
}
