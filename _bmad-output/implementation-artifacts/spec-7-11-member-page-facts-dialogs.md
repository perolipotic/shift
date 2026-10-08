---
title: 'The member page shows facts and each change opens one dialog (7.11)'
type: 'feature'
created: '2026-10-08'
status: 'done'
baseline_commit: '593fc7d2f6142c0fed9c9b121e87378c3e674953'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/ljudi/$id` is headed "Uređivanje osobe" and stacks mounted forms. The basics form edits name, username, e-mail, role, rank and the allowance under one Save. The team and status cards keep their selects and date fields always open, and the team select preselects a team, so a hurried click can move someone to the wrong team.

**Approach:** The page is headed by the person's name and reads as fact cards in the order of `mockups/member-page-1.html`: *Osnovni podaci*, *Smjena*, *Godišnji odmor {year}.*, *Status* and *Prijava*. Each card's header button opens its own small dialog with one final button. The *Smjena* dialog's *Nova smjena* starts empty. The allowance moves out of the basics form into the leave card as *Pravo · Promijeni pravo*, with its own dialog.

## Boundaries & Constraints

**Always:**
- Reuse the shipped writes, preflights, refusal codes, erasure checks (`ErasureDialog`), confirmations and invalidation (`saveMember`, `changeMemberTeam`, `changeMemberStatus`, `resetPassword`, `refreshAfterWrite` + `MEMBER_SAVE_DEPENDENTS` / `MEMBERSHIP_WRITE_DEPENDENTS`). Only the surface moves, with one exception: `saveMember` sends only the fields its edit carries, as it already does for `fireRank`. The basics dialog omits the allowance, and the allowance dialog sends only the allowance, so neither overwrites a field it did not show.
- Dialog pattern of 7.9. The hook owns the open state and the opener ref. Each opening renders a fresh keyed body. While pending, the dialog cannot be dismissed. A refusal keeps the dialog open with a `Notice role="alert"` above the buttons. A landed save closes it, shows the new fact in place with a `Notice role="status"` on the card, and returns focus to the opener. The dialog auto-closes if its offer disappears on a re-read.
- *Nova smjena* is a placeholder choice (`Odaberi smjenu`) that cannot be saved. The current team is labelled `sadašnja`. It stays choosable only while positions are on (a position-only change, shipped behaviour) and is disabled otherwise. *Položaj* and *Vrijedi od* live in the dialog. Save runs the existing preflight, then the erasure check, then the write. There is no second confirm.
- The *Status* dialog holds *Vrijedi od* and the existing neutral question naming the person. Its final button is the action (`Deaktiviraj` / `Ponovno aktiviraj`) and is never `destructive`. Withdrawing a scheduled team or status change stays a card button with its existing `ConfirmDialog`. The *Prijava* card keeps its shipped confirm, then shows the password once.
- Pages compose. The leave card takes the allowance action as a slot from the page, so `leave` never imports `members` outside `FEATURE_PUBLIC`. No barrels. The new element ids are constants in `members/utils/element-ids.ts`. Every literal is in `hr.json`.
- Docs in the same PR: EXPERIENCE.md §Component Patterns (a new *Member page* entry), §IA L66, L101, L123, L133; DESIGN.md §Components L290. Update `sprint-status.yaml` as the workflow moves 7.11.

**Ask First:** a migration or Edge Function change; any new RPC, validation rule or refusal code beyond the placeholder refusal; a new dependency.

**Never:** a team, position or status control mounted on the page outside a dialog; a preselected team; `destructive` styling on deactivation; toasts or standing banners; a second implementation of a write or preflight.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Facts | admin opens an active member in Smjena A, positions on | `h1` = name; subline rank · position in team; badges role + status; five cards; no `<form>` on the page outside the leave card's record form | N/A |
| Team move | `Promijeni` → B, `vozač`, date → Spremi | dialog closes, *Smjena* card shows the scheduled callout, status notice | erasures → existing `ErasureDialog`, then the write |
| Team untouched | open → Spremi with the placeholder | Spremi refused in the dialog (`Odaberi smjenu.`), nothing sent | dialog stays open |
| Allowance | `Promijeni pravo` → 25 → Spremi | *Pravo* reads 25 and *Preostalo* updates (same snapshot) | invalid value → `MEMBER_WRITE_INVALID`, field marked |
| Basics | `Uredi` → change role only | row saved without `leave_allowance_days`; last-admin demotion refused in the dialog | partial save (rename refused) → shipped `saved: true` notice |
| Deactivate | `Deaktiviraj` → date → `Deaktiviraj` | status card shows the scheduled change | past date → existing refusal, date focused |
| Own row | admin opens their own page | no *Status* button (shipped `statusOfferOf` null) | N/A |

## Epic AC Deviations

- *"a change to role, team, allowance, rank or status … opens its own dialog with one Save"*: reinterpreted per the mockup. Role and rank share the *Osnovni podaci* dialog with name, username and e-mail. Team (with position and date), allowance and status each have their own dialog. Every change is behind a dialog, and team, the risky one, is isolated. The status dialog's single final button is labelled with its action, not `Spremi`.
- Decision 16's *Što se mijenja* in the team dialog (last shift in A, first in B) is DEFERRED. It needs a member-move projection that does not exist yet (`change-preview.ts` models one team on one day). Logged in `deferred-work.md`.
- The deactivation consequence in numbers belongs to 7.13 (UX-DR27). This story keeps the shipped question.
- *"no stacked forms"*: narrowed. The leave card's record form (od/do) stays mounted on the page, because story 7.12 moves it into its own dialog. It is the only `<form>` outside a dialog. Approved in the code review of 2026-10-08.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/ljudi.$id.tsx` -- `LjudiMemberScreen` L33-97: `h1` is `ljudi.form.editHeading` → name + subline + badges; composes the cards L79-94
- `apps/web/src/features/members/hooks/use-member-edit.ts` -- one hook (return L1125-1188). Basics `submit` L1033-1123 (refs L142-147); team `armTeam` L376, `pickTeam` L440, `writeTeam` L461, `changeTeam` L524, `focusTeamCard` L590, `confirmTeamErasures` L633; status `armStatus` L711, `writeStatus` L757, `changeStatus` L808; reset `issue` L991. Add open/close per dialog, and fold arm+confirm into one Save
- `apps/web/src/features/members/components/member-basics-card.tsx` -- stacked form L40-277 → facts card + `MemberBasicsDialog`; drop `#member-leave` L173-194
- `apps/web/src/features/members/components/member-team-card.tsx` -- select L227-269 (`defaultValue` from `teamPickerDefault` L237), position L277-302, `ConfirmDialog` L325-396 → facts + `MemberTeamDialog`
- `apps/web/src/features/members/components/member-status-card.tsx` -- L45-300, same reshaping → `MemberStatusDialog`
- `apps/web/src/features/members/components/member-reset-card.tsx` -- L31-203, becomes the *Prijava* card (button in the header)
- `apps/web/src/features/members/services/write.ts` -- `saveMember` L505 (partial edit; `fireRank` L533 is the precedent); `teamPickerDefault` L1468 (remove; the dialog starts at the placeholder); `positionPickerDefault` L1526 (keep, applied after a pick); `teamOfferFor` L1582
- `apps/web/src/features/leave/components/member-leave-card.tsx` -- figures L85-131: add the `allowanceAction` slot beside *Pravo*; the card reads the allowance from `MEMBERS_LIST_KEY`
- `apps/web/src/features/members/utils/rank.ts` L188/L211, `utils/position.ts` L112 -- rank/position gating (`usesFireRanks`), read only
- `apps/web/src/components/ui/dialog.tsx` -- `Dialog`, `DialogHeader`, `DialogFooter`, `ConfirmDialog`; models: `features/teams/components/team-add-dialog.tsx`, `calendar/components/override-form.tsx` `OverrideChangeDialog` L172 (placeholder `OVERRIDE_NO_TYPE` L104), `use-override-form.ts` `openChange` L778 / `closeChange` L791 / `formGone` L249
- `apps/web/src/lib/i18n/locales/hr.json` -- `ljudi` L540-728 (`form` L566, `rank` L620, `status` L636, `leaveRecord` L675); `smjene.membership` L1184-1229
- `apps/web/src/features/members/services/write.test.ts` -- `teamPickerDefault` cases L2081, L2267 → placeholder cases; `saveMember` without the allowance
- `e2e/pages/people.page.ts` -- form locators L107-125, status L179-203, team L230-260, `moveToTeam` L415: open the dialog first
- `e2e/tests/people/{people,team-position,member-erasures,fire-ranks,leave}.spec.ts`, `teams/teams.spec.ts` L45/L190, `conflicts/conflict-resolution.spec.ts` L964 -- churn
- Docs: `ux-designs/ux-shift-2026-09-02/EXPERIENCE.md` L66, L87-112, L101, L123, L133; `DESIGN.md` L290

