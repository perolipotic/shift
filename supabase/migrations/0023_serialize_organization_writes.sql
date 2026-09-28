-- 0023_serialize_organization_writes.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Concurrent admin, status and membership writes are serialized per
-- organization, and TRUNCATE is refused on the three tables whose rules are
-- row rules.
--
-- THE GAP THIS CLOSES. Under READ COMMITTED every rule on `members`,
-- `member_status_versions` and `team_membership_versions` was checked against
-- the writer's own view: 0002's zero-admins trigger at commit, 0008's and
-- 0010's WITH CHECK clauses per row. Two transactions that each change a
-- different row of one organization cannot see each other's uncommitted row,
-- so both could pass and both commit: two admins deleted at once, two admins
-- deactivating each other, or two scheduled membership versions for one member.
--
-- ONE LOCK PER ORGANIZATION, PER REQUEST STATEMENT.
-- `serialize_organization_writes()` is a BEFORE STATEMENT trigger on every
-- write to the three tables (`members` on insert, an update naming `role`, and
-- delete). When the session's role is `authenticated` and its JWT carries an
-- `organization_id` claim, it takes a transaction-scoped advisory lock keyed on
-- that claim. The key is a 64-bit hash of a namespace and the id; a collision
-- only makes two organizations wait for each other, it never lets a write
-- through. The lock is held to the end of the transaction, so it also covers
-- the deferred check at commit.
--
--   * WHY THE CLAIM. Every policy on the three tables pins `organization_id` to
--     the claim, so a request statement can write only the claim's
--     organization. One key per statement covers every row it can touch.
--   * WHY ONLY `authenticated`. The races are between request writers, whose
--     rules are policies. An owner, `postgres` or `service_role` write (the
--     seed, the demo script, an operator's delete, a cascade the owner starts)
--     takes no lock and behaves exactly as before. `admin-auth` writes
--     `members` as `authenticated`, through the caller's client: its member
--     insert takes the lock, and its username update does not, because the
--     trigger fires only on an update naming `role`. 0002's deferred
--     zero-admins check still runs at commit for everyone. A missing or
--     malformed claim takes no lock; the policies refuse that session anyway.
--   * WHY IT CANNOT DEADLOCK. A BEFORE STATEMENT trigger fires before the
--     statement finds, locks or inserts any row, so a request statement takes
--     the advisory lock before any tuple lock of its own: before the row locks
--     of an UPDATE or DELETE, and before the FK KEY SHARE of an INSERT. A
--     request transaction is one PostgREST statement, so while it waits on the
--     advisory lock it holds no tuple lock another writer could want. A writer
--     that takes no advisory lock (the owner) can wait on a tuple lock but is
--     never waited on for an advisory one, so no wait-for cycle runs through
--     the advisory lock. A row-level BEFORE trigger, the first design, fired
--     after a row was locked, and so could deadlock against an owner's cascade.
--   * Writes to different organizations take different keys and never wait for
--     each other.
--
-- WHAT EACH CHECK SEES, AND WHY THE LOCK IS ENOUGH. Correctness rests on READ
-- COMMITTED: each new query in a VOLATILE function takes a new snapshot. Under
-- REPEATABLE READ or SERIALIZABLE the transaction keeps one snapshot, and the
-- lock alone does not make the second writer see the first's commit. Nothing
-- in this schema runs at those levels, and this migration changes no level.
-- A statement's snapshot is taken when it starts, BEFORE its BEFORE STATEMENT
-- trigger waits, so the statement's own inline reads stay stale. What is fresh
-- after the wait:
--
--   * 0002/0008's zero-admins constraint trigger runs at commit, in a VOLATILE
--     plpgsql function, while the lock is still held. It sees every commit made
--     while this transaction waited.
--   * 0008's and 0010's WITH CHECK clauses and DELETE USING clauses run after
--     the lock: WITH CHECK per row, USING while the statement scans, which is
--     after its BEFORE STATEMENT trigger. Their date-order and one-scheduled
--     rules read only through VOLATILE readers (`member_latest_version`,
--     `member_active_on`, `member_active_from`,
--     `team_membership_latest_version`, `member_team_on`,
--     `member_team_version_on`, `member_team_has_version`), each of which takes
--     a new snapshot.
--
-- TWO STALE READS REMAIN IN 0008'S POLICIES, and both are re-checked, not
-- moved. Inline subqueries use the statement's snapshot, and so does
-- `current_member_access()`, which is STABLE. So a caller demoted or
-- deactivated while the statement waited still passes as an active admin, and
-- an admin demoted meanwhile still counts toward the last-admin conjunct.
-- `refuse_status_version_leaving_no_admin()`, an AFTER ROW trigger on
-- `member_status_versions` insert and delete, re-asks both questions after the
-- lock, with fresh reads, as the owner:
--
--   1. Is the caller still an active admin of the row's organization? If not,
--      42501, the policy's own refusal.
--   2. Does a version that leaves an admin out from a date leave some OTHER
--      admin active from that date on? If not, 0002's
--      `ORGANIZATION_WOULD_HAVE_NO_ADMIN` (23514), the code the browser maps.
--
-- For a single-row, non-concurrent statement, both reads see the rows the
-- policy saw, so the trigger never refuses what the policy admitted. A
-- MULTI-ROW statement can be stricter: WITH CHECK judges each row as it is
-- written, while this AFTER ROW trigger runs once the statement has written
-- every row, and so sees all of them. The SPA always sends one row, so only a
-- multi-row insert through the API directly can meet that. THE GATE is the
-- session role: it runs only when `role` is `authenticated` and the write is a
-- top-level statement, not one issued from inside a trigger such as a cascade
-- (`pg_trigger_depth() = 1`). It keys on the role alone and cannot tell whether
-- a policy actually governed the write. An owner session that has not taken
-- that role is never re-checked, so the owner fixtures that schedule every
-- admin out are unaffected; a session that has taken `authenticated` is always
-- re-checked. The policies are unchanged. AFTER and not in the lock trigger,
-- because a raise there would pre-empt the policy's own 42501 for every single
-- write.
--
-- NOT CLOSED HERE (see deferred-work):
--
--   * 0010's KNOWN GAP, narrowed. Two scheduled membership versions for one
--     member are now serialized as above, but a team archived while an
--     assignment waited is still unarchived to the insert policy's inline read:
--     `teams` takes no lock. 0010 itself is forward-only and is not edited; this
--     paragraph is the note's current reading. 0013's and 0016's KNOWN GAP
--     entries are untouched.
--   * A caller demoted while a `members` or `team_membership_versions` write
--     waited is not re-checked; only the status table has the AFTER trigger.
--   * A future SECURITY DEFINER function that writes these tables as the owner
--     under a request session still takes the lock (the role GUC is
--     unchanged), but its own reads are not policies, so it must be reasoned
--     about on its own.
--
-- TRUNCATE IS REFUSED. Row triggers never fire for TRUNCATE, so it would empty
-- an organization past the zero-admins trigger and every rule.
-- `refuse_truncate()` is a BEFORE TRUNCATE statement trigger on the three
-- tables, and raises 23001 with the message `TRUNCATE_REFUSED`, for every role
-- including `postgres`. A `truncate ... cascade` that reaches any of the three
-- is refused too. Removing an organization is still a DELETE, which cascades
-- row by row. DEPLOY.md §6 gives the operator's maintenance procedure.
--
-- THREE TRIGGER FUNCTIONS, none called by hand. Postgres checks EXECUTE when a
-- trigger is created, not when it fires, so each one is its owner's alone, as
-- 0020 left the zero-admins function. `refuse_truncate()` reads nothing and
-- runs as the invoker; the other two are SECURITY DEFINER with an empty
-- search_path, as every definer here is.
--
-- AD-3's one constraint trigger stays the only one: these are ordinary
-- triggers, and none of them decides a rule the schema did not already state.
--
-- IDEMPOTENT: `create or replace` for the functions, `drop trigger if exists`
-- before each trigger, and a revoke of a privilege that is not held is a no-op.

-- --------------------------------------------------------------- the lock

create or replace function public.serialize_organization_writes() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed text;
begin
  if pg_catalog.current_setting('role') <> 'authenticated' then
    return null;
  end if;

  claimed := (select auth.jwt()) ->> 'organization_id';

  -- The policies cast the same claim; one they cannot read locks nothing.
  if claimed is null
     or claimed !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('shift.organization_writes:' || claimed::uuid::text, 0)
  );

  return null;
