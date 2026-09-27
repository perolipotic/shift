---
title: 'Source structure B6 — the team screens become thin pages over features/teams'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: 'fc52d30ea7690bade1e842919d7501df5299bb67'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-source-structure-b5-hour-band-pages.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two pages still hold their screen's refs, state, query, writes and `render*` helpers:
- `pages/ljudi.smjene.tsx` (354 lines), the team list and add dialog;
- `pages/ljudi.smjene.$id.tsx` (405 lines), the team edit dialog over the list.

**Approach:** Follow B4 and B5 exactly (their specs, Change Logs and screen fixtures):
- one hook per screen in `features/teams/hooks/`;
- components in `features/teams/components/`;
- leftover pure logic in `utils/`;
- one fixture, `team-screens.fixture.ts`, with two disjoint sets and the exact exemptions.

Each page keeps its route (`beforeLoad` guard, `FIRST_DESTINATION`) and its composition. The edit page also keeps its `key={id}` wrapper and `<LjudiSmjeneScreen />` behind the dialog. DOM, behaviour and test outcomes stay identical.

## Boundaries & Constraints

**Always:**
- The DOM does not change.
- The exports `LjudiSmjeneScreen`, `ljudiSmjeneRoute`, `LjudiSmjenaScreen` and `ljudiSmjenaRoute` stay.
- Every guard keeps its meaning, with B4 and B5's families applied to both sets:
  - a recursive completeness check over all of `features/teams`, with the exact exemption set. The exemptions are the services, `utils/roster.ts` if still there, and the fixture;
  - disjoint sets, the page first, and a per-file size floor;
  - each named handler declared once per set, in its hook, at 2-space indentation. List: `submit`, `openAdding`. Edit: `submit`, `archive`, `refresh`, `close`;
  - the existing remount guard `<TeamScreen key={id} id={id} />`, kept on the edit page;
  - each ref created once, in the hook, for both `ref=` and any `*Ref=` prop;
  - no handler shadowing;
  - every `<form>` bound to a named submit;
  - writes and `supabaseClient(` only in the hook.
- B5's review additions, applied to both sets:
  - the edit hook is called inside `TeamScreen`, below the key, and not in `LjudiSmjenaScreen`;
  - the edit form is keyed `teamFormKey(team, renames)` in the file that renders it;
  - the list focus effect has its exact shape, with one `useEffect` per set;
  - `archive`'s `finally` disarms (`setArmed(false)`) if the old code did;
  - non-hook parts ban `useNavigate(`, `useQueryClient(`, the object keys `submit:`/`archive:`/`close:`, `supabaseClient`, `TEAMS_TABLE` and `.from(`;
  - attached refs are bare names, never member access;
  - the file walks accept `.[cm]?[jt]sx?` and skip `*.test.*`, `*.d.ts` and `*.fixture.*` by pattern;
  - the localization count is one exact number derived from the fixture, with no tautology.
- Existing single-file checks follow the B4/B5 split. Counts are over the set and also asserted in the hook:
  - `useQuery(` 1 and `teamsQueryOptions(` 1;
  - `readTeams(` 0;
  - `queryKey:` = TEAMS + ROTATION;
  - the `Promise.all([...TEAMS..., ...ROTATION...])` shape, and the invalidates.
- These bans apply to every part: `useMutation`, `.delete(`, `archived: false`.
- Each needle is asserted in the file that holds it:
  - `renderArchived` has no Button, Input, form or select;
  - `if (team.archived) return renderArchived(team);`;
  - `aria-invalid={failure !== null}` and the exact `aria-describedby`;
  - `archive` has no `setFailure(outcome`;
  - `submit` has `setArmed(false)`;
  - one `role="status"` and the `smjene.created` regex on the list;
  - the `onChange` needles `setCreated(false)` and `setSaved(null)`.
- `test/localization-applied.test.ts` gets a `teamsScreenParts()` derivation from the fixture and a recursive walk, with an exact count. This also closes an existing gap: the team pages and `services/{list,write}.ts` are missing from `SOURCES` today.

**Ask First:**
- A guard whose count or assertion would have to change.
- Any DOM or behaviour difference.
- Any change to `services/roster.ts` or the members feature.

**Never:**
- No new UI.
- No change to `services/*` beyond moving inline helpers.
- No barrels.
- No E2E change.
- The other screens are out of scope.

</frozen-after-approval>

## Code Map

(Line numbers may be off by a few lines.)

- `pages/ljudi.smjene.tsx`:
  - `LjudiSmjeneScreen` 73–332 has:
    - refs `nameField`/`creating`;
    - `useState` `pending`/`failure`/`created`/`adding`;
    - an effect at 84;
    - `useQuery(teamsQueryOptions)` at 94.
  - Handlers: `openAdding` 88, and `submit` 99–161 (`createTeam(`, `Promise.all` of TEAMS and ROTATION).
  - `renderTeams(group)` 163.
  - JSX: header, notices, the add Dialog 234–296, and the active and archived cards 305–328.
  - Route 334–354.
- `pages/ljudi.smjene.$id.tsx`:
  - The wrapper 76–80.
  - `TeamScreen` 82–383 has:
    - refs `nameField`/`writing`;
    - `useState` `pending`/`armed`/`failure`/`archiveFailure`/`saved`/`renames`;
    - `useQuery` at 97.
  - Handlers: `close` 108, `refresh` 113, `submit(event, team)` 132 (`renameTeam(`), `archive(team)` 177 (`archiveTeam(`/`setArchiveFailure`).
  - Render helpers: `renderArchiveRefusal` 209, `renderArchive` 218, `renderConfirm` 245, `renderArchived` 281, `renderTeam` 290 (keyed `teamFormKey(team, renames)`), `renderBody` 344.
  - The list sits behind the dialog at 353–380.
  - Route 385–405.
