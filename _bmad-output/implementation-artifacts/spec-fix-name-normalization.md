---
title: 'Every name check strips all whitespace, and name uniqueness compares Unicode-normalized names'
type: 'bugfix'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
baseline_commit: '7ca3b6fd3ed0a30d7ebf255b0a1e63b3d05c2e96'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The deferred-work triage (2026-09-27) put two entries into "package 2b". Both are still open on main:
1. **Whitespace handling** ("Name checks use `btrim(name)`, which strips only spaces, while the client's `trim()` strips all whitespace…"). A direct API caller can store a name made only of tabs, newlines or NBSP characters. It can also store `'Tim\t'` next to an active `'Tim'` without the unique index stopping it. The pattern appears on `members`, `organizations`, `teams`, `hour_bands` and `shift_types`.
2. **Unicode normalization** ("Case-insensitive name uniqueness (`lower(btrim(name))`) on `teams`, `hour_bands` and now `shift_types` ignores Unicode normalization…"). NFC `Noć` and NFD `Noć` count as two distinct active names, even though they render identically.

**Approach:** Add one forward migration, numbered next after main's latest (0024 at the time of writing).
- **One whitespace class.** Define one `immutable` SQL helper, e.g. `public.name_key(text)`, that:
  1. trims every Unicode whitespace character (space, tab, newline, CR, NBSP U+00A0, and the other `\s`-class and `[[:space:]]` characters Postgres recognises; include U+00A0 explicitly if the class misses it);
  2. normalizes to NFC;
  3. lower-cases the result.

  Rebuild each name-uniqueness index on `name_key(name)`. Replace each `btrim(name) <> ''` check with a check that the name contains a non-whitespace character, using the same whitespace class.
- **Existing data.** Before tightening, detect any rows that the new checks or indexes would reject. If there are any, the migration must fail loudly with a named error listing the table. It must never silently rewrite user data. The local seed and demo data must pass.
- **Client alignment.** Each surface's duplicate-name preflight and message path normalizes names the same way: whitespace trim, `normalize('NFC')`, then locale lower-casing. Put this in one shared utility in `apps/web/src/utils/` so the client and database agree.

## Boundaries & Constraints

**Always:**
- **Tests (live DB)**, for each affected table:
  - a name of only a tab, only a newline, or only NBSP is refused;
  - `'X\t'` next to an active `'X'` is refused as a duplicate;
  - NFC and NFD forms of the same name are refused as duplicates;
  - an ordinary name and a name with internal spaces are still accepted.
- **Unit tests** for the client utility, and for each duplicate-name preflight using NFD input.
- **Refusal codes** stay the same as today's check-violation and unique-violation codes and messages.
- **Idempotence.** The migration is idempotent in the repo's style, and `supabase db reset` passes.
- **Grants.** Grant EXECUTE on the new helper appropriately. If the helper is used in indexes and checks only, revoke it from `anon`, `authenticated` and `service_role`. Otherwise justify the grant.
- **Mutation-prove** every new test.
- **Deferred work.** Remove the two entries this closes.

**Ask First:**
- A maximum name length. This is the separate open deferred entry "No name column has a length limit…".
- Rewriting any existing stored name.

