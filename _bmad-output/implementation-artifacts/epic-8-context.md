# Epic 8 Context: The app installs, and the schedule reads without a connection

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Members use Shift on phones, often with little or no signal, for example on a truck. This epic makes the static SPA an installable PWA on Android and iOS. A surface the member has already read opens offline and shows its whole last snapshot, labelled with the time that snapshot is from. Nothing pretends to save offline, and signing out leaves no organization data on the device. Every surface already works online, so the epic adds only installability and offline reads. **Shipped:** 8.1 (install, app-shell worker, update notice), 8.2 (*Danas* and *Kalendar* offline, the device snapshot, the freshness rule, the offline session), 8.2b (*Sati*, *Godišnji*, *Ljudi*, `/smjene/$id`, the offline role guard, the chrome), 8.2c (*Raspored*, the resolution page, the member page) and 8.2d (the settings surfaces, with no read retry offline; every surface now reads offline). **Remaining:** 8.2e, by a human decision of 2026-10-21, drops the read-retry button from every other surface's offline unavailable state. After it come 8.3 (offline write refusal and sign-out clearing) and 8.4 (install entry). Epic 10's Web Push later builds on the same service worker.

## Stories

- Story 8.1: The app is installable (done)
- Story 8.2: Surfaces read offline: *Danas* and *Kalendar* (done)
- Story 8.2b: Member surfaces read offline (done)
- Story 8.2c: Admin work surfaces read offline (done)
- Story 8.2d: Settings surfaces read offline (done)
- Story 8.2e: No read-retry button offline
- Story 8.3: Offline writes are refused, and signing out clears the device
- Story 8.4: Install from Više

## Requirements & Constraints

- **Offline read.** A surface read online renders its whole last snapshot offline, under `Bez veze · stanje od {datum} {vrijeme}`. The time shown is that of the surface's **oldest** read, in the organization's timezone.
- **Never mixed.** A cached figure is never shown beside a fresh one or beside a missing one. If any of the surface's reads was never cached, the surface shows its unavailable state offline, with no note.
- **No retry offline (8.2e).** Offline, no surface's unavailable state offers the `Pokušaj ponovno` read-retry button (human decision 2026-10-21). The message text stays as it is. Online, a failed read keeps its retry.
- **Online freshness.** After an app start, which includes a restored cache, the surface shows its skeleton until every read is refetched. After a reconnect, it keeps the cached snapshot and its note, so an open dialog stays open. Once every read is fresh, it switches to the fresh render at once. If any read has no data at that point, it shows the skeleton.
- **Shipped admin work surfaces (8.2c).** *Raspored* reads offline; *Riješeni* adds the acting admins' names, so a *Riješeni* never opened online is unavailable offline. The resolution page reads its five reads as one snapshot. The member page `/ljudi/$id` decides its member edit and leave card over one key set, the union of their reads, so it is drawn whole under one note or is unavailable whole.
- **Shipped settings surfaces (8.2d).** *Organizacija* (the row and its hour bands as one snapshot; a resolved refusal is its own message, with no note), *Satni pojasi* (+`$id`), *Postavke rotacije* (the shift types and the builder as one snapshot under one note; `tipovi-smjena/$id`) and *Ljudi/smjene* (+`$id`) read offline. `hourBands`, `shiftTypes` and `rotation` are persisted. A surface that needs the organization only for its zone decides it from the cache, with no second `useQuery`. The builder never builds a save from its cached snapshot. Offline, these surfaces offer no read retry.
- **Prefetch.** Opening Danas online prefetches the member's current and next month, so that Danas and Kalendar read offline.
- **Offline writes (8.3).** While offline, every write control states that it needs a connection. Nothing is queued, nothing is optimistic, and reconnecting changes no record by itself. Until 8.3, an offline save fails through the existing write error. Most of these write forms are on the 8.2c and 8.2d surfaces.
- **Sign-out.** Every sign-out path removes the device copy. A second account on the same device sees none of the first account's data.
- **Accepted risks.** Cached organization data, which includes leave records, members, rosters and the rotation (member names and override reasons), stays unencrypted in IndexedDB for up to 30 days on a device that never reopens the app. Offline, a cached role is trusted for up to 30 days. An offline save fails through the existing write error, and 8.3 adds the up-front refusal.
- **Updates.** A new version applies only when the member taps *Osvježi*. Nothing reloads by itself.
- **Quality bars.** A cached snapshot is never shown without its as-of time, never beside a fresh one, and never survives sign-out. Figures stay consistent across surfaces. The app stays responsive web with no native app.
- **Docs in the same change.** Each story updates the DESIGN.md, EXPERIENCE.md, UX-DR and spine lines it changes, in the same change.

