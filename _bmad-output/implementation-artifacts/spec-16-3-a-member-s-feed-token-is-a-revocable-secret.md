---
title: "16.3 A member's feed token is a revocable secret"
type: 'feature'
created: '2026-11-21'
status: 'in-review'
baseline_commit: '7e4604216a2530adbbf4ce17860b33fb03a9ef31'
review_loop_iteration: 1
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

## Design Notes

Decisions (founder: decide and record):
1. **16.3 ships the lookup RPC.** The deactivation AC is the lookup's rule and the vector is pinned for "16.3's SQL suite"; 16.4 adds only the function that calls it.
2. **Names:** `create_calendar_feed_token()` (create and regenerate, returns text), `revoke_own_calendar_feed_token()`, `revoke_member_calendar_feed_token(p_member)`, `calendar_feed_status()`, `member_calendar_feed_status(p_member)`, `calendar_feed_inputs(p_token_hash)`. The revocation columns are `removed_by/removed_at`, the repository's removal pair, so history reads a revoke as a removal (spine amended).
3. **A member with no team may hold a live feed** (ratified); creation checks only "active account of the claimed organization".
4. **Serialization:** one advisory lock per member (`shift.calendar_feed_tokens:<member>`) in create, revokes and the status trigger, so a regenerate race leaves exactly one live token.
5. **No AD-2 row:** the token feeds no derivation (as suspension).
6. **Member rule** `private.calendar_feed_member_live`: active today AND `current_member_access()`'s account clause (not deleted, not banned), stated once for the state and the lookup.
7. **Kept as is:** the lookup's `FOR UPDATE` spans the assembly (a revoke waits at most one fetch; pilot scale); the state reads are VOLATILE (they call 0008's VOLATILE readers; supabase-js `rpc` POSTs); a token whose member's scheduled deactivation arrived stays unrevoked but dead until a reactivation revokes it (the lookup's rule, AD-14).

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm build`
- `pnpm exec vitest run test/resource-hygiene.test.ts test/supabase-scaffold.test.ts test/key-hygiene.test.ts test/localization-guard.test.ts test/import-cycles.test.ts test/feature-boundaries.test.ts test/runtime-parity.test.ts`

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
