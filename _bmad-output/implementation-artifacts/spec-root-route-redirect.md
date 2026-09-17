---
title: 'The root route decides where a signed-in person belongs'
type: 'bugfix'
created: '2026-09-17'
status: 'done'
review_loop_iteration: 0
baseline_commit: '2c3e9708e8be11ad5fe69a22b280c888eda28a7c'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/` is the only signed-in screen with no navigation and no sign-out, and it is where everything lands: a successful sign-in navigates there, and both sign-in routes redirect an already-signed-in visitor there. A person signing in today reaches a bare heading with no way to go anywhere and no way to leave — verified in a browser on 2026-09-17. `router.test.ts:613-615` already calls `/` "the one path that decides where a signed-in person belongs"; it decides nothing.

**Approach:** `/` becomes a decision rather than a screen. Signed in, it forwards to the first destination; signed out or unreadable, it redirects to `/prijava` exactly as it does now. The placeholder screen and its string go with it.

## Boundaries & Constraints

**Always:**
- **Both branches still resolve.** `/` must never render nothing: every path out of it is a redirect, and the signed-out branch keeps `search: true` and `hash: true` so an AD-14 deep link survives.
- The route stays registered. `/` keeps its id and its place in the tree; only what it does changes.
- The forward target is reachable by **both** roles. `nav.danas` is first in binding order and carries `EVERYONE`, so a member and an admin both land somewhere they are entitled to.
- The unreadable-session branch stays fail-closed and keeps logging `SESSION_UNRESOLVED`.
- The placeholder's string leaves `hr.json` and every gate in the same commit. `resource-hygiene.test.ts:67-68` already records it as "explicitly temporary".

**Ask First:**
- Bringing `/` inside the layout instead. It changes `/`'s id, disturbs the match chains `router.test.ts` pins, and leaves a screen that is not one of the eight destinations — but it is the other candidate the ledger named, and this spec chooses the redirect.
- Any change to the destination table or its binding order.

**Never:**
- No new route, and no route removed. `router.test.ts:89-103` pins the id list exhaustively and it must come out unchanged.
- No role read at `/`. The forward target is reachable by every role, so `/` stays session-only, exactly as `_app.tsx` is.
- No naming of a destination inside either sign-in route. They redirect to `/` and `/` decides; that separation is what `router.test.ts:613-615` exists to protect.
- No component on `/`. A redirect-only route that registers one is a screen nobody can reach.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signed-in visitor opens `/` | live session | Forwarded to the first destination, which renders inside the chrome | N/A |
| Just signed in | credential submit succeeds | Lands on a destination with navigation and a sign-out, never on a bare heading | N/A |
| Already signed in on a sign-in route | session, `/prijava` or `/prijava/$slug` | Redirected to `/`, which forwards on — one hop, no loop | N/A |
| Signed-out visitor opens `/` | no session | Redirected to `/prijava`, `search` and `hash` preserved | N/A |
| Session read throws | reader rejects | Same redirect to `/prijava`, cause logged | Logged, never a blank shell |
| Deep link while signed out | `/?tim=2#tjedan` | Redirect carries both through | N/A |

</frozen-after-approval>

## Code Map

**Baseline `2c3e970`**, green: **1237 root / 767 web / 4 domain**, 0 skipped. `nvm use` first (Node 24.19.0). `pnpm build` before `pnpm test`.

- `routes/index.tsx:53-85` — the guard to rework: session → return (today it renders), `null` or a caught throw (`:68-80`, logs `SESSION_UNRESOLVED` at `:79`) → `throw redirect({ to: '/prijava', search: true, hash: true })` at `:84`. `:42-48` `SignedInScreen`, rendering `t('home.heading')` at `:45` — the only key here. **`:32-40` already records this decision for whoever came next**: moving `/` under the layout or redirecting it to a destination was left to "the next story that touches `/`". This is it.
- `router.ts:42-48` — `indexRoute` is a direct child of `rootRoute`, deliberately outside the layout because it must be reachable signed out. That does not change.
- `destinations.ts:91` — `nav.danas` → `/danas`, `roles: EVERYONE` (`:74` = both), first in the array. `destinationsFor` is a filter that preserves order, so "first destination" is stable.

### What breaks, and what does not

