---
title: 'Organization settings show facts and change through dialogs (7.18)'
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

**Problem:** `/organizacija` is one mounted form: name and leave-year start share one Save, while the logo, the accent `<select>` and the fire-rank `<select>` each write the instant they change. The timezone is a side note in an aside, with no reason given. On `/postavke-rotacije`, *Povijest rotacije* is a full table at the end of the builder.

**Approach:** Organizacija reads as fact cards in the order of `mockups/setup-1.html` §5: *Profil* (Naziv, Logotip, Naglasak), *Vrijeme i godina* (Vremenska zona, locked, with the reason; Godina godišnjeg) and *Vatrogasni činovi i položaji*. Each change opens its own small dialog with one Spremi. The accent dialog shows named radio cards and the UX-DR5 rule. On the rotation page, a `Povijest rotacije` header button opens the history table in a dialog.

## Boundaries & Constraints

**Always:**
- Reuse the shipped writes: `updateOrganization` with the four disjoint shapes, `replaceOrganizationLogo`, and `ORGANIZATION_SNAPSHOT_KEY` invalidation (a failed refetch is logged, never reported as a refusal). One snapshot, one key.
- 7.11 dialog pattern. The hook owns which dialog is open (with a fresh key per opening) and each opener ref. The `Dialog` stays mounted and is driven by `open`. While a write is pending it cannot be dismissed. A refusal keeps the dialog open with a `Notice role="alert"` above the buttons, keeps what was entered, and marks and focuses the named field. A landed save closes it, shows a `Notice role="status"` on the card, and returns focus to the opener.
- Nothing writes on change. The logo is chosen, then sent by Spremi. Spremi stays disabled while nothing is chosen: no file picked, or a stored accent this build does not know, in which case the line says `Odaberi naglasak.`.
- The name and leave-year dialogs use the identity write. Each fills the fields it does not show from the snapshot as it is at submit time. Type and timezone are written back unchanged, as before.
- Every literal goes in `hr.json`. Pages compose and features hold the logic. No barrels. Docs ship in the same change: DESIGN.md §Components (Dialog row, RadioCard row), EXPERIENCE.md §Component Patterns (a new *Organization settings* entry, and the rotation save bar no longer follows the history) and §IA (*Organizacija* line, surface inventory row).

**Ask First:** a migration, RLS or Edge Function change; a new write shape or refusal code; a new dependency.

**Never:** a field or select mounted on the page outside a dialog; a write on change; a timezone or locale control; `destructive` styling; toasts; a second implementation of a write.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Facts | admin opens Organizacija | `h1` Organizacija; three cards; no `<form>` on the page; zone with a lock and the reason sentence | read failure → alert + `Pokušaj ponovno`, retry success focuses the name opener |
| Rename | `Promijeni` (naziv) → type → Spremi | dialog closes, *Profil* shows the name, status notice, focus on the opener | blank → `Naziv ne može biti prazan.`, field marked and focused, dialog open |
| Accent | `Promijeni` (naglasak) → Zelena → Spremi | shell tints after the refetch; fact reads Zelena | refused → alert in dialog |
| Logo | choose file → Spremi | lockup shows the image | too large / wrong type → logo message in dialog |
| Fire ranks | `Uredi` → Koriste se → Spremi | card notice `Vatrogasni činovi i položaji: koriste se.` | refused → alert in dialog |
| History | `Povijest rotacije` header button | dialog with the table (or the empty line); Escape returns focus | N/A |

## Epic AC Deviations

