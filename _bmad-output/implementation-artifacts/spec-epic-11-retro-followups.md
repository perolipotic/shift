---
title: 'Epic 11 retro follow-ups A2 and A6: the empty-setting line, the import cycle, warning off glass'
type: 'bugfix'
created: '2026-11-05'
status: 'done'
baseline_commit: 'b276c70b48402814e4457b22fd5d758db3ec174c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-retro-2026-11-05.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Epic 11 retro left two fixes:
- **A2:** two defects.
  - **R1:** the rotation builder shows *Što se mijenja* and `Popunjenost smjena sada ne mogu provjeriti.` while its calendar read is pending or failed, even when *Najmanje ljudi u smjeni* is empty.
  - **R2:** `calendar/utils/month.ts` and `staffing/services/short-staffed.ts` import each other.
- **A6:** light `warning` glyphs sit on the Dialog's glass at 2.89–2.96:1 (S3).

**Approach:**
- **A2:**
  - The hook returns `null` until the calendar is in.
  - month.ts stops importing staffing, and one input recipe remains.
- **A6** (product owner option b, 2026-11-05):
  - The day-detail line, the resolution strip and the *Danas* card draw their glyph in `foreground`.
  - `warning` stays on the cell bar, the short-staffed block (border and glyph) and the card's left edge.
  - The edge is measured and pinned.

## Boundaries & Constraints

**Always:**
- **R1:** `useDraftShortStaffed` returns `null` while the calendar snapshot is pending, failed or absent.
  - It returns the unknown line only when the snapshot is in, the minimum is set and the leave is not known.
  - The decision is a pure function in a `.ts` file, tested there. AD-15 bans jsdom.
- **R2:** `month.ts` imports no module that imports `month.ts` again, directly or transitively.
  - `staffingInputOf` and `collisionInputOf` both spread `snapshotScheduleInputOf`.
  - `minimumOfCalendar` sits beside `calendarMinimumMembersOf`.
  - Behaviour does not change.
- **A6:** the three glyphs use `text-foreground`.
  - The block's glyph, on the opaque `muted` fill, keeps `warning`.
  - No token value changes.
- **Card edge:** the card is the opaque `bg-card`.
  - Its 4 px `warning` edge is held to 3:1 against `card` in both themes.
  - Against the page composited with each blob, the edge is recorded at its measured ratios as a known shortfall. The test fails if the shortfall closes or widens.

**Ask First:** retuning `warning` or adding a token.

