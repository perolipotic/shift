---
title: 'Source structure B2 — the organization settings screen becomes a thin page over features/organization'
type: 'refactor'
created: '2026-09-27'
status: 'done'
baseline_commit: '5d914cf66742ad0a9159bcf47862c2c92fc75caa'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-27-source-structure.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-source-structure-b1-members-pages.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `pages/organizacija.tsx` (1,013 lines) holds the settings screen's refs, queues, four writes, derivations and all of its JSX. The approved proposal wants a page that only composes.

**Approach:** Follow B1's pattern (see its spec, Code Map and Spec Change Log):
- the state, query and handlers go into one hook, `features/organization/hooks/use-organization-settings.ts`;
- each card goes into a component in `features/organization/components/`;
- inline pure logic goes into `features/organization/utils/`.

The page keeps `createRoute` and the composition. The DOM, behaviour and test outcomes are identical.

## Boundaries & Constraints

**Always:**
- The DOM does not change.
- Export names `OrganizacijaScreen` and `organizacijaRoute` stay, because `router.test.ts` imports them.
- Every guard keeps its meaning with the same counts. A single-file guard now reads the screen's file set, and B1's lessons apply:
  - A needle that a shared helper's own definition would satisfy is asserted against the file that must contain the call.
  - Order, null-ref, `finally` and `catch` checks read the named handler's text, not the joined set.
  - Non-vacuity is checked per file.
  - A completeness check ensures every non-test file under `features/organization/{components,hooks}` belongs to the set.
  - `test/localization-applied.test.ts` derives these files from the folder.
- Named handlers (`submit`, `uploadLogo`, `chooseLogo`, `applyAccent`, `applyFireRanks`, `chooseAccent`, `chooseFireRanks`, `openLogoPicker`) keep their names, ref guards and setters, together in the hook.
- `render*` helpers that guards pin by name (`renderSettings`, `renderLogo`) stay as named inner functions if extracting them would change an assertion.

**Ask First:**
- A guard whose count or assertion would have to change.
- Any DOM or behaviour difference.

**Never:**
- No new UI.
- No change to `services/{snapshot,logo}` beyond moving inline helpers.
- No barrels.
- The hour-band screens are out of scope (a later B part).
- No E2E locator change.

</frozen-after-approval>

## Code Map

(Line numbers may be off by a few lines.)

- `pages/organizacija.tsx`:
  - Imports 1–65 and the doc comment 66–164.
  - `OrganizacijaScreen` 165–1007:
    - refs: fields, in-flight `saving`/`uploading`/`tinting`/`ranking`, queues `queuedFireRanks`/`queuedAccent`;
    - six `useState`;
    - one `useQuery` 221 (`ORGANIZATION_SNAPSHOT_KEY`/`readOrganization`) plus `useRenderableLogo`;
    - derived values `busy`, `writingElsewhere` and `writingBesideFireRanks` 208–219, and `organization`/`refusal` 226–230;
    - handlers `submit` 241, `openLogoPicker` 320, `uploadLogo` 338, `chooseLogo` 391, `applyAccent` 425, `applyFireRanks` 506 (+ `drainFireRanks` 560), `chooseFireRanks` 567, `chooseAccent` 598;
    - pure `storedAccentLabel` 583;
    - `renderLogo` 613–695, `renderSettings` 696–936;
    - the return 938–1006: header link, settings card, about card.
  - Route 1009–1013.
- Seams:
  - `OrganizationLogoCard` (renderLogo);
  - `OrganizationSettingsCard` (renderSettings, with `AccentField`/`FireRanksField` only if no guard pins them inline);
  - `OrganizationAbout`.
  - `storedAccentLabel` goes to `utils/accent.ts`, or to a new util if an existing test pins accent.ts's exports.
- `pages/prijava.test.ts`:
  - `SETTINGS` (67) becomes a file set, read through `screenSource` (815).
  - Counts: controls 9 (384), `t()` strings 18 (1496), 1 input, 4 selects, 5 labels, 4 buttons, 1 link.
  - `FORM_SCREENS`/`IN_FLIGHT_HANDLERS` entries: `submit/saving` (4643).
  - `componentFunction`/`namedHandler` extraction of `renderSettings` (4212), `uploadLogo`, `chooseLogo`, `applyAccent`, `storedAccentLabel`, `applyFireRanks`. These match to `\n  }`, and `finallyBlock` to `\n    }`, so keep handler indentation at those depths inside the hook, or make the extractors depth-agnostic without weakening them.
  - Literal needles: `disabled={busy}`, `disabled={writingBesideFireRanks}`, `aria-busy={savingFireRanks}`, `useRenderableLogo(`, `LEAVE_START_DAYS.map(`, `FIRE_RANKS_OPTIONS.map(`. Assert each against the file that renders it.
