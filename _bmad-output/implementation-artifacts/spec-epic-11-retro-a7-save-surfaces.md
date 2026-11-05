---
title: 'Epic 11 retro A7: the short-staffed block on the rotation cancel and the override review'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: 'e49066de77b3f613051d4df1c04abd3d1b9ea0b4'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-11-2-every-save-that-can-cause-it-shows-a-short-staffed-shift.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two saves can newly leave a working shift short of people, but they show no short-staffed block:
- the rotation cancel (5.5g);
- the override review *Izmjene za pregled* (3.5c, 5.5h), on confirm and amend.

11.2 deferred both. Retro A7 (sprint-status item 42) owns them.

**Approach:** Reuse 11.2's `configurationReportOf` over the cached calendar, diffed against the "after" each erasure check already builds, and draw the existing `ShortStaffedBlock`. The product owner decided placement on 2026-11-05 (deferred-work entry "Deferred from: planning of spec-epic-11-retro-followups.md").

## Boundaries & Constraints

**Always:**
- **Cancel:** the block sits in the cancel `ConfirmDialog` above its footer, in a polite live region that is always mounted.
  - The after is `cancelledCalendarSnapshotOf(calendar, scheduled)`, over `horizonWindowOf(scheduled)` (366 days).
  - The calendar snapshot is observed while the cancel is shown (`cancelShown`), as well as while `unsaved`.
- **Review rows:** each pending row whose confirm is offered gets a compact block under it, in its own polite live region.
  - It shows only when that row's confirm would newly leave a shift short (a known report with rows).
  - The after is `overrideChangeSnapshotOf` / `rosterChangeSnapshotOf` with the CONFIRM change, over `dayWindowOf(row.isoDate)`.
