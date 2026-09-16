---
title: 'Story 1.4a — the organization settings surface'
type: 'feature'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'b28a59eb6ac090be5ba449c81cbb540f11dbf7b3'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The organization row is the frame every later surface resolves against, and nothing can change it. RLS on `organizations` carries a SELECT policy and no UPDATE policy, so a write matches no policy and is refused for every role — `0003:270-273` says so in a comment and names this story as the surface that fixes it. `/organizacija` renders one heading. No screen in the application reads a table at all, and `format.ts` requires a timezone argument that has no source: `deferred-work.md:39` records "1.4 supplies the value, tests pass a literal".

**Approach:** An admin-only settings surface at `/organizacija` reads and writes the organization row through the first real data path in the application — TanStack Query over PostgREST, under a new admin-scoped UPDATE policy — and publishes the organization's timezone as the single value every date and time renders against.

## Boundaries & Constraints

**Always:**
- Migration `0004`, forward-only (`0003:1-5`). The UPDATE policy copies `members_update_by_own_active_admin` (`0003:331-351`): identical `USING` and `WITH CHECK`, the JWT claim ANDed with `current_member_access()` requiring `is_active` and `member_role = 'admin'`, so a row can neither be written by a member nor moved between tenants.
- One snapshot, one query key. The surface reads the organization once through a canonical snapshot type and narrows by selection; two figures on a screen never come from two reads (`ARCHITECTURE-SPINE.md:133` — independent keys are what produce a stale total beside a fresh one).
- The organization's `timezone` is the only source for rendering. `format.ts` stays import-free and its `timeZone` parameter stays required and positional.
- A refused save names the problem and keeps every entered value (UX-DR34).
- Every new Croatian string clears three gates in the same commit: `SANCTIONED_KEYS` equality, the per-file key count plus set equality, and the voice sweeps.
- `Spremi` and `Odustani` are banned from the built chunk today. This story earns them and moves them into `AUTHORED_VOCABULARY`, exactly as the navigation shell earned its six words.

**Ask First:**
- Any change to `format.ts`'s exported signatures, or adding a second locale resource file.
- Any policy on `organizations` beyond the admin UPDATE.
- Any read of a table other than `organizations`.

**Never:**
- No locale control (human decision, 2026-09-15). Only `hr` ships, and a control that changes nothing is not shipped.
- **No slug editing.** `slug` is the domain part of every issued sign-in address (`address.ts`, AD-12); changing it would refuse every existing credential.
- No logo, no accent, no storage bucket — that is part B, recorded in `deferred-work.md`.
- No `destructive` token anywhere on this screen; it is reserved for an unresolved conflict (UX-DR4).
- No INSERT or DELETE on `organizations` from the SPA — provisioning is an operator task.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin saves | Active admin edits name, type, timezone, leave year | Row updated; snapshot refetched; values persist across reload | N/A |
| Member-role writes | `member_role` session PATCHes `organizations` | Refused by policy — no row matched, row unchanged | Surface offers no control; API refusal is the real gate |
| Cross-organization write | Admin of `zastita-split` targets the `dvd-kastel-novi` id | No row matched, row unchanged | Fails closed, identically via UI and direct API |
| Deactivated admin | Banned account with a still-valid token | Refused — `current_member_access()` reads `is_active` fresh | Loses access on next query, not at token expiry |
| Blank name | `'   '` | Refused by the `btrim(name) <> ''` check | Message names the field; entered values kept |
| Leave-year day out of range | day `30` | Refused — the column admits 1–28 by shape | Control cannot express the value |
| Foreign device timezone | Viewer in `Pacific/Kiritimati` | Every rendered date and time uses the organization's zone | N/A |

</frozen-after-approval>

## Code Map

**Baseline `b28a59e`**, green: **959 root / 449 web / 4 domain**, 0 skipped. `nvm use` first (Node 24.19.0) — the nvm v20 bin sits ahead of it in `PATH`, so verify `node -v` rather than trusting `nvm use`. `pnpm test` never builds, and `localization-applied.test.ts` **fails** rather than skips on a stale build — so `pnpm build` before `pnpm test` whenever a file in `SOURCES` or `hr.json` changes.

### Database

