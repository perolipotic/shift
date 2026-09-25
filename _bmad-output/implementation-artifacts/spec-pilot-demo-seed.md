---
title: 'Pilot demo seed: an on-demand demo organization with four crews of four, ranks and positions, for local and staging'
type: 'chore'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'ee253309ad1f5ea66fa21ed8317c6b964c97638d'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-team-position.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The only pilot data is the test fixture: four members and no teams. It says nothing about rosters, ranks or positions, and there is nothing realistic to show the pilot on staging.

**Approach:**
- An operator SQL script creates a separate demo organization on demand, run locally and on staging, never in production. It is shaped like `supabase/operator/provision-organization.sql`: one `do $$ … $$;` block, one transaction, values from session settings.
- The organization gets four crews of four, each with a commander, a driver and two firefighters, all with ranks, plus the pilot's hour bands and shift types.
- `supabase/seed.sql` and the test fixtures stay untouched.

## Boundaries & Constraints

**Always:**
- **Organization:** slug `dvd-demo`, name `DVD Kaštel Novi (demo)`, type `Fire Department`, `Europe/Zagreb`, `hr`, leave year 1/1, `uses_fire_ranks = true`. These are fixed in the script, because this file IS demo data.
- **People:**
  - one admin, `admin` ("Demo Admin"), with no rank;
  - 16 `member_role` members with fictional Croatian names and ASCII usernames.
- **Crews:** teams `Smjena A` through `Smjena D`. Each crew is one commander, one driver and two firefighters, as membership versions from `2020-01-01`.
  - Commander rank: `officer` or `nco`.
  - Driver rank: `firefighter_1` or `nco`.
  - Firefighter rank: `firefighter` or `trainee`. At least one `trainee` overall.
  - Ranks vary across crews.
- **Pilot configuration:**
  - Hour bands `Dan` at 07:00 and `Noć` at 19:00.
  - Shift types `Dan` 07:00–19:00, `Noć` 19:00–07:00 and `Slobodno` (non-working). Versions start `2020-01-01`, with ascending `created_at` so the ramp slots are Dan 1 and Noć 2.
  - No rotation yet; story 2.3 adds it.
- **Password:** comes from a required session setting, `shift.demo_password`, with no default. If it is missing, the script refuses with a named error.
  - Local: `pnpm db:demo` passes `local-fixture-password`.
  - Staging: the operator passes their own.
  - Hashing follows the operator script's recipe exactly (the provisioning test aggregates it).
- **Re-running replaces the demo.** The script deletes any existing `dvd-demo` organization and the auth users under `@dvd-demo.shift.invalid`, then creates everything again, inside the same transaction. It touches no other organization or user.
- **Attribution:** every `created_by` is the demo admin.
- **Refusal on production:** refuse when the setting `shift.demo_target` is not `local` or `staging`. `pnpm db:demo` sets `local`.

**Ask First:**
- A CI or pipeline step that applies the demo automatically.
- Any change to `seed.sql`, the fixtures or migrations.
- Adding a rotation before 2.3 lands.

**Never:**
- Nothing that runs in production.
- No real crew names.
- No secret key.
- No new dependency.
- No change to migrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First run, local | `pnpm db:demo` after `db reset` | 1 org, 17 members, 4 teams, 16 memberships (4×commander, 4×driver, 8×firefighter), 2 bands, 3 types; admin signs in | N/A |
| Re-run | demo exists, members edited | Same counts and values as a first run; no duplicate auth users | N/A |
| No password | `shift.demo_password` unset | Nothing written | named exception |
| Wrong target | `shift.demo_target` unset or `production` | Nothing written | named exception |
| Other orgs untouched | pilot and UJ-5 fixtures present | Their rows and auth users are byte-identical before and after | N/A |
| Roster | a demo member reads Smjena A | Four entries as `Ime · čin · položaj` | N/A |

</frozen-after-approval>

## Code Map

- `supabase/operator/provision-organization.sql` -- the shape to copy: settings via `current_setting(...,true)`, one `do` block, auth.users and identities rows, the pgcrypto recipe, the `NOTICE` on success.
- `supabase/seed.sql:50-200` -- how fixtures insert org, members, bands, shift types and versions with an explicit `created_at`.
- `supabase/migrations/0014_member_fire_rank.sql`, `0015_team_position.sql` -- the rank and position codes, and the position-needs-team check.
- `package.json:20` -- the `db:provision` script. Add `db:demo`, using `supabase db query --local`, the file, and `PGOPTIONS` with `shift.demo_target=local` and `shift.demo_password=local-fixture-password`.
- `test/provisioning.test.ts:93-190` -- pins the password recipe across the seed and the operator file. The demo file must join that aggregate, or be explicitly listed.
- `test/supabase-scaffold.test.ts:195-234` -- the organization-specifics ban (`coreSql()`) DOES scan `supabase/operator/`, contrary to this line's original assumption. `demo-organization.sql` is exempted by name, and only it: the file is demo data (pilot name, type, zone, locale and shift types, fixed on purpose) and refuses any target but `local`/`staging`, so it never reaches production. `provision-organization.sql` and any later operator file stay in scope.
- `DEPLOY.md` §7 -- add §7.5, "Demo organization (local and staging)": the run commands (`--local`, and `--linked` after `supabase link` to staging), the settings, the re-run semantics, and "never production".

