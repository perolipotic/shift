---
title: 'Za odluku lists requests beside collisions'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '25962c1df5b89f3c24d3e44c8d1a7ef8de2b4f6f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A pending leave request can be decided (9.4), but only by URL. *Čeka odluku*, its count and the admin Danas count list collisions only. *Odlučeno* also leaves out request decisions.

**Approach:** Add one organization-wide read of leave requests and merge it into the queue model. *Čeka odluku* and Danas then list pending requests beside unresolved collisions under one count. *Odlučeno* lists approved and rejected requests beside decided collisions.

## Boundaries & Constraints

**Always:**
- **The read.** `leave_requests` for the organization, with the decision embedded (`outcome`, `decided_by`, `decided_at`), parsed by 9.4's parse and `leaveRequestStatusOf`. It uses a new root key `['organization-leave-requests']`, which is persisted. That key joins `LEAVE_REQUEST_WRITE_DEPENDENTS`, so a send, a withdrawal, an approval and a rejection all refresh it. Admin RLS (0040) already returns every row.
- **One queue model.** `conflictsQueueOf` gains the requests as a source. Its items are a union with `kind: 'collision' | 'request'`, and `count` counts both. If any read fails or is paused, the whole queue is unavailable, never a partial list.
- **Order.** A request sorts by its start date. Upcoming items (date ≥ today) come first in ascending order, then past items in descending order, as today. On the same date, collisions come before requests, then the existing order, then the request id. A request that starts before today gets the past treatment.
- **The kind in words.** Every row names its kind. A collision is *Odsutnost u smjeni*. A request is *Zahtjev za godišnji odmor* and links to `/za-odluku/zahtjev/$requestId`. A request row shows the member's name and `Godišnji odmor {from}–{to}`. A member who is gone reads 9.4's `memberGone`.
- **Danas.** `adminTodayOf` passes the merged count and rows. *Treba tebe* shows the same count as the queue, zero included. Its rows can be requests, with the past share, the earliest past item and `Otvori Za odluku ({count})` all counted across both kinds.
- **Resolution screen.** The back link's `Za odluku · N čeka odluku` uses the merged count. `{position} od {count}` and prev/next stay over collisions.
- ***Odlučeno*.** Approved and rejected requests sit beside decided collisions, newest decision first. Each shows its badge (*Odobren* or *Odbijen*), the member, the range, and `Odluka: {admin}, {datum} u {vrijeme}` with the existing `actorGone` fallback. Withdrawn requests are not listed. Rows are read-only. It remains a read of stored decisions only.
- **Offline.** The new key joins the queue, Danas and resolution surface keys and the retry lists, and the screens read it as one snapshot under the as-of note.
- **Docs in the same change.** UX-DR25, 46 and 52 become shipped fact. In EXPERIENCE.md, update §IA (the *Za odluku* line and the request inventory row, which is no longer "reached by URL"), Admin Danas and Resolved conflicts. DESIGN.md gets the *Odlučeno* row line.

**Ask First:**
- Any migration, or any change to 0040 or `packages/domain`.
- Changing the resolution screen's prev/next to step through requests.

**Never:**
- No swap requests (Epic 12), no cost or balance on queue rows, no notification, no change history.
- No second count: every count shown equals `queue.count`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mixed | 2 collisions, 1 pending request | `3 čekaju odluku` on the tab, the heading and Danas; rows by date, each naming its kind | N/A |
| Only requests | 0 collisions, 1 request | `1 čeka odluku`; the row links to the decision screen | N/A |
| Zero | Nothing pending | `0 čeka odluku` and the empty sentence, in both places | N/A |
| Withdrawn/decided | Request closed | Gone from the queue; a decided one is in *Odlučeno*, a withdrawn one nowhere | N/A |
| Approve | Approve from a queue row | Back on the queue, the request is gone, any new collisions are listed, and *Odlučeno* shows *Odobren* | N/A |
| Read fails | The requests read errors | The whole queue and Danas card are unavailable, with a retry | Retry re-reads all keys |
| Offline | Opened offline after an online read | Snapshot including requests | N/A |

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

Paths under `apps/web/src/` unless rooted.

