---
title: 'Story 2.2b: An admin manages shift types and sees each one in its ramp slot'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'db7cae077bde206b04370582f544dc51507cc3ce'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2a-shift-type-rule.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1b-hour-band-editor.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 2.2a stored shift types, but no admin can see or change them. This part covers epics.md story 2.2 clauses 3–5 on screen (UX-DR3, UX-DR6, CAP-7, AD-2). It is the last part and closes the 2.2 parent.

**Approach:** `/postavke-rotacije` becomes an admin-only screen with a `Tipovi smjena` section. The section lists the types, each in its ramp-slot chip, and has an add form. An edit screen at `/postavke-rotacije/tipovi-smjena/$id` handles rename, a time correction from a chosen date, cancelling the scheduled correction, and archive. Rules live in pure `.ts` modules; `.tsx` files hold markup only.

## Boundaries & Constraints

**Always:**
- **Mirror 2.1b.** Follow the same reader, write, surface-state and message-key pattern, plus the refetch rule from db7cae0: the `queryFn` throws its code and the rows are kept. Use a `useRef` lock, no `useMutation`, uncontrolled inputs, `h-11`, and `Notice`.
- **Ramp slot:** `(i mod 6) + 1`, where `i` is the type's index among WORKING types (archived ones included), ordered by `(created_at, id)`. A non-working type is `shift-nonworking`. The slot is derived and never stored. The chip always shows the name as text, and colour never carries meaning alone. Class names are static strings (`bg-shift-slot-3 text-shift-slot-3-foreground`).
- **Durations and times come from `@shift/domain`** (`deriveShiftTimes`, `shiftTypeVersionOn`). Nothing is re-derived.
- **Times:**
  - Clock ranges use `formatMinuteOfDay` + `RANGE_DASH`.
  - "Today" is the organization's today. The zone is embedded in the read, as in `members/list.ts:116`. It is never the device date.
- **Add:**
  - Fields: name, working/non-working, and for a working type start and end.
  - A working type needs two writes: the type, then its first version effective from today.
  - If the second write fails, the type stays and the screen says it has no times.
- **Correct times:**
  - The date's minimum is `max(today, day after latest version)`.
  - While a correction is scheduled, it is shown with its date and times and offered for cancel, and no new correction is offered.
  - A working type with no version is offered "set times" from today.
- **Archive:**
  - One neutral confirmation (armed/busy stages, as in teams).
  - A 42501 refusal means a change is scheduled; the message says to cancel it first.
  - Archived types are listed separately, read-only.
- **Guard:** `/postavke-rotacije` and the edit route get the admin `beforeLoad` guard.
- **Copy:**
  - The term is `Tip smjene`.
  - Keys go under `rotation.shiftTypes.*`.
  - `resource-hygiene`'s `teamTermOutOfTurn` is amended so that ONLY this namespace may say `smjen`, and only as `tip… smjen…`.
- **Contrast proof (UX-DR3):**
  - A test pins that every slot the ramp function can return has a measured light and dark pair in `theme-contrast.test.ts`.
  - DESIGN.md's `[ASSUMPTION]` on slots 3–6 is replaced with a pointer to that proof.

**Ask First:**
- Any migration, RPC or new column. For example, making the two-write add atomic.
- A stored ramp slot.
- Any token value change.

**Never:**
- No colour picker, emoji, pay multiplier, valid days, or hour-band field.
- No `is_working` change after creation.
- No delete of a type.
- No `shift-day`/`shift-night` token.
- No `destructive` styling for archive.
- No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pilot list | seeded | Dan slot 1 `07:00–19:00` `12 h`; Noć slot 2 `19:00–07:00` `12 h`; Slobodno non-working | N/A |
| UJ-5 list | seeded | Jutarnja 1, Popodnevna 2, Noćna 3 (`22:00–06:00`, `8 h`); Slobodno non-working | N/A |
| Seventh working type | 7 working types | 7th is slot 1 again; name tells it apart | N/A |
| Archived in order | slot-2 type archived | Later types keep their slots | N/A |
| 24 h | `07:00`–`07:00` | Saved, `24 h` | N/A |
| Add, second write fails | version insert refused | Type listed with no times; message says so | code → key |
| Duplicate name | `" noć "` beside `Noć` | Values kept, name field marked | 23505 → NAME_TAKEN |
| Correction | date ≥ minimum, new times | Scheduled; shown with date; earlier dates unchanged | N/A |
| Same times / past date | refused by RLS | Values kept | 42501 → REFUSED |
| Cancel scheduled | future version exists | Removed; correction offered again | 0 rows → STALE |
| Archive with change scheduled | future version | Refused, "cancel it first" | 42501 |
| Member opens the URL | member role | Redirected by guard | N/A |
| Read fails on refetch | rows cached | Rows kept, message beside them | retry 1 |

