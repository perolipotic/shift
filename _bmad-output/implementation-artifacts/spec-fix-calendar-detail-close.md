---
title: 'The calendar day detail closes once, and a late close event never shuts a new day'
type: 'bugfix'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
  - '{project-root}/e2e/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `deferred-work.md` (from B3's review) records three suspected hazards in `apps/web/src/features/calendar/hooks/use-day-detail.ts`. All three predate the refactor:
1. The render-phase `else if (shownDetail.close)` branch calls `setOpened(null)` and bumps `closes` without checking `opened !== null`. If `dayDetailShownOf` ever returns `close: true` with nothing open, this is an endless re-render.
2. A close caused by a `detailKey` change (month, mode, team or person) resets `opened` but never sets `closeEventOwedRef`. The dialog's late native `close` event then reaches `closedByBrowser` unmatched. If a new day was opened in between, that stale event shuts it.
3. `DayDetailDialog` wires `onClose` to both `onOpenChange(false)` and `onCancel`. If both fire on Escape, `closeDay` runs twice, and `closes` and the focus-return effect run twice.

**Approach:** For each hazard, first prove whether it is real, with a probe or unit reasoning against the actual `Dialog` primitive and `dayDetailShownOf`:
- If it is real, fix it minimally in the hook or the dialog wiring and pin it with a test: an E2E test where it can be driven, otherwise a unit test of the pure part.
- If it cannot happen, add the smallest guard that makes the invariant explicit and cheap, such as the `opened !== null` check, plus a comment that says why.

Record each verdict in the spec's Change Log.

## Boundaries & Constraints

**Always:**
- The observable behaviour stays the same: Escape, the close button, browser Back/Forward, and focus return to the opener or the fallback.
- The existing calendar E2E specs keep passing, including "browser Back after an in-app month change…" (#83).
- Tests follow `e2e/README.md`. Locators live in the page objects. No `waitForTimeout`.

**Ask First:**
- Any change to the `Dialog` primitive in `components/ui/dialog.tsx`. It is shared, so a change needs every other dialog screen re-verified.

**Never:**
- No change to the calendar's data reads or its grid keyboard model.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/calendar/hooks/use-day-detail.ts` -- `opened` and `closes` state; `openerRef`, `closeEventOwedRef`; the render-phase `detailFor`/`detailKey` reset; the `shownDetail.close` branch; the focus-return effect; `openDay`, `closeDay`, `closedByBrowser`.
- `apps/web/src/features/calendar/components/day-detail-dialog.tsx` -- the `Dialog` wiring: `onOpenChange`, `onCancel`, `onClose`.
- `apps/web/src/components/ui/dialog.tsx` -- `showModal()`/`close()` in an effect, and `onClose` on the native element. Read it to see which callbacks fire on Escape.
- `apps/web/src/features/calendar/utils/day-detail.ts` -- `dayDetailShownOf` (when `close` is true), with its unit tests.
- `e2e/tests/calendar/calendar.spec.ts`, `e2e/pages/calendar.page.ts` -- the existing detail tests: Escape, close, Back/Forward.

## Tasks & Acceptance

**Execution:**
- [x] Probe each hazard, then fix it or guard it as described in Approach.
- [x] Add a test per real hazard. Example for 2: open a day, change the month through the app, then quickly open a day in the new month; the new detail must stay open.
- [x] Remove the `deferred-work.md` entry for these hazards.

**Acceptance Criteria:**
- Given each hazard shown to be real, when its fix is reverted, then its test fails.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test` (after a web build) and `pnpm test:e2e` run twice, then all pass.

## Spec Change Log

- 2026-09-27 -- Verdicts, one per hazard (no frozen intent changed):
  1. **Not real.** `dayDetailShownOf` returns `close: false` whenever `opened` is `null` (its first line; pinned by `day-detail.test.ts`, "nothing open is nothing to close"), so the branch cannot fire with nothing open. Guarded: the branch now also checks `opened !== null`, with a comment saying why.
  2. **Real.** Probed in E2E: a capture listener on the dialog's `close` event clicks a cell of the month Back showed before the app hears the event (as an input Chrome runs ahead of the queued task would). Without a fix the new day opens and is shut in the same task. Fix in the hook: `closedByBrowser` ignores a `close` event that finds the dialog open again, because it belongs to an earlier close. There are no render-phase ref writes. Pinned by the E2E test "a day opened before the late close event of a month change stays open". With the fix reverted it fails at the `toBeVisible` check (run twice).
  3. **Not real.** `DayDetailDialog` passes `onClose` and `onCancel` to `Dialog`, and the `{...props}` spread comes after the primitive's own `onCancel`/`onClose`, so it replaces them. On Escape, `cancel` calls `closeDay` once (setting the owed flag), and the late `close` event goes to `closedByBrowser`, which consumes it. `onOpenChange(false)` comes only from a backdrop click. Guarded: `closeDay` returns early when nothing is open, so a second report of one close counts nothing. A comment in the dialog wiring explains the replacement. `components/ui/dialog.tsx` is unchanged.

## Verification

**Commands:**
- `pnpm typecheck` and `pnpm lint` -- expected: exit 0.
- `pnpm test` -- expected: pass, after a rebuild.
- `pnpm test:e2e`, run twice -- expected: all pass. Port 5173 must be free, and it must not run in parallel with `pnpm test` or with another worktree's E2E.
