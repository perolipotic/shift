---
title: '8.2b Member surfaces, chrome and guards read offline'
type: 'feature'
created: '2026-10-20'
status: 'done'
baseline_commit: 'd261ffd5bf6cea47b78e35df514d0907717418bc'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-2-surfaces-read-offline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only Danas and Kalendar read offline. Several things still fail without a connection:
- Sati, Godišnji, Ljudi (the admin table and the members' Imenik) and the team roster `/smjene/$id` still treat a paused read as unavailable.
- An admin route guard hangs on "pending" forever.
- After an online reload, the chrome draws restored names before their refetch lands.

**Approach:** Apply story 8.2's freshness recipe to these surfaces (`useSnapshotFreshness` → `answerOf`/`answerFor` → existing `*StateOf`, plus an `OfflineNote` under the heading). Persist the keys they add, including two parameterised roots. Make the offline-readable routes a pattern list. Have the role guard answer from the cached role while offline. Give the chrome a per-read freshness rule.

## Boundaries & Constraints

**Always:**
- Story 8.2's rules hold unchanged: one snapshot per surface, no restored data online after start, the labelled cache after a reconnect, owner-scoped persistence, and the 30-day per-entry limit.
- **Surfaces and keys.** Each surface gets a `features/<module>/services/surface-keys.ts` with a test that pins its key set per role and that every key in it is persisted:
  - Sati `/sati`: only the keys Sati already read. A test pins that, for each role, they are a SUBSET of Danas's keys, so Danas online prefetches them. Sati adds no reads.
  - Godišnji `/godisnji`: the member's keys, and the admin's, which add `leave-overview-records`.
  - Ljudi `/ljudi`: the admin table reads `members`. The Imenik reads `teams`, `own-team`, `organization` and `TEAM_ROSTER_KEY(id)` for each cached active team.
  - Team roster `/smjene/$id`: `TEAM_ROSTER_KEY(id)` and `organization`.
- **Persistence.** New one-segment roots: `leave-overview-records`, `teams`, `own-team`. New parameterised root, kept only in the exact shape `[root, non-empty string]`: `team-roster`. `leave-records` waits for 8.2c, which adds the member page that reads it. The erasure-check part is never kept. `persistsKey` stays exact. `ERASURE_CHECK_KEY_PART` is rejected explicitly, and a test pins `['calendar','erasure-check']` as not kept.
- **Readable paths.** `readsOffline` matches route patterns (`/`, `/danas`, `/kalendar`, `/sati`, `/godisnji`, `/ljudi`, `/smjene/$id`). A trailing slash is normalised. Router tests cover every listed path and one admin-only path that is not listed.
- **Role guard.** `cachedMemberRole` takes an injected `isOnline`. Offline with an `ok` role cached, it returns that role. Offline with none, it returns `MEMBER_ROLE_UNAVAILABLE` at once and never pauses. Online behaviour does not change.
- **Chrome** (human decision 2026-10-20, 2a). Role, name and organization each decide freshness alone:
  - online after start, a restored value is not drawn until it is refetched;
  - offline, the cached value is drawn;
  - one missing read never fails another, so a missing name never takes the role or the navigation down;
  - the chrome shows no as-of note of its own.
- The note's time zone comes from the calendar snapshot if the surface reads it. Otherwise it comes from the organization snapshot, and failing that from the organization zone carried in the surface's own reads (the member list, the own team). If no zone is available, an offline surface shows the existing unavailable state. It never draws cached data without the note.

**Ask First:**
- Any surface that turns out to need a key with more than one parameter.
- Any change to how the old `*StateOf` modules decide (8.2 kept them as a raw-read safety net).

**Never:**
- Raspored and the resolution page, the member page `/ljudi/$id`, Organizacija, Satni pojasi, Postavke rotacije (including shift types), or Ljudi/smjene. These are 8.2c, recorded in `deferred-work.md`.
- Offline write refusal (8.3), or a queued write.
- Persisting erasure-check reads or logo URLs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin route offline, role cached | `requireAdmin`, offline, `member-role` cached `ok` admin | The route opens | — |
| Admin route offline, no role | Offline, nothing cached | It fails closed at once: the existing role-unavailable path, never an endless pending | — |
| Imenik offline | A member read Ljudi online, then goes offline | The directory renders whole with the note | If a team's roster was never read, unavailable |
| Chrome offline, name missing | Role cached, name never read | Navigation renders, and the name falls back as it does today | — |
| Chrome after an online reload | Restored role and name | Neither is drawn until it is refetched. Navigation waits for the role, as it does on a cold start | — |
| Parameterised key | `['team-roster', id]` succeeded | It is kept. `['calendar','erasure-check']` is not | — |

## Epic AC Deviations

- **"Given a surface was read online / When it opens offline / Then it renders its last snapshot whole…"** Still NARROWED. This story adds Sati, Godišnji, Ljudi (the table and Imenik) and `/smjene/$id`. The admin work and settings surfaces are DEFERRED to 8.2c (`deferred-work.md`, human decision 2026-10-20, 1a).

</frozen-after-approval>

## Code Map

- `apps/web/src/lib/offline/freshness.ts:86,135` -- `snapshotFreshnessOf` and `snapshotAnswerOf` (reuse them, do not change them). `use-snapshot-freshness.ts:70` -- the hook. Use `answerFor` where reads are disabled by role.
- `features/today/hooks/use-today.ts:85-115,236-239`, `features/calendar/hooks/use-calendar-screen.ts:127-191,451` -- the recipe to copy, including `snapshotFetching` from the reshaped calendar (offline skew).
- `features/hours/hooks/use-hours.ts:75-98` (skew at :119) -- Sati.
- `features/leave/hooks/use-my-leave.ts:40-47`, `use-leave-overview.ts:89-104` (`enabled: admin`) -- Godišnji. `LEAVE_OVERVIEW_RECORDS_KEY` is at `leave-list.ts:488`.
- `features/members/hooks/use-member-list.ts:81` -- the Ljudi table. `features/teams/hooks/use-member-directory.ts:70-92` -- the Imenik (`useQueries` over the roster).
- `features/teams/hooks/use-team-roster.ts:36-51` -- `/smjene/$id`. The keys are `teams/list.ts:29` and `roster.ts:38,290`.
- Paused-over-cached-rows notices: `members/list.ts:2602` (`membersNoticeOf`, 2593 at the baseline), `teams/list.ts:329`, `roster.ts:280`. Under `answerOf` the flag is never set, and the `OfflineNote` takes their place.
- `lib/offline/persistence.ts:89,110,117` -- the roots, `persistsKey` and `persistsQuery`. The tests at `persistence.test.ts:93` (list `toEqual`) and :123.
- `lib/query-client.ts:42` -- the per-root `setQueryDefaults`. Prefix matching already covers child keys.
- `lib/offline/readable-paths.ts:9-12`, `pages/_app.tsx:115`, `router.test.ts:1555-1600` (:1587 asserts that `/sati` redirects, which flips).
- `pages/ljudi.tsx:235` -- `guardMemberRole` also guards members, so it needs the role fix.
- `features/navigation/services/role.ts:369,382,400-407` -- `cachedMemberRole` and `MemberRoleCache` (add `getQueryData`). `admin-guard.ts:58`. Tests: `role.test.ts:370-430`, `admin-guard.test.ts:19-64`.
- `features/navigation/components/chrome.tsx:237-283` -- the role, name and organization reads, and `roleFailure`. They render at :691-701, :779, :925 and :854.
- Pages: `pages/sati.tsx`, `godisnji.tsx`, `ljudi.tsx`, `smjene.$id.tsx` (or the equivalent route file) -- the `OfflineNote` goes under `PageHeader`.
- Registration: every new `surface-keys.ts` gets an exemption with a `why` in its feature's `*-screen.fixture.ts`. The `toEqual` lists in `pages/screens-sweep.test.ts` (teams :1022) need a second edit. Placing `OfflineNote` needs no count change.

## Tasks & Acceptance

**Execution:**
- [x] `lib/offline/persistence.ts` (+ test) -- the new roots and the parameterised allowlist, with the erasure part rejected.
- [x] `lib/offline/readable-paths.ts`, `pages/_app.tsx`, `router.test.ts` -- pattern matching.
- [x] `features/navigation/services/role.ts` (+ `role.test.ts`, `admin-guard.test.ts`) -- the offline role path.
- [x] `features/navigation/components/chrome.tsx` (+ a pure helper with a node test) -- per-read freshness for role, name and organization.
- [x] Sati, Godišnji (both hooks), the Ljudi table, Imenik and the team roster -- `surface-keys.ts` (+ test), the hook rewiring, `offline` on the hook result, and the `OfflineNote` on the page. Update the fixtures.
- [x] `e2e/tests/offline/offline-read.spec.ts` -- member: Danas → Sati, Godišnji, Ljudi offline with the note. Admin: Ljudi table offline.
- [x] Docs:
  - spine: in the AD-13 clause, list the surfaces; in the CAP-18 row, add the role guard offline;
  - `EXPERIENCE.md` Offline bullet: the surfaces;
  - `deferred-work.md` 8.2b entry: mark it partly resolved.

**Acceptance Criteria:**
- Given a member read Danas, Sati, Godišnji and Ljudi online, when the network drops, then each opens with the note and none shows unavailable.
- Given an admin offline with a cached role, when they open `/ljudi`, then the table renders and the guard never hangs.
- Given `pnpm test`, `lint` and `typecheck` and the offline and today e2e tests, when they run, then all pass.

## Spec Change Log

- 2026-10-21, review loop 1 (bad_spec in the frozen block, amendments approved by the human). Findings:
  - "Sati has the same keys as Danas" forced up to four reads Sati never needed.
  - `leave-records` was persisted with no surface reading it in 8.2b.
  - Three surfaces could draw offline without the note when no zone resolved.

  Amended three frozen bullets: Sati ⊆ Danas, `leave-records` moved to 8.2c, and a zone chain where no zone means unavailable. KEEP all other implemented code (persistence, readable paths, the role guard, chrome-freshness, the surface rewiring, e2e). Only Sati's reads and keys, the `leave-records` root and the zone fallbacks change, plus the review patches.

## Verification

**Commands:**
- `pnpm --filter @shift/web build && pnpm test && pnpm lint && pnpm typecheck` -- expected: green.
- `pnpm test:e2e e2e/tests/offline e2e/tests/today` -- expected: green.

**Manual checks:**
- `vite preview`, as a member and as an admin: read the surfaces, go offline and reload. Each surface in scope renders with the note, and `/ljudi` opens without hanging.

## Suggested Review Order

**The chrome and the guard**

- Entry point: role, name and organization each decide alone. Restored values are never drawn online, and a missing role fails with a retry.
  [`chrome-freshness.ts:49`](../../apps/web/src/features/navigation/services/chrome-freshness.ts#L49)

- Offline, the role guard answers from the cached role or fails closed at once. It never pauses.
  [`role.ts:400`](../../apps/web/src/features/navigation/services/role.ts#L400)

- Offline-readable routes are now patterns, case-insensitive, with no `//`.
  [`readable-paths.ts:51`](../../apps/web/src/lib/offline/readable-paths.ts#L51)

**The note and its zone**

- The zone chain (calendar → organization → the surface's own reads). With no zone, the surface is unavailable offline.
  [`freshness.ts:146`](../../apps/web/src/lib/offline/freshness.ts#L146)

- One gate decides when the note shows, shared by every hook.
  [`freshness.ts:167`](../../apps/web/src/lib/offline/freshness.ts#L167)

**The surfaces**

- Sati: only its own reads, a subset of Danas's.
  [`use-hours.ts:118`](../../apps/web/src/features/hours/hooks/use-hours.ts#L118)

- Imenik: one roster per cached active team, and the zone from the organization or the own team.
  [`use-member-directory.ts:110`](../../apps/web/src/features/teams/hooks/use-member-directory.ts#L110)

- The note under the heading. The same pattern repeats on Godišnji, Ljudi and `/smjene/$id`.
  [`sati.tsx:80`](../../apps/web/src/pages/sati.tsx#L80)

**Persistence**

- `team-roster` is kept only as `[root, non-empty id]`. The erasure-check part is never kept.
  [`persistence.ts:156`](../../apps/web/src/lib/offline/persistence.ts#L156)

**Docs**

- The AD-13 amendment for 8.2b (decisions 1a and 2a).
  [`ARCHITECTURE-SPINE.md:139`](../planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md#L139)

**Tests**

- Offline e2e for member and admin: Sati, Godišnji, Ljudi and the roster.
  [`offline-read.spec.ts:1`](../../e2e/tests/offline/offline-read.spec.ts#L1)

- The localization sweep now reads only the string literals of the built JS.
  [`localization-applied.test.ts:1`](../../test/localization-applied.test.ts#L1)
