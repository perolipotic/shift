---
title: "16.3 A member's feed token is a revocable secret"
type: 'feature'
created: '2026-11-21'
status: 'in-review'
baseline_commit: '7e4604216a2530adbbf4ce17860b33fb03a9ef31'
review_loop_iteration: 2
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-16-context.md'
---

Status: built, CI pending (no PR yet). Baseline: `main` at #339 (16.2); touches no hot file. Migration `0067` (19.1, PR #341, holds `0066`); renumber at merge if needed.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The feed (16.4) needs a bearer secret a calendar app can carry in a URL, which only the member holds, which dies at once on regeneration, turn-off, admin revocation or deactivation, and whose stored form is itself useless to a reader (D-S1, AD-14).

**Approach:** Migration `0067_calendar_feed_tokens.sql`: the table (hash only, no privilege for any role), the member's create/regenerate and turn-off, the admin's revoke, both state reads, the anon lookup `calendar_feed_inputs(p_token_hash)` over 16.2's assembly, the deactivation/reactivation revoke trigger, and an audit recorder that never stores the hash. Pinned by source in the scaffold suite and by a DB suite written unrun.

## Boundaries & Constraints

**Always:**
- Token: `extensions.gen_random_bytes(32)` as unpadded base64url, `rtrim(translate(encode(b,'base64'),'+/','-_'),'=')`, 43 chars, returned once; stored only as `sha256(convert_to(token,'UTF8'))`, a unique 32-byte `bytea`. At most one unrevoked token per member (partial unique index). No expiry.
- `calendar_feed_tokens`: `organization_id` first, RLS on, no policy, `revoke all` from `anon`, `authenticated`, `service_role` (so no column privilege on `token_hash`). Every access is a definer with an empty `search_path`.
- State reads return exactly `{live, created_at, last_fetched_at}`; `live` = an unrevoked token whose member is live (active in the organization's today, account neither deleted nor banned); the stamps are the live token's, else null.
- Lookup: 64 lowercase hex else null; finds the unrevoked row whose member is live (as the state); on a hit sets `last_fetched_at` only when null or older than 15 minutes, and returns `{window:{from,to}, inputs}` with `today−31 … today+182` from `organization_today` and `private.member_schedule_inputs`. `VOLATILE`, `anon` only. Every miss is the same null.
- Deactivation: an inactive status version with `effective_from <= organization_today` revokes the live token in the insert's transaction; an active version inserted after an inactive one revokes any token still live. Revoked by the version's `created_by`.
- Audit: own recorder writes `to_jsonb(row) - 'token_hash' - 'last_fetched_at'`; the update trigger ignores a change of `last_fetched_at` alone. TRUNCATE revoked.
- The pinned vector (`PARITY_VECTOR` → `2375020b…c232`) is reused from `packages/domain/parity/fixtures.ts`, never restated as a literal token.

**Ask First:** none (founder: decide and record).

**Never:** the Edge Function, `@shift/ics`, the router/config entry, Kong log level (16.4); any screen or `hr.json` copy (16.5); a pepper or keyed hash (D-S1 ratified plain SHA-256); suspension (`private.organization_live` does not exist yet); running DB tests, e2e, `supabase` or docker containers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | active member, none live | 43-char token; one row, hash only | none |
| Regenerate | live token | old revoked, new returned; old hash misses | none |
| Turn off / admin revoke | live / none live | revoked / no-op | other org's member → P0002 `CALENDAR_FEED_MEMBER_UNKNOWN` |
| Not allowed | claimless, inactive, member-role calling admin revoke | — | 42501 `CALENDAR_FEED_REFUSED` |
| Lookup | vector hash; malformed; unknown; revoked; deactivated today | `{window, inputs}` / null ×4 | none |
| Fetch stamp | last fetch 5 min / 20 min ago | unchanged / now(); no audit row | none |
| Future deactivation | dated tomorrow, then in effect | token stays until the date; lookup misses from it | none |
| Reactivation | active version after inactive | live token revoked | none |

## Epic AC Deviations

- "their feed answers the one 404 from the deactivation's effective date" — **narrowed**: 16.3 proves the lookup's null (the RPC 16.4's 404 is built on); the 404 itself is 16.4's.
- "the admin never sees the URL or the token" — proven at the database (no read returns token or hash); the admin screen is 16.5 (UX-DR55). The admin's change-history read shows a token's creation and revocation instants and who revoked it, never the token or hash (accepted; security review).
- "the change history records the event" (14.1 pattern) — **reinterpreted**: recorded through the table's own recorder (0061's is never replaced), and read as the generic `other` record until 16.5 names it (deferred-work, OWNER 16.5).
- Header "Applies the AD-2 row for the Feed Token and its AD-9/AD-10 RPCs" — **narrowed**: no AD-2 row (the token feeds no derivation); the AD-10 suspension gate waits for `private.organization_live` (deferred-work, OWNER epic 19).

