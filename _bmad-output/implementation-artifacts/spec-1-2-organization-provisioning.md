---
title: 'Story 1.2 — An operator provisions an organization that is born with an admin'
type: 'feature'
created: '2026-09-04'
status: 'done'
review_loop_iteration: 1
baseline_commit: '68df5221339dbfbc2b6a59424fe7e7e93d6cc805'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `select count(*) from pg_tables where schemaname='public'` returns 0 — the database has no schema at all. `admin-auth` answers 501 to every operation because there is no `members` table to authorize against (`handler.ts:187-190`), `seed.sql` reserves both fixture sections and inserts nothing, and no tenant or account exists for anyone to sign into. Verified during planning: email/password sign-in is additionally disabled outright by `config.toml`, so even a correctly provisioned admin cannot authenticate.

**Approach:** Write the first schema migration — `organizations` and `members`, RLS enabled with zero policies so both are deny-all until 1.3 writes them — carrying the one deferrable constraint trigger AD-3 permits, for the zero-admins rule. Add an operator provisioning script run as a single `do $$ … $$` statement through `pnpm exec supabase db query`, using the database password and never the secret key. Fill both seed fixtures, correct the auth-provider config, and stand up this repo's first live-database test harness so the refusals are executed rather than read.

## Boundaries & Constraints

**Always:**
- Migration is exactly `supabase/migrations/0002_<snake_case>.sql`, contiguous after 0001, following 0001's header convention (bare filename, forward-only restatement, a *why* paragraph citing the ADs).
- `organization_id` is the **first** column of every organization-scoped table, `not null`, FK to `organizations`. `snake_case`, plural tables, singular columns, database-generated `uuid` keys.
- No `timestamptz` outside `created_at`. Dates `date`, times `time` without zone.
- **No pilot specific in the migration** (`SPEC.md:108`) — no default, branch or comment encoding `Dan`/`Noć`, four teams, twelve hours, fire departments or Croatian. Pilot values exist only in `seed.sql`.
- `members` carries **no** `is_active` and **no** `team_id`. AD-2 classifies active status and team membership as versioned; they are 1.6's and 1.7's tables.
- AD-11 attribution does **not** apply to `organizations`/`members` — it attaches to overrides, leave records and resolutions. Add no `created_by` default here.
- The zero-admins refusal raises a stable `SCREAMING_SNAKE` code in `MESSAGE` with `errcode = 'check_violation'` (23514), never prose (AD-8). Postgres rejects a non-standard condition name in `errcode` (`unrecognized exception condition` — verified), so the code travels in the message and the i18n edge reads `message`. Amended by human direction 2026-09-04; the original text named a mechanism that does not exist.
- Exactly one constraint trigger exists in the schema after this story. AD-3 spends its whole budget here.
- Role values are `admin` and `member_role`. Bare `member` for the permission level is a stated glossary contract violation.
- Seed inserts must not forge `created_by`/`created_at` (`seed.sql:29-30`), and the strings `pilot organization` and `UJ-5 security organization` must survive in the file.
- `supabase/functions/` still contains exactly `['admin-auth']`.
- No `.sql` or `.toml` outside `supabase/functions/` may contain `sb_secret_` or name `SHIFT_SECRET_KEY`, even in a comment (`test/key-hygiene.test.ts:171-187`).

**Ask First:**
- Any second constraint trigger, or any rule that cannot be expressed as schema shape (AD-9 escalates to the spine rather than adding a function).
- Any change to `verify_jwt`, `OPERATIONS`, or the 501 path in `admin-auth`.
- Any departure from the pilot's author-confirmed rotation, team or shift-type data.

