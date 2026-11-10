-- 0056_members_allowance_privilege.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 13.3b: the allowance dialog sets the current leave year.
--
-- Since 0055, `members.leave_allowance_days` is a member's STARTING allowance:
-- it covers every leave year until a `leave_allowances` version sets another.
-- A session that could still UPDATE it would rewrite every leave year with no
-- version of its own, past years included — the very thing 13.3 versioned
-- away (AD-2, amended for 13.3b). So it is written only when a member is
-- created, and the app's *Promijeni pravo* appends a version instead.
--
--   * UPDATE on `members` is taken from `authenticated` and `anon`, then given
--     back to `authenticated` column by column (0004's precedent): `name`,
--     `email`, `role`, `username` and `fire_rank` — every column a session
--     updates today, the app's member PATCH and admin-auth's caller-client
--     username update (and its compensating restore). `anon` gets nothing back
--     (PO, 2026-11-10): every policy on `members` is `to authenticated`, so
--     an anonymous caller could update no row anyway.
--   * INSERT is untouched, so admin-auth's create still writes the starting
--     allowance through the caller's client. `service_role` keeps everything:
--     it is BYPASSRLS and is how an operator acts.
--   * No value changes and nothing is backfilled.
--   * A COLUMN LATER ADDED TO `members` that sessions must update needs its
--     own column grant: with no table-wide UPDATE, a new column is not
--     writable by any session until a migration grants it by name.
--
-- A session's PATCH of `leave_allowance_days` now arrives as 42501
-- (permission denied for table members), before any policy is read.

revoke update on table public.members from authenticated, anon;

grant update (name, email, role, username, fire_rank) on table public.members to authenticated;
