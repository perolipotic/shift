---
title: 'Story 1.5a — the member list at scale'
type: 'feature'
created: '2026-09-17'
status: 'done'
review_loop_iteration: 1
baseline_commit: '421be67517698a48b63321128f5d64e868514deb'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `Ljudi` is an admin destination that renders one heading. An admin cannot see who is in their organization, and story 1.5's scale clauses (Q20 several hundred members, Q16 no horizontal page scroll) are today honoured only by an index comment — `0002_organizations_and_members.sql:141-148` names story 1.5 as the story that grows the fixture to that size, and no test anywhere measures it.

**Approach:** Build `/ljudi` as the read surface: one organization-scoped snapshot of `members`, searched by name and email, sorted by any column, filtered by permission level, scrolling inside its own container. The screen becomes the first role-guarded route in the tree. Creating and editing members is split out and deferred — this story renders rows it does not write.

## Boundaries & Constraints

**Always:**
- One snapshot under one query key (AD-13), read through an injected structural table seam exactly as `navigation/role.ts:150-152,221-224` and `organization/snapshot.ts:343-346` do — validated field by field, never cast.
- Every row's `organization_id` is selected, and an answer spanning more than one organization fails closed with a code rather than rendering — which is what a widened policy produces. Proving each row is the *caller's* own would need a second source of truth for the caller's organization, which the Ask-First rule below forbids on this surface; the database stays the enforcement point (AD-10) and this is a client-side tripwire, not a boundary. RLS refusal is zero rows, not an error.
- `/ljudi` refuses a `member_role` session at the route and forwards it to its first destination, reusing the forwarding the root route already established.
- Every user-facing string resolves through `t()`; every count uses ICU's three Croatian forms; every control clears the 44 px floor.
- The table owns its horizontal overflow (`DESIGN.md:150` names the member list explicitly). The page body never scrolls sideways at any width.
- shadcn's `Table` is vendored unrestyled (`DESIGN.md:117`). **No dependency is added**: search, sort and filter are pure functions, which leaves `@tanstack/react-table` nothing to do here. `ARCHITECTURE-SPINE.md:218`'s 9.2.4 pin stands as the version decision for whichever story first has a use for it (human decision 2026-09-17, after the install shipped and imported nowhere).

**Ask First:**
- Any change to `members`' schema, policies or grants. This story reads; it adds no migration.
- Any second read on the surface, or any query key beyond the one this spec names.
- Growing `supabase/seed.sql` itself, rather than generating scale rows inside the test that needs them.

