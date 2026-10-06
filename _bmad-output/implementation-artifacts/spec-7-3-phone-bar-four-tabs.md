---
title: 'The phone bar has four tabs and Više (7.3)'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: 'ba553efd995280a5e815a2a8661b067d7da75ed1'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Below 640 px the bottom bar holds the lockup, a theme cycle, up to eight destinations and Odjava in one sideways-scrolling row. An admin sees about three tabs, and the active tab can sit off screen (UX review finding 1, Q16).

**Approach:** The phone bar becomes a 5-column grid: four fixed tabs per role plus a *Više* button. *Više* opens a bottom sheet on the native `Dialog` primitive. The sheet holds the role's remaining destinations, the theme control and Odjava. On desktop the theme control moves from the sidebar foot into the profile menu, next to Odjava. Mockup: `ux-designs/ux-shift-2026-10-01-redesign/mockups/mobile-navigation-1.html`.

## Boundaries & Constraints

**Always:**
- Tabs: member Danas, Kalendar, Sati, Godišnji. Admin Danas, Kalendar, Raspored, Ljudi. The *Više* sheet lists the rest in binding order, in two groups. *Pregled* holds destinations every role reaches (Sati, Godišnji). *Postavke* holds admin-only ones (Postavke rotacije, Organizacija). Then *Prikaz* (theme), then Odjava. A member's sheet has only *Prikaz* and Odjava.
- The tab split is data in `destinations.ts` and is executed by `destinations.test.ts`, never filtered in markup.
- One `<Link>` element in the chrome renders every destination (sidebar, tab, sheet row). The active treatment stays `aria-current` plus pill, semibold and underline.
- When the current route is a sheet destination, *Više* carries `aria-current="page"` and the active treatment.
- The sheet is modal, with focus trap, Escape, backdrop press and focus return to *Više*. It has `aria-label` "Više" and a 44 px close button. It closes on navigation and when a sign-out is refused, so the alert can be reached.
- Every bar cell is ≥ 44 px tall. At 320 px the cells are 64 px wide. The bar never scrolls.
- The sticky bar's `<nav>` stays its direct child (the calendar e2e finds the bar as the `nav`'s sticky parent). Bottom padding and `scroll-padding-bottom` match the new bar height.
- The phone bar keeps the accent edge. The lockup leaves the phone bar. The sheet header shows avatar, name and "role · organization".
- Update EXPERIENCE.md (§IA, §Responsive & Platform), DESIGN.md (Shell row), UX-DR2/31/32 and the reach of story 1.8 in `epics.md`, in the same change.

**Ask First:** Showing the Raspored conflict badge. Changing the desktop sidebar beyond moving the theme control. Adding entries to the member's sheet.

**Never:** A second destination table or a role branch in the chrome. Persisting the sheet or collapse state. `destructive` on Odjava. A new runtime dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin on Sati, phone | `/sati`, 390 px | *Više* is current, and the Sati row in the sheet is current | N/A |
| Member opens Više | member, 320 px | Sheet shows theme and Odjava, and no destination | N/A |
| Escape in sheet | sheet open | Sheet closes, focus returns to *Više* | N/A |
| Sign-out refused in sheet | logout request fails (500) | auth-js drops the local session, so the device signs out and lands on the sign-in prompt; no alert (human decision 2026-10-06) | `SIGN_OUT_FAILED` alert only when `signOut()` throws |
| Role read fails | no role | No tabs. *Više* still opens theme and Odjava. Alert with retry | existing path |
| Role pending | query pending | Skeleton in the tab area | N/A |

### Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/navigation/utils/destinations.ts` -- `DESTINATIONS` (binding order, `EVERYONE`/`ADMIN_ONLY`), `destinationsFor`, `isCurrentDestination`. Add the per-role phone tab paths and a reader that returns `{ tabs, more }`, where `more` holds the rest in binding order, split into everyone and admin-only.
- `apps/web/src/features/navigation/utils/destinations.test.ts` -- pins counts and order as sequences. Extend it for tabs and the sheet split.
- `apps/web/src/features/navigation/components/chrome.tsx` -- `renderDestinations` (:398, the single `<Link>`), `renderThemeSegments` (:461, `aria-pressed`), `renderThemeCycle` (:492), `renderSignOut` (:523), `renderProfile` (:554, the menu holds the exit), the phone bar at :749-766, and the `pathname` effect (:263). Rewrite the header block comment (:52-160) wherever it describes the old bar.
- `apps/web/src/components/ui/dialog.tsx` -- `Dialog` (native `showModal`, backdrop press, focus return) and `DialogHeader`. Reuse them for the sheet and override the className to dock it at the bottom.
- `apps/web/src/lib/i18n/locales/hr.json` -- `shell.*`. New keys: `more` "Više", `moreClose` "Zatvori izbornik Više", and groups `Pregled` / `Postavke` / `Prikaz`. Keep them out of `nav.*`, because the destinations test requires every `nav` key to be a destination.
- `apps/web/src/index.css:482-488` -- `scroll-padding-bottom: calc(4rem …)`, tied to the bar height.
- `apps/web/src/pages/prijava.test.ts:4071-4482, 7240-7275` -- source-level pins on the chrome. "Exit in both bars", "lockup is the phone bar's first child", `{destinations}` in both `<nav>`s, `pb-[calc(4rem`, and one `<Link>`. Re-point them to the new structure. Keep their intent: the exit is reachable per layout, the lockup is never inside a landmark, there is one link element, and the active treatment is not colour alone.
- `e2e/pages/base.page.ts` -- `navigation`, `navigationLink`, `profileButton` and `signOutButton`. Add `moreButton` and `moreSheet`.
- `e2e/tests/auth/sign-in.spec.ts:19-35` -- checks every destination visible at the desktop viewport (Desktop Chrome). It stays valid.
- `e2e/tests/layout/responsive.spec.ts` and `e2e/utils/layout.ts` -- `expectNoHorizontalScroll` and `expectTouchTargets` at 320 px.
- `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md:25-50,159-167` and `DESIGN.md:295`, plus `epics.md:110,147-148,462-471`.

## Tasks & Acceptance

**Execution:**
- [x] `destinations.ts` + test -- add the phone tab data and the `{ tabs, more }` reader. Tests: four tabs per role in the stated order; tabs ∪ more equals `destinationsFor(role)` with no overlap; more keeps binding order; the member's more is empty.
- [x] `hr.json` -- add the new `shell` keys.
- [x] `chrome.tsx` -- one link renderer used by the sidebar, the tabs and the sheet rows. Phone bar: `grid grid-cols-5`, tabs with the icon over the label, and *Više* (lucide `Ellipsis`) as a button with `aria-expanded`/`aria-haspopup="dialog"`. Add the sheet. Remove the lockup, the theme cycle and the exit from the bar. Theme segments go into the profile menu, with the theme block removed from the sidebar foot and the collapsed-rail cycle removed. Close the sheet on a pathname change and on a sign-out failure. Update the header comment.
- [x] `index.css` -- match the scroll padding to the new bar height.
- [x] `prijava.test.ts` -- re-point the chrome pins as above. Add pins: the sheet holds the exit and the theme, the profile menu holds the theme, the bar has no `overflow-x-auto`.
- [x] `e2e/pages/base.page.ts` + new `e2e/tests/layout/phone-navigation.spec.ts` -- run at 390 and 320 px, admin and member. Check: exactly the four tab links plus *Više*; `nav.scrollWidth <= nav.clientWidth`; every cell ≥ 44 px; the active tab is inside the viewport; *Više* opens the sheet with the expected links, theme and Odjava; Escape restores focus to *Više*; following Sati from the sheet makes *Više* current. At desktop, check the profile menu shows the theme group and Odjava.
- [x] `sign-in.spec.ts` -- if the desktop Odjava test still passes unchanged, leave it. Add a phone sign-out through *Više*.
- [x] Binding docs -- EXPERIENCE §IA (phone tabs and *Više*) and §Responsive (admin priority), DESIGN Shell row, UX-DR2 (theme lives in *Više* and the user menu), UX-DR31/32, and the 1.8 note in `epics.md`.
- [x] `deferred-work.md` -- ledger the mockup extras not built: the Raspored ⚠ badge, the *Više* sublabel naming the current place, the desktop sidebar group labels, and the member's *Moja smjena* row (7.17).

