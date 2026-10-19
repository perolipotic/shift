# Epic 8 Context: The app installs, and the schedule reads without a connection

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Members use Shift on phones, often where there is little or no signal, for example on a truck. This epic makes the existing static SPA an installable PWA on Android and iOS. A surface the member has already read opens offline and shows its last snapshot, labelled with the time that snapshot is from. Nothing pretends to save while offline, and signing out leaves no organization data on the device. Every surface already works online, so this epic adds installability and offline reads only. The epic was added to v1 on 2026-10-10 as the first of the scope-expansion epics (8 to 14), and Epic 10's Web Push later builds on its service worker.

## Stories

- Story 8.1: The app is installable
- Story 8.2: Surfaces read offline
- Story 8.3: Offline writes are refused, and signing out clears the device
- Story 8.4: Install from Više

## Requirements & Constraints

- **Install.** The app installs from Chrome on Android and Safari on iOS and opens without browser chrome. It has a web app manifest (name, icons, theme colours for both light and dark, start URL) and a service worker that caches the app shell.
- **Installed name.** The human decides the installed name, because "Shift" is only a working title and must not reach the UI unconfirmed. The manifest is not organization-specific in v1: no organization's name or logo is hard-coded into it. A per-organization manifest is deferred.
- **Updates.** A new version is announced in the app and applied on reload, by the member's action. It is never applied silently mid-task.
- **Offline read.** A surface read online renders its **whole** last snapshot offline, with `Bez veze · stanje od {datum} {vrijeme}` in the organization's timezone.
- **Never mixed.** A cached figure is never shown beside a fresh one. A surface is either wholly cached and labelled, or wholly fresh. Online, a cached snapshot is never shown in place of a fresh read. When the connection returns, the surface refetches, the as-of note disappears, and the whole surface renders from the fresh snapshot.
- **Prefetch.** Opening Danas online prefetches the member's current and next month, so that Danas and Kalendar read offline.
- **Offline writes.** Every write is refused while offline, and each write control states that it needs a connection. Nothing is queued for later, nothing is applied optimistically, and coming back online changes no record by itself.
- **Sign-out.** Sign-out removes every persisted snapshot from the device. Afterwards no organization data is readable from device storage, and a second account on the same device sees none of the first account's data.
- **Quality bars.** Responsive web plus installable PWA, no native app. Figures stay consistent across surfaces. A cached snapshot is never shown without its as-of time, never beside a fresh one, and never survives sign-out.
- **Docs in the same change.** Each story updates the DESIGN.md, EXPERIENCE.md and UX-DR lines it changes in the same change.

## Technical Decisions

- **Static SPA, no server runtime.** The frontend is a static SPA build: no SSR and no application server. The PWA adds client-side pieces only, which are a manifest, a service worker and a persisted query cache.
- **PWA plugin.** Story 8.1 adds a PWA plugin to the Vite build. Its version is pinned and verified against the registry when the story starts, and the spine's Stack table records the plugin and its version.
- **Persisted cache.** The TanStack Query cache persists to IndexedDB, and offline reads render from it.
- **One snapshot per surface, with an offline amendment.** Each surface derives every figure from one shared query key per fact, so that two figures on a screen never come from two reads of the same fact. Story 8.2 amends this rule: a surface may render its persisted snapshot only while offline, whole, and labelled with its as-of time; online, a persisted snapshot is never shown. Q19 (consistent figures) still holds, because one snapshot is still one read. Story 8.2 adds this offline clause to AD-13 in the spine. No separate architect pass is needed.
- **Surface loaders.** A surface's loader lives in `features/<module>/services/snapshot.ts`. Writes are direct PostgREST calls that invalidate the keys they affect, with no optimistic updates for hours, leave balance or conflict state.
- **User-facing text** lives only in `i18n`. That includes the as-of note, the offline write refusal and the install copy.

## UX & Interaction Patterns

- **Offline notice.** Offline, a `Notice` sits above the surface and reads, for example, `Bez veze · stanje od 10.10.2026. 14:32`. `Notice` is the single primitive for refusals and confirmations. Story 8.2 adds the offline state to EXPERIENCE.md §State Patterns.
- **Write controls offline.** Each write control states that it needs a connection, as a stated reason rather than a silent disable.
- **Install entry.** *Instaliraj* in the *Više* sheet uses the browser's install prompt where one exists. On iOS Safari, it states the steps Share → Add to Home Screen. Install is never a modal on first visit, and *Instaliraj* is hidden once the app is installed. Story 8.4 updates EXPERIENCE.md §IA and UX-DR31 for this.
- **Update notice.** The app says that a new version is ready, and the member chooses when to reload.

## Cross-Story Dependencies

- 8.2 and 8.4 depend on 8.1. 8.3 depends on 8.2.
- 8.2 applies the AD-13 amendment.
- Epic 10's Web Push needs this epic's service worker. On iOS, push works only for an installed PWA on 16.4 or later.
- Sign-out (Epic 1's auth flow) gains the step that clears the device.
- Every existing write control across Epics 1 to 7 must honour the offline refusal.