</frozen-after-approval>

## Code Map

- `apps/web/src/hour-bands/{list,write}.ts` (+ tests) -- the pattern to copy:
  - `readHourBands`, `hourBandsQueryOptions` (l.374), `hourBandsSurfaceStateOf` (l.417)
  - `hourBandWriteFailureOf` (l.152), which maps by constraint name
  - `settled` (l.183), the `removeStageOf` stages (l.355)
  - `minuteOfTime` (l.110), `durationValuesOf`/`durationMessageKey` (l.245)
- `apps/web/src/routes/organizacija.satni-pojasi{,.$id}.tsx` -- the screen and guard shape (`beforeLoad` l.321-341, `mayReadMembers`).
- `apps/web/src/teams/write.ts` -- archive:
  - `archiveFailureOf` (l.129): 42501 on archive
  - `archiveStageOf` (l.275)
  - `claimedOrganizationOf` (l.223)
- `apps/web/src/routes/ljudi.smjene.$id.tsx:156-260` -- the inline archive confirmation UI.
- `apps/web/src/members/write.ts:841-1200` -- the closest analogue for "from a date + cancel scheduled": `statusOfferOf`, `statusFailureOf`, `changeMemberStatus`. The date input is `ljudi.$id.tsx:977`. `membersTodayOf` is `members/list.ts:482`.
- `supabase/migrations/0013_shift_types.sql` -- READ ONLY.
  - Grants (l.369): type insert `(organization_id,name,is_working)`, update `(name,archived)`. Version insert `(organization_id,shift_type_id,start_time,end_time,effective_from)`.
  - Constraint names: `shift_types_name_not_blank`, `shift_types_organization_name_key`, `shift_type_versions_*`.