- `0003:270-273` — the comment reserving this write path for this story. `:274-284` — `organizations_select_own_organization`; the read already works, only the write is missing.
- `0003:331-351` — `members_update_by_own_active_admin`, the template to copy. `:107-120` — `current_member_access()`, `security definer stable`, returns `(organization_id, member_role, is_active)`, granted to `authenticated` only. `:181-206` — the access-token hook; a user with no member row loses the claim entirely, fail-closed.
- **Row scope is not column scope.** A policy constrains which rows a statement may touch and never which columns, and the default grant gives `authenticated` UPDATE on all thirteen. The frozen **Never** ("no slug editing") is therefore only enforceable as a column grant: `revoke update on public.organizations from authenticated`, then `grant update (name, organization_type, timezone, leave_year_start_month, leave_year_start_day)`. Proven necessary in review — an admin PATCHing `slug` returned `rowCount 1` against the policy alone.
- `0002:58-112` — the `organizations` columns. `:70-71` slug (DNS label, **never editable**), `:87` `organization_type` free text and inert by contract, `:93` `timezone`, `:98` `locale`, `:105-106` leave-year month/day where day ≤ 28 is enforced by shape rather than validation.

### RLS tests — copy these harnesses

- `test/rls-isolation.test.ts` — `tokenFor` `:267-290` (real ES256 via password grant), `rest` `:300-313`, `restRefusal` `:329-336`, `actAs` `:349-363` (in-transaction claims injection), `inRolledBackTransaction` `:182`, `organizationId` `:396`.
- Patterns to mirror: `:903-937` (member-role PATCH refused, row re-read to prove it) and `:1008-1062` (admin PATCH succeeds in own org, cross-tenant is a no-op). The claims-injection variants begin `:1191`. An `organizationById` reader is the one helper missing.
- Fixtures — `seed.sql`: `dvd-kastel-novi` `:44-60` with admin `ivan.maric` `:77-83`; `zastita-split` `:152-168` with admin `josip.peric` `:184-186`; shared password `:27`.

### Frontend

- `routes/organizacija.tsx:28-39` — the placeholder. It nests under `appLayoutRoute`, so the session guard already applies; do not add one here.
- `routes/prijava.tsx:64-227` — the only real form. Uncontrolled `useRef` inputs `:68-69` are what keep values through a refusal; submit `:78-131`; the error is a plain `<p role="alert">` `:216-224` using border/text tokens, never `destructive`. shadcn `Card`/`Input`/`Label`/`Button`, each control carrying `className="h-11"`.
- `supabase/client.ts:155-163` — memoized client, built on first use; `:48` `SUPABASE_ENVIRONMENT_MISSING` throws there, not at module load.
- `sign-in.ts:55-58` — `signInMessageKey`, the edge pattern: a code maps to an i18n key inside a `.ts`, consumed at `prijava.tsx:203`. Screens hold no literals, so every new failure code needs its own mapper.
- `main.tsx:31-38` — `StrictMode` > `I18nextProvider` > `RouterProvider`. The `QueryClientProvider` goes here.
- **Nothing calls `.from()` anywhere in `apps/web/src`, and no organization-snapshot type exists.** This story writes both for the first time; `@tanstack/react-query` is not yet a dependency (spine pin `5.102.8`, peers `react: ^18 || ^19`, verified installable).

### i18n

- `format.ts:131-174` — the six zoned entry points, `timeZone` required and positional on each; `:27-32` the import-free rule; `:43` `LOCALE = 'hr'`.
- `format.test.ts:527-608` — the foreign-zone proof, run in a **child process** under `TZ=Pacific/Kiritimati` because the formatters are memoized; `:762-800` scans that every zoned signature declares `timeZone: string` with no `?` and no default.

### Gates a new string and a new screen clear

