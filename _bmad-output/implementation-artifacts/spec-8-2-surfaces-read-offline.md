---
title: '8.2 Surfaces read offline'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_commit: '5a4af437151d3071b84b01a221b966c4186e181d'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-1-the-app-is-installable.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The query cache lives only in memory, and every surface treats a paused (offline) read as unavailable, even when an answer is cached. A member on a truck with no signal sees nothing, even though they read their schedule an hour ago.

**Approach:** Persist the allowlisted TanStack Query entries to IndexedDB. The persisted entry is tied to the signed-in user and is valid for 30 days. A shared freshness rule decides each surface's state from all of its reads together:
- online, every read must come from this session's network, otherwise the surface shows loading;
- offline, the whole cached snapshot renders under one note, *Bez veze · stanje od {datum} {vrijeme}*.

In this story the rule is applied to **Danas** (both roles) and **Kalendar**, plus the chrome reads they need. The other surfaces follow in 8.2b.

## Boundaries & Constraints

**Always:**
- **Never mixed.** A surface reads all of its queries as one snapshot.
  - **Online:** `freshAfter` is set at app start and moved forward on every offline→online transition. If any read's `dataUpdatedAt` is older than `freshAfter`, the surface draws no fresh figure:
    - After **app start** (restored cache): it shows loading (skeleton) and never the restored data.
    - After a **reconnect**: if every read has data, it keeps rendering the whole cached snapshot under the as-of note until every read is newer than the reconnect, then switches to the fresh render all at once. If any read lacks data, it shows loading. An open day dialog therefore survives a brief signal loss (human decision 2026-10-20, option d).
  - **Offline:** if every read has data, the surface renders all of them. The as-of time is the **oldest** `dataUpdatedAt` among them. If any read lacks data, the surface shows the existing unavailable state.
- **As-of note.** A new `Notice` variant: `role="status"` with a WifiOff icon. It sits under the `PageHeader` and is formatted with `formatDate`/`formatTime` in the organization's zone. The text is `offline.asOf`, *Bez veze · stanje od {date} {time}* (ICU placeholders).
- **Persistence.** Use `@tanstack/react-query-persist-client` 5.102.8, `@tanstack/query-async-storage-persister` 5.102.8 and `idb-keyval` 6.3.0, pinned exactly. `maxAge` is 30 days. Each persisted key root gets a long `gcTime` through `setQueryDefaults`, at `min(maxAge, 2^31−1 ms)` (about 24.8 days, because `setTimeout` overflows beyond that). The client sets no default. The blob and each entry live at most 30 days. Only **successful** queries whose key root is on an explicit allowlist are dehydrated:
  - calendar;
  - my/organization leave records;
  - my/organization conflict resolutions;
  - members list;
  - organization;
  - member role;
  - member name;
  - session subject.

  Erasure-check sub-keys and the logo are never persisted.
- **Owner-scoped.** The persisted blob carries the auth user id. `main.tsx` restores it before the first render, and only when the local Supabase session's user id matches. Any mismatch, a missing session or an expired blob deletes it.
- **Removal.** Every path that calls `queryClient.clear()` or `resetQueries()` on a session change also deletes the persisted blob: `resetOnSessionChange`, Odjava in chrome and `use-set-password`.
- **Skew.** Offline, a snapshot skew (`snapshotSkewOf`) shows the unavailable state, never an endless skeleton.
- **Offline with an expired token** (human decision 2026-10-20, a). Offline, with an access token older than about an hour, `getSession` returns `null` after a retryable refresh failure, but Supabase keeps the session in storage. The app must not read this as signed out:
  - when `onlineManager` is offline and the session is unresolved because of a retryable or network error, the user id comes from Supabase's stored session;
  - with that user, `_app`'s guard admits Danas and Kalendar, and the snapshot restores for that user;
  - on reconnect the normal refresh decides: a real sign-out removes the blob, as usual;
  - the blob is removed only for a CONFIRMED sign-out or a different user, never for "session unresolved".
