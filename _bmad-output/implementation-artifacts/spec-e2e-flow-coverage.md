---
title: 'E2E coverage for the write flows the source-structure refactor verified only once'
type: 'chore'
created: '2026-09-27'
status: 'done'
baseline_commit: '323a699a6006d316674c45e4952be116200edc9a'
review_loop_iteration: 0
context:
  - '{project-root}/e2e/README.md'
  - '{project-root}/_bmad-output/implementation-artifacts/deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The B4–B7 reviews found write flows that no E2E test had ever exercised. Each was checked once with a temporary spec that was then reverted. They are recorded in four `deferred-work.md` entries (the "Add E2E coverage for …" items from B4, B5, B6 and B7):
- **Shift types:** correcting times, cancelling a scheduled correction, archiving.
- **Hour bands:** a refused add, the end preview, save, and remove (both cancel and confirm).
- **Teams:** a refused add, rename, and archive (both cancel and confirm).
- **Team roster:** the member-count line and the archived notice.
- **Sign-in:** recovery after a refusal, and the unavailable path.

**Approach:** Add permanent E2E tests for each flow in the existing feature spec files. Use the page objects, and add any locators that are missing to them. Then close the four deferred entries.

## Boundaries & Constraints

**Always:**
- Follow `e2e/README.md`:
  - Locators live in `e2e/pages/*.page.ts` and are role- or label-based through `hr`. Specs call no `page.getBy…` or `page.locator` directly.
  - Assertions stay in specs. A page object only waits, never asserts.
  - Assertions are web-first. No `waitForTimeout`.
  - A test that writes creates its own rows, unique per attempt.
- **Parallel safety.** The suite runs `fullyParallel` against one per-run organization. Each test acts only on entities it created itself: a team, a shift type or an hour band, each with a unique name or start. It never archives, removes or renames fixture entities.
  - A team with members cannot be archived, so archive a freshly created team that has no members.
  - A new hour band must not overlap a fixture band's start. Pick a unique free start per attempt.
- **Sign-in unavailable path.** Use `page.route` to make the auth token request fail, scoped to that test. Then assert the unavailable text, that the URL stays on `/prijava/<slug>`, and that the button is enabled again.
- **Expectations:**
  - Where the temporary checks asserted focus (the cancelled or archived status after shift-type actions, the dialog close after a landed band removal, the refused field on a refused add), assert it with `toBeFocused()`.
  - Check user-visible strings with `hr.*` and `fill(...)`.

**Ask First:**
- Any change to application code.
- A test that turns out flaky because of a real race in the app.
- A test that needs a fixture change (`run-fixture.ts`).

**Never:**
- No `data-testid`.
- No retries or longer timeouts to make a test pass.
- No changes to `apps/`, `packages/`, `supabase/` or `smoke/`.

</frozen-after-approval>

## Code Map

- **`e2e/tests/rotation/rotation.spec.ts`** (with `e2e/pages/rotation.page.ts`) -- shift-type flows.
  - The temporary B4 check used this path: add a working type, open its edit dialog, correct its times from the date field's minimum (tomorrow), and see "Vremena su spremljena." plus the scheduled "Od … vrijedi" line.
  - While a correction is pending, the archive offer is absent. The "change scheduled" note shows instead.
  - Cancel the correction: the cancelled status is focused and the scheduled line is gone.
  - Arm and confirm the archive: the archived status is focused. After closing, the type appears under the archived heading with no edit link.
  - Note from B4's run: a locator named `status` clashed with the base page's `status` getter. Pick distinct names.
- **`e2e/tests/hour-bands/hour-bands.spec.ts`** (with `e2e/pages/hour-bands.page.ts`) -- hour-band flows.
  - Refused add: reusing the fixture's 07:00 start keeps the typed name, shows the `startTaken` refusal inside the dialog, and focuses the start field.
  - End preview: a free start shows the computed end (the temporary check used `#hour-band-new-end` and `#hour-band-end`; prefer label or role locators).
  - Edit a band created by the test: change the start and check the end, then save and see the saved status. Type a new name without saving, press Remove, then Cancel: the form keeps what was typed. Then Remove and confirm: the removed status shows, the band leaves the list, and focus is on the dialog close.
