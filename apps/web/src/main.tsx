import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { onlineManager } from '@tanstack/react-query';

import { App } from '@/App';
import { initLocalization } from '@/lib/i18n';
import { queryClient } from '@/lib/query-client';
import { bootLocalization } from '@/lib/i18n/boot';
import { appFreshness } from '@/lib/offline/app-freshness';
import { pageDeviceSnapshot, restoreForSession } from '@/lib/offline/device-snapshot';
import { persistsKey } from '@/lib/offline/persistence';
import { supabaseClient } from '@/lib/supabase/client';
import { bootSessionState, offlineSessionUser, restoreForBoot } from '@/lib/supabase/offline-session';
import { resetOnSessionChange, sessionEnded } from '@/lib/supabase/session-cache';
import { router } from '@/router';

import '@/index.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  // Stable code, not a user-facing string — translation happens only at the edge.
  throw new Error('ROOT_ELEMENT_MISSING');
}

// OFFLINE READING (story 8.2), before anything reads.
//
// The online state is SEEDED from the browser: TanStack Query assumes it is
// online until an `offline` event arrives, so an app started with no
// connection would fetch, fail and show every surface unavailable instead of
// its cached snapshot. Then the freshness clock follows it: a reconnect moves
// `freshAfter`, and every SURFACE answer read before it — the kept keys
// alone, never an erasure check or a logo URL — is invalidated, so each
// surface keeps its cached snapshot under the as-of note until its reads are
// fresh again: an observed read refetches now, any other when it is next
// observed.
onlineManager.setOnline(navigator.onLine);
// The stop is kept: a hot reload in development disposes it, so the module
// evaluated again follows the connection once; in a build it lives with the
// page. `start` is idempotent besides, so no second call can follow twice.
const stopFreshness = appFreshness.start((freshAfter) => {
  void queryClient.invalidateQueries(
    {
      predicate: (query) =>
        persistsKey(query.queryKey) && query.state.data !== undefined && query.state.dataUpdatedAt < freshAfter,
    },
    { cancelRefetch: false },
  );
});
import.meta.hot?.dispose(stopFreshness);

// The device's copy of the cache is restored BEFORE the first render, and only
// for the local session's own user: no session, another user or an expired
// copy deletes it (`@/lib/offline/persistence`). The session is read FOR
// READING (`@/lib/supabase/offline-session`): offline, an expired token that
// cannot be refreshed is still its user, never a sign-out. Only a CONFIRMED
// nobody deletes the copy; a read left unresolved within its short budget
// (a time-out, a retryable failure online) neither restores nor deletes —
// the app renders, and the session events reconcile. Both the session read
// and the restore are bounded, so neither a pending refresh nor a hung
// IndexedDB holds the first render. Never rejects.
await restoreForBoot(bootSessionState, restoreForSession);

// ONE RULE FOR THE WHOLE PAGE LOAD: whenever the signed-in user changes or
// signs out, from this tab or another, or by expiry, the cache forgets the
// previous user in a way every mounted screen sees, and the router re-runs
// every guard for the new one. The chrome's sign-out still clears on its own;
// this covers every change no click here makes. The three transitions, and why
// a token refresh changes nothing, are `@/lib/supabase/session-cache`, which
// the node suite executes. The device's copy follows the same changes.
resetOnSessionChange(() => supabaseClient().auth, {
  cache: queryClient,
  router,
  ended: sessionEnded,
  device: pageDeviceSnapshot,
  offlineUser: offlineSessionUser,
});

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
