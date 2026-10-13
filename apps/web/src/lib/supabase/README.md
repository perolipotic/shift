# `lib/supabase/`

The single browser Supabase client. The synthesized sign-in address and the
credential exchange live in `features/auth/services/`.

There are no generated database types, by decision (2026-10-13,
deferred-work sweep): the client stays untyped. `createClient` takes no
`Database` generic, every query is untyped at the row level, and each service
parses the rows it reads at its own boundary into its own types, so a row that
does not match is refused there. Drift between a migration and a parser is
caught by the database-attached tests and the e2e suite rather than by a
regenerated types file, which would add a step to every migration.

- `client.ts` — the one client, constructed from `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` only. AD-17 keeps `sb_secret_*` out of this
  bundle entirely. A missing variable throws `SUPABASE_ENVIRONMENT_MISSING`
  rather than yielding a client that fails every call like an outage. It also
  holds `sessionReader` — the function `/`'s `beforeLoad` resolves a session
  through, built from an injected source so both of that route's branches are
  executable without a browser — bound as `currentSession` under a time budget
  that rejects a read that never settles, and `resolvedSession`, the one
  session read every guard shares (a rejection becomes `null`, logged).
- `session-cache.ts` — the app-wide rule `main.tsx` installs: whenever the
  signed-in user id changes or becomes null (another tab, an expiry, a sign-in
  over a stale cache), the cache forgets the previous user so that mounted
  screens see it (a reset on a switch, a clear on a sign-out or sign-in) and
  the router re-runs every guard (not on a sign-in, which the sign-in hook
  navigates). A token refresh for the same user changes nothing.
  `session-cache.test.ts` drives it with a real `QueryClient` and observer.

- `features/auth/services/address.ts` — AD-12's synthesized sign-in address,
  `username@slug.shift.invalid`, and the DNS-label rule the `organizations`
  table applies to the slug. The one home for that expression on this side;
  `supabase/seed.sql` builds the same string in SQL.
- `features/auth/services/sign-in.ts` — credentials in, a session or one stable code out. A wrong
  password, an unknown username and a deactivated account collapse to a single
  code on purpose: the sign-in screen is reachable by anyone, and three
  distinguishable answers would tell an anonymous caller which usernames exist.

Every domain read and write goes through PostgREST under RLS; the one exception
is the `admin-auth` Edge Function, invoked for user creation, user update and
the admin-issued password reset. Deactivation is an ordinary PostgREST insert
into `member_status_versions` (story 1.6), and cancelling a scheduled change is
a PostgREST delete of that version.
