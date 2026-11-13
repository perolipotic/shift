---
title: 'A1: a device snapshot of an older mapped shape is never restored'
type: 'bugfix'
created: '2026-11-13'
status: 'done'
review_loop_iteration: 0
baseline_commit: '4930442368eb1e3810bbccaaedc966da26822729'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The device snapshot (`lib/offline/persistence.ts`) keeps *mapped* rows, and its TanStack `buster` is only the auth user id. A `['members']` entry saved before 13.3 has no `leaveYearStart` or `leaveAllowance`. Restored for up to 30 days, it makes `memberAllowanceOn` call `leaveYearNumberOf(today, undefined)`, and `checkLeaveYearStart` throws during render. The member page shows the error boundary until a refetch (epic 13 retro B1, action A1).

**Approach:** Put a shape version in the buster: `"<DEVICE_SNAPSHOT_SHAPE>:<userId>"`. A snapshot written under any other buster, including every existing bare-user-id snapshot, is deleted on restore, as another user's is today. Bump the constant whenever a persisted entry's mapped shape changes. That rule is written on the constant.

## Boundaries & Constraints

**Always:**
- The owner check stays exact. A restore for user B never hydrates A's snapshot under any shape.
- Every buster comparison and every buster write goes through one helper. That covers the save, the subscribe, the restore check and the serialize guard.
- The e2e `deviceSnapshotOf(...).owner` still returns the bare auth user id. `sign-out-clears.spec.ts` checks the id does not appear in another account's queries, and that check must keep its strength.

**Ask First:** making the readers of mapped rows tolerant as well (`== null` in `memberAllowanceOn`, `write.ts:750`, `leave-overview.ts`, `my-leave.ts`).

**Never:**
- Change `DEVICE_SNAPSHOT_KEY`. That would orphan the old blob, with another user's data in it, in IndexedDB.
- Touch the DB, migrations, or DB-connecting root tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same shape, same user | Saved as `"<shape>:a"`, restore for `a` | Hydrated, then marked stale | N/A |
| Older shape (pre-fix blob) | Stored buster `"a"` (bare id), restore for `a` | Nothing hydrated; the copy is deleted | N/A |
| Other user | Saved as `"<shape>:a"`, restore for `b` | Nothing hydrated; the copy is deleted (unchanged) | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/lib/offline/persistence.ts` -- the buster lives here:
  - the doc block "WHOSE IT IS" (~L23);
  - the `serialized` guard (L330);
  - `flush` (L377);
  - `persistQueryClientSubscribe({ buster: owner })` (L396);
  - the restore check `persisted.buster !== userId` (L444).
  - `owner` stays the bare user id; only the buster becomes the shaped string.
- `apps/web/src/lib/offline/persistence.test.ts`:
  - `stored()` (L84-93) reads `parsed.buster` as the owner;
  - L583 asserts `not.toContain('"buster":"member-a"')`, which goes vacuous unless it is updated to the shaped form;
  - `savedBy` and the "restores nothing for another user" test (L276) are the pattern for the new tests.
- `e2e/utils/offline.ts:58-121` -- `deviceSnapshotOf` maps `buster` to `owner`; it strips the shape prefix.
- Read-only evidence of the crash path:
  - `features/members/services/list.ts:696-718` (`leaveYearStartIn`, `memberAllowanceOn`);
  - `packages/domain/src/leave.ts:322`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/lib/offline/persistence.ts`:
  - Export `DEVICE_SNAPSHOT_SHAPE` (a positive integer, starting at 2), with a doc comment carrying the bump rule and naming 13.3's `leaveYearStart` as the case it fixes.
  - Export `snapshotBusterOf(userId)`, and use it at all four buster sites.
  - Update the "WHOSE IT IS" doc.
- [x] `apps/web/src/lib/offline/persistence.test.ts`:
  - `stored()` returns the owner parsed out of the shaped buster.
  - Fix L583 to the shaped form.
  - Add the "older shape" matrix row: write a blob with the bare id as its buster straight into storage, holding a `['members']` row without `leaveYearStart`. Restore for that id. Assert nothing is hydrated and the key is deleted.
  - Add a test that a saved blob's buster equals `snapshotBusterOf(owner)`.
- [x] `e2e/utils/offline.ts` -- the owner is the buster after the last `:`, and the doc comment says why.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- mark action item A1 `done`.

**Acceptance Criteria:**
- Given a member whose device holds a snapshot saved before this change, when the app loads, then the snapshot is deleted, no screen hydrates from it, and the page renders from fresh reads.

## Design Notes

A buster version beats tolerant readers. The mapped rows have at least four readers, and any later shape change would need the same audit. The buster fixes the whole class at one site, at the cost of a single cold start per device after the upgrade. Under `registerType: 'prompt'` the new bundle can take over on a load made offline, so a member can lose offline reading until they are next online. The same applies while an old and a new bundle run at once: each deletes the other's blob on restore. Both cost offline reading, never correctness (review, 2026-11-13).

## Verification

**Commands:**
- `pnpm --filter ./apps/web exec vitest run src/lib/offline` -- expected: all pass.
- `pnpm --filter ./apps/web typecheck && pnpm lint` -- expected: clean.
- e2e (`sign-out-clears`, `organization-switch`) -- CI is the gate.

## Suggested Review Order

**The shaped buster**

- The shape version and its bump rule; it starts at 2 because bare ids were shape 1.
  [`persistence.ts:84`](../../apps/web/src/lib/offline/persistence.ts#L84)

- The one place a buster is built.
  [`persistence.ts:93`](../../apps/web/src/lib/offline/persistence.ts#L93)

- The restore check: another shape is deleted just as another user's is.
  [`persistence.ts:482`](../../apps/web/src/lib/offline/persistence.ts#L482)

- The save sites and the serialize guard go through the helper.
  [`persistence.ts:368`](../../apps/web/src/lib/offline/persistence.ts#L368)
  [`persistence.ts:415`](../../apps/web/src/lib/offline/persistence.ts#L415)
  [`persistence.ts:434`](../../apps/web/src/lib/offline/persistence.ts#L434)

**Tests and e2e**

- A pre-13.3 members row under a bare-id buster is neither hydrated nor kept.
  [`persistence.test.ts:324`](../../apps/web/src/lib/offline/persistence.test.ts#L324)

- Earlier and later shaped busters are rejected too.
  [`persistence.test.ts:345`](../../apps/web/src/lib/offline/persistence.test.ts#L345)

- Forget still rejects both bare and shaped writes of the previous owner.
  [`persistence.test.ts:656`](../../apps/web/src/lib/offline/persistence.test.ts#L656)

- e2e fails loudly on an unshaped buster; the owner stays the bare id.
  [`offline.ts:128`](../../e2e/utils/offline.ts#L128)
