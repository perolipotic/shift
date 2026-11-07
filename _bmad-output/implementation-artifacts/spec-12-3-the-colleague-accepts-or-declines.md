---
title: 'The colleague accepts or declines'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: 'afc3641971ee59ee6490e93abaf070fb089644b3'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-2-a-member-proposes-a-swap-from-the-day-detail.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 12.2 stores a proposal, but nothing reads it.
- The colleague cannot answer it.
- The proposer cannot see it or withdraw it.
- The day detail offers the same shift again.

**Approach:** *Danas* gains a *Zamjene* card listing the viewer's own swaps from both sides.
- The addressee answers with *Prihvati* or *Odbij*.
- Either member withdraws with *Povuci* (FR-69).
- The day detail marks a shift that already has an open proposal.
- There is no migration.

## Boundaries & Constraints

**Always:**
- **The read** is one member read under `MY_SWAP_REQUESTS_KEY`.
  - It selects `swap_requests` together with any `swap_request_decisions` row, under 0049's RLS.
  - It filters to rows where the viewer is the proposer or the addressee. An admin can read every row, so the filter applies to admins too.
  - It returns open rows, and closed rows whose given date is today or later.
- **The status** comes from 0049's derived status, as one word per state:
  - *Čeka tvoj odgovor*;
  - *Čeka odgovor kolege*;
  - *Čeka odluku*;
  - *Odbijena* (declined);
  - *Povučena*;
  - *Odobrena*;
  - *Nije odobrena* (rejected);
  - *Zatvorena deaktivacijom*.
- **The card.**
  - It appears on member *Danas* after the next-shift card, and on admin *Danas* after *Treba tebe*.
  - It is drawn only when there is a row.
  - Rows that wait for the viewer come first, then the rest, soonest first.
  - Each row names the date, the shift, the colleague and any return shift.
- **The consequence** is shown to the addressee only, and never blocks.
  - It comes from 12.2's two-change preview over the stored swap: the addressee works the given date, and with a return shift the proposer works the return date.
  - It shows the addressee's signed hour delta per month, with their own leave keys.
- **The buttons.**
  - *Prihvati* and *Odbij* appear on a proposed swap, for the addressee.
  - *Povuci* appears for the proposer while the swap is proposed or accepted, and for the addressee once it is accepted. There is no confirmation.
- **Stale.** If the given shift is no longer the proposer's working shift, the return shift is no longer the addressee's, or `rosterChangeSnapshotOf` refuses, then *Prihvati* is withheld and *Odbij* stays.
- **Past.** A swap is past when either of its dates is before the organization's today.
  - An open past swap reads *Datum je prošao*.
  - *Prihvati* is withheld; *Odbij* and *Povuci* stay.
  - Nothing closes it automatically.
- **Writes** go through `answer_swap_request` and `withdraw_swap_request`.
  - Refusals map by SQLSTATE: P0002 → no longer open; 42501 → not allowed; anything else → failed.
  - Each button uses `useWriteGate`, `aria-disabled`, `OfflineWriteNote` and an in-flight ref. Nothing is optimistic.
  - The re-read is `refreshAfterWrite` with `SWAP_REQUEST_WRITE_DEPENDENTS`, which now holds `MY_SWAP_REQUESTS_KEY`. 12.2's send uses it too.
- **The day detail mark.**
  - `swapOfferedOf` and `ownSwapShiftOf` take the viewer's open swaps.
  - On a shift the viewer has proposed in an open swap (the proposer side only), the footer shows *Zamjena predložena · {kolega}* instead of the link, and the form shows a notice instead of a form.
  - While the read is unknown, the link is offered as before, and 23505 stays the backstop. Unknown includes a read that has not answered and a read that failed, even over cached rows; this holds for the calendar's mark and for the proposal form.
- **Offline and failure.**
  - The key joins both *Danas* surface-key sets and is read as part of *Danas*'s one snapshot.
  - It is NOT one of the member *Kalendar*'s reads: the calendar reads it beside its snapshot, and its freshness never waits on it. A failed swap read there only hides the *Zamjena predložena* mark (the day detail then offers *Predloži zamjenu* as before) and never makes *Kalendar* unavailable.
  - Amended with the user's approval, 2026-11-06, after review: until then the key also joined the calendar's freshness, so a failed swap read took down the whole member *Kalendar*.
- **Docs.** In EXPERIENCE.md: the member *Danas* line, the admin *Danas* line and the Day detail row. In epics.md: UX-DR47.

**Ask First:**
- Any migration.
- Any change to 0049.
- Any change to *Za odluku*.
- Any change to `packages/domain` exports.

