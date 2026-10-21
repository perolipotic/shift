/**
 * The destinations that read offline, as ROUTE PATTERNS (stories 8.2, 8.2b):
 * `/` (which forwards to *Danas*), *Danas*, *Kalendar*, *Sati*, *Godišnji*,
 * *Ljudi* (the admin's table and the members' directory) and one team's
 * roster, `/smjene/$id`. Their guards — `_app`'s, and `/`'s — read the session
 * FOR READING (`@/lib/supabase/offline-session`), so an offline start with an
 * expired token opens them on the device's snapshot. The rest follow in 8.2c.
 * Kept here, not in a route module, so the paths are data rather than literals
 * on a screen.
 *
 * A segment written `$name` matches any one non-empty segment, as the router's
 * own path parameters do.
 */
export const OFFLINE_READABLE_PATHS: readonly string[] = [
  '/',
  '/danas',
  '/kalendar',
  '/sati',
  '/godisnji',
  '/ljudi',
  '/smjene/$id',
];

/** A pattern's segments, or a pathname's: `/` is the one with none. */
function segmentsOf(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/**
 * Whether `given`'s segments fill `pattern`'s, a `$` segment taking any one.
 * CASE-INSENSITIVE, as the router matches a path (`caseSensitive` is off), so
 * `/Sati` is *Sati* here as it is there.
 */
function matches(pattern: string, given: readonly string[]): boolean {
  const wanted = segmentsOf(pattern);

  return (
    wanted.length === given.length &&
    wanted.every((segment, index) =>
      segment.startsWith('$') ? true : segment.toLowerCase() === given[index]?.toLowerCase(),
    )
  );
}

/**
 * Whether `pathname` is an offline-readable destination. Normalised once: a
 * trailing slash (`/danas/`) is the same path. Anything longer than a pattern
 * (`/ljudi/novi`) is not, and neither is a path with an empty segment
 * (`//danas`, `/smjene//x`), which names no route.
 */
export function readsOffline(pathname: string | undefined): boolean {
  if (pathname === undefined) return false;

  const normalised = pathname.replace(/\/+$/, '');

  if (normalised.includes('//')) return false;

  const given = segmentsOf(normalised);

  return OFFLINE_READABLE_PATHS.some((pattern) => matches(pattern, given));
}
