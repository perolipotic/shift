import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useRef, useState } from 'react';

import { useEndSession } from '@/features/auth/hooks/use-end-session';
import {
  failureOfSwitch,
  ORGANIZATION_SWITCH_STAY_FAILED,
  runOrganizationSwitch,
  type OrganizationSwitch,
} from '@/features/auth/services/organization-switch';
import { SIGN_OUT_FAILED, type SignOutFailure } from '@/features/auth/services/sign-out';

/**
 * The other-organization offer's state and its two exits (retro 10 A5): a
 * signed-in visitor opened `/prijava/<B>` while signed in to A.
 *
 * SWITCHING NEVER SIGNS IN ON TOP OF A LIVE SESSION. It runs the full session
 * end first — this device's push forgotten, the sign-out, the cache and the
 * device's kept snapshot cleared (`useEndSession`, the chrome's own sequence)
 * — so nothing of A survives into B. Only once the session ended does it open
 * B's form, keeping the link's `povratak`; the route's guard then finds no
 * session and renders the form. A refused sign-out keeps A's session and says
 * so; nothing navigates.
 *
 * STAYING goes to `/` in A, which forwards to the landing destination. The
 * link's `povratak` is B's path and is NOT followed in A: that is the silent
 * redirect this offer replaces.
 *
 * The in-flight ref refuses a second press, as every handler here does.
 */
export function useOrganizationSwitch(offer: OrganizationSwitch) {
  const navigate = useNavigate();
  const router = useRouter();
  // NOT STRICT, as the sign-in hook: no route id spelt here.
  const { povratak } = useSearch({ strict: false });
  const endSession = useEndSession();
  const leaving = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<SignOutFailure | null>(null);

  async function switchOrganization(): Promise<void> {
    if (leaving.current) return;

    leaving.current = true;
    setFailure(null);
    setPending(true);

    try {
      const target = {
        to: '/prijava/$slug',
        params: { slug: offer.target },
        search: povratak === undefined ? {} : { povratak },
        replace: true,
      } as const;
      const outcome = await runOrganizationSwitch({
        endSession,
        openTarget: async () => {
          await navigate(target);
          // THE SAME URL, most often (the link already named B and its
          // `povratak`), so the guard is asked again explicitly: with no
          // session now, it renders B's form in place of this offer.
          await router.invalidate();
        },
        // Signed out, but the in-app navigation failed: a whole-document
        // load, so nobody is left on an offer naming a session that ended.
        reloadTarget: async () => {
          await navigate({ ...target, reloadDocument: true });
        },
        log: (cause) => {
          console.error(SIGN_OUT_FAILED, cause);
        },
      });

      const refused = failureOfSwitch(outcome);

      if (refused !== null) setFailure(refused);
    } finally {
      leaving.current = false;
      setPending(false);
    }
  }

  async function stay(): Promise<void> {
    if (leaving.current) return;

    try {
      await navigate({ to: '/' });
    } catch (cause) {
      // Logged, never an unhandled rejection: the person is still signed in
      // to A and can press again.
      console.error(ORGANIZATION_SWITCH_STAY_FAILED, cause);
    }
  }

  return {
    current: offer.current,
    target: offer.target,
    pending,
    failure,
    switchOrganization,
    stay,
  };
}

/** What the offer is drawn from. */
export type OrganizationSwitchState = ReturnType<typeof useOrganizationSwitch>;