**Never:**
- No new UI text.
- No change to what a name that is valid today stores, since the stored value is not rewritten.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0002_organizations_and_members.sql` (73, 130), `0009_teams.sql` (66-68), `0012_hour_bands.sql` (70-71), `0013_shift_types.sql` or similar -- the `btrim` checks and the `lower(btrim(name))` unique indexes.
- `apps/web/src/features/{teams,hour-bands,shift-types,members,organization}/services/*` -- the `entered*Name` helpers and the duplicate-name preflights.
- `test/rls-isolation.test.ts`, `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts` -- the live-DB and migration test patterns, including the function grant inventory.

## Tasks & Acceptance

**Execution:**
- [x] Migration: `name_key` helper, checks, rebuilt indexes, and the existing-data guard.
- [x] Shared client name utility, adopted by every preflight.
- [x] Tests, then clean up `deferred-work.md`.

**Acceptance Criteria:**
- Given each fix reverted, when the new tests run, then they fail.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `supabase db reset` followed by `pnpm test` (after a web build), and `pnpm test:e2e` run, then all pass.

## Spec Change Log

- **Migration number 0024** (`0024_name_key.sql`), as expected: the worktree's latest was 0023 and the main checkout held no untracked migration.
- **The whitespace class is a literal list, the union of both sides.** Verified on the local stack (Postgres 17.6, ICU `en-US`): `\s` and `[[:space:]]` match U+0009–000D, U+001C–001F, U+0020, U+0085, U+00A0, U+1680, U+2000–200A (U+2007 included), U+2028, U+2029, U+202F, U+205F and U+3000, and do NOT match U+FEFF. Under `C` / libc `C.utf8` the same classes match ASCII only, so a named class would make U+00A0 whitespace on one stack and not another. `String.prototype.trim` strips the same set less U+001C–001F and U+0085, plus U+FEFF. The class is therefore the union, spelled out once in `name_key` and once in `apps/web/src/utils/name.ts`; `test/name-key.test.ts` asserts they agree on every BMP code point and that the class covers all of Postgres's `\s`/`[[:space:]]` and all of `trim`.
- **Checks use `name_key(name) <> ''`** rather than a separate "contains a non-whitespace character" regex, so the class is written once. Equivalent by construction.
- **No client duplicate-name preflight exists.** Every surface (teams, hour bands, shift types) leaves the duplicate decision to the database's 23505 and maps it by constraint name; nothing on the client compares names across rows. So the "preflight" alignment is: `entered*Name` refuses a blank name in the same class (via `enteredName`), and the unit tests send NFD input and assert it is sent as typed and that its 23505 reads as NAME_TAKEN. `nameKey` is exported as the client mirror of `name_key` and is used by the agreement test; no production caller needed it. Organization and member names have no client blank check today and none was added (the database refuses, with the same codes).
- **The stored value is unchanged.** `enteredName` still stores `value.trim()` byte for byte (Never rule); only the blank verdict uses the wider class. So `'Tim\u0085'` still stores as typed, and `'\u0085'` alone is now refused client-side as empty.
- **EXECUTE on `name_key` is granted to `authenticated`**, not revoked. Verified: a check or index expression is permission-checked against the writing role, and with EXECUTE revoked an admin's insert fails with `permission denied for function`. Revoked from PUBLIC, `anon` and `service_role` (no domain-table write uses the secret key). `provisioning.test.ts` pins the grantee list and SECURITY INVOKER + pinned search_path.
- **Existing-data guard**: a `do` block before any constraint changes raises `NAME_KEY_CONFLICT` (23514) with the offending tables in `DETAIL` (blank names on all five tables, duplicate keys on the three indexes with their own predicates). The first version appended untyped literals to a `text[]` (Postgres read them as array literals, 22P02); the new guard tests caught it before commit.
- **Existing source-text tests** in `supabase-scaffold.test.ts` that match `btrim` in 0002/0009/0012/0013 are left as is (they describe those files, which are forward-only); a new scaffold test pins 0024's final shape. The two live `pg_indexes` assertions in `provisioning.test.ts` now expect `name_key(name)`.
- **E2E**: the first full run had 6 failures in rotation/team-position specs (a focus timeout in `rotation-phone.spec.ts` and then `the lock e2e-rotation… was not released` cascading). Those specs passed alone (11/11) and a second full run passed 106/106. Nothing in them touches name validation; treated as a flake.
- **Review round 1 (2026-09-29).** Patches from the review, each tested and mutation-proved (N1–N22 below):
  - **Linear trim, no regex.** `name_key` trims with `btrim(name, U&'<the 30 code points>')`; `trimName` scans the ends against a `Set`. Probed: Postgres's own regex engine answered the old anchored pattern on 100k characters in under a millisecond (it is not the O(n²) case V8 is), so the SQL change is for a plainly linear definition and a list the source test can decode; the client change is the real ReDoS fix (V8's `[class]+$` on `'a' + ' '.repeat(100000) + 'b'` takes seconds). The live pathological test runs under `set local statement_timeout = '5s'`, so a quadratic trim fails with 57014 rather than hanging; nothing reads a clock.
  - **`private` schema.** The helper moved to `private` (created if missing), which `supabase/config.toml` does not expose, so `POST /rest/v1/rpc/name_key` as a signed-in member answers 404 PGRST202. This supersedes the earlier "granted to `authenticated`" entry's placement in `public`.
  - **Grants, superseding the entry above:** EXECUTE and USAGE to `authenticated` and `service_role`, revoked from PUBLIC and `anon`. A check runs on every update of its row, so a secret-key operator update of any column needs EXECUTE; a live test updates all five tables as `service_role`. Found while proving it: stored check and index expressions name the function by OID, so writes need EXECUTE but NOT schema USAGE (N4 first survived). USAGE is kept as the review asked and pinned by a live ACL test instead.
  - **Member create and edit use the class.** `createPayloadOf` blank-checks with a Deno copy of the class (`isBlankName` in `operations.ts`) and refuses with PAYLOAD_INVALID before any account call; `saveMember` refuses with MEMBER_WRITE_INVALID before sending. Both still store `trim()`. The Deno list equals `NAME_WHITESPACE` (boundary test), and the SQL `U&` list decodes to it too (scaffold test).
  - **Guard tests** cover blank organizations, bands and types, and two negatives (an archived team, an archived type sharing a key with an active row). The old "passes the seeded data" case is renamed to what it shows: `supabase db reset` loads the seed AFTER every migration, so the guard never sees the seed; the seed is proved by loading under the 0024 constraints.
  - **Rule for later migrations:** a Consistency Conventions row in the architecture spine, and a scaffold test that fails a migration numbered after 0024 whose statements contain `lower(btrim(` or `btrim(name)` (comments stripped).
  - **Accuracy.** 0024's header states what immutability rests on (the trim is collation-independent; `lower()` follows the collation and ICU version and `normalize()` Postgres's Unicode tables, so an upgrade may need a REINDEX; UTF-8 required). `nameKey` takes no locale: `'hr'` only, verified against the local ICU collation only. Stale `btrim` comments in the organization and calendar services (and their two tests) now name `private.name_key`.
  - **Deferred** (five new entries in `deferred-work.md`): invisible characters outside the class, NFC vs NFKC, the stored value keeping NEL/U+001C–001F, the operator script's `btrim` setting check, and the guard's check-then-alter window.

## Verification

**Results (2026-09-28):**
- `pnpm typecheck`, `pnpm lint`: exit 0.
- Baseline (stashed, `db reset`, build): `pnpm test` 268 + 2850 + 3232 = 6350 passed (the first run straight after the reset had 5 timeouts in `rls-isolation.test.ts`; the rerun passed clean).
- After: `supabase db reset`, build, `pnpm test`: 268 + 2891 + 3267 = 6426 passed, 0 failed.
- `pnpm test:e2e`: 106 passed (second full run; see the change log).
- `supabase db reset` from the main checkout afterwards.

**Mutation proof** (`scratchpad/name-normalization/mutate.py`; each planted, run, restored; count = failing tests):
- M1 DB: `name_key` trims spaces only → 17 fail (blank per table, padded duplicates, BMP agreement).
- M2 DB: `name_key` without NFC → 7 fail (NFD duplicate per table, key agreement).
- M3 DB: EXECUTE revoked from `authenticated` → 10 fail (every live write, grantee list).
- M4 guard never raises → 5 fail (each guard case).
- M5 guard appends an untyped literal (the real bug) → 1 fail.
- M6 migration's members check back to `btrim` → 1 fail (scaffold).
- M7 client `enteredName` blank by `trim()` → 9 fail (utility + the three surfaces).
- M8 client `nameKey` without NFC → 1 fail (unit) and 3 fail (agreement).
- M9 client class lacks U+0085 → 2 fail (BMP agreement).
- M10 teams / hour bands / shift types store NFC → 1 fail each (NFD sent as typed).
- M11 teams / hour bands / shift types blank by `trim()` → 2 fail each.

**Review round 1 results (2026-09-29):**
- `pnpm typecheck`, `pnpm lint`: exit 0.
- `supabase db reset` (worktree), web build, `pnpm test`: 268 + 2893 + 3282 = 6443 passed, 0 failed.
- `pnpm test:e2e`: 106 passed, first run.
- `supabase db reset` from the main checkout afterwards.

**Review round 1 mutation proof** (`scratchpad/name-normalization/mutate2.py`, log `mutations2.log`; each planted, run, restored; count = failing tests):

| # | Mutation | Failing tests |
| --- | --- | --- |
| N1 | `name_key` also created in `public`, granted to `authenticated` (an RPC again) | 1 (RPC refused as PGRST202) |
| N2 | `name_key` trims one character per loop step (quadratic plpgsql) | 1 (100k pathological key, cancelled by `statement_timeout`) |
| N3 | EXECUTE revoked from `service_role` | 2 (operator update of the five tables, grantee list) |
| N4 | USAGE on `private` revoked from `service_role` | 0 at first: writes need EXECUTE only (see change log); after adding the schema ACL test, 1 |
| N5 | EXECUTE granted to `anon` | 1 (grantee list) |
| N6 | `name_key` trims spaces only (M1 redone on the `btrim` form) | 21 |
| N7 | EXECUTE revoked from `authenticated` (M3 redone) | 10 |
| N8 | client `trimName` back to an anchored regex | 1 (100k pathological trim exceeds its 2 s limit) |
| N9 | `createPayloadOf` blank-checks with `trim()` | 2 (NEL alone, information separators) |
| N10 | Deno class lacks U+0085 | 2 (NEL alone, Deno/client list agreement) |
| N11 | `saveMember` blank check removed | 1 |
| N12–N14 | guard skips blank organizations / hour_bands / shift_types | 1 each (its blank case) |
| N15 | guard's teams duplicate query loses `where not archived` | 1 (archived team negative) |
| N16 | guard's shift_types duplicate query loses `where not archived` | 1 (archived type negative) |
| N17 | guard always raises (M4 inverted) | 3 (both negatives, the clean run) |
| N18 | a planted `0099_*.sql` with `check (btrim(name) <> '')` | 1 spine-rule test (+1 numbering test, expected) |
| N19 | a planted `0099_*.sql` with `lower(btrim(name))` | 1 spine-rule test (+1 numbering test, expected) |
| N20 | SQL `U&` list lacks U+0085 | 1 (source list decodes to the client's) |
| N21 | helper defined in `public` again (source) | 1 |
| N22 | USAGE on `private` granted to `anon` | 1 (schema ACL) |

**Commands:**
- `pnpm typecheck`, `pnpm lint` -- expected: exit 0.
- `pnpm exec supabase db reset`, then `pnpm test` -- expected: pass.
- `pnpm test:e2e` -- expected: pass.

## Suggested Review Order

1. `supabase/migrations/0024_name_key.sql` — the header (class and why, grants, guard), `name_key`, the guard `do` block, then the checks and indexes (names unchanged).
2. `apps/web/src/utils/name.ts` — the client class and `enteredName` (stores `trim()`, decides blank with the class).
3. `apps/web/src/features/{teams,hour-bands,shift-types}/services/write.ts` — the three `entered*Name` helpers now delegate.
4. `test/name-key.test.ts` — live refusals per table as `authenticated`, the BMP agreement, the guard cases.
5. `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts` — index definitions, grantee list, 0024 source shape.
6. Unit tests: `apps/web/src/utils/name.test.ts` and the three `write.test.ts` additions.
7. `_bmad-output/implementation-artifacts/deferred-work.md` — the two closed entries removed.
