---
title: 'A calendar shift-type override cannot quietly erase a pending conflict (5.5f)'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: '4bcecc793f1ecc466ad4f41c10976cf62d02b47d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-5b-roster-erasure-guard.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In the calendar's day detail, an admin can set a non-working shift type on a working day, or remove an override that made a non-working day working. Either way, every member on that day's roster who is on leave loses their unresolved conflict without a decision.

**Approach:** Guard both calendar override writes with 5.5b's shared erasure pieces, following the roster form's flow exactly. Add one shared, surface-neutral helper that builds the "after" snapshot for every shift-type override operation: set, remove, confirm and amend. 5.5h's rotation review then only has to wire it.

## Boundaries & Constraints

**Always:**
- **Same rules as 5.5b.**
  - The diff runs from the override's date (`from = date`).
  - Added collisions never block.
  - The dialog shows one row per erasure, with "Potvrdi brisanje" / "Zadrži".
  - "Spremi" is `aria-disabled` until every row is confirmed. Confirming re-derives the rows, and a changed list is shown again with every row undecided.
  - If the diff cannot be derived, the write is refused with "Pokušaj ponovno" and the calendar stays intact.
  - Nothing new is written.
- **Shared helper.** Use a neutral home, for example `features/conflicts/services/override-erasures.ts`. Each operation builds a new snapshot object (standings are cached per object):
  - **Set:** append a `CalendarOverride` with `createdAt` newer than every instant in the snapshot and `confirmedAt: null`. It is in force wherever a version governs the date.
  - **Remove:** filter the override out by id.
  - **Confirm:** replace the override with `confirmedAt` newest.
  - **Amend:** remove the old override and append a new one with the new type and `createdAt` newest, as 0022 does.
- **Refused before deriving** (judged on the fresh snapshot):
  - Set: a live override already holds that team and date (`taken`).
  - Remove, confirm or amend: the override is gone (`gone`).
  - Confirm or amend: the team or the type is archived (`archived`).

  A refused answer takes the write's own refusal path locally. Any other fault answers `unavailable`.
- **Calendar flow (human, 2026-10-05, 5.5b pattern).**
  - The existing preflight (`sameAsProjected`, `reason`) runs first, then the check.
  - A set that erases nothing saves in one click.
  - A removal goes through its own confirmation, then the erasure dialog.
  - The erasure dialog opens beside the day detail. "Natrag na uređivanje" keeps the form inputs, and focus returns to the opener or falls back to the first field.
  - The override form and the roster form share the calendar latch.
- **Row text.** "{member} na godišnjem · nakon promjene: {team} taj dan slobodna". A shift-type override never changes who is rostered, so `teamWorks` is false.
- After a landed override write, also refresh the organization leave and the resolutions, next to `CALENDAR_KEY`.
- Every string goes through `t()`. Update the UX docs and AD-5's "as shipped" line.

**Ask First:**
- Any migration or server-side check.

**Never:**
- No guard in the rotation builder's override review (5.5h), and no change to its code beyond what the shared helper needs.
- No change to the override form's preflight or refusal copy.
- Discarding a pending override is never guarded (human, 2026-10-05).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set non-working | Mirela (Smjena C) on leave +4 (Dan); set Slobodno on Smjena C +4 | dialog, 1 row "… nakon promjene: Smjena C taj dan slobodna"; confirm → saved, queue −1 | N/A |
| Two on leave | two members of Smjena C on leave +4 | 2 rows | N/A |
| Working→working | set Noć on a Dan day | saves in one click (key unchanged) | N/A |
| Remove makes free | an override made a Slobodno day Dan; member on leave; remove it | removal confirm → erasure dialog, 1 row | N/A |
| Remove pending | the override is pending | removal as today, no dialog | N/A |
| Resolved | the +4 conflict was accepted | no dialog | N/A |
| Taken | another override written meanwhile on that team and date | the form's existing `taken` refusal, no dialog | existing |
| Keep | row "Zadrži" | locked; back keeps the inputs | N/A |
| Read failed | resolutions read returns 500 | refusal + retry; nothing written; calendar intact | refusal |
| Helper confirm/amend | pending non-working override; confirm or amend in the helper | the helper's after puts it in force; the diff lists the erasure | unit only |

## Epic AC Deviations

- **NARROWED:** "a rotation, roster or membership change". 5.5f covers the calendar's override set and remove. The rotation review is 5.5h and rotation cancel is 5.5g, both in `deferred-work.md`.
- **INTERPRETED:** "surfaced in the rotation save confirmation dialog". The shared dialog opens beside the day detail (human, 2026-10-05).
- **DEFERRED:** the sticky save bar is 5.5c, already in `deferred-work.md`.

</frozen-after-approval>

## Code Map

Paths are under `apps/web/src` unless they say otherwise.

- **Shared pieces:**
  - `features/conflicts/services/erasures.ts`: `erasuresOf`, `recheckOf`, and `latestInstantOf`/`isoInstantOf` :69/:121. `teamWorks` is at :192-210.
  - `services/erasure-check.ts`, `hooks/use-erasure-reads.ts` (`readAndShare` :94), `hooks/use-erasure-confirmation.ts`, `components/erasure-dialog.tsx`.
  - `utils/focus-later.ts` `firstEnabledOf`.
