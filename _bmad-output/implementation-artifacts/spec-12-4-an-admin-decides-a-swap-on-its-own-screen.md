---
title: 'An admin decides a swap on its own screen'
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_commit: '4c432956cf7ad9a3bb1c6d35dd50e893bf917c07'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-3-the-colleague-accepts-or-declines.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-3b-swap-proposed-and-answered-notifications.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An accepted swap waits for an admin (0049), but no admin sees it.
- It is not in *Za odluku*, its count or admin *Danas*.
- No screen shows what it does, and nothing calls `decide_swap_request`.
- *Odlučeno* lists no decided swap.

**Approach:** the swap becomes the third kind of *Za odluku* item.
- A decision screen on 9.4's pattern shows the consequence (never a gate) and calls `decide_swap_request` through AD-5's erasure check.
- *Odlučeno* lists decided swaps.
- There is no migration. The notifications are story 12.4b.

## Boundaries & Constraints

**Always:**
- **The read.** `ORGANIZATION_SWAP_REQUESTS_KEY` reads every swap with its decision (`outcome, roster_override_id, return_roster_override_id, decided_by, decided_at`) under 0049's admin RLS.
  - It joins the queue's reads everywhere the count is stated: the queue, *Odlučeno*, admin *Danas* and the resolution screen's back link.
  - A failed read refuses the count, never a partial one.
  - A member or team the snapshot lacks is a skew, as for requests (`unknownSnapshotIdsOf`).
- **The queue row** is an open, accepted swap. It is dated by the earlier of its dates and ordered by `mergedQueueOrderOf`. On one date: collisions, then leave requests, then swaps, each by when it was sent, then by id.
  - It reads *Zamjena smjene* · `{predlagatelj} → {kolega}` · the given shift (and the return shift), and it opens `/za-odluku/zamjena/$requestId`.
  - A past one is drawn as a past row.
  - The count, the tab count, *Treba tebe* (with its own row) and the back link all include it.