- `resource-hygiene.test.ts:46-79` `SANCTIONED_SCREEN_KEYS`, `:82`/`:151-155` the equality assertion, `:196-203` no `!`, `:205-213` no `smjen`, `:215-223` en dash for ranges.
- `localization-applied.test.ts:48-95` `SOURCES` (`organizacija.tsx` already at `:94`; **add every new file**), `:149-160` the freshness guard that fails on a stale `dist`, `:347-371` `AUTHORED_VOCABULARY` exact-count equality, `:377-385` `NAVIGATION_AND_TERMINOLOGY` — where `Spremi` and `Odustani` are banned and must move out of.
- `prijava.test.ts:108-131` `SCREENS` with `expectedControls` (`organizacija.tsx` is currently `0` via the `DESTINATION_SCREENS` spread `:123` — give it the real count or the 44px sweep asserts nothing), `:466-481` `KEY_SOURCES` per-file exact key counts (currently `strings: 1`), `:587-613` rendered-vs-declared set equality both directions, `:649-670` the 44px floor, `:1156-1163` `destructive` absence, `:701-735` label binding, `:737-820` `aria-describedby`.
- **Gotcha with teeth:** `buttonElements` `:379` matches `/<Button\b([^>]*?)\/?>/g`, and `[^>]*?` stops at the first `>`. An inline arrow function (`onClick={() => …}`) placed **before** `className` truncates the attribute block, and the height check then silently passes while asserting nothing. Keep `className` ahead of any arrow-function attribute. Attribute order otherwise does not matter — `not-found.tsx:34` puts `asChild` first and is fine.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0004_organization_settings.sql` — add `organizations_update_by_own_active_admin`, modelled on `0003:331-351`, with identical `USING` and `WITH CHECK`. Comment why no INSERT/DELETE policy accompanies it.
- [x] `test/rls-isolation.test.ts` — add an `organizationById` reader and the four policy cases: admin succeeds in own org, member-role refused, cross-tenant no-op, deactivated admin refused. Cover both the real-token and claims-injection harnesses, mirroring `:903-937` and `:1008-1062`.
- [x] `apps/web/package.json` — add `@tanstack/react-query` at the spine's pinned `5.102.8`.
- [x] `apps/web/src/main.tsx` — wrap `RouterProvider` in `QueryClientProvider`, preserving the existing `bootLocalization` gate.
- [x] `apps/web/src/organization/snapshot.ts` — the canonical organization snapshot: its type, the single query key, the read, and the update. Pure of JSX so the node suite executes it, following `sign-in.ts`'s injected-client shape rather than importing the client.
- [x] `apps/web/src/organization/snapshot.test.ts` — execute the read, the update and every refusal code against an injected fake client.
- [x] `apps/web/src/organization/messages.ts` — map each failure code to an i18n key, as `signInMessageKey` does at `sign-in.ts:55-58`.
- [x] `apps/web/src/i18n/locales/hr.json` — the settings keys: one label per editable field, the save and cancel actions, and the refusal messages. No separate heading key: the `<h1>` renders `nav.organizacija`, the destination's own label, because a second key would author the same word twice and leave `nav.organizacija` rendered by nothing, breaking the rendered-equals-declared set assertion.
- [x] `apps/web/src/routes/organizacija.tsx` — replace the placeholder with the admin form, copying `prijava.tsx`'s uncontrolled-ref structure so a refusal keeps values.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` — extend the three gate files in the same commit: sanctioned keys, `SOURCES`, `AUTHORED_VOCABULARY` (moving `Spremi`/`Odustani` out of the ban list), `SCREENS` control count, `KEY_SOURCES` count.

**Acceptance Criteria:**
- Given an organization whose timezone is `Europe/Zagreb` and a viewer whose device is in another zone, when any date or time is displayed, then it renders in the organization's zone (CAP-2, L8).
- Given two organizations identical but for `organization_type`, when their output is produced, then it is byte-identical, because type is inert (CAP-2).
- Given an admin who edits a field and a save that the database refuses, when the refusal returns, then the surface names the problem and every entered value is still present (UX-DR34).
- Given the settings surface, when it renders, then every figure on it comes from one snapshot under one query key, and no second read exists.

## Spec Change Log

### 2026-09-16 — iteration 0, three adversarial layers, no loopback

**Triage deviation, recorded deliberately.** Two findings had spec-level root causes and would normally route to `bad_spec` and a revert-and-re-derive. They were routed to `patch` instead, following the precedent `spec-1-3b` set and for the same reasons: every fix is additive and local, the architecture the spec asked for held up under all three layers, and the work had been verified against a live database whose evidence a re-derive would discard. Re-deriving roughly 1,229 lines to reach a missing `revoke` and a misplaced JSX node was disproportionate to the defect.

