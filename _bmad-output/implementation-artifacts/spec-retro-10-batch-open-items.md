---
title: 'Retro batch: Epic 10 A1–A14 and the open items of earlier retros'
type: 'bugfix'
created: '2026-10-30'
status: 'done'
baseline_commit: '04d5ef42ba7d9762612b751574699f09fff3d387'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-retro-2026-10-30.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-9-retro-2026-10-28.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Epic 10 retro (verdict accepted-with-open-items) left 14 action items: seven cross-story notification defects (F1–F7), stale deploy order, copy and spine (F10, F11, F13), docs hygiene (F15, F16), and three process gaps (a time-of-day e2e flake, deferral bookkeeping, parallel sessions sharing port 5173). Earlier retros left epic-9 items 17, 19, 21, 22, 23 and epic-7 item 8 open.

**Approach:** One batch (PO decision 2026-10-30), each item fixed as its retro recommends. One new migration (0046) for the database rules, `notify` changes for the run loop, SPA changes for the sign-in link, copy and push link, e2e and config changes for the process items, and doc edits. Items that need a product decision or the user's GitHub settings are reported, not guessed.

## Boundaries & Constraints

**Always:**
- A4 (PO, 2026-10-30): the decision notification follows the same recipient rules as every other event, on both channels: not the actor, active today, email only with an address.
- Channels stay independent: nothing about email (Resend refusal, email switches) holds or fails a push row, and the reverse.
- `notify` stays thin (AD-18): every rule it applies arrives decided from SQL; it reaches the database only through `service_role`-only RPCs.
- New migration is `0046`; no merged migration is edited. Every re-created function keeps every earlier clause and restates its grants.
- Copy lives in `hr.json` only; the `obavijesti` namespace stays deep-equal to `notify`'s pinned copy.
- Each fixed deferral or doc gap is marked in `deferred-work.md` (P3).

**Ask First:** any change to who is notified beyond A4; any new user-visible screen beyond A5's offer.

**Never:**
- Do not decide epic-9 item 17 (past-dated requests, approved request after its leave is removed); report it as needing a PO decision.
- No GitHub settings change (branch protection); report the steps.
- No push/email retention, batching (F9) or sign-out ordering (F12) changes; they stay deferred.
- No push, no amend, no force push.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| A1 Resend refused | batch: email (Resend 401), then push, then email | push row is sent; emails after the refusal are released untried with `PROVIDER_UNAUTHORIZED` | run answers `stopped: PROVIDER_UNAUTHORIZED` |
| A2 device handed over | claim returns device D for member A; D re-registered to member B before send | nothing is posted to D for A's row | row settles as with no device left |
| A3 inactive recipient | pending email or push row, recipient not active today | claim settles it failed `RECIPIENT_INACTIVE`, never returns it | — |
| A4 decision | admin decides own request / requester inactive today / requester has no address | no row / no row / no email row (push row if a device) | — |
| A5 other org link | signed in to org A, opens `/prijava/<B>?povratak=/godisnji` | screen offers signing in to B (sign out of A first) or staying in A | same-org link redirects as before; unreadable session renders the form |
| A6 push url | row rendered for push | payload `url` is a path (`/prijava/<slug>?povratak=…`); the worker opens it on its own origin | — |
| A7 time budget | push row reached at 36 s | released `RUN_DEADLINE` untried; an email row may still start until 45 s | — |

## Epic AC Deviations

