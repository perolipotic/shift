---
title: 'Document metadata, runtime lang, and a jsdom gate that can fail'
type: 'chore'
created: '2026-10-08'
status: 'done'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `index.html` hard-codes `lang="hr"` and lacks description, theme-color, favicon, manifest and a noscript message. AD-15's jsdom check (`pnpm ls ... || echo`) can never fail.

**Approach:** Sync `<html lang>` from i18next at runtime and add the missing head/body metadata. Add a root test that scans `pnpm-lock.yaml` for jsdom installs, proven against mutated copies.

## Boundaries & Constraints

**Always:** Croatian user text, English code. Theme-color matches `--background` per theme. The test needs no build and no `pnpm ls`.

**Never:** Source maps, CSP, CORS, rate limiting, lint plugins, slot palette; no new dependency; no edits to `deferred-work.md` or `sprint-status.yaml`.

## Epic AC Deviations

None.

</frozen-after-approval>

## Code Map

- `apps/web/index.html` -- static head metadata, noscript, `lang="hr"` stays as the pre-script default
- `apps/web/src/lib/i18n/document-language.ts` -- binds `documentElement.lang` to the i18next language; called from `initLocalization`
- `apps/web/public/{favicon.svg,site.webmanifest}` -- icon and manifest
- `test/static-hosting.test.ts` -- dist allowlist gains the two files
- `test/no-jsdom.test.ts` -- line scan of importers, packages and snapshots (direct and transitive)

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/index.html`, `public/*` -- metadata, icon, manifest, noscript
- [x] `document-language.ts` + test, `index.ts` -- runtime `lang`
- [x] `test/no-jsdom.test.ts` -- gate plus mutation cases
- [x] `test/static-hosting.test.ts` -- allowlist

**Acceptance Criteria:**
- Given a language change, when i18next emits it, then `<html lang>` equals it.
- Given jsdom in an importer, a package, a snapshot or any snapshot's dependencies, when the gate runs, then it reports it; vitest's optional peer declaration does not.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck` -- clean
- `pnpm exec vitest run test/no-jsdom.test.ts test/static-hosting.test.ts test/localization-applied.test.ts` -- pass
