---
title: 'Split leave-requests.ts into a read and a write service (retro 8–9 item 20: S1, D4, D6, P1)'
type: 'refactor'
created: '2026-10-29'
status: 'done'
baseline_commit: 'db28768a597027e2f933326f0312141cd1f741c6'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `features/leave/services/leave-requests.ts` (833 lines) holds keys, statuses, two parser families, three reads, query options, three writes and their failure mappers, and breaks leave's own `leave-list` / `leave-write` split (S1). It also has two parsers for one row and two normalisers for one embed (D4). Four hooks wire the organization's request read the same way (D6). The decision screen's DOM ids live in a service that is public only for that reason (P1). Epic 10 builds on requests, so this is fixed first.

**Approach:** This is a pure refactor with no behaviour change. Split the file into `leave-request-list.ts` (read) and `leave-request-write.ts` (write), and split its test file the same way. Merge the parsers onto one row parse and one embed normaliser. Add one binding hook for the organization read, used by all four call sites. Move the review ids to `features/leave/utils/element-ids.ts`. Also mark retro item 16 as `done` in `sprint-status.yaml`, since #239 shipped it.

## Boundaries & Constraints

**Always:**
- Every exported name keeps its name, value and type; only its module changes. Query keys, columns, codes and the strings `console.error` logs stay byte-identical.
- The parsed shapes stay exact. `leaveRequestsOf` still returns `LeaveRequest` objects with no extra fields, so `toEqual` still holds.
- Every existing test assertion is kept, and moved to the test file of the module that now owns the subject.
- The public API in `eslint.config.js` is updated in the same change, with consumer comments.
- `leave-request-write.ts` imports from `leave-request-list.ts`, never the reverse (the same direction as `leave-list` → `leave-write` for `leaveRangeOf`).

**Ask First:** Any change to what a parser accepts or refuses, other than the one case the Design Notes allow.

**Never:**
- No re-export shim at `leave-requests.ts`. The old file is deleted and every importer is updated.
- No new behaviour, copy, migration or query.
- Out of scope:
  - D5: SQLSTATE mapping and the `isRecord` copies (deferred);
  - P2: failure-code spelling (accepted);
  - the other DOM ids in `leave-section.ts`, `my-leave.ts` and `leave-conflicts.ts`, which are not public.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/leave/services/leave-requests.ts` -- the source. Read side: lines 47–575 (keys, columns, statuses and types; `closedStatusOf` :158; `leaveRequestStatusOf` :183; `leaveRequestsOf` :208; `decisionRowOf` :269; `reviewedLeaveRequestOf` :287; `leaveRequestFoundOf`, `organizationLeaveRequestsOf`; the three row reads and the three query options). Write side: lines 577–833 (failure codes, RPC function names, the insert/withdraw/decide interfaces, the three failure mappers, `answeredErrorOf`, `sendLeaveRequest`, `withdrawLeaveRequest`, `decideLeaveRequest`).
- `apps/web/src/features/leave/services/leave-requests.test.ts` -- 573 lines, to be split by subject.
- Importers (27 files). Find them with `grep -rl "services/leave-requests'" apps/web/src`:
  - outside leave, read names only: `today/{hooks/use-admin-today,services/surface-keys}`, `conflicts/{hooks/use-conflicts-queue,hooks/use-conflict-resolution,services/conflicts-queue,services/resolved-conflicts,services/surface-keys(.test),components/resolved-list}`, `members/{hooks/use-member-status,services/deactivation-requests}`, `teams/services/dependents(.test)`, `lib/offline/persistence.test.ts`;
  - inside leave, write names: `hooks/use-my-leave-requests`, `use-leave-request-form`, `use-leave-request-review`, `services/my-leave(.test)`, `services/leave-request-review(.test)`.
- `apps/web/src/features/calendar/hooks/use-calendar-snapshot.ts` -- the "one binding" pattern to copy: an options function over `supabaseClient()` plus a `useQuery` hook. It is guarded by `calendar-layout.test.ts:84-108`.
- The duplicated organization-read wiring:
  - `today/hooks/use-admin-today.ts:99-103`;
  - `conflicts/hooks/use-conflicts-queue.ts:125-129`;
  - `conflicts/hooks/use-conflict-resolution.ts:193-197`;
  - `members/hooks/use-member-status.ts:186-191`, which spreads the options and adds `enabled`.
- `apps/web/src/features/leave/services/leave-request-review.ts:421-425` -- `LEAVE_REQUEST_REVIEW_HEADING_ID` and `_PREVIEW_ID`. They are used in `components/leave-request-review-body.tsx:15-16` and `pages/za-odluku.zahtjev.$requestId.tsx:5`.
- `apps/web/src/features/members/utils/element-ids.ts` -- the element-ids file convention (a header doc, then one constant per id).
- `eslint.config.js:262-275` -- the leave public API. Today it lists `'services/leave-requests'` (conflicts, members, teams, today) and `'services/leave-request-review'` (pages, for the heading id only).
- `apps/web/src/features/leave/leave-screen.fixture.ts:96-99` -- the source-guard entry naming `services/leave-requests.ts` and its test file.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `epic-9-retro-item-16-…` has `status: open`; `epic-9-retro-item-20-…` has `status: open`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/leave/services/leave-request-list.ts` -- create it with the read side: table, keys, columns, statuses, types, parsers, the three row reads and the three query options. One header doc replaces the per-story banners.
- [x] Same file -- merge D4 (see Design Notes). One `decisionsOf(embedded)` normaliser is used by both the status and the decision. One private `requestRowOf(row)` parses id, member, range, status and `closedAt`. `leaveRequestsOf` and `reviewedLeaveRequestOf` both build on it.
- [x] `apps/web/src/features/leave/services/leave-request-write.ts` -- create it with the write side. It imports statuses and types from the list module.
- [x] `apps/web/src/features/leave/services/leave-request-{list,write}.test.ts` -- split `leave-requests.test.ts` by subject, keeping every assertion. Then delete both old files.
- [x] `apps/web/src/features/leave/hooks/use-organization-leave-requests.ts` -- add `organizationLeaveRequestsReadOptions()` (the binding) and `useOrganizationLeaveRequests()`. Point the three hooks at the hook, and `use-member-status` at the options plus its `enabled`.
- [x] `apps/web/src/features/leave/utils/element-ids.ts` -- move both review ids here. Update the body component and the page.
- [x] Every importer -- repoint each import to the module that now owns the name, and update the three doc comments that name `.../leave-requests`.
- [x] `eslint.config.js`, `leave-screen.fixture.ts` -- update the public API:
  - replace `services/leave-requests` with `services/leave-request-list` (conflicts, members, teams, today);
  - add `hooks/use-organization-leave-requests` (conflicts, members, today);
  - replace `services/leave-request-review` with `utils/element-ids` (pages);
  - update the fixture entries.
