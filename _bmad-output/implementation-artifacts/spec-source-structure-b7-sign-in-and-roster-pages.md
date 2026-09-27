---
title: 'Source structure B7 — the sign-in and team-roster screens become thin pages'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: 'b1a607eab7d9403fce16f8102bd2169a15206f6a'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-source-structure-b6-team-pages.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two pages are still over the proposal's 150-line page budget:
- `pages/prijava.tsx`, at 279 lines, holds the sign-in's refs, the in-flight ref, state and `submit`.
- `pages/smjene.$id.tsx`, at 166 lines, holds the team roster's two reads and its derivations.

`pages/prijava-organizacija.tsx` (133 lines) is already within budget, so it stays as it is.

**Approach:** Follow B4–B6 (their specs, Change Logs and screen fixtures).
- **Sign-in:** add `features/auth/hooks/use-sign-in.ts` (slug in, then the refs, `exchanging`, `failure`, `pending` and `submit`) and `features/auth/components/sign-in-form.tsx` (the form). Add a `features/auth/sign-in-screen.fixture.ts` with the set and the exact exemptions.
- **Roster:** add `features/teams/hooks/use-team-roster.ts` (both queries and the derivations) and `features/teams/components/team-roster.tsx` (the `renderRoster` and `renderBody` output). This becomes a third, disjoint set in B6's `team-screens.fixture.ts`.
- Each page keeps its route, its `beforeLoad` (or its lack of one), and its composition. The sign-in page keeps `const { slug } = prijavaRoute.useParams()`. The roster page keeps `<RosterScreen key={id} id={id} />`.
- DOM, behaviour and test outcomes stay identical.

## Boundaries & Constraints

