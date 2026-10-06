---
title: 'Every number is set in DM Sans tabular figures (7.2)'
type: 'feature'
created: '2026-10-06'
status: 'done'
baseline_commit: '008b273241cd4f3b632ef5f16a0e42f1de3d3a07'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Heavy Syne numerals get misread ("17" as "ı7"). DM Sans has no tabular figures (`tnum` is absent in Fontsource 5.3.0 and in upstream DM Sans v4, measured with fontTools: `1` is 312 units, `0` is 684). So every `tabular-nums` class in the app does nothing, and columns of numbers wobble.

**Approach:** A committed script derives a digits-only face, **Shift Figures**, from the Fontsource DM Sans file. Each digit is centred on one fixed advance. It is bound first in both `--font-sans` and `--font-heading` through `unicode-range: U+0030-0039`. Every digit in the app becomes a DM Sans tabular digit, including digits inside Syne headings (human decision). Words stay in their face. The numeric-only slots drop `font-heading`.

## Boundaries & Constraints

**Always:**
- Source file: `@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2`, which only has a `wght` axis.
- Output: one static woff2 per weight in use (400, 500, 600, 700, 800). Each file holds only `.notdef` and U+0030–0039, with no GSUB or GPOS.
- At each weight, every digit's advance is that weight's widest DM Sans digit. Each outline is shifted by `(W − advance) / 2` so it is centred.
- The output must be byte-deterministic: no timestamp recalculation. Name the family `Shift Figures`. Keep the OFL notice.
- Self-hosted next to `index.css`, bundled by Vite, `font-display: swap`.
- Update DESIGN.md §Typography and §Components and UX-DR40 in `epics.md` in the same change.

**Ask First:** Adding a weight outside 400–800. Adding any non-digit code point to the range.

**Never:**
- Loading any font from a CDN.
- Adding a new runtime npm dependency.
- Touching Syne words, letter-only Syne headings, or initials in the lockup and avatar.
- Removing existing `tabular-nums` classes. They are now harmless, and some are pinned by tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Body figure | `1111` and `0000` in DM Sans text, same weight | equal rendered widths | N/A |
| Heading figure | `Listopad 2026` in an `h2` | "Listopad" in Syne, `2026` in Shift Figures | N/A |
| Stat value | `StatValue`, `StatTileValue`, leave figure, `SectionNumber` | DM Sans face, digits tabular | N/A |
| Line metrics | heading or body with digits | line height unchanged, because the range excludes U+0020 | N/A |
| Input missing | Fontsource file absent | script exits non-zero and names the path | fail loudly |

### Epic AC Deviations

- AC1: "it is set in DM Sans with tabular figures". DM Sans ships no tabular figures. The spec sets DM Sans's own digit glyphs, re-spaced to one advance, in a derived face. Why: no other way keeps DM Sans glyphs and makes them tabular (human decision).

</frozen-after-approval>

## Code Map

