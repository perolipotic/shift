-- 0049_swap_requests.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 12.1: the swap request record.
--
-- A SWAP REQUEST is a member's proposal to give ONE SHIFT of theirs (a team
-- and a date) to ONE COLLEAGUE, and optionally to take ONE SHIFT of that
-- colleague's in return. Without a return shift it is a one-way cover. The
-- colleague (the ADDRESSEE) accepts or declines; an accepted swap waits for an
-- active admin, who approves or rejects it. It derives nothing until then: a
-- proposed or accepted swap is no roster override, so
-- `calendar_roster_overrides()`, the hours, the collisions and the outbox do
-- not read this table (R9.1), and only an approval writes a schedule row.
--
-- This file is the whole data layer of a swap, on 9.2's pattern (0040, 0041):
--
--   * `swap_requests`: the tenant first; composite keys to `members` for the
--     proposer and the addressee (never the same member) and to `teams` for
--     the given and the return team; the return shift both null or both set
--     and never the given shift; finite dates, as 0026 checks them; AD-11's
--     `created_by` and `created_at`; `on delete cascade` from the
--     organization alone. `answer`, `answered_by` and `answered_at` are set
--     together and only by `answer_swap_request`. `closed_by` and `closed_at`
--     are set together and only by the three definers and the deactivation
--     trigger. A decline closes the request in the same call, and a check
--     keeps a declined request from staying open.
--   * `swap_request_decisions`: one approve, reject or deactivated per
--     request, keyed by the request, attributed by `decided_by default
--     auth.uid()` and `decided_at default now()`, naming the roster overrides
--     an approval wrote. No session holds a write on it.
--   * `answer_swap_request(uuid, text)`: the addressee accepts or declines.
--   * `withdraw_swap_request(uuid)`: the proposer closes a proposed or an
--     accepted swap, or the addressee closes an accepted one, with no
--     decision (FR-69: "Either Member can withdraw a swap before an Admin
--     decides it"; before accepting, the addressee declines).
--   * `decide_swap_request(uuid, text, text)`: an active admin approves (the
--     roster overrides, the decision and the close in ONE transaction) or
--     rejects (the decision and the close). An admin may decide a swap they
--     are part of.
--   * `close_swap_requests_on_deactivation()`: 0041's close, for swaps.
--
-- STATUS IS DERIVED, NEVER STORED TWICE:
--
--   * open (`closed_at is null`) and no answer        — proposed;
--   * open and `answer = 'accepted'`                  — waits for an admin;
--   * closed and `answer = 'declined'`                — declined;
--   * closed with a decision row                      — the decision's outcome
--                                                       (approved, rejected or
--                                                       deactivated);
--   * closed otherwise                                — withdrawn, and
--                                                       `closed_by` says by
--                                                       whom.
--
-- ONE OPEN SWAP PER SHIFT AND SIDE, NOT PER SHIFT. A partial unique key
-- refuses a second open swap of the same given shift by the same proposer
-- (23505), and a second refuses a second open swap of the same return shift
-- from the same addressee. A closed swap leaves both keys. The two keys do NOT
-- span each other: one member's shift may be the given shift of one open swap
-- (as its proposer) and the return shift of another (as its addressee). Both
-- may be accepted; the approval of the second is then refused by 0026's live
-- override key (23505, the member is already taken off that shift), which is
-- the backstop, and the swap stays accepted, to be rejected.
--
-- DATES ARE CHECKED ON INSERT ALONE. The insert policy refuses a date before
-- the organization's today, but an open swap whose dates have since passed
-- stays open and may still be answered, withdrawn and decided, as 0047 lets a
-- pending leave request whose first day has passed still be decided.
--
-- AN ARCHIVED TEAM is not refused on insert: nothing here reads `teams`
-- beyond the composite keys. The approval's override insert is refused by
-- 0036's `refuse_override_on_archived()` (23514 `ROSTER_OVERRIDE_ARCHIVED`),
-- which aborts the call, and the swap stays accepted, to be rejected.
--
-- WHAT THE DATABASE DOES NOT CHECK (AD-1, AD-3): whether the given shift is a
-- working shift on the proposer's roster, or the return shift on the
-- addressee's. The database never projects a roster. The 12.2 form refuses
-- such a swap before it is sent, and 12.4's screen runs its stale check and
-- AD-5's erasure diff before it approves. Both are the browser's: a direct
-- `insert` bypasses the first, and an admin's direct
-- `rpc/decide_swap_request` call bypasses the stale check and the erasure
-- diff, as every direct roster override insert already bypasses the diff. Such
-- an approval writes overrides the domain treats as inert when they do not
-- apply (0026).
--
-- THE LOCK. `swap_requests` takes 0023's statement trigger
-- `serialize_organization_writes()` on insert, update and delete, and the
-- three definers take the same key inline before their first check, as 0040's
-- do. So an answer, a withdrawal, a decision and a deactivation of one
-- organization are served one after the other, the later finding the swap
-- closed or answered.
--
-- WHO READS WHAT: an ACTIVE ADMIN of the token's organization reads all of its
-- swaps and decisions; an active member-role account reads those where it is
-- the proposer or the addressee. ANY active account, admin or member-role,
-- inserts a swap only as its own proposer (the self-owned row policy, AD-10's
-- amendment): the proposer is matched through `members.auth_user_id =
-- auth.uid()` in the claimed organization, the organization comes from the
-- claim and the active status from `current_member_access()`, never from the
-- request. Both dates are the organization's today or later.
--
-- THE REFUSALS, as SQLSTATEs the browser maps:
--
--   An insert into `swap_requests`:
--   * 42501 — the policy or the privilege: not an active account of the
--     claimed organization, a proposer other than the caller's own member
--     row, a forged `created_by`, a date before the organization's today, a
--     named `answer`, `answered_by`, `answered_at`, `closed_by` or
--     `closed_at`, an update or a delete;
--   * 23505 — a partial unique key: an open swap of the same given shift by
--     the same proposer, or of the same return shift from the same addressee;
--   * 23503 — a composite key: another tenant's member or team (reached only
--     past the policy);
--   * 23514 — a check: the addressee is the proposer, the return shift is the
--     given shift or half-named, or a date outside years 0001–9999.
--   * 42501, bare, from the policy too: A SWAP NEVER PUTS AN INACTIVE MEMBER
--     ON A SHIFT (product owner, 2026-11-06, finding F1). The addressee
--     inactive on the given date, or the proposer inactive on the return
--     date, a scheduled deactivation included, as 0041's
--     `member_inactive_within` reads it. A POLICY CONDITION, like the
--     past-date rule, and not a trigger: it compares the new row with the
--     status history as it stands and derives no schedule, so AD-3 needs no
--     named exception. The policy reaches the history through one narrow
--     definer, `swap_parties_active(...)` below, because the status reader
--     is revoked from `authenticated`.
--
--   `answer_swap_request(id, answer)`:
--   * 42501 `SWAP_REQUEST_ANSWER_REFUSED` — the caller is not an active
--     account of the claimed organization;
--   * 22023 `SWAP_REQUEST_ANSWER_UNKNOWN` — the answer is neither `accepted`
--     nor `declined`;
--   * P0002 `SWAP_REQUEST_NOT_OPEN` — no proposed swap addressed to the
--     caller's own member row has that id in that organization: answered,
--     closed, the caller's own proposal, a colleague's, another tenant's or
--     never there, indistinguishably.
--
--   `withdraw_swap_request(id)`:
--   * 42501 `SWAP_REQUEST_WITHDRAWAL_REFUSED` — the caller is not an active
--     account of the claimed organization;
--   * P0002 `SWAP_REQUEST_NOT_OPEN` — no open swap the caller proposed, and no
--     accepted swap addressed to the caller, has that id in that
--     organization.
--
--   `decide_swap_request(id, outcome, reason)`, returning the id of the
--   override on the given shift on an approval and null on a rejection. The
--   return shift's override id, when there is one, is not returned: it is read
--   from the decision row (`return_roster_override_id`):
--   * 42501 `SWAP_REQUEST_DECISION_REFUSED` — the caller is not an active
--     admin of the claimed organization;
--   * 22023 `SWAP_REQUEST_OUTCOME_UNKNOWN` — the outcome is neither
--     `approved` nor `rejected`;
--   * P0002 `SWAP_REQUEST_NOT_OPEN` — no open, accepted swap with that id in
--     that organization: still proposed, closed, another tenant's or never
--     there;
--   * 55000 `SWAP_REQUEST_MEMBER_INACTIVE` — an APPROVAL of a swap whose
--     addressee is inactive on the given date, or whose proposer is inactive
--     on the return date (a status changed since the swap was sent; F1, as
--     0041 refuses an approval of leave onto an inactive date). Raised after
--     the swap is found open and accepted and before any override is
--     written; the whole call aborts, so the swap stays accepted, to be
--     rejected. A REJECTION is never refused for it;
--   * on an approval, any refusal of an override insert, unchanged: 23505 (a
--     live override already takes that member off, or puts that member on,
--     that shift; 0026's keys), 23514 (a reason 0026 refuses, or an archived
--     team, 0036) or 23502 (no reason). The whole call aborts, so the close is
--     rolled back with it and the swap stays accepted, to be rejected.
--
--   `swap_request_decisions`: every session write is 42501, by privilege.
--
-- AN APPROVAL writes ONE roster override on the given shift that takes the
-- proposer off and puts the addressee on, and, when there is a return shift, a
-- second that takes the addressee off and puts the proposer on. Each carries
-- `p_reason` (the 12.4 screen supplies its words) and 0026's defaults, so it is
-- attributed to the approving admin. "This override is a swap" is recorded by
-- the decision's override ids; `roster_overrides` is unchanged. 0043's roster
-- trigger tells both members, and never the admin whose session wrote it.
--
-- DEACTIVATION CLOSES, as 0041: an inactive version of a member closes every
-- open swap where that member is the proposer or the addressee and either date
-- is the version's date or later, with a `deactivated` decision attributed to
-- the version's `created_by`. A reactivation, or cancelling a scheduled
-- deactivation, reopens nothing.
--
-- SECURITY DEFINER, the three definers and the trigger function, as 0040's:
-- the claim, the lock, an empty `search_path` and every name qualified.
-- EXECUTE on the definers is `authenticated`'s alone; on the trigger function,
-- nobody's. The policy's helper `swap_parties_active` is a definer too, with
-- the claim and an empty `search_path` but no lock (it writes nothing), and
-- EXECUTE for `authenticated` alone, whose policy calls it.
--
-- No new notification code and no outbox (12.3, 12.4). No reader in `apps` or
-- `packages` (12.2–12.4 add those).