- `features/leave/services/leave-requests.ts` -- `LEAVE_REQUEST_COLUMNS` :71, `leaveRequestFoundOf` :250, `compareRequests` :164, `leaveRequestStatusOf` :152. Add `ORGANIZATION_LEAVE_REQUESTS_KEY`, the org read and `organizationLeaveRequestsQueryOptions`.
- `features/conflicts/services/conflicts-queue.ts` -- `ConflictRow` :58, `queueOrderOf` :110, `conflictsQueueViewOf` :204, `conflictsQueueOf` :321. Add the request source and item union here.
- `features/conflicts/hooks/use-conflicts-queue.ts:103-176` -- the reads, freshness and retry list. `services/surface-keys.ts:19` is `rasporedSurfaceKeysOf`.
- `features/conflicts/components/conflicts-list.tsx:22-75` -- rows. Add a request row and a kind line on both kinds.
- `features/conflicts/services/resolved-conflicts.ts:43,171,243` -- `ResolvedConflictRow` and the view. Merge decided requests here. `components/resolved-list.tsx` renders them.
- `features/conflicts/services/resolution-screen.ts:337,580,646` -- the count. Use the merged count for the back link. The hook reads the new key.
- `features/today/services/admin-today.ts:309-335,429` -- `adminTodayOf` and `needsYouOf`. `hooks/use-admin-today.ts:77-162` and `services/surface-keys.ts` handle the reads, keys and retry. `components/needs-you-card.tsx:24-81` needs a request row.
- `features/teams/services/dependents.ts:130` -- `LEAVE_REQUEST_WRITE_DEPENDENTS`. Pinned in `dependents.test.ts`.
- `lib/offline/persistence.ts:103-121` -- `PERSISTED_KEY_ROOTS` and its doc comment, plus `persistence.test.ts`.
- `lib/i18n/locales/hr.json:516-580` -- new `zaOdluku.kind.{collision,request}` and request row/decided lines. Reuse `zaOdluku.request.range`, `request.memberGone` and `godisnji.request.status.{approved,rejected}`.

**Pinned lists:**
- `conflicts-screen.fixture.ts` (`CONFLICTS_QUEUE_PARTS`; update the `resolved-conflicts.ts` exempt `why`).
- `pages/key-sources.fixture.ts` (`ZA_ODLUKU` `strings: 23` :942, `TODAY_ADMIN_KEYS` :375, a new key-source entry).
- `structural-pins-shell.test.ts:1022,1032` (retry lines).
- `test/localization-applied.test.ts:665-680`.
- `test/resource-hygiene.test.ts`.
- `eslint.config.js` `FEATURE_PUBLIC` (leave `services/leave-requests` consumers gain conflicts and today).
- `features/*/services/surface-keys.test.ts`.

**E2E:**
- `e2e/pages/conflicts.page.ts:16-91`.
- `e2e/pages/today.page.ts:132-146`.
- `e2e/tests/conflicts/conflicts-queue.spec.ts`.
- `e2e/tests/leave/leave-decision.spec.ts:34` (opens by URL).
- `e2e/tests/today/today.spec.ts:654,677`.
- `seedLeaveRequest` at `e2e/utils/database-helper.ts:567`.

## Tasks & Acceptance

**Execution:**
- [x] `features/leave/services/leave-requests.ts` (+ test) -- the org read, key and query options. One service owns 0040.
- [x] `features/conflicts/services/conflicts-queue.ts` (+ test) -- item union, merged order and count, gating. Unit-test the matrix's order, zero and failure cases.
- [x] `features/conflicts/services/resolved-conflicts.ts`, `resolved-list.tsx` (+ tests) -- decided requests in *Odlučeno*.
- [x] `use-conflicts-queue.ts`, both `surface-keys.ts`, `use-admin-today.ts`, the resolution hook and screen -- read the key and use the merged count.
- [x] `conflicts-list.tsx`, `needs-you-card.tsx`, `admin-today.ts` (+ tests) -- request rows and kind words.
- [x] `dependents.ts`, `persistence.ts`, `hr.json` and every pinned list -- sweeps green.
- [x] E2E -- a mixed queue in order with kinds; the count equals Danas, including requests; the decision is reached by clicking the row; *Odlučeno* shows an approved and a rejected request; a withdrawn request is absent.
- [x] `_bmad-output/planning-artifacts/epics.md` (UX-DR25, 46, 52), `ux-designs/ux-shift-2026-09-02/EXPERIENCE.md`, `DESIGN.md` -- doc rewrites.

**Acceptance Criteria:**
- Given a member sends or withdraws a request, when the admin next opens the queue, Danas or a resolution screen in the app, then the count and rows follow without a reload (the request read is never stale; the app has no live push, so a screen already open shows it on the next visit).
- Given the local stack, when `pnpm test`, `pnpm lint`, `pnpm typecheck` and the conflicts, leave, today and offline E2E specs run, then everything passes with nothing skipped.

## Spec Change Log

## Design Notes

- **Merge in the queue model, not the UI.** Danas and the resolution screen already derive from `conflictsQueueOf`, so one merged `count` keeps all three equal by construction (FR-53).
- **Prev/next stays over collisions.** The resolution screen's position line belongs to *Odsutnost u smjeni*. Stepping into a request screen would mix two decision screens, so it is left to Ask First.
- **One read for both tabs.** Pending and decided requests come from the same rows. Like *Odlučeno*'s resolutions, the read has no window.