- **Amend dialog:** shows its own block, recomputed from the currently chosen type or member (the AMEND change). It shows the unknown line too.
- **Discard:** shows nothing.
- **Empty setting:** the report is `null`, and no leave is read.
- **Never a gate:** no button, latch or write path changes.
- **Calendar pending or failed:** the report is `null` on every surface (the R1 rule from #273).
- **Write refusals:** a change the write would refuse anyway (`gone`, `archived`, `taken`, `sameAsProjected` in the cached calendar) gives `null`.
- **Unknown:** a `RangeError` building the after, or the rotation and calendar disagreeing on the scheduled versions or active teams, gives unknown (logged).
- **Pure models:** every decision is a pure `.ts` function, tested in node under both staffing fixtures (AD-15). Hooks only wire.

**Ask First:**
- Changing a write path or the erasure dialogs.
- Adding a heading (*Što se mijenja*) to these surfaces.
- A new token or contrast case.

**Never:**
- Staffing arithmetic outside `domain/staffing` (AD-7).
- A new e2e, or a local e2e run.
- A migration or `db reset`.
- Blocking a save.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|----------|--------------|---------------------------|
| Cancel makes a shift short | min 3, the reverted version puts a team with 2 on leave on a working day | block row `rade 2 od najmanje 3` |
| Cancel, setting empty | minimum `null` | `null`; the leave source is never consulted |
| Cancel, calendar pending or failed | read pending or `isError` | `null` |
| Cancel, leave pending | calendar in, min set | the unknown line |
| Cancel, versions disagree | calendar and rotation differ on `scheduled` | unknown, logged |
| Row confirm makes a shift short | a pending type or roster override leaves 2 at work | that row's block |
| Row confirm, no change in staffing | nothing newly short | no block |
| Row, leave unknown | leave pending | no row block |
| Row gone from the cached calendar | override id missing | no block |
| Amend to another type or member | the choice changes | the block is recomputed |
| Amend to the projected type | `sameAsProjected` | `null` |

## Epic AC Deviations

- 11.2, *"Then *Što se mijenja* shows a block … from the same 'after' snapshot as its erasure check"*: **Reinterpreted** for the two surfaces 11.2 deferred. Neither has a *Što se mijenja*, so the block sits in the cancel confirmation, under each review row and in the amend dialog, as the product owner placed it (2026-11-05). The after is the erasure check's own builder, over the cached calendar, as on every 11.2 surface.
- 11.2/UX-DR23 unknown line: **Narrowed** — a review row shows nothing while the leave is unknown (product owner, 2026-11-05); the cancel and the amend dialog show it.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/staffing/services/short-staffed.ts`: the pieces to reuse:
  - `configurationReportOf`, `horizonWindowOf`, `dayWindowOf`, `unknownReportOf`;
  - `shortStaffedShownOf`, `minimumOfCalendar`.
- `apps/web/src/features/staffing/components/short-staffed-block.tsx`: `ShortStaffedBlock`, used unchanged.
- `apps/web/src/features/staffing/hooks/use-staffing-leave.ts`: `useStaffingLeave(calendar)` reads only while an admin's minimum is set.
- `apps/web/src/features/rotation/services/erasures.ts`:
  - `:158` `draftShortStaffedOf` and `:216` `builderShortStaffedOf`, the pattern to mirror;
  - `:201` `builderCalendarOf(shown, read)` gives the calendar only while it is in;
  - `:245` `cancelledCalendarSnapshotOf`;
  - `:287` `rotationCancelErasuresOf` holds the scheduled-versions agreement check, to extract into a helper both use.
- `apps/web/src/features/rotation/hooks/use-draft-short-staffed.ts`: the hook pattern (calendar `useQuery` + leave + `useMemo`).
- `apps/web/src/features/rotation/hooks/use-rotation-builder.ts`:
  - `:300` the draft hook call;
  - `:882` `cancelShown`, `scheduled`;
  - `:901` the return object.
- `apps/web/src/features/rotation/components/rotation-notices.tsx:92-160`: `renderCancelConfirmation`. The block goes before `DialogFooter`.
- `apps/web/src/features/calendar/utils/change-preview.ts:245`: the private `dayReportOf`. Export it and reuse it for the review.
- `apps/web/src/features/rotation/services/override-review-erasures.ts`: `reviewedConfirmChangeOf` / `reviewedAmendChangeOf`, the layer-tagged changes.
- `override-erasures.ts:157` `overrideChangeSnapshotOf` and `roster-erasures.ts:133` `rosterChangeSnapshotOf` both accept CONFIRM and AMEND.
- `apps/web/src/features/rotation/services/override-disposition.ts`: `ReviewRow` (`isoDate`, `layer`), `reviewOffersOf`.
- `apps/web/src/features/rotation/hooks/use-override-review.ts`: state; `typeField` is uncontrolled.
- `apps/web/src/features/rotation/components/override-review.tsx`:
  - `:162` `renderRow`;
  - `:257` `renderAmend`; the Select is at `:302`, the form `onChange` at `:295`.
- `apps/web/src/features/staffing/surfaces.test.ts` + `staffing.fixture.ts`: the both-fixture suite. `rotation/rotation.fixture.ts` builds rotation snapshots.

## Tasks & Acceptance

**Execution:**
- [x] `rotation/services/erasures.ts`: add `cancelShortStaffedOf(calendarRead, rotation, scheduled, leave)`, and extract the shared scheduled-versions check.
- [x] `rotation/hooks/use-cancel-short-staffed.ts` (new): wiring, enabled by `cancelShown`. Expose it from `use-rotation-builder.ts` as `cancelShortStaffed`.
- [x] `rotation-notices.tsx`: a polite region with `ShortStaffedBlock` in the cancel dialog.
- [x] `calendar/utils/change-preview.ts`: export `dayReportOf`. No behaviour change.
- [x] `rotation/services/override-review-short-staffed.ts` (new):
  - `reviewRowShortStaffedOf(calendar, row, leave)`: only known reports with rows, and only when confirm is offered;
  - `reviewAmendShortStaffedOf(calendar, row, choiceId, leave)`.
- [x] `rotation/hooks/use-override-review.ts`:
  - observe the calendar while rows exist, and the leave;
  - memoize the per-row reports by id;
  - track the amend's chosen id (the Select stays uncontrolled; its change updates it; it starts at the defaults);
  - expose both reports.
- [x] `override-review.tsx`: a per-row polite region under each row's controls, and one in the amend form above its footer.
- [x] `staffing/surfaces.test.ts`: cover the matrix under both fixtures, with empty-setting cases using the untouchable leave source.
- [x] Docs:
  - DESIGN.md Dialog row (`:349`) and EXPERIENCE.md's review and cancel lines: name the two surfaces.
  - `deferred-work.md`: mark the 11.2-planning entry and the A7 entry RESOLVED; add the cancel and the override review to the 11.2 browser-coverage entry.
  - `sprint-status.yaml`: item 42 → `done`.

**Acceptance Criteria:**
- Given an admin with the minimum set, when the cancel confirmation or a review row would newly leave a shift short, then the block names it and every save button behaves exactly as before.
- Given *Najmanje ljudi u smjeni* empty, when either surface renders, then no block, no line and no leave read.

## Spec Change Log

## Design Notes

- **Per-row unknown:** a review row shows nothing while the leave is unknown, because the product owner's wording is "only when that row's confirm would newly make a shift short". The amend dialog and the cancel show the unknown line, as every 11.2 dialog does.
- **Contrast:** the cancel `ConfirmDialog` is glass. The block's border on that glass is already the recorded shortfall in `theme-contrast.test.ts` (A6 review), so there is no new case.
- **Epic context:** `epic-11-context.md` is older than #273's planning edits (warning off glass). Those edits are read directly, and regenerating the file is item 36 (A1), out of scope.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck`: green.
- `pnpm --filter @shift/domain test && pnpm --filter ./apps/web test && pnpm --filter ./apps/web build`: green.
- `pnpm test` (root): green, except DB tests that need 0048 if the shared stack still lacks it.

## Suggested Review Order

**Rotation cancel**

- Entry point: the cancel's report, null until the calendar is in, unknown on disagreement.
  [`erasures.ts:353`](../../apps/web/src/features/rotation/services/erasures.ts#L353)

- One agreement check, shared with the cancel's erasure check.
  [`erasures.ts:285`](../../apps/web/src/features/rotation/services/erasures.ts#L285)

- Calendar observed only while the cancel confirmation is shown.
  [`use-cancel-short-staffed.ts:22`](../../apps/web/src/features/rotation/hooks/use-cancel-short-staffed.ts#L22)

- Wired from the builder with the armed date.
  [`use-rotation-builder.ts:885`](../../apps/web/src/features/rotation/hooks/use-rotation-builder.ts#L885)

- Polite region above the cancel dialog's footer.
  [`rotation-notices.tsx:136`](../../apps/web/src/features/rotation/components/rotation-notices.tsx#L136)

**Override review**

- A row shows a block only for a known, newly short confirm.
  [`override-review-short-staffed.ts:64`](../../apps/web/src/features/rotation/services/override-review-short-staffed.ts#L64)

- The amend's block follows the chosen type or member; unknown line allowed.
  [`override-review-short-staffed.ts:105`](../../apps/web/src/features/rotation/services/override-review-short-staffed.ts#L105)

- The day detail's own report, now exported for reuse.
  [`change-preview.ts:247`](../../apps/web/src/features/calendar/utils/change-preview.ts#L247)

- Calendar read while rows are listed; reports memoized per read.
  [`use-override-review.ts:238`](../../apps/web/src/features/rotation/hooks/use-override-review.ts#L238)

- The amend's choice is tied to its opening; the Select stays uncontrolled.
  [`use-override-review.ts:243`](../../apps/web/src/features/rotation/hooks/use-override-review.ts#L243)

- One opening rule for the fields and the block.
  [`override-disposition.ts:436`](../../apps/web/src/features/rotation/services/override-disposition.ts#L436)

- Per-row and amend-dialog polite regions.
  [`override-review.tsx:233`](../../apps/web/src/features/rotation/components/override-review.tsx#L233)
  [`override-review.tsx:353`](../../apps/web/src/features/rotation/components/override-review.tsx#L353)

**Tests and config**

- Both fixtures: cancel matrix, horizon and before-scheduled cases.
  [`surfaces.test.ts:359`](../../apps/web/src/features/staffing/surfaces.test.ts#L359)

- Both fixtures: review rows and amend matrix.
  [`surfaces.test.ts:490`](../../apps/web/src/features/staffing/surfaces.test.ts#L490)

- Structural pin now allows exactly the calendar read.
  [`structural-pins-members.test.ts:801`](../../apps/web/src/pages/structural-pins-members.test.ts#L801)

- change-preview made a public calendar module for rotation.
  [`eslint.config.js:189`](../../eslint.config.js#L189)