-- ------------------------------------------------------------------ the request

create table swap_requests (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  id uuid primary key default gen_random_uuid(),

  -- The member who gives the shift, and the colleague asked to take it.
  proposer_id uuid not null,
  addressee_id uuid not null,

  -- The given shift: a team and a civil date, never an instant.
  team_id uuid not null,
  date date not null,

  -- The addressee's shift the proposer takes in return; both null for a
  -- one-way cover.
  return_team_id uuid,
  return_date date,

  -- AD-11. Defaults the client cannot forge: the column grant below admits
  -- neither of these to a session, and the insert policy pins `created_by` as
  -- well.
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),

  -- The addressee's answer, set together or not at all, and only by
  -- `answer_swap_request`. No session holds a privilege on any of them.
  answer text,
  answered_by uuid,
  answered_at timestamptz,

  -- The close, set together or not at all, and only by the three definers and
  -- the deactivation trigger.
  closed_by uuid,
  closed_at timestamptz,

  -- The key `swap_request_decisions` refers to, so a decision naming another
  -- tenant's swap is unrepresentable.
  constraint swap_requests_organization_id_id_key unique (organization_id, id),

  -- To 0002's unique (organization_id, id), so a swap naming another tenant's
  -- member is unrepresentable. NO cascade, as 0040's.
  constraint swap_requests_proposer_fkey
    foreign key (organization_id, proposer_id)
    references members (organization_id, id),

  constraint swap_requests_addressee_fkey
    foreign key (organization_id, addressee_id)
    references members (organization_id, id),

  -- To 0009's unique (organization_id, id), for the same reason. A null
  -- return team is not checked, as a one-way cover has none.
  constraint swap_requests_team_fkey
    foreign key (organization_id, team_id)
    references teams (organization_id, id),

  constraint swap_requests_return_team_fkey
    foreign key (organization_id, return_team_id)
    references teams (organization_id, id),

  constraint swap_requests_members_distinct
    check (proposer_id <> addressee_id),

  -- Finite and in years 0001–9999, as 0026's.
  constraint swap_requests_date_finite
    check (isfinite(date) and date >= date '0001-01-01' and date < date '10000-01-01'),

  constraint swap_requests_return_date_finite
    check (return_date is null or (isfinite(return_date) and return_date >= date '0001-01-01' and return_date < date '10000-01-01')),

  -- A return shift is named whole or not at all.
  constraint swap_requests_return_complete
    check ((return_team_id is null) = (return_date is null)),

  -- A return shift is never the given shift.
  constraint swap_requests_return_not_given
    check (return_team_id is null or (return_team_id, return_date) is distinct from (team_id, date)),

  constraint swap_requests_answer_known
    check (answer in ('accepted', 'declined')),

  constraint swap_requests_answer_complete
    check ((answer is null) = (answered_by is null) and (answer is null) = (answered_at is null)),

  constraint swap_requests_close_complete
    check ((closed_by is null) = (closed_at is null)),

  -- A decline closes the swap in the same call.
  constraint swap_requests_declined_closed
    check (answer is distinct from 'declined' or closed_at is not null)
);

