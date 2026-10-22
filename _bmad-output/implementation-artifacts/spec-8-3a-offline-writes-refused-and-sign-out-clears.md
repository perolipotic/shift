---
title: '8.3a Offline writes are refused (work surfaces), and signing out clears the device'
type: 'feature'
created: '2026-10-22'
status: 'done'
baseline_commit: 'eb5e3d199dc9251b39316e0099cd9ea367605489'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-2e-no-read-retry-offline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:**
- Offline, a write control tries to write and fails through a generic write error. On erasure-checked flows it first shows *Ne mogu provjeriti…* with a retry that cannot succeed.
- Offline with an expired token, Odjava fails ("Odjava trenutačno nije moguća") and leaves the device copy behind.
- Nothing proves that sign-out empties the device.

**Approach:**
- Add one write gate (`useWriteGate`, built on `useFreshnessClock().online`) and one note, `OfflineWriteNote`. Offline, each write control on the work surfaces is `aria-disabled` and points at the note. A press does nothing, nothing is queued, and erasure checks never start.
- Odjava falls back to a local sign-out and always clears the device.
- e2e proves that the device is empty after sign-out, and that a second account sees none of the first account's data.

## Boundaries & Constraints

**Always:**
- **The gate.** `lib/offline/use-write-gate.ts` returns `{ online, noteId }`. A pure `writeGateOf(online)` sits beside it for node tests. Offline:
  - each gated control gets `aria-disabled="true"`;
  - the note's id is added to its `aria-describedby`;
  - its `onClick`/`onSubmit` returns early, so it stays focusable and its reason is read (the `erasure-dialog.tsx` convention).
- **The note.** `components/offline-write-note.tsx` is a `Notice role="status" variant="offline"`. It reads `offline.needsConnection`, *Za ovo je potrebna veza.*, and renders once per form, dialog footer or card action row, only while offline. Sign-in uses `offline.signInNeedsConnection`, *Za prijavu je potrebna veza.*
- **Dialogs still open offline** (decision 2026-10-22, 4a). Their save, remove, archive, withdraw and confirm controls are gated. Local controls (pickers, toggles, Odbaci of a draft, theme) are never gated.
- **Erasure-checked flows** are gated before the check, so offline never shows `CHECK_UNAVAILABLE`.
- **Reconnect** submits nothing by itself. The gate simply lifts.
- **Scope of write controls** (8.3a):
  - Kalendar: the roster form and override form submit and remove-confirm, and the erasure dialog save.
  - The Raspored resolution save.
  - The member page: basics, allowance, team, status (with withdraw), password reset, and leave record/amend/remove.
  - The Ljudi add-member submit.
  - Sign-in and the set-password submit.
- **Odjava offline** (decision 2026-10-22, 2a). When `signOut` leaves a session behind because of a retryable/network failure, fall back to `signOut({ scope: 'local' })`. Then forget the device snapshot, clear the cache and navigate to `/prijava` as today. Apply this to both the chrome Odjava and set-password "leave".
- **`shift.lastOrganization`** stays (decision 3a). It holds only the org slug for the sign-in prefill and is not organization data. Document this in EXPERIENCE.md.

**Ask First:**
- Gating any control outside the 8.3a scope list.
- Changing the server-side session or revocation.

**Never:**
- The settings surfaces' writes (Organizacija, Satni pojasi, Postavke rotacije, Ljudi/smjene). That is 8.3b (`deferred-work.md`).
- A queued, deferred or optimistic write (UX-DR29).
- Plain `disabled` for the offline gate. It would drop focus and the reason.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Offline save | A dialog is open offline and Spremi is pressed | Nothing is sent. The note says *Za ovo je potrebna veza.* | — |
| Offline erasure flow | Team or status change, roster or override save | No `CHECK_UNAVAILABLE`, only the note. No request is made | — |
| Go offline mid-form | The form was typed online, then the connection drops | The input is kept, the save is gated and the note appears | — |
| Reconnect | Back online with the dialog still open | The gate lifts. Nothing is sent until the user presses | — |
| Offline sign-in | `/prijava` offline | Submit is gated with *Za prijavu je potrebna veza.* | — |
| Odjava offline, expired token | `signOut` fails retryably | A local sign-out, the device copy is deleted, and the app goes to `/prijava` | — |
| Second account | A signs out, B signs in on the same device | IndexedDB holds no A data, and B sees none of it | — |

