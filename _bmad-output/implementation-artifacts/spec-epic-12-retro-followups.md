---
title: 'Epic 12 retro follow-ups A1 + A2: swap invalidation, stale-path test, return shift in notices, closed swaps until their last date'
type: 'bugfix'
created: '2026-11-08'
status: 'done'
baseline_commit: '40c435138216c62447b5b3c447f671e2acfa33d9'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-retro-2026-11-07.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 12 retro (action items 43, 44). R1: a deactivation closes the member's open swaps (0049) but `MEMBERSHIP_WRITE_DEPENDENTS` re-reads neither swap key, and its test pins the omission. R9: the decision screen's `stale: true` state has no unit case. R11: stray blank lines. R6: `returnDate` is written by 0050/0051 but no message renders it, so a two-way swap's notice omits the return shift. R5: *Zamjene* drops a closed swap once its **given** date passes, while notify still sends (and links `/danas`) while the return date is ahead.

**Approach:** Browser and copy only. Add both swap keys to the membership dependents; add the stale unit case; drop the blank lines. In `notify`, render a `…WithReturn` variant message when the operands carry `returnDate`; keep a closed swap on *Zamjene* until `swapLastDateOf(swap) >= today`.

## Boundaries & Constraints

**Always:** `hr.json`'s `obavijesti` first, `messages.ts` deep-equal copy after (pinned by `notify-boundary`). Plain `{name}` interpolation, no ICU. A variant is chosen only by the presence of a string `returnDate`; a malformed one stays `OPERANDS_INVALID`. Links unchanged. Member-bound messages name no other member (Q5).

**Ask First:** the Croatian wording below; any change to `SWAP_REQUEST_WAITING` (0051 writes no `returnDate` for it).

**Never:** a migration, a DB-connecting test, a harness patch, an operand change, ICU in `obavijesti`, a server-side filter on the swap read.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| One-way notice | `{date}` | Today's message, unchanged | N/A |
| Two-way notice | `{date, returnDate}` on PROPOSED/ACCEPTED/DECLINED/APPROVED/REJECTED | `…WithReturn` subject and body naming both dates | N/A |
| Bad return date | `returnDate: '2046-02-30'` | Nothing rendered | `OPERANDS_INVALID` |
| Waiting | `SWAP_REQUEST_WAITING` (no `returnDate`) | Unchanged | N/A |
| Closed, given past, return ahead | closed, `date < today <= return_date` | Listed on *Zamjene* | N/A |
| Closed, both past | closed, both dates `< today` | Not listed | N/A |
| Deactivation | `MEMBERSHIP_WRITE_DEPENDENTS` write | Both swap reads re-read | N/A |

## Epic AC Deviations