alter table swap_requests enable row level security;

-- Q3: every policy below filters by the tenant first.
create index swap_requests_organization_id_idx on swap_requests (organization_id);

-- One member's swaps, either side: the read policy and the deactivation close
-- ask for them by organization and member.
create index swap_requests_organization_proposer_idx on swap_requests (organization_id, proposer_id);
create index swap_requests_organization_addressee_idx on swap_requests (organization_id, addressee_id);

-- ONE OPEN SWAP PER SHIFT: of the given shift by its proposer, and of the
-- return shift from its addressee. A closed swap leaves both keys.
create unique index swap_requests_open_given_key
  on swap_requests (organization_id, proposer_id, team_id, date)
  where closed_at is null;

create unique index swap_requests_open_return_key
  on swap_requests (organization_id, addressee_id, return_team_id, return_date)
  where closed_at is null and return_team_id is not null;

-- ----------------------------------------------------------------- the decision

create table swap_request_decisions (
  -- Q3: the tenant reference first, not null, and a key.
  organization_id uuid not null references organizations (id) on delete cascade,

  -- The key, so a swap is decided at most once.
  request_id uuid primary key,

  outcome text not null,

  -- The overrides an approval wrote: on the given shift, and on the return
  -- shift when there is one. Both null unless approved.
  roster_override_id uuid,
  return_roster_override_id uuid,

  -- AD-11, from defaults alone: no session writes this table, and the definer
  -- names neither column.
  decided_by uuid not null default auth.uid(),
  decided_at timestamptz not null default now(),

  constraint swap_request_decisions_request_fkey
    foreign key (organization_id, request_id)
    references swap_requests (organization_id, id),

  -- To 0032's `roster_overrides_organization_id_id_key`. NO cascade: an
  -- override is soft-removed, never deleted.
  constraint swap_request_decisions_roster_override_fkey
    foreign key (organization_id, roster_override_id)
    references roster_overrides (organization_id, id),

  constraint swap_request_decisions_return_roster_override_fkey
    foreign key (organization_id, return_roster_override_id)
    references roster_overrides (organization_id, id),

  constraint swap_request_decisions_outcome_known
    check (outcome in ('approved', 'rejected', 'deactivated')),

  constraint swap_request_decisions_roster_override_when_approved
    check ((outcome = 'approved') = (roster_override_id is not null)),

  constraint swap_request_decisions_return_roster_override_when_approved
    check (return_roster_override_id is null or outcome = 'approved'),

  -- One override backs at most one decision. These also index the keys to
  -- `roster_overrides`.
  constraint swap_request_decisions_roster_override_key
    unique (organization_id, roster_override_id),

  constraint swap_request_decisions_return_roster_override_key
    unique (organization_id, return_roster_override_id)
);

