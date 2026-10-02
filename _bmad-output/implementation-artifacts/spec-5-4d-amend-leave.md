---
title: 'An admin resolves a conflict by amending the leave (5.4d)'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_commit: 'c4467e40d519f93a05b64baeecc5e6a91a826e70'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The resolution screen offers two outcomes. An admin who decides the member works that day after all must leave the screen, find the member, and work out the leave range by hand.

**Approach:** Add the "Izmijeni godišnji odmor" card at fixed position 3. It states a computed range that would clear this conflict, and its consequence strip is in the same three terms as the other cards. Saving writes nothing. It opens the member page's Godišnji card in amend mode with that range filled in, or opens the record's removal confirmation. The conflict then clears by derivation once the admin saves the amend (5.4a).

## Boundaries & Constraints

**Always:**
- **Date rule (human, 2026-10-02, rule A).** The leave record covering the conflict runs from `from` to `to`, and the conflict date is `d`.
  - `d < to`: the new range is `d+1` to `to` ("godišnji počinje {d+1}").
  - `d = to > from`: the new range is `from` to `d−1` ("godišnji završava {d−1}").
  - `from = to = d`: removal ("ovaj godišnji se briše").
  - A computation, not a recommendation. The card is unselected and never says "preporučeno".
- **No resolution row (human, 2026-10-02).** Card 3 writes nothing to `conflict_resolutions`, and `amend_leave` stays unused. Cancelling on the member page leaves the conflict open.
- **Card 3 text.**
  - Title: "Izmijeni godišnji odmor".
  - Body: "{name} radi {d}, a godišnji počinje {date}." (or "završava {date}." or "a ovaj godišnji se briše."), followed by "Otvara izmjenu godišnjeg s tim datumom." (removal: "Otvara brisanje godišnjeg.").
  - Strip:
    - coverage: "{covered+1} od {total} člana · {name} radi";
    - hours: "{hours} rada" (`noHours` for an untimed shift);
    - balance: "{after} dana preostalo · +{N} dan(a)".
  - `after` and `N` come from the conflict date's leave year, as cards 1 and 2 use. `after` is computed with `leavePreviewStateOf(…, newRange, record)`; for removal, it is the balance without the record. `N` is `after` minus the current balance.
- **Hint.**
  - With nothing chosen, the hint becomes "Odaberi jednu od tri odluke.".
  - With card 3 chosen, the hint reads "Spremi otvara izmjenu godišnjeg s datumom {date}." (removal: "Spremi otvara brisanje ovog godišnjeg."). Spremi is ready as soon as the card is chosen.
- **Hand-off.**
  - Saving navigates to `/ljudi/$memberId`. Router state, as `withResolutionSaved` uses, carries the record id, the range or removal, and the conflict's origin. Nothing goes in the URL.
  - Once the leave rows are ready, the Godišnji card opens once: amend mode for that record with the fields set to the computed range, or that record's removal confirmation. Focus goes to the od field or the confirmation.
  - If the record is gone, nothing opens and the card stays as it was.
- **Way back (human, 2026-10-02).** While the page was reached from a conflict, it shows a "Natrag na konflikte" link to `/raspored` beside the existing back link.
- Arrow keys move across all three cards. Every string goes through `t()`. In the same PR, update the UX docs and UX-DR10/11.

**Ask First:**
- Any migration, or any write of an `amend_leave` row.
- Changing 0029/0031's amend or removal behaviour.

**Never:**
- No replace-member guard on the leave screen (that is 5.4e).
- No preselected card or date, and no bulk clearing.
- No new leave write path. The member page's existing amend and remove do the write.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First day | 02.–09.10., d=02.10. | "počinje 03.10."; "4 od 4 člana · Mirela radi", "12 h rada", "17 dana preostalo · +1 dan" | N/A |
| Mid range | 02.–09.10., d=06.10. | "počinje 07.10."; +N counts every day dropped | N/A |
| Last day | 02.–09.10., d=09.10. | "završava 08.10." | N/A |
| One day | 02.–02.10., d=02.10. | removal text; Spremi opens the removal confirmation | N/A |
| Year edge | record spans 31.12./01.01. | after and N in d's leave year | N/A |
| Save | card 3, Spremi | member page, amend form 03.10.–09.10., no row written | N/A |
| Amend | admin saves the amend | conflict gone from the queue via "Natrag na konflikte" | existing leave refusals |
| Gone | record removed before arrival | nothing opens | N/A |

