---
title: 'The leave dialog shows what a record costs and creates before saving (7.12)'
type: 'feature'
created: '2026-10-08'
status: 'done'
baseline_commit: '3aaac60153c0ca21e55a42c1f25a4234210a9a54'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The leave card's od–do form is the last form mounted on the member page. Its preview shows the cost and the balance after the save, but not the conflicts the record will create. An amend shows no *bilo / sada* and does not say which conflicts clear.

**Approach:** Follow `mockups/leave-1.html` §2–3. *Upiši godišnji* in the card header opens the *Upiši godišnji odmor* dialog, and a record's *Izmijeni* opens *Izmijeni godišnji odmor {od}–{do}*. Both dialogs hold od/do and a computed preview: the cost, the balance after the save and the conflicts. The amend dialog also shows *Bilo / Sada* and which conflicts clear and which stay. The conflicts come from the domain's `collisionsOf` through the queue's own `collisionInputOf` / `resolutionsOf`.

## Boundaries & Constraints

**Always:**
- Use the dialog pattern of 7.9/7.11 (`member-allowance-dialog.tsx`, `use-member-edit.ts` `DialogOpening`). The hook owns the opening and its opener ref. Each opening renders a fresh keyed body.
  - While the write is pending, the dialog cannot be dismissed.
  - A refusal keeps the dialog open, with the entered values and a `Notice role="alert"` above the buttons.
  - A landed save or amend closes the dialog and shows the shipped saved/amended line as a `Notice role="status"` on the card. Focus returns to the opener. For an amend that opener is its row's *Izmijeni*, or `listHeading` when there is no opener (hand-off).
  - An amended record that a re-read finds gone closes the dialog, and the list says so (shipped `gone`).
- One computation. A new `leave/services/leave-conflicts.ts` derives the conflict preview from the snapshot, the resolution rows and this member's records, with the candidate range in place of the amended record. It uses `collisionInputOf` + `collisionsOf`, and `unresolvedCollisionsOf` with `resolutionsOf`. It returns codes and operands only (date, short weekday, shift type name). It returns *unknown* while the resolutions read is pending, failed or paused, or when the domain throws.
  - A new record: *created* is every unresolved collision of the candidate.
  - An amend: *cleared* is the target's unresolved collisions that "after" no longer raises. *Kept* is those it still raises. *Created* is the collisions "after" raises that "before" did not.
  - A removal: *cleared* is all of the record's unresolved collisions.
- The conflict lines are neutral text: no `destructive` styling and no ⚠. They never gate the save, and neither does an over-balance figure (UX-DR23). They sit in the existing polite live region beside the 5.4e replacement lines.
- The removal stays the shipped single neutral `ConfirmDialog`. It gains one line naming the conflicts it clears, when there are any.
- `leave` reaches `conflicts` only through `FEATURE_PUBLIC`: add `leave` to the `services/conflicts-queue` comment. `leave-section.ts` must not import `conflicts-queue`, because that would be a cycle. Every literal goes in `hr.json`.
- Docs go in the same PR: EXPERIENCE.md L98 (*Member page*: no mounted form left), L66, L101, L123; DESIGN.md L290 (Dialog row adds 7.12); epics.md UX-DR23 L135 (since 7.12 the leave dialog computes cost, balance and conflicts before its Save). sprint-status: 7.11 → done, and 7.12 moves with the workflow.

**Ask First:** a migration, an RPC or Edge Function change, any change to `packages/domain`, a new dependency.