The two root causes were amended in the non-frozen sections rather than left to be rediscovered:
- The Code Map now states that a policy constrains rows and never columns, so the frozen **Never** on slug editing is only enforceable as a column grant. The spec had said "no slug editing" and the implementer reasonably read it as "ship no control".
- The Tasks entry for `hr.json` claimed a heading key. The implementation deliberately ships none, because a second key would author the same word twice and leave `nav.organizacija` rendered by nothing, breaking the rendered-equals-declared set assertion. The task now records that reasoning.

**KEEP — must survive any re-derivation.**
- Reading a policy refusal out of an **empty row set**, not out of `error`. PostgREST answers a refused write with zero rows and no error, so checking `error` alone reports every refused save as saved. The positive-control test that proves a permitted write actually writes is part of this: a policy that refuses everything produces the identical signature.
- The injected-table seam in `snapshot.ts`, which is what puts the whole read/write matrix in the node suite despite AD-15 banning jsdom. Every later data module should copy it.
- Uncontrolled `useRef` fields with `defaultValue`, so a refused save keeps every entered value (UX-DR34), matching `prijava.tsx`.
- Splitting the destination sweeps into seven placeholders plus one built screen, with a no-overlap cross-check — the shape every later story that builds out a placeholder will need.

**Known-bad state avoided.** An admin rewriting `slug` through a direct API call and refusing every issued credential in their own tenant, while the SPA's absent control was the only thing preventing it; a refused or failed read showing an indefinite skeleton with the refusal computed and rendered by nothing; schema drift telling an entitled admin they lack permission; and a settings form that could lose `setFailure` or `setPending` with the suite green, on the one screen most exposed to UX-DR34.

## Design Notes

**Why TanStack Query lands here rather than in 1.5.** This is the first table read in the application, so whatever shape it takes becomes the pattern every later surface copies. The spine already pinned Query `5.102.8` and already decided the rule it exists to enforce — one snapshot per surface, because independent keys are precisely what put a stale total beside a fresh one (`ARCHITECTURE-SPINE.md:133`). Story 1.5 needs caching and invalidation for a member list at several hundred rows, so deferring means building the first data path twice. Human decision, 2026-09-15.

**Why there is no locale control.** `LOCALE` is a hard-coded constant (`format.ts:43`), and the resource tree is typed as `typeof hr` (`index.ts:100-106`) — single-locale by construction. An editable field whose value changes nothing on screen is the kind of dead control the voice rules exist to prevent, and no acceptance criterion tests locale. The column stays as provisioning set it. L3 is preserved: when a second resource file lands, wiring it is that story's work. Human decision, 2026-09-15.

**Why the slug is not editable.** AD-12 builds every member's sign-in address as `username@slug.shift.invalid`, and `0002:61-69` records that the slug is stored rather than derived precisely because transliterating a name is not reproducible. Editing it would silently refuse every existing credential in the organization — the same class of failure as the malformed-slug trap 1.3b resolved.

**The Ask First gate on `format.ts` was triggered and resolved.** Closing the timezone finding needed a validator, and `format.test.ts` scans that `Intl` is constructed in exactly one module — so it had to be `format.ts`. One export was added, `isRenderableTimeZone(timeZone: string): boolean`; no existing signature changed, the module still imports nothing (so the child-process foreign-zone proof still loads it by bare file URL), and it joins `ZONED_ENTRY_POINTS` so its `timeZone` argument stays required and positional like its six neighbours. Accepted by the human, 2026-09-16.

**Why the form is uncontrolled.** `prijava.tsx:68-69` uses refs rather than state so a refused submit keeps what the user typed. A settings form has more fields and therefore more to lose, so the same shape applies rather than a controlled rewrite.

## Verification

