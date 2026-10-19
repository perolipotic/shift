---
title: '8.1 The app is installable'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_commit: '6b0ac5ba6195ab6d2af3bd4e5cc88bf690563b02'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Shift is a static SPA with a bare `site.webmanifest` (one SVG icon, no service worker). It cannot be installed properly on Android or iOS, and there is no way to deliver a new version safely.

**Approach:** Add `vite-plugin-pwa` 2.0.0 (with `workbox-window` 7.4.1), pinned exactly. It generates the manifest and a `generateSW` service worker that precaches the app shell. The PNG icons are generated once from `favicon.svg` and committed. Registration runs in `prompt` mode, and an app-level `Notice` with an *Osvježi* button applies a waiting version only when the member taps it.

## Boundaries & Constraints

**Always:**
- The installed name is **"Shift"** (`name` and `short_name`), as the human decided on 2026-10-19. The manifest has no organization name or logo.
- The manifest has `lang: hr`, `start_url: /`, `display: standalone` and icons at 192, 512 and 512 maskable. `theme_color`/`background_color` are `#f8fafc`. Both theme colours stay in the `index.html` `theme-color` meta pair, which is unchanged.
- The `apple-touch-icon` (180 px) is linked from `index.html`.
- Precache: built `js`, `css`, `html`, `woff2`, `svg`, `png` and the manifest. `navigateFallback: '/index.html'`. The service worker has no runtime caching of Supabase or any other cross-origin request.
- No service-worker sourcemap, so `sw.js` and `workbox-*.js` carry no `sourceMappingURL`.
- Exactly one module script stays in `dist/index.html`. Registration is imported from `virtual:pwa-register/react` in app code, never injected.
- All copy is in `hr.json`, through the module-level `t`. New keys are registered in `key-sources.fixture.ts`.

**Ask First:**
- Any new dependency that needs an install script (`pnpm-workspace.yaml` `allowBuilds`).
- Any change to `_headers` or the deploy action.

**Never:**
- Offline snapshots, IndexedDB persistence or the as-of note (8.2). Offline write refusal or clearing on sign-out (8.3). *Instaliraj* in Više or any install prompt (8.4). Push (Epic 10).
- `registerType: 'autoUpdate'`, `skipWaiting` without a tap, or a reload the member did not trigger.
- Enabling the service worker in dev (`devOptions`), since e2e runs on the dev server.
- `@vite-pwa/assets-generator` as a dependency. It is run once through `pnpm dlx`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First visit online | No service worker | It registers silently and precaches the shell. No notice. | Registration failure is logged with `console.warn`. The app works as before. |
| New deploy | A waiting service worker | `Notice role="status"` *Dostupna je nova verzija.* with an *Osvježi* button. The member keeps working. | — |
| Member taps *Osvježi* | Waiting service worker | `updateServiceWorker(true)`: the waiting worker activates and the page reloads once. | — |
| Notice ignored | Waiting service worker | Nothing activates. The new version applies on the next tap or after all tabs close. | — |

</frozen-after-approval>

## Code Map

