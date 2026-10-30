import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { signOut, type SignOutOutcome } from '@/features/auth/services/sign-out';
import { forgetThisPushDevice } from '@/features/notifications/services/page-push';
import { forgetDeviceSnapshot } from '@/lib/offline/device-snapshot';
import { supabaseClient } from '@/lib/supabase/client';
import { pageSignOutFallback } from '@/lib/supabase/local-sign-out';

/**
 * The end of a session, written once (retro 10 A5). The chrome's *Odjava*,
 * the set-password step's *Odjava* and the other-organization offer on
 * `/prijava/$slug` all run THIS sequence, and each decides only where to go
 * after it and what to say when it fails.
 *
 *   1. STORY 10.4: this device's push goes with the session. Its row is
 *      deleted while the session can still delete it, and the browser
 *      unsubscribed, so the next person signed in here hears nothing meant
 *      for the previous one. BEST-EFFORT: bounded, never throws, never blocks
 *      the sign-out, which runs whatever happened here.
 *   2. The auth sign-out service. A refused sign-out answers its outcome and
 *      NOTHING ELSE runs: the session survived, and a working session's cache
 *      is not thrown away for nothing.
 *   3. EVERY CACHED ANSWER GOES WITH THE SESSION — the shared-device case.
 *      `main.tsx` builds one `QueryClient` for the page load, and a client-side
 *      navigation does not reload the page, so without `clear()` the next
 *      person to sign in sees the previous one's role and organization until
 *      each refetch settles. AND THE DEVICE'S COPY (story 8.2): the snapshot
 *      kept in IndexedDB is deleted; started first, so the clear saves
 *      nothing, and awaited, so the caller's navigation never renders over a
 *      copy still on the device (`forget` never rejects).
 *
 * It may still THROW — the client throws its stable code on a build with no
 * environment — and each caller catches that as a failed sign-out.
 */
export function useEndSession(): () => Promise<SignOutOutcome> {
  const queryClient = useQueryClient();

  return useCallback(async (): Promise<SignOutOutcome> => {
    await forgetThisPushDevice();

    const outcome = await signOut(supabaseClient().auth, pageSignOutFallback);

    if (!outcome.ok) return outcome;

    const forgetting = forgetDeviceSnapshot();
    queryClient.clear();
    await forgetting;

    return outcome;
  }, [queryClient]);
}