alter table swap_request_decisions enable row level security;

create index swap_request_decisions_organization_id_idx on swap_request_decisions (organization_id);

-- ------------------------------------------------------- the parties' status

-- F1 (product owner, 2026-11-06): a swap never puts an inactive member on a
-- shift. True when the addressee is active on the given date and, when there
-- is a return shift, the proposer is active on the return date, each as
-- 0041's `member_inactive_within` reads a one-day range (a scheduled
-- deactivation counts). The insert policy calls it as the session, and the
-- reader it calls is revoked from `authenticated`, so this is a DEFINER, kept
-- narrow:
--
--   * false unless the organization is the caller's claimed one, so it never
--     answers about another tenant;
--   * it judges only members of that organization: an id that is not one is
--     answered true, so another tenant's member keeps the composite key's
--     23503 rather than the policy's 42501;
--   * it writes nothing, so it takes no lock. VOLATILE, as 0041's reader, so
--     it reads the versions committed when it is called.
create function public.swap_parties_active(
  p_organization uuid,
  p_proposer uuid,
  p_addressee uuid,
  p_given date,
  p_returned date
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
begin
  if claimed is null or p_organization is distinct from claimed then
    return false;
  end if;

  if p_given is not null
     and exists (
       select 1
         from public.members member
        where member.organization_id = claimed
          and member.id = p_addressee
     )
     and public.member_inactive_within(p_addressee, pg_catalog.daterange(p_given, p_given, '[]')) then
    return false;
  end if;

  if p_returned is not null
     and exists (
       select 1
         from public.members member
        where member.organization_id = claimed
          and member.id = p_proposer
     )
     and public.member_inactive_within(p_proposer, pg_catalog.daterange(p_returned, p_returned, '[]')) then
    return false;
  end if;

  return true;
end;
$$;

-- 0029's explicit grants: the insert policy is permission-checked against the
-- querying role, so `authenticated` holds EXECUTE, and nobody else.
revoke execute on function public.swap_parties_active(uuid, uuid, uuid, date, date) from public;
revoke execute on function public.swap_parties_active(uuid, uuid, uuid, date, date) from anon;
revoke execute on function public.swap_parties_active(uuid, uuid, uuid, date, date) from service_role;
grant execute on function public.swap_parties_active(uuid, uuid, uuid, date, date) to authenticated;

-- ------------------------------------------------------------------ the policies

-- An active admin of the token's organization reads all of its swaps; an
-- active member-role account those it proposed or was asked.
create policy swap_requests_select_own_organization on public.swap_requests
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and (
      organization_id = (
        select access.organization_id
          from public.current_member_access() as access
         where access.is_active
           and access.member_role = 'admin'
      )
      or exists (
        select 1
          from public.members member
         where member.organization_id = swap_requests.organization_id
           and member.id in (swap_requests.proposer_id, swap_requests.addressee_id)
           and member.auth_user_id = (select auth.uid())
      )
    )
  );

