---
title: 'Story 1.3a — The access-control layer'
type: 'feature'
created: '2026-09-07'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'a1416a3e3a1af5c2644055e8dbbd31678408deea'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Both tables are RLS-enabled with zero policies, so the provisioned tenant is governed by nothing and reachable by no one — verified live: `organizations` and `members` each return `[]` to `anon` *and* to a real authenticated token. No JWT carries `organization_id`, no policy or `security definer` helper for the current user exists anywhere in the repo, and `admin-auth` answers 501 precisely because it cannot read `members` as its caller. Epic 1 calls this the pattern every later read and write is written against, and none of it exists.

**Approach:** Write migration `0003`: a `security definer stable` helper resolving the caller's organization, role and active state fresh on every policy evaluation; a custom access token hook putting `organization_id` into the JWT; and the first RLS policies on both tables. Then build the repo's first *authenticated* test harness — real password grants plus real PostgREST calls over `fetch` — so tenant isolation and role refusal are executed rather than read, and become the regression suite later epics re-run.

## Boundaries & Constraints

**Always:**
- Migration is exactly `supabase/migrations/0003_<snake_case>.sql`, contiguous after `0002`, copying `0002`'s header shape: bare filename, the forward-only restatement, `--`-separated *why* paragraphs citing decision ids, and a block comment above every DDL element.
- The helper carries all three security attributes of `0002`: `security definer` (`:195`), `set search_path = ''` (`:196`), and an explicit `revoke execute … from public` (`:231`). With an empty `search_path`, every relation is schema-qualified.
- `organization_id` is read from the JWT claim. Role and active state are read **fresh from tables** via the helper, never from a claim (AD-10). Never trust a client-supplied organization or role.
- The domain role never enters any claim, and in particular never the `role` claim — PostgREST owns that one and its value is `authenticated`.
- Exactly one constraint trigger exists after this story. `test/provisioning.test.ts:522-528` is labelled NOT to be deleted here; a cross-row rule RLS cannot express escalates to the spine (AD-9), never to a second trigger.
- `members` gains no `is_active`, `active` or `team_id` column — `test/provisioning.test.ts:598-615` asserts their absence and AD-2 makes them 1.6's and 1.7's versioned tables. Active state here is `auth.users.banned_until`, read fresh.
- Write policies pin `organization_id` in `with check` as well as `using`, so no row can be moved between tenants by an otherwise-legal update.
- No `grant` or `revoke` on either table. `0002:160-172` explains that Supabase's default `public` grants are what make a policy-less table return zero rows rather than `permission denied`, and that writing table grants here is deliberately avoided.
- Migration prose avoids `\b(dan|noć|slobodno)\b`, IANA timezones and every pilot literal — `test/supabase-scaffold.test.ts:190-229` sweeps all migrations *and* everything under `supabase/operator/`.
- Tokens are ES256-signed. A test obtains one by exchanging credentials at `/auth/v1/token?grant_type=password`; it never constructs or signs one.

**Ask First:**
- Adding a second Edge Function (forbidden by AD-16 and `test/supabase-scaffold.test.ts:57-63`), or touching `admin-auth`, whose 501 path is pinned in three places.
- Adding any npm dependency. This story needs none: Node's global `fetch` reaches PostgREST, and `pg` is already pinned.
- Weakening — rather than deleting or narrowing exactly as instructed — any of the three assertions labelled for this story.
- Any anonymous read path, RPC or view that would let a caller enumerate usernames or organizations.

