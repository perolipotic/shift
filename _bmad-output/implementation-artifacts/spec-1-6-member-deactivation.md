---
title: 'Story 1.6: Deactivating a member changes the future and rewrites no history'
type: 'feature'
created: '2026-09-23'
status: 'done'
review_loop_iteration: 1
baseline_commit: '6108e8395c6c55ac3e8bb141c61f7869ebbad1ff'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Active state today is `auth.users.banned_until`, which is current-state (AD-2 classifies member active status as **versioned**), cannot answer "was this member active on 2026-03-01", and nothing in the product can set it — `ban`/`unban` answer 501. An admin has no way to stop someone who left from signing in or appearing on future rosters.

**Approach:** Add a versioned active-status table (one row per change, effective from a date, never updated in place; no rows means active; a change not yet in effect may be cancelled). It becomes the authority for active state: `current_member_access()` is extended to read the version covering today in the organization's timezone, and `custom_access_token_hook` refuses to issue a token to a member inactive today. The admin deactivates or reactivates from the member edit screen with a date defaulting to today; the list marks inactive members in words.

## Boundaries & Constraints

**Always:**
- Effective date is **today or later in the organization's timezone**, refused by the database otherwise. A past date would rewrite past rosters. Human decision 2026-09-23.
- A version is a new row; there is no update policy. Status as at date D = the row with the greatest `effective_from <= D`; none means active.
- **Versions append in date order and each one changes something:** a new version must be dated after the member's latest version and its `active` must differ from the state it follows (the latest version's, or active when there is none).
- **A version not yet in effect may be cancelled** — deleted by an own-organization active admin while `effective_from` is after the organization's today. A version in effect is never deleted. Human decision 2026-09-23.
- `effective_from` is a finite date before year 10000, refused by the table otherwise.
- **Extend** `current_member_access()` with `create or replace`, identical return shape and grants; the `deleted_at`/`banned_until` clause stays and is ANDed.
- The hook refuses with `{"error":{"http_code":403,...}}` — a 4xx other than 429 so `sign-in.ts:108-116` shows the generic `auth.error.credentials`, never a distinct message (no account oracle; `resource-hygiene.test.ts:76-79`). The hook must never raise: an unresolvable organization timezone falls back to UTC rather than locking the organization out.
- **Never zero active admins, on any date.** A change that makes an **admin** inactive from date D — a deactivation dated D, or cancelling their reactivation dated D — is admitted only if **another admin is active on every date from D onward** (scheduled versions included). The existing `refuse_organization_with_no_admin()` applies the same reading from the organization's today: some admin must be active on every date from today onward. A change to a non-admin never consults this rule. Enforced in the insert and delete policies and in that function's body — no second constraint trigger (AD-3). Human decision 2026-09-23, replacing the "latest version" reading.
- An admin cannot deactivate themselves; refused by the database.
- Every user-facing string through `t()`, registered in `hr.json`, `SANCTIONED_SCREEN_KEYS`, `AUTHORED_VOCABULARY`, `KEY_SOURCES` in the same commit. Screen logic in `.ts`, executed by a test (AD-15). Every control `h-11`.

**Ask First:**
- Editing a scheduled version in place, or cancelling one already in effect.
- Any change to the stale-access-token window (see Design Notes).