- **Starting offline.** TanStack v5's `onlineManager` assumes it is online until an `offline` event arrives. Before the first render, `main.tsx` seeds it from `navigator.onLine`. Without that, an offline start would fetch, fail and show unavailable.
- The storage is injected behind a get/set/del interface so node tests run without IndexedDB (AD-15).

**Ask First:**
- Any change to Supabase session handling or the auth refresh flow.
- A `react-query` version bump.

**Never:**
- Offline write refusal (8.3), the install entry (8.4), or Sati/Za odluku/Godišnji/Ljudi/member page/Organizacija/settings surfaces (8.2b, `deferred-work.md`).
- Service-worker runtime caching of Supabase. AD-14 stays.
- `PersistQueryClientProvider`, an optimistic update, or a queued write.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Online, fresh | All reads fetched this session | The surface renders and shows no note | — |
| Online, restored | App started online with a restored cache | Skeleton until every read is refetched. The restored data is never drawn. | If a refetch fails, the existing unavailable state shows |
| Offline, whole | Paused, and every read has data | The whole surface renders, with the note's time = oldest `dataUpdatedAt` | — |
| Offline, partial | Paused, and some read has no data | The existing unavailable state with retry. No note. | — |
| Reconnect | offline→online, every read has data | The cached snapshot and its note stay, with no skeleton, until every read is newer than the reconnect. Then the note disappears and the whole surface renders fresh. An open day dialog stays open. | A refetch that fails shows the existing unavailable state |
| Other user | The blob's owner ≠ the session's user, or there is no session | The blob is deleted and nothing is restored | — |
| Offline, expired token | Offline start, access token expired, refresh fails retryably | The stored session's user is used: Danas and Kalendar render from the snapshot with the note, and there is no redirect to sign-in | On reconnect, a refresh that fails non-retryably signs out and removes the blob |
| Expired | Blob older than 30 days | Deleted, and nothing is restored | — |
| Offline skew | Leave or resolution rows name ids missing from the calendar | Unavailable, never a stuck skeleton | — |

## Epic AC Deviations

- **"Given a surface was read online / When it opens offline / Then it renders its last snapshot whole…"** NARROWED to Danas (member and admin) and Kalendar. The remaining surfaces are DEFERRED to 8.2b (`deferred-work.md`, human decision 2026-10-19 (1b)), because about 16 state modules each carry the old rule.
- **"their current and next month are prefetched so Danas and Kalendar read offline"** REINTERPRETED. The calendar snapshot is one unwindowed entry (`CALENDAR_KEY = ['calendar']`) that covers every month. Danas already reads every key that Kalendar reads for the same role. Persisting those keys is the prefetch, and a test pins that, for each role, Kalendar's keys are a subset of Danas's.
- **The chrome is not under the freshness rule.** The organization name, the member's name and the role are DEFERRED to 8.2b (`deferred-work.md`). After an online reload they show restored values for a moment, until their refetch lands. These are names, not figures.
- Out of 8.3's scope, removing the persisted blob on sign-out is pulled forward (decision 2a). Without it, 8.2 alone would break Q24.

</frozen-after-approval>

## Code Map