</frozen-after-approval>

## Code Map

- `supabase/migrations/0067_calendar_feed_tokens.sql` (new) -- everything above.
- Reuse: `public.organization_today` (0008:138), `public.member_active_on` (0008:169), `public.current_member_access()` (0003/0008), `private.member_schedule_inputs` (0065), 0045's definer/claim/advisory-lock pattern (`register_push_subscription`), 0064's admin gate (`remove_team_loan`; no organization lock: the token table takes none), 0041's AFTER INSERT trigger on `member_status_versions`, 0061's `private.record_audit_event` (copied, not replaced: the scaffold forbids `create or replace` of it).
- `test/supabase-scaffold.test.ts` -- `auditCoverage` learns a table audited by its own recorder (`calendar_feed_tokens`); new describe for 0067's source pins.
- `test/provisioning.test.ts` -- RLS table list, definer inventory, exact grantees and the sweep gain the new table/functions (unrun).
- `test/calendar-feed-tokens.test.ts` (new) -- DB suite, rolled-back transactions, claims injection (no GoTrue, so no PostgREST warm-up needed), unrun.
- `e2e/utils/database-helper.ts` -- deliberately unchanged: the member and organization keys cascade (as 0045), so every cleanup that deletes a member deletes its tokens in the same statement.
- Mappers (rule A11): no existing row gains a column; `packages/domain/src/history.ts` reads the new table as `other` (generic, never a failed read), deliberately left to 16.5.
- Spine: AD-14 and AD-11 `Amended 2026-11-21 (16.3)` clauses.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0067_calendar_feed_tokens.sql` -- table, index, functions, triggers, grants.
- [x] `test/supabase-scaffold.test.ts` -- source pins; audit coverage accepts the own recorder.
- [x] `test/provisioning.test.ts` -- inventories.
- [x] `test/calendar-feed-tokens.test.ts` -- the matrix, the vector, the audit rows, cross-org.
- [x] `ARCHITECTURE-SPINE.md` -- AD-14 and AD-11 clauses as shipped.
- [x] `deferred-work.md` -- 16.4 entry RESOLVED in part (the lookup's gate); new entries: suspension in the lookup (epic 19), history naming (16.5), the 404 (16.4), migration numbering (merge), the security review.
- [x] `sprint-status.yaml` -- 16.2 `done  # #339`, 16.3 `review  # built, CI pending`; 16.2 spec rewritten as merged.

**Acceptance Criteria:**
- Given any session role, when it asks for any privilege on `calendar_feed_tokens` or a column of it, then it holds none.
- Given every audit row of the table, when read, then none contains `token_hash`.
- Given `anon`, when it executes the lookup, then it may, and no other new function is executable by `anon`.

## Spec Change Log

- 2026-11-21, review 1 (unattended; founder: decide and record). Findings: the frozen Boundaries named `revoked_*` and an audit that kept `last_fetched_at`; the Epic AC Deviations omitted the own recorder, the `other` history record and the AD-2/AD-10 header; the edge-case layer found the lookup served a deleted or banned account. Amended: the Boundaries, the Deviations and decisions 2, 6, 7, in place. Avoids: a spec that contradicts the migration and a feed alive for an account that cannot sign in. KEEP: the hash-only table with no privilege, the own recorder, the per-member lock, the lookup in 16.3.
- 2026-11-21, review 2, the security review the epic requires (D-S1, D-S8; NFR-27; unattended, founder: decide and record). Five layers (blind hunter, edge-case hunter, verification gap, acceptance auditor, epic AC auditor; no generated file). No finding changed the migration or the frozen sections: the defects were in the unrun suite's proof, which is patched. Avoids: a CI-green suite that would miss a banned account's feed, a hash in a revoke's or a cascade's audit row, or a recorder writing the wrong `row_id`/`actor`. KEEP: 0067 as reviewed.

## Design Notes

