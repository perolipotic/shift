/**
 * Where a successful sign-in returns to: the in-app location the visitor asked
 * for before the signed-out redirect sent them to sign in.
 *
 * THE LOCATION RIDES A SEARCH PARAMETER through both sign-in routes. `_app.tsx`
 * and `index.tsx` put the whole href (path, search and hash) into
 * {@link RETURN_SEARCH_KEY} on `/prijava`, where the one sign-in form (story
 * 7.7) reads it; the sign-in hook navigates to it once the password is
 * accepted. Carried as the sign-in route's own search and hash, which is what the two
 * redirects did before this module, the parameters lived for one hop and the
 * PATH never travelled at all, so `/kalendar?tim=2#tjedan` came back as `/`.
 *
 * VALIDATED ON THE WAY OUT, never trusted on the way in. The parameter is part
 * of a URL anybody can write, so it is an open-redirect vector unless the one
 * place that follows it refuses everything that is not a same-app path:
 * {@link returnTargetOf} admits a relative path that resolves to this origin,
 * contains no backslash or control character, and names a route the tree
 * knows. Anything else falls back to `/`, which decides for itself where a
 * signed-in visitor belongs.
 *
 * A pure function of its inputs, with no router import: the route tree imports
 * the pages that import this module, so the tree comes in as a predicate
 * ({@link knownPathOf}) and the whole rule is executable from the node suite
 * (AD-15). `return-target.test.ts` runs every rejected shape; `router.test.ts`
 * runs the predicate against the real tree.
 */

/** The search key that carries the return target on both sign-in routes. */
export const RETURN_SEARCH_KEY = 'povratak';

/** Where a sign-in lands when there is no target, or none that is safe. */
export const SIGNED_IN_HOME = '/';

/** The search both sign-in routes validate to: the return target, if any. */
export interface ReturnSearch {
  readonly povratak?: string;
}

/** As much of the router as asking "is this a route" needs. */
export interface RouteMatcher {
  matchRoutes(
    pathname: string,
    search: Record<string, unknown>,
  ): readonly { readonly _notFound?: boolean | undefined }[];
}

/**
 * A base no real request can reach (RFC 2606), used only to resolve a
 * candidate and compare origins. A candidate that resolves anywhere else
 * — `//evil.example`, `/\evil.example`, `https://evil.example` — is not a path
 * in this application.
 */
const RESOLUTION_BASE = 'http://return-target.invalid';
const RESOLUTION_ORIGIN = new URL(RESOLUTION_BASE).origin;

/**
 * The longest candidate that is followed at all. A return target is one
 * in-app href; anything longer is refused rather than trusted, so a value
 * nested or accumulated across bounces cannot grow without limit.
 */
export const RETURN_TARGET_MAX_LENGTH = 2048;

/** The last C0 control code point, and DEL. */
const LAST_CONTROL = 0x1f;
const DELETE = 0x7f;
/** The character WHATWG URL parsing reads as `/` in a special scheme. */
const BACKSLASH = '\\';

/** Whether a candidate holds a control character or a backslash anywhere. */
function hasUnsafeCharacter(candidate: string): boolean {
  for (const character of candidate) {
    const code = character.codePointAt(0) ?? 0;

    if (code <= LAST_CONTROL || code === DELETE || character === BACKSLASH) return true;
  }

  return false;
}

/**
 * What a sign-in route's `validateSearch` keeps: the return target when it is a
 * string, and nothing else. Validation of the VALUE is {@link returnTargetOf}'s
 * job, at the moment it is followed; here it is only carried.
 */
export function returnSearchOf(search: Record<string, unknown>): ReturnSearch {
  const value = search[RETURN_SEARCH_KEY];

  return typeof value === 'string' ? { povratak: value } : {};
}

/**
 * What a signed-out redirect carries for the location it was raised at.
 * Nothing for the bare root, because `/` is where a sign-in lands anyway and a
 * parameter that says so is noise in the address bar.
 */
export function returnSearchFor(href: string): ReturnSearch {
  return href === SIGNED_IN_HOME ? {} : { povratak: href };
}

/**
 * Whether a pathname is one the route tree resolves. An unknown path marks the
 * ROOT match not found (`router.test.ts` pins that), so any `_notFound` in the
 * chain means the tree has no screen for it.
 */
export function knownPathOf(router: RouteMatcher): (pathname: string) => boolean {
  return (pathname) => !router.matchRoutes(pathname, {}).some((match) => match._notFound === true);
}

/**
 * The same-app location a successful sign-in navigates to, or
 * {@link SIGNED_IN_HOME} when the candidate is absent or is not one.
 *
 * Refused, each falling back to `/`: anything that does not start with a single
 * `/` (an absolute URL, `javascript:`, a bare word), a protocol-relative `//`,
 * any backslash (`/\evil` resolves to another host), any control character, a
 * candidate that resolves to another origin, a candidate longer than
 * {@link RETURN_TARGET_MAX_LENGTH}, and a path the tree does not know.
 *
 * THE `//` AND BACKSLASH CHECKS RUN TWICE, on the raw candidate and on the
 * RESOLVED pathname, because dot-segment resolution can manufacture one:
 * `/.//evil.example`, `/kalendar/..//evil.example` and `/%2e%2e//evil.example`
 * all resolve to a pathname starting `//`, which a later navigation could read
 * as protocol-relative. Only the resolved parts are returned, so what
 * navigates is exactly what was checked.
 */
export function returnTargetOf(
  candidate: string | undefined,
  isKnownPath: (pathname: string) => boolean,
): string {
  if (candidate === undefined) return SIGNED_IN_HOME;
  if (candidate.length > RETURN_TARGET_MAX_LENGTH) return SIGNED_IN_HOME;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return SIGNED_IN_HOME;
  if (hasUnsafeCharacter(candidate)) return SIGNED_IN_HOME;

  let resolved: URL;

  try {
    resolved = new URL(candidate, RESOLUTION_BASE);
  } catch {
    return SIGNED_IN_HOME;
  }

  if (resolved.origin !== RESOLUTION_ORIGIN) return SIGNED_IN_HOME;
  if (resolved.pathname.startsWith('//') || resolved.pathname.includes(BACKSLASH)) {
    return SIGNED_IN_HOME;
  }
  if (!isKnownPath(resolved.pathname)) return SIGNED_IN_HOME;

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
