---
title: 'A member requests leave and sees what it costs'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: '10889da18ecf5c59f7e13d6fad3044120fb63e57'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 9.2 shipped the `leave_requests` data layer, but no screen reads or writes it. A member still cannot ask for leave, and cannot see what a range would cost.

**Approach:**
- *Godišnji* gains *Zatraži godišnji*. It opens a new surface, `/godisnji/zatrazi`, with a date range, a live preview of the cost and the balance after it from `domain/leave`, and one *Pošalji*.
- *Godišnji* lists the member's own requests with their status, and a pending request has *Povuci zahtjev*.

## Boundaries & Constraints

**Always:**
- **Who sees it.** Only a member's view of *Godišnji* (`GODISNJI_OWN`) shows the action and the list. An admin who opens `/godisnji/zatrazi` is redirected to `/godisnji`. The role comes from the calendar snapshot, as on *Godišnji*.
- **The preview.**
  - It uses `leavePreviewOf` over the same `LeaveBalanceInput` that `myLeaveOf` builds, factored out, never recomputed.
  - It shows the cost in days, the in-year charge when the range crosses the leave year, the balance after it, and the domain's `exceedsBalance`/`overlapsRecord` as warnings.
  - It never blocks: *Pošalji* stays available over the balance.
  - Pending requests charge nothing, so neither the balance nor the balance after it counts them.
  - Prose lives in new `godisnji.request.*` keys and DOM ids are new, never `member-leave-*`.
- **Sending.**
  - The send inserts `{organization_id, member_id, during: '[from,to]'}` into `leave_requests`. The ids come from the snapshot.
  - Refusals map by SQLSTATE and message:
    - 23P01 `LEAVE_REQUEST_OVERLAPS_LEAVE` → overlaps your leave;
    - any other 23P01 → overlaps a pending request;
    - 42501 → not allowed;
    - anything else → failed.
  - On success the member returns to `/godisnji`. A polite status there names the sent range, and the new pending row is in the list.
- **The list.**
  - It reads the member's own rows from `leave_requests`, with their `leave_request_decisions` embedded.
  - The status is derived: pending if `closed_at` is null; otherwise the decision's outcome, or withdrawn when there is none.
  - Each row shows the range, the cost in days, the status as a word in a badge (*Čeka odluku*, *Odobren*, *Odbijen*, *Povučen*) and, once closed, the date.
  - Rows are sorted by the range start, soonest first.
  - An empty list reads "Nemaš zahtjeva za godišnji."
- **Withdrawing.** It calls `withdraw_leave_request(p_request_id)` with no confirmation dialog, because the member can send the range again. P0002 → no longer pending (the list re-reads); 42501 → not allowed.
- **Writes.**
  - *Pošalji* and *Povuci zahtjev* use `useWriteGate`, `aria-disabled` and `OfflineWriteNote`.
  - Each write keeps an in-flight ref with no `useMutation` and no optimistic update.
  - After the write it re-reads through `refreshAfterWrite` with a new `LEAVE_REQUEST_WRITE_DEPENDENTS` (the requests key; leave and balance keys are untouched, since pending derives nothing).
- **Offline.** The requests key joins `GODISNJI_MEMBER_SURFACE_KEYS` and `PERSISTED_KEY_ROOTS`. Godišnji and the form each read as one whole snapshot under the existing as-of note.
- **Docs in the same change:**
  - EXPERIENCE.md §IA: the inventory gets a "Request leave" row, and the member *Godišnji* line describes the action and the list.
  - UX-DR31 and UX-DR33 get their 9.3 clauses rewritten as present-tense fact; the inventory goes from 18 to 19 surfaces.
  - UX-DR47: the leave form is shipped; the type (13.2) and the half day (13.5) stay planned.

**Ask First:**
- Any migration, or any change to 0040's policies, grants or definers.
- Changing `packages/domain` beyond the existing exports, or touching the admin leave dialog's behaviour.