- **Breaks, and flips to a shape this repo has used before:** `router.test.ts:359-370` asserts `indexRoute.options.component` is `SignedInScreen` by identity. Its own comment at `:360-364` records that 1.1d asserted the **inverse** — `component` undefined, "because a redirect-only route can never render one". Restore that assertion.
- **Breaks:** `router.test.ts:352-356` "does not redirect while signed in" is exactly the behaviour being removed. It becomes an assertion that a signed-in visitor IS forwarded, and to the first destination rather than a hard-coded path.
- **Must be deleted, or the sweeps fail on a file with no JSX:** `prijava.test.ts:171` `SCREENS` row for the signed-in placeholder (`expectedControls: 0`) and `:761` `KEY_SOURCES` row (`strings: 1`). Neither list has a length assertion, so removing a row drops cases silently — say so where the rows were.
- **Survives untouched:** `router.test.ts:89-103` (the route stays registered, so `/` stays in the id list), `:106-108` (`match('/')` still resolves `['__root__','/']`), `:263-283` (not-found identity and `/$` absence), `:325-350` and `:372-398` (both signed-out branches), `:400-421` (context binding), and `:608-617` — which asserts only that the sign-in routes redirect to `'/'`, and which this change finally makes true.
- **Survives because the file survives:** `localization-applied.test.ts:62` lists `index.tsx` in `SOURCES`. Keep the file as a redirect-only route and the entry needs no edit; delete the file and the freshness check throws.
- **Cheaper than expected:** `AUTHORED_VOCABULARY` tracks `Prijava` and `Prijavi` only, and `wordOccurrences` is case-sensitive, so the lowercase "prijava" in "Uspješna prijava" is counted by nothing. Removing the string moves no count in either direction.
- `prijava.tsx:103` navigates to `/` after a successful submit, `:274` and `prijava-organizacija.tsx:129` redirect there when already signed in. All three fire only with a session, so each takes exactly one further hop and terminates.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/routes/index.tsx` — make `/` redirect-only: forward a session to the first destination, keep both signed-out branches exactly as they are, drop `SignedInScreen` and the `component` registration. Replace the deferred-decision comment at `:32-40` with what was decided and why the layout alternative was not taken.
- [x] `apps/web/src/router.test.ts` — restore the `component === undefined` assertion, replace "does not redirect while signed in" with the forward, and assert the target comes from the destination table rather than a literal.
- [x] `apps/web/src/routes/prijava.test.ts` — delete the `SCREENS` and `KEY_SOURCES` rows for the placeholder, recording at each site that the screen is gone rather than leaving a silent gap.
- [x] `apps/web/src/i18n/locales/hr.json` — remove `home.heading` and the now-empty `home` group.
- [x] `test/resource-hygiene.test.ts` — remove `home.heading` from `SANCTIONED_SCREEN_KEYS`.

**Acceptance Criteria:**
- Given a person who signs in, when the credential submit succeeds, then they arrive on a destination that renders the navigation chrome and a reachable sign-out, and never on a screen without them.
- Given a signed-out visitor opening `/` with a query string and a fragment, when the redirect fires, then both survive to `/prijava`.
- Given a session read that throws, when `/` resolves, then the visitor reaches `/prijava` and the cause is logged.
- Given the route tree, when it is enumerated, then it holds exactly the ids it held before this change.

## Spec Change Log

### 2026-09-17 — iteration 0, three adversarial layers, no loopback

**Triage deviation, recorded deliberately.** Spec-rooted findings were routed to `patch` rather than `bad_spec`, following the precedent every story in this epic has set. Thirteen findings applied, three rejected.

**The finding that mattered was one the spec never considered.** Turning a screen into a redirect leaves the old URL in history, so Back from the destination returned to `/` and was immediately forwarded again — the Back button dead, and everything before `/` unreachable. It did not arise while `/` rendered something. The implementer then found the same defect in the other direction on the signed-out branch, which nobody had asked about: Back from `/prijava` returned to `/` and bounced straight back. `replace: true` is on both branches and pinned by one case over the pair, because the defect is a property of `/` rather than of either outcome.

**Rejected, and why, so they are not re-raised.** Carrying `search`/`hash` onto the signed-in forward: the omission is deliberate — those parameters were addressed to whatever `/` was asked for, and a destination that never asked for them would be given a meaning to invent — and it matches the 1.3b decision that preserving parameters nothing can consume buys nothing while reading as though it buys something. The **absence** is now asserted, since all three layers found it was held only by a comment. Pointing both sign-in exits straight at a destination: `router.test.ts:613-615` exists to stop those files deciding where a person belongs, so the hop through `/` is the design.

**KEEP — must survive any re-derivation.**
- **A redirect-only route replaces, it does not push.** On both branches.
- **The non-emptiness lives in the table.** Typing `DESTINATIONS` as `readonly [Destination, ...Destination[]]` at its declaration removes the cast from the route entirely; a cast there was a claim the compiler could not check, whose failure is a TypeError inside `beforeLoad` and a blank page at HTTP 200.
- **The forward target is read from the table and asserted as such.** A hard-coded first destination is behaviourally identical today, so only a source assertion can catch it — and that sweep must compare whole string literals, since a naive comment-stripper eats code after a `//` inside a string.
- **Both lists carry length assertions now.** `SCREENS` and `KEY_SOURCES` had none, so a removed row dropped its cases silently; a comment saying so is not a guard.
- **The target's own guard is exercised with the same session**, so "one hop and it terminates" is a test rather than a claim resting on reading two files.

**Known-bad state avoided.** A Back button that does nothing on every signed-in screen; a blank page at HTTP 200 if the destination table were ever empty; a first destination hard-coded past a probe that could not detect it; and two stale cross-references — one of which, in `localization-applied.test.ts`, described `/` as having "stopped being a bare redirect", which this change reverses exactly.

## Verification

**Commands:**
- `nvm use && node -v` — expected: `v24.19.0`.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — expected: all exit 0, no skips. Counts move DOWN from 1237/767/4 by the cases the two deleted rows carried; state the new baseline rather than asserting growth.
- Manual, against the running dev server: sign in as `ivan.maric` / `local-fixture-password` at `dvd-kastel-novi` and confirm the landing screen carries the sidebar and `Odjavi se`.
- Mutation probes — each must fail the suite: register a component on `/` again; forward a signed-out visitor to the destination instead of `/prijava`; drop `search`/`hash` from the signed-out redirect; hard-code `/danas` instead of reading the destination table.

## Suggested Review Order

- Start here: `/` decides and forwards, and replaces rather than pushes.
  [`index.tsx:110`](../../apps/web/src/routes/index.tsx#L110)

- The signed-out branch, unchanged in intent and now replacing too.
  [`index.tsx:112`](../../apps/web/src/routes/index.tsx#L112)

- The claim moved to where the entries that make it true live.
  [`destinations.ts:99`](../../apps/web/src/navigation/destinations.ts#L99)

- The forward target read from the table, asserted as a whole literal.
  [`router.test.ts`](../../apps/web/src/router.test.ts)

- Both lists finally count themselves, so a dropped row is loud.
  [`prijava.test.ts`](../../apps/web/src/routes/prijava.test.ts)
