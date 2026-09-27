---
title: 'A team or membership write refreshes every screen that shows it, an offline refetch says so, and the add dialogs cannot be dismissed mid-create'
type: 'bugfix'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '2f85a699f7b8e81ecd553e1e866abde2f30ca6a2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-shift-2026-09-02/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The deferred-work triage on 2026-09-27 put four entries still open on main into "package 3a":
1. **Stale member list after a team change** ("A team rename or archive does not refresh the member list…"). `MEMBERS_COLUMNS` embeds `teams(name)` under `MEMBERS_LIST_KEY`, but the team edit screen invalidates only `TEAMS_LIST_KEY`. The rule "a write invalidates only its own surface's key" is pinned by `prijava.test.ts`.
2. **Stale own-team line and roster** ("An admin's membership move, team rename or archive does not refresh Danas's own-team line or the `/smjene/$id` roster…"). No write invalidates `OWN_TEAM_KEY` or `TEAM_ROSTER_KEY`.
3. **Silent offline pause over cached rows** ("A refetch that pauses offline over cached rows…"). Every `*SurfaceStateOf` treats "paused" only as `isPending && fetchStatus === 'paused'`, so the teams, members, hour-bands and shift-types surfaces show stale rows with no message.
4. **Dismissible add dialogs** ("The shift-type and hour-band add dialogs let the viewer dismiss them … while a create is in flight"). The team add dialog fix (#89) settled this for teams only.

**Approach:**
- **Cross-surface invalidation:** amend the convention to "a write invalidates its own key AND every key whose read embeds or derives from the rows it writes". Name those dependencies in one explicit place, per write surface (e.g. team writes → `TEAMS_LIST_KEY`, `MEMBERS_LIST_KEY`, `OWN_TEAM_KEY`, `TEAM_ROSTER_KEY`; membership and status writes → `MEMBERS_LIST_KEY`, `OWN_TEAM_KEY`, `TEAM_ROSTER_KEY`).
  - Retarget the `prijava.test.ts` guard to the amended rule without losing meaning: every invalidated key is either the surface's own key or listed as a dependency.
  - Update the spine's convention row.
- **Offline pause:** the existing paused notice also shows when `fetchStatus === 'paused'` over cached rows, on every list surface that has one. Use the existing message key, with no new text.
- **Add dialogs:** mirror #89 exactly on the shift-type and hour-band add dialogs: Cancel `disabled={pending}`, `dismissible={!pending}`, and the close control guarded.

## Boundaries & Constraints

**Always:**
- **Tests:**
  - A unit or source test proves each named dependency is invalidated after each write.
  - `*SurfaceStateOf` unit tests cover paused over cached rows.
  - E2E for the dialogs, in #89's style: hold the create request with `page.route`, check that Cancel is disabled and the dialog stays open, release the request, and check that the created status shows.
  - An E2E test that a team rename shows the new name on the member list without a reload, if it can be driven deterministically. Otherwise explain why.
- Invalidation happens after a successful write only, and a rejected invalidation does not turn a successful write into a refusal.
- Mutation-prove every new test.
- Remove the deferred-work entries this closes.

**Ask First:**
- Any change to stale times or retry policies.
- Any change to `components/ui/dialog.tsx`.

**Never:**
- No new UI text.
- No change to write services or SQL.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/teams/hooks/*`, `apps/web/src/features/members/hooks/*` -- the write handlers and their `invalidateQueries` calls.
- `OWN_TEAM_KEY`, `TEAM_ROSTER_KEY` -- grep; they belong to the Danas and roster reads.
- `apps/web/src/pages/prijava.test.ts` -- the "a write invalidates only its own key" guard (search `invalidateQueries`).
- `*SurfaceStateOf` in `features/{teams,members,hour-bands,shift-types}/services/list.ts` or `utils` -- the paused predicate.
- `features/shift-types/components/shift-type-add-dialog.tsx`, `features/hour-bands/components/hour-band-add-dialog.tsx`; the #89 reference is `features/teams/components/team-add-dialog.tsx`.
- `e2e/tests/{shift-types,hour-bands,teams,people}/`, `e2e/pages/`.
- `ARCHITECTURE-SPINE.md` -- the Consistency Conventions row about invalidation.

## Tasks & Acceptance

**Execution:**
- [x] Declare the cross-surface dependencies, add the invalidations, retarget the guard, and update the spine.
- [x] Surface the offline pause over cached rows.
- [x] Gate the two add dialogs on pending.
- [x] Add the tests and clean up `deferred-work.md`.

**Acceptance Criteria:**
- Given each fix reverted, when the new tests run, then they fail.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test` (after a web build) and `pnpm test:e2e` run twice, then all pass.

## Spec Change Log

- **Where the dependents live.** One module, `apps/web/src/features/teams/services/dependents.ts`, declares the lists per write (`TEAM_CREATE_DEPENDENTS`, `TEAM_CHANGE_DEPENDENTS`, `MEMBERSHIP_WRITE_DEPENDENTS`, `MEMBER_SAVE_DEPENDENTS`, `NO_DEPENDENTS`) and the one call over them, `refreshAfterWrite(client, own, dependents)`. The members feature imports it, so `services/dependents` was added deliberately to `FEATURE_PUBLIC.teams` in `eslint.config.js`. It is exempted from the team screen sets in `team-screens.fixture.ts` like the other rule modules, and `test/localization-applied.test.ts`'s team module count went from 12 to 13.
- **Every roster at once.** `TEAM_ROSTERS_KEY = ['team-roster']` is new in `roster.ts`, and `TEAM_ROSTER_KEY(id)` is built from it, so one prefix invalidation reaches every team's roster.
- **Per write, not per surface.** The Approach's example gives all team writes the same list. A team CREATE touches no member, so its list is only `ROTATION_KEY`, which it already re-read. A rename or archive gets `ROTATION_KEY`, `MEMBERS_LIST_KEY`, `OWN_TEAM_KEY` and every roster. The rotation builder, an existing cross-surface dependent from story 2.3b, moved into these lists.
- **A member's basics save also re-reads the rosters, the builder, and the chrome's name and role.** The roster shows a member's name and rank, the rotation builder embeds `members(name)`, and an admin can edit their own row, which the chrome's `MEMBER_NAME_KEY` and `MEMBER_ROLE_KEY` read. The save re-reads them when it landed in full, or partly (`outcome.refusal.saved`).
- **A refusal re-reads only its own screen's reads.** Before, a refused team rename or archive also re-read the rotation builder. Now a refusal re-reads the team list only, because a refused write changed no row. On the member edit screen, a refusal still re-reads the member list, the teams and the organization, as before. Those are all the screen's own reads.
- **The shift-type write's rotation dependency stays inline** in the shift-type hooks, where its existing guard pins it. The dependents module belongs to the teams feature and covers team and membership writes only.
- **Offline pause: a flag, not a refusal (review round).** The first version widened the paused predicate, so a refetch paused over cached rows set `refusal`. `teamFormStateOf`, `memberFormRefusalOf`, `hourBandFormStateOf`, `shiftTypeFormStateOf` and `writableTeamsOf` read that same state, so the edit form unmounted and lost what was typed. Now each surface state carries `paused` beside `refusal`. A pause over cached rows sets `paused: true` with `refusal: null`, while a pause on the first read stays a refusal. Only the list screens announce it, through `teamsNoticeOf`, `membersNoticeOf`, `hourBandsNoticeOf` and `shiftTypesNoticeOf`, using the existing unavailable message. A pause over a cached members refusal keeps that refusal and marks `paused`. The roster gets the same flag and `teamRosterNoticeOf`, because every write now invalidates every roster, and its existing unavailable message covers it with no new text. The Danas line and the rotation builder keep their first-read-only predicate.
- **E2E locations.** No `e2e/tests/shift-types/` exists, so the shift-type dialog test is in `e2e/tests/rotation/rotation.spec.ts`, beside the other shift-type tests. The hour-band one is in `e2e/tests/hour-bands/hour-bands.spec.ts`. The rename test is in `e2e/tests/teams/teams.spec.ts`. It drives deterministically: the member list is cached under its 5-minute floor, and every step after it is a client-side navigation, so only the invalidation can refresh the row.
- **The dependents cover every read under the amended rule (review round).** `CALENDAR_KEY` joins the team rename/archive list and the membership/status list. It is harmless today, since the calendar's stale time is 0 and it re-reads on every mount, but the rule requires it. `dependents.test.ts` seeds every exported `*_KEY`, including calendar, member name, member role and session subject. A sweep over `apps/web/src` fails when a new exported `*_KEY` is not classified. `FEATURE_PUBLIC` gains `navigation: services/profile` and the `teams` consumers of `calendar: services/snapshot` and `navigation: services/role`, all deliberately.
- **Only the dependents module re-reads Danas and the rosters.** A repo-wide sweep fails when `OWN_TEAM_KEY`, `TEAM_ROSTERS_KEY` or `TEAM_ROSTER_KEY` appears in an `invalidateQueries` or `refetchQueries` call outside `dependents.ts`. A source guard pins the team create's `refreshAfterWrite` after the refusal's `return`.
- **"It rejects" was false.** TanStack Query 5.102's `invalidateQueries` refetches with `throwOnError` false, so a rejecting `queryFn` settles the query as failed and the call still resolves. A refetch paused offline resolves at once. The comments in `dependents.ts`, `use-member-create.ts`, `use-member-edit.ts` and `use-team-edit.ts` now say so. The guarantee that a failed re-read never turns a landed write into a refusal is pinned against a real `QueryClient`, for both a rejecting dependent and an offline pause. The `try` blocks remain, for a client that throws before any re-read starts.
- **Ask First: `components/ui/dialog.tsx` approved by the human on 2026-09-28.** Under Chrome's CloseWatcher, a second Escape without user activation is not cancelable, so `dismissible={false}` could still close a dialog mid-request. The fix has two parts, and the dismissible behaviour is unchanged:
  - The dialog now cancels the Escape `keydown` while not dismissible, so the browser never makes the close request.
  - A native close that still gets through while not dismissible reopens the dialog instead of calling `onOpenChange(false)`.
  - It covers #89's team dialog, the hour-band and shift-type add dialogs, and every other non-dismissible dialog.
  - The E2E tests press Escape once, twice and three times while the create is held, and assert that the dialog stays open and the field keeps focus. A close that is then undone moves focus, so the reopen fallback cannot hide a regression.
  - The 3.5b deferred entry for this issue was removed.
- **E2E hygiene.** The hour-band test removes its band at the end. The shift-type test archives its type in a `finally`, through `archiveShiftType` in `e2e/utils/database-helper.ts` (idempotent SQL), so a failure part-way leaves no active type behind.
- **Recorded, not fixed.** A create that never resolves traps the viewer in its add dialog, because nothing bounds the insert's duration. This went to `deferred-work.md`.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint` -- expected: exit 0.
- `pnpm test` after a build -- expected: pass.
- `pnpm test:e2e`, run twice -- expected: pass.

**Results (2026-09-28, review round, rebased onto `854fb5f`):**
- `pnpm typecheck` exit 0. `pnpm lint` exit 0. `pnpm build` exit 0.
- `pnpm test`: domain 256 → 256. Web 2693 → 2713 (the rebased first commit, then this round). Root 3133 of 3137 pass. The 4 failures are `test/rls-isolation.test.ts`'s 3.5a override-shape cases: the shared Supabase stack already carries a `confirmed_at` column from `0022_shift_type_override_disposition.sql`, which is untracked in the main checkout from another session. This branch changes no SQL, and `db reset` is forbidden.
- `pnpm test:e2e`: 90 → 90 tests (this round changes existing tests only). Two full runs passed 90 of 90. One attempt between them failed at start-up because port 5173 was taken by another session's server; it was re-run once the port was free.
- First round, before the rebase: web 2633 → 2650, root 3044, E2E 83 → 86.

**Mutation proof** (each change planted, the named test run, the file restored). Every mutant was KILLED except K2, which is explained below.

| # | Mutation | Killed by |
|---|---|---|
| M1 | team edit passes `NO_DEPENDENTS` on a landed write | `prijava.test.ts` team edit guard; E2E rename test (E1) |
| M2 | `MEMBERS_LIST_KEY` dropped from `TEAM_CHANGE_DEPENDENTS` | `dependents.test.ts` rename/archive case |
| M3 | `OWN_TEAM_KEY` dropped from `MEMBERSHIP_WRITE_DEPENDENTS` | `dependents.test.ts` move/status case, offline case |
| M4 | rosters dropped from `MEMBER_SAVE_DEPENDENTS` | `dependents.test.ts` save case |
| M5 | rosters dropped from `TEAM_CHANGE_DEPENDENTS` | `dependents.test.ts` rename/archive case |
| M6 | `ROTATION_KEY` dropped from `TEAM_CREATE_DEPENDENTS` | `dependents.test.ts` create case, rejecting-dependent case |
| M7 | roster prefix renamed | `dependents.test.ts` prefix case; `roster.test.ts` key case |
| M8 | `refreshAfterWrite` awaits each key in turn | `dependents.test.ts` "starts every re-read together" |
| M9 | `TEAM_ROSTER_KEY(id)` detached from the prefix | `dependents.test.ts` (four cases) |
| M10 | `changeTeam` re-reads dependents on a refusal too | `prijava.test.ts` changeTeam wiring |
| M11 | `changeStatus` passes `NO_DEPENDENTS` | `prijava.test.ts` changeStatus wiring |
| M12 | the member save passes `NO_DEPENDENTS` | `prijava.test.ts` submit wiring |
| M13 | team archive calls `refresh(true)` whatever the outcome | `prijava.test.ts` rename/archive gate |
| M14 | team create passes `[]` | `prijava.test.ts` team list guard |
| M15 | member edit names a foreign key directly | `prijava.test.ts` "names no key … besides its own reads" |
| M15b | the member save re-reads before the outcome is set | `prijava.test.ts` submit wiring (order) |
| R1–R4 | a pause over cached rows made a refusal again (teams, members, hour bands, shift types) | each surface's paused-over-cache case AND its edit form-state case (`teamFormStateOf`/`writableTeamsOf`, `memberFormRefusalOf`, `hourBandFormStateOf`, `shiftTypeFormStateOf`) |
| R5 | the same on the roster | `roster.test.ts` paused-roster case |
| R6 | a first-read pause no longer a refusal (teams) | `list.test.ts` "says why rather than pulsing while paused offline" |
| N1–N5 | a notice ignoring `paused` (teams, members, hour bands, shift types, roster) | each surface's paused case |
| N6 | a pause over a cached members refusal left unmarked | `members/list.test.ts` cached-refusal pause case |
| H1–H3 | a list hook (teams, members, roster) taking `refusal` off the state instead of the notice | `prijava.test.ts` "announces a paused refetch on the list through …" |
| H4 | the team edit hook folding the notice into its state | `prijava.test.ts` "keeps the edit form on a paused refetch in …" |
| D1 / D2 | `CALENDAR_KEY` dropped from the change / membership lists | `dependents.test.ts` matching case |
| D3 / D4 / D5 | `MEMBER_NAME_KEY` / `MEMBER_ROLE_KEY` / `ROTATION_KEY` dropped from the save list | `dependents.test.ts` save case |
| D6 | a new exported `HOUR_BAND_PREVIEW_KEY` | `dependents.test.ts` "names every exported query key" |
| D7 / D7b | `invalidateQueries` on `OWN_TEAM_KEY` in `use-member-create.ts` / `refetchQueries` on `TEAM_ROSTER_KEY` in the calendar module | `dependents.test.ts` repo-wide sweep |
| D8 | the team create re-reads before its refusal returns | `prijava.test.ts` create-order guard and team list guard |
| D9 | `refreshAfterWrite` passes `throwOnError: true` | `dependents.test.ts` "resolves when a dependent re-read rejects" |
| K1 | `dialog.tsx` Escape `keydown` guard removed | all three add-dialog E2E tests (team, hour band, shift type) |
| K2 | `dialog.tsx` reopen fallback removed | SURVIVED, as expected: with the keydown guard in place no native close reaches `onClose`, so the fallback is defence in depth that no browser path exercises today. K1 shows the E2E would catch a close that got through: the reopen moves focus and the focus assertion fails. |
| E1 | team rename passes `NO_DEPENDENTS` | E2E "a renamed team shows under its new name on the member list, without a reload" |
| E2 / E5 | Cancel `disabled={pending}` removed (hour band / shift type) | the matching dialog E2E |
| E3 / E6 | `dismissible={!pending}` removed (hour band / shift type) | the matching dialog E2E |
| E4 / E7 | close control's `if (!pending)` guard removed (hour band / shift type) | the matching dialog E2E |

**Ask First:** `components/ui/dialog.tsx` was changed with the human's explicit approval (2026-09-28). No stale time or retry policy changed.

## Suggested Review Order

1. `apps/web/src/features/teams/services/dependents.ts`: the amended convention, the per-write lists and `refreshAfterWrite`. Then `dependents.test.ts`, which runs them against a real `QueryClient`.
2. `apps/web/src/features/teams/services/roster.ts`: `TEAM_ROSTERS_KEY`, the prefix every roster key is built from.
3. `apps/web/src/features/teams/hooks/use-team-edit.ts` and `use-team-list.ts`: `refresh(landed)`, and the create's list.
4. `apps/web/src/features/members/hooks/use-member-edit.ts`: the three writes (`changeTeam`, `changeStatus`, `submit`), each gated on what landed.
5. `apps/web/src/pages/prijava.test.ts`: the retargeted team guard, the two member refresh guards, and the new describe "a team or membership write re-reads every screen that shows it, once it landed".
6. `apps/web/src/features/{teams,members,hour-bands,shift-types}/services/list.ts` and `teams/services/roster.ts`: the `paused` flag and the `*NoticeOf` functions. Then the list hooks that announce through them, the edit hooks that do not, and each `list.test.ts`/`write.test.ts` paused case.
7. `apps/web/src/features/{shift-types,hour-bands}/components/*-add-dialog.tsx`: the #89 gating. Then `apps/web/src/components/ui/dialog.tsx`: the Escape `keydown` guard and the reopen fallback.
8. E2E: `e2e/tests/teams/teams.spec.ts` (the rename refreshes the member list), `e2e/tests/hour-bands/hour-bands.spec.ts` and `e2e/tests/rotation/rotation.spec.ts` (the held creates), and the page objects.
9. `eslint.config.js` (`FEATURE_PUBLIC.teams`), `team-screens.fixture.ts`, `test/localization-applied.test.ts`, `ARCHITECTURE-SPINE.md` (the Mutation row), `deferred-work.md` (four entries removed).