**Never:**
- No jsdom, no `.tsx` test, no rendered component (AD-15).
- No security assertion on a bare `postgres` connection. `postgres` is `rolbypassrls`, so an un-roled read proves nothing and passes vacuously against no policy at all.
- No front-end change of any kind. The browser client, the address module, `/prijava/$slug`, the organization prompt, `/`'s conditional and the new resource strings are all deferred to the sign-in story and recorded on the ledger.
- No decision on committing generated database types — that stays on the ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Own-organization read | Valid session, org A | Own organization row; own organization's members | N/A |
| Cross-tenant read, direct API | Org A token, `GET /rest/v1/members` | Only org A rows — filtered by policy, not by the caller | N/A |
| Cross-tenant read by explicit id | Org A token, `?organization_id=eq.<org B>` | Zero rows | N/A |
| Anonymous read | Publishable key, no session | Zero rows, both tables | N/A |
| Member-role administrative update | member_role token, `PATCH /rest/v1/members` setting `role` | Target row **unchanged**; zero rows affected | HTTP 204, no error body |
| Member-role insert | member_role token, `POST /rest/v1/members` | Refused by `with check` | `42501` / HTTP 403 |
| Member-role delete | member_role token, `DELETE /rest/v1/members` | Target row still present | HTTP 204 |
| Admin write, own organization | admin token, updates a member's leave allowance | Permitted | N/A |
| Admin delete, own organization | admin token, `DELETE /rest/v1/members` targeting an own-organization member | Row removed — the positive control without which the delete policy's absence is indistinguishable from its working | N/A |
| Admin write, another organization | Org A admin token, targets an org B member | Zero rows affected; row unchanged | HTTP 204 |
| Admin delete, another organization | Org A admin token, `DELETE` targeting an org B member | Row still present | HTTP 204 |
| Tenant-move attempt | Org A admin sets a member's `organization_id` to org B | Refused by `with check` | `42501` / HTTP 403 |
| Cross-tenant insert attempt | Org A admin `POST`s a member carrying org B's `organization_id` | Refused by `with check` — the insert-side twin of the tenant move | `42501` / HTTP 403 |
| Role downgraded mid-session | Admin session held; role set to `member_role`; same session | The very next statement already refuses the administrative write, with no token refresh | N/A |
| Account banned mid-session | Session held; `banned_until` set in the future | The very next statement returns zero rows from `members` **and** from `organizations` | N/A |
| Banned admin attempts a write | Admin session held; `banned_until` set in the future | The very next insert, update and delete are all refused, because `is_active` gates the write policies and not only the read | `42501` on insert; HTTP 204 and no row change on update/delete |
| Ban expired | `banned_until` in the past | Treated as active | N/A |
| Token with no organization claim | A session predating the hook | Zero rows rather than cross-tenant rows — the claim's absence fails closed | N/A |
| Hook output | Any successful sign-in | Claims carry `organization_id` for the signer's own organization and no domain role | N/A |

</frozen-after-approval>

## Code Map

**Baseline `a1416a3e3a1af5c2644055e8dbbd31678408deea`**, green: 1024 tests under Node 24.19.0. The shell default is 20.20.2, which pnpm 11 rejects and which fails four `format.test.ts` cases — `nvm use` first or the baseline reads red for the wrong reason. `pnpm test` never builds (`package.json:15` has no `pretest`).

### Verified live against the running stack, 2026-09-07

- **The hook mechanism is real on the pinned CLI.** The `2.116.0` binary contains `hook.custom_access_token`, `custom_access_token_enabled`, `custom_access_token_uri`, `custom_access_token_secrets` and the `pg-functions://` scheme. GoTrue is `v2.196.0`; its container has **no** `GOTRUE_HOOK_*` variable, so nothing is configured today. A `config.toml` change does not reach a running container — the stack must be restarted.
- **A fixture credential really does authenticate.** `POST /auth/v1/token?grant_type=password` with `{"email":"ivan.maric@dvd-kastel-novi.shift.invalid","password":"local-fixture-password"}` returns 200 and a token. Header `{"alg":"ES256","kid":"b81269f1-…"}` — asymmetric, so forging is not an option. Payload carries no `organization_id`; `role` is `authenticated`.
- **Deny-all baseline.** Both tables return `[]` to `anon` and to a real authenticated token.
- **The refusal shape differs by operation.** `PATCH /rest/v1/members?id=eq.<uuid>` with a valid token returns **HTTP 204 and no error** — RLS refuses `update`/`delete` silently by failing `using`, affecting zero rows. Only `insert`, and `update`'s `with check`, raise `42501`/403. An assertion that an administrative write *threw* would be wrong; assert the row is unchanged.
- **`auth.users.banned_until`** is `timestamp with time zone`, nullable — the column the helper reads for active state.
- **The claims-injection harness works.** In a transaction, `select set_config('request.jwt.claims', '{"sub":"…","role":"authenticated"}', true)` then `set local role authenticated` yields `current_user = authenticated`, a resolving `auth.uid()`, and RLS enforced. `auth.uid()`/`auth.jwt()`/`auth.role()` all read `current_setting('request.jwt.claim[s]', true)`.
- **Role attributes.** `postgres` and `service_role` are `rolbypassrls`; `anon`, `authenticated`, `authenticator` and `supabase_auth_admin` are not. `anon`/`authenticated` are `NOLOGIN`, reachable only via `set role`.

### The schema this builds on

