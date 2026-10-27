---
title: 'Raspored becomes Za odluku, and no screen says konflikt'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_commit: '98cff8d4cbde9ea06d5539955d84428772506b51'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin queue is called *Raspored*, and the Croatian UI calls a member on leave in a scheduled shift a *konflikt*. Going on leave is not a conflict, and in Epic 9 leave requests start waiting in the same queue.

**Approach:** Rename the queue to *Za odluku* at a new URL, with tabs *Čeka odluku* and *Odlučeno*. Old URLs redirect. Rewrite every Croatian string that says *konflikt* in the §5.5 vocabulary, and ban the stem with a hygiene test. Code, docs and the glossary keep "Conflict" as the domain term.

## Boundaries & Constraints

**Always:**
- Use the §5.5 vocabulary exactly where it names a string:
  - *Za odluku*; tabs *Čeka odluku* (default, count shown even at zero) and *Odlučeno*.
  - Count: one `# čeka odluku`, few `# čekaju odluku`, other `# čeka odluku`.
  - Item *Odsutnost u smjeni*. Button *Odluči*. Legend ⚠ *čeka odluku*.
  - Erasure dialog *Promjena uklanja N stavki koje čekaju odluku*. Back link *Natrag na Za odluku*.
  - The accent rule says *rezervirana za ono što čeka odluku*.
- For the other *konflikt* strings, write the same meaning in that vocabulary and keep every ICU plural form valid.
- New paths are `/za-odluku` and `/za-odluku/$memberId/$date/$teamId`. Both are admin-guarded and offline-readable.
- `/raspored` and `/raspored/$memberId/$date/$teamId` redirect with `replace: true` and keep their params.
- Update the docs in the same change: EXPERIENCE.md §IA, DESIGN.md, and the epics.md UX-DR lines 12, 23, 25, 32 and 46. Each planned line becomes shipped text for the 9.1 parts only.

**Ask First:**
- Any string whose meaning cannot survive the vocabulary.
- Any change outside the Croatian UI copy, routes, tests and docs listed here.