**Never:**
- No client-side overlap refusal: the domain's `overlapsRecord` is a warning, and the database decides.
- No decision UI, no admin reader of requests, no *Za odluku* change (9.4, 9.5).
- No absence type, no half day, no notification.
- No count of pending days in any balance.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Preview | Valid range within the year | Cost and balance after it, *Pošalji* enabled | N/A |
| Over balance | Cost above the balance | Warning; *Pošalji* still sends | N/A |
| Across the year | The range crosses the leave-year start | Cost and in-year charge both shown | N/A |
| Incomplete or reversed | One date, or to < from | A reason line, no preview; send refused | N/A |
| Send | Valid range online | Back on Godišnji, status line, pending row | N/A |
| Overlaps leave | Range shares a date with own leave | Stays on the form, names the overlap | 23P01 `LEAVE_REQUEST_OVERLAPS_LEAVE` |
| Overlaps a request | Range shares a date with own pending request | Stays on the form, names it | 23P01 |
| Withdraw | Own pending request | Row reads *Povučen* | P0002 → re-read, "no longer pending" |
| Statuses | Approved, rejected or withdrawn rows exist | Each reads its own word, no withdraw | N/A |
| Offline | Form or list opened offline | Last snapshot under the as-of note; *Pošalji* and withdraw state the connection need | No request is sent |
| Admin | Admin opens `/godisnji/zatrazi` | Redirect to `/godisnji` overview | N/A |

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/godisnji.tsx` -- `GodisnjiScreen`; the member branch `GodisnjiOwn` (bottom) gets the action, the status line and the list. A new `pages/godisnji.zatrazi.tsx` holds the form route; register it in `router.ts` and `router.test.ts` (route table :189, path lists :389, :1608).
- `features/leave/hooks/use-my-leave.ts` -- the four reads under `useSnapshotFreshness(GODISNJI_MEMBER_SURFACE_KEYS…)`; the pattern for the request reads.
- `features/leave/services/my-leave.ts:140-150` -- the inline `LeaveBalanceInput`: factor it out so the preview reuses it.
- `packages/domain/src/leave.ts` -- `leavePreviewOf` :360, `MAX_LEAVE_RANGE_DAYS`; read-only.
- `features/leave/services/leave-section.ts` -- `leavePreviewStateOf` :372 and the reasons :401; reuse them for the reason and preview state.
- `features/leave/components/member-leave-dialog.tsx:185-230` -- the preview rendering, the date inputs and the gate wiring to mirror; do not edit.
- `features/leave/hooks/use-member-leave.ts:626-700` -- `save()`: the in-flight ref, `writesOnline()`, `refreshAfterWrite`.
- `features/leave/services/leave-write.ts` -- the structural client and `{ok}` outcomes. For message-based 23P01 handling, see `conflicts/services/resolution-write.ts:117,167`.
- `features/teams/services/dependents.ts:113` -- `LEAVE_WRITE_DEPENDENTS`; add `LEAVE_REQUEST_WRITE_DEPENDENTS`.
- `lib/offline/use-write-gate.ts`, `components/offline-write-note.tsx`, `components/offline-note.tsx` -- the gate and the notes.
- `supabase/migrations/0040_leave_requests.sql:78-115` -- the refusal list; `:434` `withdraw_leave_request(p_request_id uuid)`.
- `apps/web/src/lib/i18n/locales/hr.json` (`godisnji.*` :431); `components/ui/badge.tsx`, `stacked-list.tsx`.
- Docs: `_bmad-output/planning-artifacts/epics.md:156,158,181` (UX-DR31/33/47); `ux-designs/ux-shift-2026-09-02/EXPERIENCE.md:33-64` (§IA and the inventory).

**Pinned lists that fail when something is left unregistered:**
- `features/teams/services/dependents.test.ts:76` `CLASSIFIED`.
- `lib/offline/persistence.test.ts:114` (exact order); `lib/query-client.ts:47` `gcTime`.
- `features/leave/services/surface-keys.test.ts`: the four keys, and the "subset of Danas" assertion. Change it deliberately: Danas does not read requests.
- `test/resource-hygiene.test.ts`: `SANCTIONED_SCREEN_KEYS` :240/~1669 and `SANCTIONED_PLURAL_KEYS` :39.
- `features/leave/leave-screen.fixture.ts` `LEAVE_SCREEN_PARTS`.
- `pages/source-guards.fixture.ts:974`: Godišnji fields and buttons; add an entry for the new page.
- `pages/key-sources.fixture.ts:904` and `screens-sweep.test.ts`: `KEY_SOURCES` 76, `SCREENS` 34.
- `test/localization-applied.test.ts:649`; `pages/prijava.test.ts:170` `IN_FLIGHT_HANDLERS` 30.
- `structural-pins-shell.test.ts:1025` `HOOK_FLAGS` and `RETRY_BUTTONS`; `eslint.config.js:123` `FEATURE_PUBLIC` (import new services through a hook).
- E2E: `e2e/utils/database-helper.ts:388` `removeLeaveMemberInSql` must also delete `leave_request_decisions` and `leave_requests`. `e2e/tests/offline/offline-write.spec.ts:~90` `WRITE_RPC` must match the new writes. The `LeavePage` page object lives in `e2e/pages/leave.page.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `features/leave/services/leave-requests.ts` (+ test) -- the read (own rows with the embedded decision), the row parse, the status derivation, the sort, the insert and the withdraw, with refusal mapping and the new `MY_LEAVE_REQUESTS_KEY`. -- One service owns the 0040 boundary.
- [x] `features/leave/services/my-leave.ts` (+ test) -- expose the balance input, and add the request preview state over `leavePreviewStateOf`. -- The preview reuses the domain.
- [x] `features/leave/hooks/use-my-leave-requests.ts`, `use-leave-request-form.ts` -- the reads under freshness, and the send and the withdraw with the gate and the in-flight refs. -- Hook pattern.
- [x] `features/leave/components/my-leave-requests.tsx`, `leave-request-form.tsx`; `pages/godisnji.tsx`, `pages/godisnji.zatrazi.tsx`, `router.ts` -- the list, the form, the action, the status line and the admin redirect. -- The UI.
- [x] `hr.json` and every pinned list above -- register the keys, files, controls and the surface. -- The sweeps stay green.
- [x] `e2e/tests/leave/leave-request.spec.ts`, `e2e/pages/leave.page.ts`, `database-helper.ts`, `offline-write.spec.ts` -- the flows: send, overlap refusal, withdraw, a seeded approved row, and offline refusal. -- Real-stack proof.
- [x] `epics.md`, `EXPERIENCE.md` -- the doc rewrites above. -- Docs ship with the change.