## Tasks & Acceptance

**Execution:**
- [x] `members/services/write.ts` + test -- `saveMember` takes a partial edit (absent field = not sent); remove `teamPickerDefault`; a placeholder team value refused before preflight -- write layer
- [x] `members/hooks/use-member-edit.ts` -- per-dialog open state, opener refs, refusal reset on open, auto-close on a lost offer, one Save per dialog -- wiring
- [x] `members/components/*` (basics, team, status, reset; new `member-allowance-dialog.tsx`), `members/utils/element-ids.ts` -- facts cards + dialogs -- the surface
- [x] `leave/components/member-leave-card.tsx`, `pages/ljudi.$id.tsx` -- allowance slot; name heading, subline, badges -- composition
- [x] `hr.json` -- new keys; retire the unused ones -- i18n
- [x] `e2e/pages/people.page.ts` + the specs above -- drive the dialogs; assert no `<form>` on the page, an empty *Nova smjena* and the allowance in the leave card -- churn
- [x] EXPERIENCE.md, DESIGN.md, `deferred-work.md` (team *Što se mijenja*), sprint-status -- docs

**Acceptance Criteria:**
- Given an admin opens a member's page, then the `h1` is the person's name, the facts read without any `<form>` on the page outside the leave card's record form, and the allowance sits in the leave card.
- Given any card button, then its own dialog opens with one final button, and closing it returns focus to that button.
- Given `Promijeni` on *Smjena*, then *Nova smjena* shows `Odaberi smjenu` with no team selected.
- Lint (including feature boundaries), typecheck, unit and e2e tests pass at 1280 and 390.

