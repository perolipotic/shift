/**
 * The destinations that read offline (story 8.2): *Danas* and *Kalendar*.
 * Their guards — `_app`'s, and `/`, which forwards to *Danas* — read the
 * session FOR READING (`@/lib/supabase/offline-session`), so an offline start
 * with an expired token opens them on the device's snapshot. The rest follow
 * in 8.2b. Kept here, not in a route module, so the paths are data rather than
 * literals on a screen.
 */
export const OFFLINE_READABLE_PATHS: ReadonlySet<string> = new Set(['/danas', '/kalendar']);

/** Whether `pathname` is an offline-readable destination; a trailing slash (`/danas/`) is the same path. */
export function readsOffline(pathname: string | undefined): boolean {
  return pathname !== undefined && OFFLINE_READABLE_PATHS.has(pathname.replace(/\/+$/, ''));
}