**Never:**
- No staffing arithmetic outside `domain/staffing` (AD-7).
- No migration, no `db reset`, no local e2e.
- No A7 work: it is split into `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Empty, calendar pending | unsaved draft, calendar pending | `null`: no heading, no line | N/A |
| Calendar failed | unsaved draft, read failed (any minimum) | `null` | the read logs its own failure |
| Set, leave pending | calendar in, minimum 3, leave pending | the unknown line | N/A |
| Empty, calendar in | minimum `null` | `null` | N/A |
| No draft | `unsaved` false | `null` | N/A |

## Epic AC Deviations

- 11.3, *"the `warning` token is defined in light and dark and contrast-verified"*: **Reinterpreted** (product owner, 2026-11-05, option b).
  - `warning` is no longer drawn on glass.
  - It is verified on every surface it is still drawn on: cell fills, `card`, `muted`, and the *Danas* card's edge against `card`.
  - The edge's page-side shortfall over the blobs is recorded, not fixed.

</frozen-after-approval>

## Code Map

**R1**
- `apps/web/src/features/rotation/hooks/use-draft-short-staffed.ts:29-40`: the early `SHORT_STAFFED_UNKNOWN_REPORT`.
- `rotation/services/erasures.ts:158` `draftShortStaffedOf` already returns `null` for a null calendar or an empty minimum.

**R2**
- `calendar/utils/month.ts:57` is the staffing import, used at `:1328`.
- `month.ts:1053` `snapshotScheduleInputOf` returns exactly the fields `collisionInputOf` picks.
- `staffing/services/short-staffed.ts:107-132` holds `minimumOfCalendar` and `staffingInputOf`. The latter goes via `conflicts/services/conflicts-queue.ts:275` `collisionInputOf`, and conflicts-queue imports month.ts.
- A re-export from short-staffed.ts keeps its 9 importers unchanged.
- `calendar/services/snapshot.ts:386` `calendarMinimumMembersOf`.

**A6**
- The glyphs:
  - `calendar/components/day-detail-dialog.tsx:120`
  - `conflicts/components/resolution-option.tsx:70`
  - `today/components/short-staffed-card.tsx:55`; its edge at `:51` stays.
- `test/theme-contrast.test.ts`:
  - `:1500-1535`: the 11.3 panel-glyph pair, to be replaced.
  - `:702-750`: 11.3's `warning` block.
  - `:1098`: page and blob backdrops (`backdrops`).

**Docs**
- DESIGN.md `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md:279` §Warning.
- `epics.md:121` UX-DR4 and `:182` UX-DR48.
- `deferred-work.md`: the 11.3-review and 11.4-review entries.

## Tasks & Acceptance

**Execution:**
- [x] `rotation/hooks/use-draft-short-staffed.ts` + `rotation/services/erasures.ts` (+test): extract the decision into a pure function; the hook only wires it. Test the matrix.
- [x] month.ts / snapshot.ts / short-staffed.ts / conflicts-queue.ts: make the R2 move. short-staffed.ts re-exports both helpers.
- [x] `test/import-cycles.test.ts` (new): walk the `@/` imports from `month.ts` and assert that it is never reached again. Include a non-vacuity case.
- [x] The three A6 components: change the glyph to `text-foreground` and update their doc comments.
- [x] `test/theme-contrast.test.ts`:
  - Replace the panel-glyph pair with a source pin: those glyphs carry no `text-warning`, and the block's keeps it.
  - Add the card-edge cases: 3:1 against `card`, and the page/blob record.
- [x] Docs:
  - DESIGN.md §Warning, UX-DR4 and UX-DR48, as shipped.
  - `deferred-work.md`: mark the 11.3-review and 11.4-review entries RESOLVED.
  - sprint-status: items 37 and 41 → `done`; item 42 stays open and points at the A7 deferred entry.

**Acceptance Criteria:**
- Given the change, when `month.ts`'s imports are walked transitively, then no path returns to it.
- Given a short shift on the day detail, the strip or the *Danas* card, when it renders, then its glyph is `foreground`.

## Spec Change Log

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck`: green.
- `pnpm --filter @shift/domain test && pnpm --filter ./apps/web test && pnpm --filter ./apps/web build`: green.
- `pnpm test` (root): green, except DB tests that need 0048, which is missing on the shared stack.

## Suggested Review Order

**R1: the builder's line waits for the calendar**

- Entry point: `null` until the calendar is in, then 11.2's own report.
  [`erasures.ts:216`](../../apps/web/src/features/rotation/services/erasures.ts#L216)

- A failed read is no calendar, stale data included.
  [`erasures.ts:201`](../../apps/web/src/features/rotation/services/erasures.ts#L201)

- The hook only wires the pure decision.
  [`use-draft-short-staffed.ts:30`](../../apps/web/src/features/rotation/hooks/use-draft-short-staffed.ts#L30)

**R2: one recipe, no cycle**

- The staffing input lives beside the schedule input it spreads.
  [`month.ts:1077`](../../apps/web/src/features/calendar/utils/month.ts#L1077)

- The minimum sits beside its parser.
  [`snapshot.ts:398`](../../apps/web/src/features/calendar/services/snapshot.ts#L398)

- Collisions spread the same recipe.
  [`conflicts-queue.ts:5`](../../apps/web/src/features/conflicts/services/conflicts-queue.ts#L5)

- Re-export keeps every importer unchanged.
  [`short-staffed.ts:109`](../../apps/web/src/features/staffing/services/short-staffed.ts#L109)

**A6: no warning glyph on glass**

- Day detail, strip and Danas card glyphs in `foreground`.
  [`day-detail-dialog.tsx:122`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L122)
  [`resolution-option.tsx:72`](../../apps/web/src/features/conflicts/components/resolution-option.tsx#L72)
  [`short-staffed-card.tsx:59`](../../apps/web/src/features/today/components/short-staffed-card.tsx#L59)

**Tests and docs**

- The card edge and the block border, measured on both sides; shortfalls pinned.
  [`theme-contrast.test.ts:794`](../../test/theme-contrast.test.ts#L794)

- Only the block may draw `text-warning`, across every `.tsx`.
  [`theme-contrast.test.ts:1644`](../../test/theme-contrast.test.ts#L1644)

- The transitive walk from month.ts, with non-vacuity cases.
  [`import-cycles.test.ts:112`](../../test/import-cycles.test.ts#L112)

- The R1 matrix under both fixtures.
  [`surfaces.test.ts:268`](../../apps/web/src/features/staffing/surfaces.test.ts#L268)
