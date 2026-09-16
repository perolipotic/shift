---
title: 'Story 1.4b — the organization logo'
type: 'feature'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: '7076d5589b4493f2b24105b50b57452348d94d9e'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 1 requires that an organization's branding assets are readable only within the owning organization and that no logo renders a neutral fallback. The repository has no storage subsystem in any form: zero buckets exist, no migration or `config.toml` section mentions storage, and no `<img>`, `<input type="file">` or `.storage` call exists anywhere in `apps/web/src`. `organizations` carries no logo reference. `organizacija.tsx:57-58` names this absence as part B.

**Approach:** Migration `0005` opens the first storage surface — a private bucket, a nullable `logo_path` on `organizations`, and policies on `storage.objects` that scope every object to a folder named for its organization. The existing settings screen gains an upload control and renders the current logo or a neutral fallback, reading presence from the one snapshot it already holds.

## Boundaries & Constraints

**Always:**
- **Every storage policy names `to authenticated`.** `anon` and `authenticated` both already hold full `SELECT, INSERT, UPDATE, DELETE` on `storage.objects` and `storage.buckets`; nothing leaks today only because RLS is on with zero policies. Each policy this story writes is therefore the entire gate, and a policy missing its role clause publishes every tenant's logo to the anonymous world.
- Isolation is the first path segment: an object lives at `{organization_id}/logo`, and every policy ANDs `bucket_id` with `(storage.foldername(name))[1] = organization_id`, taking that id from the JWT claim ANDed with `public.current_member_access()` exactly as `0004:58-78` does.
- **Read and write are different populations.** Any active member of the organization may SELECT the object — the logo is theirs to see. Only an active `admin` may INSERT or UPDATE it. Mirrors `0003:289` versus `0003:331`.
- Presence is a column, not a probe. `logo_path` null means no logo, answered by the snapshot already on screen; no render may ask storage whether an object exists.
- The logo write goes through its own update. The settings form's five fields keep their existing submit path and never send `logo_path`, so saving identity cannot clobber a logo uploaded seconds earlier.
- The upload module takes its storage handle as an injected first parameter, as `sign-in.ts:135` and `snapshot.ts:143-156` do, so every row of the matrix below executes in the node suite (AD-15).
- Every new Croatian string clears the three gates in the same commit: `SANCTIONED_SCREEN_KEYS` equality, per-file key counts plus set equality, and the voice sweeps.

**Ask First:**
- Any change to `format.ts`'s exported signatures.
- Any policy on `storage.buckets`, or any bucket beyond the one this story creates.
- Any new shadcn primitive beyond the four that exist.

