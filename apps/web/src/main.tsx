import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import { i18n, initLocalization } from '@/i18n';
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
await initLocalization();

createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>
  </StrictMode>,
);
