/**
 * The Deno surface `index.ts` touches, and nothing more.
 *
 * `index.ts` runs on Supabase's Edge Runtime, so its globals and its `npm:`
 * specifier are unknown to `tsc`. Without this shim the privileged boundary
 * would sit outside every tsconfig — which is how the one file holding the
 * secret key ends up type-checked by nobody.
 *
 * Both declarations are deliberately the minimum. The Supabase client is typed
 * as returning `unknown` because `handler.ts` types it that way too: this
 * function must never touch a client, only prove both can be constructed, so a
 * richer declaration here would invent a type surface no code is allowed to
 * use — and would drift from the real 2.113.0 API unnoticed.
 */

declare const Deno: {
  readonly env: {
    get(name: string): string | undefined;
  };
  serve(handler: (request: Request) => Promise<Response>): unknown;
};

declare module 'npm:@supabase/supabase-js@2.113.0' {
  export function createClient(url: string, key: string, options?: unknown): unknown;
}
