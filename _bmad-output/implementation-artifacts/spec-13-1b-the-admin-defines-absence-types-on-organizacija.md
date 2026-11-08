---
title: 'Story 13.1b: The admin defines absence types on Organizacija'
type: 'feature'
created: '2026-11-08'
status: 'done'
baseline_commit: '0fa3dd692dedbe632ecc99e22422c1e9f52966f6'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-13-1-absence-types-are-organization-data.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 13.1 (`0052`) lets an admin define absence types only through the API. No screen lists, adds or edits them, so epic 13.1 AC 1 ("when an admin defines one") is not met on screen.

**Approach:** A *Vrste odsutnosti* card on *Organizacija* lists the organization's types and whether each draws the allowance. *Dodaj* opens a dialog (name and drawing choice), and each row's *Uredi* opens the same form. Plain PostgREST writes under 0052's RLS. Baseline: 13.1's merge (`0fa3dd6`), because `hr.json` is a hot file.

## Boundaries & Constraints

**Always:**
- Product-owner decisions (2026-11-08): annual leave (fixed id `…0001`) can be renamed, never deleted, and always draws. In its *Uredi* dialog the drawing choice is disabled, with a hint that says why. No type is deleted in this story. The drawing flag of any other type can be changed (current state). Members do not see types.
- Writes go only to `absence_types`: insert `(organization_id, name, draws_allowance)` and update `(name, draws_allowance)`. `organization_id` comes from the session. An update that matches zero rows is a stale refusal.
- Refusals are mapped by constraint name, as hour bands do it (`hourBandWriteFailureOf`): `absence_types_organization_name_key` (23505) means the name is taken; `absence_types_name_not_blank`, `absence_types_name_length` and `absence_types_annual_draws` (23514); 42501 means refused; anything else means unavailable. The client checks the name first with `enteredName` and `NAME_MAX_LENGTH`.
- List order: annual leave first, then the rest by name in Croatian collation. Each row shows the name and *Troši dane godišnjeg* or *Ne troši dane godišnjeg*.
- Offline: the list's key joins `ORGANIZATION_SURFACE_KEYS` and `PERSISTED_KEY_ROOTS`, so the card is drawn with the page or the page is unavailable as one. Writes are gated by `useWriteGate`.
- Codes, not prose, in `.ts` services. Every string lives in `hr.json` under `organization.absenceTypes.*`. Buttons are `h-11`. A refusal is a `role="alert"` Notice inside its dialog, and a landed save is a `role="status"` on the card.

**Ask First:** any migration, any change to a leave function or report, or any `packages/domain` change.

**Never:**
- Delete, or a delete control.
- A member-facing surface or a member-role read.
- A type picker in the leave dialog or the request form, and any read of the type in a figure. All three are 13.2's.
- A warning about changing the drawing flag (13.2 decides it).
- Applying 0052 to the local stack, patching the harness, or running DB-connecting root tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List | fresh org | one row: *Godišnji odmor*, draws | read failure → card message, as hour bands do it |
| Add | *Bolovanje*, does not draw | dialog closes; row added; status notice | N/A |
| Add, no choice | name, no drawing choice | not sent | field message, choice required |
| Duplicate | ` godišnji odmor ` | dialog stays, value kept | name taken (23505) |
| Blank / too long | spaces / 101 chars | not sent | client message |
| Rename annual | *Godišnji* | saved, still draws | N/A |
| Annual drawing | Uredi on annual | drawing choice disabled | 23514 annual → own message if forced |
| Flip flag | *Edukacija* draws → not | saved | N/A |
| Stale / refused | type gone; member token | dialog stays | stale (0 rows) / refused (42501) |
| Offline | no network | Dodaj/Uredi gated, note | N/A |

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0052_absence_types.sql` -- the contract (read-only): columns, constraint names, grants, the fixed annual id
- `apps/web/src/features/hour-bands/services/list.ts` (`hourBandsQueryOptions:492`, `hourBandsSurfaceStateOf:545`, `hourBandsNoticeOf:565`, `readHourBands:141`) -- the read pattern to mirror
- `apps/web/src/features/hour-bands/services/write.ts` (`hourBandWriteFailureOf`, `settled`, the structural table seams) -- the write and refusal pattern to mirror
- `apps/web/src/features/hour-bands/components/hour-band-add-dialog.tsx` -- dialog form shape, non-dismissible while pending, the write gate
- `apps/web/src/features/organization/hooks/use-organization-hour-bands.ts` -- how a second read joins the page's snapshot (`useSnapshotFreshness`, `organizationRefusalOf`)
- `apps/web/src/features/organization/components/organization-fire-ranks-card.tsx` -- card header with an outline `Uredi`, a `RadioGroup` of two `RadioRow`s
- `apps/web/src/features/organization/components/organization-settings-card.tsx:80-90` -- card order; the new card goes after *Satni pojasi*
- `apps/web/src/pages/organizacija.tsx:39,72` -- hooks composed and passed down
- `apps/web/src/features/organization/services/surface-keys.ts:20` and `.test.ts` -- page key set and its pin
- `apps/web/src/lib/offline/persistence.ts:96-126` and `.test.ts` -- persisted roots and their list
- `apps/web/src/features/organization/utils/element-ids.ts` -- heading and field ids
- `apps/web/src/lib/i18n/locales/hr.json:~1160-1230` (`organization.*`) -- hot file
- `apps/web/src/pages/structural-pins-*.test.ts`, `key-sweep.test.ts`, `literal-sweep.test.ts` -- may need entries for the new query and keys
- `e2e/pages/organization.page.ts:78-116`, `e2e/tests/organization/settings-dialogs.spec.ts` -- page object and the dialog spec style; `e2e/utils/database-helper.ts` (`holdLock`, `holdFireRanks:1106`) -- the lock and SQL helper style

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/absence-types/services/list.ts` (+ `list.test.ts`) -- `ABSENCE_TYPES_TABLE`, `ABSENCE_TYPES_LIST_KEY = ['absenceTypes']`, row parsing, ordering, query options, surface state and notice, `isAnnualLeave(id)`
- [x] `apps/web/src/features/absence-types/services/write.ts` (+ `write.test.ts`) -- insert and update, the client name check, a required drawing choice, refusal mapping, zero rows means stale, message keys; the matrix rows as unit cases
- [x] `apps/web/src/features/organization/hooks/use-organization-absence-types.ts` -- the read inside the page snapshot, dialog state, writes, invalidating `ABSENCE_TYPES_LIST_KEY`
- [x] `apps/web/src/features/organization/components/organization-absence-types-card.tsx` -- the list, *Dodaj*, each row's *Uredi* (`aria-label` names the type), one shared form dialog
- [x] `organization-settings-card.tsx`, `pages/organizacija.tsx`, `surface-keys.ts(+test)`, `persistence.ts(+test)`, `element-ids.ts`, `hr.json` -- wire up, add the key and the strings
- [x] `apps/web/src/pages/structural-pins-*.test.ts` and the sweeps -- update only what the new files require
- [x] `e2e/tests/organization/absence-types.spec.ts`, `e2e/pages/organization.page.ts`, `e2e/utils/database-helper.ts` -- add a uniquely named type, rename it and flip its flag, see the duplicate refusal, see annual leave's choice disabled. A SQL helper deletes every type the run added in `finally`, and restores annual leave's name if a test renamed it, under one `holdLock('e2e-absence-types:<slug>')`. CI only.
- [x] `grep -rn` the `e2e/` folder for assertions on the card set or the page's regions, and update any that the new card breaks
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- prefix the 13.1b entry with `RESOLVED by 13.1b (<date>) — `

