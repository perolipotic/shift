---
title: 'The resolution page stands without the leave-request read; only the back link loses its count (retro 8–9 item 18, C2)'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
baseline_commit: '05c6b946743aa6d4485f075c5bda4e7450a27e44'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 9.5 made the conflict resolution page (`/za-odluku/...` one collision) depend on the organization's leave-request read, which it uses ONLY for the back link's *Za odluku* count. A failed, paused-offline or uncached request read turns the whole page into the unavailable state, so a collision cannot be resolved (retro C2). Offline it is worse: `ORGANIZATION_LEAVE_REQUESTS_KEY` is one of `RESOLUTION_SURFACE_KEYS`, so a snapshot without that entry (C8: one saved before 9.5) makes every read of the surface unavailable.

**Approach:** The request read stops being one of the page's reads and becomes the count's own read. The page is decided from its other five reads exactly as before; the request read only decides whether the back link names a number. When it is failed, paused, uncached, still pending, or skewed, the count is `null` (the back link already renders without a number).

## Boundaries & Constraints

**Always:**
- The request read keeps its own freshness, decided by `useSnapshotFreshness` over `[ORGANIZATION_LEAVE_REQUESTS_KEY]` alone, so offline its cached rows still give a count and an online stale read never shows an old count.
- `queueCountOf` stays the one source of the number; the page passes it `null` request rows when the read is not usable, and it answers `null`.
- The as-of note, the retry button and the loading-after-failure state follow only the five page reads.
- `K od N`, ‹ ›, the facts, the balance and every write are untouched.

**Ask First:** Showing a collisions-only count when requests are unknown. Any change to *Za odluku* or *Danas*, which still refuse without the request read.

**Never:** Changing `conflictsQueueOf`, the persisted-key list or the offline e2e suite (retro item 19). Touching the 9.4 decision page.

## I/O & Edge-Case Matrix

| Scenario | Request read | Page | Back link |
|----------|--------------|------|-----------|
| Settled | rows | ready / missing as before | queue count |
| Failed online | `isError` | ready | no number |
| Pending online | no data yet | ready (does not wait) | no number until it lands |
| Offline, cached with the page | cached rows | cached page under the as-of note | queue count |
| Offline, not cached | none | cached page under the as-of note | no number |
| Untrusted or skewed row | rows | ready | no number (as today) |
| Other five reads fail | any | unavailable, as before | — |

</frozen-after-approval>

## Code Map