Decisions (founder: decide and record):
1. **16.3 ships the lookup RPC.** The deactivation AC is the lookup's rule and the vector is pinned for "16.3's SQL suite"; 16.4 adds only the function that calls it.
2. **Names:** `create_calendar_feed_token()` (create and regenerate, returns text), `revoke_own_calendar_feed_token()`, `revoke_member_calendar_feed_token(p_member)`, `calendar_feed_status()`, `member_calendar_feed_status(p_member)`, `calendar_feed_inputs(p_token_hash)`. The revocation columns are `removed_by/removed_at`, the repository's removal pair, so history reads a revoke as a removal (spine amended).
3. **A member with no team may hold a live feed** (ratified); creation checks only "active account of the claimed organization".
4. **Serialization:** one advisory lock per member (`shift.calendar_feed_tokens:<member>`) in create, revokes and the status trigger, so a regenerate race leaves exactly one live token.
5. **No AD-2 row:** the token feeds no derivation (as suspension).
6. **Member rule** `private.calendar_feed_member_live`: active today AND `current_member_access()`'s account clause (not deleted, not banned), stated once for the state and the lookup.
7. **Kept as is:** the lookup's `FOR UPDATE` spans the assembly (a revoke waits at most one fetch; pilot scale; its cost, a row lock written on every hit, the 15-minute throttle included, is accepted for the guarantee that a revoke committing during a fetch wins, review 2); the state reads are VOLATILE (they call 0008's VOLATILE readers; supabase-js `rpc` POSTs); a token whose member's scheduled deactivation arrived stays unrevoked but dead until a reactivation revokes it (the lookup's rule, AD-14).

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build`
- `pnpm --filter @shift/domain test`
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/key-hygiene.test.ts test/localization-guard.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts test/runtime-parity.test.ts` (review 2 ran the four the orchestrator allows: resource-hygiene, supabase-scaffold, key-hygiene, runtime-parity)

