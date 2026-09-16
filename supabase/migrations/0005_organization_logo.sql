-- 0005_organization_logo.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- THE FIRST STORAGE SURFACE IN THE SYSTEM. Before this file there is no bucket,
-- no object and no policy in the `storage` schema at all — `0001` through `0004`
-- do not mention it, and nothing in `apps/web/src` calls `.storage`. So every
-- decision here is a precedent, and the one that matters most is the role clause
-- three paragraphs down.
--
-- WHY THE BUCKET IS CREATED HERE AND NOT IN `config.toml`. `supabase/config.toml`
-- can declare buckets, and that would put the bucket outside the migration
-- stream: a value promoted by editing a container's configuration rather than by
-- a file review, and — per `DEPLOY.md:80-90` — only after a `stop && start`,
-- which is the caveat that makes a config-level change invisible on a running
-- stack. `insert into storage.buckets` from a migration was probed against the
-- running local stack in a transaction and rolled back before this file was
-- written; it succeeds as the migration role. So the bucket is a migration, it
-- is promoted local -> staging -> production the way every other schema fact is,
-- and `config.toml` gains no `[storage]` section.
--
-- WHY EVERY POLICY BELOW NAMES `to authenticated`, and why that clause is the
-- entire gate rather than a narrowing of one. `anon`, `authenticated` and
-- `service_role` each already hold all seven table privileges on
-- `storage.objects` and `storage.buckets` — Supabase's own defaults, verified
-- live — and the only thing standing between an anonymous caller and every
-- object is that row level security is on with ZERO policies. The moment this
-- file writes the first policy, that changes: a policy is permissive, so it
-- ADDS a way in, and the `to` clause is what decides who may walk through it.
-- A policy written without one, or written `to public`, publishes every
-- tenant's branding to the anonymous world and looks in a diff exactly like a
-- policy that does not. `test/supabase-scaffold.test.ts` refuses a policy
-- anywhere in this tree that omits the clause, and `test/rls-isolation.test.ts`
-- executes the anonymous case.
--
-- ISOLATION IS THE FIRST PATH SEGMENT. An object lives at
-- `<organization id>/logo`, and every policy below ANDs three things: the
-- bucket, the first folder of the object's name, and the caller's tenant. The
-- tenant is resolved exactly as `0004:58-78` resolves it — the signed claim
-- ANDed with `public.current_member_access()` — so all three of that file's
-- arguments carry over unchanged: a missing claim yields null and matches
-- nothing, `is_active` is re-read on every evaluation rather than trusted from
-- the token, and `member_role` is what Q2 actually asks about.
--
-- THE WHOLE KEY IS PINNED, not merely the folder, and that is the difference
-- between a rule and a convention. Scoping by folder alone leaves an entitled
-- admin free to write `<own id>/anything` through a direct API call — as many
-- objects as they like, in their own folder, each one perfectly isolated and
-- each one unreclaimable, because this file writes no DELETE policy. "One
-- object, never two" would then be a property of the client deriving the path
-- and nothing else. So each policy compares the object's NAME against the
-- caller's own claim plus the one key this story defines, and the single
-- admissible name per tenant is `<organization id>/logo`.
--
-- The folder comparison stays alongside it, against the helper rather than
-- against the claim, and it is not redundant: it is what re-reads `is_active`
-- and `member_role` on every evaluation. The two conjuncts answer different
-- questions — which object, and who is asking — and collapsing them would lose
-- the freshness half.
--
-- `storage.foldername(name)` returns every segment but the last, so
-- `(storage.foldername(name))[1]` is the first folder and is null for a name
-- with no `/` in it at all. Null compared to anything is null, which is not
-- true, which matches no row — an object written at the bucket root is
-- unreachable rather than shared, which is the direction a mistake has to fail
-- in. The name comparison fails the same way and for the same reason: a session
-- with no claim concatenates null and gets null.
--
-- The comparison is made in TEXT rather than by casting the folder to `uuid`.
-- A cast is the wrong shape here: `'not-a-uuid/logo'::uuid` RAISES, so a caller
-- naming a malformed folder would get an error from inside a policy instead of
-- an empty result, which turns the refusal into a probe that answers questions.
-- The claim is already text — `->>` returns text — so comparing text to text
-- keeps both ends in one representation, which is the reasoning `0003:171-176`
-- gives for the claim shape in the first place.