**Never:**
- No `ban`/`unban`, no GoTrue `banned_until` write, no session revocation (none exists without a password change, `operations.ts:269-280`). `ban`/`unban` leave `admin-auth`'s vocabulary. Human decision 2026-09-23.
- No `is_active`/`active` column on `members` (`provisioning.test.ts:703`). No status row required at member creation — seed, provisioning and `createUser` are untouched.
- No roster derivation — none exists yet; Epic 3 re-asserts preservation against its own records.
- No Dialog primitive, no new route, no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Deactivate today | Admin, own-org member, date = org today | Row inserted; member's next query reads nothing; sign-in and refresh refused | N/A |
| Deactivate in future | Date = today + 7 | Member active until then, inactive from that date | N/A |
| Past date | Date = org yesterday | Refused, nothing written | Named refusal, entered values kept |
| Earlier status | Deactivated from D | Status as at any date < D is active | N/A |
| Reactivate | Inactive member, active row from D2 | Inactive on [D, D2), active from D2 | N/A |
| Same date twice | A row already exists for that member and date | Refused | Named refusal |
| Self | Admin targets own row | Refused; control not offered on own row | Named refusal |
| Last active admin | Deactivating an admin from D while no other admin is active on every date from D | Refused | Maps to existing last-admin message |
| Demote with other admin deactivated | Role edit leaves no active admin | Refused by the existing trigger | `ORGANIZATION_WOULD_HAVE_NO_ADMIN` |
| Non-admin or foreign admin | Insert via PostgREST | Refused, nothing written | RLS |
| Deactivated sign-in | Correct credentials | Generic credentials message | Hook 403 |
| Cancel scheduled | Member with a change dated after today | Row deleted; the state before it continues on every date | N/A |
| Cancel in effect | Version dated today or earlier | Refused, row kept | Named refusal |
| Out of order | New version dated on or before the member's latest version | Refused | Named refusal |
| Redundant | Deactivating a member whose latest state is inactive, or reactivating an active one | Refused | Named refusal |
| Scheduled change shown | Member active today, deactivation scheduled (or inactive today, reactivation scheduled) | Block states today's status and the scheduled change; offers only its cancellation | N/A |
| Gap with no admin | Admin B out today, reactivation scheduled; A and C then schedule each other out | The second deactivation is refused | Last-admin message |
| Demote while other admin out | Other admin inactive today, reactivation scheduled | Demotion refused by the trigger | `ORGANIZATION_WOULD_HAVE_NO_ADMIN` |
| Non-admin with admins scheduled out | Deactivating a `member_role` member | Admitted; never shown the last-admin message | N/A |
| Unbounded date | `effective_from` = `infinity` or year 10000 | Refused by the table | N/A |
| Bad org timezone | `timezone` not in `pg_timezone_names` | Hook and helper use UTC's date; sign-in still works | N/A |

</frozen-after-approval>

## Code Map

Baseline: current `HEAD` of `feat/1-6-member-deactivation`, green at **1514 root / 1160 web / 4 domain**. `nvm use` (Node 24.19.0); `pnpm build` before `pnpm test`.