end;
$$;

revoke execute on function public.serialize_organization_writes() from public;
revoke execute on function public.serialize_organization_writes() from anon;
revoke execute on function public.serialize_organization_writes() from authenticated;
revoke execute on function public.serialize_organization_writes() from service_role;

drop trigger if exists members_serialize_organization_writes on public.members;
create trigger members_serialize_organization_writes
  before insert or update of role or delete on public.members
  for each statement
  execute function public.serialize_organization_writes();

drop trigger if exists member_status_versions_serialize_organization_writes
  on public.member_status_versions;
create trigger member_status_versions_serialize_organization_writes
  before insert or update or delete on public.member_status_versions
  for each statement
  execute function public.serialize_organization_writes();

drop trigger if exists team_membership_versions_serialize_organization_writes
  on public.team_membership_versions;
create trigger team_membership_versions_serialize_organization_writes
  before insert or update or delete on public.team_membership_versions
  for each statement
  execute function public.serialize_organization_writes();

-- ------------------------------------------------------ the fresh re-check

create or replace function public.refuse_status_version_leaving_no_admin() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed record;
begin
  -- The gate: a request session's own statement. The definer runs as the
  -- owner, but `role` is still the session's SET ROLE.
  if pg_catalog.current_setting('role') <> 'authenticated' or pg_catalog.pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op = 'INSERT' then
    changed := new;
  else
    changed := old;
  end if;

  -- 1. The caller, re-read. The policy read it on the statement's snapshot.
  if not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = changed.organization_id
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'new row violates row-level security policy for table "member_status_versions"';
  end if;

  -- 2. The last admin. Only a version that leaves the member out from its
  -- date consults it: an inactive one written, or an active one cancelled.
  if (tg_op = 'INSERT') = changed.active then
    return null;
  end if;

  if not exists (
    select 1
      from public.members target
     where target.id = changed.member_id
       and target.role = 'admin'
  ) then
    return null;
  end if;

  if exists (
    select 1
      from public.members admin
     where admin.organization_id = changed.organization_id
       and admin.role = 'admin'
       and admin.id <> changed.member_id
       and public.member_active_from(admin.id, changed.effective_from)
  ) then
    return null;
  end if;

  raise exception using
    errcode = 'check_violation',
    message = 'ORGANIZATION_WOULD_HAVE_NO_ADMIN',
    detail = changed.organization_id::text;
