import { Outlet, createRootRoute } from '@tanstack/react-router';

import { NotFoundScreen } from '@/routes/not-found';

/**
 * The application shell: structure only.
 *
 * It stays text-free, and deliberately so. The two-layout / one-architecture
 * navigation (bottom tabs on mobile, sidebar on desktop) needs a role-keyed
 * destination table and nine `nav.*` labels, and its destinations become
 * role-dependent in story 1.3 — so it is its own spec rather than part of this
 * one, and the shell holds nothing but the outlet until it lands. What it does
 * own is the not-found case: AD-14 has the host answer every path with
 * `index.html` at 200, so the client decides a path is unknown, and
 * `notFoundComponent` here is the only shape that decides it without adding a
 * route (see `not-found.tsx`).
 */
function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Outlet />
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundScreen,
});
