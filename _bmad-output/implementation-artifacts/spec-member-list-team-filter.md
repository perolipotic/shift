---
title: 'Member list team filter'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: '4979509a6560547aa6c450dfaa3277615224e44b'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.7b gave every member a team, but `/ljudi` can only be narrowed by search and permission level. An admin with several hundred members cannot see one team. UX-DR17/UX-DR19 ask for a team filter whose options come from live records, which states a count and resets in one action. It was split out of 1.7b (deferred-work.md, human decision 2026-09-24).

**Approach:** Add a second native `<select>`, labelled "Smjena", beside the level filter. Its options are derived from the same members snapshot: every team somebody is on today (organization's today), plus "Bez smjene". All options go through the existing pure narrowing in `@/members/list`. Counts are faceted. A "Poništi filtre" button returns search, level and team to "all" in one action.

## Boundaries & Constraints

**Always:**
- One snapshot, one query key (AD-13). Team options, their counts, the level counts and the rows come from the single `MEMBERS_LIST_KEY` read, in the same `narrowMembers` traversal. The team is `memberTeamOn(member, today)`, and scheduled moves are ignored.
- Counts are faceted. A team option counts over search + chosen level. A level option counts over search + chosen team. "All" options count over search plus the other axis. Zero counts are rendered, never hidden (UX-DR20).
- Team options: "Sve smjene" first, then teams ordered by name with the Croatian collator (`compareText`), then "Bez smjene" last. Option values are the team id, or fixed `all`/`none` sentinels that cannot collide with a UUID.
- Choosing a value is a lookup with an explicit fallback, as `chooseLevel` does. A value that is not among the current options (a team nobody is on after a refetch, or a stale value) falls back to "all" and never yields an empty list silently. A chosen team that vanishes from the snapshot is treated as "all" during narrowing, too.
- Reset is one button (`h-11`, outline). It clears search, level and team. It is disabled while nothing is narrowed and while the list is unanswered.
- All decisions are pure functions in `@/members/list`, executed by `members/list.test.ts`. `ljudi.tsx` holds markup and state only. `NarrowingInputs` gains `team`, and `narrowingDependencies` derives it.
- Every string goes through `t()`. The label reuses `smjene.membership.column`. "No team" is said in positive words. Team names are data and interpolated, never keys. Each new plural message has all three Croatian forms.
- Every native `<select>` keeps the literal documented class string (`components/README.md:41`), because the 44 px sweep reads it off the quoted `className`. No shared constant is used.

**Ask First:**
- Showing teams with zero members today (this needs a second read of `teams`).
- Any change to the summary stat cards, the sort, or the columns.

**Never:**
- No second query and no read of `TEAMS_LIST_KEY` on this screen.
- No URL search params or persistence. State stays in the component (a separate ledger entry covers this).
- No vendored shadcn `Select`, no new dependency, no migration, no route.
- No separate per-member filter. The search box is the member axis here.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Options from snapshot | Members on A (2), B (1), none (1) | `Sve smjene: 4`, `A: 2`, `B: 1`, `Bez smjene: 1` | N/A |
| Filter by team | Team = A | Only A's members today; count line states 2 | N/A |
| No team | Team = none | Only members with no team today | N/A |
| Scheduled move | On A today, moving to B tomorrow | Counted and shown under A only | N/A |
| Faceted counts | Level = admin, team = A | Team options count admins; level options count A's members | N/A |
| Search matches nobody | Any team chosen | Every option reads 0; rows empty; count line `0 osoba` | N/A |
| Vanished team | Chosen A; refetch has nobody on A | Option gone; narrowing treats as all | Fallback to all |
| Unknown value | `chooseTeam('x')` | `all` | Fallback |
| Reset | Search, level, team all set | One press → all three back to all/empty | N/A |
| Nothing narrowed | Defaults | Reset disabled | N/A |
| Unanswered | Loading or refused | Both selects and reset disabled | N/A |

</frozen-after-approval>

## Code Map

Baseline `4979509`. `nvm use` (Node 24), then `pnpm build` before `pnpm test`, and record the counts at baseline first.

- `apps/web/src/members/list.ts` -- the only rule module.
  - Level filter pattern to mirror: `ALL_LEVELS`/`LevelFilter`/`LEVEL_FILTERS`/`chooseLevel` `:1323-1356`, `levelFilterMessageKey` `:1429`.
  - Team reading: `memberTeamOn` `:373`, `MemberTeam` `:294`. Collation: `compareText` (used in `compareMembers` `:1585`).
  - `narrowMembers` `:1628` computes counts over `searchedMembers` and must become faceted over both axes. Its return type `MembersNarrowing` `:1551` gains team options with counts.
  - `NarrowingInputs` `:1702`, `narrowingDependencies` `:1720`, `narrowFrom` `:1725` and `membersViewOf` `:1752` need `team` threaded through. The summary stays unfiltered.
  - Add a pure "is anything narrowed" predicate for the reset.
- `apps/web/src/routes/ljudi.tsx` -- state `:227-229`, level select `:343-368` (copy its literal class, `disabled`, `aria-describedby`), `inputs` `:260`. Add team state, select, and reset button. Update the header comment's "three counts beside the filter" wording.
- `apps/web/src/i18n/locales/hr.json` `:37-39` -- add `ljudi.filterTeamAll`, `ljudi.filterTeam` (`{team}` + plural), `ljudi.filterNoTeam`, `ljudi.reset`. All plural messages use the `osoba/osobe/osoba` forms like `filterAll`.
- `test/resource-hygiene.test.ts` -- register the plural keys in `SANCTIONED_PLURAL_KEYS` `:36-64` and `ljudi.reset` in the screen list, each with a comment.
- `apps/web/src/routes/prijava.test.ts` -- member list `expectedControls` `:318` goes 6 → 8 (the select and the reset). The select-look guard `:2752-2773` goes five → six. Update the comments. Also check the used/declared key set sweep and the bare-JSX sweep still pass.
- `apps/web/src/members/list.test.ts` -- existing narrowing tests call `narrowMembers(members, search, level, sort, today)` positionally (`:624-840`). Keep them compiling. The dependency test at `:1154-1166` enumerates fields and must include `team`. The team fixture is `members/team-history.fixture.ts`.
- `test/localization-applied.test.ts:100,168` -- already lists `ljudi.tsx` and `members/list.ts`. No change is expected.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/members/list.ts` -- add `ALL_TEAMS`/`NO_TEAM` sentinels, `TeamFilter`, `chooseTeam(value, options)`, team-option derivation, faceted counts in `narrowMembers` (team parameter), `team` in `NarrowingInputs`/dependencies/`narrowFrom`, message-key mapping for team options, and an `isNarrowed` predicate -- the rules stay executable.
- [x] `apps/web/src/members/list.test.ts` -- cover every I/O matrix row, the collation order with the no-team option last, and the dependency array including `team` -- pins the rules.
- [x] `apps/web/src/routes/ljudi.tsx` -- team state, a second native select with the literal class, reset button, and disabled while unanswered -- markup only.
- [x] `apps/web/src/i18n/locales/hr.json` -- four keys -- Croatian copy.
- [x] `test/resource-hygiene.test.ts`, `apps/web/src/routes/prijava.test.ts` -- register keys, bump the control and select counts with comments -- keep the source-level guards honest.

**Acceptance Criteria:**
- Given the list has loaded, when the admin opens "Smjena", then each option names a team from the snapshot (none hard-coded) and states its member count in all three Croatian forms.
- Given a team and a level are chosen, when the admin presses "Poništi filtre", then search, level and team return to their defaults in one action and the full list shows.
- Given any change, when `pnpm typecheck`, `pnpm lint` and `pnpm test` run, then all pass, and the test count is the baseline plus the new cases.

## Spec Change Log

- 2026-09-25 (implementation): the three team option keys live under `smjene.membership.filterAll`/`filterTeam`/`filterNone`, not `ljudi.filterTeam*`. `test/resource-hygiene.test.ts` allows `smjen` only inside the `smjene.` namespace, and `Sve smjene`/`Bez smjene` contain it. `ljudi.reset` stays as planned. The frozen intent is unchanged. While today is unknown, the team filter offers only "Sve smjene" and narrows nothing. In practice this only happens when the list is empty or unanswered.

## Design Notes

A faceted count means "the rows you would get by picking this option, with everything else as it is". Level counts over search alone, which is today's rule, would disagree with the rows once a team is chosen. This is the same drift `narrowMembers`' doc warns about.

The options are derived rather than read from `teams`. A team with nobody on it today would only ever yield `0`, and fetching it needs a second read behind one figure (AD-13).

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint` -- expected: clean
- `pnpm build && pnpm test` -- expected: all green, count = baseline + new

**Manual checks:**
- Run `pnpm dev` against the shared local stack as the fixture admin. On `/ljudi`, pick a team: the rows and the count line agree, the level counts change, and reset restores everything.

## Suggested Review Order

**Narrowing and faceted counts**

- Entry point: one traversal yields rows, level counts and team counts, faceted.
  [`list.ts:1778`](../../apps/web/src/members/list.ts#L1778)

- A vanished team is applied as "all", never as an empty list.
  [`list.ts:1793`](../../apps/web/src/members/list.ts#L1793)

- Options come from teams somebody is on today, collated, with "Bez smjene" last.
  [`list.ts:1405`](../../apps/web/src/members/list.ts#L1405)

- UUID-safe sentinels for "all" and "no team".
  [`list.ts:1358`](../../apps/web/src/members/list.ts#L1358)

**Choosing, settling and resetting**

- A lookup with a fallback, as `chooseLevel` does; stale values show everyone.
  [`list.ts:1429`](../../apps/web/src/members/list.ts#L1429)

- The stored team settles to the applied one, so a vanished team never returns alone.
  [`list.ts:1465`](../../apps/web/src/members/list.ts#L1465)

- Reset is live only when something is narrowed.
  [`list.ts:1483`](../../apps/web/src/members/list.ts#L1483)

- `team` joins the derived memo dependencies.
  [`list.ts:1911`](../../apps/web/src/members/list.ts#L1911)

**Screen wiring**

- Render-time settle of the stored team; cannot loop because it converges.
  [`ljudi.tsx:290`](../../apps/web/src/routes/ljudi.tsx#L290)

- Reset clears all three and returns focus to search.
  [`ljudi.tsx:310`](../../apps/web/src/routes/ljudi.tsx#L310)

- Second native select with the literal documented class, showing the applied team.
  [`ljudi.tsx:415`](../../apps/web/src/routes/ljudi.tsx#L415)

**Copy and tests**

- Team strings live under `smjene.*` (hygiene rule), three plural forms each.
  [`hr.json:248`](../../apps/web/src/i18n/locales/hr.json#L248)

- Matrix rows, collation order, faceted agreement, settle cases and exact plural strings.
  [`list.test.ts:880`](../../apps/web/src/members/list.test.ts#L880)

- Source-level wiring guard with mutation self-checks for the `.tsx`.
  [`prijava.test.ts:2795`](../../apps/web/src/routes/prijava.test.ts#L2795)

- New keys registered as sanctioned plurals.
  [`resource-hygiene.test.ts:71`](../../test/resource-hygiene.test.ts#L71)
