---
title: '8.2c Admin work surfaces read offline'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '2aab34fb3817e84c332a9f0ae3f22c6cda3cb77c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-2b-member-surfaces-read-offline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An admin's work surfaces still treat a paused read as unavailable. Raspored (including the *Riješeni* tab), the resolution page `/raspored/$memberId/$date/$teamId` and the member page `/ljudi/$id` are unreadable without a connection, even when they were read online.

**Approach:** Apply the 8.2b recipe to these three surfaces:
- `surface-keys.ts` with a persisted test;
- `useSnapshotFreshness(keys, observed, ZONE_FROM_CALENDAR)`;
- `answerOf`/`answerFor`;
- the `offlineNoteOf` gate;
- an `OfflineNote` under the heading.

Then persist the keys they add and make their routes offline-readable.

## Boundaries & Constraints

**Always:**
- The rules from 8.2 and 8.2b hold unchanged: one snapshot per surface, the zone chain (here always the calendar), no data drawn without the note, owner-scoped persistence, and the 30-day per-entry limit.
- **Raspored** `/raspored`. `rasporedSurfaceKeysOf(tab)`: calendar, organization leave records and organization resolutions. The *Riješeni* tab adds `acting-admin-names`, read through `answerFor`. The note sits under the page heading on both tabs.
- **Resolution page.** The keys are calendar, organization leave records, organization resolutions, `members` and `organization`. All are already persisted. `resolutionScreenOf` receives the answered reads, not the raw ones.
- **Member page** `/ljudi/$id`. `memberPageSurfaceKeysOf(id)` is the union of what `useMemberEdit` and `useMemberLeave` read:
  - `members`, `calendar`, `organization`, `session-subject`, `teams`;
  - `LEAVE_RECORDS_KEY(id)`;
  - organization resolutions.

  Both hooks call `useSnapshotFreshness` with the same key set, so the page decides as one. The note goes once, under the page's own `PageHeader`.
- **Persistence.** New one-segment root: `acting-admin-names`. New parameterised root: `leave-records`, kept only as `[root, non-empty id]`. The erasure-check part stays rejected.
- **Readable paths.** Add `/raspored`, `/raspored/$memberId/$date/$teamId` and `/ljudi/$id`. A `$` segment never matches a static sibling route registered at the same level, so `/ljudi/novi` and `/ljudi/smjene` are not matched by `/ljudi/$id`. A router test derives those siblings from `routesByPath`.
- Erasure reads (`useErasureReads`, the rotation erasure check) are untouched. Offline they already refuse a write with `CHECK_UNAVAILABLE` and never affect render or freshness.

**Ask First:**
- Any surface needing a key with more than one parameter.
- Any change to the write paths (8.3).

**Never:**
- Organizacija, Satni pojasi, Postavke rotacije (including shift types) and Ljudi/smjene. These are 8.2d (human decision 2026-10-21, 1a), which includes the Organizacija retry-offline decision (2a).
- Refusing writes offline (8.3), or persisting erasure reads.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Raspored offline | The queue was read online | The queue renders whole, with the note | — |
| *Riješeni* offline, unread | The tab was never opened online | Unavailable, with no note | — |
| Resolution offline | Its five reads are cached | The page renders with the note. Saving still refuses through the existing write failure | — |
| Member page offline | Both hooks' keys are cached, including `leave-records/<id>` | The page renders once, with one note | — |
| Member page, leave never read | `leave-records/<id>` is missing | The whole page is unavailable, never half drawn | — |
| `/ljudi/novi` offline | Readable-path check | Not offline-readable; it keeps the strict guard | — |

## Epic AC Deviations

- **"Given a surface was read online / When it opens offline / Then it renders its last snapshot whole…"** Still NARROWED. This story adds Raspored, the resolution page and the member page. The settings surfaces are DEFERRED to 8.2d (`deferred-work.md`, human decision 2026-10-21, 1a).

</frozen-after-approval>

## Code Map

- `lib/offline/use-snapshot-freshness.ts:87`, `lib/offline/freshness.ts:123-136,146,167,201` -- the hook, `NoteZone`, `notedFreshnessOf`, `offlineNoteOf` and `snapshotAnswerOf`. Reuse them unchanged.
- `features/today/hooks/use-admin-today.ts:93-104` -- the pattern for two hooks sharing one surface.
- `features/conflicts/hooks/use-conflicts-queue.ts:65,99-123` -- Raspored's reads. `ACTING_ADMINS_KEY` is at `resolved-conflicts.ts:95` (`enabled: tab === TAB_RESOLVED`, :282). The states are `conflicts-queue.ts:53,293` and `resolved-conflicts.ts:296,345`.
- `features/conflicts/hooks/use-conflict-resolution.ts:128,160-173` and `services/resolution-screen.ts:114,116,406,427` -- the resolution page, which uses `members.paused` and `refetchingAfterFailure` over the raw reads.
- `features/members/hooks/use-member-edit.ts:91,97-125` and `features/leave/hooks/use-member-leave.ts:164,234-252` (mounted in `leave/components/member-leave-card.tsx:58`) -- the member page. `LEAVE_RECORDS_KEY` is at `leave-list.ts:30`, with its paused rule at :222.
- Pages: `pages/raspored.tsx:32`, `pages/raspored.$memberId.$date.$teamId.tsx:31`, `pages/ljudi.$id.tsx:42-75` (a custom `PageHeader`).
- `lib/offline/persistence.ts` ~:94 and ~:123, with tests at `persistence.test.ts:104,125` (`toEqual`).
- `lib/offline/readable-paths.ts:14`, `router.test.ts:1578,1590-1597`. The `/ljudi/smjene` and `/ljudi/novi` assertions must stay false, and the "unlisted admin path" example moves to an 8.2d route.
- Registration: `features/conflicts/conflicts-screen.fixture.ts` gets an exemption for `services/surface-keys.ts`. The leave and members `surface-keys.ts` files are already exempt or not swept. Re-run `structural-pins-*` after the rewiring.