- `apps/web/src/index.css:155-162` -- the `@fontsource` imports. :317-318 hold the `--font-sans` and `--font-heading` stacks (`@theme inline`). :401 is body and :405-413 is the h1–h6 rule. :24 is the header note "Body text is DM Sans, headings Syne".
- `apps/web/node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2` -- the input file. Its GSUB has no `tnum`, and `ss07` only swaps glyph shapes.
- `components/ui/stat-card.tsx:40` (`StatValue`), `components/ui/stat-tile.tsx:35` (`StatTileValue`), `components/ui/section-number.tsx:20` and `features/leave/components/member-leave-card.tsx:129` -- all four numeric slots use `font-heading`. The mockups set them in DM Sans (`.tile .tv`, `.hcard .v`). Update the comments in stat-card.tsx:6-7 and stat-tile.tsx:5-7 too.
- `test/typography-coverage.test.ts:163-168` -- the regex `--font-sans:\s*'DM Sans Variable'` breaks once Shift Figures leads the stack. `FACES` and the import-order test stay as they are, because the new face is inline `@font-face`, not an import.
- `e2e/tests/layout/responsive.spec.ts` -- the pattern for layout specs: `test`/`expect` come from `utils/custom-fixtures.ts`, and `loginPage` is reachable without signing in.
- `_bmad-output/planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md:142-149` (`typography:` yaml; heading `use:` names "large numerals"), :230-240 (§Typography), :277 and :286 (StatCard/StatTile "Syne value"), `updated:` :6.
- `_bmad-output/planning-artifacts/epics.md:160` -- the UX-DR40 line.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/fonts/build-figures.py` -- a uv inline-metadata script (`fonttools`, `brotli`). It instances `wght` at each weight, subsets the font to the digits, centres each digit on the widest digit's advance, renames the family, and writes `apps/web/src/assets/fonts/shift-figures-{400..800}.woff2`. Running it twice must give identical bytes.
- [x] `apps/web/src/assets/fonts/` -- commit the five generated files and a `LICENSE` (the DM Sans OFL text).
- [x] `apps/web/src/index.css` -- five `@font-face` rules for `Shift Figures`, each with its `font-weight` and `unicode-range: U+0030-0039`. Put `'Shift Figures'` first in both stacks. Add a header comment explaining why the face exists and how to regenerate it.
- [x] The four numeric slots -- drop `font-heading`. They inherit DM Sans. Fix their comments.
- [x] `test/typography-coverage.test.ts` -- add a describe that checks:
  - the five weights each have a rule;
  - the range is exactly digits;
  - every referenced file exists;
  - both stacks start with `'Shift Figures'` followed by their face.
  Re-point the binding regex. Add a sweep that no `.tsx` keeps `font-heading` on any of the four slots.
- [x] `e2e/tests/layout/numerals.spec.ts` -- on the login page, inject `1111` and `0000` probes as `<p>` and `<h2>` at weights 400 and 800. Await `document.fonts.ready`. Assert the widths match within 0.5 px, and that `document.fonts.check('16px "Shift Figures"')` is true.
- [x] DESIGN.md (yaml, §Typography, §Components, `updated`) and `epics.md:160` -- describe the derived face and the rule that digits are never Syne.

**Acceptance Criteria:**
- Given any screen in either theme, when a number renders, then its digits come from Shift Figures, and Syne draws only letters.
- Given a column in Sati or the shift-type table, when it renders, then the digit positions align.
- Given the checked-in assets, when `uv run scripts/fonts/build-figures.py` runs again, then `git status` is clean.
- Given the DM Sans and Syne imports, when the coverage suite runs, then č ć ž š đ Č Ć Ž Đ Š remain covered.

## Design Notes

The CSS "first available font" is the first face whose range contains U+0020. Shift Figures excludes the space, so line-box metrics stay DM Sans and Syne. That is why one global binding is safe.

Static instances are used instead of a variable re-spacing, because centring in a variable font needs gvar phantom-point deltas. Five files of about 1.3 KB each (1336–1360 bytes, measured) are only fetched when a digit appears.

Every weight shares one digit advance, the widest digit across 400–800 (706 units), so a column that mixes weights still aligns.

## Verification

**Commands:**
- `uv run scripts/fonts/build-figures.py && git status --porcelain apps/web/src/assets/fonts` -- expected: empty
- `pnpm exec vitest run test/typography-coverage.test.ts` -- expected: all pass
- `pnpm --filter ./apps/web test && pnpm lint && pnpm typecheck` -- expected: clean
- `pnpm build` -- expected: five woff2 files in `apps/web/dist/assets`
- `pnpm test:e2e e2e/tests/layout/numerals.spec.ts` -- expected: pass

**Manual checks:**
- Kalendar (desktop): "Listopad 2026" shows Syne letters with DM Sans digits. On Sati, the totals align.

## Suggested Review Order

**Why a derived face, and how it binds**

- Entry point: DM Sans has no `tnum`, so the digits are re-spaced into Shift Figures
  [`index.css:165`](../../apps/web/src/index.css#L165)

- Digits-only `unicode-range`; leading both stacks reaches every digit, Syne headings included
  [`index.css:384`](../../apps/web/src/index.css#L384)

- Five per-weight faces, fetched lazily, self-hosted
  [`index.css:186`](../../apps/web/src/index.css#L186)

**Generating the figures**

- One advance across all weights, so mixed-weight columns still align
  [`build-figures.py:181`](../../scripts/fonts/build-figures.py#L181)

- Centre each outline on that advance
  [`build-figures.py:112`](../../scripts/fonts/build-figures.py#L112)

- Pinned source hash: a Fontsource bump without regeneration fails loudly
  [`build-figures.py:50`](../../scripts/fonts/build-figures.py#L50)

- Keep the woff2 files as separate assets so unicode-range stays lazy
  [`vite.config.ts:31`](../../apps/web/vite.config.ts#L31)

**Numeric slots leave Syne**

- StatValue (and StatTile, SectionNumber, the leave figure) drop `font-heading`
  [`stat-card.tsx:41`](../../apps/web/src/components/ui/stat-card.tsx#L41)

**Binding docs**

- The new `figures` typography entry and §Typography wording
  [`DESIGN.md:148`](../planning-artifacts/ux-designs/ux-shift-2026-09-02/DESIGN.md#L148)

- UX-DR40: every digit is DM Sans tabular, never Syne
  [`epics.md:160`](../planning-artifacts/epics.md#L160)

**Tests**

- Rendered proof: equal widths in every weight and face, line box unchanged
  [`numerals.spec.ts:1`](../../e2e/tests/layout/numerals.spec.ts#L1)

- Rules, stacks, source hash, and the weight/italic sweep
  [`typography-coverage.test.ts:210`](../../test/typography-coverage.test.ts#L210)

- Built CSS links the five hashed files, no data URIs
  [`theme-applied.test.ts:180`](../../test/theme-applied.test.ts#L180)
