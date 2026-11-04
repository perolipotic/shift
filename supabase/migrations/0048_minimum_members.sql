-- 0048_minimum_members.sql
--
-- Forward-only. Once this file has been promoted past local it is never edited;
-- a correction is a new migration with a higher number.
--
-- Story 11.1: the minimum-members setting (CAP-21, FR-70).
--
-- One change, and nothing else: `organizations.minimum_members`, how many
-- people a working shift needs. `packages/domain` derives from it, on read,
-- which shifts are short-staffed (`domain/staffing`, R10.1–R10.5); no table
-- holds a count or a state (AD-1).
--
-- NULLABLE, WITH NO DEFAULT. Null is "the organization has not set it", and
-- then nothing is short-staffed anywhere (R10.2). `0002:38-41` forbids a
-- default that encodes one organization's answer (DI-8): the pilot's 3 lives in
-- `seed.sql` and the demo's in `operator/demo-organization.sql`.
--
-- CURRENT-STATE (AD-2, amended by story 11.1): no history and no versions, so
-- changing it changes the short-staffed state of past dates too, as moving an
-- hour band changes their band hours.
--
-- A POSITIVE WHOLE NUMBER, by shape. `smallint` holds every number the client
-- offers (1–32767); zero or a negative is refused by the named check, which the
-- organization screen maps to its field (`organizations_minimum_members_check`).

alter table public.organizations
  add column minimum_members smallint
    constraint organizations_minimum_members_check check (minimum_members >= 1);

-- JOINS the column grants, as 0014's `uses_fire_ranks` and 0044's
-- `email_notifications` did: column grants are unioned, so this adds one
-- writable column and leaves every other exactly as it was. WHO may write it is
-- 0004's `organizations_update_by_own_active_admin`, unchanged.
grant update (minimum_members) on table public.organizations to authenticated;