- `apps/web/src/features/conflicts/services/resolution-screen.ts` -- `resolutionScreenOf` (~:531): drops `queueReadFailed(requests)` from the unavailable guard and `requestRows === undefined` from the loading guard; `resolutionScreenFrom` takes `requestRows: readonly unknown[] | null`. `ResolutionSources.requests` (:425) doc changes. `ResolutionView.queueCount` (:343) already `number | null`; `RESOLUTION_MISSING` carries it (:416).
- `apps/web/src/features/conflicts/services/conflicts-queue.ts` -- `queueCountOf` (:448) accepts `requestRows: readonly unknown[] | null`, `null` → `null`; `queueReadFailed` (:476) is the "usable" test to reuse. Untrusted rows already give `null` via `conflictsQueueOutcomeOf`'s catch.
- `apps/web/src/features/conflicts/services/surface-keys.ts` -- `RESOLUTION_SURFACE_KEYS` (:39) loses `ORGANIZATION_LEAVE_REQUESTS_KEY`; doc becomes "five reads", and names the request read as the count's own.
- `apps/web/src/features/conflicts/services/surface-keys.test.ts` -- `:46` pins the list; update to five, and keep the request key persisted (it still is, for Za odluku).
- `apps/web/src/features/conflicts/hooks/use-conflict-resolution.ts` -- `:189` `useOrganizationLeaveRequests()`; `:198-209` freshness over six reads → five, plus a second `useSnapshotFreshness([ORGANIZATION_LEAVE_REQUESTS_KEY], [[key, requestsRead]], ZONE_FROM_CALENDAR)` whose `answerOf` gives `requests`; `:233` `refetchingAfterFailure` list drops `requests`. `useSnapshotSkewRefresh` (:223) keeps `requests.data`.
- `apps/web/src/lib/offline/use-snapshot-freshness.ts`, `lib/offline/freshness.ts` -- read-only: `snapshotFreshnessOf` makes the surface unavailable offline unless every key has data (:101); `snapshotAnswerOf` offline-unavailable answers `isError` (:210).
- `apps/web/src/features/conflicts/services/resolution-screen.test.ts` -- `:311` "is unavailable when the requests read failed, and loading while it is pending" is the behaviour this reverses.
- `apps/web/src/features/conflicts/components/conflict-resolution-body.tsx` -- read-only: `BackLink count={view.queueCount}` (:166, :271) already handles `null`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/conflicts/services/conflicts-queue.ts` -- `queueCountOf` takes nullable request rows and answers `null` for `null` -- the count cannot be stated without them.
- [x] `apps/web/src/features/conflicts/services/resolution-screen.ts` -- remove the request read from the unavailable and loading guards; pass `queueReadFailed(requests) || requests.data === undefined ? null : requests.data` down; update the function and interface docs -- the page no longer stands on the count's read.
- [x] `apps/web/src/features/conflicts/services/surface-keys.ts` + its test -- five keys -- the offline snapshot no longer needs the request entry.
- [x] `apps/web/src/features/conflicts/hooks/use-conflict-resolution.ts` -- the request read's own freshness; out of the surface and out of `refetchingAfterFailure` -- a request refetch never blanks the page.
- [x] `apps/web/src/features/conflicts/services/resolution-screen.test.ts` -- replace the `:311` case with the matrix rows: failed, pending and paused request reads give a ready (and a missing) screen with `queueCount: null`; settled still counts.

**Acceptance Criteria:**
- Given the five page reads are in and the request read failed, when the admin opens a collision, then they can choose and save a resolution, and the back link shows *Za odluku* with no number.
- Given offline with a cached page but no cached request entry, when the admin opens a collision, then the page shows under the as-of note, not the unavailable state.

## Verification

**Commands** (Node 24 PATH):
- `pnpm --filter ./apps/web typecheck` -- expected: no errors.
- `pnpm lint` -- expected: no errors.
- `pnpm --filter ./apps/web test` -- expected: all pass.
- `pnpm test:e2e e2e/tests/conflicts e2e/tests/offline` -- expected: all pass (against the shared local stack).

## Suggested Review Order

**The page no longer stands on the request read**

- Entry point: request rows become null when unusable; the guards above no longer name requests.
  [`resolution-screen.ts:566`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L566)

- The one source of the count answers null without request rows.
  [`conflicts-queue.ts:458`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L458)

**Freshness: five page reads, and the count's own read**

- The request key leaves the page snapshot; it gets its own one-key list.
  [`surface-keys.ts:41`](../../apps/web/src/features/conflicts/services/surface-keys.ts#L41)

- Second `useSnapshotFreshness` over the count's key: offline cached rows still count.
  [`use-conflict-resolution.ts:224`](../../apps/web/src/features/conflicts/hooks/use-conflict-resolution.ts#L224)

- A request refetch no longer blanks the page.
  [`use-conflict-resolution.ts:246`](../../apps/web/src/features/conflicts/hooks/use-conflict-resolution.ts#L246)

**Docs (9.5 doc-sync)**

- UX-DR46: the back link names no number while requests cannot be read.
  [`epics.md:180`](../planning-artifacts/epics.md#L180)

- Same sentence in the *Za odluku* experience paragraph.
  [`EXPERIENCE.md:140`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L140)

**Tests**

- Degraded request reads (failed, pending, raw paused, offline uncached) leave the page standing.
  [`resolution-screen.test.ts:319`](../../apps/web/src/features/conflicts/services/resolution-screen.test.ts#L319)

- Offline cached rows, through the real freshness functions, still give the count.
  [`resolution-screen.test.ts:348`](../../apps/web/src/features/conflicts/services/resolution-screen.test.ts#L348)

- E2E: requests answer 500, the screen stands, accept-as-uncovered saves.
  [`conflict-resolution.spec.ts:710`](../../e2e/tests/conflicts/conflict-resolution.spec.ts#L710)