**Commands:**
- `nvm use && node -v` — expected: `v24.19.0`. The nvm v20 bin precedes it in `PATH`; confirm rather than assume.
- `pnpm install` — expected: exit 0, `@tanstack/react-query 5.102.8` resolved.
- `supabase db reset` — expected: exit 0, `0004` applies, seed loads both fixtures.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — expected: all exit 0, no skips, root/web/domain counts above their baseline of 959/449/4. Build precedes test because `localization-applied.test.ts` fails on a stale `dist`.
- Mutation probes — expected: each fails the suite. Drop the `member_role = 'admin'` clause from the new policy; render a second read beside the snapshot; hard-code a timezone literal in the screen; put an arrow-function attribute before `className` on the save button and confirm the 44px sweep still catches the control.

## Suggested Review Order

**The write path, and what actually constrains it**

- Start here: the policy picks the row, and says why a member or another tenant cannot.
  [`0004_organization_settings.sql:58`](../../supabase/migrations/0004_organization_settings.sql#L58)

- The half a policy cannot express: rows are not columns, so the grant pins slug out of reach.
  [`0004_organization_settings.sql:126`](../../supabase/migrations/0004_organization_settings.sql#L126)

- Identity is pinned in both clauses, so a row can never move tenant.
  [`0004_organization_settings.sql:70`](../../supabase/migrations/0004_organization_settings.sql#L70)

**The data path every later surface will copy**

- A refusal is zero rows and no error; reading `error` alone would call it success.
  [`snapshot.ts:328`](../../apps/web/src/organization/snapshot.ts#L328)

- Bounded at two rows, not one, so a widened policy fails loudly instead of invisibly.
  [`snapshot.ts:353`](../../apps/web/src/organization/snapshot.ts#L353)

- Refuses an unknown zone before it can reach the table and break every later render.
  [`snapshot.ts:384`](../../apps/web/src/organization/snapshot.ts#L384)

- The table is injected, which is what puts the whole matrix in the node suite.
  [`snapshot.ts:137`](../../apps/web/src/organization/snapshot.ts#L137)

- One key, declared once; two figures never come from two reads.
  [`snapshot.ts:48`](../../apps/web/src/organization/snapshot.ts#L48)

- The value story 1.4 exists to supply; its first consumer is a later story.
  [`snapshot.ts:267`](../../apps/web/src/organization/snapshot.ts#L267)

**The surface**

- One read under one key, and no second read anywhere on this screen.
  [`organizacija.tsx:83`](../../apps/web/src/routes/organizacija.tsx#L83)

- A save's refusal outranks a read's: it is what the person is waiting to hear.
  [`organizacija.tsx:92`](../../apps/web/src/routes/organizacija.tsx#L92)

- The alert sits outside the snapshot gate, so a refused read is not an endless skeleton.
  [`organizacija.tsx:328`](../../apps/web/src/routes/organizacija.tsx#L328)

- Skeleton only while genuinely pending; loading and failed no longer look identical.
  [`organizacija.tsx:183`](../../apps/web/src/routes/organizacija.tsx#L183)

- Uncontrolled fields, so a refused save keeps every entered value.
  [`organizacija.tsx:175`](../../apps/web/src/routes/organizacija.tsx#L175)

- Codes map to keys in a `.ts`; screens hold no literals.
  [`messages.ts:35`](../../apps/web/src/organization/messages.ts#L35)

**Wiring**

- The cache lives inside the localization gate it must not outlive.
  [`main.tsx:58`](../../apps/web/src/main.tsx#L58)

- The validator belongs here because this is the only sanctioned `Intl` site.
  [`format.ts:150`](../../apps/web/src/i18n/format.ts#L150)

**Proof**

- The write path proven over both harnesses, against both fixtures.
  [`rls-isolation.test.ts:1484`](../../test/rls-isolation.test.ts#L1484)

- Grants asserted as an exact set, so a later `grant all` fails loudly.
  [`rls-isolation.test.ts:1691`](../../test/rls-isolation.test.ts#L1691)

- The I/O matrix executed against an injected client, no database required.
  [`snapshot.test.ts:245`](../../apps/web/src/organization/snapshot.test.ts#L245)

- The zone follows the snapshot, and type stays inert.
  [`snapshot.test.ts:403`](../../apps/web/src/organization/snapshot.test.ts#L403)

- In-flight and refusal sweeps now run per form screen, not just sign-in.
  [`prijava.test.ts:944`](../../apps/web/src/routes/prijava.test.ts#L944)