- [x] `apps/web/src/features/leave/leave-layout.test.ts` (new; there is no leave layout test yet) -- add a one-binding guard modelled on `calendar-layout.test.ts:84-108`. `organizationLeaveRequestsQueryOptions(` may be called only in its definition and in the binding.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- set items 16 and 20 to `done`, each with a PR comment.

**Acceptance Criteria:**
- Given the refactor, when `grep -r "leave-requests'" apps/web/src` runs, then nothing is found and `leave-requests.ts` no longer exists.
- Given the split, when typecheck, lint and the unit suite run, then all pass and the test count is not lower than before.
- Given the four hooks, when they read the organization's requests, then each one goes through the binding, and the guard test pins this.
- Given the leave services, when they are grepped for `LEAVE_REQUEST_REVIEW_HEADING_ID`, then it is defined only in `utils/element-ids.ts`.

## Design Notes

**The one tolerated parse change.** The old `leaveRequestsOf` accepted a row whose `member_id` is `''` when the viewer's `memberId` was also `''`. The shared row parse refuses an empty member, so that case now returns null instead of a list. The viewer id always comes from the snapshot's uuid, so this cannot happen in practice. No other accept/refuse case changes.

```ts
function requestRowOf(row: unknown): (LeaveRequest & { readonly memberId: string }) | null
// leaveRequestsOf: requestRowOf(row) and memberId === viewer → { id, from, to, status, closedAt }
// reviewedLeaveRequestOf: requestRowOf(row) + created_at check + decision from decisionsOf(...)
```

## Verification

**Commands** (run from the worktree with the Node 24 PATH):
- `pnpm --filter ./apps/web typecheck` -- expected: no errors.
- `pnpm lint` -- expected: no errors, the public-API rule included.
- `pnpm --filter ./apps/web test` -- expected: all pass, and the count is not lower than on main.

## Suggested Review Order

**The read service and the merged parse (S1, D4)**

- One embed normaliser now feeds both the status and the decision.
  [`leave-request-list.ts:132`](../../apps/web/src/features/leave/services/leave-request-list.ts#L132)

- One row parse shared by the member list and the reviewed request.
  [`leave-request-list.ts:189`](../../apps/web/src/features/leave/services/leave-request-list.ts#L189)

- The member list builds on it, and keeps its exact output shape.
  [`leave-request-list.ts:210`](../../apps/web/src/features/leave/services/leave-request-list.ts#L210)

- The reviewed parse adds created_at and an explicit single-decision check.
  [`leave-request-list.ts:270`](../../apps/web/src/features/leave/services/leave-request-list.ts#L270)

**The write service**

- The write service imports only types from the read service, never the reverse.
  [`leave-request-write.ts:1`](../../apps/web/src/features/leave/services/leave-request-write.ts#L1)

**One binding for the organization read (D6)**

- The binding, modelled on useCalendarSnapshot.
  [`use-organization-leave-requests.ts:18`](../../apps/web/src/features/leave/hooks/use-organization-leave-requests.ts#L18)

- The member status hook spreads the options and keeps its own enabled.
  [`use-member-status.ts:183`](../../apps/web/src/features/members/hooks/use-member-status.ts#L183)

- The three other sites use the hook.
  [`use-admin-today.ts:95`](../../apps/web/src/features/today/hooks/use-admin-today.ts#L95)

**Element ids (P1) and peripherals**

- The review ids now live in utils, which is public to pages.
  [`element-ids.ts:8`](../../apps/web/src/features/leave/utils/element-ids.ts#L8)

- A guard pins the one binding, the read call and the key.
  [`leave-layout.test.ts:28`](../../apps/web/src/features/leave/leave-layout.test.ts#L28)

- The public API is updated.
  [`eslint.config.js:265`](../../eslint.config.js#L265)
