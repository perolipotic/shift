-- 0003_access_control.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- The access-control layer AD-10 describes, and the pattern every later
-- organization-scoped table copies. 0002 enabled row level security on both
-- tables and deliberately wrote no policy, which is deny-all: a session read
-- nothing at all. This migration is the other half — the helper that resolves
-- who the caller is, the hook that puts the caller's tenant into the token, and
-- the first policies.
--
-- AD-10 splits the two halves of "who is asking" on purpose, and the split is
-- the whole design. `organization_id` rides in a JWT claim, which is safe only
-- because one account belongs to exactly one organization (0002:126-127) — so
-- the tenant filter is a comparison against a signed value and needs no table
-- read to widen a policy into a join. Role and active state are read fresh from
-- the tables on every policy evaluation instead, because a claim is a fact
-- about the moment the token was minted: an account demoted or blocked
-- mid-session would keep its old rights until the token expired, which is
-- exactly what CAP-4's "blocks authentication" forbids. Nothing here ever reads
-- a role or an active flag from a claim, and nothing trusts a client-supplied
-- organization or role.
--
-- Q1 and Q2 are both enforced here and nowhere else. AD-9 leaves no server
-- tier: every domain write goes through PostgREST under these policies, so
-- there is exactly one enforcement point, and "refused identically through the
-- interface and through a direct API call" is true because both are the same
-- call. `test/rls-isolation.test.ts` executes that claim rather than reading it
-- — with real tokens over the shipped HTTP path, and with injected claims for
-- the cases token issuance cannot isolate.
--
-- Q3 is what makes any of it expressible. `organization_id` is the first
-- column of both tables, not null and a foreign key, so every policy below has
-- a single column to compare its claim against and no row can be outside a
-- tenant.
--
-- AD-2 is the reason active state is read from `auth.users.banned_until` and
-- not from a column on `members`. 0002:34-36 leaves active status off `members`
-- deliberately — AD-2 classifies it as versioned, so it arrives as story 1.6's
-- own table with a validity range — and `test/provisioning.test.ts` asserts
-- `members` never gains an `is_active`, `active` or `team_id` column. Reading
-- the ban column satisfies "read fresh" with no new column and no encroachment:
-- it is the authentication half of deactivation, which is what CAP-4 words as
-- "blocks authentication", and ban/unban is already the privileged auth
-- boundary's declared vocabulary. Story 1.6 adds the versioned domain table and
-- EXTENDS the helper below; it does not replace it.
--
-- AD-9 also bounds what this migration may contain: a rule row level security
-- cannot express is escalated to the spine, never solved by adding a function.
-- AD-3 owns the other half of that bound — it permits exactly one constraint
-- trigger for the life of this schema and spent the whole budget on 0002's
-- zero-admins check — so the count stays exactly one after this file.
--
-- No grant and no revoke on either table. 0002:160-172 explains why: Supabase's
-- default privileges in `public` already grant every table privilege to `anon`
-- and `authenticated`, and that is precisely what makes a policy-less table
-- return zero rows instead of `permission denied`. Writing a table grant here
-- would suggest the default is not already in force, and would change the
-- failure mode the tests distinguish.

-- ------------------------------------------------------------ the fresh reader