- `supabase/migrations/0002_organizations_and_members.sql:58-113` `organizations`, with `slug` `not null unique` and DNS-label checked (`:70-71`); `:115-158` `members` — `organization_id` **first**, `not null`, FK cascade (`:120`); `auth_user_id` `not null unique` FK to `auth.users` (`:128`); `role text not null check (role in ('admin','member_role'))` (`:140`), a text check rather than an enum; plus `constraint members_organization_id_id_key unique (organization_id, id)` (`:157`) for later composite FKs.
- `:173-174` the two `enable row level security` statements. `:160-172` the reasoning about default grants — read it before writing any policy.
- `:193-223` `refuse_organization_with_no_admin()`, the security-attribute template: `security definer` (`:195`), `set search_path = ''` (`:196`), fully-qualified `public.organizations`/`public.members` (`:205`, `:211`), and refusal via `errcode = 'check_violation'` + `message = '<CODE>'` + `detail = <operand>` (`:218-221`). `:231` the PUBLIC revoke. **No function reading the current user's row exists** — the helper is authored from scratch.
- `:34-36` states that active status and team membership are absent **on purpose**: AD-2 makes each a later story's versioned table, never a column here.
- `supabase/config.toml:35-66` — `[auth]` `jwt_expiry = 3600` (`:39`); `[auth.email] enable_signup = true` (`:60`). **No `[auth.hook…]` section**; the file ends at `:75`. `api.schemas = ["public","graphql_public"]` (`:13`), so the helper must stay reachable from `public` policies. The hand-rolled TOML reader at `test/supabase-scaffold.test.ts:234-248` silently ignores unknown sections, so a new section needs its own assertion or it is unenforced.
- `supabase/seed.sql` — fixture assets, needing **no edit**. Shared password `local-fixture-password` (`:27`), bcrypt cost 10. Pilot `dvd-kastel-novi` (`:44-60`): `ivan.maric` **admin**, plus `ana.kovac`, `marko.novak` (the explicit no-email account, `:79`) and `petra.babic` as `member_role`. UJ-5 `zastita-split` (`:152-168`): `josip.peric` **admin**, plus `lucija.simic` and `tomislav.juric`. Fixture 2's header (`:139-150`) already names this story's two assertions as its reason to exist. `raw_app_meta_data` carries only `provider`/`providers` (`:101`) and `identity_data` only `sub`/`email`/`email_verified`/`phone_verified` (`:113-118`), so existing accounts acquire the claim at next sign-in and there is no backfill to write.

### The test harness, and the gap it must close

- `test/provisioning.test.ts` is the only live-DB test. `pg` `Client` per case (`:6`); connection string `process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'` (`:39-40`). The `reachable()` probe (`:42-51`) checks **TCP+auth only** — no schema, no seed; `noDatabase` is a sanctioned module-scope `await` (`:53`) because `skipIf` needs it at collection time. `inRolledBackTransaction<T>(work)` (`:113-122`) always rolls back in `finally`. `refused(work)` returns `{code, message, detail}` and throws `'nothing was refused: the statement was permitted'` when nothing threw (`:124-148`) — copy this rather than asserting a bare throw. `FIXTURES` (`:86-89`) and the `flatMap` cross-product idiom (`:691-694`, consumed at `:695`) are the row shapes to reuse. Vacuous-pass guard at `:305-316` is a deliberate superset check. One `afterAll` (`:253-265`) cleans `provisioning-test-%`.
- `:706` `set local role authenticated` is the **only** RLS-visible read in the repo and the proven counter-measure to `rolbypassrls`. `:797-822` is the only real credential exchange — and it **throws the token away**, issuing no read with it; that discarded token is the gap this story closes. Nothing anywhere does `set_config('request.jwt.claims', …)` and nothing fetches `/rest/v1`.
- `:65-83` derives the endpoint by spawning `supabase status -o json` and reading `PUBLISHABLE_KEY ?? ANON_KEY` and `API_URL`; used as `it.skipIf(noDatabase || authEndpoint === undefined)` (`:774`) with a `20_000` ms third argument (`:828`). This is the gating pattern every new PostgREST case copies.
- Style, with one anchor each: a custom message as `expect`'s second argument naming the *invariant* (`:284`); `describe` states the invariant as a full sentence (`:347`); `it` is verb-first and never says "should" (`:268`); reads are lazy, never at module scope (`test/typography-coverage.test.ts:20-21`), the one sanctioned exception being `:53`; `skipIf` never an early `return`, with the reason at `test/static-hosting.test.ts:12-15`; a vacuous-pass guard beside every sweep (`packages/domain/test/purity.test.ts:104-107`); a detector self-test for every matcher a file owns; and a negative control beside every positive (`:821-822`, `:647-653`).

### Assertions this story must change — each an intended review moment

- `test/supabase-scaffold.test.ts:159-166` — `not.toMatch(/create policy/i)`, headed **EXPECTED TO BE DELETED IN STORY 1.3**, instructing removal rather than weakening. `pnpm test` cannot pass until it goes.
- `test/provisioning.test.ts:673-685` — `pg_policies` in `public` must be empty. Same label, same instruction.
- `test/provisioning.test.ts:695-714` — the readers matrix. **Narrow the two `authenticated` rows** to "reads its own organization and no other"; leave the two `anon` rows exactly as they are, forever.
- `test/provisioning.test.ts:471-517` — the template for asserting the new functions' security attributes: `pg_proc.prosecdef`, `proconfig` containing `search_path=""`, and zero PUBLIC aclitems (`entry::text like '=%'`).
- `test/provisioning.test.ts:522-528` — **not** to be deleted; the constraint-trigger count stays exactly 1, and this story is named as the first that will be tempted.
- `test/supabase-scaffold.test.ts:23`/`:84` force a hand-written contiguous `0003_<snake_case>.sql`; `supabase migration new` emits a timestamp name the suite rejects.

