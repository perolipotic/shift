---
title: 'Story 3.5c: Overrides under a rotation change wait for the admin''s disposition'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
baseline_commit: '3b84bf49975fea6cc2d0d55d1484fecf107fe58a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-5b-shift-type-override-form.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-6-rotation-effective-date.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a rotation change is saved (2.6), a live override dated under the new version silently keeps applying on top of a shift it was not written for. CAP-9's disposition half is missing.

**Approach:** The domain derives a durable **pending** state: a live override is pending when the rotation version governing its date was created after the override was written or last confirmed, or when no version governs its date. A pending override is not applied, so the cell shows the projection, and the day detail flags it. The rotation builder lists every pending override for **confirm**, **amend** or **discard**. The user decided this on 2026-09-28: a derived state, not a blocking pre-save dialog; confirm records `confirmed_by`/`confirmed_at` through a definer function; amend is one atomic definer replacement; discard is 3.5b's `remove_shift_type_override`.

## Boundaries & Constraints

**Always:**
- **Migration `0022_shift_type_override_disposition.sql`** (check the main checkout, including untracked files, for the next free number):
  - Add `confirmed_by uuid` and `confirmed_at timestamptz`, both null or both set (check). No session privilege on either.
  - `confirm_shift_type_override(p_override_id uuid) returns void` sets them to `auth.uid()` and `now()`.
  - `amend_shift_type_override(p_override_id uuid, p_shift_type_id uuid, p_reason text) returns uuid`: in one transaction, soft-removes the live row (`removed_by`/`removed_at`) and inserts a row with the same team and date, the new type and reason, attributed by the defaults. Returns the new id.
  - Both functions copy 0021: plpgsql, `SECURITY DEFINER`, `search_path = ''`, 42501 unless an active admin of the claimed organization, P0002 when no live row matches. The table checks give 23514 and 23503. Grant execute to authenticated only.
  - Replace `calendar_shift_type_overrides()` (drop + create) so it also returns `confirmed_at`, and nothing else new.
- **Domain (`packages/domain/src/overrides.ts`):** a pure `overrideStandingOf(versions, overrides)` returns `{ inForce, pending }`.
  - Versions are `{ teamId, effectiveFrom, createdAt }`; overrides carry `id` and `writtenAt` (`confirmedAt ?? createdAt`). Instants are epoch-millisecond integers parsed at the edge, so no `Date` enters the domain.
  - An override is pending iff no version governs its date, or the governing version's `createdAt > writtenAt`. The governing version is the greatest `effectiveFrom <= date`, as in `rotationAssignmentOn`.
  - Callers pass only `inForce` to `scheduledShiftTypeOn`, `scheduleOfMonth` and `memberScheduleOfMonth`.