## Epic AC Deviations

- **"Given the app is offline / When any write control is shown / Then it states that it needs a connection…"** NARROWED to the work surfaces and auth. The settings surfaces' write controls are DEFERRED to 8.3b (`deferred-work.md`, human decision 2026-10-22, 1a).

</frozen-after-approval>

## Code Map

- `lib/offline/use-snapshot-freshness.ts:65` -- `useFreshnessClock`. `components/offline-note.tsx` and `components/ui/notice.tsx` (variant `offline`) are the model for the new note.
- `features/conflicts/components/erasure-dialog.tsx:169-178` -- the `aria-disabled` + `aria-describedby` + guarded `onClick` convention to copy.
- Kalendar: `features/calendar/components/roster-form.tsx:256,486` and `use-roster-form.ts:437,560`; `override-form.tsx:150,392` and `use-override-form.ts:487,636`; `erasure-dialog.tsx:171`.
- Resolution: `features/conflicts/components/conflict-resolution-body.tsx:233-240` (already `aria-disabled` + `RESOLUTION_SAVE_HINT_ID`).
- Member page:
  - `features/members/components/member-basics-card.tsx:320`, `member-allowance-dialog.tsx:114`;
  - `member-team-card.tsx:181,445,543`, `member-status-card.tsx:129,318,404`, `member-reset-card.tsx:76,147`;
  - `leave/components/member-leave-dialog.tsx:303`, `member-leave-records.tsx:151,273`.
  - Hooks: `use-member-basics`, `-team`, `-status`, `-reset`, `use-member-leave`.
- Ljudi add: `features/members/components/member-add-dialog.tsx:324`.
- Auth: `features/auth/components/sign-in-form.tsx:157`, `set-password-form.tsx:139`. Odjava: `features/navigation/components/chrome.tsx:394-449`, `features/auth/hooks/use-set-password.ts:179-193`, `features/auth/services/sign-out.ts` (`settledFailure`). auth-js 2.113.0 `_signOut` keeps the session on a non-missing session error.
- `features/auth/services/last-organization.ts:27` -- `shift.lastOrganization`.
- Registration:
  - `pages/source-guards.fixture.ts` (a new note entry, as `OFFLINE_NOTE` :588/:701);
  - `pages/key-sources.fixture.ts` (the note and changed `strings` counts);
  - `test/resource-hygiene.test.ts` (new keys);
  - `lib/i18n/locales/hr.json` (`offline.*`).
- e2e: `e2e/utils/offline.ts` (add an IndexedDB read helper), `e2e/tests/offline/`, `e2e/tests/auth/sign-in.spec.ts:271,306`.

## Tasks & Acceptance

**Execution:**
- [x] `lib/offline/use-write-gate.ts` (+ pure test), `components/offline-write-note.tsx`, `hr.json` keys, registration fixtures.
- [x] Kalendar forms and the erasure dialog -- gate them, and gate the erasure check before it starts.
- [x] The resolution save, the member-page cards and dialogs, the Ljudi add dialog -- gate them.
- [x] Sign-in and set-password submits -- gate them.
- [x] `sign-out.ts` / `chrome.tsx` / `use-set-password.ts` -- the local fallback (+ unit test on the seam).
- [x] `e2e/tests/offline/offline-write.spec.ts`:
  - offline Kalendar roster save, member-page team change and add member each show the note, are `aria-disabled` and send no request (route spy);
  - reconnect lifts the gate with nothing sent;
  - offline sign-in is gated.
- [x] `e2e/tests/offline/sign-out-clears.spec.ts`:
  - read online, the IndexedDB entry exists, Odjava from the sidebar and from the Više sheet, the entry is gone;
  - B signs in and sees no A data;
  - offline with an expired token (rewrite `expires_at`), Odjava succeeds and the entry is gone.
- [x] Docs:
  - UX-DR45;
  - EXPERIENCE.md §State Patterns Offline (the write gate, Odjava offline, `lastOrganization`);
  - DESIGN.md:257 (the write note);
  - spine CAP-18;
  - `deferred-work.md`: the 8.3b entry already exists.