-- The self-owned row (AD-10's amendment). Every rule is one conjunct:
--
--   * the tenant, from the claim and from the fresh helper, as an ACTIVE
--     account of any role;
--   * the proposer, the caller's own row in that organization, matched by
--     `auth_user_id`, never taken from the request;
--   * the attribution, pinned to the caller;
--   * both dates the organization's today or later (0008's
--     `organization_today`): the database's day, never the browser's;
--   * no inactive member put on a shift (F1): the addressee active on the
--     given date, and the proposer on the return date.
create policy swap_requests_insert_own_by_active_member on public.swap_requests
  for insert
  to authenticated
  with check (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and exists (
      select 1
        from public.members member
       where member.organization_id = swap_requests.organization_id
         and member.id = swap_requests.proposer_id
         and member.auth_user_id = (select auth.uid())
    )
    and created_by = (select auth.uid())
    and date >= public.organization_today(organization_id)
    and (return_date is null or return_date >= public.organization_today(organization_id))
    and public.swap_parties_active(organization_id, proposer_id, addressee_id, date, return_date)
  );

-- The decisions follow their swaps: an active admin reads the organization's,
-- an active member-role account those on swaps it proposed or was asked.
create policy swap_request_decisions_select_own_organization on public.swap_request_decisions
  for select
  to authenticated
  using (
    organization_id = nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid
    and organization_id = (
      select access.organization_id
        from public.current_member_access() as access
       where access.is_active
    )
    and (
      organization_id = (
        select access.organization_id
          from public.current_member_access() as access
         where access.is_active
           and access.member_role = 'admin'
      )
      or exists (
        select 1
          from public.swap_requests request
          join public.members member
            on member.organization_id = request.organization_id
           and member.id in (request.proposer_id, request.addressee_id)
         where request.organization_id = swap_request_decisions.organization_id
           and request.id = swap_request_decisions.request_id
           and member.auth_user_id = (select auth.uid())
      )
    )
  );

-- ------------------------------------------------------- the writable columns

-- A session names the seven facts of a proposal on insert and nothing else.
-- No update and no delete: the definers answer and close a swap. `anon` reads
-- and writes none of it.
revoke insert, update, delete, truncate, references, trigger on table public.swap_requests
  from anon, authenticated;