- **10.2 AC1** ("a member with an email address — when their leave request is decided … they receive one email"): narrowed. The decision now follows every event's recipient rules (A4, PO decision 2026-10-30): an admin deciding their own request, and a requester not active today, get no row. Why: one rule on both channels; the PO chose it.
- **10.2 AC1 and AC2** (the member's and every admin's email): narrowed at send time. A pending row whose recipient is not active today is settled `RECIPIENT_INACTIVE` and never sent (A3, retro F3). Why: "active today" was checked only at write, so a deactivated member still got email and push.
- **8.2 AC** ("current and next month are prefetched"): reinterpreted in `epics.md` as built (one calendar entry kept on the device). Recorded decision: retro 8–9 X1 and spec-8-2's deviation; this batch only writes it into the docs.
- **9.4 AC** ("a rejection records nothing but the decision"): reinterpreted in `epics.md` as built (the request is also closed, `closed_by`/`closed_at`). Recorded decision: retro 8–9 X5; docs only.
- No AC is deferred.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0045_push_subscriptions.sql` -- current `notify_members`, `decide_leave_request`, `claim_notifications`, `delete_push_subscription` (read-only; re-create in 0046).
- `supabase/migrations/0008_member_status.sql:138,169` -- `organization_today(uuid)`, `member_active_on(uuid,date)`.
- `supabase/functions/notify/handler.ts:565-637,743-796` -- `deliverPush`, run loop with the global `stopped` (F1) and the 45 s deadline check (F7).
- `supabase/functions/notify/messages.ts:172-179,307-321` -- `linkOf`, `renderPush` (absolute `url`, F6).
- `apps/web/public/push-sw.js` -- `targetOf` resolves relative urls on `self.location.origin` already.
- `apps/web/src/pages/prijava.tsx:108-127` -- `/prijava/$slug` `beforeLoad` redirect (F5).
- `apps/web/src/features/auth/services/address.ts` -- AD-12 address `username@slug.shift.invalid`; parse the session's slug here.
- `apps/web/src/features/navigation/components/chrome.tsx:430-520`, `apps/web/src/features/auth/hooks/use-set-password.ts:186-215` -- the sign-out sequence (push forget, signOut, forget snapshot, clear cache) to reuse for A5.
- `apps/web/src/lib/i18n/locales/hr.json:1431,1616` -- `shell.notificationsDescription`, `postavkeObavijesti.pushLede` (F11).
- `test/notify-boundary.test.ts` -- handler matrix (fake client), real claim/settle/delete suites, "three RPCs alone" guard.
- `test/rls-isolation.test.ts:22342` -- 0045 writer suite; extend for 0046.
- `e2e/tests/today/today.spec.ts:471-553` -- duty tests on shared `MEMBER_STATE` with a clock ahead of real time.
- `e2e/utils/database-helper.ts:22,1680-1706` -- `requireAdminAuth`, 3 s timeout (CI shard failure 40679959525: edge-runtime cold boot).
- `playwright.config.ts`, `apps/web/vite.config.ts`, `e2e/utils/global-setup.ts`, `e2e/README.md` -- reuse of a foreign Vite on 5173 (P4).
- `e2e/tests/offline/offline-read.spec.ts:275-336`, `offline-write.spec.ts:66-68` -- item 19.
- `_bmad/custom/bmad-build.toml` -- persistent facts (A13).
- `DEPLOY.md:663-700`, `ARCHITECTURE-SPINE.md` AD-9/14/17/18, `epic-10-context.md`, `EXPERIENCE.md`, `epics.md`, PRD FR-54/55, `deferred-work.md`, `eslint.config.js:293,299` -- docs.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0046_notification_recipient_rules.sql` -- re-create `decide_leave_request` writing both rows through `private.notify_members` (A4); re-create `claim_notifications` (same signature) settling pending rows whose recipient is not active today as `RECIPIENT_INACTIVE`, both channels, and excluding them from the claim (A3); add `service_role`-only `push_devices_for_send(p_id uuid, p_claimed_at timestamptz)` returning the row recipient's current devices while the lease token still matches (A2).
- [x] `supabase/functions/notify/handler.ts` -- per-channel stop: a provider 401/403 stops email rows only (A1); before posting a push row, re-read its devices through `push_devices_for_send`, bounded like a send, and send only to those (A2); per-channel start deadline so a push row's read + send + delete fit the budget (A7); update header docs.
- [x] `supabase/functions/notify/messages.ts` -- push `url` is the path-only sign-in link (A6); email links unchanged.
- [x] `apps/web/public/push-sw.js` -- doc: url is a path resolved on the worker's origin.
- [x] `test/notify-boundary.test.ts`, `test/rls-isolation.test.ts`, `test/push-worker.test.ts` -- mixed-batch A1 test, handover A2 test, A3/A4 SQL tests, A6 path payload, A7 deadline test, fourth RPC in the "may not think" guard.
- [x] `apps/web/src/features/auth/services/address.ts` (+test) -- `organizationOfAddress(email)` → slug or null.
- [x] `apps/web/src/pages/prijava.tsx`, a new auth component + hook (+ shared end-session hook reused by chrome and set-password), `hr.json` -- A5 offer screen.
- [x] `apps/web/src/lib/i18n/locales/hr.json` + pinned tests -- A9 copy.
- [x] `e2e/tests/auth/*` -- A5 e2e: signed in to A, open B's link, offered B; choosing it signs out and opens B's form with the return path.
- [x] `e2e/tests/today/today.spec.ts` -- duty tests sign in fresh members instead of the shared storage state (A12, P1); `e2e/README.md` rule: a clock ahead of real time needs its own session.
- [x] `apps/web/vite.config.ts`, `e2e/utils/global-setup.ts`, `playwright.config.ts`, `e2e/README.md` -- dev server answers its checkout root; e2e refuses a server on 5173 from another checkout (A14).
- [x] `e2e/utils/database-helper.ts` -- `requireAdminAuth` retries a cold function (item 22).
- [x] `e2e/tests/offline/offline-read.spec.ts`, `offline-write.spec.ts` -- item 19.
- [x] `_bmad/custom/bmad-build.toml` -- A13 facts (a)(b)(c).
- [x] `DEPLOY.md` -- A8 combined first-deploy order 0042–0046 and rollback warning; 0046 section.
- [x] Spine, contexts, EXPERIENCE.md, epics/PRD, spec frontmatter, JSDoc, deferred-work, eslint comments -- A10, A11, item 21.

