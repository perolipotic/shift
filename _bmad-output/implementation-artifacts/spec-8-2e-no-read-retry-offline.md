---
title: '8.2e No read retry offline on any surface'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: '9b914dbdbae3c346dcac513d0654a30f4e55d135'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-2d-settings-surfaces-read-offline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Offline, on every surface except the four settings surfaces (8.2d), an unavailable state still shows *Pokušaj ponovno*. Its `refetch()` pauses until the connection returns, so a press does nothing visible. When the connection drops while that button has focus, the button unmounts and focus falls to `<body>`.

**Approach:**
- Each surface hook ANDs `clock.online` (already returned by `useSnapshotFreshness`) into the read-retry flag it exposes, or adds one where the button is unconditional today. The chrome uses its existing `useFreshnessClock`.
- One callback-ref helper moves focus to the sibling alert when a focused read-retry button unmounts. It goes on every read-retry button, including 8.2d's.

## Boundaries & Constraints

**Always:**
- Offline, no read-retry control is rendered on:
  - Danas (member and admin);
  - Kalendar;
  - Sati;
  - Godišnji (member, overview and the page fallback);
  - the Ljudi table and Imenik;
  - Raspored (both tabs) and the resolution page;
  - the member page (basics, team and leave cards);
  - the chrome role notice.
- The unavailable message is unchanged, and online the retry returns (human decision 2026-10-21, 2a).
- Hooks compute the flag. Service-level `retryable` values stay untouched, so their tests stay green. A component that renders the button unconditionally today takes a flag (or a nullable `onRetry`, as in Sati).
- The focus helper, `utils/retry-focus.ts` `keepFocusOnAlert`: a React 19 ref callback whose cleanup runs only when the button had focus. It then focuses the `[role="alert"]` in the button's parent through `focusLater`, giving it `tabIndex=-1` if it has none. If the alert is gone too (a retry that succeeded), it does nothing. It is pure enough to unit-test with injected frames, like `focusLater`.
- No `<Button` count changes. Buttons are wrapped in a condition, not extracted, so `source-guards.fixture.ts` `expectedButtons` stay as they are.

**Ask First:**
- Any write-path retry: the calendar, member-page and rotation erasure retries, the builder's save and cancel retries, the organization dialog retries, and `pages/error.tsx`. These are 8.3 or unrelated.

**Never:**
- New i18n strings or new wording.
- A shared `<ReadRetry>` component, which would change the button counts.
- Touching the service `*StateOf` retry logic.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Offline, unavailable | Any listed surface, never read | The alert shows, with no retry button | — |
| Online, unavailable | A read failed online | The alert and its retry, as today | — |
| Connection drops while the retry has focus | Focus is on the retry, then `offline` | The button goes and focus moves to its alert | — |
| Retry succeeds | The alert and the button both unmount | No focus action from the helper | — |
| Reconnect | offline→online on an unavailable surface | The retry returns | — |

## Epic AC Deviations

None. This is a refinement of the offline unavailable state (human decision 2026-10-21, 1a/2a), not an epic AC.

</frozen-after-approval>

## Code Map

Each row gives the render site, then the hook. Every hook already calls `useSnapshotFreshness`; add `clock` to the destructure.

- Danas member: `today/components/today-body.tsx:47` (`today.retryable`) → `today/hooks/use-today.ts:104,213,244`.
- Danas admin: `today/components/admin-today-body.tsx:59` (unconditional) → `use-admin-today.ts:93,167`.
- Kalendar: `pages/kalendar.tsx:142` → `calendar/hooks/use-calendar-screen.ts:157,265,452`.
- Sati: `pages/sati.tsx:99` / `hours/components/hours-body.tsx:39` → `hours/hooks/use-hours.ts:118,261`.
- Godišnji: `leave/components/my-leave-body.tsx:30`, `leave-overview-body.tsx:62`, `pages/godisnji.tsx:98-106,128` → `use-my-leave.ts:61,88,104`, `use-leave-overview.ts:125,217,323`.
- Ljudi table: `pages/ljudi.tsx:157,202-211` → `members/hooks/use-member-list.ts:97,105,237`.
- Imenik: `teams/components/member-directory.tsx:81` → `teams/hooks/use-member-directory.ts:110,144,182`.
- Raspored: `conflicts/components/conflicts-body.tsx:93-109` (shared `UnavailableAlert`), `pages/raspored.tsx:48` → `use-conflicts-queue.ts:132,181`.
- Resolution: `conflicts/components/conflict-resolution-body.tsx:283` → `use-conflict-resolution.ts:190,255,442`.
- Member page:
  - `members/components/member-basics-card.tsx:116` → `use-member-edit.ts:136,213` (`readRetryable`).
  - `member-team-card.tsx:129-143` (the read retry `retryTeams`, not the erasure `retryTeam` at :223) → `use-member-edit.ts:158,228`.
  - `leave/components/member-leave-card.tsx:80` → `use-member-leave.ts:264,602,900`.
