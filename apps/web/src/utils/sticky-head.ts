/**
 * The root's custom property that holds what the phone's sticky head covers
 * (`StickyHead`, deferred-work E816): `index.css` reads it for the page's
 * scroll padding, and the calendar's grid for its scroller's bound.
 */
export const STICKY_HEAD_HEIGHT_VAR = '--sticky-head';

/**
 * The room the head's one-line filter summary takes under it once the filter
 * bar has scrolled away: a 16 px `text-xs` line, 4 px above and below, and a
 * 1 px border.
 */
export const STICKY_SUMMARY_PX = 25;

/**
 * What the head covers, as the property's value: its measured height, plus
 * the summary line's room where it has one to show — counted whether or not
 * it shows right now, so the value never changes while the page scrolls —
 * in whole pixels rounded UP, so the head is never under-cleared; `0px` for
 * a height that is not a finite, positive number (a head not drawn).
 */
export function stickyHeadHeightOf(height: number, withSummary = false): string {
  if (!Number.isFinite(height) || height <= 0) return '0px';

  return `${String(Math.ceil(height) + (withSummary ? STICKY_SUMMARY_PX : 0))}px`;
}

/**
 * Whether the filter bar under the head has scrolled up under it, by their
 * bottom edges in the viewport: once the bar's bottom is at or above the
 * head's, the bar is out of sight and the head shows its summary.
 */
export function filtersCoveredBy(headBottom: number, filtersBottom: number): boolean {
  return filtersBottom <= headBottom;
}