## Tasks & Acceptance

**Execution:**

- [x] `supabase/migrations/0003_<snake_case>.sql` — the whole access-control layer in one migration, three elements each with its own *why* comment. (a) A `security definer stable` helper in `public` returning the caller's `organization_id`, `role` and active flag, joining `public.members` to `auth.users` on `auth_user_id` and treating `banned_until is null or banned_until <= now()` as active; all three security attributes of `0002:195,196,231`. (b) The hook function writing **only** `organization_id` into the token's claims, with `execute` granted to `supabase_auth_admin` and revoked from `public`, `anon` and `authenticated`. (c) RLS policies: `organizations` readable only where `id` matches the claim; `members` readable within the claimed organization, and insertable/updatable/deletable only where the caller is an active `admin` of that same organization, with `with check` pinning `organization_id` on every write. Cite AD-2, AD-9, AD-10, Q1, Q2, Q3.
- [x] `supabase/config.toml` — add `[auth.hook.custom_access_token]` with `enabled = true` and the `pg-functions://postgres/public/<name>` URI, plus a comment recording that the reader at `test/supabase-scaffold.test.ts:234-248` ignores unknown sections so this needs its own assertion.
- [x] `test/rls-isolation.test.ts` — new; the regression suite later epics re-run. Two headless harnesses. (1) **Through PostgREST with real tokens**: exchange each fixture credential at `/auth/v1/token?grant_type=password`, then issue real `/rest/v1` calls with Node's global `fetch`, gated as `it.skipIf(noDatabase || authEndpoint === undefined)` with a `20_000` ms timeout per `test/provisioning.test.ts:65-83,774,828`. This is the literal "direct API call bypassing the interface". (2) **In-transaction claims injection** for fine-grained policy cases, so no policy case depends on the hook being wired. Drive every matrix row against **both** fixtures via the `flatMap` + `$fixture` idiom. Assert per operation: zero rows for reads, **row unchanged** for a refused `update`/`delete` (204, no error), and `42501` via `refused()` for a refused `insert`. Add a vacuous-pass guard proving both fixtures and at least one policy were found, a negative control beside each positive, and a detector self-test for any helper this file owns.
- [x] `test/rls-isolation.test.ts` (same file) — the freshness cases, each spanning **two statements** inside one transaction so a `stable` function's within-statement caching cannot make them pass vacuously: read as an admin, downgrade the row, read again and find the administrative write refused; and the same shape for `banned_until`, including a past `banned_until` that must still read as active.
- [x] `test/provisioning.test.ts` — delete `:673-685`; narrow the two `authenticated` rows of `:695-714` to own-organization-only, leaving the `anon` rows untouched; add security-attribute assertions for both new functions copying `:471-517`; keep `:522-528` at exactly one constraint trigger.
- [x] `test/supabase-scaffold.test.ts` — delete `:159-166` per its own instruction; assert `0003` exists and is contiguous, that `[auth.hook.custom_access_token]` is configured and enabled, and that the hook's `execute` is granted to `supabase_auth_admin` and to none of `public`/`anon`/`authenticated`.
- [x] `DEPLOY.md` — document the hook's deployment ordering (the migration must be applied **before** the hook is enabled, or every sign-in fails on a missing function), that enabling it requires a stack restart locally, and that a claim-carrying token is only issued at next sign-in.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` — append: that the AD-2 versioned active-status table is still owed by 1.6, which must **extend** this helper rather than replace it; that `test/rls-isolation.test.ts` skips without a database and is not load-bearing until CI runs it with one; and a correction that the earlier entry claiming `apps/web/src/supabase/` does not exist is wrong — it has held a README since 1.1a.

**Acceptance Criteria:**

- Given the local stack, when `pnpm exec supabase db reset` runs, then `0001`–`0003` apply, both fixtures load, and it exits 0.
- Given a restarted stack, when a fixture credential is exchanged for a token and the payload decoded, then it carries `organization_id` equal to the signer's organization, and `role` is still `authenticated`.
- Given the two new functions, when `pg_proc` and their ACLs are inspected, then each is `security definer` with `proconfig` containing `search_path=""` and zero PUBLIC aclitems, the hook is executable by `supabase_auth_admin` alone, and the schema still holds exactly one constraint trigger.
- Given `nvm use && pnpm build && pnpm lint && pnpm typecheck && pnpm test` with the stack up, when all four run, then each exits 0, no suite is skipped, and the test count exceeds the 1024 baseline.

