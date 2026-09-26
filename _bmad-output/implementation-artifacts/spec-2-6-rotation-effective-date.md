---
title: 'Story 2.6: An admin changes the rotation from a date forward'
type: 'feature'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: '73ff5f3732ee1cb1117065d227b32cfd89ffbb2f'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-5-rotation-save-warnings.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** every rotation save takes effect today. An admin cannot schedule a change from a later date, cannot take back a scheduled one, and cannot see who changed the rotation or when. CAP-9, AD-2 and AD-11 are only half met.

**Approach:**
- The builder gets a `Vrijedi od` date, which defaults to today and can be no earlier.
- The save writes the new versions from that date. The preview, figures and 2.5 warnings start from it.
- While a change is scheduled, saving stays refused and the screen offers to cancel it.
- A `Povijest rotacije` list shows every saved change: its effective date, the admin who made it, and when.

## Boundaries & Constraints

**Always:**
- **Effective date:**
  - `RotationDraft.effectiveFrom` is an ISO date, defaulting to today in the organization zone.
  - A date before today is refused before anything is sent (new code `ROTATION_EFFECTIVE_PAST`, own key), and the entered values are kept.
  - The save writes `effective_from` = that date for every active team. The anchor stays separate: the prefill keeps today as the anchor, and the admin can move it.
- **From the effective date:** the preview (`previewGridOf`), figures (`figuresOf`), the unchanged check (`draftUnchangedOf`) and the warnings (`savedOn`) take the effective date where they take `today` now. `ROTATION_CHANGED_TODAY` fires when a team's latest version equals the effective date. `ROTATION_SCHEDULED` keeps using today.
- **History before the date is untouched:** nothing is updated in place. Dates before the effective date project through the prior version, and dates on or after it through the new one. Asserted in the domain against both fixtures.
- **Cancel a scheduled change (decision 2a):**
  - Only while `rotationScheduledOf` is true.
  - A neutral button beside the `ROTATION_SCHEDULED` refusal, confirmed with `ConfirmDialog`.
  - It deletes the organization's assignments at that scheduled date through the existing delete policy.
  - One `.delete()` exists in `apps/web/src/rotation`, inside that one function, as in `cancelScheduledTimes`.
  - Zero rows back means stale: re-read, and report `ROTATION_CANCEL_STALE` with its own key. Other failures map like the save's.
  - It invalidates `ROTATION_KEY` only.
- **History list (decision 3):**
  - Rows come from the one snapshot read. `ROTATION_COLUMNS` adds the assignment `id`, `created_by` and `created_at`, plus a `members(organization_id,auth_user_id,name)` embed for the names.
  - One row per saved change, grouped by `(pattern_id, effective_from)`, newest first.
  - Each row shows: the effective date (`formatIsoDate`); the admin's name, or a key for an unknown author; the save time (`formatDate` + `formatTime` in `snapshot.timeZone`); a status of `zakazano` / `na snazi` / `prethodno`, as text and not by colour; and the team count, in plural forms.
  - A `Table` in a `Card` after the step sections, visible at every width, scrolling inside its own container.
  - The history is not paginated.
- Every string goes through i18n under `rotation.builder.*` (`effectiveFrom`, `history.*`, `cancelScheduled.*`), registered in the inventories as 2.5 did. The team-term rule holds.

**Ask First:** any migration, RPC or policy change; archiving rules for teams or types; saving while a change is scheduled; a history of anything other than assignments.

