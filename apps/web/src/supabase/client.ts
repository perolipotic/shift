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
 * reaches a user as itself: the client is memoized rather than built at module
 * scope, so the throw happens on FIRST USE — inside `/`'s `beforeLoad` or the
 * sign-in handler — rather than before the application mounts. Both of those
 * callers catch it, which is what makes the console the only place it surfaces,
 * and why both of them log it (`index.tsx`, `prijava.tsx`). An earlier version
 * of this comment claimed the throw preceded mount; it does not, and the
 * logging is what keeps the "never a silent misconfiguration" promise instead.
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

/**
 * Logged when reading the session REJECTED rather than merely failing.
 *
 * Distinct from `SESSION_UNREADABLE`, which `sessionReader` logs alongside a
 * session it still managed to read. This one is `/`'s: the read threw, so there
 * is no session and no error object to report — only a cause, which is usually
 * `SUPABASE_ENVIRONMENT_MISSING` from a build with no environment, or blocked
 * storage in a private window. Two codes because the two say different things to
 * whoever is reading the console, and telling them apart is the whole reason to
 * log at all.
 */
export const SESSION_UNRESOLVED = 'SESSION_UNRESOLVED';

export const SUPABASE_URL_VARIABLE = 'VITE_SUPABASE_URL';
export const SUPABASE_PUBLISHABLE_KEY_VARIABLE = 'VITE_SUPABASE_PUBLISHABLE_KEY';

/**
 * What a publishable key looks like, and the only key shape this bundle accepts.
 *
 * The URL's shape was already checked and the key's was not, which left the one
 * asymmetry AD-17 cannot afford: `vite-env.d.ts` says "must match
 * `sb_publishable_*`" and `.env.example` says a secret value here "is a security
 * defect", but both were prose. A secret key pasted into this variable
 * constructed a working client and Vite inlined it into every chunk served to
 * every browser — and the only thing standing in the way was
 * `key-hygiene.test.ts`'s bundle scan, which is `skipIf(notBuilt)` and which
 * `pnpm test` does not build for.
 *
 * Asserted POSITIVELY — the value must start with the publishable prefix —
 * rather than by refusing the secret one. Refusing `sb_secret_` would name it,
 * and `key-hygiene.test.ts`'s naming scan forbids that literal anywhere in the
 * client tree; it would also pass any other wrong value through. Only one shape
 * belongs here, so only one shape is admitted.
 */
const PUBLISHABLE_KEY_PREFIX = 'sb_publishable_';

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
 * ONE code for all FIVE ways of being wrong — absent url, absent key, a url
 * that is not a url, a key that is not a publishable key, and a value that is
 * only whitespace. This throw is read by a developer reading a console, never by
 * a user: both call sites catch it and log it, and neither renders it. So the
 * distinctions a richer code set would draw buy nothing, and a single stable
 * code is the thing every other layer here already agreed to.
 */
export function readSupabaseEnvironment(read: EnvironmentReader): SupabaseEnvironment {
  const url = (read(SUPABASE_URL_VARIABLE) ?? '').trim();
  const publishableKey = (read(SUPABASE_PUBLISHABLE_KEY_VARIABLE) ?? '').trim();

  if (url === '' || publishableKey === '') throw new Error(SUPABASE_ENVIRONMENT_MISSING);
  if (!isHttpUrl(url)) throw new Error(SUPABASE_ENVIRONMENT_MISSING);
  if (!publishableKey.startsWith(PUBLISHABLE_KEY_PREFIX)) {
    throw new Error(SUPABASE_ENVIRONMENT_MISSING);
  }

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

/**
 * The session, or `null` — including when reading it FAILED.
 *
 * THREE OUTCOMES COLLAPSED TO TWO, deliberately and in one place. `currentSession`
 * can reject: the client throws its stable code on a build with no environment,
 * and `getSession` rejects wherever storage is blocked — Safari's private mode,
 * a locked-down enterprise profile. A rejection escaping a `beforeLoad` resolves
 * the route to neither a redirect nor a component, which is a blank page at HTTP
 * 200 that `__root.tsx` registers no `errorComponent` to catch.
 *
 * NOT SILENT, which is the half a bare `catch` loses. `SESSION_UNRESOLVED` is a
 * stable code and never reaches a screen; without it a deployment with no
 * environment behaves like an ordinary signed-out visit, with an empty console
 * and nothing anywhere to say why — the misconfiguration-as-outage failure this
 * module exists to refuse.
 *
 * WHAT `null` MEANS IS THE CALLER'S DECISION, and it genuinely differs by caller,
 * which is why this helper stops short of making it. `routes/_app.tsx` fails
 * CLOSED — no session, no destination — because letting somebody through puts
 * them on screens every query refuses. Both sign-in routes fail OPEN — no
 * session, render the form — because redirecting on a failed read would put the
 * one path that can repair a session behind the session working. Same read,
 * opposite defaults; only the read is shared.
 *
 * SHARED BY THE TWO SIGN-IN ROUTES ONLY, today. `_app.tsx` and `index.tsx` still
 * hold their own copies, and that is a scope boundary rather than an oversight:
 * the navigation shell's own spec permits no change to `_app.tsx` beyond
 * rendering the chrome. Folding those two in is a one-line edit each for
 * whichever story is allowed to touch them.
 */
export async function resolvedSession(
  read: () => Promise<Session | null>,
): Promise<Session | null> {
  try {
    return await read();
  } catch (cause) {
    console.error(SESSION_UNRESOLVED, cause);

    return null;
  }
}
