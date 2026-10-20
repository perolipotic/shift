# Epic 8 Context: The app installs, and the schedule reads without a connection

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Members use Shift on phones, often where there is little or no signal, for example on a truck. This epic makes the existing static SPA an installable PWA on Android and iOS. A surface the member has already read opens offline and shows its last snapshot, labelled with the time that snapshot is from. Nothing pretends to save while offline, and signing out leaves no organization data on the device. Every surface already works online, so the epic adds installability and offline reads only. Story 8.1 has shipped: the app installs as **Shift**, and the service worker and the update notice are in place. The remaining stories build offline reads, offline write refusal, sign-out clearing and the install entry on top of it. Epic 10's Web Push later builds on the same service worker.

## Stories

- Story 8.1: The app is installable (done)
- Story 8.2: Surfaces read offline
- Story 8.3: Offline writes are refused, and signing out clears the device
- Story 8.4: Install from Više

## Requirements & Constraints

- **Install.** The app installs from Chrome on Android and Safari on iOS as **Shift**, the name the human chose on 2026-10-19. It opens without browser chrome (`standalone`) and starts at `/`. The manifest is one static file with the product icon and theme colours for both themes. It carries no organization's name or logo, and a per-organization manifest is deferred.
- **Updates.** A new version is announced and applied only when the member acts. Nothing ever reloads by itself.
- **Offline read.** A surface read online renders its **whole** last snapshot offline, from the persisted query cache in IndexedDB, under `Bez veze · stanje od {datum} {vrijeme}` in the organization's timezone.
- **Never mixed.** A cached figure is never shown beside a fresh one. Online, a persisted snapshot is never shown in place of a fresh read. When the connection returns, the surface refetches, the as-of note disappears, and the whole surface renders from the fresh snapshot.
- **Prefetch.** Opening Danas online prefetches the member's current and next month, so that Danas and Kalendar read offline.
- **Offline writes.** While offline, every write control states that it needs a connection. Nothing is queued, nothing is optimistic, and coming back online changes no record by itself.
- **Sign-out.** Sign-out removes every persisted snapshot from the device. A second account on the same device sees none of the first account's data.
- **Quality bars.** A cached snapshot is never shown without its as-of time, never beside a fresh one, and never survives sign-out. Figures stay consistent across surfaces. The app stays responsive web with no native app.
- **Docs in the same change.** Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes, in the same change.

## Technical Decisions

- **Static SPA, client-side PWA only.** There is no SSR and no application server. The PWA is a manifest plus a `generateSW` service worker built by `vite-plugin-pwa` 2.0.0, with `workbox-window` 7.4.1, in `apps/web` only. The worker precaches the app shell. It never caches organization data, and it has no runtime caching of Supabase or any other cross-origin request. Offline data therefore comes from the persisted query cache, not from the worker.
- **Worker activation.** A new worker activates only when the member taps *Osvježi*, or once every tab is closed.
- **One snapshot per surface.** Each surface derives every figure from one shared query key per fact, read through the detail view's own query options, so that every surface showing a fact shares one cache entry. Story 8.2 adds an offline clause to AD-13: a surface may render its persisted snapshot only while offline, whole, and labelled with its as-of time. The spine's capability map still marks this as pending 8.2.
- **Surface loaders and writes.** A surface's loader lives in `features/<module>/services/snapshot.ts`. Writes are direct PostgREST calls. After a write lands, it invalidates its surface key and every dependent key. There are no optimistic updates for hours, leave balance or conflict state.
- **User-facing text** lives only in `i18n`. That includes the as-of note, the offline refusal and the install copy.

## UX & Interaction Patterns

- **`Notice` is the single primitive** for refusals and confirmations: `role="alert"` shows a warning icon and `role="status"` shows a check.
- **Update notice (shipped in 8.1).** It is the one app-level `Notice`: `role="status"`, *Dostupna je nova verzija.*, with an *Osvježi* button. It sits above the outlet on every route, sign-in included. If the member ignores it, nothing changes.
- **Offline notice (8.2).** A `Notice` above the surface reads, for example, `Bez veze · stanje od 10.10.2026 14:32`. Story 8.2 records the offline state in EXPERIENCE.md §State Patterns and UX-DR45.
- **Write controls offline (8.3).** Each write control gives a stated reason that it needs a connection.
- **Install entry (8.4).** *Instaliraj* in the member's *Više* sheet uses the browser's install prompt where one exists. On iOS Safari, it states the steps Share → Add to Home Screen. It is never a modal on first visit, and it is hidden once the app is installed. Story 8.4 rewrites the "planned" note in UX-DR31 and updates EXPERIENCE.md §IA.

## Cross-Story Dependencies

- 8.2 and 8.4 depend on 8.1, which is done. 8.3 depends on 8.2, and 8.2 applies the AD-13 offline amendment.
- Sign-out (Epic 1's auth flow) gains the step that clears the device. Every existing write control from Epics 1 to 7 must honour the offline refusal.
- Epic 10's Web Push (10.4) depends on 8.1's service worker. On iOS, push works only for an installed PWA on 16.4 or later.
