import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  LOGO_URL_STALE_MS,
  ORGANIZATION_LOGO_BUCKET,
  organizationLogoKey,
  readOrganizationLogoUrl,
  type LogoUrlOutcome,
} from '@/organization/logo';
import { supabaseClient } from '@/supabase/client';

/**
 * The one signed-URL read behind every lockup (story 1.4c).
 *
 * WHY THIS IS A MODULE AND NOT TWO COPIES. The settings surface and the
 * navigation chrome both render the lockup, and both need the same four
 * decisions to reach it: the derived query key, the cache bound that keeps a
 * capability from outliving its expiry, the refusal that must not be retried,
 * and the URL that failed to LOAD, which no timer predicts. Written twice they
 * were kept in step by a test looping over two files — and worse, two
 * `queryFn`s were registered for one query key, so whichever surface mounted
 * first owned the fetch and the other's version of the four decisions was dead
 * code that looked live. One hook is one registration.
 *
 * DERIVED, NEVER INDEPENDENT (AD-13). The key is
 * {@link ORGANIZATION_SNAPSHOT_KEY}'s own with the path appended
 * (`organizationLogoKey`), the path comes FROM the snapshot the caller already
 * holds, and the fetch is skipped entirely when there is no logo — absence is a
 * column, not a probe. So invalidating the snapshot's key after a write
 * refreshes the row and the rendered logo together, on both surfaces at once.
 *
 * REPORTED ONCE, NOT PER RENDER. The logging lives in the query function rather
 * than beside the element, which is what makes "reported once, not per layout"
 * true: the chrome renders the lockup into two bars, so a `console.error`
 * written at the call site fires twice at every width where both are in the
 * tree. The failure never reaches a message region either — a reference that
 * resolves to nothing and no reference at all are the same thing to look at,
 * and `@/organization/logo` explains why the service cannot tell them apart —
 * but silence is how a misconfigured bucket stays undiagnosed, so it is logged
 * where somebody who can act on it looks.
 */

export interface RenderableLogo {
  /** A URL the browser is known to be able to render, or `null` for the mark. */
  readonly url: string | null;
  /** Called when the browser fails to load a URL that signed successfully. */
  readonly onUnrenderable: () => void;
}

/**
 * A signed URL for the logo a snapshot points at, or nothing to point at.
 *
 * Separate from the hook so the failure path is an ordinary function: it is
 * what logs, and a hook body is not somewhere a test can reach.
 */
async function signedLogoUrl(path: string | null): Promise<LogoUrlOutcome | null> {
  if (path === null) return null;

  const outcome = await readOrganizationLogoUrl(
    supabaseClient().storage.from(ORGANIZATION_LOGO_BUCKET),
    path,
  );

  if (!outcome.ok) console.error(outcome.code, path);

  return outcome;
}

export function useRenderableLogo(logoPath: string | null): RenderableLogo {
  // WHICH URL failed to load, not merely THAT one did. A boolean would stay
  // true across the next signed URL and hide a logo that renders perfectly;
  // holding the URL means the fallback clears itself the moment a different one
  // arrives, which is what a refetch after an expiry produces.
  const [unrenderable, setUnrenderable] = useState<string | null>(null);

  const logo = useQuery({
    queryKey: organizationLogoKey(logoPath),
    queryFn: () => signedLogoUrl(logoPath),
    // ABSENCE IS A COLUMN, NOT A PROBE. With no logo there is nothing to sign,
    // and asking storage anyway would be a network read behind a value the
    // snapshot already carries.
    enabled: logoPath !== null,
    // NO RETRIES. A refused read is settled, not slow: retrying it costs three
    // storage calls per mount — on every signed-in screen, since the chrome
    // renders everywhere — and answers the same 404 each time, leaving a
    // persistently failing read indistinguishable from an organization that
    // simply has no logo for as long as the backoff lasts.
    retry: false,
    // BELOW THE EXPIRY the signed URL carries, so a tab left open across the
    // hour refetches instead of rendering a dead capability.
    staleTime: LOGO_URL_STALE_MS,
  });

  const signed = logo.data ?? null;
  const readable = signed !== null && signed.ok ? signed.url : null;

  return {
    url: readable === unrenderable ? null : readable,
    onUnrenderable: () => {
      setUnrenderable(readable);
    },
  };
}
