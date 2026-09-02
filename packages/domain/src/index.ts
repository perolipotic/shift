/**
 * The pure scheduling engine (AD-7).
 *
 * Zero runtime dependencies: projection, rosters, bands, hours, leave,
 * collisions and warnings all land here from Epic 2 onward. Nothing in this
 * package may import React, the Supabase client, or any other runtime package —
 * `packages/domain/package.json` declares no `dependencies`, so such an import
 * is an unresolvable module and fails the build.
 *
 * The engine returns keys, codes and values only — never a formatted or
 * translated string.
 */

/** Marks this package as present and buildable. Replaced by real exports in Epic 2. */
export const DOMAIN_PACKAGE_NAME = '@shift/domain';