## Technical Decisions

- **Static SPA and a client-side PWA only.** The PWA is `vite-plugin-pwa` 2.0.0 with `workbox-window` 7.4.1, in `apps/web` only. The service worker is generated by `generateSW` and precaches the app shell. It has no runtime caching of Supabase or any other cross-origin request. Offline data never comes from the worker.
- **Worker activation.** A new worker activates only when the member taps *Osvježi*, or once every tab is closed.
- **Device snapshot.** Allowlisted query keys are persisted to IndexedDB through `@tanstack/react-query-persist-client` over `idb-keyval`, tagged with the auth user id.
  - *Lifetime:* the stored copy and each entry in it, judged by its own `dataUpdatedAt`, live at most 30 days. In memory, a kept key is collected after about 24.8 days.
  - *Restore:* happens before the first render, and only for the local session's own user.
  - *Keys:* a parameterised key is kept only in the exact shape `[root, non-empty string]` (`team-roster`, `leave-records`). 8.2c added `acting-admin-names`. The erasure guard's fresh reads stay outside every snapshot and are never kept.
  - *Routes:* a `$` segment in the offline-readable routes never matches a static route registered beside it (`/ljudi/novi`, `/ljudi/smjene`).
- **One snapshot per surface.** Each fact is one cache entry, read through its detail view's query options. A surface reads all of its keys as one snapshot under one freshness rule (`lib/offline/freshness.ts`). The rule's `freshAfter` is set at the app's start and moved on every offline-to-online transition. The as-of zone comes from the calendar snapshot, else the organization snapshot, else the organization zone in a surface's own reads. With none of these, the surface is unavailable offline. Moving a surface means replacing its module's `paused → unavailable` rule with this helper. The old `*StateOf` modules keep the paused rule as a safety net for raw reads.
- **Offline session.** A session that is unresolved because its token has expired and cannot be refreshed counts as the stored user for reading. Only a confirmed sign-out, or a different user, deletes the copy.
- **Role guard and chrome.** Offline, the role guard answers from the role cached on the device. With no cached role, it fails closed at once and is never left pending. The chrome's role, name and organization each decide their freshness on their own and carry no as-of note.
- **Writes.** Writes are direct PostgREST calls. When a write lands, it invalidates its surface key and every dependent key. There are no optimistic updates for hours, leave balance or conflict state.
- **User-facing text** lives only in `i18n`.

## UX & Interaction Patterns

- **`Notice` is the single primitive.** `role="alert"` shows a warning icon. `role="status"` shows a check.
- **Update notice.** This is the one app-level `Notice`, above the outlet on every route: *Dostupna je nova verzija.* with an *Osvježi* button.
- **As-of note.** It is the offline variant of `Notice`: `role="status"` with a WifiOff icon in place of the check, under the `PageHeader`.
- **Role-dependent screens offline.** Admin-only screens and *Ljudi* open on the cached role. With no cached role, they redirect to *Danas* at once.
- **Write controls offline (8.3).** Each write control gives a stated reason that it needs a connection.
- **Install entry (8.4).** *Instaliraj* sits in *Više*. It uses the browser's install prompt where one exists. On iOS Safari, it states the steps Share → Add to Home Screen. It is never a modal on first visit, and it is hidden once the app is installed. 8.4 rewrites the "planned" note in UX-DR31 and updates EXPERIENCE.md §IA.

## Cross-Story Dependencies

- 8.2d builds on 8.2–8.2c. 8.2e changes the offline unavailable state of every surface, the 8.2d ones included. 8.3 needs every surface to be offline-aware, because its write refusals sit mostly on the 8.2c and 8.2d surfaces. 8.4 depends only on 8.1.
- The sign-out flow from Epic 1 already clears the device copy, and 8.3 owns the guarantee. Every write control from Epics 1–7 must honour the offline refusal.
- Epic 10's Web Push (10.4) depends on 8.1's service worker. On iOS, push works only for an installed PWA on 16.4 or later.