**Acceptance Criteria:**
- Given an admin on *Organizacija*, when the page loads online or from the offline snapshot, then *Vrste odsutnosti* is drawn with the other cards, or the page is unavailable as one.
- Given any write, when it lands, then only `absence_types` changed, and no leave figure, report or member surface changes.

## Design Notes

Types live on a card with dialogs, not on their own route like hour bands: there are few types, and they have no timeline. The drawing flag is a two-row radio, like fire ranks, rather than a switch, so it can start with neither row chosen. 0052 has no default ("an admin says it").

## Verification

**Commands:**
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm lint && PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm typecheck` -- pass
- `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" pnpm --filter ./apps/web exec vitest run` -- pass (stubbed tables, no DB)
- e2e is not run locally: the shared stack lacks 0048–0052, so the new spec fails there by design and runs in CI.

## Suggested Review Order

**The writes and their refusals**

- Entry point: insert and update only, tenant-filtered update, no delete.
  [`write.ts:255`](../../apps/web/src/features/absence-types/services/write.ts#L255)

- Refusals mapped by 0052's constraint names, read from the message only.
  [`write.ts:192`](../../apps/web/src/features/absence-types/services/write.ts#L192)

- Client check: name, required drawing choice, annual leave always draws.
  [`write.ts:152`](../../apps/web/src/features/absence-types/services/write.ts#L152)

**The list**

- Annual leave first, then Croatian collation.
  [`list.ts:130`](../../apps/web/src/features/absence-types/services/list.ts#L130)

- One query definition under `ABSENCE_TYPES_LIST_KEY`.
  [`list.ts:244`](../../apps/web/src/features/absence-types/services/list.ts#L244)

**State and screen**

- Read inside the page snapshot; save, refresh without holding the lock.
  [`use-organization-absence-types.ts:148`](../../apps/web/src/features/organization/hooks/use-organization-absence-types.ts#L148)

- The card: rows, Dodaj, per-row Uredi, one dialog, annual choice disabled.
  [`organization-absence-types-card.tsx:50`](../../apps/web/src/features/organization/components/organization-absence-types-card.tsx#L50)

- Strings under `organization.absenceTypes`.
  [`hr.json:1272`](../../apps/web/src/lib/i18n/locales/hr.json#L1272)

**Offline**

- The key joins the page's one snapshot and the persisted roots.
  [`persistence.ts:135`](../../apps/web/src/lib/offline/persistence.ts#L135)

**Peripherals**

- Feature boundary admits the two services.
  [`eslint.config.js:127`](../../eslint.config.js#L127)

- e2e lock and cleanup by name and name key, never the annual id.
  [`database-helper.ts:1144`](../../e2e/utils/database-helper.ts#L1144)

- e2e: add, rename, flip, duplicate refusal, annual disabled.
  [`absence-types.spec.ts:38`](../../e2e/tests/organization/absence-types.spec.ts#L38)

- e2e: offline gate on Dodaj, Uredi and Spremi.
  [`offline-write.spec.ts:579`](../../e2e/tests/offline/offline-write.spec.ts#L579)

- Unit cases for the matrix rows.
  [`write.test.ts`](../../apps/web/src/features/absence-types/services/write.test.ts)
