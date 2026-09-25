---
title: 'Story 2.1b: An admin edits the hour bands and sees the day partitioned'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '3735d5ff235aa9c44679ac9bde6232b919726579'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1a-hour-band-rule.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 2.1a stores and derives hour bands, but an admin can't see or change them. This story is the rest of epics.md story 2.1 clauses 1 and 2 (UX-DR13, AD-3): the editor, and the 24-hour partition bar.

**Approach:**
- `/organizacija/satni-pojasi` lists bands in start order with each derived window, duration and midnight flag shown read-only. It adds a band from a name and a start time, and renders the partition bar.
- `/organizacija/satni-pojasi/$id` edits a band's name or start time, and removes the band after one confirmation.
- Both screens are admin-guarded and cross-linked from `/organizacija`. Every derived value comes from `@shift/domain`.

## Boundaries & Constraints

**Always:**
- Input is a name and a start time (`<Input type="time">`) only. The window, duration and midnight flag are shown read-only and come from `deriveHourBands` and `partitionOfDay`, never recomputed in `apps/web`.
- Zero bands (human decision 2026-09-25):
  - The bar is one hatched, flagged segment.
  - The text states the uncovered hours in numbers, never with `Nema`.
  - Any band, the last included, may be removed.
- The bar carries no colour-only meaning:
  - Each covered segment is labelled with its band's name.
  - The uncovered segment is hatched and flagged.
  - The bar is `aria-hidden={true}`; the list and a coverage sentence are its text equivalent.
  - A band crossing midnight appears as two segments with one label each.