**Never:**
- **No `Nema`.** `NAVIGATION_AND_TERMINOLOGY` bans it and the voice rule states the fact rather than the absence, so the fallback is a neutral mark carrying the organization's name as its accessible name — never a sentence announcing that a logo is missing.
- No logo removal. Replacing is upserting the same key; no acceptance clause asks for deletion, and no DELETE policy is written.
- No lockup, no shell tint, no accent. The lockup belongs to the navigation chrome, which does not exist; the accent is part C on the ledger.
- No SVG. `image/png`, `image/jpeg` and `image/webp` only.
- No public bucket, and no service-role key anywhere near this path.
- No `destructive` token on this screen; it stays reserved for an unresolved conflict (UX-DR4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin uploads a logo | 400 KB `image/png` | Object written at `{id}/logo`; `logo_path` set; preview renders after one invalidation | N/A |
| Admin replaces it | Second upload, same organization | Same key upserted; one object, never two | N/A |
| File too large | 4 MB PNG | Refused by the bucket's size limit | Message names the limit; nothing else on the form is lost |
| Wrong type | `application/pdf` | Refused by the bucket's MIME allowlist | Message names the accepted types |
| Member-role uploads | Active member, not admin | Refused — no INSERT policy matches | Surface offers no control; API refusal is the real gate |
| Cross-organization read | Admin of `zastita-split` requests `dvd-kastel-novi`'s object | Refused; no bytes and no signed URL | Fails closed, identically via UI and direct API |
| Anonymous read | No session | Refused — every policy is `to authenticated` | N/A |
| No logo, or a reference that resolves to nothing | `logo_path` null, or set but unreadable | Neutral fallback carrying the organization's name | Never a broken image |

</frozen-after-approval>

## Code Map

**Baseline `7076d55`**, green: **959 root / 449 web / 4 domain**, 0 skipped. `nvm use` first (Node 24.19.0) — the nvm v20 bin sits ahead of it in `PATH`, so verify `node -v`. `pnpm test` never builds and `localization-applied.test.ts` **fails** rather than skips on a stale build, so `pnpm build` before `pnpm test` whenever a file in `SOURCES` or `hr.json` changes.

### Storage — verified against the running local stack, not assumed

- `storage.buckets` and `storage.objects` both have `relrowsecurity = t` with **zero policies** and **zero buckets**. `anon`, `authenticated` and `service_role` each already hold all seven table privileges on both. Deny-all by absence of policy is the only thing holding.
- `insert into storage.buckets` and `create policy on storage.objects` both succeed as the migration role — probed in a transaction and rolled back. **So the bucket comes from migration `0005`, not from `config.toml`**: no `[storage]` section is needed, which avoids both the declarative-bucket question on CLI 2.116.0 and the `stop && start` caveat that `DEPLOY.md:80-90` documents for container-level config.
- `storage.objects.path_tokens` is `string_to_array(name, '/')` stored, and `storage.foldername()` exists. Bucket columns that matter: `public`, `file_size_limit` (bigint), `allowed_mime_types` (text[]).
- `ARCHITECTURE-SPINE.md:341` deferred "storage-level policy detail for branding assets beyond Q4's ownership rule" to the story that builds the upload surface. This is that story.

### Database conventions to copy

- `0004_organization_settings.sql:58-78` — the policy shape: `for update to authenticated`, `USING` and `WITH CHECK` both written out, each ANDing `nullif((select auth.jwt()) ->> 'organization_id','')::uuid` with a subquery over `public.current_member_access()`.
- `0004:111-134` — `revoke update ... from authenticated` then `grant update (cols)`, in that order because column grants union. `logo_path` joins that grant list.
- `0004:11-18` — the convention of commenting *why* an absent policy is absent, naming the requirement and the test that pins it. Do the same for DELETE and for `storage.buckets`.
- `0003:107-123` — `current_member_access()`, `stable security definer`, granted to `authenticated` only (`:146-149`). `0003:187-204` — the hook; the claim is exactly `organization_id`, deleted rather than defaulted when the caller has no member row.
- `0002:58-113` — `organizations`. Nullable columns (`short_name :74`, `description :75`, `address :76`, `contact_email :81`) carry no default and no not-null; `logo_path` follows them. `:38-41` forbids a default that encodes one organization's answer.
- `seed.sql:44-60` / `:152-168` — both fixtures resolve their id by slug lookup, never a literal. Leave both logo-less; that is the fallback case.

### Frontend

- `snapshot.ts:72-85` `OrganizationSnapshot`, `:88-94` `OrganizationEdits`, `:62-63` `ORGANIZATION_COLUMNS` (a comma string), `:48` the single query key, `:143-156` the injected `OrganizationTable` seam, `:328-341` `outcomeOf` — a refusal is `rows.length === 0` with no error, `:353-370` read, `:384-422` update, `:267-269` `organizationTimeZone`.
- `organizacija.tsx:83-86` the query, `:95-158` submit (five refs read synchronously, re-entrancy guard, invalidate at `:142`), `:71-75` the refs, `:198-207` a field's shape, `:175-301` `renderSettings`, `:183-185` the skeleton, `:325-333` the `role="alert"` region outside the snapshot gate, `:66-67` why every control carries `h-11`. Imports at `:5-8` — only `Button`, `Card`, `Input`, `Label` exist in `components/ui/`.
- `messages.ts:35-49` — the five codes mapped to keys; new codes join it.
- `sign-in.ts:78-83` the structural interface, `:24-29` why the client is a parameter. `client.ts:155-163` the memoized client; supabase-js `2.113.0` exposes `.storage`, and nothing calls it today.
- `hr.json:39-54` the `organization.*` group; `index.ts:100-106` types the resource tree as `typeof hr`. `main.tsx:52-59` the provider stack — nothing new is required.

### Gates, and the traps in them

- `resource-hygiene.test.ts:47-115` `SANCTIONED_SCREEN_KEYS`, asserted as sorted set equality both directions at `:190`. `:232-239` no `!`, `:241-249` no `smjen`, `:251-259` en dash between digits.
- `localization-applied.test.ts:48-103` `SOURCES` — **add every new file**; `:56-61` says an omission is guarded by nothing. `:157-168` the freshness guard. `:355-387` `AUTHORED_VOCABULARY`, compared per word by exact occurrence count at `:446-450`. `:397` `NAVIGATION_AND_TERMINOLOGY`, which is where `Nema` is banned.
- `prijava.test.ts:125-154` `SCREENS` — `organizacija.tsx` is `expectedControls: 7` at `:140` and must become the real new count. `:565-592` `KEY_SOURCES` — `organizacija.tsx` `strings: 8` at `:576`, `messages.ts` `strings: 5` at `:577-582`. `:731-739` rendered-vs-declared both directions. `:216` `TARGET_FLOOR_PX = 44`; `:529-541` `heightPx` understands `h-<n>`, `min-h-<n>`, `h-[<n>px]`, `h-[<n>rem]`. `:1475-1479` `destructive` absence. `:830-844` label binding, `:866-899` `aria-describedby`. `:165-199` the in-flight and refusal sweeps 1.4a added.
- **Trap, stated precisely:** `buttonElements` at `:477-478` is `/<Button\b([^>]*?)\/?>/g`, and `[^>]` cannot cross the `>` inside `=>`, so an arrow-function attribute placed before `className` truncates the attribute block. Today this fails **loudly** — every consumer pairs it with `.not.toBeNull()` (`:758,766,774,798`) or a direct equality (`:675`). The danger is a **new** test file that copies `buttonElements` or `heightPx` without also copying that guard. Keep `className` first anyway; no existing `<Button>` does otherwise. The `headingKey` detector at `:462-464` has the same regex shape.
- `:314-341` `STRUCTURAL_ATTRIBUTES` is a **global** allowlist — adding an attribute exempts it on every screen, not just this one.
- `:856-864` iterates `labelTargets` with no non-vacuity assertion in front of it, unlike its sibling at `:831-837`. A new loop must assert its own length first.
- `rls-isolation.test.ts` — `tokenFor :267-290`, `rest :300-313` (**hardcodes `/rest/v1/` at `:308`; a `/storage/v1/` sibling is needed**), `restRefusal :329-336`, `actAs :349-363`, `inRolledBackTransaction :182-191`, `organizationById :464-478`. Every case is `it.skipIf(noDatabase)` / `noApi` — they **skip**, not fail, where no local stack is reachable.
- `snapshot.test.ts:113-145` `answering(answer, log)` and `:149-157` `throwing()`; `:183` `NO_ROW_MATCHED = { data: [], error: null }` is the refusal shape. A storage module's tests copy this: inject the handle, assert the recorded call, model a refusal as an empty successful answer rather than a thrown error.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/0005_organization_logo.sql` — add nullable `logo_path text`; extend `0004`'s column grant to include it; `insert into storage.buckets` a private bucket with `file_size_limit` 2097152 (2 MiB) and `allowed_mime_types` `{image/png,image/jpeg,image/webp}`; add SELECT (any active member), INSERT and UPDATE (active admin) policies on `storage.objects`, each `to authenticated`, each ANDing bucket, folder and claim. Comment why there is no DELETE policy, no policy on `storage.buckets`, and why the role clause is load-bearing.
- [x] `test/rls-isolation.test.ts` — a `/storage/v1/` sibling to `rest`, then the matrix over both fixtures: admin writes own folder; member-role refused; admin of the other tenant refused; anonymous refused; deactivated admin refused. Mirror `:903-937` and `:1008-1062`.
- [x] `apps/web/src/organization/logo.ts` — the injected storage seam: the object path builder, upload, signed-URL read, and a failure code per matrix row.
- [x] `apps/web/src/organization/logo.test.ts` — every matrix row against a fake handle, copying `snapshot.test.ts`'s `answering`/`throwing` shape.
- [x] `apps/web/src/organization/snapshot.ts` — add `logoPath` to the snapshot type, to `ORGANIZATION_COLUMNS` and to the edit columns, so the logo write reuses `updateOrganization` without the form touching it.
- [x] `apps/web/src/organization/messages.ts` — map each new failure code to a key.
- [x] `apps/web/src/i18n/locales/hr.json` — the logo label, the choose action, and the refusal messages. No key announces absence.
- [x] `apps/web/src/routes/organizacija.tsx` — the upload control and the preview-or-fallback, wired to the snapshot already on screen; `h-11` on every control, `className` before any arrow-function attribute.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts` — extend all three in the same commit: sanctioned keys, `SOURCES`, `AUTHORED_VOCABULARY`, `SCREENS` control count, `KEY_SOURCES` counts.

**Acceptance Criteria:**
- Given an organization with no logo, when the settings screen renders, then a neutral mark carrying the organization's name appears and no text announces the absence.
- Given an admin who uploads a permitted image, when the upload completes, then exactly one object exists under that organization's folder and the preview reflects it after a single invalidation.
- Given a signed-in admin of another organization, when they request the first organization's object by any direct path, then no bytes are returned — identically via UI and via direct API.
- Given a session that is anonymous, deactivated, or member-role, when it attempts to write an object, then the write is refused by policy rather than by the interface.

## Spec Change Log

### 2026-09-16 — iteration 0, three adversarial layers, no loopback

**Triage deviation, recorded deliberately.** Several findings had spec-level root causes and would normally route to `bad_spec` and a revert-and-re-derive. They were routed to `patch` instead, following the precedent `spec-1-3b` and `spec-1-4a` both set and for the same reasons: every fix is additive and local, the architecture the spec asked for held under all three layers, and the work had been verified against a live database whose evidence a re-derive would discard.

One finding was examined for `intent_gap` and released. A successful upload followed by a refused row write left an object nothing referenced, permanently, because the frozen **Never** forbids a DELETE policy — which looked like frozen intent needing renegotiation. It is not: the object key is fixed per organization, so writing `logo_path` first and uploading second makes a failed upload degrade into the matrix's own "a reference that resolves to nothing → neutral fallback" row. No orphan, no DELETE policy, frozen text untouched.

**KEEP — must survive any re-derivation.**
- **The row is written before the object.** The reverse order can destroy the previous logo and strand an unreclaimable object; this order has no failure state the matrix does not already name.
- **The policy pins the object key, not just the folder.** Scoping by `(storage.foldername(name))[1]` alone lets an admin write `<own-id>/anything` without bound, which no DELETE policy can ever reclaim. "One object, never two" belongs in the database, not in the client that derives the path.
- **Every storage policy names `to authenticated`.** `anon` holds full privileges on `storage.objects`; the role clause is the entire gate, not a narrowing of one.
- **The orchestration takes the snapshot, not an id.** While the screen passed `organization.id` into the seam, substituting `organization.slug` typechecked, linted and left the whole suite green while killing the feature at runtime. Passing the snapshot removes the wrong value from the caller's reach.
- **The bucket's own bounds are proved over HTTP**, not by reading `file_size_limit` out of `storage.buckets`. A bucket whose limits are recorded but not applied passes the latter.
- Reading a policy refusal out of an empty row set rather than out of `error`, and the injected seam that puts the whole matrix in the node suite — both inherited from 1.4a and still load-bearing.

**Known-bad state avoided.** A test cleanup running `update organizations set logo_path = null` with no `WHERE` against whatever `SUPABASE_DB_URL` pointed at; a logo that becomes the browser's broken-image glyph one hour into a session, which is the exact state the story exists to prevent; an entitled admin told they lack administrator rights when the real fault was that the service could not sign a URL; a member who cannot see a logo told they cannot change one; and a migration that aborts against any environment where the bucket already exists, leaving the column and the grant unapplied.

## Design Notes

**Why a column rather than a probe.** Without `logo_path`, discovering that an organization has no logo means asking storage on every render — a second network read behind the screen's only figure, and precisely the shape AD-13 exists to prevent. The column makes absence a value the snapshot already carries, so the fallback is a pure read. That the path is derivable from the id today is a coincidence of the naming scheme, not a contract; the column is the contract.

**Why a forged path fails closed.** An admin can write any string into their own `logo_path`, including another tenant's. The storage SELECT policy scopes by folder, so the read refuses and the screen falls back — the column is a reference, never an authorization. This is why the matrix tests a reference that resolves to nothing.

**Why the signed URL is not a second snapshot.** The URL is derived *from* the snapshot's `logo_path` under a dependent key, not an independent read of the same row, so two figures on the screen still come from one read. If `logo_path` is null the derived query never runs.

**Why no SVG.** An SVG is a document, not an image, and the one place a logo will eventually render is the application shell. The allowlist is the cheapest place to keep that decision, and three raster types cover every real logo.

## Verification

**Commands:**
- `nvm use && node -v` — expected: `v24.19.0`. Confirm rather than assume; the nvm v20 bin precedes it.
- `supabase db reset` — expected: exit 0, `0005` applies, both fixtures load with `logo_path` null. Then re-assert that `storage.buckets` holds exactly one row and `pg_policies` for schema `storage` holds exactly the three this migration writes.
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` — expected: all exit 0, no skips, counts above the 959/449/4 baseline. Build precedes test.
- Mutation probes — each must fail the suite: drop `to authenticated` from a storage policy; drop the `member_role = 'admin'` clause from the INSERT policy; drop the folder comparison so any authenticated caller reads any object; make the fallback render when `logo_path` is set; send `logo_path` from the settings form's submit and confirm a save no longer clobbers an upload silently.

## Suggested Review Order

**The gate, and why it is the whole gate**

- Start here: `anon` already holds every privilege, so this clause is the door, not a narrowing of it.
  [`0005_organization_logo.sql:23`](../../supabase/migrations/0005_organization_logo.sql#L23)

- Read is any active member; the logo is theirs to see.
  [`0005_organization_logo.sql:200`](../../supabase/migrations/0005_organization_logo.sql#L200)

- Write is an active admin only — the same conjunction, one clause stricter.
  [`0005_organization_logo.sql:217`](../../supabase/migrations/0005_organization_logo.sql#L217)

- The key is pinned, not just the folder: one object per tenant, enforced here.
  [`0005_organization_logo.sql:243`](../../supabase/migrations/0005_organization_logo.sql#L243)

- Private, bounded by size and type; `do nothing` so a re-run cannot abort the migration.
  [`0005_organization_logo.sql:147`](../../supabase/migrations/0005_organization_logo.sql#L147)

- Column grants union, so the revoke must precede the grant.
  [`0005_organization_logo.sql:121`](../../supabase/migrations/0005_organization_logo.sql#L121)

**The sequence that cannot strand an object**

- The row is pointed at the key before any bytes are sent; no order here leaves an orphan.
  [`logo.ts:411`](../../apps/web/src/organization/logo.ts#L411)

- It takes the snapshot, never an id, so the wrong value is not in the caller's reach.
  [`logo.ts:415`](../../apps/web/src/organization/logo.ts#L415)

- The bucket stays the enforcement point; this only stops sending bytes it would refuse.
  [`logo.ts:302`](../../apps/web/src/organization/logo.ts#L302)

- A refused read and a refused write are different sentences to the person reading them.
  [`logo.ts:129`](../../apps/web/src/organization/logo.ts#L129)

- Expiry is pinned by value, and the cache is refreshed at a quarter of it.
  [`logo.ts:108`](../../apps/web/src/organization/logo.ts#L108)

**The surface**

- Derived from the snapshot's path, never an independent read of the same row.
  [`organizacija.tsx:156`](../../apps/web/src/routes/organizacija.tsx#L156)

- A refused sign is not retried three times and is not silence either.
  [`organizacija.tsx:164`](../../apps/web/src/routes/organizacija.tsx#L164)

- An expired or dead URL falls back to the mark instead of a broken-image glyph.
  [`organizacija.tsx:395`](../../apps/web/src/routes/organizacija.tsx#L395)

- Grapheme-safe and NFC-normalised, so a Croatian diacritic keeps its mark.
  [`logo.ts:453`](../../apps/web/src/organization/logo.ts#L453)

- Both handlers guard on both flags; neither erases the other's refusal.
  [`organizacija.tsx:289`](../../apps/web/src/routes/organizacija.tsx#L289)

**Types that make the clobber unrepresentable**

- `never` on both arms, so a spread carrying both shapes cannot typecheck.
  [`snapshot.ts:104`](../../apps/web/src/organization/snapshot.ts#L104)

- A tenth code stops compiling rather than silently rendering "try again".
  [`messages.ts:94`](../../apps/web/src/organization/messages.ts#L94)

**Proof**

- The boundary executed over both harnesses, against both fixtures.
  [`rls-isolation.test.ts:2292`](../../test/rls-isolation.test.ts#L2292)

- The bucket's own bounds proved against the service, not read out of a catalog.
  [`rls-isolation.test.ts:2579`](../../test/rls-isolation.test.ts#L2579)

- The policy's latitude tested directly: three keys the client would never derive.
  [`rls-isolation.test.ts:2639`](../../test/rls-isolation.test.ts#L2639)

- Cleanup scoped to the fixtures, because `SUPABASE_DB_URL` is one variable away.
  [`rls-isolation.test.ts:747`](../../test/rls-isolation.test.ts#L747)