- **Model to copy:**
  - `features/calendar/services/roster-erasures.ts` (live-key refusal, after builder);
  - `hooks/use-roster-form.ts` (`submitRoster`, `removeChange`, `confirmErasures`, the discriminated subject, `unchecked`, focus);
  - `components/roster-form.tsx` `RosterErasureConfirm`.
- **Standing.** `calendar/utils/month.ts:100-121` `overrideStandingOfCalendar` is cached per object and throws on two overrides per team and date. The domain rule is `packages/domain/src/overrides.ts:187-219`. `CalendarOverride` is at `calendar/services/snapshot.ts:210`. Amend in the database is `supabase/migrations/0022…sql:153-189`.
- **Override writes.**
  - `features/calendar/hooks/use-override-form.ts`: `submit` :127 and `remove` :209. The latch :68 is shared via `pages/kalendar.tsx:82`; the refresh is at :114.
  - `services/override-write.ts` :132/:155, with the failure mapper at :88.
  - `components/override-form.tsx` :104 and the removal `ConfirmDialog` :199-237. The day dialog's nested dialogs are at `day-detail-dialog.tsx:380`.
  - `utils/day-detail.ts:537/593`.
- **Dependents.** `features/teams/services/dependents.ts` gets an override-write list (twin of :175), plus a test.
- **Registries.**
  - `lib/i18n/locales/hr.json`: a new `kalendar.detail.override.erasures.*` block.
  - `test/resource-hygiene.test.ts` :99-117.
  - `pages/prijava.test.ts`: `IN_FLIGHT_HANDLERS` :970 (the override `submit`/`remove` with `writers`, a distinct name for the new confirm handler, the count at :6530), Kalendar controls :717 and strings :2306.
  - `features/conflicts/conflicts-screen.fixture.ts` (`CONFLICTS_SCREEN_EXEMPT`: the new helper lives in `features/conflicts`, so `calendar-screen.fixture.ts` and `snapshot.test.ts` needed no change), and `eslint.config.js` `FEATURE_PUBLIC.conflicts`.
- **e2e.**
  - `e2e/pages/calendar.page.ts`: `setOverrideIn` :446, `overrideRemoveIn` :405, `removeConfirmOf` :424.
  - `e2e/utils/database-helper.ts`: `seedShiftTypeOverride` :932 (steps 2 and 3 are non-working), `removeOverrideInSql` :1093.
  - Copy the setup from `e2e/tests/calendar/calendar-roster-erasures.spec.ts` :104-111.

## Tasks & Acceptance

**Execution:**
- [x] `features/conflicts/services/override-erasures.ts` and its test -- set, remove, confirm and amend afters, plus the refused checks. Cover every matrix row except Keep and Read failed, including Helper confirm/amend.
- [x] `features/calendar/services/override-erasures` wiring (or the check inside the hook), and `hooks/use-override-form.ts` -- the check in set and remove, `confirmErasures` (distinct name), `unchecked` + retry, and focus.
- [x] `components/override-form.tsx` and `day-detail-dialog.tsx` -- `OverrideErasureConfirm` beside the day detail.
- [x] `dependents.ts` and its test, `hr.json`, and the registries.
- [x] `e2e/tests/calendar/calendar-override-erasures.spec.ts` -- Set non-working by keyboard (queue −1), Remove makes free, Working→working in one click, Keep, Read failed (calendar intact), and the changed list. The 5.5a/b/e erasure specs still pass.
- [x] Docs -- the UX docs and the AD-5 line. `sprint-status.yaml`: 5-5f. Mark the 5.5f ledger entry resolved.

**Acceptance Criteria:**
- Given the day detail, when the admin sets Slobodno on a day with a member on leave using only the keyboard, then focus starts on the first "Potvrdi brisanje" and the override lands once every row is confirmed.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (shared stack, no `db:reset`)
- `pnpm exec playwright test calendar rotation people conflicts` -- expected: green

## Suggested Review Order

**The shared override "after"**

- Entry point: set, remove, confirm and amend, each a new snapshot; taken, gone and archived are refusals.
  [`override-erasures.ts`](../../apps/web/src/features/conflicts/services/override-erasures.ts)

**The guard on the calendar's override writes**

- Set: preflight, then the check; nothing erased writes at once; a refused check takes the write's own path locally.
  [`use-override-form.ts` `submit`](../../apps/web/src/features/calendar/hooks/use-override-form.ts)
- Removal: its confirmation runs the check for every removal (a pending override lists nothing in the fresh read), then the erasure dialog follows.
  [`use-override-form.ts` `remove`](../../apps/web/src/features/calendar/hooks/use-override-form.ts)
- Confirm re-derives; refused, unavailable or changed each take a defined path.
  [`use-override-form.ts` `confirmOverrideErasures`](../../apps/web/src/features/calendar/hooks/use-override-form.ts)
- The dialog beside the day detail, with the removal copy.
  [`override-form.tsx` `OverrideErasureConfirm`](../../apps/web/src/features/calendar/components/override-form.tsx)

**Tests**

- Unit: every matrix row but Keep and Read failed, with confirm and amend.
  [`override-erasures.test.ts`](../../apps/web/src/features/conflicts/services/override-erasures.test.ts)
- e2e: set by keyboard, two rows, remove makes free, remove pending, working→working, keep, read failed (set and removal), confirm-time failures (unavailable, gone, write failed), changed, taken.
  [`calendar-override-erasures.spec.ts`](../../e2e/tests/calendar/calendar-override-erasures.spec.ts)