**Results (2026-11-21):** `pnpm typecheck`, `pnpm lint`, `pnpm build` pass; `pnpm --filter @shift/domain test` 20 files, 950 tests pass; the seven root files: 2470 tests, all pass but one, "numbers migrations 0001, 0002, … with no gaps", which fails by design while `0066` (19.1, PR #341) is not on `main` (deferred-work, numbering entry).

**Residual risk (CI settles):** 0067, `test/calendar-feed-tokens.test.ts` and the provisioning entries have never run against a database (STRICT DATABASE RULE); the exact `pg_get_triggerdef` text the suite pins for the WHEN clause was written from expectation. No two-connection race test of the per-member lock (security review entry). CI's `CI passed` stays red on the numbering pin until this branch is rebased onto 19.1 or renumbered.

**Review 1 (five layers):** patched — every refusal followed by more work now uses a savepoint (`refusedThenContinue`); status versions are inserted with 0008's four granted columns (`created_by` from its default); `tokensOf` orders revoked first (both tokens share one `now()`); cases added for a deactivated admin and a claimless caller on both admin functions, an inactive member on all three own functions, an admin's no-op revoke and the unknown/null member; the member rule now includes the account clause; spec, spine and deferred-work text corrected. Rejected: the reactivation branch for a same-date active version (one version per member per date, 0008); a malformed `organization_id` claim answering 22P02 (every definer in the repository casts it so); exporting the digest (an independent pin, as 16.2's); `test/rls-isolation.test.ts`'s `AUDITED_TABLES` (used only for its truncate sweep; this suite sweeps TRUNCATE itself).

## Suggested Review Order

**The credential**

- Hash-only table, no privilege for any role, one live token per member.
  [`0067_calendar_feed_tokens.sql:63`](../../supabase/migrations/0067_calendar_feed_tokens.sql#L63)

- Create/regenerate: lock, re-check access, revoke, store SHA-256, return once.
  [`0067_calendar_feed_tokens.sql:139`](../../supabase/migrations/0067_calendar_feed_tokens.sql#L139)

**The lookup and the member rule**

- Anon's one function: hex in, one null for every miss, window plus assembly.
  [`0067_calendar_feed_tokens.sql:463`](../../supabase/migrations/0067_calendar_feed_tokens.sql#L463)

- Active today and an account that may sign in, stated once.
  [`0067_calendar_feed_tokens.sql:312`](../../supabase/migrations/0067_calendar_feed_tokens.sql#L312)

**Revocation**

- Admin turn-off, scoped to the claimed organization.
  [`0067_calendar_feed_tokens.sql:259`](../../supabase/migrations/0067_calendar_feed_tokens.sql#L259)

- Deactivation in effect, or reactivation, revokes in the insert's transaction.
  [`0067_calendar_feed_tokens.sql:522`](../../supabase/migrations/0067_calendar_feed_tokens.sql#L522)

**History**

- Own recorder drops the hash and the fetch stamp.
  [`0067_calendar_feed_tokens.sql:564`](../../supabase/migrations/0067_calendar_feed_tokens.sql#L564)

- The coverage pin learns a table audited by its own recorder.
  [`supabase-scaffold.test.ts:3565`](../../test/supabase-scaffold.test.ts#L3565)

**Tests**

- Source pins for 0067.
  [`supabase-scaffold.test.ts:5934`](../../test/supabase-scaffold.test.ts#L5934)

- DB suite (unrun): deactivation, scheduled date, reactivation.
  [`calendar-feed-tokens.test.ts:466`](../../test/calendar-feed-tokens.test.ts#L466)

**Review 2 (security review; five layers):**

Patched (all in `test/calendar-feed-tokens.test.ts`; 0067 unchanged):
- The account clause had a source pin only: new case, a banned and then a deleted account's feed is not served and reads not live, and a lapsed ban serves again.
- Audit rows were proven hash-free only for create, regenerate and the member's revoke: new case covering an admin revoke, a deactivation revoke and the cascade DELETE of a deleted member (`old_row` alone), with no `token_hash`, `last_fetched_at`, token or hash text, and the admin as the actor of both revokes.
- The recorder's `row_id` and `actor` were never asserted, and the stamp case passed as 0 = 0 on a wrong `row_id`: the AD-11 case pins `row_id` per token and `actor` per row; the stamp case pins one creation event first.
- The table-privilege probe missed PG 17's `MAINTAIN`: added.
- `tokensOf` named the `removed_*` pair `revokedAt`/`revokedBy`: renamed `removedAt`/`removedBy`.
- Docs: the deferred-work 16.2 entry's resolved gate now names the account clause; the security-review entry is narrowed to what 16.4 still owes and gains the miss timing and `pg_read_all_data`; a retention entry (19.5) for revoked rows; the 16.5 entry notes a regeneration's two events; the Verification commands list `@shift/domain`.

Rejected, with reasons:
- *A scheduled reactivation revokes a live feed early; the reactivation test matches any earlier inactive version; a backdated deactivation revokes an active member* (blind hunter, acceptance auditor): 0008's insert policy writes versions only in date order, dated today or later, each flipping `active`, and only once the latest is in effect, so a deactivation and a reactivation cannot both be scheduled ahead, an active insert always follows an inactive latest, and an inactive one dated `<=` today is dated today.
- *Only INSERT revokes* (blind hunter, edge-case hunter): 0008 grants no UPDATE, and its DELETE cancels only a version not yet in effect, which never decided a day. An owner or `service_role` writer outside the policy is the operator, as for every 0008 rule.
- *A lifted ban revives the link* (blind hunter, edge-case hunter): a ban is the auth layer's, not the product's deactivation; the feed follows sign-in, as `current_member_access()` does. Deactivation is the revocation (AD-14).
- *`for update` on every hit* (blind hunter, edge-case hunter): decision 7, its cost now recorded.
- *Miss timing tells a former token's holder whether it was replaced or its member deactivated* (edge-case hunter): it needs a token once held, from which it learns no more than the link stopped working; a 256-bit token is not guessable, and every unknown hash takes the same index probe. Recorded for 16.4's timing class (security-review entry).
- *`member_role` is not a role value* (blind hunter): it is 0002's (`check (role in ('admin', 'member_role'))`), and a member with no version is active (0008).
- *The admin's read shows `last_fetched_at`* (blind hunter): frozen Boundaries (the state reads' one shape); an admin learns that a calendar polls, not what or where.
- *A raw 23505 under a lost race; a revoke with no `removed_by`; the recorder drifting from 0061's* (blind hunter): the lock serializes every writer; `removed_by` is the version's author, null only for an owner insert, as 0041's closes; 0061's recorder cannot be replaced (scaffold pin), so the copy cannot drift from it.
- *The spine's reader note, thin ACs, the digest literal* (blind hunter): the spine amends by appended clauses; the ACs and the I/O matrix are frozen; the digest was rejected in review 1.

Deferred: the two-connection race test, the 404's timing class and the `pg_read_all_data` roles (security review of 16.4); retention of revoked rows (19.5).

Checked and found sound, by reading (nothing ran against a database): no session role reaches `token_hash` (no privilege, no policy, no view, no read or RPC returns it, no audit row holds it; a 23505 on `token_hash` would print it but needs a SHA-256 collision); the lookup's every miss is the one null with no write, its input checked before `decode`; `gen_random_bytes(32)` gives 256 bits, 44 base64 characters with no line break; the per-member lock and READ COMMITTED's per-statement snapshot serialize regenerations and order a creation against a deactivation either way; the admin functions resolve the member within the claimed organization; the suite builds owner scenes before `actAs`, takes a savepoint before every refusal it continues after, and its `pg_get_triggerdef` text follows the deparse the existing pins prove (`old.*`, `'…'::text`, `private.` qualified).

**Results (review 2, 2026-11-21):** `pnpm typecheck`, `pnpm lint`, `pnpm build` pass; `pnpm --filter @shift/domain test` 20 files, 950 tests pass; the four allowed root files 2100 tests, all pass but the numbering pin (expected until `0066`).
