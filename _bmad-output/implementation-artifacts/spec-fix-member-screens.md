---
title: 'The member screens read the organization one way, mark refused dates invalid, and keep every effect in its handler'
type: 'bugfix'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '66a29f6612f48502b703c955cd7c4e6e90ee6a53'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-source-structure-b1-members-pages.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `deferred-work.md` lists three pre-existing member-screen items, recorded by B1's review:
1. **Two read policies on one cache entry.** `use-member-create.ts` reads `ORGANIZATION_SNAPSHOT_KEY` without `retry: false` or `staleTime`, while `use-member-edit.ts` sets both. Its own comment says it must be "a second consumer of one cache entry rather than a second read policy on it". The `data !== undefined && data.ok ? data.snapshot : null` unwrap is also duplicated.
2. **The status and team date fields lack `aria-invalid`.** On a preflight refusal, `armStatus`/`armTeam` move focus to the date field, but the field is never marked invalid. The leave field is marked, through `invalidField`.
3. **A guard gap.** No source guard catches `changeMemberStatus(`, `changeMemberTeam(` or `resetPassword(` placed outside its named in-flight handler. Only `submit`'s effect has such a check. This was confirmed on unmodified HEAD, where the mutation passes all of `prijava.test.ts`.

**Approach:**
- Add `organizationSnapshotQueryOptions()` beside `readOrganization` in `features/organization/services/snapshot.ts`, carrying the edit screen's policy, and use it in both member hooks. The settings screen already reads the same key; adopt the same options there only if the result is identical and its guards keep their meaning. Otherwise leave it and note why.
- Mark the status and team date fields `aria-invalid` when their refusal names them, mirroring the leave field.
- Extend the in-flight guard in `pages/prijava.test.ts` so every effect call on the edit screen must sit inside its named handler.

## Boundaries & Constraints

**Always:**
- Behaviour is otherwise unchanged. After the change there is one read policy for the org snapshot.
- The B1 guards keep passing. Counts change only by added cases. A guard that pins the query shape (`useQuery(` counts, `queryKey:` counts, `retry: false`) is retargeted to the options factory without losing meaning: the key, retry and staleTime are asserted in `snapshot.ts`, and each hook calls the factory exactly once.
- The organization feature's public surface grows only by the factory. Add it to `FEATURE_PUBLIC` in `eslint.config.js` if it lives in a module not already listed; `services/snapshot` is already public.
- **Tests:**
  - A unit test for the factory's options.
  - An E2E test or unit-level check that a refused status or team date is marked `aria-invalid`, where it can be driven.
  - Planted-mutation proof for the new in-flight guard (e.g. a `changeMemberStatus(` call outside `changeStatus` fails it).

**Ask First:**
- Anything that changes when or how often the organization is re-read.
- The multiple-`role="alert"` question. This is a UX decision about which notice wins, so it stays in `deferred-work.md`.

**Never:**
- No new UI.
- No change to write services.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/members/hooks/use-member-create.ts`, `use-member-edit.ts` -- the two `useQuery` calls on `ORGANIZATION_SNAPSHOT_KEY`, and the duplicated unwrap.
- `apps/web/src/features/organization/services/snapshot.ts` -- `readOrganization`, `ORGANIZATION_SNAPSHOT_KEY`, `ORGANIZATION_READ_STALE_MS`.
- `apps/web/src/features/organization/hooks/use-organization-settings.ts` -- the settings read of the same key.
- `apps/web/src/features/members/components/member-status-card.tsx`, `member-team-card.tsx` -- the date inputs, their `aria-describedby`, and the refusal codes naming the date.
- `apps/web/src/features/members/hooks/use-member-edit.ts` -- `armStatus`, `armTeam`, `changeStatus`, `changeTeam`, `issue`.
- `apps/web/src/pages/prijava.test.ts` -- `FORM_SCREENS` and `IN_FLIGHT_HANDLERS`, the member sets and the member query checks.
- `apps/web/src/features/organization/services/snapshot.test.ts` -- the organization query guards.
- `test/localization-applied.test.ts`, `eslint.config.js` (`FEATURE_PUBLIC`).

## Tasks & Acceptance

**Execution:**
- [x] Add the factory, adopt it in both member hooks, and share the unwrap.
- [x] Add `aria-invalid` on the status and team date fields.
- [x] Extend the in-flight guard.
- [x] Add the tests. Remove the two `deferred-work.md` entries this closes (B1's guard gap and the B1 policy/aria entry, keeping the `role="alert"` part as its own entry).

**Acceptance Criteria:**
- Given the fixes reverted, when the new tests run, then they fail.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test` (after a web build) and `pnpm test:e2e` run twice, then all pass.

## Spec Change Log