**Acceptance Criteria:**
- Given 390 or 320 px and any role, when the bar renders, then it shows four tabs plus *Više*, nothing scrolls sideways, and the current tab or *Više* is visible and marked.
- Given an admin on a phone, when *Više* opens, then Sati and Godišnji (Pregled), Postavke rotacije and Organizacija (Postavke), the three theme options and Odjava are reachable by keyboard and labelled.
- Given a desktop viewport, when the profile card opens, then the theme's three options and Odjava are there, and the sidebar foot has no theme control.
- Given the suite, when `pnpm test` and the e2e layout specs run, then they pass.

## Design Notes

The groups come from `roles` (everyone vs admin-only), so no `group` field is added to the table. The tab lists are a per-role tuple of `RegisteredPath`, checked against `destinationsFor`. The sheet reuses the one `Dialog`, so the browser provides the focus trap and focus return, as it does for every other modal.

## Verification

**Commands:**
- `pnpm --filter ./apps/web test && pnpm exec vitest run && pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm test:e2e e2e/tests/layout e2e/tests/auth e2e/tests/calendar/layout.spec.ts` -- expected: pass

**Manual checks:**
- In the demo at 390 px, in both themes, as admin and member: open *Više*, switch the theme, sign out.

## Suggested Review Order

**The tab split is data**

- Entry point: four fixed tabs per role, read as a set; binding order rules
  [`destinations.ts:163`](../../apps/web/src/features/navigation/utils/destinations.ts#L163)

- Tabs plus Više groups derived from `roles`, no group field on the table
  [`destinations.ts:189`](../../apps/web/src/features/navigation/utils/destinations.ts#L189)

**One link, three placements**

- One `<Link>` for sidebar, tab and sheet; placement decides title and close-on-press
  [`chrome.tsx:492`](../../apps/web/src/features/navigation/components/chrome.tsx#L492)

- Shared active treatment so the link and Više cannot drift
  [`index.css:601`](../../apps/web/src/index.css#L601)

- The bar: five-cell grid, no scroller, Više with `aria-haspopup`/`aria-current`
  [`chrome.tsx:909`](../../apps/web/src/features/navigation/components/chrome.tsx#L909)

**The Više sheet**

- Docked native Dialog: identity header, groups, theme, Odjava
  [`chrome.tsx:684`](../../apps/web/src/features/navigation/components/chrome.tsx#L684)

- Close guarded while a sign-out is in flight
  [`chrome.tsx:347`](../../apps/web/src/features/navigation/components/chrome.tsx#L347)

- Closes on refused sign-out in the same render, so the alert takes focus
  [`chrome.tsx:390`](../../apps/web/src/features/navigation/components/chrome.tsx#L390)

- Closes when the viewport turns wide, so no modal outlives the phone layout
  [`wide.ts:10`](../../apps/web/src/features/navigation/hooks/wide.ts#L10)

**Desktop theme moves into the profile menu**

- Theme segments above Odjava; the sidebar foot and rail cycle are gone
  [`chrome.tsx:625`](../../apps/web/src/features/navigation/components/chrome.tsx#L625)

- Scroll padding matches the new 4rem + edge bar height
  [`index.css:489`](../../apps/web/src/index.css#L489)

**Binding docs**

- UX-DR2/31/32 rewritten for four tabs and Više
  [`epics.md:110`](../planning-artifacts/epics.md#L110)

- §IA phone bar paragraph
  [`EXPERIENCE.md:31`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L31)

- Shell row: five cells, navy sheet, theme in profile menu
  [`DESIGN.md:295`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L295)

**Tests**

- Rendered proof at 390/320 for both roles, sheet dismissal, matrix rows, desktop menu
  [`phone-navigation.spec.ts:52`](../../e2e/tests/layout/phone-navigation.spec.ts#L52)

- Tab order pinned as a sequence against `PHONE_TABS`
  [`destinations.test.ts:363`](../../apps/web/src/features/navigation/utils/destinations.test.ts#L363)

- Source pins re-pointed: exit and theme in sheet and profile menu, shared treatment
  [`prijava.test.ts:1877`](../../apps/web/src/pages/prijava.test.ts#L1877)

- Phone sign-out through Više
  [`sign-in.spec.ts:117`](../../e2e/tests/auth/sign-in.spec.ts#L117)
