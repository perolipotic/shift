---
title: 'Navigation shell B — the chrome and its exit'
type: 'feature'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: '2d8b52ee0464bbdd9ad81254984319d45616a387'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Part A registered eight destinations and the data that maps roles to them, and shipped no way to reach any of them: `destinationsFor` is called by nothing, `_app.tsx:59-65` renders a bare `<Outlet/>`, and navigating means typing a URL. There is also no way to leave — no `signOut` wrapper exists anywhere, `index.tsx:31` records the omission, and on shared shift-work devices a session can only be ended by closing the browser. Neither sign-in route checks for an existing session.

**Approach:** A chrome component renders `destinationsFor(role)` as a bottom tab bar below 640px and a sidebar at and above it, with a sign-out control in both. The role it needs comes from a fresh read of the member's own row, not from a token. Both sign-in routes gain the already-signed-in redirect, which lands with the exit rather than before it.

## Boundaries & Constraints

**Always:**
- **The role is read fresh, never carried in the token.** `0003` reads role and active status on every policy evaluation so a demoted or deactivated account loses access on its next query rather than at token expiry; navigation follows the same rule. The read arrives as text, so the narrowing to `MemberRole` is a runtime guard with an explicit unrecognised branch, never a cast.
- **An unrecognised role renders no destinations and says so.** Filtering to an empty list and rendering empty navigation is indistinguishable from a member with no access; the two must not look alike.
- Icons are decoration beside a visible Croatian label, never the label. Human decision 2026-09-16: `Danas` Home, `Kalendar` Calendar, `Sati` Clock, `Godišnji` Palmtree, `Raspored` CalendarRange, `Ljudi` Users, `Postavke rotacije` Repeat, `Organizacija` Building2 — `lucide-react@1.39.0`, already a dependency and imported by nothing today.
- The active destination is signalled by `aria-current="page"` **and** a treatment that is not colour (UX-DR37, Q21).
- **Nothing about the layout is persisted.** Human decision 2026-09-16: collapse resets on every load, matching the theme layer's stance, so one person's layout never follows another into the next session on a shared device.
- Every navigation control clears 44px by composing `h-11`, as every screen does; the inherited primitives are `h-9`/`h-10`.
- The exit and the guard ship together. A guard added without an affordance makes the missing exit harder to notice, not easier.
- `signOut` takes its auth client as its first parameter, as `signIn` does at `sign-in.ts:135`, so its outcomes execute in the node suite.

**Ask First:**
- Any new runtime dependency. None is expected: see the Code Map.
- Any change to `_app.tsx` beyond rendering the chrome around the existing `<Outlet/>`.
- Any new theme token, or consuming `--sidebar-primary` (it is asymmetric between themes and has no contrast pair — an open ledger question this story must not silently resolve).

**Never:**
- No new route. `router.test.ts:89-103` pins the route-id list exhaustively and the chrome is a component, not a destination.
- No role logic in `_app.tsx`. `router.test.ts:616-638` asserts its source contains none of `role`, `admin`, `member_role`, `destinationsFor`, and that assertion is what keeps the session guard session-only.
- No second `<Outlet/>`, and no conditional one.
- No `.tsx` test file — `apps/web/vitest.config.ts:25` collects `src/**/*.test.ts`, so a `.tsx` test is silently uncollected.
- No `destructive` token anywhere in the chrome. Signing out is an ordinary action, not a conflict (UX-DR4).
- No roster, and no ninth destination. `Sati` stays one destination with role-scoped content.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Member navigates | role `member_role` | Exactly four destinations, in binding order, no configuration surface | N/A |
| Admin navigates | role `admin` | All eight, `Sati` once | N/A |
| Role read refused or unavailable | policy refuses, or transport fails | Navigation renders no destinations and reports it; never an empty bar that reads as "no access" | Reported, not swallowed |
| Unrecognised role text | `'supervisor'` from the database | Same reported state as above, not a silent empty filter | Logged with the value |
| Active destination | on `/kalendar` | `aria-current="page"` plus a non-colour treatment on exactly one entry | N/A |
| Below 640px | narrow viewport | Bottom tab bar; no sidebar | N/A |
| 640–1024px | medium viewport | Sidebar, collapsible, collapse state gone on reload | N/A |
| Signing out | admin presses the exit | Session ends and the person lands on a sign-in route | A refused sign-out names the problem and leaves the session intact |
| Signed-in visitor reaches a sign-in route | session, `/prijava` or `/prijava/$slug` | Redirected to `/`, no credential form offered | N/A |