-- ---------------------------------------------------------- the column

-- WHERE THE LOGO IS, as a column rather than as a question asked of storage.
--
-- Without it, "does this organization have a logo" is answerable only by asking
-- the storage service on every render — a second network read behind the one
-- figure the screen draws, which is precisely the shape AD-13 exists to prevent.
-- With it, absence is a value the snapshot the surface already holds carries,
-- and the neutral fallback is a pure read of data that is already on the client.
--
-- That the path is derivable from the id today is a coincidence of the naming
-- scheme this migration happens to choose, not a contract. The column is the
-- contract.
--
-- IT IS A REFERENCE AND NEVER AN AUTHORIZATION. An admin may write any string
-- into their own organization's `logo_path`, including one naming another
-- tenant's folder. Nothing here stops them, and nothing needs to: the SELECT
-- policy below scopes by folder, so the read refuses, no bytes are returned and
-- the surface falls back. `test/rls-isolation.test.ts` executes that case rather
-- than assuming it.
--
-- Nullable, with no default and no not-null, exactly as `short_name`,
-- `description`, `address` and `contact_email` are (`0002:74-81`). Null means
-- there is no logo, and `0002:38-41` forbids a default that would encode one
-- organization's answer for every tenant.
alter table public.organizations add column logo_path text;

-- `logo_path` JOINS `0004`'s column grant rather than replacing it.
--
-- A column grant does not narrow a table grant and two column grants do not
-- narrow each other — they are UNIONED — so this line adds a sixth writable
-- column and leaves `0004:130-134`'s five exactly as they were. Writing
-- `revoke` again here would be wrong in the other direction: the revoke in
-- `0004` already removed the table-wide grant, and repeating it would suggest
-- the earlier file's work was undone.
--
-- What this does NOT do is let the settings form write the logo. The form's
-- five fields and the logo reference travel on separate updates
-- (`apps/web/src/organization/snapshot.ts`), so saving identity cannot clobber
-- a logo uploaded seconds earlier — but that is a client-side shape and this
-- grant is why it is only a shape: an admin may PATCH `logo_path` directly, and
-- should be able to, because it is their own organization's reference to their
-- own object.
grant update (logo_path) on table public.organizations to authenticated;

-- ---------------------------------------------------------- the bucket

-- PRIVATE, size-bounded and type-bounded, and each of the three is a refusal
-- the product owes.
--
--   - `public => false` is the whole of Q4 at the transport layer. A public
--     bucket serves every object to anybody who can guess a path, with no
--     policy consulted at all, which would make every policy below decorative.
--     There is no service-role key anywhere near this path either: the SPA
--     ships the publishable key only (AD-17).
--   - `file_size_limit` is 2 MiB. The refusal has to live here rather than in
--     the surface for the reason every other refusal in this schema does: the
--     interface is not the enforcement point, AD-9 leaves no server tier, and a
--     bound that only the SPA applies is a bound that holds until somebody
--     opens a terminal.
--   - `allowed_mime_types` is the three raster types and deliberately not SVG.
--     An SVG is a document rather than an image — it carries script and external
--     references — and the place a logo eventually renders is the application
--     shell. The allowlist is the cheapest place to keep that decision, and
--     three raster types cover every real logo.
--
-- `id` and `name` are the same string. The storage API addresses a bucket by
-- `id`; `name` is what the dashboard shows, and two different values would mean
-- the object path in the code and the bucket a human looks at disagree.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-logos',
  'organization-logos',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
-- IDEMPOTENT ON THE BUCKET ROW ALONE, and the rest of this file is not.
--
-- `storage.buckets` is the one table here whose rows can already exist before
-- this migration runs: a bucket created by hand in a dashboard, or a staging
-- project restored from a snapshot that carried it. A duplicate key aborts the
-- whole transaction, which takes the column, the grant and all three policies
-- with it — a migration that fails in the middle of a promotion for a reason
-- that has nothing to do with what it is for.
--
-- `do nothing` and NOT `do update`: if a bucket of this name already exists,
-- its `public`, `file_size_limit` and `allowed_mime_types` are somebody else's
-- decision and silently rewriting them from a migration is how a private bucket
-- becomes public without a diff. `test/rls-isolation.test.ts` asserts the row's
-- actual properties against the running database, so a pre-existing bucket with
-- the wrong shape fails there rather than being papered over here.
on conflict (id) do nothing;