**Never:** an effective date in the past; stacking a second scheduled change; `destructive`; projection or modulo in `apps/web`; a second `useQuery` or query key; reading fire rank or team position; the override review (Epic 3) or the pending-conflict guard (5.5); new dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Today | pilot, change a step, date = today | Versions from today; history's newest row `na snazi`, names the admin | N/A |
| Future | date = today + 7 | Versions from +7. Before +7 projects the old pattern, from +7 the new. Row `zakazano`. Preview and warnings start at +7 | N/A |
| Past | date = yesterday | Refused, values kept, nothing sent | `ROTATION_EFFECTIVE_PAST` |
| Scheduled exists | save again | Refused `ROTATION_SCHEDULED`, cancel offered | existing key |
| Cancel | confirm | Scheduled rows deleted, the previous row is `na snazi` again, save allowed | N/A |
| Cancel stale | already cancelled elsewhere | 0 rows, re-read, stale message | `ROTATION_CANCEL_STALE` |
| Unchanged on date | the draft equals the version in force on the date | Refused | `ROTATION_UNCHANGED` |
| Unknown author | `created_by` not among members | Row shows the unknown-author key | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/rotation/draft.ts`:
  - `RotationDraft` :50 — add `effectiveFrom`.
  - `draftAssignmentOf` :95 sets `effectiveFrom: draft.anchorDate` for the synthetic projection. Leave it as it is.
  - `prefillOf` :159 and `emptyDraftOf` :161 — set `effectiveFrom = today`.
  - `previewGridOf` :627 (from `datesFrom(today…)` :559), `figuresOf` :696 (`shiftDurationOn` at :704), `draftUnchangedOf` :749 and `draftRefusalOf` :777 — thread the effective date through them.
  - Codes :717.
- `apps/web/src/rotation/list.ts`:
  - `ROTATION_COLUMNS` :55; `rotationAssignmentOf` :147 keeps the domain fields. Keep `id`, `created_by` and `created_at` in a separate history record on `RotationSnapshot` :105, so the domain type is not changed.
  - `rotationScheduledOf` :328 and `rotationChangedTodayOf` :343.
  - Members: `members.auth_user_id` = `created_by` (no FK, so join on the client). An active admin reads all members (0011:36).
- `apps/web/src/rotation/write.ts`:
  - `saveRotation` :178, which writes `effective_from: today` :265.
  - The seam `RotationInsertTable` :84 — add a delete-capable assignments seam for the cancel only.
  - `rotationWriteMessageKey` is exhaustive.
- Delete precedent: `apps/web/src/shift-types/write.ts:463` `cancelScheduledTimes`, and the UI in `routes/postavke-rotacije.tipovi-smjena.$id.tsx:265`.
- `apps/web/src/rotation/rotation-section.tsx`:
  - `today` :225, `save()` :293 (`savedOn` :312), figures :476, preview :641.
  - The anchor `Input type="date"` :563 is the pattern for the effective-date input; put the effective-date input beside it in the offsets card.
  - Header and Notices :833–889. Step sections :897–923; the history card goes after them.
- `apps/web/src/rotation/warnings.ts` — `savedOn` becomes the effective date. No change inside the file.
- New `apps/web/src/rotation/history.ts` (+ test) — groups, orders and labels the history rows, and names the authors. Pure.
- `apps/web/src/i18n/format.ts` — `formatIsoDate` :283, `formatDate` :302, `formatTime` :309.
- `supabase/migrations/0016_rotation.sql`, read-only:
  - insert policy :396 (`>= today`, `> latest`, no scheduled);
  - delete policy :430 (future and latest only);
  - `created_by`/`created_at` defaults :156.
- Inventories:
  - `test/resource-hygiene.test.ts` :76–88, :793–845;
  - `test/localization-applied.test.ts` :237–246;
  - `apps/web/src/routes/prijava.test.ts`: `effective_?From` ban :3077 (lift it for the section), controls :450, string counts :1665–1710, one-`.delete()` pin (as :3160);
  - `apps/web/src/rotation/write.test.ts:456` — the no-`.delete(` sweep; exempt exactly the cancel function.
- `test/rls-isolation.test.ts` :12540, :13105 — existing policy tests (scheduled, cancel, `created_by`). Extend them only if a gap shows.
- e2e: `holdRotation` (e2e/support/database.ts:59) already clears future versions. `e2e/rotation.spec.ts` :99, :296.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/test/projection.test.ts` -- two versions on both fixtures: the day before resolves through the old version, the effective day and later through the new one.
- [x] `apps/web/src/rotation/draft.ts`, `draft.test.ts` -- `effectiveFrom`, the past refusal, and the threaded date. Covers the matrix rows Past, Future and Unchanged on date.
- [x] `apps/web/src/rotation/list.ts`, `list.test.ts` -- the extra columns, the members embed, and the history records parsed with the tenant tripwire.
- [x] `apps/web/src/rotation/history.ts`, `history.test.ts` -- rows, statuses, author names, unknown author, plural cases 1, 2 and 5.
- [x] `apps/web/src/rotation/write.ts`, `write.test.ts` -- write the effective date; `cancelScheduledRotation` (ok, stale, refused, unavailable); the message keys.
- [x] `apps/web/src/rotation/rotation-section.tsx` -- the date input, the cancel button with `ConfirmDialog`, and the history card. The save passes the effective date to the save and the warnings.
- [x] `apps/web/src/i18n/locales/hr.json` -- the new keys.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` -- the inventories and counts.
- [x] `e2e/rotation.spec.ts` -- in the run's org:
  - save from tomorrow and see a `zakazano` row with the admin's name;
  - save again and see it refused;
  - cancel, and see the row gone.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `2-6-…: in-progress`.

**Acceptance Criteria:**
- Given an applied change, when its assignment row is inspected, then `created_by` and `created_at` come from the column defaults. The client sends neither: the insert payload has no such keys.
- Given `apps/web/src/rotation`, when swept, then there is exactly one `.delete(`, inside `cancelScheduledRotation`, and no `.update(` or `.upsert(`.

## Design Notes

**Why the anchor stays separate from the effective date.** The anchor fixes the phase and the effective date fixes when the phase applies. Tying them together would shift every team's phase whenever the admin moves the date. The prefill re-expresses offsets onto today (2.3b), so a pure date change keeps each team's pattern. The 2.3a ledger item about comparing the anchor literally stays deliberate: the database rule is literal, while the UI's unchanged check compares projections.

**One scheduled change at most.** The insert policy already refuses a version while one is scheduled, so decision 2a needs no schema change.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `pnpm test:e2e` -- green. Stop Vite on 5173 first, and do not run it at the same time as `pnpm test`.
- `git diff --stat supabase/ package.json pnpm-lock.yaml` -- empty.

**Manual checks:**
- As the pilot admin at 390 and 1280 px: schedule a change for next week, see it in the history, cancel it.

## Suggested Review Order

**Save from a chosen date**

- Entry point: every version is written from the draft's effective date, not today.
  [`write.ts:298`](../../apps/web/src/rotation/write.ts#L298)

- Refusal order: scheduled first so the cancel is always reachable, then past.
  [`draft.ts:816`](../../apps/web/src/rotation/draft.ts#L816)

- The effective date accepts only real calendar dates; anchor stays separate.
  [`draft.ts:371`](../../apps/web/src/rotation/draft.ts#L371)

- Unchanged is judged against the version in force on the effective date.
  [`draft.ts:780`](../../apps/web/src/rotation/draft.ts#L780)

- Preview starts on the effective date.
  [`draft.ts:654`](../../apps/web/src/rotation/draft.ts#L654)

**Cancel a scheduled change**

- The one delete: confirmed date, active teams only, row count must match.
  [`write.ts:348`](../../apps/web/src/rotation/write.ts#L348)

- Section handler: clears the refusal, re-reads `ROTATION_KEY`, focuses the confirmation.
  [`rotation-section.tsx:401`](../../apps/web/src/rotation/rotation-section.tsx#L401)

- The ConfirmDialog naming the scheduled change.
  [`rotation-section.tsx:1021`](../../apps/web/src/rotation/rotation-section.tsx#L1021)

**History: who and when**

- Same snapshot read: assignment id, created_by, created_at, plus a members embed.
  [`list.ts:55`](../../apps/web/src/rotation/list.ts#L55)

- Strict timestamp parsing, tenant tripwire on every record.
  [`list.ts:201`](../../apps/web/src/rotation/list.ts#L201)

- Grouped per save, newest first, status and author resolved as keys.
  [`history.ts:59`](../../apps/web/src/rotation/history.ts#L59)

- The history table, after the step sections, at every width.
  [`rotation-section.tsx:958`](../../apps/web/src/rotation/rotation-section.tsx#L958)

**Screen wiring**

- `Vrijedi od` input beside the anchor.
  [`rotation-section.tsx:673`](../../apps/web/src/rotation/rotation-section.tsx#L673)

- 2.5 warnings computed from the effective date.
  [`rotation-section.tsx:373`](../../apps/web/src/rotation/rotation-section.tsx#L373)

**Peripherals**

- Copy: `Vrijedi od`, cancel dialog, history.
  [`hr.json:345`](../../apps/web/src/i18n/locales/hr.json#L345)

- Domain: before the date the old version, from it the new, both fixtures.
  [`projection.test.ts:417`](../../packages/domain/test/projection.test.ts#L417)

- E2E: schedule from tomorrow, see it in history, refused again, cancel.
  [`rotation.spec.ts:391`](../../e2e/rotation.spec.ts#L391)
