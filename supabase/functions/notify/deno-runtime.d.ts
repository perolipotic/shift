/**
 * The Deno surface `notify/index.ts` touches, and nothing more.
 *
 * `index.ts` runs on Supabase's Edge Runtime, so its globals are unknown to
 * `tsc`. The global `Deno` is already declared by
 * `admin-auth/deno-runtime.d.ts` in the same type-check project, and a second
 * `declare const Deno` would not compile, so this shim declares an interface
 * of its own that `index.ts` reads `globalThis.Deno` through.
 *
 * The `npm:` client module is declared here too, identically to admin-auth's:
 * ambient module declarations merge, so the two copies coexist, and this
 * function stays type-checked on its own terms. The client is `unknown` for
 * the reason admin-auth gives: `handler.ts` narrows it to `rpc` and nothing
 * else.
 */

interface NotifyDenoRuntime {
  readonly env: {
    get(name: string): string | undefined;
  };
  serve(handler: (request: Request) => Promise<Response>): unknown;
}

declare module 'npm:@supabase/supabase-js@2.113.0' {
  export function createClient(url: string, key: string, options?: unknown): unknown;
}