</frozen-after-approval>

## Code Map

**Baseline `2d8b52e`**, green: **1050 root / 612 web / 4 domain**, 0 skipped. `nvm use` first (Node 24.19.0) — the nvm v20 bin precedes it in `PATH`, so verify `node -v`. `pnpm test` never builds and `localization-applied.test.ts` **fails** rather than skips on a stale build, so `pnpm build` before `pnpm test`.

### What part A left, and where the chrome attaches

- `destinations.ts:65-72` `Destination` (`key`, `path`, `roles`), `:90-101` the eight in binding order, `:104-106` `destinationsFor` — a filter, never a sort. `:45` `NavigationKey` is typed off `hr.json`, so a bad key fails typecheck. **`destinationsFor` is called by nothing today.**
- `destinations.test.ts` already pins the counts, the ordering, the subsequence property, key/label purity and that no entry carries a user-facing string. Do not re-derive any of it. **`:247` asserts `nav.odjava` is absent** — a third gate holding the word, beyond the two the ledger names.
- `_app.tsx:59-65` `AppLayout` renders only `<div className="flex flex-1 flex-col"><Outlet /></div>`. The chrome wraps that, in its own module. `:73-103` the session guard: fail-closed, logs `SESSION_UNRESOLVED`, redirects to `/prijava`.
- `router.ts:30-39` nests all eight under the pathless layout; `:80-83` `currentSession` is the entire router context — a session reader, not a mutator, so sign-out needs its own client access.
- Seven of the eight destinations are near-identical placeholders (38–51 lines). `organizacija.tsx` is 629 lines and is a built screen, not a placeholder.

### The role, which does not exist client-side yet

- Nothing in `apps/web/src` reads `members`, and `0003:187-204` puts only `organization_id` in the token — the role is not in the JWT by design.
- `0003:289-300` `members_select_own_organization` already permits the read, so **this story needs no migration.**
- Copy the shape of `organization/snapshot.ts`: `:143-156` the injected table seam, `:48` one query key, `:328-341` a refusal is zero rows and no error, `:353-370` the read. `messages.ts:35-49` maps codes to keys; `:94` is the exhaustiveness check to copy.

### Sign-out and the guard

- `sign-in.ts:135` `signIn(auth: PasswordAuth, …)`, `:78-83` the structural interface, `:24-29` why the client is the first parameter. **No `signOut` exists anywhere** — one comment at `index.tsx:31` records the deliberate omission.
- `client.ts:194-205` `sessionReader` / `currentSession`; `SessionSource` at `:166-171` names only `getSession()`. `prijava.tsx:89` passes `supabaseClient().auth` straight into `signIn` — the precedent for reaching auth from a component.
- `prijava.tsx:242-244` has a slug-shape `beforeLoad` and no session check. `prijava-organizacija.tsx:108-112` has **no `beforeLoad` at all**. Both are direct children of `rootRoute` and take context the way `_app.tsx:73-103` does. No existing test exercises signed-in access to either.

### No new dependency is needed

- `components/ui/` holds exactly `button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`. Sheet, Sidebar, Tabs, Tooltip and Separator are all absent — **and so are their Radix packages**: only `@radix-ui/react-label` and `@radix-ui/react-slot` are installed.
- None of them is required. A tab bar is a `<nav>` of `<Link>`s; an in-layout collapsing sidebar is an `<aside>` plus a toggle `<Button>`. Collapse is not persisted and not an overlay drawer, so nothing needs a dialog primitive. Build from semantic elements plus the existing `Button`.
- Responsive precedent is thin but no longer absent: `input.tsx:11` `md:text-sm` and `organizacija.tsx:556` `sm:grid-cols-2`. No `lg:` anywhere.

### Gates, and exactly what this story owes them

