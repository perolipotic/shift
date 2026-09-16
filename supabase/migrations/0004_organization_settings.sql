-- 0004_organization_settings.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- The write path `0003_access_control.sql:274-284` deliberately left out. That
-- comment reserves it for the organization settings surface and says why: a
-- permissive policy written before the story that needs it is invisible until
-- nobody is looking (0002:12-17). The surface exists now, so the policy does.
--
-- ONE POLICY, AND ONLY UPDATE. `organizations` gains no INSERT and no DELETE
-- policy, here or later, and that is a product rule rather than an oversight:
-- FR-2 puts provisioning in `supabase/operator/provision-organization.sql`,
-- which runs as the owner before any admin exists to attribute it to, and no
-- product surface creates or destroys a tenant. Both operations stay refused by
-- matching no policy at all — the shape `test/rls-isolation.test.ts` asserts
-- rather than assumes, so a later story that adds one has to delete an
-- assertion to do it.
--
-- The policy is `members_update_by_own_active_admin` (0003:331-351) copied
-- verbatim but for the column name, and the copy is deliberate: 0003 names
-- itself the pattern every organization-scoped table follows, and a policy that
-- reasons differently about the same question is the drift that makes the
-- pattern worthless. So USING and WITH CHECK are identical to each other and to
-- that policy's, and the JWT claim is ANDed with `public.current_member_access()`
-- requiring both `is_active` and `member_role = 'admin'`.
--
-- Three things that AND buys, one per conjunct:
--
--   - the claim pins the tenant. A null or empty claim makes the comparison
--     null, which is not true, which matches no row — so a session minted
--     before the hook existed writes nothing rather than everything.
--   - `is_active` is read FRESH from `auth.users` on every evaluation, so a
--     banned or soft-deleted admin loses the write on its next statement rather
--     than at token expiry (AD-10, CAP-4).
--   - `member_role = 'admin'` is what Q2 actually says: a member-role account is
--     refused identically through the interface and through a direct API call,
--     because AD-9 leaves no server tier and both are the same call.
--
-- `id` rather than `organization_id`, because on this table the primary key IS
-- the tenant reference. That makes the WITH CHECK clause stronger here than on
-- `members`: pinning `id` in the check is what refuses an update that would
-- change the row's own identity, which is the `organizations` equivalent of
-- moving a row between tenants. Written out rather than left implicit for the
-- reason 0003:296-302 gives — PostgreSQL falls back to USING when WITH CHECK is
-- omitted, so the clause is not the only thing standing in the way today; it is
-- what keeps the refusal from disappearing the day USING is loosened for a read
-- the write side was never meant to inherit.
--
-- A policy constrains ROWS and never columns, so this one on its own says an
-- entitled admin may update the row — every column of it. The column rule is
-- written below as a GRANT, which is the mechanism that can express it; see
-- there for why it is not the surface's job.
--
-- What stays the schema's job rather than either of theirs (AD-3): `name`'s
-- emptiness, the leave-year day's 1-28 range and the rest are already shapes on
-- the table (0002:58-112), so they refuse a bad value whoever writes it.
create policy organizations_update_by_own_active_admin on public.organizations
  for update
  to authenticated
  using (
    id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  )
  with check (
    id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- ------------------------------------------------------- the editable columns

-- WHICH COLUMNS, as a privilege — because a policy cannot say it.
--
-- The policy above admits the row; Supabase's default privileges in `public`
-- then admit every column of it to `authenticated`, and `organizations` has
-- thirteen. So with the policy alone an entitled admin could PATCH `slug` or
-- `locale` through PostgREST and the database would accept it. Verified live
-- during the 1.4a review: acting as the pilot's admin with claims injected,
-- `update organizations set slug = 'hijacked-slug'` reported one row updated,
-- and so did the same statement aimed at the language column.
--
-- Both are refusals the product actually owes:
--
--   - `slug` is the domain part of every issued sign-in address (AD-12,
--     0002:61-69). Changing it refuses every existing credential in the
--     organization at once, silently, with the message that says the password
--     is wrong — the same unrecoverable shape story 1.3b's malformed-slug trap
--     produced.
--   - the language column is a hard-coded constant on the client side
--     (`i18n/format.ts:43`) and the resource tree is typed off a single file, so
--     a row naming any other tag changes nothing on screen and leaves the
--     column disagreeing with what actually renders.
--
-- "The settings surface draws no control for them" is not the enforcement. Q1
-- and Q2 both say a refusal must be identical through the interface and through
-- a direct API call, and AD-9 leaves no server tier for a second opinion — so a
-- rule that lives only in the SPA is a rule that holds until somebody opens a
-- terminal. This is the enforcement, and it is at the one point both callers
-- pass through.
--
-- REVOKE FIRST, THEN GRANT THE FIVE. A column grant does not narrow a table
-- grant — the two are unioned — so granting the five columns while the table
-- grant stood would change nothing at all.
--
-- `anon` is deliberately untouched. Every policy on this table is
-- `to authenticated`, so an anonymous caller matches none and is already
-- refused; revoking its privileges too would change the failure mode from "no
-- policy matched" to "permission denied", and 0002:160-172 records that this
-- schema keeps the two distinguishable on purpose — `test/provisioning.test.ts`
-- reads that difference. `service_role` keeps everything: it is BYPASSRLS and
-- is how an operator acts.
--
-- Note this constrains the UPDATE verb only. INSERT and DELETE are refused a
-- step earlier, by no policy matching them at all, which is FR-2: no product
-- surface creates or destroys a tenant.
revoke update on table public.organizations from authenticated;

grant update (
  name,
  organization_type,
  timezone,
  leave_year_start_month,
  leave_year_start_day
) on table public.organizations to authenticated;
