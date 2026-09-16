import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import { i18n, initLocalization } from '@/i18n';
import { bootLocalization } from '@/i18n/boot';
import { router } from '@/router';

import '@/index.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  // Stable code, not a user-facing string — translation happens only at the edge.
  throw new Error('ROOT_ELEMENT_MISSING');
}

// The one query cache (story 1.4a, AD-13). Built here rather than at the seam
// that uses it, for the reason exactly one Supabase client is built: a second
// cache is a second set of query keys, and two caches holding `['organization']`
// is the stale-total-beside-a-fresh-one failure AD-13 exists to prevent — with
// the added twist that neither one looks wrong on its own.
//
// No default options, and one of TanStack's does not apply at all. The caching
// and the refetch on focus and on reconnect are what a settings surface wants;
// the `retry: 3` default is inert here, because `readOrganization` NEVER
// rejects — every failure is folded into `{ ok: false, code }`, which `useQuery`
// sees as a resolved value and therefore as a success. That is deliberate (a
// code is what the edge translates, and a thrown error is not), so it is written
// down rather than left to be rediscovered by somebody wondering why a failed
// read was not retried. A `staleTime` chosen here would be a different thing: a
// decision made once for every later surface by whoever happened to write this
// line first. A surface that needs a different policy states it on its own query.
const queryClient = new QueryClient();

// Initialization is awaited before the first render (story 1.1c). Resources are
// bundled, so this resolves in a microtask rather than over the network — but
// awaiting it is what keeps every surface free of a "not ready yet" branch and
// keeps `⟦key⟧` meaning "this key is missing" rather than "the store is empty".
//
// The decision itself lives in `@/i18n/boot` so the node suite can EXECUTE it
// (`boot.test.ts`) rather than read this file for the shape of a guard — a
// review mutation rewrote exactly this as `try`/`catch` around the render,
// mounting on a failed init and painting `⟦key⟧` over every string, with the
// whole suite green. Nothing but the branch belongs here: on `false` the static
// Croatian fallback in `index.html` stays on screen, which is the only message
// available when the translation layer is what failed.
if (await bootLocalization(initLocalization)) {
  createRoot(rootElement).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        {/* INSIDE the localization provider and OUTSIDE the router: a query
            hook is called from a route component, so the cache has to be an
            ancestor of `RouterProvider` or `useQuery` throws at first render on
            the one screen that reads data. */}
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>
    </StrictMode>,
  );
}