- Refusals are mapped by constraint name, because two constraints raise `23505` and three raise `23514`. Each refusal names its problem (start taken, name taken, blank name, invalid time), keeps the entered values, and keeps focus on the field. Zero rows back is stale.
- Moving onto a taken start is refused with the start-taken message. There is no swap feature (this resolves 2.1a's deferred swap note for the editor).
- Admin-only, using the `/ljudi/smjene` guard. Every string goes through `t()` and clears every gate. Controls are `h-11`, there is no page scroll at 320 px, and removal has one neutral confirmation naming the band.

**Ask First:**
- A schema change, a deferrable constraint, or reordering several bands in one action.

**Never:**
- No migration or database change.
- No recomputed window or duration in `apps/web`.
- No `destructive`, `shift-slot-*`, `smjen` or `Nema`.
- No new third-party dependency or navigation destination.
- No code-splitting.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pilot | 07:00, 19:00 | `07:00–19:00` 12 h; `19:00–07:00` 12 h, crosses midnight; bar 3 segments, 24 of 24 h | N/A |
| UJ-5 | 05, 13, 21 | Three 8 h rows; bar 4 segments | N/A |
| Zero bands | none | Bar hatched, 0 of 24 h stated, add form offered | N/A |
| Add | `Jutro`, `05:00` | Row appears in order; values cleared; confirmation | N/A |
| Taken start | add or move to `19:00` | Nothing written | Start-taken refusal, values kept |
| Taken name | `" noć "` | Nothing written | Name-taken refusal |
| Blank name | `"  "` | Nothing written | Blank refusal |
| Remove last | one band, confirmed | Zero-band state | N/A |
| Stale | band removed elsewhere | Nothing written | Stale refusal |
| Member-role | opens either URL | Redirected to first destination | N/A |

</frozen-after-approval>

## Code Map

Baseline: `nvm use`, then `pnpm build && pnpm test` at HEAD. Record the counts (root 1920, web 1414, domain 24 after 2.1a).

**Domain link**
- Add an alias `'@shift/domain'` → `../../packages/domain/src/index.ts` in `apps/web/vite.config.ts:12-14`, `vitest.config.ts:20-24` and `tsconfig.json` `paths`. Also add `"@shift/domain": "workspace:*"` to `apps/web/package.json`, then run `pnpm install`.
- Root `typecheck` and `test` never build, so `dist/` must not be required. Prove it after `rm -rf packages/domain/dist`.

**Modules** (new `apps/web/src/hour-bands/`)
- `list.ts` copies `teams/list.ts`:
  - key `:27`, columns `:33`, exact count `:36`, stale time `:39`;
  - row validation `:101-114`, reader `:123-175`, message key `:225-231`, surface state `:254-268`.
- `list.ts` also does:
  - parse `HH:MM:SS` into minutes;
  - build the display rows and the bar's segment percentages from `deriveHourBands`/`partitionOfDay`;
  - an `hourBandById`.
- `write.ts` copies `teams/write.ts`:
  - failure map `:114-123`, `settled` `:136-168`, `claimedOrganizationOf` `:223-242`, form state `:305-336`.
  - Discriminate by constraint name in `message`/`details`, the way `organization/snapshot.ts:516-522` does.
  - Delete follows `members/write.ts:851-869,1073-1080`: `.delete().eq('id').select('id')`, and zero rows means stale.
- `HH:MM` display: add `formatMinuteOfDay` to `i18n/format.ts`, next to `RANGE_DASH` `:46`. List it in `UNZONED_ENTRY_POINTS` (`format.test.ts:251-257`). No `Intl` outside `format.ts`.

**Routes**
- `routes/organizacija.satni-pojasi.tsx` mirrors `ljudi.smjene.tsx`: `useQuery` `:65-70`, `submit` with a ref guard `:75-128`, live regions `:189-207`, guard `:249-263`.
- `routes/organizacija.satni-pojasi.$id.tsx` mirrors `ljudi.smjene.$id.tsx`: keyed remount `:67-71`, `submit` `:113-152`, archive becomes remove `:158-252`.
- Register both in `router.ts:60-64`. The cross-link goes in `organizacija.tsx:787-801`, copying `ljudi.tsx:254-262`.
- Hatch: an `@utility` in `index.css` using `repeating-linear-gradient` over `var(--modifier-uncovered)`. No new `--token`.

**Gates**
- `router.test.ts`: `routesById` `:241-272`, `LEVEL_GUARDED_ROUTES` `:197-225` plus length and name `:1548-1551` (5 becomes 7).
- `prijava.test.ts`:
  - file constants `:100-103`;
  - `SCREENS` `:249` (19 becomes 21, `:1512`) and `KEY_SOURCES` `:1162` (27 becomes 31, `:1513`);
  - `FORM_SCREENS` `:383-434`, and `IN_FLIGHT_*` `:3447-3470` (remove gets its own handler);
  - SETTINGS pins `:277` (9 becomes 10), `:3128` (3 becomes 4) and strings (12 becomes 13);
  - a band one-query test mirroring `:2378-2400`.
  - Write non-string attributes as `{…}`, not quoted.
- `hr.json` keys go under `organization.hourBands.*`, never `count.*` (`prijava.test.ts:2615-2620`). Plurals follow `one/few/other`.
- `resource-hygiene.test.ts` `SANCTIONED_*` `:37-495` (an exact set), en dash `:672`, `smjen` ban `:532-547`.
- `localization-applied.test.ts` `SOURCES` `:48`. Leave `pojasi` out of `AUTHORED_VOCABULARY`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/{package.json,vite.config.ts,vitest.config.ts,tsconfig.json}`, `pnpm-lock.yaml` -- the domain link, working with no `dist/`.
- [x] `apps/web/src/i18n/format.ts` + `format.test.ts` -- `formatMinuteOfDay` (0 → `00:00`, 1439 → `23:59`).
- [x] `apps/web/src/hour-bands/list.ts`, `write.ts` + tests -- read, parse, derive through domain, segment percentages, failure map, form state -- every matrix row executable in node (AD-15).
- [x] `apps/web/src/routes/organizacija.satni-pojasi.tsx`, `organizacija.satni-pojasi.$id.tsx`, `organizacija.tsx`, `router.ts`, `index.css`, `hr.json` + gate tests -- the two screens, the bar, the cross-link.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- add `2-1b-hour-band-editor: in-progress` under 2.1's split comment.

**Acceptance Criteria:**
- Given the editor, when a band is added, then only a name and a start time are enterable, and the window, duration and midnight flag are shown read-only.
- Given the pilot fixture, when the bar renders, then 24 h is covered and the 19:00 band reads as crossing midnight.
- Given either screen at 320 px, when used, then every control clears 44 px and nothing scrolls horizontally.

## Design Notes

Segment widths are `(toMinute − fromMinute) / 1440` as a percentage, computed in `list.ts` and applied as `` style={{ width: `${pct}%` }} ``. Durations display in hours and minutes (`12 h`, `1 h 30 min`) with no plural, so they match the voice rule `24 h bez pauze`.

## Verification

**Commands:**
- `rm -rf packages/domain/dist && pnpm lint && pnpm typecheck && pnpm test` -- exit 0 without a domain build.
- `pnpm build && pnpm test` -- exit 0, no skips, counts above baseline.
- `git diff --stat supabase/` -- empty.
- Mutation probes, each of which must fail the suite:
  - map every `23505` to one message;
  - drop the guard;
  - recompute the duration in `list.ts`;
  - render a `count.*` key;
  - drop the zero-band segment.

## Suggested Review Order

**Derived, never recomputed: domain into the screen**

- Entry point: display rows take window, duration and midnight flag from the domain.
  [`list.ts:291`](../../apps/web/src/hour-bands/list.ts#L291)

- The bar's segments and percentages come straight from `partitionOfDay`.
  [`list.ts:336`](../../apps/web/src/hour-bands/list.ts#L336)

- Reader refuses malformed answers and count mismatches in both directions.
  [`list.ts:162`](../../apps/web/src/hour-bands/list.ts#L162)

- `HH:MM:SS` from the database and `HH:MM` from the input meet as one minute.
  [`list.ts:109`](../../apps/web/src/hour-bands/list.ts#L109)

**Refusals: told apart by constraint name**

- Two uniques share 23505 and three checks share 23514; the name decides.
  [`write.ts:147`](../../apps/web/src/hour-bands/write.ts#L147)

- The database side asserts every name the mapping relies on.
  [`rls-isolation.test.ts:9643`](../../test/rls-isolation.test.ts#L9643)

- Delete by id asks for the row back; zero rows is stale.
  [`write.ts:275`](../../apps/web/src/hour-bands/write.ts#L275)

- A removal outcome outlives the band, so stale never reads as unknown.
  [`write.ts:381`](../../apps/web/src/hour-bands/write.ts#L381)

**The two screens**

- The bar is `aria-hidden`; the list and a coverage sentence carry its meaning.
  [`organizacija.satni-pojasi.tsx:154`](../../apps/web/src/routes/organizacija.satni-pojasi.tsx#L154)

- Add: name and start only, ref-guarded, one invalidate.
  [`organizacija.satni-pojasi.tsx:92`](../../apps/web/src/routes/organizacija.satni-pojasi.tsx#L92)

- Edit and remove, one neutral confirmation, focus to the back link after.
  [`organizacija.satni-pojasi.$id.tsx:181`](../../apps/web/src/routes/organizacija.satni-pojasi.$id.tsx#L181)

- Both routes carry the admin guard copied from `/ljudi/smjene`.
  [`organizacija.satni-pojasi.tsx:331`](../../apps/web/src/routes/organizacija.satni-pojasi.tsx#L331)

- Cross-link from Organizacija; no new navigation destination.
  [`organizacija.tsx:788`](../../apps/web/src/routes/organizacija.tsx#L788)

**Wiring and presentation**

- `@shift/domain` resolves to its source, so no `dist/` is ever needed.
  [`vite.config.ts:19`](../../apps/web/vite.config.ts#L19)

- Minute-of-day formatting lives in `format.ts`, the one home for time text.
  [`format.ts:65`](../../apps/web/src/i18n/format.ts#L65)

- Hatch utility over the existing token; no new colour.
  [`index.css:416`](../../apps/web/src/index.css#L416)

**Peripherals: gates and proofs**

- The flag's text holds 4.5:1 on its measured ground in both themes.
  [`theme-contrast.test.ts:882`](../../test/theme-contrast.test.ts#L882)

- Routes registered; static paths under `appLayoutRoute`.
  [`router.ts:14`](../../apps/web/src/router.ts#L14)