**Never:**
- No swap enters a schedule, hours or collision figure (R9.1).
- No admin queue row or count.
- No notification (that is 12.3b).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Addressee | Proposed swap | Row with the addressee's consequence, *Prihvati*, *Odbij* | — |
| Accept | *Prihvati* | *Čeka odluku* | — |
| Decline | *Odbij* | The proposer sees *Odbijena* | — |
| Withdraw | Proposer, proposed or accepted; addressee, accepted | *Povučena* | — |
| Race | Answer after a withdraw | "No longer open"; the list re-reads | P0002 |
| Stale | Given shift no longer the proposer's | No *Prihvati*; *Odbij* stays | — |
| Past | Open swap, a date before today | *Datum je prošao*; no *Prihvati* | — |
| Marked | The viewer proposed this shift | Footer mark, no link; the form shows a notice | — |
| Swaps read fails | Member *Kalendar*, swap read errors | Grid shown; no mark; *Predloži zamjenu* offered as before | — |
| Offline | Any card button | Gated, with the note | Nothing sent |
| No swaps | — | No card | — |

## Epic AC Deviations

- **Narrowed.** The epic AC says: "the swap enters *Za odluku* for admins".
  - Choice: an accepted swap is stored as waiting for an admin (AD-4's third set, 0049).
  - What moves to 12.4: the *Čeka odluku* row, the count on the queue and on *Danas*, and the admin notification. They ship with the decision screen.
  - Reason: a row with no screen links nowhere, and the count must equal the queue. A `deferred-work.md` entry records it. Product owner, 2026-11-06.
- **Split.** The swap proposed and answered notifications go to 12.3b, together with splitting `notify/handler.ts`. A `deferred-work.md` entry records it. Product owner [S], 2026-11-06.

</frozen-after-approval>

## Code Map

- `supabase/migrations/0049_swap_requests.sql`:
  - columns at :197-290;
  - select policies at :440 and :503;
  - `answer_swap_request` at :562;
  - `withdraw_swap_request` at :630, with P0002 `SWAP_REQUEST_NOT_OPEN`, 42501 and 22023.
- `features/swaps/services/swap-proposal.ts`:
  - `ownSwapShiftOf` at :150;
  - the preview at :373;
  - the leave keys at :535;
  - `SWAP_REQUESTS_TABLE` at :550.
- 12.2's send pattern is `hooks/use-swap-proposal.ts` (:133, :194, :238). `swaps-screen.fixture.ts` lists the swap feature's files.
- Day detail:
  - `features/calendar/utils/day-detail.ts:1276` `swapOfferedOf`;
  - `hooks/use-calendar-screen.ts:348`;
  - `components/day-detail-dialog.tsx:420-430`. This is a hot file pinned by the theme-contrast test.
- *Danas*:
  - `features/today/components/today-body.tsx:79` and `admin-today-body.tsx`;
  - `hooks/use-today.ts` and `use-admin-today.ts`;
  - `services/surface-keys.ts:16,33`;
  - `today-screen.fixture.ts`.
- The precedent:
  - `features/leave/components/my-leave-requests.tsx`;
  - `hooks/use-my-leave-requests.ts:168-184`;
  - `services/leave-request-write.ts:168,255`;
  - `services/my-leave.ts:398-521`.
- `features/teams/services/dependents.ts:161` `SWAP_REQUEST_WRITE_DEPENDENTS`.
- **Pins**:
  - `test/supabase-scaffold.test.ts:3352`, the R9.1 guard. Rewrite it to allow one reader, two RPC calls and one writer.
  - `test/resource-hygiene.test.ts:256,2295`.
  - `test/localization-applied.test.ts:673`.
  - `pages/source-guards.fixture.ts:742,963` (`SCREENS`, 38).
  - `key-sources.fixture.ts:109` (87).
  - `prijava.test.ts:178` (`IN_FLIGHT_HANDLERS`, 34).
  - `dependents.test.ts:90` (`CLASSIFIED`, 25).
  - `structural-pins-shell.test.ts:1206,1236`.

## Tasks & Acceptance

**Execution:**
- [x] `features/swaps/services/my-swaps.ts` (+ test) -- the read, the status, the order, past and stale, the consequence through 12.2's preview, the two RPC calls and the refusal mapping -- all the rules in one pure service.
- [x] `features/swaps/hooks/use-my-swaps.ts`, `components/my-swaps-card.tsx`, `today-body.tsx`, `admin-today-body.tsx`, both today hooks and `surface-keys.ts` -- the card on both *Danas* bodies.
- [x] `day-detail.ts`, `use-calendar-screen.ts`, `day-detail-dialog.tsx` and `swap-proposal.ts` -- the open-proposal mark.
- [x] `dependents.ts`, `use-swap-proposal.ts`, `hr.json` and every pin above -- the registration and the R9.1 guard rewrite.
- [x] `e2e/tests/swaps/answer-swap.spec.ts` -- accept, decline, withdraw, the mark, offline -- CI only.
- [x] `EXPERIENCE.md` and `epics.md` UX-DR47 -- the docs.
- [x] `deferred-work.md` -- mark these RESOLVED: the withdraw/list entry and the day-detail entry. Mark the past-swap entry RESOLVED in part, leaving 12.4's admin view open.

**Acceptance Criteria:**
- Given CI, when `pnpm test` and the e2e suite run, then every new case passes, with none skipped.
- Given `grep -rn swap_request apps packages`, when it runs, then the only hits are the 12.2 writer and the 12.3 reader.

## Spec Change Log

- **2026-11-06, after review (user-approved change to the frozen block).**
  - Trigger: the edge-case and verification-gap reviewers found that `MY_SWAP_REQUESTS_KEY` in the member *Kalendar*'s freshness made one failed swap read take down the whole *Kalendar*. A device still offline after an update, before the key had ever been read, also lost *Kalendar*.
  - Amended: the "Offline and failure" boundary and a new matrix row. The key stays in *Danas*'s one snapshot. The calendar reads it raw, beside its snapshot, and treats an errored read as unknown.
  - KEEP: the *Danas* keys, the proposal form's "failed is unknown" rule, and the mark's from-today rule.

## Design Notes

- **Decided at the spec checkpoint** by the product owner, 2026-11-06, each the recommended default:
  - *Za odluku* goes to 12.4.
  - Notifications are split into 12.3b.
  - The card shows on both *Danas* bodies, only when there are rows.
  - Closed swaps are shown until their given date.
  - Past swaps are labelled, never closed automatically.
  - A stale swap hides *Prihvati*.
  - Notifications carry no names. A withdrawal sends no notification.
  - The mark is on the proposer's side only.
- **Admins can be addressees**, because 12.2's colleague list includes members with the admin role. That is why the card is also on admin *Danas*.
- **Hot files:** `hr.json` and `day-detail-dialog.tsx`. Baseline is afc3641, and no other hot-file story is open.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm --filter ./apps/web test` -- expected: green.
- The pure root tests: `supabase-scaffold`, `resource-hygiene` and `localization-applied`. The DB suites and e2e run in CI.

## Suggested Review Order

**The rules (one pure service)**

- Entry point: the status is derived from 0049's columns; impossible combinations drop that row only.
  [`my-swaps.ts:221`](../../apps/web/src/features/swaps/services/my-swaps.ts#L221)

- The card's rows: open swaps or closed ones from today on, past and stale, and which buttons each gets.
  [`my-swaps.ts:501`](../../apps/web/src/features/swaps/services/my-swaps.ts#L501)

- Stale: the shifts no longer belong to the members, or the 12.2 roster change refuses.
  [`my-swaps.ts:425`](../../apps/web/src/features/swaps/services/my-swaps.ts#L425)

- The addressee's consequence, from 12.2's two-change preview over the stored swap.
  [`my-swaps.ts:445`](../../apps/web/src/features/swaps/services/my-swaps.ts#L445)

- The read: party-filtered for every role, with the decision embedded.
  [`my-swaps.ts:96`](../../apps/web/src/features/swaps/services/my-swaps.ts#L96)

- Two RPCs, with refusals mapped by SQLSTATE.
  [`my-swaps.ts:604`](../../apps/web/src/features/swaps/services/my-swaps.ts#L604)

**The card on Danas**

- The write: an in-flight ref, the offline guard, refreshAfterWrite, nothing optimistic.
  [`use-my-swaps.ts:85`](../../apps/web/src/features/swaps/hooks/use-my-swaps.ts#L85)

- The card: aria-disabled buttons, the acting row busy, stale and past lines.
  [`my-swaps-card.tsx:93`](../../apps/web/src/features/swaps/components/my-swaps-card.tsx#L93)

- Placed after the next-shift card on member Danas.
  [`today-body.tsx:85`](../../apps/web/src/features/today/components/today-body.tsx#L85)

- Placed after Treba tebe on admin Danas, because an admin can be an addressee.
  [`admin-today-body.tsx:86`](../../apps/web/src/features/today/components/admin-today-body.tsx#L86)

- The key joins the Danas snapshot (open question: it gates the whole surface).
  [`surface-keys.ts:27`](../../apps/web/src/features/today/services/surface-keys.ts#L27)

**The day detail mark**

- Marks a shift the viewer has proposed, from today on.
  [`day-detail.ts:1291`](../../apps/web/src/features/calendar/utils/day-detail.ts#L1291)

- The link is never offered on a proposed shift; an unknown read offers it as before.
  [`day-detail.ts:1318`](../../apps/web/src/features/calendar/utils/day-detail.ts#L1318)

- The footer shows the mark in place of the link.
  [`day-detail-dialog.tsx:428`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L428)

- The form holds the proposals once a send lands, so no notice flashes.
  [`use-swap-proposal.ts:169`](../../apps/web/src/features/swaps/hooks/use-swap-proposal.ts#L169)

- The member Kalendar's freshness includes the swaps key (the same open question).
  [`surface-keys.ts:25`](../../apps/web/src/features/calendar/services/surface-keys.ts#L25)

**Registration and tests**

- A write re-reads the viewer's swaps.
  [`dependents.ts:162`](../../apps/web/src/features/teams/services/dependents.ts#L162)

- The R9.1 guard now allows one writer and one reader, and nothing derives from them.
  [`supabase-scaffold.test.ts:3352`](../../test/supabase-scaffold.test.ts#L3352)

- The rules' unit cases, including the today boundaries.
  [`my-swaps.test.ts:1`](../../apps/web/src/features/swaps/services/my-swaps.test.ts#L1)

- e2e (CI only): accept, admin addressee, decline, withdraw race, mark, offline.
  [`answer-swap.spec.ts:162`](../../e2e/tests/swaps/answer-swap.spec.ts#L162)