- *"each change opens its own dialog with one Save"*: the mockup's single *Profil* dialog (name, logo, accent) is split into three dialogs along the existing disjoint writes. One Spremi then never sends several writes that could half-land. Leave year and fire ranks keep a dialog each.
- The mockup's *Satni pojasi* facts card and the leave dialog's *Tekuća godina godišnjeg* line are not built: no criterion asks for them, and the first needs a second read. The header link to Satni pojasi stays.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/organizacija.tsx` -- composes header + settings card + `OrganizationAbout` aside; drop the aside, keep the Satni pojasi link
- `apps/web/src/features/organization/hooks/use-organization-settings.ts` -- rewrite: drop refs/queues (`queuedAccent`, `drainFireRanks`, `fireRanksRevision`, `writingElsewhere`); add dialog opening + openers + per-dialog saves
- `apps/web/src/features/organization/components/organization-settings-card.tsx` -- becomes the container: read alert + retry, the three fact cards
- `components/organization-logo-card.tsx` → logo dialog; `organization-about.tsx` removed
- `apps/web/src/features/organization/settings-screen.fixture.ts` -- file set read by `pages/prijava.test.ts` and `services/snapshot.test.ts` (source-pinning: key counts L2123, settings sweeps ~L6900-8700; snapshot.test L1145-1360)
- `apps/web/src/features/members/utils/rank.ts` -- `FIRE_RANKS_OPTIONS`, `fireRanksValue/Of`, `fireRanksMessageKey`, `fireRanksStatusMessageKey` stay; queue helpers (`fireRanksStepOf`, `fireRanksClearsFailure`, `fireRanksFollowUpOf`, `FIRE_RANKS_QUEUE`, `fireRanksControlKey`) go with their tests
- `apps/web/src/features/organization/utils/{accent,accent-label,leave-start}.ts` -- options, labels; add a leave-year-start label helper
- `apps/web/src/components/ui/{dialog,radio-group}.tsx` -- `Dialog`, `RadioGroup`/`RadioCard`/`RadioRow`; model `features/members/components/member-allowance-dialog.tsx`
- `apps/web/src/features/rotation/components/rotation-section.tsx` -- `renderHistory` L1402, rendered L1869; `PageHeader` L1755 → header button + dialog
- `e2e/pages/{organization,rotation}.page.ts`, `e2e/tests/organization/settings-retry.spec.ts`, `layout/responsive.spec.ts` L101, `people/{fire-ranks,team-position}.spec.ts`, `rotation/{rotation,rotation-save-bar,rotation-cancel-erasures}.spec.ts` -- churn
- Docs: `ux-designs/ux-shift-2026-09-02/{DESIGN.md L270-300, EXPERIENCE.md L47, L70, L98, L109}`

## Tasks & Acceptance

**Execution:**
- [x] `features/organization/hooks/use-organization-settings.ts` -- dialog state + saves -- wiring
- [x] `features/organization/components/*`, `utils/element-ids.ts`, `utils/leave-start.ts` (+ test) -- fact cards and five dialogs -- surface
- [x] `pages/organizacija.tsx`, `settings-screen.fixture.ts` -- composition
- [x] `features/members/utils/rank.ts` + test -- retire the on-change queue helpers
- [x] `features/rotation/components/rotation-history-dialog.tsx`, `rotation-section.tsx` -- header button + dialog
- [x] `hr.json` -- new keys; retire unused ones
- [x] `pages/prijava.test.ts`, `services/snapshot.test.ts`, `test/resource-hygiene.test.ts` -- follow the new sources
- [x] e2e page objects + specs above, plus `e2e/tests/organization/settings-dialogs.spec.ts` (facts, dialog focus return, history dialog) -- written, not run
- [x] DESIGN.md, EXPERIENCE.md -- docs

**Acceptance Criteria:**
- Given an admin on Organizacija, then no form or select is mounted on the page and every change button opens one dialog with one Spremi; closing by ✕, backdrop or Escape returns focus to that button.
- Given the accent dialog, then each option is a radio card with its name, and the rule sentence sits beside them.
- Given Postavke rotacije, then the history table is not on the page, and the header button opens it.
- Lint, typecheck and the apps/web unit tests pass.

## Design Notes

The hook keeps the single failure slot, now owned by the open dialog: one dialog at a time, so no queue is needed. A save that lands closes the dialog through state. `Dialog`'s effect then calls `close()`, the browser returns focus, and `focusLater` covers the case where the opener re-rendered. The accent card previews the mark through `OrganizationLockup` (hidden from assistive technology), so UX-DR5's tint stays inside the lockup.

**The identity write is split per field (Ask First, approved by the human 2026-10-08).** The Always rule "Type and timezone are written back unchanged" is superseded. Filling the fields a dialog does not show from the cached snapshot lost updates: a stale cache wrote another admin's newer leave year back over theirs on a rename, and could write an old timezone back, against FR-8. `OrganizationEdits` (five columns) is replaced by two one-purpose shapes, `OrganizationNameEdit` (`{ name }`) and `OrganizationLeaveYearEdit` (`{ leaveYearStartMonth, leaveYearStartDay }`), beside the logo, accent and fire-rank shapes, with `organizationEditColumns` still exhaustive over `never`. No write names `organization_type` or `timezone`. The client-side `isRenderableTimeZone` refusal and its `ORGANIZATION_TIMEZONE_UNKNOWN` code and message are gone with the zone: a rename is never refused over a zone it does not touch. No migration: `organizations_update_by_own_active_admin` (0004) is row-level, the column grants are per column, and no trigger or table-level check on `organizations` needs the other columns.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- clean
- `pnpm --filter ./apps/web test` and `npx vitest run test/resource-hygiene.test.ts` -- green

## Spec Change Log

- 2026-10-08, review (Edge Case Hunter, Blind Hunter, Verification Gap): no intent gap and no bad spec; patches applied. A refused accent marks its radio group `aria-invalid`; a refusal that names no field returns focus to Spremi (it was disabled in flight); both radio groups point at the refusal while it shows; a read that loses the row clears the open dialog; the history button no longer waits for a draft; EXPERIENCE.md no longer claims every button's name is its dialog's title. Rejected: leave-year values outside 1-28/1-12 (the database's checks make them unreachable); hard-coded rotation history ids (the builder's own convention). Not done, reported instead: executed e2e saves of each dialog (the run's organization is shared, so the new spec only opens and closes dialogs).
- 2026-10-08, review follow-up: the human approved splitting the identity write per field (Design Notes), which fixes a lost update on a stale cache and keeps every save off the timezone (FR-8). Also: a re-read that loses the row under an open dialog moves focus to the read's retry (or its message), and EXPERIENCE.md says the unsaved value is discarded; the name field and the leave-year selects are disabled while their write is in flight; a write that throws moves focus as a refusal does, and a refused or failed upload returns focus to `Odaberi sliku`; the timezone lock is drawn once, beside the zone. Merged `origin/main` (7.12).

## Suggested Review Order

**The page reads as facts**

- Entry point: the page composes the header and one body; the aside is gone.
  [`organizacija.tsx:38`](../../apps/web/src/pages/organizacija.tsx#L38)

- Read alert and retry outside the gated branch; three fact cards once there is a row.
  [`organization-settings-card.tsx:54`](../../apps/web/src/features/organization/components/organization-settings-card.tsx#L54)

- Zone shown locked with the FR-8 reason; no control for it.
  [`organization-time-card.tsx:92`](../../apps/web/src/features/organization/components/organization-time-card.tsx#L92)

**One dialog per change**

- The shared dialog: always mounted, driven by `open`, Escape routed through state.
  [`organization-dialog.tsx:44`](../../apps/web/src/features/organization/components/organization-dialog.tsx#L44)

- One form, one Spremi beside Odustani, refusal above the buttons.
  [`organization-dialog.tsx:95`](../../apps/web/src/features/organization/components/organization-dialog.tsx#L95)

- The accent as named radio cards beside the UX-DR5 rule.
  [`organization-accent-dialog.tsx:83`](../../apps/web/src/features/organization/components/organization-accent-dialog.tsx#L83)

- The logo pick is held until Spremi; the picker resets for a retry.
  [`organization-logo-dialog.tsx:87`](../../apps/web/src/features/organization/components/organization-logo-dialog.tsx#L87)

**The hook: one runner for five writes**

- Refusal keeps the dialog and focuses the field or Spremi; a landed save closes and returns focus.
  [`use-organization-settings.ts:238`](../../apps/web/src/features/organization/hooks/use-organization-settings.ts#L238)

- The name and leave-year dialogs each send only what they show; no write names the zone.
  [`use-organization-settings.ts:294`](../../apps/web/src/features/organization/hooks/use-organization-settings.ts#L294)

- A read that loses the row clears the open dialog.
  [`use-organization-settings.ts:180`](../../apps/web/src/features/organization/hooks/use-organization-settings.ts#L180)

**Rotation history behind a header button**

- Read-only dialog with the history table; focus returns to the button.
  [`rotation-history-dialog.tsx:26`](../../apps/web/src/features/rotation/components/rotation-history-dialog.tsx#L26)

- Rendered in the builder's header, no longer after the steps.
  [`rotation-section.tsx:1696`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L1696)

**Peripherals**

- Source sweeps for the new surface.
  [`prijava.test.ts:7111`](../../apps/web/src/pages/prijava.test.ts#L7111)

- EXPERIENCE.md *Organization settings* and *Rotation history* entries.
  [`EXPERIENCE.md:101`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L101)

- e2e: facts, focus return per way out, accent cards, history (written, not run).
  [`settings-dialogs.spec.ts:1`](../../e2e/tests/organization/settings-dialogs.spec.ts#L1)