## Tasks & Acceptance

**Execution:**
- [x] `supabase/operator/demo-organization.sql` -- The script, as specified above.
- [x] `package.json` -- Add `db:demo`.
- [x] `test/demo-organization.test.ts` -- A new root DB test. It runs the file inside `begin … rollback` with the settings, and asserts every matrix row: counts, the position mix, ranks set, roster via `team_roster` as a demo member, re-run equality, both refusals, and other orgs unchanged. The shared database is left untouched.
- [x] `test/provisioning.test.ts` -- Include the demo file in the password-recipe aggregate.
- [x] `DEPLOY.md` -- Add §7.5.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- Mark the demo-seed entry `RESOLVED by spec-pilot-demo-seed.md` in its summary, in the same way as earlier resolved entries.

**Acceptance Criteria:**
- Given a fresh local stack, when `pnpm db:demo` runs and the admin signs in at `dvd-demo` in the browser, then Ljudi lists 17 people, and each crew's roster shows four people with rank and position.
- Given the full suite, when it runs, then it passes with no skips and the shared DB has no demo rows left by tests.

## Design Notes

The demo lives in an operator file, not in `seed.sql`, because tests pin `seed.sql` exactly and every worktree shares the stack. Rolling back in the test keeps it hermetic. The pilot fixture `dvd-kastel-novi` stays the test fixture, and `dvd-demo` is what a human looks at. It is a separate organization so that neither can break the other.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips.
- `pnpm db:demo` twice -- exit 0 both times.
- Then `pnpm exec supabase db query --local "select count(*) from members m join organizations o on o.id=m.organization_id where o.slug='dvd-demo'"` -- expect 17.
- `pnpm test:e2e` -- still passes, with the demo applied. The demo must not disturb E2E. Stop the main checkout's Vite on 127.0.0.1:5173 and its `supabase functions serve` first; the human approved this on 2026-09-25. Do not restart them, because the orchestrating session does. The human also approved leaving the demo organization applied in the shared local DB.

## Suggested Review Order

**Refusal before any write**

- The target guard admits only local and staging; everything else raises P0001.
  [`demo-organization.sql:68`](../../supabase/operator/demo-organization.sql#L68)

- A missing or whitespace-only password is refused; a real one is used untrimmed.
  [`demo-organization.sql:76`](../../supabase/operator/demo-organization.sql#L76)

**Replace, then recreate**

- Advisory lock serializes concurrent runs before the destructive part.
  [`demo-organization.sql:82`](../../supabase/operator/demo-organization.sql#L82)

- Re-run semantics: cascade the org, drop demo-domain auth users only.
  [`demo-organization.sql:86`](../../supabase/operator/demo-organization.sql#L86)

- Accounts use the operator script's exact password recipe.
  [`demo-organization.sql:143`](../../supabase/operator/demo-organization.sql#L143)

- Four crews: commander, driver, two firefighters, versioned from 2020-01-01.
  [`demo-organization.sql:177`](../../supabase/operator/demo-organization.sql#L177)

- Bands and shift types with ascending created_at, so ramp slots are Dan 1, Noć 2.
  [`demo-organization.sql:194`](../../supabase/operator/demo-organization.sql#L194)

**Guard exemption**

- The org-specifics ban skips the demo file by name alone, with the reason.
  [`supabase-scaffold.test.ts:68`](../../test/supabase-scaffold.test.ts#L68)

**Operator docs**

- How to run locally and on staging, verify, remove, and what a re-run loses.
  [`DEPLOY.md:762`](../../DEPLOY.md#L762)

**Tests and wiring**

- Static checks: guard shape and `db:demo` PGOPTIONS parsed and reused by every case.
  [`demo-organization.test.ts:262`](../../test/demo-organization.test.ts#L262)

- Roster as a member: each crew is four `Ime · čin · položaj` lines.
  [`demo-organization.test.ts:452`](../../test/demo-organization.test.ts#L452)

- Re-run equality, with a stray auth user and an extra team removed.
  [`demo-organization.test.ts:530`](../../test/demo-organization.test.ts#L530)

- Refusals run inside a rolled-back transaction and assert SQLSTATE and message.
  [`demo-organization.test.ts:641`](../../test/demo-organization.test.ts#L641)

- Demo accounts pass the same recipe health checks as the fixtures.
  [`provisioning.test.ts:470`](../../test/provisioning.test.ts#L470)

- The local entry point.
  [`package.json:21`](../../package.json#L21)
