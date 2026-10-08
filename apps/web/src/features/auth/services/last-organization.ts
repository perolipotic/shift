import { organizationDestination } from '@/features/auth/services/address';

/**
 * The last organization signed into on this device (story 7.7).
 *
 * Bare `/prijava` has no slug in its URL, and the person who reaches it most
 * often is the one who just signed out. Their organization's slug is already on
 * the DVD's public link, so prefilling it from this device discloses nothing,
 * and it saves them retyping it on every visit.
 *
 * WHAT IS STORED, AND WHEN, is the whole of the rule:
 *
 *   - Only the normalized slug. No username, no password, nothing per person.
 *   - Only after a SUCCESSFUL sign-in, so a typo is never remembered.
 *   - A stored value `organizationDestination` refuses reads as empty, so a
 *     tampered or stale entry can never prefill a value the form would refuse.
 *
 * The `Storage` is a PARAMETER (AD-15), so the node suite runs every branch on
 * a fake with nothing in a browser. Every access sits in a `try`/`catch`, as
 * `lib/theme.ts` does: a private window, blocked site data or a full quota
 * throw on `getItem` or `setItem`, and a sign-in screen must never fail because
 * of a convenience. Unreadable storage reads as "nothing remembered", and an
 * unwritable one simply remembers nothing.
 */

/** The one key this module writes. */
export const LAST_ORGANIZATION_KEY = 'shift.lastOrganization';

/** What a read gives back when nothing usable is stored. */
export const NOTHING_REMEMBERED = '';

/** The remembered slug, or `''` when there is none usable or storage refuses. */
export function read(storage: Storage | null): string {
  if (storage === null) return NOTHING_REMEMBERED;

  try {
    const stored = storage.getItem(LAST_ORGANIZATION_KEY);

    if (stored === null) return NOTHING_REMEMBERED;

    return organizationDestination(stored) ?? NOTHING_REMEMBERED;
  } catch {
    return NOTHING_REMEMBERED;
  }
}

/**
 * Remembers the organization a sign-in has just succeeded under, normalized.
 * A value that cannot be a slug is not written: `signIn` refuses it before any
 * request, so it can never reach a successful sign-in anyway.
 */
export function remember(storage: Storage | null, slug: string): void {
  const organization = organizationDestination(slug);

  if (storage === null || organization === null) return;

  try {
    storage.setItem(LAST_ORGANIZATION_KEY, organization);
  } catch {
    // Unremembered is still signed in: the next visit simply asks again.
  }
}

/**
 * This device's storage, or `null` when the browser refuses it.
 *
 * Reading `localStorage` itself can throw (a `SecurityError` when site data is
 * blocked), so even the accessor is guarded. It lives HERE rather than in the
 * hook because the sign-in screen's parts may not name `localStorage` at all
 * (`prijava.test.ts`): the screen asks this module, and this module is the one
 * place the browser's storage is touched.
 */
export function deviceStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