- **The screen** (admin only; the *Za odluku* tab lights for it) shows the two members and who works which date. It warns and never blocks:
  - each member's signed hour delta per month (`memberMonthDeltasOf` over `swapAppliedOf`, each member's own live leave keys);
  - leave of the member put on a shift that date (the organization's live leave);
  - a double booking of the member put on (`rosterOverlapOf`);
  - the short-staffed report (`configurationReportOf` over the two-change "after", from the earlier date to the later).
  - A past swap says *Datum je prošao*, and *Odobri* stays.
  - A **stale** swap (`swapStaleOf`) withholds *Odobri* and says why; *Odbij* stays.
- **Approval.**
  - The erasure check diffs `swapAppliedOf`'s "after" with `erasuresOf` from the earlier date. Any row opens the shared `ErasureDialog`, and the write waits for every confirmation, as `use-roster-form` does. A check that cannot be derived refuses the write, with a retry.
  - Then `decide_swap_request(id, 'approved', 'Odobrena zamjena')`. Rejection is `decide_swap_request(id, 'rejected', null)`.
  - Refusals map by SQLSTATE/message:
    - P0002 → no longer waiting;
    - 42501 → not allowed;
    - 55000 → a member is inactive, reject it;
    - 23505 → the roster already changed, reject it;
    - 23514 → archived team, reject it;
    - anything else → failed.
  - Each button uses `useWriteGate`, `aria-disabled`, `OfflineWriteNote` and an in-flight ref. Nothing is optimistic.
  - The re-read is `refreshAfterWrite` with new `SWAP_REQUEST_DECISION_DEPENDENTS`: the swap keys, the calendar, the hours and the queue reads.
  - A landed decision returns to *Za odluku* with a focused status line: *Zamjena odobrena: {predlagatelj} → {kolega}, {datum}.* or *Zamjena nije odobrena: {predlagatelj} → {kolega}, {datum}.*
- **A closed swap** opened by URL is read-only. It shows its status word, and who decided and when; or, for one withdrawn or declined, that word alone.
- ***Odlučeno*** lists approved, rejected and deactivated swaps, newest decision first.
  - Each row shows the badge (*Odobrena*, *Nije odobrena*, *Zatvorena deaktivacijom*), the kind, the members, the shifts and `Odluka: {admin}, {datum} u {vrijeme}`.
  - An approved swap whose override id is no longer live in the snapshot reads *Zamjena je naknadno izmijenjena u kalendaru.* This is derived on read.
  - Withdrawn and declined swaps are not listed.
- **Docs:**
  - In `epics.md`: UX-DR33, 46 and 52.
  - In EXPERIENCE.md: the admin *Danas* line and the inventory note, made present tense.
  - In `deferred-work.md`: mark the 12.4 entries RESOLVED, wholly or in part, and move the notification parts to 12.4b.

**Ask First:**
- Any migration, or any change to 0049 or 0050.
- Any change to `packages/domain` exports.

**Never:**
- A proposed or accepted swap feeds a schedule, hours or collision figure (R9.1).
- The word *konflikt* in the UI.
- Any notification (that is 12.4b).
- Running DB-connecting tests, applying a migration, or patching a harness (CI is the gate).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Waits | Accepted swap | Queue row, count +1, *Treba tebe* row | — |
| Approve | No erasure | Two overrides by the admin; status line; the row moves to *Odlučeno* | — |
| Approve, erasure | The change uncovers an unresolved collision | `ErasureDialog`; the write follows every confirmation | — |
| Reject | *Odbij* | Decision only; status line | — |
| Stale | Given shift no longer the proposer's | No *Odobri*; reason line; *Odbij* stays | — |
| Past | A date before today | Past row; *Datum je prošao*; *Odobri* stays | — |
| Race | Withdrawn meanwhile | "No longer waiting"; re-read | P0002 |
| Inactive | A party is inactive on the date | Refusal line; the swap stays accepted | 55000 |
| Taken | A live override already holds the key | Refusal line | 23505 |
| Changed later | Approved override amended or removed | *Odlučeno* line | — |
| Offline | Either button | Gated, with the note | Nothing sent |

## Epic AC Deviations

- **Reinterpreted.** The epic AC says "with reason `swap`".
  - Choice: `roster_overrides.reason` is free text (0026, 1–200 chars), so the screen sends `Odobrena zamjena`. The decision's override ids record that the override is a swap (0049).
- **Added.** From 12.3, where it was narrowed: the queue row, the count and *Danas*.
- **Split.** The admin "waits" notice and the decided notice go to 12.4b, together with migration 0051. A `deferred-work.md` entry records it. Product owner [S], 2026-11-07.
- **Decided by the product owner, 2026-11-07, each the recommended default:**
  - A past swap keeps *Odobri*.
  - "Changed later" is derived in the browser.
  - The row wording and order are as above.
  - Deactivation closes are listed in *Odlučeno*.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0049_swap_requests.sql`:
  - columns at :197-290;
  - decisions at :311-360;
  - `decide_swap_request` at :690, with P0002 / 42501 / 22023 / 55000 and override-insert refusals.
- Queue:
  - `features/conflicts/services/conflicts-queue.ts`: `ITEM_*` :78, `mergedQueueOrderOf` :186, `requestRowsOf` :226, `conflictsQueueViewOf` :345, `queueCountOf` :442, `conflictsQueueOf` :498;
  - `hooks/use-conflicts-queue.ts:144,195`; `components/conflicts-list.tsx:69`;
  - `services/surface-keys.ts:27,50`.
- `features/conflicts/services/resolved-conflicts.ts` (`decidedRequestsOf` :226, `actorNamesOf` :189); `components/resolved-list.tsx:101`.
- `features/conflicts/services/resolution-screen.ts:201,718,1037` (saved kinds, the back-link count, `withResolutionSaved`).
- Admin *Danas*: `features/today/services/admin-today.ts:153,400,532`; `hooks/use-admin-today.ts:105,189`; `components/needs-you-card.tsx:36`; `today/services/surface-keys.ts`.
- The screen pattern:
  - `pages/za-odluku.zahtjev.$requestId.tsx`;
  - `features/leave/services/leave-request-review.ts`, `hooks/use-leave-request-review.ts`, `components/leave-request-review-body.tsx`;
  - `router.ts:72`.
- Reuse:
  - `features/swaps/services/swap-proposal.ts:233` (`swapAppliedOf`, `swapShiftWorkedBy`);
  - `my-swaps.ts:221,425` (`swapStatusOf`, `swapStaleOf`);
  - `calendar/utils/change-preview.ts:111` (`memberMonthDeltasOf`);
  - `calendar/utils/day-detail.ts:968` (`rosterOverlapOf`);
  - `conflicts/services/erasures.ts:153`, `components/erasure-dialog.tsx`, `hooks/use-erasure-confirmation.ts`;
  - `calendar/hooks/use-roster-form.ts` (the confirm-then-write wiring);
  - `staffing/services/short-staffed.ts:262`.
- `features/teams/services/dependents.ts:162`.
- `hr.json`: new `zaOdluku.swap.*` keys (hot file).
- **Pins:**
  - `test/supabase-scaffold.test.ts` (the R9.1 guard: add the organization reader and the decide RPC);
  - `resource-hygiene` keys;
  - `pages/source-guards.fixture.ts` `SCREENS`;
  - `key-sources.fixture.ts`;
  - `prijava.test.ts` `IN_FLIGHT_HANDLERS`;
  - `dependents.test.ts` `CLASSIFIED`;
  - `router.test.ts`;
  - `structural-pins-shell.test.ts`;
  - `localization-applied`.

## Tasks & Acceptance

**Execution:**
- [x] `features/swaps/services/organization-swaps.ts` (+ test) -- the read, the parse, the queue rows, the decided rows, "changed later" -- one pure service.
- [x] `conflicts-queue.ts`, `resolved-conflicts.ts`, `resolution-screen.ts`, `admin-today.ts` (+ tests), their hooks, `surface-keys.ts`, `conflicts-list.tsx`, `resolved-list.tsx`, `needs-you-card.tsx` -- the third kind in every count and list.
- [x] `features/swaps/services/swap-decision.ts` (+ test), `hooks/use-swap-decision.ts`, `components/swap-decision-body.tsx`, `pages/za-odluku.zamjena.$requestId.tsx`, `router.ts` -- the screen, preview, stale, erasure, decide, refusals.
- [x] `dependents.ts`, `hr.json` and every pin -- the registration.
- [x] `e2e/tests/swaps/decide-swap.spec.ts` -- the queue row, approve, reject, *Odlučeno*, offline -- CI only.
- [x] `epics.md`, `EXPERIENCE.md`, `deferred-work.md` -- the docs and the RESOLVED marks.

**Acceptance Criteria:**
- Given CI, when `pnpm test` and e2e run, then every new case passes with none skipped, on both fixtures.
- Given admin *Danas* and *Za odluku* from one snapshot, then the two counts are equal, including at zero.

## Design Notes

- An admin may decide a swap they are part of (0049).
- "Changed later" needs no migration: `calendar_roster_overrides()` returns every live override, and an amend replaces the id (0039).
- Hot files are `hr.json` and `admin-today.ts`. The baseline is 4c43295.

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm typecheck && pnpm lint && pnpm --filter ./apps/web test` -- expected: green.
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm vitest run test/supabase-scaffold.test.ts test/resource-hygiene.test.ts test/localization-applied.test.ts` -- expected: pass (no DB). The DB suites and e2e run in CI.

## Suggested Review Order

**The decision screen (the entry point)**

- The screen's states: waiting with a preview, stale withholds *Odobri*, closed read-only.
  [`swap-decision.ts:395`](../../apps/web/src/features/swaps/services/swap-decision.ts#L395)

- Four warnings from the swap's "after"; none gates a button.
  [`swap-decision.ts:278`](../../apps/web/src/features/swaps/services/swap-decision.ts#L278)

- AD-5: the two-change "after" diffed from the earlier date over fresh reads.
  [`swap-decision.ts:529`](../../apps/web/src/features/swaps/services/swap-decision.ts#L529)

- The RPC and its refusals by SQLSTATE and message.
  [`swap-decision.ts:614`](../../apps/web/src/features/swaps/services/swap-decision.ts#L614)

- Wiring: confirm-then-write, refresh even after unmount, the status line on return.
  [`use-swap-decision.ts:230`](../../apps/web/src/features/swaps/hooks/use-swap-decision.ts#L230)

- The buttons and the shared erasure dialog.
  [`swap-decision-body.tsx:167`](../../apps/web/src/features/swaps/components/swap-decision-body.tsx#L167)

- The admin-guarded route.
  [`za-odluku.zamjena.$requestId.tsx:50`](../../apps/web/src/pages/za-odluku.zamjena.$requestId.tsx#L50)

**The organization's swaps (one pure service)**

- Strict parse; one untrusted row refuses the list.
  [`organization-swaps.ts:291`](../../apps/web/src/features/swaps/services/organization-swaps.ts#L291)

- Open, accepted swaps as queue facts.
  [`organization-swaps.ts:487`](../../apps/web/src/features/swaps/services/organization-swaps.ts#L487)

- "Changed later", from the snapshot's live override ids.
  [`organization-swaps.ts:524`](../../apps/web/src/features/swaps/services/organization-swaps.ts#L524)

**The third kind in every count and list**

- Swap rows join the merged order: on one date, after collisions and requests.
  [`conflicts-queue.ts:233`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L233)

- The count refuses without the swap read.
  [`conflicts-queue.ts:514`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L514)

- *Odlučeno*'s swap entry, with its badge, the admin and the time.
  [`resolved-list.tsx:162`](../../apps/web/src/features/conflicts/components/resolved-list.tsx#L162)

- *Treba tebe*'s swap row.
  [`needs-you-card.tsx:39`](../../apps/web/src/features/today/components/needs-you-card.tsx#L39)

- A decision re-reads the roster dependents and the swap keys.
  [`dependents.ts:296`](../../apps/web/src/features/teams/services/dependents.ts#L296)

**Tests and pins**

- Unit cases: preview, stale, past, refusals, erasure check.
  [`swap-decision.test.ts:1`](../../apps/web/src/features/swaps/services/swap-decision.test.ts#L1)

- e2e (CI only): row, approve, erasure, reject, race, offline.
  [`decide-swap.spec.ts:1`](../../e2e/tests/swaps/decide-swap.spec.ts#L1)

- The R9.1 guard: one writer, two readers, one decider.
  [`supabase-scaffold.test.ts:1`](../../test/supabase-scaffold.test.ts#L1)
