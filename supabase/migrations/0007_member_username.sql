-- 0007 — the issued username becomes a column on `members`.
--
-- WHY THIS DUPLICATES `auth.users.email`, AND WHY THAT IS THE LESSER EVIL.
-- AD-12 issues a USERNAME and GoTrue authenticates against an ADDRESS, so the
-- credential an admin hands somebody exists today only as the local part of
-- `auth.users.email`. The application cannot read that column: every read goes
-- through PostgREST as `authenticated`, the `auth` schema is not exposed, and
-- exposing it to read one string would hand every session the whole identity
-- table. So an admin whose entire job is issuing credentials to several hundred
-- people cannot answer "what is my username?" without a database console, and
-- `members/list.ts` cannot show or search the one identifier people actually
-- use (`deferred-work.md:286`). Human decision 2026-09-18.
--
-- NOTHING IN POSTGRESQL CAN ENFORCE THE EQUALITY. A foreign key, a check or a
-- trigger would all have to read `auth.users` from a domain-table constraint,
-- which is a cross-schema coupling to a table Supabase owns and migrates. That
-- is precisely why `admin-auth`'s `updateUserById` writes BOTH stores and
-- carries a compensating restore with a code of its own: the disagreement is
-- made visible rather than prevented, because it cannot be prevented here.
--
-- AND IT IS NOT A VIEW. A view over `auth.users` would need `security_invoker`
-- off to read that table at all, which makes it a privileged reader of the
-- identity table with a policy surface of its own; it could not be indexed, so
-- Q20's search over several hundred members would scan; and it could not be
-- written, which is the half `updateUserById` needs.
--
-- TWO CONSTRAINTS, NOT ONE, and both exist because of one fact:
-- `members_update_by_own_active_admin` (`0003:331-351`) admits an active admin
-- to EVERY COLUMN of every row in their organization through a plain PostgREST
-- PATCH. So a username rule that lives only in the Edge Function is a rule the
-- one caller who can break it never meets.
--
--   * THE SHAPE. A username is the local part of an address the system builds,
--     so it may not be empty, may not carry whitespace, may not carry a second
--     `@`, and is lowercase — `apps/web/src/supabase/address.ts` normalizes the
--     same way before it builds one, and a value that disagrees with that
--     normalization authenticates nothing, silently, forever.
--   * THE UNIQUE, AND IT IS CASE-INSENSITIVE. `Ana.Kovac` and `ana.kovac` are
--     two rows and ONE address: the address builder lowercases, so a
--     case-sensitive unique would let the database hold a collision the address
--     space cannot express. Scoped to the organization for the same reason the
--     address is namespaced by the slug — two tenants may both issue the
--     username an operator finds obvious.
--
-- The lowercase check and the case-insensitive unique are not redundant: the
-- check refuses `Ana.Kovac` outright, and the index is what still holds if the
-- check is ever relaxed for a case the shape rule did not anticipate.
--
-- Human decision 2026-09-18.

-- Added nullable, because there is nothing to fill it with until the statement
-- below has run. `not null` is applied after the backfill, in this same
-- transaction, so no moment exists where a row could be written without one.
alter table members add column username text;

-- THE BACKFILL. `split_part(u.email, '@', 1)` is the LOCAL part — the username
-- the account was issued with — and reading the second field instead would
-- write every member's domain as their username, identically, so the unique
-- index below would refuse the second row of every organization. That is the
-- only thing standing between this statement and silence: `supabase db reset`
-- applies migrations BEFORE `seed.sql`, so `members` is empty when this runs
-- and every character of it is unverified by construction. `provisioning.test.ts`
-- reads this statement out of this file and executes it over a real row.
--
-- `where m.username is null` is what makes it re-runnable over one row, which
-- is how that test drives it; it is also true of every row at migration time.
--
-- `lower()` because the CHECK below requires `username = lower(username)` and
-- nothing guarantees the addresses already in `auth.users` are lowercase — both
-- writers this repository owns lowercase before building an address, but a row
-- written by hand, by a restore, or by a Supabase console would take this
-- migration down at the `add constraint` two statements later, on a forward-only
-- stream with no way back. It costs nothing and removes the only way this
-- migration can fail on real data.
update members m
   set username = lower(split_part(u.email, '@', 1))
  from auth.users u
 where u.id = m.auth_user_id
   and m.username is null;

alter table members alter column username set not null;

-- The shape, verbatim in the terms `apps/web/src/supabase/address.ts` uses:
-- one or more characters, none of them whitespace and none of them `@`, and
-- equal to its own lowercasing.
alter table members
  add constraint members_username_check
  check (username ~ '^[^[:space:]@]+$' and username = lower(username));

-- Case-insensitive, per organization. `lower(username)` rather than `username`
-- is the whole point — see the header.
create unique index members_organization_username_key
  on members (organization_id, lower(username));