## Spec Change Log

- 2026-10-08, code review (Epic AC Auditor, Blind Hunter): the leave card's record form stays on the page until 7.12. The I/O matrix *Facts* row and the first AC now say "outside the leave card's record form", and Epic AC Deviations records the narrowing. Human approved the frozen amendment. Code unchanged by it.
- 2026-10-08, code review patches: auto-close always says stale; a pending team/status dialog outlives its offer; a re-read keeps the team pick; dialog state resets per member; partial save survives Odustani; *Prijava* focus returns to its button; h1 is the name without `today`; archived current team; allowance action out of the `<dl>`; status dialog description; effect dependencies; empty patch guard; copy, ids, comments; tests for reset refusal, unknown member, re-read auto-close, reactivation keys, yearly heading, 390 px dialogs, member facts.

## Design Notes

The hook stays one object, which the cards already destructure. Grouping the new state per dialog (`basicsDialog`, `teamDialog`, `statusDialog`, `allowanceDialog`) keeps the return readable. `MemberEdits` becomes a partial patch: an absent field is not sent, and the blank-name check and the rename run only when `name` / `username` are present. `saveMember` stays the one member write. Neither dialog writes back a cached value that another admin may have changed since the page was read.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- expected: clean, boundary test passes
- `pnpm --filter ./apps/web test` -- expected: all green
- `pnpm e2e` (people, teams, leave and conflicts suites) -- expected: green at 1280 and 390

## Suggested Review Order

**The page reads as facts**

- Entry point: the page composes the name heading, five fact cards and the allowance slot.
  [`ljudi.$id.tsx:76`](../../apps/web/src/pages/ljudi.$id.tsx#L76)

- Name as `h1`, with rank · position · team and the role and status badges under it.
  [`member-page-header.tsx:19`](../../apps/web/src/features/members/components/member-page-header.tsx#L19)

- Header facts derived in one place, so today's facts never include a future-dated move.
  [`member-facts.ts:41`](../../apps/web/src/features/members/utils/member-facts.ts#L41)

**The team dialog: starts empty, isolated**

- `Odaberi smjenu` placeholder; `sadašnja` is choosable only while positions are on.
  [`member-team-card.tsx:240`](../../apps/web/src/features/members/components/member-team-card.tsx#L240)

- The placeholder is refused before the preflight, so nothing is sent.
  [`write.ts:1484`](../../apps/web/src/features/members/services/write.ts#L1484)

**Dialog lifecycle in the hook**

- Each opening holds what it was opened on, so a re-read never redraws it.
  [`use-member-edit.ts:131`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L131)

- Stays busy while the write is in flight, then closes as stale if the offer is gone.
  [`use-member-edit.ts:477`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L477)

- The status dialog stays open only while the same change is still offered.
  [`use-member-edit.ts:428`](../../apps/web/src/features/members/hooks/use-member-edit.ts#L428)

**One write, partial patches**

- Only the fields a dialog shows are sent, so no dialog writes back a cached value.
  [`write.ts:518`](../../apps/web/src/features/members/services/write.ts#L518)

- An empty patch is refused, never sent as an empty PATCH.
  [`write.ts:557`](../../apps/web/src/features/members/services/write.ts#L557)

**Allowance and status dialogs**

- *Promijeni pravo* lives in the leave card through a slot; `leave` never imports `members`.
  [`member-leave-card.tsx:56`](../../apps/web/src/features/leave/components/member-leave-card.tsx#L56)

- The allowance dialog: the allowance alone, one Spremi.
  [`member-allowance-dialog.tsx:65`](../../apps/web/src/features/members/components/member-allowance-dialog.tsx#L65)

- Status: date plus one neutral question; the final button is the action, never destructive.
  [`member-status-card.tsx:215`](../../apps/web/src/features/members/components/member-status-card.tsx#L215)

- *Prijava*: the button stays mounted, so cancel and refusal return focus to it.
  [`member-reset-card.tsx:83`](../../apps/web/src/features/members/components/member-reset-card.tsx#L83)

**Peripherals**

- e2e: facts at both widths, role without the allowance, last admin, partial save, re-read auto-close, 390 px.
  [`people.spec.ts:98`](../../e2e/tests/people/people.spec.ts#L98)

- e2e: a dialog closing itself on a re-read.
  [`people.spec.ts:355`](../../e2e/tests/people/people.spec.ts#L355)

- EXPERIENCE.md *Member page* pattern.
  [`EXPERIENCE.md:98`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L98)

- DESIGN.md Dialog row: which dialogs keep a refused value and which start afresh.
  [`DESIGN.md:290`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L290)