-- NO POLICY ON `storage.buckets`, and the absence is the decision.
--
-- Row level security is on that table with no policy, which is deny-all, and
-- that is what should hold: a session has no business listing buckets, and the
-- upload and download paths do not need it — the storage service resolves the
-- bucket with its own privileged connection and applies row level security to
-- `storage.objects` only. Verified against the running stack, by uploading and
-- reading through the HTTP API with a fixture session while `storage.buckets`
-- had no policy at all.
--
-- The convention `0004:11-18` sets is to say WHY an absent policy is absent and
-- to name what pins it, so: `test/rls-isolation.test.ts` asserts the storage
-- policy set is exactly the three below, so a fourth policy on either table has
-- to change an assertion to arrive.

-- ---------------------------------------------------------- the policies

-- READ AND WRITE ARE DIFFERENT POPULATIONS, and this is the first place in the
-- schema where they genuinely differ.
--
-- Any ACTIVE MEMBER of the organization may read the object: the logo is
-- theirs to see, it is on every screen they will ever open, and
-- `members_select_own_organization` (`0003:289`) already takes the same view of
-- the member list. Only an ACTIVE ADMIN may write it, which is
-- `members_update_by_own_active_admin` (`0003:331`) unchanged but for the table.
-- Collapsing the two into one `for all` policy would grant the write to the
-- read's population, which is the drift `0003` names and this file must not
-- start.
create policy organization_logos_select_by_own_active_member on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'organization-logos'
    and name = nullif(((select auth.jwt()) ->> 'organization_id'), '') || '/logo'
    and (storage.foldername(name))[1] = (
      select access.organization_id::text
        from public.current_member_access() as access
       where access.is_active
    )
  );

-- Insert has no USING clause to fail, so WITH CHECK is the only refusal and it
-- RAISES rather than filtering: a member-role session, an admin naming another
-- tenant and a deactivated admin all reach the caller as 42501 here, where the
-- same three reach it as a silent zero-row answer on an update.
create policy organization_logos_insert_by_own_active_admin on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'organization-logos'
    and name = nullif(((select auth.jwt()) ->> 'organization_id'), '') || '/logo'
    and (storage.foldername(name))[1] = (
      select access.organization_id::text
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- USING chooses which objects an update may touch; WITH CHECK decides what they
-- may become. Both are written out for the reason `0003:316-323` gives:
-- PostgreSQL falls back to USING when WITH CHECK is omitted, so the clause is
-- not the only thing standing in the way today — it is what keeps the refusal
-- from disappearing the day USING is loosened for a read the write side was
-- never meant to inherit. Here that matters concretely: without the check, an
-- entitled admin could RENAME their own object into another tenant's folder,
-- which is the storage equivalent of moving a row between tenants.
--
-- Replacing a logo is an upsert of the same key, which the storage service
-- performs as an update of the existing object, so this policy is what makes
-- "one object, never two" possible at all.
create policy organization_logos_update_by_own_active_admin on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'organization-logos'
    and name = nullif(((select auth.jwt()) ->> 'organization_id'), '') || '/logo'
    and (storage.foldername(name))[1] = (
      select access.organization_id::text
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  )
  with check (
    bucket_id = 'organization-logos'
    and name = nullif(((select auth.jwt()) ->> 'organization_id'), '') || '/logo'
    and (storage.foldername(name))[1] = (
      select access.organization_id::text
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- NO DELETE POLICY, and the absence is a product rule rather than an oversight.
--
-- Nothing in this story removes a logo: replacing one is an upsert of the same
-- key, and no acceptance clause asks for deletion. A DELETE policy written
-- before the surface that needs it is the invisible-permission problem
-- `0002:12-17` describes — a permission nobody is looking at, granted for a case
-- that does not exist — and it is the one verb where a mistake destroys rather
-- than discloses. Deletion stays refused by matching no policy at all, which is
-- the shape `test/rls-isolation.test.ts` asserts rather than assumes, so the
-- later story that wants it has to delete an assertion to get it.
