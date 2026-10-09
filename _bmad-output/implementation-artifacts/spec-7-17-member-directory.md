---
title: 'Members find the directory by team in Više (7.17)'
type: 'feature'
created: '2026-10-09'
status: 'done'
baseline_commit: '9106c2ba88bbf0d3b27932822fb908eb749e8a68'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A member sees colleagues only through `/smjene/$id`, one team at a time, and only for their own team, reached from Danas. Nothing shows who is on each team.

**Approach:** Follow `mockups/people-1.html` §4 and §6. `/ljudi` becomes one destination with role-scoped content, as *Sati* is. An admin keeps today's table. A member-role session gets a read-only directory: every active team with today's members as `Ime · čin · položaj`, the caller's team first and marked *tvoja smjena*, and a *Traži osobu* name search in `?trazi=`. A member reaches it from *Više* → *Pregled* on a phone and from the sidebar on a desktop.

## Boundaries & Constraints

**Always:**
- **Decisions of 2026-10-09:**
  - `/ljudi` is role-scoped. It is not a new `/imenik` route.
  - The search stays, in `?trazi=`, and matches names only.
  - Members on no team today are left out.
- **Data:** only reads that a member-role session already has: `teams` (active teams), `team_roster(team)` per active team, the caller's own team today (`OWN_TEAM_KEY`) and the organization snapshot for the rank and position flags. No migration and no policy change.
- **The line shows** the name, the team (as the group) and, where the organization uses them, rank and position. It never shows allowance, balance, leave, hours, username, e-mail or level (CAP-5, FR-16).
- **Order:** the caller's team first, then the other teams by Croatian collation. Members stay in roster order. A team with zero members today still shows its heading and `0 osoba`, unless a search is active.
- **Search** folds text with the existing `foldForSearch`. Teams with no hit are hidden. When nothing matches, one line says so and offers *Poništi pretragu*.
- **Failure handling:** if any read fails (teams, any roster, or an active team answering `TEAM_ROSTER_UNKNOWN`), the page shows one unavailable notice with a retry. It never shows a partial directory.
- **Fail closed on the role:** if the role cannot be read, `/ljudi` still redirects to `/danas` as it does today. The member branch ignores `dodaj`, so `/ljudi?dodaj=1` never opens the add dialog for a member.
- `/ljudi/$id`, `/ljudi/novi` and `/ljudi/smjene*` keep their own admin guards. `/smjene/$id` stays as it is.
- Rules live in pure `.ts` files with node tests (AD-15). App text is Croatian. Keys are in `hr.json` and registered in the `prijava.test.ts` sweeps.
- Docs are updated in the same change: UX-DR31 and UX-DR33 in `epics.md`, and EXPERIENCE.md §IA (lines 31, 33-40, 45, 64-65, 72, 176).

**Ask First:** any migration, RPC or policy change; showing the directory to an admin.

