---
title: '8.2d Settings surfaces read offline'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_commit: 'ba0044e65bbcdf0e58c2819b31de9fd368785d4d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-2c-admin-surfaces-read-offline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The settings surfaces are the last ones without offline reads:
- Organizacija has no offline rule at all. It draws cached cards unlabelled, or shows a skeleton that never ends.
- Satni pojasi, Postavke rotacije and Ljudi/smjene, each with its `$id` page, still treat a paused read as unavailable.
- The rotation builder draws a paused refetch unlabelled.

**Approach:** Apply the 8.2 recipe used by 8.2b and 8.2c to these surfaces: `surface-keys.ts` with a persisted test, `useSnapshotFreshness`, `answerOf`/`answerFor`, the `offlineNoteOf` gate, and an `OfflineNote` under the heading. Persist `hourBands`, `shiftTypes` and `rotation`, and make the seven routes offline-readable. On these surfaces only, offline shows no *Pokušaj ponovno* read retry (decision 2a).

## Boundaries & Constraints

**Always:**
- The 8.2 rules hold unchanged: one snapshot per surface, the zone chain, never drawn without the note, owner-scoped persistence, the 30-day limit, and the fetch-flag rule (fetch flags from the raw observer, figures from the answered reads).
- **Organizacija** `/organizacija`. The keys are `organization` and `hourBands`, shared by `useOrganizationSettings` and `useOrganizationHourBands`. The zone is the organization snapshot's. A resolved non-unavailable refusal uses `ZONE_NOT_NEEDED`, so it shows its own message. The cards' skeletons read the answered `isPending`. `isFetching` and `refetch` stay on the raw read.
- **Satni pojasi** `/organizacija/satni-pojasi` and `$id`. The keys are `hourBands` and `organization` (the rows carry no zone). The list hook and the edit hook share one key set.
- **Postavke rotacije** `/postavke-rotacije` and `/postavke-rotacije/tipovi-smjena/$id`. The keys are `shiftTypes` and `rotation`, shared by the shift-type hooks and `useRotationBuilder`. The zone is embedded in either snapshot. The note goes inside `rotation-section.tsx`, right after its `PageHeader`. A paused rotation refetch over cached data is never drawn unlabelled again.
- **Ljudi/smjene** `/ljudi/smjene` and `$id`. The keys are `teams` and `organization`. The zone comes from `teamRosterTimeZoneOf`.
- **Zone without a new `useQuery`.** Where a surface needs the organization only for its zone, it lists `organization` as a key it does not observe and decides it from the cache. The chrome always observes that key. The exactly-one-`useQuery` pins therefore stay as they are.
- **Persistence.** New one-segment roots: `hourBands`, `shiftTypes`, `rotation`.
- **Readable paths.** Add `/ljudi/smjene`, `/ljudi/smjene/$id`, `/organizacija`, `/organizacija/satni-pojasi`, `/organizacija/satni-pojasi/$id`, `/postavke-rotacije` and `/postavke-rotacije/tipovi-smjena/$id`. `/ljudi/smjene` leaves `OFFLINE_UNREADABLE_SIBLINGS`, so only `/ljudi/novi` remains there.
- **No read retry offline** (decision 2a, these surfaces only). While `clock.online` is false, every read-retry control on these surfaces is not rendered. The unavailable message stays as it is, and the retry comes back with the connection (human decision 2026-10-21, 2a). Each hook ANDs `clock.online` into the retry flag it already exposes.

**Ask First:**
- Any change to a write path (8.3) or to `use-erasure-check`.

**Never:**
- The no-retry rule on any other surface. That is 8.2e (`deferred-work.md`).
- New i18n strings, or a new `useQuery` added only for the zone.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Organizacija offline | Organization and hour bands cached | The cards render with one note. No skeleton | — |
| Organizacija offline, nothing cached | Paused, no data | The unavailable notice without *Pokušaj ponovno*. Never an endless skeleton | — |
| Organizacija refusal | In-memory `{ok:false}`, `ORGANIZATION_REFUSED` | Its own refusal message, with no note | — |
| Rotation offline | `shiftTypes` and `rotation` cached | The list and the builder render with one note | Saving fails through the existing write error (8.3) |
| Satni pojasi `$id` offline | `hourBands` cached | The dialog and the list behind it render with the note | — |
| Reconnect | offline→online | The retry controls return, and the note goes once every read is fresh | — |