end;
$$;

revoke execute on function public.refuse_status_version_leaving_no_admin() from public;
revoke execute on function public.refuse_status_version_leaving_no_admin() from anon;
revoke execute on function public.refuse_status_version_leaving_no_admin() from authenticated;
revoke execute on function public.refuse_status_version_leaving_no_admin() from service_role;

drop trigger if exists member_status_versions_keeps_an_admin on public.member_status_versions;
create trigger member_status_versions_keeps_an_admin
  after insert or delete on public.member_status_versions
  for each row
  execute function public.refuse_status_version_leaving_no_admin();

-- --------------------------------------------------------------- TRUNCATE

create or replace function public.refuse_truncate() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'restrict_violation',
    message = 'TRUNCATE_REFUSED',
    detail = tg_table_name;
end;
$$;

revoke execute on function public.refuse_truncate() from public;
revoke execute on function public.refuse_truncate() from anon;
revoke execute on function public.refuse_truncate() from authenticated;
revoke execute on function public.refuse_truncate() from service_role;

drop trigger if exists members_refuse_truncate on public.members;
create trigger members_refuse_truncate
  before truncate on public.members
  for each statement
  execute function public.refuse_truncate();

drop trigger if exists member_status_versions_refuse_truncate on public.member_status_versions;
create trigger member_status_versions_refuse_truncate
  before truncate on public.member_status_versions
  for each statement
  execute function public.refuse_truncate();

drop trigger if exists team_membership_versions_refuse_truncate on public.team_membership_versions;
create trigger team_membership_versions_refuse_truncate
  before truncate on public.team_membership_versions
  for each statement
  execute function public.refuse_truncate();
