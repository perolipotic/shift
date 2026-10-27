---
title: '8.4 Install from Više'
type: 'feature'
created: '2026-10-22'
status: 'done'
baseline_commit: 'c6743211a2f576d06a3849a0d945cd2917699928'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-1-the-app-is-installable.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app is installable (8.1), but the only route to install is the browser's own menu, which a member has to be shown.

**Approach:** Add an *Instaliraj* row that appears only when it can do something:
- in the phone *Više* sheet and in the desktop profile menu (decision 2026-10-22, 1a);
- where the browser offers an install prompt, the row opens it;
- on any iOS browser, the row reveals the Share → Add to Home Screen steps inline (decisions 3a and 4a);
- once installed, or when neither applies, the row is not shown (decision 2a).

The row never opens a modal on first visit.

## Boundaries & Constraints

**Always:**
- **Install store.** `lib/pwa/install.ts` is pure and takes injected sources: the deferred `beforeinstallprompt` event, the `appinstalled` event, `(display-mode: standalone)`, `navigator.standalone`, and UA/platform/maxTouchPoints. `installKindOf(...)` returns `'prompt' | 'ios' | 'installed' | 'none'`. The store offers `subscribe`, `snapshot` and `prompt()`. It calls `preventDefault` on `beforeinstallprompt` and keeps the event. After `userChoice` or `appinstalled` it drops the event.
- **Page wiring.** `lib/pwa/page-install.ts` registers the listeners at the TOP of `main.tsx`, before any `await`, because the event can fire early. It follows the `appFreshness` `start` pattern (idempotent, `import.meta.hot?.dispose`). A hook reads the store through `useSyncExternalStore`.
- **iOS detection.** `/iPad|iPhone|iPod/` in the UA, or `platform === 'MacIntel' && maxTouchPoints > 1` (iPadOS). Every iOS browser counts, not only Safari.
- **The row.** It sits in `renderMore()` (phone sheet, between *Prikaz* and Odjava) and in `renderProfile()` (desktop profile menu, beside the theme and Odjava). Its shape is the Odjava `Button variant="sidebar"` with an icon. Behaviour by kind:
  - `prompt`: pressing it calls `prompt()`.
  - `ios`: pressing it toggles an inline `<p>` with the steps, *Dodirni Dijeli, pa Dodaj na početni zaslon.* The row carries `aria-expanded` and `aria-controls`. There is no nested dialog.
  - `installed` / `none`: the row is not rendered.
- **Copy.** Only `hr.json`: `shell.install` *Instaliraj* and `shell.installIosSteps`. Use literal `t()` calls, so the key sweep can read them.

**Ask First:**
- Any automatic prompt, banner or first-visit nudge.

**Never:**
- A modal or banner on first visit.
- Calling `prompt()` without a press.
- Exposing install on the sign-in screens.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chrome/Android, installable | `beforeinstallprompt` was held | *Instaliraj* is shown; a press opens the browser prompt | After `userChoice` (accepted or dismissed), the event is dropped and the row hides until a new event |
| iOS (any browser, iPadOS included) | Not standalone | *Instaliraj* is shown; a press reveals the steps inline | — |
| Installed | `display-mode: standalone` or `navigator.standalone` | The row is not shown | — |
| `appinstalled` fires | Installed from the browser menu while the app is open | The row disappears | — |
| Neither | Firefox desktop, or Chrome before the event | The row is not shown | — |
| First visit | Any | Nothing opens by itself | — |

## Epic AC Deviations

- **"on iOS Safari states the Share → Add to Home Screen steps"** WIDENED to every iOS browser (human decision 2026-10-22, 3a). Since iOS 16.4, Chrome and Firefox on iOS add to the Home Screen too.
- **"When the member opens *Više*"** EXTENDED to the desktop profile menu, which is the desktop *Više* (decision 1a). The phone behaviour is exactly as the AC states.

- **"Given the app is installed / When *Više* opens / Then *Instaliraj* is not shown"** NARROWED to what the platform reports (human decision 2026-10-23, 1a). On iOS, if the app was added to the Home Screen but is then opened in a browser tab, `navigator.standalone` is false and nothing reports the install, so the row still shows. EXPERIENCE.md documents this.
- **Held prompt, everywhere** (human decision 2026-10-23, 2a). `beforeinstallprompt` is `preventDefault`-ed on every page, sign-in included, so Chrome's own mini-infobar never shows. The prompt is offered only from *Instaliraj*. After a dismissal the row hides until the browser offers a new event. This follows "never a modal or nudge on first visit".

</frozen-after-approval>

## Code Map

- `apps/web/src/features/navigation/components/chrome.tsx`:
  - `renderMore()` :785-854 (*Prikaz* section :845-850, `renderSignOut()` :851);
  - `renderProfile()` :687-730 (`#profile-menu` :699-700);
  - `renderSignOut()` :656-672 (the button shape to copy);
  - `renderThemeSegments()` :613-642 (literal `t()` note :603-605).