## Epic AC Deviations

- **"Given a surface was read online / When it opens offline / Then it renders its last snapshot whole…"** With this story every surface reads offline. 8.2b, 8.2c and 8.2d together close the narrowing that 8.2 recorded. The no-retry-offline refinement for the other surfaces is DEFERRED to 8.2e (`deferred-work.md`, human decision 2026-10-21, 1a). It is not an epic AC.

</frozen-after-approval>

## Code Map

- `lib/offline/use-snapshot-freshness.ts:65,87-98,106-118` -- `useFreshnessClock` (`clock.online`), the fetch-flag rule comment, the hook, and how an unobserved key is decided from the cache.
- `lib/offline/freshness.ts:123-136,146,167,201` -- `NoteZone`, `notedFreshnessOf`, `offlineNoteOf`, `snapshotAnswerOf`. `ReadAnswer` has no `isFetching`/`refetch`.
- `features/organization/hooks/use-organization-settings.ts:161-174,376-385` -- the read, `readFailureOf`, `readRetry` and `retryRead`. `use-organization-hour-bands.ts:34`. Components: `organization-settings-card.tsx:65,100-113` (and `isFetching` :106), `organization-profile-card.tsx:120`, `organization-logo-dialog.tsx:79`. The zone is `organizationTimeZone` (`snapshot.ts:577`). Logo: never persisted, and the mark falls back offline. No change needed.
- `features/hour-bands/hooks/use-hour-band-list.ts:60`, `use-hour-band-edit.ts:78`. The state is `services/list.ts:545-558`, and the key is :41. Pages: `organizacija.satni-pojasi.tsx:84-94` and `.$id.tsx:81-91` (retry).
- `features/shift-types/hooks/use-shift-type-list.ts:84`, `use-shift-type-edit.ts:84` (key `services/list.ts:47`, zone :129). Retry: `shift-type-list-section.tsx:37-47`, `postavke-rotacije.tipovi-smjena.$id.tsx:79-89`.
- `features/rotation/hooks/use-rotation-builder.ts:231` (key `services/list.ts:70`, zone :179, state :916-925, `writableRotationOf` :948). `components/rotation-section.tsx:124,315-326`. Retry: `rotation-notices.tsx:351-364`.
- `features/teams/hooks/use-team-list.ts:59`, `use-team-edit.ts:67` (`services/list.ts:29,313`). `teamRosterTimeZoneOf` is at `teams/services/surface-keys.ts:40`. Retry: `pages/ljudi.smjene.tsx:66-79`, `ljudi.smjene.$id.tsx:~73-83`.
- `lib/offline/persistence.ts:96-111` (+ `persistence.test.ts:104-127`). `lib/offline/readable-paths.ts:16-43` (+ `router.test.ts:1583-1672`: the readable list, the "unlisted admin path" example moving to `/ljudi/novi`, the sibling `toEqual` and the hypothetical-8.2d test).
- Pins and fixtures:
  - New `surface-keys.ts` files for shift types and hour bands need exemptions in their `*-screens.fixture.ts`, plus `screens-sweep.test.ts:685-686,836-837`. Organization, rotation and teams need none.
  - `structural-pins-settings.test.ts:631-664`: `readFailureOf(snapshot)` becomes `readFailureOf(answered)`; update the pin. The retry pins are at :660 and :663.
  - `organization/services/snapshot.test.ts:1194-1210` (the `useQuery` counts must hold).
  - `structural-pins-members.test.ts:389-460,536-551`.

## Tasks & Acceptance

