/**
 * The destinations that read offline, as ROUTE PATTERNS (stories 8.2, 8.2b,
 * 8.2c, 8.2d): `/` (which forwards to *Danas*), *Danas*, *Kalendar*, *Sati*,
 * *Godišnji*, *Ljudi* (the admin's table and the members' directory), one
 * team's roster `/smjene/$id`, the admin's work surfaces (story 8.2c):
 * *Za odluku* (and its old `/raspored` URLs, story 9.1), one conflict's
 * resolution page and one member's page, and the
 * settings surfaces (story 8.2d): *Ljudi/smjene*, *Organizacija*, *Satni
 * pojasi* and *Postavke rotacije*, each with its `$id` editor. Every surface
 * now reads offline. Their guards — `_app`'s, and `/`'s — read the session
 * FOR READING (`@/lib/supabase/offline-session`), so an offline start with an
 * expired token opens them on the device's snapshot. Kept here, not in a
 * route module, so the paths are data rather than literals on a screen.
 *
 * A segment written `$name` matches any one non-empty segment, as the router's
 * own path parameters do — except a STATIC SIBLING route (below).
 */
export const OFFLINE_READABLE_PATHS: readonly string[] = [
  '/',
  '/danas',
  '/kalendar',
  '/sati',
  '/godisnji',
  '/ljudi',
  '/smjene/$id',
  '/za-odluku',
  '/za-odluku/$memberId/$date/$teamId',
  // Story 9.1: the queue's old URLs, which only redirect to the pair above.
  // Listed so an old bookmark opened offline with an expired token still
  // reaches *Za odluku* rather than the sign-in.
  '/raspored',
  '/raspored/$memberId/$date/$teamId',
  '/ljudi/$id',
  '/ljudi/smjene',
  '/ljudi/smjene/$id',
  '/organizacija',
  '/organizacija/satni-pojasi',
  '/organizacija/satni-pojasi/$id',
  '/postavke-rotacije',
  '/postavke-rotacije/tipovi-smjena/$id',
];

/**
 * The STATIC routes registered beside a `$` segment of a pattern above (story
 * 8.2c): the router matches a static segment before a parameter, so
 * `/ljudi/novi` is its own screen, never a member page, and `$` never reads
 * it offline. (`/ljudi/smjene` was one too, until story 8.2d listed it.)
 * `router.test.ts` derives these siblings from the router's own
 * `routesByPath` — less any route listed in {@link OFFLINE_READABLE_PATHS}
 * itself — and pins this list to them, so a new static route beside a
 * pattern cannot slip in as offline-readable.
 *
 * HOW A SIBLING BECOMES READABLE (as `/ljudi/smjene` did in story 8.2d): list
 * it in {@link OFFLINE_READABLE_PATHS} and take it off this list. A listed
 * static path wins over this list anyway (`readsOfflineAmong`), so the order
 * of the two edits never matters.
 */
export const OFFLINE_UNREADABLE_SIBLINGS: readonly string[] = ['/ljudi/novi'];

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

/** A pattern with no `$` segment: one exact route. */
function isStatic(pattern: string): boolean {
  return !segmentsOf(pattern).some((segment) => segment.startsWith('$'));
}

/**
 * {@link readsOffline} over given lists (exported for its test): a path
 * listed EXACTLY among `readable` (a static pattern) reads offline even when
 * it is also among `unreadable` — an explicit listing wins over the sibling
 * exclusion; otherwise an `unreadable` sibling does not, and a `readable`
 * pattern does.
 */
export function readsOfflineAmong(
  pathname: string | undefined,
  readable: readonly string[],
  unreadable: readonly string[],
): boolean {
  if (pathname === undefined) return false;

  const normalised = pathname.replace(/\/+$/, '');

  if (normalised.includes('//')) return false;

  const given = segmentsOf(normalised);

  if (readable.some((pattern) => isStatic(pattern) && matches(pattern, given))) return true;
  if (unreadable.some((sibling) => matches(sibling, given))) return false;

  return readable.some((pattern) => matches(pattern, given));
}

/**
 * Whether `pathname` is an offline-readable destination. Normalised once: a
 * trailing slash (`/danas/`) is the same path. Anything longer than a pattern
 * (`/smjene/x/y`) is not, nor is a static sibling of a pattern (`/ljudi/novi`,
 * {@link OFFLINE_UNREADABLE_SIBLINGS}) unless it is listed itself, nor a path
 * with an empty segment (`//danas`, `/smjene//x`), which names no route.
 */
export function readsOffline(pathname: string | undefined): boolean {
  return readsOfflineAmong(pathname, OFFLINE_READABLE_PATHS, OFFLINE_UNREADABLE_SIBLINGS);
}