- `apps/web/vite.config.ts` -- `plugins: [react(), tailwindcss()]`. Add `VitePWA`. Keep `sourcemap: 'hidden'` and the woff2 `assetsInlineLimit`.
- `apps/web/public/site.webmanifest` -- the current hand-written manifest. Replace it with the plugin's output under the same filename (`manifestFilename: 'site.webmanifest'`).
- `apps/web/index.html` -- has the `theme-color` pair and `<link rel="manifest">`. The plugin injects the manifest link, so remove the manual one to avoid a duplicate. Add `apple-touch-icon`.
- `apps/web/src/vite-env.d.ts` -- add `/// <reference types="vite-plugin-pwa/react" />`.
- `apps/web/src/pages/__root.tsx:76-87` -- `AppShell` covers every route, including sign-in. Mount the update notice here and amend its "stays text-free" comment.
- `apps/web/src/components/ui/notice.tsx` -- `Notice` (`<p>`, `role` prop, no action slot). Place the button beside it.
- `apps/web/src/lib/i18n/locales/hr.json`, `apps/web/src/pages/key-sources.fixture.ts` -- copy and key registration (`key-sweep.test.ts`).
- `test/static-hosting.test.ts:32-39,160-165` -- the `PERMITTED_DIST_ENTRIES` allowlist. Widen it with the stated reason (sw, workbox, icons).
- `test/localization-applied.test.ts:716-742` -- the one-module-script guard. It must keep passing.
- `_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md` -- the Stack table (214-232, `| Name | Version |`) and Deferred (353-362). The deferred "Organization-specific PWA manifest" that the epic cites is missing. Binds/Capability map stop at CAP-17.
- `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md` -- §State Patterns (125) and §Responsive & Platform (175). There is no PWA text yet.
- `_bmad-output/planning-artifacts/epics.md:179` -- UX-DR45 (install/offline). Extend it with the update notice.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/package.json` -- add `vite-plugin-pwa` 2.0.0 and `workbox-window` 7.4.1 as exact devDependencies. Check that `pnpm install` needs no new `allowBuilds`.
- [x] `apps/web/public/` -- run `pnpm dlx @vite-pwa/assets-generator@2.0.0 --preset minimal-2023 public/favicon.svg` and commit the PNGs. Delete `site.webmanifest`. Record the command in a vite.config comment.
- [x] `apps/web/vite.config.ts` -- `VitePWA({ registerType: 'prompt', injectRegister: false, manifestFilename: 'site.webmanifest', manifest: {...}, workbox: { globPatterns, navigateFallback, sourcemap: false } })`. Include a why-comment (AD-14, story 8.1).
- [x] `apps/web/index.html` -- add `apple-touch-icon` and drop the manual manifest link. Update the comment.
- [x] `apps/web/src/components/update-notice.tsx` -- `useRegisterSW`. When `needRefresh`, render `Notice` and a `Button`. `onRegisterError` → `console.warn`.
- [x] `apps/web/src/pages/__root.tsx` -- mount `UpdateNotice` above `<Outlet/>` and fix the comment.
- [x] `hr.json` and `key-sources.fixture.ts` -- update-notice keys.
- [x] `test/static-hosting.test.ts` -- widen the allowlist. Add build-gated tests: the manifest's fields, theme colour and icon files exist in dist; `sw.js` precaches `index.html` and has no `sourceMappingURL`; no runtime caching of `supabase`.
- [x] Spine -- add a Stack row `vite-plugin-pwa` 2.0.0 (with `workbox-window` 7.4.1), a Deferred "Organization-specific PWA manifest" entry, and CAP-18 in binds/map → AD-14.
- [x] `EXPERIENCE.md` §Responsive & Platform, `DESIGN.md` Notice line (257), `epics.md` UX-DR45 -- installable PWA, the update notice and its member-triggered reload.

**Acceptance Criteria:**
- Given `pnpm --filter @shift/web build`, when `dist` is inspected, then `site.webmanifest`, `sw.js` and the icon PNGs exist, and the manifest's link in `dist/index.html` is single.
- Given the built app is served (`vite preview`) in Chrome, when DevTools → Application is opened, then the manifest has no errors, it is installable, and the service worker is activated.
- Given an installed build and a second build deployed, when the app reopens online, then the notice appears and nothing reloads until *Osvježi* is tapped.
- Given `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm test:e2e`, when they run, then all pass.

## Epic AC Deviations

- **PARTIAL — "theme colours for both themes".** Epic AC: the manifest carries "theme colours for both light and dark". Spec choice: the manifest carries the light colour (`#f8fafc`) as `theme_color` and `background_color`, because the manifest format has no per-scheme colour; the `index.html` `theme-color` media pair carries both themes for the browser chrome. Consequence: the Android splash screen is light even in dark mode. Why: a platform limitation of the web app manifest, not a choice that a later story can undo inside this format.
- Installed name: "Shift" (human decision, 2026-10-19).

## Verification

**Commands:**
- `pnpm --filter @shift/web build && pnpm test` -- expected: green, including the build-gated static-hosting tests.
- `pnpm lint && pnpm typecheck` -- expected: clean.

**Manual checks:**
- Run `vite preview` and use Chrome DevTools → Application → Manifest/Service Workers to confirm the app is installable and the worker is active. Rebuild and reload to confirm the notice appears and that *Osvježi* reloads.

## Suggested Review Order

**Update only when the member chooses**

- Entry point: prompt-mode registration, the notice and the per-tab reload decision.
  [`update-notice.tsx:43`](../../apps/web/src/components/update-notice.tsx#L43)

- A pure state machine: only the tab whose member tapped reloads. The plugin otherwise reloads every tab.
  [`update-decision.ts:28`](../../apps/web/src/lib/pwa/update-decision.ts#L28)

- A resumed installed app checks for a new worker when it becomes visible again.
  [`update-decision.ts:65`](../../apps/web/src/lib/pwa/update-decision.ts#L65)

- Mounted once in the root shell, so sign-in is covered too.
  [`__root.tsx:83`](../../apps/web/src/pages/__root.tsx#L83)

**Manifest and service worker**

- Plugin config: prompt mode, no injected script, the manifest under the old filename.
  [`vite.config.ts:39`](../../apps/web/vite.config.ts#L39)

- The app shell is precached, navigations fall back to index.html, and nothing is cached at runtime.
  [`vite.config.ts:69`](../../apps/web/vite.config.ts#L69)

- iOS reads no manifest icon, so it gets the apple-touch-icon.
  [`index.html:24`](../../apps/web/index.html#L24)

**Docs in the same change**

- AD-14 names the PWA's client-side pieces.
  [`ARCHITECTURE-SPINE.md:144`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L144)

- Stack row, CAP-18 map and the Deferred organization-specific manifest.
  [`ARCHITECTURE-SPINE.md:233`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L233)

- The platform and update behaviour from the member's side.
  [`EXPERIENCE.md:194`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L194)

- UX-DR45 is extended with the update notice.
  [`epics.md:179`](../planning-artifacts/epics.md#L179)

**Tests and supporting files**

- The build-only PWA suite: manifest, icons, precache, no runtime caching, member-gated skipWaiting.
  [`static-hosting.test.ts:216`](../../test/static-hosting.test.ts#L216)

- The dist allowlist now admits the worker, the workbox runtime and the icons.
  [`static-hosting.test.ts:32`](../../test/static-hosting.test.ts#L32)

- Node tests for the per-tab decision and the resume check.
  [`update-decision.test.ts:1`](../../apps/web/src/lib/pwa/update-decision.test.ts#L1)

- A worker-less stand-in for the virtual module, so route-tree tests resolve.
  [`vitest.config.ts:28`](../../apps/web/vitest.config.ts#L28)

- The notice copy.
  [`hr.json:1385`](../../apps/web/src/lib/i18n/locales/hr.json#L1385)