- Chrome: `navigation/components/chrome.tsx:250` (`clock`), :302 and :867-870. Reword the comments at :247 and :251.
- 8.2d sites (ref only): `organization-settings-card.tsx:102`, `shift-type-list-section.tsx:40`, `rotation-notices.tsx:356`, `postavke-rotacije.tipovi-smjena.$id.tsx:82`, `organizacija.satni-pojasi.tsx:91`, `.$id.tsx:84`, `ljudi.smjene.tsx:80`, `ljudi.smjene.$id.tsx:77`.
- `utils/focus-later.ts` (reuse). `components/ui/button.tsx:66` (forwardRef).
- Pin: `pages/structural-pins-shell.test.ts:557-559` (`roleFailure === null ?`), which changes. Optionally add `clock.online` pins, as in `structural-pins-settings.test.ts:651`.
- e2e: `e2e/pages/base.page.ts:76` `shellRetryButton`. Flip `e2e/tests/offline/offline-read.spec.ts:323,395`. The model for the focus test is :625-646.

## Tasks & Acceptance

**Execution:**
- [x] `utils/retry-focus.ts` (+ test) -- `keepFocusOnAlert`.
- [x] The 12 hooks and the chrome from the Code Map -- gate on `clock.online`, and add flags where the button is unconditional.
- [x] The ~15 render files -- conditional render, plus `ref={keepFocusOnAlert}` on every read-retry button, including the 8 from 8.2d.
- [x] `structural-pins-shell.test.ts` -- update the chrome pin.
- [x] `e2e/tests/offline/offline-read.spec.ts`:
  - flip :323 and :395 to no retry;
  - add Danas member never read offline (alert, no retry), and Kalendar the same;
  - add focus: a read fails online, focus the retry, go offline, and the alert is focused.
- [x] Docs:
  - `EXPERIENCE.md` Offline bullet: no read retry offline on any surface;
  - spine AD-13: a dated line for 8.2e;
  - `deferred-work.md`: close the 8.2e entry;
  - `epic-8-context.md`: the "Never mixed" bullet.

**Acceptance Criteria:**
- Given any offline-readable surface in its unavailable state offline, when it renders, then no *Pokušaj ponovno* is present, and online it returns.
- Given `pnpm test`, `lint` and `typecheck`, and the e2e suites for offline, today, calendar, hours, leave, people and conflicts, when they run, then all pass.

## Spec Change Log

## Verification

**Commands:**
- `pnpm --filter @shift/web build && pnpm test && pnpm lint && pnpm typecheck` -- expected: green.
- `pnpm test:e2e e2e/tests/offline e2e/tests/today e2e/tests/calendar e2e/tests/hours e2e/tests/leave e2e/tests/people e2e/tests/conflicts` -- expected: green.

## Suggested Review Order

**Focus when the retry goes**

- Entry point: the ref callback that hands focus to the sibling alert, and never takes it from the user.
  [`retry-focus.ts:94`](../../apps/web/src/utils/retry-focus.ts#L94)

- The bound helper that every read-retry button carries.
  [`retry-focus.ts:137`](../../apps/web/src/utils/retry-focus.ts#L137)

**One flag: "show the read retry now"**

- The pattern: online AND the retryable unavailable state.
  [`use-admin-today.ts:169`](../../apps/web/src/features/today/hooks/use-admin-today.ts#L169)

- Kalendar keeps its domain's retryable and adds `clock.online`.
  [`use-calendar-screen.ts:273`](../../apps/web/src/features/calendar/hooks/use-calendar-screen.ts#L273)

- Raspored's shared alert takes a nullable `onRetry`, as Sati does.
  [`conflicts-body.tsx:102`](../../apps/web/src/features/conflicts/components/conflicts-body.tsx#L102)

- The chrome role notice.
  [`chrome.tsx:311`](../../apps/web/src/features/navigation/components/chrome.tsx#L311)

**Docs**

- AD-13 for 8.2e.
  [`ARCHITECTURE-SPINE.md:143`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L143)

**Tests**

- Pins: a `clock.online` flag for each hook, and `keepFocusOnAlert` on every read-retry button.
  [`structural-pins-shell.test.ts:985`](../../apps/web/src/pages/structural-pins-shell.test.ts#L985)

- Offline e2e: every surface shows its alert with no retry, the retry returns online, and focus moves to the alert (Kalendar, Organizacija).
  [`offline-read.spec.ts:1`](../../e2e/tests/offline/offline-read.spec.ts#L1)