-- Who the caller is, resolved from the tables on every policy evaluation.
--
-- SECURITY DEFINER because it reads `members`, which is row level security
-- protected: a SECURITY INVOKER function called from a policy on `members`
-- would either recurse or read zero rows, and either way every policy would
-- conclude that the caller belongs to no organization. It runs as the owner of
-- this migration, which owns both tables, so the read inside is not itself
-- filtered.
--
-- STABLE, not IMMUTABLE: the answer changes when a role is edited or an account
-- is blocked, and it must be re-resolved on the next statement rather than
-- cached for the session. STABLE is also what AD-10 names. The freshness cases
-- in `test/rls-isolation.test.ts` therefore span two statements inside one
-- transaction — a single-statement case could not tell a re-resolved answer
-- from one cached for the duration of that statement.
--
-- search_path is emptied and every name qualified, exactly as 0002:196 does, so
-- nothing here resolves through a caller-controlled path.
--
-- Active state is `banned_until is null or banned_until <= now()`: a ban in the
-- future is a block, and a ban that has expired is not. Reading it as a
-- three-way comparison rather than `banned_until is null` is what makes an
-- expired ban read as active instead of as a permanent one.
--
-- The row is looked up by `auth.uid()`, which is the token's subject, and
-- `members.auth_user_id` is unique (0002:128), so this returns at most one row.
-- No caller can ask about anybody else: there is no parameter to point
-- elsewhere with, which is why exposing it is not a disclosure even though it
-- reads past row level security.
create function public.current_member_access()
returns table (organization_id uuid, member_role text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id,
         m.role,
         (u.banned_until is null or u.banned_until <= now())
    from public.members m
    join auth.users u on u.id = m.auth_user_id
   where m.auth_user_id = (select auth.uid())
$$;

-- Same reasoning as 0002:225-231, and then one thing 0002 did not have to say.
-- The function is SECURITY DEFINER and reads `members` past row level security,
-- so leaving the default PUBLIC grant in place would hand every role an entry
-- point into a function that runs as the owner.
--
-- A policy expression is not exempt from that. Verified against the running
-- stack: with EXECUTE revoked from `authenticated`, a select on `members` as
-- `authenticated` fails with `permission denied for function
-- current_member_access` rather than returning zero rows — the function named
-- in a policy is permission-checked against the querying role, not against the
-- table owner. So the request role needs an explicit grant, and it is written
-- here rather than inherited: Supabase's default privileges in `public` happen
-- to grant EXECUTE on a new function to `anon`, `authenticated` and
-- `service_role`, and a dependency that only works by accident fails on the
-- first platform that does not share the accident (0002:43-51 makes the same
-- argument about an extension).
--
-- Granting it to `authenticated` discloses nothing. The function takes no
-- argument, so there is nowhere to name a subject other than `auth.uid()`: a
-- caller can learn its own organization, its own role and its own active
-- state, all three of which it can already see. `anon` and `service_role` are
-- revoked because neither has a policy that needs it — every policy below is
-- `to authenticated`, and `service_role` is BYPASSRLS and reads the table
-- directly.
revoke execute on function public.current_member_access() from public;
revoke execute on function public.current_member_access() from anon;
revoke execute on function public.current_member_access() from service_role;
grant execute on function public.current_member_access() to authenticated;

-- ------------------------------------------------------------------- the claim

-- The custom access token hook: the one thing that puts `organization_id` into
-- a token, and the reason the policies below can compare against a signed
-- value. It is wired in `supabase/config.toml` under
-- `[auth.hook.custom_access_token]`; the function has to exist before the hook
-- is enabled, or every sign-in fails on a missing function (DEPLOY.md §5.2b).
--
-- It writes exactly one claim and nothing else. In particular the domain role
-- never enters a claim, and never the `role` claim: PostgREST owns that one, its
-- value is `authenticated`, and it is what selects the database role a request
-- runs as. A domain role in a claim would also be the stale fact AD-10 exists
-- to avoid.
--
-- An account with no member row gets the claim removed rather than defaulted.
-- That is the fail-closed direction: a token with no organization matches no
-- policy below and reads nothing, whereas any fallback value would be a
-- guessed tenant. A session minted before this hook existed carries no claim
-- either, and reaches the same outcome — which is why every policy compares
-- against the claim in a form where a null cannot widen the result.
--
-- The claim is written as text rather than as a JSON value of some other shape
-- because that is what `->>` returns and what the policies cast; keeping the
-- two ends in the same representation is what stops a comparison from silently
-- becoming false.
--
-- SECURITY DEFINER, so the lookup needs no privilege on `members` for the auth
-- service's own role and no policy written for it. The alternative — granting
-- the auth service table access and adding a policy for it — would put a second
-- reader on a domain table for the sake of a claim projection.
create function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  signer_claims       jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  signer_organization uuid;
begin
  select m.organization_id
    into signer_organization
    from public.members m
   where m.auth_user_id = (event ->> 'user_id')::uuid;

  if signer_organization is null then
    return jsonb_set(event, '{claims}', signer_claims - 'organization_id');
  end if;

  return jsonb_set(
    event,
    '{claims}',
    jsonb_set(signer_claims, '{organization_id}', to_jsonb(signer_organization::text))
  );
end;
$$;

-- The auth service is the only caller, and after this it is the only role that
-- can be. Unlike the helper above, this function takes its subject as an
-- argument, so anyone who can execute it can ask about anybody — which is
-- exactly the shape that must not be reachable from a session.
--
-- Each revoke is written out rather than left to the PUBLIC revoke, because
-- Supabase's default privileges grant EXECUTE on a new function in `public` to
-- `anon`, `authenticated` and `service_role` individually: revoking PUBLIC
-- alone would leave all three, and the two request roles are precisely the ones
-- a token arrives as. `service_role` goes too — it is BYPASSRLS and needs no
-- claim projection — so the grant list ends up naming the auth service and the
-- owner and nobody else.
revoke execute on function public.custom_access_token_hook(jsonb) from public;
revoke execute on function public.custom_access_token_hook(jsonb) from anon;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;
revoke execute on function public.custom_access_token_hook(jsonb) from service_role;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ----------------------------------------------------------------- Q1, Q2, Q3

-- Every policy below is `to authenticated`, which leaves `anon` matching no
-- policy at all: an anonymous caller still reads zero rows from both tables,
-- in this story and after it. That is not an omission to be filled in later —
-- there is no anonymous read path anywhere in this system, and
-- `test/provisioning.test.ts` keeps its two `anon` rows forever.
--
-- The claim is read as
--   nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
-- and that shape is deliberate in three ways. `(select ...)` wraps the call so
-- it is evaluated once per statement instead of once per row. `nullif(…, '')`
-- turns the one malformed value that could arrive — an empty string — into a
-- null instead of a cast error; every other value is a uuid the hook above
-- wrote and the auth service signed, so it is not client-controlled. And the
-- result is compared to the `organization_id` column as a uuid rather than
-- casting the column to text, which keeps the comparison usable by the index
-- 0002:157 creates.
--
-- A null claim makes each comparison null, which is not true, which returns no
-- rows. That is the fail-closed requirement: the absence of a claim must never
-- widen a policy from one tenant to all of them.
--
-- Each policy additionally requires the helper to agree with the claim. Two
-- reasons: the claim alone is a fact about the past, so it cannot answer
-- whether the account is still active; and requiring both means the claim is
-- load-bearing rather than decorative, which is what AD-10 actually asks for.
-- The helper's subquery is uncorrelated, so it is evaluated once per statement
-- and yields null — not false — when the caller has no row or is blocked.

-- An organization reads itself and no other. Nothing writes `organizations`
-- through PostgREST yet: the settings surface is story 1.4's, and a policy
-- written before the surface that needs it is the invisible-permission problem
-- 0002:12-17 describes.
create policy organizations_select_own_organization on public.organizations
  for select
  to authenticated
  using (
    id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
  );

-- A session reads its own organization's members, whatever its role. Q2 is
-- about writes: a member-role account sees the list — it has to, to see who is
-- on a team — and changes nothing on it.
create policy members_select_own_organization on public.members
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
  );

