-- seed.sql — LOCAL AND TEST ONLY.
--
-- This file is loaded by `supabase db reset` against a local database and by
-- the test harness. It is never bundled into the SPA, never applied to staging
-- or production, never a default for a real organization, and no application
-- code branches on anything defined here.
--
-- Two fixtures live here, and every rule in the system is asserted against
-- both (AD-15):
--
--   * the pilot organization — the real shape the MVP was designed around;
--   * the UJ-5 security organization — structurally different, and the fixture
--     that proves isolation: a valid session in one must never read the other.
--
-- The sections below are intentionally empty. No table exists yet — the schema
-- arrives in story 1.2 — so there is nothing to insert. The section headers
-- reserve the shape and the order so 1.2 fills them in rather than inventing a
-- layout, and so `supabase db reset` succeeds today.


-- ===========================================================================
-- Fixture 1 — the pilot organization
-- ===========================================================================
-- Populated in story 1.2 onward, in dependency order:
--   organizations -> members -> teams -> team_memberships
--   -> hour_bands -> shift_types -> shift_type_versions
--   -> rotation_patterns -> rotation_steps -> rotation_assignments
--   -> leave_records
-- Attribution comes from column defaults (AD-11), so inserts here must not
-- forge created_by or created_at.


-- ===========================================================================
-- Fixture 2 — the UJ-5 security organization
-- ===========================================================================
-- Structurally different from the pilot on purpose: a different team count, a
-- different rotation shape and its own admin. Its only job is to be the other
-- tenant, so that a cross-tenant read with a valid session can be asserted to
-- fail closed and an administrative write by a member-role account can be
-- asserted to be refused identically via the UI and via direct API.