**Execution:**
- [x] `lib/offline/persistence.ts` (+ test) -- the three roots.
- [x] `lib/offline/readable-paths.ts` (+ `router.test.ts`) -- the seven paths, and the sibling list shrinks to `/ljudi/novi`.
- [x] `features/organization/services/surface-keys.ts` (+ test), both organization hooks and the three components -- Organizacija through freshness, with the retry hidden offline.
- [x] `features/hour-bands/services/surface-keys.ts` (+ test, fixture), the list and edit hooks, both pages -- Satni pojasi.
- [x] `features/rotation/services/surface-keys.ts` (+ test), the shift-type hooks, `useRotationBuilder`, `rotation-section.tsx`, `rotation-notices.tsx`, the tipovi-smjena `$id` page -- Postavke rotacije.
- [x] `features/teams/services/surface-keys.ts` (extend + test), the team list and edit hooks, both pages -- Ljudi/smjene.
- [x] Pins: update the pins listed in the Code Map.
- [x] `e2e/tests/offline/offline-read.spec.ts` -- as admin, read Organizacija, Satni pojasi, Postavke rotacije and Ljudi/smjene online. Offline, each shows one note and no *Pokušaj ponovno*. Organizacija never read shows unavailable with no retry. Reconnect removes the note.
- [x] Docs:
  - spine: a dated AD-13 line for 8.2d, and the CAP-18 row;
  - `EXPERIENCE.md`: the Offline bullet (every surface; on settings surfaces no read retry offline);
  - `deferred-work.md`: close the 8.2d entry (the 8.2e entry already exists); in the Q24 list, `rotation` holds member names and override reasons, while `shiftTypes` and `hourBands` hold no personal data.

**Acceptance Criteria:**
- Given an admin read the four settings surfaces online, when the network drops, then each reopens with the note and none shows a skeleton, an unlabelled snapshot or a read retry.
- Given `pnpm test`, `lint` and `typecheck` and the offline, today and people e2e tests, when they run, then all pass.

## Spec Change Log

## Verification

**Commands:**
- `pnpm --filter @shift/web build && pnpm test && pnpm lint && pnpm typecheck` -- expected: green.
- `pnpm test:e2e e2e/tests/offline e2e/tests/today e2e/tests/people` -- expected: green.

## Suggested Review Order

**Organizacija**

- Entry point: one surface, `organization` + `hourBands`, shared by the settings and bands hooks.
  [`surface-keys.ts:23`](../../apps/web/src/features/organization/services/surface-keys.ts#L23)

- A resolved refusal shows its own message, even offline and with the bands never read.
  [`surface-keys.ts:42`](../../apps/web/src/features/organization/services/surface-keys.ts#L42)

- Freshness, the single zone source, and `readRetry` ANDed with `clock.online`.
  [`use-organization-settings.ts:189`](../../apps/web/src/features/organization/hooks/use-organization-settings.ts#L189)

**Postavke rotacije**

- Shift types and rotation are one surface. Each hook observes its own key and decides the other from the cache.
  [`surface-keys.ts:16`](../../apps/web/src/features/rotation/services/surface-keys.ts#L16)

- No save is ever built from a cached rotation, offline or just reconnected.
  [`list.ts:950`](../../apps/web/src/features/rotation/services/list.ts#L950)

- Builder freshness, and `retryable` set to `clock.online`.
  [`use-rotation-builder.ts:247`](../../apps/web/src/features/rotation/hooks/use-rotation-builder.ts#L247)

- The note goes right after the section's `PageHeader`.
  [`rotation-section.tsx:328`](../../apps/web/src/features/rotation/components/rotation-section.tsx#L328)

**Satni pojasi and Ljudi/smjene**

- The zone comes from the cached organization, with no new `useQuery`.
  [`use-hour-band-list.ts:74`](../../apps/web/src/features/hour-bands/hooks/use-hour-band-list.ts#L74)

- The same pattern for the team list.
  [`use-team-list.ts:74`](../../apps/web/src/features/teams/hooks/use-team-list.ts#L74)

**Routes**

- Only `/ljudi/novi` remains an unreadable sibling. `/ljudi/smjene` is now listed.
  [`readable-paths.ts:52`](../../apps/web/src/lib/offline/readable-paths.ts#L52)

**Docs**

- AD-13 for 8.2d: every surface now reads offline.
  [`ARCHITECTURE-SPINE.md:142`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L142)

**Tests**

- Offline e2e: the four surfaces and their editors, the never-read cases, one-of-two cached, and no retry offline.
  [`offline-read.spec.ts:1`](../../e2e/tests/offline/offline-read.spec.ts#L1)