**Never:**
- Do not rename domain code identifiers: `features/conflicts`, `Conflict*` types, the tab values `unresolved`/`resolved`, or DB names.
- Do not change the glossary.
- Do not add leave requests, new item kinds or queue sorting. Those belong to 9.2–9.5.
- Do not ban *riješen* or *raspored*. "Raspored" still means the schedule elsewhere, as in *Moj raspored*.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Old queue URL | Admin opens `/raspored` | Lands on `/za-odluku`; history has no `/raspored` entry | N/A |
| Old detail URL | `/raspored/m1/2026-11-03/t1` | `/za-odluku/m1/2026-11-03/t1` | N/A |
| Member on old URL | Member opens `/raspored` | Refused like any other admin-only path | Existing guard |
| Zero count | No open collisions | Tab reads `Čeka odluku · 0`; Danas count reads `0 čeka odluku` | N/A |
| Ban regression | Any `hr.json` message contains `konflikt` (any case or ending) | Hygiene test fails | Build fails |

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/raspored.tsx:62`, `raspored.$memberId.$date.$teamId.tsx:50` -- the queue and detail routes.
- `apps/web/src/pages/ljudi.novi.tsx:15-25` -- the redirect pattern to copy (`adminGuard` + `throw redirect`); its tests are at `router.test.ts:2357-2365`.
- `apps/web/src/router.ts:20-52` -- route registration.
- `router.test.ts` pins the routes at :65, :188, :275-281 and :399-401.
- `apps/web/src/lib/offline/readable-paths.ts:25-26` -- the offline-readable list.
- `features/navigation/utils/destinations.ts:123,184` -- the nav entry and `PHONE_TABS`. Also `icons.ts:57`, `destination-copy.ts:24,38` and `destinations.test.ts`.
- Hard-coded `'/raspored'` links:
  - `features/today/components/needs-you-card.tsx:25,78`
  - `features/conflicts/components/conflicts-list.tsx:26`
  - `conflict-resolution-body.tsx:53,233`
  - `features/conflicts/hooks/use-conflicts-queue.ts:93`
  - `use-conflict-resolution.ts:274,405`
  - `features/calendar/components/day-detail-dialog.tsx:311`
  - `pages/ljudi.$id.tsx:68`
- `apps/web/src/lib/i18n/locales/hr.json` -- 74 *konflikt* lines across `danas`, `kalendar`, `sati`, `ljudi`, `godisnji`, `rotation` and `raspored` (:472-570). Also `nav.raspored` :907, the accent rule :939 and `shell.description.raspored` :1366.
- `test/resource-hygiene.test.ts:2108` -- `RESERVED_STEMS = []`. Matching is by stem and case-insensitive (:2311); the sweep is at :2455.
- 14 unit tests hold Croatian literals. The main ones are `conflicts/services/{resolved-conflicts,conflicts-queue,resolution-screen,resolution-write}.test.ts`, `today/services/admin-today.test.ts` and `lib/i18n/format.test.ts:569`. The erasure tests in calendar, conflicts, members, rotation and hours, plus `today-tiles.test.ts`, also qualify.
- E2E page objects:
  - `e2e/pages/conflicts.page.ts:16,106` (the path) and `:120` (the literal regex `Raspored · `)
  - `today.page.ts`, `calendar.page.ts`, `people.page.ts`
  - `e2e/utils/i18n.ts:16`
- E2E specs with URL or literal asserts: `conflicts/*`, `today/today.spec.ts:663-769`, `calendar-conflicts.spec.ts:437`, `auth/authorization.spec.ts:22`, `layout/phone-navigation.spec.ts`, `offline/*` and `rotation/*-erasures.spec.ts`.
- Docs: `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md` (:31, :45, :65, :85, :101-138) and `DESIGN.md:311`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/lib/i18n/locales/hr.json` -- Rename the namespace `raspored` to `zaOdluku`, and the keys `nav.raspored` and `shell.description.raspored` to `zaOdluku`. Rewrite every *konflikt* string. -- The keys stop naming the old surface.
- [x] `test/resource-hygiene.test.ts` -- Add `'konflik'` to `RESERVED_STEMS` and update the rationale comment. The stem is `konflik` because the genitive plural *konflikata* does not contain `konflikt`. -- This is the build-failing ban.
- [x] `apps/web/src/pages/za-odluku.tsx`, `za-odluku.$memberId.$date.$teamId.tsx` -- Move the screens here with the new paths.
- [x] `apps/web/src/pages/raspored.tsx`, `raspored.$memberId.$date.$teamId.tsx` -- Turn both into render-nothing redirect routes. -- This is the URL redirect.
- [x] `router.ts`, `readable-paths.ts`, `destinations.ts`, `icons.ts`, `destination-copy.ts`, the fixtures -- Use the new paths and keys everywhere, and update every hard-coded link in the Code Map.
- [x] Unit tests (Code Map) -- Update the literals and route tables. Add redirect tests in `router.test.ts`: the target, the params, `replace`, and member refusal.
- [x] `e2e/pages/*`, `e2e/utils/i18n.ts`, `e2e/tests/**` -- Update the paths, regexes, literals and test names. -- The page objects follow the new names.
- [x] `EXPERIENCE.md`, `DESIGN.md`, `epics.md` UX-DR12/23/25/32/46 -- Write the 9.1 parts as shipped text.

**Acceptance Criteria:**
- Given an admin, when the sidebar and the phone bar render, then *Za odluku* stands where *Raspored* stood, in the same binding order and the same phone tab slot.
- Given the queue, when it opens, then *Čeka odluku* is selected and *Odlučeno* lists decided collisions as before.
- Given `hr.json`, when `pnpm test` runs, then no message matches the stem `konflikt`.
- Given `grep -ri konflikt apps/web/src e2e`, when it runs, then the only hits are code comments, test names or the hygiene ledger, never asserted copy.

## Design Notes

**Golden strings.** Keep the existing ICU shapes:
- Detail heading and mark: `Odsutnost u smjeni`.
- Detail row (admin Danas coverage): `{name} je na godišnjem, a u sastavu je smjene · čeka odluku`. It is gender-neutral, like the day detail's line, and says the state in words because the ⚠ is hidden from screen readers.
- Back link: `Za odluku · {count, plural, one {# čeka odluku} few {# čekaju odluku} other {# čeka odluku}}`.
- Calendar cell: `…, čeka odluku`.
- Erasure title: `{count, plural, one {Promjena uklanja # stavku koja čeka odluku} few {Promjena uklanja # stavke koje čekaju odluku} other {Promjena uklanja # stavki koje čekaju odluku}}`. The rotation, override and undo variants keep their own subject, such as *Poništavanje uklanja…*.
- Danas link: `Otvori Za odluku ({count})`.

**Namespace rename.** `raspored` as a key would mislead, because "raspored" means the schedule everywhere else. The rename is mechanical, and the key-hygiene tests catch any key that is missed.

## Epic AC Deviations

None.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm test` -- expected: green, including the resource-hygiene and key-hygiene sweeps.
- `pnpm test:e2e` -- expected: green. This needs the local Supabase stack.
- `grep -rni konflikt apps/web/src/lib/i18n/locales/hr.json` -- expected: no output.

## Suggested Review Order

**Routes and redirect**

- Entry point: the old queue URL renders nothing and forwards, keeping search and hash.
  [`raspored.tsx:23`](../../apps/web/src/pages/raspored.tsx#L23)

- The old detail URL forwards with its params to the new detail route.
  [`raspored.$memberId.$date.$teamId.tsx:23`](../../apps/web/src/pages/raspored.$memberId.$date.$teamId.tsx#L23)

- The queue screen now lives at `/za-odluku`, same guard and component.
  [`za-odluku.tsx:65`](../../apps/web/src/pages/za-odluku.tsx#L65)

- Both new and old paths stay offline-readable, so old bookmarks open offline.
  [`readable-paths.ts:26`](../../apps/web/src/lib/offline/readable-paths.ts#L26)

- Same binding-order slot and phone tab, new key and path.
  [`destinations.ts:123`](../../apps/web/src/features/navigation/utils/destinations.ts#L123)

**Croatian copy**

- Namespace renamed `raspored` → `zaOdluku`; tabs, count and resolution strings in §5.5 vocabulary.
  [`hr.json:472`](../../apps/web/src/lib/i18n/locales/hr.json#L472)

- Danas line: gender-neutral, state carried in words beside the aria-hidden ⚠.
  [`hr.json:135`](../../apps/web/src/lib/i18n/locales/hr.json#L135)

- Calendar legend reads ⚠ čeka odluku.
  [`hr.json:168`](../../apps/web/src/lib/i18n/locales/hr.json#L168)

**The ban**

- Stem `konflik` so the genitive plural `konflikata` is caught too.
  [`resource-hygiene.test.ts:2112`](../../test/resource-hygiene.test.ts#L2112)

**Docs**

- UX-DR46 shipped text, with per-kind queue naming left planned for 9.5.
  [`epics.md:180`](../planning-artifacts/epics.md#L180)

- §IA entry for *Za odluku* and the redirect.
  [`EXPERIENCE.md:45`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L45)

**Tests**

- Redirect: target, `replace`, search and hash, member refusal.
  [`router.test.ts:2398`](../../apps/web/src/router.test.ts#L2398)

- Old paths read offline under the read-only session.
  [`router.test.ts:1635`](../../apps/web/src/router.test.ts#L1635)

- E2E: old URL lands on Za odluku with no Back entry.
  [`conflicts-queue.spec.ts:407`](../../e2e/tests/conflicts/conflicts-queue.spec.ts#L407)
