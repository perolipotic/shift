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
        <RouterProvider router={router} />
      </I18nextProvider>
    </StrictMode>,
  );
}
