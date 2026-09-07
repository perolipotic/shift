import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The single browser Supabase client (story 1.3b).
 *
 * AD-17: two inputs and no third. `VITE_SUPABASE_URL` and
 * `VITE_SUPABASE_PUBLISHABLE_KEY` are the whole contract — both are declared in
 * `vite-env.d.ts`, both are injected at build time, and the secret key is not
 * reachable from this bundle at all. What this module adds is the RUNTIME half
 * of that contract: the declarations type the variables as `string`, which is a
 * promise the type system cannot keep. Vite replaces an undeclared `VITE_*`
 * member access with `undefined`, so a build run without an environment ships a
 * client constructed from `undefined` — one that resolves URLs like
 * `undefined/auth/v1/token`, fails every call with a transport error, and looks
 * exactly like a service outage. Failing loudly at construction is the only
 * shape that does not disguise a misconfiguration as a network problem.
 *
 * `SUPABASE_ENVIRONMENT_MISSING` is a stable code, not a message — the same
 * convention as `ROOT_ELEMENT_MISSING` and `LOCALIZATION_INIT_FAILED`. It never
 * reaches a user: the throw happens before the application mounts, so what is on
 * screen is `index.html`'s boot fallback.
 *
 * Two shapes are deliberate:
 *
 *   - `readSupabaseEnvironment` takes a READER rather than touching
 *     `import.meta.env` itself, so the absence case is executable from the node
 *     suite (AD-15) without a build and without a DOM. It is the same idiom
 *     `admin-auth/handler.ts` uses for `Deno.env.get`.
 *   - the two variables are read through explicit member accesses rather than
 *     an index expression. Vite substitutes `import.meta.env.VITE_NAME`
 *     statically; `import.meta.env[name]` is a runtime lookup that a production
 *     build is not obliged to satisfy, and the failure mode of getting that
 *     wrong is an empty value in the built bundle only.
 *
 * The client itself is memoized rather than constructed at module scope, so
 * importing this module — which `sign-in.ts` consumers and the router both do —
 * has no side effect and needs no environment. Exactly one client is ever built;
 * a second would keep its own session storage and the two would disagree about
 * who is signed in.
 */

/** Thrown when either build-time variable is absent, blank or unusable. */
export const SUPABASE_ENVIRONMENT_MISSING = 'SUPABASE_ENVIRONMENT_MISSING';

/** Logged when the session cannot be read. Never rendered: see `sessionReader`. */
export const SESSION_UNREADABLE = 'SESSION_UNREADABLE';

export const SUPABASE_URL_VARIABLE = 'VITE_SUPABASE_URL';
export const SUPABASE_PUBLISHABLE_KEY_VARIABLE = 'VITE_SUPABASE_PUBLISHABLE_KEY';

export interface SupabaseEnvironment {
  readonly url: string;
  readonly publishableKey: string;
}

/** Where a variable's value comes from. Injected so the absence case is testable. */
export type EnvironmentReader = (name: string) => string | undefined;

/**
 * Whether a value can be the project URL at all.
 *
 * The same shape check `admin-auth/handler.ts` applies to `SUPABASE_URL`, and
 * for the same reason: a value that is present but not a URL — a project REF
 * pasted instead of its URL, a `${…}` that never got substituted — is a
 * misconfiguration exactly as much as an absent one, and it is worse to
 * discover it as an opaque throw from inside `createClient`, or as a request to
 * a relative path that 404s and reads like an outage.
 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);

    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The two variables, or a throw naming the stable code.
 *
 * Trimmed before the emptiness check, for the reason `admin-auth/handler.ts`
 * records: a value pasted into a dashboard or a heredoc carries a trailing
 * newline, and a whitespace-only value is absent in every sense that matters.
 *
 * ONE code for all four ways of being wrong. This throw is read by a developer
 * reading a console, never by a user — the application has not mounted — so the
 * distinctions a richer code set would draw buy nothing, and a single stable
 * code is the thing every other layer here already agreed to.
 */
export function readSupabaseEnvironment(read: EnvironmentReader): SupabaseEnvironment {
  const url = (read(SUPABASE_URL_VARIABLE) ?? '').trim();
  const publishableKey = (read(SUPABASE_PUBLISHABLE_KEY_VARIABLE) ?? '').trim();

  if (url === '' || publishableKey === '') throw new Error(SUPABASE_ENVIRONMENT_MISSING);
  if (!isHttpUrl(url)) throw new Error(SUPABASE_ENVIRONMENT_MISSING);

  return { url, publishableKey };
}

/** The build-time environment, read the one way Vite substitutes statically. */
export const buildEnvironment: EnvironmentReader = (name) => {
  if (name === SUPABASE_URL_VARIABLE) return import.meta.env.VITE_SUPABASE_URL;
  if (name === SUPABASE_PUBLISHABLE_KEY_VARIABLE) return import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  return undefined;
};

let client: SupabaseClient | null = null;

/** The one browser client. Constructed on first use, then reused. */
export function supabaseClient(): SupabaseClient {
  if (client === null) {
    const { url, publishableKey } = readSupabaseEnvironment(buildEnvironment);

    client = createClient(url, publishableKey);
  }

  return client;
}

/** As much of `supabase.auth` as reading a session needs. */
export interface SessionSource {
  getSession(): Promise<{
    data: { session: Session | null };
    error: { message?: string | undefined } | null;
  }>;
}

/**
 * The reader `/`'s `beforeLoad` resolves a session through.
 *
 * A FUNCTION built from an injected source rather than an inline arrow in
 * `router.ts`, for the reason `signIn(auth, …)` takes its client: written
 * inline it is executed by nothing, and mutating it to `async () => null` keeps
 * the whole suite green while every signed-in visitor bounces endlessly between
 * `/` and `/prijava`.
 *
 * The source is itself a thunk, so binding this at module scope constructs no
 * client and needs no environment — importing `@/router` in the node suite must
 * not require a configured build.
 *
 * AN ERROR DOES NOT SIGN ANYBODY OUT. `getSession` reports a problem alongside
 * whatever it managed to read, and the two are independent: a refresh that
 * failed against a session still held in memory is an error with a session, and
 * returning `null` for it would evict a signed-in person on a transient network
 * fault. So the session decides, and the error is logged rather than swallowed
 * — `SESSION_UNREADABLE` is a stable code and never reaches a screen, because
 * the caller's whole vocabulary here is "session or no session".
 */
export function sessionReader(source: () => SessionSource): () => Promise<Session | null> {
  return async () => {
    const answered = await source().getSession();

    if (answered.error !== null) console.error(SESSION_UNREADABLE, answered.error);

    return answered.data.session;
  };
}

/** The bound reader. Named so `router.test.ts` can pin it by identity. */
export const currentSession = sessionReader(() => supabaseClient().auth);
