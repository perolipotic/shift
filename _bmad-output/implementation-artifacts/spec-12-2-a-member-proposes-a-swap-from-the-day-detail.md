---
title: 'A member proposes a swap from the day detail'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: '49255122b571de37e4de9d1586193f731636a07b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-12-1-the-swap-request-record.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 12.1 shipped `swap_requests`, but no screen writes it. A member who wants to give away a shift still phones a colleague, and the rota never learns of it.

**Approach:** On a member's own working shift, the day detail gains a *Predloži zamjenu* link to a new surface, `/kalendar/zamjena?dan=…&smjena=…`. There the member picks a colleague and, optionally, one of that colleague's working shifts in return. The form shows who works which date and each member's hour delta, computed by the calendar's own roster-change preview. One *Pošalji* inserts the proposal.

## Boundaries & Constraints

**Always:**
- **Who and where.** Only a member-role viewer gets the link, and only on a `DAY_WORKING` day whose roster (overrides applied) includes `viewer.memberId`, from today on. The link sits in the dialog's footer. The dialog itself stays facts only (7.9). An admin who opens the route is sent to `/kalendar`. A day that is not the viewer's own working shift shows a notice and no form.
- **FR-66 send-time check (input from `deferred-work.md`, 12.1, owner 12.2).** The browser refuses, before any insert:
  - a given shift that is not a working shift on the proposer's roster;
  - a return shift that is not a working shift on the colleague's roster.
  - Both are checked with `rosterOn` over the current snapshot, at render and again inside `send`. The database never checks a roster, so these refusals are the browser's alone. A direct API call can still store such a swap, and 12.4's stale check stays its owner.
- **Colleague options.** Members active on the given date, not on the given shift's roster and not the viewer, shown as `Ime · čin · položaj` (`rosterLineOf`), sorted by name. Nobody is preselected.
- **Return options.** None is the default. Otherwise: the chosen colleague's working shifts from today through the end of the month after the given date, excluding the given shift and any shift where the proposer is already on the roster or is inactive.
- **Preview.** It never blocks.
  - Build one "after" snapshot by applying both changes with `rosterChangeSnapshotOf`: proposer off and colleague on the given shift; then, with a return shift, colleague off and proposer on it.
  - For each member and each month a date falls in, the delta is `memberHoursOfMonth` after minus before, over `memberHoursInputOf`. The proposer's figures use the same leave keys their *Sati* uses. The colleague's figures use none, because a member reads no one else's leave (7.10).
  - It shows lines such as "{datum} · {smjena}: radi {kolega} umjesto tebe" and each member's signed delta per month.
  - A `ROSTER_TAKEN` from `rosterChangeSnapshotOf` blocks only that option, with its reason.
- **Sending.**
  - The insert is `{organization_id, proposer_id, addressee_id, team_id, date, return_team_id, return_date}` into `swap_requests`.
  - Refusals map by SQLSTATE: 23505 → this shift (or that return shift) already has an open swap; 42501 → not allowed (a past date, an inactive party, or the session); 23514 → invalid; anything else → failed.
  - A refusal keeps every chosen value.
  - On success the member returns to `/kalendar` on that month, with a polite status line naming the date, the shift and the colleague in router state.
- **Writes.** *Pošalji* uses `useWriteGate`, `aria-disabled` and `OfflineWriteNote`. It keeps an in-flight ref, with no `useMutation` and no optimistic update. The re-read goes through `refreshAfterWrite` with a new `SWAP_REQUEST_WRITE_DEPENDENTS`, which is empty because a proposal derives nothing (R9.1).
- **Offline.** The route joins the readable paths and reads the calendar snapshot alone, as one snapshot under the as-of note.
- **Docs in the same change.**
  - EXPERIENCE.md §IA: a "Request swap" inventory row, and the day detail line gains the member's link.
  - UX-DR31, 33 and 47: the 12.2 clauses become present-tense fact. The inventory goes from 21 to 22; change history (14.2) stays planned.

**Ask First:** any migration, or any change to 0049; any change to `packages/domain` exports; changing the admin's day detail or roster dialog behaviour.