## Verification

**Commands:**
- `pnpm test && pnpm lint && pnpm typecheck` -- expected: all green.
- `pnpm test:e2e e2e/tests/conflicts e2e/tests/leave e2e/tests/today e2e/tests/offline` -- expected: all pass, none skipped.

## Suggested Review Order

**The merged queue model**

- Entry point: one view, one count, collisions and pending requests together.
  [`conflicts-queue.ts:498`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L498)

- The item union every surface renders.
  [`conflicts-queue.ts:131`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L131)

- Soonest-first across kinds; same date: collisions, then requests by sending time.
  [`conflicts-queue.ts:194`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L194)

- Pending requests dated by their first day.
  [`conflicts-queue.ts:236`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L236)

- The one count other screens borrow; null when the queue refuses.
  [`conflicts-queue.ts:444`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L444)

- A request naming an unknown member is a stale snapshot, not a gone member.
  [`snapshot-skew.ts:63`](../../apps/web/src/features/calendar/services/snapshot-skew.ts#L63)

**The organization-wide request read**

- New key, separate root from the by-id request key.
  [`leave-requests.ts:444`](../../apps/web/src/features/leave/services/leave-requests.ts#L444)

- Paged read with the decision and sending time embedded.
  [`leave-requests.ts:466`](../../apps/web/src/features/leave/services/leave-requests.ts#L466)

- Never stale: members write requests in other sessions.
  [`leave-requests.ts:481`](../../apps/web/src/features/leave/services/leave-requests.ts#L481)

- All-or-nothing parse; one untrusted row refuses the read.
  [`leave-requests.ts:326`](../../apps/web/src/features/leave/services/leave-requests.ts#L326)

**Odlučeno**

- Approved and rejected requests beside decided collisions; withdrawn left out.
  [`resolved-conflicts.ts:218`](../../apps/web/src/features/conflicts/services/resolved-conflicts.ts#L218)

- One entry head for both kinds: date, badge, kind.
  [`resolved-list.tsx:31`](../../apps/web/src/features/conflicts/components/resolved-list.tsx#L31)

- The read-only decided-request entry.
  [`resolved-list.tsx:75`](../../apps/web/src/features/conflicts/components/resolved-list.tsx#L75)

**Surfaces sharing the count**

- The request row on the queue, linking to its decision screen.
  [`conflicts-list.tsx:69`](../../apps/web/src/features/conflicts/components/conflicts-list.tsx#L69)

- Danas Treba tebe takes the merged rows and count.
  [`admin-today.ts:460`](../../apps/web/src/features/today/services/admin-today.ts#L460)

- The Danas request row, same look as the queue's.
  [`needs-you-card.tsx:40`](../../apps/web/src/features/today/components/needs-you-card.tsx#L40)

- Resolution screen's back link from the queue model; K od N stays collisions.
  [`resolution-screen.ts:597`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L597)

- The back link renders the queue count.
  [`conflict-resolution-body.tsx:166`](../../apps/web/src/features/conflicts/components/conflict-resolution-body.tsx#L166)

**Reads, refresh and offline**

- Request rows feed the snapshot re-read on the queue.
  [`use-conflicts-queue.ts:183`](../../apps/web/src/features/conflicts/hooks/use-conflicts-queue.ts#L183)

- The same on Danas.
  [`use-admin-today.ts:144`](../../apps/web/src/features/today/hooks/use-admin-today.ts#L144)

- And on the resolution screen.
  [`use-conflict-resolution.ts:231`](../../apps/web/src/features/conflicts/hooks/use-conflict-resolution.ts#L231)

- Send, withdraw, approve and reject all refresh the new key.
  [`dependents.ts:139`](../../apps/web/src/features/teams/services/dependents.ts#L139)

- Persisted for offline reading.
  [`persistence.ts:101`](../../apps/web/src/lib/offline/persistence.ts#L101)

- Part of the queue surface's freshness set.
  [`surface-keys.ts:43`](../../apps/web/src/features/conflicts/services/surface-keys.ts#L43)

**Peripherals: E2E and docs**

- Mixed queue, counts, Danas row click, Odlučeno kinds, withdrawn absent.
  [`conflicts-queue.spec.ts:55`](../../e2e/tests/conflicts/conflicts-queue.spec.ts#L55)

- A Danas request row opens its decision screen.
  [`conflicts-queue.spec.ts:571`](../../e2e/tests/conflicts/conflicts-queue.spec.ts#L571)

- UX-DR25, 46 and 52 as shipped fact.
  [`epics.md:146`](../planning-artifacts/epics.md#L146)

- Requests beside collisions in the experience spec.
  [`EXPERIENCE.md:140`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L140)
