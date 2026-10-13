/**
 * Logged with the cause when a route fails and the root error screen renders
 * (A148, `pages/error.tsx`). A stable code, never shown: the screen says only
 * that something failed, and the console is where the cause goes.
 */
export const ROUTE_FAILED = 'ROUTE_FAILED';

/** Reports a failed route's cause to the console under {@link ROUTE_FAILED}. */
export function reportRouteFailure(cause: unknown): void {
  console.error(ROUTE_FAILED, cause);
}
