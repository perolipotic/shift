/**
 * The root's custom property that holds the phone's sticky head's height
 * (`StickyHead`, deferred-work E816): `index.css` reads it for the page's
 * scroll padding, and the calendar's grid for its scroller's bound.
 */
export const STICKY_HEAD_HEIGHT_VAR = '--sticky-head';

/**
 * A measured height as the property's value: whole pixels, rounded UP so a
 * sub-pixel head is never under-cleared, and `0px` for anything that is not
 * a finite, positive number (a head not drawn).
 */
export function stickyHeadHeightOf(height: number): string {
  return Number.isFinite(height) && height > 0 ? `${String(Math.ceil(height))}px` : '0px';
}
