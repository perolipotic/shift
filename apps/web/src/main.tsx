import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { initLocalization } from '@/lib/i18n';
import { queryClient } from '@/lib/query-client';
import { bootLocalization } from '@/lib/i18n/boot';
import { supabaseClient } from '@/lib/supabase/client';
import { resetOnSessionChange } from '@/lib/supabase/session-cache';
import { router } from '@/router';

import '@/index.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  // Stable code, not a user-facing string — translation happens only at the edge.
  throw new Error('ROOT_ELEMENT_MISSING');
}

// ONE RULE FOR THE WHOLE PAGE LOAD: whenever the signed-in user changes or
// signs out, from this tab or another, or by expiry, the cache forgets the
// previous user in a way every mounted screen sees, and the router re-runs
// every guard for the new one. The chrome's sign-out still clears on its own;
// this covers every change no click here makes. The three transitions, and why
// a token refresh changes nothing, are `@/lib/supabase/session-cache`, which
// the node suite executes.
resetOnSessionChange(() => supabaseClient().auth, { cache: queryClient, router });

// Initialization is awaited before the first render (story 1.1c). Resources are
// bundled, so this resolves in a microtask rather than over the network — but
// awaiting it is what keeps every surface free of a "not ready yet" branch and
// keeps `⟦key⟧` meaning "this key is missing" rather than "the store is empty".
//
// The decision itself lives in `@/lib/i18n/boot` so the node suite can EXECUTE it
// (`boot.test.ts`) rather than read this file for the shape of a guard — a
// review mutation rewrote exactly this as `try`/`catch` around the render,
// mounting on a failed init and painting `⟦key⟧` over every string, with the
// whole suite green. Nothing but the branch belongs here: on `false` the static
// Croatian fallback in `index.html` stays on screen, which is the only message
// available when the translation layer is what failed.
if (await bootLocalization(initLocalization)) {
  createRoot(rootElement).render(
    <StrictMode>
      <App queryClient={queryClient} />
    </StrictMode>,
  );
}