- `packages/domain/src/duration.ts` -- `deriveShiftTimes`, `shiftTypeVersionOn`, `ShiftType`, `ShiftTypeVersion`. READ ONLY.
- `apps/web/src/i18n/{format.ts,locales/hr.json}` -- `RANGE_DASH` (l.46), `formatMinuteOfDay`, `organizationIsoDate`, `nextIsoDate`, `formatIsoDate`, and the ICU plurals.
- `apps/web/src/router.ts:65`, `routes/postavke-rotacije.tsx` -- the placeholder; keep the `PostavkeRotacijeScreen` export.
- `apps/web/src/index.css:175-188,246-259,320+` -- slot tokens. READ ONLY.
- Tests that pin inventories:
  - `router.test.ts`: `ROLE_GUARDED_PATHS` l.186, `LEVEL_GUARDED_ROUTES` l.206, the route-id list l.290
  - `routes/prijava.test.ts`: `PLACEHOLDER_SLUGS` l.222 → `BUILT_SLUGS` l.243, the `SCREENS` control counts l.360, the query/invalidate source checks
  - `test/resource-hygiene.test.ts`: sanctioned keys by equality, plural keys l.50, `teamTermOutOfTurn` l.603
  - `test/localization-applied.test.ts`: the file list l.101/206, `'Postavke rotacije'` l.484
  - `test/theme-contrast.test.ts:47` `BRAND_PAIRS`, l.150
  - `test/theme-tokens.test.ts:164`

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/shift-types/list.ts` (+ `list.test.ts`) -- Build the reader, query options and surface state, reading types, versions and the org zone in one snapshot. Add `rampSlotOf` over `(created_at, id)`, display rows (current times on today, scheduled correction, slot class, duration key), and a split into active and archived. Test every matrix row that has no write, for both fixtures, with real `QueryObserver` refetch tests.
- [x] `apps/web/src/shift-types/write.ts` (+ `write.test.ts`) -- Add create (two writes, with the partial outcome), rename, correct times with the date minimum, cancel scheduled, and archive. Map each failure to its code, and give each code its message key through an exhaustive switch, plus the stages. Test every write row of the matrix.
- [x] `apps/web/src/routes/postavke-rotacije.tsx`, `routes/postavke-rotacije.tipovi-smjena.$id.tsx`, `router.ts` -- Build the screens and the guard, and register the edit route.
- [x] `apps/web/src/i18n/locales/hr.json` -- Add the `rotation.shiftTypes.*` keys.
- [x] `test/resource-hygiene.test.ts`, `test/localization-applied.test.ts`, `apps/web/src/routes/prijava.test.ts`, `apps/web/src/router.test.ts` -- Amend the inventories and the namespace rule. The rule gets a self-test on both polarities.
- [x] `test/theme-contrast.test.ts` -- Add the UX-DR3 pin: every slot `rampSlotOf` can return, for indices 0–12, is in `BRAND_PAIRS` and `FILLS`.
- [x] `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md` -- Replace the slot 3–6 `[ASSUMPTION]` with "verified in both themes, `test/theme-contrast.test.ts`".
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- Add `2-2b-shift-type-editor: in-progress`.

**Acceptance Criteria:**
- Given the pilot admin at 390 px, when they add a type `Dežurstvo` 07:00–07:00, then it lists as slot 3 `24 h`, without horizontal page scroll.
- Given a type renamed after a correction, when the list is read, then the new name shows, and each version's times stay with their dates (AD-2).
- Given the built bundle, when it is swept, then there are no literals, no `shift-day`/`shift-night`, and no `destructive` on archive.

## Design Notes

Ties on `created_at` are broken by `id`. The order among tied rows is arbitrary but stable, and since the editor writes one type per request, ties are unlikely. This resolves the deferred note from 2.2a without a stored ordinal. The add is not atomic. Making it atomic would need an RPC, which is an "Ask First" item, so a half-created type stays visible and editable instead.

## Verification

**Commands:**
- `pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- exit 0, no skips, counts above baseline.
- `git diff --stat supabase/ packages/ package.json pnpm-lock.yaml` -- empty.
- Mutation probes that must fail the suite:
  - `rampSlotOf` skips archived types
  - `i mod 7`
  - the date minimum ignores the latest version
  - archive 42501 maps to REFUSED

**Manual checks:**
- At 320 and 390 px, light and dark: the list, add and edit screens show no horizontal scroll, and every control is 44 px. (There is no E2E yet.)

## Suggested Review Order

**The ramp slot: derived from creation order, never stored**

