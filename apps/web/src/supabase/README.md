# `supabase/`

The generated database types and the single browser Supabase client (story 1.3).

The client is constructed from `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` only — AD-17 keeps `sb_secret_*` out of this
bundle entirely. Every domain read and write goes through PostgREST under RLS;
the one exception is the `admin-auth` Edge Function, invoked for user creation,
user update and ban/unban.
