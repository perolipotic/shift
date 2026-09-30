---
title: 'Story 3.6b: An admin adds, removes or replaces someone on a shift'
type: 'feature'
created: '2026-09-30'
status: 'done'
review_loop_iteration: 0
baseline_commit: '13a0c2ac82fbfe86a3ee0b2450dee23bcfd6617b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-6a-roster-override-record-and-display.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-5b-shift-type-override-form.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Since 3.6a a roster override is recorded and shown, but only seeds write one. An admin cannot take a member off a shift, put one on, or replace one, and nothing can remove a roster override. An inert override is shown nowhere.

**Approach:** From the day-detail Dialog, an admin saves one form with the optional fields "Skida se" and "Dolazi" plus a reason. The form writes one row with the existing insert: out only removes, in only adds, both replace. Each live change has a removal, confirmed in a neutral `ConfirmDialog`, that calls a new definer soft-remove. The human decided on 2026-09-30: one form with two fields; inert live overrides are listed to the admin with a removal; a candidate reads "Ime · čin · položaj" (out) or "Ime · čin · Smjena X" (in).

## Boundaries & Constraints

**Always:**
- **Migration `0027_remove_roster_override.sql`:** copy 0021 exactly. `remove_roster_override(p_override_id uuid) returns void` raises 42501 `ROSTER_OVERRIDE_REMOVAL_REFUSED` and P0002 `ROSTER_OVERRIDE_NOT_LIVE`, with execute granted to `authenticated` only. Point 0026's "3.6b's" comments at 0027 only if tests don't pin them. No table grant or policy change.
- **Candidates are derived against the default roster only** (`shiftRoster`, `activeOn`, `membershipOn` from `@shift/domain`), and only on a `DAY_WORKING` day:
  - Out: default-roster members.
  - In: members active on the date and not on the default roster, whose own team may work too.
  - Both lists exclude every member named, on either side, in any live override on that (team, date): applied, pending or inert.
  - Labels: out reads "Ime · čin · položaj"; in reads "Ime · čin · {team}" (the member's team on the date), or `noTeam`. Rank appears only when `usesFireRanks`. Lists are sorted as `snapshot.members`, and nothing warns, blocks or suggests.
- **Form** (admin only, `snapshot.viewer.role === 'admin'`; the database decides):
  - It has two native `Select`s with a "— nitko —" option and a reason `Input` with `maxLength` 200, and saves with the insert (org from `claimedOrganizationOf`).
  - The preflight refuses "no member chosen" and a blank or over-long trimmed reason, without a request.
  - Pending, dismissible, keep-and-focus, the stale-day latch and invalidating `CALENDAR_KEY` only follow 3.5b's hook. The day detail cannot be dismissed while either form writes.
- **Removal:**
  - A "Ukloni promjenu" action is offered on every applied, pending and inert entry.
  - Its confirm names the change, the team and the date, and says the roster returns to the rotation.
  - `gone` refetches and closes the confirm.
- **Inert:** `DayDetail.rosterInert` holds the live, in-force overrides on the (team, date) that `rosterOn` did not apply, on any kind of day. Only the admin sees the block.
- **Refusals** (`kalendar.detail.rosterChange.refused.*`):
  - preflight → `member` ("Odaberi koga skidaš, koga dodaješ ili oboje.")
  - preflight or 23514 → `reason` ("Upiši razlog, 1–200 znakova.")
  - 23505 → `taken` ("Taj je član već u promjeni za ovu smjenu. Osvježi prikaz.")
  - P0002 → `gone` ("Promjena je već uklonjena.")
  - 42501 → `denied` ("Ne možeš mijenjati sastav. Za to trebaš ovlasti administratora.")
  - 23503 or anything else → `failed` ("Promjena nije uspjela. Pokušaj ponovno.")
- **Copy** under `kalendar.detail.rosterChange`:
  - `set.{heading,out,in,none,reason,save,saving,noTeam}`: "Promjena sastava", "Skida se", "Dolazi", "— nitko —", "Razlog", "Spremi promjenu", "Spremanje…", "bez smjene"
  - `remove.{action,prompt,confirm,cancel,removing}`: "Ukloni promjenu", "Ukloniti promjenu „{change}" za {team} · {date}? Sastav se vraća prema rotaciji.", "Ukloni", "Odustani od uklanjanja", "Uklanjanje…"
  - `saved`, `removedDone`, `inertHeading`: "Promjena sastava je spremljena.", "Promjena sastava je uklonjena.", "Promjena sastava se ne primjenjuje"
  - Register all of them under "story 3.6b".

**Ask First:**
- an update or delete policy or grant on `roster_overrides`;
- a change in place, confirm or amend function, or builder disposition;
- folding chained overrides into the applies rule;
- a new UI primitive, a second query key, or an optimistic update.

**Never:**
- a write to a rotation, membership or status row;
- a trigger;
- a hard delete;
- roster derivation outside `@shift/domain` calls;
- `destructive` or the accent on the form or the confirm;
- rank-based warnings, sorting or filters;
- new dependencies or render tests;
- exposing `auth_user_id`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Replace | admin, Alfa works D; out A, in B, reason | one row; `✎`; "Zamjena: A → B"; A and B leave both candidate lists | N/A |
| Add / remove only | in C only, or out A only | one row with the other member null | N/A |
| Nothing chosen | both "— nitko —" | no request; input kept | `member` |
| Blank reason | `'  '` or 201 chars | no request; input kept | `reason` |
| Off / no rotation | day not working | no form; removals of any listed entries remain | N/A |
| Race | another admin used A first | input kept; refetch | `taken` |
| Remove | admin confirms on an applied entry | `removed_by` = caller; default roster exactly; A and B offered again | N/A |
| Remove pending / inert | removal on those entries | row soft-removed; block disappears | N/A |
| Removed twice | stale detail | confirm closes; refetch | `gone` (P0002) |
| Member | member-role session | no form, no removal, no inert block; rpc and insert refused | 42501 |
| Other org / inactive admin | rpc with an org-B id, or inactive admin | nothing changes | 42501 / P0002 |

</frozen-after-approval>

## Code Map

- `supabase/migrations/0021_remove_shift_type_override.sql:54-88` -- the definer to copy. `0026_roster_overrides.sql`: comments :29-31, :49-50 and :77-78 name 3.6b; the live indexes :128-134 (why candidates exclude named members); grants :191-196 stay.
- `packages/domain/src/roster.ts`: `activeOn` :109, `membershipOn` :122, `shiftRoster` :137, and `rosterOn` :294, whose `applied` gives inert as in-force minus applied. `rosterOverrideApplies` :265 stays internal. Exports are at `index.ts:83-97`.
- `apps/web/src/features/calendar/utils/day-detail.ts`:
  - `DayDetailMember` :77, `DayDetailRosterChange` :139 and `DayDetail` :153-177: add `rosterInert` and the entry fields the removal prompt needs.
  - `dayDetailOf` :202: pending :216-219, applied :254/:275.
  - `rosterChangeOf` :306; `overrideOffersOf` :513 is the admin gate; `overrideRemovalTargetOf` :524-543. Add `rosterOffersOf`, `rosterEntryOf` (the preflight) and `rosterRemovalTargetOf` beside them.
- `utils/month.ts:119` `rosterStandingOfCalendar` gives the in-force and pending split.
- `services/override-write.ts`: the error map :88-95, `settled` :98, the insert :132, the rpc :155 and the message keys :181/:203. Mirror them in a new `services/roster-write.ts`.
- `hooks/use-override-form.ts:59-275`: copy it to `hooks/use-roster-form.ts` (the latch, `stillOn`, `focusLater`, and invalidation on success, `taken` and `gone`).
- `components/override-form.tsx`: copy `OverrideSetForm` :38 and `OverrideRemoveConfirm` :169 into a new `roster-form.tsx`.
- `components/day-detail-dialog.tsx`:
  - `renderRosterChanges` :153 gains an optional per-entry removal. The inert block reuses it.
  - `renderDetail` :199-258 places the form after the changes on working days.
  - `DayDetailDialog` :280 ORs both pendings into `dismissible`; the confirm sits outside the Dialog (:329).
- `pages/kalendar.tsx:70,97-100` wires the hook, composing only.
- `services/snapshot.ts`: `CalendarMember` :225, `usesFireRanks`, `rosterOverrides` :294, and the `CalendarViewer.role` comment :237.
- Guards in `services/snapshot.test.ts`: `DETAIL_CARRIES`/`SCREEN_SHOWS` :1075-1087 (adjust, don't loosen); `.insert(`/`.rpc(` :1174-1177 (allow exactly one of each in `roster-write.ts`); one `queryKey` :1202. Also `calendar-screen.fixture.ts:59` and `CALENDAR_SCREEN_PARTS`.
- DB tests:
  - `test/rls-isolation.test.ts`: the 3.5b removal describe :14792 to copy; 3.6a :15400.
  - `test/supabase-scaffold.test.ts`: the 3.5b function test :1867-1906, 3.6a :2003-2136.
  - `test/provisioning.test.ts`: `ACCESS_CONTROL_FUNCTIONS` :1634, grantees :1689-1746, definer attributes :254-324.
- i18n: `hr.json` `rosterChange` :62-68; `test/resource-hygiene.test.ts` (the 3.6a block ends :1019); `test/localization-applied.test.ts:546-554`.
- E2E: `e2e/pages/calendar.page.ts:273-371` (add locators and actions for the roster form, the removal and the inert block, with no assertions); `calendar.spec.ts` 3.6a :902-1110 and 3.5b :1111/:1289; `e2e/utils/database-helper.ts` `seedRosterOverride` :478 and cleanup :666.
- `deferred-work.md:567-581`: close :567 and :579 (offered against the default roster only). :570 (builder disposition) stays open.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0027_remove_roster_override.sql` -- the definer and its grants -- attributed soft-remove
- [x] `test/supabase-scaffold.test.ts`, `rls-isolation.test.ts`, `provisioning.test.ts` -- inventories plus these rows:
  - admin removes: attributed, and the rpc omits the row;
  - member → 42501; other org or inactive admin → the row is unchanged;
  - twice → P0002; anon → no execute;
  - re-insert after removal succeeds;
  - rotation, membership and status rows are byte-identical across insert and removal.
  -- the DB matrix
- [x] `calendar/utils/day-detail.ts` + test -- `rosterInert`, candidates with labels and exclusions, the preflight, the removal target; the matrix rows on both fixtures -- the choices
- [x] `calendar/services/roster-write.ts` + test -- insert, rpc, and a failure-to-key map for each code -- refusals
- [x] `hooks/use-roster-form.ts`, `components/roster-form.tsx`, `day-detail-dialog.tsx`, `pages/kalendar.tsx` -- the form, removals, the inert block, the confirm, and the held dialog -- the UI
- [x] `snapshot.ts` comment, `calendar-screen.fixture.ts`, `snapshot.test.ts` -- the guards, with the write allowed in `roster-write.ts` only
- [x] `hr.json`, `resource-hygiene.test.ts`, `localization-applied.test.ts`, `pages/prijava.test.ts` -- the copy
- [x] `e2e/pages/calendar.page.ts`, `e2e/tests/calendar/calendar.spec.ts`, `database-helper.ts` -- the e2e flow:
  - at 1280 px the admin replaces A with B on Alfa today: `✎`, "Zamjena", B's name and rank shown as a candidate;
  - the admin removes it via the confirm, and the roster is back to default;
  - "nothing chosen" shows `member`;
  - a seeded inert override is listed and removed;
  - at 390 px a member sees no form, no removal and no inert block.
- [x] `sprint-status.yaml`, `deferred-work.md` -- 3.6 → done; close :567 and :579

**Acceptance Criteria:**
- Given a replace written then removed, when the month renders, then every roster and every member's month equals the default derivation, and the rotation, membership and status rows are byte-identical to before (CAP-12, DI-2).
- Given a write in flight, when the admin presses Escape or clicks the backdrop, then neither dialog closes.
- Given the confirm, when it renders, then it is neutral and names the change, the team and the date.

## Design Notes

A single row per action means one insert serves all three actions. The two fields map straight onto `member_out_id` and `member_in_id`, and the `_member_present` check backs the "nothing chosen" preflight. Excluding every member named in a live override on that shift keeps the partial indexes from answering `taken` in the normal case. It also means a change is always made against the default roster: to change a change, remove it and save a new one. That sidesteps the chaining limit. Inert is `inForce − applied`, so no domain export is needed.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips
- `pnpm test:e2e` -- green; stop Vite on 5173 first
- `git diff --stat package.json pnpm-lock.yaml` -- empty

**Manual checks:**
- In the demo org at 390 and 1280 px, in light and dark: as admin, replace, add and remove a change; as a member, see no form.

## Suggested Review Order

**The attributed removal**

- Entry point: 0021's soft-remove copied; the server stamps `removed_by`/`removed_at`.
  [`0027_remove_roster_override.sql:69`](../../supabase/migrations/0027_remove_roster_override.sql#L69)

- 42501 unless an active admin, P0002 when no live row; execute for authenticated only.
  [`0027_remove_roster_override.sql:64`](../../supabase/migrations/0027_remove_roster_override.sql#L64)

**What the form may offer**

- Admin only, working day, non-archived team; candidates against the default roster, named members excluded.
  [`day-detail.ts:632`](../../apps/web/src/features/calendar/utils/day-detail.ts#L632)

- Inert = in force but not applied, on any kind of day.
  [`day-detail.ts:237`](../../apps/web/src/features/calendar/utils/day-detail.ts#L237)

- Candidate lines: "Ime · čin · položaj" out, "Ime · čin · {team}" in.
  [`day-detail.ts:713`](../../apps/web/src/features/calendar/utils/day-detail.ts#L713)

- Preflight: a member chosen, not the same on both sides, then the 1–200 reason.
  [`day-detail.ts:775`](../../apps/web/src/features/calendar/utils/day-detail.ts#L775)

**Writing and refusals**

- Insert codes: member checks → member, other 23514 → reason, 23505 → taken.
  [`roster-write.ts:99`](../../apps/web/src/features/calendar/services/roster-write.ts#L99)

- Removal codes: 42501 → denied, P0002 → gone, else failed.
  [`roster-write.ts:116`](../../apps/web/src/features/calendar/services/roster-write.ts#L116)

- One plain insert serves add, remove and replace; defaults attribute it.
  [`roster-write.ts:162`](../../apps/web/src/features/calendar/services/roster-write.ts#L162)

**The form's state**

- Shares the override form's latch: one write at a time in the whole day detail.
  [`use-roster-form.ts:62`](../../apps/web/src/features/calendar/hooks/use-roster-form.ts#L62)

- A change that vanished under an open confirm closes it as `gone`.
  [`use-roster-form.ts:103`](../../apps/web/src/features/calendar/hooks/use-roster-form.ts#L103)

- The page passes the override latch in, composing only.
  [`kalendar.tsx:76`](../../apps/web/src/pages/kalendar.tsx#L76)

**The screen**

- A removal per listed change; each form's buttons wait for the other's write.
  [`day-detail-dialog.tsx:192`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L192)

- The two-field form, placed after the changes on working days.
  [`day-detail-dialog.tsx:296`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L296)

- The form and the neutral confirm naming change, team and date.
  [`roster-form.tsx:61`](../../apps/web/src/features/calendar/components/roster-form.tsx#L61)
  [`roster-form.tsx:224`](../../apps/web/src/features/calendar/components/roster-form.tsx#L224)

**Peripherals**

- DB matrix: attribution, member/inactive/cross-tenant, twice, re-insert, byte-identical rows.
  [`rls-isolation.test.ts:15878`](../../test/rls-isolation.test.ts#L15878)

- The write allowed in `roster-write.ts` only.
  [`snapshot.test.ts:1196`](../../apps/web/src/features/calendar/services/snapshot.test.ts#L1196)

- E2E: replace held in flight, remove, nothing chosen, inert, gone, taken.
  [`calendar.spec.ts:1120`](../../e2e/tests/calendar/calendar.spec.ts#L1120)

- E2E at 390 px: admin without sideways scroll; member sees nothing to change.
  [`calendar.spec.ts:1355`](../../e2e/tests/calendar/calendar.spec.ts#L1355)

- Copy: `kalendar.detail.rosterChange.{set,remove,refused}.*`.
  [`hr.json:62`](../../apps/web/src/lib/i18n/locales/hr.json#L62)