revoke select on table public.swap_requests from anon;

grant insert (organization_id, proposer_id, addressee_id, team_id, date, return_team_id, return_date) on table public.swap_requests
  to authenticated;

-- A decision is read, and only `decide_swap_request` and the deactivation
-- close write one.
revoke insert, update, delete, truncate, references, trigger on table public.swap_request_decisions
  from anon, authenticated;
revoke select on table public.swap_request_decisions from anon;

-- ------------------------------------------------------------------- the lock

-- 0023's statement lock, as 0040 attaches it. The definers' updates take the
-- same key again (an advisory lock is re-entrant).
create trigger swap_requests_serialize_organization_writes
  before insert or update or delete on public.swap_requests
  for each statement
  execute function public.serialize_organization_writes();

-- ------------------------------------------------------------------ the answer

create function public.answer_swap_request(p_request_id uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
begin
  if claimed is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('shift.organization_writes:' || claimed::text, 0)
    );
  end if;

  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'SWAP_REQUEST_ANSWER_REFUSED';
  end if;

  if p_answer is null or p_answer not in ('accepted', 'declined') then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'SWAP_REQUEST_ANSWER_UNKNOWN';
  end if;

  -- A proposed swap addressed to the caller's own member row alone. A decline
  -- closes it in the same statement.
  update public.swap_requests r
     set answer = p_answer,
         answered_by = auth.uid(),
         answered_at = now(),
         closed_by = case when p_answer = 'declined' then auth.uid() end,
         closed_at = case when p_answer = 'declined' then now() end
   where r.id = p_request_id
     and r.organization_id = claimed
     and r.closed_at is null
     and r.answer is null
     and exists (
       select 1
         from public.members member
        where member.organization_id = claimed
          and member.id = r.addressee_id
          and member.auth_user_id = auth.uid()
     );

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'SWAP_REQUEST_NOT_OPEN';
  end if;
end;
$$;

-- 0029's explicit grants.
revoke execute on function public.answer_swap_request(uuid, text) from public;
revoke execute on function public.answer_swap_request(uuid, text) from anon;
revoke execute on function public.answer_swap_request(uuid, text) from service_role;
grant execute on function public.answer_swap_request(uuid, text) to authenticated;

-- -------------------------------------------------------------- the withdrawal

create function public.withdraw_swap_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
begin
  if claimed is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('shift.organization_writes:' || claimed::text, 0)
    );
  end if;

  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'SWAP_REQUEST_WITHDRAWAL_REFUSED';
  end if;

  -- An open swap the caller proposed (proposed or accepted), or an accepted
  -- one addressed to the caller. Before accepting, the addressee declines.
  update public.swap_requests r
     set closed_by = auth.uid(),
         closed_at = now()
   where r.id = p_request_id
     and r.organization_id = claimed
     and r.closed_at is null
     and exists (
       select 1
         from public.members member
        where member.organization_id = claimed
          and member.auth_user_id = auth.uid()
          and (
            member.id = r.proposer_id
            or (member.id = r.addressee_id and r.answer = 'accepted')
          )
     );

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'SWAP_REQUEST_NOT_OPEN';
  end if;
end;
$$;

revoke execute on function public.withdraw_swap_request(uuid) from public;
revoke execute on function public.withdraw_swap_request(uuid) from anon;
revoke execute on function public.withdraw_swap_request(uuid) from service_role;
grant execute on function public.withdraw_swap_request(uuid) to authenticated;

-- ---------------------------------------------------------------- the decision