**Never:**
- No reader of `swap_requests` (the proposer's list and withdraw belong to 12.3, see Deviations).
- No notification, no *Za odluku* or Danas change.
- No leave, collision or short-staffed figure for either member (those are 12.4's).
- No second hours or roster implementation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Link | Member, own working shift, today or later | *Predloži zamjenu* in the footer | — |
| No link | Admin; day off; past day; someone else's shift | No link | — |
| One-way cover | Colleague, no return | Preview: colleague works the date; proposer −h, colleague +h; sends | — |
| With return | Colleague and a return shift in another month | Both dates and per-month deltas; sends | — |
| Not mine | URL for a shift not on the viewer's roster | Notice, no form, nothing sent | — |
| Duplicate | An open swap already holds the shift | Stays on the form, says so | 23505 |
| Refused | Past date or inactive party reached by a stale page | "not allowed", values kept | 42501 |
| Offline | Form opened offline | Snapshot under the as-of note; *Pošalji* gated | nothing sent |
| Admin | Admin opens the route | Redirect to `/kalendar` | — |

## Epic AC Deviations

- Quote (FR-69 and the epic states): "withdrawn by either member at any point before the admin decides".
  - Choice: 12.2 writes only. The proposer's own list of swaps and *Povuci* are not built here; they are assigned to 12.3, which first reads `swap_requests` for members.
  - Reason: no epic AC of 12.2 asks for it; it keeps 12.2 to one goal. A `deferred-work.md` entry, owner 12.3, records it.

</frozen-after-approval>

## Code Map

- `features/calendar/components/day-detail-dialog.tsx:418` `renderFooter` (admin-only today); add the member's link. It is pinned by `test/theme-contrast.test.ts:1662` (a hot file).
- `features/calendar/utils/day-detail.ts:247` `dayDetailOf`, `:186` `DayDetail`, `:98-104` kinds.
- `features/calendar/services/snapshot.ts:253-330`: `viewer`, `members` (all, via `calendar_members`), `rosterOverrides` (via `calendar_roster_overrides`).
- `packages/domain/src/roster.ts:294` `rosterOn`; `hours.ts:317` `memberHoursOfMonth`; read-only.
- `features/calendar/utils/change-preview.ts:93` `hourDeltasOf`, `:207` `rosterPreviewOf` (one override, one month: generalise without duplicating).
- `features/calendar/services/roster-erasures.ts:133` `rosterChangeSnapshotOf` (`ROSTER_TAKEN`).
- `features/hours/services/my-hours.ts:100` `memberHoursInputOf`; `hooks/use-hours.ts:253` the leave keys.
- `features/members/utils/position.ts:167` `rosterLineOf`; `day-detail.ts:1070` the option precedent.
- 9.3 precedent: `pages/godisnji.zatrazi.tsx`, `features/leave/hooks/use-leave-request-form.ts:93-190`, `components/leave-request-form.tsx:68,196`, `services/leave-request-write.ts:149,219`.
- `supabase/migrations/0049_swap_requests.sql:104-125` (refusals), `:478` (insert policy).
- `features/teams/services/dependents.ts:148,283,302`.

**Pinned lists:** `dependents.test.ts:89` `CLASSIFIED`; `resource-hygiene.test.ts:39,256`; `screens-sweep.test.ts:318` (`SCREENS` 37), `:389` (`KEY_SOURCES` 85), and `key-sources.fixture.ts:107`; `source-guards.fixture.ts:1006` (Kalendar buttons 34) plus a new entry; `localization-applied.test.ts:662`; `prijava.test.ts:177,1067,1112` (`IN_FLIGHT_HANDLERS` 33); `structural-pins-shell.test.ts:1206,1233`; `eslint.config.js:124,164-195` (`FEATURE_PUBLIC` for calendar utils); `router.ts`, `router.test.ts:427,1654,1677`; `lib/offline/readable-paths.ts:27`; `calendar-screen.fixture.ts:22`.
**E2E:** `e2e/utils/database-helper.ts:392` (delete `swap_request_decisions` and `swap_requests` for the member); `offline-write.spec.ts:94` (a plain insert already counts).

## Tasks & Acceptance

**Execution:**
- [x] `features/swaps/services/swap-proposal.ts` (+ test) -- own-shift check, colleague and return options, the two-change preview and per-month deltas, the insert and the refusal mapping -- the FR-66 rules in one pure service, over the calendar's preview.
- [x] `features/calendar/utils/change-preview.ts` (+ test) -- generalise the delta to several changes and months, keeping `rosterPreviewOf`'s results unchanged -- one implementation.
- [x] `features/swaps/hooks/use-swap-proposal.ts`, `components/swap-proposal-form.tsx`, `pages/kalendar.zamjena.tsx`, `router.ts` -- the view gate, the form and the send -- the surface.
- [x] `day-detail-dialog.tsx`, `pages/kalendar.tsx` -- the link, and the status line after a send -- the entry point.
- [x] `hr.json`, `dependents.ts` and every pinned list above -- register keys, files, controls and the surface -- the sweeps stay green.
- [x] `e2e/tests/swaps/propose-swap.spec.ts`, `database-helper.ts` -- send a one-way cover and one with a return; a duplicate is refused; offline is gated -- real-stack proof, run in CI.
- [x] `epics.md`, `EXPERIENCE.md` -- the doc rewrites -- docs ship with the change.
- [x] `deferred-work.md` -- mark the FR-66 entry `RESOLVED in part (the send-time check) by 12.2`, with 12.4's stale check left open; add the withdraw/list entry for 12.3.

**Acceptance Criteria:**
- Given CI, when `pnpm test` and the swap E2E run, then every new case passes with nothing skipped.
- Given `grep -rn "konflik" apps/web/src/lib/i18n/locales/hr.json`, when it runs, then there are no hits.

## Design Notes

- **Decided at the spec checkpoint (product owner, 2026-11-06), each the recommended default:** (1) withdraw and the proposer's list go to 12.3; (2) member role only; (3) the return window runs through the end of the month after the given date; (4) the colleague's delta counts shifts only; (5) no leave or double-booking warnings in 12.2; (6) after *Pošalji* the member lands on `/kalendar` for that month with a status line. The withdraw deviation is accepted. Size: [K]eep.
- **The proposer's leave keys (implementation, 2026-11-06).** They come from the member's own conflict-resolutions read (`MY_CONFLICT_RESOLUTIONS_KEY`), as on *Sati*. That read runs beside the calendar snapshot and never gates: the offline snapshot is the calendar alone, and while the read is unknown (paused or failed) the preview counts no leave and says so (`kalendar.swap.leaveUnknown`).
- **A route, not a form in the dialog.** UX-DR33 counts request swap as a surface, and 7.9 keeps the day detail free of forms.
- **The colleague's hours exclude leave keys.** A member reads no one else's leave, so the colleague's delta counts shifts alone. It is a preview that never gates; 12.4's admin preview counts everything.
- **Hot files.** `hr.json` and the theme-contrast-pinned dialog: baseline 4925512, and no other hot-file story is open.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm --filter ./apps/web test` -- expected: green.
- The DB-backed and E2E suites run in CI only (shared stack, port 5173).

## Suggested Review Order

**The FR-66 rules (one pure service)**

- Entry point: the given shift is the viewer's own working shift, or there is no form.
  [`swap-proposal.ts:141`](../../apps/web/src/features/swaps/services/swap-proposal.ts#L141)

- The send check re-derives both option lists and `rosterOn`; every refusal has a code.
  [`swap-proposal.ts:497`](../../apps/web/src/features/swaps/services/swap-proposal.ts#L497)

- Colleagues: active that date, off the shift's roster, a taken key shown blocked.
  [`swap-proposal.ts:196`](../../apps/web/src/features/swaps/services/swap-proposal.ts#L196)

- Return shifts: the colleague's, from today through the month after the given date.
  [`swap-proposal.ts:281`](../../apps/web/src/features/swaps/services/swap-proposal.ts#L281)

- Choosing a colleague always drops the return shift; a stale value is refused, never swapped.
  [`swap-proposal.ts:452`](../../apps/web/src/features/swaps/services/swap-proposal.ts#L452)

**The preview reuses the calendar's roster change**

- Both changes applied to one "after" snapshot; per-member, per-month deltas.
  [`swap-proposal.ts:373`](../../apps/web/src/features/swaps/services/swap-proposal.ts#L373)

- One hour-delta implementation; `hourDeltasOf` now calls it.
  [`change-preview.ts:111`](../../apps/web/src/features/calendar/utils/change-preview.ts#L111)

- The proposer's Sati leave keys, or none and a note when that read is unknown.
  [`swap-proposal.ts:535`](../../apps/web/src/features/swaps/services/swap-proposal.ts#L535)

**The write (0049)**

- Seven columns into `swap_requests`; refusals mapped by SQLSTATE.
  [`swap-proposal.ts:611`](../../apps/web/src/features/swaps/services/swap-proposal.ts#L611)

- The send: write gate, in-flight ref held through navigation, no optimism.
  [`use-swap-proposal.ts:189`](../../apps/web/src/features/swaps/hooks/use-swap-proposal.ts#L189)

**Entry point and surface**

- Who gets the link: a member, their own working shift, today on.
  [`day-detail.ts:1276`](../../apps/web/src/features/calendar/utils/day-detail.ts#L1276)

- The link sits in the footer; the dialog stays facts only.
  [`day-detail-dialog.tsx:420`](../../apps/web/src/features/calendar/components/day-detail-dialog.tsx#L420)

- The route; an admin is sent to `/kalendar`.
  [`kalendar.zamjena.tsx:1`](../../apps/web/src/pages/kalendar.zamjena.tsx#L1)

- The status line after a send, in router state only.
  [`kalendar.tsx:25`](../../apps/web/src/pages/kalendar.tsx#L25)

**Tests and guards**

- The rules, the preview, the send check and every refusal message.
  [`swap-proposal.test.ts:1`](../../apps/web/src/features/swaps/services/swap-proposal.test.ts#L1)

- R9.1 guard: one writer of `swap_requests`, no reader.
  [`supabase-scaffold.test.ts:3367`](../../test/supabase-scaffold.test.ts#L3367)

- E2E (CI only): link, one-way cover, return shift, duplicate, offline, admin.
  [`propose-swap.spec.ts:141`](../../e2e/tests/swaps/propose-swap.spec.ts#L141)
