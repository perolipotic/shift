import { onlineManager } from '@tanstack/react-query';

import { freshnessTracker } from '@/lib/offline/freshness';

/**
 * The page's one freshness clock (story 8.2), over TanStack Query's
 * `onlineManager`. Built at import — `main.tsx` imports it before anything
 * reads — so `freshAfter` starts at the app's start; `main.tsx` starts it
 * once the online state is seeded. The rule is `./freshness`'s, which the
 * node suite executes with an injected online source (AD-15).
 */
export const appFreshness = freshnessTracker(onlineManager);