**Never:** a write action on the directory; links from a member's line to `/ljudi/$id`; a "Bez smjene" group; a new aggregate query key when the existing keys can be composed instead.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Member, own team B | teams A, B, C; caller on B | groups B (*tvoja smjena*), A, C, each with a count | N/A |
| Member, no team | caller on no team today | A, B, C, with no group marked | N/A |
| Search `ana` | hits only in A | only A is shown, with the matching names | N/A |
| Search with no hit | `?trazi=zzz` | one empty line and *Poništi pretragu* | N/A |
| Ranks off | organization does not use ranks | `Ime · položaj` or `Ime` | N/A |
| Roster fails | one RPC errors | unavailable notice with retry, no groups | logged under the stable code |
| Archived team | team archived | not listed | N/A |
| Admin | admin opens `/ljudi` | today's table, unchanged | N/A |

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- `apps/web/src/pages/ljudi.tsx:37-43,58-171` -- `LjudiScreen`, `validateSearch` (`membersSearchOf` + `membersAddSearchOf`) and `beforeLoad` (`mayReadMembers` or a redirect to `FIRST_DESTINATION`). Change the guard so it returns the role as route context: an admin gets the table, `member_role` gets the directory, and a failure still redirects.
- `apps/web/src/features/navigation/utils/destinations.ts:107` -- change `nav.ljudi` to `roles: EVERYONE`. `phoneNavigationFor` then puts it under *Pregled* for a member, while an admin keeps it as a tab.
- `apps/web/src/features/teams/services/roster.ts:61-78,169,290,359,465` -- `TeamRosterMember`, `readTeamRoster`, `TEAM_ROSTER_KEY`, `OWN_TEAM_KEY`, `readOwnTeamToday`, `ownTeamSurfaceStateOf`.
- `apps/web/src/features/teams/services/list.ts:196,251` -- `splitTeams`, `teamsQueryOptions`. Call `useQuery` directly, not `useTeamList`, because that hook carries the admin create flow.
- `apps/web/src/features/teams/hooks/use-team-roster.ts:40-68` -- precedent for reading the snapshot flags (`ranksShown`, `positionsShown`).
- `apps/web/src/features/teams/components/team-roster.tsx:36-48` -- the line format (`rosterRankMessageKey`, `rosterPositionMessageKey`, `rosterLineOf`, `Avatar`). Extract the list into a component that takes `(members, shown, positionShown)`.
- `apps/web/src/features/members/services/list.ts:~1797,2081,~2117` -- `searchOfText`, `foldForSearch`, `searchedMembers`. Export what the name-only match needs.
- `apps/web/src/features/teams/services/dependents.ts:53-86` -- `TEAM_ROSTERS_KEY` and `OWN_TEAM_KEY` are already invalidated. Nothing to add.
- `apps/web/src/features/today/hooks/use-admin-today.ts:43-53` -- `useTodayRole`, the cached-role precedent, if route context does not fit.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/features/teams/services/directory.ts` (+ `.test.ts`) -- add the pure `memberDirectoryOf(activeTeams, rosters, ownTeamId, query)`, which handles groups, order, count, the own-team mark, the search and the empty or failed state -- it carries every rule in the matrix.
- [x] `apps/web/src/features/teams/hooks/use-member-directory.ts` -- compose the teams query, `useQueries` over the active team ids with the roster's key, function and stale time, the own-team query and the snapshot flags. Add one retry that refetches the failed queries.
- [x] `apps/web/src/features/teams/components/{roster-lines,member-directory}.tsx`, `team-roster.tsx` -- extract the line list and add the directory UI: search, group headings with count and *tvoja smjena*, the empty-search line and the notice.
- [x] `apps/web/src/pages/ljudi.tsx` -- add the role branch, rewrite the doc comment, drop `dodaj` for a member and give the member title and lede ("Ljudi", "Tko je u kojoj smjeni.").
- [x] `apps/web/src/features/navigation/utils/destinations.ts` (+ test) -- set `nav.ljudi` to EVERYONE. In the test, the member gains Ljudi, and the member's *Više* is `everyone: [nav.ljudi]`.
- [x] `apps/web/src/lib/i18n/locales/hr.json`, `pages/prijava.test.ts` -- add the `ljudi.directory.*` keys and register the new files in the `MEMBER_LIST` and `ljudi.*` sweeps.
- [x] `apps/web/src/router.test.ts` -- rework `LEVEL_GUARDED_ROUTES` and the 1634-1795 block. A member now reaches `/ljudi`, and a failed role read still redirects.
- [x] `e2e/tests/auth/authorization.spec.ts`, `layout/phone-navigation.spec.ts`, `auth/sign-in.spec.ts`, `utils/i18n.ts` -- a member is no longer sent away from `/ljudi`, and their *Više* holds Ljudi (fix the test that clicks Sati). Add one member spec that opens the directory from *Više* and asserts no allowance or e-mail appears.
- [x] `_bmad-output/planning-artifacts/epics.md`, `ux-designs/ux-shift-2026-09-02/EXPERIENCE.md` -- update UX-DR31 and UX-DR33, and the §IA lines listed above.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- mark 7.13 `done` (7.13b merged as #185). `epic-7-context.md` is already recompiled.

**Acceptance Criteria:**
- Given a member-role account, when they open *Ljudi* from *Više*, then they see members grouped by team, read-only.
- Given any member line, then it shows only name, team and, where used, rank and position.
- Given the change merges, then UX-DR31, UX-DR33 and EXPERIENCE.md §IA describe the directory.

## Spec Change Log

## Design Notes

Role-scoped `/ljudi` follows the decision of 2026-09-04 for `Sati`: one destination, with the role deciding the content. It also keeps the *Više* grouping honest, because `phoneNavigationFor` derives the groups from `roles`. A member-only `/imenik` would land in *Postavke*.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm --filter ./apps/web test` -- expected: pass
- `pnpm e2e` (or the repo's e2e script) for the touched specs -- expected: pass

**Manual checks:**
- At 390 px, sign in as a demo member, open *Više* → *Ljudi*, and check the groups, the own-team mark and the search in both themes.

## Suggested Review Order

**Role-scoped `/ljudi`**

- Entry point: the guard returns the view instead of redirecting a member; failure still redirects.
  [`ljudi.tsx:218`](../../apps/web/src/pages/ljudi.tsx#L218)

- Fails closed: only the two known views render anything.
  [`ljudi.tsx:75`](../../apps/web/src/pages/ljudi.tsx#L75)

- The level rule, named by rank order rather than a literal.
  [`list.ts:946`](../../apps/web/src/features/members/services/list.ts#L946)

- One table change puts Ljudi in a member's Više → Pregled and sidebar.
  [`destinations.ts:112`](../../apps/web/src/features/navigation/utils/destinations.ts#L112)

**Directory rules (pure, node-tested)**

- Groups, order, own-team mark, search and the all-or-nothing failure.
  [`directory.ts:131`](../../apps/web/src/features/teams/services/directory.ts#L131)

- One failed/loading predicate shared by the directory and its retry.
  [`directory.ts:55`](../../apps/web/src/features/teams/services/directory.ts#L55)

- Retry re-reads failed reads, and the team list when a roster is unknown.
  [`directory.ts:198`](../../apps/web/src/features/teams/services/directory.ts#L198)

- Name-only search reuses the member list's folding.
  [`list.ts:2168`](../../apps/web/src/features/members/services/list.ts#L2168)

**Reads and UI**

- Composes existing keys: teams, one roster per active team, own team, snapshot.
  [`use-member-directory.ts:57`](../../apps/web/src/features/teams/hooks/use-member-directory.ts#L57)

- Directory UI: search, group headings with count, empty and failed states.
  [`member-directory.tsx:36`](../../apps/web/src/features/teams/components/member-directory.tsx#L36)

- Line list extracted so `/smjene/$id` and the directory render identically.
  [`roster-lines.tsx:19`](../../apps/web/src/features/teams/components/roster-lines.tsx#L19)

- Member branch of the page; ignores `dodaj`.
  [`ljudi.tsx:86`](../../apps/web/src/pages/ljudi.tsx#L86)

**Docs**

- UX-DR31–33 rewritten for five member destinations and the directory.
  [`epics.md:147`](../planning-artifacts/epics.md#L147)

- §IA: member destinations and the new inventory row.
  [`EXPERIENCE.md:33`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/EXPERIENCE.md#L33)

**Tests**

- Matrix rows, retry plan and read states.
  [`directory.test.ts:1`](../../apps/web/src/features/teams/services/directory.test.ts#L1)

- `/ljudi` moved to role-scoped paths; admin, member and failed-role cases.
  [`router.test.ts:1`](../../apps/web/src/router.test.ts#L1)

- Member e2e: Više entry, narrowness, search, `?dodaj=1`, failure and retry, desktop sidebar.
  [`member-directory.spec.ts:80`](../../e2e/tests/people/member-directory.spec.ts#L80)
