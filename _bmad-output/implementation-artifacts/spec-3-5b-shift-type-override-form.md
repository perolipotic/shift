---
title: 'Story 3.5b: An admin sets or removes a shift-type override'
type: 'feature'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '66a29f6612f48502b703c955cd7c4e6e90ee6a53'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-5a-shift-type-override-record-and-display.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 3.5a an override is recorded and shown, but only seeds write one. An admin can neither set one nor remove it, and 0019 leaves `removed_by`/`removed_at` with no writer.

**Approach:** From the day-detail Dialog, an admin sets an override (type + reason) with the existing insert, and removes it through a neutral `ConfirmDialog` that calls a new definer function, which attributes the removal on the server. The user decided on 2026-09-27: removal by a `SECURITY DEFINER` function (the first function that writes); no in-place change — to change an override, remove it and set a new one; refusals of "same as projected" and "no rotation" are the browser's; archived types are not offered; the form shows only when `snapshot.viewer.role` is `admin`, and the database still decides.

## Boundaries & Constraints

**Always:**
- **Migration `0021_remove_shift_type_override.sql`:** `remove_shift_type_override(p_override_id uuid) returns void`, plpgsql, `SECURITY DEFINER`, `set search_path = ''`. It sets `removed_by = auth.uid()` and `removed_at = now()` on the live row with that id in the claimed organization. It raises `42501` (`insufficient_privilege`) when the caller is not an active admin of that organization (via `current_member_access()`), and `P0002` (`no_data_found`) when no live row matches. Revoke execute from public, anon and service_role; grant it to authenticated. No table grant or policy changes.
- **Domain use, no projection in `apps/web`:** `DayDetail` gains `isoDate`, `projectedShiftTypeId` (from `scheduledShiftTypeOn`) and `override.id`. The form offers the snapshot's non-archived types other than the projected one, sorted as the snapshot sorts them.
- **Form (in the day detail, admin only):**
  - Shown when the day has a rotation and no override. The fields are Tip smjene, a native `Select`, and Razlog, an `Input` with `maxLength` 200. Save runs the insert (`organization_id` from the session claim, as in teams).
  - A preflight refuses a blank or over-long trimmed reason, and a type equal to the projected one, without a request.
  - When the day has an override, the admin sees "Ukloni izmjenu" instead. It opens a `ConfirmDialog` that names the team, the date and the projected type restored.
  - While a write is in flight, the day detail and the confirm cannot be dismissed, and their buttons are disabled (the #89 pattern: `dismissible={!pending}`). A refusal keeps what was entered, shows a `Notice role="alert"` inside the dialog, and focuses the refused field (or the first field).
  - On success, invalidate `CALENDAR_KEY` only. The detail re-derives, so the `✎` appears or disappears and the form or the remove action follows.
- **Refusals → keys** (`kalendar.detail.override.refused.*`):
  - 23514 or preflight on the reason → `reason` ("Upiši razlog, 1–200 znakova.")
  - preflight on the type → `sameAsProjected` ("To je već tip smjene prema rotaciji.")
  - 23505 → `taken` ("Za taj dan već postoji izmjena. Osvježi prikaz.")
  - P0002 → `gone` ("Izmjena je već uklonjena.")
  - 42501 → `denied` ("Ne možeš mijenjati izmjene. Za to trebaš ovlasti administratora.")
  - 23503 or anything else → `failed` ("Promjena nije uspjela. Pokušaj ponovno.")
- **Other copy:**
  - `kalendar.detail.override.set.{heading,type,reason,save,saving}`: "Promijeni tip smjene", "Tip smjene", "Razlog", "Spremi izmjenu", "Spremanje…"
  - `kalendar.detail.override.remove.{action,prompt,confirm,cancel,removing}`: "Ukloni izmjenu", "Ukloniti izmjenu za {team} · {date}? Vraća se {type} prema rotaciji.", "Ukloni", "Odustani od uklanjanja", "Uklanjanje…"
  - Register every key under "story 3.5b".

**Ask First:**
- an update or delete policy or grant on `shift_type_overrides`;
- any change to an existing override in place, or a replace function;
- a second query key or optimistic update;
- a new UI primitive (Textarea, Field).

**Never:**
- a write to any rotation row;
- a trigger;
- a hard delete;
- `destructive` or the accent on the form or the confirm;
- 3.5c's disposition;
- new dependencies or render tests;
- exposing `auth_user_id`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set | admin, Alfa projects Dan, picks Noć, reason "Zamjena" | row inserted; cell `✎` Noć; detail shows the block and "Ukloni izmjenu" | N/A |
| Same type | picks the projected type (not offered, guarded) | no request | `sameAsProjected` |
| Blank reason | `'  '` or 201 chars | no request; input kept | `reason` |
| No rotation | day `noRotation` | no form, no remove | N/A |
| Race | another admin set one first | input kept | `taken` |
| Remove | admin confirms | `removed_by` = caller, `removed_at` set; cell equals projection; form offered again | N/A |
| Removed twice | stale detail, already removed | refused | `gone` (P0002) |
| Member | member-role session | no form; rpc and insert refused | 42501 |
| Other org / inactive | rpc with an id from org B, or inactive admin | nothing changes | 42501 / P0002 |
| Re-set | after a removal, set again on that date | allowed (partial index) | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0019_shift_type_overrides.sql`: `_removal_complete` :92; partial index :103; admin select :112 and insert :133 (the `current_member_access()` admin conjunct to copy); grants :169-173; the removal comment :25-30 and :67-68 (point it at 0021); the definer read's shape :195-239. RLS is enabled, not forced, so the definer (owner) bypasses it.
- `supabase/migrations/0002_organizations_and_members.sql:185-222`: plpgsql definer precedent with `search_path = ''` and errcodes.
- `apps/web/src/features/calendar/utils/day-detail.ts`: `DayDetailOverride` :70, `DayDetail` :80-94, `dayDetailOf` :113 (`scheduledShiftTypeOn` call), `overrideOf` :187, `dayDetailShownOf` :236. The test is `day-detail.test.ts`.
- `apps/web/src/features/calendar/components/day-detail-dialog.tsx`: `renderOverride` :55, `renderDetail` :90 (the no-rotation branch :102), the `Dialog` :146 (add `dismissible`).
- `apps/web/src/features/calendar/hooks/use-day-detail.ts`: open/close state. The form's hook is new beside it; the page `apps/web/src/pages/kalendar.tsx:90-95` wires it.
- `apps/web/src/features/calendar/services/snapshot.ts`: `CALENDAR_KEY` :79, `CalendarViewer.role` :200 (its "authorizes nothing" comment becomes "shows the admin form; the database authorizes"), `CalendarSnapshot.types` (`ShiftTypeRow.archived`, `shift-types/services/list.ts:118`).
- Write precedent: `features/teams/services/write.ts`, with codes :100-102, `teamWriteFailureOf` :114 and `claimedOrganizationOf` :223. The hook precedent is `teams/hooks/use-team-list.ts:37-143`, with its latch, keep-and-focus, and invalidation. The dialog precedent is `teams/components/team-add-dialog.tsx:27-72`. `ConfirmDialog` is at `components/ui/dialog.tsx:146-177`; `Select`, `Input`, `Label` and `Notice` are in `components/ui/`.
- `apps/web/src/features/calendar/calendar-screen.fixture.ts:22-37`: `CALENDAR_SCREEN_PARTS`, which lists every new calendar file.
- Guards to revise (`features/calendar/services/snapshot.test.ts:964-1073`):
  - :1043 bans insert/update/delete/upsert. Allow `.insert(` and `.rpc(` only in the new write service, and keep the ban everywhere else.
  - :1071 allows one `queryKey:`; keep it.
  - :954-962 `SCREEN_SHOWS` counts and :1011-1025 `MODIFIER_OVERRIDDEN` counts: adjust, don't loosen.
- DB inventories:
  - `test/supabase-scaffold.test.ts`: definer and function inventory :1771-1804, the "removal is story 3.5b's" messages :1731-1735, no update/delete grant :1763 (still true), authenticated-only grants :280.
  - `test/rls-isolation.test.ts`: the 3.5a section :13810-end; add a 3.5b describe.
- i18n: `apps/web/src/lib/i18n/locales/hr.json:62`; `test/resource-hygiene.test.ts:928-940`; `test/localization-applied.test.ts:314,389`.
- E2E:
  - `e2e/tests/calendar/calendar.spec.ts`: the override describes :760 and :835.
  - `e2e/pages/calendar.page.ts:281` `overrideIn`: add the form and confirm locators and actions, with no assertions.
  - `e2e/utils/database-helper.ts`: `seedShiftTypeOverride` :358 and the cleanup :411.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0021_remove_shift_type_override.sql` -- the definer removal and its grants; update 0019's comment only if tests don't pin it -- attributed soft-remove
- [x] `test/supabase-scaffold.test.ts`, `test/rls-isolation.test.ts` -- inventories and messages. Rows:
  - admin removes: `removed_by`/`removed_at` set, and the rpc read omits the row;
  - member → 42501; other org / inactive → refused, and the row is unchanged;
  - twice → P0002; anon → no execute;
  - re-insert after removal succeeds;
  - rotation rows are byte-identical across set and remove.
  -- the DB matrix rows
- [x] `apps/web/src/features/calendar/utils/day-detail.ts` + test -- `isoDate`, `projectedShiftTypeId`, `override.id`; a pure `overrideTypeOptionsOf(snapshot, detail)` and a reason/type preflight -- the domain-fed choices
- [x] `apps/web/src/features/calendar/services/override-write.ts` + test -- `setShiftTypeOverride` (insert), `removeShiftTypeOverride` (rpc), and a failure-to-key map for each matrix code -- refusal mapping
- [x] `apps/web/src/features/calendar/hooks/use-override-form.ts`, `components/day-detail-dialog.tsx` (plus a new `override-form.tsx` if cleaner), `pages/kalendar.tsx` -- the admin form, the remove confirm, pending/dismissible, keep-and-focus, invalidate `CALENDAR_KEY` -- the UI
- [x] `snapshot.ts` comment, `calendar-screen.fixture.ts`, `snapshot.test.ts` guards -- the write allowed in one file only
- [x] `hr.json`, `resource-hygiene.test.ts`, `localization-applied.test.ts` -- the copy
- [x] `e2e/pages/calendar.page.ts`, `e2e/tests/calendar/calendar.spec.ts` -- at 1280 px, the admin sets Noć on Alfa today: `✎` and the block appear. They remove it via the confirm, and the cell is back to its projection. A blank reason shows `reason` and keeps the type. At 390 px a member sees no form in the detail.
- [x] `sprint-status.yaml` -- the comment notes that 3.5b has landed; the key stays in-progress for 3.5c

**Acceptance Criteria:**
- Given an override set then removed, when the month renders, then every cell and roster equals the pure projection, and the rotation rows are byte-identical to before (CAP-12, DI-2).
- Given a write in flight, when the admin presses Escape or clicks the backdrop, then neither dialog closes.
- Given the confirm, when it renders, then it is neutral, not `destructive`, and names what is removed and what is restored.

## Design Notes

A column default cannot attribute an UPDATE, and a client-supplied `removed_at` could be backdated, so removal is a definer function. That is a deliberate exception to "no new function", scoped to one soft-remove. Setting still uses the plain insert, whose `created_by` default and `WITH CHECK` already attribute it. The browser's preflights are a convenience; the database's checks and the partial index stay authoritative. "Same as projected" is checked in the browser, because the database cannot project.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips
- `pnpm test:e2e` -- green; stop Vite on 5173 first
- `git diff --stat package.json pnpm-lock.yaml` -- empty

**Manual checks:**
- In the demo org at 390 and 1280 px, in light and dark: set and remove an override as admin; as a member, see no form.

## Suggested Review Order

**The attributed removal**

- Entry point: the one definer that writes; the server attributes `removed_by`/`removed_at`.
  [`0021_remove_shift_type_override.sql:61`](../../supabase/migrations/0021_remove_shift_type_override.sql#L61)

- Execute is granted to authenticated alone; no table grant or policy changes.
  [`0021_remove_shift_type_override.sql:88`](../../supabase/migrations/0021_remove_shift_type_override.sql#L88)

**What the form may offer**

- Non-archived types other than the projected one, from the domain's projection.
  [`day-detail.ts:289`](../../apps/web/src/features/calendar/utils/day-detail.ts#L289)

- The preflight: type first, then the trimmed 1–200 reason.
  [`day-detail.ts:324`](../../apps/web/src/features/calendar/utils/day-detail.ts#L324)

- Admin only, and neither form nor removal on a no-rotation day.
  [`day-detail.ts:354`](../../apps/web/src/features/calendar/utils/day-detail.ts#L354)

**Writing and refusals**

- Postgres codes to the six refusals; 23503 and the unknown fall to `failed`.
  [`override-write.ts:88`](../../apps/web/src/features/calendar/services/override-write.ts#L88)

- Set is the plain insert, attributed by 0019's default and check.
  [`override-write.ts:132`](../../apps/web/src/features/calendar/services/override-write.ts#L132)

**The form's state**

- A write settled after the day changed reports nothing on the new day.
  [`use-override-form.ts:84`](../../apps/web/src/features/calendar/hooks/use-override-form.ts#L84)

- Focus moves a frame later, after `pending` clears, with a title fallback.
  [`use-override-form.ts:93`](../../apps/web/src/features/calendar/hooks/use-override-form.ts#L93)

- Set: latch, preflight, insert, invalidate the one key; `taken` refetches too.
  [`use-override-form.ts:114`](../../apps/web/src/features/calendar/hooks/use-override-form.ts#L114)

- Remove: `gone` refetches and closes the confirm.
  [`use-override-form.ts:191`](../../apps/web/src/features/calendar/hooks/use-override-form.ts#L191)

**The screen**

- The day detail holds while a write is in flight: backdrop, Escape, close button.
  [`day-detail-dialog.tsx:171`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L171)

- The form, the removal action and the neutral confirm.
  [`override-form.tsx:29`](../../apps/web/src/features/calendar/components/override-form.tsx#L29)

- The page wires the hook, composing only.
  [`kalendar.tsx:70`](../../apps/web/src/pages/kalendar.tsx#L70)

**Peripherals**

- The write is allowed in one calendar file only.
  [`snapshot.test.ts:989`](../../apps/web/src/features/calendar/services/snapshot.test.ts#L989)

- DB matrix: attribution, whole-row diff, member/inactive/cross-tenant, twice, re-set, anon.
  [`rls-isolation.test.ts:14282`](../../test/rls-isolation.test.ts#L14282)

- The function inventory and its shape.
  [`supabase-scaffold.test.ts:1810`](../../test/supabase-scaffold.test.ts#L1810)

- E2E: set, the held insert, removal via the confirm.
  [`calendar.spec.ts:873`](../../e2e/tests/calendar/calendar.spec.ts#L873)

- E2E: a removal answered `gone`, held while in flight.
  [`calendar.spec.ts:985`](../../e2e/tests/calendar/calendar.spec.ts#L985)

- E2E: a member at 390 px sees no form.
  [`calendar.spec.ts:1044`](../../e2e/tests/calendar/calendar.spec.ts#L1044)

- Copy: `kalendar.detail.override.{set,remove,refused}.*`.
  [`hr.json:69`](../../apps/web/src/lib/i18n/locales/hr.json#L69)