## Epic AC Deviations

- **INTERPRETED:** "carries the computed start date". The rule moves the end date when the conflict is the record's last day, and removes a one-day record (human, rule A).
- **INTERPRETED:** "recorded … with the acting admin" (AD-4). The amend outcome records no resolution. The leave amend is the attributable write, and the conflict clears by derivation (human).
- **DEFERRED:** "amending leave never silently reverts a replacement". This is story 5.4e, already in `deferred-work.md`.

</frozen-after-approval>

## Code Map

Paths are under `apps/web/src` unless they say otherwise.

- `features/conflicts/services/resolution-screen.ts`:
  - card ids :86-113 (add the AMEND id trio) and `RESOLUTION_OPTIONS` :95;
  - `ResolutionView` :167-212 (add the record id, the ISO range and the amend target);
  - `resolutionScreenFrom` :371-479, where the record is at :414 (`base.rows`, `record.record` `{id, from, to}`) and the balance at :470;
  - `saveHintMessageKey` :503, `readyToSave` :520, `saveFocusOf` :535 and `resolutionOptionOf` :604;
  - `withResolutionSaved` :611 is the router-state pattern to copy.
- `lib/i18n/format.ts:271` `nextIsoDate`. Add `previousIsoDate` beside it.
- `features/leave/services/leave-section.ts:325` `leavePreviewStateOf(input, from, to, amending)`, plus `leaveBalanceOf` for the removal case.
- `features/conflicts/hooks/use-conflict-resolution.ts`:
  - `save` :252. Handle amend BEFORE the accept fall-through at :276, with no pending, no write and no `landed`.
  - `navigate` :118.
- `components/resolution-option.tsx`: `ConsequenceStrip` :130 hard-codes the hours and `balanceUnchanged`, so parametrize it. `conflict-resolution-body.tsx`: the group is at :175-187.
- `features/leave/hooks/use-member-leave.ts`:
  - `fillFields` :221, `startAmend` :246 and `openRemove` :268 need a variant with no event and a null return target.
  - The effect at :196-208 clears the targets until the leave rows are ready, so open once after `LEAVE_READY`, guarded by a ref.
- `pages/ljudi.$id.tsx` -- the back link is at :43-48. The card at :65 takes the hand-off.
- Registries:
  - `lib/i18n/locales/hr.json`: `raspored.resolution` :168 (`hintChoose` :207) and `ljudi.form`;
  - `test/resource-hygiene.test.ts`: plural keys :120 and screen keys :1272/:1138;
  - `pages/prijava.test.ts`: resolution strings :2282, keys :2292, and member edit :659/:2484;
  - the fixtures `conflicts-screen.fixture.ts:22` and `leave-screen.fixture.ts:23`.
- e2e:
  - `e2e/tests/conflicts/conflict-resolution.spec.ts`: `scenarioOf` :95 (the record runs today to today+4, so it has first-day and last-day conflicts); the option count at :157, `hintChoose` at :161 and the two-card arrows at :417.
  - `e2e/pages/conflicts.page.ts:71` (add `amendOption`) and `e2e/pages/people.page.ts` (leave inputs ~:184 and the remove confirm :249).
- Docs: `ux-shift-2026-09-02/EXPERIENCE.md` :95-98 and `DESIGN.md` :294, plus `epics.md` UX-DR10/11 :120-121.

## Tasks & Acceptance