**Database** (new `supabase/migrations/0008_member_status.sql`; numbering is contiguous by hand, `supabase-scaffold.test.ts:23,81-108`)
- `0002:115-158` `members`; `unique (organization_id, id)` `:157` is the composite-FK target. `organizations.timezone` `:93` is deliberately unchecked `:89-92`.
- `0002:193-223` `refuse_organization_with_no_admin()` — replace the `exists(role='admin')` `:209-216` with "an admin active on every date from the organization's today onward" (the frozen block's reading). Trigger `:242-246` untouched.
- `0003:107-120` `current_member_access()`; grants `:146-149`. `0003:181-206` the hook; grants `:220-224`. `authorize.ts:55,105-116` validates the helper's exact shape.
- **Do not write the phrase "create constraint trigger" anywhere, comments included** — `supabase-scaffold.test.ts:175-183` counts it. No IANA zone names or fixture names in migrations `:196-236`.
- Inventories that must move: `rls-isolation.test.ts:926-940` (public policies, exactly six), `supabase-scaffold.test.ts:296-340` (nine, from source), `:272-294` (every policy `to authenticated`, none `for all`), `provisioning.test.ts:750-770` (RLS-enabled tables `in` list), `:852-900` (`ACCESS_CONTROL_FUNCTIONS` grantees), `:604-632` (constraint triggers = 1, stays).
- "Active on every date from D onward" = active on D **and** no inactive version dated after D. A policy cannot select from its own table (iteration 0 hit a recursion error), so the per-member reads go through a helper; keep helpers SECURITY INVOKER unless recursion forces otherwise, and never expose a definer helper that takes an arbitrary member id to `authenticated` without the caller's organization check inside it.
- **`rls-isolation.test.ts:3577` `LIST_COLUMNS` is stale** (missing `username` since 1.5b); the live list cases `:3685-3752` and the 400-member budget case `:3754-3828` send it. Bring it to the shipped `MEMBERS_COLUMNS` as a written-out literal.
- Tests: `rls-isolation.test.ts` — `actAs` `:554-568`, `tokenFor` `:317`, `addThrowawayMember` `:713-790`, cleanup `:792-829`, direct hook calls `:1019-1091`, freshness block `:3234` with the expired-ban control `:3441-3471`, column-free write pattern `:3322-3388`. `now()` is frozen inside `inRolledBackTransaction` `:232`. Both fixtures are `Europe/Zagreb` (`seed.sql:55,169`), so a timezone case sets a different zone inside a rolled-back transaction. Each fixture has exactly one admin.

**Boundary** — `handler.ts:30-36` `OPERATIONS`, `:51` `UNIMPLEMENTED_OPERATIONS`, `:307-311` 501 fall-through, `NOT_IMPLEMENTED` `:78`/`TRANSPORT_CODES` `:83-90` (mirrored in SPA `WIRE_CODES`); `operations.ts:1-59` header, `:843` `ban_duration` comment. `admin-auth-boundary.test.ts:112-173` (`STILL_UNIMPLEMENTED` and the partition), `:176-184`, `:186-202` (OPERATIONS pin), `:204-221`, and every `STILL_UNIMPLEMENTED` use (`:296,:307,:317,:411,:429,:441`) must be repointed to an implemented operation with fakes. `DEPLOY.md:122-125,503-505`. `ARCHITECTURE-SPINE.md` AD-16 `:148-160`.

**Surface**
- `apps/web/src/i18n/format.ts` — the only `Intl` site, import-free `:27-32`; `partsOf` `:134`, `isRenderableTimeZone` `:160`. Add the organization-local ISO date here.
- `organization/snapshot.ts:459` `organizationTimeZone`, `readOrganization` `:569`; `ljudi.novi.tsx:119-120` already reads it.
- `members/list.ts` — `MEMBERS_COLUMNS` `:96-97` (comment `:94-95` names 1.6), `MemberListRow` `:220-236`, `MEMBER_COLUMNS` `:593`, cell kinds `:519-543`. Pins: `list.test.ts:204-206,432-440`, `prijava.test.ts:1942-2040` (ljudi.tsx may read no row field but `id`) — the marker is computed in `list.ts`.
- `members/write.ts` — `resetStageOf` `:784-793` and stage constants `:746-752` are the pattern; `raisedForMember` `:709-711`; `MEMBER_EDIT_COLUMNS` `:215`. `wire.ts` failure union `:129-141`, `memberWriteMessageKey` `:363-408`.
- **The offer** (pure, in `write.ts`): nothing on the caller's own row — and the database refuses every insert **and** cancellation targeting the caller's own row, since cancelling one's own reactivation is a self-deactivation. If the member's latest version is dated after today, the block states today's status and the scheduled change, and offers only **cancel**. Otherwise it offers deactivate (active today) or reactivate (inactive today) with the date's minimum = the later of today and the day after the latest version. An armed confirmation is cleared when a refetch changes that member's versions.
- **One ISO-date validator**, in `format.ts`, rejecting impossible dates (`2026-02-31`); `list.ts` and `write.ts` import it. No second `SHAPES` entry for the same shape.
- **A future change is worded in the future** ("bit će neaktivna od …"), today-or-past in the present. A status refusal's `aria-describedby` points at the status block's refusal only, never at an unrelated form error.
- `routes/ljudi.$id.tsx` — new block between `renderReset()` `:629` and the back link, own ref/pending/armed state; caller's uid via `currentSession`. `components/ui/input` passes `type="date"` through.
- Gates: `prijava.test.ts` `expectedControls` `:291`, strings `:1144-1163`, `IN_FLIGHT_HANDLERS` `:407-424` and counts `:3047-3078`; `resource-hygiene.test.ts` keys `:70-371`, imperative pins `:569-617`, prose counts `:279,:304`; `localization-applied.test.ts` `SOURCES` `:48-183`, `AUTHORED_VOCABULARY` `:435-691`, `Nema` banned `:709`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0008_member_status.sql` -- `member_status_versions` (`organization_id` first, `member_id` composite FK, `active`, `effective_from date`, attribution defaults, `unique (member_id, effective_from)`); RLS on; select, insert and (not-yet-in-effect) delete policies, no update policy; the date-order, changes-something and finite-date rules; `organization_today(uuid)` and invoker `member_active_on(uuid, date)`; extend helper, hook and trigger function -- the whole enforcement.
- [x] `test/rls-isolation.test.ts`, `test/provisioning.test.ts`, `test/supabase-scaffold.test.ts` -- every matrix row over both fixtures; forged `created_by` **and** `created_at` both refused; the shipped list select sent live as an admin and a member-role token, asserting `organizations` is an object and the versions an array the reader sees, and the 400-member budget case run with it; freshness cases extended; column-free insert case; hook refusal by direct call **and** by real password grant; hook and helper agree; inventories moved -- the database is the enforcement, so it is where the matrix is proven.
- [x] `supabase/functions/admin-auth/handler.ts`, `operations.ts`, `test/admin-auth-boundary.test.ts`, `apps/web/src/members/wire.ts` -- remove `ban`/`unban`, the 501 path and `NOT_IMPLEMENTED`; repoint the tests -- dead vocabulary.
- [x] `ARCHITECTURE-SPINE.md` AD-16, `DEPLOY.md` -- amend: deactivation is an RLS-governed write, sign-in blocked by the hook -- the spine must match the code.
- [x] `apps/web/src/i18n/format.ts`, `members/list.ts`, `members/write.ts` (+ tests) -- organization-local today and the one ISO-date validator; status embedded in the list read and derived as at today, with the scheduled change; `deactivate`/`reactivate` inserts and `cancel` delete over PostgREST with refusal mapping (the last-admin message only when the target is an admin); the offer and stage functions -- logic executable without a browser.
- [x] `apps/web/src/routes/ljudi.$id.tsx`, `routes/ljudi.tsx`, `hr.json` + gates -- the block (offer per the Code Map, confirm naming the member and date, busy, refusal keeps the date) absent on own row; the list's marker in words for inactive today and for a scheduled deactivation.

**Acceptance Criteria:**
- Given a deactivation, when the table is inspected, then a new row exists and no existing row changed.
- Given a member deactivated from D and reactivated from D2, when status is asked for every date across the period, then only [D, D2) reads inactive.
- Given a deactivated member holding a token minted earlier, when they query any table, then they read nothing.
- Given the edit screen at phone width, when the block is used, then every control clears 44 px with no horizontal page scroll.

## Spec Change Log

### 2026-09-23 — iteration 0, three adversarial layers, intent_gap loopback

**Why this looped back.** Two findings had their root cause inside the frozen block. (1) The "latest version" reading of never-zero-admins admits a gap: admin B out today with a reactivation scheduled counts as remaining, so A and C can schedule each other out and leave days with no admin — and the zero-admins trigger had the same reading for demotions. (2) The block offered "reactivate from today" to a member with a *future* deactivation; the insert landed before the scheduled row, changed nothing, and showed "saved", while the frozen block ruled out cancelling a scheduled version. Human resolved both 2026-09-23: "active on every date from D onward", and a not-yet-effective version may be cancelled, with versions appending in date order and each changing something.

**What was amended.** Frozen: the two decisions above, the finite-date rule, and nine matrix rows. Code Map: the offer rules, the one date validator, future-tense wording, the status refusal's own `aria-describedby`, the stale `LIST_COLUMNS`. Tasks: the delete policy, the live list-select cases, forged `created_at`.

**Known-bad state avoided.** Days with no active admin; a "saved" reactivation that changes nothing; redundant stacked versions; a last-admin message shown for deactivating an ordinary member; a list read whose embedded shape no live test sends; impossible dates passing preflight; `infinity` making a member row unreadable.

**KEEP — must survive re-derivation** (iteration 0's diff is kept at the session scratchpad `iter0/diff-1-6.patch` while it lasts):
- Absence of rows means active; `organization_today(uuid)` with a UTC fallback that never raises; `member_active_on(uuid, date)` as the one reading, used by helper, hook and trigger.
- `current_member_access()` extended with `create or replace`, same shape and grants.
- The hook's `{"error":{"http_code":403,"message":"MEMBER_INACTIVE"}}`, proven by direct call **and** a real password grant plus refresh; the four-state hook/helper agreement case.
- The column-level INSERT grant of the fact columns only, so a session cannot forge attribution (the `0004` precedent).
- The zone case using zones either side of UTC; the unresolvable-zone case.
- `ban`/`unban`, the 501 path and `NOT_IMPLEMENTED` removed; the boundary tests aimed at `resetPassword` with no payload; `OPERATION_UNKNOWN` for the removed names; DEPLOY.md and AD-16 amended.
- The list's zone arriving through the same read (`organizations(timezone)` embed), because `prijava.test.ts` allows one query on the list screen; four columns, the marker inside the name cell.
- The named refusals preflighted in the SPA and read against what was sent after a `42501`, because a second trigger for database codes is forbidden (AD-3).
- The mutation-probe discipline: every probe applied to the live database, suite run, restored, then a clean `db reset`.

### 2026-09-23 — iteration 1, three adversarial layers, 12 patches

**Not a loopback.** The re-derived structure held: no finding had its root cause in the spec or the frozen block. The layers found one real modelling gap and several of the verification class. The DB admitted two versions after today while the client modelled one scheduled change and the delete policy removed only the latest, so the screen offered a cancellation the database would refuse. Three new refusal codes sat outside `EVERY_FAILURE`, so mapping any of them to another message left the suite green.

**Patched, each re-probed.** At most one version dated after today (insert admitted only when the latest version is in effect or absent); a `MEMBER_STATUS_STALE` refusal for a screen that no longer matches the database; `EVERY_FAILURE` completed with its producer inputs; a live PostgREST cancellation case sending exactly the SPA's request; the confirmation tense and the "since" date moved into pure helpers; UPDATE/TRUNCATE/REFERENCES/TRIGGER revoked and `anon` stripped; an `organization_id` index; the hook's message made `SIGN_IN_REFUSED` so a direct GoTrue caller learns nothing about account state; volatility comments; the self-refusal reworded to cover every change; `nextIsoDate` bounded at year 9999; DEPLOY.md records that `banned_until` is still honoured. 23 mutation probes, each applied live and restored, all fail the suite.

**Deferred, recorded in deferred-work.md:** cross-transaction serialization of status writes; browser/PostgreSQL timezone-parser disagreement; the member-delete cascade over status history; `organization_today()`'s per-call subtransaction; an operator runbook for correcting an in-effect version.

**Implementer decisions accepted.** The trigger reads "some admin active on every date" collectively (one admin covering every date alone would block unrelated member edits during an admin hand-over), while the policies keep the stricter one-other-admin reading. Only the latest version is cancellable. The row readers are volatile so each row of a multi-row insert is judged against the rows before it.

## Design Notes

**Why no function.** The only thing the secret key could add is a session revocation GoTrue does not offer without changing the password. RLS already ends data access on the date (the helper is read fresh per statement, AD-10) and the hook ends sign-in and refresh, so a pass-through operation would be ceremony on the one component AD-16 keeps small. **Stale-token window:** a token minted before the date keeps authenticating to GoTrue's own endpoints until expiry, reading no organization data.

**Why "every date from D onward".** A check at "today" lets the only other admin be scheduled out next week; a check on the latest version lets an admin who is out *now* with a reactivation scheduled count as remaining, leaving days with no admin. Only "active on every date from D" refuses both.

**Why cancellation is not a rewrite.** A version dated after today has changed no day yet, so deleting it alters no derivation for any date that has happened. The date-order rule is what makes this safe: every version after the latest in-effect one is future by construction.

**Concurrency** — two admins deactivating each other concurrently under READ COMMITTED is the existing ledger entry (`deferred-work.md:289`) and is not closed here.

## Verification

**Commands:**
- `pnpm exec supabase db reset` -- exit 0, both fixtures load.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, above 1514 / 1160 / 4.
- `git diff --stat package.json pnpm-lock.yaml apps/web/package.json` -- empty.
- Mutation probes, each must fail the suite: drop the `effective_from >= today` check; read "today" in UTC instead of the organization zone; hook returns 500 or omits `http_code`; helper ignores the version table; last-admin check reads today or the latest version instead of every date onward (policy and trigger); allow self; add an update policy; let the delete policy remove a version in effect; admit a version dated on or before the latest one; admit a redundant version; show the last-admin message for a non-admin target; misspell an embed in `MEMBERS_COLUMNS` only.

## Suggested Review Order

**The versioned table and its rules**

- Entry point: append-only versions, finite dates, one row per member per date.
  [`0008_member_status.sql:64`](../../supabase/migrations/0008_member_status.sql#L64)

- Insert policy: today-or-later, date order, changes something, not self, admin cover.
  [`0008_member_status.sql:437`](../../supabase/migrations/0008_member_status.sql#L437)

- Cancellation: only the latest version, only while still in the future.
  [`0008_member_status.sql:492`](../../supabase/migrations/0008_member_status.sql#L492)

- Table privileges: no update or truncate, attribution columns not writable.
  [`0008_member_status.sql:543`](../../supabase/migrations/0008_member_status.sql#L543)

**Reading status as at a date**

- Organization's today with a UTC fallback that never raises.
  [`0008_member_status.sql:138`](../../supabase/migrations/0008_member_status.sql#L138)

- The one reading: latest version on or before a date, none means active.
  [`0008_member_status.sql:169`](../../supabase/migrations/0008_member_status.sql#L169)

- "Active on every date from D" — what never-zero-admins is built on.
  [`0008_member_status.sql:195`](../../supabase/migrations/0008_member_status.sql#L195)

**Enforcement**

- Helper extended, same shape and grants: access ends on the date.
  [`0008_member_status.sql:268`](../../supabase/migrations/0008_member_status.sql#L268)

- Hook refuses sign-in and refresh with a generic 403.
  [`0008_member_status.sql:304`](../../supabase/migrations/0008_member_status.sql#L304)

- Zero-admins trigger now counts admins active on every date from today.
  [`0008_member_status.sql:358`](../../supabase/migrations/0008_member_status.sql#L358)

**The admin surface**

- What the block offers: nothing on own row, cancel when scheduled.
  [`write.ts:902`](../../apps/web/src/members/write.ts#L902)

- Named refusals preflighted, then a 42501 read against what was sent.
  [`write.ts:1022`](../../apps/web/src/members/write.ts#L1022)

- Status derived from the embedded versions as at the organization's today.
  [`list.ts:398`](../../apps/web/src/members/list.ts#L398)

- The status block: own alert, date kept on refusal, `h-11` controls.
  [`ljudi.$id.tsx:768`](../../apps/web/src/routes/ljudi.$id.tsx#L768)

- Organization-local ISO date and the single date validator.
  [`format.ts:188`](../../apps/web/src/i18n/format.ts#L188)

**The boundary shrinks**

- `ban`/`unban` gone; three operations remain.
  [`handler.ts:41`](../../supabase/functions/admin-auth/handler.ts#L41)

- AD-16 amended to match.
  [`ARCHITECTURE-SPINE.md:148`](../../_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L148)

**Tests and peripherals**

- Append-only and date rules over both fixtures.
  [`rls-isolation.test.ts:4937`](../../test/rls-isolation.test.ts#L4937)

- Never zero active admins, including the scheduled-gap case.
  [`rls-isolation.test.ts:5641`](../../test/rls-isolation.test.ts#L5641)

- Hook refusal, helper agreement, and the zone cases.
  [`rls-isolation.test.ts:6191`](../../test/rls-isolation.test.ts#L6191)

- A real sign-in and refresh refused; live PostgREST insert and cancel.
  [`rls-isolation.test.ts:6376`](../../test/rls-isolation.test.ts#L6376)

- Operator notes: deactivation is an RLS write; `banned_until` still honoured.
  [`DEPLOY.md:127`](../../DEPLOY.md#L127)