- **Calendar:** assignments add `created_at` (never `created_by`). Cells and rosters use `inForce` only, so a pending day shows the projection with no `✎`. The day detail of a pending override shows a "čeka pregled" block with the type, reason and author. The admin gets only 3.5b's "Ukloni izmjenu", with no set form.
- **Rotation builder:** the one rotation read also selects live overrides (`id, team_id, date, shift_type_id, reason, created_by, created_at, confirmed_at`) under `ROTATION_KEY`. An "Izmjene za pregled" card, placed after the notices, lists each pending override. Each row shows team, date, override type, the type projected now, reason and author, with the actions:
  - **Potvrdi** — the confirm rpc. Not offered when no version governs the date.
  - **Promijeni** — a dialog with type and reason (3.5b's preflight and options) calling the amend rpc. Not offered when no version governs the date.
  - **Odbaci** — a neutral `ConfirmDialog` naming the team, the date and the type restored, calling the remove rpc.
  - The card is absent when nothing is pending. After a save, the success notice adds a plural count of pending overrides.
- **Dialog and write behaviour:** pending/`dismissible={!pending}`, keep-and-focus on refusal, and invalidate `ROTATION_KEY` only (the calendar's stale time is 0).
- **Refusal keys:** 42501 → `denied`, P0002 → `gone` (re-read), 23514/preflight → `reason`, preflight → `sameAsProjected`, anything else → `failed`.
- **Copy:** under `rotation.builder.overrides.*` and `kalendar.detail.override.pending.*`, registered under "story 3.5c".

**Ask First:**
- a new cell modifier or legend entry;
- a trigger, a new table policy or grant, or a column-level grant on the new columns;
- a second query key;
- changing 2.6's save or cancel writes;
- disposition anywhere other than the rotation builder.

**Never:**
- a write to any rotation row;
- a hard delete of an override;
- a blocking pre-save dialog;
- `destructive` or the accent;
- projection or modulo in `apps/web`;
- new dependencies or render tests;
- exposing `auth_user_id` to member-role reads.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Change over an override | override on D+3, then a change saved from D+1 | pending; cell = new projection, no `✎`; listed in the card; save notice counts 1 | N/A |
| Before the date | override on D, change from D+1 | in force, not listed | N/A |
| Written after | override set after the change, date ≥ D+1 | in force | N/A |
| Confirm | admin confirms | `confirmed_*` set; applied again with `✎`; row leaves the card | N/A |
| Amend | new type + reason | old row removed, new row live and in force | `reason`, `sameAsProjected` |
| Discard | confirm dialog | soft-removed; cell = projection | N/A |
| Cancel the change | the scheduled change is cancelled | the earlier version governs again → no longer pending | N/A |
| No rotation | override dated before any version | pending; only Odbaci offered | N/A |
| Stale | disposed elsewhere | re-read | `gone` (P0002) |
| Member / other org | rpc as member, or an id from org B | nothing changes | 42501 / P0002 |

</frozen-after-approval>

## Code Map

- `packages/domain/src/overrides.ts`: `ShiftTypeOverride` :28-32, `overridesByTeamAndDate` :55, `applyOverride` :74, `scheduledShiftTypeOn` :102. `projection.ts`: `RotationAssignment` :56-62 (no `createdAt` — keep it so; stamps are a separate input), `rotationAssignmentOn` :97. `schedule.ts` :130-152, :196-221. Export from `index.ts:38-48`. Tests: `test/overrides.test.ts` (FIXTURES pilot + UJ-5 :29; "removing every override restores the projection" :102 — add "every override pending equals the pure projection"), fixtures `test/fixtures.ts:118-145`.
- `supabase/migrations/0019_shift_type_overrides.sql`: table :46-94, removal check :92, grants :169-173, `calendar_shift_type_overrides()` :195-239. `0021_remove_shift_type_override.sql:45-88`: the shape to copy. `0016_rotation.sql`: `created_at` :157; cancel is a hard delete :430-443.
- `apps/web/src/features/calendar/services/snapshot.ts`: `CALENDAR_COLUMNS` :87-95 (the comment :51-54 on why no author columns; `created_at` is fine), `CalendarOverride` :177-183, `overridesOf` :493-537, assignments parsed via rotation's `rotationAssignmentOf` :414-446 — keep the stamps in a separate snapshot field. `CalendarSnapshot` :215-239.
- `apps/web/src/features/calendar/utils/day-detail.ts`: `DayDetailOverride` :76, `dayDetailOf` :125, `overrideOf` :209 (throws if flagged but missing — pending ones are not flagged), `overrideTypeOptionsOf` :289, `overrideOffersOf` :338. `utils/month.ts` `cellOf` :582 and callers :655-787. `components/day-detail-dialog.tsx` `renderOverride` :63, `renderDetail` :98; `components/override-form.tsx`.
- `apps/web/src/features/rotation/services/list.ts`: `ROTATION_COLUMNS` :55, `RotationSnapshot` :109, `RotationHistoryRecord` :132 (has `createdAt`), `readRotation` :257. `write.ts`: seams :90-115, `cancelScheduledRotation` :348 (the pattern for settle + stale). `components/rotation-section.tsx`: `save()` :324, notices :1092-1150, history :1187, `renderCancelConfirmation` :1019. New `services/override-disposition.ts` (+ test) holds the three rpc calls and the failure map; new `components/override-review.tsx` for the card and dialogs if cleaner.
- Reuse: 3.5b's `calendar/services/override-write.ts` (failure map :88) and `day-detail.ts` preflight :324 are not public. `eslint.config.js:111-151` `FEATURE_PUBLIC` — calendar already imports `rotation/services/list`, so do not import calendar internals from rotation. Keep the preflight in the domain or duplicate it locally, and name the rpc constants in the rotation file.
- Guards:
  - `snapshot.test.ts`: assignment columns exactly :180-183 (add `created_at`, keep the `created_by` ban); rpc/insert counts :1049-1052 (unchanged in calendar); modifier rule :1015-1035 (unchanged); `SCREEN_SHOWS`/`DETAIL_CARRIES` :934-963.
  - `rotation/services/write.test.ts:692-728`: add an `.rpc(` sweep limited to the new file; keep `.delete(` at one.
  - `test/supabase-scaffold.test.ts`: contiguity :97; override columns :1683; the 0019 function block :1772-1806 and 0021 :1808 (new `it` for 0022 — the replaced read's select list bans `created_by|removed_by|removed_at|confirmed_by|auth_user_id`).
  - `test/rls-isolation.test.ts`: function inventory :1118-1183; `calendarOverrideColumns` :13851; new 3.5c describe after :14303.
- i18n: `hr.json` (`rotation.builder.*`, `kalendar.detail.override.*` :62); `test/resource-hygiene.test.ts` :834, :931, namespaces :1014/:1030; `test/localization-applied.test.ts` rotation `SOURCES` :535-547; `apps/web/src/pages/prijava.test.ts` :289-316, `KEY_SOURCES` :1609 and counts :2310.
- E2E: `e2e/utils/database-helper.ts` `seedTeamRotation` :257, `seedShiftTypeOverride` :358, `holdRotation` :80; `e2e/pages/rotation.page.ts` (add card/row/actions, no assertions), `e2e/tests/rotation/rotation.spec.ts` :335, `e2e/pages/calendar.page.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0022_shift_type_override_disposition.sql` -- columns, the two definers, the replaced read, grants -- attributed confirm and atomic amend
- [x] `test/supabase-scaffold.test.ts`, `test/rls-isolation.test.ts` -- inventories and a 3.5c matrix: confirm and amend attribute to the caller, amend is one live row afterwards, member → 42501, other org / removed → P0002, anon has no execute, rotation rows byte-identical, the read returns `confirmed_at` -- DB matrix
- [x] `packages/domain/src/overrides.ts`, `index.ts`, `test/overrides.test.ts` -- `overrideStandingOf` on both fixtures: before / on / after the effective date, written after, confirmed after, no version, cancelled version gone, all pending = pure projection -- the rule
- [x] `calendar/services/snapshot.ts` + test, `utils/day-detail.ts` + test, `utils/month.ts`, `components/day-detail-dialog.tsx` -- stamps, `confirmed_at`, `inForce` for cells and rosters, the pending block -- calendar honours it
- [x] `rotation/services/list.ts` + test, `services/override-disposition.ts` + test, `components/rotation-section.tsx` (+ `override-review.tsx`) -- the overrides read, pending rows from the domain, confirm/amend/discard, the save-notice count -- the disposition
- [x] `hr.json`, `resource-hygiene.test.ts`, `localization-applied.test.ts`, `prijava.test.ts`, `write.test.ts`, `calendar-screen.fixture.ts` -- copy and guards
- [x] `e2e/pages/rotation.page.ts`, `e2e/tests/rotation/rotation.spec.ts`, `e2e/tests/calendar/calendar.spec.ts` -- seed a rotation and three overrides on D+3..D+5, save a change from D+1, and see three rows; confirm one, amend one, discard one; the card is gone; in the calendar, a pending day shows no `✎` and the detail says it is pending -- the flow
- [x] `sprint-status.yaml`, `deferred-work.md` -- 3.5 done; mark the "override on a no-rotation date" entry resolved by 3.5c -- tracking

**Acceptance Criteria:**
- Given any mix of pending overrides, when the month renders, then every cell and roster equals the projection with only the in-force overrides applied, and no override was written or removed by the rotation save (CAP-9, DI-2).
- Given a rotation change that is then cancelled, when the builder re-reads, then overrides that were pending only because of that change are in force again, without any write.
- Given the discard and amend dialogs, when a write is in flight, then neither closes, and neither is `destructive`.

## Design Notes

A timestamp rule, not a stored version link, keeps 2.6's hard-delete cancel self-healing: delete the scheduled version and the earlier one governs again, and it predates the override. Known limit: an override written *while* a change is scheduled, for a date on or after it, and then left in place when that change is cancelled, stays in force over the old projection. That case is rare. Closing it would need a stored governing-version id with `on delete set null`, which is a policy change and so Ask First.

`writtenAt = confirmed_at ?? created_at`, so a confirm re-anchors the override to the version in force at the moment of confirmation. An amend's new row gets a fresh `created_at`.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips
- `pnpm test:e2e` -- green; stop Vite on 5173 first
- `git diff --stat package.json pnpm-lock.yaml` -- empty

**Manual checks:**
- In the demo org at 390 and 1280 px, light and dark: schedule a change over an override, then confirm, amend and discard it in the builder, and check the calendar after each.

## Suggested Review Order

**The pending rule**

- Entry point: pending iff no version governs the date, or it postdates the override's write.
  [`overrides.ts:174`](../../packages/domain/src/overrides.ts#L174)

- One parser to integer microseconds for both screens, so a same-millisecond tie cannot flip.
  [`list.ts:255`](../../apps/web/src/features/rotation/services/list.ts#L255)

- The domain's rule, with property cases over both fixtures, including a cancelled change.
  [`overrides.test.ts:281`](../../packages/domain/test/overrides.test.ts#L281)

**The database**

- Both-or-neither `confirmed_by`/`confirmed_at`, with no session privilege on either.
  [`0022_shift_type_override_disposition.sql:58`](../../supabase/migrations/0022_shift_type_override_disposition.sql#L58)

- Confirm: the server attributes it; an archived team or type is refused with its own code.
  [`0022_shift_type_override_disposition.sql:64`](../../supabase/migrations/0022_shift_type_override_disposition.sql#L64)

- Amend: soft-remove and insert in one transaction, and repeat 0019's archived check.
  [`0022_shift_type_override_disposition.sql:129`](../../supabase/migrations/0022_shift_type_override_disposition.sql#L129)

- The calendar read is recreated only to add `confirmed_at`.
  [`0022_shift_type_override_disposition.sql:208`](../../supabase/migrations/0022_shift_type_override_disposition.sql#L208)

**The calendar honours it**

- Only overrides in force reach cells and rosters, in the grid and the day lists.
  [`month.ts:78`](../../apps/web/src/features/calendar/utils/month.ts#L78)

- Assignment stamps are read separately; `created_by` stays banned.
  [`snapshot.ts:439`](../../apps/web/src/features/calendar/services/snapshot.ts#L439)

- The detail carries a pending override; the admin may only remove it.
  [`day-detail.ts:411`](../../apps/web/src/features/calendar/utils/day-detail.ts#L411)

- Removing a pending override says the pending copy: the day already shows the projection.
  [`day-detail.ts:435`](../../apps/web/src/features/calendar/utils/day-detail.ts#L435)

- The "Izmjena čeka pregled" block.
  [`day-detail-dialog.tsx:98`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L98)

**The disposition in the builder**

- Live overrides are embedded in the one rotation read, under `ROTATION_KEY`.
  [`list.ts:75`](../../apps/web/src/features/rotation/services/list.ts#L75)

- Pending rows: the type projected now, governed or not, and amend options.
  [`override-disposition.ts:156`](../../apps/web/src/features/rotation/services/override-disposition.ts#L156)

- Offers: confirm only when governed; amend only when a choice exists.
  [`override-disposition.ts:212`](../../apps/web/src/features/rotation/services/override-disposition.ts#L212)

- The failure map: denied, gone, archived, reason and failed.
  [`override-disposition.ts:291`](../../apps/web/src/features/rotation/services/override-disposition.ts#L291)

- One handler: latch, clear old notices, write, re-read on gone/archived, keep-and-focus.
  [`override-review.tsx:137`](../../apps/web/src/features/rotation/components/override-review.tsx#L137)

- The save's count comes from the re-read snapshot, captured once.
  [`override-disposition.ts:201`](../../apps/web/src/features/rotation/services/override-disposition.ts#L201)

- The card sits after the notices, composed by the section.
  [`rotation-section.tsx:1184`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L1184)

**Peripherals**

- DB matrix: attribution, a single live row, archived cases, member/inactive/foreign, anon.
  [`rls-isolation.test.ts:14529`](../../test/rls-isolation.test.ts#L14529)

- The 0022 shape and inventory.
  [`supabase-scaffold.test.ts:1852`](../../test/supabase-scaffold.test.ts#L1852)

- E2E: three overrides under a change; confirm, amend, discard.
  [`rotation.spec.ts:494`](../../e2e/tests/rotation/rotation.spec.ts#L494)

- E2E: a pending day shows the projection; it is removed, including on a no-rotation day.
  [`calendar.spec.ts:1360`](../../e2e/tests/calendar/calendar.spec.ts#L1360)

- A seeded change stamped after the override; cleanup scoped to the test's rows.
  [`database-helper.ts:423`](../../e2e/utils/database-helper.ts#L423)

- Copy: `rotation.builder.overrides.*`.
  [`hr.json:469`](../../apps/web/src/lib/i18n/locales/hr.json#L469)
