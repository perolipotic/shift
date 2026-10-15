import { formatIsoDate } from '@/lib/i18n/format';

/**
 * Two small pieces of text every screen shares (AD-15): the empty string,
 * named, and a date the way the screens show one. They lived in the members
 * feature first and are imported from here by every feature that needs them.
 */

/**
 * The empty string, NAMED.
 *
 * `pages/ljudi.tsx` may hold no string literal of its own — `pages/literal-sweep.test.ts`
 * sweeps every screen for a literal that is neither a `t()` key nor a
 * structural attribute value, and an empty one is still one. Two things on that
 * surface are nothing at all: the search a freshly opened list carries, and the
 * cell of a member with no address. Both are this, and so is every other
 * field's empty default.
 */
export const NO_TEXT = '';

/**
 * An ISO date the way the screens show one — `23.09.2026` — or the value
 * unchanged if it is not a real calendar date, so a malformed value is still
 * visibly the value that was entered rather than a blank.
 */
export function shownDate(isoDate: string): string {
  return formatIsoDate(isoDate) ?? isoDate;
}