**Never:**
- No create, edit, delete, password reset, or any call to `admin-auth` — that is the deferred half, and `handler.ts:195` stays at `501`.
- No team column, filter or sort: `members` carries no `team_id` and teams arrive in story 1.7. No hours column: epic 4. No active/inactive treatment: story 1.6 versions that state.
- No word containing the stem `smjen` (banned, `resource-hygiene.test.ts:365-372`) and no `Nema` — an empty result states a count, never an absence (UX-DR20).
- No spinner on the surface, no colour as the only signal, no dense grid without hierarchy (`EXPERIENCE.md:140`).
- No `Intl` access outside `i18n/format.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin opens the destination | admin session, N members | every member of that organization renders; the stated count is N | N/A |
| A member-role session opens `/ljudi` | valid session, role `member_role` | redirected to its first destination before the component is asked for | N/A |
| Search narrows to nothing | query matching no member | headers stay, count renders as `0` stated positively | N/A |
| Search spans diacritics | `Maric` against `Marić` | the row matches; ordering is Croatian-collated | N/A |
| Policy returns zero rows | valid session, RLS refuses | `MEMBERS_REFUSED` alert, no empty table pretending success | refusal code, never a throw |
| A row from another organization appears | policy widened past isolation | `MEMBERS_UNAVAILABLE`, nothing rendered | fail closed |
| Transport rejects | network or environment failure | `MEMBERS_UNAVAILABLE` alert | caught, code logged, no blank screen |
| Several hundred members | 400+ rows in the fixture | one range scan; the read clears Q17's two-second budget | measured, not assumed |

</frozen-after-approval>

## Code Map

**Baseline `421be67`**, green: **1236 root / 772 web / 4 domain**, 0 skipped, `pnpm build` exit 0. `nvm use` first (Node 24.19.0). `pnpm build` before `pnpm test`: `localization-applied.test.ts:202-211` and `theme-applied.test.ts:39-58` **fail** rather than skip on a stale `dist/`.

### What exists to copy

- `navigation/role.ts` — the seam to mirror exactly: `MEMBERS_TABLE` `:46`, `MEMBER_ROLE_KEY` `:57`, narrow `MemberTable` `:150-152`, session reader injected as a parameter `:221-224`, `.limit(ONE_ROW + 1)` to catch a widened policy `:246`, zero rows → `MEMBER_ROLE_REFUSED` rather than a throw, values validated against a literal array `:162,173`.
- `organization/snapshot.ts` — `ORGANIZATION_SNAPSHOT_KEY` `:49`, `ORGANIZATION_COLUMNS` `:92-93`, `outcomeOf` `:544-557` mapping PostgREST error / zero rows / too many rows to codes, `organizationSnapshotOf` `:404-447` field-by-field guards.
- `routes/organizacija.tsx` — the surface shape: one `useQuery` `:185-188`, `refusal` preferred over read failure `:194-195`, `h-11 animate-pulse rounded-md bg-muted` skeletons (hand-rolled — there is no `Skeleton` primitive and this story adds none), a single always-mounted `role="alert"` paragraph `:790-798`, `<main className="flex flex-1 justify-center p-6">` `:768-770`.
- `navigation/chrome.tsx:501-536` — the only "wide content scrolls in its own container" precedent: `min-w-0 flex-1` outer, `overflow-x-auto` scroller, `shrink-0` children.
- `routes/index.tsx` — the signed-in forward to the first destination, which the role guard reuses.

### What does not exist yet

- `components/ui/` holds **only** `button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`. No `table.tsx`. No `<table>` element anywhere in `apps/web/src`.
- `@tanstack/react-table` is **not installed** — pinned at 9.2.4 in `ARCHITECTURE-SPINE.md:218`, never added. It stays uninstalled: this story's search, sort and filter are pure functions and its markup is shadcn's `Table`, so the library has no job here.
- `surfaces/` holds a README and no code.
- No perf or scale test exists anywhere, and no bulk fixture generator.
- `supabase/config.toml:15` sets `max_rows = 1000`. Nothing in the app reads `Content-Range` or paginates, so an answer capped at that ceiling is indistinguishable from a complete one.
- `hr.json` has **no** table, list, search, sort or filter key. `nav.ljudi` `:28` is the only `ljudi` string.

### Data, and what a row may carry

- `members` `0002:115-160`: `organization_id`, `id`, `auth_user_id`, `name`, `email` (nullable), `role` (`admin` | `member_role`), `leave_allowance_days` (smallint), `created_at`. No `team_id`, no active column — active state lives in `auth.users` (AD-2). The four renderable fields are therefore name, email, permission level and leave allowance, and Q5's "no health data, no absence-reason field" is asserted over this column list.
- `members_select_own_organization` `0003:289-300` — double-check isolation: the JWT claim must equal the value re-derived by `current_member_access()`. **No role filter**, by design (`0003:286-288`), which is exactly why the guard below is a route decision and not a data one.
- `seed.sql` — pilot `dvd-kastel-novi` 4 members `:44-136`, security `zastita-split` 3 members `:152-239`; each member is three inserts (`auth.users`, `auth.identities`, `members`) driven by a `do $$ … for … in (values …)` loop.

### Gates this screen must register with

- `routes/prijava.test.ts` — move `ljudi` out of `PLACEHOLDER_SLUGS` `:136-144`; add a `SCREENS` entry `:175-232` with the exact `expectedControls` (the sweep at `:1585-1613` sums inputs + buttons + selects, asserts the count non-vacuously, then checks each against `TARGET_FLOOR_PX = 44`); add a `KEY_SOURCES` entry `:763-833` with the exact `t()` call count; `SCREENS` **stays at 14** — `ljudi` leaving `PLACEHOLDER_SLUGS` removes a derived entry as the built entry arrives, netting zero — while `KEY_SOURCES` goes 17 → 18. A new structural attribute (`aria-sort`) must be named in `STRUCTURAL_ATTRIBUTES` `:384-420`.
- `test/resource-hygiene.test.ts:52-191` — every new leaf key added to `SANCTIONED_SCREEN_KEYS` (exhaustive sorted equality against `hr.json`). `:355-362` fails on any `!`; `:365-372` fails on `smjen`.
- `test/localization-applied.test.ts` — `ljudi.tsx` is **already** in `SOURCES` `:96`; any new module needs adding there. Every new Croatian word joins `AUTHORED_VOCABULARY` `:399-448` with an exact count (build occurrences must equal `hr.json` occurrences). `Nema` is banned at `:506`.
- `eslint.config.js:172-190` — merge-blocking L2: no bare JSX text, no string in a guarded attribute.
- `router.test.ts` pins the `_app` guard as session-only. This story changes that test deliberately; `_app.tsx:41-52` records that the change belongs to whichever story first gives a destination something to hide.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/ui/table.tsx` — vendor shadcn's `Table` wholesale and unrestyled. It already wraps `<table>` in its own `overflow-auto` div: that is the surface's ONE scroll container, and the screen must not nest a second. Vendor only the parts used, or use `TableCaption` for the table's accessible name.
- [x] `apps/web/src/i18n/format.ts` — a locale-aware text comparator, named for what it orders (it sorts addresses as well as names). Only file permitted to touch `Intl`. No dead `?? ''` on an already-`string` value; prose counts must state the module's real export count.
- [x] `apps/web/src/navigation/role.ts` — export `MEMBER_ROLES` in rank order, and pin `MEMBER_ROLES[0]` to the literal `'admin'` in a test. Order is load-bearing for the route guard, so a reorder must fail the suite, not invert the guard silently.
- [x] `apps/web/src/members/list.ts` — `MEMBERS_LIST_KEY`, the column list including `organization_id`, a narrow `MembersTable` seam, `readMembers` returning a discriminated outcome, a validated row mapper. **Detect truncation**: `supabase/config.toml:15` caps PostgREST at `max_rows = 1000`, so ask for an exact count and refuse with `MEMBERS_UNAVAILABLE` when fewer rows arrive than the count claims — a short list rendered as a complete one is the fail-open this module otherwise refuses.
- [x] `apps/web/src/members/list.ts` — **all** screen logic as pure functions, not only the comparators: `nextSortState(current, pressed)` for the toggle, `chooseLevel` for the out-of-vocabulary fallback, and one `narrowMembers(...)` returning the rows to render *and* the per-level counts, so the counts cannot drift from the rows. Search folding covers the precomposed digraphs `ǅ ǆ ǉ ǌ` as well as `đ`. The permission-level label is an exhaustive mapping over `MemberRole`, never a binary ternary that renders an unknown level as `Član`. Pin where an address-less member sorts in **both** directions.
- [x] `apps/web/src/members/list.test.ts` — execute all of the above over several hundred rows, with at least one literal (not symbol-derived) assertion that `'admin'` is the level the guard admits and `'member_role'` is the level it refuses.
- [x] `apps/web/src/routes/ljudi.tsx` — markup only: one query, skeleton rows matching the final layout, the vendored table's own scroller, search input, headers whose sort state carries a **visible** indicator as well as `aria-sort`, a permission-level filter whose labels state counts, a stated row count, one `role="alert"` paragraph. Headers, skeleton cells and body cells derive from ONE `{ key, label }` table so a fifth column is one edit. Memoize the narrowing so a keystroke does not re-fold, re-collate and re-count several hundred rows three times over.
- [x] `apps/web/src/routes/ljudi.tsx` — handle all three query outcomes as `chrome.tsx:198-211` does: `answer.isError` must not render headers with no rows, no count and no message, and a paused fetch must not pulse a skeleton forever with nothing explaining why.
- [x] `apps/web/src/routes/ljudi.tsx` — `beforeLoad` takes its role reader **through the router context, as `currentSession` already is**, so it constructs no client and the node suite can drive it with a real `{ ok: true, role }` outcome. A guard whose decision is reachable only through a source-text match is not verified.
- [x] `apps/web/src/router.test.ts` — drive the guard with `{ ok: true, role: 'member_role' }` and `{ ok: true, role: 'admin' }` and assert redirect / no redirect. It must pass on a fresh clone with no `.env.local`. Amend the pinned session-only assertion, recording why it moved; keep the new constant and its doc comment together so neither orphans the other.
- [x] `apps/web/src/i18n/locales/hr.json` — a `ljudi.*` block shaped like `organization.*`. Every refusal message must be reachable and must not tell a proven admin they lack admin rights.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` — register the screen in all three in the same commit. **Every** new Croatian word joins `AUTHORED_VOCABULARY` with an exact count, error strings included. `SCREENS` stays at 14 (the placeholder entry leaves as the built entry arrives); `KEY_SOURCES` goes to 18. Do not delete the existing plural-key coverage without replacing it.
- [x] `test/rls-isolation.test.ts` — the list read over both fixtures. The scale fixture must key follow-up inserts off the ids it just generated, never re-select by domain (which adopts foreign rows), clean up in a `finally` rather than only at file scope, and assert the other fixture's member count exactly rather than "fewer than 400".

**Acceptance Criteria:**
- Given an organization with several hundred members, when an admin opens `Ljudi`, then every member of that organization renders and no member of any other organization does.
- Given an answer the transport truncated below the organization's real size, when it is read, then the surface refuses rather than presenting a short list as a complete one.
- Given the list at any viewport width down to a phone, when the table is wider than the screen, then exactly one container scrolls and the page body does not scroll sideways.
- Given a search, sort or filter that matches nothing, when it is applied, then the count renders as zero as a stated fact and the surface never goes blank.
- Given a `member_role` session, when it navigates to `/ljudi` by URL, then it is forwarded to its first destination and no member data is rendered to it — asserted by executing the guard, not by matching its source.
- Given a sorted column, when a sighted user looks at the table, then which column is sorted and in which direction is visible without a screen reader.
- Given any member record, when its rendered fields are inspected, then they are name, optional email, permission level and leave allowance only — no health data and no absence-reason field.

## Spec Change Log

### 2026-09-17 — iteration 0, three adversarial layers, bad_spec loopback

**Why this looped back rather than patched.** Three of the four findings that mattered were not argued but **demonstrated**: the reviewer mutated the code and the suite stayed green. Swapping `MEMBER_ROLES` to `['member_role', 'admin']` left 852/852 passing and a typecheck at 0 while inverting the route guard — members reading every colleague's address and leave allowance, admins forwarded away. Widening the guard to `mayReadMembers(outcome) || outcome.ok` stayed green because the guard's only behavioural assertions arrive with no session, where the correct and the broken version both forward; its real decision was pinned by `toContain('mayReadMembers(outcome)')`. Swapping the sort keys on two headers stayed green because the screen's wiring is asserted by reading its own source text. The pure functions were genuinely executed; what was unverified was every call site that used them.

**What was amended.** The spec now requires the guard's role reader to arrive **through the router context** the way `currentSession` already does — which also removes the `supabaseClient()` call from `beforeLoad`, whose synchronous throw made the block depend on a gitignored `.env.local` (without one, a fresh clone goes red on one assertion and vacuous on the rest). All screen logic, not merely the comparators, moves into `members/list.ts` as pure functions — the sort toggle, the level fallback, and one narrowing call returning rows *and* counts so the two cannot drift. `MEMBER_ROLES[0]` gains a literal pin. The read gains truncation detection against `config.toml:15`'s `max_rows = 1000`. The screen gains the third query outcome `chrome.tsx:198-211` already handles, a visible sort indicator alongside `aria-sort`, one scroll container instead of two nested, and one `{ key, label }` table driving headers, skeleton and cells.

**Known-bad state avoided.** A route guard that inverts on a one-line reorder with a green suite; a member list reachable by every member; a truncated list presented as complete with a confidently wrong count; a screen that renders headers, no rows, no count and no message when its query throws; a sorted column no sighted user can identify; a filter promising twelve beside three rows; and a scale fixture that adopts pre-existing throwaway accounts into the pilot organization.

**KEEP — must survive re-derivation.**
- **`members/list.ts` as the seam**, mirroring `navigation/role.ts`: narrow structural table parameter, discriminated outcome, field-by-field validation and never a cast, RLS zero-rows as a refusal rather than a throw. This was right and the tests over it were real.
- **The diacritic fold, including `đ`**, which NFD leaves untouched — the one case a naive `normalize('NFD')` misses. Extend it to the digraphs; do not rewrite it.
- **`compareNames` living in `format.ts`** as the only `Intl` site in the app. Rename it for what it orders; keep the location.
- **The guard forwards to `DESTINATIONS[0]` with `replace: true`**, reusing the root route's forwarding rather than inventing a second destination policy.
- **`SCREENS` stays at 14 and `expectedControls` is 3** — both were reasoned correctly against source-level detectors and against `PLACEHOLDER_SLUGS` losing an entry as the built entry arrives. The earlier instruction to bump 14 → 15 was wrong and is corrected above.
- **The RLS fixture's throwaway-prefix-and-clean-up convention**, which verifiably restored both fixtures to 4 and 3.
- **The two human decisions of 2026-09-17**: no dependency is added, and the isolation check is a client-side tripwire rather than a boundary. Neither is reopened by this loopback.

**Recorded disagreement.** The Q17 two-second budget is a wall-clock comparison over one local round trip. It is kept because `ARCHITECTURE-SPINE.md:337` asks for scale to be measured rather than assumed, but it is a flake vector rather than a property of the read, and it observes no index. If it proves noisy it should become a deferred entry rather than a loosened threshold.


## Design Notes

**Why a route guard is a new decision and not a contradiction of AD-10.** AD-10 puts isolation and role in the database, and it still does — the guard protects nothing against a direct API call, and this spec adds no policy pretending otherwise. What the guard settles is an IA requirement: UX-DR31 gives the member role no configuration surface at all, and `Ljudi` is grouped configuration under UX-DR32. The member-facing view of people is story 1.8's team detail, which epic context scopes to names and membership only. Without the guard, `/ljudi` would hand every member their colleagues' emails and leave allowances — a superset of what 1.8 is allowed to show, reachable by typing a URL. `_app.tsx:41-52` predicted this exact moment and asked that the story change the test rather than rediscover the paragraph.

**Why the guard reads the role outside the query cache.** `beforeLoad` runs before the component tree, so the chrome's `MEMBER_ROLE_KEY` entry is not reliably warm. It is one row and one column through the existing `readMemberRole`, and AD-13 governs two figures on a screen coming from two reads — not a guard that renders nothing.

**Why scale rows are generated in the test, not added to `seed.sql`.** `seed.sql` is shared by every suite, and several assertions count fixture members exactly; growing it to Q20 scale would rewrite unrelated expectations and slow every `db reset`. `rls-isolation.test.ts:719` already establishes throwaway-prefixed rows cleaned up in `afterAll`, scoped so that pointing the suite at a real database is safe. The index comment at `0002:141-148` asks story 1.5 to prove the scale, not to enlarge the pilot organization.

**What the isolation check actually proves, and what it does not.** `readMembers` selects `organization_id` and fails closed when an answer spans more than one — which is precisely the shape a widened `members_select_own_organization` produces, and the reason the column is selected at all despite nothing rendering it. It does **not** prove each row belongs to the calling session: that needs the caller's own organization from somewhere, and the only client-side sources are a second read (forbidden above) or decoding the JWT claim, for which this repo has no precedent and which would be weak evidence anyway — a policy wholly replaced can lie consistently to both. AD-10 already places the boundary in the database; this is a tripwire on the client, and the spec says so rather than claiming a guarantee the code cannot deliver. Human decision 2026-09-17.

**Why filtering is by permission level.** UX-DR17 and UX-DR19 describe filtering by team and member, and neither is buildable here: `members` has no `team_id` until story 1.7. Permission level is the only axis the schema offers today, and the filter's label carries its count per UX-DR19 so the shape those rules describe is already in place when teams arrive.

## Verification

**Commands:**
- `nvm use && node -v` — expected `v24.19.0`. Confirm rather than assume.
- `supabase db reset` — expected exit 0, both fixtures load, no new migration applied.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — expected all exit 0, no skips, counts above the 1236 / 772 / 4 baseline. Build precedes test.
- `git diff --stat package.json pnpm-lock.yaml apps/web/package.json` — expected: **empty**. This story adds no dependency.
- Mutation probes — each must fail the suite: drop `organization_id` from the selected columns; return an empty array instead of `MEMBERS_REFUSED` on zero rows; remove the role guard from `/ljudi`; let the page scroll sideways instead of the table's container; hide the zero count instead of stating it; compare names with `<` instead of the Croatian collator; return rows spanning two organizations without failing closed.
- **The three probes iteration 0 shipped green — each must now fail:**
  - Reorder `MEMBER_ROLES` to `['member_role', 'admin']`.
  - Widen the guard to `mayReadMembers(outcome) || outcome.ok`, keeping the call intact.
  - Swap the sort keys carried by any two column headers.
- `VITE_SUPABASE_URL="" pnpm --filter ./apps/web test src/router.test.ts` — expected exit 0. The guard block must not need a build environment; iteration 0 went red here and vacuous on the rest.

## Suggested Review Order

**Who may see the list**

- Start here: the guard's whole decision, as a pure function a test can execute.
  [`list.ts:460`](../../apps/web/src/members/list.ts#L460)

- Rank order is load-bearing; a reorder inverts the guard, so a literal pins index 0.
  [`role.ts:184`](../../apps/web/src/navigation/role.ts#L184)

- Reads the role through the router context, so it constructs no client and needs no environment.
  [`ljudi.tsx:378`](../../apps/web/src/routes/ljudi.tsx#L378)

- The one binding of the seams to the real client, pinned by identity.
  [`role.ts:353`](../../apps/web/src/navigation/role.ts#L353)

- Drives the guard with real outcomes rather than matching its source text.
  [`router.test.ts:1276`](../../apps/web/src/router.test.ts#L1276)

**What the read refuses**

- Zero rows is a refusal, not an empty organization; a throw becomes a code.
  [`list.ts:354`](../../apps/web/src/members/list.ts#L354)

- A short list presented as complete is the fail-open this refuses.
  [`list.ts:394`](../../apps/web/src/members/list.ts#L394)

- The count that defence depends on, observed once against the real transport.
  [`rls-isolation.test.ts:3735`](../../test/rls-isolation.test.ts#L3735)

**What the screen is not allowed to compute**

- One table carries heading, sort value and cell, so a column is one edit.
  [`list.ts:558`](../../apps/web/src/members/list.ts#L558)

- Takes a cell, never a member — so two columns cannot be swapped here.
  [`ljudi.tsx:146`](../../apps/web/src/routes/ljudi.tsx#L146)

- Query state becomes refusal or loading in a function tests execute.
  [`list.ts:1149`](../../apps/web/src/members/list.ts#L1149)

- Owns the arrow direction, so the visible and announced signals cannot disagree.
  [`list.ts:686`](../../apps/web/src/members/list.ts#L686)

- Memo dependencies derived from the same object the narrowing consumes.
  [`list.ts:1087`](../../apps/web/src/members/list.ts#L1087)

**Narrowing and order**

- Rows and per-level counts from one traversal, so the two cannot drift.
  [`list.ts:998`](../../apps/web/src/members/list.ts#L998)

- Folds every Croatian diacritic, including the ones NFD leaves alone.
  [`list.ts:861`](../../apps/web/src/members/list.ts#L861)
