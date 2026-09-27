import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { I18nextProvider } from 'react-i18next';

import { i18n } from '@/lib/i18n';
import { router } from '@/router';

/**
 * The application's providers. The query client is RECEIVED, never built here:
 * `main.tsx` builds the one cache for the page load (AD-13) and mounts this
 * only inside its localization boot gate (story 1.1c).
 */
export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <I18nextProvider i18n={i18n}>
      {/* INSIDE the localization provider and OUTSIDE the router: a query
          hook is called from a route component, so the cache has to be an
          ancestor of `RouterProvider` or `useQuery` throws at first render on
          the one screen that reads data. */}
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  );
}
