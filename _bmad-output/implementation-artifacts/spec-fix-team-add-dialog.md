---
title: 'The team add dialog cannot be dismissed mid-create, and every refusal focuses the name'
type: 'bugfix'
created: '2026-09-27'
status: 'done'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
  - '{project-root}/e2e/README.md'
  - '{project-root}/apps/web/src/components/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `deferred-work.md` (from B6's review) records two pre-existing problems in the team add dialog (`/ljudi/smjene`):
1. The dialog's Cancel button is not disabled while a create is in flight. The viewer can dismiss the dialog, and a "created" notice lands afterwards for a dialog they closed.
2. When the organization claim is missing, `useTeamList.submit` sets `TEAM_WRITE_REFUSED` and returns without `name.focus()`. The ordinary refusal path does focus the field.

**Approach:**
- Disable Cancel while `pending`, the same way the submit button already is. Also make the dialog's own dismissals (Escape and the close control) do nothing while pending, where the primitive allows that without changes to it. Other dialogs in the app already do this; follow them. Examples: the shift-type and hour-band add dialogs, if they gate on pending.
- Focus the name field on the missing-claim refusal as well.
- Pin both with tests.

## Boundaries & Constraints

**Always:**
- Keep the one hook, `use-team-list.ts`, and its named `submit` with its ref guard, setters and `finally`. The B6 guards in `pages/prijava.test.ts` must keep passing unchanged, or change only by an added assertion.
- **E2E tests:**
  - Cancel is disabled while the create request is held with `page.route` (release it afterwards), and the dialog stays open.
  - After release, the created status shows.
- **Missing-claim focus:** use a unit test if the refusal branch can be driven without a browser. Otherwise add a source guard that the branch contains `name.focus()`, next to the ordinary refusal's check, and state why a runtime test isn't possible.

**Ask First:**
- Any change to `components/ui/dialog.tsx`, since it is shared.
- Any change in how other screens' add dialogs behave.

**Never:**
- No new UI.
- No change to the write service.

</frozen-after-approval>

## Code Map

- `apps/web/src/features/teams/components/team-add-dialog.tsx` -- the Cancel button and the Dialog props.
- `apps/web/src/features/teams/hooks/use-team-list.ts` -- `submit`: the missing-claim branch sets `TEAM_WRITE_REFUSED` and returns; the ordinary refusal calls `name.focus()`.
- `apps/web/src/features/shift-types/components/shift-type-add-dialog.tsx`, `apps/web/src/features/hour-bands/components/hour-band-add-dialog.tsx` -- check whether they already gate Cancel on pending, and mirror them.
- `apps/web/src/pages/prijava.test.ts` -- the B6 team guards (sets, handlers, bound forms, writes only from the hook).
- `e2e/tests/teams/teams.spec.ts`, `e2e/pages/teams.page.ts` -- the team add tests.

## Tasks & Acceptance

**Execution:**
- [x] Gate the dialog's Cancel and dismissals on `pending`.
- [x] Focus the name field on the missing-claim refusal.
- [x] Add the tests.
- [x] Remove this entry from `deferred-work.md`.

**Acceptance Criteria:**
- Given the fixes reverted, when the new tests run, then they fail.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test` (after a web build) and `pnpm test:e2e` run twice, then all pass.

## Spec Change Log

## Verification

**Commands:**
- `pnpm typecheck` and `pnpm lint` -- expected: exit 0.
- `pnpm test` -- expected: pass, after a rebuild.
- `pnpm test:e2e`, run twice -- expected: all pass. Port 5173 must be free, and it must not run in parallel with `pnpm test` or another worktree's E2E.