- **`e2e/tests/teams/teams.spec.ts`** (with `e2e/pages/teams.page.ts`) -- team flows.
  - A duplicate name shows the taken refusal inside the dialog, keeps the typed name, and marks the field `aria-invalid`.
  - Rename shows "Naziv je spremljen." and the new name is listed.
  - Archive shows a confirmation that names the team and hides the form. Cancel keeps the typed value. Confirm shows the archived status, and the team moves under "Arhivirano:" with its view link.
  - After archiving, the dialog heading becomes "Arhivirana smjena". Locate it by the view heading, not the edit heading.
  - Roster (`/smjene/$id`):
    - a one-member team shows `fill(hr.smjene.roster.count, { count: 1 })`;
    - an archived empty team shows the archived notice and a count of 0.
- **`e2e/tests/auth/sign-in.spec.ts`** (with `e2e/pages/login.page.ts`) -- sign-in flows.
  - After the wrong-password refusal, the submit button is enabled again, and a second attempt with the right password lands on /danas.
  - The unavailable path (see Boundaries).
- **`_bmad-output/implementation-artifacts/deferred-work.md`** -- remove the four "Add E2E coverage for …" entries from B4, B5, B6 and B7 once their tests exist.

## Tasks & Acceptance

**Execution:**
- [x] The four spec files and their page objects -- add the tests and locators listed in the Code Map.
- [x] `e2e/README.md` -- update only if a new convention appears (none is expected).
- [x] `deferred-work.md` -- remove the four covered entries.

**Acceptance Criteria:**
- Given the suite, when `grep -rnE "\bpage\.(getBy|locator)" e2e/tests` runs, then it finds nothing.
- Given each new test, when the code path it covers is broken on purpose in the app, then that test fails. Check at least one mutation per feature, then revert it:
  - the shift-type archive confirm is not wired;
  - the band's remove-confirm is not wired;
  - the team's rename submit is not wired;
  - sign-in's `setPending(false)` is dropped from `finally`.
- Given the suite, when `pnpm test:e2e` runs twice in a row, then all tests pass both times (68 + the new ones).

## Spec Change Log

- Implementation: the teams rename and archive tests hold the run's rotation (`holdRotation`, with `test.slow()` for the lock wait, as the rotation specs do). Without it, a team they add between `rotation.spec.ts`'s save and reload left an active team with no rotation, so the builder's prefill came up empty and that existing test failed on both full runs. `e2e/utils/i18n.ts` gained `plural()` for the ICU count messages (`roster.count`, `archivedCount`), since `fill` does not handle plurals. README unchanged.
- Review follow-up: stricter assertions (the full scheduled line and tomorrow's date, list checks only after a dialog closes, `aria-invalid` on the refused start, the edited band's end and duration asserted as the guaranteed relation). `attemptStart` gives each start its own hour and throws when the offset would leave it. The rename test archives its team at the end. Only an acquired rotation hold's `release()` can fail the test. The sign-in refusals use the spare account, and the unavailable path aborts only the password grant, unroutes it and recovers. `plural()` formats through `Intl.NumberFormat('hr')`, honours `=N`, throws on unsupported ICU, and is unit-tested in `test/e2e-plural.test.ts`.

## Verification

**Commands:**
- `pnpm typecheck` and `pnpm lint` -- expected: exit 0.
- `pnpm exec playwright test --list | tail -1` -- expected: 69 plus the new test count.
- `pnpm test:e2e`, run twice -- expected: all pass both times. Port 5173 must be free, and E2E must not run in parallel with `pnpm test`.

## Suggested Review Order

**The new flows**

- Shift-type times correction from tomorrow, its cancel, and the archive.
  [`rotation.spec.ts`](../../e2e/tests/rotation/rotation.spec.ts)

- Hour-band refused add, end preview, save, and remove (cancel and confirm).
  [`hour-bands.spec.ts`](../../e2e/tests/hour-bands/hour-bands.spec.ts)

- Team refused add, rename, archive, and the roster's count and archived notice.
  [`teams.spec.ts`](../../e2e/tests/teams/teams.spec.ts)

- Sign-in recovery after a refusal, and the unavailable path through a scoped `page.route`.
  [`sign-in.spec.ts`](../../e2e/tests/auth/sign-in.spec.ts)

**Support**

- ICU plural rendering for locators, with its own unit test.
  [`i18n.ts`](../../e2e/utils/i18n.ts)
