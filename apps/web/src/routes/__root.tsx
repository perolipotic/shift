import { Outlet, createRootRoute } from '@tanstack/react-router';

/**
 * The application shell: structure only.
 *
 * No navigation, no theme token and no text of any kind. The two-layout / one-
 * architecture navigation (bottom tabs on mobile, sidebar on desktop) needs
 * destination labels, so it arrives with the localization and theme layers in
 * story 1.1b, and its destinations become role-dependent in story 1.3.
 */
function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Outlet />
    </div>
  );
}

export const rootRoute = createRootRoute({ component: AppShell });