- `features/organization/services/snapshot.test.ts`:
  - `SCREEN` is a single path with no array support. It asserts one `readOrganization(`/`useQuery(`, that every `queryKey:` is `ORGANIZATION_SNAPSHOT_KEY`, the lockup, no `role="img"`/`'organizations'`/`slug`/`locale`, a refetch after save, and a length over 500.
  - Give it a file set and scope each assertion to the file that must hold it (the hook for the query and refetch, the logo card for the lockup).
- `test/localization-applied.test.ts:117`: `SOURCES` gets an `organizationScreenParts()` derived like `memberScreenParts()` (38).
- `router.test.ts`: imports the two exports; unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `features/organization/{hooks,components,utils}/` -- extract per the Code Map.
- [x] `pages/organizacija.tsx` -- compose only.
- [x] `pages/prijava.test.ts`, `features/organization/services/snapshot.test.ts`, `test/localization-applied.test.ts` -- retarget to the file set with B1's scoping rules, counts unchanged, plus the completeness check.

**Acceptance Criteria:**
- Given the page, when measured, then it is ≤ 150 lines with no `useQuery`, `useState`, `useRef` or effect call.
- Given each retargeted guard, when a planted mutation breaks its target in a moved file, then it fails. Spot-check at least: a bare `<select>` in the settings card, `updateOrganization(` outside `submit`, `preventDefault` removed from `submit`, the snapshot query key changed in the hook, and an extra `t()` in the about card. Revert afterwards.
- Given the suite, when `pnpm typecheck`, `pnpm lint`, `pnpm test`, the web build and `pnpm test:e2e` run, then all pass. Unit counts grow only by added guard cases, and E2E is 68/68.

## Spec Change Log

- Implementation note (no intent change, after review):
  - `storedAccentLabel` lives in a new `utils/accent-label.ts`, returns `string`, and is unit-tested in `accent-label.test.ts`. `accent.ts` is unchanged. The guard checks that the card imports it and keeps no local copy, and it reads the fold from `accent-label.ts` alone, through `exportedFunction`, which now also matches a non-async export.
  - The settings file set is written once, in `features/organization/settings-screen.fixture.ts`, and both `prijava.test.ts` and `snapshot.test.ts` read it. The completeness check asserts equality in both directions over `components`, `hooks` and `utils`. The fixture exempts `lockup.tsx`, `logo-url.ts`, `accent.ts`, `messages.ts` and `leave-start.ts` and records the reason for each.
  - The refusal id is one constant, `ORGANIZATION_ERROR_ID` in `utils/messages.ts`. The binding guard resolves the id through that constant.
  - `componentFunction` and `namedHandler` are unchanged. `renderLogo` is not pinned by any guard, so it became the body of `OrganizationLogoCard`.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @shift/web build` -- expected: exit 0.
- `pnpm test` -- expected: pass. Record the baseline first.
- `pnpm test:e2e` -- expected: 68/68. Check that port 5173 is free first, and do not run it in parallel with `pnpm test`.

## Suggested Review Order

**The thin page**

- The page composes the settings and about cards under the header.
  [`organizacija.tsx:70`](../../apps/web/src/pages/organizacija.tsx#L70)

**Where the screen's state went**

- One hook holds the four writes, their in-flight refs and queues, and the rationale for each.
  [`use-organization-settings.ts:78`](../../apps/web/src/features/organization/hooks/use-organization-settings.ts#L78)

- The form stays a named inner function because guards pin `renderSettings`.
  [`organization-settings-card.tsx:114`](../../apps/web/src/features/organization/components/organization-settings-card.tsx#L114)

- The stored-accent label now has its own module and a real unit test.
  [`accent-label.ts:19`](../../apps/web/src/features/organization/utils/accent-label.ts#L19)

**Guards**

- One shared definition of the screen's file set, used by both guard suites.
  [`settings-screen.fixture.ts:1`](../../apps/web/src/features/organization/settings-screen.fixture.ts#L1)