**Never:** a second collision or cost computation; an od/do field mounted outside a dialog; `destructive` styling on a preview, a removal or a button; toasts or standing banners; blocking a save on conflicts, on an unknown preview or on the balance.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New, collides | range over 4 working shifts of her team | cost 4, balance after, `Spremanjem nastaju 4 konflikta s rasporedom.` + the dated lines (`pon 21.12. Dan`) + where they are resolved | N/A |
| New, none | range over free days only | cost 0 and `Spremanjem ne nastaje nijedan konflikt.` | N/A |
| Amend shorter | 02.10.–09.10. → 02.10.–05.10. | *Bilo* range · 4 dana, *Sada* range · 2 dana, balance after; `Uklanjaju se 2 konflikta (…)`, `Ostaju 2 (…)` | N/A |
| Amend longer | end moved over a new working shift | also `Nastaje 1 novi konflikt (…)` | N/A |
| Unknown | resolutions pending/failed, or the domain throws | `Konflikte sada ne mogu provjeriti.`; Spremi stays enabled | logged, never thrown |
| Refusal | overlap or denied | dialog stays open, values kept, alert above the buttons | shipped refusal keys |
| Hand-off (5.4d) | arrives from a conflict with a computed range | the amend dialog opens once, prefilled, od focused | a gone record opens nothing (shipped) |
| Remove | Ukloni on a record with 4 unresolved | the shipped question + `Uklanjaju se i 4 neriješena konflikta.` | refusal stays inside (shipped) |

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/leave/components/member-leave-card.tsx` -- form L273-328 and `renderPreview` L156-189 move into a new `member-leave-dialog.tsx`. The card keeps the figures, the slot, the records and the status notice (`renderOutcome` L192-237: the alert part moves into the dialog).
- `apps/web/src/features/leave/components/member-leave-records.tsx` -- `MemberLeaveRemoveConfirm` L172: the cleared line. Row *Izmijeni* L124 is the amend opener.
- `apps/web/src/features/leave/hooks/use-member-leave.ts` -- mount mirror L220-223 (drop it; the body mounts on open). `fillFields` L368 runs after mount (`focusLater`) or switches to `defaultValue`. Hand-off L305-342. Gone-record effect L291-303 closes the dialog. `startAmend` L393 / `cancelAmend` L404 become open/close. `save` L461 (`formField.reset()` L512-521 → close) and `amend` L550 (603-614): focus to the opener, not `noticeField`. Return L688-723: add `recordDialog`/`amendDialog` `{opener, opening, open, close}`, the conflict preview, and `removeConflicts`.
- `apps/web/src/features/leave/services/leave-section.ts` -- `leavePreviewStateOf` L367 (cost/balance, reuse as is), `replacementGuardOf` L569 (model for the unknown state), `FETCH_PAUSED`.
- `apps/web/src/features/conflicts/services/conflicts-queue.ts` -- `collisionInputOf` L120 (takes `OrganizationLeaveRecord` = `LeaveRecord` + `memberId`; map the hook's records), `resolutionsOf` L171 (throws on untrusted rows), `conflictsQueueViewOf` L199 (pattern for the team/type maps).
- `packages/domain/src/collisions.ts` -- `collisionsOf` L159, `unresolvedCollisionsOf` L230, `collisionKeyOf` L87. Read only.
- `apps/web/src/lib/i18n/format.ts` -- `formatIsoWeekdayShortName` L453, `formatIsoDayMonth` L356.
- `apps/web/src/components/ui/dialog.tsx` -- `Dialog` (`open`, `onOpenChange`, `dismissible`), `DialogHeader`, `DialogFooter`, `ConfirmDialog`. Model: `members/components/member-allowance-dialog.tsx` L40-142, `use-member-edit.ts` `DialogOpening` L131, open/close L513-536, landed save L613-620.
- `eslint.config.js` L175 -- conflicts `services/conflicts-queue` consumers comment.
- `apps/web/src/lib/i18n/locales/hr.json` -- `ljudi.leaveRecord` L700-755 (no conflict/bilo/sada/open keys yet).
- `apps/web/src/features/leave/services/leave-section.test.ts` -- preview fixtures L321-424, amend L612-639, guard fixtures L858-927 (models for the new `leave-conflicts.test.ts`).
- `e2e/pages/people.page.ts` L374-523 -- re-scope the form locators to the dialog (allowance dialog L211-223 is the pattern). `enterLeave` L520 opens it first.
- e2e churn: `tests/people/leave.spec.ts` (most), `conflicts/conflicts-queue.spec.ts`, `conflicts/conflict-resolution.spec.ts` (hand-off), `calendar/calendar-conflicts.spec.ts`, `leave/my-leave.spec.ts` L187, `hours/hours.spec.ts` L938, `people/people.spec.ts` (the "no `<form>` outside the leave card" assertion becomes none at all).

## Tasks & Acceptance

**Execution:**
- [x] `leave/services/leave-conflicts.ts` + `leave-conflicts.test.ts` -- created / cleared / kept / unknown per the matrix, over a real snapshot fixture -- the one derivation
- [x] `leave/hooks/use-member-leave.ts` -- openings, opener refs, no dismiss while pending, close on a landed write, the hand-off opens the amend dialog, conflict preview and removal lines wired -- wiring
- [x] `leave/components/member-leave-dialog.tsx` (new), `member-leave-card.tsx`, `member-leave-records.tsx` -- header *Upiši godišnji*, the dialog with the preview, *Bilo / Sada*, the conflict lines, the removal line -- surface
- [x] `hr.json`, `eslint.config.js` -- keys (plural-aware counts); the consumers comment -- i18n, boundaries
- [x] `e2e/pages/people.page.ts` + the specs above -- drive the dialogs; assert the created count for a colliding range, the amend's cleared/kept lines, no `<form>` on the page, 390 px -- churn
- [x] EXPERIENCE.md, DESIGN.md, epics.md UX-DR23, sprint-status -- docs

**Acceptance Criteria:**
- Given an admin on a member's page, then no `<form>` is on the page outside a dialog, and *Upiši godišnji* opens the record dialog with empty od/do.
- Given a range is entered, then the cost, the balance after and the conflict lines show before any request is sent, and their count equals what the *Raspored* queue shows for that member once the record is saved.
- Given closing either dialog without saving, then focus returns to its opener and nothing is written.
- Lint (including feature boundaries), typecheck, unit and e2e tests pass at 1280 and 390.

## Spec Change Log

- 2026-10-08, code review patches (no spec amendment): amend *created* filters resolved collisions like a new record; the conflict preview is unknown while the resolutions or calendar re-read is fetching; the removal confirmation says when conflicts cannot be checked; the record dialog closes when the card leaves ready, focus to the card heading; a landed amend (hand-off too) focuses the replacement row's Izmijeni; the opener's name comes from the members read; e2e for a held amend that cannot be dismissed, the opener's accessible name and a deterministic amend fixture; epic-7-context describes the shipped state. Skipped: an e2e for the gone-record close on a re-read without a save, since nothing refetches records while the modal is open (`refetchOnWindowFocus: false`), so the test would need a fake clock and be flaky.

## Design Notes

The amend's "before" is the target's collisions in the current records, and its "after" is the same records with the target's range replaced (same id). A key in both is *kept*. Only *cleared* and *kept* filter through the resolutions, because a resolved collision that stays covered keeps its resolution (0031 soft-removes only uncovered dates). A new record uses a placeholder id that no stored record can carry. The lines read `{weekday short} {dd.mm.} {type}`, soonest first, in `collisionsOf`'s order. The team name is left out because a member's leave rarely spans two teams; when it does, the date repeats.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean, boundary test passes
- `pnpm --filter ./apps/web test` -- expected: all green
- `pnpm e2e` (people, leave, conflicts, calendar, hours suites) -- expected: green at 1280 and 390

## Suggested Review Order

**The one conflict derivation**

- Entry point: created / cleared / kept from the domain's `collisionsOf`, through the queue's own input and resolutions.
  [`leave-conflicts.ts:110`](../../apps/web/src/features/leave/services/leave-conflicts.ts#L110)

- Unknown while resolutions are pending, failed, paused or re-reading — never a stale count.
  [`leave-conflicts.ts:127`](../../apps/web/src/features/leave/services/leave-conflicts.ts#L127)

- Amend: before vs after on the same id; every group filters resolved collisions.
  [`leave-conflicts.ts:162`](../../apps/web/src/features/leave/services/leave-conflicts.ts#L162)

**The dialogs**

- One dialog for record and amend, keyed body, not dismissible while pending.
  [`member-leave-dialog.tsx:132`](../../apps/web/src/features/leave/components/member-leave-dialog.tsx#L132)

- *Bilo / Sada* for an amend: the stored range and cost beside the new one.
  [`member-leave-dialog.tsx:160`](../../apps/web/src/features/leave/components/member-leave-dialog.tsx#L160)

- Neutral conflict lines inside the polite preview region; never a gate.
  [`member-leave-dialog.tsx:58`](../../apps/web/src/features/leave/components/member-leave-dialog.tsx#L58)

- *Upiši godišnji* in the card header, named by the person.
  [`member-leave-card.tsx:172`](../../apps/web/src/features/leave/components/member-leave-card.tsx#L172)

- Removal stays one neutral confirm, now naming the conflicts it clears (or that they cannot be checked).
  [`member-leave-records.tsx:219`](../../apps/web/src/features/leave/components/member-leave-records.tsx#L219)

**Hook wiring and focus**

- Both previews memoised from the same reads the card already holds.
  [`use-member-leave.ts:313`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L313)

- Closing returns focus to the opener; the hand-off falls back to the headings.
  [`use-member-leave.ts:522`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L522)

- A dialog whose record or card is gone closes itself, and the card says why.
  [`use-member-leave.ts:383`](../../apps/web/src/features/leave/hooks/use-member-leave.ts#L383)

**Peripherals**

- Unit: every matrix row over the pilot snapshot, and agreement with *Raspored*'s count.
  [`leave-conflicts.test.ts:121`](../../apps/web/src/features/leave/services/leave-conflicts.test.ts#L121)

- e2e: no `<form>` on the page, the opener's name, a held amend that cannot be dismissed.
  [`leave.spec.ts:239`](../../e2e/tests/people/leave.spec.ts#L239)

- EXPERIENCE.md *Member page*: the leave dialogs as shipped.
  [`EXPERIENCE.md:98`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L98)

- UX-DR23 gains the 7.12 sentence.
  [`epics.md:135`](../planning-artifacts/epics.md#L135)