**Always:**
- The DOM does not change.
- The exports `SignInScreen`, `prijavaRoute`, `SmjenaScreen` and `smjenaRoute` stay.
- `prijava-organizacija.tsx` is untouched.
- Every guard keeps its meaning. B4–B6's families apply to both new sets:
  - recursive completeness over `features/auth` (a new check) and over `features/teams` (B6's check, extended), each with exact exemptions;
  - disjoint sets, with the page first and a per-file floor;
  - handlers declared once, in the hook, at 2-space indentation;
  - refs created once, in the hook, and attached as bare names;
  - no handler shadowing, and a ban on `useNavigate(`/`useQueryClient(` outside the hook, except where the page itself needs `useParams`;
  - every form bound to a named submit;
  - effects, `supabaseClient` and table access only in the hook;
  - the remount on the roster, with its hook called below the key;
  - file walks by pattern;
  - `localization-applied` derives the parts from the fixtures with an exact count.
- Rules from B6's review:
  - Each set's hook (`useSignIn(`, `useTeamRoster(`) is called exactly once across the set, and only in its page.
  - The object-key ban covers every handler name in the set.
  - Effects are counted as `Effect(`, which also catches layout and insertion effects, with an exact count per set.
- Per-file sign-in needles are asserted in the file that must hold them:
  - **Hook:** the imports `@/lib/supabase/client` and `@/features/auth/services/sign-in`, `supabaseClient()`, `signIn(…slug,`, `navigate({ to: '/' })` inside `submit`, the `console.error` in the catch, and the `SIGN_IN_UNAVAILABLE` handling.
  - **Form component:** `method="post"`, 2 inputs, 1 button, the input and button heights, labels, ids, `aria-describedby`, autocomplete tokens, the masked password, keyboard attributes, `required`, no `value=`, and `t(signInMessageKey(`.
  - **Page:** `const { slug } = …useParams()`.
  - **Every part:** no `fetch(`, `shift.invalid`, `localStorage` or `createClient(`.
- Per-file roster needles:
  - **Hook:** `useQuery(` 2, `queryKey:` 2, `queryKey: TEAM_ROSTER_KEY(id)`, `staleTime: TEAM_ROSTER_READ_STALE_MS`, `retry: false`, `const shown = ranksShown(` and `const positionShown = positionsShown(snapshot);`.
  - **Component:** `rosterRankMessageKey(member.fireRank, shown)`, `rosterLineOf(member.name, rank, position, (key) => t(key))` and the `line.key === null` branch.
  - **Every part:** the only link is `['/danas']`, and there is no form, no write and no `members/services/list` import.

**Ask First:**
- A guard whose count or assertion would have to change.
- Any DOM or behaviour difference.
- Any change to `services/*` or to `prijava-organizacija.tsx`.

**Never:**
- No new UI.
- No barrels.
- No E2E change.

</frozen-after-approval>

## Code Map

(Line numbers are approximate.)

- `pages/prijava.tsx`:
  - `SignInScreen` runs 63–225. `submit` is at 78–129. The route is at 227–279.
- `pages/smjene.$id.tsx`:
  - The wrapper runs 60–64.
  - `RosterScreen` runs 66–160, with two `useQuery` calls. `renderRoster` is at 89 and `renderBody` at 124.
  - The route is at 162–166.
- `pages/prijava.test.ts`:
  - **Constants:** `SCREEN` 72, `ORGANIZATION` 74 (unchanged) and `TEAM_ROSTER` 184.
  - **Counts:** controls 3 and 1; strings 5 and 4 (1530, ~1689).
  - **Forms and in-flight handlers:** `FORM_SCREENS` 655, and `IN_FLIGHT` `submit/exchanging` (5143).
  - **Sign-in needles:** 2638, 4325–4558, 5025, 5075, 5091, 5103, 5131, 5282–5392.
  - **Roster needles:** `SURFACES` 3955, 4050, 6109–6169.
  - **B4–B6 families:** ~2310–2635 and B6's.
- `test/localization-applied.test.ts`: 221, 232 and ~356–357.
- `router.test.ts`: 43–47, 909–1100 and 1725–1745. Unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `features/auth/{hooks,components}/`, the auth fixture, and `features/teams/{hooks,components}/` roster parts -- extract.
- [x] `pages/prijava.tsx` and `pages/smjene.$id.tsx` -- compose only.
- [x] `pages/prijava.test.ts` and `test/localization-applied.test.ts` -- retarget per Boundaries, with counts unchanged.

**Acceptance Criteria:**
- Given both pages, when measured, then each is ≤ 150 lines, has no `useQuery`, `useState`, `useRef` or effect, and has no `useNavigate` in the sign-in page.
- Given each retargeted guard, when a planted mutation breaks its target, then the guard fails. Revert each mutation afterwards. Spot-check at least:
  - `method="post"` dropped from the form;
  - `navigate({ to: '/' })` moved out of `submit`;
  - `signIn(` in the form component;
  - `retry: false` dropped from the roster hook;
  - the roster remount key dropped;
  - a stray file under `features/auth`.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test`, the web build and `pnpm test:e2e` run, then all pass. Unit counts grow only by added cases, and E2E is 68/68, including the sign-in specs.

## Spec Change Log

- Implementation note (no intent change):
  - `features/auth/sign-in-screen.fixture.ts` holds `SIGN_IN_PARTS` (page, `hooks/use-sign-in.ts`, `components/sign-in-form.tsx`) and `SIGN_IN_SCREEN_EXEMPT` (the fixture, `services/address.ts`, `services/sign-in.ts`, `services/sign-out.ts`). `team-screens.fixture.ts` gains `TEAM_ROSTER_PARTS` (page, `hooks/use-team-roster.ts`, `components/team-roster.tsx`); the team exemptions are unchanged (only the roster's `why` text was reworded).
  - `pages/prijava.tsx` is 111 lines (the page keeps the `AuthLayout`, the card and its `<h1>`, and renders `<SignInForm screen={screen} />`); `pages/smjene.$id.tsx` is 78 lines (the page keeps the header, the link back and the refusal, and renders `<TeamRoster screen={screen} />`). `TeamRoster` keeps `renderRoster`/`renderBody` as inner functions at 2-space indentation.
  - `prijava.test.ts`: `SCREEN` and `TEAM_ROSTER` are now fixture sets; every count unchanged (controls 3/1, strings 5/4, `IN_FLIGHT` 10/18). New cases (9): sign-in completeness with exact exemptions, disjoint from the team sets and the prompt, page first, 150-char floor, `submit` once in the hook; one `useSignIn(` in the page; refs once in the hook as bare names (and exactly three `= useRef`); no handler, wiring, `signIn(`, state or `useNavigate` outside the hook; one form bound to `submit` and zero `Effect(`; roster remount with the hook below the key; no handler, ref, form, state or effect on the roster; no wiring or `useQuery(` outside the roster hook; plus the roster row in the one-hook-instance `it.each`. B6's team completeness now covers three disjoint sets. Retargeted per Boundaries: the sign-in needles to the form, hook or page, the forbidden tokens per part; the roster reads over the set and in the hook, no-write per part, the link over the set and in the page, the organization policy in the hook, the rank/position needles split hook/component.
  - `localization-applied.test.ts`: `authScreenParts()` (recursive, from the fixture) replaces the hand-listed `sign-in.ts`, `address.ts` and `sign-out.ts`; the sign-in page and the roster page come from the fixtures. New case: auth parts, exact count 5; the team case now also pins 12.
  - Unit counts: baseline 256 / 2489 / 2951, after 256 / 2498 / 2952. E2E 68/68.
- Review follow-up (no intent change): `method="post"` is read off the `<form>` opening tag; new cases pin no bare `<input`, no local `slug` and `useSignIn(slug: string)`, the form's five names taken from `screen`, the roster's `shown`/`positionShown` taken from `screen` and returned by the hook, the roster read's `staleTime` and `refetchOnWindowFocus: false`, no native button or `on[A-Z]*=` on the roster (its one `<Button asChild>` must wrap the `/danas` link), and a wider non-hook state/navigation ban (`useReducer`, `useActionState`, `useOptimistic`, `useTransition`, `useFormStatus`, `useRouter`, …) with `useParams(` once, in the page. Sign-in disjointness now runs against every other `SCREENS` entry; the auth exemptions are compared exactly on both sides. Comments fixed. Unit counts 256 / 2503 / 2952; E2E 68/68. Temporary E2E checks (roster count, archived notice on an empty archived team, sign-in recovery and the unavailable path) passed and were reverted.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shift/web build` -- expected: exit 0.
- `pnpm test` -- expected: pass. Rebuild first, and record the baseline first.
- `pnpm test:e2e` -- expected: 68/68, with port 5173 free and not in parallel with unit tests.

## Suggested Review Order

**Sign-in**

- The hook: refs, the in-flight guard, and the exchange with the route's slug.
  [`use-sign-in.ts:30`](../../apps/web/src/features/auth/hooks/use-sign-in.ts#L30)

- The form: the `method="post"` tag, the masked password and the autocomplete tokens, moved verbatim.
  [`sign-in-form.tsx:14`](../../apps/web/src/features/auth/components/sign-in-form.tsx#L14)

**Roster**

- Both reads, and the rank/position settings the component is handed.
  [`use-team-roster.ts:39`](../../apps/web/src/features/teams/hooks/use-team-roster.ts#L39)

**Guards**

- The sign-in set and its exact exemptions.
  [`sign-in-screen.fixture.ts:1`](../../apps/web/src/features/auth/sign-in-screen.fixture.ts#L1)