**Acceptance Criteria:**
- Given the I/O matrix rows, when the suites run, then each row has a test that fails without its fix.
- Given `pnpm db:reset && pnpm lint && pnpm typecheck && pnpm build && pnpm test`, when run, then all pass; and the e2e for notifications, offline, today, auth pass.
- Given the report, when read, then every item A1–A14 and each earlier item has a status with evidence.

## Design Notes

- A2 leaves a millisecond window between the device read and the POST; accepted and recorded. The claim's `subscriptions` column stays for compatibility but the handler sends only to the fresh read.
- A5 never signs in on top of a live session: switching runs the full sign-out (push forget, snapshot forget, cache clear) first, so nothing of org A survives into org B.
- A7: budget 50 s for work; email may start until 45 s (one send), push until 35 s (read + send + delete, 5 s each).
- A5 detection: the session's `user.email` is AD-12's `username@<slug>.shift.invalid`; a slug that differs from the URL's (both normalized) is "another organization". An address that does not parse keeps today's redirect. The offer: name both organizations; primary action signs out (the chrome's sequence, extracted into one shared hook that the chrome and `use-set-password` also use) then navigates to `/prijava/<B>` keeping `povratak`; secondary action stays in A and goes to `/`. All copy via `t()`; logic in a pure service with node tests (AD-15, `pages/literal-sweep.test.ts`).
- A12 root cause (from CI run 40970110398 artifacts: the page showed the sign-in form at 06:00): `supabase/config.toml` rotates refresh tokens (`refresh_token_reuse_interval = 10`). Tests on the shared `MEMBER_STATE` that install `page.clock` AHEAD of real time see an expired access token and refresh with the SAME stored refresh token; at 00:00–06:00 org time both the 21:10 and the 06:00 test are ahead, the second refresh is a reuse, GoTrue refuses it, and the page signs out. Fix: each clock-ahead test signs in a fresh member of its own (`seedLeaveMember` + the spec's `signedInAs`, as the lone-Noć test does), and the README states the rule. The admin 14:20 test (`today.spec.ts:705`, `ADMIN_STATE`) follows the same rule.
- Item 22: CI shard failure 40679959525 — `admin-auth` answered 401 at 11:30:05, then `requireAdminAuth`'s 3 s OPTIONS timed out while the edge runtime booted the worker; fix by retrying "no answer" for up to ~30 s. The offline Za odluku flake (`offline-read.spec.ts:278,317`) is to be reproduced with `--repeat-each`; record the result and the evidence either way (PostgREST logs showed connection-refused windows during another session's `db:reset`).
- Item 19: seed a fresh member + pending request (`seedLeaveRequest`), filter the organization's `leave_requests`/`leave_records` reads to that member (as `conflicts-queue.spec.ts` `onlyRowsOf`), read Danas and Za odluku online, go offline, re-enter both by navigation: the request row and the count (1) are shown under the note. Drop `withdraw_|decide_` from `WRITE_RPC`. Clean up with `removeLeaveMemberInSql`.
- A13 facts (append to `persistent_facts`): (a) a spec that amends or cites an AD amendment carries a task that edits `ARCHITECTURE-SPINE.md`; (b) a `deferred-work.md` entry that says "decide in story X" (or "X should…") is copied into X's spec as a required input, and X cannot reach `done` with it unanswered; (c) a story that resolves a deferred-work entry marks it `RESOLVED by <story> (<date>) — ` in the same change.
- A14: a dev-only Vite plugin answers `GET /__shift/checkout` with the repository root; global setup fetches it and fails, naming the other checkout, when it differs from this checkout's root (no answer from an old server also refuses). CI starts Vite from the same checkout, so reuse stays.
- Item 21 docs (retro 8–9 X1–X5, R3, A3, and the C1 deferral at deferred-work "DESIGN.md, EXPERIENCE.md and the UX-DR lines … Fold into retro action 6"): edit to match as built, as that retro's table states. F16: docs say "any other end of a session unsubscribes this device"; the code reconciles on the next signed-in load — change the docs to match the code.
- Environment: `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`; `pnpm db:reset` on the shared stack is approved, run `pnpm db:demo` after it. Another worktree may run e2e on 5173: before any e2e, poll every 30 s (up to 20 min) until 5173 is free; never kill a process you did not start; stop your own Vite after. No commits (step 05 commits).

## Verification

**Commands:**
- `pnpm db:reset && pnpm lint && pnpm typecheck && pnpm build && pnpm test` -- expected: all green.
- `pnpm test:e2e e2e/tests/notifications e2e/tests/offline e2e/tests/today e2e/tests/auth` -- expected: all pass.

## Batch Outcomes

- **Offline *Za odluku* flake (retro 8–9 item 22):** not reproduced. `--repeat-each 8` over the three *Za odluku* offline tests on a quiet stack: 24/24 passed. PostgREST's log on the shared stack shows connection-refused windows while another session ran `db:reset`, which fits the retro's "parallel load on the shared stack" reading but does not prove it. A14 (no foreign dev server) and the shared-stack rule in `e2e/README.md` reduce that exposure. The CI shard failure (40679959525) was a cold edge-runtime worker; `requireAdminAuth` now waits for the function's own answer for up to 30 s.
- **Time-of-day flake (A12, P1):** fixed at the root cause found in CI run 40970110398's artifacts (the page was on the sign-in form: a reused refresh token). It could not be run inside the 00:00–06:00 organization-time window that triggers it.
- **Epic-9 item 17 — needs a PO decision.** Past-dated leave requests, and how an approved request reads after its leave record is removed or amended. Neither retro recommended an answer; both `deferred-work.md` entries stay open.
- **Branch protection (epic-7 item 8, A12 part 2) — user action.** GitHub → `perolipotic/shift` → Settings → Branches (or Rules → Rulesets) → add a rule for `main`: require a pull request before merging; require status checks to pass, with "Require branches to be up to date before merging" ON (so a PR's CI runs on top of the latest `main`, and a red `main` turns every open PR red); required checks: `Quality (gitleaks, lint)`, `Build (typecheck, build)`, `Test (Vitest, local Supabase)`, `E2E (Playwright, shard 1/4)` … `E2E (Playwright, shard 4/4)` (a docs-only PR skips E2E by `if`, which GitHub counts as passing); optionally "Do not allow bypassing the above settings". Process half of item 8 ("no merge while a story is in review") stays a team rule.

## Suggested Review Order

**Who is notified (A3, A4) — the database**

- The decision now uses the one recipient rule every event uses (PO decision A4).
  [`0046_notification_recipient_rules.sql:124`](../../supabase/migrations/0046_notification_recipient_rules.sql#L124)

- The claim settles rows whose recipient is not active today, both channels.
  [`0046_notification_recipient_rules.sql:189`](../../supabase/migrations/0046_notification_recipient_rules.sql#L189)

- Send-time device read: `lease_lost`, `inactive` or `ready` with today's devices (A2).
  [`0046_notification_recipient_rules.sql:355`](../../supabase/migrations/0046_notification_recipient_rules.sql#L355)

**How `notify` runs (A1, A2, A7)**

- Stops are per channel; Resend's refusal never holds a push row.
  [`handler.ts:846`](../../supabase/functions/notify/handler.ts#L846)

- The device read's answer judged; a missing function releases without spending an attempt.
  [`handler.ts:705`](../../supabase/functions/notify/handler.ts#L705)

- Push starts by 35 s; email deadline re-checked after the pace wait.
  [`handler.ts:884`](../../supabase/functions/notify/handler.ts#L884)

- A push link is a path, opened on the worker's own origin (A6).
  [`messages.ts:187`](../../supabase/functions/notify/messages.ts#L187)

**Another organization's sign-in link (A5)**

- The guard offers B when the session's AD-12 slug differs.
  [`prijava.tsx:149`](../../apps/web/src/pages/prijava.tsx#L149)

- The switch sequence: end A's session first, then open B; pure and node-tested.
  [`organization-switch.ts:72`](../../apps/web/src/features/auth/services/organization-switch.ts#L72)

- One session end shared by the chrome, set-password and the offer.
  [`use-end-session.ts:36`](../../apps/web/src/features/auth/hooks/use-end-session.ts#L36)

**E2E and process (A12, A14, items 19, 22)**

- Dev server answers its checkout to loopback callers; e2e refuses a foreign one.
  [`global-setup.ts:31`](../../e2e/utils/global-setup.ts#L31)

- Clock-ahead tests sign in a session of their own (refresh-token reuse).
  [`today.spec.ts:505`](../../e2e/tests/today/today.spec.ts#L505)

- A pending request is listed and counted offline (item 19).
  [`offline-read.spec.ts:295`](../../e2e/tests/offline/offline-read.spec.ts#L295)

- admin-auth's cold boot is waited out, a wrong origin fails at once.
  [`database-helper.ts:1688`](../../e2e/utils/database-helper.ts#L1688)

**Docs and process rules**

- One first-deploy order for 0042–0046, and the rollback warning (A8).
  [`DEPLOY.md:751`](../../DEPLOY.md#L751)

- bmad-build facts: spine task, decide-in-X inputs, resolved-deferral marks (A13).
  [`bmad-build.toml:8`](../../_bmad/custom/bmad-build.toml#L8)

**Tests**

- The A1 mixed batch, then A2/A3/A7 cases beside it.
  [`notify-boundary.test.ts:1767`](../../test/notify-boundary.test.ts#L1767)
