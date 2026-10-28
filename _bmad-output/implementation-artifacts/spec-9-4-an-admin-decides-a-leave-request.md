---
title: 'An admin decides a leave request on its own screen'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'dc933e1b4a984789416afff61c2717527de14c6e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member can send a leave request (9.3) and 0040's `decide_leave_request` can decide it, but no admin screen reads a request or calls the decision.

**Approach:** A new admin-only surface at `/za-odluku/zahtjev/$requestId` shows one request: who, the range, the cost, the balance after it and the collisions approval would create. *Odobri* and *Odbij* decide it, and the admin returns to *Za odluku* with a status line. Until 9.5 lists requests in the queue, the screen is reached only by URL.

## Boundaries & Constraints

**Always:**
- **Route.** `/za-odluku/zahtjev/$requestId`, under `appLayoutRoute` with `beforeLoad: requireAdmin`, absent from the destinations, so the *Za odluku* tab lights for it. It is offline-readable. Back link: *Natrag na Za odluku*.
- **The read.** One request by id from `leave_requests`, with its `leave_request_decisions` embedded (`outcome`, `decided_by`, `decided_at`). The status comes from 9.3's `leaveRequestStatusOf`. The member's name and allowance come from the members list. The acting admin's name comes from `actingAdminsQueryOptions`, as on *Odlučeno*. No row means "Zahtjev ne postoji.", not an error.
- **The preview** (pending only). It is the same pipeline as the admin leave dialog: `memberLeaveBaseOf`, then `leavePreviewStateOf(input, from, to)`, then `leaveConflictsOf(…, {target: null, next: range}, refreshing)`. It shows the cost in days, the in-year charge when it differs, the balance after it, over-balance and overlap notes, and the collisions it creates in the dialog's wording, through the dialog's lines extracted to a shared component. A base that is not ready (unscheduled, absent) shows its reason line. Nothing in the preview disables a decision.
- **Deciding.** *Odobri* and *Odbij* call `decide_leave_request(p_request_id, p_outcome)` with `'approved'` or `'rejected'`, with no confirmation. Refusals map by SQLSTATE: P0002 → "Zahtjev više ne čeka odluku." and re-read; 23P01 → "U međuvremenu je upisan godišnji koji se preklapa s ovim zahtjevom. Odobrenje nije moguće, a zahtjev možeš odbiti." (the request stays pending); 42501 → not allowed; anything else → failed. On success the admin lands on `/za-odluku` with a polite, focused status, "Zahtjev odobren: {ime}, {range}." or "Zahtjev odbijen: {ime}, {range}.", carried in the existing `ResolutionSaved` router-state slot as new kinds.
- **Closed request.** Read-only: the status badge (9.3's words), and for approved or rejected requests, "{admin} · {datum i vrijeme}". A withdrawn request shows its date. No buttons, no preview.
- **Writes.** Both buttons use `useWriteGate`, `aria-disabled` and `OfflineWriteNote`, with one in-flight ref and no optimistic update. Approval refreshes the request key, `LEAVE_REQUEST_WRITE_DEPENDENTS`, `LEAVE_WRITE_DEPENDENTS` and `LEAVE_RECORDS_KEY(memberId)`. Rejection refreshes the request keys only.
- **Offline.** The screen reads as one snapshot under the as-of note. The new request key is persisted.
- **Docs in the same change.** UX-DR33: the request decision screen ships, the inventory goes from 19 to 20, and 12.4 stays planned. UX-DR46: a leave request has its own decision screen, and the queue listing stays planned for 9.5. EXPERIENCE.md §IA gets an inventory row.

**Ask First:**
- Any migration, or any change to 0040.
- Changing `packages/domain`, or the admin leave dialog's behaviour (extracting its conflict lines unchanged is fine).

**Never:**
- No *Za odluku* queue listing, no count change and no *Odlučeno* rows (9.5).
- No short-staffed preview (Epic 11), no notification (Epic 10), no reason field.
- No client-side refusal of an approval: the database decides overlap.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pending | Admin opens a pending request | Name, range, cost, balance after it, created collisions; both buttons | N/A |
| Over balance | Cost above balance | Note; *Odobri* still works | N/A |
| Approve | *Odobri* online | Leave record exists, its collisions show in the queue; status line on `/za-odluku` | N/A |
| Reject | *Odbij* online | Only the decision is recorded; status line | N/A |
| Stale | Live leave overlapping it was added since | Stays, names the overlap, request pending | 23P01 |
| Already closed | Decided or withdrawn meanwhile | Message, re-read shows read-only state | P0002 |
| Closed | Opens an approved, rejected or withdrawn request | Badge, admin and time (or the date); no buttons | N/A |
| Missing | Unknown id | "Zahtjev ne postoji." and the back link | N/A |
| Offline | Opened offline after an online read | Snapshot under the as-of note; buttons gated | Nothing is sent |
| Member | Member-role opens the URL | The admin guard redirects | N/A |

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

Paths under `apps/web/src/` unless rooted.

- `supabase/migrations/0040_leave_requests.sql:101-115,492` -- `decide_leave_request` returns a uuid on approval and null on rejection; refusal codes. Read-only.
- `features/leave/services/leave-requests.ts` -- `LEAVE_REQUESTS_COLUMNS` :46, `leaveRequestStatusOf` :126, `readMyLeaveRequestRows` :203, `withdrawLeaveRequest` :401, `leaveRequestWithdrawFailureOf` :330. Add the by-id read, `LEAVE_REQUEST_KEY(id)`, the parse (no member filter, returns `memberId`) and `decideLeaveRequest` here.
- `features/leave/hooks/use-member-leave.ts:172` -- its five reads (members, organization snapshot, `useCalendarSnapshot`, `leaveRecordsQueryOptions`, organization conflict resolutions) and the preview gate (:296). Copy the reads; do not reuse the hook, which is tied to the member page.
- `features/leave/services/leave-section.ts` -- `memberLeaveBaseOf` :227, `leavePreviewStateOf` :372, `leaveInYearChargeOf` :433, the reason keys :99-103.
- `features/leave/services/leave-conflicts.ts:110` -- `leaveConflictsOf`.
- `features/leave/components/member-leave-dialog.tsx:60,189` -- `LeaveConflictLines` (local) and `renderPreview`. Extract the lines to a shared component; the dialog renders the same.
- `features/leave/services/leave-write.ts:132,402` -- the typed `rpc` overload and `amendLeave`, the uuid-RPC pattern.
- `features/conflicts/services/resolved-conflicts.ts:93,282` -- `ACTING_ADMINS_COLUMNS` and `actingAdminsQueryOptions`.
- `features/conflicts/hooks/use-conflict-resolution.ts:142,191,298,398-405` -- the in-flight ref, `useSnapshotFreshness`, `writesOnline()`, then landed, refresh, navigate. `components/conflict-resolution-body.tsx:50` is the `BackLink`; the states follow it.
- `features/conflicts/services/resolution-screen.ts:192-208,852-935` -- the `ResolutionSaved` union, `resolutionSavedOf` and `resolutionSavedMessageKey`. Add the two request kinds. `components/conflicts-body.tsx:61-68` renders them.
- `features/teams/services/dependents.ts:114,129` -- add the request key to `LEAVE_REQUEST_WRITE_DEPENDENTS` and a decision list. Pinned in `dependents.test.ts`.
- `pages/za-odluku.$memberId.$date.$teamId.tsx:44-57`, `router.ts:59-62` -- the route pattern.
- `lib/offline/readable-paths.ts:29`, `lib/offline/persistence.ts:~117`.
- `lib/i18n/locales/hr.json` -- reuse `godisnji.request.status.*`, `godisnji.request.*` figures and `ljudi.leaveRecord.conflicts*`. New `zaOdluku.request.*` keys.
- `e2e/utils/database-helper.ts:567` -- `seedLeaveRequest(slug, memberId, from, to, status)`. `e2e/pages/conflicts.page.ts:91,105` has `savedStatus` and the resolution page object.

**Pinned lists (9.3's checklist):**
- `router.test.ts`: `LEVEL_GUARDED_ROUTES` :275, route ids :419, `OFFLINE_READABLE_PATHS` :1606, a dedicated describe like :2701.
- `features/conflicts/conflicts-screen.fixture.ts:24` (new `…_PARTS`).
- `pages/source-guards.fixture.ts:260,1002`.
- `pages/key-sources.fixture.ts` and `screens-sweep.test.ts` (`SCREENS` 35 :307, `KEY_SOURCES` 77 :371).
- `pages/prijava.test.ts:172` `IN_FLIGHT_HANDLERS` (32, :1074).
- `structural-pins-shell.test.ts:1020,1045`.
- `test/resource-hygiene.test.ts:39,244`.
- `test/localization-applied.test.ts:391`.
- `eslint.config.js:124` `FEATURE_PUBLIC`.
- `lib/offline/persistence.test.ts:~131`.
- `e2e/tests/offline/offline-write.spec.ts:67` `WRITE_RPC` gains `decide_`.

## Tasks & Acceptance

**Execution:**
- [x] `features/leave/services/leave-requests.ts` (+ test) -- by-id read and parse, decision columns, `decideLeaveRequest` and failure mapping -- one service owns the 0040 boundary.
- [x] `features/leave/services/leave-request-review.ts` (+ test) -- the pure screen state: loading, unavailable, missing, pending with preview and collisions, or closed with the decision -- testable without React.
- [x] `features/leave/hooks/use-leave-request-review.ts` -- the reads under freshness, the decide with gate, in-flight ref, refresh and navigate -- hook pattern.
- [x] `features/leave/components/leave-conflict-lines.tsx`, `member-leave-dialog.tsx` -- extract the lines unchanged -- one wording for both.
- [x] `features/leave/components/leave-request-review-body.tsx`, `pages/za-odluku.zahtjev.$requestId.tsx`, `router.ts`, `readable-paths.ts` -- the UI and the route.
- [x] `features/conflicts/services/resolution-screen.ts`, `conflicts-body.tsx` (+ tests) -- the two saved kinds and their lines.
- [x] `dependents.ts`, `persistence.ts`, `hr.json` and every pinned list above -- the sweeps stay green.
- [x] `e2e/tests/leave/leave-decision.spec.ts`, `e2e/pages/conflicts.page.ts`, `offline-write.spec.ts` -- approve (the leave and its collision appear), reject, stale 23P01, closed read-only, offline gate.
- [x] `_bmad-output/planning-artifacts/epics.md` (UX-DR33, 46), `ux-designs/ux-shift-2026-09-02/EXPERIENCE.md` -- the doc rewrites.

**Acceptance Criteria:**
- Given an approval, when it lands, then the member's *Godišnji* and the admin leave card show the new record, and the request reads *Odobren*, without a reload.
- Given the local stack, when `pnpm test`, `pnpm lint`, `pnpm typecheck` and the leave and offline E2E specs run, then everything passes with nothing skipped.

## Spec Change Log

## Design Notes

- **Reached by URL until 9.5.** This was the human's choice: 9.5 merges requests into *Čeka odluku* right after, and deploys are off.
- **No confirmation.** The screen itself is the review, as the resolution's *Spremi* is. Approved leave is changed the usual way afterwards.
- **One saved-notice slot.** New `ResolutionSaved` kinds reuse the queue's clearing and focus path instead of a second state machine.

## Verification

**Commands:**
- `pnpm test && pnpm lint && pnpm typecheck` -- expected: all green.
- `pnpm test:e2e e2e/tests/leave e2e/tests/offline e2e/tests/conflicts` -- expected: all pass, none skipped.

## Suggested Review Order

**The screen's state and the shared preview**

- Entry point: one pure state for every case, testable without React.
  [`leave-request-review.ts:285`](../../apps/web/src/features/leave/services/leave-request-review.ts#L285)

- The admin dialog's pipeline reused: base, preview, in-year charge, collisions.
  [`leave-request-review.ts:242`](../../apps/web/src/features/leave/services/leave-request-review.ts#L242)

- A member gone from every list still reads, and can still be decided.
  [`leave-request-review.ts:303`](../../apps/web/src/features/leave/services/leave-request-review.ts#L303)

- The dialog's conflict lines, extracted unchanged, so both speak alike.
  [`leave-conflict-lines.tsx:36`](../../apps/web/src/features/leave/components/leave-conflict-lines.tsx#L36)

**Deciding: the 0040 boundary and the write**

- The RPC call; a uuid on approval, null on rejection.
  [`leave-requests.ts:648`](../../apps/web/src/features/leave/services/leave-requests.ts#L648)

- Refusals mapped by SQLSTATE: P0002, 23P01 stale, 42501, failed.
  [`leave-requests.ts:542`](../../apps/web/src/features/leave/services/leave-requests.ts#L542)

- The by-id read, with the decision embedded.
  [`leave-requests.ts:370`](../../apps/web/src/features/leave/services/leave-requests.ts#L370)

- Gate, in-flight ref, and a landed write never reported as failed.
  [`use-leave-request-review.ts:211`](../../apps/web/src/features/leave/hooks/use-leave-request-review.ts#L211)

- What each outcome re-reads, as a pure, tested choice.
  [`leave-request-review.ts:387`](../../apps/web/src/features/leave/services/leave-request-review.ts#L387)

- Approval re-reads leave, balance and conflict keys; rejection only requests.
  [`dependents.ts:144`](../../apps/web/src/features/teams/services/dependents.ts#L144)

**The surface: route, body, offline**

- Admin-only route under the layout, not a destination.
  [`router.ts:62`](../../apps/web/src/router.ts#L62)

- The page, keyed by its request id.
  [`za-odluku.zahtjev.$requestId.tsx:52`](../../apps/web/src/pages/za-odluku.zahtjev.$requestId.tsx#L52)

- Every state rendered; the refusal alert in one place.
  [`leave-request-review-body.tsx:182`](../../apps/web/src/features/leave/components/leave-request-review-body.tsx#L182)

- One snapshot under the as-of note.
  [`use-leave-request-review.ts:166`](../../apps/web/src/features/leave/hooks/use-leave-request-review.ts#L166)

- Persisted only for uuid ids, so typed URLs do not fill storage.
  [`persistence.ts:153`](../../apps/web/src/lib/offline/persistence.ts#L153)

- Offline-readable path.
  [`readable-paths.ts:34`](../../apps/web/src/lib/offline/readable-paths.ts#L34)

**The status line back on Za odluku**

- Two request kinds join the existing saved-notice slot.
  [`resolution-screen.ts:192`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L192)

- One line builder for collision and request notices.
  [`resolution-screen.ts:1005`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L1005)

- The queue renders it, focused.
  [`conflicts-body.tsx:60`](../../apps/web/src/features/conflicts/components/conflicts-body.tsx#L60)

**Peripherals: E2E and docs**

- Approve end to end, including the no-reload proof via in-app links.
  [`leave-decision.spec.ts:117`](../../e2e/tests/leave/leave-decision.spec.ts#L117)

- The decision screen's page object.
  [`conflicts.page.ts:224`](../../e2e/pages/conflicts.page.ts#L224)

- The offline write filter catches `decide_`.
  [`offline-write.spec.ts:67`](../../e2e/tests/offline/offline-write.spec.ts#L67)

- UX-DR33 and UX-DR46 rewritten as shipped fact.
  [`epics.md:158`](../planning-artifacts/epics.md#L158)

- The inventory row.
  [`EXPERIENCE.md:68`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L68)