-- Insert has no USING clause to fail, so this is the one write refusal that
-- surfaces as an error: a member-role account, or an admin naming another
-- tenant, gets 42501 and HTTP 403. The other two refuse silently by matching no
-- row, which is why the assertions for them read the target row back rather
-- than expecting a throw.
create policy members_insert_by_own_active_admin on public.members
  for insert
  to authenticated
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- USING chooses which rows an update may touch; WITH CHECK decides what they
-- may become. Both pin `organization_id`, so an otherwise-legal update cannot
-- move a row between tenants: the row is reachable only while it is in the
-- caller's organization, and it is allowed to land only in the same one.
--
-- Written out rather than left implicit. PostgreSQL falls back to the USING
-- expression as the check when WITH CHECK is omitted — verified against the
-- running stack: dropping the clause below still refuses a tenant move — so
-- this is not the only thing standing in the way today. It is what keeps the
-- refusal from disappearing the day USING is loosened for a read that the write
-- side was never meant to inherit, which is the shape of every later
-- organization-scoped table this migration is the pattern for.
create policy members_update_by_own_active_admin on public.members
  for update
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  )
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );

-- Deletion is still bounded by 0002's deferred zero-admins trigger, which runs
-- as the owner and so is unaffected by these policies. An admin deleting the
-- last admin of their own organization is refused by that trigger at commit,
-- not here; a member-role account deleting anybody is refused here, silently,
-- by matching no row.
create policy members_delete_by_own_active_admin on public.members
  for delete
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
         and access.member_role = 'admin'
    )
  );