- `pages/prijava.test.ts`:
  - `TEAM_LIST`/`TEAM_EDIT` (169–170) become fixture sets.
  - `SCREENS` controls: list 6, edit 5 (510–511).
  - `t()`: list 15, edit 9.
  - `FORM_SCREENS` 675–690.
  - `IN_FLIGHT_HANDLERS` 780 (`archive`), with totals 10/18.
  - Sweeps 4796–5139.
  - One-read 3349–3383 and the team group 3646–3695 get retargeted.
  - The B4/B5 families to mirror sit at ~2285–2421.
- `test/localization-applied.test.ts`:
  - 303–304 list `services/roster.ts` and `smjene.$id.tsx` (the member/day screen, not `ljudi.smjene.$id.tsx`).
  - Mirror `shiftTypesScreenParts()` and the hour-band derivation.
- `router.test.ts` 25–37 and 230–253: unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `features/teams/{hooks,components,utils}/` and the fixture -- extract both screens.
- [x] Both pages -- compose only.
- [x] `pages/prijava.test.ts`, `test/localization-applied.test.ts` -- retarget per Boundaries, with counts unchanged, adding the guard families.

**Acceptance Criteria:**
- Given both pages, when measured, then each is ≤ 150 lines with no `useQuery`, `useState`, `useRef` or effect.
- Given each new or retargeted guard, when a planted mutation breaks its target, then the guard fails. Spot-check at least:
  - the remount `key` dropped;
  - a component-local `nameField` ref;
  - `archiveTeam(` in a component;
  - `.delete(` in a component;
  - `setArmed(false)` removed from `submit`;
  - a second `role="status"` on the list;
  - a stray nested file.

  Revert each afterwards.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test`, the web build and `pnpm test:e2e` run, then all pass. Unit counts grow only by added cases, and E2E is 68/68.

## Spec Change Log

- Implementation note (no intent change):
  - One fixture, `features/teams/team-screens.fixture.ts`, holds `TEAM_LIST_PARTS`, `TEAM_EDIT_PARTS` and `TEAM_SCREENS_EXEMPT` (the fixture, `services/list.ts`, `services/write.ts`, `services/roster.ts`; the roster lives in `services/`, not `utils/`). No `utils/` module was needed: no pure logic was left over.
  - List set: page (header, the created and refusal notices), `hooks/use-team-list.ts`, `components/team-add-dialog.tsx`, `team-list-section.tsx` (skeleton, then the active and archived cards), `team-table.tsx` (the old `renderTeams`, as `TeamTable`).
  - Edit set: page (keeps the `key={id}` wrapper and `TeamScreen`, which calls `useTeamEdit(id)` and composes the dialog over `<LjudiSmjeneScreen />`), `hooks/use-team-edit.ts`, `components/team-edit-body.tsx` (`renderArchived` and `renderTeam` kept as inner functions at 2-space indentation so `componentFunction` still extracts them), `team-archive.tsx` (the refusal, the offer and the confirmation).
  - `prijava.test.ts`: every team count unchanged (controls 6/5, `t()` 15/9, handler totals). New cases (13): recursive completeness with exact exemptions, disjoint sets, page first, 150-character floor, one declaration per handler in its hook; remount with the hook below the key; ref-once-in-hook over `ref=`/`*Ref=` (×2); archive's `finally` disarms; form keyed `teamFormKey(team, renames)`; one focus effect of exact shape; no handler shadowing and no wiring/client outside the hook (×2); forms bound (×2); writes only in the hook (×2). Retargeted: reads-once (set plus hook counts, `Promise.all` shape in the hook, `useMutation` per part), archived-nothing-writes and the field needles (body part), `submit`/`archive` needles (hook), remount (page), `role="status"` (set count, regex on the page), `onChange` needles (their parts), no delete (per part). `localization-applied.test.ts` gains `teamsScreenParts()` (which now also carries `services/roster.ts`, previously listed by hand) plus both pages from the fixture, and a required-parts case with an exact count of 10.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shift/web build` -- expected: exit 0.
- `pnpm test` -- expected: pass. Rebuild first, and record the baseline first.
- `pnpm test:e2e` -- expected: 68/68, with port 5173 free and not in parallel with unit tests.

## Suggested Review Order

**The thin pages**

- The list page composes the header, the notices and the list section.
  [`ljudi.smjene.tsx:81`](../../apps/web/src/pages/ljudi.smjene.tsx#L81)

- The edit page keeps the per-team remount and the dialog over the list.
  [`ljudi.smjene.$id.tsx:95`](../../apps/web/src/pages/ljudi.smjene.$id.tsx#L95)

**Where the state went**

- The list hook: the name ref, the focus effect, the one read and the create write.
  [`use-team-list.ts:37`](../../apps/web/src/features/teams/hooks/use-team-list.ts#L37)

- The edit hook: rename and archive, each with its in-flight guard and `finally`.
  [`use-team-edit.ts:47`](../../apps/web/src/features/teams/hooks/use-team-edit.ts#L47)

**Guards**

- The two disjoint screen sets and the exact exemptions.
  [`team-screens.fixture.ts:1`](../../apps/web/src/features/teams/team-screens.fixture.ts#L1)