**Acceptance Criteria:**
- Given the local stack, when `pnpm test` and the leave E2E specs run, then every new case passes with nothing skipped.
- Given `grep -rn "konflik" apps/web/src/lib/i18n/locales/hr.json`, when it runs, then there are no hits.

## Design Notes

- **A route, not a dialog.** UX-DR33 counts *request leave* as one of the five new surfaces, so it gets a URL, like `/ljudi/$id`. The admin's leave dialog stays a dialog.
- **Withdraw without a question.** UX-DR4 asks a question before a change that cannot be undone. A withdrawn request can be sent again, so withdrawing needs no dialog.
- Both are open to your edit at the checkpoint.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm test` -- expected: green.
- `pnpm test:e2e e2e/tests/leave e2e/tests/offline` -- expected: green.

## Suggested Review Order

**The request boundary (0040)**

- Entry point: one service owns 0040, from the read and the status to the send and withdraw.
  [`leave-requests.ts:37`](../../apps/web/src/features/leave/services/leave-requests.ts#L37)

- Status is derived from `closed_at` and the embedded decision, never stored.
  [`leave-requests.ts:126`](../../apps/web/src/features/leave/services/leave-requests.ts#L126)

- The read filters by member, so a wider policy in 9.4 cannot blank the list.
  [`leave-requests.ts:210`](../../apps/web/src/features/leave/services/leave-requests.ts#L210)

- Both overlaps are 23P01, so the message tells the leave overlap apart.
  [`leave-requests.ts:320`](../../apps/web/src/features/leave/services/leave-requests.ts#L320)

- The withdrawal calls the definer, and its refusals map by SQLSTATE.
  [`leave-requests.ts:401`](../../apps/web/src/features/leave/services/leave-requests.ts#L401)

**The preview reuses the domain**

- The balance input is factored out of `myLeaveOf` and not recomputed.
  [`my-leave.ts:143`](../../apps/web/src/features/leave/services/my-leave.ts#L143)

- The form's preview is `leavePreviewStateOf` over that input, and it never gates.
  [`my-leave.ts:289`](../../apps/web/src/features/leave/services/my-leave.ts#L289)

- The list needs only the snapshot's viewer; the cost is shown when the figures are ready.
  [`my-leave.ts:469`](../../apps/web/src/features/leave/services/my-leave.ts#L469)

**The form surface**

- A new route; an admin is sent back to the overview.
  [`godisnji.zatrazi.tsx:34`](../../apps/web/src/pages/godisnji.zatrazi.tsx#L34)

- The role gate and the redirect, read from the calendar snapshot.
  [`use-leave-request-form.ts:46`](../../apps/web/src/features/leave/hooks/use-leave-request-form.ts#L46)

- The send: an in-flight ref and the offline guard, a cleared refusal on edit, no optimism.
  [`use-leave-request-form.ts:94`](../../apps/web/src/features/leave/hooks/use-leave-request-form.ts#L94)

- Cost, the in-year charge, the balance after it, and the warnings that never block.
  [`leave-request-form.tsx:114`](../../apps/web/src/features/leave/components/leave-request-form.tsx#L114)

**Godišnji's list**

- The member branch gains the action, the one outcome line and the list.
  [`godisnji.tsx:136`](../../apps/web/src/pages/godisnji.tsx#L136)

- The withdrawal is gated and re-reads; a refusal names its range.
  [`use-my-leave-requests.ts:166`](../../apps/web/src/features/leave/hooks/use-my-leave-requests.ts#L166)

- Each row shows its status in words in a badge; only a pending row offers withdraw.
  [`my-leave-requests.tsx:80`](../../apps/web/src/features/leave/components/my-leave-requests.tsx#L80)

**Cache, offline and invalidation**

- A pending request derives nothing, so a write re-reads only the requests.
  [`dependents.ts:129`](../../apps/web/src/features/teams/services/dependents.ts#L129)

- The requests join the member's Godišnji snapshot, and Danas deliberately does not read them.
  [`surface-keys.ts:36`](../../apps/web/src/features/leave/services/surface-keys.ts#L36)

- The requests are kept on the device for offline reads.
  [`persistence.ts:120`](../../apps/web/src/lib/offline/persistence.ts#L120)

**Docs**

- The inventory has a new *Request leave* row.
  [`EXPERIENCE.md:64`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L64)

- UX-DR31, 33 (19 surfaces) and 47 are rewritten as shipped fact.
  [`epics.md:156`](../planning-artifacts/epics.md#L156)

**Tests**

- E2E: send, the two overlaps, withdraw, statuses, the year boundary, offline, admin.
  [`leave-request.spec.ts:163`](../../e2e/tests/leave/leave-request.spec.ts#L163)

- The cleanup also deletes requests and decisions.
  [`database-helper.ts:389`](../../e2e/utils/database-helper.ts#L389)

- The offline write classifier now counts `withdraw_`.
  [`offline-write.spec.ts:67`](../../e2e/tests/offline/offline-write.spec.ts#L67)
