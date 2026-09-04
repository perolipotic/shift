---
title: 'Story 1.1c — The localization layer'
type: 'feature'
created: '2026-09-03'
status: 'done'
review_loop_iteration: 0
baseline_commit: '125c589b429c62cf12e8d5befcd207040dcfb8b4'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/web/src/i18n/` holds a README and no code; the lockfile has zero i18n packages. L1–L8 and UX-DR34–36 are binding but enforced by nothing, so the first surface would format ad hoc — and CLDR's own `hr` output does not match the binding formats, so "just use `Intl`" produces the wrong string.

**Approach:** Install i18next with the ICU backend, author the one locale-aware module every surface formats through — each date/time entry point taking a required IANA timezone — ship the minimal `hr` resource, degrade a missing key to `⟦key⟧`, and make L2 merge-blocking via `no-restricted-syntax`.

## Boundaries & Constraints

**Always:**
- One module is the only `Intl` construction site in `apps/web`, and every date/time entry point takes a **required** `timeZone` — a caller cannot omit it and inherit the device's (L8).
- Binding literals: `12.09.2026`, `19:00–07:00`, `10.09–16.09` — U+2013, **unspaced**, never a hyphen (UX-DR34).
- Plurals resolve through ICU `one`/`few`/`other` (L7); `count === 1` is a defect.
- Month and day names are CLDR verbatim, **lowercase** (`rujan`, `subota`); capitalization belongs to the consuming surface.
- A missing key renders `⟦key⟧` — never blank, never a throw (L5).
- Exact pins (`save-exact=true`). Tests `.ts`, node environment, no jsdom (AD-15).
- `packages/domain` stays free of every i18n import (L4).

**Ask First:**
- Any second locale, language-switch surface, or persisted preference. L3 is provable with a throwaway stub, not a feature this story ships.
- Widening the `no-restricted-syntax` allowlist, or narrowing its file scope.
- Touching `.npmrc` or `pnpm-workspace.yaml` policy to satisfy a pin — move the pin instead (1.1b KEEP).

**Never:**
- No screen, navigation, nav label or terminology string in the resource file — 1.1d owns every screen literal so it reviews them in one place.
- No `lang` wiring, document metadata, not-found route or boot-failure fallback (1.1d).
- No source for the organization's timezone; the argument is required here, 1.4 supplies the value, tests pass a literal.
- No `toLocaleString`, `Intl.` or template-assembled date outside the module.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Date | `2026-09-12`, `Europe/Zagreb` | `12.09.2026` | CLDR's `12. 09. 2026.` fails by name |
| Range over midnight | `19:00`, `07:00` | `19:00–07:00` | a hyphen or U+2009 thin space fails |
| Day-month range | `2026-09-10`, `2026-09-16` | `10.09–16.09` | as above |
| Plural | `count` 1, 2, 5, 21, 101 | `1 dan`, `2 dana`, `5 dana`, `21 dan`, `101 dan` | a `count === 1` shape fails at 21 |
| Timezone | `2026-09-12T23:30Z`, `Europe/Zagreb` | `13.09.2026`, `01:30` | an omitted zone is a compile error |
| Foreign device zone | same, under `TZ=Pacific/Kiritimati` | identical output | a zone leak shows as `13:30` |
| Missing key | `t('nope.missing')` | `⟦nope.missing⟧` | never `''`, never throws |
| Number | `1234.5` | `1.234,50` | N/A |
| JSX literal | `<p>Danas</p>` under `apps/web` | ESLint error naming L2 | guard self-test proves it fires |

</frozen-after-approval>

## Code Map

- `apps/web/src/i18n/README.md` -- the contract already written for this directory; code lands beside it.
- **Pins, verified against the registry 2026-09-03.** `i18next@26.4.1` (the spine pin; `latest` 26.4.2 published today sits inside pnpm's 24-hour guard — pin 26.4.1, do not chase latest), `react-i18next@17.0.13` (peers `react >=16.8` ✓ 19.2.8, `i18next >=26.2` ✓, `typescript ^5||^6||^7` ✓ 7.0.2), `i18next-icu@2.4.4` (**zero runtime dependencies**; declares `intl-messageformat >=10.3.3 <12.0.0` as a *peer*, so pin `intl-messageformat@11.2.14` explicitly or it is absent). All four clear the release-age cutoff. `.npmrc` has `save-exact=true` and no `minimumReleaseAge` — leave both.
- **Runtime facts, measured on the pinned Node 24.19.0** (`.nvmrc`; shell default is v20.20.2, so use nvm). full-icu, ICU 78.3 — `hr` data is real, not an English fallback. Plural categories `one`/`few`/`other`: 1=one, 2–4=few, 5=other, **21=one, 22=few, 101=one**. CLDR numeric `hr` date is `"12. 09. 2026."` and `formatToParts` returns literal parts `". "` plus a trailing `"."` — **compose from parts, never `format()`**. `formatRange` returns `12. 09. 2026. 19:00 – 13. 09. 2026. 07:00` with U+2009 around the dash: unusable, compose ranges manually. An invalid `timeZone` throws `RangeError`, so fail-fast is free. **An omitted `timeZone` silently resolves to the system zone, which on this machine is `Europe/Zagreb`** — so an L8 violation is invisible in local development, which is what the foreign-TZ run exists to catch.
- `apps/web/src/main.tsx` -- the only mount point. `#root` at :9, `ROOT_ELEMENT_MISSING` throw at :11-14 (a stable code, not a user-facing string — leave it). Init must resolve before render, or the provider wraps `RouterProvider` between :17 and :18. No `Suspense`, no error boundary today.
- `eslint.config.js` -- `no-restricted-syntax` appears nowhere in the repo; the one restriction rule is `no-restricted-imports` at :71-92 (domain purity) — copy its shape. Shared TS rules :54-64; a JSX-scoped block belongs after :64 with `files: ['apps/web/**/*.tsx']`. TSX parses via `@babel/eslint-parser` + `@babel/plugin-syntax-jsx` (:16-29), **syntax only, no type information**, so the selector must be AST-shape based, never type-aware.
- `test/` idioms to copy: repo root via `fileURLToPath(new URL('..', import.meta.url))` (`theme-css.ts:18`); every read in a lazy function, **never module scope** (`theme-css.ts:7-16`, `typography-coverage.test.ts:20-22`), or the guard assertions never report; comment-blind scanning (`theme-css.ts:77-86`); file JSDoc naming the invariant and the failure it caught; `describe` a plain claim, `it` a behavioural clause, never "should"; `it.each` tables (`theme-tokens.test.ts:47`); vacuous-pass guards (`purity.test.ts:106`); and the **detector self-test** (`purity.test.ts:117-158`), which feeds synthetic violating sources through the matcher and assembles keywords at runtime (`` const IMPORT = `im${'port'}` ``) so the file cannot trip its own scan. The ESLint guard needs exactly that treatment.
- `apps/web/vitest.config.ts` -- `@` → `./src` at :20; `include: ['src/**/*.test.ts']`, `.ts` only and deliberately. Root config covers `test/**/*.test.ts`. All three projects node environment.
- `packages/domain/src/index.ts:15` -- one export. Purity enforced three ways (no `dependencies` key, `eslint.config.js:71-92`, `purity.test.ts:90-159`). Nothing here reaches for i18n.
- **Binding rules.** L1–L8 at `_bmad-output/specs/spec-shift/localization.md:7-14`. UX-DR34/35/36 at `_bmad-output/planning-artifacts/epics.md:152/153/154` — **not** in DESIGN.md, which contains no `UX-DR` string; source prose `EXPERIENCE.md:76-82`. The two binding plural sets are at `EXPERIENCE.md:81`.
- **Terminology** (`localization.md:20-27`): `Smjena` = Team, `Tip smjene` = Shift Type, and `smjena` is forbidden as a synonym for Shift Type however natural it reads. Hour-band, shift-type and team names are organization *data*, never keys, and no code may branch on one.

