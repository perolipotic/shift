# `supabase/`

The generated database types and the single browser Supabase client.

- `client.ts` — the one client, constructed from `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` only. AD-17 keeps `sb_secret_*` out of this
  bundle entirely. A missing variable throws `SUPABASE_ENVIRONMENT_MISSING`
  rather than yielding a client that fails every call like an outage. It also
  holds `sessionReader` — the function `/`'s `beforeLoad` resolves a session
  through, built from an injected source so both of that route's branches are
  executable without a browser.

- `address.ts` — AD-12's synthesized sign-in address,
  `username@slug.shift.invalid`, and the DNS-label rule the `organizations`
  table applies to the slug. The one home for that expression on this side;
  `supabase/seed.sql` builds the same string in SQL.
- `sign-in.ts` — credentials in, a session or one stable code out. A wrong
  password, an unknown username and a deactivated account collapse to a single
  code on purpose: the sign-in screen is reachable by anyone, and three
  distinguishable answers would tell an anonymous caller which usernames exist.

Every domain read and write goes through PostgREST under RLS; the one exception
is the `admin-auth` Edge Function, invoked for user creation, user update and
ban/unban.