- **`resource-hygiene.test.ts:161` `RESERVED_STEMS = ['odjav']`** — the last stem. `:336` already guards non-vacuity with `expect(RESERVED_STEMS.length).toBeGreaterThan(0)`, and `:350-352` self-tests that `reservedStemIn('Odjava')` returns `'odjav'`. So emptying the array **fails loudly** rather than silently — the work is that both blocks become dead code to rewrite or delete in the same commit, and the stale comment at `:66-69` ("There is no `nav.odjava`") goes with them. Note the stem `odjav` matches `Odjavi` too.
- `resource-hygiene.test.ts:47-142` `SANCTIONED_SCREEN_KEYS` currently holds 40 entries (the header comment's "thirty-three" is stale); `:217` asserts exact set equality both directions.
- `localization-applied.test.ts:412` `NAVIGATION_AND_TERMINOLOGY` is `['Smjena','Smjene','smjena','Odjava','Nema']`. **`Odjavi se` does not contain the substring `Odjava`**, so that entry would not trip — remove it anyway, because leaving a ban that the shipped word evades reads as protection that is not there. `:361-402` `AUTHORED_VOCABULARY` gains the literal that actually renders, counted per word at `:453-466` by exact occurrence equality. `:48-109` `SOURCES` gains every new file.
- `prijava.test.ts:125-163` `SCREENS` — the signed-in layout row currently expects **0 controls**; it and `KEY_SOURCES` (`:588-628`) must carry the real counts. `:225` `TARGET_FLOOR_PX = 44`; `:552-564` `heightPx` understands `h-<n>`, `min-h-<n>`, `h-[<n>px]`, `h-[<n>rem]`.
- `prijava.test.ts:323-350` `STRUCTURAL_ATTRIBUTES` allowlists 14 names and is **global across every screen**. `aria-current` is not among them and the active treatment needs it — adding it widens the exemption everywhere, so justify it as `role` and `variant` were justified, from a closed non-textual set.
- Both element regexes are already non-vacuously guarded by every consumer (`:1187-1191`, `:640`, `:1224-1226`, `:814-837`). A new sweep must bring its own length assertion; copying a regex without one is how they go quiet.
- `prijava.test.ts:716-750` asserts `_app.tsx`'s single unconditional `<Outlet/>`. `router.test.ts:263-274` pins `notFoundComponent` by identity; `:281` and `:575` forbid a catch-all; `:707-718` asserts every destination route has `beforeLoad === undefined`, so the guard stays solely on the layout.
- Theme: the eight `--sidebar-*` tokens exist in both themes (`index.css:102-109`, `:160-167`) and **no component consumes any of them**. `--sidebar-primary` is neutral in light and chromatic in dark, has no pair in `theme-contrast.test.ts:40` `BASE_PAIRS`, and is a recorded open question. `theme-css.ts:24-69` and `theme-tokens.test.ts:34-40` hard-code counts 23 and 28, so a new token owes both files plus a contrast pair if it carries text.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/navigation/role.ts` — the member's own role: the injected table seam, one query key, the read, the text-to-`MemberRole` guard with an explicit unrecognised branch, and a failure code per matrix row. Copy `organization/snapshot.ts`'s shape; import no client.
- [ ] `apps/web/src/navigation/role.test.ts` — every role row against an injected fake, including refusal, transport failure and unrecognised text.
- [ ] `apps/web/src/supabase/sign-out.ts` — `signOut(auth, …)` with its own narrow structural interface, mirroring `sign-in.ts:78-83` and `:135`.
- [ ] `apps/web/src/supabase/sign-out.test.ts` — success, refusal and rejection, against a stub.
- [ ] `apps/web/src/navigation/chrome.tsx` — the tab bar below 640px, the sidebar at and above it with collapsibility, icons beside labels, `aria-current="page"` plus a non-colour active treatment, and the sign-out control. Renders `destinationsFor(role)`; holds no role logic of its own beyond consuming it.
- [ ] `apps/web/src/routes/_app.tsx` — render the chrome around the existing `<Outlet/>`. Nothing else: no role token may appear in this file.
- [ ] `apps/web/src/routes/prijava.tsx`, `apps/web/src/routes/prijava-organizacija.tsx` — the already-signed-in redirect in `beforeLoad`, preserving the existing slug guard on the former.
- [ ] `apps/web/src/i18n/locales/hr.json` — the sign-out label and the role-unavailable message. The label is imperative, matching `Spremi`/`Odustani`/`Odaberi`.
- [ ] `apps/web/src/navigation/destinations.test.ts` — replace the `nav.odjava` absence assertion at `:247` with one that pins the key now that it exists.
- [ ] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts`, `apps/web/src/router.test.ts` — extend all four in the same commit: empty `RESERVED_STEMS` and rewrite the two blocks it made dead, sanctioned keys, `SOURCES`, `AUTHORED_VOCABULARY`, `NAVIGATION_AND_TERMINOLOGY`, the layout's `SCREENS` and `KEY_SOURCES` counts, `STRUCTURAL_ATTRIBUTES`, and the signed-in-redirect cases on both sign-in routes.

**Acceptance Criteria:**
- Given a signed-in member, when any destination renders, then the chrome offers exactly their four destinations and no configuration surface, at every viewport width.
- Given a signed-in admin on a phone, when they complete any navigation, then every control they touch is at least 44px and no page scrolls horizontally.
- Given a person who presses the exit, when the session ends, then they land on a sign-in route and no destination is reachable without signing in again.
- Given a role the application does not recognise, when navigation renders, then it reports that state rather than presenting the same empty bar a member with no access would see.

## Spec Change Log

### 2026-09-16 — iteration 0, three adversarial layers, no loopback

**Triage deviation, recorded deliberately.** Several findings had spec-level root causes and would normally route to `bad_spec` and a re-derive. They were routed to `patch` instead, following the precedent `spec-1-3b`, `spec-1-4a` and `spec-1-4b` set: every fix is additive and local, and the architecture the spec asked for held under all three layers.

One finding was examined for `intent_gap` and released. The frozen matrix sends an already-signed-in visitor to `/`, and `/` renders no chrome, so the guard deposits people on a screen with no navigation and no exit. But `/` has been chromeless since part A and the frozen row's intent — do not offer a credential form to someone already signed in — is met. The guard widens exposure to a pre-existing hole rather than creating one, so it is on the ledger, not a renegotiation.

**Two reviewer findings were demonstrated, not argued, and both are the reason this entry exists.** A reviewer reverted the layout to a bare `<Outlet/>`, rebuilt, and the full suite passed at 1055 tests — the entire deliverable deleted, green. It then removed `{exit}` from the phone bar alone and passed 327 tests — a phone build with navigation and no way to sign out. Both mutations were re-run after the patches and now fail by name.

**KEEP — must survive any re-derivation.**
- **Assert placement, never counts.** Counting `<Link>` and `<Button>` occurrences in source proves a control was declared, not that it was rendered where a person can reach it. Both demonstrated holes were counting passing for placing.
- **The layout's mount of the chrome is itself an assertion.** A component registered by identity says which function runs, never what it renders.
- **The query cache is cleared on the revoked path.** A client-side navigation keeps one `QueryClient` alive, so on a shared device the next person inherits the previous member's role and organization until a refetch settles.
- **`isError` is a state, not an absence.** Deriving everything from `data` makes a rejected query indistinguishable from a member with no access — the one outcome this story forbids.
- **The exit survives collapse.** An exit inside the collapsible region is an application a tablet user cannot leave.
- **A revoked session that fails to navigate is not a failed sign-out.** Telling someone their sign-out failed when the session is gone is the mirror of the lie the module exists to prevent.
- `aria-current` is pinned to the ARIA closed set, because a global allowlist entry justified by a closed vocabulary must enforce that vocabulary.

**Recorded disagreements, both argued in code rather than silently applied.** The three role failure codes still share one message, because the frozen matrix requires the unrecognised row to report "the same reported state" — splitting it would renegotiate frozen text. And the exit's accessible name stays stable under `aria-busy`/`disabled` rather than changing mid-press, because a name that changes under the pointer is one voice control can no longer be told to press.

**Sign-out scope.** `signOut` uses supabase-js's default `global` scope, revoking refresh tokens on every device rather than this one. Deliberate for a shared shift-work deployment, and recorded here because it was never written down: a member signing out of a station tablet is also signed out on their phone.

**Known-bad state avoided.** An application whose entire navigation and only exit could be deleted by one edit with the suite green; a phone build with no way to sign out; a shared device serving the previous member's destinations and the previous organization's snapshot to the next person; a tablet session that cannot be left once the menu is collapsed; an empty navigation bar with no message, indistinguishable from having no access; and a person told their sign-out failed while their session was already gone.

## Design Notes

**Why the role is read and not claimed.** Adding `member_role` to the access-token hook would save a query and cost the guarantee `0003` was built around: role read fresh on every evaluation, so a demotion takes effect on the next query rather than at token expiry. A token-carried role would leave a demoted admin looking at admin navigation that refuses on contact — the interface disagreeing with the database, which is the one thing the access-control design refuses to allow. The read is cheap and cached under one key.

**Why no primitive is scaffolded.** Sheet, Sidebar, Tabs, Tooltip and Separator are all absent, and so are their Radix packages — four new runtime dependencies in a deliberately pinned stack. None is needed: the tab bar is a `<nav>` of `<Link>`s, the sidebar is an `<aside>` with a toggle, and collapse is in-layout rather than an overlay because nothing is persisted. If a genuine need for a dialog primitive appears, that is an Ask First moment, not a default.

**Why the label is imperative.** Every action in the application is second person singular imperative — `Spremi`, `Odustani`, `Odaberi sliku`. Destination labels are nouns because they name places; the exit is an action, so it takes the verb form. This also means the shipped literal is not the noun `Odjava`, which is exactly why `NAVIGATION_AND_TERMINOLOGY`'s entry for it would not have caught a mistake here.

## Verification

**Commands:**
- `nvm use && node -v` — expected: `v24.19.0`. Confirm rather than assume.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — expected: all exit 0, no skips, counts above the 1050/612/4 baseline. Build precedes test.
- `git diff --stat apps/web/package.json` — expected: empty. No dependency is added by this story.
- Mutation probes — each must fail the suite: render `DESTINATIONS` instead of `destinationsFor(role)` so a member sees admin destinations; drop `aria-current` from the active entry; return an empty destination list for an unrecognised role instead of reporting it; remove `h-11` from a navigation control; drop the already-signed-in redirect from one of the two sign-in routes.

## Suggested Review Order

**The role, read fresh and narrowed honestly**

- Start here: the read is a lookup with an unrecognised branch, never a cast.
  [`role.ts:173`](../../apps/web/src/navigation/role.ts#L173)

- One column, bounded at two rows, so a widened policy is visible rather than silent.
  [`role.ts:221`](../../apps/web/src/navigation/role.ts#L221)

- A malformed row is a service fault, not a permission level nobody has heard of.
  [`role.ts:101`](../../apps/web/src/navigation/role.ts#L101)

**The three states the bar can be in**

- `isError` is the third state; deriving from `data` alone renders "no access" for a crash.
  [`chrome.tsx:123`](../../apps/web/src/navigation/chrome.tsx#L123)

- The refusal takes focus, so a phone user is not told something off-screen.
  [`chrome.tsx:145`](../../apps/web/src/navigation/chrome.tsx#L145)

- And it clears on navigation, instead of masking the next failure through `??`.
  [`chrome.tsx:155`](../../apps/web/src/navigation/chrome.tsx#L155)

**Leaving, which is what the story is for**

- Past this line the session is gone, so a failed navigation is not a failed sign-out.
  [`chrome.tsx:196`](../../apps/web/src/navigation/chrome.tsx#L196)

- The cache goes with the session; the next person on this device inherits nothing.
  [`chrome.tsx:207`](../../apps/web/src/navigation/chrome.tsx#L207)

- A refusal leaves the session intact, which is why both failures are one answer.
  [`sign-out.ts:78`](../../apps/web/src/supabase/sign-out.ts#L78)

**The chrome itself**

- The exit sits outside the collapsible region: a collapsed menu is not a trap.
  [`chrome.tsx:362`](../../apps/web/src/navigation/chrome.tsx#L362)

- Active by path or its descendants, so nesting in epic 3 does not silence the signal.
  [`destinations.ts:129`](../../apps/web/src/navigation/destinations.ts#L129)

- `aria-current` plus a treatment that is not colour, driven off the same attribute.
  [`chrome.tsx:277`](../../apps/web/src/navigation/chrome.tsx#L277)

**Proof — the two holes a reviewer opened and walked through**

- The layout's mount is asserted; reverting it to a bare outlet was once 1055-green.
  [`prijava.test.ts:799`](../../apps/web/src/routes/prijava.test.ts#L799)

- Both bars must contain both things: counting declarations proved neither.
  [`prijava.test.ts:849`](../../apps/web/src/routes/prijava.test.ts#L849)