**Acceptance Criteria:**
- Given offline, when any in-scope write control is shown, then it is `aria-disabled` with *Za ovo je potrebna veza.* and pressing it sends nothing.
- Given a signed-in member on a device holding a snapshot, when they sign out (online, or offline with an expired token), then IndexedDB holds no snapshot.
- Given `pnpm test`, `lint` and `typecheck`, and the e2e suites for offline, auth, calendar, people and conflicts, when they run, then all pass.

## Spec Change Log

- 2026-10-22, review loop 1 (frozen wording, human decision a): the write note read *Za spremanje je potrebna veza.* beside controls that do not save (remove, withdraw, reset, add). It now reads the neutral *Za ovo je potrebna veza.* everywhere except sign-in. KEEP all implemented code. Only the `offline.needsConnection` string and the docs quoting it change, plus the review patches.

- 2026-10-22 (implementation): auth-js 2.113.0's `signOut({ scope: 'local' })` fails the same way as the global one while the stored session cannot be loaded (an expired token offline), so the local fallback first drops the stored session under the client's own `storageKey`, then runs `signOut({ scope: 'local' })` on the empty session (it removes what is left and announces `SIGNED_OUT`). While `onlineManager` says offline, Odjava goes local at once rather than waiting out auth-js's ~30 s refresh back-off. The seam is `lib/supabase/local-sign-out.ts`, injected into `signOut(auth, fallback)`. The unchecked-erasure retries (*Pokušaj ponovno* under *Ne mogu provjeriti…*) are gated with their save, since each re-asks the same write; the arming buttons that only open a confirmation (the team and status withdrawals, the reset, a leave removal) stay ungated, as dialogs open offline (4a).

## Verification

**Commands:**
- `pnpm --filter @shift/web build && pnpm test && pnpm lint && pnpm typecheck` -- expected: green.
- `pnpm test:e2e e2e/tests/offline e2e/tests/auth e2e/tests/calendar e2e/tests/people e2e/tests/conflicts` -- expected: green.

## Suggested Review Order

**The write gate**

- Entry point: the pure gate (`aria-disabled`, `describedBy`) that every write control uses.
  [`use-write-gate.ts:32`](../../apps/web/src/lib/offline/use-write-gate.ts#L32)

- The one "online" source shared by the hook, the write functions and the sign-out fallback.
  [`use-write-gate.ts:64`](../../apps/web/src/lib/offline/use-write-gate.ts#L64)

- The note: *Za ovo je potrebna veza.*, or *Za prijavu…* on sign-in. It renders only while offline.
  [`offline-write-note.tsx:13`](../../apps/web/src/components/offline-write-note.tsx#L13)

- The erasure dialog requires a gate (the 8.3b callers pass `null`).
  [`erasure-dialog.tsx:91`](../../apps/web/src/features/conflicts/components/erasure-dialog.tsx#L91)

- A check the connection drops under shows the gate, not *Ne mogu provjeriti…*.
  [`use-roster-form.ts:440`](../../apps/web/src/features/calendar/hooks/use-roster-form.ts#L440)

**Signing out clears the device**

- Online, the global sign-out falls back to local only on a transport failure; offline it goes local at once.
  [`sign-out.ts:281`](../../apps/web/src/features/auth/services/sign-out.ts#L281)

- The local path removes the stored session keys within a time budget.
  [`sign-out.ts:205`](../../apps/web/src/features/auth/services/sign-out.ts#L205)

- The page binding, checked at runtime.
  [`local-sign-out.ts:36`](../../apps/web/src/lib/supabase/local-sign-out.ts#L36)

**Docs**

- UX-DR45: the write gate and Odjava offline.
  [`epics.md:179`](../planning-artifacts/epics.md#L179)

**Tests**

- Offline writes: roster, override, erasure confirm, team, resolution, leave removal, add member, sign-in, set-password.
  [`offline-write.spec.ts:1`](../../e2e/tests/offline/offline-write.spec.ts#L1)

- Sign-out empties IndexedDB (sidebar, Više, set-password, offline with an expired token) and the second account sees nothing.
  [`sign-out-clears.spec.ts:1`](../../e2e/tests/offline/sign-out-clears.spec.ts#L1)