### Review Findings

**Resolved 2026-09-07.** Both decisions were delegated back by the human and taken here: D1 applied *both* the narrow fix (`addThrowawayMember` now builds a well-formed account, matching `seed.sql:88-118`) and the class fix (`fileParallelism: false`), because a throwaway left behind by a skipped `afterAll` would still fail the next run under serialization alone. D2 corrected the two stale `admin-auth` comments — comment-only, no behaviour change, and `test/admin-auth-boundary.test.ts` still pins the 501 path. All fourteen patches applied. Gates re-run green: build, lint, typecheck, and **939 root tests** (`rls-isolation.test.ts` up from 55 to 67 cases). Re-verified live afterwards: a soft-deleted account now reads 0 rows with `is_active = false` (was 4 rows and `true`), `supabase_auth_admin=U` is now explicit in the schema ACL, and sign-in still mints the `organization_id` claim with `role` unchanged.

Ad-hoc code review, 2026-09-07, four layers (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor) over `a1416a3..6979f1a`. Severities are assigned from live verification against the running stack, not from the diff alone. All four acceptance criteria were independently confirmed: `db reset` clean, hook wired (`GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true`), a fixture token carries `organization_id` with `role` still `authenticated`, cross-tenant and anonymous reads return `[]`, and all four gates exit 0 at 1102 tests with `rls-isolation.test.ts` executing 55 cases rather than skipping.

- [x] [Review][Decision] Throwaway members break the fixture sign-in invariant and make `provisioning.test.ts` latently red — `addThrowawayMember` commits `auth.users` rows carrying only `(id, email)` into the *seeded* organizations, leaving `confirmation_token`, `recovery_token`, `email_change` and `email_change_token_new` NULL and creating no `auth.identities` row. `recipeHealth` joins those same slugs and asserts `nullTokens === 0` and `identities === accounts`. `vitest.config.ts` sets no `fileParallelism`, so the two files run concurrently. Proven in a rolled-back transaction: baseline `accounts=4 nullTokens=0 identities=4`; with one throwaway `accounts=5 nullTokens=1 identities=4` — both assertions red. Options: (a) make `addThrowawayMember` well-formed (four empty strings + an identity row, matching `seed.sql:88-104`); (b) set `fileParallelism: false`; (c) put throwaway rows in their own organization. [test/rls-isolation.test.ts:414, test/provisioning.test.ts:171-212, vitest.config.ts]
- [x] [Review][Decision] `admin-auth` prose still asserts the pre-1.3 deny-all posture, now false — `index.ts:29-32` ("both tables are deny-all until it lands") and `handler.ts:189-191` ("story 1.3 owns the policies and the role helper … Acting now would mean acting unauthorized"). This diff rewrote the matching `DEPLOY.md:114-120` paragraph but not these. The spec's **Ask First** gates touching `admin-auth`, so this needs your call: correct the two comments, or leave them and record why. [supabase/functions/admin-auth/index.ts:29, handler.ts:189]