- **2026-09-27, review triage.** Six changes:
  - **Re-read timing on the create screen.** The create screen's re-read timing changed as the Approach prescribes: a successful snapshot is not re-read within `ORGANIZATION_READ_STALE_MS` of the last read, and a failure is not retried. A failed snapshot is never held fresh. `readOrganization` resolves a failure as data, so the factory's `staleTime` is a function that returns `ORGANIZATION_READ_STALE_MS` for an `ok` answer and 0 otherwise. The next mount or focus then re-reads a failure, and one transient failure no longer blocks `/ljudi/novi` for five minutes. This was flagged to the human.
  - **Settings screen not adopted.** It keeps TanStack's defaults, because the factory's bound would change when opening it re-reads the organization (Ask First).
  - **Where the unwrap lives.** The shared unwrap is `ranksShownIn` in `features/members/utils/rank.ts`, not a `select` in the factory. A `select` would hand `createFormStateOf` and `teamPositionsSettingOf` a different shape, and both live in `features/members/services/write.ts` (Never: no change to write services). `answeredSnapshotOf` was removed, so `snapshot.ts` grows only by the factory.
  - **When a date is marked.** The date mark is raised with its origin (`dateMarkFor(refusal, history, fromPreflight)`). `MEMBER_WRITE_INVALID` marks the date only from the preflight, because from the server write it is any 22xxx/23xxx. The mark holds the refusal it was raised for, by identity, and the block's history key (`dateMarked`). A later refusal unmarks the date, and so does a block that remounted on a new history.
  - **Harder in-flight guard.** It also counts the effect's bare name: once in an import, once inside its handler, and never renamed by `as`.
  - **Exhaustive code partition.** `date-refusal.test.ts` classifies every `MemberWriteFailure`, keyed by the union, so a new code fails to compile until it is classified.

## Verification

**Planted mutations (each restored after the run):**

| Mutation | Failed |
|---|---|
| `changeMemberStatus(` called inside `armStatus` | "calls its effect only from inside its own handler … status change" (only) |
| `changeMemberTeam(` called inside `pickTeam` | the same test, team change (only) |
| `resetPassword(` in a stray function in `member-reset-card.tsx` | the same test, password reset (only) |
| `const mutationFn = changeMemberStatus;` outside the handler | the same test, status change |
| `changeMemberTeam.call(…)` outside the handler | the same test, team change |
| second import `resetPassword as sendReset` | the same test, password reset |
| create hook back to its old inline `useQuery` | "offers the rank on the member create form…", "reads the organization on the member create form through the one read policy" |
| hand-written unwrap in the create hook | the same two |
| factory `retry: 3` / no `staleTime` (first pass) | "registers the snapshot key under the chrome's own policy" |
| factory `staleTime` flat / failure held for the bound | "holds a snapshot fresh for the bound, and a failed answer fresh for no time at all" |
| `ranksShownIn` shows ranks on a refused answer | "reads the setting out of the organization answer…" (`rank.test.ts`) |
| status / team date `aria-invalid` removed | "names the offending field on the member edit form", "marks the date on the status/team block…"; the team one also fails the E2E test |
| `dateRefused` always false (first pass) | the seven date-code cases |
| server `MEMBER_WRITE_INVALID` marks the date | "marks no date for an invalid value the server write names no field for", the `MEMBER_WRITE_INVALID` server case |
| preflight `MEMBER_WRITE_INVALID` unmarked | "marks a date the preflight finds is not a date" and the `MEMBER_WRITE_INVALID` cases |
| `dateMarked` ignores the history / the refusal | "unmarks a block that remounted on a new history" / "unmarks when the refusal is gone or another one replaced it" |
| hook reads the mark's own history / marks a server refusal as preflight / team preflight sets no mark | "marks the date on the status/team block invalid when its own refusal names it" |

**Commands:**
- `pnpm typecheck`, `pnpm lint` -- expected: exit 0.
- `pnpm test` -- expected: pass, after a rebuild.
- `pnpm test:e2e`, run twice -- expected: all pass. Run with port 5173 free, and not in parallel with `pnpm test`.

## Suggested Review Order

1. `apps/web/src/features/organization/services/snapshot.ts`: `organizationSnapshotQueryOptions`, where a failed answer is never held fresh.
2. `apps/web/src/features/members/hooks/use-member-create.ts` and `use-member-edit.ts`: one factory call each and `ranksShownIn`; the date mark per block.
3. `apps/web/src/features/members/utils/date-refusal.ts` and its test: which refusal names the date, depending on where the refusal came from.
4. `member-status-card.tsx` and `member-team-card.tsx`: `aria-invalid` on the two date inputs.
5. `apps/web/src/pages/prijava.test.ts`: the in-flight guard and the retargeted read-policy guards.
6. `e2e/tests/people/people.spec.ts`: the refused-date test.
