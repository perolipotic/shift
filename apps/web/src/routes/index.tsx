import { createRoute } from '@tanstack/react-router';

import { rootRoute } from '@/routes/__root';

/** The shell's only destination for now. Renders no text (story 1.1b). */
function IndexScreen() {
  return <main className="flex-1" />;
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexScreen,
});