None. (The admin's `SWAP_REQUEST_WAITING` keeps naming one date: 0051 writes no `returnDate` for it, and adding one is a migration; the decision screen names both shifts.)

</frozen-after-approval>

## Code Map

- `apps/web/src/features/teams/services/dependents.ts:82-91` -- `MEMBERSHIP_WRITE_DEPENDENTS` (keys already imported); doc comment cites 0041 for leave requests; blank lines after `SWAP_REQUEST_WRITE_DEPENDENTS` (~167-169).
- `apps/web/src/features/teams/services/dependents.test.ts:246-262` -- "a team move or a status change" `stale` list pins the omission.
- `apps/web/src/features/swaps/services/swap-decision.ts:444` -- `stale: swapStaleOf(...)` in the WAITING screen; `swap-decision.test.ts:215,226` assert `false` only; `:391` builds a stale snapshot (roster override taking Ivo off 09-13) to reuse.
- `apps/web/src/features/swaps/services/my-swaps.ts:465` -- `if (!open && swap.given.date < today) continue;`; doc comment above `mySwapRowsOf`. `swapLastDateOf` lives in `organization-swaps.ts:408` (already imported module, no cycle).
- `apps/web/src/features/swaps/services/my-swaps.test.ts:425-441,491` -- closed-row cases.
- `supabase/functions/notify/messages.ts` -- `OBAVIJESTI`, `MESSAGE_OF_CODE`, `linkPathOf` (exhaustive switch over `MessageKey`), `compose()` picks the key.
- `apps/web/src/lib/i18n/locales/hr.json:1847-1870` -- swap messages.
- `test/notify-boundary.test.ts:217-235,491-555` -- deep-equal pin, `EVERY_CODE`, Q5 placeholder allowlist, and the case "renders %s with a return shift exactly as without one" (pins the old behaviour). The file also holds DB describes.
- `test/resource-hygiene.test.ts:~2244-2294,2667-2674` -- `obavijesti.*` allowlist and `SWAP_NOTIFICATION_KEYS` (`smjen` terminology).
- `_bmad-output/implementation-artifacts/deferred-work.md:1355` -- says closed swaps show "whose given date is today or later"; reword to "last date" (stays open).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/teams/services/dependents.ts` -- add `MY_SWAP_REQUESTS_KEY`, `ORGANIZATION_SWAP_REQUESTS_KEY` to `MEMBERSHIP_WRITE_DEPENDENTS`, extend its comment (0049 closes swaps); remove the blank lines.
- [x] `apps/web/src/features/teams/services/dependents.test.ts` -- add both keys to the membership case's `stale`.
- [x] `apps/web/src/features/swaps/services/swap-decision.test.ts` -- a WAITING screen over a snapshot where the given shift is no longer the proposer's: `stale: true`, `past: false`, still WAITING.
- [x] `apps/web/src/features/swaps/services/my-swaps.ts` -- filter closed swaps by `swapLastDateOf`; update the doc comment.
- [x] `apps/web/src/features/swaps/services/my-swaps.test.ts` -- closed two-way swap with given past and return ahead is listed; both past is not.
- [x] `apps/web/src/lib/i18n/locales/hr.json` + `supabase/functions/notify/messages.ts` -- five `swapRequest{Proposed,Accepted,Declined,Approved,Rejected}WithReturn` messages; a base→variant map; `compose()` swaps the key when `typeof operands.returnDate === 'string'`; `linkPathOf` lists the variants beside their bases (`/danas`).
- [x] `test/notify-boundary.test.ts` -- replace the "exactly as without one" case with exact two-way renders (email and push) for the five codes; keep the malformed case; the code→message test also checks variants; allow `returnDate` in the Q5 list.
- [x] `test/resource-hygiene.test.ts` -- register the ten new keys and the five new bodies in `SWAP_NOTIFICATION_KEYS`.
- [x] `deferred-work.md:1355` -- reword "given date" to "last date" and the suggested filter to `greatest(date, return_date)`.

**Acceptance Criteria:**
- Given a two-way swap's notice, when `notify` renders it, then subject and body name both dates.
- Given every one-way swap and non-swap code, when rendered, then output is byte-identical to before.
- Given `rg -n "swapRequest" e2e/`, then no e2e step asserts notice copy or the closed-swap cut-off (checked: none today).

## Design Notes

Approved wording (product owner, 2026-11-08; return date in subject and body; WAITING unchanged, no deferred entry), parenthetical as the queue's "{given} · zauzvrat {back}":
- Proposed: `Predložena ti je zamjena {date} (zauzvrat {returnDate})` / `{organizationName}: predložena ti je zamjena smjene {date} (zauzvrat {returnDate}). Odgovori u aplikaciji: {link}`
- Accepted: `Zamjena {date} (zauzvrat {returnDate}) je prihvaćena` / `…: tvoj prijedlog zamjene smjene {date} (zauzvrat {returnDate}) je prihvaćen i čeka odluku. Pogledaj u aplikaciji: {link}`
- Declined / Approved / Rejected: same shape on today's text (`je odbijen(a)`, `je odobrena`, `nije odobrena`).

A variant key rather than conditional text: the renderer refuses a missing operand and has no ICU, and the variant keeps one-way output unchanged.

## Verification

**Commands:**
- `pnpm --filter ./apps/web exec vitest run src/features/teams/services/dependents.test.ts src/features/swaps` -- pass.
- `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:1/postgres pnpm exec vitest run test/notify-boundary.test.ts test/resource-hygiene.test.ts` -- pure cases pass; the unreachable URL makes `noDatabase` true, so DB describes skip and the shared stack is never touched.
- `pnpm typecheck` and `pnpm lint` (repo root, covers `test/` and `supabase/functions`) -- clean.

**Rules for the run:** work only in this worktree; never commit, push, amend or stash; run no other root test file (`test/*.test.ts` connects to the shared database) and never apply a migration or patch `test/database.ts` / `e2e/utils/*`. Node: `PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`.

## Suggested Review Order

**Return shift in two-way notices (R6)**

- Entry point: the variant is picked after operands are checked, so malformed dates still refuse.
  [`messages.ts:384`](../../supabase/functions/notify/messages.ts#L384)

- One map from base message to variant; WAITING has none (0051 writes no returnDate).
  [`messages.ts:187`](../../supabase/functions/notify/messages.ts#L187)

- Variants link where their bases do.
  [`messages.ts:227`](../../supabase/functions/notify/messages.ts#L227)

- Approved wording, source of truth; `messages.ts` is its pinned copy.
  [`hr.json:1851`](../../apps/web/src/lib/i18n/locales/hr.json#L1851)

**Closed swaps until their last date (R5)**

- The card's cut-off now uses the later of given and return date.
  [`my-swaps.ts:470`](../../apps/web/src/features/swaps/services/my-swaps.ts#L470)

- UX line updated to match (Epic AC auditor finding).
  [`EXPERIENCE.md:109`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L109)

**Deactivation re-reads the swaps (R1, R11)**

- Both swap keys join the membership dependents.
  [`dependents.ts:94`](../../apps/web/src/features/teams/services/dependents.ts#L94)

**Tests**

- Exact two-way renders, email and push.
  [`notify-boundary.test.ts:557`](../../test/notify-boundary.test.ts#L557)

- WAITING ignores a returnDate; Q5 allows returnDate only in variants.
  [`notify-boundary.test.ts:600`](../../test/notify-boundary.test.ts#L600)

- Closed two-way swap listed until its last date.
  [`my-swaps.test.ts:497`](../../apps/web/src/features/swaps/services/my-swaps.test.ts#L497)

- Stale decision screen keeps WAITING with `stale: true` (R9).
  [`swap-decision.test.ts:237`](../../apps/web/src/features/swaps/services/swap-decision.test.ts#L237)

- Membership case now expects both swap keys stale.
  [`dependents.test.ts:266`](../../apps/web/src/features/teams/services/dependents.test.ts#L266)

- New keys registered for terminology checks.
  [`resource-hygiene.test.ts:2297`](../../test/resource-hygiene.test.ts#L2297)