Pinned stack versions, directory shape and AD-14/15/17 are in the loaded `epic-1-context.md` — do not re-derive.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/package.json` -- DONE. All four as `dependencies`: `i18next@26.4.1`, `react-i18next@17.0.13`, `i18next-icu@2.4.4`, `intl-messageformat@11.2.14`. Installed clean on Node 24.19.0; `save-exact=true` honoured, no `.npmrc`/`pnpm-workspace.yaml` change needed.
- [x] `apps/web/src/i18n/index.ts` -- DONE. `createInstance()` + `use(ICU)`, `lng`/`supportedLngs` `hr`, `fallbackLng: false`, `returnNull: false`, `parseMissingKeyHandler` → `⟦key⟧`, `interpolation.escapeValue: false` (React escapes at render; `i18next-icu` already defaults `escapeVariables` to false). Exports `i18n`, `initLocalization()`, `missingKeyPlaceholder()` and `t`. `t` is `i18n.t` by reference — verified stable across `init` and asserted, so `TFunction`'s key typing survives. A `declare module 'i18next'` augmentation types keys off `typeof hr`: `t('count.dayz')` is now a **typecheck error** (verified live, TS2345).
- [x] `apps/web/src/i18n/format.ts` -- DONE. `formatDate`, `formatTime`, `formatTimeRange`, `formatDayMonthRange`, `formatMonthName`, `formatWeekdayName` (each `(…: Date, timeZone: string)`, required and positional) plus `formatNumber(value, fractionDigits = 2)`. Dates and ranges composed from `formatToParts` via a total `part()` that throws `FORMAT_PART_MISSING:<type>` rather than emitting `undefined`; `format()` and `formatRange()` are never called. A closed `SHAPES` map with `hourCycle: 'h23'` explicit (midnight is `00:00`, not `24:00`), memoized in two `Map`s keyed locale/zone/shape and locale/fractionDigits. Zero imports — which is what lets the foreign-TZ child process load it.
- [x] `apps/web/src/i18n/locales/hr.json` -- DONE. Exactly two keys, `count.days` and `count.conflicts`, as ICU `{count, plural, one/few/other}` with `#`. No screen, navigation or terminology string.
- [x] `apps/web/src/main.tsx` -- DONE. Top-level `await initLocalization()` before `createRoot`, `<I18nextProvider i18n={i18n}>` wrapping `RouterProvider`. `ROOT_ELEMENT_MISSING` untouched, no user-facing string added; the built bundle still carries no Croatian beyond the two resource messages and the pre-existing `<title>Shift</title>`. Top-level await builds fine under Vite 8's default target.
- [x] `eslint.config.js` -- DONE, placed before the domain-purity block and shaped after it. Selectors `JSXText[value=/[^\s]/]` and `JSXAttribute[name.name=/^(aria-label|placeholder|title|alt)$/] > Literal` — `Literal`, not Babel's `StringLiteral`, because `@babel/eslint-parser` emits ESTree; AST-shape only, nothing type-aware. Both messages name L2 and point at `apps/web/src/i18n/locales/hr.json`. Verified against the real tree: a literal in `routes/index.tsx` fails `pnpm lint` with exit 1.
- [x] `apps/web/src/i18n/format.test.ts` -- DONE, 56 tests. Every matrix row table-driven, plurals at 1/2/5/11/21/22/101/1234 for both messages. Comment-blind scan with brace-matched construction arguments, plus a detector self-test on synthetic sources and non-empty guards; needles assembled at runtime (`` `In${'tl'}` ``) so the file cannot trip its own scan. The foreign-TZ row is a real assertion, not just a command: a child `node --experimental-strip-types` process under `TZ=Pacific/Kiritimati` loads `format.ts` by file URL and must return identical output, with a vacuous-pass guard on the child's resolved zone. In-process TZ mutation was rejected — memoized formatters survive it, so the leak would pass. Verified by deleting `timeZone` from the one construction: **6 assertions fail — 3 in-process (the UTC+14 contrast, the invalid-zone throw, the construction scan) and 3 from the child** (date, time, range). The child's fourth `it` is the vacuous-pass guard asserting it really ran under Kiritimati, which by design does not fail on this mutation — an earlier note claiming "4 from the child" mistook that guard for a leak detector. Two further detection gaps were closed on review: the child's date assertion used `2026-09-12T23:30:00Z`, which renders `13.09.2026` in BOTH zones and so could not see the leak it existed for (now `11:00:00Z`, 12.09 against 13.09); and nothing asserted the zone parameter was REQUIRED, so adding `= Intl.DateTimeFormat().resolvedOptions().timeZone` as a default left the whole suite green — now two assertions fail, one on the signature and one banning `resolvedOptions` outright.
- [x] `test/localization-guard.test.ts` -- DONE, 14 tests. `new ESLint({ cwd: repoRoot })` resolves the real `eslint.config.js`; `lintText` under a synthetic `apps/web/src/surfaces/*.tsx` path. Six violating shapes fire, five compliant ones stay silent, the message is asserted to name L2 and the resource file. Scope is asserted too — the same markup at `packages/domain/src/*.tsx` does not fire (`.tsx` deliberately: a `.ts` path fails to parse JSX and a parse error carries no `ruleId`, so the check would pass for the wrong reason) — plus an `eqeqeq` vacuous-pass guard proving the probe path is linted at all. JSX assembled from fragment helpers.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- DONE, seven entries: the clock-string range gap (a Shift Type's `time` values have no instant to pass), `formatNumber`'s unvalidated 2-decimal default, the L2 guard's coverage gap beyond `JSXText` and four attributes, `I18nextProvider` being wired but unasserted under AD-15, top-level `await` with no boot-failure fallback (1.1d owns it), the absence of any plural-category completeness check for a future locale, and the child-process TZ proof's dependency on `format.ts` staying import-free.

**Review patches (2026-09-04).** Nineteen findings applied; no loopback, and nothing re-derived. Three were mutation-proven detection gaps and are marked as such.

- [x] [Review][Patch] **MUTATION-PROVEN.** The `main.tsx` wiring was asserted by nothing: removing `await initLocalization()`, the `<I18nextProvider>` wrapper and both imports left build, lint, `tsc` and all 648 tests green — the exact shape of 1.1b's "theme defined but never applied" loopback. **Fixed:** new `test/localization-applied.test.ts`, modelled on `test/theme-applied.test.ts` (`it.skipIf(notBuilt)` plus an mtime freshness guard over all four localization sources). Nine wiring markers, each chosen empirically by building with and without the wiring and keeping only strings that vanish. Re-applying the mutation now fails **11** assertions; reverting returns 32/32. [test/localization-applied.test.ts]
- [x] [Review][Patch] **MUTATION-PROVEN.** Nothing asserted the `timeZone` parameter was REQUIRED — adding `timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone` to `formatDate` left 63/63 green and `tsc` clean while handing every caller the device zone. **Fixed:** a nesting-aware signature scan over every exported date/time entry point requiring exactly `timeZone: string` (no `?`, no `=`), a completeness guard so a seventh zoned export cannot go unchecked, and an outright ban on `resolvedOptions` in the module. Re-applying the mutation now fails **2** assertions. [apps/web/src/i18n/format.test.ts — "the timeZone argument is required, not merely present"]
- [x] [Review][Patch] **MUTATION-PROVEN.** The child process's date assertion could not detect the leak it existed for: `2026-09-12T23:30:00Z` renders `13.09.2026` in both `Europe/Zagreb` (+2) and `Pacific/Kiritimati` (+14). **Fixed:** `11:00:00Z` (12.09 against 13.09); time and range instants kept, both already discriminating. Proven by re-running the zone-leak mutation under both instants — blind under the old one (5 failures, the date assertion not among them), caught under the new one (6 failures, including it).
- [x] [Review][Patch] Every positive L2 assertion ran only at `apps/web/src/surfaces/synthetic-probe.tsx`, and `surfaces/` holds only a README — narrowing the rule to `surfaces/**` kept all 14 tests green while a literal in a real screen stopped being refused. **Fixed:** the VIOLATIONS table now sweeps `surfaces/`, `routes/` and `components/`.
- [x] [Review][Patch] The out-of-scope assertion had no vacuous-pass guard: `packages/domain` joining eslint's `ignores` would make its silence meaningless. **Fixed:** an `eqeqeq` positive control at that same path, mirroring the client one (which is now run at all three probe paths).
- [x] [Review][Patch] The `Intl`/`toLocale*` scan was both over- and under-broad. **Fixed:** rooted at `apps/web` rather than `apps/web/src`, so `vite.config.ts` and `vitest.config.ts` are covered (asserted, so re-narrowing fails); `Intl` detection is now regex-based over three shapes — member access, `Intl['computed']`, and aliasing the namespace — with a ten-name type-only allowlist so `Intl.DateTimeFormatOptions` is not a false positive; and the forbidden-call list gained `toISOString`, `toDateString`, `toTimeString`, `toUTCString` and the `getDate`/`getMonth`/`getFullYear`/`getHours`/`getMinutes`/`getDay` assembly family, matched as `.name(` so `toLocaleLowerCase` and `valueOf` stay clean. A detector self-test case per new shape, both polarities.
- [x] [Review][Patch] L2 coverage holes, all verified silent against the real config and none needing type information: `{'Danas'}`, {`` `Danas` ``}, `aria-label={'…'}`, `aria-description`, `aria-roledescription`, `aria-valuetext`, and `<optgroup label="…">`. **Fixed:** three new selectors — a braced string and a template literal as element children (parented to `JSXElement`/`JSXFragment` so `className={'flex'}` stays silent), a braced string on a guarded attribute, and an element-qualified `label` for `optgroup`/`option`/`track` — plus a widened aria pattern. Eleven new VIOLATIONS cases. [eslint.config.js]
- [x] [Review][Patch] HUMAN-APPROVED 2026-09-04: the rule fired on pure separator punctuation between expressions (`{a} – {b}`, `{a}:`), a false positive in a merge-blocking rule and the fastest route to `eslint-disable`. **Fixed:** `JSXText[value=/[^\s\-–—:,.()\/|•]/]`, with the same class applied to the two new child selectors so `{' '}` and `{' – '}` also pass. Both polarities asserted: eleven separator shapes stay silent, and six content shapes — including a single letter and a bare digit — still fire.
- [x] [Review][Patch] A plural key resolved without `count` rendered raw ICU source to the user (`{count, plural, one {# dan} …}`), because `intl-messageformat` throws `MissingValueError` and the plugin's default handler returns the untranslated source. **Fixed:** `i18nFormat.parseErrorHandler` → `⟦key⟧`. Note it must be passed under `i18nFormat`, not at the top level — the plugin reads its own options from `i18next.options.i18nFormat`, so a top-level handler is silently ignored, which is why the first attempt at this fix did nothing.
- [x] [Review][Patch] `t('count')` — a parent node — returned the resource OBJECT, and React then throws "Objects are not valid as a React child", taking the screen down for one bad key. i18next's own `returnedObjectHandler` cannot catch this under ICU: the translator gates that branch on `i18nFormat.handleAsObject`, which the plugin does not set. **Fixed:** the same `parseErrorHandler` covers it, since `parse` receives the object and throws. Asserted that `t` returns a string for every key shape.
- [x] [Review][Patch] An invalid `Date` threw a bare `RangeError: Invalid time value` out of `formatToParts`, bypassing the named-error philosophy that made `part()` total. **Fixed:** a `FORMAT_INVALID_INSTANT` guard in `partsOf`, the single choke point every date/time entry point passes through; asserted across all six, plus a guard that a valid instant still formats.
- [x] [Review][Patch] No DST case existed although `formatTimeRange`'s doc claims "the crossing needs no special case here" and every instant was CEST. **Fixed:** Croatia's 25.10.2026 fall-back night (19:00–07:00 on the clock, **13** elapsed hours) and the 29.03.2026 spring-forward night (11 elapsed hours), both asserting the same literal and the elapsed-hours fixture itself.
- [x] [Review][Patch] Acceptance criterion 6 was false as written — see the corrected criterion above. **Fixed:** reworded to the real rule and automated as a bundle sweep over nineteen navigation and terminology words, with a non-vacuous guard.
- [x] [Review][Patch] The seven-line justification for `interpolation: { escapeValue: false }` described a protection it did not provide: `extendTranslation` hands the message to `i18nFormat.parse` and never reaches i18next's own interpolator, so the flag changes no output under ICU (measured both ways). **Fixed:** dropped the inert option and stated `escapeVariables: false` on the plugin instead — the flag that actually governs — with an honest comment.
- [x] [Review][Patch] The mutation-failure count was wrong in two records. **Fixed:** measured and corrected in both the task line above and deferred-work entry 7 — 6 assertions, 3 in-process and 3 from the child. "4 from the child" was never possible: the child's fourth `it` is the vacuous-pass guard confirming it ran under Kiritimati.
- [x] [Review][Patch] `format.ts` must stay import-free for the child-process type-stripping proof to work, and the header did not say so. **Fixed:** a capitalised KEEP THIS MODULE IMPORT-FREE paragraph naming the consequence. [apps/web/src/i18n/format.ts:27-32]
- [x] [Review][Patch] `execFileSync` had no `timeout` or `maxBuffer`, so a hung child hung the suite, and non-JSON stdout surfaced as an opaque `JSON.parse` SyntaxError. **Fixed:** 30 s timeout, 1 MiB buffer, and a wrapped parse that reports the child's actual output under `FOREIGN_ZONE_CHILD_OUTPUT_NOT_JSON`.
- [x] [Review][Patch] `apps/web/src/**/*.test.ts` received `globals.browser` while using `node:child_process` and `process`, surviving only because `no-undef` is off for `.ts`. **Fixed:** added that glob to the node-globals block, which comes later and therefore wins.
- [x] [Review][Patch] Nothing guarded `hr.json`, the artifact 1.1d multiplies — neither this story's frozen "Never" (no screen, navigation or terminology string) nor UX-DR34's and UX-DR36's constraints on what the strings may say. **Fixed:** new `test/resource-hygiene.test.ts` — exactly the two sanctioned keys, all three plural categories per message, no exclamation mark, no `smjen` stem, no hyphen range, no reserved navigation vocabulary, plus helper self-tests and a vacuous-pass guard. [test/resource-hygiene.test.ts]

**Rejected on measurement (no action).** `count: "2"` does not render `NaN dana` — it renders `2 dana`, because i18next treats a non-numeric `count` as no plural handling and ICU coerces. An empty key does not return a blank — it returns `⟦⟧`. Range validation (reversed, over-24h, year-boundary) belongs to the domain, not to a formatter that is handed two instants.

**Acceptance Criteria:**
- Given a clean checkout, when `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` runs, then every command exits 0
- Given `TZ=Pacific/Kiritimati pnpm -C apps/web test`, when it completes, then every assertion passes against identical expectations — the proof no formatter reads the device zone
- Given `apps/web/src`, when searched, then `Intl` is constructed in `format.ts` and nowhere else
- Given a `.tsx` under `apps/web` carrying a bare JSX text literal, when `pnpm lint` runs, then it exits non-zero naming L2
- Given a deleted key, when the app resolves it, then `⟦key⟧` renders and nothing throws
- Given the built bundle, when searched, then the only user-facing Croatian in it is the two ICU plural messages from `hr.json` and the `⟦` placeholder, plus the existing `<title>Shift</title>` and `lang="hr"` in `index.html` — **corrected 2026-09-04**: as first written ("no user-facing text beyond the existing `<title>`") this was false by construction, since bundling the resource file is the whole point and `# dana`, `konflikata` and `⟦` are necessarily present. Automated in `test/localization-applied.test.ts`, which sweeps the built chunk for the nineteen navigation and terminology words 1.1d will introduce.

## Design Notes

**Why the layer cannot lean on `Intl` defaults.** Three binding formats disagree with CLDR `hr`: the date (`12.09.2026` vs `12. 09. 2026.`), the range separator (unspaced U+2013 vs U+2009-padded), and month-name case. `formatToParts` is the seam — take the numeric parts, discard CLDR's literals, join with the binding ones:

```ts
const parts = fmt.formatToParts(instant);            // day ". " month ". " year "."
const at = (t: string) => parts.find(p => p.type === t)!.value;
return `${at('day')}.${at('month')}.${at('year')}`;  // 12.09.2026
```

**Why the plural cases are 21 and 101.** Croatian's `one` is not "exactly 1" but n%10==1 && n%100!=11, so 21 and 101 are `one` while 22 is `few`. A `count === 1` implementation passes at 1, 2 and 5 and fails at 21 — which is why those values carry the assertion.

**Why `⟦…⟧`.** The brackets sit outside Latin Extended-A, so a missing key cannot be mistaken for Croatian content in a screenshot or a diff, while the key stays legible enough to fix. Human-approved 2026-09-03.

## Verification

**Commands:**
- `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` -- expected: exit 0
- `TZ=Pacific/Kiritimati pnpm -C apps/web test` -- expected: exit 0, identical results to the default run

## Suggested Review Order

**The invariant the layer exists for**

- Required positional `timeZone`: an omitted zone is a compile error, not a silent device read.
  [`format.ts:131`](../../apps/web/src/i18n/format.ts#L131)

- The single `Intl` construction site; an invalid zone throws here, before the cache write.
  [`format.ts:93`](../../apps/web/src/i18n/format.ts#L93)

- The `formatToParts` seam: CLDR supplies digits, this module supplies binding separators.
  [`format.ts:106`](../../apps/web/src/i18n/format.ts#L106)

**The i18next runtime**

- Init: one locale, no fallback chain, so an absent key cannot hide behind another language.
  [`index.ts:69`](../../apps/web/src/i18n/index.ts#L69)

- `⟦key⟧` degradation — brackets outside Latin Extended-A, unmistakable for Croatian content.
  [`index.ts:62`](../../apps/web/src/i18n/index.ts#L62)

- ICU options live under `i18nFormat`; a top-level handler is silently ignored by the plugin.
  [`index.ts:77`](../../apps/web/src/i18n/index.ts#L77)

**The resource contract**

- The only two messages, as ICU plurals across all three Croatian categories.
  [`hr.json:2`](../../apps/web/src/i18n/locales/hr.json#L2)

- The four pins; `intl-messageformat` is explicit because its provider declares it a peer.
  [`package.json:17`](../../apps/web/package.json#L17)

**Boot wiring**

- Init awaited before first render, so no surface needs a not-ready branch.
  [`main.tsx:22`](../../apps/web/src/main.tsx#L22)

- Provider wraps the router with the module's own instance, not i18next's singleton.
  [`main.tsx:26`](../../apps/web/src/main.tsx#L26)

**The merge-blocking L2 guard**

- Makes 'no user-facing literal' mechanical; separator punctuation exempted by human decision.
  [`eslint.config.js:100`](../../eslint.config.js#L100)

**Proof each invariant can actually fail**

- Reads the built entry chunk: catches wiring that is defined but never applied.
  [`localization-applied.test.ts:67`](../../test/localization-applied.test.ts#L67)

- Source scan over the module: rejects a defaulted zone or any `resolvedOptions` call.
  [`format.test.ts:683`](../../apps/web/src/i18n/format.test.ts#L683)

- Foreign-zone child process on an instant where the two zones disagree on the date.
  [`format.test.ts:527`](../../apps/web/src/i18n/format.test.ts#L527)

- Guard fires at real component paths, with a positive control against a vacuous pass.
  [`localization-guard.test.ts:181`](../../test/localization-guard.test.ts#L181)

- Holds the resource file to this story's boundary: no screen, nav or terminology string.
  [`resource-hygiene.test.ts:61`](../../test/resource-hygiene.test.ts#L61)