**Execution:**
- [x] `lib/i18n/format.ts` and its test -- `previousIsoDate`.
- [x] `features/conflicts/services/resolution-screen.ts` and its test -- the amend option, the target rule, the strip figures, the hint, the focus and the hand-off state. Cover every matrix row except Amend.
- [x] `features/conflicts/components/` and `hooks/use-conflict-resolution.ts` -- card 3, the parametrized strip, and the save branch that navigates.
- [x] `features/leave/hooks/use-member-leave.ts`, `services/leave-section.ts` and their tests, `pages/ljudi.$id.tsx` -- open the hand-off once, plus the "Natrag na konflikte" link.
- [x] `hr.json` and the registries.
- [x] `e2e/` -- page objects, and specs for: card 3 by keyboard → member page with the amend form prefilled → save → back to the queue without the conflict; a one-day record → removal confirmation; arrows across three cards; no row written.
- [x] Docs: UX docs and UX-DR10/11. In `deferred-work.md`, mark the 5.4d entry, the `amend_leave` entry and the hint entry resolved. `sprint-status.yaml`: 5-4d.

**Acceptance Criteria:**
- Given the resolution screen, when only the keyboard is used, then the admin can choose card 3, save, and land in the prefilled amend form with focus in it.
- Given 390 px, when card 3 is shown, then there is no horizontal scroll and its strip wraps.
- Given the member page reached from a conflict, when the admin cancels the amend, then "Natrag na konflikte" returns to a queue that still lists the conflict.

## Design Notes

Why no row: under 5.4a's lifetime rule, an amend that uncovers `d` already removes the conflict by derivation, and 0029 soft-removes any resolution on the dates it drops. A live `amend_leave` row on a date the leave still covers would hide a conflict nobody decided.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: exit 0
- `pnpm build && pnpm test` -- expected: all green (shared stack, no `db:reset`)
- `pnpm exec playwright test conflicts people` -- expected: green

## Suggested Review Order

**The amend rule**

- Entry point: rule A, start after the conflict, end before it, or remove a one-day record.
  [`leave-section.ts:618`](../../apps/web/src/features/leave/services/leave-section.ts#L618)

- The gain is counted in the conflict date's leave year, against the amended record.
  [`resolution-screen.ts:228`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L228)

- The hint names the date; Spremi is ready as soon as card 3 is chosen.
  [`resolution-screen.ts:605`](../../apps/web/src/features/conflicts/services/resolution-screen.ts#L605)

**The screen**

- Card 3 in the same radio group, so the arrows cross all three.
  [`resolution-option.tsx:140`](../../apps/web/src/features/conflicts/components/resolution-option.tsx#L140)

- The strip now takes its hours and balance terms as props.
  [`resolution-option.tsx:214`](../../apps/web/src/features/conflicts/components/resolution-option.tsx#L214)

- Save navigates with the hand-off in router state and writes nothing.
  [`use-conflict-resolution.ts:278`](../../apps/web/src/features/conflicts/hooks/use-conflict-resolution.ts#L278)

**The hand-off on the member page**

- The target is recomputed from the current record; nothing opens if it no longer covers the date.
  [`leave-section.ts:753`](../../apps/web/src/features/leave/services/leave-section.ts#L753)

- Opens once per hand-off, then replaces the history entry without the opening part.
  [`use-member-leave.ts:229`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L229)
  [`leave-section.ts:680`](../../apps/web/src/features/leave/services/leave-section.ts#L680)

- "Natrag na konflikte" comes from the origin key, so it survives that replace.
  [`ljudi.$id.tsx:67`](../../apps/web/src/pages/ljudi.$id.tsx#L67)

**Tests**

- Rule, strip figures, year edge and hint.
  [`resolution-screen.test.ts:657`](../../apps/web/src/features/conflicts/services/resolution-screen.test.ts#L657)

- Hand-off parse, recompute, gone, lengthened and shrunk records.
  [`leave-section.test.ts:728`](../../apps/web/src/features/leave/services/leave-section.test.ts#L728)

- e2e: keyboard amend end to end, reload, no resolution write, one-day removal.
  [`conflict-resolution.spec.ts:760`](../../e2e/tests/conflicts/conflict-resolution.spec.ts#L760)
  [`conflict-resolution.spec.ts:880`](../../e2e/tests/conflicts/conflict-resolution.spec.ts#L880)

- The day before a date, with its lower edge.
  [`format.ts:293`](../../apps/web/src/lib/i18n/format.ts#L293)