- Entry point: `(i mod 6) + 1`, no imports, so the contrast test can import it.
  [`ramp.ts:32`](../../apps/web/src/shift-types/ramp.ts#L32)

- Working types only, archived included, so a slot never moves.
  [`list.ts:355`](../../apps/web/src/shift-types/list.ts#L355)

- `(created_at, id)`: microsecond instants, ties broken by id (2.2a's deferred note).
  [`list.ts:173`](../../apps/web/src/shift-types/list.ts#L173)

- Static chip classes, so Tailwind generates them; the name always beside.
  [`list.ts:371`](../../apps/web/src/shift-types/list.ts#L371)

**The read: one snapshot, starting from the organization**

- Starts at `organizations` so zero types still carry the zone for "today".
  [`list.ts:55`](../../apps/web/src/shift-types/list.ts#L55)

- Exact-count, one-organization, version-tenant checks; refuses rather than guesses.
  [`list.ts:285`](../../apps/web/src/shift-types/list.ts#L285)

- Organization today from the embedded zone, never the device date alone.
  [`list.ts:343`](../../apps/web/src/shift-types/list.ts#L343)

- Display rows: today's times via `shiftTypeVersionOn`, scheduled correction, active/archived.
  [`list.ts:478`](../../apps/web/src/shift-types/list.ts#L478)

- The db7cae0 refetch rule: throws its code, retry 1, rows kept.
  [`list.ts:552`](../../apps/web/src/shift-types/list.ts#L552)

**Writes: two-write add, versioned times, guarded archive**

- Type then first version from today; a failed second write keeps the type.
  [`write.ts:511`](../../apps/web/src/shift-types/write.ts#L511)

- What the add screen does with each outcome, out of the `.tsx`.
  [`write.ts:857`](../../apps/web/src/shift-types/write.ts#L857)

- Date minimum `max(today, day after latest)`; one scheduled correction at a time.
  [`write.ts:352`](../../apps/web/src/shift-types/write.ts#L352)

- Correct, set, cancel or nothing — the offer the edit screen renders.
  [`write.ts:393`](../../apps/web/src/shift-types/write.ts#L393)

- Same times refused before sending, with its own message.
  [`write.ts:413`](../../apps/web/src/shift-types/write.ts#L413)

- Only the latest future version is cancelled; zero rows is stale.
  [`write.ts:463`](../../apps/web/src/shift-types/write.ts#L463)

- Archive not offered while a change is scheduled; refused before sending too.
  [`write.ts:589`](../../apps/web/src/shift-types/write.ts#L589)

- 42501 means "change scheduled" only when the snapshot shows one.
  [`write.ts:259`](../../apps/web/src/shift-types/write.ts#L259)

- Failures mapped by constraint name; duplicate version date reads as stale.
  [`write.ts:214`](../../apps/web/src/shift-types/write.ts#L214)

- Idle wins when not armed, so unrelated writes never show the confirmation.
  [`write.ts:732`](../../apps/web/src/shift-types/write.ts#L732)

**Screens and routing: markup only**

- The list and add form; one query, the add outcome from `createdOutcomeOf`.
  [`postavke-rotacije.tsx:107`](../../apps/web/src/routes/postavke-rotacije.tsx#L107)

- Admin guard on the formerly unguarded placeholder.
  [`postavke-rotacije.tsx:410`](../../apps/web/src/routes/postavke-rotacije.tsx#L410)

- Archive note in place of the offer while a correction is scheduled.
  [`postavke-rotacije.tipovi-smjena.$id.tsx:387`](../../apps/web/src/routes/postavke-rotacije.tipovi-smjena.$id.tsx#L387)

- The times block renders the offer; focus moves to the landed confirmation.
  [`postavke-rotacije.tipovi-smjena.$id.tsx:606`](../../apps/web/src/routes/postavke-rotacije.tipovi-smjena.$id.tsx#L606)

- The edit route's guard, same shape as the hour-band screens.
  [`postavke-rotacije.tipovi-smjena.$id.tsx:675`](../../apps/web/src/routes/postavke-rotacije.tipovi-smjena.$id.tsx#L675)

**Copy and terminology**

- `rotation.shiftTypes.*`: the one namespace that may say `Tip smjene`.
  [`hr.json:203`](../../apps/web/src/i18n/locales/hr.json#L203)

- `smjen` allowed there only after a real inflection of `tip`.
  [`resource-hygiene.test.ts:677`](../../test/resource-hygiene.test.ts#L677)

**Peripherals: proofs and inventories**

- UX-DR3 pin: every slot the ramp returns has a measured pair, both themes.
  [`theme-contrast.test.ts:935`](../../test/theme-contrast.test.ts#L935)

- DESIGN.md's slot 3–6 assumption now points at that proof.
  [`DESIGN.md:220`](../../_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L220)

- Only the full edit-route path is stripped before the `smjena` count.
  [`localization-applied.test.ts:864`](../../test/localization-applied.test.ts#L864)

- Route inventories: the new guarded path and route id.
  [`router.test.ts:38`](../../apps/web/src/router.test.ts#L38)

- Reader, ramp, refetch and both-fixture list tests.
  [`list.test.ts`](../../apps/web/src/shift-types/list.test.ts)

- Every write row of the matrix, separate table stubs on the add.
  [`write.test.ts`](../../apps/web/src/shift-types/write.test.ts)