**Never:**
- No RLS **policies** and no custom access token hook — 1.3 owns both, and its two security tests are written there.
- No `teams`, `team_memberships` or versioned-status tables; no member-management or sign-in UI.
- No second Edge Function, and no change to `admin-auth`'s behaviour.
- No secret key reachable by the provisioning script; no `psql` dependency (it is not installed on the operator machine — verified).
- No product surface that creates an organization (`prd.md:144-151`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Provision | No organization exists; operator supplies organization attributes, admin name and credentials | Organization, `auth.users` + `auth.identities`, and the admin `members` row created in one transaction | N/A |
| Provision without an admin | Organization attributes only | Whole transaction refused; no organization row persists | `ORGANIZATION_WITHOUT_ADMIN` |
| Delete the last admin | Organization with exactly one admin | Refused at commit by the constraint trigger | `ORGANIZATION_WOULD_HAVE_NO_ADMIN` |
| Downgrade the last admin | Same, role set to `member_role` | Refused at commit | `ORGANIZATION_WOULD_HAVE_NO_ADMIN` |
| Swap the admin in one transaction | Insert a second admin, then demote the first | Permitted — the trigger is `deferrable initially deferred`, so only the end state is checked | N/A |
| Delete a non-last admin | Organization with two admins | Permitted | N/A |
| Org-scoped row without its organization | `insert into members` omitting `organization_id` | Refused by `not null` | Postgres `23502` |
| Anonymous read | Publishable key, no session | Zero rows — RLS on, no policy | N/A |

</frozen-after-approval>

## Code Map

**Baseline `68df5221`**, green: build, lint, typecheck clean, **998 tests** (822 root + 172 `apps/web` + 4 `packages/domain`) under Node 24.19.0. The shell default is Node 20.20.2, which pnpm 11 rejects and which fails four `format.test.ts` cases — `nvm use` first or the baseline reads red for the wrong reason.

- `supabase/migrations/0001_extensions.sql:1-9` — the header convention to copy verbatim in shape; `:11` enables `btree_gist`, pinned by `test/supabase-scaffold.test.ts:62-66`. Do not edit this file.
- `test/supabase-scaffold.test.ts:20,43-59` — `MIGRATION_NAME` regex `^(\d{4})_[a-z0-9_]+\.sql$` plus contiguity. **`supabase migration new` emits a timestamp name and fails this** — create the file by hand as `0002_…`.
- `test/supabase-scaffold.test.ts:68-87` — asserts the seed contains no executable SQL. Its own comment at `:74-77` says **"EXPECTED TO BE DELETED IN STORY 1.2 … remove it rather than weakening it."** Delete the assertion; keep the sibling fixture-string assertions at `:71-72`.
- `test/supabase-scaffold.test.ts:23-29` — `expect(functions).toEqual(['admin-auth'])`. Nothing may land in `supabase/functions/`, so the provisioning script goes in a new `supabase/operator/`.
- `supabase/seed.sql:21-40` — the reserved shape: two `=`-ruled fixture headers, the mandated insert order (`organizations -> members -> teams -> …`) at `:24-28`, the no-forged-attribution rule at `:29-30`, and fixture 2's requirements at `:36-40` (different team count, different rotation shape, its own admin). This story fills `organizations` and `members` under both headers only.
- `supabase/config.toml:47-48` — **`[auth.email] enable_signup = false` maps to `GOTRUE_EXTERNAL_EMAIL_ENABLED=false`, which disables the email/password provider entirely, not just signup.** Verified against the running container: with it `false`, a password grant returns `422 "Email logins are disabled"`; with it `true`, sign-in succeeds and open signup is *still* refused `422 signup_disabled`, because that is governed separately by `[auth] enable_signup = false` → `GOTRUE_DISABLE_SIGNUP=true` (`:44`). The comment at `:42-43` describes the intended posture correctly; the value below it does not implement it.
- `supabase/config.toml:13` — only `public` and `graphql_public` are API-exposed; `:19` Postgres 17; `:22-24` the seed loads automatically on `db reset`, so a broken statement there breaks `db reset` for everyone.
- **`pnpm exec supabase db query` runs one prepared statement** — verified: a multi-statement `begin; … commit;` file fails with `cannot insert multiple commands into a prepared statement`. A single `do $$ … $$;` block succeeds and is implicitly one transaction. `db query --local -f <path>` is the invocation; `db execute` does not exist. **`psql` is not installed on this machine**, so the runbook cannot assume it.
- **Verified `auth.users` recipe.** Only `id` is `not null` without a default, but GoTrue scans four nullable columns into non-nullable Go strings, and leaving them `null` makes sign-in fail with `500 "Database error querying schema"`: `confirmation_token`, `recovery_token`, `email_change`, `email_change_token_new` must each be `''`. A matching `auth.identities` row is required — `provider 'email'`, `provider_id` = the user id as text, `identity_data` carrying `sub` and `email`. With that, a synthesized non-routable address (`…@<slug>.shift.invalid`, AD-12) authenticates and the JWT carries `role: authenticated` and **no** `organization_id` claim — confirming AD-10's claim is 1.3's hook to add.
- `extensions.crypt(password, extensions.gen_salt('bf'))` — `pgcrypto` is installed in the `extensions` schema (verified). Schema-qualify it; do not rely on the connection's `search_path`.
- `supabase/functions/admin-auth/handler.ts:117-128` — the `{ code, ...operands }` response shape and SCREAMING_SNAKE vocabulary this story's error codes must match. `:187-190` and `index.ts:25-32` name story 1.2 as the story bringing `members`; both are comments only — **leave the function untouched**, since its 501 path is pinned at `test/admin-auth-boundary.test.ts:53-59`, `DEPLOY.md:96-97` and `DEPLOY.md:321-325`.
- `test/key-hygiene.test.ts:58-71` — the per-extension comment-stripping table already carries `'.sql': [BLOCK_COMMENT, LINE_DASH]`; `:171-187` pulls every new `.ts`/`.sql`/`.toml` under `supabase/` into the privileged-naming scan automatically.
- `vitest.config.ts:10-15` — root project, node environment, `test/**/*.test.ts`. No `setupFiles`, no `globalSetup`, no CI anywhere. **No `pg`, `postgres`, `@supabase/supabase-js` or `testcontainers` is installed at any level** — the live-database harness is built from nothing here.
- `test/static-hosting.test.ts:13-15` — the `skipIf`-never-`return` rule, with the reason: "a build-less checkout must report these as skipped instead of reporting green having asserted nothing." Same shape applies to a database-less checkout.
- `test/theme-contrast.test.ts:142-148` — the `flatMap` + `it.each` + `$field` row idiom to copy for the two-fixture matrix. `test/supabase-scaffold.test.ts:16` — `repoRoot` via `fileURLToPath(new URL('..', import.meta.url))`. `test/typography-coverage.test.ts:20-21` — lazy reads, never module scope. `packages/domain/test/purity.test.ts:104-106` — the vacuous-pass guard. Every non-trivial `expect` takes a custom message as its second argument (`test/supabase-scaffold.test.ts:41`); `describe` states the invariant as a sentence, `it` is verb-first and never says "should".
- `.npmrc:5-9` — `node-linker=isolated`, `save-exact=true`; a new devDependency must be an exact pin and clear the 24-hour gate. `test/workspace-isolation.test.ts:45-58` asserts the linker setting.
- `eslint.config.js:101-112` — `no-console: ['error', { allow: ['error','warn'] }]` applies to every `.ts`; `:278-288` the node-globals block does **not** list a new directory, and `tsconfig.json:16-20` includes only `test/**`, `supabase/functions/**` and `vitest.config.ts`. A TypeScript CLI in a new directory would be linted and type-checked by nothing — which is a reason this story's provisioning artifact is **`.sql`, not TypeScript**.
- `packages/domain` — `eslint.config.js:240-261` bans `@supabase/*` there and `purity.test.ts:101-108` forbids every bare import in `src`. No database access or generated type may ever live in the domain package.
- `DEPLOY.md:216-230` — the migration authoring loop; `:209-298` the promotion runbook; `:293-298` a failed push is fixed by the next migration, never by editing the failed one. DEPLOY.md documents **no** operator provisioning command today; this story writes the first.

## Tasks & Acceptance

**Execution:**

- [x] `supabase/migrations/0002_organizations_and_members.sql` — create `organizations` (identity, Organization Type, timezone, locale, leave-year start) and `members` (`organization_id` first, `auth_user_id` FK to `auth.users`, name, optional email, `role`, leave allowance), both `enable row level security` with **no** policies; a `role` enum or check admitting `admin`/`member_role`; a unique index supporting Q20's member-list reads. Copy 0001's header shape and cite AD-3, AD-9, AD-10, Q3, Q5.
- [x] `supabase/migrations/0002_…sql` (same file) — the zero-admins `create constraint trigger … deferrable initially deferred` on `members`, raising `ORGANIZATION_WOULD_HAVE_NO_ADMIN`. Deferred is what keeps a legal admin-swap transaction legal; a non-deferred trigger would refuse it.
- [x] `supabase/operator/provision-organization.sql` — one `do $$ … $$;` block creating the `auth.users` row (four token columns `''`, `extensions.crypt` password), the `auth.identities` row, the organization, and the first admin's `members` row; raising `ORGANIZATION_WITHOUT_ADMIN` when admin details are absent. Parameters read from `current_setting('shift.<name>')` so no value is string-interpolated into SQL.
- [x] `supabase/config.toml` — set `[auth.email] enable_signup = true` so the email/password provider is on, leaving `[auth] enable_signup = false` to block open signup. Correct the comment to name both switches, because the current one describes an intent the file does not implement.
- [x] `supabase/seed.sql` — fill `organizations` and `members` under both fixture headers: the pilot (`DVD Kaštel Novi`, Fire Department, `Europe/Zagreb`, `hr`) with its admin, and the UJ-5 security organization with its own admin. Keep both header strings; do not set `created_by`/`created_at`; leave the later sections reserved.
- [x] `package.json` — add `pg` as an exact pinned devDependency (the only way to execute a refusal rather than read it) and a `db:provision` script wrapping `supabase db query --local -f supabase/operator/provision-organization.sql`.
- [x] `test/supabase-scaffold.test.ts` — delete the no-executable-SQL assertion at `:68-87` per its own instruction; keep `:71-72`; add assertions that `0002` exists, that no pilot literal appears in any migration, and that `supabase/operator/` holds no second Edge Function.
- [x] `test/provisioning.test.ts` — new. Connect via `pg` to the local stack's `DB_URL` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres` — the CLI's fixed local default, read from `SUPABASE_DB_URL` when set so no credential is hard-coded for any other environment), gate with `it.skipIf(noDatabase)` after a short connection probe, and drive every I/O matrix row against **both** fixtures using the `flatMap` + `$fixture` row idiom. Each refusal case asserts the raised code, not merely that it threw. Must include a vacuous-pass guard asserting both fixtures were actually found, so a seed that silently loaded nothing cannot report green.
- [x] `DEPLOY.md` — document the operator provisioning procedure (its `db query --local -f` invocation, the `set` parameters, the database-password credential, and that the secret key is not involved), and note in §5.1 that migrations are hand-numbered because `supabase migration new` produces a name the suite rejects.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` — append: that `test/provisioning.test.ts` reports green when skipped and needs CI with a database before it is load-bearing; that generated database types have no home yet (`apps/web/src/supabase/`, not the domain package); and that the `auth.users` insert is coupled to GoTrue's internal column expectations and should be re-verified on each Supabase upgrade.

**Acceptance Criteria:**

- Given a database with only `0001` applied, when `pnpm exec supabase db reset` runs, then both migrations apply, both fixtures load, and the command exits 0.
- Given the provisioning script and a fresh database, when an operator runs it with organization and admin parameters, then exactly one organization and exactly one admin exist and the admin authenticates against the local auth endpoint with a synthesized non-routable address.
- Given a provisioned organization, when any path attempts to leave it with zero admins, then the database refuses with `ORGANIZATION_WOULD_HAVE_NO_ADMIN` and the refusal is the only constraint trigger in `pg_trigger` for the schema.
- Given the publishable key and no session, when `members` or `organizations` is read through PostgREST, then zero rows return, because RLS is on and no policy exists yet.

## Spec Change Log

Four corrections found during implementation. None touches the frozen section.

1. **`errcode` cannot carry a `SCREAMING_SNAKE` name.** The Always constraint says the zero-admins refusal "raises a stable `SCREAMING_SNAKE` code via `errcode`". Postgres accepts only a five-character SQLSTATE or one of its own condition names there; `raise ... using errcode = 'ORGANIZATION_WOULD_HAVE_NO_ADMIN'` fails with `unrecognized exception condition` (verified against the running stack). Implemented as `errcode = 'check_violation'` (23514 — a deferred constraint trigger *is* a check violation, and it is what makes PostgREST answer 400 rather than 500) with the code in `MESSAGE` and the organization id in `DETAIL`, so the raised error is still `{code, ...operands}` and carries no prose. `ORGANIZATION_WITHOUT_ADMIN` is raised the same way. On the ledger for the edge translator.

2. **The manual `pg_trigger` check as written returns 7, not 1.** Every foreign key is implemented as a trigger carrying a constraint oid, and both `members` and `organizations` are in `public`, so `t.tgconstraint <> 0` counts all of them. Add `and not t.tgisinternal`, or count `pg_constraint where contype = 't'` instead — both return 1. `test/provisioning.test.ts` and DEPLOY.md §7.4 use the corrected form.

3. **`pg` needs `@types/pg`.** `pg@8.23.0` ships no type declarations, and the workspace type-checks `test/**`, so the exact-pinned devDependency is two packages rather than one (`pg` 8.23.0, `@types/pg` 8.23.1; both clear the release-age gate, and pnpm's supply-chain check passed).

4. **The synthesized address needs a slug that is stored.** The Code Map fixes the address shape as `…@<slug>.shift.invalid`, but names no source for the slug, and story 1.5 has to rebuild the same addresses when it issues further credentials. `organizations.slug` was therefore added as part of identity — `not null unique`, constrained to a legal DNS label — rather than deriving it from the name, which would mean transliterating Croatian and is not a reproducible function. The consequence for story 1.3 is on the deferred ledger: the sign-in screen collects a username only, and cannot build a slug-namespaced address without knowing the organization.

### 2026-09-04 — iteration 1, three adversarial layers

**Handling deviation, human-directed.** Five findings classified `bad_spec`, whose prescribed handling is revert-and-re-derive. The human directed **amend the spec, fix in place** instead, as on 1.1d: every finding is additive — four missing assertions, two wrong parameter values, one undeclared extension — so a re-derive would regenerate near-identical code at full cost while risking the parts already proven green.

**Triggering findings.** Four mutations passed all 1024 tests. (1) Deleting the four `''` token columns or the whole `auth.identities` block from **`seed.sql`** leaves the suite green while both fixture admins silently lose the ability to sign in — the operator script's copy of the recipe is asserted, the seed's identical copy is not. (2) Replacing `crypt(...)` with the bare password, or corrupting `identity_data`, passes all twenty provisioning cases, because they count rows and never exchange the credential for a token — the one thing the recipe exists for is checked only by a human running curl. (3) Removing `security definer` or `set search_path = ''` is invisible, because every mutating test connects as `postgres`, which is `rolbypassrls`; the failure lands on story 1.3, where an invoker-mode function would refuse every legal member delete. (4) Deleting the organization-still-exists guard makes tenants permanently undeletable with no test noticing — deletion was confirmed working, so this is an unprotected path rather than a live defect. Two further findings were prescription errors in this spec: the Code Map dictated `gen_salt('bf')`, which is bcrypt cost 6 against GoTrue's 10 and applies to the **production** first admin, and it told the implementer to rely on `pgcrypto` being preinstalled rather than declare it, in a repo whose `0001_extensions.sql` exists to declare exactly that.

**What was amended.** Ten proofs added to Verification, covering the seed's copy of the recipe, an executed sign-in, both security attributes of the trigger function, the organization-delete path, the bcrypt cost and the `pgcrypto` declaration. The frozen `errcode` constraint was corrected by human direction, having named a mechanism Postgres rejects.

**Known-bad state avoided.** Two fixtures that exist but cannot authenticate; a production first admin hashed weaker than the platform's own default; and security attributes the migration argues for at length that any later edit could remove with a green suite.

**KEEP — must survive any re-derivation.**
- `organizations.slug` as a stored, constrained column. The address shape needs a reproducible source and deriving it from a Croatian name is not a function.
- `errcode = 'check_violation'` (23514) with the code in `MESSAGE` — it is what makes PostgREST answer 400 rather than 500.
- Counting `pg_constraint where contype = 't'` rather than `pg_trigger`, which the implementation caught and the spec had wrong.
- The `inRolledBackTransaction` harness and the both-fixtures `$fixture` row titles.

## Design Notes

**Why the provisioning artifact is SQL and not TypeScript.** AD-17 confines the secret key to the Edge Function's environment and names a migration as a place it must never reach; a Node CLI calling `auth.admin.createUser()` would put `sb_secret_*` into an operator shell and amend AD-17 rather than satisfy it. A SQL script authenticates with the database password the operator already holds for `supabase db push`, involves no key, and makes "a single transaction" literally true across the auth and domain rows. It also sidesteps the wiring gap at `tsconfig.json:16-20` and `eslint.config.js:278-288`, where a new TypeScript directory is covered by nothing. The cost is coupling to GoTrue's internal expectations, which is why the recipe was verified against a running stack rather than assumed, and why it is going on the ledger for re-verification on upgrade.

**Proposed fixture data — approve or amend at the checkpoint.** None of this is fixed in any planning artifact; it becomes the shape every later test asserts against.

| Fixture | Field | Proposed | Why |
|---|---|---|---|
| Pilot | Organization | `DVD Kaštel Novi`, Fire Department, `Europe/Zagreb`, `hr` | author-confirmed, `addendum.md:18-25` |
| Pilot | Leave Year start | `01-01` | unspecified anywhere; the calendar year is the unmarked case and the glossary allows any |
| Pilot | Leave Allowance | 20 days | unspecified; the Croatian statutory minimum, and a value nothing branches on |
| Pilot | Members | 1 admin + 3 member-role | enough to prove role refusals; 1.5 grows the list to Q20 scale |
| UJ-5 | Organization | `Zaštita Split`, Security, `Europe/Zagreb`, `hr` | `engine-rules.md:181` fixes three teams / five-slot / 8-hour but names no organization |
| UJ-5 | Members | 1 admin + 2 member-role | its own admin is required by `seed.sql:36-40` |

Team, shift-type and band rows for both fixtures stay absent — those tables arrive in 1.7 and Epic 2, and the seed's reserved order already anticipates them.

**Why `member_role` and not `member`.** `glossary.md:9-10` states that "Member" always means the person and never the permission level, and that a synonym is a contract violation. A `role` column whose value is `member` writes the forbidden synonym into the data itself, where every later query and fixture repeats it.

## Verification

**Commands:**
- `nvm use` — expected: Node 24.19.0. Without it pnpm 11 refuses to run and four `format.test.ts` cases fail for an unrelated reason.
- `pnpm exec supabase start && pnpm exec supabase db reset` — expected: exit 0, `0001` and `0002` applied, `seed.sql` loaded with no error.
- `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` — expected: exit 0, 998 tests plus this story's additions, no skipped suite while the stack is up.
- `pnpm test` with the stack **stopped** — expected: `test/provisioning.test.ts` reports skipped, never green-having-asserted-nothing.

**Mutation proofs — one per Always constraint and per I/O matrix row.** Each must fail, then be reverted.

| Mutation | Must fail because |
|---|---|
| drop `deferrable initially deferred` from the trigger | a legal admin-swap transaction must stay legal |
| delete the constraint trigger | the last admin becomes deletable |
| change the trigger to fire on `delete` only | a role downgrade is the other half of Q6 |
| make `organization_id` nullable on `members` | Q3 is a `not null`, not a convention |
| move `organization_id` out of first position | the ordering rule is asserted, not stylistic |
| add a second constraint trigger | AD-3's budget is one |
| remove `enable row level security` from either table | both must be deny-all before 1.3 |
| add an RLS policy | 1.3 owns policies; a permissive one here would be invisible until then |
| set `[auth.email] enable_signup = false` again | the provisioned admin must actually authenticate |
| leave `confirmation_token` null in the provisioning script | sign-in fails with a 500 that names no cause |
| omit the `auth.identities` insert | a password grant cannot resolve the user |
| put `Dan` or a four-team default in the migration | `SPEC.md:108` forbids a pilot specific in the core |
| add `is_active boolean` to `members` | AD-2 classifies active status as versioned |
| drop one fixture from `seed.sql` | every rule is asserted against both |
| delete the four `''` token columns from **`seed.sql`**'s auth block | the seed's copy of the recipe must be asserted, not just the operator script's |
| delete the `auth.identities` insert from **`seed.sql`** | both fixture admins must remain able to sign in |
| replace `crypt(...)` with the bare password in the operator script | a provisioned credential must be proven to authenticate, not merely to exist |
| corrupt `sub` or `email` in the operator script's `identity_data` | the identity payload is what a password grant resolves through |
| drop `security definer` from `refuse_organization_with_no_admin` | tests run as a `BYPASSRLS` role, so this is invisible until 1.3 breaks |
| drop `set search_path = ''` from the same function | the resolution path the migration's own comment closes |
| delete the organization-still-exists guard in the trigger function | a tenant becomes permanently undeletable |
| lower `gen_salt('bf', 10)` back to `gen_salt('bf')` | cost 6 is weaker than the cost 10 GoTrue itself uses |
| remove the `pgcrypto` declaration from the migration | the dependency must be declared, not inherited from the image |

**Corrections to this section, 2026-09-04 (iteration 1).** The fourteen proofs above the rule tested what the story *added* and missed four gaps that survived a green suite — the same omission 1.1d recorded. The rule is now that every **Always** constraint, every I/O matrix row, **and every security attribute the migration argues for** carries a proof. Two prescriptions in this spec were themselves wrong and are corrected here: the Code Map's `extensions.crypt(password, extensions.gen_salt('bf'))` must read `gen_salt('bf', 10)`, and `pgcrypto` must be declared by the migration rather than assumed present.

**Manual checks:**
- `select count(*) from pg_constraint where contype = 't' and connamespace = 'public'::regnamespace` returns exactly 1. (The `pg_trigger`/`tgconstraint <> 0` form previously printed here returns 7 — every foreign key is a constraint-carrying trigger.)
- A password grant against the local auth endpoint with the pilot admin's synthesized address returns an access token; the same call for a non-existent username does not.

## Suggested Review Order

**The tenant reference, and why it is structural**

- Q3 as schema shape: `organization_id` first, not null, a foreign key.
  [`0002:115`](../../supabase/migrations/0002_organizations_and_members.sql#L115)

- Identity plus the stored slug the synthesized address is rebuilt from.
  [`0002:58`](../../supabase/migrations/0002_organizations_and_members.sql#L58)

**The one refusal AD-3 could not make unrepresentable**

- Deferred, so a legal admin swap inside one transaction still commits.
  [`0002:242`](../../supabase/migrations/0002_organizations_and_members.sql#L242)

- `security definer` is load-bearing: an invoker would read zero rows under RLS.
  [`0002:231`](../../supabase/migrations/0002_organizations_and_members.sql#L231)

**Deny-all until story 1.3**

- RLS on, no policy — a session reads nothing until 1.3 authors one.
  [`0002:173`](../../supabase/migrations/0002_organizations_and_members.sql#L173)

- The dependency declared rather than inherited from the Supabase image.
  [`0002:56`](../../supabase/migrations/0002_organizations_and_members.sql#L56)

**Provisioning, outside the application and without the secret key**

- Refused before any auth row is written when admin details are absent.
  [`provision:91`](../../supabase/operator/provision-organization.sql#L91)

- Cost 10 matches GoTrue; the bare default would be cost 6.
  [`provision:143`](../../supabase/operator/provision-organization.sql#L143)

- Without this row a password grant cannot resolve the account at all.
  [`provision:158`](../../supabase/operator/provision-organization.sql#L158)

**The config defect this story found**

- The provider switch, distinct from the signup switch above it.
  [`config.toml:60`](../../supabase/config.toml#L60)

**Verification**

- The only case that leaves the database and asks GoTrue for a token.
  [`provisioning.test.ts:775`](../../test/provisioning.test.ts#L775)

- One aggregate holding both copies of the recipe to the same couplings.
  [`provisioning.test.ts:171`](../../test/provisioning.test.ts#L171)

- Both fixtures, so no rule is asserted against a single tenant.
  [`provisioning.test.ts:291`](../../test/provisioning.test.ts#L291)