- [x] [Review][Patch] Add an ungated guard so the PostgREST half cannot vanish silently — `apiEndpoint` is an IIFE returning `undefined` on any throw with stderr discarded, and `noApi` then skips 15 of 29 test blocks, including every cross-tenant write case and both hook-claim cases. Nothing distinguishes "no API" from "API broken". [test/rls-isolation.test.ts:96-117, :463]
- [x] [Review][Patch] Assert the hook's claim-*writing* branch database-side — only the no-member-row (null) branch is asserted without the API. A hook rewritten to never write a claim passes the whole suite whenever `apiEndpoint` is undefined. [test/rls-isolation.test.ts:590-620]
- [x] [Review][Patch] Add cross-tenant *write* cases to the claims-injection harness — the injection block covers reads and own-organization inserts only, so the tenant pins in `members_insert/update` rest entirely on API-gated cases. [test/rls-isolation.test.ts:1025-1177]
- [x] [Review][Patch] Helper ignores `auth.users.deleted_at`, so a soft-deleted account keeps full access — verified live: after setting `deleted_at`, members visible stayed 4 and `is_active` stayed `true`. Add `and u.deleted_at is null`. [supabase/migrations/0003_access_control.sql:93]
- [x] [Review][Patch] `supabase_auth_admin` has schema `public` USAGE only via the default PUBLIC grant — `nspacl` lists `postgres/anon/authenticated/service_role` individually plus `=U` for PUBLIC; the auth role is not named. The migration's own argument (citing `0002:43-51`) condemns exactly this accidental dependency. Add `grant usage on schema public to supabase_auth_admin;`. [supabase/migrations/0003_access_control.sql:210]
- [x] [Review][Patch] Nothing asserts that an authenticated admin cannot write `organizations` — the refusal is by absence of a policy, the silent failure mode this suite elsewhere distinguishes carefully, and 1.4 is told to build its write policy by copying the select one. [test/rls-isolation.test.ts]
- [x] [Review][Patch] Hook-grant assertions run over `allMigrations()` (comments included) rather than `migrationStatements()` — satisfiable by the prose that describes them, contradicting the principle the same describe block introduces. [test/supabase-scaffold.test.ts:324, :411]
- [x] [Review][Patch] Give the DB-independent suite an exact policy-name list — the exact set is asserted only in `rls-isolation.test.ts:501`, which skips without a database, and there is still no CI. A `using (true)` policy written `to authenticated` passes every static check. [test/supabase-scaffold.test.ts:267]
- [x] [Review][Patch] Label the five-policy `toEqual` for story 1.4 — it breaks by construction when 1.4 adds the `organizations` write policy, and unlike the two assertions this story deleted it carries no forward note telling the next author to extend rather than weaken it. [test/rls-isolation.test.ts:506]
- [x] [Review][Patch] Add a freshness case for the caller's `members` row being deleted mid-session — the helper's other empty-result path, and exactly what 1.5/1.6 will do. [test/rls-isolation.test.ts]
- [x] [Review][Patch] DEPLOY.md §5.2b passes the probe password through argv after arguing against `psql -d` for that exact reason — use `jq -n '{email: $ENV.SHIFT_PROBE_ADDRESS, password: $ENV.SHIFT_PROBE_PASSWORD}'`. Also `SHIFT_PROBE_ADDRESS` is never unset, and the "back the hook out, then push and re-enable" recovery shows only the backing-out half. [DEPLOY.md:307]
- [x] [Review][Patch] Documentation contradicts itself — `config.toml`'s comment says the ordering "is not negotiable in either direction" while DEPLOY.md §5.2b is titled "order matters, in one direction only"; the same comment says `supabase-scaffold.test.ts` asserts the grants "in the database" when it asserts them in migration source text. [supabase/config.toml:85]
- [x] [Review][Patch] Derive the migration owner instead of hardcoding `postgres` in the grantee assertions. [test/provisioning.test.ts:846, :851]
- [x] [Review][Patch] Low-severity batch — no case for the `nullif(…, '')` empty-claim guard (a branch deletable for free by the file's own standard); `claimsOf` self-test has no array-payload case; `supabase-scaffold.test.ts:143` still says "until story 1.3 writes its policies"; assertions labelled "story 1.3" throughout for work that is 1.3a; `FIXTURE_PASSWORD` duplicates `seed.sql:27` so drift surfaces as fifteen 400s; `20_000` repeated per case instead of `testTimeout`; `CROSS_TENANT.member` consumed by nothing.

- [x] [Review][Defer] `refuse_organization_with_no_admin` still holds default `anon`/`authenticated`/`service_role` EXECUTE [supabase/migrations/0002_organizations_and_members.sql:231] — deferred, pre-existing
- [x] [Review][Defer] The claim-plus-helper predicate is copy-pasted six times across five policies with nothing comparing them to each other [supabase/migrations/0003_access_control.sql:250-341] — deferred, pre-existing
- [x] [Review][Defer] The zero-admins constraint trigger is never exercised through a policy-bound session [test/provisioning.test.ts:522-528] — deferred, pre-existing
- [x] [Review][Defer] `migrationStatements()` strips `--` across dollar-quoted bodies and `policyBody()` truncates at the first `;`, both failing open [test/supabase-scaffold.test.ts:230-240] — deferred, pre-existing


## Spec Change Log

### 2026-09-07 — iteration 1, three adversarial layers

**Handling deviation, human-directed.** Four findings classified `bad_spec`, whose prescribed handling is revert-and-re-derive. The human directed **amend the spec, fix in place** instead, as on 1.1d and 1.2. The reasoning: no reviewer found a fault in the migration — the five policies, the helper and the hook are correct, all four gates were green at 1088 tests, and the implementer's own mutation sweep turned six policy weakenings red. Every fix is additive test coverage, so a re-derive would regenerate near-identical SQL at full cost while risking what is already proven.

**Triggering findings.** Four further policy weakenings survive the entire suite, and the root cause of all four is a missing I/O matrix row rather than a coding error. (1) Deleting the whole `members_delete_by_own_active_admin` block leaves the suite green: the only delete case asserts a member-role account is *refused*, and no delete policy at all produces the identical 204-with-row-still-present — so the delete half of Q2 can ship absent, inverted, or with the wrong role predicate, and its failure symptom is precisely the shape this suite teaches a reader to interpret as a refusal. Insert and update both carry positive controls; delete did not. (2) Dropping `and access.is_active` from all three `members` write policies is invisible, because the only ban case reads and never writes — a banned admin would retain full write access, which is half of AD-10's freshness guarantee. (3) Dropping the same clause from `organizations_select_own_organization` is invisible for the same reason, and the migration comment says story 1.4 will build the `organizations` write policy *by copying this one*, so the drift would propagate. (4) An admin inserting a member carrying another tenant's `organization_id` is unasserted, though the migration's own comment promises 42501 and the update-side twin (the tenant move) is tested.

**What was amended.** Four rows added to the frozen I/O matrix under explicit human authorization — admin delete succeeds, admin cross-tenant delete refused, cross-tenant insert refused, and banned-admin writes refused — plus the `Account banned mid-session` row widened to name `organizations` as well as `members`. Nothing else in the frozen block changed. Seventeen medium findings were routed to patch and are listed in the dispatch, not here.

**Known-bad state avoided.** A security layer whose delete policy could be removed entirely with a green suite; a banned administrator retaining every write; a banned administrator still reading its organization row; a cross-tenant row creatable by an otherwise-legitimate admin; and a drifted `is_active` clause that story 1.4 was instructed to copy.

**KEEP — must survive any re-derivation.**
- The two-harness design: real ES256 tokens over PostgREST for the literal "direct API call", and in-transaction claims injection so no policy case depends on the hook being wired.
- Asserting **row unchanged** rather than "it threw" for a refused `update`/`delete`. RLS refuses those silently with HTTP 204; an assertion that the write threw would pass vacuously.
- Never asserting a policy on a bare `postgres` connection — it is `rolbypassrls`, so the policies are invisible and every such assertion is vacuous.
- The freshness cases spanning two statements in one transaction, because a `stable` helper caches within a statement and a single-statement test would prove caching rather than freshness.
- The explicit `grant execute … to authenticated` on `current_member_access()`. A policy expression's function call is permission-checked against the *querying* role, so without it `select from members` fails `permission denied for function` instead of returning zero rows — verified live.
- The corrected migration comment about `for update` falling back to `using` when `with check` is absent. That mutation did not fail, and the comment was fixed rather than left claiming otherwise.

## Design Notes

**Why `banned_until` carries the active-state clause.** The story requires active state be read fresh, but `0002:34-36` deliberately has no such column and `test/provisioning.test.ts:598-615` asserts it must never gain one, because AD-2 makes it a versioned table owned by 1.6. Reading `auth.users.banned_until` in the helper satisfies the requirement with no new column, no AD-2 violation and no encroachment: it is the *authentication* half of deactivation, which CAP-4 already words as "blocks authentication", and ban/unban are already in `admin-auth`'s declared vocabulary. Story 1.6 adds the versioned domain table and the ban call, and **extends** this helper rather than replacing it. Chosen by the human on 2026-09-07 over shipping a half-met requirement or pulling 1.6's central deliverable forward.

**Why two harnesses rather than one.** PostgREST with a real ES256 token is the only thing that exercises the shipped path and the only literal reading of "a direct API call bypassing the interface" — and it needs no browser, which Q9 requires. But it depends on the hook being wired, so a hook regression would fail every policy case at once while saying nothing about the policies. In-transaction claims injection isolates policy behaviour from token issuance. Neither may run on a bare `postgres` connection: `postgres` is `rolbypassrls`, which is exactly the mutation 1.2's review predicted would "land on story 1.3".

**What "refused identically via the interface" means here.** AD-9 leaves no server tier: every domain write goes through PostgREST under RLS, so there is only one enforcement point to refuse at, and this story asserts the refusal there. The clause about the interface is completed by the deferred sign-in story, which asserts that the interface uses that same path — it cannot be asserted by rendering, since AD-15 bans jsdom and `.tsx` tests are not collected.

**Why the claim's absence must fail closed.** Any session predating the hook carries no `organization_id`. A policy comparing a column to a missing claim must yield zero rows, never all rows — so the claim is read in a form where `null` cannot widen the result, and the matrix carries that case explicitly.

## Verification

**Commands:**
- `nvm use` — expected: Node 24.19.0. Without it pnpm 11 refuses to run and four `format.test.ts` cases fail for an unrelated reason.
- `pnpm exec supabase stop && pnpm exec supabase start` — expected: the auth container comes up carrying the hook. Confirm with `docker inspect supabase_auth_shift --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i hook`; a `config.toml` edit does not reach a running container.
- `pnpm exec supabase db reset` — expected: exit 0, three migrations applied, both fixtures loaded.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — expected: all exit 0, no skipped suite while the stack is up, count above 1024.
- Exchange a fixture credential for a token and decode the payload — expected: an `organization_id` claim for the signer's own organization, `role` still `authenticated`.
- `GET /rest/v1/members` with an org A token — expected: org A rows only. Repeat with `?organization_id=eq.<org B id>` — expected `[]`. Repeat with no token — expected `[]`.
- `PATCH /rest/v1/members` with a `member_role` token — expected HTTP 204, and the target row **unchanged** when re-read as `postgres`.
- `POST /rest/v1/members` with a `member_role` token — expected `42501`/403.

**Manual checks:**
- `select count(*) from pg_constraint where contype = 't'` returns 1, not 7 — count constraints, not `pg_trigger`, which counts every foreign key as well.

## Suggested Review Order

**The access-control design**

- Start here: the fresh reader every policy calls, and the three security attributes that make it safe.
  [`0003_access_control.sql:93`](../../supabase/migrations/0003_access_control.sql#L93)

- Why `authenticated` needs an explicit grant: a policy's function call is checked against the *querying* role.
  [`0003_access_control.sql:135`](../../supabase/migrations/0003_access_control.sql#L135)

- The only writer of `organization_id`; its null branch removes the claim rather than defaulting it.
  [`0003_access_control.sql:167`](../../supabase/migrations/0003_access_control.sql#L167)

- The hook is executable by `supabase_auth_admin` alone — the privilege boundary that keeps callers from minting claims.
  [`0003_access_control.sql:210`](../../supabase/migrations/0003_access_control.sql#L210)

**The five policies, read in dependency order**

- Tenant isolation for the organization row itself; story 1.4 builds its write policy by copying this.
  [`0003_access_control.sql:246`](../../supabase/migrations/0003_access_control.sql#L246)

- The read every later surface inherits; note it also gates any filtered write.
  [`0003_access_control.sql:261`](../../supabase/migrations/0003_access_control.sql#L261)

- Insert: active-admin plus the tenant pin, the pair that refuses a cross-tenant create.
  [`0003_access_control.sql:278`](../../supabase/migrations/0003_access_control.sql#L278)

- Update: `with check` as well as `using`, so no row moves between tenants.
  [`0003_access_control.sql:303`](../../supabase/migrations/0003_access_control.sql#L303)

- Delete: the first legal member delete, and the policy whose absence was invisible before review.
  [`0003_access_control.sql:330`](../../supabase/migrations/0003_access_control.sql#L330)

**Wiring the hook into the platform**

- Enabling the hook; deployment order is load-bearing and the reverse breaks every sign-in.
  [`config.toml:85`](../../supabase/config.toml#L85)

- The ordering rule, the recovery from getting it wrong, and why `jq @base64d` replaces `base64 -d`.
  [`DEPLOY.md:307`](../../DEPLOY.md#L307)

**Executed proof, not asserted proof**

- Real ES256 tokens over PostgREST: the literal "direct API call bypassing the interface".
  [`rls-isolation.test.ts:243`](../../test/rls-isolation.test.ts#L243)

- Claims injection, so no policy case depends on the hook being wired.
  [`rls-isolation.test.ts:182`](../../test/rls-isolation.test.ts#L182)

- Refusals assert the raised code, never a bare throw.
  [`rls-isolation.test.ts:207`](../../test/rls-isolation.test.ts#L207)

- The vacuous-pass guard: exact policy names, both fixtures, both functions.
  [`rls-isolation.test.ts:462`](../../test/rls-isolation.test.ts#L462)

**The four coverage gaps review found, each now mutation-proven**

- Admin delete succeeds — the positive control whose absence made the delete policy deletable.
  [`rls-isolation.test.ts:899`](../../test/rls-isolation.test.ts#L899)

- Admin cross-tenant delete leaves the row present.
  [`rls-isolation.test.ts:925`](../../test/rls-isolation.test.ts#L925)

- Cross-tenant insert refused: the insert-side twin of the tenant move.
  [`rls-isolation.test.ts:946`](../../test/rls-isolation.test.ts#L946)

- Freshness now covers both tables on a ban, not `members` alone.
  [`rls-isolation.test.ts:1230`](../../test/rls-isolation.test.ts#L1230)

- Banned-admin writes: the column-free form, because a filtered write is refused by the *read* policy.
  [`rls-isolation.test.ts:1279`](../../test/rls-isolation.test.ts#L1279)

**Supporting changes**

- Function security asserted by argument count, exactly one match, and a non-null ACL.
  [`provisioning.test.ts:241`](../../test/provisioning.test.ts#L241)

- The narrowed deny-all matrix: `authenticated` reads own-organization only; the `anon` rows stay forever.
  [`provisioning.test.ts:711`](../../test/provisioning.test.ts#L711)

- Static guard replacing the deleted no-policy assertion: every policy is `to authenticated`, none is `for all`.
  [`supabase-scaffold.test.ts:267`](../../test/supabase-scaffold.test.ts#L267)
