import { QueryClient } from '@tanstack/react-query';

import { DEVICE_SNAPSHOT_GC_TIME_MS, PERSISTED_KEY_ROOTS } from '@/lib/offline/persistence';

// The one query cache (story 1.4a, AD-13). Built in this module, once, rather than at the seam
// that uses it (`App.tsx` receives it and holds the providers; the router's
// role guards read the chrome's role entry from it, `router.ts`), for the
// reason exactly one Supabase client is built: a second cache is a second set
// of query keys, and two caches holding `['organization']` is the
// stale-total-beside-a-fresh-one failure AD-13 exists to prevent — with the
// added twist that neither one looks wrong on its own.
//
// ONE DEFAULT PER KEPT KEY, since story 8.2: the keys kept on the device
// (`PERSISTED_KEY_ROOTS`) are collected after `DEVICE_SNAPSHOT_GC_TIME_MS` —
// the snapshot's `maxAge` (30 days) as near as a browser timer can hold it,
// about 24.8 days, since a longer delay overflows `setTimeout`, which then
// collects every restored entry AT ONCE. TanStack's 5-minute default would
// collect an unobserved kept entry — a screen not open right now — and drop
// it from the next save long before the kept copy expires, so a member who
// read *Kalendar* an hour ago would find nothing to read offline. Every other
// query keeps the 5-minute default: nothing else is kept, so nothing else is
// held. (`setQueryDefaults` matches by prefix, so a longer key under a kept
// root — the logo URL, an erasure check — is held as long; it is never saved.)
//
// Otherwise no client defaults. The caching and the refetch on focus and on reconnect
// are what a settings surface wants, and TanStack's `retry: 3` is left as it
// is — but it does nothing for the organization read, because
// `readOrganization` NEVER rejects: every failure is folded into
// `{ ok: false, code }`, which `useQuery` sees as a resolved value and therefore
// as a success. That is deliberate (a code is what the edge translates, and a
// thrown error is not), so it is written down rather than left to be
// rediscovered by somebody wondering why a failed read was not retried. The
// teams, members and hour-band lists DO reject on an unavailable read (their
// query options, `teamsQueryOptions` and its siblings, rethrow the code, so a
// failed refetch keeps the cached rows), and each sets its own `retry: 1`.
// Any future query that rejects without stating its own `retry` gets the
// default 3. A `staleTime` chosen here would be a different thing: a decision
// made once for every later surface by whoever happened to write this line
// first. A surface that needs a different policy states it on its own query.
export const queryClient = new QueryClient();

for (const root of PERSISTED_KEY_ROOTS) queryClient.setQueryDefaults([root], { gcTime: DEVICE_SNAPSHOT_GC_TIME_MS });