## Tasks & Acceptance

**Execution:**
- [x] `lib/offline/persistence.ts` (+ test) -- `acting-admin-names` and the `leave-records` parameterised root.
- [x] `lib/offline/readable-paths.ts` (+ `router.test.ts`) -- the three patterns and the static-sibling exclusion.
- [x] `features/conflicts/services/surface-keys.ts` (+ test), `use-conflicts-queue.ts`, `use-conflict-resolution.ts`, `resolution-screen.ts` call sites -- Raspored and the resolution page. Update the fixture.
- [x] `features/members/services/surface-keys.ts` (extend it, + test), `use-member-edit.ts`, `use-member-leave.ts` -- the member page as one surface.
- [x] `pages/raspored.tsx`, `raspored.$memberId.$date.$teamId.tsx`, `ljudi.$id.tsx` -- `OfflineNote` under the heading.
- [x] `e2e/tests/offline/offline-read.spec.ts` -- as admin: Raspored online → offline shows the note; open a resolution page and a member page online → offline shows the note; reconnect removes it.
- [x] Docs:
  - spine: a new dated AD-13 amendment line for 8.2c;
  - `EXPERIENCE.md`: the Offline bullet's surface list;
  - `deferred-work.md`: the 8.2d entry already exists; the Q24 accepted-risk entry adds `leave-records` and `acting-admin-names`.

**Acceptance Criteria:**
- Given an admin read Raspored, a resolution page and a member page online, when the network drops, then each reopens with the note and none shows unavailable.
- Given `pnpm test`, `lint`, `typecheck` and the offline and today e2e tests, when they run, then all pass.

## Spec Change Log

- 2026-10-21, review loop 0 (patches, no frozen change). The shared helper `utils/focus-later.ts` changed in 8.2c, outside the Code Map. Cause: the member page now decides as one with the leave card, so `useMemberEdit` re-renders the whole page with the leave card's reads. That heavier render exposed an existing race in `e2e/tests/people/leave.spec.ts`. After a write, `focusLater` tried to focus a target that was still inside a disabled `<fieldset>` (its own `disabled` is false), or still inert behind a modal `<dialog>` that closes only in a later effect. `focus()` did nothing, and focus fell to the body. The fix: a `:disabled` target is not ready; a `focus()` that did not take (the active element is neither the target nor inside it) is tried again on the next frame, and on the last frame the fallback takes it; if somebody else moved focus to another element meanwhile, the retries stop. KEEP the rest of the implementation.

## Verification

**Commands:**
- `pnpm --filter @shift/web build && pnpm test && pnpm lint && pnpm typecheck` -- expected: green.
- `pnpm test:e2e e2e/tests/offline e2e/tests/today` -- expected: green.

## Suggested Review Order

**The member page as one surface**

- Entry point: the union of both hooks' reads, `leave-records/<id>` included.
  [`surface-keys.ts:32`](../../apps/web/src/features/members/services/surface-keys.ts#L32)

- Member edit decides over the union and owns the page's one note.
  [`use-member-edit.ts:136`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L136)

- The leave card decides over the same set. Its fetch flags stay on the raw observers.
  [`use-member-leave.ts:264`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L264)

- One note under the page's own header.
  [`ljudi.$id.tsx:79`](../../apps/web/src/pages/ljudi.$id.tsx#L79)

**Raspored and the resolution page**

- Keys depend on the tab: *Riješeni* adds `acting-admin-names`.
  [`surface-keys.ts:19`](../../apps/web/src/features/conflicts/services/surface-keys.ts#L19)

- The queue reads the actors through `answerFor`. Skew in the reconnect window shows loading.
  [`use-conflicts-queue.ts:132`](../../apps/web/src/features/conflicts/hooks/use-conflicts-queue.ts#L132)

- The resolution page gets answered reads, and shows no note over a landed save.
  [`use-conflict-resolution.ts:190`](../../apps/web/src/features/conflicts/hooks/use-conflict-resolution.ts#L190)

**Routes and persistence**

- `$` never reads a static sibling, and a listed static path wins (ready for 8.2d).
  [`readable-paths.ts:78`](../../apps/web/src/lib/offline/readable-paths.ts#L78)

- `leave-records` joins `team-roster` as a parameterised root.
  [`persistence.ts:13`](../../apps/web/src/lib/offline/persistence.ts#L13)

**Outside the surfaces**

- `focusLater`: falls back on the last frame, accepts delegated focus, and never steals the user's focus (see the Spec Change Log).
  [`focus-later.ts:82`](../../apps/web/src/utils/focus-later.ts#L82)

**Docs**

- The AD-13 amendment for 8.2c.
  [`ARCHITECTURE-SPINE.md:141`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L141)

**Tests**

- Offline e2e: Raspored on both tabs, a real open conflict, a member page whole or unavailable.
  [`offline-read.spec.ts:1`](../../e2e/tests/offline/offline-read.spec.ts#L1)