create function public.decide_swap_request(p_request_id uuid, p_outcome text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid := nullif(((select auth.jwt()) ->> 'organization_id'), '')::uuid;
  swap public.swap_requests;
  given_override uuid;
  return_override uuid;
begin
  if claimed is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('shift.organization_writes:' || claimed::text, 0)
    );
  end if;

  if claimed is null or not exists (
    select 1
      from public.current_member_access() as access
     where access.organization_id = claimed
       and access.is_active
       and access.member_role = 'admin'
  ) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'SWAP_REQUEST_DECISION_REFUSED';
  end if;

  if p_outcome is null or p_outcome not in ('approved', 'rejected') then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'SWAP_REQUEST_OUTCOME_UNKNOWN';
  end if;

  -- An open, accepted swap alone. An admin who is a party may decide it.
  update public.swap_requests r
     set closed_by = auth.uid(),
         closed_at = now()
   where r.id = p_request_id
     and r.organization_id = claimed
     and r.closed_at is null
     and r.answer = 'accepted'
  returning r.* into swap;

  if not found then
    raise exception using
      errcode = 'no_data_found',
      message = 'SWAP_REQUEST_NOT_OPEN';
  end if;

  if p_outcome = 'approved' then
    -- F1: never put an inactive member on a shift, a scheduled deactivation
    -- included. The raise aborts the call, and the close above with it: the
    -- swap stays accepted, to be rejected.
    if public.member_inactive_within(swap.addressee_id, pg_catalog.daterange(swap.date, swap.date, '[]'))
       or (
         swap.return_date is not null
         and public.member_inactive_within(swap.proposer_id, pg_catalog.daterange(swap.return_date, swap.return_date, '[]'))
       ) then
      raise exception using
        errcode = 'object_not_in_prerequisite_state',
        message = 'SWAP_REQUEST_MEMBER_INACTIVE';
    end if;

    -- `created_by` and `created_at` come from 0026's defaults: the approving
    -- admin, now. Any refusal (0026's live keys 23505, its reason check or
    -- 0036's archived team 23514) aborts the call, and the close above with
    -- it: the swap stays accepted.
    insert into public.roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason)
    values (claimed, swap.team_id, swap.date, swap.proposer_id, swap.addressee_id, p_reason)
    returning id into given_override;

    if swap.return_team_id is not null then
      insert into public.roster_overrides (organization_id, team_id, date, member_out_id, member_in_id, reason)
      values (claimed, swap.return_team_id, swap.return_date, swap.addressee_id, swap.proposer_id, p_reason)
      returning id into return_override;
    end if;
  end if;

  -- `decided_by` and `decided_at` from their defaults: the caller, now.
  insert into public.swap_request_decisions (organization_id, request_id, outcome, roster_override_id, return_roster_override_id)
  values (claimed, p_request_id, p_outcome, given_override, return_override);

  return given_override;
end;
$$;

revoke execute on function public.decide_swap_request(uuid, text, text) from public;
revoke execute on function public.decide_swap_request(uuid, text, text) from anon;
revoke execute on function public.decide_swap_request(uuid, text, text) from service_role;
grant execute on function public.decide_swap_request(uuid, text, text) to authenticated;

-- ---------------------------------------------------- the close on deactivation

create function public.close_swap_requests_on_deactivation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The close and its decision in one statement: each closed swap gets
  -- exactly one `deactivated` decision, by the deactivating admin.
  --
  -- A swap whose dates on or after this version's lie wholly after a LATER
  -- version of the member is not this version's to close, as 0041 guards it:
  -- the policy path always appends the latest version, but an owner write may
  -- not.
  with closed as (
    update public.swap_requests r
       set closed_by = new.created_by,
           closed_at = now()
     where r.organization_id = new.organization_id
       and new.member_id in (r.proposer_id, r.addressee_id)
       and r.closed_at is null
       and (r.date >= new.effective_from or r.return_date >= new.effective_from)
       and not exists (
         select 1
           from public.member_status_versions later
          where later.organization_id = new.organization_id
            and later.member_id = new.member_id
            and later.effective_from > new.effective_from
            and later.effective_from <= least(
              case when r.date >= new.effective_from then r.date end,
              case when r.return_date >= new.effective_from then r.return_date end
            )
       )
    returning r.organization_id, r.id
  )
  insert into public.swap_request_decisions (organization_id, request_id, outcome, decided_by)
  select closed.organization_id, closed.id, 'deactivated', new.created_by
    from closed;

  return null;
end;
$$;

-- As 0023's trigger functions (0020): nothing calls it by hand, and Postgres
-- checks EXECUTE when the trigger is created, not when it fires.
revoke execute on function public.close_swap_requests_on_deactivation() from public;
revoke execute on function public.close_swap_requests_on_deactivation() from anon;
revoke execute on function public.close_swap_requests_on_deactivation() from authenticated;
revoke execute on function public.close_swap_requests_on_deactivation() from service_role;

create trigger member_status_versions_close_swap_requests
  after insert on public.member_status_versions
  for each row
  when (not new.active)
  execute function public.close_swap_requests_on_deactivation();