- `apps/web/src/main.tsx` -- top-level side effects: `onlineManager.setOnline` :38, `appFreshness.start` :42-51. Register before `await restoreForBoot` :63.
- `apps/web/src/lib/offline/freshness.ts:224-293`, `app-freshness.ts` -- the pure-store and page-instance pattern. `lib/pwa/update-decision.ts` (+ test) is the node-test style to follow.
- `apps/web/vite.config.ts:39-73` -- the manifest. No change. The dev server has no worker, so e2e synthesizes the events.
- `lib/i18n/locales/hr.json:1346-1384` -- `shell.*`.
- Registration:
  - `pages/source-guards.fixture.ts:1095` (chrome `expectedButtons` 6 → 7; update the comment at :1083-1094);
  - `pages/key-sources.fixture.ts:1455` (chrome `strings` 18 → +2);
  - `test/resource-hygiene.test.ts` (new keys);
  - `pages/structural-pins-shell.test.ts:268-290` (add `{renderInstall()}` pins for the sheet and the profile).
- e2e: `e2e/tests/layout/phone-navigation.spec.ts:105-141` (the sheet test), `e2e/pages/base.page.ts:91,96` (`moreButton`, `moreSheet`).
- Docs:
  - EXPERIENCE.md :31 (§IA, the Više binding order and the member's sheet) and :195 (PWA);
  - `epics.md:156` UX-DR31 (move *Instaliraj* out of the "Planned" clause) and :179 UX-DR45;
  - DESIGN.md:296 (the Shell row).

## Tasks & Acceptance

**Execution:**
- [x] `lib/pwa/install.ts` (+ `install.test.ts`) -- the pure kind decision and the store. Test every matrix row, iPadOS, `userChoice` dismissed, and `appinstalled`.
- [x] `lib/pwa/page-install.ts` + `main.tsx` + a `useInstall` hook -- the wiring.
- [x] `chrome.tsx` -- `renderInstall()` in the sheet and in the profile menu, with the iOS inline steps.
- [x] `hr.json`, the fixtures and the pins -- registration.
- [x] `e2e/tests/layout/install.spec.ts`, using `page.addInitScript` / `page.evaluate`:
  - a synthetic `beforeinstallprompt`: the row shows in Više and a press calls `prompt`;
  - an iPhone UA: the row shows and reveals the steps;
  - a standalone `matchMedia` override: no row;
  - plain Desktop Chrome with no event: no row;
  - desktop profile menu: the row shows when the prompt is held.
- [x] Docs: EXPERIENCE.md §IA (:31, :195), UX-DR31, UX-DR45, DESIGN.md Shell row.

**Acceptance Criteria:**
- Given an installable browser, when the member opens Više, then *Instaliraj* shows and opens the browser's prompt. Given iOS, it reveals the steps. Given installed, it is absent.
- Given `pnpm test`, `lint` and `typecheck`, and the e2e suites for layout and offline, when they run, then all pass.

### Review Findings

Code review 2026-10-26 (second, independent pass). The human took the recommended options: D1 narrowed, D2 deferred, every patch applied.

- [x] [Review][Decision] iOS in-app browsers get steps they cannot follow — RESOLVED as a patch: `isIos` now also needs a real iOS browser in the UA (Safari's `Version/… Safari/`, or `CriOS`/`FxiOS`/`EdgiOS`). Instagram, Facebook, Messenger and the Google app get no row. SFSafariViewController reads as Safari and cannot be told apart.
- [x] [Review][Defer] The iOS step copy is not checked against the Croatian iOS UI [apps/web/src/lib/i18n/locales/hr.json:1352] — deferred: check *Dijeli* / *Podijeli* and *Dodaj na početni zaslon* by hand on a device set to Croatian.
- [x] [Review][Patch] The `{renderMore()}` pin was deleted, not kept beside the new pins [apps/web/src/pages/structural-pins-shell.test.ts:283]
- [x] [Review][Patch] `(display-mode: fullscreen)` was read as installed and kept for good, so F11 or a fullscreen video hid *Instaliraj* until a reload. The display mode is now read fresh; only `appinstalled` is sticky. [apps/web/src/lib/pwa/install.ts]
- [x] [Review][Patch] The two-minute `userChoice` timer was never cleared. The bound now takes an `AbortSignal` and is cancelled once the choice settles. [apps/web/src/lib/pwa/install.ts]
- [x] [Review][Patch] The bound raced only `userChoice`. It now covers `prompt()` too. [apps/web/src/lib/pwa/install.ts]
- [x] [Review][Patch] No test saw the row `aria-disabled` while its prompt shows. Added an e2e case with an unanswered `userChoice`. [e2e/tests/layout/install.spec.ts]
- [x] [Review][Patch] No test covered the other installed display modes or the `addListener` fallback. The page sources moved to `lib/pwa/install-sources.ts` (they read the page lazily), and `install-sources.test.ts` executes them. [apps/web/src/lib/pwa/install-sources.ts]
- [x] [Review][Patch] No test checked that the iOS steps close with the profile menu. The iPad e2e case now closes and reopens the menu. [e2e/tests/layout/install.spec.ts]
- [x] [Review][Patch] Nothing pinned *Instaliraj* right before Odjava. Both places are now pinned. [apps/web/src/pages/structural-pins-shell.test.ts]
- [x] [Review][Patch] The "never throws from start" test did not cover a throwing `onAppInstalled`. It does now, and the test caught a real leak: `onBeforeInstallPrompt`'s unsubscribe was lost when `onAppInstalled` threw in the same `push`. Each source is now pushed on its own. [apps/web/src/lib/pwa/install.ts]

## Spec Change Log

- 2026-10-23, review loop 1 (frozen additions approved by the human, 1a and 2a): two Epic AC Deviations lines record the iOS-in-browser-tab limit and the app-wide held prompt. KEEP all implemented code. The review patches follow.
- 2026-10-23, review loop 1 patches: the store bounds a `userChoice` that never settles (two minutes), lets a new event replace the held one and free the row, keeps `installed` across a stop and a start, drops the held event on stop, holds only an event with a callable `prompt` and a thenable `userChoice`, counts `fullscreen`, `minimal-ui` and `window-controls-overlay` as installed, falls back to `addListener` on an old `MediaQueryList`, and never throws from `start`. The chrome keeps the iOS steps open per place and closes them with their place or a kind change, makes the row `aria-disabled` while its prompt shows, moves focus to Odjava when the focused row goes, and draws the steps in the measured `sidebar-foreground` at 70%. The row takes its place (`renderInstall(PLACE.sheet)` / `renderInstall(PLACE.sidebar)`), so each place has its own steps id. The e2e suite adds an early event, `appinstalled` on Chromium, `navigator.standalone`, iPadOS and the collapsed-rail wrap.

- 2026-10-26, code review 2 (human decision: D1 narrowed, D2 deferred): the `ios` kind now needs a real iOS browser, so an app's in-app browser gets no row (this narrows decision 3a, which is unchanged in the frozen text). The display mode is read fresh, so only `appinstalled` is sticky. The choice bound covers `prompt()` and is cancelled when the choice settles. Each source's unsubscribe is pushed on its own. The page sources moved to `lib/pwa/install-sources.ts` and read the page lazily. New tests: in-app browsers, a tab leaving fullscreen, the bound cancelled, a `prompt()` that never settles, a throwing `onAppInstalled`, the page sources, `aria-disabled` while prompting (e2e), the profile menu closing the steps (e2e), and an in-app browser (e2e). The `{renderMore()}` pin is back, and *Instaliraj* is pinned right before Odjava. EXPERIENCE.md and UX-DR45 are updated.

## Verification

**Commands:**
- `pnpm --filter @shift/web build && pnpm test && pnpm lint && pnpm typecheck` -- expected: green.
- `pnpm test:e2e e2e/tests/layout e2e/tests/offline` -- expected: green.

**Manual checks:**
- `vite preview` in Chrome: after the install criteria are met, *Instaliraj* in the profile menu opens the native prompt. After installing, it is gone.

## Suggested Review Order

**Install state**

- Entry point: the kind decision. Installed beats a held prompt, which beats iOS.
  [`install.ts:52`](../../apps/web/src/lib/pwa/install.ts#L52)

- The store: holds a valid event, bounds `userChoice`, survives hot reload, and never throws at boot.
  [`install.ts:129`](../../apps/web/src/lib/pwa/install.ts#L129)

- iOS detection, including iPadOS.
  [`install.ts:47`](../../apps/web/src/lib/pwa/install.ts#L47)

- The page sources: every display mode that counts as installed, and the `addListener` fallback.
  [`page-install.ts:36`](../../apps/web/src/lib/pwa/page-install.ts#L36)

- Started before the first `await`, so an early event is held.
  [`main.tsx:58`](../../apps/web/src/main.tsx#L58)

**The row**

- *Instaliraj* in the sheet and the profile menu: the prompt opens only on a press, the iOS steps are inline, and focus moves to Odjava when the row goes.
  [`chrome.tsx:731`](../../apps/web/src/features/navigation/components/chrome.tsx#L731)

**Tests**

- Node tests for every matrix row, plus the timeout, replacement, hot reload, bad events and throwing sources.
  [`install.test.ts:1`](../../apps/web/src/lib/pwa/install.test.ts#L1)

- e2e: an early event, the prompt, iPhone and iPadOS, standalone and `navigator.standalone`, `appinstalled`, the profile menu, signed out.
  [`install.spec.ts:1`](../../e2e/tests/layout/install.spec.ts#L1)
