import { QueryClient } from '@tanstack/react-query';

// The one query cache (story 1.4a, AD-13). Built in this module, once, rather than at the seam
// that uses it (`App.tsx` receives it and holds the providers; the router's
// role guards read the chrome's role entry from it, `router.ts`), for the
// reason exactly one Supabase client is built: a second cache is a second set
// of query keys, and two caches holding `['organization']` is the
// stale-total-beside-a-fresh-one failure AD-13 exists to prevent — with the
// added twist that neither one looks wrong on its own.
//
// No client defaults. The caching and the refetch on focus and on reconnect
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