- `apps/web/src/lib/query-client.ts:26` -- the bare `new QueryClient()`. Persisted roots get their long `gcTime` via `setQueryDefaults` (see Spec Change Log); the "no client defaults" comment stays true.
- `apps/web/src/main.tsx:42` -- `await bootLocalization`, then render. Insert the gated restore and subscribe here.
- `apps/web/src/lib/supabase/session-cache.ts:150-205` -- `resetOnSessionChange`. Its `INITIAL_SESSION` comment ("cache is new with the page") no longer holds and must be rewritten. Delete the blob on the user→null and user→other branches.
- `features/navigation/components/chrome.tsx:376-411`, `features/auth/hooks/use-set-password.ts:178-187` -- the in-tab `queryClient.clear()` sign-out paths.
- `features/calendar/services/snapshot.ts:1012-1020` -- `calendarSurfaceStateOf`, which reads "OFFLINE IS UNAVAILABLE" and has to change. `snapshot.test.ts:1073-1093` pins the old rule and has to be rewritten. `CALENDAR_KEY` is at :110.
- `features/today/services/today.ts:68,191` -- `FETCH_PAUSED` and `rowsFailed` (Danas member). `features/today/hooks/use-today.ts:64`, `use-admin-today.ts:67` -- the keys each role reads.
- `features/calendar/hooks/use-calendar-screen.ts:111-140` -- Kalendar's keys by role.
- `features/calendar/services/snapshot-skew.ts`, `hooks/use-snapshot-skew-refresh.ts` -- skew detection, and the invalidation that pauses offline.
- Key constants: `leave-list.ts:267,354` (my/organization records), `conflicts/services/resolutions.ts:37,40`, `members/list.ts:74`, `members/write.ts:1340`, `organization/services/snapshot.ts:64`, `navigation/services/role.ts:61`, `navigation/services/profile.ts:18`; `conflicts/hooks/use-erasure-reads.ts:66` (exclude it).
- `lib/i18n/format.ts:365,372` -- `formatDate`/`formatTime(instant, timeZone)`. The zone comes from the calendar snapshot's `timeZone`.
- `components/ui/notice.tsx` -- the `role` → icon map. Add the offline variant here.
- `pages/danas.tsx:110-139`, `pages/kalendar.tsx:126-179` -- the `PageHeader` and refusal blocks, which is where the note goes.
- `features/organization/services/snapshot.test.ts:1315-1373` -- the client-wiring regexes. They must keep passing, because there is no provider swap.
- Registration (as in 8.1 / c9ed091): `pages/source-guards.fixture.ts`, `pages/key-sources.fixture.ts`, `pages/screens-sweep.test.ts` counts, `test/resource-hygiene.test.ts`, `lib/i18n/locales/hr.json`.
- e2e: `e2e/pages/today.page.ts`. `e2e/tests/calendar/calendar.spec.ts:1779` already uses `context().setOffline`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/package.json` -- add the three exact dependencies. No `allowBuilds` change.
- [x] `apps/web/src/lib/offline/freshness.ts` (+ `.test.ts`) -- `freshAfter` tracking over `onlineManager`, and a pure `snapshotFreshnessOf(reads, freshAfter, online, reconnected = false)` returning `fresh | loading | offline{asOf} | unavailable` (`offline{asOf}` also after a reconnect with every read cached, rule (d)); the clock records whether `freshAfter` is a reconnect's. Unit-test every matrix row.
- [x] `apps/web/src/lib/offline/persistence.ts` (+ `.test.ts`) -- the allowlist, the owner-tagged persister over injected storage, `restoreForSession(userId)` and `forgetDeviceSnapshot()`. Test the owner match and mismatch, expiry, the allowlist (erasure sub-key and failed query excluded) and forget.
- [x] `lib/query-client.ts`, `main.tsx`, `session-cache.ts` (+ test), `chrome.tsx`, `use-set-password.ts` -- wiring, restore gating and removal.
- [x] `features/calendar/services/snapshot.ts`, `features/today/services/today.ts` (+ admin today), Kalendar and Danas hooks -- route surface state through `snapshotFreshnessOf`, expose `asOf`, and handle the offline skew. Rewrite the pinned tests and add the Kalendar ⊆ Danas key test per role.
- [x] `components/ui/notice.tsx`, `components/offline-note.tsx`, `pages/danas.tsx`, `pages/kalendar.tsx`, `hr.json`, and the registration fixtures -- the note.
- [x] `e2e/tests/offline/offline-read.spec.ts` -- online Danas → `setOffline(true)` → client-side navigation to Kalendar shows the note and the grid. `setOffline(false)` removes the note.
- [x] Docs:
  - spine AD-13: add an `Amended 2026-10-19 (story 8.2)` offline clause, and update the CAP-18 row (:353);
  - `EXPERIENCE.md` §State Patterns: add an "Offline." bullet, and clarify §Responsive :194 (IndexedDB, not the worker);
  - `DESIGN.md:257`: the offline Notice variant;
  - `epics.md:179` UX-DR45: the date example becomes `10.10.2026 14:32` (decision 5a).

**Acceptance Criteria:**
- Given a member read Danas online, when the network drops and they open Kalendar, then the month renders with *Bez veze · stanje od …* and no unavailable message.
- Given the app reloads online with a persisted cache, when Danas mounts, then no restored figure is drawn before the refetch lands.
- Given user A's blob on the device, when user B signs in, then nothing of A's is restored, and the blob is gone.
- Given `pnpm test`, `lint`, `typecheck`, `test:e2e`, when run, then all pass.

## Spec Change Log

- 2026-10-20, human renegotiation (not a review loopback). Finding: the reconnect skeleton emptied Kalendar's snapshot, so `useDayDetail` closed an open day dialog and lost the admin's input (`e2e/tests/calendar/calendar.spec.ts:1764`, `:2050`). Amended: the frozen Online rule and the Reconnect matrix row. After a reconnect the labelled cached snapshot stays until every read is fresh, and only the app-start restore shows a skeleton. Avoids: a brief signal loss closing dialogs. KEEP: persistence, owner scoping, the gcTime clamp, the surface-keys tests and the wiring that are already implemented.

- 2026-10-20, review loop 1 (intent_gap, resolved by the human, option a). Finding: an offline start with an expired access token made `getSession` return null, so `main.tsx` deleted the blob and `_app` redirected to sign-in, which broke the story's core case (auth-js 2.113.0 `__loadSession`). Amended (frozen, with human approval): the new Always rule "Offline with an expired token" and the matrix row "Offline, expired token". Avoids: offline reads that only work for about an hour after the last token. KEEP: all existing code (persistence, freshness with the reconnect rule (d), surface keys, the gcTime clamp, the docs). Only the session-resolution and guard path changes, plus the review patches.

- 2026-10-20, review round 2 (patches only, no intent change).
  - `gcTime` as implemented: set per persisted root with `setQueryDefaults`, at `min(maxAge, 2^31−1 ms)` (about 24.8 days), because `setTimeout` overflows past 2^31−1 ms and then fires at once, which collected every restored entry. Other queries keep TanStack's default.
  - Persistence: saving starts only after the restore's read has settled, even when abandoned past the budget; a late read is still checked for owner and age and removed if foreign or expired, never hydrated; a read that never settles means nothing is saved. Every entry's own `dataUpdatedAt` is held to `maxAge` (never dehydrated past it, dropped on restore); a future time stamp counts as expired; a failure after `hydrate` removes the persisted-root queries before the blob; a pending throttled save is written on `pagehide` and on `visibilitychange` → hidden; `forget()`'s time-out has its own code.
  - Boot: only a confirmed signed-out answer deletes the blob; an unresolved session read (a time-out, or a retryable error online) neither restores nor deletes, and the pre-render session read has a short budget (`BOOT_SESSION_BUDGET_MS`).
  - Session rule: a late stored-user answer of nobody or another user over a restored copy marks the session ended, clears and re-guards; a first event naming another user than the one restored for also re-guards.
  - `_app` normalises a trailing slash before checking the offline-readable paths; `freshnessTracker.start` is idempotent and `main.tsx` keeps its stop; *Danas* resets the admin body's unavailable flag when the body unmounts.
  - Tests: `/`'s guard with and without `sessionForReads`; an admin variant of the offline e2e test; the e2e as-of note helper moved to `e2e/utils/offline.ts`.

- 2026-10-20, frozen wording aligned with the code (human approval): gcTime per persisted root with the clamp, the chrome deviation listed, ICU placeholders.

## Design Notes

Why `freshAfter` rather than a "restored" flag: it covers both the restored cache and the in-session data that went stale while offline, with one comparison. The session-cached stale-while-revalidate behaviour between online navigations is unchanged.

```ts
// snapshotFreshnessOf(reads, freshAfter, online, reconnected = false)
whole  = reads.length > 0 && reads.every(r => r.data !== undefined)
failed = r => r.isError && r.fetchStatus !== 'fetching'
!online && whole && !reads.some(failed)                  → offline{ asOf: min(dataUpdatedAt) }
!online                                                  → unavailable
online  && reads.some(failed)                            → unavailable
online  && reads.some(r => r.dataUpdatedAt < freshAfter) → reconnected && whole ? offline{ asOf } : loading
online                                                   → fresh
```

`snapshotAnswerOf(answer, freshness, clock)` then shows each read to the existing derivations: settled under `offline`, failed with no data when offline otherwise, pending with no data when online and older than `freshAfter`, and raw otherwise.

## Verification

**Commands:**
- `pnpm test && pnpm lint && pnpm typecheck` -- expected: green.
- `pnpm test:e2e e2e/tests/offline` -- expected: green.

**Manual checks:**
- `vite preview`: read Danas, go offline in DevTools, reload, and check that Danas and Kalendar render with the note. Sign out, then check that IndexedDB holds no Shift entry.

## Suggested Review Order

**One freshness rule per surface**

- Entry point: a pure decision over all of a surface's reads (fresh, skeleton, labelled cache, unavailable).
  [`freshness.ts:86`](../../apps/web/src/lib/offline/freshness.ts#L86)

- How each read is shown to the existing derivations, so the old state modules stay untouched.
  [`freshness.ts:135`](../../apps/web/src/lib/offline/freshness.ts#L135)

- `freshAfter` moves on reconnect, and knows start from reconnect (decision d).
  [`freshness.ts:191`](../../apps/web/src/lib/offline/freshness.ts#L191)

- The hook: decides from its own observers, plus cache state for keys other hooks observe.
  [`use-snapshot-freshness.ts:70`](../../apps/web/src/lib/offline/use-snapshot-freshness.ts#L70)

- Kalendar's keys ⊆ Danas's keys per role, all of them persisted: the "prefetch".
  [`surface-keys.ts:1`](../../apps/web/src/features/calendar/services/surface-keys.ts#L1)

**The copy on the device**

- Owner-tagged persister: allowlist, per-entry 30 days, budgeted restore, save gated on a settled restore.
  [`persistence.ts:222`](../../apps/web/src/lib/offline/persistence.ts#L222)

- Boot: seed online state, then restore only for a known session and delete only on a confirmed none.
  [`main.tsx:38`](../../apps/web/src/main.tsx#L38)

- Offline with an expired token, the stored session's user reads (decision a).
  [`offline-session.ts:110`](../../apps/web/src/lib/supabase/offline-session.ts#L110)

- The session rule reconciles the restored copy, forgets it on sign-out or another user, and re-guards.
  [`session-cache.ts:188`](../../apps/web/src/lib/supabase/session-cache.ts#L188)

- Only Danas, Kalendar and `/` admit the offline session-for-reading.
  [`_app.tsx:115`](../../apps/web/src/pages/_app.tsx#L115)

**The note on screen**

- The offline Notice variant (status, WifiOff).
  [`notice.tsx:33`](../../apps/web/src/components/ui/notice.tsx#L33)

- The note is hidden while the admin body shows its alert.
  [`danas.tsx:50`](../../apps/web/src/pages/danas.tsx#L50)

**Docs**

- AD-13's offline clause, with decisions d and a.
  [`ARCHITECTURE-SPINE.md:138`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L138)

- The member-facing state pattern.
  [`EXPERIENCE.md:130`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L130)

**Tests**

- Every matrix row, as pure unit tests.
  [`freshness.test.ts:1`](../../apps/web/src/lib/offline/freshness.test.ts#L1)

- Owner, expiry, allowlist, slow and hung storage, flush on hide.
  [`persistence.test.ts:1`](../../apps/web/src/lib/offline/persistence.test.ts#L1)

- Member and admin: offline mid-session → Kalendar with the note → reconnect.
  [`offline-read.spec.ts:1`](../../e2e/tests/offline/offline-read.spec.ts#L1)
